// assert-chordwalk.mjs — proofs for chord-walk.js (Part A of the Chord Walk, see ../CHORD_WALK_HANDOFF.md).
//  [1] real codex keys are cardinality 12 (the corpus for everything below)
//  [2] determinism — same layers -> identical Song, every time
//  [3] frame sanity — semitone-0 deviation 0, strength in [0,1], no reuse needed for a full 12T scale
//  [4] vlCost properties — self-cost 0, symmetric, finite & non-negative
//  [5] P/L/R structural check — a pure-math property of the circ12 metric, independent of any star
//  [6] walk/cycle invariants — length caps, per-chord shape, voices populated except the very first
//  [7] degenerates — tiny-cardinality layers never throw
import { readFileSync } from 'fs';
import { solveStarSong } from '../chord-walk.js';
import { deriveScale } from '../oracle-core.js';
import '../../Playback/AdvancedPlayback/ProgressionSolver.js';
const PS = globalThis.ProgressionSolver;

let PASS = true;
const check = (n, ok, d = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const TABU_K = 3, MAX_STEPS = 64;   // chord-walk.js DEFAULTS — every solveStarSong() call below uses defaults

console.log('═══ CHORD WALK — Part A assertions ═══');

// [1] real codex keys ─────────────────────────────────────────────────────────────────────────
console.log('\n[1] Real keys — sampled from the 12T codex');
const idx = JSON.parse(readFileSync(new URL('../data/oracle-index.json', import.meta.url)));
const keys = idx.keys;
const N = 30;
const sampled = Array.from({ length: N }, (_, i) => keys[Math.floor(i * keys.length / N)]);
let offCard = 0;
const corpus = sampled.filter(k => {
  const layers = k.split('.').map(Number);
  if (deriveScale(layers).cardinality !== 12) { offCard++; return false; }
  return true;
});
check(`sampled ${N} codex keys are cardinality 12`, offCard === 0, `${offCard} off-cardinality (skipped)`);

const results = corpus.map(k => ({ k, layers: k.split('.').map(Number), song: solveStarSong(k.split('.').map(Number)) }));
const withSong = results.filter(x => x.song);
console.log(`  ${withSong.length}/${corpus.length} keys have a playable triad vocabulary at the default threshold (rest → null, the documented graceful degenerate)`);

// [2] determinism ──────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Determinism');
let detMismatch = 0;
for (const { layers } of results) {
  const a = solveStarSong(layers), b = solveStarSong(layers);
  if (JSON.stringify(a) !== JSON.stringify(b)) detMismatch++;
}
check('solveStarSong(layers) twice → identical Song', detMismatch === 0, `${detMismatch}/${results.length} mismatches`);

// [3] frame sanity (12T) ───────────────────────────────────────────────────────────────────────
console.log('\n[3] Frame sanity (12T)');
let devZeroFail = 0, strengthFail = 0, relaxedFail = 0;
for (const { song } of withSong) {
  const root = song.frame.matches.find(m => m.semitone === 0);
  if (!root || root.deviation !== 0) devZeroFail++;
  // NB corrected vs the handoff's ">0": a scale maximally far from 12TET across every pair clamps
  // strength to exactly 0 (real codex keys hit this — verified empirically, not a bug) — so [0,1], not (0,1].
  if (!(song.frame.strength >= 0 && song.frame.strength <= 1)) strengthFail++;
  if (song.frame.relaxed !== false) relaxedFail++;   // 12T scale = full chromatic, no reuse needed
}
check('semitone-0 deviation === 0', devZeroFail === 0, `${devZeroFail}/${withSong.length}`);
check('0 ≤ frame.strength ≤ 1', strengthFail === 0, `${strengthFail}/${withSong.length}`);
check('relaxed === false for full 12T scales', relaxedFail === 0, `${relaxedFail}/${withSong.length}`);
const avgPlayable = withSong.reduce((s, x) => s + x.song.frame.playableSlots.length, 0) / (withSong.length || 1);
console.log(`  (typical playable slots: ${avgPlayable.toFixed(1)}/12 across the sample)`);

// [4] vlCost properties ────────────────────────────────────────────────────────────────────────
// vlCost is a private helper (solveStarSong is chord-walk.js's one public entry point per spec), so
// verify the property against a REFERENCE reimplementation of the exact same formula, applied to
// real chord objects (with real `.matches`) pulled out of solved songs.
console.log('\n[4] vlCost properties');
const PERMS3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const circ12 = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };
function vlCostRef(A, B, alpha = 1, beta = 1 / 50) {
  let best = Infinity;
  for (const perm of PERMS3) {
    let sum = 0;
    for (let i = 0; i < 3; i++) { const mA = A.matches[i], mB = B.matches[perm[i]]; sum += alpha * circ12(mA.semitone, mB.semitone) + beta * PS.pairDeviation(mA, mB); }
    if (sum < best) best = sum;
  }
  return best;
}
let selfFail = 0, symFail = 0, finiteFail = 0, negFail = 0, pairs = 0;
for (const { song } of withSong) {
  const chords = [...song.transient, ...song.cycle];
  for (let i = 0; i < chords.length; i++) {
    if (vlCostRef(chords[i], chords[i]) !== 0) selfFail++;
    for (let j = i + 1; j < chords.length; j++) {
      pairs++;
      const ab = vlCostRef(chords[i], chords[j]), ba = vlCostRef(chords[j], chords[i]);
      if (Math.abs(ab - ba) > 1e-9) symFail++;
      if (!Number.isFinite(ab) || !Number.isFinite(ba)) finiteFail++;
      if (ab < 0 || ba < 0) negFail++;
    }
  }
}
check('vlCost(A,A) === 0', selfFail === 0, `${selfFail} fails`);
check('vlCost(A,B) === vlCost(B,A)', symFail === 0, `${symFail}/${pairs} asymmetric`);
check('all costs finite and ≥ 0', finiteFail === 0 && negFail === 0, `${finiteFail} non-finite, ${negFail} negative`);

