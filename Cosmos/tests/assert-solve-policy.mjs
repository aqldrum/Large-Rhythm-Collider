// Assertions for high-grid relaxation: classification, the global heavy lane, and timed-out worker recovery.
import { gridPlan, gridCost, shardKeysOf, MONSTER_GRID_COST, HEAVY_SHARD_LAYER, REAL_RHYTHM_MAX_RANGE } from '../engine/grid-core.js';
import { SolverWorkerPool } from '../engine/solver-worker-pool.js';

let PASS = true;
const check = (name, ok, detail = '') => {
  PASS = PASS && ok;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('═══ COSMOS SOLVE POLICY — high-grid assertions ═══');

console.log('\n[1] Classification');
const deepSparse = gridPlan(8_081_605);
check('a sparse grid with a 1.6M max layer is no longer pre-classified as a monster',
  !!deepSparse.shards && !deepSparse.monster && deepSparse.maxLayer > HEAVY_SHARD_LAYER,
  `cost ${deepSparse.cost.toLocaleString()} < ${MONSTER_GRID_COST.toLocaleString()}`);

const combinatorial = gridPlan(27_720);
check('a genuinely combinatorial grid remains gated',
  combinatorial.monster === true && combinatorial.cost > MONSTER_GRID_COST,
  `cost ${combinatorial.cost.toLocaleString()}`);
check('force bypasses the combinatorial estimate', !!gridPlan(27_720, true).shards);

// 2026-09-27: no absolute caps. A deep grid past the old 3M max-layer cap plans real shards like any other, and
// the most divisor-rich grids in the cube (past the old 260-shard cap) are monster-gated, never refused.
const deepPastOldCap = gridPlan(6_000_002);
check('a grid past the old 3M max-layer cap plans real shards (no tooLarge any more)',
  !!deepPastOldCap.shards && !deepPastOldCap.tooLarge && deepPastOldCap.maxLayer > 3_000_000,
  `max layer ${deepPastOldCap.maxLayer.toLocaleString()}`);
const divisorRich = gridPlan(14_414_400);   // 504 divisors — past the old 260-shard cap
check('a grid past the old 260-shard cap is monster-gated, and force still solves it',
  divisorRich.monster === true && !divisorRich.tooLarge && gridPlan(14_414_400, true).shards?.length > 260,
  `${divisorRich.divisors} divisors`);

// Range-aware gate: flight plans under REAL_RHYTHM_MAX_RANGE, so the estimate counts only the layers the capped
// solve enumerates ([A/maxRange, A) per shard). The range-blind estimate flagged a third of the upper cube.
const flightPlan = g => gridPlan(g, false, REAL_RHYTHM_MAX_RANGE);
const deepFreed = [8_000_020, 16_700_013, 16_700_002];
check('deep sparse grids the range-blind estimate gated plan real shards under the flight range cap',
  deepFreed.every(g => gridPlan(g).monster === true && !!flightPlan(g).shards && !flightPlan(g).monster),
  deepFreed.map(g => `${g.toLocaleString()} ${gridPlan(g).cost.toExponential(1)}→${flightPlan(g).cost.toExponential(1)}`).join(' · '));
check('genuinely combinatorial grids stay gated under the flight range cap',
  [27_720, 55_440, 14_414_400].every(g => flightPlan(g).monster === true),
  `27,720 cost ${flightPlan(27_720).cost.toLocaleString()}`);
check('a grid whose layers all sit inside the range cap costs the same either way',
  flightPlan(2_640).cost === gridPlan(2_640).cost);
let monotone = true, neverNewlyGated = true;
for (const base of [2, 1_000_000, 16_700_000]) for (let g = base; g < base + 2_000; g++) {
  const keys = shardKeysOf(g), blind = gridCost(keys), ranged = gridCost(keys, REAL_RHYTHM_MAX_RANGE);
  if (ranged > blind) monotone = false;
  if (flightPlan(g).monster && !gridPlan(g).monster) neverNewlyGated = false;
}
check('the range-aware estimate never exceeds the range-blind one, so it never gates a grid the old gate passed',
  monotone && neverNewlyGated);
check('force still bypasses the gate under the flight range cap', !!gridPlan(27_720, true, REAL_RHYTHM_MAX_RANGE).shards);

console.log('\n[2] One-at-a-time heavy lane');
let workerNumber = 0, activeHeavy = 0, maxHeavy = 0;
const pendingHeavy = [];
class ControlledWorker {
  constructor() { this.number = ++workerNumber; this.terminated = false; }
  postMessage(message) {
    if (message.op === 'shard' && message.A > HEAVY_SHARD_LAYER) {
      activeHeavy++; maxHeavy = Math.max(maxHeavy, activeHeavy);
      pendingHeavy.push(() => { activeHeavy--; this.onmessage({ data: { id: message.id, count: 1 } }); });
    } else queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true } }));
  }
  terminate() { this.terminated = true; }
}
const lane = new SolverWorkerPool('fake-worker.js', 3, {
  workerFactory: () => new ControlledWorker(), heavyTimeoutMs: 1_000,
});
const firstHeavy = lane.dispatch({ op: 'shard', grid: 1, A: HEAVY_SHARD_LAYER + 1 });
const secondHeavy = lane.dispatch({ op: 'shard', grid: 2, A: HEAVY_SHARD_LAYER + 2 });
const cheap = lane.dispatch({ op: 'shard', grid: 3, A: 12 });
await cheap;
check('cheap work passes queued heavy work while the heavy lane is occupied', activeHeavy === 1 && pendingHeavy.length === 1);
pendingHeavy.shift()(); await firstHeavy;
await new Promise(resolve => setTimeout(resolve, 0));
check('the second heavy shard starts only after the first settles', activeHeavy === 1 && pendingHeavy.length === 1 && maxHeavy === 1);
pendingHeavy.shift()(); await secondHeavy;
lane.terminate();
check('global heavy concurrency never exceeds one', maxHeavy === 1);

console.log('\n[3] Timeout recovery');
const made = [];
class TimeoutWorker {
  constructor() { this.terminated = false; made.push(this); }
  postMessage(message) {
    if (message.op !== 'shard') queueMicrotask(() => this.onmessage({ data: { id: message.id, ok: true } }));
    // A heavy shard deliberately never replies; the pool must retire this worker.
  }
  terminate() { this.terminated = true; }
}
const recovering = new SolverWorkerPool('fake-worker.js', 1, {
  workerFactory: () => new TimeoutWorker(), heavyTimeoutMs: 10,
});
const timedOut = await recovering.dispatch({ op: 'shard', grid: 8_081_605, A: 1_616_321 });
check('a stalled heavy shard resolves with an explicit timeout result', timedOut.timedOut === true && timedOut.heavy === true);
check('the stalled worker is terminated and replaced', made.length === 2 && made[0].terminated && !made[1].terminated);
const afterRecovery = await recovering.dispatch({ op: 'plan', grid: 30 });
check('the replacement worker accepts subsequent work', afterRecovery.ok === true);
recovering.terminate();

console.log(`\n${PASS ? '✓✓✓ SOLVE POLICY PASSES — relaxed, bounded, recoverable' : '✗ SOLVE POLICY FAILED'}`);
process.exit(PASS ? 0 : 1);
