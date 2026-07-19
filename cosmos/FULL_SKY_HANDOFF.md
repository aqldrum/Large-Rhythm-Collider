# The Full Sky — global-frame generative music (per-node → whole-sky)

Handoff for an implementer. Written 2026-07-19 after a planning/audit session with Avery. Read
`GENERATIVE_MUSIC_STATE_2026-07-16.md` first for the as-built state of Phase 0 + the Chord Walk;
this doc **supersedes the per-node direction** described there. The Chord Walk itself
(`chord-walk.js`) is NOT deleted — it's retired from the flight path and parked for a future
main-page "auto-progression" feature. Do not modify it.

## The redesign in one paragraph

The thing we built had the wrong focus and scope. A "star" is not one bloomed node (one tuning
system) — a star is an **entire grid zone**, and its tonal material is the **aggregate pool of
ratios across all tuning systems hosted at that grid**. And harmony is not per-star — there is
**one global harmonic frame for the whole sky**: a single 12TET grid anchored at the 1/1 = 220Hz
that every system already shares (`ROOT_HZ`, and every derived scale contains 1/1). One key, no
drift, v1. A single slow chord progression walks that frame; every nearby star sounds only the
tones from its pool that sit near the current chord's degrees (out-of-chord = **totally silent**,
not ducked — this is the ambient bed, not the lead). Cross-star consonance is then true by
construction, and the ±cents deviations of real JI tones stacking on the same degree are the
ethereal shimmer, not a bug. Goal: **drop into the cosmos and be surrounded by pleasant, calm,
spatialized music with zero interaction and zero knobs.**

## Why (empirical, from real data — don't re-litigate without new data)

Node probes run 2026-07-19 (sampled 150 codex keys + 40 realistic flight grids):

1. **Per-star chord walks starve.** 52% of 12T codex keys get no song at the 35¢ default; of the
   rest, 42% have cycle length 1 (a single held chord). The voice-leading math was fine — real
   single systems just rarely contain several well-tuned triads.
2. **Per-star frames cannot be layered.** Only 12/72 songful stars root their local frame at 1/1;
   pairwise local-grid misalignment is median 23¢. Multi-star sound under per-star frames is sour
   by construction.
3. **The global frame works.** Anchored at the shared 1/1=220Hz: 150/150 codex keys have ≥3 tones
   within 35¢ of the global grid (median 9/12 degrees covered). Dev sensitivity: 20¢ → median 7
   tones; 15¢ → 4; 10¢ → collapse. The useful zone is ~20–45¢, handled by a gain *law*, not a
   threshold (below).
4. **Grid aggregation is generous and nearly free.** Abundant grids become harmonically complete
   (grid 1092: 67 systems → 12/12 degrees at 35¢ vs median 5/12 for its single systems; 1650
   likewise). Sparse grids (semiprimes etc.) cover only 1–5 degrees even aggregated — **that is
   fine and intended**: dust contributes accents, suns carry harmony; abundance now maps to
   harmonic richness exactly as it already maps to size/brightness. Full-grid aggregation cost
   ≤10ms for everything under the existing monster gate — and in production it costs ~nothing
   because the ratios are already computed during abundance solves (see M1).

## Hard rules (unchanged + new)

- **Separation rule stands:** no imports from `Core Interface/`, `LRCSearch.js`, `Playback/*`,
  Tone.js, MIDIOut. The new sky module must be pure and dependency-free — it does **not** need
  the `ProgressionSolver` whitelist at all (on an exact 12TET frame, chord-tone `pairDeviation`
  is degenerate; the walk reduces to pure voice-leading parsimony + a field term).
- **Branch:** `cosmos-flight-poc`. The universal-clock tick-rate rework should already be
  committed by the time you start (another agent was tasked with it); if `git status` still shows
  it uncommitted in `cosmos-audio.js`/`flight-view.js`/`index.html`, commit it first as its own
  commit before touching anything.
- **`grid` (LCM) vs `notes.length` (onset count):** all user-facing timing derives from onset
  counts or tick counts, never raw LCM (this bit once; see the state doc).
- **Owner does his own audio/UI verification.** Verify with guards + `node --check` + targeted
  Node probes. Do not browser-drive to "hear" it.
- Avery's explicit calls from the planning session: **(a)** stop gating sound on a click — the bed
  plays as soon as the cosmos is entered and audio is unlocked; **(b)** ambient out-of-chord tones
  are silent, not ducked; **(c)** one key first, drift later; **(d)** no standalone test page —
  build straight into the flight canvas.

## Architecture

### The global frame
- Anchor: degree 0 = 1/1 = 220Hz. Degrees d ∈ [0,12) at d·100 cents (mod 1200). Octave shifts
  preserve degree, so register spreading is consonance-safe.
- No per-star roots, no drift, no mode logic in v1. All of that layers on later as slow
  transformations of this ONE frame (meta-clocks roadmap).

