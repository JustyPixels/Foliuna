import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  define: { __FOLIUNA_ANDROID__: 'false' },
  build: { outDir: '../../dist/renderer', emptyOutDir: true, rollupOptions: { input: {
    app: 'src/renderer/index.html', viewer: 'src/renderer/viewer.html', swf: 'src/renderer/swf.html',
  } } },
});
