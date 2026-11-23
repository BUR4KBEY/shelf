# shelf

Publish a file or folder to your own Cloudflare account and get a link you can share. A minimal, self-hosted take on [postplan](https://www.npmjs.com/package/postplan).

> Work in progress. The Worker, HTTP API, Go CLI and agent skills work. The dashboard API works, but its page is a placeholder for now.

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
2. **Protect the dashboard with Cloudflare Access.** Zero Trust → Access → Applications → add a self-hosted app for `your-domain/dashboard`. Its policy should allow only your own email. The Worker refuses `/dashboard` unless Access signed the request in, so `workers.dev` URLs can't reach it.

`/view/*` and `/api/*` stay public. Readers need the link (and the password if you set one), and the API needs a key.

## Create an API key

Until the dashboard page lands, insert a key's hash with wrangler (use `--local` instead of `--remote` for `npm run dev`):

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

## Agent skills

[`skills/shelf-publish`](skills/shelf-publish/SKILL.md) lets an agent write a page and publish it with the CLI. [`skills/shelf-read`](skills/shelf-read/SKILL.md) lets it read a shelf link someone gives it. Copy them into your agent's skills directory (for example `~/.claude/skills/`).

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
| `slug` | Publish at `/view/<slug>`. A slug is guessable, so it requires a password. Pushing with a slug that exists updates that doc. |
| `password` | Readers must enter it (8+ chars). `null` removes it. |
| `expires` | `30m`, `12h`, `7d`, `2w`; `null` for never. Expired links return 410 and are deleted by a daily cron. |
| `title`, `message` | Shown in listings and version history. |

Pushing identical content creates no new version (`"created": false`).

A folder is a manifest with many paths and an `index.html`. Pages link to each other with relative paths.

### Manage docs

```sh
curl -H "Authorization: Bearer $KEY" $U/api/docs                          # list, favorites first
curl -H "Authorization: Bearer $KEY" $U/api/docs/<ref>                    # detail + version history
curl -X PATCH -H "Authorization: Bearer $KEY" -d '{"favorite":true,"expires":"7d"}' $U/api/docs/<ref>
curl -X DELETE -H "Authorization: Bearer $KEY" $U/api/docs/<ref>
```

`PATCH` takes the same `slug`, `password`, `expires` and `title` fields as push, plus `favorite`.

## What readers get

| URL | Serves |
|---|---|
| `/view/<id-or-slug>` | The latest version. A folder redirects to `/view/<ref>/` so relative links work. |
| `/view/<ref>@3` | Version 3, pinned. |
| `/view/<ref>/guide` | `guide.html` in a folder; `/docs/` serves `docs/index.html`. |
| `?raw` | Markdown source instead of the rendered page. |

- HTML, SVG, rendered Markdown and every other type except PDF get a sandbox CSP with an opaque origin. Inline scripts run, but they can't reach cookies, storage, the network, forms or frames.
- PDFs, images, audio, video, text, CSS and JS are served inline. Any other type downloads.
- Range requests work, so video seeking works.
- Password docs show a password form. The unlock lasts 30 days, until the password changes. Agents send `X-Doc-Password: <password>` instead. Password attempts are limited to 10 per minute per IP and doc.

## Develop

The dev shell is managed with [devenv](https://devenv.sh). It provides Node 22 and Go.

```sh
devenv shell -- sh -c 'cd worker && npm install && npm run dev'   # :8787, dashboard signed in as you@localhost
devenv shell -- sh -c 'cd worker && npm test && npm run typecheck'
devenv shell -- sh -c 'cd cli && go test ./...'
```

## License

MIT
