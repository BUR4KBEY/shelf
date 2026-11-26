// `bun test selfhost`: the stand-ins behave as D1, R2 and the rate limiter do where src/ relies on it.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { d1, loadSecret, openDb, r2, range, rateLimit, rotateSecret } from "./store";

const migrations = await Promise.all(
  (await readdir(new URL("../migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort().map((n) => readFile(new URL(`../migrations/${n}`, import.meta.url), "utf8")),
);
const tmp = () => mkdtemp(join(tmpdir(), "shelf-"));
const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

describe("d1", () => {
  it("applies each migration once and enforces foreign keys after", async () => {
    const path = join(await tmp(), "shelf.db");
    openDb(path, migrations).close();
    const db = openDb(path, migrations); // reopening must not rerun them
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: migrations.length });
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("rolls a failed batch back and counts changes", async () => {
    const db = d1(openDb(join(await tmp(), "shelf.db"), migrations));
    const insert = db.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2)");
    await expect(db.batch([insert.bind("a", "1"), insert.bind("a", "2")])).rejects.toThrow("UNIQUE");
    expect(await db.prepare("SELECT value FROM settings WHERE key = ?").bind("a").first("value")).toBeNull();
    await db.batch([insert.bind("a", "1"), insert.bind("b", "2")]);
    expect((await db.prepare("DELETE FROM settings WHERE key IN ('a', 'b')").run()).meta.changes).toBe(2);
    expect((await db.prepare("DELETE FROM settings WHERE key = 'a'").run()).meta.changes).toBe(0);
  });

  it("folds raw view rows into per-slot counts without losing any", async () => {
    const path = join(await tmp(), "shelf.db");
    const old = openDb(path, migrations.slice(0, migrations.findIndex((sql) => sql.includes("CREATE TABLE view_counts"))));
    old.exec("INSERT INTO docs (id, latest, created_at, updated_at) VALUES ('d', 1, 0, 0); INSERT INTO versions (doc_id, n, manifest_hash, size, created_at) VALUES ('d', 1, 'h', 1, 0)");
    // Two opens by a in one slot, one by a in the next, one by b.
    for (const [at, visitor] of [[1_000, "a"], [2_000, "a"], [900_000, "a"], [3_000, "b"]]) old.query("INSERT INTO views (doc_id, n, at, visitor) VALUES ('d', 1, ?, ?)").run(at, visitor);
    old.close();
    const db = openDb(path, migrations);
    expect(db.query("SELECT slot, visitor, at, count FROM views ORDER BY slot, visitor").all()).toEqual([
      { slot: 0, visitor: "a", at: 2_000, count: 2 },
      { slot: 0, visitor: "b", at: 3_000, count: 1 },
      { slot: 1, visitor: "a", at: 900_000, count: 1 },
    ]);
  });
});

describe("r2", () => {
  it("stores only bytes that match their sha256, and serves ranges", async () => {
    const bucket = r2(await tmp());
    const key = `docs/${sha("hello world")}`;
    await expect(bucket.put(key, "tampered", { sha256: sha("hello world") })).rejects.toThrow("sha256");
    expect(await bucket.head(key)).toBeNull();
    await bucket.put(key, new Response("hello world").body, { sha256: sha("hello world") });
    expect((await bucket.head(key))?.size).toBe(11);
    expect(await (await bucket.get(key))!.text()).toBe("hello world");
    const part = (await bucket.get(key, { range: new Headers({ range: "bytes=-5" }) }))!;
    expect([part.range, await part.text()]).toEqual([{ offset: 6, length: 5 }, "world"]);
    await expect(bucket.get(key, { range: new Headers({ range: "bytes=20-" }) })).rejects.toThrow();
    expect((await bucket.list({ prefix: "docs/" })).objects.map((o) => o.key)).toEqual([key]);
    await bucket.delete([key]);
    expect(await bucket.get(key)).toBeNull();
  });

  it("refuses keys that would leave its directory", async () => {
    await expect(r2(await tmp()).head("docs/../../etc/passwd")).rejects.toThrow("bad key");
  });
});

it("rate limit allows `limit` calls per key per period", async () => {
  const rl = rateLimit(2, 60);
  const calls = [await rl.limit({ key: "a" }), await rl.limit({ key: "a" }), await rl.limit({ key: "a" }), await rl.limit({ key: "b" })];
  expect(calls.map((c) => c.success)).toEqual([true, true, false, true]);
});

it("refuses a database migrated by a newer build", async () => {
  const path = join(await tmp(), "shelf.db");
  const db = new Database(path);
  db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
  db.close();
  expect(() => openDb(path, migrations)).toThrow(`database schema is newer than this build (v${migrations.length + 1} > ${migrations.length})`);
});

it("answers an inverted byte range as unsatisfiable, as R2 does", () => {
  expect(() => range("bytes=5-3", 11)).toThrow();
  expect(range("bytes=3-5", 11)).toEqual({ offset: 3, length: 3 });
});

it("replaces a session key that is empty or garbage, and keeps a good one", async () => {
  const dir = await tmp();
  for (const bad of ["", "garbage", "a".repeat(63), "A".repeat(64)]) {
    const path = join(dir, `bad${bad.length}${bad[0]}.key`);
    await writeFile(path, bad);
    const secret = await loadSecret(path);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(path, "utf8")).toBe(secret);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }
  const fresh = join(dir, "fresh.key");
  const secret = await loadSecret(fresh);
  expect(await loadSecret(fresh)).toBe(secret);
});

it("rotates the session key to a fresh one, written 0600 in place of the old", async () => {
  const dir = await tmp();
  const path = join(dir, "session.key");
  const old = await loadSecret(path);
  const fresh = await rotateSecret(path);
  expect(fresh).toMatch(/^[0-9a-f]{64}$/);
  expect(fresh).not.toBe(old);
  expect(await loadSecret(path)).toBe(fresh); // what a restarted server signs with
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readdir(dir)).toEqual(["session.key"]); // no temporary file left behind
});
