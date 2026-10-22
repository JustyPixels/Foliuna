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
    const origin = process.env.FOLIUNA_SITE_URL ? new URL(process.env.FOLIUNA_SITE_URL).origin : 'http://127.0.0.1:' + server.address().port;
    await page.goto(origin + '/Foliuna/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[id^="demo-"]').count(), 0);
    assert.equal(await page.locator('form,input,dialog').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const credits = JSON.parse(await readFile(path.join(root, 'artwork/credits.json'), 'utf8'));
    assert.equal(new Set(credits.map(art => art.artist)).size, 4);
    for (const art of credits) {
      const figure = page.locator('figure[data-artwork="' + art.file + '"]').first();
      if(await figure.count()===0) continue;
      await figure.scrollIntoViewIfNeeded();
      await figure.locator('img').evaluate(image => image.decode());
      assert.equal(await figure.locator('img').evaluate(image => image.naturalWidth > 0), true);
      assert((await figure.innerText()).includes(art.artist));
      assert.equal(await figure.locator('a[href="' + art.post + '"]').count(), 1);
      assert.equal(art.rating, 's');
    }
    for(const screenshot of await page.locator('.app-preview img').all()) { await screenshot.scrollIntoViewIfNeeded(); await screenshot.evaluate(image => image.decode()); assert(await screenshot.evaluate(image => image.naturalWidth > 0)); }
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion-ready')), false);
    assert.match(await page.locator('#windows-download').getAttribute('href'), /^https:\/\/github.com\/JustyPixels\/Foliuna\/releases\/download\//i);
    const releases = JSON.parse(await readFile(path.join(root, 'releases.json'), 'utf8'));
    if (releases.android) assert.equal(await page.locator('#android-download').getAttribute('href'), releases.android.download);
    else assert.match(await page.locator('#android-version').innerText(), /Forthcoming/);
    assert.deepEqual(errors, []);
    assert(requested.every((url) => url.startsWith(origin + '/Foliuna/')), 'The site requested an external service');
    await mkdir('work/site', { recursive: true });
    await page.screenshot({ path: 'work/site/showcase-' + viewport.width + '.png', fullPage: true });
    await page.close();
  }
  const moving = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const origin = process.env.FOLIUNA_SITE_URL ? new URL(process.env.FOLIUNA_SITE_URL).origin : 'http://127.0.0.1:' + server.address().port;
  await moving.goto(origin + '/Foliuna/', { waitUntil: 'networkidle' });
  assert.equal(await moving.evaluate(() => document.documentElement.classList.contains('motion-ready')), true);
  await moving.mouse.move(0, 0);
  const originalArt = await moving.locator('.hero-art').getAttribute('data-artwork');
  await moving.waitForFunction(original => document.querySelector('.hero-art').dataset.artwork !== original, originalArt, {timeout:8000});
  const rotatedFile = await moving.locator('.hero-art').getAttribute('data-artwork');
  const rotated = JSON.parse(await readFile(path.join(root, 'artwork/credits.json'),'utf8')).find(art => art.file === rotatedFile);
  assert((await moving.locator('.hero-art figcaption').innerText()).includes(rotated.artist));
  await moving.locator('#artwork-rotation').click();
  const pausedArt = await moving.locator('.hero-art').getAttribute('data-artwork');
  await moving.waitForTimeout(5200);
  assert.equal(await moving.locator('.hero-art').getAttribute('data-artwork'), pausedArt);
  const before = await moving.locator('.hero-art').evaluate(element => getComputedStyle(element).transform);
  await moving.evaluate(() => scrollTo(0, 700));
  await moving.waitForFunction(() => parseFloat(document.documentElement.style.getPropertyValue('--progress')) > 0);
  assert.notEqual(await moving.locator('.hero-art').evaluate(element => getComputedStyle(element).transform), before);
  await moving.emulateMedia({ reducedMotion: 'reduce' });
  await moving.waitForFunction(() => !document.documentElement.classList.contains('motion-ready'));
  assert.equal(await moving.locator('.hero-art').evaluate(element => getComputedStyle(element).transform), 'none');
  await moving.close();
  assert.deepEqual(failures, []);
  console.log('Site passed phone/tablet/desktop layout, search artwork/credits, no demo or external image/API requests, scroll motion/reduced motion and published downloads.');
} finally { await browser.close(); server.close(); }
