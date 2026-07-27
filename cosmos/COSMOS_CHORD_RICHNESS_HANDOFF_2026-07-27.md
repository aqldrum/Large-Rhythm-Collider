# Cosmos: swap-blip fix + chord richness — handoff 2026-07-27

Branch `cosmos-flight-poc`, continuing `COSMOS_ROW_AUDIO_HANDOFF_2026-07-27.md`. Two pieces of work:
Avery's listening report ("fly fast → the system loops chords, polyrhythm diminishes") and the
7th-chord selection task that handoff scoped. All nine assertion suites are green.

## Commits this thread

- `b448bc4` — Cosmos rows: make a program swap silent, not a chord blip
- `4b6734a` — Sky walk: let the field, not an averaging artifact, decide chord size

## 1. The looping chords while flying — found and fixed

`_seedDeck` **started a voice for every canonical layer** on every deck install. That seed dates from
the legato voicing, where a swap had to re-articulate held tones or the sustain vanished. Under
fixed-gate short notes nothing is held — the pre-boundary voice is long over — so it invented notes:
four simultaneous per star, quantized to the `ROW_SWITCH_TICKS` boundary (1.6 s at 10 ticks/s), always
drawn from the loop's tail, so **the same chord every time**. Flight churns the active star set, and an
install per star entry stacked ~20 of them onto the same instant. That is the "stuck in the buffer".

Headless probe over the real player against a fake AudioContext (60 s, 8 active stars):

| field | attacks | seeded | installs | multi-note instants on the 1.6 s switch grid |
|---|---|---|---|---|
| parked | 322 | 25 (7.8%) | 8 | 15/41 |
| ~1.5 star entries/s | 557 | 298 (53.5%) | 94 | 37/63 |
| ~4 entries/s | 962 | **754 (78.4%)** | 238 | 37/52, avg **22 notes each** |

`_seedDeck` now only restores the repeat-cull memory a deck running since the loop start would already
hold — installs are inaudible, onsets resume at the next real event. After: max simultaneity 25 → 10,
and the churning profile matches parked (0.54 vs 0.62 attacks per active-star-second). Keeping the
memory priming costs ~7% of onset density versus dropping it entirely, and buys the exact invariant
"an install behaves like a deck that had been running" — guarded in `assert-grid-spatial-audio`.

**Avery still needs to listen.** The probe proves the blips are gone; only the ear can say whether the
polyrhythm now reads right at speed.

## 2. Chord richness — two of the handoff's three suspects were wrong

Instrumented before changing anything, as the previous handoff advised. Probes are in this thread's
scratchpad; the numbers below are all from real codex fields.

**The 15¢ extension window is fine — do not widen it.** Over 56 real grids at
`ROW_CONSONANCE_CENTS=15`, every degree is selectable in 91–100% of grids: b7 98% (5.1 owner tones per
grid), maj7 93% (4.7), 9th 91% (6.6), 6/13 91% (4.8). The handoff's worry came from `7/4` = 969¢
landing 31¢ off degree 10, but grids don't voice b7 through `7/4` — they voice it through `16/9`
(−4¢). Septimal ratios fall outside the window; the Pythagorean/5-limit ones that actually populate
these grids do not.

**There is no coverage size penalty in the mean.** Mean coverage is identical across cardinality to
three decimals (0.948 for 3-note through 6-note). The real mechanism is **variance**: coverage is a
mean over the chord's degrees, so averaging over more of them regresses toward the field mean and the
spread shrinks monotonically with size (3-note 0.081 → 6-note 0.048). `maxCov` over the whole
396-chord vocabulary is therefore *always* held by a triad, and a 7th was being measured against a
target its cardinality structurally cannot reach — `Imaj7` paid fieldCost 0.604 against `Isus4`'s
0.000 at identical voice leading. It was charged for being large, not for being out of tune.

### What changed in `sky-walk.js`

1. **The field term normalizes within each cardinality class.** Each chord is asked only how well
   tuned it is *for its own size*. Strictly a no-op when the candidate set is one class — the Feature A
   worked example still reproduces Avery's 2026-07-21 overlay numbers exactly.
