# Work order: MIDI targets in the Composer window (2026-10-26)

**Goal:** Avery can drop a monophonic 12EDO MIDI clip into the Composer window, see where the row can play it, and hear it as a composition: the clip as the lead, everything else composed around it. Served from this worktree (composer-sprint-2, port 8779).

**Background:** `Composer/probe/midi-target/FINDINGS.md` (the probe, 7575460) and its "Avery's rulings". The probe's code (`midi.mjs`, `target.mjs`) is the starting point. Port it, don't import it.

## Decided (Avery)

1. **One tempo per composition, decoupled from the row's cycle.** A target composition's playback tempo is seeded from the clip's own MIDI tempo, and the user tweaks it with the existing live Tempo knob. Its bar count comes from the placement, not from a tempo target. Its beats a bar come from the clip's time signature.
2. **A window placement crops the cycle.** The composition loops on the B bars the clip occupies (of the N-bar cut), from the found phase. Every part is composed inside the window only.
3. **Partial fits show the best reading, with its misses marked.**
4. **Targeting sets its own speed.** See 1.
5. **Expose tone-poor fit:** which of the clip's classes the row can't play.
6. **The tuning lattice may drift from phrase to phrase.**
7. **Note-offs land on row onsets.** "This keeps some ineffable characteristic of the underlying structure." A note's end is an onset of the row (any tone) near its note-off slot's anchor, never just an anchor.
8. **No polyphony yet:** the lead only.

## Proposed (the planner's calls; Avery may overrule)

- **P1. A clip with overlapping notes** is read as its top line (the probe's skyline). The readout says "chords reduced to their top note: n notes dropped". It is not refused.
- **P2. A miss is played by substitution where it can be, and marked either way:**
  - **fringe:** the class sounds in the slot, but outside ±15¢; it plays that onset, marked amber.
  - **shift:** an in-frame onset of the class one slot over; it plays that onset, marked amber.
  - **hard:** silent, marked red.
- **P3. Drift** is per lead phrase (harmony.js `phrasesOf`: as many bars as 32 slots hold).
  - The clip's tonic may move at most **±30¢** (a comma's reach) between adjacent phrases.
  - A phrase drifts only when that gains notes: hits first, then tight hits, then the least total drift.
  - `maxDriftCents` is a knob, and 0 turns drift off.
- **P4. A note-off** is the onset of the row nearest its note-off slot's anchor within ±½ slot.
  - A note whose note-off is the next note's step ends at that note-on (already an onset).
  - With no onset in the window, the next onset after the anchor is used, and the note is marked "late off".
  - The placement's ranking counts note-off hits after note-on hits.
- **P5. The tonic** defaults to the key estimate (Krumhansl), with a 12-way override in the window. The composition's root (for the chords) is the tone of the tonic's class in the first phrase's lattice nearest that lattice. The lead is pinned, so the frame-centre problem doesn't touch it.
- **P6. A target composition takes no lead swaps** (the lead is the clip): the matrix's lead row offers no alternates. Chord swaps, the typed progression and the drums work as usual.
- **P7. The search runs where Compose runs:** in the module worker for rows over `MAIN_THREAD_ONSETS`, on this thread below.
  - Prune it: stop at the smallest N with a full fit; lattices best first.
  - The probe's 4–10 s on the 16k row must come under ~1.5 s.

## Phase A: core (branch `target/core`, off composer-sprint-2)

### A1. `Composer/core/midi.js`

Port `probe/midi-target/midi.mjs` as a pure ES module: `readMidi`, `decodeClip`, `skyline`, `estimateKey`, `pcName`. Keep `writeMidi`; the tests author clips with it.
- `decodeClip` also reports `dropped` (notes the skyline removed, P1) and `tempoBpm`.

### A2. `Composer/core/target.js`

The search, ported from the probe's `target.mjs` and extended:
- **`placeClip(row, clip, opts)`** → `{ placement, alternates, lanes: { missing: [pc] }, ms }`.
  - `placement = { N, B, S, phase: [num, den], window: N > B, phrases: [{ from, bars, psiTone, k, tonicCents }], notes: [{ step, until, midi, pc, on: { node, kind: 'hit' | 'fringe' | 'shift' | 'hard', offSlots, dev }, off: { node, late } }], hits, tight, offHits, missing }`.
  - `alternates` are the next best placements (cap 8) for the window to offer.
