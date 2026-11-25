import { useContext, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Loading, Logo, Problem, code, display, focusRing, useLoad } from "@/components/bits";
import { SpacesContext } from "@/components/DocBits";
import { DurationInput, Field, Hint, SpaceSelect } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText, type AppSettings, type Space } from "@/lib/api";
import { checkBackup, readBackup, restore, type Backup as BackupFile, type BackupDoc } from "@/lib/backup";
import { plural } from "@/lib/format";
import { PALETTES, setPref, usePref } from "@/lib/prefs";
import { PROGRESS } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { THEMES } from "@/views/Sidebar";

const option = (on: boolean) => cn(focusRing, "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:text-foreground", on && "border-ring bg-background font-semibold text-foreground");

/** Light or dark, and the colour. Applies at once, to this browser only: it is kept in cookies, like the sidebar's switch. */
function Appearance() {
  const theme = usePref("theme");
  const palette = usePref("palette");
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4">
      <div role="group" aria-labelledby="f-theme" className="grid gap-1.5">
        <p id="f-theme" className="text-xs font-semibold text-muted-foreground">
          Theme
        </p>
        <div className="flex flex-wrap gap-2">
          {THEMES.map(([value, label, Icon]) => (
            <button key={value} type="button" aria-pressed={theme === value} onClick={() => setPref("theme", value)} className={option(theme === value)}>
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-labelledby="f-palette" aria-describedby="f-palette-hint" className="grid gap-1.5">
        <p id="f-palette" className="text-xs font-semibold text-muted-foreground">
          Colour
        </p>
        <div className="flex flex-wrap gap-2">
          {PALETTES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={palette === value} onClick={() => setPref("palette", value)} className={option(palette === value)}>
              {/* The logo in that palette, whatever the page's is. */}
              <span data-palette={value} className="text-foreground">
                <Logo className="h-4" />
              </span>
              {label}
            </button>
          ))}
        </div>
        <Hint id="f-palette-hint">The logo and the favicon change with it. Each browser keeps its own choice, and the password form and rendered Markdown follow it in this browser.</Hint>
      </div>
    </div>
  );
}

/** "36h" → ["36", "h"]; null (never) → ["", "d"]. */
const split = (v: string | null) => (v ? [v.slice(0, -1), v.slice(-1)] : ["", "d"]);

