import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { AppError } from '../../shared/validation';
import { MAX_MEDIA_BYTES, MEDIA_TYPES } from '../media-formats';

export function sha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new AppError('INVALID_INPUT', 'Choose a valid archived image.');
  return value;
}

export function mediaPath(hash: string, value: unknown): string {
  sha256(hash);
  if (typeof value !== 'string' || !new RegExp(`^media/${hash}\\.(${Object.keys(MEDIA_TYPES).join('|')})$`).test(value)) throw new AppError('UNSAFE_LIBRARY', 'Unexpected archived media path.');
  return value;
}

export async function checkedDirectory(root: string, part: string) {
  const path = resolve(root, part); const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new AppError('UNSAFE_LIBRARY', 'Unexpected library folder.');
  let current = root;
  for (const segment of ['', ...rel.split(/[\\/]/)]) {
    current = join(current, segment); const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('UNSAFE_LIBRARY', 'Library folders cannot be links.');
  }
}

export async function checkedFile(root: string, part: string, maximum = MAX_MEDIA_BYTES) {
  const path = resolve(root, part); const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || part.includes('\\') || part.includes('\0')) throw new AppError('UNSAFE_LIBRARY', 'Unexpected library path.');
  let current = root;
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new AppError('UNSAFE_LIBRARY', 'Library root is no longer a regular folder.');
  const segments = rel.split(/[\\/]/);
  for (let i = 0; i < segments.length; i++) {
    current = join(current, segments[i]); const info = await lstat(current);
    if (info.isSymbolicLink() || (i < segments.length - 1 ? !info.isDirectory() : !info.isFile())) throw new AppError('UNSAFE_LIBRARY', 'Library links and unexpected file types are not opened.');
    if (i === segments.length - 1) {
      if (info.size < 1 || info.size > maximum) throw new AppError('INVALID_MEDIA', 'Library file size is invalid.');
      return { path, info };
    }
  }
  throw new AppError('UNSAFE_LIBRARY', 'Unexpected library path.');
}

export async function readLocal(root: string, part: string, maximum = MAX_MEDIA_BYTES) {
  const { path, info } = await checkedFile(root, part, maximum);
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new AppError('UNSAFE_LIBRARY', 'The library file changed while opening it.');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > maximum) throw new AppError('INVALID_MEDIA', 'Library file exceeds its size limit.');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  } finally { await file.close(); }
}

export const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
