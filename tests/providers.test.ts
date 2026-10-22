import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROVIDERS, providerDefinition, publicUrl } from '../src/shared/providers';
import { postUrl, mediaUrl } from '../src/shared/validation';
import { customProvider, ProviderStore } from '../src/main/providers';
import { CompatibleAdapter, compatibleMetadata } from '../src/main/adapters/compatible';
import { ApiClient } from '../src/main/adapters/http';
import { normalizePost } from '../src/main/adapters/e621';
import { ArchiveLibrary } from '../src/main/archive/library';
import { Gallery } from '../src/main/archive/gallery';
import { parseSidecar } from '../src/main/archive/import';
import { PostMedia } from '../src/main/media';
import { CredentialStore } from '../src/main/credentials';
import { actions, respond } from '../src/main/ipc';
import { CHANNELS } from '../src/shared/contracts';
import { APP_URL } from '../src/main/security';
import { openLibrary } from '../src/main/database';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const definition = customProvider({ name: 'Test booru', engine: 'danbooru', baseUrl: 'https://custom.booru.org/', apiUrl: 'https://custom.booru.org/api/',
  auth: 'basic', safeRating: 'g', mediaOrigins: ['https://cdn.booru.org'] });
const raw = { id: 42, rating: 'g', tags: 'forest artist_one', tag_string: 'forest artist_one', tag_string_artist: 'artist_one', tag_string_general: 'forest',
  file_url: 'https://cdn.booru.org/image.png', preview_file_url: 'https://cdn.booru.org/preview.png', large_file_url: 'https://cdn.booru.org/sample.png',
  file_ext: 'png', image_width: 240, image_height: 720, score: 12, fav_count: 4, source: 'https://artist.org/art', file_size: 0,
  provider_only_field: { license: 'preserve-me' } };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64');

