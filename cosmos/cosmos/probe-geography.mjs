// probe-geography.mjs — dev probe (NOT a guard, no pass/fail exit code) for the Sky Root handoff's
// Feature A: does the normalized field term actually make the chord walk sensitive to WHERE you are?
//
// FULL_SKY_STATE_2026-07-21.md diagnosed the pre-Feature-A walk as location-invariant: coverage() over
// AUDIBLE_N=10 aggregated real stars saturates near 1.0 everywhere (spread only 0.02-0.07), so the OLD
// un-normalized field term (λ·(1-coverage)) maxed out around 0.05-0.14 — utterly dwarfed by vlParsimony's
// integer cost scale, so the walk always took the same cheapest P/L step regardless of location. This
// probe rebuilds that exact experiment against the FIXED (normalized) chooseNextChord: N disjoint real
// "locations" (10 real codex grids each, full per-grid pools via gridShardSolve — no distance weighting,
// same methodology as the throwaway probe FULL_SKY_STATE describes), a 12-step walk from I at each.
//
// Success criterion for Feature A: different locations produce DIFFERENT trails.
import { readFileSync } from 'fs';
import { gridShardSolve, shardKeysOf } from '../grid-core.js';
import { TRIADS, START_CHORD_ID, coverage, chooseNextChord, pushTabu } from '../sky-walk.js';
import { TABU_K, LAMBDA_FIELD } from '../cosmos-audio.js';

const N_LOCATIONS = 5, GRIDS_PER_LOCATION = 10, WALK_STEPS = 12;

// One grid's full aggregate degree pool — fold every one of its shards (same fold rule the runtime's
// mergeSkyPool uses: per degree, keep the min |dev| tone). No distance weighting here (the probe has no
// camera) — every location grid contributes weight 1, matching FULL_SKY_STATE's methodology.
function gridPool(G) {
  const pool = new Array(12).fill(null);
  for (const A of shardKeysOf(G)) {
    const { pool: shardPool } = gridShardSolve(G, A);
    for (let d = 0; d < 12; d++) if (shardPool[d] && (!pool[d] || Math.abs(shardPool[d].dev) < Math.abs(pool[d].dev))) pool[d] = shardPool[d];
  }
  return pool;
}

function runWalk(audibleStars) {
  let current = START_CHORD_ID, tabu = pushTabu([], current, TABU_K);
  const trail = [TRIADS[current].symbol];
  for (let i = 0; i < WALK_STEPS; i++) {
    const next = chooseNextChord(current, tabu, t => coverage(t, audibleStars), { lambdaField: LAMBDA_FIELD });
    current = next.id; pushTabu(tabu, current, TABU_K); trail.push(next.symbol);
  }
  return trail;
}

console.log('═══ probe-geography — Feature A location sensitivity ═══');
console.log(`TABU_K=${TABU_K} LAMBDA_FIELD=${LAMBDA_FIELD} — production defaults, real codex grids, no camera distance weighting\n`);

const idx = JSON.parse(readFileSync(new URL('../data/oracle-index.json', import.meta.url)));
// Same sampling shape assert-fullsky.mjs's M1 section uses: a few named abundant grids (so at least one
// location is genuinely rich) plus a wide slice of real index entries (natural mix of sizes/shapes).
const pool = [...new Set([2640, 7920, 1092, 1650, 552, 15840, 99990, ...idx.grid.slice(0, 400)])].filter(g => g >= 2);
const stride = Math.floor(pool.length / N_LOCATIONS);
if (stride < GRIDS_PER_LOCATION) throw new Error(`sample pool too small for ${N_LOCATIONS} disjoint locations of ${GRIDS_PER_LOCATION}`);

const locations = [];
for (let i = 0; i < N_LOCATIONS; i++) locations.push(pool.slice(i * stride, i * stride + GRIDS_PER_LOCATION));

const results = locations.map((grids, i) => {
  const audibleStars = grids.map(G => ({ pool: gridPool(G), weight: 1 }));
  const covByTriad = TRIADS.map(t => coverage(t, audibleStars));
  const spread = Math.max(...covByTriad) - Math.min(...covByTriad);
  const trail = runWalk(audibleStars);
  console.log(`location ${i}: grids [${grids.join(', ')}]`);
  console.log(`  coverage spread (24 triads): min ${Math.min(...covByTriad).toFixed(3)} max ${Math.max(...covByTriad).toFixed(3)} spread ${spread.toFixed(3)}`);
  console.log(`  ${WALK_STEPS}-step walk: ${trail.join(' → ')}\n`);
  return { grids, spread, trail: trail.join(' → ') };
});

const distinctTrails = new Set(results.map(r => r.trail));
console.log(`${distinctTrails.size}/${results.length} distinct trails across ${results.length} disjoint locations.`);
console.log(distinctTrails.size > 1
  ? '✓ Feature A criterion met: different locations produce different trails.'
  : '✗ all locations produced the SAME trail — field term is still not differentiating by location.');
