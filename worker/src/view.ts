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
  latest: number;
}

export async function view(req: Request, env: Env, ref: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT f.path, f.sha256, f.size, d.latest FROM docs d JOIN files f ON f.doc_id = d.id AND f.n = d.latest WHERE d.id = ?",
  )
    .bind(ref)
    .all<FileRow>();
  const file = results.length === 1 ? results[0] : results.find((f) => f.path === "index.html");
  if (!file) return new Response("Not found", { status: 404 });

  const range = req.headers.has("range");
  let obj: R2ObjectBody | null;
  try {
    obj = await env.BUCKET.get(`docs/${file.sha256}`, range ? { range: req.headers } : {});
  } catch {
    return new Response("Range not satisfiable", { status: 416, headers: { "content-range": `bytes */${file.size}` } });
  }
  if (!obj) return new Response("Not found", { status: 404 });

  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const type = INLINE[ext];
  const headers = new Headers({
    "content-type": type ?? "application/octet-stream",
    "content-disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", // unguessable URLs must not leak to linked sites
    "x-robots-tag": "noindex",
    "cache-control": "no-cache",
    "accept-ranges": "bytes",
    "x-shelf-doc": ref,
    "x-shelf-version": String(file.latest),
  });
  // Chrome's PDF viewer renders nothing under a sandbox CSP, and a PDF cannot run page script.
  if (ext !== "pdf") {
    // No allow-same-origin: doc scripts run with an opaque origin and cannot read cookies or call the API.
    // The origin is spelled out because 'self' does not match from an opaque origin.
    const origin = new URL(req.url).origin;
    headers.set(
      "content-security-policy",
      [
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
        "default-src 'none'",
        `script-src 'unsafe-inline' ${origin}`,
        `style-src 'unsafe-inline' https: ${origin}`,
        `img-src https: data: blob: ${origin}`,
        `font-src https: data: ${origin}`,
        `media-src https: data: blob: ${origin}`,
        "connect-src 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
      ].join("; "),
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
