# Step 4: the Composer window rework (work order, 2026-10-25)

This builds `STEP4_RECOMMENDATIONS.md` (read it first: it has the measurements, the dependency graph and the APIs). Avery took the proposed answer on all 8 open questions. They are now **decided**, as below.

Integration branch: `composer-sprint-2` (steps 1–3 at 3c6cb66). Phases branch from it as `step4/<phase>` in their own worktrees `.claude/worktrees/step4-<phase>`. The planner reviews each phase, runs the suites and merges. Workers are background Opus agents. Never `main`, never pushed. Verification is the Node suites; Avery does the browser pass.

## Decisions (Avery, 2026-10-25: "take the proposed answers")

1. **A chord swap keeps the lead.** The lead is not re-mined over the new chord. Its notes off the new chord count as exceptions, and the bar's bass, comping, inner and chord voices follow the chord.
2. **Lead alternates are per phrase:** what the miner already makes (4 bars at S = 8), from the trace's runner-up lines. No per-bar lead mining.
3. **Typed symbols are relative.** C is the composition's base root, as the Composer already names chords. They are not absolute pitch through the fundamental.
4. **An off-frame symbol resolves to the nearest cluster at any offset**, shown amber with its cents. With modulation on, Compose's own modulation rule may retune there. With modulation off, it stays amber and is flagged `offGrid`. It is never silently snapped into the frame.
5. **Edits through a re-compose:**
   - chord edits (swapped or typed) are kept as **pins** (root + quality), and Compose solves around them;
   - lead edits are dropped;
   - a pin whose root tone isn't in the new row is dropped and shown amber.
6. **The drum grid works at slot resolution:** S·m places a bar, with m = 1 unless S < 4 (`beatsOf(S)`). No half-slots.
7. **The prime for the two-level partition is the prime nearest N·S.**
8. **The lanes become the matrix.** There's no separate tab.

Also from the recommendations, taken as written:
- **Pinned for local edits:** the comp layer, `baseHz` and the lead's legato.
- **Fixed during a swap:** `targets.scale`.
- **Chords don't follow a lead swap by default.** "Chords follow" is an option.
- **The inner is re-mined bar-locally,** with boundaries; "smooth the phrase" is optional, in the worker.
- **Edits are live edits:** they don't make the entry dirty, the glyph recalls spec + edits, and each entry has a small undo stack.
- **Drum grid strings:** `x` a stroke, `X` an accent, `.` off. An edit turns the mode to `grid`.

## Phases

| Phase | Branch | Depends on | Edits | Status |
| --- | --- | --- | --- | --- |
| 4a. Core: trace caps → builder refactor (byte-identical) → `rearrange.js` | `step4/core` | — | `core/compose.js`, `core/harmony.js`, `core/lines.js`, `core/trace.js`, new `core/rearrange.js`, `page/trace-frames.js` (slice) | MERGED (578d861..0c63f1e) |
| 4b. Typed progression: `chord-symbols.js`, resolve, `barMaterials`, quality pins | `step4/typed` | — | new `core/chord-symbols.js`, `core/progression.js` | MERGED (6a92539..ac83a05) |
| 4c. Drum grid source, presets ⇄ grid, prime level 1 | `step4/drums` | — | `core/drums.js` | MERGED (83211fc..d8c7886) |
| 4d. Store: `edits`, pins, `drumOptions.grid`, invalidation, undo; the controller merge | `step4/store` | 4a, 4b, 4c merged | `store/`, `perform/composer-controller.js` | waiting |
| 4e. UI: the matrix, then the four inspector contexts ∥ the typed field | `step4/ui` (+ `step4/ui-typed` if split) | 4d merged | `page/composer-tab.*`, `page/tab-controller.js`, `PartitionsUI.js` hosts | waiting |
| 4f. Final merge, suites, browser list | `composer-sprint-2` | all | — | waiting |

4a, 4b and 4c run in parallel: they touch disjoint files.
- 4b must not edit `harmony.js` or `compose.js`. It extends `readProgression` and `chooseChordOnRoot` in `progression.js` only. 4a must not edit `progression.js`.
- If either needs the other's file, it stops and reports. The planner sequences it.

## Phase specs

### 4a. Core (sequential inside the phase)
1. **The trace caps option.** `compose(..., { trace: { caps } })`, defaulting to the recommended `chordCandidates` 12 and `runnersUp` 8. `trace-frames.js` slices back to 6 and 3, so the main-page show and the Cosmos dust are unchanged (test that).
2. **Always request the trace from the controller,** independent of "show the work". The show still obeys the setting.
3. **The builder refactor.**
   - Lift compose.js' part builders into exported per-bar functions: `chordVoicesOfBar`, `compOfBar` (layer given), `bassOfBar` and `innerOf({ from, bars })`, plus harmony.js' `chordRecord`.
   - Compose calls them.
   - **The gate:** a byte-identity test across `rhythms.mjs`, seeds, every override, progressions and every drum mode. The settle baseline and every existing suite stay unchanged.
