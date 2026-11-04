// harmony-policy.js — engine-agnostic harmonic membership in octave-relative cents.
// UI, bed, rows, exposure, root solving, workers, and MIDI all consume this normalized contract.

export const HARMONY_SOURCES = Object.freeze({
  CHORD_WALK: 'chord-walk',
  SCALE: 'scale',
});

export const DEFAULT_HARMONY_SOURCE = HARMONY_SOURCES.CHORD_WALK;
export const DEFAULT_SCALE_POLICY = 'diatonic-major';
export const DEFAULT_HARMONY_TOLERANCE_CENTS = 15;
export const DEFAULT_LEAD_WINDOW_CENTS = 35;

export const wrapOctaveCents = value => {
  const n = Number(value);
  return Number.isFinite(n) ? ((n % 1200) + 1200) % 1200 : 0;
};

export function signedCircularCentsDistance(value, target) {
  let distance = wrapOctaveCents(value) - wrapOctaveCents(target);
  if (distance > 600) distance -= 1200;
  if (distance <= -600) distance += 1200;
  return distance;
}

export function normalizeCentTargets(targets) {
  return [...new Set((targets || []).filter(Number.isFinite).map(wrapOctaveCents).map(value => Math.round(value * 1e6) / 1e6))]
    .sort((a, b) => a - b);
}

export const ratioToCentsExact = ratio => {
  const [n, d = 1] = String(ratio).split('/').map(Number);
  return 1200 * Math.log2(n / d);
};

// Smallest circular gap between neighbouring targets — what bounds a scale's match windows.
export function smallestStepCents(targets) {
  const sorted = normalizeCentTargets(targets);
  if (sorted.length < 2) return 1200;
  let smallest = 1200 - sorted[sorted.length - 1] + sorted[0];
  for (let i = 1; i < sorted.length; i++) smallest = Math.min(smallest, sorted[i] - sorted[i - 1]);
  return smallest;
}

// Targeted scales (everything past chromatic / diatonic-major). The two 12TET presets approximate equal
// temperament on purpose and keep the global windows; these aim at exact ratio boundaries instead, so each
// one carries:
//   ratios      the source of truth (the 7-EDO is the one cents-defined member, ratios null)
//   bed         the three targets the ambient bed voices. flight-view pins them into each star's 12-slot pool
//               (sky-root poolFromTones), so a 7/4 target is not lost to a 16/9 that sits nearer 1000¢.
//   windows     the row/root window is at most a third of the smallest step and the lead window at most half,
//               so neighbouring targets never share a tone. All nine below land on the global 15¢ / 35¢; the
//               clamp is there for denser scales later (shrutis, 31-EDO).
function targetedScale(id, label, { ratios = null, cents = null, bed }) {
  const targets = ratios ? ratios.map(ratioToCentsExact) : cents;
  const bedTargets = bed.map(value => typeof value === 'string' ? ratioToCentsExact(value) : value);
  const step = smallestStepCents(targets);
  return Object.freeze({
    id, label,
    ratios: ratios ? Object.freeze([...ratios]) : null,
    targets: Object.freeze(normalizeCentTargets(targets)),
    bedTargets: Object.freeze(normalizeCentTargets(bedTargets)),
    toleranceCents: Math.min(DEFAULT_HARMONY_TOLERANCE_CENTS, step / 3),
    leadWindowCents: Math.min(DEFAULT_LEAD_WINDOW_CENTS, step / 2),
  });
}

