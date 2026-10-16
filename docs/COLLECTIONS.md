# Collections — Foliuna

Collections organize media already saved in the selected library. One item may belong to several collections; membership follows its SHA-256 identity, so different booru posts with identical bytes share that membership. Adding an item does not copy it or contact a provider.

## Use collections

1. Choose an archive folder in Settings and download originals, or import existing media sidecars from Gallery.
2. Open **Collections** in the sidebar, enter a name and choose **Create collection**.
3. In Gallery, open a saved post and choose **Manage collections**. Check the collections it belongs to; uncheck to remove membership. Changes are saved immediately. Choose Done to return to the same post.
4. Open Collections and select a collection to browse its saved media. Tag/source/type/rating searches, numbered pages or infinite scrolling, natural/cropped layouts, detail navigation and the separate media window use the shared Gallery controls. Playback stays local. Source links open a browser only on your explicit click.
5. Edit **Collection name** and choose Rename collection to rename it. Delete collection asks for confirmation and deletes its memberships only. **All original files, tags and source history remain in Gallery.** Keep collection cancels deletion.

Safe-only is enabled by default. Counts include all indexed members, including missing originals and ratings currently hidden by the filter. Details show the newest matching saved source for each SHA-256 asset; its representative post ID may differ from the post used to add it. A provider/ID query chooses a specific captured source. There is no custom item order or bulk selection in this increment.

Names allow 1–100 characters, trim outer whitespace and normalize Unicode. Names are unique ignoring case; they are displayed as plain text and never become filenames. Limits: 500 collections, 10,000 members per collection, 100,000 memberships per library and a 16 MiB collection file. Unknown assets cannot be added; first download/import them. Missing files retain their indexed identities and can remain in collections.

## Portability and recovery

The portable snapshot lives at **`.foliuna/collections.json` inside the library root**, next to its SQLite database. Copy or move the **entire library folder, including `.foliuna`**, to preserve collections. Copying only original media and individual `.foliuna.json` sidecars does not carry collections. The collection file contains names and SHA-256 memberships; no credentials, machine paths or remote content.

```json
{
  "schemaVersion": 1,
  "nextId": 3,
  "collections": [
    { "id": 1, "name": "Landscapes", "assets": ["<64 lowercase hexadecimal SHA-256 characters>"] },
    { "id": 2, "name": "Empty collection", "assets": [] }
  ]
}
```

IDs are local to this library and increase monotonically, including after deletion. The file is the authoritative snapshot; SQLite's existing `collections` and `collection_assets` tables are its searchable projection. The database remains schema v3. The file is validated before any projection change; updates flush an exclusive temporary file and atomically replace the previous snapshot before updating the database in a transaction. A failure after file publication can be recovered by reopening Collections. A failed file save leaves the previous snapshot and memberships intact. Mutations wait for existing library reads and exclude downloads, folder changes and other maintenance while publishing.

If the SQLite index is lost, keep this file and the media/sidecars:

1. Select the same library folder in Settings. An unknown-version or damaged database is preserved rather than reset automatically; restore a backup or move the damaged database aside after closing Foliuna before rebuilding.
2. Collections can show names and empty collections immediately. Memberships whose hashes are not indexed appear as **awaiting matching sidecar imports** and are retained in the snapshot.
3. Use **Gallery → Import sidecars** to rebuild the asset/source index from verified originals and sidecars.
4. Reopen Collections. Newly indexed hashes regain their memberships automatically. Missing originals/sidecars remain pending; importing an unrelated file cannot take their place.

Opening Collections checks the saved snapshot and refreshes the projection when it changes or the asset index gains entries. Existing SQLite-only collection rows are preserved and included in the first snapshot when a collection is changed. If a collection snapshot is invalid, too large, linked or from an unsupported version, Foliuna preserves it and reports the problem; Gallery remains usable. Restore a valid snapshot backup rather than replacing it with an empty file. This is a whole-library snapshot, not a merge format for unrelated libraries.

Back up the entire library regularly. Atomic publication and recovery cover application interruption; physical power loss, drive failure and simultaneous external file edits cannot be guaranteed. No media deletion, cloud synchronization, shared editing or site favorite synchronization is implemented.
