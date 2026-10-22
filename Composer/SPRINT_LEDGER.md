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
| E1. Cosmos Compose mode: Rhythm card + Grid card superrow, bed silenced, clock takeover/hand-back, LOD exit; new `Composer/core/superrow.js` | `sprint/cosmos-compose` | S (seam map, window definition) | dispatched (from 5c82db7) |
| C. Composer tab on the main page | `sprint/integration` | A+B merged | dispatched (from d9f2f85) |
| T. Compose trace: an opt-in, pure observer in `Composer/core`; output unchanged when it's off | `sprint/trace` | A+B merged | MERGED (bc812ae..e964c66, merge e99cbcc); 47/0 suites |
| E2. Cosmos onset dust + choreography from the trace | `sprint/cosmos-dust` | T, E1 | waiting |
| D. Merge everything, final suites, morning listen list | `composer-sprint` | all | waiting |

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
