import { previewAccess } from "./access";
import { deleteDoc, getDoc, listDocs, listUploads, patchDoc, push, putBlob, sweep } from "./api";
import { apiKey } from "./auth";
import { createKey, dashboardPage, listKeys, revokeKey } from "./dashboard";
import { font, notFound, notice, setTheme } from "./page";
import { json } from "./util";
import { ownerOpen, unlock, view } from "./view";

/** Doc routes shared by /api (API key) and /dashboard/api (Cloudflare Access). `keyId` is null for the dashboard. */
async function docRoutes(req: Request, env: Env, path: string, keyId: string | null): Promise<Response | undefined> {
  let m: RegExpMatchArray | null;
  if (req.method === "POST" && path === "/api/push") return push(req, env, keyId);
  if (req.method === "PUT" && (m = path.match(/^\/api\/blobs\/([0-9a-f]{64})$/))) return putBlob(req, env, m[1]);
  if (req.method === "GET" && path === "/api/docs") return listDocs(req, env);
  if (req.method === "GET" && path === "/api/uploads") return listUploads(env);
  if ((m = path.match(/^\/api\/docs\/([A-Za-z0-9-]{1,64})$/))) {
    if (req.method === "GET") return getDoc(req, env, m[1]);
    if (req.method === "PATCH") return patchDoc(req, env, m[1]);
    if (req.method === "DELETE") return deleteDoc(env, m[1]);
  }
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    let m: RegExpMatchArray | null;

    if ((m = path.match(/^\/view\/([A-Za-z0-9-]{1,64})(?:@(\d{1,9}))?(\/.*)?$/))) {
      const [, ref, pin, rest] = m;
      if (req.method === "POST" && rest === "/unlock" && !pin) return unlock(req, env, ref);
      if (req.method === "GET" || req.method === "HEAD") return view(req, env, ref, pin ? Number(pin) : undefined, rest);
    }

    if (req.method === "GET" && (m = path.match(/^\/font\/([a-z-]+)\.woff2$/))) return font(m[1]) ?? notFound(req);
    if (req.method === "GET" && (m = path.match(/^\/theme\/([a-z]+)$/))) return setTheme(url, m[1]) ?? notFound(req);

    if (path.startsWith("/api/")) {
      const keyId = await apiKey(req, env, ctx);
      if (!keyId) return json({ error: "unauthorized" }, 401);
      return (await docRoutes(req, env, path, keyId)) ?? json({ error: "not found" }, 404);
    }

    if (path === "/") return Response.redirect(`${url.origin}/dashboard`, 302);

    if (path === "/dashboard" || path.startsWith("/dashboard/")) {
      // ctx.access is set only when Cloudflare Access authenticated this request; previews check the Access JWT instead.
      const preview = ctx.access ? null : await previewAccess(req, env);
      if (!ctx.access && !preview) return notice(req, 403, "Sign-in required", "The dashboard is behind Cloudflare Access, and this request didn't come through it. See the README to set it up.");
      if (path === "/dashboard" && req.method === "GET") return dashboardPage(req);
      if (req.method === "GET" && (m = path.match(/^\/dashboard\/open(\/([A-Za-z0-9-]{1,64})(?:@\d{1,9})?(?:\/.*)?)$/))) {
        return ownerOpen(req, env, m[2], `/view${m[1]}`);
      }
      if (path.startsWith("/dashboard/api/")) {
        // CSRF: browsers always send Origin on non-GET requests, and a sandboxed doc sends "null".
        if (req.method !== "GET" && req.headers.get("origin") !== url.origin) return json({ error: "cross-origin request refused" }, 403);
        const sub = path.slice("/dashboard".length);
        if (req.method === "GET" && sub === "/api/me") return json({ email: ctx.access ? ((await ctx.access.getIdentity())?.email ?? null) : preview!.email });
        if (req.method === "GET" && sub === "/api/keys") return listKeys(env);
        if (req.method === "POST" && sub === "/api/keys") return createKey(req, env);
        if (req.method === "POST" && (m = sub.match(/^\/api\/keys\/(k_[A-Za-z0-9]{1,32})\/revoke$/))) return revokeKey(env, m[1]);
        return (await docRoutes(req, env, sub, null)) ?? json({ error: "not found" }, 404);
      }
    }

    return req.headers.get("accept")?.includes("text/html") ? notFound(req) : json({ error: "not found" }, 404);
  },

  async scheduled(_event, env): Promise<void> {
    await sweep(env);
  },
} satisfies ExportedHandler<Env>;
