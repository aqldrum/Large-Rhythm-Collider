// assert-runtime.mjs — fly the cosmos runtime with the REAL generator underneath and prove:
//  (1) NON-BLOCKING: big zones don't stall cheap-zone throughput (pool stays productive).
//  (2) BOUNDED MEMORY: zone count stays bounded no matter how far you fly.
//  (3) NO TELEPORT: every reparent during flight preserves position (throws otherwise); steps bounded.
//  (4) CORRECT: once a region is fully solved, zone parents equal batch Grid-Gravity over the window.
//  (5) DETERMINISTIC: the same flight yields the identical cosmos (pure function of the path).
import { Cosmos } from './cosmos-runtime.js';
import { computeDistricts } from './gg-core.js';
import { gridResults } from '../grid-core.js';
import { absolutePos } from './spine.js';

// number theory: valid grid = ≥2 distinct prime factors (else no coprime polyrhythm exists)
function factorInfo(n) { let m = n, primes = 0, divisors = 1; for (let p = 2; p * p <= m; p++) { if (m % p === 0) { let e = 0; while (m % p === 0) { m /= p; e++; } primes++; divisors *= e + 1; } } if (m > 1) { primes++; divisors *= 2; } return { primes, divisors }; }
const isValid = g => factorInfo(g).primes >= 2;
const cost = g => factorInfo(g).divisors;                       // highly-composite grids cost more (matches real)
const abundanceCache = new Map();
const solve = g => { if (!abundanceCache.has(g)) { const r = gridResults(g); abundanceCache.set(g, r.tooLarge ? 1 : r.keptCount); } return abundanceCache.get(g); };

let PASS = true;
const check = (n, ok, d = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

function newCosmos() {
  return new Cosmos({ reachScale: 0.15, spawnRadius: 60, evictRadius: 90, poolSize: 4, costUnit: 0.02, solve, cost, isValid });
}

// ── Flight: start at a grid, cruise forward through a dense region ──
function fly(cosmos, { start = 800, ticks = 900, dt = 1 / 60, speedGridsPerSec = 15 } = {}) {
  cosmos.setCamera(start);
  let camF = start;
  for (let t = 0; t < ticks; t++) {
    camF += speedGridsPerSec * dt;
    cosmos.setCamera(camF);
    cosmos.tick(dt);
  }
  return cosmos;
}

console.log('═══ COSMOS RUNTIME — flight assertions ═══');

// (1) non-blocking + (2) bounded + (3) no-teleport, from a single flight
console.log('\n[flight] cruising grid 800 → ~1025 over 900 ticks, pool=4');
const c = newCosmos();
let maxTotal = 0;
c.setCamera(800); let camF = 800;
for (let t = 0; t < 900; t++) { camF += 15 * (1 / 60); c.setCamera(camF); c.tick(1 / 60); maxTotal = Math.max(maxTotal, c.zones.size); }
const st = c.stats();
console.log(`  final: ${st.total} zones (${st.solved} solved, ${st.pending} pending), ${c.events.spawned} spawned, ${c.events.evicted} evicted, ${c.events.reparents} reparents`);

// (1) NON-BLOCKING: during the single longest solve, how many other solves completed?
const solves = c.events.solves;
let longest = solves[0]; for (const s of solves) if (s.dur > (longest?.dur || 0)) longest = s;
const overlapCompleted = solves.filter(s => s.doneAt > longest.startAt && s.doneAt <= longest.doneAt && s.grid !== longest.grid).length;
check('non-blocking: cheap zones keep completing while the biggest zone cooks',
  overlapCompleted >= c.poolSize, `${overlapCompleted} solves completed during longest solve (grid ${longest.grid}, dur ${longest.dur.toFixed(2)})`);

// (2) BOUNDED MEMORY: window is ~2*evictRadius valid grids regardless of distance flown
check('bounded memory: zone count stays near the LOD window while flying far',
  maxTotal < 2 * c.evictRadius + 20, `peak ${maxTotal} zones (window ≈ ${2 * c.evictRadius})`);

// (3) NO TELEPORT: reparents never threw (would abort), and steps stayed bounded
check('no teleport: all reparents preserved position; motion bounded', c.events.maxStep < 100, `max step ${c.events.maxStep.toFixed(2)} units`);

// (4) CORRECT: park the camera, fully solve the window, compare parents to batch GG over that window
console.log('\n[settle] parking camera at 1000 until the window is fully solved');
const c2 = newCosmos(); c2.setCamera(1000);
c2.tick(1 / 60); // prime: spawn the frontier so total > 0 before the drain loop
for (let t = 0; t < 4000 && c2.stats().solved < c2.stats().total; t++) c2.tick(1 / 60);
for (let t = 0; t < 60; t++) c2.tick(1 / 60); // let competition + motion settle
const s2 = c2.stats();
const loaded = [...c2.zones.values()].filter(z => z.state === 'solved').map(z => ({ grid: z.grid, abundance: z.abundance })).sort((a, b) => a.grid - b.grid);
const batch = computeDistricts(loaded, c2.reachScale).anchorOf;
let parentMismatch = 0;
for (const z of c2.zones.values()) {
  if (z.state !== 'solved') continue;
  const anchor = batch.get(z.grid);
  const expected = (anchor != null && c2.zones.has(anchor)) ? anchor : z.grid;
  if (z.parentGrid !== expected) parentMismatch++;
}
console.log(`  window fully solved: ${s2.solved}/${s2.total} zones`);
check('correct: runtime parents equal batch Grid-Gravity over the loaded window', parentMismatch === 0, `${parentMismatch} mismatches`);

// (5) DETERMINISTIC: identical flight → identical cosmos (parents + positions)
function fingerprint(cos) {
  const rows = [...cos.zones.values()].sort((a, b) => a.grid - b.grid).map(z => {
    const p = absolutePos(z); return `${z.grid}:${z.state}:${z.parentGrid}:${p.map(v => v.toFixed(3)).join(',')}`;
  });
  return rows.join('|');
}
const A = newCosmos(); fly(A, { start: 850, ticks: 700 });
const B = newCosmos(); fly(B, { start: 850, ticks: 700 });
check('deterministic: same flight path → identical cosmos (parents + positions)', fingerprint(A) === fingerprint(B));

console.log(`\n${PASS ? '✓✓✓ RUNTIME PASSES — spawn/solve/evict/compete/orbit is sound; ready for Three.js' : '✗ RUNTIME FAILED'}`);
process.exit(PASS ? 0 : 1);
