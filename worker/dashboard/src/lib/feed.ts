// Pure helpers for the upload feed. No imports from ./api, so the Worker's test suite can load this file.

/** Hues a key can get. Amber and red are left out: they already mean "expiring" and "gone". */
const HUES = [300, 235, 165, 350, 125, 50];
/** Uploads from the dashboard itself have no key and stay grey. */
export const NO_KEY = "var(--muted-foreground)";

/** Keys keep their colour: the nth key ever created gets the nth hue. Keys are revoked, never deleted, so the order holds. */
export function keyColors(keys: { id: string; createdAt: number }[]): Map<string, string> {
  const oldestFirst = [...keys].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  // Darker on light, paler on dark, at a chroma that makes every key equally loud in either theme.
  return new Map(oldestFirst.map((k, i) => [k.id, `light-dark(oklch(0.5 0.17 ${HUES[i % HUES.length]}), oklch(0.82 0.11 ${HUES[i % HUES.length]}))`]));
}

const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);

export type Day<T> = { day: number; count: number; entries: { head: T; older: T[] }[] };

/**
 * Groups uploads (newest first) by local day. Within a day, uploads with the same `groupOf` share one entry:
 * the newest leads and the earlier ones fold under it.
 */
export function byDay<T extends { createdAt: number }>(uploads: T[], groupOf: (u: T) => string): Day<T>[] {
  const days: Day<T>[] = [];
  for (const u of uploads) {
    const day = midnight(u.createdAt);
    let d = days.at(-1);
    if (!d || d.day !== day) {
      d = { day, count: 0, entries: [] };
      days.push(d);
    }
    d.count++;
    const entry = d.entries.find((e) => groupOf(e.head) === groupOf(u));
    if (entry) entry.older.push(u);
    else d.entries.push({ head: u, older: [] });
  }
  return days;
}

/** One key's uploads per day over the last `days` days, oldest first. */
export function perDay(uploads: { keyId: string | null; createdAt: number }[], keyId: string, days = 14): number[] {
  const today = midnight(Date.now());
  const counts = new Array<number>(days).fill(0);
  for (const u of uploads) {
    if (u.keyId !== keyId) continue;
    const age = Math.round((today - midnight(u.createdAt)) / 86_400_000); // rounded: a day is 23 or 25 hours when the clocks change
    if (age < days) counts[days - 1 - age]++;
  }
  return counts;
}
