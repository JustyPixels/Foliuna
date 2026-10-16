import { DatabaseSync } from 'node:sqlite';

export function openLibrary(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if (version > 3) throw new Error('This library was created by a newer Foliuna version.');
    if (version === 0) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE assets (
          id INTEGER PRIMARY KEY,
          sha256 TEXT NOT NULL UNIQUE CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
          relative_path TEXT NOT NULL UNIQUE,
          byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
          created_at TEXT NOT NULL
        );
        CREATE TABLE source_posts (
          id INTEGER PRIMARY KEY,
          asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
          provider TEXT NOT NULL CHECK(provider IN ('e621','e926')),
          post_id INTEGER NOT NULL CHECK(post_id > 0),
          source_url TEXT NOT NULL,
          metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
          captured_at TEXT NOT NULL,
          UNIQUE(provider, post_id)
        );
        CREATE TABLE tags (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK(category IN ('artist','copyright','character','species','general','meta','lore','invalid')),
          UNIQUE(name, category)
        );
        CREATE TABLE post_tags (
          source_post_id INTEGER NOT NULL REFERENCES source_posts(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY(source_post_id, tag_id)
        );
        CREATE INDEX post_tags_by_tag ON post_tags(tag_id, source_post_id);
        CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) > 0));
        CREATE TABLE collection_assets (
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          PRIMARY KEY(collection_id, asset_id)
        );
        PRAGMA user_version = 1;
        COMMIT;`);
    }
    if (version < 2) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE download_journal (
          id TEXT PRIMARY KEY,
          phase TEXT NOT NULL CHECK(phase IN ('downloading','prepared')),
          payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
        );
        CREATE TABLE source_snapshots (
          id INTEGER PRIMARY KEY,
          capture_id TEXT NOT NULL UNIQUE,
          source_post_id INTEGER NOT NULL REFERENCES source_posts(id) ON DELETE CASCADE,
          metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
          tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
          captured_at TEXT NOT NULL
        );
        INSERT INTO source_snapshots(capture_id,source_post_id,metadata_json,tags_json,captured_at)
          SELECT 'legacy-' || id,id,metadata_json,COALESCE(json_extract(metadata_json,'$.tags'),'{}'),captured_at FROM source_posts;
        PRAGMA user_version = 2;
        COMMIT;`);
    }
    if (version < 3) {
      // Rebuild only the constrained parent table, preserving row IDs and all child relationships.
      db.exec(`PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;
        CREATE TABLE source_posts_v3 (
          id INTEGER PRIMARY KEY,
          asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
          provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 64 AND provider NOT GLOB '*[^a-z0-9-]*'),
          post_id INTEGER NOT NULL CHECK(post_id > 0), source_url TEXT NOT NULL,
          metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)), captured_at TEXT NOT NULL,
          UNIQUE(provider, post_id)
        );
        INSERT INTO source_posts_v3 SELECT * FROM source_posts;
        DROP TABLE source_posts;
        ALTER TABLE source_posts_v3 RENAME TO source_posts;`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Library relationships failed migration checks.');
      db.exec('PRAGMA user_version = 3; COMMIT; PRAGMA foreign_keys = ON;');
    }
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    db.close();
    throw error;
  }
}
