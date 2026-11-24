import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { Loading, Problem, display, focusRing, useLoad } from "@/components/bits";
import { Field, Hint } from "@/components/Settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, errorText, type AppSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULTS = [["never", "Never"], ["1h", "1 hour"], ["1d", "1 day"], ["7d", "7 days"], ["30d", "30 days"]];

/** Settings for the whole app, as opposed to one doc's. Each change saves right away. */
export function AppSettingsView() {
  const { data, error } = useLoad<AppSettings>("/settings");
  const [picked, setPicked] = useState<string>();
  const saved = data?.defaultExpires ?? "never";
  const value = picked ?? saved;
  // A value set some other way (e.g. "2w" over the API) still shows.
  const options = DEFAULTS.some(([v]) => v === saved) ? DEFAULTS : [...DEFAULTS, [saved, saved]];

  const save = async (v: string) => {
    setPicked(v);
    try {
      await api("/settings", { method: "PATCH", json: { defaultExpires: v === "never" ? null : v } });
      toast.success("Settings saved");
    } catch (e) {
      setPicked(undefined);
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
      ) : !data ? (
        <Loading />
      ) : (
        <section className="grid grid-cols-1 gap-2.5">
          <h2 className="text-base leading-none font-bold">New uploads</h2>
          <div className="grid grid-cols-1 gap-x-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
            <Field label="Expire after" htmlFor="f-default-expires">
              <Select value={value} onValueChange={save}>
                <SelectTrigger id="f-default-expires" className="w-full" aria-describedby="f-default-expires-hint">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start" className="w-(--radix-select-trigger-width)">
                  {options.map(([v, text]) => (
                    <SelectItem key={v} value={v}>
                      {text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Hint id="f-default-expires-hint">
                For a new doc uploaded without an expiry, from here, the CLI or the API. An upload that sets its own expiry, or never, keeps it. Docs already on the shelf and new versions of them don't change.
              </Hint>
            </Field>
          </div>
        </section>
      )}
    </div>
  );
}