4. **`core/rearrange.js`.**
   - `rearrange(spec, row, cells, { bar, chord: candidate })` and `rearrange(spec, row, cells, { phrase, line: lineId, chordsFollow })` → `{ parts, drums, chords, changedBars, retunedBars }`.
   - The bar-local inner via a new `rules: { before, after }` in `lines.js`; optional `smoothPhrase`.
   - Report modulation re-pitching as `retunedBars`.
   - **Identity test:** rearranging a bar with its own chord, or a phrase with its own line, gives the spec byte for byte.
   - **Cost test:** a chord swap is ≤ ~20 ms on the 16k row (lean on the main thread).

### 4b. Typed progression
1. **`core/chord-symbols.js`:** a pure port of `ProgressionSolver.parseChordSymbol` (accidentals, suffixes, slash bass) → `{ rootPc, intervals }`. Add a parity test against the site parser over a symbol list.
2. **Resolve per bar** against `rootCandidates`, by decisions 3 and 4:
   - **the root:** the least |dev| in the class, presence breaking ties. It's supported inside the frame, otherwise amber with cents and the modulation rule applies;
   - **the quality:** support by `chooseChordOnRoot`'s every-class-but-one test, giving ✓, a missing class shown amber ("no ♭7"), or a fallback shown amber.
3. **`barMaterials(layers, T, knobs)`:** row + cells for resolving before a compose (~1 ms).
4. **`progression` accepts `[{ ratio, quality } | null]`.**
   - `readProgression` takes the object form, and `chooseChordOnRoot` honors a supported forced quality, otherwise it falls back as today.
   - **Identity:** the existing ratio form behaves exactly as before.
5. **Pure display helpers:** symbol ↔ pin list both ways, so the lab's ratio picks and the field are two views of one list.

### 4c. Drum grid
1. **`arrangeDrums` gains a `grid` source** (`drumOptions.grid`: one string per voice per bar). Each cell lands through the existing `land()`: the nearest onset in the place's window, then one place wider, else silent (reported as a silent cell). Fills and crashes stay options over the grid.
2. **Presets ⇄ grid.** `gridOf(arrangeDrums output)` maps each hit's `pos` to `round(pos·m)`. Grid(preset) must arrange the preset's own hits; test this for every mode and pattern.
3. **The prime partition mode.**
   - **Level 1:** implement `levelOneLights(g, { source: 'prime', p })`: p lights evenly from the downbeat, each on `g.nearest()`. The default p is the prime nearest N·S (decision 7).
   - **Level 2:** cell j covers lights ⌊j·p/P⌋…, and a lit cell strikes its first light. The default selection is `selectLights(P, hits)`, turned to the downbeat; the grid replaces it.
   - Expose the level-1 lights' real times for the UI strip.
4. **Tests:** every grid stroke's tick is a real onset; the silent-cell report; the prime mode's light count and the level-2 mapping; the existing drum outputs unchanged when no grid is given.

### 4d. Store
- **Per entry:** `edits: { chords: { [bar]: { rootTone, quality, from: 'swap' | 'typed' } }, lead: { [phrase]: { lineId, chordsFollow } } }`, plus `drumOptions.grid` and an undo stack.
- **The controller merges** spec + edits (as `currentParts()` merges live edits today). It uses `rearrange` for swaps, and the worker with a per-key row cache for rows too big for the main thread.
- **Invalidation by decision 5:**
  - a re-compose keeps chord pins (sent as `progression` objects) and drops lead edits;
  - pins missing from the new row are dropped and shown amber;
  - edits never make the entry dirty, and the glyph recalls spec + edits.
- **Tests:** recall with edits and no re-solve; undo/redo; pins surviving a seed change; a dropped pin flagged; part strips and the lens showing edited parts.

