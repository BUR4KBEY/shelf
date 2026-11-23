import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { sha256Hex } from "../src/util";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await env.DB.prepare("INSERT OR IGNORE INTO api_keys (id, name, hash, created_at) VALUES ('k_test', 'test', ?, 0)")
  .bind(await sha256Hex("sk_test"))
  .run();
