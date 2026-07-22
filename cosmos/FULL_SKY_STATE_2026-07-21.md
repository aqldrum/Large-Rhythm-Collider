# The Full Sky — state of the world (handoff, 2026-07-21)

Picks up after `FULL_SKY_HANDOFF.md`'s M1–M4 all landed (implementer session) + Avery's first listening
pass in the actual flight view. Read `FULL_SKY_HANDOFF.md` first for the full design — this doc is the
as-built status, what Avery heard, what got fixed, and — the important part — an **empirically-grounded
diagnosis** of why the progression sounds the same everywhere, for whoever picks up the harmonic-geography
work next (Avery: "I'll do some thinking and probably discuss with a fresh agent").

## Repo / branch / commit state

- Same repo/branch as the handoff: `cosmos-flight-poc`. **Still uncommitted** — M1–M4 plus everything in
  this doc are one working tree, not yet split into milestone commits. Touched/new files:
  `cosmos/grid-core.js`, `cosmos/cosmos/abundance-worker.js`, `cosmos/cosmos/cosmos-runtime.js`,
  `cosmos/sky-walk.js` (new), `cosmos/cosmos-audio.js`, `cosmos/flight-view.js`,
  `cosmos/cosmos/assert-fullsky.mjs` (new).
- All 4 milestones' guards are green in one file (`cosmos/cosmos/assert-fullsky.mjs`, sectioned M1–M4),
  plus the 5 pre-existing guards untouched (`chord-walk.js` is parked, not deleted, per the handoff).

## What Avery heard, and what happened to each

**1. "Active flight instantly cuts down the audio significantly."** Real bug, **fixed**. Root cause: the
bed's audible-set (nearest `AUDIBLE_N=10` zones with a pool) was recomputed from scratch every single
frame in `flight-view.js`. While flying, stars constantly cross the Nth-nearest boundary — each crossing
dropped a star from the field, and `cosmos-audio.js` tore that star down with a **hard 50ms cut**
(`teardownBedStar(..., immediate=true)`), disconnecting its whole voice chain synchronously. Worse, the
oscillator budget (`MAX_BED_OSC=30`) wasn't freed until a released voice's ~2.5s fade-out actually
finished playing, so a burst of churn (typical while moving fast) could starve *incoming* stars of budget
for the whole tail of outgoing ones — net effect: more silence exactly while you're moving. Two fixes,
both in this tree:
   - `cosmos-audio.js`: a star falling out of the field now gets the *normal* `BED_RELEASE` fade
     (`dropBedStar`/`releaseVoice`), and its shared filter/panner/gain chain is kept alive in a small
     `dyingStars` list until every one of its voices has actually finished fading — not torn down
     synchronously (which used to cut the tail off audibly). `bedOscCount` is now decremented the moment
     a release *starts*, not when it finishes, so budget is available to newcomers immediately.
   - `flight-view.js`: the audible-set selection now has hysteresis (`AUDIBLE_MARGIN=4`) — a star that's
     already audible keeps its seat as long as it's still within the *wider* `AUDIBLE_N+margin` window;
     only genuinely falling further behind drops it. This cuts the churn rate itself, not just its cost.
   - **On the "decouple the solver from playback" framing:** worth correcting for whoever picks this up —
     the abundance *solver* already runs entirely in Web Workers (off the main thread) and was never the
     bottleneck; it doesn't touch audio. The actual mechanism was audible-set churn on the main thread, as
     above. `cosmos-audio.js`'s own note-scheduling clock (`schedulerTick`) already runs on its own
     `setInterval`, independent of the render loop's `requestAnimationFrame` cadence — but it's still JS on
     the *same* main thread as rendering, so a genuinely heavy render frame can still delay it. That's a
     real, separate consideration (worth an `AudioWorklet`-based scheduler if it turns out to matter) but
     it's speculative — nothing here shows evidence it's currently the cause of anything. Don't build it
     without new data.

