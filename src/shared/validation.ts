import { MAX_PAGE, type CredentialInput, type PostRequest, type Provider, type ProviderDefinition, type SearchRequest } from './contracts';
import { definitionFor, PROVIDER_ID, publicUrl } from './providers';

export class AppError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_DATA', 'Expected an object.');
  return value as Record<string, unknown>;
}

export function provider(value: unknown): Provider {
  if (typeof value !== 'string' || !PROVIDER_ID.test(value)) throw new AppError('INVALID_INPUT', 'Choose a configured booru.');
  return value as Provider;
}

export function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new AppError('INVALID_INPUT', `Expected a whole number between 1 and ${maximum}.`);
  }
  return value;
}

export function searchRequest(value: unknown): SearchRequest {
  const input = record(value);
  if (typeof input.tags !== 'string' || input.tags.length > 512 || /[\u0000-\u001f\u007f]/.test(input.tags)) {
    throw new AppError('INVALID_INPUT', 'Use a tag query of up to 512 characters.');
  }
  const tags = input.tags.trim();
  if (input.safeOnly !== undefined && typeof input.safeOnly !== 'boolean') throw new AppError('INVALID_INPUT', 'Choose a valid content filter.');
  if (tags.split(/\s+/).filter(Boolean).length > 40 || /(?:^|\s)limit:/i.test(tags)) {
    throw new AppError('INVALID_INPUT', 'Use up to 40 tags; page size is managed by Foliuna.');
  }
  return { provider: provider(input.provider), tags, page: positiveInteger(input.page, MAX_PAGE),
    ...(input.safeOnly === undefined ? {} : { safeOnly: input.safeOnly }) };
}

export function safeSearchTags(tags: string): string {
  return [...tags.split(/\s+/).filter((tag) => tag && !/^[-~]?rating:/i.test(tag)), 'rating:s'].join(' ');
}

export function imageMediaUrl(value: unknown, source?: ProviderDefinition): string | null {
  const url = mediaUrl(value, source);
  return url && /\.(?:jpg|jpeg|png|gif|webp)$/i.test(new URL(url).pathname) ? url : null;
}

export function postRequest(value: unknown): PostRequest {
  const input = record(value);
  return { provider: provider(input.provider), id: positiveInteger(input.id) };
}

export function credentialInput(value: unknown): CredentialInput {
  const input = record(value);
  if (typeof input.username !== 'string' || !input.username.trim() || input.username.length > 100 || /[:\u0000-\u001f\u007f]/.test(input.username) ||
      typeof input.apiKey !== 'string' || !/^[!-~]{1,256}$/.test(input.apiKey)) {
    throw new AppError('INVALID_INPUT', 'Enter your site username and an API key without spaces (up to 256 characters).');
  }
  return { provider: provider(input.provider), username: input.username.trim(), apiKey: input.apiKey };
}

export function postUrl(input: PostRequest, source?: ProviderDefinition): string {
  const valid = postRequest(input);
  if (valid.provider === 'e926') return `https://e926.net/posts/${valid.id}`;
  const definition = definitionFor(valid.provider, source);
  return definition.engine === 'gelbooru' ? new URL(`index.php?page=post&s=view&id=${valid.id}`, definition.baseUrl).href :
    new URL(`${definition.engine === 'moebooru' ? 'post/show/' : 'posts/'}${valid.id}`, definition.baseUrl).href;
}

export function mediaUrl(value: unknown, source?: ProviderDefinition): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = publicUrl(value);
    const origins = source ? [new URL(source.baseUrl).origin, ...source.mediaOrigins] : ['https://static1.e621.net', 'https://static2.e621.net'];
    if (!origins.includes(url.origin) || url.search || url.hash ||
        url.username || url.password || url.port || !/\.(?:jpg|jpeg|png|gif|webp|webm|mp4|swf)$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
