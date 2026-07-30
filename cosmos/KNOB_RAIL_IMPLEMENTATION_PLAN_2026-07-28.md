# Cosmos knob rail + audio-mode consolidation — implementation plan, 2026-07-28

Branch `cosmos-flight-poc`, HEAD `79898f8`. This plan consolidates the audio modes into one
mixable soundscape and replaces the cockpit's settings stack with a horizontal performance rail.
Design decisions below are **locked** (Avery-confirmed); implementation details marked "implementer's
call" are yours. Follow the existing assert-suite discipline: every engine contract in Phase 0 gets a
headless guard before the UI that depends on it.

## Locked decisions

1. **Three gain buses, not two modes.** Ambient bed / spatial culled rows / selected-node audition
   each get an independent gain bus. A BED↔ROWS **MIX** knob crossfades the first two
   (constant-power); the audition bus is independent with its own listen/pin control.
2. **SPEED is denominated in target onsets/sec** (slow→fast, log-scaled). Ticks/sec and
   cycle-seconds both become derived quantities. The tick clamp stays.
3. **DWELL is denominated in fractions of the grid cycle**, with **full exposure as an always-enforced
   floor**. Knob min = floor only (this *is* the current full-quality mode; the checkbox dies).
   Knob max = one full cycle per chord.
4. **The gravity/tuning-strength knob is removed.** `LAMBDA_FIELD` gets frozen at the knee of a
   12-location sweep (Phase 3), not at the max. `setTuningStrength` survives as a debug-only probe.
   → **AMENDED 2026-07-29 (Avery):** frozen **at the max, 8.0** — the bigger voice-leading jumps the ceiling
   buys are wanted, so the sweep was skipped. The knob's removal and the debug-probe survival both stand.
5. **DENSITY = top-N ratio owners, detents 1/2/3.** No "ALL" detent — a genuinely unculled full-row
   mode is a separate later experiment.
6. **ABCD layer toggles drive audition playback with mute semantics** — the composite's gap-derived
   pitches are kept; onsets whose owners are all toggled off are *skipped at schedule time*, never
   removed from `lead.notes` (index stability — see Phase 5).
7. **Modulation stays opt-in** until the settled-while-flying phrase-exhaustion question is resolved.
   → **AMENDED 2026-07-29 (Avery):** default **ON** — "opt-in" now means "switchable in the advanced drawer",
   carrying the `f54198c` lab entry default forward. The phrase-exhaustion question is still open.
8. **Persistence**: musical knob settings persist (localStorage); MIDI-enabled, mute, and transient
   selection state (including ABCD toggles — reset to all-on per selection) do not.
9. **Shipped rail**: `VOLUME · FUNDAMENTAL · DENSITY 1–3 · SPEED · DWELL · RICHNESS · BED/ROWS · SPACE`,
   grouped visually as pitch / time / harmony / texture. Advanced drawer: MIDI out, modulation.
   Dead entirely (absorbed, not moved): fixed ticks/sec slider, scaled-speed checkbox, full-quality
   checkbox, audio-mode select, tuning-strength slider.
10. **Knobs are real accessible inputs**: numeric readout, keyboard adjustment, fine-adjust, reset
    gesture. Replace the hidden double-click-to-exit with an explicit exit control + Escape.
11. **Bounded spaces / placement / master-network interconnection stay URL-gated.** Nothing in this
    plan touches them.

---

## Phase 0 — engine contracts (do these before any UI)

### 0.1 Bus split

Today the lead (audition) path runs `pannerNode → distGainNode → ambientModeGain → muteGainNode`
(`cosmos-audio.js:214`) and the bed also sums into `ambientModeGain` (`:217`, `:220`), while
`setAudioMode` (`:264-267`) ramps that shared gain and toggles `gridRowPlayer.setEnabled(!ambient)`.
That coupling is the *entire* reason node audition is silent in rows mode — `deriveVoice` never
touches cull2, so the audition needs no protection from the culling pipeline, only its own bus.

