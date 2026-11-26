# HTTP API

## Publish

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
| `slug` | Publish at `/view/<slug>`. 3 to 48 characters of `a-z`, `0-9` and `-` (the longest is set in the dashboard's Settings). A slug is guessable, so it requires a password. Slugs ignore case and are stored lowercase, so `/view/Q3-Plan` opens `q3-plan`. Pushing with a slug that exists updates that doc. |
| `password` | Readers must enter it (8+ chars). `null` removes it. |
| `expires` | A duration up to the longest expiry set in the dashboard's Settings (30 days unless changed): `30m`, `12h`, `7d`, `2w`, `30d`. `0` or `null` for never. Left out, a new doc gets the default from the dashboard's Settings (never unless set). Expired links return 410 and are deleted by a daily cron. |
| `title`, `message` | Shown in listings and version history. |

Pushing identical content creates no new version (`"created": false`). A push or blob upload over the key's quota fails with 413, unless the key deletes its oldest uploads to make room (set on the key's page).

A folder is a manifest with many paths and an `index.html`. Pages link to each other with relative paths.

## Manage docs

```sh
curl -H "Authorization: Bearer $KEY" $U/api/docs                          # list the key's space, favorites first
curl -H "Authorization: Bearer $KEY" $U/api/docs/<ref>                    # detail + version history
curl -H "Authorization: Bearer $KEY" $U/api/uploads                       # newest 200 uploads in the key's space
curl -X PATCH -H "Authorization: Bearer $KEY" -d '{"favorite":true,"expires":"7d"}' $U/api/docs/<ref>
curl -X DELETE -H "Authorization: Bearer $KEY" $U/api/docs/<ref>
curl -H "Authorization: Bearer $KEY" -d '{"ids":["<ref>","<ref>"],"delete":true}' $U/api/docs/bulk
```

`PATCH` takes the same `slug`, `password`, `expires` and `title` fields as push, plus `favorite`.

`/api/docs/bulk` acts on up to 200 docs (ids or slugs) at once, all or nothing: `"delete": true`, or `favorite`, `expires` and `project` to set on every one. If any doc isn't found, or the key's space may not delete, nothing changes.

`PATCH /api/docs/<ref>/versions` with `{"versions":[1,2],"disabled":true}` turns old versions off, and `false` turns them back on. The current version can't be turned off.
