// grid-core.js — live generator for ONE grid's complete result set, all cardinalities,
// under the codex's real validity + keep-two rules. No database: this reproduces the
// compiled codex bit-for-bit (validated: exact match at grids 552/2640/7920/15840/99990).
//
// Pipeline (from LRC Master Search/ALGORITHM.md):
//   layers are divisors of G · LCM==G · gcd==1 · no direct-factor redundancy
//   → derive cardinality + ratioSet
//   → keep-two per (fundamental | ratioSet): min & max layer-sum instances.
import { deriveScale, lcmAll, gcdAll } from './oracle-core.js';

export function divisorsOf(G) { const d = []; for (let i = 1; i <= G; i++) if (G % i === 0) d.push(i); return d; }

// O(√G) divisors via prime factorization — divisorsOf is O(G), a real stall once grids reach
// the millions (Hilbert flight), so the solve path uses this. Returns ascending, same set.
export function divisorsFast(G) {
  const ds = [1];
  let n = G;
  for (let p = 2; p * p <= n; p++) {
    if (n % p !== 0) continue;
    let e = 0; while (n % p === 0) { n /= p; e++; }
    const cur = ds.length; let pe = 1;
    for (let k = 1; k <= e; k++) { pe *= p; for (let i = 0; i < cur; i++) ds.push(ds[i] * pe); }
  }
  if (n > 1) { const cur = ds.length; for (let i = 0; i < cur; i++) ds.push(ds[i] * n); }
  return ds.sort((a, b) => a - b);
}

// ── Sharded solve (for distributed flight) ─────────────────────────────────────────────────────
// abundance(G) = Σ over max-layers A of keptCount(shard A). A shard fixes the largest layer = A
// (⟺ fundamental G/A), enumerates the smaller layers from divisors below A, and applies keep-two
// LOCALLY (fundamental is fixed within a shard, so keep-two never spans shards). Each shard is a
// bounded C(#divisorsBelowA, ≤3) task, so a worker takes one bite and yields — no head-of-line stall.

// The shard keys for G = its PROPER divisors ≥ 2 (each a candidate max-layer), i.e. [2, G). G itself is
// excluded: a layer == G makes every other layer divide it (directFactorRedundant), so that shard is always
// empty — including it wasted a dispatch and, worse, made the largest key == G (breaking any max-layer gate).
export function shardKeysOf(G) { return divisorsFast(G).filter(a => a >= 2 && a < G); }

// Cheap live-solve COST proxy from the (ascending) shard keys: Σ over shards A of C(#divisorsBelowA, ≤3)·A —
// combos-per-shard × per-combo deriveScale cost (~A). Predicts BOTH cost drivers without solving: combinatorial
// (many divisors → big C(...)) and deep (large max-layer → big A). Calibrated: grid 2640 ≈ 61M (ms), 8,081,605
// ≈ 4.8e9 (3.3s), 27,720 ≈ 1.2e10 (24s). Used to pre-identify "monster" grids gated behind an explicit override.
export function gridCost(keysGe2) {
  let sum = 0;
  for (let i = 0; i < keysGe2.length; i++) { const k = i, combos = 1 + k + (k * (k - 1)) / 2 + (k * (k - 1) * (k - 2)) / 6; sum += combos * keysGe2[i]; }
  return sum;
}

// The tuning-system GROUPS of one shard (max-layer A): enumerate valid layer sets whose max is A,
// group by ratioSet (fundamental is fixed within a shard → keep-two is ratioSet-local). `belowIn`
// optionally passes the precomputed ascending divisors in [2, A) to avoid re-factoring per shard.
function shardGroups(G, A, below) {
  const valid = [];
  const rec = (start, cur) => {
    if (cur.length >= 1) {                                  // ≥2 layers total (A + ≥1 below)
      const arr = [A, ...cur].sort((a, b) => b - a);        // A is the max by construction
      if (lcmAll(arr) === G && gcdAll(arr) === 1 && !directFactorRedundant(arr)) {
        const s = deriveScale(arr); s.layerSum = arr.reduce((x, y) => x + y, 0);
        valid.push(s);
      }
    }
    if (cur.length >= 3) return;                            // ≤4 layers total
    for (let i = start; i < below.length; i++) rec(i + 1, [...cur, below[i]]);
  };
  rec(0, []);
  const groups = new Map();
  for (const s of valid) { let g = groups.get(s.ratioSet); if (!g) groups.set(s.ratioSet, g = []); g.push(s); }
  return [...groups.values()];
}

