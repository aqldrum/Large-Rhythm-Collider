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

// ── Full Sky (cosmos/FULL_SKY_HANDOFF.md) — the degree pool, piggybacked on the abundance solve ──
// Global frame: degree 0 = 1/1, degrees d ∈ [0,12) at d·100 cents. Snap a tone's cents to its nearest
// degree (dev = signed cents distance, |dev| ≤ 50 by construction of "nearest").
// Sky Root handoff B2: generalized with an optional anchorCents (default 0, today's 1/1-anchored
// behavior, bit-for-bit — see assert-fullsky.mjs's B2 guard). Degree d of a frame anchored at
// anchorCents sits at `anchorCents + 100·d` (mod 1200); dev is still computed from the UNWRAPPED
// nearest multiple before wrapping into [0,12), same as the anchor-0 case always did.
export function nearestDegree(cents, anchorCents = 0) {
  const rel = cents - anchorCents;
  let d = Math.round(rel / 100);
  const dev = rel - d * 100;
  d = ((d % 12) + 12) % 12;
  return { d, dev };
}

// Fold a deriveScale() ratios[] array into a 12-slot degree pool: pool[d] = the best-tuned (min |dev|)
// {fraction, cents, dev} at degree d, or null; toneCount[d] = how many tones sit within 45¢ of d (chorus
// depth). 1/1 always lands at degree 0 dev 0 (it's the ratio=1 tone from the fundamental gap).
export function poolFromRatios(ratios, pool = new Array(12).fill(null), toneCount = new Array(12).fill(0)) {
  for (const r of ratios) {
    const { d, dev } = nearestDegree(r.cents);
    if (Math.abs(dev) <= 45) toneCount[d]++;
    if (!pool[d] || Math.abs(dev) < Math.abs(pool[d].dev)) pool[d] = { fraction: r.fraction, cents: r.cents, dev };
  }
  return { pool, toneCount };
}

// Sky Root handoff B1: anchor-independent tone lists. `poolFromRatios` keeps only the min-|dev| tone
// PER DEGREE under the 1/1 anchor and discards the rest — a tone that lost its slot under that anchor
// may be the winner under a solved root's anchor. Avery's rule: no tone is ever dropped from
// contention. So alongside the folded pool we ALSO carry every kept tone, deduped by quantized cents
// (0.5¢ bins — finer than any dev/gain law cares about, just collapses true duplicates/near-duplicates
// across representatives) — first occurrence per bin wins (shardGroups' enumeration order runs
// smaller/simpler layer combos first, so "first" and "simplest" coincide in practice).
export const TONE_BIN_CENTS = 0.5;
const toneBin = cents => Math.round(cents / TONE_BIN_CENTS);
export function tonesFromRatios(ratios, tones = [], seenBins = new Set()) {
  for (const r of ratios) {
    const bin = toneBin(r.cents);
    if (seenBins.has(bin)) continue;
    seenBins.add(bin);
    tones.push({ f: r.fraction, c: r.cents });
  }
  return { tones, seenBins };
}

// Ratio-owner reduction for monster-grid playback. Ownership is GLOBAL across a grid but reduced in
// two bounded stages: each shard returns its best efficient rhythm per folded ratio, then the client
// applies this same comparator across shard replies. Dense keep-2 partners never contend because they
// have the same ratio set as their efficient partner and an equal-or-higher layer sum.
export function compareRatioOwners(a, b) {
  if (a.layerSum !== b.layerSum) return a.layerSum - b.layerSum;
  if (a.layers.length !== b.layers.length) return a.layers.length - b.layers.length;
  for (let i = 0; i < Math.min(a.layers.length, b.layers.length); i++) {
    if (a.layers[i] !== b.layers[i]) return a.layers[i] - b.layers[i];
  }
  return a.key.localeCompare(b.key);
}

export function mergeRatioOwners(ownerMap, candidates) {
  for (const candidate of candidates || []) {
    const current = ownerMap.get(candidate.fraction);
    if (!current || compareRatioOwners(candidate, current) < 0) ownerMap.set(candidate.fraction, candidate);
  }
  return ownerMap;
}

// Kept count, the shard's degree pool, AND its anchor-independent tone list in ONE pass over
// shardGroups (no second enumeration): one representative per ratioSet group (they share ratios)
// folds into the shard-wide pool and tone list alike.
export function gridShardSolve(G, A, belowIn) {
  const below = belowIn || divisorsFast(G).filter(d => d >= 2 && d < A);
  const pool = new Array(12).fill(null), toneCount = new Array(12).fill(0);
  const tones = [], seenBins = new Set();
  const ratioOwnerMap = new Map();
  const groups = shardGroups(G, A, below);
  let count = 0, validCount = 0;
  for (const g of groups) {
    count += g.length > 1 ? 2 : 1;
    validCount += g.length;
    let efficient = g[0];
    for (const system of g) {
      const candidate = { layerSum: system.layerSum, layers: system.layers, key: system.key };
      const current = { layerSum: efficient.layerSum, layers: efficient.layers, key: efficient.key };
      if (compareRatioOwners(candidate, current) < 0) efficient = system;
    }
    poolFromRatios(efficient.ratios, pool, toneCount);
    tonesFromRatios(efficient.ratios, tones, seenBins);
    mergeRatioOwners(ratioOwnerMap, efficient.ratios.map(ratio => ({
      fraction: ratio.fraction,
      ratio: ratio.ratio,
      cents: ratio.cents,
      key: efficient.key,
      layers: efficient.layers,
      layerSum: efficient.layerSum,
      cardinality: efficient.cardinality,
      fundamental: efficient.fundamental,
      shard: A,
    })));
  }
  return {
    count,
    validCount,
    systemCount: groups.length,
    pool,
    toneCount,
    tones,
    ratioOwners: [...ratioOwnerMap.values()].sort((a, b) => a.cents - b.cents || a.fraction.localeCompare(b.fraction)),
  };
}

// Headless/worker-local whole-grid reducer used by the Cull2 lab. Production flight performs the
// same fold progressively in cosmos-runtime as independent shard replies arrive from its worker
// pool; this sequential helper exists so one dedicated lab worker can share the exact contract.
export function gridRatioOwnerSolve(G, { maxShards = 260, maxLayerCap = 3_000_000 } = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const shards = shardKeysOf(G);
  const maxLayer = shards.length ? shards.at(-1) : 0;
  if (shards.length > maxShards || maxLayer > maxLayerCap) {
    return { grid: G, tooLarge: true, divisorCount: shards.length + 2, ratioOwners: [], keptCount: 0, validCount: 0, tuningSystems: 0, ms: 0 };
  }
  const ratioOwnerMap = new Map();
  let keptCount = 0, validCount = 0, tuningSystems = 0;
  const divisors = divisorsFast(G);
  for (const A of shards) {
    const below = divisors.filter(d => d >= 2 && d < A);
    const result = gridShardSolve(G, A, below);
    keptCount += result.count;
    validCount += result.validCount;
    tuningSystems += result.systemCount;
    mergeRatioOwners(ratioOwnerMap, result.ratioOwners);
  }
  return {
    grid: G,
    divisorCount: shards.length + 2,
    shardCount: shards.length,
    keptCount,
    validCount,
    tuningSystems,
    ratioOwners: [...ratioOwnerMap.values()].sort((a, b) => a.cents - b.cents || a.fraction.localeCompare(b.fraction)),
    ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
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
