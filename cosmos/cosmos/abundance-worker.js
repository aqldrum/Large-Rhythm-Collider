// abundance-worker.js — distributed solve. Instead of computing a whole grid's abundance in one
// blocking call (which stalls the worker on hyper-abundant grids), the work is SHARDED by max-layer
// (⟺ fundamental): abundance(G) = Σ over shards of keptCount(shard). Two ops:
//   plan       → the shard keys (proper divisors [2,G)) for a grid, cheap (O(√G)). Classifies monster/tooLarge by cost.
//   shard      → keptCount + lowest-layer-sum ratio owners for ONE shard (G, A). Bounded work.
//   bloomShard → the tuning SYSTEMS of ONE shard (for the near-star bloom). Same sharding: the bloom
//                streams in shard-by-shard instead of one 20-second whole-grid solve blocking a worker.
// NOTE: the ?v= on this import is a cache-bust — browsers cache Web Workers (and their imports) hard, so bump
// it (and the Worker URL in flight-view.js) whenever this file or grid-core.js changes, or stale code lingers.
import { gridPlan, gridShardSystems, gridShardSolve, divisorsFast } from '../grid-core.js?v=6';

self.onmessage = (e) => {
  const d = e.data;
  try {
    if (d.op === 'plan') {
      self.postMessage({ id: d.id, ...gridPlan(d.grid, d.force) });
    } else if (d.op === 'bloomShard') {
      // near-star LOD, one shard's tuning systems ({c,dense}). Bounded like the abundance shard → the
      // bloom accumulates shard-by-shard on the client, never blocking a worker on the whole grid.
      const below = divisorsFast(d.grid).filter(x => x >= 2 && x < d.A);
      self.postMessage({ id: d.id, systems: gridShardSystems(d.grid, d.A, below) });
    } else { // op === 'shard'
      // Full Sky: the same pass that counts kept systems also folds their ratios into the shard's
      // 12-slot degree pool AND its anchor-independent tone list (piggybacked, see grid-core.js — no
      // second enumeration). Sky Root handoff B1: `tones` is the superset the root solve reads from.
      const below = divisorsFast(d.grid).filter(x => x >= 2 && x < d.A);
      const { count, pool, toneCount, tones, ratioOwners } = gridShardSolve(d.grid, d.A, below);
      self.postMessage({ id: d.id, count, pool, toneCount, tones, ratioOwners });
    }
  } catch (err) {
    // NEVER leave the pool slot hanging — always reply, flagged as an error so the runtime can log it.
    self.postMessage({ id: d.id, error: `${d.op} grid ${d.grid}${d.A ? ' A' + d.A : ''}: ${err && err.message || err}` });
  }
};