- **Drift (P3)** is a Viterbi over phrases:
  - The candidate (N, φ) pairs come from the vote's peaks over all lattices.
  - For each candidate, each phrase gets the best (ψ, k) per lattice.
  - The drift constraint and its cost run on the tonic's realized cents.
- **Note-offs (P4)** are scored after note-ons.
- **The phase** is the centred φ, rounded to a tick and checked against `buildCells` (partitioned, swing ½), as the probe does.
- **`laneReport(row, psiTone)`** → in-frame onsets per class, for "the row can't play" (decided 5).

### A3. Compose target mode

`compose(layers, T, { target: { clip, placement?, tonic?, maxDriftCents? } })`, with `placement` computed when absent.
- **Cells:** cut N bars × S slots from the placement's phase, partitioned, swing ½. Then **cropped** to bars 0..B−1 (a `cropCells` helper in `cells.js`). Its `slotOfNode` is −1 outside the window.
- **The lead is pinned:**
  - **Notes:** the placement's notes (hits plus the P2 substitutes), each note's register chosen to follow the clip's octave contour (register is free).
  - **Durations:** from the note-off onsets (P4), not `articulate`'s legato rule. Add a per-note `endTime` that `articulate`/`partOf` honour when present.
  - **Harmony:** `harmonize` takes `lead: { notes }`. It derives the chords from those notes once: no first mining, no `leadOver`, no settle rounds (`settle.rounds = 0`, recorded as "pinned lead").