function ExpiryForm({ saved, onSaved }: { saved: AppSettings; onSaved: (s: AppSettings) => void }) {
  const [[defAmount, defUnit], setDef] = useState(split(saved.defaultExpires));
  const [[maxAmount, maxUnit], setMax] = useState(split(saved.maxExpires));
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // An empty or zero default means never.
      const defaultExpires = Number(defAmount) ? `${defAmount}${defUnit}` : null;
      onSaved(await api<AppSettings>("/settings", { method: "PATCH", json: { defaultExpires, maxExpires: `${maxAmount}${maxUnit}` } }));
      toast.success("Settings saved");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
      <Field label="New uploads expire after" htmlFor="f-default-expires">
        <DurationInput id="f-default-expires" amount={defAmount} unit={defUnit} onAmount={(a) => setDef([a, defUnit])} onUnit={(u) => setDef([defAmount, u])} placeholder="Never" describedBy="f-default-expires-hint" />
        <Hint id="f-default-expires-hint">
          Empty or 0 means never. For a new doc uploaded without an expiry, from here, the CLI or the API. An upload that sets its own expiry, or never, keeps it. Docs already on the shelf and new versions of them don't change.
        </Hint>
      </Field>
      <Field label="Longest expiry allowed" htmlFor="f-max-expires">
        <DurationInput id="f-max-expires" amount={maxAmount} unit={maxUnit} onAmount={(a) => setMax([a, maxUnit])} onUnit={(u) => setMax([maxAmount, u])} describedBy="f-max-expires-hint" />
        <Hint id="f-max-expires-hint">
          No upload or change can set a doc to expire later than this from now. Never is always allowed. Docs that already expire later keep their date.
        </Hint>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function SlugForm({ saved, onSaved }: { saved: AppSettings; onSaved: (s: AppSettings) => void }) {
  const [max, setMax] = useState(String(saved.maxSlugLength));
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      onSaved(await api<AppSettings>("/settings", { method: "PATCH", json: { maxSlugLength: Number(max) } }));
      toast.success("Settings saved");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
      <Field label="Longest slug allowed" htmlFor="f-max-slug">
        <Input id="f-max-slug" type="number" inputMode="numeric" min={3} max={128} step={1} value={max} onChange={(e) => setMax(e.target.value)} required aria-describedby="f-max-slug-hint" />
        <Hint id="f-max-slug-hint">From 3 to 128 characters. No upload or change can set a longer slug. Docs that already have a longer one keep it.</Hint>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

/**
 * A switch that flips at once and saves in the background, putting itself back if the save fails.
 * Its hint says what the current position means, so it changes with the switch. `subject` names it in the toast.
 */
function Toggle({ label, subject, checked, onSave, on, off }: { label: string; subject: string; checked: boolean; onSave: (v: boolean) => Promise<unknown>; on: ReactNode; off: ReactNode }) {
  const id = useId();
  const [value, setValue] = useState(checked);
  const flip = async (v: boolean) => {
    setValue(v);
    try {
      await onSave(v);
      toast.success(`${subject}: ${v ? "on" : "off"}`);
    } catch (err) {
      setValue(!v);
      toast.error(errorText(err));
    }
  };
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1">
      <Switch id={id} checked={value} onCheckedChange={flip} aria-describedby={`${id}hint`} className="mt-0.5" />
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      <p id={`${id}hint`} className="col-start-2 text-xs leading-relaxed text-muted-foreground">
        {value ? on : off}
      </p>
    </div>
  );
}

/** Deletes a space after asking where its keys go, and whether its docs go with them or are deleted. */
function DeleteSpace({ space, onDeleted }: { space: Space; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("default");
  const [docs, setDocs] = useState<"move" | "delete">("move");
  const id = useId();
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/spaces/${space.id}?to=${encodeURIComponent(to)}&docs=${docs}`, { method: "DELETE" });
      toast.success(`Deleted ${space.name}`);
      setOpen(false);
      onDeleted();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <>
      <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15" onClick={() => setOpen(true)}>
        Delete space…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={remove} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="[overflow-wrap:anywhere]">Delete {space.name}?</DialogTitle>
              <DialogDescription>
                Its keys move to the space you pick and keep working.{space.docs > 0 && ` Choose what happens to its ${plural(space.docs, "doc")}.`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${id}to`}>Move its keys to</Label>
              <SpaceSelect id={`${id}to`} value={to} onChange={setTo} exclude={space.id} />
            </div>
            {space.docs > 0 && (
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Its {plural(space.docs, "doc")}</legend>
                <Label className="font-normal">
                  <input type="radio" name={`${id}docs`} checked={docs === "move"} onChange={() => setDocs("move")} className="size-4 accent-primary" />
                  Move them there too
                </Label>
                <Label className="font-normal">
                  <input type="radio" name={`${id}docs`} checked={docs === "delete"} onChange={() => setDocs("delete")} className="size-4 accent-destructive" />
                  Delete them and every version. Their links stop working.
                </Label>
              </fieldset>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive">
                {docs === "delete" ? `Delete space and ${plural(space.docs, "doc")}` : "Delete space"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One space: its name, what's in it, and what its keys may do. Switches save at once; the name saves with its button. */
function SpaceRow({ space, isolated, onChanged }: { space: Space; isolated: boolean; onChanged: () => void }) {
  const [name, setName] = useState(space.name);
  const patch = (json: Partial<Space>) => api(`/spaces/${space.id}`, { method: "PATCH", json });
  const rename = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await patch({ name: name.trim() });
      toast.success("Space renamed");
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <li className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4">
      <form onSubmit={rename} className="flex flex-wrap items-center gap-2">
        <Input aria-label="Space name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required className="max-w-60 font-semibold" />
        {name.trim() !== space.name && (
          <Button type="submit" variant="outline">
            Rename
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {plural(space.docs, "doc")} · {plural(space.keys, "key")}
        </span>
      </form>
      <div className="grid gap-3">
        <p className="text-xs font-semibold text-muted-foreground">What its keys may do</p>
        <Toggle
          label="Delete docs"
          subject={`${space.name}: delete docs`}
          checked={space.keysDelete}
          onSave={(keysDelete) => patch({ keysDelete })}
          on={isolated ? "They can delete docs in this space." : "They can delete any doc, in every space, while spaces aren't kept apart."}
          off="They can publish and edit, but not delete. Only you can, from the dashboard."
        />
        <Toggle
          label="Read locked docs without the password"
          subject={`${space.name}: read locked docs`}
          checked={space.keysReadLocked}
          onSave={(keysReadLocked) => patch({ keysReadLocked })}
          on={
            <>
              They can read this space's password-protected docs with the MCP tool <code className={code}>read_doc</code>, without being given the password.
              {!isolated && " Locked docs in other spaces still need their password."}
            </>
          }
          off="They need the password to read a locked doc, like anyone with the link."
        />
      </div>
      {space.id !== "default" && (
        <div className="-mb-1 flex justify-end">
          <DeleteSpace space={space} onDeleted={onChanged} />
        </div>
      )}
    </li>
  );
}

/** What spaces are, isolation for the whole app, every space with its permissions, and a form to add one. */
function Spaces({ settings, onSaved, onChanged }: { settings: AppSettings; onSaved: (s: AppSettings) => void; onChanged: () => void }) {
  const spaces = useContext(SpacesContext);
  const [name, setName] = useState("");
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/spaces", { method: "POST", json: { name: name.trim() } });
      toast.success(`Added ${name.trim()}`);
      setName("");
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3">
      <Hint>
        Every key belongs to one space, and what it uploads goes there. Pick a key's space when you make it, or later on its page; move a doc from its settings. A key never reads another space's locked docs without the password. Here, in the dashboard, you see every space.
      </Hint>
      <div className="rounded-xl border bg-card p-4">
        <Toggle
          label="Keep spaces apart"
          subject="Keep spaces apart"
          checked={settings.isolateSpaces}
          onSave={async (isolateSpaces) => onSaved(await api<AppSettings>("/settings", { method: "PATCH", json: { isolateSpaces } }))}
          on="A key sees only its own space's docs. Docs in other spaces don't exist for it."
          off="Every key can see and edit docs in every space, as if there were one shelf."
        />
      </div>
      {!spaces ? (
        <Loading />
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {spaces.map((s) => (
            <SpaceRow key={`${s.id}:${s.name}`} space={s} isolated={settings.isolateSpaces} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex gap-2">
        <Input aria-label="New space name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="New space, e.g. Work" autoComplete="off" required className="max-w-60" />
        <Button type="submit" variant="outline">
          Add space
        </Button>
      </form>
    </div>
  );
}

/** Whether readers' opens are counted, and whether chat apps may build a card for a shared link. */
function Readers({ settings, onSaved }: { settings: AppSettings; onSaved: (s: AppSettings) => void }) {
  const save = async (json: Partial<AppSettings>) => onSaved(await api<AppSettings>("/settings", { method: "PATCH", json }));
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4">
      <Toggle
        label="View statistics"
        subject="View statistics"
        checked={settings.viewStats}
        onSave={(viewStats) => save({ viewStats })}
        on="Each doc's page shows how often it was opened and by how many readers. Bots, link previews and your own opens from the dashboard don't count, and readers' IP addresses aren't stored."
        off="Opens aren't counted. Counts from before stay on each doc's page."
      />
      <Toggle
        label="Link previews"
        subject="Link previews"
        checked={settings.linkPreviews}
        onSave={(linkPreviews) => save({ linkPreviews })}
        on="Slack, Discord, WhatsApp, iMessage and other chat apps may open a shared link to show a card with the doc's title. A locked doc's title never shows. Search engines still never index anything."
        off="Chat apps are turned away, so a shared link shows as plain text. Search engines never index anything either way."
      />
    </div>
  );
}

/** Downloads every doc, or one space's, as a tar with a shelf.json describing it, with or without password hashes. */
function Backup() {
  const spaces = useContext(SpacesContext);
  const id = useId();
  const [space, setSpace] = useState("all");
  const [passwords, setPasswords] = useState(false);
  const query = new URLSearchParams({ ...(space !== "all" && { space }), ...(passwords && { passwords: "1" }) }).toString();
  return (
    <div className="grid grid-cols-1 gap-3">
      <Hint>
        One <code className={code}>.tar</code> file with every doc, every version and their files, and <code className={code}>shelf.json</code> listing docs, versions, keys, spaces and these settings. Keys themselves are never in it. Open it with any archive tool, or <code className={code}>tar -xf</code>, or import it below.
      </Hint>
      <div className="grid gap-1">
        <Label className="text-sm font-semibold">
          <input type="checkbox" checked={passwords} onChange={(e) => setPasswords(e.target.checked)} aria-describedby={`${id}pw`} className="size-4 accent-primary" />
          Include password hashes
        </Label>
        <p id={`${id}pw`} className="pl-6 text-xs leading-relaxed text-muted-foreground">
          {passwords
            ? "Locked docs stay locked, with the same passwords, when you import this file. Anyone who has the file can open those docs without knowing their passwords, so keep it as private as the shelf itself."
            : "Locked docs come back locked after an import, but you set a new password for each. The file reveals nothing about the passwords."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {spaces && spaces.length > 1 && (
          <Field label="Space" htmlFor={id}>
            <Select value={space} onValueChange={setSpace}>
              <SelectTrigger id={id} className="w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="all">All spaces</SelectItem>
                {spaces.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Button variant="outline" asChild>
          <a href={`/dashboard/api/export${query && `?${query}`}`} download>
            <Download /> Download backup
          </a>
        </Button>
      </div>
    </div>
  );
}

/** "A, B and 3 more": the docs' names for a sentence, the first few and then how many more. */
const someDocs = (docs: BackupDoc[]) =>
  new Intl.ListFormat("en").format([...docs.slice(0, 6).map((d) => d.title || d.slug || d.id), ...(docs.length > 6 ? [`${docs.length - 6} more`] : [])]);

/**
 * Reads a backup, asks what to do with docs already on the shelf, then restores the rest.
 * Nothing is written until the owner confirms; a conflict-free backup imports at once.
 */
function Import({ onImported }: { onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; blobs: Map<string, Uint8Array>; missing: string[]; conflicts: string[] }>();
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const run = async (p: NonNullable<typeof pending>, asCopies: boolean) => {
    setPending(undefined);
    setBusy(true);
    try {
      const r = await restore(p.backup, p.blobs, p.missing, p.conflicts, asCopies);
      toast.dismiss(PROGRESS);
      const parts = [plural(r.imported.length + r.copied.length, "doc"), r.copied.length && `${r.copied.length} as copies with new links`, r.skipped.length && `${r.skipped.length} skipped`].filter(Boolean);
      toast.success(`Imported ${parts.join(", ")}`);
      if (r.needPassword.length) {
        toast.warning(`${plural(r.needPassword.length, "locked doc")} came without ${r.needPassword.length === 1 ? "its password" : "their passwords"}`, {
          description: "They stay locked behind a password nobody knows. Set a new one in each doc's settings.",
          duration: Infinity,
        });
      }
      onImported();
    } catch (err) {
      toast.dismiss(PROGRESS);
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { backup, blobs } = await readBackup(file);
      const { conflicts, missing } = await checkBackup(backup);
      setBusy(false);
      if (conflicts.length) setPending({ backup, blobs, missing, conflicts });
      else await run({ backup, blobs, missing, conflicts }, false);
    } catch (err) {
      setBusy(false);
      toast.error(errorText(err));
    }
  };

  const clashing = pending ? pending.backup.docs.filter((d) => pending.conflicts.includes(d.id)) : [];
  const others = pending ? pending.backup.docs.length - clashing.length : 0;
  return (
    <div className="grid grid-cols-1 gap-3">
      <Hint>
        Brings back the docs in a backup with their versions, favorites, expiry, space and project. Missing spaces are added, and keys come back revoked so their uploads keep their names; mint new keys for your agents. Settings stay as they are.
      </Hint>
      <div>
        <input
          ref={input}
          type="file"
          accept=".tar,application/x-tar"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <Upload /> {busy ? "Importing…" : "Import backup…"}
        </Button>
      </div>
      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(undefined)}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pending) void run(pending, copy);
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>{plural(clashing.length, "doc")} already on the shelf</DialogTitle>
              <DialogDescription className="[overflow-wrap:anywhere]">
                {someDocs(clashing)} {clashing.length === 1 ? "has" : "have"} the same link as a doc you have now.
                {others === 1 ? " The other doc imports as it is." : others > 1 ? ` The other ${others} docs import as they are.` : ""}
              </DialogDescription>
            </DialogHeader>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">What should happen to {clashing.length === 1 ? "it" : "them"}?</legend>
              <Label className="font-normal">
                <input type="radio" name={`${id}copy`} checked={copy} onChange={() => setCopy(true)} className="size-4 accent-primary" />
                Import as copies, with new links. Your current docs stay as they are.
              </Label>
              <Label className="font-normal">
                <input type="radio" name={`${id}copy`} checked={!copy} onChange={() => setCopy(false)} className="size-4 accent-primary" />
                Skip {clashing.length === 1 ? "it" : "them"}, and keep only the docs you have now.
              </Label>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPending(undefined)}>
                Cancel
              </Button>
              <Button type="submit">Import</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Settings for the whole app, as opposed to one doc's. */
export function AppSettingsView({ onSpacesChanged }: { onSpacesChanged: () => void }) {
  const { data, error } = useLoad<AppSettings>("/settings");
  const [saved, setSaved] = useState<AppSettings>();
  const s = saved ?? data;

  return (
    <div className="mx-auto grid max-w-[60rem] grid-cols-1 gap-7 px-4 pt-5 pb-24 sm:px-10 sm:pt-7">
      <a href="#/" className={cn(focusRing, "-ml-1 flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground")}>
        <ChevronLeft className="size-4" aria-hidden />
        All uploads
      </a>
      <h1 className={cn(display, "text-5xl leading-[0.95]")}>Settings</h1>
      <section className="grid grid-cols-1 gap-2.5">
        <h2 className="text-base leading-none font-bold">Appearance</h2>
        <Appearance />
      </section>
      {error ? (
        <Problem error={error} />
      ) : !s ? (
        <Loading />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className="text-base leading-none font-bold">Expiry</h2>
            <ExpiryForm saved={s} onSaved={setSaved} />
          </section>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className="text-base leading-none font-bold">Slugs</h2>
            <SlugForm saved={s} onSaved={setSaved} />
          </section>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className="text-base leading-none font-bold">Readers</h2>
            <Readers settings={s} onSaved={setSaved} />
          </section>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className="text-base leading-none font-bold">Spaces</h2>
            <Spaces settings={s} onSaved={setSaved} onChanged={onSpacesChanged} />
          </section>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className="text-base leading-none font-bold">Backup</h2>
            <Backup />
          </section>
          <section className="grid grid-cols-1 gap-2.5">
            <h2 className="text-base leading-none font-bold">Import</h2>
            <Import onImported={onSpacesChanged} />
          </section>
        </>
      )}
    </div>
  );
}
