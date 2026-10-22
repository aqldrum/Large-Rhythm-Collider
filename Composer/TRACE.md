# The compose trace (`composer-trace-v1`)

The contract between Compose and the renderers that animate it: the main page's Linear Plot, and Cosmos's onset dust. Built on the night of 2026-10-22 (sprint). The code is `core/trace.js`; the tests are `tests/assert-trace.mjs`. The shape is proposed, not ruled.

The trace is one ordered list of **untimed** decisions, in plain JSON, plus two lookup tables. A renderer decides how long each decision is shown. `traceTimeline` (at the end) gives it a brisk default.

## Getting it

```js
const spec = compose(layers, cycleSeconds, { trace: true });   // spec.trace
// in a worker: postMessage({ id, layers, cycleSeconds, options: { trace: true } })  ← { ok, spec } with spec.trace
const { trace, ...plain } = spec;                              // to keep it apart from the spec
```

- **Off by default.** With the trace off, `spec` has no `trace` key and is byte-identical to the spec from before the trace existed. Off, nothing in the recorder runs; on the 16,359-onset row, compose times are the same before and after.
- **It observes, never steers.** With the trace on, the spec without `trace` is byte-identical to the spec with it off. The recorder never draws from the seed and never writes into what it's shown. `assert-trace.mjs` checks this on 89 composes.
- **Plain JSON.** No typed arrays, `Infinity` or `undefined`, so it survives `structuredClone`, `postMessage` and `JSON.stringify` as it is.
- **A refusal** (`spec.refused`) carries a trace with a single `refused` event: `{ kind: 'refused', reason, detail }`.

## Top level

```js
{
  version: 'composer-trace-v1',
  layers: [a, b, c, d],          // as given (0 = absent)
  grid,                          // the row's grid: lcm of the layers, ticks per cycle
  onsets,                        // the row's onset count
  cycleSeconds,
  phase: [num, den],             // the composition's downbeat, as a share of the cycle
  caps: { ... },                 // the caps this trace was made with (below)
  nodes: { [node]: { tick, ratio, cents, layers, strikes } },
  lines: { [id]: { id, type, band, motion, contour, from, bars, notes: [{ slot, node, octave }] } },
  events: [ { kind, ... }, ... ],
  stats: { events, nodes, lines },
}
```

## Refs: from an event to the plot

**Onsets are referred to by `node`, their index in the row.** That's the row of `core/row.js`: every composite onset in tick order, the same row Compose builds. Every `node` anywhere in the trace (an event, a candidate, a line note, a drum hit, a root's `samples`) has an entry in `trace.nodes`:

