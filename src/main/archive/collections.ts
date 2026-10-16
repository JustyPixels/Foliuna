import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Collection } from '../../shared/contracts';
import { AppError, positiveInteger, record } from '../../shared/validation';
import { writeAtomic } from '../atomic-file';
import { checkedDirectory, digest, readLocal, sha256 } from './local-files';
import type { ArchiveLibrary, Library } from './library';

const path = '.foliuna/collections.json';
const maximumBytes = 16 * 1024 * 1024;
interface CollectionFile { schemaVersion: 1; nextId: number; collections: { id: number; name: string; assets: string[] }[] }
const projected = new WeakMap<DatabaseSync, string>();

export function collectionName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new AppError('INVALID_INPUT', 'Use a collection name of 1–100 characters.');
  return value.trim().normalize('NFC');
}

export function collectionFile(value: unknown): CollectionFile {
  const raw = record(value);
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.collections) || raw.collections.length > 500) throw new AppError('COLLECTIONS_FILE', 'Unsupported collection file. It was preserved; restore a valid backup to use Collections.');
  const nextId = positiveInteger(raw.nextId); const ids = new Set<number>(); const names = new Set<string>(); let total = 0;
  const collections = raw.collections.map((value) => {
    const item = record(value); const id = positiveInteger(item.id); const name = collectionName(item.name);
    if (id >= nextId || ids.has(id) || names.has(name.toLowerCase()) || !Array.isArray(item.assets) || item.assets.length > 10000 || (total += item.assets.length) > 100000) throw new AppError('COLLECTIONS_FILE', 'Invalid or oversized collection file. Existing data was preserved.');
    ids.add(id); names.add(name.toLowerCase());
    const assets = item.assets.map(sha256);
    if (new Set(assets).size !== assets.length) throw new AppError('COLLECTIONS_FILE', 'Duplicate collection membership in the saved file. It was preserved.');
    return { id, name, assets };
  });
  return { schemaVersion: 1, nextId, collections };
}

function fromDatabase({ db }: Library): CollectionFile {
  const collections = db.prepare('SELECT id,name FROM collections ORDER BY id').all().map((row) => ({ id: Number(row.id), name: String(row.name),
    assets: db.prepare('SELECT a.sha256 FROM collection_assets c JOIN assets a ON a.id=c.asset_id WHERE c.collection_id=? ORDER BY a.sha256').all(row.id).map((asset) => String(asset.sha256)) }));
  return collectionFile({ schemaVersion: 1, nextId: Math.max(0, ...collections.map((item) => item.id)) + 1, collections });
}

function project(library: Library, file: CollectionFile, signature: string) {
  const db = library.db;
  const key = `${signature}:${db.prepare('SELECT count(*) n FROM assets').get()!.n}`;
  if (projected.get(db) === key) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // SQLite is the searchable projection; the atomically saved file retains unindexed hashes too.
    db.exec('DELETE FROM collection_assets; DELETE FROM collections;');
    const insert = db.prepare('INSERT INTO collections(id,name) VALUES(?,?)');
    const member = db.prepare('INSERT INTO collection_assets(collection_id,asset_id) SELECT ?,id FROM assets WHERE sha256=?');
    for (const item of file.collections) { insert.run(item.id, item.name); for (const hash of item.assets) member.run(item.id, hash); }
    db.exec('COMMIT'); projected.set(db, key);
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
}

export async function loadCollections(library: Library): Promise<CollectionFile> {
  let bytes: Buffer;
  try { bytes = await readLocal(library.root, path, maximumBytes); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (projected.has(library.db)) throw new AppError('COLLECTIONS_FILE', 'The collection file is missing. Restore it from backup before changing collections.');
      return fromDatabase(library);
    }
    throw new AppError('COLLECTIONS_FILE', 'The collection file could not be safely read. It was preserved. Gallery remains available.');
  }
  let file: CollectionFile;
  try { file = collectionFile(JSON.parse(bytes.toString('utf8'))); }
  catch { throw new AppError('COLLECTIONS_FILE', 'The collection file is invalid or from a newer version. It was preserved. Restore a valid backup; Gallery remains available.'); }
  project(library, file, digest(bytes)); return file;
}

