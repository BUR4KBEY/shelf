# shelf

Publish a file or folder to your own Cloudflare account and get a link you can share. A minimal, self-hosted take on [postplan](https://www.npmjs.com/package/postplan).

> Early but working: Worker, HTTP API, dashboard, Go CLI and agent skills.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BUR4KBEY/shelf/tree/main/worker)

## Deploy

Either click the button above, which creates the Worker, R2 bucket and D1 database in your account, or deploy from a clone:

```sh
cd worker
npm install
npx wrangler login
npm run deploy      # deploys (creating the bucket and database on first run), then applies D1 migrations
```

Then, in the Cloudflare dashboard:

1. **Add a custom domain** to the `shelf` Worker (Workers & Pages → shelf → Settings → Domains & Routes).
2. **Protect the dashboard with Cloudflare Access.** With an API token that has *Access: Apps and Policies → Edit*:

   ```sh
   CLOUDFLARE_API_TOKEN=... npm run setup:access -- --domain your-domain --email you@example.com
   ```

   It creates (or updates) an allow-policy for your email and an Access app for `your-domain/dashboard`. Rerun it to change the emails. The Worker refuses `/dashboard` unless Access signed the request in, so `workers.dev` URLs can't reach it.

`/view/*` and `/api/*` stay public. Readers need the link (and the password if you set one), and the API needs a key.

## Dashboard

`https://your-domain/dashboard` (light and dark, following your system until you pick one in the sidebar; React + shadcn/ui, animated with Motion, which moves nothing when your system asks for reduced motion):

- The home screen is a log of uploads, newest first and grouped by day: who uploaded which version of which doc, with its message. Each key has its own colour, so you can tell your agents, CI and machines apart at a glance.
- Every upload has a copy-link button, a star for favorites and the doc's settings (title, slug, password, expiry, delete); click anywhere on the upload to open or close them. Filter by favorites, password protected or expiring, and search titles, slugs, ids and messages.
- Expired docs are hidden until the daily sweep deletes them: the **Expired** filter and the sidebar's "Show expired" bring them back.
- The sidebar lists every doc, favorites first, so one that has not changed in months is still one click away. It folds down to a narrow rail that keeps the logo and the theme switch. A doc's page has its link, settings, a place to upload a new version and its whole history.
- Keys sit in the sidebar with their uploads over the last 14 days: mint a key for each machine or agent (shown once). A new key's dialog also copies *agent instructions*: your domain, the key, and where to find `llms.txt` and the MCP server, ready to paste into an agent. A key's page shows how much and how often it uploads (totals, the last 30 days, the time of day it is busiest), every doc it uploaded to, and its uploads as a log; revoke it there. Revoked keys are archived: hidden from the sidebar until you click "Show revoked".
- **Settings** (in the sidebar) holds app-wide settings. *New uploads expire after* gives every new doc uploaded without an expiry (from the dashboard, the CLI or the API) a default one, e.g. 7 days. An upload that sets its own expiry, or `never`, keeps it; existing docs and new versions of them don't change. *Longest expiry allowed* (30 days unless changed) caps any expiry set from then on; never is always allowed, and docs that already expire later keep their date.
- Upload by dropping a file or folder anywhere on the page. On a doc's page, a drop adds a version to that doc.

The page source is in `worker/dashboard/`. It is built into one HTML file (`worker/src/dashboard.html`, not committed) that the Worker serves. `wrangler dev`, `wrangler deploy` and `npm test` build it first.

## First API key

Mint keys in the dashboard under **Keys**. Without Access set up yet, you can insert one with wrangler instead (use `--local` instead of `--remote` for `npm run dev`):

```sh
KEY="sk_$(openssl rand -hex 32)"
HASH=$(printf %s "$KEY" | sha256sum | cut -d' ' -f1)
npx wrangler d1 execute DB --remote --command \
  "INSERT INTO api_keys (id, name, hash, created_at) VALUES ('k_$(openssl rand -hex 6)', 'bootstrap', '$HASH', unixepoch() * 1000)"
echo "$KEY"   # shown once; only the hash is stored
```

## CLI

