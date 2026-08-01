// harmony-policy.js — engine-agnostic harmonic membership in octave-relative cents.
// UI, bed, rows, exposure, root solving, workers, and MIDI all consume this normalized contract.

export const HARMONY_SOURCES = Object.freeze({
  CHORD_WALK: 'chord-walk',
  SCALE: 'scale',
});

export const SCALE_POLICIES = Object.freeze({
  chromatic: Object.freeze({ id: 'chromatic', label: 'CHROMATIC', targets: Object.freeze(Array.from({ length: 12 }, (_, i) => i * 100)) }),
  'diatonic-major': Object.freeze({ id: 'diatonic-major', label: 'DIATONIC MAJOR', targets: Object.freeze([0, 200, 400, 500, 700, 900, 1100]) }),
});

export const DEFAULT_HARMONY_SOURCE = HARMONY_SOURCES.CHORD_WALK;
export const DEFAULT_SCALE_POLICY = 'diatonic-major';
export const DEFAULT_HARMONY_TOLERANCE_CENTS = 15;

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
  const tolerance = Math.max(0, Number.isFinite(+toleranceCents) ? +toleranceCents : DEFAULT_HARMONY_TOLERANCE_CENTS);
  return Object.freeze({
    id: normalizedSource === HARMONY_SOURCES.SCALE ? scale.id : `chord-walk:${chordId}`,
    source: normalizedSource,
    scaleId: normalizedSource === HARMONY_SOURCES.SCALE ? scale.id : null,
    targets: Object.freeze(targets),
    toleranceCents: tolerance,
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
// Chord Walk voices its complete current vocabulary member.
export function bedTargetsForPolicy(policy) {
  const targets = policy?.targets || [];
  if (policy?.source !== HARMONY_SOURCES.SCALE || targets.length <= 3) return [...targets];
  return [...new Set([0, 400, 700].map(guide => targets.reduce((best, target) =>
    Math.abs(signedCircularCentsDistance(target, guide)) < Math.abs(signedCircularCentsDistance(best, guide)) ? target : best,
  targets[0])))].sort((a, b) => a - b);
}

export function harmonyPolicyDefinitionKey(policy) {
  const targets = normalizeCentTargets(policy?.targets);
  return `policy:${policy?.id || 'none'}|source:${policy?.source || 'none'}|targets:${targets.join(',')}|window:${policy?.toleranceCents ?? DEFAULT_HARMONY_TOLERANCE_CENTS}`;
}

export function harmonyPolicySelectionKey(root, policy) {
  const rootIdentity = `${root?.rootKey ?? 'none'}:${root?.fraction ?? 'none'}:${Number.isFinite(root?.cents) ? wrapOctaveCents(root.cents).toFixed(6) : 'none'}`;
  return `${harmonyPolicyDefinitionKey(policy)}|root:${rootIdentity}`;
}
