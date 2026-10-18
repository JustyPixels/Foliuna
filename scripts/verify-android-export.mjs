import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const output = path.resolve('work/verify-android-export.mjs');
await build({ entryPoints: ['scripts/verify-android-export.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
await import(pathToFileURL(output).href);
