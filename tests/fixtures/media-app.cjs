process.env.FOLIUNA_TEST_NETWORK = '1';
// Test-only entry point: install deterministic API/media fixtures before loading the real app.
const { nativeImage } = require('electron');
const path = require('node:path');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const offline = process.env.FOLIUNA_FIXTURE_OFFLINE === '1';
const extended = process.env.FOLIUNA_FIXTURE_BROWSING === '1';
const multiProvider = process.env.FOLIUNA_FIXTURE_PROVIDERS === '1';
const pixel = nativeImage.createFromBitmap(Buffer.from([90, 140, 180, 255]), { width: 1, height: 1 });
const files = new Map();
const posts = [1001, 1002].map((id) => {
  const portrait = id === 1001;
  for (const [variant, multiplier] of [['preview', 1], ['sample', 3], ['original', 6]]) {
    const image = pixel.resize({ width: (portrait ? 40 : 120) * multiplier, height: (portrait ? 120 : 40) * multiplier });
    files.set(`/data/${id}/${variant}.png`, image.toPNG());
  }
  const url = (variant) => `https://static1.e621.net/data/${id}/${variant}.png`;
  return { id, rating: 's', tags: { artist: ['fixture_artist'], general: ['test_pattern'], species: [], meta: [], character: [], copyright: [], lore: [], invalid: [] },
    file: { url: url('original'), ext: 'png', width: portrait ? 240 : 720, height: portrait ? 720 : 240, size: files.get(`/data/${id}/original.png`).length, md5: null },
    preview: { url: url('preview') }, sample: { url: url('sample') }, score: { total: 1 }, sources: [], flags: { deleted: false } };
});

if (extended) {
  const rect = '01101' + [0, 4000, 0, 2000].map((n) => n.toString(2).padStart(13, '0')).join('');
  const bits = rect.padEnd(Math.ceil(rect.length / 8) * 8, '0');
  const body = Buffer.concat([Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2))), Buffer.from([0, 24, 1, 0, 67, 2, 30, 150, 80, 64, 0, 0, 0])]);
  const swf = Buffer.alloc(8); swf.write('FWS'); swf[3] = 9; swf.writeUInt32LE(body.length + 8, 4);
  for (const [id, ext, bytes] of [[1003, 'webm', readFileSync(path.join(__dirname, 'clip.webm'))], [1004, 'swf', Buffer.concat([swf, body])], [1005, 'gif', readFileSync(path.join(__dirname, 'clip.gif'))]]) {
    const url = `https://static1.e621.net/data/${id}/original.${ext}`; files.set(new URL(url).pathname, bytes);
    posts.push({ ...posts[1], id, file: { ...posts[1].file, url, ext, size: bytes.length, width: 160, height: 90 } });
  }
  for (let id = 1006; id <= 1030; id++) posts.push({ ...posts[id % 2], id });
}

