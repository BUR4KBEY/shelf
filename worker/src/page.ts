import faviconSvg from "./favicon.svg";
import latinExt from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wdth-normal.woff2";
import latin from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2";
import { escapeHtml, randomId } from "./util";

// The pages the Worker writes itself (password form, notices, rendered Markdown) share the dashboard's look.
// The colours and the font faces mirror dashboard/src/index.css: change them there and here together.

const FONTS: Record<string, ArrayBuffer> = { latin, "latin-ext": latinExt };

/** shelf's source; the credit badge, the 404 page and the API's 404 link here. Also `REPO` in dashboard/src/lib/build.ts. */
export const REPO_URL = "https://github.com/BUR4KBEY/shelf";

// The logo inline, not <img src="/favicon.svg">: a sandboxed doc fetches as an opaque origin, so behind Access (a PR preview, or an owner
// who put the whole domain behind it) that request carries no sign-in cookie and the image breaks. Its own <style> follows the system theme.
const LOGO = faviconSvg.replace(/<title>.*?<\/title>/, "").replace("<svg ", '<svg aria-hidden="true" ');
/**
 * The "Shared with shelf" badge, pinned to the bottom-right corner of HTML and Markdown docs while `credit` is on. Appended after the
 * doc's own markup: a declarative shadow root keeps the doc's CSS and the badge's apart, and needs no script to show. The close button
 * does use an inline handler; a doc whose own CSP blocks it keeps the badge, and a browser without declarative shadow DOM shows nothing.
 */
export const CREDIT_BADGE = `<shelf-credit style="all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647"><template shadowrootmode="open"><style>
div{display:flex;align-items:center;gap:2px;padding:2px 2px 2px 10px;border:1px solid rgb(0 0 0/.08);border-radius:999px;background:rgb(255 255 255/.85);backdrop-filter:blur(8px);box-shadow:0 1px 3px rgb(0 0 0/.08);font:500 12px/1 system-ui,sans-serif;color:#4b5068;opacity:.75;transition:opacity .15s}
div:hover,div:focus-within{opacity:1}
a{display:flex;align-items:center;gap:6px;color:inherit;text-decoration:none}a:hover b{text-decoration:underline}b{color:#1c1f33}
svg{width:14px;height:14px;flex:none}
button{all:unset;display:grid;place-items:center;width:20px;height:20px;border-radius:999px;cursor:pointer;font-size:14px}button:hover,button:focus-visible{background:rgb(0 0 0/.06)}
@media (prefers-color-scheme:dark){div{border-color:rgb(255 255 255/.1);background:rgb(24 26 40/.85);color:#a9adc4}b{color:#f2f3f8}button:hover,button:focus-visible{background:rgb(255 255 255/.1)}}
</style><div><a href="${REPO_URL}" target="_blank" rel="noopener">${LOGO}Shared with <b>shelf</b></a><button type="button" aria-label="Hide" onclick="this.getRootNode().host.remove()">×</button></div></template></shelf-credit>`;

