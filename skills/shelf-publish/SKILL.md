---
name: shelf-publish
description: Use when the user wants a shareable link for a document, plan, report, mock or file, or asks to publish or share something with shelf.
---

# Publish with shelf

`shelf` publishes a file or folder to the user's own server and prints a link.
Run `shelf` if it is on PATH; if it is not, tell the user to install it (see the
shelf README) and stop.

## Steps

1. **Write the document.** For HTML, follow the page rules below. Markdown,
   PDFs, images and other files can be published as they are.
2. **Publish:** `shelf push <path> --json`. Check the exit code. The link is
   published only when you have a JSON receipt with a `url`.
   - Lock it for other people: `--password-stdin`, with the password on stdin.
     A custom name (`--slug q3-plan`) always needs a password.
   - Make the link expire: `--expires 7d` (`m`, `h`, `d`, `w`).
   - Describe the change: `-m "what changed"`.
3. **Report** the `url`, plus the `versionUrl` when the reader should see
   exactly this version. With `"created": false` the content was identical and
   no new version was made.

To update the page later, push the same path again from the same machine. From
another machine, use the same `--slug`, or run `shelf set`/`shelf push` with
the doc id. Use `--new` only when the user wants a separate link.

## Page rules (the server enforces these)

Pages are served in a sandbox with no origin:

- Inline `<script>` and `<style>` work. External scripts don't.
- `fetch`, XHR, WebSockets, `localStorage`, cookies, forms and iframes are all
  blocked. Keep state in memory or in `location.hash`, and put data in a
  `<script type="application/json">` block.
- Images, fonts, video and stylesheets can load from https URLs or `data:`.
- A folder can hold its own assets. Push the folder: it needs an `index.html`,
  and pages link to each other with relative paths (`href="details.html"`,
  `src="img/chart.png"`).
- Links with `target="_blank"` work; add `rel="noopener noreferrer"`.
- No secrets, tokens or local file paths in the page. A password protects
  readers' access, not what the server stores.
