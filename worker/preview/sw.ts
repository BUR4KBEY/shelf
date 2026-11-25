/// <reference lib="webworker" />
// The preview: the real Worker (src/) running in this service worker, on data that never leaves the browser.
// Only the dashboard can upload; the API, the CLI and MCP get a 403.
import initSqlJs, { type Database } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import { sweep } from "../src/api";
import worker from "../src/index";
import { darkReaderScript, themeAttr } from "../src/page";
import { seed } from "./seed";
import { d1, r2, store } from "./shims";

declare const self: ServiceWorkerGlobalScope;

// Cloudflare-only: compares two buffers. Callers check the lengths first.
const subtle: SubtleCrypto & { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean } = crypto.subtle;
subtle.timingSafeEqual ??= (a, b) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

// The browser's cookies, where the service worker can reach them (not every browser has the Cookie Store API yet).
// The dashboard writes `theme` and `palette` with document.cookie, so only this store lets the Worker's pages see them.
type CookieStore = {
  getAll(): Promise<{ name: string; value: string }[]>;
  set(c: { name: string; value: string; path: string; expires: number }): Promise<void>;
  delete(name: string): Promise<void>;
};
const cookieStore = "cookieStore" in self ? (self.cookieStore as CookieStore) : null;

// A Response made by script drops Set-Cookie, so the Worker's cookies (unlock, theme) are caught as it builds them.
const setCookies = new WeakMap<Response, string[]>();
globalThis.Response = class extends Response {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    const set = new Headers(init?.headers).getSetCookie();
    if (set.length) setCookies.set(this, set);
  }
};

