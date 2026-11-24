import { useEffect, useMemo, useState } from "react";
import { Menu, PanelLeftOpen, X } from "lucide-react";
import { Loading, Problem, Tip, display, focusRing, useLoad, useTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, nameOf, type Activity, type Doc, type Key } from "@/lib/api";
import { NO_KEY, keyColors } from "@/lib/feed";
import { cn } from "@/lib/utils";
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

/** The sidebar (every doc, every key) beside the log of uploads, or one doc's page. On a narrow screen a button swaps the two. */
export function App() {
  const open = useHashPath().match(/^doc\/([^/]+)$/)?.[1];
  const openId = open && decodeURIComponent(open);
  const docs = useLoad<Doc[]>("/docs");
  const uploads = useLoad<Activity[]>("/uploads");
  const keys = useLoad<Key[]>("/keys");
  const [menu, setMenu] = useState(false);
  // On a wide screen the sidebar folds down to a rail; the choice is remembered.
  const [side, setSide] = useState(() => localStorage.getItem("sidebar") !== "closed");
  const toggleSide = () => {
    localStorage.setItem("sidebar", side ? "closed" : "open");
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
  useTitle(openDoc ? nameOf(openDoc) : "");
  const colors = useMemo(() => keyColors(keys.data ?? []), [keys.data]);
  const colorOf = (keyId: string | null) => (keyId && colors.get(keyId)) || NO_KEY;
  const changed = () => {
    docs.reload();
    uploads.reload();
  };
  const error = docs.error ?? uploads.error ?? keys.error;

  return (
    <TooltipProvider delayDuration={300}>
      {error ? (
        <Problem error={error} className="p-8" />
      ) : !docs.data || !uploads.data || !keys.data ? (
        <Loading className="p-8" />
      ) : (
        <div className={cn("min-h-dvh lg:grid", side ? "lg:grid-cols-[19rem_minmax(0,1fr)]" : "lg:grid-cols-[3.5rem_minmax(0,1fr)]")}>
          <header className="sticky top-0 z-20 flex h-14 items-center border-b bg-sidebar px-4 lg:hidden">
            <a href="#/" onClick={() => setMenu(false)} className={cn(display, focusRing, "text-[1.75rem] leading-none")}>
              shelf
            </a>
            <Button variant="outline" className="ml-auto" aria-pressed={menu} onClick={() => setMenu(!menu)}>
              {menu ? <X /> : <Menu />}
              {menu ? "Back to the log" : "Docs and keys"}
            </Button>
          </header>
          <aside className={cn("bg-sidebar max-lg:min-h-[calc(100dvh-3.5rem)] lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r", !menu && "max-lg:hidden")}>
            <div className={cn("contents", !side && "lg:hidden")}>
              <Sidebar docs={docs.data} uploads={uploads.data} keys={keys.data} colorOf={colorOf} openId={openId} email={email} onNavigate={() => setMenu(false)} onKeysChanged={keys.reload} onCollapse={toggleSide} />
            </div>
            <div className={cn("hidden justify-center pt-5", !side && "lg:flex")}>
              <Tip label="Show sidebar">
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Show sidebar" onClick={toggleSide}>
                  <PanelLeftOpen />
                </Button>
              </Tip>
            </div>
          </aside>
          <main className={cn("min-w-0", menu && "max-lg:hidden")}>
            {openId ? <DocView key={openId} id={openId} colorOf={colorOf} onChanged={changed} /> : <FeedView docs={docs.data} uploads={uploads.data} colorOf={colorOf} onChanged={changed} />}
          </main>
        </div>
      )}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
