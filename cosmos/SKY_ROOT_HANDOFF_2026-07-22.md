# Sky Root Solve + Field Normalization — handoff

For an implementer agent. Written 2026-07-22 after a design session with Avery. Read
`FULL_SKY_HANDOFF.md` (the architecture) and `FULL_SKY_STATE_2026-07-21.md` (as-built status +
the location-invariance diagnosis) first. This doc specifies the next two features, both decided
with Avery:

- **A. Normalized field term** — make the chord walk's coverage term actually able to steer the
  progression (it is currently arithmetically powerless; proof below). Small, self-contained.
- **B. Anchor-independent root solve** — stop hard-coding the harmonic frame's root at 1/1.
  Solve for the optimal root *ratio* from the aggregate tone material around the player
  (ProgressionSolver's outer loop, generalized to the full 12-tone chromatic set), keep a ranked
  ladder of runner-up roots for later modulation, and re-anchor the frame when the player settles
  somewhere new. **1/1 stays 220 Hz** — the root is a ratio computed relative to it; nothing about
  the fundamental frequency moves (fundamental portamento drift is a later, separate feature).

## Why (grounded — don't re-derive)

**The hexatonic lock.** From any triad there are exactly two cost-1 voice-leading moves (P and L).
The tabu list always contains the chord the walk just came from — which is always one of those two.
So at every step exactly ONE non-tabu cost-1 move exists, and the field term can only overcome it if
`LAMBDA_FIELD × (coverage gap) > 1`. Live coverage spread (measured, Avery's overlay session
2026-07-21) is ~0.28 across all 24 triads; λ=2.0 ⇒ max field delta ≈ 0.56 < 1. **The walk is
therefore provably field-blind after its first step** and rides one PL hexatonic cycle forever
(`I → i → bVI → bvi → III → iii → I` — exactly what Avery hears everywhere). Feature A fixes the
scaling; the raw signal already exists (live spread 0.28 is 4× what the earlier uniform-weight probe
measured — distance weighting already discriminates).

**Anchor-dependence of the pools.** `poolFromRatios` (grid-core.js) keeps only the min-|dev| tone
per degree *under the 1/1 anchor* and discards the rest. A tone that lost its slot under the old
anchor may be the winner under a new root. Avery's rule: **no tone is ever dropped from contention.**
So the root solve needs anchor-independent per-zone tone lists carried alongside (not instead of)
the folded pools. `deriveScale` ratios already carry `cents` — we just keep them.

## Hard rules (all of `FULL_SKY_HANDOFF.md`'s still stand, plus)

- Branch `cosmos-flight-poc`. **The current working tree (M1–M4 + churn fix + debug overlay) is
  still uncommitted** per `FULL_SKY_STATE_2026-07-21.md`. Commit it FIRST as its own commit(s),
  before touching anything — do not mix this work into that diff.
- Separation rule: no imports from `Core Interface/`, `LRCSearch.js`, `Playback/*`.
  `Playback/AdvancedPlayback/ProgressionSolver.js` is **reference reading only** (its root loop at
  `optimizeRoot`/`solveAll` is the conceptual template) — never import it.
- **Cache-bust gotcha:** `abundance-worker.js` and its `grid-core.js` import are cached hard by
  browsers. Any change to either requires bumping the `?v=` in BOTH the import inside
  `abundance-worker.js` AND the Worker URL in `flight-view.js` (`ensureFlight`, currently `?v=3`).
  Forgetting this = stale worker code and impossible-looking bugs.
- Owner does his own audio/UI verification. Verify with guards (`assert-fullsky.mjs` grows new
  sections) + `node --check` + Node probes on real codex grids. Do not browser-drive to listen.
- **Solve/playback separation (Avery, explicit):** nothing in playback changes until a root
  solution has fully landed. Solves are async and produce a *pending* result; the swap is atomic
  at a chord boundary.
- **Root candidates are canonical reduced-octave scale ratios** (what `deriveScale` emits — the
  tone lists below satisfy this by construction). Never reach back to spaces-plot gap ratios.
- One gain law: both features keep scoring through the existing `gainForDev`. No new thresholds.

## Feature A — normalized field term (`sky-walk.js`)

Restructure `chooseNextChord` to two passes (signature unchanged; callers untouched):

1. Gather the non-tabu candidates with their raw coverages.
2. Normalize **over that candidate set**: with `maxCov`/`minCov`/`spread = maxCov − minCov`,
   `fieldCost(next) = λ · (maxCov − cov(next)) / max(spread, EPS_SPREAD)`;
   `cost = vlParsimony + fieldCost`. Same strict-`<`, lowest-id tie-break.

Properties this buys (turn each into a guard):
- When `spread ≥ EPS_SPREAD`, field costs span the full `[0, λ]` — λ now literally means "perfect
  local alignment is worth λ semitones of extra voice-leading motion." λ > 1 lets the walk leave
  the hexatonic rail (R moves come back; full Tonnetz).
- When `spread < EPS_SPREAD` (deep dust / flat field), the term fades toward 0 and pure parsimony
  (the hexatonic personality) takes back over — the handoff's intended "sparser region → vaguer".
- Worked example with Avery's real overlay numbers (current I, i tabu, range 0.54–0.82):
  iii (cost 1, cov 0.64) = `1 + 0.643λ` vs bVI (cost 2, cov 0.81) = `2 + 0.036λ` → bVI wins for
  λ > 1.65. Keep `LAMBDA_FIELD = 2.0` as the starting default; Avery tunes by ear.

New knobs: `EPS_SPREAD = 0.15` (start). Keep the raw (un-normalized) `coverageByTriad` in
`debugSkyState()` as-is, but add the current candidate costs (parsimony + normalized field) so the
overlay shows *why* the walk chose what it chose.

**Commit the probe this time.** The location-invariance probe has now been rebuilt twice as
throwaway. Add `cosmos/cosmos/probe-geography.mjs` (not a guard — a dev probe): builds N disjoint
real locations (10 codex grids each via `gridShardSolve`), runs 12-step walks, prints trails +
coverage spreads. Success criterion for A: **different locations produce different trails.**

## Feature B — the root solve

### B1. Data plumbing: anchor-independent tone lists

- **Worker** (`grid-core.js` + `abundance-worker.js`): extend `gridShardSolve` to also return
  `tones: [{ f, c }]` — every kept representative's ratios (same `g[0].ratios` pass that feeds
  `poolFromRatios`; still no second enumeration), deduped within the shard by quantized cents
  (0.5¢ bins; keep the first/simplest fraction per bin). `c` = cents in `[0, 1200)`.