describe('booru definitions and credentials', () => {
  it('persists custom connections with stable site/API identities and removes only configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foliuna-providers-'));
    try {
      const store = new ProviderStore(root); await store.initialize();
      expect(store.list().map((entry) => entry.id)).toEqual(['e621', 'danbooru', 'gelbooru', 'rule34', 'safebooru', 'aibooru', 'yandere', 'konachan']);
      await store.save(definition);
      expect(customProvider({ ...definition, name: 'Renamed', auth: 'none' }).id).toBe(definition.id);
      expect(customProvider({ ...definition, apiUrl: 'https://other.booru.org/' }).id).not.toBe(definition.id);
      const restarted = new ProviderStore(root); await restarted.initialize(); expect(restarted.get(definition.id)).toEqual(definition);
      await restarted.remove(definition.id); expect(() => restarted.get(definition.id)).toThrow();
      await expect(restarted.remove('e621')).rejects.toThrow();
      expect(postUrl({ provider: definition.id, id: 42 }, definition)).toBe('https://custom.booru.org/posts/42');
      expect(postUrl({ provider: 'rule34', id: 42 })).toBe('https://rule34.xxx/index.php?page=post&s=view&id=42');
      expect(postUrl({ provider: 'yandere', id: 42 })).toBe('https://yande.re/post/show/42');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['http://booru.org', 'https://localhost', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://home.local',
    'https://name:key@booru.org', 'https://booru.org:8080'])('rejects unsafe custom destination %s', (value) => expect(() => publicUrl(value)).toThrow());
  it('validates configuration paths, origin lists, engine and identity before any network access', () => {
    for (const change of [{ apiUrl: 'https://booru.org/?api_key=secret' }, { baseUrl: 'https://booru.org/#fragment' },
      { mediaOrigins: ['https://cdn.booru.org/media/'] }, { id: '../secret' }, { engine: 'html' }]) expect(() => providerDefinition({ ...definition, ...change })).toThrow();
    expect(mediaUrl('https://unlisted.booru.org/x.png', definition)).toBeNull();
    expect(mediaUrl('https://cdn.booru.org/x.svg', definition)).toBeNull();
    expect(mediaUrl('https://cdn.booru.org/x.png?api_key=secret', definition)).toBeNull();
    expect(mediaUrl(raw.file_url, definition)).toBe(raw.file_url);
  });
  it('scopes query authentication to the exact API and excludes keys from settings, cache keys, media and errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foliuna-query-auth-'));
    const credentials = new CredentialStore(root, { available: async () => true, encrypt: async (value) => Buffer.from(value), decrypt: async (value) => value.toString() });
    const source = BUILTIN_PROVIDERS.find((entry) => entry.id === 'rule34')!;
    const secret = { provider: 'rule34', username: '123', apiKey: 'FICTIONAL_KEY' };
    await credentials.save(secret);
    const calls: string[] = []; const headers: Headers[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, options) => { calls.push(String(url)); headers.push(new Headers(options?.headers)); return json([]); });
    const client = new ApiClient(fetcher, (id) => credentials.read(id));
    const url = new URL('https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=24');
    try {
      await client.cached(url, 60000, source.id); await client.cached(url, 60000, source.id);
      expect(fetcher).toHaveBeenCalledTimes(1); expect(calls[0]).toContain('user_id=123&api_key=FICTIONAL_KEY');
      expect(url.href).not.toContain('FICTIONAL'); expect(headers[0].has('authorization')).toBe(false);
      expect(JSON.stringify(await credentials.statuses())).not.toContain(secret.apiKey);
      await expect(client.get(new URL('https://rule34.xxx/index.php?page=dapi&s=post&q=index&json=1'), undefined, 'rule34')).rejects.toThrow();
      await expect(client.get(new URL(`${url.href}&api_key=INJECTED`), undefined, 'rule34')).rejects.toThrow();
      const mediaFetch = vi.fn<typeof fetch>(async (_url, options) => {
        expect(new Headers(options?.headers).has('authorization')).toBe(false); return new Response(png, { headers: { 'content-type': 'image/png' } });
      });
      const media = new PostMedia(mediaFetch);
      const post = normalizePost(compatibleMetadata({ ...raw, rating: 's', file_url: 'https://api-cdn.rule34.xxx/image.png' }, source), 'rule34');
      const registered = media.register(post); expect(registered.originalUrl).toBe('foliuna://app/media/rule34/42/original');
      expect((await media.handle(new Request(registered.originalUrl!))).status).toBe(200);
      expect(String(mediaFetch.mock.calls[0][0])).not.toContain('api_key');
      const broken = new ApiClient(async () => { throw new Error(secret.apiKey); }, async () => secret);
      await expect(broken.get(url, undefined, 'rule34')).rejects.toMatchObject({ code: 'NETWORK', message: expect.not.stringContaining(secret.apiKey) });
      await expect(new ApiClient(fetcher).get(url, undefined, 'rule34')).rejects.toMatchObject({ code: 'CREDENTIALS_REQUIRED' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('compatible JSON adapters', () => {
  it('accepts Safebooru empty JSON results and UTF-8 BOMs, while retaining ordinary invalid-response checks', async () => {
    const source = BUILTIN_PROVIDERS.find((entry) => entry.id === 'safebooru')!;
    const adapter = new CompatibleAdapter(source, new ApiClient(async () => new Response('', { headers: { 'content-type': 'application/json' } })));
    expect(await adapter.search({ provider: source.id, tags: 'no_matches', page: 1 })).toEqual({ posts: [], page: 1, hasMore: false });
    expect(await new ApiClient(async () => new Response('\uFEFF[]', { headers: { 'content-type': 'application/json' } })).get(new URL('https://e621.net/posts.json'))).toEqual([]);
    await expect(new ApiClient(async () => new Response('', { headers: { 'content-type': 'application/json' } })).get(new URL('https://e621.net/posts.json'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('uses Rule34’s documented API autocomplete endpoint with scoped query authentication', async () => {
    const source = BUILTIN_PROVIDERS.find((entry) => entry.id === 'rule34')!;
    const fetcher = vi.fn<typeof fetch>(async () => json([{ value: 'forest', label: 'forest (123)', type: 'general' }]));
    const adapter = new CompatibleAdapter(source, new ApiClient(fetcher, async () => ({ provider: 'rule34', username: '123', apiKey: 'FICTIONAL' })));
    expect(await adapter.suggestTags('for')).toEqual([{ name: 'forest', count: 123, category: 4 }]);
    const url = new URL(String(fetcher.mock.calls[0][0])); expect(url.pathname).toBe('/autocomplete.php'); expect(url.searchParams.get('q')).toBe('for');
    expect(url.searchParams.get('api_key')).toBe('FICTIONAL');
  });
  it.each(BUILTIN_PROVIDERS.filter((entry) => entry.engine !== 'e621'))('searches $name with its own endpoint, pagination and rating rules', async (source) => {
    let seen!: URL;
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      seen = new URL(String(url));
      const records = Array.from({ length: 24 }, (_, index) => ({ ...raw, id: index + 1, rating: index === 1 ? 'e' : source.safeRating,
        file_url: new URL('image.png', source.baseUrl).href, preview_file_url: new URL('preview.png', source.baseUrl).href }));
      return json(source.id === 'gelbooru' ? { post: records, '@attributes': { count: 100 } } : records);
    });
    const client = new ApiClient(fetcher, async () => source.id === 'rule34' ? { provider: 'rule34', username: '123', apiKey: 'FICTIONAL' } : null);
    const adapter = new CompatibleAdapter(source, client);
    const result = await adapter.search({ provider: source.id, tags: 'forest rating:e', page: 2 });
    expect(result.posts).toHaveLength(23); expect(result.hasMore).toBe(true); expect(result.posts[0].provider).toBe(source.id);
    expect(result.posts.every((post) => post.rating === 's')).toBe(true);
    expect(seen.origin).toBe(new URL(source.apiUrl).origin);
    expect(seen.searchParams.get(source.engine === 'gelbooru' ? 'pid' : 'page')).toBe(source.engine === 'gelbooru' ? '1' : '2');
    expect(seen.searchParams.get('tags')).toBe(`forest rating:${source.engine === 'gelbooru' && source.safeRating === 'g' ? 'general' : source.safeRating}`);
    expect(seen.searchParams.get('limit')).toBe('24');
  });
  it('maps sensitive ratings conservatively and preserves provider-only fields and category strings', () => {
    const metadata = compatibleMetadata({ ...raw, rating: 's' }, definition);
    const post = normalizePost(metadata, definition.id);
    expect(post.rating).toBe('q'); expect(post.sourceRating).toBe('s'); expect(post.tags.artist).toEqual(['artist_one']); expect(post.tags.general).toEqual(['forest']);
    expect(metadata.provider_metadata).toEqual({ ...raw, rating: 's' }); expect(metadata.source_rating).toBe('s');
    expect(() => normalizePost({ ...metadata, foliuna_source: { ...definition, baseUrl: 'https://other.booru.org/' } }, definition.id)).toThrow();
  });
  it('handles old Safebooru file fields, relative URLs and HTTP metadata without allowing HTTP requests', () => {
    const source = BUILTIN_PROVIDERS.find((entry) => entry.id === 'safebooru')!;
    const md5 = 'a'.repeat(32);
    const post = normalizePost(compatibleMetadata({ id: 12, rating: 'general', tags: 'forest tree', directory: '21', image: `${md5}.png`, hash: md5, width: 100, height: 200 }, source), source.id);
    expect(post.originalUrl).toBe(`https://safebooru.org/images/21/${md5}.png`);
    expect(post.previewUrl).toBe(`https://safebooru.org/thumbnails/21/thumbnail_${md5}.jpg`);
    expect(normalizePost(compatibleMetadata({ ...raw, file_url: 'http://safebooru.org/image.png?42', rating: 'general' }, source), source.id).originalUrl).toBe('https://safebooru.org/image.png');
  });
  it('validates detail identity, bypasses the read cache for snapshots, and recommends observed flat tags without bulk API calls', async () => {
    const source = BUILTIN_PROVIDERS.find((entry) => entry.id === 'safebooru')!;
    const fetcher = vi.fn<typeof fetch>(async () => json([{ ...raw, rating: 's' }]));
    const adapter = new CompatibleAdapter(source, new ApiClient(fetcher));
    await expect(adapter.getPost(99)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(await adapter.suggestTags('for')).toEqual([{ name: 'forest', count: 1, category: 0, recent: true }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('id')).toBe('99');
    const fresh = new CompatibleAdapter(definition, new ApiClient(async () => json(raw), undefined, () => [definition]));
    expect((await fresh.getSnapshot(42)).metadata.provider_metadata).toEqual(raw);
  });
  it('passes new source capabilities through validated IPC and updates credentials separately', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foliuna-provider-ipc-'));
    const library = new ArchiveLibrary(root, {});
    try {
      const store = new ProviderStore(root); await store.initialize();
      const credentials = new CredentialStore(root, { available: async () => true, encrypt: async (value) => Buffer.from(value), decrypt: async (value) => value.toString() });
      const refreshProviders = vi.fn();
      const handlers = actions({ adapters: {}, providers: store, refreshProviders, library, credentials, client: new ApiClient(vi.fn()), openExternal: vi.fn(), selectDirectory: async () => null });
      expect((await handlers[CHANNELS.saveProvider](definition)).id).toBe(definition.id);
      expect(refreshProviders).toHaveBeenCalledTimes(1);
      await handlers[CHANNELS.saveCredentials]({ provider: definition.id, username: 'test_user', apiKey: 'FICTIONAL' });
      const response = await handlers[CHANNELS.getSettings](); expect(response.providers).toContainEqual(definition); expect(JSON.stringify(response)).not.toContain('FICTIONAL');
      await expect(handlers[CHANNELS.saveCredentials]({ provider: 'gelbooru', username: 'not-an-id', apiKey: 'FICTIONAL' })).rejects.toThrow();
      const untrusted = await respond({ senderId: 1, windowId: 1, isMainFrame: false, url: APP_URL }, () => handlers[CHANNELS.removeProvider](definition.id));
      expect(untrusted.ok).toBe(false); expect(store.get(definition.id)).toEqual(definition);
      await handlers[CHANNELS.removeProvider](definition.id); expect(await credentials.read(definition.id)).toBeNull();
    } finally { await library.close(); await rm(root, { recursive: true, force: true }); }
  });
});

describe('portable multi-booru archives', () => {
  it('archives unknown-size media, preserves raw data, imports without the custom connection and retains relationships through migration', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'foliuna-provider-archive-')); const root = join(profile, 'archive'); await mkdir(root);
    const metadata = compatibleMetadata({ ...raw, api_key: 'NEVER_STORE_THIS', file_url: 'https://cdn.booru.org/image.png' }, definition);
    const post = normalizePost(metadata, definition.id);
    const mediaFetch = vi.fn<typeof fetch>(async () => new Response(png, { headers: { 'content-type': 'image/png' } }));
    let library = new ArchiveLibrary(profile, { [definition.id]: { search: vi.fn(), getPost: async () => post, getSnapshot: async () => ({ post, metadata }) } }, mediaFetch);
    try {
      await library.select(root); const result = await library.download({ provider: definition.id, id: 42 });
      const sidecar = JSON.parse(await readFile(join(root, `${result.relativePath}.foliuna.json`), 'utf8'));
      expect(JSON.stringify(sidecar)).not.toContain('NEVER_STORE_THIS'); expect(sidecar.sources[0].url).toBe('https://custom.booru.org/posts/42');
      expect(sidecar.sources[0].snapshots[0].metadata.provider_metadata.provider_only_field).toEqual(raw.provider_only_field);
      expect(parseSidecar(sidecar).sources[0].snapshots[0].metadata.file).toMatchObject({ size: png.length });
      const dbPath = join(root, '.foliuna', 'library.sqlite'); await library.close();
      let db = openLibrary(dbPath);
      db.exec('PRAGMA user_version=2'); const original = db.prepare('SELECT * FROM source_posts').all(); const captures = db.prepare('SELECT * FROM source_snapshots').all();
      db.close(); db = openLibrary(dbPath);
      expect(db.prepare('SELECT * FROM source_posts').all()).toEqual(original); expect(db.prepare('SELECT * FROM source_snapshots').all()).toEqual(captures);
      expect(db.prepare('SELECT count(*) n FROM post_tags').get()!.n).toBe(2); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
      for (const suffix of ['', '-wal', '-shm']) await rm(`${dbPath}${suffix}`, { force: true });
      library = new ArchiveLibrary(profile, {}, vi.fn()); await library.select(root); const gallery = new Gallery(library);
      expect((await gallery.importSidecars()).imported).toBe(1);
      const posts = (await gallery.search({ tags: `provider:${definition.id} artist:artist_one`, safeOnly: true, page: 1 })).posts;
      expect(posts).toHaveLength(1); expect(posts[0].originalUrl).toBe(`foliuna://app/gallery/${result.sha256}/original`);
      expect(posts[0].source?.baseUrl).toBe(definition.baseUrl); expect((await gallery.reconcile()).invalid).toBe(0);
      const openExternal = vi.fn();
      const handlers = actions({ adapters: {}, library, credentials: new CredentialStore(profile, { available: async () => false, encrypt: vi.fn(), decrypt: vi.fn() }),
        client: new ApiClient(vi.fn()), openExternal, selectDirectory: async () => null });
      await handlers[CHANNELS.openPost]({ provider: definition.id, id: 42, archiveSha: result.sha256 });
      expect(openExternal).toHaveBeenCalledWith('https://custom.booru.org/posts/42');
    } finally { await library.close(); await rm(profile, { recursive: true, force: true }); }
  });
});