2. **The tie-break no longer prefers triads.** `major_triad`/`minor_triad` are quality indices 0 and 1,
   so lowest-id handed every exact tie to a triad. Ties now go to the higher cardinality, then lowest id.
3. **An earned richness incentive.** `RICHNESS = 0.05` semitones, scaled by the chord's weakest
   supported degree (new `perDegreeSupport`/`weakestSupport` — coverage's own double sum kept per
   degree, the same shape `sky-root.js`'s `scoreRootAt` already uses). Extensions are cheap where the
   sky is well tuned across all of the chord's degrees and full price where the extra degree has
   nothing to sound on. Across 12 locations, extended-chord share correlates 0.42 with weakest-degree
   support — the 0.95+ locations run 95–98% extended, the 0.88 ones 71–78%.

   It **saturates at the first extension**: the musical event is leaving the triad, and the 5th and 6th
   notes must pay their own way in voice leading and field support. A linear `(cardinality − 3)` gives a
   13th three times a 7th's discount and runs away — even 0.15 put the walk on six-note chords 58% of
   the time.

Result on the same 5-location probe the previous handoff baselined against: triads 62% → 42%, and
vocabulary reach 21/33 → 27/33 qualities, 15/27 → 21/27 of the extended qualities.

### Tuning RICHNESS

One number, in `cosmos-audio.js`, with the sweep table in the source. Over 12 locations × 40 chords
(triad / 7th / 9th / 11th–13th share):

```
0.00  44% 29% 19%  8%        0.08  11% 50% 28% 11%
0.02  32% 47% 19%  3%        0.12  10% 52% 27% 11%
0.05  20% 50% 25%  5%        0.18   6% 50% 32% 12%
```

Sample variance between location sets is high (a locked cycle amplifies whatever chords are in it), so
treat the table as a shape, not a promise. 0 reproduces the previous triad-dominated walk exactly.
`?skyDebug=1` now shows each candidate's cardinality and its earned richness:
`Imaj7[4]:0.95(1+0.05−0.10)`.

## 3. Found, deliberately NOT changed: the walk locks into a short cycle

Under a static field the walk provably enters a **4–8 chord cycle after 6–22 steps** — deterministic
argmin over a finite `(chord, tabu)` state space must become periodic. At `CHORD_TICKS=256` / 10 ticks
per second, a 4-cycle is ~1.7 minutes of literally repeating progression.

**This is not a bug.** `observePhraseBoundary` in `sky-modulation.js` detects exactly that repeated
`(chordId, tabu)` state as *phrase exhaustion*, and exhaustion is what triggers a root modulation. The
cycle is the designed phrase-end signal. Raising `TABU_K` 3 → 16 breaks the lock in 8/8 locations, but
would suppress modulation with it, so the constant stays.

**But it explains a second half of Avery's report.** Root modulation requires
`rootPolicyContext.settled`, which `flight-view` only sets after camera speed stays under
`SETTLE_SPEED` for `SETTLE_TICKS = 30`. **While you are flying you are never settled**, so the root
can never change, so the exhaustion latches and nothing resolves it — the progression keeps circling
its 4–8 chords for as long as you keep moving. That is a real design question, not a defect:

- Should modulation be allowed to fire while moving, since flight is itself a change of harmonic
  geography? (The epoch machinery exists specifically to *stop* that, so this is a genuine reversal
  to think through, not an oversight.)
- Or should exhaustion-while-moving do something else — widen the tabu until it can modulate, force a
  step to the cheapest non-cycle chord, or let the field's own drift break it?

Recommend deciding this before any further richness tuning: a locked cycle amplifies whatever chords
happen to be in it, which is most of the sample variance in the table above.

## Parked / unchanged

- `vlParsimony`, `coverage`, `GAIN_CEILING_CENTS`, `EPS_SPREAD`, `ROW_CONSONANCE_CENTS`, `TABU_K`,
  `CHORD_TICKS` — all untouched and all still doing their jobs.
- Scale-mode qualities from the catalog remain deliberately unported.
- Avery's parsimony musing (transposing a deterministic per-root progression on root reselection so a
  root change reads as a real key change) is still parked, and now clearly related to §3 above.
