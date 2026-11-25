import { useRef } from "react";
import { ChevronLeft, Copy, ExternalLink, Eye, Lock, LockOpen } from "lucide-react";
import { Loading, Problem, Time, chip, copy, dashed, display, focusRing, useLoad } from "@/components/bits";
import { Expiry, SpaceChip, Star } from "@/components/DocBits";
import { DropZone } from "@/components/DropZone";
import { Entry } from "@/components/Entry";
import { Settings } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nameOf, openUrl, type DocDetail } from "@/lib/api";
import { byDay } from "@/lib/feed";
import { ago, dayName, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The name of a section of the page. */
const heading = "text-base leading-none font-bold";

/** One doc: its link, its settings, a place to add a version, and its whole history as a log. */
export function DocView({ id, colorOf, onChanged }: { id: string; colorOf: (keyId: string | null) => string; onChanged: () => void }) {
  const { data: d, error, reload } = useLoad<DocDetail>(`/docs/${encodeURIComponent(id)}`);
  const message = useRef<HTMLInputElement>(null);
  const changed = () => {
    reload();
    onChanged();
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
              {d.views.lastAt !== null && (
                <li className={chip}>
                  <Eye aria-hidden />
                  {plural(d.views.total, "view")} by {plural(d.views.readers, "reader")}, last <Time t={d.views.lastAt}>{ago(d.views.lastAt)}</Time>
                </li>
              )}
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
          </div>

          <section className="grid grid-cols-1 gap-2.5">
            <h2 className={heading}>Settings</h2>
            <div className="rounded-xl border bg-card p-4">
              {/* Remounts when the saved settings change, but not when a new version arrives, so unsaved edits survive an upload. */}
              <Settings key={[d.title, d.slug, d.locked, d.expiresAt, d.space].join("\n")} d={d} onChanged={changed} onDeleted={() => (location.hash = "#/")} />
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
            <h2 className={heading}>History</h2>
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
                      did="uploaded"
                      title={
                        <p className="flex items-center gap-2 text-xl leading-tight font-bold">
                          Version {v.n}
                          {v.n === d.latest && <span className={cn(chip, "bg-primary text-primary-foreground")}>Current</span>}
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
                        <Button variant="outline" size="sm" className="max-sm:h-9 max-sm:px-3" asChild>
                          <a href={openUrl(d, v.n)} target="_blank" rel="noopener noreferrer" aria-label={`Open version ${v.n} in a new tab`}>
                            <ExternalLink /> Open this version
                          </a>
                        </Button>
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
