# Web-Monkey Ball ~ TAS Tools

A Manifest V3 Chrome extension for the deployed WebMonkeyBall client. It adds a
compact in-game panel for arbitrary simulation speed, TAS pause, exact one-tick
forward/rewind, and run-local manual save states while keeping exported replays in
the game's native v1 JSON format.

This is a build-locked prototype. It supports the production bundle whose SHA-256
is `598c7a561f4c6cf1bce90741f507735b7d5258106cb779e07ddc5d51893abfa6`
and disables its page bridge on any other build.

## Install the unpacked extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the absolute `dist-extension` directory in this project.
5. Open or reload <https://monkeyball-online.pages.dev/>.

After rebuilding an already-loaded unpacked extension, click its **Reload** button
on `chrome://extensions` before reloading the game tab. Historical entries on the
extension's **Errors** page remain until their trash buttons are clicked; the TAS
panel's Diagnostics section shows the currently loaded extension version.

The panel should say **Start a single-player stage.** after the compatibility
check. If it reports an unsupported build, leave it disabled until the extension
is updated and re-audited for the new game bundle.

## Controls

- Enter any ordinary finite decimal at or above `0` in **Simulation rate**.
  Scientific notation, `Infinity`, `NaN`, negative values, and locale commas are
  rejected. `0` is TAS pause; `1` delegates to the game's normal update path.
- **Pause / Play** controls only TAS simulation. The game's Escape-key pause menu
  remains independent.
- **Back** restores the previous completed authoritative 1/60-second tick.
- **Forward** simulates exactly one authoritative tick using the input currently
  held by keyboard or controller. It is deliberately locked while the native
  pause menu is open.
- **Capture current tick** adds an immutable run-local state. Load and delete are
  available per slot. Slots have no configured count limit, but they consume
  memory and are cleared when a new stage run starts or the page closes. The state
  rows compact into their own scrollable 210 px viewport as the list grows.

TAS manipulation is disabled during multiplayer, netplay, stage-view mode, stage
loading, and native replay playback.

## Keybinds

Each TAS section has its own **Keys** switch and expandable keybind editor. Click
a displayed shortcut and press the replacement key or modifier chord; conflicts
automatically unbind the older action. Use the adjacent × button to leave an
action unbound or **Reset keys** to restore that section. Settings persist in the
game origin's local browser storage and only fire during an active TAS stage;
typing into inputs is never intercepted. Browser- or operating-system-reserved
shortcuts cannot be captured if they are not delivered to the page.

Defaults:

- Simulation Rate: `[` / `]` cycle rates, and `1`–`5` select `0.25×` through `4×`.
- Frame Transport: `J` rewinds, `K` toggles play/pause, and `L` advances.
- Run-Local States: `U` captures, `I` loads the newest state, and `O` deletes it.

## Replay integrity

Each completed simulation tick owns a native rollback checkpoint and a persistent
replay-prefix node. Rewind/load restores both. The first new tick after a restore
creates a new branch from that prefix; abandoned future input remains reachable
only through any manual state that intentionally points to it. The game itself
still performs export, so the file has only its native fields:

```json
{
  "version": 1,
  "gameSource": "smb1",
  "stageId": 1,
  "ticks": 42,
  "inputStartTick": 360,
  "inputs": [{ "x": 0, "y": -127 }]
}
```

No TAS metadata, state snapshots, alternate futures, or compatibility fields are
added. The bundled golden fixture is the supplied SMB1 Beginner replay.

## Deterministic scheduler

The native fixed step remains `1/60`. At `1×`, the original `game.update(dt)` path
is used. Other speeds accumulate virtual simulation-time debt and execute complete
native ticks. Work is capped at 240 ticks and 8 ms per rendered frame; excess debt
is carried forward, never converted into skipped physics. Switching modes,
restoring state, hiding the tab, and reopening playback clear or transfer the
appropriate scheduler accumulator so stale wall-clock time cannot leak into the
run.

TAS pause stops simulation, replay recording, HUD animation time, and rolling ball
audio while normal rendering continues with interpolation alpha `1`.

## Build

Requirements: Node.js 20 or newer and pnpm 11.

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm sync:font
pnpm sync:upstream
pnpm build
pnpm test
pnpm test:browser
```

`sync:upstream` downloads the current production module and source map, rejects
them unless both hashes match the audited artifacts, and extracts embedded source
for review. `build` compiles the isolated bridge and patches five exact seams in
the verified production module. Any missing, duplicated, or changed anchor fails
the build.

The build output is `dist-extension`. `build-meta.json` records the upstream,
instrumented, and content-script hashes.

## Validation

`pnpm test` checks speed parsing, fractional/high-speed debt, lifecycle rules,
persistent branch behavior, the supplied replay schema, manifest scope, pinned
hashes, and every instrumentation seam.

`pnpm test:browser` uses a temporary Chrome profile and the production URL. Because
current branded Chrome ignores command-line unpacked-extension loading, the
automated harness injects the exact built content script and intercepts only the
production module request with the exact built instrumented module. It then clicks
the real menu and panel controls, holds a first click across status refreshes,
verifies pause/forward/rewind, proves divergent and reproduced input branches by
native state hash, exercises 0.5× and 2×, exports
through the native replay library, compares the replay's end-tick hash with the
committed TAS branch, and imports/loads the file in a second clean Chrome profile
without the harness.

Artifacts and the machine-readable result are written under
`artifacts/browser-e2e`.

## Architecture and trust boundary

- A one-rule declarative ruleset redirects only the target's exact
  `/dist/main.js` script request to the packaged instrumented module.
- A document-start content script independently fetches the original module with
  a query-string probe and hashes its bytes before sending a random per-page bridge
  token.
- Page and extension communicate through a small typed CustomEvent command/status
  protocol. Heavy snapshots stay in the page world and never cross the DOM bridge.
- The overlay lives in an open Shadow DOM, uses bundled Oxanium, custom SVG icons,
  internal scrolling, collapse, and pointer dragging.
- Permissions are limited to one DNR permission and the target origin. There is no
  storage permission, broad site access, remote runtime code, analytics, or data
  upload.

## Failure modes and limits

- A game deployment changes the module hash: the static redirect is disabled and
  the page reloads the untouched original game. The panel reports the unsupported
  hash.
- A native rollback load or replay cursor disagrees with its checkpoint: restore
  is rejected, the prior checkpoint is restored transactionally when possible,
  and the controller enters a visible error state.
- Very high speed may build virtual-time debt on slower machines. Rendering remains
  responsive and no physics ticks are skipped, but requested real-time throughput
  is not guaranteed.
- Automatic per-tick history and manually retained branches use memory for the
  lifetime of the stage. “Unlimited” means no artificial slot cap, not infinite
  physical memory.
- Determinism is scoped to the audited browser/game build and the game's own native
  rollback coverage. Compatibility with future deployments requires a fresh
  source audit and updated hashes.

See [DEVELOPMENT_REPORT.md](DEVELOPMENT_REPORT.md) for the audit and recorded test
evidence, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before distribution.
