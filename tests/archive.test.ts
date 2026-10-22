import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveLibrary } from '../src/main/archive/library';
import { demoRawPost } from './fixtures/posts';
import { normalizePost } from '../src/main/adapters/e621';
import type { BooruAdapter } from '../src/main/adapters/types';
import type { Provider } from '../src/shared/contracts';
import { openLibrary } from '../src/main/database';
import { MAX_MEDIA_BYTES } from '../src/main/archive/media';
import { portableMetadata } from '../src/main/archive/metadata';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64');
const digest = (bytes: Buffer, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
let testRoot: string;
let bytes: Buffer;
let format: 'png' | 'swf';
let mode: 'ok' | 'forbidden' | 'redirect' | 'slow' | 'html' | 'truncate';
let responseSeen: () => void;
let activeResponse: ServerResponse | undefined;
const server = createServer((_request, response) => {
  activeResponse = response;
  if (mode === 'forbidden') { response.writeHead(403); response.end('denied'); }
  else if (mode === 'redirect') { response.writeHead(302, { Location: 'https://evil.invalid/media.png' }); response.end(); }
  else if (mode === 'html') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('html'); }
  else {
    response.writeHead(200, { 'Content-Type': format === 'swf' ? 'application/x-shockwave-flash' : 'image/png', 'Content-Length': bytes.length });
    if (mode === 'slow') response.write(bytes.subarray(0, 8));
    else if (mode === 'truncate') { response.write(bytes.subarray(0, 8)); response.destroy(); }
    else response.end(bytes);
  }
  responseSeen?.();
});
let localUrl: string;
let libraries: ArchiveLibrary[];
let calls: { url: string; headers: HeadersInit | undefined }[];
let revision: string;
let declaredSize: number | null;
function adapter(site: Provider): BooruAdapter {
  return {
    search: vi.fn().mockResolvedValue({ posts: [], page: 1, hasMore: false }),
    getPost: async (id) => (await adapter(site).getSnapshot(id)).post,
    getSnapshot: vi.fn(async (id) => {
      const metadata = { ...demoRawPost(id), description: revision, pools: [7, 8], api_key: 'SHOULD_NOT_ARCHIVE',
        tags: { ...demoRawPost(id).tags, species: [site === 'e621' ? 'wolf' : 'fox'] },
        file: { url: `https://static1.e621.net/data/original.${format}`, ext: format, size: declaredSize ?? bytes.length,
          md5: digest(bytes, 'md5'), width: 1, height: 1 },
      };
      return { metadata, post: normalizePost(metadata, site) };
    }),
  };
}
async function library() {
  const profile = await mkdtemp(join(testRoot, 'profile-'));
  const root = await mkdtemp(join(testRoot, 'archive-'));
  const adapters = { e621: adapter('e621'), e926: adapter('e926') };
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers });
    // Only tests remap the validated CDN request onto a real local fixture server.
    return fetch(localUrl, options);
  };
  const service = new ArchiveLibrary(profile, adapters, fetcher); libraries.push(service);
  return { service, profile, root, adapters, fetcher };
}
async function inspect(root: string, query: string) {
  const db = openLibrary(join(root, '.foliuna', 'library.sqlite'));
  try { return db.prepare(query).all(); } finally { db.close(); }
}

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'foliuna-archive-'));
  bytes = png; format = 'png'; mode = 'ok'; libraries = []; calls = []; revision = 'first snapshot'; declaredSize = null;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  localUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/original.png`;
});
afterEach(async () => {
  activeResponse?.destroy(); server.closeAllConnections();
  for (const service of libraries) await service.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(testRoot, { recursive: true, force: true });
});

describe('explicit original archiving', () => {
  it('requires an explicit command and a chosen library,', async () => {
    const { service, root, adapters } = await library();
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'LIBRARY_REQUIRED' });
    await service.select(root);
    expect(adapters.e926.getSnapshot).not.toHaveBeenCalled(); expect(calls).toEqual([]);
  });
  it('streams and verifies original bytes, persists categorized provenance, deduplicates across providers, and retains snapshot history', async () => {
    const { service, root } = await library(); await service.select(root);
    const first = await service.download({ provider: 'e926', id: 1001 });
    expect(first).toEqual({ sha256: digest(png), relativePath: `media/${digest(png)}.png`, duplicate: false });
    expect(await readFile(join(root, first.relativePath))).toEqual(png);
    const second = await service.download({ provider: 'e621', id: 1001 });
    expect(second.duplicate).toBe(true); expect(second.relativePath).toBe(first.relativePath);
    revision = 'updated tags and description';
    await service.download({ provider: 'e621', id: 1001 });
    expect(service.status().assets).toBe(1);
    expect(await readdir(join(root, 'media'))).toHaveLength(2);
    const content = await readFile(join(root, `${first.relativePath}.foliuna.json`), 'utf8');
    const sidecar = JSON.parse(content);
    expect(sidecar).toMatchObject({ schemaVersion: 1, asset: { sha256: digest(png), byteSize: png.length, mediaFile: `${digest(png)}.png` } });
    expect(sidecar.sources).toHaveLength(2);
    const e621 = sidecar.sources.find((source: { provider: string }) => source.provider === 'e621');
    expect(e621.snapshots).toHaveLength(2);
    expect(e621.snapshots[0].metadata).toMatchObject({ pools: [7, 8], description: 'first snapshot' });
    expect(e621.snapshots[1]).toMatchObject({ metadata: { description: revision }, categorizedTags: { species: ['wolf'] } });
    expect(content).not.toContain('SHOULD_NOT_ARCHIVE'); expect(content).not.toContain(testRoot);
    const species = await inspect(root, "SELECT t.name,t.category FROM tags t JOIN post_tags p ON p.tag_id=t.id WHERE t.category='species' ORDER BY t.name");
    expect(species.map((row) => [row.name, row.category])).toEqual([['fox', 'species'], ['wolf', 'species']]);
    expect(await inspect(root, 'SELECT * FROM download_journal')).toEqual([]);
    expect(await readdir(join(root, '.foliuna', 'staging'))).toEqual([]);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.url).toBe('https://static1.e621.net/data/original.png');
      expect(new Headers(call.headers).has('Authorization')).toBe(false);
    }
  });
  it('preserves the previous captured revision when the source replaces its media', async () => {
    const { service, root } = await library(); await service.select(root);
    const first = await service.download({ provider: 'e621', id: 1001 });
    const previous = await readFile(join(root, `${first.relativePath}.foliuna.json`));
    bytes = Buffer.concat([png, Buffer.from('changed')]);
    await expect(service.download({ provider: 'e621', id: 1001 })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(await readFile(join(root, first.relativePath))).toEqual(png);
    expect(await readFile(join(root, `${first.relativePath}.foliuna.json`))).toEqual(previous);
    expect(service.status().assets).toBe(1);
    expect(await inspect(root, 'SELECT * FROM download_journal')).toEqual([]);
  });
  it.each(['forbidden', 'redirect', 'html', 'truncate'] as const)('cleans up a %s transfer without committing an asset', async (failure) => {
    const { service, root } = await library(); await service.select(root); mode = failure;
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toThrow();
    expect(service.status().assets).toBe(0);
    expect(await readdir(join(root, 'media'))).toEqual([]);
    expect(await readdir(join(root, '.foliuna', 'staging'))).toEqual([]);
    expect(await inspect(root, 'SELECT * FROM download_journal')).toEqual([]);
  });
  it('rejects a false image signature and a file over the maximum size', async () => {
    const { service, root } = await library(); await service.select(root);
    bytes = Buffer.from('<html>not artwork</html>');
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'INVALID_MEDIA' });
    declaredSize = MAX_MEDIA_BYTES + 1;
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' });
    expect(calls).toHaveLength(1); expect(service.status().assets).toBe(0);
  });
  it('cleans up a disk-full write failure and rejects a wrong source MD5', async () => {
    const { service, root, adapters } = await library(); await service.select(root);
    const probePath = join(testRoot, 'probe'); const handle = await open(probePath, 'wx');
    const prototype = Object.getPrototypeOf(handle); await handle.close();
    const failingWrite = vi.spyOn(prototype, 'writeFile').mockRejectedValueOnce(Object.assign(new Error('private disk path'), { code: 'ENOSPC' }));
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'DOWNLOAD_WRITE' });
    failingWrite.mockRestore();
    expect(await readdir(join(root, '.foliuna', 'staging'))).toEqual([]);
    expect(service.status().assets).toBe(0);
    const snapshot = await adapters.e926.getSnapshot(1001);
    vi.mocked(adapters.e926.getSnapshot).mockResolvedValueOnce({ ...snapshot, post: { ...snapshot.post, file: { ...snapshot.post.file, md5: '0'.repeat(32) } } });
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'INVALID_MEDIA' });
    expect(service.status().assets).toBe(0);
  });
  it('refuses signed-query original URLs before issuing a media request', async () => {
    const { service, root, adapters } = await library(); await service.select(root);
    const snapshot = await adapters.e926.getSnapshot(1001);
    vi.mocked(adapters.e926.getSnapshot).mockResolvedValueOnce({ ...snapshot, post: { ...snapshot.post, file: { ...snapshot.post.file, url: 'https://static1.e621.net/data/original.png?token=private' } } });
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(calls).toEqual([]); expect(service.status().assets).toBe(0);
  });
  it('cancels a live stream, blocks concurrent writes, and leaves no partial archive', async () => {
    const { service, root } = await library(); await service.select(root); mode = 'slow';
    const seen = new Promise<void>((resolve) => { responseSeen = resolve; });
    const downloading = service.download({ provider: 'e926', id: 1001 });
    const rejection = expect(downloading).rejects.toMatchObject({ code: 'CANCELLED' });
    await seen;
    await expect(service.download({ provider: 'e621', id: 1002 })).rejects.toMatchObject({ code: 'BUSY' });
    await expect(service.select(root)).rejects.toMatchObject({ code: 'BUSY' });
    service.cancel(); await rejection;
    expect(await readdir(join(root, '.foliuna', 'staging'))).toEqual([]);
    expect(service.status().assets).toBe(0);
  });
  it('waits for cancellation cleanup before releasing a library during shutdown', async () => {
    const { service, root } = await library(); await service.select(root); mode = 'slow';
    const seen = new Promise<void>((resolve) => { responseSeen = resolve; });
    const downloading = service.download({ provider: 'e926', id: 1001 });
    const rejection = expect(downloading).rejects.toMatchObject({ code: 'CANCELLED' });
    await seen; await service.close(); await rejection;
    expect(await readdir(join(root, '.foliuna', 'staging'))).toEqual([]);
    expect(await inspect(root, 'SELECT * FROM download_journal')).toEqual([]);
    await expect(readFile(join(root, '.foliuna', 'library.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('archive recovery and no-overwrite behavior', () => {
  it('keeps a conflicting media file untouched, then recovers staged original bytes without redownloading', async () => {
    const { service, root } = await library(); await service.select(root);
    const target = join(root, 'media', `${digest(png)}.png`); await writeFile(target, 'unrelated existing bytes');
    await expect(service.download({ provider: 'e926', id: 1001 })).rejects.toMatchObject({ code: 'RECOVERY' });
    expect(await readFile(target, 'utf8')).toBe('unrelated existing bytes');
    expect(await inspect(root, 'SELECT phase FROM download_journal')).toEqual([{ phase: 'prepared' }]);
    await rm(target); await service.select(root);
    expect(await readFile(target)).toEqual(png); expect(service.status()).toMatchObject({ assets: 1, issue: null });
    expect(calls).toHaveLength(1); expect(await inspect(root, 'SELECT * FROM download_journal')).toEqual([]);
  });
  it.each(['png', 'swf'] as const)('recovers a failed %s sidecar publish after reopening, without duplicating a committed source snapshot', async (extension) => {
    format = extension;
    if (extension === 'swf') bytes = Buffer.from([70, 87, 83, 9, 16, 0, 0, 0, 0, 24, 1, 0, 64, 0, 0, 0]);
    const { service, profile, root, adapters, fetcher } = await library(); await service.select(root);
    const target = join(root, 'media', `${digest(bytes)}.${extension}.foliuna.json`); await mkdir(target);
    await expect(service.download({ provider: 'e621', id: 1001 })).rejects.toMatchObject({ code: 'RECOVERY' });
    expect((await inspect(root, 'SELECT count(*) AS count FROM source_snapshots'))[0].count).toBe(1);
    await service.close(); await rm(target, { recursive: true });
    const reopened = new ArchiveLibrary(profile, adapters, fetcher); libraries.push(reopened); await reopened.initialize();
    expect(reopened.status()).toMatchObject({ assets: 1, issue: null });
    expect(JSON.parse(await readFile(target, 'utf8')).sources[0].snapshots).toHaveLength(1);
    expect((await inspect(root, 'SELECT count(*) AS count FROM source_snapshots'))[0].count).toBe(1);
    expect(await inspect(root, 'SELECT * FROM download_journal')).toEqual([]); expect(calls).toHaveLength(1);
  });
  it('discards only its interrupted partial transfer and refuses traversal in journal paths', async () => {
    const { service, root } = await library(); await service.select(root);
    const capture = randomUUID(); const stage = `${capture}.part`;
    await writeFile(join(root, '.foliuna', 'staging', stage), 'incomplete');
    let db = openLibrary(join(root, '.foliuna', 'library.sqlite'));
    db.prepare('INSERT INTO download_journal VALUES(?,?,?)').run(capture, 'downloading', JSON.stringify({ stage })); db.close();
    await service.select(root); expect(await readdir(join(root, '.foliuna', 'staging'))).toEqual([]);
    const sentinel = join(testRoot, 'keep.txt'); await writeFile(sentinel, 'keep');
    db = openLibrary(join(root, '.foliuna', 'library.sqlite'));
    db.prepare('INSERT INTO download_journal VALUES(?,?,?)').run(randomUUID(), 'downloading', JSON.stringify({ stage: '../../../keep.txt' })); db.close();
    await expect(service.select(root)).rejects.toMatchObject({ code: 'RECOVERY' });
    expect(await readFile(sentinel, 'utf8')).toBe('keep');
    expect((await inspect(root, 'SELECT * FROM download_journal')).length).toBe(1);
  });
  it('locks a library across profiles and reopens it after clean shutdown', async () => {
    const first = await library(); await first.service.select(first.root);
    const second = await library(); await expect(second.service.select(first.root)).rejects.toMatchObject({ code: 'LIBRARY_BUSY' });
    await first.service.close(); await second.service.select(first.root);
    expect(second.service.status().root).toBe(await realpath(first.root));
  });
});

it('removes credential fields and transient media parameters from portable metadata', () => {
  expect(portableMetadata({ file: { url: 'https://static1.e621.net/data/a.png?token=secret#x' },
    nested: { api_key: 'secret', authorization: 'secret', keep: 'original' },
    sources: ['https://user:pass@example.invalid/art?id=10&api_key=secret'] }))
    .toEqual({ file: { url: 'https://static1.e621.net/data/a.png' }, nested: { keep: 'original' }, sources: ['https://example.invalid/art?id=10'] });
});
