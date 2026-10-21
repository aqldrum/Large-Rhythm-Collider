# Composer cost probe: findings (2026-10-21)

What chunk-tunes' row building and line mining cost on **one** LRC rhythm's tone row, measured so that the Composer's onset gate comes from data. Everything under "Recommendations" is a **proposal**; nothing here is ruled.

- Probe: `Composer/probe/probe.mjs` (run `node --expose-gc probe.mjs`). Raw results: `Composer/probe/results-2026-10-21.json`.
- Code measured: the Overworld modules, read-only, by absolute path (`Overworld/econ/runtime/chunk-super-row.js`, `chunk-lines.js`, and `settle-location.js` for the rhythm kernel). Nothing was ported or changed.
- Machine: Apple M4 Max, 14 cores, 36 GB, macOS 24.6, Node 24.12. A browser on this machine should be in the same range; slower machines will scale the times up.

## Method

Every case runs in its own child process, inside a worker thread with a 1 GB stack and a 28 GB heap. The large stack keeps the kernel's `Math.max(...gaps)` from crashing past ~124k onsets (see "Hard limits"), so the costs beyond that point could still be measured. The child's main thread samples RSS every 10 ms, and it stops the worker when a stage overruns its budget (3 to 5 minutes). Any later stage is then skipped. No stage hit its budget. A stage is timed as the median of up to 5 runs when one run takes under 400 ms; otherwise it is timed once.

Stages:

| stage | what it runs |
|---|---|
| build | `buildNormalizedRow([{ layers }])`, with the kernel (`buildRhythmTimingKernel`) also timed on its own |
| slots P8 | `slotCandidates(row, { P: 8 })` at the default swing of 0.18, which sizes the window as a share of the slot. P 16 and 32 are in the JSON. |
| frame | `bestFrames(row, 25)[0]`, the row's own frame |
| plan | `planLines`, mostly `downbeats`, which sorts every moment of the row |
| rooted mine | the whole table with no harmony: `partitions: 8` (cell 1×8; lead 2×8 and 4×8, each under 3 motions; arp 2×8 and 4×8), 6 phases, the default line types and bands. This is 54 pieces and 648 picker runs. **This is the "Compose" proxy.** |
| lean mine | the rooted table cut down to 2 phases, with the lead under `stepwise` only. This is 10 pieces and 96 runs. |
| harmony mine | the same as the rooted table, over C G Am F in the row's own frame at transposition 0. The harmony solver is not run. |
| default mine | chunk-tunes' default table (each type's own meters), 6 phases, no harmony |

`buildLattice` (2×8 and 4×8) and a single `pickLines` run are timed in the JSON too. Neither ever exceeded 7 ms.

**Compose** = build + frame + rooted mine. **Compose lean** = build + frame + lean mine.

### How the layer sets were chosen

Three facts about one rhythm decide which layer sets are worth testing:

- Its onsets are at most its layer sum.
- Its grid is the LCM of its layers.
- Every gap is at most grid / (largest layer). A tone is fixed by the odd part of its gap, so distinct tones are at most about maxGap / 2.

Together these give **onsets × tones ≲ 2 × grid**. Under `MAX_GRID = 2^25`, onsets and tones cannot both be large. So each family below pushes one of them:

| family | layer sets | what it varies |
|---|---|---|
| **coprime** | 8:7:6:5, 17:19:23:29, 61:67:71:73, consecutive triples | LRC-typical rhythms: few onsets, and a grid that grows fast. Two of these sets are past MAX_GRID on purpose. |
| **pair** | [a, a+1] | The most tones a given onset count can have (about a/2). This is the tone sweep, up to 5792:5793, the largest pair under MAX_GRID. |
| **scaled** | [g·a, g·(a+1)], and [g·a, g·(a+1), g·(a+2)] | The same pattern repeated g times: tones stay fixed and onsets grow ×g. This is the onset sweep at 24, 128, 41 and 15 tones, each run up to the largest g under MAX_GRID. |
| **tones16k** | 16,384 onsets | The placeholder gate, at 4 to 1,023 tones |
| **dense** | layers L/p for pairwise-coprime p, with L = Πp | Onsets close to the grid, but tones ≤ min p. These are the cases from ~20k to 24.6M onsets. |

## Results

