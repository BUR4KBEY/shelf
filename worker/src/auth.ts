import { hex, sha256Hex } from "./util";

/** Returns the API key id for a valid `Authorization: Bearer <key>`, else null. */
export async function apiKey(req: Request, env: Env, ctx: ExecutionContext): Promise<string | null> {
  const m = req.headers.get("authorization")?.match(/^Bearer (\S+)$/);
  if (!m) return null;
  const row = await env.DB.prepare("SELECT id FROM api_keys WHERE hash = ? AND revoked_at IS NULL")
    .bind(await sha256Hex(m[1]))
    .first<{ id: string }>();
  if (!row) return null;
  ctx.waitUntil(env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.id).run());
  return row.id;
}

const enc = new TextEncoder();
// ≈2 ms of CPU, inside the Workers Free plan's 10 ms per request (100k took ≈11 ms). The per-IP rate limit
// is the real brute-force defence. Each stored hash records its own count, so changing this keeps old passwords working.
const ITERATIONS = 20_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

/** Stored as `pbkdf2$<iterations>$<salt hex>$<hash hex>` so the cost can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${hex(salt.buffer)}$${hex(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, iterations, salt, hash] = stored.split("$");
  const got = new Uint8Array(await pbkdf2(password, unhex(salt), Number(iterations)));
  return crypto.subtle.timingSafeEqual(got, unhex(hash));
}

/**
 * Value of the `u_<id>` unlock cookie. Keyed by the stored password hash, which never leaves
 * the server, so no extra secret is needed and changing the password invalidates old cookies.
 */
export async function unlockToken(id: string, passwordHash: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(passwordHash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(`unlock:${id}`)));
}

export function sameString(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y);
}
