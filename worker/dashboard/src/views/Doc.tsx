import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronLeft, Copy, ExternalLink, EyeOff, ListChecks, Lock, LockOpen, Power, PowerOff } from "lucide-react";
import { Loading, Problem, Time, chip, copy, dashed, display, focusRing, useLoad } from "@/components/bits";
import { Expiry, ProjectChip, SpaceChip, Star } from "@/components/DocBits";
import { DropZone } from "@/components/DropZone";
import { Entry } from "@/components/Entry";
import { Settings } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorText, nameOf, openUrl, type DocDetail } from "@/lib/api";
import { byDay } from "@/lib/feed";
import { ago, dayName, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DAY } from "@/views/Key";

/** The name of a section of the page. */
const heading = "text-base leading-none font-bold";

/** One doc: its link, its settings, a place to add a version, and its whole history as a log. */
export function DocView({ id, colorOf, onChanged }: { id: string; colorOf: (keyId: string | null) => string; onChanged: () => void }) {
  const { data: d, error, reload } = useLoad<DocDetail>(`/docs/${encodeURIComponent(id)}?tz=${new Date().getTimezoneOffset()}`);
  const message = useRef<HTMLInputElement>(null);
  // Versions picked to turn off or on. The current version can't be turned off, so it has no checkbox.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null); // the version clicked last, where a shift-click range starts
  const changed = () => {
    reload();
    onChanged();
  };
  const older = d ? d.versions.filter((v) => v.n !== d.latest).map((v) => v.n) : [];
  const chosen = d ? d.versions.filter((v) => picked.has(v.n)) : [];
  /** Checks or unchecks a version; with shift, every version between the last one clicked and this one follows it. */
  const toggle = (n: number, shift: boolean) => {
    const on = !picked.has(n);
    const [from, to] = [older.indexOf(anchor ?? -1), older.indexOf(n)];
    const range = shift && from >= 0 ? older.slice(Math.min(from, to), Math.max(from, to) + 1) : [n];
    setPicked(new Set(on ? [...picked, ...range] : [...picked].filter((x) => !range.includes(x))));
    setAnchor(n);
  };
  const stopSelecting = () => (setSelecting(false), setPicked(new Set()), setAnchor(null));
  const setDisabled = async (disabled: boolean) => {
    const versions = chosen.filter((v) => !!v.disabled !== disabled).map((v) => v.n);
    try {
      await api(`/docs/${d!.id}/versions`, { method: "PATCH", json: { versions, disabled } });
      toast.success(`${disabled ? "Turned off" : "Turned on"} ${plural(versions.length, "version")}`);
      stopSelecting();
    } catch (e) {
      toast.error(errorText(e));
    }
    reload();
  };

  return (
    <div className="mx-auto grid max-w-[60rem] grid-cols-1 gap-7 px-4 pt-5 pb-24 sm:px-10 sm:pt-7">
      <a href="#/" className={cn(focusRing, "-ml-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground")}>
        <ChevronLeft className="size-4" aria-hidden />
        All uploads
      </a>
      {error ? (
        <Problem error={error} />
      ) : !d ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4">
            <div className="flex items-start gap-2">
              <h1 className={cn(display, "min-w-0 text-5xl leading-[0.95] [overflow-wrap:anywhere]")}>{nameOf(d)}</h1>
              <div className="pt-1.5">
                <Star d={d} onChanged={changed} />
              </div>
            </div>
            <ul aria-label="Status" className="flex flex-wrap gap-1.5">
              <li className={chip}>
                {d.locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
                {d.locked ? "Password protected" : "Anyone with the link can read it"}
              </li>
              {d.expiresAt !== null && (
                <li className="flex">
                  <Expiry d={d} />
                </li>
              )}
              <li className={chip}>{plural(d.versions.length, "version")}</li>
              <li className="flex empty:hidden">
                <ProjectChip d={d} />
              </li>
              <li className="flex empty:hidden">
                <SpaceChip d={d} />
              </li>
            </ul>
            {/* The link is what this page is for, so it comes before everything you can change. */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 sm:py-2 sm:pr-2 sm:pl-4">
              <a href={openUrl(d)} target="_blank" rel="noopener noreferrer" className={cn(focusRing, "min-w-0 flex-[1_1_16rem] truncate text-[0.9375rem] font-semibold underline-offset-4 hover:underline")}>
                <span className="font-normal text-muted-foreground">{new URL(d.url).host}/view/</span>
                {d.slug ?? d.id}
              </a>
              <div className="flex gap-2 max-sm:w-full">
                <Button className="max-sm:flex-1" onClick={() => copy(d.url)}>
                  <Copy /> Copy link
                </Button>
                <Button variant="outline" className="max-sm:flex-1" asChild>
                  <a href={openUrl(d)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Open
                  </a>
                </Button>
              </div>
            </div>
            {d.views.lastAt !== null && <ViewsStrip views={d.views} />}
          </div>

          <section className="grid grid-cols-1 gap-2.5">
            <h2 className={heading}>Settings</h2>
            <div className="rounded-xl border bg-card p-4">
              {/* Remounts when the saved settings change, but not when a new version arrives, so unsaved edits survive an upload. */}
              <Settings key={[d.title, d.slug, d.locked, d.expiresAt, d.space, d.project].join("\n")} d={d} onChanged={changed} onDeleted={() => (location.hash = "#/")} />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-2.5">
            <h2 className={heading}>New version</h2>
            <div className={cn(dashed, "grid grid-cols-1 gap-2.5 p-3")}>
              <div className="flex flex-wrap gap-2">
                <Input ref={message} maxLength={1000} placeholder="What changed? (optional)" aria-label="Message for the new version" className="w-auto flex-[1_1_14rem]" />
                <DropZone
                  target={{ ref: d.id, message: () => message.current?.value.trim() ?? "" }}
                  overlay={`Drop to add version ${d.latest + 1} of ${nameOf(d)}`}
                  onDone={() => {
                    if (message.current) message.current.value = "";
                    changed();
                  }}
                  className="max-sm:w-full"
                />
              </div>
              <p className="px-1 text-xs text-muted-foreground">Uploading adds version {d.latest + 1}. You can also drop a file or folder anywhere on this page.</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className={heading}>History</h2>
              {/* Only worth a control once there is a version besides the current one. */}
              {older.length > 0 && (
                <Button variant="outline" size="sm" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                  <ListChecks /> {selecting ? "Done" : "Select"}
                </Button>
              )}
            </div>
            {byDay(d.versions, (v) => String(v.n)).map(({ day, entries }) => (
              <div key={day} className="grid grid-cols-1 gap-2.5">
                <h3 className={cn(display, "text-2xl leading-none")}>{dayName(day)}</h3>
                <div className="grid grid-cols-1 gap-2">
                  {entries.map(({ head: v }) => (
                    <Entry
                      key={v.n}
                      color={colorOf(v.keyId)}
                      at={v.createdAt}
                      who={v.keyName ?? (v.keyId ? "A deleted key" : "You")}
                      select={selecting && v.n !== d.latest ? { checked: picked.has(v.n), label: `Select version ${v.n}`, onToggle: (shift) => toggle(v.n, shift) } : undefined}
                      onClick={selecting && v.n !== d.latest ? (e) => !(e.target as Element).closest("a, button, input") && toggle(v.n, e.shiftKey) : undefined}
                      did="uploaded"
                      title={
                        <p className="flex items-center gap-2 text-xl leading-tight font-bold">
                          Version {v.n}
                          {v.n === d.latest && <span className={cn(chip, "bg-primary text-primary-foreground")}>Current</span>}
                          {v.disabled && (
                            <span className={cn(chip, "bg-destructive/10 text-destructive")}>
                              <EyeOff aria-hidden />
                              Turned off
                            </span>
                          )}
                        </p>
                      }
                      message={v.message}
                      meta={
                        <>
                          <span>
                            {plural(v.files, "file")}, {size(v.size)}
                          </span>
                          {!!v.views && <span>{plural(v.views, "view")}</span>}
                        </>
                      }
                      actions={
                        // A turned-off version answers its link with "turned off", so there is nothing to open.
                        !v.disabled && (
                          <Button variant="outline" size="sm" className="max-sm:h-9 max-sm:px-3" asChild>
                            <a href={openUrl(d, v.n)} target="_blank" rel="noopener noreferrer" aria-label={`Open version ${v.n} in a new tab`}>
                              <ExternalLink /> Open this version
                            </a>
                          </Button>
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
            {selecting && (
              <div role="toolbar" aria-label="Selected versions" className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card py-2 pr-2 pl-4 shadow-lg">
                <p aria-live="polite" className="mr-auto text-sm font-semibold">
                  {chosen.length ? `${plural(chosen.length, "version")} selected` : "Select versions to turn their links off or on. Shift-click selects a range."}
                </p>
                <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(picked.size === older.length ? [] : older))}>
                  {picked.size === older.length ? "Clear" : `Select all ${older.length} older`}
                </Button>
                <Button variant="outline" size="sm" disabled={!chosen.some((v) => !v.disabled)} onClick={() => setDisabled(true)}>
                  <PowerOff /> Turn off
                </Button>
                <Button variant="outline" size="sm" disabled={!chosen.some((v) => v.disabled)} onClick={() => setDisabled(false)}>
                  <Power /> Turn on
                </Button>
                <Button variant="outline" size="sm" onClick={stopSelecting}>
                  Cancel
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** How many days of views the strip's bars cover, today last. */
const STRIP_DAYS = 30;

/** A doc's views at a glance: totals, the last open, and a bar per day for the last 30 days. */
function ViewsStrip({ views }: { views: DocDetail["views"] }) {
  const now = new Date();
  const today = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / DAY);
  const perDay = new Map(views.days.map((d) => [d.day, d.views]));
  const counts = Array.from({ length: STRIP_DAYS }, (_, i) => perDay.get(today - (STRIP_DAYS - 1) + i) ?? 0);
  const recent = counts.reduce((a, b) => a + b, 0);
  const most = Math.max(1, ...counts);
  const stat = (label: string, value: ReactNode) => (
    <div className="grid gap-1">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-xl leading-none font-bold tabular-nums">{value}</dd>
    </div>
  );
  return (
    <section aria-label="Views" className="flex flex-wrap items-end gap-x-7 gap-y-3 rounded-xl border bg-card px-4 py-3">
      <dl className="flex flex-wrap gap-x-7 gap-y-3">
        {stat("Views", views.total)}
        {stat("Readers", views.readers)}
        {stat("Last opened", <Time t={views.lastAt!}>{ago(views.lastAt!)}</Time>)}
      </dl>
      <div className="ml-auto grid w-full max-w-72 gap-1 max-sm:max-w-none">
        <div className="flex h-9 items-end gap-[2px]" role="img" aria-label={`${plural(recent, "view")} in the last ${STRIP_DAYS} days`}>
          {counts.map((c, i) => (
            <span
              key={i}
              title={`${dayName(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (STRIP_DAYS - 1 - i)).getTime())}: ${plural(c, "view")}`}
              className={cn("flex-1 rounded-[1px]", c ? "bg-ring" : "bg-muted-foreground opacity-20")}
              style={{ height: c ? `${(c / most) * 100}%` : "8%" }}
            />
          ))}
        </div>
        <p className="flex justify-between text-[0.6875rem] text-muted-foreground" aria-hidden>
          <span>{STRIP_DAYS} days ago</span>
          <span>Today</span>
        </p>
      </div>
    </section>
  );
}
