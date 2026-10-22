# Composer sprint ledger (overnight, 2026-10-22 → 23)

The planner keeps this file current after every phase. If the planner thread is lost, a standby thread resumes from here.

## Ground rules (Avery, 2026-10-22)

- Integration branch: `composer-sprint`, cut from `composer-prototype` (0942ede). Worktree: `.claude/worktrees/composer-sprint`.
- Each phase commits on its own branch (`sprint/<phase>`, own worktree under `.claude/worktrees/sprint-<phase>`). The planner merges it into `composer-sprint` after review. Never commit to `main`, never push.
- Workers are background agents on Opus (`model: "opus"`, always).
- Verification is the Node suites only. Avery does the browser and listening passes in the morning; every phase leaves a what-to-listen-for list.
- Modular separation: pure ES modules in `Composer/core/` (no DOM, fetch or clock), tests as plain Node scripts in `Composer/tests/`.
- Suite command (from the worktree root): `for t in Composer/tests/assert-*.mjs Cosmos/tests/assert-*.mjs Audio/tests/assert-*.mjs Playback/MIDIOut.test.mjs; do node "$t" >/dev/null 2>&1 || echo FAIL $t; done` — clean prints nothing; 44 suites at 0942ede.

## Decisions for this sprint (Avery, 2026-10-22)

- **Drums, single level.** Default backbeat: kick on downbeats, snare on backbeats of a 4-partition of the Slots meter. Extra percussion layers as claves derived from (or against) the lead/comping onsets. Grid-mode-style single-level Euclidean partitions anchored on the composition's own downbeat (the phase), not the cycle downbeat; a Partitions pattern is chosen from the layer tied to the downbeat node. A few curated patterns, chunk-tunes style. Pattern per section.
- **Deferred to the next sprint:** the two-level prime partition (level 1 = a prime from double to low triple digits over the cycle; level 2 = slots × bars partitions the lit level-1 lights, irrespective of their uneven spacing); swapping parts per voice; animating Compose; the Cosmos composition mode.
- **Targeted progressions:** per section, the user picks a chord root from the row's own tones (shown as ratios). The solver picks chord quality and mines the lead and other parts under it, skipping the lead-first pass. Every note stays a real onset.
- **Main page:** a Composer tab beside the Partitions tab, in the same tab strip. The upper-right linear plot stays visible and shows the Composer's selections live. Partitions stays on the site unchanged.

## Phases

| Phase | Branch | Depends on | Status |
| --- | --- | --- | --- |
| A. Drums (core + lab) | `sprint/drums` | none | MERGED (b8c2617..e9e8305, merge d9f2f85); 46/0 suites |
| B. Targeted progressions (core + lab) | `sprint/progression` | none | MERGED (0d4c15c..fa6d814); 45/0 suites |
| S. Cosmos seam survey + superrow probe (read-only) | none; report saved to the git-ignored `Cosmos/docs/composition-survey-2026-10-22/REPORT.md` | none | DONE |
| E1. Cosmos Compose mode: Rhythm card + Grid card superrow, bed silenced, clock takeover/hand-back, LOD exit; new `Composer/core/superrow.js` | `sprint/cosmos-compose` | S (seam map, window definition) | MERGED (628ba99..82896ca, merge 18bfb41); 53/0 |
| C. Composer tab on the main page | `sprint/integration` | A+B merged | MERGED (81cf5ff..93c04d9, merge d4feda7); 51/0 suites |
| T. Compose trace: an opt-in, pure observer in `Composer/core`; output unchanged when it's off | `sprint/trace` | A+B merged | MERGED (bc812ae..e964c66, merge e99cbcc); 47/0 suites |
| E2. Cosmos onset dust + choreography from the trace | `sprint/cosmos-dust` | T, E1 | MERGED (ea94c94..5e1cb42, merge a3ea023); 55/0 |
| M. Compose animation on the main page, from the trace (stretch) | `sprint/animate` | C, T | MERGED (fd884f2..081c2e1, merge fdbb9ea); 54/0 |
| D. Merge everything, final suites, morning listen list | `composer-sprint` | all | DONE (below) |

Parallel lanes: E1 runs beside A/B (it touches only Cosmos files and a new core module). C runs beside T (main-page files vs. `Composer/core`). The trace waits for A+B because all three would edit `compose.js`. Stretch, if time allows: animate the main-page Compose from the trace.

## Next sprint: Cosmos composition mode (Avery, 2026-10-22)

- **A shared compose trace first:** `compose()` emits a pure, untimed decision trace (roots picked and rejected, lead candidates, chord passes, settle rounds, drums). The main-page Compose animation and the Cosmos dust animation both render it.
- **Clock takeover:** Cosmos's clock follows the speed knob, which targets onset density, not a tempo. A composition takes over the clock at its own tempo and hands it back to flight when it ends.
- **The bed is silenced completely.** The player keeps flying; the composition stops when the grid drops out of LOD range. Idea: expand the black orb that masks the cosmos for a selected grid into a blank canvas for the animation.
- **Compose on a Rhythm card:** that one rhythm only. Others may be hidden, and only its sequence animates.
- **Compose on a Grid card:** a superrow of the selected nodes, up to a threshold. Huge grids use limited-cardinality windows rather than a refusal.
- **Drums:** the Composer drums, copied as-is for v1.
- **Proposed order:** probe → trace → superrow builder (pure, `Composer/core`) + Cosmos adapter → Compose mode (audio, clock, LOD exit) → onset dust on the WebGL layer, capped by quality tier → choreography from the trace.

