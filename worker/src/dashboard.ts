import page from "./dashboard.html";
import { json, randomId, sha256Hex } from "./util";

/** The dashboard is one self-contained HTML file; a per-request nonce lets its inline script and style run under a strict CSP. */
export function dashboardPage(): Response {
  const nonce = randomId(22);
  return new Response(page.replaceAll("__NONCE__", nonce), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Scripts need the nonce. Styles allow inline because shadcn/Radix inject <style> tags at runtime;
      // React escapes all user data, so there is no markup injection to abuse it.
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  });
}

export async function listKeys(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC",
  ).all();
  return json(results);
}

/** Mints a key. Only its hash is stored, so the response is the only time the key is visible. */
export async function createKey(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) return json({ error: "name: 1 to 64 chars" }, 400);
  const id = `k_${randomId(10)}`;
  const key = `sk_${randomId(43)}`; // ≈256 bits
  await env.DB.prepare("INSERT INTO api_keys (id, name, hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, await sha256Hex(key), Date.now())
    .run();
  return json({ id, name, key });
}

export async function revokeKey(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), id).run();
  return meta.changes ? new Response(null, { status: 204 }) : json({ error: "key not found" }, 404);
}
