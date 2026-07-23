# Cull2 Ratio-Owner Audio — state and main-thread handoff (2026-07-23)

This document hands off the new temporal playback prototype on branch `cosmos-flight-poc`. It is the
result of the Cull2/Grid-mode working session following `SKY_ROOT_LISTENING_2026-07-22.md`.

The new method is **not yet wired into Cosmos playback**. The lab, pure compilers, ratio-owner shard
payload, and runtime aggregation are built and guarded. The next implementation should add it as a
separate auditionable audio mode alongside the existing Full Sky ambient chord bed. Do not remove or
silently change the chord bed; both modes are prototypes and will continue to evolve.

## Current headline

Grid `16380` demonstrates why ratio ownership is the right monster-grid reduction:

| stage | count / time |
|---|---:|
| valid rhythms scanned | 53,655 |
| keep-2 rhythms | 9,911 |
| aggregate folded ratio types | 349 |
| unique ratio-owner rhythms entering Cull2 | 114 |
| temporal-construction reduction | **98.8%** |
| initial ratio-owner solve (local measurement) | ~5.1 s |
| Cull2 construction from cached owners, all ratios | ~28 ms |
| subsequent Scale Selector rebuild | ~19 ms |

The expensive first pass is sharded/off-thread. Once ownership is known, the temporal program is
small enough to rebuild interactively.

## What is built

### 1. The Cull2 Audio Reflection Lab

Open `cosmos/cull2-audio-test.html` through the project server. It has two tabs:

- **Rhythm mode** accepts one 2–4 layer rhythm and exposes its complete Cull2 analysis.
- **Grid mode** accepts one grid, solves its folded-ratio owners, Cull2-compiles only the unique owner
  rhythms, and overlays their surviving events into one four-voice grid cycle.

The lab includes:

- Scale Selector for octave-folded harmonic selection.
- Toggleable palindromic reflection (enabled by default).
- Toggleable repeated-tone holding per canonical layer (enabled by default).
- Audition transport expressed as `0–100` grid ticks per second, default `15`.
- Per-rhythm and per-grid summary/readout tables.
- Double-click-collapsible section headers.
- Worker compilation and cached grid ownership so selector/toggle changes do not repeat the expensive
  arithmetic solve.

Worker/module URLs are explicitly cache-busted. Browser Web Worker module graphs cache aggressively;
when any worker dependency changes, bump the matching version query throughout the chain.

### 2. Individual-rhythm temporal compiler

`cull2-audio-core.js` is pure: no DOM, WebAudio, or main playback imports.

For a rhythm `a:b:c:d`, it:

1. Normalizes layers and constructs the real composite onset/gap tape.
2. Ports Pathways `cull2`: coincident-node arrivals delimit z-segments; a later segment is culled when
   all its gap values already exist in the accumulated earlier vocabulary.
3. Restores the palindromic reflection of every surviving front-half event at its exact back-half
   event. The reflected event keeps its real back-half layer ownership.
4. Applies Scale Selector state by folded ratio.
5. Emits per-layer play/hold/off decisions and a detailed readout.

### 3. Repeated-tone holding

Within one standalone rhythm, if the same layer encounters the same exact gap again, it holds rather
than retriggering. Gap equality means the same raw ratio and octave; folded-ratio equality alone is
not sufficient.

In Grid mode this rule is intentionally deferred until **after** all representative rhythms are
overlaid. Another rhythm may replace canonical voice A, B, C, or D between two occurrences of a tone;
pre-culling within the source rhythm would then suppress a necessary attack. Cross-rhythm held-tone
identity uses the exact raw fraction because different source rhythms can encode the same pitch with
different numeric gap sizes.

### 4. Ratio-owner reduction

The aggregate star pool owns folded ratios, matching the Scale Selector and `deriveScale()` identity.
For each folded ratio, choose one representative rhythm:

1. Lowest layer sum wins.
2. On a layer-sum tie, fewer layers wins.
3. Remaining ties use the canonical numeric layer tuple, then canonical key.