- Create `bedGain`, `rowsGain`, `auditionGain`, each → `muteGainNode`. Rehome the bed sum and the
  lead's `distGainNode` accordingly. The row player already connects to `muteGainNode` directly
  (`:236`); insert `rowsGain` in that path.
- `setAudioMode` is replaced by `setMix(x)` (0 = bed, 1 = rows), constant-power curve. Keep both
  sides' machinery warm across the whole range: at the rows end, bed *scheduling* continues with gain
  gated (do not drop bed stars as `:264-267` does today); at the bed end, the row compile/prewarm
  pipeline continues with attacks gated. The knob must be responsive in both directions.
- Audition gets `setAuditionListen(on)` / pin, independent of mix.
- Guard: extend `assert-grid-spatial-audio` — with mix at either extreme, an audition lead schedules
  audible notes; moving mix does not change audition or lead-mask state.

### 0.2 Pitch-offset split

`rootDetune` (the modulation bus, threaded into `SpatialGridRowPlayer` and the MIDI bridge at
`cosmos-audio.js:231-236`) becomes one of **two summed offsets**: `totalDetune = fundamentalOffset +
modulationOffset`, separate `ConstantSourceNode`s so one gesture never overwrites the other's
automation. FUNDAMENTAL rides the same portamento law as modulation (glide, not click). The two
current pitch anchors are `ROOT_HZ` (`cosmos-audio.js`) and `CULLED_ROW_FUNDAMENTAL_HZ`
(`spatial-grid-row-player.js:10`); keep `CULLED_ROW_MAX_HZ` derived. **MIDI must reproduce the sum**
— verify the MPE pitch-bend path includes both offsets (guard in `assert-midi-out`).

### 0.3 Chord-clock policy across the mix

The exposure ledger is already mix-wide: rows via `soundedSince` (`cosmos-audio.js:729`), bed via
`bedSoundedDegrees` (`:175`). Codify the policy as a pure exported function so a guard can check it:

- Full exposure is the advance floor at every mix position (this subsumes `holdForFullQuality`).
- Target duration comes from DWELL (Phase 2.2). When no grid cycle exists (`scaledRateFor` → null:
  no rows sounding), DWELL maps to absolute seconds against a nominal fallback cycle (implementer's
  call, ~24s; one constant).
- Escape hatch stays and scales: `CHORD_MAX`-style cap at ~4× the effective target, for degrees the
  local field can't voice or that the player flies away from.
- Guard: new `assert-chord-clock` — floor enforced at both mix extremes; escape fires; advance is
  quantized (see 2.2).

## Phase 1 — parameter state + persistence

One module owning the rail's parameter state: defaults, clamps, curve mappings (log for SPEED /
FUNDAMENTAL), localStorage round-trip on the persisted subset (decision 8), and a change-listener
API the knobs and the engine both subscribe to. Include a schema version key so stale stored state
can be discarded. This is deliberately boring — build it before the knobs so every knob is a thin
binding, not its own state machine.

## Phase 2 — the rail

Build the skinny horizontal bar (bottom edge, translucent over the canvas, collapses to a sliver when
idle). Cockpit (`#lrc-div`) keeps only inspector duties. Controls, in implementation order:

### 2.1 SPEED (target onsets/sec)

```
ticksPerSec = clamp(targetOnsetRate × fieldOnsetTicks, SCALED_RATE_MIN, SCALED_RATE_MAX)
```

`fieldOnsetTicks` (`cosmos-audio.js:180`, the portamento's input — median ticks between composite
onsets across the sounding field) is already computed. Keep the existing 6% re-anchor hysteresis and
the [1, 8000] clamp — monster grids run slightly under target at the cap, accepted. Range ~0.5–16
onsets/s, log. **Calibrate the default so a reference location feels like today's 12s-cycle scaled
mode** (roughly 2–3 onsets/s; do this by ear against a mid-grid neighborhood, then freeze).
Readout shows both: `3.2 notes/s · ~18s cycle`. `scaledRateFor` gains a pure onset-rate analog,
guarded headlessly like the current law.

