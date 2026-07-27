# Cosmos Row Audio + Chord Vocabulary — handoff 2026-07-27

Branch `cosmos-flight-poc`. This thread reworked the `culled-grid-rows` audio voice, expanded the
sky-walk chord vocabulary, and added per-rhythm bloom-node orbs. Everything below is committed and every
assertion suite is green. The **first task for the next thread** (7th-chord selection) is scoped in
detail at the end — read that section first; the diagnosis corrects a natural but wrong assumption.

## Commits this thread (newest last)

- `d9e79ce` — Cosmos row audio: short-note reverb voices + expanded chord vocabulary
- `2f3e411` — Cosmos: light bloom nodes for a bloomed grid's sounding rhythms

(HEAD before this thread was `230eda9`. `d9e79ce` also folded in prior uncommitted Sky Root
modulation-policy work — `sky-modulation.js`, `SKY_MODULATION_POLICY_2026-07-24.md`,
`assert-sky-modulation.mjs` — that predated this thread and shared files, so it couldn't be split out.)

## What changed

### 1. Row voice: short notes into a reverb, not legato (`spatial-grid-row-player.js`)
- Replaced sustained legato with a **fixed-gate ADSR** voice; note length is `ROW_GATE`, decoupled from
  onset spacing. All voice/reverb tunables are named constants at the top of the file (`ROW_GATE`,
  `ROW_ATTACK/DECAY/SUSTAIN/PEAK/RELEASE`, `ROW_REVERB_*`, `ROW_WAVEFORM`).
- Added a **per-mode convolution reverb send** (own procedural IR via `makeRowImpulse`, pre-delay,
  wet-side highpass). The rows were previously fully dry — the ambient bed's reverb was never on them.
  The dry/wet balance (`ROW_REVERB_WET`) is now the mode's effective "sustain" control.
- **Silent-hold re-derived per loop**: a tone held across the loop wrap re-articulates once per cycle
  instead of vanishing. The compiler's `repeat-hold` label seeds across the wrap for *legato* sustain;
  under short notes that marked loop-constant layers all-hold → silent. The player now keeps a per-deck
  `lastToneByLayer` and clears it at each loop wrap (`_scheduleDeck`).
- **Fixed a voice-budget leak** that caused "plays for a while then goes silent": self-terminating
  voices now free their `logicalVoiceCount` slot in `onended` (guarded against double-free with
  `_releaseLayer`). This was the actual cause of the total-silence bug, not the hold labeling.
- Row waveform decoupled from the shared ambient constant (`ROW_WAVEFORM`, still `triangle`).

### 2. Chord vocabulary: 24 triads → 396 chords (`sky-walk.js`)
- Ported all **Consonant (11) + Specialized (22)** qualities from the Codex Compiler
  `MasterQualityCatalog.js`, on all 12 roots. Scale modes deferred. (The catalog's `// (18)` label is
  stale — it lists 22; we went by the `tier` field.) `CHORD_QUALITIES`, `QUALITY_COUNT = 33`.
- Export **renamed `TRIADS` → `CHORDS`** (updated in `cosmos-audio.js`, `probe-geography.mjs`,
  `assert-fullsky.mjs`). id scheme `rootSemitone*QUALITY_COUNT + qualityIndex`; major_triad is index 0
  so `CHORDS[0]` is still I major and `START_CHORD_ID` is unchanged.
- `vlParsimony` generalized to **mixed cardinality via minimal voice leading with doubling** (Tymoczko):
  inject the smaller chord's notes onto distinct notes of the larger, each leftover doubles onto its
  nearest neighbor. Reduces exactly to the old min-bijection for triad↔triad (P/L/R structure intact),
  symmetric.
- `coverage` normalized by chord cardinality (mean per-degree gain) — this is central to the 7th-chord
  issue below.

### 3. Bloom-node orbs (`cosmos-grid-audio-core.js`, `spatial-grid-row-player.js`, `flight-view.js`)
- A bloomed grid used to get no orb (the grid-centre aura is suppressed while bloomed). Now each
  **individual rhythm node lights when the rhythm that owns a sounding tone plays.**
- The join is the **canonical rhythm key**, stamped identically by `grid-core` on ratio owners
  (`gridRatioOwnerSolve`, line ~171) and bloom nodes (`gridShardSystems`, line ~231). Verified headless:
  every owner key is a subset of the grid's bloom-node keys.
- Compact `selectedTones` now carry `ownerKey`/`ownerLayers`; the player maps `fraction → ownerKey`,
  stamps voices/attacks, and `visualState()` returns a per-star `sources` array (one entry per owning
  rhythm with a live voice or a *current* attack — lookahead attacks stay dark). `flight-view` draws the
  aura on each bloom node whose `key` matches a source.
- Minor benign edges: while a freshly-clicked bloom's cloud is still streaming (<1s) a sounding grid
  shows no orb; a node hidden by the focused-bloom cardinality band filter also hides its orb.

## Verification

```bash
cd "LRC_Builds/Large Rhythm Collider"
for t in fullsky sky-modulation grid-spatial-audio cull2-audio cosmos runtime shard chordwalk hilbert; do
  node cosmos/cosmos/assert-$t.mjs; done
```
All green. Audio + orbs are only observable with a real (user-gesture-unlocked) AudioContext in-app —
Avery does the eyeball/listen pass; don't drive the preview browser for it.

## NEXT TASK — 7th chords and beyond aren't being selected

**The intuitive diagnosis is wrong.** `vlParsimony` (minimal VL with doubling) is *not* what's keeping
the walk on triads. Evidence (run against `sky-walk.js`):

- From I major, `vlParsimony` makes the maj7 family **cost 1** — the same as P/L: `Imaj7 [0,4,7,11] = 1`,
  `i = 1`, `Isus4 = 1`. So 7ths are already among the cheapest moves.
- With a **flat field** (uniform coverage), the walk really does leave triads:
  `I → i → ImMaj7 → Imaj7 → I → …`. So the vocabulary + VL metric already reach 7ths.
- Higher/other extensions cost more in parsimony (`dom7=2, m7=3, 6=2, add9=2, 9=4, 13=6`), so those need
  a real field pull to ever win — but maj7-family does not.

**The actual blocker is the field term (`coverage` ÷ cardinality) in real fields:**

- `coverage` is the mean gain across a chord's degrees, so a 7th only matches a triad's coverage when
  its *extra* degree is genuinely well-tuned locally. Example, field tuned only on `[0,4,7]`:
  `cov(I)=1.00`, `cov(Imaj7)=0.75`, `cov(I7)=0.75`, `cov(I9)=0.60`, `cov(I13)=0.50`. Lower coverage →
  higher `fieldCost` (λ=`LAMBDA_FIELD` default 2.0, spans `[0,λ]`) → the triad wins.
- Even when a 7th's degree *is* fully supported (so coverage ties at 1.0), the **ascending-id tie-break**
  in `chooseNextChord`/`rankCandidates` picks the lower-id chord, and triads have the lowest quality
  indices (0,1) → triad wins the tie.

So there are **two coupled systems** to get 7ths actually sounding:

1. **The walk must choose a 7th+** (`sky-walk.js`). Levers, roughly in order of leverage:
   - Rework the coverage size-normalization or add an explicit **richness/extension incentive** (a
     negative cost or tier weight for higher cardinality) so a *supported* 7th can beat, not just tie,
     the triad. Note raising λ does the opposite — it strengthens the field term, which penalizes the
     under-supported larger chord more.
   - Change the **tie-break** so it doesn't structurally prefer low cardinality on equal cost+coverage.
   - Higher extensions (9/11/13) also need parsimony help — they're genuinely far from a triad.
2. **The selection must admit owner ratios at the extension degrees** (`cosmos-grid-audio-core.js`
   `ownerChordMatch`, `ROW_CONSONANCE_CENTS = 15`). A 7th chord only *sounds* different from a triad if
   nearby owner ratios land within 15¢ of its extra degree. Check whether real grid pools even populate
   degrees 10/11: e.g. `15/8 = 1088¢` → degree 11, dev −12¢ (inside the 15¢ window ✓), but
   `7/4 = 969¢` → degree 10, dev −31¢ (**outside** ✓✗), `9/5 = 1018¢` → degree 10, dev +18¢ (outside).
   So the 15¢ window and which JI ratios exist strongly gate whether extension degrees are ever
   selectable. Widening `ROW_CONSONANCE_CENTS` is one lever.

**Recommended first move:** instrument before changing anything. At a settled location, log the
per-degree field coverage and `candidateCosts(...)` for the current chord (the debug overlay already has
`?skyDebug=1` with root/coverage/candidate tables). That shows directly whether 7ths are (a) being
out-competed on `fieldCost`, (b) losing only on the tie-break, or (c) never supported because no owner
ratio lands near their extension degree — which points to different fixes (coverage/incentive vs
tie-break vs window/field). Don't touch `vlParsimony` — it's already doing its job.

## Parked / related

- Avery's broader parsimony musing: transposing a deterministic per-root progression on root
  reselection so a root change reads as a real key change rather than a recolor (separate from vocabulary
  — it's about *how* the walk moves after a modulation). See the last messages of this thread.
- Root reselection tuning is correct (root transposes via selection, absolute-JI, `1/1` fixed at the
  fundamental) — do NOT add a root-frequency multiply; it would double-transpose.
- Scale-mode qualities from the catalog are intentionally not ported yet.
