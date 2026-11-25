import { useEffect, useRef } from "react";
import { ChartColumn, FileText, PanelLeft, Rows3, Settings } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { nameOf, type Doc, type Key } from "@/lib/api";
import { setPref, usePref } from "@/lib/prefs";
import { THEMES } from "@/views/Sidebar";

/** `g` then one of these keys opens a page, like GitHub and Linear. */
const PAGES = [
  ["u", "#/", "All uploads", Rows3],
  ["a", "#/analytics", "Analytics", ChartColumn],
  ["s", "#/settings", "Settings", Settings],
] as const;

const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/** ⌘K / Ctrl+K: jump to any page, doc or key, switch the theme or fold the sidebar. The single-key shortcuts it lists work without it. */
export function CommandPalette(props: { open: boolean; onOpenChange: (open: boolean) => void; docs: Doc[]; keys: Key[]; side: boolean; onToggleSide: () => void; onNavigate: () => void }) {
  const { open, onOpenChange, onToggleSide, onNavigate } = props;
  const theme = usePref("theme");
  const g = useRef(0); // when `g` was pressed; the next key within a second picks the page. A ref, so a re-render between the two keys keeps it.

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

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };
  const go = (hash: string) => run(() => ((location.hash = hash), onNavigate()));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Jump to a page, doc or key, or run a command">
      <Command>
        <CommandInput placeholder="Search docs, keys and commands…" />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandGroup heading="Pages">
            {PAGES.map(([key, hash, label, Icon]) => (
              <CommandItem key={hash} onSelect={go(hash)}>
                <Icon />
                {label}
                <CommandShortcut>G {key.toUpperCase()}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {props.docs.length > 0 && (
            <CommandGroup heading="Docs">
              {props.docs.map((d) => (
                <CommandItem key={d.id} value={`doc ${d.id}`} keywords={[nameOf(d), d.slug ?? ""]} onSelect={go(`#/doc/${d.id}`)}>
                  <FileText />
                  <span className="truncate">{nameOf(d)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {props.keys.length > 0 && (
            <CommandGroup heading="Keys">
              {props.keys.map((k) => (
                <CommandItem key={k.id} value={`key ${k.id}`} keywords={[k.name]} onSelect={go(`#/key/${k.id}`)}>
                  <span className="truncate">{k.name}</span>
                  {k.revokedAt && <span className="text-xs text-muted-foreground">revoked</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Commands">
            {/* The rail only exists on a wide screen. */}
            <CommandItem onSelect={run(onToggleSide)} className="max-lg:hidden">
              <PanelLeft />
              {props.side ? "Hide sidebar" : "Show sidebar"}
              <CommandShortcut>[</CommandShortcut>
            </CommandItem>
            {THEMES.map(([value, label, Icon]) => (
              <CommandItem key={value} value={`theme ${label}`} data-checked={theme === value} onSelect={run(() => setPref("theme", value))}>
                <Icon />
                Theme: {label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
