// sky-root.js — Sky Root handoff Feature B: anchor-independent root solve (see
// cosmos/SKY_ROOT_HANDOFF_2026-07-22.md). Pure module: no DOM, no audio, no imports beyond
// sky-walk.js's gainForDev + grid-core.js's nearestDegree/TONE_BIN_CENTS. Does NOT import
// Playback/AdvancedPlayback/ProgressionSolver.js — that module is reference reading only (its
// optimizeRoot/solveAll outer-loop-over-candidate-roots idea is the conceptual template, reimplemented
// here against the sky's aggregate tone field instead of a single scale + a fixed chord progression).
//
// 1/1 stays 220Hz — this module only ever produces a RATIO + cents (relative to 1/1); nothing here
// touches the fundamental frequency. Fundamental portamento drift is a later, separate feature.
import { nearestDegree, TONE_BIN_CENTS } from './grid-core.js';
import { gainForDev } from './sky-walk.js';
import { normalizeCentTargets, signedCircularCentsDistance, wrapOctaveCents } from './harmony-policy.js';

const ALL_DEGREES = Array.from({ length: 12 }, (_, d) => d);

// Fold one star's anchor-independent tone list into a 12-slot pool AT ANCHOR anchorCents — the same
// min-|dev| rule grid-core.js's poolFromRatios uses for the anchor-0 case, generalized. Anchor 0
// reproduces today's pool exactly (guarded — the tone list is a superset that loses nothing at the
// anchor it was originally folded at).
export function poolFromTones(tones, anchorCents = 0) {
  const pool = new Array(12).fill(null);
  for (const t of tones) {
    const { d, dev } = nearestDegree(t.c, anchorCents);
    if (!pool[d] || Math.abs(dev) < Math.abs(pool[d].dev)) pool[d] = { fraction: t.f, cents: t.c, dev };
  }
  return pool;
}

// Score ANY candidate root anchorCents (cents = its absolute cents vs 1/1 — need not be one of the
// field's own tones, e.g. B3 re-scores the INCUMBENT root under a freshly gathered field) against the
// field: for each star, re-fold ITS tones at this anchor, then gainForDev each of the 12 degrees —
// exactly coverage()'s double sum (sky-walk.js) but over ALL 12 degrees of the comb instead of one
// triad's 3. perDegree is computed for the FULL chromatic regardless of degreeTemplate (cheap — one
// fold per star either way) so a later scale-template pass over the same ladder never needs to
// re-score; `score` is the mean of perDegree restricted to degreeTemplate (weighted-mean-of-per-star-
// mean == per-degree-weighted-mean-then-averaged, same identity sky-walk.js's coverage() relies on —
// weight doesn't vary by degree, so the two orders of summation agree).
export function scoreRootAt(anchorCents, field, opts = {}) {
  const degreeTemplate = opts.degreeTemplate || ALL_DEGREES;
  const perDegree = new Array(12).fill(0);
  let wSum = 0;
  for (const star of field || []) {
    const weight = star.weight > 0 ? star.weight : 0;
    if (!weight || !star.tones) continue;
    wSum += weight;
    const pool = poolFromTones(star.tones, anchorCents);
    for (let d = 0; d < 12; d++) { const slot = pool[d]; if (slot) perDegree[d] += weight * gainForDev(slot.dev); }
  }
  if (wSum > 0) for (let d = 0; d < 12; d++) perDegree[d] /= wSum;
  const explicitTargets = opts.targetsCents || opts.policy?.targets;
  if (!explicitTargets) {
    const score = degreeTemplate.length ? degreeTemplate.reduce((sum, d) => sum + perDegree[d], 0) / degreeTemplate.length : 0;
    return { score, perDegree, perTarget: degreeTemplate.map(degree => perDegree[degree]) };
  }

  const targets = normalizeCentTargets(explicitTargets);
  const tolerance = Math.max(0, Number.isFinite(opts.toleranceCents ?? opts.policy?.toleranceCents)
    ? Number(opts.toleranceCents ?? opts.policy?.toleranceCents) : Infinity);
  const perTarget = new Array(targets.length).fill(0);
  let targetWeight = 0;
  for (const star of field || []) {
    const weight = star.weight > 0 ? star.weight : 0;
    if (!weight || !star.tones) continue;
    targetWeight += weight;
    for (let index = 0; index < targets.length; index++) {
      const absoluteTarget = wrapOctaveCents(anchorCents + targets[index]);
      let bestDeviation = Infinity;
      for (const tone of star.tones) {
        const deviation = signedCircularCentsDistance(tone.c, absoluteTarget);
        if (Math.abs(deviation) < Math.abs(bestDeviation)) bestDeviation = deviation;
      }
      if (Math.abs(bestDeviation) <= tolerance) perTarget[index] += weight * gainForDev(bestDeviation);
    }
  }
  if (targetWeight > 0) for (let index = 0; index < perTarget.length; index++) perTarget[index] /= targetWeight;
  const score = perTarget.length ? perTarget.reduce((sum, value) => sum + value, 0) / perTarget.length : 0;
  return { score, perDegree, perTarget, targets };
}

