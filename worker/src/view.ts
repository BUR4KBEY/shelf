import { marked } from "marked";
import { type Doc, appSettings, findDoc } from "./api";
import { sameString, unlockToken, verifyPassword } from "./auth";
import { LOCK_ICON, MD_CSS, cardPage, darkReaderScript, notFound, notice, themeAttr } from "./page";
import { escapeHtml, sha256Hex } from "./util";

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

interface FileRow {
  path: string;
  sha256: string;
  size: number;
}

const ip = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";

/** The crawlers chat apps send to build a card for a pasted link; iMessage borrows the Facebook and Twitter ones. Also in robots.txt (index.ts). */
export const PREVIEW_BOTS = ["Slackbot-LinkExpanding", "Slackbot", "Twitterbot", "facebookexternalhit", "Facebot", "Discordbot", "TelegramBot", "WhatsApp", "LinkedInBot", "SkypeUriPreview", "Mastodon"];
const PREVIEW_BOT = new RegExp(PREVIEW_BOTS.join("|"), "i");
/** Anything automated, so it never counts as a reader. */
const BOT = /bot|crawl|spider|slurp|preview|fetch|http|curl|wget|python|node|go-http|externalhit|whatsapp|mastodon/i;

/**
 * Records a reader opening a doc. Not counted: bots, link previews, prefetches, the owner opening it from the dashboard
 * (ownerOpen's `owner` cookie) and media seeks. `visitor` hashes the IP and browser with the day; neither is stored.
 */
async function recordView(req: Request, env: Env, doc: Doc, n: number): Promise<void> {
  const ua = req.headers.get("user-agent") ?? "";
  if (req.method !== "GET" || !ua || BOT.test(ua) || req.headers.has("range") || req.headers.has("sec-purpose") || /(?:^|;\s*)owner=1(?:;|$)/.test(req.headers.get("cookie") ?? "")) return;
  const now = Date.now();
  const visitor = (await sha256Hex(`${Math.floor(now / 86_400_000)}\n${ip(req)}\n${ua}`)).slice(0, 16);
  await env.DB.prepare("INSERT INTO views (doc_id, n, at, visitor) VALUES (?, ?, ?, ?)").bind(doc.id, n, now, visitor).run();
}

/** Our own page, not user content: no sandbox, so the form can submit. */
function lockedPage(req: Request, status: number, ref: string, next: string, error = ""): Response {
  const card = `${LOCK_ICON}<div><h1>This doc is locked</h1><p>Enter its password to read it.</p></div>
<form method="post" action="/view/${escapeHtml(ref)}/unlock"><label>Password
<input name="password" type="password" autocomplete="current-password" autofocus required${error ? ' aria-invalid="true" aria-describedby="error"' : ""}></label>
<input type="hidden" name="next" value="${escapeHtml(next)}">${error ? `<p id="error" class="error" role="alert">${escapeHtml(error)}</p>` : ""}<button>Open doc</button></form>`;
  const foot = `Your doc? <a href="/dashboard/open${escapeHtml(next.slice("/view".length))}">Open it from the dashboard</a>`;
  return cardPage(req, status, "Locked", card, { foot, formAction: "'self'", back: next });
}

