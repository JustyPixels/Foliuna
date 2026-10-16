import { publicFetch } from '../public-fetch';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import type { Post } from '../../shared/contracts';
import { AppError, mediaUrl } from '../../shared/validation';
import { USER_AGENT } from '../adapters/http';
import { MAX_MEDIA_BYTES, MEDIA_TYPES, mediaSignature } from '../media-formats';
export { MAX_MEDIA_BYTES, MEDIA_TYPES } from '../media-formats';

export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MEDIA_BYTES) throw new AppError('UNSAFE_FILE', 'The library contains an unexpected media file. It was not overwritten.');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > MAX_MEDIA_BYTES) throw new AppError('MEDIA_TOO_LARGE', 'Media exceeds the 100 MiB limit.');
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), bytes };
}

export async function transfer(post: Post, destination: string, signal: AbortSignal, fetcher: typeof fetch = publicFetch) {
  const url = mediaUrl(post.file.url, post.source);
  const extension = post.file.extension.toLowerCase();
  if (post.unavailable || !url || !MEDIA_TYPES[extension] || new URL(url).search || new URL(url).hash ||
      !new URL(url).pathname.toLowerCase().endsWith(`.${extension}`)) {
    throw new AppError('UNAVAILABLE', 'An allowed original media file is not available for this post.');
  }
  if (!Number.isSafeInteger(post.file.size) || post.file.size < 0 || post.file.size > MAX_MEDIA_BYTES) {
    throw new AppError('MEDIA_TOO_LARGE', 'The original must have a known size up to 100 MiB.');
  }
  const abort = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: MEDIA_TYPES[extension] },
      redirect: 'error', credentials: 'omit', signal: abort });
  } catch { throw new AppError(signal.aborted ? 'CANCELLED' : 'DOWNLOAD_NETWORK', signal.aborted ? 'Download cancelled.' : 'Could not download the original. Check your connection and try again.'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AppError('DOWNLOAD_HTTP', `Original media returned HTTP ${response.status}. No credentials are sent to the media CDN.`);
  }
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  const length = response.headers.get('content-length');
  if ((mime !== MEDIA_TYPES[extension] && mime !== 'application/octet-stream') ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MEDIA_BYTES))) {
    await response.body?.cancel();
    throw new AppError('INVALID_MEDIA', 'The original returned an unexpected media type or size.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('INVALID_MEDIA', 'The original returned no media bytes.');
  let file: FileHandle | undefined;
  const sha = createHash('sha256');
  const md5 = createHash('md5');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  try {
    file = await open(destination, 'wx', 0o600);
    while (true) {
      abort.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_MEDIA_BYTES || (post.file.size > 0 && bytes > post.file.size)) throw new AppError('INVALID_MEDIA', 'The original exceeded its declared size.');
      if (prefix.length < 16) prefix = Buffer.concat([prefix, Buffer.from(next.value).subarray(0, 16 - prefix.length)]);
      sha.update(next.value); md5.update(next.value);
      // writeFile completes partial OS writes before the next chunk is read.
      await file.writeFile(next.value);
    }
    if (bytes < 1 || (post.file.size > 0 && bytes !== post.file.size) || (length !== null && Number(length) !== bytes) || !mediaSignature(prefix, extension) ||
        (post.file.md5 !== null && (!/^[0-9a-f]{32}$/i.test(post.file.md5) || md5.digest('hex') !== post.file.md5.toLowerCase()))) {
      throw new AppError('INVALID_MEDIA', 'The original failed its size, format or source checksum check.');
    }
    await file.sync();
    return { sha256: sha.digest('hex'), bytes, extension };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (abort.aborted) throw new AppError(signal.aborted ? 'CANCELLED' : 'DOWNLOAD_TIMEOUT', signal.aborted ? 'Download cancelled.' : 'The media download timed out.');
    throw new AppError('DOWNLOAD_WRITE', 'The download could not be written. Check free space and folder permissions.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await file?.close();
  }
}
