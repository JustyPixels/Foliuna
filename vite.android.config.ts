import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/renderer', base: './',
  define: { __FOLIUNA_ANDROID__: 'true' },
  build: { target: 'chrome69', cssTarget: 'chrome69', outDir: '../../work/android-web', emptyOutDir: true, rollupOptions: { input: 'src/renderer/index.html' } },
});
