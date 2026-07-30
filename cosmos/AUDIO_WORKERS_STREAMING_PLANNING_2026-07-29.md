# Cosmos Audio — Worker Prioritization & Streaming: planning notes (2026-07-29)

Prep for a planning discussion on (a) re-prioritizing the worker system and (b) designing streamed
large-grid row audio ("music wherever you are"). Not a spec — a shared starting point. Companion to
`KNOB_RAIL_IMPLEMENTATION_PLAN_2026-07-28.md` (the UI-feature ledger).

> **⚠ READ `AUDIO_CHURN_INVESTIGATION_2026-07-30.md` FIRST.** Most of §3's symptoms turned out to be three
> unrelated defects — a transport sharing a thread with the renderer, late notes displaced instead of
> dropped, and two view-dependent membership sets — none of them about grid size. They are fixed
> (`10feedf` · `2d5ba31` · `88410c1`) and transitions are smooth. **Streaming's justification narrows to the
> OOM alone** (Avery, 2026-07-30: *"I'm not even convinced the high grid saturation is as much of an issue
> now"*), so read §5 and §6 below as the open design space they always were, not as a queued project.

---

## 1. Current progress — the knob rail (UI feature)

A persistent, always-visible **performance rail** (rounded-rectangle panel, bottom-centre, house chrome)
that is *thin UI over its own state module* — no audio-engine logic in the view.

- **Built + committed** (`fb5e59f` → `cec5795` on `cosmos-flight-poc`): `cosmos/rail-view.js` owns the rail
  DOM and builds knobs generically from `RAIL_KNOBS` × `ENGINE_SETTERS`, grouped pitch/time/harmony/texture.
- **Controls live:** MUTE · FUNDAMENTAL · SPEED · DWELL · RICHNESS · VOLUME · BED/ROWS (MIX) · SPACE, plus an
  advanced drawer (MODULATION · MIDI OUT) — the site's ADSR rotary reused class-for-class (270° sweep,
  vertical drag, dblclick-reset, keyboard fine-adjust), driven in normalized `[0,1]` via `railParams.setNorm`
  (engine-agnostic; respects the Playback firewall). Only DENSITY is missing (Phase 4 has no setter).
- **State layer:** `cosmos/rail-params.js` — defaults, clamps, curve mappings, change-listeners, versioned
  localStorage persistence. Headless-guarded (`assert-rail-params`, `assert-rail-bindings`, `assert-rail-view`).
- **THE RAIL OWNS THE ENGINE** (2026-07-29) — restoration runs on every entry via `applyRailToEngine()`, and
  the audio lab is a dev-only mirror behind `?audioLab=1` / Z. See §3's resolved ownership bullet.
- **Remaining:** SPEED + DWELL calibration by ear (both live and persisting now), RICHNESS's detent question,
  DENSITY (Phase 4). Knob refinement is Avery's next thread (2026-07-30).

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

- **~~Post-move audio dropouts~~ RESOLVED 2026-07-30** — intermittent, "finicky"; web travel worse than
  flying. The hypothesis here (a bigger, more simultaneous solve+compile burst) was **wrong**, and the
  arrow keys proved it: the symptom appeared under PURE ROTATION, which changes no membership, no distance
  and no `programKey`, so no solve or compile is involved at all. Measured cause: per-frame field rebuilds
  starving a main-thread transport, late events clamped into a flam, and two view-dependent membership sets.
  See `AUDIO_CHURN_INVESTIGATION_2026-07-30.md` §3.
- **Huge-grid stack overflow** — `compositeTape` used `Math.max(...gaps)`; at large grids the spread
  overflowed the stack ("Maximum call stack size exceeded"), so every affected zone's compile threw and
  went silent (err count climbing past 2k). **FIXED** — fold instead of spread (`0e96450`).
- **Huge-grid OOM / pause** — a rhythm with a huge single layer materializes ~`layerSum` event objects
  (~1e6) → worker OOM/pause that killed audio *everywhere*. **Interim cap** (`cec5795`):
  `audioCompileEligibility` skips owners past `ROW_MAX_COMPOSITE_ONSETS = 20000` (`reason:'too-dense'`).
  Real fix = streaming (§5).
- **Onset sparsity at low tick rate** — rows are near-silent because onset cadence scales with the tick
  rate (measured: first row voice at +0.02s @ 3735 t/s vs +1.37s @ 100 t/s; trajectory flat-near-zero at
  low fixed rates). SPEED/ONSET mode is the cure (targets notes/sec, not ticks/sec) and is **now the mode the
  engine starts in** on every entry, at the placeholder 2.5 notes/s — calibration is Avery's knob thread.
- **Post-move recovery is part tick-clocked, part wall-clock** — camera settle is wall-clock (`SETTLE_SECONDS
  = 3`, rate-independent); the tick-clocked tail is the row install boundary (`ROW_SWITCH_TICKS = 16`) plus
  onset cadence. Slower ticks ⇒ longer real-world recovery. (Still true, but no longer a dropout source:
  the recovery the ear was hearing was mostly churn, not this.)
