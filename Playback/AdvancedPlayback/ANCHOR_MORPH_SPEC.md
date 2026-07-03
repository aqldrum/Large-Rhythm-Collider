# Anchor Morphing — root-candidate cycling inside one tuning system (implementation spec)

**Status:** spec finalized 2026-07-03, ready to implement. Companion to
`Playback/MIDIOUT_SPEC.md` (which carries one addendum from this feature, §7 below).
Descends from the Fable-thread "tuning morph" design, but **inverted**: no second rhythm
needed — one rhythm's scale already contains multiple vantages of itself.

**The idea (Avery's framing):** the Progression Solver solves the *entire tuning system*
to find the strongest root anchor. But it doesn't find one — it finds a **ranked list**,
and today the UI keeps `candidates[0]` and discards the rest. Anchor Morphing cycles among
those candidates during playback, **retuning the fundamental at each swap so the typed
root note stays at the same pitch**. The root becomes a fixed beacon; every other voice
reshuffles to its nearest alternate in the ratio web and **glides there with portamento**.
The tuning system breathes continuously while the rhythm never changes.

---

## 1. What already exists (verified against current source)

- **`ProgressionSolver.js`** already enumerates EVERY scale ratio as a candidate root:
  `optimizeRoot(rootIdx, …)` runs per ratio (~L312), results are scored
  (`strength`, `avgDeviation`, `maxDeviation`, `pairCount`), deduped by voicing
  `signature`, sorted (~L318–319), and returned as `candidates` (topK). Each candidate
  carries `rootFraction`, `rootCents`, and `matches` (per-semitone
  `{semitone, fraction, cents, relativeCents, deviation}`). **Zero new solver math.**
- **Masks per candidate:** `analyzePerChord(parsed, candidate, ratios, windowCents)` and
  `chordWindowFractions(...)` derive per-chord fractions/thick masks *for a given
  candidate* — they are already candidate-parameterized. Re-deriving stage masks for
  candidate *k* is a pure re-call, stage boundaries untouched.
- **Retune path:** `ProgressionBar._retune(candidate)` (~L251) computes
  `fundamental = typedRootHz / rootRatio` and calls
  `toneRowPlayback.updateFundamentalFreq(...)`;
  `ToneRowPlayback.handleFundamentalChange(glideTime)` glides sounding oscillators AND
  (per MIDIOUT_SPEC) mirrors to MIDI pitch bend. **The invariant
  `rootRatio_k × fundamental_k = typedRootHz` holds for every candidate by construction.**
- **Mask application:** `PaintEngine` swaps `selectedNotes` per stage at schedule time;
  `PaintTimeline` holds stage masks with `toJSON/fromJSON`; `ProgressionBar._paintPlot()`
  drives per-node plot lighting. All reusable as-is.

## 2. The morph engine (`Playback/AdvancedPlayback/AnchorMorph.js`)

New module, singleton `window.anchorMorph`, no engine edits beyond the listed hooks.

State:
```
candidates[]        // full ranked list captured at Solve (see §6 hook 1)
parsed              // the parsed progression from the same Solve
pool[]              // candidates eligible for cycling (see below)
anchorIndex         // current position in pool
rule                // 'manual' | 'ladder' | 'pivot' | 'perChord' | 'voiceLead' | 'commaPump' | 'random'
ruleParams          // e.g. { voiceLead: 'min'|'max' }
timing              // 'manual' | 'onChord' | 'onCycle' | 'everyN' (N) | 'freeClock' (seconds)
glideSec            // portamento time for the retune sweep (default 0.5, range 0.05–5)
enabled
```

**Pool:** default `min(8, candidates.length)` strongest, filtered to candidates whose
coverage equals `candidates[0]`'s (exclude relaxed/partial-fit alternates unless the user
raises a "include weak anchors" toggle). Pool size user-adjustable.

**`swapToAnchor(k)` — the atomic operation:**
1. `cand = pool[k]`.
2. Re-derive every stage's mask from `cand` (`analyzePerChord` / `chordWindowFractions`
   with the stored `parsed` + windowCents; same thick/lean setting). Write masks into the
   existing `PaintTimeline` stages **in place** — boundaries, chord symbols, brackets all
   stay; only lit membership changes. Refresh plot via the existing `_paintPlot()` path.
3. Retune with **minimal-motion octave fold** (§5) and `glideSec` (§4).
4. Emit `anchorMorphSwapped` CustomEvent `{ fromIndex, toIndex, sharedFractions }` for UI.

`perChord` is the special case: it assigns each *stage* its own best anchor at Solve time
(stage i's mask from the candidate maximizing that chord's fit), and every stage boundary
becomes a retune to that stage's anchor. Rule and timing collapse into one.

## 3. Swap-rule catalog

All rules choose "next anchor index in pool"; they are one function each.

| id | behavior | notes |
|---|---|---|
| `manual` | prev/next buttons (or keybind) | performance gesture; ships first |
| `ladder` | rank 1 → 2 → … → K → back to 1 | deviation score = built-in tension curve with a resolution home |
| `pivot` | **interconsonance pivots — the flagship.** Move to the pool candidate with the highest match-set overlap with the current one | overlap = weighted intersection of `matches[].fraction` sets (weight `1/(1+deviation)`); precompute the K×K overlap matrix at Solve. Shared tones don't move at the swap — they are pinned pivots while everything glides around them: common-tone modulation inside one tuning system. Tie-break by strength. Track visited set so it explores (reset when exhausted) |
| `voiceLead` | minimize (`min`) or maximize (`max`) total glide: global shift = interval between `rootCents`, plus sum of per-degree mask deltas | smooth drift vs dramatic lurch |
| `commaPump` | choose a fixed cycle of anchors whose retune product ≠ 1 (before folding) → the system spirals by a comma per pass | expose "close the loop" toggle that constrains the cycle to return home every N passes |
| `random` | probability ∝ `strength` | drunken master |

