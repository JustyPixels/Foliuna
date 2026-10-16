import { AppError } from '../../shared/validation';
import type { CredentialInput, Provider, ProviderDefinition } from '../../shared/contracts';
import { BUILTIN_PROVIDERS } from '../../shared/providers';
import { publicFetch } from '../public-fetch';

import { version } from '../../../package.json';
export const USER_AGENT = `Foliuna/${version} (by JustyPixels; https://github.com/JustyPixels/Foliuna/issues)`;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class ApiClient {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private pending = 0;
  private cache = new Map<string, { expires: number; value: unknown; bytes: number }>();
  private cacheBytes = 0;
  private inFlight = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(private readonly fetcher: typeof fetch = publicFetch,
    private readonly credentials: (provider: Provider) => Promise<CredentialInput | null> = async () => null,
    private readonly providers: () => ProviderDefinition[] = () => BUILTIN_PROVIDERS) {}

  get(url: URL, signal?: AbortSignal, site = 'e621'): Promise<unknown> {
    const definition = this.providers().find((entry) => entry.id === site);
    const api = definition && new URL(definition.apiUrl);
    const path = api && url.pathname.startsWith(api.pathname) ? url.pathname.slice(api.pathname.length) : null;
    const allowed = site === 'rule34' && path === 'autocomplete.php' ? [...url.searchParams.keys()].every((key) => key === 'q') :
      definition?.engine === 'gelbooru' ? path === 'index.php' && url.searchParams.get('page') === 'dapi' &&
      ['post', 'tag'].includes(url.searchParams.get('s') ?? '') && url.searchParams.get('q') === 'index' && url.searchParams.get('json') === '1' &&
      [...url.searchParams.keys()].every((key) => ['page', 's', 'q', 'json', 'tags', 'pid', 'limit', 'id', 'name_pattern', 'orderby'].includes(key)) :
      ((/^(?:posts|post)(?:\/[1-9]\d*)?\.json$/.test(path ?? '') && [...url.searchParams.keys()].every((key) => ['tags', 'page', 'limit'].includes(key))) ||
       (path === 'tags.json' && [...url.searchParams.keys()].every((key) => ['search[name_matches]', 'search[order]', 'limit'].includes(key))) ||
       (site === 'e621' && path === 'users/me.json' && !url.search));
    if (!api || url.origin !== api.origin || url.username || url.password || url.hash || !allowed) {
      return Promise.reject(new AppError('INVALID_INPUT', 'API endpoint is not allowed.'));
    }
    if (this.pending >= 4) return Promise.reject(new AppError('BUSY', 'Too many requests. Wait for the current search.'));
    this.pending++;
    const target = new URL(url);
    const task = this.tail.then(() => this.request(target, site, signal)).finally(() => { this.pending--; });
    this.tail = task.catch(() => undefined);
    if (!signal) return task;
    let abort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new AppError('CANCELLED', 'Request cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    return Promise.race([task, cancelled]).finally(() => signal.removeEventListener('abort', abort));
  }

  clearCache() { this.generation++; this.cache.clear(); this.cacheBytes = 0; this.inFlight.clear(); }

  cached(url: URL, ttl = 60000, site = 'e621'): Promise<unknown> {
    const key = `${site}:${url.href}`;
    const saved = this.cache.get(key);
    if (saved && saved.expires > Date.now()) return Promise.resolve(structuredClone(saved.value));
    const existing = this.inFlight.get(key);
    if (existing) return existing.then((value) => structuredClone(value));
    const generation = this.generation;
    const task = this.get(url, undefined, site).then((value) => {
      if (generation === this.generation) {
        const bytes = Buffer.byteLength(JSON.stringify(value));
        const previous = this.cache.get(key);
        if (previous) { this.cacheBytes -= previous.bytes; this.cache.delete(key); }
        while (this.cache.size && (this.cache.size >= 120 || this.cacheBytes + bytes > 32 * 1024 * 1024)) {
          const oldest = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
        }
        this.cache.set(key, { expires: Date.now() + ttl, value, bytes }); this.cacheBytes += bytes;
      }
      return value;
    }).finally(() => { if (generation === this.generation) this.inFlight.delete(key); });
    this.inFlight.set(key, task);
    return task.then((value) => structuredClone(value));
  }

  private async request(url: URL, site: string, signal?: AbortSignal): Promise<unknown> {
    // One queue covers e621 calls, including failed requests and server cooldowns.
    signal?.throwIfAborted();
    while (Date.now() < this.nextAt) await new Promise<void>((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const timer = setTimeout(done, Math.min(60000, this.nextAt - Date.now()));
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new AppError('CANCELLED', 'Request cancelled.')); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    const definition = this.providers().find((entry) => entry.id === site);
    if (!definition) throw new AppError('INVALID_INPUT', 'This booru connection was removed.');
    const credential = definition.auth === 'none' ? null : await this.credentials(site);
    if (site === 'rule34' && !credential) throw new AppError('CREDENTIALS_REQUIRED', 'Rule34.xxx requires an API key and numeric user ID. Add them in Settings.');
    signal?.throwIfAborted();
    const headers: Record<string, string> = { 'User-Agent': credential ? `Foliuna/0.4.0 (by ${encodeURIComponent(credential.username)} on ${credential.provider})` : USER_AGENT, Accept: 'application/json' };
    if (credential && definition.auth === 'basic') headers.Authorization = `Basic ${Buffer.from(`${credential.username}:${credential.apiKey}`, 'utf8').toString('base64')}`;
    if (credential && definition.auth === 'query') {
      if (!/^[1-9]\d*$/.test(credential.username)) throw new AppError('INVALID_INPUT', 'This API requires the numeric user ID from its API settings.');
      url.searchParams.set('user_id', credential.username); url.searchParams.set('api_key', credential.apiKey);
    }
    let response: Response;
    this.nextAt = Date.now() + 1100;
    try {
      response = await this.fetcher(url, {
        headers,
        redirect: 'error', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
    } catch {
      throw new AppError('NETWORK', 'Could not reach the provider. Check your connection and try again.');
    }
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
      const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry ?? '');
      this.nextAt = Math.max(this.nextAt, Date.now() + 30000, Number.isFinite(retryAt) ? retryAt : 0);
      await response.body?.cancel();
      throw new AppError('RATE_LIMIT', 'The provider is busy. Requests are paused for at least 30 seconds; try again later.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(`HTTP_${response.status}`, response.status === 401 ? 'The provider requires credentials or rejected the saved entry. Check your username or numeric user ID, API key and API access in Settings.' :
        response.status === 403 ? 'The provider denied access (HTTP 403). Check API access in Settings; provider or network restrictions may also cause this.' :
        response.status === 404 ? 'This post is no longer available.' :
        `Provider returned HTTP ${response.status}. Access may be restricted; Foliuna will not bypass it.`);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel();
      throw new AppError('INVALID_RESPONSE', 'The provider returned a non-JSON response. Access may be restricted.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('INVALID_RESPONSE', 'The provider returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new AppError('INVALID_RESPONSE', 'The provider response is too large.');
        }
        chunks.push(chunk.value);
      }
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
      // Safebooru's DAPI returns a zero-byte JSON body when a query has no matches.
      if (site === 'safebooru' && !text) return [];
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('INVALID_RESPONSE', 'The provider returned incomplete or invalid JSON.');
    } finally { reader.releaseLock(); }
  }
}
