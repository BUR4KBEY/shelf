import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { defaultFilter } from "cmdk";
import { ChartColumn, FileText, MessageSquare, PanelLeft, Rows3, Settings, Star } from "lucide-react";
import { SpacesContext } from "@/components/DocBits";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { nameOf, type Doc, type Key } from "@/lib/api";
import { REPO } from "@/lib/build";
import { setPref, usePref } from "@/lib/prefs";
import { land } from "@/lib/sections";
import { ANALYTICS_SECTIONS } from "@/views/Analytics";
import { SETTINGS_SECTIONS } from "@/views/AppSettings";
import { THEMES } from "@/views/Sidebar";

/** `g` then one of these keys opens a page, like GitHub and Linear. */
const PAGES = [
  ["u", "#/", "All uploads", Rows3],
  ["a", "#/analytics", "Analytics", ChartColumn],
  ["s", "#/settings", "Settings", Settings],
] as const;

const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/** One thing to pick. `value` is what the search matches (with `keywords`) and what Recent remembers, so it must stay the same across renders. */
type Entry = { value: string; label: ReactNode; icon?: ReactNode; keywords?: string[]; shortcut?: string; className?: string; checked?: boolean; act: () => void };

/** The last picks, newest first, shown while the search is empty. Kept in this browser only. */
const RECENT = "palette-recent";
const RECENT_MAX = 5;

const crumb = (page: string, label: ReactNode) => (
  <>
    <span className="text-muted-foreground">{page} ›</span>
    {label}
  </>
);

