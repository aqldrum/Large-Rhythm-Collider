import { performance } from 'node:perf_hooks';
import { DEFAULT_GRAVITY_OPTIONS, GravitySimulation, gravityWindowWeight, massFromSize } from '../gravity-core.js';
import { divisorsFast } from '../grid-core.js';
import { approximateStarSize } from './web-travel-bloom.js';
import { hilbertDecode, hilbertEncode, SIDE } from './hilbert.js';
import { backboneHash, CELL, setPlacement, slotDirection } from './spine.js';

let pass = true;
const check = (name, ok, detail = '') => {
  pass = pass && ok;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const maxMagnitude = offsets => {
  let maximum = 0;
  for (let i = 0; i < offsets.length; i += 3) maximum = Math.max(maximum, Math.hypot(offsets[i], offsets[i + 1], offsets[i + 2]));
  return maximum;
};
const finite = values => values.every(Number.isFinite);
const advanceFor = (simulation, seconds, frame = {}, fps = 60) => {
  const frames = Math.ceil(seconds * fps);
  for (let i = 0; i < frames; i++) simulation.advance(1 / fps, frame);
};
const basicBodies = () => [
  { id: 'sun', rest: [0, 0, 0], mass: 12, pinned: true, spinAxis: [0, 1, 0], cycleTicks: 120 },
  { id: 'dust-a', rest: [440, 0, 0], size: 1.4, spinAxis: [0.2, 0.9, 0.1], cycleTicks: 180 },
  { id: 'dust-b', rest: [-520, 80, 100], size: 0.8, spinAxis: [-0.3, 0.4, 0.85], cycleTicks: 264 },
];

function createBasic(options = {}) {
  const simulation = new GravitySimulation({
    capacity: 16,
    options: {
      rampTime: 0.2,
      spinUpTime: 0.3,
      springTime: 0.45,
      windowInner: 1200,
      windowOuter: 1600,
      ...options,
    },
  });
  simulation.setBodies(basicBodies());
  return simulation;
}

function realGeometry(radius, centerGrid = 1_000_000) {
  setPlacement('hilbert');
  const centerCell = hilbertDecode(centerGrid);
  const bodies = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const x = centerCell[0] + dx, y = centerCell[1] + dy, z = centerCell[2] + dz;
        if (x < 0 || y < 0 || z < 0 || x >= SIDE || y >= SIDE || z >= SIDE) continue;
        const grid = hilbertEncode(x, y, z);
        const hash = backboneHash(grid);
        const rest = [(x - centerCell[0]) * CELL + hash[0], (y - centerCell[1]) * CELL + hash[1], (z - centerCell[2]) * CELL + hash[2]];
        const size = approximateStarSize(divisorsFast(grid).length);
        bodies.push({ id: grid, rest, size, spinAxis: slotDirection(grid), cycleTicks: Math.max(1, grid) });
      }
    }
  }
  return bodies;
}

console.log('═══ COSMOS GRAVITY CORE — behavioural assertions ═══');

console.log('\n  Determinism and invariants');
const replayA = createBasic(), replayB = createBasic();
for (let frame = 0; frame < 360; frame++) {
  const state = { held: frame < 240, center: [0, 0, 0], tick: frame / 6, ticksPerSecond: 10 };
  replayA.advance(1 / 60, state);
  replayB.advance(1 / 60, state);
}
check('identical input replays bit-for-bit', replayA.offsets.every((value, index) => value === replayB.offsets[index]));

const noMass = new GravitySimulation({ capacity: 4, options: { rampTime: 0, spinUpTime: 0, attractorCount: 4, windowInner: 1000, windowOuter: 1200 } });
noMass.setBodies([
  { id: 1, rest: [-200, 0, 0], mass: 0, spinAxis: [0, 1, 0], cycleTicks: 10 },
  { id: 2, rest: [200, 0, 0], mass: 0, spinAxis: [0, 1, 0], cycleTicks: 20 },
]);
advanceFor(noMass, 3, { held: true, center: [0, 0, 0], tick: 0 });
check('zero total mass produces no motion', maxMagnitude(noMass.offsets) === 0);
check('size-to-mass law matches the abundance proxy', Math.abs(massFromSize(2, 0.5) - Math.sqrt(15)) < 1e-12);
check('approved production ramp is the five-second default', DEFAULT_GRAVITY_OPTIONS.rampTime === 5);
check('window law is full / smooth / zero', gravityWindowWeight(100, 200, 400) === 1 &&
  Math.abs(gravityWindowWeight(300, 200, 400) - 0.5) < 1e-12 && gravityWindowWeight(500, 200, 400) === 0);

