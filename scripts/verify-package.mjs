import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { sep } from 'node:path';
import { listPackage, extractFile, getRawHeader } from '@electron/asar';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';
import { NtExecutable, NtExecutableResource } from 'resedit';

const directory = 'release/win-unpacked';
const archive = `${directory}/resources/app.asar`;
const executable = `${directory}/Foliuna.exe`;
const wire = await getCurrentFuseWire(executable);
const expected = { RunAsNode: false, EnableCookieEncryption: true, EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false, EnableEmbeddedAsarIntegrityValidation: true, OnlyLoadAppFromAsar: true, GrantFileProtocolExtraPrivileges: false };
for (const [name, enabled] of Object.entries(expected)) assert.equal(wire[FuseV1Options[name]], enabled ? FuseState.ENABLE : FuseState.DISABLE, `Fuse ${name}`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const header = getRawHeader(archive);
const headerHash = sha256(header.headerString);
const exe = NtExecutable.from(await readFile(executable));
const integrity = NtExecutableResource.from(exe).entries.find((entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR');
assert.ok(integrity, 'Executable must contain ASAR integrity metadata');
assert.deepEqual(JSON.parse(Buffer.from(integrity.bin).toString()), [{ file: 'resources\\app.asar', alg: 'SHA256', value: headerHash }]);
const entries = listPackage(archive).map((file) => file.replaceAll('\\', '/').replace(/^\//, ''));
const hashes = {};
function check(files, prefix = '') {
  for (const [name, info] of Object.entries(files)) {
    const path = prefix + name;
    assert.ok(!info.link && !info.unpacked, `Unexpected link/unpacked file: ${path}`);
    if (info.files) { check(info.files, `${path}/`); continue; }
    assert.match(path, /^(?:package\.json|LICENSE|THIRD-PARTY-NOTICES\.md|icon\.png|licenses\/(?:react|react-dom|scheduler|vite)\.txt|dist\/(?:main|preload)\.cjs|dist\/renderer\/.+\.(?:html|js|css|svg|wasm)|dist\/renderer\/ruffle\/LICENSE[^/]*)$/, `Unexpected packaged file: ${path}`);
    const bytes = extractFile(archive, path.split('/').join(sep));
    const hash = sha256(bytes); assert.equal(info.integrity?.algorithm, 'SHA256'); assert.equal(info.integrity.hash, hash, path);
    for (let index = 0; index < info.integrity.blocks.length; index++) assert.equal(sha256(bytes.subarray(index * info.integrity.blockSize, (index + 1) * info.integrity.blockSize)), info.integrity.blocks[index], `${path} block ${index}`);
    hashes[path] = hash;
  }
}
check(header.header.files);
assert.ok(entries.includes('dist/main.cjs') && entries.includes('dist/preload.cjs') && entries.includes('dist/renderer/index.html'));
const pkg = JSON.parse(extractFile(archive, 'package.json'));
assert.equal(pkg.author.name, 'JustyPixels'); assert.equal(pkg.bugs.url, 'https://github.com/JustyPixels/Foliuna/issues');
assert.ok(!pkg.dependencies && !pkg.devDependencies && !pkg.scripts);
const assets = (await readdir('release')).filter((name) => /^Foliuna-.+\.(?:exe|zip)$/.test(name)).sort();
assert.equal(assets.length, 2, 'Expected exactly an installer and ZIP; move older release files out first');
const checksums = [];
for (const name of assets) checksums.push(`${sha256(await readFile(`release/${name}`))}  ${name}`);
await writeFile('release/SHA256SUMS.txt', checksums.join('\n') + '\n');
await writeFile('release/package-verification.json', JSON.stringify({ version: pkg.version, platform: 'win32-x64', fuses: expected, asarHeaderSHA256: headerHash, files: hashes }, null, 2) + '\n');
console.log(`Verified ${Object.keys(hashes).length} packaged files, ${Object.keys(expected).length} fuses, embedded ASAR integrity and ${assets.length} release checksums.`);
