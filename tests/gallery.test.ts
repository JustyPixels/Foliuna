import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveLibrary } from '../src/main/archive/library';
import { Gallery, galleryRoute } from '../src/main/archive/gallery';
import { digest, readLocal } from '../src/main/archive/local-files';
import { galleryFilter, galleryRequest } from '../src/main/archive/gallery-query';
import { parseSidecar } from '../src/main/archive/import';
import { publishNoReplace } from '../src/main/archive/publication';
import { sidecar } from '../src/main/archive/metadata';
import { normalizePost } from '../src/main/adapters/e621';
import { demoRawPost } from '../src/main/adapters/demo';
import { openLibrary } from '../src/main/database';
import type { Provider } from '../src/shared/contracts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64');
let root: string; let profile: string; let library: ArchiveLibrary; let gallery: Gallery;
function source(id = 1001, provider: Provider = 'e621', rating = 's', tag = 'forest', capturedAt = '2026-10-15T12:00:00.000Z', bytes = png) {
  const metadata = { ...demoRawPost(id), rating, sources: ['https://artist.example/art_1'],
    tags: { ...demoRawPost(id).tags, general: [tag], artist: ['test_artist'] }, file: { ...demoRawPost(id).file, ext: 'png', size: bytes.length, md5: null } };
  return { provider, postId: id, url: `https://${provider}.net/posts/${id}`, snapshots: [{ capturedAt, metadata, categorizedTags: normalizePost(metadata, provider).tags }] };
}
async function incoming(sources = [source()], bytes = png, folder = 'incoming') {
  const hash = digest(bytes); await mkdir(join(root, folder), { recursive: true });
  const name = `${hash}.png`; await writeFile(join(root, folder, name), bytes);
  const value = sidecar(hash, bytes.length, name, sources);
  await writeFile(join(root, folder, `${name}.foliuna.json`), JSON.stringify(value));
  return { hash, name, value, path: join(root, folder, `${name}.foliuna.json`) };
}
const query = (tags = '', safeOnly = true, page = 1) => ({ tags, safeOnly, page });
beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), 'foliuna-gallery-')); root = join(profile, 'archive'); await mkdir(root);
  library = new ArchiveLibrary(profile, {}, false, vi.fn()); await library.select(root); gallery = new Gallery(library);
});
afterEach(async () => { await library.close(); await rm(profile, { recursive: true, force: true }); });

