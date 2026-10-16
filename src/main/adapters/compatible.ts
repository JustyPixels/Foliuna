import { MAX_PAGE, PAGE_SIZE, TAG_CATEGORIES, type ProviderDefinition, type SearchRequest, type TagSuggestion } from '../../shared/contracts';
import { AppError, positiveInteger, record, safeSearchTags, searchRequest } from '../../shared/validation';
import { mediaUrl } from '../../shared/validation';
import { ApiClient } from './http';
import { normalizePost } from './e621';
import type { BooruAdapter } from './types';

const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const words = (value: unknown) => [...new Set(text(value).split(/\s+/).filter(Boolean))];

export function compatibleMetadata(value: unknown, source: ProviderDefinition) {
  const raw = record(value);
  const rating = text(raw.rating).toLowerCase();
  const normalized = ['g', 'general', 'safe'].includes(rating) || rating === source.safeRating ? 's' :
    ['s', 'sensitive', 'q', 'questionable'].includes(rating) ? 'q' : ['e', 'explicit'].includes(rating) ? 'e' : null;
  if (!normalized) throw new AppError('INVALID_RESPONSE', 'The provider returned an unknown rating.');
  const tags = Object.fromEntries(TAG_CATEGORIES.map((category) => [category, source.engine === 'danbooru' ? words(raw[`tag_string_${category}`]) : []])) as Record<string, string[]>;
  const categorized = new Set(Object.values(tags).flat());
  tags.general = [...new Set([...tags.general, ...words(raw.tag_string ?? raw.tags).filter((tag) => !categorized.has(tag))])];
  const resolve = (value: unknown) => {
    if (typeof value !== 'string' || !value) return null;
    try {
      const hosts = [new URL(source.baseUrl).host, ...source.mediaOrigins.map((origin) => new URL(origin).host)];
      const url = new URL(hosts.some((host) => value.startsWith(`${host}/`)) ? `https://${value}` : value, source.baseUrl);
      if (url.protocol === 'http:') url.protocol = 'https:';
      if (/^\?\d+$/.test(url.search)) url.search = '';
      return mediaUrl(url.href, source);
    } catch { return null; }
  };
  const image = text(raw.image); const directory = String(raw.directory ?? '');
  const fallback = source.engine === 'gelbooru' && /^[a-zA-Z0-9_.-]+$/.test(image) && /^\d+$/.test(directory);
  const original = resolve(raw.file_url ?? (fallback ? `images/${directory}/${image}` : null));
  const extension = text(raw.file_ext) || (original ? new URL(original).pathname.split('.').at(-1)!.toLowerCase() : image.split('.').at(-1) ?? '');
  const md5 = text(raw.md5 ?? raw.hash);
  const preview = resolve(raw.preview_file_url ?? raw.preview_url ?? (fallback && /^[a-f\d]{32}$/i.test(md5) ? `thumbnails/${directory}/thumbnail_${md5}.jpg` : null));
  const sample = resolve(raw.large_file_url ?? raw.sample_url) ?? original;
  const created = typeof raw.created_at === 'number' ? new Date(raw.created_at * 1000).toISOString() : text(raw.created_at);
  return { id: positiveInteger(number(raw.id)), rating: normalized, source_rating: rating, tags, description: text(raw.description),
    sources: words(raw.source), created_at: created || null, score: { total: number(raw.score) }, fav_count: number(raw.fav_count),
    flags: { deleted: raw.is_deleted === true || raw.status === 'deleted' },
    file: { url: original, ext: extension, width: number(raw.image_width ?? raw.width), height: number(raw.image_height ?? raw.height),
      size: number(raw.file_size), md5: /^[a-f\d]{32}$/i.test(md5) ? md5 : null },
    preview: { url: preview }, sample: { url: sample }, foliuna_source: source, provider_metadata: raw };
}

export class CompatibleAdapter implements BooruAdapter {
  private readonly observedTags = new Map<string, number>();
  constructor(readonly source: ProviderDefinition, private readonly client: ApiClient) {}

