import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignKeybind,
  chordFromKeyboardEvent,
  createDefaultKeybindSettings,
  findKeybindDefinition,
  formatChord,
  normalizeKeybindSettings,
  resetKeybindSection,
} from '../src/shared/keybinds.mjs';

test('each TAS section has independent, enabled-by-default keybinds', () => {
  const settings = createDefaultKeybindSettings();
  assert.deepEqual(settings.enabled, { simulation: true, transport: true, states: true });
  assert.equal(findKeybindDefinition(settings, { code: 'KeyL' })?.id, 'frame-forward');
  settings.enabled.transport = false;
  assert.equal(findKeybindDefinition(settings, { code: 'KeyL' }), null);
  assert.equal(findKeybindDefinition(settings, { code: 'KeyU' })?.id, 'save-state');
});

test('custom chords support modifiers and displace conflicts deterministically', () => {
  const initial = createDefaultKeybindSettings();
  const custom = { code: 'KeyQ', ctrl: true, alt: false, shift: true, meta: false };
  let result = assignKeybind(initial, 'frame-forward', custom);
  assert.deepEqual(result.displacedActionIds, []);
  assert.equal(formatChord(result.settings.bindings['frame-forward']), 'Ctrl + Shift + Q');
  result = assignKeybind(result.settings, 'save-state', custom);
  assert.deepEqual(result.displacedActionIds, ['frame-forward']);
  assert.equal(result.settings.bindings['frame-forward'], null);
  assert.equal(findKeybindDefinition(result.settings, {
    code: 'KeyQ', ctrlKey: true, shiftKey: true,
  })?.id, 'save-state');
});

test('keyboard event normalization handles modifier-only keys and malformed storage', () => {
  assert.deepEqual(chordFromKeyboardEvent({ code: 'ControlLeft', ctrlKey: true }), {
    code: 'ControlLeft', ctrl: false, alt: false, shift: false, meta: false,
  });
  const normalized = normalizeKeybindSettings({
    enabled: { simulation: false, invalid: false },
    bindings: { 'speed-up': { code: '<script>' }, 'toggle-play': null },
  });
  assert.equal(normalized.enabled.simulation, false);
  assert.equal(normalized.enabled.transport, true);
  assert.equal(normalized.bindings['speed-up'], null);
  assert.equal(normalized.bindings['toggle-play'], null);
});

test('resetting one section restores its defaults without duplicate assignments', () => {
  let settings = createDefaultKeybindSettings();
  settings = assignKeybind(settings, 'save-state', { code: 'KeyL' }).settings;
  assert.equal(settings.bindings['frame-forward'], null);
  settings = resetKeybindSection(settings, 'transport');
  assert.equal(formatChord(settings.bindings['frame-forward']), 'L');
  assert.equal(settings.bindings['save-state'], null);
});
