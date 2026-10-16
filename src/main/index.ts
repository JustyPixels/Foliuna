import { app, BrowserWindow, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { ApiClient, USER_AGENT } from './adapters/http';
import { ProviderStore } from './providers';
import { CompatibleAdapter } from './adapters/compatible';
import type { BooruAdapter } from './adapters/types';
import { publicFetch } from './public-fetch';
import { E621Adapter } from './adapters/e621';
import { DemoAdapter } from './adapters/demo';
import { ArchiveLibrary } from './archive/library';
import { CredentialStore } from './credentials';
import { APP_URL, bundlePath, CSP, PLAYER_CSP } from './security';
import { actions, respond } from './ipc';
import { mediaRoute, PostMedia } from './media';
import { PreferenceStore } from './preferences';
import { Gallery, galleryRoute } from './archive/gallery';

app.setName('Foliuna');
const demo = app.commandLine.hasSwitch('demo') || (!app.isPackaged && process.env.FOLIUNA_DEMO === '1');
const profile = app.commandLine.getSwitchValue('user-data-dir');
if (profile) app.setPath('userData', resolve(profile));
else if (!app.isPackaged && process.env.FOLIUNA_DATA_DIR) app.setPath('userData', resolve(process.env.FOLIUNA_DATA_DIR));
else if (demo) app.setPath('userData', join(app.getPath('appData'), 'Foliuna Demo'));
protocol.registerSchemesAsPrivileged([{ scheme: 'foliuna', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window: BrowserWindow | null = null;
let library: ArchiveLibrary | undefined;
let credentials: CredentialStore | undefined;
let preferences: PreferenceStore | undefined;
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    mkdirSync(app.getPath('userData'), { recursive: true });
    credentials = new CredentialStore(app.getPath('userData'), {
      available: async () => process.platform === 'win32' && await safeStorage.isAsyncEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptStringAsync(value),
      decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
    });
    const root = join(__dirname, 'renderer');
    preferences = new PreferenceStore(app.getPath('userData'));
    const fetcher = !app.isPackaged && process.env.FOLIUNA_TEST_NETWORK === '1' ? fetch : publicFetch;
    const media = new PostMedia(fetcher);
    const providers = new ProviderStore(app.getPath('userData'));
    await providers.initialize();
    let gallery: Gallery;
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
    protocol.handle('foliuna', async (request) => {
      if (mediaRoute(request.url)) return media.handle(request);
      if (galleryRoute(request.url)) return gallery.handle(request);
      const path = bundlePath(request.url, root);
      if (!path || request.method !== 'GET') return new Response('Not found', { status: 404 });
      try {
        return new Response(new Uint8Array(await readFile(path)), { headers: {
          'Content-Type': mime[extname(path)],
          'Content-Security-Policy': new URL(request.url).host === 'player' ? PLAYER_CSP : CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    const ses = session.defaultSession;
    let viewer: BrowserWindow | null = null;
    ses.setUserAgent(USER_AGENT);
    ses.setPermissionRequestHandler((contents, permission, callback, details) => callback(permission === 'fullscreen' &&
      contents === viewer?.webContents && details.isMainFrame && details.requestingUrl.startsWith('foliuna://app/viewer.html#')));
    ses.setPermissionCheckHandler((contents, permission, _origin, details) => permission === 'fullscreen' &&
      contents === viewer?.webContents && details.isMainFrame && viewer!.webContents.getURL().startsWith('foliuna://app/viewer.html#'));
    ses.on('will-download', (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, callback) => {
      const local = bundlePath(details.url, root) !== null;
      callback({ cancel: !(local || (['image', 'media', 'xhr'].includes(details.resourceType) && (mediaRoute(details.url) !== null || galleryRoute(details.url) !== null))) });
    });
    const client = new ApiClient(fetcher, (provider) => credentials!.read(provider), () => providers.list());
    const adapters: Partial<Record<string, BooruAdapter>> = {};
    const refreshProviders = () => {
      for (const id of Object.keys(adapters)) delete adapters[id];
      for (const source of providers.list()) adapters[source.id] = demo ? new DemoAdapter(source.id) : source.engine === 'e621' ? new E621Adapter(source.id, client) : new CompatibleAdapter(source, client);
    };
    refreshProviders();
    library = new ArchiveLibrary(app.getPath('userData'), adapters, demo, fetcher);
    await library.initialize();
    gallery = new Gallery(library);
    let choosingDirectory = false;
    const handlers = actions({ adapters, library, credentials, client, demo, media, preferences, providers, refreshProviders, openExternal: (url) => shell.openExternal(url),
      openViewer: async (request) => {
        const post = 'archiveSha' in request ? await gallery.getPost(request.archiveSha, request.source) : media.register(await adapters[request.provider]!.getPost(request.id));
        if (post.unavailable) throw new Error('Unavailable post');
        viewer?.close();
        viewer = new BrowserWindow({ parent: window ?? undefined, title: `Foliuna · Post #${post.id}`, width: 1000, height: 800,
          minWidth: 320, minHeight: 240, autoHideMenuBar: true, backgroundColor: '#101815',
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, webviewTag: false } });
        const current = viewer;
        current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        current.webContents.on('will-navigate', (e) => e.preventDefault());
        current.webContents.on('will-frame-navigate', (e) => { if (e.isMainFrame || !/^foliuna:\/\/player\/swf\.html#(?:[a-z][a-z0-9-]{0,63}\/[1-9]\d*|gallery\/[0-9a-f]{64})$/.test(e.url)) e.preventDefault(); });
        current.webContents.on('will-redirect', (e) => e.preventDefault());
        current.webContents.on('will-attach-webview', (e) => e.preventDefault());
        current.webContents.on('before-input-event', (event, input) => {
          if (input.type === 'keyDown' && input.key === 'F11') { event.preventDefault(); current.setFullScreen(!current.isFullScreen()); }
          if (input.type === 'keyDown' && input.key === 'Escape' && current.isFullScreen()) { event.preventDefault(); current.setFullScreen(false); }
        });
        current.on('closed', () => { if (viewer === current) viewer = null; window?.focus(); });
        // This window has no preload or bridge; fragment values are derived from validated post metadata.
        const variant = ['webm', 'mp4', 'swf', 'gif'].includes(post.file.extension) ? 'original' : request.size;
        const asset = post.archive ? `/gallery/${post.archive.sha256}/original` : demo ? `/demo/${post.tags.species[0]}.svg` : `/media/${post.provider}/${post.id}/${variant}`;
        await current.loadURL(`foliuna://app/viewer.html#${encodeURIComponent(JSON.stringify({ id: post.id, extension: post.file.extension, asset, archiveSha: post.archive?.sha256 }))}`);
      },
      selectDirectory: async () => {
        if (!window || choosingDirectory || library!.downloading) return null;
        choosingDirectory = true;
        try {
          const selection = await dialog.showOpenDialog(window, { title: 'Choose a Foliuna archive folder', buttonLabel: 'Use this folder', properties: ['openDirectory', 'dontAddToRecent'] });
          return selection.canceled ? null : selection.filePaths[0] ?? null;
        } finally { choosingDirectory = false; }
      },
    });
    for (const [channel, action] of Object.entries(handlers)) {
      ipcMain.handle(channel, (event, input: unknown) => respond<unknown>({
        senderId: event.sender.id, windowId: window?.webContents.id ?? -1,
        isMainFrame: event.senderFrame === event.sender.mainFrame,
        url: event.senderFrame?.url ?? '',
      }, () => action(input)));
    }
    const createWindow = async () => {
      window = new BrowserWindow({ icon: join(app.getAppPath(), app.isPackaged ? 'icon.png' : 'build/icon.png'),
        title: 'Foliuna', width: 1440, height: 960, minWidth: 900, minHeight: 650, backgroundColor: '#101815',
        autoHideMenuBar: true,
        webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,
          sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('will-frame-navigate', (event) => { if (event.isMainFrame || !/^foliuna:\/\/player\/swf\.html#(?:[a-z][a-z0-9-]{0,63}\/[1-9]\d*|gallery\/[0-9a-f]{64})$/.test(event.url)) event.preventDefault(); });
      window.webContents.on('will-redirect', (event) => event.preventDefault());
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.on('closed', () => { window = null; });
      await window.loadURL(APP_URL);
    };
    await createWindow();
    app.on('activate', () => { if (!window) void createWindow(); });
  }).catch((error: unknown) => {
    console.error('Foliuna startup failed:', error);
    dialog.showErrorBox('Foliuna could not start', 'The library or app files could not be opened. Your library has not been reset. Check permissions and use a compatible app version.');
    app.quit();
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
let closing = false;
app.on('before-quit', (event) => {
  if (closing || !library) return;
  closing = true;
  event.preventDefault();
  void Promise.all([library.close(), credentials?.flush(), preferences?.flush()]).then(() => app.exit(0), () => app.exit(1));
});
