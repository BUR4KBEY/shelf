import { useState } from "react";
import { ChartColumn, Clock, Lock, Monitor, Moon, PanelLeftClose, Rows3, Search, Settings, Star, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Logo, Tip, display, focusRing, groupName } from "@/components/bits";
import { isExpired } from "@/components/DocBits";
import { Button } from "@/components/ui/button";
import { nameOf, type Activity, type Doc, type Key } from "@/lib/api";
import { timeLeft } from "@/lib/format";
import { setPref, usePref } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { KeyList } from "@/views/Keys";

const DAY = 86_400_000;
/** Docs listed before "Show more". Favorites lead the list, so they and the most recently changed stay in reach; ⌘K finds the rest. */
const LISTED = 20;
const item = "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none hover:bg-card/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-card aria-[current=page]:font-semibold";

/** How the palette's shortcut reads on this machine. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl+";

export const THEMES = [
  ["system", "Match the system", Monitor],
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
] as const;

/** Light, dark, or whatever the system says. Kept in a cookie, so the Worker's own pages (the password form) follow it too. */
export function ThemeSwitch({ className }: { className?: string }) {
  const theme = usePref("theme");
  const pick = (t: string) => setPref("theme", t);
  return (
    <div role="group" aria-label="Theme" className={cn("flex shrink-0 rounded-lg border p-0.5", className)}>
      {THEMES.map(([value, label, Icon]) => (
        <Tip key={value} label={label}>
          <button type="button" aria-label={label} aria-pressed={theme === value} onClick={() => pick(value)} className={cn(focusRing, "grid size-7 place-items-center rounded-md text-muted-foreground hover:text-foreground max-lg:size-9", theme === value && "bg-card text-foreground")}>
            <Icon className="size-3.5" aria-hidden />
          </button>
        </Tip>
      ))}
    </div>
  );
}

/** Every key, and the docs that matter now, always in reach. The log shows what happened; this shows what there is. */
export function Sidebar(props: { docs: Doc[]; uploads: Activity[]; keys: Key[]; colorOf: (keyId: string | null) => string; openId?: string; openKey?: string; settings: boolean; analytics: boolean; email: string; onNavigate: () => void; onKeysChanged: () => void; onCollapse: () => void; onSearch: () => void }) {
  const [showExpired, setShowExpired] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const isOpen = (d: Doc) => d.id === props.openId || (d.slug !== null && d.slug === props.openId);
  const expired = props.docs.filter(isExpired).length;
  // Expired docs stay out of the list unless asked for; the one that is open is always in it, however far down.
  const listed = props.docs.filter((d) => showExpired || !isExpired(d) || isOpen(d));
  const more = listed.filter((d, i) => i >= LISTED && !isOpen(d)).length;
  return (
    <div className="flex min-h-full flex-col gap-7 px-4 py-6 lg:px-5">
      <div className="flex items-center justify-between max-lg:hidden">
        <a href="#/" className={cn(display, focusRing, "flex items-center gap-2.5 text-3xl leading-none")}>
          <Logo className="h-7" />
          shelf
        </a>
        <Tip label="Hide sidebar">
          <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground hover:text-foreground" aria-label="Hide sidebar" onClick={props.onCollapse}>
            <PanelLeftClose />
          </Button>
        </Tip>
      </div>

      <button type="button" onClick={props.onSearch} className={cn(item, "-mx-2.5 -mb-4 border bg-card/40 text-muted-foreground hover:text-foreground")}>
        <Search className="size-4 shrink-0" aria-hidden />
        Search
        <kbd className="ml-auto font-sans text-xs max-lg:hidden">{MOD}K</kbd>
      </button>

      <nav aria-label="Docs" onClick={props.onNavigate}>
        <a href="#/" aria-current={props.openId || props.openKey || props.settings || props.analytics ? undefined : "page"} className={cn(item, "-mx-2.5")}>
          <Rows3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          All uploads
        </a>
        <a href="#/analytics" aria-current={props.analytics ? "page" : undefined} className={cn(item, "-mx-2.5 mt-px")}>
          <ChartColumn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Analytics
        </a>
        <a href="#/settings" aria-current={props.settings ? "page" : undefined} className={cn(item, "-mx-2.5 mt-px mb-5")}>
          <Settings className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Settings
        </a>
        <h2 className={cn(groupName, "mb-2.5 flex justify-between")}>
          On the shelf <span>{props.docs.length - expired}</span>
        </h2>
        <ul className="relative -mx-2.5 grid grid-cols-1 gap-px">
          <AnimatePresence initial={false} mode="popLayout">
            {listed
              .filter((d, i) => showAll || i < LISTED || isOpen(d))
              .map((d) => {
                const left = d.expiresAt === null ? null : timeLeft(d.expiresAt);
                return (
                  <motion.li key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                    <a href={`#/doc/${d.id}`} aria-current={isOpen(d) ? "page" : undefined} className={item}>
                      {d.favorite && (
                        <>
                          <Star className="size-3.5 shrink-0 fill-current text-warning" aria-hidden />
                          <span className="sr-only">favorite</span>
                        </>
                      )}
                      <span className={cn("min-w-0 flex-1 truncate", isExpired(d) && "text-muted-foreground line-through")}>{nameOf(d)}</span>
                      {d.locked && (
                        <>
                          <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="sr-only">password protected</span>
                        </>
                      )}
                      {left && (
                        <span className={cn("flex items-center gap-1 text-xs font-semibold", d.expiresAt! - Date.now() < DAY ? "text-warning" : "text-muted-foreground")}>
                          <Clock className="size-3" aria-hidden />
                          <span className="sr-only">expires in </span>
                          {left}
                        </span>
                      )}
                    </a>
                  </motion.li>
                );
              })}
          </AnimatePresence>
        </ul>
        {more > 0 && (
          // Not a link: it must not close the phone's menu the way picking a doc does.
          <button type="button" aria-pressed={showAll} onClick={(e) => (e.stopPropagation(), setShowAll(!showAll))} className={cn(item, "-mx-2.5 mt-px w-[calc(100%+1.25rem)] text-muted-foreground hover:text-foreground")}>
            {showAll ? "Show fewer" : `Show ${more} more`}
          </button>
        )}
        {expired > 0 && (
          // Not a link: it must not close the phone's menu the way picking a doc does.
          <button type="button" aria-pressed={showExpired} onClick={(e) => (e.stopPropagation(), setShowExpired(!showExpired))} className={cn(item, "-mx-2.5 mt-px w-[calc(100%+1.25rem)] text-muted-foreground hover:text-foreground")}>
            {showExpired ? "Hide expired" : `Show ${expired} expired`}
          </button>
        )}
      </nav>

      <section aria-labelledby="keys-name">
        <h2 id="keys-name" className={cn(groupName, "mb-2.5")}>
          Keys
        </h2>
        <KeyList keys={props.keys} uploads={props.uploads} colorOf={props.colorOf} openKey={props.openKey} onChanged={props.onKeysChanged} onNavigate={props.onNavigate} />
      </section>

      <div className="mt-auto flex items-center justify-between gap-3">
        <p className="truncate text-[0.8125rem] text-muted-foreground" title={props.email}>
          {props.email}
        </p>
        <ThemeSwitch />
      </div>
    </div>
  );
}
