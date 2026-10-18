import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import type { FoliunaApi, Result } from '../shared/contracts';
import './android.css';

type NativeApi = { [K in keyof FoliunaApi]: (options?: { input?: unknown }) => ReturnType<FoliunaApi[K]> };
const native = registerPlugin<NativeApi>('Foliuna');
// Keep this explicit: no arbitrary native method or generic fetch capability.
export function initializeAndroid() {
  const api: FoliunaApi = {
    platform: () => native.platform(), exportLibrary: () => native.exportLibrary(),
    search: (input) => native.search({ input }), getPost: (input) => native.getPost({ input }),
    libraryStatus: () => native.libraryStatus(), openPost: (input) => native.openPost({ input }),
    getSettings: () => native.getSettings(), saveCredentials: (input) => native.saveCredentials({ input }),
    removeCredentials: (input) => native.removeCredentials({ input }), testConnection: (input) => native.testConnection({ input }),
    saveProvider: (input) => native.saveProvider({ input }), removeProvider: (input) => native.removeProvider({ input }),
    chooseLibrary: () => native.chooseLibrary(), downloadPost: (input) => native.downloadPost({ input }),
    cancelDownload: () => native.cancelDownload(), getPreferences: () => native.getPreferences(),
    savePreferences: (input) => native.savePreferences({ input }), suggestTags: (input) => native.suggestTags({ input }),
    getAccount: () => native.getAccount(), openViewer: (input) => native.openViewer({ input }),
    gallerySearch: (input) => native.gallerySearch({ input }), galleryPost: (input) => native.galleryPost({ input }),
    galleryTags: (input) => native.galleryTags({ input }), importSidecars: () => native.importSidecars(),
    reconcileLibrary: () => native.reconcileLibrary(),
    cacheThumbnail: ({ sha256, png }) => {
      if (!(png instanceof Uint8Array) || png.byteLength > 2 * 1024 * 1024) return Promise.resolve<Result<null>>({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid thumbnail.' } });
      let binary = ''; for (const byte of png) binary += String.fromCharCode(byte);
      return native.cacheThumbnail({ input: { sha256, png: btoa(binary) } });
    },
    collectionList: (input) => native.collectionList({ input }), collectionCreate: (input) => native.collectionCreate({ input }),
    collectionRename: (input) => native.collectionRename({ input }), collectionDelete: (input) => native.collectionDelete({ input }),
    collectionMembership: (input) => native.collectionMembership({ input }),
  };
  Object.defineProperty(window, 'foliuna', { value: Object.freeze(api), writable: false, configurable: false });
  document.documentElement.dataset.platform = 'android';
  void App.addListener('backButton', () => {
    const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
    const dialog = dialogs[dialogs.length - 1];
    if (dialog) { dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })); return; }
    const event = new Event('foliuna-back', { cancelable: true });
    if (window.dispatchEvent(event)) void App.exitApp();
  });
}