- **~~Ownership conflict: knobs ↔ audio-lab selectors.~~ RESOLVED 2026-07-29 — the rail owns the engine.**
  Both surfaces used to write the same engine state (MIX knob and audio-mode `<select>` both called `setMix`;
  SPEED knob and `scaled speed` checkbox both set the speed mode), so with knobs gesture-only the *proper*
  mode/speed sometimes didn't register until something was twisted — and no dropout report could be trusted,
  because you couldn't know which surface the engine was obeying. Now: the rail restores its full state into
  the freshly built graph on **every** entry (`applyRailToEngine()` from flight-boot), the lab is a **dev
  mirror** (`?audioLab=1` / Z) that applies nothing at entry, and every shared parameter is written *through*
  `railParams` — one owner. Its remaining raw controls (ticks/s, scaled speed, cycle, λ) are probes that
  deliberately override the rail until the next entry. Entry sound: MIX 0.8 · SPEED 2.5 notes/s (ONSET) ·
  DWELL 0 · modulation on · λ 8.0 frozen. See `KNOB_RAIL_IMPLEMENTATION_PLAN_2026-07-28.md`'s as-built log.
  **This unblocks the rest of this document** — from here, an audio symptom has exactly one explanation.
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
  outside the Home/Esc path. **2026-07-30 update:** more plausible than it looked — the bed's node accounting
  let a page die holding *hundreds* of unreleased oscillators rather than the ~30 the budget implied
  (`88410c1`; investigation doc §3.4), which fits an orphaned audio-service stream better than the old
  accounting did. Bounded now, but the `pagehide` `audioCtx.close()` + release-all-on-exit hygiene is still
  worth doing: never rely on process death for silence.

---

## 4. Known issues / open questions

- **`ROW_COMPILE_WORKERS = 1`** is the row throughput bottleneck; scaling with distance/density is part of
  the prioritization rethink. Does the compile parallelize safely? **Measure first now:** the post-fix table
  shows 208 compiles/s while flying and 9.3/s at rest, so the question is no longer "is one worker enough"
  but "why is there that much work to do" (investigation doc §6).
- **The two pools don't coordinate.** A move floods both independently; there's no *global* nearest-first
  priority spanning solve + compile, and no cross-pool backpressure.
- **`tooLarge` divisor cap is bypassed** — `compileGridAudioProgram` passes a synthetic `ownerSolve` with
  `tooLarge:false`, so the `cull2-grid-core.js:69` guard never fires (the interim onset cap covers it for
  now). Revisit when streaming lands.
- **Web-travel burst** — should the destination's solve/compile be pre-warmed *during* the travel
  animation rather than all at arrival? (Still a good latency win; no longer a dropout fix, since web travel
  was never the mechanism.)

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

**⚠ AMENDMENT — Avery on the saturation claim (2026-07-29).** Two corrections that constrain the design:

1. **Saturation cannot be *detected* before half the cycle.** Every polyrhythm is a **palindrome** — that is
   an invariant property, not a tendency — so all novel gap content has appeared by the midpoint. There is
   therefore no test that says "the vocabulary is saturated" until at least half the tone row is computed.
   "A short prefix relative to the grid" is not available as a cheap detector: the honest bound is `cycle/2`.
2. **Caps are not on the table.** Capping the gap inventory would distort the tuning system, since the gaps
   *are* the pitches. Any "cap" tier is a silence policy (skip this owner), never a truncation of the row.
3. **The back half must still SOUND.** Culling everything after the novelty ends is exactly what reflection
   already prevents (`reflect:true`): notes on in the first half are mirrored into the second regardless, so a
   star is not silent for half its cycle. **Worth verifying the mirror is actually holding** — it is the thing
   that makes a streamed tail musical rather than empty. Immersive streaming needs sound *everywhere*, so
   "the tail culls deterministically" is a statement about *cheapness*, not about silence.

So the streaming contract is a snapshot taken over a **`cycle/2` prefix** (where the vocabulary is provably
complete), with the second half generated by index symmetry — which is per-window computable and needs no
detector at all. The open question is not "how short is the prefix" but **how to compute a half-cycle prefix
without materializing it** (the composite tape, not the cull state, is the ~1e6-object OOM driver).

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

**Status 2026-07-30.** Instrumentation exists (`cosmos/audio-telemetry.js`; **T** dumps a per-motion-mode
table) — build on it rather than re-deriving it. The transport is off the main thread and the per-frame field
rebuild is gone, so the two pools no longer contend with the clock at all; what remains is the **work itself**:
150 installs/s and 208 compiles/s while flying, 6.2/9.3 at rest. That is the next thing to chase, and it is
upstream of every question in this section — a unified priority score matters much less once there is less to
prioritize. `_seedDeck` walking the event list twice per install is the first place to look.
