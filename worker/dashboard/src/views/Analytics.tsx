import { useContext, useState, type CSSProperties } from "react";
import { ChevronLeft } from "lucide-react";
import { Loading, Problem, Time, display, focusRing, useLoad } from "@/components/bits";
import { SpacesContext, isExpired } from "@/components/DocBits";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nameOf, type Analytics, type Doc, type Key } from "@/lib/api";
import { NO_KEY } from "@/lib/feed";
import { ago, dayName, longDate, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DAY, Heatmap, PERIODS, PeriodPicker, Stat, heading, type Period } from "@/views/Key";

/** Days of counts the Worker sends: two years, so a year can be compared with the one before. */
const SPAN = 728;
/** A quota this full counts as nearly full. */
const NEAR = 0.8;
/** Ids for the uploaders that aren't keys: the dashboard itself, and keys deleted since. */
const DASHBOARD = "";
const DELETED = "?";

/** Anyone who uploads, with their uploads per day (oldest first, the last is today) and all-time totals. */
type Uploader = { id: string; name: string; color: string; key?: Key; counts: number[]; uploads: number; docs: number; size: number; lastAt: number | null };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Props = { keys: Key[]; docs: Doc[]; colorOf: (keyId: string | null) => string };

/** Every key's uploads side by side: who uploads how much and when, what they keep, which docs they share, and which keys sit idle. */
export function AnalyticsView(props: Props) {
  const tz = new Date().getTimezoneOffset();
  const { data, error } = useLoad<Analytics>(`/analytics?tz=${tz}`);
  return (
    <div className="mx-auto grid max-w-[60rem] grid-cols-1 gap-7 px-4 pt-5 pb-24 sm:px-10 sm:pt-7">
      <a href="#/" className={cn(focusRing, "-ml-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground")}>
        <ChevronLeft className="size-4" aria-hidden />
        All uploads
      </a>
      <h1 className={cn(display, "text-5xl leading-[0.95]")}>Analytics</h1>
      {error ? <Problem error={error} /> : !data ? <Loading /> : <AnalyticsPage a={data} today={Math.floor((Date.now() - tz * 60_000) / DAY)} {...props} />}
    </div>
  );
}

