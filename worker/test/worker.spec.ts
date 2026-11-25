import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/util";
import { cleanupStatus, sweep } from "../src/api";
import worker from "../src";

const BASE = "https://shelf.test";
const AUTH = { authorization: "Bearer sk_test" };

const api = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(`${BASE}${path}`, { ...init, headers: { ...AUTH, ...init.headers } });

const pushManifest = (body: object) =>
  api("/api/push", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

/** Full client flow: push, upload what is missing, push again. */
async function publish(files: Record<string, string>, extra: object = {}) {
  const manifest = await Promise.all(Object.entries(files).map(async ([path, s]) => ({ path, sha256: await sha256Hex(s) })));
  const first = (await (await pushManifest({ ...extra, files: manifest })).json()) as { missing?: string[] };
  for (const sha of first.missing ?? []) {
    const entry = manifest.find((f) => f.sha256 === sha)!;
    expect((await api(`/api/blobs/${sha}`, { method: "PUT", body: files[entry.path] })).status).toBe(204);
  }
  const res = await pushManifest({ ...extra, files: manifest });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; slug: string | null; version: number; url: string; versionUrl: string; created: boolean; expiresAt: number | null };
}

describe("api auth", () => {
  it("rejects missing and wrong keys", async () => {
    expect((await exports.default.fetch(`${BASE}/api/push`, { method: "POST" })).status).toBe(401);
    expect((await api("/api/push", { method: "POST", headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });
});

describe("push", () => {
  it("reports missing blobs, then commits once they are uploaded", async () => {
    const sha = await sha256Hex("<h1>hi</h1>");
    const res = await pushManifest({ files: [{ path: "a.html", sha256: sha }] });
    expect(await res.json()).toEqual({ missing: [sha] });

    const doc = await publish({ "a.html": "<h1>hi</h1>" });
    expect(doc.version).toBe(1);
    expect(doc.url).toBe(`${BASE}/view/${doc.id}`);
    expect(doc.id).toMatch(/^[0-9a-z]{12}$/);
  });

  it("rejects a blob whose bytes do not match its hash", async () => {
    const res = await api(`/api/blobs/${await sha256Hex("real")}`, { method: "PUT", body: "fake" });
    expect(res.status).toBe(400);
  });

  it("rejects path traversal and absolute paths", async () => {
    const sha = await sha256Hex("x");
    for (const path of ["../x", "/x", "a//b", "a/./b"]) {
      expect((await pushManifest({ files: [{ path, sha256: sha }] })).status).toBe(400);
    }
  });

  it("adds a version on re-push and serves the latest", async () => {
    const v1 = await publish({ "p.html": "one" });
    const v2 = await publish({ "p.html": "two" }, { ref: v1.id });
    expect(v2).toMatchObject({ id: v1.id, version: 2 });
    const res = await exports.default.fetch(v1.url);
    expect(await res.text()).toBe("two");
    expect(res.headers.get("x-shelf-version")).toBe("2");
  });

  it("404s on an unknown ref", async () => {
    expect((await pushManifest({ ref: "nope", files: [{ path: "a", sha256: await sha256Hex("") }] })).status).toBe(404);
  });
});

describe("view", () => {
  it("sandboxes html and svg, without allow-same-origin", async () => {
    for (const path of ["doc.html", "pic.svg"]) {
      const { url } = await publish({ [path]: `<svg>${path}</svg>` });
      const res = await exports.default.fetch(url);
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("sandbox allow-scripts");
      expect(csp).not.toContain("allow-same-origin");
      expect(csp).toContain("connect-src 'none'");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  it("serves pdf inline without csp, unknown types as downloads", async () => {
    const pdf = await exports.default.fetch((await publish({ "r.pdf": "%PDF" })).url);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-security-policy")).toBeNull();

    const zip = await exports.default.fetch((await publish({ "my file.zip": "PK" })).url);
    expect(zip.headers.get("content-type")).toBe("application/octet-stream");
    expect(zip.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''my%20file.zip");
  });

  it("answers range requests with 206", async () => {
    const { url } = await publish({ "v.mp4": "0123456789" });
    const res = await exports.default.fetch(url, { headers: { range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
  });

  it("404s on unknown docs", async () => {
    expect((await exports.default.fetch(`${BASE}/view/doesnotexist`)).status).toBe(404);
  });
});

// Redirects are part of what we test, so never follow them.
const get = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(path.startsWith("http") ? path : `${BASE}${path}`, { redirect: "manual", ...init });

describe("versions", () => {
  it("does not create a version for identical content", async () => {
    const a = await publish({ "same.html": "same" });
    const b = await publish({ "same.html": "same" }, { ref: a.id });
    expect(b).toMatchObject({ id: a.id, version: 1, created: false });
  });

  it("pins old versions with @n", async () => {
    const v1 = await publish({ "pin.html": "first" });
    await publish({ "pin.html": "second" }, { ref: v1.id });
    const res = await get(v1.versionUrl);
    expect(await res.text()).toBe("first");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await get(`/view/${v1.id}@9`)).status).toBe(404);
  });

  it("disables old versions and turns them back on, but never the current one", async () => {
    const v1 = await publish({ "off.html": "first" });
    const v2 = await publish({ "off.html": "second" }, { ref: v1.id });
    const patch = (body: object) => api(`/api/docs/${v1.id}/versions`, { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch({ versions: [2], disabled: true })).status).toBe(400);
    expect((await patch({ versions: [1, 9], disabled: true })).status).toBe(404);
    expect((await get(v1.versionUrl)).status).toBe(200);

    expect((await patch({ versions: [1], disabled: true })).status).toBe(204);
    expect((await get(v1.versionUrl)).status).toBe(410);
    expect(await (await get(v2.url)).text()).toBe("second");
    const detail = (await (await api(`/api/docs/${v1.id}`)).json()) as { versions: { n: number; disabled: boolean }[] };
    expect(detail.versions.map((v) => [v.n, v.disabled])).toEqual([[2, false], [1, true]]);

    expect((await patch({ versions: [1], disabled: false })).status).toBe(204);
    expect(await (await get(v1.versionUrl)).text()).toBe("first");
  });
});

describe("folders", () => {
  const site = {
    "index.html": "home",
    "style.css": "body{}",
    "guide.html": "guide",
    "docs/index.html": "docs home",
    "img/a b.png": "png",
  };

  it("serves under a trailing slash with clean urls", async () => {
    const { id } = await publish(site);
    const root = await get(`/view/${id}`);
    expect(root.status).toBe(301);
    expect(root.headers.get("location")).toBe(`${BASE}/view/${id}/`);
    expect(await (await get(`/view/${id}/`)).text()).toBe("home");
    expect(await (await get(`/view/${id}/guide`)).text()).toBe("guide");
    expect(await (await get(`/view/${id}/guide.html`)).text()).toBe("guide");
    expect((await get(`/view/${id}/docs`)).headers.get("location")).toBe(`${BASE}/view/${id}/docs/`);
    expect(await (await get(`/view/${id}/docs/`)).text()).toBe("docs home");
    expect((await get(`/view/${id}/style.css`)).headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await (await get(`/view/${id}/img/a%20b.png`)).text()).toBe("png");
    expect((await get(`/view/${id}/nope`)).status).toBe(404);
  });

  it("requires an index.html", async () => {
    const files = [{ path: "a.html", sha256: await sha256Hex("a") }, { path: "b.html", sha256: await sha256Hex("b") }];
    expect((await pushManifest({ files })).status).toBe(400);
  });
});

describe("slugs and passwords", () => {
  it("refuses a slug without a password", async () => {
    const res = await pushManifest({ slug: "no-pass", files: [{ path: "a", sha256: await sha256Hex("a") }] });
    expect(res.status).toBe(400);
  });

  it("publishes at the slug, and the same slug updates the same doc", async () => {
    const a = await publish({ "s.html": "one" }, { slug: "my-plan", password: "hunter22" });
    expect(a.url).toBe(`${BASE}/view/my-plan`);
    const b = await publish({ "s.html": "two" }, { slug: "my-plan" });
    expect(b).toMatchObject({ id: a.id, version: 2 });
    const taken = await pushManifest({ slug: "my-plan", password: "hunter22", ref: (await publish({ "o.html": "o" })).id, files: [{ path: "o.html", sha256: await sha256Hex("o") }] });
    expect(taken.status).toBe(409);
  });

  it("matches slugs case-insensitively and stores them lowercase", async () => {
    const a = await publish({ "c.html": "case" }, { slug: "Case-Plan", password: "hunter22" });
    expect(a.slug).toBe("case-plan");
    expect((await get("/view/CASE-plan", { headers: { "x-doc-password": "hunter22" } })).status).toBe(200);
    expect(await (await api("/api/docs/CASE-PLAN")).json()).toMatchObject({ id: a.id });
    expect(await publish({ "c.html": "case 2" }, { slug: "case-PLAN" })).toMatchObject({ id: a.id, version: 2 });
  });

  it("opens a doc by its id in any case", async () => {
    const a = await publish({ "i.html": "ids" });
    expect(a.id).toBe(a.id.toLowerCase());
    expect((await get(`/view/${a.id.toUpperCase()}`)).status).toBe(200);
    expect(await (await api(`/api/docs/${a.id.toUpperCase()}`)).json()).toMatchObject({ id: a.id });
  });

  it("migration lowercases existing mixed-case ids with their versions and files", async () => {
    const db = env.DB;
    await db.batch([
      db.prepare("INSERT INTO docs (id, latest, created_at, updated_at) VALUES ('ZQIZ4KHAUHBn', 1, 0, 0)"),
      db.prepare("INSERT INTO versions (doc_id, n, manifest_hash, size, created_at) VALUES ('ZQIZ4KHAUHBn', 1, 'm', 1, 0)"),
      db.prepare("INSERT INTO files (doc_id, n, path, sha256, size) VALUES ('ZQIZ4KHAUHBn', 1, 'a.html', 'h', 1)"),
    ]);
    const m = env.TEST_MIGRATIONS.find((x) => x.name.startsWith("0002"))!;
    await db.batch(m.queries.map((q) => db.prepare(q)));
    expect(await db.prepare("SELECT COUNT(*) AS c FROM files WHERE doc_id = 'zqiz4khauhbn'").first("c")).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM versions WHERE doc_id = 'zqiz4khauhbn'").first("c")).toBe(1);
    expect(await db.prepare("SELECT id FROM docs WHERE id = 'zqiz4khauhbn'").first("id")).toBe("zqiz4khauhbn");
  });

  it("refuses removing the password while a slug is set", async () => {
    await publish({ "k.html": "k" }, { slug: "keep-pass", password: "hunter22" });
    expect((await api("/api/docs/keep-pass", { method: "PATCH", body: JSON.stringify({ password: null }) })).status).toBe(400);
  });

  it("answers a missing doc with a page for browsers and plain text for everything else", async () => {
    const page = await get("/view/nope", { headers: { accept: "text/html,*/*" } });
    expect(page.status).toBe(404);
    expect(page.headers.get("content-type")).toContain("text/html");
    const plain = await get("/view/nope");
    expect(plain.status).toBe(404);
    expect(plain.headers.get("content-type")).toContain("text/plain");
    // The page's font, which a sandboxed doc (opaque origin) can only load with CORS.
    const font = await get("/font/latin.woff2");
    expect(font.headers.get("access-control-allow-origin")).toBe("*");
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
  });

  it("remembers a theme picked on one of its own pages and renders them in it", async () => {
    const set = await get("/theme/dark?next=/view/nope", { redirect: "manual" });
    expect(set.status).toBe(303);
    expect(set.headers.get("location")).toBe("/view/nope");
    expect(set.headers.get("set-cookie")).toMatch(/^theme=dark;/);
    const page = await get("/view/nope", { headers: { accept: "text/html", cookie: "theme=dark" } });
    expect(await page.text()).toContain('<html lang="en" data-theme="dark">');
    // Never a redirect off this origin, and never an attribute from a cookie it did not write.
    for (const next of ["//evil.example", "/\\evil.example", "https://evil.example"]) {
      expect((await get(`/theme/light?next=${encodeURIComponent(next)}`, { redirect: "manual" })).headers.get("location")).toBe("/");
    }
    const forged = await get("/view/nope", { headers: { accept: "text/html", cookie: 'theme=dark"><script>' } });
    expect(await forged.text()).toContain('<html lang="en">');
  });

  it("renders its pages and the favicon in the palette picked in the dashboard", async () => {
    const page = await (await get("/view/nope", { headers: { accept: "text/html", cookie: "theme=dark; palette=teal" } })).text();
    expect(page).toContain('<html lang="en" data-theme="dark" data-palette="teal">');
    expect(page).toContain('href="/favicon.svg?palette=teal&theme=dark"');
    // Only a palette the Worker knows, never one from the prototype.
    expect(await (await get("/view/nope", { headers: { accept: "text/html", cookie: "palette=constructor" } })).text()).toContain('<html lang="en">');
    const icon = await (await get("/favicon.svg?palette=teal&theme=dark")).text();
    expect(icon).toContain(".a{fill:oklch(0.773 0.048 200)}");
    expect(icon).not.toContain("prefers-color-scheme");
    expect(await (await get("/favicon.svg")).text()).toContain("@media (prefers-color-scheme:dark){.i{fill:oklch(0.96 0.019 270)}");
  });

  it("locks a doc until the password is given by header or form", async () => {
    const { id } = await publish({ "lock.html": "secret" }, { password: "hunter22" });
    const locked = await get(`/view/${id}`);
    expect(locked.status).toBe(401);
    expect(await locked.text()).not.toContain("secret");

    expect((await get(`/view/${id}`, { headers: { "x-doc-password": "wrongpass" } })).status).toBe(401);
    const ok = await get(`/view/${id}`, { headers: { "x-doc-password": "hunter22" } });
    expect(await ok.text()).toBe("secret");
    expect(ok.headers.get("cache-control")).toBe("private, no-store");

    const form = new FormData();
    form.set("password", "hunter22");
    form.set("next", "https://evil.example/");
    const unlocked = await get(`/view/${id}/unlock`, { method: "POST", body: form });
    expect(unlocked.status).toBe(303);
    expect(unlocked.headers.get("location")).toBe(`/view/${id}`);
    const cookie = unlocked.headers.get("set-cookie")!.split(";")[0];
    expect(await (await get(`/view/${id}@1`, { headers: { cookie } })).text()).toBe("secret");

    // Changing the password invalidates cookies issued for the old one.
    await api(`/api/docs/${id}`, { method: "PATCH", body: JSON.stringify({ password: "newpass99" }) });
    expect((await get(`/view/${id}`, { headers: { cookie } })).status).toBe(401);
  });

  it("rate-limits password attempts", async () => {
    const { id } = await publish({ "rl.html": "rl" }, { password: "hunter22" });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await get(`/view/${id}`, { headers: { "x-doc-password": "wrongpass" } })).status);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("markdown", () => {
  it("renders to sandboxed html, ?raw returns the source", async () => {
    const { url } = await publish({ "notes.md": "# Hello\n\n<script>x()</script>" });
    const res = await get(url);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    const html = await res.text();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toContain("<shelf-credit"); // not a browser
    const browser = (u: string) => get(u, { headers: { accept: "text/html" } });
    const badged = await (await browser(url)).text();
    expect(badged).toContain("<shelf-credit");
    // No request of its own: behind Access, a sandboxed doc's fetch of /favicon.svg gets the login redirect.
    expect(badged.slice(badged.indexOf("<shelf-credit"))).not.toMatch(/src="\//);
    const page = await publish({ "page.html": "<p>hi</p>" });
    expect(await (await get(page.url)).text()).toBe("<p>hi</p>");
    expect(await (await browser(page.url)).text()).toMatch(/^<p>hi<\/p><shelf-credit/);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('credit', '0')").run();
    try {
      expect(await (await browser(url)).text()).not.toContain("<shelf-credit");
      expect(await (await browser(page.url)).text()).toBe("<p>hi</p>");
    } finally {
      await env.DB.prepare("DELETE FROM settings WHERE key = 'credit'").run();
    }
    const raw = await get(`${url}?raw`);
    expect(raw.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await raw.text()).toBe("# Hello\n\n<script>x()</script>");
  });
});

describe("expiry, delete and sweep", () => {
  it("serves 410 after expiry, and the sweep deletes the doc", async () => {
    const { id } = await publish({ "exp.html": "exp" }, { expires: "1h" });
    expect((await get(`/view/${id}`)).status).toBe(200);
    await env.DB.prepare("UPDATE docs SET expires_at = 1 WHERE id = ?").bind(id).run();
    expect((await get(`/view/${id}`)).status).toBe(410);
    expect((await cleanupStatus(env)).expired).toBeGreaterThanOrEqual(1);
    expect((await sweep(env)).docs).toBeGreaterThanOrEqual(1);
    expect((await cleanupStatus(env)).expired).toBe(0);
    expect((await get(`/view/${id}`)).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS c FROM files WHERE doc_id = ?").bind(id).first("c")).toBe(0);
  });

  it("caps expiry at 30 days and treats 0 as never", async () => {
    const { id } = await publish({ "cap.html": "cap" }, { expires: "30d" });
    const patch = (expires: unknown) => api(`/api/docs/${id}`, { method: "PATCH", body: JSON.stringify({ expires }) });
    const expiresAt = async () => ((await (await api(`/api/docs/${id}`)).json()) as { expiresAt: number | null }).expiresAt;
    expect(await expiresAt()).not.toBeNull();
    for (const bad of ["31d", "721h", "5w", "5", "1.5d"]) expect((await patch(bad)).status).toBe(400);
    expect((await patch("0d")).status).toBe(200);
    expect(await expiresAt()).toBeNull();
    expect((await patch("90m")).status).toBe(200);
    expect(await expiresAt()).not.toBeNull();
    expect((await patch("0")).status).toBe(200);
    expect(await expiresAt()).toBeNull();
  });

  it("deletes docs, and the sweep removes only blobs nothing references", async () => {
    const shared = await publish({ "keep.html": "shared bytes" });
    const gone = await publish({ "index.html": "shared bytes", "only.txt": "only here" });
    expect((await api(`/api/docs/${gone.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await get(`/view/${gone.id}/`)).status).toBe(404);

    const run = await sweep(env, Date.now() + 2 * 86_400_000, "manual");
    expect(run.trigger).toBe("manual");
    expect(run.blobs).toBeGreaterThanOrEqual(1);
    expect(run.bytes).toBeGreaterThanOrEqual("only here".length);
    expect((await cleanupStatus(env)).runs[0]).toEqual(run);
    expect(await env.BUCKET.head(`docs/${await sha256Hex("only here")}`)).toBeNull();
    expect(await env.BUCKET.head(`docs/${await sha256Hex("shared bytes")}`)).not.toBeNull();
    expect(await (await get(shared.url)).text()).toBe("shared bytes");
  });

  it("records the schedule the cron ran on, so a trigger changed in Cloudflare shows", async () => {
    await worker.scheduled!({ cron: "45 6 * * *", scheduledTime: Date.now(), noRetry() { } } as ScheduledController, env);
    expect((await cleanupStatus(env)).runs[0]).toMatchObject({ trigger: "daily", cron: "45 6 * * *" });
  });

  it("records a failed cleanup with what it deleted before, and keeps the last 10 runs", async () => {
    const { id } = await publish({ "fail.html": "fail" });
    await env.DB.prepare("UPDATE docs SET expires_at = 1 WHERE id = ?").bind(id).run();
    vi.spyOn(env.BUCKET, "list").mockRejectedValueOnce(new Error("R2 is down"));
    const failed = await sweep(env);
    expect(failed).toMatchObject({ trigger: "daily", error: "R2 is down", blobs: 0 });
    expect(failed.docs).toBeGreaterThanOrEqual(1);
    expect((await cleanupStatus(env)).runs[0]).toEqual(failed);
    for (let i = 0; i < 10; i++) await sweep(env, Date.now(), "manual");
    const { runs } = await cleanupStatus(env);
    expect(runs).toHaveLength(10);
    expect(runs.every((r) => r.trigger === "manual" && !r.error)).toBe(true);
  });
});

describe("docs api", () => {
  it("lists favorites first and shows version history", async () => {
    const fav = await publish({ "fav.html": "fav" });
    await publish({ "fav.html": "fav 2" }, { ref: fav.id, message: "second" });
    await api(`/api/docs/${fav.id}`, { method: "PATCH", body: JSON.stringify({ favorite: true }) });
    await publish({ "newer.html": "newer" });

    const list = (await (await api("/api/docs")).json()) as { id: string }[];
    expect(list[0].id).toBe(fav.id);
    const detail = (await (await api(`/api/docs/${fav.id}`)).json()) as { favorite: boolean; versions: { n: number; message: string | null; keyName: string }[] };
    expect(detail.favorite).toBe(true);
    expect(detail.versions.map((v) => [v.n, v.message, v.keyName])).toEqual([[2, "second", "test"], [1, null, "test"]]);
  });

  it("lists uploads across docs, newest first", async () => {
    const a = await publish({ "a.html": "one" });
    const b = await publish({ "index.html": "two", "b.css": "b{}" });
    await publish({ "a.html": "one, edited" }, { ref: a.id, message: "edit" });

    const uploads = (await (await api("/api/uploads")).json()) as { docId: string; n: number; message: string | null; keyName: string; files: number }[];
    expect(uploads.slice(0, 3).map((u) => [u.docId, u.n, u.message, u.keyName, u.files])).toEqual([
      [a.id, 2, "edit", "test", 1],
      [b.id, 1, null, "test", 2],
      [a.id, 1, null, "test", 1],
    ]);
  });

  it("groups docs into projects that exist while a doc names them", async () => {
    const a = await publish({ "a.html": "plan" }, { project: " Billing-POC " });
    // Another case joins the same project; a new version without one keeps it.
    const b = await publish({ "b.html": "notes" }, { project: "billing-poc" });
    await publish({ "a.html": "plan v2" }, { ref: a.id });
    await publish({ "c.html": "other" }, { project: "search" });
    const list = async (q: string) => ((await (await api(`/api/docs${q}`)).json()) as { id: string; project: string | null }[]).map((d) => [d.id, d.project]);
    expect(await list("?project=BILLING-poc")).toEqual([[a.id, "Billing-POC"], [b.id, "Billing-POC"]]);

    const mcp = (await (await exports.default.fetch(`${BASE}/mcp`, { method: "POST", headers: AUTH, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_docs", arguments: { project: "search" } } }) })).json()) as { result: { content: { text: string }[] } };
    expect((JSON.parse(mcp.result.content[0].text) as { project: string }[]).map((d) => d.project)).toEqual(["search"]);

    expect(await (await api(`/api/docs/${b.id}`, { method: "PATCH", body: JSON.stringify({ project: "" }) })).json()).toMatchObject({ project: null });
    expect(await list("?project=billing-poc")).toEqual([[a.id, "Billing-POC"]]);
    expect((await api(`/api/docs/${a.id}`, { method: "PATCH", body: JSON.stringify({ project: "x".repeat(65) }) })).status).toBe(400);
  });

  it("changes and deletes many docs in one call, all or nothing", async () => {
    const a = await publish({ "a.html": "bulk a" });
    const b = await publish({ "b.html": "bulk b" }, { slug: "bulk-b", password: "hunter2hunter2" });
    const bulk = (body: object) => api("/api/docs/bulk", { method: "POST", body: JSON.stringify(body) });

    const changed = (await (await bulk({ ids: [a.id, "BULK-B"], favorite: true, project: "Batch" })).json()) as { id: string; favorite: boolean; project: string }[];
    expect(changed.map((d) => [d.id, d.favorite, d.project]).sort()).toEqual([[a.id, true, "Batch"], [b.id, true, "Batch"]].sort());
    // A setting that belongs to one doc, and a missing doc, both refuse the whole call.
    expect((await bulk({ ids: [a.id], slug: "nope" })).status).toBe(400);
    expect((await bulk({ ids: [a.id, "no-such-doc"], delete: true })).status).toBe(404);
    expect((await api(`/api/docs/${a.id}`)).status).toBe(200);

    expect((await bulk({ ids: [a.id, "bulk-b"], delete: true })).status).toBe(204);
    expect((await api(`/api/docs/${a.id}`)).status).toBe(404);
    expect((await api(`/api/docs/${b.id}`)).status).toBe(404);
  });
});

describe("dashboard", () => {
  /** Calls the worker as if Cloudflare Access had signed `email` in. */
  async function dash(path: string, init: RequestInit = {}) {
    const ctx = createExecutionContext();
    Object.defineProperty(ctx, "access", { value: { aud: "test", getIdentity: async () => ({ email: "me@example.com" }) } });
    const res = await worker.fetch(new Request(`${BASE}${path}`, { redirect: "manual", ...init }) as Parameters<typeof worker.fetch>[0], env, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  }
  const sameOrigin = { origin: BASE, "content-type": "application/json" };

  it("refuses requests that did not pass Cloudflare Access", async () => {
    expect((await get("/dashboard")).status).toBe(403);
    expect((await get("/dashboard/api/docs")).status).toBe(403);
  });

  it("accepts a valid Access JWT on previews, where ctx.access is unset", async () => {
    const team = "team.cloudflareaccess.com";
    const aud = "preview-aud";
    const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
    const pair = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ keys: [jwk] }));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const enc = (o: object) => b64(new TextEncoder().encode(JSON.stringify(o)));
    const sign = async (claims: object) => {
      const input = `${enc({ alg: "RS256", kid: "k1" })}.${enc(claims)}`;
      return `${input}.${b64(new Uint8Array(await crypto.subtle.sign(alg, pair.privateKey, new TextEncoder().encode(input))))}`;
    };
    const valid = { iss: `https://${team}`, aud: [aud], email: "me@example.com", exp: Date.now() / 1000 + 60 };
    const me = async (token: string) => {
      const ctx = createExecutionContext();
      const req = new Request(`${BASE}/dashboard/api/me`, { headers: { "cf-access-jwt-assertion": token } });
      return worker.fetch(req as Parameters<typeof worker.fetch>[0], { ...env, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } as Env, ctx);
    };
    try {
      const ok = await me(await sign(valid));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ email: "me@example.com" });
      for (const bad of [{ aud: ["other-app"] }, { exp: Date.now() / 1000 - 1 }, { iss: "https://evil.cloudflareaccess.com" }]) {
        expect((await me(await sign({ ...valid, ...bad }))).status).toBe(403);
      }
      const [h, , s] = (await sign(valid)).split(".");
      expect((await me(`${h}.${enc({ ...valid, email: "evil@example.com" })}.${s}`)).status).toBe(403);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("serves the page with a per-request script nonce", async () => {
    const res = await dash("/dashboard");
    const nonce = res.headers.get("content-security-policy")!.match(/'nonce-([^']+)'/)![1];
    expect(await res.text()).toMatch(new RegExp(`<script[^>]*\\snonce="${nonce}"`));
    expect((await dash("/dashboard/api/me").then((r) => r.json())) as object).toEqual({ email: "me@example.com" });
  });

  it("refuses cross-origin writes, including from sandboxed docs", async () => {
    for (const origin of ["https://evil.example", "null"]) {
      const res = await dash("/dashboard/api/keys", { method: "POST", headers: { origin }, body: JSON.stringify({ name: "x" }) });
      expect(res.status).toBe(403);
    }
  });

  it("mints keys that work until revoked", async () => {
    const { id, key } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "laptop" }) })).json()) as { id: string; key: string };
    const withKey = () => exports.default.fetch(`${BASE}/api/docs`, { headers: { authorization: `Bearer ${key}` } });
    expect((await withKey()).status).toBe(200);
    const keys = (await (await dash("/dashboard/api/keys")).json()) as { id: string; name: string }[];
    expect(keys.find((k) => k.id === id)?.name).toBe("laptop");
    expect((await dash(`/dashboard/api/keys/${id}/revoke`, { method: "POST", headers: sameOrigin })).status).toBe(204);
    expect((await withKey()).status).toBe(401);
  });

  it("deletes a key only once revoked, and keeps its uploads", async () => {
    const { id, key } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "old" }) })).json()) as { id: string; key: string };
    const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    const sha = await sha256Hex("by old");
    await exports.default.fetch(`${BASE}/api/blobs/${sha}`, { method: "PUT", headers: { ...auth, "content-length": "6" }, body: "by old" });
    const pushed = (await (await exports.default.fetch(`${BASE}/api/push`, { method: "POST", headers: auth, body: JSON.stringify({ files: [{ path: "old.html", sha256: sha }] }) })).json()) as { id: string };
    const del = () => dash(`/dashboard/api/keys/${id}`, { method: "DELETE", headers: sameOrigin });

    expect((await del()).status).toBe(404); // still active
    await dash(`/dashboard/api/keys/${id}/revoke`, { method: "POST", headers: sameOrigin });
    expect((await del()).status).toBe(204);
    expect((await dash(`/dashboard/api/keys/${id}`)).status).toBe(404);
    expect(((await (await dash("/dashboard/api/keys")).json()) as { id: string }[]).some((k) => k.id === id)).toBe(false);
    const detail = (await (await dash(`/dashboard/api/docs/${pushed.id}`)).json()) as { versions: { keyId: string | null; keyName: string | null }[] };
    expect(detail.versions).toMatchObject([{ keyId: id, keyName: null }]);
  });

  it("shows a key with totals per doc and its uploads", async () => {
    const { id, key } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "ci" }) })).json()) as { id: string; key: string };
    const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    const sha = await sha256Hex("by ci");
    await exports.default.fetch(`${BASE}/api/blobs/${sha}`, { method: "PUT", headers: { ...auth, "content-length": "5" }, body: "by ci" });
    const pushed = (await (await exports.default.fetch(`${BASE}/api/push`, { method: "POST", headers: auth, body: JSON.stringify({ files: [{ path: "ci.html", sha256: sha }] }) })).json()) as { id: string };
    await publish({ "ci.html": "by test" }, { ref: pushed.id, message: "not ci's" }); // the test key's upload stays off ci's page
    const sha2 = await sha256Hex("by ci again");
    await exports.default.fetch(`${BASE}/api/blobs/${sha2}`, { method: "PUT", headers: { ...auth, "content-length": "11" }, body: "by ci again" });
    await exports.default.fetch(`${BASE}/api/push`, { method: "POST", headers: auth, body: JSON.stringify({ ref: pushed.id, message: "again", files: [{ path: "ci.html", sha256: sha2 }] }) });

    const k = (await (await dash(`/dashboard/api/keys/${id}`)).json()) as { name: string; docs: object[]; uploads: { n: number; message: string | null; keyName: string; createdAt: number }[]; times: number[] };
    expect(k.name).toBe("ci");
    expect(k.docs).toEqual([{ docId: pushed.id, uploads: 2, created: 1, size: 16, firstAt: expect.any(Number), lastAt: expect.any(Number) }]);
    expect(k.uploads.map((u) => [u.n, u.message, u.keyName])).toEqual([[3, "again", "ci"], [1, null, "ci"]]);
    expect(k.times.sort()).toEqual(k.uploads.map((u) => u.createdAt).sort());
    expect((await dash("/dashboard/api/keys/k_nope")).status).toBe(404);
    expect((await api(`/api/keys/${id}`)).status).toBe(404); // dashboard only
  });

  it("adds up every key's uploads per day and space, and finds docs more than one uploader shares", async () => {
    const { id, key } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "stats" }) })).json()) as { id: string; key: string };
    const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
    const sha = await sha256Hex("by stats");
    await exports.default.fetch(`${BASE}/api/blobs/${sha}`, { method: "PUT", headers: { ...auth, "content-length": "8" }, body: "by stats" });
    const pushed = (await (await exports.default.fetch(`${BASE}/api/push`, { method: "POST", headers: auth, body: JSON.stringify({ files: [{ path: "s.html", sha256: sha }] }) })).json()) as { id: string };
    await publish({ "s.html": "by test, after stats" }, { ref: pushed.id });
    const at = ((await (await dash(`/dashboard/api/keys/${id}`)).json()) as { times: number[] }).times[0];

    // UTC+14: the day the upload falls on there, not in UTC.
    const a = (await (await dash("/dashboard/api/analytics?tz=-840")).json()) as {
      days: { keyId: string | null; space: string; day: number; uploads: number }[];
      keys: { keyId: string | null; space: string; uploads: number; docs: number; size: number; lastAt: number }[];
      shared: { docId: string; keyId: string | null; uploads: number }[];
    };
    expect(a.days.filter((d) => d.keyId === id)).toEqual([{ keyId: id, space: "default", day: Math.floor((at + 840 * 60_000) / 86_400_000), uploads: 1 }]);
    expect(a.keys.filter((k) => k.keyId === id)).toEqual([{ keyId: id, space: "default", uploads: 1, docs: 1, size: 8, lastAt: at }]);
    // id is random, so it can sort either side of "k_test": sort both.
    expect(a.shared.filter((s) => s.docId === pushed.id).map((s) => [s.keyId, s.uploads]).sort()).toEqual([[id, 1], ["k_test", 1]].sort());
    expect((await dash("/dashboard/api/analytics?tz=1.5")).status).toBe(400);
    expect((await api("/api/analytics")).status).toBe(404); // dashboard only
  });

  /** A new key with a quota, and a push of one file through it: the client flow, stopping at the first refusal. */
  async function quotaKey(quota: unknown, strategy: string) {
    const { id, key } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "q" }) })).json()) as { id: string; key: string };
    const set = await dash(`/dashboard/api/keys/${id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ quota, strategy }) });
    const auth = { authorization: `Bearer ${key}` };
    const push = async (content: string, extra: object = {}) => {
      const body = JSON.stringify({ ...extra, files: [{ path: "q.html", sha256: await sha256Hex(content) }] });
      const send = () => exports.default.fetch(`${BASE}/api/push`, { method: "POST", headers: auth, body });
      const first = await send();
      const { missing } = (await first.clone().json()) as { missing?: string[] };
      if (!missing) return first;
      const put = await exports.default.fetch(`${BASE}/api/blobs/${missing[0]}`, { method: "PUT", headers: { ...auth, "content-length": String(content.length) }, body: content });
      return put.status === 204 ? send() : put;
    };
    return { id, set, push };
  }
  const ok = async (res: Response) => {
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; version: number; created: boolean };
  };

  it("validates and shows a key's quota", async () => {
    expect((await quotaKey(0, "reject")).set.status).toBe(400);
    expect((await quotaKey(10, "lifo")).set.status).toBe(400);
    const { id, set } = await quotaKey(10, "fifo");
    expect(set.status).toBe(204);
    expect(await (await dash(`/dashboard/api/keys/${id}`)).json()).toMatchObject({ quota: 10, strategy: "fifo" });
    expect((await dash(`/dashboard/api/keys/${id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ quota: null }) })).status).toBe(204);
    expect(await (await dash(`/dashboard/api/keys/${id}`)).json()).toMatchObject({ quota: null, strategy: "fifo" });
  });

  it("refuses uploads over a key's quota under reject", async () => {
    const { push } = await quotaKey(10, "reject");
    const a = await ok(await push("reject-1")); // 8 of 10 bytes
    expect((await push("reject-2")).status).toBe(413); // its blob doesn't fit the 2 bytes left
    expect((await push("reject-1")).status).toBe(413); // the blob is there, but a new doc with it doesn't fit
    expect(await ok(await push("reject-1", { ref: a.id }))).toMatchObject({ created: false }); // identical content costs nothing
  });

  it("deletes a key's oldest uploads under fifo, keeping favorites and others' docs intact", async () => {
    const { push } = await quotaKey(20, "fifo");
    expect((await push("x".repeat(21))).status).toBe(413); // bigger than the whole quota
    const a = await ok(await push("fifo-aaa")); // 8 bytes each
    const b = await ok(await push("fifo-bbb"));
    await api(`/api/docs/${b.id}`, { method: "PATCH", body: JSON.stringify({ favorite: true }) });
    const c = await ok(await push("fifo-ccc"));
    expect((await api(`/api/docs/${a.id}`)).status).toBe(404); // the oldest went with its only version
    const d = await ok(await push("fifo-ddd"));
    expect((await api(`/api/docs/${b.id}`)).status).toBe(200); // a favorite stays
    expect((await api(`/api/docs/${c.id}`)).status).toBe(404);

    // A new version of a full key's doc replaces the doc's older one.
    expect(await ok(await push("fifo-eee", { ref: d.id }))).toMatchObject({ id: d.id, version: 2 });
    const detail = (await (await api(`/api/docs/${d.id}`)).json()) as { versions: { n: number }[] };
    expect(detail.versions.map((v) => v.n)).toEqual([2]);
    expect(await (await exports.default.fetch(`${BASE}/view/${d.id}`)).text()).toBe("fifo-eee");

    // On a doc another key started, this key's version is the current one; it stays rather than leave the doc pointing at nothing.
    const other = await publish({ "o.html": "someone else's" });
    await ok(await push("fifo-fff", { ref: other.id })); // deletes d to make room
    expect((await api(`/api/docs/${d.id}`)).status).toBe(404);
    expect((await push("fifo-ggg")).status).toBe(413); // only the favorite and other's current version are left
    expect(await (await exports.default.fetch(other.url)).text()).toBe("fifo-fff");
  });

  it("uploads through the dashboard api without an api key", async () => {
    const sha = await sha256Hex("from browser");
    const body = JSON.stringify({ files: [{ path: "b.html", sha256: sha }] });
    // A Request built in-process has no Content-Length header; browsers always send one.
    const put = await dash(`/dashboard/api/blobs/${sha}`, { method: "PUT", headers: { origin: BASE, "content-length": "12" }, body: "from browser" });
    expect(put.status).toBe(204);
    const doc = (await (await dash("/dashboard/api/push", { method: "POST", headers: sameOrigin, body })).json()) as { id: string };
    const detail = (await (await dash(`/dashboard/api/docs/${doc.id}`)).json()) as { versions: { keyName: string | null }[] };
    expect(detail.versions[0].keyName).toBeNull();
  });

  it("gives new docs the default expiry unless the push names one", async () => {
    const setDefault = (defaultExpires: string | null) => dash("/dashboard/api/settings", { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ defaultExpires }) });
    expect(await (await dash("/dashboard/api/settings")).json()).toEqual({ defaultExpires: null, maxExpires: "30d", isolateSpaces: true, maxSlugLength: 48, viewStats: false, linkPreviews: false, credit: true });
    expect((await setDefault("soon")).status).toBe(400);
    expect((await api("/api/settings")).status).toBe(404); // an API key can't change it
    try {
      expect(await (await setDefault("7d")).json()).toEqual({ defaultExpires: "7d", maxExpires: "30d", isolateSpaces: true, maxSlugLength: 48, viewStats: false, linkPreviews: false, credit: true });
      const before = Date.now();
      expect((await publish({ "d1.html": "default" })).expiresAt).toBeGreaterThanOrEqual(before + 7 * 86_400_000);
      expect((await publish({ "d2.html": "forever" }, { expires: null })).expiresAt).toBeNull();
      expect((await publish({ "d3.html": "short" }, { expires: "1h" })).expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
      // A new version of an existing doc keeps the doc's expiry.
      const kept = await publish({ "d4.html": "v1" }, { expires: null });
      expect((await publish({ "d4.html": "v2" }, { ref: kept.id })).expiresAt).toBeNull();
    } finally {
      await setDefault(null);
    }
    expect((await publish({ "d5.html": "after" })).expiresAt).toBeNull();
  });

  it("caps every expiry at the owner's longest, and keeps the default under it", async () => {
    const patchApp = (body: object) => dash("/dashboard/api/settings", { method: "PATCH", headers: sameOrigin, body: JSON.stringify(body) });
    try {
      expect((await publish({ "m1.html": "30d" }, { expires: "30d" })).expiresAt).not.toBeNull();
      for (const bad of [null, "0", "0d", "soon"]) expect((await patchApp({ maxExpires: bad })).status).toBe(400);
      expect(await (await patchApp({ maxExpires: "90d" })).json()).toEqual({ defaultExpires: null, maxExpires: "90d", isolateSpaces: true, maxSlugLength: 48, viewStats: false, linkPreviews: false, credit: true });
      expect((await publish({ "m2.html": "60d" }, { expires: "60d" })).expiresAt).toBeGreaterThan(Date.now() + 59 * 86_400_000);
      expect((await pushManifest({ files: [{ path: "m3.html", sha256: await sha256Hex("91d") }], expires: "91d" })).status).toBe(400);
      // The default can't outgrow the max, from either side.
      expect((await patchApp({ defaultExpires: "14d", maxExpires: "7d" })).status).toBe(400);
      expect(await (await patchApp({ defaultExpires: "14d" })).json()).toEqual({ defaultExpires: "14d", maxExpires: "90d", isolateSpaces: true, maxSlugLength: 48, viewStats: false, linkPreviews: false, credit: true });
      expect((await patchApp({ maxExpires: "7d" })).status).toBe(400);
      expect(await (await patchApp({ defaultExpires: "0" })).json()).toEqual({ defaultExpires: null, maxExpires: "90d", isolateSpaces: true, maxSlugLength: 48, viewStats: false, linkPreviews: false, credit: true });
      const { id } = await publish({ "m4.html": "patch" });
      await patchApp({ maxExpires: "1d" });
      expect((await api(`/api/docs/${id}`, { method: "PATCH", body: JSON.stringify({ expires: "2d" }) })).status).toBe(400);
      expect((await api(`/api/docs/${id}`, { method: "PATCH", body: JSON.stringify({ expires: null }) })).status).toBe(200);
    } finally {
      await patchApp({ defaultExpires: null, maxExpires: "30d" });
    }
  });

  it("caps slugs at the owner's longest", async () => {
    const patchApp = (body: object) => dash("/dashboard/api/settings", { method: "PATCH", headers: sameOrigin, body: JSON.stringify(body) });
    const sha = await sha256Hex("long");
    const withSlug = (slug: string) => pushManifest({ slug, password: "hunter22", files: [{ path: "l.html", sha256: sha }] });
    try {
      expect((await withSlug("a".repeat(49))).status).toBe(400);
      for (const bad of [2, 129, 10.5, "60", null]) expect((await patchApp({ maxSlugLength: bad })).status).toBe(400);
      expect(await (await patchApp({ maxSlugLength: 64 })).json()).toMatchObject({ maxSlugLength: 64 });
      expect((await withSlug("a".repeat(64))).status).toBe(200);
      expect((await withSlug("b".repeat(65))).status).toBe(400);
      await patchApp({ maxSlugLength: 3 });
      expect((await withSlug("abcd")).status).toBe(400);
    } finally {
      await patchApp({ maxSlugLength: 48 });
    }
  });

  it("lets the signed-in owner open a locked doc without its password", async () => {
    const { id } = await publish({ "own.html": "mine" }, { password: "hunter22" });
    expect((await get(`/dashboard/open/${id}@1`)).status).toBe(403);
    const res = await dash(`/dashboard/open/${id}@1?raw`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/view/${id}@1?raw`);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("u_"))!.split(";")[0];
    expect(await (await get(`/view/${id}`, { headers: { cookie } })).text()).toBe("mine");
  });

  const patchSettings = (body: object) => dash("/dashboard/api/settings", { method: "PATCH", headers: sameOrigin, body: JSON.stringify(body) });
  const BROWSER = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0" };

  it("counts readers only while view statistics are on, leaving out bots and the owner", async () => {
    const { id, url } = await publish({ "read.html": "<p>v1</p>" });
    const views = async () => (await (await dash(`/dashboard/api/docs/${id}`)).json()) as { views: { total: number; readers: number; days: { day: number; views: number }[] }; versions: { n: number; views: number }[] };
    await get(url, { headers: BROWSER });
    expect((await views()).views.total).toBe(0); // off by default
    expect((await patchSettings({ viewStats: "yes" })).status).toBe(400);
    await patchSettings({ viewStats: true });
    try {
      for (const headers of [BROWSER, BROWSER, { ...BROWSER, "cf-connecting-ip": "203.0.113.9" }]) {
        const ctx = createExecutionContext();
        await worker.fetch(new Request(url, { headers }) as Parameters<typeof worker.fetch>[0], env, ctx);
        await waitOnExecutionContext(ctx);
      }
      // Not readers: a crawler, a link preview, a video seek, and the owner opening it from the dashboard.
      for (const headers of [{ "user-agent": "Googlebot/2.1" }, { "user-agent": "curl/8.0" }, { ...BROWSER, range: "bytes=5-" }, { ...BROWSER, cookie: "owner=1" }]) {
        const ctx = createExecutionContext();
        await worker.fetch(new Request(url, { headers }) as Parameters<typeof worker.fetch>[0], env, ctx);
        await waitOnExecutionContext(ctx);
      }
      expect((await dash(`/dashboard/open/${id}`)).headers.getSetCookie()).toContainEqual(expect.stringMatching(/^owner=1;/));
      const v = await views();
      expect(v.views).toMatchObject({ total: 3, readers: 2 });
      expect(v.versions).toMatchObject([{ n: 1, views: 3 }]);
      expect(v.views.days).toEqual([{ day: Math.floor(Date.now() / 86_400_000), views: 3 }]);
      const analytics = (await (await dash("/dashboard/api/analytics")).json()) as { viewStats: boolean; views: { docId: string; views: number; readers: number }[] };
      expect(analytics.viewStats).toBe(true);
      expect(analytics.views.filter((r) => r.docId === id)).toMatchObject([{ views: 3, readers: 2 }]);
    } finally {
      await patchSettings({ viewStats: false });
    }
  });

  it("keeps search engines out, and lets chat apps preview links only when allowed", async () => {
    const { url } = await publish({ "card.html": "<html><head><title>Own</title></head><body>hi</body></html>" }, { title: "Q3 plan" });
    const slack = { "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" };
    expect((await get(url)).headers.get("x-robots-tag")).toBe("noindex");
    expect(await (await get("/robots.txt")).text()).toBe("User-agent: *\nDisallow: /\n");
    expect((await get(url, { headers: slack })).status).toBe(403);
    await patchSettings({ linkPreviews: true });
    try {
      const robots = await (await get("/robots.txt")).text();
      expect(robots).toContain("User-agent: Slackbot-LinkExpanding\n");
      expect(robots).toMatch(/Allow: \/view\/\nDisallow: \/\n\nUser-agent: \*\nDisallow: \/\n$/);
      const card = await get(url, { headers: slack });
      expect(card.headers.get("x-robots-tag")).toBe("noindex");
      expect(await card.text()).toContain('<meta property="og:title" content="Q3 plan"></head>');
      expect(await (await get(url, { headers: BROWSER })).text()).not.toContain("og:title"); // readers get the doc untouched
    } finally {
      await patchSettings({ linkPreviews: false });
    }
  });

  /** Walks a tar the export wrote: [type, name, link, body] per entry, with PAX names applied. */
  function untar(tar: Uint8Array): [string, string, string, string][] {
    const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0.*$/s, "");
    const entries: [string, string, string, string][] = [];
    let pax: Record<string, string> = {};
    for (let at = 0; tar[at] !== 0;) {
      const h = tar.subarray(at, at + 512);
      const size = parseInt(text(h.subarray(124, 136)), 8);
      const body = new TextDecoder().decode(tar.subarray(at + 512, at + 512 + size));
      const type = text(h.subarray(156, 157));
      if (type === "x") pax = Object.fromEntries([...body.matchAll(/\d+ (\w+)=(.*)\n/g)].map((m) => [m[1], m[2]]));
      else {
        entries.push([type, pax.path ?? text(h.subarray(0, 100)), pax.linkpath ?? text(h.subarray(157, 257)), body]);
        pax = {};
      }
      at += 512 + Math.ceil(size / 512) * 512;
    }
    return entries;
  }

  it("exports docs, versions and a manifest as a tar, each blob once", async () => {
    const space = (await (await dash("/dashboard/api/spaces", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "backup" }) })).json()) as { id: string };
    const long = `${"deep/".repeat(25)}page.html`; // over ustar's 100 bytes
    const a = await publish({ "index.html": "<h1>one</h1>", [long]: "x" }, { password: "hunter22" });
    await publish({ "index.html": "<h1>two</h1>", [long]: "x" }, { ref: a.id });
    await dash(`/dashboard/api/docs/${a.id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ space: space.id }) });
    expect((await dash("/dashboard/api/export?space=nope")).status).toBe(404);
    const res = await dash(`/dashboard/api/export?space=${space.id}`);
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^attachment; filename="shelf-\\d{4}-\\d\\d-\\d\\d-${space.id}\\.tar"$`));
    const entries = untar(new Uint8Array(await res.arrayBuffer()));
    expect(entries.slice(0, -1)).toEqual([
      ["0", `docs/${a.id}/1/${long}`, "", "x"],
      ["0", `docs/${a.id}/1/index.html`, "", "<h1>one</h1>"],
      ["1", `docs/${a.id}/2/${long}`, `docs/${a.id}/1/${long}`, ""],
      ["0", `docs/${a.id}/2/index.html`, "", "<h1>two</h1>"],
    ]);
    const [, name, , json] = entries.at(-1)!;
    expect(name).toBe("shelf.json");
    const manifest = JSON.parse(json) as { space: string; spaces: { id: string }[]; docs: { id: string; locked: boolean; versions: { n: number; files: { path: string }[] }[] }[]; missing: string[] };
    expect(manifest).toMatchObject({ space: space.id, spaces: [{ id: space.id, keysDelete: true }], docs: [{ id: a.id, locked: true, versions: [{ n: 1 }, { n: 2 }] }], missing: [] });
    expect(json).not.toMatch(/password_hash|passwordHash|pbkdf2/);
  });

  it("imports a backup: same links and passwords with hashes, conflicts skipped or copied, locked docs never public", async () => {
    const space = (await (await dash("/dashboard/api/spaces", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "restore" }) })).json()) as { id: string };
    const locked = await publish({ "secret.html": "<p>s</p>" }, { password: "hunter22", slug: "restore-me", title: "Secret", project: "vault" });
    await publish({ "secret.html": "<p>s2</p>" }, { ref: locked.id, message: "second" });
    await dash(`/dashboard/api/docs/${locked.id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ space: space.id, favorite: true }) });
    await dash(`/dashboard/api/docs/${locked.id}/versions`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ versions: [1], disabled: true }) });
    const shelfJson = async (query: string) =>
      JSON.parse(untar(new Uint8Array(await (await dash(`/dashboard/api/export?space=${space.id}${query}`)).arrayBuffer())).at(-1)![3]) as {
        spaces: object[];
        keys: object[];
        docs: { id: string; passwordHash?: string; versions: object[] }[];
      };
    const withHashes = await shelfJson("&passwords=1");
    const without = await shelfJson("");
    expect(withHashes.docs[0].passwordHash).toMatch(/^pbkdf2\$/);
    expect(without.docs[0].passwordHash).toBeUndefined();
    const post = (path: string, body: object) => dash(`/dashboard/api/import${path}`, { method: "POST", headers: sameOrigin, body: JSON.stringify(body) });

    // Gone from the shelf, then back from the backup with its id, slug, password, history and space.
    await dash(`/dashboard/api/docs/${locked.id}`, { method: "DELETE", headers: sameOrigin });
    const check = (await (await post("/check", { docs: withHashes.docs })).json()) as { conflicts: string[]; missing: string[] };
    expect(check).toEqual({ conflicts: [], missing: expect.arrayContaining([await sha256Hex("<p>s</p>"), await sha256Hex("<p>s2</p>")]) });
    expect((await post("", { ...withHashes, docs: [{ ...withHashes.docs[0], passwordHash: "pbkdf2$9999999$00$00" }] })).status).toBe(400);
    const restored = (await (await post("", withHashes)).json()) as { imported: string[]; needPassword: string[] };
    expect(restored).toMatchObject({ imported: [locked.id], needPassword: [] });
    expect(await (await get("/view/restore-me", { headers: { "x-doc-password": "hunter22" } })).text()).toBe("<p>s2</p>");
    const back = (await (await dash(`/dashboard/api/docs/${locked.id}`)).json()) as { space: string; project: string | null; favorite: boolean; versions: { n: number; message: string | null; disabled: boolean }[] };
    expect(back).toMatchObject({ space: space.id, project: "vault", favorite: true, versions: [{ n: 2, message: "second", disabled: false }, { n: 1, disabled: true }] });

    // Already there: skipped unless copied; a copy gets a new id and loses the taken slug.
    expect(((await (await post("/check", { docs: without.docs })).json()) as { conflicts: string[] }).conflicts).toEqual([locked.id]);
    expect(await (await post("", without)).json()).toMatchObject({ imported: [], skipped: [locked.id] });
    const copy = (await (await post("", { ...without, copies: [locked.id] })).json()) as { copied: { from: string; to: string }[]; needPassword: string[] };
    const to = copy.copied[0].to;
    expect(copy).toMatchObject({ copied: [{ from: locked.id }], needPassword: [to] });
    expect(to).not.toBe(locked.id);
    // Backed up without its hash, the copy stays locked behind a password nobody knows.
    expect((await get(`/view/${to}`, { headers: { "x-doc-password": "hunter22" } })).status).toBe(401);
    expect(await (await dash(`/dashboard/api/docs/${to}`)).json()).toMatchObject({ slug: null, locked: true });
  });

  it("keeps each key to its own space, with the permissions the owner set", async () => {
    const space = (await (await dash("/dashboard/api/spaces", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "work" }) })).json()) as { id: string };
    expect((await dash("/dashboard/api/spaces", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "work" }) })).status).toBe(409);
    const { key } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: "work-ci", space: space.id }) })).json()) as { key: string };
    const work = (path: string, init: RequestInit = {}) =>
      exports.default.fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers } });
    const mcpCall = async (auth: string, name: string, args: object) =>
      ((await (await exports.default.fetch(`${BASE}/mcp`, { method: "POST", headers: { authorization: auth }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) })).json()) as { result: { content: { text: string }[]; isError: boolean } }).result;
    const patchSpace = (body: object) => dash(`/dashboard/api/spaces/${space.id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify(body) });
    const patchApp = (body: object) => dash("/dashboard/api/settings", { method: "PATCH", headers: sameOrigin, body: JSON.stringify(body) });

    // The work key publishes; its doc lands in its space.
    const sha = await sha256Hex("work secret");
    await work(`/api/blobs/${sha}`, { method: "PUT", headers: { "content-length": "11" }, body: "work secret" });
    const pushWork = (extra: object) => work("/api/push", { method: "POST", body: JSON.stringify({ files: [{ path: "w.html", sha256: sha }], ...extra }) });
    const mine = (await (await pushWork({ slug: "work-plan", password: "hunter22" })).json()) as { id: string; space: string };
    expect(mine.space).toBe(space.id);
    const theirs = await publish({ "t.html": "default space" }, { message: "theirs" });

    // Each side sees only its own docs and uploads; the other's are not found.
    const ids = async (res: Response) => ((await res.json()) as { id?: string; docId?: string }[]).map((d) => d.id ?? d.docId);
    expect(await ids(await work("/api/docs"))).toEqual([mine.id]);
    expect(await ids(await work("/api/uploads"))).toEqual([mine.id]);
    expect(await ids(await api("/api/docs"))).not.toContain(mine.id);
    expect((await work(`/api/docs/${theirs.id}`)).status).toBe(404);
    expect((await work(`/api/docs/${theirs.id}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status).toBe(404);
    expect((await work(`/api/docs/${theirs.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await pushWork({ ref: theirs.id })).status).toBe(404);
    expect((await api("/api/docs/work-plan")).status).toBe(404);
    // Another space's slug is taken, never updated.
    expect((await pushManifest({ slug: "work-plan", password: "hunter22", files: [{ path: "w.html", sha256: sha }] })).status).toBe(409);
    expect((await mcpCall(AUTH.authorization, "read_doc", { ref: mine.id })).content[0].text).toBe("doc not found");
    // A key can't move docs; readers with the link and password still can read.
    expect((await work(`/api/docs/${mine.id}`, { method: "PATCH", body: JSON.stringify({ space: "default" }) })).status).toBe(403);
    expect(await (await exports.default.fetch(`${BASE}/view/work-plan`, { headers: { "x-doc-password": "hunter22" } })).text()).toBe("work secret");

    // The space's permissions: no deletes, no reading locked docs without the password.
    expect((await mcpCall(`Bearer ${key}`, "read_doc", { ref: mine.id })).content[0].text).toBe("work secret");
    expect(await (await patchSpace({ keysDelete: false, keysReadLocked: false })).json()).toMatchObject({ keysDelete: false, keysReadLocked: false, docs: 1, keys: 1 });
    expect((await work(`/api/docs/${mine.id}`, { method: "DELETE" })).status).toBe(403);
    expect((await mcpCall(`Bearer ${key}`, "read_doc", { ref: mine.id })).isError).toBe(true);
    await patchSpace({ keysReadLocked: true });

    try {
      // Isolation off: every key reaches every doc, but never skips another space's password.
      await patchApp({ isolateSpaces: false });
      expect(await ids(await api("/api/docs"))).toContain(mine.id);
      expect((await mcpCall(AUTH.authorization, "read_doc", { ref: mine.id })).isError).toBe(true);
    } finally {
      await patchApp({ isolateSpaces: true });
    }

    // The dashboard sees both and moves a doc into the space.
    expect(await ids(await dash("/dashboard/api/docs"))).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    expect((await dash(`/dashboard/api/docs/${theirs.id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ space: space.id }) })).status).toBe(200);
    expect((await work(`/api/docs/${theirs.id}`)).status).toBe(200);
    expect((await api(`/api/docs/${theirs.id}`)).status).toBe(404);
  });

  it("deletes a space, moving its keys and moving or deleting its docs", async () => {
    const make = async (name: string) => {
      const s = (await (await dash("/dashboard/api/spaces", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name }) })).json()) as { id: string };
      const { id: keyId } = (await (await dash("/dashboard/api/keys", { method: "POST", headers: sameOrigin, body: JSON.stringify({ name: `${name}-key`, space: s.id }) })).json()) as { id: string };
      const doc = await publish({ [`${name}.html`]: name });
      await dash(`/dashboard/api/docs/${doc.id}`, { method: "PATCH", headers: sameOrigin, body: JSON.stringify({ space: s.id }) });
      return { space: s.id, keyId, docId: doc.id };
    };
    const del = (id: string, query: string) => dash(`/dashboard/api/spaces/${id}?${query}`, { method: "DELETE", headers: { origin: BASE } });
    const spaceOf = async (path: string) => ((await (await dash(path)).json()) as { space: string }).space;

    expect((await del("default", "to=default")).status).toBe(400);
    const a = await make("move-me");
    expect((await del(a.space, `to=${a.space}`)).status).toBe(400);
    expect((await del(a.space, "to=s_nope")).status).toBe(400);
    expect((await del(a.space, "to=default")).status).toBe(204);
    expect(await spaceOf(`/dashboard/api/keys/${a.keyId}`)).toBe("default");
    expect(await spaceOf(`/dashboard/api/docs/${a.docId}`)).toBe("default");
    expect((await del(a.space, "to=default")).status).toBe(404);

    const b = await make("drop-me");
    expect((await del(b.space, "to=default&docs=delete")).status).toBe(204);
    expect(await spaceOf(`/dashboard/api/keys/${b.keyId}`)).toBe("default");
    expect((await dash(`/dashboard/api/docs/${b.docId}`)).status).toBe(404);
  });
});