### 2.2 DWELL (cycle-fraction chord duration)

- Continuous log range ~1/8 cycle → 1 cycle; at knob min the target is 0 and the exposure floor
  governs alone (= today's full-quality mode).
- Advance rule: first quantized boundary after (`elapsed ≥ dwellFrac × currentCycleSeconds` AND
  fully exposed). Quantize to a cycle subdivision (implementer's call; 1/8-cycle grid, in the spirit
  of `ROW_SWITCH_TICKS` deck-swap quantization) so chord changes land on the form.
- Scale `ROOT_RESOLVE_MIN_SECONDS` (29.7, chosen coprime-ish with the old fixed 25.6s window)
  proportionally with the effective chord duration, or long dwells will phase-lock root resolution
  to chord boundaries.
- Note the intended emergent behavior, don't fight it: short dwell in a sparse field stretches to
  the exposure floor — harmonic rhythm breathes with geography.

### 2.3 MIX, FUNDAMENTAL, RICHNESS, SPACE, VOLUME

- MIX / FUNDAMENTAL: thin bindings onto Phase 0 buses.
- RICHNESS: promote the `RICHNESS` const (`cosmos-audio.js`, sweep table in the source comment) to a
  live setter in the `setTuningStrength` pattern. Range 0–0.18 per the table.
- SPACE: one knob driving both reverbs with separately calibrated curves (row wet currently 0.35,
  ambient 0.3) — calibrate so the knob's travel feels continuous across the mix.
- VOLUME: master gain ahead of the limiter; mute stays a button.

### 2.4 Bed robustness (required for MIX to ship)

The bed goes silent for long stretches while flying — probe first (headless, in the style of the
`_seedDeck` probe): likely the coprime `REATTACK_PERIODS` clock never triggers a swell for stars
that *enter* the audible set mid-period while departed stars release. Expected fix: star entry
triggers an immediate swell-in; the period clock only governs re-swells. Verify the bed also
interacts correctly with the exposure floor (it already feeds `bedSoundedDegrees`).

## Phase 3 — freeze LAMBDA_FIELD (headless study, parallelizable with Phase 2)

Sweep λ ∈ {2, 3, 4, 6, 8} over 12 real codex locations (reuse the RICHNESS sweep methodology and
locations). Measure per λ: voice-leading jump distribution, vocabulary reach (qualities visited /33),
cycle-lock incidence. Take the knee — the point where tuning influence stops buying vocabulary and
starts buying VL leaps. Freeze as a const with the sweep table in the comment (house style);
`setTuningStrength` demoted to debug-overlay access only; slider removed.

## Phase 4 — DENSITY (top-N ratio owners, 1–3)

- The three single-winner reductions are running-min loops: `grid-core.js:138-144`
  (`mergeRatioOwners`), `:159-164` (per-group), `:230` (bloom visuals) — mirrored in
  `cosmos-runtime.js:49-52` against `z._ratioOwnerMap`. Retain a **bounded top-3 array per fraction
  from the shard solve onward** (the comparator `compareRatioOwners` is already total); compile only
  the selected prefix N. Change `grid-core` and `cosmos-runtime` in lockstep.
- `aggregateRatioCatalog` (`cull2-grid-core.js:17-38`) hardcodes `rhythmCount: 1` /
  `rhythmKeys: [owner.key]` — needs a real fold. The collision arbitration downstream
  (`cull2-grid-core.js:102-146`) already handles multiple rhythms per tone and retains losers;
  you're feeding an existing resolver, not building one.
- **Density enters the program cache / selection key** (`programSelectionKey`, `requestKey` in
  `flight-view.js:1382` area) so detent changes recompile cleanly.
- Compile cost is the real constraint: each representative is a full `buildCull2Readout` per star and
  `ROW_COMPILE_WORKERS = 1`. Scale workers with N.
- Measure before shipping detents: onset density and voice counts across representative grids at
  N=1/2/3 (activity need not grow monotonically — chord selection and collision arbitration still
  filter).

## Phase 5 — ABCD audition soloing + inspector consolidation

- Unify the two near-duplicate derivations: `deriveVoice` (`cosmos-audio.js:103-119`, discards
  ownership) and `buildRhythmInspectorModel` (`rhythm-inspector-model.js:21-29`, keeps per-onset
  `owners`) share one onset-union derivation that emits `owners` per note.
- Scheduler skips a note whose owners are all hidden (`cockpitVisibleLayers`, `flight-view.js:550`,
  toggles at `:709-710`, plot filter at `:1493` — playback must match the plot exactly). **Skip at
  schedule time; never rebuild `lead.notes`** — `leadMask`, `resyncSchedulePointer`, and the playhead
  are index-based; skipping preserves indices so a mid-cycle toggle causes no resync or mask churn.
- Scope: audition bus only. Rows field and bed ignore ABCD.
- Guard: extend `assert-rhythm-inspector` — plot-visible owners and scheduled onsets agree for every
  toggle combination; indices stable across toggles.
- Inspector consolidation (can trail everything else): merge `#flight-detail` and the cockpit into
  one adaptive inspector (star / node / web / nothing-selected states), per the agreed sketch.

## Sequencing summary

0. Bus split + pitch-offset split + chord-clock policy (with guards) —
1. parameter state/persistence —
2. rail: SPEED → DWELL → MIX/FUNDAMENTAL/RICHNESS/SPACE/VOLUME, bed-robustness probe+fix —
3. λ sweep (parallel with 2) —
4. DENSITY pipeline —
5. ABCD soloing + inspector merge.

Playable UI arrives at the end of Phase 2 without the visual work having dictated any engine
contract; Phases 3–5 land behind it independently.

## Open questions deliberately NOT in scope

- Settled-while-flying / phrase-exhaustion modulation behavior (modulation stays opt-in meanwhile).
- Genuinely unculled full-row mode (future experiment; not the DENSITY knob's job).
- Progression-solver / microtonal-scale-target modes (the parsimony walk is the shipped identity).
- `hilbert.js` header comment still describes BITS=10/1024³ while `BITS = 8` — confirm intent with
  Avery before touching; walls work (`e0103e7`) made the boundary player-visible.

---

## Progress log (as-built) — updated 2026-07-29

Phases 0–1, the engine half of Phase 2, **and the rail-UI skeleton (one live knob)** are **complete and
headless-guarded**. Everything is additive with defaults that reproduce today's sound. Test status:
**16/17 assert suites green** — the sole failure, `assert-rhythm-inspector`, is pre-existing (the `3722ddd`
Home-button rename broke an `index.html` structure regex; unrelated to this work).

### Done

- **0.1 Bus split** ✅ — `bedGain`/`rowsGain`/`auditionGain` → `muteGainNode`; `setMix(x)` constant-power
  crossfade; both engines stay warm across the whole range; audition independent (`setAuditionListen`/pin).
- **0.2 Pitch-offset split** ✅ — `fundamentalOffset` + `modulationOffset` (two `ConstantSourceNode`s in
  cents) summed by a unity `detuneBus` GainNode into every oscillator's `detune`. `setFundamentalOffset`
  glides on modulation's exact portamento law. MIDI spells the SUM via `totalDetuneCentsAt`. Guard extended
  in `assert-midi-out` + `assert-grid-spatial-audio`.
- **0.3 Chord-clock policy** ✅ — the fixed 25.6s window and the full-quality checkbox are **retired**.
  `shouldAdvanceChord({complete, heldSeconds, targetSeconds, maxSeconds, atBoundary})` = unconditional
  exposure FLOOR → DWELL TARGET → 1/8-cycle QUANTIZE, with an ESCAPE cap (4× cycle). All derived from the
  cycle (`effectiveCycleSecondsFor`, `NOMINAL_FALLBACK_CYCLE_SECONDS = 24s` when no rows). `setDwell`/
  `currentDwell` added (default 0). New `assert-chord-clock.mjs`. `setHoldForFullQuality` is now a no-op
  deprecation shim.
- **1 Parameter state + persistence** ✅ — new `cosmos/rail-params.js`: `RailParams` class + `RAIL_PARAMS`
  descriptors + pure curve helpers (`normToValue`/`valueToNorm`, linear/log/detent/bool) + change-listener
  API + versioned localStorage round-trip on the persisted subset. Engine-agnostic. `railParams` singleton
  exported. New `assert-rail-params.mjs`.
- **2 engine bindings (thin-binding half)** ✅ — **SPEED (2.1)**: `onsetRateToTickRate` + `ONSET` speed mode
  + `setTargetOnsetRate` (still dormant; FIXED remains the default until the rail drops the old toggle).
  **RICHNESS/VOLUME/SPACE (2.3)**: `setRichness` (`[0,0.18]`), `setVolume` (master gain inserted
  mute→**masterVolume**→limiter), `setSpace` (one knob → both reverbs, midpoint 0.5 = today's 0.30/0.35;
  added `SpatialGridRowPlayer.setReverbWet`). New `assert-rail-bindings.mjs`.
- **2 rail UI skeleton (one knob)** ✅ — new `cosmos/rail-view.js` owns the rail DOM (dedicated-module
  pattern; sibling of `#lrc-div` inside `#cosmos-view`, mounted by `ensureRail()` from `flight-boot.js`
  after `initAudio()`). One end-to-end knob, **MIX**, as the site's ADSR rotary reused class-for-class
  (`.knob`/`.knob-indicator`; 270° sweep, 0.005/px drag, dblclick=reset, keyboard fine-adjust) but driven
  in normalized `[0,1]` via `railParams.setNorm` so it stays engine-agnostic and respects the Playback
  firewall. Bound **gestures-only (NO `emitNow`)** — persisted values are NOT replayed on entry, so nothing
  repaints today's sound or flips SPEED into ONSET mode before calibration; the old cockpit controls stay
  wired. Panel is a persistent rounded-rectangle in the house `#lrc-div` chrome, bottom-centre. Add a param
  to `RAIL_KNOBS` + its setter to `ENGINE_SETTERS` to grow the rail. New `assert-rail-view.mjs` (17 checks,
  incl. the `emitNow` anti-regression). **Known consequence of gestures-only**: a persisted knob shows its
  stored position on entry while the engine sits at its own default until the knob is first touched —
  resolves when restoration turns on post-calibration.
- **2 rail UI — the four "safe" knobs** ✅ — FUNDAMENTAL (pitch), RICHNESS (harmony), VOLUME + MIX + SPACE
  (texture) rendered as ADSR rotaries, grouped, gestures-only. Rail-view builds knobs generically from
  `RAIL_KNOBS` × `ENGINE_SETTERS`, so each was a declarative add. Verified live (readouts + drag paths, no
  errors); `assert-rail-view` extended (safe-set present, SPEED/DWELL held back, FUNDAMENTAL cents round-trip).

- **2 — the rail is complete + THE OWNERSHIP TRANSFER** ✅ (2026-07-29) — DWELL joins the time group, MUTE is a
  transport button, and MODULATION / MIDI-out live in an `<details>` **advanced drawer**. Every decision-9
  control with an engine setter is now on the rail; only DENSITY is absent (Phase 4 has no setter).
  **Restoration is ON**, but as a repeatable `applyRailToEngine()` that flight-boot calls on EVERY entry —
  *not* `subscribe({emitNow})`. The gotcha: `ensureRail()` is `built`-guarded to the first entry while
  `stopAudio()` destroys the graph on every exit and `initAudio()` rebuilds it at the engine's own defaults
  (`mix = 0`, unity volume), so a one-shot replay would have restored the rail exactly once per page load.
  Verified live: exit → re-enter comes back up at the rail's own MIX/SPEED, not the engine's.
  The **audio lab is demoted to a dev mirror** (unchanged gating: `?audioLab=1` seeds it, Z toggles — the same
  shape as `?skyDebug=1` / C, per Avery). It applies **nothing** at entry and paints itself FROM the engine;
  mute · audio-mode · modulation · MIDI-out write **through `railParams`** so there is exactly one owner,
  while ticks/s · scaled-speed · cycle · λ stay raw **dev probes** that override the rail until the next
  entry. The retired full-quality checkbox is gone from the markup too. `RAIL_SCHEMA_VERSION → 2`, since
  every v1 blob was stored while the lab owned the engine (a v1 `mix: 0` would now come up ambient-only).
  Entry defaults, Avery's calls: **MIX 0.8** (rows-forward, bed underneath) and **MODULATION ON** (carries
  `f54198c` forward; decision 7's "opt-in" now means "switchable in the drawer"). `#lrc-div` keeps inspector
  duties only. Guards: `assert-rail-view` gained two ownership sections (restoration-not-emitNow; the lab
  imports no rail-owned setter, applies nothing at entry, stays dev-gated).
- **3 — λ FROZEN at 8.0, sweep SKIPPED** ✅ (2026-07-29, Avery: *"I prefer if larger jumps are sometimes
  chosen"*). This overrides decision 4's "freeze at the knee, not the max": the knee is where tuning
  influence stops buying vocabulary, and the leaps past it are wanted. `LAMBDA_FIELD_FROZEN = 8.0`;
  `setTuningStrength` survives as the lab's dev probe (which can therefore only explore *downward*, since
  `TUNING_STRENGTH_MAX` is also 8).

### Remaining (needs the browser / Avery's ear)

> The next thread is **knob refinement** (Avery, 2026-07-30). The three items below are the agenda, and all
> three are now easy to work on: the rail owns the engine and persists, so calibration is fly-twist-leave.
> Audio-side churn is out of the way — see `AUDIO_CHURN_INVESTIGATION_2026-07-30.md` for what was fixed and
> for the **T** telemetry table, which is the tool to reach for if a knob ever *sounds* like a performance
> problem rather than a mapping problem.

- **2.1 / 2.2 by ear**: freeze SPEED's default against a mid-grid neighborhood (still the placeholder 2.5
  notes/s) and shape DWELL's log 1/8→1 curve (engine `setDwell` is linear-ready; `RAIL_PARAMS.dwell` is
  `linear` for now). Both are live on the rail and persist, so this is fly-twist-leave. SPACE was confirmed
  continuous enough across the MIX in the safe-knob pass.
