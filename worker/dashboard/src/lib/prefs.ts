import { useEffect, useSyncExternalStore } from "react";

/**
 * How the dashboard looks lives on <html> (`data-theme`, `data-palette`) and in cookies of the same name, so the Worker
 * renders its own pages (password form, Markdown) and the first paint of this one in it too. See src/page.ts.
 */
export type Pref = "theme" | "palette";
const DEFAULTS: Record<Pref, string> = { theme: "system", palette: "indigo" };

/** Mirrors PALETTES in src/page.ts and the `[data-palette]` rules in index.css. */
export const PALETTES = [
  ["indigo", "Indigo"],
  ["violet", "Violet"],
  ["plum", "Plum"],
  ["rose", "Rose"],
  ["sand", "Sand"],
  ["olive", "Olive"],
  ["green", "Green"],
  ["teal", "Teal"],
  ["ocean", "Ocean"],
  ["graphite", "Graphite"],
] as const;

const root = document.documentElement;

export function setPref(name: Pref, value: string) {
  const isDefault = value === DEFAULTS[name];
  if (isDefault) delete root.dataset[name];
  else root.dataset[name] = value;
  document.cookie = `${name}=${value}; Path=/; Max-Age=${isDefault ? 0 : 31536000}; SameSite=Lax`;
}

function watch(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(root, { attributeFilter: ["data-theme", "data-palette"] });
  return () => observer.disconnect();
}

/** Read from <html>, not local state: the sidebar, the folded rail and the settings page each have a switch and must agree. */
export const usePref = (name: Pref) => useSyncExternalStore(watch, () => root.dataset[name] ?? DEFAULTS[name]);

/** Points the favicon at the logo in the current theme and palette. */
export function useFavicon() {
  const theme = usePref("theme");
  const palette = usePref("palette");
  useEffect(() => {
    const params = new URLSearchParams({ palette, ...(theme !== "system" && { theme }) });
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", `/favicon.svg?${params}`);
  }, [theme, palette]);
}
