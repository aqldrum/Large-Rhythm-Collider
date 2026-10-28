# Composer: design notes (draft, 2026-10-21; updated 2026-10-23)

Working notes from Avery's chat with Claude. Items marked **decided** are Avery's calls; everything else is a proposal or an open question. The 2026-10-21 sprint built phases 1–5 on branch `composer-prototype` (the "Phase" sections below), and Avery's first listening pass on 2026-10-22 is recorded under "First listening pass". The drums were built on the night of 2026-10-22 ("Drums"), on branch `sprint/drums`. The compose trace, the shared source for animating Compose, was built the same night ("Compose trace"), on branch `sprint/trace`, and Compose animated from it on the main page ("Compose animation on the main page"), on branch `sprint/animate`. `Composer/README.md` is the short way in: how to run it and where things are.

## Direction

- **The LRC goes its own way (decided).** This is a new port inside the LRC codebase, eventually deployed to the live site. chunk-tunes (`Compiler/Codex Compiler (dev)/Overworld/econ/runtime/chunk-*.js`) is a reference, not an upstream: much of it is about the Overworld map (chunks, villages, depots, quests, the Book). We take the mining ideas and the pure modules worth keeping, and adapt them freely. Nothing is synced back.
- **Compose from the tone row itself, without reassembly (decided).** chunk-tunes extracts material from a super-row and builds a separate composition. The LRC Composer decomposes one rhythm's own row: every line, chord and clave is a selection of onsets the rhythm already plays, in the place it already plays them. That is the difference that matters, and most of the choices below follow from it.
- **Compose, then Perform (decided).** The button reads Compose. Once a composition is ready, it switches to Perform.

## Scope of v1

- **One cycle of one rhythm (decided).**
- **Later:** a sequence of several loops of the same row, each with a different decomposition. This is where variation, development and form would come from, without leaving the rhythm.

## Time: cells, not "cycle = bar"

A cycle can be a dozen ticks or trillions. Overworld grids top out around 100K. So the cycle can't simply be the bar.

- **A cell-based approach keyed to onset density and timing goals (decided).** It starts with partitioned anchors: P pulses of size G or G±1, as in Partitions. Those pull lines with a steady internal rhythm out of the noisier polyrhythm.
- **Two knobs: bar length and number of bars (decided).** Together they set how fast the row is partitioned, and with the cycle duration that sets the tempo. Compose picks them; the user can override them for their own compositions.
- **The arithmetic,** for a cycle of duration T seconds, N bars, S slots per bar and b beats per bar:
  - bar = T / N
  - slot = T / (N·S)
  - tempo = 60·N·b / T BPM

  Example: 8:7:6:5 at a 4 s cycle with N = 2, b = 4 gives 120 BPM.
- **Open:** does Compose aim at a tempo range and solve for N, or aim at an onset density per slot and let the tempo fall out?

## Pitch: the frame, and roots

- **The frame width is a knob, defaulting to ±15¢, a 30¢ window, as in the Progression Solver (decided).**
  - A correction: chunk-lines' `frameCents = 25` is the window's total width (±12.5¢), not ±25¢.
  - Every tone still gets one of the 12 classes by nearest 100¢ step (the ±50¢ bucket). The frame decides which tones count as in tune for their class.
  - **Open:** are fringe tones (in a class but outside the frame) chunk-lines' "outside" tones, allowed on a weak slot where they resolve by step? Or are they excluded?
- **Roots belong to chords, as in the Progression Solver (decided).** A chosen melody's pitch-class set implies a chord, and the chord sets the root. The frame centres on that root, so it moves from chord to chord.
- **Harmony follows melody (leaning, Avery).** Mine the melody first and derive the chords from what it sounds. Searching a tone set for the most parsimonious progression is the alternative or the fallback.
- **Modulation is in (leaning, Avery: "I kind of think we should").** The root can change mid-composition by retuning the whole thing, so melodies and chords can be strung together.
  - Inside one rhythm this is natural: the row keeps its ratios and only the reference pitch moves. "Retune" means moving the fundamental.
  - Prior art to read:
    - Cosmos's modulation route (`Cosmos/audio/sky-modulation.js`, `sky-root.js`)
    - the Progression Solver's retune (`noteToHz`: it moves the fundamental so chord 1's root is the typed note)
    - main Playback's fundamental glide (`handleFundamentalChange`), with `setFrequency` on the shared voice handle
  - **Open:** is a modulation a jump at a section boundary, or a glide? And is it chosen by Compose, by the user, or both?

## Articulation: legato per part (decided)

Main Playback's legato control acts like a sustain pedal: each layer's voice holds until the next note. In the Composer, legato belongs to the part, not to the rhythm's layers. A part's legato setting applies only to that part's notes, even though every part draws its notes from the same row.

- **Legato on:** a note holds until that part's next note. It ignores the row's own next onset and any other part's notes.
- **Legato off:** a note lasts its own length, which is proposed as its slot, or the gap to the part's next note if that is shorter.
- **Struck sounds** keep the rule already agreed for main Playback: in legato they retrigger on every note.
- **Compose sets a default per part.** The proposal: pads and inner voices on, bass and lead chosen by Compose, comping off. The user can flip any part.

## Sprint defaults (proposed 2026-10-21, not ruled; Avery away)

1. Timing goal: a 90–130 BPM target in 4/4. N is chosen from 1, 2, 4 or 8, and S is around 8. The knobs override this.
2. Fringe tones: chunk-lines' "outside" tones, allowed on a weak slot where they resolve by step.
3. Modulation: a jump at a bar boundary, chosen by Compose, with a switch to turn it off.
4. Chords follow the lead. Parsimony only breaks ties.
5. Size gate: taken from the cost probe (see "The gate, from the probe" below): a hard cap of 1,048,576 onsets.
6. Parts may share onsets. Every note must be an onset the row actually plays.

## Cost and the size gate

- **Why one row may scale better than a super-row.**
  - District 90090 was heavy because its super-row merged a thousand rhythms into millions of nodes. One LRC row is a single rhythm.
  - chunk-lines sizes a slot's window in onsets (`moments = 12` around the anchor), not as a share of the slot. So a slot's candidates are the tones of about 12 moments however large the tuning is, and a line is at most 32 slots (`MAX_SLOTS`).
  - That suggests per-line cost grows with the number of slots and the tone variety near each anchor, not with the size of the tuning. A large tuning should mostly add variety. This is unmeasured.
- **Consequence:** on a large row, one line uses a small fraction of the onsets. Decomposing the rest across parts, and later across passes, is the point, not waste.
- **Limits in the code we'd port:**
  - `MAX_GRID = 2^25`
  - ticks stored as 32-bit integers
  - at most 65,535 distinct tones
  - the whole row built in memory

  Past those, positions would need 64-bit floats (exact below 2^53) or BigInt.
- **The gate: by onset count, like the Cosmos rhythm card's 16,384-onset cap (leaning, Avery).** The number is open until measured.
- **Proposed first task: a cost probe before the port.** Run row build, slot candidates and line mining on single LRC rows of increasing onset count and tone count. Record time and memory, and pick the gate from the curve rather than guessing. Rows from a few hundred to a few million onsets, with 10 to several hundred distinct tones.
- **The probe ran (2026-10-21; `Composer/probe/FINDINGS.md` in the probe worktree).** The picker is 85–99 % of Compose below 100k onsets. Its time follows candidates per slot, which the onset-sized window bounds, so it doesn't grow with onsets; it flattens past about 60 tones. Build and memory grow linearly with onsets and take over only at 1–2M onsets.

### The gate, from the probe (proposed, not ruled)

- **(a) A hard cap of 1,048,576 onsets (2^20).** Above it, `buildRow` returns `{ tooDense, onsets, gate }`. This replaces the 16,384 placeholder, which protected nothing the Composer pays for.
- **(b) Where Compose runs.**
  - Up to 100,000 onsets it may run on the main thread in a lean mode.
  - Otherwise, and always for the full table, it runs in a module worker. The phase 5 lab runs Compose in a worker by default.
  - `compose.js` (phase 4) is one pure call that runs in either place, with lean or full as a parameter.
- **(c) A minimum-tones gate: fewer than 3 distinct tones returns `{ tooFewTones, tones, min }`.** The probe's 1-tone row "composed" 83 lines on one pitch. The row still builds; `toneGate(row)` in row.js is what the miner (and later Compose) asks.
- **(d) A worker pool** (the table's pieces are independent; the slowest is about 0.25 s) is a later optimisation, not this sprint.
- **A limit the new cap makes reachable:** a grid past 2^53 is refused as `{ tooLarge }`. Under 16,384 onsets that was nearly impossible. Under 2^20 it isn't: four coprime layers near 10,000 (about 40k onsets, e.g. 10007:10009:10037:10039) or three near 208,000 already pass it.
  - **The refusal stands for v1** (planner, 2026-10-21; proposed, not ruled; Avery decides).
  - **Open item:** BigInt or two-part positions in row.js and cells.js would lift it.

## Phase 1: row and cells (built 2026-10-21, sprint)

`Composer/core/row.js` and `Composer/core/cells.js`, checked by `Composer/tests/assert-row.mjs` and `assert-cells.mjs`. On 52 rhythms (up to 5,368 onsets, most with 4 layers), the row and the even-anchor slot candidates equal chunk-super-row's normalized row and `slotCandidates` for the same single rhythm, and the onset-sized window equals chunk-lines' `buildLattice` swing. A second, tick-by-tick producer checks every tone and every slot in exact fractions.

Choices made without a ruling. Each is **proposed, not ruled**:

- **Tones are keyed by their exact fraction.** The kernel and the live site (`LRCModule.decimalToFraction`) spell a ratio as its best fraction with a denominator up to 1000. That is exact for small rhythms. Past that it rounds: in the tests, by up to 0.9¢, and two different tones can get one spelling (426:317:285 has 204 tones and 203 spellings). It can also spell a ratio just under the octave as 2/1. The row keeps the site's spelling beside each tone as `toneLabels`, so the lab can name tones the way the main page does.
- **Layer A is `layers[0]`, as the LRC names layers.** chunk-super-row sorts layers smallest first. A 0 is an absent layer, as in `generateCompositeRhythm`.
- **No 2^25 grid cap.** One rhythm has one denominator, so ticks are 64-bit floats, exact below 2^53. A grid past 2^53 is refused as `{ tooLarge, grid, limit }`. Since the gate went to 2^20 this is reachable; see "The gate, from the probe".
- **The gate counts onsets from the layers alone** (inclusion–exclusion over gcds), so refusing a dense row costs nothing. A row of exactly the gate builds.
- **Partitioned anchors cut the grid,** Partitions' Grid mode. Sequence and Grouping aren't ported. The pulse order is Partitions' own (`PartitionsBlocks.calculatePartitionSizes`), so a Composer slot and a Partitions block match. The tests show it's a rotation of Bjorklund's pattern and of chunk-timeline's `euclid` for every T ≤ 300, P ≤ 64. A given order of pulses (a dragged one) is accepted.
- **When P is more than the grid,** the cut is made on a grid `subdivide` = ⌈P / grid⌉ times finer, rather than refused.
- **The window reaches `swing` of the way to each neighbouring anchor.** With even anchors that is exactly chunk-super-row's window. With partitioned anchors each side scales with its own pulse, so at swing 0.5 every onset belongs to exactly one slot, and an onset exactly midway goes to the slot before it. Windows never overlap, so `slotOfNode` names each onset's single slot, or none.
- **The onset-sized window uses the row's mean density** (chunk-lines' formula: about `moments` onsets per slot on average; measured 0.99 × moments on rows of 1,000+ onsets). It doesn't take the nearest k onsets around each anchor. Since phase 2 the swing is kept as the exact fraction moments·P / (2n), not rounded to 1/10,000 as chunk-lines rounds it: the probe found the rounded window drifting past about 0.6M onsets. At about 10^6 onsets a slot now holds 11.97 onsets for `moments` = 12. A swing given as a number is still read to 1/10,000, as chunk-super-row reads it.
- **The phase is a fraction of the cycle in both modes** (`phaseAtTick` turns a tick into one). A slot's registers are a sorted list, not a bit mask, because on large grids they pass 31.

- **Cents are rounded the way chunk-tunes' `toneCents` rounds them** (its fold through `+ 1200` drops the low bits). Keeping the extra bits made two lines that the picker prices alike to the last digit break the other way, against chunk-lines' choice.
- **The site's spellings (`toneLabels`) are made the first time they're read.** Past a denominator of 1,000 each costs up to a thousand divisions.

Cost, measured once (not the probe): 4099:4093:4091:4079 (16,359 onsets, 4,177 tones) builds its row in about 13 ms and a 32-slot cut in about 0.3 ms. 700001:300007 (1,000,007 onsets, 150,004 tones) builds in about 0.35–0.5 s.

## Phase 2: frame and lines (built 2026-10-21, sprint)

`Composer/core/frame.js` and `Composer/core/lines.js`, checked by `Composer/tests/assert-frame.mjs` and `assert-lines.mjs`; `Composer/tests/time-lines.mjs` prints the timing table below.

**Parity.** On 21 single rhythms, with chunk-lines' 25¢ frame matched by ±12.5¢ here, its window's swing and its downbeat, the lattice matches candidate for candidate. chunk-lines' picker and this one pick the same lines at the same costs in all 3,150 lead and arp runs (6,290 lines). Eight test rhythms are left out: the kernel rounds some of their tones (phase 1 keys tones exactly), so the two tone sets differ. On small lattices every valid line is enumerated, and the picker's cheapest line of each length is the true one.

Choices made without a ruling. Each is **proposed, not ruled**:

