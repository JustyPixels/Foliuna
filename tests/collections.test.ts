import { mkdir, mkdtemp, readFile, rm, writeFile, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collections, collectionFile, collectionName } from '../src/main/archive/collections';
import { ArchiveLibrary } from '../src/main/archive/library';
import { Gallery } from '../src/main/archive/gallery';
import { digest } from '../src/main/archive/local-files';
import { sidecar } from '../src/main/archive/metadata';
import { demoRawPost } from '../src/main/adapters/demo';
import { normalizePost } from '../src/main/adapters/e621';
import { actions, respond } from '../src/main/ipc';
import { CredentialStore } from '../src/main/credentials';
import { ApiClient } from '../src/main/adapters/http';
import { CHANNELS } from '../src/shared/contracts';
import { APP_URL } from '../src/main/security';
import * as atomic from '../src/main/atomic-file';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64');
let profile: string; let root: string; let library: ArchiveLibrary; let collections: Collections; let gallery: Gallery;
const hashes: string[] = [];
beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'foliuna-collections-')); root = join(profile, 'archive'); await mkdir(root);
  library = new ArchiveLibrary(profile, {}, false, vi.fn()); await library.select(root); collections = new Collections(library); gallery = new Gallery(library);
  hashes.length = 0;
  for (let index = 0; index < 2; index++) {
    const bytes = Buffer.concat([png, Buffer.from([index])]); const hash = digest(bytes); hashes.push(hash);
    const raw = { ...demoRawPost(1001 + index), rating: index ? 'e' : 's', file: { ...demoRawPost().file, ext: 'png', size: bytes.length, md5: null },
      tags: { ...demoRawPost().tags, general: [index ? 'moon' : 'forest'] } };
    const source = { provider: 'e621', postId: raw.id, url: `https://e621.net/posts/${raw.id}`, snapshots: [{ capturedAt: '2026-10-16T00:00:00.000Z', metadata: raw, categorizedTags: normalizePost(raw, 'e621').tags }] };
    await writeFile(join(root, `${hash}.png`), bytes);
    await writeFile(join(root, `${hash}.png.foliuna.json`), JSON.stringify(sidecar(hash, bytes.length, `${hash}.png`, [source])));
  }
  await gallery.importSidecars();
});
afterEach(async () => { await library.close(); await rm(profile, { recursive: true, force: true }); });

