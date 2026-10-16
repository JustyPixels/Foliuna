import { describe, expect, it } from 'vitest';
import { mediaUrl, postRequest, postUrl, searchRequest } from '../src/shared/validation';
import { APP_URL, bundlePath, isTrustedSender } from '../src/main/security';
import { resolve } from 'node:path';

describe('IPC input boundaries', () => {
  it('preserves booru query syntax and trims whitespace', () => {
    expect(searchRequest({ provider: 'e621', tags: '  fox -wolf rating:s ~forest  ', page: 2 }))
      .toEqual({ provider: 'e621', tags: 'fox -wolf rating:s ~forest', page: 2 });
    expect(searchRequest({ provider: 'e926', tags: '', page: 750 }).tags).toBe('');
  });
  it.each([null, [], {}, { provider: 'https://evil.test', tags: '', page: 1 },
    { provider: 'e926', tags: 1, page: 1 }, { provider: 'e926', tags: 'x'.repeat(513), page: 1 },
    { provider: 'e926', tags: 'fox\nforest', page: 1 }, { provider: 'e926', tags: 'fox limit:320', page: 1 },
    { provider: 'e926', tags: Array(41).fill('fox').join(' '), page: 1 },
    { provider: 'e621', tags: '', page: 1, safeOnly: 'yes' },
    ...[0, -1, 751, 1.2, '2', NaN, Infinity].map((page) => ({ provider: 'e926', tags: '', page }))])('rejects malformed search %#', (value) => {
    expect(() => searchRequest(value)).toThrow();
  });
  it.each([null, { provider: 'e926', id: '../x' }, { provider: 'e621', id: 0 }, { provider: 'file', id: 1 }, { provider: 'e621', id: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed post identity %#', (value) => {
    expect(() => postRequest(value)).toThrow();
  });
  it('derives external links rather than accepting URLs from content', () => {
    expect(postUrl({ provider: 'e621', id: 123 })).toBe('https://e621.net/posts/123');
    expect(postRequest({ provider: 'e926', id: 123, url: 'file:///x' })).toEqual({ provider: 'e926', id: 123 });
  });
});

describe('remote media allowlist', () => {
  it('allows only HTTPS media on the exact CDN hosts', () => {
    expect(mediaUrl('https://static1.e621.net/data/preview/a.jpg')).toBe('https://static1.e621.net/data/preview/a.jpg');
    expect(mediaUrl('https://static2.e621.net/data/a.webm')).not.toBeNull();
  });
  it.each(['https://static1.e621.net.evil.test/a.jpg', 'https://static1.e621.net@evil.test/a.jpg',
    'https://user:password@static1.e621.net/a.jpg', 'https://static1.e621.net:8443/a.jpg',
    'http://static1.e621.net/a.jpg', 'file:///a.jpg', 'data:image/svg+xml,test',
    'https://static1.e621.net/a.svg', 'https://static1.e621.net/a.html', null, {}])('rejects unsafe media %#', (value) => {
    expect(mediaUrl(value)).toBeNull();
  });
});

describe('local bundle and IPC sender', () => {
  const root = resolve('dist/renderer');
  it('serves only files under the renderer bundle', () => {
    expect(bundlePath(APP_URL, root)).toBe(resolve(root, 'index.html'));
    expect(bundlePath('foliuna://app/assets/app.js', root)).toBe(resolve(root, 'assets/app.js'));
  });
  it.each(['file:///secret.html', 'https://evil.test/index.html', 'foliuna://evil/index.html',
    'foliuna://app/%2e%2e%5csecret.js', 'foliuna://app/%2f..%2fsecret.js', 'foliuna://app/%00.js',
    'foliuna://app/secret.sqlite', 'foliuna://app/main.js?remote=x', 'foliuna://user@app/main.js', 'foliuna://app/%ZZ.js'])('rejects untrusted bundle requests %#', (value) => {
    expect(bundlePath(value, root)).toBeNull();
  });
  it('rejects child frames, other windows, remote URLs and prefix lookalikes', () => {
    const valid = { senderId: 1, windowId: 1, isMainFrame: true, url: APP_URL };
    expect(isTrustedSender(valid)).toBe(true);
    for (const input of [{ ...valid, senderId: 2 }, { ...valid, isMainFrame: false },
      { ...valid, url: 'https://e621.net' }, { ...valid, url: `${APP_URL}.evil` }]) expect(isTrustedSender(input)).toBe(false);
  });
});
