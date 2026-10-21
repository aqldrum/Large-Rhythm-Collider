# Composer: design notes (draft, 2026-10-21)

Working notes from Avery's chat with Claude. Nothing here is built. Items marked **decided** are Avery's calls; everything else is a proposal or an open question.

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
5. Size gate: taken from the cost probe. Until then, 16,384 onsets, as in Cosmos.
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

## Phase 1: row and cells (built 2026-10-21, sprint)

`Composer/core/row.js` and `Composer/core/cells.js`, checked by `Composer/tests/assert-row.mjs` and `assert-cells.mjs`. On 52 rhythms (up to 5,368 onsets, most with 4 layers), the row and the even-anchor slot candidates equal chunk-super-row's normalized row and `slotCandidates` for the same single rhythm, and the onset-sized window equals chunk-lines' `buildLattice` swing. A second, tick-by-tick producer checks every tone and every slot in exact fractions.

Choices made without a ruling. Each is **proposed, not ruled**:

- **Tones are keyed by their exact fraction.** The kernel and the live site (`LRCModule.decimalToFraction`) spell a ratio as its best fraction with a denominator up to 1000. That is exact for small rhythms. Past that it rounds: in the tests, by up to 0.9¢, and two different tones can get one spelling (426:317:285 has 204 tones and 203 spellings). It can also spell a ratio just under the octave as 2/1. The row keeps the site's spelling beside each tone as `toneLabels`, so the lab can name tones the way the main page does.
- **Layer A is `layers[0]`, as the LRC names layers.** chunk-super-row sorts layers smallest first. A 0 is an absent layer, as in `generateCompositeRhythm`.
- **No 2^25 grid cap.** One rhythm has one denominator, so ticks are 64-bit floats, exact below 2^53. A grid past 2^53 is refused as `{ tooLarge, grid, limit }`. Under the 16,384 gate it's hardly reachable: a large grid needs nearly coprime layers, whose onsets come close to their sum, and four layers summing to 16,384 multiply to at most about 2.8·10^14. The tests reach it with the gate lifted.
- **The gate counts onsets from the layers alone** (inclusion–exclusion over gcds), so refusing a dense row costs nothing. A row of exactly the gate builds.
- **Partitioned anchors cut the grid,** Partitions' Grid mode. Sequence and Grouping aren't ported. The pulse order is Partitions' own (`PartitionsBlocks.calculatePartitionSizes`), so a Composer slot and a Partitions block match. The tests show it's a rotation of Bjorklund's pattern and of chunk-timeline's `euclid` for every T ≤ 300, P ≤ 64. A given order of pulses (a dragged one) is accepted.
- **When P is more than the grid,** the cut is made on a grid `subdivide` = ⌈P / grid⌉ times finer, rather than refused.
- **The window reaches `swing` of the way to each neighbouring anchor.** With even anchors that is exactly chunk-super-row's window. With partitioned anchors each side scales with its own pulse, so at swing 0.5 every onset belongs to exactly one slot, and an onset exactly midway goes to the slot before it. Windows never overlap, so `slotOfNode` names each onset's single slot, or none.
- **The onset-sized window uses the row's mean density** (chunk-lines' formula: about `moments` onsets per slot on average; measured 0.99 × moments on rows of 1,000+ onsets). It doesn't take the nearest k onsets around each anchor.
- **The phase is a fraction of the cycle in both modes** (`phaseAtTick` turns a tick into one). A slot's registers are a sorted list, not a bit mask, because on large grids they pass 31.

Cost, measured once (not the probe): 4099:4093:4091:4079 (16,359 onsets, 4,177 tones) builds its row in about 18 ms and a 32-slot cut in about 0.3 ms.

## Layout (agreed earlier, 2026-10-21)

- The Composer keeps the Partitions window frame:
  - left half: track lanes, one row per part, one column per section
  - upper right: the mirrored visualization, with a lit-node layer per part
  - lower right: an inspector for the selected part (Harmony, Lines, Claves, Tuning)
- **Scale Selection and Families are left out (decided):** the Composer does its own selection.
- **Sections first (decided).** Zooming into a section's bars comes later, with the Linear Plot gesture: cmd+scroll horizontal, alt+scroll vertical (`LRCVisuals.handleCanvasWheel` / `zoomLinearAxis`).
- **Drums come later (decided).** The mining core comes first. Leaning: Partitions keeps its own tab as the drum editor, the Perc lane is Partitions, and Partitions needs a pattern per section.

## Proposed code home (not started)

- **`Composer/core/`:** pure ES modules: row, cells and partitioned anchors, frame and classes, lines, harmony from melody, roots and modulation. Ported from chunk-tunes where useful, owned by the LRC from day one.
- **`Composer/workers/`:** mining off the main thread, if the probe says it's needed.
- **`Composer/tests/`:** Node scripts. One check from the start: on a single Codex rhythm with matching settings, the first ported row and lattice match chunk-tunes' output. That catches porting mistakes; after that, divergence is expected.
- **`Composer/lab/`:** a standalone page, not linked from `index.html`, to hear compositions from the current rhythm through `Audio/voices` before the window UI exists.

## Still open (for Avery)

1. Compose's timing goal: a tempo range, or an onset density per slot.
2. What happens to fringe tones.
3. Whether a modulation jumps or glides, and who chooses it.
4. Whether chords strictly follow melodies, or parsimony gets a vote.
5. The size gate number, after the probe.
6. How the parts divide one cycle's onsets: can two parts use the same onset, or does each onset belong to one part?