**2. "The root tone never appears to change... perhaps we're just picking 1/1 for the root every time."**
Not a bug — this is v1 exactly as designed. `FULL_SKY_HANDOFF.md`: *"No per-star roots, no drift... Anchor:
degree 0 = 1/1 = 220Hz."* One fixed global root for the whole sky is the whole point of v1 (it's what makes
cross-star consonance true by construction). Root/mode drift is explicitly the **Deferred** item Avery is
now actively designing ("via coprime meta-clocks on site-time") — this observation is just confirming that
work hasn't started yet, not finding a defect. The debug overlay (below) makes this legible at a glance:
it prints `root 220Hz fixed (v1, no drift)` on every frame.

**3. "The standard parsimonious progression occurs no matter where you are... need to get deeper into
this."** Not fixed — deliberately left for the fresh-agent discussion, but **diagnosed with real numbers**
so the discussion starts from data, not a guess (see the probe below). Short version: **the field term is
being washed out by coverage saturation, not by a voice-leading bug.**

## Why the progression is location-invariant (empirical)

Probe script (throwaway, not committed — was in `/tmp` scratch, rerun with the snippet below if useful):
built 5 disjoint real "locations" (10 real codex grids each, aggregated pools via the real
`gridShardSolve`), then measured `coverage()` across all 24 triads and ran the real
`chooseNextChord`/`pushTabu` walk with production defaults (`CHORD_TICKS`/`TABU_K=3`/`LAMBDA_FIELD=2.0`).

```
coverage() spread per location (24 triads): min 0.93–0.98, max 0.99–1.00, spread only 0.02–0.07
12-step walk from I, at 5 different real locations: IDENTICAL every time —
  I → i → bVI → bvi → III → iii → I → i → bVI → bvi → III → iii → I
top-6 covered triads barely differ between the sparsest and richest sampled location
```

**The mechanism:** `coverage()` is already close to 1.0 almost everywhere, because it's a mean over the
*aggregate* of `AUDIBLE_N=10` real stars — and per the original handoff's own finding, "grid aggregation is
generous and nearly free" (abundant grids alone hit 12/12 degrees at 35¢; 10 of them together are very
likely to cover nearly everything). So `LAMBDA_FIELD·(1−coverage(next))` maxes out around **0.05–0.14** in
practice — utterly dwarfed by `vlParsimony`'s integer-step cost scale (P/L = 1, next-cheapest ≥2). The field
term *does* measurably affect tie-breaks among options that are already equally cheap under pure parsimony
(changed the argmin in 50/120 sampled start-chord×location cases vs a coverage≡1 baseline) — but it can
never overrule a strictly cheaper parsimony move, and from most chords the cheapest move (P or L, cost 1)
is unique. So the walk always takes the same locally-cheapest step and falls into the same small attractor
cycle regardless of location. This is the textbook behavior of a deterministic greedy walk on a landscape
that doesn't vary enough to matter — not a bug in the walk itself.