Times are in ms. "tones" is the row's tone count as the Overworld (and LRC's own `decimalToFraction`) spells it, with fractions approximated to denominators ≤ 1000. When the exact count differs, it is in brackets. "cands/slot" is the picker's candidates per slot across every lattice of the rooted table. "slowest piece" is the costliest single piece of that table. "spread ok" says whether `Math.max(...gaps)` survives at that onset count on a default ~1 MB stack.

| case | grid | onsets | tones | build | slots P8 | frame | plan | cands/slot mean (max) | rooted mine | slowest piece | lean mine | harmony mine | default mine | **Compose** | **Compose lean** | peak RSS MB | spread ok on 1 MB stack |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|:-:|
| 8:7:6:5 | 840 | 22 | 7 | 0.1 | 0.0 | 0.0 | 0.1 | 1.7 (7) | 23 | 1.3 | 5.4 | 11 | 39 | **23** | **5.5** | 177 | yes |
| 17:19:23:29 | 215,441 | 85 | 24 | 0.1 | 0.0 | 0.1 | 0.1 | 5.7 (18) | 111 | 8.7 | 22 | 37 | 151 | **112** | **23** | 214 | yes |
| 41:42:43 | 74,046 | 124 | 41 | 0.2 | 0.0 | 0.1 | 0.5 | 8.2 (24) | 495 | 18 | 47 | 212 | 568 | **495** | **47** | 278 | yes |
| 61:67:71:73 | 21,182,921 | 269 | 72 | 0.5 | 0.1 | 0.2 | 0.6 | 14.4 (22) | 1,375 | 80 | 113 | 491 | 1,207 | **1,376** | **114** | 193 | yes |
| 201:202:203 | 8,242,206 | 604 | 200 (201) | 0.8 | 0.1 | 0.8 | 0.6 | 18.6 (24) | 1,279 | 70 | 128 | 618 | 871 | **1,281** | **130** | 275 | yes |
| 321:322:323 | 33,385,926 | 964 | 320 (321) | 1.0 | 0.1 | 1.9 | 0.7 | 19.4 (24) | 1,204 | 71 | 106 | 533 | 893 | **1,207** | **109** | 303 | yes |
| 83:89:97:101 (past MAX_GRID) | 72,370,439 | 367 | — | **MAX_GRID** |||||||||||| 69 | |
| 100:101:102:103 (past MAX_GRID) | 53,055,300 | 402 | — | **MAX_GRID** |||||||||||| 69 | |
| 32:33 | 1,056 | 64 | 16 | 0.1 | 0.0 | 0.0 | 0.1 | 4.6 (14) | 141 | 5.9 | 14 | 43 | 208 | **141** | **14** | 256 | yes |
| 128:129 | 16,512 | 256 | 64 | 0.3 | 0.1 | 0.1 | 0.5 | 14.9 (24) | 818 | 36 | 83 | 384 | 1,073 | **818** | **83** | 296 | yes |
| 512:513 | 262,656 | 1,024 | 256 | 0.9 | 0.2 | 1.3 | 0.7 | 19.7 (26) | 1,142 | 62 | 102 | 613 | 770 | **1,144** | **105** | 305 | yes |
| 2048:2049 | 4,196,352 | 4,096 | 1023 (1024) | 4.0 | 0.3 | 18 | 1.1 | 19.6 (26) | 1,599 | 88 | 142 | 564 | 1,370 | **1,621** | **163** | 322 | yes |
| 5792:5793 (largest pair under MAX_GRID) | 33,553,056 | 11,584 | 2892 (2896) | 14 | 0.6 | 132 | 2.2 | 19.9 (26) | 2,015 | 107 | 178 | 532 | 1,490 | **2,161** | **324** | 392 | yes |
| 5793:5794 (past MAX_GRID) | 33,564,642 | 11,586 | — | **MAX_GRID** |||||||||||| 89 | |
| 48:49 ×16 | 37,632 | 1,536 | 24 | 1.1 | 0.1 | 0.1 | 1.0 | 15.3 (23) | 2,373 | 233 | 140 | 509 | 884 | **2,374** | **141** | 255 | yes |
| 48:49 ×64 | 150,528 | 6,144 | 24 | 2.6 | 0.1 | 0.1 | 1.5 | 12.4 (21) | 1,322 | 160 | 61 | 465 | 503 | **1,325** | **64** | 291 | yes |
| 48:49 ×256 | 602,112 | 24,576 | 24 | 9.8 | 0.3 | 0.1 | 2.8 | 7.1 (9) | 249 | 12 | 25 | 750 | 638 | **259** | **35** | 347 | yes |
| 48:49 ×1024 | 2,408,448 | 98,304 | 24 | 38 | 0.8 | 0.1 | 12 | 9.0 (9) | 689 | 37 | 72 | 715 | 721 | **726** | **109** | 519 | yes |
| 48:49 ×4096 | 9,633,792 | 393,216 | 24 | 153 | 2.1 | 0.2 | 42 | 8.3 (9) | 683 | 43 | 94 | 737 | 715 | **837** | **247** | 791 | no |
| 48:49 ×14266 | 33,553,632 | 1,369,536 | 24 | 700 | 7.5 | 0.8 | 142 | 15.9 (34) | 1,492 | 61 | 229 | 695 | 1,611 | **2,192** | **929** | 1,038 | no |
| 256:257 ×4 | 263,168 | 2,048 | 128 | 1.2 | 0.1 | 0.4 | 0.8 | 18.8 (24) | 1,174 | 67 | 124 | 610 | 684 | **1,175** | **126** | 282 | yes |
| 256:257 ×16 | 1,052,672 | 8,192 | 128 | 3.5 | 0.2 | 0.4 | 1.8 | 15.3 (22) | 2,062 | 174 | 105 | 970 | 625 | **2,066** | **109** | 284 | yes |
| 256:257 ×64 | 4,210,688 | 32,768 | 128 | 14 | 0.4 | 0.4 | 4.2 | 12.5 (22) | 1,464 | 112 | 103 | 822 | 472 | **1,478** | **117** | 340 | yes |
| 256:257 ×128 | 8,421,376 | 65,536 | 128 | 26 | 1.0 | 0.5 | 7.5 | 8.3 (12) | 930 | 72 | 67 | 549 | 520 | **957** | **94** | 466 | yes |
| 256:257 ×510 | 33,553,920 | 261,120 | 128 | 113 | 1.9 | 0.6 | 25 | 17.7 (25) | 1,364 | 63 | 131 | 870 | 1,101 | **1,478** | **244** | 757 | no |
| 41:42:43 ×64 | 4,738,944 | 7,936 | 41 | 3.8 | 0.1 | 0.1 | 1.9 | 16.5 (22) | 3,204 | 242 | 184 | 1,153 | 1,622 | **3,208** | **188** | 322 | yes |
| 41:42:43 ×453 | 33,542,838 | 56,172 | 41 | 27 | 0.6 | 0.1 | 7.3 | 17.1 (24) | 2,219 | 120 | 215 | 1,092 | 1,572 | **2,246** | **242** | 443 | yes |
| 15:16:17 ×1024 | 4,177,920 | 47,104 | 15 | 25 | 0.5 | 0.1 | 5.6 | 5.0 (5) | 219 | 12 | 24 | 102 | 889 | **243** | **49** | 454 | yes |
| 15:16:17 ×8224 | 33,553,920 | 378,304 | 15 | 185 | 2.4 | 0.2 | 45 | 5.6 (7) | 269 | 13 | 61 | 155 | 1,155 | **455** | **246** | 864 | no |
| 8:9 ×1024 | 73,728 | 16,384 | 4 | 12 | 0.2 | 0.1 | 3.4 | 6.3 (7) | 434 | 19 | 41 | 176 | 340 | **446** | **54** | 388 | yes |
| 32:33 ×256 | 270,336 | 16,384 | 16 | 7.4 | 0.2 | 0.1 | 3.0 | 8.6 (10) | 847 | 44 | 82 | 872 | 698 | **855** | **89** | 309 | yes |
| 128:129 ×64 | 1,056,768 | 16,384 | 64 | 6.9 | 0.2 | 0.1 | 2.6 | 12.3 (22) | 1,227 | 136 | 82 | 854 | 501 | **1,234** | **90** | 348 | yes |
| 512:513 ×16 | 4,202,496 | 16,384 | 256 | 7.7 | 0.4 | 1.3 | 2.6 | 15.9 (24) | 2,201 | 162 | 138 | 991 | 991 | **2,210** | **147** | 364 | yes |
| 2048:2049 ×4 | 16,785,408 | 16,384 | 1023 (1024) | 14 | 0.3 | 18 | 2.6 | 17.3 (26) | 2,412 | 133 | 212 | 565 | 2,174 | **2,444** | **244** | 352 | yes |
| L/p, p=16·27·25·7 | 75,600 | 19,440 | 4 | 9.4 | 0.3 | 0.1 | 4.6 | 6.6 (7) | 534 | 27 | 46 | 371 | 363 | **543** | **55** | 394 | yes |
| L/p, p=32·27·25·49 | 1,058,400 | 129,888 | 13 | 48 | 1.8 | 0.1 | 20 | 9.2 (13) | 831 | 54 | 89 | 441 | 639 | **879** | **137** | 488 | no |
| L/p, p=64·81·25·49 | 6,350,400 | 544,320 | 13 | 266 | 5.0 | 0.4 | 65 | 11.8 (16) | 1,125 | 70 | 150 | 724 | 803 | **1,392** | **417** | 865 | no |
| L/p, p=64·81·125·49 | 31,752,000 | 1,753,920 | 25 | 906 | 12 | 1.0 | 175 | 15.2 (31) | 1,482 | 78 | 279 | 711 | 1,725 | **2,389** | **1,186** | 1,435 | no |
| L/p, p=2·3·5·10001 | 300,030 | 220,030 | 1 | 228 | 1.9 | 0.2 | 53 | 2.0 (2) | 132 | 3.8 | 59 | 122 | 187 | **361** | **287** | 752 | no |
| L/p, p=2·3·5·100001 | 3,000,030 | 2,200,030 | 1 | 2,638 | 13 | 1.1 | 536 | 2.0 (2) | 650 | 7.8 | 517 | 578 | 1,400 | **3,289** | **3,156** | 2,230 | no |
| L/p, p=2·3·5·1118479 (grid just under MAX_GRID) | 33,554,370 | 24,606,546 | — | **Map maximum size exceeded** |||||||||||| 2,034 | |

