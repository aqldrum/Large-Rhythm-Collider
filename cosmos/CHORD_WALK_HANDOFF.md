# Handoff — Cosmos generative music: **the Chord Walk** (attractor-cycle songs)

## Goal
Give every star a **signature chord progression derived from its own tuning system** — deterministically, so a
star's song is a *fact about the star*. The method is a **parsimonious voice-leading walk**: solve the star's tone
row against the full chromatic to get its best root + semitone→ratio "keyboard" (the *frame*), then greedily walk a
triad vocabulary by smoothest voice leading (measured in the star's actual JI intonation vs the 12TET grid). The
walk is deterministic over a finite set, so it must fall into a loop — **that loop is the star's song**. The song
then tints the Phase 0 instrument: on each chord, in-chord onsets play full, out-of-chord onsets are **ducked, not
muted** (the rhythm is the star's identity — harmony only tints it).

Two parts, in order:
- **Part A — `cosmos/chord-walk.js`** (pure module) + a headless guard. No shared files with Phase 0. Build this first.
- **Part B — audio + cockpit integration** (chord clock, masks, ducking, chord readout). Touches Phase 0 files —
  see the coordination gate below.

---

## Repo, branch, coordination
- **Repo:** `/Users/averylogan/Dev/LRC/LRC_Builds/Large Rhythm Collider/` (git, static GitHub Pages, no bundler).
- **Branch:** `cosmos-flight-poc` (already checked out). Do NOT touch `main`, do not deploy.
- **⚠ Coordination gate:** the branch currently carries **uncommitted Phase 0 work** (`cosmos/cosmos-audio.js` is
  new/untracked; `cosmos/flight-view.js`, `cosmos/flight-boot.js`, `index.html`, `style.css` are modified) that the
  owner is reviewing in another thread. **Part A touches none of those files — always safe.** Part B edits
  `cosmos-audio.js` + `flight-view.js` + `index.html`/`style.css`: only proceed to Part B if the Phase 0 work has
  been **committed** by the time you get there (`git status` — those files clean). If it's still uncommitted, stop
  after Part A and report; do not edit or commit another thread's pending work.
- Files:
  - **New:** `cosmos/chord-walk.js` (pure, no DOM), `cosmos/cosmos/assert-chordwalk.mjs` (guard).
  - **Reused:** `Playback/AdvancedPlayback/ProgressionSolver.js` (pure math — see whitelist note), `cosmos/oracle-core.js`.
  - **One-line engine edit (allowed):** add exports to ProgressionSolver's export object (below).
  - **Part B edits:** `cosmos/cosmos-audio.js`, `cosmos/flight-view.js`, cockpit markup/CSS.

> **Separation rule, amended.** The Phase 0 hard rule (no imports from `Core Interface/`, `Playback/*` AudioEngine/
> Scheduler/Partitions, Tone.js, MIDIOut) still stands — with **one whitelisted exception**:
> `Playback/AdvancedPlayback/ProgressionSolver.js`. It is pure math (no DOM, no engine deps, ported from the econ
> optimizer; sets `window.ProgressionSolver` / `globalThis.ProgressionSolver`, plus `module.exports` under Node).
> It is the framework this feature is explicitly built on.

### Loading ProgressionSolver from an ES module (browser AND Node, same pattern)
```js
// chord-walk.js — side-effect import runs the IIFE, which sets globalThis.ProgressionSolver in both envs
import '../Playback/AdvancedPlayback/ProgressionSolver.js';
const PS = globalThis.ProgressionSolver;
```
(In the browser `window === globalThis`; in Node the IIFE takes the `globalThis` branch. The cosmos guards already
import `.js` ES modules from `.mjs` — mirror their pattern in the new guard, adjusting the relative path.)

### Required export additions (only engine-file change, additive exports ONLY — zero logic edits)
In `ProgressionSolver.js` the export object (~line 410) must also expose the internals this feature composes:
```js
pairDeviation, scoreTonesWithBatch, chordWindowFractions, minCircularDistance, mod1200
```
`pairDeviation(from, to)` is the load-bearing one: `minCircularDistance(actual JI interval, Δsemitone·100)` on
`{semitone, cents}` match objects — the solver's own "deviation of an interval from its 12TET target." Applied
*across* two chords it is exactly the smoothness measure the owner specified. Do not reimplement it.

---

## Background decisions (already made with the owner — treat as fixed)
- The walk is **deterministic** (stable tie-breaks everywhere). Same layers → same song, every run, forever.
- **Tabu list (k=3)** rather than "always take second place" — the tabu length is the minimum-song-length knob.
- **Duck, don't mute** out-of-chord onsets (default −12 dB). The rhythm never changes.
- Triads only in v1 (fixed cardinality 3 dissolves the equal-cardinality problem). Sevenths are deferred.
- Everything octave-folded, circular, exactly like the solver (`mod1200`, `minCircularDistance`).
- Chord labels are **relative roman numerals** (I, bIII, vi…) — the cosmos has no absolute pitch; the frame root
  is a ratio, not a note name.

---

## Part A — `cosmos/chord-walk.js`

One public entry point:

```js
import { deriveScale } from './oracle-core.js';
import '../Playback/AdvancedPlayback/ProgressionSolver.js';

export function solveStarSong(rawLayers, opts = {}) → Song | null
```

Defaults (all overridable via `opts`, so the guard can probe pieces in isolation):
```js
{ alpha: 1,            // semitone-units per circular semitone of voice motion (parsimony term)
  beta: 1/50,          // semitone-units per cent of pairDeviation (JI-coherence term; 50¢ ≈ 1 semitone)
  lambda: 0.01,        // semitone-units per cent of a candidate chord's own avgDeviation (fitness term)
  tabuK: 3, maxSteps: 64,
  playableMaxDev: 35,  // cents — a frame slot tuned worse than this is unplayable
  windowCents: 15 }    // thick-mask window, same default as ProgressionSolver.solve
```

### Step 1 — the chromatic frame (best root for the full chromatic)
```js
const scale = deriveScale(rawLayers);                       // { ratios: [{fraction, ratio, cents}], ... }
const ratios = PS.buildRatioRows(scale.ratios);
let res = PS.optimize({ ratios, requiredSemitones: [0,1,2,3,4,5,6,7,8,9,10,11],
                        topK: 12, beamWidth: 16, resultLimit: 1 });
let relaxed = false;
if (!res.candidates.length) {                               // cardinality < 12 → pigeonhole; allow reuse
  res = PS.optimize({ ...same, allowReuse: true }); relaxed = true;
}
const frame = res.candidates[0];                            // null → return null (no song)
```
`optimize` already searches **every root** and returns the best — "find the best root at the star" costs nothing
extra. The frame is the star's home key: `rootFraction` + a semitone→ratio assignment (`frame.matches`), with
`frame.strength` doubling as the star's tonality stat (surface it in the Song).

**Playable slots** = the semitones whose match `deviation ≤ playableMaxDev`. (Semitone 0 is the root and always has
deviation 0 by construction.)

### Step 2 — chord vocabulary
The 24 major/minor triads over the frame: for root `r ∈ 0..11` and quality maj `{r, r+4, r+7}` / min `{r, r+3, r+7}`
(mod 12), **keep only triads whose 3 semitones are all playable slots.** For each kept chord build:
```js
{ id: r * 2 + (quality === 'min' ? 1 : 0),                  // stable integer id, the universal tie-break
  rootSemitone: r, quality, semitones,                       // sorted
  symbol,                                                    // roman numeral (below)
  ...PS.scoreTonesWithBatch(semitones, frame),               // strength, avgDeviation, matches (must be length 3)
  fractions:      matches.map(m => m.fraction),              // lean mask
  windowFractions: PS.chordWindowFractions(ratios, frame, semitones, windowCents) }  // thick mask
```
Roman numerals: `['I','bII','II','bIII','III','IV','bV','V','bVI','VI','bVII','VII'][r]`, lowercased for minor
(so `r=9` minor → `vi`). Discard any chord whose `matches.length < 3` (a semitone the frame couldn't voice).

### Step 3 — voice-leading cost
For two triads A, B (3 matches each), brute-force the **3! = 6 bijections** (no assignment solver needed) and take
the minimum total move cost:
```js
circ12 = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };
moveCost(mA, mB) = alpha * circ12(mA.semitone, mB.semitone)   // parsimony (12TET skeleton)
                 + beta  * PS.pairDeviation(mA, mB);          // JI coherence of the motion, verbatim reuse
vlCost(A, B) = min over the 6 bijections of Σ moveCost
```
Properties the guard asserts: `vlCost(A, A) === 0`, `vlCost(A, B) === vlCost(B, A)`. The α-term alone reproduces
parsimonious (neo-Riemannian) structure; the β-term is the LRC-specific part — it prefers motions that stay honest
to the 12TET grid *in this star's actual intonation*.

### Step 4 — the walk, the tabu, the attractor
```js
start  = best-strength chord rooted at semitone 0 (tie: lower avgDeviation, then lower id);
         if no playable triad is rooted at 0, the global best-strength chord (same tie-breaks).
tabu   = deque of the last tabuK chord ids, INCLUDING the current one (so no self-repeat, no quick backtrack).
step   = over vocabulary with id ∉ tabu:
           cost(next) = vlCost(current, next) + lambda * next.avgDeviation
         take the argmin; ties broken by ascending id. Push next onto tabu (evict oldest past tabuK).
```
**Cycle detection:** the dynamics' state is `(currentChordId, tabu contents)` — key it as
`[currentId, ...tabuIds].join('|')` and map stateKey → trajectory index. The walk is deterministic over a finite
state set, so a repeat is guaranteed; when stateKey at trajectory index `j` was first seen at index `i`:
- `transient = trajectory[0..i)` (the "intro", may be empty)
- `cycle     = trajectory[i..j)` (the star's song — guaranteed length ≥ tabuK + 1)

Cap at `maxSteps` (64) as a pure safety net; if somehow no repeat by then (shouldn't happen with ≤24 chords),
return the whole trajectory as `cycle` with empty `transient`.

**Degenerate cases (return gracefully, never throw):**
- No frame candidate at all → `null`.
- Vocabulary empty (no playable triad) → `null`. (Caller keeps plain Phase 0 behavior.)
- Vocabulary of 1 → drone: `{ transient: [], cycle: [thatChord] }`.
- Vocabulary ≤ tabuK + 1 → shrink effective k to `vocab.length − 2` (min 0) so the walk can always move.

### Output contract (the `Song`)
```js
{ frame: { rootFraction, rootCents, strength, relaxed, matches, playableSlots },   // the home key
  vocabularySize,
  transient: [chord...],
  cycle:     [chord...],          // chord = the Step-2 object, PLUS:
  // chord.voices = the winning bijection INTO this chord from its predecessor in the walk:
  //   [{ fromFraction, toFraction, semitoneFrom, semitoneTo, centsMove, gridDeviation }]
  // (first chord of the transient has voices: null)
}
```
`fractions`/`windowFractions` per chord are masks over the star's tone row — the exact shape
`ProgressionSolver.analyzePerChord` produces, which is what the audio layer consumes. `voices` exists so a later
renderer can draw or portamento the voice motion; populate it, don't use it yet.

Cost sanity: frame solve is one `optimize` call (12 roots × 12 semitones, beam 16 — same order as the engine's
`solve`); the walk is ≤ 64 steps × ≤ 23 candidates × 6 bijections. Trivially fine on the main thread at click time.

---

## Part B — audio + cockpit integration *(only if Phase 0 is committed — see gate)*

### cosmos-audio.js additions (keep the module dumb — it receives a Song, it never solves)
```js
export function setSong(song)     // null clears. Precomputes per-chord note masks for the CURRENT lead.
export function currentChord()    // → { symbol, cycleIndex } | null   (for the cockpit readout)
```
- **Chord clock, off the existing scheduler cursor.** `CYCLES_PER_CHORD = 2` (const). A note being scheduled for
  transport cycle `n` (the scheduler's `schedCycle` at schedule time) belongs to chord step `s = floor(n / CYCLES_PER_CHORD)`:
  `chord = s < transient.length ? transient[s] : cycle[(s - transient.length) % cycle.length]` — the intro plays
  once, then the song loops, and the mapping is a pure function of the cycle number (resync/tempo-change safe;
  `setTempo` already preserves phase). `currentChord()` computes the same from `audioCtx.currentTime`.
- **Masks.** On `setSong` (and on `setLead`, if a song is active): `noteFractions = lead.notes.map(n =>
  decimalToFraction(n.ratio))` (import from `./oracle-core.js` — it's the same fraction computation `deriveScale`
  used, so equality with `windowFractions` entries is exact). Per chord, `maskSet = new Set(chord.windowFractions)`;
  per note, `inChord = maskSet.has(noteFractions[i])` → one boolean array per chord, computed once.
- **Ducking in `scheduleNote`.** `DUCK = 0.25` (−12 dB): out-of-chord notes play at `NOTE_PEAK * DUCK`. In-chord
  unchanged. **No note is ever skipped** — the onset pattern is sacrosanct. No song → all notes full (Phase 0
  behavior identical).
- `stopAudio()` clears the song + masks like everything else.

### flight-view.js wiring
At the node-click hook where Phase 0 calls `setLead(...)`, add:
```js
setSong(solveStarSong(hover.layers));    // null-safe: no song → plain Phase 0 instrument
```
(`chord-walk.js` imported at top. Clearing the lead should also `setSong(null)`.)

### Cockpit readout (minimal)
One small line in the cockpit body, house-styled (mono numerals, `--hud-*` tokens): the current chord symbol,
updated in the same per-frame path that sweeps the playhead — e.g. `♪ vi` with the song rendered compactly
alongside or on hover/title: `I · vi · bIII · V` with the current one highlighted. Also show `frame.strength` as a
small "tonality" percentage next to the root if trivially easy. Do not build more UI than this — mode knobs,
voice-motion rendering, per-chord colors are later phases. **The owner does their own audio/UI verification** —
don't drive a browser to "hear" it.

---

## Verification

**New guard: `cosmos/cosmos/assert-chordwalk.mjs`** — same shape/console idiom as the sibling `assert-*.mjs` guards
(`check(name, ok, detail)`, exit nonzero on failure). Checks:

1. **Real keys.** Load `cosmos/data/oracle-index.json`, sample ~10 keys spread across the array (parse `"24.23"` →
   `[24, 23]`); assert `deriveScale` gives cardinality 12 for them (it's the 12T codex; skip any that don't).
2. **Determinism.** `solveStarSong` twice per key → deep-equal Songs.
3. **Frame sanity (12T).** 12 playable slots typical; `relaxed === false` when a bijection exists; semitone-0
   deviation === 0; `0 < strength ≤ 1`.
4. **vlCost properties.** Self-cost 0; symmetry; all costs finite and ≥ 0.
5. **P/L/R structural check** (the neo-Riemannian sanity case): with `{ beta: 0, lambda: 0 }` and a fully-playable
   frame, the 3 cheapest moves from any **major** triad `{r, r+4, r+7}` are exactly its Parallel `{r, r+3, r+7}`,
   Relative `{r, r+4, r+9}` (= minor on r+9), and Leittonwechsel `{r−1, r+4, r+7}` (= minor on r+4) — each at α-cost
   exactly 1, and no other maj/min triad at cost ≤ 1. This is a pure-math property of the metric; assert it
   directly on the vocabulary, independent of the walk.
6. **Walk/cycle invariants.** Cycle length ≥ tabuK + 1 (when vocabulary permits); `transient.length + cycle.length
   ≤ maxSteps`; every chord has `matches.length === 3`, non-empty `windowFractions`, and `voices` populated
   (except the first).
7. **Degenerates.** A tiny-cardinality layer set (e.g. `[2, 1]`) → `null`, no throw.

**Existing guards must still pass:** `node assert-{cosmos,runtime,hilbert,shard}.mjs` from `cosmos/cosmos/`.
Also `node --check` the new/edited files. If Part B was built, re-run everything after it too.

## Acceptance criteria
1. `solveStarSong([24, 23])` (and the sampled codex keys) returns a deterministic Song: home root + roman-numeral
   chord loop, every chord carrying ratio masks over that star's own tone row.
2. The new guard passes all checks above; the 4 existing cosmos guards still pass; ProgressionSolver.js diff is
   export-object-only.
3. *(Part B, if gated open)* Clicking a bloom node makes the Phase 0 melody play **through its song**: in-chord
   onsets full, out-of-chord ducked −12 dB, chords advancing every 2 transport cycles, intro once then loop; the
   cockpit shows the live chord symbol. No lead/no song → identical to Phase 0. Exit still kills all audio.
4. No new imports from the engine beyond the whitelisted ProgressionSolver. Nothing committed on `main`.

---

## Deferred / roadmap (context only — build NONE of it)
- **Global coprime meta-clocks** on site-time (tension envelope, root drift, mode drift with coprime periods) —
  the walk's `lambda`/target-tension term becomes time-dependent; the Song becomes a longer orbit. The owner is
  actively designing this; keep `opts` pluggable but do not add time inputs now.
- **Ambient bed** (Phase 1 of the Phase 0 roadmap): nearby stars' downbeats voiced *in the lead's current chord* —
  the masks are already per-chord, so this composes.
- **Light-cone delay**: distant stars play the song `dist/c` chord-steps in the past (automatic canon).
- Sevenths / mixed-cardinality chords (aggregate-pairs measure), per-star root transposition, voice-motion
  portamento rendering, solver-event chimes, MIDI-in snap-to-star.
The through-line stands: **one spatial sequencer + swappable selection policies.** The chord walk is the first
harmonic policy.
