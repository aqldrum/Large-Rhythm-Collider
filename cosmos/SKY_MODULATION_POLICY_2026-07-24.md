# Sky modulation — pure policy pass (2026-07-24)

This fixes the exact normalization, phrase-tracking, trigger, and destination-ranking scheme agreed in
`SKY_ROOT_LISTENING_2026-07-22.md`. It deliberately does **not** connect the policy to WebAudio, camera
state, or the live chord walk yet.

Implementation: `sky-modulation.js`. Guard: `cosmos/assert-sky-modulation.mjs`.

## 1. Normalize root fitness without manufacturing confidence

For the current ladder:

`denominator = max(maxScore - minScore, rootSpreadEpsilon)`

`fitness(root) = clamp((score(root) - minScore) / denominator, 0, 1)`

The first-pass `rootSpreadEpsilon` is `0.15`, kept separate from the chord walk's `EPS_SPREAD` even
though it starts with the same value. A raw ladder spread of `0.002` therefore occupies only
`0.002 / 0.15 = 0.0133` normalized units; it is not inflated into a false 0–1 contest. The incumbent
is re-scored against the same field and projected through the same ladder min/denominator even when its
root is not one of the current candidate tones. Raw scores, spread, denominator, rank, and normalized
fitness all remain available for diagnostics.

## 2. Track phrase exhaustion as serializable state

Phrase state is exactly:

`[currentChordId, ...orderedTabuIds].join('|')`

On root installation, the current state is recorded and dwell starts at zero. After each chord advance,
the post-advance state is observed once and `chordsSinceRootChange` increments. The first repeated state
latches `exhaustionDue`; it remains due until a root change resets the tracker. This matters when the
repeat occurs before a valid root ladder is available—the musical event is remembered rather than lost.

The first-pass minimum dwell is four completed chord boundaries, matching the existing `tabuK=3`
minimum-cycle scale. It remains a policy knob for listening.

## 3. Require a live geographic epoch

Both triggers require all of the following:

- the player is currently settled;
- the ladder's `proposalEpoch` equals the flight system's current geographic epoch;
- minimum root dwell has elapsed;
- at least one non-incumbent, non-recent destination exists in the normalized top band.

Flight must advance the geographic epoch and invalidate settling as soon as meaningful movement resumes.
This closes the existing stale-proposal hole: neither a pending geographic change nor a later phrase
exhaustion may consume the hierarchy from a region the player has already left.

The **geographic trigger** additionally requires a candidate to beat the incumbent by both:

- more than `0.10` normalized fitness; and
- more than a `1.5%` relative raw-score anti-noise margin.

Both comparisons are strict, so exact ties retain the incumbent. The **exhaustion trigger** does not
require a fitter root; its purpose is to leave a completed local cycle. If both are due at once, the
debug reason is `geography`.

## 4. Establish eligibility before ranking

The top band is defined relative to the ladder leader before exclusions:

`fitness >= bestFitness - 0.20`

Then exclude:

- roots within `0.5¢` circular distance of the incumbent;
- roots in the newest-first recent-root history (first-pass length 3).

Root history uses octave-circular cents identity at the solver's `0.5¢` tone bin, not `rootKey`.
`rootKey` is a cache version and therefore cannot identify a revisited harmonic position. Geography may
rank only candidates that cleared its superiority tests. Exhaustion may rank any remaining top-band row.

## 5. Rank destinations in the local-tuning control's musical unit

For every eligible root, arrival coverage is the mean of that ladder row's `perDegree` values over the
chord that will remain installed across the modulation. Arrival coverage is normalized across the
eligible destination set with its own `0.15` epsilon, so an almost-flat arrival field cannot dominate.

The tuning goal is initially:

`goalFitness = 0.65 × normalizedRootFitness + 0.35 × normalizedArrivalFitness`

The motion target is a moderate octave-circular `300¢`:

`motionCost = abs(circularRootMotionCents - 300) / 100`

That cost is measured in semitones away from the preferred motion. The existing local-tuning value keeps
the same unit it has in chord selection:

`tuningCost = localTuning × (bestGoalFitness - candidateGoalFitness)`

`destinationCost = motionCost + tuningCost`

Thus local tuning `0` selects purely by preferred root motion; local tuning `2` allows the best tuning
goal to justify at most two semitones of departure from that motion target. Ties resolve by higher root
fitness, higher arrival fitness, simpler fraction, then cents.

These numerical values are explicit first listening defaults, not claims of final musical calibration.
The pure guard protects their meanings so each can be tuned without silently changing units or policy.

## Live integration

At a chord boundary: advance the chord and tabu, observe the new phrase state, evaluate the two triggers,
rank a destination, then—if due—install the root beneath that unchanged chord and reset phrase tracking
with the post-advance chord/tabu state. A previously selected geographic destination can use the same
boundary, but only while its epoch remains valid.

The 1/1 state at engine start is explicitly provisional. The first valid settled solve establishes the
root at the next chord boundary without normal phrase dwell: a candidate that clears both geographic
gates wins, while a flat or near-tied ladder validates retaining deterministic 1/1. That provisional
anchor is not added to recent-root history. Establishment resets phrase tracking; every later change uses
normal dwell, geographic/exhaustion triggers, ranking, and recent-root history.

The old absolute 10% `ROOT_HYSTERESIS` selector has been removed. `applyRootPolicyAtBoundary` is the sole
live root authority and is called only after the chord and tabu state advance.

## Live debug integration

Full Sky Debug displays the same decision object live playback consumes. It tracks phrase states across
real chord boundaries, receives settled/geographic-epoch context from flight, normalizes the exact
most-recent ladder, evaluates both triggers, and previews or ranks the destination using the sounding
chord. The panel labels the policy `LIVE` and distinguishes provisional bootstrap from an established
root.

The sticky root block reports incumbent rank/raw/fitness, ladder spread and normalized range, phrase
dwell/exhaustion, solve epoch validity, trigger state, recent roots, and the top eight classified rows
with arrival/motion/tuning/total costs. The rest of Full Sky Debug scrolls beneath it. The panel captures
and contains wheel scrolling only while the pointer is over the panel; the canvas keeps dolly everywhere
else.
