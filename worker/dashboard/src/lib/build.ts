/**
 * Set by vite's `define` from dashboard/build-info.ts. Dates are ISO strings; any field is null when the build couldn't tell.
 * `cleanupCron`: the cleanup's schedule from wrangler.jsonc.
 */
declare const __BUILD__: { commit: string | null; commitDate: string | null; builtAt: string; node: string; compatibilityDate: string | null; cleanupCron: string | null };
export const BUILD = __BUILD__;

export const REPO = "BUR4KBEY/shelf";

export type Commit = { sha: string; html_url: string; commit: { message: string; committer: { date: string } } };

/**
 * The commits on shelf's main branch newer than this build, newest first (at most 100).
 * By date rather than by sha, so it also works for a copy of the repo whose history differs (the Deploy to Cloudflare button makes one).
 */
export async function newerCommits(): Promise<Commit[]> {
  const since = BUILD.commitDate ?? BUILD.builtAt;
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=main&per_page=100&since=${encodeURIComponent(since)}`, { headers: { accept: "application/vnd.github+json" } });
  if (!res.ok)
    throw new Error(
      res.status === 404 ? `GitHub can't show ${REPO} to visitors: it's private or moved.` : res.status === 403 || res.status === 429 ? "GitHub is rate limiting this network. Try again in an hour." : `GitHub answered ${res.status}.`,
    );
  const commits: Commit[] = await res.json();
  // `since` includes commits at that very second, this build's own among them.
  return commits.filter((c) => c.sha !== BUILD.commit && Date.parse(c.commit.committer.date) > Date.parse(since));
}