function AnalyticsPage({ a, today, keys, docs, colorOf }: Props & { a: Analytics; today: number }) {
  const spaces = useContext(SpacesContext) ?? [];
  const [space, setSpace] = useState("*"); // "*": every space
  const [period, setPeriod] = useState(PERIODS[1]);
  const [only, setOnly] = useState<string | null>(null);
  const inSpace = (s: string) => space === "*" || s === space;

  const known = new Map(keys.map((k) => [k.id, k]));
  const whoOf = (keyId: string | null) => (keyId === null ? DASHBOARD : known.has(keyId) ? keyId : DELETED);
  const by = new Map<string, Uploader>();
  const get = (id: string) => {
    let u = by.get(id);
    if (!u) {
      const key = known.get(id);
      const name = key?.name ?? (id === DASHBOARD ? "Dashboard" : "Deleted keys");
      // Deleted keys get the border colour, so they don't read as the dashboard in a stacked bar.
      by.set(id, (u = { id, name, color: id === DELETED ? "var(--input)" : colorOf(key?.id ?? null), key, counts: new Array<number>(SPAN).fill(0), uploads: 0, docs: 0, size: 0, lastAt: null }));
    }
    return u;
  };
  // Live keys show up even before their first upload: that's what makes them idle.
  for (const k of keys) if (!k.revokedAt && inSpace(k.space)) get(k.id);
  for (const r of a.keys) {
    if (!inSpace(r.space)) continue;
    const u = get(whoOf(r.keyId));
    u.uploads += r.uploads;
    u.docs += r.docs;
    u.size += r.size;
    u.lastAt = Math.max(u.lastAt ?? 0, r.lastAt);
  }
  for (const r of a.days) {
    const age = today - r.day;
    if (inSpace(r.space) && age >= 0 && age < SPAN) get(whoOf(r.keyId)).counts[SPAN - 1 - age] += r.uploads;
  }
  const now = (u: Uploader) => sum(u.counts.slice(SPAN - period.days));
  const before = (u: Uploader) => sum(u.counts.slice(SPAN - 2 * period.days, SPAN - period.days));
  const list = [...by.values()].sort((x, y) => now(y) - now(x) || y.uploads - x.uploads || x.name.localeCompare(y.name));
  const pick = list.some((u) => u.id === only) ? only : null;
  const shown = pick === null ? list : list.filter((u) => u.id === pick);

  // A quota covers every space, so its use does too.
  const used = new Map<string, number>();
  for (const r of a.keys) if (r.keyId) used.set(r.keyId, (used.get(r.keyId) ?? 0) + r.size);
  const quotas = new Map(a.quotas.map((q) => [q.id, q.quota]));

  const total = sum(list.map(now));
  const totalBefore = sum(list.map(before));
  const live = list.filter((u) => u.key && !u.key.revokedAt);
  const idle = live.filter((u) => now(u) === 0);
  const kept = sum(list.map((u) => u.size));
  const top = list[0];

  const docById = new Map(docs.map((d) => [d.id, d]));
  const shared = new Map<string, Analytics["shared"]>();
  for (const s of a.shared) {
    const d = docById.get(s.docId);
    if (d && inSpace(d.space)) shared.set(s.docId, [...(shared.get(s.docId) ?? []), s]);
  }
  const near = live.filter((u) => quotas.has(u.id) && (used.get(u.id) ?? 0) / quotas.get(u.id)! >= NEAR);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker period={period} onChange={setPeriod} />
        {/* Only worth a control once there are two spaces to tell apart. */}
        {spaces.length > 1 && (
          <Select value={space} onValueChange={setSpace}>
            <SelectTrigger aria-label="Space" className="ml-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value="*">All spaces</SelectItem>
              {spaces.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Uploads" value={String(total)} note={`${change(total - totalBefore)} on the ${period.label} before`} />
        <Stat label="Keys uploading" value={String(live.length - idle.length)} note={`of ${plural(live.length, "live key")}`} />
        <Stat label="Busiest" value={top && now(top) ? top.name : "Nobody"} note={top && now(top) ? `${plural(now(top), "upload")} in the last ${period.label}` : `no uploads in the last ${period.label}`} />
        <Stat label="Kept" value={size(kept)} note="every version still on the shelf" />
      </section>

      <section aria-labelledby="per-key-name" className="grid grid-cols-1 gap-3">
        <h2 id="per-key-name" className={heading}>
          Uploads per {period.step === 1 ? "day" : "week"}, by key
        </h2>
        <StackedBars uploaders={shown} period={period} total={sum(shown.map(now))} />
        {list.some((u) => now(u)) && (
          <div role="group" aria-label="Show one key" className="flex flex-wrap gap-1.5">
            {list
              .filter((u) => now(u))
              .map((u) => (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={pick === u.id}
                  onClick={() => setOnly(pick === u.id ? null : u.id)}
                  className={cn(focusRing, "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.8125rem] font-semibold text-muted-foreground hover:text-foreground", pick === u.id && "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]", pick !== null && pick !== u.id && "opacity-50")}
                >
                  <i className="size-2.5 rounded-full" style={{ background: u.color }} aria-hidden />
                  {u.name}
                  <span className="font-normal tabular-nums">{now(u)}</span>
                </button>
              ))}
          </div>
        )}
      </section>

      <section aria-labelledby="keys-table-name" className="grid grid-cols-1 gap-2.5">
        <h2 id="keys-table-name" className={heading}>
          Keys
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-[0.8125rem] text-muted-foreground">
              <tr className="border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                <th scope="col">Key</th>
                <th scope="col" className="text-right">
                  Last {period.short}
                </th>
                <th scope="col" className="text-right">
                  Change
                </th>
                <th scope="col" className="text-right">
                  Docs
                </th>
                <th scope="col" className="text-right">
                  Kept
                </th>
                <th scope="col">Quota</th>
                <th scope="col">Last upload</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((u) => {
                const quota = quotas.get(u.id);
                const share = quota && (used.get(u.id) ?? 0) / quota;
                return (
                  <tr key={u.id} style={{ "--k": u.color } as CSSProperties} className="tabular-nums [&>td]:px-3 [&>td]:py-2 [&>td]:whitespace-nowrap">
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      <span className="flex items-center gap-2">
                        <i className={cn("size-2.5 shrink-0 rounded-full", u.key?.revokedAt ? "bg-input" : "bg-(--k)")} aria-hidden />
                        {u.key ? (
                          <a href={`#/key/${u.id}`} className={cn(focusRing, "underline-offset-4 hover:underline", u.key.revokedAt && "text-muted-foreground line-through")}>
                            {u.name}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{u.name}</span>
                        )}
                      </span>
                    </th>
                    <td className="text-right">{now(u)}</td>
                    <td className={cn("text-right", now(u) === before(u) && "text-muted-foreground")} title={`${plural(before(u), "upload")} in the ${period.label} before`}>
                      {change(now(u) - before(u))}
                    </td>
                    <td className="text-right">{u.docs}</td>
                    <td className="text-right">{size(u.size)}</td>
                    <td>
                      {share === undefined ? (
                        <span className="text-muted-foreground">None</span>
                      ) : (
                        <span className={cn("flex items-center gap-2", share >= NEAR && "font-semibold text-warning")}>
                          <Progress value={Math.min(100, share * 100)} aria-label={`${u.name}'s quota used`} className="h-1.5 w-14 *:bg-(--k)" />
                          {Math.round(share * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="text-muted-foreground">{u.lastAt ? <Time t={u.lastAt}>{ago(u.lastAt)}</Time> : "Never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="storage-name" className="grid grid-cols-1 gap-2.5">
        <h2 id="storage-name" className={heading}>
          Storage
        </h2>
        <div className="grid gap-4 rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Every version still on the shelf counts in full, even files it shares with another version, the way quotas count.</p>
          {(space === "*" && spaces.length > 1 ? spaces : [{ id: space, name: spaces.find((s) => s.id === space)?.name ?? "All docs" }]).map((s) => {
            const parts = list.map((u) => ({ u, size: sum(a.keys.filter((r) => whoOf(r.keyId) === u.id && (s.id === "*" || r.space === s.id)).map((r) => r.size)) })).filter((p) => p.size);
            return <SizeBar key={s.id} name={s.name} parts={parts} of={kept} />;
          })}
          <div className="grid gap-1.5">
            <h3 className="text-sm font-semibold">Near their quota</h3>
            {near.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {near.map((u) => (
                  <li key={u.id}>
                    <a href={`#/key/${u.id}`} className={cn(focusRing, "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[0.8125rem] font-semibold text-warning hover:underline")}>
                      <i className="size-2.5 rounded-full" style={{ background: u.color }} aria-hidden />
                      {u.name}: {size(used.get(u.id) ?? 0)} of {size(quotas.get(u.id)!)}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{live.some((u) => quotas.has(u.id)) ? `No key has used ${NEAR * 100}% of its quota.` : "No key has a quota. Set one on a key's page."}</p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="shared-name" className="grid grid-cols-1 gap-2.5">
        <h2 id="shared-name" className={heading}>
          Shared docs
        </h2>
        <p className="text-sm text-muted-foreground">Docs that more than one key, or a key and the dashboard, uploaded versions of: where work changes hands.</p>
        {shared.size ? (
          <ul className="grid grid-cols-1 divide-y rounded-xl border bg-card">
            {[...shared].map(([docId, rows]) => {
              const d = docById.get(docId)!;
              return (
                <li key={docId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
                  <a href={`#/doc/${docId}`} className={cn(focusRing, "min-w-0 flex-[1_1_12rem] truncate font-semibold underline-offset-4 hover:underline", isExpired(d) && "text-muted-foreground line-through")}>
                    {nameOf(d)}
                  </a>
                  <ul aria-label="Uploaded by" className="flex flex-wrap gap-1.5">
                    {rows.map((r) => {
                      const u = get(whoOf(r.keyId));
                      return (
                        <li key={r.keyId ?? DASHBOARD} className="flex items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                          <i className="size-2 rounded-full" style={{ background: u.color }} aria-hidden />
                          {u.name} <span className="font-normal tabular-nums">{plural(r.uploads, "upload")}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <span className="text-[0.8125rem] text-muted-foreground">
                    last <Time t={rows[0].lastAt}>{ago(rows[0].lastAt)}</Time>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No doc has versions from more than one uploader yet.</p>
        )}
      </section>

      <section aria-labelledby="idle-name" className="grid grid-cols-1 gap-2.5">
        <h2 id="idle-name" className={heading}>
          Idle keys
        </h2>
        <p className="text-sm text-muted-foreground">Live keys with no uploads in the last {period.label}. If nothing uses one any more, revoke it on its page.</p>
        {idle.length ? (
          <ul className="grid grid-cols-1 divide-y rounded-xl border bg-card">
            {idle.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <i className="size-2.5 shrink-0 rounded-full" style={{ background: u.color }} aria-hidden />
                <a href={`#/key/${u.id}`} className={cn(focusRing, "min-w-0 flex-[1_1_10rem] truncate font-semibold underline-offset-4 hover:underline")}>
                  {u.name}
                </a>
                <span className="text-[0.8125rem] text-muted-foreground">
                  {u.lastAt ? (
                    <>
                      last upload <Time t={u.lastAt}>{ago(u.lastAt)}</Time>
                    </>
                  ) : (
                    <>
                      never uploaded, made <Time t={u.key!.createdAt}>{ago(u.key!.createdAt)}</Time>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Every live key uploaded in the last {period.label}.</p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-2.5" style={{ "--k": pick === null ? "var(--ring)" : shown[0].color } as CSSProperties}>
        <h2 className={heading}>Last year{pick !== null && `: ${shown[0].name}`}</h2>
        <Heatmap countsFor={(n) => shown.reduce((acc, u) => acc.map((c, i) => c + u.counts[SPAN - n + i]), new Array<number>(n).fill(0))} />
      </section>
    </>
  );
}

/** "+3", "−2" or "same": a count against the period before. */
const change = (d: number) => (d === 0 ? "same" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`);

/** Bars of every uploader's uploads stacked in their colours, a bar per day (or week), today last. Screen readers get the total. */
function StackedBars({ uploaders, period, total }: { uploaders: Uploader[]; period: Period; total: number }) {
  const n = period.days / period.step;
  const from = SPAN - period.days;
  const cols = Array.from({ length: n }, (_, i) => uploaders.map((u) => ({ u, n: sum(u.counts.slice(from + i * period.step, from + (i + 1) * period.step)) })).filter((s) => s.n));
  const most = Math.max(1, ...cols.map((c) => sum(c.map((s) => s.n))));
  const today = new Date();
  const label = (i: number) => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period.days - 1) + i * period.step).getTime();
    return period.step === 1 ? dayName(start) : `Week of ${longDate(start)}`;
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex h-32 items-end gap-[3px]" aria-hidden>
        {cols.map((c, i) => {
          const count = sum(c.map((s) => s.n));
          return (
            <span key={i} title={`${label(i)}: ${plural(count, "upload")}${c.map((s) => `\n${s.u.name}: ${s.n}`).join("")}`} className="flex h-full flex-1 flex-col-reverse">
              {count ? c.map((s) => <span key={s.u.id} className="first:rounded-b-[2px] last:rounded-t-[2px]" style={{ height: `${(s.n / most) * 100}%`, background: s.u.color }} />) : <span className="h-[4%] rounded-[2px] bg-muted-foreground opacity-20" />}
            </span>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>{period.step === 1 ? `${period.label} ago` : "A year ago"}</span>
        <span>Today</span>
      </div>
      <p className="sr-only">{`${plural(total, "upload")} in the last ${period.label}.`}</p>
    </div>
  );
}

/** One horizontal bar of what each uploader keeps, as a share of `of`, the bytes kept everywhere shown. */
function SizeBar({ name, parts, of }: { name: string; parts: { u: Uploader; size: number }[]; of: number }) {
  const total = sum(parts.map((p) => p.size));
  return (
    <div className="grid gap-1.5">
      <p className="flex justify-between text-sm">
        <span className="font-semibold">{name}</span>
        <span className="text-muted-foreground tabular-nums">{size(total)}</span>
      </p>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {parts.map((p) => (
          <span key={p.u.id} title={`${p.u.name}: ${size(p.size)}`} style={{ width: `${(p.size / Math.max(1, of)) * 100}%`, background: p.u.color }} />
        ))}
      </div>
    </div>
  );
}