- **The frame knob is `frameCentsEachSide`** (default 15, as decided). Every tone has a class 0–11, the nearest 100¢ step from the root. A tone exactly halfway goes to the step above, so deviations lie in [−50, 50). ±frame is inclusive.
- **The default root.** First built as the tone whose frame holds the most onsets: one sweep round the 100¢ circle, O(tones log tones), about 0.5 ms at 4,177 tones. On tone-rich rows that picked a tone heard only twice (4093/3252 on 4099:4093:4091:4079), and that tone gave only 2 of 6 downbeats. Revised in phase 3:
  - **The rule** (planner; proposed, not ruled): a root needs max(2, 1% of the row's onsets) onsets of its own. Among those tones, the frame's total onsets wins; then the most-heard root, then 1/1, then the lowest cents.
  - **The fallback** (builder; proposed, not ruled). The planner's fallback was the old rule. But on tone-rich rows no tone reaches 1% (the most-heard tone on the 16k row sounds 24 times of 16,359), so the old rule picked the heard-twice tone again. Instead the bar drops to half the most-heard tone's count, at least 2; only if that also fails does every tone qualify.
  - **What it picks now:**
    - 4099:4093:4091:4079: 4093/2304, heard 18 times, frame of 5,169 onsets
    - 768:784: 3/2, heard 192 times
    - 768:769: 3/2, heard 20 times
    - 2048:2049: 16/15, heard 16 times
    - All four now give the full 6 of 6 downbeats at 2×8 and at 4×8.
  - **Superseded 2026-10-22: presence is measured by the root's ±frame cluster (decided, Avery).** See "Cluster presence and settling" below. The rule above stays reachable as `presence: 'exact'`.
- **The class report** gives, for each class, its core and fringe ratios with fraction, cents, deviation and onsets, most-heard first. It reads only per-tone counts: O(tones) plus a sort per class, under 2 ms at 4,177 tones.
- **A line is mined on a span of the cycle's cells** (`from`, `bars`), not on a cut of its own. Compose fixes one phase and one meter for the cycle (phase 4), so every part reads the same slots and every note is an onset at its own time. chunk-lines' per-line downbeat search becomes the `downbeats` helper, for whoever picks the cycle's phase. Its `partitions` / 'auto' cut search isn't ported: the cells fix S.
- **Fringe tones are chunk-lines' outside tones** (Sprint default 2): only on a weak slot, followed within a step (250¢) by a tone inside the frame, never last.
- **Bass is its own type.** Overworld's bass is the sparse lead played two octaves down; here that would just be the lead's sparse lines again. So the bass is sparse, one octave wide (its register is set when it's played, phase 4), and weighs accent and close twice as hard (it leans on strong slots and on its root). It moves stepwise or wide, over rise, fall, arch and valley. Lead and arp are chunk-lines' own, setting for setting. The cell type (one bar) is left to phase 4.
- **Two tables.** The full table is every type × band × contour × motion: 58 runs per cut. The lean table is each type at its first motion: 24 runs per cut.
- **Dedupe and ranking.** A line found twice is kept once per type: the cheaper per note within one motion, otherwise the first found. Unlike chunk-lines, a bass and a lead with the same notes both stay. The table is ranked cheapest per note first. A line's id is `cl1:` plus a hash of its type, span, phase and notes.
- **Under a harmony** (`targets` with a scale), chunk-lines' harmony weights apply (contour 0.5, outside 0.8). Phase 3 passes the per-bar targets in chunk-lines' shape.

**Timing** (Node, this machine; `node Composer/tests/time-lines.mjs`). Lean is 2 downbeats × (2×8, 4×8) × the lean table: 96 runs. Full is 6 downbeats × (2×8, 4×8) × the full table: 696 runs. Columns are build ms, frame plus class report ms, and mining ms for lean and full.

| rhythm | onsets | tones | build | frame + classes | lean | full |
|---|--:|--:|--:|--:|--:|--:|
| 4099:4093:4091:4079 | 16,359 | 4,177 | 12 | 3.4 | 181 | 2,047 |
| 768:784 (48:49 ×16) | 1,536 | 24 | 0.5 | 0.0 | 190 | 2,074 |
| 768:769 | 1,536 | 384 | 0.9 | 0.3 | 163 | 1,718 |
| 2048:2049 | 4,096 | 1,024 | 2.4 | 0.8 | 159 | 1,908 |
| 5792:5793 | 11,584 | 2,896 | 7.2 | 1.8 | 121 | 1,598 |

This agrees with the probe: the picker is the cost, it doesn't track onsets, and the full table belongs in a worker. The slowest single cut of the full table was 0.45 s.

## Phase 3: harmony from melody, roots, modulation (built 2026-10-21, sprint)

`Composer/core/harmony.js`, checked by `Composer/tests/assert-harmony.mjs`. `harmonize(row, cells, { root, frameCentsEachSide, modulation, table, referenceName })` returns `{ lead, chords, targets, modulations, passes, exceptions }`. `chooseChord` (one bar, from cents) and `modulationStep` are exported as its pure core, so the hand-made cases test them directly.

How it works. Each choice here is **proposed, not ruled**:

- **The lead first.** Rooted lines with no harmony, on the frame's root, mined phrase by phrase. A phrase is as many bars as 32 slots hold: 8×8 gives two phrases of 4 bars. The lead is the miner's top-ranked line.
- **The grid.** The composition's 12 classes are 100¢ steps from the base root. Every bar sounds at an offset in cents, 0 until a modulation.
- **A bar's material.** Every tone its slot windows hold, weighted by onsets plus strikes, and the lead's notes in that bar.
  - **Strong notes** are the lead's notes on the downbeat and, when a bar has an even slot count, on the middle beat. If neither sounds, the bar's first lead note is its strong note.
  - A lead note on a fringe tone of the base frame is a passing tone: it neither asks for a chord tone nor counts toward one.
- **The chord.** Candidate roots are the bar's tones that are the most heard within their own ±frame. For each candidate, every quality is read in that root's frame and ranked by:
  1. fewest strong lead notes not held
  2. most lead notes held
  3. support: the bar's weight on the chord's classes over the bar's total, less 0.08 per chord tone and a small prior per quality (0 for the common triads and sus4, 0.02 for sus2 and the sevenths, 0.06 for dim, aug, m7b5, dim7 and mMaj7)
  4. voice-leading distance to the previous chord (parsimony, as a tie-break only)
  5. the lower root, then the simpler quality
- **The vocabulary.** Triads (maj, m, dim, aug), sus (sus4, sus2, 7sus4) and sevenths (7, m7, maj7, m7b5, dim7, mMaj7). Intervals are QualityCatalog's. Every name reads back through ProgressionSolver's `parseChordSymbol` to the same classes. Names are spelled from the base root, called C unless `referenceName` says otherwise.
- **Root tone and frame.** The chosen root tone is the bar's own tone, and `rootNode` is an onset of it in the bar's windows. The bar's frame is centred on it.
- **The targets.** One bar per chord, read in that bar's frame (root 0, the chord's intervals, its tone and cents). The parent scale is the union of the chords' grid classes, and each bar also carries that scale in its own frame's steps. lines.js now takes one frame per bar and a per-bar scale.
- **Modulation.** When a chosen root sounds more than ±frame off the grid at its bar's offset, the fundamental is retuned from that bar on, snapping the root exactly onto the nearest grid step. It is recorded as `{ bar, cents, fundamentalRatio = 2^(cents/1200) }`, relative to the base fundamental. Offsets accumulate across modulations; they are not folded back into ±50¢.
  - With `modulation: false`, only roots on the grid are candidates. A bar with none keeps its best root, flagged `offGrid`, and nothing is retuned.
- **The second pass.** The lead is re-mined over these targets. Per phrase, the kept line is the one with the lower cost per note under the harmony weights; the first lead is re-scored on the same lattice, and counts as invalid if any of its notes breaks a rule there. The chords stay those derived from the first lead. A strong note of the kept lead that its chord does not hold is counted in that chord's `exceptions`, not hidden.

Measured (180 harmonizations on 9 rows × 5 meters × 2 anchor modes × modulation on and off, lean table):

- The second pass's lead was kept in 186 of 216 phrases (86%).
- 6 of 814 strong lead notes are exceptions.
- 46 retunes with modulation on.
- 6 chords flagged off-grid.

Timing (ms, one downbeat; lean / full):

| row | 2×8 | 4×8 | 8×8 |
|---|--:|--:|--:|
| 4099:4093:4091:4079 | 25 / 69 | 98 / 322 | 154 / 509 |
| 768:784 | 8 / 27 | 86 / 308 | 143 / 393 |
| 768:769 | 20 / 66 | 106 / 373 | 200 / 687 |

**Open, for Avery.**
- **Chords follow the first lead.** The planner kept this (proposed, not ruled). Avery has since asked for settle passes, the chords re-derived from the kept lead until they settle: see "Cluster presence and settling" below. `settlePasses: 0` is the behaviour described here.
- **Offsets fold into [−50, +50)¢, as a pure relabel** (planner, phase 5; proposed, not ruled; this corrects the phase 4 entry).
  - The fold never moves a pitch. Each modulation's snap and its `fundamentalRatio` are exactly as unfolded.
  - When the cumulative offset leaves [−50, +50)¢, the grid that names the classes shifts by whole classes instead. Chords' `rootPc`, `pcs` and names, and the reported `offsetCents` and `cents`, change; nothing else does.
  - The sounding values stay alongside: `rawOffsetCents`, `rawCents`, `gridPcs`, `gridRootPc`, `fundamentalRatio`. The line targets are built on the sounding grid.
  - On 768:769 in 8×8, bar 5 reads −98.0¢ raw and +2.0¢ folded, its root named one class up. Every note's hz is identical either way (tested in assert-harmony and assert-compose).
  - `foldOffsets: false` (also a Compose override) gives the raw offsets and names.
  - The phase 4 version moved the fundamental by 100¢ and was wrong. It is replaced.
- **Rare colours stay for Avery to hear.** How often each quality appears over the 378 chords with modulation on in the harmonization sweep (`assert-harmony.mjs` prints this table):

| quality | chords | share |
|---|--:|--:|
| major_7th | 96 | 25.4% |
| major_triad | 90 | 23.8% |
| sus4 | 62 | 16.4% |
| minor_triad | 34 | 9.0% |
| sus2 | 32 | 8.5% |
| minor_major_7th | 18 | 4.8% |
| dom7_sus4 | 16 | 4.2% |
| dim_triad | 8 | 2.1% |
| dominant_7th | 8 | 2.1% |
| aug_triad | 6 | 1.6% |
| minor_7th | 4 | 1.1% |
| half_dim7 | 4 | 1.1% |
| dim7 | 0 | 0% |

**Flag for Avery:** maj7 leads the table. mMaj7 and aug come mostly from tone-rich rows, where they hold one more lead note than a triad would.

## Phase 4: arrangement and Compose (built 2026-10-21, sprint)

`Composer/core/compose.js` and `Composer/core/compose-worker.js` (a module worker running the same pure call), checked by `Composer/tests/assert-compose.mjs`.

**The call.** `compose(layers, cycleSeconds, { seed = 1, overrides, worker })` returns a deterministic, JSON-serialisable spec: the same inputs and seed give byte-identical JSON. Refusals are `{ version, input, refused: true, reason: 'tooDense' | 'tooLarge' | 'tooFewTones', detail }`.

**The spec phase 5 reads:**

- `{ version: 'composer-spec-v1', input: { layers, cycleSeconds, seed, overrides }, knobs, chords, modulations, parts, decisions, stats }`
- `knobs`: `{ bars, slotsPerBar, beatsPerBar: 4, anchors, phase: [num, den], frameCentsEachSide, root, modulation, table, tempoBpm, leader: 'lead', baseHz, cycleSeconds }`
- `chords[bar]`: `{ bar, name, quality, intervals, pcs, rootPc, rootTone, rootNode, offsetCents (named), rawOffsetCents, fundamentalRatio, offGrid, exceptions, empty }`
- `modulations`: `[{ bar, cents (named), rawCents, fundamentalRatio }]`
- `parts`: lead, chords, comp, bass, inner, each `{ id, role, sound, struck, legato, enabled, notes }`
- each note: `{ node, tick, time, ratio, octave, hz, duration, velocity, bar, slot, slotSeconds, retrigger }`, plus `voice` on the chords part
- `timeline`: `{ slotStarts, barStarts }` in seconds from the downbeat (added in phase 5 for the lab's lanes and playhead)
- `hz` = baseHz × ratio × 2^octave × the bar's `fundamentalRatio`
- `time` counts seconds from the phase (bar 1's downbeat). The cycle loops, so a note in bar 1's first window that falls just before the downbeat sounds at the end of the cycle.
- `decisions`: `[{ what, value, why }]`, one per choice: frame, root, bars, slots, tempo, anchors, phase, modulation, table, leader, comping layer, and sound, legato and enabled for each part, plus baseHz.
- `stats`: onsets, tones, grid, onsets per slot, notes per part, lead phrases, second-pass wins, exceptions, chord voices per bar, bass bars opened on the root, inner notes on lead slots, the comping layer and its score; since 2026-10-22 also `settle` (see "Cluster presence and settling").
- Since 2026-10-22 `decisions` also lists `presence` and `settlePasses`, and both are overrides.

How it works. Each choice here is **proposed, not ruled** unless marked decided:

- **The meter.** N is whichever of 1, 2, 4, 8 puts 60·N·4/T inside 90–130 BPM, the nearest 110 when several do. When none does, the nearest one, and the spec says so.
  - S starts at 8. While the slots would hold under 3 onsets each on average, S drops to 6, 4, then 3, and only then N halves, keeping the tempo before the slots. Example: 8:7:6:5 in 4 s plays 2 bars of 3 slots at 120 BPM.
- **The other knobs.**
  - Anchors are partitioned (decided: "it starts with partitioned anchors").
  - The phase is one of the root's first three downbeats, picked by the seed.
  - Frame ±15¢ (decided); the root comes from `defaultRoot`; modulation is on; the leader is the lead (v1).
  - The lean table runs on the main thread; the full table when `worker: true`.
- **The seed** drives the phase, the chords, comping and inner sounds (each from its proposed pair), and ties between comping layers. Everything else is rule-based.
- **Chords.** Each chord class gets one voice, root first: the bar's onset of that class (inside the bar's frame) with the most strikes, then the earliest.
  - The voices stack close from an octave under the bar's root, each the lowest register above the voice under it.
  - A voice sounds at its onset, so a chord builds as its tones arrive.
  - Legato in a chord part works per voice: a note holds until that voice's next note.
- **Comping.** One layer of the rhythm, cut into the bars and their slots. A slot's step is the layer's first strike in it, and it sounds only when that strike's tone is one of the bar's chord tones (rhythm-claves.js' tone sets, chunk-comping.js' ranking).
  - The layer chosen makes the best claves: 25–50% of its steps sounding, a straight (4, 8, 16) or triplet (3, 6, 12) count of steps per bar, and a stroke in every bar.
  - A bar with no stroke is struck once on its root onset.
  - Overworld cuts a layer by its own strike count. That fails here: a layer of a large rhythm strikes hundreds of times a bar, which first gave 350 comping notes on the 16k row. Cutting by slot steps fixes it.
- **Bass.** Mined bar by bar, rooted on the bar's root tone, two octaves under the lead's range.
  - The line must open on a tone of the root's class where it can; lines.js gained a `startTones` rule for this. Otherwise the cheapest line wins, and a bar with no line plays its root onset.
  - Before `startTones`, the 16k row opened 0 of 8 bars on the root; now it opens 8 of 8.
- **Inner voice.** A lead line, sparse or mid band, over the chords an octave under the lead.
  - It never plays the lead's onsets, and pays 0.6 per note on a slot where the lead sounds. lines.js gained `avoidSlots`, `avoidNodes` and an `avoid` weight for this.
- **Sounds.**
  - Lead: flute when legato, vibes when not.
  - Bass: sub when legato, upright when not.
  - Chords: warm or glassbed. Comping: marimba or kalimba. Inner: reed or harp. These three are picked by the seed.
  - A sound is "struck" when its Audio/voices note recipe has a struck envelope.
- **Legato** (decided: per part, its own notes only).
  - On: a note holds until the part's next note.
  - Off: a note lasts its slot, or the gap to the part's next note if that is shorter.
  - The last note runs to the end of the cycle.
  - A struck sound in legato retriggers on every note. A held sound is struck once and moved: only its first note has `retrigger`.
  - Defaults: chords and inner on, comping off, bass off. The lead is on when its median gap is 2 slots or less.
- **Pitch.** baseHz puts the lead's median pitch at √(440·660) ≈ 539 Hz, before any bar's retune.
- **Velocity.** Lead 0.8, +0.1 on strong beats. Chords 0.45. Comping 0.55, +0.1 per extra layer striking. Bass 0.75. Inner 0.5.

**Timing** (Node; Compose end to end):

| row | meter | lean | full |
|---|---|--:|--:|
| 4099:4093:4091:4079 (16,359 onsets), 16 s | 8 × 8 | 308 ms | 1,000 ms |
| 768:784, 8 s | 4 × 8 | 242 ms | 947 ms |
| 768:769, 8 s | 4 × 8 | 105 ms | 377 ms |

Lean stays under the 1 s main-thread target on all three rows.

## Phase 5: the lab page (built 2026-10-21, sprint)

`Composer/lab/composer-lab.html`, not linked from `index.html`. Serve the repo root as a static site and open `/Composer/lab/composer-lab.html`; a module worker can't start from `file://`.

The code is split in three:
- `lab-controller.js`: the state and actions, no DOM.
- `lab-player.js`: the scheduler and audio graph, no DOM.
- `composer-lab.js`: a thin view over both.

(2026-10-22 night: the controller and player moved to `Composer/perform/`, shared with the main page's Composer tab. See "Composer tab on the main page".)

`Composer/tests/assert-lab.mjs` drives the controller and player against a recording mock AudioContext.

How it works. Each choice here is **proposed, not ruled**:

- **Inputs.** Four layers (blank or 0 means absent), the cycle in seconds (8 by default) and a seed.
  - The page opens on 41:42:43 and composes it at once.
  - Six presets: 41:42:43, 8:7:6:5, 19:17:16:15, 119:42:15:8, 768:769, and 4099:4093:4091:4079.
- **The table decides where Compose runs.** Full runs in the module worker; lean runs on the main thread. Each is Compose's default in that place, so the table is never logged as an override.
  - A knob change re-composes by itself only on the lean table, and only while a lean compose takes under 300 ms.
- **The main button.** Compose → Composing… → Perform ⇄ Stop. Any change to an input, knob or table stops playback and returns it to Compose.
- **Knobs.** Bars, slots per bar, frame ±¢, modulation and anchors. Blank or "auto" leaves the choice to Compose. Each knob shows what Compose chose, or "asked:" in amber when it was overridden.
- **Lanes.** One row per part and one column per bar, each column as wide as its bar lasts.
  - Each row has a sound select (every note-role sound in Audio/voices), a legato toggle, an on/off toggle and a level slider.
  - Notes show as ticks at their times. A glided note shows as a fainter tick.
  - The chords row names each bar's chord. A modulation shows as "↻ ±cents", with the raw offset in its tooltip.
  - A sound or legato change re-articulates the part with compose.js' `rearticulate` (the decided legato rule). Nothing is re-mined.
- **Readouts.** Tempo, meter, root, baseHz, onsets, tones, table, compose time and the chords. A refusal is said in plain words. The decisions list (what, value, why) sits in a collapsible panel.
- **Export.** JSON downloads the spec with the parts as they play now.
- **Playback.**
  - The page makes its own AudioContext on the first Perform.
  - A scheduler ticks every 25 ms and books 150 ms ahead, looping the cycle from the moment Perform was pressed.
  - Each part has its own gain bus with a level, feeding a master gain (0.8), then a DynamicsCompressor limiter (−10 dB, 6:1), then the destination.
  - A note with `retrigger` starts a `note`-role voice: `planVoice` and `createInstrumentVoice`, with the note's velocity as the peak. The notes after it without `retrigger` glide that held voice with `setFrequency` (12 ms) at their times; in the chords part, per voice. The voice is released when its chain ends.
  - A note alone is planned with its own duration, so a struck sound damps where its note ends.
  - Stop fades every live voice over 30 ms and books nothing more.
  - A white playhead moves across the lanes.

## Cluster presence and settling (built 2026-10-22, branch `composer-settle`)

Two changes to the core: `Composer/core/frame.js`, `lines.js`, `harmony.js` and `compose.js`, checked by `assert-frame.mjs`, `assert-harmony.mjs` and `assert-compose.mjs`. `Composer/tests/settle-baseline.mjs` holds sha256 hashes of e3909e1's output on 119 fixed cases (23 Compose specs, 96 harmonizations), so the "nothing moved" claims below are tested byte for byte.

### The root's presence by its ±frame cluster (decided, Avery)

Avery: "the ±frame cluster neighborhood is the right call, at least for rhythms at this level of complexity."

- **The measure (decided).** A tone's presence is the onsets of every tone in its ±frameCentsEachSide cluster: its own class, octave-equivalent, within ±e of it (`inCluster`, the same test as chooseChord's `near`). `clusterPresence(row, e)` computes it for every tone in one sweep over the tones sorted by cents mod 1200, unrolled three laps so the window wraps at 0/1200, O(tones log tones). At e = 50 the tone exactly 50¢ above belongs to the next class, as `classOfCents` has it. The sweep takes 39 ms on 150,004 tones, and it is checked against every pair on the 52 test rhythms at 7 knobs.
- **The candidates (proposed).** The candidates are the cluster representatives: a tone that is the loudest tone of its own cluster, by onsets, then strikes, then the lower index. This is how chooseChord picks a bar's candidate roots. The sweep finds them with a monotone deque, in the same pass.
- **The rungs (proposed, as asked).** The rungs are the old ones, applied to cluster presence:
  1. a cluster heard max(2, 1% of the onsets) times;
  2. else, half the largest representative's cluster, at least 2;
  3. else, any representative.

  Among the candidates, the frame's total onsets wins. Ties go to cluster presence, then the root's own onsets, then 1/1, then the lowest cents.
- **Downbeats (proposed).** `downbeats(row, P, count, tone, { cluster: e })` takes the root's cluster. It tries the root's own first onset first, then the heaviest onsets of any tone in its cluster. Compose passes `cluster: e`, so a root heard only a few times still gets its downbeats.
- **The old rule stays as `presence: 'exact'`.** It is an option on `defaultRoot` and a Compose override. Compose with `presence: 'exact', settlePasses: 0` reproduces e3909e1's specs byte for byte, once the new fields are taken out.

What it picks, old (`exact`) against new (`cluster`). Frame is the onsets the root's ±15¢ frame holds. Downbeats are those found out of those asked: 6 asked with even anchors at 4 × 8, and 3 asked with partitioned anchors at Compose's own meter.

| row | rule | root | heard | cluster | frame | downbeats, even 4×8 | downbeats, Compose's |
|---|---|---|--:|--:|--:|--:|--:|
| 4099:4093:4091:4079 (16 s, 8×8) | exact | 4093/2304 | 18 | 416 | 5,169 | 6/6 | 3/3 |
| | cluster | 4093/2048 | 24 | 455 | 5,153 | 6/6 | 3/3 |
| 768:784 (8 s, 4×8) | both | 3/2 | 192 | 192 | 864 | 6/6 | 3/3 |
| 768:769 (8 s, 4×8) | both | 3/2 | 20 | 48 | 496 | 6/6 | 3/3 |
| 2048:2049 (8 s, 4×8) | both | 16/15 | 16 | 140 | 1,266 | 6/6 | 3/3 |
| 41:42:43 (8 s, 4×8) | exact | 41/37 | 2 | 8 | 70 | 2/6 | 2/3 |
| | cluster | 41/22 | 2 | 2 | 70 | 2/6 | 2/3 |
| 1597:987:610:377 (8 s, 4×8) | both | 372099/204416 | 16 | 88 | 1,134 | 6/6 | 3/3 |

- **Four of the six rows keep their root.** 1597:987:610:377 keeps its root, but its phase moves (42/377 to 34/1597), because downbeats 2 and 3 now come from the cluster's heaviest onsets.
- **On 4099:4093:4091:4079 the root becomes the most-heard ratio,** 4093/2048, heard 24 times. The old root, 4093/2304, isn't a representative: a louder tone sits within ±15¢ of it. The new root costs Compose more: about 520 ms lean against 340 ms, and 1.7 s full against 1.1 s, with settlePasses 0. Its frame is 16 onsets smaller.
- **Flag for Avery: 41:42:43.** On this row (124 onsets, 41 tones) the 1% rung is 2, so nearly every representative qualifies and the frame decides. The new root, 41/22, is alone in its cluster and heard twice, so Compose still finds only 2 of 3 downbeats. The old root, 41/37, had the same frame (70 onsets) but was not a representative. Ruling the rungs (rather than the measure) would change this. One option: let cluster presence break ties before the frame.
- **Where it differs.** On the 52 test rhythms, 5 pick a different root than `exact`. A tone heard twice in a cluster heard 428 times (4093/2324) finds 2 of 6 downbeats on its own onsets and 6 of 6 from its cluster.

### Settle passes: lead ↔ chords until the chords settle (requested by Avery; the rules proposed, not ruled)

Today's pipeline is round 0. Chords come from the rooted lead, the lead is mined again over them, and per phrase the cheaper per note is kept.

**`settlePasses`** (`harmonize` option and Compose override, an integer 0–3, default 3) adds up to that many rounds. Each round i ≥ 1:

1. Re-derives every bar's chord from the lead round i − 1 kept, by the same `chooseChord` rules: strong notes, held notes, support, the voice-leading tie-break. The modulation offset is walked from bar 1 again.
2. Rebuilds the targets.
3. Mines the lead over them, and keeps per phrase the cheaper per note of that line and the kept one, re-scored on the new targets. This is the same `costOn` comparison as round 0's.

When the loop stops (all proposed):
- **Converged.** A round's chords equal the round before's: the same root tone, quality and sounding offset in every bar. The round before is kept, and nothing is re-mined.
- **The cap.** After `settlePasses` rounds, the last round is kept.
- **Oscillated.** A round's chords equal an earlier round's. The loop stops and keeps the round of the cycle with the fewest strong-note exceptions, then the lower lead cost per note, then the earlier round.

The pure loop is exported as `settleRounds` and tested on made-up states, because no real oscillation turned up (below).

Exceptions are counted at the end: the final kept lead against the final chords. Compose builds every other part from the final chords and targets.

Recorded:
- **In the spec.** `stats.settle: { rounds, converged, oscillated, changedBarsPerRound, exceptionsPerRound, chosenRound }`, and a `settlePasses` decision.
- **In harmonize's result.**
  - `settle`: the same fields, plus the cap, the cycle and the lead cost per round.
  - `passes.rounds`: per round, `changedBars` (the bar indices), `newerKept`, and per phrase which line was kept.
  - `lead.kept` tags each phrase's line with the pass it came from: `first`, `second` or `round1`–`round3`.
- **`settlePasses: 0` is e3909e1 byte for byte** on 96 harmonizations and 23 specs (with `presence: 'exact'` in Compose).

**Measured.** 12 rows × 4 meters (2×8, 4×8, 8×8, 4×6), partitioned anchors, the cluster root, modulation on, cap 3. The rows are 8:7:6:5, 11:9:7:5, 19:17:16:15, 119:42:15:8, 768:784, 768:769, 504:234:520:297, 2048:2049, 97:103:37, 41:42:43, 1597:987:610:377 and 4099:4093:4091:4079.

| | lean | full |
|---|--:|--:|
| runs | 48 | 48 |
| converged | 47 | 47 |
| hit the cap | 1 (1597:987:610:377 4×8: 3, 1, 1 bars) | 1 (97:103:37 4×6: 1, 3, 2) |
| oscillated | 0 | 0 |
| rounds used: 1 / 2 / 3 (1 = the first re-derivation already agrees) | 27 / 14 / 7 | 21 / 20 / 7 |
| round 1: runs with chords changed, bars changed | 21 of 48, 37 bars | 27 of 48, 42 bars |
| round 2 | 7 of 21, 8 bars | 7 of 27, 11 bars |
| round 3 | 1 of 7, 1 bar | 1 of 7, 2 bars |
| newer lead kept: round 1 / 2 / 3 | 14 of 28 / 3 of 7 / 1 of 1 phrases | 18 of 32 / 5 of 8 / 1 of 1 |
| strong-note exceptions, before → after | 1 → 1 | 0 → 0 |

- **A wider search.** 860 harmonizations: the 52 test rhythms and 7 more, × 5 meters × 2 anchor modes × modulation on and off, lean.
  - No oscillation, and 10 hit the cap.
  - Exceptions went from 6 to 2: 4 runs fewer, none more. 11:9:7:5 at 3×5 goes from 1 to 0, and it is a test case.
- **The lead's cost per note isn't monotone across rounds.** For example, 1597:987:610:377 4×8 goes 0.523 → 0.508 → 0.488 → 0.513. Each round is priced on its own targets, so settling is a fixed-point search, not a descent.
- **A pre-existing oddity, not new.** On 11:9:7:5 8×8 one phrase keeps a round-0 line whose re-score is Infinity, because no line was mined over the chords. It only matters to the oscillation tie-break.

**Timing.** Node, this machine, Compose end to end, median of 3–5 runs, ms.

| row | meter | table | settlePasses 0 | 1 | 3 | rounds at 3 (bars changed) |
|---|---|---|--:|--:|--:|---|
| 4099:4093:4091:4079, 16 s | 8×8 | lean | 518 | 660 | 658 | 2 (5, 0) |
| | | full | 1,712 | 1,740 | 1,770 | 1 (0) |
| 768:784, 8 s | 4×8 | lean | 264 | 323 | 322 | 2 (1, 0) |
| | | full | 1,017 | 1,320 | 1,323 | 2 (1, 0) |
| 768:769, 8 s | 4×8 | lean | 116 | 114 | 114 | 1 (0) |
| | | full | 408 | 408 | 407 | 1 (0) |
| 4099:4093:4091:4079, `presence: 'exact'` | 8×8 | lean | 331 | 438 | 440 | 2 (2, 0) |
| | | full | 1,021 | 1,433 | 1,424 | 2 (1, 0) |

- **A round that re-mines costs about one more lead pass:**
  - lean: +59 ms (768:784), +107 ms (4099:4093:4091:4079, exact root) and +142 ms (cluster root);
  - full: +303 ms (768:784) and +412 ms (4099:4093:4091:4079, exact root).
- **A round that only confirms costs 0–30 ms.** It re-derives the chords and mines nothing.
- **That's close to the expected +70–100 ms lean and +200–350 ms full per round,** a little over on the 16k row.
- **Lean stays under 1 s everywhere.** The 16k row is the slowest at about 0.66–0.72 s with the default cap.

## Targeted progressions (built 2026-10-22 night, sprint)

**Decided (Avery):** the user can define the progression instead of the lead-driven first pass. Per chord slot (one chord a bar in v1) they pick a chord ROOT from the row's own tones, shown as ratios. The solver picks the QUALITY from what that bar's own tones support over that root, and mines the lead and every other part under it. Every note stays a real onset of the row. A slot left on "auto" is solved as today, so a progression can be partly targeted.

**Built.** `Composer/core/progression.js` (pure, like the rest of `core/`), checked by `Composer/tests/assert-progression.mjs` (39 checks) and 12 more in `assert-lab.mjs`.

- **Input.** `compose(layers, T, { progression })`: one entry a bar, each a ratio of the row (`'3/2'`), `{ ratio }`, or `null` / `''` / `'auto'`. With no progression, or every entry auto, Compose runs exactly as before: the spec is byte-identical (input included), and the e3909e1 baseline still holds with an all-null progression. A progression that pins anything is copied into the spec's `input.progression`, so JSON export carries it.
- **Root candidates.** `rootCandidates(layers | row, { frameCentsEachSide, presence, root })` lists the row's ±frame clusters by their representative (the loudest tone of its own cluster, as a bar's candidate roots are picked), the base root first and then in pitch order up from it. Each has its ratio, cents, a note name on the composition's grid (the base root called C, as chords are named, before any modulation), presence (the cluster's onsets) and whether it sits off the grid. It picks the same base root Compose would, so it works before a compose. It's cheap enough for the main thread: 0.1–3 ms on the small presets, 20 ms on the 16,359-onset row (33 clusters; 768:769 has the most, 57).
- **Where it branches.** `harmonize` takes an optional `progression: { roots, choose }` (one tone or null a bar, and `chooseChordOnRoot`). In every derivation (round 0 and each settle round), a pinned bar's chord comes from `choose` and an auto bar's from `chooseChord`, so **the settle passes re-derive the quality under the kept lead and never move the root.** A phrase whose bars are all pinned skips the first, unharmonized lead pass: its chords come first, from the roots and the bar's tones, and the lead is mined over them. Compose reads the progression after the meter, passes it in, and builds every other part from the final chords as before.

**The rules (each proposed, not ruled):**

- **The root is the pick, exactly.** The chord's root tone is the tone asked, and its frame is centred on it. `rootNode` is the bar's onset of that exact tone, or null when only its ±frame cluster (or nothing of it) sounds in the bar. The chord voices take whatever onset of the root's class the bar has inside the frame, so a cluster neighbour still voices it.
- **Supported quality.** A quality of the catalog is supported when the bar sounds all its classes but at most one (`MAX_MISSING = 1`). The root counts as one of them, so over a root the bar doesn't sound, every other class must sound. That's the slack Compose's own chords already take: of 70 auto chords on ten rows, 45 sound whole in their bar, 22 lack one class, and 3 (sevenths) lack two. The supported qualities are ranked as `chooseChord` ranks them: strong lead notes not held, lead notes held, support, voice-leading, then the simpler quality.
- **Fallback, never a throw.** When no catalog quality is supported, the thinnest dyad whose other tone the bar sounds: a power chord (`5`) on the fifth, else the root and its major (`no5`) or minor (`mno5`) third. Failing those, the root alone (`no3no5`). Every fallback name reads back through ProgressionSolver's `parseChordSymbol`. The chord carries `fallback`, and the decisions list names the bar, what the nearest quality lacked, and what was played instead. Picking every candidate on every bar of 8:7:6:5 and 41:42:43 (142 composes): 34 fell back, none threw.
- **Modulation.** A picked root runs harmony.js' own rule (`modulationStep`). Off the grid at its bar's offset, the fundamental retunes from that bar on, for every part. With modulation off, the root is kept, flagged `offGrid`, and nothing is retuned. On 41:42:43, 21/11 (+41.7¢) on bar 1 retunes it by −41.7¢.
- **Mixed progressions.** A phrase holding an auto bar runs the first lead pass as today. Its auto bars are derived from that lead, and its pinned bars rank their qualities with it too. A fully pinned phrase skips that pass. This is the cheapest rule that keeps auto bars exactly as Compose would find them from a lead.
- **Length mismatch.** A longer list is cut to N bars and a shorter one padded with auto, and the decisions list says so. A ratio that isn't a tone of this row makes that bar auto, and is said. If every pin is cut away, Compose is lead-led, with an all-auto `progression` decision saying why. Malformed input (not a list, or an entry that isn't a ratio) throws.
- **Reporting.** `knobs.leader` and the `leader` decision say `lead`, `progression` (every bar pinned) or `mixed`. A `progression` decision gives `'auto'` or `'ratio → name'` a bar, with the reasons. With a progression, each spec chord carries `targeted` and `fallback`.

**Measured.**
- **Timing** on the 16,359-onset row (8 bars, the auto roots fed back, best of 3, ms): lean auto 564–678, targeted 302–316, mixed (every other bar) 648–682; full auto 1,709–1,735, targeted 1,063–1,188, mixed 1,715–1,756. Fully targeted is about twice as fast lean, because the first lead pass is skipped. Mixed costs the same as auto.
- **"Take from last compose"** gives the same roots back (tested on 7 rows). It doesn't give the same chords: on ten rows, 18 of 36 qualities came back the same. With every bar pinned, round 0 ranks qualities by the bar's support alone, since there's no lead yet to vote. The lead is then mined over those chords, and the settle round agrees with them. For example, on the 16k row the auto Bmaj7 AmMaj7 … Cmaj7 come back as Bdim Am … Csus4.

**The lab.** A Progression section has one select a bar: auto, then the 8 most heard clusters, then all of them in pitch order. Each entry reads ratio · note name · cents · presence, with a tooltip for the cluster size and whether it's off the grid. Under each select is the chord that bar got ("asked → Gsus4", or "(fallback)"). The editor has as many bars as Compose will use (the bars knob, else `chooseMeter`). "Take from last compose" seeds it with the spec's roots, "clear" sets every bar back to auto, and new layers clear it. A `progression` readout counts targeted bars, the leader and any fallback bars. In the chords lane, targeted chord names show in the accent colour and fallbacks in amber.

**Open, for Avery:**
1. **Chords-first or lead-voted round 0 when every bar is pinned?** Built chords-first, as asked: the qualities come from the bar's support, then the lead follows. The alternative is to still mine the unharmonized lead and let it vote on the quality over the fixed roots, as mixed bars do. "Take from last compose" would then reproduce more of the auto tune (18 of 36 qualities match today), at the cost of the 2× speed-up. Which do you want, or should it be a switch?
2. **The slack of one missing class.** Should a targeted chord be allowed to claim a tone the bar doesn't sound (a triad over root and fifth only)? Auto chords already do this about a third of the time. The stricter rule ("every class but the root") produced dyad fallbacks on most bars of tone-rich rows.
3. **Fallback names.** `5`, `no5`, `mno5` and `no3no5` are ProgressionSolver spellings. Would "C (root)" read better than `Cno3no5`?
4. **The candidate list** is the global clusters, not per bar. A root heard often in the cycle may not sound in the bar it's picked for (the decisions say so). Should the editor show per-bar presence, or mark candidates that don't sound in each bar?
5. **Names before modulation.** Candidate names are on the base grid. After a retune earlier in the cycle, the chord name the bar ends up with can read a class away from the name in the menu.
6. **More than one chord a bar** (v2) would need the slot editor to split a bar. The input is already one entry a slot.

## First listening pass (Avery, 2026-10-22)

**Heard and confirmed working:** clean loops with no clicks (after the fix below); every part plays correctly; the lead's legato behaves right across sounds; modulation markers and retunes (e.g. 1597:987:610:377, 8 bars, all auto: chords 6 and 7, Em −29.4¢ and Esus4 +6.7¢); a ±35¢ frame "works exactly as intended" and takes longer to compute, as expected. On the chords: "I am actually finding the chord progressions to be pretty sick", with a fair spread of qualities that depends on the rhythm.

**Why modulation off changes only the second half.** Everything downstream of a bar's chord is mined from it. With modulation off, the chord that needed a retune changes, so its phrase's targets change, and that phrase's lead, bass, inner voice, comping and chord voices change with them. Phrases whose chords didn't change stay the same.

**Fixed after listening:**
- **Portamento was far too long** (`Audio/voices/voice.js`, e3909e1). A glide booked ahead used `cancelAndHoldAtTime`, which in a real engine holds nothing when nothing is scheduled after that time, so the exponential ramp ran from the voice's previous event across the whole gap between notes. Each param now remembers the value it settled on and re-sets it at the glide's start. The same flaw was in the old live-site fundamental glide, and this fixes it there too once merged.
- **A click at the loop point** (7fba64d). This was the same flaw on the gain: once an envelope had settled at sustain, a release's linear ramp ran from the envelope's last event. Booked early, a held note sank slowly across its whole length; booked late (inside the lookahead), the gain jumped down at once. Releases and fades now start from the settled value at their own time. This is the note role only; Cosmos's roles are untouched, and its `releaseAudition` and `holdRowEnvelope` use the same pattern, unexamined.

**Added to the lab:**
- Glide (portamento, 0–500 ms, default 12).
- Live tempo (30–300 BPM, with reset), d58c08b. Spec time maps to the clock in segments, and a held chain's moves and release are booked incrementally, so a change reaches voices already holding.
- Settle passes (0–3) and Root presence (cluster | exact), b98250d.

**Avery's directions from the pass:**
- **Bass:** leaps are more acceptable in the bass than in inner voices; the root should be clearly stated most of the time, where the row allows. Next: weight root-class tones on the bar's strong slots, not just the opening note.
- **Comping** gets chords, as in chunk-tunes.
- **v2, bass-led composition:** bass and melody are intertwined, so the first and second lead passes could be run as bass parts instead of melody lines.
- **The inner voice** is fine for a first pass. More options later, e.g. a full arpeggiator.
- **Drums** are the next step, in a new thread.

## Drums (built 2026-10-22 night, sprint)

`Composer/core/drums.js` and `Composer/core/drum-patterns.js`, checked by `Composer/tests/assert-drums.mjs`; the lab's Drums lane is checked in `assert-lab.mjs`. Avery's design for the sprint was single level (the brief); everything below is **proposed, not ruled**, except where it repeats the brief.

**The call.** `arrangeDrums(spec, options)` reads only the spec: its input layers, knobs, timeline, `stats.grid` and parts. It never reads the row. A row's onsets are its layers' pulses (layer v strikes every grid / v ticks), so the onset nearest any place in the cycle is the nearest pulse of one of at most four layers. That makes arranging cost about 0.1 ms, even on the 16k row, so the lab re-arranges on the main thread with nothing re-composed. `compose()` ends with `spec.drums = arrangeDrums(spec, options.drums)`; `drums: false` leaves them out. The drums draw from a seeded generator of their own (`${seed}/drums`), so they never move one of Compose's draws, and every other field of the spec stays byte-identical whatever the drum mode (tested). `settle-baseline.mjs`' `normSpec` leaves the drums out, and the hashes didn't change.

