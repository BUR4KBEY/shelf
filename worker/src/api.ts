import { type Caller, hashPassword } from "./auth";
import { docId, json, sha256Hex } from "./util";

export const SHA = /^[0-9a-f]{64}$/;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const SLUG_LIMIT = 128; // the longest slug length the owner may allow
export const MAX_FILES = 1000;
const DAY = 86_400_000;
const UNIT: Record<string, number> = { m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY };

export interface Doc {
  id: string;
  slug: string | null;
  title: string | null;
  password_hash: string | null;
  favorite: number;
  expires_at: number | null;
  latest: number;
  created_at: number;
  updated_at: number;
  space_id: string;
  project: string | null;
}

/**
 * Finds a doc by id or slug, ignoring case: both are stored lowercase. An id wins a tie.
 * `scope` limits it to one space's docs (null: every space). Expired docs are still returned so the owner can revive them.
 */
export const findDoc = (env: Env, ref: string, scope: string | null = null) =>
  env.DB.prepare("SELECT * FROM docs WHERE (id = ?1 OR slug = ?1) AND (?2 IS NULL OR space_id = ?2) ORDER BY id = ?1 DESC LIMIT 1")
    .bind(ref.toLowerCase(), scope)
    .first<Doc>();

export const validPath = (p: string) =>
  p.length > 0 &&
  p.length <= 512 &&
  p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[\\\x00-\x1f]/.test(s));

const isOpt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || v === null || ok(v);
/** Milliseconds in a duration like 30m, 12h, 7d or 2w; 0 for "0" or any zero duration; NaN when it isn't one. */
const durationMs = (v: unknown) => {
  const m = typeof v === "string" ? /^(\d{1,5})([mhdw])$/.exec(v) : null;
  return v === "0" ? 0 : m ? Number(m[1]) * UNIT[m[2]] : NaN;
};

/**
 * App-wide settings, set from the dashboard. `defaultExpires` is the expiry a new doc gets when its push doesn't name one
 * (null: never); `maxExpires` is the longest expiry any doc may be given; `isolateSpaces` keeps each API key to its own space's docs;
 * `maxSlugLength` is the longest slug any doc may be given; `viewStats` counts readers opening docs; `linkPreviews` lets chat apps
 * (Slack, Discord, iMessage…) fetch a doc to show a card for its link. Search engines never index anything either way.
 */
export type AppSettings = { defaultExpires: string | null; maxExpires: string; isolateSpaces: boolean; maxSlugLength: number; viewStats: boolean; linkPreviews: boolean };

export async function appSettings(env: Env): Promise<AppSettings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    defaultExpires: s.default_expires ?? null,
    maxExpires: s.max_expires ?? "30d",
    isolateSpaces: s.isolate_spaces !== "0",
    maxSlugLength: Number(s.max_slug_length ?? 48),
    viewStats: s.view_stats === "1",
    linkPreviews: s.link_previews === "1",
  };
}

export async function getAppSettings(env: Env): Promise<Response> {
  return json(await appSettings(env));
}

