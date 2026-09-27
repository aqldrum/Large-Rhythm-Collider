// Behavioural guards for view-frame.js — the one projection every Cosmos renderer draws through (third-person
// work order, Cosmos/docs/COSMOS_THIRD_PERSON_WORK_ORDER_2026-09-23.md). The gate for everything else: with the eye
// at the ship, the frame must be the legacy first-person projection BIT FOR BIT. These checks run the new code and
// the three retired projectors side by side on randomised inputs and compare with Object.is — no source reading.
import { createViewFrame, composeViewFrames } from '../ui/view-frame.js';
import { routeCameraBasis } from '../engine/web-return.js';
import { setPlacement, macroCell, macroScale, backboneHash, CELL } from '../engine/spine.js';
import { hilbertEncode } from '../engine/hilbert.js';

let PASS = true;
const check = (label, ok, detail = '') => {
  if (!ok) PASS = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
console.log('═══ COSMOS VIEW FRAME — assertions ═══');

// ── the retired projectors, verbatim (the pre-migration formulas are the specification) ────────────────────
const NEAR = 5;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// flight-view.js toScreen (cx, cy, focal were module state)
const legacyToScreen = (rp, basis, cx, cy, focal) => {
  const vx = dot(rp, basis.r), vy = dot(rp, basis.u), vz = dot(rp, basis.d);
  if (vz <= NEAR) return null;
  return { x: cx + vx * focal / vz, y: cy - vy * focal / vz, z: vz };
};
// grid-row-constellation.js toView + its inline perspective divide
const legacyConstellationView = (rp, basis) => ({
  x: rp[0] * basis.r[0] + rp[1] * basis.r[1] + rp[2] * basis.r[2],
  y: rp[0] * basis.u[0] + rp[1] * basis.u[1] + rp[2] * basis.u[2],
  z: rp[0] * basis.d[0] + rp[1] * basis.d[1] + rp[2] * basis.d[2],
});
// web-render-worker.js toView + projectView (frame = { r, u, d, cx, cy, focal })
const legacyWorkerProject = (point, frame) => {
  const x = dot(point, frame.r), y = dot(point, frame.u), z = dot(point, frame.d);
  if (z <= 5) return null;
  return { x: frame.cx + x * frame.focal / z, y: frame.cy - y * frame.focal / z, z };
};
// flight-view.js camBasis in free flight
const freeBasis = (yaw, pitch) => {
  const d = norm([Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)]);
  const r = norm(cross([0, 1, 0], d));
  return { d, r, u: cross(d, r) };
};

// deterministic PRNG so a failure reproduces
let seed = 0x9e3779b9;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };
const between = (lo, hi) => lo + (hi - lo) * rand();

const bases = [];
for (const pitch of [-1.4, -1.0, -0.3, 0, 0.05, 0.7, 1.4]) for (let i = 0; i < 8; i++) bases.push(freeBasis(between(-Math.PI, Math.PI), pitch));
for (let i = 0; i < 12; i++) bases.push(freeBasis(between(-10, 10), between(-1.4, 1.4)));
// Web-ride route bases, including straight-down / straight-up strands and arrow-look offsets
for (const tangent of [[0, -1, 0], [0, 1, 0], [0.3, -0.95, 0.1], [1, 0, 0], [0.2, 0.1, -0.97]])
  for (const [lookYaw, lookPitch] of [[0, 0], [0.8, -0.4], [-1.2, 1.4]]) {
    const t = norm(tangent), lift = norm(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [-t[0] * t[1], 1 - t[1] ** 2, -t[2] * t[1]]);
    const b = routeCameraBasis(t, lift, lookYaw, lookPitch); bases.push({ d: b.d, r: b.r, u: b.u });
  }

const screens = [[1280, 800], [390, 844], [2560, 1440], [1001, 777]];
const same = (a, b) => Object.is(a, b);

