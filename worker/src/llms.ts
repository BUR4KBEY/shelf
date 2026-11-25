/** GET /llms.txt: how an agent uses this server with nothing but HTTP. Every URL in it is this server's own origin. */
export const llmsTxt = (origin: string) => `# shelf

> ${origin} is a shelf server. It publishes a file or folder and returns a link to share. Anyone with the link (and the password, if set) can read it. Publishing needs an API key from the owner.

There are two ways to use it without installing anything:

- **MCP:** connect to \`${origin}/mcp\` (Streamable HTTP) with the header \`Authorization: Bearer <key>\`. Tools: publish, read_doc, list_docs, get_doc, update_doc, delete_doc.
- **HTTP:** the API below, with curl or any HTTP client.

If you have no key, ask the user for one. They mint keys in ${origin}/dashboard under Keys. Never put the key in a page you publish.

## Read a link

\`GET ${origin}/view/<ref>\` returns the file as it is; no key is needed.

- \`/view/<ref>@3\` is version 3. \`/view/<ref>/page\` is \`page.html\` in a folder; a folder itself redirects to \`/view/<ref>/\`.
- Add \`?raw\` to a Markdown doc to get the source instead of rendered HTML.
- Password-protected: send \`X-Doc-Password: <password>\`. Ask the user for it on HTTP 401.
- 410 means the link expired, 404 that it was deleted or never existed.
- The \`X-Shelf-Version\` response header is the version you read.

## Publish

Push a manifest of paths and SHA-256 hashes. If the server lacks any of those files, it answers \`{"missing": [<sha256>...]}\`; upload each one, then send the same manifest again.

\`\`\`sh
KEY=...                     # the API key
SHA=$(sha256sum plan.html | cut -d' ' -f1)
M="{\\"files\\":[{\\"path\\":\\"plan.html\\",\\"sha256\\":\\"$SHA\\"}]}"
curl -sS -H "Authorization: Bearer $KEY" -d "$M" ${origin}/api/push                               # {"missing":["<sha>"]}
curl -sS -X PUT -H "Authorization: Bearer $KEY" --data-binary @plan.html ${origin}/api/blobs/$SHA  # 204
curl -sS -H "Authorization: Bearer $KEY" -d "$M" ${origin}/api/push                               # the receipt
\`\`\`

Errors come back as \`{"error": "..."}\` with a 4xx status.

The receipt has \`id\`, \`url\`, \`versionUrl\`, \`version\` and \`created\`. Give the user \`url\`, or \`versionUrl\` for this exact version. \`"created": false\` means the content was identical and no new version was made.

A folder is a manifest with many paths and an \`index.html\`; pages link to each other with relative paths. Optional push fields:

- \`ref\`: id or slug of an existing doc; the push becomes its next version. Use it to update a doc.
- \`slug\`: publish at \`/view/<slug>\`. A slug requires a password.
- \`password\`: readers must enter it (8+ characters). \`null\` removes it.
- \`expires\`: \`30m\`, \`12h\`, \`7d\`, \`2w\`, up to the owner's limit (30 days unless changed); \`0\` or \`null\` for never. Left out, a new doc gets the owner's default.
- \`title\`, \`message\`: shown in listings and version history.
- \`project\`: groups docs in your space, e.g. one per thing you build (up to 64 characters). It exists as long as a doc names it, so there is nothing to create first. Reuse a name \`GET /api/docs\` already shows (case doesn't matter; the existing spelling is kept). A new version keeps the doc's project unless you send one; \`""\` or \`null\` removes it.

## Quota

The owner may cap how many bytes your key keeps on the shelf. Every version it uploaded that still exists counts in full; expired and deleted docs free room. Over the cap, the owner picks what happens:

- **Refuse:** the push or blob upload answers 413 with \`{"error": "quota: ..."}\`. Tell the user; retrying won't help until they raise the quota or delete docs.
- **Delete oldest:** the server deletes this key's oldest uploads until the new one fits, so older links you shared may stop working. Favorites are kept. An upload bigger than the whole quota still gets 413.

Identical content (\`"created": false\`) costs nothing.

## Page rules

HTML and SVG are served in a sandbox with an opaque origin:

- Inline \`<script>\` and \`<style>\` work; external scripts don't.
- fetch, XHR, WebSockets, localStorage, cookies, forms and iframes are blocked. Put data in a \`<script type="application/json">\` block.
- Images, fonts, video and stylesheets load from https URLs, \`data:\` or the doc's own folder.
- No secrets, tokens or local file paths in a page.

## Manage docs

Your key belongs to one space, chosen by the owner. It sees and changes only that space's docs: another space's doc answers 404, and a slug another space uses answers 409 ("slug is taken"). The owner may also stop a space's keys from deleting (403).

\`\`\`sh
curl -sS -H "Authorization: Bearer $KEY" ${origin}/api/docs                 # list, favorites first; ?project=<name> for one project
curl -sS -H "Authorization: Bearer $KEY" ${origin}/api/docs/<ref>           # detail and version history
curl -sS -X PATCH -H "Authorization: Bearer $KEY" -d '{"expires":"7d"}' ${origin}/api/docs/<ref>
curl -sS -X DELETE -H "Authorization: Bearer $KEY" ${origin}/api/docs/<ref>
\`\`\`

PATCH takes \`slug\`, \`password\`, \`expires\`, \`title\`, \`project\` and \`favorite\`.
`;
