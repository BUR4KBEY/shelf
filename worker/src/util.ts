export const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// 12 base62 chars ≈ 71 bits. Bytes >= 248 are dropped so every char is equally likely.
export function randomId(len = 12): string {
  let out = "";
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < 248 && out.length < len) out += B62[b % 62];
    }
  }
  return out;
}
