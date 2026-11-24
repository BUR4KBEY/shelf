// ctx.access is unset on Preview URLs even behind Worker-level Access (cloudflare/cloudflare-docs#33810), so previews
// verify the Cf-Access-Jwt-Assertion header themselves. Only the `previews` block sets ACCESS_TEAM_DOMAIN and ACCESS_AUD,
// so production never takes this path.

type Jwk = JsonWebKey & { kid: string };
let certs: { team: string; keys: Promise<Jwk[]> } | undefined;

function fetchKeys(team: string): Promise<Jwk[]> {
  const keys = fetch(`https://${team}/cdn-cgi/access/certs`)
    .then((r) => r.json<{ keys: Jwk[] }>())
    .then((b) => b.keys);
  certs = { team, keys };
  return keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const decode = (s: string) => JSON.parse(new TextDecoder().decode(b64url(s)));

/** The signed-in email when the request carries a valid Access JWT for this preview's Access app, else null. */
export async function previewAccess(req: Request, env: Env): Promise<{ email: string | null } | null> {
  const { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud } = env as Env & { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string };
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!team || !aud || !token) return null;
  const [h, p, s] = token.split(".");
  try {
    const header = decode(h);
    const claims = decode(p);
    if (header.alg !== "RS256") return null;
    const cached = certs?.team === team ? await certs.keys : [];
    // An unknown kid means Access rotated its keys since we cached them.
    const jwk = cached.find((k) => k.kid === header.kid) ?? (await fetchKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const key = await crypto.subtle.importKey("jwk", jwk, alg, false, ["verify"]);
    if (!(await crypto.subtle.verify(alg, key, b64url(s), new TextEncoder().encode(`${h}.${p}`)))) return null;
    const now = Date.now() / 1000;
    if (claims.iss !== `https://${team}` || ![claims.aud].flat().includes(aud) || !(claims.exp > now) || (claims.nbf ?? 0) > now) return null;
    return { email: typeof claims.email === "string" ? claims.email : null };
  } catch {
    return null;
  }
}
