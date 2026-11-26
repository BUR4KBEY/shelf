import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Confirm } from "@/components/bits";
import { Button } from "@/components/ui/button";

const CLOSED = "preview-banner-closed";

/** On top until closed: this is a preview, its data stays and runs in this browser (so it can be slow), and only the dashboard uploads. */
export function Banner() {
  const [confirm, setConfirm] = useState(false);
  // Per tab session, so the warning and Reset come back on the next visit.
  const [closed, setClosed] = useState(() => sessionStorage.getItem(CLOSED) === "1");
  const ref = useRef<HTMLDivElement>(null);
  // The text wraps, so the banner's height varies; --banner tells the sticky header and sidebar where to start.
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    const el = ref.current;
    if (!el) return void root.setProperty("--banner", "0px");
    const ro = new ResizeObserver(() => root.setProperty("--banner", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [closed]);
  const reset = async () => {
    await fetch("/__preview/reset", { method: "POST" });
    location.reload();
  };
  const close = () => {
    sessionStorage.setItem(CLOSED, "1");
    setClosed(true);
  };
  if (closed) return null;
  return (
    <div ref={ref} role="region" aria-label="Preview" className="sticky top-0 z-30 flex items-center gap-3 border-b bg-primary py-2 pr-2 pl-4 text-sm text-primary-foreground">
      <p className="min-w-0">
        <strong className="font-semibold">Preview.</strong>{" "}
        <span className="max-sm:hidden">
          Everything here runs and is stored in this browser, so it may be slow: performance in the preview doesn't represent the final product. Upload by dropping files on the page; the API, CLI and MCP server are off.
        </span>
        <span className="sm:hidden">Runs in your browser, can be slow.</span>
      </p>
      <Button size="sm" variant="secondary" className="ml-auto shrink-0" onClick={() => setConfirm(true)}>
        Reset
      </Button>
      <Button size="icon-sm" variant="ghost" className="shrink-0 hover:bg-primary-foreground/15 hover:text-primary-foreground" aria-label="Close the preview banner" onClick={close}>
        <X />
      </Button>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset the preview?"
        body="Your uploads and changes are deleted, and the sample data comes back."
        action="Reset"
        onConfirm={reset}
      />
    </div>
  );
}
