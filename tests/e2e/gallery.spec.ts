import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('offline gallery: restore sidecars, local tags/images/video/Flash, cached thumbnails, moved/missing files and restart', async () => {
  test.setTimeout(60000);
  const profile = mkdtempSync(join(tmpdir(), 'foliuna-offline-'));
  const root = join(profile, 'archive');
  const env: Record<string, string> = { ...process.env, FOLIUNA_DATA_DIR: profile, FOLIUNA_DEMO: '0', FOLIUNA_FIXTURE_BROWSING: '1', FOLIUNA_FIXTURE_OFFLINE: '1' }; delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['tests/fixtures/media-app.cjs'], env });
  try {
    let page = await app.firstWindow();
    const remote: string[] = []; page.on('request', (request) => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
    await page.getByRole('button', { name: 'Gallery', exact: true }).click();
    await expect(page.getByText('OFFLINE GALLERY', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Import sidecars', exact: true }).click();
    await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(5);
    await expect(page.getByText('Library ready · 5 saved')).toBeVisible();
    const entries = await page.evaluate(() => window.foliuna.gallerySearch({ tags: 'id:1001 provider:e621', page: 1 }));
    if (!entries.ok) throw new Error(entries.error.message);
    const hash = entries.value.posts[0].archive!.sha256;
    const original = join(root, 'media', `${hash}.png`); expect(existsSync(original)).toBe(true);
    await page.getByLabel('SEARCH TAGS').fill('fi');
    await expect(page.getByRole('option', { name: /fixture_artist/ })).toBeVisible();
    await page.getByLabel('SEARCH TAGS').press('Escape');
    await page.getByLabel('SEARCH TAGS').fill('provider:e621 id:1001'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('button', { name: 'View post 1001' }).click();
    const sample = page.getByAltText('Sample of post 1001'); await expect.poll(() => sample.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(240);
    await expect(page.getByRole('heading', { name: 'Archived source history' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download original', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open media window ↗' }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    const viewer = app.windows().find((item) => item !== page)!;
    await expect.poll(() => viewer.getByAltText('Post 1001').evaluate((node) => (node as HTMLImageElement).naturalHeight)).toBe(720);
    expect(await viewer.evaluate(() => typeof (window as unknown as { foliuna?: unknown }).foliuna)).toBe('undefined');
    await viewer.getByRole('button', { name: 'Close window' }).click(); await expect(page.getByRole('dialog', { name: 'Post #1001' })).toBeVisible();
    await page.getByRole('button', { name: 'Close post details' }).click();
    await expect.poll(() => existsSync(join(root, '.foliuna', 'thumbnails', `${hash}.png`))).toBe(true);
    const card = page.getByRole('button', { name: 'View post 1001' }); await card.scrollIntoViewIfNeeded();
    await expect.poll(() => card.locator('img').evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => card.locator('img').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(0);
    expect(await card.locator('img').evaluate((node) => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!; context.drawImage(node as HTMLImageElement, 0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    })).toEqual([180, 140, 90, 255]);
    await page.screenshot({ path: 'docs/screenshots/gallery.png' });
    for (const id of [1003, 1004, 1005]) {
      await page.getByLabel('SEARCH TAGS').fill(`id:${id}`); await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('button', { name: `View post ${id}` }).click();
      if (id === 1003) {
        const video = page.getByLabel('Video of post 1003'); await video.evaluate((node) => (node as HTMLVideoElement).play());
        await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).videoWidth)).toBe(160);
      } else if (id === 1004) {
        await page.getByRole('button', { name: 'Play Flash with Ruffle' }).click();
        const player = page.frameLocator('iframe[title="Flash of post 1004"]').locator('ruffle-player');
        await expect.poll(() => player.evaluate((node) => (node as unknown as { ruffle(): { metadata: { width: number } | null } }).ruffle().metadata?.width), { timeout: 15000 }).toBe(200);
      } else await expect.poll(() => page.getByAltText('Sample of post 1005').evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(32);
      await page.getByRole('button', { name: 'Close post details' }).click();
    }
    mkdirSync(join(root, 'moved')); renameSync(original, join(root, 'moved', 'renamed.png'));
    await page.getByRole('button', { name: 'Check library files' }).click();
    await expect(page.getByRole('region', { name: 'Library report' })).toContainText('Recovered 1'); expect(existsSync(original)).toBe(true);
    rmSync(original); rmSync(join(root, 'moved', 'renamed.png')); rmSync(join(root, 'incoming', `${hash}.png`));
    await page.getByRole('button', { name: 'Check library files' }).click();
    await expect(page.getByRole('region', { name: 'Library report' })).toContainText('Missing 1');
    await page.getByLabel('SEARCH TAGS').fill('provider:e621 id:1001'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByText('Original missing · metadata preserved')).toBeVisible();
    await page.getByRole('button', { name: 'View post 1001' }).click();
    await expect(page.getByText('Original missing or unavailable.', { exact: false })).toBeVisible();
    expect(await app.evaluate(() => (globalThis as unknown as { __foliunaForbiddenRequests: string[] }).__foliunaForbiddenRequests)).toEqual([]);
    expect(remote).toEqual([]);
    await app.close();
    app = await electron.launch({ args: ['tests/fixtures/media-app.cjs'], env }); page = await app.firstWindow();
    await page.getByRole('button', { name: 'Gallery', exact: true }).click(); await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(5);
    expect(await app.evaluate(() => (globalThis as unknown as { __foliunaForbiddenRequests: string[] }).__foliunaForbiddenRequests)).toEqual([]);
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
