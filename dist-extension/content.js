(() => {
  // src/shared/protocol.ts
  var PROTOCOL_VERSION = 1;
  var EXPECTED_BUNDLE_SHA256 = "598c7a561f4c6cf1bce90741f507735b7d5258106cb779e07ddc5d51893abfa6";
  var READY_EVENT = "__WMB_TAS_READY_V1__";
  var CONNECT_EVENT = "__WMB_TAS_CONNECT_V1__";
  var COMMAND_EVENT = "__WMB_TAS_COMMAND_V1__";
  var STATUS_EVENT = "__WMB_TAS_STATUS_V1__";

  // src/shared/keybinds.mjs
  var KEYBIND_SECTIONS = Object.freeze([
    Object.freeze({ id: "simulation", label: "Simulation Rate" }),
    Object.freeze({ id: "transport", label: "Frame Transport" }),
    Object.freeze({ id: "states", label: "Run-Local States" })
  ]);
  var chord = (code, modifiers = {}) => Object.freeze({
    code,
    ctrl: !!modifiers.ctrl,
    alt: !!modifiers.alt,
    shift: !!modifiers.shift,
    meta: !!modifiers.meta
  });
  var KEYBIND_DEFINITIONS = Object.freeze([
    Object.freeze({ id: "speed-down", section: "simulation", label: "Previous rate", defaultChord: chord("BracketLeft"), repeatable: true }),
    Object.freeze({ id: "speed-up", section: "simulation", label: "Next rate", defaultChord: chord("BracketRight"), repeatable: true }),
    Object.freeze({ id: "speed-025", section: "simulation", label: "Set 0.25\xD7", defaultChord: chord("Digit1"), repeatable: false }),
    Object.freeze({ id: "speed-05", section: "simulation", label: "Set 0.5\xD7", defaultChord: chord("Digit2"), repeatable: false }),
    Object.freeze({ id: "speed-1", section: "simulation", label: "Set 1\xD7", defaultChord: chord("Digit3"), repeatable: false }),
    Object.freeze({ id: "speed-2", section: "simulation", label: "Set 2\xD7", defaultChord: chord("Digit4"), repeatable: false }),
    Object.freeze({ id: "speed-4", section: "simulation", label: "Set 4\xD7", defaultChord: chord("Digit5"), repeatable: false }),
    Object.freeze({ id: "frame-backward", section: "transport", label: "Rewind frame", defaultChord: chord("KeyJ"), repeatable: true }),
    Object.freeze({ id: "toggle-play", section: "transport", label: "Play / pause", defaultChord: chord("KeyK"), repeatable: false }),
    Object.freeze({ id: "frame-forward", section: "transport", label: "Advance frame", defaultChord: chord("KeyL"), repeatable: true }),
    Object.freeze({ id: "save-state", section: "states", label: "Capture state", defaultChord: chord("KeyU"), repeatable: false }),
    Object.freeze({ id: "load-latest-state", section: "states", label: "Load newest", defaultChord: chord("KeyI"), repeatable: false }),
    Object.freeze({ id: "delete-latest-state", section: "states", label: "Delete newest", defaultChord: chord("KeyO"), repeatable: false })
  ]);
  var sectionIds = new Set(KEYBIND_SECTIONS.map((section) => section.id));
  var definitionIds = new Set(KEYBIND_DEFINITIONS.map((definition) => definition.id));
  function normalizeChord(value) {
    if (!value || typeof value !== "object" || typeof value.code !== "string") return null;
    const code = value.code.trim();
    if (!code || code.length > 64 || !/^[A-Za-z0-9]+$/.test(code)) return null;
    return {
      code,
      ctrl: !!value.ctrl,
      alt: !!value.alt,
      shift: !!value.shift,
      meta: !!value.meta
    };
  }
  function createDefaultKeybindSettings() {
    return {
      version: 1,
      enabled: Object.fromEntries(KEYBIND_SECTIONS.map((section) => [section.id, true])),
      bindings: Object.fromEntries(KEYBIND_DEFINITIONS.map((definition) => [
        definition.id,
        normalizeChord(definition.defaultChord)
      ]))
    };
  }
  function normalizeKeybindSettings(value) {
    const settings = createDefaultKeybindSettings();
    if (!value || typeof value !== "object") return settings;
    if (value.enabled && typeof value.enabled === "object") {
      for (const [section, enabled] of Object.entries(value.enabled)) {
        if (sectionIds.has(section) && typeof enabled === "boolean") settings.enabled[section] = enabled;
      }
    }
    if (value.bindings && typeof value.bindings === "object") {
      for (const definition of KEYBIND_DEFINITIONS) {
        if (!Object.hasOwn(value.bindings, definition.id)) continue;
        settings.bindings[definition.id] = value.bindings[definition.id] === null ? null : normalizeChord(value.bindings[definition.id]);
      }
    }
    return settings;
  }
  function chordFromKeyboardEvent(event) {
    const code = typeof event?.code === "string" ? event.code : "";
    if (!code) return null;
    return normalizeChord({
      code,
      ctrl: !!event.ctrlKey && !code.startsWith("Control"),
      alt: !!event.altKey && !code.startsWith("Alt"),
      shift: !!event.shiftKey && !code.startsWith("Shift"),
      meta: !!event.metaKey && !code.startsWith("Meta")
    });
  }
  function chordsEqual(left, right) {
    return !!left && !!right && left.code === right.code && left.ctrl === right.ctrl && left.alt === right.alt && left.shift === right.shift && left.meta === right.meta;
  }
  function assignKeybind(settingsValue, actionId, chordValue) {
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
  function resetKeybindSection(settingsValue, sectionId) {
    let settings = normalizeKeybindSettings(settingsValue);
    if (!sectionIds.has(sectionId)) return settings;
    for (const definition of KEYBIND_DEFINITIONS) {
      if (definition.section === sectionId) {
        settings = assignKeybind(settings, definition.id, definition.defaultChord).settings;
      }
    }
    return settings;
  }
  var codeLabels = {
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
    Minus: "\u2212",
    Equal: "=",
    Space: "Space",
    Escape: "Esc",
    Enter: "Enter",
    Tab: "Tab",
    ArrowUp: "\u2191",
    ArrowDown: "\u2193",
    ArrowLeft: "\u2190",
    ArrowRight: "\u2192"
  };
  function labelForCode(code) {
    if (codeLabels[code]) return codeLabels[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
    return code.replace(/Left$/, " Left").replace(/Right$/, " Right").replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  function formatChord(value) {
    const valueChord = normalizeChord(value);
    if (!valueChord) return "Unbound";
    const parts = [];
    if (valueChord.ctrl) parts.push("Ctrl");
    if (valueChord.alt) parts.push("Alt");
    if (valueChord.shift) parts.push("Shift");
    if (valueChord.meta) parts.push("Meta");
    parts.push(labelForCode(valueChord.code));
    return parts.join(" + ");
  }
  function findKeybindDefinition(settingsValue, event) {
    const settings = normalizeKeybindSettings(settingsValue);
    const eventChord = chordFromKeyboardEvent(event);
    if (!eventChord) return null;
    return KEYBIND_DEFINITIONS.find((definition) => settings.enabled[definition.section] && chordsEqual(settings.bindings[definition.id], eventChord)) ?? null;
  }

  // src/content/bootstrap.ts
  var HOST_ID = "web-monkey-ball-tas-tools";
  var FALLBACK_KEY = "__wmb_tas_original_fallback_v1__";
  var RELOAD_GUARD_KEY = "__wmb_tas_reload_guard_v1__";
  var KEYBIND_STORAGE_KEY = "__wmb_tas_keybinds_v1__";
  var SPEED_PRESETS = [0.25, 0.5, 1, 2, 4];
  var hasExtensionRuntime = typeof chrome !== "undefined" && !!chrome.runtime?.id;
  var extensionVersion = hasExtensionRuntime ? chrome.runtime.getManifest().version : "test-harness";
  var assetUrl = (path) => hasExtensionRuntime ? chrome.runtime.getURL(path) : "";
  function loadKeybindSettings() {
    try {
      return normalizeKeybindSettings(JSON.parse(localStorage.getItem(KEYBIND_STORAGE_KEY) ?? "null"));
    } catch {
      return createDefaultKeybindSettings();
    }
  }
  var tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  var token = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  var liveBundleSha256 = "";
  var bridgeReady = false;
  var latestStatus = null;
  var host;
  var shadow;
  var speedInput;
  var playButton;
  var statusLine;
  var stateList;
  var diagnostics;
  var connectionDot;
  var compactReadout;
  var renderedPlayState = "";
  var renderedStateSignature = "";
  var keybindSettings = loadKeybindSettings();
  var capturingKeybindAction = null;
  var pendingModifierCapture = null;
  var keybindFeedback = "Click a shortcut, then press any page-received key.";
  var suppressedKeyReleases = /* @__PURE__ */ new Set();
  var icon = (body) => `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    ${body}
  </svg>`;
  var ICONS = {
    collapse: icon('<path d="M6 10h12v4H6z"/>'),
    expand: icon('<path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z"/>'),
    pause: icon('<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>'),
    play: icon('<path d="M7 4.8v14.4L19 12z"/>'),
    backward: icon('<path d="M5 5h3v14H5zM19 5.2v13.6L8.5 12z"/>'),
    forward: icon('<path d="M16 5h3v14h-3zM5 5.2v13.6L15.5 12z"/>'),
    save: icon('<path d="M5 3h11l3 3v15H5zm3 2v5h8V6.5L14.5 5zm0 9v5h8v-5z"/>'),
    load: icon('<path d="M4 4h7v3H7v10h10v-4h3v7H4zm10 1 6 6-6 6v-4H9v-4h5z"/>'),
    delete: icon('<path d="M8 3h8l1 2h4v3H3V5h4zm-3 7h14l-1 11H6zm4 2v6h2v-6zm4 0v6h2v-6z"/>')
  };
  var css = String.raw`
  @font-face {
    font-family: 'Oxanium TAS';
    src: url('${assetUrl("assets/oxanium-variable.ttf")}') format('truetype');
    font-weight: 300 800;
    font-style: normal;
    font-display: swap;
  }
  :host {
    --ink: #eafff8;
    --muted: #88aea2;
    --glass: rgba(7, 22, 20, .93);
    --line: rgba(129, 255, 207, .22);
    --mint: #6fffc5;
    --lime: #d5ff5f;
    --amber: #ffc45b;
    --danger: #ff7185;
    all: initial;
    position: fixed;
    inset: 88px auto auto 18px;
    z-index: 2147483647;
    width: min(300px, calc(100vw - 24px));
    color: var(--ink);
    font: 500 12px/1.3 'Oxanium TAS', system-ui, sans-serif;
    letter-spacing: .015em;
  }
  * { box-sizing: border-box; }
  button, input { font: inherit; }
  button { color: inherit; }
  .panel {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 14px;
    background:
      linear-gradient(135deg, rgba(111,255,197,.09), transparent 34%),
      var(--glass);
    box-shadow: 0 16px 48px rgba(0,0,0,.43), inset 0 1px rgba(255,255,255,.05);
    backdrop-filter: blur(12px) saturate(1.2);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 40px;
    padding: 7px 8px 7px 11px;
    cursor: grab;
    user-select: none;
    border-bottom: 1px solid var(--line);
    background: rgba(8,34,29,.7);
    touch-action: none;
  }
  .topbar:active { cursor: grabbing; }
  .mark {
    position: relative;
    width: 19px;
    height: 19px;
    flex: none;
    border: 2px solid var(--mint);
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(111,255,197,.3);
  }
  .mark::before, .mark::after {
    content: '';
    position: absolute;
    background: var(--lime);
  }
  .mark::before { width: 9px; height: 2px; left: 3px; top: 7px; }
  .mark::after { width: 2px; height: 9px; left: 7px; top: 3px; }
  .title { min-width: 0; flex: 1; }
  .title strong { display: block; font-weight: 750; font-size: 12px; letter-spacing: .065em; }
  .title span { display: block; color: var(--muted); font-size: 9px; letter-spacing: .11em; text-transform: uppercase; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 9px currentColor; color: var(--amber); }
  .dot.good { color: var(--mint); background: var(--mint); }
  .dot.bad { color: var(--danger); background: var(--danger); }
  .icon-button, .transport, .mini, .preset, .save-button, .state button {
    border: 1px solid var(--line);
    background: rgba(20,53,46,.76);
    cursor: pointer;
    touch-action: manipulation;
    transition: border-color .12s, background .12s, transform .12s;
  }
  button:hover:not(:disabled) { border-color: var(--mint); background: rgba(29,75,62,.92); }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--lime); outline-offset: 2px; }
  button:disabled { opacity: .34; cursor: not-allowed; }
  svg { display: block; width: 16px; height: 16px; fill: currentColor; }
  .icon-button { display:grid; place-items:center; width: 27px; height: 27px; padding:0; border-radius: 8px; }
  .body { max-height: min(570px, calc(100vh - 150px)); overflow: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  .panel.collapsed .body { display: none; }
  .panel.collapsed .topbar { border-bottom: 0; }
  .section { padding: 10px 11px; border-bottom: 1px solid var(--line); }
  .section:last-child { border-bottom: 0; }
  .eyebrow { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; color:var(--muted); font-size:9px; text-transform:uppercase; letter-spacing:.14em; }
  .eyebrow-tools { display:flex; align-items:center; gap:7px; }
  .keybind-toggle { display:inline-flex; align-items:center; gap:3px; cursor:pointer; color:var(--muted); letter-spacing:.06em; }
  .keybind-toggle input { width:12px; height:12px; margin:0; accent-color:var(--mint); }
  .keybind-toggle:has(input:checked) { color:var(--mint); }
  .readout { color: var(--lime); font-variant-numeric: tabular-nums; letter-spacing:.04em; }
  .speed-row { display:grid; grid-template-columns:29px 1fr 29px; gap:6px; }
  .speed-row input {
    width: 100%; height: 31px; border:1px solid var(--line); border-radius:8px;
    color:var(--ink); background:rgba(0,0,0,.25); text-align:center; font-weight:700;
  }
  .mini { display:grid; place-items:center; padding:0; border-radius:8px; font-weight:750; }
  .presets { display:grid; grid-template-columns:repeat(5,1fr); gap:4px; margin-top:6px; }
  .preset { padding:4px 2px; border-radius:6px; color:var(--muted); font-size:10px; }
  .preset.active { border-color:var(--mint); color:var(--mint); background:rgba(111,255,197,.11); }
  .transport-row { display:grid; grid-template-columns:1fr 1.2fr 1fr; gap:7px; }
  .transport { display:flex; align-items:center; justify-content:center; gap:6px; height:35px; border-radius:9px; }
  .transport.primary { color:#071612; background:linear-gradient(135deg,var(--mint),var(--lime)); border-color:transparent; }
  .transport.primary:hover:not(:disabled) { color:#071612; background:linear-gradient(135deg,#9affd8,#e5ff8d); }
  .save-button { width:100%; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; gap:7px; }
  .states {
    display:grid;
    gap:4px;
    margin-top:7px;
    overscroll-behavior:contain;
    scrollbar-width:thin;
    scrollbar-color:var(--line) transparent;
  }
  .states.has-items {
    max-height:min(210px, 30vh);
    overflow-y:auto;
    padding-right:3px;
  }
  .empty { padding:9px; border:1px dashed var(--line); border-radius:8px; color:var(--muted); text-align:center; }
  .state {
    display:grid; grid-template-columns:1fr auto auto; align-items:center; gap:5px;
    min-height:35px; padding:3px 4px 3px 7px; border:1px solid rgba(129,255,207,.13); border-radius:7px; background:rgba(0,0,0,.15);
  }
  .state strong { display:block; font-size:11px; }
  .state span { color:var(--muted); font-size:9px; font-variant-numeric:tabular-nums; }
  .state button { display:grid; place-items:center; width:25px; height:25px; padding:0; border-radius:6px; }
  .state .remove { color:var(--danger); }
  .status {
    min-height:31px; padding:8px 11px; color:var(--muted); font-size:10px;
    background:rgba(0,0,0,.18); border-bottom:1px solid var(--line);
  }
  .status.error { color:var(--danger); }
  details summary { cursor:pointer; color:var(--muted); user-select:none; }
  .diag { display:grid; grid-template-columns:1fr auto; gap:3px 8px; margin-top:7px; color:var(--muted); font-size:9px; }
  .diag output { color:var(--ink); text-align:right; font-variant-numeric:tabular-nums; }
  .native-warning { display:none; margin-top:7px; padding:6px 8px; border:1px solid rgba(255,196,91,.35); border-radius:7px; color:var(--amber); }
  .native-warning.visible { display:block; }
  .keybind-editor { margin-top:7px; padding-top:1px; }
  .keybind-editor summary { font-size:9px; }
  .binding-list { display:grid; gap:4px; margin-top:7px; }
  .binding-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(74px,auto) 24px; align-items:center; gap:4px; }
  .binding-row > span { min-width:0; color:var(--muted); font-size:9px; }
  .binding-key, .binding-clear, .binding-reset {
    border:1px solid var(--line); border-radius:6px; color:var(--ink); background:rgba(0,0,0,.2); cursor:pointer;
  }
  .binding-key { min-height:25px; padding:3px 6px; color:var(--lime); font-size:9px; white-space:nowrap; }
  .binding-key.listening { border-color:var(--amber); color:var(--amber); }
  .binding-clear { width:24px; height:24px; padding:0; color:var(--danger); }
  .binding-footer { display:flex; align-items:center; justify-content:space-between; gap:7px; margin-top:7px; }
  .binding-feedback { flex:1; margin:0; color:var(--muted); font-size:8px; line-height:1.35; }
  .binding-reset { flex:none; padding:4px 6px; color:var(--muted); font-size:8px; }
`;
  function keybindEditorMarkup(section) {
    const rows = KEYBIND_DEFINITIONS.filter((definition) => definition.section === section).map((definition) => `
      <div class="binding-row">
        <span>${definition.label}</span>
        <button class="binding-key" type="button" data-keybind-action="${definition.id}" aria-label="Change ${definition.label} shortcut">${formatChord(keybindSettings.bindings[definition.id])}</button>
        <button class="binding-clear" type="button" data-keybind-clear="${definition.id}" aria-label="Clear ${definition.label} shortcut" title="Clear">\xD7</button>
      </div>`).join("");
    return `
    <details class="keybind-editor" data-keybind-editor="${section}">
      <summary>Keybinds</summary>
      <div class="binding-list">${rows}</div>
      <div class="binding-footer">
        <p class="binding-feedback" data-keybind-feedback="${section}">${keybindFeedback}</p>
        <button class="binding-reset" type="button" data-keybind-reset="${section}">Reset keys</button>
      </div>
    </details>`;
  }
  function keybindToggleMarkup(section) {
    return `<label class="keybind-toggle" title="Enable ${section} keybinds">
    <input type="checkbox" data-keybind-section="${section}"${keybindSettings.enabled[section] ? " checked" : ""}>
    <span>Keys</span>
  </label>`;
  }
  function panelMarkup() {
    return `
    <section class="panel" aria-label="Web-Monkey Ball TAS Tools">
      <header class="topbar">
        <i class="mark" aria-hidden="true"></i>
        <div class="title"><strong>WMB // TAS</strong><span>deterministic control</span></div>
        <i class="dot" id="connection-dot" title="Checking compatibility"></i>
        <button class="icon-button" id="collapse" type="button" aria-label="Collapse TAS panel" title="Collapse">${ICONS.collapse}</button>
      </header>
      <div class="body">
        <div class="status" id="status-line" role="status">Verifying the live game build\u2026</div>
        <section class="section">
          <div class="eyebrow"><span>Simulation rate</span><span class="eyebrow-tools"><output class="readout" id="compact-readout">\u2014</output>${keybindToggleMarkup("simulation")}</span></div>
          <div class="speed-row">
            <button class="mini" id="speed-down" type="button" aria-label="Decrease speed">\u2212</button>
            <input id="speed" inputmode="decimal" value="1" aria-label="Simulation speed multiplier" spellcheck="false">
            <button class="mini" id="speed-up" type="button" aria-label="Increase speed">+</button>
          </div>
          <div class="presets" id="presets">
            ${SPEED_PRESETS.map((value) => `<button class="preset${value === 1 ? " active" : ""}" type="button" data-speed="${value}">${value}\xD7</button>`).join("")}
          </div>
          ${keybindEditorMarkup("simulation")}
        </section>
        <section class="section">
          <div class="eyebrow"><span>Frame transport</span><span class="eyebrow-tools"><span>fixed 1/60</span>${keybindToggleMarkup("transport")}</span></div>
          <div class="transport-row">
            <button class="transport" id="backward" type="button" title="Rewind one authoritative tick" aria-label="Rewind one tick">${ICONS.backward}</button>
            <button class="transport primary" id="play" type="button" title="Pause TAS simulation" aria-label="Pause TAS simulation">${ICONS.pause}<span>Pause</span></button>
            <button class="transport" id="forward" type="button" title="Advance one authoritative tick" aria-label="Advance one tick">${ICONS.forward}</button>
          </div>
          <div class="native-warning" id="native-warning">Native pause menu is open. Frame advance stays locked.</div>
          ${keybindEditorMarkup("transport")}
        </section>
        <section class="section">
          <div class="eyebrow"><span>Run-local states</span><span class="eyebrow-tools"><span id="state-count">0 saved</span>${keybindToggleMarkup("states")}</span></div>
          <button class="save-button" id="save" type="button">${ICONS.save}<span>Capture current tick</span></button>
          <div class="states" id="state-list"><div class="empty">No manual states in this run.</div></div>
          ${keybindEditorMarkup("states")}
        </section>
        <section class="section">
          <details>
            <summary>Diagnostics</summary>
            <div class="diag" id="diagnostics"><span>Waiting for bridge</span><output>\u2014</output></div>
          </details>
        </section>
      </div>
    </section>`;
  }
  function mount() {
    if (document.getElementById(HOST_ID)) return;
    host = document.createElement("div");
    host.id = HOST_ID;
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    shadow.append(style);
    const root = document.createElement("div");
    root.innerHTML = panelMarkup();
    shadow.append(...Array.from(root.childNodes));
    (document.documentElement || document).appendChild(host);
    speedInput = shadow.querySelector("#speed");
    playButton = shadow.querySelector("#play");
    statusLine = shadow.querySelector("#status-line");
    stateList = shadow.querySelector("#state-list");
    diagnostics = shadow.querySelector("#diagnostics");
    connectionDot = shadow.querySelector("#connection-dot");
    compactReadout = shadow.querySelector("#compact-readout");
    bindControls();
    bindDrag();
    isolatePanelEvents();
    render();
  }
  function isolatePanelEvents() {
    for (const eventName of ["pointerdown", "pointerup", "click"]) {
      shadow.addEventListener(eventName, (event) => event.stopPropagation());
    }
  }
  function dispatch(command) {
    if (!bridgeReady || !liveBundleSha256) return;
    window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: { token, command } }));
  }
  function commitSpeed() {
    dispatch({ type: "SET_SPEED", value: speedInput.value });
  }
  function nudgeSpeed(direction) {
    const current = Number(speedInput.value);
    const normalized = Number.isFinite(current) && current >= 0 ? current : 1;
    const foundIndex = direction > 0 ? SPEED_PRESETS.findIndex((value) => value > normalized) : SPEED_PRESETS.findLastIndex((value) => value < normalized);
    const nextIndex = foundIndex < 0 ? direction > 0 ? SPEED_PRESETS.length - 1 : 0 : foundIndex;
    speedInput.value = String(SPEED_PRESETS[nextIndex]);
    commitSpeed();
  }
  function persistKeybindSettings() {
    try {
      localStorage.setItem(KEYBIND_STORAGE_KEY, JSON.stringify(keybindSettings));
      return true;
    } catch {
      keybindFeedback = "Shortcuts work for this tab, but browser storage is unavailable.";
      return false;
    }
  }
  function keybindDefinition(actionId) {
    return KEYBIND_DEFINITIONS.find((definition) => definition.id === actionId) ?? null;
  }
  function refreshKeybindUi() {
    if (!shadow) return;
    shadow.querySelectorAll("[data-keybind-section]").forEach((toggle) => {
      toggle.checked = !!keybindSettings.enabled[toggle.dataset.keybindSection];
    });
    shadow.querySelectorAll("[data-keybind-action]").forEach((button) => {
      const actionId = button.dataset.keybindAction;
      const listening = actionId === capturingKeybindAction;
      button.classList.toggle("listening", listening);
      button.textContent = listening ? "Press key\u2026" : formatChord(keybindSettings.bindings[actionId]);
    });
    shadow.querySelectorAll("[data-keybind-feedback]").forEach((element) => {
      element.textContent = keybindFeedback;
    });
  }
  function setSpeedFromKeybind(value) {
    speedInput.value = String(value);
    commitSpeed();
  }
  function executeKeybind(actionId) {
    if (!latestStatus?.compatible || !latestStatus.stageActive) return false;
    switch (actionId) {
      case "speed-down":
        nudgeSpeed(-1);
        return true;
      case "speed-up":
        nudgeSpeed(1);
        return true;
      case "speed-025":
        setSpeedFromKeybind(0.25);
        return true;
      case "speed-05":
        setSpeedFromKeybind(0.5);
        return true;
      case "speed-1":
        setSpeedFromKeybind(1);
        return true;
      case "speed-2":
        setSpeedFromKeybind(2);
        return true;
      case "speed-4":
        setSpeedFromKeybind(4);
        return true;
      case "frame-backward":
        dispatch({ type: "STEP_BACKWARD" });
        return true;
      case "toggle-play":
        dispatch({ type: "TOGGLE_PLAY" });
        return true;
      case "frame-forward":
        if (latestStatus.nativePaused) return false;
        dispatch({ type: "STEP_FORWARD" });
        return true;
      case "save-state":
        dispatch({ type: "SAVE_STATE" });
        return true;
      case "load-latest-state": {
        const newest = latestStatus.manualStates.at(-1);
        if (!newest) return false;
        dispatch({ type: "LOAD_STATE", id: newest.id });
        return true;
      }
      case "delete-latest-state": {
        const newest = latestStatus.manualStates.at(-1);
        if (!newest) return false;
        dispatch({ type: "DELETE_STATE", id: newest.id });
        return true;
      }
      default:
        return false;
    }
  }
  function suppressKeyEvent(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function completeKeybindCapture(actionId, eventChord) {
    capturingKeybindAction = null;
    pendingModifierCapture = null;
    const result = assignKeybind(keybindSettings, actionId, eventChord);
    keybindSettings = result.settings;
    const action = keybindDefinition(actionId);
    const displaced = result.displacedActionIds.map((id) => keybindDefinition(id)?.label ?? id);
    keybindFeedback = `${action?.label ?? actionId}: ${formatChord(eventChord)}.${displaced.length ? ` Unbound ${displaced.join(", ")} to avoid a conflict.` : ""}`;
    persistKeybindSettings();
    refreshKeybindUi();
  }
  function onShortcutKeyDown(event) {
    if (event.isComposing) return;
    const eventChord = chordFromKeyboardEvent(event);
    if (!eventChord) return;
    if (capturingKeybindAction) {
      suppressKeyEvent(event);
      suppressedKeyReleases.add(event.code);
      const actionId = capturingKeybindAction;
      if (/^(?:Control|Alt|Shift|Meta)(?:Left|Right)$/.test(event.code)) {
        pendingModifierCapture = { actionId, chord: eventChord };
        keybindFeedback = `Hold ${formatChord(eventChord)} and press another key, or release it to bind the modifier alone.`;
        refreshKeybindUi();
        return;
      }
      completeKeybindCapture(actionId, eventChord);
      return;
    }
    const origin = event.composedPath()[0];
    const textInputFocused = origin instanceof HTMLInputElement && !["button", "checkbox", "radio", "reset", "submit"].includes(origin.type);
    if (origin instanceof HTMLElement && (textInputFocused || origin.matches("textarea, select") || origin.isContentEditable)) return;
    const definition = findKeybindDefinition(keybindSettings, event);
    if (!definition || event.repeat && !definition.repeatable || !executeKeybind(definition.id)) return;
    suppressKeyEvent(event);
    suppressedKeyReleases.add(event.code);
  }
  function onShortcutKeyUp(event) {
    const wasSuppressed = suppressedKeyReleases.delete(event.code);
    if (capturingKeybindAction && pendingModifierCapture?.actionId === capturingKeybindAction && pendingModifierCapture.chord?.code === event.code) {
      const { actionId, chord: chord2 } = pendingModifierCapture;
      if (chord2) completeKeybindCapture(actionId, chord2);
    }
    if (!wasSuppressed) return;
    suppressKeyEvent(event);
  }
  function bindKeybindControls() {
    shadow.addEventListener("change", (event) => {
      const toggle = event.target.closest("[data-keybind-section]");
      if (!toggle) return;
      const section = toggle.dataset.keybindSection;
      keybindSettings.enabled[section] = toggle.checked;
      keybindFeedback = `${section === "transport" ? "Frame Transport" : section === "states" ? "Run-Local States" : "Simulation Rate"} keybinds ${toggle.checked ? "enabled" : "disabled"}.`;
      persistKeybindSettings();
      refreshKeybindUi();
    });
    shadow.addEventListener("click", (event) => {
      const target = event.target;
      const bindingButton = target.closest("[data-keybind-action]");
      if (bindingButton) {
        const actionId = bindingButton.dataset.keybindAction;
        capturingKeybindAction = capturingKeybindAction === actionId ? null : actionId;
        pendingModifierCapture = null;
        keybindFeedback = capturingKeybindAction ? `Listening for ${keybindDefinition(actionId)?.label ?? actionId}. Click it again to cancel.` : "Shortcut capture cancelled.";
        refreshKeybindUi();
        return;
      }
      const clearButton = target.closest("[data-keybind-clear]");
      if (clearButton) {
        const actionId = clearButton.dataset.keybindClear;
        capturingKeybindAction = null;
        pendingModifierCapture = null;
        keybindSettings = assignKeybind(keybindSettings, actionId, null).settings;
        keybindFeedback = `${keybindDefinition(actionId)?.label ?? actionId} is unbound.`;
        persistKeybindSettings();
        refreshKeybindUi();
        return;
      }
      const resetButton = target.closest("[data-keybind-reset]");
      if (resetButton) {
        const section = resetButton.dataset.keybindReset;
        capturingKeybindAction = null;
        pendingModifierCapture = null;
        keybindSettings = resetKeybindSection(keybindSettings, section);
        keybindFeedback = "Section shortcuts restored to defaults.";
        persistKeybindSettings();
        refreshKeybindUi();
      }
    });
    window.addEventListener("keydown", onShortcutKeyDown, true);
    window.addEventListener("keyup", onShortcutKeyUp, true);
  }
  function bindControls() {
    shadow.querySelector("#speed-down").addEventListener("click", () => nudgeSpeed(-1));
    shadow.querySelector("#speed-up").addEventListener("click", () => nudgeSpeed(1));
    speedInput.addEventListener("change", commitSpeed);
    speedInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        commitSpeed();
        speedInput.blur();
      }
    });
    shadow.querySelector("#presets").addEventListener("click", (event) => {
      const button = event.target.closest("[data-speed]");
      if (!button) return;
      speedInput.value = button.dataset.speed;
      commitSpeed();
    });
    shadow.querySelector("#backward").addEventListener("click", () => dispatch({ type: "STEP_BACKWARD" }));
    playButton.addEventListener("click", () => dispatch({ type: "TOGGLE_PLAY" }));
    shadow.querySelector("#forward").addEventListener("click", () => dispatch({ type: "STEP_FORWARD" }));
    shadow.querySelector("#save").addEventListener("click", () => dispatch({ type: "SAVE_STATE" }));
    stateList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const id = Number(button.dataset.id);
      if (!Number.isInteger(id)) return;
      dispatch(button.dataset.action === "load" ? { type: "LOAD_STATE", id } : { type: "DELETE_STATE", id });
    });
    shadow.querySelector("#collapse").addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = shadow.querySelector(".panel");
      const collapsed = panel.classList.toggle("collapsed");
      const button = event.currentTarget;
      button.innerHTML = collapsed ? ICONS.expand : ICONS.collapse;
      button.title = collapsed ? "Expand" : "Collapse";
      button.ariaLabel = collapsed ? "Expand TAS panel" : "Collapse TAS panel";
    });
    bindKeybindControls();
  }
  function bindDrag() {
    const bar = shadow.querySelector(".topbar");
    let dragging = false;
    let pointerId = -1;
    let offsetX = 0;
    let offsetY = 0;
    bar.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const rect = host.getBoundingClientRect();
      dragging = true;
      pointerId = event.pointerId;
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      bar.setPointerCapture(pointerId);
    });
    bar.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const width = host.offsetWidth;
      const height = host.offsetHeight;
      const left = Math.min(Math.max(6, event.clientX - offsetX), Math.max(6, window.innerWidth - width - 6));
      const top = Math.min(Math.max(6, event.clientY - offsetY), Math.max(6, window.innerHeight - Math.min(height, 40) - 6));
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.right = "auto";
      host.style.bottom = "auto";
    });
    const stop = (event) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      if (bar.hasPointerCapture(pointerId)) bar.releasePointerCapture(pointerId);
    };
    bar.addEventListener("pointerup", stop);
    bar.addEventListener("pointercancel", stop);
  }
  function formatNumber(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : "\u2014";
  }
  function render() {
    if (!host || !shadow) return;
    const compatible = bridgeReady && !!latestStatus?.compatible;
    connectionDot.className = `dot${compatible ? " good" : liveBundleSha256 && liveBundleSha256 !== EXPECTED_BUNDLE_SHA256 ? " bad" : ""}`;
    connectionDot.title = compatible ? "Exact build verified" : "Bridge not available";
    const active = !!latestStatus?.stageActive;
    const paused = latestStatus?.mode === "PAUSED";
    const controls = shadow.querySelectorAll("button:not(#collapse)");
    controls.forEach((button) => {
      button.disabled = !compatible;
    });
    for (const selector of ["#backward", "#play", "#forward", "#save"]) {
      const button = shadow.querySelector(selector);
      button.disabled = !compatible || !active || selector === "#forward" && !!latestStatus?.nativePaused;
    }
    speedInput.disabled = !compatible;
    if (latestStatus) {
      speedInput.value = shadow.activeElement === speedInput ? speedInput.value : String(latestStatus.requestedSpeed);
      compactReadout.textContent = `T${latestStatus.simTick} \xB7 ${latestStatus.requestedSpeed}\xD7`;
      const playState = paused ? "paused" : "playing";
      if (renderedPlayState !== playState) {
        renderedPlayState = playState;
        playButton.innerHTML = paused ? `${ICONS.play}<span>Play</span>` : `${ICONS.pause}<span>Pause</span>`;
        playButton.title = paused ? "Resume TAS simulation" : "Pause TAS simulation";
        playButton.ariaLabel = playButton.title;
      }
      statusLine.textContent = latestStatus.message;
      statusLine.classList.toggle("error", latestStatus.mode === "ERROR");
      shadow.querySelector("#native-warning").classList.toggle("visible", latestStatus.nativePaused);
      shadow.querySelector("#state-count").textContent = `${latestStatus.manualStates.length} saved`;
      const stateSignature = latestStatus.manualStates.map((state) => `${state.id}:${state.simTick}:${state.label}`).join("|");
      if (renderedStateSignature !== stateSignature) {
        renderedStateSignature = stateSignature;
        stateList.innerHTML = latestStatus.manualStates.length ? latestStatus.manualStates.map((state) => `
            <div class="state">
              <div><strong>${state.label}</strong><span>tick ${state.simTick}</span></div>
              <button type="button" data-action="load" data-id="${state.id}" aria-label="Load ${state.label}" title="Load">${ICONS.load}</button>
              <button class="remove" type="button" data-action="delete" data-id="${state.id}" aria-label="Delete ${state.label}" title="Delete">${ICONS.delete}</button>
            </div>`).join("") : '<div class="empty">No manual states in this run.</div>';
        stateList.classList.toggle("has-items", latestStatus.manualStates.length > 0);
      }
      const d = latestStatus.diagnostics;
      diagnostics.innerHTML = `
      <span>Extension</span><output>v${extensionVersion}</output>
      <span>Mode</span><output>${latestStatus.mode}</output>
      <span>Replay cursor</span><output>${latestStatus.replayLength} @ ${latestStatus.inputStartTick}</output>
      <span>Rewind depth</span><output>${latestStatus.rewindDepth}</output>
      <span>Branch / run</span><output>${d.branchGeneration} / ${d.runGeneration}</output>
      <span>State hash</span><output>${d.stateHash >>> 0}</output>
      <span>Snapshot</span><output>${formatNumber(d.lastSnapshotMs)} ms</output>
      <span>Restore avg.</span><output>${formatNumber(d.averageRestoreMs)} ms</output>
      <span>Snapshot estimate</span><output>${Math.round(d.estimatedSnapshotBytes / 1024)} KiB</output>
      <span>Virtual debt</span><output>${formatNumber(d.pendingSimulationSeconds * 60, 3)} ticks</output>`;
      host.dataset.mode = latestStatus.mode;
      host.dataset.stageActive = String(latestStatus.stageActive);
      host.dataset.simTick = String(latestStatus.simTick);
      host.dataset.replayLength = String(latestStatus.replayLength);
      host.dataset.stateHash = String(d.stateHash >>> 0);
      host.dataset.branchGeneration = String(d.branchGeneration);
      host.dataset.extensionVersion = extensionVersion;
    } else if (liveBundleSha256 && liveBundleSha256 !== EXPECTED_BUNDLE_SHA256) {
      statusLine.textContent = `Disabled: unsupported game build ${liveBundleSha256.slice(0, 12)}.`;
      statusLine.classList.add("error");
    }
    shadow.querySelectorAll("[data-speed]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.speed) === latestStatus?.requestedSpeed);
    });
  }
  async function setRuleset(enabled) {
    if (!hasExtensionRuntime) return { ok: true, harness: true };
    return chrome.runtime.sendMessage({ type: "WMB_TAS_SET_RULESET", enabled });
  }
  async function probeBundle() {
    try {
      const url = new URL("/dist/main.js", location.origin);
      url.searchParams.set("__wmb_tas_probe", `${Date.now()}-${token.slice(0, 8)}`);
      const response = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      liveBundleSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      render();
      if (liveBundleSha256 !== EXPECTED_BUNDLE_SHA256) {
        latestStatus = null;
        await setRuleset(false);
        const fallbackMarker = sessionStorage.getItem(FALLBACK_KEY);
        if (fallbackMarker !== liveBundleSha256) {
          sessionStorage.setItem(FALLBACK_KEY, liveBundleSha256);
          location.reload();
        }
        return;
      }
      sessionStorage.removeItem(FALLBACK_KEY);
      window.setTimeout(async () => {
        if (bridgeReady) return;
        const guard = sessionStorage.getItem(RELOAD_GUARD_KEY);
        if (guard === EXPECTED_BUNDLE_SHA256) {
          statusLine.textContent = "Verified build, but the page bridge did not start. Reload the tab.";
          statusLine.classList.add("error");
          return;
        }
        sessionStorage.setItem(RELOAD_GUARD_KEY, EXPECTED_BUNDLE_SHA256);
        await setRuleset(true);
        location.reload();
      }, 1600);
    } catch (error) {
      statusLine.textContent = `Compatibility check failed: ${error instanceof Error ? error.message : String(error)}`;
      statusLine.classList.add("error");
    }
  }
  window.addEventListener(READY_EVENT, (event) => {
    const detail = event.detail;
    if (detail?.protocolVersion !== PROTOCOL_VERSION || detail?.expectedBundleSha256 !== EXPECTED_BUNDLE_SHA256) return;
    const connectWhenVerified = () => {
      if (liveBundleSha256 !== EXPECTED_BUNDLE_SHA256) return;
      bridgeReady = true;
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      window.dispatchEvent(new CustomEvent(CONNECT_EVENT, { detail: { token, liveBundleSha256 } }));
      dispatch({ type: "GET_STATUS" });
      render();
    };
    if (liveBundleSha256) connectWhenVerified();
    else {
      const timer = window.setInterval(() => {
        if (!liveBundleSha256) return;
        window.clearInterval(timer);
        connectWhenVerified();
      }, 25);
    }
  });
  window.addEventListener(STATUS_EVENT, (event) => {
    const detail = event.detail;
    if (!detail || detail.token !== token || detail.status?.protocolVersion !== PROTOCOL_VERSION) return;
    latestStatus = detail.status;
    render();
  });
  if (document.documentElement) mount();
  else document.addEventListener("readystatechange", mount, { once: true });
  void probeBundle();
})();
