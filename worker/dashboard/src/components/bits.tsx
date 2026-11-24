import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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

export const focusRing = "rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
/** The quiet heading over a group: "On the shelf", "Keys", "Settings". */
export const groupName = "text-[0.8125rem] leading-none font-semibold text-muted-foreground";
/** The narrow, heavy cut for the wordmark and the names of days and docs. */
export const display = "font-bold tracking-tight font-stretch-[78%]";
/** A dashed box: somewhere a file can be dropped, or something that isn't there yet. */
export const dashed = "rounded-xl border-[1.5px] border-dashed border-input";
/** A small labelled pill for a doc's state: locked, expiring, current. Add a colour for anything that needs attention. */
export const chip = "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0";

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

export function Problem({ error, className }: { error: Error; className?: string }) {
  return (
    <div role="alert" className={cn("grid gap-1.5 text-sm", className)}>
      <p className={cn(display, "text-3xl leading-none")}>Something went wrong</p>
      <p className="text-muted-foreground">{error.message}</p>
      <p>
        <a href="#/" className={cn(focusRing, "font-semibold underline underline-offset-4")}>
          Back to all uploads
        </a>
      </p>
    </div>
  );
}

export const Loading = ({ className }: { className?: string }) => <p className={cn("text-sm text-muted-foreground", className)}>Loading…</p>;
