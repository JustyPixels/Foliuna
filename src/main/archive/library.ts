import { publicFetch } from '../public-fetch';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TAG_CATEGORIES, type ArchiveResult, type CategorizedTags, type LibraryStatus, type PostRequest, type Provider } from '../../shared/contracts';
import { AppError, positiveInteger, postRequest, postUrl, provider, record } from '../../shared/validation';
import type { BooruAdapter } from '../adapters/types';
import { normalizePost } from '../adapters/e621';
import { openLibrary } from '../database';
import { writeAtomic } from '../atomic-file';
import { hashFile, MAX_MEDIA_BYTES, MEDIA_TYPES, transfer } from './media';
import { jsonRecord, portableMetadata, sidecar, type SidecarSource } from './metadata';
import { publishNoReplace } from './publication';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface Plan { stage: string; sha256: string; bytes: number; extension: string; provider: Provider; postId: number; capturedAt: string; metadata: Record<string, unknown> }
export interface Library { root: string; db: DatabaseSync; release(): Promise<void> }

async function directory(path: string) {
  await mkdir(path, { recursive: true });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AppError('UNSAFE_LIBRARY', 'Library folders must be real directories, not symbolic links.');
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError('UNSAFE_LIBRARY', 'An unexpected file or link was found. Nothing was overwritten.');
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function checkPublication(root: string) {
  const probe = join(root, '.foliuna', 'staging', `${randomUUID()}.probe`);
  const linked = `${probe}.link`;
  try {
    const file = await open(probe, 'wx', 0o600);
    await file.close();
    await publishNoReplace(probe, linked);
  } catch { throw new AppError('FILESYSTEM', 'This folder must support safe file creation. Check write permissions and free space.'); }
  finally { await rm(linked, { force: true }); await rm(probe, { force: true }); }
}

async function acquire(root: string): Promise<() => Promise<void>> {
  const path = join(root, '.foliuna', 'library.lock');
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(token); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!await regularFile(path) || (await lstat(path)).size > 4096) throw new AppError('LIBRARY_BUSY', 'The library lock is invalid. Choose another library.');
    let content: string;
    let pid: number;
    try { content = await readFile(path, 'utf8'); pid = positiveInteger(record(JSON.parse(content)).pid, 0x7fffffff); }
    catch { throw new AppError('LIBRARY_BUSY', 'The library lock is invalid. Choose another library.'); }
    try { process.kill(pid, 0); }
    catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === 'ESRCH' && await readFile(path, 'utf8') === content) {
        await rm(path);
        return acquire(root);
      }
    }
    throw new AppError('LIBRARY_BUSY', 'This library is open in another Foliuna instance. Close it first.');
  }
  return async () => { if (await regularFile(path) && await readFile(path, 'utf8') === token) await rm(path); };
}

function parsePlan(value: unknown, capture: string): Plan {
  const raw = record(value);
  if (!uuid.test(capture) || raw.stage !== `${capture}.part` || typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256) ||
      typeof raw.extension !== 'string' || !Object.hasOwn(MEDIA_TYPES, raw.extension) || typeof raw.capturedAt !== 'string' ||
      !Number.isFinite(Date.parse(raw.capturedAt))) throw new AppError('RECOVERY', 'A download journal entry is invalid. It was preserved for recovery.');
  const site = provider(raw.provider);
  const metadata = portableMetadata(record(raw.metadata));
  const post = normalizePost(metadata, site);
  const postId = positiveInteger(raw.postId);
  if (post.id !== postId) throw new AppError('RECOVERY', 'A download snapshot has an unexpected post identity.');
  return { stage: raw.stage as string, sha256: raw.sha256, bytes: positiveInteger(raw.bytes, MAX_MEDIA_BYTES),
    extension: raw.extension, provider: site, postId, capturedAt: raw.capturedAt, metadata };
}

export class ArchiveLibrary {
  private library: Library | null = null;
  private issue: string | null = null;
  private controller: AbortController | null = null;
  private changing = false;
  private settled: Promise<void> = Promise.resolve();
  private selectionSettled: Promise<void> = Promise.resolve();
  private closing = false;
  private readonly reads = new Set<Promise<unknown>>();
  constructor(private readonly profile: string, private readonly adapters: Partial<Record<Provider, BooruAdapter>>,
    private readonly demo: boolean, private readonly fetcher: typeof fetch = publicFetch) {}

