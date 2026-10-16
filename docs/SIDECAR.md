# Foliuna sidecars, schema version 1

Every archived asset has an adjacent UTF-8 JSON file named `<media filename>.foliuna.json`, for example `media/<64-character SHA-256>.png.foliuna.json`.

```json
{
  "schemaVersion": 1,
  "asset": {
    "sha256": "<64 lowercase hexadecimal characters>",
    "byteSize": 123456,
    "mediaFile": "<sha256>.png"
  },
  "sources": [
    {
      "provider": "e926",
      "postId": 123,
      "url": "https://e926.net/posts/123",
      "snapshots": [
        {
          "capturedAt": "2026-10-15T12:00:00.000Z",
          "metadata": { "id": 123, "tags": { "species": ["fox"] } },
          "categorizedTags": {
            "artist": [], "copyright": [], "character": [], "species": ["fox"],
            "general": [], "meta": [], "lore": [], "invalid": []
          }
        }
      ]
    }
  ]
}
```

The example abbreviates provider metadata. `metadata` retains the fetched e621 post object or canonical compatible-provider fields plus its full original object in `provider_metadata`, including provider-only fields such as pools/relationships/flags when present. Credential fields, URL user/password information and transient CDN query/fragment parameters are removed before persistence. No application credential record, Authorization header or absolute machine path belongs in a sidecar.

`asset.mediaFile` is the adjacent media basename, not an absolute path or URI. `sha256` identifies bytes independently of the provider's MD5 or post ID. `byteSize` is the verified byte count. `sources` contains one entry per provider/post identity pointing to those bytes. `snapshots` retains every explicit capture, including previous metadata/tag versions when the bytes remain the same. e621 and e926 identities are stored separately, even when they refer to the same underlying post.

Compatible-provider snapshots also preserve `foliuna_source` (validated ID, engine, site/API bases, auth mode and media origins; no key) and `source_rating`. Custom IDs derive from engine/site/API URLs, so offline restore verifies provenance without a configured provider. Built-in provider URLs remain canonical. Flat API tags are stored under general rather than guessed. See BOORUS.md.

The latest snapshot's tags populate the searchable `post_tags` relations. Older categorized tags remain in `source_snapshots` and sidecar history. A source replacing its original bytes is reported as SOURCE_CHANGED; the earlier archive stays visible in Gallery. Use a different archive folder to preserve the new revision too. Existing source identities are not rebound to new bytes.

Sidecars are rebuilt from committed library rows and published through a flushed temporary file followed by rename. The download journal remains until the media, database and sidecar agree. Recovery reuses the capture ID, so repeating a partially completed finalization does not duplicate a snapshot.

Gallery → Import sidecars restores schema-v1 originals and metadata into the selected library, including rebuilding a missing index. It validates supported schema/type/history/tag bounds, adjacent basenames, media signature, SHA-256 and byte size before adding records. Inputs can use a different supported media basename; canonical library copies use <sha256>.<extension>. Links, traversal, absolute paths, device names and unknown schemas are refused. Capture fingerprints make repeat imports idempotent; import does not erase older captures or replace newer metadata with older/equal-time records. Valid destination sidecar history is merged; invalid/conflicting destination sidecars are preserved. Limits are 16 MiB per sidecar, 100 sources, 1,000 captures per source and 2,000 tags per category per capture. See GALLERY.md for the workflow and conflict/recovery behavior. Sidecars and original media are ordinary files; Windows credential encryption applies only to saved API credentials.

Collection membership is deliberately separate from per-media sidecars. The library-level .foliuna/collections.json snapshot preserves names, empty collections and SHA-256 memberships without rewriting every media sidecar on rename/removal. Copy the complete library to retain it; after index reconstruction, pending memberships reattach by hash. See COLLECTIONS.md.
