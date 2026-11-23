import { useState, type FormEvent } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Confirm, Empty, Loading, Problem, Section, Time, card, copy, useLoad, useTitle } from "@/components/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorText, type Key, type NewKey } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

export function KeysView() {
  const { data: keys, error, reload } = useLoad<Key[]>("/keys");
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<NewKey | null>(null);
  const [doomed, setDoomed] = useState<Key | null>(null);
  useTitle("Keys");
  if (error) return <Problem error={error} />;
  if (!keys) return <Loading />;

  const mint = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return document.getElementById("f-key")?.focus();
    try {
      setFresh(await api<NewKey>("/keys", { method: "POST", json: { name: name.trim() } }));
      setName("");
      reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  const revoke = (k: Key) =>
    api(`/keys/${k.id}/revoke`, { method: "POST" }).then(
      () => (toast.success(`Revoked ${k.name}`), reload()),
      (e) => toast.error(errorText(e)),
    );

  return (
    <>
      <section className="grid gap-2.5">
        <h1 className="text-sm font-medium">New API key</h1>
        <form onSubmit={mint} className={cn(card, "flex flex-wrap items-end gap-3 p-4")}>
          <div className="grid flex-[1_1_14rem] gap-2">
            <Label htmlFor="f-key">Name</Label>
            <Input id="f-key" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="e.g. laptop" autoComplete="off" required className="max-sm:h-9" />
          </div>
          <Button type="submit" className="max-sm:h-9 max-sm:w-full">
            Create key
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">Keys let the CLI and scripts upload to this shelf.</p>
      </section>

      <Section title="Keys" hint={keys.length ? String(keys.length) : undefined}>
        {keys.length ? (
          <ul aria-label="API keys" className={cn(card, "divide-y")}>
            {keys.map((k) => (
              <li key={k.id} className="flex items-center gap-3 py-2.5 pr-3 pl-4">
                <div className={cn("grid min-w-0 flex-1 gap-0.5", k.revokedAt && "opacity-50")}>
                  <span className={cn("truncate text-sm font-medium", k.revokedAt && "line-through decoration-muted-foreground/60")}>{k.name}</span>
                  <div className="flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground">
                    {!k.revokedAt && (
                      <span className="flex items-center gap-1.5 sm:hidden">
                        <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                        active
                      </span>
                    )}
                    <span>
                      created <Time t={k.createdAt}>{ago(k.createdAt)}</Time>
                    </span>
                    <span>
                      {k.lastUsedAt ? (
                        <>
                          last used <Time t={k.lastUsedAt}>{ago(k.lastUsedAt)}</Time>
                        </>
                      ) : (
                        "never used"
                      )}
                    </span>
                  </div>
                </div>
                {k.revokedAt ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    Revoked <Time t={k.revokedAt}>{ago(k.revokedAt)}</Time>
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className="max-sm:hidden">
                      <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                      Active
                    </Badge>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive max-sm:h-9 max-sm:px-3" aria-label={`Revoke ${k.name}`} onClick={() => setDoomed(k)}>
                      Revoke
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No keys yet">Create one to upload from the CLI.</Empty>
        )}
      </Section>

      {/* Closes only through its buttons: the key can't be recovered after a stray click outside. */}
      <Dialog open={!!fresh} onOpenChange={(open) => !open && setFresh(null)}>
        <DialogContent showCloseButton={false} onInteractOutside={(e) => e.preventDefault()} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="leading-snug [overflow-wrap:anywhere]">Key for {fresh?.name}</DialogTitle>
            <DialogDescription>Copy it now. It won't be shown again.</DialogDescription>
          </DialogHeader>
          <code id="new-key" className="block rounded-lg border bg-background px-3 py-2.5 font-mono text-[13px] leading-relaxed select-all [overflow-wrap:anywhere]">
            {fresh?.key}
          </code>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFresh(null)}>
              Done
            </Button>
            <Button autoFocus onClick={() => fresh && copy(fresh.key, "Key")}>
              <Copy /> Copy key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirm open={!!doomed} onOpenChange={(open) => !open && setDoomed(null)} title={`Revoke ${doomed?.name ?? ""}?`} body="Anything using this key stops working right away. This can't be undone." action="Revoke" onConfirm={() => doomed && revoke(doomed)} />
    </>
  );
}
