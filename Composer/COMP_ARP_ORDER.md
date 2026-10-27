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

## Browser and rig checklist (for Avery; final, for A3–A4 and B2–B4 as built)

**Set up.**
1. Serve the branch that has it from its own folder: `.claude/worktrees/comp-arp-ui` (branch `ui/comp-arp`), or `.claude/worktrees/composer-sprint-2` once it's merged.
2. Hard-reload, so the tab's stylesheet `?v=20261027.3` and the bridge's `?v=20261027` load.
3. Generate 8:7:6:5 (cycle 4 s): a small row, so expect borrowed tones.
4. Open the Composer window: double-click the Playback header, then the Composer tab.
5. Details stays off unless a step says otherwise.

**Comping in chords (A3–A4)**
1. **Compose, then Perform.** Comping plays a chord on every strike of its layer. On this small row most of each chord is borrowed, so it sounds near-block.
2. **The plot.** The comp's colour is pink. Besides its filled dots, you should see **hollow pink rings** on some of the chords' onsets: the sources of the borrowed tones.
   - Click a Comping cell. In the matrix cell, the borrowed tones are hollow pink dots.
   - The inspector says "N strokes".
   - Details on: it adds " · P% from the row", and hovering the line gives the counts.
   - On the plot, the cell's own onsets are ringed and its borrowed sources are ringed hollow.
3. **A dense row.** Try 768:784 (cycle 8 s) or 4099:4093:4091:4079 (16 s). You should see few or no rings, and the comp is a quick strum that rolls with the polyrhythm.
4. **Swap a chord** (a Chords cell → an alternate → Keep). The comp follows from that bar, and its rings move to the new chord's voices.
5. **Legato.** Select Comping and turn legato on: each chord tone rings to the next stroke. No voice should slide into another voice's pitch; that was a chain bug, now fixed. Off: short.
6. **Rig.** The Comp bus on an MPE track:
   - chords arrive one tone a channel, on channels 2–5, beatless against the Chords track
   - Details → MIDI file: the .mid's Comp track holds those channels, with its MPE set-up at the start

**Arp (B2–B3)**
7. **Inner → Arp.** Click an Inner cell. The inspector opens on **Line | Arp**. Click Arp:
   - it starts at once, with no "Composing…": Up, 2 a slot, 2 octaves
   - the inner turns to the harp, unless you'd picked a sound for it
   - its lane reads "Inner · arp"
   - Details adds "N rests of M · P% of steps on a chord tone"
8. **Each knob, live.**
   - Pattern: Up climbs and wraps, Down falls, Up-down turns, As played wanders.
   - Rate 1–4 thickens it.
   - Range 1–3 octaves widens it.
9. **Lead → Arp.** Click a Lead cell, then Arp.
   - The lead becomes an arpeggio over the same chords, and the runner-up lines disappear.
   - The inner moves off the lead's onsets.
   - With Drums set to "clave: with lead + comping", the drums follow the arp.
   - **Line:** the melody comes back exactly as before, with its runner-ups.
10. **Undo (↶ or ⌘Z)** steps back through each switch and each knob. Redo (↷ or ⇧⌘Z) steps forward.
11. **Swap a chord with the lead and inner in Arp.** Both arps follow the new chord from that bar.
12. **Compose again (same seed).** The modes stay. Then press the header glyph: it recalls the composition with no compose, playing the arps, and the Playback div's part strips read "Lead · arp" and "Inner · arp".
13. **A chosen sound.** Pick a sound for the inner, then Arp: it keeps that sound; Line keeps it too.
14. **A MIDI clip.** Choose a .mid.
    - The lead's Line | Arp is greyed. Hovering it reads "the lead is the MIDI clip: a target's lead has no Arp mode".
    - A lead that was in Arp is back in Line.
    - The inner's Arp still works.
    - Clear, then Compose: the lead stays in Line.
15. **Rig.** The arps arrive on the Lead and Inner buses, one note at a time, in tune.

**Watch for (not checkable in Node).**
- Do the hollow rings read as "borrowed" next to a selected part's outer rings?
- Does the switch-and-selects row fit at narrow window widths?
- How the inner arp sounds at rate 2 on small rows. It rests a lot: 41:42:43 at 4 × 8 rests 50 of 64 steps.
- The inner sits a fixed octave under the lead (the core's open question 2).

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
