import { useEffect, useState } from "react";
import { LibraryBig } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DocView } from "@/views/Doc";
import { DocsView } from "@/views/Docs";
import { KeysView } from "@/views/Keys";

function useHashPath() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "");
}

export function App() {
  const path = useHashPath();
  const doc = path.match(/^doc\/([^/]+)$/);
  const [email, setEmail] = useState("");
  useEffect(() => void api<{ email: string }>("/me").then((me) => setEmail(me.email), () => {}), []);
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

  const nav = (href: string, label: string, on: boolean) => (
    <a
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        on && "bg-muted text-foreground",
      )}
    >
      {label}
    </a>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-4 px-4 sm:px-6">
          <a href="#/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <LibraryBig className="size-4.5" aria-hidden />
            shelf
          </a>
          <nav aria-label="Sections" className="flex gap-1">
            {nav("#/", "Docs", path !== "keys")}
            {nav("#/keys", "Keys", path === "keys")}
          </nav>
          <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground" title={email}>
            {email}
          </span>
        </div>
      </header>
      <main className="mx-auto grid max-w-3xl grid-cols-1 gap-6 px-4 pt-6 pb-24 sm:px-6 sm:pt-8">
        {doc ? <DocView key={doc[1]} id={decodeURIComponent(doc[1])} /> : path === "keys" ? <KeysView /> : <DocsView />}
      </main>
      <Toaster position="bottom-center" />
    </TooltipProvider>
  );
}
