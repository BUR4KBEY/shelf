// `bun test selfhost`: the image's HEALTHCHECK passes only when every check does, and names the ones that fail.
import { expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const health = async (data: string, port: number) => {
  const proc = Bun.spawn(["bun", new URL("health.ts", import.meta.url).pathname], { env: { ...process.env, SHELF_DATA: data, PORT: String(port) } });
  return { code: await proc.exited, out: await new Response(proc.stdout).text() };
};

it("is healthy only when the server, storage and database all work", async () => {
  const data = await mkdtemp(join(tmpdir(), "shelf-"));
  await mkdir(join(data, "blobs"));
  new Database(join(data, "shelf.db")).exec("CREATE TABLE docs (id TEXT)");
  const server = Bun.serve({ port: 0, fetch: () => new Response("shelf") });
  try {
    expect(await health(data, server.port!)).toEqual({ code: 0, out: expect.stringContaining("\nhealthy\n") });

    await rm(join(data, "blobs"), { recursive: true });
    await rm(join(data, "shelf.db"));
    const { code, out } = await health(data, server.port!);
    expect(code).toBe(1);
    expect(out).toContain("ok   server");
    expect(out).toContain("unhealthy: storage, database");
  } finally {
    server.stop(true);
  }
});
