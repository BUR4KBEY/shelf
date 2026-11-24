import { Lock, Star } from "lucide-react";
import { display, focusRing, groupName } from "@/components/bits";
import { isExpired } from "@/components/DocBits";
import { nameOf, type Activity, type Doc, type Key } from "@/lib/api";
import { timeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KeyList } from "@/views/Keys";

const DAY = 86_400_000;
const item = "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none hover:bg-card/60 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-card aria-[current=page]:font-semibold";

/** Every doc and every key, always in reach. The log shows what happened; this shows what there is. */
export function Sidebar(props: { docs: Doc[]; uploads: Activity[]; keys: Key[]; colorOf: (keyId: string | null) => string; openId?: string; email: string; onNavigate: () => void; onKeysChanged: () => void }) {
  return (
    <div className="flex min-h-full flex-col gap-7 px-4 py-6 lg:px-5">
      <a href="#/" className={cn(display, focusRing, "w-fit text-3xl leading-none max-lg:hidden")}>
        shelf
      </a>

      <nav aria-labelledby="docs-name" onClick={props.onNavigate}>
        <h2 id="docs-name" className={cn(groupName, "mb-2.5 flex justify-between")}>
          On the shelf <span>{props.docs.length}</span>
        </h2>
        <ul className="-mx-2.5 grid grid-cols-1 gap-px">
          <li>
            <a href="#/" aria-current={props.openId ? undefined : "page"} className={item}>
              All uploads
            </a>
          </li>
          {props.docs.map((d) => {
            const left = d.expiresAt === null ? null : timeLeft(d.expiresAt);
            return (
              <li key={d.id}>
                <a href={`#/doc/${d.id}`} aria-current={d.id === props.openId || (d.slug !== null && d.slug === props.openId) ? "page" : undefined} className={item}>
                  {d.favorite && (
                    <>
                      <Star className="size-3.5 shrink-0 fill-current text-warning" aria-hidden />
                      <span className="sr-only">favorite</span>
                    </>
                  )}
                  <span className={cn("min-w-0 flex-1 truncate", isExpired(d) && "text-muted-foreground line-through")}>{nameOf(d)}</span>
                  {d.locked && (
                    <>
                      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="sr-only">password protected</span>
                    </>
                  )}
                  {left && (
                    <span className={cn("text-xs font-semibold", d.expiresAt! - Date.now() < DAY ? "text-warning" : "text-muted-foreground")}>
                      <span className="sr-only">expires in </span>
                      {left}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="keys-name">
        <h2 id="keys-name" className={cn(groupName, "mb-2.5")}>
          Keys
        </h2>
        <KeyList keys={props.keys} uploads={props.uploads} colorOf={props.colorOf} onChanged={props.onKeysChanged} />
      </section>

      <p className="mt-auto truncate text-[0.8125rem] text-muted-foreground" title={props.email}>
        {props.email}
      </p>
    </div>
  );
}
