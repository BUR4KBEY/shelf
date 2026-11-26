// The image's HEALTHCHECK. One line per check, then the verdict; exits 1 when any check fails, so
// `docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' shelf` says which part broke.
import { Database } from "bun:sqlite";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";

const DATA = process.env.SHELF_DATA ?? "/data";
const PORT = Number(process.env.PORT ?? 8080);

const checks: [string, () => Promise<string>][] = [
  [
    "server",
    async () => {
      // Under the HEALTHCHECK's 5s timeout, so a hung server is reported instead of the whole check being killed.
      const res = await fetch(`http://localhost:${PORT}/llms.txt`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`/llms.txt answered ${res.status}`);
      return `answers on port ${PORT}`;
    },
  ],
  [
    "storage",
    async () => {
      await access(join(DATA, "blobs"), constants.W_OK);
      return `${DATA}/blobs is writable`;
    },
  ],
  [
    "database",
    async () => {
      const db = new Database(join(DATA, "shelf.db"), { readonly: true });
      try {
        db.query("SELECT 1 FROM docs LIMIT 1").get();
        return "reads docs";
      } finally {
        db.close();
      }
    },
  ],
];

const failed: string[] = [];
for (const [name, check] of checks) {
  try {
    console.log(`ok   ${name}: ${await check()}`);
  } catch (e) {
    failed.push(name);
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
console.log(failed.length ? `unhealthy: ${failed.join(", ")}` : "healthy");
process.exit(failed.length ? 1 : 0);
