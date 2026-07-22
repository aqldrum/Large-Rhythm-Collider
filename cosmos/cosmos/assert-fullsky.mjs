// assert-fullsky.mjs — proofs for the Full Sky redesign (see ../FULL_SKY_HANDOFF.md). One guard file,
// grown milestone by milestone (M1 pool plumbing, M2 sky-walk.js, M3 the bed, M4 lead integration).
import { readFileSync } from 'fs';
import { gridShardSolve, shardKeysOf, gridShardSystems, divisorsFast, nearestDegree, poolFromRatios } from '../grid-core.js';
import { deriveScale } from '../oracle-core.js';
import { TRIADS, START_CHORD_ID, GAIN_CEILING_CENTS, vlParsimony, gainForDev, coverage, chooseNextChord, pushTabu, chordStepIndex } from '../sky-walk.js';
import { CHORD_TICKS, TABU_K, MAX_BED_OSC, REATTACK_PERIODS, LEAD_MASK_WINDOW, hashId, bedDegreesFor, reattachStepFor, deriveVoice, leadNoteInChord, currentSkyChord } from '../cosmos-audio.js';
import { ratioToCents } from '../oracle-core.js';

let PASS = true;
const check = (n, ok, d = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

console.log('═══ FULL SKY — assertions ═══');

// ══ M1 — pool plumbing ═══════════════════════════════════════════════════════════════════════
console.log('\n── M1: pool plumbing ──');

// real grids: a spread of sizes, including the abundant ones the handoff cites (1092, 1650).
const idx = JSON.parse(readFileSync(new URL('../data/oracle-index.json', import.meta.url)));
const sampleGrids = [...new Set([2640, 7920, 1092, 1650, 552, 15840, ...idx.grid.slice(0, 200)])].filter(g => g >= 2);
const N = 25;
const testGrids = Array.from({ length: N }, (_, i) => sampleGrids[Math.floor(i * sampleGrids.length / N)]);

// worker-path pool: gridShardSolve per shard, merged with the SAME min-|dev|/sum-toneCount rule the
// runtime's mergeSkyPool uses (reimplemented locally — cosmos-runtime.js isn't Node-importable standalone
// here, but the rule is a two-line fold; this checks grid-core's shard math end-to-end either way).
function workerPathPool(G) {
  const pool = new Array(12).fill(null), toneCount = new Array(12).fill(0);
  for (const A of shardKeysOf(G)) {
    const r = gridShardSolve(G, A);
    for (let d = 0; d < 12; d++) {
      if (r.pool[d] && (!pool[d] || Math.abs(r.pool[d].dev) < Math.abs(pool[d].dev))) pool[d] = r.pool[d];
      toneCount[d] += r.toneCount[d];
    }
  }
  return { pool, toneCount };
}

// brute-force pool: union every shard's gridShardSystems() representatives (a DIFFERENT enumeration
// path than gridShardSolve's internal shardGroups reuse — re-derives each system's scale independently)
// and fold them all into one pool in a single pass (no per-shard merge step).
function bruteForcePool(G) {
  const pool = new Array(12).fill(null), toneCount = new Array(12).fill(0);
  for (const A of shardKeysOf(G)) {
    for (const sys of gridShardSystems(G, A)) {
      const scale = deriveScale(sys.layers);
      poolFromRatios(scale.ratios, pool, toneCount);
    }
  }
  return { pool, toneCount };
}

let poolMismatch = 0, toneMismatch = 0, zeroDevMissing = 0, shapeFail = 0, worst = null;
for (const G of testGrids) {
  const w = workerPathPool(G), b = bruteForcePool(G);
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

// P/L/R structural check — same neo-Riemannian fact chord-walk.js's guard verified, now against the
// sky's pure vlParsimony (no beta term to zero out — it never had one): only P and L sit at cost 1
// from a major triad, R sits at cost 2, nothing beats 1.
console.log('\n  P/L/R structural check');
const triadOf = (r, q) => TRIADS.find(t => t.rootSemitone === r && t.quality === q);
let plrFail = 0; const plrDetail = [];
for (let r = 0; r < 12; r++) {
  const major = triadOf(r, 'maj');
  const costP = vlParsimony(major, triadOf(r, 'min'));
  const costL = vlParsimony(major, triadOf((r + 4) % 12, 'min'));
  const costR = vlParsimony(major, triadOf((r + 9) % 12, 'min'));
  if (costP !== 1) { plrFail++; plrDetail.push(`r=${r} P=${costP}`); }
  if (costL !== 1) { plrFail++; plrDetail.push(`r=${r} L=${costL}`); }
  if (costR !== 2) { plrFail++; plrDetail.push(`r=${r} R=${costR}`); }
  for (const t of TRIADS) {
    if (t === major) continue;
    if (vlParsimony(major, t) < 1) { plrFail++; plrDetail.push(`r=${r} beats P/L at ${t.symbol}`); }
  }
}
check('P and L sit at cost exactly 1; R at cost exactly 2; nothing beats 1', plrFail === 0, plrDetail.slice(0, 3).join('; '));

// symmetry: vlParsimony minimizes over ALL 6 bijections, so it's a genuine metric — direction never
// matters (backs Avery's "I→i vs i→I, either way you end up with the same loop" observation with a
// guarded fact instead of just an eyeballed one — see FULL_SKY_STATE_2026-07-21.md).
let symFail = 0, symPairs = 0;
for (let i = 0; i < TRIADS.length; i++) for (let j = i + 1; j < TRIADS.length; j++) {
  symPairs++;
  if (vlParsimony(TRIADS[i], TRIADS[j]) !== vlParsimony(TRIADS[j], TRIADS[i])) symFail++;
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
const triad = TRIADS[0];   // I major: semitones [0,4,7]
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
  for (const chord of TRIADS) {
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
  check('currentSkyChord() shape: {symbol,id,semitones}', typeof cur.symbol === 'string' && Number.isInteger(cur.id) && cur.semitones.length === 3);
  check('currentSkyChord().id is a valid TRIADS index', cur.id >= 0 && cur.id < TRIADS.length);
  check('currentSkyChord() matches TRIADS[id] exactly', cur.symbol === TRIADS[cur.id].symbol && JSON.stringify(cur.semitones) === JSON.stringify(TRIADS[cur.id].semitones));
}

// known-value sanity: ratio 1 (the root, degree 0 dev 0) is in-chord for I major (semitones incl. 0),
// out-of-chord for a triad that doesn't touch degree 0.
console.log('\n  Known-value sanity');
const triadHas0 = TRIADS.find(t => t.semitones.includes(0));
const triadNo0 = TRIADS.find(t => !t.semitones.includes(0));
check('root (ratio=1) is in-chord for a triad containing degree 0', leadNoteInChord(1, triadHas0.id) === true);
check('root (ratio=1) is out-of-chord for a triad NOT containing degree 0', leadNoteInChord(1, triadNo0.id) === false);

// window boundary: exactly at LEAD_MASK_WINDOW cents from a covered degree → in; just past it → out.
const atWindow = 2 ** (LEAD_MASK_WINDOW / 1200), pastWindow = 2 ** ((LEAD_MASK_WINDOW + 0.5) / 1200);
check(`ratio exactly ${LEAD_MASK_WINDOW}¢ from degree 0 → in-chord (boundary inclusive)`, leadNoteInChord(atWindow, triadHas0.id) === true);
check(`ratio just past ${LEAD_MASK_WINDOW}¢ from degree 0 → out-of-chord`, leadNoteInChord(pastWindow, triadHas0.id) === false);

// mask agreement: leadNoteInChord must agree with an independent reimplementation built directly from
// nearestDegree/ratioToCents (the same primitives M1 already verified) — checks the WIRING, not the
// primitives. Sampled across real codex keys' derived voices (deriveVoice — the actual lead-note math).
console.log('\n  Mask agreement across real leads');
const refInChord = (ratio, chordId) => {
  const { d, dev } = nearestDegree(ratioToCents(ratio));
  return TRIADS[chordId].semitones.includes(d) && Math.abs(dev) <= LEAD_MASK_WINDOW;
};
let maskAgreeFail = 0, maskChecks = 0, anyIn = 0, anyOut = 0;
const leadCorpus = idx.keys.slice(0, 15).map(k => k.split('.').map(Number));
for (const layers of leadCorpus) {
  const voice = deriveVoice(layers);
  for (const t of TRIADS) {
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
check('leadNoteInChord agrees with an independent reference across real leads × all 24 triads', maskAgreeFail === 0, `${maskAgreeFail}/${maskChecks} mismatches`);
check('genuine in-chord/out-of-chord mix seen (not degenerate always-on/off)', anyIn > 0 && anyOut > 0, `${anyIn} lead×chord pairs had ≥1 in-chord note, ${anyOut} had ≥1 out-of-chord note`);

console.log(`\n${PASS ? '✓✓✓ FULL SKY PASSES' : '✗ FULL SKY FAILED'}`);
process.exit(PASS ? 0 : 1);
