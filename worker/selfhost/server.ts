// shelf in one process, for the Docker image: the Worker (src/) on Bun, with the stand-ins in store.ts for its bindings.
// A password (SHELF_PASSWORD) signs the owner in to the dashboard, where Cloudflare Access does on Cloudflare.
import { timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import migrations from "shelf:migrations";
import { sameString } from "../src/auth";
import worker from "../src/index";
import { LOCK_ICON, cardPage, localPath } from "../src/page";
import { escapeHtml, hex, ipKey, sha256Hex } from "../src/util";
import { d1, loadSecret, openDb, r2, rateLimit, removeTempFiles, rotateSecret } from "./store";

// Cloudflare-only: compares two buffers. Callers check the lengths first.
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView | ArrayBuffer, b: ArrayBufferView | ArrayBuffer) => boolean };
subtle.timingSafeEqual ??= (a, b) => a.byteLength === b.byteLength && timingSafeEqual(a as Uint8Array, b as Uint8Array);

const PASSWORD = process.env.SHELF_PASSWORD ?? "";
const DATA = process.env.SHELF_DATA ?? "/data";
const PORT = Number(process.env.PORT ?? 8080);
// Behind a reverse proxy: the client's IP, scheme and host come from its X-Forwarded-* headers.
const TRUST_PROXY = process.env.SHELF_TRUST_PROXY === "1";
const EMAIL = process.env.SHELF_EMAIL || "owner";

// The dashboard is the whole shelf: a short password would be guessed.
if (PASSWORD.length < 12) {
  console.error("Set SHELF_PASSWORD to at least 12 characters: it signs you in to the dashboard.");
  process.exit(1);
}

await mkdir(join(DATA, "blobs"), { recursive: true });
// No upload runs before the server starts, so any temporary file is one a crash left half-written.
await removeTempFiles(join(DATA, "blobs"));
const db = openDb(join(DATA, "shelf.db"), migrations);
const env = {
  DB: d1(db),
  BUCKET: r2(join(DATA, "blobs")),
  // Same limits as wrangler.jsonc: password attempts per IP and doc, and here per IP at the dashboard's sign-in too; views counted per IP.
  UNLOCK_LIMIT: rateLimit(10, 60),
  VIEW_LIMIT: rateLimit(60, 60),
  // The audience of the ctx.access this server makes for a signed-in owner (below); the Worker trusts no other.
  ACCESS_AUD: "shelf",
  // Where the dashboard's Sign out posts (/dashboard/api/me).
  LOGOUT: "/logout",
} as unknown as Env;
const signIns = rateLimit(10, 60);
// All sign-ins together: an attacker spread over many networks still gets at most this many guesses a minute.
const allSignIns = rateLimit(100, 60);