- **Client** (`cosmos-runtime.js` `mergeSkyPool` grows or gains a sibling): merge shard tone lists
  into `z.skyTones` (same 0.5¢-bin dedupe across shards). Rides the zone like `z.skyPool`, so
  eviction frees it. The folded `z.skyPool`/`z.skyToneCount` stay — playback still reads pools.
- **Memory bound:** measure before capping. Probe distinct-tone counts on abundant grids
  (1092, 1650, 2640). Expected: a few hundred per zone (bins cap it at 2400 absolute). If a cap
  proves necessary, the criterion must be anchor-free (e.g. simplest fractions) — never dev-based.
- Guard (new M-section in `assert-fullsky.mjs`): folding `tones` at anchor 0 reproduces the
  worker's `pool` exactly on sampled real grids (proves the tone list is a superset that loses
  nothing); dedupe idempotent; all cents in `[0,1200)`; degree-0/1-1 entry present.

### B2. The solve (new pure module `cosmos/sky-root.js`)

No DOM, no audio, no imports beyond `sky-walk.js`'s `gainForDev` + `grid-core.js` helpers.

- **Generalize the fold:** `nearestDegree(cents, anchorCents = 0)` and
  `poolFromTones(tones, anchorCents)` — degree d of a frame anchored at `anchorCents` sits at
  `anchorCents + 100·d (mod 1200)`. Anchor 0 must reproduce today's behavior bit-for-bit (guard).
