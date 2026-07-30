# Cosmos Audio — Worker Prioritization & Streaming: planning notes (2026-07-29)

Prep for a planning discussion on (a) re-prioritizing the worker system and (b) designing streamed
large-grid row audio ("music wherever you are"). Not a spec — a shared starting point. Companion to
`KNOB_RAIL_IMPLEMENTATION_PLAN_2026-07-28.md` (the UI-feature ledger).

---

## 1. Current progress — the knob rail (UI feature)

A persistent, always-visible **performance rail** (rounded-rectangle panel, bottom-centre, house chrome)
that is *thin UI over its own state module* — no audio-engine logic in the view.

- **Built + committed** (`fb5e59f` → `cec5795` on `cosmos-flight-poc`): `cosmos/rail-view.js` owns the rail
  DOM and builds knobs generically from `RAIL_KNOBS` × `ENGINE_SETTERS`, grouped pitch/time/harmony/texture.
- **Knobs live:** FUNDAMENTAL · SPEED · RICHNESS · VOLUME · BED/ROWS (MIX) · SPACE — the site's ADSR rotary
  reused class-for-class (270° sweep, vertical drag, dblclick-reset, keyboard fine-adjust), driven in
  normalized `[0,1]` via `railParams.setNorm` (engine-agnostic; respects the Playback firewall).
- **State layer:** `cosmos/rail-params.js` — defaults, clamps, curve mappings, change-listeners, versioned
  localStorage persistence. Headless-guarded (`assert-rail-params`, `assert-rail-bindings`, `assert-rail-view`).
- **Bound gestures-only (no `emitNow`)** — persisted values are NOT replayed on entry, so nothing repaints
  today's sound before calibration and the old audio-lab controls still own the engine.
- **Remaining:** SPEED calibration (ears-on; knob wired in ONSET mode), DWELL, MUTE button, advanced drawer
  (MODULATION/MIDI-out), then flip on `emitNow` restoration and **retire the audio lab**.

---

## 2. The worker system (what exists today)

| Pool | File | Size | Work | Priority |
|---|---|---|---|---|
| **Solver / abundance** | `solver-worker-pool.js` → `abundance-worker.js` | `max(2, min(POOL_MAX, cores−2))` (~8) | number-theory ownership solve, as **plan** + **shard** tasks | click `setFocus` priority-solves; otherwise near-first-ish |
| **Row compile** | `program-worker-pool.js` → `cull2-program-worker.js` | **`ROW_COMPILE_WORKERS = 1`** | `compileGridAudioProgram` → `buildGridCull2Readout` per zone | `priority = distance` (nearest first); `cancelQueuedExcept` prunes stale on generation/selection change |
| **Web renderer** | OffscreenCanvas worker | 1 | web-strand rendering | n/a |

The **bed** uses no worker — it voices each zone's precomputed `skyPool` (produced by the solve). So a zone
needs its solve done before either bed (`skyPool`) or rows (compiled program) can sound it.

Telemetry line: `[cosmos] zones N · solved S (+r/s) · solving · pending · tasks/s plan/shard · inflight n/n
· worker-err · task-err`. A second line reports the row pool: `q<queued> c<compiling> done cancel err`.

---

## 3. Symptoms (observed)

- **Post-move audio dropouts** — intermittent, "finicky." **Web travel triggers a dropout more than
  scrolling/flying** (Avery, 2026-07-29). Hypothesis: web travel jumps the whole field at once, so the
  solve+compile burst is larger and more simultaneous than incremental flight. Not yet measured.
- **Huge-grid stack overflow** — `compositeTape` used `Math.max(...gaps)`; at large grids the spread
  overflowed the stack ("Maximum call stack size exceeded"), so every affected zone's compile threw and
  went silent (err count climbing past 2k). **FIXED** — fold instead of spread (`0e96450`).
- **Huge-grid OOM / pause** — a rhythm with a huge single layer materializes ~`layerSum` event objects
  (~1e6) → worker OOM/pause that killed audio *everywhere*. **Interim cap** (`cec5795`):
  `audioCompileEligibility` skips owners past `ROW_MAX_COMPOSITE_ONSETS = 20000` (`reason:'too-dense'`).
  Real fix = streaming (§5).
- **Onset sparsity at low tick rate** — rows are near-silent because onset cadence scales with the tick
  rate (measured: first row voice at +0.02s @ 3735 t/s vs +1.37s @ 100 t/s; trajectory flat-near-zero at
  low fixed rates). SPEED/ONSET mode is the intended cure (targets notes/sec, not ticks/sec).
- **Post-move recovery is part tick-clocked, part wall-clock** — camera settle is wall-clock (`SETTLE_SECONDS
  = 3`, rate-independent); the tick-clocked tail is the row install boundary (`ROW_SWITCH_TICKS = 16`) plus
  onset cadence. Slower ticks ⇒ longer real-world recovery.