/** GET /font/<name>.woff2. Public and CORS-open: a sandboxed doc has an opaque origin, so its font request is cross-origin. */
export function font(name: string): Response | undefined {
  const body = FONTS[name];
  return body && new Response(body, { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
}

/**
 * Colour themes: the hue every colour shares, and how much of each colour's chroma it keeps (most hues leave sRGB at full strength; sand is a warm grey on purpose).
 * Mirrored in dashboard/src/index.css and dashboard/src/lib/prefs.ts. Indigo is the default, so it never needs the cookie.
 */
export const PALETTES: Record<string, [hue: number, tint: number]> = {
  indigo: [270, 1],
  violet: [295, 1],
  plum: [325, 1],
  rose: [355, 1],
  sand: [60, 0.3],
  olive: [115, 0.57],
  green: [150, 0.69],
  teal: [200, 0.42],
  ocean: [240, 0.57],
  graphite: [0, 0],
};

/** An OKLCH colour in the page's palette: lightness and chroma for light, then for dark. */
const tinted = (l: number, c: number, dl: number, dc: number) => `light-dark(oklch(${l} calc(${c} * var(--tint)) var(--hue)),oklch(${dl} calc(${dc} * var(--tint)) var(--hue)))`;
const INK = [0.231, 0.062, 0.96, 0.019] as const;
const ACCENT = [0.513, 0.203, 0.773, 0.115] as const;

/**
 * GET /favicon.svg?palette=<name>&theme=<light|dark>: the logo in that palette and theme; without a theme it follows the system.
 * Query parameters, not the cookies, so a cached icon is never the wrong one: the pages put their reader's choice in the link.
 */
export function favicon(url: URL): Response {
  const [hue, tint] = PALETTES[pick(url.searchParams.get("palette"), PALETTES)] ?? PALETTES.indigo;
  const fills = (dark: boolean) => {
    const ok = ([l, c, dl, dc]: readonly number[]) => (dark ? `oklch(${dl} ${+(dc * tint).toFixed(3)} ${hue})` : `oklch(${l} ${+(c * tint).toFixed(3)} ${hue})`);
    return `.i{fill:${ok(INK)}}.a{fill:${ok(ACCENT)}}.as{stroke:${ok(ACCENT)}}`;
  };
  const theme = url.searchParams.get("theme");
  const style = theme === "dark" ? fills(true) : theme === "light" ? fills(false) : `${fills(false)}@media (prefers-color-scheme:dark){${fills(true)}}`;
  return new Response(faviconSvg.replace(/<style>[^<]*<\/style>/, `<style>${style}</style>`), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
}

const face = (name: string, range: string) =>
  `@font-face{font-family:"Bricolage Grotesque Variable";font-weight:200 800;font-stretch:75% 100%;font-display:swap;src:url(/font/${name}.woff2) format("woff2-variations");unicode-range:${range}}`;

export const BASE_CSS = `${face("latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")}
${face("latin-ext", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF")}
:root{color-scheme:light dark;--hue:270;--tint:1;--background:${tinted(0.973, 0.008, 0.23, 0.063)};--foreground:${tinted(...INK)};--card:${tinted(1, 0, 0.281, 0.08)};--primary:var(--foreground);--primary-foreground:${tinted(1, 0, 0.196, 0.06)};--muted:${tinted(0.941, 0.017, 0.34, 0.098)};--muted-foreground:${tinted(0.507, 0.067, 0.722, 0.065)};--destructive:light-dark(#c8341b,#ff7a6b);--border:${tinted(0.873, 0.03, 0.354, 0.088)};--input:${tinted(0.728, 0.053, 0.477, 0.098)};--ring:${tinted(...ACCENT)}}
${Object.entries(PALETTES).map(([name, [hue, tint]]) => `:root[data-palette=${name}]{--hue:${hue};--tint:${tint}}`).join("")}
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:.875rem/1.5 "Bricolage Grotesque Variable",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2,h3,.mark{font-weight:700;font-stretch:78%;letter-spacing:-.025em;line-height:1.05}
a{color:inherit;text-underline-offset:4px}
:focus-visible{outline:3px solid color-mix(in oklab,var(--ring) 50%,transparent);outline-offset:1px}`;

const CARD_CSS = `body{display:grid;place-items:center;min-height:100dvh;padding:1.5rem 1rem}
main{display:grid;gap:1rem;width:100%;max-width:23rem;margin-bottom:8vh}
header{display:flex;align-items:baseline;justify-content:space-between;padding:0 .25rem}
.mark{font-size:1.75rem;line-height:1;color:var(--foreground)}
.card{display:grid;gap:1rem;padding:1.5rem;background:var(--card);border:1px solid var(--border);border-radius:.75rem}
.icon{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:.5rem;background:var(--muted)}
.icon svg{width:1.25rem;height:1.25rem}
h1{font-size:2rem;margin:0 0 .375rem}
p{margin:0;color:var(--muted-foreground)}
form{display:grid;gap:.75rem}
label{display:grid;gap:.375rem;font-size:.75rem;font-weight:600;color:var(--muted-foreground)}
input,button{height:2.25rem;border-radius:.5rem;font:inherit}
input{width:100%;padding:0 .625rem;border:1px solid var(--input);background:transparent;color:var(--foreground);font-size:1rem}
input:focus-visible{border-color:var(--ring)}
input[aria-invalid]{border-color:var(--destructive)}
button{border:0;background:var(--primary);color:var(--primary-foreground);font-weight:600;cursor:pointer}
button:hover{opacity:.85}
.error{color:var(--destructive);font-weight:600}
.foot{padding:0 .25rem;font-size:.8125rem}
.theme{display:flex;gap:.75rem;font-size:.8125rem;color:var(--muted-foreground)}
.theme a{text-decoration:none}.theme a:hover{text-decoration:underline}
.theme [aria-current]{color:var(--foreground);font-weight:600}`;

// Lucide's "lock" and "file-x" icons.
const svg = (paths: string) =>
  `<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg></span>`;
export const LOCK_ICON = svg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');
const MISSING_ICON = svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>');

const THEMES = ["system", "light", "dark"];
/** `value` when it is one of `allowed`'s keys, else "": a cookie or query parameter never reaches the page unchecked. */
const pick = (value: string | null | undefined, allowed: object) => (value && Object.hasOwn(allowed, value) ? value : "");
const cookie = (req: Request, name: string) => req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([a-z]+)(?:;|$)`))?.[1];
const theme = (req: Request) => pick(cookie(req, "theme"), { light: 1, dark: 1 }) || "system";
const palette = (req: Request) => pick(cookie(req, "palette"), PALETTES);
/** ` data-theme="dark" data-palette="teal"` for the <html> tag, from the cookies; without them the page follows the system, in indigo. */
export const themeAttr = (req: Request) => (theme(req) === "system" ? "" : ` data-theme="${theme(req)}"`) + (palette(req) ? ` data-palette="${palette(req)}"` : "");

/** GET /theme/<system|light|dark>?next=<path>: remembers the theme in a cookie and goes back. A link, so the pages need no script. */
export function setTheme(url: URL, value: string): Response | undefined {
  if (!THEMES.includes(value)) return;
  const next = url.searchParams.get("next") ?? "";
  // Only a path on this origin, so the link cannot be used as an open redirect.
  const location = /^\/(?![/\\])/.test(next) ? next : "/";
  return new Response(null, { status: 303, headers: { location, "set-cookie": `theme=${value}; Path=/; Max-Age=${value === "system" ? 0 : 31536000}; SameSite=Lax`, "cache-control": "no-store" } });
}

/**
 * Dark Reader repaints every page it meets, which breaks the palette; these pages have a dark theme of their own. When it shows up
 * (it marks <html> with data-darkreader-mode), switch to dark unless the reader picked a theme or Dark Reader runs in its light mode
 * ("dimmed"), then send it away: the darkreader-lock meta ends its dynamic mode, and its static and filter modes, which ignore
 * the lock, lose their stylesheet. Not kept in the cookie, so the page follows the system again once the extension is off.
 */
const DARK_READER_JS = `(()=>{const r=document.documentElement,off=()=>{if(!r.hasAttribute("data-darkreader-mode"))return;if(!r.dataset.theme&&r.dataset.darkreaderScheme!=="dimmed")r.dataset.theme="dark";for(const id of["dark-reader-style","dark-reader-svg"])document.getElementById(id)?.remove();if(!document.querySelector('meta[name="darkreader-lock"]'))document.head.append(Object.assign(document.createElement("meta"),{name:"darkreader-lock"}))};new MutationObserver(off).observe(r,{attributeFilter:["data-darkreader-mode"]});off()})()`;
/** The Dark Reader script for a page's <head>, early in it so it runs before the page paints. */
export const darkReaderScript = (nonce?: string) => `<script${nonce ? ` nonce="${nonce}"` : ""}>${DARK_READER_JS}</script>`;

/**
 * A small centred card under the wordmark, with the theme switcher below it. `card` and `foot` are trusted HTML: escape anything a user wrote.
 * `formAction` is a CSP source. `back` is where the theme switcher returns to, when that is not the page's own URL.
 */
export function cardPage(req: Request, status: number, title: string, card: string, { foot = "", formAction = "'none'", back = new URL(req.url).pathname } = {}): Response {
  const links = THEMES.map((t) => `<a href="/theme/${t}?next=${encodeURIComponent(back)}"${t === theme(req) ? ' aria-current="true"' : ""}>${t[0].toUpperCase()}${t.slice(1)}</a>`).join("");
  const icon = new URLSearchParams({ ...(palette(req) && { palette: palette(req) }), ...(theme(req) !== "system" && { theme: theme(req) }) });
  const nonce = randomId(22);
  const html = `<!doctype html><html lang="en"${themeAttr(req)}><head><meta charset="utf-8">${darkReaderScript(nonce)}<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.svg?${icon}" type="image/svg+xml"><title>${escapeHtml(title)} · shelf</title>
<style>${BASE_CSS}
${CARD_CSS}</style></head>
<body><main><header><p class="mark">shelf</p><nav class="theme" aria-label="Theme">${links}</nav></header><div class="card">${card}</div>${foot && `<p class="foot">${foot}</p>`}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action ${formAction}; frame-ancestors 'none'`,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

/** "Not found", "expired" and the like: the card for a browser, one line of text for everything else (curl, an agent, a doc's own missing image). */
export function notice(req: Request, status: number, title: string, body: string, foot = ""): Response {
  if (req.headers.get("accept")?.includes("text/html")) return cardPage(req, status, title, `${MISSING_ICON}<div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div>`, { foot });
  return new Response(`${title}. ${body}`, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
}

export const notFound = (req: Request) =>
  notice(req, 404, "Nothing here", "This link doesn't lead to a doc. Check it for typos, or ask whoever sent it for a new one.", `Made with <a href="${REPO_URL}">shelf</a>, open source on GitHub.`);

export const MD_CSS = `${BASE_CSS}
body{font-size:1rem;line-height:1.65}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 5rem;overflow-wrap:break-word}
h1{font-size:2.75rem;margin:0 0 1.25rem}h2{font-size:1.875rem;margin:2.5rem 0 .75rem}h3{font-size:1.375rem;margin:2rem 0 .5rem}h4,h5,h6{margin:1.5rem 0 .5rem}
p,ul,ol,pre,table,blockquote{margin:0 0 1rem}
a{color:var(--ring)}
img{max-width:100%}
code{font:.875em ui-monospace,SFMono-Regular,Menlo,monospace;padding:.125rem .3125rem;border-radius:.25rem;background:var(--muted)}
pre{overflow:auto;padding:.875rem 1rem;border:1px solid var(--border);border-radius:.75rem;background:var(--card)}
pre code{padding:0;background:none}
table{display:block;width:max-content;max-width:100%;overflow-x:auto;border-collapse:collapse}
th,td{border:1px solid var(--border);padding:.375rem .75rem;text-align:left}
th{background:var(--muted);font-weight:600}
blockquote{padding:.125rem 0 .125rem 1rem;border-left:3px solid var(--input);color:var(--muted-foreground)}
blockquote>:last-child{margin-bottom:0}
hr{margin:2rem 0;border:0;border-top:1px solid var(--border)}`;