A keep-2 dense partner can never win: it has the same ratio set as its efficient partner and an
equal-or-greater layer sum. Ratio ownership therefore considers only the efficient representative of
each `(fundamental | ratioSet)` group.

Ownership is reduced in two stages with the same comparator:

- `gridShardSolve()` returns the best candidate per folded ratio within one max-layer shard.
- `Cosmos._onShard()` merges those candidates into the star's global `z.ratioOwners` set as shard
  replies arrive.

Only rhythms owning at least one ratio enter Cull2. Within each owner rhythm, only the ratios actually
owned by that rhythm are eligible to emit events. Non-owning rhythms and duplicate occurrences from
other mother scales never reach temporal construction.

### 5. Canonical star voices

Every grid star produces at most four monophonic legato streams: canonical A, B, C, and D. Layer A
events from every owner rhythm compete for canonical A, and likewise for B–D.

At a tick where one canonical layer receives different raw pitches, the lab currently chooses the
pitch with greatest source support and then the lower register. With unique folded-ratio ownership,
support is commonly tied at one; this collision policy is explicitly provisional and needs listening.
All losing candidates remain visible in the lab readout.

## Monster gating — required invariant

True monsters are identified during the worker `plan` operation and displayed behind **Solve
anyway**. This gate already protects ratio-owner generation:

- A `monster` plan response contains no shard plan.
- Therefore no shard is dispatched, no `ratioOwners` payload exists, and the new audio compiler must
  not be queued.
- `Cosmos.forceSolve(grid)` is the sole opt-in. It clears stale ratio-owner state, sets `force`, and
  returns the zone to `pending` so the normal interleaved shard pipeline can begin.
- The new audio program may be compiled only after the forced zone reaches `state === 'solved'` and
  `shardsDone === shardsTotal`. Partial ownership is useful for diagnostics but must not become a
  playback program because later shards can replace an earlier owner.
- Eviction or a newer generation token must invalidate an in-flight audio compile result.

This behavior must remain explicit in guards when playback wiring begins.

## Main Cosmos integration: recommended architecture

### Mode boundary

Add an explicit audio mode, not a replacement:

- `ambient-chords` — current Full Sky per-star chord-bed behavior, unchanged.
- `culled-grid-rows` — the ratio-owner/Cull2 canonical A–D method described here.

The UI/query mechanism can be chosen during integration, but mode identity should be an enum/string,
not a collection of loosely related booleans. Root solving, chord walking, and harmonic selection can
remain shared upstream musical state while each mode interprets that state with its own playback
engine.

### Thread split

Keep three responsibilities separate:

1. **Abundance shard workers:** number theory, keep-2 counting, Full Sky tone pools, and ratio-owner
   candidates. Already implemented.
2. **Audio-program compiler worker:** accepts a finalized compact `ratioOwners` array plus grid,
   reflection, repeat-hold, and selected-folded-ratio state; returns an immutable compact event
   program. The lab's `cull2-grid-worker.js`/`cull2-grid-core.js` are the starting implementation.
3. **Main/audio control:** owns WebAudio nodes and only schedules precompiled events with a short
   lookahead. It must never enumerate rhythms, run Cull2, or wait synchronously for a worker.

Starting or completing a forced monster solve must not stop, restart, or mutate the program currently
playing. Keep the prior field/program alive while compilation runs. Install a completed program
atomically at a defined musical boundary (preferably its next cycle boundary) and crossfade star gain
instead of replacing oscillators synchronously.

Suggested per-star state:

```text
unavailable (monster gate / unsolved)
  -> ownership-solving (only after ordinary plan or Solve anyway)
  -> ownership-ready (all shards complete)
  -> program-compiling (dedicated compiler worker)
  -> program-ready
  -> active (atomic boundary swap / crossfade)
```

Use a monotonically increasing generation token on each request. Ignore replies for evicted zones,
changed selection generations, changed modes, or superseded forced solves.

### Correct spatial audio

Treat a star as one coherent 3D source:

```text
A oscillator/envelope ┐
B oscillator/envelope ├─> per-star gain/filter bus -> PannerNode -> mode master
C oscillator/envelope ┤
D oscillator/envelope ┘
```

