import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(projectRoot, 'dist-extension');
const artifactRoot = path.join(projectRoot, 'artifacts', 'browser-e2e');
const chromePath = process.env.WMB_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targetUrl = 'https://monkeyball-online.pages.dev/';
const buildMetadata = JSON.parse(await readFile(path.join(extensionPath, 'build-meta.json'), 'utf8'));
const instrumentedBundlePath = path.join(extensionPath, ...buildMetadata.instrumentedResource.split('/'));

await Promise.all([stat(chromePath), stat(path.join(extensionPath, 'manifest.json'))]);
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });

function log(message) {
  process.stdout.write(`[browser-e2e] ${message}\n`);
}

async function launchProfile(name, withTasHarness) {
  const userDataDir = path.join(artifactRoot, name);
  const args = ['--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen'];
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1280, height: 820 },
    args,
  });
  if (withTasHarness) {
    await context.addInitScript({ path: path.join(extensionPath, 'content.js') });
    await context.route(/https:\/\/monkeyball-online\.pages\.dev\/dist\/main\.js$/, (route) => route.fulfill({
      path: instrumentedBundlePath,
      contentType: 'text/javascript; charset=utf-8',
    }));
  }
  const page = context.pages()[0] ?? await context.newPage();
  return { context, page };
}

async function waitFor(predicate, message, timeoutMs = 30_000, intervalMs = 25) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${message}; last value: ${JSON.stringify(lastValue)}`);
}

async function tasData(page) {
  return page.locator('#web-monkey-ball-tas-tools').evaluate((element) => ({
    mode: element.dataset.mode ?? '',
    stageActive: element.dataset.stageActive === 'true',
    simTick: Number(element.dataset.simTick ?? -1),
    replayLength: Number(element.dataset.replayLength ?? -1),
    stateHash: Number(element.dataset.stateHash ?? 0),
    branchGeneration: Number(element.dataset.branchGeneration ?? 0),
  }));
}

async function shadowButton(page, id) {
  return page.locator(`#web-monkey-ball-tas-tools #${id}`);
}

async function deliberatePointerClick(page, locator, holdMs = 180) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  assert.ok(box, 'button had no clickable bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

async function setSpeed(page, value) {
  const input = page.locator('#web-monkey-ball-tas-tools #speed');
  await input.fill(String(value));
  await input.press('Enter');
  await waitFor(async () => (await input.inputValue()) === String(value), `speed input did not settle at ${value}`);
}

async function clickAndWaitForTick(page, buttonId, expectedTick) {
  await (await shadowButton(page, buttonId)).click();
  return waitFor(async () => {
    const data = await tasData(page);
    return data.simTick === expectedTick ? data : false;
  }, `${buttonId} did not produce tick ${expectedTick}`, 8_000);
}

async function startBeginnerCourse(page) {
  await page.locator('#open-singleplayer').click();
  await page.locator('#open-course-play').click();
  await page.locator('#course-play-source').waitFor({ state: 'visible' });
  const sourceValues = await page.locator('#course-play-source option').evaluateAll((options) => options.map((option) => ({
    value: option.value,
    text: option.textContent,
  })));
  const smb1 = sourceValues.find((option) => /super monkey ball|smb1/i.test(`${option.text} ${option.value}`));
  if (smb1) await page.locator('#course-play-source').selectOption(smb1.value);
  const difficultyValues = await page.locator('#course-play-difficulty option').evaluateAll((options) => options.map((option) => ({
    value: option.value,
    text: option.textContent,
  })));
  const beginner = difficultyValues.find((option) => /beginner/i.test(`${option.text} ${option.value}`));
  if (beginner) await page.locator('#course-play-difficulty').selectOption(beginner.value);
  await page.locator('#course-play-start').click();
}

async function saveAndExportReplay(page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.keyboard.press('Escape');
  await page.locator('#pause-menu').waitFor({ state: 'visible' });
  await page.locator('#pause-save-replay').click();
  await waitFor(async () => {
    const label = await page.locator('#pause-save-replay').textContent();
    return label ? true : false;
  }, 'native pause replay-save control stopped responding');
  await page.waitForTimeout(300);
  await page.locator('#pause-return-main-menu').click();
  await page.locator('#main-menu').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#open-replay-library').click();
  const row = page.locator('.replay-library-row').first();
  await row.waitFor({ state: 'visible', timeout: 20_000 });
  const downloadPromise = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const replayPath = path.join(artifactRoot, 'committed-branch.replay.json');
  await download.saveAs(replayPath);
  return replayPath;
}

async function verifyVanillaReplay(replayPath) {
  const { context, page } = await launchProfile('vanilla-profile', false);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('#open-replay-library').click();
    await page.locator('#replay-library-file').setInputFiles(replayPath);
    const row = page.locator('.replay-library-row').first();
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    await row.getByRole('button', { name: 'Load' }).click();
    await waitFor(async () => {
      const overlayHidden = await page.locator('#overlay').evaluate((element) => element.classList.contains('hidden'));
      return overlayHidden;
    }, 'vanilla client did not enter replay playback', 60_000, 100);
    await page.waitForTimeout(1_500);
    await page.screenshot({ path: path.join(artifactRoot, 'vanilla-replay.png'), fullPage: true });
    assert.equal(await page.locator('#web-monkey-ball-tas-tools').count(), 0, 'vanilla replay context unexpectedly loaded the extension');
    assert.deepEqual(errors, [], `vanilla replay raised page errors: ${errors.join(' | ')}`);
  } finally {
    await context.close();
  }
}

