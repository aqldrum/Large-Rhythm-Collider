// sky-modulation.js — pure policy for Sky Root establishment + modulation. This module owns no audio,
// camera, DOM, or transport state. It turns a solved root ladder plus explicit phrase/geography state
// into inspectable normalization, trigger, and destination-ranking decisions. cosmos-audio.js consumes
// the same boundary decision that Full Sky Debug displays; see SKY_MODULATION_POLICY_2026-07-24.md.

const OCTAVE_CENTS = 1200;
const ROOT_ID_BIN_CENTS = 0.5;

export const ROOT_POLICY_DEFAULTS = Object.freeze({
  rootSpreadEpsilon: 0.15,             // raw score units; a narrow ladder stays intentionally vague
  arrivalSpreadEpsilon: 0.15,          // same protection for arrival-chord coverage across roots
  geographicMinFitnessAdvantage: 0.10,// normalized points required in addition to the raw margin
  antiNoiseRelativeMargin: 0.015,      // 1.5% raw-score improvement; exact ties keep the incumbent
  minDwellChords: 4,                   // chord boundaries completed since the last root change
  topBandWidth: 0.20,                  // normalized fitness below the current ladder leader
  sameRootCents: 0.5,                  // sub-bin relabelings are not modulations
  recentRootLimit: 3,
  preferredMotionCents: 300,           // first-pass moderate-nearby target on the octave circle
  rootFitnessWeight: 0.65,
  arrivalFitnessWeight: 0.35,
});

