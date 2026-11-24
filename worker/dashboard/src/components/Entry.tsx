import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { motion } from "motion/react";
import { clock } from "@/lib/format";
import { Time } from "./bits";
import { cn } from "@/lib/utils";

/** One upload in the log. `color` belongs to the key that made it: it edges and tints the row and colours the uploader's name. */
export function Entry(props: { color: string; at: number; who: string; did: string; title?: ReactNode; message?: string | null; meta: ReactNode; actions?: ReactNode; children?: ReactNode; onClick?: MouseEventHandler }) {
  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{ "--k": props.color } as CSSProperties}
      onClick={props.onClick}
      className={cn("grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 rounded-xl border border-l-[5px] border-(--k)/25 border-l-(--k) bg-[light-dark(color-mix(in_oklab,var(--k)_7%,var(--card)),color-mix(in_oklab,var(--k)_9%,var(--card)))] py-3 pr-3 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:pr-4", props.onClick && "cursor-pointer")}
    >
      <p className="text-right text-[0.9375rem] leading-[1.375rem] font-semibold text-muted-foreground tabular-nums">
        <Time t={props.at}>{clock(props.at)}</Time>
      </p>
      <div className="min-w-0">
        <p className="leading-[1.375rem] text-muted-foreground [overflow-wrap:anywhere]">
          <b className="font-bold text-(--k)">{props.who}</b> {props.did}
        </p>
        {props.title}
        {props.message && <p className="text-[0.9375rem] [overflow-wrap:anywhere]">{props.message}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[0.8125rem] text-muted-foreground">{props.meta}</div>
      </div>
      {props.actions && <div className="flex items-start gap-1 max-sm:col-start-2 max-sm:mt-2 sm:justify-end">{props.actions}</div>}
      {props.children && <div className="col-start-2 -col-end-1 min-w-0">{props.children}</div>}
    </motion.article>
  );
}
