# shelf

Publish a file or folder to your own Cloudflare account and get a link you can share. A minimal, self-hosted take on [postplan](https://www.npmjs.com/package/postplan).

> Work in progress. What exists today: API key auth, uploads, and serving single files.

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
curl -H "Authorization: Bearer $KEY" -d "$M" $U/api/push                 # {"id","version","url"}
```

To publish a new version of an existing doc, add `"ref":"<id>"` to the manifest.

## What readers get

`/view/<id>` serves the latest version.

- HTML, SVG and everything else except PDF are served under a sandbox CSP with an opaque origin. Inline scripts run, but they can't reach cookies, storage, the network, forms or frames.
- PDFs, images, audio, video, text, CSS and JS are served inline.
- Any other file type downloads.
- Range requests work, so video seeking works.

## License

MIT
