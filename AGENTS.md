# AGENTS.md

Instructions for AI agents working on shelf. People are welcome to read it too.

## The project

shelf publishes files and folders and serves them at shareable links. One codebase runs in three places:

| Where | Entry | Bindings come from |
|---|---|---|
| Cloudflare | `worker/src/index.ts` | D1, R2 and the rate limiter, configured in `worker/wrangler.jsonc` |
| Docker | `worker/selfhost/server.ts` | `worker/selfhost/store.ts`: SQLite file, files on disk, in-memory limiter |
| Live demo (GitHub Pages) | `worker/preview/sw.ts` | `worker/preview/shims.ts`: sql.js and IndexedDB, in the visitor's browser |

| Path | What it is |
|---|---|
| `worker/src/` | The Worker: HTTP API (`api.ts`), MCP server (`mcp.ts`), `llms.txt` (`llms.ts`), reader pages (`view.ts`, `page.ts`), backup (`backup.ts`), auth (`auth.ts`, `access.ts`) |
| `worker/dashboard/` | The dashboard: React, shadcn/ui, Tailwind and Motion, built by Vite into `worker/src/dashboard.html` (generated, not committed) |
| `worker/migrations/` | D1 migrations, applied in file-name order |
| `worker/test/` | Vitest tests that run against the Worker in workerd |
| `cli/` | The Go CLI (`cli/cmd/shelf`) |
| `skills/` | Agent skills shipped to users: `shelf-publish`, `shelf-read` |
| `docs/` | User documentation. The README is the product page and links here |

## Setup and checks

The dev shell is [devenv](https://devenv.sh). It provides Node, pnpm, Bun and Go at the versions CI uses.

```sh
devenv shell -- true   # once per worktree: installs the git hooks
devenv up -d           # local Worker; the dashboard signs you in as you@localhost
devenv test            # the Worker, dashboard and CLI checks from CI (selfhost: see below)
```

Run only what covers your change:

| Changed | Run |
|---|---|
| `worker/src/`, `worker/test/` | `cd worker && pnpm run typecheck && pnpm test` |
| `worker/dashboard/` | `cd worker && pnpm run typecheck:dashboard && pnpm test` |
| `worker/preview/`, or an import in `src/` | `cd worker && pnpm run typecheck:preview && pnpm run build:preview` |
| `worker/selfhost/` | `cd worker && bun test selfhost` |
| `cli/` | `cd cli && gofmt -l . && go vet ./... && go test ./...` |

Pre-commit hooks run gofmt, `go vet`, the Worker typechecks and nixfmt. Don't skip them.

## Keep these in sync

- **Bindings:** a new D1 query shape, R2 call or binding in `src/` must work in `selfhost/store.ts` and `preview/shims.ts` too.
- **Schema:** change the database only with a new migration file, numbered one past the highest (`0012_…`). Never edit or rename an applied one: D1 tracks them by file name. Backup and import (`backup.ts`) must handle the new columns.
- **Agent surfaces:** a change to the HTTP API also updates `mcp.ts` (each tool calls the API handler it mirrors), `llms.ts`, the CLI where it applies, `skills/`, and `docs/api.md` or `docs/agents.md`.
- **Look:** colours and fonts live in `dashboard/src/index.css` and are mirrored in `src/page.ts`. The logo in `src/favicon.svg` matches `Logo` in `dashboard/src/components/bits.tsx`.
- **Docs:** a change people can see updates `docs/` in the same PR, and the README when it changes what shelf is or how to start.

## Security rules

- Every `/api` and `/mcp` request is scoped to its key's space (unless the owner turns off *Keep spaces apart*). Never let a key reach docs its space can't.
- Served docs keep the sandbox CSP. Don't loosen it to make a doc work.
- Store only hashes of API keys and passwords.
- The dashboard trusts only Cloudflare Access (or the self-host password). Never add another way in.

## Commits and PRs

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, lowercase and imperative. Scopes in use: `worker`, `dashboard`, `cli`, `selfhost`, `release`, `nix`, `devenv`.
- PRs merge with rebase-merge, so each commit lands on `main` as written. Keep commits small and each one working.
- Each PR from this repo gets a preview deploy. Every PR includes evidence from your own run, as the PR template asks: screenshots (before and after) or a video for anything visible, command output for the CLI, API, MCP and self-host.
