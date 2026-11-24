import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, PanelLeftOpen, X } from "lucide-react";
import { MotionConfig, animate, motion, useMotionValue, useReducedMotion, type MotionStyle } from "motion/react";
import { Loading, Logo, Problem, Tip, display, focusRing, useLoad, useTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, nameOf, type Activity, type Doc, type Key } from "@/lib/api";
import { NO_KEY, keyColors } from "@/lib/feed";
import { cn } from "@/lib/utils";
import { AppSettingsView } from "@/views/AppSettings";
import { DocView } from "@/views/Doc";
import { FeedView } from "@/views/Feed";
import { Sidebar } from "@/views/Sidebar";

function useHashPath() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "");
}

/** The sidebar (every doc, every key) beside the log of uploads, one doc's page, or the app's settings. On a narrow screen a button swaps the two. */
export function App() {
  const route = useHashPath();
  const open = route.match(/^doc\/([^/]+)$/)?.[1];
  const openId = open && decodeURIComponent(open);
  const settings = route === "settings";
  const docs = useLoad<Doc[]>("/docs");
  const uploads = useLoad<Activity[]>("/uploads");
  const keys = useLoad<Key[]>("/keys");
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
  useTitle(openDoc ? nameOf(openDoc) : settings ? "Settings" : "");
  const colors = useMemo(() => keyColors(keys.data ?? []), [keys.data]);
  const colorOf = (keyId: string | null) => (keyId && colors.get(keyId)) || NO_KEY;
  const changed = () => {
    docs.reload();
    uploads.reload();
  };
  const error = docs.error ?? uploads.error ?? keys.error;

  return (
    <MotionConfig reducedMotion="user">
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
                <Sidebar docs={docs.data} uploads={uploads.data} keys={keys.data} colorOf={colorOf} openId={openId} settings={settings} email={email} onNavigate={() => setMenu(false)} onKeysChanged={keys.reload} onCollapse={toggleSide} />
              </div>
              <div className={cn("hidden w-14 justify-center pt-5", !side && "lg:flex")}>
                <Tip label="Show sidebar">
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Show sidebar" onClick={toggleSide}>
                    <PanelLeftOpen />
                  </Button>
                </Tip>
              </div>
            </aside>
            <main ref={mainRef} className={cn("min-w-0", menu && "max-lg:hidden")}>
              <motion.div key={openId ?? (settings ? "#settings" : "")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                {openId ? <DocView key={openId} id={openId} colorOf={colorOf} onChanged={changed} /> : settings ? <AppSettingsView /> : <FeedView docs={docs.data} uploads={uploads.data} colorOf={colorOf} onChanged={changed} />}
              </motion.div>
            </main>
          </motion.div>
        )}
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </MotionConfig>
  );
}
