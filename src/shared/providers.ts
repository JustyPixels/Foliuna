import type { ProviderDefinition } from './contracts';
import { AppError, record } from './validation';

export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  { id: 'e621', name: 'e621', engine: 'e621', baseUrl: 'https://e621.net/', apiUrl: 'https://e621.net/', auth: 'basic', safeRating: 's', mediaOrigins: ['https://static1.e621.net', 'https://static2.e621.net'] },
  { id: 'danbooru', name: 'Danbooru', engine: 'danbooru', baseUrl: 'https://danbooru.donmai.us/', apiUrl: 'https://danbooru.donmai.us/', auth: 'basic', safeRating: 'g', mediaOrigins: ['https://cdn.donmai.us'] },
  { id: 'gelbooru', name: 'Gelbooru', engine: 'gelbooru', baseUrl: 'https://gelbooru.com/', apiUrl: 'https://gelbooru.com/', auth: 'query', safeRating: 'g', mediaOrigins: ['https://img1.gelbooru.com', 'https://img2.gelbooru.com', 'https://img3.gelbooru.com', 'https://img4.gelbooru.com', 'https://video-cdn1.gelbooru.com', 'https://video-cdn2.gelbooru.com'] },
  { id: 'rule34', name: 'Rule34.xxx', engine: 'gelbooru', baseUrl: 'https://rule34.xxx/', apiUrl: 'https://api.rule34.xxx/', auth: 'query', safeRating: 's', mediaOrigins: ['https://us.rule34.xxx', 'https://wimg.rule34.xxx', 'https://api-cdn.rule34.xxx', 'https://api-cdn-mp4.rule34.xxx', 'https://s1.rule34.xxx', 'https://s2.rule34.xxx', 'https://s3.rule34.xxx', 'https://s4.rule34.xxx'] },
  { id: 'safebooru', name: 'Safebooru', engine: 'gelbooru', baseUrl: 'https://safebooru.org/', apiUrl: 'https://safebooru.org/', auth: 'query', safeRating: 'g', mediaOrigins: [] },
  { id: 'aibooru', name: 'AIBooru', engine: 'danbooru', baseUrl: 'https://aibooru.online/', apiUrl: 'https://aibooru.online/', auth: 'basic', safeRating: 'g', mediaOrigins: ['https://cdn.aibooru.download'] },
  { id: 'yandere', name: 'Yande.re', engine: 'moebooru', baseUrl: 'https://yande.re/', apiUrl: 'https://yande.re/', auth: 'none', safeRating: 's', mediaOrigins: ['https://files.yande.re', 'https://assets.yande.re'] },
  { id: 'konachan', name: 'Konachan', engine: 'moebooru', baseUrl: 'https://konachan.com/', apiUrl: 'https://konachan.com/', auth: 'none', safeRating: 's', mediaOrigins: [] },
];

export const PROVIDER_ID = /^(?:e621|e926|danbooru|gelbooru|rule34|safebooru|aibooru|yandere|konachan|custom-[a-f0-9]{32})$/;

export function publicUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new AppError('INVALID_INPUT', 'Enter a public HTTPS URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('INVALID_INPUT', 'Enter a public HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname) || /[:\[\]]/.test(url.hostname) || /^\d+(?:\.\d+){3}$/.test(url.hostname)) {
    throw new AppError('INVALID_INPUT', 'Only public HTTPS sites on the standard port are supported.');
  }
  return url;
}

export function providerDefinition(value: unknown): ProviderDefinition {
  const raw = record(value);
  if (typeof raw.id !== 'string' || !PROVIDER_ID.test(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(raw.name) || !['e621', 'danbooru', 'gelbooru', 'moebooru'].includes(String(raw.engine)) ||
      !['basic', 'query', 'none'].includes(String(raw.auth)) || !['s', 'g'].includes(String(raw.safeRating)) || !Array.isArray(raw.mediaOrigins) || raw.mediaOrigins.length > 24) throw new AppError('INVALID_INPUT', 'Invalid booru configuration.');
  const base = publicUrl(raw.baseUrl); const api = publicUrl(raw.apiUrl);
  if ([base, api].some((url) => url.search || url.hash || /%|\\/.test(url.pathname))) throw new AppError('INVALID_INPUT', 'Use a site or API base URL without query parameters.');
  const mediaOrigins = [...new Set(raw.mediaOrigins.map((value) => {
    const url = publicUrl(value);
    if (url.pathname !== '/' || url.search || url.hash) throw new AppError('INVALID_INPUT', 'Media hosts must be HTTPS origins without paths.');
    return url.origin;
  }))];
  return { id: raw.id, name: raw.name.trim(), engine: raw.engine as ProviderDefinition['engine'], baseUrl: base.href.replace(/\/?$/, '/'),
    apiUrl: api.href.replace(/\/?$/, '/'), auth: raw.auth as ProviderDefinition['auth'], safeRating: raw.safeRating as 's' | 'g', mediaOrigins };
}

export function definitionFor(id: string, archived?: unknown): ProviderDefinition {
  const builtin = BUILTIN_PROVIDERS.find((entry) => entry.id === (id === 'e926' ? 'e621' : id));
  if (builtin) return builtin;
  const definition = providerDefinition(archived);
  if (definition.id !== id || !id.startsWith('custom-')) throw new AppError('INVALID_INPUT', 'This source needs its original booru configuration.');
  return definition;
}