- **`solveRoots(field, opts)`** where `field = [{ tones, weight }]` (weight = the star's
  audibility/distance weight, same convention as `coverage`):
  - Candidate roots = the distinct tones of the whole field (each candidate is a real ratio —
    Avery's "canonical reduced ratio" requirement is automatic).
  - Score a candidate ρ = mean over the 12 degrees of the weighted per-degree gain, i.e. exactly
    `coverage()`'s double sum but over all 12 degrees of the comb anchored at `cents(ρ)` (this is
    a cross-correlation of the field's cents multiset with a 100¢ comb). Same `gainForDev`, no new
    curve.
  - Returns the **full ranked ladder** `[{ fraction, cents, score, perDegree }]`, sorted by score
    then (ProgressionSolver's pattern) simplest fraction — not just the winner. Avery wants the
    hierarchy kept for later modulation ("exhaust a progression in place → change keys to the
    runner-up root").
  - `opts.degreeTemplate` (default all 12): the required-degree set, so diatonic / harmonic minor /
    other scale templates land later for free (mirrors ProgressionSolver's `requiredSemitones`).
    Build the parameter, ship v1 using only the full chromatic.
- Guards: identity (a field built from exact 12TET tones at anchor 0 → 1/1 wins with score 1);
  shift-invariance (same field uniformly +37¢ → the +37¢ tone wins and scores what 1/1 scored
  before); determinism; ladder sorted; empty field → empty ladder (caller keeps 1/1).

### B3. Integration (`flight-view.js` + `cosmos-audio.js`)

- **Gather set ≠ audible set.** The solve's field is a world-space **radius around the camera
  position** (`ROOT_RADIUS`, weight by the existing distance-gain curve applied to true 3D
  distance) — NOT the view-depth-sorted `proj` set. The root must not change when the player turns
  their head. The bed's audible set stays exactly as it is.
- **Settle trigger:** solve when camera speed stays below `SETTLE_SPEED` for `SETTLE_TICKS`
  (flight-view owns camera state), rate-limited to at most one solve per `ROOT_RESOLVE_MIN_TICKS`.
  Solving is main-thread fine at this cadence (~10⁵–10⁶ `gainForDev` evals, milliseconds,
  occasional) — do NOT solve per frame; keep the door open for a worker op if the probe says
  otherwise.
- **Pending → atomic swap:** solve result parks as pending. At the next chord boundary
  (`stepSkyWalk`), if pending root beats the incumbent's *current* score by `ROOT_HYSTERESIS`
  (relative margin — incumbent keeps its seat on ties), swap: set the sky's
  `skyRoot = { fraction, cents }` (default `{ '1/1', 0 }` — also the fallback whenever the ladder
  is empty). Chord id continues unchanged on the new frame (the walk doesn't reset; the frame
  moved under it — that's the design).
- **Re-anchored playback:** zones lazily cache their re-folded pool
  (`z.skyPoolAt = { rootKey, pool }` via `poolFromTones(z.skyTones, skyRoot.cents)`, invalidated
  by rootKey). `setField` passes the anchored pool, so the walk's `coverage()` and the bed both
  see the new frame with no further changes. **Voice-identity gotcha:** `syncBedDegrees` keys
  voices by degree only, and `createVoice` bakes frequency at birth — after a swap, the same
  degree may map to a different tone. Stamp each voice with its slot's fraction and
  release+recreate on mismatch (normal `BED_RELEASE` fade, never immediate — that fade during a
  root change IS the crossfade, and it should sound like weather, not a cut).
- **Frequencies:** unchanged math — `ROOT_HZ(220) · 2^(slot.cents/1200) · 2^octave`. `slot.cents`
  is absolute vs 1/1; the anchor only changes which tones are *selected* and their dev (gain).
  Nothing retunes. (Fundamental portamento drift = deferred, separate feature.)
- **Overlay + cockpit:** replace `root 220Hz fixed (v1, no drift)` with the live root (fraction,
  cents, effective Hz), show the top-`ROOT_TOP_K` ladder with scores + pending/settle state, and
  show the root fraction beside the Roman-numeral chord in the cockpit readout (Roman numerals are
  now relative to the solved root).
- Guards (headless, mock field): swap only at a chord boundary; hysteresis honored; fallback to
  1/1 on empty field; `bedDegreesFor` correctness under non-zero anchors; voice recreate-on-tone-
  change decision logic (pure part) correct.

## Build order (each: guards green + `node --check`; commit per milestone, Avery reviews between)

- **N0** — commit the existing uncommitted full-sky tree (see hard rules).
- **N1** — Feature A + its guards + `probe-geography.mjs`. Quick win, independently shippable.
- **N2** — B1 tone-list plumbing + payload probe (measure per-zone tone counts; decide cap only
  with data). Bump `?v=` (both places).
- **N3** — B2 `sky-root.js` + guards.
- **N4** — B3 integration + overlay + guards. Full suite green
  (`assert-{cosmos,runtime,hilbert,shard,chordwalk,fullsky}`).

## Knobs (add to the labelled SKY KNOBS block in `cosmos-audio.js` / flight-view)

`EPS_SPREAD` 0.15 · `LAMBDA_FIELD` 2.0 (now in normalized units — "worth λ semitones") ·
`ROOT_RADIUS` (world units; start ≈ the depth of the current 10th-nearest audible star, probe it) ·
`SETTLE_SPEED` / `SETTLE_TICKS` (tune: "player has stopped somewhere") · `ROOT_RESOLVE_MIN_TICKS`
(≥ CHORD_TICKS; pick coprime-ish vs 256) · `ROOT_HYSTERESIS` 0.10 · `ROOT_TOP_K` 8 ·
tone dedupe bin 0.5¢.

## Deferred (do NOT build — context so v1 stays extensible)

- **Fundamental portamento drift** (actually sliding 220 Hz, e.g. by a solved root's JI interval —
  Avery expects the existing retuning-slide feel; comes with the comma-drift leash-vs-wander
  decision). The root solve deliberately does not move any frequency.
- **Modulation on exhaustion**: player stays put + progression exhausts → hop to the ladder's next
  root. The ladder (B2) is kept precisely for this; don't build the hop.
- **Scale templates** (diatonic / harmonic minor / diminished / xenharmonic subsets) via
  `degreeTemplate` — parameter exists after B2; no UI, no selection logic yet.
- **The Schoenbergian mode**: playing exactly the chromatic-subset winners, each emanating from its
  home star at its true position in that star's tone rows — the solve's output doubles as this
  selection function. Big, separate feature; ties into the deferred near-ring rhythm work.
- Chord vocabulary beyond the 24 triads; time-varying λ (tension arcs on a meta-clock).
