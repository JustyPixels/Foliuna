import { isAbsolute, relative, resolve, extname } from 'node:path';

export const APP_URL = 'foliuna://app/index.html';
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'self'; frame-src foliuna://player; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PLAYER_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export function bundlePath(requestUrl: string, root: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== 'foliuna:' || !['app', 'player'].includes(url.host) || url.username || url.password || url.search) return null;
    const path = decodeURIComponent(url.pathname);
    if (path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) return null;
    const candidate = resolve(root, `.${path}`);
    const part = relative(root, candidate);
    if (!part || part.startsWith('..') || isAbsolute(part) || !['.html', '.js', '.css', '.svg', '.wasm'].includes(extname(candidate))) return null;
    if (url.host === 'player' && extname(candidate) === '.html' && path !== '/swf.html') return null;
    return candidate;
  } catch { return null; }
}

export interface SenderIdentity { senderId: number; windowId: number; isMainFrame: boolean; url: string }
export function isTrustedSender(sender: SenderIdentity): boolean {
  return sender.senderId === sender.windowId && sender.isMainFrame && sender.url === APP_URL;
}