console.log('\n  First-person parity (eye at the ship): bit for bit against all three retired projectors');
{
  let compared = 0, nulls = 0, mismatch = null;
  for (const basis of bases) for (const [W, H] of screens) {
    const cx = W / 2, cy = H / 2, focal = Math.min(W, H) * 0.9;
    const frame = createViewFrame({ basis, focal, cx, cy, near: NEAR });
    const workerFrame = { r: basis.r, u: basis.u, d: basis.d, cx, cy, focal };
    for (let i = 0; i < 400; i++) {
      const scale = [1, 30, 900, 7000, 1e5][i % 5];
      const rp = [between(-scale, scale), between(-scale, scale), between(-scale, scale)];
      const legacy = legacyToScreen(rp, basis, cx, cy, focal), mine = frame.project(rp), worker = legacyWorkerProject(rp, workerFrame);
      compared++;
      if (!legacy) { nulls++; if (mine !== null || worker !== null) mismatch ??= { rp, why: 'null disagreement' }; continue; }
      if (!mine || !same(mine.x, legacy.x) || !same(mine.y, legacy.y) || !same(mine.z, legacy.z) || !same(mine.f, mine.z))
        mismatch ??= { rp, legacy, mine };
      if (!same(worker.x, legacy.x) || !same(worker.y, legacy.y)) mismatch ??= { rp, why: 'retired worker ≠ retired flight-view' };
      const v = frame.toView(rp), cv = legacyConstellationView(rp, basis);
      if (!same(v.x, cv.x) || !same(v.y, cv.y) || !same(v.z, cv.z)) mismatch ??= { rp, why: 'toView ≠ constellation toView' };
      const s = frame.toScreen(v);
      if (!same(s.x, cx + cv.x * focal / cv.z) || !same(s.y, cy - cv.y * focal / cv.z)) mismatch ??= { rp, why: 'toScreen ≠ constellation divide' };
      if (!same(frame.fogDepth(rp, v), v.z)) mismatch ??= { rp, why: 'fogDepth ≠ view depth' };
    }
  }
  check(`project() === legacy toScreen, and toView/toScreen === the constellation's maths (${compared.toLocaleString()} points, ${bases.length} bases incl. ±1.4 rad pitch and route bases)`,
    mismatch === null, mismatch ? JSON.stringify(mismatch) : `${nulls.toLocaleString()} near-culled`);
  check('first-person fog depth IS the eye depth (f === z, Object.is) — fogAt(s.f) reads exactly what fogAt(s.z) did', mismatch === null);
}

console.log('\n  Near plane: null at exactly the same cases');
{
  const basis = { r: [1, 0, 0], u: [0, 1, 0], d: [0, 0, 1] };
  const frame = createViewFrame({ basis, focal: 720, cx: 640, cy: 400, near: NEAR });
  const edge = [[3, -2, 5], [3, -2, 5 + 1e-12], [3, -2, 5 - 1e-12], [0, 0, 0], [1, 1, -0], [0, 0, -5], [9, 9, Number.MIN_VALUE]];
  const agree = edge.every(rp => {
    const legacy = legacyToScreen(rp, basis, 640, 400, 720), mine = frame.project(rp);
    return (legacy === null) === (mine === null) && (!legacy || (same(legacy.x, mine.x) && same(legacy.y, mine.y) && same(legacy.z, mine.z)));
  });
  check('vz = NEAR exactly is culled, NEAR + ε is kept, the origin and points behind are culled — same as legacy', agree);
  check('a zero eye is the first-person frame (explicit [0,0,0] ≡ omitted)', (() => {
    const a = createViewFrame({ basis: bases[3], focal: 700, cx: 1, cy: 2, near: NEAR });
    const b = createViewFrame({ basis: bases[3], eye: [0, 0, 0], focal: 700, cx: 1, cy: 2, near: NEAR });
    for (let i = 0; i < 2000; i++) {
      const rp = [between(-3e3, 3e3), between(-3e3, 3e3), between(-3e3, 3e3)], p = a.project(rp), q = b.project(rp);
      if ((p === null) !== (q === null) || (p && (!same(p.x, q.x) || !same(p.y, q.y) || !same(p.z, q.z)))) return false;
    }
    return true;
  })());
}

