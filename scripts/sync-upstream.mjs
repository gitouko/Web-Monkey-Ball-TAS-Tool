import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const UPSTREAM_COMMIT = 'ec5b97599e75d7d10cf5fcb7ac539cba558d6a15';
export const UPSTREAM_BUNDLE_SHA256 = '598c7a561f4c6cf1bce90741f507735b7d5258106cb779e07ddc5d51893abfa6';
export const UPSTREAM_MAP_SHA256 = '6f151f2099c2e36e1a505f865ccad21c95fca8e5af0fca9a0de1b82c27605bf5';
export const UPSTREAM_BUNDLE_URL = 'https://monkeyball-online.pages.dev/dist/main.js';
export const UPSTREAM_MAP_URL = 'https://monkeyball-online.pages.dev/dist/main.js.map';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const upstreamRoot = path.join(projectRoot, 'upstream', `webmonkeyball-${UPSTREAM_COMMIT}`);
const sourceRoot = path.join(upstreamRoot, 'source');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeSourcePath(sourceName) {
  if (!sourceName.startsWith('../src/')) {
    return null;
  }
  const relative = sourceName.slice('../'.length).replaceAll('/', path.sep);
  const resolved = path.resolve(sourceRoot, relative);
  const expectedPrefix = `${path.resolve(sourceRoot)}${path.sep}`;
  if (!resolved.startsWith(expectedPrefix)) {
    throw new Error(`Unsafe source-map path: ${sourceName}`);
  }
  return resolved;
}

export async function syncUpstream() {
  const [mapResponse, bundleResponse] = await Promise.all([
    fetch(UPSTREAM_MAP_URL, { cache: 'no-store' }),
    fetch(`${UPSTREAM_BUNDLE_URL}?wmb_tas_sync=1`, { cache: 'no-store' }),
  ]);
  if (!mapResponse.ok) {
    throw new Error(`Unable to fetch upstream source map: HTTP ${mapResponse.status}`);
  }
  if (!bundleResponse.ok) {
    throw new Error(`Unable to fetch upstream bundle: HTTP ${bundleResponse.status}`);
  }
  const bytes = Buffer.from(await mapResponse.arrayBuffer());
  const bundleBytes = Buffer.from(await bundleResponse.arrayBuffer());
  const actualHash = sha256(bytes);
  if (actualHash !== UPSTREAM_MAP_SHA256) {
    throw new Error(`Unsupported source map. Expected ${UPSTREAM_MAP_SHA256}, received ${actualHash}.`);
  }
  const actualBundleHash = sha256(bundleBytes);
  if (actualBundleHash !== UPSTREAM_BUNDLE_SHA256) {
    throw new Error(`Unsupported production bundle. Expected ${UPSTREAM_BUNDLE_SHA256}, received ${actualBundleHash}.`);
  }

  const map = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)) {
    throw new Error('Upstream source map does not contain embedded sources.');
  }
  if (map.sources.length !== map.sourcesContent.length) {
    throw new Error('Upstream source map source/content counts do not match.');
  }

  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(sourceRoot, { recursive: true });
  let extracted = 0;
  for (let index = 0; index < map.sources.length; index += 1) {
    const destination = safeSourcePath(String(map.sources[index]));
    if (!destination) {
      continue;
    }
    const content = map.sourcesContent[index];
    if (typeof content !== 'string') {
      throw new Error(`Missing embedded source for ${map.sources[index]}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
    extracted += 1;
  }

  const metadata = {
    source: UPSTREAM_MAP_URL,
    commit: UPSTREAM_COMMIT,
    productionBundleSha256: UPSTREAM_BUNDLE_SHA256,
    sourceMapSha256: UPSTREAM_MAP_SHA256,
    extractedSourceFiles: extracted,
  };
  await mkdir(upstreamRoot, { recursive: true });
  await writeFile(path.join(upstreamRoot, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await writeFile(path.join(upstreamRoot, 'main.js'), bundleBytes);
  await writeFile(path.join(upstreamRoot, 'main.js.map'), bytes);
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncUpstream()
    .then((metadata) => {
      console.log(`Extracted ${metadata.extractedSourceFiles} source files for ${metadata.commit}.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
