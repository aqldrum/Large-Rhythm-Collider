# Bass densities, and voice-led chords (order, 2026-10-27)

Two things Avery asked for after the comp and arp pass (COMP_ARP_ORDER.md):

- **Phase F, voice-led chords.** Today every bar's chord is root position, stacked close from an octave under its root.
  With this phase, each tone takes the octave nearest the chord before it, inside a register window, and never sits
  under a low-interval limit read from its ratio. Only octaves change: every note is still an onset the row plays.
- **Phase G, bass densities and a lock.** Today the bass is one band (sparse) with no choices. With this phase it offers
  four densities (Roots, Sparse, Moving, Walking), can land only on the kick or the clave, and offers runner-ups bar by
  bar like the lead.
- **Phase H, the window.** The bass inspector (density, lands on, the bar's runner-ups) and the chords' Close | Led
  switch.

Integration branch: `composer-sprint-2`. Phases branch from it as `voicing/<phase>` and `bass/<phase>`, each in its own
worktree under `.claude/worktrees/`. The planner reviews each phase, runs the suites and merges it. Never `main`, never
pushed. Verification is the Node suites. Avery does the browser pass and the rig pass.

## The probe (2026-10-27): the chords' register and the bass's density today

Compose (seed 1; seeds 2 and 3 are the same here), each bar's chord voices at their first note, in Hz as they sound:

| row | bars × slots | chords' lowest note | muddy bars | the voicing's centre, a bar | voice motion → nearest octave | bass a bar | bass on the downbeat | bass with the kick |
|---|---|---|--:|--:|---|--:|--:|--:|
| 8:7:6:5 | 2 × 3 | 241 Hz | 0/2 | 12¢ | 0¢ → 0¢ | 1 (33%) | 1/2 | 1/2 |
| 11:9:7:5 | 2 × 4 | 127–191 Hz | 1/2 | 705¢ | 1119¢ → 284¢ | 1 (25%) | 1/2 | 0/2 |
| 19:17:16:15 | 2 × 8 | 181–192 Hz | 0/2 | 127¢ | 380¢ → 380¢ | 2 (25%) | 2/2 | 1/4 |
| 7:5:3:2 | 1 × 3 | 156 Hz | 1/1 | — | — | 1 (33%) | 1/1 | 1/1 |
| 119:42:15:8 | 4 × 8 | 180–269 Hz | 1/4 | 543¢ | 2387¢ → 427¢ | 2 (25%) | 0/4 | 3/8 |
| 768:769 | 4 × 8 | 181–305 Hz | 0/4 | 497¢ | 2690¢ → 873¢ | 2 (25%) | 1/4 | 1/8 |
| 768:784 | 4 × 8 | 253–269 Hz | 0/4 | 87¢ | 748¢ → 237¢ | 2 (25%) | 0/4 | 1/8 |

- **Mud is real but occasional.** A bar is counted muddy when two neighbouring voices are a major third or closer with
  the lower under 180 Hz, or a fifth or closer under 110 Hz: 9 of 57 bars.
- **The lurch is the bigger problem.** Each bar is floored at its own root, so a root that wraps from near 1200¢ to near
  0¢ drops the whole chord about an octave. Moving each tone by octaves to sit nearest a tone of the chord before cuts
  the motion 3–5×.
- **The bass is one density.** 1–2 notes a bar, 25–33% of the slots, rarely on the downbeat or with the kick. Its top note
  is usually exactly an octave under the chords' lowest, so it mostly doubles the root.

The script is in the planner's scratchpad (`register-probe.mjs`), not the repo.

## Decided (Avery, 2026-10-27)

1. **Bass densities: Roots, Sparse, Moving, Walking.** Roots, one note a chord on the change. Sparse, today's band.
   Moving, the lead's mid band two octaves down. Walking, every slot, stepwise, approaching the next chord's root.
2. **The bass can lock: Free | Kick | Clave.** Free, the miner's own choice (today). Kick, only onsets the kick strikes.
   Clave, only the comp's strokes (the clave's in Sync, its partner's in Fill).
3. **Chords voice-lead by nearest octave with a mud limit.** Each tone in the octave closest to the chord before, inside
   a register window, never under the ratio-aware low-interval limit. Inversions are allowed.
4. **On by default, and the comp shares it.** The comp's strum takes each class from the chords' octave, so the two agree.
   A Close | Led switch keeps the old voicing.

## Proposed: Phase F, voice-led chords (the builder's calls; Avery may overrule)

- **P1. The mud limit.** Two neighbouring voices less than an octave apart, their interval n/d in lowest terms (the row's
  tones are fractions, so it is exact), are muddy when the lower sounds under **27 Hz × log2(n·d)**: 3/2 → 70 Hz,
  5/4 → 117, 6/5 → 132, 7/6 → 146, 9/8 → 167, 16/15 → 213, near the usual 12-ET limits. Dense rows' near-unisons
  (769/768 → 518 Hz) get opened up. Hz is the note as it sounds: baseHz × the tone × 2^octave × the bar's
  fundamentalRatio. It is lines.js' `closeCost` measure (log2(n·d)) again. A voice an octave or more above its
  neighbour is never muddy.
- **P2. The pass.** After every bar's (or span's) chord voices are chosen as now (which onset each class sounds), one
  pass sets their octaves:
  - The first chord: its close voicing as now, lifted by octaves until it is clear of the mud limit.
  - Each chord after: every assignment of octaves inside the window (about 3 octaves a tone, at most 4 tones) is scored
    by the least motion from the chord before (each tone to its nearest tone there, cents), plus a large cost per muddy
    pair; the cheapest wins, ties to the lower centre.
  - Cost: at most 81 voicings a chord, so microseconds on any row.
