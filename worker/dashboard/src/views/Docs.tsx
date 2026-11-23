import { useState } from "react";
import { Copy, ExternalLink, Lock, MoreHorizontal, Search, Settings2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Confirm, Empty, LinkButtons, Loading, Problem, Time, Tip, card, copy, iconButton, useLoad, useTitle } from "@/components/bits";
import { DropZone } from "@/components/DropZone";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, errorText, nameOf, type Doc } from "@/lib/api";
import { ago, expiry, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;

export function deleteText(versions: number) {
  return `This removes the doc and ${versions === 1 ? "its version" : `all ${versions} versions`}. Its links stop working. This can't be undone.`;
}

export function DocsView() {
  const { data: docs, error, reload } = useLoad<Doc[]>("/docs");
  const [query, setQuery] = useState("");
  const [doomed, setDoomed] = useState<Doc | null>(null);
  useTitle("");
  if (error) return <Problem error={error} />;
  if (!docs) return <Loading />;

  const q = query.trim().toLowerCase();
  const shown = docs.filter((d) => [d.title, d.slug, d.id].some((s) => s?.toLowerCase().includes(q)));
  const patch = (d: Doc, body: object) => api(`/docs/${d.id}`, { method: "PATCH", json: body }).then(reload, (e) => toast.error(errorText(e)));
  const remove = (d: Doc) =>
    api(`/docs/${d.id}`, { method: "DELETE" }).then(
      () => (toast.success(`Deleted ${nameOf(d)}`), reload()),
      (e) => toast.error(errorText(e)),
    );

  return (
    <>
      <DropZone
        target={{}}
        overlay="Drop a file or folder to share it"
        onDone={reload}
        text={
          <>
            <span className="font-medium text-foreground">Drop a file or folder</span> anywhere to share it
          </>
        }
      />
      <section className="grid min-w-0 grid-cols-1 gap-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium">
            Docs {docs.length > 0 && <span className="ml-1 font-normal text-muted-foreground tabular-nums">{docs.length}</span>}
          </h1>
          {docs.length > 0 && (
            <div className="relative ml-auto w-full max-w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, slug or id" aria-label="Search docs" autoComplete="off" className="pl-8 max-sm:h-9" />
            </div>
          )}
        </div>
        {shown.length > 0 ? (
          <ul aria-label="Docs" className={cn(card, "divide-y overflow-hidden")}>
            {shown.map((d) => (
              <Row key={d.id} d={d} onFavorite={() => patch(d, { favorite: !d.favorite })} onDelete={() => setDoomed(d)} />
            ))}
          </ul>
        ) : docs.length ? (
          <Empty title="No matches">Nothing has “{query.trim()}” in its title, slug or id.</Empty>
        ) : (
          <Empty title="Nothing on the shelf yet">Drop a file or folder anywhere on this page, or choose one above.</Empty>
        )}
      </section>
      <Confirm
        open={!!doomed}
        onOpenChange={(open) => !open && setDoomed(null)}
        title={`Delete ${doomed ? nameOf(doomed) : ""}?`}
        body={deleteText(doomed?.latest ?? 1)}
        action="Delete"
        onConfirm={() => doomed && remove(doomed)}
      />
    </>
  );
}

function Row({ d, onFavorite, onDelete }: { d: Doc; onFavorite: () => void; onDelete: () => void }) {
  const expired = d.expiresAt !== null && d.expiresAt <= Date.now();
  const name = nameOf(d);
  return (
    <li className="relative flex items-center gap-1 py-2 pr-2 pl-1.5 transition-colors hover:bg-muted/40">
      <Tip label={d.favorite ? "Remove from favorites" : "Add to favorites"}>
        <Button variant="ghost" size="icon" aria-pressed={d.favorite} aria-label={`Favorite ${name}`} onClick={onFavorite} className={cn("relative z-10 max-sm:size-9", d.favorite ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground/50 hover:text-foreground")}>
          <Star className={cn(d.favorite && "fill-current")} />
        </Button>
      </Tip>
      <div className={cn("grid min-w-0 flex-1 gap-0.5 pl-1", expired && "opacity-55")}>
        <div className="flex min-w-0 items-center gap-1.5">
          {/* The link's ::after covers the row, so the whole row opens the doc. */}
          <a href={`#/doc/${d.id}`} className="truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset">
            {name}
          </a>
          {d.locked && (
            <>
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">locked</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{d.slug ?? d.id}</span>
          <span>{plural(d.latest, "version")}</span>
          <span>
            updated <Time t={d.updatedAt}>{ago(d.updatedAt)}</Time>
          </span>
          {d.expiresAt !== null && (
            <span className={cn(expired ? "text-destructive" : d.expiresAt - Date.now() < DAY && "text-amber-400")}>
              <Time t={d.expiresAt}>{expiry(d.expiresAt)}</Time>
            </span>
          )}
        </div>
      </div>
      <LinkButtons url={d.url} what={name} className="relative z-10 max-sm:hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={cn(iconButton, "relative z-10")} aria-label={`More actions for ${name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => copy(d.url)}>
            <Copy /> Copy link
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={d.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open in a new tab
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`#/doc/${d.id}`}>
              <Settings2 /> Settings
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