- Place the panner at the star's actual world position, transformed consistently with the listener.
- Update listener position/orientation from the camera and star panner positions at control/render
  rate with parameter smoothing; never compute spatial geometry in the scheduling callback.
- Do not infer stereo from screen x or front-view depth. Use the WebAudio listener/panner spatial
  model so behind/above/below positions remain real.
- Preserve a bounded star/oscillator budget and distance gain, but make budget misses observable in
  debug state.
- Fade a star bus on program entry/exit. Voice replacement remains internal to A–D and must not
  recreate the panner or disconnect the spatial bus.

## Files added

- `cull2-audio-core.js` — pure single-rhythm tape/Cull2/reflection/selection compiler.
- `cull2-audio-player.js` — self-contained four-layer WebAudio audition transport.
- `cull2-audio-test.html` / `cull2-audio-test.js` — Rhythm/Grid lab.
- `cull2-grid-core.js` — ratio-owner grouping, representative Cull2 compilation, canonical overlay.
- `cull2-grid-worker.js` — lab audio-program worker.
- `cosmos/assert-cull2-audio.mjs` — headless temporal/grid/transport/UI contract guards.

## Existing files extended

- `grid-core.js` — ratio-owner comparator, shard-local owner reduction, whole-grid lab reducer.
- `cosmos/abundance-worker.js` — returns shard-local ratio-owner payload beside abundance/Full Sky.
- `cosmos/cosmos-runtime.js` — merges shard payloads into `z.ratioOwners`; force solve clears ownership.
- `flight-view.js` — worker cache bump and selected-ratio debug overlay.
- `cosmos-audio.js` — pure selected/sounding ratio-tone debug model.
- `cosmos/assert-shard.mjs` / `cosmos/assert-fullsky.mjs` — ownership and debug guards.

## Verification

Primary new guard:

```bash
node cosmos/cosmos/assert-cull2-audio.mjs
```

Relevant regressions:

```bash
node cosmos/cosmos/assert-shard.mjs
node cosmos/cosmos/assert-fullsky.mjs
node cosmos/cosmos/assert-chordwalk.mjs
node cosmos/cosmos/assert-cosmos.mjs
node cosmos/cosmos/assert-runtime.mjs
node cosmos/cosmos/assert-hilbert.mjs
```

`assert-cull2-audio` proves the individual Cull2 rule, palindromic reflection, Scale Selector,
repeat holds, exact ratio ownership, canonical overlay, tick-rate transport, and lab wiring.
`assert-shard` proves shard arrival order reduces to the exact global owner for every ratio without
changing abundance, progressive solving, interleaving, or error recovery. It also proves a monster
emits no ratio owners or shard work before `forceSolve()`, then finalizes owners through the normal
shard path after the explicit opt-in.

## Next implementation sequence

1. Add explicit `ambient-chords` / `culled-grid-rows` mode selection while leaving the default chord
   bed unchanged.
2. Define the compact finalized zone payload passed to the audio compiler: `grid`, `ratioOwners`,
   selected folded fractions, and a generation token.
3. Extend the existing monster ratio-owner gate guard to the audio compiler queue: no compile before
   `forceSolve()`, and no compile until all forced shards finish.
4. Move/adapt the lab compiler behind a dedicated worker pool; never share an AudioContext or live
   node references with it.
5. Build the persistent per-star A–D bus and true 3D panner graph.
6. Add atomic cycle-boundary program installation, crossfade, eviction cancellation, and stale-reply
   rejection.
7. Wire selected-tone/chord/root state into the new mode, then listen before changing collision
   arbitration or voice budgets.
8. Stress-test fast flight plus forced monster solve while the prior field keeps playing without a
   scheduler gap, click, or main-thread stall.

## Separate open work from the prior root handoff

`SKY_ROOT_LISTENING_2026-07-22.md` documents root-ladder saturation, display precision, and the lead
mask's missing root anchor. Those concerns remain separate and are not solved by this temporal mode.
Do not conflate a root/modulation change with swapping playback engines.