console.log('\n  Chase fog: distance from the SHIP, not depth from the eye');
{
  const FOG_NEAR = 12 * CELL * 0.4, FOG_FAR = 20 * CELL;   // the Hilbert law at the default tier
  const fogAt = f => Math.max(0, Math.min(1, 1 - (f - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));
  const rp = [1234, -567, 890], distance = Math.hypot(...rp);
  const invariant = bases.every(basis => {
    const eye = [between(-2000, 2000), between(-2000, 2000), between(-2000, 2000)];
    const frame = createViewFrame({ basis, eye, focal: 700, cx: 500, cy: 400, near: NEAR, fog: 1 });
    const v = frame.toView(rp), f = frame.fogDepth(rp, v), s = frame.project(rp);
    return Math.abs(f - distance) < 1e-9 && (!s || Math.abs(s.f - distance) < 1e-9);
  });
  check('chase fog depth equals |rp| for every view basis and eye — turning the view changes nothing', invariant);
  const shell = (() => {
    for (let i = 0; i < 500; i++) {
      const dir = norm([between(-1, 1), between(-1, 1), between(-1, 1)]), p = dir.map(c => c * FOG_FAR);
      const frame = createViewFrame({ basis: bases[i % bases.length], eye: [0, 400, -1200], focal: 700, cx: 500, cy: 400, near: NEAR, fog: 1 });
      if (fogAt(frame.fogDepth(p, frame.toView(p))) > 1e-9) return false;
      const inside = dir.map(c => c * FOG_FAR * 0.98);
      if (!(fogAt(frame.fogDepth(inside, frame.toView(inside))) > 0)) return false;
    }
    return true;
  })();
  check('a point on the evict shell (FOG_FAR from the ship) has zero fog in EVERY direction; just inside is still lit', shell);
  const continuous = (() => {
    const basis = bases[5], rp2 = [300, 200, 2500];
    let prev = null, worst = 0;
    for (let k = 0; k <= 1000; k++) {
      const t = k / 1000, eye = [0, 680 * t, -1180 * t];
      const f = createViewFrame({ basis, eye, focal: 700, cx: 0, cy: 0, near: NEAR, fog: t });
      const depth = f.fogDepth(rp2, f.toView(rp2));
      if (prev !== null) worst = Math.max(worst, Math.abs(depth - prev));
      prev = depth;
    }
    return worst < 5;   // units per 1/1000 of the blend — no step anywhere
  })();
  check('the blended fog depth (1 − t)·z + t·|rp| is continuous across the whole V transition', continuous);
  check('blend endpoints: fog 0 → view depth, fog 1 → ship distance', (() => {
    const eye = [10, 300, -900], p = [100, -40, 700];
    const f0 = createViewFrame({ basis: bases[0], eye, focal: 1, cx: 0, cy: 0, near: NEAR, fog: 0 });
    const f1 = createViewFrame({ basis: bases[0], eye, focal: 1, cx: 0, cy: 0, near: NEAR, fog: 1 });
    const fh = createViewFrame({ basis: bases[0], eye, focal: 1, cx: 0, cy: 0, near: NEAR, fog: 0.5 });
    const z = f0.toView(p).z, d = Math.hypot(...p);
    return f0.fogDepth(p, f0.toView(p)) === z && Math.abs(f1.fogDepth(p, f1.toView(p)) - d) < 1e-9
      && Math.abs(fh.fogDepth(p, fh.toView(p)) - (z + d) / 2) < 1e-9;
  })());
}

console.log('\n  The pair: shipView for hearing, renderView for drawing');
{
  const basis = bases[9], pose = { eye: [0, 500, -1100], basis: bases[10] };
  const firstPerson = composeViewFrames({ shipBasis: basis, pose: null, fog: 0, focal: 700, cx: 600, cy: 400, near: NEAR });
  const zeroBlend = composeViewFrames({ shipBasis: basis, pose, fog: 0, focal: 700, cx: 600, cy: 400, near: NEAR });
  const chased = composeViewFrames({ shipBasis: basis, pose, fog: 1, focal: 700, cx: 600, cy: 400, near: NEAR });
  check('with no pose, or t = 0, renderView IS shipView (the same object) — first person cannot drift',
    firstPerson.renderView === firstPerson.shipView && zeroBlend.renderView === zeroBlend.shipView);
  check('shipView carries the ship\'s own basis object in every mode', [firstPerson, zeroBlend, chased].every(v => v.shipView.basis === basis));
  check('in chase view renderView really moves (the eye and basis are the pose\'s)',
    chased.renderView !== chased.shipView && chased.renderView.basis === pose.basis && chased.renderView.eye[1] === 500);
}

console.log('\n  Worker agreement: the Web worker projects a shared fixture exactly as the main thread does');
{
  // Drive the REAL worker module under Node: a fake `self`, a recording OffscreenCanvas context, and the same
  // message sequence flight-view sends. Beads land at arc() centres, which must equal the main thread's
  // projection of the same grids through view-frame.js — first person AND chase.
  const posted = [];
  globalThis.self = { postMessage: message => posted.push(message) };
  const arcs = [];
  const recorder = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {}, fillText() {},
    arc(x, y) { arcs.push({ x, y, alpha: this.globalAlpha }); },
    globalAlpha: 1, lineWidth: 1, strokeStyle: null, fillStyle: null, lineCap: 'butt', font: '', textBaseline: 'alphabetic',
  };
  await import('../workers/web-render-worker.js');
  const send = data => self.onmessage({ data });
  setPlacement('hilbert');
  send({ type: 'init', canvas: { getContext: () => recorder, width: 0, height: 0 }, placement: 'hilbert' });
  send({ type: 'resize', width: 1280, height: 800, dpr: 1 });
  const home = [60, 61, 59], anchor = hilbertEncode(...home);
  const members = [];
  for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz += 2) members.push(hilbertEncode(home[0] + dx, home[1] + dy, home[2] + dz));
  send({ type: 'upsert', web: { tag: 'fixture', color: '#fff', members, homeGrid: anchor, dynamic: false } });
  const off = [37.5, -12.25, 80];
  const camCell = macroCell(anchor), scale = macroScale();
  const gridRelative = grid => {
    const c = macroCell(grid), h = backboneHash(grid);
    return [(c[0] - camCell[0]) * scale + h[0] - off[0], (c[1] - camCell[1]) * scale + h[1] - off[1], (c[2] - camCell[2]) * scale + h[2] - off[2]];
  };
  const run = (label, basis, eye, fog) => {
    const cx = 640, cy = 400, focal = 720, fogNear = 12 * CELL * 0.4, fogFar = 20 * CELL;
    arcs.length = 0;
    send({ type: 'frame', frameId: 1, frame: { now: 0, anchor, off, d: basis.d, r: basis.r, u: basis.u, eye, near: NEAR, fogBlend: fog,
      mouseX: -1, mouseY: -1, cx, cy, focal, fogNear, fogFar, tailFrac: 1, gravity: null } });
    const frame = createViewFrame({ basis, eye, focal, cx, cy, near: NEAR, fog });
    const fogAt = f => Math.max(0, Math.min(1, 1 - (f - fogNear) / (fogFar - fogNear)));
    const expected = [];
    for (const grid of members) {
      const s = frame.project(gridRelative(grid));
      if (s && fogAt(s.f) > 0.01) expected.push(s);
    }
    const key = p => `${p.x}|${p.y}`;
    const drawn = new Set(arcs.map(key)), want = new Set(expected.map(key));
    const agree = drawn.size === want.size && [...want].every(k => drawn.has(k));
    check(`${label}: ${expected.length} beads at exactly the main thread's projected points`, agree && expected.length > 20,
      agree ? '' : `worker ${drawn.size} vs main ${want.size}`);
    return { arcs: [...arcs], expected };
  };
  const shipBasis = freeBasis(0.7, -0.35);
  run('first person', shipBasis, null, 0);
  const chaseBasis = freeBasis(0.7, -0.75);
  const chased = run('chase view (eye pulled back and up, fog by ship distance)', chaseBasis, [-400, 900, -1100], 1);
  check('the worker\'s chase-view bead alpha follows the SHIP-distance fog law', (() => {
    const fogNear = 12 * CELL * 0.4, fogFar = 20 * CELL;
    const fogAt = f => Math.max(0, Math.min(1, 1 - (f - fogNear) / (fogFar - fogNear)));
    const byKey = new Map(chased.expected.map(s => [`${s.x}|${s.y}`, s]));
    return chased.arcs.every(a => { const s = byKey.get(`${a.x}|${a.y}`); return s && Math.abs(a.alpha - 0.6 * fogAt(s.f)) < 1e-9; });
  })());
  check('the worker answered each frame', posted.filter(m => m.type === 'frameDone' && !m.error).length === 2,
    posted.map(m => m.error).filter(Boolean).join('; '));
}

console.log(PASS ? '\n✓ COSMOS VIEW FRAME OK' : '\n✗ COSMOS VIEW FRAME FAILED');
process.exitCode = PASS ? 0 : 1;
