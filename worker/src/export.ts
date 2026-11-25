import { type Doc, appSettings } from "./api";
import { json } from "./util";

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
 * GET /dashboard/api/export[?space=<id>]: every doc (expired ones too), every version and its files as a tar, with `shelf.json`
 * last describing it all: spaces, keys (never their hashes), settings, docs and versions. Files sit at `docs/<id>/<n>/<path>`;
 * a file a later version kept unchanged is a hard link to its first copy, so the archive holds each blob once.
 * Tar rather than zip: no checksum over the bytes, so R2 streams straight through without using the Worker's CPU time.
 * Passwords aren't exported, only whether a doc had one.
 */
export async function exportShelf(env: Env, space: string | null): Promise<Response> {
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
    const meta = enc.encode(JSON.stringify({ exportedAt: now, space, settings, spaces: spaceList, keys: keys.results, docs: manifest, missing }, null, 2));
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