const { context, page } = await launchProfile('extension-profile', true);
const pageErrors = [];
const consoleErrors = [];
const consoleWarnings = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (entry) => {
  if (entry.type() === 'error') consoleErrors.push(entry.text());
  if (entry.type() === 'warning') consoleWarnings.push(entry.text());
});

let report;
try {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const host = page.locator('#web-monkey-ball-tas-tools');
  await host.waitFor({ state: 'attached', timeout: 20_000 });
  await waitFor(async () => {
    const text = await page.locator('#web-monkey-ball-tas-tools #status-line').textContent();
    return text && !/verifying|waiting/i.test(text) ? text : false;
  }, 'TAS bridge never finished compatibility negotiation', 30_000);
  const initialStatus = await page.locator('#web-monkey-ball-tas-tools #status-line').textContent();
  assert.doesNotMatch(initialStatus ?? '', /disabled|failed|did not start/i);
  log(`bridge ready: ${initialStatus}`);

  await startBeginnerCourse(page);
  await waitFor(async () => (await tasData(page)).stageActive, 'single-player stage never became TAS-active', 90_000, 100);
  assert.equal(
    consoleWarnings.some((warning) => warning.includes('Failed to load goal tape model origin.')),
    false,
    `goal-tape loader still passed the wrong texture collection: ${consoleWarnings.join(' | ')}`,
  );
  await waitFor(async () => (await tasData(page)).simTick >= 390, 'stage did not reach a stable gameplay checkpoint', 30_000, 50);

  await deliberatePointerClick(page, await shadowButton(page, 'play'));
  const paused = await waitFor(async () => {
    const data = await tasData(page);
    return data.mode === 'PAUSED' ? data : false;
  }, 'TAS pause did not engage');
  await page.waitForTimeout(400);
  assert.equal((await tasData(page)).simTick, paused.simTick, 'TAS pause allowed simulation drift');

  const keybindToggles = page.locator('#web-monkey-ball-tas-tools [data-keybind-section]');
  assert.equal(await keybindToggles.count(), 3, 'each TAS section did not expose an independent keybind toggle');
  for (let index = 0; index < 3; index += 1) assert.equal(await keybindToggles.nth(index).isChecked(), true);

  await page.keyboard.press('l');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick + 1, 'default L keybind did not advance one frame');
  await page.keyboard.press('j');
  const keyRewound = await waitFor(async () => {
    const data = await tasData(page);
    return data.simTick === paused.simTick ? data : false;
  }, 'default J keybind did not rewind one frame');
  assert.equal(keyRewound.stateHash, paused.stateHash, 'keybound rewind did not restore the exact hash');

  await page.keyboard.press(']');
  await waitFor(
    async () => (await page.locator('#web-monkey-ball-tas-tools #speed').inputValue()) === '2',
    'simulation-rate keybind did not select the next preset',
  );
  await page.keyboard.press('[');
  await waitFor(
    async () => (await page.locator('#web-monkey-ball-tas-tools #speed').inputValue()) === '1',
    'simulation-rate keybind did not restore the previous preset',
  );

  const transportEditor = page.locator('#web-monkey-ball-tas-tools [data-keybind-editor="transport"]');
  await transportEditor.locator('summary').click();
  const forwardBinding = transportEditor.locator('[data-keybind-action="frame-forward"]');
  await forwardBinding.click();
  await page.keyboard.press('Shift+Q');
  assert.equal(await forwardBinding.textContent(), 'Shift + Q');
  await page.keyboard.press('Shift+Q');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick + 1, 'custom Shift+Q keybind did not advance');
  await page.keyboard.press('j');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick, 'rewind failed after custom key assignment');

  const transportToggle = page.locator('#web-monkey-ball-tas-tools [data-keybind-section="transport"]');
  await transportToggle.uncheck();
  await page.keyboard.press('Shift+Q');
  await page.waitForTimeout(250);
  assert.equal((await tasData(page)).simTick, paused.simTick, 'disabled Frame Transport keybind still fired');
  await transportToggle.check();
  await page.keyboard.press('Shift+Q');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick + 1, 're-enabled Frame Transport keybind did not fire');
  await page.keyboard.press('j');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick, 'custom keybind cleanup rewind failed');
  await transportEditor.locator('[data-keybind-reset="transport"]').click();
  assert.equal(await forwardBinding.textContent(), 'L');

  await page.keyboard.press('u');
  await waitFor(
    async () => (await page.locator('#web-monkey-ball-tas-tools .state').count()) === 1,
    'U keybind did not capture a run-local state',
  );
  await page.keyboard.press('l');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick + 1, 'frame advance before keybound load failed');
  await page.keyboard.press('i');
  await waitFor(async () => (await tasData(page)).simTick === paused.simTick, 'I keybind did not load the newest state');
  await page.keyboard.press('o');
  await waitFor(
    async () => (await page.locator('#web-monkey-ball-tas-tools .state').count()) === 0,
    'O keybind did not delete the newest state',
  );

  const persistedKeybinds = await page.evaluate(() => localStorage.getItem('__wmb_tas_keybinds_v1__'));
  assert.ok(persistedKeybinds, 'custom keybind settings were not persisted');

  const afterForward = await clickAndWaitForTick(page, 'forward', paused.simTick + 1);
  const afterBackward = await clickAndWaitForTick(page, 'backward', paused.simTick);
  assert.equal(afterBackward.stateHash, paused.stateHash, 'one-tick rewind did not restore the prior native hash');

  await (await shadowButton(page, 'save')).click();
  await page.locator('#web-monkey-ball-tas-tools .state').first().waitFor({ state: 'visible' });
  const saved = await tasData(page);

  await page.keyboard.down('ArrowRight');
  let rightBranch;
  for (let index = 1; index <= 4; index += 1) {
    rightBranch = await clickAndWaitForTick(page, 'forward', saved.simTick + index);
  }
  await page.keyboard.up('ArrowRight');

  await deliberatePointerClick(
    page,
    page.locator('#web-monkey-ball-tas-tools .state button[data-action="load"]').first(),
  );
  await waitFor(async () => (await tasData(page)).simTick === saved.simTick, 'manual state did not restore its exact tick');
  await page.keyboard.down('ArrowLeft');
  let leftBranch;
  for (let index = 1; index <= 4; index += 1) {
    leftBranch = await clickAndWaitForTick(page, 'forward', saved.simTick + index);
  }
  await page.keyboard.up('ArrowLeft');
  assert.notEqual(leftBranch.stateHash, rightBranch.stateHash, 'opposite held inputs did not create distinct branches');
  assert.ok(leftBranch.branchGeneration > rightBranch.branchGeneration, 'branch generation did not advance after a loaded-state divergence');

  await page.locator('#web-monkey-ball-tas-tools .state button[data-action="load"]').first().click();
  await waitFor(async () => (await tasData(page)).simTick === saved.simTick, 'manual state did not reload for reproducibility test');
  await page.keyboard.down('ArrowRight');
  let rightReplay;
  for (let index = 1; index <= 4; index += 1) {
    rightReplay = await clickAndWaitForTick(page, 'forward', saved.simTick + index);
  }
  await page.keyboard.up('ArrowRight');
  assert.equal(rightReplay.stateHash, rightBranch.stateHash, 'same state plus same held input did not reproduce the branch hash');
  assert.equal(rightReplay.replayLength, rightBranch.replayLength, 'reproduced branch replay cursor drifted');

  await page.locator('#web-monkey-ball-tas-tools .state button[data-action="load"]').first().click();
  await waitFor(async () => (await tasData(page)).simTick === saved.simTick, 'manual state did not load before speed tests');
  await setSpeed(page, 0.5);
  await (await shadowButton(page, 'play')).click();
  const halfStart = await tasData(page);
  await page.waitForTimeout(1_200);
  await (await shadowButton(page, 'play')).click();
  const halfEnd = await waitFor(async () => {
    const data = await tasData(page);
    return data.mode === 'PAUSED' ? data : false;
  }, '0.5x run did not pause');
  const halfTicks = halfEnd.simTick - halfStart.simTick;
  assert.ok(halfTicks >= 15 && halfTicks <= 55, `0.5x advanced an implausible ${halfTicks} ticks in 1.2s`);

  await setSpeed(page, 2);
  await (await shadowButton(page, 'play')).click();
  const doubleStart = await tasData(page);
  await page.waitForTimeout(1_200);
  await (await shadowButton(page, 'play')).click();
  const doubleEnd = await waitFor(async () => {
    const data = await tasData(page);
    return data.mode === 'PAUSED' ? data : false;
  }, '2x run did not pause');
  const doubleTicks = doubleEnd.simTick - doubleStart.simTick;
  assert.ok(doubleTicks > halfTicks * 2.4, `2x (${doubleTicks}) was not materially faster than 0.5x (${halfTicks})`);

  await page.locator('#web-monkey-ball-tas-tools .state button[data-action="load"]').first().click();
  await waitFor(async () => (await tasData(page)).simTick === saved.simTick, 'manual state did not load before export branch');
  await setSpeed(page, 1);
  await page.keyboard.down('ArrowRight');
  let committed;
  for (let index = 1; index <= 6; index += 1) {
    committed = await clickAndWaitForTick(page, 'forward', saved.simTick + index);
  }
  await page.keyboard.up('ArrowRight');

  for (let index = 0; index < 11; index += 1) {
    await (await shadowButton(page, 'save')).click();
  }
  await waitFor(
    async () => (await page.locator('#web-monkey-ball-tas-tools .state').count()) === 12,
    'each of 11 single-click save actions did not create exactly one state',
  );
  const stateViewport = await page.locator('#web-monkey-ball-tas-tools #state-list').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: style.overflowY,
    };
  });
  assert.equal(stateViewport.overflowY, 'auto');
  assert.ok(
    stateViewport.scrollHeight > stateViewport.clientHeight,
    `state list did not overflow into its own viewport: ${JSON.stringify(stateViewport)}`,
  );
  await page.screenshot({ path: path.join(artifactRoot, 'tas-panel-live.png'), fullPage: true });

  const replayPath = await saveAndExportReplay(page);
  const replayBytes = await readFile(replayPath);
  const replay = JSON.parse(replayBytes);
  assert.deepEqual(Object.keys(replay), ['version', 'gameSource', 'stageId', 'ticks', 'inputStartTick', 'inputs']);
  assert.equal(replay.version, 1);
  assert.equal(replay.inputs.length, committed.replayLength);
  assert.equal(replay.ticks, committed.replayLength);
  assert.equal(replay.gameSource, 'smb1');
  assert.equal(replay.stageId, 1);

  await page.evaluate(() => {
    window.__wmbTasReplaySamples = [];
    let bridgeToken = null;
    window.addEventListener('__WMB_TAS_STATUS_V1__', (event) => {
      bridgeToken = event.detail?.token ?? bridgeToken;
      const status = event.detail?.status;
      if (status) {
        window.__wmbTasReplaySamples.push({
          simTick: status.simTick,
          stateHash: status.diagnostics?.stateHash ?? 0,
          replayPlayback: status.replayPlayback,
        });
      }
    });
    const sampleEveryFrame = () => {
      if (bridgeToken) {
        window.dispatchEvent(new CustomEvent('__WMB_TAS_COMMAND_V1__', {
          detail: { token: bridgeToken, command: { type: 'GET_STATUS' } },
        }));
      }
      requestAnimationFrame(sampleEveryFrame);
    };
    requestAnimationFrame(sampleEveryFrame);
  });
  await page.locator('.replay-library-row').first().getByRole('button', { name: 'Load' }).click();
  const replayEndSample = await waitFor(async () => page.evaluate((targetTick) => {
    const samples = window.__wmbTasReplaySamples ?? [];
    return samples.find((sample) => sample.replayPlayback && sample.simTick === targetTick) ?? false;
  }, committed.simTick), `instrumented native replay did not expose committed tick ${committed.simTick}`, 90_000, 20);
  assert.equal(
    replayEndSample.stateHash,
    committed.stateHash,
    'native replay did not reproduce the committed branch state hash at the exported end tick',
  );
  assert.equal(
    consoleErrors.some((error) => error.includes('[Web-Monkey Ball TAS]')),
    false,
    `TAS controller raised a console error: ${consoleErrors.join(' | ')}`,
  );

  report = {
    chrome: chromePath,
    initialStatus,
    pausedTick: paused.simTick,
    forwardTick: afterForward.simTick,
    restoredHash: afterBackward.stateHash,
    rightBranchHash: rightBranch.stateHash,
    leftBranchHash: leftBranch.stateHash,
    reproducedRightHash: rightReplay.stateHash,
    committedHash: committed.stateHash,
    replayEndHash: replayEndSample.stateHash,
    committedReplayLength: committed.replayLength,
    halfSpeedTicksIn1200ms: halfTicks,
    doubleSpeedTicksIn1200ms: doubleTicks,
    stateScrollViewport: stateViewport,
    exportedReplay: replayPath,
    pageErrors,
    consoleErrors,
    consoleWarnings,
  };
  await writeFile(path.join(artifactRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  log(`extension run passed: ${JSON.stringify(report)}`);
  await context.close();
  await verifyVanillaReplay(replayPath);
  log('clean vanilla replay import/load passed');
} catch (error) {
  await page.screenshot({ path: path.join(artifactRoot, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifactRoot, 'failure.txt'), `${error?.stack ?? error}\n`, 'utf8').catch(() => {});
  throw error;
} finally {
  if (context.browser()?.isConnected()) await context.close();
  await Promise.all([
    rm(path.join(artifactRoot, 'extension-profile'), { recursive: true, force: true }),
    rm(path.join(artifactRoot, 'vanilla-profile'), { recursive: true, force: true }),
  ]);
}
