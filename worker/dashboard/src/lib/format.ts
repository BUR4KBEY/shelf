function span(ms: number): string | null {
  const m = Math.abs(ms) / 60_000;
  if (m < 1) return null;
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  if (m < 43_200) return `${Math.round(m / 1440)}d`;
  return m < 525_600 ? `${Math.round(m / 43_200)}mo` : `${Math.round(m / 525_600)}y`;
}
export const ago = (t: number) => (span(Date.now() - t) ? `${span(Date.now() - t)} ago` : "just now");
/** "7d", or null once it has passed. */
export const timeLeft = (t: number) => (t <= Date.now() ? null : (span(t - Date.now()) ?? "<1m"));
// One formatter each: toLocale*String builds a new one per call, which every log entry pays on every render.
const FULL_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const fullDate = (t: number) => FULL_DATE.format(t);
/** Always 24-hour, so the times in the log line up in one narrow column. */
export const clock = (t: number) => CLOCK.format(t);
/** When a daily cron ("M H * * *", UTC, as Cloudflare runs them) next fires after `now`; null for any other schedule. */
export function nextDaily(cron: string | null, now = Date.now()): number | null {
  const m = cron?.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!m) return null;
  const t = new Date(now).setUTCHours(Number(m[2]), Number(m[1]), 0, 0);
  return t > now ? t : t + 86_400_000;
}
/** "Today", "Yesterday", then the date; `day` is a local midnight. */
export function dayName(day: number): string {
  const today = new Date().setHours(0, 0, 0, 0);
  const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
  return day === today ? "Today" : day === yesterday ? "Yesterday" : longDate(day);
}
export function longDate(day: number): string {
  const sameYear = new Date(day).getFullYear() === new Date().getFullYear();
  return new Date(day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", ...(!sameYear && { year: "numeric" }) });
}
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
