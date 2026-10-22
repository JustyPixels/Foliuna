import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

const profile = await mkdtemp(join(tmpdir(), 'foliuna-packaged-'));
const root = join(profile,'archive'); await mkdir(join(root,'incoming'),{recursive:true});
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=','base64');
const hash = createHash('sha256').update(bytes).digest('hex');
const tags = {artist:['fixture_artist'],general:['forest'],species:[],copyright:[],character:[],meta:[],lore:[],invalid:[]};
const metadata = {id:42,rating:'s',tags,file:{url:'https://static1.e621.net/fixture.png',ext:'png',size:bytes.length,width:1,height:1,md5:null},flags:{deleted:false},sources:[]};
await writeFile(join(root,'incoming',hash+'.png'),bytes);
await writeFile(join(root,'incoming',hash+'.png.foliuna.json'),JSON.stringify({schemaVersion:1,asset:{sha256:hash,byteSize:bytes.length,mediaFile:hash+'.png'},sources:[{provider:'e621',postId:42,url:'https://e621.net/posts/42',snapshots:[{capturedAt:'2026-10-22T00:00:00.000Z',metadata,categorizedTags:tags}]}]}));
await writeFile(join(profile,'library.json'),JSON.stringify({root}));
const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const port = server.address().port; await new Promise((done) => server.close(done));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const executable = resolve(process.argv[2] ?? 'release/win-unpacked/Foliuna.exe');
const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
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
  await expect(page).toHaveTitle('Foliuna'); await expect(page.getByText('LIVE SEARCH', { exact: true })).toBeVisible();
  await expect(page.getByText('Library ready · 0 saved')).toBeVisible();
  assert.deepEqual(await page.evaluate(() => ({ node: typeof window.require, process: typeof window.process })), { node: 'undefined', process: 'undefined' });
  await page.getByRole('button', { name: 'Gallery', exact: true }).click();
  await page.getByRole('button', { name: 'Import sidecars', exact: true }).click();
  await expect(page.getByRole('button', { name: /^View post/ })).toHaveCount(1);
  await expect.poll(() => page.locator('.post-card img').first().evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'View post 42' }).click();
  await expect(page.getByRole('heading', { name: 'Categorized tags' })).toBeVisible();
  await page.getByRole('button', { name: 'Open media window ↗' }).click();
  await expect.poll(() => context.pages().length).toBe(2);
  const viewer = context.pages().find((candidate) => candidate !== page); await viewer.waitForLoadState();
  assert.equal(await viewer.evaluate(() => typeof window.foliuna), 'undefined');
  await viewer.close(); await expect(page.getByRole('region', { name: 'Post #42' })).toBeVisible();
  await page.getByRole('button', { name: 'Close post details' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Load results').selectOption('infinite'); await page.getByRole('button', { name: 'Close settings' }).click();
  await expect.poll(async () => JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')).browsing).toBe('infinite');
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  await page.waitForFunction(() => [...document.querySelectorAll('.post-card img')].filter((image) => image.getBoundingClientRect().top < innerHeight).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: 'work/packaged-smoke.png' });
  const session = await browser.newBrowserCDPSession();
  // Electron may exit before acknowledging Chromium's close command.
  void session.send('Browser.close').catch(() => {});
  let timeout;
  try { assert.equal(await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('App did not close normally')), 10000); })]), 0, 'Normal app exit'); }
  finally { clearTimeout(timeout); }
  await writeFile('release/packaged-smoke.json', JSON.stringify({ passed: true, executable: 'Foliuna.exe', profile: 'isolated temporary directory', checks: ['startup', 'offline sidecar import', 'local preview', 'details', 'viewer isolation/return', 'settings persistence', 'no renderer Node', 'no remote renderer requests', 'normal shutdown'], pageErrors: errors, remoteRequests: network }, null, 2) + '\n');
  console.log('Packaged Windows app smoke checks passed with hardened fuses and an isolated profile.');
} finally {
  if (browser?.isConnected()) await browser.close().catch(() => {});
  if (child.exitCode === null) { child.kill(); await exited.catch(() => {}); }
  assert.ok(profile.startsWith(join(tmpdir(), 'foliuna-packaged-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
