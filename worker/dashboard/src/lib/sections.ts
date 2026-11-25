import { useEffect } from "react";

/** Scrolls to a page's section (`#/settings/backup` is the element `settings-backup`) and flashes it, so it's clear where a jump landed. */
export function land(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  el.classList.remove("landed");
  void el.offsetWidth; // restarts the flash when landing on the same section again
  el.classList.add("landed");
}

/** Lands on `#/<page>/<section>` once the page shows it: most sections only render after their data loads, hence `ready`. */
export function useLanding(page: string, section: string | undefined, ready: boolean) {
  useEffect(() => {
    if (section && ready) land(`${page}-${section}`);
  }, [page, section, ready]);
}
