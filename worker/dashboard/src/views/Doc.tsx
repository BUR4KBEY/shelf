import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ChevronLeft, Clock, ExternalLink, Lock, LockOpen, Star } from "lucide-react";
import { toast } from "sonner";
import { Confirm, LinkButtons, Loading, Problem, Section, Time, Tip, card, iconButton, useLoad, useTitle } from "@/components/bits";
import { DropZone } from "@/components/DropZone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText, nameOf, type DocDetail } from "@/lib/api";
import { ago, expiry, fullDate, plural, size } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteText } from "./Docs";

export function DocView({ id }: { id: string }) {
  const { data: d, error, reload } = useLoad<DocDetail>(`/docs/${encodeURIComponent(id)}`);
  const message = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  useTitle(d ? nameOf(d) : "");
  if (error) return <Problem error={error} />;
  if (!d) return <Loading />;
  const name = nameOf(d);

  const remove = async () => {
    try {
      await api(`/docs/${d.id}`, { method: "DELETE" });
      toast.success(`Deleted ${name}`);
      location.hash = "#/";
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  return (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-3">
        <a href="#/" className="-ml-1 flex w-fit items-center gap-0.5 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronLeft className="size-4" aria-hidden />
          Docs
        </a>
        <h1 className="text-2xl leading-tight font-semibold tracking-tight [overflow-wrap:anywhere]">{name}</h1>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={d.locked ? "secondary" : "outline"} className={cn(!d.locked && "text-muted-foreground")}>
            {d.locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
            {d.locked ? "Locked" : "Not locked"}
          </Badge>
          {d.favorite && (
            <Badge variant="outline">
              <Star className="fill-amber-400 text-amber-400" aria-hidden />
              Favorite
            </Badge>
          )}
          {d.expiresAt !== null && (
            <Badge variant={d.expiresAt <= Date.now() ? "destructive" : "outline"}>
              <Clock aria-hidden />
              {expiry(d.expiresAt)}
            </Badge>
          )}
          <span className="ml-1">
            {plural(d.latest, "version")}, updated <Time t={d.updatedAt}>{ago(d.updatedAt)}</Time>
          </span>
        </div>
        <div className={cn(card, "flex items-center gap-1 py-1 pr-1 pl-3")}>
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate rounded-sm font-mono text-[13px] outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
            {d.url}
          </a>
          <LinkButtons url={d.url} what={name} />
        </div>
      </div>

      <Section title="Settings">
        {/* Remounts when the saved settings change, but not when a new version arrives, so unsaved edits survive an upload. */}
        <Settings key={[d.title, d.slug, d.locked, d.expiresAt, d.favorite].join("\n")} d={d} onSaved={reload} />
      </Section>

      <Section title="New version">
        <DropZone
          target={{ ref: d.id, message: () => message.current?.value.trim() ?? "" }}
          overlay={`Drop to upload a new version of ${name}`}
          onDone={() => {
            if (message.current) message.current.value = "";
            reload();
          }}
          text={
            <>
              <span className="font-medium text-foreground">Drop a file or folder</span> to add v{d.latest + 1}
            </>
          }
        >
          <Input ref={message} maxLength={1000} placeholder="What changed? (optional)" aria-label="Message for the new version" className="max-sm:h-9" />
        </DropZone>
      </Section>

      <Section title="Versions" hint={`${d.versions.length}, newest first`}>
        <ul className={cn(card, "divide-y")}>
          {d.versions.map((v) => (
            <li key={v.n} className="flex items-start gap-3 py-2.5 pr-2 pl-3">
              <span className="mt-px min-w-9 rounded-md bg-muted px-1.5 py-0.5 text-center font-mono text-xs font-medium">v{v.n}</span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex items-start gap-2">
                  <span className={cn("text-sm [overflow-wrap:anywhere]", v.message ? "font-medium" : "text-muted-foreground italic")}>{v.message || "No message"}</span>
                  {v.n === d.latest && <Badge variant="secondary">latest</Badge>}
                </div>
                <div className="flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
                  <span>{plural(v.files, "file")}</span>
                  <span>{size(v.size)}</span>
                  <span>{fullDate(v.createdAt)}</span>
                  <span>by {v.keyName ?? "dashboard"}</span>
                </div>
              </div>
              <Tip label={`Open pinned v${v.n}`}>
                <Button variant="ghost" size="icon" className={iconButton} asChild>
                  <a href={`/view/${d.id}@${v.n}`} target="_blank" rel="noopener noreferrer" aria-label={`Open version ${v.n} in a new tab`}>
                    <ExternalLink />
                  </a>
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Delete">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-destructive/30 px-4 py-3">
          <p className="flex-[1_1_15rem] text-sm text-muted-foreground">Removes this doc, every version and all of its links.</p>
          <Button variant="destructive" className="max-sm:h-9" onClick={() => setConfirming(true)}>
            Delete doc
          </Button>
        </div>
      </Section>
      <Confirm open={confirming} onOpenChange={setConfirming} title={`Delete ${name}?`} body={deleteText(d.versions.length)} action="Delete" onConfirm={remove} />
    </>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-2 border-b py-3.5 sm:grid-cols-[8.5rem_1fr]">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="sm:h-8">
          {label}
        </Label>
      ) : (
        <span className="flex items-center text-sm leading-none font-medium sm:h-8">{label}</span>
      )}
      <div className="grid min-w-0 gap-1.5">{children}</div>
    </div>
  );
}
const Hint = ({ id, children }: { id?: string; children: ReactNode }) => (
  <p id={id} className="text-xs leading-relaxed text-muted-foreground">
    {children}
  </p>
);

const EXPIRIES = [["never", "Never"], ["1h", "In 1 hour"], ["1d", "In 1 day"], ["7d", "In 7 days"], ["30d", "In 30 days"]];

function Settings({ d, onSaved }: { d: DocDetail; onSaved: () => void }) {
  const initialExpiry = d.expiresAt === null ? "never" : "keep";
  const [title, setTitle] = useState(d.title ?? "");
  const [slug, setSlug] = useState(d.slug ?? "");
  const [password, setPassword] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [expires, setExpires] = useState(initialExpiry);
  const [favorite, setFavorite] = useState(d.favorite);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: "" });
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (title.trim() !== (d.title ?? "")) body.title = title.trim() || null;
    if (slug.trim() !== (d.slug ?? "")) body.slug = slug.trim() || null;
    if (password) body.password = password;
    else if (unlock) body.password = null;
    if (expires !== initialExpiry) body.expires = expires === "never" ? null : expires;
    if (favorite !== d.favorite) body.favorite = favorite;
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
      onSaved();
    } catch (err) {
      setSaving(false);
      setStatus({ text: errorText(err), error: true });
    }
  };

  return (
    <form noValidate onSubmit={submit} className={cn(card, "px-4 pb-4")}>
      <Field label="Title" htmlFor="f-title">
        <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={d.id} autoComplete="off" className="max-sm:h-9" />
      </Field>
      <Field label="Slug" htmlFor="f-slug">
        <div className="flex h-8 items-center rounded-lg border border-input bg-input/30 pl-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 max-sm:h-9">
          <span className="font-mono text-[13px] text-muted-foreground max-sm:text-base" aria-hidden>
            /view/
          </span>
          <input id="f-slug" value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={48} placeholder={d.id} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="h-slug" className="h-full min-w-0 flex-1 bg-transparent pr-2.5 font-mono text-[13px] outline-none placeholder:text-muted-foreground/60 max-sm:text-base" />
        </div>
        <Hint id="h-slug">A readable link instead of the random id. 3–48 characters: a–z, 0–9 and hyphens. A slug is guessable, so it needs a password.</Hint>
      </Field>
      <Field label="Password" htmlFor="f-password">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <Input id="f-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={unlock} autoComplete="new-password" placeholder={d.locked ? "Replace the password" : "Set a password"} aria-describedby="h-password" className="flex-[1_1_12rem] max-sm:h-9" />
          {d.locked && (
            <Label className="font-normal">
              <Switch checked={unlock} onCheckedChange={setUnlock} />
              Remove password
            </Label>
          )}
        </div>
        <Hint id="h-password">
          {d.locked ? "Locked. The current password can't be shown. " : "Not locked: anyone with the link can read it. "}
          8 or more characters.{d.locked && " It can't be removed while a slug is set."}
        </Hint>
      </Field>
      <Field label="Expires" htmlFor="f-expires">
        <Select value={expires} onValueChange={setExpires}>
          <SelectTrigger id="f-expires" className="w-full max-sm:data-[size=default]:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)">
            {d.expiresAt !== null && <SelectItem value="keep">{d.expiresAt <= Date.now() ? `Expired ${fullDate(d.expiresAt)}` : `Keep: ${fullDate(d.expiresAt)}`}</SelectItem>}
            {EXPIRIES.map(([value, text]) => (
              <SelectItem key={value} value={value}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Hint>After it expires the link stops working and the doc is deleted within a day.</Hint>
      </Field>
      <Field label="Favorite">
        <Label className="font-normal sm:h-8">
          <Switch checked={favorite} onCheckedChange={setFavorite} />
          Keep at the top of the list
        </Label>
      </Field>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-4">
        <Button type="submit" disabled={saving} className="max-sm:h-9">
          Save changes
        </Button>
        <span role="status" className={cn("text-sm text-muted-foreground", status.error && "text-destructive")}>
          {status.text}
        </span>
      </div>
    </form>
  );
}