Also worth noting for the "I → i vs i → I" question: `vlParsimony` is a genuine symmetric metric (it
minimizes over *all* 6 bijections, so `vlParsimony(A,B) === vlParsimony(B,A)` by construction — now
directly guarded in `assert-fullsky.mjs`'s M2 section, all 276 triad pairs). Avery's intuition ("either way
you end up with the same loop") is exactly right, and now has a proven reason: symmetric costs + saturated
coverage → the walk is a fixed point of a deterministic system, and it converges to the same cycle from
anywhere.

**Candidate directions for the fresh-agent discussion (untested, not prescriptive):**
- The saturation is a direct consequence of aggregating `AUDIBLE_N=10` stars uniformly. A near-field of
  1–3 *closest* stars (or a steeper distance-weight falloff than the current `distGain` curve) would look
  much more like the original per-star data (52% of single systems have *no* song at all at 35¢) — i.e.
  real local sparsity, which is what would actually let the field pull the walk around.
- `LAMBDA_FIELD` may just need to be much larger than 2.0 given the actual scale of `(1−coverage)` in
  practice (~0.05, not the ~1.0 the constant was tuned assuming) — or `coverage` needs a sharper
  (non-linear) response so small real differences produce a meaningful cost delta.
- Avery's own next moves (chord arrival by tuning *strength*, root selection by proximity) may sidestep
  this entirely — those are different terms in the cost function, not more of the same one.

## The debug overlay (new, dev-only)

`?skyDebug=1` seeds it on (so a bookmarked link opens straight into it); the **C key** toggles it from
there while flying (Avery's ask, once he confirmed the URL flag alone). Self-contained — no
`index.html`/`style.css` changes, a floating panel built by `flight-view.js` on the fly, appended inside
`#cosmos-view`. Not part of the product UI. Shows, refreshed 5×/sec:
- The fixed root, current global chord + its 3 degrees, and the walk's recent trail (tabu contents).
- `coverage()` for all 24 triads ranked best→worst, against the CURRENT live field — the direct way to
  see whether harmonic geography is doing anything at a given moment, instead of inferring it by ear.
- Every audible star: pan/gain/octave/cutoff, its **full** 12-slot degree pool with cents+dev (the "nearby
  tones" Avery asked for), and which of those degrees actually got a bed voice + that voice's live envelope
  gain (the "what's been selected" half).

`cosmos-audio.js` exports `debugSkyState()` for this — dev/introspection only, not on the product's hot
path (only called from the overlay's own throttled render). Avery: *"maybe it can evolve into a
semi-gamified thing users can play with to shape the audio around them"* — the data this already surfaces
(coverage-by-triad, per-star pools) is exactly what a future "why is this chord playing" or
"which star is pulling the harmony this way" UI would need; worth keeping in mind if/when this moves out
of dev-only.

**Gotcha hit building this (worth remembering for any future flight-view dev UI):** `style.css`'s
full-swallow rule is `body.cosmos-active > *:not(#cosmos-view):not(script) { display:none !important; }`
— it hides every direct child of `<body>` except `#cosmos-view` while flying. The overlay's first cut
appended to `document.body` and silently never rendered (no error — Avery's first report was "no overlay,
only unrelated Firebase noise" — the panel existed in the DOM, just force-hidden). Fixed by appending
inside `#cosmos-view` instead; `position:fixed` on the panel still anchors to the viewport correctly since
`#cosmos-view` sets no `transform`/`filter` that would create a new containing block.

## File map (delta from `FULL_SKY_HANDOFF.md`'s build order)

| File | What changed here |
|---|---|
| `cosmos/cosmos-audio.js` | `dropBedStar`/`finalizeStarChain`/`dyingStars` (smooth field-churn release, see fix #1); `debugSkyState()` export. |
| `cosmos/flight-view.js` | `AUDIBLE_MARGIN` hysteresis on the audible-set selection; the debug overlay (`ensureSkyDebugPanel`/`renderSkyDebug`, seeded by `?skyDebug=1`, toggled by the C key). |
| `cosmos/sky-walk.js`, `cosmos/grid-core.js`, `cosmos/cosmos/abundance-worker.js`, `cosmos/cosmos/cosmos-runtime.js` | Unchanged since `FULL_SKY_HANDOFF.md`'s M1/M2 build — no new findings here. |

## Verification status

All 6 guards green: `node cosmos/cosmos/assert-{cosmos,runtime,hilbert,shard,chordwalk,fullsky}.mjs`,
`node --check` clean on every touched/new file. The churn fix and the debug overlay are **not**
browser-verified by me — per house convention, Avery does his own audio/UI pass. The empirical
progression-saturation numbers above ARE from a real (if throwaway) script against real codex data, not
speculation — but they're a diagnosis, not a fix; nothing about the walk's algorithm changed this session.

## Open items for the next agent, roughly in likely-discussion order

1. **Harmonic geography** (this doc's main finding): make the field term actually differentiate by
   location — candidate directions above, needs Avery's design input on which lever (near-field size,
   lambda scale, non-linear coverage response, or a different cost term entirely).
2. **Root/mode drift** (Deferred in the original handoff, Avery actively designing): the ONE global frame
   slowly transforms over site-time via coprime meta-clocks. This is probably the bigger lever on "does it
   sound different depending on where you are" than tuning the existing field term.
3. **Chord arrival by tuning strength**: picking the next chord (or drift target) based on how well-tuned
   it is locally, not just voice-leading + coverage — likely folds into #1's cost-function redesign.
4. Consider whether the debug overlay's data model (`debugSkyState()`) is the right shape to grow into
   the "semi-gamified" user-facing version Avery mentioned, before it accretes more dev-only fields.
