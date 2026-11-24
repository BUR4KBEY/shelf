import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/util";
import { sweep } from "../src/api";
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
  return (await res.json()) as { id: string; slug: string | null; version: number; url: string; versionUrl: string; created: boolean };
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
    expect(doc.id).toMatch(/^[0-9A-Za-z]{12}$/);
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

  it("refuses removing the password while a slug is set", async () => {
    await publish({ "k.html": "k" }, { slug: "keep-pass", password: "hunter22" });
    expect((await api("/api/docs/keep-pass", { method: "PATCH", body: JSON.stringify({ password: null }) })).status).toBe(400);
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
    expect(await res.text()).toContain("<h1>Hello</h1>");
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
    await sweep(env);
    expect((await get(`/view/${id}`)).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS c FROM files WHERE doc_id = ?").bind(id).first("c")).toBe(0);
  });

  it("deletes docs, and the sweep removes only blobs nothing references", async () => {
    const shared = await publish({ "keep.html": "shared bytes" });
    const gone = await publish({ "index.html": "shared bytes", "only.txt": "only here" });
    expect((await api(`/api/docs/${gone.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await get(`/view/${gone.id}/`)).status).toBe(404);

    await sweep(env, Date.now() + 2 * 86_400_000);
    expect(await env.BUCKET.head(`docs/${await sha256Hex("only here")}`)).toBeNull();
    expect(await env.BUCKET.head(`docs/${await sha256Hex("shared bytes")}`)).not.toBeNull();
    expect(await (await get(shared.url)).text()).toBe("shared bytes");
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
});