- **P3. The window.** No chord tone under the bass's register top (1/1 − 1200¢, as today's floor: the bass stays under
  the chords) and the voicing's mean pitch within ±600¢ of the first chord's, so a long progression can't creep.
- **P4. The loop.** Each chord is led from the one before; bar 0 from nothing. The motion across the loop's wrap (the
  last chord to the first) is reported in the spec's stats, not optimized (proposed; a second pass could close it).
- **P5. The comp shares the octaves.** A strum tone of a class takes the octave putting it nearest that class's chord
  voice in its bar; a borrowed tone is the voice itself, octave and all. Neither stacks close from the root any more.
- **P6. Lanes.** A note keeps `voice` (its chord class: the highlights, the fixtures and `rearrange` read it) and gains
  `lane`, its register order in the chord as led (0 = lowest). The player's legato and the MIDI comp and chords zones
  lane by `lane`, so each channel moves by the voice leading's small steps instead of jumping class to class.
- **P7. `voicing: 'close' | 'led'`.** An override, `'led'` by default. `'close'` is today's output byte for byte, and the
  frozen fixtures (compose-before.js, the identity suites) are pinned with it, as `compStyle: 'notes'` pinned the comp.
- **P8. A chord swap.** Swapping bar k's chord can move every later chord's octaves (each is led from the one before).
  The swap re-runs the pass over all bars: tones never change outside bar k, only octaves, and the rearrange audit lists
  the bars whose octaves moved. A JSON round trip rearranges the same.
- **P9. The trace.** The decisions say the voicing, how many chords the mud limit lifted, and the mean motion a chord.

## Proposed: Phase G, bass densities and the lock (the builder's calls; Avery may overrule)

- **P10. A live step.** `core/bass.js` `arrangeBass(spec, materials, { density, lock, picks })`, like `arrangeArp`:
  live, no re-compose, auditioned at the barline with Keep and Revert, one undo step. Compose's own bass is the
  default (Sparse, Free) and stays byte for byte what it is now, so no fixture moves.
