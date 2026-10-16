# Booru connections

Choose **Discover → Booru source** before searching. Safe-only remains the default; selecting All ratings is explicit. Switching sources clears earlier results. Pagination, post navigation, image proportions, the media window, video/GIF/isolated Flash playback and original downloads use the selected connection. Gallery stays offline.

## Built-in connections

| Site | API family | Credentials | Safe query |
| --- | --- | --- | --- |
| e621 | e621 JSON | Optional username + API key, Basic header | `rating:s` |
| Danbooru | Danbooru JSON | Optional username + API key, Basic header | `rating:g` |
| Gelbooru | Gelbooru DAPI JSON | Numeric user ID + API key, query parameters; access may require them | `rating:general` |
| Rule34.xxx | Gelbooru DAPI JSON at api.rule34.xxx | Required numeric user ID + API key, query parameters | `rating:s` |
| Safebooru | Gelbooru DAPI JSON | Optional numeric user ID + API key | `rating:general` |
| AIBooru | Danbooru JSON | Optional username + API key, Basic header | `rating:g` |
| Yande.re | Moebooru JSON | Anonymous reads | `rating:s` |
| Konachan | Moebooru JSON | Anonymous reads | `rating:s` |

Safe-only removes competing rating terms, applies the site's query and filters returned ratings in main. Modern General ratings become Foliuna's safe rating. Sensitive becomes non-safe (`q`) for filtering, retaining its exact source rating and Sensitive label. Provider moderation/tags can be inaccurate; the filter follows the site's metadata. An empty page is possible, especially on explicit-focused sites.

e926 is retired from live access. Existing e926 archive identities and encrypted files remain intact and are never silently reused for e621.

## Credentials

Open **Settings → Booru connections → Connection**, select the site, then save its API credentials below. Rule34 and Gelbooru use the **numeric user ID**, not the username. Generate the Rule34 key in its Account → Options → API Access Credentials controls. Use the existing key for that account; Foliuna does not rotate keys or retry around access restrictions. Its [official API page](https://api.rule34.xxx/) describes authentication, limits, no-advertisement/paywall terms and the single-key rule. [Gelbooru's API documentation](https://gelbooru.com/index.php?page=wiki&s=view&id=18780) describes its user ID/key parameters and conditional authentication requirements.

API keys use Windows account encryption, are cleared from the input immediately and never read back into the UI. Basic credentials go in the HTTPS Authorization header. Query credentials are added only immediately before the exact configured API request; credential-free URLs identify caches. Media requests never contain API credentials, cookies or browser sessions. Removing credentials deletes the local entry; revoke a key at its site if needed. DPAPI cannot protect against other software running as the same Windows user.

**Test connection** makes one safe-rated metadata request. A valid JSON response proves the configured request worked; it does not prove every permission or endpoint is available. HTTP 401 means credentials may be required or rejected. Browser challenges, paid/account restrictions and geographical blocks are reported rather than bypassed. A key cannot promise to resolve all access restrictions.

## Custom Danbooru/Gelbooru sites

1. Open Settings → Booru connections → **Add or update a custom booru**.
2. Enter a display name and select **Danbooru JSON** or **Gelbooru DAPI JSON**.
3. Enter the public HTTPS site URL. If the API uses another host or directory, enter its **API base URL**. Omit endpoint filenames and query parameters: use `https://booru.org/api/`, not `.../api/posts.json`.
4. Choose Anonymous, username/API-key Basic, or numeric-ID/API-key query authentication according to that site's documentation. Foliuna does not accept account passwords, arbitrary headers, scripts or cookies.
5. Choose the site's safe rating: General (`g`) for modern APIs, Safe (`s`) for older APIs. This also determines whether `s` means Sensitive.
6. If images live elsewhere, enter each approved HTTPS media origin, such as `https://cdn.booru.org`. Separate origins with commas or new lines. The site origin is allowed automatically; API origins are not automatically trusted as media hosts.
7. Save the connection, add credentials if needed, test it and select it in Discover.

The Danbooru adapter uses `posts.json`, `posts/<id>.json` and `tags.json`; Gelbooru uses `index.php?page=dapi&s=post&q=index&json=1`, with zero-based `pid`. Both support a site/API base directory. Modern object-wrapped Gelbooru lists and older JSON arrays are supported. The separate built-in Moebooru adapter uses `post.json` and `id:` for details; it does not request password hashes. [Danbooru's maintained source](https://github.com/danbooru/danbooru), [Safebooru's DAPI help](https://safebooru.org/index.php?page=help&topic=dapi) and [Konachan's API help](https://konachan.com/help/api) describe their respective formats.

Custom IDs are stable hashes of engine + canonical site URL + canonical API URL. Renaming or adjusting approved media hosts updates that connection; changing either base URL creates a separate identity and does not reuse its saved key. **Edit connection** loads the selected custom definition. **Remove connection** deletes its configuration and encrypted credentials, preserving all downloaded media, metadata and Gallery entries. Adding the same original URLs again recovers the same identity.

Only public HTTPS origins on port 443 are supported. Main checks DNS and pins the approved public address to the TLS connection; private/local/IP-literal destinations and redirects are rejected. Media URLs must match the site's approved origins and a supported file extension. Old API-provided HTTP media links are upgraded to HTTPS on those origins; numeric cache-busting suffixes are removed. Signed/query-authenticated media, remote HTML, XML-only endpoints, arbitrary engine variants and browser login/challenge flows are unsupported. A compatible engine name does not guarantee that an independently modified site exposes identical endpoints.

## Metadata, autocomplete and account features

Danbooru's categorized strings map to the existing categories. Gelbooru/Moebooru flat tags remain under general; artist/character types are not guessed. Raw provider fields remain in each archived snapshot's `provider_metadata`, alongside canonical fields and a validated `foliuna_source` definition. The original source rating remains in `source_rating`. Offline import validates the custom identity against its stored URLs, without installing or contacting that connection.

e621/Danbooru use cached API prefix suggestions. Rule34 uses its documented API-domain autocomplete endpoint. Other Gelbooru/Moebooru connections suggest tags observed in loaded results; they do not download a complete tag database or make per-tag requests. Local Gallery suggestions come from SQLite. All requests use the existing serial pacing, bounded caches and cooldowns.

The **Account & favorites** panel explicitly reads the e621 account only. Other providers support discovery, source links, viewing and downloads; additional site account/favorite APIs are not implemented. Local Foliuna favorite tags work with the selected source.

Some APIs omit byte size. Foliuna streams those originals under the 100 MiB cap, checks response length when supplied, format and source MD5 when available, then records the actual byte count before journal publication. A failed checksum is preserved as an error, including when a CDN transforms original bytes. SQLite schema v3 removes the old two-provider constraint transactionally while retaining source IDs, tags, capture history and collection relationships. Existing schema-v1 sidecars remain readable; newer snapshots add the fields above without changing their outer envelope. Older app versions cannot open a v3 database.

## Verification limits

Default tests use fictional metadata/credentials and temporary libraries. An explicit anonymous metadata-only check on 2026-10-16 validated normalization and approved original/preview/sample URLs for e621, Danbooru, Safebooru, AIBooru, Yande.re and Konachan. Gelbooru returned HTTP 401. Real authenticated Gelbooru/Rule34/custom-site access and all live media/codec combinations remain unverified; no real user key or live media was used in these checks. See LOG.md for actual automated test/build results.