if (offline) {
  const root = path.join(process.env.FOLIUNA_DATA_DIR, 'archive'); const incoming = path.join(root, 'incoming'); mkdirSync(incoming, { recursive: true });
  const assets = new Map();
  for (const post of posts) {
    const bytes = files.get(new URL(post.file.url).pathname); const hash = createHash('sha256').update(bytes).digest('hex');
    let asset = assets.get(hash);
    if (!asset) { asset = { schemaVersion: 1, asset: { sha256: hash, byteSize: bytes.length, mediaFile: `${hash}.${post.file.ext}` }, sources: [] }; assets.set(hash, asset); writeFileSync(path.join(incoming, asset.asset.mediaFile), bytes); }
    const snapshot = { capturedAt: '2026-10-16T00:00:00.000Z', metadata: post, categorizedTags: post.tags };
    asset.sources.push({ provider: 'e621', postId: post.id, url: `https://e621.net/posts/${post.id}`, snapshots: [snapshot] });
    if (post.id === 1001) asset.sources.push({ provider: 'e926', postId: 77, url: 'https://e926.net/posts/77', snapshots: [{ ...snapshot, metadata: { ...post, id: 77 } }] });
  }
  for (const asset of assets.values()) writeFileSync(path.join(incoming, `${asset.asset.mediaFile}.foliuna.json`), JSON.stringify(asset));
  writeFileSync(path.join(process.env.FOLIUNA_DATA_DIR, 'library.json'), JSON.stringify({ root }));
}
global.__foliunaMediaHits = [];
global.__foliunaApiHits = [];
global.__foliunaForbiddenRequests = [];
global.__foliunaProviderHits = [];
global.fetch = async (input, options) => {
  if (offline) { global.__foliunaForbiddenRequests.push(String(input)); throw new Error('Network is disabled in this offline-gallery fixture'); }
  const url = new URL(String(input));
  if (multiProvider && ['danbooru.donmai.us', 'gelbooru.com', 'api.rule34.xxx', 'safebooru.org', 'custom.booru.org'].includes(url.host)) {
    if (url.pathname.startsWith('/data/') && files.has(url.pathname)) {
      global.__foliunaMediaHits.push({ path: url.pathname, authenticated: new Headers(options?.headers).has('Authorization'), query: !!url.search });
      return new Response(files.get(url.pathname), { headers: { 'content-type': 'image/png' } });
    }
    const modern = ['danbooru.donmai.us', 'custom.booru.org'].includes(url.host);
    const post = posts[0];
    const record = { id: post.id, rating: modern || ['gelbooru.com', 'safebooru.org'].includes(url.host) ? 'g' : 's',
      tags: 'forest fixture_artist', tag_string: 'forest fixture_artist', tag_string_artist: 'fixture_artist', tag_string_general: 'forest',
      file_url: new URL(new URL(post.file.url).pathname, url.origin).href, file_ext: 'png', file_size: 0,
      preview_file_url: new URL('/data/1001/preview.png', url.origin).href, preview_url: new URL('/data/1001/preview.png', url.origin).href,
      large_file_url: new URL('/data/1001/sample.png', url.origin).href, sample_url: new URL('/data/1001/sample.png', url.origin).href,
      image_width: 240, image_height: 720, score: 1, source: 'https://artist.org/art', provider_extra: 'preserve-me' };
    if (url.host === 'api.rule34.xxx') {
      record.file_url = record.file_url.replace(url.origin, 'https://api-cdn.rule34.xxx');
      record.preview_url = record.preview_url.replace(url.origin, 'https://api-cdn.rule34.xxx');
      record.sample_url = record.sample_url.replace(url.origin, 'https://api-cdn.rule34.xxx');
    }
    global.__foliunaProviderHits.push({ host: url.host, path: url.pathname, hasKey: url.searchParams.has('api_key'), userId: url.searchParams.get('user_id'),
      authorization: new Headers(options?.headers).has('authorization'), tags: url.searchParams.get('tags') });
    const detail = /\/posts\/\d+\.json$/.test(url.pathname);
    return new Response(JSON.stringify(modern ? detail ? record : [record] : url.host === 'gelbooru.com' ? { post: [record], '@attributes': { count: 1 } } : [record]), { headers: { 'content-type': 'application/json' } });
  }
  if (multiProvider && url.host === 'api-cdn.rule34.xxx' && files.has(url.pathname)) {
    global.__foliunaMediaHits.push({ path: url.pathname, authenticated: new Headers(options?.headers).has('authorization'), query: !!url.search });
    return new Response(files.get(url.pathname), { headers: { 'content-type': 'image/png' } });
  }
  if (url.origin === 'https://e621.net') {
    global.__foliunaApiHits.push(url.pathname);
    const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/tags.json') return json([{ name: 'forest', category: 0, post_count: 42 }]);
    if (url.pathname === '/users/me.json') return json({ id: 123, name: 'fixture_user', level_string: 'Member', created_at: '2020-01-01', favorite_count: 30, post_upload_count: 2, favorite_tags: 'fixture_artist forest', email: 'private@invalid.test' });
    const id = /^\/posts\/([0-9]+)\.json$/.exec(url.pathname)?.[1];
    const page = Number(url.searchParams.get('page') || 1);
    return json(id ? { post: posts.find((post) => post.id === Number(id)) } : { posts: extended ? posts.slice((page - 1) * 24, page * 24) : posts });
  }
  if (url.origin === 'https://static1.e621.net' && files.has(url.pathname)) {
    global.__foliunaMediaHits.push({ path: url.pathname, authenticated: new Headers(options?.headers).has('Authorization') });
    const mime = url.pathname.endsWith('.webm') ? 'video/webm' : url.pathname.endsWith('.swf') ? 'application/x-shockwave-flash' : url.pathname.endsWith('.gif') ? 'image/gif' : 'image/png';
    return new Response(files.get(url.pathname), { headers: { 'content-type': mime, 'access-control-allow-origin': 'https://e621.net' } });
  }
  throw new Error('Unexpected network destination in the media fixture');
};
require(path.resolve(__dirname, '../../dist/main.cjs'));
