# Offline gallery — Foliuna 0.4.0

Open **Gallery** after choosing an archive folder in Settings. It searches saved media and captured metadata without an API key or provider connection. **Refresh gallery** picks up newly completed downloads. Grid style, numbered pages/infinite scrolling, detail navigation, tag actions/favorites and the separate/fullscreen viewer are shared with Discover.

One card represents one SHA-256 asset, even if multiple posts point to the same bytes. Details identify the selected captured source and list its other provider/post identities. Use a provider/ID filter to inspect a particular source. Ratings/tags are the latest saved capture for each source; old captures remain in SQLite and the sidecar. Gallery does not refresh tags or ratings from the internet.

## Query grammar

Use space-separated terms. Every term must match the **same source record**, and an asset appears if any source matches. Exact tags are case-sensitive; site tags normally use lowercase. An initial `-` excludes a term. Up to 40 terms/512 characters are accepted.

| Term | Meaning |
| --- | --- |
| `fox -wolf` | Has fox and does not have wolf |
| `artist:artist_name` | Tag in the artist category |
| `character:name`, `species:fox` | Exact categorized tag |
| `copyright:name`, `general:forest`, `meta:tag`, `lore:tag`, `invalid:tag` | Other supported categories |
| `provider:e621`, `provider:danbooru`, `provider:rule34`, `provider:custom-<id>`, `provider:e926` | Exact preserved source ID, including custom sites and retired e926 identities |
| `rating:s`, `rating:q`, `rating:e` | Captured normalized rating; modern Sensitive is grouped under q, with the original label preserved in details |
| `source:example.org` | Literal substring in the canonical post URL or captured source URLs; `%`/`_` are not wildcards |
| `type:png`, `type:webm` | Captured file extension |
| `id:123` | Source post ID |

Safe-only replaces rating terms with `rating:s`. Select **All ratings** to query other ratings. There is no OR/grouping/quoting syntax. Wildcards and unsupported colon filters such as `fav:`/`order:`/`limit:` report an error; other text is treated as literal tag names. Suggestions use only local indexed tags. Results use 24 assets per page; the offline page bound is 1,000,000, independent of the live API's page limit.

## Media and thumbnails

All image/video/Flash sources are hash-registered local routes. A missing or damaged original is never fetched from the provider automatically. Explicit **Open source post** can open the canonical website in your browser; ordinary gallery use needs no network.

The first visible image or video frame generates a proportion-preserving PNG thumbnail up to 512 pixels per side inside the sandboxed renderer. Derived files live in `.foliuna/thumbnails/`, do not change originals and can be regenerated. GIFs animate from the local original when visible. Video previews read a local first frame without playing audio; details expose playback controls. SWFs have a Flash indicator and an explicit isolated Ruffle player, with external assets/navigation blocked. Unsupported formats/codecs/Flash features can fail, and large originals may take time to buffer. Sample and Full size in offline still-image details both fit the saved original; no separate remote sample is needed.

## Import or restore an index

1. Put original files and their adjacent `.foliuna.json` sidecars in the selected archive folder or a subfolder. A sidecar's `asset.mediaFile` must name its adjacent original, with no directory/absolute/device path.
2. Choose **Import sidecars**. The app inventories existing sidecars, validates schema v1, source identities, dates, categories/tags, media type, byte count and SHA-256, then creates canonical `media/<sha256>.<extension>` copies without replacing files.
3. Review the report. **Imported** counts verified sidecars, including unchanged/repeated copies; the library count reflects unique assets. Identical capture histories are not duplicated. Existing newer/equal-time latest metadata remains current; valid canonical sidecar history is merged before that sidecar is rewritten. Input originals and extra input sidecars remain in place.

Moving the **whole library folder** needs only selecting its new location. If its index is missing, Foliuna creates an empty compatible index and Import sidecars reconstructs it from verified files. A corrupt or unknown-version database is preserved and refused; Foliuna does not delete/reset it. Keep the old folder safe, select a new archive folder, and copy originals/sidecars there for restoration if necessary. Credentials remain in the application profile and are not imported.

An invalid schema, link, path, hash, size, tag history or destination produces an issue without erasing the original. Different bytes for an existing provider/post are a **revision conflict**: the earlier capture remains in Gallery. Select a different archive folder to retain the new revision too; automatic replacement is not supported.

## Check moved or missing files

**Check library files** verifies indexed originals and sidecars. It can recover a renamed/moved original found within the selected folder by SHA-256, creating a verified canonical copy and leaving the found candidate intact. It recreates an absent sidecar from committed history when the original verifies. Existing invalid/conflicting originals and sidecars are preserved and reported.

Missing originals keep their metadata, tags and source identities, and may retain a cached thumbnail. Restore the original from a backup or place a matching copy under the selected folder and run the check again. No entries or files are deleted by this maintenance action. **Stop library task** stops at file boundaries; completed imports/recoveries remain, and a current finalization can finish.

## Bounds and storage limits

- Scans skip links and dot folders (including `.foliuna`), descend at most eight levels and stop after 100,000 entries. Reports show at most 50 individual file issues.
- Originals are capped at 100 MiB. Sidecars are capped at 16 MiB, 100 sources, 1,000 captures per source and 2,000 tags per category/capture. Oversized histories are refused/preserved rather than truncated.
- Local media reads have two active transfers, a 48-item waiting queue and a 128 MiB/256-entry memory cache. File identity/size/timestamps invalidate cached data; original bytes are checked against SHA-256 before first use for that file state.
- Hard-link publication is preferred; filesystems without links use flushed exclusive copies and verification. A crash may leave a partial destination. Foliuna retains the conflict and the prepared download staging file. Close the app, preserve/move the conflicting destination aside, then choose the same archive folder to retry recovery. This never requires overwriting the conflict.
- Actual exFAT devices and physical power-loss recovery have not been tested. Keep backups and avoid unplugging a drive during writes. Long infinite sessions retain loaded cards; windowing very large sessions is future performance work.

## Collections

Open saved post details → Manage collections to add or remove its SHA-256 identity from named local collections. Create and browse them from Collections in the sidebar; search/layout/details/playback reuse this Gallery implementation. Collection counts include non-safe and missing entries even if current filters hide them. Collections membership lives separately in .foliuna/collections.json, so copy the entire library, including .foliuna, for portability. See COLLECTIONS.md.
