# Dense-region freeze investigation — 2026-09-05

User reproduction: manually solve grid 971,800, settle/modulate, then experience chord-change and speed-control stalls and crowded playback at the minimum SPEED setting. Reported tab CPU: 400–600% in high grids, 200–300% in low grids.

## Changes

- Root proposals are now scored by a dedicated worker. The animation frame gathers only weights and `{f,c}` tone data; it no longer calls `solveRoots` or incumbent scoring synchronously. One request may be outstanding. Results are rejected after a geography epoch, harmony frame, fundamental policy, or root change, or flight teardown/re-entry. Stale results allow a fresh solve; errors retain the existing root and retry on the usual cadence. Teardown terminates the worker.
- Row playback now seeks over overdue ranges with binary cursor/seed-table searches. It skips only events the existing lateness policy would drop, preserving subsequent attacks, repeat memory, and loop-wrap clearing. Literal-fundamental muting is respected. Programs without tables retain the original path. Telemetry retains the exact dropped-event count and samples the worst lateness once per skipped range.

No tone-selection, field-size, SPEED, or voice-budget settings changed. Pre-existing uncommitted changes in `cosmos-audio.js` were preserved.

## Evidence and limits

A synthetic field with 20 stars × 1,200 tones and seven target degrees took about 1.1 seconds to score synchronously on this machine. This is a scaling reproduction, **not a capture of the user's running grid 971,800**. The lookahead is 250 ms, so this work can directly exhaust scheduled audio. Moving it off-thread removes that main-thread scoring cost; it does not reduce its total computation.

The recovery stress case skipped 1,252,171 expired events: approximately 33–38 ms for the old loop versus 0.01 ms for the seek. The 241 parity cases compare emitted attacks/times/gaps, final repeat memory, cursor, and dropped-event counts across rates, wraps, stalls, both repeat settings, and both literal-fundamental settings. Actual worker-handler success/error round trips and root proposal parity also pass.

All 22 `cosmos/cosmos/assert-*.mjs` scripts were run: 21 pass. `assert-transport-clock.mjs` has the same three source-pattern failures against both the working tree and HEAD (pose-only frame, rotation membership, chord-clock placement), already documented in the August handoff. Syntax and diff whitespace checks pass.

The existing Chrome session was not available through browser-tab tooling, so neither live audio nor tab CPU has been re-profiled. Hard reload port 8001 before listening: the existing page continues to use its loaded modules.

## User listening confirmation

After loading the changes, Avery reported substantially better navigation and fewer freezes while ten Node workers were running a heavy bake. One modulation still caused a blockage. This confirms a practical improvement under load, while leaving the remaining modulation stall open; no post-change CPU measurement was supplied.

## Remaining targets

- SPEED derives row ticks/s from the **median** per-program onset gap, across up to 20 stars. It is not an aggregate audible-note ceiling. Several dense programs and multiple layer attacks per event can exceed the knob's displayed notes/s by a wide margin. Changing this requires an explicit musical decision about aggregate pacing.
- High quality permits six concurrent number-theory solves, in addition to two audio compile workers. CPU percentages across multiple cores do not isolate the main thread. Profile thread activity after the queue settles before attributing sustained CPU to rendering or audio.
- Chord changes still compile per-star programs and structured-clone event objects. The previous interning and schedule-table work removed substantial costs, but transferable event buffers remain a possible next step if result delivery dominates a dense-field trace.
- The card's 16,384-onset build cap and repeated-tone draw suppression are not millisecond budgets: an eligible card still builds its model synchronously and a plot with many alternating tones can still require many canvas operations. Measure click/model/plot phases; worker-backed card construction and pixel-level plot aggregation are separate follow-ups.
