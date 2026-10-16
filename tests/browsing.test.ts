import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, CHANNELS } from '../src/shared/contracts';
import { preferences, PreferenceStore } from '../src/main/preferences';
import { ApiClient } from '../src/main/adapters/http';
import { actions } from '../src/main/ipc';
import { CredentialStore } from '../src/main/credentials';
import { ArchiveLibrary } from '../src/main/archive/library';
import { DemoAdapter } from '../src/main/adapters/demo';
import { mediaSignature, MAX_MEDIA_BYTES } from '../src/main/media-formats';
import { bundlePath, CSP, PLAYER_CSP } from '../src/main/security';

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
afterEach(() => vi.useRealTimers());

describe('persisted browsing options', () => {
  it('defaults, validates, serializes saves and preserves an unreadable file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'foliuna-prefs-'));
    try {
      const store = new PreferenceStore(root);
      expect(await store.get()).toEqual(DEFAULT_PREFERENCES);
      const next = { gridMode: 'crop' as const, browsing: 'infinite' as const, favoriteTags: ['fox', 'artist_(name)', 'fox'] };
      await store.save(next);
      expect(await new PreferenceStore(root).get()).toEqual({ ...next, favoriteTags: ['fox', 'artist_(name)'] });
      for (const invalid of [{ ...next, browsing: 'all' }, { ...next, gridMode: null }, { ...next, favoriteTags: ['two tags'] }, { ...next, favoriteTags: Array(501).fill('fox') }]) expect(() => preferences(invalid)).toThrow();
      await writeFile(join(root, 'preferences.json'), 'broken');
      await expect(store.get()).rejects.toMatchObject({ code: 'PREFERENCES' });
      expect(await readFile(join(root, 'preferences.json'), 'utf8')).toBe('broken');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('read caching and provider scope', () => {
  it('coalesces reads, returns independent values, expires, and invalidates on account changes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ posts: [{ id: 1 }] }));
    const client = new ApiClient(fetcher); const url = new URL('https://e621.net/posts.json');
    const [first, second] = await Promise.all([client.cached(url), client.cached(url)]) as { posts: { id: number }[] }[];
    expect(fetcher).toHaveBeenCalledTimes(1); first.posts[0].id = 99; expect(second.posts[0].id).toBe(1);
    await client.cached(url); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60001); await client.cached(url); expect(fetcher).toHaveBeenCalledTimes(2);
    client.clearCache(); const fresh = client.cached(url); await vi.runAllTimersAsync(); await fresh; expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('never caches failures and keeps archive metadata reads fresh', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error()).mockImplementation(async () => json({ post: { id: 1 } }));
    const client = new ApiClient(fetcher); const url = new URL('https://e621.net/posts/1.json');
    await expect(client.cached(url)).rejects.toMatchObject({ code: 'NETWORK' });
    const retry = client.cached(url); await vi.runAllTimersAsync(); await retry;
    const archive = client.get(url); await vi.runAllTimersAsync(); await archive; expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it.each(['https://e621.net/users/1.json', 'https://e621.net/users/me.json?api_key=x', 'https://e621.net/tags.json?login=x', 'https://e621.net/favorites.json', 'https://e926.net/tags.json'])('blocks unrelated account/tag destinations %s', async (value) => {
    await expect(new ApiClient().get(new URL(value))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('tag/account/viewer capabilities', () => {
  it('uses bounded tag queries and returns only approved account fields, with fictional credentials', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'foliuna-browse-ipc-'));
    const adapter = new DemoAdapter('e621');
    const library = new ArchiveLibrary(profile, { e621: adapter }, false);
    const vault = new Map<string, string>();
    const credentials = new CredentialStore(profile, { available: async () => true,
      encrypt: async (value) => { vault.set('opaque', value); return Buffer.from('opaque'); }, decrypt: async () => vault.get('opaque')! });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => new URL(String(input)).pathname === '/tags.json' ? json([{ name: 'forest', category: 0, post_count: 42 }]) :
      json({ id: 123, name: 'fixture', level_string: 'Member', favorite_count: 4, post_upload_count: 2, created_at: '2020-01-01', favorite_tags: 'fox test_artist', email: 'secret@example.invalid', api_key: 'never-return-this', blacklisted_tags: 'private' }));
    const client = new ApiClient(fetcher, (site) => credentials.read(site));
    const openViewer = vi.fn().mockResolvedValue(undefined);
    const handlers = actions({ adapters: { e621: adapter }, library, credentials, client, demo: false, preferences: new PreferenceStore(profile), openViewer, openExternal: async () => {}, selectDirectory: async () => null });
    try {
      await expect(handlers[CHANNELS.getAccount]()).rejects.toMatchObject({ code: 'CREDENTIALS_REQUIRED' });
      for (const prefix of ['', 'a', '*fox', 'rating:s', 'x'.repeat(81), 'a b']) await expect(handlers[CHANNELS.suggestTags](prefix)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(await handlers[CHANNELS.suggestTags]('fo')).toEqual([{ name: 'forest', category: 0, count: 42 }]);
      expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('search[name_matches]')).toBe('fo*');
      await handlers[CHANNELS.suggestTags]('fo'); expect(fetcher).toHaveBeenCalledTimes(1);
      await handlers[CHANNELS.saveCredentials]({ provider: 'e621', username: 'fixture', apiKey: 'FICTIONAL-ONLY' });
      const account = await handlers[CHANNELS.getAccount]();
      expect(account).toEqual({ id: 123, name: 'fixture', level: 'Member', joined: '2020-01-01', favorites: 4, uploads: 2, favoriteTags: ['fox', 'test_artist'] });
      expect(JSON.stringify(account)).not.toMatch(/email|private|never-return/);
      expect(new Headers(fetcher.mock.calls.at(-1)![1]!.headers).get('authorization')).toBe(`Basic ${Buffer.from('fixture:FICTIONAL-ONLY').toString('base64')}`);
      await handlers[CHANNELS.openViewer]({ provider: 'e621', id: 1001, size: 'sample', url: 'file:///secret' });
      expect(openViewer).toHaveBeenCalledWith({ provider: 'e621', id: 1001, size: 'sample' });
      await expect(handlers[CHANNELS.openViewer]({ provider: 'e621', id: 1, size: 'url' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      await handlers[CHANNELS.removeCredentials]('e621');
      await expect(handlers[CHANNELS.getAccount]()).rejects.toMatchObject({ code: 'CREDENTIALS_REQUIRED' });
    } finally { await library.close(); await rm(profile, { recursive: true, force: true }); }
  });
});

describe('Flash boundary', () => {
  it('validates Flash signatures and declared expansion size', () => {
    const header = Buffer.from([70, 87, 83, 9, 16, 0, 0, 0]);
    expect(mediaSignature(header, 'swf')).toBe(true);
    header.writeUInt32LE(MAX_MEDIA_BYTES + 1, 4); expect(mediaSignature(header, 'swf')).toBe(false);
    expect(mediaSignature(Buffer.from('<html>not flash'), 'swf')).toBe(false);
    expect(CSP).not.toContain('wasm-unsafe-eval'); expect(PLAYER_CSP).toContain('wasm-unsafe-eval');
    expect(bundlePath('foliuna://player/index.html', '/bundle')).toBeNull();
    expect(bundlePath('foliuna://player/swf.html', '/bundle')).not.toBeNull();
  });
});
