import { sha256Hex } from "./util";

/** Returns the API key id for a valid `Authorization: Bearer <key>`, else null. */
export async function apiKey(req: Request, env: Env, ctx: ExecutionContext): Promise<string | null> {
  const m = req.headers.get("authorization")?.match(/^Bearer (\S+)$/);
  if (!m) return null;
  const row = await env.DB.prepare("SELECT id FROM api_keys WHERE hash = ? AND revoked_at IS NULL")
    .bind(await sha256Hex(m[1]))
    .first<{ id: string }>();
  if (!row) return null;
  ctx.waitUntil(env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(Date.now(), row.id).run());
  return row.id;
}