| field | meaning |
| --- | --- |
| `tick` | where it sounds, in grid ticks from the cycle's start (an integer) |
| `ratio` | its tone, the exact fraction in [1/1, 2/1) (the row's own; the site spells some as a nearest fraction ≤ 1000) |
| `cents` | that tone in cents above 1/1, to 0.001 |
| `layers` | the layers striking there, e.g. `'AC'` |
| `strikes` | how many layers that is |

So a renderer needs nothing but the trace to place an onset:

- **x on the cycle:** `tick / grid`, in [0, 1).
- **time in the composition:** `((tick / grid − phase[0] / phase[1]) mod 1) × cycleSeconds`. This is the expression Compose times every note by. Bar 1's downbeat is 0, and a note in bar 1's first window that falls just before the downbeat sounds at the cycle's end.
- **pitch:** `cents + 1200 × octave` above 1/1, where a note carries its `octave` (the register Compose chose). Hz, if wanted, is in the spec's notes.

A renderer holding the rhythm (the Linear Plot, a Cosmos rhythm) can also map `node` straight to its own onset list. It's the same composite in tick order, so the ticks match exactly. To see *every* onset of a tone (not only the ones the trace names), build the row with `buildRow(layers)` from `core/row.js` and filter on `row.tone`.

**Tones** appear as `{ tone, ratio, cents }`. `tone` is the row's tone index (tones sorted by cents); `ratio` and `cents` are as above.

**Lines** (a lead, bass or inner line Compose mined) are referred to by `id` (`cl1:…`). `trace.lines[id]` holds each one once:

| field | meaning |
| --- | --- |
| `type` | `'lead'` or `'bass'` (inner voices are lead-type lines) |
| `band` | density: `'sparse'`, `'mid'` or `'dense'` |
| `motion` | `'stepwise'`, `'mixed'`, `'wide'` or null |
| `contour` | `'rise'`, `'fall'`, `'arch'`, `'valley'` or `'wave'` |
| `from`, `bars` | the bars it spans (`from` is 0-based) |
| `notes` | `[{ slot, node, octave }]`, where `slot` is the cell index over the whole cycle (bar × S + beat) |

The line's cost isn't stored in the table, because the same line costs differently under different chords. Each event that tests a line carries its `perNote` there.

**Bars, slots and phrases** are 0-based everywhere. A *phrase* is as many bars as 32 slots hold (harmony.js `phrasesOf`). With 8 slots a bar, that's 4 bars, so 8 bars are 2 phrases.

## Events, in pipeline order

The order is fixed (and checked):

```
row, root, meter, phase, cells, [progression],
lead (pass1) × phrases, chord (round 0) × bars, lead (pass2) × phrases,
( settle (round i), chord (round i) × bars, [lead (settle, round i) × phrases if the chords changed] ) × rounds,
harmony, part × 5 (lead, chords, comp, bass, inner), [drums], done
```

At most 3 settle rounds (`settlePasses`, default 3). Round counts and changed bars agree with `spec.stats.settle`.

### `row`: the row was built

`{ onsets, tones, grid, cycleSeconds, longest, layers: [{ layer: 'A', value }] }`. Layer v strikes v times a cycle, every `grid / v` ticks.

### `root`: the frame and the root

```js
{ frameCentsEachSide, presence: 'cluster' | 'exact', asked, pick /* tone */, need, rung, pool, eligible,
  candidates: [{ tone, ratio, cents, presence, frameOnsets, onsets, node, samples: [node], ranked? }] }
```

- **How the pick is made.** Compose ranks the tones (by presence, their ±frame cluster under `'cluster'`) by how many onsets their frame holds (`frameOnsets`), then by `presence`, then by their own `onsets`. Only candidates heard at least `need` times are eligible. `rung` says which threshold was used: 0 for max(2, 1 % of the onsets), 1 for half the most heard, 2 for any.
- **`candidates`:** the best first, capped. With no root asked, the first is `pick` and the rest are the runners-up (the rejects).
- **`pool` and `eligible`:** how many were ranked before and after the threshold.
- **`node`:** where the tone first sounds.
- **`samples`:** up to 12 onsets of the candidate's cluster (its own tone under `'exact'`), spread evenly through the row. Light those up to show "how often this root is heard".
- **An asked root** that isn't in the ranked list is appended with `ranked: false`.

### `meter`: bars, slots and tempo

```js
{ asked: { bars, slotsPerBar }, tempoRange: [90, 130], candidates: [{ bars, tempoBpm, inRange }],
  slotCandidates: [{ slotsPerBar, onsetsPerSlot }], bars, slotsPerBar, P, tempoBpm, onsetsPerSlot, notes: [why] }
```

`candidates` are N = 1, 2, 4, 8 with their tempo. `slotCandidates` are S = 8, 6, 4, 3 at the chosen N. Compose wants about 3 onsets a slot. `notes` are its reasons, in words.

### `phase`: the downbeat

`{ asked, candidates: [{ phase, tick, node }], pick, phase, tick, node }`: the root's first downbeats (up to 3), the one the seed picked (`pick`, its index), and its onset. Bar 1 starts at `node`. An asked phase has no candidates, and its `node` is null if it isn't an onset.

### `cells`: anchors and windows

```js
{ anchors: 'partitioned' | 'even', bars, slotsPerBar, P, swing, pulses: { G, R, delta, subdivide } | null,
  slots: [{ slot, bar, beat, tick, reach: [before, after], onsets, tones, node }] }
```

- **Slot geometry:** each slot's anchor is at `tick`, and its window runs from `tick − reach[0]` to `tick + reach[1]` (ticks; it may wrap the cycle).
- **Contents:** the window holds `onsets` onsets of `tones` distinct tones, and `node` is the one nearest the anchor.
- **Partitioned anchors** cut the grid into pulses of G or G ± 1 ticks, as Partitions cuts a block.

### `progression`: a targeted progression (only when one is given)

```js
{ leader: 'lead' | 'progression' | 'mixed', targeted, asked: [ratio | null], notes: [why],
  bars: [{ bar, auto: true } | { bar, auto: false, tone, ratio, cents, node }] }
```

These are the pinned bars as read against the row. `node` is where the pinned tone first sounds. A ratio that isn't a tone of the row reads as auto, and `notes` says so.

### `lead`: one phrase's lead, mined

```js
{ stage: 'pass1' | 'pass2' | 'settle', round, phrase, from, bars, skipped: null | 'pinned',
  mined: { id, perNote } | null, runnersUp: [{ id, perNote }], tested,
  held: { id, from, perNote, fits } | null, kept: 'mined' | 'held' | null, keptId }
```

- **`pass1`** (round 0) is the rooted lead with no harmony. `mined` is the cheapest line per note of the `tested` lines. The next ones, up to 3, are `runnersUp`, "tested and rejected", each with its cost. A phrase whose bars are all pinned skips this pass (`skipped: 'pinned'`).
- **`pass2`** (round 0, over the round-0 chords) and **`settle`** (round i) mine again over the new chords and compare the result with the line held so far (`held`). The held line is re-scored on the new chords (`perNote`; `fits: false` means it breaks a rule there and can't be kept). The cheaper per note is kept: `kept: 'mined'` means the lead changed, `'held'` means it stayed. `keptId` is the line that plays on, and `held.from` names the pass it came from (`'first'`, `'second'`, `'round1'`, …).

### `chord`: one bar's chord, derived

```js
{ stage: 'chords' | 'settle', round, bar, pinned, empty,
  pick: { root: { tone, ratio, cents, node }, name, quality, intervals, pcs, violations, held, support },
  pickIndex, candidates: [{ root: { tone, ratio, cents, node }, quality, label, violations, held, support, voiceLeading }],
  tested, offsetCents, retune: { cents, rawCents, fundamentalRatio } | null, offGrid,
  fallback?, sounded?, missing?, unsupported?, changed? }
```

- **Rounds.** Round 0 is derived from pass 1's lead; round i (a settle round) from the lead round i − 1 kept.
- **Candidates.** `tested` (root, quality) pairs were ranked. The best, up to 6, are `candidates`. They're ranked by fewest strong lead notes the chord doesn't hold (`violations`), then most lead notes held (`held`), then `support` (the bar's own tones on the chord), then the least `voiceLeading` from the chord before. `pickIndex` is the pick's place among them: 0 for an auto bar. `label` names a candidate on the bar's incoming grid. The pick's `name` is final, after any retune.
- **`retune`** is a modulation at this bar: the fundamental is retuned by `rawCents` from this bar on (`cents` is the folded name). `offsetCents` is the bar's offset after it.
- **Pinned bars** (a targeted progression) keep the asked root and choose only the quality, among those the bar supports. `unsupported` lists the qualities rejected for lacking classes in the bar, each with its `missing` intervals. If none is supported, `fallback` names the dyad or root-alone it played instead. `sounded` is `'exact'`, `'cluster'` or `'absent'`: how much of the root the bar itself sounds.
- **`empty`:** a bar whose windows hold no tone takes its neighbour's chord, with no candidates.
- **`changed`** (settle rounds only) says whether the bar's chord differs from the round before.

### `settle`: a settle round opens

`{ round, changedBars: [bar], outcome: 'changed' | 'converged' | 'repeats', repeats?, leadChangedPhrases: [phrase] }`. The header comes before that round's chord events:

- **`'changed'`:** some bars moved, so the lead is mined again (the lead events follow).
- **`'converged'`:** nothing moved, and settling stops.
- **`'repeats'`:** the chords equal an earlier round's (`repeats`), and settling stops. The best round of the cycle is kept, as `harmony.chosenRound`.

`leadChangedPhrases` are the phrases whose lead was replaced that round.

### `harmony`: the final chords and lead

```js
{ cap, rounds, converged, oscillated, cycle, chosenRound, exceptions,
  lead: { phrases: [id], kept: [pass] }, chords: [{ bar, name, quality, root, offsetCents, fundamentalRatio, exceptions }],
  modulations: [{ bar, cents, rawCents, fundamentalRatio }] }
```

The chord events of round `chosenRound` are these chords. The lead events of that round (pass 2 for round 0) kept these lines, and the lines' notes are the lead part.

### `part`: an arranged part

`{ part, sound, count, truncated, notes: [{ node, bar, slot, octave, voice? }], ... }`. The notes are the spec's notes for that part, in time order, up to 256. Each part also carries what chose it:

| part | extra fields | what it shows |
| --- | --- | --- |
| `lead` | `phrases: [id]` | the kept lines |
| `chords` | (`voice` on each note) | one voice a chord class, root first |
| `comp` | `layer, value, score, asked, candidates: [{ layer, value, score }]` | the layer whose strikes make the best claves on the chord tones, and every layer's score |
| `bass` | `bars: [{ bar, line, rootOnly, opensOnRoot }]` | the bass line mined bar by bar, or the root onset alone |
| `inner` | `phrases: [{ from, bars, line }]` | the inner line per phrase (null where none was mined) |

### `drums`: the percussion (absent with `drums: false`)

```js
{ mode, enabled, beats: [slot positions of beats 1–4], downbeatLayers: [{ layer, value, pulse }],
  partition: { layer, value, from, hits, candidates } | null,
  bars: [{ bar, mode, fill, crash }], count, truncated,
  hits: [{ voice, bar, slot, pos, tick, node, velocity, snap }] }
```

- **Modes:** the mode a bar (backbeat, `with`, `against`, `partition` or a pattern).
- **`downbeatLayers`:** the layers striking the composition's downbeat (the phase onset). The partition line is drawn from one of them.
- **Hits:** the strokes in time order, up to 512, each on its onset (`node` is never null). `voice` is `kick`, `snare`, `hat`, `perc` or `cym`. `snap` says how each landed: `'slot'` or `'wide'` (the onset nearest its place), `'note'` (a part's note) or `'layer'` (the partition layer).

### `done`

`{ leader, tempoBpm, baseHz, notes: { part: count }, drums }`.

## Caps

`TRACE_CAPS` in `core/trace.js`; each trace repeats the caps it was made with in `trace.caps`.

| cap | default | what |
| --- | --- | --- |
| `rootCandidates` | 8 | root candidates, the pick first |
| `rootSamples` | 12 | onsets sampled from each root candidate's cluster |
| `runnersUp` | 3 | lines below the chosen one, per lead event |
| `chordCandidates` | 6 | (root, quality) candidates per chord event |
| `partNotes` | 256 | notes per part event (`truncated` counts the rest) |
| `drumHits` | 512 | strokes in the drums event (`truncated` counts the rest) |

Every other list is bounded by the meter. A cycle has at most 8 bars × 8 slots, 2 phrases at 8 slots a bar, 4 settle rounds' worth of chords and 13 qualities.

**Measured on the 16,359-onset row** (4099:4093:4091:4079, 16 s, 8 × 8, best of interleaved runs):

| table | JSON | events | onset refs | lines | compose off | compose on |
| --- | --- | --- | --- | --- | --- | --- |
| lean | 109 KB | 45 | 323 | 30 | 660 ms | 664 ms (+0.7 %) |
| full (worker) | 96 KB | 34 | 323 | 26 | 1,722 ms | 1,724 ms (+0.1 %) |

Against the core from before the trace (d9f2f85), trace-off compose is unchanged: medians of 662 vs 655 ms lean and 1,753 vs 1,732 ms full.

## Pacing: `traceTimeline`

```js
import { traceTimeline } from './core/trace.js';
const tl = traceTimeline(spec.trace, { pace = 1, seconds = null, budgets = {} });
// → { version, pace, seconds, steps: [{ step, group, round, kind, label, start, duration, events: [index] }],
//     groups: [{ group, round, label, start, duration, steps: [first, last] }] }
```

**What you get.** The helper is pure (no clock). Times are relative seconds from 0, for the renderer's own clock. Every event lands in exactly one step, in order, and the steps are consecutive (each starts where the one before ended).

**Beats.** Steps are grouped into beats (`groups`). Each beat gets a budget at pace 1 (`TIMELINE_SECONDS`), shared among its events by weight:

| beat (`group`) | events | seconds |
| --- | --- | --- |
| `row` | row | 0.35 |
| `root` | root | 0.7 |
| `meter` | meter, phase | 0.5 |
| `cells` | cells | 0.4 |
| `progression` | progression (when given) | 0.3 |
| `line` | lead, pass 1, a step a phrase | 0.9 |
| `chords` | chord, round 0, a step a bar | 0.9 |
| `line2` | lead, pass 2 | 0.6 |
| `settle` (round i, a beat each) | settle, its chords, its leads | 0.45 |
| `harmony` | harmony | 0.3 |
| `parts` | part × 5 | 0.9 |
| `drums` | drums | 0.6 |
| `done` | done | 0.15 |

**Weights.** Inside a settle round, a changed bar's chord gets twice an unchanged one's time, and a replaced lead twice a held one's. In `meter`, the phase gets 3 parts to the meter's 2.

**Length.** A whole compose runs 6.1–8.0 s at pace 1 across the test rows (5.7 s at the least: no settle rounds, no drums).

**Options.**
- `pace: 2` runs twice as fast.
- `seconds: 5` fits the whole timeline to exactly 5 s, ignoring `pace`.
- `budgets: { chords: 1.5 }` reweights a beat.

**Labels.** Each step's `label` is a short caption, e.g. "bar 3: Am7", "settle 1: 2 bars changed" or "lead, phrase 1: 23 lines tested".

## For a renderer

- **Main page (Linear Plot).** Built 2026-10-22 night: `page/trace-frames.js` (pure: a scene, then a frame at t) and `page/compose-animator.js` (the driver and painter); DESIGN_NOTES.md, "Compose animation on the main page". Walk `tl.steps`, and for each, light the onsets its events name:
  - root: the `samples` of each candidate in turn, then the pick
  - meter and cells: the downbeat `node` and the slot windows
  - line: the chosen line's notes, with its runners-up shown dimmer and then dropped
  - chords: per bar, the candidates' root `node`s, then the pick
  - settle: the `changedBars`, and the lead that changed with them
  - parts: each part's notes
  - drums: the hits
- **Cosmos (onset dust).** Every onset the trace names is in `trace.nodes`, with its tick, ratio and layers. That's the set of motes worth raising. A part's notes and the drum hits are where they settle into the composition. Built 2026-10-22 night: `Cosmos/engine/compose-choreo.js` (pure: a scene, then a frame at t, on a clock face of the cycle) and `Cosmos/ui/compose-dust.js` (the painter); DESIGN_NOTES.md, "Cosmos onset dust and choreography".
- **The trace is untimed.** Don't read meaning into event spacing. Use `traceTimeline`, or your own pacing over `groups`.
- **Ids are stable.** The same line in two events has the same `id` (the line table holds it once). The same onset is the same `node` everywhere.

## Open (proposed calls)

1. **Top-k and sample sizes** (the caps above) are guesses at "enough to show testing and rejecting". They're cheap to raise: the trace is about 10 % of the 1 MB budget.
2. **Chord candidates** are the top 6 overall, which can be several qualities over one root. A per-root best might read better on the plot.
3. **The timeline budgets** aim at about 7 s for a full compose. Avery's "brisk but readable" may want the chords and settle beats longer and the row and cells shorter.
4. **Line notes** carry `octave`, not pitch; pitch is `cents + 1200 × octave`. That keeps lines and parts in one shape.
