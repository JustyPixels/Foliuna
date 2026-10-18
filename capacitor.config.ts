import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'io.github.justypixels.foliuna.preview', appName: 'Foliuna Preview', webDir: 'work/android-web',
  loggingBehavior: 'none',
  server: { hostname: 'localhost', androidScheme: 'https' },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false } },
};
export default config;
