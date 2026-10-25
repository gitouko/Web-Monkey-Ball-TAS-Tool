import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { UPSTREAM_BUNDLE_SHA256, UPSTREAM_COMMIT } from './sync-upstream.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const upstreamRoot = path.join(projectRoot, 'upstream', `webmonkeyball-${UPSTREAM_COMMIT}`);
const upstreamBundle = path.join(upstreamRoot, 'main.js');
const bridgeModule = path.join(projectRoot, 'src', 'page', 'bridge.ts');
const simHashModule = path.join(upstreamRoot, 'source', 'src', 'sim_hash.ts');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Expected exactly one ${label} anchor in the pinned production bundle.`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

async function compileBridge() {
  const result = await build({
    entryPoints: [bridgeModule],
    bundle: true,
    format: 'iife',
    globalName: '__WebMonkeyBallTasBridge',
    target: 'es2022',
    minify: false,
    write: false,
    plugins: [{
      name: 'pinned-sim-hash',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@wmb\/sim-hash$/ }, () => ({ path: simHashModule }));
      },
    }],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

function instrument(source, bridgeCode) {
  let patched = replaceOnce(
    source,
    '// src/main.ts\nvar LEADERBOARDS_MENU_ENABLED',
    `// Web-Monkey Ball TAS bridge (extension-owned, isolated IIFE)\n${bridgeCode}\n// src/main.ts\nvar LEADERBOARDS_MENU_ENABLED`,
    'main module boundary',
  );
  patched = replaceOnce(
    patched,
    `  const tpl = parseAVTpl(tplSlice.arrayBuffer, "common-nl");
  const nlObj = parseObj(nlSlice, tpl);`,
    `  const tpl = parseAVTpl(tplSlice.arrayBuffer, "common-nl");
  const nlObj = parseObj(nlSlice, tpl.textures);`,
    'goal tape Naomi texture map',
  );
  patched = replaceOnce(
    patched,
    '  const modRegistry = createDefaultModRegistry();\n  void modRegistry;',
    '  const modRegistry = createDefaultModRegistry();\n  const tasHooks = __WebMonkeyBallTasBridge.createTasModHooks();\n  modRegistry.registerHooks(tasHooks);',
    'mod registry',
  );
  patched = replaceOnce(
    patched,
    '  startRenderLoop({',
    `  const tasBridge = __WebMonkeyBallTasBridge.installTasBridge({
    game,
    audio,
    hooks: tasHooks,
    buildCommit,
    expectedBundleSha256: '${UPSTREAM_BUNDLE_SHA256}',
    isNetplayEnabled: () => netplayEnabled,
    isRunning: () => running
  });
  startRenderLoop({`,
    'render-loop installation',
  );
  patched = replaceOnce(
    patched,
    '    if (!deps.game.paused && !freezeForTickPre) {',
    '    if (!deps.game.paused && !deps.isTasSimulationPaused() && !freezeForTickPre) {',
    'viewer clock pause',
  );
  patched = replaceOnce(
    patched,
    `      if (deps.isNetplayEnabled()) {
        deps.netplayTick(dtSeconds);
      } else {
        deps.game.update(dtSeconds);
      }`,
    `      if (deps.isNetplayEnabled()) {
        deps.netplayTick(dtSeconds);
      } else {
        deps.tasTick(dtSeconds);
      }`,
    'single-player simulation call',
  );
  patched = replaceOnce(
    patched,
    '    const interpolationAlpha = deps.getInterpolationEnabled() ? deps.game.getInterpolationAlpha() : 1;',
    '    const nativeInterpolationAlpha = deps.getInterpolationEnabled() ? deps.game.getInterpolationAlpha() : 1;\n    const interpolationAlpha = deps.getTasInterpolationAlpha(nativeInterpolationAlpha);',
    'interpolation override',
  );
  patched = replaceOnce(
    patched,
    '      const hudDtFrames = deps.game.paused ? 0 : hudDelta / 1e3 * 60;',
    '      const hudDtFrames = deps.game.paused || deps.isTasSimulationPaused() ? 0 : hudDelta / 1e3 * 60;',
    'HUD pause',
  );
  patched = replaceOnce(
    patched,
    '    netplayTick: (dtSeconds) => {',
    `    tasTick: (dtSeconds) => {
      tasBridge.tick(dtSeconds);
    },
    isTasSimulationPaused: () => tasBridge.isSimulationPaused(),
    getTasInterpolationAlpha: (nativeAlpha) => tasBridge.getInterpolationAlpha(nativeAlpha),
    netplayTick: (dtSeconds) => {`,
    'render-loop TAS dependencies',
  );
  return patched.replace(
    '//# sourceMappingURL=main.js.map',
    `// Instrumented from ${UPSTREAM_COMMIT}; original SHA-256 ${UPSTREAM_BUNDLE_SHA256}`,
  );
}

export async function buildInstrumentedGame(outfile) {
  await Promise.all([stat(upstreamBundle), stat(simHashModule)]).catch(() => {
    throw new Error('Pinned upstream artifacts are missing. Run pnpm sync:upstream first.');
  });
  const originalBytes = await readFile(upstreamBundle);
  const originalHash = sha256(originalBytes);
  if (originalHash !== UPSTREAM_BUNDLE_SHA256) {
    throw new Error(`Pinned bundle hash mismatch: ${originalHash}.`);
  }
  const output = instrument(originalBytes.toString('utf8'), await compileBridge());
  await writeFile(outfile, output, 'utf8');
  return sha256(Buffer.from(output));
}
