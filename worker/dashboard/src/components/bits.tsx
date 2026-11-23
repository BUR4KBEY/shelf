import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fullDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Loads `path`; `reload` refetches and keeps the old data on screen meanwhile. */
export function useLoad<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: Error }>({});
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; // a slow response for a view the user already left is dropped
    api<T>(path).then(
      (data) => live && setState({ data }),
      (error) => live && setState({ error }),
    );
    return () => void (live = false);
  }, [path, n]);
  return { ...state, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function useTitle(title: string) {
  useEffect(() => void (document.title = title ? `${title} · shelf` : "shelf"), [title]);
}

export async function copy(text: string, what = "Link") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it by hand.");
  }
}

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Time({ t, children }: { t: number; children: ReactNode }) {
  return (
    <time dateTime={new Date(t).toISOString()} title={fullDate(t)}>
      {children}
    </time>
  );
}

/** Icon buttons are 32px, and 36px on phones where they are tapped. */
export const iconButton = "text-muted-foreground hover:text-foreground max-sm:size-9";

export function LinkButtons({ url, what, className }: { url: string; what: string; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <Tip label="Copy link">
        <Button variant="ghost" size="icon" className={iconButton} aria-label={`Copy link to ${what}`} onClick={() => copy(url)}>
          <Copy />
        </Button>
      </Tip>
      <Tip label="Open in a new tab">
        <Button variant="ghost" size="icon" className={iconButton} asChild>
          <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${what} in a new tab`}>
            <ExternalLink />
          </a>
        </Button>
      </Tip>
    </div>
  );
}

export function Confirm(props: { open: boolean; onOpenChange: (open: boolean) => void; title: string; body: string; action: string; onConfirm: () => void }) {
  // Callers clear their subject on close; keep the last open text so it doesn't blank during the fade-out.
  const shown = useRef(props);
  if (props.open) shown.current = props;
  const { title, body, action } = shown.current;
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Section({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export const card = "rounded-xl border bg-card/60";

export function Empty({ title, children, alert }: { title: string; children: ReactNode; alert?: boolean }) {
  return (
    <div role={alert ? "alert" : undefined} className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
      <p className="mb-1 text-base font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}

export function Problem({ error }: { error: Error }) {
  return (
    <Empty title="Something went wrong" alert>
      <p>{error.message}</p>
      <p className="mt-3">
        <a href="#/" className="text-foreground underline underline-offset-4">
          Back to docs
        </a>
      </p>
    </Empty>
  );
}

export const Loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