describe("agents", () => {
  it("serves llms.txt with this server's own URLs", async () => {
    const res = await exports.default.fetch(`${BASE}/llms.txt`);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain(`${BASE}/api/push`);
  });

  const rpc = async (method: string, params: object = {}, headers: Record<string, string> = AUTH) =>
    exports.default.fetch(`${BASE}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const tool = async (name: string, args: object) => ((await (await rpc("tools/call", { name, arguments: args })).json()) as { result: { content: { text: string }[]; isError: boolean } }).result;

  it("requires an API key on /mcp", async () => {
    expect((await rpc("tools/list", {}, {})).status).toBe(401);
  });

  it("publishes a folder over MCP, then reads it back without the password", async () => {
    const init = (await (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json()) as { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe("2025-06-18");

    const pub = await tool("publish", {
      files: [
        { path: "index.html", content: "<h1>hi</h1>" },
        { path: "img/dot.png", content: btoa("\x89PNG"), encoding: "base64" },
      ],
      slug: "mcp-plan",
      password: "correct horse",
    });
    expect(pub.isError).toBe(false);
    const doc = JSON.parse(pub.content[0].text) as { id: string; url: string; version: number };
    expect(doc).toMatchObject({ url: `${BASE}/view/mcp-plan`, version: 1 });

    const read = await tool("read_doc", { ref: "mcp-plan" });
    expect(read.content[0].text).toBe("<h1>hi</h1>");
    const png = await exports.default.fetch(`${BASE}/view/mcp-plan/img/dot.png`, { headers: { "x-doc-password": "correct horse" } });
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(Uint8Array.from("\x89PNG", (c) => c.charCodeAt(0)));

    const bad = await tool("update_doc", { ref: doc.id, expires: "banana" });
    expect(bad.isError).toBe(true);
  });
});
