import { useState, type CSSProperties, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Time, copy, dashed, focusRing } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorText, type Activity, type Key, type NewKey } from "@/lib/api";
import { perDay } from "@/lib/feed";
import { ago, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const row = "grid w-full grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 text-left";

const agentInstructions = (key: string) =>
  `Publish files with shelf at ${location.origin}. Read ${location.origin}/llms.txt for how, and use this API key: ${key}\n` +
  `Or connect its MCP server: ${location.origin}/mcp (Streamable HTTP) with the header "Authorization: Bearer ${key}".`;

/** The keys in the sidebar: each in its colour, with its last two weeks of uploads. A key opens its own page, where it can be revoked. Revoked keys are hidden until asked for. */
export function KeyList({ keys, uploads, colorOf, openKey, onChanged, onNavigate }: { keys: Key[]; uploads: Activity[]; colorOf: (keyId: string | null) => string; openKey?: string; onChanged: () => void; onNavigate: () => void }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const revoked = keys.filter((k) => k.revokedAt).length;

  const mint = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return document.getElementById("f-key")?.focus();
    try {
      setFresh(await api<NewKey>("/keys", { method: "POST", json: { name: name.trim() } }));
      setNaming(false);
      setName("");
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <>
      <ul className="grid grid-cols-1 gap-2" onClick={onNavigate}>
        {/* Revoked keys are archived: out of the list unless asked for; the one that is open is always in it. */}
        {keys.filter((k) => showRevoked || !k.revokedAt || k.id === openKey).map((k) => {
          const counts = perDay(uploads, k.id);
          const most = Math.max(1, ...counts);
          return (
            <li key={k.id} style={{ "--k": colorOf(k.id) } as CSSProperties}>
              <a href={`#/key/${k.id}`} aria-current={k.id === openKey ? "page" : undefined} className={cn(row, focusRing, "-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1 hover:bg-card/60 aria-[current=page]:bg-card", k.revokedAt && "text-muted-foreground")}>
                <i className={cn("size-2.5 rounded-full", k.revokedAt ? "bg-input" : "bg-(--k)")} aria-hidden />
                <span className={cn("truncate text-sm font-semibold", k.revokedAt && "line-through")}>{k.name}</span>
                {k.revokedAt ? (
                  <span className="text-xs">
                    revoked <Time t={k.revokedAt}>{ago(k.revokedAt)}</Time>
                  </span>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">{k.lastUsedAt ? ago(k.lastUsedAt) : "never used"}</span>
                    <span className="col-span-2 col-start-2 flex h-[18px] items-end gap-[3px]" aria-hidden>
                      {counts.map((n, i) => (
                        <span key={i} className={cn("flex-1 rounded-[1px] bg-(--k)", !n && "opacity-20")} style={{ height: `${Math.max(8, (n / most) * 100)}%` }} />
                      ))}
                    </span>
                    <span className="sr-only">{plural(counts.reduce((a, b) => a + b, 0), "upload")} in the last 14 days</span>
                  </>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      {revoked > 0 && (
        <button type="button" aria-pressed={showRevoked} onClick={() => setShowRevoked(!showRevoked)} className={cn(focusRing, "-mx-2 mt-1 w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left text-sm text-muted-foreground hover:bg-card/60 hover:text-foreground")}>
          {showRevoked ? "Hide revoked" : `Show ${revoked} revoked`}
        </button>
      )}
      <button type="button" onClick={() => setNaming(true)} className={cn(dashed, focusRing, "mt-3 w-full rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground hover:border-foreground hover:text-foreground")}>
        + New key for a machine or agent
      </button>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={mint} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New key</DialogTitle>
              <DialogDescription>Name it after the machine or agent that will use it. Its uploads show up in the log under that name, and you can revoke it alone.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="f-key">Name</Label>
              <Input id="f-key" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. laptop" autoComplete="off" required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNaming(false)}>
                Cancel
              </Button>
              <Button type="submit">Create key</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Closes only through its buttons: the key can't be recovered after a stray click outside. */}
      <Dialog open={!!fresh} onOpenChange={(open) => !open && setFresh(null)}>
        <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="[overflow-wrap:anywhere]">Key for {fresh?.name}</DialogTitle>
            <DialogDescription>Copy it now. It won't be shown again. Agent instructions hold the key too, so an agent can publish without the CLI.</DialogDescription>
          </DialogHeader>
          <code id="new-key" className="block rounded-lg border bg-background px-3 py-2.5 font-mono text-[13px] leading-relaxed select-all [overflow-wrap:anywhere]">
            {fresh?.key}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFresh(null)}>
              Done
            </Button>
            <Button variant="outline" onClick={() => fresh && copy(agentInstructions(fresh.key), "Agent instructions")}>
              <Copy /> Copy agent instructions
            </Button>
            <Button autoFocus onClick={() => fresh && copy(fresh.key, "Key")}>
              <Copy /> Copy key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