## What dominates, and how it scales

**The line picker (`pickLines`, inside `solveLinePiece`) dominates, and it does not grow with onsets.** Below about 100k onsets, mining is 85–99 % of Compose on every row tested. Past 100k it is still the largest single stage until the onset-linear stages catch up at about 1–2M onsets.

- **Cost.** The rooted table costs 0.1–3.2 s on every row with more than a handful of tones, at any size:
  - 1.4 s at 269 onsets (61:67:71:73)
  - 2.4 s at 1,536 onsets (48:49 ×16)
  - 3.2 s at 7,936 onsets (41:42:43 ×64), the worst case measured
  - 1.5 s at 1.75M onsets
- **Why it stays flat.** chunk-lines sizes a slot's window in onsets (about 12 moments), so a slot never offers more than about 12 tones × 1–2 registers.
  - Across every case, candidates per slot average 2–20 and peak at 26 (34 at 1.37M onsets, see the window quantization under "Surprises").
  - The picker is a dynamic program over slot × candidate × notes × flag, with a fixed set of runs (648 for the rooted table). Its time follows candidates per slot, not onsets and not the row's total tones.
- **Tones matter only through the window.**
  - Cost rises from about 0.1 s (1–4 tones) to 1–2 s once the row has about 60 or more tones. By then the 12-moment window is full of distinct tones, and cost stops rising: 256, 1,023 and 2,892 tones all cost 1.1–2.0 s.
  - Beyond that point, the variance (up to 10× between rows with the same tone count, e.g. 48:49 ×16 against ×256) comes from how varied the row is locally around the chosen downbeats.
