# MIDI-target probe: findings (2026-10-26)

Can the Composer take a standard 12EDO MIDI clip and find it inside one rhythm's row, as a line of real onsets? This is the inverse of mining. Compose cuts bars and slots first and then looks for tuned notes near the anchors. Here the notes are given, and the anchors (bar count, phase), the tuning and the transposition are the unknowns.

Everything under "Proposals" is a **proposal**; nothing here is ruled. Nothing in `core/` was changed. The probe imports `row.js`, `frame.js` and `cells.js` read-only.

- **Run:** `node Composer/probe/midi-target/run.mjs` (about 20 minutes, mostly on the 16k row; `--quick` skips rows of 2,000 onsets and more). It writes `results-<date>.json` and prints the report, saved as `report-2026-10-26.md`.
- **Checks:**
  - `node verify.mjs` checks the vote against brute force (small rows).
  - `node predict.mjs results-2026-10-26.json` checks the density estimate.
- **Machine:** Apple M4 Max, Node 24.

## What was built

| file | what it does |
|---|---|
| `midi.mjs` | Reads Standard MIDI Files (format 0/1: running status, note-on with velocity 0, tempo, time signature). Writes them, to author the clips. Decodes the grid: `decodeClip` → `{ d, S, B, pickup, notes: [{ step, until, midi, pc }], key }`. |
| `clips.mjs` | 10 clips written as real `.mid` files under `clips/` and read back from disk. |
| `target.mjs` | The search: lattices (ψ), lanes, the vote over (k, φ) for every N, the exact refine, and `checkWithEngine` (the engine's own `buildCells` partitioned + `frameAt`). |
| `run.mjs` | Every clip × 12 rows, with controls (3 pitch-shuffles and 3 random-pitch clips per case) and the report. |
| `verify.mjs`, `predict.mjs` | The brute-force check and the density estimate. |

### The method in one paragraph

The root splits into two unknowns.
- **ψ, the tuning lattice:** a tone whose cents mod 100 centre the ±15¢ frame. Only ψ decides which onsets are in tune; that's how `frameAt` already works.
- **k, the transposition:** which of the lattice's 12 pitch-class lanes is the clip's C.

The search then runs per lattice and per bar count N (P = N·S slots):
- Every clip note × every in-tune onset casts one vote for (k, φ), where φ is "the phase that puts this note on this onset", within ±½ slot. This is a Hough transform.
- Peaks are refined exactly. Each one is evaluated at every interval end inside the peak bin, then φ is centred among its hits so the worst timing error is as small as possible.
- Rests and note lengths are not searched. A rest is a slot the line leaves empty, and a length is articulation.

## Results

12 rows (the 6 lab presets, plus 6 that vary onsets and tones independently) × 9 searched clips (13–32 notes; 4/4 and 3/4; quarter, eighth, sixteenth and triplet grids).

### 1. The search is correct, and the engine agrees with it

- **Against brute force:** the vote reaches the true best placement in **28 of 28** cases on the small rows (`verify.mjs`). The first version of the refine missed by one note in 6 of 28; the fix is described above.
- **Against the engine:** `buildCells` (partitioned anchors, phase at the nearest tick, swing ½) + `frameAt` reproduce the search's hits in **108 of 108** cases, with the root on the lattice tone.

### 2. Whether a row can play a clip is about the row, not the melody

**The melodies fit no better than their own pitches shuffled.** Over 108 cases, real hits minus the shuffled mean is **+0.05 notes**. Real minus random pitch classes is **+0.22**.
- The row has no preference for any melody. It either has an in-tune onset of the right class near each slot, or it doesn't.
- The only real pitch effect is the clip's **pitch-class set** on tone-poor rows. 1512:280:840:864 has 6 tones and 4 of 12 lanes: Frère Jacques gets 24/32, shuffled 24, random 16.7. 119:42:15:8 shows the same: 19 vs 19.3 vs 12.7.

**A density estimate predicts the fit before any search.** The estimate is the max over k of Σ (1 − e^(−lane count / P)) at N = B. It correlates **r = 0.88** with the observed whole-cycle hits (`predict.mjs`). It runs low (0.62 vs 0.76), because the search also picks the best phase and lattice.

**Exact fits by row** (best placement, every note in the ±15¢ frame within ½ slot):

| row | onsets | tones | in-frame onsets (lanes used, smallest lane) | exact fits | mean share of notes hit | tight hits (≤ ¼ slot) |
|---|--:|--:|---|--:|--:|--:|
| 8:7:6:5 | 22 | 7 | 12 (3/12, 0) | 0/9 | 0.26 | 0.83 |
| 19:17:16:15 | 64 | 20 | 52 (12/12, 2) | 0/9 | 0.59 | 0.54 |
| 41:42:43 | 124 | 41 | 70 (10/12, 0) | 0/9 | 0.59 | 0.56 |
| 119:42:15:8 | 172 | 12 | 156 (7/12, 0) | 0/9 | 0.65 | 0.72 |
| 201:202:203 | 604 | 201 | 224 (12/12, 6) | 3/9 | 0.84 | 0.54 |
| 768:769 | 1,536 | 384 | 496 (12/12, 26) | 1/9 | 0.82 | 0.47 |
| 504:234:520:297 | 1,496 | 108 | 704 (12/12, 2) | 8/9 | 1.00 | 0.92 |
| 1512:280:840:864 | 2,832 | 6 | 2,736 (4/12, 0) | 0/9 | 0.61 | 1.00 |
| 275:1144:1260:234 | 2,852 | 178 | 1,118 (12/12, 34) | **9/9** | 1.00 | 0.98 |
| 2047:2048 | 4,094 | 1,024 | 1,264 (12/12, 68) | 1/9 | 0.84 | 0.52 |
| 756:2079:2574:315 | 5,364 | 28 | 3,240 (10/12, 0) | 7/9 | 0.98 | 1.00 |
| 4099:4093:4091:4079 | 16,359 | 4,177 | 5,153 (12/12, 344) | **9/9** | 1.00 | 1.00 |

How to read it:
- **Under ~200 onsets, no clip fits.** The 4 small presets reach 26–65% of the notes, and many hits are loose (½ slot is a lot of swing).
- **Smooth-grid, many-layer rows fit everything,** even with fewer onsets than the pair rows. 275:1144:1260:234 and 504:234:520:297 have most onsets in tune, on all 12 lanes, spread over the whole cycle.
- **Pair and consecutive rows plateau at 80–85%** (2047:2048, 768:769, 201:202:203). Their lanes have enough onsets but are **clustered in time**. On 2047:2048, each lane sounds in only 8–20 of 32 slices of the cycle; on 275:1144:1260:234 it's 29–32, and on the 16k row all 32. Each pitch class lives in its own region of the cycle, because a pair's gaps sweep slowly. A melody that needs every class all the way through can't fit.
- **Tone-poor rows fit by pitch-class set.** 1512:280:840:864 is dense and tight, but 8 lanes are empty, so it plays only what its 6 tones spell.

### 3. Whole cycle or window

- **Where the best placements fell:** N = B (the clip over the whole cycle) in **65 of 108** cases, near (N ≤ 4B) in 42, and a true window in **1**.
- **That one window case is your scenario, and it lands on a time-clustered row.** On 2047:2048, the chromatic run fits all 13 notes at N = 27 (one bar out of 27), against 12 over the whole cycle. The window is where all 12 classes happen to sound together.
- **The cost of a window is tempo.** At the preset's 8 s cycle that's 810 BPM. Playing it at the clip's own tempo needs a 64.8 s cycle.
- **Why windows rarely win:** density per slot falls as 1/P. A window only wins where lanes are locally richer than average, which is exactly the clustered-lane rows.

### 4. The frame must be centred on the lattice, not the root

- **The engine's frame is root-centred.** Rooting it on the clip's tonic loses notes whenever the tonic tone sits off the lattice.
- **How often:** in 36 of 108 cases, a total of 71 notes, up to 5 in one placement. Greensleeves on 504:234:520:297 goes 19 → 14 with its root 5.8¢ off; Ode to Joy on 119:42:15:8 goes 9 → 5 at 13.7¢ off.
- **Centred on the lattice tone,** the engine matches the search every time.

This is the entanglement you described, made concrete. The fix belongs in Compose: a frame centre separate from the root (Proposals, 2).

### 5. Tempo comes with the placement

Once N is found, the slot length is fixed: cycle ÷ P.
- **At the preset cycles the tempos are often silly.** The chromatic run on the 16k row (one bar over 16 s) plays at 15 BPM, and Greensleeves on 2047:2048 at 360 BPM.
- **The report gives the cycle that plays the clip at its own tempo.** Typically that's 5–30 s, so targeting has to set the Playback cycle as well.

### 6. Grid decode

- **Quantized clips decode exactly,** including the 3/4 pickup (Greensleeves, pickup 4 of 6 steps), the triplet grid (shuffle, d = 3, S = 12) and sixteenths (d = 4).
- **The skyline handles polyphony.** Twinkle over block triads in the same track decodes identically to bare Twinkle.
- **Light humanizing decodes cleanly.** A humanized Ode (note-ons ±0.04 quarter, notes at 85%) gives the same grid and note-ons. Its note-offs differ, correctly: the notes really are shorter.
- **Bug found and fixed:** the onset tolerance was absolute (0.05 quarter), so a fine enough grid "explained" anything; the unquantized Ode decoded as 48ths. The tolerance is now also relative: within 15% of the step.
- **Unquantized clips now get a guess.** The coarsest grid with every note within 30% of a step; the unquantized Ode gets eighths, correctly, and is flagged as a guess.
- **Real performances need beat tracking.** Scope v1 to quantized clips.
- **The key estimate is weak on short tunes.** Krumhansl correlation calls Ode to Joy F# minor, not D major. Matching doesn't depend on it; only the root's name does. Let the user set the tonic (or read it from the progression).

### 7. Cost

All times are one search in Node, without the controls.

| rows | per clip |
|---|---|
| under 200 onsets | 1–170 ms |
| 600–1,500 onsets | 0.3–1.2 s |
| 2,800–5,400 onsets | 0.7–4.4 s |
| 16k onsets | 4.4–9.7 s |

Voting dominates. The search is not pruned yet. It tries 12 lattices and every N from B to 64, then grows N by ×1.15 up to 256 bars or two slots per onset.

## Proposals

1. **Build it.** The method is sound: the vote is exact (28/28), and the engine agrees (108/108).
2. **A frame centre separate from the root in Compose,** or a root restricted to the lattice tone's class. Without it, a third of placements lose notes in Compose. This is the one engine change the probe says is needed.
3. **A per-note `until` slot in `articulate()`,** so MIDI note-offs survive. (Not measured here; from the design.)
4. **Prefilter with the density estimate.** It's cheap (no search) and gives "this row can play about x% of this clip" before the work. Use it to steer the user toward rows that can.
5. **Prune for the UI:**
   - stop at the first exact fit at the smallest N;
   - try lattices best first, with an early exit;
   - search a coarse grid of N first.

   The 16k row should then come in well under a second. Run it in the compose worker.
6. **Report the fit honestly:**
   - hits, tight hits, and misses classed as fringe (the class sounds, outside the frame), shift (one slot over) or hard;
   - the tempo, and the cycle the placement needs.

   On rows under ~1k onsets most placements are partial. A partial reading could fill its misses from the miner's own candidates, or with fringe tones.
7. **Time-clustered rows are where windows matter.** Offer windows there, and say what they cost in cycle length.

## Open questions for Avery

1. **A window placement:** what plays in the other N − B bars? Mined parts (the clip quoted inside a composition), or rests? Or should the cycle be cropped to the window?
2. **Partial fits:** show the best partial reading with its misses marked, or refuse below some share?
3. **The tempo/cycle coupling:** may targeting set the Playback cycle, or should it only report it?
4. **Pitch-class-set fit on tone-poor rows:** worth exposing (e.g. "this row plays these 4 classes")? Or is "use a richer row" the answer?
