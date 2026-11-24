import { hashPassword } from "./auth";
import { docId, json, sha256Hex } from "./util";

const SHA = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const MAX_FILES = 1000;
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
}

/**
 * Finds a doc by id or slug, ignoring case: both are stored lowercase. An id wins a tie.
 * Expired docs are still returned so the owner can revive them.
 */
export const findDoc = (env: Env, ref: string) =>
  env.DB.prepare("SELECT * FROM docs WHERE id = ?1 OR slug = ?1 ORDER BY id = ?1 DESC LIMIT 1").bind(ref.toLowerCase()).first<Doc>();

const validPath = (p: string) =>
  p.length > 0 &&
  p.length <= 512 &&
  p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[\\\x00-\x1f]/.test(s));

const isOpt = (v: unknown, ok: (v: unknown) => boolean) => v === undefined || v === null || ok(v);
const DURATION = /^\d{1,4}[mhdw]$/;
const defaultExpires = (env: Env) => env.DB.prepare("SELECT value FROM settings WHERE key = 'default_expires'").first<string>("value");

/** App-wide settings, set from the dashboard. `defaultExpires` is the expiry a new doc gets when its push doesn't name one. */
export async function getAppSettings(env: Env): Promise<Response> {
  return json({ defaultExpires: await defaultExpires(env) });
}

export async function patchAppSettings(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { defaultExpires?: unknown } | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const d = body.defaultExpires;
  if (d !== undefined && !isOpt(d, (v) => typeof v === "string" && DURATION.test(v))) {
    return json({ error: "defaultExpires: a duration like 30m, 12h, 7d or 2w, or null for never" }, 400);
  }
  if (d === null) await env.DB.prepare("DELETE FROM settings WHERE key = 'default_expires'").run();
  else if (d !== undefined) await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('default_expires', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1").bind(d).run();
  return getAppSettings(env);
}

interface Settings {
  title?: string | null;
  slug?: string | null;
  password?: string | null;
  expires?: string | null;
  favorite?: boolean;
}

/**
 * Validates settings against the doc's current state and returns the columns to update,
 * or an error response. `null` clears a setting; `undefined` leaves it alone.
 */
async function settingsColumns(env: Env, s: Settings, doc: Doc | null): Promise<Record<string, unknown> | Response> {
  if (typeof s.slug === "string") s.slug = s.slug.toLowerCase();
  if (!isOpt(s.title, (v) => typeof v === "string" && v.length <= 200)) return json({ error: "title: up to 200 chars" }, 400);
  if (!isOpt(s.slug, (v) => typeof v === "string" && SLUG.test(v))) {
    return json({ error: "slug: 3 to 48 chars of a-z, 0-9 and -, not starting or ending with -" }, 400);
  }
  if (!isOpt(s.password, (v) => typeof v === "string" && v.length >= 8 && v.length <= 256)) {
    return json({ error: "password: 8 to 256 chars" }, 400);
  }
  const m = typeof s.expires === "string" ? /^(\d{1,5})([mhdw])$/.exec(s.expires) : null;
  const expiresMs = s.expires === "0" ? 0 : m ? Number(m[1]) * UNIT[m[2]] : NaN;
  if (!isOpt(s.expires, () => expiresMs <= 30 * DAY)) {
    return json({ error: "expires: a duration up to 30d like 30m, 12h, 7d or 2w; 0 or null for never" }, 400);
  }
  if (s.favorite !== undefined && typeof s.favorite !== "boolean") return json({ error: "favorite: boolean" }, 400);

  const cols: Record<string, unknown> = {};
  if (s.title !== undefined) cols.title = s.title;
  if (s.slug !== undefined) cols.slug = s.slug;
  if (s.password !== undefined) cols.password_hash = s.password === null ? null : await hashPassword(s.password);
  // A zero duration means never.
  if (s.expires !== undefined) cols.expires_at = s.expires === null || expiresMs === 0 ? null : Date.now() + expiresMs;
  if (s.favorite !== undefined) cols.favorite = s.favorite ? 1 : 0;

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
  url: `${new URL(req.url).origin}/view/${d.slug ?? d.id}`,
});

interface PushBody extends Settings {
  ref?: string;
  message?: string;
  files: { path: string; sha256: string }[];
}

/**
 * Commits a new version from a manifest. Blobs must already be in R2:
 * if any are missing, nothing is written and `{missing}` lists them.
 * Target doc: `ref` (id or slug), else the doc that owns `slug`, else a new doc.
 */
