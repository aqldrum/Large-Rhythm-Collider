// Behavioural guards for chase-camera.js — the pure pose behind third-person flight (work order
// Cosmos/docs/COSMOS_THIRD_PERSON_WORK_ORDER_2026-09-23.md) — and for the one rule that makes it safe: the SHIP keeps
// everything that is heard. These run the pose and the per-frame view composition flight-view uses and assert on
// the values they produce (screen points, eye positions, what the audio layer is handed), never on source text.
import { CHASE_DEFAULTS, chaseOptions, chasePose, segmentReach, smoothstep, stepChaseProgress } from '../ui/chase-camera.js';
import { composeViewFrames, createViewFrame } from '../ui/view-frame.js';
import { toAudioListenerPosition } from '../audio/spatial-audio-frame.js';
import { PLAYER_SHIP_SLICES, drawPlayerShip } from '../ui/player-ship.js';
import { routeCameraBasis } from '../engine/web-return.js';
import { HILBERT_WORLD_MAX, HILBERT_WORLD_MIN } from '../engine/hilbert-boundary.js';
import { CELL } from '../engine/spine.js';

let PASS = true;
const check = (label, ok, detail = '') => {
  if (!ok) PASS = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
console.log('═══ COSMOS CHASE CAMERA — assertions ═══');

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finite = v => v.every(Number.isFinite);
// flight-view.js camBasis in free flight
const shipBasis = (yaw, pitch) => {
  const d = norm([Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)]);
  const r = norm(cross([0, 1, 0], d));
  return { d, r, u: cross(d, r) };
};
const orthonormal = b => [b.d, b.r, b.u].every(v => Math.abs(Math.hypot(...v) - 1) < 1e-9)
  && Math.abs(dot(b.d, b.r)) < 1e-9 && Math.abs(dot(b.d, b.u)) < 1e-9 && Math.abs(dot(b.r, b.u)) < 1e-9
  && dist(cross(b.d, b.r), b.u) < 1e-9;   // same handedness as camBasis: u = d × r
let seed = 0x2545f491;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };
const between = (lo, hi) => lo + (hi - lo) * rand();

const NEAR = 5, W = 1280, H = 800, cx = W / 2, cy = H / 2, focal = Math.min(W, H) * 0.9;
const unit = CELL;

console.log('\n  Options (the one object the future visual-options panel binds to)');
{
  check('defaults are the signed-off start values: 4 cells, 30°, 1 cell ahead, 0.4 s, 0.3-cell hull',
    CHASE_DEFAULTS.distance === 4 && CHASE_DEFAULTS.elevation === 30 && CHASE_DEFAULTS.lookAhead === 1
    && CHASE_DEFAULTS.transition === 0.4 && CHASE_DEFAULTS.shipScale === 0.3);
  const patched = chaseOptions({ distance: 8, elevation: 200, lookAhead: -3, transition: 'slow', shipScale: NaN, rogue: 1 });
  check('a patch is clamped to its range, junk values are ignored and unknown keys dropped',
    patched.distance === 8 && patched.elevation === 89 && patched.lookAhead === 0 && patched.transition === 0.4
    && patched.shipScale === 0.3 && !('rogue' in patched));
  check('patching never mutates the defaults', CHASE_DEFAULTS.distance === 4 && Object.isFrozen(CHASE_DEFAULTS));
  check('successive patches compose', chaseOptions({ elevation: 60 }, chaseOptions({ distance: 2 })).distance === 2);
}

