# Sky Root — first listening pass (handback, 2026-07-22)

Short handback after Avery's first live pass on `SKY_ROOT_HANDOFF_2026-07-22.md`'s implementation
(commits `9cd9234`/`3290977`, guards green). **Not a build doc — no code changes here.** Avery is
routing this to a reviewer agent before any further root-reselection work; this just answers "how
would you proceed" so that discussion starts from a diagnosis, not a guess.

## What Avery saw (grid 944043, far out — screenshot attached in chat)

- The root ladder's top 8 all display as tied: `107/101:0.75 383/304:0.75 379/268:0.75 547/307:0.75
  538/285:0.75 1/1:0.75 227/143:0.75 37/22:0.75`.
- `1/1` stayed the incumbent root throughout, even once other candidates showed the same displayed
  score, and even after flying to a richer grid pushed scores up generally.
- The chord *progression* is genuinely responding to the field now (Feature A working) — including
  still occasionally taking the "typical" parsimonious swap (I↔i / N↔n) when the field doesn't
  discriminate enough to overrule it. That's correct v1 behavior, not a bug.
- Ask: **don't implement reselection-in-realtime yet** — write up how I'd approach it.

## Diagnosis

**1. The displayed ties are almost certainly NOT real ties.** The overlay shows `score.toFixed(2)`
(`flight-view.js`'s `renderSkyDebug`), but `debugSkyState()` already carries 3 decimals of precision
internally. Proof it's a display artifact, not a computation one: the ladder is sorted score-desc
then simplest-fraction-then-cents (`sky-root.js`'s `compareFraction` — `1/1` is *always* the simplest
possible fraction, denominator 1). If these 8 were exactly tied, `1/1` would sort **first**. It
sorts **sixth**. That's only possible if the true (unrounded) scores differ and `1/1`'s is genuinely
a little lower than several others' — the 2-decimal display is just compressing a real, narrow spread
into what reads as one number. This is a legibility bug, cheap to fix (bump the overlay's precision,
maybe show the raw spread the way Feature A's `coverageByTriad` readout already does).

**2. But there's a real mechanism behind the *closeness*, not just the display.** This is the same
shape as the original hexatonic-lock diagnosis, transposed onto the root axis: `scoreRootAt` averages
`gainForDev` across all 12 degrees, aggregated over every star in `ROOT_RADIUS`. A richer grid (more
distinct tones per star, more stars in radius) means almost *any* candidate anchor can find something
within a few cents of most of its 12 degrees — so many different anchors converge toward a similarly
high aggregate score. Avery's own observation ("higher grids = ladder scores got higher") is exactly
this saturation, not a coincidence. **Worth naming for the reviewer discussion:** the richer the
field, the *less* decisive the root ladder becomes at exactly the point where you'd want it to be
most confident. Feature A hit the identical problem on the chord axis and fixed it by normalizing the
field-cost term over the candidate set (`EPS_SPREAD`); the same normalization idea likely applies
here — score roots by their **rank within the ladder's own spread**, not by an absolute number that
saturates toward 1.0 in abundant fields.

**3. "1/1 remained root" is very likely correct, not stuck.** `ROOT_HYSTERESIS=0.10` is a *relative*
margin: the pending winner must beat the incumbent's current score by 10%. At the scores in the
screenshot (~0.75, narrow real spread per point 1), nothing is coming remotely close to a 10% relative
jump over `1/1` — so no swap is expected yet, by design (the hysteresis exists so the frame doesn't
thrash on noise). This will need Avery's ear once the display shows real precision: is 0.10 too
conservative given how tight real spreads turn out to be, or is "very sticky, rarely swaps" actually
the desired v1 feel? That's a tuning call, not a defect.

## The concrete gap: chord masks don't know about the root yet

This is the one piece that's an actual latent bug, not a tuning question — it just hasn't been
observed yet because no real swap has happened in testing. `leadNoteInChord(ratio, chordId)` in
`cosmos-audio.js` calls `nearestDegree(ratioToCents(ratio))` with **no anchor argument** — it's
hard-wired to the 1/1 default, unlike the bed, which correctly re-anchors via `z.skyPoolAt` →
`poolFromTones(z.skyTones, skyRoot.cents)`. `ensureLeadMask`'s cache also only invalidates on
`skyChordId` change (`leadMaskChordId`), never on a root swap. So the moment a real swap lands, the
clicked star's lead will keep masking against the *old* root while the ambient bed has already moved
to the new one — the two halves of "the sky" would disagree about what's in-chord. This is exactly
the "alter the chord masks accordingly" piece Avery asked about, and it needs to happen before
reselection is meaningfully "live":
- Thread the current root's `cents` into `leadNoteInChord`/`ensureLeadMask` (mirrors the bed's
  `poolFromTones` call exactly — same anchor, same function, just called from the lead's mask path
  too).
- Invalidate `leadMask` on a `rootKey` change as well as a `skyChordId` change (two independent
  triggers for the same cache).

## How I'd proceed (once the reviewer clears it)

In rough order, cheapest/lowest-risk first:

1. **Overlay precision.** Show 3-4 decimals (or the raw float) on the ladder, and add a spread
   readout (max−min across the shown top-K, same idea as `coverageByTriad`'s spread). Immediately
   answers "are these really tied" without guessing. Zero design risk — pure legibility.
2. **Fix the lead-mask anchor gap** above. Small, mechanical, and needs to land before any real swap
   is exercised in the browser, or the lead/bed will audibly disagree the first time a swap actually
   fires.
3. **Decide the root-score normalization question with Avery**, now that real numbers are visible:
   probably the same shape as Feature A (`λ`-style relative spread normalization) rather than a bare
   `ROOT_HYSTERESIS` against an absolute, saturating score — but this is a design call for the
   discussion, not something to guess at in code.
4. **Once real swaps start happening**, watch for oscillation between near-tied roots and consider a
   post-swap cooldown/minimum dwell (independent of `ROOT_RESOLVE_MIN_TICKS`, which only rate-limits
   *proposing* a solve, not how soon a *second* swap can follow the first). Only build this if it's
   actually observed — no evidence yet that it happens.

Nothing above is implemented. Guards/build order stay exactly as landed in `9cd9234`/`3290977` until
the reviewer session concludes.
