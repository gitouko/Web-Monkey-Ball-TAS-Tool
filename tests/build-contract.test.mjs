import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root));
const readText = async (relative) => (await read(relative)).toString('utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('manifest is MV3 with only the target origin and one narrow DNR permission', async () => {
  const manifest = JSON.parse(await readText('dist-extension/manifest.json'));
  const metadata = JSON.parse(await readText('dist-extension/build-meta.json'));
  const packageMetadata = JSON.parse(await readText('package.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.2.0');
  assert.equal(metadata.extensionVersion, manifest.version);
  assert.equal(packageMetadata.version, manifest.version);
  assert.equal(manifest.name, 'Web-Monkey Ball ~ TAS Tools');
  assert.deepEqual(manifest.permissions, ['declarativeNetRequestWithHostAccess']);
  assert.deepEqual(manifest.host_permissions, ['https://monkeyball-online.pages.dev/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://monkeyball-online.pages.dev/*']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
});

test('network rule redirects only the exact production module request', async () => {
  const rules = JSON.parse(await readText('dist-extension/rules.json'));
  assert.equal(rules.length, 1);
  assert.equal(rules[0].condition.urlFilter, '||monkeyball-online.pages.dev/dist/main.js|');
  assert.deepEqual(rules[0].condition.resourceTypes, ['script']);
  assert.equal(rules[0].action.redirect.extensionPath, '/vendor/webmonkeyball-main.instrumented.v0.2.0.js');
});

test('pinned upstream artifacts and build metadata agree', async () => {
  const metadata = JSON.parse(await readText('dist-extension/build-meta.json'));
  const upstream = await read(`upstream/webmonkeyball-${metadata.upstreamCommit}/main.js`);
  const instrumented = await read(`dist-extension/${metadata.instrumentedResource}`);
  const content = await read('dist-extension/content.js');
  assert.equal(sha256(upstream), metadata.expectedProductionBundleSha256);
  assert.equal(sha256(instrumented), metadata.instrumentedBundleSha256);
  assert.equal(sha256(content), metadata.contentSha256);
});

test('instrumented bundle contains all audited seams and no stale source-map claim', async () => {
  const metadata = JSON.parse(await readText('dist-extension/build-meta.json'));
  const bundle = await readText(`dist-extension/${metadata.instrumentedResource}`);
  for (const seam of [
    'createTasModHooks()',
    'modRegistry.registerHooks(tasHooks)',
    'tasBridge.tick(dtSeconds)',
    'tasBridge.isSimulationPaused()',
    'tasBridge.getInterpolationAlpha(nativeAlpha)',
    'installTasBridge({',
    'parseObj(nlSlice, tpl.textures)',
  ]) {
    assert.ok(bundle.includes(seam), `missing instrumented seam: ${seam}`);
  }
  assert.equal(bundle.includes('//# sourceMappingURL=main.js.map'), false);
  assert.equal(bundle.includes('parseObj(nlSlice, tpl);'), false);
});

test('extension code does not replace global time or emit legacy replay fields', async () => {
  const sources = `${await readText('src/page/bridge.ts')}\n${await readText('src/content/bootstrap.ts')}`;
  assert.doesNotMatch(sources, /performance\.now\s*=/);
  assert.doesNotMatch(sources, /Date\.now\s*=/);
  assert.doesNotMatch(sources, /setInterval\s*=/);
  assert.doesNotMatch(sources, /legacyReplay|tasMetadata|branchHistory/);
});