- **2.3 RICHNESS is too subtle / not smooth** (Avery, 2026-07-29): hard to tell it's doing anything, and
  extended chords still appear at low/zero RICHNESS. It reads as **~3–4 discrete musical levels, not a
  continuum** — L1 basic triads · L2 standard sevenths · L3 full extensions · (L4 dissonant qualities?).
  Candidate refactor: make RICHNESS a **detent** over those chord-vocabulary tiers rather than the current
  linear `[0,0.18]` sky-reach weight, so the knob steps through triads→7ths→extensions. Deferred behind
  SPEED calibration.
- **2.4 Audio continuity while flying** ✅ **LARGELY RESOLVED 2026-07-30** — "smooth transitions everywhere"
  (Avery). Neither candidate mechanism in the original write-up was the cause. Probing first was right, but
  the decisive evidence was an *input*, not a probe: the symptom appeared under the ARROW keys, which are
  pure rotation and therefore involve no re-solve, no recompile and no field swap at all. What it actually
  was: a transport sharing a thread with the per-frame field rebuild, late notes clamped into a flam instead
  of dropped, and — the big one — the BED's audible set being built from the on-screen projection sorted by
  view depth, so turning your head churned membership and re-struck the chord every frame. Full record in
  `AUDIO_CHURN_INVESTIGATION_2026-07-30.md` (`10feedf` · `2d5ba31` · `88410c1`).
  **The one part of the original diagnosis still standing:** `REATTACK_PERIODS` governs re-swells only, so a
  star entering the audible set mid-period still waits for the clock rather than swelling in immediately.
  Much rarer now that rotation cannot cause an entry — worth an ears-on check before spending anything on it.
