// What Settings → About shows, fixed when the dashboard is built (by `wrangler deploy`, Workers Builds or the preview).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null; // not a git checkout
  }
};

export function buildInfo() {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  return {
    // Workers Builds sets WORKERS_CI_COMMIT_SHA, in case its checkout has no git.
    commit: git("rev-parse", "HEAD") ?? process.env.WORKERS_CI_COMMIT_SHA ?? null,
    commitDate: git("log", "-1", "--format=%cI"),
    builtAt: new Date().toISOString(),
    node: process.version,
    compatibilityDate: wrangler.match(/"compatibility_date":\s*"([^"]+)"/)?.[1] ?? null,
  };
}