describe('offline index and query grammar', () => {
  it('imports verified sidecars, deduplicates bytes, preserves source identities, and searches categorized tags locally', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    try {
      const entry = await incoming([source(), source(123, 'e926', 's', 'meadow', '2026-10-16T12:00:00.000Z')]);
      await gallery.importSidecars(); expect(library.status().assets).toBe(1);
      const result = await gallery.search(query()); expect(result.posts).toHaveLength(1);
      expect(result.posts[0]).toMatchObject({ provider: 'e926', id: 123, archive: { sha256: entry.hash, sourceCount: 2, missing: false } });
      expect(result.posts[0].originalUrl).toBe(`foliuna://app/gallery/${entry.hash}/original`);
      for (const tags of ['forest', 'artist:test_artist', 'provider:e621 forest', 'provider:e926 meadow', 'source:artist.example/art_1', 'id:123', 'type:png']) expect((await gallery.search(query(tags))).posts).toHaveLength(1);
      for (const tags of ['-forest provider:e621', 'species:test_artist', 'provider:e926 forest', 'source:art%1', 'not_here', "' OR 1=1 --"]) expect((await gallery.search(query(tags))).posts).toHaveLength(0);
      expect(await gallery.tags('test_')).toEqual([{ name: 'test_artist', category: 0, count: 1 }]);
      expect((await gallery.getPost(entry.hash, { provider: 'e621', id: 1001 })).id).toBe(1001);
      await expect(gallery.getPost(entry.hash, { provider: 'e621', id: 9999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it('keeps safe-only filtering and exact category/source matches on the same source record', async () => {
    await incoming([source(1001, 'e621', 'e', 'forest'), source(1002, 'e926', 's', 'meadow')]); await gallery.importSidecars();
    expect((await gallery.search(query('forest'))).posts).toHaveLength(0);
    expect((await gallery.search(query('rating:e'))).posts[0].rating).toBe('s');
    expect((await gallery.search(query('forest rating:e', false))).posts[0].rating).toBe('e');
    expect((await gallery.search(query('forest meadow', false))).posts).toHaveLength(0);
  });
  it('paginates unique assets and reconstructs the index after moving the entire library', async () => {
    for (let index = 0; index < 26; index++) {
      const bytes = Buffer.concat([png, Buffer.from([index])]); await incoming([source(2000 + index, 'e621', 's', 'forest', undefined, bytes)], bytes, `incoming/${index}`);
    }
    await gallery.importSidecars(); expect((await gallery.search(query())).posts).toHaveLength(24);
    expect((await gallery.search(query())).hasMore).toBe(true); expect((await gallery.search(query('', true, 2))).posts).toHaveLength(2);
    await library.close();
    const moved = join(profile, 'moved-archive'); await rename(root, moved); root = moved;
    for (const suffix of ['', '-wal', '-shm']) await rm(join(root, '.foliuna', `library.sqlite${suffix}`), { force: true });
    library = new ArchiveLibrary(profile, {}, false); await library.select(root); gallery = new Gallery(library);
    expect(library.status().assets).toBe(0); await gallery.importSidecars(); expect(library.status().assets).toBe(26);
    expect((await gallery.search(query('', true, 2))).posts).toHaveLength(2);
  });
  it('rejects unsupported operators and malformed input before SQL runs', () => {
    for (const tags of ['limit:100', '~forest', 'forest*', 'rating:x', 'artist:', 'id:-1', 'provider:evil']) expect(() => galleryFilter(galleryRequest(query(tags, false)))).toThrow();
    for (const input of [null, {}, { tags: '', page: 0 }, { tags: 'a\nb', page: 1 }, { tags: '', page: 1, safeOnly: 'yes' }]) expect(() => galleryRequest(input)).toThrow();
  });
});

describe('sidecar preservation and recovery', () => {
  it('is idempotent, retains immutable histories, and never replaces a newer capture with an older import', async () => {
    const first = await incoming(); await gallery.importSidecars();
    const newer = source(1001, 'e621', 's', 'new_tag', '2026-10-16T12:00:00.000Z');
    await incoming([newer], png, 'newer'); await gallery.importSidecars(); await gallery.importSidecars();
    expect((await gallery.search(query('new_tag'))).posts).toHaveLength(1); expect((await gallery.search(query('forest'))).posts).toHaveLength(0);
    const canonical = JSON.parse(await readFile(join(root, 'media', `${first.name}.foliuna.json`), 'utf8'));
    expect(canonical.sources[0].snapshots).toHaveLength(2);
    const db = openLibrary(join(root, '.foliuna', 'library.sqlite'));
    try { expect(db.prepare('SELECT count(*) AS n FROM source_snapshots').get()!.n).toBe(2); } finally { db.close(); }
    expect((await readFile(first.path, 'utf8'))).toBe(JSON.stringify(first.value));
  });
  it('rejects malicious/schema/inconsistent sidecars without indexing media', async () => {
    const entry = await incoming();
    for (const mutate of [(value: typeof entry.value) => { value.schemaVersion = 99; }, (value: typeof entry.value) => { value.asset.mediaFile = '../escape.png'; },
      (value: typeof entry.value) => { value.sources[0].snapshots[0].categorizedTags.artist = ['different']; }, (value: typeof entry.value) => { value.sources[0].url = 'https://evil.invalid'; }]) {
      const value = structuredClone(entry.value); mutate(value); expect(() => parseSidecar(value)).toThrow();
      await writeFile(entry.path, JSON.stringify(value)); const report = await gallery.importSidecars(); expect(report.invalid).toBe(1); expect(library.status().assets).toBe(0);
    }
    await writeFile(entry.path, JSON.stringify(entry.value)); await writeFile(join(root, 'incoming', entry.name), Buffer.concat([png, Buffer.from('changed')]));
    expect((await gallery.importSidecars()).invalid).toBe(1); expect(library.status().assets).toBe(0);
  });
  it('preserves conflicting original bytes, sidecars and earlier source revisions', async () => {
    const first = await incoming(); await gallery.importSidecars();
    const changed = Buffer.concat([png, Buffer.from('new')]); await incoming([source(1001, 'e621', 's', 'new_tag', undefined, changed)], changed, 'revision');
    const report = await gallery.importSidecars(); expect(report.conflicts).toBe(1); expect(library.status().assets).toBe(1);
    expect(await readFile(join(root, 'media', first.name))).toEqual(png);
    const second = await incoming([source(555)], png, 'other');
    await writeFile(join(root, 'media', `${first.name}.foliuna.json`), 'unrelated sidecar');
    const failure = await gallery.importSidecars(); expect(failure.invalid).toBeGreaterThan(0);
    expect(await readFile(join(root, 'media', `${first.name}.foliuna.json`), 'utf8')).toBe('unrelated sidecar'); expect(await readFile(second.path, 'utf8')).toBe(JSON.stringify(second.value));
  });
  it('recovers a renamed original by its hash and retains metadata for a genuinely missing original', async () => {
    const entry = await incoming(); await gallery.importSidecars(); await rm(join(root, 'incoming'), { recursive: true });
    await rename(join(root, 'media', entry.name), join(root, 'media', 'renamed.png'));
    expect((await gallery.search(query())).posts[0].archive?.missing).toBe(true);
    const report = await gallery.reconcile(); expect(report.recovered).toBe(1); expect(report.missing).toBe(0); expect(await readFile(join(root, 'media', 'renamed.png'))).toEqual(png);
    await rm(join(root, 'media', entry.name)); await rm(join(root, 'media', 'renamed.png'));
    expect((await gallery.reconcile()).missing).toBe(1); expect(library.status().assets).toBe(1);
    expect((await gallery.search(query('artist:test_artist'))).posts[0].archive?.missing).toBe(true);
  });
  it('does not follow junctions during import or direct local reads', async () => {
    const outside = join(profile, 'outside'); await mkdir(outside); await writeFile(join(outside, 'private.png'), png);
    await symlink(outside, join(root, 'linked'), 'junction');
    await expect(readLocal(root, 'linked/private.png')).rejects.toMatchObject({ code: 'UNSAFE_LIBRARY' });
    expect((await gallery.importSidecars()).checked).toBe(0);
  });
  it('regenerates a missing sidecar from committed history and preserves an unrelated replacement', async () => {
    const entry = await incoming(); await gallery.importSidecars();
    const path = join(root, 'media', `${entry.name}.foliuna.json`); await rm(path);
    expect((await gallery.reconcile()).recovered).toBe(1);
    expect(JSON.parse(await readFile(path, 'utf8')).sources[0].postId).toBe(1001);
    await writeFile(path, 'unrelated content'); expect((await gallery.reconcile()).invalid).toBe(1);
    expect(await readFile(path, 'utf8')).toBe('unrelated content');
  });
  it('waits for existing local reads, blocks new work during maintenance, and cancels at a file boundary', async () => {
    let release!: () => void;
    const reading = library.access(() => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const importing = gallery.importSidecars(); const cancelled = expect(importing).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(gallery.search(query())).rejects.toMatchObject({ code: 'BUSY' });
    library.cancel(); release(); await reading; await cancelled; expect(library.status().assets).toBe(0);
  });
});

describe('registered local media and thumbnail boundary', () => {
  it('serves verified originals/ranges and bounded PNG cache only for known hashes', async () => {
    const entry = await incoming(); await gallery.importSidecars(); const url = `foliuna://app/gallery/${entry.hash}/original`;
    expect((await gallery.handle(new Request(url))).status).toBe(200);
    const range = await gallery.handle(new Request(url, { headers: { Range: 'bytes=2-8' } })); expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(png.subarray(2, 9));
    expect((await gallery.handle(new Request(url, { method: 'HEAD' }))).headers.get('content-length')).toBe(String(png.length));
    expect((await gallery.handle(new Request(url, { headers: { range: 'bytes=999-' } }))).status).toBe(416);
    await gallery.cacheThumbnail({ sha256: entry.hash, png: new Uint8Array(png) });
    const thumb = await gallery.handle(new Request(url.replace('original', 'thumbnail'))); expect(thumb.status).toBe(200); expect(Buffer.from(await thumb.arrayBuffer())).toEqual(png);
    await expect(gallery.cacheThumbnail({ sha256: 'f'.repeat(64), png })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const huge = Buffer.from(png); huge.writeUInt32BE(513, 16); expect(() => gallery.cacheThumbnail({ sha256: entry.hash, png: huge })).toThrow();
    const changed = Buffer.from(png); changed[20] ^= 1; await writeFile(join(root, 'media', entry.name), changed);
    expect((await gallery.handle(new Request(url))).status).toBe(404);
    await rm(join(root, 'media', entry.name)); expect((await gallery.handle(new Request(url))).status).toBe(404);
    expect((await gallery.handle(new Request(url.replace('original', 'thumbnail')))).status).toBe(200);
  });
  it.each(['file:///gallery/a/original', 'foliuna://evil/gallery/' + 'a'.repeat(64) + '/original', 'foliuna://app/gallery/' + 'a'.repeat(64) + '/original?path=secret', 'foliuna://user@app/gallery/' + 'a'.repeat(64) + '/original', 'foliuna://app/gallery/../../original'])('rejects arbitrary local routes %s', (url) => expect(galleryRoute(url)).toBeNull());
  it('copies without replacement when hard links are unavailable, including competing publishers', async () => {
    const a = join(profile, 'a'); const b = join(profile, 'b'); const target = join(profile, 'target'); await writeFile(a, 'first'); await writeFile(b, 'second');
    const unavailable = async () => { throw Object.assign(new Error(), { code: 'ENOTSUP' }); };
    await Promise.all([publishNoReplace(a, target, unavailable), publishNoReplace(b, target, unavailable)]);
    const original = await readFile(target, 'utf8'); expect(['first', 'second']).toContain(original);
    await publishNoReplace(b, target, unavailable); expect(await readFile(target, 'utf8')).toBe(original);
    expect(await readFile(a, 'utf8')).toBe('first'); expect(await readFile(b, 'utf8')).toBe('second');
  });
});
