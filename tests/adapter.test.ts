import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, USER_AGENT } from '../src/main/adapters/http';
import { E621Adapter, normalizePost } from '../src/main/adapters/e621';
import { DemoAdapter, demoRawPost } from './fixtures/posts';
import { PAGE_SIZE } from '../src/shared/contracts';

const json = (value: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', ...extra },
});
const endpoint = new URL('https://e621.net/posts.json');
afterEach(() => vi.useRealTimers());

describe('post normalization', () => {
  it('keeps source identity, categorized tags and file metadata', () => {
    const raw = demoRawPost();
    const fileUrl = 'https://static1.e621.net/data/a.png';
    const post = normalizePost({ ...raw, file: { ...raw.file, url: fileUrl } }, 'e621');
    expect(post).toMatchObject({ provider: 'e621', id: 1001, rating: 's', tags: { artist: ['foliuna_demo'], species: ['fox'], lore: [] },
      description: raw.description, sources: raw.sources, file: { size: 2048000, width: 1600, url: fileUrl } });
  });
  it('supports null URLs, unknown extensions and deleted media without losing tags', () => {
    const raw = { ...demoRawPost(), flags: { deleted: true }, file: { ...demoRawPost().file, ext: 'swf', url: 'https://static1.e621.net/a.png' },
      preview: { url: 'https://static1.e621.net/a.jpg' } };
    expect(normalizePost(raw, 'e926')).toMatchObject({ unavailable: true, file: { url: null, extension: 'swf' }, previewUrl: null, tags: { species: ['fox'] } });
    expect(normalizePost(demoRawPost(), 'e926').file.url).toBeNull();
  });
  it.each([{ ...demoRawPost(), id: '1001' }, { ...demoRawPost(), rating: 'unknown' },
    { ...demoRawPost(), tags: { general: [123] } }, { ...demoRawPost(), file: null }])('rejects invalid provider records %#', (input) => {
    expect(() => normalizePost(input, 'e621')).toThrow();
  });
  it('drops malicious media URLs and leaves descriptions as plain strings', () => {
    const raw = { ...demoRawPost(), description: '<img src=x onerror=alert(1)>', preview: { url: 'https://evil.test/a.jpg' } };
    expect(normalizePost(raw, 'e621')).toMatchObject({ description: raw.description, previewUrl: null });
  });
});

