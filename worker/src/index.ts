import { deleteDoc, getDoc, listDocs, patchDoc, push, putBlob, sweep } from "./api";
import { apiKey } from "./auth";
import { json } from "./util";
import { unlock, view } from "./view";

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const path = new URL(req.url).pathname;
    let m: RegExpMatchArray | null;

    if ((m = path.match(/^\/view\/([A-Za-z0-9-]{1,64})(?:@(\d{1,9}))?(\/.*)?$/))) {
      const [, ref, pin, rest] = m;
      if (req.method === "POST" && rest === "/unlock" && !pin) return unlock(req, env, ref);
      if (req.method === "GET" || req.method === "HEAD") return view(req, env, ref, pin ? Number(pin) : undefined, rest);
    }

    if (path.startsWith("/api/")) {
      const keyId = await apiKey(req, env, ctx);
      if (!keyId) return json({ error: "unauthorized" }, 401);
      if (req.method === "POST" && path === "/api/push") return push(req, env, keyId);
      if (req.method === "PUT" && (m = path.match(/^\/api\/blobs\/([0-9a-f]{64})$/))) return putBlob(req, env, m[1]);
      if (req.method === "GET" && path === "/api/docs") return listDocs(req, env);
      if ((m = path.match(/^\/api\/docs\/([A-Za-z0-9-]{1,64})$/))) {
        if (req.method === "GET") return getDoc(req, env, m[1]);
        if (req.method === "PATCH") return patchDoc(req, env, m[1]);
        if (req.method === "DELETE") return deleteDoc(env, m[1]);
      }
    }

    return json({ error: "not found" }, 404);
  },

  async scheduled(_event, env): Promise<void> {
    await sweep(env);
  },
} satisfies ExportedHandler<Env>;
