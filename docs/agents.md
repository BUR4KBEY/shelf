# Agents

Agents don't need the CLI. Every deployment describes itself to them in two ways. The quickest start: when you create a key in the dashboard, click **Copy agent instructions** and paste the text into your agent. It asks your approval to save `SHELF_URL` and `SHELF_KEY` in your shell profile, then connects itself through `llms.txt` or MCP.

An API key acts as you inside its space (see [Spaces](dashboard.md)): it can publish, read, change and delete that space's docs, password-protected ones included, unless the space's settings say otherwise. Give each agent its own key so you can revoke it alone.

- **`https://your-domain/llms.txt`**: a plain-text guide to reading and publishing with HTTP, with your domain filled in. Tell an agent "read https://your-domain/llms.txt and publish this; the key is in `$SHELF_KEY`".

  `llms.txt` and the `shelf-publish` skill tell agents to look for `SHELF_URL` and `SHELF_KEY` in the environment first, then in a `.env` at the project root, and to ask you only when neither has them. Export them in your shell profile: every MCP client below reads the environment, but only some read `.env`. A project `.env` still works for `llms.txt` and the CLI, e.g. to publish one project to another space or server.
- **`https://your-domain/mcp`**: an MCP server (Streamable HTTP) with the tools `publish`, `read_doc`, `list_docs`, `get_doc`, `update_doc` and `delete_doc`. It takes the same API key as the HTTP API, as `Authorization: Bearer <key>`. `read_doc` reads any doc in the key's space without its password, unless that is turned off for the space. Reference `SHELF_KEY` in the client's config instead of writing the key into it; the single quotes keep the variable unexpanded until Claude Code loads the config:

  ```sh
  claude mcp add --transport http shelf https://your-domain/mcp --header 'Authorization: Bearer ${SHELF_KEY}'
  ```

  Codex: `bearer_token_env_var = "SHELF_KEY"` under `[mcp_servers.shelf]`. OpenCode: `"Authorization": "Bearer {env:SHELF_KEY}"`. pi and omp: `"Authorization": "Bearer ${SHELF_KEY}"` in `mcp.json`.

  **Only an API key, no OAuth.** Clients that can only sign in with OAuth, such as claude.ai and ChatGPT connectors, can't connect. Use a client that lets you set a header (Claude Code, Codex, Cursor, Claude Desktop through `mcp-remote`), or `llms.txt`. `publish` sends file contents through the model's context, so use the CLI or curl for large files.

[`skills/shelf-publish`](../skills/shelf-publish/SKILL.md) lets an agent write a page and publish it, with the CLI when it is installed and with MCP or `llms.txt` when it isn't. [`skills/shelf-read`](../skills/shelf-read/SKILL.md) lets it read a shelf link someone gives it. Copy them into your agent's skills directory (for example `~/.claude/skills/`).
