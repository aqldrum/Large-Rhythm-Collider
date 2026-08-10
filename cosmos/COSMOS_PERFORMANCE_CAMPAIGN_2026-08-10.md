# Cosmos performance campaign (2026-08-10)

As-built record of a profiling-led optimization arc across the Cosmos flight feature: visual (main-thread
Canvas 2D), audio (chord-change recompile storm), and the start of a memory-leak / audio-death investigation.
Companion to `AUDIO_CHURN_INVESTIGATION_2026-07-30.md` (the prior audio-smoothness arc) and
`AUDIO_WORKERS_STREAMING_PLANNING_2026-07-29.md`.

**Outcome, Avery (2026-08-10):** *"definite wins here."* Visual freezes and the chord-change deserialization
freeze are addressed; the ~2.1 GB memory growth + audio-death-until-refresh is now **scoped and instrumented,
not yet root-caused** — that is the top item for the next thread (see §5, §6).

---

## 1. Commits (this campaign)

| Commit | What |
|---|---|
| `74cf29a` | Batch star cores + cap DPR — main-scene draw calls 10k→12/frame |
| `9c2d4dd` | Halve `HIL_EVICT` 40→20 — cap the rear star-wake (the master LOD lever) |
| `e007947` | Coalesce landing-driven field rebuilds — cut the chord-change rebuild storm |
| `7990416` | Intern row-program actions — kill the chord-change deserialization freeze |
| `f5ff905` | Guard + instrument `schedulerTick` — stop a bad tick stranding audio; adds `window.__cosmosHealth()` |

