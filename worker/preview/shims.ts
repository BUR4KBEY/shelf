// Stand-ins for the Cloudflare bindings src/ uses, so the real Worker code runs in a service worker.
// D1 is SQLite in memory (sql.js), snapshotted to IndexedDB; R2 objects live in IndexedDB. Nothing leaves the browser.
import type { Database, SqlValue } from "sql.js";
import { hex } from "../src/util";

const idb = (() => {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open("shelf-preview", 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore("blobs");
    req.result.createObjectStore("state");
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
})();

export async function store<T>(name: "blobs" | "state", mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await idb).transaction(name, mode);
  const req = op(tx.objectStore(name));
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  tx.oncomplete = () => resolve(req.result);
  tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
  return promise;
}

class Statement {
  constructor(
    private db: Database,
    private sql: string,
    private params: unknown[] = [],
  ) { }
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }
  /** Synchronous, so a batch runs as one uninterrupted transaction. */
  result() {
    const s = this.db.prepare(this.sql);
    try {
      s.bind(this.params as SqlValue[]);
      const results: Record<string, unknown>[] = [];
      while (s.step()) results.push(s.getAsObject());
      return { results, success: true, meta: { changes: this.db.getRowsModified() } };
    } finally {
      s.free();
    }
  }
  async all() {
    return this.result();
  }
  async run() {
    return this.result();
  }
  async first(column?: string) {
    const row = this.result().results[0] ?? null;
    return column && row ? row[column] : row;
  }
}

/** The D1 calls src/ makes: prepare, bind, first, all, run, batch. */
export const d1 = (db: Database) => ({
  prepare: (sql: string) => new Statement(db, sql),
  async batch(stmts: Statement[]) {
    db.run("BEGIN");
    try {
      const out = stmts.map((s) => s.result());
      db.run("COMMIT");
      return out;
    } catch (e) {
      db.run("ROLLBACK");
      throw e;
    }
  },
});

type Stored = { bytes: Uint8Array; uploaded: number };

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` as the offset and length R2 reports; throws when it can't be served, as R2 does. */
function range(header: string, size: number) {
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) throw new Error("bad range");
  const offset = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0);
  if (offset >= size) throw new Error("range not satisfiable");
  return { offset, length: (m[1] && m[2] ? Math.min(Number(m[2]) + 1, size) : size) - offset };
}

/** The R2 calls src/ makes: put (with its sha256 check), head, get (with a range), list, delete. */
export const r2 = {
  async put(key: string, body: BodyInit | null, opts: { sha256?: string } = {}) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    if (opts.sha256 && hex(await crypto.subtle.digest("SHA-256", bytes)) !== opts.sha256) throw new Error("the bytes don't match their sha256");
    await store("blobs", "readwrite", (s) => s.put({ bytes, uploaded: Date.now() } satisfies Stored, key));
  },
  async head(key: string) {
    const b = await store<Stored | undefined>("blobs", "readonly", (s) => s.get(key));
    return b ? { key, size: b.bytes.byteLength, uploaded: new Date(b.uploaded) } : null;
  },
  async get(key: string, opts: { range?: Headers } = {}) {
    const b = await store<Stored | undefined>("blobs", "readonly", (s) => s.get(key));
    if (!b) return null;
    const size = b.bytes.byteLength;
    const header = opts.range?.get("range");
    const r = header ? range(header, size) : undefined;
    const bytes = r ? b.bytes.subarray(r.offset, r.offset + r.length) : b.bytes;
    return { key, size, range: r, body: bytes, text: async () => new TextDecoder().decode(bytes) };
  },
  async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
    const keys = await store<IDBValidKey[]>("blobs", "readonly", (s) => s.getAllKeys());
    const blobs = await store<Stored[]>("blobs", "readonly", (s) => s.getAll());
    const objects = keys.map((k, i) => ({ key: String(k), size: blobs[i].bytes.byteLength, uploaded: new Date(blobs[i].uploaded) })).filter((o) => o.key.startsWith(prefix));
    return { objects, truncated: false };
  },
  async delete(keys: string | string[]) {
    for (const k of [keys].flat()) await store("blobs", "readwrite", (s) => s.delete(k));
  },
};
