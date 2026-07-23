# Culled Grid Rows 3D Audio Handoff — 2026-07-23

This pass adds a production-shaped `culled-grid-rows` Cosmos audio mode while preserving `ambient-chords` as the default. It compiles each nearby grid star's finalized ratio-owner data off the playback path, then schedules the culled A–D tone rows from the star's real 3D position.

## Musical contract

- Every eligible rhythm first goes through Cull2 ownership.
- Ratio selection is a second minimization step: only owner ratios within the current global chord/root consonance window are retained. The initial window is ±35 cents and is intentionally ready to become a user control.
- Selection happens before overlay construction, so an overlay never keeps an owner only because a later chord filter happens to like it.
- Programs retain the selected fractions and cents used to build them. Sky Debug's `SELECTED RATIO TONES` chart now reads those active per-star program pools in row mode. Its `ON` column counts the fractions of live canonical A–D voices. Ambient mode retains the older audible-star-pool/live-bed interpretation.

## Movement and playback budgets

- 12 nearest eligible stars are kept warm.
- 8 nearest stars inside 1,400 world units are active.
- Player/camera movement is the primary source of program changes; playback does not wait for an impractically long full grid cycle.
- Program swaps land on a 16-tick quantum and crossfade for 0.35 seconds while preserving absolute grid phase.
- The player allows up to four canonical legato row streams per star and caps transient voices at 64.

## Architecture

- `cosmos-grid-audio-core.js` is the pure compiler/projection layer. It applies the chord/root consonance gate and emits compact row programs.
- `cull2-program-worker.js` performs compilation away from the main/playback path.
- `program-worker-pool.js` owns worker queueing, cancellation, cache/lifecycle checks, and debug counters.
- `spatial-grid-row-player.js` owns the WebAudio graph and scheduling. Each active star has an HRTF `PannerNode`; listener position and orientation follow the camera, including sources behind, above, and below the player.
- `cosmos-audio.js` keeps the ambient bed intact, crossfades between modes, and projects both audio modes into Sky Debug.
- `flight-view.js` chooses/prewarms nearby programs, rejects stale replies, updates 3D listener/source state, and renders the debug telemetry.

## Safety and lifecycle rules

- Combinatorial monsters and partial/unfinished ownership never cross the audio boundary. Manual forced solves increment `solveGeneration`.
- Worker results are rejected when their generation, mode, zone, selection, or eviction state is stale.
- Mode changes dispose or silence row playback cleanly; ambient remains the startup/default path.
- The worker protocol and compiler stay independent of WebAudio, making selection/program behavior deterministic and testable.

## Verification completed

- `node cosmos/cosmos/assert-grid-spatial-audio.mjs`
- `node cosmos/cosmos/assert-cull2-audio.mjs`
- `node cosmos/cosmos/assert-shard.mjs`
- `node cosmos/cosmos/assert-chordwalk.mjs`
- `node cosmos/cosmos/assert-cosmos.mjs`
- `node cosmos/cosmos/assert-runtime.mjs`
- `node cosmos/cosmos/assert-hilbert.mjs`
- `node cosmos/cosmos/assert-fullsky.mjs`

The Full Sky suite passed after the main implementation. The final debug-chart projection was then covered by the focused grid-spatial assertion and a live in-app browser check. The browser showed 8 active/12 warm row stars and populated the row chart from their compiled selections, with no Cosmos console warnings or errors. Browser automation cannot reliably unlock its AudioContext, so final audible balance and live `ON` behavior still need normal user-gesture listening.

A stress compile of cached grid 16,380 ownership produced 349 owners, 64 chord-selected owners, 141 compact events, and about 26 KB of program data in 26.3 ms on this machine.

## Next listening/refinement targets

- Expose or tune the ±35-cent consonance window.
- Refine collision arbitration when many stars schedule dense events at once.
- Tune the 8/12 star budgets and 1,400-unit radius against abundant but non-monster grids.
- Tune distance gain, low-pass response, row timbres, tick rate, swap quantum, and crossfade duration.
- Validate listener orientation and vertical/behind localization over headphones.

## Full Sky regression speed

`assert-fullsky.mjs` is now the slow end-of-turn check. Its M1 and B1 sections re-enumerate overlapping expensive real-grid/shard material. A good next step is to cache each grid's worker-path, brute-force, and tone results once per run and reuse them across guard sections. A quick/default corpus plus an explicit `--stress` full corpus could help too, but the default should retain representative real abundant grids and must not silently reduce regression coverage.

## Files added or materially changed

- `cosmos/cosmos-grid-audio-core.js`
- `cosmos/cosmos/cull2-program-worker.js`
- `cosmos/program-worker-pool.js`
- `cosmos/spatial-grid-row-player.js`
- `cosmos/cosmos-audio.js`
- `cosmos/flight-view.js`
- `cosmos/cosmos/cosmos-runtime.js`
- `cosmos/assert-grid-spatial-audio.mjs`
- `cosmos/assert-shard.mjs`
- `index.html`
- `style.css`
