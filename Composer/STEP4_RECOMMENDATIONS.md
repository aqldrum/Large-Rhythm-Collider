# Step 4: the Composer window rework (recommendations, 2026-10-23)

This is written for Avery's ruling and is **not built**. It's grounded in the code at `composer-sprint-2` after step 3: the store (`store/composition-store.js`), the lens and the theater (`page/`), and the core (`core/`). The costs are measured in Node on an M4 Max, on three rows: 8:7:6:5 at 4 s; 945:700:240:192 at 10 s (a tour set, 1,964 onsets); and 4099:4093:4091:4079 at 16 s (16,359 onsets, 4,177 tones).

| per call (ms) | 8:7:6:5 | tour set | 16k row |
|---|---|---|---|
| full Compose (worker table, trace) | 6 | 790 | 1,814 |
| `buildCells` from `spec.knobs` | 0.0 | 0.3 | 0.5 |
| `chooseChord`, one bar (65–312 candidates ranked) | 0.04 | 0.13 | 0.21 |
| bass, one bar (`mineLines`, full table) | 0.1 | 0.6 | 1.4 |
| a lead/inner line, one bar | 0.4 | 6.8 | 11.3 |
| inner, one whole phrase (4 bars × 8 slots) | 1 | 258 | 329 |
| `arrangeDrums(spec)` | 0.05 | 0.11 | 0.18 |
| trace / spec JSON | 16 / 27 KB | 48 / 73 KB | 96 / 143 KB |

## 1. Alternates by bar × part

**What exists.** The trace already carries both kinds of alternate:
- `chord` events: per derivation round and bar, the top `chordCandidates` (6) of 65–325 ranked, each with its root tone and onset, quality, label, violations, held and support;
- `lead` events: per phrase and stage, `runnersUp` (3) of the 22–45 lines the miner tested, with each line's notes (slot, node, octave) in `trace.lines`.

The spec's chords are the `harmony` event's `chosenRound`, so a bar's alternates are that round's `chord` candidates. The lead's alternates are the runner-ups of the mining whose line was kept (`keptId`).

