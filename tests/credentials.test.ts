import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SecretStorage } from '../src/main/credentials';
import { credentialInput } from '../src/shared/validation';
import { ApiClient } from '../src/main/adapters/http';

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const profile = () => { const root = mkdtempSync(join(tmpdir(), 'foliuna-secrets-')); roots.push(root); return root; };
function cryptoStorage(): SecretStorage {
  const key = randomBytes(32);
  return {
    available: async () => true,
    encrypt: async (value) => {
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    decrypt: async (bytes) => {
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString();
    },
  };
}
const input = { provider: 'e621' as const, username: 'fixture_user', apiKey: 'fictional_key_for_tests_only' };

describe('write-only encrypted credentials', () => {
  it('encrypts the whole record, survives reopen, and returns only account status', async () => {
    const root = profile(); const storage = cryptoStorage(); const store = new CredentialStore(root, storage);
    expect(await store.save(input)).toEqual({ provider: 'e621', saved: true, username: input.username, locked: false });
    const disk = readFileSync(join(root, 'e621.credentials.enc'));
    expect(disk.includes(Buffer.from(input.apiKey))).toBe(false);
    expect(disk.includes(Buffer.from(input.username))).toBe(false);
    expect(await new CredentialStore(root, storage).read('e621')).toEqual(input);
    expect(await store.read('e926')).toBeNull();
    expect(JSON.stringify(await store.statuses())).not.toContain(input.apiKey);
    await store.remove('e621'); expect(await store.read('e621')).toBeNull();
  });
  it('refuses an unavailable backend and preserves an existing entry when replacement fails', async () => {
    const root = profile(); const storage = cryptoStorage(); const store = new CredentialStore(root, storage);
    await store.save(input); const before = readFileSync(join(root, 'e621.credentials.enc'));
    storage.encrypt = async () => { throw new Error('private encryption detail'); };
    await expect(store.save({ ...input, apiKey: 'replacement' })).rejects.toMatchObject({ code: 'CREDENTIALS_SAVE' });
    expect(readFileSync(join(root, 'e621.credentials.enc'))).toEqual(before);
    storage.available = async () => false;
    await expect(store.save(input)).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    await store.remove('e621'); expect(await store.read('e621')).toBeNull();
  });
  it('reports corruption or another OS account as locked, never silently using anonymous access', async () => {
    const root = profile(); const store = new CredentialStore(root, cryptoStorage());
    writeFileSync(join(root, 'e621.credentials.enc'), 'corrupted');
    await expect(store.read('e621')).rejects.toMatchObject({ code: 'CREDENTIALS_LOCKED' });
    expect(await store.statuses()).toContainEqual({ provider: 'e621', saved: true, username: null, locked: true });
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ApiClient(fetcher, (site) => store.read(site)).get(new URL('https://e621.net/posts.json'))).rejects.toMatchObject({ code: 'CREDENTIALS_LOCKED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('serializes save/remove to avoid a slow encryption call recreating a removed entry', async () => {
    const store = new CredentialStore(profile(), cryptoStorage());
    const save = store.save(input); const remove = store.remove('e621');
    await Promise.all([save, remove]); expect(await store.read('e621')).toBeNull();
  });
  it.each([null, {}, { ...input, provider: 'evil' }, { ...input, username: 'user:password' },
    { ...input, username: '\r\ninjected' }, { ...input, apiKey: 'has spaces' }, { ...input, apiKey: '' },
    { ...input, apiKey: 'x'.repeat(257) }])('rejects malformed credentials without echoing the key %#', (value) => {
    expect(() => credentialInput(value)).toThrow();
  });
});

describe('per-provider HTTPS authentication', () => {
  it('sends Basic auth only to e621, with no secret in the URL or User-Agent', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"posts":[]}', { headers: { 'content-type': 'application/json' } }));
    const client = new ApiClient(fetcher, async (site) => site === 'e621' ? input : null);
    await client.get(new URL('https://e621.net/posts.json?tags=rating%3As'));
    await expect(client.get(new URL('https://e926.net/posts.json'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const first = fetcher.mock.calls[0]; const headers = first[1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${input.username}:${input.apiKey}`).toString('base64')}`);
    expect(headers['User-Agent']).toContain(input.username);
    expect(headers['User-Agent']).not.toContain(input.apiKey);
    expect(String(first[0])).not.toContain(input.apiKey);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first[1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
  });
  it('rejects credential query strings and off-host credential forwarding', async () => {
    const fetcher = vi.fn<typeof fetch>(); const credentials = vi.fn().mockResolvedValue(input);
    const client = new ApiClient(fetcher, credentials);
    for (const url of ['https://static1.e621.net/posts.json', 'https://e621.net/posts.json?api_key=fake', 'https://e621.net.evil.test/posts.json']) {
      await expect(client.get(new URL(url))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(fetcher).not.toHaveBeenCalled(); expect(credentials).not.toHaveBeenCalled();
  });
});
