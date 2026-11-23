import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/util";

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
  return (await res.json()) as { id: string; version: number; url: string };
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