**Cache:**
- **Caps:** `chordCandidates` 12 and `runnersUp` 8, by a new `compose(..., { trace: { caps } })`. `trace-frames.js` slices back to 6 and 3 for the show, so the animation doesn't change.
- **Size:** an estimated +20–40 KB of trace on the 16k row (not measured: the option doesn't exist yet).
- **Always ask for the trace.** Today the controller asks only while "show the work" is on, and alternates must not depend on that setting. TRACE.md measures the trace at under 1 % of Compose.
- **Where:** keep `state.trace` in the store entry as it is.
- **The row:** the worker keeps a per-key row cache for re-mines. The main thread may build a small row itself: measured, 1 ms for the tour set and 16 ms for the 16k row.

**The dependency graph** (read from `compose.js` and `harmony.js`):
- **A chord swap at bar k** changes:
  - k's chord voices (a scan of `inBar[k]`);
  - k's comping strokes, **with the comp layer pinned.** Its choice scores every bar, so letting it move would rewrite the whole comping;
  - k's bass (one-bar `mineLines`);
  - the inner line over k;
  - the drums (`arrangeDrums` from the spec; its `with`/`against` modes read the comping);
  - the exceptions count (the kept lead's strong notes off the new chord).
- **Two hidden couplings:**
  - **The modulation offset walks forward from bar 1.** A candidate whose root retunes moves the `fundamentalRatio` of bars k+1… Those bars' notes stay put, but their hz and folded chord names change. That is a re-pitch, not a re-mine.
  - **`targets.scale`** is the union of all chords' classes. Keep it fixed for a swap: re-mining every line because one bar's class set changed would defeat the point.
- **A lead swap** (a phrase's runner-up) changes:
  - the lead's notes in that phrase;
  - the inner line over the phrase (it avoids the lead's slots and onsets);
  - the exceptions;
  - the drums.
- **What a lead swap must not change:**
  - `baseHz`, which comes from the lead's median pitch: **pin it in the knobs**, or a swap transposes everything;
  - the lead's legato default (median gap): pin it too.
- **The chords don't follow by default** (proposed: the user's pick leads). "Chords follow" is an option: `chooseChord` for the phrase's bars (0.2 ms a bar), then each changed bar as for a chord swap.

**The core API** (a new `core/rearrange.js`, after a refactor):
- Lift compose.js' part builders into exported per-bar functions: `chordVoicesOfBar`, `compOfBar` (layer given), `bassOfBar` and `innerOf({ from, bars })`, plus harmony.js' chord record (`chordRecord(row, pick, offset, …)`). Then Compose and a re-mine are the same code.
- **The identity test:** rearranging bar k with its own chord yields the spec byte for byte.
- `rearrange(spec, row, cells, { bar, chord: candidate })` and `rearrange(spec, row, cells, { phrase, line: lineId, chordsFollow })` → `{ parts, drums, chords, changedBars }`.
- **Inner: bar-local.** Re-mine just bar k, given the notes either side as boundaries: a new `rules: { before, after }` in `lines.js` (interval costs to the neighbours). That costs 0.4–11 ms against 258–329 ms for the whole phrase.
- **Cost of a chord swap with the bar-local inner:** at most ~15 ms on the 16k row. It can run on the main thread for rows of that size, and in the worker beyond. An optional "smooth the phrase" pass in the worker re-mines the whole inner phrase.

**In the store** (per entry):
- `edits: { chords: { [bar]: { rootTone, quality, from: 'swap' | 'typed' } }, lead: { [phrase]: { lineId, chordsFollow } } }`, applied over the spec by the controller, as `currentParts()` merges live part edits today.
- **Recall:** edits are **live edits** (no re-solve, so they don't make the entry dirty), so the glyph recalls spec + edits.
- **Invalidation:**
  - a re-compose (seed, knobs, cycle) drops the lead edits;
  - chord edits carry over as **pins**: a pinned root via `progression`, plus a quality pin (below). Compose then solves around them, and a swap becomes a constraint, not a casualty;
  - a pin whose root tone isn't in the new row is shown amber and dropped.
- **Undo:** a small per-entry stack of edits (they're tiny).

## 2. The typed progression field

`Cmaj7 Am7 Dm7 G7`, one symbol a bar (v1 has one chord a bar).

- **Parse:** a pure `core/chord-symbols.js`, ported from `ProgressionSolver.parseChordSymbol` (accidentals, suffixes, slash bass), with a parity test against the site's parser on a symbol list. The result is `{ rootPc, intervals }`. More symbols than bars: the extras are dropped (amber). Fewer: the rest are auto.
- **Resolve, per bar,** against `rootCandidates(row)` (the ±frame clusters, named with the base root as C, as the Composer names chords):
  - **the root:** the cluster whose class is the symbol's root, with the least |dev|; ties go to presence. Inside ±15¢ it's supported and shown with its cents offset (`D +6.2¢`). Otherwise the nearest cluster at any offset is shown amber (`D −38¢`), and Compose's modulation rule may retune there.
  - **the quality:** the bar's own tones read in that root's frame. `chooseChordOnRoot`'s test applies: every class but at most one sounds. Supported is shown ✓; a missing class is amber ("no ♭7"); otherwise the dyad fallback is amber.
  - **what it needs:** the bar's material before a compose, a new `barMaterials(layers, T, knobs)` (row + cells, ~1 ms).
- **What it compiles to:** the same per-bar pins as chord swaps, i.e. `progression` extended to `[{ ratio, quality } | null]`.
  - `readProgression` accepts the object form.
  - `chooseChordOnRoot` takes a forced quality when it's supported, and falls back as today otherwise.
- **The lab's ratio picks and the field are two views of one pin list:** editing either rewrites the other.
- **Modulation:** symbols are read on the base grid (C = the base root), and a resolved off-grid root goes through harmony.js' own `modulationStep`. With modulation off it stays amber, flagged `offGrid`.

## 3. The drum step grid

- **The grid:** N bars × (S·m) places (`beatsOf(S)`; m = 1 unless S < 4) × 5 voices (kick, snare, hat, perc, cym).
- **Stored** in `drumOptions.grid`: one string a voice a bar (`{ kick: ['x...x...', …] }`, with `x` a stroke, `X` an accent, `.` off). It's compact, diffable, and survives recall.
- **The modes are presets.** Picking backbeat, a pattern, `with` or `against` fills the grid from `arrangeDrums` output: a hit's `pos` maps to place `round(pos·m)`. An edit makes the mode `grid` (custom). `with` strokes sat exactly on note onsets; once edited, they re-land by the rule below (nearly always the same onset).
- **It stays real onsets.** `arrangeDrums` gains a `grid` source that feeds each cell through its existing `land()`: the nearest onset inside the place's window, then one place wider, else silent. A silent cell shows hollow, with "no onset here". Fills and crashes stay options over the grid.
- **The test:** every grid stroke's tick is a plotted onset, and grid(preset) arranges the preset's own hits.
- **The two-level prime partition as a mode,** through the existing seam:
  - **Level 1:** `levelOneLights(g, { source: 'prime', p })`, now throwing. It becomes p lights evenly over the cycle from the downbeat, each `g.nearest()` onset, so they're uneven in time. Proposed p: the prime nearest N·S.
  - **Level 2:** the N × S grid treats those lights as an even grid (Partitions' grid mode). Cell j covers lights ⌊j·p/P⌋…, and a lit cell strikes its first light. The default selection is `selectLights(P, hits)` (Euclid, turned to the downbeat); grid edits replace it.
  - **The UI:** a strip above the step grid shows the p level-1 lights at their real times, with the level-2 cells beneath.

## 4. The layout: a bar × part matrix with a context inspector

Avery's screenshot shows lanes on the left and a sparse inspector at the bottom right. Keep the window frame (`PartitionsUI`'s halves; the upper-right mirrored plot stays) and change two things.
- **Left: the lanes become the matrix.** The six rows stay (Lead, Chords, Comping, Bass, Inner, Drums), with one column a bar (N ≤ 8). Each cell is a mini view of that part in that bar: dots at slot positions, the chord's name, the drum grid in miniature. A badge counts its alternates. Lead cells span their phrase.
  - **The typed progression field** runs across the top of the Chords row, aligned to the columns, with the cents and amber inline.
  - **The selected cell** lights its notes on the mirrored plot (the overlay's `getSelected` seam).
- **Bottom right: the inspector by context.** The part-level controls (sound, legato, level) move to a slim header row, and the cell takes the space:
  - **Chords:** the 12 candidates with support and ✓/amber;
  - **Lead:** the 8 runner-ups with cost a note;
  - **Bass, Comping, Inner:** "follows bar k's chord", a re-mine button, and the layer pin for comping;
  - **Drums:** that bar's step grid, with the presets and the prime mode.
  - Click auditions an alternate live (at the next bar boundary); a second click keeps it.

## Build order

1. **Sequential first:** the trace caps option (+ the trace-frames slice); then the compose.js/harmony.js builder refactor with the byte-identity test; then `rearrange.js` (chord swap, lead swap, the bar-local inner with boundaries).
2. **In parallel with 1** (pure and independent):
   - (a) `chord-symbols.js` + resolve + `barMaterials` + the quality pins in progression.js;
   - (b) the drum `grid` source + presets ⇄ grid + the prime level 1.
3. **After 1–2's APIs settle:** the store (`edits`, pins, `drumOptions.grid`, invalidation, undo) and the controller's merge.
4. **Last:** the UI. The matrix first; then the four inspector contexts and the typed field, in parallel.

## Risks

- **The modulation chain:** a swap can re-pitch every later bar. Show it ("retunes bars 3–4").
- **Comping's global layer, `baseHz` and the lead legato** are all whole-cycle choices. Pin them, or a local edit becomes a global one.
- **Settle vs edits:** a swap is applied after settling, so a later re-compose may settle differently around the pins.
- **Rows near the 1M gate:** re-mines in the worker with a cached row. The main thread can't hold the row.
- **Density:** N = 8 columns on a phone. The matrix needs a horizontal scroll or a bar picker there.
- **The refactor has to keep Compose byte-identical,** or every recall and test baseline drifts.

## Open questions for Avery

1. **A chord swap:** does the lead stay (proposed) or get re-mined over the new chord?
2. **Lead alternates per phrase** (what the miner makes: 4 bars at S = 8), or per bar (a new boundary-aware mining)?
3. **Typed symbols:** relative (C = the composition's root, as the Composer names chords; proposed) or absolute pitch through the fundamental?
4. **An off-frame symbol:** snap to the nearest cluster in amber, or let it modulate?
5. **Edits through a re-compose:** chords kept as pins (proposed), or everything dropped?
6. **The drum grid's resolution:** slots, or half-slots too?
7. **The prime:** the nearest to N·S (proposed), or a pick from the primes in range?
8. **The lanes:** do they become the matrix (proposed), or does the matrix get a tab of its own?