- **Costs that do grow with onsets, all linear:**
  - build ≈ 0.4–0.5 µs/onset, and about 1.2 µs/onset when the layers overlap heavily (the 2·3·5 family: 3.1M layer hits for 2.2M onsets). About 70–85 % of the build is the kernel: the composite `Map`, the gaps, and `decimalToFraction` for each onset.
  - plan ≈ 0.1–0.25 µs/onset. This is `downbeats`, which sorts every moment once per (P, root) key, 3 keys here.
  - slotCandidates is negligible: at most 13 ms at 2.2M onsets.
  - These costs overtake mining only at about 1–2M onsets. At 2.2M onsets, build (2.6 s) + plan (0.5 s) already exceed the 2 s target before any picking.
- **Frame cost grows with distinct tones.** `bestFrames` is O(tones²): 18 ms at 1,023 tones and 132 ms at 2,892. Under MAX_GRID a rhythm has at most about 8k tones, so its worst case is roughly 1 s.
- **Memory.**
  - The retained row is about 80 B/onset: 176 MB at 2.2M onsets.
  - The transient peak while building is about 0.75–1 KB/onset: the kernel's `Map` of per-onset owner arrays plus one fraction string per onset. Peak RSS was 1.0 GB at 1.37M onsets, 1.4 GB at 1.75M and 2.2 GB at 2.2M.
  - Mining itself adds about 100–300 MB, whatever the row's size.
