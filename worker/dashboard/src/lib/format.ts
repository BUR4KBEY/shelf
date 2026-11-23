function span(ms: number): string | null {
  const m = Math.abs(ms) / 60_000;
  if (m < 1) return null;
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 43_200) return `${Math.round(m / 1440)}d`;
  return m < 525_600 ? `${Math.round(m / 43_200)}mo` : `${Math.round(m / 525_600)}y`;
}
export const ago = (t: number) => (span(Date.now() - t) ? `${span(Date.now() - t)} ago` : "just now");
export const expiry = (t: number) => (t <= Date.now() ? "expired" : `expires in ${span(t - Date.now()) ?? "<1m"}`);
export const fullDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export function size(b: number): string {
  if (b < 1000) return `${b} B`;
  const u = ["kB", "MB", "GB"];
  let i = -1;
  do {
    b /= 1000;
    i++;
  } while (b >= 1000 && i < u.length - 1);
  return `${b < 10 ? b.toFixed(1) : Math.round(b)} ${u[i]}`;
}
