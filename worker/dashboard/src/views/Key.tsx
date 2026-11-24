import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Confirm, Loading, Problem, Time, chip, display, focusRing, useLoad } from "@/components/bits";
import { DocName, isExpired } from "@/components/DocBits";
import { Entry } from "@/components/Entry";
import { Button } from "@/components/ui/button";
import { api, errorText, nameOf, type Doc, type KeyDetail } from "@/lib/api";
import { byDay, perDay } from "@/lib/feed";
import { ago, dayName, fullDate, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";

const heading = "text-base leading-none font-bold";
const DAYS = 30;
/** The Worker lists this many of a key's uploads at most; the totals still count them all. */
const CAP = 500;

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

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

function Stat({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-xl border bg-card p-3.5">
      <p className="text-[0.8125rem] font-semibold text-muted-foreground">{label}</p>
      <p className={cn(display, "text-3xl leading-none tabular-nums")}>{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

type Props = { docs: Doc[]; colorOf: (keyId: string | null) => string; onChanged: () => void; onKeysChanged: () => void };

/** One key: how much and how often it uploads, the docs it touched, and its uploads as a log. Revoking lives here. */
export function KeyView({ id, ...props }: Props & { id: string }) {
  const { data: k, error, reload } = useLoad<KeyDetail>(`/keys/${encodeURIComponent(id)}`);
  return (
    <div style={{ "--k": props.colorOf(id) } as CSSProperties} className="mx-auto grid max-w-[60rem] grid-cols-1 gap-7 px-4 pt-5 pb-24 sm:px-10 sm:pt-7">
      <a href="#/" className={cn(focusRing, "-ml-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground")}>
        <ChevronLeft className="size-4" aria-hidden />
        All uploads
      </a>
      {error ? <Problem error={error} /> : !k ? <Loading /> : <KeyPage k={k} reload={reload} {...props} />}
    </div>
  );
}

function KeyPage({ k, reload, docs, colorOf, onChanged, onKeysChanged }: Props & { k: KeyDetail; reload: () => void }) {
  const [revoking, setRevoking] = useState(false);
  const revoke = () =>
    api(`/keys/${k.id}/revoke`, { method: "POST" }).then(
      () => (toast.success(`Revoked ${k.name}`), reload(), onKeysChanged()),
      (e) => toast.error(errorText(e)),
    );
  const byId = new Map(docs.map((d) => [d.id, d]));
  const total = k.docs.reduce((a, d) => a + d.uploads, 0);
  const made = k.docs.reduce((a, d) => a + d.created, 0);
  const bytes = k.docs.reduce((a, d) => a + d.size, 0);
  const first = Math.min(...k.docs.map((d) => d.firstAt));
  // shortcut: both charts count only the newest CAP uploads; move them to SQL if a key ever uploads more than CAP in DAYS days.
  const days = perDay(k.uploads, k.id, DAYS);
  const recent = days.reduce((a, b) => a + b, 0);
  const active = days.filter(Boolean).length;
  const hours = new Array<number>(24).fill(0);
  for (const u of k.uploads) hours[new Date(u.createdAt).getHours()]++;
  const peak = hours.indexOf(Math.max(...hours));
  const today = new Date();

  return (
    <>
      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <i className={cn("size-4 shrink-0 rounded-full", k.revokedAt ? "bg-input" : "bg-(--k)")} aria-hidden />
          <h1 className={cn(display, "min-w-0 flex-1 text-5xl leading-[0.95] [overflow-wrap:anywhere]", k.revokedAt && "text-muted-foreground line-through")}>{k.name}</h1>
          {!k.revokedAt && (
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
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Uploads" value={String(total)} note={`${plural(recent, "upload")} in the last ${DAYS} days`} />
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

      <section className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-[2fr_1fr]">
        <div className="grid content-start gap-2.5">
          <h2 className={heading}>Last {DAYS} days</h2>
          <p className="text-sm text-muted-foreground">
            Active on {plural(active, "day")}
            {active > 0 && `, ${plural(Number((recent / active).toFixed(1)), "upload")} a day when it is`}
          </p>
          <Bars
            counts={days}
            label={(i, n) => `${dayName(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1 - i)).getTime())}: ${plural(n, "upload")}`}
            from={`${DAYS} days ago`}
            to="Today"
            summary={`${plural(recent, "upload")} on ${plural(active, "day")} in the last ${DAYS} days.`}
          />
        </div>
        <div className="grid content-start gap-2.5">
          <h2 className={heading}>Time of day</h2>
          <p className="text-sm text-muted-foreground">{total ? `Busiest around ${hh(peak)}` : "No uploads yet"}</p>
          <Bars counts={hours} label={(i, n) => `${hh(i)}: ${plural(n, "upload")}`} from="00:00" to="23:00" summary={total ? `Uploads most often around ${hh(peak)}.` : "No uploads yet."} />
        </div>
      </section>

      {total === 0 ? (
        <p className="text-muted-foreground">Nothing this key uploaded is on the shelf.{!k.revokedAt && " Use it with shelf login or the API, and its docs and uploads show up here."}</p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className={heading}>Docs</h2>
            <ul className="grid grid-cols-1 divide-y rounded-xl border bg-card">
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

          <section className="grid grid-cols-1 gap-5">
            <h2 className={heading}>Uploads</h2>
            {byDay(k.uploads, (u) => `${u.docId}@${u.n}`).map(({ day, entries }) => (
              <div key={day} className="grid grid-cols-1 gap-2.5">
                <h3 className={cn(display, "text-2xl leading-none")}>{dayName(day)}</h3>
                <div className="grid grid-cols-1 gap-2">
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
    </>
  );
}