- **Other tables.**
  - Harmony mining is cheaper than rooted: 0.1–1.2 s. Foreign tones are pruned, and there are fewer runs.
  - chunk-tunes' default table costs about the same as `partitions: 8`: 0.04–2.2 s.
  - The lean table costs about a tenth: 5–280 ms of mining.

## Where the hard limits bite

| limit | where it bites | measured |
|---|---|---|
| **`MAX_GRID = 2^25`** (chunk-super-row `rhythmCycle`) | **First, and at tiny onset counts, for LRC-typical coprime rhythms.** The limits fall where these layer sets cross a grid of 2^25: 4 coprime layers at about 80 each (about 370 onsets), 3 consecutive layers past 321 (about 965 onsets), 2 coprime layers past 5,792 (11.6k onsets). | 83:89:97:101 (367 onsets), 100:101:102:103 (402) and 5793:5794 (11,586) all throw. Cost does not depend on the grid: 61:67:71:73 (grid 21M) builds in 0.5 ms. |
| **`Math.max(...spacesPlot)`** (settle-location `buildSpaceRatios`; the same line is in LRC's own `Core Interface/LRCModule.js` `generateRatiosWithFrequency`) | **Past about 124k onsets on a default ~1 MB stack** (a Node main thread; a browser main thread should be similar, but that was not measured), and past about 494k in a default Node worker (4 MB). This is a crash, not a slowdown. | Binary search: 124,429 arguments on the main thread and 494,265 in a default worker. The "spread ok" column turns to no from 129,888 onsets on. |
| **V8 `Map` size (2^24 entries)** (settle-location `buildCompositeRhythm`, one entry per onset) | **Past 16,777,216 onsets**, at any stack size: "Map maximum size exceeded". | The 24.6M-onset case fails after 2 GB of RSS. |
| **32-bit ticks** (`Uint32Array` tick, gap, num) | **Never under MAX_GRID**, since ticks < grid ≤ 2^25. It would bite at grid ≥ 2^32 if MAX_GRID were lifted. | No case comes near it. |
| **16-bit tone index** (`Uint16Array` tone) | **Never for one rhythm under MAX_GRID.** Tones ≤ min(onsets, maxGap/2), and onsets ≤ 4·maxLayer with maxGap ≤ grid/maxLayer, so tones ≲ √(2·grid) = **8,192 at most**. It would bite only past a grid of about 2^31. It matters for chunk-tunes' multi-rhythm super-rows, not for the Composer. It also fails silently: `Uint16Array.from` wraps, it does not throw. | The most tones measured is 2,892 (5792:5793). |
| `decimalToFraction` (denominators ≤ 1000) | It spells tones, it does not limit them, but it starts merging tones at about 1k tones. The tone counts still match what the LRC itself shows, since LRC uses the same function. | 1,023 against 1,024 exact (2048:2049); 2,892 against 2,896 (5792:5793) |
| lattice `swing` rounded to 1/10,000 (`SWING_DEN`) | The window stops being about 12 moments past roughly 0.6–1.3M onsets: rounding moves it both ways, then it floors at 1e-4 and grows linearly with onsets (about 2e-4·n/P moments). | 17–27.5 moments per window at 1.37M–2.2M onsets; 8.6 at 1.37M for 4×8; candidates per slot reach a maximum of 34 |

**On MAX_GRID for a one-rhythm row.** The constant exists so that positions from *different* grids compare exactly as doubles. A one-rhythm row has one denominator, so t/g is exact and in order up to 2^53. In the port, MAX_GRID could be replaced with a 2^32 limit on 32-bit ticks, or with Float64/BigInt ticks for trillion-tick grids. The kernel's LCM is computed in doubles and is exact only below 2^53. Lifting MAX_GRID is what makes ordinary coprime LRC rhythms composable at all.

## Recommendations (proposals)

1. **Main thread: do not run the full table there at any onset count.**
   - Rooted Compose already takes 2.0–3.2 s on tone-rich rows of 1.5k–16k onsets: 48:49 ×16, 41:42:43 ×64, 512:513 ×16, 2048:2049 ×4. No onset gate brings it under 2 s.
   - If something must run on the main thread, run the lean table (2 downbeats, stepwise lead) **up to 100,000 onsets**. There, Compose lean measured at most 0.32 s, and the onset-dependent part (build + frame + plan) at most 0.15 s.
   - 100k keeps a margin under the ~124k `Math.max(...)` crash. That margin is needed unless the port replaces the spread with a loop.
   - The full table is main-thread safe only up to about **1,000 onsets** (at most 1.4 s measured).
2. **Worker: gate at 1,048,576 onsets (2^20) for the full table on a single worker.**
   - Inside that gate:
     - Compose measured at most 3.2 s (the worst case is a 7.9k-onset row, so the time is set by mining variance, not by the gate)
     - build about 0.5 s at 1M onsets (0.7 s measured at 1.37M)
     - peak RSS about 1 GB (1.0 GB measured at 1.37M onsets)
   - Past it, build + plan alone pass 2 s at about 2M onsets, and peak RSS passes 2 GB, which is risky in a browser tab.
   - This gate assumes the port fixes `Math.max(...)`. With the Overworld kernel as it is, a default worker crashes at about 494k onsets in Node, and the browser's default-stack limit is unmeasured.
3. **A worker pool is the cheap way to the 2 s target for the full table.**
   - chunk-lines already splits the table into independent pieces (54 for the rooted table), and the slowest piece measured was 242 ms.
   - With 4 workers, mining should take about total/4, roughly 0.8 s at worst. With 8, about 0.4 s. This is projected, not measured.
4. **Replace the placeholder of 16,384 with the gates above.**
   - At 16,384 onsets the onset-dependent cost is at most 35 ms, and Compose ranges from 0.45 s to 2.4 s depending on tones alone.
   - The placeholder therefore protects against nothing the Composer pays for. The real costs are mining variance (independent of onsets) and memory past about 1M onsets.
5. **When porting, fix these:**
   - Lift MAX_GRID for one-rhythm rows (see above), or the Composer refuses most 4-layer coprime LRC rhythms.
   - Replace `Math.max(...spacesPlot)` with a loop. The same fix belongs in LRCModule.
   - Build the composite into typed arrays instead of a `Map` of arrays. That removes the 16.7M cap, most of the ~1 KB/onset transient memory, and most of the build time.
   - Memoise `decimalToFraction` per gap value: a row has far fewer distinct gaps than onsets.
   - Size the lattice window exactly instead of in 1/10,000 steps.
   - Cache `downbeats`' moment order once per row, not once per key.

## Surprises

- **Onsets barely matter. MAX_GRID is the gate in practice.** For typical LRC rhythms (coprime, 3–4 layers), the code refuses the row at a few hundred onsets, long before any cost appears. The design notes' guess, that a large row "should mostly add variety", is confirmed: per-line cost is bounded by the 12-moment window.
- **Mining cost is not monotone in anything simple.** Between rows with the same tones it can differ 10×. 48:49 ×16 (1,536 onsets) mines in 2.4 s, and 48:49 ×256 (24,576 onsets) in 0.25 s, because candidates per slot drop from 15.3 to 7.1. Local variety near the heaviest moments is what costs.
- **The kernel's spread `Math.max(...)` crashes at about 124k onsets on a default stack.** This is a latent bug in LRC's own `LRCModule.generateRatiosWithFrequency` too (same line, not tested in the browser). It is probably part of why the Cosmos card caps onsets.
- **A row with very few tones costs the least to mine but is the most expensive to build.** The 2·3·5 family has 1 tone and 2.2M onsets: 0.65 s of mining against 2.6 s of build, and 2.2 GB peak. It still yields 83 "lines" on one pitch. A minimum-tones gate (say, at least 5 tones in the frame) may matter more musically than an onset gate.
- **Under MAX_GRID a single rhythm cannot have more than about 8k tones.** The 16-bit tone index is therefore irrelevant to the Composer.