// [5] P/L/R structural check ───────────────────────────────────────────────────────────────────
// Pure metric property, independent of any star/frame (β=0 removes JI entirely — only circ12 over
// abstract semitone sets, no chord-walk.js or PS needed here).
// CORRECTED vs the handoff draft: only P (parallel) and L (Leittonwechsel) sit at α-cost 1 from a
// major triad under the plain circular-semitone-sum metric — the standard neo-Riemannian fact that
// P/L move by a single semitone while R (relative) moves by a WHOLE TONE. Verified by exhaustive
// enumeration over all 6 bijections for every root: R's minimal cost is 2, not 1, and nothing beats
// P/L's 1. The walk itself is unaffected (it already uses whatever vlCost reports); only the
// handoff's stated expectation for this guard needed the fix.
console.log('\n[5] P/L/R structural check (β=0 — pure parsimony metric)');
const triadSemis = (r, q) => q === 'maj' ? [r, (r + 4) % 12, (r + 7) % 12] : [r, (r + 3) % 12, (r + 7) % 12];
function circCost(a, b) {
  let best = Infinity;
  for (const perm of PERMS3) { let sum = 0; for (let i = 0; i < 3; i++) sum += circ12(a[i], b[perm[i]]); if (sum < best) best = sum; }
  return best;
}
let plrFail = 0; const plrDetail = [];
for (let r = 0; r < 12; r++) {
  const major = triadSemis(r, 'maj');
  const costP = circCost(major, triadSemis(r, 'min'));           // Parallel: minor, same root
  const costL = circCost(major, triadSemis((r + 4) % 12, 'min')); // Leittonwechsel: minor on the major 3rd
  const costR = circCost(major, triadSemis((r + 9) % 12, 'min')); // Relative: minor on the submediant
  if (costP !== 1) { plrFail++; plrDetail.push(`r=${r} P=${costP}`); }
  if (costL !== 1) { plrFail++; plrDetail.push(`r=${r} L=${costL}`); }
  if (costR !== 2) { plrFail++; plrDetail.push(`r=${r} R=${costR}`); }
  for (let s = 0; s < 12; s++) for (const q of ['maj', 'min']) {
    if (s === r && q === 'maj') continue;
    if (circCost(major, triadSemis(s, q)) < 1) { plrFail++; plrDetail.push(`r=${r} beats P/L at ${s}${q}`); }
  }
}
check('P and L sit at α-cost exactly 1; R at α-cost exactly 2; nothing beats 1', plrFail === 0, plrDetail.slice(0, 3).join('; '));

// [6] walk/cycle invariants ────────────────────────────────────────────────────────────────────
console.log('\n[6] Walk/cycle invariants');
let capFail = 0, matchFail = 0, windowFail = 0, voicesFail = 0, tabuBoundChecked = 0, tabuBoundFail = 0;
for (const { song } of withSong) {
  const all = [...song.transient, ...song.cycle];
  if (song.transient.length + song.cycle.length > MAX_STEPS) capFail++;
  if (song.vocabularySize > TABU_K + 1) {   // "when vocabulary permits" — no tabu-length shrink occurred
    tabuBoundChecked++;
    if (song.cycle.length < TABU_K + 1) tabuBoundFail++;
  }
  all.forEach((c, idx) => {
    if (c.matches.length !== 3) matchFail++;
    if (!c.windowFractions || !c.windowFractions.length) windowFail++;
    const isOverallFirst = idx === 0;
    if (isOverallFirst ? c.voices != null : c.voices == null) voicesFail++;
  });
}
check('transient+cycle length ≤ maxSteps', capFail === 0, `${capFail} over cap`);
check('cycle length ≥ tabuK+1 when vocabulary permits', tabuBoundFail === 0, `${tabuBoundFail}/${tabuBoundChecked} short`);
check('every chord has matches.length === 3', matchFail === 0, `${matchFail} bad`);
check('every chord has non-empty windowFractions', windowFail === 0, `${windowFail} empty`);
check('voices populated except the very first chord', voicesFail === 0, `${voicesFail} bad`);

// [7] degenerates ──────────────────────────────────────────────────────────────────────────────
console.log('\n[7] Degenerates');
let thrown = false, result;
try { result = solveStarSong([2, 1]); } catch (e) { thrown = true; }
check('tiny-cardinality layers [2,1] → null, no throw', !thrown && result === null);

console.log(`\n${PASS ? '✓✓✓ CHORD WALK (Part A) PASSES' : '✗ CHORD WALK FAILED'}`);
process.exit(PASS ? 0 : 1);