/** ⌘K / Ctrl+K: jump to any page, page section, doc or key, filter analytics, switch the theme or fold the sidebar. The single-key shortcuts it lists work without it. */
export function CommandPalette(props: { open: boolean; onOpenChange: (open: boolean) => void; docs: Doc[]; keys: Key[]; side: boolean; onToggleSide: () => void; onNavigate: () => void }) {
  const { open, onToggleSide, onNavigate } = props;
  const theme = usePref("theme");
  const spaces = useContext(SpacesContext) ?? [];
  const g = useRef(0); // when `g` was pressed; the next key within a second picks the page. A ref, so a re-render between the two keys keeps it.
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT) ?? "[]");
    } catch {
      return [];
    }
  });
  // Each open starts with an empty search, so Recent shows.
  const onOpenChange = (next: boolean) => {
    if (!next) setSearch("");
    props.onOpenChange(next);
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (!open && dialogOpen()) return; // never on top of another dialog
        e.preventDefault();
        return onOpenChange(!open);
      }
      // Keys typed into a field, or while a dialog is open, are not shortcuts.
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing || dialogOpen()) return;
      const page = Date.now() - g.current < 1000 && PAGES.find(([key]) => key === e.key);
      g.current = e.key === "g" ? Date.now() : 0;
      if (page) {
        location.hash = page[1];
        onNavigate();
      } else if (e.key === "[") onToggleSide();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [open, onOpenChange, onToggleSide, onNavigate]);

  const go = (hash: string) => () => {
    location.hash = hash;
    onNavigate();
  };
  // Already on that link, the hash doesn't change, so land here too; on another page, the page lands once it renders.
  const jump = (page: string, section: string, query = "") => () => {
    location.hash = `#/${page}/${section}${query && `?${query}`}`;
    onNavigate();
    land(`${page}-${section}`);
  };
  const github = (path: string) => () => window.open(`https://github.com/${REPO}${path}`, "_blank", "noopener");

  const groups: [string, Entry[]][] = [
    ["Pages", PAGES.map(([key, hash, label, Icon]) => ({ value: label, label, icon: <Icon />, shortcut: `G ${key.toUpperCase()}`, act: go(hash) }))],
    ["Settings", SETTINGS_SECTIONS.map(([id, label, words]) => ({ value: `settings > ${label}`, label: crumb("Settings", label), icon: <Settings />, keywords: [...words], act: jump("settings", id) }))],
    [
      "Analytics",
      [
        ...ANALYTICS_SECTIONS.map(([id, label, words]) => ({ value: `analytics > ${label}`, label: crumb("Analytics", label), icon: <ChartColumn />, keywords: [...words], act: jump("analytics", id) })),
        ...props.keys.map((k) => ({ value: `analytics > show key ${k.id}`, label: crumb("Analytics", `Show key: ${k.name}`), icon: <ChartColumn />, keywords: [k.name, "filter"], act: jump("analytics", "uploads", `key=${encodeURIComponent(k.id)}`) })),
        // Only worth a filter once there are two spaces to tell apart, as on the page.
        ...(spaces.length > 1 ? spaces.map((s) => ({ value: `analytics > space ${s.id}`, label: crumb("Analytics", `Space: ${s.name}`), icon: <ChartColumn />, keywords: [s.name, "filter"], act: go(`#/analytics?space=${encodeURIComponent(s.id)}`) })) : []),
      ],
    ],
    ["Docs", props.docs.map((d) => ({ value: `doc ${d.id}`, label: <span className="truncate">{nameOf(d)}</span>, icon: <FileText />, keywords: [nameOf(d), d.slug ?? "", d.project ?? ""], act: go(`#/doc/${d.id}`) }))],
    [
      "Keys",
      props.keys.map((k) => ({
        value: `key ${k.id}`,
        label: (
          <>
            <span className="truncate">{k.name}</span>
            {k.revokedAt && <span className="text-xs text-muted-foreground">revoked</span>}
          </>
        ),
        keywords: [k.name],
        act: go(`#/key/${k.id}`),
      })),
    ],
    [
      "Commands",
      [
        // The rail only exists on a wide screen.
        { value: "toggle sidebar", label: props.side ? "Hide sidebar" : "Show sidebar", icon: <PanelLeft />, keywords: ["hide", "show", "fold"], shortcut: "[", className: "max-lg:hidden", act: onToggleSide },
        ...THEMES.map(([value, label, Icon]) => ({ value: `theme ${label}`, label: `Theme: ${label}`, icon: <Icon />, checked: theme === value, act: () => setPref("theme", value) })),
      ],
    ],
    [
      "shelf",
      [
        { value: "star shelf on github", label: "Star shelf on GitHub", icon: <Star className="fill-current text-warning" />, keywords: ["source", "repo", "support", "open source"], act: github("") },
        { value: "report a bug or suggest an idea", label: "Report a bug or suggest an idea", icon: <MessageSquare />, keywords: ["github", "issue", "feedback", "feature request"], act: github("/issues/new") },
      ],
    ],
  ];

  const pick = (e: Entry) => {
    const next = [e.value, ...recent.filter((v) => v !== e.value)].slice(0, RECENT_MAX);
    setRecent(next);
    localStorage.setItem(RECENT, JSON.stringify(next));
    onOpenChange(false);
    e.act();
  };
  // A doc or key deleted since drops out on its own.
  const all = new Map(groups.flatMap(([, entries]) => entries.map((e) => [e.value, e] as const)));
  const recents = search ? [] : recent.flatMap((v) => all.get(v) ?? []);
  // cmdk 1.1 sorts items within a group but never the groups (it looks them up by an id they don't carry), so the best match's group goes first here.
  const best = (entries: Entry[]) => entries.reduce((max, e) => Math.max(max, defaultFilter(e.value, search, e.keywords)), 0);
  const sorted = search ? groups.toSorted((x, y) => best(y[1]) - best(x[1])) : groups;

  // Recent copies need their own value: cmdk tells items apart by it.
  const item = (e: Entry, prefix = "") => (
    <CommandItem key={prefix + e.value} value={prefix + e.value} keywords={e.keywords} className={e.className} data-checked={e.checked} onSelect={() => pick(e)}>
      {e.icon}
      {e.label}
      {e.shortcut && <CommandShortcut>{e.shortcut}</CommandShortcut>}
    </CommandItem>
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a page, section, doc or key, or run a command">
      <Command>
        <CommandInput value={search} onValueChange={setSearch} placeholder="Search docs, keys and commands…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {recents.length > 0 && <CommandGroup heading="Recent">{recents.map((e) => item(e, "recent "))}</CommandGroup>}
          {sorted.map(
            ([heading, entries]) =>
              entries.length > 0 && (
                <CommandGroup key={heading} heading={heading}>
                  {entries.map((e) => item(e))}
                </CommandGroup>
              ),
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