- **Large-grid row audio** (surfaced 2026-07-29 while calibrating): huge grids broke row compile two ways,
  both now patched — (i) `compositeTape` used a spread `Math.max` over `gaps`, overflowing the stack at
  large grids ("Maximum call stack size exceeded") so every affected zone's compile threw and went silent
  (fixed: fold, `0e96450`); (ii) even folded, a rhythm with a huge single layer materializes ~layerSum
  event objects → worker OOM/pause that kills audio everywhere (interim cap: `audioCompileEligibility`
  skips owners past `ROW_MAX_COMPOSITE_ONSETS = 20000`, `cec5795`). **Real fix = stream the row compile.**
  Avery's frame: don't compute the whole ~1e6-tick cycle; compute a wall-clock-local window, keyed to the
  transport tick (the player already schedules from `absoluteTick` with cursors).
  **⚠ TWO CORRECTIONS since this was written.** (1) The "vocabulary saturates in a short prefix" hope does
  not survive contact with the invariant: **all polyrhythms are palindromes**, so every novel gap value has
  appeared by the midpoint and there is no test that says "saturated" before `cycle/2` is computed. Nor can
  the inventory be capped — the gaps *are* the pitches, so a cap distorts the tuning system. Reflection is
  what keeps the back half sounding rather than silent. (2) **The urgency dropped** (Avery, 2026-07-30):
  "music wherever you are" turned out to be a churn problem, now fixed, so streaming's justification narrows
  to the OOM alone and the interim cap is a legitimate permanent tier to consider. Decide on a count of how
  many charted grids the cap actually silences. Both corrections are recorded in
  `AUDIO_WORKERS_STREAMING_PLANNING_2026-07-29.md` §5 and `AUDIO_CHURN_INVESTIGATION_2026-07-30.md` §6.
  Also: the `tooLarge` divisor cap (`cull2-grid-core.js:69`) is bypassed by `compileGridAudioProgram`'s
  synthetic `ownerSolve` — revisit if streaming lands.
