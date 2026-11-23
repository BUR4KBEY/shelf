import { push, putBlob } from "./api";
import { apiKey } from "./auth";
import { json } from "./util";
import { view } from "./view";

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const path = new URL(req.url).pathname;
    let m: RegExpMatchArray | null;

    if ((req.method === "GET" || req.method === "HEAD") && (m = path.match(/^\/view\/([A-Za-z0-9]{1,64})$/))) {
      return view(req, env, m[1]);
    }

    if (path.startsWith("/api/")) {
      const keyId = await apiKey(req, env, ctx);
      if (!keyId) return json({ error: "unauthorized" }, 401);
      if (req.method === "POST" && path === "/api/push") return push(req, env, keyId);
      if (req.method === "PUT" && (m = path.match(/^\/api\/blobs\/([0-9a-f]{64})$/))) return putBlob(req, env, m[1]);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
