import { marked } from "marked";
import { type Doc, findDoc } from "./api";
import { sameString, unlockToken, verifyPassword } from "./auth";
import { escapeHtml } from "./util";

// Server-side type policy by extension; client-sent types are ignored.
// Anything not listed is served as a download.
const INLINE: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  md: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
};

const MD_CSS = `:root{color-scheme:light dark}body{margin:0;font:16px/1.6 system-ui,sans-serif}main{max-width:46rem;margin:0 auto;padding:2rem 1.25rem}
img{max-width:100%}pre{overflow:auto;padding:1rem;border-radius:6px;background:#8881}code{font:.9em ui-monospace,monospace}
table{border-collapse:collapse}th,td{border:1px solid #8884;padding:.3rem .6rem}blockquote{margin:0;padding-left:1rem;border-left:3px solid #8886}`;

interface FileRow {
  path: string;
  sha256: string;
  size: number;
}

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });

const ip = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";

/** Our own page, not user content: no sandbox, so the form can submit. */
function lockedPage(status: number, ref: string, next: string, error = ""): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Locked</title>
<style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0}form{display:grid;gap:.6rem;width:16rem}input,button{font:inherit;padding:.5rem}p{margin:0;color:#c33}</style></head>
<body><form method="post" action="/view/${escapeHtml(ref)}/unlock"><label for="pw">This document needs a password.</label>
<input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${escapeHtml(next)}">${error ? `<p role="alert">${escapeHtml(error)}</p>` : ""}<button>Open</button></form></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

/** True when the request carries a valid unlock cookie or `X-Doc-Password`; a Response when it must be refused. */
async function checkAccess(req: Request, env: Env, doc: Doc, ref: string): Promise<true | Response> {
  if (!doc.password_hash) return true;
  const next = new URL(req.url).pathname;
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)u_${doc.id}=([0-9a-f]{64})`))?.[1];
  if (cookie && sameString(cookie, await unlockToken(doc.id, doc.password_hash))) return true;
  const password = req.headers.get("x-doc-password");
  if (password === null) return lockedPage(401, ref, next);
  if (!(await env.UNLOCK_LIMIT.limit({ key: `${ip(req)}:${doc.id}` })).success) return lockedPage(429, ref, next, "Too many attempts. Wait a minute.");
  return (await verifyPassword(password, doc.password_hash)) || lockedPage(401, ref, next, "Wrong password.");
}

export async function unlock(req: Request, env: Env, ref: string): Promise<Response> {
  const doc = await findDoc(env, ref);
  if (!doc?.password_hash) return text("Not found", 404);
  const form = await req.formData().catch(() => null);
  const password = form?.get("password");
  const nextField = form?.get("next");
  // Only same-origin /view paths, so the form cannot be used as an open redirect.
  const next = typeof nextField === "string" && nextField.startsWith("/view/") ? nextField : `/view/${ref}`;
  if (!(await env.UNLOCK_LIMIT.limit({ key: `${ip(req)}:${doc.id}` })).success) return lockedPage(429, ref, next, "Too many attempts. Wait a minute.");
  if (typeof password !== "string" || !(await verifyPassword(password, doc.password_hash))) return lockedPage(401, ref, next, "Wrong password.");
  return new Response(null, {
    status: 303,
    headers: {
      location: next,
      // Path=/view so pinned versions (/view/x@2) get it too. SameSite=None: the sandboxed doc has an
      // opaque origin, so its own image and CSS requests are cross-site and would drop a Lax cookie.
      // shortcut: one cookie per unlocked doc, all sent on every /view request; fine below a few hundred docs.
      "set-cookie": `u_${doc.id}=${await unlockToken(doc.id, doc.password_hash)}; Path=/view; Max-Age=2592000; HttpOnly; Secure; SameSite=None`,
      "cache-control": "no-store",
    },
  });
}

/**
 * GET /view/<ref>[@n][/path]. A single-file doc is served at the root; a folder serves index.html
 * there and its other files below it, with clean URLs (`/page` → page.html, `/dir/` → dir/index.html).
 */
export async function view(req: Request, env: Env, ref: string, pin: number | undefined, rest: string | undefined): Promise<Response> {
  const doc = await findDoc(env, ref);
  if (!doc) return text("Not found", 404);
  if (doc.expires_at !== null && doc.expires_at <= Date.now()) return text("This link has expired.", 410);
  const access = await checkAccess(req, env, doc, ref);
  if (access !== true) return access;

  const n = pin ?? doc.latest;
  const url = new URL(req.url);
  let file: FileRow | undefined;

  if (rest === undefined || rest === "/") {
    const { results } = await env.DB.prepare("SELECT path, sha256, size FROM files WHERE doc_id = ? AND n = ? ORDER BY path = 'index.html' DESC LIMIT 2")
      .bind(doc.id, n)
      .all<FileRow>();
    if (results.length === 1) file = results[0];
    else if (results[0]?.path === "index.html") {
      // Folders live under a trailing slash so their relative links resolve.
      if (rest === undefined) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
      file = results[0];
    }
  } else {
    let p: string;
    try {
      p = decodeURIComponent(rest.slice(1));
    } catch {
      return text("Not found", 404);
    }
    const candidates = p.endsWith("/") ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
    const { results } = await env.DB.prepare("SELECT path, sha256, size FROM files WHERE doc_id = ? AND n = ? AND path IN (SELECT value FROM json_each(?))")
      .bind(doc.id, n, JSON.stringify(candidates))
      .all<FileRow>();
    const match = candidates.find((c) => results.some((r) => r.path === c));
    if (match === `${p}/index.html`) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
    file = results.find((r) => r.path === match);
  }
  if (!file) return text("Not found", 404);
  return serveFile(req, env, doc, n, pin !== undefined, file);
}

async function serveFile(req: Request, env: Env, doc: Doc, n: number, pinned: boolean, file: FileRow): Promise<Response> {
  const url = new URL(req.url);
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const markdown = ext === "md" && !url.searchParams.has("raw");
  const range = req.headers.has("range") && !markdown;

  let obj: R2ObjectBody | null;
  try {
    obj = await env.BUCKET.get(`docs/${file.sha256}`, range ? { range: req.headers } : {});
  } catch {
    return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${file.size}` } });
  }
  if (!obj) return text("Not found", 404);

  const type = markdown ? "text/html; charset=utf-8" : INLINE[ext];
  const headers = new Headers({
    "content-type": type ?? "application/octet-stream",
    "content-disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", // unguessable URLs must not leak to linked sites
    "x-robots-tag": "noindex",
    "cache-control": doc.password_hash ? "private, no-store" : pinned ? "public, max-age=31536000, immutable" : "no-cache",
    // The sandboxed doc has an opaque origin, so its own fonts and module scripts are CORS requests.
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
    "x-shelf-doc": doc.id,
    "x-shelf-version": String(n),
  });
  // Chrome's PDF viewer renders nothing under a sandbox CSP, and a PDF cannot run page script.
  if (ext !== "pdf") {
    // No allow-same-origin: doc scripts run with an opaque origin and cannot read cookies or call the API.
    // The origin is spelled out because 'self' does not match from an opaque origin.
    headers.set(
      "content-security-policy",
      [
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
        "default-src 'none'",
        `script-src 'unsafe-inline' ${url.origin}`,
        `style-src 'unsafe-inline' https: ${url.origin}`,
        `img-src https: data: blob: ${url.origin}`,
        `font-src https: data: ${url.origin}`,
        `media-src https: data: blob: ${url.origin}`,
        "connect-src 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
      ].join("; "),
    );
  }

  if (markdown) {
    const body = await marked.parse(await obj.text());
    headers.delete("accept-ranges");
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(doc.title ?? name)}</title><style>${MD_CSS}</style></head><body><main>${body}</main></body></html>`,
      { headers },
    );
  }
  if (range && obj.range) {
    const r = obj.range as { offset?: number; length?: number; suffix?: number };
    const offset = r.suffix !== undefined ? obj.size - r.suffix : (r.offset ?? 0);
    const length = r.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { headers });
}
