import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildInstrumentedGame } from './build-instrumented-game.mjs';
import { UPSTREAM_BUNDLE_SHA256, UPSTREAM_COMMIT } from './sync-upstream.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const outputRoot = path.join(projectRoot, 'dist-extension');
const extensionManifest = JSON.parse(await readFile(path.join(projectRoot, 'extension', 'manifest.json'), 'utf8'));
const instrumentedResource = `vendor/webmonkeyball-main.instrumented.v${extensionManifest.version}.js`;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function bundle(entryPoint, outfile) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    minify: false,
    sourcemap: false,
    loader: { '.css': 'text' },
    logLevel: 'info',
  });
}

const resolvedOutput = path.resolve(outputRoot);
if (!resolvedOutput.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
  throw new Error('Refusing to clean an output directory outside the project.');
}
await rm(resolvedOutput, { recursive: true, force: true });
await mkdir(path.join(outputRoot, 'vendor'), { recursive: true });
await mkdir(path.join(outputRoot, 'assets'), { recursive: true });

await Promise.all([
  cp(path.join(projectRoot, 'extension', 'manifest.json'), path.join(outputRoot, 'manifest.json')),
  cp(path.join(projectRoot, 'extension', 'rules.json'), path.join(outputRoot, 'rules.json')),
  cp(path.join(projectRoot, 'assets', 'oxanium-variable.ttf'), path.join(outputRoot, 'assets', 'oxanium-variable.ttf')),
  cp(path.join(projectRoot, 'assets', 'OFL-Oxanium.txt'), path.join(outputRoot, 'assets', 'OFL-Oxanium.txt')),
  bundle(path.join(projectRoot, 'src', 'content', 'bootstrap.ts'), path.join(outputRoot, 'content.js')),
  bundle(path.join(projectRoot, 'src', 'background.ts'), path.join(outputRoot, 'background.js')),
]);

const instrumentedBundle = path.join(outputRoot, ...instrumentedResource.split('/'));
const instrumentedSha256 = await buildInstrumentedGame(instrumentedBundle);
const metadata = {
  extensionVersion: extensionManifest.version,
  instrumentedResource,
  upstreamCommit: UPSTREAM_COMMIT,
  expectedProductionBundleSha256: UPSTREAM_BUNDLE_SHA256,
  instrumentedBundleSha256: instrumentedSha256,
  contentSha256: sha256(await readFile(path.join(outputRoot, 'content.js'))),
};
await writeFile(path.join(outputRoot, 'build-meta.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
console.log(`Built unpacked extension at ${outputRoot}`);
