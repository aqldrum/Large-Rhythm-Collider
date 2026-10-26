# Chord charts in the typed progression field (order, 2026-10-26)

Avery asked for the chart notation of chunk-tunes (Codex Compiler (dev), `overworld/econ/runtime/chunk-timeline.js`) in the
Composer's typed progression field: several chords to a bar, and repeats. Today the field is one symbol a bar
(`core/chord-symbols.js`, step 4b), and the engine is one chord a bar throughout (harmony, voicing, comping, bass, inner,
frames, modulation, rearrange, the matrix).

## Decided (Avery, 2026-10-26)

1. **A chart sets the bars.** Its played-out bar count (every repeat expanded) is the composition's bar count. It goes
   with a second change: **the Bars knob becomes a free number, like Slots / bar**, not the 1/2/4/8 selector.
2. **Repeats: the same chords, fresh music.** A repeat expands to the played-out chord sequence; each pass lands on its
   own stretch of the row, so the lines are mined anew over the same changes. "The same music replayed" (a looped
   stretch of the row) may later be an arrangement choice, **not built now**: the window is already dense, and Avery is
   holding back on new controls until it is simplified.
3. **Uneven bars: prefer even, else Euclid.** When the row's density allows, the meter takes a slot count every bar's
   chords divide evenly (6 for three chords); otherwise a Euclidean spread inside the bar (3 over 8 is 3 3 2,
   chunk-timeline's rule).

## Proposed (the builder's calls; Avery may overrule)

- **P1 The notation is chunk-timeline's, as is:** `|` bar lines, the chords in a bar share it evenly, `.` holds the
  chord before it one share more (over a bar line too), `%` the bar before again, `×n` (`xn`, `*n`) after a section's last
  bar plays it n times, `‖` (or `||`) ends a section, `|: … :|` twice, `:|×n` n times; a form chart (`A: | C | G |`
  lines, `;` between them, `form: A A B A+2`, `A+2` A moved up two semitones). The parser is ported into
  `core/chart.js` (chunk-timeline's own code, its errors in the Composer's words).
- **P2 A field is a chart when it has a bar line (or names a section),** as chunk-tunes decides. Without one it reads
  exactly as today: one symbol a bar over Compose's own bar count.
- **P3 Auto and free-quality marks keep working inside a chart:** `-`, `_`, `?`, `auto` leave a share to Compose; `D*`
  pins a root and leaves the quality. Only `.` changes meaning inside a chart (a hold, not auto).
- **P4 A held chord over a bar line** becomes the same pin in the next bar (a span never crosses a bar line), shown as
  `.` when the field is written back.
- **P5 Spans.** A chord sounds over a span: `{ bar, from (slot of the cycle), slots }`. A compose input `changes`
  (`[[shares] × bars]`, e.g. `[[1], [1, 1], [2, 1]]`) gives each bar's chord shares; the meter turns them into slots. The
  progression's pins are then one per span. No `changes`, or one share a bar: the engine is byte for byte today's
  (`assert-refactor-identity.mjs`, the frozen fixtures, stays green).
- **P6 Inside a split bar:** each span's chord reads the span's own tones; a lead note is strong on the bar's strong
  beats or on its span's first slot (else the span's first note); the lead's targets and frames are per span; the chord
  voices and comping are cut at the span; the bass is mined over the whole bar with each span's target, opening on the
  first span's root; a modulation may land at a span boundary.
- **P7 The meter for a chart:** bars = the chart's. Slots: the first of 8, 6, 4, 3 (then 12, 16) that every bar's share
  count divides and that the row's density allows (Compose's own sparse rule); none: Compose's own pick, Euclidean.
  A Slots / bar asked by hand is kept, Euclidean where it must be.
- **P8 The Bars knob:** a number, 1 to 64, blank for auto (auto still picks 1, 2, 4 or 8 by tempo). When a chart is
  typed, it shows the chart's count, set by the chart.
- **P9 Live or Compose.** A typed chart whose shape (bars and shares) matches the composed spec's swaps live, as a typed
  chord does today. One whose shape differs (another bar count, a bar split anew) waits for Compose: the entry goes
  dirty and the field says so.
- **P10 Showing it.** The matrix's chord row and the field strip draw a split bar as its spans; the progression
  editor's root selects are one per span; edits and chord swaps are per span (in the one-chord-a-bar case, span = bar,
  as today).

## Phase A: core

- A1 `core/chart.js`: the chunk-timeline parser (P1–P4) → `{ bars, changes, tokens: [{ text, bar, share, hold }] }`.
- A2 `compose.js`: `changes` in the input; the meter (P7); the free bar count; spans through the part builders (P6).
- A3 `harmony.js`, `lines.js`: chords per span; per-slot frames and uneven targets in the miner.
- A4 `chord-symbols.js`: `barMaterials` with spans; `resolveSymbols` over a chart; `pinsToField` writes a chart for split
  bars. `rearrange.js`: a chord swap per span.