const clamp01 = n => Math.max(0, Math.min(1, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const mod = (n, d) => ((n % d) + d) % d;

export function circularCentsDistance(a, b) {
  const d = Math.abs(mod(finite(a) - finite(b), OCTAVE_CENTS));
  return Math.min(d, OCTAVE_CENTS - d);
}

// Root identity is harmonic position, not rootKey: rootKey is a cache version and changes when the
// same root is revisited. The 0.5-cent bin mirrors the tone dedupe law used by the root solver.
export function rootIdentity(root) {
  const cents = typeof root === 'number' ? root : root?.cents;
  if (!Number.isFinite(cents)) return null;
  const binsPerOctave = Math.round(OCTAVE_CENTS / ROOT_ID_BIN_CENTS);
  return `c${mod(Math.round(mod(cents, OCTAVE_CENTS) / ROOT_ID_BIN_CENTS), binsPerOctave)}`;
}

function fractionKey(fraction) {
  const [n, d] = String(fraction || '').split('/').map(Number);
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? [Math.abs(d), Math.abs(n)] : [Infinity, Infinity];
}

function compareFraction(a, b) {
  const [ad, an] = fractionKey(a), [bd, bn] = fractionKey(b);
  return ad - bd || an - bn || String(a).localeCompare(String(b));
}

function compareRawRows(a, b) {
  return b.score - a.score || compareFraction(a.fraction, b.fraction) || a.cents - b.cents;
}

// Normalize against the LADDER'S raw range, not an absolute 0..1 scale. The epsilon floor is the
// crucial saturation defense: if max-min is tiny, the normalized range is tiny too instead of being
// inflated to 0..1. The incumbent is projected through that same range even when it is not a ladder
// candidate, and clamped for diagnostics/trigger comparison.
export function normalizeRootLadder(ladder, incumbent, opts = {}) {
  const epsilon = Math.max(Number.EPSILON, finite(opts.rootSpreadEpsilon, ROOT_POLICY_DEFAULTS.rootSpreadEpsilon));
  const rows = (ladder || []).filter(row => row && Number.isFinite(row.score) && Number.isFinite(row.cents))
    .map(row => ({ ...row, rootId: rootIdentity(row) }))
    .sort(compareRawRows);
  const incumbentScore = finite(incumbent?.score);
  if (!rows.length) {
    return {
      rows: [],
      incumbent: incumbent ? { ...incumbent, rootId: rootIdentity(incumbent), score: incumbentScore, fitness: 0 } : null,
      minScore: 0, maxScore: 0, spread: 0, epsilon, denominator: epsilon, normalizedRange: 0,
    };
  }
  const maxScore = rows[0].score;
  const minScore = rows.reduce((min, row) => Math.min(min, row.score), Infinity);
  const spread = maxScore - minScore;
  const denominator = Math.max(spread, epsilon);
  const normalizedRows = rows.map((row, rank) => ({
    ...row,
    rank: rank + 1,
    fitness: clamp01((row.score - minScore) / denominator),
  }));
  const normalizedIncumbent = incumbent ? {
    ...incumbent,
    rootId: rootIdentity(incumbent),
    score: incumbentScore,
    fitness: clamp01((incumbentScore - minScore) / denominator),
  } : null;
  return {
    rows: normalizedRows,
    incumbent: normalizedIncumbent,
    minScore, maxScore, spread, epsilon, denominator,
    normalizedRange: spread / denominator,
  };
}

// The walk's deterministic state includes both the current chord and the ordered FIFO tabu contents.
// Keeping the duplicate current chord (normally the tabu tail) matches the existing chord-walk proof.
export function phraseStateKey(chordId, tabu = []) {
  return [chordId, ...(tabu || [])].join('|');
}

// Call at the moment a root is installed, using the chord/tabu state that will begin the new phrase.
export function resetPhraseTracker(rootKey, chordId, tabu = []) {
  const stateKey = phraseStateKey(chordId, tabu);
  return {
    rootKey,
    chordsSinceRootChange: 0,
    seenStateKeys: [stateKey],
    lastStateKey: stateKey,
    repeatedStateKey: null,
    exhaustionDue: false,
  };
}

// Observe the POST-ADVANCE state once per chord boundary. Repetition latches exhaustion until a root
// change resets the tracker, so a missing/stale ladder cannot make the musical event disappear.
export function observePhraseBoundary(tracker, { rootKey, chordId, tabu = [] }) {
  if (!tracker || tracker.rootKey !== rootKey) return {
    tracker: resetPhraseTracker(rootKey, chordId, tabu),
    stateKey: phraseStateKey(chordId, tabu),
    repeated: false,
  };
  const stateKey = phraseStateKey(chordId, tabu);
  const repeated = tracker.seenStateKeys.includes(stateKey);
  return {
    tracker: {
      ...tracker,
      chordsSinceRootChange: tracker.chordsSinceRootChange + 1,
      seenStateKeys: repeated ? [...tracker.seenStateKeys] : [...tracker.seenStateKeys, stateKey],
      lastStateKey: stateKey,
      repeatedStateKey: tracker.repeatedStateKey || (repeated ? stateKey : null),
      exhaustionDue: tracker.exhaustionDue || repeated,
    },
    stateKey,
    repeated,
  };
}

export function pushRecentRoot(history, root, limit = ROOT_POLICY_DEFAULTS.recentRootLimit) {
  if (!root || !Number.isFinite(root.cents) || limit <= 0) return [];
  const next = { fraction: root.fraction, cents: root.cents, rootId: rootIdentity(root) };
  const withoutDuplicate = (history || []).filter(item => circularCentsDistance(item.cents, next.cents) > ROOT_POLICY_DEFAULTS.sameRootCents);
  return [next, ...withoutDuplicate].slice(0, Math.floor(limit));
}

function isRecent(row, recentRoots, sameRootCents) {
  return (recentRoots || []).some(root => Number.isFinite(root?.cents) && circularCentsDistance(row.cents, root.cents) <= sameRootCents);
}

// Explain every ladder row before filtering it. The overlay uses this to show why a root did or did
// not enter the modulation contest instead of forcing a listener to reconstruct the policy from raw
// numbers. `geographicPass` is independent of settle/dwell/epoch: those gate the trigger as a whole.
export function classifyRootDestinations(normalized, { recentRoots = [] } = {}, opts = {}) {
  if (!normalized?.rows?.length || !normalized.incumbent) return [];
  const topBandWidth = Math.max(0, finite(opts.topBandWidth, ROOT_POLICY_DEFAULTS.topBandWidth));
  const sameRootCents = Math.max(0, finite(opts.sameRootCents, ROOT_POLICY_DEFAULTS.sameRootCents));
  const fitnessAdvantage = Math.max(0, finite(opts.geographicMinFitnessAdvantage, ROOT_POLICY_DEFAULTS.geographicMinFitnessAdvantage));
  const rawMargin = Math.max(0, finite(opts.antiNoiseRelativeMargin, ROOT_POLICY_DEFAULTS.antiNoiseRelativeMargin));
  const bestFitness = normalized.rows[0].fitness;
  return normalized.rows.map(row => {
    const sameRoot = circularCentsDistance(row.cents, normalized.incumbent.cents) <= sameRootCents;
    const recent = !sameRoot && isRecent(row, recentRoots, sameRootCents);
    const inTopBand = row.fitness >= bestFitness - topBandWidth;
    const geographicFitnessPass = row.fitness > normalized.incumbent.fitness + fitnessAdvantage;
    const geographicRawPass = beatsRawMargin(row.score, normalized.incumbent.score, rawMargin);
    const eligible = !sameRoot && !recent && inTopBand;
    const geographicPass = eligible && geographicFitnessPass && geographicRawPass;
    let statusCode = 'eligible', status = 'eligible';
    if (sameRoot) { statusCode = 'incumbent'; status = 'incumbent'; }
    else if (recent) { statusCode = 'recent'; status = 'recent'; }
    else if (!inTopBand) { statusCode = 'below-band'; status = 'below band'; }
    else if (!geographicRawPass) { statusCode = 'raw-margin-fail'; status = `geo Δraw < ${(rawMargin * 100).toFixed(1)}%`; }
    else if (!geographicFitnessPass) { statusCode = 'fitness-gap-fail'; status = `geo Δfit ≤ ${fitnessAdvantage.toFixed(2)}`; }
    else { statusCode = 'geographic-pass'; status = 'geographic pass'; }
    return { ...row, sameRoot, recent, inTopBand, eligible, geographicFitnessPass, geographicRawPass, geographicPass, statusCode, status };
  });
}

// The top band is established before exclusions, so history cannot promote a weak row into contention.
// Incumbent identity is cents-based because the incumbent may not occur as an exact ladder fraction.
export function eligibleRootDestinations(normalized, { recentRoots = [] } = {}, opts = {}) {
  return classifyRootDestinations(normalized, { recentRoots }, opts).filter(row => row.eligible);
}

function beatsRawMargin(candidateScore, incumbentScore, relativeMargin) {
  if (candidateScore <= incumbentScore) return false; // exact ties always keep the incumbent
  if (incumbentScore <= 0) return candidateScore > 0;
  return candidateScore > incumbentScore * (1 + relativeMargin);
}

// A proposal is usable only while the player is still settled in the same geographic epoch that
// produced it. This prevents both geographic and exhaustion modulation from consuming an old region's
// ladder after flight resumes. Geography wins the reason label if both triggers are simultaneously due.
export function evaluateModulationTrigger(normalized, tracker, context = {}, opts = {}) {
  const minDwellChords = Math.max(0, Math.floor(finite(opts.minDwellChords, ROOT_POLICY_DEFAULTS.minDwellChords)));
  const fitnessAdvantage = Math.max(0, finite(opts.geographicMinFitnessAdvantage, ROOT_POLICY_DEFAULTS.geographicMinFitnessAdvantage));
  const rawMargin = Math.max(0, finite(opts.antiNoiseRelativeMargin, ROOT_POLICY_DEFAULTS.antiNoiseRelativeMargin));
  const proposalValid = context.settled === true && context.proposalEpoch !== undefined &&
    context.currentEpoch !== undefined && Object.is(context.proposalEpoch, context.currentEpoch);
  const dwellReady = (tracker?.chordsSinceRootChange || 0) >= minDwellChords;
  const destinations = eligibleRootDestinations(normalized, { recentRoots: context.recentRoots || [] }, opts);
  const geographicCandidates = normalized?.incumbent ? destinations.filter(row =>
    row.fitness > normalized.incumbent.fitness + fitnessAdvantage &&
    beatsRawMargin(row.score, normalized.incumbent.score, rawMargin)) : [];
  const geographyDue = proposalValid && dwellReady && geographicCandidates.length > 0;
  const exhaustionDue = proposalValid && dwellReady && !!tracker?.exhaustionDue && destinations.length > 0;
  const reason = geographyDue ? 'geography' : exhaustionDue ? 'exhaustion' : null;
  return {
    due: reason !== null,
    reason,
    minDwellChords,
    proposalValid,
    dwellReady,
    geographyDue,
    exhaustionDue,
    geographicCandidateIds: geographicCandidates.map(row => row.rootId),
    destinationCount: destinations.length,
  };
}

// The fixed 1/1 state before the first solve is provisional, not a musically earned incumbent. The
// first valid settled solve establishes the root at the next chord boundary with no dwell requirement.
// A clearly better geographic candidate may replace 1/1; otherwise the flat/near-tied field explicitly
// validates retaining the deterministic incumbent. Either outcome ends bootstrap and starts phrase dwell.
export function evaluateBootstrapSelection(normalized, context = {}, opts = {}) {
  const geographic = evaluateModulationTrigger(normalized,
    { chordsSinceRootChange: 0, exhaustionDue: false }, context, { ...opts, minDwellChords: 0 });
  const due = geographic.proposalValid && !!normalized?.rows?.length && !!normalized.incumbent;
  const bootstrapChoice = geographic.geographyDue ? 'candidate' : 'incumbent';
  return {
    ...geographic,
    due,
    reason: due ? 'bootstrap' : null,
    bootstrapChoice,
    dwellReady: true,
    minDwellChords: 0,
  };
}

function arrivalCoverage(row, chordDegrees, harmonyTargets) {
  if (Array.isArray(harmonyTargets) && harmonyTargets.length && Array.isArray(row.perTarget)) {
    return row.perTarget.reduce((sum, value) => sum + finite(value), 0) / row.perTarget.length;
  }
  const degrees = [...new Set((chordDegrees || []).filter(d => Number.isInteger(d) && d >= 0 && d < 12))];
  if (!degrees.length || !Array.isArray(row.perDegree)) return 0;
  return degrees.reduce((sum, degree) => sum + finite(row.perDegree[degree]), 0) / degrees.length;
}

// Rank only after a trigger is due. Geography may choose only roots that actually cleared its two
// superiority tests; exhaustion may choose any non-recent root in the normalized top band. The local-
// tuning control keeps its semitone-cost meaning: across the candidate set, tuning can offset at most
// `tuningStrength` semitones of departure from the preferred root-motion distance.
export function rankModulationDestinations(normalized, trigger, {
  chordDegrees = [],
  harmonyTargets = [],
  recentRoots = [],
  tuningStrength = 2,
} = {}, opts = {}) {
  if (!trigger?.due || !normalized?.incumbent) return [];
  if (trigger.reason === 'bootstrap' && trigger.bootstrapChoice !== 'candidate') return [];
  let rows = eligibleRootDestinations(normalized, { recentRoots }, opts);
  if (trigger.reason === 'geography' || trigger.reason === 'bootstrap') {
    const allowed = new Set(trigger.geographicCandidateIds || []);
    rows = rows.filter(row => allowed.has(row.rootId));
  }
  if (!rows.length) return [];

  const arrivalEpsilon = Math.max(Number.EPSILON, finite(opts.arrivalSpreadEpsilon, ROOT_POLICY_DEFAULTS.arrivalSpreadEpsilon));
  const preferredMotion = Math.max(0, Math.min(600, finite(opts.preferredMotionCents, ROOT_POLICY_DEFAULTS.preferredMotionCents)));
  const lambda = Math.max(0, finite(tuningStrength));
  const rootWeight = Math.max(0, finite(opts.rootFitnessWeight, ROOT_POLICY_DEFAULTS.rootFitnessWeight));
  const arrivalWeight = Math.max(0, finite(opts.arrivalFitnessWeight, ROOT_POLICY_DEFAULTS.arrivalFitnessWeight));
  const weightSum = rootWeight + arrivalWeight || 1;

  const withArrival = rows.map(row => ({ ...row, arrivalCoverage: arrivalCoverage(row, chordDegrees, harmonyTargets) }));
  const maxArrival = Math.max(...withArrival.map(row => row.arrivalCoverage));
  const minArrival = Math.min(...withArrival.map(row => row.arrivalCoverage));
  const arrivalSpread = maxArrival - minArrival;
  const arrivalDenominator = Math.max(arrivalSpread, arrivalEpsilon);
  const scored = withArrival.map(row => {
    const arrivalFitness = clamp01((row.arrivalCoverage - minArrival) / arrivalDenominator);
    const goalFitness = (rootWeight * row.fitness + arrivalWeight * arrivalFitness) / weightSum;
    const motionCents = circularCentsDistance(normalized.incumbent.cents, row.cents);
    const motionCost = Math.abs(motionCents - preferredMotion) / 100;
    return { ...row, arrivalFitness, goalFitness, motionCents, motionCost };
  });
  const bestGoalFitness = Math.max(...scored.map(row => row.goalFitness));
  return scored.map(row => {
    const tuningCost = lambda * (bestGoalFitness - row.goalFitness);
    return { ...row, tuningCost, cost: row.motionCost + tuningCost };
  }).sort((a, b) =>
    a.cost - b.cost ||
    b.fitness - a.fitness ||
    b.arrivalFitness - a.arrivalFitness ||
    compareFraction(a.fraction, b.fraction) ||
    a.cents - b.cents);
}

// Shared pure boundary decision used by live playback and the overlay. Bootstrap can be actionable
// without a winner (that means "establish the incumbent"); later modulation is actionable only when a
// trigger is due and ranking produced a concrete destination.
export function decideRootAtBoundary(normalized, tracker, context, {
  established = false,
  chordDegrees = [],
  harmonyTargets = [],
  recentRoots = [],
  tuningStrength = 2,
} = {}, opts = {}) {
  const trigger = established
    ? evaluateModulationTrigger(normalized, tracker, { ...context, recentRoots }, opts)
    : evaluateBootstrapSelection(normalized, { ...context, recentRoots }, opts);
  const ranking = rankModulationDestinations(normalized, trigger,
    { chordDegrees, harmonyTargets, recentRoots, tuningStrength }, opts);
  const winner = ranking[0] || null;
  return {
    trigger,
    ranking,
    winner,
    actionable: established ? trigger.due && !!winner : trigger.due,
    establishesRoot: !established && trigger.due,
  };
}
