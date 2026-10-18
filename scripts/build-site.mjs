import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const target = new URL('../site/dist/', import.meta.url);
const root = new URL('../', import.meta.url);
if (!fileURLToPath(target).startsWith(fileURLToPath(root))) throw Error('Invalid build path');
await rm(target, { force: true, recursive: true });
await mkdir(new URL('assets/', target), { recursive: true });
for (const file of ['index.html', 'style.css', 'demo.js']) await cp(new URL('../site/' + file, import.meta.url), new URL(file, target));
for (const file of ['fox.svg', 'wolf.svg', 'deer.svg']) await cp(new URL('../src/renderer/public/demo/' + file, import.meta.url), new URL('assets/' + file, target));
await cp(new URL('../build/icon.png', import.meta.url), new URL('assets/icon.png', target));
for (const file of ['discover.png', 'gallery.png', 'collections.png']) await cp(new URL('../docs/screenshots/' + file, import.meta.url), new URL('assets/' + file, target));
const response = process.env.FOLIUNA_RELEASE_FIXTURE ? null : await fetch('https://api.github.com/repos/JustyPixels/Foliuna/releases?per_page=100', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Foliuna-Pages', ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) } });
if (response && !response.ok) throw Error('Could not verify published releases: HTTP ' + response.status);
const releases = response ? await response.json() : JSON.parse(await readFile(process.env.FOLIUNA_RELEASE_FIXTURE, 'utf8'));
if (!Array.isArray(releases)) throw Error('Invalid published release list');
const result = { windows: null, android: null };
for (const release of releases.filter((item) => !item.draft && item.published_at)) {
  for (const [platform, pattern] of [['windows', /^Foliuna.*\.exe$/i], ['android', /^Foliuna-Android-0\.1\.0-preview\.1-debug\.apk$/]]) {
    if (result[platform]) continue;
    const asset = release.assets?.find((asset) => pattern.test(asset.name) && asset.state === 'uploaded' && asset.size > 0);
    if (asset) result[platform] = { version: release.tag_name, download: asset.browser_download_url, release: release.html_url };
  }
}
await writeFile(new URL('releases.json', target), JSON.stringify(result, null, 2) + '\n');
await writeFile(new URL('.nojekyll', target), '');
console.log('Built GitHub Pages site using published release assets:', Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value?.version ?? 'forthcoming'])));
