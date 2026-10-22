import { MAX_PAGE, PAGE_SIZE, type Post, type Provider, type SearchRequest, type SearchResult } from '../../src/shared/contracts';
import { AppError, positiveInteger, safeSearchTags, searchRequest } from '../../src/shared/validation';
import { normalizePost } from '../../src/main/adapters/e621';
import type { BooruAdapter } from '../../src/main/adapters/types';

export function demoRawPost(id = 1001) {
  const species = ['fox', 'wolf', 'deer'][Math.abs(id - 1001) % 3];
  return {
    id, rating: 's', tags: { artist: ['foliuna_demo'], copyright: ['original'], character: [], species: [species],
      general: ['forest', 'landscape', 'illustration', 'solo'], meta: ['digital_media_(artwork)'], lore: [], invalid: [] },
    file: { url: null, ext: 'png', width: 1600, height: 1200, size: 2048000, md5: null },
    preview: { url: null }, sample: { url: null }, flags: { deleted: false },
    description: 'A local demonstration fixture for Foliuna. No remote artwork or post was downloaded.\nTry forest, fox, wolf, deer, or -fox.',
    sources: ['https://example.invalid/foliuna-demo'], created_at: '2026-10-15T12:00:00Z',
    score: { total: 80 + id % 120 }, fav_count: 30 + id % 40,
  };
}

export class DemoAdapter implements BooruAdapter {
  private readonly posts: Post[];
  constructor(private readonly provider: Provider) {
    this.posts = Array.from({ length: 30 }, (_, index) => {
      const post = normalizePost(demoRawPost(1001 + index), provider);
      return { ...post, previewUrl: `/demo/${post.tags.species[0]}.svg`, sampleUrl: `/demo/${post.tags.species[0]}.svg`, originalUrl: `/demo/${post.tags.species[0]}.svg` };
    });
  }

  async search(input: SearchRequest): Promise<SearchResult> {
    const request = searchRequest(input);
    if (request.provider !== this.provider) throw new AppError('INVALID_INPUT', 'Provider mismatch.');
    const tokens = (request.safeOnly === false ? request.tags : safeSearchTags(request.tags)).split(/\s+/).filter(Boolean);
    const matches = this.posts.filter((post) => tokens.every((token) => {
      if (token === 'rating:s' || token === 'order:id_desc') return true;
      const negative = token.startsWith('-');
      const found = Object.values(post.tags).flat().includes(negative ? token.slice(1) : token);
      return negative ? !found : found;
    }));
    const offset = (request.page - 1) * PAGE_SIZE;
    return { posts: matches.slice(offset, offset + PAGE_SIZE), page: request.page,
      hasMore: matches.length > offset + PAGE_SIZE && request.page < MAX_PAGE };
  }

  async getPost(id: number): Promise<Post> {
    positiveInteger(id);
    const post = this.posts.find((post) => post.id === id);
    if (!post) throw new AppError('HTTP_404', 'This demo post does not exist.');
    return post;
  }

  async getSnapshot(id: number) {
    const post = await this.getPost(id);
    return { post, metadata: demoRawPost(id) };
  }
}
