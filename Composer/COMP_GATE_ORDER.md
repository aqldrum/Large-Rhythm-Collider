# The comp's gate, and Snap (order, 2026-11-03)

Thread 1 of `RELEASE_PLAN.md`. Avery: comped chords "sound very flammy" and make the rhythm sound sloppy, so either take
the comp back to single notes or use a stricter threshold.

The planner's finding is that the threshold exists but is measured in **slots**. Each tone of a "chord" plays at its own
onset's time, so the window decides how far apart a chord's notes may land, and it grows with the slot.

## The probe (2026-11-03; scratchpad `flam-probe.mjs`, seed 1, natural tempo)

A stroke's notes are grouped by their shared `holdTo`. The spread is the time from the first note to the last. The gate
columns keep only tones within *g* ms of the stroke's own onset. This is exact: `strumOf` takes each class's onset nearest
the stroke, and every slot window here is wider than 40 ms.

| row | BPM | slot | ±½ slot (today): tones/stroke · spread median/max | gate 15 / 25 / 40 ms: tones/stroke | Snap at ±¼: tones/stroke · max spread (a tone moves at most this) |
|---|---|---|---|---|---|
| 8:7:6:5 | 120 | 667 ms | 2.00 · 114 / 190 ms | 1.00 / 1.00 / 1.00 | 1.67 · 114 ms |
| 11:9:7:5 | 120 | 500 ms | 1.00 · 0 / 0 | 1.00 / 1.00 / 1.00 | 1.00 · 0 |
| 16:12:9 | 120 | 500 ms | 2.25 · 250 / 250 | 1.00 / 1.00 / 1.00 | 1.50 · 83 |
| 7:5:3:2 | 60 | 1333 ms | 3.00 · **1143 / 1143** | 1.00 / 1.00 / 1.00 | 1.50 · 286 |
| 19:17:16:15 | 120 | 250 ms | 1.60 · 13 / 29 | 1.40 / 1.40 / 1.60 | 1.60 · 29 |
| 119:42:15:8 | 120 | 250 ms | 1.07 · 0 / 101 | 1.00 / 1.00 / 1.00 | 1.00 · 0 |
| 768:769 | 120 | 250 ms | 2.10 · 50 / 208 | 1.20 / 1.30 / 1.30 | 1.60 · 62 |
| 768:784 | 120 | 250 ms | 3.75 · 122 / 122 | 2.75 / 3.00 / 3.00 | 3.00 · 21 |

What it shows:
- **Today's default is an arpeggio, not a flam.** At ±½, every multi-tone stroke on the simple rows spreads 83 ms to over a
  second.
- **The gate is the row's honest answer.** At 25 ms the simple rows are single notes, and the dense near-unison rows keep
  real chords (768:784: 3 tones a stroke, already ≤ 21 ms apart).
