import { BUILTIN_PROVIDERS } from '../../src/shared/providers';
import { customProvider } from '../../src/main/providers';
import { demoRawPost } from './posts';
import { compatibleMetadata } from '../../src/main/adapters/compatible';
import { normalizePost } from '../../src/main/adapters/e621';

export const previewPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=';
const custom = customProvider({ name: 'Fixture booru', engine: 'danbooru', baseUrl: 'https://custom.booru.org/', apiUrl: 'https://custom.booru.org/api/', auth: 'basic', safeRating: 'g', mediaOrigins: ['https://cdn.booru.org'] });
export const compatibility = [...BUILTIN_PROVIDERS, custom].map((source) => {
  const url = (source.mediaOrigins[0] ?? new URL(source.baseUrl).origin) + '/fixture.png';
  const raw = source.engine === 'e621' ? { ...demoRawPost(42), file: { url, ext: 'png', width: 1, height: 1, size: Buffer.from(previewPng, 'base64').length, md5: null }, preview: { url }, sample: { url } } :
    { id: 42, rating: source.safeRating, tag_string: 'forest artist_one', tags: 'forest artist_one', tag_string_general: 'forest', tag_string_artist: 'artist_one',
      file_url: url, preview_file_url: url, preview_url: url, large_file_url: url, sample_url: url, file_ext: 'png', image_width: 1, image_height: 1, file_size: Buffer.from(previewPng, 'base64').length,
      score: 12, fav_count: 4, source: 'https://artist.org/art', provider_only_field: { license: 'preserve-me' } };
  const metadata = source.engine === 'e621' ? raw : compatibleMetadata(raw, source);
  return { source, raw, expected: normalizePost(metadata, source.id) };
});
