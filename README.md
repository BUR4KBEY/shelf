# shelf

Publish a file or folder to your own Cloudflare account and get a link you can share. A minimal, self-hosted take on [postplan](https://www.npmjs.com/package/postplan).

> Work in progress. The Worker and HTTP API are done. The dashboard, Go CLI and agent skills are next.

## Run locally

The dev shell is managed with [devenv](https://devenv.sh). It provides Node 22.

```sh
cd worker
devenv shell -- npm install
devenv shell -- npm run dev      # applies D1 migrations, serves on :8787
devenv shell -- npm test
```

## Deploy

```sh
cd worker
npx wrangler login
npm run deploy                   # creates the R2 bucket and D1 database on first deploy
```

## Create an API key

Until the dashboard exists, insert a key's hash by hand (`--local` instead of `--remote` for dev):

```sh
KEY="sk_$(openssl rand -hex 32)"
HASH=$(printf %s "$KEY" | sha256sum | cut -d' ' -f1)
npx wrangler d1 execute DB --remote --command \
  "INSERT INTO api_keys (id, name, hash, created_at) VALUES ('k_$(openssl rand -hex 6)', 'bootstrap', '$HASH', unixepoch() * 1000)"
echo "$KEY"   # shown once; only the hash is stored
```

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

## License

MIT
