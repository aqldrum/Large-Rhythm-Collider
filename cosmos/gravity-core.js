// gravity-core.js — deterministic, allocation-stable local gravity for Cosmos.
//
// The simulation knows nothing about grids, rendering, audio, or wall time. Callers provide
// resting positions, mass/size, spin axes, cycle lengths, and the current transport tick.

export const DEFAULT_GRAVITY_OPTIONS = Object.freeze({
  fixedTimeStep: 1 / 120,
  maxFrameTime: 0.1,
  maxSubSteps: 24,
  strengthCeiling: 2000000,
  rampTime: 5,
  releaseTime: 0.35,
  spinUpTime: 1,
  softening: 110,
  massExponent: 0.32,
  attractorCount: 24,
  pointerBlend: 0.22,
  axisMode: 'per-star',
  sharedSpinAxis: Object.freeze([0, 1, 0]),
  windowInner: 1360,
  windowOuter: 2040,
  springTime: 0.65,
  maxSpeed: 3000,
  maxOffset: 6800,
});

const EPSILON = 1e-9;
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smoothstep = value => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export function gravityWindowWeight(distance, inner = DEFAULT_GRAVITY_OPTIONS.windowInner, outer = DEFAULT_GRAVITY_OPTIONS.windowOuter) {
  const safeInner = Math.max(0, Number(inner) || 0);
  const safeOuter = Math.max(safeInner + EPSILON, Number(outer) || 0);
  const safeDistance = Math.max(0, Number(distance) || 0);
  if (safeDistance <= safeInner) return 1;
  if (safeDistance >= safeOuter) return 0;
  return 1 - smoothstep((safeDistance - safeInner) / (safeOuter - safeInner));
}

export function massFromSize(size, exponent = DEFAULT_GRAVITY_OPTIONS.massExponent) {
  const safeSize = Math.max(0, Number(size) || 0);
  const abundanceLike = Math.max(0, 2 ** (2 * safeSize) - 1);
  return abundanceLike > 0 ? abundanceLike ** Math.max(0, exponent) : 0;
}

function normalized3(input, fallbackX, fallbackY, fallbackZ) {
  const x = Number(input?.[0]), y = Number(input?.[1]), z = Number(input?.[2]);
  const length = Math.hypot(x, y, z);
  return length > EPSILON && Number.isFinite(length)
    ? [x / length, y / length, z / length]
    : [fallbackX, fallbackY, fallbackZ];
}