  private endpoint(id?: number, request?: SearchRequest) {
    const url = new URL(this.source.engine === 'gelbooru' ? 'index.php' : this.source.engine === 'moebooru' ? 'post.json' : `posts${id ? `/${id}` : ''}.json`, this.source.apiUrl);
    if (this.source.engine === 'gelbooru') url.search = new URLSearchParams({ page: 'dapi', s: 'post', q: 'index', json: '1', limit: String(PAGE_SIZE),
      ...(id ? { id: String(id) } : { pid: String((request?.page ?? 1) - 1) }) }).toString();
    else if (!id || this.source.engine === 'moebooru') url.search = new URLSearchParams({ limit: String(PAGE_SIZE), ...(id ? { tags: `id:${id}` } : { page: String(request?.page ?? 1) }) }).toString();
    if (request) {
      const safeRating = this.source.engine === 'gelbooru' && this.source.safeRating === 'g' ? 'general' : this.source.safeRating;
      const tags = request.safeOnly !== false ? safeSearchTags(request.tags).replace(/rating:s$/, `rating:${safeRating}`) : request.tags;
      url.searchParams.set('tags', tags);
    }
    return url;
  }
  private list(value: unknown): unknown[] {
    const result = Array.isArray(value) ? value : record(value).post;
    if (result === undefined && value && typeof value === 'object' && '@attributes' in value && Number(record(record(value)['@attributes']).count) === 0) return [];
    if (!Array.isArray(result) || result.length > PAGE_SIZE) throw new AppError('INVALID_RESPONSE', 'The provider did not return a supported JSON post list. Check the selected engine and API URL.');
    return result;
  }
  private snapshot(raw: unknown) {
    const metadata = compatibleMetadata(raw, this.source); const post = normalizePost(metadata, this.source.id);
    for (const tag of Object.values(post.tags).flat()) {
      this.observedTags.set(tag, (this.observedTags.get(tag) ?? 0) + 1);
      if (this.observedTags.size > 10000) this.observedTags.delete(this.observedTags.keys().next().value!);
    }
    return { metadata, post };
  }
  async search(input: SearchRequest) {
    const request = searchRequest(input);
    if (request.provider !== this.source.id) throw new AppError('INVALID_INPUT', 'Provider mismatch.');
    const values = this.list(await this.client.cached(this.endpoint(undefined, request), 60000, this.source.id));
    const posts = values.map((raw) => this.snapshot(raw).post);
    return { posts: request.safeOnly !== false ? posts.filter((post) => post.rating === 's') : posts,
      page: request.page, hasMore: values.length === PAGE_SIZE && request.page < MAX_PAGE };
  }
  async getSnapshot(id: number, signal?: AbortSignal) {
    positiveInteger(id);
    return this.detail(id, await this.client.get(this.endpoint(id), signal, this.source.id));
  }
  async getPost(id: number) {
    positiveInteger(id);
    return this.detail(id, await this.client.cached(this.endpoint(id), 60000, this.source.id)).post;
  }
  private detail(id: number, value: unknown) {
    const raw = this.source.engine === 'danbooru' ? value : this.list(value)[0];
    if (!raw) throw new AppError('UNAVAILABLE', 'This post is no longer available.');
    const snapshot = this.snapshot(raw);
    if (snapshot.post.id !== id) throw new AppError('INVALID_RESPONSE', 'The provider returned a different post.');
    return snapshot;
  }
  async suggestTags(prefix: string): Promise<TagSuggestion[]> {
    if (this.source.id === 'rule34') {
      const url = new URL('autocomplete.php', this.source.apiUrl); url.searchParams.set('q', prefix);
      const raw = await this.client.cached(url, 86400000, this.source.id);
      if (!Array.isArray(raw) || raw.length > 100) throw new AppError('INVALID_RESPONSE', 'Invalid tag suggestions.');
      return raw.slice(0, 8).map((value) => {
        const tag = record(value); const name = text(tag.value);
        if (!name || name.length > 200 || /\s/.test(name)) throw new AppError('INVALID_RESPONSE', 'Invalid tag suggestion.');
        return { name, category: Math.max(0, TAG_CATEGORIES.indexOf(text(tag.type) as typeof TAG_CATEGORIES[number])),
          count: Number(/\((\d+)\)\s*$/.exec(text(tag.label))?.[1] ?? 0) };
      });
    }
    if (this.source.engine !== 'danbooru') return [...this.observedTags].filter(([name]) => name.startsWith(prefix)).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count, category: 0, recent: true }));
    const url = new URL('tags.json', this.source.apiUrl);
    url.search = new URLSearchParams({ 'search[name_matches]': `${prefix}*`, 'search[order]': 'count', limit: '8' }).toString();
    const raw = await this.client.cached(url, 86400000, this.source.id);
    if (!Array.isArray(raw) || raw.length > 8) throw new AppError('INVALID_RESPONSE', 'Invalid tag suggestions.');
    return raw.map((value) => {
      const tag = record(value); const name = text(tag.name);
      if (!name || name.length > 200 || /\s/.test(name)) throw new AppError('INVALID_RESPONSE', 'Invalid tag suggestion.');
      return { name, category: number(tag.category), count: number(tag.post_count) };
    });
  }
}
