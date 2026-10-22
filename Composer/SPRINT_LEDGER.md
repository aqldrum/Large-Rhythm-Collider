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

| Phase | Branch | Status |
| --- | --- | --- |
| A. Drums (core + lab) | `sprint/drums` | dispatched |
| B. Targeted progressions (core + lab) | `sprint/progression` | dispatched |
| C. Composer tab on the main page | `sprint/integration` (after A+B merge) | waiting |
| D. Final suites + morning listen list | `composer-sprint` | waiting |

## Log

- 2026-10-22 night: sprint branch and phase worktrees created; A and B dispatched in parallel.
