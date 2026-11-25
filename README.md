# shelf

Publish a file or folder to your own Cloudflare account and get a link you can share. A minimal, self-hosted take on [postplan](https://www.npmjs.com/package/postplan).

> Early but working: Worker, HTTP API, dashboard, Go CLI and agent skills.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BUR4KBEY/shelf/tree/main/worker)

**[Try the preview](https://shelf.gh-previews.burakbey.dev)**: the dashboard with a year of sample uploads, running entirely in your browser.

## Deploy

Either click the button above, which creates the Worker, R2 bucket and D1 database in your account, or deploy from a clone:

```sh
cd worker
pnpm install
pnpm exec wrangler login
pnpm run deploy    # deploys (creating the bucket and database on first run), then applies D1 migrations
```

Then, in the Cloudflare dashboard:

1. **Add a custom domain** to the `shelf` Worker (Workers & Pages → shelf → Settings → Domains & Routes).
2. **Protect the dashboard with Cloudflare Access.** With an API token that has *Access: Apps and Policies → Edit*:

   ```sh
   CLOUDFLARE_API_TOKEN=... pnpm run setup:access -- --domain your-domain --email you@example.com
   ```

   It creates (or updates) an allow-policy for your email and an Access app for `your-domain/dashboard`. Rerun it to change the emails. The Worker refuses `/dashboard` unless Access signed the request in, so `workers.dev` URLs can't reach it.

`/view/*` and `/api/*` stay public. Readers need the link (and the password if you set one), and the API needs a key.

## Dashboard

`https://your-domain/dashboard` (light and dark, following your system until you pick one in the sidebar or Settings, in one of ten colours; React + shadcn/ui, animated with Motion, which moves nothing when your system asks for reduced motion):

- The home screen is a log of uploads, newest first and grouped by day: who uploaded which version of which doc, with its message. Each key has its own colour, so you can tell your agents, CI and machines apart at a glance.
- Every upload has a copy-link button, a star for favorites and the doc's settings (title, slug, password, expiry, project, delete); click anywhere on the upload to open or close them. Filter by favorites, password protected or expiring, narrow to one project once a doc has one and to one space once there are two, and search titles, slugs, ids, projects and messages.
- **Select** (next to the search) checks uploads to act on several docs at once: click an upload or its checkbox, shift-click to take every doc between it and the last one clicked, or *Select all shown* to take everything the filters and search left. Then favorite them, change their project, expiry or space, or delete them after one confirmation. Selection is by doc, so all of a doc's uploads check together, and deleting removes every version. If a filter or search hides docs you checked, the bar and every dialog warn you and name them, since the action still reaches them. Each action changes all the docs or none.
- Expired docs are hidden until the daily sweep deletes them: the **Expired** filter and the sidebar's "Show expired" bring them back.
- The sidebar lists docs favorites first, then the most recently changed, 20 at a time: *Show more* lists the rest, and ⌘K finds any doc. It folds down to a narrow rail that keeps the logo and the theme switch. A doc's page has its link, settings, a place to upload a new version and its whole history, the newest 50 versions first: *Show older* lists the rest. Each older version has a *Turn off* / *Turn on* button, and *Select* in the history does it for many at once (shift-click selects a range; *Select all* includes versions not listed yet): a turned-off version keeps its files but its pinned link stops working, and the current version can't be turned off. Backups keep which versions are off.
- Keys sit in the sidebar with their uploads over the last 14 days: mint a key for each machine or agent (shown once) and pick its space. A new key's dialog also copies *agent instructions* to paste into an agent: it asks your approval to export `SHELF_URL` and `SHELF_KEY` in your shell profile, where every project and MCP client can read them (or puts them where you say instead), then points it at `llms.txt` and the MCP server. A key's page shows how much and how often it uploads: totals, uploads over the last 7 days, 30 days, 90 days or year (you pick), the time of day it is busiest in that period, and a GitHub-style heatmap of its last year. Below that, every doc it uploaded to and its uploads as a log; move it to another space or revoke it there. Revoked keys are archived: hidden from the sidebar until you click "Show revoked". A revoked key's page can delete it for good; its uploads stay, shown as from a deleted key.
- **Analytics** (in the sidebar) puts every key side by side, for the last 7 days, 30 days, 90 days or year: uploads per day stacked in each key's colour (click a key under the chart to see only it), a table of each key's uploads, the change from the period before, docs, bytes kept and quota use, the bytes each key keeps per space with the keys at 80% of their quota or more, the docs more than one key (or a key and the dashboard) uploaded to, the live keys that uploaded nothing in the period, and one yearly heatmap. Uploads from the dashboard and from deleted keys get their own rows. Its *Views* section (see Readers below) shows views and readers in the period against the one before, views per day, the most-read docs and the docs nobody opened. Once there are two spaces, a filter narrows it to one.
- **Quotas.** On a key's page, set how much it may keep on the shelf (every version it uploaded that still exists counts in full) and what an upload that doesn't fit does: *Refuse it* (HTTP 413), or *Delete this key's oldest uploads*, oldest first until it fits. Deleting keeps favorites, and the current version of a doc that has older versions from another key or the dashboard; a doc left with no versions is deleted. An upload bigger than the whole quota is always refused. Dashboard uploads have no quota.
- **Settings** (in the sidebar) holds app-wide settings. *New uploads expire after* gives every new doc uploaded without an expiry (from the dashboard, the CLI or the API) a default one, e.g. 7 days. An upload that sets its own expiry, or `never`, keeps it; existing docs and new versions of them don't change. *Longest expiry allowed* (30 days unless changed) caps any expiry set from then on; never is always allowed, and docs that already expire later keep their date. *Longest slug allowed* (48 characters unless changed, 3 to 128) caps any slug set from then on; docs that already have a longer slug keep it.
- **Appearance**, at the top of Settings: the theme (system, light, dark) and the colour (indigo, violet, plum, rose, sand, olive, green, teal, ocean, graphite). The logo and the favicon change with them. Both are per browser, kept in the `theme` and `palette` cookies, so the password form and rendered Markdown follow them in that browser too.
- **Dark Reader**: when the Dark Reader extension is on, the dashboard, the password form and rendered Markdown switch to their own dark theme and turn Dark Reader off for themselves, so it never repaints them. A theme picked in Appearance still wins, and Dark Reader's light mode keeps the page light. Uploaded HTML docs are left to Dark Reader.
- **Spaces** (in Settings) keep keys apart. Each key belongs to one space, and its uploads land there. A key lists, reads, updates and deletes only its own space's docs; another space's docs are "not found" to it, and another space's slug is "taken". Everything starts in *Default*, so nothing changes until you add a second space. Per space you choose whether its keys may delete docs and read its password-protected docs without the password (MCP `read_doc`). Turning off *Keep spaces apart* lets every key reach every space; even then a key never skips another space's password. The dashboard sees every space: once there are two, each doc shows its space, a doc's settings move it to another space, and docs uploaded from the dashboard start in *Default*. Deleting a space moves its keys to a space you pick, and its docs too unless you choose to delete them; *Default* can't be deleted. Public `/view` links are not affected.
- **Projects** group docs inside a space, e.g. one per thing an agent builds there. A key names one when it uploads (`project` in the API and MCP, `--project` in the CLI) and the project exists as long as a doc names it: there is nothing to create in the dashboard and nothing to clean up. A name the space already has, in any case, keeps its existing spelling, so `Billing` joins `billing`. A new version keeps the doc's project unless its upload names another. Each doc shows its project, and a doc's settings change or clear it.
- **Spaces or projects?** Keys that work together go in the same space, even from different machines; make another space only for keys that must not see each other's docs, such as a client's machine or a shared CI runner. Sort docs inside a space with projects. A project never spans spaces: a machine that works in two spaces gets a key for each (the CLI reads `SHELF_KEY`, and each agent's MCP config has its own key). If no key needs keeping apart, one space and projects are all you need.
- **Readers** (in Settings). *View statistics* and *Link previews* are off unless turned on; *Shelf credit* is on unless turned off. *View statistics* counts each time a reader opens a doc: a doc's page shows its views, readers, when it was last opened and a bar per day for the last 30 days, and each version its views. Bots, link previews, video seeks and your own opens from the dashboard don't count. A reader is a hash of the IP address and browser with the day, so neither is stored and the same reader on another day counts again. *Link previews* lets chat apps (Slack, Discord, WhatsApp, iMessage, Telegram, LinkedIn, Mastodon…) open a shared link to show a card; HTML and Markdown docs get the doc's title as `og:title`. While it is off, those crawlers get a 403 and the link shows as plain text. Search engines never index anything either way (see below). *Shelf credit* shows a small "Shared with shelf" badge, linking to this repo, in the bottom-right corner of HTML and Markdown docs when a browser opens them; readers can close it. `shelf get`, curl, agents and other files always get the doc's own bytes.
- **Backup** (in Settings) downloads a `.tar` of every doc, or one space's: every version's files at `docs/<id>/<version>/<path>` (a file unchanged since an earlier version is a hard link to it) and `shelf.json` listing docs, versions, keys, spaces and settings. Keys themselves are never in it. *Include password hashes* adds each locked doc's password hash, so an import keeps it locked with the same password; anyone holding such a file can open those docs without the password, since the unlock cookie is derived from the hash.
- **Import** (in Settings) restores a backup: docs with their ids, slugs, versions, messages, favorites, expiry, space and project. Spaces it names are added if missing, and keys come back revoked, so their uploads keep their names. If a doc's id or slug is already taken, a dialog asks whether to skip those docs or import them as copies with new links (dropping a taken slug). A locked doc from a backup without password hashes stays locked behind a random password until you set a new one. Settings and view counts aren't imported.
- **Cleanup** (in Settings) shows the last cleanup: when it ran, whether the daily cron or you started it, how long it took, and how many expired docs and unused files it deleted and the space they took, or why it failed. It also shows how many expired docs the next run would delete, when the next daily run is due (from the schedule the cron last ran on, so a trigger changed in Cloudflare shows too; before the first daily run, from the cron in `wrangler.jsonc`), the last 10 runs, and a warning when the daily run hasn't happened for a day and a half. *Run now* runs it at once, asking first when it would delete expired docs, since the **Expired** filter can bring those back only until a cleanup runs. A cleanup deletes docs whose expiry has passed, then stored files no version uses any more (such as those of deleted docs), keeping files uploaded in the last day so an upload in progress never loses them. A failed daily run also shows as failed in Cloudflare's cron log.
- **About** (at the bottom of Settings) shows the commit the deploy was built from and when, the Node.js version that built it, the Workers compatibility date it runs on, and a link to this repo on GitHub with a *Star on GitHub* button. *Check for updates* asks GitHub for newer commits on this repo's `main` and lists them; it runs only when you click it, and nothing updates by itself.
- Upload by dropping a file or folder anywhere on the page. On a doc's page, a drop adds a version to that doc.
- **⌘K / Ctrl+K** (or *Search* in the sidebar) opens a command palette: jump to any page, any settings or analytics section (*Settings › Appearance*, or just *theme*), doc or key, show one key's or one space's analytics, switch the theme, fold the sidebar, or star shelf on GitHub. With nothing typed, it starts with your last five picks. Each section has its own link, like `#/settings/backup`, and briefly lights up when you land on it; analytics filters are in the link too (`#/analytics?space=…&key=…`). Outside a text field, `g u`, `g a` and `g s` open All uploads, Analytics and Settings, and `[` folds or unfolds the sidebar.

The page source is in `worker/dashboard/`. It is built into one HTML file (`worker/src/dashboard.html`, not committed) that the Worker serves. `wrangler dev`, `wrangler deploy` and `pnpm test` build it first.

## First API key

Mint keys in the dashboard under **Keys**. Without Access set up yet, you can insert one with wrangler instead (use `--local` instead of `--remote` for `pnpm run dev`):

```sh
KEY="sk_$(openssl rand -hex 32)"
HASH=$(printf %s "$KEY" | sha256sum | cut -d' ' -f1)
pnpm exec wrangler d1 execute DB --remote --command \
  "INSERT INTO api_keys (id, name, hash, created_at) VALUES ('k_$(openssl rand -hex 6)', 'bootstrap', '$HASH', unixepoch() * 1000)"
echo "$KEY"   # shown once; only the hash is stored
```

## CLI

Download a binary from [Releases](https://github.com/BUR4KBEY/shelf/releases), or `go install github.com/BUR4KBEY/shelf/cli/cmd/shelf@latest`.

```sh
shelf login                                  # server URL + API key, saved to ~/.config/shelf (0600)
shelf push plan.html                         # prints the link; pushing the same path again adds a version
shelf push ./report/ --project billing-poc   # a folder with an index.html, grouped with the rest of billing-poc
echo "$PW" | shelf push plan.md --slug q3-plan --password-stdin --expires 7d
shelf ls                                     # ★ favorites first, 🔒 locked; --project billing-poc for one project
shelf set q3-plan --fav --expires never
shelf get https://your-domain/view/q3-plan --password-stdin
shelf rm q3-plan
```

`SHELF_URL` and `SHELF_KEY` override the saved login. `--json` on `push`, `ls` and `set` prints machine-readable output.

## Agents

Agents don't need the CLI. Every deployment describes itself to them in two ways. The quickest start is **Copy agent instructions** when you mint a key in the dashboard.

An API key acts as you inside its space (see Spaces above): it can publish, read, change and delete that space's docs, password-protected ones included, unless the space's settings say otherwise. Give each agent its own key so you can revoke it alone.

- **`https://your-domain/llms.txt`**: a plain-text guide to reading and publishing with HTTP, with your domain filled in. Tell an agent "read https://your-domain/llms.txt and publish this; the key is in `$SHELF_KEY`".

  `llms.txt` and the `shelf-publish` skill tell agents to look for `SHELF_URL` and `SHELF_KEY` in the environment first, then in a `.env` at the project root, and to ask you only when neither has them. Export them in your shell profile: every MCP client below reads the environment, but only some read `.env`. A project `.env` still works for `llms.txt` and the CLI, e.g. to publish one project to another space or server.
- **`https://your-domain/mcp`**: an MCP server (Streamable HTTP) with the tools `publish`, `read_doc`, `list_docs`, `get_doc`, `update_doc` and `delete_doc`. It takes the same API key as the HTTP API, as `Authorization: Bearer <key>`. `read_doc` reads any doc in the key's space without its password, unless that is turned off for the space. Reference `SHELF_KEY` in the client's config instead of writing the key into it; the single quotes keep the variable unexpanded until Claude Code loads the config:

  ```sh
  claude mcp add --transport http shelf https://your-domain/mcp --header 'Authorization: Bearer ${SHELF_KEY}'
  ```

  Codex: `bearer_token_env_var = "SHELF_KEY"` under `[mcp_servers.shelf]`. OpenCode: `"Authorization": "Bearer {env:SHELF_KEY}"`. pi and omp: `"Authorization": "Bearer ${SHELF_KEY}"` in `mcp.json`.

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
| `slug` | Publish at `/view/<slug>`. 3 to 48 characters of `a-z`, `0-9` and `-` (the longest is set in the dashboard's Settings). A slug is guessable, so it requires a password. Slugs ignore case and are stored lowercase, so `/view/Q3-Plan` opens `q3-plan`. Pushing with a slug that exists updates that doc. |
| `password` | Readers must enter it (8+ chars). `null` removes it. |
| `expires` | A duration up to the longest expiry set in the dashboard's Settings (30 days unless changed): `30m`, `12h`, `7d`, `2w`, `30d`. `0` or `null` for never. Left out, a new doc gets the default from the dashboard's Settings (never unless set). Expired links return 410 and are deleted by a daily cron. |
| `title`, `message` | Shown in listings and version history. |

Pushing identical content creates no new version (`"created": false`). A push or blob upload over the key's quota fails with 413, unless the key deletes its oldest uploads to make room (set on the key's page).

A folder is a manifest with many paths and an `index.html`. Pages link to each other with relative paths.

### Manage docs

```sh
curl -H "Authorization: Bearer $KEY" $U/api/docs                          # list the key's space, favorites first
curl -H "Authorization: Bearer $KEY" $U/api/docs/<ref>                    # detail + version history
curl -H "Authorization: Bearer $KEY" $U/api/uploads                       # newest 200 uploads in the key's space
curl -X PATCH -H "Authorization: Bearer $KEY" -d '{"favorite":true,"expires":"7d"}' $U/api/docs/<ref>
curl -X DELETE -H "Authorization: Bearer $KEY" $U/api/docs/<ref>
curl -H "Authorization: Bearer $KEY" -d '{"ids":["<ref>","<ref>"],"delete":true}' $U/api/docs/bulk
```

`PATCH` takes the same `slug`, `password`, `expires` and `title` fields as push, plus `favorite`.

`/api/docs/bulk` acts on up to 200 docs (ids or slugs) at once, all or nothing: `"delete": true`, or `favorite`, `expires` and `project` to set on every one. If any doc isn't found, or the key's space may not delete, nothing changes.

`PATCH /api/docs/<ref>/versions` with `{"versions":[1,2],"disabled":true}` turns old versions off, and `false` turns them back on. The current version can't be turned off.

## What readers get

| URL | Serves |
|---|---|
| `/view/<id-or-slug>` | The latest version. Ids and slugs ignore case. A folder redirects to `/view/<ref>/` so relative links work. |
| `/view/<ref>@3` | Version 3, pinned. A version its owner turned off answers 410 here, and the doc's own link keeps serving the current version. |
| `/view/<ref>/guide` | `guide.html` in a folder; `/docs/` serves `docs/index.html`. |
| `?raw` | Markdown source instead of the rendered page. |

- HTML, SVG, rendered Markdown and every other type except PDF get a sandbox CSP with an opaque origin. Inline scripts run, but they can't reach cookies, storage, the network, forms or frames.
- PDFs, images, audio, video, text, CSS and JS are served inline. Any other type downloads.
- Range requests work, so video seeking works.
- Password docs show a password form. The unlock lasts 30 days, until the password changes. Agents send `X-Doc-Password: <password>` instead. Password attempts are limited to 10 per minute per IP and doc.
- A missing or expired link shows a short page in a browser and one line of plain text to anything else (curl, an agent). These pages, the password form and rendered Markdown use the dashboard's colours and font, which the Worker serves at `/font/`.
- The password form and those short pages have a theme switch (System, Light, Dark). It is a link to `/theme/<name>`, which sets a `theme` cookie; the dashboard's switch sets the same cookie, and rendered Markdown follows it.
- You skip the form when you open a doc from the dashboard, or use the form's "Open it from the dashboard" link while signed in to Access (`/dashboard/open/<ref>` sets the unlock cookie, then redirects to `/view/<ref>`).
- Nothing is indexed by search engines: every page from `/view` carries `X-Robots-Tag: noindex`, and `/robots.txt` disallows everything. With link previews on (Settings), it allows chat apps' preview crawlers into `/view/` only.

## Develop

The dev shell is managed with [devenv](https://devenv.sh). It provides Node 26 (LTS), pnpm and Go 1.27, and installs the Worker's packages on entry.

```sh
devenv up -d      # Worker on :8787 (the next free port in another worktree), dashboard signed in as you@localhost
devenv down
devenv test       # everything CI checks: worker typecheck and tests, the preview build, cli gofmt, vet and tests
```

Entering the shell installs git hooks that run gofmt, `go vet`, the Worker typecheck and nixfmt on staged files before each commit. The hooks carry their own Go, Node and pnpm, so `git commit` works from any shell once the worktree has entered devenv (`devenv shell -- true`).

### PR previews

Each pull request from a branch in this repo gets a [Worker Preview](https://developers.cloudflare.com/workers/previews/) at `https://pr-<number>-shelf.<subdomain>.workers.dev`, commented on the PR and deleted when it closes (`.github/workflows/preview.yml`). Previews use their own `shelf-preview` R2 bucket and D1 database, never production data.

Pull requests from forks never deploy on their own: the preview runs the PR's code with the Cloudflare token. Review the code, then comment `/deploy-preview <sha>` on the PR with the commit you reviewed (7+ characters; only the repo owner's comments count). It deploys only if that commit is still the PR's head, so a push after your review can't slip in. You can also run Actions → preview → **Run workflow** with the PR number and SHA. Push new commits and you have to deploy again. The preview is deleted when the PR closes.

Every deploy sets a `preview` commit status: pending while it deploys, then success with the preview's URL, or failure. Make `preview` a required status check in the `main` ruleset, and fork PRs wait as *Expected* until you deploy them.

To set it up on your own deployment:

1. Create the bucket and database (`pnpm exec wrangler r2 bucket create shelf-preview`, `pnpm exec wrangler d1 create shelf-preview`) and put the database ID in `previews.d1_databases` in `wrangler.jsonc` and in `wrangler.preview-migrations.jsonc`.
2. Create an account API token limited to this account with *Workers* → **Editor** scoped to the `shelf` Worker only, and *D1* → **Edit**. It needs no R2 permission: deploying a binding doesn't need access to the bucket. D1 can't be scoped to one database yet, so the token can still edit every D1 database in the account; that is why fork PRs only deploy by hand. Add it and the account ID as repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. For the dashboard to work in previews, protect the Worker's previews with Access: Workers & Pages → shelf → Access → **Protect this Worker behind Access** → *Previews only*. Then set `previews.vars` in `wrangler.jsonc`: `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`) and `ACCESS_AUD` (the Access app's audience tag). Cloudflare doesn't set `ctx.access` on preview URLs, so the Worker checks the Access token itself.

### Try-it preview

[shelf.gh-previews.burakbey.dev](https://shelf.gh-previews.burakbey.dev) is a static site on GitHub Pages, unrelated to PR previews. A service worker runs the real Worker code from `src/` in the visitor's browser: D1 becomes SQLite in memory ([sql.js](https://sql.js.org)), saved to IndexedDB after each change, and R2 objects live in IndexedDB. Nothing is sent anywhere, so every visitor has their own shelf. It starts with sample data (`worker/preview/seed.ts`) and a banner that is always shown, whose **Reset** brings the sample back. Uploads work from the dashboard only: `/api/*` and `/mcp` answer 403. Docs are served without the `sandbox` CSP, because a sandboxed page's own requests (a folder's CSS and links) don't reach the service worker.

Everything lives in `worker/preview/`; production code doesn't change. `pnpm run build:preview` writes the site to `worker/preview/dist`, and `.github/workflows/pages.yml` deploys it on every push to `main`. To serve it yourself: in the repo's Settings → Pages, set the source to *GitHub Actions* and the custom domain (a CNAME record pointing at `<user>.github.io`), then tick *Enforce HTTPS*.

## License

MIT
