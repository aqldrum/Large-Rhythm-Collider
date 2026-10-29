# Chord comping, and arpeggiators (order, 2026-10-27)

Two things the Composer has said it would do since 2026-10-22 (DESIGN_NOTES, "Next": "comping as chords", and "a full
arpeggiator for the inner voice"):

- **Phase A, comping in chords.** Today `comp` plays one note at a time. Its source is one layer's first strike in each
  slot, and it sounds only where that strike's tone is a chord tone. On the test rows that's 3–16 notes a cycle. With
  this phase, each stroke plays the bar's chord.
- **Phase B, an Arp mode for the lead and the inner voice.** Each of those parts switches between Line (the mined line,
  as now) and Arp: the chord's tones in a set shape, at a set rate.

Integration branch: `composer-sprint-2`. Phases branch from it as `comp/<phase>` and `arp/<phase>`, each in its own
worktree under `.claude/worktrees/`. The planner reviews each phase, runs the suites and merges it. Never `main`, never
pushed. Verification is the Node suites. Avery does the browser pass and the rig pass.

## The probe (2026-10-27): how much of a chord the row sounds near a stroke

Every note is an onset the row already plays, at its own time. So a chord at one moment needs the row to sound the
chord's tones close together. For each comp stroke of today's Compose (seed 1), this is the share of the bar's chord
classes found among the onsets within a window around it:

| row | onsets | ¼ slot | ½ slot | the slot | slots holding any chord tone |
|---|--:|---|---|---|--:|
| 8:7:6:5 | 22 | 44% | 56% | 67% | 5/6 |
| 11:9:7:5 | 29 | 33% | 33% | 44% | 6/8 |
| 19:17:16:15 | 64 | 39% | 44% | 56% | 14/16 |
| 16:12:9 | 30 | 38% | 57% | 71% (29% full) | 8/8 |
| 119:42:15:8 | 172 | 38% | 44% | 65% | 16/16 |
| 426:317:285 | 1,024 | 64% | 64% | 92% (67% full) | 16/16 |
| 768:769 | 1,536 | 40% | 40% | 47% | 25/32 |
| 768:784 | 1,536 | 81% (25% full) | 81% | 100% full | 32/32 |
| 4099:4093:4091:4079 | 16,359 | 81% (50% full) | 100% full | 100% full | 64/64 |

- **Dense rows** find the whole chord within half a slot: a strum, each tone at its own moment.
- **Small rows, and rows whose tones bunch in time (768:769),** find a third to a half of it.
- **An arpeggio rarely lacks a note.** 75–100% of slots hold at least one chord tone. The engine chooses every note's
  octave (`pitchAtLeast`), so an arp's shape (up, down, up-down) can always be kept. The row only decides *which*
  chord tone comes at each step.

The script is in the planner's scratchpad, not the repo. It re-derives each chord's root class from `chords[k].rootTone`.

## Decided (Avery, 2026-10-27)

1. **Strum, then borrow.** A stroke gathers the chord from the onsets near it (within ½ slot), each sounding at its own
   time: a strum. A chord tone the row doesn't sound nearby is **borrowed**. It takes the tone of the bar's chord voice
   of that class and sounds at the stroke's time, marked as borrowed (as a MIDI target's substitutes are marked). Dense
   rows come out pure; small rows get full chords. (Ruled out: a strict strum with partial chords on sparse rows, and
   block chords at the stroke.)
2. **The comp's rhythm is a layer's clave, every strike.** The best-clave layer stays the source. Every slot it strikes
   becomes a chord stroke, not only the ones whose strike is itself a chord tone. The comp plays that layer's own
   polyrhythm. (Ruled out: today's sparse rule, and curated comp patterns. Patterns may come later.)
3. **An arp's clock is the slots × a rate.** 1–4 notes a slot, taken from the slot's own onsets in time order, so the
   subdivisions keep the row's own timing rather than a quantized grid. (Ruled out: a layer's strikes as the pulse.)
4. **The lead and the inner voice get an Arp mode** (Line ⇄ Arp). Comping and the bass don't. (Not chosen: broken-chord
   comping, bass arps.)

## Proposed: Phase A, comping in chords (the builder's calls; Avery may overrule)

- **P1. The strokes (decision 2).** For each slot the comp layer strikes, its first strike there is the stroke. The
  stroke's own onset sounds only when its tone is a chord tone; otherwise it only sets the moment.