### The degree pool (per grid) — new data, piggybacked
For each solved zone, a 12-slot pool: `pool[d] = { fraction, cents, dev }` — the grid's
best-tuned tone for degree d (min |dev|, dev = min circular distance from d·100), or null; plus
`toneCount[d]` (how many distinct pool tones sit within 45¢ of d — chorus depth, kept for later
even if v1 only sounds the best). Notes:
- Built **inside the worker during the abundance solve it already runs.** `grid-core.js`'s
  `shardGroups` already calls `deriveScale` per valid layer set; one representative per ratioSet
  group (they share ratios) folds its `ratios[].cents` into a per-shard 12-slot pool. Extend the
  `shard` op reply (`abundance-worker.js`) to carry `{ pool, toneCount }` alongside the kept
  count. Payload ≤ 12 tiny entries. **Do not add a second enumeration pass or a new op family.**
- Main thread merges shard pools into the zone (per degree keep min |dev|, sum toneCount), stored
  on the zone object (like `z._bloom`, so eviction cleans it up free). A star becomes audible as
  soon as its FIRST shard pool lands — progressive, no waiting for full solve.
- Include 1/1 itself (cents 0, dev 0, degree 0) — `deriveScale` deletes 2/1 but 1/1 is present
  via the fundamental gap; assert it anyway.
- Monsters / unsolvable / tooLarge zones simply never get pools → silent. Honest.

### The gain law (replaces all playability thresholds in the bed)
One pure function: `gainForDev(dev)` — full at 0¢, ~half-power around 20¢, effectively 0 by 45¢
(suggest `cos²(π·dev/90)` clamped at 45¢; a Gaussian σ≈18¢ is equally fine — pick one, export it,
guard its shape: monotone decreasing, g(0)=1, g(45)≈0). Every sounded bed tone is scaled by it.
This is why there is no `playableMaxDev` knob in the sky path — and the future "intensity" slider
is literally flattening this curve (at fully flat, the raw tone rows return). Design for that by
making the curve a parameter of the module, but ship v1 with it fixed.

### The sky walk (one global progression, online)
New pure module `cosmos/sky-walk.js`:
- Vocabulary: the 24 maj/min triads on the global frame (always available — the frame IS 12TET).
  Reuse the triad tables / `circ12` / min-over-6-bijections parsimony idea from `chord-walk.js`,
  but re-implement locally (~30 lines, pure); do not import chord-walk or ProgressionSolver.
- **Online walk, not a precomputed cycle** (the field changes as you fly): at each chord boundary,
  `chooseNextChord(currentId, tabu, fieldCoverage)` = argmin over non-tabu triads of
  `vlParsimony(current, next) + LAMBDA_FIELD · (1 − coverage(next))`, deterministic tie-break by
  triad id. Tabu k=3 (FIFO). `coverage(next)` ∈ [0,1]: over the audible star set, the
  audibility-weighted mean of `gainForDev(star.pool[degree].dev)` across the triad's 3 degrees
  (star weight = its current distance-gain; missing degree contributes 0). This is what gives
  space harmonic geography — flying into a new region bends the progression toward what the local
  field tunes well. No star is ever required to voice a full chord; the field does.
- Chord boundary: every `CHORD_TICKS` on the universal tick clock (default 256 ticks ≈ 25.6s at
  the default 10 ticks/s; knob). Chord index = pure function of the absolute tick count, same
  resync-safe pattern as `chordIndexForCycle`.
- In deep dust (nothing covers much of anything) the walk still moves — coverage just
  discriminates weakly and parsimony dominates. Sparser region → sparser, vaguer music. Correct.

### The bed (rendering the field)
`cosmos-audio.js` grows from one lead to a voice pool:
- **Audible set:** the nearest `AUDIBLE_N` (default 10) zones with non-empty pools, by view depth
  from the per-frame `proj` map in `flight-view.js` (which already has screen x/y + depth for
  every live zone). New per-frame API `setField([{id, pan, gain, octave, cutoff}])` for the bed
  (existing `setSpatial` stays lead-only). Reuse the existing pan/`distGain`/`distOctave` math.
- **What a bed star plays:** the current chord's degrees that its pool covers — for each of the
  triad's 3 degrees with a pool entry, sound that entry's true JI cents (NOT the 12TET pitch),
  scaled by `gainForDev`. Degrees it can't cover are skipped — silence, no substitution, no duck.
- **Envelope/timbre — this is half the product:** long attacks (~1–2s) and releases (~2–3s), sine
  or triangle, per-star lowpass (`BiquadFilter`) whose cutoff closes with distance, and a shared
  reverb send: `ConvolverNode` with a procedurally generated impulse (exponentially decaying noise
  burst, ~3–5s — self-contained, no assets, respects the separation rule), wet ~0.3. Register:
  spread the field across ~3–4 octaves by distance via the octave field (degree-preserving).
