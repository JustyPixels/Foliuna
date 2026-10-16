import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PROVIDERS, type CredentialInput, type CredentialStatus, type Provider } from '../shared/contracts';
import { AppError, credentialInput, provider as validateProvider } from '../shared/validation';
import { writeAtomic } from './atomic-file';

export interface SecretStorage {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class CredentialStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly profile: string, private readonly storage: SecretStorage) {}

  available() { return this.storage.available(); }
  async flush() { await this.tail; }
  private path(provider: Provider) { return join(this.profile, `${validateProvider(provider)}.credentials.enc`); }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const task = this.tail.then(action);
    this.tail = task.catch(() => undefined);
    return task;
  }

  read(provider: Provider): Promise<CredentialInput | null> {
    return this.serialize(async () => {
      let encrypted: Buffer;
      try { encrypted = await readFile(this.path(provider)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new AppError('CREDENTIALS_LOCKED', 'Stored credentials could not be read. Remove or replace them in Settings.'); }
      try {
        if (!await this.available() || encrypted.length > 32768) throw new Error();
        const value = credentialInput(JSON.parse(await this.storage.decrypt(encrypted)));
        if (value.provider !== provider) throw new Error();
        return value;
      } catch { throw new AppError('CREDENTIALS_LOCKED', 'Stored credentials could not be unlocked by this account. Remove or replace them in Settings.'); }
    });
  }

  save(input: unknown): Promise<CredentialStatus> {
    return this.serialize(async () => {
      const value = credentialInput(input);
      if (!await this.available()) throw new AppError('ENCRYPTION_UNAVAILABLE', 'Secure OS encryption is unavailable. Credentials were not saved.');
      try { await writeAtomic(this.path(value.provider), await this.storage.encrypt(JSON.stringify(value))); }
      catch { throw new AppError('CREDENTIALS_SAVE', 'Encrypted credentials could not be saved. Your previous entry was preserved.'); }
      return { provider: value.provider, saved: true, username: value.username, locked: false };
    });
  }

  remove(provider: Provider): Promise<null> {
    return this.serialize(async () => {
      try { await rm(this.path(provider), { force: true }); }
      catch { throw new AppError('CREDENTIALS_REMOVE', 'Could not remove the stored credentials.'); }
      return null;
    });
  }

  async statuses(providers: readonly Provider[] = PROVIDERS): Promise<CredentialStatus[]> {
    const result: CredentialStatus[] = [];
    for (const provider of providers) {
      try {
        const saved = await this.read(provider);
        result.push({ provider, saved: saved !== null, username: saved?.username ?? null, locked: false });
      } catch { result.push({ provider, saved: true, username: null, locked: true }); }
    }
    return result;
  }
}
