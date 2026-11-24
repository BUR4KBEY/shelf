import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Loading, Problem, display, focusRing, useLoad } from "@/components/bits";
import { Field, Hint } from "@/components/Settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorText, type AppSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULTS = [["never", "Never"], ["1h", "1 hour"], ["1d", "1 day"], ["7d", "7 days"], ["30d", "30 days"]];
const MAXES = [["1d", "1 day"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["365d", "1 year"]];

function Choice({ id, value, options, onChange }: { id: string; value: string; options: string[][]; onChange: (v: string) => void }) {
  // A value set some other way (e.g. "2w" over the API) still shows.
  const all = options.some(([v]) => v === value) ? options : [...options, [value, value]];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-describedby={`${id}-hint`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)">
        {all.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Settings for the whole app, as opposed to one doc's. Each change saves right away. */
export function AppSettingsView() {
  const { data, error } = useLoad<AppSettings>("/settings");
  const [saved, setSaved] = useState<AppSettings>();
  const s = saved ?? data;

  const save = async (patch: Partial<AppSettings>) => {
    try {
      setSaved(await api<AppSettings>("/settings", { method: "PATCH", json: patch }));
      toast.success("Settings saved");
    } catch (e) {
      toast.error(errorText(e));
    }
  };

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
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
            <Field label="New uploads expire after" htmlFor="f-default-expires">
              <Choice id="f-default-expires" value={s.defaultExpires ?? "never"} options={DEFAULTS} onChange={(v) => save({ defaultExpires: v === "never" ? null : v })} />
              <Hint id="f-default-expires-hint">
                For a new doc uploaded without an expiry, from here, the CLI or the API. An upload that sets its own expiry, or never, keeps it. Docs already on the shelf and new versions of them don't change.
              </Hint>
            </Field>
            <Field label="Longest expiry allowed" htmlFor="f-max-expires">
              <Choice id="f-max-expires" value={s.maxExpires} options={MAXES} onChange={(v) => save({ maxExpires: v })} />
              <Hint id="f-max-expires-hint">
                No upload or change can set a doc to expire later than this from now. Never is always allowed. Docs that already expire later keep their date.
              </Hint>
            </Field>
          </div>
        </section>
      )}
    </div>
  );
}