describe('HTTP policy', () => {
  it('cancels queued metadata requests promptly during a server cooldown', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 503, { 'retry-after': '3600' }));
    const client = new ApiClient(fetcher);
    await expect(client.get(endpoint)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    const controller = new AbortController();
    const pending = client.get(endpoint, controller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort(); await cancelled;
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
  });
  it('identifies the app, forbids redirects, omits credentials and sets a timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ posts: [] }));
    await new ApiClient(fetcher).get(endpoint);
    expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal),
    }));
  });
  it('serializes concurrent e621 calls at 1.1 second intervals', async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async () => { starts.push(Date.now()); return json({ posts: [] }); });
    const client = new ApiClient(fetcher);
    const requests = [client.get(endpoint), client.get(new URL('https://e621.net/posts/1001.json')), client.get(endpoint)];
    await vi.runAllTimersAsync();
    await Promise.all(requests);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1100);
  });
  it.each(['seconds', 'date', 'invalid'])('honors cooldown after a rate limit (%s), without retrying', async (kind) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    const retry = kind === 'date' ? new Date(Date.now() + 120000).toUTCString() : kind === 'seconds' ? '120' : 'invalid';
    const starts: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async () => {
      starts.push(Date.now());
      return starts.length === 1 ? json({}, 429, { 'retry-after': retry }) : json({ posts: [] });
    });
    const client = new ApiClient(fetcher);
    await expect(client.get(endpoint)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const next = client.get(endpoint);
    await vi.runAllTimersAsync();
    await next;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(kind === 'invalid' ? 30000 : 120000);
  });
  it('continues pacing after a network failure', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private network detail')).mockResolvedValue(json({}));
    const client = new ApiClient(fetcher);
    await expect(client.get(endpoint)).rejects.toMatchObject({ code: 'NETWORK' });
    const next = client.get(endpoint);
    await vi.advanceTimersByTimeAsync(1099);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await next;
  });
  it.each([403, 404, 500, 503])('returns a useful sanitized error for HTTP %i', async (status) => {
    const client = new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'secret' }, status)));
    await expect(client.get(endpoint)).rejects.toMatchObject({ code: status === 503 ? 'RATE_LIMIT' : `HTTP_${status}` });
  });
  it('rejects HTML, corrupt JSON and oversized streamed responses', async () => {
    for (const response of [new Response('<html>restricted</html>', { headers: { 'content-type': 'text/html' } }),
      new Response('{', { headers: { 'content-type': 'application/json' } }),
      new Response(' '.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
      await expect(new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(response)).get(endpoint)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('bounds the queue instead of accepting unlimited renderer requests', async () => {
    vi.useFakeTimers();
    const client = new ApiClient(vi.fn<typeof fetch>(async () => json({})));
    const pending = Array.from({ length: 4 }, () => client.get(endpoint));
    await expect(client.get(endpoint)).rejects.toMatchObject({ code: 'BUSY' });
    await vi.runAllTimersAsync();
    await Promise.all(pending);
  });
  it.each(['http://e621.net/posts.json', 'https://e621.net.evil.test/posts.json', 'https://e621.net/users.json', 'https://user@e621.net/posts.json'])('rejects arbitrary API destinations %s', async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ApiClient(fetcher).get(new URL(url))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('e621/e926 adapter using the real transport with mocked HTTP', () => {
  it('defaults to safe e621 search, replaces conflicting rating terms, and filters unexpected non-safe results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ posts: [demoRawPost(), { ...demoRawPost(1002), rating: 'e' }] }));
    const adapter = new E621Adapter('e621', new ApiClient(fetcher));
    const result = await adapter.search({ provider: 'e621', tags: 'forest rating:e -rating:s ~rating:q', page: 1 });
    expect((fetcher.mock.calls[0][0] as URL).searchParams.get('tags')).toBe('forest rating:s');
    expect(result.posts.map((post) => post.rating)).toEqual(['s']);
  });
  it('allows all ratings only when explicitly selected', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ posts: [{ ...demoRawPost(), rating: 'e' }] }));
    const adapter = new E621Adapter('e621', new ApiClient(fetcher));
    const result = await adapter.search({ provider: 'e621', tags: 'rating:e', page: 1, safeOnly: false });
    expect((fetcher.mock.calls[0][0] as URL).searchParams.get('tags')).toBe('rating:e'); expect(result.posts[0].rating).toBe('e');
  });
  it('encodes tag syntax and paginates without a count endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ posts: Array.from({ length: PAGE_SIZE }, (_, index) => demoRawPost(1001 + index)) }));
    const adapter = new E621Adapter('e621', new ApiClient(fetcher));
    const result = await adapter.search({ provider: 'e621', tags: 'fox -wolf rating:s', page: 2 });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.origin).toBe('https://e621.net');
    expect(Object.fromEntries(url.searchParams)).toEqual({ tags: 'fox -wolf rating:s', page: '2', limit: '24' });
    expect(result).toMatchObject({ page: 2, hasMore: true, posts: expect.any(Array) });
  });
  it('retains safe handling of legacy e926 identities while using e621 transport', async () => {
    vi.useFakeTimers();
    const unsafe = { ...demoRawPost(1002), rating: 'e' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ posts: [demoRawPost(), unsafe] })).mockResolvedValueOnce(json({ post: unsafe }));
    const adapter = new E621Adapter('e926', new ApiClient(fetcher));
    expect((await adapter.search({ provider: 'e926', tags: '', page: 1 })).posts.map((post) => post.id)).toEqual([1001]);
    expect((fetcher.mock.calls[0][0] as URL).hostname).toBe('e621.net');
    const detail = expect(adapter.getPost(1002)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await vi.runAllTimersAsync(); await detail;
  });
  it('fetches individual details and rejects a mismatched post', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ post: demoRawPost() }));
    const adapter = new E621Adapter('e621', new ApiClient(fetcher));
    await expect(adapter.getPost(1002)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect((fetcher.mock.calls[0][0] as URL).pathname).toBe('/posts/1002.json');
  });
  it.each([{}, { posts: null }, { posts: [null] }, { posts: Array(25).fill(demoRawPost()) }])('rejects malformed lists %#', async (input) => {
    const adapter = new E621Adapter('e621', new ApiClient(vi.fn<typeof fetch>().mockResolvedValue(json(input))));
    await expect(adapter.search({ provider: 'e621', tags: '', page: 1 })).rejects.toThrow();
  });
  it('does not call the provider for invalid input', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new E621Adapter('e926', new ApiClient(fetcher));
    await expect(adapter.search({ provider: 'e621', tags: '', page: 1 })).rejects.toThrow();
    await expect(adapter.getPost(-1)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('offline demo', () => {
  it('supports actual pagination, tags, exclusions, empty results and detail identity', async () => {
    const demo = new DemoAdapter('e926');
    const first = await demo.search({ provider: 'e926', tags: 'forest', page: 1 });
    expect(first.posts).toHaveLength(24); expect(first.hasMore).toBe(true);
    const second = await demo.search({ provider: 'e926', tags: 'forest', page: 2 });
    expect(second.posts).toHaveLength(6); expect(second.hasMore).toBe(false);
    expect(first.posts.some((post) => second.posts.some((other) => other.id === post.id))).toBe(false);
    const foxes = await demo.search({ provider: 'e926', tags: 'fox -wolf', page: 1 });
    expect(foxes.posts).toHaveLength(10);
    expect((await demo.search({ provider: 'e926', tags: 'no_such_tag', page: 1 })).posts).toEqual([]);
    expect((await demo.getPost(1001)).previewUrl).toBe('/demo/fox.svg');
    await expect(demo.getPost(9999)).rejects.toMatchObject({ code: 'HTTP_404' });
  });
});