export async function patchAppSettings(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { [K in keyof AppSettings]?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const { defaultExpires: d, maxExpires: max, isolateSpaces: iso, maxSlugLength: slugMax, viewStats: stats, linkPreviews: previews } = body;
  if (d !== undefined && !isOpt(d, (v) => durationMs(v) >= 0)) {
    return json({ error: "defaultExpires: a duration like 30m, 12h, 7d or 2w; 0 or null for never" }, 400);
  }
  if (max !== undefined && !(durationMs(max) > 0)) return json({ error: "maxExpires: a duration like 30m, 12h, 7d or 2w" }, 400);
  if (iso !== undefined && typeof iso !== "boolean") return json({ error: "isolateSpaces: boolean" }, 400);
  if (stats !== undefined && typeof stats !== "boolean") return json({ error: "viewStats: boolean" }, 400);
  if (previews !== undefined && typeof previews !== "boolean") return json({ error: "linkPreviews: boolean" }, 400);
  if (slugMax !== undefined && !(Number.isInteger(slugMax) && (slugMax as number) >= 3 && (slugMax as number) <= SLUG_LIMIT)) {
    return json({ error: `maxSlugLength: a whole number from 3 to ${SLUG_LIMIT}` }, 400);
  }
  const next = await appSettings(env);
  if (d !== undefined) next.defaultExpires = durationMs(d) ? (d as string) : null; // null or a zero duration: never
  if (max !== undefined) next.maxExpires = max as string;
  if (iso !== undefined) next.isolateSpaces = iso;
  if (slugMax !== undefined) next.maxSlugLength = slugMax as number;
  if (stats !== undefined) next.viewStats = stats;
  if (previews !== undefined) next.linkPreviews = previews;
  if (next.defaultExpires !== null && durationMs(next.defaultExpires) > durationMs(next.maxExpires)) {
    return json({ error: `the default expiry (${next.defaultExpires}) can't be longer than the longest allowed (${next.maxExpires})` }, 400);
  }
  const upsert = env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2");
  await env.DB.batch([
    next.defaultExpires === null ? env.DB.prepare("DELETE FROM settings WHERE key = 'default_expires'") : upsert.bind("default_expires", next.defaultExpires),
    upsert.bind("max_expires", next.maxExpires),
    upsert.bind("isolate_spaces", next.isolateSpaces ? "1" : "0"),
    upsert.bind("max_slug_length", String(next.maxSlugLength)),
    upsert.bind("view_stats", next.viewStats ? "1" : "0"),
    upsert.bind("link_previews", next.linkPreviews ? "1" : "0"),
  ]);
  return json(next);
}

interface Settings {
  title?: string | null;
  slug?: string | null;
  password?: string | null;
  expires?: string | null;
  favorite?: boolean;
  /** Groups docs inside a space. A name the space already has, in any case, keeps that spelling. */
  project?: string | null;
  /** Dashboard only: the space the doc belongs to. */
  space?: string;
}

/**
 * Validates settings against the doc's current state and returns the columns to update,
 * or an error response. `null` clears a setting; `undefined` leaves it alone. `caller` is null for the dashboard.
 */
async function settingsColumns(env: Env, s: Settings, doc: Doc | null, caller: Caller | null): Promise<Record<string, unknown> | Response> {
  if (typeof s.slug === "string") s.slug = s.slug.toLowerCase();
  if (!isOpt(s.title, (v) => typeof v === "string" && v.length <= 200)) return json({ error: "title: up to 200 chars" }, 400);
  const maxSlug = typeof s.slug === "string" ? (await appSettings(env)).maxSlugLength : 0;
  if (!isOpt(s.slug, (v) => typeof v === "string" && v.length >= 3 && v.length <= maxSlug && SLUG.test(v))) {
    return json({ error: `slug: 3 to ${maxSlug || "the allowed number of"} chars of a-z, 0-9 and -, not starting or ending with -` }, 400);
  }
  if (!isOpt(s.password, (v) => typeof v === "string" && v.length >= 8 && v.length <= 256)) {
    return json({ error: "password: 8 to 256 chars" }, 400);
  }
  const expiresMs = durationMs(s.expires);
  const maxExpires = typeof s.expires === "string" ? (await appSettings(env)).maxExpires : "";
  if (!isOpt(s.expires, () => expiresMs <= durationMs(maxExpires))) {
    return json({ error: `expires: a duration up to ${maxExpires || "the owner's limit"} like 30m, 12h, 7d or 2w; 0 or null for never` }, 400);
  }
  if (s.favorite !== undefined && typeof s.favorite !== "boolean") return json({ error: "favorite: boolean" }, 400);
  if (!isOpt(s.project, (v) => typeof v === "string" && v.trim().length <= 64 && !/[\x00-\x1f]/.test(v))) {
    return json({ error: "project: up to 64 chars; empty or null for none" }, 400);
  }
  if (s.space !== undefined) {
    // A key stays in its own space: only the dashboard moves docs between spaces.
    if (caller) return json({ error: "space: only the dashboard can move a doc to another space" }, 403);
    if (typeof s.space !== "string" || !(await env.DB.prepare("SELECT 1 FROM spaces WHERE id = ?").bind(s.space).first())) {
      return json({ error: "space not found" }, 400);
    }
  }

  const cols: Record<string, unknown> = {};
  if (s.title !== undefined) cols.title = s.title;
  if (s.slug !== undefined) cols.slug = s.slug;
  if (s.password !== undefined) cols.password_hash = s.password === null ? null : await hashPassword(s.password);
  // A zero duration means never.
  if (s.expires !== undefined) cols.expires_at = s.expires === null || expiresMs === 0 ? null : Date.now() + expiresMs;
  if (s.favorite !== undefined) cols.favorite = s.favorite ? 1 : 0;
  if (s.space !== undefined) cols.space_id = s.space;
  if (s.project !== undefined) {
    const project = s.project?.trim() || null;
    // Agents drift in case, so "Billing" joins an existing "billing" instead of starting a second project.
    const space = (cols.space_id as string | undefined) ?? doc?.space_id ?? caller?.space ?? "default";
    const known = project && (await env.DB.prepare("SELECT project FROM docs WHERE space_id = ? AND project = ? COLLATE NOCASE LIMIT 1").bind(space, project).first<{ project: string }>());
    cols.project = known ? known.project : project;
  }

  const slug = "slug" in cols ? cols.slug : (doc?.slug ?? null);
  const hash = "password_hash" in cols ? cols.password_hash : (doc?.password_hash ?? null);
  if (slug && !hash) return json({ error: "a slug is guessable, so it needs a password" }, 400);
  if (cols.slug && cols.slug !== doc?.slug && (await env.DB.prepare("SELECT 1 FROM docs WHERE id = ?1 OR slug = ?1").bind(cols.slug).first())) {
    return json({ error: "slug is taken" }, 409);
  }
  return cols;
}

const updateStmt = (env: Env, id: string, cols: Record<string, unknown>) =>
  env.DB.prepare(`UPDATE docs SET ${Object.keys(cols).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).bind(...Object.values(cols), id);

const docJson = (req: Request, d: Doc) => ({
  id: d.id,
  slug: d.slug,
  title: d.title,
  locked: d.password_hash !== null,
  favorite: d.favorite === 1,
  expiresAt: d.expires_at,
  latest: d.latest,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
  space: d.space_id,
  project: d.project,
  url: `${new URL(req.url).origin}/view/${d.slug ?? d.id}`,
});

interface PushBody extends Settings {
  ref?: string;
  message?: string;
  files: { path: string; sha256: string }[];
}

/** A key's quota and the bytes its versions keep on the shelf. Every version counts in full, even files it shares. */
interface Quota {
  quota_bytes: number | null;
  quota_strategy: "reject" | "fifo";
  used: number;
}

export const keyQuota = (env: Env, keyId: string) =>
  env.DB.prepare("SELECT quota_bytes, quota_strategy, (SELECT COALESCE(SUM(size), 0) FROM versions WHERE key_id = k.id) AS used FROM api_keys k WHERE id = ?")
    .bind(keyId)
    .first<Quota>();

const overQuota = (q: Quota, size: number) =>
  json({ error: `quota: this key may keep ${q.quota_bytes} bytes and keeps ${q.used}, so ${size} more don't fit${q.quota_strategy === "fifo" ? ", even after deleting its oldest uploads that may go" : ""}` }, 413);

/**
 * Statements that delete a key's oldest uploads until `need` bytes are free, or null when they can't free that much.
 * Kept: favorites, and another doc's current version while older versions remain (an older one from another key
 * or the dashboard would be left behind a latest that is gone). A doc left with no versions is deleted. The pushed-to
 * doc `target` can lose all of them, since the push gives it a new one in the same transaction.
 */
async function evictions(env: Env, keyId: string, target: string, need: number): Promise<D1PreparedStatement[] | null> {
  const { results } = await env.DB.prepare(
    "SELECT v.doc_id AS doc, v.n, v.size, d.latest, (SELECT COUNT(*) FROM versions o WHERE o.doc_id = v.doc_id) AS count FROM versions v JOIN docs d ON d.id = v.doc_id WHERE v.key_id = ? AND d.favorite = 0 ORDER BY v.created_at, v.rowid",
  )
    .bind(keyId)
    .all<{ doc: string; n: number; size: number; latest: number; count: number }>();
  const left = new Map(results.map((r) => [r.doc, r.count]));
  const stmts: D1PreparedStatement[] = [];
  for (const r of results) {
    if (need <= 0) break;
    const count = left.get(r.doc)!;
    if (r.doc !== target && r.n === r.latest && count > 1) continue;
    stmts.push(
      r.doc !== target && count === 1
        ? env.DB.prepare("DELETE FROM docs WHERE id = ?").bind(r.doc)
        : env.DB.prepare("DELETE FROM versions WHERE doc_id = ? AND n = ?").bind(r.doc, r.n),
    );
    left.set(r.doc, count - 1);
    need -= r.size;
  }
  return need <= 0 ? stmts : null;
}

/**
 * Commits a new version from a manifest. Blobs must already be in R2:
 * if any are missing, nothing is written and `{missing}` lists them.
 * Target doc: `ref` (id or slug), else the doc that owns `slug`, else a new doc in the key's space.
 * `caller` is null for the dashboard, which reaches every space.
 */
export async function push(req: Request, env: Env, caller: Caller | null): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PushBody | null;
  if (!body || !Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) {
    return json({ error: `files: 1 to ${MAX_FILES} entries required` }, 400);
  }
  if (!isOpt(body.ref, (v) => typeof v === "string" && v.length <= 64) || !isOpt(body.message, (v) => typeof v === "string" && v.length <= 1000)) {
    return json({ error: "ref and message must be short strings" }, 400);
  }
  const paths = new Set<string>();
  for (const f of body.files) {
    if (typeof f?.path !== "string" || !validPath(f.path) || paths.has(f.path)) {
      return json({ error: `bad or duplicate path: ${JSON.stringify(f?.path)}` }, 400);
    }
    if (typeof f.sha256 !== "string" || !SHA.test(f.sha256)) return json({ error: `bad sha256 for ${f.path}` }, 400);
    paths.add(f.path);
  }
  if (paths.size > 1 && !paths.has("index.html")) return json({ error: "a folder needs an index.html" }, 400);

  // Checked before blobs so a client never uploads for a push that cannot succeed.
  let doc: Doc | null = null;
  if (body.ref) {
    doc = await findDoc(env, body.ref, caller?.scope);
    if (!doc) return json({ error: "doc not found" }, 404);
  } else if (body.slug) {
    doc = await env.DB.prepare("SELECT * FROM docs WHERE slug = lower(?)").bind(body.slug).first<Doc>();
    // Slugs are one namespace for every reader, so another space's slug is taken, not reachable.
    if (doc && caller?.scope && doc.space_id !== caller.scope) return json({ error: "slug is taken" }, 409);
  }
  // A new doc that doesn't name an expiry gets the owner's default; `expires: null` still means never.
  if (!doc && body.expires === undefined) body.expires = (await appSettings(env)).defaultExpires;
  const cols = await settingsColumns(env, body, doc, caller);
  if (cols instanceof Response) return cols;

  const shas = [...new Set(body.files.map((f) => f.sha256))];
  const heads = await Promise.all(shas.map((s) => env.BUCKET.head(`docs/${s}`)));
  const missing = shas.filter((_, i) => !heads[i]);
  if (missing.length) return json({ missing });

  // Sizes come from R2, never from the client.
  const sizeOf = new Map(shas.map((s, i) => [s, heads[i]!.size]));
  const files = body.files.map((f) => ({ path: f.path, sha256: f.sha256, size: sizeOf.get(f.sha256)! }));
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const manifest = await sha256Hex(files.map((f) => `${f.path}\t${f.sha256}`).sort().join("\n"));
  const now = Date.now();
  const id = doc?.id ?? docId();

  const latest = doc && (await env.DB.prepare("SELECT manifest_hash FROM versions WHERE doc_id = ? AND n = ?").bind(id, doc.latest).first<{ manifest_hash: string }>());
  const created = latest?.manifest_hash !== manifest;
  const stmts: D1PreparedStatement[] = [];
  // shortcut: the quota is read before the batch, so concurrent pushes from one key can overshoot it; fine for one owner's agents.
  if (created && caller) {
    const q = (await keyQuota(env, caller.id))!;
    const over = q.quota_bytes === null ? 0 : q.used + size - q.quota_bytes;
    if (over > 0) {
      const freed = q.quota_strategy === "fifo" && size <= q.quota_bytes! ? await evictions(env, caller.id, id, over) : null;
      if (!freed) return overQuota(q, size);
      stmts.push(...freed);
    }
  }
  if (!doc) {
    const title = body.title ?? (files.length === 1 ? files[0].path : null);
    // The dashboard's `space` setting, if any, moves it right after.
    stmts.push(
      env.DB.prepare("INSERT INTO docs (id, title, latest, created_at, updated_at, space_id) VALUES (?, ?, 0, ?, ?, ?)").bind(id, title, now, now, caller?.space ?? "default"),
    );
  }
  if (Object.keys(cols).length) stmts.push(updateStmt(env, id, cols));
  if (created) {
    // One transaction; the version number is computed in SQL so concurrent pushes cannot collide.
    stmts.push(
      env.DB.prepare("UPDATE docs SET latest = latest + 1, updated_at = ? WHERE id = ?").bind(now, id),
      env.DB.prepare(
        "INSERT INTO versions (doc_id, n, manifest_hash, message, size, key_id, created_at) SELECT id, latest, ?, ?, ?, ?, ? FROM docs WHERE id = ?",
      ).bind(manifest, body.message ?? null, size, caller?.id ?? null, now, id),
      env.DB.prepare(
        "INSERT INTO files (doc_id, n, path, sha256, size) SELECT ?1, (SELECT latest FROM docs WHERE id = ?1), value->>'path', value->>'sha256', value->>'size' FROM json_each(?2)",
      ).bind(id, JSON.stringify(files)),
    );
  }
  stmts.push(env.DB.prepare("SELECT * FROM docs WHERE id = ?").bind(id));
  let results: D1Result<Doc>[];
  try {
    results = await env.DB.batch<Doc>(stmts);
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed: docs.slug")) return json({ error: "slug is taken" }, 409);
    throw e;
  }
  const saved = results.at(-1)!.results[0];
  const out = docJson(req, saved);
  return json({ ...out, version: saved.latest, versionUrl: `${new URL(req.url).origin}/view/${id}@${saved.latest}`, created });
}

/**
 * Streams the body into R2. R2 rejects it if the bytes do not hash to `sha`.
 * A key's blob must fit its quota (or its room left, under reject), so a key can't fill R2 with blobs it never pushes.
 */
export async function putBlob(req: Request, env: Env, sha: string, keyId: string | null): Promise<Response> {
  if (!req.headers.has("content-length")) return json({ error: "content-length required" }, 411);
  const q = keyId ? await keyQuota(env, keyId) : null;
  if (q && q.quota_bytes !== null) {
    const length = Number(req.headers.get("content-length"));
    if (length > (q.quota_strategy === "fifo" ? q.quota_bytes : q.quota_bytes - q.used)) return overQuota(q, length);
  }
  try {
    await env.BUCKET.put(`docs/${sha}`, req.body ?? "", { sha256: sha });
  } catch (e) {
    return json({ error: `upload rejected: ${(e as Error).message}` }, 400);
  }
  return new Response(null, { status: 204 });
}

/** Docs in `scope` (null: every space), favorites first; `?project=` narrows them to one project, in any case. */
export async function listDocs(req: Request, env: Env, scope: string | null, project = new URL(req.url).searchParams.get("project")): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM docs WHERE (?1 IS NULL OR space_id = ?1) AND (?2 IS NULL OR project = ?2 COLLATE NOCASE) ORDER BY favorite DESC, updated_at DESC")
    .bind(scope, project)
    .all<Doc>();
  return json(results.map((d) => docJson(req, d)));
}

