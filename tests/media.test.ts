import { describe, expect, it, vi } from 'vitest';
import { PostMedia, mediaRoute } from '../src/main/media';
import { normalizePost } from '../src/main/adapters/e621';
import { demoRawPost } from './fixtures/posts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64');
const post = () => normalizePost({ ...demoRawPost(), file: { ...demoRawPost().file, url: 'https://static1.e621.net/data/original.png' },
  preview: { url: 'https://static1.e621.net/data/preview/a.png' }, sample: { url: 'https://static1.e621.net/data/sample/a.png' } }, 'e621');
const image = () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });

describe('validated local image rendering', () => {
  it('registers approved post media without fetching; returns verified bytes only when an image is requested', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => image());
    const media = new PostMedia(fetcher);
    const mapped = media.register(post());
    expect(fetcher).not.toHaveBeenCalled();
    expect(mapped).toMatchObject({ previewUrl: 'foliuna://app/media/e621/1001/preview', sampleUrl: 'foliuna://app/media/e621/1001/sample', originalUrl: 'foliuna://app/media/e621/1001/original' });
    const response = await media.handle(new Request(mapped.previewUrl!));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(post().previewUrl);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
    expect(new Headers(fetcher.mock.calls[0][1]!.headers).has('Authorization')).toBe(false);
    await media.handle(new Request(mapped.originalUrl!));
    expect(fetcher.mock.calls[1][0]).toBe(post().originalUrl);
  });
  it.each(['https://evil.test/media/e621/1001/preview', 'foliuna://evil/media/e621/1001/preview',
    'foliuna://app/media/e621/0/preview', 'foliuna://app/media/e621/1001/other', 'foliuna://user@app/media/e621/1001/preview',
    'foliuna://app/media/e621/1001/preview?url=https://evil.test/a.png', 'foliuna://app/media/e621/1001/preview#x'])('rejects arbitrary media route %s', (url) => {
    expect(mediaRoute(url)).toBeNull();
  });
  it('does not fetch unknown post IDs, unknown variants or unapproved image URLs', async () => {
    const fetcher = vi.fn<typeof fetch>(); const media = new PostMedia(fetcher);
    expect((await media.handle(new Request('foliuna://app/media/e621/9999/preview'))).status).toBe(404);
    const mapped = media.register({ ...post(), previewUrl: 'https://evil.test/a.png', sampleUrl: null, originalUrl: null });
    expect(mapped.previewUrl).toBeNull();
    expect((await media.handle(new Request('foliuna://app/media/e621/1001/preview'))).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses HTML, HTTP errors, invalid image signatures, size mismatches, oversized previews and redirects', async () => {
    for (const response of [new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }),
      new Response(png, { status: 403, headers: { 'content-type': 'image/png' } }),
      new Response('not an image', { headers: { 'content-type': 'image/png' } }),
      new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length + 1) } }),
      new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) } })]) {
      const media = new PostMedia(vi.fn<typeof fetch>().mockResolvedValue(response)); const mapped = media.register(post());
      expect((await media.handle(new Request(mapped.previewUrl!))).status).toBe(502);
    }
    const media = new PostMedia(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('redirect refused')));
    expect((await media.handle(new Request(media.register(post()).previewUrl!))).status).toBe(502);
  });
  it('bounds simultaneous transfers while allowing a full grid to finish', async () => {
    const pending: ((value: Response) => void)[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const media = new PostMedia(fetcher);
    const requests = Array.from({ length: 8 }, (_, index) => {
      const mapped = media.register({ ...post(), id: index + 1, previewUrl: `https://static1.e621.net/${index}.png` });
      return media.handle(new Request(mapped.previewUrl!));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (let total = 4; total <= 8; total += 2) {
      for (const resolve of pending.splice(0)) resolve(image());
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(total));
    }
    for (const resolve of pending.splice(0)) resolve(image());
    expect((await Promise.all(requests)).every((response) => response.status === 200)).toBe(true);
  });
  it('shares duplicate transfers and serves repeat, HEAD and seek requests without more CDN traffic', async () => {
    const bytes = Buffer.concat([Buffer.from([26, 69, 223, 163]), Buffer.alloc(60)]);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes, { headers: { 'content-type': 'video/webm' } }));
    const media = new PostMedia(fetcher);
    const mapped = media.register({ ...post(), file: { ...post().file, extension: 'webm' }, originalUrl: 'https://static1.e621.net/movie.webm' });
    expect(fetcher).not.toHaveBeenCalled();
    const responses = await Promise.all(Array.from({ length: 8 }, () => media.handle(new Request(mapped.originalUrl!))));
    expect(responses.every((response) => response.status === 200)).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    const seek = await media.handle(new Request(mapped.originalUrl!, { headers: { range: 'bytes=4-15' } }));
    expect(seek.status).toBe(206); expect(seek.headers.get('content-range')).toBe('bytes 4-15/64'); expect((await seek.arrayBuffer()).byteLength).toBe(12);
    const head = await media.handle(new Request(mapped.originalUrl!, { method: 'HEAD' }));
    expect(head.headers.get('content-length')).toBe('64'); expect((await head.arrayBuffer()).byteLength).toBe(0);
    for (const range of ['bytes=900-', 'bytes=3-1', 'bytes=1-2,5-6', 'invalid', 'bytes=-0']) expect((await media.handle(new Request(mapped.originalUrl!, { headers: { range } }))).status).toBe(416);
    const suffix = await media.handle(new Request(mapped.originalUrl!, { headers: { range: 'bytes=-8' } })); expect((await suffix.arrayBuffer()).byteLength).toBe(8);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('pauses new CDN transfers after provider throttling without retrying', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '120' } }));
      const media = new PostMedia(fetcher); const mapped = media.register(post());
      expect((await media.handle(new Request(mapped.previewUrl!))).status).toBe(429);
      expect((await media.handle(new Request(mapped.sampleUrl!))).status).toBe(429); expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120001);
      await media.handle(new Request(mapped.sampleUrl!)); expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
