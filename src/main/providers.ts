import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ProviderDefinition } from '../shared/contracts';
import { BUILTIN_PROVIDERS, providerDefinition } from '../shared/providers';
import { AppError } from '../shared/validation';
import { writeAtomic } from './atomic-file';

export function customProvider(value: unknown): ProviderDefinition {
  const definition = providerDefinition({ ...(value as object), id: `custom-${'0'.repeat(32)}` });
  if (!['danbooru', 'gelbooru'].includes(definition.engine)) throw new AppError('INVALID_INPUT', 'Custom sites support Danbooru or Gelbooru JSON APIs.');
  const id = createHash('sha256').update(JSON.stringify([definition.engine, definition.baseUrl, definition.apiUrl])).digest('hex').slice(0, 32);
  return { ...definition, id: `custom-${id}` };
}

export class ProviderStore {
  private custom: ProviderDefinition[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly profile: string) {}
  async initialize() {
    try {
      const bytes = await readFile(join(this.profile, 'boorus.json'));
      if (bytes.length > 256 * 1024) throw new Error();
      const entries: unknown = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(entries) || entries.length > 32) throw new Error();
      this.custom = entries.map((entry) => {
        const result = customProvider(entry);
        if (result.id !== (entry as ProviderDefinition).id) throw new Error();
        return result;
      });
      if (new Set(this.custom.map((entry) => entry.id)).size !== this.custom.length) throw new Error();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('PROVIDERS', 'Saved booru connections could not be read. The file was preserved.'); }
  }
  list() { return structuredClone([...BUILTIN_PROVIDERS, ...this.custom]); }
  get(id: string) {
    const definition = this.list().find((entry) => entry.id === id);
    if (!definition) throw new AppError('INVALID_INPUT', 'This booru is not configured. Add it in Settings.');
    return definition;
  }
  private mutate<T>(action: () => Promise<T>) {
    const task = this.tail.then(action); this.tail = task.catch(() => undefined); return task;
  }
  save(input: unknown) {
    return this.mutate(async () => {
      const definition = customProvider(input);
      const next = [...this.custom.filter((entry) => entry.id !== definition.id), definition];
      if (next.length > 32) throw new AppError('INVALID_INPUT', 'Up to 32 custom boorus are supported.');
      await writeAtomic(join(this.profile, 'boorus.json'), JSON.stringify(next)); this.custom = next;
      return definition;
    });
  }
  remove(id: string) {
    return this.mutate(async () => {
      if (!id.startsWith('custom-')) throw new AppError('INVALID_INPUT', 'Built-in boorus cannot be removed.');
      const next = this.custom.filter((entry) => entry.id !== id);
      await writeAtomic(join(this.profile, 'boorus.json'), JSON.stringify(next)); this.custom = next;
    });
  }
}
