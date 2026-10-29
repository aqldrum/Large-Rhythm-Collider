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

## Amendment 2 (Avery, 2026-10-28, after the first browser look): comp density tiers, the bass's default, the picker re-ranked

Avery's rulings:

10. **The comp has density tiers, and defaults to sparse–medium.** Dense rows whose every tone is in tune fill every
    step, so the comp looks for its clave by tier and defaults to sparse–medium. The frame claves themselves "are really
    good".
11. **The bass defaults to Moving, landing on the Kick.**
12. **Roots' runner-ups are named by their cents off the root.**
13. **New chords are voiced with the current setting.** Chords solved by Chords Follow (or any other way) take the
    current Close | Led.
14. **The clave picker re-ranks when the chords change.**

### The probe (2026-10-28): the clave's density under narrower tone sets

Phase I's sets are `frame` (any in-tune tone) and `chord` (the chord's classes in tune). Three narrower ones are still
inside the frame, so rule 6 holds: `root+5th`, `guide` (the chord's classes other than its root and fifth) and `root`.
Counted at the clave's grains (seed 1; a candidate's density is its strokes over its steps):

| row | sparse (< 25 %) | medium (25–50 %) | dense (> 50 %) | medium, for example |
|---|--:|--:|--:|---|
| 16:12:9 | 2 | 2 | 10 | layer 16 at 8, guide 25 %; root 44 % |
| 7:5:3:2 | 0 | 3 | 8 | layer 7 at 7, guide 29 %; root 43 % |
| 19:17:16:15 | 5 | 6 | 4 | layer 19 at 10, chord 50 %; root+5th 30 % |
| 119:42:15:8 | 3 | 7 | 23 | layer 119 at 4, root 44 % |
| 8:7:6:5 | 0 | 8 | 3 | layer 8 at 4, frame / chord / root+5th 38 % |
| 11:9:7:5 | 3 | 6 | 3 | layer 11 at 6, chord 33 % |
| 768:769 | 27 | 12 | 0 | layer 768 at 3, frame 33 % |
| 768:784 | 7 | 28 | 11 | layer 768 at 3, frame / chord / guide 33 % |

With the narrower sets, every row has a medium candidate. The all-in-tune rows (16:12:9, 7:5:3:2, 119:42:15:8) have
few of them and many dense ones. The script is in the planner's scratchpad (`comp-tiers-probe.mjs`).

### The bug (fixed by the planner, 2026-10-28)

A runner-up line held for the bar boundary (performing) read "chords follow" when it was clicked, not when it landed, so
a follow pressed while it waited was lost: the line landed with the chords kept. `composer-tab.js` now reads the follow
when the line lands; `assert-page-matrix.mjs` checks it. The core voices new chords with the current setting already
(rearrange.js runs the voicing pass on every chord edit and lead follow of a led spec; a close spec stays close), so
rule 13 asks for a check, not new code (P32).

### Proposed (the builder's calls; Avery may overrule)

- **P26. The narrower sets.** Phase I's candidates gain `root+5th`, `guide` and `root`, each read and ranked as P16
  reads `frame` and `chord`. A set whose reading equals a wider set's at the same layer and grain is dropped, keeping
  the wider set's name (P16's rule). Their words: "root and fifth", "guide tones", "roots".
- **P27. The tiers.** A candidate's density is its strokes over its steps, over the bars.
  - **Sparse:** 10–25 %.
  - **Medium:** 25–50 %.
  - **Dense:** 50–85 %.
  - Under 10 % or a pulse is no tier.
  - **The comp's density:** a new override `compDensity: 'sparse-med' | 'sparse' | 'medium' | 'dense'`, `'sparse-med'`
    by default (10–50 %).
  - **The choice:** inside the asked tier, the candidates rank by COMP_RULES as now, the density term read against the
    tier's own band. With no candidate in the tier, the nearest tier's best plays, and the trace says so.
  - **Pins:** `claveFrom: 'pattern'` is unchanged (its fixed claves have no tier). The phase I suites that pin frame
    results are pinned with `compDensity` at the tier that reproduces them, or updated with a reason.
