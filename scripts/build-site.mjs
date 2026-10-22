import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const target = new URL('../site/dist/', import.meta.url);
const root = new URL('../', import.meta.url);
if (!fileURLToPath(target).startsWith(fileURLToPath(root))) throw Error('Invalid build path');
await rm(target, { force: true, recursive: true });
await mkdir(new URL('assets/', target), { recursive: true });
for (const file of ['index.html', 'style.css', 'site.js']) await cp(new URL('../site/' + file, import.meta.url), new URL(file, target));
const artwork = JSON.parse(await readFile(new URL('../site/artwork/credits.json', import.meta.url), 'utf8'));
assert.equal(artwork.length, 4);
assert.equal(new Set(artwork.map((art) => art.artist)).size, 4);
for (const art of artwork) {
  assert.match(art.file, /^[a-z0-9-]+\.png$/); assert.equal(art.rating, 's');
  assert.match(art.post, /^https:\/\/e621.net\/posts\/[1-9]\d*$/);
  assert.equal(new URL(art.source).protocol, 'https:');
  assert.equal(createHash('sha256').update(await readFile(new URL('../site/artwork/' + art.file, import.meta.url))).digest('hex'), art.sha256);
}
await cp(new URL('../site/artwork/', import.meta.url), new URL('artwork/', target), { recursive: true });
await cp(new URL('../build/icon.png', import.meta.url), new URL('assets/icon.png', target));
for (const name of ['discover.png','android-discover.png']) await cp(new URL('../docs/screenshots/' + name, import.meta.url), new URL('assets/' + name, target));
const response = process.env.FOLIUNA_RELEASE_FIXTURE ? null : await fetch('https://api.github.com/repos/JustyPixels/Foliuna/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Foliuna-Pages', ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) } });
if (response && !response.ok) throw Error('Could not verify published releases: HTTP ' + response.status);
const releases = response ? await response.json() : JSON.parse(await readFile(process.env.FOLIUNA_RELEASE_FIXTURE, 'utf8'));
if (!Array.isArray(releases)) throw Error('Invalid published release list');
const result = { windows: null, android: null };
for (const release of releases.filter((item) => !item.draft && item.published_at)) {
  for (const [platform, pattern] of [['windows', /^Foliuna.*\.exe$/i], ['android', /^Foliuna-Android-\d+\.\d+\.\d+-preview\.\d+-debug\.apk$/]]) {
    if (result[platform]) continue;
    const asset = release.assets?.find((asset) => pattern.test(asset.name) && asset.state === 'uploaded' && asset.size > 0);
    if (asset) result[platform] = { version: release.tag_name, download: asset.browser_download_url, release: release.html_url };
  }
}
await writeFile(new URL('releases.json', target), JSON.stringify(result, null, 2) + '\n');
await writeFile(new URL('.nojekyll', target), '');
console.log('Built GitHub Pages site using published release assets:', Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value?.version ?? 'forthcoming'])));
