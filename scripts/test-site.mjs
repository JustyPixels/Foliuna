import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('site/dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    assert(url.pathname.startsWith('/Foliuna/'));
    const file = path.resolve(root, '.' + url.pathname.replace('/Foliuna/', '/') + (url.pathname.endsWith('/') ? 'index.html' : ''));
    assert(file.startsWith(root + path.sep));
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'chrome' } : {});
const failures = [];
try {
  for (const viewport of [{ width: 360, height: 800 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    const requested = []; const errors = [];
    page.on('request', (request) => requested.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => { if (response.status() >= 400) failures.push(response.url()); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/Foliuna/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.demo-card').count(), 6);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#demo-tags').fill('fox');
    await page.locator('#demo-search button').click();
    assert.equal(await page.locator('.demo-card').count(), 2);
    await page.locator('#demo-layout').click();
    assert.equal(await page.locator('#demo-layout').getAttribute('aria-pressed'), 'true');
    await page.locator('.demo-card').first().click();
    assert.equal(await page.locator('#demo-details').evaluate((dialog) => dialog.open), true);
    assert.equal(await page.locator('#demo-image').evaluate((image) => image.complete && image.naturalWidth > 0), true);
    await page.keyboard.press('Escape');
    await page.locator('#demo-tags').fill('-wolf');
    await page.locator('#demo-search button').click();
    assert.equal(await page.locator('.demo-card').count(), 4);
    assert.match(await page.locator('#windows-download').getAttribute('href'), /^https:\/\/github.com\/JustyPixels\/Foliuna\/releases\/download\//i);
    const releases = JSON.parse(await readFile(path.join(root, 'releases.json'), 'utf8'));
    if (releases.android) assert.equal(await page.locator('#android-download').getAttribute('href'), releases.android.download);
    else assert.match(await page.locator('#android-version').innerText(), /Forthcoming/);
    assert.deepEqual(errors, []);
    assert(requested.every((url) => url.startsWith(origin + '/Foliuna/')), 'The demonstration requested an external service');
    await mkdir('work/site', { recursive: true });
    await page.screenshot({ path: 'work/site/showcase-' + viewport.width + '.png', fullPage: true });
    await page.close();
  }
  assert.deepEqual(failures, []);
  console.log('Site passed phone/tablet/desktop layout, project-path assets, local demo, details, no external requests and published download checks.');
} finally { await browser.close(); server.close(); }
