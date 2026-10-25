# Development report

Date: 2026-09-14  
Target: <https://monkeyball-online.pages.dev/>  
Reference: <https://github.com/sndrec/WebMonkeyBall>

## Audited artifacts

| Artifact | Evidence |
| --- | --- |
| Deployed module | 2,952,289 bytes; SHA-256 `598c7a561f4c6cf1bce90741f507735b7d5258106cb779e07ddc5d51893abfa6` |
| Deployed source map | 5,446,975 bytes; SHA-256 `6f151f2099c2e36e1a505f865ccad21c95fca8e5af0fca9a0de1b82c27605bf5` |
| Embedded build identifier | `ec5b97599e75d7d10cf5fcb7ac539cba558d6a15` |
| Public repository HEAD audited | `6d7caf6b2e7d46b863cbf5154b97997dbb2bd511` |
| Supplied replay | 4,548 bytes; SHA-256 `4ea8041efb1d3f3650055202358d9b564b2d2c84758096f760d29f35570413ec` |

The deployed commit was not fetchable from the public Git remote at audit time, so
the deployed source map—not a guessed public branch—was used to inspect the active
client. It embedded 170 source files. Several generated modules referenced by
those sources were absent from the map, making a clean source rebuild incomplete.
The production bundle is therefore the reproducible base artifact; its hash is
checked before any patching.

## Source findings

- `src/sim/game_core.ts` owns `fixedStep = 1/60`, `accumulator`, `simTick`, native
  replay recording/export, fixed-tick mode, rollback save/load, stage lifecycle,
  and deterministic stage runtime state.
- `onAfterSimTick` fires after `simTick += 1`, providing an unambiguous
  post-authoritative-tick snapshot boundary.
- Native rollback covers players/balls, worlds, cameras, gameplay timers,
  stage-runtime objects and RNG, bananas, bumpers, jamabars, switches, goal bags,
  and tapes. The bridge adds only omitted game scalars and replay-controller state
  required to align a restore.
- `src/app/render/frame_loop.ts` separates simulation and rendering. This permits a
  TAS pause without freezing requestAnimationFrame, menus, or drawing.
- `Game.exportReplay()` already produces the required v1 shape. Native replay
  library save/export/import/load remains the sole serialization path.
- Multiplayer and replay playback are identifiable from native state and are
  excluded from TAS manipulation.

## Instrumentation seams

The build rejects anything other than one match for each seam:

1. Insert the isolated bridge IIFE immediately before the final `src/main.ts`
   module body.
2. Register a proxy with the existing mod-hook registry for post-tick capture.
3. Install the controller after the live `game` and `audio` objects exist.
4. Route only the single-player frame-loop update through `tasBridge.tick`; netplay
   remains untouched.
5. Freeze viewer/HUD clocks during TAS pause and force interpolation alpha `1`
   after restores.

No global clock is replaced. No physics routine, input quantizer, replay encoder,
stage definition, renderer, or network path is reimplemented.

## Replay ownership model

An immutable linked replay node is appended only after the native recorder appends
its quantized input for a completed tick. Each rollback checkpoint stores its node,
native rollback state, scalar supplement, input-start tick, replay length, sim
tick, and deterministic hash. A manual slot stores a checkpoint reference plus a
materialized immutable prefix.

Restore is transactional: validate run identity, load the native snapshot, restore
the exact replay prefix, clear scheduling residue, and compare tick, replay cursor,
and hash. A mismatch attempts to restore the previous committed checkpoint before
surfacing an error. The first subsequently completed tick becomes the child of the
restored node, so native export can only see the final committed prefix plus the
new branch.

## Recorded verification

Automated core/build suite: **11/11 passing** after the final build.

Real Chrome 152 temporary-profile run against the production URL:

| Check | Recorded result |
| --- | --- |
| Compatibility handshake | `Start a single-player stage.` |
| TAS pause | tick remained fixed for 400 ms |
| First-click stability | deliberate 180 ms pointer press activated once on release |
| One forward | exactly `+1` sim tick |
| One backward | exact prior state hash restored |
| Opposite-input branches | distinct state hashes |
| Reload + same input | original branch hash reproduced exactly |
| 0.5× sample | 36 ticks in 1,200 ms |
| 2× sample | 148 ticks in 1,200 ms |
| Native export schema | exactly six v1 fields; no TAS metadata |
| Dense state list | 12 states; 210 px viewport over 499 px content; internal overflow `auto` |
| Exported replay end | hash equaled committed TAS end-tick hash |
| Clean client acceptance | imported and entered playback without the extension harness |
| Page exceptions | none |

Exact numeric hashes vary with the starting display frame; the matching relations
are the acceptance condition. The latest values are recorded in
`artifacts/browser-e2e/report.json`.

The only console errors were an existing cross-origin request failure for the
game's leaderboard allowlist endpoint. They occurred outside the TAS bridge and
did not raise a page exception.

## Packaging and compatibility

The final unpacked extension is `dist-extension`. Its `build-meta.json` records all
output hashes. The document-start content script hashes a query-string copy of the
unmodified live module before connecting. On mismatch it disables the redirect
ruleset, reloads once, and leaves the native site operational.

Chrome 152 no longer honors command-line `--load-extension` for its branded build.
The automated browser suite therefore loads the exact built content script and
instrumented module through Playwright routing. Loading the unpacked extension in
the user's normal profile remains a manual `chrome://extensions` step and is not
silently performed by the build.

## Remaining limits

- The public upstream repository had no license file at audit time. Distribution
  of its bundled code requires permission review; see `THIRD_PARTY_NOTICES.md`.
- High speed is CPU- and snapshot-cost limited. Debt is preserved rather than
  skipping ticks.
- History is session-memory-only. Refresh or a new stage discards it intentionally.
- A new production hash must not be allowlisted until the hook anchors and rollback
  coverage are re-audited and the full suite passes again.
