// assert-sky-modulation.mjs — headless guards for the pure Sky Root modulation policy. No audio,
// camera, DOM, or transport integration belongs in this pass.
import {
  ROOT_POLICY_DEFAULTS,
  circularCentsDistance,
  rootIdentity,
  normalizeRootLadder,
  phraseStateKey,
  resetPhraseTracker,
  observePhraseBoundary,
  pushRecentRoot,
  classifyRootDestinations,
  eligibleRootDestinations,
  evaluateModulationTrigger,
  evaluateBootstrapSelection,
  rankModulationDestinations,
  decideRootAtBoundary,
} from '../sky-modulation.js';

let PASS = true;
const check = (name, ok, detail = '') => {
  PASS = PASS && ok;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;
const degrees = value => new Array(12).fill(value);

console.log('═══ SKY MODULATION POLICY — assertions ═══');

console.log('\n── Ladder normalization ──');
const narrow = normalizeRootLadder([
  { fraction: '3/2', cents: 702, score: 0.751, perDegree: degrees(0.7) },
  { fraction: '1/1', cents: 0, score: 0.750, perDegree: degrees(0.7) },
  { fraction: '5/4', cents: 386, score: 0.749, perDegree: degrees(0.7) },
], { fraction: '1/1', cents: 0, score: 0.750 });
check('narrow raw spread is not inflated to a full 0..1 ladder',
  near(narrow.normalizedRange, 0.002 / ROOT_POLICY_DEFAULTS.rootSpreadEpsilon));
check('incumbent is projected through the same ladder denominator',
  near(narrow.incumbent.fitness, 0.001 / ROOT_POLICY_DEFAULTS.rootSpreadEpsilon));

const wide = normalizeRootLadder([
  { fraction: '5/4', cents: 386, score: 0.9, perDegree: degrees(0.8) },
  { fraction: '3/2', cents: 702, score: 0.7, perDegree: degrees(0.7) },
  { fraction: '1/1', cents: 0, score: 0.5, perDegree: degrees(0.6) },
], { fraction: '9/8', cents: 204, score: 0.6 });
check('meaningful spread uses its real range', near(wide.rows[0].fitness, 1) && near(wide.rows[2].fitness, 0));
check('an incumbent absent from the ladder is still normalized comparably', near(wide.incumbent.fitness, 0.25));
check('raw diagnostics survive normalization untouched', wide.rows[0].score === 0.9 && wide.rows[0].perDegree[0] === 0.8);

console.log('\n── Phrase tracking ──');
check('phrase key preserves ordered chord + tabu state', phraseStateKey(4, [0, 2, 4]) === '4|0|2|4');
let tracker = resetPhraseTracker(7, 0, [0]);
for (const state of [
  { chordId: 3, tabu: [0, 3] },
  { chordId: 8, tabu: [0, 3, 8] },
  { chordId: 5, tabu: [3, 8, 5] },
]) tracker = observePhraseBoundary(tracker, { rootKey: 7, ...state }).tracker;
const repeated = observePhraseBoundary(tracker, { rootKey: 7, chordId: 3, tabu: [0, 3] });
tracker = repeated.tracker;
check('first repeated deterministic state marks exhaustion', repeated.repeated && tracker.exhaustionDue);
check('dwell counts completed chord boundaries', tracker.chordsSinceRootChange === 4);
const afterAnother = observePhraseBoundary(tracker, { rootKey: 7, chordId: 9, tabu: [8, 5, 9] }).tracker;
check('exhaustion remains latched until modulation can act', afterAnother.exhaustionDue && afterAnother.repeatedStateKey === '3|0|3');
const resetByRoot = observePhraseBoundary(afterAnother, { rootKey: 8, chordId: 9, tabu: [9] }).tracker;
check('a new root resets phrase memory and dwell', resetByRoot.chordsSinceRootChange === 0 && !resetByRoot.exhaustionDue && resetByRoot.seenStateKeys.length === 1);

console.log('\n── Identity, history, and top-band eligibility ──');
check('root identity wraps equivalent octave-edge cents into one bin', rootIdentity({ cents: 1199.9 }) === rootIdentity({ cents: 0.1 }));
check('circular cents distance treats the octave edge as adjacent', near(circularCentsDistance(1190, 10), 20));
let history = pushRecentRoot([], { fraction: '3/2', cents: 702 }, 3);
history = pushRecentRoot(history, { fraction: '5/4', cents: 386 }, 3);
history = pushRecentRoot(history, { fraction: '3/2', cents: 702.1 }, 3);
check('recent-root history is newest-first and dedupes equivalent positions', history.length === 2 && history[0].fraction === '3/2');

const eligibility = normalizeRootLadder([
  { fraction: '5/4', cents: 386, score: 0.90, perDegree: degrees(0.8) },
  { fraction: '3/2', cents: 702, score: 0.86, perDegree: degrees(0.8) },
  { fraction: '1/1', cents: 0.2, score: 0.85, perDegree: degrees(0.8) },
  { fraction: '7/4', cents: 969, score: 0.50, perDegree: degrees(0.8) },
], { fraction: '1/1', cents: 0, score: 0.85 });
const eligible = eligibleRootDestinations(eligibility, { recentRoots: [{ cents: 702 }] });
check('eligibility excludes incumbent-equivalent, recent, and below-band roots', eligible.length === 1 && eligible[0].fraction === '5/4');
const classified = classifyRootDestinations(eligibility, { recentRoots: [{ cents: 702 }] });
check('classification explains incumbent, recent, eligible, and below-band rows',
  classified.find(row => row.fraction === '1/1').status === 'incumbent' &&
  classified.find(row => row.fraction === '3/2').status === 'recent' &&
  classified.find(row => row.fraction === '5/4').status === 'geographic pass' &&
  classified.find(row => row.fraction === '7/4').status === 'below band');
check('failed raw geography gate is labeled as a delta test, not harmonic unsustainability',
  classifyRootDestinations(narrow).some(row => row.status.startsWith('geo Δraw <')));

console.log('\n── Trigger evaluation ──');
const triggerLadder = normalizeRootLadder([
  { fraction: '5/4', cents: 386, score: 0.80, perDegree: degrees(0.9) },
  { fraction: '3/2', cents: 702, score: 0.76, perDegree: degrees(0.7) },
  { fraction: '1/1', cents: 0, score: 0.70, perDegree: degrees(0.6) },
], { fraction: '1/1', cents: 0, score: 0.70 });
const dueTracker = { ...tracker, chordsSinceRootChange: 4, exhaustionDue: true };
const validContext = { settled: true, proposalEpoch: 12, currentEpoch: 12, recentRoots: [] };
const moving = evaluateModulationTrigger(triggerLadder, dueTracker, { ...validContext, settled: false });
const stale = evaluateModulationTrigger(triggerLadder, dueTracker, { ...validContext, currentEpoch: 13 });
check('movement invalidates an otherwise due proposal', !moving.due && !moving.proposalValid);
check('a stale geographic epoch invalidates an otherwise due proposal', !stale.due && !stale.proposalValid);
const beforeDwell = evaluateModulationTrigger(triggerLadder, { ...dueTracker, chordsSinceRootChange: 3 }, validContext);
check('minimum root dwell gates both trigger types', !beforeDwell.due && !beforeDwell.dwellReady);
const geographic = evaluateModulationTrigger(triggerLadder, { ...dueTracker, exhaustionDue: false }, validContext);
check('clearly superior normalized + raw candidate triggers geography', geographic.due && geographic.reason === 'geography' && geographic.geographicCandidateIds.length > 0);

const exactTie = normalizeRootLadder([
  { fraction: '3/2', cents: 702, score: 0.75, perDegree: degrees(0.7) },
  { fraction: '1/1', cents: 0, score: 0.75, perDegree: degrees(0.7) },
], { fraction: '1/1', cents: 0, score: 0.75 });
const tieTrigger = evaluateModulationTrigger(exactTie, { ...dueTracker, exhaustionDue: false }, validContext, {
  geographicMinFitnessAdvantage: 0,
  antiNoiseRelativeMargin: 0,
});
check('exact root-score ties keep the incumbent', !tieTrigger.due);

const exhaustionOnlyLadder = normalizeRootLadder([
  { fraction: '1/1', cents: 0, score: 0.80, perDegree: degrees(0.7) },
  { fraction: '5/4', cents: 386, score: 0.78, perDegree: degrees(0.8) },
], { fraction: '1/1', cents: 0, score: 0.80 });
const exhaustion = evaluateModulationTrigger(exhaustionOnlyLadder, dueTracker, validContext);
check('phrase exhaustion can make modulation due without a superior root', exhaustion.due && exhaustion.reason === 'exhaustion' && !exhaustion.geographyDue);

console.log('\n── Bootstrap establishment ──');
const clearBootstrap = evaluateBootstrapSelection(triggerLadder, validContext);
check('first valid settled solve bypasses normal phrase dwell',
  clearBootstrap.due && clearBootstrap.reason === 'bootstrap' && clearBootstrap.dwellReady && clearBootstrap.bootstrapChoice === 'candidate');
const flatBootstrap = evaluateBootstrapSelection(exactTie, validContext);
check('flat first solve establishes the deterministic incumbent instead of inventing a modulation',
  flatBootstrap.due && flatBootstrap.bootstrapChoice === 'incumbent' && flatBootstrap.geographicCandidateIds.length === 0);
check('moving or stale first solve cannot establish a root',
  !evaluateBootstrapSelection(triggerLadder, { ...validContext, settled: false }).due &&
  !evaluateBootstrapSelection(triggerLadder, { ...validContext, currentEpoch: 99 }).due);

console.log('\n── Destination ranking ──');
const rankingLadder = normalizeRootLadder([
  { fraction: '5/4', cents: 300, score: 0.80, perDegree: degrees(0.2) },
  { fraction: '3/2', cents: 500, score: 0.85, perDegree: degrees(0.95) },
  { fraction: '1/1', cents: 0, score: 0.75, perDegree: degrees(0.5) },
], { fraction: '1/1', cents: 0, score: 0.75 }, { rootSpreadEpsilon: 0.10 });
const rankTrigger = { due: true, reason: 'exhaustion', geographicCandidateIds: [] };
const motionOnly = rankModulationDestinations(rankingLadder, rankTrigger,
  { chordDegrees: [0, 4, 7], tuningStrength: 0 }, { topBandWidth: 0.6 });
const tuningStrong = rankModulationDestinations(rankingLadder, rankTrigger,
  { chordDegrees: [0, 4, 7], tuningStrength: 8 }, { topBandWidth: 0.6 });
check('zero local-tuning strength chooses the preferred moderate motion', motionOnly[0].fraction === '5/4');
check('strong local tuning can spend extra motion on a better-tuned destination', tuningStrong[0].fraction === '3/2');
check('ranking exposes inspectable motion/tuning/arrival cost components',
  ['arrivalCoverage', 'arrivalFitness', 'goalFitness', 'motionCents', 'motionCost', 'tuningCost', 'cost'].every(key => Number.isFinite(tuningStrong[0][key])));

const tieRankLadder = normalizeRootLadder([
  { fraction: '5/3', cents: 200, score: 0.8, perDegree: degrees(0.7) },
  { fraction: '3/2', cents: 400, score: 0.8, perDegree: degrees(0.7) },
  { fraction: '1/1', cents: 0, score: 0.7, perDegree: degrees(0.7) },
], { fraction: '1/1', cents: 0, score: 0.7 });
const deterministic = rankModulationDestinations(tieRankLadder, rankTrigger,
  { chordDegrees: [0, 4, 7], tuningStrength: 2 }, { topBandWidth: 1 });
check('exact ranking ties use deterministic fraction simplicity', deterministic[0].fraction === '3/2');

const geographyRestricted = rankModulationDestinations(rankingLadder,
  { due: true, reason: 'geography', geographicCandidateIds: [rootIdentity({ cents: 500 })] },
  { chordDegrees: [0, 4, 7], tuningStrength: 0 }, { topBandWidth: 1 });
check('geographic ranking cannot select a root that failed the trigger thresholds', geographyRestricted.length === 1 && geographyRestricted[0].fraction === '3/2');
check('no due trigger produces no ranked destination', rankModulationDestinations(rankingLadder, { due: false }, {}).length === 0);

const liveBootstrap = decideRootAtBoundary(triggerLadder, resetPhraseTracker(0, 0, [0]), validContext,
  { established: false, chordDegrees: [0, 4, 7], recentRoots: [], tuningStrength: 2 });
check('shared boundary decision makes a clear first solve actionable with a ranked winner',
  liveBootstrap.actionable && liveBootstrap.establishesRoot && liveBootstrap.winner?.fraction === '5/4');
const retainBootstrap = decideRootAtBoundary(exactTie, resetPhraseTracker(0, 0, [0]), validContext,
  { established: false, chordDegrees: [0, 4, 7], recentRoots: [], tuningStrength: 2 });
check('shared boundary decision can establish the incumbent without fabricating a winner',
  retainBootstrap.actionable && retainBootstrap.establishesRoot && retainBootstrap.winner === null);
const liveModulation = decideRootAtBoundary(exhaustionOnlyLadder, dueTracker, validContext,
  { established: true, chordDegrees: [0, 4, 7], recentRoots: [], tuningStrength: 2 });
check('shared boundary decision promotes exhaustion to a concrete live destination after establishment',
  liveModulation.actionable && !liveModulation.establishesRoot && liveModulation.trigger.reason === 'exhaustion' && !!liveModulation.winner);

console.log(`\n${PASS ? '✓ ALL SKY MODULATION POLICY ASSERTIONS PASS' : '✗ SKY MODULATION POLICY ASSERTIONS FAILED'}\n`);
if (!PASS) process.exit(1);
