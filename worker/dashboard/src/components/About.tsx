import { Fragment, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { code } from "@/components/bits";
import { Hint } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/api";
import { BUILD, REPO, newerCommits, type Commit } from "@/lib/build";
import { fullDate, plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const when = (iso: string | null) => (iso ? fullDate(Date.parse(iso)) : "Unknown");
const SHOWN = 5;

/** What this deploy was built from and runs on, and a check for newer commits that runs only when asked. */
export function About() {
  const [check, setCheck] = useState<{ busy?: boolean; commits?: Commit[]; error?: string }>({});
  const run = async () => {
    setCheck({ busy: true });
    try {
      setCheck({ commits: await newerCommits() });
    } catch (e) {
      setCheck({ error: errorText(e) });
    }
  };
  const rows: [string, ReactNode][] = [
    ["Commit", BUILD.commit ? <code className={code} title={BUILD.commit}>{BUILD.commit.slice(0, 7)}</code> : "Unknown"],
    ["Committed", when(BUILD.commitDate)],
    ["Built", when(BUILD.builtAt)],
    ["Built with", `Node.js ${BUILD.node}`],
    ["Runs on", `Cloudflare Workers, compatibility date ${BUILD.compatibilityDate ?? "unknown"}`],
  ];
  const commits = check.commits;
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-xs leading-5 font-semibold text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="grid gap-2">
        <div>
          <Button variant="outline" onClick={run} disabled={check.busy}>
            <RefreshCw className={cn(check.busy && "motion-safe:animate-spin")} aria-hidden /> Check for updates
          </Button>
        </div>
        <div aria-live="polite" className="text-sm">
          {check.error && <p className="text-destructive">{check.error}</p>}
          {commits?.length === 0 && <p>Up to date with {REPO}.</p>}
          {commits && commits.length > 0 && (
            <div className="grid gap-1.5">
              <p className="font-semibold">
                {commits.length === 100 ? "100 or more newer commits" : plural(commits.length, "newer commit")} on {REPO}:
              </p>
              <ul className="grid list-disc gap-1 pl-5">
                {commits.slice(0, SHOWN).map((c) => (
                  <li key={c.sha}>
                    <a href={c.html_url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      {c.commit.message.split("\n")[0]}
                    </a>{" "}
                    <span className="text-muted-foreground">· {fullDate(Date.parse(c.commit.committer.date))}</span>
                  </li>
                ))}
              </ul>
              {commits.length > SHOWN && (
                <a href={`https://github.com/${REPO}/commits/main`} target="_blank" rel="noreferrer" className="w-fit text-muted-foreground underline-offset-2 hover:underline">
                  and {commits.length - SHOWN} more on GitHub
                </a>
              )}
            </div>
          )}
        </div>
        <Hint>
          Asks GitHub for commits on {REPO}'s main branch newer than this build. Nothing is checked until you click, and nothing updates by itself: to update, pull and run <code className={code}>pnpm run deploy</code>, or sync your copy of the repo on GitHub if Workers Builds deploys it.
        </Hint>
      </div>
    </div>
  );
}
