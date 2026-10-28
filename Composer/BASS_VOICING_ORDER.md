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

## Browser and rig checklist (for Avery; to be finished in H4)

- **Voicing.** On 11:9:7:5, 119:42:15:8 and 768:769, Led should stop the chords lurching by an octave at bar lines;
  flip to Close to hear the old jump. On 7:5:3:2 and 11:9:7:5 the lowest chord should no longer be a low, close third.
- **Comp with chords.** The comp's strum should sit in the chords' register and follow the same voicing.
- **Bass densities.** Each density on a sparse row (8:7:6:5) and a dense one (768:784): Roots one note a chord, Walking
  every slot (8 a bar on 16-slot rows), approaching each change.
- **Lock.** Kick with a layered drum mode: the bass only with the kick. Clave: the bass with the comp; flip Sync | Fill
  and it follows. Drums off: Kick disabled with its reason.
- **Runner-ups.** Audition a bar's bass alternates, Keep and Revert; change density and undo.
- **MIDI.** On the rig, each chords and comp channel should glide by small steps under Led.

## Later (recorded, not ruled)

- Closing the loop's wrap in the voicing pass (P4).
- A root-on-the-one rule for Sparse and Moving (today 0/4 on two rows; Roots covers it).
- Voice-leading the inner voice against the chords.

## Log

- 2026-10-27: probe and rulings 1–4 (Avery). Order written; not yet committed or started.
