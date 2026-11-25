import { type Doc, MAX_FILES, SHA, SLUG, SLUG_LIMIT, appSettings, validPath } from "./api";
import { hashPassword } from "./auth";
import { docId, json, randomId, sha256Hex } from "./util";

const enc = new TextEncoder();
const BLOCK = 512;

/** A ustar header. Names over 100 bytes are cut here; `paxHeader` before it carries the full one. */
function header(name: string, size: number, mtimeMs: number, type: "0" | "1" | "x" = "0", link = ""): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const put = (s: string, at: number, len: number) => h.set(enc.encode(s).subarray(0, len), at);
  const octal = (v: number, len: number) => put(v.toString(8).padStart(len - 1, "0"), at(len), len);
  let pos = 0;
  const at = (len: number) => ((pos += len), pos - len);
  put(name, at(100), 100);
  put("0000644", at(8), 8);
  octal(0, 8); // uid
  octal(0, 8); // gid
  octal(size, 12);
  octal(Math.floor(mtimeMs / 1000), 12);
  put("        ", at(8), 8); // the checksum counts its own field as spaces
  put(type, at(1), 1);
  put(link, at(100), 100);
  put("ustar\x0000", at(8), 8);
  put(`${h.reduce((a, b) => a + b, 0).toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

/** PAX records ("<len> path=<value>\n", `len` counting itself) for names ustar can't hold: over 100 bytes. */
function paxHeader(fields: Record<string, string>): Uint8Array | null {
  let body = "";
  for (const [k, v] of Object.entries(fields)) {
    if (enc.encode(v).length <= 100) continue;
    const rest = enc.encode(` ${k}=${v}\n`).length;
    let len = rest + 1;
    while (String(len).length + rest !== len) len = String(len).length + rest;
    body += `${len} ${k}=${v}\n`;
  }
  return body ? enc.encode(body) : null;
}

/** Writes one tar entry: a PAX header when a name is long, the header, the bytes, and zeros up to a whole block. */
async function entry(w: WritableStreamDefaultWriter<Uint8Array>, name: string, mtimeMs: number, data: Uint8Array | ReadableStream<Uint8Array> | null, size: number, link = "") {
  const pad = (n: number) => (n % BLOCK ? w.write(new Uint8Array(BLOCK - (n % BLOCK))) : undefined);
  const pax = paxHeader({ path: name, linkpath: link });
  if (pax) {
    await w.write(header("PaxHeader", pax.length, mtimeMs, "x"));
    await w.write(pax);
    await pad(pax.length);
  }
  await w.write(header(name, size, mtimeMs, link ? "1" : "0", link));
  if (data instanceof Uint8Array) await w.write(data);
  else if (data) for await (const chunk of data) await w.write(chunk);
  await pad(size);
}

type FileRow = { doc_id: string; n: number; path: string; sha256: string; size: number };
type VersionRow = { doc_id: string; n: number; message: string | null; size: number; keyId: string | null; createdAt: number };

/**
 * GET /dashboard/api/export[?space=<id>][&passwords=1]: every doc (expired ones too), every version and its files as a tar,
 * with `shelf.json` last describing it all: spaces, keys (never their hashes), settings, docs and versions. Files sit at
 * `docs/<id>/<n>/<path>`; a file a later version kept unchanged is a hard link to its first copy, so the archive holds each blob once.
 * Tar rather than zip: no checksum over the bytes, so R2 streams straight through without using the Worker's CPU time.
 * Passwords stay out unless `passwords=1`: then each locked doc carries its password hash, so an import restores the lock.
 * The unlock cookie is an HMAC keyed by that hash, so such a file opens those docs without cracking anything.
 */
export async function exportShelf(env: Env, space: string | null, passwords: boolean): Promise<Response> {
  if (space !== null && !(await env.DB.prepare("SELECT 1 FROM spaces WHERE id = ?").bind(space).first())) return json({ error: "space not found" }, 404);
  const inSpace = "(?1 IS NULL OR d.space_id = ?1)";
  const [docs, versions, files, spaces, keys] = await env.DB.batch<unknown>([
    env.DB.prepare(`SELECT * FROM docs d WHERE ${inSpace} ORDER BY d.created_at`).bind(space),
    env.DB.prepare(`SELECT v.doc_id, v.n, v.message, v.size, v.key_id AS keyId, v.created_at AS createdAt FROM versions v JOIN docs d ON d.id = v.doc_id WHERE ${inSpace} ORDER BY v.doc_id, v.n`).bind(space),
    env.DB.prepare(`SELECT f.doc_id, f.n, f.path, f.sha256, f.size FROM files f JOIN docs d ON d.id = f.doc_id WHERE ${inSpace} ORDER BY f.doc_id, f.n, f.path`).bind(space),
    env.DB.prepare("SELECT id, name, keys_delete AS keysDelete, keys_read_locked AS keysReadLocked, created_at AS createdAt FROM spaces WHERE ?1 IS NULL OR id = ?1 ORDER BY created_at").bind(space),
    env.DB.prepare(
      "SELECT id, name, space_id AS space, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt, quota_bytes AS quota, quota_strategy AS strategy FROM api_keys WHERE ?1 IS NULL OR space_id = ?1 ORDER BY created_at",
    ).bind(space),
  ]);
  const settings = await appSettings(env);
  const versionsOf = Map.groupBy(versions.results as VersionRow[], (v) => v.doc_id);
  const filesOf = Map.groupBy(files.results as FileRow[], (f) => `${f.doc_id}@${f.n}`);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const w = writable.getWriter();
  (async () => {
    const first = new Map<string, string>(); // sha256 → the archive path that holds its bytes
    const missing: string[] = [];
    const manifest = (docs.results as Doc[]).map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      locked: d.password_hash !== null,
      ...(passwords && d.password_hash && { passwordHash: d.password_hash }),
      favorite: d.favorite === 1,
      expiresAt: d.expires_at,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      space: d.space_id,
      latest: d.latest,
      versions: (versionsOf.get(d.id) ?? []).map(({ doc_id: _, ...v }) => ({ ...v, files: (filesOf.get(`${d.id}@${v.n}`) ?? []).map(({ path, sha256, size }) => ({ path, sha256, size })) })),
    }));
    for (const d of manifest) {
      for (const v of d.versions) {
        for (const f of v.files) {
          const name = `docs/${d.id}/${v.n}/${f.path}`;
          const link = first.get(f.sha256);
          if (link) {
            await entry(w, name, v.createdAt, null, 0, link);
            continue;
          }
          const obj = await env.BUCKET.get(`docs/${f.sha256}`);
          if (!obj) {
            missing.push(name);
            continue;
          }
          await entry(w, name, v.createdAt, obj.body, obj.size);
          first.set(f.sha256, name);
        }
      }
    }
    const now = Date.now();
    const spaceList = (spaces.results as { keysDelete: number; keysReadLocked: number }[]).map((s) => ({ ...s, keysDelete: s.keysDelete === 1, keysReadLocked: s.keysReadLocked === 1 }));
    const meta = enc.encode(JSON.stringify({ exportedAt: now, space, passwords, settings, spaces: spaceList, keys: keys.results, docs: manifest, missing }, null, 2));
    await entry(w, "shelf.json", now, meta, meta.length);
    await w.write(new Uint8Array(2 * BLOCK));
    await w.close();
  })().catch((e) => w.abort(e));

  const date = new Date().toISOString().slice(0, 10);
  return new Response(readable, {
    headers: {
      "content-type": "application/x-tar",
      "content-disposition": `attachment; filename="shelf-${date}${space ? `-${space}` : ""}.tar"`,
      "cache-control": "no-store",
    },
  });
}

const SPACE_ID = /^[A-Za-z0-9_]{1,32}$/;
const KEY_ID = /^k_[A-Za-z0-9]{1,32}$/;
const DOC_ID = /^[a-z0-9-]{1,64}$/;
const PASSWORD_HASH = /^pbkdf2\$(\d{1,6})\$[0-9a-f]{32}\$[0-9a-f]{64}$/;
/** verifyPassword runs a hash's own iteration count, so an imported one can't cost more CPU than this per attempt. */
const MAX_ITERATIONS = 100_000;
/** Docs per import request: each one is a few statements, and their files go in as one JSON parameter per doc. */
const IMPORT_DOCS = 50;
/** New blobs one import request may check in R2, one subrequest each: as many as one version may hold, like a push. */
const IMPORT_HEADS = MAX_FILES;

type ImportFile = { path: string; sha256: string };
type ImportVersion = { n: number; message: string | null; keyId: string | null; createdAt: number; files: ImportFile[] };
type ImportDoc = {
  id: string;
  slug: string | null;
  title: string | null;
  locked: boolean;
  passwordHash?: string;
  favorite: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  space: string;
  versions: ImportVersion[];
};
type ImportSpace = { id: string; name: string; keysDelete: boolean; keysReadLocked: boolean; createdAt: number };
type ImportKey = { id: string; name: string; space: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null; quota: number | null; strategy: "reject" | "fifo" };

const time = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

/** Why a doc from shelf.json can't be imported, or null. The file came from the owner, but it is still outside input. */
function docProblem(d: ImportDoc): string | null {
  if (!d || typeof d !== "object" || typeof d.id !== "string" || !DOC_ID.test(d.id)) return "a doc has a bad id";
  const at = `doc ${d.id}`;
  if (d.slug !== null && !(typeof d.slug === "string" && d.slug.length >= 3 && d.slug.length <= SLUG_LIMIT && SLUG.test(d.slug))) return `${at}: bad slug`;
  if (d.title !== null && !text(d.title, 200)) return `${at}: bad title`;
  if (typeof d.locked !== "boolean" || typeof d.favorite !== "boolean") return `${at}: locked and favorite must be booleans`;
  if (d.passwordHash !== undefined) {
    const m = typeof d.passwordHash === "string" ? PASSWORD_HASH.exec(d.passwordHash) : null;
    if (!m || !d.locked || Number(m[1]) < 1 || Number(m[1]) > MAX_ITERATIONS) return `${at}: bad password hash`;
  }
  if (d.slug !== null && !d.locked) return `${at}: a slug needs a password`;
  if (!(d.expiresAt === null || time(d.expiresAt)) || !time(d.createdAt) || !time(d.updatedAt)) return `${at}: bad times`;
  if (typeof d.space !== "string" || !SPACE_ID.test(d.space)) return `${at}: bad space`;
  if (!Array.isArray(d.versions) || !d.versions.length) return `${at}: no versions`;
  const ns = new Set<number>();
  for (const v of d.versions) {
    if (!v || !Number.isSafeInteger(v.n) || v.n < 1 || ns.has(v.n)) return `${at}: bad version number`;
    ns.add(v.n);
    if (v.message !== null && !text(v.message, 1000)) return `${at} v${v.n}: bad message`;
    if (v.keyId !== null && !(typeof v.keyId === "string" && KEY_ID.test(v.keyId))) return `${at} v${v.n}: bad key id`;
    if (!time(v.createdAt)) return `${at} v${v.n}: bad time`;
    if (!Array.isArray(v.files) || !v.files.length || v.files.length > MAX_FILES) return `${at} v${v.n}: 1 to ${MAX_FILES} files`;
    const paths = new Set<string>();
    for (const f of v.files) {
      if (!f || typeof f.path !== "string" || !validPath(f.path) || paths.has(f.path) || typeof f.sha256 !== "string" || !SHA.test(f.sha256)) return `${at} v${v.n}: bad file`;
      paths.add(f.path);
    }
    if (paths.size > 1 && !paths.has("index.html")) return `${at} v${v.n}: a folder needs an index.html`;
  }
  return null;
}

/** The ids and slugs among `refs` that a doc on the shelf already uses, as an id or a slug: either would make a link ambiguous. */
async function takenRefs(env: Env, refs: string[]): Promise<Set<string>> {
  const { results } = await env.DB.prepare("SELECT id, slug FROM docs WHERE id IN (SELECT value FROM json_each(?1)) OR slug IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(refs))
    .all<{ id: string; slug: string | null }>();
  return new Set(results.flatMap((r) => [r.id, r.slug ?? ""]).filter(Boolean));
}

const refsOf = (docs: ImportDoc[]) => docs.flatMap((d) => (d.slug ? [d.id, d.slug] : [d.id]));
const shasOf = (docs: ImportDoc[]) => [...new Set(docs.flatMap((d) => d.versions.flatMap((v) => v.files.map((f) => f.sha256))))];

/**
 * POST /dashboard/api/import/check {docs}: before an import, which docs clash with one on the shelf (`conflicts`, their ids)
 * and which blobs to upload first (`missing`). A blob counts as present only while a version uses it: the daily sweep may
 * have deleted any other, so those get uploaded again.
 */
export async function importCheck(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { docs?: ImportDoc[] } | null;
  if (!body || !Array.isArray(body.docs)) return json({ error: "docs: an array from shelf.json required" }, 400);
  for (const d of body.docs) {
    const problem = docProblem(d);
    if (problem) return json({ error: problem }, 400);
  }
  const taken = await takenRefs(env, refsOf(body.docs));
  const shas = shasOf(body.docs);
  const { results } = await env.DB.prepare("SELECT DISTINCT sha256 FROM files WHERE sha256 IN (SELECT value FROM json_each(?))").bind(JSON.stringify(shas)).all<{ sha256: string }>();
  const known = new Set(results.map((r) => r.sha256));
  return json({ conflicts: body.docs.filter((d) => taken.has(d.id) || (d.slug && taken.has(d.slug))).map((d) => d.id), missing: shas.filter((s) => !known.has(s)) });
}

/**
 * POST /dashboard/api/import {spaces, keys, docs, copies}: restores docs from shelf.json, up to IMPORT_DOCS per request, with
 * their versions, times, favorites, expiry and space. Their blobs must be uploaded first (importCheck lists them).
 * - A doc whose id or slug is taken is skipped, unless `copies` names it: then it gets a new id, and its slug only if free.
 * - A locked doc without a password hash (a backup made without them) stays locked behind a random password nobody knows,
 *   so it never turns public; `needPassword` lists them for the owner to set a new one.
 * - Spaces come back by id (renamed if their name is taken); keys come back revoked, since only their hashes ever existed,
 *   so their uploads keep their names. Settings aren't touched.
 */
export async function importShelf(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { spaces?: ImportSpace[]; keys?: ImportKey[]; docs?: ImportDoc[]; copies?: string[] } | null;
  if (!body || !Array.isArray(body.docs) || body.docs.length > IMPORT_DOCS) return json({ error: `docs: up to ${IMPORT_DOCS} from shelf.json` }, 400);
  const spaces = body.spaces ?? [];
  const keys = body.keys ?? [];
  const copies = new Set(Array.isArray(body.copies) ? body.copies : []);
  if (!Array.isArray(spaces) || !spaces.every((s) => s && SPACE_ID.test(s.id) && typeof s.name === "string" && s.name.trim().length >= 1 && s.name.length <= 64 && typeof s.keysDelete === "boolean" && typeof s.keysReadLocked === "boolean" && time(s.createdAt))) {
    return json({ error: "spaces: bad entry" }, 400);
  }
  if (
    !Array.isArray(keys) ||
    !keys.every((k) => k && KEY_ID.test(k.id) && text(k.name, 200) && SPACE_ID.test(k.space) && time(k.createdAt) && (k.lastUsedAt === null || time(k.lastUsedAt)) && (k.revokedAt === null || time(k.revokedAt)) && (k.quota === null || time(k.quota)) && (k.strategy === "reject" || k.strategy === "fifo"))
  ) {
    return json({ error: "keys: bad entry" }, 400);
  }
  for (const d of body.docs) {
    const problem = docProblem(d);
    if (problem) return json({ error: problem }, 400);
  }

  // Sizes come from the shelf and R2, never from the file.
  const shas = shasOf(body.docs);
  const { results: known } = await env.DB.prepare("SELECT sha256, MAX(size) AS size FROM files WHERE sha256 IN (SELECT value FROM json_each(?)) GROUP BY 1")
    .bind(JSON.stringify(shas))
    .all<{ sha256: string; size: number }>();
  const sizeOf = new Map(known.map((r) => [r.sha256, r.size]));
  const unknown = shas.filter((s) => !sizeOf.has(s));
  if (unknown.length > IMPORT_HEADS) return json({ error: `too many new files in one request; send fewer docs` }, 400);
  const heads = await Promise.all(unknown.map((s) => env.BUCKET.head(`docs/${s}`)));
  const missing = unknown.filter((_, i) => !heads[i]);
  if (missing.length) return json({ error: "upload these files first", missing }, 409);
  unknown.forEach((s, i) => sizeOf.set(s, heads[i]!.size));

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const { results: have } = await env.DB.prepare("SELECT id, name FROM spaces").all<{ id: string; name: string }>();
  const spaceIds = new Set(have.map((s) => s.id));
  const names = new Set(have.map((s) => s.name));
  for (const s of spaces) {
    if (spaceIds.has(s.id)) continue;
    const name = [s.name.trim(), `${s.name.trim()} (imported)`, `${s.name.trim()} (${s.id})`].find((n) => !names.has(n))!;
    spaceIds.add(s.id);
    names.add(name);
    stmts.push(env.DB.prepare("INSERT INTO spaces (id, name, keys_delete, keys_read_locked, created_at) VALUES (?, ?, ?, ?, ?)").bind(s.id, name, s.keysDelete ? 1 : 0, s.keysReadLocked ? 1 : 0, s.createdAt));
  }
  const spaceOf = (id: string) => (spaceIds.has(id) ? id : "default");
  for (const k of keys) {
    stmts.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO api_keys (id, name, hash, created_at, last_used_at, revoked_at, quota_bytes, quota_strategy, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(k.id, k.name, await sha256Hex(randomId(32)), k.createdAt, k.lastUsedAt, k.revokedAt ?? now, k.quota, k.strategy, spaceOf(k.space)),
    );
  }

  const taken = await takenRefs(env, refsOf(body.docs));
  const out = { imported: [] as string[], copied: [] as { from: string; to: string }[], skipped: [] as string[], needPassword: [] as string[] };
  for (const d of body.docs) {
    const clash = taken.has(d.id) || (d.slug !== null && taken.has(d.slug));
    if (clash && !copies.has(d.id)) {
      out.skipped.push(d.id);
      continue;
    }
    const id = taken.has(d.id) ? docId() : d.id;
    const slug = d.slug !== null && !taken.has(d.slug) ? d.slug : null;
    taken.add(id);
    if (slug) taken.add(slug);
    let hash = d.passwordHash ?? null;
    if (d.locked && !hash) {
      hash = await hashPassword(randomId(32));
      out.needPassword.push(id);
    }
    const versions = await Promise.all(
      [...d.versions]
        .sort((a, b) => a.n - b.n)
        .map(async (v) => {
          const files = v.files.map((f) => ({ n: v.n, path: f.path, sha256: f.sha256, size: sizeOf.get(f.sha256)! }));
          const manifest = await sha256Hex(files.map((f) => `${f.path}\t${f.sha256}`).sort().join("\n"));
          return { n: v.n, manifest, message: v.message, size: files.reduce((sum, f) => sum + f.size, 0), keyId: v.keyId, createdAt: v.createdAt, files };
        }),
    );
    stmts.push(
      env.DB.prepare("INSERT INTO docs (id, slug, title, password_hash, favorite, expires_at, latest, created_at, updated_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(
        id,
        slug,
        d.title,
        hash,
        d.favorite ? 1 : 0,
        d.expiresAt,
        versions.at(-1)!.n,
        d.createdAt,
        d.updatedAt,
        spaceOf(d.space),
      ),
      env.DB.prepare(
        "INSERT INTO versions (doc_id, n, manifest_hash, message, size, key_id, created_at) SELECT ?1, value->>'n', value->>'manifest', value->>'message', value->>'size', value->>'keyId', value->>'createdAt' FROM json_each(?2)",
      ).bind(id, JSON.stringify(versions.map(({ files: _, ...v }) => v))),
      env.DB.prepare("INSERT INTO files (doc_id, n, path, sha256, size) SELECT ?1, value->>'n', value->>'path', value->>'sha256', value->>'size' FROM json_each(?2)").bind(
        id,
        JSON.stringify(versions.flatMap((v) => v.files)),
      ),
    );
    if (id === d.id && slug === d.slug) out.imported.push(id);
    else out.copied.push({ from: d.id, to: id });
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json(out);
}
