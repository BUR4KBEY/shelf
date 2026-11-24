export type Doc = {
  id: string;
  slug: string | null;
  title: string | null;
  locked: boolean;
  favorite: boolean;
  expiresAt: number | null;
  latest: number;
  createdAt: number;
  updatedAt: number;
  url: string;
};
export type Version = { n: number; message: string | null; size: number; createdAt: number; keyId: string | null; keyName: string | null; files: number };
/** One upload in the feed: a version, with the doc it belongs to. */
export type Activity = Version & { docId: string };
export type DocDetail = Doc & { versions: Version[] };
export type PushResult = (Doc & { version: number; versionUrl: string; created: boolean; missing?: undefined }) | { missing: string[] };
export type Key = { id: string; name: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
export type NewKey = { id: string; name: string; key: string };

export async function api<T>(path: string, { method = "GET", json, body }: { method?: string; json?: unknown; body?: Blob } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/dashboard/api${path}`, {
      method,
      headers: json === undefined ? {} : { "content-type": "application/json" },
      body: json === undefined ? body : JSON.stringify(json),
    });
  } catch {
    // An expired sign-in redirects to another origin, which the CSP blocks, so it also lands here.
    throw new Error("Can't reach the server. Reload the page to sign in again.");
  }
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(sentence(data?.error ?? `Request failed (${res.status})`));
  return data as T;
}

/** Server errors are lowercase fragments ("slug: already taken"). */
const sentence = (s: string) => s[0].toUpperCase() + s.slice(1);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const nameOf = (d: Doc) => d.title || d.id;
/** `url` from the API may be a path; links that get copied must be absolute. */
export const absolute = (url: string) => new URL(url, location.origin).href;
