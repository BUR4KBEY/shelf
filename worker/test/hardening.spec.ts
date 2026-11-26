import { env, exports } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { localPath } from "../src/page";
import { ipKey, sha256Hex } from "../src/util";
import worker from "../src";

const BASE = "https://shelf.test";
const AUTH = { authorization: "Bearer sk_test" };

const api = (path: string, init: RequestInit = {}) => exports.default.fetch(`${BASE}${path}`, { ...init, headers: { ...AUTH, ...init.headers } });
// Redirects are part of what we test, so never follow them.
const get = (path: string, init: RequestInit = {}) => exports.default.fetch(path.startsWith("http") ? path : `${BASE}${path}`, { redirect: "manual", ...init });

/** Push, upload what is missing, push again. */
async function publish(files: Record<string, string>, extra: object = {}) {
  const manifest = await Promise.all(Object.entries(files).map(async ([path, s]) => ({ path, sha256: await sha256Hex(s) })));
  const push = () => api("/api/push", { method: "POST", body: JSON.stringify({ ...extra, files: manifest }), headers: { "content-type": "application/json" } });
  const first = (await (await push()).json()) as { missing?: string[] };
  for (const sha of first.missing ?? []) await api(`/api/blobs/${sha}`, { method: "PUT", body: files[manifest.find((f) => f.sha256 === sha)!.path] });
  return (await (await push()).json()) as { id: string };
}

describe("open redirect", () => {
  it("never sends /theme off this origin, even through characters browsers strip", async () => {
    for (const next of ["/%09/evil.example", "/%0a/evil.example", "/%0d/evil.example"]) {
      const location = (await get(`/theme/dark?next=${next}`)).headers.get("location")!;
      expect(new URL(location, BASE).origin, JSON.stringify(location)).toBe(BASE);
    }
    expect((await get(`/theme/dark?next=${encodeURIComponent("/view/x?a=1#top")}`)).headers.get("location")).toBe("/view/x?a=1#top");
  });

  it("localPath keeps paths on the origin and refuses the rest (selfhost safeNext uses it)", () => {
    expect(localPath("/dashboard/docs?q=1#a", BASE)).toBe("/dashboard/docs?q=1#a");
    for (const next of ["/\t/evil.example", "/\n/evil.example", "//evil.example", "/\\evil.example", "https://evil.example/", "javascript:alert(1)", "http://[", null]) {
      expect(localPath(next, BASE), JSON.stringify(next)).toBeNull();
    }
  });
});

describe("password guessing over IPv6", () => {
  it("limits a doc's password attempts per /64, so one customer's addresses share one budget", async () => {
    const { id } = await publish({ "v6.html": "v6" }, { password: "hunter22" });
    const statuses: number[] = [];
    // 15 addresses from one /64, written the ways an address can be written.
    for (let i = 1; i <= 15; i++) {
      const ip = i % 2 ? `2001:db8:1:2::${i.toString(16)}` : `2001:0db8:0001:0002:0:0:0:${i.toString(16)}`;
      statuses.push((await get(`/view/${id}`, { headers: { "x-doc-password": "wrongpass", "cf-connecting-ip": ip } })).status);
    }
    expect(statuses.filter((s) => s === 429).length, statuses.join(",")).toBe(5);
    // Another /64 has its own budget, and IPv4 (also as an IPv4-mapped IPv6 address) is per address.
    expect((await get(`/view/${id}`, { headers: { "x-doc-password": "wrongpass", "cf-connecting-ip": "2001:db8:1:3::1" } })).status).toBe(401);
  });

  it("ipKey keeps IPv4 as is and cuts IPv6 to its /64", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("2001:db8:1:2::9")).toBe(ipKey("2001:0DB8:0001:0002:abcd:0:0:1"));
    expect(ipKey("2001:db8:1:2::9")).not.toBe(ipKey("2001:db8:1:3::9"));
    expect(ipKey("::1")).toBe("0:0:0:0::/64");
  });
});

describe("unlock cookies over plain http", () => {
  it("drops Secure on http so self-hosted shelves on a LAN can unlock, and keeps it on https", async () => {
    const { id } = await publish({ "lan.html": "lan" }, { password: "hunter22" });
    const unlock = async (origin: string) => {
      const form = new FormData();
      form.set("password", "hunter22");
      return (await get(`${origin}/view/${id}/unlock`, { method: "POST", body: form })).headers.get("set-cookie")!;
    };
    const http = await unlock("http://192.168.1.5:8080");
    expect(http).toMatch(new RegExp(`^u_${id}=`));
    expect(http).not.toMatch(/;\s*Secure/i);
    expect(http).toContain("SameSite=Lax");
    const https = await unlock(BASE);
    expect(https).toContain("; Secure; SameSite=None");
  });

  it("gives the owner's cookies without Secure on http", async () => {
    const { id } = await publish({ "lan-owner.html": "lan" }, { password: "hunter22" });
    const open = async (origin: string) => {
      const ctx = createExecutionContext();
      Object.defineProperty(ctx, "access", { value: { aud: env.ACCESS_AUD, getIdentity: async () => ({ email: "me@example.com" }) } });
      const res = await worker.fetch(new Request(`${origin}/dashboard/open/${id}`, { redirect: "manual" }) as Parameters<typeof worker.fetch>[0], env, ctx);
      await waitOnExecutionContext(ctx);
      return res.headers.getSetCookie();
    };
    const http = await open("http://192.168.1.5:8080");
    expect(http).toHaveLength(2);
    for (const c of http) expect(c).not.toMatch(/;\s*Secure/i);
    for (const c of await open(BASE)) expect(c).toMatch(/;\s*Secure/i);
  });
});

describe("preview Access keys", () => {
  /** A preview on `team`, whose keys endpoint answers 503 to the first `down` fetches. */
  async function preview(team: string, down: number) {
    const aud = "preview-aud";
    const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
    const pair = (await crypto.subtle.generateKey(alg, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: "k1" };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (spy.mock.calls.length <= down ? new Response("down", { status: 503 }) : Response.json({ keys: [jwk] })));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const enc = (o: object) => b64(new TextEncoder().encode(JSON.stringify(o)));
    const me = async (kid: string) => {
      const input = `${enc({ alg: "RS256", kid })}.${enc({ iss: `https://${team}`, aud: [aud], email: "me@example.com", exp: Date.now() / 1000 + 60 })}`;
      const token = `${input}.${b64(new Uint8Array(await crypto.subtle.sign(alg, pair.privateKey, new TextEncoder().encode(input))))}`;
      const req = new Request(`${BASE}/dashboard/api/me`, { headers: { "cf-access-jwt-assertion": token } });
      return (await worker.fetch(req as Parameters<typeof worker.fetch>[0], { ...env, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } as unknown as Env, createExecutionContext())).status;
    };
    return { me, spy };
  }

  it("refetches the keys after a failed fetch", async () => {
    const { me, spy } = await preview("flaky.cloudflareaccess.com", 1);
    try {
      expect(await me("k1")).toBe(403); // the keys endpoint is down
      expect(await me("k1")).toBe(200);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not fetch the keys for every token with an unknown kid", async () => {
    const { me, spy } = await preview("rotating.cloudflareaccess.com", 0);
    try {
      expect(await me("k1")).toBe(200);
      for (let i = 0; i < 5; i++) expect(await me("forged")).toBe(403);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