const pinned = createBasic();
advanceFor(pinned, 5, { held: true, center: [0, 0, 0], tick: 700 });
check('pinned attractor never moves', pinned.offsets[0] === 0 && pinned.offsets[1] === 0 && pinned.offsets[2] === 0 && pinned.velocities[0] === 0);

console.log('\n  Release and window handoff');
const released = createBasic();
advanceFor(released, 2, { held: true, center: [0, 0, 0], tick: 900 });
const movedBeforeRelease = maxMagnitude(released.offsets);
advanceFor(released, 2, { held: false, center: [0, 0, 0], tick: 920 });
const releaseResidual = maxMagnitude(released.offsets);
check('hold produces a visible displacement', movedBeforeRelease > 5, `${movedBeforeRelease.toFixed(3)} units`);
check('release converges below epsilon within two seconds', releaseResidual < 0.05, `${releaseResidual.toExponential(2)} units`);

let cycleResidual = 0;
for (let cycle = 0; cycle < 4; cycle++) {
  advanceFor(released, 0.8, { held: true, center: [0, 0, 0], tick: 1200 + cycle * 20 });
  advanceFor(released, 2, { held: false, center: [0, 0, 0], tick: 1210 + cycle * 20 });
  cycleResidual = Math.max(cycleResidual, maxMagnitude(released.offsets));
}
check('repeated hold/release cycles do not accumulate drift', cycleResidual < 0.05, `${cycleResidual.toExponential(2)} units`);

const outside = new GravitySimulation({ capacity: 4, options: { rampTime: 0, spinUpTime: 1, windowInner: 100, windowOuter: 200, springTime: 0.45 } });
outside.setBodies([
  { id: 'source', rest: [500, 0, 0], mass: 20, pinned: true, spinAxis: [0, 1, 0], cycleTicks: 10 },
  { id: 'target', rest: [650, 0, 0], size: 1, spinAxis: [0, 1, 0], cycleTicks: 12 },
]);
advanceFor(outside, 3, { held: true, center: [0, 0, 0], tick: 0 });
check('bodies beyond the outer window remain at rest', maxMagnitude(outside.offsets) < 1e-12);

const departed = createBasic({ rampTime: 0 });
advanceFor(departed, 1.5, { held: true, center: [0, 0, 0], tick: 100 });
advanceFor(departed, 2, { held: true, center: [5000, 0, 0], tick: 120 });
check('moving the bubble away returns bodies to rest', maxMagnitude(departed.offsets) < 0.05, `${maxMagnitude(departed.offsets).toExponential(2)} units`);

console.log('\n  Integrator sanity');
const gravity = 90000, sunMass = 14, orbitRadius = 420, softening = 60;
const softened = Math.sqrt(orbitRadius ** 2 + softening ** 2);
const circularSpeed = Math.sqrt(gravity * sunMass * orbitRadius ** 2 / (softened ** 3));
const orbit = new GravitySimulation({ capacity: 2, options: {
  fixedTimeStep: 1 / 240,
  rampTime: 0,
  spinUpTime: 0,
  strengthCeiling: gravity,
  softening,
  attractorCount: 1,
  windowInner: 2000,
  windowOuter: 2200,
} });
orbit.setBodies([
  { id: 'sun', rest: [0, 0, 0], mass: sunMass, pinned: true, spinAxis: [0, 1, 0], cycleTicks: 1 },
  { id: 'planet', rest: [orbitRadius, 0, 0], mass: 1, velocity: [0, 0, -circularSpeed], spinAxis: [0, 1, 0], cycleTicks: 1 },
]);
let minRadius = Infinity, maxRadius = 0;
for (let frame = 0; frame < 2400; frame++) {
  orbit.advance(1 / 120, { held: true, center: [0, 0, 0], tick: frame / 12 });
  const radius = Math.hypot(orbit.restPositions[3] + orbit.offsets[3], orbit.restPositions[4] + orbit.offsets[4], orbit.restPositions[5] + orbit.offsets[5]);
  minRadius = Math.min(minRadius, radius); maxRadius = Math.max(maxRadius, radius);
}
check('a circularly seeded body holds its orbital radius', (maxRadius - minRadius) / orbitRadius < 0.002, `${minRadius.toFixed(2)}–${maxRadius.toFixed(2)}`);

