// assert-fullsky.mjs — proofs for the Full Sky redesign (see ../FULL_SKY_HANDOFF.md). One guard file,
// grown milestone by milestone (M1 pool plumbing, M2 sky-walk.js, M3 the bed, M4 lead integration).
import { readFileSync } from 'fs';
import { gridShardSolve, shardKeysOf, gridShardSystems, divisorsFast, nearestDegree, poolFromRatios, TONE_BIN_CENTS } from '../grid-core.js';
import { deriveScale } from '../oracle-core.js';
import { CHORDS, CHORD_QUALITIES, QUALITY_COUNT, START_CHORD_ID, GAIN_CEILING_CENTS, EPS_SPREAD, vlParsimony, gainForDev, coverage, chooseNextChord, candidateCosts, pushTabu, chordStepIndex } from '../sky-walk.js';
import { CHORD_TICKS, TABU_K, MAX_BED_OSC, REATTACK_PERIODS, LEAD_MASK_WINDOW, hashId, bedDegreesFor, selectedRatioToneRows, reattachStepFor, deriveVoice, leadNoteInChord, currentSkyChord, voiceToneChanged, setTuningStrength, currentTuningStrength, proposeRoot, setRootPolicyContext, debugSkyState } from '../cosmos-audio.js';
import { poolFromTones, solveRoots, scoreRootAt } from '../sky-root.js';
import { ratioToCents } from '../oracle-core.js';

