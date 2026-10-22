# Composer: design notes (draft, 2026-10-21; updated 2026-10-22)

Working notes from Avery's chat with Claude. Items marked **decided** are Avery's calls; everything else is a proposal or an open question. The 2026-10-21 sprint built phases 1–5 on branch `composer-prototype` (the "Phase" sections below), and Avery's first listening pass on 2026-10-22 is recorded under "First listening pass". `Composer/README.md` is the short way in: how to run it and where things are.

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

1. **Drums:** Partitions as the Perc part, with a pattern per section. Starts in a new thread.
2. **Comping as chords.**
3. **Bass weighted to state the root** on strong slots.
4. **Several loops of the same row,** each with a different decomposition, for form and development.
5. **The Composer window** in the LRC: the layout above, with the lanes, mirror and inspector.
6. **v2:** bass-led composition; a full arpeggiator for the inner voice.
7. **Outside the Composer:** `Core Interface/LRCModule.js:245` spreads `Math.max(...spacesPlot)`, which overflowed the stack past ~124k onsets in Node (untested in a browser). This is a live-site risk, and a one-line fix.