console.log('\n  The V transition');
{
  let progress = 0, frames = 0;
  while (progress < 1 && frames < 1000) { progress = stepChaseProgress(progress, 1, 1 / 60, 0.4); frames++; }
  check('easing in takes the transition time on the frame clock (0.4 s = 24 frames at 60 Hz)', frames === 24, `${frames} frames`);
  let back = 0.5, rising = true;
  for (let i = 0; i < 10; i++) { const next = stepChaseProgress(back, 0, 1 / 60, 0.4); if (next > back) rising = false; back = next; }
  check('reversing mid-way turns straight round (V pressed again during the ease)', rising && back < 0.5);
  check('a zero transition snaps', stepChaseProgress(0, 1, 1 / 60, 0) === 1 && stepChaseProgress(1, 0, 1 / 60, 0) === 0);
  check('smoothstep: 0 → 0, ½ → ½, 1 → 1, monotone, flat at both ends', smoothstep(0) === 0 && smoothstep(1) === 1 && smoothstep(0.5) === 0.5
    && smoothstep(0.01) < 0.001 && smoothstep(0.99) > 0.999 && (() => { let p = -1; for (let x = 0; x <= 1; x += 0.01) { const s = smoothstep(x); if (s < p) return false; p = s; } return true; })());
}

console.log('\n  The pose');
{
  const b = shipBasis(0.9, 0.2);
  const idle = chasePose(b, CHASE_DEFAULTS, 0, { unit });
  check('t = 0 is the identity: eye at the ship, and the ship\'s own basis object', idle.eye.every(v => v === 0) && idle.basis === b);

  let framing = true, worst = 0;
  for (const [D, theta, L] of [[4, 30, 1], [2, 30, 1], [8, 30, 1], [4, 60, 1], [4, 75, 0.5], [4, 15, 2], [4, 30, 0]]) {
    for (const [yaw, pitch] of [[0, 0], [1.3, -1.4], [-2.2, 1.4], [3.1, 0.4]]) {
      const ship = shipBasis(yaw, pitch), options = chaseOptions({ distance: D, elevation: theta, lookAhead: L });
      const pose = chasePose(ship, options, 1, { unit });
      const th = theta * Math.PI / 180, d = D * unit, l = L * unit;
      const phi = Math.atan2(d * Math.sin(th), l + d * Math.cos(th));
      const frame = createViewFrame({ basis: pose.basis, eye: pose.eye, focal, cx, cy, near: NEAR, fog: 1 });
      const s = frame.project([0, 0, 0]);
      const expected = { x: cx, y: cy + focal * Math.tan(th - phi) };
      const error = s ? Math.hypot(s.x - expected.x, s.y - expected.y) : Infinity;
      worst = Math.max(worst, error);
      if (!(error < 1e-6)) framing = false;
      // the eye sits D behind-and-above in the ship's d–u plane
      if (Math.abs(dot(pose.eye, ship.d) + d * Math.cos(th)) > 1e-6 || Math.abs(dot(pose.eye, ship.u) - d * Math.sin(th)) > 1e-6
          || Math.abs(dot(pose.eye, ship.r)) > 1e-6) framing = false;
      if (!orthonormal(pose.basis)) framing = false;
    }
  }
  check('the ship projects exactly to (cx, cy + focal·tan(θ − φ)), φ = atan(D·sin θ / (L + D·cos θ)), for every D, θ, L tried',
    framing, `worst ${worst.toExponential(2)} px`);
  const def = chasePose(shipBasis(0.4, 0.1), CHASE_DEFAULTS, 1, { unit });
  const defFrame = createViewFrame({ basis: def.basis, eye: def.eye, focal, cx, cy, near: NEAR, fog: 1 });
  const shipOnScreen = defFrame.project([0, 0, 0]), aheadOnScreen = defFrame.project(def.target);
  check('at the defaults the ship sits just below centre and the look-ahead point is dead centre',
    shipOnScreen && shipOnScreen.y > cy && shipOnScreen.y < cy + 0.15 * H && Math.abs(shipOnScreen.x - cx) < 1e-6
    && Math.abs(aheadOnScreen.x - cx) < 1e-6 && Math.abs(aheadOnScreen.y - cy) < 1e-6,
    `ship at y = ${shipOnScreen?.y.toFixed(1)} of ${H}`);
  // The work order's framing argument: the 20 nearest stars sit within ~1.7 cells, and the visible half-height at
  // the ship is ≈ D·tan 29°. Measured, not assumed: at D = 4 the lower-near rim of that ball (the part between the
  // ship and the eye) clips slightly on a landscape screen; D = 4.5 fits it whole. Guard the ≥ 99 % that holds.
  const onScreenShare = (distance, width, height) => {
    const f = Math.min(width, height) * 0.9, p = chasePose(shipBasis(0.4, 0.1), chaseOptions({ distance }), 1, { unit });
    const frame = createViewFrame({ basis: p.basis, eye: p.eye, focal: f, cx: width / 2, cy: height / 2, near: NEAR, fog: 1 });
    let on = 0, n = 0;
    while (n < 4000) {
      const q = [between(-1, 1), between(-1, 1), between(-1, 1)]; if (Math.hypot(...q) > 1) continue;
      n++; const s = frame.project(q.map(c => c * 1.7 * unit));
      if (s && s.x >= 0 && s.x <= width && s.y >= 0 && s.y <= height) on++;
    }
    return on / n;
  };
  const landscape = onScreenShare(4, 1280, 800), portrait = onScreenShare(4, 390, 844), roomier = onScreenShare(4.5, 1280, 800);
  check('the ~1.7-cell row neighbourhood reads on screen at the defaults (≥ 99 % of the ball; all of it at D = 4.5)',
    landscape >= 0.99 && portrait >= 0.99 && roomier === 1,
    `${(landscape * 100).toFixed(1)} % landscape, ${(portrait * 100).toFixed(1)} % portrait, ${(roomier * 100).toFixed(1)} % at 4.5 cells`);

  // continuity: a full yaw turn at every pitch including the clamp, and a pitch sweep through the clamp
  let finiteEverywhere = true, maxEyeStep = 0, maxBasisStep = 0;
  const sweep = (pairs) => {
    let prev = null;
    for (const [yaw, pitch] of pairs) {
      const p = chasePose(shipBasis(yaw, pitch), CHASE_DEFAULTS, 1, { unit });
      if (!finite(p.eye) || !finite(p.basis.d) || !finite(p.basis.r) || !finite(p.basis.u) || !orthonormal(p.basis)) finiteEverywhere = false;
      if (prev) {
        maxEyeStep = Math.max(maxEyeStep, dist(p.eye, prev.eye));
        maxBasisStep = Math.max(maxBasisStep, dist(p.basis.d, prev.basis.d), dist(p.basis.r, prev.basis.r), dist(p.basis.u, prev.basis.u));
      }
      prev = p;
    }
  };
  const step = 0.002;
  for (const pitch of [-1.4, -1.0, 0, 0.8, 1.4]) { const pairs = []; for (let yaw = 0; yaw <= 2 * Math.PI + step; yaw += step) pairs.push([yaw, pitch]); sweep(pairs); }
  for (const yaw of [0, 1.1, 2.9, -2.4]) { const pairs = []; for (let pitch = -1.4; pitch <= 1.4; pitch += step) pairs.push([yaw, pitch]); sweep(pairs); }
  check('the pose is finite and orthonormal through a full yaw turn at every pitch, including the ±1.4 rad clamp', finiteEverywhere);
  check('…and continuous: a 0.002-rad turn never moves the eye more than D·0.002 or the view axes more than 0.002',
    maxEyeStep <= 4 * unit * step * 1.0001 && maxBasisStep <= step * 1.0001,
    `eye ${maxEyeStep.toFixed(3)} u, axes ${maxBasisStep.toFixed(5)}`);
  check('the eye eases straight out along its line as t grows (rigid, no swing)', (() => {
    const s = shipBasis(2.0, -0.6), full = chasePose(s, CHASE_DEFAULTS, 1, { unit }).eye;
    for (let t = 0.05; t < 1; t += 0.05) {
      const e = chasePose(s, CHASE_DEFAULTS, t, { unit }).eye;
      if (dist(e, full.map(v => v * t)) > 1e-9) return false;
    }
    return true;
  })());
}

