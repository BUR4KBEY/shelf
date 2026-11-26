# Develop

The dev shell is managed with [devenv](https://devenv.sh). It provides Node 26 (LTS), pnpm and Go 1.27, and installs the Worker's packages on entry.

```sh
devenv up -d      # Worker on :8787 (the next free port in another worktree), dashboard signed in as you@localhost
devenv down
devenv test       # everything CI checks: worker typecheck and tests, the preview build, cli gofmt, vet and tests
```

Entering the shell installs git hooks that run gofmt, `go vet`, the Worker typecheck and nixfmt on staged files before each commit. The hooks carry their own Go, Node and pnpm, so `git commit` works from any shell once the worktree has entered devenv (`devenv shell -- true`).

## PR previews

Each pull request from a branch in this repo gets a [Worker Preview](https://developers.cloudflare.com/workers/previews/) at `https://pr-<number>-shelf.<subdomain>.workers.dev`, commented on the PR and deleted when it closes (`.github/workflows/preview.yml`). Previews use their own `shelf-preview` R2 bucket and D1 database, never production data.

Pull requests from forks never deploy on their own: the preview runs the PR's code with the Cloudflare token. Review the code, then comment `/deploy-preview <sha>` on the PR with the full 40-character id of the commit you reviewed (a short prefix could match a commit made to share it; only the repo owner's comments count). It deploys only if that commit is still the PR's head, so a push after your review can't slip in. You can also run Actions → preview → **Run workflow** with the PR number and SHA. Push new commits and you have to deploy again. The preview is deleted when the PR closes.

Every deploy sets a `preview` commit status: pending while it deploys, then success with the preview's URL, or failure. Make `preview` a required status check in the `main` ruleset, and fork PRs wait as *Expected* until you deploy them.

To set it up on your own deployment:

1. Create the bucket and database (`pnpm exec wrangler r2 bucket create shelf-preview`, `pnpm exec wrangler d1 create shelf-preview`) and put the database ID in `previews.d1_databases` in `wrangler.jsonc` and in `wrangler.preview-migrations.jsonc`.
2. Create an account API token limited to this account with *Workers* → **Editor** scoped to the `shelf` Worker only, and *D1* → **Edit**. It needs no R2 permission: deploying a binding doesn't need access to the bucket. D1 can't be scoped to one database yet, so the token can still edit every D1 database in the account; that is why fork PRs only deploy by hand. Add it and the account ID as repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. For the dashboard to work in previews, protect the Worker's previews with Access: Workers & Pages → shelf → Access → **Protect this Worker behind Access** → *Previews only*. Then set `previews.vars` in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `ACCESS_AUD` (the Access app's audience tag). Cloudflare doesn't set `ctx.access` on preview URLs, so the Worker checks the Access token itself.

## Try-it preview

[shelf.gh-previews.burakbey.dev](https://shelf.gh-previews.burakbey.dev) is a static site on GitHub Pages, unrelated to PR previews. A service worker runs the real Worker code from `src/` in the visitor's browser: D1 becomes SQLite in memory ([sql.js](https://sql.js.org)), saved to IndexedDB after each change, and R2 objects live in IndexedDB. Nothing is sent anywhere, so every visitor has their own shelf. It starts with sample data (`worker/preview/seed.ts`) and a banner that is always shown, whose **Reset** brings the sample back. Uploads work from the dashboard only: `/api/*` and `/mcp` answer 403. Docs are served without the `sandbox` CSP, because a sandboxed page's own requests (a folder's CSS and links) don't reach the service worker.

Everything lives in `worker/preview/`; production code doesn't change. `pnpm run build:preview` writes the site to `worker/preview/dist`, and `.github/workflows/pages.yml` deploys it on every push to `main`. To serve it yourself: in the repo's Settings → Pages, set the source to *GitHub Actions* and the custom domain (a CNAME record pointing at `<user>.github.io`), then tick *Enforce HTTPS*.

## Built with

| Part | Stack |
|---|---|
| Server | Cloudflare Workers with D1 and R2; Bun with SQLite and local disk in Docker |
| Dashboard | React, shadcn/ui, Tailwind CSS and Motion, built by Vite into one HTML file |
| CLI | Go |
| Try-it preview | The same Worker code in a service worker, with [sql.js](https://sql.js.org) and IndexedDB |