  status(): LibraryStatus {
    return { assets: this.library ? Number(this.library.db.prepare('SELECT count(*) AS count FROM assets').get()!.count) : 0,
      schemaVersion: 3, demo: this.demo, root: this.library?.root ?? null, issue: this.issue };
  }

  async initialize() {
    try {
      const settings = record(JSON.parse(await readFile(join(this.profile, 'library.json'), 'utf8')));
      if (typeof settings.root !== 'string') throw new Error();
      await this.select(settings.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.issue = 'The selected library could not be opened. Choose a library in Settings to retry.';
    }
  }

  async select(path: string): Promise<LibraryStatus> {
    if (this.closing || this.controller || this.changing || this.reads.size) throw new AppError('BUSY', 'Wait for the current library operation to finish.');
    this.changing = true;
    let settle!: () => void;
    this.selectionSettled = new Promise((resolve) => { settle = resolve; });
    let next: Library | null = null;
    try {
      const root = await realpath(resolve(path));
      if (root === this.library?.root) { await this.recover(this.library); return this.status(); }
      await directory(root);
      await directory(join(root, '.foliuna'));
      await directory(join(root, '.foliuna', 'staging'));
      await directory(join(root, 'media'));
      await checkPublication(root);
      const release = await acquire(root);
      try {
        await regularFile(join(root, '.foliuna', 'library.sqlite'));
        for (const suffix of ['-wal', '-shm', '-journal']) await regularFile(join(root, '.foliuna', `library.sqlite${suffix}`));
        next = { root, release, db: openLibrary(join(root, '.foliuna', 'library.sqlite')) };
      } catch (error) { await release(); throw error; }
      await writeAtomic(join(this.profile, 'library.json'), JSON.stringify({ root }));
      if (this.library) { this.library.db.close(); await this.library.release(); }
      this.library = next; next = null;
      await this.recover(this.library);
      return this.status();
    } catch (error) {
      if (next) { next.db.close(); await next.release(); }
      if (error instanceof AppError) throw error;
      throw new AppError('LIBRARY_OPEN', 'Could not open this library. Check the folder, free space and permissions.');
    } finally { this.changing = false; settle(); }
  }

  private async folders(library: Library) {
    await directory(library.root);
    await directory(join(library.root, '.foliuna'));
    await directory(join(library.root, '.foliuna', 'staging'));
    await directory(join(library.root, 'media'));
  }

  private async recover(library: Library) {
    try {
      await this.folders(library);
      const rows = library.db.prepare('SELECT id,phase,payload_json FROM download_journal ORDER BY rowid').all();
      for (const row of rows) {
        const capture = String(row.id);
        const data = jsonRecord(row.payload_json);
        if (!uuid.test(capture) || data.stage !== `${capture}.part`) throw new AppError('RECOVERY', 'A download journal entry is invalid.');
        if (row.phase === 'prepared') await this.finish(library, capture, parsePlan(data, capture));
        else if (row.phase === 'downloading') {
          await rm(join(library.root, '.foliuna', 'staging', `${capture}.part`), { force: true });
          library.db.prepare('DELETE FROM download_journal WHERE id=?').run(capture);
        } else throw new AppError('RECOVERY', 'Unknown journal phase.');
      }
      this.issue = null;
    } catch {
      this.issue = 'An interrupted archive needs recovery. Check free space and library files, then choose this folder again in Settings. Existing data was preserved.';
      throw new AppError('RECOVERY', this.issue);
    }
  }

  cancel(): null { this.controller?.abort(); return null; }

  async download(input: PostRequest): Promise<ArchiveResult> {
    const request = postRequest(input);
    if (this.demo) throw new AppError('DEMO', 'Demo posts have no original media. Use live mode to archive a real post.');
    if (!this.library) throw new AppError('LIBRARY_REQUIRED', 'Choose your archive folder in Settings first.');
    if (this.closing || this.controller || this.changing) throw new AppError('BUSY', 'Another download or library change is in progress.');
    const controller = new AbortController();
    this.controller = controller;
    let settle!: () => void;
    this.settled = new Promise((resolve) => { settle = resolve; });
    const library = this.library;
    const capture = randomUUID();
    const stage = `${capture}.part`;
    let prepared = false;
    try {
      await this.recover(library);
      const adapter = this.adapters[request.provider];
      if (!adapter) throw new AppError('UNAVAILABLE', 'This booru is not configured for downloads. Existing archive records remain preserved.');
      const snapshot = await adapter.getSnapshot(request.id, controller.signal);
      controller.signal.throwIfAborted();
      library.db.prepare('INSERT INTO download_journal VALUES(?,?,?)').run(capture, 'downloading', JSON.stringify({ stage }));
      const media = await transfer(snapshot.post, join(library.root, '.foliuna', 'staging', stage), controller.signal, this.fetcher);
      if (snapshot.post.source) record(snapshot.metadata.file).size = media.bytes;
      controller.signal.throwIfAborted();
      const previous = library.db.prepare('SELECT a.sha256 FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE s.provider=? AND s.post_id=?').get(request.provider, request.id);
      if (previous && previous.sha256 !== media.sha256) throw new AppError('SOURCE_CHANGED', 'This post now has different media. Your earlier capture remains in Gallery. Choose a different archive folder to keep the new revision too; saved revisions are never replaced automatically.');
      const plan: Plan = { ...media, stage, provider: request.provider, postId: request.id,
        capturedAt: new Date().toISOString(), metadata: portableMetadata(snapshot.metadata) };
      library.db.prepare('UPDATE download_journal SET phase=?,payload_json=? WHERE id=?').run('prepared', JSON.stringify(plan), capture);
      prepared = true;
      const duplicate = Boolean(library.db.prepare('SELECT id FROM assets WHERE sha256=?').get(media.sha256));
      const relativePath = await this.finish(library, capture, parsePlan(plan, capture));
      return { sha256: media.sha256, relativePath, duplicate };
    } catch (error) {
      if (prepared) {
        this.issue = 'The transfer completed, but archiving needs recovery. Choose the same library in Settings to retry safely.';
        throw new AppError('RECOVERY', this.issue);
      }
      await rm(join(library.root, '.foliuna', 'staging', stage), { force: true }).catch(() => undefined);
      library.db.prepare('DELETE FROM download_journal WHERE id=?').run(capture);
      if (controller.signal.aborted) throw new AppError('CANCELLED', 'Download cancelled.');
      if (error instanceof AppError) throw error;
      throw new AppError('ARCHIVE_WRITE', 'The archive could not be saved. Check library permissions and free space.');
    } finally { controller.abort(); this.controller = null; settle(); }
  }

  private async finish(library: Library, capture: string, plan: Plan): Promise<string> {
    await this.folders(library);
    const db = library.db;
    const asset = db.prepare('SELECT id,relative_path FROM assets WHERE sha256=?').get(plan.sha256);
    const relativePath = asset ? String(asset.relative_path) : `media/${plan.sha256}.${plan.extension}`;
    if (!new RegExp(`^media/${plan.sha256}\\.(${Object.keys(MEDIA_TYPES).join('|')})$`).test(relativePath)) throw new AppError('RECOVERY', 'Unexpected asset path.');
    const finalPath = join(library.root, relativePath);
    const stagePath = join(library.root, '.foliuna', 'staging', plan.stage);
    if (!await regularFile(finalPath)) {
      const staged = await hashFile(stagePath);
      if (staged.sha256 !== plan.sha256 || staged.bytes !== plan.bytes) throw new AppError('RECOVERY', 'Staged media failed its integrity check.');
      await publishNoReplace(stagePath, finalPath);
    }
    const verified = await hashFile(finalPath);
    if (verified.sha256 !== plan.sha256 || verified.bytes !== plan.bytes) throw new AppError('RECOVERY', 'Existing media failed its integrity check and was not overwritten.');
    const post = normalizePost(plan.metadata, plan.provider);
    const previous = db.prepare('SELECT a.sha256 FROM source_posts s JOIN assets a ON a.id=s.asset_id WHERE s.provider=? AND s.post_id=?').get(plan.provider, plan.postId);
    if (previous && previous.sha256 !== plan.sha256) throw new AppError('RECOVERY', 'A different captured revision was preserved.');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO assets(sha256,relative_path,byte_size,created_at) VALUES(?,?,?,?) ON CONFLICT(sha256) DO NOTHING')
        .run(plan.sha256, relativePath, plan.bytes, plan.capturedAt);
      const assetId = db.prepare('SELECT id FROM assets WHERE sha256=?').get(plan.sha256)!.id;
      db.prepare(`INSERT INTO source_posts(asset_id,provider,post_id,source_url,metadata_json,captured_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(provider,post_id) DO UPDATE SET metadata_json=excluded.metadata_json,captured_at=excluded.captured_at`)
        .run(assetId, plan.provider, plan.postId, postUrl({ provider: plan.provider, id: plan.postId }, post.source), JSON.stringify(plan.metadata), plan.capturedAt);
      const sourceId = db.prepare('SELECT id FROM source_posts WHERE provider=? AND post_id=?').get(plan.provider, plan.postId)!.id;
      db.prepare('DELETE FROM post_tags WHERE source_post_id=?').run(sourceId);
      for (const category of TAG_CATEGORIES) for (const tag of new Set(post.tags[category])) {
        db.prepare('INSERT INTO tags(name,category) VALUES(?,?) ON CONFLICT DO NOTHING').run(tag, category);
        const tagId = db.prepare('SELECT id FROM tags WHERE name=? AND category=?').get(tag, category)!.id;
        db.prepare('INSERT INTO post_tags VALUES(?,?)').run(sourceId, tagId);
      }
      db.prepare('INSERT INTO source_snapshots(capture_id,source_post_id,metadata_json,tags_json,captured_at) VALUES(?,?,?,?,?) ON CONFLICT(capture_id) DO NOTHING')
        .run(capture, sourceId, JSON.stringify(plan.metadata), JSON.stringify(post.tags), plan.capturedAt);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const assetId = db.prepare('SELECT id FROM assets WHERE sha256=?').get(plan.sha256)!.id;
    const sources: SidecarSource[] = db.prepare('SELECT id,provider,post_id,source_url FROM source_posts WHERE asset_id=? ORDER BY provider,post_id').all(assetId).map((source) => ({
      provider: source.provider as Provider, postId: Number(source.post_id), url: String(source.source_url),
      snapshots: db.prepare('SELECT metadata_json,tags_json,captured_at FROM source_snapshots WHERE source_post_id=? ORDER BY id').all(source.id).map((snapshot) => ({
        capturedAt: String(snapshot.captured_at), metadata: jsonRecord(snapshot.metadata_json),
        categorizedTags: jsonRecord(snapshot.tags_json) as CategorizedTags,
      })),
    }));
    await regularFile(`${finalPath}.foliuna.json`);
    await writeAtomic(`${finalPath}.foliuna.json`, JSON.stringify(sidecar(plan.sha256, plan.bytes, relativePath, sources), null, 2) + '\n');
    await rm(stagePath, { force: true });
    db.prepare('DELETE FROM download_journal WHERE id=?').run(capture);
    this.issue = null;
    return relativePath;
  }

  async close() {
    this.closing = true;
    this.cancel();
    await this.settled;
    await this.selectionSettled;
    await Promise.allSettled([...this.reads]);
    const library = this.library; this.library = null;
    if (library) { library.db.close(); await library.release(); }
  }
  get downloading() { return this.controller !== null; }

  async access<T>(action: (library: Library) => T | Promise<T>): Promise<T> {
    if (!this.library) throw new AppError('LIBRARY_REQUIRED', 'Choose an archive folder in Settings first.');
    if (this.closing || this.changing) throw new AppError('BUSY', 'Wait for the current library operation to finish.');
    const task = Promise.resolve().then(() => action(this.library!));
    this.reads.add(task);
    try { return await task; } finally { this.reads.delete(task); }
  }

  async maintain<T>(action: (library: Library, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.library) throw new AppError('LIBRARY_REQUIRED', 'Choose an archive folder in Settings first.');
    if (this.closing || this.changing || this.controller) throw new AppError('BUSY', 'Wait for the current library operation to finish.');
    const controller = new AbortController(); this.controller = controller; this.changing = true;
    let settle!: () => void; this.settled = new Promise((resolve) => { settle = resolve; });
    try { await Promise.allSettled([...this.reads]); await this.recover(this.library); return await action(this.library, controller.signal); }
    finally { this.controller = null; this.changing = false; settle(); }
  }
}
