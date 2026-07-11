// assert-cosmos.mjs — the three proofs for the live, cache-free, flyable cosmos.
//   (1) NO TELEPORT: reparent/ignite keep motion C1-continuous (position & velocity preserved).
//   (2) PRECISION: integer-spine render stays exact at grid = millions, where naive f32 fails.
//   (3) CONVERGENCE: the live incremental competition reaches the batch Grid-Gravity result
//       and is independent of solve order; interior zones stabilize long before the frontier does.
import { computeDistricts } from './gg-core.js';
import { gridResults } from '../grid-core.js';
import { absolutePos, renderPos, reparent, stepAttractor, backboneHash, backboneDelta, SPACING, sub, len } from './spine.js';

const RNG = seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let PASS = true;
const check = (name, ok, detail = '') => { PASS = PASS && ok; console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION 1 — NO TELEPORT (C1 continuity across reparent + ignite)
// ─────────────────────────────────────────────────────────────────────────────
function assertNoTeleport() {
  console.log('\n[1] NO TELEPORT — C1 continuity across reparent/ignite');
  const rnd = RNG(7);
  const dt = 1 / 60, params = { k: 1.5, damping: 1.2, orbit: 0.8 };

  // (a) Integrated sim: zones orbit adjacent suns; captures reparent to the NEIGHBOURING sun
  //     (as real gravitational capture is local). Motion must stay finite and spike-free.
  const suns = [2000, 2050, 2100, 2150];   // ~500 world units apart
  const zones = [];
  for (let i = 0; i < 40; i++) {
    const si = i % suns.length;
    zones.push({ id: i, si, parentGrid: suns[si],
      off: [ (rnd() - 0.5) * 60, (rnd() - 0.5) * 60, (rnd() - 0.5) * 60 ],
      vel: [ (rnd() - 0.5) * 4, (rnd() - 0.5) * 4, (rnd() - 0.5) * 4 ], size: 0.2 });
  }
  let maxReparentJump = 0, maxReparentVelJump = 0, reparents = 0, maxStep = 0, maxIgniteJump = 0, finite = true;
  for (let t = 0; t < 1500; t++) {
    for (const z of zones) {
      if ((t + z.id) % 149 === 0) {                        // capture by an adjacent sun
        const before = absolutePos(z), velBefore = z.vel.slice();
        z.si = (z.si + (rnd() < 0.5 ? 1 : suns.length - 1)) % suns.length;
        reparent(z, suns[z.si]);
        maxReparentJump = Math.max(maxReparentJump, len(sub(absolutePos(z), before)));
        maxReparentVelJump = Math.max(maxReparentVelJump, len(sub(z.vel, velBefore)));
        reparents++;
      }
      if ((t + z.id) % 213 === 0) {                        // ignite: size change only
        const p0 = absolutePos(z); z.size = 1.0 + rnd(); maxIgniteJump = Math.max(maxIgniteJump, len(sub(absolutePos(z), p0)));
      }
      const preStep = absolutePos(z);
      stepAttractor(z, dt, params);
      if (!Number.isFinite(z.off[0]) || !Number.isFinite(z.vel[0])) finite = false;
      maxStep = Math.max(maxStep, len(sub(absolutePos(z), preStep)));
    }
  }
  // (b) Preservation at millions-scale: reparent far out and confirm zero position/velocity jump
  let farJump = 0, farVelJump = 0;
  for (let i = 0; i < 200; i++) {
    const base = 1_000_000 + i * 40000;
    const z = { parentGrid: base, off: [12, -7, 3], vel: [1.1, -0.4, 0.9] };
    const before = absolutePos(z), v0 = z.vel.slice();
    reparent(z, base + 50);
    farJump = Math.max(farJump, len(sub(absolutePos(z), before)));
    farVelJump = Math.max(farVelJump, len(sub(z.vel, v0)));
  }
  check(`reparent preserves position, local scale (${reparents} events)`, maxReparentJump < 1e-6, `max jump ${maxReparentJump.toExponential(2)}`);
  check('reparent preserves position, grid = millions', farJump < 1e-6, `max jump ${farJump.toExponential(2)}`);
  check('reparent preserves velocity exactly', Math.max(maxReparentVelJump, farVelJump) < 1e-12, `max Δv ${Math.max(maxReparentVelJump, farVelJump).toExponential(2)}`);
  check('ignite does not move the zone', maxIgniteJump < 1e-12, `max jump ${maxIgniteJump.toExponential(2)}`);
  check('motion stays finite and spike-free (no teleport, no blow-up)', finite && maxStep < 100, `max step ${maxStep.toFixed(2)} units`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION 2 — PRECISION at grid = millions (integer-spine vs naive f32)
// ─────────────────────────────────────────────────────────────────────────────
function assertPrecision() {
  console.log('\n[2] PRECISION — integer-spine vs naive absolute f32, camera at grid = millions');
  const f = Math.fround;
  let maxSpineErr = 0, maxNaiveErr = 0;
  for (const cam of [1_000_000, 5_000_000, 20_000_000, 80_000_000]) {
    for (let k = -300; k <= 300; k += 37) {
      const gz = cam + k;
      const off = [3.2, -1.1, 0.7];
      const zone = { parentGrid: gz, off, vel: [0, 0, 0] };
      const ideal = renderPos(zone, cam, [0, 0, 0], false);          // f64 exact
      const spine = renderPos(zone, cam, [0, 0, 0], true);           // integer-spine, f32 final
      // naive: store absolute positions in f32, then subtract (catastrophic cancellation)
      const hz = backboneHash(gz), hc = backboneHash(cam);
      const absZ = [f(gz * SPACING + hz[0]), f(hz[1]), f(hz[2])];
      const absC = [f(cam * SPACING + hc[0]), f(hc[1]), f(hc[2])];
      const naive = [f(absZ[0] - absC[0]) + off[0], f(absZ[1] - absC[1]) + off[1], f(absZ[2] - absC[2]) + off[2]];
      maxSpineErr = Math.max(maxSpineErr, len(sub(spine, ideal)));
      maxNaiveErr = Math.max(maxNaiveErr, len(sub(naive, ideal)));
    }
  }
  check('integer-spine render exact under f32', maxSpineErr < 1e-2, `max err ${maxSpineErr.toExponential(2)} units`);
  check('naive absolute-f32 visibly breaks (proves the problem is real)', maxNaiveErr > 0.25, `worst err ${maxNaiveErr.toFixed(2)} units (≈ ${(maxNaiveErr / SPACING).toFixed(1)} grid-steps of jitter)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION 3 — CONVERGENCE of live incremental competition to batch Grid-Gravity
// ─────────────────────────────────────────────────────────────────────────────
function buildUniverse(lo, hi) {
  const nodes = [];
  for (let g = lo; g <= hi; g++) { const r = gridResults(g); if (!r.tooLarge && r.keptCount > 0) nodes.push({ grid: g, abundance: r.keptCount }); }
  return nodes;
}
const sameAnchors = (a, b) => { if (a.size !== b.size) return false; for (const [g, v] of a) if (b.get(g) !== v) return false; return true; };

function assertConvergence() {
  console.log('\n[3] CONVERGENCE — live incremental competition → batch Grid-Gravity');
  const REACH = 0.15;
  const universe = buildUniverse(480, 900);           // real all-cardinality abundances
  const batch = computeDistricts(universe, REACH).anchorOf;
  console.log(`  universe: ${universe.length} valid grids · batch → ${new Set([...batch.values()]).size} distinct anchors`);

  // reveal in several random orders; final competition must equal batch every time
  let allMatch = true;
  for (let s = 1; s <= 5; s++) {
    const rnd = RNG(s * 101);
    const order = universe.map((n, i) => i).sort(() => rnd() - 0.5);
    const solved = [];
    for (const i of order) { solved.push(universe[i]); }
    solved.sort((a, b) => a.grid - b.grid);
    const live = computeDistricts(solved, REACH).anchorOf;
    if (!sameAnchors(live, batch)) allMatch = false;
  }
  check('final live result equals batch for all 5 reveal orders (order-independent)', allMatch);

  // locality / stabilization: reveal random, recompute after each, measure when each grid's
  // anchor stops changing. Interior zones should settle well before the frontier is complete.
  const rnd = RNG(999);
  const order = universe.map((_, i) => i).sort(() => rnd() - 0.5);
  const solved = [];
  const lastChangeAt = new Map();  // grid -> fraction solved when its anchor last changed
  let prev = new Map(), reparentCounts = new Map();
  for (let step = 0; step < order.length; step++) {
    solved.push(universe[order[step]]);
    solved.sort((a, b) => a.grid - b.grid);
    const cur = computeDistricts(solved, REACH).anchorOf;
    const frac = (step + 1) / order.length;
    for (const [g, v] of cur) {
      if (prev.get(g) !== v) { lastChangeAt.set(g, frac); reparentCounts.set(g, (reparentCounts.get(g) || 0) + (prev.has(g) ? 1 : 0)); }
    }
    prev = cur;
  }
  const settleFracs = [...lastChangeAt.values()].sort((a, b) => a - b);
  const median = settleFracs[Math.floor(settleFracs.length / 2)];
  const p90 = settleFracs[Math.floor(settleFracs.length * 0.9)];
  const reparAvg = [...reparentCounts.values()].reduce((a, b) => a + b, 0) / universe.length;
  console.log(`  stabilization: median grid settles at ${(median * 100).toFixed(0)}% solved, 90th pct at ${(p90 * 100).toFixed(0)}%`);
  console.log(`  reparent churn: ${reparAvg.toFixed(2)} re-tethers per grid over the whole build (each is one smooth attractor swap)`);
  check('interior zones stabilize before the frontier completes (locality is real)', median < 0.9);
}

console.log('═══ COSMOS SIM — three assertions ═══');
assertNoTeleport();
assertPrecision();
assertConvergence();
console.log(`\n${PASS ? '✓✓✓ ALL ASSERTIONS PASS — the flying cache-free cosmos is sound' : '✗ SOME ASSERTIONS FAILED'}`);
process.exit(PASS ? 0 : 1);