// Remove only literal 1/1 from root competition. A folded fundamental tone remains eligible when its
// source list also contains 2/1, 4/1, …; in that case the surviving octave identity becomes the row ID.
export function rootCompetitionTones(tones, rowFundamental = true) {
  if (rowFundamental !== false) return tones || [];
  const out = [];
  for (const tone of tones || []) {
    const sources = (tone.sourceFractions || [tone.f]).filter(fraction => fraction !== '1/1');
    if (!sources.length) continue;
    out.push({ ...tone, f: tone.f === '1/1' ? sources[0] : tone.f, sourceFractions: sources });
  }
  return out;
}

// "Simplest fraction" tie-break (mirrors ProgressionSolver's deterministic sort: strongest first, then
// simplest root) — a reduced n/d string's simplicity is its denominator (smaller = simpler), then its
// numerator. `decimalToFraction` always emits reduced fractions, so this is a real complexity measure,
// not a string-length proxy.
function fractionKey(fraction) {
  const [n, d] = fraction.split('/').map(Number);
  return [d, n];
}
function compareFraction(a, b) {
  const [ad, an] = fractionKey(a), [bd, bn] = fractionKey(b);
  return ad - bd || an - bn;
}

// solveRoots(field, opts) — field = [{ tones, weight }] (tones = a star's anchor-independent tone
// list from B1, z.skyTones; weight = its audibility/distance weight, same convention as coverage()'s
// audibleStars). Returns the FULL ranked ladder [{ fraction, cents, score, perDegree }], sorted by
// score (descending) then simplest fraction then cents (full determinism on exact ties) — not just
// the winner: Avery wants the hierarchy kept for later modulation ("exhaust a progression in place →
// change keys to the runner-up root"). Candidate roots = the distinct tones of the WHOLE field
// (deduped across stars by the same 0.5¢ bin B1 already uses — a shared tone contributed by several
// stars is one candidate, not several identical rows). opts.degreeTemplate (default all 12 degrees)
// is the required-degree set — the parameter diatonic/harmonic-minor/etc. scale templates will use
// later; v1 ships chromatic-only. Empty field → empty ladder (caller keeps the 1/1 default).
export function solveRoots(field, opts = {}) {
  if (!field || !field.length) return [];

  const candidates = [], seenBins = new Set();
  for (const star of field) {
    if (!star.tones) continue;
    for (const t of star.tones) {
      const bin = Math.round(t.c / TONE_BIN_CENTS);
      if (seenBins.has(bin)) continue;
      seenBins.add(bin);
      candidates.push(t);
    }
  }

  const ladder = candidates.map(({ f, c }) => {
    const { score, perDegree } = scoreRootAt(c, field, opts);
    return { fraction: f, cents: c, score, perDegree };
  });
  ladder.sort((a, b) => b.score - a.score || compareFraction(a.fraction, b.fraction) || a.cents - b.cents);
  return ladder;
}