/**
 * A doc and its version history. `views`: how often readers opened it (see view.ts), counted only while view statistics
 * are on, with `days`: views per day over the last 30, in the time zone `?tz=` names (getTimezoneOffset() minutes; UTC without it).
 */
export async function getDoc(req: Request, env: Env, ref: string, scope: string | null): Promise<Response> {
  const doc = await findDoc(env, ref, scope);
  if (!doc) return json({ error: "doc not found" }, 404);
  const tz = Number(new URL(req.url).searchParams.get("tz") ?? 0);
  const shift = Number.isInteger(tz) && Math.abs(tz) <= 840 ? tz * 60_000 : 0;
  const [versions, views, days] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      "SELECT v.n, v.message, v.size, v.created_at AS createdAt, v.key_id AS keyId, k.name AS keyName, v.disabled, (SELECT COUNT(*) FROM files f WHERE f.doc_id = v.doc_id AND f.n = v.n) AS files, (SELECT COUNT(*) FROM views w WHERE w.doc_id = v.doc_id AND w.n = v.n) AS views FROM versions v LEFT JOIN api_keys k ON k.id = v.key_id WHERE v.doc_id = ? ORDER BY v.n DESC",
    ).bind(doc.id),
    env.DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT visitor) AS readers, MAX(at) AS lastAt FROM views WHERE doc_id = ?").bind(doc.id),
    env.DB.prepare("SELECT CAST((at - ?2) / 86400000 AS INTEGER) AS day, COUNT(*) AS views FROM views WHERE doc_id = ?1 AND at >= ?3 GROUP BY 1").bind(doc.id, shift, Date.now() - 31 * DAY),
  ]);
  return json({ ...docJson(req, doc), views: { ...views.results[0], days: days.results }, versions: versions.results.map((v) => ({ ...v, disabled: v.disabled === 1 })) });
}

