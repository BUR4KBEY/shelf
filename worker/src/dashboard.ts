import page from "./dashboard.html";
import { UPLOAD_SELECT, appSettings } from "./api";
import { darkReaderScript, themeAttr } from "./page";
import { json, randomId, sha256Hex } from "./util";

/** The dashboard is one self-contained HTML file; a per-request nonce lets its inline script and style run under a strict CSP. */
export function dashboardPage(req: Request): Response {
  const nonce = randomId(22);
  // The chosen theme goes on <html> here, so the page never paints in the wrong one first; Dark Reader's script leads <head> for the same reason.
  return new Response(page.replace("<html", `<html${themeAttr(req)}`).replace("<head>", `<head>${darkReaderScript(nonce)}`).replaceAll("__NONCE__", nonce), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Scripts need the nonce. Styles allow inline because shadcn/Radix inject <style> tags at runtime;
      // React escapes all user data, so there is no markup injection to abuse it. GitHub: Settings → About's update check.
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; font-src data:; connect-src 'self' https://api.github.com; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
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

/** Deletes a revoked key for good. Its uploads stay, with their key_id pointing at nothing; the dashboard shows them as a deleted key's. */
export async function deleteKey(env: Env, id: string): Promise<Response> {
  const { meta } = await env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND revoked_at IS NOT NULL").bind(id).run();
  return meta.changes ? new Response(null, { status: 204 }) : json({ error: "no revoked key with this id; revoke it first" }, 404);
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

/**
 * Deletes a space. Its keys, revoked ones too, move to `to`; its docs move there as well, or are deleted with
 * `docs=delete` (the daily sweep then removes blobs nothing references). Default always stays, so keys always have a home.
 */
export async function deleteSpace(req: Request, env: Env, id: string): Promise<Response> {
  if (id === "default") return json({ error: "the Default space can't be deleted" }, 400);
  const params = new URL(req.url).searchParams;
  const to = params.get("to");
  const docs = params.get("docs") ?? "move";
  if (docs !== "move" && docs !== "delete") return json({ error: "docs: move or delete" }, 400);
  if (!(await spaceExists(env, id))) return json({ error: "space not found" }, 404);
  if (to === id || !(await spaceExists(env, to))) return json({ error: "to: another space for its keys and docs" }, 400);
  await env.DB.batch([
    docs === "delete" ? env.DB.prepare("DELETE FROM docs WHERE space_id = ?").bind(id) : env.DB.prepare("UPDATE docs SET space_id = ? WHERE space_id = ?").bind(to, id),
    env.DB.prepare("UPDATE api_keys SET space_id = ? WHERE space_id = ?").bind(to, id),
    env.DB.prepare("DELETE FROM spaces WHERE id = ?").bind(id),
  ]);
  return new Response(null, { status: 204 });
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

/** How far back the analytics page goes: a year and the year before it, so a year can be compared with the one before. */
const ANALYTICS_DAYS = 728;

/**
 * Every key's uploads, for the analytics page. Counts are per key and space, so the page can filter by space; a key
 * that is gone or the dashboard (null) gets rows too. `tz` is the browser's getTimezoneOffset(), so `day` (days since
 * 1970 in the browser's time) lines up with its calendar. `views`: readers opening docs per doc and day, recorded while
 * `viewStats` is on; `readers` counts each reader once per doc and day.
 * shortcut: one offset for the whole range puts uploads near midnight on the wrong day across a DST change; send the zone and bucket per day if that matters.
 */
export async function getAnalytics(req: Request, env: Env): Promise<Response> {
  const tz = Number(new URL(req.url).searchParams.get("tz") ?? 0);
  if (!Number.isInteger(tz) || Math.abs(tz) > 840) return json({ error: "tz: minutes from UTC, -840 to 840" }, 400);
  const shift = tz * 60_000;
  const since = Date.now() - (ANALYTICS_DAYS + 1) * 86_400_000;
  const [days, keys, shared, quotas, views] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      "SELECT v.key_id AS keyId, d.space_id AS space, CAST((v.created_at - ?1) / 86400000 AS INTEGER) AS day, COUNT(*) AS uploads FROM versions v JOIN docs d ON d.id = v.doc_id WHERE v.created_at >= ?2 GROUP BY 1, 2, 3",
    ).bind(shift, since),
    env.DB.prepare(
      "SELECT v.key_id AS keyId, d.space_id AS space, COUNT(*) AS uploads, COUNT(DISTINCT v.doc_id) AS docs, SUM(v.size) AS size, MAX(v.created_at) AS lastAt FROM versions v JOIN docs d ON d.id = v.doc_id GROUP BY 1, 2",
    ),
    // Docs more than one uploader (a key or the dashboard) put versions on, with each uploader's share.
    env.DB.prepare(
      "SELECT v.doc_id AS docId, v.key_id AS keyId, COUNT(*) AS uploads, MAX(v.created_at) AS lastAt FROM versions v WHERE v.doc_id IN (SELECT doc_id FROM versions GROUP BY doc_id HAVING COUNT(DISTINCT coalesce(key_id, '')) > 1) GROUP BY 1, 2 ORDER BY lastAt DESC",
    ),
    env.DB.prepare("SELECT id, quota_bytes AS quota FROM api_keys WHERE quota_bytes IS NOT NULL"),
    env.DB.prepare(
      "SELECT w.doc_id AS docId, d.space_id AS space, CAST((w.at - ?1) / 86400000 AS INTEGER) AS day, COUNT(*) AS views, COUNT(DISTINCT w.visitor) AS readers FROM views w JOIN docs d ON d.id = w.doc_id WHERE w.at >= ?2 GROUP BY 1, 2, 3",
    ).bind(shift, since),
  ]);
  const { viewStats } = await appSettings(env);
  return json({ days: days.results, keys: keys.results, shared: shared.results, quotas: quotas.results, views: views.results, viewStats });
}
