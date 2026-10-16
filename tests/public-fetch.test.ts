import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicAddress, publicFetch } from '../src/main/public-fetch';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('public HTTPS connections', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1', '2001:db8::1', '2001::1', '2002:7f00::1'])('blocks non-public address %s', (address) => expect(publicAddress(address)).toBe(false));
  it('pins the checked DNS answer while retaining the hostname for HTTPS certificate checks', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.215.14', family: 4 }] as never);
    let pinned: unknown;
    vi.mocked(request).mockImplementation(((url: URL, options: { lookup(host: string, options: object, callback: (...values: unknown[]) => void): void; agent: boolean }, callback: (value: unknown) => void) => {
      expect(url.hostname).toBe('custom.booru.org'); expect(options.agent).toBe(false);
      options.lookup(url.hostname, {}, (...values) => { pinned = values; });
      const response = Object.assign(Readable.from([Buffer.from('[]')]), { statusCode: 200, headers: { 'content-type': 'application/json' } });
      const req = Object.assign(new EventEmitter(), { end: () => callback(response) }); return req;
    }) as never);
    const response = await publicFetch('https://custom.booru.org/posts.json', { signal: AbortSignal.timeout(1000) });
    expect(await response.json()).toEqual([]); expect(pinned).toEqual([null, '93.184.215.14', 4]);
  });
  it('rejects mixed private DNS answers and does not create a connection', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }] as never);
    await expect(publicFetch('https://custom.booru.org/posts.json')).rejects.toThrow('Non-public'); expect(request).not.toHaveBeenCalled();
  });
  it('does not follow redirects to a new origin or local network', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.215.14', family: 4 }] as never);
    const destroy = vi.fn();
    vi.mocked(request).mockImplementation(((_url: URL, _options: object, callback: (value: unknown) => void) =>
      Object.assign(new EventEmitter(), { end: () => callback({ statusCode: 302, destroy, headers: { location: 'https://127.0.0.1/' } }) })) as never);
    await expect(publicFetch('https://custom.booru.org/posts.json')).rejects.toThrow('Redirects'); expect(request).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalled();
  });
});
