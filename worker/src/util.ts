export const json = (body: unknown, status = 200) => Response.json(body, { status });

export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

// Bytes at or above the largest multiple of the alphabet size are dropped so every char is equally likely.
function random(alphabet: string, len: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b < limit && out.length < len) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

// 12 base62 chars ≈ 71 bits; used for nonces and key ids and secrets, which are case-sensitive.
export const randomId = (len = 12) => random(B62, len);

// 12 lowercase base36 chars ≈ 62 bits. Doc ids are always lowercase, so URLs work in any case.
export const docId = () => random(B36, 12);

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
