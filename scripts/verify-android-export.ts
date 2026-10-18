import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import extractZip from '@electron-internal/extract-zip';
import { ArchiveLibrary } from '../src/main/archive/library';
import { Gallery } from '../src/main/archive/gallery';
import { Collections } from '../src/main/archive/collections';
import { parseSidecar } from '../src/main/archive/import';
import { compatibility } from '../tests/fixtures/compatibility';

const artifactRoot = 'android/app/build/outputs/connected_android_test_additional_output';
const artifact = process.argv[2] ?? join(artifactRoot, (await readdir(artifactRoot, { recursive: true })).find((file) => file.endsWith('android-export.zip')) ?? 'MISSING');
const source = resolve(artifact);
const temp = await mkdtemp(resolve('work/export-check-'));
try {
  const root = join(temp, 'library');
  if (source.endsWith('.zip')) await extractZip(source, { dir: root }); else await cp(source, root, { recursive: true });
  const files = await readdir(join(root, 'media'));
  const sidecars = files.filter((name) => name.endsWith('.foliuna.json'));
  assert.equal(sidecars.length, 1);
  const portable = parseSidecar(JSON.parse(await readFile(join(root, 'media', sidecars[0]), 'utf8')));
  assert.equal(portable.sources.length, 3);
  assert.equal(portable.sources.find((source) => source.provider === 'e621')!.snapshots.length, 2);
  const library = new ArchiveLibrary(temp, {}, false, async () => { throw Error('Export import attempted network access'); });
  try {
    await library.select(root);
    const gallery = new Gallery(library); const collections = new Collections(library);
    const imported = await gallery.importSidecars();
    assert.equal(imported.invalid, 0); assert.equal(imported.conflicts, 0); assert.equal(imported.imported, 1);
    assert.equal(library.status().assets, 1);
    const all = await gallery.search({ tags: '', page: 1 });
    assert.equal(all.posts.length, 1); assert.equal(all.posts[0].archive!.sourceCount, 3);
    assert.equal((await gallery.search({ tags: 'species:deer provider:e621', page: 1 })).posts.length, 1);
    const artist = await gallery.search({ tags: 'artist:artist_one provider:danbooru', page: 1 });
    assert.equal(artist.posts.length, 1);
    const custom = compatibility.at(-1)!.source;
    assert.equal((await gallery.search({ tags: 'provider:' + custom.id, page: 1 })).posts[0].source?.baseUrl, custom.baseUrl);
    const list = await collections.list();
    assert.equal(list.length, 1); assert.equal(list[0].name, 'Forest'); assert.equal(list[0].assets, 1); assert.equal(list[0].pending, 0);
    assert.equal((await gallery.search({ tags: '', page: 1, collectionId: list[0].id })).posts.length, 1);
    await gallery.importSidecars();
    assert.equal(library.status().assets, 1);
    const report = { passed: true, assets: 1, sources: 3, captures: 4, categorizedTags: true, customProvenance: true, deduplication: true, collections: true, repeatedImport: true, networkRequests: 0 };
    await writeFile('work/android-export-verification.json', JSON.stringify(report, null, 2) + '\n');
    console.log('Android export reconstructed Gallery, source history, categorized tags and Collections using the Windows importer.');
  } finally { await library.close(); }
} finally { await rm(temp, { recursive: true, force: true }); }