## Log

- 2026-10-22 night: sprint branch and phase worktrees created; A and B dispatched in parallel.
- 2026-10-22 night: Cosmos plan recorded; read-only survey + superrow probe dispatched (writes only to the planner's scratchpad).
- 2026-10-22 night: Avery asked for the Cosmos build to start tonight too; plan widened to E1/T/E2 (table above).
- Phase B merged. Open for Avery: should the lead vote on qualities in round 0 (more faithful, loses the 2× speed) or should that be a switch? Also the fallback names, and per-bar presence in the menus.
- Phase A merged (additive conflicts in compose() options, lab readouts/render, controller header, lab tests); 46/0 suites. Open for Avery (drums): beat order on odd S (Partitions' order, or the long beat first); hats every slot or on beats only; should the bass vote in with/against; fills only on phrases of 4+ bars. Note: anchors are grid ticks, so strokes snap to the nearest onset in a swing-0.5 window.
- C and T dispatched in parallel. C must not edit Composer/core; T edits only core, tests and docs.
- Survey done. Key facts: `cosmos-audio.js` is the one clock authority, with no suspend API; MIDI out sits behind no gain; superrow common grid = G < 2^24, so the 2^53 gate never fails; most cube grids pass whole; proposed budget Θ = 65,536 nodes as a tier key. E1 dispatched with the planner's proposed defaults (see its brief in the report when it lands). C was asked to give the player an optional `destination`, with injectable timers, for Cosmos reuse.
- Merge notes: E1 may add ≤ 5 lines to `compose.js` (a prebuilt-row entry), which conflicts with T, and imports `Composer/lab/lab-player.js` from one adapter. Re-point that import after C merges.
- T merged cleanly; 47/0. The trace costs +0.1–0.7 % time and ~100 KB on the 16k row; `Composer/TRACE.md` is the contract. Open for Avery: a best-per-root chord candidate list vs. the top 6 overall.
- C merged (docs conflicts only); 51/0. The lab controller/player now live in `Composer/perform/` (lab files re-export them). The player has an optional `destination`, injectable timers and a public `tick()`, for Cosmos.
- Morning flag (live site, pre-existing on main): `LRCModule.calculateTotalLCM(...activeLayers)` returns NaN with fewer than 4 layers (`lcm(x, undefined)`), seen in Node only. Not fixed.
- C's open calls for Avery: keep playing across tabs; the wash and part colours; lit nodes on other plot types; the audio path (own context vs. the page master/effects/MIDI); auto-compose on open.
- M dispatched (main-page Compose animation from the trace). It must not edit `Composer/core` or `Cosmos`.
- E1 merged. compose() keeps the prebuilt-row entry beside the trace's refusal wrapper. The planner re-pointed the Cosmos adapter to `Composer/perform/composer-player.js` with `destination` (the wrapContext proxy is removed; its test updated). E1's calls for Avery: T = 240·N/110 (exactly 110 BPM); seed fixed at 1; stop at evict − 1 cell after a 400 ms dwell; Esc order ride → composition → card → exit; summed strikes pin the comping velocity (a `log2` option is built); one node per (tick, tone)?; does a second press reseed?
- M merged (docs conflict only); 54/0. "Show the work" toggle, on by default; ~7.5 s; Skip/Esc/click skip. Open: any click in the tab skips (too eager?); only the Compose button animates.
- E2 dispatched (the last build phase). After it: D (final merge, suites, morning list).
- E2 merged cleanly; 55/0 suites; every changed JS file passes `node --check`. Sprint complete: 45 commits on composer-sprint past composer-prototype, 60 files, +9,026/−512.

## Morning handoff (for Avery)

**State:** everything is on `composer-sprint` (worktree `.claude/worktrees/composer-sprint`). Nothing is on `main`, nothing is pushed. Verified in Node only (55 suites); no browser has seen any of it.

**Serve:** from the composer-sprint worktree root, `python3 -m http.server 8000`, then open `http://localhost:8000/` (main page and Cosmos) or `/Composer/lab/composer-lab.html` (the lab).

### 1. Lab (drums + targeted progressions)
- 41:42:43, default: a steady kick/snare backbeat, hats every slot, slightly row-humanized (each stroke on a real onset). Bar 4 fills; a crash when it loops.
- Same row, Drums mode `partition`: an uneven perc line from layer 43 (E(32, 43)), starting on the downbeat. It should be the most distinctive mode.
- 119:42:15:8: `son` and `rumba` (claves alternating 3 then 2 across bars). Compare `with` and `against`; change the Seed and `against` reshuffles.
- Live: change the mode or kit while playing (it lands within about 150 ms, with no re-compose); Tempo keeps the drums locked; pick `snare1.wav`.
- Progression:
  - Compose → "take from last compose" → Compose again: the same roots, some qualities change, and the lead follows the chords.
  - Set bar 1 to 21/11: a ↻ retune, and every part shifts together.
  - 8:7:6:5 with bar 2 = 15/8: an amber fallback (root alone).
  - 16k row with all 8 bars pinned: noticeably faster.

### 2. Main page: the Composer tab and its animation
- Generate 8:7:6:5 → double-click the Playback header → the title bar reads **Partitions | Composer** (Partitions unchanged) → Composer.
- Compose with "show the work" on: a shimmer, then about 7.5 s:
  - root candidates pulse, and the winner turns green;
  - bar lines sweep in, and the downbeat bursts;
  - lead runners-up fade as the white line draws in;
  - chord names flick through per bar;
  - amber settle flashes;
  - the parts cascade in, and the drums drop in.

  It should land exactly on the lit view, with no jump. Skip, Esc or a click jumps to the end.
- Perform: main playback stops, a playhead sweeps the plot, and the sounding nodes glow. Starting main playback stops the Composer.
- Drums lane → the inspector shows mode and kit. Chords → Harmony → a root on bar 1.
- Rhythm change while performing: generate 41:42:43:**1**. Leaving layer D blank hits the NaN bug below. Expected: playback stops and the button returns to Compose.
- Large row 4099:4093:4091:4079 with a 16 s cycle: about 2 s to compose, then a smooth Perform. Watch the frame rate and memory.
- 7:1:1:1 is refused with "Too few tones". Closing the window while performing goes silent and restores the plot.
- The lab still works exactly as before.

### 3. Cosmos: Compose mode + onset dust
- **Rhythm card** (a node in a small grid like 840) → COMPOSE:
  - the bed, rows and audition go silent;
  - the orb swells slightly while composing;
  - the dust streams out of the node and the screen goes black;
  - the selection plays in about 3 s;
  - then a clock face plays: a hand at the playhead, and each note flashes **in sync with what you hear** (check this);
  - SPEED dims to "110 BPM".

  Also try a rhythm too big for Listen: Compose should still work.
- **Grid card** (7,920 whole; 27,720 for a windowed superrow): GATHERING… → COMPOSING… → STOP. The card shows "1,197 of 24,615 rhythms · 110 BPM". The dust streams from many nodes into one pool.
- **Exit by flying away:**
  - the veil, dust and music thin over the last 2 cells and stop about a cell before the grid would vanish;
  - the bed swells back over 1.5 s with NO burst of notes and no chord jump;
  - SPEED returns;
  - stars, Web, constellations, clouds and clicking all come back.
- **Exit by Esc:** skip → stop composition → close card → leave Cosmos. Folding the card, collapsing the bloom or changing the tier also stops it, with the same restore.
- **Perf:** frame time at a full veil (the hidden layers are skipped, so it should beat normal flight), on Ultra, and on Low (1,500 motes at 30 fps).

### 4. Calls waiting on you (all marked "proposed" in DESIGN_NOTES)
- **Progressions:** should the lead vote on qualities in round 0 (more faithful, loses the 2× speed), or should that be a switch? What should fallback chords be called? Show per-bar presence in the root menus?
- **Drums:** on odd S, Partitions' beat order or the long beat first? Hats every slot or on beats only? Should the bass vote in with/against? Fills only on phrases of 4+ bars?
- **Trace:** chord candidates as the top 6 overall, or the best per root?
- **Tab:**
  - keep playing across tabs?
  - the dark wash and the part colours;
  - lit nodes on other plot types?
  - audio path: its own AudioContext (as built), or the page master/effects/MIDI?
  - auto-compose for small rows?
  - should any click in the tab skip the animation?
- **Cosmos:**
  - should the seed stay fixed or reseed on a second press?
  - the stop radius;
  - one node per (tick, tone)?
  - summed strikes pin the comping velocity (`log2` is built);
  - a full veil means flying blind until the fade, so hold it at about 0.85?
  - the clock-face form and parallax;
  - what a click should do under a full veil;
  - audio starts at once with a 3 s selection (about 30 ms per root candidate). Hold the audio for a longer show?
- **Live-site bug (already on main, not fixed):** `LRCModule.calculateTotalLCM(...activeLayers)` returns NaN with fewer than 4 layers (`lcm(x, undefined)`). Seen in Node; confirm it in the browser.
- **Deploy:** `Composer/` isn't on main, so Cosmos Compose can't go live until composer-sprint merges. Path: composer-prototype → composer-sprint → main.

### 5. Housekeeping
The merged sprint worktrees can be pruned once you've reviewed: sprint-drums, sprint-progression, sprint-integration, sprint-trace, sprint-cosmos-compose, sprint-animate, sprint-cosmos-dust. The older ones too: composer-settle, composer-probe, feat-shared-voices, cool-agnesi, shared-voices-1a/1b. The git-ignored Cosmos work notes and the survey are in `Cosmos/docs/` in the composer-sprint worktree.