- **Ownership conflict: knobs ↔ audio-lab selectors.** Both surfaces write the same engine state — the MIX
  knob and the audio-mode `<select>` both call `setMix`; the SPEED knob and the `scaled speed` checkbox both
  set the speed mode. Because knobs are gestures-only (no `emitNow`) and the lab is a separate surface, the
  *proper* mode/speed sometimes doesn't register until a knob/selector is twisted. **Interim:** audio-lab
  entry defaults set to culled-grid-rows · scaled · modulation on. **Resolution:** retire the lab once the
  knobs own the surface (flip `emitNow` restoration). Also note the MIX knob reads `0.00` on entry while the
  engine starts at rows — the same gestures-only mismatch.
- **⚠ UNRESOLVED — phantom sustained bed (watch-item).** The ambient chord bed kept ringing after a hard
  refresh, tab close, and — reportedly — after fully quitting Chrome (Avery, 2026-07-29). **Not MIDI**: no
  DAW/receiver was open, toggling the IAC driver's "Device is Online" did nothing, and it was the *same Web
  Audio bed sound as the main site* — so the `pagehide` MIDI flush (`614ac64`) is retained as hygiene but is
  NOT the fix for this. **Avery's read:** the voices were scheduled/sustained and only exhausted at ~a
  grid-cycle boundary — consistent with the bed envelope being a *held pad* (`BED_SUSTAIN_FRAC`, settles to a
  floor, never decays to silence) whose oscillators are only stopped on explicit release (chord change /
  departure / `stopAudio` teardown). It stopped either as the flush work landed or on its own. **Unexplained:**
  in-page Web Audio cannot outlive the browser process, so the "survived quitting Chrome" aspect is
  unaccounted for (lingering audio-service process? incomplete quit? mis-timed perception?) — flagged, not
  chased. **Never observed in main-page playback** (which has no flight enter/exit teardown lifecycle). If it
  recurs: check whether bed oscillators are being left unreleased when the rAF loop or context tears down
  outside the Home/Esc path.

---

## 4. Known issues / open questions

- **`ROW_COMPILE_WORKERS = 1`** is the row throughput bottleneck; scaling with distance/density is part of
  the prioritization rethink. Does the compile parallelize safely?
- **The two pools don't coordinate.** A move floods both independently; there's no *global* nearest-first
  priority spanning solve + compile, and no cross-pool backpressure.
- **`tooLarge` divisor cap is bypassed** — `compileGridAudioProgram` passes a synthetic `ownerSolve` with
  `tooLarge:false`, so the `cull2-grid-core.js:69` guard never fires (the interim onset cap covers it for
  now). Revisit when streaming lands.
- **Web-travel burst** — should the destination's solve/compile be pre-warmed *during* the travel
  animation rather than all at arrival?

---

## 5. Streaming options — large-grid row audio

The real fix for OOM and for "music wherever you are." Key insight from this session:

- `compositeTape` materializes O(composite onsets) ≈ `layerSum` event objects — the OOM driver.
- Cull2 needs a "view from the cycle start," **but that view is compact and it saturates**: the composite
  tape is periodic, so the set of *distinct* gap values is finite and small. Once the gap vocabulary
  saturates (a short prefix relative to the grid), every later section culls deterministically.
- **Reflection** (`reflect:true`) is a pure index symmetry over a palindrome (`mirrorIndex = n−1−i`, mirror
  gap == this gap) — computable per-window, not a whole-cycle materialization.

**Design sketch:**
1. Compute the cull state over a bounded prefix until the gap vocabulary saturates (or a cap); snapshot the
   compact state (seen-gap set + section connectors).
2. Generate + cull a wall-clock window `[t, t+Δ]` on demand from the snapshot, keyed to the transport tick
   (`SpatialGridRowPlayer` already schedules from `absoluteTick` with per-deck cursors — see `_syncCursor`).
3. Stream windows as the playhead advances; retire old ones.

**Open questions:** window size Δ + prefetch lead; interaction with program swaps at `ROW_SWITCH_TICKS`
boundaries; per-star vs global streaming; whether the bed's `skyPool` needs analogous windowing at huge
grids; where the streaming compiler lives (worker vs main thread).

**Alternatives to weigh:** (i) keep the interim onset cap and never stream absurd grids (ambient-only
there); (ii) precompute a decimated/downsampled row for huge grids; (iii) distance-LOD (coarser compile far
from camera).

---

## 6. Prioritization rethink — the discussion topic

Decisions to make:
- **Coordinate the two pools?** A single nearest-first priority spanning solve + compile, so near-camera
  work always wins regardless of which pool it's in.
- **Scale `ROW_COMPILE_WORKERS`** with cores/distance/density (Phase 4 DENSITY already flags this).
- **Cancellation / preemption:** on a move, aggressively cancel far or stale work. Row pool has
  `cancelQueuedExcept`; does the solve pool preempt, or only append?
- **Backpressure:** cap in-flight work near the camera to keep latency low instead of queueing deep.
- **Web-travel pre-warm:** kick the destination's solve/compile during the travel animation.
- **Streaming fits here:** a streamed row compiler changes the unit of work from "whole grid" to "window,"
  which is itself a prioritization lever (compile only the window the playhead needs next).
