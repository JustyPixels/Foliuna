import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real image decoding: local media route, sample/full selection, portrait and landscape aspect ratios', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'foliuna-images-'));
  const env: Record<string, string> = { ...process.env, FOLIUNA_DATA_DIR: profile, FOLIUNA_DEMO: '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['tests/fixtures/media-app.cjs'], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('LIVE SEARCH', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(2);
    for (const id of [1001, 1002]) {
      const card = page.getByRole('button', { name: `View post ${id}` });
      await expect.poll(() => card.locator('img').evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await card.locator('img').evaluate((node) => getComputedStyle(node).objectFit)).toBe('contain');
    }
    const hits = () => app.evaluate(() => (globalThis as unknown as { __foliunaMediaHits: { path: string; authenticated: boolean }[] }).__foliunaMediaHits);
    expect((await hits()).some((hit) => /original/.test(hit.path))).toBe(false);
    for (const id of [1001, 1002]) {
      await page.getByRole('button', { name: `View post ${id}` }).click();
      await expect(page.getByLabel('Image size')).toHaveValue('sample');
      const sample = page.getByAltText(`Sample of post ${id}`);
      await expect.poll(() => sample.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect((await hits()).some((hit) => hit.path === `/data/${id}/original.png`)).toBe(false);
      await page.getByLabel('Image size').selectOption('original');
      const full = page.getByAltText(`Full-size image of post ${id}`);
      await expect.poll(() => full.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(id === 1001 ? 240 : 720);
      const dimensions = await full.evaluate((node) => {
        const image = node as HTMLImageElement; const bounds = image.getBoundingClientRect();
        return { drawn: bounds.width / bounds.height, natural: image.naturalWidth / image.naturalHeight };
      });
      expect(dimensions.drawn).toBeCloseTo(dimensions.natural, 2);
      await page.keyboard.press('Escape');
    }
    expect((await hits()).every((hit) => !hit.authenticated)).toBe(true);
    const assets = await page.evaluate(() => window.foliuna.libraryStatus());
    expect(assets).toMatchObject({ ok: true, value: { assets: 0 } });
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
