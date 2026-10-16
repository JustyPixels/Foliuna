import { MAX_PAGE, PAGE_SIZE, TAG_CATEGORIES, type CategorizedTags, type Post, type Provider, type SearchRequest, type SearchResult } from '../../shared/contracts';
import { AppError, mediaUrl, positiveInteger, record, safeSearchTags, searchRequest } from '../../shared/validation';
import { ApiClient } from './http';
import type { BooruAdapter } from './types';
import { definitionFor } from '../../shared/providers';
import { customProvider } from '../providers';

const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value: unknown): string => typeof value === 'string' ? value : '';

export function normalizePost(value: unknown, provider: Provider): Post {
  const raw = record(value);
  const source = definitionFor(provider, raw.foliuna_source);
  if (provider.startsWith('custom-') && customProvider(source).id !== provider) throw new AppError('INVALID_DATA', 'The archived booru identity does not match its API and site URLs.');
  const tags = record(raw.tags);
  const file = record(raw.file);
  if (!['s', 'q', 'e'].includes(text(raw.rating))) throw new AppError('INVALID_RESPONSE', 'The provider returned an invalid rating.');
  const categorized = Object.fromEntries(TAG_CATEGORIES.map((category) => {
    const values = tags[category] ?? [];
    if (!Array.isArray(values) || !values.every((item) => typeof item === 'string')) {
      throw new AppError('INVALID_RESPONSE', 'The provider returned invalid tags.');
    }
    return [category, values];
  })) as CategorizedTags;
  const flags = raw.flags ? record(raw.flags) : {};
  const unavailable = flags.deleted === true || flags.is_deleted === true;
  const preview = raw.preview ? record(raw.preview) : {};
  const sample = raw.sample ? record(raw.sample) : {};
  return {
    provider, id: positiveInteger(raw.id), rating: raw.rating as Post['rating'], tags: categorized,
    description: text(raw.description),
    sources: Array.isArray(raw.sources) ? raw.sources.filter((source): source is string => typeof source === 'string') : [],
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
    score: raw.score ? number(record(raw.score).total) : 0, favorites: number(raw.fav_count),
    ...(raw.foliuna_source ? { source, sourceRating: text(raw.source_rating) } : {}),
    file: {
      url: unavailable ? null : mediaUrl(file.url, source), extension: text(file.ext),
      width: number(file.width), height: number(file.height), size: number(file.size), md5: typeof file.md5 === 'string' ? file.md5 : null,
    },
    previewUrl: unavailable ? null : mediaUrl(preview.url, source),
    sampleUrl: unavailable ? null : mediaUrl(sample.url, source), unavailable,
    originalUrl: unavailable ? null : mediaUrl(file.url, source),
  };
}

export class E621Adapter implements BooruAdapter {
  constructor(private readonly provider: Provider, private readonly client: ApiClient) {}

  async search(input: SearchRequest): Promise<SearchResult> {
    const request = searchRequest(input);
    if (request.provider !== this.provider) throw new AppError('INVALID_INPUT', 'Provider mismatch.');
    const url = new URL('https://e621.net/posts.json');
    const safe = request.safeOnly !== false || this.provider === 'e926';
    url.search = new URLSearchParams({ tags: safe ? safeSearchTags(request.tags) : request.tags, page: String(request.page), limit: String(PAGE_SIZE) }).toString();
    const raw = record(await this.client.cached(url));
    if (!Array.isArray(raw.posts) || raw.posts.length > PAGE_SIZE) throw new AppError('INVALID_RESPONSE', 'The provider returned an invalid post list.');
    const posts = raw.posts.map((post) => normalizePost(post, this.provider));
    return { posts: safe ? posts.filter((post) => post.rating === 's') : posts,
      page: request.page, hasMore: raw.posts.length === PAGE_SIZE && request.page < MAX_PAGE };
  }

  async getPost(id: number): Promise<Post> {
    positiveInteger(id);
    return this.snapshot(id, await this.client.cached(new URL(`https://e621.net/posts/${id}.json`))).post;
  }

  async getSnapshot(id: number, signal?: AbortSignal) {
    positiveInteger(id);
    const raw = record(await this.client.get(new URL(`https://e621.net/posts/${id}.json`), signal));
    return this.snapshot(id, raw);
  }

  private snapshot(id: number, value: unknown) {
    const raw = record(value);
    const post = normalizePost(raw.post, this.provider);
    if (post.id !== id) throw new AppError('INVALID_RESPONSE', 'The provider returned a different post.');
    if (this.provider === 'e926' && post.rating !== 's') throw new AppError('UNAVAILABLE', 'This post is unavailable on e926.');
    return { post, metadata: record(raw.post) };
  }
}