function summaries(library: Library, file: CollectionFile, hash?: string): Collection[] {
  const counts = new Map(library.db.prepare('SELECT collection_id,count(*) n FROM collection_assets GROUP BY collection_id').all().map((row) => [Number(row.collection_id), Number(row.n)]));
  return file.collections.map((item) => ({ id: item.id, name: item.name, assets: counts.get(item.id) ?? 0,
    pending: item.assets.length - (counts.get(item.id) ?? 0), ...(hash ? { contains: item.assets.includes(hash) } : {}) })).sort((a, b) => a.name.localeCompare(b.name));
}

export class Collections {
  constructor(private readonly library: ArchiveLibrary) {}
  list(input?: unknown) {
    const hash = input === undefined ? undefined : sha256(record(input).sha256);
    return this.library.access(async (library) => summaries(library, await loadCollections(library), hash));
  }
  private mutate(action: (file: CollectionFile, library: Library) => void) {
    return this.library.maintain(async (library, signal) => {
      const file = await loadCollections(library); signal.throwIfAborted(); action(file, library);
      const valid = collectionFile(file); const bytes = Buffer.from(JSON.stringify(valid, null, 2) + '\n');
      if (bytes.length > maximumBytes) throw new AppError('COLLECTIONS_LIMIT', 'Collections exceed the 16 MiB portable file limit.');
      await checkedDirectory(library.root, '.foliuna');
      signal.throwIfAborted();
      try { await writeAtomic(join(library.root, path), bytes); }
      catch { throw new AppError('COLLECTIONS_WRITE', 'Collection changes could not be saved. Check free space and folder permissions; retry after fixing them.'); }
      try { project(library, valid, digest(bytes)); }
      catch { throw new AppError('COLLECTIONS_RECOVERY', 'The collection file was saved but its index needs recovery. Reopen Collections to restore it.'); }
      return summaries(library, valid);
    });
  }
  create(input: unknown) {
    const name = collectionName(record(input).name);
    return this.mutate((file) => {
      this.unique(file, name);
      if (file.collections.length >= 500) throw new AppError('COLLECTIONS_LIMIT', 'This library supports up to 500 collections.');
      file.collections.push({ id: file.nextId++, name, assets: [] });
    });
  }
  rename(input: unknown) {
    const raw = record(input); const id = positiveInteger(raw.id); const name = collectionName(raw.name);
    return this.mutate((file) => { this.unique(file, name, id); this.find(file, id).name = name; });
  }
  remove(input: unknown) {
    const id = positiveInteger(input);
    return this.mutate((file) => { this.find(file, id); file.collections = file.collections.filter((item) => item.id !== id); });
  }
  membership(input: unknown) {
    const raw = record(input); const id = positiveInteger(raw.id); const hash = sha256(raw.sha256);
    if (typeof raw.present !== 'boolean') throw new AppError('INVALID_INPUT', 'Choose whether this item belongs in the collection.');
    return this.mutate((file, library) => {
      const item = this.find(file, id);
      if (raw.present && !library.db.prepare('SELECT id FROM assets WHERE sha256=?').get(hash)) throw new AppError('NOT_FOUND', 'Download or import this media into the library before collecting it.');
      if (raw.present && !item.assets.includes(hash) && (item.assets.length >= 10000 || file.collections.reduce((sum, item) => sum + item.assets.length, 0) >= 100000)) throw new AppError('COLLECTIONS_LIMIT', 'Use up to 10,000 items per collection and 100,000 memberships per library.');
      item.assets = item.assets.filter((value) => value !== hash);
      if (raw.present) item.assets.push(hash);
    });
  }
  private find(file: CollectionFile, id: number) {
    const item = file.collections.find((item) => item.id === id);
    if (!item) throw new AppError('NOT_FOUND', 'This collection no longer exists in the selected library.');
    return item;
  }
  private unique(file: CollectionFile, name: string, id?: number) {
    if (file.collections.some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) throw new AppError('COLLECTION_EXISTS', 'A collection with this name already exists.');
  }
}
