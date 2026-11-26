# Deploy

## Cloudflare

Either click [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/BUR4KBEY/shelf/tree/main/worker), which creates the Worker, R2 bucket and D1 database in your account, or deploy from a clone:

```sh
cd worker
pnpm install
pnpm exec wrangler login
pnpm run deploy    # applies D1 migrations, then deploys; the first run deploys once before, to create the bucket and database
```

Then, in the Cloudflare dashboard:

1. **Add a custom domain** to the `shelf` Worker (Workers & Pages → shelf → Settings → Domains & Routes).
2. **Protect the dashboard with Cloudflare Access.** With an API token that has *Access: Apps and Policies → Edit* and *Workers Scripts → Edit*:

   ```sh
   CLOUDFLARE_API_TOKEN=... pnpm run setup:access -- --domain your-domain --email you@example.com
   ```

   It creates (or updates) an allow-policy for your email and an Access app for `your-domain/dashboard`, then stores that app's audience tag on the Worker as the `ACCESS_AUD` secret. Rerun it to change the emails. The Worker refuses `/dashboard` unless *this* Access app signed the request in: `workers.dev` URLs can't reach it, and neither can people another Access app on the same domain lets in. Until the script has run, the dashboard says to run it.

`/view/*` and `/api/*` stay public. Readers need the link (and the password if you set one), and the API needs a key.

## Docker

No Cloudflare account needed: one container runs the same Worker code on [Bun](https://bun.sh), with docs in a SQLite file and their files on disk, both under `/data`. Images for `linux/amd64` and `linux/arm64` are published with every release, tagged like the CLI (`1.2.3`, `1.2` and `latest`):

```sh
docker run -d --name shelf -p 8080:8080 -v shelf-data:/data \
  -e SHELF_PASSWORD='a long password' \
  ghcr.io/bur4kbey/shelf:latest
```

Open `http://localhost:8080/dashboard` and sign in with `SHELF_PASSWORD`; that password is what Cloudflare Access does on Cloudflare. **Sign out** (next to your name at the bottom of the sidebar) signs every browser out, including any copy of the cookie someone else holds: it replaces the session key in the data volume. Everything else (the API, the CLI, MCP, `/view`) works as on Cloudflare: point the CLI at your URL.

| Variable | |
|---|---|
| `SHELF_PASSWORD` | Required, 12 characters or more. Signs you in to the dashboard for 30 days; changing it signs every browser out. |
| `SHELF_TRUST_PROXY` | `1` behind a reverse proxy (Caddy, nginx, Traefik, a Cloudflare Tunnel): the client's IP, scheme and host come from `X-Forwarded-For` (its last entry), `X-Forwarded-Proto` and `X-Forwarded-Host`. Leave it off when the port is reachable without the proxy, or anyone can forge them. When it's off and a request comes through a proxy anyway, the log says so once. |
| `SHELF_EMAIL` | Shown in the dashboard's sidebar (`owner` unless set). |
| `PORT` | `8080` unless set. |

Serve it over HTTPS behind a reverse proxy with `SHELF_TRUST_PROXY=1`: the sign-in cookie, the CSRF check and the links shelf hands out all follow the URL the browser used. The daily cleanup runs on the same schedule as on Cloudflare (`triggers.crons` in `worker/wrangler.jsonc`). Back up the `/data` volume, or use **Backup** in the dashboard's Settings, which also moves a shelf between Cloudflare and Docker in either direction. The volume holds `shelf.db` (with its `-wal` and `-shm` files), `blobs/` and `session.key`, which signs sign-in cookies; the container runs as uid 1000, so a bind-mounted directory must be writable by it.

To build it yourself: `docker build -t shelf worker`. The server is `worker/selfhost/server.ts`, and `worker/selfhost/store.ts` stands in for D1, R2 and the rate limiter. `bun selfhost/build.ts` (after `pnpm run build`) bundles it into `selfhost/dist/server.js`, and `bun test selfhost` tests the stand-ins.

## First API key

Mint keys in the dashboard under **Keys**. Without Access set up yet, you can insert one with wrangler instead (use `--local` instead of `--remote` for `pnpm run dev`):

```sh
KEY="sk_$(openssl rand -hex 32)"
HASH=$(printf %s "$KEY" | sha256sum | cut -d' ' -f1)
pnpm exec wrangler d1 execute DB --remote --command \
  "INSERT INTO api_keys (id, name, hash, created_at) VALUES ('k_$(openssl rand -hex 6)', 'bootstrap', '$HASH', unixepoch() * 1000)"
echo "$KEY"   # shown once; only the hash is stored
```
