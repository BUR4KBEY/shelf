import page from "./dashboard.html";
import { UPLOAD_SELECT } from "./api";
import { themeAttr } from "./page";
import { json, randomId, sha256Hex } from "./util";

/** The dashboard is one self-contained HTML file; a per-request nonce lets its inline script and style run under a strict CSP. */
export function dashboardPage(req: Request): Response {
  const nonce = randomId(22);
  // The chosen theme goes on <html> here, so the page never paints in the wrong one first.
  return new Response(page.replace("<html", `<html${themeAttr(req)}`).replaceAll("__NONCE__", nonce), {
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

/** Sets how many bytes a key's uploads may keep (`quota`, null for no limit) and what a push over it does (`strategy`). */
export async function patchKey(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { quota?: unknown; strategy?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const { quota, strategy } = body;
  if (quota !== undefined && quota !== null && !(Number.isSafeInteger(quota) && (quota as number) > 0)) return json({ error: "quota: a whole number of bytes above 0, or null for no limit" }, 400);
  if (strategy !== undefined && strategy !== "reject" && strategy !== "fifo") return json({ error: "strategy: reject or fifo" }, 400);
  const { meta } = await env.DB.prepare("UPDATE api_keys SET quota_bytes = iif(?1, ?2, quota_bytes), quota_strategy = coalesce(?3, quota_strategy) WHERE id = ?4")
    .bind(quota !== undefined ? 1 : 0, quota ?? null, strategy ?? null, id)
    .run();
  return meta.changes ? new Response(null, { status: 204 }) : json({ error: "key not found" }, 404);
}

/** The most uploads a key's page lists. Its per-doc totals always count every upload. */
const KEY_UPLOADS = 500;
/** How far back a key's upload times go: the 53 weeks its yearly heatmap shows. */
const ACTIVITY_MS = 371 * 86_400_000;

/**
 * One key and what it uploaded: a row per doc it touched, with totals, its newest uploads, and the time of
 * every upload in the last year for its charts.
 * shortcut: `times` sends one number per upload; aggregate per day in SQL if a key ever uploads tens of thousands a year.
 */
export async function getKey(env: Env, id: string): Promise<Response> {
  const [key, docs, uploads, times] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      "SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt, quota_bytes AS quota, quota_strategy AS strategy FROM api_keys WHERE id = ?",
    ).bind(id),
    env.DB.prepare(
      "SELECT doc_id AS docId, COUNT(*) AS uploads, SUM(n = 1) AS created, SUM(size) AS size, MIN(created_at) AS firstAt, MAX(created_at) AS lastAt FROM versions WHERE key_id = ? GROUP BY doc_id ORDER BY lastAt DESC",
    ).bind(id),
    env.DB.prepare(`${UPLOAD_SELECT} WHERE v.key_id = ? ORDER BY v.created_at DESC, v.rowid DESC LIMIT ${KEY_UPLOADS}`).bind(id),
    env.DB.prepare("SELECT created_at AS t FROM versions WHERE key_id = ? AND created_at >= ?").bind(id, Date.now() - ACTIVITY_MS),
  ]);
  if (!key.results.length) return json({ error: "key not found" }, 404);
  return json({ ...key.results[0], docs: docs.results, uploads: uploads.results, times: times.results.map((r) => r.t) });
}
