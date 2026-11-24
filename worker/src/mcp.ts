import { deleteDoc, findDoc, getDoc, listDocs, patchDoc, push } from "./api";
import { hex, json } from "./util";

/**
 * POST /mcp: a stateless MCP server (Streamable HTTP, JSON responses, no sessions or SSE) over the same API key as /api.
 * Each tool calls the /api handler it mirrors, so validation and limits stay in one place.
 */

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_READ = 5_000_000;
const IMAGE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const settings = {
  slug: { type: "string", description: "Publish at /view/<slug>. Requires a password." },
  password: { type: ["string", "null"], description: "Readers must enter it (8+ characters). null removes it." },
  expires: { type: ["string", "null"], description: "30m, 12h, 7d, 2w, up to the owner's limit; \"0\" or null for never." },
  title: { type: "string" },
};
const ref = { type: "string", description: "Doc id or slug." };

const TOOLS = [
  {
    name: "publish",
    description:
      "Publish a file, or a folder of files with an index.html, and get a shareable link. Pass ref (or the same slug) to add a version to an existing doc. HTML runs in a sandbox: inline scripts and styles work; fetch, storage, cookies, forms and iframes don't.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative path, e.g. index.html or img/chart.png." },
              content: { type: "string" },
              encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
            },
            required: ["path", "content"],
          },
        },
        ref,
        ...settings,
        message: { type: "string", description: "What changed; shown in the version history." },
      },
      required: ["files"],
    },
  },
  {
    name: "read_doc",
    description: "Read a file of a doc, without its password. Text comes back as text, images as images.",
    inputSchema: {
      type: "object",
      properties: {
        ref,
        version: { type: "integer", minimum: 1, description: "Defaults to the latest." },
        path: { type: "string", description: "A file in a folder doc. Defaults to the only file, or index.html." },
      },
      required: ["ref"],
    },
  },
  { name: "list_docs", description: "List every doc, favorites first.", inputSchema: { type: "object", properties: {} } },
  { name: "get_doc", description: "A doc's settings and version history.", inputSchema: { type: "object", properties: { ref }, required: ["ref"] } },
  {
    name: "update_doc",
    description: "Change a doc's slug, password, expiry, title or favorite flag.",
    inputSchema: { type: "object", properties: { ref, ...settings, favorite: { type: "boolean" } }, required: ["ref"] },
  },
  { name: "delete_doc", description: "Delete a doc and every version of it.", inputSchema: { type: "object", properties: { ref }, required: ["ref"] } },
];

type Args = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const text = (s: string, isError = false) => ({ content: [{ type: "text", text: s }], isError });

/** A tool result from an /api handler's response; 4xx and 5xx become tool errors the model can read. */
async function fromApi(res: Response) {
  return text(res.status === 204 ? "done" : await res.text(), res.status >= 400);
}

const call = (req: Request, method: string, body?: unknown) =>
  new Request(req.url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function publish(req: Request, env: Env, keyId: string, args: Args) {
  const { files, ...rest } = args;
  if (!Array.isArray(files) || files.length === 0) return text("files: at least one {path, content} required", true);
  const blobs = new Map<string, Uint8Array>();
  const manifest: { path: string; sha256: string }[] = [];
  for (const f of files as Args[]) {
    if (typeof f?.path !== "string" || typeof f.content !== "string") return text("each file needs a string path and content", true);
    let bytes: Uint8Array;
    try {
      bytes = f.encoding === "base64" ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0)) : new TextEncoder().encode(f.content);
    } catch {
      return text(`${f.path}: content is not valid base64`, true);
    }
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    blobs.set(sha256, bytes);
    manifest.push({ path: f.path, sha256 });
  }
  const body = { ...rest, files: manifest };
  // Same flow as a client: the first push validates and names the blobs the server lacks.
  const first = await push(call(req, "POST", body), env, keyId);
  if (first.status !== 200) return fromApi(first);
  const { missing } = (await first.clone().json()) as { missing?: string[] };
  if (!missing) return fromApi(first);
  await Promise.all(missing.map((sha) => env.BUCKET.put(`docs/${sha}`, blobs.get(sha)!, { sha256: sha })));
  return fromApi(await push(call(req, "POST", body), env, keyId));
}

async function readDoc(env: Env, args: Args) {
  if (typeof args.ref !== "string") return text("ref required", true);
  const doc = await findDoc(env, args.ref);
  if (!doc) return text("doc not found", true);
  const n = typeof args.version === "number" ? args.version : doc.latest;
  const { results } = await env.DB.prepare("SELECT path, sha256, size FROM files WHERE doc_id = ? AND n = ? ORDER BY path")
    .bind(doc.id, n)
    .all<{ path: string; sha256: string; size: number }>();
  if (!results.length) return text(`version ${n} not found; the latest is ${doc.latest}`, true);
  const path = typeof args.path === "string" ? args.path : results.length === 1 ? results[0].path : "index.html";
  const file = results.find((f) => f.path === path);
  if (!file) return text(`no file ${path}; this version has: ${results.map((f) => f.path).join(", ")}`, true);
  if (file.size > MAX_READ) return text(`${path} is ${file.size} bytes, too large to read here`, true);
  const obj = await env.BUCKET.get(`docs/${file.sha256}`);
  if (!obj) return text("file content is missing", true);
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const image = IMAGE[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  let content: Content;
  if (image) content = { type: "image", data: encodeBase64(bytes), mimeType: image };
  else {
    try {
      content = { type: "text", text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes) };
    } catch {
      return text(`${path} is binary (${file.size} bytes); open it at its /view URL`, true);
    }
  }
  return { content: [content], isError: false };
}

async function callTool(req: Request, env: Env, keyId: string, name: unknown, args: Args) {
  const r = typeof args.ref === "string" ? args.ref : "";
  if (name !== "publish" && name !== "list_docs" && name !== "read_doc" && !/^[A-Za-z0-9-]{1,64}$/.test(r)) return text("ref required", true);
  switch (name) {
    case "publish":
      return publish(req, env, keyId, args);
    case "read_doc":
      return readDoc(env, args);
    case "list_docs":
      return fromApi(await listDocs(req, env));
    case "get_doc":
      return fromApi(await getDoc(req, env, r));
    case "update_doc": {
      const { ref: _, ...patch } = args;
      return fromApi(await patchDoc(call(req, "PATCH", patch), env, r));
    }
    case "delete_doc":
      return fromApi(await deleteDoc(env, r));
  }
}

const rpcError = (id: unknown, code: number, message: string) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function mcp(req: Request, env: Env, keyId: string): Promise<Response> {
  // No server-initiated stream (GET) and no sessions (DELETE): every request is one JSON-RPC message and its JSON reply.
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const msg = (await req.json().catch(() => undefined)) as { id?: unknown; method?: unknown; params?: Args } | undefined;
  if (msg === undefined) return rpcError(null, -32700, "parse error");
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "invalid request");
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications need no reply
  const params = msg.params ?? {};
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id: msg.id, result });

  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return ok({
        protocolVersion: typeof asked === "string" && PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "shelf", version: "1.0.0" },
        instructions: `Publish files to ${new URL(req.url).origin} and get shareable links. Full guide: ${new URL(req.url).origin}/llms.txt`,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) return rpcError(msg.id, -32602, `unknown tool: ${String(params.name)}`);
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Args) : {};
      return ok(await callTool(req, env, keyId, params.name, args));
    }
    default:
      return rpcError(msg.id, -32601, `method not found: ${msg.method}`);
  }
}
