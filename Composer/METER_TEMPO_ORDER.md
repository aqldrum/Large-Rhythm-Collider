# The meter from the layers, the tempo from the density (order, 2026-11-10)

Avery: the default song almost always picks 4 bars × 8 slots, and its tempo is keyed on the master Cycle Time, which
nobody changes before pressing Compose. Compose should look at the layers' factors and choose other meters too:
ternary 6, 9, 12, 15, odd meters now and then. And it should come up with its own tempo from a goal onset density of
the composition per second, with a little seeded variation in that band.

Before: `chooseMeter` picked the bar count N ∈ {1, 2, 4, 8} whose tempo 60·N·4 / T came nearest 110 BPM inside
90–130, then S = 8 slots, stepping down 6, 4, 3 only when the row was too sparse. Every bar was 4 beats, the drums
cut every S into 4 beats, MIDI wrote 4/4. The tempo was the cycle's.

## Decided (Avery, 2026-11-10)

1. **Factor-led meter, odd rare.** 8 / 16 / 4 are the base. 6 / 9 / 12 / 15 get a strong lift when a layer carries a
   factor of 3. 5 / 7 only when a layer carries 5 or 7, and at low odds. A seeded draw, so a new seed may change the
   meter. The Bars and Slots knobs still override.
2. **Beats from the meter.** 6 → 2 dotted beats (6/8), 9 → 3, 12 → 4, 15 → 5; 5 → 2 + 3, 7 → 2 + 2 + 3. The drums cut
   that many beats, the BPM counts those beats, MIDI writes the matching time signature.
3. **The density is every attack, 5–8 a second** (widened from 4–6 on 2026-11-11, Avery). Every distinct attack time
   over the parts and the drums. The goal is drawn by the seed from 5–8 a second, the tempo clamped to 70–150 BPM.
4. **Measure the finished piece.** The tempo comes from the composition's actual attacks after composing. The comp's
   25 ms gate is laid before the parts exist, at a provisional tempo estimated from the meter; the readout shows the
   gate as heard.

## Proposed (the builder's calls; Avery may overrule)

- **P1 The candidates.** S ∈ {8, 16, 4, 12, 6, 9, 15, 3, 5, 7}, N ∈ {4, 2, 8, 1}; every candidate keeps at least 3
  onsets a slot (as before) and at most 64 slots in all. Under 3 slots (a very sparse row) nothing changes: 2 or 1
  slots a bar, 4 beats on sub-slots, 4/4.
- **P2 The fit.** A layer of L pulses sits on x even places by (gcd(L, x) − 1) / (min(L, x) − 1): 1 when one divides
  the other, 0 when they share no factor. A meter's affinity is the mean over the layers of the better of its slots
  (x = N·S) and, when its beats are even, its beats (x = N·b).
- **P3 The weights** (`core/meter.js`). The slots first: PRIOR[S] × (0.25 + affinity)⁴, PRIOR = 8: 1, 16: 0.35,
  4: 0.45, 6: 0.16, 12: 0.12, 9: 0.07, 15: 0.04, 3: 0.05, 5 and 7: 0.06; the odd ones together held to 15 % of the
  draw. Then the bars under them: {4: 1, 2: 0.45, 8: 0.35, 1: 0.12} × (0.25 + affinity)². The draw has its own
  generator (`${seed}/meter`), so no other draw of Compose's moves. Measured over 15 rows: no shared factor ≈ 80 %
  binary / 20 % ternary; 30:21:10 ≈ 70 % ternary; 13:11:7 and 35:25:14 odd 15 %.
- **P4 The shapes** (`meterShape`). 4, 8, 16 (any multiple of 4 not of 3): 4 even beats, 4/4. 3: 3/4. A multiple of 3:
  beats of 3 slots, S/8. Another even S: beats of 2, (S/2)/4. Another odd S: 2s then a 3, S/8. `knobs.beats` (slot
  sizes), `knobs.beatsPerBar`, `knobs.timeSig`, `knobs.quartersPerBar` carry it; the spec's natural tempo is
  60·N·b / T, b = its beats.
- **P5 The drums under the beats.** The backbeat is kick, snare in pairs over the beats, an odd last beat a snare
  (2: K S, 3: K S S, 4: K S K S, 5: K S K S S). The fill starts at beat ⌈b/2⌉ + 1 (beat 3 of 4, beat 2 of 2, beat 3 of
  3) and the fill's half bar is laid over the bar from there. The hat's beat accents follow the beats. The curated
  patterns (rock, funk, …) are written in 4/4 and keep landing through the bar's old 4-cut. In 4, 8 and 16 the beats
  are the old 4-cut's, so those drums are byte for byte as before.
- **P6 The seed tempo.** `spec.seedTempo = { bpm, goal, attacks, perSecond, gateBpm, raw, clamped }`; `seedTempoOf`
  reads it (a MIDI target's clip tempo still wins), so the Tempo knob starts there, Reset goes back to it, and a
  song's passes are sized at it. The provisional (gate) tempo is the goal at 2.4 attacks a slot in a bar of 6 slots
  or fewer, 1.5 in a finer one (measured over 48 compositions of rhythms.mjs), clamped the same.
- **P7 The old way stays, as an override.** `meterFrom: 'cycle'` is the meter and tempo of before, exactly (no beats
  knobs, no seed tempo). The frozen identity gates compose with it. `meterFrom: 'layers'` is the default.
- **P8 MIDI.** The file writes `knobs.timeSig` and the quarter-note tempo (BPM × quarters a bar / beats a bar); the
  clock out ticks 24 a quarter on the same reading. A spec without the knobs reads as 4/4, as before.
- **P9 Cosmos** plays a composition at its seed tempo (the player's time factor) and its note hook keeps time with
  it. Cosmos's SPEED readout shows the seed tempo.

## Open

- A chord chart's 6 slots for three chords a bar is 3/4 in feel, but P4 reads 6 as 6/8. Left as P4 for now.
- `isStrongBeat` (harmony) still reads 0 and S/2 as the strong slots; with beats of 3 it could read the beat starts.
- No field for `meterFrom` in the tab yet: it is a controller knob (`setKnob('meterFrom', 'cycle')`, the lab, JSON).
- **The clamp still binds about half the time.** Over 96 composes (48 rows × 2–3 seeds, 2026-11-11): at 4–6 a second
  58 sat at an edge (47 at 70, 11 at 150); at 5–8, 50 (24 at 70, 26 at 150), median seed tempo 93 BPM. What is left
  is structural: quarter-note slots (4 a bar) and 3/4 hold about 2 attacks a beat and want 100–300 BPM; 6/8 and 5/8
  can still want 45–70. Where it binds, the seed's draw of the goal doesn't move the tempo. Next ways out: a clamp
  on the slot rate rather than the beat, or a meter-aware range (compound beats lower, quarter slots higher).

## Log

- 2026-11-10: rulings 1–4 (Avery, in session); built on `claude/awesome-lamport-jdb7sw`: `core/meter.js`; compose.js'
  `chooseMeter` / `chartMeter` / the seed tempo and `meterFrom`; drums.js' meter beats; MIDI time signature, quarter
  tempo and clock; the controller's seed and `meterFrom` knob; Cosmos's player, choreography and readouts at the seed
  tempo. Suites 90/90: the 89 before (the ones written on the old meter compose through `tests/compose-cycle.mjs`,
  `meterFrom: 'cycle'`, as earlier default changes kept theirs) and `assert-meter.mjs` (33 checks).
- 2026-11-11: the density band widened to 5–8 a second (Avery); `DENSITY_GOAL` in core/meter.js.