export async function push(req: Request, env: Env, keyId: string | null): Promise<Response> {
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
    doc = await findDoc(env, body.ref);
    if (!doc) return json({ error: "doc not found" }, 404);
  } else if (body.slug) {
    doc = await env.DB.prepare("SELECT * FROM docs WHERE slug = lower(?)").bind(body.slug).first<Doc>();
  }
  // A new doc that doesn't name an expiry gets the owner's default; `expires: null` still means never.
  if (!doc && body.expires === undefined) body.expires = await defaultExpires(env);
  const cols = await settingsColumns(env, body, doc);
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
  if (!doc) {
    const title = body.title ?? (files.length === 1 ? files[0].path : null);
    stmts.push(env.DB.prepare("INSERT INTO docs (id, title, latest, created_at, updated_at) VALUES (?, ?, 0, ?, ?)").bind(id, title, now, now));
  }
  if (Object.keys(cols).length) stmts.push(updateStmt(env, id, cols));
  if (created) {
    // One transaction; the version number is computed in SQL so concurrent pushes cannot collide.
    stmts.push(
      env.DB.prepare("UPDATE docs SET latest = latest + 1, updated_at = ? WHERE id = ?").bind(now, id),
      env.DB.prepare(
        "INSERT INTO versions (doc_id, n, manifest_hash, message, size, key_id, created_at) SELECT id, latest, ?, ?, ?, ?, ? FROM docs WHERE id = ?",
      ).bind(manifest, body.message ?? null, size, keyId, now, id),
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

/** Streams the body into R2. R2 rejects it if the bytes do not hash to `sha`. */
export async function putBlob(req: Request, env: Env, sha: string): Promise<Response> {
  if (!req.headers.has("content-length")) return json({ error: "content-length required" }, 411);
  try {
    await env.BUCKET.put(`docs/${sha}`, req.body ?? "", { sha256: sha });
  } catch (e) {
    return json({ error: `upload rejected: ${(e as Error).message}` }, 400);
  }
  return new Response(null, { status: 204 });
}

export async function listDocs(req: Request, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT * FROM docs ORDER BY favorite DESC, updated_at DESC").all<Doc>();
  return json(results.map((d) => docJson(req, d)));
}

export async function getDoc(req: Request, env: Env, ref: string): Promise<Response> {
  const doc = await findDoc(env, ref);
  if (!doc) return json({ error: "doc not found" }, 404);
  const { results } = await env.DB.prepare(
    "SELECT v.n, v.message, v.size, v.created_at AS createdAt, v.key_id AS keyId, k.name AS keyName, (SELECT COUNT(*) FROM files f WHERE f.doc_id = v.doc_id AND f.n = v.n) AS files FROM versions v LEFT JOIN api_keys k ON k.id = v.key_id WHERE v.doc_id = ? ORDER BY v.n DESC",
  )
    .bind(doc.id)
    .all();
  return json({ ...docJson(req, doc), versions: results });
}

/** The newest uploads across all docs, newest first. A doc's own versions are complete in `getDoc`; this is capped. */
export async function listUploads(env: Env): Promise<Response> {
  // rowid breaks ties between versions committed in the same millisecond.
  const { results } = await env.DB.prepare(
    "SELECT v.doc_id AS docId, v.n, v.message, v.size, v.created_at AS createdAt, v.key_id AS keyId, k.name AS keyName, (SELECT COUNT(*) FROM files f WHERE f.doc_id = v.doc_id AND f.n = v.n) AS files FROM versions v LEFT JOIN api_keys k ON k.id = v.key_id ORDER BY v.created_at DESC, v.rowid DESC LIMIT 200",
  ).all();
  return json(results);
}

export async function patchDoc(req: Request, env: Env, ref: string): Promise<Response> {
  const doc = await findDoc(env, ref);
  if (!doc) return json({ error: "doc not found" }, 404);
  const body = (await req.json().catch(() => null)) as Settings | null;
  if (!body || typeof body !== "object") return json({ error: "JSON object required" }, 400);
  const cols = await settingsColumns(env, body, doc);
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
export async function deleteDoc(env: Env, ref: string): Promise<Response> {
  const doc = await findDoc(env, ref);
  if (!doc) return json({ error: "doc not found" }, 404);
  await env.DB.prepare("DELETE FROM docs WHERE id = ?").bind(doc.id).run();
  return new Response(null, { status: 204 });
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
