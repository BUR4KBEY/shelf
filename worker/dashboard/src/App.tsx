import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, PanelLeftOpen, Search, X } from "lucide-react";
import { MotionConfig, animate, motion, useMotionValue, useReducedMotion, type MotionStyle } from "motion/react";
import { Loading, Logo, Problem, Tip, display, focusRing, useLoad, useTitle } from "@/components/bits";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, nameOf, type Activity, type Doc, type Key, type Space } from "@/lib/api";
import { SpacesContext } from "@/components/DocBits";
import { NO_KEY, keyColors } from "@/lib/feed";
import { useFavicon } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { AnalyticsView } from "@/views/Analytics";
import { AppSettingsView } from "@/views/AppSettings";
import { DocView } from "@/views/Doc";
import { KeyView } from "@/views/Key";
import { FeedView } from "@/views/Feed";
import { MOD, Sidebar, ThemeSwitch } from "@/views/Sidebar";

function useHashPath() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "");
}

/** The sidebar (every doc, every key) beside the log of uploads, one doc's or key's page, analytics, or the app's settings. On a narrow screen a button swaps the two. */
export function App() {
  const route = useHashPath();
  useFavicon();
  const open = route.match(/^doc\/([^/]+)$/)?.[1];
  const openId = open && decodeURIComponent(open);
  const openKey = route.match(/^key\/([^/]+)$/)?.[1];
  const settings = route === "settings";
  const analytics = route === "analytics";
  const docs = useLoad<Doc[]>("/docs");
  const uploads = useLoad<Activity[]>("/uploads");
  const keys = useLoad<Key[]>("/keys");
  const spaces = useLoad<Space[]>("/spaces");
  const [menu, setMenu] = useState(false);
  const reduce = useReducedMotion();
  const asideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const swapped = useRef(false);
  // On a narrow screen the button swaps the sidebar and the log; whichever comes into view slides in. Skips the first render.
  useEffect(() => {
    if (!swapped.current) return void (swapped.current = true);
    const el = (menu ? asideRef : mainRef).current;
    if (el) animate(el, reduce ? { opacity: [0, 1] } : { opacity: [0, 1], x: [menu ? -16 : 16, 0] }, { duration: 0.22, ease: "easeOut" });
  }, [menu]);
  // On a wide screen the sidebar folds down to a rail; the choice is remembered.
  const [side, setSide] = useState(() => localStorage.getItem("sidebar") !== "closed");
  const sideWidth = useMotionValue(side ? "19rem" : "3.5rem"); // the sidebar column's width, slid between the full sidebar and the rail
  const toggleSide = () => {
    localStorage.setItem("sidebar", side ? "closed" : "open");
    animate(sideWidth, side ? "3.5rem" : "19rem", { duration: reduce ? 0 : 0.25, ease: "easeOut" });
    setSide(!side);
  };
  const [palette, setPalette] = useState(false);
  const [email, setEmail] = useState("");
  useEffect(() => void api<{ email: string }>("/me").then((me) => setEmail(me.email), () => { }), []);
  useEffect(() => {
    // Without this a file dropped outside an upload view makes the browser open it.
    const stop = (e: DragEvent) => e.dataTransfer?.types.includes("Files") && e.preventDefault();
    addEventListener("dragover", stop);
    addEventListener("drop", stop);
    return () => {
      removeEventListener("dragover", stop);
      removeEventListener("drop", stop);
    };
  }, []);

  const openDoc = docs.data?.find((d) => d.id === openId || d.slug === openId);
  useTitle(openDoc ? nameOf(openDoc) : openKey ? (keys.data?.find((k) => k.id === openKey)?.name ?? "") : settings ? "Settings" : analytics ? "Analytics" : "");
  const colors = useMemo(() => keyColors(keys.data ?? []), [keys.data]);
  const colorOf = (keyId: string | null) => (keyId && colors.get(keyId)) || NO_KEY;
  // Spaces count their docs, so they reload with them.
  const changed = () => {
    docs.reload();
    uploads.reload();
    spaces.reload();
  };
  // Deleting a space moves its keys too.
  const spacesChanged = () => {
    keys.reload();
    changed();
  };
  const error = docs.error ?? uploads.error ?? keys.error;

  return (
    <MotionConfig reducedMotion="user">
      <SpacesContext.Provider value={spaces.data}>
        <TooltipProvider delayDuration={300}>
          {error ? (
            <Problem error={error} className="p-8" />
          ) : !docs.data || !uploads.data || !keys.data ? (
            <Loading className="p-8" />
          ) : (
            <motion.div style={{ "--side": sideWidth } as MotionStyle} className="min-h-dvh lg:grid lg:grid-cols-[var(--side)_minmax(0,1fr)]">
              <header className="sticky top-0 z-20 flex h-14 items-center border-b bg-sidebar px-4 lg:hidden">
                <a href="#/" onClick={() => setMenu(false)} className={cn(display, focusRing, "flex items-center gap-2 text-[1.75rem] leading-none")}>
                  <Logo className="h-6" />
                  shelf
                </a>
                <Button variant="outline" className="ml-auto" aria-pressed={menu} onClick={() => setMenu(!menu)}>
                  {menu ? <X /> : <Menu />}
                  {menu ? "Back to the log" : "Docs and keys"}
                </Button>
              </header>
              <aside ref={asideRef} className={cn("bg-sidebar max-lg:min-h-[calc(100dvh-3.5rem)] lg:sticky lg:top-0 lg:h-dvh lg:overflow-x-hidden lg:overflow-y-auto lg:border-r", !menu && "max-lg:hidden")}>
                {/* Full width while the column slides, so the column clips it instead of squeezing it. */}
                <div className={cn("max-lg:contents lg:h-full lg:w-[calc(19rem-1px)]", !side && "lg:hidden")}>
                  <Sidebar docs={docs.data} uploads={uploads.data} keys={keys.data} colorOf={colorOf} openId={openId} openKey={openKey} settings={settings} analytics={analytics} email={email} onNavigate={() => setMenu(false)} onKeysChanged={keys.reload} onCollapse={toggleSide} onSearch={() => setPalette(true)} />
                </div>
                <div className={cn("hidden h-full w-14 flex-col items-center gap-3 pt-5 pb-6", !side && "lg:flex")}>
                  <a href="#/" aria-label="shelf" className={cn(focusRing, "rounded-md p-1")}>
                    <Logo className="w-8" />
                  </a>
                  <Tip label="Show sidebar">
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Show sidebar" onClick={toggleSide}>
                      <PanelLeftOpen />
                    </Button>
                  </Tip>
                  <Tip label={`Search (${MOD}K)`}>
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Search" onClick={() => setPalette(true)}>
                      <Search />
                    </Button>
                  </Tip>
                  <ThemeSwitch className="mt-auto flex-col" />
                </div>
              </aside>
              <main ref={mainRef} className={cn("min-w-0", menu && "max-lg:hidden")}>
                <motion.div key={openId ?? (openKey ? `#key/${openKey}` : settings ? "#settings" : analytics ? "#analytics" : "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                  {openId ? (
                    <DocView key={openId} id={openId} colorOf={colorOf} onChanged={changed} />
                  ) : openKey ? (
                    <KeyView key={openKey} id={openKey} docs={docs.data} colorOf={colorOf} onChanged={changed} onKeysChanged={keys.reload} />
                  ) : settings ? (
                    <AppSettingsView onSpacesChanged={spacesChanged} />
                  ) : analytics ? (
                    <AnalyticsView keys={keys.data} docs={docs.data} colorOf={colorOf} />
                  ) : (
                    <FeedView docs={docs.data} uploads={uploads.data} colorOf={colorOf} onChanged={changed} />
                  )}
                </motion.div>
              </main>
              <CommandPalette open={palette} onOpenChange={setPalette} docs={docs.data} keys={keys.data} side={side} onToggleSide={toggleSide} onNavigate={() => setMenu(false)} />
            </motion.div>
          )}
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </SpacesContext.Provider>
    </MotionConfig>
  );
}