- **Everything else** (chords, comp, bass, inner, drums) is built as now, over the cropped cells.
- **Time:**
  - `knobs.cycleSeconds` is the **loop**: the window's span (all of T when N = B).
  - `knobs.rowCycleSeconds` is T, and `knobs.cut = { bars: N }`.
  - A note just before the window's first anchor sounds at the loop's end, as now at the cycle's end.
  - `knobs.tempoBpm` is the spec's natural tempo (60 × B × beats a bar ÷ the loop), and `knobs.beatsPerBar` comes from the clip.
  - `spec.target` holds the clip, the placement, the misses and `tempoBpm` (the clip's).
- **`materialsOf` and `materialsKey`** read `knobs.cut` so a rearrange or drum edit rebuilds the same cropped cells. `drums.js` must run on a window spec.
- **Identity:** with no `target`, Compose is byte-identical (`assert-refactor-identity.mjs` must still pass).

### A4. Tests

`Composer/tests/assert-target.mjs`:
- **The decode:** every probe clip, round-tripped through `writeMidi`/`readMidi`, the skyline's `dropped`, the step-relative tolerance.
- **The search:**
  - its best equals brute force on the small rows (the probe's `verify.mjs`);
  - drift with `maxDriftCents: 0` equals no drift;
  - drift never makes a fit worse;
  - every note-on and note-off is an onset of the row, and every note-off is after its note-on.
- **Compose target mode:**
  - every lead note is the placement's onset;
  - every part's notes lie in the window;
  - the loop is the window's span;
  - `materialsOf` round-trips;
  - drums and a chord swap work on a window spec.
- **Timing:** the 16k row, Frère Jacques, placement under 1.5 s.
- **The full suite:** no other suite changes.

## Phase B: the Composer window (branch `target/ui`, off composer-sprint-2 after A merges)

- **B1. The controller and the store.**
  - A target is part of a composition entry's input (`state.input.target`), so the glyph's recall, undo and the store's LRU carry it.
  - `setTarget(clipBytes | null)` decodes, places (the runner: worker per P7) and composes.
  - Clearing it returns to an ordinary Compose.
  - On a target compose, the playback tempo is seeded from `spec.target.tempoBpm` (decided 1/4), not the spec's.
- **B2. The window.** A "MIDI clip" control in the Composer window: drop a `.mid` or choose a file.
  - **The decode line:** name, grid (time signature, the step, bars), notes, the tonic (the estimate, with the 12-way override, P5) and "n notes dropped" when there were chords.
  - **The fit line:**
    - hits / notes, tight, note-offs;
    - "whole cycle" or "window: bars B of N";
    - the drift, when any;
    - the classes the row can't play (decided 5).
  - **Alternates:** the next placements, to audition, as the matrix auditions alternates.
  - **Clear** returns to an ordinary Compose.
- **B3. The matrix:** the lead row is the clip. Each note carries its kind: hit, amber substitute (fringe or shift), red hard miss as a silent cell, a late-off mark. No lead alternates (P6).
- **B4. The plot overlay and the lens:**
  - the lead's lit nodes are the clip's;
  - a window composition's playhead walks the window on the full-cycle plot (phase + loop share × window share);
  - the glyph's recall brings the target back.
- **B5. Tests:** `assert-page-target.mjs` over the DOM stub: the control, a file decoded and composed, the lines, the marks, clear, recall through the glyph, a window composition's playhead.

## Done when

- Both phases are merged on composer-sprint-2, and every suite passes.
- Avery has the browser checklist below.

## Browser checklist (for Avery, after B)

To be filled in at the end of phase B, from what was built.

## Log

- 2026-10-26: order written; rulings 1–8 from Avery (this session); P1–P7 proposed. Phase A dispatched.
- 2026-10-26: **phase A built** on `target/core` (A1–A4; "MIDI targets (phase A)" in `DESIGN_NOTES.md` has the detail).
  - **Built:** `core/midi.js` (+ `dropped`, `tempoBpm`); `core/target.js` (`placeClip`, `laneReport`, `targetRoot`, `registerOf`, the probe's vote/refine/lattices); `cells.js` `cropCells`; harmony.js' pinned lead (`lead: { notes }`); Compose's `target` option (window cells, pinned lead with `endTime` note-offs, loop knobs, `spec.target`); `partContext` `rowCycleSeconds`; drums on a window; `materialsOf`/`materialsKey` with `knobs.cut`; no lead swap on a target (P6). `tests/assert-target.mjs` (46 checks) + `tests/fixtures/midi-clips.mjs`. Identity holds; every suite passes.
  - **Measured** (`placeClip`, warm, M4 Max): 8:7:6:5 FJ 5 ms / Ode 3 ms; 768:769 553 / 257 ms; 2047:2048 955 / 459 ms; 275:1144:1260:234 41 / 27 ms; **4099:4093:4091:4079 187 / 148 ms** (was 4.4–9.7 s). A whole target compose on the 16k row ~0.3 s. Search best = probe best 108/108; = brute force 28/28; engine = search on all 108.
  - **Calls the order didn't cover (proposed):**
    1. **Drift ranks after hits, before tight hits** (hits, least drift, tight, cost; materialized: hits, least drift, note-off hits, tight, cost). P3's list puts tight hits before drift, which would let a phrase drift for timing alone against its own "drifts only when that gains notes". With this, drift fires only when it gains notes (4 cases in a scan of `rhythms.mjs` × Frère Jacques and Greensleeves; e.g. Greensleeves on 426:317:285, 18 → 19 at 6.4¢).
    2. **Compose's own windows for the parts, not swing ½.** The order says swing ½ for the composition's cells; on the 16k row that put ~250 onsets in a slot and the bass/inner miners took 30 s. The anchors, slots and window are the placement's; the lead is pinned by node and needs no window. Swing ½ stays the search's and the placement's.
    3. **A shift** stays inside the window, lands strictly between its sounding neighbours, and never on a slot another sounding note holds.
    4. **Note-offs run on the loop** (circular, the window's onsets plus slot 0's pre-anchor ones): the last note's "next note" is the first, and an off is clamped to the next note-on (marked late when it had to be).
    5. **Overrides a target sets** (`TARGET_SETS`: bars, slotsPerBar, anchors, phase, root, presence, settlePasses) are refused; a clip over 32 steps a bar is refused as `targetGrid`.
    6. **`leader: 'target'`**; a progression under a clip gives `progression`/`mixed` as usual. **`beatsPerBar`** is the time signature's numerator (6/8 → 6). The drums still cut every bar in 4 beats (3/4 not yet honoured there).
    7. **Chord names stay relative to C** (the root named C, as every composition): naming from the clip's tonic would move the typed progression's reading; left for B or later.
    8. **`spec.target` also carries** `tonic`, `tonicAsked`, `maxDriftCents`, `lanes`, `alternates` (when Compose placed it) and `search: { ms, barCounts, stoppedAt }`; lead notes carry `endTime` and `clipNote`.
    9. **The one clock read in core:** `placeClip`'s `ms` (globalThis.performance), which steers nothing.
  - **Open:** rows with no full fit search every N (~1 s on 2047:2048); the skyline is the probe's (highest note at each start), so a lower note starting under a held higher one still enters the line; nothing seen in a browser yet.