- **P28. The bass's default (rule 11).** Compose's bass is Moving · Kick (`arrangeBass` P23, covering the kick). With the
  drums off, or no kick in the mode, it is Moving · Free, and says why (`bassLockRefusal`).
  - A new override `bass: { density, lock }` pins it. The suites that freeze Compose's bass (and the identity fixtures)
    are pinned with `bass: { density: 'sparse', lock: 'free' }`, the old default byte for byte.
  - The window's bass controls read Compose's arrangement as their default. A change and an undo work as now.
- **P29. Roots' names (rule 12).** A Roots runner-up is named by its tone's cents off the chord's root, signed and to a
  tenth, then its slot: "root +3.2¢ · slot 3" (an exact root: "root · slot 3"). Its ratio goes in the title.
- **P30. The picker re-ranked (rule 14).** A chord edit, a lead follow, a chart edit or a re-read changes the frames, so
  the frame candidates are re-ranked over the chords as they play.
  - **Where:** rearrange.js returns `claveAlternates` (the ranked list `claveAlternates` gives Compose) when any chord
    changed. The controller keeps the latest, and the picker reads it instead of the trace's.
  - **Cost:** about 3.5 ms on the 16k row (phase I's ranking), in the worker above it, as the rest of the edit.
  - **What plays:** unchanged. The playing clave keeps its layer, grain and set, re-read (P20). A re-rank never switches
    it.
- **P31. The comp's caption** says the clave as it plays: a picked clave, the tier, and the re-read bars.
- **P32. New chords voiced (rule 13).** Checks that a lead follow, a chord swap and a typed chord each voice their new
  chords as the current setting does: Led, the voicing pass's output (the loop closed); Close, root position. Each is
  live, before and after a Close | Led flip, against a Compose given the same edits.

### Phase M: the core

- **M1.** `claves.js`: the narrower sets (P26), the tiers and `compDensity` (P27). `compose.js`: `compDensity` as an
  override, the comp's tier in the trace.
- **M2.** `compose.js` and `bass.js`: Compose's bass at Moving · Kick, the `bass` override (P28).
- **M3.** `rearrange.js`: the re-ranked alternates on a chord change (P30). `reclave` and the swap paths read the tier.
- **M4.** Tests:
  - `assert-frame-clave.mjs`: the sets and tiers against its brute force; every stroke still in frame; the nearest-tier
    fallback; the re-ranked alternates equal to a Compose over the edited chords.
  - `assert-bass.mjs`: Compose's default at Moving · Kick; the fallback with drums off; the pin byte for byte.
  - The P32 checks.
  - The pins as P27–P28 say.

### Phase N: the window (after M merges)

- **N1.** The Comping inspector: a Density select (Sparse–Med | Sparse | Medium | Dense). It is live, `reclave` over the
  tier, one undo step. The picker lists the tier's candidates, re-ranked after a chord change (P30).
- **N2.** The bass inspector opens at Compose's Moving · Kick. Roots' runner-ups are named by cents (P29).
- **N3.** The comp's caption (P31). The page suites, the README, a DESIGN_NOTES section for M–N, and the checklist
  revised: the comp's tiers on 16:12:9 and 768:784, the bass's default with drums on and off, Roots' cents, the picker
  after a Chords Follow.

## Amendment 3 (Avery, 2026-10-28): the comp's tolerance, single notes back, sparser ties

Avery's rulings:

15. **The comp has a tolerance.** It sets how far around a clave stroke (the rhythm anchor) an onset may sound and still
    count as part of that stroke's chord. Finding onsets close enough together to sound like a comped chord takes a very
    dense row, so the allowance is a setting.
16. **Single-note comping comes back naturally.** When the row can't source enough tuned onsets inside a stroke's window,
    the stroke plays what the row has there, down to a single note, as the comp began.
17. **A sparser clave wins a tie.** Among frame claves that score the same, the one with fewer strokes plays.

Also ruled: Moving · Kick being thin on small rows is fine ("small rows are thin"). The two questions Avery couldn't
answer keep the builders' behaviour (the planner's call):
- the window re-arranges the bass over its own drums, rather than a re-compose taking the window's drum options (the
  sound is the same);
- a density change drops a clave picked from the list, and one undo restores both.

### The probe (2026-10-28): real tones a stroke, with no borrowing