- **Snap trades time for harmony.** It gives 1.5–3 tones a stroke on most rows, but moves tones by up to 114 ms (286 ms on
  7:5:3:2's 1333 ms slots) onto the stroke.

## Decided (Avery, 2026-11-03)
1. **The gate.** The comp's window is an absolute gate in milliseconds, **25 ms by default**.
2. **Snap.** Snap is an option: tones gathered from a wider window are struck together on the stroke. Avery: it is okay
   even though "it bends the boundaries a little bit".
3. **The proposals as written (G1–G9).** Avery approved them, 2026-11-03:
   - G2 as written: the gate is measured in heard time at the seed tempo, and a live tempo change does not re-strum.
   - G8 is the default window.

## Proposed (the builder's calls; Avery may overrule)

- **G1. The gate.**
  - A new override, `compGate`, in ms either side of the stroke: `15 | 25 | 40`, **25 by default**.
  - A stroke plays its own onset, plus each other chord class's onset nearest it within the gate, as `strokeTonesOf` does
    now (ties, the 4-voice cap, `offChord`, inside the bar or span).
  - Each tone sounds at its own time, as now. Nothing is borrowed. With nothing else in the gate, the stroke is a single
    note.
- **G2. Which clock the gate is measured on.** Heard time at the tempo the spec is seeded with. A spec's natural tempo
  has factor 1. A MIDI target is seeded at the clip's own tempo, so its window in spec time is
  `g × seedTempo / specTempo`.
  - A live tempo change does **not** re-strum: the spec stays a function of its overrides.
  - The readout says the gate as heard at the playing tempo ("25 ms gate · heard as 50 ms at 60 BPM").
  - *Alternative for Avery:* re-strum on every tempo change, so the gate always holds in heard ms. That is cheap
    (≤ ~15 ms), but it makes the tempo a compose input.
- **G3. Snap.**
  - `compSnap: true` gathers each class's onset nearest the stroke within **±¼ slot** (STRUM_WINDOW, the old window). It
    then strikes every found tone at the stroke's time.
  - A snapped note keeps its own tone and pitch. Its time and onset are the stroke's, written as `from` = its own onset and
    `snapped: true`, the same shape a borrowed note has.
  - Velocities: the stroke 0.55 (+0.1 a layer more), a snapped tone 0.5 (the strum's).
  - `compRoll: 0 | 8 | 15` ms, **0 by default**, rolls a snapped chord low to high (a downstroke), the stroke's own tone
    first.
  - Snap ignores the gate. With `compBorrow`, the missing classes are borrowed too, so every stroke is a full chord on the
    beat (the stab).
- **G4. Precedence and pins.**
  - With nothing asked: the gate at 25.
  - `compTolerance` given: today's slot window, byte for byte (`compTolerance: 0.5` is today's default; `+ compBorrow:
    true` at 0.25 is the pre-Amendment-3 pin, unchanged).
  - `compGate` together with `compTolerance` fails, with words.
  - `compSnap` takes the place of both.
- **G5. Old specs.**
  - Bump `spec.version`.
  - `compStrumOf(spec)` reads an older spec with no `compGate`/`compSnap` as `compTolerance: 0.5`, so a saved composition
    re-strums (a chord swap, a restrum) as it was made.
  - Exports carry the new overrides only when they aren't the defaults (as `compTolerance` does now).
- **G6. Stats and words.**
  - `compTones` and `compSingles` as now. With Snap, add `compMovedMs` (the mean and max time a tone moved).
  - The decision reads, for example:
    - "25 ms gate: 1.0 tones a stroke, 100 % single notes";
    - "Snap (±¼ slot): 1.7 tones a stroke, tones moved up to 114 ms".
- **G7. Live.**
  - The `restrum` door takes `{ gate, snap, roll }` alongside `{ tolerance, borrow }`.
  - Each change is byte for byte a Compose given the same overrides, one undo step, and kept across a re-compose.
  - A chord swap re-strums its bar at the setting.
  - The clave's strokes never move.
  - `setCompStrum` in the controller accepts the new keys.
- **G8. The window.** In the Comping inspector:
  - **Tight: 15 | 25 | 40 ms** replaces the Tolerance select. The slot tolerances move under Details, as "Old window
    (slots)".
  - A **Snap to stroke** toggle. Its **Roll** select (0 | 8 | 15 ms) shows only while Snap is on.
  - "Fill from the chords" stays.
  - The caption gives G6's words.
  - On the plot, a snapped tone lights its own onset with a thin tick to its stroke (a borrowed tone stays ringed).
- **G9. MIDI.** The comp zone sends what plays: gated tones at their own times, snapped tones at the stroke (plus the roll).

## Phase P: the gate and Snap (one builder: core, then the window)

Built in a worktree off `main` (branch `comp/gate`) and merged `--no-ff` into `composer-release`, which is created from
`main` at the first merge.

- **P1.** `core/compose.js`, the comp section only:
  - the gate (G1–G2), Snap and Roll (G3), precedence (G4), old specs (G5), stats and words (G6);
  - `COMP_VELOCITY`, `VELOCITY` and every other part stay as they are.
- **P2.** `core/rearrange.js`: the `restrum` door's new keys (G7).
- **P3.** `perform/composer-controller.js` (`setCompStrum`, the export), `page/composer-tab.js` (the inspector),
  `page/matrix.js` (`compLine`'s words), `page/trace-frames.js`, and the plot's snapped tick (G8). MIDI (G9) should
  need no change; check it.
- **P4.** Tests:
  - Extend `tests/assert-strum.mjs` against a brute force written from this order:
    - every gated tone a row onset within *g* ms (heard) of its stroke;
    - every snapped tone at its stroke's time with its own tone;
    - the roll's order and offsets;
    - the stats;
    - `restrum` equal to a Compose for each new key;
    - the old-spec read;
    - the precedence failure.
  - Pin every suite whose frozen output moves with `compTolerance: 0.5`. Never re-freeze.
  - The page suites (`assert-page-clave`, `assert-page-matrix`).
  - The probe's table as a check: the gate at 25 gives 1.0 tones a stroke on 8:7:6:5, 16:12:9 and 7:5:3:2, and ≥ 2.5 on
    768:784.
  - The README, DESIGN_NOTES and the checklist below.

## Browser and rig checklist (for Avery; finished in P4)
Every control below is in the Comping cell's inspector (click a Comping cell in the matrix), on the row named, seed 1.
1. **8:7:6:5, default.** The comp plays single notes, locked to the clave; nothing smears. The row reads "tight [25 ms]
   [snap to stroke] [fill from the chords]" and the caption "25 ms gate: 1.0 tones a stroke, 100 % single notes".
2. **Same row, "snap to stroke" on.** Two-note stabs on the strokes, tight. The caption: "Snap (±¼ slot): 1.7 tones a
   stroke, tones moved up to 114 ms"; Tight dims. On the main plot, thin comp-coloured ticks run from each moved onset to
   its stroke's dot.
3. **The Roll select (shown while Snap is on) → 15 ms.** The stab becomes a quick downstroke, the stroke's own tone first,
   then low to high; the caption adds "· rolled 15 ms". "block" (0) is a block chord again.
4. **768:784, default.** Real 3-tone chords that already sound together: "25 ms gate: 3.0 tones a stroke, 0 % single
   notes". Snap changes little (3.0 tones, moved up to ~20 ms).
5. **7:5:3:2, Snap.** The tones moved most: "1.5 tones a stroke, tones moved up to 286 ms". Does it still sound like the
   row's harmony?
6. **Details (header toggle) → "Old window (slots)" → ±½ slot.** Today's arpeggiated comp comes back ("±½ slot: 2.0 tones a
   stroke · 0 % single" on 8:7:6:5): that's the pin. "off" goes back to the gate.
7. **A saved composition from before.** There is no way in the page to reopen one: the composition store lives for the
   session, and JSON export doesn't load back. The old-spec read is checked in Node instead (`assert-strum.mjs`, G5: a
   v1 spec swaps a chord at ±½). Skip unless you have old specs somewhere (see the open questions).
8. **MIDI comp zone** (MIDI out on, a synth on the comp's zone). Gated tones arrive where they play; snapped tones arrive
   together on the stroke, or 8 / 15 ms apart rolled. No player or MIDI code changed: they send each note at its own time.
9. **A MIDI target** (drop a .mid on 41:42:43; ode-to-joy plays at the clip's 108 BPM, the spec's own is 150): the
   caption gives the gate at the clip's tempo with no note. Move the tempo slider to half: the caption adds "· heard as
   50 ms at 54 BPM" (on a plain row: "· heard as 50 ms at 60 BPM"), and the comp doesn't re-strum.

## Log
- 2026-11-03: written (planner); Avery ruled 1–3 (G1–G9 approved). Committed on `composer-release`. Phase P handed to a
  cloud session.
- 2026-11-03: **phase P built** (cloud session, branch `comp/gate` off `composer-release` at 0b2d12a, not `main`: the
  release plan's integration branch already holds this order). Commits:
  - 711ffef: P1–P2, the core (`compose.js` comp section, `rearrange.js` restrum door).
  - 030d376: P3, the controller, the store's comp fields and the window.
  - d2914f4: P4, the tests and the pins.
  - The docs commit after it: README, DESIGN_NOTES ("The comp's gate and Snap (phase P)"), this Log and the checklist.

  **What was built.** G1–G9 as written:
  - `compGate` 15 | 25 | 40 ms, 25 by default, heard at the seed tempo (G2: g × seedTempo / specTempo of spec time).
  - `compSnap` (±¼ slot, struck on the stroke: `snapped`, `from`, `fromTick`) and `compRoll` 0 | 8 | 15 ms.
  - Precedence and refusals with words (`strumSetting`).
  - `composer-spec-v2`, with v1 specs read as ±½ (`compStrumOf`).
  - `compMovedMs` and the G6 words.
  - The `restrum` door's `{ gate, snap, roll }` (`nextStrum`), `setCompStrum` and the export.
  - The Comping cell's Tight, Snap to stroke, Roll and Details' "Old window (slots)", and the caption with the heard gate.
  - The plot's snapped ticks.

  G9 needed no change: the player and the MIDI comp zone send each note at its own `time` and lane. The probe's table
  holds to the hundredth: at 25 ms, 1.00 tones a stroke on 8:7:6:5, 16:12:9 and 7:5:3:2, and 3.00 on 768:784. Snap gives
  1.67 tones and 114 ms on 8:7:6:5, and 1.50 tones and 286 ms on 7:5:3:2.

  **Suites.** This container can't meet the wall-clock budgets, and its Node build moves the floats some frozen hashes
  were made on. So the clean `composer-release` itself passes **71 of 84** here, run alone. The 13 failures are:
  - the 16k-row Compose budgets (about 2.5 s here against 1 s) in arp, comp, claves, compose, frame-clave, rearrange,
    strum and voicing;
  - the tutorial's 10 s opening and compose-dust's 2 ms frame;
  - the hashes that "hold for one Node (V8) build": chord-symbols' 'traced' case, compose's, progression's and trace's
    e3909e1 cases from the 4th on, and five of frame-clave's 768:769 cases.

  `comp/gate` gives the same: **71 of 84**, the same 13 suites failing the same checks, and superrow passes alone.
  Because those hash loops stop at their first miss, I hashed every frozen case on both trees directly:
  - 69 e3909e1 cases (compose, progression, trace);
  - 8 ratio-form cases;
  - 76 c009aaa cases.

  All of them are identical between `composer-release` and `comp/gate`. **Avery: please run the suites on the usual
  machine;** they should be 84/84 there.

  **Pins.** What moved, and how each is pinned (no fixture or hash re-frozen):
  - The version bump moves every whole-spec hash and every comparison with the frozen pre-refactor Compose. These set
    the version back to v1 (nothing else of those specs moved): `settle-baseline.mjs` `normSpec`,
    `assert-chord-symbols`, `assert-comp`, `assert-voicing`, `assert-refactor-identity` (its bad-override error also
    leaves out the three new keys) and `assert-frame-clave`'s P19.
  - The default comp's move is pinned with `compTolerance: 0.5`: `assert-strum`'s phase O sections and
    `assert-page-clave`'s phase O block.
  - The `compBorrow: true` + 0.25 pin holds: `assert-comp`, `assert-composer-midi`, `assert-page-matrix` and
    `assert-frame-clave`, and `assert-strum`'s P34 section.

  **Builder's calls** (DESIGN_NOTES lists them):
  1. The roll's span is held under half the stroke's hold.
  2. Snap with borrowing reads tones as the old borrowing path does (chord classes only), so every stroke is a full chord.
  3. `compRoll` without `compSnap` is refused.
  4. A gate or old window asked while Snap plays turns Snap off; Snap off returns to the gate played before it, else 25.
  5. A restrum writes the current spec version, so an old spec restrummed becomes v2.
  6. Snapped notes carry `fromTick` for the plot.
  7. `compMovedMs` counts only snapped tones, in heard ms.
  8. The comp's five fields in `store/composition-store.js` and `store/composition-edits.js` were edited, outside the
     listed files, so undo and a fresh entry read the gate. Nothing else in the store moved.

  **Open questions for Avery:**
  1. Checklist item 7: there is no way in the page to reopen a composition made before this build. The store lives for
     the session, and JSON export doesn't load back. Where would old specs come from? Should JSON export load back, or
     is G5 only for specs kept outside the page?
  2. At 25 ms, 19:17:16:15 stays 60 % single notes and 768:769 70 %. At 40 ms that becomes 40 % and 70 %. Is that the
     honest answer you want on those rows, or should their default be Snap?
  3. Should Tight be disabled while Snap is on, rather than turning Snap off when a gate is chosen?
  4. Snap moves 7:5:3:2's tones by 286 ms (checklist 5). Should Snap's window shrink on slow rows (say ±¼ slot or 150 ms,
     whichever is less)?
  5. Should Roll apply to a gated chord too (on 768:784 its tones are already within 21 ms), or stay Snap's only?