export const SCALE_POLICIES = Object.freeze({
  chromatic: Object.freeze({ id: 'chromatic', label: 'CHROMATIC', targets: Object.freeze(Array.from({ length: 12 }, (_, i) => i * 100)) }),
  'diatonic-major': Object.freeze({ id: 'diatonic-major', label: 'DIATONIC MAJOR', targets: Object.freeze([0, 200, 400, 500, 700, 900, 1100]) }),
  'just-major': targetedScale('just-major', 'JUST MAJOR', {
    ratios: ['1/1', '9/8', '5/4', '4/3', '3/2', '5/3', '15/8'], bed: ['1/1', '5/4', '3/2'] }),
  // Overtones 8–15: the rows are literally harmonics, so this is the field's native mode. Bed 4:5:7.
  'harmonic-8-16': targetedScale('harmonic-8-16', 'HARMONIC 8–16', {
    ratios: ['1/1', '9/8', '5/4', '11/8', '3/2', '13/8', '7/4', '15/8'], bed: ['1/1', '5/4', '7/4'] }),
  // Undertones 16–9, the mirror. Bed is the undertone triad 16:12:10.
  'subharmonic-16-8': targetedScale('subharmonic-16-8', 'SUBHARMONIC 16–8', {
    ratios: ['1/1', '16/15', '8/7', '16/13', '4/3', '16/11', '8/5', '16/9'], bed: ['1/1', '4/3', '8/5'] }),
  // Wilson's combination-product set, pairs of {1,3,5,7} over 1·3 — an octahedron in the 3·5·7 lattice, no 3/2.
  // Bed is its 3:5:7 triad (the pairs that share the factor 1).
  'hexany-1357': targetedScale('hexany-1357', 'HEXANY 1·3·5·7', {
    ratios: ['1/1', '7/6', '5/4', '35/24', '5/3', '7/4'], bed: ['1/1', '7/6', '5/3'] }),
  'slendro-7': targetedScale('slendro-7', 'SLENDRO (7-LIMIT)', {
    ratios: ['1/1', '8/7', '21/16', '3/2', '7/4'], bed: ['1/1', '3/2', '7/4'] }),
  // Neutral third and seventh (11/9, 11/6) — between the piano keys.
  'maqam-rast': targetedScale('maqam-rast', 'MAQAM RAST', {
    ratios: ['1/1', '9/8', '11/9', '4/3', '3/2', '27/16', '11/6'], bed: ['1/1', '11/9', '3/2'] }),
  // Neutral second (12/11).
  'maqam-bayati': targetedScale('maqam-bayati', 'MAQAM BAYATI', {
    ratios: ['1/1', '12/11', '32/27', '4/3', '3/2', '128/81', '16/9'], bed: ['1/1', '32/27', '3/2'] }),
  // 3-limit: its 81/64 third sits a syntonic comma above Just Major's 5/4, so the two catch different thirds.
  'gong-pentatonic': targetedScale('gong-pentatonic', 'GONG PENTATONIC', {
    ratios: ['1/1', '9/8', '81/64', '3/2', '27/16'], bed: ['1/1', '81/64', '3/2'] }),
  'thai-7edo': targetedScale('thai-7edo', 'THAI 7-EDO', {
    cents: Array.from({ length: 7 }, (_, i) => i * 1200 / 7), bed: [0, 1200 * 2 / 7, 1200 * 4 / 7] }),
});

export function normalizeHarmonyPolicy({
  source = DEFAULT_HARMONY_SOURCE,
  scaleId = DEFAULT_SCALE_POLICY,
  chordId = 0,
  chordTargets = [0, 400, 700],
  toleranceCents = DEFAULT_HARMONY_TOLERANCE_CENTS,
} = {}) {
  const normalizedSource = source === HARMONY_SOURCES.SCALE ? HARMONY_SOURCES.SCALE : HARMONY_SOURCES.CHORD_WALK;
  const scale = SCALE_POLICIES[scaleId] || SCALE_POLICIES[DEFAULT_SCALE_POLICY];
  const targets = normalizeCentTargets(normalizedSource === HARMONY_SOURCES.SCALE ? scale.targets : chordTargets);
  const requested = Math.max(0, Number.isFinite(+toleranceCents) ? +toleranceCents : DEFAULT_HARMONY_TOLERANCE_CENTS);
  // A targeted scale's window is a ceiling on the caller's; the 12TET presets and the walk carry none.
  const targeted = normalizedSource === HARMONY_SOURCES.SCALE && scale.bedTargets;
  const tolerance = targeted ? Math.min(requested, scale.toleranceCents) : requested;
  return Object.freeze({
    id: normalizedSource === HARMONY_SOURCES.SCALE ? scale.id : `chord-walk:${chordId}`,
    source: normalizedSource,
    scaleId: normalizedSource === HARMONY_SOURCES.SCALE ? scale.id : null,
    targets: Object.freeze(targets),
    toleranceCents: tolerance,
    ...(targeted ? { ratios: scale.ratios, bedTargets: scale.bedTargets, leadWindowCents: scale.leadWindowCents } : {}),
  });
}

