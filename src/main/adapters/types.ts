import type { Post, SearchRequest, SearchResult } from '../../shared/contracts';

export interface BooruAdapter {
  search(request: SearchRequest): Promise<SearchResult>;
  getPost(id: number): Promise<Post>;
  getSnapshot(id: number, signal?: AbortSignal): Promise<PostSnapshot>;
}

export interface PostSnapshot { post: Post; metadata: Record<string, unknown> }
