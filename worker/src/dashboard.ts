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

const KEY_COLUMNS = "id, name, space_id AS space, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt";

export async function listKeys(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys ORDER BY revoked_at IS NOT NULL, created_at DESC`).all();
  return json(results);
}

const spaceExists = async (env: Env, space: unknown) =>
  typeof space === "string" && !!(await env.DB.prepare("SELECT 1 FROM spaces WHERE id = ?").bind(space).first());

/** Mints a key in a space ("default" unless named). Only its hash is stored, so the response is the only time the key is visible. */
export async function createKey(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { name?: unknown; space?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 64) return json({ error: "name: 1 to 64 chars" }, 400);
  const space = body?.space ?? "default";
  if (!(await spaceExists(env, space))) return json({ error: "space not found" }, 400);
  const id = `k_${randomId(10)}`;
  const key = `sk_${randomId(43)}`; // ≈256 bits
  await env.DB.prepare("INSERT INTO api_keys (id, name, hash, created_at, space_id) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, await sha256Hex(key), Date.now(), space)
    .run();
  return json({ id, name, space, key });
}

/**
 * Sets how many bytes a key's uploads may keep (`quota`, null for no limit), what a push over it does (`strategy`),
 * and its `space`. Moving a key leaves the docs it already uploaded where they are.
 */
export async function patchKey(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { quota?: unknown; strategy?: unknown; space?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const { quota, strategy, space } = body;
  if (quota !== undefined && quota !== null && !(Number.isSafeInteger(quota) && (quota as number) > 0)) return json({ error: "quota: a whole number of bytes above 0, or null for no limit" }, 400);
  if (strategy !== undefined && strategy !== "reject" && strategy !== "fifo") return json({ error: "strategy: reject or fifo" }, 400);
  if (space !== undefined && !(await spaceExists(env, space))) return json({ error: "space not found" }, 400);
  const { meta } = await env.DB.prepare(
    "UPDATE api_keys SET quota_bytes = iif(?1, ?2, quota_bytes), quota_strategy = coalesce(?3, quota_strategy), space_id = coalesce(?4, space_id) WHERE id = ?5",
  )
    .bind(quota !== undefined ? 1 : 0, quota ?? null, strategy ?? null, space ?? null, id)
    .run();
  return meta.changes ? new Response(null, { status: 204 }) : json({ error: "key not found" }, 404);
}

export async function revokeKey(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), id).run();
  return meta.changes ? new Response(null, { status: 204 }) : json({ error: "key not found" }, 404);
}

type SpaceRow = { id: string; name: string; keysDelete: number; keysReadLocked: number; createdAt: number; docs: number; keys: number };
const spaceJson = (s: SpaceRow) => ({ ...s, keysDelete: s.keysDelete === 1, keysReadLocked: s.keysReadLocked === 1 });
const SPACE_SELECT =
  "SELECT id, name, keys_delete AS keysDelete, keys_read_locked AS keysReadLocked, created_at AS createdAt, (SELECT COUNT(*) FROM docs d WHERE d.space_id = s.id) AS docs, (SELECT COUNT(*) FROM api_keys k WHERE k.space_id = s.id AND k.revoked_at IS NULL) AS keys FROM spaces s";

/** Every space, oldest first, with what its keys may do and how many docs and live keys it holds. */
export async function listSpaces(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`${SPACE_SELECT} ORDER BY created_at`).all<SpaceRow>();
  return json(results.map(spaceJson));
}

const spaceName = (v: unknown) => (typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 64 ? v.trim() : null);

export async function createSpace(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = spaceName(body?.name);
  if (!name) return json({ error: "name: 1 to 64 chars" }, 400);
  const id = `s_${randomId(10)}`;
  try {
    await env.DB.prepare("INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)").bind(id, name, Date.now()).run();
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed: spaces.name")) return json({ error: "a space with that name exists" }, 409);
    throw e;
  }
  return json(spaceJson((await env.DB.prepare(`${SPACE_SELECT} WHERE id = ?`).bind(id).first<SpaceRow>())!));
}

/** Renames a space or changes what its keys may do: `keysDelete` (delete its docs), `keysReadLocked` (read its locked docs without the password). */
export async function patchSpace(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { name?: unknown; keysDelete?: unknown; keysReadLocked?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const cols: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = spaceName(body.name);
    if (!name) return json({ error: "name: 1 to 64 chars" }, 400);
    cols.name = name;
  }
  for (const [field, col] of [["keysDelete", "keys_delete"], ["keysReadLocked", "keys_read_locked"]] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "boolean") return json({ error: `${field}: boolean` }, 400);
    cols[col] = body[field] ? 1 : 0;
  }
  if (Object.keys(cols).length) {
    try {
      await env.DB.prepare(`UPDATE spaces SET ${Object.keys(cols).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...Object.values(cols), id).run();
    } catch (e) {
      if (String(e).includes("UNIQUE constraint failed: spaces.name")) return json({ error: "a space with that name exists" }, 409);
      throw e;
    }
  }
  const row = await env.DB.prepare(`${SPACE_SELECT} WHERE id = ?`).bind(id).first<SpaceRow>();
  return row ? json(spaceJson(row)) : json({ error: "space not found" }, 404);
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
    env.DB.prepare(`SELECT ${KEY_COLUMNS}, quota_bytes AS quota, quota_strategy AS strategy FROM api_keys WHERE id = ?`).bind(id),
    env.DB.prepare(
      "SELECT doc_id AS docId, COUNT(*) AS uploads, SUM(n = 1) AS created, SUM(size) AS size, MIN(created_at) AS firstAt, MAX(created_at) AS lastAt FROM versions WHERE key_id = ? GROUP BY doc_id ORDER BY lastAt DESC",
    ).bind(id),
    env.DB.prepare(`${UPLOAD_SELECT} WHERE v.key_id = ? ORDER BY v.created_at DESC, v.rowid DESC LIMIT ${KEY_UPLOADS}`).bind(id),
    env.DB.prepare("SELECT created_at AS t FROM versions WHERE key_id = ? AND created_at >= ?").bind(id, Date.now() - ACTIVITY_MS),
  ]);
  if (!key.results.length) return json({ error: "key not found" }, 404);
  return json({ ...key.results[0], docs: docs.results, uploads: uploads.results, times: times.results.map((r) => r.t) });
}
