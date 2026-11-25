// Stand-ins for the Cloudflare bindings src/ uses, for the Docker image: D1 is a SQLite file (bun:sqlite), R2 objects
// are files, and the rate limiter counts in memory (one process). preview/shims.ts does the same in the browser.
import { Database } from "bun:sqlite";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

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
    const q = this.db.query(this.sql);
    const params = this.params as never[];
    if (!q.columnNames.length) return { results: [], success: true, meta: { changes: q.run(...params).changes } };
    const results = q.all(...params) as Record<string, unknown>[];
    // A SELECT reports the last write's count, as sql.js does in the preview; only DELETE … RETURNING and the like read it.
    const { n } = this.db.query("SELECT changes() AS n").get() as { n: number };
    return { results, success: true, meta: { changes: n } };
  }
  async all() {
    return this.result();
  }
  async run() {
    return this.result();
  }
  async first(column?: string) {
    const row = this.result().results[0] ?? null;
    return column && row ? (row[column] ?? null) : row;
  }
}

/** Opens (or creates) the database and applies the migrations it hasn't had yet; `user_version` counts the ones applied. */
export function openDb(path: string, migrations: string[]): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000");
  const { user_version: applied } = db.query("PRAGMA user_version").get() as { user_version: number };
  // Off while migrating: a migration that rebuilds a table would otherwise cascade-delete its children. Checked after.
  db.exec("PRAGMA foreign_keys = OFF");
  for (const [i, sql] of migrations.entries()) {
    if (i >= applied) db.transaction(() => db.exec(`${sql};\nPRAGMA user_version = ${i + 1}`))();
  }
  const broken = db.query("PRAGMA foreign_key_check").all();
  if (broken.length) throw new Error(`migrations left broken foreign keys: ${JSON.stringify(broken.slice(0, 5))}`);
  db.exec("PRAGMA foreign_keys = ON"); // D1 enforces them; deleting a doc cascades to its versions
  return db;
}

/** The D1 calls src/ makes: prepare, bind, first, all, run, batch. */
export const d1 = (db: Database) => ({
  prepare: (sql: string) => new Statement(db, sql),
  batch: async (stmts: Statement[]) => db.transaction(() => stmts.map((s) => s.result()))(),
});

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` as the offset and length R2 reports; throws when it can't be served, as R2 does. */
export function range(header: string, size: number) {
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) throw new Error("bad range");
  const offset = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0);
  if (offset >= size) throw new Error("range not satisfiable");
  return { offset, length: (m[1] && m[2] ? Math.min(Number(m[2]) + 1, size) : size) - offset };
}

/** The R2 calls src/ makes: put (with its sha256 check), head, get (with a range), list, delete. One file per key under `root`. */
export function r2(root: string) {
  const file = (key: string) => {
    // src/ only uses `docs/<sha256>`; anything else (a `..`) never reaches the disk.
    if (!/^[a-z]+\/[0-9a-f]{64}$/.test(key)) throw new Error(`bad key ${key}`);
    return join(root, key);
  };
  const info = async (key: string) => {
    const s = await stat(file(key)).catch(() => null);
    return s && { key, size: s.size, uploaded: s.mtime };
  };
  return {
    /** Streams to a temporary file and renames it into place only when the bytes hash to `sha256`. */
    async put(key: string, body: BodyInit | null, opts: { sha256?: string } = {}) {
      const path = file(key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${crypto.randomUUID()}.tmp`;
      const hash = new Bun.CryptoHasher("sha256");
      const out = Bun.file(tmp).writer();
      try {
        try {
          for await (const chunk of new Response(body).body ?? []) {
            hash.update(chunk);
            out.write(chunk);
          }
        } finally {
          await out.end();
        }
        if (opts.sha256 && hash.digest("hex") !== opts.sha256) throw new Error("the bytes don't match their sha256");
        await rename(tmp, path);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    },
    head: info,
    async get(key: string, opts: { range?: Headers } = {}) {
      const o = await info(key);
      if (!o) return null;
      const header = opts.range?.get("range");
      const r = header ? range(header, o.size) : undefined;
      const blob = Bun.file(file(key));
      const part = r ? blob.slice(r.offset, r.offset + r.length) : blob;
      return { ...o, range: r, body: part.stream(), text: () => part.text(), arrayBuffer: () => part.arrayBuffer() };
    },
    // shortcut: one page with every key (R2 pages by 1000); fine until a shelf holds hundreds of thousands of blobs.
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const dir = prefix.slice(0, prefix.lastIndexOf("/"));
      const names = await readdir(join(root, dir)).catch(() => [] as string[]);
      const keys = names.filter((n) => /^[0-9a-f]{64}$/.test(n)).map((n) => `${dir}/${n}`).filter((k) => k.startsWith(prefix));
      const objects = (await Promise.all(keys.map(info))).filter((o) => o !== null);
      return { objects, truncated: false };
    },
    async delete(keys: string | string[]) {
      await Promise.all([keys].flat().map((k) => rm(file(k), { force: true })));
    },
  };
}

/** The Rate Limiting binding: at most `limit` calls per key in each `period` seconds. */
export function rateLimit(limit: number, period: number) {
  const windows = new Map<string, { n: number; until: number }>();
  return {
    async limit({ key }: { key: string }) {
      const now = Date.now();
      // Old windows go once the map grows, so a scan of many IPs can't hold memory.
      if (windows.size > 10_000) for (const [k, w] of windows) if (w.until <= now) windows.delete(k);
      let w = windows.get(key);
      if (!w || w.until <= now) windows.set(key, (w = { n: 0, until: now + period * 1000 }));
      return { success: ++w.n <= limit };
    },
  };
}