console.log('\n  Eye containment in the Hilbert cube');
{
  const lo = HILBERT_WORLD_MIN + CELL * 0.12, hi = HILBERT_WORLD_MAX - CELL * 0.12;   // HIL_CAMERA_RADIUS padding
  const boxAt = ship => ({ min: ship.map(v => lo - v), max: ship.map(v => hi - v) });
  let inside = true, onSegment = true, unobstructedFull = true, squeezed = 0;
  for (let i = 0; i < 4000; i++) {
    // ships hugging faces, edges and corners, plus some well inside
    const ship = [0, 1, 2].map(() => { const r = rand(); return r < 0.3 ? lo + between(0, 3 * CELL) : r < 0.6 ? hi - between(0, 3 * CELL) : between(lo, hi); });
    const basis = shipBasis(between(-Math.PI, Math.PI), between(-1.4, 1.4));
    const options = chaseOptions({ distance: between(0.5, 12), elevation: between(-20, 85) });
    const t = rand() < 0.3 ? between(0.05, 1) : 1;
    const free = chasePose(basis, options, t, { unit });
    const pose = chasePose(basis, options, t, { unit, box: boxAt(ship) });
    const world = pose.eye.map((v, a) => v + ship[a]);
    if (world.some(v => v < lo - 1e-6 || v > hi + 1e-6)) inside = false;
    // shortened eye = reach × free eye, reach ∈ [0, 1]
    if (!(pose.reach >= 0 && pose.reach <= 1) || dist(pose.eye, free.eye.map(v => v * pose.reach)) > 1e-6) onSegment = false;
    const freeWorld = free.eye.map((v, a) => v + ship[a]);
    const freeInside = freeWorld.every(v => v >= lo && v <= hi);
    if (freeInside && pose.reach !== 1) unobstructedFull = false;
    if (pose.reach < 1) squeezed++;
    if (!orthonormal(pose.basis)) onSegment = false;
  }
  check('the eye never leaves the padded world box — no view of the cube from outside (4,000 ships at faces/edges/corners)', inside);
  check('a shortened eye lies on the ship→eye segment (reach × the free eye), and the view stays well-formed', onSegment, `${squeezed} squeezed`);
  check('an eye with room is never shortened', unobstructedFull);
  check('a ship backed flat against a wall squeezes the eye onto itself (reach 0), no NaN', (() => {
    const ship = [lo, 5000, 5000], basis = shipBasis(Math.PI / 2, 0);   // facing +x, the wall behind at x = lo
    const pose = chasePose(basis, CHASE_DEFAULTS, 1, { unit, box: boxAt(ship) });
    return pose.reach === 0 && pose.eye.every(v => Object.is(v, 0) || Object.is(v, -0) || Math.abs(v) < 1e-12) && orthonormal(pose.basis);
  })());
  check('segmentReach: the answer is the wall crossing', Math.abs(segmentReach([200, -50, 0], { min: [-100, -100, -100], max: [100, 100, 100] }) - 0.5) < 1e-12);
}