/** True when the request carries a valid unlock cookie or `X-Doc-Password`; a Response when it must be refused. */
async function checkAccess(req: Request, env: Env, doc: Doc, ref: string): Promise<true | Response> {
  if (!doc.password_hash) return true;
  const next = new URL(req.url).pathname;
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)u_${doc.id}=([0-9a-f]{64})`))?.[1];
  if (cookie && sameString(cookie, await unlockToken(doc.id, doc.password_hash))) return true;
  const password = req.headers.get("x-doc-password");
  if (password === null) return lockedPage(req, 401, ref, next);
  if (!(await env.UNLOCK_LIMIT.limit({ key: `${ip(req)}:${doc.id}` })).success) return lockedPage(req, 429, ref, next, "Too many attempts. Wait a minute.");
  return (await verifyPassword(password, doc.password_hash)) || lockedPage(req, 401, ref, next, "Wrong password.");
}

export async function unlock(req: Request, env: Env, ref: string): Promise<Response> {
  const doc = await findDoc(env, ref);
  if (!doc?.password_hash) return notFound(req);
  const form = await req.formData().catch(() => null);
  const password = form?.get("password");
  const nextField = form?.get("next");
  // Only same-origin /view paths, so the form cannot be used as an open redirect.
  const next = typeof nextField === "string" && nextField.startsWith("/view/") ? nextField : `/view/${ref}`;
  if (!(await env.UNLOCK_LIMIT.limit({ key: `${ip(req)}:${doc.id}` })).success) return lockedPage(req, 429, ref, next, "Too many attempts. Wait a minute.");
  if (typeof password !== "string" || !(await verifyPassword(password, doc.password_hash))) return lockedPage(req, 401, ref, next, "Wrong password.");
  return new Response(null, { status: 303, headers: { location: next, "set-cookie": await unlockCookie(doc), "cache-control": "no-store" } });
}

// Path=/view so pinned versions (/view/x@2) get it too. SameSite=None: the sandboxed doc has an
// opaque origin, so its own image and CSS requests are cross-site and would drop a Lax cookie.
// shortcut: one cookie per unlocked doc, all sent on every /view request; fine below a few hundred docs.
const unlockCookie = async (doc: Doc) =>
  `u_${doc.id}=${await unlockToken(doc.id, doc.password_hash!)}; Path=/view; Max-Age=2592000; HttpOnly; Secure; SameSite=None`;

/**
 * GET /dashboard/open/<ref>[@n][/path], behind Cloudflare Access: the signed-in owner skips the password form.
 * Gives a locked doc its unlock cookie, then redirects to the same path under /view. The short `owner` cookie keeps
 * that open out of the view statistics.
 */
export async function ownerOpen(req: Request, env: Env, ref: string, viewPath: string): Promise<Response> {
  const doc = await findDoc(env, ref);
  const headers = new Headers({ location: `${viewPath}${new URL(req.url).search}`, "cache-control": "no-store" });
  headers.append("set-cookie", "owner=1; Path=/view; Max-Age=10; HttpOnly; Secure; SameSite=Lax");
  if (doc?.password_hash) headers.append("set-cookie", await unlockCookie(doc));
  return new Response(null, { status: 302, headers });
}

/**
 * GET /view/<ref>[@n][/path]. A single-file doc is served at the root; a folder serves index.html
 * there and its other files below it, with clean URLs (`/page` → page.html, `/dir/` → dir/index.html).
 */
export async function view(req: Request, env: Env, ctx: ExecutionContext, ref: string, pin: number | undefined, rest: string | undefined): Promise<Response> {
  const entry = rest === undefined || rest === "/";
  const previewBot = PREVIEW_BOT.test(req.headers.get("user-agent") ?? "");
  // Settings only matter for the page a link opens, and for chat apps' crawlers; a folder's assets skip the query.
  const settings = entry || previewBot ? await appSettings(env) : null;
  if (previewBot && !settings!.linkPreviews) return new Response("Link previews are turned off.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
  const doc = await findDoc(env, ref);
  if (!doc) return notFound(req);
  if (doc.expires_at !== null && doc.expires_at <= Date.now()) return notice(req, 410, "This link has expired", "The doc it led to is no longer available. Ask whoever sent it for a new one.");
  const access = await checkAccess(req, env, doc, ref);
  if (access !== true) return access;

  const n = pin ?? doc.latest;
  // Only a pinned version can be disabled: the current one never is.
  if (pin !== undefined && (await env.DB.prepare("SELECT disabled FROM versions WHERE doc_id = ? AND n = ?").bind(doc.id, pin).first<number>("disabled"))) {
    return notice(req, 410, "This version is turned off", "Its owner disabled this version of the doc. Ask whoever sent the link for the current one.");
  }
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
      return notFound(req);
    }
    const candidates = p.endsWith("/") ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`];
    const { results } = await env.DB.prepare("SELECT path, sha256, size FROM files WHERE doc_id = ? AND n = ? AND path IN (SELECT value FROM json_each(?))")
      .bind(doc.id, n, JSON.stringify(candidates))
      .all<FileRow>();
    const match = candidates.find((c) => results.some((r) => r.path === c));
    if (match === `${p}/index.html`) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
    file = results.find((r) => r.path === match);
  }
  if (!file) return notFound(req);
  const res = await serveFile(req, env, doc, n, pin !== undefined, file, entry && previewBot);
  if (entry && settings!.viewStats && res.status === 200) ctx.waitUntil(recordView(req, env, doc, n));
  return res;
}

/** `card`: a chat app is building a card for the link, so HTML and Markdown get Open Graph tags (the doc's title and the site name). */
async function serveFile(req: Request, env: Env, doc: Doc, n: number, pinned: boolean, file: FileRow, card: boolean): Promise<Response> {
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
  if (!obj) return notFound(req);

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

  const og = `<meta property="og:site_name" content="shelf"><meta property="og:type" content="website">`;
  if (markdown) {
    const body = await marked.parse(await obj.text());
    const title = escapeHtml(doc.title ?? name);
    headers.delete("accept-ranges");
    headers.set("vary", "cookie"); // the page carries the reader's theme
    return new Response(
      `<!doctype html><html lang="en"${themeAttr(req)}><head><meta charset="utf-8">${darkReaderScript()}<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${card ? `${og}<meta property="og:title" content="${title}">` : ""}<style>${MD_CSS}</style></head><body><main>${body}</main></body></html>`,
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
  if (card && type?.startsWith("text/html")) {
    // The doc's own <title> stays the fallback when it has no shelf title. The length changes, so no content-length.
    const tags = og + (doc.title ? `<meta property="og:title" content="${escapeHtml(doc.title)}">` : "");
    return new HTMLRewriter().on("head", { element: (head) => void head.append(tags, { html: true }) }).transform(new Response(obj.body, { headers }));
  }
  return new Response(obj.body, { headers });
}
