import { memo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Confirm, Loading, Problem, Time, chip, display, focusRing, useLoad } from "@/components/bits";
import { DocName, isExpired } from "@/components/DocBits";
import { Entry } from "@/components/Entry";
import { Field, Hint, SpaceSelect } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorText, nameOf, type Doc, type KeyDetail } from "@/lib/api";
import { byDay, daily } from "@/lib/feed";
import { ago, dayName, fullDate, longDate, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";

export const heading = "text-base leading-none font-bold";
export const DAY = 86_400_000;
/** What the activity charts can cover. A year is 52 weeks, one bar each. */
export const PERIODS = [
  { days: 7, step: 1, short: "7d", label: "7 days" },
  { days: 30, step: 1, short: "30d", label: "30 days" },
  { days: 90, step: 1, short: "90d", label: "90 days" },
  { days: 364, step: 7, short: "1y", label: "year" },
];
/** The Worker lists this many of a key's uploads at most; the totals still count them all. */
const CAP = 500;

export const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** A row of bars in the key's colour, labelled at both ends. Screen readers get `summary` instead. */
function Bars({ counts, label, from, to, summary }: { counts: number[]; label: (i: number, n: number) => string; from: string; to: string; summary: string }) {
  const most = Math.max(1, ...counts);
  return (
    <div className="grid gap-1.5">
      <div className="flex h-24 items-end gap-[3px]" aria-hidden>
        {counts.map((n, i) => (
          <span key={i} title={label(i, n)} className={cn("flex-1 rounded-[2px] bg-(--k)", !n && "opacity-20")} style={{ height: `${Math.max(4, (n / most) * 100)}%` }} />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>{from}</span>
        <span>{to}</span>
      </div>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-xl border bg-card p-3.5">
      <p className="text-[0.8125rem] font-semibold text-muted-foreground">{label}</p>
      <p className={cn(display, "text-3xl leading-none tabular-nums")}>{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export type Period = (typeof PERIODS)[number];

export function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div role="group" aria-label="Period" className="flex rounded-lg border p-0.5">
      {PERIODS.map((p) => (
        <button key={p.days} type="button" aria-pressed={p === period} onClick={() => onChange(p)} className={cn(focusRing, "rounded-md px-2.5 py-1 text-[0.8125rem] font-semibold text-muted-foreground hover:text-foreground", p === period && "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]")}>
          {p.short}
        </button>
      ))}
    </div>
  );
}

const SHADES = [0, 35, 60, 80, 100];

/** The last 53 weeks a day per square, a week per column, like GitHub's contribution graph. Darker is more uploads. `countsFor(n)`: uploads per day over the last n days, oldest first. */
export function Heatmap({ countsFor }: { countsFor: (days: number) => number[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Columns start on Sunday; the last one ends today.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - 52 * 7);
  const counts = countsFor(Math.round((today.getTime() - start.getTime()) / DAY) + 1);
  const most = Math.max(1, ...counts);
  const dayAt = (i: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
  const weeks = Math.ceil(counts.length / 7);
  const total = counts.reduce((a, b) => a + b, 0);
  const cols = "grid grid-flow-col auto-cols-[11px] gap-[3px]";
  return (
    <div className="grid gap-2 rounded-xl border bg-card p-4">
      <div className="overflow-x-auto" aria-hidden>
        <div className="grid w-max grid-cols-[auto_auto] gap-x-2 gap-y-1 text-[0.6875rem] leading-none text-muted-foreground">
          <span />
          <div className={cols}>
            {Array.from({ length: weeks }, (_, w) => {
              const d = dayAt(w * 7);
              const month = w > 0 && d.getMonth() !== dayAt(w * 7 - 7).getMonth();
              return (
                <span key={w} className="h-3 overflow-visible whitespace-nowrap">
                  {month && d.toLocaleDateString(undefined, { month: "short" })}
                </span>
              );
            })}
          </div>
          <div className="grid grid-rows-7 gap-[3px]">
            {Array.from({ length: 7 }, (_, r) => (
              <span key={r} className="flex h-[11px] items-center">
                {r % 2 === 1 && dayAt(r).toLocaleDateString(undefined, { weekday: "short" })}
              </span>
            ))}
          </div>
          <div className={cn(cols, "grid-rows-7")}>
            {counts.map((n, i) => {
              const shade = SHADES[n && Math.ceil((n / most) * 4)];
              return <span key={i} title={`${plural(n, "upload")} on ${longDate(dayAt(i).getTime())}`} className={cn("size-[11px] rounded-[2px]", !shade && "bg-muted")} style={shade ? { background: `color-mix(in oklab, var(--k) ${shade}%, var(--card))` } : undefined} />;
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{plural(total, "upload")} in the last year</span>
        <span className="flex items-center gap-[3px]" aria-hidden>
          Less
          {SHADES.map((s) => (
            <span key={s} className={cn("mx-px size-[11px] rounded-[2px]", !s && "bg-muted")} style={s ? { background: `color-mix(in oklab, var(--k) ${s}%, var(--card))` } : undefined} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

const GB = 1e9;
const MB = 1e6;

/** How many bytes the key's uploads may keep, and what happens to an upload that doesn't fit. */
function QuotaForm({ k, used, onSaved }: { k: KeyDetail; used: number; onSaved: () => void }) {
  const [unit, setUnit] = useState(String(k.quota !== null && k.quota % GB === 0 ? GB : MB));
  const [amount, setAmount] = useState(k.quota === null ? "" : String(k.quota / Number(unit)));
  const [strategy, setStrategy] = useState(k.strategy);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Empty or 0 means no limit.
      const quota = Number(amount) > 0 ? Math.round(Number(amount) * Number(unit)) : null;
      await api(`/keys/${k.id}`, { method: "PATCH", json: { quota, strategy } });
      toast.success("Quota saved");
      onSaved();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
      {k.quota !== null && (
        <div className="grid gap-1.5 sm:col-span-2">
          <p className="text-sm tabular-nums">
            {size(used)} of {size(k.quota)} kept
          </p>
          <Progress value={Math.min(100, (used / k.quota) * 100)} aria-label="Quota used" className="h-1.5 *:bg-(--k)" />
        </div>
      )}
      <Field label="Keep at most" htmlFor="f-quota">
        <div className="flex gap-2">
          <Input id="f-quota" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="No limit" aria-describedby="f-quota-hint" className="min-w-0 flex-1" />
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger aria-label="Unit" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectItem value={String(MB)}>MB</SelectItem>
              <SelectItem value={String(GB)}>GB</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Hint id="f-quota-hint">Empty or 0 means no limit. Counts every version this key uploaded that is still on the shelf, so expired and deleted docs free room.</Hint>
      </Field>
      <Field label="When an upload doesn't fit" htmlFor="f-strategy">
        <Select value={strategy} onValueChange={(v) => setStrategy(v as KeyDetail["strategy"])}>
          <SelectTrigger id="f-strategy" aria-describedby="f-strategy-hint" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="reject">Refuse it</SelectItem>
            <SelectItem value="fifo">Delete this key's oldest uploads</SelectItem>
          </SelectContent>
        </Select>
        <Hint id="f-strategy-hint">
          Deleting goes oldest first until the upload fits. Favorites stay, and so does the current version of a doc that has older versions from someone else. A doc left with no versions is deleted. An upload bigger than the whole quota is always refused.
        </Hint>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

type Props = { docs: Doc[]; colorOf: (keyId: string | null) => string; onChanged: () => void; onKeysChanged: () => void };

/** One key: how much and how often it uploads, the docs it touched, and its uploads as a log. Revoking, then deleting, lives here. */
export const KeyView = memo(function KeyView({ id, ...props }: Props & { id: string }) {
  const { data: k, error, reload } = useLoad<KeyDetail>(`/keys/${encodeURIComponent(id)}`);
  return (
    <div style={{ "--k": props.colorOf(id) } as CSSProperties} className="mx-auto flex max-w-[60rem] flex-col gap-7 px-4 pt-5 pb-24 sm:px-10 sm:pt-7">
      <a href="#/" className={cn(focusRing, "-ml-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground")}>
        <ChevronLeft className="size-4" aria-hidden />
        All uploads
      </a>
      {error ? <Problem error={error} /> : !k ? <Loading /> : <KeyPage k={k} reload={reload} {...props} />}
    </div>
  );
});

function KeyPage({ k, reload, docs, colorOf, onChanged, onKeysChanged }: Props & { k: KeyDetail; reload: () => void }) {
  const [revoking, setRevoking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const revoke = () =>
    api(`/keys/${k.id}/revoke`, { method: "POST" }).then(
      () => (toast.success(`Revoked ${k.name}`), reload(), onKeysChanged()),
      (e) => toast.error(errorText(e)),
    );
  const move = (space: string) =>
    api(`/keys/${k.id}`, { method: "PATCH", json: { space } }).then(
      () => (toast.success(`Moved ${k.name}`), reload(), onKeysChanged()),
      (e) => toast.error(errorText(e)),
    );
  const remove = () =>
    api(`/keys/${k.id}`, { method: "DELETE" }).then(
      () => (toast.success(`Deleted ${k.name}`), onKeysChanged(), onChanged(), (location.hash = "#/")),
      (e) => toast.error(errorText(e)),
    );
  const byId = new Map(docs.map((d) => [d.id, d]));
  const total = k.docs.reduce((a, d) => a + d.uploads, 0);
  const made = k.docs.reduce((a, d) => a + d.created, 0);
  const bytes = k.docs.reduce((a, d) => a + d.size, 0);
  const first = Math.min(...k.docs.map((d) => d.firstAt));
  const [period, setPeriod] = useState(PERIODS[1]);
  const days = daily(k.times, period.days);
  const buckets = Array.from({ length: period.days / period.step }, (_, i) => days.slice(i * period.step, (i + 1) * period.step).reduce((a, b) => a + b, 0));
  const recent = days.reduce((a, b) => a + b, 0);
  const active = days.filter(Boolean).length;
  const today = new Date();
  const since = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period.days - 1)).getTime();
  const hours = new Array<number>(24).fill(0);
  for (const t of k.times) if (t >= since) hours[new Date(t).getHours()]++;
  const peak = hours.indexOf(Math.max(...hours));

  return (
    <>
      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <i className={cn("size-4 shrink-0 rounded-full", k.revokedAt ? "bg-input" : "bg-(--k)")} aria-hidden />
          <h1 className={cn(display, "min-w-0 flex-1 text-5xl leading-[0.95] [overflow-wrap:anywhere]", k.revokedAt && "text-muted-foreground line-through")}>{k.name}</h1>
          {k.revokedAt ? (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
              <Trash2 /> Delete…
            </Button>
          ) : (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setRevoking(true)}>
              <Trash2 /> Revoke…
            </Button>
          )}
        </div>
        <ul aria-label="Status" className="flex flex-wrap gap-1.5">
          {k.revokedAt ? (
            <li className={cn(chip, "bg-destructive/10 text-destructive")}>
              Revoked <Time t={k.revokedAt}>{ago(k.revokedAt)}</Time>
            </li>
          ) : (
            <li className={chip}>Active</li>
          )}
          <li className={chip}>
            Created <Time t={k.createdAt}>{ago(k.createdAt)}</Time>
          </li>
          <li className={chip}>
            {k.lastUsedAt ? (
              <>
                Last used <Time t={k.lastUsedAt}>{ago(k.lastUsedAt)}</Time>
              </>
            ) : (
              "Never used"
            )}
          </li>
        </ul>
        <div className="max-w-xs">
          <Field label="Space" htmlFor="key-space">
            <SpaceSelect id="key-space" value={k.space} onChange={move} describedBy="key-space-hint" />
            <Hint id="key-space-hint">New uploads go here, and it sees only this space's docs. Moving it leaves the docs it uploaded where they are.</Hint>
          </Field>
        </div>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Uploads" value={String(total)} note={`${plural(recent, "upload")} in the last ${period.label}`} />
        <Stat label="Docs" value={String(k.docs.length)} note={`${made} made by this key`} />
        <Stat label="Data uploaded" value={size(bytes)} note="across every version" />
        <Stat
          label="Last upload"
          value={total ? ago(k.docs[0].lastAt) : "Never"}
          note={
            total ? (
              <>
                first <Time t={first}>{fullDate(first)}</Time>
              </>
            ) : (
              "nothing on the shelf yet"
            )
          }
        />
      </section>

      {!k.revokedAt && (
        <section aria-labelledby="quota-name" className="grid grid-cols-1 gap-2.5">
          <h2 id="quota-name" className={heading}>
            Quota
          </h2>
          <QuotaForm key={`${k.quota}:${k.strategy}`} k={k} used={bytes} onSaved={reload} />
        </section>
      )}

      <section aria-labelledby="activity-name" className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="activity-name" className={heading}>
            Activity
          </h2>
          <PeriodPicker period={period} onChange={setPeriod} />
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-[2fr_1fr]">
          <div className="grid content-start gap-2.5">
            <h3 className="text-sm font-semibold">Uploads per {period.step === 1 ? "day" : "week"}</h3>
            <p className="text-sm text-muted-foreground">
              Active on {plural(active, "day")}
              {active > 0 && `, ${plural(Number((recent / active).toFixed(1)), "upload")} a day when it is`}
            </p>
            <Bars
              counts={buckets}
              label={(i, n) => {
                const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (period.days - 1) + i * period.step).getTime();
                return `${period.step === 1 ? dayName(start) : `Week of ${longDate(start)}`}: ${plural(n, "upload")}`;
              }}
              from={period.step === 1 ? `${period.label} ago` : "A year ago"}
              to="Today"
              summary={`${plural(recent, "upload")} on ${plural(active, "day")} in the last ${period.label}.`}
            />
          </div>
          <div className="grid content-start gap-2.5">
            <h3 className="text-sm font-semibold">Time of day</h3>
            <p className="text-sm text-muted-foreground">{recent ? `Busiest around ${hh(peak)}` : `No uploads in the last ${period.label}`}</p>
            <Bars counts={hours} label={(i, n) => `${hh(i)}: ${plural(n, "upload")}`} from="00:00" to="23:00" summary={recent ? `Uploads most often around ${hh(peak)}.` : "No uploads."} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-2.5">
        <h2 className={heading}>Last year</h2>
        <Heatmap countsFor={(n) => daily(k.times, n)} />
      </section>

      {total === 0 ? (
        <p className="text-muted-foreground">Nothing this key uploaded is on the shelf.{!k.revokedAt && " Use it with shelf login or the API, and its docs and uploads show up here."}</p>
      ) : (
        <>
          <section className="flex flex-col gap-2.5">
            <h2 className={heading}>Docs</h2>
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {k.docs.map((s) => {
                const d = byId.get(s.docId);
                return (
                  <li key={s.docId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                    <a href={`#/doc/${s.docId}`} className={cn(focusRing, "min-w-0 flex-[1_1_12rem] truncate font-semibold underline-offset-4 hover:underline", d && isExpired(d) && "text-muted-foreground line-through")}>
                      {d ? nameOf(d) : s.docId}
                    </a>
                    {s.created > 0 && <span className={chip}>Made it</span>}
                    <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
                      {plural(s.uploads, "upload")}, {size(s.size)}, last <Time t={s.lastAt}>{ago(s.lastAt)}</Time>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex flex-col gap-5">
            <h2 className={heading}>Uploads</h2>
            {byDay(k.uploads, (u) => `${u.docId}@${u.n}`).map(({ day, entries }) => (
              <div key={day} className="flex flex-col gap-2.5">
                <h3 className={cn(display, "text-2xl leading-none")}>{dayName(day)}</h3>
                <div className="flex flex-col gap-2">
                  {entries.map(({ head: u }) => {
                    const d = byId.get(u.docId);
                    return (
                      <Entry
                        key={`${u.docId}@${u.n}`}
                        color={colorOf(k.id)}
                        at={u.createdAt}
                        who={k.name}
                        did={u.n === 1 ? "uploaded a new doc" : `uploaded version ${u.n} of`}
                        title={d ? <DocName d={d} onChanged={onChanged} /> : <h3 className="text-xl leading-tight font-bold">{u.docId}</h3>}
                        message={u.message}
                        meta={
                          <span>
                            {plural(u.files, "file")}, {size(u.size)}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {k.uploads.length >= CAP && <p className="text-sm text-muted-foreground">These are this key's newest {CAP} uploads. The totals above count all {total}.</p>}
          </section>
        </>
      )}
      <Confirm open={revoking} onOpenChange={setRevoking} title={`Revoke ${k.name}?`} body="Anything using this key stops working right away. This can't be undone." action="Revoke" onConfirm={revoke} />
      <Confirm open={deleting} onOpenChange={setDeleting} title={`Delete ${k.name}?`} body="The key and its page go for good. Its uploads stay, marked as from a deleted key. This can't be undone." action="Delete" onConfirm={remove} />
    </>
  );
}
