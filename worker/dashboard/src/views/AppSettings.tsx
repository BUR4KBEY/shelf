import { useState, type FormEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Loading, Problem, display, focusRing, useLoad } from "@/components/bits";
import { DurationInput, Field, Hint } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { api, errorText, type AppSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

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

/** Settings for the whole app, as opposed to one doc's. */
export function AppSettingsView() {
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
      {error ? (
        <Problem error={error} />
      ) : !s ? (
        <Loading />
      ) : (
        <section className="grid grid-cols-1 gap-2.5">
          <h2 className="text-base leading-none font-bold">Expiry</h2>
          <ExpiryForm saved={s} onSaved={setSaved} />
        </section>
      )}
    </div>
  );
}