export function matchHarmonyTarget(toneCents, rootCents, policy) {
  if (!Number.isFinite(toneCents) || !Number.isFinite(rootCents) || !policy?.targets?.length) return null;
  const relativeCents = wrapOctaveCents(toneCents - rootCents);
  let best = null;
  for (let index = 0; index < policy.targets.length; index++) {
    const targetCents = policy.targets[index];
    const deviationCents = signedCircularCentsDistance(relativeCents, targetCents);
    if (!best || Math.abs(deviationCents) < Math.abs(best.deviationCents)) {
      best = { targetIndex: index, targetCents, deviationCents };
    }
  }
  return { ...best, relativeCents, selected: Math.abs(best.deviationCents) <= policy.toleranceCents };
}

// Stable scale-bed articulation: take the policy tones nearest a root/third/fifth guide. This keeps the
// existing three-voices-per-star budget while deriving every voice from the same policy the rows use.
// Chord Walk voices its complete current vocabulary member. A targeted scale names its own triad.
export function bedTargetsForPolicy(policy) {
  if (policy?.bedTargets) return [...policy.bedTargets];
  const targets = policy?.targets || [];
  if (policy?.source !== HARMONY_SOURCES.SCALE || targets.length <= 3) return [...targets];
  return [...new Set([0, 400, 700].map(guide => targets.reduce((best, target) =>
    Math.abs(signedCircularCentsDistance(target, guide)) < Math.abs(signedCircularCentsDistance(best, guide)) ? target : best,
  targets[0])))].sort((a, b) => a - b);
}

// Perf: the definition key re-normalizes `policy.targets` on every call, and the hot paths (per-tick lead
// mask, per-frame row selection key) ask for it constantly against an unchanged policy. Memoize by policy
// identity — but ONLY for frozen policies, whose targets can never mutate out from under a cached key.
// normalizeHarmonyPolicy freezes its output, so the hot-path policies hit this; ad-hoc/unfrozen policies
// (never on the hot path) always recompute, so there is no staleness risk.
const _definitionKeyCache = new WeakMap();
export function harmonyPolicyDefinitionKey(policy) {
  const cacheable = policy !== null && typeof policy === 'object' && Object.isFrozen(policy);
  if (cacheable) { const hit = _definitionKeyCache.get(policy); if (hit !== undefined) return hit; }
  const targets = normalizeCentTargets(policy?.targets);
  const key = `policy:${policy?.id || 'none'}|source:${policy?.source || 'none'}|targets:${targets.join(',')}|window:${policy?.toleranceCents ?? DEFAULT_HARMONY_TOLERANCE_CENTS}`;
  if (cacheable) _definitionKeyCache.set(policy, key);
  return key;
}

// Root-selection invalidation key. The key CENTER a starfield implies is a function of the harmony SOURCE
// and (in scale mode) the SCALE — NOT of which chord the walk is currently on. In chord-walk mode the
// per-chord `id`/`targets` change on every boundary, so keying root invalidation on harmonyPolicyDefinitionKey
// (a) churns the ~30 s root solve into one-per-chord, and (b) makes the boundary guard reject every ladder it
// just solved — a normal walk advance looked like a policy change, so the root could never leave 1/1. This
// key omits the chord so a walk advance is NOT a root-policy change; a source or scale switch still is. The
// row fundamental is tracked separately by the caller (it feeds rootCompetitionTones, not the harmony frame).
export function rootPolicyStableKey(policy) {
  const source = policy?.source === HARMONY_SOURCES.SCALE ? HARMONY_SOURCES.SCALE : HARMONY_SOURCES.CHORD_WALK;
  const scale = source === HARMONY_SOURCES.SCALE ? (policy?.scaleId || DEFAULT_SCALE_POLICY) : 'walk';
  return `rootpolicy:${source}|${scale}`;
}

export function harmonyPolicySelectionKey(root, policy) {
  const rootIdentity = `${root?.rootKey ?? 'none'}:${root?.fraction ?? 'none'}:${Number.isFinite(root?.cents) ? wrapOctaveCents(root.cents).toFixed(6) : 'none'}`;
  return `${harmonyPolicyDefinitionKey(policy)}|root:${rootIdentity}`;
}
