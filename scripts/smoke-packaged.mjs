import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

const profile = await mkdtemp(join(tmpdir(), 'foliuna-packaged-'));
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const port = server.address().port; await new Promise((done) => server.close(done));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const executable = resolve(process.argv[2] ?? 'release/win-unpacked/Foliuna.exe');
const child = spawn(executable, ['--demo', `--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let startupError;
const exited = new Promise((done) => { child.once('exit', done); child.once('error', (error) => { startupError = error; done(); }); }); let browser;
const diagnostics = []; child.stderr.on('data', (data) => diagnostics.push(data.toString()));
try {
  let endpoint;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Packaged app exited (${child.exitCode}): ${diagnostics.join('').slice(-2000)}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }); endpoint = (await response.json()).webSocketDebuggerUrl; if (endpoint) break; } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(endpoint, 'Packaged app must expose its explicitly requested local browser test connection');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().length).toBeGreaterThan(0);
  const page = context.pages()[0]; const errors = [], network = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await expect(page).toHaveTitle('Foliuna'); await expect(page.getByText('LOCAL DEMO', { exact: true })).toBeVisible();
  await expect(page.getByText('Library ready · 0 saved')).toBeVisible();
  assert.deepEqual(await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process })), { node: 'undefined', process: 'undefined' });
  await page.getByLabel('SEARCH TAGS').fill('forest'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(24);
  await expect.poll(() => page.locator('.post-card img').first().evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'View post 1001' }).click();
  await expect(page.getByRole('heading', { name: 'Categorized tags' })).toBeVisible();
  await page.getByRole('button', { name: 'Next post →' }).click(); await expect(page.getByRole('dialog', { name: 'Post #1002' })).toBeVisible();
  await page.getByRole('button', { name: 'Open media window ↗' }).click();
  await expect.poll(() => context.pages().length).toBe(2);
  const viewer = context.pages().find((candidate) => candidate !== page); await viewer.waitForLoadState();
  assert.equal(await viewer.evaluate(() => typeof window.foliuna), 'undefined');
  await viewer.close(); await expect(page.getByRole('dialog', { name: 'Post #1002' })).toBeVisible();
  await page.getByRole('button', { name: 'Close post details' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Load results').selectOption('infinite'); await page.getByRole('button', { name: 'Close settings' }).click();
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).browsing).toBe('infinite');
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  await page.waitForFunction(() => [...document.querySelectorAll('.post-card img')].filter((image) => image.getBoundingClientRect().top < innerHeight).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: 'docs/screenshots/packaged.png' });
  const session = await browser.newBrowserCDPSession();
  // Electron may exit before acknowledging Chromium's close command.
  void session.send('Browser.close').catch(() => {});
  let timeout;
  try { assert.equal(await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('App did not close normally')), 10000); })]), 0, 'Normal app exit'); }
  finally { clearTimeout(timeout); }
  await writeFile('release/packaged-smoke.json', JSON.stringify({ passed: true, executable: 'Foliuna.exe', profile: 'isolated temporary directory', checks: ['startup', 'offline demo', '24 previews', 'details/navigation', 'viewer isolation/return', 'settings persistence', 'no renderer Node', 'no remote renderer requests', 'normal shutdown'], pageErrors: errors, remoteRequests: network }, null, 2) + '\n');
  console.log('Packaged Windows app smoke checks passed with hardened fuses and an isolated profile.');
} finally {
  if (browser?.isConnected()) await browser.close().catch(() => {});
  if (child.exitCode === null) { child.kill(); await exited.catch(() => {}); }
  assert.ok(profile.startsWith(join(tmpdir(), 'foliuna-packaged-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