/** Columns of one upload, for a `FROM versions v` query. */
export const UPLOAD_SELECT =
  "SELECT v.doc_id AS docId, v.n, v.message, v.size, v.created_at AS createdAt, v.key_id AS keyId, k.name AS keyName, (SELECT COUNT(*) FROM files f WHERE f.doc_id = v.doc_id AND f.n = v.n) AS files FROM versions v LEFT JOIN api_keys k ON k.id = v.key_id";

/** The newest uploads across all docs in `scope` (null: every space), newest first. A doc's own versions are complete in `getDoc`; this is capped. */
export async function listUploads(env: Env, scope: string | null): Promise<Response> {
  // rowid breaks ties between versions committed in the same millisecond.
  const { results } = await env.DB.prepare(
    `${UPLOAD_SELECT} WHERE ?1 IS NULL OR v.doc_id IN (SELECT id FROM docs WHERE space_id = ?1) ORDER BY v.created_at DESC, v.rowid DESC LIMIT 200`,
  )
    .bind(scope)
    .all();
  return json(results);
}

export async function patchDoc(req: Request, env: Env, ref: string, caller: Caller | null): Promise<Response> {
  const doc = await findDoc(env, ref, caller?.scope);
  if (!doc) return json({ error: "doc not found" }, 404);
  const body = (await req.json().catch(() => null)) as Settings | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const cols = await settingsColumns(env, body, doc, caller);
  if (cols instanceof Response) return cols;
  if (!Object.keys(cols).length) return json(docJson(req, doc));
  cols.updated_at = Date.now();
  try {
    await updateStmt(env, doc.id, cols).run();
  } catch (e) {
    if (String(e).includes("UNIQUE constraint failed: docs.slug")) return json({ error: "slug is taken" }, 409);
    throw e;
  }
  return json(docJson(req, (await findDoc(env, doc.id))!));
}