(`1cfbabd` "pitch-colored orbs" landed interleaved but is **Avery's own** feature work, not this campaign.)

---

## 2. Method + the one caveat that shaped everything

**The automation/preview browser cannot measure this feature honestly, in two specific ways** — every result
below was gathered around these:

1. **rAF is throttled to ~1 Hz** whenever frames aren't actively presented (during any wait). Frame-*interval*
   metrics are therefore invalid. We measured **rAF-callback execution duration**, **event-loop lag** (a
   `MessageChannel` ping-pong, throttle-independent), and **Canvas 2D op counts** instead — and forced real
   frames with screenshot bursts.
2. **AudioContext stays suspended** (synthetic input isn't a trusted gesture), so the audio path doesn't run.
   Audio changes were validated by **capturing a real compiled program at the Worker boundary** and asserting
   on it, not by listening. **Live audio testing is Avery's to do.**

Corollary for whoever picks this up: don't trust a "frame rate" number from the headless browser; trust
callback-duration, op-counts, event-loop lag, and captured-data assertions.

---

## 3. Visual findings + fixes

**Bottleneck = main-thread Canvas 2D draw, not the workers.** The workers (web-strand OffscreenCanvas, solver
pool, row compiler, transport clock) are well-offloaded; the cost is the single main-thread rAF loop in
`flight-view.js`.

Profiled (14-core / DPR 2 / 2560×1440 backing store): **~15 ms main-thread work per active-flight frame**
(p50 14.8, max 18 — against a 16.7 ms budget *on a fast machine*), driven by **~10,000 Canvas 2D ops/frame**
(~1,500 `stroke()` + ~1,520 `fill()`, ~2,900 `beginPath`). Event-loop lag was tiny (p50 1.1 ms) — jank is
per-frame paint, not general congestion. **Heap flat ~36 MB, no leak** in pure visual flight (this matters for §5).

Fixes:
- **`74cf29a` core-dot batching** (`flight-view.js` star loop): bucket each star's core by exact colour + a
  1/48 fog-alpha band, flush one `Path2D` fill per bucket after the loop (before the blots, z-order preserved).
  Colour never quantised → dust→sun gradient untouched. Measured: **main-scene draw calls 10k→12/frame.**
- **`74cf29a` DPR cap** (`DPR_CAP` + shared `renderScale`, resize + both `setTransform` sites): clamps the
  backing store so hi-DPI screens don't pay a 9× fill-rate tax. `2` = no change on Retina; a future CPU tier
  lowers it.
- **KEY CORRECTION** discovered by measurement: collapsing draw calls 10k→12 **did not crater frame time**.
  So frame time is NOT dominated by draw *call* overhead — it's spread across `cosmos.tick` (spawn/evict/
  dispatch) + projection (`renderPosCam` over ALL zones, `flight-view.js:1942`) + the per-star JS loop +
  near-star `createRadialGradient` allocations. **Zone COUNT is the master lever** (fewer zones cut per-star
  JS + projection + draw together).
- **`9c2d4dd` `HIL_EVICT` 40→20**: in hilbert mode `HIL_EVICT` does DOUBLE DUTY — it's both `evictRadius`
  (retention → the every-frame projection loop) AND `FOG_FAR = HIL_EVICT·CELL` (draw/JS depth). 40 was a POC
  leftover contradicting its own comment. 20 halves the rear star-wake we fly away from; `HIL_SPAWN` stays 10
  so forward density is unchanged.

---

## 4. Audio findings + fixes (the chord-change freeze)

Confirmed by Avery as chord-change-correlated. The compile **CPU** is already off-thread (`cull2-program-worker.js`
via `ProgramWorkerPool`, which already priority-sorts by distance + dedups). The freeze was on the **result side**,
two independent costs:

1. **Sustained "always busy"** — every landed compile called `markFieldDirty()`, forcing a full-field rebuild
   (loop all placed zones + two `chooseSpatialRows`) the next frame. ~20 audible zones recompiling per chord =
   ~20 back-to-back rebuilds. → **`e007947`**: split the trigger — a landing is now a SOFT trigger
   (`markLandingDirty` + `FIELD_MEMBERSHIP_MIN_INTERVAL_MS = 60`) coalesced to ≤1 rebuild/60 ms; chord/translate/
   spawn/root stay immediate. Program data is applied on landing immediately, so nothing goes stale.
2. **The single big freeze + audio-drop** — structured-clone DESERIALIZATION of one dense program's `events[]`
   (up to `ROW_MAX_COMPOSITE_ONSETS = 20000` × 4 layer-actions), rebuilt synchronously on the main thread at
   message receipt. The dominant cost was the **strings** (`rawFraction`/`fraction`) — ~240k string clones.
   → **`7990416`**: **intern** the action objects. An action is fully determined by (layer, tone) with only a
   few dozen distinct per program; emit ONE shared object per distinct action and structured clone preserves
   the shared reference. Validated on real captured output: **128 slots → 9 objects (14.2×)**, sharing survives
   `structuredClone`, playback fields (`layer`/`rawFraction`/`fraction`/`rawRatio`) byte-identical, `gap` dropped
   (per-occurrence, never read on the main thread, would defeat interning). Player untouched (it treats actions
   as read-only). Chosen over the columnar/typed-array transferable because it captures the dominant win
   (string de-dup) at a fraction of the risk. The transferable remains available if extreme grids still stall.

---

## 5. Memory / audio-death investigation — SCOPED, NOT YET FIXED

Symptom (real session): page → ~2.1 GB, **audio died and needed a full refresh**; happened with audio playing +
many chord changes + a monster bloom + Performance-UI interaction. Pure visual flight is flat ~36 MB (§3) → the
growth is in the **audio path** or **bloom**, not visual/zone churn.

**The structural fault line:** stars/decks/programs are **created on the rAF thread** (`setField`) but
**destroyed ONLY inside the transport tick** (`gridRowPlayer.tick`, reached only from `schedulerTick`). Two
clocks. If the tick ever stops while rAF keeps flying → unbounded leak of stars→decks→program graphs AND dead
audio, together.

Ranked hypotheses (from the audit):
- **H1 (top; explains BOTH symptoms): an unguarded throw in `schedulerTick` stranding `gridRowPlayer.tick`.**
  A deterministic throw in an early phase (sky-walk/bed) skipped destruction on every tick until refresh → leak
  + dead audio, matching the "needed a refresh" signature exactly. **ADDRESSED DEFENSIVELY by `f5ff905`**: each
  phase is now guarded so destruction always runs, and the throw is captured for diagnosis. *This hardens and
  instruments H1 but has not yet confirmed it fires — see §6.*
- **H2 (top for the raw 2.1 GB; audio-independent): monster-grid bloom cloud.** `z._bloom.pts` builds one object
  per tuning system (10⁴–10⁶+ for a true monster), each growing a small Set during web render. Frees only on
  **evict** — a parked, bloomed monster retains all of it. Not exercised by the flat-36 MB probe, so not ruled
  out. `flight-view.js:2276-2283`, streaming `:650-655`.
- **Ruled OUT (usefully):** live audio nodes are **hard-bounded** (caps GATE creation ≤48 lead / ≤90 bed / ≤64
  row; they don't evict) → oscillators can't be the 2.1 GB. Telemetry buffers (fixed 512-ring), pool `byKey`/
  `jobs` maps, `soundedTones`, and rail-view subscriptions are all bounded.

---

## 6. Next thread — start here

1. **Confirm H1 with the new tool.** Fly a real session (audio ON), then read `window.__cosmosHealth()` in
   DevTools: if `throws > 0`, `byPhase` + `lastError` name the exact stranded phase and exception — fix that
   underlying bug (the guard only stops it being *fatal*). Watch **`activeStars`** (= `gridRowPlayer.stars.size`):
   it should hover near active+prewarm and **never climb**; monotonic growth = leak confirmed live.
2. **Confirm H2 with a heap-snapshot diff** (gold standard): snapshot → 10 chord changes + a monster bloom →
   snapshot → sort "objects allocated between" by retained size. If bloom point objects / `_motifKeys` Sets
   dominate, cap/stream/evict-while-parked the cloud. Also watch `bloomCache.size` + total `_bloom.pts` length.
3. **Then fix** whichever is confirmed. If H1 fires: the guard already prevents the death/leak, but resolve the
   root exception. If H2: bound the parked-monster cloud.

Untouched, still open:
- **Rhythm-card open slowdown + card tone-row playback** — a distinct path from the flight scheduler; not
  investigated.
- **CPU low/med/high tier (deferred feature):** design from the profiling — weight toward `FOG_FAR`/LOD +
  `DPR_CAP` (the master levers); `poolSize` barely helps the real bottleneck; **must NOT touch `RICHNESS`**
  (that's the musical-vocabulary axis, deliberately orthogonal). Auto-pick a default from
  `navigator.hardwareConcurrency` (+ DPR as tie-breaker; `deviceMemory` caps at 8 in real Chrome). Lean on the
  existing solve-backpressure as the adaptive layer; static tier is the ceiling/override.
- **WebGL far-frontier dust layer (deferred):** the ~17 M "grid bound" is a SOLVER cap (`grid-core.js`
  MAX_GRID_SHARDS=260 / MAX_GRID_LAYER=3 M), not a draw/Hilbert cap; beyond it zones already render as
  "frontier dust". `backboneHash(grid)` (`spine.js:63`) is a pure golden-ratio function of the index (GPU-
  portable) — BUT float32 destroys the low fractional bits of `grid·φ` past 2²⁴ ≈ 16.7 M, so stream
  CPU-computed f64 positions into a static per-chunk GPU buffer (dust never moves) rather than recomputing in
  a shader. Decouples visible horizon (GPU, ~millions) from solved working set (CPU, thousands).

---

## 7. Gotchas for the next thread

- **Dev-server caching bites the worker.** `python -m http.server` sends no `Cache-Control`, so the browser
  heuristic-caches module imports — including the compile worker's import of `cosmos-grid-audio-core.js`
  (no cache-buster on that import). A worker can run **stale** compiled code after an edit. **Hard-reload /
  clear cache** to pick up changes; verify with a `cache:'no-store'` fetch of the served file if unsure. This
  is why `7990416` couldn't be validated via a live worker run (validated on captured data instead).
- **Can't reproduce 2.1 GB or audio-death in the headless browser** (audio suspended, rAF throttled). Memory
  confirmation is a real-session job for Avery + the `window.__cosmosHealth()` tool.

## 8. Key anchors

- rAF loop / draw: `flight-view.js` `loop()`; all-zones projection `:1942`; star loop + core-dot batch (~`:2158`).
- LOD/DPR knobs: `flight-view.js` `HIL_SPAWN`/`HIL_EVICT`/`DPR_CAP`/`renderScale` (~`:71`), fog tie-in `~:875`.
- Field rebuild + landing coalescing: `flight-view.js` `updateGridRowField` / `markFieldDirty` / `markLandingDirty` (~`:1545`).
- Action interning: `cosmos-grid-audio-core.js` `makeActionInterner` / `compactGridAudioProgram` (~`:94`).
- Scheduler guard + diagnostic: `cosmos-audio.js` `schedulerTick` / `guardPhase` / `window.__cosmosHealth` (~`:1626`).
- Destruction path (create-vs-destroy asymmetry): `spatial-grid-row-player.js` `_destroyDeck`/`_destroyStar` (~`:641`), reachable only from `tick()`.

---

## 9. Selected-rhythm checkpoint — canonical model + live-harmony plot

The rhythm card, tone table/plot, and selected-rhythm audition now share one canonical derivation keyed by
normalized layers. The model retains both identities needed downstream: the raw source ratio/fraction and its
octave-folded tone. This removes the duplicate card + audition solve and lets the rail's **ROW 1/1** policy
exclude only literal `1/1`; octave sources such as `2/1` that fold onto the same pitch remain eligible.

Plot semantics and frame cost changed together:

- Coincident/nested attacks no longer become special white nodes. Layer colour remains the static identity.
- A soft halo in the owning layer's colour means **harmonically live under the current root/chord policy**.
  It follows chord/root changes and also obeys ROW 1/1; white coincidence rings are gone entirely.
- The full plot is rasterized into a backing canvas only when its actual inputs change (selected rhythm,
  dimensions/DPR, visible layers, harmony selection, or ROW 1/1). Normal animation frames copy that bitmap,
  binary-search the current onset, and draw only the playhead/live pulse. The old per-rAF full node walk is gone.
- Harmony is evaluated once per distinct folded tone, then projected over repeated onsets. Representative
  high-range case `[4096,11,3]`: **4,108 onsets, 7 tones**; focused classification benchmark was **6.4× faster**
  than evaluating harmony at every onset. Its 4,084 literal-`1/1` repetitions are suppressed when ROW 1/1 is
  off without suppressing octave-folded sources.

Selected-rhythm audition schedules only that same chord-live set. Out-of-harmony onsets are omitted rather
than quietly played at the former 25% duck level, so the plot and audition now express the same selection.

Live browser smoke pass under concurrent host load: grid 2,640 solved, bloomed, and revealed a 132-onset card;
the inspector and new plot rendered and remained interactive, with no browser warnings/errors. This is useful
integration coverage, not an audio-stutter verdict: automated browser audio/rAF behavior is not representative
enough to replace Avery's real audible stress pass.

Validation: `assert-rhythm-inspector.mjs`, `assert-fullsky.mjs`, `assert-grid-spatial-audio.mjs`, syntax checks,
and `git diff --check` all pass.
