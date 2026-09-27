// assert-shard.mjs — proofs for the DISTRIBUTED (sharded) solve path.
//  (1) CORRECT: the live sharded runtime assembles each grid's exact whole-grid keptCount.
//  (2) PROGRESSIVE: a zone's partial abundance is monotone and lands on the final value.
//  (3) NON-BLOCKING: cheap (single-shard) zones finish before a hyper-shard grid — no head-of-line stall.
//  (4) DETERMINISTIC + CORRECT-VS-GG: same park → identical cosmos; parents == batch Grid-Gravity.
import { Cosmos } from '../engine/cosmos-runtime.js';
import { computeDistricts } from '../engine/gg-core.js';
import { gridResults, shardKeysOf, gridShardSolve, gridShardSystems, gridShardCount, divisorsFast, mergeRatioOwners, REAL_RHYTHM_MAX_RANGE } from '../engine/grid-core.js';
import { absolutePos } from '../engine/spine.js';

let PASS = true;
const check = (n, ok, d = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const factor = n => { let m = n, p = 0; for (let d = 2; d * d <= m; d++) if (m % d === 0) { while (m % d === 0) m /= d; p++; } if (m > 1) p++; return p; };
const isValid = g => factor(g) >= 2;
const whole = g => { const r = gridResults(g); return r.tooLarge ? 1 : r.keptCount; };

// worker logic, run synchronously as the injected dispatch (models the real Web Worker pool)
const MAX_SHARDS = 260;
function dispatch(p) {
  if (p.op === 'plan') { const k = shardKeysOf(p.grid); return Promise.resolve(k.length > MAX_SHARDS ? { tooLarge: true } : { shards: k }); }
  const below = divisorsFast(p.grid).filter(x => x >= 2 && x < p.A);
  const { count, ratioOwners } = gridShardSolve(p.grid, p.A, below);
  return Promise.resolve({ count, ratioOwners });
}
const flush = () => new Promise(r => setTimeout(r, 0));   // drain the microtask queue between ticks
let LOG = null;                                            // when set, records the grid of each dispatch
const logged = p => { if (LOG && p.op === 'shard') LOG.push(p.grid); return dispatch(p); };
const newCosmos = () => new Cosmos({ reachScale: 0.15, spawnRadius: 22, evictRadius: 34, poolSize: 4, isValid, dispatch: logged });

console.log('═══ DISTRIBUTED SOLVE — shard assertions ═══');

// drive a parked camera to completion (+ settle so the final GG competition runs), recording
// per-grid solved-tick and partial monotonicity.
async function settle(cos, cam = 800, maxTicks = 2500) {
  cos.setCamera(cam);
  const solvedAt = new Map(); const prevPartial = new Map(); let monoOk = true;
  for (let t = 0; t < maxTicks; t++) {
    cos.tick(1 / 60); await flush();
    for (const z of cos.zones.values()) {
      const pp = prevPartial.get(z.grid) ?? 0, cur = z.partial ?? 0;
      if (cur < pp) monoOk = false; prevPartial.set(z.grid, cur);
      if (z.state === 'solved' && !solvedAt.has(z.grid)) solvedAt.set(z.grid, t);
    }
    const st = cos.stats(); if (st.solved === st.total && st.total > 0) { for (let k = 0; k < 4; k++) { cos.tick(1 / 60); await flush(); } break; }
  }
  return { solvedAt, monoOk };
}

console.log('\n[1..3] Parked at grid 800 — solve the whole window via shards');
const c = newCosmos();
LOG = [];
const { solvedAt, monoOk } = await settle(c);
const dlog = LOG; LOG = null;
const st = c.stats();
console.log(`  window: ${st.total} zones, all solved: ${st.solved === st.total}`);

// (1) correct: every zone's assembled abundance equals the whole-grid keptCount
let abErr = 0, worst = null;
for (const z of c.zones.values()) { if (z.state !== 'solved') continue; const w = whole(z.grid); if (z.abundance !== w) { abErr++; if (!worst) worst = { grid: z.grid, got: z.abundance, want: w }; } }
check('sharded live abundance equals whole-grid keptCount for every zone', abErr === 0, worst ? `e.g. grid ${worst.grid}: ${worst.got} vs ${worst.want}` : `${c.stats().solved} zones`);

// Ratio owners use the same two-stage reduction as the browser worker/runtime: local minimum in each
// shard, then global minimum as replies arrive (arrival order must not matter).
let ownerErr = 0, ownerMissing = 0;
for (const z of c.zones.values()) {
  if (z.state !== 'solved') continue;
  const expected = new Map();
  for (const A of shardKeysOf(z.grid)) mergeRatioOwners(expected, gridShardSolve(z.grid, A).ratioOwners);
  const actual = new Map((z.ratioOwners || []).map(owner => [owner.fraction, owner]));
  if (actual.size !== expected.size) ownerMissing++;
  for (const [fraction, owner] of expected) {
    const got = actual.get(fraction);
    if (!got || got.key !== owner.key || got.layerSum !== owner.layerSum) ownerErr++;
  }
}
check('shard replies reduce to the exact global lowest-layer-sum owner for every ratio',
  ownerErr === 0 && ownerMissing === 0, `${ownerErr} wrong owners · ${ownerMissing} grids with missing ratios`);

// (2) progressive: partial abundance only ever grew
check('partial abundance is monotone (progressive bloom-in, never regresses)', monoOk);

// (3) non-blocking: the biggest-shard grid's bites are INTERLEAVED with other grids, not packed
// consecutively — so a worker never sits on one monster while cheap zones wait.
let maxShards = 0, monster = null;
for (const z of c.zones.values()) { const n = shardKeysOf(z.grid).length; if (n > maxShards) { maxShards = n; monster = z.grid; } }
const idx = dlog.map((g, i) => g === monster ? i : -1).filter(i => i >= 0);
const first = idx[0], lastI = idx[idx.length - 1], others = (lastI - first) - (idx.length - 1);
console.log(`  monster grid ${monster} (${maxShards} shards): ${others} other-grid dispatches interleaved between its first & last bite`);
check('hyper-shard grid is interleaved (its bites are spread, not head-of-line)', others >= maxShards, `${others} interleaved ≥ ${maxShards} shards`);

// (4) correct vs batch Grid-Gravity + deterministic
const loaded = [...c.zones.values()].filter(z => z.state === 'solved').map(z => ({ grid: z.grid, abundance: z.abundance })).sort((a, b) => a.grid - b.grid);
const batch = computeDistricts(loaded, c.reachScale).anchorOf;
let mism = 0;
for (const z of c.zones.values()) { if (z.state !== 'solved') continue; const a = batch.get(z.grid); const exp = (a != null && c.zones.has(a)) ? a : z.grid; if (z.parentGrid !== exp) mism++; }
check('runtime parents equal batch Grid-Gravity over the sharded window', mism === 0, `${mism} mismatches`);

console.log('\n[4] Determinism — identical parked solve twice');
const fp = cos => [...cos.zones.values()].filter(z => z.state === 'solved').sort((a, b) => a.grid - b.grid).map(z => { const p = absolutePos(z); return `${z.grid}:${z.abundance}:${z.parentGrid}:${p.map(v => v.toFixed(2)).join(',')}`; }).join('|');
const a = newCosmos(); await settle(a, 640); const b = newCosmos(); await settle(b, 640);
check('same parked window → identical assembled cosmos', fp(a) === fp(b), `${a.stats().solved} zones`);

// (5) error resilience — a worker that returns {error} (or throws) must NOT stall the pool: the zone
// finishes on a fallback and the window still fully solves. This is the "12 solving, 0 finishing" bug.
console.log('\n[5] Error resilience — worker errors never stall the pool');
const flaky = p => (p.grid % 7 === 0)                         // ~1/7 of grids "crash" in the worker
  ? Promise.resolve({ error: `simulated crash ${p.op} ${p.grid}` })
  : dispatch(p);
const errCosmos = new Cosmos({ reachScale: 0.15, spawnRadius: 18, evictRadius: 30, poolSize: 4, isValid, dispatch: flaky });
errCosmos.setCamera(600);
for (let t = 0; t < 3000; t++) { errCosmos.tick(1 / 60); await flush(); const s = errCosmos.stats(); if (s.total > 0 && s.solved === s.total) break; }
const es = errCosmos.stats();
check('every zone still reaches solved despite ~1/7 worker errors (no stall)', es.total > 0 && es.solved === es.total, `${es.solved}/${es.total} solved, ${errCosmos.events.errors} errors logged`);

// (6) monster audio-data gate — a pre-identified monster must not dispatch any owner-producing shard
// until the explicit forceSolve() opt-in. After force, it uses the ordinary shard path and lands with
// finalized ratio owners. The future audio compiler should key exclusively off that finalized state.
console.log('\n[6] Monster ratio-owner gate');
const gatedGrid = 60;
let forced = false, shardBeforeForce = 0;
const gatedDispatch = p => {
  if (p.op === 'plan' && !p.force) return Promise.resolve({ monster: true, divisors: 12, cost: 2e9 });
  if (p.op === 'plan') { forced = true; return Promise.resolve({ shards: shardKeysOf(p.grid), divisors: 12 }); }
  if (!forced) shardBeforeForce++;
  const { count, ratioOwners } = gridShardSolve(p.grid, p.A);
  return Promise.resolve({ count, ratioOwners });
};
const gated = new Cosmos({ poolSize: 2, isValid: () => true, dispatch: gatedDispatch,
  neighbors: () => [gatedGrid], cellDist: () => 0, puffs: false, compete: false });
gated.setCamera(gatedGrid);
for (let t = 0; t < 8; t++) { gated.tick(1 / 60); await flush(); }
const gatedZone = gated.zones.get(gatedGrid);
check('monster plan emits no ratio owners or shard work before Solve anyway',
  gatedZone?.monster === true && gatedZone.ratioOwners == null && shardBeforeForce === 0);
gated.forceSolve(gatedGrid);
const forcedGeneration = gatedZone.solveGeneration;
for (let t = 0; t < 500; t++) {
  gated.tick(1 / 60); await flush();
  if (gatedZone.state === 'solved' && !gatedZone.monster) break;
}
check('forceSolve clears the gate and finalizes ratio owners through normal shards',
  gatedZone.state === 'solved' && gatedZone.force === true && gatedZone.ratioOwners?.length > 0 && gatedZone.shardsDone === gatedZone.shardsTotal,
  `${gatedZone.ratioOwners?.length || 0} ratio owners`);
check('forceSolve advances the zone generation used to reject stale shard/audio work', forcedGeneration > 0 && gatedZone.solveGeneration === forcedGeneration,
  `generation ${forcedGeneration}`);

// (7) a heavy-worker timeout is an observed safety failure, not a zero-count shard. The runtime must
// return the zone to the explicit monster gate and discard every progressive payload already received.
console.log('\n[7] Heavy timeout returns the grid to the monster gate');
const timeoutGrid = 8_081_605;
const timeoutDispatch = p => {
  if (p.op === 'plan') return Promise.resolve({ shards: [10, 1_616_321], divisors: 16, cost: 1_017_981_470, maxLayer: 1_616_321 });
  if (p.A === 10) return Promise.resolve({ count: 2, ratioOwners: [{ fraction: '1/1', cents: 0, key: '10.3', layers: [10, 3], layerSum: 13 }] });
  return Promise.resolve({ error: 'simulated heavy timeout', timedOut: true, heavy: true });
};
const timed = new Cosmos({ poolSize: 2, isValid: () => true, dispatch: timeoutDispatch,
  neighbors: () => [timeoutGrid], cellDist: () => 0, puffs: false, compete: false });
timed.setCamera(timeoutGrid);
for (let t = 0; t < 20; t++) { timed.tick(1 / 60); await flush(); }
const timedZone = timed.zones.get(timeoutGrid);
check('timed-out deep work becomes a gated monster instead of a false solved count',
  timedZone?.monster === true && timedZone.state === 'solved' && timedZone.abundance === 0 && timed.events.timeouts === 1);
check('partial shard and audio ownership state is discarded on timeout',
  timedZone?.plan == null && timedZone?.ratioOwners == null && timedZone?.shardsTotal === 0 && timedZone?.partial === 0);

// [8] Owner re-sort COALESCING (perf). The sorted z.ratioOwners is rebuilt once per FRAME (in tick), not on
// every shard reply — a large grid's shards reply in bursts between frames, and the old code paid a full
// O(owners·log owners) re-sort on each reply. Correctness is already proven above ([1..3] owner assembly);
// this proves the coalescing: a whole burst of one grid's replies landing in a single drain costs ONE sort.
console.log('\n[8] Owner re-sort coalesces a burst of shard replies into one sort per frame');
const burstGrid = 840;
const burstKeys = shardKeysOf(burstGrid);
const heldResolvers = [];
const burstDispatch = p => {
  if (p.op === 'plan') return Promise.resolve({ shards: burstKeys });
  const below = divisorsFast(p.grid).filter(x => x >= 2 && x < p.A);
  return new Promise(res => heldResolvers.push(() => res(gridShardSolve(p.grid, p.A, below))));   // defer every shard reply
};
const burst = new Cosmos({ poolSize: burstKeys.length, isValid: () => true, dispatch: burstDispatch,
  neighbors: () => [burstGrid], cellDist: () => 0, puffs: false, compete: false });
burst.setCamera(burstGrid);
// Tick until the plan lands and every shard is dispatched-but-unresolved (all held, so no flush yet).
for (let t = 0; t < burstKeys.length + 4 && heldResolvers.length < burstKeys.length; t++) { burst.tick(1 / 60); await flush(); }
const heldCount = heldResolvers.length, flushesBefore = burst.events.ownerFlushes;
for (const r of heldResolvers) r();                 // release the whole burst at once
await flush();                                      // every reply merges into the owner map in one drain
burst.tick(1 / 60); await flush();                  // …then exactly one coalesced re-sort happens here
check('a burst of many one-grid shard replies costs a single owner re-sort, not one per reply',
  heldCount >= 3 && (burst.events.ownerFlushes - flushesBefore) === 1 && burst.zones.get(burstGrid)?.ratioOwners?.length > 0,
  `${heldCount} replies in one drain → ${burst.events.ownerFlushes - flushesBefore} sort`);
// The coalesced array is still fully assembled + sorted by (cents, fraction).
const burstOwners = burst.zones.get(burstGrid).ratioOwners;
check('the coalesced owner array is complete and sorted by cents then fraction',
  burstOwners.every((o, i) => i === 0 || o.cents > burstOwners[i - 1].cents ||
    (o.cents === burstOwners[i - 1].cents && o.fraction.localeCompare(burstOwners[i - 1].fraction) >= 0)),
  `${burstOwners.length} owners`);

// [9] Sky-tone merge (B). _skyToneBins is a Map<bin,tone> now, so a cross-shard bin collision is an O(1)
// lookup instead of a linear z.skyTones.find (which had grown to ~O(tones²) over a large grid). Content must
// be identical: one tone per 0.5¢ bin, first-seen kept, sourceFractions unioned across colliding shards.
console.log('\n[9] Sky-tone bin dedup preserves cross-shard content (O(1) merge)');
const toneGrid = 840;
const toneKeys = shardKeysOf(toneGrid);
const tonesByA = new Map([
  [toneKeys[0], [{ c: 100.0, f: '9/8', sourceFractions: ['9/8'] }, { c: 386.0, f: '5/4', sourceFractions: ['5/4'] }]],
  [toneKeys[1], [{ c: 100.2, f: '8/7', sourceFractions: ['8/7'] }, { c: 702.0, f: '3/2', sourceFractions: ['3/2'] }]],  // 100.2 shares bin 200 with 100.0
]);
const toneDispatch = p => {
  if (p.op === 'plan') return Promise.resolve({ shards: toneKeys });
  return Promise.resolve({ count: 1, ratioOwners: [], tones: tonesByA.get(p.A) || [] });
};
const toneCos = new Cosmos({ poolSize: 8, isValid: () => true, dispatch: toneDispatch,
  neighbors: () => [toneGrid], cellDist: () => 0, puffs: false, compete: false });
toneCos.setCamera(toneGrid);
for (let t = 0; t < toneKeys.length + 8; t++) { toneCos.tick(1 / 60); await flush(); if (toneCos.zones.get(toneGrid)?.state === 'solved') break; }
const toneZone = toneCos.zones.get(toneGrid);
const bin = c => Math.round(c / 0.5);
const collided = (toneZone.skyTones || []).filter(t => bin(t.c) === bin(100));   // 100.0 / 100.2 both fold to bin 200
const distinctBins = new Set((toneZone.skyTones || []).map(t => bin(t.c)));
check('a cross-shard 0.5¢ bin collision keeps one tone and unions its sourceFractions (order-independent)',
  toneZone?.skyTones?.length === 3 && collided.length === 1 &&
  [...new Set(collided[0].sourceFractions)].sort().join(',') === '8/7,9/8' &&
  distinctBins.has(bin(386)) && distinctBins.has(bin(702)),
  `${toneZone?.skyTones?.length} tones, collided sf=${collided[0]?.sourceFractions}`);

// ── [10] DEFINITIONAL RANGE CULL (flight-only; the lab/codex-math default path must stay byte-identical) ──
// range = fastest layer ÷ slowest. The flight worker passes REAL_RHYTHM_MAX_RANGE so degenerate systems
// (e.g. 443549:2) never reach the card count, star size, or bloom; every other caller omits it → Infinity.
console.log('\n[10] Definitional range cull (flight opt-in, lab default byte-safe)');
const rBelow = (G, A) => divisorsFast(G).filter(d => d >= 2 && d < A);
const rAbund = (G, mr) => shardKeysOf(G).reduce((s, A) => s + gridShardCount(G, A, rBelow(G, A), mr), 0);
const rSystems = (G, mr) => shardKeysOf(G).flatMap(A => gridShardSystems(G, A, rBelow(G, A), mr));
// default (no maxRange) is exactly the uncapped Infinity path — the corpus is untouched
check('gridShardCount default arg == explicit Infinity (lab/math path unchanged)',
  rAbund(887098, undefined) === rAbund(887098, Infinity) && rAbund(2640, undefined) === rAbund(2640, Infinity));
// 887,098 = 2·139·3191: keeps 3191:278 (r 11.5) and 6382:139 (r 45.9); drops 443549:2 and 3191:139:2
const uncapped = rSystems(887098, Infinity), capped = rSystems(887098, REAL_RHYTHM_MAX_RANGE);
const rangeOf = ly => Math.max(...ly) / Math.min(...ly);
check('a degenerate system (443549:2, range 221k) is present uncapped',
  uncapped.some(s => s.layers.includes(443549)) && rangeOf([443549, 2]) > REAL_RHYTHM_MAX_RANGE);
check('...and is dropped once the flight range cap applies', !capped.some(s => s.layers.includes(443549)));
check('every capped system is within range, every dropped one is over it',
  capped.every(s => rangeOf(s.layers) <= REAL_RHYTHM_MAX_RANGE)
  && uncapped.filter(u => !capped.some(c => c.layers.join() === u.layers.join())).every(d => rangeOf(d.layers) > REAL_RHYTHM_MAX_RANGE));
check('the cap lowers a degenerate grid\'s kept count but not a rich smooth grid\'s',
  rAbund(887098, REAL_RHYTHM_MAX_RANGE) < rAbund(887098, Infinity)
  && rAbund(2640, REAL_RHYTHM_MAX_RANGE) === rAbund(2640, Infinity),
  `887098 ${rAbund(887098, Infinity)}→${rAbund(887098, REAL_RHYTHM_MAX_RANGE)} · 2640 ${rAbund(2640, Infinity)}=${rAbund(2640, REAL_RHYTHM_MAX_RANGE)}`);
// the prune is EXACT: capped count == manually range-filtering the uncapped per-shard groups
const exact = shardKeysOf(887098).every(A => {
  const full = gridShardSolve(887098, A, rBelow(887098, A), Infinity);
  const cap = gridShardSolve(887098, A, rBelow(887098, A), REAL_RHYTHM_MAX_RANGE);
  return cap.systemCount === gridShardSystems(887098, A, rBelow(887098, A), Infinity).filter(s => rangeOf(s.layers) <= REAL_RHYTHM_MAX_RANGE).length;
});
check('the below-layer prune is exact (no in-range system lost, none extra kept)', exact);
// keep-two made visible: bloom node count (gridShardSystems) == keptCount (gridShardSolve) at every grid,
// so the card's "N kept" always matches the cloud. A paired scale contributes its two distinct rhythms.
const nodeCountEqualsKept = [30, 60, 120, 2640, 887098].every(G => {
  for (const mr of [Infinity, REAL_RHYTHM_MAX_RANGE]) {
    const kept = shardKeysOf(G).reduce((s, A) => s + gridShardSolve(G, A, rBelow(G, A), mr).count, 0);
    const nodes = shardKeysOf(G).reduce((s, A) => s + gridShardSystems(G, A, rBelow(G, A), mr).length, 0);
    if (kept !== nodes) return false;
  }
  return true;
});
check('bloom node count == keptCount (keep-two paired scales emit both rhythms)', nodeCountEqualsKept);
check('a paired scale emits two nodes with distinct keys but the same ratioSet',
  (() => { const g120 = shardKeysOf(120).flatMap(A => gridShardSystems(120, A)); const paired = g120.filter(s => s.dense);
    // for a dense node there must be a sibling sharing rs but differing in key
    return paired.length > 0 && paired.every(s => g120.some(o => o !== s && o.rs === s.rs && o.key !== s.key)); })());

console.log(`\n${PASS ? '✓✓✓ DISTRIBUTED SOLVE PASSES — sharded, progressive, non-blocking, exact' : '✗ DISTRIBUTED SOLVE FAILED'}`);
process.exit(PASS ? 0 : 1);