console.log('\n  Hearing is view-independent');
{
  // The per-frame composition flight-view performs: chasePose → composeViewFrames. Hearing is handed
  // shipView.basis (bed + row-field listener positions via toAudioListenerPosition) and the lead voice's
  // setSpatial(pan, gain, octave) from shipView.project. Both must be IDENTICAL in first person, mid-V and chase.
  const FOG_NEAR = 12 * CELL * 0.4, FOG_FAR = 20 * CELL;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const mapRange = (v, a, b, c, d) => clampN((v - a) / (b - a), 0, 1) * (d - c) + c;
  const distGain = z => clampN(mapRange(z, FOG_NEAR, FOG_FAR, 1, 0.15), 0.05, 1);
  const distOctave = z => Math.min(2, Math.floor(mapRange(z, FOG_NEAR, FOG_FAR, 0, 2.99)));
  const stars = Array.from({ length: 60 }, () => [between(-3000, 3000), between(-3000, 3000), between(-3000, 3000)]);
  const heard = (ship, t, box) => {
    const pose = t > 0 ? chasePose(ship, CHASE_DEFAULTS, t, { unit, box }) : null;
    const { shipView, renderView } = composeViewFrames({ shipBasis: ship, pose, fog: t, focal, cx, cy, near: NEAR });
    const listener = stars.map(p => toAudioListenerPosition(p, shipView.basis));
    const lead = stars.map(p => { const s = shipView.project(p); return s ? [clampN((cx - s.x) / cx, -1, 1), distGain(s.z), distOctave(s.z)] : [0, 0, 0]; });
    const seen = stars.map(p => renderView.project(p));
    return { listener, lead, seen };
  };
  const identical = (a, b) => a.length === b.length && a.every((row, i) => row.every((v, j) => Object.is(v, b[i][j])));
  let allSame = true, viewMoved = false;
  for (const [yaw, pitch] of [[0, 0], [2.2, 1.4], [-1, -1.4], [0.3, 0.6]]) {
    const ship = shipBasis(yaw, pitch), box = { min: [-4000, -4000, -4000], max: [900, 4000, 4000] };
    const first = heard(ship, 0, null), mid = heard(ship, 0.37, box), full = heard(ship, 1, box);
    if (!identical(first.listener, mid.listener) || !identical(first.listener, full.listener)) allSame = false;
    if (!identical(first.lead, mid.lead) || !identical(first.lead, full.lead)) allSame = false;
    if (full.seen.some((s, i) => { const f = first.seen[i]; return (s === null) !== (f === null) || (s && f && (s.x !== f.x || s.y !== f.y)); })) viewMoved = true;
  }
  check('bed / row-field listener positions and the lead voice\'s pan · gain · octave are bit-identical in first person, mid-V and chase',
    allSame);
  check('…while what is SEEN really does move (sanity: the test would notice a no-op chase view)', viewMoved);
}