**`spec.drums`:** `{ version, enabled, mode, options, kit, beats, partition, bars: [{ bar, mode, fill, crash, why }], hits: [{ voice, bar, pos, slot, tick, time, velocity, strikes, snap }], decisions, stats }`.
- Voices: kick, snare, hat, perc, cym. The kit is Audio/drums choices, `made:kick` etc. by default; `''` turns a voice off.
- `pos` is the stroke's place in its bar, in slots. `time` counts from the downbeat and is computed exactly as compose.js times a note, so a stroke on a note's onset sounds with that note.
- `snap` says how a stroke landed: `slot` (the nearest onset to its place), `wide` (found on the second look), `note` (a part's own onset) or `layer` (from the partition).

**How it works:**
- **Every stroke is an onset the row plays.** One correction to the brief: anchors are grid ticks, and only some of them are onsets. The downbeat is an onset (the phase is one of the root's onsets); the other anchors aren't, in general. So each stroke aims at a place in the bar and lands on the onset nearest it, within that place's window: half-way to the neighbouring places. For a whole slot, that's cells.js' swing-0.5 window, and the test checks each landing against cells.js' exact (BigInt) nearest node. If no onset is in the window, the stroke looks once more, a whole place either side (`wide`), and is otherwise left out (`silent`). On every preset and test row nothing needed the wider look and nothing went silent.
- **The beats.** The bar's S slots are cut in 4 beats the way Partitions cuts a block (cells.js `partitionSizes`, the PartitionsBlocks port), so any S works: S = 5 gives slots 0 1 2 3, S = 6 gives 0 2 3 5, S = 7 and 8 give 0 2 4 6, S = 11 and 13 give 0 3 6 9. Under 4 slots a bar, the bar is cut in S·m sub-slots (m = ceil(4/S), the way cells.js subdivides a small grid), and a beat between anchors lands on a real onset inside its slot. For S = 3 the beats fall at slots 0, 1, 1.5 and 2.5; 8:7:6:5 plays them that way.
- **backbeat (the default, from the brief).** Kick on beats 1 and 3 (the call on 3 was left to me), snare on 2 and 4, and a hat on every slot, with the beat slots a little louder. Bar 1's kick is the phase onset itself, at time 0.
- **with.** The backbeat, plus a perc stroke on every slot where the lead or the comping strikes, on that note's own onset (the lead's when both strike). It's accented where both strike, or on a strong slot.
- **against.** The backbeat, plus perc on the slots that both the lead and the comping leave empty, at most ⌊S/2⌋ a bar (at least 1). Off-beat slots come first, then the seed decides. This is the only mode that reads the seed.
- **partition (single level, from the brief's sliding downbeat).** Partitions' grid mode cuts the cycle from tick 0; here the cycle starts at the composition's downbeat.
  - **The layer** is one that strikes the downbeat (Avery's idea: phase × v is whole). If several do, the one whose pulses per bar are nearest S wins, then the slowest.
  - **The blocks** are its v pulses, counted from the downbeat. That's grid mode at P = v, and each block starts on one of that layer's onsets.
  - **What sounds** is Partitions' secondary pattern E(hits, v), turned so its first stroke is the downbeat (getSecondaryAllowedSet). The test runs `PartitionsDistribution.js` itself and matches it exactly.
  - **How many:** hits = min(v, N·S), about one a slot, or N·hitsPerBar when asked. The line plays on the perc, over the backbeat.
- **Curated patterns** (drum-patterns.js), written chunk-tunes style: `steps` per bar and an x per stroke (X for an accent), each step a fraction of the bar.
  - chunk-tunes' six (rock = its backbeat, four, funk, soca, bossa, shuffle), kept stroke for stroke.
  - New: halftime, son clave 3-2 and rumba clave 3-2 (two-bar patterns that restart at each phrase), and a phrase-end fill.
  - A stroke at fraction f lands through the beats: beat ⌊4f⌋, then its share of that beat's sub-slots, rounded. Patterns therefore agree with the backbeat's beats on any S, and an uneven beat stretches its subdivisions.
  - On 8 slots, rock is kick 0 4, snare 2 6, a hat on every slot. On 16 slots, funk keeps its sixteenths. On 3 slots, rock keeps four quarter strokes, on half slots.
- **Fills, a pattern per section.** The last bar of each phrase of 4 bars or more (harmony.js `phrasesOf`) plays the fill over its second half, from beat 3: snare in eighths then sixteenths, getting louder, with a kick under it. A crash opens the bar after the fill, which is bar 1 when the fill is in the last bar.
  - 41:42:43, 119:42:15:8 and 768:769 (4 × 8) fill bar 4; the 16k row (8 × 8) fills bars 4 and 8.
  - 8:7:6:5 (2 × 3) and 19:17:16:15 (2 × 8) don't fill.
  - `perBar: { bar: mode }` gives a bar its own mode.
- **Velocities.** Kick 0.85, snare 0.75, hat 0.3, perc 0.5, cym 0.55; +0.12 on an accent, and +0.04 for each extra layer striking that onset, so the row's own accents carry over.

**Lab.** A drums lane under the parts:
- Lane controls: a mode select (the four modes, then each pattern by name), a fills toggle, on/off and level.
- Lane display: a tick per stroke, one band per voice, with each bar's mode in its corner.
- **Drum kit row:** a sound per voice (off, the made kit, or the site's `assets/audio` samples).
- **Live changes:** any lane or kit change re-arranges from the spec while it plays, with nothing re-composed. A new Compose keeps the lane's options.
- **Playback:** the player books strokes on the same clock map as the notes, so the loop, the phase and live Tempo all apply. Strokes go through Audio/drums into a `drums` bus. Made sounds play at the stroke's velocity. A sample plays at the velocity × that made channel's `sampleLevel` (chunk-tunes' balance), and the made sound stands in until the sample loads.
- **Decisions and export:** the decisions list adds the drums' decisions and a row per bar (what it plays and why). JSON export carries the drums as they play.

**The deferred two-level prime partition** (built in step 4c: "Step 4c: drum grid and the prime partition" below). As Avery described it:
- **Level 1** lights a prime number of evenly spread lights over the cycle, from double to low triple digits.
- **Level 2,** the bars × slots partition, chooses which lit lights stay on. It treats them as a new even grid, whatever their uneven timing, and that adds a distinct swing.

The seam: `levelOneLights(grid, { source })` names the level-1 source and `selectLights(count, hits)` chooses among them. Source `'layer'` is today's single level. Source `'prime'` throws "deferred". Level 2 would be `selectLights(q, N·S)` over q prime lights, each landed on its nearest onset the way any stroke is.

**Heard so far:** nothing. Avery's browser and listening pass is owed.

**Open (for Avery):**
1. **Kick on 3:** kept in the default backbeat, with snare on 2 and 4 and a hat every slot. Hats every slot, or only on the beats?
2. **Partitions' beat order on odd S:** the block cut puts the long beat last on S = 5 (1 1 1 2) and first on S = 6 (2 1 2 1). Keep Partitions' order, or always put the long beat first?
3. **The partition layer when several strike the downbeat:** the one with pulses per bar nearest S (then the slowest). Or always the slowest, or the root's own layer?
4. **The partition's density:** min(v, N·S) hits is close to an even pulse on large layers (768:769 → E(32, 769); the 16k row → E(64, 4093)), and audibly uneven only on small ones (41:42:43 → E(32, 43)). Is that the swing you want from single level, or should hits per bar be a lab knob? It's in the API (`hitsPerBar`) but not in the lab yet.
5. **Fills** only on phrases of 4 bars or more, so 2-bar loops never fill. Every phrase end, or every second?
6. **with / against** read only the lead and the comping. Should the bass vote too?
7. **The partition line on the perc, over the backbeat.** Should it take the hat's place instead?

## Compose trace (built 2026-10-22 night, sprint)

**Asked (Avery, 2026-10-22):** animate Compose in two places, so people can see what happens under the hood. On the main page's Linear Plot, at a brisk but readable pace: how the root is chosen, how a lead line is chosen, the chords under it, the lead re-chosen and tested as the chords go back and forth, and the percussion coming in. In Cosmos: a rhythm's onsets drift up as dust, then are selected from and rebuilt into the composition. Both are renderers of one shared trace; this phase built the trace, not the renderers.

**Built.** `Composer/core/trace.js` (pure, like the rest of `core/`), with its contract in `Composer/TRACE.md`, checked by `Composer/tests/assert-trace.mjs` (19 checks).

- **Opt-in.** `compose(layers, T, { trace: true })` adds `spec.trace`. Off, the default, the spec is byte-identical to before; the e3909e1 baseline holds with the trace off, and on once the trace is taken off. On, the spec without `trace` is byte-identical to off on 89 composes (seeds, overrides, progressions, every drum mode, the full table): the trace observes and never steers. It never draws from the seed.
- **How it hooks in.** A recorder made by `createTrace(row)` is handed down the pipeline. The steps call `rec?.x(...)`, which a null recorder skips, arguments and all. Hooks:
  - `compose.js`: one call per step (row, root, meter, phase, cells, progression, harmony, bass bar, inner phrase, parts, drums)
  - `harmony.js`: `harmonize` takes `trace`; it reports each lead mining (its ranked lines), each derivation's chords and each settle round
  - `chooseChord` and `chooseChordOnRoot`: an optional `observe` callback sees every (root, quality) they rank, and, on a pinned bar, every quality rejected as unsupported
  - `frame.js`: gains `rankRoots`, `defaultRoot`'s own ranking spelled out (a shared `rootRanking`, so the two can't drift; its first is `defaultRoot`'s pick on every test row)
- **Content.** Ordered, untimed events (`row`, `root`, `meter`, `phase`, `cells`, `progression`, `lead`, `chord`, `settle`, `harmony`, `part`, `drums`, `done`). Onsets are referred to by row index. A `nodes` table spells each referenced onset (tick, ratio, cents, layers, strikes), so a renderer can place it without the row. Lines are referred to by id and held once in a `lines` table. Each lead event carries the chosen line and up to 3 runners-up with their costs; each chord event the top 6 (root, quality) candidates with their scores, the pick, any retune and, on a pinned bar, the fallback and the unsupported qualities.
- **The worker** passes `options.trace` through; the trace is plain JSON and survives the structured clone.
- **Pacing.** `traceTimeline(trace, { pace, seconds, budgets })` groups the events into beats (row, root, meter, cells, progression, line, chords, line2, settle 1..n, harmony, parts, drums, done) with relative starts and durations. It's pure (no clock), compressible, and about 6–8 s at pace 1.

**Measured** on the 16,359-onset row (8 × 8):
- **Size:** 109 KB of JSON lean (45 events, 323 onsets, 30 lines) and 96 KB full.
- **Time:** compose 660 ms off, 664 ms on (+0.7 %); full 1,722 vs 1,724 ms.
- **Trace off against the core from before the trace (d9f2f85):** unchanged, medians of 662 vs 655 ms lean and 1,753 vs 1,732 ms full.

**Proposed, not ruled:**
1. **The caps:** 8 root candidates with 12 sampled onsets each, 3 runner-up lines, 6 chord candidates, 256 notes a part and 512 drum hits. Raising them is cheap.
2. **The chord candidates** are the top 6 overall. That can be several qualities over one root; a per-root best might read better on the plot.
3. **The timeline budgets** (`TIMELINE_SECONDS`): chords and line about 0.9 s each, a settle round 0.45 s, and changed bars weighted twice unchanged ones.
4. **Where the trace lives:** `spec.trace`, so the worker needs no second channel. A JSON export that shouldn't carry it takes it off.

**Open, for Avery:** nothing to rule yet. The pacing and caps are for whoever builds the first renderer to tune, against the Linear Plot and the Cosmos dust layer.

## Composer tab on the main page (built 2026-10-22 night, sprint)

Avery's layout (the brief): a **Composer tab beside the Partitions tab**, in the same window. Partitions stays as it was. The upper-right Linear Plot stays visible and shows the Composer's selections live. Everything below that isn't the brief is **proposed, not ruled**. Nothing here has been seen in a browser yet.

**Open it.** Double-click the Playback panel's header, as for Partitions. The window's title bar now has a tab strip, **Partitions | Composer**. The Composer tab swaps the window's left half and lower right for its own. The mirrored plot (upper right) is shared by both tabs.

**What was built:**
- **Promoted, shared with the lab** (`Composer/perform/`). Both the lab and the tab use these; the lab's old module names re-export them.
  - `composer-controller.js` (was `lab/lab-controller.js`). New: `setInput({ layers, cycleSeconds })` takes the rhythm from outside, and a `beforePerform` hook. A change while Compose runs now drops that answer and turns the button back to Compose; before, a late answer could land on the new input. `kitChoices(voice, base)` takes the samples' base path.
  - `composer-player.js` (was `lab/lab-player.js`). New: an optional `destination` (default `ctx.destination`), at the planner's request for Cosmos. `timers` stays injectable and `tick()` public, so a host can drive the pulse itself. Both are tested in `assert-lab.mjs`.
  - `compose-runner.js`: the worker for the full table, the main thread for the lean one (moved out of the lab's view).
  - `readouts.js`: what a view says about a spec, as data. That covers the knob fields and what Compose chose, the readouts line, a refusal in plain words, the decisions rows, and the progression editor's and lanes' labels. Both views now say the same things the same way.
- **The page** (`Composer/page/`):
  - `plot-highlights.js`: **the seam.** It's a pure mapping from spec to per-part node highlights (`highlightsOf`), plus the playhead mapping (`playheadAt`, `playheadX`) and what sounds at a moment (`soundingAt`).
    - Each note's and stroke's absolute `tick` is found among the plotted onsets by an exact binary search, so every lit index is a real dot of the rhythm on the plot. A spec of another rhythm maps to `null`.
    - The playhead turns spec time into the onset at or before it, plus the way into its gap. The plot's x is by index, so it steps evenly from dot to dot.
    - A later sprint can animate Compose from its trace by handing the overlay one highlight set per step.
  - `plot-overlay.js`: draws them through **the draw hook**, `LRCVisuals.setComposerOverlay()`.
    - At the end of each Linear Plot draw, the overlay washes the row dark, leaving the invert button clear. Then it draws a dot in each part's colour on each of its nodes (drum strokes as squares). The selected part goes on top with a ring; a part that's off is drawn faint. Finally it snapshots the canvas.
    - During Perform, each animation frame blits the snapshot back, then draws the playhead line, a ring on the onset under it and a glow on each node that's sounding.
    - No dot of the row is redrawn per frame, so a 16k-onset row costs the same as 8:7:6:5.
    - With no overlay set, the Linear Plot draws exactly as before. The test checks this call for call against d9f2f85.
  - `tab-controller.js`: the shared controller, plus the page's rhythm, the one-sound rule, the selection and the memoized lit nodes.
  - `composer-tab.js` and `composer-tab.css`: the view.
  - `composer-bridge.js`: `window.lrcComposer` and the `lrccomposerready` event, the way `lrc-voices-bridge.js` exposes the voices.
- **Site edits, small and marked:**
  - `index.html`: the bridge (a module) and the CSS.
  - `PartitionsUI.js`: the tab strip, the two hosts, `setActiveTab` and `showComposerTab`. Leaving the window or the tab hides the Composer.
  - `LRCVisuals.js`: the hook, plus loops for the plot's min and max.
  - `LRCModule.js`: the `Math.max(...spacesPlot)` at line 245, and the same spread in `generateToneRowData`, are loops now. A 200k-onset plot works; the old code overflowed in Node.

**Behaviour (the brief), and the calls made (proposed):**
- **The rhythm.** Compose reads the current page rhythm: LRCModule's layers and Playback's cycle duration.
  - A new rhythm (`rhythmGenerated`) or a new cycle (checked each frame while the tab is shown) stops Composer playback and turns the button back to Compose.
  - New layers clear the progression (its ratios belonged to the old row); a new cycle keeps it.
  - **Proposed:** a cycle change counts as a rhythm change.
  - **Proposed:** a site layer of 1 is given to Compose as absent. A layer of 1 adds no onset of its own, and the site's readouts count only layers above 1.
- **One sound at a time.** Perform first stops main playback, and Partitions plays only under main playback. Main playback starting stops the Composer.
  - **Proposed:** leaving the Composer tab, or closing the window, stops it too, so the Composer only sounds while its lanes and plot are in view.
- **No auto-compose on open (proposed).** The lab composes at once, but on the page a 16k row takes about 1.7 s in the worker. You press Compose.
- **The plot.** The lit nodes show only on the Linear Plot. On another plot type, the tab shows a note and a "Show the Linear Plot" button; it doesn't switch the plot by itself (proposed), because switching plots stops main playback.
  - Lit nodes for a spec made on the same rhythm stay lit after a knob change, until the next Compose; the lanes behave the same way.
- **Part colours (proposed):** lead white, chords violet `#c56cf0`, comping pink `#ff9ff3`, bass blue `#54a0ff`, inner orange `#ff9f43`, drums red `#ff4757` (squares). They're chosen apart from the four layer colours. The **wash** dims the row to about 40% so the selections read on dense plots.
- **Layout.** Each lane head is a part's name (click it to select the part) and an on/off toggle. Sound, legato and level live in the inspector, per the brief.
  - Tempo and Glide sit in the header: they're global to Perform.
  - The inspector opens on the section the part belongs to: chords → Harmony; lead, comping, bass and inner → Lines; drums → Drums. Any section can be picked by hand.
  - Under Harmony: the progression editor, modulation, settle passes and root presence. Under Lines: bars, slots per bar, anchors, the table and glide. Under Drums: mode, fills, on/off, level and the kit. Under Tuning: the frame, the root, baseHz, and each bar's chord and offset.
- **The window remembers the tab** it was last on while the page is open (no storage), and reopens there.
- **Audio.** The Composer makes its own AudioContext on the first Perform and feeds its own limiter into the destination. It doesn't pass through the main page's master or effects (`AudioEffects.js`), and there's no MIDI out.

**Tests** (Node, over a small DOM in `tests/dom-stub.mjs`, with the site's own classic scripts loaded in a vm by `tests/site-scripts.mjs`):
- `assert-page-highlights.mjs` (94 checks): every lit index is the site's own onset at the note's tick, per part, on 8:7:6:5 up to the 16,359-onset row. It also covers the playhead mapping, what sounds when, and the overlay's drawing on a recording canvas.
- `assert-page-tab.mjs` (34): the rhythm, cycle and layer changes, a change mid-compose, one sound at a time through an injected host, the progression and drums carried, the selection.
- `assert-page-view.mjs` (38): the bridge's exports, and the tab end to end (Compose, lanes, Perform, frames, main taking over, the inspector, the Linear Plot note, a rhythm change, a refusal, hide). It also runs the lab on the shared modules.
- `assert-page-site.mjs` (27): every path index.html references exists, and the module graph resolves. It also covers the LRCModule fix (with the old version overflowing), the LRCVisuals hook (identical with no overlay), and PartitionsUI's tab strip.

**Open (for Avery):**
1. **Playback across tabs.** Should the Composer keep playing when you switch to the Partitions tab, so you can look at its controls while listening? Built: it stops.
2. **The wash.** Is dimming the row right, or should the row keep its layer colours under the lit nodes? And are the part colours readable?
3. **Other plot types.** Should the lit nodes also show on the Wheel or Centrifuge, or is the Linear Plot enough?
4. **The Composer's audio path.** Should it go through the page's master and effects (and MIDI out), or stay on its own graph as built?
5. **Auto-compose on open** for small rows, as the lab does?
6. **Zoom into a section** (decided as later): the lanes have one column a bar. The Linear Plot gesture (cmd/alt+scroll) is suspended while the window is open, as it is for Partitions.
7. **Found, not fixed** (fixed 2026-10-23, sprint 2 step 1: see "Composition lens and store"): in Node, `LRCModule.calculateTotalLCM(...activeLayers)` returns NaN for fewer than four layers. `lcm(x, undefined)` is NaN, so a rhythm entered with blank layers (768:769 with C and D empty) gets a NaN grid. Entering 1 for an unused layer works. This is untested in a browser; worth a look as its own live-site fix.

## Cosmos Compose mode (built 2026-10-22 night, sprint)

Cosmos's Rhythm and Grid cards gained a COMPOSE button (phase E1: audio and logic; the dust and the choreography are E2). The cross-project calls are here; the Cosmos side is in `Cosmos/engine/cosmos-compose.js`'s header, and the seam survey is the git-ignored `Cosmos/docs/composition-survey-2026-10-22/REPORT.md`.

**Decided (Avery, 2026-10-22).**
- A Rhythm card composes its one rhythm. A Grid card (a bloomed grid) composes a **superrow** of the grid's rhythms up to a budget; a huge grid composes a window of itself, never a refusal. "Fitted of visible" is the barometer.
- The ambient bed is silenced completely while a composition plays, and restored after.
- The composition takes over Cosmos's clock (which SPEED drives as an onset density) at its own tempo, and hands it back when it ends.
- The player keeps flying; the composition stops when the player leaves and the grid falls out of range.
- The drums are the Composer's, as they are.

**The superrow (`core/superrow.js`; proposed).**
- Every rhythm of a Cosmos bloom has lcm = G, so the superrow lives on G's own ticks: no LCM problem, and G < 2^24 is far under the 2^53 gate.
- A node is a distinct (tick, tone) pair, each onset keeping its own rhythm's tone (chunk-super-row's rule). Strikes are summed and saturated at 255; octave is the lowest merged.
- `layers` are the pulses: the 4 commonest layer values of the admitted rhythms, `owners` where each strikes. Comping and the drums' partition light read these.
- A one-rhythm superrow is that rhythm's row, field for field, and composes to the identical spec, drums included (`tests/assert-superrow.mjs`).
- **compose() takes a prebuilt row:** `compose(layers, T, { row })`, read as `arguments[2]?.row` in place of `buildRow(layers)`. That is two lines in `compose.js`, marked; the signature line is untouched, to keep the merge with the trace clean. Pass `row.layers` as `layers` so the spec's input and the drums read the pulses.
- **The window** is a fill over the caller's order. Cosmos orders the rhythms inside the card's cardinality band nearest the focus: the last node clicked in that bloom, else the eye at press time, fixed at press.
  - It skips a rhythm over the gate alone, or over the budget alone (a rhythm's own onsets are distinct ticks).
  - It counts a candidate's room exactly, by its NEW (tick, tone) pairs only, so a rhythm whose onsets are already nodes is free.
  - The budgets: Θ nodes (Cosmos's tier key `composeBudget`, 16k / 65k / 262k / 262k), Σ ≤ 2^21 source onsets, and the gate (1,048,576) as the ceiling.
  - A work cap (2^23 onsets examined) bounds monster grids; what it doesn't reach is `unreached`.
- Node → (rhythm, onset) members go back as CSR arrays, the dust E2 needs.
- `superrow-worker.js` builds and composes in one module worker. On the survey's grids, the whole job takes 0.5–2.4 s at every budget, monsters included: 166,320 at Θ 65k is 51 rhythms in 0.9 s, and 7,920 composes whole in 2 s.

**Tempo (proposed).** Both kinds choose their own cycle: `cycleSecondsForTempo(n)` picks N bars of the 8, 4, 2, 1 the row holds without going sparse, at T = 240·N / 110. Compose's `chooseMeter` then lands exactly on N bars at 110 BPM and never halves N. It is never T = n / rate (for a superrow, that would put the tempo near 1 BPM). While a composition plays, Cosmos's SPEED knob is held (it dims and reads the composition's BPM). A value set meanwhile waits for flight.

**The player.** `Composer/lab/lab-player.js` is imported by exactly one Cosmos file, `Cosmos/audio/cosmos-composer-player.js`, so Phase C's move is a one-line re-point.
- The player runs with `timers: {}`; its `tick()` is called by Cosmos's worker-driven transport pulse, with Cosmos's 250 ms horizon.
- The shared player (`Composer/perform/composer-player.js`) is given Cosmos's composition bus as its `destination` (the merge replaced E1's temporary `wrapContext` proxy).
- The composition does not go to MIDI out in v1.

**Open (for Avery).**
1. **Superrow strikes.** Summed strikes pin comping's accent (0.1 × (strikes − 1)) at velocity 1 on a wide superrow. `strikes: 'log2'` is built as the alternative; the default stays `'sum'`.
2. **The duplicate rule.** Should the same tone at the same tick from two rhythms stay one node (built), or two?
3. **The focus.** Is it the last node clicked in the bloom, else the eye (built)? Or the bloom's centre?
4. **The stop radius.** It is one cell inside the tier's evict shell after a 400 ms dwell, faded over the 2 cells before (Low: fades from 7 cells, stops at 9 of 10).
5. **The seed.** It is fixed at 1, so the same target gives the same composition. Should a second press reseed?
6. **A five-layer rhythm** can't be composed (the row reads at most 4 layers). Blooms don't make them today.

## Compose animation on the main page (built 2026-10-22 night, sprint)

**Asked (Avery, 2026-10-22):** animate what the Compose button does, even if it makes Compose a little slower. Show how the root is chosen, how a lead line is chosen, how chords are chosen under it, how the lead is re-chosen and tested as the chords go back and forth, and how the percussion comes in. Brisk but readable. Everything below that isn't the brief is **proposed, not ruled**. Nothing here has been seen in a browser yet.

**How it runs.** With **show the work** on (a toggle in the tab's header, on by default):
1. Compose asks for its trace (`{ trace: true }`, through the worker). While it runs, the plot washes dark and a soft band sweeps it with "composing…" in the corner. No step is shown before the trace is back (proposed: compose first, then animate; the simplest honest order).
2. The trace plays on the Linear Plot and in the tab, paced by `traceTimeline` with the page's own beat budgets (`ANIMATION_BUDGETS`), fitted into 4–7.5 s. Measured: 7.45 s on 8:7:6:5 and 41:42:43; 7.5 s on the 16k row, fitted down from 8.0 s.
3. It ends exactly on the lit nodes the tab already draws, and the plot goes back to the overlay's ordinary draw. Perform then works as before.

**What each beat shows** (`page/trace-frames.js`):
- **Row:** a scan line sweeps the plot.
- **Root:** the candidates pulse in turn, weakest first, each on its sampled onsets, sized by presence. The caption names each ratio and how often its ±frame cluster is heard. The rejects turn grey and fade; the winner holds in the accent green, with a burst.
- **Meter and phase:** the bar lines sweep in; the downbeat candidates flash in turn and the chosen downbeat bursts.
- **Cells:** the slot anchors tick in, each with a bracket under the plot spanning its window.
- **Lead:** the runners-up are drawn as faint lines through their onsets, then fade; the chosen line draws in white, note by note. It stays on the plot until the lead part lands.
- **Chords:** a bar at a time, the bar tints violet. Its candidates flick through on their root onsets and in the chords lane, weakest first. Then the pick's root rings and its chord tones light: the bar's trace onsets whose class from the root is one of the chord's intervals, within the frame (harmony.js' own test).
- **Lead again and settle rounds:** the held line pulses while a new one is tested against it. If the held line wins, it brightens. If it loses, it turns amber and fades while the new line draws in. A settle round flashes its changed bars in amber, in the lanes too; a converged round glows green once.
- **Parts:** each part's notes cascade in, in time order and in its colour, each with a small pop. Its lane fades in as it starts.
- **Drums:** the strokes drop into place bar by bar, as squares.

**The tab meanwhile.**
- A caption above the lanes shows the step and a line of detail (for example "the held line costs 0.6398 vs a new one at 0.3985 → the new line wins"). Under it, a strip of beats lights up as they pass.
- The lanes wait, faint, until their part lands. The readouts and decisions are hidden until the end (proposed, so the answer isn't given away).
- The Compose button says **Skip ▸**.

**Skip and cancel.**
- **Skip:** the Skip button, a click anywhere in the tab, a click on the plot (the window's mirror canvas) or Esc jumps to the end.
- **Cancel:** any change drops the animation, with no stale draw: a knob, the seed, a selection, a part toggle, the rhythm, main playback starting (even while Compose is still running), leaving the tab, or turning show the work off. A change of knob or seed then shows the spec's lit nodes as before a change, and the button goes back to Compose. A new rhythm lights nothing.

**Show the work off** is the tab exactly as it was: Compose asks for no trace, there's no shimmer or caption, and the spec lands at once. The setting is kept in `localStorage` (`lrc.composer.showWork`, `'0'` or `'1'`). Every access is wrapped, so a storage that throws (a private window) reads as on.

**Only the Compose button animates (proposed).** A lean-table auto-recompose after a knob change doesn't.

**Performance.**
- The overlay keeps its snapshot/blit approach. While animating, the overlay's draw washes the plot and snapshots it with no lit node (the base). Each animation frame is one blit of that base plus what the frame names.
- Frames are bounded by the trace (its 323 onsets on the 16k row) plus the final lit nodes, never the row.
- Measured on the 16,359-onset row: at most 309 nodes a frame and at most 412 canvas marks and segments, against 16,359 onsets. Building the scene takes about 0.5 ms and a frame about 0.006 ms.
- The trace itself adds under 1 % to Compose (TRACE.md).

**Code.**
- `page/trace-frames.js`: **pure.** `buildScene({ trace, plot, final })` reads the trace once against the plot: every trace `node` is found among the plotted onsets by its tick, and the bars, slot windows and chord tones are found too. `frameAt(scene, t)` gives the draw state at t: marks on onsets, polylines through onsets, rules, bar bands, slot brackets, the row's sweep line, the parts landed so far and the lanes' state. At t ≥ the end it gives exactly the final lit nodes. Cosmos's dust renderer could follow the same pattern: build a scene, then ask it for frames.
- `page/compose-animator.js`: the driver (idle → waiting → playing → idle, on an injected clock: `wait`, `start`, `skip`, `cancel`, `tick`), the painter (`paintFrame`, `paintShimmer`), and the setting's storage.
- **Small edits:**
  - `plot-overlay.js`: `setScene` and `paint`. `drawLitPart`, `partOrder` and `litRadius` are now exported, so the painted last frame draws dots exactly as the overlay does.
  - `tab-controller.js`: `view.showWork` and `setShowWork`; Compose asks for the trace when it's on; `onMainStarted`.
  - `composer-tab.js`: the toggle, the caption, Skip, the wiring.
  - `composer-tab.css`: the caption and the lanes' states.
  - `composer-bridge.js`: passes `clock` and `storage`, and exposes `animator`.
  - `perform/composer-controller.js`: `compose({ trace })` keeps the trace apart from the spec, in `state.trace`, so the spec, the lanes and JSON export are the same either way.
  - `perform/compose-runner.js`: forwards `trace`, both ways.
- **Tests:** `tests/assert-page-animate.mjs` (144 checks).
  - The frames run forward, the parts only gain nodes, and the last frame is exactly the tab's lit nodes, on 7 cases from 8:7:6:5 to the 16k row. Those include re-arranged drums and a pinned progression.
  - Every node a frame draws is a plotted onset that the trace or the lit nodes name.
  - Each beat's story is there.
  - Per-frame counts stay bounded on the 16k row.
  - The painted last frame matches the overlay's own draw, dot for dot.
  - End to end in the tab: skip, cancel on each change (with no draw after), the toggle off as before, and storage.
  - `assert-page-view.mjs` now runs with the setting off (stored `'0'`): it's the tab as it was.

**Open (for Avery):**
1. **The pace.** About 7.5 s, fitted. Is that brisk enough, or should a small row run shorter than a big one? On the 16k row the chords get about 0.13 s a bar (2 flicks), and the unchanged bars of a settle round only blink.
2. **Hiding the readouts** until the end, or keeping them visible throughout?
3. **The colours.** The root and the selections are in the window's accent green, the candidates pale grey, a change amber, and the chords in their part's violet.
4. **Chord tones** are lit only among the onsets the trace names in that bar (its slots' nearest onsets, the lead's notes, the root samples), not every onset of the bar. That keeps a frame bounded on the 16k row. Light every onset of the bar's chord classes instead?
5. **Skip on any click in the tab** may be too eager. Esc and the Skip button might be enough.
6. **Auto-recompose** (lean table, a knob change) doesn't animate. Should it, maybe faster?

## Cosmos onset dust and choreography (built 2026-10-22 night, sprint)

**Asked (Avery, 2026-10-22):** Cosmos blooms a grid into its rhythms, but has never bloomed a rhythm into its onsets. In Compose mode those onsets appear as tiny cosmic dust, a pool; the pool is selected from, and the composition is rebuilt from it. Then the dust stays in sync with the composition as it plays: it shows what's under the hood, "a treat for playing with the system". The black orb could expand into a blank canvas for it. On a Rhythm card only that rhythm's dust animates; on a Grid card many rhythms feed one superrow pool. The player keeps flying, and the composition stops out of range (E1). Everything below that isn't the brief is **proposed, not ruled**. Nothing here has been seen in a browser yet.

**The picture is the music: a clock face of the cycle.** It sits in a unit disc around the composing grid.
- A mote's **angle** is its onset's place in the cycle, tick / grid, clockwise. Once the phase is chosen, 12 o'clock is the downbeat.
- Its **radius** is its tone: the cents within the octave, from 1/1 at 0.30 to 2/1 at 0.92. Each tone is a ring, and time runs along the spokes.
- Its **height** is its register: z = the note's octave. The painter scales by 1 / (1 − 0.12·z), so the lead sits just outside its tone ring and the bass inside it.
- The drums sit on their own ring outside the face: kick 1.00, snare 1.05, perc 1.08, hat 1.11, cymbal 1.15.

**The motes.** There are three populations, drawn in this order:
- **Grains (the pool).** The onsets the composition was made from, sampled evenly and jittered off their exact place, like a nebula.
  - On a Rhythm card they are its row's onsets, sampled in the worker (up to 10,000).
  - On a Grid card they are the superrow's **source** onsets: every (rhythm, onset) that merged into a node. A node gets dust in proportion to the rhythms striking there.
- **Keys.** Every onset the compose trace names, at its exact place. These are what the selection lights.
- **Voices (the composition).** One per spec note (part, node, chord voice) and one per drum stroke, in the part's colour. They use the main page's colours (`PART_COLORS`).

**The phases.**
1. **Bloom-out** (0.9 s). The grains and keys stream out of their rhythm's node in the bloom and into the pool. On a Rhythm card that's the one node; on a Grid card it's every admitted rhythm's node. The start positions come from the draw loop's own lattice, seen on the view plane.
2. **Selection.** The trace's timeline, using the page's beat budgets with the dust's own stress (`DUST_BUDGETS`), fitted to 3 s:
   - the row: a hand sweeps the pool;
   - the root: the candidates' sampled onsets pulse in turn, weakest first; the rejects grey out and the winner holds in green;
   - the meter: the bar spokes ring in;
   - the phase: the downbeat candidates flash, then **the whole face turns until the chosen downbeat is at 12 o'clock**;
   - the cells: the slots tick in on the rim;
   - the lead: the runners-up are faint filaments through their notes, and the chosen line draws in white;
   - the chords: per bar, the bar's arc tints, the candidates flick on their roots, and the pick's root and chord tones light;
   - the settle rounds: changed bars flash amber, and a converged round flashes green once;
   - the parts: each part's voices rise, in time order, from their onset's place to their register, in their colour;
   - the drums: the strokes drop onto the drum ring, bar by bar.
3. **Performance.** The voices sit on the face, with a hand at the audio playhead and faint bar spokes. The lead and bass are drawn as faint filaments through their notes in time order. Each booked note (`onNote`, ~250 ms ahead) flashes its own voice when the audio clock reaches its `when`, so the flash lands where the hand is. The grains drift as a faint halo in three slow bands.
4. **Dissolve** (0.8 s) on any stop. The director then clears.

**Timing (proposed): the audio starts at once.** E1 performs on 'composed', and the selection is compressed to 3 s (`SELECTION_SECONDS`). Notes flash the dust from the first one, including during the selection, where the voice sits before it lands. A click on the canvas, or Esc, during the bloom-out or the selection skips to the performance. The alternative, holding the audio until the selection ends, would delay E1's perform and keep the flight bed playing meanwhile. It's not built.

**The veil.**
- While the worker composes, the orb's veil swells to 0.35.
- From 'composed', it rises to 1 over 0.6 s, times E1's range `level`. It's full at level 1 and thins as you fly away, so leaving reads as the composition dissolving.
- It goes down with the dissolve.
- The face starts on the bloom's own disc (its projected centre and radius) and moves to the canvas centre as the veil rises: the orb becomes the canvas.
- **Under a full veil the loop skips what it hides** (a cull, not paint-over): the cube walls, the Web frame, the connectors, the constellations, the ships, the stars (draw and pick), the blots and every bloom cloud (draw and pick). The ship in chase view stays: it's you.
- A canvas click under a full veil does nothing, so it can't close the card.
- Below full, the composing grid's nodes give way (`dustNodeDim`). The chosen rhythm (or the admitted rhythms) fade more slowly than the rest, so on a Rhythm card you see only its rhythm's dust leave (proposed: dim, not hide). Other blooms fade with the veil.

**Caps (proposed).**
- **Motes a frame,** by the tier key `dustMax`: 1,500 / 3,000 / 6,000 / 10,000 (Low → Ultra). Voices come first, then keys, then grains sampled evenly into the room left.
- **Fixed per frame:** 160 sprite glows, 96 flashes, 12 filaments, 96 lines and 24 arcs.
- **Deterministic:** the jitter is a hash of the mote, never `Math.random`.

**Drawing.**
- The cosmos-perf lesson holds: there is no gradient per mote.
- Motes are batched: one `Path2D` per (colour, 1/16 alpha band, 0.5 px size bucket), with squares under 2.2 px and arcs above. They're added with `'lighter'`. 10,000 motes take about 16 fills.
- Glows are a `drawImage` of a sprite baked once per (colour, size bucket, DPR).
- It's DPR-aware: no mote is under one device pixel.

**Measured** (Node, M4 Max). The scene was grid 27,720: 451 rhythms → 141,542 superrow nodes, with a pool of 2,097,094 source onsets.
- At Ultra the scene has 10,000 motes: 236 voices, 337 keys and 9,427 grains. It builds in 8 ms, once.
- `frameAt` takes 0.29 ms in the bloom-out, 0.12 ms in the selection and 0.17 ms in the performance.
- The painter's JS (its batching, on a stub canvas) takes 0.37 ms a frame. The raster cost needs Avery's browser.

**Code.**
- `Cosmos/engine/compose-choreo.js`: **pure**. `buildDustScene`, `frameAt` (a struct-of-arrays frame), `createDustDirector` (the lifecycle from E1's events, on injected times) and `dustNodeDim`.
- `Cosmos/ui/compose-dust.js`: the painter and `dustView`.
- **Small edits:**
  - `flight-view.js`: the `COMPOSE DUST (E2)` blocks.
  - `cosmos-compose.js`: `trace` and `dust` options. The trace and dust are taken off the spec before it plays and ride on 'composed'. Off, E1 is exactly as it was.
  - `compose-worker-client.js`: `rhythm()` carries `dust`.
  - `compose-worker.js`: `options.dust` → `sampleRowDust`. The row is built once and handed to compose; the spec is unchanged.
  - `superrow-worker.js`: the reply gains `toneCents` and `octave`.
  - `cosmos-quality.js`: `dustMax`.
- **Tests:** `Cosmos/tests/assert-compose-dust.mjs` (75 checks). `assert-superrow.mjs` checks the new reply fields and the superrow's trace; `assert-cosmos-quality.mjs` checks that `composeBudget` and `dustMax` are non-decreasing.

**Open (for Avery).**
1. **Audio at once, with a 3 s selection,** or hold the audio for a slower selection (6–8 s, as on the main page)? At 3 s the root's candidates get about 30 ms each.
2. **The full veil for the whole composition.** You fly blind until the fade's last 2 cells. Should the veil hold somewhat below full (say 0.85), so the cosmos glimmers through?
3. **The face:** a clock with tone rings. Or the bars in a ring around the star? Or the face fixed in 3D space, instead of a screen-facing canvas?
4. **On a Rhythm card, dim or hide** the other nodes of its bloom (built: dim, until the full veil hides them)?
5. **A click under the full veil** does nothing. Should it skip, stop, or pick through?
6. **The grains:** jittered off their place (a nebula), or exact?
7. **Parallax:** the face is screen-facing. A small parallax with the camera's turn would make flying feel more present.

## Composition lens and store (sprint 2, step 1; built 2026-10-23)

The model (Avery agreed, 2026-10-23; `SPRINT2_ORDER.md`): a composition is a **reading of the row**, not a second player. A glyph in the header toggles the canvas between the row and its composition, and the one Play/Stop plays whatever the canvas shows. Everything below that isn't the order is **proposed, not ruled**. Nothing here has been seen in a browser yet.

**The store** (`Composer/store/composition-store.js`, pure).
- **One entry per rhythm + cycle** (`rhythmKey`: `8:7:6:5@4`, the layers as four whole numbers). An entry *is* one composition's state, the shape the shared controller acts on (`newCompositionState`): the input, knob overrides, table, spec and trace, the parts as they play now (on/off, sound, legato), their levels, the drum options and drums, the progression, the playback tempo, and the status and dirty flags.
- **The controller binds an entry** (`composer-controller.js` `bind(state)`, sprint 2). The page's tab controller selects the page's rhythm in the store and binds that entry, so `tab.state` is the current rhythm's composition. A bind stops playback. The lab keeps the state it starts with, unchanged.
- **One compose in flight per entry.** Compose on a composing entry joins the compose in flight (the same promise). A compose lands in the entry it was started for, even after the page has moved on: it is cached, not dropped (before sprint 2 the tab dropped it). A change to that entry while it composes drops the answer, as before.
- **The LRU keeps 4 rhythms (proposed).** The least recently selected goes first, never the current one and never one composing (the store runs over its capacity until that compose lands).
- **A new cycle of the same layers** starts from that row's last entry's edits: seed, knobs, table, progression, drum options, levels and glide. It doesn't take the spec (proposed: the edits belong to the row, the spec to the row at that cycle). New layers start fresh.
- **Recall** (`recallable`): an entry with a spec that isn't refused, and isn't **dirty**. Proposed: a seed, knob, table or progression change since the last Compose makes the glyph compose again; live edits (parts on/off, sounds, legato, levels, drums) don't, and they're in the recall. A clean refusal is known (`refused`), so the glyph says why with no re-solve.
- **The lens** (`'row' | 'composition'`) and `subscribe` (select, lens, made, change, evict) live here too. `made(key, by)` records whether the glyph or the window made the last spec (informational; step 2's "first compose vs cached" reads the lens's `recalled` instead).

**The lens** (`Composer/page/lens.js`).
- **Row → composition** (the glyph pressed, a rhythm on the page):
  - main playback stops;
  - **proposed:** on another plot type the canvas switches to the Linear Plot, and the prior type comes back with the row;
  - the overlay seat is claimed, so the lit nodes and the playhead are on the main canvas whether the Composer window is open or not;
  - the panels adapt (below).
  - Then a **recall** plays at once (no Compose, no animation). With no composition yet, it **composes**: with "show the work" on, the canvas shimmers, the trace is animated on the main canvas (the existing animator, the lens's own instance), then it plays.
  - **Proposed:** Esc, a click on the main canvas, or Play during the animation skips to the landing and plays. Play while Compose runs waits.
- **Composition → row:** the glyph again, a new rhythm, a new cycle (noticed on the next frame), the row started by another path, or a plot type picked by hand.
  - The animation is dropped and the composition stops; it stays in the store.
  - The seat is released, so with the window closed the plot draws exactly as before (call for call, tested on the real LRCVisuals).
  - The panels and the plot type are restored.
  - **Proposed:** a plot type picked by hand under the lens goes back to the row, and the pick stands (the lit nodes are the Linear Plot's).
  - **Proposed:** the glyph pressed during Compose goes back to the row at once; the compose lands in the store, unplayed.
- **A refusal or an error** goes back to the row. The glyph's tip says why ("Compose — Too few tones: …") until the next rhythm.
- **The one transport.** `ToneRowPlayback.togglePlayback` hands Play/Stop to `lrcComposer.transport` while the lens owns it. Under the lens it plays and stops the composition through the shared player (the controller's `perform`/`stop`, so one thing sounds at a time). Stop keeps the composition and the lens. Under the row lens nothing changes. `updatePlayButton` and the Partitions window's button show whatever the canvas plays.
- **The window under the lens** edits the same entry. **Proposed:** closing it, or switching to its Partitions tab, no longer stops playback while the lens owns it.

**The glyph** (`Composer/page/toolbar-glyph.js`, the markup in `index.html` as `#composition-glyph` so a tutorial can find it).
- Beamed eighths in an inline SVG, in a 42 × 28 chip like the Cosmos button, placed before it. No text.
- **States** (`data-state`): hidden (no rhythm) → ready → composing (a shimmer) → lit (the lens).
- **The breath:** it breathes once a session, the first time it's ready (`sessionStorage` `lrc.composer.glyphBreathed`, every access wrapped).
- `aria-pressed` is the lens. The tooltip (`data-tip`, shown on hover and keyboard focus) says "Compose" or "Back to the row". It's a `<button>`, so Enter and Space work. `prefers-reduced-motion` turns the breath and the shimmer off.

**The panels.**
- **Part strips** (`part-strips.js`). The layer strips' grammar: a row of six part buttons (Lead, Chords, Comping, Bass, Inner, Drums, bordered in the part colours) over the picked part's controls (Mute, Sound, Level). For the drums, Sound is the pattern (proposed).
  - Picking a part picks it in the window too (its inspector, and the ring on the plot).
  - A change in either view shows in both: levels through the controller's new `onLevel`, so neither slider re-renders mid-drag; everything else through `onChange`.
  - **Proposed:** each part button carries a dot in the colour of the layer that strikes most of its lit onsets.
  - The layer strips are only hidden, and the Layer Controls header reads "Part Controls" meanwhile.
- **Scale Selection** (`panel-locks.js`): locked with ProgressionBar's `_lockScale` pattern, under its own class (`composition-locked`) so the two locks never undo each other. It's alive as a readout:
  - playing, the rows of the current bar's chord tones light up (the chord voices' tones that bar, plus its root), and the count reads "3 in Cmaj7 · bar 2";
  - **proposed:** stopped, every tone the composition plays is lit;
  - the Composer's exact fractions match the site's spelling (checked on three rows), with a ½¢ fallback;
  - rows are painted by class, with no rebuild and no write to the selection; on the row the chart is rebuilt from the playback's own selection.
- **Families:** locked, with the note "the composition is choosing; return to the row to edit".

**The page API for steps 2 and 3** (`window.lrcComposer`):
- `lens`:
  - `press({ pace })`, which resolves to the phase once it settles
  - `toComposition`, `toRow`, `skip`
  - `mode`, `phase` (`idle`, `composing`, `animating` or `landed`), `glyph()`, `refusal`, `priorPlot`
  - `onChange(fn)` with the events `composing`, `animating` (with the scene and pace), `landed` (`recalled`), `row`, `change` and `glyph`
- `transport`, `store`, `glyph`, `seat`, `panels`.
- **The `pace` seam:** `createComposeAnimator().start({ …, pace })` scales the scene's clock; the scene itself is unchanged.
- Step 2's scrim can hang on `composing`/`animating` and lift on `landed`. Step 3 calls `lens.press({ pace })` after generating.

**Site edits** (small, marked `COMPOSITION LENS (sprint 2)`):
- `index.html`: the glyph and its stylesheet, with versions bumped.
- `ToneRowPlayback.js`: `togglePlayback`, `updatePlayButton` and a new `transportIsPlaying`.
- `PartitionsGlobalControls.js`: `updatePlayButtonState`.
- `LRCModule.js`: **the live-site LCM bug.** `calculateTotalLCM(...layers)` now skips missing, zero and non-numeric layers, and returns 0 with none. A rhythm with blank C and D used to get a NaN grid. Four layers give exactly the old grid (400 random rhythms, checked against the old code).
- No edit to `LRCVisuals.js`, `PartitionsUI.js`, `Cosmos/` or the lab.

**Tests:**
- `assert-store.mjs` (38): keys, the entry shape, select and the carry-over, the LRU, events, the lens, recall without re-solve, the in-flight rules.
- `assert-page-lens.mjs` (77), over the real LRCModule (generating from the inputs), the real LRCVisuals, ToneRowPlayback's transport methods and PartitionsGlobalControls in a vm. It covers:
  - glyph states and the breath;
  - compose → animate → play on the main canvas; the playhead with the window closed;
  - the scale readout bar by bar; the transport;
  - strips ⇄ window for mute, sound, level, drums and selection, and the layer dot;
  - the row restoring everything (the plot call for call);
  - cached recall with the window's edits; a new rhythm; a new cycle;
  - skip by Esc, click and Play; press during Compose; pace;
  - the plot-type switch and restore; 768:769 with blank C and D, end to end; a refusal.
- `assert-page-site.mjs` (+13): the glyph markup, the stylesheet, the lens's modules in the graph, the LCM fix (old vs new), and the row lens's transport unchanged.
- Two existing tests changed with the model: `assert-page-tab.mjs` (a new key is a fresh, idle entry; the old one cached) and `assert-page-animate.mjs` (it reads `tab.state` live).

**Open (for Avery):**
1. **Recall vs dirty.** Should the glyph recall the last spec even after a seed, knob or progression change in the window (built: no, it composes again)?
2. **The glyph back to the row stops playback** (the planner's call, built). Or should playback carry over to the row?
3. **The window's own Perform** still plays the composition with the lens on the row; it doesn't flip the lens. Should it?
4. **The Partitions window's Play** under the lens plays the composition too (one transport). Is that right inside Partitions?
5. **Stopped readout:** all of the composition's tones (built), or the first bar's chord?
6. **The part strips' grammar:** one part's controls at a time, like the layers (built), or all six as compact rows?
7. **ProgressionBar open under the lens:** its own lock paints the scale chart every frame, so the two readouts would fight. Close it on entering the lens, or leave it? (Step 2: the bar yields the chart to the lens; see "Theater".)
8. **Module caching:** the bridge's imports carry no `?v=`, so a browser pass needs a hard reload after pulling. (Step 2: no clean fix; see "Theater".)

## Theater (sprint 2, step 2; built 2026-10-23)

The order (`SPRINT2_ORDER.md`, step 2): during a rhythm's first animated compose, a scrim dims the page around the canvas, the caption floats on it, any click or Esc skips, a recall plays a short version, reduced motion jumps to the landing, and callers get a `pace`. Everything below that isn't the order is **proposed, not ruled**. Nothing here has been seen in a browser yet.

**The module** (`Composer/page/theater.js` + `theater.css`, `lrcComposer.theater`). It's driven by the lens's events and owns no clock; it draws nothing on the canvas.
- **The scrim** is one class, `composition-theater`, on `<body>`. `theater.css` dims four of the five HUD panels (Rhythm Input, Rhythm Info, Visualizations, Search) and the header's title and buttons, and lights the glyph.
  - **Proposed:** the Playback div stays lit ("the other four divs"): its part strips are where the performance takes over when the scrim lifts. Dimming all five is one selector in `theater.css` (and `THEATER_KEEP`).
  - Nothing on the panels themselves is written, so removing the class restores them exactly (tested: each panel's and the header's class, style, attributes and dataset, before and after).
  - It goes up on `composing` (with an animation coming) and stays through `animating`. It lifts on `skip`, `landed` and `row`, and fades through `composition-theater-lifting` for 320 ms.
- **The caption** is the animation frame's own label and detail (the trace's captions), in a box of its own fixed under the header, over the canvas. Under the full show it also says "click or Esc to skip". It's made when shown and removed when hidden. The short version gets the caption but no scrim (**proposed**: dimming the page for 1.5 s would flash).
- **Skips while the scrim is up** (capture-phase listeners on the document, removed with the scrim):
  - any click, except on the glyph, skips to the landing and is swallowed, so a click meant to skip doesn't also press the button under it (**proposed**);
  - a press (`pointerdown`, `mousedown`, `touchstart`) is swallowed too, so no panel drag starts under the scrim; it doesn't skip;
  - Esc skips; other keys pass;
  - the glyph is the cancel: back to the row.
- **During Compose** (the shimmer), a skip is **queued** (`lens.skip()` now does this): the scrim lifts at once, the shimmer runs on, and the compose lands straight on the landing, unanimated. Esc and a canvas click do the same in the lens itself, so this works without the scrim (a short re-compose).
- **A window opened mid-show** (Partitions or the Expanded Info View: their `visualizationOverlayStateChanged`, or `lrcComposer.showTab()`) skips to the landing, so the window opens on the composition playing, never on a half-drawn frame (**proposed**: a skip, not a cancel; the planner's word was "cancel").
- **The other cancels** (a new rhythm, a new cycle, the glyph) are the lens going back to the row. The theater takes down the scrim, the caption and its listeners. Tested: after each one, the later frames draw nothing (zero canvas calls), no frame is queued, and the plot is the row's call for call.

**The lens's timing** (small edits to `lens.js`):
- **The full show** (the whole trace, fitted to 4–7.5 s) plays once per rhythm and cycle (store key) a page: the first animated compose of that key, seen or skipped.
- **The short version** is `trace-frames.js` `recallTimeline`: the same scene builder on a timeline where only root (0.4 s), lead (0.5 s), parts (0.45 s) and drums (0.15 s) get time, 1.5 s at pace 1. Every other beat is zero-length, so no frame stops on one (what they leave behind still shows).
  - It plays for a **recall**, and for a **later compose** of the same key (after a seed or knob edit; **proposed**: "only the first compose animates the full ~7.5 s").
  - A recall with no trace (made with "show the work" off) lands at once.
- **No motion:** "show the work" off, or `prefers-reduced-motion` (the bridge's `motionAllowed(win)`, a `motion` dep of the lens), means no shimmer, no animation and no scrim. Compose runs, then it lands; a recall lands at once. The trace is still asked for while the work is shown, so the window's Decisions table keeps it.
- **The events' details:** `composing` `{ showWork, animate, short }` · `animating` `{ scene, pace, recalled, short }` · `skip` `{ queued }` · `landed` `{ recalled }`. `lens.onFrame(fn)` gives each animation frame (`fn(frame, { short })`), so the theater never ticks the animator itself, and the glyph doesn't re-render 60 times a second.
- **One frame loop:** the loop now carries a generation. A cancel and a re-press before the next frame used to leave the old queued frame alive, which ran a second loop (two ticks and two paints a frame, for good). Found while testing "no stale draws"; fixed and tested.

**For the tutorial (step 3):** `await lrcComposer.lens.press({ pace })` resolves to `'landed'` once the animation lands and the performance has started (or to `'idle'` if it went back to the row: a refusal, or a cancel).
- `pace` divides the animation's duration: the full show lasts `scene.end / pace` seconds and the short one `1.5 / pace`. Compose's own solve time isn't scaled. A pace that isn't a positive number is 1.
- To wait without the promise, listen for `lens.onChange` `landed` (and `row` for the way out). The scrim is `lrcComposer.theater.up`. `animating` carries `scene.end`, for a budget.
- Note: the tutorial's own spotlight clicks must not be dispatched as page clicks while the scrim is up, or they skip the show.

**Carry-overs from step 1:**
1. **ProgressionBar vs the lens's readout (proposed: the bar yields).** `ProgressionBar._paintChartForSection` and its frame loop's chart paint now do nothing while the Scale chart carries the lens's `composition-locked` (`ProgressionBar.chartYielded()`). That covers the loop, a bracket drag and a solve. On the way out, the lens's Scale lock rebuilds the chart from the row's selection, then calls `ProgressionBar.repaintChart()`, so a locked voicing shows its section again exactly as before the lens. The bar's own lock, its brackets and its PaintEngine are untouched. Tested on the real ProgressionBar in a vm.
2. **Cache-busting: not cleanly possible; documented.** ES modules resolve a relative import against the importer's URL *without* its query, so the bridge's `?v=` can't reach the modules under it. A version on every import means rewriting every static import in the bridge's 35-module graph on every bump. A per-file import map could work, but it has to list every module, and the compose worker doesn't see the page's import map. The site is static GitHub Pages (no headers of ours), which serves `max-age=600`, so the live site heals within ten minutes. For a browser pass after pulling: hard-reload, or keep DevTools' "Disable cache" on. The bridge's `?v=` (bumped to `20261023.2`) still refreshes the entry, and the stylesheets' `?v=` work as before.

**Site edits** (small): `index.html` (`theater.css` linked; the bridge's and ProgressionBar's `?v=` bumped); `ProgressionBar.js` (`chartYielded`, `repaintChart`, the two yields, marked `COMPOSITION LENS (sprint 2, step 2)`).

**Tests:** `assert-page-theater.mjs` (79), over the real LRCModule, LRCVisuals, ToneRowPlayback transport and ProgressionBar. It covers:
- the scrim on and off with the panels' exact restore, and theater.css' selectors;
- the caption and its label; the lift and its timer;
- the timing of the full show vs the recall's 1.5 s, and the short version's beats;
- eight skip paths, plus three queued during Compose;
- the swallowed press, and the glyph as a cancel;
- the cancels with no stale draw, and the one frame loop;
- reduced motion and the setting off; `motionAllowed`;
- pace on both versions, and bad paces;
- ProgressionBar yielding and getting the chart back.

`assert-page-lens.mjs` now expects the short version before a recall plays (78).

**Open (for Avery):**
1. **Which panels dim:** four, with Playback lit (built), or all five?
2. **A click under the scrim:** swallowed (built), or passed through to what it lands on as well as skipping?
3. **The short version:** for a recall and a later compose (built), or should a recall just land (the order allowed either)? Is 1.5 s right?
4. **A window opened mid-show:** skip to the landing (built), or cancel back to the row?
5. **The window's own Compose animation** (in the Composer tab) doesn't yet respect `prefers-reduced-motion`. Should it?
6. **The full show is once a page per rhythm and cycle.** Should it be once a session (sessionStorage), like the glyph's breath?

## Interactive tutorial (sprint 2, step 3; built 2026-10-23)

The order (`SPRINT2_ORDER.md`, step 3, and Avery's words for the opening): replace the text tutorial with a guided, animated one, "much more interactive rather than text based", with a playing composition in front of the user within 5–10 s of "Begin", then a short tour while it plays. Everything below that isn't the order is **proposed, not ruled**. Nothing here has been seen in a browser yet.

**The opening** (Avery's four lines, in order):
1. **"Welcome to the Large Rhythm Collider!"** The popup sits over the main canvas, which a glint circles. Its buttons: Begin, Not now, and "or read the guide".
2. **"This machine eats numbers…"** The spotlight moves to Rhythm Input, and four generated layers are typed into the real fields. Each field is focused and cleared, then typed a digit at a time; every keystroke is an `input` event (insertText with its digit), then one `change`. The field being typed glows.
3. **"…to turn structure…"** The real Generate button is clicked: its form submits, and the HUD sorts and generates as for a person. A ripple marks the press. The spotlight then moves to the canvas while the Linear Plot appears.
4. **"…into music."** The spotlight is on the glyph. The tour presses it through `lrcComposer.lens.press({ pace: 2 })`, never a page click. The theater's full show plays, then the performance starts.

**The scrim leads the show.** While `lrcComposer.theater.up` is true, the tour yields: its spotlight and popup are hidden (`lrc-tour--yield`, `aria-hidden`), and nothing of the tour can be clicked. Any click on the page then skips the show, so the tour dispatches none. Its frame loop checks the scrim each frame and comes back as it lifts.

**The layer generator** (`tour-script.js` `generateLayers(seed)`, pure and seeded).
- **The criteria** (`layerProblems`):
  - four distinct 3-digit layers;
  - none divides another;
  - the gcd of the set is 1;
  - greatest first, so the Rhythm Input takes them unchanged (`siteAccepts`: the HUD sorts, and LRCModule parses with `parseInt`);
  - Compose's own refusal gates pass (`composerAccepts`: `buildRow` + `toneGate`, exactly what `compose()` refuses on);
  - the tone count is inside the band.
- **The bias (proposed): 12–144 distinct tones, drawn from the 95 three-digit numbers with no prime factor above 7.**
  - Uniform 3-digit sets have hundreds of tones (median 437 over 3,000 coprime sets; only about 2 % land in the band). That means a Scale chart hundreds of rows long, and a crowd in every ±15¢ frame.
  - 7-smooth layers repeat their gaps. The generator's sets (seeds 1–500) have tones at p10 29, p50 70, p90 124, and still sound unlike 12-TET. A set takes about 3.7 draws (half a millisecond); a fallback set (480:320:252:175) is there if 4,000 draws fail (never seen).
- The page seeds it from the clock; the tests use fixed seeds.

**The timing budget** (`openingBudget`). The parts:
- the beats: read 500 ms, after typing 250, Generate aimed 350, the plot seen 700, the glyph aimed 600 (2.4 s);
- the typing: 4 × 40 ms to clear, 12 × 55 ms for the digits, 3 × 90 ms between fields (1.09 s);
- the site's generate (measured in Node: 7–56 ms);
- Compose's solve (not scaled);
- the show, `scene.end / pace`.

**The pace is 2 (proposed).** The full show is always fitted to about 7.45–7.5 s on these rows, so it plays in 3.75 s. Measured in Node on 8 generated sets (the worker's full table with the trace, 0.36–0.97 s), Begin to playing takes 7.6–8.2 s (typical 7.9). With a 1.5 s solve, 0.3 s of site work and the longest show it is still 9.0 s. At pace 1 the same opening takes 11.9 s. In the test, the driver's own virtual clock lands within 0.1 s of the model.

**The tour, while it plays.** Each stop waits for Next, and the music keeps playing.
1. **Part strips.** The Playback div opens through its own minimize button. The spotlight is on the strips, and the popup explains Lead, Chords, Comping, Bass, Inner and Drums, and the layer dot.
2. **The Scale readout,** locked, with each bar's chord tones lit.
3. **The advanced Composer.** The spotlight is on the Playback title, with a double-click ripple every 2.4 s. The popup describes the window, and a **Peek inside** button opens it on its Composer tab. Leaving the stop closes it again and puts back the tab the window remembered. A window the user opens by hand during this stop is closed on leaving too (proposed: "don't leave the window open").
4. **Cosmos,** pointed at, not entered.
5. **Back to the row.** The spotlight is on the glyph, with "Read the guide" and Done. Its text follows the lens: under the composition it explains the lens; on the row it says the composition is kept and plays at once on the next press.

**Navigation.**
- **Next, Back, Skip.** Next and Back are buttons, and → and ← work while the focus is in the popup. Back never goes into the opening, since its steps are actions, not pages. Skip on a stop is Next. In the opening, "Skip ▸" hurries: the beats go, the typing finishes at once (still a real event per digit), and the show is skipped to the landing (queued while Compose runs).
- **Esc, or ×,** ends the tour at any point. During the show, the theater's own Esc also skips to the landing, so the music starts and the tour is gone.
- **The lens moving under the tour.** If the lens goes back to the row (the glyph, or a rhythm generated by hand), a stop that needs the composition (the strips, the scale) gives way to the last stop. Next and Back skip those stops while the lens is on the row.

**A clean exit** (every path, tested):
- the half-typed fields are restored when Generate wasn't pressed yet;
- the panels and Playback sections the tour opened are closed again, except the Playback div while the composition plays (proposed: its transport and strips are what's sounding);
- the Composer window opened during its stop is closed, and its tab put back;
- the overlay, the listeners, the motion timers and the typing glow are removed, and the focus goes back where it was;
- the lens is left wherever it is.

**Accessibility.**
- The popup is a `role="dialog"` (non-modal), labelled by its title and described by its text. Its primary button takes the focus on each stop, and the welcome's Begin is focused, so Enter begins.
- **Reduced motion** (`prefers-reduced-motion`, read at start): the root carries `lrc-tour--still`, with no glide, pulse, glint or ripple. The theater then jumps to the landing on its own (step 2), so the opening is typing, Generate and the solve.
- **Touch screens** (`pointer: coarse`): the fields aren't focused while typed, so the on-screen keyboard doesn't jump up. The events are the same.
- **The mobile layout** (`body.mobile-mode`, a scrolling page): each stop scrolls its target into view.

**The first visit (proposed).** The tour opens by itself once, 900 ms after the page's `load`, and only when `localStorage` can say it hasn't been seen (`lrc.tour.seen`, written on every start). It doesn't open:
- when the storage is missing or throws (it would otherwise open on every visit);
- when the old slides' "Do not show again" was ticked (`lrcTutorialDismissed`);
- on a page launched with a rhythm in its URL (`?layers=`, `?a=`…), since the tour would type over it;
- in Cosmos.

The menu's **Take the tour** (`#tutorial-show-btn`) restarts it any time, closing the menu first. Pressed mid-tour, it starts again from the welcome.

**The old content is the guide.** `TutorialUI.js` no longer opens the slides on load, and their "Do not show again" box is gone. They open from the menu's **Read the guide** (`#tutorial-slides-btn`), the welcome's "or read the guide" and the last stop's "Read the guide" (`window.LRCTutorialSlidesUI`). `TutorialContent.js` is untouched.

**Code** (`Tutorial/`):
- `tour-script.js`: **pure.** The generator and its criteria, the timing model, the steps as data (id, phase, action, title, text, targets with fallbacks, reveal, needs, motion, peek), navigation (`nextIndex`, `backIndex`) and the first-visit rule.
- `tour-driver.js`: the DOM driver, `createTour({ win, doc, composer, timers, raf, motion, storage, seed })`, with `start`, `begin`, `next`, `back`, `skip`, `end`, `togglePeek` and `onEvent`. Its pure `placePopup` sets the popup's placement, clamped to 16 px gutters. Everything is injected, so it runs on the DOM stub.
- `tour-boot.js`: `window.lrcTour`, the menu button and the auto-open.
- `tour.css`: the spotlight (a ring whose shadow dims the rest; it never takes a click), the popup, the ripple, the yield and still states, in the site's `--hud-*` tokens and accent.

**Site edits (small):**
- `index.html`: `tour.css`; `tour-boot.js` as a module after the bridge; the menu's two buttons; the dismiss checkbox removed; `TutorialUI.js?v=`.
- `TutorialUI.js`: no auto-show, `#tutorial-slides-btn`, `LRCTutorialSlidesUI`.

No change to the Composer's modules.

**Tests:** `Composer/tests/assert-tutorial.mjs` (99 checks), in the suite command's glob. It runs over the real bridge (store, lens, theater), LRCModule, LRCVisuals, the HUD's minimize and form handlers and the old TutorialUI. It covers:
- the generator on 400 seeds, its criteria's refusals, and Compose on 8 sets;
- the budget, with the solve measured;
- every target on the page, and the module graph;
- `placePopup`, including at phone width;
- the opening end to end: the typed sequence, the real Generate, `press({ pace: 2 })`, no click while the scrim is up, and the driver's clock against the model;
- every stop with Next, Back, the keys and the peek;
- Esc on the welcome, mid-typing (the fields restored) and while playing;
- Skip ▸;
- the glyph and a hand-generated rhythm mid-tour;
- reduced motion;
- the guide;
- the menu's restart;
- the auto-open (fresh, seen, throwing storage, URL rhythm, Cosmos).

**Open (for Avery):**
1. **The bias.** Is a 7-smooth pool with 12–144 tones right for a first impression, or should the tour's numbers be uniformly random 3-digit (hundreds of tones)?
2. **The pace.** 2 (3.75 s show, ~8 s opening), or brisker?
3. **The scrim leads** during the show (built). Or should the tour's "…into music." caption stay up over the scrim?
4. **Esc during the show** ends the tour, and the theater skips to the music (built). Should it end the tour and let the show run?
5. **The Playback div stays open** at the end while the composition plays (built); everything else the tour opened is closed. Close it too?
6. **The Composer stop:** describe it with a "Peek inside" button (built), or open and close the window by itself?
7. **First visit:** someone who ticked the old slides' "Do not show again" isn't shown the tour unasked (built). Show them the new one once anyway?
8. **The tour types over the current rhythm** (a restart from the menu replaces the user's layers; the old composition stays cached). Ask first when a rhythm is already on the page?

## Step 4b: typed progression (built 2026-10-25, branch `step4/typed`)

`Cmaj7 Am7 Dm7 G7`, one symbol a bar, read against the composition's own tones before any compose. Built as `Composer/core/chord-symbols.js` (new) and an extension of `core/progression.js`, checked by `Composer/tests/assert-chord-symbols.mjs` (57 checks). No other module changed: `assert-progression.mjs` passes unchanged.

**Decided (Avery, STEP4_ORDER.md):**
- **3. Symbols are relative.** C is the composition's base root, as the Composer already names chords; they are read on the base grid, not as absolute pitch through the fundamental.
- **4. Off the frame,** a symbol resolves to the nearest cluster at any offset, shown amber with its cents. With modulation on, Compose's own rule may retune there; with it off, it stays amber and is flagged `offGrid`. It is never snapped into the frame.

**The API:**
- **`parseChordSymbol(text)`:** a port of the site's `ProgressionSolver.parseChordSymbol`: accidentals (♯ ♭ 𝄪 𝄫), suffixes (Δ − ° ø, 6/9, alterations, add / no / omit), slash bass. It returns the site's own fields, plus `bass` (the slash bass's class, when there is one). Parity with the site's parser, loaded in a vm, holds on every field of 116,211 symbols (140 root spellings × 83 suffixes × 10 slash forms, plus edge cases).
- **`tokenizeField(text)`:** the site's tokenizer (`|`, `,`, `;`, tabs, newlines and spaces all separate), with each token's character span for inline marks. `readToken` adds two marks of the Composer's own (**proposed**): an auto token (`-`, `.`, `_`, `?`, `auto`) leaves its bar to Compose; a trailing `*` (`D*`) pins the root and leaves the quality to Compose, which is what a lab ratio pick is.
- **`barMaterials(layers, T, knobs, { row })`:** the row, the meter, the root, the phase (the seed's first draw, as in Compose), the cells, each bar's tones as harmony.js reads them, and `rootCandidates`. `knobs` is a spec's `knobs`, or Compose's overrides plus `seed`. Tested against 105 composes (5 rhythms × 7 override sets × 3 seeds): the same meter, phase, root and cells, again from `spec.knobs`; and harmonize's support for 13 pinned chords re-derived from its bar tones.
- **`resolveSymbols(field, materials, { frameCentsEachSide, modulation, keep })`,** per bar:
  - **the root:** the candidate cluster of the symbol's class with the least |dev|, more presence breaking ties. Inside the ±frame it's supported (`F −2.0¢`). Outside, the nearest cluster at any offset, amber, with `mayRetune` (modulation on) or `offGrid` (off). A class the row lacks entirely reaches into the next class (on 8:7:6:5, `F` → 35/32, `F −113.7¢`);
  - **the quality:** the symbol's intervals as a Composer quality, then `chooseChordOnRoot`'s test on the bar's tones: ✓ (whole), amber `no ♭7` (one class short: kept), or amber `fallback: Dm` (Compose's own pick over the root, shown without the lead, so provisional);
  - **the bars:** more symbols than bars, the extras dropped and flagged; fewer, the rest auto; a symbol that doesn't parse is said and left auto.
  - It returns `pins`, `[{ ratio, quality } | null] × N`: Compose's progression. `progressionOf(resolved)` is the same, or null when every bar is auto.
- **`pinsToField(pins, materials)` / `fieldToPins(field, materials, { keep })`:** the two views of one list. A pin list becomes the field in the Composer's chord names: base root C, sharps, `CHORD_QUALITIES`' suffixes, `D*` for a root with no quality, `-` for an auto bar, trailing autos cut. With `keep`, pins → field → pins is the identity (216 lists: every candidate × every quality, and none), and so is field → pins → field for fields in the Composer's names.
- **progression.js:**
  - an entry may be `{ ratio, quality }` (a quality id of `CHORD_QUALITIES` or `FALLBACK_QUALITIES`; `qualityById`), and `readProgression` returns `qualities`;
  - `chooseChordOnRoot` takes `pin.quality`. It keeps the quality where the bar supports it (a catalog quality: every class but at most one; a fallback dyad: its other tone sounding), and the settle passes keep it too. Otherwise it falls back exactly as before, reporting `forced: { quality, honored, missing }`;
  - `describeProgression` says per bar whether the asked quality was kept, unsupported, or waiting on the seam.

**The seam (needs harmony.js, after 4a merges).** `harmonize` hands `choose` the pin as `{ tone, cents }`, without its bar. So `harmonyPins` keys a quality by its root tone. That is exact unless one root is pinned with two qualities, or with one and none (`F Cmaj7 Fsus4 F`). Those bars choose freely, and the decisions say so (`ambiguous`). The one-line fix, in `chordsFrom` at harmony.js:315:
`{ tone: pin, cents: row.toneCents[pin], ...(progression.qualities ? { quality: progression.qualities[k] } : {}) }`
After it, `pin.quality` wins on every bar (already tested through `choose`), and specs without quality pins stay byte-identical (`qualities` is absent then).

**The ratio form's identity.** Eight targeted composes (traced, worker, modulation off, too long, ratios not of the row) hash byte-identical to b69a39e's `progression.js`, and `{ ratio, quality: null }` composes the `{ ratio }` spec. Every resolved field composed (162 fields of every kind on 119:42:15:8) keeps its roots, keeps each supported quality, and never forces an unsupported one.

**Measured** (Node, M4 Max): `barMaterials` 0.03 ms on 8:7:6:5, 0.08 ms on 119:42:15:8, 11.5 ms on the 16,359-onset row (2.2 ms given its row; the rest is `buildRow`). `resolveSymbols` 0.03 ms, and 0.09 ms on the 16k row.

**Proposed calls:**
- **Symbols the Composer has no quality for** (C9, C6, C13♯11) take the richest catalog quality inside them, and the rest is dropped and said (C9 → C7, "no quality with its 2"). C/E is the triad, as the site folds a slash bass into the set. The slash bass isn't voiced (v1's bass roots on the chord).
- **A dyad pinned** (`C5`, `Cno5`) is supported when its other tone sounds, the fallback rule. The every-class-but-one rule would pass a power chord whose fifth is silent.
- **The auto marks** `-` `.` `_` `?` `auto` and the free-quality mark `D*`.
- **`keep`:** a pinned ratio still of the symbol's class is kept, so a lab pick that isn't the class's nearest cluster survives a field edit.
- **The fallback shown** is Compose's pick without the lead. Compose's real pick can differ, because the lead votes.

**Open, for Avery:**
1. **Flats come back sharp** (`Bb7` → `A#7`) when the field is rewritten from pins. Should the UI keep the typed text while the field is the source, and rewrite only on a lab pick (proposed), or spell flats?
2. **Names after a modulation.** The field reads on the base grid (decision 3). After an earlier retune, the composed chord's (folded) name can read a class away from the typed symbol. Show both?
3. **Unsupported qualities.** The field says the fallback. Should the pin keep the asked quality, so a later re-compose that supports it honors it (built: the pin keeps it), or drop it to the fallback?

## Step 4c: drum grid and the prime partition (built 2026-10-25, branch `step4/drums`)

`Composer/core/drums.js`, checked by `Composer/tests/assert-drum-grid.mjs` against `Composer/tests/drums-baseline.mjs` (the drums' sha256s at b69a39e, never edited). The spec is `STEP4_ORDER.md` "4c". Decisions 6 (slot resolution) and 7 (p: first "the prime nearest N·S", **superseded**; re-ruled as a seeded random prime above N·S, see "The prime partition, revised" below) are Avery's, marked **decided**; everything else is **proposed**. Nothing here has been heard or seen in a browser.

**The API:**
- `arrangeDrums(spec, { ..., grid, p })`. `grid` is `{ voice: [one string a bar] }` for kick, snare, hat, perc and cym: `x` a stroke, `X` an accent, `.` off. A voice left out is silent.
- New modes, `SOURCE_MODES = ['grid', 'prime']`, kept out of `DRUM_MODES` (the presets' list, which the lab's mode select reads). `ALL_DRUM_MODES` is both. A grid with no mode plays as mode `grid`; with another mode it waits unread (proposed: the store can keep a grid while a preset plays). `perBar` takes the new modes too.
- `gridOf(arrangement)` → the grid of any arrangement. `readGrid(grid)` checks one.
- The prime partition: `nearestPrime(n)`, `isPrime(n)`, `gridShape(g)` → `{ m, places, cells }`, `primeLights(g, p)`, `cellLights(j, p, C)`, `primePartition(spec, g, { p, hitsPerBar, lit })`. `levelOneLights(g, { source: 'prime', p })` no longer throws. (The revision adds `seed`, `primeRange`, `drawPrime`, `primeSelection`, `nextPrime`, `PRIME_CEILING`, and changes `cellLights`: see "The prime partition, revised".)
- Only when a bar is in mode `grid` or `prime`, the output gains `silentCells: [{ bar, voice, place }]`, and with `prime` also `prime: { p, cells, hits, lights, selected, struck, silent, emptyCells, perCell }` (the revision adds `drawn`, `range` and `chosen`). Prime strokes are `snap: 'prime'` and carry `cell` and `light`.

**The grid (decided: slot resolution).**
- S·m places a bar, with m = 1 unless S < 4 (`beatsOf`): 8 places on 8 slots, 6 on 3 (half slots).
- Each cell goes through the same `land()` as every stroke: the nearest onset in the place's window, then one place wider, else silent. A silent cell is reported as `{ bar, voice, place }` and counted in `stats.silent`.
- An `x` is the voice's velocity, and `X` adds `GRID_ACCENT`. That's the patterns' +0.12, except the hat's +0.08, the backbeat's own beat lift (proposed), so a backbeat written as a grid plays back at its own velocities.
- Fills and crashes stay options over the grid, as over every mode: in a fill bar the grid's kick, snare and hat give way from beat 3 (its perc and cym stay), and a crash opens the next bar.
- **No grid, no prime: byte for byte as before.** The new keys appear only when used, and `readDrumOptions` adds `grid` and `p` only when they're given. 595 hashes = 17 cases × 35 option variants, every mode.

**Presets ⇄ grid.** `gridOf` maps a hit's `pos` to place round(pos·m); a place rounding to the bar's end is the next bar's first. A prime stroke maps to its cell in the perc row. The fills' strokes (kick and snare from beat 3 of a fill bar) and the crashes are left out, since they're options. The accent is read off the stroke's velocity, less its strikes' lift. Measured on 28 rows (Compose's meters, plus asked meters with S = 2, 3, 5, 6, 7, 11, 13), fills on and off:

| mode | round trip |
|---|---|
| backbeat, all 9 patterns, prime | **exact**, every field of every hit (616 runs) |
| against | the same onsets every time (416/416); only its off-beat lift (+0.05) can't be written as x or X, so the velocity differs in 44 of 56 runs |
| with | the backbeat exact and the stroke count kept, but only **28.4 %** of its 556 perc strokes re-land on the same onset. Moved strokes are a median 0.30 slots off (90th percentile 0.67, max 1.28; a median of 90 ms) |
| partition | the backbeat exact; **34.2 %** of its 952 perc strokes re-land on the same onset (median 0.22 slots off, max 0.74); 6 pairs share one place and merge |

The recommendations guessed that `with` "nearly always" re-lands on its own onset. It doesn't: a lead or comping note can be any onset in its slot's window, not just the one nearest the anchor, and the layer's pulses are where they are. At slot resolution (decision 6) an edit to a `with` or `partition` bar re-lands those strokes on the anchors' onsets, which is audibly straighter.

**The prime partition, first build** (`mode: 'prime'`; Avery's two-level design, quoted in the order). **SUPERSEDED on 2026-10-25:** p and level 2 below are the first rule, kept as the record of what was measured. The rule as it is now built is "The prime partition, revised", after the open questions.
- **Level 1:** p lights, light i aimed at i/p of the cycle from the downbeat. Each lands on the onset nearest it within half a light either side, then within a whole light, else it's dark (`snap: 'light' | 'wide' | null`). So the lights are real onsets, uneven in time, and light 0 is the downbeat. **p is the prime nearest N·S (decided).** Under 4 slots a bar it's the prime nearest the N·S·m cells (proposed: otherwise the cells would outnumber the lights about m to 1). Of two equally near primes, the larger is taken (proposed). `p` can be asked, and must be prime.
- **Level 2:** the grid's C = N·S·m cells read the p lights as an even grid. Cell j covers lights ⌊j·p/C⌋ up to the next cell's, and a lit cell strikes its first light, on the perc.
  - **The cells lit:** by default `selectLights(C, hits)`, Partitions' secondary pattern from the downbeat. hits = C by default, every cell (proposed, the partition mode's "a pulse a slot"), or N·hitsPerBar. With a grid, the grid's perc row lights the cells, and its X accents. Without one, the first cell is accented.
  - Partitions' own L2 (`PartitionsBlocks.computeL2Coverages`, `calculatePartitionSizes(p, C)`) cuts the same sizes but puts the long cells one or two places over. The order's ⌊j·p/C⌋ is built here.
- **The voices (proposed):** the prime line plays on the perc, over the backbeat, as the partition line does. With a grid, the grid's kick, snare, hat and cym play under it as in mode `grid`, and its perc row is the selection. So `gridOf` of a prime arrangement arranges back exactly.
- **For the UI strip:** `spec.drums.prime.lights` is `[{ i, at, tick, time, r, bar, pos, slot, snap }]`.

**How the swing came out under the first rule** (every cell lit; deviation of each struck light from its cell's even place j/C, in slots; the anchors are within 0.001 of that on these rows):

| row (cells) | p | lights a cell | level-1 landing, mean / max | struck vs even, mean / max | downbeat cell |
|---|---|---|---|---|---|
| 41:42:43 (32) | **31** (nearest) | 0–1 | 0.10 / 0.28 | 0.53 / 1.05 | **silent** |
| | 37 | 1–2 | 0.10 / 0.30 | 0.42 / 0.90 | light 0 |
| | 131 (≈ 4·C) | 4–5 | 0.08 / 0.24 | 0.16 / 0.36 | light 0 |
| | 251 | 7–8 | 0.06 / 0.13 | 0.08 / 0.21 | light 0 |
| 768:769 (32) | **31** | 0–1 | 0.007 / 0.016 | 0.52 / 1.00 | **silent** |
| | 131 | 4–5 | 0.007 / 0.019 | 0.12 / 0.24 | light 0 |
| 97:103:37 (16) | **17** | 1–2 | 0.03 / 0.07 | 0.43 / 0.93 | light 0 |
| | 67 | 4–5 | 0.02 / 0.06 | 0.11 / 0.26 | light 0 |
| 16k row (64) | **67** | 1–2 | 0.002 / 0.004 | 0.47 / 0.94 | light 0 |
| | 257 | 4–5 | 0.002 / 0.007 | 0.12 / 0.25 | light 0 |

What the table says:
- **Level 1 is nearly even, as Avery said.** It's within a tenth of a slot on small rows and a few thousandths on big ones.
- **The deviation is level 2's: the sawtooth of ⌊j·p/C⌋.** The struck light sits up to C/p slots before its cell's even place, with |p − C| (more generally p mod C) teeth a cycle.
- **With p nearest N·S** (one light a cell), that sawtooth is up to a whole slot deep: 37 lights over 32 cells rush by 5/37 of a slot a cell and jump back 5 times a cycle. That's closer to a 37-against-32 polyrhythm sampled onto the slots than a swing, and it drifts up to a full slot off the backbeat under it.
- **When the nearest prime is below N·S** (32 → 31, 8 → 7, 24 → 23, 48 → 47), ⌊j·p/C⌋ leaves cell 0 empty. So **the downbeat cell is silent**, and cell 1 strikes the downbeat light a slot early. That's the default on 19 of the 28 test meters.
- **With p near 4·N·S** (131 for 32 cells), each cell holds about 4 lights. The struck lights sit at most about a quarter slot early, with p mod C teeth (3 for 131/32), a swing-sized push. That matches Avery's "triple digits… almost perfectly in time" for level 1, with level 2 adding the swing.

**Open (for Avery):**
1. ~~**Should p sit above N·S?**~~ **Answered (Avery, 2026-10-25): yes, a seeded random prime above N·S, to the low triple digits** (built: "revised" below). Proposed then: yes, a prime about 4·N·S (or a pick from the triple-digit primes), so a cell holds several lights and level 2's swing is about ¼ slot rather than a whole one. At least never below N·S, which silences the downbeat cell. Decision 7 is built as ruled.
2. ~~**The level-2 cut**~~ **Answered: Partitions' own distribution** (built: "revised" below; for a prime p its secondary pattern and its UI's L2 cut are the same selection). Asked then: the order's ⌊j·p/C⌋ (built), or Partitions' own `calculatePartitionSizes(p, C)` cut (the same sizes, with the long cells one or two places over)?
3. **The prime line's voices:** perc over the backbeat (built). Should the whole kit ride the prime lights instead?
4. **Default density:** every cell lit (built). Or thinner by default, say hitsPerBar = 5 of 8?
5. **with / partition under an edit:** they re-land on the anchors' onsets (only 28 % and 34 % keep their onset). Should the store keep a `with` or `partition` perc row bound to its source until that row itself is edited?
6. **A dark light, or an empty cell,** is silent and reported. Should it strike the cell's next light instead? (Revised: no cell is empty now, and a dark chosen light lands within its cell's reach, proposed: "revised" below.)

**The prime partition, revised** (step 4c-prime, built 2026-10-25, branch `step4/prime`; `tests/assert-drum-prime.mjs`, 27 checks; Node only, not heard).

**The rule (decided, Avery 2026-10-25): p is a seeded random prime above N·S, up to the low triple digits, and level 2 uses Partitions' own distribution of N·S over p.** In Avery's words, the grid is a string of lights all turned off. Level 1 says which to turn on. Level 2 treats those as a new grid, irrespective of level 1's uneven notes, and says which stay on. A large prime is granular enough to be almost in time; level 2 adds the distinct swing.

- **The range (proposed):** p is one of the primes in (C, U], uniformly, with C = N·S cells (N·S·m under 4 slots, proposed, as before) and U = max(199, the smallest prime ≥ 2C) (`primeRange`, `PRIME_CEILING`). So small meters reach the low triple digits, and a large one still has primes up to about 2C. 32 cells: the 35 primes 37–199. 104 cells (8 × 13): 107–211.
  - Partitions has no range convention to match: its two count inputs are plain numbers, capped at 64 in the UI, below Avery's triple digits.
- **The draw:** one draw from the drums' own generator `${seed}/drums/prime` (`drawPrime(C, seed)`), beside `against`'s per-bar `${seed}/drums/${bar}`. Compose's parts and chords, and `against`'s bars, never move (tested). The seed is `drumOptions.seed`, else the spec's: the same seed, the same p. The decisions say p was drawn, from where, and by the seed (`drums.prime`, `drums.seed`).
- **An asked `p`** must be a prime above C. Anything else is refused (an error, as before for a non-prime). A drumOptions.p that a new meter's cells outgrow is dropped by the controller on the next Compose, and said in `state.dropped.p = { was, cells }`; the mode then draws its own (proposed).
- **Level 1:** unchanged. p lights at i/p of the cycle from the downbeat, each on the onset nearest it within half a light, then a whole light (`primeLights`). Light 0 is the downbeat.
- **Level 2:** `primeSelection(p, C)` is Partitions' `getSecondaryAllowedSet(p, C)`: E(C, p), turned so that its first stroke is index 0. It chooses C of the p lights in order, and cell j strikes the j-th (`chosen[j]`).
  - **The downbeat cell sounds:** the turn puts light 0 first, always, so cell 0 strikes the downbeat light. With `hitsPerBar` the cells lit are E(N·hitsPerBar, C), turned the same way, so cell 0 stays lit.
  - **Parity, against the site's own scripts in a vm:** `euclidPattern` is `generateEuclideanPattern` on 27,025 (steps, pulses). `primeSelection` is `getSecondaryAllowedSet` for every prime p in range, C = 1–120 (3,546 pairs). For C ≥ 3 it is also exactly the live UI's L2 cut, `computeL2Coverages` (the starts of `calculatePartitionSizes(p, C)`), which is what Partitions plays when its second count is typed. The two cuts part only at C = 2, which no meter has (the grid has at least 4 places a bar).
  - Each cell holds Partitions' group, ⌊p/C⌋ or ⌈p/C⌉ lights (`cellLights`, `perCell`). No cell is empty.
- **A dark chosen light (proposed):** in the triple digits a light is narrow (±1/p of the cycle), and on a sparse row many lights find no onset. A chosen light that is dark strikes the onset nearest its place within its cell's reach, half a cell either side and then a whole cell (`snap: 'cell' | 'cell-wide'` on the `struck` entry), as `land()` widens any stroke. Without this, 8:7:6:5 and 11:9:7:5 on their own Compose meters lost 28 % and 48 % of their cells. With it they lose none. A cell is still silent when no onset lies within a whole cell; that happens only on asked meters with more cells than the row has onsets.
- **The grid, perBar, fills and the voices** are as in the first build: a grid's perc row lights the cells, its X accents, its other voices play as the grid. Without a grid the downbeat cell is accented.

**Output changes** (`spec.drums.prime`; the store reads only `p`, and 4e has not been built):
- new: `drawn` (p was drawn, not asked), `range: { above, upTo, primes }` (C, U, how many primes), `chosen: [light]` (cell j's light);
- `struck` entries gain `tick` and `snap` (the stroke's onset; it's the light's own unless the light was dark);
- `emptyCells` is always 0 now, kept for the shape; `perCell` is Partitions' group sizes;
- unchanged: `p`, `cells`, `hits`, `lights` (its entries' keys too), `selected` (still the cells lit, not the lights chosen), `silent`.
- API: new `primeRange(C)`, `drawPrime(C, seed)`, `primeSelection(p, C)`, `nextPrime(n)`, `PRIME_CEILING`. `cellLights(j, p, C, chosen?)` now returns Partitions' group for cell j, not ⌊j·p/C⌋. `levelOneLights` and `primePartition` take `seed`. `nearestPrime` stays, as a helper only.
- Tests: `assert-drum-grid.mjs` keeps the grid, presets ⇄ grid (prime included) and the byte identity (527 hashes, `against` left out as before); its first-rule prime checks are replaced by `assert-drum-prime.mjs`. `assert-drums.mjs`'s seam check now expects a drawn prime. `assert-store-edits.mjs` adds 3 checks (the drawn p, an asked p, the dropped p).

**How it swings now.** The deviation of each struck stroke from its cell's even place j/C, in slots. "Level 2" is Partitions' part alone (chosen[j]/p against j/C). "Struck" adds level 1's landing on the row's real onsets. The rows are 41:42:43, 119:42:15:8, 768:769 and 97:103:37, over N = 2–8 and 6 seeds each:

| S | p/C drawn | level 2, mean / max | struck vs even, mean / max | strokes merged on one onset |
|---|---|---|---|---|
| 3 | 2.0–15.9 | 0.05 / 0.24 | 0.06 / 0.36 | 0.02 % |
| 5 | 2.1–19.1 | 0.08 / 0.43 | 0.09 / 0.77 | 0 |
| 7 | 1.8–13.6 | 0.11 / 0.50 | 0.13 / 0.91 | 0.05 % |
| 8 | 1.6–11.9 | 0.12 / 0.49 | 0.15 / 0.84 | 0.07 % |
| 11 | 1.4–8.7 | 0.15 / 0.49 | 0.19 / 1.31 | 0.6 % |
| 13 | 1.3–7.4 | 0.16 / 0.50 | 0.21 / 1.42 | 1.4 % |

- **p sets the depth.** By p/C, level 2's mean / max: 1–1.5: 0.18 / 0.50; 2–3: 0.13 / 0.49; 3–5: 0.09 / 0.33; 5–8: 0.05 / 0.17; 8 and up: 0.03 / 0.12 slots. Over the drawn range level 2 never moved a stroke more than half a slot. Forced to the first prime above C (p/C 1.01–1.21), it's 0.40 / 0.98: the first build's whole-slot sawtooth.
- **p mod C sets the shape.** The struck light drifts from its cell's even place by less than a light (N·S/p slots), and resets about min(p mod C, C − p mod C) times a cycle. So 97 over 32 cells (97 mod 32 = 1) drifts steadily early, to 0.32 slot, and resets once, at the loop. 157 over 32 (mod 29) drifts late to 0.18 slot and resets 3 times. 151 over 16 (mod 7, near C/2) alternates ±0.05 slot cell to cell: the nearest to a long-short swing.
- **Merges** (two cells striking one onset; the louder kept) stay under 1.5 % on these rows. On sparse rows (19:17:16:15, 8:7:6:5, 11:9:7:5) on asked meters, where the cells outnumber the onsets, 11–31 % merge.
- Determinism: the same seed gives byte-identical drums (tested).

**Open (for Avery), the revision:**
1. **The range's top:** U = max(199, the next prime ≥ 2·N·S) (proposed). Should a large meter reach further, or the range favour some part of it? A small p/C (just above N·S) is the deepest drift, up to about half a slot, and 4·N·S and up is nearly straight.
2. **The dark-light landing within a cell** (proposed), or silence as the first build had it?
3. **Under 4 slots** p is drawn above the N·S·m cells, not N·S (proposed, as before).

## Step 4a: core rearrange (built 2026-10-25)

The order: `STEP4_ORDER.md` "4a. Core", built on `STEP4_RECOMMENDATIONS.md` §1. Avery's decisions there are marked **decided**; everything else here is **proposed, not ruled**. Node only: nothing here has been seen in a browser.

**1. The trace caps option** (`core/trace.js`, `TRACE.md` "Caps").
- `compose(..., { trace: { caps } })` keeps a bar's 12 best chord candidates and a phrase's 8 runner-up lines (`ALTERNATE_CAPS`, with `caps` over them). `trace: true` is unchanged at `TRACE_CAPS` (6 and 3). **Proposed:** `true` stays the show's caps because Cosmos's dust asks for `true` and reads every candidate and runner-up it is given; this keeps the dust unchanged without a Cosmos edit.
- `capTrace(trace, caps)` cuts a 12/8 trace back to the 6/3 trace, byte for byte (events, node and line tables, caps, stats). `trace-frames.js` `buildScene` reads the trace through it, so the main page's show is the same frame for frame (tested on 3 rhythms × 241 frames).
- On the 16k row the trace grows 109 → 153 KB (lean) and 96 → 129 KB (full). Compose's time doesn't move.

**2. The controller always asks for the trace** (`perform/composer-controller.js`, marked STEP 4a). Every compose sends `trace: { caps: ALTERNATE_CAPS }` and keeps `state.trace`, whatever "show the work" says. The show still reads it only while the setting is on.
- `compose-runner.js` now passes the `trace` option through as given (it turned any truthy value into `true`).
- **A behavior change:** a rhythm composed with the work hidden now has a trace. Recalled later with the work shown, it plays the short version, where before it landed at once. Five page-suite checks were updated to this contract.

**3. The builder refactor** (byte-identical).
- **`compose.js`** exports the part builders it now calls:
  - `partContext(row, cells, { cycleSeconds, phase, frameCentsEachSide })`
  - `leadNotesOf`, `chordVoicesOfBar(ctx, chord, k)`, `compChoicesOf(ctx, chords)` and `compOfBar(ctx, chord, k, layer)`
  - `bassOfBar(ctx, chord, k, { table, scale, target })`, `leadAvoidOf` and `innerOf(ctx, { from, bars }, { chords, targets, lead, table, rules })`
  - `partOf(ctx, id, notes, { sound, legato, enabled, baseHz, ratioOf, voice })` and `specChordOf`
- **`harmony.js`** exports:
  - `pickFor`: chooseChord's tail, the modulation rule and the names for a given root and quality;
  - `chordRecord(row, bar, pick, { eachSide, referencePc, pinned })`;
  - `targetOfBar` and `targetsOf`, `exceptionsOfBar`;
  - `barMaterial` and `strongNotesOf`, now exported.
- **The gate:** `tests/assert-refactor-identity.mjs` composes 729 cases with the live core and with a frozen pre-refactor copy, and the two JSON texts must be equal. The cases: every rhythm × 2 seeds, every override, progressions, every drum mode, the trace off/true/{caps}, and the 16k row.
  - The copy is `tests/fixtures/{compose,harmony,lines}-before.js`, taken at ba590d5 and never to be edited. Row, cells, frame, progression, drums and trace are live in both, so 4b's and 4c's edits are checked by it too.
- **One speed-up in `lines.js`:** a module-level memo of the close cost (a pure function of two fractions; same numbers, cleared at 2^18 entries). A bar-local re-mine on the 16k row went from a 17.8 to a 12.4 ms median.

**4. `core/rearrange.js`.**
- `rearrange(spec, row, cells, { bar, chord })` and `rearrange(spec, row, cells, { phrase, line, chordsFollow }, { trace, parts, drumOptions, smoothPhrase })`.
  - They return `{ parts, drums, chords, modulations, changedBars, retunedBars, changed: { part: [bar] }, exceptions, stats }`.
  - `applyRearrange(spec, r)` writes a result into a new spec.
  - `materialsOf(spec)` rebuilds `{ row, cells }` from `spec.input.layers` and the knobs. It takes about 7 ms on the 16k row, and it isn't valid for Cosmos's superrow composes.
- **Decided:**
  - a chord swap keeps the lead (decision 1);
  - lead alternates are the phrase's runner-ups (decision 2);
  - the comp layer, `baseHz` and the lead's legato are pinned, and so are every part's sound, legato and on/off;
  - `targets.scale` is fixed;
  - the chords don't follow a lead swap unless asked;
  - the inner is re-mined bar-locally.
- **Proposed:**
  - **The swapped bar's own target** reads scale ∪ its new chord's classes, so a chord tone is never "foreign" in its own bar. The parent scale and the other bars don't move.
  - **The bar-local inner** uses `lines.js` `rules: { before, after }`, the inner's nearest notes either side of the bar as `{ pitch }`. Each move to them is priced as a move inside the line, `strict × interval × I`. There's no recovery flag and no wrap at bar 1. Absent, `pickLines` and `scoreLine` are unchanged, and the test checks that they agree on every boundary cost.
  - **Exceptions of a changed bar** are its lead's strong notes off the new chord. A lead note foreign under the new chord's frame and target is a passing tone. A bar whose chord didn't change keeps the count Compose gave it.
  - **"Unchanged" short-circuits.** A bar re-given its own chord keeps its inner, and a phrase re-given its own line keeps its inner and exceptions. That's what makes the identity test byte-exact. Its chord voices, comping, bass and every part's articulation are still rebuilt through the builders.
  - **Chords follow** runs `chooseChord` bar by bar along the phrase over the new lead, walking the offset and the voice-leading. A pinned (`targeted`) bar keeps its chord. On a settled spec's own lead it chooses the spec's chords again (24/24 phrases).
  - **The re-pitch.** Later bars keep their root and quality, and the modulation rule is re-run at their new incoming offset; `retunedBars` lists those whose `fundamentalRatio` moved.
  - **An empty bar** that took the swapped bar's chord takes the new one.
  - **The drums** are `arrangeDrums(rearranged spec, spec.drums.options)`, which reproduces the spec's own drums. Backbeat never moves, and `with` moves only in edited or retuned bars. **`against` can spill:** its seeded draws run in bar order, so a changed slot count re-draws later bars (52 of 336 swaps measured). A per-bar seed in `drums.js` (4c's file) would fix it.
- **Measured** on the 16k row:
  - a chord swap: lean 4.9 ms median, 6.7 max; full 10.9 ms median, 19.2 max; the first swap on a spec about 11 ms (the part context, cached per cells after that);
  - a lead swap, bar-local: lean 11.7 ms, full 37.8 ms;
  - `smoothPhrase` (the whole phrase): lean 68 ms, full 294 ms, so that one is for the worker.
- **Kept, a Compose quirk:** a bass bar with no line plays its chord's root onset, with `slot` the onset's posSlot. That can be the previous bar's last slot when the root sounds in the bar's first window just before its downbeat. The refactor keeps it byte for byte.
- **Tests:** `assert-trace-caps.mjs`, `assert-refactor-identity.mjs` and `assert-rearrange.mjs`. The rearrange suite covers:
  - identity on 78 bars × 2 and 25 phrases;
  - 927 candidate swaps and 200 runner-up swaps, every note a real onset in its bar and slot at its retune;
  - only the dependent bars and parts moving;
  - the boundaries;
  - the costs.

## Step 4d: store edits and pins (built 2026-10-25, branch `step4/store`)

The order: `STEP4_ORDER.md` "4d. Store". Avery's decisions there are marked **decided**; everything else is **proposed, not ruled**. Node only: nothing here has been seen or heard in a browser. Built in `store/composition-store.js`, a new `store/composition-edits.js` (pure), `perform/composer-controller.js`, `perform/compose-runner.js` and `core/compose-worker.js` (the worker path), a one-line `materialsKey` in `core/rearrange.js`, and `against` in `core/drums.js`. Checked by `tests/assert-store-edits.mjs` (88 checks).

**The entry** (`newCompositionState`, new fields):
- `composed`: Compose's own spec, never touched.
- `spec`: the composition **as edited**, composed + edits. With no edits it is the same object as `composed`. **Proposed:** keeping the edited spec in `spec` means the player, the tab's lanes, the plot overlay, the part strips, the Scale readout, the lens and its recall all read the edited composition with no change of theirs (none of `page/` was edited).
- `edits`: `{ chords: { [bar]: { rootTone, quality, from: 'swap' | 'typed', asked? } }, lead: { [phrase]: { lineId, chordsFollow, smooth? } }, order, grid }`.
  - `order` (`'chord:3'`, `'lead:1'`) is the order the edits apply in. A changed edit moves to the end; a removed one drops out.
  - `asked` (typed chords only) is the quality the field asked for. `quality` is what plays: the asked one where the bar supports it, else Compose's own pick over the root (`chooseChordOnRoot`, with the bar's lead). The pin keeps `asked` (4b's open question 3, as built there).
  - `grid`: `{ bars, slotsPerBar, from }`, the meter `drumOptions.grid` was written for, and the mode it came from.
- `drumOptions.grid`: the step grid (4c's shape).
- `field`: `{ text }`, the typed progression as the user typed it (4b's open question 1, proposed: the text is the field's source, so flats stay flats; only the swapped bar's symbol is rewritten).
- `undo` / `redo`: snapshots of the edits, the field, the pins and the drum mode and grid. At most `UNDO_LIMIT` = 50 (proposed).
- `dropped`: what the last Compose dropped, for the UI's amber: `{ pins: [{ bar, ratio, quality, reason: 'notInRow' | 'pastBars' }], unhonored: [{ bar, ratio, asked, got }], lead: [{ phrase, lineId }], grid: { was, now } | null }`, or null.
- `progression` is now the pin list Compose is sent, `[ratio | { ratio, quality } | null]`: the lab's root picks are the ratio form, a re-compose bakes the chord edits in as `{ ratio, quality }`. `progression()` (the lab's editor) still reads ratios.

**Edits are live (decided).** No edit makes the entry dirty, and the glyph recalls spec + edits with no re-solve. The parts' sound, legato, on/off and levels stay live as before, over the edited notes (re-articulated, never re-mined).

**The merge** (`perform/composer-controller.js`). The edited spec is a fold: `rearrange` + `applyRearrange` once per edit, in `order`, starting from the composed spec (its drums left out; the drums are arranged after, over the edited spec, with the entry's own drum options). The fold keeps each step's spec, so:
- a new edit is one rearrange;
- an undo of the last edit is none (the step before is kept);
- a changed or removed edit re-runs only the steps after it.

Two proposed rules make the order safe:
- **A swap to the chord Compose made removes the edit** (unless the phrase's chords follow a swapped lead), so swapping back is the composed spec byte for byte (4a's identity). The same goes for a lead swapped back to its kept line. A typed chord is kept even then: the user typed it, and it is a pin on the next Compose.
- **A lead swap with "chords follow" drops the chord edits of its phrase** (they would otherwise come back as pins). A chord swapped in that phrase afterwards applies after it, so it wins.

**The API that 4e calls** (each action returns a Promise of `{ ok, kind, changedBars, retunedBars, … }`; on the main thread it has applied before it returns; a failure rolls the edit back and says `{ ok: false, error }`):
- `swapChord(bar, candidate | { rootTone, quality })`; `swapLead(phrase, lineId, { chordsFollow, smooth })`;
- `setProgressionField(text)` → `{ resolution, live }`; `progressionField()` → `{ text, typed, resolution }` (per bar: cents, amber, the pin);
- `setDrumGrid(grid)`, `setDrumCell(bar, voice, place, 'x' | 'X' | '.')`, `applyDrumPreset(mode)`, and `drumGrid()` → `{ grid, mode, own, bars, places, m, silentCells }`;
- `undo()`, `redo()`, `canUndo()`, `canRedo()`;
- `alternatesOf(bar, 'chords' | 'lead')`: a pure read of the kept trace. For chords, the bar's chosen-round candidates (12), each marked `current` and `composed`, with `currentIndex` (-1 when the bar plays a typed chord that isn't among them). For the lead, the bar's phrase: the kept line first, then its runner-ups (8), each with `perNote` and its shape. Other parts: null.
- reads: `effectiveSpec()`, `composedSpec()`, `hasEdits()`, `applying()` (a worker edit in flight), `retunedBars()` (vs Compose's), `editsExport()`;
- events: `onEdit(fn)` → `fn(result, state)` after each applied edit, plus `onChange` as before.

**Chord swaps and the field.**
- A candidate from `alternatesOf` goes straight into `swapChord`.
- **The typed field** resolves the text with `resolveSymbols` against `barMaterials(…, composed.knobs, { row })`. With a composition, each typed bar is a typed chord edit (live), and an auto bar has no chord edit and no pin (the field is the whole chord row's view: swaps show in it as their names). Proposed: removing a pin through the field doesn't make the entry dirty; it only changes what the next Compose is sent. Before any compose, the field's pins are Compose's progression, and the entry goes dirty, as a root pick does.
- A bar already pinned with the same root and asked quality, and composed over that pin, gets no edit.
- **A swap rewrites only its own bar's symbol** in a typed field (`rewriteToken`): the user's separators and spellings elsewhere are kept, and trailing autos are cut.

**The drums.**
- `setDrumCell` starts the grid from the drums as they play now (`gridOf`), sets the cell, and turns the mode to `grid` (decided: an edit turns the mode to grid). Proposed: a `prime` mode stays `prime`, since the grid's perc row is its selection.
- `applyDrumPreset(mode)` plays the preset as itself (its own arrangement, exactly), and the grid shows it through `gridOf` until a cell is edited. Proposed: a preset clears the entry's own grid rather than storing `gridOf(preset)` (with `with` or `partition` a stored grid would re-land 66–72 % of the perc strokes, 4c's measurement).
- `grid` and `prime` are in the controller's drum-mode choices and labels now (`drumModeChoices()` is `ALL_DRUM_MODES`). `setDrums({ mode: 'grid' })` with no grid yet starts one from the drums as they play.

**A re-compose (decided, 5).**
- At Compose's start the chord edits are written into `progression` as `{ ratio, quality }` (a typed one's asked quality), and Compose solves around them. Until the compose lands they still play over the old spec.
- When it lands, a pin is checked against the new spec: not `targeted` there means the new row lacks the root (`notInRow`) or the bar is past the new meter (`pastBars`). It is dropped from the pins and listed in `dropped.pins` (a typed field's symbol for it becomes `-`). A pin whose quality the new bar can't support stays a pin and is listed in `dropped.unhonored`.
- The lead edits are dropped and listed. The edits are cleared (they are pins now), and so is the undo stack (proposed: its steps belong to the old spec).
- **The drum grid** is kept when the meter (N, S) is unchanged, else dropped. The mode goes back to the one the grid came from, and `dropped.grid` says so.
- Proposed: new layers in the lab clear the pins and the field, as they always cleared the progression. The chord edits still go through the check above, so they show as dropped.
- **A new cycle of the same row** (the store's `inheritEdits`) carries the chord edits as pins, the field and the drum grid (checked on its first Compose), never the lead edits.

**Where an edit runs** (proposed). Measured in Node, M4 Max, on the chosen round's candidates (rearrange + applyRearrange; the materials once per composition):

| row | onsets | materials | chord swap, lean: median / max | full: median / max |
| --- | --- | --- | --- | --- |
| 768:769 | 1,536 | 1–2 ms | 1.9 / 4.5 ms | 4.9 / 7.5 ms |
| 3001:2999:2003:1999 | 9,999 | 4–7 ms | 4.1 / 5.6 | 9.0 / 14.3 |
| 4099:4093:4091:4079 | 16,359 | 7–8 ms | 4.6 / 6.2 | 10.4 / 15.8 |
| 16384:16383 | 32,766 | 12–15 ms | 5.8 / 15.0 | 11.1 / 16.7 |
| 65536:65535 | 131,070 | 43–45 ms | 15.3 / 24.0 | 20.5 / 28.3 |
| 262144:262143 | 524,286 | 250–267 ms | 53 / 107 | 61 / 102 |

A lead swap costs the table, not the row: lean 4–13 ms (1.5k to 32k onsets), full 15 ms at 1,536 and 35–42 ms from 10k up; chords following add 5–10 ms.
- **`MAIN_THREAD_ONSETS` = 32,768.** Up to it, every edit runs on the main thread (a chord swap ≤ ~17 ms, plus the materials once). Past it, the module worker runs it.
- **`MAIN_THREAD_LEAD_FULL_ONSETS` = 2,048.** A lead swap on the full table runs in the worker past this.
- **`smooth`** (smoothPhrase, 68–294 ms on the 16k row) always runs in the worker.
- **No worker given** (Node, the lab's default runner): everything runs on the main thread.
- **The worker** is the Compose worker. `compose-worker.js` answers `{ kind: 'rearrange', key, spec, edit, opts }`, and keeps the row and cells of the last 3 keys (`materialsKey`: the layers and the knobs the cells read). `compose-runner.js` exposes it as `runCompose.rearrange`, which the controller takes as its default `runRearrange`. The trace stays on the page: a lead swap sends the line's notes.
- Measured through a mocked worker on 65536:65535 (in-process, a structured clone each way): the first swap 79 ms (the row built in the worker), the next 18 ms. A rearrange on the main thread with the row given: 25 ms.
- An edit while one is in the worker supersedes it (`{ superseded: true }`). The newer fold applies both, reusing every step already made. A worker answer that comes back after a Compose has landed is dropped too.

**`against`, seeded per bar** (`core/drums.js`, owed from 4a). Each bar draws its empty-slot order from its own generator, `${seed}/drums/${bar}` (it was one generator in bar order). Over 168 candidate swaps on 4 rows, no bar but the swapped one moves (before: 52 of 336 swaps re-drew later bars). This changes `against`'s output, so `drums-baseline.mjs` stays frozen and `assert-drum-grid.mjs` leaves out its 4 `against` variants with the reason stated; the other 527 hashes are byte for byte. The prime's p rule is left alone (Avery hasn't re-ruled it).

**JSON export** is the composition as it plays (edits and all) plus `playback`, and, when there are any, `edits: { chords, lead, order, drums: { mode, grid, from } | null, field }`.

**Open, for Avery:**
1. **Re-compose clears undo.** After a Compose the chord edits are pins and the old steps have no spec to apply to. Keep it that way, or keep an undo step that restores the pins?
2. **The field and pins.** Taking a pin out through the field (an auto bar) doesn't make the entry dirty: the spec still plays the pinned chord until the next Compose. Is that right, or should the glyph compose again?
3. **"Chords follow" drops the phrase's chord edits.** Or should a swapped chord stay pinned through it?
4. **A typed quality the bar can't support** plays Compose's pick over the root (with the lead) live, and stays the asked pin for the next Compose. 4b's field shows the fallback without the lead, so the two can name different chords. Show what plays?
5. **The field on rows past the threshold** still reads the bars on the main thread (`barMaterials` with the row: ~10 ms at 16k, ~270 ms at 524k, once per composition). Move it to the worker too?

## Step 4e: the matrix and the context inspector (built 2026-10-25, branch `step4/ui`)

The order: `STEP4_ORDER.md` "4e. UI", the layout of `STEP4_RECOMMENDATIONS.md` §4. **Decided** (decision 8, Avery): the lanes BECOME the matrix, with no tab of their own. Everything else here is **proposed, not ruled**. Node only: nothing here has been seen or heard in a browser.

**Files.** New: `page/matrix.js` (pure: the matrix and the inspector's lists as data), `page/audition.js` (the audition, no DOM), `tests/assert-page-matrix.mjs` (83 checks). Edited: `page/composer-tab.js` + `.css` (the view), `page/tab-controller.js` (the cell selection), `page/plot-overlay.js` (the `getFocus` seam), `page/composer-bridge.js` (passes it), `perform/composer-controller.js` (the audition helper), `index.html` (`?v=`). No `core/`, `store/`, `Cosmos/` or `PartitionsUI.js` edit.

**The matrix** (the window's left half, under the header and readouts).
- Six rows, Lead, Chords, Comping, Bass, Inner, Drums (the lanes' order; the row head is still the part's name and its on/off), and a column a bar, each as wide as its bar lasts. A bar-number row on top. The matrix grows to fill the left half (the empty space of Avery's screenshot); under ~56 px a column it scrolls sideways.
- **A cell is a mini view:** the part's notes as dots (x its time in the cell, y its pitch within the part's whole range; a retriggered note larger than a held one); the chord's name (and the modulation's ↻ as before); the drums as the bar's step grid in miniature (5 voices × S·m places, a silent step outlined amber).
- **A lead cell spans its phrase** (decision 2: 4 bars at S = 8).
- **The marks:** a badge counting the cell's alternates (chords: the candidates not playing; lead: the lines not playing); ✎ on a cell changed from Compose's output (its notes or chord differ; the drums when its own grid differs from the preset it came from); "↻ retunes bars k–m" on the chord cell whose edit re-pitched later bars, and an amber underline on those bars.
- **Selecting a cell** (a click, or the arrows) selects its part and bar (`tab.selectCell`). The overlay rings exactly the cell's nodes on the mirrored plot (`getFocus`: the cell's notes found by tick, a lead cell its whole phrase) while the inspector shows the cell's context; on a settings section the whole part is ringed as before. With no `getFocus` the overlay draws exactly as before.
- **The keyboard** (the matrix is focusable): ←/→ a bar (a lead cell: a phrase), ↑/↓ a part, Enter opens the cell (its context, focus on its first alternate).
- **The playhead** runs across the matrix during Perform, as across the lanes before; the bar playing is lit on the bar numbers and the bar picker.
- **What the last Compose dropped** (`state.dropped`, decision 5) is said in an amber line above the matrix: a pin not in the new row or past the meter, a quality the bar can't support, the lead swaps, the drum grid, an asked p.

**The typed field** runs across the top of the Chords row ("Typed"): one text input over the bars, and under it each bar's resolution in its column (`resolveSymbols`' per bar): the symbol's name, the root's cents, ✓, or amber with the reason in its tooltip (a missing class, the fallback, off the frame with "may retune" or "offGrid"), an unparsed symbol red; the resolution's notes (extra symbols, bars left auto) under it.
- **Applied on Enter or on leaving the field (proposed).** Esc puts the applied text back. The text is kept as typed (4d keeps it as the field's source: `Bb7` stays `Bb7`). The input is one element for the tab's life: a re-render moves it and never drops what's being typed.
- Before any compose (a rhythm, no composition) the field shows alone, its pins Compose's progression.
- ⌘Z while typing in it is the text's own undo, not the composition's.

**The inspector.** A slim header row: the selected part's name, sound, legato, on/off and level (for the drums: mode, fills, on/off, level), then the part picks, then the tabs: **the cell's context** (the default, named "Bar 2 · Chords", "Bars 1–4 · Lead") beside the four settings sections as before (Harmony with the root picks and harmony knobs, Lines, Drums with the kit, Tuning). Picking a part keeps the context (now that part's bar); on a settings section a part opens its own section, as before. The body keeps its scroll while it shows the same cell.
- **Chords:** the bar's 12 candidates (`alternatesOf`), each with its name, root ratio and cents, quality, and support: ✓ when it holds every strong lead note, else amber "n off"; ● plays now, C Compose's. "Typed" or "swapped" when the bar is edited; a typed chord not among them is said.
- **Lead:** the phrase's lines, Compose's first, then its runner-ups, with the cost a note, the note count and the shape (band, motion, contour). **Chords follow** (off by default, as decided) applies to the next swap; on a swapped phrase it re-applies the swap with it flipped (one undo step). **Smooth the phrase** re-mines the inner over the phrase in the worker; it needs a swapped lead, because `swapLead` to Compose's own line is "no edit", and Compose's inner is already mined over the phrase.
- **Bass, Comping, Inner:** "follows bar k's chord: D (root 21/20, major triad)", a button to that chord's cell, the bar's notes (slot, ratio, octave, Hz), "re-mined" when they differ from Compose's. Comping shows its layer, pinned through edits, read-only (`stats.compLayer`; there's no setter). Inner offers "smooth the phrase" once the phrase's lead is swapped. Bass and comping have no re-mine of their own in the API: they re-mine with their chord.
- **Drums:** the bar's step grid (5 voices × S·m places; the beat numbers on top). A click cycles `.` → `x` → `X` → `.` through `setDrumCell`; a silent step is hollow (dashed amber, "no onset here"), from `silentCells`. The presets: every mode and pattern, then `grid` (the drums as they play, written as the grid: `setDrumGrid`) and `prime`, each `applyDrumPreset` (undoable). With mode `prime`, the **prime strip**: every level-1 light at its real time over the cycle (a dark light dashed at its aim), the lights level 2 chose taller, the struck ones bright, this bar's span shaded, and "p = 167, drawn — a prime in (64, 199], one of 28 · 64 cells choose 64 of the 167 lights".
- **Drum modes:** `grid` and `prime` are in every mode list already (4d put them in `drumModeChoices()`; the header select, the strips' select and the lab all read it; checked).

**Audition / keep / revert** (`audition.js` over the controller's new helper).
- **A first click** on an alternate auditions it live. **Stopped,** it applies at once. **Performing,** it's held for the next bar boundary and applied 0.3 s of clock time before it (`LEAD_SECONDS`, above the player's 150 ms lookahead), so the new bar is booked from the new notes. **Which:** the player has no boundary scheduling of its own (it reads the parts every 25 ms tick, so an edit is heard within ~150 ms); the boundary is the audition module's, checked each frame. Proposed: always the next bar boundary, whichever bar the edit touches.
- **A second click** on it, or Keep, keeps it as one undo step. **Esc** or Revert takes it back. A held one not applied yet is dropped. Another alternate clicked while one is open replaces it (still one audition).
- **The controller helper** (`perform/composer-controller.js`, needed because swap + undo leaves a redo step, 4d's note): `audition(run)` snapshots the edits and both stacks before the first audition; `keepAudition()` leaves one undo step back to that snapshot; `revertAudition()` restores the snapshot and both stacks exactly, so no redo step is left and a redo stack that was waiting comes back. `auditioning()`. A Compose landing makes an open audition stale.
- **Proposed:** any other edit (a typed field, a drum step, a preset, redo) keeps an open audition first; undo (⌘Z, the button) reverts it.

**Undo/redo:** Undo and Redo buttons in the header, and ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y elsewhere) while focus is in the window (the matrix, the inspector, or nothing focused), not while typing in a text field. The history is the entry's (per composition, from 4d).

**Narrow widths (proposed):** the matrix scrolls sideways once its columns get under 56 px. Below 600 px of the left half (a CSS container query, `@container ctab-left (max-width: 600px)`, `NARROW_PX`), a bar picker appears and the matrix shows just the picked bar's column (the cells covering it carry `in-pick`), the typed field's strip too; the matrix's playhead hides there (the picker lights the bar playing).

**Worker-path edits** (rows past 32,768 onsets, a full-table lead swap past 2,048, every smoothing): the header says "applying the edit in the worker…" while `applying()`; Keep and Revert wait for it.

**Tests** (`assert-page-matrix.mjs`, 83, over the DOM stub and the site's composite rhythm, 41:42:43 at 8 × 8 and 8:7:6:5): the matrix 6 × N with lead cells spanning phrases; a cell's nodes ringed on the plot, exactly; arrows and Enter; the 12 alternates; audition → keep one undo step; audition → revert with no redo step and the waiting redo stack kept; two auditions kept as one step; the bar-boundary hold while performing; ⌘Z, ⇧⌘Z, Ctrl+Z, and not while typing; the lead context, chords follow, smoothing through a fake worker; bass, comping, inner; the field's inline ✓ and amber on Enter and blur, flats kept; drum steps cycling through `setDrumCell`; every preset; the prime strip against the prime output; a silent step; the narrow fallback; the model; recall through the glyph and the part strips on an edited composition; a re-compose keeping chord pins and dropping (and saying) the lead edits.
- **Existing tests changed** (the markup legitimately changed): `assert-page-view.mjs` (a cell a bar is the Chords row now, the lead a cell a phrase; the inspector opens on the cell's context, so the kit check clicks the Drums section first); `assert-page-tab.mjs` (the default section is the context; a part picked on a settings section opens its own, as before); `assert-page-site.mjs` and `assert-page-theater.mjs` (the bridge's `?v=` checked as a minimum, since it was bumped).

**Open, for Avery:**
1. **The audition's moment:** always the next bar boundary while performing (built), or at once when the edited bar isn't the one sounding?
2. **Another edit during an audition** keeps it (built). Or should it revert?
3. **Smooth the phrase over Compose's own lead** (after a chord swap re-mined the inner bar-locally): the API has no edit for it (smoothing rides a lead swap). Worth a controller action?
4. **Apply the field on Enter or blur** (built), or only on Enter?
5. **The narrow fallback** at 600 px of the left half (one bar and a picker), or always scroll?
6. **The dots' height** is pitch within the part's whole range. Would a fixed pitch window (an octave band) read better across parts?

## MIDI targets (phase A; built 2026-10-26, branch `target/core`)

The order: `TARGET_ORDER.md` phase A (A1–A4); the probe: `probe/midi-target/FINDINGS.md`. Avery's rulings 1–8 there are **decided**; P1–P7 are the planner's, followed as written except where marked; everything else here is **proposed, not ruled**. Node only: nothing here has a UI yet (phase B).

**1. `core/midi.js`** (A1): the probe's `midi.mjs`, ported as a pure module.
- `readMidi(bytes)`, `writeMidi({ ppq, bpm, timeSig, tracks })`, `decodeClip(file, { track, tolerance })`, `skyline(notes)`, `estimateKey(notes)`, `pcName(pc)`, `describeClip(clip)`.
- `decodeClip` → `{ version, name, ppq, bpm, tempoBpm, timeSig, d, S, B, pickup, residual, exact, notes: [{ step, until, midi, pc, velocity }], dropped, key: { tonic, mode, r }, stepSeconds }`.
  - `dropped` (P1): the track's notes not in the line, the skyline's lower notes and the graces two note-ons rounded onto one step.
  - `tempoBpm`: the file's first tempo (120 with none), the seed of a target's playback tempo (decided 1/4).
  - The step-relative tolerance (`EXACT_SHARE`) and the unquantized guess (`UNQUANTIZED_SHARE`) are the probe's.

**2. `core/target.js`** (A2): the search, `placeClip(row, clip, { e, tonic, maxDriftCents, alternates, … })` → `{ placement, alternates, lanes, searched, ms }`.
- **The vote, the refine and the lattices** are the probe's. The search's best equals brute force on the small rows (28/28), and on all 12 probe rows × 9 clips it equals the probe's best (108/108); the engine's materialized hits equal the search's in every one of those cases.
- **Prune (P7):** N from B up; the first N at which some candidate fits every note ends the search, its lattices all tried, best first. A row without a full fit is searched to the probe's top N. Every N's vote buffers are reused.
- **Drift (P3; ruling 6):** per phrase of the clip (harmony.js' 32-slot phrases), a Viterbi over the phrases at the best 8 distinct φ of each N. A state is (ψ, k) (12 lattices × 12 = 144), scored on the phrase's notes; adjacent phrases' tonics, at their realized cents (the lattice tone + 100 × its lane), at most `maxDriftCents` apart (30; 0 turns it off). The drift candidates join the no-drift ones, so drift never makes the best worse.
  - **A call beyond the order:** ranked hits, then the least total drift, then tight hits, then cost. P3 lists tight hits before drift, but then a phrase would drift for timing alone, which its first clause ("drifts only when that gains notes") forbids. With the ranking as built, a placement drifts only when it gains notes: on the probe's 6 test rows × 7 clips never; scanning `rhythms.mjs` (rows under 3,000 onsets × Frère Jacques and Greensleeves), 4 cases (e.g. Greensleeves on 426:317:285, 18 → 19, 6.4¢).
- **Materialized:** the best 16 distinct candidates are built as Compose plays them: φ rounded to a tick, `buildCells` (N × S, partitioned, swing ½), each phrase's frame centred on its lattice tone. Then ranked hits, least drift, note-off hits (P4), tight hits, cost; the best is the placement, the next 8 distinct the alternates.
- **Misses (P2):** fringe (the class in the slot outside the frame), shift (an in-frame onset of the class one slot over), hard (silent). **Calls beyond the order:** a shift stays inside the window, lands strictly between its sounding neighbours, and never on a slot another sounding note holds (one note a slot).
- **Note-offs (P4; ruling 7)** on the loop's own onsets (the window's, and those slot 0 holds before the first anchor, which sound at the loop's end), circular: the next note's note-on when the note-off is its step; else the onset nearest the note-off slot's anchor in its ±½-slot window, after the note-on and no later than the next note-on; else the next onset after the anchor, else the next note-on ("late"). The last note's next is the first (the loop wraps).
- **The placement:** `{ N, B, S, P, phase, tick, window, share (W, the window's share of the cycle), band, phrases: [{ from, bars, psiTone, psiRatio, k, tonicCents, driftCents }], notes: [{ step, until, midi, pc, on: { node, kind, slot, offSlots, dev, pos }, off: { node, late, pos } | null }], hits, tight, offHits, cost, drift, misses, missing, J, search }`. `pos` is LOOP time as a share of the row's cycle; an off's `pos` is after its on's and may pass the loop's end.
- **`laneReport(row, psiTone)`** → `{ psiTone, ratio, cents, counts: [12], empty }`; `placement.missing` and `lanes.missing` are the clip's classes whose lane is empty in their phrase's lattice (ruling 5).
- **`targetRoot`** (P5) and **`registerOf`** (the lead's octaves: the clip's own contour, the tonic just above the root).
- **The one clock read in core:** `ms`, a measurement that steers nothing.

**3. Compose target mode** (A3): `compose(layers, T, { target: { clip, placement?, tonic?, maxDriftCents? } })`.
- **Cells:** N × S from the placement's phase, partitioned, then `cells.js` `cropCells(cells, B)` (slots 0..B·S−1 with their own windows; `slotOfNode` −1 outside; `crop: { bars, P, end }`).
  - **A call beyond the order:** the windows are Compose's own (about 12 onsets a slot), not swing ½. With swing ½ a slot on the 16k row holds ~250 onsets and the bass and inner miners took 30 s (`pickLines` 34 s of a 34 s profile); with the default windows the whole target compose takes ~0.3 s. The lead is pinned by node, so it needs no window; the anchors, slots and window are the placement's.
- **`partContext`** takes `rowCycleSeconds`: with cropped cells, `cycleSeconds` is the loop, an onset in the window sounds at its own time on the row's cycle, one before the first anchor that slot 0 holds sounds at the loop's end (in the last slot), and any other is in no slot (`posSlot` −1) and no bar. Uncropped, every expression is the one it was.
- **The lead:** harmony.js `harmonize(…, { lead: { notes } })` derives the chords from the pinned notes once: no mining, no second pass, no settling (`settle: { rounds: 0, pinned: true }`), each phrase a line record (`pl1:` ids, band `pinned`) for the trace and the rearrange. Each lead note carries `endTime` (its note-off onset) and `clipNote`; `articulate` and `partOf` honour `endTime` over the legato rule, and the rearrange keeps both.
- **Knobs:** `bars` B, `slotsPerBar` S, `beatsPerBar` the clip's numerator, `cycleSeconds` the loop (W × T), `rowCycleSeconds` T, `cut: { bars: N }`, `tempoBpm` 60 × B × beats / loop, `leader: 'target'` (or `progression` / `mixed` with a progression).
- **`spec.target`:** `{ clip, placement, misses, tempoBpm (the clip's), tonic, tonicAsked, maxDriftCents, lanes, alternates, search: { ms, barCounts, stoppedAt } | null }`; `input.target` is the target as given.
- **Overrides:** `TARGET_SETS` (bars, slotsPerBar, anchors, phase, root, presence, settlePasses) are refused; the rest apply. A progression pins chords under the clip.
- **Refusal:** a clip with more than 32 steps a bar (a line's limit) → `{ refused: true, reason: 'targetGrid' }`.
- **`rearrange.js`:** `materialsOf` rebuilds the cut and crops it; `materialsKey` carries the cut (only when there is one); a chord swap works; a lead swap is refused (P6).
- **`drums.js`** on a window: the drums' cycle is the loop (W = cycleSeconds / rowCycleSeconds); places run over [0, W); a stroke's time is its loop time (before the downbeat → the loop's end, past the window's end → its start); the partition layer counts its pulses inside the window and the prime partition spreads its lights over it. Without `cut`, every expression is the one it was (`drums-baseline.mjs` still matches).
- **Identity:** with no target, Compose is byte for byte as before (`assert-refactor-identity.mjs`, 7/7).
- **Trace:** a target compose's trace records the pinned lead as skipped mining (`skipped: 'pinned'`) and the pinned phrases as lines.

**4. Measured** (Node 24, Apple M4 Max; `placeClip`, drift on, warm; then a target compose with that placement given, lean table):

| row | onsets | Frère Jacques (32 notes, B 8) | Ode to Joy (15 notes, B 4) |
|---|--:|---|---|
| 8:7:6:5 | 22 | 5 ms: 5/32, N 8; compose 10 ms | 3 ms: 4/15, N 4; compose 4 ms |
| 768:769 | 1,536 | 553 ms: 17/32, N 9 (66 N tried); compose 93 ms | 257 ms: 12/15, N 4 (70 tried); compose 23 ms |
| 2047:2048 | 4,094 | 955 ms: 18/32, N 9 (66 tried); compose 77 ms | 459 ms: 13/15, N 5 (70 tried); compose 28 ms |
| 275:1144:1260:234 | 2,852 | 41 ms: 32/32, N 8 (1 tried); compose 88 ms | 27 ms: 15/15, N 4 (1 tried); compose 79 ms |
| 4099:4093:4091:4079 | 16,359 | 187 ms: 32/32, N 8 (1 tried); compose 127 ms | 148 ms: 15/15, N 4 (1 tried); compose 41 ms |

The probe took 4.4–9.7 s on the 16k row; the prune (a full fit at N = B ends the search) is all of the gain there. The slowest rows now are the ones with no full fit, which search every N (up to ~1 s on 2047:2048); pruning those further (an upper bound from the vote's counts, a coarse N grid first) is left for when it's felt.

**Tests:** `tests/assert-target.mjs` (46 checks; clips in `tests/fixtures/midi-clips.mjs`, ported from the probe's).

## MIDI targets (phase B; built 2026-10-26, branch `target/ui`)

The order: `TARGET_ORDER.md` phase B (B1–B5), on phase A's core ("MIDI targets (phase A)" above). Avery's rulings 1–8 are **decided**; P1–P7 are the planner's, followed as written; everything else here is **proposed, not ruled**. Node only: nothing here has been seen or heard in a browser (the checklist is in `TARGET_ORDER.md`).

**1. The controller and the store** (B1; `perform/composer-controller.js`, `store/composition-store.js`).
- **The entry's input:** `state.input.target = { clip, tonic, placement? }`. The clip is held as `decodeClip` gives it (plain JSON: the bytes never reach the store); `tonic` is the override (a pitch class) or null (the key estimate); `placement` is a kept alternate (absent: the search's best). Since it is the input, the glyph's recall, undo (the edits apply over the target's spec) and the LRU carry it with the rest of the entry.
- **`state.placements`** (new): the last search's `{ tonic, list: [best, …alternates], current, lanes }`. A compose given its placement doesn't search and returns no alternates, so the list is kept from the compose that searched.
- **`setTarget(bytes | clip | null, { tonic, name })`** decodes here (`readClip`, exported; midi.js' own errors), sets the input and composes (`compose(…, { target })` through the runner). A file that won't decode leaves the entry untouched and answers `{ ok: false, error }`. `null` clears the target and composes an ordinary composition at once.
- **`setTargetTonic(pc | null)`** drops the placement and the list, and composes (placed again: the drift path and the root follow the tonic, P5).
- **Placement auditions:** `auditionPlacement(i)` composes with `list[i]` given (no search) and, when it was playing, plays it again from the top; auditions in a row are one. `keepPlacement()` makes it the entry's (`input.target.placement`; the best kept is no placement, the search's own). `revertPlacement()` puts the entry back exactly as it was before the first audition (the spec object, the trace, the parts, the edits and stacks, the pins, the tempo) with no re-compose, and plays on if it was playing. `placementAudition()` → `{ index, from } | null`. An input change (`touch`) keeps an open audition.
- **Tempo (decided 1/4):** a target compose seeds `state.tempoBpm` from `spec.target.tempoBpm` (clamped to `TEMPO_LIMITS`); `seedTempo()` is that seed (the spec's own tempo without a target), and Reset goes back to it. The player's factor is still the spec's natural tempo over the playback tempo, so the loop plays at the clip's own tempo.
- **P6:** `alternatesOf(bar, 'lead')` is null on a target spec and `swapLead` throws ("the lead is the clip"). Chord swaps, the typed field and the drums work as usual.
- **The knobs a target sets itself** (`TARGET_SETS` ∩ the knobs: bars, slots per bar, anchors, settle passes, presence) are left out of a target's compose (core refuses them), and `progressionBars()` is the clip's B.
- **Where it runs (P7):** with `target`, the search runs inside `compose`, so it runs where Compose runs. The page's default table is full, so the worker. On the lean table, a target compose of a row past `mainThreadOnsets` (`onsetCount`, no row built) goes to the worker anyway, with `overrides.table` kept lean.
- **The runner** (`compose-runner.js`) passes `target` both ways; the worker needed nothing new (it hands its options to `compose` whole).

**2. The window** (B2; `page/composer-tab.js`, the pure `page/target-lines.js`, `page/tab-controller.js`).
- **The control,** under the header: "MIDI clip", Choose a .mid… (a hidden file input, `.mid,.midi`), and a drop anywhere on the window (the left half or the inspector; the left half lights while a file is over it). While the tab is shown, a file dropped just outside the window is caught so the page never navigates to it. With no rhythm on the page, Choose is disabled and a clip is refused ("Generate a rhythm…").
- **The decode line** (`decodeLine`): name (a nameless track takes the file's name), "4/4 on eighths (8 a bar)", bars, notes, "tonic F# minor (estimated, r 0.57)" or "tonic D (asked; …)", the clip's BPM; amber "chords reduced to their top note: n notes dropped" (P1) and "unquantized: the grid is a guess (off by up to x of a quarter)".
- **The tonic** (P5): a select, "auto (F# minor)" then the 12 classes; a pick re-places and composes.
- **The fit line** (`fitLine`): "8/15 notes hit" (amber unless all), "4 tight", "11/11 note-offs on onsets (n late)", "whole cycle" or "window: 4 of 5 bars, from 0.075 of the cycle", amber "3 substituted (2 off the frame, 1 a slot over)", red "4 silent", "the lattice drifts 6.4¢ over 2 phrases", red "the row can't play A" (decided 5). Shown once the target's compose has landed.
- **The placements:** a chip per placement ("best · 8/15", "#2 · 9/15"…, where it sits, tight, substitutes, silent, drift; its lattice path in the tooltip), the current one outlined. A first click auditions it, a second click or Keep keeps it, Esc or Revert takes it back; the line under them says which is being heard.
- **Clear** drops the clip and composes nothing: the entry goes dirty, and the next Compose is an ordinary one (Avery, 2026-10-26; it composed at once as first built). **Errors** in plain words (`targetError`): not a MIDI file, cut short, SMPTE, a format past 1, no notes, a time signature the grid can't hold. A refusal (a grid too fine for a line, `targetGrid`; too few tones) is said by the refusal line (`readouts.js refusalText` words `targetGrid` now).
- The readouts add "clip ode-to-joy · 8/15 hit · 108.0 BPM", and the tempo readout says "(the loop as composed)" on a target. Reset's tooltip says "back to the clip's own tempo".
- The Lines and Harmony knobs the clip sets are disabled, "chose 4 · the clip's".

**3. The matrix** (B3; `page/matrix.js`, CSS).
- **The lead row is the clip:** a dot per clip note, silent ones too. Its height is the clip's own MIDI pitch (the row's pitch can't place a silent note); x is the note's own time (a note sounding before slot 0's anchor, at the loop's end, is drawn at its slot).
- **Marks:** amber ring for a substitute (fringe, shift); hollow red for a hard miss (silent: no onset, nothing lit on the plot); an amber tail for a late note-off. The cell's title counts them. No badge (no lead alternates).
- **The lead's context** (the inspector) lists the phrase's clip notes: name and octave, bar.step, kind, the ratio it plays, its deviation, "late off"; the phrase's lattice (ψ, lane, the tonic's cents, the drift). It says the lead has no alternates and points at the placements.

**4. The plot, the lens, the strips** (B4; `page/plot-highlights.js`, `page/plot-overlay.js`).
- The lead's lit nodes are the clip's sounding nodes (hits and substitutes), with no change of the overlay: they are the lead part's notes.
- **The window playhead:** `highlightsOf` carries `share` (`loopShare(spec)`: the loop over the row's cycle, 1 without a window), and `playheadAt(plot, phaseX, p, share)` maps the loop's p to phase + p × share on the full-cycle plot. The overlay's frame passes it, so the tab's and the lens's playheads both walk the window. The matrix's own playhead already ran over the loop's bars.
- The glyph's recall plays the cached target composition with no re-solve; Play/Stop (the one transport) plays and stops it; the part strips and the Scale readout read it as any composition.

**5. Tests:** `tests/assert-page-target.mjs` (61 checks): B1–B4 over the DOM stub and the site's composite rhythm, plus a big row (4099:4093:4091:4079) through a mocked worker and the lean table past `MAIN_THREAD_ONSETS`. Every suite passes.

**Calls beyond the order (proposed):**
1. **A new clip (or Clear) clears the pins, the typed field, the edits and the drum grid:** they were another meter's bars. The tonic and the placements keep them (the same clip, the same bars).
2. ~~**Clear composes at once**~~ — overruled by Avery (2026-10-26): Clear composes nothing; Compose waits.
3. **A placement audition plays from the top,** not at the next bar boundary: another placement can change the loop's length (N), and it is a whole compose (~0.1–0.6 s). Revert restores the entry without composing.
4. **The best kept is no placement in the input,** so a later compose searches again (deterministic: the same best). An alternate kept is given on every later compose (no search).
5. **A frame (±¢) change or new layers drop a kept placement** and the list (the frame decides what is in tune; the placement is the row's). **A new cycle of the same row carries** the clip, the tonic, the placement and the list (a placement's phase is a share of the cycle).
6. **The lean table past `MAIN_THREAD_ONSETS`** goes to the worker for a target compose (P7's reading), its table kept lean (`overrides.table`).
7. **The one core change:** `chord-symbols.js` `barMaterials` takes `{ cells }`, so the typed field reads a window's cropped cells (`materialsOf`'s) rather than rebuilding uncropped ones from the knobs. Identity and every suite unaffected.
8. **No "show the work" animation on a clip's compose** from the control (the Compose button and the glyph still animate theirs). A target's trace builds a scene without errors (checked in Node, not in the suite).
9. **The lead row's dots by the clip's pitch,** not the sounding pitch (so a silent note has a height).
10. **A decode error changes nothing;** a refusal is the refusal line's (the control doesn't repeat it).

**Follow-ups:**
1. **The drums cut 4 beats a bar** (phase A): 3/4 (Greensleeves) and 6/8 are not honoured there.
2. **The animation's drum bars on a window:** `trace-frames.js` places drum strokes in bars with `trace.cycleSeconds` (the loop), while a window's positions are shares of the row's cycle; the per-bar flashes can land a bar off. The trace would need the row's cycle (a one-field core change).
3. **Chord names stay relative to C** (phase A's call 7): "Am" beside "the row can't play A" reads oddly. Naming from the clip's tonic is open.
4. **The lab has no clip control** (the controller has it all).
5. **Rows with no full fit** search every N (~1 s on 2047:2048), in the worker.
6. **JSON export** carries `spec.target` whole (the clip and the placement).

**Open, for Avery:**
1. **Audition from the top** (built), or at the next bar boundary when the loop's length doesn't change?
2. **Clearing the pins on a new clip** (built), or keep a typed progression across clips?
3. **Clear** composes at once, or goes back to Compose and waits? **Ruled (Avery, 2026-10-26): it waits.**

## Arp mode (phase B core; built 2026-10-27, branch `arp/core`)

`COMP_ARP_ORDER.md`, step B1: `core/arp.js`, `arrangeArp(spec, materials, partId, { pattern, rate, range, legato })` with `partId` the lead or the inner. Like the drums, it's an arrangement over a finished spec and its materials (`materialsOf`): no re-compose, no DP, one pass over the onsets and one over the steps. Compose's own output (Line) is untouched, so every identity fixture holds. The result is the part as the spec has it (`partOf`'s shape, so it replaces `spec.parts[i]`), plus `arp` (the options and the stats) and `line` (the Line part, kept silent; `lineOf` gives it back, and arranging an arp part again starts from it).

- **Steps (decided 3, Q2):** each slot is cut into `rate` equal windows of its time (1–4, default 2). A step's candidates are the onsets whose time falls in it and whose tone is a chord tone of the slot's chord: the span's chord in a chart's split bar. A step with none rests.
- **The ladder and the patterns (Q3):** the chord's classes stacked close from the part's floor, over `range` octaves (1–3, default 2). Each step takes the candidate whose rung is next in the pattern's direction from the last note's rung. "Next" means more than half a semitone away, so a new chord's near-same rung doesn't count as a move. **Up** takes the nearest rung above and wraps to the step's lowest. **Down** mirrors it. **Up-down** turns where nothing lies ahead, and keeps its direction when nothing lies either way. **As played** takes the step's earliest candidate, on the rung of its class nearest the last note. Ties on a rung go to the earliest onset.
- **The floor (proposed):** the lead's is its line's median pitch less half the ladder (median − 600 × range), so the arp's median sits on the line's (within 0–152¢ on the test rows). The inner's is the lead's floor less an octave (`REGISTER.inner`). With no lead notes, the median comes from baseHz.
- **The inner (Q4):** never on the lead's onsets, and it rests on a step where a lead onset falls unless the rate is 3 or more. It reads the lead as the spec has it, so over an arp lead it avoids the arp's onsets (Q5).
- **The lead (Q5):** arranged over the final chords; a MIDI target's lead is refused (`arpRefusal(spec, partId)` gives the reason, for B2's greyed switch).
- **Lengths and velocity (Q6):** `articulate`, with each note's `slotSeconds` set to the step's seconds. Legato off: a note lasts its step (or the gap to the next note, if shorter). On: it holds to the next note. So `rearticulate`, a live legato or sound toggle, keeps the arp's lengths. Velocity is the part's, +0.1 on a slot's first step. hz is `partOf`'s.
- **Stats** (`part.arp.stats`): floor, steps, notes, rests, chordSteps (steps holding a chord tone), chordShare, and the inner's restsForLead.
- **Measured, at the defaults (seed 1):**

  | row | inner | lead |
  |---|---|---|
  | 8:7:6:5 | 5 notes, 7/12 rests, 50% | 7 notes, 5/12 rests, 58% |
  | 19:17:16:15 | 13 notes, 19/32 rests, 44% | 17 notes, 15/32 rests, 53% |
  | 768:784 | 47 notes, 17/64 rests (all for the lead), 100% | 64 notes, no rests, 100% |
  | 4099:4093:4091:4079 | 107 notes, 21/128 rests (all for the lead), 100% | 128 notes, no rests, 100% |

  The percentage is the share of steps holding a chord tone. arrangeArp alone takes about 2.5 ms on the 16k row and under 0.3 ms on the others. Small rows rest a lot at rate 2: a half slot of a 22-onset row often holds no chord tone.
- **Tests:** `tests/assert-arp.mjs` runs 8 rows × both parts × 4 patterns × rates 1–4 × ranges 1–3, with legato on and off. It checks every note's onset, step, class, rung and range, the shape against each step's candidates, the rests and stats, hz, velocity and lengths. It also covers the inner over a Line lead and an arp lead, a chart's split bar, a target (the lead refused; the inner inside three windows), determinism, Back to Line, the options, and the 16k row's time.

**For B2:** the store keeps a part's mode and options (Q7). The controller replaces `spec.parts[i]` with `arrangeArp(...)` and restores it with `lineOf`. After any rebuild of the lead (a lead swap) or the chords (a chord swap, a re-compose), it re-arranges: rearrange the Line part, then the arp over it. An inner arp also re-arranges when the lead changes mode. The drums' *with* mode reads the lead's notes, so they re-arrange too. The order's default inner sound (harp, Q4) is the controller's to set; `arrangeArp` keeps the part's sound.
## Comping in chords (phase A core; built 2026-10-27, branch `comp/core`)

`Composer/COMP_ARP_ORDER.md` steps A1, A2 and A5's core tests. Decisions 1 (strum, then borrow) and 2 (every strike a stroke) are Avery's, marked **decided** there; P1–P10 are the builder's proposals, built as written except where noted below. Nothing here has been heard. The MIDI zone (A3) and the plot's rings and the inspector line (A4) are later steps.

**The rule** (`core/compose.js`, `compChordsOfBar`, `strumOf`):
- **Strokes (P1, decided 2).** Every slot the comp layer strikes is a stroke, at its first strike there. A bar or span with no strike is struck once on its root onset, as before. The stroke's own onset sounds only when its tone is a chord tone; otherwise it only sets the moment.
- **The strum (P3, decided 1).** For each chord class, the class's onset nearest the stroke within ±¼ of the stroke's slot wins. Ties go to the most strikes, then the earliest. Each tone sounds at its own time. The window never leaves the stroke's bar, or its span in a chart's split bar, and the chord is that span's.
- **Borrowed tones (P4).** A class missing from the window takes the bar's chord voice of that class (`chordVoicesOfBar`). It sounds at the stroke's onset and time with the voice's tone, marked `borrowed: true, from: <the voice's onset>`. If the chords part has no voice of that class either, the class is left out.
- **Voicing (P5).** One voice per class, root first, at most 4, stacked close from an octave under the root (as the chord voices are). A note's `voice` is its class's index.
- **Velocity (P7).** The stroke's own onset is 0.55, plus 0.1 for each extra layer striking it. The strum's other tones are 0.5, borrowed tones 0.45.
- **Lengths (P6).** Each tone carries `holdTo`: the next stroke's time, or the span's end for the span's last stroke. `articulate` holds a note no further than that (and no further than its voice's next note). Legato off (the default): the shorter of that and the note's slot. On: all of it. `rearticulate` (the live legato toggle) groups the comp by voice and gives Compose's own lengths.
- **The layer (P2).** The score has four parts, averaged over the bars. (1) The share of the bar's slots struck: 1 between 25 % and 60 %, falling to 0 at none and at every slot. (2) A straight or triplet count of strokes to the bar. (3) A stroke in every bar. (4) The strum's coverage: the share of the chord voices' classes found in the window rather than borrowed. `compLayer` still picks a layer by hand.
- **The spec (P8).** Comp notes gain `voice`, `holdTo`, and `borrowed` and `from` where they apply. The comp part gains `strokes`: `[{ node, tick, time, bar, slot }]`, one a stroke. `stats.compStrum` is the share of the comp's tones found unborrowed. Two new decisions: `compStyle` and `compStrum` (the layer, its strokes and that share).
- **`compStyle` (P9).** `overrides.compStyle: 'notes'` is the old one-note comp, byte for byte (no `strokes`, voices, `compStrum` or new decisions). `'chords'` is the default.

**The probe's numbers, now** (seed 1; strokes, the comp's tones, the share found in the row, the strokes with no borrowed tone, and the old comp's notes for comparison):

| row | onsets | meter | strokes | tones | from the row | pure strokes | old comp notes |
|---|--:|---|---|--:|--:|--:|---|
| 8:7:6:5 | 22 | 2×3 | 6 (layer B) | 15 | 60 % | 2/6 | 3 (layer A) |
| 11:9:7:5 | 29 | 2×4 | 5 (D) | 15 | 27 % | 0/5 | 3 (A) |
| 19:17:16:15 (3 s) | 64 | 1×8 | 8 (A) | 24 | 50 % | 1/8 | 3 (A) |
| 16:12:9 | 30 | 2×4 | 8 (C) | 24 | 50 % | 0/8 | 7 (C) |
| 119:42:15:8 | 172 | 4×8 | 15 (C) | 45 | 44 % | 0/15 | 6 (C) |
| 426:317:285 | 1,024 | 4×8 | 32 (C) | 96 | 47 % | 1/32 | 5 (C) |
| 768:769 | 1,536 | 4×8 | 32 (A) | 96 | 26 % | 0/32 | 5 (A) |
| 768:784 | 1,536 | 4×8 | 32 (A) | 120 | 87 % | 16/32 | 16 (B) |
| 4099:4093:4091:4079 | 16,359 | 8×8 | 64 (A) | 232 | 94 % | 51/64 | 8 (A) |

On the 16k row, scoring every layer and building the bars takes about 10 ms. Compose's lean time is unchanged (about 0.53–0.59 s on a quiet machine, chords or notes).

**Edits and the drums (A2, P9, P10).**
- `rearrange.js` reads the style from the spec's comp part (`strokes` present means chords). A chord swap rebuilds the bar's strokes, strum and borrowed tones over the new chord, so a borrowed tone follows the new chord's voices. `builderNotes` keeps `voice`, `velocity`, `holdTo`, `borrowed` and `from`, and a borrowed tone keeps its source's tone. `stats.compStrum` is recounted. Every bar swapped to its own chord still gives the spec byte for byte.
- The store and the controller pass whole specs and parts through `rearrange`, `applyRearrange` and `rearticulate`, so the fields survive. A JSON round trip of the spec rearranges the same (tested).
- **The drums** read the comp's `strokes` (one a slot) in *with* and *against*, not the strum's tones (`drums.js`). Without `strokes` (notes), the expression is the one it was.

**The frozen fixtures, kept.** No fixture or hash was edited. The tests that compare against them now compose with `compStyle: 'notes'` and delete the override from the spec's input before comparing:
- `assert-refactor-identity.mjs`: the live call, plus the override list in the bad-override error (", compStyle" taken back out)
- `settle-baseline.mjs`'s cases, in `assert-compose.mjs`, `assert-trace.mjs` and `assert-progression.mjs`
- `assert-chord-symbols.mjs`: the b69a39e ratio hashes
- `assert-drum-grid.mjs`: the `drums-baseline.mjs` cases

`assert-drum-grid.mjs`'s fidelity specs also run with `'notes'`. Under chords, *with* → grid → re-landed loses one stroke to a merge on 19:17:16:15 at 8×6 (25 → 24: two strokes land on one place). `assert-composer-midi.mjs` runs with `'notes'` until A3 makes the Comp bus a zone of four, because the chords' strums would stack on its one channel.

The invariant audits learned the new note. A borrowed tone's ratio is its `from`'s, and the comp's strokes, not its notes, are the layer's strikes. These audits are in `assert-compose`, `assert-progression`, `assert-rearrange`, `assert-chart`, `assert-drums` and Cosmos's `assert-compose-dust`.

**Calls beyond the order (proposed):**
1. **The window stays inside the bar** in a plain bar too, not only a span. A window crossing a bar line would mix chords and retunes, and near the downbeat it would wrap around the cycle.
2. **A borrowed tone sounds on the stroke's onset** (`node`, `tick` and `time` are the stroke's). Its tone and ratio are the source voice's (`from`). So time, tick, slot and bar always agree with `node`; only the ratio comes from `from`.
3. **`strokes` on the part,** so the drums read the strokes exactly. A stroke whose own tone isn't a chord tone has no note of its own.
4. **The strum's score part counts only classes the chord voices have.** A class with no voice can be neither found nor borrowed.

**Open, for Avery:**
1. **On dense rows every layer strikes every slot** (768:769, 768:784, 426:317:285, the 16k row: 32/32 or 64/64 strokes). P2's density part is then 0 for every layer, and the comp is a chord on every slot, a pulse. Should comping thin itself there: a stroke every other slot, or a layer's own period over the slots?
2. **Small rows borrow most of the chord** (11:9:7:5 27 %, 768:769 26 % from the row). Borrowed tones sound at the stroke's moment, so these comps are near-block chords. That is ruling 1 as decided, flagged only because it is audible.
3. **The default change moves the drums' *with* and *against*** (the strokes are denser now). Their baselines stay frozen by running with `'notes'`, as P9 proposed.

## Comping and Arp in the window (A3–A4, B2–B4; built 2026-10-27, branch `ui/comp-arp`)

`COMP_ARP_ORDER.md` steps A3, A4, B2, B3 and B4, on the two cores above (no core compose rule changed; Compose's output is the same). Nothing here has been heard or seen in a browser.

**A3: the Comp bus is an MPE zone of four** (`perform/composer-midi.js`, P11).
- `ZONE_MEMBERS = { chords, comp }` generalises `CHORD_MEMBERS`: `COMP_MEMBERS` is channels 2–5, one comp voice a channel by its `voice` (its chord class's index), master channel 1. `channelOf`, `midiNotesOf`'s lanes, `setupBytes` (RPN 6 = 4 on the master, RPN 0 on each member), `allOff`'s channels and the .mid file's Comp track all follow. So `CLEAN_MIDI_ORDER.md`'s routing table is out of date on one row: Comp is no longer "a zone of one".
- The old one-note comp (`compStyle: 'notes'`, no `voice`) plays on channel 2 of that zone.
- The player's chains (`composer-player.js` `chainsOf`) lane the comp by voice too, as the chords are. Without that, a comp in chords with legato on would chain one voice's held note into another's.
- A borrowed tone's pitch is its own `hz` (the source voice's tone, set by compose.js), and the sender reads only `n.hz`. The test checks it on borrowed tones whose onset has another tone.
- `assert-composer-midi.mjs` no longer pins `compStyle: 'notes'`. It checks the comp's zone on the sink and in the file, its voices on 2–5 (more than one used), no channel holding two notes, the borrowed tones' hz, and the old comp on channel 2.

**A4: the plot, the matrix, the inspector, the trace** (P12).
- `plot-highlights.js`: a borrowed tone lights its **source** onset (`from`, found by the chord voice's tick: `sourceTicks`, `litTickOf`) as a ring. The lane gains `rings` (sources the part doesn't otherwise light), and its lit note is marked `ring`. `drawLitPart` draws rings hollow in the part's colour. The cell focus (`tab.cellFocus`) carries `rings` too, so a selected comp cell rings its sources. `soundingAt` glows the source while the borrowed tone sounds.
- The Compose animation (`trace-frames.js`): a part's cascade leaves ring notes out, and they appear when the part has landed (the final frame is exactly the highlights, rings and all).
- The matrix: a borrowed dot is hollow, a ring in the part's colour (`.ctab-dot.borrowed`), as a clip's substitutes are ringed. In Details' notes table its ratio is italic, and its title says so.
- The comp cell's inspector line: `matrix.js` `compLine` gives "7 strokes · 82% from the row", the share behind Details (`ctab-detail`). Its title gives the counts.
- The trace's `part` event already carried each note's `voice`. I added nothing there: the animation reads the lit notes, not the event's. `assert-page-matrix.mjs` checks that the comp event carries a voice on every note.

**B2: the controller and the store** (Q5, Q7).
- **Stored:** `state.arps = { lead, inner }`, each `{ mode: 'line' | 'arp', pattern, rate, range }` (`store/composition-store.js` `lineArps`). The knobs are kept while the part is in Line, so Arp comes back as it was. The arps are in the undo snapshots (`composition-edits.js`) and in the placement audition's snapshot. They are carried to a new cycle of the same row (proposed, as the drum options are).
- **How it plays:** `state.spec` is composed + edits in Line (the fold, as before), then the arps over it (`arrangeArp`, the lead first so the inner hears the lead as it sounds), then the drums over that. Every rebuild therefore goes through the same order: a chord swap, a lead swap, an undo, a redo or a re-compose rebuilds the Line part, then re-arps it from the fresh line. An inner arp follows a change of the lead's mode, and the drums' *with* hears an arp lead. `state.composed` never plays the arps.
- **Live:** `setArp(part, { mode, pattern, rate, range })` is one undo step through the same `edit()` door as a swap. The fold's steps are cached, so only the arps and the drums are rebuilt. `arpOf(part)` returns `{ mode, pattern, rate, range, playing, refusal, stats }`. Before any Compose it is only kept; the Compose arranges it as it lands.
- **Big rows:** past `MAIN_THREAD_ONSETS` the arps go to the module worker (`runCompose.arp`, compose-worker's `answerArp`), from the same kept materials as its edits. Everything else arranges on the main thread: arrangeArp is about 2.5 ms on the 16k row.
- **Q5:** while the lead is an arp, `alternatesOf(bar, 'lead')` is null, so the runner-ups and the badge are hidden. `swapLead` still works under it, since it swaps the line the arp is built from; the window just doesn't offer it. On a MIDI target, `arpRefusal` refuses the lead's Arp (`setArp` → `{ ok: false, error }`). Setting a clip also puts the lead back in Line (proposed), so it doesn't come back silently after Clear. The inner's Arp works on a target (inside the window).
- **Q4, the sound:** an inner arp's own sound is the harp (`INNER_ARP_SOUND`). To keep a sound the user chose, `settleState` now carries a part's sound through a rebuild only where it differs from the spec's own part's sound. Legato and on/off always carry, as before. So switching the inner to Arp gives the harp, Line gives back its own sound, and a sound picked by hand stays in both modes. For every edit that existed before, this is the same as it was, because a rebuild never changed a part's own sound.
- `editsExport` (JSON) gains `arps` when a part is in Arp. The spec's arp parts carry `arp` (the options and stats) and `line` (the silent line), as arrangeArp returns them.

**B3: the window** (Q8).
- The lead's and the inner's cell inspectors open on a **Line | Arp** pair. With Arp on, Pattern (Up, Down, Up-down, As played), Rate ("1–4 a slot") and Range ("1–3 oct") sit on the same row, as small selects.
- Details adds "50 rests of 64 · 27% of steps on a chord tone"; its title gives the notes and the rests for the lead.
- An arp lead's context is just the switch, the knobs and "Line brings the melody back, and its runner-ups". An arp inner hides "smooth the phrase", and its tag says arp.
- On a target, the lead's (clip) context shows the switch disabled. Its title, and each button's, is arpRefusal's text.
- The matrix's lane name and the Playback div's part strip read "Lead · arp" / "Inner · arp".
- The tab stylesheet's `?v=` (20261027.3) and the bridge's (20261027) are bumped in `index.html`.

**B4: the tests.** `assert-page-arp.mjs` (37 checks) covers:
- the switch in both inspectors, Line by default
- Arp live with no Compose, exactly arrangeArp over the spec in Line
- the harp, and a chosen sound winning over it
- each knob through its select, each one undo step
- undo and redo through the header's buttons
- an arp lead hiding its runner-ups, re-arranging the inner off its onsets and the drums' *with*
- Back to Line restoring the melody byte for byte
- a chord swap: the Line parts equal to `rearrange`'s, and the arps over them on the new chord's tones
- a re-compose (same seed) keeping the modes
- the glyph's recall with no Compose, and the strips' "· arp"
- a target: the lead put back in Line, its switch disabled with arpRefusal's title, setArp refused, the inner free
- the worker path (the same parts as on the main thread, and a re-compose re-arping there before it lands)

A4's checks are in `assert-page-highlights.mjs` (rings, the hollow draw) and `assert-page-matrix.mjs` (the hollow dots, the comp line, the focus rings, the trace's voices).

**Not verifiable in Node (for Avery's pass):**
- what the rings look like on the plot (radius r − 0.75, hollow), and whether they read as "borrowed" next to the selected part's outer ring
- how the switch and selects fit in the inspector at narrow widths
- the harp under the lead
- whether the inner's arp at rate 2 on small rows rests so much it sounds broken (41:42:43 at 4 × 8: 50 of 64 steps rest)
- the Comp zone on a real MPE track (Ableton's MPE input on the Comp bus, now channels 2–5)

## Mined arps (Amendment 1, phase D core)

`COMP_ARP_ORDER.md`, Amendment 1, M1–M7 (built 2026-10-27, branch `arp/mined`). `core/arp.js` is rewritten: `arrangeArp(spec, materials, partId, { time, picks, legato })` mines the arp with chunk-lines' `arp` line type instead of walking a ladder (decided 7). It's still an arrangement over a finished spec, live, with no re-compose, and Compose's own output is unchanged. B1's walk survives only as the fallback. The part keeps B1's contract: `partOf`'s shape, `line` (`lineOf`), `arpRefusal`, and `arp`, which now holds `{ time, picks, legato, stats, phrases }`.

- **The anchors (M1):** `buildCells(row, { bars, slotsPerBar: S × time, anchors, phase })` with the spec's own anchors mode and phase (a MIDI target's cut cropped as `materialsOf` crops it), for time 1, 2 or 3. Each anchor's window is buildCells' own (about 12 onsets). The cells are kept per time in a WeakMap against the materials' cells; time 1 is the spec's own cells. A time whose S × time passes 32 anchors a phrase (a chart at 12 or 16 slots a bar) runs at the largest that fits (`arpTimes(spec)`; `stats.time` says which ran, and the window greys the others). Proposed.
- **The chords (M1):** `rearrange.js` gains `chordRecordsOf(spec, row, cells)`, a thin export at the file's end over its own `walkChords`. So the records carry the modulation offsets walked from bar 1 and a chart's spans, exactly as a rearrange rebuilds them (the test checks them against `spec.chords`, the 16k row's two modulations included). A span's slots are scaled by the time, and the targets are `targetsOf` over them.
- **Mining (M1):** each phrase is `phrasesOf` over the S × time cells (≤ 32 anchors), mined with `ARP_TYPE`: chunk-lines' arp type with a second band, "few rests" (60–95 % of the anchors, `maxGap` 2), beside its "no rests". That's 5 contours × 2 bands, so at most 10 distinct lines a phrase. The miner's rules hold, so a note is a chord tone, a parent-scale tone, or a foreign tone on a weak anchor resolving by step (never last). An arp is not chord tones only: on the test rows 33–100 % of the notes are (below).
- **Ranking and picks (M2):** "no rests" first, then "few rests", then cost per note. Each phrase keeps 10 alternates, `{ id, contour, band, n, perNote, chordTones, notes: [{ step, node, octave }] }`. `picks: { [phrase]: id }` plays another; the default is the first. A pick the phrase doesn't offer (its chords changed, or it was walked) falls back to the first, recorded as `missed`.
- **Register and the inner (M3):** the lead's range starts 600¢ under its line's median, so the contour's octave is centred on it. The inner's starts an octave lower. The inner never takes the lead's onsets (`avoidNodes`) and pays `weights.avoid` 0.6 (innerOf's price) on an anchor whose window holds a lead onset (`avoidSlots` on the S × time grid). Over a dense arp lead that's every anchor, so the price stops discriminating, and the inner loses whole tones where the lead holds a window's only onset of them. That's the lattice's one-node-per-tone rule. On small rows the inner is then often walked.
- **The fallback (M4):** a phrase with nothing mined is walked: B1's ladder in 'played', `time` steps a slot over its spec slots (2 octaves from 1200¢ under the line median; the inner an octave lower, off the lead and, below 3 a slot, resting where it strikes). It's marked `walked`. `stats` = `{ time, phrases, mined, walked, anchors, notes, rests, chordTones, chordShare, (inner) onLead }`.
- **Knobs (M5):** time, picks, legato. Pattern, rate and range are gone (a mined arp lives in the type's own range). In the window, a Time select (×1, ×2, ×3) replaces Pattern, Rate and Range, and Details reads "N rests of M · P% chord tones · K of L phrases mined". The store's `arps[part]` is `{ mode, time, picks }`. `setArp(part, { mode, time, picks })` is one undo step, and `arpOf` adds `times` and `phrases` (for phase E's picker). There's no alternates UI yet: that's phase E.
- **Velocity (proposed):** the part's, +0.1 on a note at a strong beat's anchor (the bar's downbeat or middle on the spec's grid). Q6's "a slot's first step" would accent every note at ×1. Lengths are B1's (`slotSeconds` the anchor's span).

**M6, why 768:769 mined nothing.** It isn't a porting bug: chunk-lines has the same rule. The miner calls a slot *weak* (a foreign tone may pass there) when its strikes are under the phrase's median. 768:769 is struck evenly: every slot has 48 strikes (slot 0 has 49), so none is under the median, and every foreign tone is barred everywhere. Its 384 tones fill the octave, so ~70 % sit outside every ±15¢ frame (115 of 384 are inside F's). Each 12-onset window holds two narrow bands of pitch, so 8 of the 32 anchors at ×1 hold no in-frame scale tone. Two such anchors in a row break the bands' `maxGap` (1 and 2). **The fix:** `lines.js` gains an opt-in `weakTies` (`buildLattice`, `mineLines`): an anchor tied at the median and off the bar's strong beats is weak too. Absent, nothing changes, so Compose's lines and every fixture are untouched. `arrangeArp` mines each phrase without it first, and only a phrase that mines nothing is mined again with it (`phrase.weakTies`). Mining with it everywhere doubled the 16k row's time (×3: ~80 ms a part) and changed rows that didn't need it. 768:769 now mines ×1 (lead), ×2 (both) and half of ×3. The rest is walked. Its arps are 33–58 % chord tones.

**Measured (seed 1; arps a phrase, W = walked; chord tones' share; ms a part, warm):**

| row | ×1 inner / lead | ×2 inner / lead | ×3 inner / lead |
|---|---|---|---|
| 8:7:6:5 | [5] 100 % / [5] 100 % | W / W | W / W |
| 19:17:16:15 | [8] 69 % / [9] 88 % | [5] 65 % / [4] 80 % | W W / W W |
| 768:769 | W / [5] 55 %, ~12 ms | [5 5] 33 % / 40 %, ~30 ms | [5 W W 5] 51 % / 58 %, ~35 ms |
| 768:784 | [10] 88 % / 88 %, ~8 ms | [10 10] 94 %, ~9 ms | [10 ×4] 89 %, ~12–16 ms |
| 119:42:15:8 | [8] 78 % / [9] 88 % | [7 3] 77 % / [7 7] 83 % | [4 6 1 1] 69 % / [6 6 3 3] 77 % |
| 4099:4093:4091:4079 | [10 10] 69 % / 73 %, ~23 ms | [5 5 10 5] 76 % / 80 %, ~38 ms | [5 10 10 W 10 10 10 5] 67 % / 66 %, ~54 ms |

The small rows take under 4 ms. The 16k row's walked phrase at ×3 is bar 4, the first modulation: its last two anchors hold only foreign tones, and a line may not end on one. M7: the 16k row (16,359 onsets) stays on the main thread under `MAIN_THREAD_ONSETS` (32,768), so lead and inner together at ×3 are ~110 ms there. The planner's ~40 ms was measured with modulation off.

**Tests:** `assert-arp.mjs` is rewritten. Over 8 rows × both parts × ×1–×3 (legato on and off at ×2), every mined note is a real onset inside its anchor's window on the test's own S × time cells, at its own time, one a window. Its class under the anchor's chord is a chord tone, a parent-scale tone, or a foreign tone resolved by step. hz, velocity and lengths are checked, and the part plays the picked alternate. Each walked phrase is exactly B1's 'played' steps, and the stats are recounted. It also covers `chordRecordsOf` against the spec's chords; the ranking ("no rests" over cheaper "few rests" in 38 of 64 mined phrases); picks and a missed pick; the fallback marked; 768:769's weak ties; the inner over a Line lead and an arp lead; register; a chart's split bar and a 16-slot chart's ×3 → ×2; a target's lead refused and its inner in three windows; determinism and Back to Line; the options; and ×1–×3 on the 16k row (each part under 150 ms). `assert-page-arp.mjs` follows the knobs: the Time select, a pick through `setArp`, and undo through them.

## Layout (agreed earlier, 2026-10-21)

- The Composer keeps the Partitions window frame:
  - left half: track lanes, one row per part, one column per section
  - upper right: the mirrored visualization, with a lit-node layer per part
  - lower right: an inspector for the selected part (Harmony, Lines, Claves, Tuning)
- **Scale Selection and Families are left out (decided):** the Composer does its own selection.
- **Sections first (decided).** Zooming into a section's bars comes later, with the Linear Plot gesture: cmd+scroll horizontal, alt+scroll vertical (`LRCVisuals.handleCanvasWheel` / `zoomLinearAxis`).
- **Drums come later (decided).** The mining core comes first. Leaning: Partitions keeps its own tab as the drum editor, the Perc lane is Partitions, and Partitions needs a pattern per section.

## Proposed code home (built in the sprint, except `Composer/workers/`: the worker is `Composer/core/compose-worker.js`)

- **`Composer/core/`:** pure ES modules: row, cells and partitioned anchors, frame and classes, lines, harmony from melody, roots and modulation. Ported from chunk-tunes where useful, owned by the LRC from day one.
- **`Composer/workers/`:** mining off the main thread, if the probe says it's needed.
- **`Composer/tests/`:** Node scripts. One check from the start: on a single Codex rhythm with matching settings, the first ported row and lattice match chunk-tunes' output. That catches porting mistakes; after that, divergence is expected.
- **`Composer/lab/`:** a standalone page, not linked from `index.html`, to hear compositions from the current rhythm through `Audio/voices` before the window UI exists.

## Still open (for Avery)

The six questions from 2026-10-21. The sprint built a proposal for each; each still needs a ruling:

1. **Compose's timing goal: a tempo range, or an onset density per slot.** Built as both: a 90–130 BPM range picks N, then a density floor of 3 onsets per slot lowers S, and only then N.
2. **What happens to fringe tones.** Built as chunk-lines' outside tones: allowed only on a weak slot, resolved by step.
3. **Whether a modulation jumps or glides, and who chooses it.** Built as a jump at a bar boundary, chosen by Compose, with an off switch. The lab can't trigger one by hand yet. Heard 2026-10-22: works as built.
4. **Whether chords strictly follow melodies, or parsimony gets a vote.** Built with melody first; parsimony only breaks ties. Heard 2026-10-22: Avery likes the progressions; settle passes now let the chords follow the kept lead.
5. **The size gate number, after the probe.** Proposed: 1,048,576 onsets, and a minimum of 3 tones.
6. **How the parts divide one cycle's onsets.** Built as shared: two parts may sound the same onset. The inner voice alone avoids the lead's.

Raised during the sprint:

7. **Default root.** ~~Is "heard max(2, 1% of onsets) times" the right sense of "the root is present"?~~ Ruled 2026-10-22: presence by the ±frame cluster (decided). The rungs and the frame-onsets tie-break on top of it are still proposed.
8. **Chords follow the first lead, not the kept one.** Avery asked for settle passes (built 2026-10-22, default 3 rounds). The cap, the stopping rule and the oscillation pick are proposed, not ruled.
9. **Rare colours.** maj7 is the most common chord (25%), and mMaj7 and aug appear on tone-rich rows. Hear them first, then rule.
10. **Folding modulation offsets** into [−50, +50)¢ as a pure relabel. Do the folded names read right?
11. **Grids past 2^53** are refused for v1 (four coprime layers near 10,000 already pass it). Lift with BigInt or two-part positions?
12. **Bass.** Its own sparse type, mined bar by bar and opening on the root. It is two octaves under the lead, with legato off by default. Avery, 2026-10-22: bar by bar is fine; leaps are fine; the root should be clearly stated most of the time.
13. **Comping** uses one layer's first strike per slot, with the bar's chord tones as the tone set. That's chunk-tunes' tone-set decomposition on the Composer's slot grid, not on the layer's own strikes (which gave 350 comping notes on the 16k row). Proposed: use the native layer-pulse cut when a layer strikes 16 or fewer times a bar. Avery, 2026-10-22: comping will get chords.
14. **Sounds and legato defaults per part.** The lead and bass sounds follow their legato; chords, comping and inner are chosen by the seed.
15. **Times count from the downbeat (the phase), looping.** A pickup note just before bar 1 sounds at the end of the cycle.
16. **Velocities** are fixed per part, with small accents.
17. **The presence rungs.** On 41:42:43 the 1% rung is only 2, so the frame decides, and the new root (41/22) is alone in its cluster and finds only 2 of 3 downbeats. Should cluster presence outrank the frame on small rows?

## Next (after 2026-10-22)

1. **Drums:** built 2026-10-22 night as a single level (see "Drums"); the listening pass and the two-level prime partition are next.
2. **Comping as chords.**
3. **Bass weighted to state the root** on strong slots.
4. **Several loops of the same row,** each with a different decomposition, for form and development.
5. **The Composer window** in the LRC: built 2026-10-22 night as a tab of the Partitions window ("Composer tab on the main page"); Avery's browser pass is next.
6. **v2:** bass-led composition; a full arpeggiator for the inner voice.
7. **Outside the Composer:** `Core Interface/LRCModule.js:245` spread `Math.max(...spacesPlot)`, which overflowed the stack past ~124k onsets in Node. Fixed 2026-10-22 night, with the same spreads in `generateToneRowData` and in LRCVisuals' plot.