- **Re-articulation:** on every chord change (swell from current level, don't hard-retrigger), and
  between changes each star re-swells on its own deterministic period —
  `REATTACK_PERIODS[hash(grid) % n]` ticks (default set `{45, 56, 64, 81, 100}`, mutually
  near-coprime) — so the sky breathes as a slow polyrhythm instead of one synchronized pad.
  This is the v1 stand-in for real per-star rhythm; masked onset-arpeggios for the near ring are
  deferred (see below).
- **Caps:** bed oscillator budget (suggest `MAX_BED_OSC` ≈ 30, ≤3 tones/star × 10 stars) alongside
  the existing `MAX_LIVE_OSC` for the lead.
- **No click gating:** bed starts on cosmos entry (existing `flight-boot.js` gesture unlock).
  The M-mute toggle must mute everything.

### The lead (clicked node) — minimal change in v1
Keep the Phase 0 behavior (full tone row arpeggio, spatialized), with two changes:
- Its chord mask now comes from the **global** current chord (match each onset's tone against the
  chord degrees via the same `gainForDev`-style proximity — or a fixed ~35¢ window; either is
  fine for the lead since it keeps the −12dB duck rather than silence: the clicked star's rhythm
  stays sacrosanct, the sky only tints it).
- `solveStarSong` is no longer called from the click path; the cockpit chord readout shows the
  global walk's current chord instead of a per-star song strip.
- Avery's future direction (not v1): clicking a node "focuses the tonality" — e.g. the walk's
  coverage term becomes dominated by the focused star, bending the sky toward it. Design the
  coverage function so per-star weights are an input (it already is, via audibility weights) and
  this lands later for free.

## Build order (each milestone: guards green + `node --check` before moving on)

- **M1 — pool plumbing.** `grid-core.js`: per-shard pool extraction (a small pure helper +
  fold into the shard result). `abundance-worker.js`: extend `shard` reply. `flight-view.js` /
  zone: merge + store. New guard `cosmos/cosmos/assert-fullsky.mjs` section: for sampled real
  grids, worker-path pool ≡ pool recomputed brute-force from `gridShardSystems` union; degree-0
  entry exists with dev 0; payload shape stable.
- **M2 — `sky-walk.js`.** Pure module: triad tables, `vlParsimony`, `gainForDev`,
  `chooseNextChord`, chord-clock helper. Guard: gain-law shape; walk determinism given a fixed
  field; walk always moves (never repeats current); tabu respected; P/L cheapest from any triad
  under zero field term (the known-correct neo-Riemannian fact — note R is cost 2, NOT 1; this
  was already corrected once, keep the guard honest); coverage responds monotonically to a star
  gaining a degree.
- **M3 — the bed.** `cosmos-audio.js`: voice pool, `setField`, reverb/filter graph, re-attack
  scheduling on the tick clock; `flight-view.js`: audible-set selection from `proj`, per-frame
  `setField`, chord boundary driving, un-gate on entry. Guard: headless scheduling math (which
  tones would sound for a mock field + chord across tick ranges — mask-silence correctness,
  budget caps, re-attack periods deterministic per grid).
- **M4 — lead integration + cockpit.** Global mask for the lead, drop `solveStarSong` from the
  click path, readout shows global chord. Guard: lead mask agreement with the global chord;
  existing 5 guards (`assert-{cosmos,runtime,hilbert,shard,chordwalk}`) all still green —
  chord-walk's guard keeps passing untouched since the module is parked, not removed.

Commit per milestone with Avery's review between (house pattern: leave iterative work
uncommitted only within a session; each landed milestone should be a clean commit).

## Knobs (consolidate in one labelled block, like FLIGHT/LOD KNOBS)

`AUDIBLE_N` 10 · `CHORD_TICKS` 256 · `TABU_K` 3 · `LAMBDA_FIELD` (start 2.0 — field term should
be able to overrule a cost-1 parsimony move, tune by ear) · gain-law ceiling 45¢ ·
`REATTACK_PERIODS` {45,56,64,81,100} · bed ATTACK/RELEASE ~1.5s/2.5s · reverb wet 0.3 ·
`MAX_BED_OSC` 30 · octave spread by distance (reuse `distOctave`).

## Deferred (do NOT build now — context so v1 stays extensible)

- Root/mode **drift** via coprime meta-clocks on site-time (the ONE frame slowly transforms; the
  walk's field/tension terms become time-dependent). Avery is actively designing this.
- **Intensity slider** = flattening the gain-law curve (+ raising duck floor, + more audible
  stars). Everything should route through the one law so this stays a one-parameter feature.
- **Near-ring rhythm:** nearest 1–3 stars play masked onset arpeggios (a representative system's
  `deriveVoice` rhythm, in-chord onsets only) over the pad bed — restores the "rhythm plays its
  own tuning" DNA at close range.
- **Node-click tonality focus** (see lead section). **Chorus stacking** of a degree's multiple
  pool variants. **Per-star octave roots on global degrees** (bass motion without breaking the
  frame). Light-cone canon. Main-page auto-progression from `chord-walk.js` (separate feature,
  separate session).
