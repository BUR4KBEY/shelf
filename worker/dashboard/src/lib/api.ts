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
  /** Id of the space it belongs to. */
  space: string;
  /** Groups docs inside a space; null for none. */
  project: string | null;
  url: string;
};
/**
 * `views`: how often readers opened this version while view statistics were on. `disabled`: turned off, so its pinned link answers 410.
 * Both are absent on uploads in the feed.
 */
export type Version = { n: number; message: string | null; size: number; createdAt: number; keyId: string | null; keyName: string | null; files: number; views?: number; disabled?: boolean };
/** One upload in the feed: a version, with the doc it belongs to. */
export type Activity = Version & { docId: string };
/** `views.readers` counts each reader once a day; `lastAt` is null before the first view; `days`: views per local day (days since 1970) over the last 30. */
export type DocDetail = Doc & { versions: Version[]; views: { total: number; readers: number; lastAt: number | null; days: { day: number; views: number }[] } };
export type PushResult = (Doc & { version: number; versionUrl: string; created: boolean; missing?: undefined }) | { missing: string[] };
export type Key = { id: string; name: string; space: string; createdAt: number; lastUsedAt: number | null; revokedAt: number | null };
export type NewKey = { id: string; name: string; space: string; key: string };
/** A space isolates its keys: they see only its docs. `keysDelete`, `keysReadLocked`: whether they may delete its docs and read its locked ones without the password. */
export type Space = { id: string; name: string; keysDelete: boolean; keysReadLocked: boolean; createdAt: number; docs: number; keys: number };
/** A doc a key uploaded to: how often, how much, and when. `created` is 1 when the key made the doc. */
export type KeyDoc = { docId: string; uploads: number; created: number; size: number; firstAt: number; lastAt: number };
/**
 * Every uploader's uploads, for the analytics page. A null `keyId` is the dashboard; an id no key has any more is a deleted key.
 * `days`: uploads per local day (days since 1970) over the last two years. `keys`: all-time totals; `size` counts every version in full.
 * `shared`: each uploader's share of the docs more than one uploader touched, newest first. `quotas`: the keys that have one.
 * `views`: readers opening each doc per local day, over the same two years; `readers` counts each once per doc and day.
 * `viewStats`: whether views are being counted now.
 */
export type Analytics = {
  days: { keyId: string | null; space: string; day: number; uploads: number }[];
  keys: { keyId: string | null; space: string; uploads: number; docs: number; size: number; lastAt: number }[];
  shared: { docId: string; keyId: string | null; uploads: number; lastAt: number }[];
  quotas: { id: string; quota: number }[];
  views: { docId: string; space: string; day: number; views: number; readers: number }[];
  viewStats: boolean;
};
/**
 * A key with every doc it touched, its newest uploads (capped), and the time of each upload in the last 53 weeks.
 * `quota`: bytes its uploads may keep on the shelf, null for no limit. `strategy`: what an upload over it does.
 */
export type KeyDetail = Key & { docs: KeyDoc[]; uploads: Activity[]; times: number[]; quota: number | null; strategy: "reject" | "fifo" };
/**
 * `defaultExpires`: what a new doc gets when its upload names no expiry; null for never. `maxExpires`: the longest expiry any doc may get.
 * `isolateSpaces`: keys see only their own space. `maxSlugLength`: the longest slug any doc may get.
 * `viewStats`: count readers opening docs. `linkPreviews`: let chat apps fetch a doc to show a card for its link.
 */
export type AppSettings = { defaultExpires: string | null; maxExpires: string; isolateSpaces: boolean; maxSlugLength: number; viewStats: boolean; linkPreviews: boolean };
/**
 * One cleanup run: when (`at`), whether the daily cron or Run now started it, how long it took, and the expired docs and unused files
 * (`bytes` in all) it deleted. `error`: why it failed; the counts are then what it deleted before. `cron`: the schedule a daily run ran on.
 */
export type Cleanup = { at: number; trigger: "daily" | "manual"; cron?: string; ms: number; docs: number; blobs: number; bytes: number; error?: string };
/** The newest runs first (up to 10), and how many expired docs the next run would delete. */
export type CleanupStatus = { runs: Cleanup[]; expired: number };

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
/** Opens a doc through the dashboard, so its owner skips the password form. `n` pins a version. */
export const openUrl = (d: Doc, n?: number) => `/dashboard/open/${n === undefined ? (d.slug ?? d.id) : `${d.id}@${n}`}`;
