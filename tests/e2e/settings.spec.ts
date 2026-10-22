import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ trace: 'off' });
test('Windows DPAPI credentials: save, write-only status, restart persistence, removal and library selection', async () => {
  test.skip(process.platform !== 'win32', 'Windows encryption is the supported credential backend.');
  const profile = mkdtempSync(join(tmpdir(), 'foliuna-settings-'));
  const root = join(profile, 'archive'); mkdirSync(root);
  const canonicalRoot = realpathSync.native(root);
  const env: Record<string, string> = { ...process.env, FOLIUNA_DATA_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let app = await electron.launch({ args: ['.'], env });
  try {
    let page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('API key')).toBeEnabled();
    await page.getByLabel('Site username').fill('fixture_e621_user');
    await page.getByLabel('API key').fill('FICTIONAL_E621_TEST_KEY');
    await page.getByRole('button', { name: 'Save credentials' }).click();
    await expect(page.getByText(/Credentials encrypted and saved/)).toBeVisible();
    await expect(page.getByLabel('API key')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Test connection' })).toBeEnabled();
    for (const provider of ['e621']) {
      const disk = readFileSync(join(profile, `${provider}.credentials.enc`));
      expect(disk.includes(Buffer.from(`FICTIONAL_${provider.toUpperCase()}_TEST_KEY`))).toBe(false);
      expect(disk.includes(Buffer.from(`fixture_${provider}_user`))).toBe(false);
    }
    const status = await page.evaluate(() => window.foliuna.getSettings());
    expect(JSON.stringify(status)).not.toContain('TEST_KEY');
    expect(status).toMatchObject({ ok: true, value: { encryptionAvailable: true, credentials: expect.arrayContaining([
      { provider: 'e621', saved: true, username: 'fixture_e621_user', locked: false },
    ]) } });
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, root);
    await page.getByRole('button', { name: 'Choose archive folder' }).click();
    await expect(page.getByText(canonicalRoot, { exact: true })).toBeVisible();
    expect(existsSync(join(root, '.foliuna', 'library.sqlite'))).toBe(true);
    await page.screenshot({ path: 'test-results/screenshots/settings.png' });
    await app.close();
    app = await electron.launch({ args: ['.'], env }); page = await app.firstWindow();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText(canonicalRoot, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Site username')).toHaveValue('fixture_e621_user');
    await expect(page.getByLabel('API key')).toHaveValue('');
    await page.getByRole('button', { name: 'Remove credentials' }).click();
    await expect(page.getByText(/Saved credentials removed/)).toBeVisible();
    expect(existsSync(join(profile, 'e621.credentials.enc'))).toBe(false);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
  } finally { await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
