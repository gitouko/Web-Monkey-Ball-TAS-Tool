export const KEYBIND_SECTIONS = Object.freeze([
  Object.freeze({ id: 'simulation', label: 'Simulation Rate' }),
  Object.freeze({ id: 'transport', label: 'Frame Transport' }),
  Object.freeze({ id: 'states', label: 'Run-Local States' }),
]);

const chord = (code, modifiers = {}) => Object.freeze({
  code,
  ctrl: !!modifiers.ctrl,
  alt: !!modifiers.alt,
  shift: !!modifiers.shift,
  meta: !!modifiers.meta,
});

export const KEYBIND_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'speed-down', section: 'simulation', label: 'Previous rate', defaultChord: chord('BracketLeft'), repeatable: true }),
  Object.freeze({ id: 'speed-up', section: 'simulation', label: 'Next rate', defaultChord: chord('BracketRight'), repeatable: true }),
  Object.freeze({ id: 'speed-025', section: 'simulation', label: 'Set 0.25×', defaultChord: chord('Digit1'), repeatable: false }),
  Object.freeze({ id: 'speed-05', section: 'simulation', label: 'Set 0.5×', defaultChord: chord('Digit2'), repeatable: false }),
  Object.freeze({ id: 'speed-1', section: 'simulation', label: 'Set 1×', defaultChord: chord('Digit3'), repeatable: false }),
  Object.freeze({ id: 'speed-2', section: 'simulation', label: 'Set 2×', defaultChord: chord('Digit4'), repeatable: false }),
  Object.freeze({ id: 'speed-4', section: 'simulation', label: 'Set 4×', defaultChord: chord('Digit5'), repeatable: false }),
  Object.freeze({ id: 'frame-backward', section: 'transport', label: 'Rewind frame', defaultChord: chord('KeyJ'), repeatable: true }),
  Object.freeze({ id: 'toggle-play', section: 'transport', label: 'Play / pause', defaultChord: chord('KeyK'), repeatable: false }),
  Object.freeze({ id: 'frame-forward', section: 'transport', label: 'Advance frame', defaultChord: chord('KeyL'), repeatable: true }),
  Object.freeze({ id: 'save-state', section: 'states', label: 'Capture state', defaultChord: chord('KeyU'), repeatable: false }),
  Object.freeze({ id: 'load-latest-state', section: 'states', label: 'Load newest', defaultChord: chord('KeyI'), repeatable: false }),
  Object.freeze({ id: 'delete-latest-state', section: 'states', label: 'Delete newest', defaultChord: chord('KeyO'), repeatable: false }),
]);

const sectionIds = new Set(KEYBIND_SECTIONS.map((section) => section.id));
const definitionIds = new Set(KEYBIND_DEFINITIONS.map((definition) => definition.id));

export function normalizeChord(value) {
  if (!value || typeof value !== 'object' || typeof value.code !== 'string') return null;
  const code = value.code.trim();
  if (!code || code.length > 64 || !/^[A-Za-z0-9]+$/.test(code)) return null;
  return {
    code,
    ctrl: !!value.ctrl,
    alt: !!value.alt,
    shift: !!value.shift,
    meta: !!value.meta,
  };
}

export function createDefaultKeybindSettings() {
  return {
    version: 1,
    enabled: Object.fromEntries(KEYBIND_SECTIONS.map((section) => [section.id, true])),
    bindings: Object.fromEntries(KEYBIND_DEFINITIONS.map((definition) => [
      definition.id,
      normalizeChord(definition.defaultChord),
    ])),
  };
}

export function normalizeKeybindSettings(value) {
  const settings = createDefaultKeybindSettings();
  if (!value || typeof value !== 'object') return settings;
  if (value.enabled && typeof value.enabled === 'object') {
    for (const [section, enabled] of Object.entries(value.enabled)) {
      if (sectionIds.has(section) && typeof enabled === 'boolean') settings.enabled[section] = enabled;
    }
  }
  if (value.bindings && typeof value.bindings === 'object') {
    for (const definition of KEYBIND_DEFINITIONS) {
      if (!Object.hasOwn(value.bindings, definition.id)) continue;
      settings.bindings[definition.id] = value.bindings[definition.id] === null
        ? null
        : normalizeChord(value.bindings[definition.id]);
    }
  }
  return settings;
}

export function chordFromKeyboardEvent(event) {
  const code = typeof event?.code === 'string' ? event.code : '';
  if (!code) return null;
  return normalizeChord({
    code,
    ctrl: !!event.ctrlKey && !code.startsWith('Control'),
    alt: !!event.altKey && !code.startsWith('Alt'),
    shift: !!event.shiftKey && !code.startsWith('Shift'),
    meta: !!event.metaKey && !code.startsWith('Meta'),
  });
}

export function chordsEqual(left, right) {
  return !!left
    && !!right
    && left.code === right.code
    && left.ctrl === right.ctrl
    && left.alt === right.alt
    && left.shift === right.shift
    && left.meta === right.meta;
}

export function assignKeybind(settingsValue, actionId, chordValue) {
  const settings = normalizeKeybindSettings(settingsValue);
  if (!definitionIds.has(actionId)) return { settings, displacedActionIds: [] };
  const nextChord = chordValue === null ? null : normalizeChord(chordValue);
  const displacedActionIds = [];
  if (nextChord) {
    for (const definition of KEYBIND_DEFINITIONS) {
      if (definition.id !== actionId && chordsEqual(settings.bindings[definition.id], nextChord)) {
        settings.bindings[definition.id] = null;
        displacedActionIds.push(definition.id);
      }
    }
  }
  settings.bindings[actionId] = nextChord;
  return { settings, displacedActionIds };
}

export function resetKeybindSection(settingsValue, sectionId) {
  let settings = normalizeKeybindSettings(settingsValue);
  if (!sectionIds.has(sectionId)) return settings;
  for (const definition of KEYBIND_DEFINITIONS) {
    if (definition.section === sectionId) {
      settings = assignKeybind(settings, definition.id, definition.defaultChord).settings;
    }
  }
  return settings;
}

const codeLabels = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Minus: '−',
  Equal: '=',
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

function labelForCode(code) {
  if (codeLabels[code]) return codeLabels[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  return code
    .replace(/Left$/, ' Left')
    .replace(/Right$/, ' Right')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function formatChord(value) {
  const valueChord = normalizeChord(value);
  if (!valueChord) return 'Unbound';
  const parts = [];
  if (valueChord.ctrl) parts.push('Ctrl');
  if (valueChord.alt) parts.push('Alt');
  if (valueChord.shift) parts.push('Shift');
  if (valueChord.meta) parts.push('Meta');
  parts.push(labelForCode(valueChord.code));
  return parts.join(' + ');
}

export function findKeybindDefinition(settingsValue, event) {
  const settings = normalizeKeybindSettings(settingsValue);
  const eventChord = chordFromKeyboardEvent(event);
  if (!eventChord) return null;
  return KEYBIND_DEFINITIONS.find((definition) => (
    settings.enabled[definition.section]
    && chordsEqual(settings.bindings[definition.id], eventChord)
  )) ?? null;
}
