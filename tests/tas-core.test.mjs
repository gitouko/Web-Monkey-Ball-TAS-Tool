import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  classifyFixedTickAdvance,
  parseSpeedText,
  ReplayTimeline,
  sameRunIdentity,
  TasStateMachine,
  VirtualTimeDebt,
} from '../src/shared/tas-core.mjs';

test('fixed-tick scheduler treats zero-tick updates as recoverable stalls and rejects multi-ticks', () => {
  assert.equal(classifyFixedTickAdvance(100, 101, false), 'ADVANCED');
  assert.equal(classifyFixedTickAdvance(100, 100, true), 'LIFECYCLE_BOUNDARY');
  assert.equal(classifyFixedTickAdvance(100, 100, false), 'STALLED');
  assert.throws(() => classifyFixedTickAdvance(100, 102, true), /advanced 2 frames/);
});

test('speed parser accepts all finite non-negative decimals and rejects unsafe syntax', () => {
  for (const [text, expected] of [['0', 0], ['.25', 0.25], ['1.', 1], ['37.125', 37.125], [' 2 ', 2]]) {
    assert.deepEqual(parseSpeedText(text), { ok: true, value: expected });
  }
  for (const text of ['', '-1', 'NaN', 'Infinity', '1e3', '0x10', '1,5', '1 2']) {
    assert.equal(parseSpeedText(text).ok, false, text);
  }
});

test('virtual-time debt carries fractional and over-budget ticks without dropping work', () => {
  const debt = new VirtualTimeDebt();
  const step = 1 / 60;
  debt.add(1 / 60, 0.5);
  assert.equal(debt.availableTicks(step), 0);
  debt.add(1 / 60, 0.5);
  assert.equal(debt.availableTicks(step), 1);
  assert.equal(debt.consumeTick(step), true);
  assert.ok(debt.seconds < 1e-12);
  debt.add(0.1, 100);
  assert.equal(debt.availableTicks(step), 600);
  for (let index = 0; index < 240; index += 1) assert.equal(debt.consumeTick(step), true);
  assert.equal(debt.availableTicks(step), 360);
  debt.clear();
  assert.equal(debt.availableTicks(step), 0);
});

test('persistent replay nodes preserve old futures when a rewind creates a branch', () => {
  const root = ReplayTimeline.fromInputs([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  const oldFuture = ReplayTimeline.append(root, { x: 5, y: 6 });
  const newFuture = ReplayTimeline.append(root, { x: -7, y: -8 });
  assert.deepEqual(ReplayTimeline.materialize(oldFuture), [
    { x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 },
  ]);
  assert.deepEqual(ReplayTimeline.materialize(newFuture), [
    { x: 1, y: 2 }, { x: 3, y: 4 }, { x: -7, y: -8 },
  ]);
  assert.notStrictEqual(oldFuture, newFuture);
  assert.strictEqual(oldFuture.parent, newFuture.parent);
});

test('state machine permits restore only from an active run', () => {
  const machine = new TasStateMachine();
  machine.transition('READY_NO_STAGE');
  machine.transition('PLAYING');
  machine.transition('RESTORING');
  machine.transition('PAUSED');
  machine.transition('READY_NO_STAGE');
  assert.throws(() => machine.transition('RESTORING'), /Invalid TAS transition/);
});

test('run identity prevents cross-stage state loads', () => {
  const left = { runGeneration: 3, gameSource: 'smb1', stageId: 1 };
  assert.equal(sameRunIdentity(left, { ...left }), true);
  assert.equal(sameRunIdentity(left, { ...left, runGeneration: 4 }), false);
  assert.equal(sameRunIdentity(left, { ...left, stageId: 2 }), false);
});

test('provided golden replay is exact native v1 schema and payload', async () => {
  const bytes = await readFile(new URL('./fixtures/smb1_beginner_plain_00_01_66_11866.json', import.meta.url));
  const replay = JSON.parse(bytes);
  assert.deepEqual(Object.keys(replay), ['version', 'gameSource', 'stageId', 'ticks', 'inputStartTick', 'inputs']);
  assert.equal(replay.version, 1);
  assert.equal(replay.gameSource, 'smb1');
  assert.equal(replay.stageId, 1);
  assert.equal(replay.ticks, 100);
  assert.equal(replay.inputStartTick, 120);
  assert.equal(replay.inputs.length, 100);
  assert.equal(
    createHash('sha256').update(JSON.stringify(replay)).digest('hex'),
    'ab71643f071920c5f2df1fc65d6cd17600dbeb0352eb10fce409078546be260d',
  );
});
