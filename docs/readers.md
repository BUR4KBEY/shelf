# What readers get

| URL | Serves |
|---|---|
| `/view/<id-or-slug>` | The latest version. Ids and slugs ignore case. A folder redirects to `/view/<ref>/` so relative links work. |
| `/view/<ref>@3` | Version 3, pinned. A version its owner turned off answers 410 here, and the doc's own link keeps serving the current version. |
| `/view/<ref>/guide` | `guide.html` in a folder; `/docs/` serves `docs/index.html`. |
| `?raw` | Markdown source instead of the rendered page. |

- HTML, SVG, rendered Markdown and every other type except PDF get a sandbox CSP with an opaque origin. Inline scripts run, but they can't reach cookies, storage, forms or frames, and can't fetch or connect anywhere. They can still load images from any https URL and open links, so a doc's script can send what it shows to another site: only share docs whose scripts you trust.
- PDFs, images, audio, video, text, CSS and JS are served inline. Any other type downloads.
- Range requests work, so video seeking works.
- Password docs show a password form. The unlock lasts 30 days, until the password changes. Agents send `X-Doc-Password: <password>` instead. Password attempts are limited to 10 per minute per IP and doc.
- A missing or expired link shows a short page in a browser and one line of plain text to anything else (curl, an agent). These pages, the password form and rendered Markdown use the dashboard's colours and font, which the Worker serves at `/font/`.
- The password form and those short pages have a theme switch (System, Light, Dark). It is a link to `/theme/<name>`, which sets a `theme` cookie; the dashboard's switch sets the same cookie, and rendered Markdown follows it.
- You skip the form when you open a doc from the dashboard, or use the form's "Open it from the dashboard" link while signed in to Access (`/dashboard/open/<ref>` sets the unlock cookie, then redirects to `/view/<ref>`).
- Nothing is indexed by search engines: every page from `/view` carries `X-Robots-Tag: noindex`, and `/robots.txt` disallows everything. With link previews on (Settings), it allows chat apps' preview crawlers into `/view/` only.