### 4e. UI (decision 8)
- **The lanes become the matrix.**
  - The six part rows, with one column per bar. Each cell is a mini view (slot dots, the chord name, the drum grid in miniature) with an alternates badge. Lead cells span their phrase.
  - The typed field runs across the top of the Chords row, aligned to the columns, with cents and amber inline.
  - The selected cell lights its notes on the mirrored plot (the overlay's `getSelected` seam).
- **The inspector** follows the selected cell. Part-level sound/legato/level move to a slim header row. The contexts:
  - **Chords:** 12 candidates with support;
  - **Lead:** 8 runner-ups with cost per note, and "chords follow";
  - **Bass, Comping, Inner:** "follows bar k's chord", a re-mine button, and the comp layer pin;
  - **Drums:** the bar's step grid, the presets, and the prime mode with its level-1 strip.
- **Audition:** a first click auditions an alternate live at the next bar boundary; a second click keeps it. Esc reverts the audition. Undo/redo use ⌘Z / ⇧⌘Z inside the window.
- Show "retunes bars k–m" wherever a swap re-pitches later bars.
- **Narrow widths:** the matrix scrolls horizontally, or a bar picker appears.
- The main-page part strips and the lens keep working on edited compositions.

### 4f. Final
Merge, run the full suite, then write a browser list for Avery: swaps (chord, lead, chords-follow), audition/keep/revert, undo, the typed field (supported, amber, off-frame with modulation on and off), the drum grid (edit, preset, prime mode, silent cells), recall through the glyph with edits, and a re-compose keeping chord pins.

## Process
- Every phase commits in logical steps with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `git stash`.
- Full suite from the worktree root, clean = prints nothing (59 suites at 3c6cb66):
  `for t in Composer/tests/assert-*.mjs Cosmos/tests/assert-*.mjs Audio/tests/assert-*.mjs Playback/MIDIOut.test.mjs; do node "$t" >/dev/null 2>&1 || echo FAIL $t; done`
- Each phase adds a DESIGN_NOTES section, with calls marked **proposed** and Avery's decisions above marked **decided**, plus a Log line below.
- Each phase report lists its edits to shared files, for the planner's merges.

## Log
- 2026-10-25: order written; Avery took the proposed answers on all 8 questions.
- 2026-10-25: 4a, 4b and 4c dispatched in parallel (Opus), each in its own worktree off b69a39e.
- 2026-10-25: 4b built on `step4/typed`: `core/chord-symbols.js` (parser parity, tokenizer, `barMaterials`, `resolveSymbols`, symbols ⇄ pins) and quality pins in `core/progression.js`. The ratio form is byte-identical, and `assert-chord-symbols.mjs` is added (60 suites). Quality pins on a root pinned twice with different qualities wait on a one-line harmony.js seam (DESIGN_NOTES "Step 4b"), for after 4a.
- 2026-10-25: 4b merged. Owed after 4a merges: a one-line pin change in harmony.js `chordsFrom` (~line 315), `{ tone: pin, cents: row.toneCents[pin], ...(progression.qualities ? { quality: progression.qualities[k] } : {}) }`, so a root pinned with two qualities honors each bar's quality (byte-identical without quality pins). Open for Avery: flats come back sharp when the field is rewritten from pins (keep the typed text?); show both names after a modulation?
- 2026-10-25: 4c built on `step4/drums`: the `grid` source (`mode: 'grid'`, silent cells), `gridOf` (exact for backbeat, every pattern and prime; `against` onset-exact; `with` 28 % and `partition` 34 % keep their onsets), and `mode: 'prime'` (p nearest N·S, as decided; measured: its level-2 swing is up to a whole slot, and below N·S the downbeat cell goes silent; proposed: p ≈ 4·N·S). Unchanged without a grid (595 hashes). 60 suites clean. DESIGN_NOTES "Step 4c".
- 2026-10-25: 4c merged. FLAGGED for Avery: decision 7 (p = the prime nearest N·S) leaves ~1 light per level-2 cell, so level 2 is nearly the identity. The ⌊j·p/C⌋ cut makes a sawtooth up to a whole slot deep (more polyrhythm than swing), and when p < N·S the downbeat cell goes silent (19 of 28 test meters). Suggested: p ≈ 4·N·S (or at least above N·S), and/or Partitions' own L2 cut. Also: `with`/`partition` perc rows re-land on their own onset only 28–34 % of the time through a grid round trip. 4d/4e must add 'grid' and 'prime' to the controller's drum-mode labels (they are kept out of DRUM_MODES).
- 2026-10-25: 4a (Core) built on `step4/core`: the trace caps option (`trace: { caps }`, ALTERNATE_CAPS 12/8, `capTrace`, the show cut back), the controller always asking for the trace, the builder refactor (byte-identical against a frozen copy, 729 cases), and `core/rearrange.js` (chord swap, lead swap, chords follow, the bar-local inner with `rules: { before, after }`). A chord swap is a 4.9 / 10.9 ms median (lean / full) on the 16k row. 62 suites clean. DESIGN_NOTES "Step 4a: core rearrange".
- 2026-10-25: 4a merged (docs conflicts only). The planner applied 4b's seam in harmony.js (`chordsFrom` passes each bar's own quality), retired the "waits on harmonize" caveat in `describeProgression`, and turned its test into a positive one. 64/0 suites, including the 729-case identity gate (live progression.js and drums.js). Owed: the `against` drum mode re-draws later bars after a swap (52 of 336); seed per bar in drums.js. 4d/4e: add `grid` and `prime` to the controller's drum-mode labels. A rhythm composed with the work hidden now recalls with the short show (the trace is always kept).
