import { TAG_CATEGORIES, type GalleryRequest } from '../../shared/contracts';
import { AppError, positiveInteger, record, safeSearchTags, provider } from '../../shared/validation';

export function galleryRequest(value: unknown): GalleryRequest {
  const raw = record(value);
  if (typeof raw.tags !== 'string' || raw.tags.length > 512 || /[\u0000-\u001f\u007f]/.test(raw.tags) ||
    raw.tags.trim().split(/\s+/).filter(Boolean).length > 40 || (raw.safeOnly !== undefined && typeof raw.safeOnly !== 'boolean')) throw new AppError('INVALID_INPUT', 'Use up to 40 gallery terms and 512 characters.');
  return { tags: raw.tags.trim(), page: positiveInteger(raw.page, 1000000), safeOnly: raw.safeOnly !== false,
    ...(raw.collectionId === undefined ? {} : { collectionId: positiveInteger(raw.collectionId) }) };
}

const like = (value: string) => value.replace(/[\\%_]/g, '\\$&');
export function galleryFilter(request: GalleryRequest) {
  const terms = (request.safeOnly ? safeSearchTags(request.tags) : request.tags).split(/\s+/).filter(Boolean);
  const clauses: string[] = []; const values: (string | number)[] = [];
  for (const term of terms) {
    const exclude = term.startsWith('-'); const token = exclude ? term.slice(1) : term;
    const colon = token.indexOf(':'); const kind = colon >= 0 ? token.slice(0, colon).toLowerCase() : '';
    const value = colon >= 0 ? token.slice(colon + 1) : token;
    if (!value || token.startsWith('~') || /[*?]/.test(token)) throw new AppError('INVALID_INPUT', 'Gallery uses exact tags, -exclusions, category:tag, rating:s/q/e, provider:site-id, source:text, type:ext and id:number.');
    let clause: string;
    if (kind === 'rating') {
      if (!['s', 'q', 'e'].includes(value)) throw new AppError('INVALID_INPUT', 'Use rating:s, rating:q or rating:e.');
      clause = "json_extract(s.metadata_json,'$.rating') = ?"; values.push(value);
    } else if (kind === 'provider') {
      provider(value);
      clause = 's.provider = ?'; values.push(value);
    } else if (kind === 'id') {
      if (!/^[1-9]\d*$/.test(value)) throw new AppError('INVALID_INPUT', 'Use a numeric post ID.');
      clause = 's.post_id = ?'; values.push(positiveInteger(Number(value)));
    } else if (kind === 'type') {
      clause = "json_extract(s.metadata_json,'$.file.ext') = ?"; values.push(value.toLowerCase());
    } else if (kind === 'source') {
      clause = "(s.source_url LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(s.metadata_json,'$.sources') src WHERE src.type='text' AND src.value LIKE ? ESCAPE '\\'))";
      values.push(`%${like(value)}%`, `%${like(value)}%`);
    } else {
      if (kind && !TAG_CATEGORIES.includes(kind as typeof TAG_CATEGORIES[number])) throw new AppError('INVALID_INPUT', `Unknown gallery filter: ${kind}.`);
      clause = `EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.source_post_id=s.id AND t.name=?${kind ? ' AND t.category=?' : ''})`;
      values.push(value); if (kind) values.push(kind);
    }
    clauses.push(exclude ? `NOT (${clause})` : `(${clause})`);
  }
  return { sql: clauses.join(' AND ') || '1', values };
}
