import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve('work/package');
assert.equal(resolve('.'), resolve(fileURLToPath(new URL('..', import.meta.url))), 'Run from the project root');
assert.ok(root.startsWith(resolve('work') + (process.platform === 'win32' ? '\\' : '/')), 'Package staging must stay in work');
await rm(root, { recursive: true, force: true });
await mkdir(`${root}/licenses`, { recursive: true });
await cp('dist', `${root}/dist`, { recursive: true });
for (const file of ['LICENSE', 'THIRD-PARTY-NOTICES.md']) await cp(file, `${root}/${file}`);
for (const name of ['react', 'react-dom', 'scheduler']) await cp(`node_modules/${name}/LICENSE`, `${root}/licenses/${name}.txt`);
await cp('node_modules/vite/LICENSE.md', `${root}/licenses/vite.txt`);
await cp('build/icon.png', `${root}/icon.png`);
const { name, productName, version, description, main, author, homepage, bugs, license } = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(`${root}/package.json`, JSON.stringify({ name, productName, version, description, main, author, homepage, bugs, license }, null, 2) + '\n');
console.log(`Prepared ${productName} ${version}: compiled application and licenses only.`);
