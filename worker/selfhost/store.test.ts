// `bun test selfhost`: the stand-ins behave as D1, R2 and the rate limiter do where src/ relies on it.
import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { d1, openDb, r2, rateLimit } from "./store";

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
