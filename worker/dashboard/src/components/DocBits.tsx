import { Lock, Star as StarIcon } from "lucide-react";
import { toast } from "sonner";
import { Tip, focusRing } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { api, errorText, nameOf, type Doc } from "@/lib/api";
import { fullDate, timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
export const isExpired = (d: Doc) => d.expiresAt !== null && d.expiresAt <= Date.now();

/** The star next to a doc's name. Favorites lead the list in the sidebar. */
export function Star({ d, onChanged }: { d: Doc; onChanged: () => void }) {
  const toggle = () => api(`/docs/${d.id}`, { method: "PATCH", json: { favorite: !d.favorite } }).then(onChanged, (e) => toast.error(errorText(e)));
  return (
    <Tip label={d.favorite ? "Remove from favorites" : "Add to favorites"}>
      <Button variant="ghost" size="icon-sm" aria-pressed={d.favorite} aria-label={`Favorite ${nameOf(d)}`} onClick={toggle} className={cn("max-sm:size-9", d.favorite ? "text-warning hover:text-warning" : "text-muted-foreground/60 hover:text-foreground")}>
        <StarIcon className={cn(d.favorite && "fill-current")} />
      </Button>
    </Tip>
  );
}

/** A doc's name as it appears on an upload: a link to the doc, a lock if it has a password, and its star. */
export function DocName({ d, onChanged }: { d: Doc; onChanged: () => void }) {
  return (
    <h3 className="flex min-w-0 items-center gap-1.5 text-xl leading-tight font-bold">
      <a href={`#/doc/${d.id}`} className={cn(focusRing, "min-w-0 underline-offset-4 [overflow-wrap:anywhere] hover:underline", isExpired(d) && "text-muted-foreground line-through")}>
        {nameOf(d)}
      </a>
      {d.locked && (
        <>
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">password protected</span>
        </>
      )}
      <Star d={d} onChanged={onChanged} />
    </h3>
  );
}

/** "Expires in 7d": amber in its last day, red once expired. Nothing when the doc never expires. */
export function Expiry({ d }: { d: Doc }) {
  if (d.expiresAt === null) return null;
  const left = timeLeft(d.expiresAt);
  return (
    <span title={fullDate(d.expiresAt)} className={cn(!left ? "font-semibold text-destructive" : d.expiresAt - Date.now() < DAY && "font-semibold text-warning")}>
      {left ? `Expires in ${left}` : "Expired"}
    </span>
  );
}
