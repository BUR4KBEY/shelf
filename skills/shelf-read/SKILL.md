---
name: shelf-read
description: Use when the user gives you a shelf link (a URL with /view/ in the path) to read.
---

# Read a shelf link

A shelf URL serves the uploaded file to any client, so fetch it with the
shell. A web tool that refuses the URL is a tool limit, not a shelf answer.

1. Drop any `#fragment`. Keep the path: `/view/<ref>@3` pins version 3, and
   `/view/<ref>/details` names one page of a folder.
2. Fetch into a fresh file. Add `?raw` for Markdown so you get the source, not
   rendered HTML. If the user gave you a password, add
   `-H "X-Doc-Password: <password>"`.

   ```sh
   out=$(mktemp -t shelf.XXXXXX) && curl --fail --silent --show-error --location --max-time 30 --dump-header "$out.headers" --output "$out" --write-out '%{url_effective}\n' '<url>' && echo "$out"
   ```

   It prints the final URL after redirects, then the file path.
3. Read the file. `X-Shelf-Version` in `$out.headers` is the version you read;
   mention it when the user may update the document later.
4. A folder redirects to a URL ending in `/`. Resolve the relative links you
   need against that final URL, not the one you were given, and fetch each one
   the same way.

HTTP 401 means the document is locked: ask the user for the password. 410
means the link expired. 404 means it was deleted or never existed. For any
other failure, report curl's actual status or error.