Today a stroke takes each chord class's nearest in-tune onset within ±¼ slot, and borrows any class it doesn't find from
the chord voices, so every stroke sounds full. Without borrowing (seed 1, the default clave): a stroke's tones are its
own onset plus each chord class found in its window, and "full" means every class of the chord, up to 4.

| row | strokes | ±⅛ slot | ±¼ (today's window) | ±½ | ±1 |
|---|--:|---|---|---|---|
| 8:7:6:5 | 3 | 1.0 tones, 100 % single | 1.7, 33 % single | 2.0, 0 % single | 2.7, 67 % full |
| 11:9:7:5 | 4 | 1.0, 100 % single | 1.0, 100 % single | 1.0, 100 % single | 1.8, 25 % single |
| 16:12:9 | 4 | 1.0, 100 % single | 1.5, 50 % single | 2.3, 25 % full | 2.5, 50 % full |
| 7:5:3:2 | 2 | 1.0, 100 % single | 1.5, 50 % single | 3.0, 100 % full | 3.0, 100 % full |
| 19:17:16:15 | 6 | 1.5, 50 % single | 1.5, 50 % single | 1.7, 33 % single | 2.3, 50 % full |
| 119:42:15:8 | 14 | 1.0, 100 % single | 1.0, 100 % single | 1.1, 93 % single | 2.3, 29 % full |
| 768:769 | 10 | 1.3, 70 % single | 1.6, 50 % single | 2.1, 10 % full | 2.4, 30 % full |
| 768:784 | 16 | 3.0, 25 % full | 3.0, 25 % full | 3.8, 100 % full | 3.8, 100 % full |

At today's ±¼, most rows find 1–1.7 real tones a stroke, and borrowed tones make up the rest. At ±½ to ±1, most rows
gather 2–3. The script is in the planner's scratchpad (`comp-tolerance-probe.mjs`).

### Proposed (the builder's calls; Avery may overrule)

- **P33. The tolerance.** A new override, `compTolerance`, in slots either side of the stroke: `0.125 | 0.25 | 0.5 | 1`,
  **0.5 by default** (proposed: the probe's knee). It replaces STRUM_WINDOW's fixed ¼.
  - The window stays inside the bar (a split bar's span), as now.
  - Each tone sounds at its own time and holds to the next stroke, as now.
  - At ±1 slot a strum can spread across two slots: a rolled chord, not an arpeggio, since every tone holds to the next
    stroke.
- **P34. No borrowing by default (rule 16).** A stroke plays only the chord tones the row sounds inside its window: its
  own onset, plus each other chord class's onset nearest it (ties as now), up to 4 voices.
  - If it finds nothing else, the stroke is a single note.
  - A stroke on a frame-set tone that is no chord class still plays its own onset, alone or with what it finds.
  - Borrowing stays as an option, `compBorrow: true` ("fill from the chords"): today's full-chord comp.
  - **Pins:** `compBorrow: true` with `compTolerance: 0.25` is today's output byte for byte, and the suites that freeze
    the comp are pinned with it.
- **P35. The voicing.**
  - Under Led, a found tone takes the octave nearest its class's chord voice (P5, as now).
  - Under Close, it is stacked from an octave under the root (as now).
  - A single note sits in the chords' register.
- **P36. The stats and words.**
  - The comp's decision and caption say the tolerance and what it found: "±½ slot: 2.1 tones a stroke, 30 % single
    notes".
  - `compStrum` keeps its meaning (the share of chord tones from the row), which is 1 by construction with no borrowing.
  - New: `compTones` (mean tones a stroke) and `compSingles` (the share of single-note strokes).
- **P37. Live.** A tolerance or borrow change re-strums only the comp, through a `restrum` door in rearrange.js like
  `reclave`.
  - Byte for byte a Compose given the same overrides; one undo step; kept across a re-compose.
  - A chord swap re-strums its bar at the setting.
  - The bass's Clave lock and the perc read the strokes, which don't move.
- **P38. Sparser ties (rule 17).** In `rankFrameClaves`, candidates whose scores tie (within EPS) order by share, the
  lower first, then as now (the seed). Only the tie order changes; the pins hold where the seed broke no tie.

### Phase O: the comp's tolerance (core, then the window; one builder)

- **O1.** `compose.js`: `compTolerance` and `compBorrow` (P33–P34), the voicing (P35), the stats and words (P36).
  `claves.js`: the tie order (P38).
- **O2.** `rearrange.js`: `restrum` (P37); a chord swap re-strums its bar at the setting.
- **O3.** The window:
  - In the Comping inspector, a Tolerance select (±⅛ | ±¼ | ±½ | ±1 slot) and a "fill from the chords" toggle, both
    live, each one undo step, kept across a re-compose.
  - Beside them, "2.1 tones a stroke · 30 % single".
  - The comp cell's dots show what plays.
  - The MIDI comp zone sends what plays (fewer notes when the row has fewer).
- **O4.** Tests:
  - A new or extended suite, checked against a brute force written from this order:
    - every comp tone a row onset inside its stroke's window (no borrowed tone unless asked);
    - a stroke with no other chord tone in its window a single note;
    - the stats;
    - `restrum` equal to a Compose;
    - the pin byte for byte.
  - The tie order and the page suites.
  - The README, DESIGN_NOTES and the checklist: the tolerance on 119:42:15:8 and 768:784, single notes on 11:9:7:5, and
    borrowing on and off.

## Browser and rig checklist (for Avery; finished in H4, rewritten in L4 for the whole order and Amendment 1, revised in N3 for Amendment 2)

Open the Partitions window's **Composer** tab, generate the rhythm on the main page, press **Compose**, then **Perform**.
Everything below is live: no button should go back to Compose, and the header's **↶** (⌘Z) undoes each change. Turn on
the header's **details** toggle where an item says "Details". Seed 1 unless an item says otherwise; the exact patterns
and counts depend on the cycle, so read them as what to look for, not as the only right answer. Since Amendment 2 the
bass opens at **Moving · Kick** (Compose's own) and the comp at **Sparse–Med**; an item that needs another setting says so.

- **Voicing, the loop closed.** Click a cell in the **Chords** row. Under the cell's head: "voicing", **Close | Led**
  (Led on), and its stats beside it, ending "· loop closed" ("1 lifted · 311¢ a change · loop closed" on 768:769).
  Hover the row: its title says "led, the loop closed", and gives the bar lines' motion and "the wrap back to the first
  chord …¢ (led, as every change)". Nothing should say "not led".
  - On 11:9:7:5, 119:42:15:8 and 768:769, while performing, flip to **Close**: you should hear the chords drop or jump
    about an octave at some bar lines. Back to **Led**: they move by small steps. The stats read "root position" in Close.
  - Listen across the loop's end (the last bar back to bar 1) under Led: on 11:9:7:5 and 119:42:15:8 that step should
    now be as small as the other bar lines (11:9:7:5's wrap was 680¢ and is about 284¢; 119:42:15:8's 610¢ is about 112¢).
  - On 7:5:3:2 (one chord) the stats read "… lifted · one chord".
  - On 7:5:3:2 and 11:9:7:5, Led's lowest chord should no longer be a low, close third (Close brings it back).
  - ⌘Z after a flip goes back; the flip is one undo step. Compose again while Close: still Close (it sticks).
- **Comp with chords.** Under Led, select the **Comping** row: its strum should sit in the chords' register and move with
  them; flip Close | Led and the comp should follow the chords.
- **The frame clave, 768:769.** Compose 768:769 and click a **Comping** cell.
  - The clave line reads a source like "layer B · 6 steps · tones in frame", with every bar's pattern beside it in
    monospace (four groups, each different: "xxx... .x..x. ..xx.. xxx..."). Before Amendment 1 it was one fixed pattern
    ("4:..xx") whose strokes were mostly fringe tones; now every stroke is the clave layer's own and in frame.
  - The cell's head shows that bar's own pattern after "Bar N · Comping". Click Comping cells in bars 1–4: the head's
    pattern changes from bar to bar with the chord.
  - Flip **Fill**: the head adds "fill" and the partner's pattern for the bar, and the comp should strike the clave's
    gaps while the perc keeps the clave. **Sync** brings it back.
  - With **details** on, the line under it reads "score … · under the tones in frame · Fill strikes …".
- **The frame clave, 19:17:16:15.** Compose 19:17:16:15 and click a **Comping** cell. Here nearly every tone is in tune, so
  the chosen clave should read "… · chord tones" (a "tones in frame" reading would be close to a pulse). Its strokes
  should sound like a clave, with gaps, not a strum on every step. Compare 768:769, whose clave reads "tones in frame".
- **The clave picker.** On the same Comping cell, under the clave line:
  - The claves to choose from are the frame's, those in the density's tier (Sparse–Med by default): each named by its source ("layer A · 16 steps · tones in frame") with its
    score beside it in green, best first; ● on the one playing, C on Compose's. With **details** on, each shows its bars'
    patterns too.
  - After them come **son**, **rumba** and **bossa** (dashed borders), each tagged "lands in frame only": their fixed
    steps land only on onsets in frame, and a step with none is silent.
  - While performing, click a frame clave: it comes in at the next bar line ("auditioning…"); the comp, the perc and the
    head's pattern change. Click it again or **Keep** to keep it ("chosen" on the line); **Revert** (or Esc) takes it back.
- **The comp's density, 16:12:9** (Amendment 2, rule 10). Compose 16:12:9 and click a **Comping** cell.
  - Under the clave line: "density **[Sparse–Med ▾]**" and beside it "25 % of its steps (medium)". The clave reads "layer
    A · 8 steps · guide tones" (`...xx... x......x`): 4 strokes in 2 bars. Before Amendment 2 this row struck 15 times in
    2 bars, close to a pulse; you should now hear a comp with gaps.
  - Pick **Sparse**: the line turns amber, "no clave in the sparse tier, so the nearest: medium (25–50 %) · 25 % of its
    steps (medium)". Nothing should change in the sound (this row has no sparse clave, so the same one plays).
  - Pick **Dense**: "69 % of its steps (dense)", the clave "layer A · 8 steps · root and fifth". The comp should strike
    nearly every step. The list under it now holds the dense claves only. ⌘Z goes back to Sparse, then Sparse–Med, one
    step each, nothing composed.
- **The comp's density, 768:784.** Compose 768:784 and click a **Comping** cell. The default reads about "50 % of its steps
  (medium)" (`x.x.x.x.` each bar).
  - Step through **Sparse**, **Medium** and **Dense** while performing. Each changes the comp and the perc at once, with no
    Compose. Sparse should sound clearly thinner, Dense busier, and none should fall back (no amber).
  - Leave it on **Dense**, change the seed and back, then **Compose**: the select still reads Dense, and the same clave
    plays.
  - Pick a clave from the list, then change the density: the pick goes (the new tier's best plays; Sync | Fill stays).
    One ⌘Z brings back both the density and the pick.
  - With **Show the work** on, Compose: the comp's caption ends with the tier ("…; the dense (50–85 %) tier"). A clave
    picked in the list says ", picked in the window".
- **The picker after a Chords Follow** (rule 14). On 768:769, click a **Lead** cell, turn on **chords follow**, and click one of
  the phrase's other lines (while performing it lands at the next bar line; then **Keep**). Click a **Comping** cell.
  - The frame claves' order and scores should differ from before (⌘Z and compare). With **details** on, the legend adds
    "ranked again over the chords as they play".
  - ● stays on Compose's clave (C). The list re-ranks, and what plays is only re-read under the new chords, never switched.
  - The same after a chord swap (a **Chords** cell's other chord) and after a typed chord in the field. ⌘Z brings back the
    list as composed.
- **A chord swap re-reads the clave.** On 768:769, click a cell in the **Chords** row and click one of its other chords
  (an alternate). The note under the list should say "… · the clave re-read in bar N (its new frame)" (not every swap
  moves a stroke: if it doesn't say so, try another chord or bar). Click the
  **Comping** cell of that bar: its head shows the bar's clave read under the new chord (the shape can stay; the strokes
  move to that chord's in-frame strikes), and you should hear the comp and the perc there change with it. With **Show
  the work** on, the comp's caption says "…, re-read in bar N (a new chord)". **Revert** puts the old chord, clave and
  all, back.
- **The bass's default, the drums on** (rule 11). Compose any row and click a cell in the **Bass** row. It opens at
  "density **[Moving ▾]**  lands on Free | **Kick** | Clave", Kick lit. The head's tag reads "moving · covers the kick",
  and the bar says "covers 2 of 2 kicks". You should hear a bass note with every kick, and a few more between them.
  - On 8:7:6:5 one bar reads "covers 1 of 2 kicks · 1 missed (slot N): no onset in frame there, so it rests", the
    missed part in amber. That kick should sound with no bass note.
  - Pick **Sparse**, then click **Free**: that's the bass from before Amendment 2. Click **Moving**, then **Kick**:
    Compose's own again.
- **The bass's default, the drums off or in another mode.** With the bass at Compose's own (Moving · Kick):
  - Turn the drums **off** (the **Drums** lane's **on** toggle). The bass cell turns amber: "Kick can't land now (the drums
    are off: there is no kick to land on), so the bass lands anywhere". Kick greys out. The bass keeps playing, now
    Moving · Free. Drums **on**: the amber goes, and the bass is Compose's again.
  - Leave them off and **Compose** again (the seed changed and back): the same amber line. The bass doesn't cover a kick
    that doesn't play.
  - Drums on, click a **Drums** cell and pick the preset **four** (four on the floor). The bass cell says "Compose's own,
    arranged again over the kick as the drums play now", and each bar counts 4 kicks ("covers 3 of 4 kicks …" where one
    has no onset in frame). You should hear the bass land on the four. Back to **backbeat**: the line goes, and it's
    Compose's bass again.
- **Bass densities.** On a Bass cell, pick each density on a sparse row (8:7:6:5) and a dense one (768:784), with **Free**
  clicked so the kick doesn't shape them: **Roots** one note a chord, on the change; **Sparse** as before Amendment 2;
  **Moving** busier; **Walking** a note every slot (8 a bar on 16-slot rows), stepping toward each next chord's root. The
  cell's head tag names it ("walking"). With **details** on, a line under the row counts the notes a bar, the bars rooted
  and the ones with a note on the one.
- **Walking fills what it can.** On 768:769 pick **Walking** and click **Free**, then click Bass cells bar by bar. A bar that can't walk every
  slot (bars 1 and 3 here) says "walks 6 of 8: a rest where no step fits" (or 5 or 7): you should hear a walk with one or
  two rests, not a single root note. A bar that walks full shows no such line. With **details** on, the stats end
  "· 2 walk what they can".
- **Roots and its runner-ups, by cents.** Pick **Roots** on 768:769, click **Free**, and click Bass cells. "Bass lines · bar N"
  lists the root's other notes in frame, each named by its cents off the chord's root and its slot (rule 12): "root
  +5.1¢ · slot 3", or "root · slot 1" for an exact root. ● and C mark Roots' own. Hover one: its title gives the tone
  ("769/768 at slot 1, +…¢ off its chord's root"). Bar 2 offers several; a bar with one only lists it.
  - With **Kick** on instead, Roots plays a root on every kick. A kick with no root in frame plays a chord tone, named
    like "+498.0¢ off the root · slot 5".
  - While performing, click one: it comes in at the next bar line, and you should hear the bass note shift slightly in
    time or tuning (by about the cents it names). Click it again or **Keep**; **Revert** (or Esc) takes it back. With
    **details** on, each shows how far it sits off the change.
- **Lands on Kick: it covers the kick.** On the same Bass cell, with the default backbeat:
  - Hover **Kick** (on by default): its title reads "covers the kick: every kick gets a note, and the density adds the
    rest".
  - With Kick on, pick **Sparse** and **Walking** in turn. Every kick should keep its bass note, and the density adds
    notes between the kicks (on a backbeat's 8 slots, Sparse plays 2–3 a bar, Moving 3–5). Walking still walks, its notes
    on the kicks. The head's tag names the density ("sparse · covers the kick").
  - Click **Free**, then turn the drums **off**: Kick greys out, and the line under the switch says "Kick: the drums are
    off: there is no kick to land on". Drums back on: Kick is clickable again.
- **Lands on Clave: it covers the comp's strokes.** Click **Clave** (its title: "covers the comp's strokes … every stroke
  gets a note, and the density adds the rest"). On 768:769 every Bass cell should say "covers N of N strokes" with
  nothing in amber (all 10 frame strokes covered; before Amendment 1 only 1 of 8 landed), and the bass should sound with
  every comp stroke, plus the density's extra notes. Select the Comping row and flip **Sync | Fill**: the bass should
  follow the comp to the gaps.
- **Runner-ups.** On a Bass cell at Sparse or Moving, "Bass lines · bar N" lists up to 8 lines ("fall · mid", ● on the
  one playing, C the bar's best). While performing, click one: it comes in at the next bar line ("auditioning…"). Click
  it again or **Keep** to keep it; **Revert** (or Esc) takes it back. Then change the density and press ⌘Z once: the
  density and the kept line come back together.
- **Re-compose.** With a line kept, change the seed and change it back, then Compose: the density, lock and voicing stay; a
  kept line the new bar no longer offers is listed in the amber "Compose couldn't keep …" line (details: "a bass pick
  (bar N) was dropped"). A chosen frame clave the new composition doesn't list is named there by its source: "the chosen
  clave (layer B · 3 steps · chord tones, from the frame) was dropped".
- **Show the work.** With it on, Compose: the caption for the comp reads "the clave from the frame, layer … (its bars'
  patterns): N strokes, every one in frame; the sparse–medium (10–50 %) tier". The bass's says its density and lock, by
  default "moving, covering the kick (N of M hits …): …" (under Clave, "moving, covering the comp's strokes (10 of 10
  hits): …"; "… bars walk what they can" under Walking). The chords' says "led round the closed loop: …
  the wrap back to the first chord …¢" (or "close: root position …").
- **MIDI.** On the rig, each chords and comp channel should glide by small steps under Led, and jump under Close, the
  loop's end included. Under the Clave lock, the bass channel's notes should land with the comp channel's strokes.

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
- 2026-10-28: phase L (the window) merged 69c3f7e; 83/0. AMENDMENT 1 COMPLETE. The browser and rig checklist above is
  rewritten for the whole order and Amendment 1. Open for Avery (from the builder): re-rank the picker's frame claves
  after a chord swap (today the list shows Compose's patterns; what plays is re-read)? Name Roots' runner-ups by cents
  off the root rather than by ratio? Should the comp's caption say the clave as it plays (today Compose's, as phase E)?
- 2026-10-28: Avery's first look. Rulings 10–14 (comp density tiers defaulting to sparse–medium; the bass's default
  Moving · Kick; Roots' runner-ups by cents off the root; new chords voiced with the current setting; the picker
  re-ranked on a chord change). The planner fixed a held line losing "chords follow" (composer-tab.js; a check in
  assert-page-matrix.mjs). Probe and Amendment 2 (P26–P32, phase M then N) written; not yet committed or started.
- 2026-10-28: Amendment 2 committed f949cf7 (the held-follow fix f69d525). Phase M (core) merged 04445c8; phase N (the
  window) merged 196ad45; 83/0 (the wall-clock budgets pass alone; they missed in the parallel run with Chrome busy, and
  timed the same before and after N). AMENDMENT 2 COMPLETE. Every probe row's default comp lands in medium, none fell
  back; 16:12:9 plays 4 guide-tone strokes in 2 bars (15 before). Compose's bass is Moving · Kick, covering the kick that
  PLAYS (the planner's call: the window re-arranges it when its drums differ, Moving · Free with the drums off). The
  checklist above is revised. Open for Avery (from the builders):
  - Default claves often sit right at 50 % (768:784 plays `x.x.x.x.`, score 1.0): prefer the sparser on a tie, or count
    exactly 50 % as dense?
  - Moving · Kick is thin on small rows (8:7:6:5, 11:9:7:5: a kick in four has no onset in frame, so 1.5–2 notes a bar),
    and four on the floor misses 5 of 16 kicks on 41:42:43. Too thin?
  - The fifth of a dim or aug chord is its own (6 or 8 semitones) in the root+5th set. Right?
  - Should a re-compose take the window's drum options, so Compose covers that kick itself?
  - A density change drops a clave picked from the list (one undo restores both). Keep it instead?
- 2026-10-28: Avery's rulings 15–17 (the comp's tolerance around a clave stroke; single-note comping back where the row
  can't source enough; a sparser clave wins a tie) and his closing of the open questions (thin Moving · Kick on small rows
  is fine; the two he couldn't answer keep the builders' behaviour). Probe and Amendment 3 (P33–P38, phase O) written;
  not yet committed or started. After it, the next thread: arrangement choices and longer forms (layering parts and
  toggling them on and off).
