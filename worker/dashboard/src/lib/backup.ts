import { api } from "./api";
import { progress, uploadBlobs } from "./upload";

/** One doc in a backup's shelf.json, as the Worker's export writes it (src/backup.ts). */
export type BackupDoc = {
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
  versions: { n: number; message: string | null; keyId: string | null; createdAt: number; files: { path: string; sha256: string }[] }[];
};
export type Backup = { spaces: unknown[]; keys: unknown[]; docs: BackupDoc[] };
/** What an import did: doc ids imported as they were, copies with their new id, skipped conflicts, and locked docs that came without a password. */
export type ImportResult = { imported: string[]; copied: { from: string; to: string }[]; skipped: string[]; needPassword: string[] };

/** Docs and new blobs per import request: the Worker's limits (IMPORT_DOCS, IMPORT_HEADS in src/backup.ts). */
const CHUNK_DOCS = 50;
const CHUNK_BLOBS = 1000;

/**
 * The regular files of a tar the Worker exported (ustar, PAX names for long paths), by path. Hard links are left out:
 * their bytes sit at the first copy, which shelf.json reaches by hash.
 * shortcut: reads the whole archive into memory; stream it if backups outgrow the browser's memory.
 */
function readTar(buf: Uint8Array): Map<string, Uint8Array> {
  const dec = new TextDecoder();
  const field = (at: number, len: number) => dec.decode(buf.subarray(at, at + len)).replace(/\0.*$/s, "");
  const files = new Map<string, Uint8Array>();
  let pax: Record<string, string> = {};
  for (let at = 0; at + 512 <= buf.length && buf[at] !== 0;) {
    const size = parseInt(field(at + 124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || at + 512 + size > buf.length) throw new Error("This archive is damaged or isn't a tar file.");
    const type = field(at + 156, 1);
    const body = buf.subarray(at + 512, at + 512 + size);
    if (type === "x") pax = Object.fromEntries([...dec.decode(body).matchAll(/\d+ ([^=]+)=([^\n]*)\n/g)].map((m) => [m[1], m[2]]));
    else {
      if (type === "0" || type === "") files.set(pax.path ?? field(at, 100), body);
      pax = {};
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** A backup's shelf.json, and every blob it needs by sha256, read from the archive. */
export async function readBackup(file: File): Promise<{ backup: Backup; blobs: Map<string, Uint8Array> }> {
  const files = readTar(new Uint8Array(await file.arrayBuffer()));
  const json = files.get("shelf.json");
  if (!json) throw new Error("This isn't a shelf backup: it has no shelf.json.");
  const backup = JSON.parse(new TextDecoder().decode(json)) as Backup;
  if (!Array.isArray(backup.docs)) throw new Error("This isn't a shelf backup: shelf.json lists no docs.");
  const blobs = new Map<string, Uint8Array>();
  for (const d of backup.docs) {
    for (const v of d.versions) {
      for (const f of v.files) {
        const bytes = files.get(`docs/${d.id}/${v.n}/${f.path}`);
        if (bytes && !blobs.has(f.sha256)) blobs.set(f.sha256, bytes);
      }
    }
  }
  return { backup, blobs };
}

/** Which docs clash with the shelf (their ids), and which blobs the shelf lacks. */
export const checkBackup = (backup: Backup) => api<{ conflicts: string[]; missing: string[] }>("/import/check", { method: "POST", json: { docs: backup.docs } });

/**
 * Uploads the blobs the shelf lacks, then sends the docs in chunks the Worker accepts. Docs in `conflicts` are skipped,
 * or, with `copy`, imported with new links. Spaces and keys go with every chunk; the Worker adds each only once.
 */
export async function restore(backup: Backup, blobs: Map<string, Uint8Array>, missing: string[], conflicts: string[], copy: boolean): Promise<ImportResult> {
  if (missing.some((sha) => !blobs.has(sha))) throw new Error("The backup is missing a file shelf.json lists. Nothing was imported.");
  // Nothing is imported until every blob is in.
  await uploadBlobs(missing, (sha) => new Blob([blobs.get(sha)! as BlobPart]));

  const skip = new Set(copy ? [] : conflicts);
  const docs = backup.docs.filter((d) => !skip.has(d.id));
  const out: ImportResult = { imported: [], copied: [], skipped: [...skip], needPassword: [] };
  const fresh = new Set(missing); // blobs no version on the shelf uses yet: the Worker checks each in R2
  let chunk: typeof docs = [];
  let chunkFresh = new Set<string>();
  const send = async () => {
    if (!chunk.length) return;
    const r = await api<ImportResult>("/import", { method: "POST", json: { spaces: backup.spaces, keys: backup.keys, docs: chunk, copies: copy ? conflicts : [] } });
    out.imported.push(...r.imported);
    out.copied.push(...r.copied);
    out.skipped.push(...r.skipped.filter((id) => !skip.has(id)));
    out.needPassword.push(...r.needPassword);
    for (const s of chunkFresh) fresh.delete(s);
    chunk = [];
    chunkFresh = new Set();
  };
  for (const [i, d] of docs.entries()) {
    progress(`Importing doc ${i + 1} of ${docs.length}…`, i, docs.length);
    const mine = new Set(d.versions.flatMap((v) => v.files.map((f) => f.sha256)).filter((s) => fresh.has(s) && !chunkFresh.has(s)));
    if (chunk.length >= CHUNK_DOCS || chunkFresh.size + mine.size > CHUNK_BLOBS) await send();
    chunk.push(d);
    for (const s of mine) chunkFresh.add(s);
  }
  await send();
  return out;
}
