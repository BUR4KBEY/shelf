import { json, randomId, sha256Hex } from "./util";

const SHA = /^[0-9a-f]{64}$/;
const MAX_FILES = 1000;

const validPath = (p: string) =>
  p.length > 0 &&
  p.length <= 512 &&
  p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[\\\x00-\x1f]/.test(s));

const optString = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);

interface PushBody {
  ref?: string;
  title?: string;
  message?: string;
  files: { path: string; sha256: string }[];
}

/**
 * Commits a new version from a manifest. Blobs must already be in R2:
 * if any are missing, nothing is written and `{missing}` lists them.
 */
export async function push(req: Request, env: Env, keyId: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PushBody | null;
  if (!body || !Array.isArray(body.files) || body.files.length === 0 || body.files.length > MAX_FILES) {
    return json({ error: `files: 1 to ${MAX_FILES} entries required` }, 400);
  }
  if (!optString(body.ref, 64) || !optString(body.title, 200) || !optString(body.message, 1000)) {
    return json({ error: "ref, title and message must be short strings" }, 400);
  }
  const paths = new Set<string>();
  for (const f of body.files) {
    if (typeof f?.path !== "string" || !validPath(f.path) || paths.has(f.path)) {
      return json({ error: `bad or duplicate path: ${JSON.stringify(f?.path)}` }, 400);
    }
    if (typeof f.sha256 !== "string" || !SHA.test(f.sha256)) return json({ error: `bad sha256 for ${f.path}` }, 400);
    paths.add(f.path);
  }

  if (body.ref && !(await env.DB.prepare("SELECT 1 FROM docs WHERE id = ?").bind(body.ref).first())) {
    return json({ error: "doc not found" }, 404);
  }

  const shas = [...new Set(body.files.map((f) => f.sha256))];
  const heads = await Promise.all(shas.map((s) => env.BUCKET.head(`docs/${s}`)));
  const missing = shas.filter((_, i) => !heads[i]);
  if (missing.length) return json({ missing });

  // Sizes come from R2, never from the client.
  const sizeOf = new Map(shas.map((s, i) => [s, heads[i]!.size]));
  const files = body.files.map((f) => ({ path: f.path, sha256: f.sha256, size: sizeOf.get(f.sha256)! }));
  const size = files.reduce((sum, f) => sum + f.size, 0);
  const manifest = await sha256Hex(files.map((f) => `${f.path}\t${f.sha256}`).sort().join("\n"));
  const now = Date.now();

  let id = body.ref;
  const stmts: D1PreparedStatement[] = [];
  if (!id) {
    id = randomId();
    const title = body.title ?? (files.length === 1 ? files[0].path : null);
    stmts.push(
      env.DB.prepare("INSERT INTO docs (id, title, latest, created_at, updated_at) VALUES (?, ?, 0, ?, ?)").bind(id, title, now, now),
    );
  }
  // One transaction; the version number is computed in SQL so concurrent pushes cannot collide.
  stmts.push(
    env.DB.prepare("UPDATE docs SET latest = latest + 1, updated_at = ?, title = COALESCE(?, title) WHERE id = ?").bind(
      now,
      body.title ?? null,
      id,
    ),
    env.DB.prepare(
      "INSERT INTO versions (doc_id, n, manifest_hash, message, size, key_id, created_at) SELECT id, latest, ?, ?, ?, ?, ? FROM docs WHERE id = ?",
    ).bind(manifest, body.message ?? null, size, keyId, now, id),
    env.DB.prepare(
      "INSERT INTO files (doc_id, n, path, sha256, size) SELECT ?1, (SELECT latest FROM docs WHERE id = ?1), value->>'path', value->>'sha256', value->>'size' FROM json_each(?2)",
    ).bind(id, JSON.stringify(files)),
    env.DB.prepare("SELECT latest FROM docs WHERE id = ?").bind(id),
  );
  const results = await env.DB.batch<{ latest: number }>(stmts);
  const version = results.at(-1)!.results[0].latest;
  return json({ id, version, url: `${new URL(req.url).origin}/view/${id}` });
}

/** Streams the body into R2. R2 rejects it if the bytes do not hash to `sha`. */
export async function putBlob(req: Request, env: Env, sha: string): Promise<Response> {
  if (!req.headers.has("content-length")) return json({ error: "content-length required" }, 411);
  try {
    await env.BUCKET.put(`docs/${sha}`, req.body ?? "", { sha256: sha });
  } catch (e) {
    return json({ error: `upload rejected: ${(e as Error).message}` }, 400);
  }
  return new Response(null, { status: 204 });
}