// Kept COUNT for one shard (keep-two: 2 per paired group, 1 per solo) — the abundance/star-size metric.
export function gridShardCount(G, A, belowIn) {
  const below = belowIn || divisorsFast(G).filter(d => d >= 2 && d < A);
  let kept = 0;
  for (const g of shardGroups(G, A, below)) kept += g.length > 1 ? 2 : 1;
  return kept;
}

// The tuning SYSTEMS of one shard — one entry per group — for the near-star bloom. The representative
// is the EFFICIENT (min layer-sum) instance of the group, matching keep-two's `eff`, so its `key`/
// `layers` are the codex identity used for charted lookups and the click-to-inspect detail panel.
// Σ over shards = the grid's full system set, so blooming a grid shard-by-shard streams it in whole.
export function gridShardSystems(G, A, belowIn) {
  const below = belowIn || divisorsFast(G).filter(d => d >= 2 && d < A);
  return shardGroups(G, A, below).map(g => {
    let eff = g[0]; for (const s of g) if (s.layerSum < eff.layerSum) eff = s;
    return { c: eff.cardinality, dense: g.length > 1, key: eff.key, layers: eff.layers, fund: eff.fundamental, rs: eff.ratioSet };
  });
}

// A layer is redundant if it exactly divides another layer in the set (same scale, padded).
export function directFactorRedundant(layers) {
  return layers.some(a => layers.some(b => b !== a && a % b === 0));
}

// Generate the full kept result set for grid G. Returns everything the view needs.
export function gridResults(G, { minFundamental = 1, rangeCap = Infinity, maxDivisors = 220 } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const divs = divisorsOf(G);
  if (divs.length > maxDivisors) {
    return { grid: G, tooLarge: true, divisorCount: divs.length, kept: [], byCardinality: {}, ms: 0 };
  }

  const valid = [];
  const rec = (start, cur) => {
    if (cur.length >= 2) {
      const arr = [...cur].sort((a, b) => b - a);
      if (lcmAll(arr) === G && gcdAll(arr) === 1 && !directFactorRedundant(arr)) {
        const fund = G / arr[0], range = arr[0] / arr[arr.length - 1];
        if (fund >= minFundamental && range <= rangeCap) {
          const s = deriveScale(arr);
          s.layerSum = arr.reduce((x, y) => x + y, 0);
          valid.push(s);
        }
      }
    }
    if (cur.length >= 4) return;
    for (let i = start; i < divs.length; i++) rec(i + 1, [...cur, divs[i]]);
  };
  rec(0, []);

  // keep-two per (fundamental | ratioSet): the efficient (min sum) and dense (max sum) instances
  const groups = new Map();
  for (const s of valid) {
    const k = s.fundamental + '|' + s.ratioSet;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const kept = [];
  for (const [, arr] of groups) {
    arr.sort((a, b) => a.layerSum - b.layerSum);
    const eff = arr[0]; eff.role = arr.length > 1 ? 'efficient' : 'solo'; kept.push(eff);
    if (arr.length > 1) { const dense = arr[arr.length - 1]; dense.role = 'dense'; dense.pairOf = eff.key; kept.push(dense); }
  }

  const byCardinality = {};
  for (const s of kept) (byCardinality[s.cardinality] ||= []).push(s);

  return {
    grid: G,
    kept,
    byCardinality,
    tuningSystems: groups.size,
    validCount: valid.length,
    keptCount: kept.length,
    cardinalities: Object.keys(byCardinality).map(Number).sort((a, b) => a - b),
    ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
}