## 4. Timing axis (orthogonal to rule)

- `onChord` — ride the existing PaintEngine stage transitions: when the scheduler's mask
  swap crosses into a new stage, fire the rule. Anchor changes land exactly on chord
  changes. Implementation: PaintEngine already computes the stage per scheduled tick;
  detect stage-index change there (one hook, §6 hook 2) — do NOT poll.
- `onCycle` / `everyN` — same hook, gated to stage-index wraparound (cycle boundary),
  counted mod N.
- `freeClock` — independent setInterval(seconds); the tuning drifts *against* the harmony.
  Musically distinct from `onChord`; keep both.
- `manual` — no automation.

Note the resulting texture, which is the point: **held/legato notes glide by the interval
between the two anchor roots** (the fundamental sweep drags them — browser voices via
`setTargetAtTime`, MIDI via bend ramp), while **newly struck root notes land back on the
typed pitch**. Fixed beacon, churning halo.

## 5. Minimal-motion octave fold (fixes a latent lurch)

`_retune` currently folds the fundamental into 55–880 Hz against fixed walls
(`while (f < 55) f *= 2; while (f > 880) f /= 2`). Between anchors this can jump a
register when it could glide a comma. Replace (for morph swaps AND the initial solve
retune — extract a shared helper):

```js
function foldNearest(target, current) {         // fold by octaves toward current
    while (target < current / Math.SQRT2) target *= 2;
    while (target > current * Math.SQRT2) target /= 2;
    while (target < 55)  target *= 2;           // hard limits still win
    while (target > 880) target /= 2;
    return target;
}
```

## 6. Hook points (small, additive)

1. **`ProgressionBar._solve` (~L237):** it already has `res` — store the FULL
   `res.candidates` + `parsed` on `window.anchorMorph.loadCandidates(res, parsed, opts)`
   instead of discarding all but `res.candidate`. Same for the popout controller
   (`advanced-playback-main.js` solve path).
2. **`PaintEngine`:** where the per-tick stage is resolved, emit/notify on stage-index
   change (`anchorMorph.onStageCrossed(stageIndex, isCycleWrap)`). Guard: no-op when
   morphing disabled.
3. **`ToneRowPlayback.updateFundamentalFreq`** — accept an optional `{ glideSec }` and
   pass it through to `handleFundamentalChange(glideSec)` (currently hardcoded 0.05).
   Default unchanged.
4. **Script tags:** `AnchorMorph.js` after `ProgressionSolver.js` in both `index.html`
   and `advanced-playback.html`.

## 7. MIDI addendum (carried into MIDIOUT_SPEC implementation)

A programmatic anchor swap is a SINGLE `handleFundamentalChange(glideSec)` call — unlike
slider drags it produces no event stream. So `lrcMidiOut.handleFundamentalRetune(glideSec)`
must, when `glideSec > ~0.08`, emit an **interpolated bend ramp** per live channel:
timestamped bend messages every ~30ms from current to target over `glideSec` (exponential
approach to match `setTargetAtTime`'s curve is a nice-to-have; linear is acceptable).
Cancel any in-flight ramp for a channel when a new retune or note-on arrives on it.
Headroom: ±48 default bend range absorbs anchor swaps comfortably (candidate roots live
within one octave of each other); clamp + re-strike self-heal applies as in MIDIOUT_SPEC §8.

## 8. UI surfacing (acknowledged challenge — ship in two passes)

**Pass 1 (minimal, inside the existing progression bar):** an "Anchors" cluster appearing
after a successful Solve — current anchor readout (`root 14/11 · #3 of 8 · 94%`),
prev/next buttons, rule select, timing select, glide number. Collapsed behind a ⚓ toggle
to keep the bar compact.

**Pass 2 (the pivot payoff):** during `pivot` swaps, flash/pin-highlight the shared
fractions in the Linear Plot and scale chart (reuse the per-node lighting path with a
distinct accent class) so you can *see* the common tones hold still while the halo moves.
Overlap matrix could also render as a tiny heat-strip for choosing anchors by eye.

Persistence: morph settings piggyback on the existing `?prog=` share-link + localStorage
payload (add `anchorMorph: {rule, timing, glideSec, poolSize, anchorIndex}`).

## 9. Verification plan

1. **Headless:** solve `Cmaj7 Am7 Dm7 G7` on 8:7:6:5 (and one dense rhythm, e.g.
   16:13:11:9) → assert: pool populated & ranked; for every candidate
   `rootRatio × foldNearest(typedHz/rootRatio, current)` ≡ typed root pitch class;
   swap rewrites stage masks (diff against direct `analyzePerChord` output) without
   touching boundaries/symbols; overlap matrix symmetric, `pivot` picks argmax; fold is
   minimal-motion (never > 600¢ fundamental move between pool members unless limits force
   it); `onChord` fires exactly once per stage crossing.
2. **At the rig:** enable morph + ladder on a slow cycle — hear the halo glide while the
   typed root re-strikes in place; `pivot` rule with pass-2 highlighting — confirm shared
   tones audibly/visibly hold; MIDI: confirm the DAW receives bend ramps (record and
   inspect the clip's pitch-bend lane); stop = silence, no stuck ramps.

## 10. Non-goals (this pass)

Cross-rhythm morphing (separate future feature — this module's swap/glide machinery is
its foundation); automated rule composition (e.g. Markov over rules); per-voice
independent glide times; morphing the Partitions mirror.
