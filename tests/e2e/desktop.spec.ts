import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Windows desktop: local search journey, database startup and Electron isolation', async () => {
  const data = mkdtempSync(join(tmpdir(), 'foliuna-desktop-'));
  const env: Record<string, string> = { ...process.env, FOLIUNA_DEMO: '1', FOLIUNA_DATA_DIR: data };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    const remoteRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
    await expect(page).toHaveTitle('Foliuna');
    await expect(page.getByText('LOCAL DEMO', { exact: true })).toBeVisible();
    await expect(page.getByText('Library ready · 0 saved')).toBeVisible();
    await page.getByLabel('SEARCH TAGS').fill('forest');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(24);
    await expect(page.getByRole('button', { name: /Previous/ })).toBeDisabled();
    await expect.poll(() => page.locator('.post-card img').first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'View post 1001' }).click();
    await expect(page.getByRole('dialog', { name: 'Post #1001' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Categorized tags' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fictional demo post' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View post 1001' })).toBeFocused();
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(6);
    await expect(page.getByRole('button', { name: /Next/ })).toBeDisabled();
    await page.getByLabel('E621 CONTENT').selectOption('all');
    await page.getByLabel('SEARCH TAGS').fill('fox -wolf');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(10);

    const sandboxed = await app.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
      return app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed;
    });
    expect(sandboxed).toBe(true);
    expect(await page.evaluate(() => ({ require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process, methods: Object.keys(window.foliuna).sort() })))
      .toEqual({ require: 'undefined', process: 'undefined', methods: ['cacheThumbnail', 'cancelDownload', 'chooseLibrary', 'collectionCreate', 'collectionDelete', 'collectionList', 'collectionMembership', 'collectionRename', 'downloadPost', 'galleryPost', 'gallerySearch', 'galleryTags', 'getAccount', 'getPost', 'getPreferences', 'getSettings', 'importSidecars', 'libraryStatus', 'openPost', 'openViewer', 'reconcileLibrary', 'removeCredentials', 'removeProvider', 'saveCredentials', 'savePreferences', 'saveProvider', 'search', 'suggestTags', 'testConnection'] });
    expect(await page.evaluate(() => window.foliuna.search({ provider: 'e926', tags: '', page: -1 })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const policy = await app.evaluate(async ({ session }) => {
      const response = await session.defaultSession.fetch('foliuna://app/index.html');
      return response.headers.get('content-security-policy');
    });
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("script-src 'self'");
    await page.evaluate(() => { window.open('https://example.com'); });
    expect(app.windows()).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    expect(remoteRequests).toEqual([]);

    await page.getByLabel('E621 CONTENT').selectOption('safe');
    await page.getByLabel('SEARCH TAGS').fill('forest');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(24);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.post-card img')].filter((image) => image.getBoundingClientRect().top < innerHeight).every((image) => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: 'docs/screenshots/discover.png' });
    await page.getByRole('button', { name: 'View post 1001' }).click();
    await expect(page.getByRole('heading', { name: 'Categorized tags' })).toBeVisible();
    await expect(page.getByLabel('Image size')).toHaveValue('sample');
    await page.getByLabel('Image size').selectOption('original');
    await expect(page.getByAltText('Full-size image of post 1001')).toBeVisible();
    await page.getByLabel('Image size').selectOption('sample');
    await page.screenshot({ path: 'docs/screenshots/post-details.png' });
    const navigation = await app.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      const blocked = new Promise<boolean>((resolve) => contents.once('will-frame-navigate', (event) => resolve(event.defaultPrevented)));
      await contents.executeJavaScript("window.location.href = 'https://example.com'; void 0");
      return { blocked: await blocked, url: contents.getURL() };
    });
    expect(navigation).toEqual({ blocked: true, url: 'foliuna://app/index.html' });
  } finally { await app.close(); rmSync(data, { recursive: true, force: true }); }
});
