import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/Oxanium%5Bwght%5D.ttf';
const LICENSE_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/OFL.txt';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const assetRoot = path.join(projectRoot, 'assets');

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const [font, license] = await Promise.all([download(FONT_URL), download(LICENSE_URL)]);
if (font.length < 20_000 || font.subarray(0, 4).toString('hex') !== '00010000') {
  throw new Error('Downloaded Oxanium asset is not a valid TrueType font.');
}
if (!license.toString('utf8').includes('SIL OPEN FONT LICENSE')) {
  throw new Error('Downloaded Oxanium license did not match the expected OFL text.');
}

await mkdir(assetRoot, { recursive: true });
await writeFile(path.join(assetRoot, 'oxanium-variable.ttf'), font);
await writeFile(path.join(assetRoot, 'OFL-Oxanium.txt'), license);
console.log(`Oxanium SHA-256: ${createHash('sha256').update(font).digest('hex')}`);