/** Deletes the rows only; the daily sweep removes blobs nothing references. */
export async function deleteDoc(env: Env, ref: string, caller: Caller | null): Promise<Response> {
  const doc = await findDoc(env, ref, caller?.scope);
  if (!doc) return json({ error: "doc not found" }, 404);
  if (caller && !caller.canDelete) return json({ error: "keys in this space can't delete docs; the owner can, from the dashboard" }, 403);
  await env.DB.prepare("DELETE FROM docs WHERE id = ?").bind(doc.id).run();
  return new Response(null, { status: 204 });
}

/**
 * Turns versions of a doc off or back on: `{ "versions": [2, 3], "disabled": true }`. A disabled version keeps its files
 * but stops answering at its pinned link. The current version can't be disabled, so the doc's own link always serves something.
 */
export async function patchVersions(req: Request, env: Env, ref: string, caller: Caller | null): Promise<Response> {
  const doc = await findDoc(env, ref, caller?.scope);
  if (!doc) return json({ error: "doc not found" }, 404);
  const body = (await req.json().catch(() => null)) as { versions?: unknown; disabled?: unknown } | null;
  const ns = body && Array.isArray(body.versions) && body.versions.every(Number.isSafeInteger) ? [...new Set(body.versions as number[])] : [];
  if (!ns.length || typeof body?.disabled !== "boolean") return json({ error: "versions: version numbers; disabled: boolean" }, 400);
  if (body.disabled && ns.includes(doc.latest)) return json({ error: `version ${doc.latest} is the current one and can't be disabled; upload a new version first` }, 400);
  const list = JSON.stringify(ns);
  const found = await env.DB.prepare("SELECT COUNT(*) AS c FROM versions WHERE doc_id = ? AND n IN (SELECT value FROM json_each(?))").bind(doc.id, list).first<number>("c");
  if (found !== ns.length) return json({ error: "version not found" }, 404);
  await env.DB.prepare("UPDATE versions SET disabled = ? WHERE doc_id = ? AND n IN (SELECT value FROM json_each(?))").bind(body.disabled ? 1 : 0, doc.id, list).run();
  return new Response(null, { status: 204 });
}

