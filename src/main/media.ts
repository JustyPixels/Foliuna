import { publicFetch } from './public-fetch';
import { extname } from 'node:path';
import type { Post } from '../shared/contracts';
import { imageMediaUrl, mediaUrl } from '../shared/validation';
import { USER_AGENT } from './adapters/http';
import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaSignature } from './media-formats';

const variants = ['preview', 'sample', 'original'] as const;
type Variant = typeof variants[number];

export function mediaRoute(value: string): { provider: string; id: string; variant: Variant } | null {
  try {
    const url = new URL(value);
    const match = /^\/media\/([a-z][a-z0-9-]{0,63})\/([1-9]\d*)\/(preview|sample|original)$/.exec(url.pathname);
    return url.protocol === 'foliuna:' && ['app', 'player'].includes(url.host) && !url.username && !url.password && !url.search && !url.hash && match ?
      { provider: match[1], id: match[2], variant: match[3] as Variant } : null;
  } catch { return null; }
}

export class PostMedia {
  private readonly posts = new Map<string, Record<Variant, string | null>>();
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly cache = new Map<string, { bytes: Buffer; mime: string; expires: number }>();
  private readonly inFlight = new Map<string, Promise<{ bytes: Buffer; mime: string }>>();
  private cacheBytes = 0;
  private pausedUntil = 0;
  constructor(private readonly fetcher: typeof fetch = publicFetch) {}

  register(post: Post): Post {
    const key = `${post.provider}/${post.id}`;
    const urls = { preview: post.unavailable ? null : imageMediaUrl(post.previewUrl, post.source),
      sample: post.unavailable ? null : imageMediaUrl(post.sampleUrl, post.source), original: post.unavailable ? null : mediaUrl(post.originalUrl, post.source) };
    this.posts.delete(key); this.posts.set(key, urls);
    if (this.posts.size > 20000) this.posts.delete(this.posts.keys().next().value!);
    const route = (variant: Variant) => urls[variant] ? `foliuna://app/media/${key}/${variant}` : null;
    return { ...post, file: { ...post.file, url: route('original') }, previewUrl: route('preview'), sampleUrl: route('sample'), originalUrl: route('original') };
  }

  async handle(request: Request): Promise<Response> {
    const route = mediaRoute(request.url);
    const url = route && this.posts.get(`${route.provider}/${route.id}`)?.[route.variant];
    if (!['GET', 'HEAD'].includes(request.method) || !route || !url) return new Response(null, { status: 404 });
    try {
      let entry = this.cache.get(url);
      if (entry && entry.expires <= Date.now()) { this.cache.delete(url); this.cacheBytes -= entry.bytes.length; entry = undefined; }
      let data: { bytes: Buffer; mime: string };
      if (entry) data = entry;
      else {
        let task = this.inFlight.get(url);
        if (!task) {
          task = this.load(url, route.variant, request.signal).then((value) => {
            while (this.cacheBytes + value.bytes.length > 128 * 1024 * 1024 && this.cache.size) {
              const oldest = this.cache.keys().next().value!;
              this.cacheBytes -= this.cache.get(oldest)!.bytes.length; this.cache.delete(oldest);
            }
            this.cache.set(url, { ...value, expires: Date.now() + 300000 }); this.cacheBytes += value.bytes.length;
            return value;
          }).finally(() => this.inFlight.delete(url));
          this.inFlight.set(url, task);
        }
        data = await task;
      }
      if (route.variant !== 'original' && data.bytes.length > 8 * 1024 * 1024) throw new Error('Preview exceeds limit');
      const headers = new Headers({ 'Content-Type': data.mime, 'Content-Length': String(data.bytes.length),
        'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300', 'Content-Security-Policy': "default-src 'none'" });
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = match?.[1] ? Number(match[1]) : Math.max(0, data.bytes.length - Number(match?.[2]));
        const end = match?.[1] && !match[2] ? data.bytes.length - 1 : match?.[1] ? Math.min(Number(match[2]), data.bytes.length - 1) : data.bytes.length - 1;
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= data.bytes.length) {
          headers.set('Content-Range', `bytes */${data.bytes.length}`); headers.set('Content-Length', '0'); return new Response(null, { status: 416, headers });
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${data.bytes.length}`); headers.set('Content-Length', String(end - start + 1));
        return new Response(request.method === 'HEAD' ? null : new Uint8Array(data.bytes.subarray(start, end + 1)), { status: 206, headers });
      }
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(data.bytes), { headers });
    } catch { return new Response(null, { status: Date.now() < this.pausedUntil ? 429 : 502, headers: { 'Cache-Control': 'no-store' } }); }
  }

  private async load(url: string, variant: Variant, requestSignal: AbortSignal): Promise<{ bytes: Buffer; mime: string }> {
    if (Date.now() < this.pausedUntil || this.waiting.length >= 48) throw new Error('Media paused');
    if (this.active >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try {
      requestSignal.throwIfAborted();
      if (Date.now() < this.pausedUntil) throw new Error('Media paused');
      const signal = AbortSignal.timeout(60000);
      const response = await this.fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,video/*,application/x-shockwave-flash' },
        redirect: 'error', credentials: 'omit', signal });
      if ([429, 503].includes(response.status)) {
        const retry = response.headers.get('retry-after');
        const when = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry ?? '');
        this.pausedUntil = Math.max(Date.now() + 30000, Number.isFinite(when) ? when : 0);
      }
      const extension = extname(new URL(url).pathname).slice(1).toLowerCase();
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const maximum = variant === 'original' ? MAX_MEDIA_BYTES : 8 * 1024 * 1024;
      const length = response.headers.get('content-length');
      if (!response.ok || (mime !== MEDIA_TYPES[extension] && mime !== 'application/octet-stream') ||
          (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))) {
        await response.body?.cancel();
        throw new Error('Invalid media response');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty media response');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maximum) throw new Error('Media response exceeds limit');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const image = Buffer.concat(chunks);
      if (!mediaSignature(image.subarray(0, 16), extension) || (length !== null && Number(length) !== bytes)) throw new Error('Invalid media file');
      return { bytes: image, mime: MEDIA_TYPES[extension] };
    }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