const migrations = Object.entries(import.meta.glob<string>("../migrations/*.sql", { query: "?raw", import: "default", eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

type State = { db: Database; env: Env; jar: Map<string, string> };
let state: Promise<State> | undefined;

async function open(): Promise<State> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await store<Uint8Array | undefined>("state", "readonly", (s) => s.get("db"));
  const db = new SQL.Database(saved);
  db.run("PRAGMA foreign_keys = ON"); // D1 enforces them; deleting a doc cascades to its versions
  // Migrations added since this browser's copy was saved; user_version counts the ones applied.
  const applied = db.exec("PRAGMA user_version")[0].values[0][0] as number;
  for (const [i, sql] of migrations.entries()) {
    if (i >= applied) db.exec(`BEGIN; ${sql}; PRAGMA user_version = ${i + 1}; COMMIT;`);
  }
  const env = { DB: d1(db), BUCKET: r2, UNLOCK_LIMIT: { limit: async () => ({ success: true }) } } as unknown as Env;
  const jar = new Map(await store<[string, string][] | undefined>("state", "readonly", (s) => s.get("cookies")));
  const s = { db, env, jar };
  if (!saved) await seed(env);
  await sweep(env); // the daily cron, run whenever the preview starts
  await save(s);
  return s;
}

async function save({ db, jar }: State) {
  await store("state", "readwrite", (s) => s.put(db.export(), "db"));
  await store("state", "readwrite", (s) => s.put([...jar], "cookies"));
}

async function reset() {
  (await state)?.db.close();
  state = undefined;
  await store("blobs", "readwrite", (s) => s.clear());
  await store("state", "readwrite", (s) => s.clear());
}

const base = {
  passThroughOnException() { },
  access: { aud: "preview", getIdentity: async () => ({ email: "you@preview" }) },
};

/** Cookies that live seconds (the `owner` mark from opening a doc in the dashboard): kept in memory only, never saved. */
const brief = new Map<string, { value: string; until: number }>();

/**
 * The request as the Worker sees it. A service worker can't read the Cookie header, Origin or Content-Length, nor set
 * them on a Request, so they go on a plain Headers object in its place.
 */
async function forWorker(req: Request, jar: Map<string, string>): Promise<Request> {
  const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer();
  const out = new Request(req.url, { method: req.method, headers: req.headers, body, redirect: "manual" });
  const headers = new Headers(req.headers);
  if (body) headers.set("content-length", String(body.byteLength));
  headers.set("origin", location.origin);
  // Browsers leave it off a service worker's requests; view statistics count only requests that name a browser.
  if (!headers.has("user-agent")) headers.set("user-agent", navigator.userAgent);
  // The page's own cookies (theme, palette) win over the jar's, which may hold an older theme from the Worker's pages.
  const page = (await cookieStore?.getAll().catch(() => [])) ?? [];
  const live = [...brief].filter(([, c]) => c.until > Date.now()).map(([k, c]) => [k, c.value] as const);
  const cookies = new Map([...jar, ...live, ...page.map((c) => [c.name, c.value] as const)]);
  headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  Object.defineProperty(out, "headers", { value: headers });
  return out;
}

/** Keeps a cookie the Worker set in the preview's jar, and in the browser's cookies too where it can, so the dashboard sees a theme set elsewhere. */
async function keep(jar: Map<string, string>, setCookie: string) {
  const [, name, value] = setCookie.match(/^([^=;]+)=([^;]*)/) ?? [];
  if (!name) return;
  const maxAge = Number(setCookie.match(/;\s*max-age=(\d+)/i)?.[1]);
  if (maxAge > 0 && maxAge <= 60) return void brief.set(name, { value, until: Date.now() + maxAge * 1000 });
  const gone = /;\s*max-age=0\b/i.test(setCookie);
  if (gone) jar.delete(name);
  else jar.set(name, value);
  await (gone ? cookieStore?.delete(name) : cookieStore?.set({ name, value, path: "/", expires: Date.now() + 31536000_000 }))?.catch(() => {});
}

const ROUTES = /^\/(?:$|view\/|dashboard(?:\/|$)|font\/|theme\/|favicon\.svg$|llms\.txt$|api\/|mcp$|__preview\/)/;

/** `keepAlive` holds the service worker open for work the Worker left running (recording a view), which is then saved. */
async function handle(req: Request, url: URL, keepAlive: (p: Promise<unknown>) => void): Promise<Response> {
  if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
    return Response.json({ error: "the preview has no API or MCP server: upload from the dashboard" }, { status: 403 });
  }
  if (url.pathname === "/__preview/reset" && req.method === "POST") {
    await reset();
    return new Response(null, { status: 204 });
  }
  const s = await (state ??= open().catch((e) => ((state = undefined), Promise.reject(e))));
  const wreq = await forWorker(req, s.jar);
  if (url.pathname === "/dashboard" && req.method === "GET") {
    // The preview's own build of the dashboard, with the banner. Its theme and Dark Reader's script go in as the Worker does it.
    const page = await (await fetch("/app.html", { cache: "no-cache" })).text();
    return new Response(page.replace("<html", `<html${themeAttr(wreq)}`).replace("<head>", `<head>${darkReaderScript()}`), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; connect-src 'self' https://api.github.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "cache-control": "no-store",
      },
    });
  }
  const pending: Promise<unknown>[] = [];
  const ctx = { ...base, waitUntil: (p: Promise<unknown>) => void pending.push(p.catch(console.error)) } as unknown as ExecutionContext;
  const res = await worker.fetch(wreq, s.env, ctx);
  if (pending.length) keepAlive(Promise.all(pending).then(() => save(s)));
  const set = setCookies.get(res) ?? [];
  for (const c of set) await keep(s.jar, c);
  if (set.length || (req.method !== "GET" && req.method !== "HEAD")) await save(s);
  // A sandboxed doc has an opaque origin, and the service worker doesn't serve such a page's requests: a folder's CSS,
  // scripts and links would miss it and 404 on GitHub Pages. Its CSP still blocks fetch, forms and frames.
  const csp = res.headers.get("content-security-policy");
  if (csp?.startsWith("sandbox ")) res.headers.set("content-security-policy", csp.slice(csp.indexOf(";") + 1).trim());
  return res;
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !ROUTES.test(url.pathname)) return;
  e.respondWith(handle(e.request, url, (p) => e.waitUntil(p)).catch((err) => new Response(`The preview failed: ${err}`, { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } })));
});
