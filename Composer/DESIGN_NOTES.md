# Composer: design notes (draft, 2026-10-21; updated 2026-10-22)

Working notes from Avery's chat with Claude. Items marked **decided** are Avery's calls; everything else is a proposal or an open question. The 2026-10-21 sprint built phases 1–5 on branch `composer-prototype` (the "Phase" sections below), and Avery's first listening pass on 2026-10-22 is recorded under "First listening pass". The drums were built on the night of 2026-10-22 ("Drums"), on branch `sprint/drums`. `Composer/README.md` is the short way in: how to run it and where things are.

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

**The deferred two-level prime partition (not built).** As Avery described it:
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
7. **Found, not fixed:** in Node, `LRCModule.calculateTotalLCM(...activeLayers)` returns NaN for fewer than four layers. `lcm(x, undefined)` is NaN, so a rhythm entered with blank layers (768:769 with C and D empty) gets a NaN grid. Entering 1 for an unused layer works. This is untested in a browser; worth a look as its own live-site fix.

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