- **P11. The densities.**
  - **Roots:** a chord (a chart's span) gets one note, the root-class onset nearest the chord's first slot, in the bass's
    register. None in the span: the chord's root onset (today's fallback). Locked: the root-class onset nearest the
    first locked onset in the span, else the locked onset itself on the nearest chord tone.
  - **Sparse:** the bass line type's sparse band (20–35%), as now.
  - **Moving:** a new `mid` band for the bass type, 40–60% at strictness 1.5 (the lead's mid band).
  - **Walking:** a new `walking` band, 100% with `maxGap: 1`, stepwise motion, each bar mined with the next chord's root
    as its `after` boundary (STEP 4a's rule), so it approaches the change. The clock is the bar's slots, halved while
    above 8 (16 slots walk 8 a bar), so a 16-slot row doesn't run sixteenths (proposed).
- **P12. The lock.** A new opt-in miner rule, `allowNodes`: a lattice slot keeps only candidates on those onsets.
  - **Kick:** onsets within ¼ slot of a kick hit in `spec.drums`. With the drums off, or no kick in the mode, the lock
    falls back to Free and says so (like `arpRefusal`).
  - **Clave:** the onsets of `compSourceOf(spec.clave)`, the comp's strokes, so the bass and the comp land together.
  - **Shares are of the locked slots.** Locked, a band's share counts the slots holding a locked onset, not all slots:
    Moving on a kick that strikes 3 times a bar plays 1–2 of them, Walking all 3.
- **P13. Runner-ups.** Each bar offers its best 8 bass lines at the density and lock (cost order, as the lead's), picked
  and auditioned like the lead's. Picks are keyed by bar at a density and lock; a change of either drops them, and one
  undo restores both (the arp's Time rule).
- **P14. The chords.** The bass is mined bar by bar against its chord as now; a chord swap re-mines that bar's bass at the
  part's density and lock, keeping picks only where the bar's offer still holds them ("Compose dropped" otherwise).
- **P15. Rooting.** `bassRooted` keeps its meaning (the bar's first note on the root's class) for every density, and the
  stats add `bassOnDown` (the bar's first slot) so the browser pass can compare densities.

## Phase F: voice-led chords

- **F1.** `compose.js`: the voicing pass (P1–P4) over the chord voices, `voicing` override (P7), `lane` (P6).
- **F2.** The comp's strum and borrowed tones take the chords' octaves (P5); `compStyle: 'notes'` is untouched.
- **F3.** `rearrange.js`: a chord swap re-runs the pass (P8). `perform/composer-player.js` and `perform/composer-midi.js`
  lane chords and comp by `lane`.
- **F4.** `tests/assert-voicing.mjs`, checked against a brute force written from this order: every chord clear of the mud
  limit where any voicing in the window is; the chosen voicing's motion equal to the brute force's least; the window
  held; the comp's tones at their class's octave; `'close'` byte for byte the old output; a swap's tones unchanged
  outside its bar. Existing suites pass with their pins.

## Phase G: bass densities and the lock

- **G1.** `lines.js`: the bass type's `mid` and `walking` bands; the `allowNodes` rule (opt-in, so every other mine is
  unchanged).
- **G2.** `core/bass.js`: `arrangeBass` (P10–P13), `bassOf` stats, the refusal for a lock with nothing to land on.
- **G3.** `rearrange.js`: a chord swap re-mines the bar at the part's density and lock (P14).
- **G4.** `tests/assert-bass.mjs`: each density's share and band against a brute force; Roots one note a chord; Walking's
  gaps and approach; every locked note on a locked onset; the Kick fallback with drums off; picks and their drop rule;
  Sparse/Free byte for byte Compose's bass.

F and G can run in parallel: F touches the chord voices, the comp's octaves and the lanes; G touches `lines.js`, a new
`bass.js` and the bass's rearrange path. Both touch `rearrange.js` in separate functions; the planner merges.

## Phase H: the window (after F and G merge)

- **H1.** Controller: `setBass(part, { density, lock, picks })`, `bassOf()`, `setVoicing('close' | 'led')`, with undo, store
  and `state.dropped` entries like the arp's. Re-compose keeps or drops them, listed under "Compose dropped".
- **H2.** The bass inspector: a Density select (Roots | Sparse | Moving | Walking), a Lands on switch (Free | Kick |
  Clave, Kick disabled with its reason while the drums are off), and the bar's runner-ups with audition, Keep and
  Revert, as the lead's. The chords inspector: Close | Led.
- **H3.** The trace caption says the voicing and the bass's density and lock. `index.html` cache-busts.
- **H4.** `tests/assert-page-bass.mjs`, the README's Files and Tests, a DESIGN_NOTES section for F, G and H, and the
  browser and rig checklist below finished.

## Amendment 1 (Avery, 2026-10-28): the frame clave, the bass's fills and locks, the loop closed

Avery's rulings on the build's open questions (the Log, 10-28):

5. **Walking fills what it can.** A bar Walking can't fill plays the fullest walk the bar allows, with rests only where
   no step fits, not a single root onset.
6. **The clave comes from the frame.** A stroke on a tone outside the chord's frame doesn't count. "The decomposition of
   a layer sequence based on tones that fit the current frame generates the claves automatically": a bar's clave is the
   clave layer's own strikes whose tones fit that bar's frame, so the pattern changes with the chord. Asked between
   three readings, Avery chose this one: the comp, the perc and the bass's Clave lock all play it.
7. **A lock covers its hits; the density adds the rest.** Lands on Kick: every kick gets a bass note, and Sparse and
   Moving decide whether any other notes play besides them. The same for Clave (asked: both locks).
8. **The loop's wrap is led like every other change.** The step from the last chord back to the first weighs the same as
   any bar line's.
9. **Roots offers runner-ups:** the other notes in the frame of the chord's actual root.

### The probe (2026-10-28): today's strokes, and the frame clave

Compose (seed 1), today's clave strokes against each bar's chord, then the clave read from the frame:

| row | today's clave | strokes in frame | strokes on chord tones | the frame clave: in-frame tones | chord tones only |
|---|---|--:|--:|---|---|
| 8:7:6:5 | `4:.xx.` | 1/4 | 1/4 | layer 8 at 4: `x.x.` `...x` (38 %) | the same |
| 11:9:7:5 | `5:...xx` | 1/4 | 1/4 | layer 9 at 5: `x...x` `x...x` (40 %) | layer 11 at 6: `xxx...` `x.....` (33 %) |
| 19:17:16:15 | `16:.......x....x.xx` | 5/8 | 2/8 | 63–88 %: nearly a pulse | layer 16 at 8: `x..x.x..` `.xx...x.` (38 %) |
| 7:5:3:2 | `3:.xx` | 2/2 | 2/2 | 60–100 % | 60–100 % |
| 119:42:15:8 | `8:...x..x.` | 8/8 | 6/8 | 92–100 %: a pulse | layer 15 at 4: `x.x.` `..xx` `..x.` `....` (31 %) |
| 768:769 | `4:..xx` | 1/8 | 0/8 | layer 768 at 8: `x....x..` `x....xxx` `x.......` `.....x..` (25 %) | mostly empty |
| 768:784 | `4:..xx` | 8/8 | 8/8 | layer 768 at 8: `.x.x.x.x` each bar (50 %) | the same at 3–12 |

- **Today's strokes aren't the clave layer's.** The clave is a fixed pattern from a generic tone set (claves.js' table),
  and each step lands on the nearest onset of any layer, whatever its tone: 7 of 768:769's 8 strokes are fringe.
- **Simple rows need the chord's tones; dense rows need the frame's.** On 19:17:16:15, 7:5:3:2 and 119:42:15:8 nearly
  every tone is in tune, so the in-frame strikes are close to a pulse. Limited to the bar's chord tones they have clave
  densities. On 768:769 almost no strike is a chord tone, but 30 % are in frame.
- **A dense layer is read at a grain.** 768:769's clave layer strikes 192 times a bar. At 8 steps a bar (each step the
  layer's strike at its place) the in-frame strikes are 25 %, a different pattern every bar.
- **Cheap.** Under 1 ms a row at the composition's grain (a layer's strikes, once a bar).

The scripts are in the planner's scratchpad (`frame-clave-probe*.mjs`), not the repo.

### Proposed (the builder's calls; Avery may overrule)

- **P16. The frame clave.** A candidate is a layer, a grain and a tone set:
  - **Grain:** n steps a bar. A layer striking m times a bar (3 ≤ m ≤ 16) is read at n = m, each strike a step; a
    denser layer at each n of 3–16. Step j of bar k is the layer's own strike nearest place k·S + j·S/n (ties: the
    earlier). A layer striking fewer than 3 times a bar offers nothing.
  - **Tone set:** `chord`, the strike's tone one of the bar's chord classes in tune (compose.js `chordClass`), or
    `frame`, inside the bar's frame (within ±`frameCentsEachSide` of its class from the bar's root). A chart's split
    bar reads each step under its span's chord.
  - **The pattern:** step j sounds when its strike's tone is in the set. The stroke is that strike, at its own time: no
    landing, so every stroke is the clave layer's and in frame.
  - **Ranking:** COMP_RULES over the bars' patterns, as now: density (1 inside 25–50 %), fit by n (straight, triplet,
    other), and recurrence (the bars whose pattern another bar repeats). A pulse bar or a bar under `minOnsets` scores as
    today's table leaves it out. Ties by the seed, as `chooseClave`.
  - **Fewer strokes:** a bar with no strokes is struck once on its root onset, as the comp does now.