// Sessions are signed with a key kept in the data volume and the password, so changing the password signs everyone out,
// and so does signing out, which replaces the key.
const KEY_PATH = join(DATA, "session.key");
const hmacKey = (secret: string) => crypto.subtle.importKey("raw", new TextEncoder().encode(`${secret}:${PASSWORD}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
let sessionKey = await hmacKey(await loadSecret(KEY_PATH));
const SESSION_DAYS = 30;
const sign = async (exp: number) => hex(await crypto.subtle.sign("HMAC", sessionKey, new TextEncoder().encode(`session:${exp}`)));

async function signedIn(req: Request): Promise<boolean> {
  const [, exp, mac] = req.headers.get("cookie")?.match(/(?:^|;\s*)shelf_session=(\d+)\.([0-9a-f]{64})(?:;|$)/) ?? [];
  return !!exp && Number(exp) > Date.now() && sameString(mac, await sign(Number(exp)));
}

/** Only a path on this origin, so the form can't be used as an open redirect. */
const safeNext = (next: unknown, req: Request) => localPath(next, new URL(req.url).origin) ?? "/dashboard";

function signInPage(req: Request, status: number, next: string, error = ""): Response {
  const card = `${LOCK_ICON}<div><h1>Sign in</h1><p>Enter the password this shelf was started with (SHELF_PASSWORD).</p></div>
<form method="post" action="/login"><label>Password
<input name="password" type="password" autocomplete="current-password" autofocus required${error ? ' aria-invalid="true" aria-describedby="error"' : ""}></label>
<input type="hidden" name="next" value="${escapeHtml(next)}">${error ? `<p id="error" class="error" role="alert">${escapeHtml(error)}</p>` : ""}<button>Sign in</button></form>`;
  return cardPage(req, status, "Sign in", card, { formAction: "'self'", back: `/login?next=${encodeURIComponent(next)}` });
}

async function signIn(req: Request, ip: string): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const password = form?.get("password");
  const next = safeNext(form?.get("next"), req);
  if (!(await signIns.limit({ key: ipKey(ip) })).success || !(await allSignIns.limit({ key: "all" })).success) {
    return signInPage(req, 429, next, "Too many attempts. Wait a minute.");
  }
  // Hashed first so the comparison takes the same time whatever the lengths.
  if (typeof password !== "string" || !sameString(await sha256Hex(password), await sha256Hex(PASSWORD))) return signInPage(req, 401, next, "Wrong password.");
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  const cookie = `shelf_session=${exp}.${await sign(exp)}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; SameSite=Lax${secure}`;
  return new Response(null, { status: 303, headers: { location: next, "set-cookie": cookie, "cache-control": "no-store" } });
}

/** Signs every browser out, a stolen cookie included: the key sessions are signed with is replaced. */
async function signOut(req: Request): Promise<Response> {
  const url = new URL(req.url);
  // CSRF, as the dashboard API checks it: another site must not be able to sign the owner out.
  if (req.headers.get("origin") !== url.origin) return Response.json({ error: "cross-origin request refused" }, { status: 403 });
  // Only the owner rotates the key; anyone else just loses a cookie they didn't have.
  if (await signedIn(req)) sessionKey = await hmacKey(await rotateSecret(KEY_PATH));
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": `shelf_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`, "cache-control": "no-store" } });
}

/** The request as the Worker sees it: the public URL, and the client's IP where Cloudflare puts it. */
function forWorker(req: Request, ip: string): Request {
  let url = new URL(req.url);
  if (TRUST_PROXY) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
    const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || url.host;
    url = new URL(url.pathname + url.search, `${proto === "http" || proto === "https" ? proto : url.protocol.slice(0, -1)}://${host}`);
  }
  const headers = new Headers(req.headers);
  headers.set("cf-connecting-ip", ip); // never the client's own: view.ts rate-limits password attempts by it
  return new Request(url, { method: req.method, headers, body: req.body, redirect: "manual" });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120, // a large backup export can take a while to start streaming
  async fetch(raw, server) {
    // The proxy appends the address it saw, so the last entry is the only one a client can't forge.
    const ip = (TRUST_PROXY && raw.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim()) || server.requestIP(raw)?.address || "unknown";
    const req = forWorker(raw, ip);
    const path = new URL(req.url).pathname;

    if (path === "/login") {
      if (req.method === "POST") return signIn(req, ip);
      if (req.method === "GET") return signInPage(req, 200, safeNext(new URL(req.url).searchParams.get("next"), req));
    }

    if (path === "/logout" && req.method === "POST") return signOut(req);

    const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(console.error), passThroughOnException() { }, props: {} } as ExecutionContext & { access?: unknown };
    if (path === "/dashboard" || path.startsWith("/dashboard/")) {
      if (!(await signedIn(req))) {
        if (req.method === "GET" && req.headers.get("accept")?.includes("text/html")) {
          return Response.redirect(`${new URL(req.url).origin}/login?next=${encodeURIComponent(path + new URL(req.url).search)}`, 303);
        }
        return Response.json({ error: "sign in at /login" }, { status: 401 });
      }
      ctx.access = { aud: env.ACCESS_AUD, getIdentity: async () => ({ email: EMAIL }) };
    }
    return worker.fetch(req, env, ctx);
  },
  error(e) {
    console.error(e);
    return new Response("Internal server error", { status: 500 });
  },
});

// The daily cron (wrangler.jsonc `triggers`), on the same schedule so Settings → Cleanup shows the right next run.
const CRON = "17 3 * * *";
function scheduleCleanup() {
  const [minute, hour] = CRON.split(" ").map(Number);
  const next = new Date();
  next.setUTCHours(hour, minute, 0, 0);
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  setTimeout(() => {
    const ctx = { waitUntil() { }, passThroughOnException() { }, props: {} } as unknown as ExecutionContext;
    worker.scheduled!({ cron: CRON, scheduledTime: next.getTime() } as ScheduledController, env, ctx).catch(console.error).finally(scheduleCleanup);
  }, next.getTime() - Date.now());
}
scheduleCleanup();

console.log(`shelf listening on ${server.url}, data in ${DATA}`);
