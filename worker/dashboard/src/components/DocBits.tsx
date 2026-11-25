import { createContext, useContext } from "react";
import { Boxes, Clock, Folder, Lock, Star as StarIcon } from "lucide-react";
import { toast } from "sonner";
import { Tip, chip, focusRing } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { api, errorText, nameOf, type Doc, type Space } from "@/lib/api";
import { fullDate, timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
export const isExpired = (d: Doc) => d.expiresAt !== null && d.expiresAt <= Date.now();

/** Every space, loaded once by the app; undefined until it arrives. */
export const SpacesContext = createContext<Space[] | undefined>(undefined);

/** The doc's space, once there is more than one to tell apart. Nothing while everything is in one space. */
export function SpaceChip({ d }: { d: Doc }) {
  const spaces = useContext(SpacesContext) ?? [];
  if (spaces.length < 2) return null;
  return (
    <span className={chip} title="Space">
      <Boxes aria-hidden />
      {spaces.find((s) => s.id === d.space)?.name ?? d.space}
    </span>
  );
}

/** The doc's project. Nothing when it has none. */
export function ProjectChip({ d }: { d: Doc }) {
  return d.project ? (
    <span className={chip} title="Project">
      <Folder aria-hidden />
      {d.project}
    </span>
  ) : null;
}

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

/** A doc's name as it appears on an upload: a link to the doc, and its star. */
export function DocName({ d, onChanged }: { d: Doc; onChanged: () => void }) {
  return (
    <h3 className="flex min-w-0 items-center gap-1.5 text-xl leading-tight font-bold">
      <a href={`#/doc/${d.id}`} className={cn(focusRing, "min-w-0 underline-offset-4 [overflow-wrap:anywhere] hover:underline", isExpired(d) && "text-muted-foreground line-through")}>
        {nameOf(d)}
      </a>
      <Star d={d} onChanged={onChanged} />
    </h3>
  );
}

/** "Password" on a doc that has one. Nothing on an open doc. */
export function Locked({ d }: { d: Doc }) {
  return d.locked ? (
    <span className={chip}>
      <Lock aria-hidden />
      Password
    </span>
  ) : null;
}

/** "Expires in 7d": amber in its last day, red once expired. Nothing when the doc never expires. */
export function Expiry({ d }: { d: Doc }) {
  if (d.expiresAt === null) return null;
  const left = timeLeft(d.expiresAt);
  return (
    <span title={fullDate(d.expiresAt)} className={cn(chip, !left ? "bg-destructive/10 text-destructive" : d.expiresAt - Date.now() < DAY && "bg-warning/15 text-warning")}>
      <Clock aria-hidden />
      {left ? `Expires in ${left}` : "Expired"}
    </span>
  );
}