- **4 DENSITY**, **5 ABCD soloing + inspector merge** — unstarted. (**3 λ freeze** is done — see above; the
  12-location sweep was skipped by decision, not deferred.)

### Implementer's-call decisions already made (veto-able)

- FUNDAMENTAL: engine clamp ±2400¢ (`FUNDAMENTAL_OFFSET_MAX_CENTS`); **knob range ±1200¢** (`RAIL_PARAMS`).
- Chord clock: `NOMINAL_FALLBACK_CYCLE_SECONDS = 24`, `CHORD_QUANTIZE_DIVISIONS = 8`, `CHORD_ESCAPE_MULT = 4`.
- SPEED: `RAIL_PARAMS.speed` default 2.5 notes/s, range 0.5–16, **log** (recalibrate by ear in 2.1).
- VOLUME default 0.85 (rail) / unity (engine); SPACE default 0.5; RICHNESS 0.05. **MIX 0.8 and modulation ON**
  are Avery's calls (2026-07-29), not implementer's — they are the entry sound now that the rail restores.
- `RAIL_SCHEMA_VERSION = 2` (bumped at the ownership transfer), storage key `lrc.cosmos.rail.v1` (a stable
  namespace; the blob's `v` field is the schema gate).
- The advanced drawer is a native `<details>`; MIDI-out is kept OUT of `ENGINE_SETTERS` (async + gesture-gated
  + must roll the param back on failure, so it has its own applier and entry restoration skips it).
