import type { PlatformCapabilities } from '../shared/contracts';
import { WINDOWS_CAPABILITIES } from '../shared/contracts';
declare const __FOLIUNA_ANDROID__: boolean;
export const isAndroid = typeof __FOLIUNA_ANDROID__ !== 'undefined' && __FOLIUNA_ANDROID__;
export const capabilities: PlatformCapabilities = isAndroid ? { name: 'android', chooseLibrary: false, importSidecars: false, exportLibrary: true, floatingViewer: false, flash: false } : WINDOWS_CAPABILITIES;
