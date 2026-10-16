import { constants } from 'node:fs';
import { copyFile, link, open } from 'node:fs/promises';

export async function publishNoReplace(source: string, destination: string, hardLink = link): Promise<void> {
  try { await hardLink(source, destination); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return;
    if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? '')) throw error;
    // The prepared journal retains the verified source if a copy is interrupted.
    try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
    catch (copyError) { if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError; return; }
    const file = await open(destination, 'r+');
    try { await file.sync(); } finally { await file.close(); }
  }
}