/** The most docs one bulk call may name; as many as the dashboard's log can show. */
const BULK_MAX = 200;
/** The settings that make sense for many docs at once. A title, slug or password belongs to one doc. */
const BULK_SETTINGS = ["favorite", "expires", "project", "space"];

/**
 * Deletes or changes many docs at once, all or nothing. `ids`: ids or slugs; then `delete: true`, or the settings every doc gets.
 * Any doc not found (or outside the caller's space) fails the whole call, so nothing changes.
 */
export async function bulkDocs(req: Request, env: Env, caller: Caller | null): Promise<Response> {
  const body = (await req.json().catch(() => null)) as (Settings & { ids?: unknown; delete?: unknown }) | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const { ids, delete: del, ...settings } = body;
  if (!Array.isArray(ids) || !ids.length || ids.length > BULK_MAX || !ids.every((r) => typeof r === "string")) return json({ error: `ids: 1 to ${BULK_MAX} doc ids or slugs` }, 400);
  if (Object.keys(settings).some((k) => !BULK_SETTINGS.includes(k))) return json({ error: `only ${BULK_SETTINGS.join(", ")} can be set on many docs at once` }, 400);
  if (del !== undefined && (del !== true || Object.keys(settings).length)) return json({ error: "delete: true, with no settings" }, 400);
  if (del && caller && !caller.canDelete) return json({ error: "keys in this space can't delete docs; the owner can, from the dashboard" }, 403);

  const refs = ids.map((r: string) => r.toLowerCase());
  // One query for every doc, not one per doc: D1 limits queries per request.
  const { results: docs } = await env.DB.prepare("SELECT * FROM docs WHERE (id IN (SELECT value FROM json_each(?1)) OR slug IN (SELECT value FROM json_each(?1))) AND (?2 IS NULL OR space_id = ?2)")
    .bind(JSON.stringify(refs), caller?.scope ?? null)
    .all<Doc>();
  const missing = refs.filter((r) => !docs.some((d) => d.id === r || d.slug === r));
  if (missing.length) return json({ error: `not found: ${missing.join(", ")}` }, 404);
  const idsOf = (ds: Doc[]) => JSON.stringify(ds.map((d) => d.id));

  if (del) {
    await env.DB.prepare("DELETE FROM docs WHERE id IN (SELECT value FROM json_each(?))").bind(idsOf(docs)).run();
    return new Response(null, { status: 204 });
  }
  // A project's spelling is per space, so the columns are worked out once per space the docs are in.
  const stmts: D1PreparedStatement[] = [];
  for (const space of new Set(docs.map((d) => d.space_id))) {
    const inSpace = docs.filter((d) => d.space_id === space);
    const cols = await settingsColumns(env, { ...settings }, inSpace[0], caller);
    if (cols instanceof Response) return cols;
    if (!Object.keys(cols).length) continue;
    cols.updated_at = Date.now();
    stmts.push(env.DB.prepare(`UPDATE docs SET ${Object.keys(cols).map((k) => `${k} = ?`).join(", ")} WHERE id IN (SELECT value FROM json_each(?))`).bind(...Object.values(cols), idsOf(inSpace)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const { results } = await env.DB.prepare("SELECT * FROM docs WHERE id IN (SELECT value FROM json_each(?)) ORDER BY favorite DESC, updated_at DESC").bind(idsOf(docs)).all<Doc>();
  return json(results.map((d) => docJson(req, d)));
}

/**
 * Daily cron: drops expired docs, then deletes blobs no version references.
 * Blobs uploaded in the last day are kept so a push in progress never loses its uploads.
 * shortcut: a day-old orphan blob re-pushed in the same second the sweep deletes it is lost; fine for one owner.
 */
export async function sweep(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM docs WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(now).run();
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: "docs/", cursor });
    const old = page.objects.filter((o) => o.uploaded.getTime() < now - DAY).map((o) => o.key.slice("docs/".length));
    if (old.length) {
      const { results } = await env.DB.prepare("SELECT DISTINCT sha256 FROM files WHERE sha256 IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(old))
        .all<{ sha256: string }>();
      const used = new Set(results.map((r) => r.sha256));
      const dead = old.filter((s) => !used.has(s)).map((s) => `docs/${s}`);
      if (dead.length) await env.BUCKET.delete(dead);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
