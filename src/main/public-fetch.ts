import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { publicUrl } from '../shared/providers';

export function publicAddress(address: string): boolean {
  if (address.includes(':')) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0:|:|2:|10:|20:|db8:)|^2002:/i.test(address);
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99))) ||
    (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

// Pin the checked DNS result to the TLS connection so a custom host cannot rebind to a private address.
export const publicFetch: typeof fetch = async (input, init = {}) => {
  const url = publicUrl(input instanceof Request ? input.url : String(input));
  init.signal?.throwIfAborted();
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Connection cancelled'));
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) abort();
  });
  const addresses = await Promise.race([lookup(url.hostname, { all: true }), cancelled]).finally(() => { if (abort) init.signal?.removeEventListener('abort', abort); });
  init.signal?.throwIfAborted();
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new Error('Non-public destination');
  const target = addresses.find((entry) => entry.family === 4) ?? addresses[0];
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: { ...Object.fromEntries(new Headers(init.headers)), 'accept-encoding': 'identity' },
      signal: init.signal ?? undefined, agent: false, family: target.family,
      lookup: (_host, _options, callback) => callback(null, target.address, target.family),
    }, (response) => {
      if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
        response.destroy(); reject(new Error('Redirects are disabled')); return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status: response.statusCode ?? 500, headers }));
    });
    req.on('error', reject); req.end();
  });
};