console.log('\n  Web rides and the hull');
{
  // During a ride camBasis() is the route LOOK basis; the chase eye is built from it (arrow-look swings the view),
  // while flight-view hands the ship routeCameraBasis(tangent, lift, 0, 0) as its hull — always along the route.
  let ok = true;
  for (const tangent of [[0, -1, 0], [0.05, -0.998, 0.02], [0, 1, 0], [1, 0, 0]]) {
    const t = norm(tangent), lift = norm(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [-t[0] * t[1], 1 - t[1] ** 2, -t[2] * t[1]]);
    const hull = routeCameraBasis(t, lift, 0, 0);
    if (dist(hull.d, t) > 1e-9) ok = false;
    for (const [lookYaw, lookPitch] of [[0, 0], [1.2, 0], [-2.5, 1.4], [0.4, -1.4]]) {
      const look = routeCameraBasis(t, lift, lookYaw, lookPitch);
      const pose = chasePose({ d: look.d, r: look.r, u: look.u }, CHASE_DEFAULTS, 1, { unit });
      if (!finite(pose.eye) || !orthonormal(pose.basis)) ok = false;
    }
  }
  check('straight-down and straight-up strands give a well-formed chase pose at every arrow-look, and the hull points along the tangent', ok);
}

console.log('\n  The ship (canvas only, monochrome saucer)');
{
  // A recording canvas: every fill/stroke with the style and state it was made in, every gradient's stops, and
  // every coordinate handed to a path call (all must be finite).
  const calls = [];
  let finiteCoords = true;
  const coords = (...v) => { if (!v.every(Number.isFinite)) finiteCoords = false; };
  const gradient = kind => (...v) => { coords(...v); const stops = []; calls.push({ op: 'gradient', kind, stops }); return { addColorStop: (o, c) => stops.push(c) }; };
  const ctx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', lineJoin: 'miter', lineCap: 'butt', lineWidth: 1, fillStyle: null, strokeStyle: null,
    beginPath() {}, closePath() {}, moveTo: coords, lineTo: coords, arc: coords,
    fill() { calls.push({ op: 'fill', style: this.fillStyle, alpha: this.globalAlpha, comp: this.globalCompositeOperation }); },
    stroke() { calls.push({ op: 'stroke', style: this.strokeStyle }); },
    createRadialGradient: gradient('radial'), createLinearGradient: gradient('linear'),
  };
  const length = CHASE_DEFAULTS.shipScale * unit;
  const frameFor = (ship, options = CHASE_DEFAULTS) => {
    const pose = chasePose(ship, options, 1, { unit });
    return createViewFrame({ basis: pose.basis, eye: pose.eye, focal, cx, cy, near: NEAR, fog: 1 });
  };
  const ship = shipBasis(0.6, 0.2), view = frameFor(ship);
  const draw = (extra = {}, v = view) => { calls.length = 0; return drawPlayerShip(ctx, { view: v, hull: ship, length, alpha: 1, boost: 0.5, time: 1.25, ...extra }); };
  const rgb = style => style.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const neutral = c => Math.max(...c) - Math.min(...c) <= 36;   // one cool grey family, no hue
  const lightLevels = () => calls.filter(c => c.op === 'gradient' && c.kind === 'radial' && c.stops[0].startsWith('rgba(240,246,255'))
    .map(c => Number(c.stops[0].match(/[\d.]+\)$/)[0].slice(0, -1)));

  const seen = draw();
  check(`from the default chase pose every slice of the saucer is drawn (${seen.slices}/${PLAYER_SHIP_SLICES}), the far rim lights culled (${seen.lights}/12 lit)`,
    seen.slices === PLAYER_SHIP_SLICES && seen.lights > 0 && seen.lights < 12);
  const styles = calls.filter(c => (c.op === 'fill' || c.op === 'stroke') && typeof c.style === 'string').map(c => rgb(c.style));
  const stops = calls.filter(c => c.op === 'gradient').flatMap(c => c.stops).map(rgb);
  check('steel, glass, rim lights and wake are all one neutral colour family (no hue from the music)',
    styles.length > 0 && stops.length > 0 && styles.every(neutral) && stops.every(neutral));
  check('the draw restores composite mode, alpha, line join and line cap for the picking rings that follow',
    ctx.globalCompositeOperation === 'source-over' && ctx.globalAlpha === 1 && ctx.lineJoin === 'miter' && ctx.lineCap === 'butt' && !('shadowBlur' in ctx));

  const below = draw({}, frameFor(ship, chaseOptions({ elevation: -40 })));
  check(`seen from below the saucer still draws whole (${below.slices} slices), dome first so the belly covers it`,
    below.slices === PLAYER_SHIP_SLICES && calls.findIndex(c => c.op === 'gradient' && c.kind === 'radial') < calls.findIndex(c => c.op === 'gradient' && c.kind === 'linear'));

  draw({ time: 0 }); const at0 = JSON.stringify(calls);
  draw({ time: 0 }); const again = JSON.stringify(calls);
  draw({ time: 0.37 }); const later = JSON.stringify(calls);
  check('the rim lights chase with the clock and nothing else (same time → identical draw, later time → different)', at0 === again && at0 !== later);
  draw({ boost: 0 }); const idle = lightLevels().reduce((a, b) => a + b, 0);
  draw({ boost: 1 }); const boosted = lightLevels().reduce((a, b) => a + b, 0);
  check(`boost brightens the rim lights (Σ level ${idle.toFixed(2)} → ${boosted.toFixed(2)})`, boosted > idle);

  finiteCoords = true;
  let threw = false;
  try {
    for (const [yaw, pitch] of [[0, 0], [2.1, -0.9], [-1.3, 1.2]]) for (const elevation of [-60, 0, 30, 89]) for (const distance of [0.02, 1, 4, 24])
      drawPlayerShip(ctx, { view: frameFor(shipBasis(yaw, pitch), chaseOptions({ elevation, distance })), hull: shipBasis(yaw, pitch), length, alpha: 1, boost: 1, time: 3 });
  } catch { threw = true; }
  check('every pose — below, level, overhead, and the eye squeezed onto the hull — draws with finite coordinates and never throws', !threw && finiteCoords);

  calls.length = 0;
  const none = drawPlayerShip(ctx, { view, hull: ship, length: 100, alpha: 0 });
  check('at alpha 0 (first person) nothing is drawn at all', none.slices === 0 && none.lights === 0 && calls.length === 0);
}

console.log(PASS ? '\n✓ COSMOS CHASE CAMERA OK' : '\n✗ COSMOS CHASE CAMERA FAILED');
process.exitCode = PASS ? 0 : 1;
