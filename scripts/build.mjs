import { build } from 'esbuild';
import { cp, mkdir, readdir } from 'node:fs/promises';

await mkdir('dist/renderer/ruffle', { recursive: true });
for (const file of await readdir('node_modules/@ruffle-rs/ruffle')) {
  if (/\.(js|wasm)$/.test(file) || file.startsWith('LICENSE')) await cp(`node_modules/@ruffle-rs/ruffle/${file}`, `dist/renderer/ruffle/${file}`);
}

await build({
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  outfile: 'dist/main.cjs',
});
await build({
  entryPoints: ['src/preload/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron'],
  outfile: 'dist/preload.cjs',
});
