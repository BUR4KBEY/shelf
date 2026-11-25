import { useContext, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, ListChecks, Pencil, Search, Settings2, Star, Trash2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Confirm, Tip, copy, dashed, display, focusRing } from "@/components/bits";
import { DocName, Expiry, Locked, ProjectChip, SpaceChip, SpacesContext, isExpired } from "@/components/DocBits";
import { BulkEdit } from "@/components/BulkEdit";
import { DropZone } from "@/components/DropZone";
import { Entry } from "@/components/Entry";
import { Settings } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorText, nameOf, openUrl, type Activity, type Doc } from "@/lib/api";
import { byDay } from "@/lib/feed";
import { clock, dayName, longDate, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Expired docs are left out of every filter but their own: they are gone for readers and deleted within a day. */
const FILTERS: [string, string, (d: Doc) => boolean][] = [
  ["all", "Everything", (d) => !isExpired(d)],
  ["favorites", "Favorites", (d) => d.favorite && !isExpired(d)],
  ["locked", "Password protected", (d) => d.locked && !isExpired(d)],
  ["expiring", "Expiring", (d) => d.expiresAt !== null && !isExpired(d)],
  ["expired", "Expired", isExpired],
];
/** How many of a doc's earlier uploads from the same day are listed under its newest. */
const FOLDED = 3;
/** The Worker sends this many uploads at most. */
const CAP = 200;

/** The home screen: what was uploaded and by whom, newest first, a day at a time. */
export function FeedView({ docs, uploads, colorOf, onChanged }: { docs: Doc[]; uploads: Activity[]; colorOf: (keyId: string | null) => string; onChanged: () => void }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const spaces = useContext(SpacesContext) ?? [];
  const [space, setSpace] = useState("*"); // "*": every space
  const inSpace = (d: Doc) => space === "*" || d.space === space;
  const [project, setProject] = useState("*"); // "*": every project, and docs in none
  const inProject = (d: Doc) => project === "*" || d.project === project;
  const projects = [...new Set(docs.filter(inSpace).flatMap((d) => d.project ?? []))].sort((a, b) => a.localeCompare(b));
  const [open, setOpen] = useState<string | null>(null); // the entry whose settings are open
  const byId = new Map(docs.map((d) => [d.id, d]));
  const keep = FILTERS.find(([value]) => value === filter)![2];
  const q = query.trim().toLowerCase();
  const shown = uploads.filter((u) => {
    const d = byId.get(u.docId);
    return d && inSpace(d) && inProject(d) && keep(d) && [d.title, d.slug, d.id, d.project, u.message].some((s) => s?.toLowerCase().includes(q));
  });
  // Selection is by doc: deleting removes every version, so all of a doc's entries check together.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null); // the doc clicked last, where a shift-click range starts
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const chosen = docs.filter((d) => picked.has(d.id));
  const shownIds = [...new Set(shown.map((u) => u.docId))];
  const allShown = shownIds.length > 0 && shownIds.every((id) => picked.has(id));
  // Picked docs the filters or search now hide: an action still reaches them, so the user must see that.
  const hidden = chosen.filter((d) => !shownIds.includes(d.id));
  const allFavorite = chosen.length > 0 && chosen.every((d) => d.favorite);
  /** Checks or unchecks a doc; with shift, every doc shown between the last one clicked and this one follows it. */
  const toggle = (id: string, shift: boolean) => {
    const on = !picked.has(id);
    const [from, to] = [shownIds.indexOf(anchor ?? ""), shownIds.indexOf(id)];
    const range = shift && from >= 0 ? shownIds.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
    setPicked(new Set(on ? [...picked, ...range] : [...picked].filter((x) => !range.includes(x))));
    setAnchor(id);
  };
  const stopSelecting = () => (setSelecting(false), setPicked(new Set()), setAnchor(null));
  /** Sends the picked docs to /docs/bulk, which changes all of them or none; true once it worked. */
  const bulk = async (body: Record<string, unknown>, done: string) => {
    try {
      await api("/docs/bulk", { method: "POST", json: { ids: chosen.map((d) => d.id), ...body } });
      toast.success(done);
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    } finally {
      onChanged();
    }
  };
  const hiddenWarning = hidden.length > 0 && (
    <p role="alert" className="flex gap-2 rounded-lg bg-warning/15 p-3 text-sm font-semibold text-warning [overflow-wrap:anywhere]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {plural(hidden.length, "selected doc")} {hidden.length === 1 ? "is" : "are"} hidden by the current filters or search, and this acts on {hidden.length === 1 ? "it" : "them"} too: {hidden.slice(0, 3).map(nameOf).join(", ")}
        {hidden.length > 3 && ` and ${hidden.length - 3} more`}.
      </span>
    </p>
  );

  return (
    // A flex column, not a grid: Safari lays out a grid of nested grids again on every frame the sidebar slides, which takes seconds on a long log.
    <div className="mx-auto flex max-w-[60rem] flex-col gap-6 px-4 pt-5 pb-24 sm:px-10 sm:pt-7">
      <div className={cn(dashed, "flex flex-wrap items-center gap-x-4 gap-y-3 py-3 pr-3 pl-4")}>
        <p className="min-w-0 flex-[1_1_14rem] text-muted-foreground">
          <b className="font-semibold text-foreground">Drop a file or folder anywhere</b> to publish it
        </p>
        <DropZone target={{}} overlay="Drop a file or folder to publish it" onDone={onChanged} className="max-sm:w-full" />
      </div>

      {docs.length === 0 ? (
        <div className="grid gap-1.5 pt-6">
          <p className={cn(display, "text-4xl leading-none")}>Nothing published yet</p>
          <p className="max-w-[60ch] text-muted-foreground">Drop a file or folder anywhere on this page. To publish from the CLI or an agent, create a key first; every upload then shows up here under that key's name.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {FILTERS.map(([value, label, test]) => {
              const count = docs.filter((d) => inSpace(d) && inProject(d) && test(d)).length;
              // "Expired" only shows up when there is something expired to look at.
              if (value === "expired" && !count && filter !== value) return null;
              return (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn(focusRing, "relative isolate rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground", filter === value && "text-foreground")}>
                  {filter === value && <motion.span layoutId="filter-pill" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }} className="absolute inset-0 -z-10 rounded-lg bg-card shadow-[0_0_0_1px_var(--border)]" aria-hidden />}
                  {label}
                  <span className="ml-1.5 text-xs tabular-nums opacity-70">
                    {count}
                    <span className="sr-only"> docs</span>
                  </span>
                </button>
              );
            })}
            {/* Only worth a control once some doc has a project. */}
            {projects.length > 0 && (
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger aria-label="Project" className="sm:ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectItem value="*">All projects</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* Only worth a control once there are two spaces to tell apart. */}
            {spaces.length > 1 && (
              <Select
                value={space}
                onValueChange={(s) => {
                  setSpace(s);
                  setProject("*"); // project names are per space
                }}
              >
                <SelectTrigger aria-label="Space" className={cn(!projects.length && "sm:ml-auto")}>
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
            <div className={cn("relative w-full sm:w-60", spaces.length < 2 && !projects.length && "sm:ml-auto")}>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search docs and messages" aria-label="Search docs and messages" autoComplete="off" className="pl-8" />
            </div>
            <Button variant="outline" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : (setSelecting(true), setOpen(null)))}>
              <ListChecks /> {selecting ? "Done" : "Select"}
            </Button>
          </div>

          {shown.length === 0 && <p className="pt-4 text-muted-foreground">{q ? `No upload has “${query.trim()}” in its doc's title, slug, id or project, or in its message.` : "No uploads match this filter."}</p>}

          {byDay(shown, (u) => u.docId).map(({ day, count, entries }) => (
            <section key={day} aria-label={dayName(day)} className="flex flex-col gap-3">
              <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                <h2 className={cn(display, "text-4xl leading-none")}>{dayName(day)}</h2>
                <p className="text-muted-foreground">{[dayName(day) !== longDate(day) && longDate(day), plural(count, "upload")].filter(Boolean).join(", ")}</p>
              </header>
              <div className="flex flex-col gap-2">
                {entries.map(({ head, older }) => {
                  const d = byId.get(head.docId)!;
                  const key = `${day}:${d.id}`;
                  return (
                    <Entry
                      key={key}
                      color={colorOf(head.keyId)}
                      at={head.createdAt}
                      who={head.keyName ?? (head.keyId ? "A deleted key" : "You")}
                      select={selecting ? { checked: picked.has(d.id), label: `Select ${nameOf(d)}`, onToggle: (shift) => toggle(d.id, shift) } : undefined}
                      // A click on the card, off its controls and its open settings, toggles them (or, while selecting, its checkbox); the gear button stays for keyboards.
                      // `contains` skips clicks in portals (the expiry menu, the delete dialog), which React still bubbles here.
                      onClick={(e) => e.currentTarget.contains(e.target as Node) && !(e.target as Element).closest("a, button, input, label, select, textarea, [data-settings]") && !getSelection()?.toString() && (selecting ? toggle(d.id, e.shiftKey) : setOpen(open === key ? null : key))}
                      did={head.n === 1 ? "uploaded a new doc" : `uploaded version ${head.n} of`}
                      title={<DocName d={d} onChanged={onChanged} />}
                      message={head.message}
                      meta={
                        <>
                          <span>
                            {plural(head.files, "file")}, {size(head.size)}
                          </span>
                          <ProjectChip d={d} />
                          <SpaceChip d={d} />
                          <Locked d={d} />
                          <Expiry d={d} />
                        </>
                      }
                      actions={
                        <div className="grid gap-1.5 sm:justify-items-end">
                          <div className="flex gap-1">
                            <Tip label="Settings">
                              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground max-sm:size-9" aria-expanded={open === key} aria-label={`Settings for ${nameOf(d)}`} onClick={() => setOpen(open === key ? null : key)}>
                                <Settings2 />
                              </Button>
                            </Tip>
                            <Button variant="outline" size="sm" className="max-sm:h-9 max-sm:px-3" onClick={() => copy(d.url)}>
                              <Copy /> Copy link
                            </Button>
                          </div>
                          <a href={openUrl(d)} target="_blank" rel="noopener noreferrer" className={cn(focusRing, "flex max-w-56 items-center gap-1 text-[0.8125rem] text-muted-foreground hover:underline")}>
                            <span className="truncate">
                              /view/<span className="font-medium text-foreground">{d.slug ?? d.id}</span>
                            </span>
                            <ExternalLink className="size-3 shrink-0" aria-hidden />
                            <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        </div>
                      }
                    >
                      <>
                        {older.length > 0 && (
                          <ul className="mt-2 grid gap-0.5 text-[0.8125rem] text-muted-foreground">
                            {older.slice(0, FOLDED).map((o) => (
                              <li key={o.n} className="[overflow-wrap:anywhere]">
                                <b className="mr-2 font-semibold text-foreground tabular-nums">{clock(o.createdAt)}</b>
                                Version {o.n}
                                {o.message && `: ${o.message}`}
                              </li>
                            ))}
                            {older.length > FOLDED && <li>and {older.length - FOLDED} earlier that day</li>}
                          </ul>
                        )}
                        <AnimatePresence initial={false}>
                          {open === key && (
                            // Clipped only while it slides, so the inputs' focus rings show once it is open.
                            <motion.div initial={{ height: 0, opacity: 0, overflow: "hidden" }} animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }} exit={{ height: 0, opacity: 0, overflow: "hidden" }} transition={{ duration: 0.22, ease: "easeOut" }}>
                              <div data-settings className="mt-3 border-t border-(--k)/30 pt-3.5">
                                <Settings key={[d.title, d.slug, d.locked, d.expiresAt, d.space, d.project].join("\n")} d={d} onChanged={onChanged} onDeleted={() => setOpen(null)} />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </>
                    </Entry>
                  );
                })}
              </div>
            </section>
          ))}

          {uploads.length >= CAP && <p className="text-sm text-muted-foreground">These are the newest {CAP} uploads. Open a doc from the list to see its whole history.</p>}

          {selecting && (
            <div role="toolbar" aria-label="Selected docs" className="sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card py-2 pr-2 pl-4 shadow-lg">
              <p aria-live="polite" className="mr-auto text-sm font-semibold">
                {chosen.length ? `${plural(chosen.length, "doc")} selected` : "Select docs to act on them. Shift-click selects a range."}
                {hidden.length > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-xs text-warning">
                    <TriangleAlert className="size-3" aria-hidden />
                    {hidden.length} hidden by filters
                    <button type="button" onClick={() => setPicked(new Set(shownIds.filter((id) => picked.has(id))))} className={cn(focusRing, "ml-1 underline underline-offset-2")}>
                      Unselect
                    </button>
                  </span>
                )}
              </p>
              <Button variant="ghost" size="sm" disabled={!shownIds.length} onClick={() => setPicked(new Set(allShown ? [...picked].filter((id) => !shownIds.includes(id)) : [...picked, ...shownIds]))}>
                {allShown ? "Clear shown" : `Select all ${shownIds.length} shown`}
              </Button>
              <Button variant="outline" size="sm" disabled={!chosen.length} onClick={() => bulk({ favorite: !allFavorite }, allFavorite ? `Removed ${plural(chosen.length, "doc")} from favorites` : `Added ${plural(chosen.length, "doc")} to favorites`)}>
                <Star /> {allFavorite ? "Unfavorite" : "Favorite"}
              </Button>
              <Button variant="outline" size="sm" disabled={!chosen.length} onClick={() => setEditing(true)}>
                <Pencil /> Change…
              </Button>
              <Button variant="destructive" size="sm" disabled={!chosen.length} onClick={() => setConfirming(true)}>
                <Trash2 /> Delete
              </Button>
              <Button variant="outline" size="sm" onClick={stopSelecting}>
                Cancel
              </Button>
            </div>
          )}
          <BulkEdit open={editing} onOpenChange={setEditing} count={chosen.length} onSave={async (body) => (await bulk(body, `Changed ${plural(chosen.length, "doc")}`)) && (setEditing(false), true)}>
            {hiddenWarning}
          </BulkEdit>
          <Confirm
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${plural(chosen.length, "doc")}?`}
            body={`This removes ${chosen.slice(0, 3).map(nameOf).join(", ")}${chosen.length > 3 ? ` and ${chosen.length - 3} more` : ""}, with every version of each. Their links stop working. This can't be undone.`}
            action="Delete"
            onConfirm={async () => (await bulk({ delete: true }, `Deleted ${plural(chosen.length, "doc")}`)) && stopSelecting()}
          >
            {hiddenWarning}
          </Confirm>
        </>
      )}
    </div>
  );
}