- **P2. Choosing the layer.** Today's score has three parts. Its density part (25–50% of steps landing on chord tones)
  no longer applies once every strike is a stroke. It becomes the share of the bar's *slots* the layer strikes: 1
  between 25% and 60%, falling to 0 at none and at every slot (a layer that strikes every slot is a pulse, not a comp).
  The fit part (straight or triplet step counts) and the covered part (a stroke in every bar) stay. A fourth part is
  added: the strum's coverage, the share of chord tones found unborrowed. The `compLayer` override still picks a layer
  by hand.
- **P3. The strum (decision 1).** The window is the stroke's time ± ¼ slot (the probe's ½ slot). For each chord class,
  the class's onset in the window nearest the stroke wins, with ties going to the most strikes, then the earliest. A
  chart's split bar uses the span's chord at the stroke's slot, and the window doesn't cross the span's edge.
- **P4. Borrowed tones (decision 1).** A class missing from the window takes the tone of the bar's chord voice of that
  class (`chordVoicesOfBar`), at the stroke's time, with `borrowed: true` and `from: <that voice's node>`. If the chords
  part has no voice of that class either, the class is left out.
- **P5. Voicing.** One voice per chord class, root first, stacked close from an octave under the root (the chords'
  register, as comp sits now). A note's `voice` is its class's index, as on the chords part. So the comp is at most 4
  voices, like the chords.
- **P6. Lengths.** Each voice holds until the next stroke (chunk-comping's rule), never past the chord's span. The
  default stays legato off. Off: a stroke's tones last until the next stroke or one slot, whichever is shorter. On: until
  the next stroke. Struck sounds (marimba, kalimba) decay on their own either way.
- **P7. Velocity.** The stroke's own onset: 0.55, plus 0.1 for each extra layer striking it (as now). The strum's other
  tones: 0.5. Borrowed tones: 0.45, so the row's own tones lead.
- **P8. The spec.** Comp notes gain `voice`, and `borrowed` and `from` where they apply. The comp part is articulated
  voice by voice, as the chords are (`partOf(..., { voice: true })`). New stats: `compStrum`, the share of tones found
  unborrowed. A new decision line says the layer, its strokes and that share.
- **P9. Identity.** The old one-note comp stays as an override, `compStyle: 'notes'`. The default becomes `'chords'`.
  `assert-refactor-identity.mjs` and `settle-baseline.mjs` run with `compStyle: 'notes'`, so their frozen fixtures stay
  never-edited and still pass byte for byte. The drums use the comp's strokes in their *with* and *against* modes. They
  keep reading the strokes (one a slot), not the strum's tones, so drums only change where the strokes do.
- **P10. Edits.** A chord swap rebuilds the bar's comp with the new chord (`rearrange.js`, as now through `compOfBar`).
  A borrowed tone follows the swapped chord's voices.
- **P11. MIDI out.** The Comp bus becomes an MPE zone of four, channels 2–5, one a comp voice, exactly like Chords
  (`COMP_MEMBERS`). The .mid file follows. This applies Avery's all-MPE ruling; there's nothing new to decide.
- **P12. The plot and the matrix.** A strummed tone lights its own onset. A borrowed tone lights its source onset as a
  ring (hollow), the way the clip's substitutes are marked. The comp row's cell inspector gains one line, "7 strokes ·
  82% from the row" (the share in Details).

## Proposed: Phase B, the Arp mode (the builder's calls; Avery may overrule)

- **Q1. An arrangement step, live.** Like the drums, an arp is built from the spec and its materials, with no
  re-compose: `arrangeArp(spec, materials, partId, { pattern, rate, range })` in a new `core/arp.js`. It's pure: no
  DP, one pass over the slots, so a switch or a knob is live (a big row's materials come from the worker's cache, as
  rearrange's do). Line ⇄ Arp swaps the part's notes. Line mode is Compose's line, untouched.
- **Q2. The steps (decision 3).** Each slot is cut into `rate` equal sub-windows (rate 1–4, default 2). Each
  sub-window is one step. Its candidates are its onsets whose tone is a chord tone of the slot's chord (the span's, in a
  split bar). A step with none rests.
- **Q3. The pattern: the shape is strict, the order is loose.** The arp walks a ladder: the chord's classes stacked
  close over `range` octaves (1–3, default 2) from the part's floor. Each step takes the candidate whose rung is the
  next one in the pattern's direction, and the octave makes it so. Patterns:
  - **Up / Down:** the next rung above / below, wrapping to the other end of the ladder.
  - **Up-down:** turns at the ends.
  - **As played:** the earliest candidate in the step, placed nearest the previous note.

  So the direction always holds. Which chord tone comes next is the nearest in direction that the row offers. A strict
  1–3–5 order, resting where the class is absent, is a possible later option.
- **Q4. Arp in the inner voice.** Its floor is the inner's register (an octave under the lead). It never plays the
  lead's onsets (`avoidNodes`, as now). It rests on a step where the lead strikes, unless the rate is 3 or more.
  Default sound: harp.
- **Q5. Arp in the lead.** Harmony follows melody, so the chords come from the mined line. An arp lead keeps that
  order: Compose mines the line and settles the chords as now, and the arp then sounds over the final chords instead
  of the line. The line stays in the spec (`lead.line`, silent) and in the trace. Back to Line restores it with no
  re-compose. While the lead is an arp, its runner-ups and lead swaps are hidden. A MIDI target's lead is the clip, so
  Arp is disabled there, with a title saying so. The inner keeps avoiding the arp's onsets.
- **Q6. Lengths and velocity.** Legato off by default: a note lasts its step. On: it holds to the next step. Velocity:
  the part's (lead 0.8, inner 0.5), +0.1 on a slot's first step.
- **Q7. Where it lives.** It's a choice saved with the composition, like the drum grid: in the store's entry, undoable,
  surviving a re-compose. It's not a Compose knob. Compose's own output (Line) is unchanged, so every identity fixture
  holds.
- **Q8. The window.** In the lead and inner cell inspectors: a **Line | Arp** switch. When Arp is on: Pattern (Up,
  Down, Up-down, As played), Rate (1–4), Range (1–3 octaves). The part strip's name gains "· arp". In Details: the
  rests count and the steps' share holding a chord tone.
- **Q9. MIDI.** One note at a time, so its bus stays a zone of one. Nothing changes there.
- **Q10. Improvise, later.** Pattern and rate are natural things for the improvise walk to vary from loop to loop
  (DIRECTIONS.md, "Improvise"). It's not built here.

## Phase A: comping in chords

- A1. `compose.js`: `compStepsOfBar` → every struck slot (P1); the score (P2); `compOfBar` → the strum and the borrowed
  tones, voiced (P3–P5, P7); `compStyle` (P9); the comp part articulated by voice (P6, P8).
- A2. `rearrange.js` and the store: a chord swap rebuilds the comp's chords; `specNotesOf` keeps `voice`, `borrowed`
  and `from`.
- A3. `composer-midi.js`: the Comp zone of four (P11); the .mid's comp track.
- A4. The plot's rings for borrowed tones, and the inspector's line (P12); the trace's `parts` event carries the comp's
  voices.
- A5. Tests: a new `assert-comp.mjs` checks:
  - every strike is a stroke;
  - every strum tone is a real onset within ± ¼ slot of its stroke, and of a chord class;
  - borrowed tones are exactly the classes missing from the window;
  - the stroke's chord, through a split bar;
  - at most 4 voices;
  - lengths with legato on and off;
  - the 16k row's timing;
  - `compStyle: 'notes'` byte for byte.

  `assert-composer-midi.mjs` adds the Comp zone. The identity suites run as P9 says.

## Phase B: the Arp mode

- B1. `core/arp.js`: `arrangeArp` (Q1–Q3, Q6) and its tests, `assert-arp.mjs`, which check:
  - every note is a real onset, of a chord class, inside its step's sub-window;
  - the shape holds for each pattern;
  - `range` holds;
  - the inner's avoidance (Q4);
  - rests;
  - a split bar;
  - the 16k row's time (target: under 50 ms).
- B2. The controller and the store: the per-part mode and its knobs (Q7), live, undoable; lead in Arp hides its swaps
  (Q5); the MIDI target disables it.
- B3. The window: the switch and knobs (Q8), the strip's "· arp".
- B4. Tests: `assert-page-arp.mjs`: the switch, live with no re-compose, undo, a re-compose keeping the mode, the
  target's lock, recall through the glyph.

A and B touch different core files. Both touch the cell inspector in `composer-tab.js`, so A3–A4 and B3 go one after
the other. A1–A2 and B1 can run side by side.

## Browser and rig checklist (for Avery; final, for A–E as built)

This replaces the A3–A4 / B2–B4 checklist: the comp now follows the clave (phase C), the arps are mined (phase D), and
the window has the clave and arp pickers (phase E). The numbers below are seed 1.

**Set up.**
1. Serve the branch from its own folder: `.claude/worktrees/clave-arp-ui` (branch `ui/clave-arp`), or `.claude/worktrees/composer-sprint-2` once it's merged.
2. Hard-reload, so the tab's stylesheet `?v=20261027.4` and the bridge's `?v=20261027.2` load.
3. Generate 8:7:6:5 with a 4 s cycle. Open the Composer window (double-click the Playback header, then the Composer tab) and Compose.
4. Leave Details off unless a step says otherwise.

**The comp follows the clave (C, E)**
1. **Perform, and click a Comping cell.** You should see:
   - the line "clave `.xx.` from layer A · 4 steps", Sync lit
   - "N strokes" above it
   - a list of claves: the row's ranked ones, then son, rumba and bossa (dashed), with Compose's marked ● C
   You should hear a chord on 2 strokes a bar, near-block, because this small row borrows most of each chord. The hollow pink rings on the plot are the borrowed tones' sources.
2. **The perc is on the clave.** With Drums on backbeat, the perc ticks with the comp's strokes in Sync.
3. **Fill.** Click Fill: no "Composing…". The comp moves into the clave's gaps (here `x..x`, the complement), and the perc stays where it was, so the two hocket. Click Sync to bring it back. Each click is one undo step (↶ / ⌘Z).
4. **Choose a clave.** Click another clave in the list while performing:
   - it's held to the next bar, and the footer says "auditioning from the next bar…"
   - the comp and the perc switch together at the barline
   - Revert (or Esc) goes back, and leaves no redo step
   - click it again, or Keep, and it stays: one undo step, marked ●, with a "chosen" tag on the clave line
5. **A curated clave.** Click **son**, then Keep. The line reads `x..x..x. ..x.x...` · son clave 3-2: a pass every two bars. The perc plays the son, and the comp strikes it (or its gaps, in Fill).
6. **Details on.** The clave line adds its score (recurrence, density, fit), its tone set ("under the tone 7/4") and the pattern Fill strikes. Each list row shows its score.
7. **A chord swap with son chosen** (Chords cell → an alternate → Keep). The comp re-strums that bar over the new chord, and son stays.
8. **Compose again (same seed).** Son and Fill are kept, and nothing is listed as dropped. Then press the header glyph: it recalls the composition with no Compose, still on son.
9. **The rows.** On each row, compare Sync and Fill, then try two or three claves from the list:
   - **19:17:16:15** (3 s cycle): a 16-step clave `.......x....x.xx` (layer C); Fill strikes 2 a bar
   - **768:769** (8 s): `..xx`, comps 8 strokes; few tones come from the row
   - **768:784** (8 s): `..xx` (layer B), mostly from the row, so few rings
   - **4099:4093:4091:4079** (16 s): `..xx`; 16 strokes, 93 % from the row. The first switch to another clave takes about 60 ms (the row is ranked once); later ones are instant.
10. **Show the work.** On a fresh Compose, the Comping caption reads "the clave `.xx.` (from layer A · 4 steps): N strokes".

**Mined arps (D, E)**
11. **Inner → Arp.** Click an Inner cell, then Arp:
    - it starts at once, ×1, on the harp
    - the lane reads "Inner · arp"
    - under the switch, "Arps · phrase N" lists that phrase's arps by contour and band ("arch · no rests"); the playing one is marked ●, the best-ranked C
    - Details adds "N rests of M · P% chord tones · K of L phrases mined", and each row its cost a note and its chord-tone share
12. **Pick an arp** while performing: it's held to the next bar. Revert goes back with no redo step. Keep (or a second click) is one undo step. Clicking the C row again removes the pick.
13. **Time.**
    - ×2 / ×3 re-mine over double or triple the anchors, and each note still sounds at its own onset's time
    - **changing Time drops your picks** (Avery's ruling): the list starts again at the best-ranked
    - one ↶ restores both the old Time and the picks
14. **A walked phrase.** On 8:7:6:5 at ×2 the inner's phrase reads "walked: nothing could be mined here … no arp to pick", and the list is empty. 768:769 mines ×1 (lead), ×2 (both) and half of ×3.
15. **Lead → Arp.** The runner-up lines are replaced by the arp picker. The inner moves off the lead's onsets. Line brings the melody back exactly, with its runner-ups.
16. **Compose again (same seed).** The modes and your picks stay. A pick whose phrase no longer offers it would be listed under "Compose couldn't keep … of the edits" (the clean view's line; Details lists it).
17. **A MIDI clip.** The lead's Line | Arp is greyed (hover: "the lead is the MIDI clip…"), a lead that was in Arp goes back to Line, and the inner's Arp and the clave picker still work.

**MIDI (the rig)**
18. The Comp bus is an MPE zone of four: each chord tone on its own channel, 2–5. In Fill, the strokes land in the clave's gaps, against the Drums bus (channel 10). Details → MIDI file: the .mid's Comp track has those channels and its MPE set-up.
19. The arps arrive on the Lead and Inner buses one note at a time, in tune, and follow a pick or a Time change from the next bar.

**Watch for (not checkable in Node).**
- Does the 15-row clave list, with its monospace patterns, fit the inspector at narrow widths?
- Is a clave auditioned at the barline seamless, given that the perc and the comp change together?
- Does Fill on the dense rows' bunched claves (`..xx` → `xx..`) read as a hocket, or just as a shift?
- Does the arp list read better by contour, or should the best-ranked row also say "default"?
- The inner sits a fixed octave under the lead, and still rests a lot on small rows.

## Amendment 1 (Avery, 2026-10-27, after the first build): the clave leads the comp; arps are mined

Avery's note, after A and B were built: in chunk-tunes, comping is tied to the percussion clave, either synced to it or
filling its gaps. On dense rows the Composer comps nearly every slot. The clave should transcend the scale of the
numbers, so that it is the authority on which anchors are comping nodes. And the arps give one fixed line per pattern.
In chunk-tunes the arps came from the partitioned anchors of the grid superrow, closer to As played. They should be
found around the slots per bar as anchors, or around double or triple that number for double- or triple-time arps.

### What the code already holds

- **chunk-tunes' clave** (`rhythm-claves.js`, `chunk-comping.js` in the Overworld runtime) is a `steps:pattern` of
  3–16 steps a bar. It's scale-free: laid on a bar as fractions of it, a 5-of-16 clave strikes 5 places on any row. A
  clave's *partners* are claves of the same layer and bar under a tone set disjoint from its own, so they never share a
  step. Laid together, the two make the clave of the two sets joined.
- **The arp line type.** chunk-lines' `arp` type is already in `lines.js` `LINE_TYPES`: no rests, `maxGap: 1`,
  contours rise, fall, arch, valley and wave over the octave. It's mined by the same DP as the lead. B1 didn't use it.
- **Partitioned anchors** at any resolution: `buildCells(row, { bars, slotsPerBar: S·m, anchors, phase })`, Partitions'
  own G / G±1 cut.

### The probe (2026-10-27): mined arps over S × m partitioned anchors

Seed 1, `mineLines(types: [arp])` over the chords' targets, an octave under the lead. Two variants:
- **chunk-lines' band alone** ("no rests"): fails wherever an anchor has no candidate. That's 8:7:6:5 and 11:9:7:5 at
  ×2–3, 19:17:16:15 at ×2–3, and 768:769 at every m.
- **With a second band, "few rests"** (60–95% of the anchors, `maxGap: 2`): the table below. Arps per phrase are the
  distinct ranked lines.

| row | ×1 | ×2 | ×3 | time (all phrases) |
|---|---|---|---|---|
| 119:42:15:8 | 10 | 10 | 9–10 | 1–2 ms |
| 16:12:9 | 10 | 9 | 4 | ≤ 2 ms |
| 426:317:285 | 10 | 10 | 9–10 | 3–8 ms |
| 768:784 | 10 | 10 | 10 | 7–10 ms |
| 4099:4093:4091:4079 (modulation off) | 10 | 5–10 | 5–10 | 18 / 31 / 39 ms |
| 19:17:16:15 | 9 | 4 | none | ≤ 2 ms |
| 8:7:6:5, 11:9:7:5 | 4–8 | none | none | — |
| 768:769 | none | none | none | — |

Chord tones are 78–100% of the best line's notes. Two flaws to fix:
- The ranking (cost per note) prefers the sparser "few rests" lines even where "no rests" exists.
- 768:769 finds nothing at any m. Its tones bunch in time; the builder should find out why. The comp probe found a
  chord tone in 25 of its 32 slots.

The scripts are in the planner's scratchpad.

### Decided (Avery, 2026-10-27)

5. **The clave is mined from the row**, and it is the comp's authority. This replaces decision 2: the comp no longer
   strikes every strike of a layer.
   - The row's claves come from chunk-tunes' clave table, ported. Each layer is read at the bar sizes where other layers
     meet it, under tone sets from coarse to fine. Each bar is a `steps:pattern` of 3–16 steps.
   - They're ranked by recurrence, density (25–50% of steps) and fit (straight or triplet).
   - The curated claves (son, rumba, bossa's rim) stay as choices.
6. **The comp syncs to the clave by default.** A Sync | Fill switch in the comp's inspector makes it strike the clave's
   gaps instead.
7. **Mined arps replace the walked patterns.**
   - Arps are mined with the `arp` line type, over partitioned anchors at ×1, ×2 or ×3 the slots per bar (double and
     triple time), shaped by its contours.
   - Each note sounds at its onset's own time: the arp moves in polyrhythmic time, around the anchors.
   - The walk survives only as a fallback, for a phrase where nothing can be mined.
8. **Ranked arps are chosen like the lead's runner-ups.** The arp cell's inspector lists the phrase's arps. Click one
   to audition it at the next bar, then Keep or Revert, undoable.

### Proposed: Phase C, the clave (the builder's calls; Avery may overrule)

- **R1. `core/claves.js`.** A port of `rhythm-claves.js` (`readRhythm`, `barSizes` with 'meeting', `claveTable`,
  `toneSets`) and of `chunk-comping.js` (`scoreClave`, `compCandidates`, `clavePartners`) onto the Composer's row (its
  layers, strikes, owners and tones). The rules are the same: `COMP_RULES` sizes 3–16, at least 2 onsets, share
  0.25–0.5, straight / triplet / other fit. The same Overworld parity tests as the other ports run where chunk-tunes is
  present.
- **R2. One clave a composition,** chosen in Compose. The best `compCandidates` clave wins, with ties by the seed.
  `spec.clave = { id, steps, pattern, onsets, score, from: { layer, size, toneSet } | { pattern: 'son' … }, partner }`.
  `partner` is its best partner clave, for Fill. With no partner, the complement of its steps, Euclid-thinned to its
  own onset count. A decision line names it and why. The ranked list (top 12, plus the curated claves) goes into the
  trace as the alternates (the `compLayer`-style override becomes `clave: 'steps:pattern' | patternName`).
- **R3. Laying it on the bars:** a pass of the clave a bar. Step j of n sits at j·S/n slots (a place, as drums.js
  places strokes) and lands on the row's onset nearest that place. The window is half-way to the neighbouring places of
  the clave's own n-step grid, then one place wider (drums.js `land` semantics, reused). With no onset there, the step
  is silent. A landed step is a comp stroke. The strum and the borrowed tones (P3–P7) are unchanged.
  `compRelation: 'sync' | 'fill'` picks the clave's onsets or its partner's.
- **R4. The drums hear the clave.** In the layered modes (backbeat, with, against), the perc plays the clave's landed
  strokes by default (`drumOptions.perc: 'clave'`). So the perc and the comp share anchors in Sync and hocket in Fill.
  *with* / *against* keep reading the comp's strokes, now clave-born, so nothing is circular. A curated pattern keeps its
  own perc line. The drums baseline stays byte-identical under `compStyle: 'notes'` and `perc: 'pattern'` in the tests'
  calls, never in the fixtures.
- **R5. What retires:** the comp layer's score (P2) and decision 2's every-strike strokes. `compStyle: 'notes'` (the
  frozen core) stays.

### Proposed: Phase D, mined arps (the builder's calls; Avery may overrule)

- **M1. `arrangeArp(spec, materials, partId, { time, picks, legato })`** keeps its live, no-re-compose contract.
  - `time` ∈ {1, 2, 3}: the anchors are `buildCells` at S·time slots a bar, with the spec's anchors mode and phase.
    It's cached per time on the materials.
  - The chords are rebuilt as records from the spec. Export the rearrange path for it; don't duplicate it.
  - A phrase is `phrasesOf` over the S·time cells, so a line is ≤ 32 anchors.
  - Each phrase is mined with the arp type plus the "few rests" band.
- **M2. Ranking:** "no rests" lines first, then "few rests", then cost per note. Each phrase keeps its top 10 as
  alternates `{ id, contour, band, notes }`. `picks: { [phrase]: id }` chooses one; the default is the first.
- **M3. Register and avoidance,** as B1's builder set them: the lead is centred on its line's median, and the inner an
  octave under the lead (a `register` on the miner). The inner never takes the lead's onsets (`avoidNodes`). It pays
  `weights.avoid` on anchors where the lead sounds (`avoidSlots`, on the S·time grid), rather than resting outright.
- **M4. The fallback:** a phrase with no mined line is walked (B1's ladder, 'played', the closest to As played) and
  marked `walked`. The part's `arp.stats` says how many phrases were mined and how many walked.
- **M5. Knobs:** Time (×1, ×2, ×3) replaces Rate. Contours replace Pattern: each alternate is named by its contour and
  band ("arch · no rests"). Range goes: a mined arp lives in the line type's own range (`RANGE_WIDTH`). Legato stays.
- **M6. Find out why 768:769 finds nothing** (the lattice, the frame, the `repeat` rule?), and fix it if it's a bug.
- **M7. Timing.** The 16k row at ×3 is ~40 ms for every phrase. Above `MAIN_THREAD_ONSETS` it goes to the worker
  (`runCompose.arp`, built in B2), as now.

### Phases C and D

- **C (core):** `core/claves.js` and its tests (`assert-claves.mjs`, with Overworld parity); `compose.js` (R2, R3, R5);
  `drums.js` (R4); `rearrange.js` (a chord swap re-strums the bar's strokes, and the clave stays).
- **D (core):** `core/arp.js` rewritten (M1–M7); `assert-arp.mjs` rewritten:
  - every note a real onset of a chord class, inside its anchor's window;
  - the ranking, picks, the fallback marked;
  - the inner's avoidance;
  - a split bar;
  - a target's lead refused;
  - ×1–×3 on the 16k row's timing.
- **E (window, after C and D):**
  - the comp inspector: the clave by name and pattern (`x..x..x.`), its ranked alternates and the curated claves,
    audition / Keep / Revert, and Sync | Fill;
  - the arp inspector: Time, and the phrase's ranked arps by contour (audition / Keep / Revert, as the lead's
    runner-ups);
  - the store: `arps[part] = { mode, time, picks }`, the clave choice and the relation, undoable, kept through a
    re-compose where the phrase's chords are unchanged, dropped (and listed under "Compose dropped") where they changed;
  - page tests;
  - the checklist rewritten.

C and D touch different core files and can run side by side. E goes after both.

### Later (recorded, not ruled)

- chunk-song's arp-first scene: an arp's accents (its first note, and each note that tops its neighbours) set where the
  perc, the kick and the comp strike. That's the clave and the arp meeting, and a candidate for the improvise thread.

## Log
- **2026-10-27, B1 merged (223be9c, `arp/core`).** `core/arp.js` `arrangeArp` + `assert-arp.mjs`; 75/0. 16k row ~2.5 ms
  a part. Builder's calls where Q1–Q6 left room: the lead's floor is its line's median − 600 × range; the inner's a fixed
  octave under it; a move is > 50¢; up-down with nowhere to go plays the nearest rung; legato holds to the next note;
  a note's `slotSeconds` is its step's. Open for Avery: (1) small rows rest ~half the steps at rate 2 (8:7:6:5 holds a
  chord tone in 50–58%); (2) the inner a fixed octave under the lead, vs the mined inner's ~400¢ on 8:7:6:5; (3) under
  a dense lead at rate 1–2 the inner rests on every step the lead strikes (17/64 on 768:784).
- **2026-10-27, A1–A2 merged (83e4583, `comp/core`).** The comp in chords, `compStyle: 'notes'` kept for the frozen
  fixtures (only the tests' compose calls changed), `assert-comp.mjs`; 76/0 together with B1. 16k timing unchanged.
  From the row / pure strokes: 8:7:6:5 60% (2/6), 768:769 26% (0/32), 768:784 87% (16/32), 16k 94% (51/64).
  Builder's calls: the strum never crosses the bar; a borrowed tone sits on the stroke's node (its ratio from `from`);
  the comp part carries `strokes` (the drums read them); each tone carries `holdTo`. **Until A3: MIDI out stacks the
  strum on the Comp bus's one channel.** Open for Avery: (1) on dense rows every layer strikes every slot, so the comp
  is a chord on every slot (P2's density term is 0 for all); thin it?; (2) small and bunched rows borrow most of the
  chord (11:9:7:5 27%, 768:769 26% from the row), near-block chords, as ruled; (3) the drums' *with* / *against* get
  more strokes under the new default.
- **2026-10-27, A3–A4 and B2–B4 merged (81f29e9, `ui/comp-arp`).** 77/0 with `assert-page-arp.mjs`. The Comp bus is an
  MPE zone of four (`ZONE_MEMBERS`); borrowed tones ring their source on the plot, in the cell and in the matrix; the
  arps live in the store entry (`state.arps`), in undo/redo and audition snapshots, applied over the Line spec on every
  rebuild, in the worker above `MAIN_THREAD_ONSETS`. Builder's calls: a part's sound carries over a rebuild only where
  it was chosen (so the inner's harp in Arp); a MIDI clip puts an arp lead back in Line; `swapLead` still works under an
  arp lead (the window hides it); the player lanes the comp by voice (a legato comp chained voices into each other).
  CLEAN_MIDI_ORDER.md's routing table (Comp a zone of one) is left as history. Avery's browser and rig pass owed: the
  checklist above.
- **2026-10-27, amendment 1 phase D merged (71b15d7, `arp/mined`).** `arrangeArp` mines the `arp` type (+ a "few rests"
  band) over S × time partitioned anchors, ranked no-rests first, top 10 a phrase, picks by id, B1's walk the
  fallback (`walked`). Options `{ time, picks, legato }`; the window's one Time select (picker is E). M6: 768:769 wasn't a
  porting bug: an evenly struck row has no weak slot, so no foreign tone may sound; `lines.js` `weakTies` (opt-in, a
  slot tied at the median off the strong beats is weak) is retried only on a phrase that mines nothing. Builder's calls:
  arps aren't chord-tones-only (scale and resolved foreign tones, as the miner allows); accent on strong beats; default
  ×1; a time past 32 anchors runs at the largest that fits. 16k row: lead + inner at ×3 ≈ 110 ms on the main thread
  (under `MAIN_THREAD_ONSETS`). Open: chord-tones-only option?; ×1 default?; a lower worker threshold for arps?;
  weakTies only on failure?; picks reset on a Time change?
- **2026-10-27, amendment 1 phase C merged (`clave/core`; with D, 78/0).** `core/claves.js` (rhythm-claves +
  chunk-comping ported, parity tests), one clave a composition in `spec.clave` with its partner, laid a pass a bar via
  drums.js `landPlace`, the comp synced (or `compRelation: 'fill'`), the perc on the clave in the layered modes.
  Builder's calls: `held` read as recurrence (one rhythm); size tiers meeting → whole → every (dense rows find no
  meeting size ≤ 16); a Fill step on a clave onset is silent; `compLayer` under chords throws. Seed 1: 8:7:6:5
  `4:.xx.`; 19:17:16:15 `16:.......x....x.xx`; 768:769, 768:784 and the 16k row all `4:..xx` (ties at the top with 8-
  and 16-step claves, broken by the seed). The comp now strikes 2–4 times a bar on every row. A live clave switch needs
  a rearrange-style step (pieces exported, step not built: E). Open: longer claves win ties?; accept the size tiers?;
  Fill silent on shared onsets?; tone sets read from 1/1 (chunk-tunes) rather than the root?
- **2026-10-27, amendment 1 phase E merged (`ui/clave-arp`; 79/0 with `assert-page-clave.mjs`).** `rearrange.js`
  `reclave` (a live clave or Sync | Fill switch: byte-identical to a full Compose with the same overrides over 99
  switches; 16k row ~5 ms, ~63 ms the first switch to another clave while the row's ranking is cached); the comp
  inspector's clave block (pattern, source, Sync | Fill, the 12 mined + 3 curated alternates auditioned at the barline);
  the arp phrase picker (audition / Keep / Revert); `state.edits.clave` and `state.arps[part].picks` undoable, kept
  through a re-compose where still offered, else listed under "Compose dropped"; a Time change drops the picks (one
  undo restores both); the animation's comp caption names the clave. The checklist above is now final for A–E. Avery's
  browser and rig pass owed.
