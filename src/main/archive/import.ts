import { opendir, lstat, open, rm } from 'node:fs/promises';
import { dirname, extname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TAG_CATEGORIES, type LibraryReport } from '../../shared/contracts';
import { AppError, positiveInteger, postUrl, provider, record } from '../../shared/validation';
import { normalizePost } from '../adapters/e621';
import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaSignature } from '../media-formats';
import { writeAtomic } from '../atomic-file';
import { digest, mediaPath, readLocal, sha256 } from './local-files';
import { assetSidecar, portableMetadata, type SidecarSource } from './metadata';
import { publishNoReplace } from './publication';
import type { Library } from './library';

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const fingerprint = (snapshot: SidecarSource['snapshots'][number]) => digest(Buffer.from(stable(snapshot)));
export function parseSidecar(value: unknown) {
  const raw = record(value); const asset = record(raw.asset);
  if (raw.schemaVersion !== 1 || typeof asset.mediaFile !== 'string' || !asset.mediaFile || asset.mediaFile.length > 240 ||
    /[\\/:\u0000-\u001f\u007f]/.test(asset.mediaFile) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(asset.mediaFile) || ['.', '..'].includes(asset.mediaFile) || /[. ]$/.test(asset.mediaFile) ||
    !Array.isArray(raw.sources) || !raw.sources.length || raw.sources.length > 100) throw new AppError('INVALID_SIDECAR', 'Unsupported sidecar schema, filename or source list.');
  const hash = sha256(asset.sha256); const bytes = positiveInteger(asset.byteSize, MAX_MEDIA_BYTES);
  const extension = extname(asset.mediaFile).slice(1).toLowerCase();
  if (!Object.hasOwn(MEDIA_TYPES, extension)) throw new AppError('INVALID_SIDECAR', 'Unsupported original format.');
  const identities = new Set<string>();
  const sources: SidecarSource[] = raw.sources.map((value) => {
    const source = record(value); const site = provider(source.provider); const id = positiveInteger(source.postId);
    const identity = `${site}:${id}`;
    if (identities.has(identity) || !Array.isArray(source.snapshots) || !source.snapshots.length || source.snapshots.length > 1000) throw new AppError('INVALID_SIDECAR', 'Invalid source identity or capture history.');
    identities.add(identity);
    const snapshots = source.snapshots.map((value) => {
      const snapshot = record(value); const tags = record(snapshot.categorizedTags);
      if (typeof snapshot.capturedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new AppError('INVALID_SIDECAR', 'Invalid capture date.');
      for (const category of TAG_CATEGORIES) if (!Array.isArray(tags[category]) || (tags[category] as unknown[]).length > 2000 ||
        !(tags[category] as unknown[]).every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 200 && !/[\s\u0000-\u001f\u007f]/.test(tag))) throw new AppError('INVALID_SIDECAR', 'Invalid categorized tags.');
      const metadata = portableMetadata(record(snapshot.metadata)); const post = normalizePost(metadata, site);
      if (source.url !== postUrl({ provider: site, id }, post.source) || post.id !== id || post.file.size !== bytes || (post.file.extension !== extension && !['jpg', 'jpeg'].every((ext) => [post.file.extension, extension].includes(ext))) ||
        TAG_CATEGORIES.some((category) => stable([...new Set(post.tags[category])].sort()) !== stable([...new Set(tags[category] as string[])].sort()))) throw new AppError('INVALID_SIDECAR', 'Capture metadata does not match its identity, media or tags.');
      return { capturedAt: new Date(snapshot.capturedAt).toISOString(), metadata, categorizedTags: post.tags };
    }).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    return { provider: site, postId: id, url: String(source.url), snapshots };
  });
  return { hash, bytes, extension, mediaFile: asset.mediaFile, sources };
}

