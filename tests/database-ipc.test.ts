import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { openLibrary } from '../src/main/database';
import { actions, respond } from '../src/main/ipc';
import { APP_URL } from '../src/main/security';
import { DemoAdapter } from './fixtures/posts';
import { CHANNELS } from '../src/shared/contracts';
import { AppError } from '../src/shared/validation';
import { ArchiveLibrary } from '../src/main/archive/library';
import { CredentialStore } from '../src/main/credentials';
import { ApiClient } from '../src/main/adapters/http';

describe('SQLite foundation', () => {
  it('upgrades a populated v1 library without losing source metadata and rolls back a failed v2 migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'foliuna-v1-'));
    const path = join(root, 'library.sqlite');
    let db = openLibrary(path);
    try {
      db.exec("DROP TABLE source_snapshots; DROP TABLE download_journal; PRAGMA user_version=1");
      db.prepare('INSERT INTO assets(sha256,relative_path,byte_size,created_at) VALUES(?,?,?,?)').run('a'.repeat(64), 'media/a.png', 10, '2026-10-15');
      db.prepare('INSERT INTO source_posts(asset_id,provider,post_id,source_url,metadata_json,captured_at) VALUES(?,?,?,?,?,?)')
        .run(1, 'e621', 123, 'https://e621.net/posts/123', JSON.stringify({ id: 123, tags: { species: ['fox'] } }), '2026-10-15');
      db.close(); db = openLibrary(path);
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(3);
      const snapshot = db.prepare('SELECT capture_id,metadata_json,tags_json FROM source_snapshots').get()!;
      expect(snapshot.capture_id).toBe('legacy-1');
      expect(JSON.parse(String(snapshot.tags_json))).toEqual({ species: ['fox'] });
      db.exec('DROP TABLE source_snapshots; PRAGMA user_version=1'); db.close();
      expect(() => openLibrary(path)).toThrow();
      db = new DatabaseSync(path);
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='source_snapshots'").get()).toBeUndefined();
      expect(db.prepare('SELECT count(*) AS count FROM source_posts').get()!.count).toBe(1);
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('migrates idempotently, persists data, enforces hashes, relationships and categorized tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'foliuna-db-'));
    const path = join(root, 'library.sqlite');
    let db = openLibrary(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(3);
      const asset = db.prepare('INSERT INTO assets(sha256,relative_path,byte_size,created_at) VALUES(?,?,?,?)');
      asset.run('a'.repeat(64), 'media/a.png', 10, '2026-10-15');
      expect(() => asset.run('a'.repeat(64), 'media/b.png', 10, '2026-10-15')).toThrow();
      expect(() => asset.run('G'.repeat(64), 'media/b.png', 10, '2026-10-15')).toThrow();
      const source = db.prepare('INSERT INTO source_posts(asset_id,provider,post_id,source_url,metadata_json,captured_at) VALUES(?,?,?,?,?,?)');
      source.run(1, 'e621', 123, 'https://e621.net/posts/123', '{"id":123}', '2026-10-15');
      expect(() => source.run(999, 'e621', 124, 'url', '{}', 'now')).toThrow();
      expect(() => source.run(1, 'e621', 125, 'url', 'not JSON', 'now')).toThrow();
      expect(() => db.prepare('DELETE FROM assets WHERE id=?').run(1)).toThrow();
      const tag = db.prepare('INSERT INTO tags(name,category) VALUES(?,?)');
      tag.run('fox', 'species'); tag.run('fox', 'character');
      expect(() => tag.run('fox', 'species')).toThrow();
      expect(() => tag.run('fox', 'unknown')).toThrow();
      db.prepare('INSERT INTO post_tags VALUES(?,?)').run(1, 1);
      db.close(); db = openLibrary(path);
      expect(db.prepare('SELECT count(*) AS count FROM assets').get()!.count).toBe(1);
      expect(db.prepare('SELECT count(*) AS count FROM source_posts').get()!.count).toBe(1);
      expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(1);
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses a newer schema without resetting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'foliuna-newer-'));
    const path = join(root, 'library.sqlite');
    const initial = new DatabaseSync(path);
    initial.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES (\'keep\'); PRAGMA user_version=99;');
    initial.close();
    try {
      expect(() => openLibrary(path)).toThrow('newer Foliuna');
      const verify = new DatabaseSync(path);
      expect(verify.prepare('SELECT value FROM sentinel').get()!.value).toBe('keep'); verify.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rolls back failed migrations instead of leaving partial tables', () => {
    const root = mkdtempSync(join(tmpdir(), 'foliuna-migrate-'));
    const path = join(root, 'library.sqlite');
    const initial = new DatabaseSync(path); initial.exec('CREATE TABLE tags(sentinel TEXT)'); initial.close();
    try {
      expect(() => openLibrary(path)).toThrow();
      const verify = new DatabaseSync(path);
      expect(verify.prepare("SELECT name FROM sqlite_master WHERE name='assets'").get()).toBeUndefined();
      expect(verify.prepare('PRAGMA user_version').get()!.user_version).toBe(0); verify.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('IPC capability routing', () => {
  const sender = { senderId: 1, windowId: 1, isMainFrame: true, url: APP_URL };
  it('refuses untrusted callers before invoking a capability', async () => {
    const action = vi.fn();
    expect(await respond({ ...sender, isMainFrame: false }, action)).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(action).not.toHaveBeenCalled();
  });
  it('returns application errors but hides internal paths and exception details', async () => {
    expect(await respond(sender, () => { throw new AppError('INVALID_INPUT', 'Choose a provider.'); }))
      .toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Choose a provider.' } });
    const response = await respond(sender, () => { throw new Error('C:/private/db.sqlite secret'); });
    expect(response).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(response)).not.toContain('private');
  });
  it('routes credential save/test/remove through main without returning the key', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'foliuna-account-ipc-'));
    const adapters = { e621: new DemoAdapter('e621'), e926: new DemoAdapter('e926') };
    const library = new ArchiveLibrary(profile, adapters);
    const opaque = new Map<string, string>();
    const credentials = new CredentialStore(profile, {
      available: async () => true,
      encrypt: async (value) => { const id = `mock-os-ciphertext-${opaque.size}`; opaque.set(id, value); return Buffer.from(id); },
      decrypt: async (buffer) => opaque.get(buffer.toString())!,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"posts":[]}', { headers: { 'content-type': 'application/json' } }));
    const services = { adapters, library, credentials, client: new ApiClient(fetcher, (site) => credentials.read(site)), openExternal: async () => undefined, selectDirectory: async () => null };
    const handlers = actions(services);
    try {
      await expect(handlers[CHANNELS.testConnection]('e621')).rejects.toMatchObject({ code: 'CREDENTIALS_REQUIRED' });
      const input = { provider: 'e621', username: 'fixture_user', apiKey: 'FICTIONAL_KEY_ONLY' };
      expect(await handlers[CHANNELS.saveCredentials](input)).toMatchObject({ saved: true, username: 'fixture_user' });
      expect(JSON.stringify(await handlers[CHANNELS.getSettings]())).not.toContain(input.apiKey);
      expect(await handlers[CHANNELS.testConnection]('e621')).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
      const call = fetcher.mock.calls[0];
      expect(String(call[0])).toBe('https://e621.net/posts.json?tags=rating%3As&limit=1');
      expect(new Headers(call[1]!.headers).get('authorization')).toBe(`Basic ${Buffer.from(`${input.username}:${input.apiKey}`).toString('base64')}`);
      await handlers[CHANNELS.removeCredentials]('e621');
      expect((await handlers[CHANNELS.getSettings]()).credentials.find((entry) => entry.provider === 'e621')!.saved).toBe(false);
      await expect(handlers[CHANNELS.removeCredentials]('evil')).rejects.toThrow();
    } finally { await library.close(); rmSync(profile, { recursive: true, force: true }); }
  });
  it('routes validated identities and reads the real library count', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'foliuna-ipc-'));
    const adapters = { e621: new DemoAdapter('e621'), e926: new DemoAdapter('e926') };
    const library = new ArchiveLibrary(profile, adapters);
    try {
      const open = vi.fn().mockResolvedValue(undefined);
      const services = { adapters, library, openExternal: open, selectDirectory: async () => null,
        credentials: new CredentialStore(profile, { available: async () => false, encrypt: async () => Buffer.alloc(0), decrypt: async () => '' }), client: new ApiClient() };
      const handlers = actions(services);
      expect(await handlers[CHANNELS.libraryStatus]()).toEqual({ assets: 0, schemaVersion: 3, root: null, issue: null });
      expect((await handlers[CHANNELS.search]({ provider: 'e926', tags: 'fox', page: 1 })).posts).toHaveLength(10);
      expect((await handlers[CHANNELS.getPost]({ provider: 'e621', id: 1001 })).provider).toBe('e621');
      await handlers[CHANNELS.openPost]({ provider: 'e621', id: 123, url: 'file:///malicious' });
      expect(open).toHaveBeenCalledWith('https://e621.net/posts/123');
      await expect(handlers[CHANNELS.search]({ provider: 'e926', tags: '', page: -1 })).rejects.toThrow();
      expect(open).toHaveBeenCalledTimes(1);
      const e621Only = actions({ ...services, adapters: { e621: adapters.e621 } });
      await expect(e621Only[CHANNELS.search]({ provider: 'e926', tags: '', page: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(e621Only[CHANNELS.getPost]({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await expect(e621Only[CHANNELS.testConnection]('e926')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    } finally { await library.close(); rmSync(profile, { recursive: true, force: true }); }
  });
});