let PASS = true;
const check = (n, ok, d = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

console.log('═══ FULL SKY — assertions ═══');

// ══ M1 — pool plumbing ═══════════════════════════════════════════════════════════════════════
console.log('\n── M1: pool plumbing ──');

// Default is a quick, explicit real-grid regression corpus. It keeps the abundant handoff examples
// (1092, 1650), spans shallow through 38-shard material, and finishes quickly enough to remain an
// end-of-turn guard. --stress retains (and slightly expands) the former 25-grid sampled corpus.
// Print the mode and exact corpus so a quick run can never be mistaken for stress coverage.
const idx = JSON.parse(readFileSync(new URL('../data/oracle-index.json', import.meta.url)));
const quickGrids = [552, 1092, 1650, 2300, 2640, 2700, 4600, 6900];
const sampleGrids = [...new Set([2640, 7920, 1092, 1650, 552, 15840, ...idx.grid.slice(0, 200)])].filter(g => g >= 2);
const sampledStressGrids = Array.from({ length: 25 }, (_, i) => sampleGrids[Math.floor(i * sampleGrids.length / 25)]);
const stress = process.argv.includes('--stress');
const testGrids = stress ? [...new Set([...quickGrids, ...sampledStressGrids])] : quickGrids;
console.log(`  corpus: ${stress ? 'stress' : 'quick/default'} · ${testGrids.length} real grids`);
console.log(`  grids: ${testGrids.join(', ')}`);

// Later milestone sections intentionally reuse the M1 fixtures. Before this cache, M3/A/B1/B2/B3
// repeatedly re-enumerated the same real grids even though every helper is pure and deterministic.
const workerPathCache = new Map();
const bruteForceCache = new Map();

// worker-path pool (+ tones, Sky Root B1): gridShardSolve per shard, merged with the SAME
// min-|dev|/sum-toneCount/0.5¢-bin-dedupe rules cosmos-runtime.js's mergeSkyPool/mergeSkyTones use
// (reimplemented locally — cosmos-runtime.js isn't Node-importable standalone here, but the rules are
// tiny folds; this checks grid-core's shard math end-to-end either way, and reuses ONE gridShardSolve
// call per shard for both pool and tones — no doubled computation).
function workerPathPool(G) {
  if (workerPathCache.has(G)) return workerPathCache.get(G);
  const pool = new Array(12).fill(null), toneCount = new Array(12).fill(0);
  const tones = [], seenBins = new Set();
  for (const A of shardKeysOf(G)) {
    const r = gridShardSolve(G, A);
    for (let d = 0; d < 12; d++) {
      if (r.pool[d] && (!pool[d] || Math.abs(r.pool[d].dev) < Math.abs(pool[d].dev))) pool[d] = r.pool[d];
      toneCount[d] += r.toneCount[d];
    }
    for (const t of r.tones) { const bin = Math.round(t.c / TONE_BIN_CENTS); if (seenBins.has(bin)) continue; seenBins.add(bin); tones.push(t); }
  }
  const result = { pool, toneCount, tones };
  workerPathCache.set(G, result);
  return result;
}

// brute-force pool: union every shard's gridShardSystems() representatives (a DIFFERENT enumeration
// path than gridShardSolve's internal shardGroups reuse — re-derives each system's scale independently)
// and fold them all into one pool in a single pass (no per-shard merge step).
function bruteForcePool(G) {
  if (bruteForceCache.has(G)) return bruteForceCache.get(G);
  const pool = new Array(12).fill(null), toneCount = new Array(12).fill(0);
  for (const A of shardKeysOf(G)) {
    for (const sys of gridShardSystems(G, A)) {
      const scale = deriveScale(sys.layers);
      poolFromRatios(scale.ratios, pool, toneCount);
    }
  }
  const result = { pool, toneCount };
  bruteForceCache.set(G, result);
  return result;
}

let poolMismatch = 0, toneMismatch = 0, zeroDevMissing = 0, shapeFail = 0, worst = null;
for (const G of testGrids) {
  const started = performance.now();
  const w = workerPathPool(G), workerMs = performance.now() - started;
  const b = bruteForcePool(G), totalMs = performance.now() - started;
  console.log(`  grid ${G}: worker ${(workerMs / 1000).toFixed(2)}s · brute ${((totalMs - workerMs) / 1000).toFixed(2)}s`);
  for (let d = 0; d < 12; d++) {
    const wp = w.pool[d], bp = b.pool[d];
    const same = (wp === null && bp === null) ||
      (wp && bp && wp.fraction === bp.fraction && Math.abs(wp.dev - bp.dev) < 1e-6);
    if (!same) { poolMismatch++; if (!worst) worst = { G, d, wp, bp }; }
    if (w.toneCount[d] !== b.toneCount[d]) toneMismatch++;
  }
  if (!w.pool[0] || w.pool[0].dev !== 0) zeroDevMissing++;   // 1/1 is always present at degree 0, dev 0
  if (w.pool.length !== 12 || w.toneCount.length !== 12) shapeFail++;
  for (const slot of w.pool) if (slot !== null && !('fraction' in slot && 'cents' in slot && 'dev' in slot)) shapeFail++;
}
check(`worker-path pool ≡ brute-force pool (gridShardSystems union) across ${testGrids.length} real grids`,
  poolMismatch === 0, worst ? `e.g. grid ${worst.G} degree ${worst.d}: ${JSON.stringify(worst.wp)} vs ${JSON.stringify(worst.bp)}` : '');
check('worker-path toneCount ≡ brute-force toneCount', toneMismatch === 0, `${toneMismatch} slot mismatches`);
check('degree-0 entry exists with dev === 0 (1/1 always present)', zeroDevMissing === 0, `${zeroDevMissing}/${testGrids.length} missing`);
check('payload shape stable: 12-slot arrays, {fraction,cents,dev} entries', shapeFail === 0, `${shapeFail} shape violations`);

// nearestDegree sanity: monotone bucketing, every cents value lands within 50¢ of its assigned degree
let devBoundFail = 0;
for (let c = 0; c < 1200; c += 7) { const { dev } = nearestDegree(c); if (Math.abs(dev) > 50 + 1e-9) devBoundFail++; }
check('nearestDegree: |dev| ≤ 50¢ for any cents value', devBoundFail === 0, `${devBoundFail} out of bound`);

// ══ M2 — sky-walk.js ═════════════════════════════════════════════════════════════════════════
console.log('\n── M2: sky-walk.js ──');

// gain-law shape: monotone decreasing, g(0)=1, g(ceiling)≈0
let gainMonoFail = 0, prevG = Infinity;
for (let c = 0; c <= 60; c++) { const g = gainForDev(c); if (g > prevG + 1e-9) gainMonoFail++; prevG = g; }
check('gainForDev: monotone decreasing in |dev|', gainMonoFail === 0, `${gainMonoFail} increases`);
check('gainForDev(0) === 1', gainForDev(0) === 1);
check(`gainForDev(±${GAIN_CEILING_CENTS}) ≈ 0`, Math.abs(gainForDev(GAIN_CEILING_CENTS)) < 1e-9 && Math.abs(gainForDev(-GAIN_CEILING_CENTS)) < 1e-9);
check('gainForDev is symmetric in dev sign', [0, 10, 22, 44].every(d => gainForDev(d) === gainForDev(-d)));

console.log('\n  Live local-tuning policy weight');
check('local tuning strength defaults to 2 semitones of voice-leading cost', currentTuningStrength() === 2);
check('local tuning strength is continuously adjustable', setTuningStrength(3.25) === 3.25 && currentTuningStrength() === 3.25);
check('local tuning strength clamps to its supported 0–8 range', setTuningStrength(-1) === 0 && setTuningStrength(99) === 8);
setTuningStrength(2);

// Chord vocabulary — ported Consonant (11) + Specialized (18) qualities × 12 roots. Scale modes deferred.
console.log('\n  Chord vocabulary (ported catalog)');
check('vocabulary is every quality on all 12 roots', CHORDS.length === 12 * QUALITY_COUNT && QUALITY_COUNT === 33, `${CHORDS.length} chords, ${QUALITY_COUNT} qualities (11 consonant + 22 specialized)`);
check('every quality is consonant or specialized tier (scale modes deferred)',
  CHORD_QUALITIES.filter(q => q.tier === 'consonant').length === 11 && CHORD_QUALITIES.filter(q => q.tier === 'specialized').length === 22 &&
  CHORD_QUALITIES.every(q => q.tier === 'consonant' || q.tier === 'specialized'));
check('id 0 is still I major [0,4,7] (START_CHORD_ID anchor preserved)',
  START_CHORD_ID === 0 && CHORDS[0].rootSemitone === 0 && CHORDS[0].quality === 'major_triad' &&
  CHORDS[0].semitones.join(',') === '0,4,7' && CHORDS[0].symbol === 'I');
check('id scheme is rootSemitone*QUALITY_COUNT + qualityIndex throughout',
  CHORDS.every((c, i) => c.id === i && c.id === c.rootSemitone * QUALITY_COUNT + CHORD_QUALITIES.findIndex(q => q.id === c.quality)));
check('cardinality varies 3–6 (triads through 6-note extensions), never below 3',
  CHORDS.every(c => c.cardinality >= 3 && c.cardinality <= 6) && CHORDS.some(c => c.cardinality > 3) && CHORDS.some(c => c.cardinality === 6));
check('each chord\'s semitones are the deduped, sorted root-transposed intervals',
  CHORDS.every(c => { const q = CHORD_QUALITIES.find(x => x.id === c.quality);
    return c.semitones.join(',') === [...new Set(q.intervals.map(iv => (c.rootSemitone + iv) % 12))].sort((a, b) => a - b).join(','); }));
// coverage divides by cardinality, so a perfectly-tuned field scores 1 for a chord of ANY size.
const perfectStar = { weight: 1, pool: Array.from({ length: 12 }, () => ({ fraction: '1/1', cents: 0, dev: 0 })) };
check('coverage normalizes by cardinality (a fully-tuned field scores ~1 for triad AND 6-note chord alike)',
  Math.abs(coverage(CHORDS[0], [perfectStar]) - 1) < 1e-9 &&
  Math.abs(coverage(CHORDS.find(c => c.cardinality === 6), [perfectStar]) - 1) < 1e-9);

// P/L/R structural check — the neo-Riemannian fact still holds for triad↔triad under the generalized
// vlParsimony: the Parallel and Leittonwechsel minors sit at cost 1, the Relative at cost 2, and
// nothing (of any cardinality) is cheaper than 1. With the expanded vocabulary OTHER cost-1 moves now
// exist too (e.g. sus4, maj7 on the same root), so this no longer claims P/L are the ONLY cost-1 moves.
console.log('\n  P/L/R structural check');
const triadOf = (r, q) => CHORDS.find(t => t.rootSemitone === r && t.quality === q);
let plrFail = 0; const plrDetail = [];
for (let r = 0; r < 12; r++) {
  const major = triadOf(r, 'major_triad');
  const costP = vlParsimony(major, triadOf(r, 'minor_triad'));
  const costL = vlParsimony(major, triadOf((r + 4) % 12, 'minor_triad'));
  const costR = vlParsimony(major, triadOf((r + 9) % 12, 'minor_triad'));
  if (costP !== 1) { plrFail++; plrDetail.push(`r=${r} P=${costP}`); }
  if (costL !== 1) { plrFail++; plrDetail.push(`r=${r} L=${costL}`); }
  if (costR !== 2) { plrFail++; plrDetail.push(`r=${r} R=${costR}`); }
  for (const t of CHORDS) {
    if (t === major) continue;
    if (vlParsimony(major, t) < 1) { plrFail++; plrDetail.push(`r=${r} beats P/L at ${t.symbol}`); }
  }
}
check('P and L sit at cost exactly 1; R at cost exactly 2; nothing beats 1', plrFail === 0, plrDetail.slice(0, 3).join('; '));

// symmetry: vlParsimony minimizes over all voice leadings (every bijection for equal cardinality, and
// injection + nearest-neighbour doubling of the smaller chord otherwise) — the smaller chord is always
// the doubled one, so direction never matters (backs Avery's "I→i vs i→I, either way you end up with the
// same loop" observation with a guarded fact instead of just an eyeballed one — FULL_SKY_STATE_2026-07-21).
let symFail = 0, symPairs = 0;
for (let i = 0; i < CHORDS.length; i++) for (let j = i + 1; j < CHORDS.length; j++) {
  symPairs++;
  if (vlParsimony(CHORDS[i], CHORDS[j]) !== vlParsimony(CHORDS[j], CHORDS[i])) symFail++;
}
check('vlParsimony(A,B) === vlParsimony(B,A) for every triad pair (direction never matters)', symFail === 0, `${symFail}/${symPairs} asymmetric`);

// walk determinism given a fixed field
console.log('\n  Walk determinism + tabu + movement');
const mockField = seed => t => { const x = Math.sin(t.id * 12.9898 + seed) * 43758.5453; return x - Math.floor(x); };   // deterministic pseudo-random [0,1) per triad id
function runWalk(seed, steps) {
  let current = START_CHORD_ID, tabu = pushTabu([], current);
  const path = [current];
  for (let i = 0; i < steps; i++) {
    const next = chooseNextChord(current, tabu, mockField(seed));
    current = next.id; pushTabu(tabu, current); path.push(current);
  }
  return path;
}
const pathA = runWalk(1.7, 40), pathB = runWalk(1.7, 40);
check('same (start, field, seed) → identical walk path', JSON.stringify(pathA) === JSON.stringify(pathB));

let neverRepeats = true, tabuRespected = true;
{
  let current = START_CHORD_ID, tabu = pushTabu([], current);
  for (let i = 0; i < 60; i++) {
    const forbidden = new Set(tabu);
    const next = chooseNextChord(current, tabu, mockField(3.3));
    if (next.id === current) neverRepeats = false;
    if (forbidden.has(next.id)) tabuRespected = false;
    current = next.id; pushTabu(tabu, current);
  }
}
check('walk never repeats the current chord (always moves)', neverRepeats);
check('walk never lands on a tabu chord', tabuRespected);

// coverage: monotonic response to a star gaining a degree (dev improving toward 0, or a new tone
// appearing where there was none) never DECREASES coverage of a triad that uses that degree.
console.log('\n  Coverage monotonicity');
const triad = CHORDS[0];   // I major: semitones [0,4,7]
const starMissing = { weight: 1, pool: new Array(12).fill(null) };
const starWorse = { weight: 1, pool: new Array(12).fill(null) }; starWorse.pool[4] = { fraction: '5/4', cents: 386, dev: 14 };
const starBetter = { weight: 1, pool: new Array(12).fill(null) }; starBetter.pool[4] = { fraction: '5/4', cents: 386, dev: 3 };
const covMissing = coverage(triad, [starMissing]), covWorse = coverage(triad, [starWorse]), covBetter = coverage(triad, [starBetter]);
check('coverage: missing degree < some tone < a better-tuned tone', covMissing < covWorse && covWorse < covBetter,
  `${covMissing.toFixed(3)} < ${covWorse.toFixed(3)} < ${covBetter.toFixed(3)}`);
check('coverage([]) === 0 (no audible stars)', coverage(triad, []) === 0);
check('coverage: an unweighted (gain 0) star never contributes', coverage(triad, [{ weight: 0, pool: starBetter.pool }]) === 0);

// chord-clock helper: pure fn of tick count, matches simple floor-division, resync-safe
console.log('\n  Chord-clock helper');
let clockFail = 0;
for (const ticks of [0, 1, 255, 256, 257, 5000, 65535]) if (chordStepIndex(ticks, 256) !== Math.floor(ticks / 256)) clockFail++;
check('chordStepIndex is a pure floor(ticks/chordTicks)', clockFail === 0, `${clockFail} mismatches`);

// ══ M3 — the bed ═════════════════════════════════════════════════════════════════════════════
console.log('\n── M3: the bed ──');

// mask-silence correctness: bedDegreesFor never returns a degree the pool doesn't cover, never
// substitutes, and only ever returns a subset of the chord's own 3 degrees.
console.log('\n  Mask-silence correctness (bedDegreesFor)');
let subsetFail = 0, coverageFail = 0, silentTotal = 0, samples = 0;
for (const G of testGrids.slice(0, 10)) {
  const { pool } = workerPathPool(G);
  for (const chord of CHORDS) {
    samples++;
    const got = bedDegreesFor(chord.id, pool);
    if (!got.every(d => chord.semitones.includes(d))) subsetFail++;
    if (!got.every(d => pool[d] !== null)) coverageFail++;
    if (got.length < chord.semitones.length) silentTotal++;   // expected: real pools are rarely 3/3
  }
}
check('bedDegreesFor(chord, pool) ⊆ chord.semitones', subsetFail === 0, `${subsetFail}/${samples}`);
check('every returned degree has an actual pool entry (no substitution)', coverageFail === 0, `${coverageFail}/${samples}`);
console.log(`  (${silentTotal}/${samples} chord×grid pairs had ≥1 silent degree — sparsity is expected/intended)`);
check('bedDegreesFor(chord, null pool) → []', bedDegreesFor(0, null).length === 0);
check('bedDegreesFor(chord, empty pool) → []', bedDegreesFor(0, new Array(12).fill(null)).length === 0);

// Debug ratio-tone table: selected means present in an audible star's re-anchored pool; ON means an
// actual live bed voice. Keep these independent so an oscillator-budget miss is visible rather than
// falsely reported as playing just because its degree belongs to the current chord.
console.log('\n  Selected-ratio debug table');
const tablePoolA = new Array(12).fill(null), tablePoolB = new Array(12).fill(null);
tablePoolA[0] = { fraction: '1/1', cents: 0, dev: 0 };
tablePoolA[4] = { fraction: '5/4', cents: 386.31, dev: -13.69 };
tablePoolB[0] = { fraction: '1/1', cents: 0, dev: 0 };
tablePoolB[4] = { fraction: '81/64', cents: 407.82, dev: 7.82 };
const ratioRows = selectedRatioToneRows(START_CHORD_ID, [
  { pool: tablePoolA, voiced: [{ degree: 0, fraction: '1/1' }] },
  { pool: tablePoolB, voiced: [{ degree: 4, fraction: '81/64' }] },
]);
check('ratio table always has one row per chromatic degree', ratioRows.length === 12 && ratioRows.every((r, d) => r.degree === d));
check('equal selected ratios aggregate with a per-star count', ratioRows[0].selected.length === 1 && ratioRows[0].selected[0].fraction === '1/1' && ratioRows[0].selected[0].count === 2);
check('distinct selected ratios remain individually visible', ratioRows[4].selected.map(r => r.fraction).join(',') === '5/4,81/64');
check('ON column reports actual voices, not every selected chord tone', ratioRows[0].sounding[0].count === 1 && ratioRows[4].sounding.length === 1 && ratioRows[4].sounding[0].fraction === '81/64');
check('chord marker follows the current triad degrees', ratioRows.filter(r => r.inChord).map(r => r.degree).join(',') === CHORDS[START_CHORD_ID].semitones.join(','));

// reattach periods: deterministic per (id, ticks); steps advance exactly at period multiples; spread
// isn't degenerate (not every sampled grid lands on the same period bucket).
console.log('\n  Re-attack periods');
let reattachDetFail = 0, reattachBoundaryFail = 0;
const sampleIds = testGrids;
for (const id of sampleIds) {
  const period = REATTACK_PERIODS[hashId(id) % REATTACK_PERIODS.length];
  for (const ticks of [0, 1, period - 1, period, period + 1, period * 7 + 3]) {
    const a = reattachStepFor(id, ticks), b = reattachStepFor(id, ticks);
    if (a !== b) reattachDetFail++;
    if (a !== Math.floor(ticks / period)) reattachBoundaryFail++;
  }
}
check('reattachStepFor is deterministic per (id, ticks)', reattachDetFail === 0);
check('reattachStepFor steps advance exactly at that id\'s period multiples', reattachBoundaryFail === 0, `${reattachBoundaryFail} mismatches`);
const bucketsHit = new Set(sampleIds.map(id => hashId(id) % REATTACK_PERIODS.length));
check('hashId spreads real grids across more than one REATTACK_PERIODS bucket', bucketsHit.size > 1, `${bucketsHit.size}/${REATTACK_PERIODS.length} buckets hit`);

// budget cap: a plausible worst case (AUDIBLE_N=10 stars × up to 3 covered degrees each) can exceed
// MAX_BED_OSC=30 — confirm the knob is actually a real, binding cap, not a no-op ceiling.
console.log('\n  Budget cap');
check('MAX_BED_OSC is a positive, binding cap (< AUDIBLE_N × 3)', MAX_BED_OSC > 0 && MAX_BED_OSC <= 10 * 3, `MAX_BED_OSC=${MAX_BED_OSC}`);

// knob sanity
check('CHORD_TICKS, TABU_K positive', CHORD_TICKS > 0 && TABU_K > 0);
check('REATTACK_PERIODS all positive, length > 1', REATTACK_PERIODS.length > 1 && REATTACK_PERIODS.every(p => p > 0));

// ══ M4 — lead integration + cockpit ═════════════════════════════════════════════════════════
console.log('\n── M4: lead integration ──');

// currentSkyChord() shape
{
  const cur = currentSkyChord();
  check('currentSkyChord() shape: {symbol,id,semitones}', typeof cur.symbol === 'string' && Number.isInteger(cur.id) && cur.semitones.length >= 3);
  check('currentSkyChord().id is a valid CHORDS index', cur.id >= 0 && cur.id < CHORDS.length);
  check('currentSkyChord() matches CHORDS[id] exactly', cur.symbol === CHORDS[cur.id].symbol && JSON.stringify(cur.semitones) === JSON.stringify(CHORDS[cur.id].semitones));
}

// known-value sanity: ratio 1 (the root, degree 0 dev 0) is in-chord for I major (semitones incl. 0),
// out-of-chord for a triad that doesn't touch degree 0.
console.log('\n  Known-value sanity');
const triadHas0 = CHORDS.find(t => t.semitones.includes(0));
const triadNo0 = CHORDS.find(t => !t.semitones.includes(0));
check('root (ratio=1) is in-chord for a triad containing degree 0', leadNoteInChord(1, triadHas0.id) === true);
check('root (ratio=1) is out-of-chord for a triad NOT containing degree 0', leadNoteInChord(1, triadNo0.id) === false);

// window boundary: exactly at LEAD_MASK_WINDOW cents from a covered degree → in; just past it → out.
const atWindow = 2 ** (LEAD_MASK_WINDOW / 1200), pastWindow = 2 ** ((LEAD_MASK_WINDOW + 0.5) / 1200);
check(`ratio exactly ${LEAD_MASK_WINDOW}¢ from degree 0 → in-chord (boundary inclusive)`, leadNoteInChord(atWindow, triadHas0.id) === true);
check(`ratio just past ${LEAD_MASK_WINDOW}¢ from degree 0 → out-of-chord`, leadNoteInChord(pastWindow, triadHas0.id) === false);
const triadHas11 = CHORDS.find(t => t.semitones.includes(11));
const triadHas0Not11 = CHORDS.find(t => t.semitones.includes(0) && !t.semitones.includes(11));
check('lead mask follows a non-zero root anchor instead of remaining hard-wired to 1/1',
  leadNoteInChord(1, triadHas11.id, 100) === true && leadNoteInChord(1, triadHas0Not11.id, 100) === false);

// mask agreement: leadNoteInChord must agree with an independent reimplementation built directly from
// nearestDegree/ratioToCents (the same primitives M1 already verified) — checks the WIRING, not the
// primitives. Sampled across real codex keys' derived voices (deriveVoice — the actual lead-note math).
console.log('\n  Mask agreement across real leads');
const refInChord = (ratio, chordId) => {
  const { d, dev } = nearestDegree(ratioToCents(ratio));
  return CHORDS[chordId].semitones.includes(d) && Math.abs(dev) <= LEAD_MASK_WINDOW;
};
let maskAgreeFail = 0, maskChecks = 0, anyIn = 0, anyOut = 0;
const leadCorpus = idx.keys.slice(0, 15).map(k => k.split('.').map(Number));
for (const layers of leadCorpus) {
  const voice = deriveVoice(layers);
  for (const t of CHORDS) {
    let sawIn = false, sawOut = false;
    for (const n of voice.notes) {
      maskChecks++;
      const got = leadNoteInChord(n.ratio, t.id), want = refInChord(n.ratio, t.id);
      if (got !== want) maskAgreeFail++;
      if (got) sawIn = true; else sawOut = true;
    }
    if (sawIn) anyIn++; if (sawOut) anyOut++;
  }
}
check('leadNoteInChord agrees with an independent reference across real leads × all chords', maskAgreeFail === 0, `${maskAgreeFail}/${maskChecks} mismatches`);
check('genuine in-chord/out-of-chord mix seen (not degenerate always-on/off)', anyIn > 0 && anyOut > 0, `${anyIn} lead×chord pairs had ≥1 in-chord note, ${anyOut} had ≥1 out-of-chord note`);

// ══ Sky Root handoff, Feature A — normalized field term ═════════════════════════════════════════
console.log('\n── Feature A: normalized field term ──');

const findT = sym => CHORDS.find(t => t.symbol === sym);
const chI = findT('I'), chIii = findT('iii'), chBVI = findT('bVI'), chMax = findT('bVII'), chMin = findT('IV');
// tabu out every OTHER triad → the candidate set is exactly {iii, bVI, bVII, IV}, so max/min come from
// these four directly — reproduces Avery's real overlay numbers (2026-07-21 session) exactly, no filler.
const onlyFour = new Set([chIii.id, chBVI.id, chMax.id, chMin.id]);
const tabuAllButFour = CHORDS.map(t => t.id).filter(id => !onlyFour.has(id));   // includes chI.id — current is always tabu
const workedCov = t => t.id === chIii.id ? 0.64 : t.id === chBVI.id ? 0.81 : t.id === chMax.id ? 0.82 : t.id === chMin.id ? 0.54 : 0;

console.log('\n  Worked example (current I; candidates iii/bVI/bVII/IV at cov .64/.81/.82/.54)');
const r1 = candidateCosts(chI.id, tabuAllButFour, workedCov, { lambdaField: 1 });
const iii1 = r1.find(r => r.id === chIii.id), bvi1 = r1.find(r => r.id === chBVI.id);
check('vlParsimony(I, iii) === 1 (P or L — the known-cheap move)', iii1.parsimony === 1, `got ${iii1.parsimony}`);
check('vlParsimony(I, bVI) === 2', bvi1.parsimony === 2, `got ${bvi1.parsimony}`);
check('λ=1 fieldCost(iii) ≈ 0.643 (= (.82-.64)/.28)', Math.abs(iii1.fieldCost - 0.642857) < 1e-4, `got ${iii1.fieldCost.toFixed(6)}`);
check('λ=1 fieldCost(bVI) ≈ 0.036 (= (.82-.81)/.28)', Math.abs(bvi1.fieldCost - 0.035714) < 1e-4, `got ${bvi1.fieldCost.toFixed(6)}`);

const at = lambda => { const r = candidateCosts(chI.id, tabuAllButFour, workedCov, { lambdaField: lambda });
  return { iii: r.find(x => x.id === chIii.id), bvi: r.find(x => x.id === chBVI.id) }; };
check('λ=1.5: iii (cheaper parsimony) still wins over bVI', at(1.5).iii.cost < at(1.5).bvi.cost,
  `iii ${at(1.5).iii.cost.toFixed(3)} vs bVI ${at(1.5).bvi.cost.toFixed(3)}`);
check('λ=2.0 (production default): bVI overtakes iii — field term overrules a cost-1 parsimony move',
  at(2.0).bvi.cost < at(2.0).iii.cost, `iii ${at(2.0).iii.cost.toFixed(3)} vs bVI ${at(2.0).bvi.cost.toFixed(3)}`);

console.log('\n  Full-span property (spread ≥ EPS_SPREAD)');
const r2 = candidateCosts(chI.id, tabuAllButFour, workedCov, { lambdaField: 2 });
check('spread .28 ≥ EPS_SPREAD .15 → field costs span the FULL [0, λ]',
  Math.abs(r2.find(x => x.id === chMax.id).fieldCost - 0) < 1e-9 && Math.abs(r2.find(x => x.id === chMin.id).fieldCost - 2) < 1e-9,
  `max-cov candidate fieldCost=${r2.find(x => x.id === chMax.id).fieldCost}, min-cov candidate fieldCost=${r2.find(x => x.id === chMin.id).fieldCost}`);

console.log('\n  Narrow-spread fade (spread < EPS_SPREAD)');
const chA = findT('V'), chB = findT('bII');   // two arbitrary distinct triads, spread .05 < EPS_SPREAD .15
const tabuAB = CHORDS.map(t => t.id).filter(id => id !== chA.id && id !== chB.id);   // includes chI.id — current is always tabu
const narrowCov = t => t.id === chA.id ? 0.60 : t.id === chB.id ? 0.55 : 0;
const r3 = candidateCosts(chI.id, tabuAB, narrowCov, { lambdaField: 2 });
const bMin = r3.find(x => x.id === chB.id);   // the min-coverage candidate — would get fieldCost=λ if spread were used raw
const expectedFaded = 2 * 0.05 / EPS_SPREAD;   // EPS_SPREAD floor, NOT the tiny real spread
check('spread .05 < EPS_SPREAD .15 → fieldCost fades (uses EPS_SPREAD floor, does not blow up to λ)',
  Math.abs(bMin.fieldCost - expectedFaded) < 1e-6 && bMin.fieldCost < 2, `got ${bMin.fieldCost.toFixed(4)}, expected ${expectedFaded.toFixed(4)}, λ=2`);

console.log('\n  Deep-dust / flat-field fallback');
const flatTabu = pushTabu([], chI.id, 3);
const flatNext = chooseNextChord(chI.id, flatTabu, () => 0.5, { lambdaField: 2 });   // uniform coverage → fieldCost≡0 for all
check('flat field (uniform coverage) → walk reduces to pure parsimony (P/L, cost 1)', vlParsimony(chI, flatNext) === 1, `next=${flatNext.symbol} cost=${vlParsimony(chI, flatNext)}`);

console.log('\n  chooseNextChord ⟺ candidateCosts agreement (across real fields)');
const realPoolsA = testGrids.slice(0, 5).map(G => ({ pool: workerPathPool(G).pool, weight: 1 }));
const realPoolsB = testGrids.slice(-5).map(G => ({ pool: workerPathPool(G).pool, weight: 1 }));
let agreeFail = 0, agreeChecks = 0;
for (const stars of [realPoolsA, realPoolsB]) {
  let current = START_CHORD_ID, tabu = pushTabu([], current, 3);
  for (let step = 0; step < 10; step++) {
    agreeChecks++;
    const cov = t => coverage(t, stars);
    const chosen = chooseNextChord(current, tabu, cov, { lambdaField: 2 });
    const ranked = candidateCosts(current, tabu, cov, { lambdaField: 2 }).sort((a, b) => a.cost - b.cost || a.id - b.id);
    if (chosen.id !== ranked[0].id) agreeFail++;
    current = chosen.id; pushTabu(tabu, current, 3);
  }
}
check('chooseNextChord always agrees with candidateCosts\' argmin (same ranking, no drift)', agreeFail === 0, `${agreeFail}/${agreeChecks} mismatches`);

check('EPS_SPREAD is a small positive knob', EPS_SPREAD > 0 && EPS_SPREAD < 1, `EPS_SPREAD=${EPS_SPREAD}`);

// ══ Sky Root handoff, B1 — anchor-independent tone lists ═══════════════════════════════════════
console.log('\n── B1: anchor-independent tone lists ──');

// sky-root.js's poolFromTones (B2), anchor 0, folds a tones[] list ({f,c}) into a 12-slot pool with
// the same min-|dev| rule poolFromRatios uses — this proves B1's payload is a superset that loses
// (almost) nothing: folding it back at the trivial anchor must reproduce today's worker pool, modulo
// one known, bounded, inaudible edge case — two DISTINCT real tones landing in the SAME 0.5¢ dedup
// bin (rare: their cents differ by < TONE_BIN_CENTS, so their |dev| for any one degree differs by the
// same tiny amount). The dedup criterion (simplest/first per bin) is necessarily anchor-independent,
// while the reference pool's criterion (min |dev|) is anchor-dependent — the two CAN disagree by
// construction on a bin collision, but only ever by < TONE_BIN_CENTS of dev, which is inaudible next
// to GAIN_CEILING_CENTS (45¢). A same-fraction/same-dev match is exact; a different-fraction match is
// only accepted when it's a genuine bin collision (cents within TONE_BIN_CENTS) — anything looser is
// a real failure.
let toneFoldMismatch = 0, toneFoldBinCollision = 0, toneZeroMissing = 0, toneCentsRangeFail = 0, toneDedupeFail = 0, toneWorst = null;
for (const G of testGrids) {
  const { pool: refPool, tones } = workerPathPool(G);
  const foldedPool = poolFromTones(tones, 0);
  for (let d = 0; d < 12; d++) {
    const fp = foldedPool[d], rp = refPool[d];
    if (fp === null && rp === null) continue;
    if (fp && rp && fp.fraction === rp.fraction && Math.abs(fp.dev - rp.dev) < 1e-6) continue;   // exact match
    if (fp && rp && Math.abs(fp.cents - rp.cents) <= TONE_BIN_CENTS) { toneFoldBinCollision++; continue; }   // known bounded edge case
    toneFoldMismatch++; if (!toneWorst) toneWorst = { G, d, fp, rp };
  }
  if (!tones.some(t => t.c === 0)) toneZeroMissing++;                       // the 1/1 tone is always present
  for (const t of tones) if (t.c < 0 || t.c >= 1200) toneCentsRangeFail++;
  const seen2 = new Set(); let deduped2 = 0;
  for (const t of tones) { const bin = Math.round(t.c / TONE_BIN_CENTS); if (seen2.has(bin)) continue; seen2.add(bin); deduped2++; }
  if (deduped2 !== tones.length) toneDedupeFail++;                          // re-deduping an already-deduped list changes nothing
}
check(`tones (folded at anchor 0) reproduce the worker's pool across ${testGrids.length} real grids`,
  toneFoldMismatch === 0, toneWorst ? `e.g. grid ${toneWorst.G} degree ${toneWorst.d}: ${JSON.stringify(toneWorst.fp)} vs ${JSON.stringify(toneWorst.rp)}` : `${toneFoldBinCollision} known bin-collision edge case(s), all bounded < ${TONE_BIN_CENTS}¢`);
check('the 1/1 tone (cents === 0) is present in every grid\'s tone list', toneZeroMissing === 0, `${toneZeroMissing}/${testGrids.length} missing`);
check('every tone\'s cents ∈ [0, 1200)', toneCentsRangeFail === 0, `${toneCentsRangeFail} out of range`);
check('dedupe is idempotent (re-deduping an already-deduped tone list changes nothing)', toneDedupeFail === 0, `${toneDedupeFail}/${testGrids.length} grids changed`);

// nearestDegree's anchor generalization: anchor 0 must reproduce the pre-B2 anchor-0 formula bit-for-bit.
let anchorZeroDrift = 0;
for (let c = 0; c < 1200; c += 7) {
  const a = nearestDegree(c), b = nearestDegree(c, 0);
  if (a.d !== b.d || a.dev !== b.dev) anchorZeroDrift++;
}
check('nearestDegree(cents) === nearestDegree(cents, 0) (default anchor is bit-for-bit today\'s behavior)', anchorZeroDrift === 0, `${anchorZeroDrift} mismatches`);

// ══ Sky Root handoff, B2 — the root solve (sky-root.js) ═════════════════════════════════════════
console.log('\n── B2: the root solve (sky-root.js) ──');

// A field where every star's tones sit at EXACT 12TET positions (dev=0 at anchor 0 for all 12
// degrees) — '1/1' is the only denominator-1 fraction among them, so it's the unique simplest root.
const exact12TET = Array.from({ length: 12 }, (_, d) => ({ f: d === 0 ? '1/1' : `${d + 2}/${d + 3}`, c: d * 100 }));
const identityField = [{ tones: exact12TET, weight: 1 }, { tones: exact12TET, weight: 0.5 }];
const identityLadder = solveRoots(identityField);
check('identity: exact-12TET field → ladder has one row per distinct tone (12)', identityLadder.length === 12, `got ${identityLadder.length}`);
check('identity: every candidate scores exactly 1 (all 12 degrees dev=0 under any of these anchors)',
  identityLadder.every(r => Math.abs(r.score - 1) < 1e-9), `scores: ${identityLadder.map(r => r.score.toFixed(3)).join(',')}`);
check('identity: 1/1 (denominator 1, the unique simplest fraction) wins the score tie',
  identityLadder[0].fraction === '1/1' && identityLadder[0].cents === 0, `winner: ${JSON.stringify(identityLadder[0])}`);

// shift-invariance: the SAME field uniformly shifted +37¢ (mod 1200) — the tone that WAS '1/1' (now at
// 37¢) must win, and score exactly what 1/1 scored before (the field's internal structure is unchanged).
const shifted12TET = exact12TET.map(t => ({ f: t.f, c: (t.c + 37 + 1200) % 1200 }));
const shiftedField = [{ tones: shifted12TET, weight: 1 }, { tones: shifted12TET, weight: 0.5 }];
const shiftedLadder = solveRoots(shiftedField);
check('shift-invariance: the +37¢ tone (was 1/1) wins after a uniform +37¢ shift',
  shiftedLadder[0].fraction === '1/1' && Math.abs(shiftedLadder[0].cents - 37) < 1e-9, `winner: ${JSON.stringify(shiftedLadder[0])}`);
check('shift-invariance: it scores exactly what 1/1 scored pre-shift', Math.abs(shiftedLadder[0].score - identityLadder[0].score) < 1e-9,
  `${shiftedLadder[0].score} vs ${identityLadder[0].score}`);

// determinism: repeated calls on the same field/opts → byte-identical ladder
check('solveRoots is deterministic (same field → identical ladder)', JSON.stringify(solveRoots(identityField)) === JSON.stringify(solveRoots(identityField)));

// empty field → empty ladder (caller keeps 1/1 default)
check('solveRoots([]) → empty ladder', Array.isArray(solveRoots([])) && solveRoots([]).length === 0);
check('solveRoots(field-with-no-tones) → empty ladder', solveRoots([{ tones: [], weight: 1 }]).length === 0);

// ladder sorted, on a REAL asymmetric field (real grids, not the synthetic exact-12TET one): score
// non-increasing throughout, and any exact score ties are broken by strictly non-decreasing fraction
// complexity (denominator, then numerator) — a real regression guard, not just "it doesn't crash".
console.log('\n  Ladder ordering (real field)');
const realField = testGrids.slice(0, 6).map(G => ({ tones: workerPathPool(G).tones, weight: 1 }));
const realLadder = solveRoots(realField);
let scoreOrderFail = 0, tieBreakFail = 0;
const fracKey = f => { const [n, d] = f.split('/').map(Number); return [d, n]; };
for (let i = 1; i < realLadder.length; i++) {
  if (realLadder[i].score > realLadder[i - 1].score + 1e-12) scoreOrderFail++;
  if (Math.abs(realLadder[i].score - realLadder[i - 1].score) < 1e-12) {
    const [pd, pn] = fracKey(realLadder[i - 1].fraction), [cd, cn] = fracKey(realLadder[i].fraction);
    if (cd < pd || (cd === pd && cn < pn)) tieBreakFail++;
  }
}
check(`ladder score is non-increasing (${realLadder.length} candidates from a real field)`, scoreOrderFail === 0, `${scoreOrderFail} inversions`);
check('exact-score ties break by simplest fraction (denominator, then numerator)', tieBreakFail === 0, `${tieBreakFail} tie-break violations`);
check('every ladder row has the {fraction,cents,score,perDegree} shape', realLadder.every(r => typeof r.fraction === 'string' && typeof r.cents === 'number' && typeof r.score === 'number' && Array.isArray(r.perDegree) && r.perDegree.length === 12));

// degreeTemplate: restricting to a subset must not change perDegree (same fold either way), only score
console.log('\n  degreeTemplate parameter');
const triadTemplate = [0, 4, 7];
const templatedLadder = solveRoots(realField, { degreeTemplate: triadTemplate });
let perDegreeDriftFail = 0, templateScoreFail = 0;
const byCents = new Map(templatedLadder.map(r => [r.cents, r]));
for (const row of realLadder) {
  const tRow = byCents.get(row.cents); if (!tRow) continue;
  if (JSON.stringify(tRow.perDegree) !== JSON.stringify(row.perDegree)) perDegreeDriftFail++;
  const expected = triadTemplate.reduce((s, d) => s + row.perDegree[d], 0) / triadTemplate.length;
  if (Math.abs(tRow.score - expected) > 1e-9) templateScoreFail++;
}
check('degreeTemplate restricts SCORE to the template subset without changing perDegree', perDegreeDriftFail === 0, `${perDegreeDriftFail} drifted`);
check('degreeTemplate score === mean(perDegree over the template)', templateScoreFail === 0, `${templateScoreFail} mismatches`);

// scoreRootAt: solveRoots' internal per-candidate scoring is exactly scoreRootAt — no drift between the
// two entry points (B3 needs scoreRootAt standalone, to re-score the INCUMBENT root, which may not be
// one of the field's own candidate tones — e.g. the star that contributed it fell out of ROOT_RADIUS).
console.log('\n  scoreRootAt (standalone re-scoring, B3\'s incumbent-rescore path)');
let scoreDriftFail = 0;
for (const row of realLadder) {
  const { score } = scoreRootAt(row.cents, realField);
  if (Math.abs(score - row.score) > 1e-9) scoreDriftFail++;
}
check('scoreRootAt(cents, field) agrees with solveRoots\' own per-candidate score', scoreDriftFail === 0, `${scoreDriftFail}/${realLadder.length} mismatches`);
const arbitraryScore = scoreRootAt(37, realField);   // a cents value that is NOT one of the field's candidates
check('scoreRootAt works for an arbitrary (non-candidate) anchor — {score,perDegree} shape',
  typeof arbitraryScore.score === 'number' && arbitraryScore.score >= 0 && arbitraryScore.score <= 1 && arbitraryScore.perDegree.length === 12);
check('scoreRootAt on an empty/no-weight field → score 0', scoreRootAt(0, []).score === 0 && scoreRootAt(0, [{ tones: [{ f: '1/1', c: 0 }], weight: 0 }]).score === 0);

// ══ Sky Root integration ══════════════════════════════════════════════════════════════════════
console.log('\n── Sky Root: live normalized policy integration ──');

// bedDegreesFor under a NON-ZERO anchor: fold a real grid's tones at anchor 386¢ (not the trivial
// anchor-0 case M3 already covers) and confirm the same mask-silence invariants hold on the re-anchored
// pool — proving the re-anchor → bedDegreesFor pipeline, not just each half in isolation.
console.log('\n  bedDegreesFor under non-zero anchors');
let anchoredSubsetFail = 0, anchoredCoverageFail = 0, anchoredSamples = 0;
for (const G of testGrids.slice(0, 8)) {
  const { tones } = workerPathPool(G);
  const anchoredPool = poolFromTones(tones, 386);   // an arbitrary real (5/4-ish) anchor, not 0
  for (const chord of CHORDS) {
    anchoredSamples++;
    const got = bedDegreesFor(chord.id, anchoredPool);
    if (!got.every(d => chord.semitones.includes(d))) anchoredSubsetFail++;
    if (!got.every(d => anchoredPool[d] !== null)) anchoredCoverageFail++;
  }
}
check('bedDegreesFor(chord, pool) ⊆ chord.semitones under a non-zero anchor', anchoredSubsetFail === 0, `${anchoredSubsetFail}/${anchoredSamples}`);
check('every returned degree has a real pool entry under a non-zero anchor (no substitution)', anchoredCoverageFail === 0, `${anchoredCoverageFail}/${anchoredSamples}`);

// voiceToneChanged: the pure recreate-on-mismatch decision (Sky Root's voice-identity gotcha).
console.log('\n  voiceToneChanged (voice-identity gotcha, pure decision)');
const mockPool = new Array(12).fill(null); mockPool[4] = { fraction: '5/4', cents: 386, dev: 3 };
check('same fraction at that degree → no change (voice keeps sounding)', voiceToneChanged('5/4', mockPool, 4) === false);
check('different fraction at that degree (root swap remapped it) → changed, recreate', voiceToneChanged('81/64', mockPool, 4) === true);
check('no slot at that degree → not "changed" (nothing to compare against)', voiceToneChanged('5/4', mockPool, 7) === false);
check('null pool → not "changed"', voiceToneChanged('5/4', null, 4) === false);

// Exercise the exact plain-data snapshot the overlay consumes without starting WebAudio. Installation
// remains boundary-only; the pure boundary decision itself is exhaustively guarded separately.
console.log('\n  live root-policy debug snapshot');
const policyDegrees = value => new Array(12).fill(value);
const policyLadder = [
  { fraction: '5/4', cents: 386, score: 0.8, perDegree: policyDegrees(0.9) },
  { fraction: '3/2', cents: 702, score: 0.76, perDegree: policyDegrees(0.7) },
  { fraction: '1/1', cents: 0, score: 0.7, perDegree: policyDegrees(0.6) },
];
setRootPolicyContext({ settled: true, geographyEpoch: 4 });
proposeRoot({
  ladder: policyLadder,
  incumbentScore: 0.7,
  incumbent: { fraction: '1/1', cents: 0, score: 0.7, perDegree: policyDegrees(0.6) },
  proposalEpoch: 4,
});
const policyDebug = debugSkyState().rootPolicy;
check('debug exposes the live normalized policy with exact candidate rows',
  policyDebug.live && !policyDebug.established && policyDebug.available && policyDebug.solve.valid && policyDebug.rows.length === 3 &&
  policyDebug.rows[0].score === 0.8 && Number.isFinite(policyDebug.rows[0].fitness));
check('first valid solve is displayed as an actionable bootstrap decision with an explainable destination',
  policyDebug.phrase.chordsSinceRootChange === 0 && policyDebug.trigger.reason === 'bootstrap' &&
  policyDebug.pending && !!policyDebug.destination && policyDebug.rows.every(row => typeof row.status === 'string'));
setRootPolicyContext({ settled: false, geographyEpoch: 5 });
check('movement/epoch change marks the displayed solve invalid', debugSkyState().rootPolicy.solve.valid === false);
const audioPolicySource = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
check('legacy 10% selector is gone and the live policy acts only in the chord-boundary path',
  !audioPolicySource.includes('ROOT_HYSTERESIS') && !audioPolicySource.includes('shouldSwapRoot') &&
  audioPolicySource.includes('applyRootPolicyAtBoundary();'));

console.log(`\n${PASS ? '✓✓✓ FULL SKY PASSES' : '✗ FULL SKY FAILED'}`);
process.exit(PASS ? 0 : 1);
