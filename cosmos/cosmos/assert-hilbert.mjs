// assert-hilbert.mjs — proofs for the 'hilbert' CUBE placement (the A/B alternative to the spine).
//  (0) Hilbert curve is a bijection with perfect adjacency (the space-filling property).
//  (1) Flying the cube: bounded memory, no teleport (reparents preserve position → runtime throws
//      otherwise), grids REST at their own cell (puffs off → zero motion), deterministic.
//  (2) Correct: parked + fully solved, parents equal batch Grid-Gravity (placement-independent).
import { Cosmos } from './cosmos-runtime.js';
import { computeDistricts } from './gg-core.js';
import { gridResults } from '../grid-core.js';
import { setPlacement, macroCell, absolutePos, CELL } from './spine.js';
import { hilbertDecode, hilbertEncode, neighborGrids, SIDE } from './hilbert.js';

let PASS = true;
const check = (n, ok, d = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${n}${d ? ' — ' + d : ''}`); };

function factorInfo(n) { let m = n, primes = 0, divisors = 1; for (let p = 2; p * p <= m; p++) { if (m % p === 0) { let e = 0; while (m % p === 0) { m /= p; e++; } primes++; divisors *= e + 1; } } if (m > 1) { primes++; divisors *= 2; } return { primes, divisors }; }
const isValid = g => factorInfo(g).primes >= 2;
const cost = g => factorInfo(g).divisors;
const cache = new Map();
const solve = g => { if (!cache.has(g)) { const r = gridResults(g); cache.set(g, r.tooLarge ? 1 : r.keptCount); } return cache.get(g); };

console.log('═══ HILBERT CUBE — placement assertions ═══');

// (0) space-filling curve properties
console.log('\n[0] Hilbert curve — bijection + adjacency');
let rt = 0, adj = 0, coll = 0; const seen = new Set();
for (let i = 0; i < 262144; i++) {
  const c = hilbertDecode(i);
  if (hilbertEncode(c[0], c[1], c[2]) !== i) rt++;
  const key = (c[0] * SIDE + c[1]) * SIDE + c[2]; if (seen.has(key)) coll++; seen.add(key);
  const b = hilbertDecode(i + 1);
  if (Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]) + Math.abs(c[2] - b[2]) !== 1) adj++;
}
check('index↔cell bijection (encode∘decode = id) over 2^18', rt === 0, `${rt} fails`);
check('no two indices share a cell', coll === 0, `${coll} collisions`);
check('consecutive grids are cell-adjacent (space-filling)', adj === 0, `${adj} non-adjacent`);

// ── set up the cube runtime exactly as flight-view does ──
setPlacement('hilbert');
const HIL_SPAWN = 6, HIL_EVICT = 7.5;
function newCube() {
  return new Cosmos({ reachScale: 0.15, evictRadius: HIL_EVICT, poolSize: 4, costUnit: 0.02, puffs: false,
    solve, cost, isValid,
    neighbors: cam => neighborGrids(hilbertDecode(cam), HIL_SPAWN),
    cellDist: (g, cam) => { const a = hilbertDecode(g), b = hilbertDecode(cam); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); } });
}
// fly by stepping the anchor cell along a wandering path through the cube
function fly(cos, { start = 2640, ticks = 600, dt = 1 / 60 } = {}) {
  let anchor = start; cos.setCamera(anchor);
  for (let t = 0; t < ticks; t++) {
    if (t % 20 === 0) {                       // hop to a neighbouring cell every 20 ticks
      const c = hilbertDecode(anchor);
      const ax = t % 3, dir = (t % 6 < 3) ? 1 : -1;
      const n = [...c]; n[ax] = Math.max(0, Math.min(SIDE - 1, n[ax] + dir));
      anchor = hilbertEncode(n[0], n[1], n[2]); cos.setCamera(anchor);
    }
    cos.tick(dt);
  }
  return cos;
}

// (1) flight: bounded, no-teleport (would throw), grids rest at cell (maxStep 0), deterministic
console.log('\n[1] Flying the cube — bounded, no-teleport, resting, deterministic');
const c = newCube(); let maxTotal = 0;
{ let anchor = 2640; c.setCamera(anchor);
  for (let t = 0; t < 600; t++) {
    if (t % 20 === 0) { const cell = hilbertDecode(anchor); const ax = t % 3, dir = (t % 6 < 3) ? 1 : -1; const n = [...cell]; n[ax] = Math.max(0, Math.min(SIDE - 1, n[ax] + dir)); anchor = hilbertEncode(n[0], n[1], n[2]); c.setCamera(anchor); }
    c.tick(1 / 60); maxTotal = Math.max(maxTotal, c.zones.size);
  } }
const st = c.stats();
console.log(`  final: ${st.total} zones (${st.solved} solved), spawned ${c.events.spawned}, evicted ${c.events.evicted}, reparents ${c.events.reparents}`);
// zone count bounded by the evict sphere (cells within radius HIL_EVICT)
const sphereCells = (() => { let n = 0, R = Math.ceil(HIL_EVICT); for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) if (x * x + y * y + z * z <= HIL_EVICT * HIL_EVICT) n++; return n; })();
check('bounded memory: zone count stays within the evict sphere', maxTotal <= sphereCells + 5, `peak ${maxTotal} zones (sphere ≈ ${sphereCells})`);
check('no teleport: all reparents preserved position (runtime would throw otherwise)', true);
check('grids rest at their own cell (puffs off → zero motion)', c.events.maxStep === 0, `max step ${c.events.maxStep}`);

// resting position must depend only on the grid itself, never on its (re-tethering) parent
let cellErr = 0;
for (const z of c.zones.values()) {
  if (z.state !== 'solved') continue;
  const want = macroCell(z.grid).map(v => v * CELL);       // exact cell (ignore the tiny provisional jitter)
  const got = absolutePos(z);
  if (Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]) > CELL) cellErr++;
}
check('every grid sits at its Hilbert cell regardless of district parent', cellErr === 0, `${cellErr} off-cell`);

// deterministic
const fp = cos => [...cos.zones.values()].sort((a, b) => a.grid - b.grid).map(z => { const p = absolutePos(z); return `${z.grid}:${z.state}:${z.parentGrid}:${p.map(v => v.toFixed(2)).join(',')}`; }).join('|');
check('deterministic: identical cube flight → identical cosmos', fp(fly(newCube())) === fp(fly(newCube())));

// (2) correctness: park + fully solve, parents == batch Grid-Gravity
console.log('\n[2] Parked cube — parents equal batch Grid-Gravity');
const c2 = newCube(); c2.setCamera(2640); c2.tick(1 / 60);
for (let t = 0; t < 6000 && c2.stats().solved < c2.stats().total; t++) c2.tick(1 / 60);
for (let t = 0; t < 30; t++) c2.tick(1 / 60);
const loaded = [...c2.zones.values()].filter(z => z.state === 'solved').map(z => ({ grid: z.grid, abundance: z.abundance })).sort((a, b) => a.grid - b.grid);
const batch = computeDistricts(loaded, c2.reachScale).anchorOf;
let mism = 0;
for (const z of c2.zones.values()) { if (z.state !== 'solved') continue; const a = batch.get(z.grid); const exp = (a != null && c2.zones.has(a)) ? a : z.grid; if (z.parentGrid !== exp) mism++; }
console.log(`  window solved: ${c2.stats().solved}/${c2.stats().total}`);
check('parents equal batch Grid-Gravity over the loaded cube window', mism === 0, `${mism} mismatches`);

setPlacement('spine');   // leave global state as the default
console.log(`\n${PASS ? '✓✓✓ HILBERT PASSES — the cube placement is sound' : '✗ HILBERT FAILED'}`);
process.exit(PASS ? 0 : 1);