Download a binary from [Releases](https://github.com/BUR4KBEY/shelf/releases), or `go install github.com/BUR4KBEY/shelf/cli/cmd/shelf@latest`.

```sh
shelf login                                  # server URL + API key, saved to ~/.config/shelf (0600)
shelf push plan.html                         # prints the link; pushing the same path again adds a version
shelf push ./report/                         # a folder with an index.html
echo "$PW" | shelf push plan.md --slug q3-plan --password-stdin --expires 7d
shelf ls                                     # ★ favorites first, 🔒 locked
shelf set q3-plan --fav --expires never
shelf get https://your-domain/view/q3-plan --password-stdin
shelf rm q3-plan
```

`SHELF_URL` and `SHELF_KEY` override the saved login. `--json` on `push`, `ls` and `set` prints machine-readable output.

## Agents

Agents don't need the CLI. Every deployment describes itself to them in two ways. The quickest start is **Copy agent instructions** when you mint a key in the dashboard.

An API key acts as you, with the same power over docs as the dashboard: it can publish, read, change and delete any doc, password-protected ones included. Give each agent its own key so you can revoke it alone.

- **`https://your-domain/llms.txt`**: a plain-text guide to reading and publishing with HTTP, with your domain filled in. Tell an agent "read https://your-domain/llms.txt and publish this; the key is in `$SHELF_KEY`".
- **`https://your-domain/mcp`**: an MCP server (Streamable HTTP) with the tools `publish`, `read_doc`, `list_docs`, `get_doc`, `update_doc` and `delete_doc`. It takes the same API key as the HTTP API, as `Authorization: Bearer <key>`. `read_doc` reads any doc without its password. For Claude Code:

  ```sh
  claude mcp add --transport http shelf https://your-domain/mcp --header "Authorization: Bearer $SHELF_KEY"
  ```

  **Only an API key, no OAuth.** Clients that can only sign in with OAuth, such as claude.ai and ChatGPT connectors, can't connect. Use a client that lets you set a header (Claude Code, Codex, Cursor, Claude Desktop through `mcp-remote`), or `llms.txt`. `publish` sends file contents through the model's context, so use the CLI or curl for large files.

[`skills/shelf-publish`](skills/shelf-publish/SKILL.md) lets an agent write a page and publish it, with the CLI when it is installed and with MCP or `llms.txt` when it isn't. [`skills/shelf-read`](skills/shelf-read/SKILL.md) lets it read a shelf link someone gives it. Copy them into your agent's skills directory (for example `~/.claude/skills/`).

## Publish with curl

Push a manifest. If the server is missing any blobs it lists them; upload those, then push the same manifest again.

```sh
U=https://your-domain   # or http://localhost:8787
SHA=$(sha256sum plan.html | cut -d' ' -f1)
M="{\"files\":[{\"path\":\"plan.html\",\"sha256\":\"$SHA\"}]}"

curl -H "Authorization: Bearer $KEY" -d "$M" $U/api/push                 # {"missing":["<sha>"]}
curl -X PUT -H "Authorization: Bearer $KEY" --data-binary @plan.html $U/api/blobs/$SHA
curl -H "Authorization: Bearer $KEY" -d "$M" $U/api/push                 # {"id","url","versionUrl","version",...}
```

Optional fields in the push body:

| Field | Effect |
|---|---|
| `ref` | Id or slug of an existing doc; the push becomes its next version. |
| `slug` | Publish at `/view/<slug>`. A slug is guessable, so it requires a password. Slugs ignore case and are stored lowercase, so `/view/Q3-Plan` opens `q3-plan`. Pushing with a slug that exists updates that doc. |
| `password` | Readers must enter it (8+ chars). `null` removes it. |
| `expires` | A duration up to the longest expiry set in the dashboard's Settings (30 days unless changed): `30m`, `12h`, `7d`, `2w`, `30d`. `0` or `null` for never. Left out, a new doc gets the default from the dashboard's Settings (never unless set). Expired links return 410 and are deleted by a daily cron. |
| `title`, `message` | Shown in listings and version history. |

Pushing identical content creates no new version (`"created": false`).

A folder is a manifest with many paths and an `index.html`. Pages link to each other with relative paths.

### Manage docs

```sh
curl -H "Authorization: Bearer $KEY" $U/api/docs                          # list, favorites first
curl -H "Authorization: Bearer $KEY" $U/api/docs/<ref>                    # detail + version history
curl -H "Authorization: Bearer $KEY" $U/api/uploads                       # newest 200 uploads across all docs
curl -X PATCH -H "Authorization: Bearer $KEY" -d '{"favorite":true,"expires":"7d"}' $U/api/docs/<ref>
curl -X DELETE -H "Authorization: Bearer $KEY" $U/api/docs/<ref>
```

`PATCH` takes the same `slug`, `password`, `expires` and `title` fields as push, plus `favorite`.

## What readers get

| URL | Serves |
|---|---|
| `/view/<id-or-slug>` | The latest version. Ids and slugs ignore case. A folder redirects to `/view/<ref>/` so relative links work. |
| `/view/<ref>@3` | Version 3, pinned. |
| `/view/<ref>/guide` | `guide.html` in a folder; `/docs/` serves `docs/index.html`. |
| `?raw` | Markdown source instead of the rendered page. |

- HTML, SVG, rendered Markdown and every other type except PDF get a sandbox CSP with an opaque origin. Inline scripts run, but they can't reach cookies, storage, the network, forms or frames.
- PDFs, images, audio, video, text, CSS and JS are served inline. Any other type downloads.
- Range requests work, so video seeking works.
- Password docs show a password form. The unlock lasts 30 days, until the password changes. Agents send `X-Doc-Password: <password>` instead. Password attempts are limited to 10 per minute per IP and doc.
- A missing or expired link shows a short page in a browser and one line of plain text to anything else (curl, an agent). These pages, the password form and rendered Markdown use the dashboard's colours and font, which the Worker serves at `/font/`.
- The password form and those short pages have a theme switch (System, Light, Dark). It is a link to `/theme/<name>`, which sets a `theme` cookie; the dashboard's switch sets the same cookie, and rendered Markdown follows it.
- You skip the form when you open a doc from the dashboard, or use the form's "Open it from the dashboard" link while signed in to Access (`/dashboard/open/<ref>` sets the unlock cookie, then redirects to `/view/<ref>`).

## Develop

The dev shell is managed with [devenv](https://devenv.sh). It provides Node 22 and Go.

```sh
devenv shell -- sh -c 'cd worker && npm install && npm run dev'   # :8787, dashboard signed in as you@localhost
devenv shell -- sh -c 'cd worker && npm test && npm run typecheck && npm run typecheck:dashboard'
devenv shell -- sh -c 'cd cli && go test ./...'
```

### PR previews

Each pull request from a branch in this repo gets a [Worker Preview](https://developers.cloudflare.com/workers/previews/) at `https://pr-<number>-shelf.<subdomain>.workers.dev`, commented on the PR and deleted when it closes (`.github/workflows/preview.yml`). Previews use their own `shelf-preview` R2 bucket and D1 database, never production data.

Pull requests from forks never deploy on their own: the preview runs the PR's code with the Cloudflare token. Review the code, then comment `/deploy-preview <sha>` on the PR with the commit you reviewed (7+ characters; only the repo owner's comments count). It deploys only if that commit is still the PR's head, so a push after your review can't slip in. You can also run Actions → preview → **Run workflow** with the PR number and SHA. Push new commits and you have to deploy again. The preview is deleted when the PR closes.

Every deploy sets a `preview` commit status: pending while it deploys, then success with the preview's URL, or failure. Make `preview` a required status check in the `main` ruleset, and fork PRs wait as *Expected* until you deploy them.

To set it up on your own deployment:

1. Create the bucket and database (`npx wrangler r2 bucket create shelf-preview`, `npx wrangler d1 create shelf-preview`) and put the database ID in `previews.d1_databases` in `wrangler.jsonc` and in `wrangler.preview-migrations.jsonc`.
2. Create an account API token limited to this account with *Workers* → **Editor** scoped to the `shelf` Worker only, and *D1* → **Edit**. It needs no R2 permission: deploying a binding doesn't need access to the bucket. D1 can't be scoped to one database yet, so the token can still edit every D1 database in the account; that is why fork PRs only deploy by hand. Add it and the account ID as repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. For the dashboard to work in previews, protect the Worker's previews with Access: Workers & Pages → shelf → Access → **Protect this Worker behind Access** → *Previews only*. Then set `previews.vars` in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `ACCESS_AUD` (the Access app's audience tag). Cloudflare doesn't set `ctx.access` on preview URLs, so the Worker checks the Access token itself.

## License

MIT