export async function* libraryFiles(root: string, signal: AbortSignal): AsyncGenerator<string> {
  let count = 0;
  async function* walk(part: string, depth: number): AsyncGenerator<string> {
    signal.throwIfAborted();
    const info = await lstat(join(root, part));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('UNSAFE_LIBRARY', 'Library scan does not follow folder links.');
    const directory = await opendir(join(root, part));
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++count > 100000) throw new AppError('SCAN_LIMIT', 'Scan stopped after 100,000 entries. Put imports in a smaller library folder.');
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const name = part ? `${part}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (depth < 8) yield* walk(name, depth + 1); }
      else if (entry.isFile()) yield name;
    }
  }
  yield* walk('', 0);
}

export async function publishVerified(root: string, part: string, bytes: Buffer, hash: string) {
  try {
    const existing = await readLocal(root, part);
    if (existing.length !== bytes.length || digest(existing) !== hash) throw new AppError('CONFLICT', 'Existing destination differs. It was preserved; move the conflicting file aside before retrying.');
    return;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const stage = join(root, '.foliuna', 'staging', `${randomUUID()}.import`);
  const file = await open(stage, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  try {
    await publishNoReplace(stage, join(root, part));
    if (digest(await readLocal(root, part)) !== hash) throw new AppError('CONFLICT', 'Existing destination differs. It was preserved; move the conflicting file aside before retrying.');
  } finally { await rm(stage, { force: true }); }
}

function importRows(library: Library, data: ReturnType<typeof parseSidecar>, part: string) {
  const db = library.db;
  for (const source of data.sources) {
    const existing = db.prepare('SELECT a.sha256 FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE provider=? AND post_id=?').get(source.provider, source.postId);
    if (existing && existing.sha256 !== data.hash) throw new AppError('CONFLICT', 'This source already points to different bytes. Earlier media and metadata were preserved.');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO assets(sha256,relative_path,byte_size,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(data.hash, part, data.bytes, data.sources[0].snapshots[0].capturedAt);
    const asset = db.prepare('SELECT id,relative_path,byte_size FROM assets WHERE sha256=?').get(data.hash)!;
    if (asset.relative_path !== part || asset.byte_size !== data.bytes) throw new AppError('CONFLICT', 'Existing asset location or size differs.');
    for (const source of data.sources) {
      const latest = source.snapshots.at(-1)!;
      const prior = db.prepare('SELECT id FROM source_posts WHERE provider=? AND post_id=?').get(source.provider, source.postId);
      db.prepare('INSERT INTO source_posts(asset_id,provider,post_id,source_url,metadata_json,captured_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(asset.id, source.provider, source.postId, source.url, JSON.stringify(latest.metadata), latest.capturedAt);
      const row = db.prepare('SELECT id,captured_at FROM source_posts WHERE provider=? AND post_id=?').get(source.provider, source.postId)!;
      const captures = db.prepare('SELECT captured_at,metadata_json,tags_json FROM source_snapshots WHERE source_post_id=?').all(row.id);
      const known = new Set(captures.map((capture) => fingerprint({ capturedAt: String(capture.captured_at), metadata: JSON.parse(String(capture.metadata_json)), categorizedTags: JSON.parse(String(capture.tags_json)) })));
      for (const snapshot of source.snapshots) {
        const key = fingerprint(snapshot); if (known.has(key)) continue;
        db.prepare('INSERT INTO source_snapshots(capture_id,source_post_id,metadata_json,tags_json,captured_at) VALUES(?,?,?,?,?)').run(`import-${source.provider}-${source.postId}-${key}`, row.id, JSON.stringify(snapshot.metadata), JSON.stringify(snapshot.categorizedTags), snapshot.capturedAt);
        known.add(key);
      }
      if (!prior || Date.parse(latest.capturedAt) > Date.parse(String(row.captured_at))) {
        db.prepare('UPDATE source_posts SET metadata_json=?,captured_at=? WHERE id=?').run(JSON.stringify(latest.metadata), latest.capturedAt, row.id);
        db.prepare('DELETE FROM post_tags WHERE source_post_id=?').run(row.id);
        for (const category of TAG_CATEGORIES) for (const tag of new Set(latest.categorizedTags[category])) {
          db.prepare('INSERT INTO tags(name,category) VALUES(?,?) ON CONFLICT DO NOTHING').run(tag, category);
          const id = db.prepare('SELECT id FROM tags WHERE name=? AND category=?').get(tag, category)!.id;
          db.prepare('INSERT INTO post_tags VALUES(?,?)').run(row.id, id);
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

const report = (): LibraryReport => ({ checked: 0, imported: 0, recovered: 0, missing: 0, invalid: 0, conflicts: 0, issues: [] });
function issue(result: LibraryReport, file: string, error: unknown) {
  if (error instanceof AppError && error.code === 'CONFLICT') result.conflicts++; else result.invalid++;
  if (result.issues.length < 50) result.issues.push({ file, message: error instanceof AppError ? error.message : 'File could not be verified or written. It was preserved.' });
}

export async function importSidecars(library: Library, signal: AbortSignal): Promise<LibraryReport> {
  const result = report();
  try {
    const names: string[] = [];
    for await (const name of libraryFiles(library.root, signal)) if (name.endsWith('.foliuna.json')) names.push(name);
    for (const name of names) {
      signal.throwIfAborted();
      result.checked++;
      try {
        const data = parseSidecar(JSON.parse((await readLocal(library.root, name, 16 * 1024 * 1024)).toString('utf8')));
        const existingAsset = library.db.prepare('SELECT relative_path,byte_size FROM assets WHERE sha256=?').get(data.hash);
        if (existingAsset && existingAsset.byte_size !== data.bytes) throw new AppError('CONFLICT', 'Existing asset has a different size. It was preserved.');
        const part = mediaPath(data.hash, existingAsset?.relative_path ?? `media/${data.hash}.${data.extension}`);
        const sidecarPath = `${part}.foliuna.json`;
        const datasets = [data];
        if (name !== sidecarPath) {
          try {
            const previous = parseSidecar(JSON.parse((await readLocal(library.root, sidecarPath, 16 * 1024 * 1024)).toString('utf8')));
            if (previous.hash !== data.hash || previous.bytes !== data.bytes || previous.mediaFile !== basename(part)) throw new AppError('CONFLICT', 'Existing destination sidecar differs. It was preserved.');
            datasets.push(previous);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        const source = dirname(name) === '.' ? data.mediaFile : `${dirname(name).replaceAll('\\', '/')}/${data.mediaFile}`;
        const bytes = await readLocal(library.root, source);
        if (bytes.length !== data.bytes || digest(bytes) !== data.hash || !mediaSignature(bytes.subarray(0, 16), data.extension)) throw new AppError('INVALID_SIDECAR', 'Media bytes do not match the sidecar hash, size or format.');
        for (const source of datasets.flatMap((item) => item.sources)) {
          const existing = library.db.prepare('SELECT a.sha256 FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE provider=? AND post_id=?').get(source.provider, source.postId);
          if (existing && existing.sha256 !== data.hash) throw new AppError('CONFLICT', 'A source has a different saved revision. Earlier captures were preserved.');
        }
        signal.throwIfAborted();
        await publishVerified(library.root, part, bytes, data.hash);
        for (const item of datasets) importRows(library, item, part);
        await writeAtomic(join(library.root, sidecarPath), JSON.stringify(assetSidecar(library.db, data.hash), null, 2) + '\n');
        result.imported++;
      } catch (error) { if (signal.aborted) throw error; issue(result, name, error); }
    }
  } catch (error) { if (signal.aborted) throw new AppError('CANCELLED', 'Import stopped. Completed imports were retained; original input files were preserved.'); throw error; }
  return result;
}

export async function reconcileLibrary(library: Library, signal: AbortSignal): Promise<LibraryReport> {
  const result = report(); const missing = new Map<string, { part: string; size: number }>();
  async function checkSidecar(hash: string, part: string, size: number) {
    const sidecarPath = `${part}.foliuna.json`;
    try {
      const data = parseSidecar(JSON.parse((await readLocal(library.root, sidecarPath, 16 * 1024 * 1024)).toString('utf8')));
      if (data.hash !== hash || data.bytes !== size || data.mediaFile !== basename(part)) throw new AppError('CONFLICT', 'Sidecar does not match the saved original. It was preserved.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { issue(result, sidecarPath, error); return; }
      const bytes = Buffer.from(JSON.stringify(assetSidecar(library.db, hash), null, 2) + '\n');
      if (bytes.length > 16 * 1024 * 1024) { issue(result, sidecarPath, new AppError('SIDECAR_SIZE', 'Capture history exceeds the sidecar import size limit. Database history is preserved.')); return; }
      await publishVerified(library.root, sidecarPath, bytes, digest(bytes)); result.recovered++;
    }
  }
  for (const asset of library.db.prepare('SELECT sha256,relative_path,byte_size FROM assets').all()) {
    signal.throwIfAborted(); result.checked++;
    const hash = String(asset.sha256);
    try {
      const part = mediaPath(hash, asset.relative_path); const bytes = await readLocal(library.root, part);
      if (digest(bytes) !== hash || bytes.length !== asset.byte_size || !mediaSignature(bytes.subarray(0, 16), extname(part).slice(1))) throw new AppError('CONFLICT', 'Original has changed or is corrupt. Existing bytes and metadata were preserved.');
      await checkSidecar(hash, part, Number(asset.byte_size));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.set(hash, { part: mediaPath(hash, asset.relative_path), size: Number(asset.byte_size) });
      else issue(result, String(asset.relative_path), error);
    }
  }
  if (missing.size) for await (const part of libraryFiles(library.root, signal)) {
    signal.throwIfAborted(); if (!missing.size) break;
    const extension = extname(part).slice(1).toLowerCase();
    if (!Object.hasOwn(MEDIA_TYPES, extension)) continue;
    try {
      const bytes = await readLocal(library.root, part); const hash = digest(bytes); const expected = missing.get(hash);
      if (!expected || bytes.length !== expected.size) continue;
      await publishVerified(library.root, expected.part, bytes, hash);
      await checkSidecar(hash, expected.part, expected.size);
      missing.delete(hash); result.recovered++;
    } catch (error) { issue(result, part, error); }
  }
  result.missing = missing.size;
  for (const [hash, entry] of missing) if (result.issues.length < 50) result.issues.push({ file: basename(entry.part), message: `Original missing (${hash.slice(0, 12)}). Metadata retained; restore the file or import a valid sidecar.` });
  return result;
}
