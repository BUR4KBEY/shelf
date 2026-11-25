import { useContext, useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Confirm, useLoad } from "@/components/bits";
import { SpacesContext } from "@/components/DocBits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText, nameOf, type AppSettings, type Doc } from "@/lib/api";
import { fullDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const UNITS = [["m", "Minutes"], ["h", "Hours"], ["d", "Days"], ["w", "Weeks"]];

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 content-start gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
export const Hint = ({ id, children }: { id?: string; children: ReactNode }) => (
  <p id={id} className="text-xs leading-relaxed text-muted-foreground">
    {children}
  </p>
);

/** A whole number and a unit (minutes to weeks); the caller joins them into a duration like `36h`. */
export function DurationInput(props: { id: string; amount: string; unit: string; onAmount: (v: string) => void; onUnit: (v: string) => void; placeholder?: string; describedBy?: string }) {
  return (
    <div className="flex gap-2">
      <Input id={props.id} type="number" inputMode="numeric" min={0} step={1} value={props.amount} onChange={(e) => props.onAmount(e.target.value)} placeholder={props.placeholder} aria-describedby={props.describedBy} className="min-w-0 flex-1" />
      <Select value={props.unit} onValueChange={props.onUnit}>
        <SelectTrigger aria-label="Unit" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {UNITS.map(([value, text]) => (
            <SelectItem key={value} value={value}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Picks one of the spaces, all but `exclude`. */
export function SpaceSelect({ id, value, onChange, describedBy, exclude }: { id?: string; value: string; onChange: (v: string) => void; describedBy?: string; exclude?: string }) {
  const spaces = (useContext(SpacesContext) ?? []).filter((s) => s.id !== exclude);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
        <SelectValue placeholder="Loading…" />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {spaces.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A doc's title, slug, password, expiry and space, and its delete button. Favorite is the star next to the doc's name.
 * Mount it with a key made of the saved values, so it resets when they change but keeps unsaved edits through an upload.
 */
export function Settings({ d, onChanged, onDeleted }: { d: Doc; onChanged: () => void; onDeleted?: () => void }) {
  const id = useId();
  const app = useLoad<AppSettings>("/settings").data;
  const maxExpires = app?.maxExpires;
  const maxSlug = app?.maxSlugLength ?? 48;
  // An empty amount keeps the current expiry; 0 means never.
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("d");
  const [title, setTitle] = useState(d.title ?? "");
  const [slug, setSlug] = useState(d.slug ?? "");
  const [space, setSpace] = useState(d.space);
  const [password, setPassword] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (title.trim() !== (d.title ?? "")) body.title = title.trim() || null;
    if (slug.trim() !== (d.slug ?? "")) body.slug = slug.trim() || null;
    if (password) body.password = password;
    else if (unlock) body.password = null;
    if (amount !== "") body.expires = Number(amount) === 0 ? null : `${amount}${unit}`;
    if (space !== d.space) body.space = space;
    if (!Object.keys(body).length) return setStatus({ text: "Nothing to save." });
    setSaving(true);
    setStatus({ text: "Saving…" });
    try {
      await api(`/docs/${d.id}`, { method: "PATCH", json: body });
      toast.success("Settings saved");
      setPassword("");
      setUnlock(false);
      setSaving(false);
      setStatus({ text: "" });
      onChanged();
    } catch (err) {
      setSaving(false);
      setStatus({ text: errorText(err), error: true });
    }
  };

  const remove = async () => {
    try {
      await api(`/docs/${d.id}`, { method: "DELETE" });
      toast.success(`Deleted ${nameOf(d)}`);
      onDeleted?.();
      onChanged();
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
      <Field label="Title" htmlFor={`${id}title`}>
        <Input id={`${id}title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={d.id} autoComplete="off" />
      </Field>
      <Field label="Slug" htmlFor={`${id}slug`}>
        <div className="flex h-9 items-center rounded-lg border border-input pl-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:h-8 dark:bg-input/30">
          <span className="text-base text-muted-foreground md:text-sm" aria-hidden>
            /view/
          </span>
          <input id={`${id}slug`} value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={maxSlug} placeholder={d.id} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby={`${id}slug-hint`} className="h-full min-w-0 flex-1 bg-transparent pr-2.5 text-base outline-none placeholder:text-muted-foreground/70 md:text-sm" />
        </div>
        <Hint id={`${id}slug-hint`}>A readable link instead of the random id. 3 to {maxSlug} lowercase letters, digits and hyphens. A slug is guessable, so it needs a password.</Hint>
      </Field>
      <Field label="Password" htmlFor={`${id}password`}>
        <Input id={`${id}password`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={unlock} autoComplete="new-password" placeholder={d.locked ? "Replace the password" : "None. Anyone with the link can read it"} aria-describedby={`${id}password-hint`} />
        {d.locked && (
          <Label className="font-normal">
            <Switch checked={unlock} onCheckedChange={setUnlock} />
            Remove password
          </Label>
        )}
        <Hint id={`${id}password-hint`}>
          {d.locked && "The current password can't be shown. "}8 or more characters.{d.locked && " It can't be removed while a slug is set."}
        </Hint>
      </Field>
      <Field label="Expires" htmlFor={`${id}expires`}>
        <DurationInput id={`${id}expires`} amount={amount} unit={unit} onAmount={setAmount} onUnit={setUnit} placeholder={d.expiresAt === null ? "Never" : d.expiresAt <= Date.now() ? `Expired ${fullDate(d.expiresAt)}` : `Keep: ${fullDate(d.expiresAt)}`} describedBy={`${id}expires-hint`} />
        <Hint id={`${id}expires-hint`}>From now, up to {maxExpires ?? "the longest allowed in Settings"}. 0 means never. After it expires the link stops working and the doc is deleted within a day.</Hint>
      </Field>
      <Field label="Space" htmlFor={`${id}space`}>
        <SpaceSelect id={`${id}space`} value={space} onChange={setSpace} describedBy={`${id}space-hint`} />
        <Hint id={`${id}space-hint`}>While spaces are isolated (Settings), only keys in this space can see, update or delete it. Anyone with the link can still read it.</Hint>
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:col-span-2">
        <Button type="submit" disabled={saving}>
          Save changes
        </Button>
        <span role="status" className={cn("text-sm text-muted-foreground", status.error && "text-destructive")}>
          {status.text}
        </span>
        <Button type="button" variant="ghost" className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15" onClick={() => setConfirming(true)}>
          Delete doc
        </Button>
      </div>
      <Confirm
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${nameOf(d)}?`}
        body={`This removes the doc and ${d.latest === 1 ? "its version" : `all ${d.latest} versions`}. Its links stop working. This can't be undone.`}
        action="Delete"
        onConfirm={remove}
      />
    </form>
  );
}