function optionNumber(value, fallback, minimum = -Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function makeOptions(options = {}) {
  const merged = { ...DEFAULT_GRAVITY_OPTIONS, ...options };
  merged.fixedTimeStep = optionNumber(merged.fixedTimeStep, DEFAULT_GRAVITY_OPTIONS.fixedTimeStep, 1 / 1000);
  merged.maxFrameTime = optionNumber(merged.maxFrameTime, DEFAULT_GRAVITY_OPTIONS.maxFrameTime, merged.fixedTimeStep);
  merged.maxSubSteps = Math.max(1, Math.floor(optionNumber(merged.maxSubSteps, DEFAULT_GRAVITY_OPTIONS.maxSubSteps, 1)));
  merged.strengthCeiling = optionNumber(merged.strengthCeiling, DEFAULT_GRAVITY_OPTIONS.strengthCeiling, 0);
  merged.rampTime = optionNumber(merged.rampTime, DEFAULT_GRAVITY_OPTIONS.rampTime, 0);
  merged.releaseTime = optionNumber(merged.releaseTime, DEFAULT_GRAVITY_OPTIONS.releaseTime, 0.01);
  merged.spinUpTime = optionNumber(merged.spinUpTime, DEFAULT_GRAVITY_OPTIONS.spinUpTime, 0);
  merged.softening = optionNumber(merged.softening, DEFAULT_GRAVITY_OPTIONS.softening, 0.001);
  merged.massExponent = optionNumber(merged.massExponent, DEFAULT_GRAVITY_OPTIONS.massExponent, 0);
  merged.attractorCount = Math.max(0, Math.floor(optionNumber(merged.attractorCount, DEFAULT_GRAVITY_OPTIONS.attractorCount, 0)));
  merged.pointerBlend = clamp(optionNumber(merged.pointerBlend, DEFAULT_GRAVITY_OPTIONS.pointerBlend), 0, 1);
  merged.axisMode = merged.axisMode === 'shared' ? 'shared' : 'per-star';
  merged.sharedSpinAxis = normalized3(merged.sharedSpinAxis, 0, 1, 0);
  merged.windowInner = optionNumber(merged.windowInner, DEFAULT_GRAVITY_OPTIONS.windowInner, 0);
  merged.windowOuter = Math.max(merged.windowInner + 0.001, optionNumber(merged.windowOuter, DEFAULT_GRAVITY_OPTIONS.windowOuter, 0.001));
  merged.springTime = optionNumber(merged.springTime, DEFAULT_GRAVITY_OPTIONS.springTime, 0.02);
  merged.maxSpeed = optionNumber(merged.maxSpeed, DEFAULT_GRAVITY_OPTIONS.maxSpeed, 0.001);
  merged.maxOffset = optionNumber(merged.maxOffset, DEFAULT_GRAVITY_OPTIONS.maxOffset, 0.001);
  return merged;
}

export class GravitySimulation {
  constructor({ capacity = 1024, options = {} } = {}) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.options = makeOptions(options);
    this.count = 0;
    this.ids = new Array(this.capacity).fill(null);
    this.offsets = new Float64Array(this.capacity * 3);
    this.velocities = new Float64Array(this.capacity * 3);
    this.restPositions = new Float64Array(this.capacity * 3);
    this.spinAxes = new Float64Array(this.capacity * 3);
    this.zeroHeadings = new Float64Array(this.capacity * 3);
    this.launchDirections = new Float64Array(this.capacity * 3);
    this.masses = new Float64Array(this.capacity);
    this.sizes = new Float64Array(this.capacity);
    this.cycleTicks = new Float64Array(this.capacity);
    this.pinned = new Uint8Array(this.capacity);
    this.explicitMass = new Uint8Array(this.capacity);

    // Fixed scratch storage. These identities never change, including when bodies are replaced.
    this._positions = new Float64Array(this.capacity * 3);
    this._accelerations = new Float64Array(this.capacity * 3);
    this._stageOffsets = new Float64Array(this.capacity * 3);
    this._stageVelocities = new Float64Array(this.capacity * 3);
    this._attractors = new Int32Array(this.capacity);
    this._launchSuns = new Int32Array(this.capacity);
    this._windowWeights = new Float64Array(this.capacity);

    this._attractorCount = 0;
    this._accumulator = 0;
    this._held = false;
    this._holdAge = 0;
    this._activation = 0;
    this._tick = 0;
    this._ticksPerSecond = 10;
    this._centerX = 0;
    this._centerY = 0;
    this._centerZ = 0;
    this.stats = {
      steps: 0,
      droppedTime: 0,
      clampEngagements: 0,
      speedClamps: 0,
      offsetClamps: 0,
      activation: 0,
      strength: 0,
      bodiesBeyondWindow: 0,
      largestOffset: 0,
    };
  }

  configure(options = {}) {
    const previousExponent = this.options.massExponent;
    this.options = makeOptions({ ...this.options, ...options });
    if (this.options.massExponent !== previousExponent) {
      for (let i = 0; i < this.count; i++) {
        if (!this.explicitMass[i]) this.masses[i] = massFromSize(this.sizes[i], this.options.massExponent);
      }
    }
    this._selectAttractors();
    return this.options;
  }

  setBodies(bodies = []) {
    if (bodies.length > this.capacity) throw new RangeError(`Gravity capacity ${this.capacity} cannot hold ${bodies.length} bodies.`);

    // Stage existing kinematics by incoming identity before any slot is overwritten.
    const oldIndex = new Map();
    for (let i = 0; i < this.count; i++) oldIndex.set(this.ids[i], i);
    this._stageOffsets.fill(0);
    this._stageVelocities.fill(0);
    for (let i = 0; i < bodies.length; i++) {
      const prior = oldIndex.get(bodies[i].id);
      const base = i * 3;
      if (prior == null) {
        const initialOffset = bodies[i].offset;
        const initialVelocity = bodies[i].velocity;
        this._stageOffsets[base] = Number(initialOffset?.[0]) || 0;
        this._stageOffsets[base + 1] = Number(initialOffset?.[1]) || 0;
        this._stageOffsets[base + 2] = Number(initialOffset?.[2]) || 0;
        this._stageVelocities[base] = Number(initialVelocity?.[0]) || 0;
        this._stageVelocities[base + 1] = Number(initialVelocity?.[1]) || 0;
        this._stageVelocities[base + 2] = Number(initialVelocity?.[2]) || 0;
      } else {
        const oldBase = prior * 3;
        this._stageOffsets[base] = this.offsets[oldBase];
        this._stageOffsets[base + 1] = this.offsets[oldBase + 1];
        this._stageOffsets[base + 2] = this.offsets[oldBase + 2];
        this._stageVelocities[base] = this.velocities[oldBase];
        this._stageVelocities[base + 1] = this.velocities[oldBase + 1];
        this._stageVelocities[base + 2] = this.velocities[oldBase + 2];
      }
    }

    this.count = bodies.length;
    for (let i = 0; i < this.capacity; i++) this.ids[i] = i < this.count ? bodies[i].id : null;
    for (let i = 0; i < this.count; i++) {
      const body = bodies[i];
      const base = i * 3;
      const rest = body.rest || body.position || [0, 0, 0];
      this.restPositions[base] = Number(rest[0]) || 0;
      this.restPositions[base + 1] = Number(rest[1]) || 0;
      this.restPositions[base + 2] = Number(rest[2]) || 0;
      this.offsets[base] = this._stageOffsets[base];
      this.offsets[base + 1] = this._stageOffsets[base + 1];
      this.offsets[base + 2] = this._stageOffsets[base + 2];
      this.velocities[base] = this._stageVelocities[base];
      this.velocities[base + 1] = this._stageVelocities[base + 1];
      this.velocities[base + 2] = this._stageVelocities[base + 2];

      this.sizes[i] = Math.max(0, Number(body.size) || 0);
      this.explicitMass[i] = Number.isFinite(body.mass) ? 1 : 0;
      this.masses[i] = this.explicitMass[i] ? Math.max(0, Number(body.mass)) : massFromSize(this.sizes[i], this.options.massExponent);
      this.cycleTicks[i] = Math.max(1, Number(body.cycleTicks) || 1);
      this.pinned[i] = body.pinned ? 1 : 0;

      const axis = normalized3(body.spinAxis, 0, 1, 0);
      this.spinAxes[base] = axis[0];
      this.spinAxes[base + 1] = axis[1];
      this.spinAxes[base + 2] = axis[2];
      const heading = body.zeroHeading
        ? normalized3(body.zeroHeading, 1, 0, 0)
        : this._perpendicularHeading(axis[0], axis[1], axis[2]);
      // Ensure a caller-provided heading is in the spin equator.
      const projection = heading[0] * axis[0] + heading[1] * axis[1] + heading[2] * axis[2];
      let hx = heading[0] - projection * axis[0];
      let hy = heading[1] - projection * axis[1];
      let hz = heading[2] - projection * axis[2];
      const hLength = Math.hypot(hx, hy, hz);
      if (hLength <= EPSILON) [hx, hy, hz] = this._perpendicularHeading(axis[0], axis[1], axis[2]);
      else { hx /= hLength; hy /= hLength; hz /= hLength; }
      this.zeroHeadings[base] = hx;
      this.zeroHeadings[base + 1] = hy;
      this.zeroHeadings[base + 2] = hz;
    }
    for (let i = this.count * 3; i < this.offsets.length; i++) {
      this.offsets[i] = 0;
      this.velocities[i] = 0;
    }
    this._selectAttractors();
    if (this._held) this._seedLaunchDirections(this._tick);
    return this.offsets;
  }

  reset() {
    this.offsets.fill(0);
    this.velocities.fill(0);
    this.launchDirections.fill(0);
    this._launchSuns.fill(-1);
    this._accumulator = 0;
    this._held = false;
    this._holdAge = 0;
    this._activation = 0;
    this.stats.steps = 0;
    this.stats.droppedTime = 0;
    this.stats.clampEngagements = 0;
    this.stats.speedClamps = 0;
    this.stats.offsetClamps = 0;
    this.stats.activation = 0;
    this.stats.strength = 0;
    this.stats.bodiesBeyondWindow = 0;
    this.stats.largestOffset = 0;
  }

  advance(frameTime, { held = this._held, center = [0, 0, 0], tick = this._tick, ticksPerSecond = this._ticksPerSecond } = {}) {
    const nextHeld = Boolean(held);
    this._centerX = Number(center?.[0]) || 0;
    this._centerY = Number(center?.[1]) || 0;
    this._centerZ = Number(center?.[2]) || 0;
    this._tick = Number.isFinite(Number(tick)) ? Number(tick) : this._tick;
    this._ticksPerSecond = Math.max(0, Number(ticksPerSecond) || 0);
    if (nextHeld && !this._held) {
      this._holdAge = 0;
      this._seedLaunchDirections(this._tick);
    }
    if (!nextHeld && this._held) this._holdAge = 0;
    this._held = nextHeld;

    const safeFrame = clamp(Number(frameTime) || 0, 0, this.options.maxFrameTime);
    this._accumulator += safeFrame;
    let subSteps = 0;
    while (this._accumulator + EPSILON >= this.options.fixedTimeStep && subSteps < this.options.maxSubSteps) {
      this._stepFixed(this.options.fixedTimeStep);
      this._accumulator -= this.options.fixedTimeStep;
      this._tick += this.options.fixedTimeStep * this._ticksPerSecond;
      subSteps++;
    }
    if (this._accumulator >= this.options.fixedTimeStep) {
      this.stats.droppedTime += this._accumulator;
      this._accumulator = 0;
    }
    this._updateReadoutStats();
    return this.offsets;
  }

  angularMomentum(out = [0, 0, 0]) {
    let totalMass = 0, cx = 0, cy = 0, cz = 0, cvx = 0, cvy = 0, cvz = 0;
    for (let i = 0; i < this.count; i++) {
      const mass = this.masses[i];
      if (!(mass > 0)) continue;
      const base = i * 3;
      totalMass += mass;
      cx += mass * (this.restPositions[base] + this.offsets[base]);
      cy += mass * (this.restPositions[base + 1] + this.offsets[base + 1]);
      cz += mass * (this.restPositions[base + 2] + this.offsets[base + 2]);
      cvx += mass * this.velocities[base];
      cvy += mass * this.velocities[base + 1];
      cvz += mass * this.velocities[base + 2];
    }
    if (totalMass > 0) {
      cx /= totalMass; cy /= totalMass; cz /= totalMass;
      cvx /= totalMass; cvy /= totalMass; cvz /= totalMass;
    }
    let lx = 0, ly = 0, lz = 0;
    for (let i = 0; i < this.count; i++) {
      const mass = this.masses[i];
      if (!(mass > 0)) continue;
      const base = i * 3;
      const rx = this.restPositions[base] + this.offsets[base] - cx;
      const ry = this.restPositions[base + 1] + this.offsets[base + 1] - cy;
      const rz = this.restPositions[base + 2] + this.offsets[base + 2] - cz;
      const vx = this.velocities[base] - cvx;
      const vy = this.velocities[base + 1] - cvy;
      const vz = this.velocities[base + 2] - cvz;
      lx += mass * (ry * vz - rz * vy);
      ly += mass * (rz * vx - rx * vz);
      lz += mass * (rx * vy - ry * vx);
    }
    out[0] = lx; out[1] = ly; out[2] = lz;
    return out;
  }

  _perpendicularHeading(ax, ay, az) {
    // Cross the axis with the least-parallel cardinal direction for a stable equator basis.
    let rx = 0, ry = 1, rz = 0;
    if (Math.abs(ay) > 0.85) { rx = 1; ry = 0; }
    let hx = ay * rz - az * ry;
    let hy = az * rx - ax * rz;
    let hz = ax * ry - ay * rx;
    const length = Math.hypot(hx, hy, hz) || 1;
    return [hx / length, hy / length, hz / length];
  }

  _axisAt(index) {
    if (this.options.axisMode === 'shared') return this.options.sharedSpinAxis;
    const base = index * 3;
    return [this.spinAxes[base], this.spinAxes[base + 1], this.spinAxes[base + 2]];
  }

  _pointerAt(index, tick, out) {
    const base = index * 3;
    let ax, ay, az, hx, hy, hz;
    if (this.options.axisMode === 'shared') {
      [ax, ay, az] = this.options.sharedSpinAxis;
      let rx = 0, ry = 1, rz = 0;
      if (Math.abs(ay) > 0.85) { rx = 1; ry = 0; }
      hx = ay * rz - az * ry;
      hy = az * rx - ax * rz;
      hz = ax * ry - ay * rx;
      const headingLength = Math.hypot(hx, hy, hz) || 1;
      hx /= headingLength; hy /= headingLength; hz /= headingLength;
    } else {
      ax = this.spinAxes[base]; ay = this.spinAxes[base + 1]; az = this.spinAxes[base + 2];
      hx = this.zeroHeadings[base]; hy = this.zeroHeadings[base + 1]; hz = this.zeroHeadings[base + 2];
    }
    const qx = ay * hz - az * hy;
    const qy = az * hx - ax * hz;
    const qz = ax * hy - ay * hx;
    const phase = ((tick % this.cycleTicks[index]) + this.cycleTicks[index]) % this.cycleTicks[index];
    const angle = TAU * phase / this.cycleTicks[index];
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    out[0] = hx * cosine + qx * sine;
    out[1] = hy * cosine + qy * sine;
    out[2] = hz * cosine + qz * sine;
  }

  _selectAttractors() {
    const limit = Math.min(this.count, this.capacity, this.options.attractorCount);
    this._attractorCount = 0;
    this._attractors.fill(-1);
    for (let i = 0; i < this.count; i++) {
      if (!(this.masses[i] > 0)) continue;
      let insert = this._attractorCount;
      while (insert > 0 && this.masses[this._attractors[insert - 1]] < this.masses[i]) insert--;
      if (insert >= limit) continue;
      const end = Math.min(this._attractorCount, limit - 1);
      for (let j = end; j > insert; j--) this._attractors[j] = this._attractors[j - 1];
      this._attractors[insert] = i;
      if (this._attractorCount < limit) this._attractorCount++;
    }
  }

  _seedLaunchDirections(tick) {
    this._composePositions();
    this._launchSuns.fill(-1);
    const pointer = [0, 0, 0];
    for (let i = 0; i < this.count; i++) {
      const base = i * 3;
      let sun = -1, strongest = -Infinity;
      for (let a = 0; a < this._attractorCount; a++) {
        const candidate = this._attractors[a];
        if (candidate === i) continue;
        // Launches form a hierarchy: suns orbit only a heavier neighbour (stable index breaks
        // exact mass ties), leaving the first globally heaviest body at rest.
        if (this.masses[candidate] < this.masses[i] || (this.masses[candidate] === this.masses[i] && candidate > i)) continue;
        const source = candidate * 3;
        const dx = this._positions[base] - this._positions[source];
        const dy = this._positions[base + 1] - this._positions[source + 1];
        const dz = this._positions[base + 2] - this._positions[source + 2];
        const pull = this.masses[candidate] / Math.max(EPSILON, dx * dx + dy * dy + dz * dz);
        if (pull > strongest) { strongest = pull; sun = candidate; }
      }
      this._launchSuns[i] = sun;
      if (sun < 0) {
        this.launchDirections[base] = 0;
        this.launchDirections[base + 1] = 0;
        this.launchDirections[base + 2] = 0;
        continue;
      }
      const source = sun * 3;
      let rx = this._positions[base] - this._positions[source];
      let ry = this._positions[base + 1] - this._positions[source + 1];
      let rz = this._positions[base + 2] - this._positions[source + 2];
      const radius = Math.hypot(rx, ry, rz) || 1;
      rx /= radius; ry /= radius; rz /= radius;
      let sx, sy, sz;
      if (this.options.axisMode === 'shared') [sx, sy, sz] = this.options.sharedSpinAxis;
      else { sx = this.spinAxes[source]; sy = this.spinAxes[source + 1]; sz = this.spinAxes[source + 2]; }
      let tx = sy * rz - sz * ry;
      let ty = sz * rx - sx * rz;
      let tz = sx * ry - sy * rx;
      let tangentLength = Math.hypot(tx, ty, tz);
      if (tangentLength <= EPSILON) {
        this._pointerAt(sun, tick, pointer);
        tx = pointer[1] * rz - pointer[2] * ry;
        ty = pointer[2] * rx - pointer[0] * rz;
        tz = pointer[0] * ry - pointer[1] * rx;
        tangentLength = Math.hypot(tx, ty, tz) || 1;
      }
      tx /= tangentLength; ty /= tangentLength; tz /= tangentLength;
      this._pointerAt(i, tick, pointer);
      const blend = this.options.pointerBlend;
      let dx = tx * (1 - blend) + pointer[0] * blend;
      let dy = ty * (1 - blend) + pointer[1] * blend;
      let dz = tz * (1 - blend) + pointer[2] * blend;
      const directionLength = Math.hypot(dx, dy, dz) || 1;
      dx /= directionLength; dy /= directionLength; dz /= directionLength;
      this.launchDirections[base] = dx;
      this.launchDirections[base + 1] = dy;
      this.launchDirections[base + 2] = dz;
    }
  }

  _stepFixed(dt) {
    if (this._held) {
      this._holdAge += dt;
      this._activation = this.options.rampTime <= 0 ? 1 : 1 - Math.exp(-3 * this._holdAge / this.options.rampTime);
    } else {
      this._activation *= Math.exp(-6 * dt / this.options.releaseTime);
      if (this._activation < 1e-8) this._activation = 0;
    }
    const strength = this.options.strengthCeiling * this._activation;
    this._composePositions();
    this._computeWindowWeights();
    this._computeAccelerations(strength);
    for (let i = 0; i < this.count; i++) {
      const base = i * 3;
      if (this.pinned[i]) {
        this.offsets[base] = 0; this.offsets[base + 1] = 0; this.offsets[base + 2] = 0;
        this.velocities[base] = 0; this.velocities[base + 1] = 0; this.velocities[base + 2] = 0;
        continue;
      }
      this.velocities[base] += this._accelerations[base] * dt * 0.5;
      this.velocities[base + 1] += this._accelerations[base + 1] * dt * 0.5;
      this.velocities[base + 2] += this._accelerations[base + 2] * dt * 0.5;
      this.offsets[base] += this.velocities[base] * dt;
      this.offsets[base + 1] += this.velocities[base + 1] * dt;
      this.offsets[base + 2] += this.velocities[base + 2] * dt;
    }
    this._composePositions();
    this._computeWindowWeights();
    this._computeAccelerations(strength);
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const base = i * 3;
      this.velocities[base] += this._accelerations[base] * dt * 0.5;
      this.velocities[base + 1] += this._accelerations[base + 1] * dt * 0.5;
      this.velocities[base + 2] += this._accelerations[base + 2] * dt * 0.5;
    }
    if (this._held && this.options.spinUpTime > 0 && this._holdAge <= this.options.spinUpTime) this._applySpinUp(dt, strength);
    this._applyClamps();
    this.stats.steps++;
  }

  _composePositions() {
    for (let i = 0; i < this.count * 3; i++) this._positions[i] = this.restPositions[i] + this.offsets[i];
  }

  _computeWindowWeights() {
    for (let i = 0; i < this.count; i++) {
      const base = i * 3;
      const distance = Math.hypot(
        this._positions[base] - this._centerX,
        this._positions[base + 1] - this._centerY,
        this._positions[base + 2] - this._centerZ,
      );
      this._windowWeights[i] = gravityWindowWeight(distance, this.options.windowInner, this.options.windowOuter);
    }
  }

  _computeAccelerations(strength) {
    this._accelerations.fill(0);
    const softening2 = this.options.softening ** 2;
    const springOmega = 4 / this.options.springTime;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const base = i * 3;
      const targetWeight = this._windowWeights[i];
      let ax = 0, ay = 0, az = 0;
      if (strength > 0 && targetWeight > 0) {
        for (let a = 0; a < this._attractorCount; a++) {
          const sourceIndex = this._attractors[a];
          if (sourceIndex === i || this._windowWeights[sourceIndex] <= 0) continue;
          const source = sourceIndex * 3;
          const dx = this._positions[source] - this._positions[base];
          const dy = this._positions[source + 1] - this._positions[base + 1];
          const dz = this._positions[source + 2] - this._positions[base + 2];
          const softened2 = dx * dx + dy * dy + dz * dz + softening2;
          const inverseCube = 1 / (softened2 * Math.sqrt(softened2));
          const factor = strength * targetWeight * this._windowWeights[sourceIndex] * this.masses[sourceIndex] * inverseCube;
          ax += dx * factor; ay += dy * factor; az += dz * factor;
        }
      }
      const springWeight = 1 - this._activation * targetWeight;
      if (springWeight > 0) {
        const spring2 = springOmega * springOmega * springWeight;
        const damping = 2 * springOmega * Math.sqrt(springWeight);
        ax += -spring2 * this.offsets[base] - damping * this.velocities[base];
        ay += -spring2 * this.offsets[base + 1] - damping * this.velocities[base + 1];
        az += -spring2 * this.offsets[base + 2] - damping * this.velocities[base + 2];
      }
      this._accelerations[base] = ax;
      this._accelerations[base + 1] = ay;
      this._accelerations[base + 2] = az;
    }
  }

  _applySpinUp(dt, strength) {
    const remaining = Math.max(this.options.fixedTimeStep, this.options.spinUpTime - this._holdAge + dt);
    const ease = 1 - Math.exp(-5 * dt / remaining);
    const softening2 = this.options.softening ** 2;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      const sun = this._launchSuns[i];
      if (sun < 0) continue;
      const base = i * 3, source = sun * 3;
      const dx = this._positions[base] - this._positions[source];
      const dy = this._positions[base + 1] - this._positions[source + 1];
      const dz = this._positions[base + 2] - this._positions[source + 2];
      const radius2 = dx * dx + dy * dy + dz * dz;
      const softened = Math.sqrt(radius2 + softening2);
      const speed = Math.sqrt(Math.max(0, strength * this._windowWeights[i] * this._windowWeights[sun] * this.masses[sun] * radius2 / (softened ** 3)));
      const vx = this.launchDirections[base] * speed;
      const vy = this.launchDirections[base + 1] * speed;
      const vz = this.launchDirections[base + 2] * speed;
      this.velocities[base] += (vx - this.velocities[base]) * ease;
      this.velocities[base + 1] += (vy - this.velocities[base + 1]) * ease;
      this.velocities[base + 2] += (vz - this.velocities[base + 2]) * ease;
    }
  }

  _applyClamps() {
    const speedLimit = this.options.maxSpeed, offsetLimit = this.options.maxOffset;
    for (let i = 0; i < this.count; i++) {
      const base = i * 3;
      const speed = Math.hypot(this.velocities[base], this.velocities[base + 1], this.velocities[base + 2]);
      if (!Number.isFinite(speed) || speed > speedLimit) {
        const factor = Number.isFinite(speed) && speed > 0 ? speedLimit / speed : 0;
        this.velocities[base] = (Number.isFinite(this.velocities[base]) ? this.velocities[base] : 0) * factor;
        this.velocities[base + 1] = (Number.isFinite(this.velocities[base + 1]) ? this.velocities[base + 1] : 0) * factor;
        this.velocities[base + 2] = (Number.isFinite(this.velocities[base + 2]) ? this.velocities[base + 2] : 0) * factor;
        this.stats.speedClamps++;
        this.stats.clampEngagements++;
      }
      const offset = Math.hypot(this.offsets[base], this.offsets[base + 1], this.offsets[base + 2]);
      if (!Number.isFinite(offset) || offset > offsetLimit) {
        const factor = Number.isFinite(offset) && offset > 0 ? offsetLimit / offset : 0;
        this.offsets[base] = (Number.isFinite(this.offsets[base]) ? this.offsets[base] : 0) * factor;
        this.offsets[base + 1] = (Number.isFinite(this.offsets[base + 1]) ? this.offsets[base + 1] : 0) * factor;
        this.offsets[base + 2] = (Number.isFinite(this.offsets[base + 2]) ? this.offsets[base + 2] : 0) * factor;
        this.stats.offsetClamps++;
        this.stats.clampEngagements++;
      }
    }
  }

  _updateReadoutStats() {
    let largest = 0, beyond = 0;
    for (let i = 0; i < this.count; i++) {
      const base = i * 3;
      const offset = Math.hypot(this.offsets[base], this.offsets[base + 1], this.offsets[base + 2]);
      if (offset > largest) largest = offset;
      if (this._windowWeights[i] <= 0) beyond++;
    }
    this.stats.activation = this._activation;
    this.stats.strength = this.options.strengthCeiling * this._activation;
    this.stats.bodiesBeyondWindow = beyond;
    this.stats.largestOffset = largest;
  }
}

export function createGravitySimulation(config) {
  return new GravitySimulation(config);
}
