import { lstat, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PAGE_SIZE, TAG_CATEGORIES, type Post, type SearchResult, type TagSuggestion } from '../../shared/contracts';
import { AppError, record, postRequest } from '../../shared/validation';
import { normalizePost } from '../adapters/e621';
import { MEDIA_TYPES, mediaSignature } from '../media-formats';
import { writeAtomic } from '../atomic-file';
import { checkedDirectory, checkedFile, digest, mediaPath, readLocal, sha256 } from './local-files';
import { galleryFilter, galleryRequest } from './gallery-query';
import { importSidecars, reconcileLibrary } from './import';
import type { ArchiveLibrary, Library } from './library';
import { loadCollections } from './collections';

export function galleryRoute(value: string) {
  try {
    const url = new URL(value); const match = /^\/gallery\/([0-9a-f]{64})\/(thumbnail|original)$/.exec(url.pathname);
    return url.protocol === 'foliuna:' && ['app', 'player'].includes(url.host) && !url.username && !url.password && !url.search && !url.hash && match ? { hash: match[1], thumbnail: match[2] === 'thumbnail' } : null;
  } catch { return null; }
}

export class Gallery {
  private readonly cache = new Map<string, { bytes: Buffer; stamp: string }>();
  private bytes = 0;
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly library: ArchiveLibrary) {}

  search(input: unknown): Promise<SearchResult> {
    const request = galleryRequest(input); const filter = galleryFilter(request);
    return this.library.access(async (library) => {
      if (request.collectionId !== undefined) {
        const file = await loadCollections(library);
        if (!file.collections.some((item) => item.id === request.collectionId)) throw new AppError('NOT_FOUND', 'This collection no longer exists.');
        filter.sql += ' AND EXISTS(SELECT 1 FROM collection_assets ca WHERE ca.asset_id=s.asset_id AND ca.collection_id=?)';
        filter.values.push(request.collectionId);
      }
      const rows = library.db.prepare(`WITH matching AS (SELECT s.*, row_number() OVER(PARTITION BY asset_id ORDER BY captured_at DESC,id DESC) AS rn FROM source_posts s WHERE ${filter.sql})
        SELECT a.sha256,a.relative_path,a.byte_size,s.provider,s.post_id,s.metadata_json,s.captured_at FROM matching s JOIN assets a ON a.id=s.asset_id WHERE rn=1 ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`)
        .all(...filter.values, PAGE_SIZE + 1, (request.page - 1) * PAGE_SIZE);
      return { posts: await Promise.all(rows.slice(0, PAGE_SIZE).map((row) => this.post(library, row))), page: request.page, hasMore: rows.length > PAGE_SIZE };
    });
  }

  getPost(value: unknown, source?: unknown) {
    const hash = sha256(value);
    const identity = source === undefined ? null : postRequest(source);
    return this.library.access(async (library) => {
      const row = library.db.prepare(`SELECT a.sha256,a.relative_path,a.byte_size,s.provider,s.post_id,s.metadata_json,s.captured_at FROM assets a JOIN source_posts s ON s.asset_id=a.id WHERE a.sha256=? ${identity ? 'AND s.provider=? AND s.post_id=?' : ''} ORDER BY s.captured_at DESC,s.id DESC LIMIT 1`).get(hash, ...(identity ? [identity.provider, identity.id] : []));
      if (!row) throw new AppError('NOT_FOUND', 'This archived image is not in the selected library.');
      return this.post(library, row);
    });
  }

  private async post(library: Library, row: Record<string, unknown>): Promise<Post> {
    const hash = sha256(row.sha256); const path = mediaPath(hash, row.relative_path);
    const post = normalizePost(JSON.parse(String(row.metadata_json)), row.provider as Post['provider']);
    let missing = false;
    try { const file = await checkedFile(library.root, path); missing = file.info.size !== Number(row.byte_size); } catch { missing = true; }
    const extension = extname(path).slice(1);
    const original = missing ? null : `foliuna://app/gallery/${hash}/original`;
    const thumbnail = extension === 'swf' ? null : `foliuna://app/gallery/${hash}/thumbnail`;
    const provenance = library.db.prepare('SELECT provider,post_id FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE a.sha256=? ORDER BY provider,post_id').all(hash).map((source) => ({ provider: source.provider as Post['provider'], id: Number(source.post_id) }));
    return { ...post, unavailable: missing, file: { ...post.file, url: original, extension, size: Number(row.byte_size) },
      previewUrl: thumbnail, sampleUrl: ['webm', 'mp4', 'swf'].includes(extension) ? thumbnail : original ?? thumbnail, originalUrl: original,
      archive: { sha256: hash, capturedAt: String(row.captured_at), sourceCount: provenance.length, missing, provenance } };
  }

  tags(input: unknown): Promise<TagSuggestion[]> {
    if (typeof input !== 'string' || input.length < 2 || input.length > 80 || /[\s\u0000-\u001f\u007f]/.test(input)) throw new AppError('INVALID_INPUT', 'Type a gallery tag prefix of 2–80 characters.');
    const prefix = input.replace(/[\\%_]/g, '\\$&');
    return this.library.access(({ db }) => db.prepare("SELECT t.name,t.category,count(DISTINCT s.asset_id) AS total FROM tags t JOIN post_tags pt ON pt.tag_id=t.id JOIN source_posts s ON s.id=pt.source_post_id WHERE t.name LIKE ? ESCAPE '\\' GROUP BY t.name,t.category ORDER BY total DESC,t.name LIMIT 8")
      .all(`${prefix}%`).map((row) => ({ name: String(row.name), category: TAG_CATEGORIES.indexOf(row.category as typeof TAG_CATEGORIES[number]), count: Number(row.total) })));
  }

  cacheThumbnail(input: unknown): Promise<null> {
    const raw = record(input); const hash = sha256(raw.sha256);
    if (!(raw.png instanceof Uint8Array) || raw.png.byteLength < 24 || raw.png.byteLength > 2 * 1024 * 1024) throw new AppError('INVALID_INPUT', 'Invalid thumbnail bytes.');
    const bytes = Buffer.from(raw.png);
    if (!mediaSignature(bytes, 'png') || bytes.subarray(12, 16).toString() !== 'IHDR' || ![bytes.readUInt32BE(16), bytes.readUInt32BE(20)].every((size) => size > 0 && size <= 512)) throw new AppError('INVALID_INPUT', 'Thumbnails must be PNG images up to 512 pixels.');
    return this.library.access(async ({ root, db }) => {
      if (!db.prepare('SELECT id FROM assets WHERE sha256=?').get(hash)) throw new AppError('NOT_FOUND', 'Unknown archived image.');
      await checkedDirectory(root, '.foliuna');
      const folder = join(root, '.foliuna', 'thumbnails'); await mkdir(folder, { recursive: true });
      const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('UNSAFE_LIBRARY', 'Thumbnail cache is not a regular folder.');
      const part = `.foliuna/thumbnails/${hash}.png`;
      try { await checkedFile(root, part, 2 * 1024 * 1024); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await writeAtomic(join(root, part), bytes); return null;
    });
  }

  importSidecars() { return this.library.maintain((library, signal) => importSidecars(library, signal)); }
  reconcile() { return this.library.maintain(async (library, signal) => {
    try { return await reconcileLibrary(library, signal); }
    catch (error) { if (signal.aborted) throw new AppError('CANCELLED', 'Library check stopped. Completed recoveries were retained; existing files were preserved.'); throw error; }
  }); }

  async handle(request: Request): Promise<Response> {
    const route = galleryRoute(request.url);
    if (!route || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
    if (this.waiting.length >= 48) return new Response(null, { status: 429 });
    if (this.active >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve)); else this.active++;
    try {
      request.signal.throwIfAborted();
      const data = await this.library.access(async ({ root, db }) => {
        const row = db.prepare('SELECT relative_path,byte_size FROM assets WHERE sha256=?').get(route.hash);
        if (!row) throw new AppError('NOT_FOUND', 'Unknown archived image.');
        const part = route.thumbnail ? `.foliuna/thumbnails/${route.hash}.png` : mediaPath(route.hash, row.relative_path);
        const file = await checkedFile(root, part, route.thumbnail ? 2 * 1024 * 1024 : undefined);
        const key = `${root}/${part}`; const stamp = `${file.info.dev}:${file.info.ino}:${file.info.size}:${file.info.mtimeMs}:${file.info.ctimeMs}`;
        let cached = this.cache.get(key);
        if (cached && cached.stamp !== stamp) { this.bytes -= cached.bytes.length; this.cache.delete(key); cached = undefined; }
        const bytes = cached?.bytes ?? await readLocal(root, part, route.thumbnail ? 2 * 1024 * 1024 : undefined);
        const extension = route.thumbnail ? 'png' : extname(part).slice(1);
        if (!mediaSignature(bytes.subarray(0, 24), extension) || (!route.thumbnail && (bytes.length !== Number(row.byte_size) || (!cached && digest(bytes) !== route.hash)))) throw new AppError('INVALID_MEDIA', 'Archived original failed integrity checks.');
        if (!cached) {
          const prior = this.cache.get(key); if (prior) { this.bytes -= prior.bytes.length; this.cache.delete(key); }
          while (this.cache.size && (this.bytes + bytes.length > 128 * 1024 * 1024 || this.cache.size >= 256)) { const first = this.cache.keys().next().value!; this.bytes -= this.cache.get(first)!.bytes.length; this.cache.delete(first); }
          this.cache.set(key, { bytes, stamp }); this.bytes += bytes.length;
        }
        return { bytes, mime: MEDIA_TYPES[extension] };
      });
      const headers = new Headers({ 'Content-Type': data.mime, 'Content-Length': String(data.bytes.length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
      let start = 0; let end = data.bytes.length - 1; let status = 200;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        start = match?.[1] ? Number(match[1]) : Math.max(0, data.bytes.length - Number(match?.[2]));
        end = match?.[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= data.bytes.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.bytes.length}` } });
        status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${data.bytes.length}`); headers.set('Content-Length', String(end - start + 1));
      }
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(data.bytes.subarray(start, end + 1)), { status, headers });
    } catch { return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