- **P17. Fill.** The partner is the best-ranked frame candidate that shares no stroke with the clave (no onset within ¼
  slot of one of its strokes). With none, the old complement rule, Euclid-thinned to the clave's mean onsets a bar, each
  step landed only on an in-frame onset (P18's landing).
- **P18. Curated and asked claves.** Son, rumba, bossa and an asked `steps:pattern` keep their fixed pattern. A step
  lands only on an in-frame onset (`landPlace` over the in-frame onsets of the bar's frame; none in its window: silent),
  so rule 6 holds for them too.
- **P19. `claveFrom: 'frame' | 'pattern'`.** An override, `'frame'` by default. `'pattern'` is today's clave byte for
  byte, and the suites that freeze today's comp, perc or Clave lock are pinned with it, as `voicing: 'close'` pinned F.
- **P20. A chord swap.** It re-reads the swapped bar's (or span's) clave under its new frame, with the same layer, grain
  and set. The comp re-strums there, the perc follows, and the bass re-mines it under Clave. The audit lists the bar.
  `reclave` (the picker, Sync | Fill) is unchanged in shape, over the frame candidates.
- **P21. The words.** A frame clave is named by its source ("layer A · 8 steps · chord tones"), with each bar's pattern
  (`claveText` a bar), in the trace, the picker and the cell head.
- **P22. Walking fills what it can (rule 5).** A bar whose full walk mines nothing is mined again at W − 1, W − 2, … 2
  notes on its clock (stepwise, `maxGap` lifted, the approach to the next root kept). The first count that mines wins.
  Only with no stepwise line of 2 does the bar fall back to its root onset. The stats count `walkFill` bars and their
  notes. At most W ≤ 8 mines a failing bar.
- **P23. A lock covers its hits (rule 7).** It replaces P12's "only the locked onsets" and "shares are of the locked
  slots":
  - **Hits:** Kick, each kick hit (its onsets within ¼ slot, as now). Clave, each comp stroke (`compSourceOf`, now the
    frame clave's). Hits in one slot are one hit.
  - **Each hit gets a note:** on one of its onsets, in frame. A hit with no in-frame onset rests and is counted
    `missedHits` (rule 6's spirit; a frame clave's strokes are in frame by construction).
  - **Density adds the rest:** Sparse and Moving count the bar's whole line (hits included) against their band, at least
    the hits. On a backbeat (2 kicks, 8 slots), Sparse plays 2–3 (0–1 more) and Moving 3–5 (1–3 more). The extra notes
    are on any onset.
  - **Walking** fills every slot of its clock, the hits' slots on the hits.
  - **Roots** puts a root on every hit: the hit's root-class onset, else its chord-tone one, else the hit's own.
  - **The miner:** a new opt-in `requireNodes` rule in lines.js (a slot holding a hit keeps only that hit's candidates
    and must sound; other slots are free). `allowNodes` stays for anything else that wants it.
- **P24. Roots runner-ups (rule 9).** A chord's candidates are every root-class onset in frame in its windows (P11's
  test: class 0, within ±e of the root, so the other tones of the root's ±15¢ cluster and their other onsets count).
  They are ranked nearest the chord's first anchor, then earlier, then the lower node. A bar offers up to 8: the
  combinations of its chords' candidates, ranked by summed distance. Locked, a hit's candidates are its root-class
  onsets. The first is Roots' note as now.
- **P25. The loop closed (rule 8).** The voicing pass minimizes the whole loop in one objective: every chord-to-chord
  step, the last to the first included, each the same weight, plus `MUD_COST` a muddy pair.
  - **Method:** Viterbi over each chord's window assignments (the first chord's included). It runs once for each first
    chord state, adds the wrap, and keeps the cheapest cycle. Ties go to less mud, then the lower centre, then the first
    in order.
  - **The anchor:** the window stays centred on the first chord's close-lifted centre, so the register can't creep.
  - **Cost:** states are cut to those inside the centre window (about 20 a chord), so a 32-chord loop runs in a few
    milliseconds. The budget is ≤ 5 ms on the test rows and a 32-bar chart, measured.
  - **Edge cases:** a one-chord loop has no wrap. A MIDI target's cut loops its own bars.
  - **What it changes:** a swap (P8) re-runs the loop, so it may move octaves before the swapped bar too. The audit lists
    them. `'close'` is unchanged; the led fixtures move. The stats' `wrap` is now led, and `voicingWhy` says "the loop
    closed".

### Phase I: the frame clave

- **I1.** `claves.js`: the frame candidates (P16), their ranking and partners (P17), and the in-frame landing for curated
  and asked claves (P18). Pure, over the row, the cells and the chord records.
- **I2.** `compose.js`: the comp's clave chosen and laid from the frame (after the chords, which it now needs), and the
  `claveFrom` override (P19). The perc (drums.js) reads `spec.clave.strokes` as now, so it follows.
- **I3.** `rearrange.js`: a chord swap re-reads the bar's clave (P20). `reclave` runs over the frame candidates. The words
  (P21) go in the trace.
- **I4.** `tests/assert-frame-clave.mjs`, checked against a brute force written from this order: every stroke in frame
  (or on a chord tone, under `chord`); every stroke the clave layer's own strike at its step's place; the ranking; Fill
  sharing no stroke; a swap moving only its bar's strokes; `'pattern'` byte for byte today's. Existing suites pass with
  their pins.

### Phase J: the bass's fills, locks and Roots runner-ups

- **J1.** `lines.js`: the `requireNodes` rule (opt-in, so every other mine is unchanged).
- **J2.** `core/bass.js`: Walking's fill ladder (P22), the covering locks (P23), and Roots' runner-ups (P24). The default
  (Sparse, Free, no picks) is still Compose's bass byte for byte.
- **J3.** `tests/assert-bass.mjs` updated: every hit covered or counted missed; Sparse and Moving's totals at least the
  hits and within their band; the walk's fill count the most a brute force finds; Roots' alternates every in-frame
  root-class onset, ranked.

### Phase K: the loop closed

- **K1.** `compose.js` `voiceLead`: the cyclic objective (P25). `voicingStats` and `voicingWhy` updated.
- **K2.** `tests/assert-voicing.mjs`: its brute force over every cycle on small loops (N ≤ 4); the chosen cycle's cost
  equal to the brute force's least; the wrap counted; the timing budget held.

I, J and K can run in parallel. I touches claves.js, the comp's clave in compose.js and the swap's clave in rearrange.js.
J touches lines.js and bass.js. K touches `voiceLead` in compose.js. I and K meet only in compose.js, in separate
functions; the planner merges. J's Clave lock reads `compSourceOf` and needs nothing new from I. After I merges, the
planner re-runs J's suite on the frame strokes.

### Phase L: the window (after I, J and K merge)

- **L1.** The clave picker lists the frame candidates by source and score, with the curated ones ("lands in frame only").
  The Comping cell head shows the bar's own pattern.
- **L2.** The bass inspector: Roots' runner-ups in the existing list. A walk's fill ("walks 6 of 8: a rest where no step
  fits"). Under a lock, the hits covered, and missed ones in amber.
- **L3.** The voicing stats say the loop is closed. The trace captions follow I–K. `index.html` cache-busts.
- **L4.** The page suites updated, the README's Files and Tests, a DESIGN_NOTES section for I–L, and the checklist below
  revised for every changed item.

## Browser and rig checklist (for Avery; finished in H4)

Open the Partitions window's **Composer** tab, generate the rhythm on the main page, press **Compose**, then **Perform**.
Everything below is live: no button should go back to Compose, and the header's **↶** (⌘Z) undoes each change.

- **Voicing.** Click a cell in the **Chords** row. Under the cell's head: "voicing", **Close | Led** (Led on), and its
  stats beside it ("2 lifted · 240¢ a chord").
  - On 11:9:7:5, 119:42:15:8 and 768:769, while performing, flip to **Close**: you should hear the chords drop or jump
    about an octave at some bar lines. Back to **Led**: they move by small steps. The stats read "root position" in Close.
  - On 7:5:3:2 and 11:9:7:5, Led's lowest chord should no longer be a low, close third (Close brings it back).
  - ⌘Z after a flip goes back; the flip is one undo step. Compose again while Close: still Close (it sticks).
- **Comp with chords.** Under Led, select the **Comping** row: its strum should sit in the chords' register and move with
  them; flip Close | Led and the comp should follow the chords.
- **Bass densities.** Click a cell in the **Bass** row. A row reads "density [Sparse ▾]  lands on Free | Kick | Clave".
  - Pick each density on a sparse row (8:7:6:5) and a dense one (768:784): **Roots** one note a chord, on the change;
    **Sparse** as before; **Moving** busier; **Walking** a note every slot (8 a bar on 16-slot rows), stepping toward each
    next chord's root. The cell's head tag names it ("walking"). With **details** on, a line under the row counts the
    notes a bar, the bars rooted and the ones with a note on the one.
  - Roots says "no runner-ups to choose from". A bar Walking couldn't fill says it plays the chord's root onset.
- **Lock.** On the same Bass cell:
  - **Kick** with the default backbeat (or another layered drum mode): the bass should only sound with the kick.
  - Turn the drums **off** (click **Drums** among the inspector's parts, then its **on** toggle): Kick greys out and the line under the switch says "Kick: the
    drums are off: there is no kick to land on". If Kick was on, an amber line says it can't land now and the bass lands
    anywhere. Drums back on: Kick is clickable again.
  - **Clave:** the bass lands with the comp. Select the Comping row and flip **Sync | Fill**: the bass should follow the
    comp to the gaps.
- **Runner-ups.** On a Bass cell at Sparse or Moving, "Bass lines · bar N" lists up to 8 lines ("fall · mid", ● on the
  one playing, C the bar's best). While performing, click one: it comes in at the next bar line ("auditioning…"). Click
  it again or **Keep** to keep it; **Revert** (or Esc) takes it back. Then change the density and press ⌘Z once: the
  density and the kept line come back together.
- **Re-compose.** With a line kept, change the seed and change it back, then Compose: the density, lock and voicing stay; a
  kept line the new bar no longer offers is listed in the amber "Compose couldn't keep …" line (details: "a bass pick
  (bar N) was dropped").
- **Show the work.** With it on, Compose: the caption for the bass says its density and lock ("moving, on the comp's
  strokes: …") and the chords' says led or close.
- **MIDI.** On the rig, each chords and comp channel should glide by small steps under Led, and jump under Close.

## Later (recorded, not ruled)

- A root-on-the-one rule for Sparse and Moving (today 0/4 on two rows; Roots covers it).
- Voice-leading the inner voice against the chords.

## Log

- 2026-10-27: probe and rulings 1–4 (Avery). Order written; not yet committed or started.
- 2026-10-28: phase G (bass densities and the lock) merged 9c3d36a; phase F (voice-led chords) merged 29a987c; 81/0.
  The planner capped the mud limit at 16/15's 213 Hz (88764e1): uncapped, 768:769's first third (191/152, limit 400 Hz)
  lifted the chords to 722 Hz, over the lead's median of about 539 Hz; capped, they open at 361 Hz. Avery may overrule.
  Open for Avery (from the builders):
  - Walking that can't fill a slot (only foreign tones on a strong slot or at the end: 768:769 bars 1 and 3, 11:9:7:5
    bar 1) falls back to one root onset. Retry as a walk with rests (the arp's few-rests band, 60–95 %, `maxGap` 2)?
  - Roots offers its one line only. Offer the chord's other root-class onsets as runner-ups?
  - Clave on fringe-heavy rows (768:769, the 16k row): the strokes are mostly fringe tones no line may end on, so those
    bars play Roots at the lock, the stroke's own tone, fringe or not. Rest instead?
  - Kick with a backbeat (two kicks a bar) makes Sparse and Moving one note a bar, close to Roots. Intended?
  - The Clave lock rarely lands on the downbeat on the test rows (the strokes fall off the one): expected from the rule.
  - The loop's wrap is as large as a bar line's motion on some rows (11:9:7:5 680¢, 119:42:15:8 610¢). Close it?
  - 11:9:7:5 moves 782¢, not the nearest-octave 284¢: its second chord's least-motion voicing has a muddy 14/11 at
    159 Hz (limit 196 Hz). P1 as written.
- 2026-10-28: phase H (the window) merged; 82/0. ORDER COMPLETE. The voicing switch is live (`revoice`, byte for byte a
  Compose given `voicing`); the live bass runs on the main thread up to the 16k row (≤ 14 ms a change, 24 ms the first
  runner-up list) and in the worker above. Open for Avery (from the builder): should a density or lock change audition
  at the barline like a runner-up (today it applies at once, like the arp's Time)? Name the density on the part strip
  ("Bass · walking", as "· arp")? Should a chord swap drop a stale bass pick at once (today it stays, marked amber, until
  undo or a re-compose)? The browser and rig checklist above is final.
- 2026-10-28: Avery's rulings 5–9 on the open questions (Walking fills what it can; the clave comes from the frame, the
  comp, the perc and the bass's Clave lock all playing it; a lock covers its hits and the density adds the rest, for Kick
  and Clave; the loop's wrap led like every change; Roots offers the root's other in-frame notes). Probe and Amendment 1
  (P16–P25, phases I ∥ J ∥ K, then L) written; not yet committed or started. Still unruled: a density or lock change at
  the barline, "Bass · walking" on the strip, a stale pick after a chord swap, 11:9:7:5's 782¢.
- 2026-10-28: Amendment 1 committed c009aaa. Phase J (bass/fills) merged 5c0d5e5, phase K (voicing/loop) merged 74e6b22,
  phase I (clave/frame) merged b474832; 83/0 (`assert-frame-clave.mjs` new). Merged, the bass's Clave lock covers every
  frame stroke on the probe rows (768:769: 10 of 10, from 1 of 8). The loop closed: 11:9:7:5's 782¢ is now 284¢ at the
  bar line and the wrap; 119:42:15:8's wrap 610 → 112¢; the 16k row sits about 500¢ higher. Builders' calls beyond the
  order are in DESIGN_NOTES (phases I, J, K). Open for Avery (from the builders):
  - Frame clave: rows whose every tone is in tune read near-pulses (16:12:9's best scores 0.375, 15 strokes in 2 bars).
    Give way under a floor (say 0.5) to the pattern clave, or to a curated one landed in frame?
  - A Fill partner can leave a bar empty (19:17:16:15 bar 2 plays its root onset). Require a stroke in every bar?
  - Dense-row ties (the 16k row: 4 candidates at 0.656, the seed picks): prefer the chord set, or the straighter grain?
  - A missed hit's slot rests outright; or may the density put an extra on that slot's other onsets?
  - A mined hit sounds on its 12 nearest in-frame onsets (the budget); Roots reads all of them.
  - A locked bar with no hit uses the covering band (Sparse 2–3 of 8, Free's 2–2): a lock can change a bar with no kick.
  - On Walking's halved clock, two kicks in neighbouring 16ths are one hit.
  - The loop's ties go to the cycle nearest the anchor (the order said "lower centre", which sank whole loops 400¢ and
    undid the mud cap on 768:769). Keep?
  - The 16k row rises about 500¢ under the closed loop. Should the anchor pull harder (a cost a cent off its centre)?
  - `meanMotion` now averages the loop's changes, the wrap included.
  Phase L (the window) next.