- A5 Tests: the parser (chunk-timeline's own cases), the meter, spans in harmony and compose, identity kept.

## Phase B: the window

- The Bars knob (P8), the field reading a chart (P9), the matrix and the strip (P10), the edits per span.

## Also proposed while building (Avery may overrule)

- **P11 A swap writes into the chart** where its chord is written once. A chord a repeat, a `%`, a hold or a form plays
  again can't be changed in one pass only, so the chart is then written out played (repeats unrolled). Undo brings the
  typed chart back.
- **P12 A reshape drops the old shape's edits** (chord and lead edits; the drum grid follows the meter as ever). It is
  not an undo step.
- **P13 A chart with a MIDI target is refused** ("not built yet"): how a clip and a typed progression combine is still
  open (DIRECTIONS.md).
- **P14 Narrow spans hold fewer tones,** so a typed chord falls back (amber) more often in a split bar than across a
  whole bar. The rule is unchanged: all its classes but one in the span's own windows.
- **A `|` now makes a chart** (P2), so `C | G | Am | F` sets 4 bars rather than fitting Compose's own count. A plain
  field separates with spaces or commas, as before.

## Browser checklist (for Avery)

Serve from `.claude/worktrees/composer-sprint-2`. Composer window, 41:42:43 or 119:42:15:8.

1. **Bars knob.** Lines section: Bars is a number box (blank = auto). Type 12 and Compose: 12 bars in the matrix.
   Clear it: back to auto.
2. **A chart.** Type `| C | Am F | G . . C | Dm7 G7 |` in the Typed field, then Enter. The entry goes dirty (Compose
   lights), and the Bars knob greys out, reading "4 · the chart's". Compose.
3. **Split bars in the matrix.** Bar 2's chord cell shows two names with a dashed rule at the half. Bar 3 shows G, and
   C three quarters in. The strip above shows each bar's chords together; amber = a fallback.
4. **Hear it.** Perform. The changes land mid-bar on the chords, comping and bass. Listen to bar 3's late C.
5. **Repeats.** Type `|: C G :|×2 | F . G | C |`, then Compose: 4 bars, the first two the same chords over fresh music.
6. **Sections and forms.** Try `| C | G | ×3 ‖ | Am F | G . |` (8 bars) and
   `A: | C | G | Am | F |; B: |: Dm | G :|×2 ; form: A A+2 B` (12 bars, the second A up a tone).
7. **Inspector.** Click bar 2's chord cell: two sections ("chord 1 of 2", "chord 2 of 2"). Audition an alternate of
   the second chord: only that half changes. Keep: the field text changes that one chord in place.
8. **A repeated chord.** On the `|: C G :|×2` chart, swap bar 1's C: the field is written out played (`| Csus4 G | C G
   | …`). Undo: the repeat comes back.
9. **Live vs Compose.** On the 4-bar chart, change `Dm7` to `Dm`: it applies live (no Compose). Change the shape
   (add a bar): the entry goes dirty.
10. **Plain field still works.** Type `C G Am F` with no bar lines: Compose picks its own bars again.
11. **Harmony section.** The root selects read Bar 1, Bar 2·1, Bar 2·2, …
12. **Odd splits.** On a sparse row (8:7:6:5), a bar of 3 chords spreads as evenly as whole slots allow (Euclid).
    Check that it sounds sensible.

## Log

**2026-10-26, built (one session):** phases A and B. Suites: all 32 green; new `assert-chart.mjs` (63) and
`assert-page-chart.mjs` (13). `assert-refactor-identity` 7/7: every one-chord-a-bar compose is byte for byte as before.
- The chart reader (`core/chart.js`) is chunk-timeline's own code. Every chord keeps its place in the text; a comma
  inside a chart is a space.
- Engine: `harmonize({ spans })`. `lines.js` takes per-slot frames, and targets with `slots`. `compose({ changes })`
  with `chartMeter`. Part builders take a span's range. `rearrange({ span, chord })` rebuilds the bar.
- Trace chord events carry `span`; the alternates index by it.
- Fixed in passing: `compose-runner.js` forwarded no `changes` (both paths; tested).
- Timing: the 16k row with an 8-bar split chart composes in ~0.7 s on the lean table.
- Test edits: two tests typed `|` as a plain separator (now a chart, P2), and one looked up the Bars knob as a select.
- Not done: the lab has no chart UI beyond the shared field logic and the number knob. The Compose animation's chord
  lane shows a split bar's last chord.