const pairRadius = 250, pairDistance = pairRadius * 2, pairMass = 8, pairGravity = 70000, pairSoftening = 50;
const pairAcceleration = pairGravity * pairMass * pairDistance / ((pairDistance ** 2 + pairSoftening ** 2) ** 1.5);
const pairSpeed = Math.sqrt(pairAcceleration * pairRadius);
const pair = new GravitySimulation({ capacity: 2, options: {
  fixedTimeStep: 1 / 240,
  rampTime: 0,
  spinUpTime: 0,
  strengthCeiling: pairGravity,
  softening: pairSoftening,
  attractorCount: 2,
  windowInner: 2000,
  windowOuter: 2200,
} });
pair.setBodies([
  { id: 'a', rest: [-pairRadius, 0, 0], mass: pairMass, velocity: [0, 0, pairSpeed], spinAxis: [0, 1, 0], cycleTicks: 1 },
  { id: 'b', rest: [pairRadius, 0, 0], mass: pairMass, velocity: [0, 0, -pairSpeed], spinAxis: [0, 1, 0], cycleTicks: 1 },
]);
const angular = [0, 0, 0];
pair.angularMomentum(angular);
const initialAngular = Math.hypot(...angular);
advanceFor(pair, 20, { held: true, center: [0, 0, 0], tick: 0 }, 120);
pair.angularMomentum(angular);
const angularDrift = Math.abs(Math.hypot(...angular) - initialAngular) / initialAngular;
check('angular momentum is conserved in constant-strength free flight', angularDrift < 1e-8, `${angularDrift.toExponential(2)} relative drift`);

console.log('\n  Live body set and storage');
const live = createBasic({ rampTime: 0 });
const offsetsIdentity = live.offsets, velocitiesIdentity = live.velocities, accelerationIdentity = live._accelerations;
advanceFor(live, 0.6, { held: true, center: [0, 0, 0], tick: 20 });
const before = new Map();
for (let i = 0; i < live.count; i++) before.set(live.ids[i], Array.from(live.offsets.slice(i * 3, i * 3 + 3)));
const changed = [basicBodies()[2], basicBodies()[0], { id: 'new-dust', rest: [0, 500, 0], size: 1, spinAxis: [1, 0, 0], cycleTicks: 80 }];
live.setBodies(changed);
const continuous = ['dust-b', 'sun'].every(id => {
  const index = live.ids.indexOf(id), expected = before.get(id);
  return expected.every((value, axis) => value === live.offsets[index * 3 + axis]);
});
check('adding/removing a body preserves survivors continuously', continuous);
check('typed-array identities remain stable', live.offsets === offsetsIdentity && live.velocities === velocitiesIdentity && live._accelerations === accelerationIdentity);

console.log('\n  Dense real-geometry fixture');
const denseBodies = realGeometry(6);
const dense = new GravitySimulation({ capacity: 1024 });
dense.setBodies(denseBodies);
const start = performance.now();
advanceFor(dense, 30, { held: true, center: [0, 0, 0], tick: 3_600_000, ticksPerSecond: 10 });
const elapsed = performance.now() - start;
check('radius-six fixture contains the expected dense neighbourhood', denseBodies.length >= 850, `${denseBodies.length} bodies`);
check('dense maximum-length hold stays finite and bounded', finite(dense.offsets) && finite(dense.velocities) && dense.stats.largestOffset <= dense.options.maxOffset, `${dense.stats.largestOffset.toFixed(2)} max offset`);
check('tuned dense hold does not touch emergency clamps', dense.stats.clampEngagements === 0, `${dense.stats.clampEngagements} engagements`);
console.log(`  · dense fixture runtime: ${elapsed.toFixed(1)} ms for 30 simulated seconds`);

if (!pass) process.exit(1);
console.log('\nAll gravity-core assertions passed.');
