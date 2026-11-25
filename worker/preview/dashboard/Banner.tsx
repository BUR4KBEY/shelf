import { useState } from "react";
import { Confirm } from "@/components/bits";
import { Button } from "@/components/ui/button";

/** Always on top: this is a preview, its data stays in this browser, and only the dashboard uploads. */
export function Banner() {
  const [confirm, setConfirm] = useState(false);
  const reset = async () => {
    await fetch("/__preview/reset", { method: "POST" });
    location.reload();
  };
  return (
    <div role="region" aria-label="Preview" className="sticky top-0 z-30 flex h-(--banner) items-center gap-3 border-b bg-primary px-4 text-sm text-primary-foreground">
      <p className="min-w-0 truncate">
        <strong className="font-semibold">Preview.</strong>{" "}
        <span className="max-sm:hidden">Everything here stays in this browser. Upload by dropping files on the page; the API, CLI and MCP server are off.</span>
        <span className="sm:hidden">Your data stays in this browser.</span>
      </p>
      <Button size="sm" variant="secondary" className="ml-auto shrink-0" onClick={() => setConfirm(true)}>
        Reset
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
