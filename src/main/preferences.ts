import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_PREFERENCES, type Preferences } from '../shared/contracts';
import { AppError, record } from '../shared/validation';
import { writeAtomic } from './atomic-file';

export function preferences(value: unknown): Preferences {
  const input = record(value);
  if (!['crop', 'natural'].includes(String(input.gridMode)) || !['pages', 'infinite'].includes(String(input.browsing)) ||
    !Array.isArray(input.favoriteTags) || input.favoriteTags.length > 500 ||
    !input.favoriteTags.every((tag) => typeof tag === 'string' && tag.length > 0 && tag.length <= 200 && !/[\s\u0000-\u001f\u007f]/.test(tag))) {
    throw new AppError('INVALID_INPUT', 'Choose valid browsing options and up to 500 favorite tags.');
  }
  return { gridMode: input.gridMode as Preferences['gridMode'], browsing: input.browsing as Preferences['browsing'], favoriteTags: [...new Set(input.favoriteTags)] };
}

export class PreferenceStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly profile: string) {}
  async get(): Promise<Preferences> {
    await this.tail;
    try { return preferences(JSON.parse(await readFile(join(this.profile, 'preferences.json'), 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT_PREFERENCES);
      throw new AppError('PREFERENCES', 'Browsing preferences could not be read. Your saved file has been preserved.');
    }
  }
  save(value: unknown): Promise<Preferences> {
    const valid = preferences(value);
    const task = this.tail.then(async () => {
      await writeAtomic(join(this.profile, 'preferences.json'), JSON.stringify(valid));
      return valid;
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
  async flush() { await this.tail; }
}