describe('saved collections', () => {
  it('paginates only collection assets through the shared gallery query', async () => {
    const members: string[] = [];
    await library.access(({ db }) => {
      for (let index = 0; index < 25; index++) {
        const hash = digest(Buffer.from(`missing-test-media-${index}`)); members.push(hash); const id = 2000 + index;
        const asset = db.prepare('INSERT INTO assets(sha256,relative_path,byte_size,created_at) VALUES(?,?,?,?)').run(hash, `media/${hash}.png`, 10, '2026-10-17');
        const metadata = demoRawPost(id);
        db.prepare('INSERT INTO source_posts(asset_id,provider,post_id,source_url,metadata_json,captured_at) VALUES(?,?,?,?,?,?)').run(asset.lastInsertRowid, 'e621', id, `https://e621.net/posts/${id}`, JSON.stringify(metadata), '2026-10-17');
      }
    });
    await writeFile(join(root, '.foliuna', 'collections.json'), JSON.stringify({ schemaVersion: 1, nextId: 2, collections: [{ id: 1, name: 'Paged', assets: members }] }));
    const first = await gallery.search({ tags: '', page: 1, collectionId: 1 }); const second = await gallery.search({ tags: '', page: 2, collectionId: 1 });
    expect(first.posts).toHaveLength(24); expect(first.hasMore).toBe(true); expect(second.posts).toHaveLength(1); expect(second.hasMore).toBe(false);
    expect(new Set([...first.posts, ...second.posts].map((post) => post.archive!.sha256)).size).toBe(25);
    expect([...first.posts, ...second.posts].every((post) => members.includes(post.archive!.sha256))).toBe(true);
  });
  it('keeps the previous file and database after a failed atomic save', async () => {
    await collections.create({ name: 'Keep me' });
    const previous = await readFile(join(root, '.foliuna', 'collections.json'));
    const save = vi.spyOn(atomic, 'writeAtomic').mockRejectedValueOnce(new Error('simulated disk full'));
    try { await expect(collections.create({ name: 'Cannot save' })).rejects.toMatchObject({ code: 'COLLECTIONS_WRITE' }); }
    finally { save.mockRestore(); }
    expect(await readFile(join(root, '.foliuna', 'collections.json'))).toEqual(previous);
    expect((await collections.list()).map((item) => item.name)).toEqual(['Keep me']);
  });
  it('recovers after a committed file update but failed SQLite projection', async () => {
    await collections.create({ name: 'Before' });
    const db = await library.access(({ db }) => db);
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => { if (sql === 'INSERT INTO collections(id,name) VALUES(?,?)') throw new Error('simulated index write error'); return prepare(sql); });
    try { await expect(collections.create({ name: 'Committed' })).rejects.toMatchObject({ code: 'COLLECTIONS_RECOVERY' }); }
    finally { spy.mockRestore(); }
    expect((await collections.list()).map((item) => item.name)).toEqual(['Before', 'Committed']);
  });
  it('creates, renames, adds/removes memberships and deletes without changing original files or source history', async () => {
    const original = await readFile(join(root, `media/${hashes[0]}.png`)); const id = (await collections.create({ name: '  Landscapes  ' }))[0].id;
    await collections.membership({ id, sha256: hashes[0], present: true }); await collections.membership({ id, sha256: hashes[0], present: true });
    expect(await collections.list({ sha256: hashes[0] })).toEqual([{ id, name: 'Landscapes', assets: 1, pending: 0, contains: true }]);
    expect((await collections.rename({ id, name: 'Woodlands' }))[0].name).toBe('Woodlands');
    await collections.membership({ id, sha256: hashes[0], present: false });
    expect((await collections.list())[0].assets).toBe(0); await collections.membership({ id, sha256: hashes[0], present: true });
    expect(await collections.remove(id)).toEqual([]); expect(await readFile(join(root, `media/${hashes[0]}.png`))).toEqual(original);
    expect((await gallery.search({ tags: '', page: 1, safeOnly: false })).posts).toHaveLength(2);
    expect(await library.access(({ db }) => Number(db.prepare('SELECT count(*) n FROM source_snapshots').get()!.n))).toBe(2);
    expect((await collections.create({ name: 'Another' }))[0].id).toBeGreaterThan(id);
  });
  it('applies collection membership and tag/rating queries together, retaining missing originals', async () => {
    const id = (await collections.create({ name: 'Mixed' }))[0].id;
    for (const hash of hashes) await collections.membership({ id, sha256: hash, present: true });
    expect((await gallery.search({ collectionId: id, tags: '', page: 1 })).posts).toHaveLength(1);
    expect((await gallery.search({ collectionId: id, tags: 'moon rating:e', page: 1, safeOnly: false })).posts[0].id).toBe(1002);
    expect((await gallery.search({ collectionId: id, tags: 'forest moon', page: 1, safeOnly: false })).posts).toEqual([]);
    await rm(join(root, `media/${hashes[0]}.png`));
    expect((await gallery.search({ collectionId: id, tags: '', page: 1 })).posts[0].archive?.missing).toBe(true);
    expect((await collections.list())[0].assets).toBe(2);
    await expect(async () => gallery.search({ collectionId: -1, tags: '', page: 1 })).rejects.toThrow();
    await expect(gallery.search({ collectionId: id + 99, tags: '', page: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('refuses duplicate names, unknown assets and malformed requests without changing the saved snapshot', async () => {
    const id = (await collections.create({ name: 'Café' }))[0].id;
    const previous = await readFile(join(root, '.foliuna', 'collections.json'));
    for (const name of ['CAFÉ', 'Cafe\u0301']) await expect(collections.create({ name })).rejects.toMatchObject({ code: 'COLLECTION_EXISTS' });
    for (const value of [null, { id, sha256: '../file', present: true }, { id, sha256: hashes[0], present: 'yes' }, { id: 0, sha256: hashes[0], present: true }]) await expect(async () => collections.membership(value)).rejects.toThrow();
    await expect(collections.membership({ id, sha256: 'f'.repeat(64), present: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(collections.rename({ id: 99, name: 'Other' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await readFile(join(root, '.foliuna', 'collections.json'))).toEqual(previous);
    for (const name of ['', ' ', 'x'.repeat(101), 'new\nname']) expect(() => collectionName(name)).toThrow();
  });
  it('restores names, empty collections and pending memberships after moving the library and rebuilding its index', async () => {
    const id = (await collections.create({ name: 'Portable' }))[0].id; await collections.create({ name: 'Empty' });
    await collections.membership({ id, sha256: hashes[0], present: true });
    await library.close(); const moved = join(profile, 'moved'); await rename(root, moved); root = moved;
    for (const suffix of ['', '-wal', '-shm']) await rm(join(root, '.foliuna', `library.sqlite${suffix}`), { force: true });
    library = new ArchiveLibrary(profile, {}, false, vi.fn()); await library.select(root); collections = new Collections(library); gallery = new Gallery(library);
    expect(await collections.list()).toEqual([{ id: 2, name: 'Empty', assets: 0, pending: 0 }, { id, name: 'Portable', assets: 0, pending: 1 }]);
    expect((await gallery.search({ collectionId: id, tags: '', page: 1 })).posts).toEqual([]);
    await gallery.importSidecars(); expect((await collections.list()).find((item) => item.id === id)).toMatchObject({ assets: 1, pending: 0 });
    expect((await gallery.search({ collectionId: id, tags: '', page: 1 })).posts[0].archive?.sha256).toBe(hashes[0]);
  });
  it('recovers an interrupted database projection from the durable file and never replaces invalid/newer snapshots', async () => {
    const id = (await collections.create({ name: 'Before crash' }))[0].id;
    const file = JSON.parse(await readFile(join(root, '.foliuna', 'collections.json'), 'utf8')); file.collections[0].name = 'After crash'; file.collections[0].assets = [hashes[0]];
    await writeFile(join(root, '.foliuna', 'collections.json'), JSON.stringify(file));
    expect((await collections.list())[0]).toMatchObject({ id, name: 'After crash', assets: 1 });
    const invalid = JSON.stringify({ ...file, schemaVersion: 99 }); await writeFile(join(root, '.foliuna', 'collections.json'), invalid);
    await expect(collections.list()).rejects.toMatchObject({ code: 'COLLECTIONS_FILE' }); await expect(collections.remove(id)).rejects.toThrow();
    expect(await readFile(join(root, '.foliuna', 'collections.json'), 'utf8')).toBe(invalid);
    expect((await gallery.search({ tags: '', page: 1 })).posts).toHaveLength(1);
  });
  it('rejects linked collection files and does not mutate outside the library', async () => {
    const outside = join(profile, 'outside.json'); await writeFile(outside, JSON.stringify({ schemaVersion: 1, nextId: 1, collections: [] }));
    await symlink(outside, join(root, '.foliuna', 'collections.json'), 'file');
    await expect(collections.create({ name: 'Nope' })).rejects.toMatchObject({ code: 'COLLECTIONS_FILE' });
    expect(JSON.parse(await readFile(outside, 'utf8')).collections).toEqual([]);
  });
  it('waits for pinned reads and refuses a second concurrent mutation', async () => {
    let release!: () => void; let started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    const read = library.access(async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); }); await begun;
    const creating = collections.create({ name: 'Serialized' });
    await expect(collections.create({ name: 'Too soon' })).rejects.toMatchObject({ code: 'BUSY' });
    release(); await read; expect((await creating)[0].name).toBe('Serialized');
  });
  it('routes named IPC capabilities through sender checks and sanitized errors', async () => {
    const handlers = actions({ adapters: {}, library, credentials: new CredentialStore(profile, { available: async () => false, encrypt: vi.fn(), decrypt: vi.fn() }),
      client: new ApiClient(vi.fn()), demo: false, openExternal: vi.fn(), selectDirectory: async () => null });
    const sender = { senderId: 1, windowId: 1, isMainFrame: true, url: APP_URL };
    expect(await respond({ ...sender, isMainFrame: false }, () => handlers[CHANNELS.collectionCreate]({ name: 'Forbidden' }))).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await handlers[CHANNELS.collectionList](undefined)).toEqual([]);
    const response = await respond(sender, () => handlers[CHANNELS.collectionCreate]({ name: '<saved collection>' })); expect(response.ok).toBe(true);
    const id = (await collections.list())[0].id;
    await handlers[CHANNELS.collectionMembership]({ id, sha256: hashes[0], present: true });
    expect((await handlers[CHANNELS.gallerySearch]({ tags: '', page: 1, collectionId: id })).posts).toHaveLength(1);
    await handlers[CHANNELS.collectionDelete](id); expect(await collections.list()).toEqual([]);
  });
  it('validates bounded portable snapshots before indexing', () => {
    const valid = { schemaVersion: 1, nextId: 2, collections: [{ id: 1, name: 'One', assets: [hashes[0]] }] };
    for (const invalid of [{ ...valid, nextId: 1 }, { ...valid, collections: [valid.collections[0], valid.collections[0]] },
      { ...valid, collections: [{ ...valid.collections[0], assets: [hashes[0], hashes[0]] }] }, { ...valid, collections: Array(501).fill(valid.collections[0]) }]) expect(() => collectionFile(invalid)).toThrow();
  });
});
