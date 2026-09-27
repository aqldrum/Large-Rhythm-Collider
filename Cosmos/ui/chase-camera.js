// chase-camera.js — the pure pose behind third-person flight (Cosmos/docs/COSMOS_THIRD_PERSON_WORK_ORDER_2026-09-23.md).
//
// The SHIP is the player: it keeps flight-view's camera (`cam`, `camBasis()`), and with it everything that is
// heard — which stars sound, the root, gravity, loading and unloading. This module only answers where the EYE
// goes when V pulls the view out behind the ship. It is handed the ship's basis and returns an eye position and a
// view basis; flight-view turns those into a view frame (view-frame.js) that only the renderers read.
//
//   eye    = −D·cos θ·d + D·sin θ·u     (ship-relative: behind and above, in the ship's d–u plane)
//   target = L·d                          (a point slightly ahead of the ship)
//   basis  = look-at(eye → target), with the SHIP's u as the up reference
//
// The ship's up — not world up — is the reference, so the pose stays well-formed at the ±1.4 rad pitch clamp and
// on straight-down Web rides, and the horizon behaves like the ship's. The eye follows RIGIDLY (no spring lag).
//
// Pure: no canvas, no DOM, no input, no projection. Units are supplied by the caller (`unit` = world units per
// cell), so nothing here imports the runtime.

// ONE options object for the whole order. The future visual-options panel binds to this, exactly as it will to
// CONSTELLATION_DEFAULTS; until then `window.__cosmosView.set(patch)` tunes it live.
export const CHASE_DEFAULTS = Object.freeze({
  distance: 4,      // cells from the ship to the eye. The 20 nearest stars sit within ~1.7 cells, and at this
                    //   focal length the visible half-height at the ship is ≈ D·tan 29° ≈ 2.3 cells → all fit.
  elevation: 30,    // degrees above the ship's horizon (θ). 60–75 is the steeper look-down, same mode.
  lookAhead: 1,     // cells ahead of the ship the eye aims at (L)
  transition: 0.4,  // seconds for V to ease between the cockpit and the chase view
  shipScale: 0.3,   // cells, hull length (player-ship.js)
});

// Live ranges. A patch outside them is clamped, a non-number is ignored — the dev handle should never be able
// to put the eye somewhere the pose cannot express (a negative distance, an elevation past the pole).
const RANGES = {
  distance: [0, 24], elevation: [-60, 89], lookAhead: [0, 12], transition: [0, 5], shipScale: [0.02, 3],
};

// Merge a patch into a copy of `base` (defaults when omitted), clamped to RANGES. Unknown keys are dropped.
export function chaseOptions(patch = null, base = CHASE_DEFAULTS) {
  const next = { ...base };
  if (patch) for (const key of Object.keys(RANGES)) {
    const value = patch[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [lo, hi] = RANGES[key];
    next[key] = value < lo ? lo : value > hi ? hi : value;
  }
  return next;
}

export const smoothstep = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Advance the V transition's LINEAR progress toward its target (0 = cockpit, 1 = chase) on the frame clock.
// The pose reads smoothstep(progress). A zero transition time snaps.
export function stepChaseProgress(progress, target, dt, seconds) {
  const goal = target > 0 ? 1 : 0;
  if (!(seconds > 0)) return goal;
  const step = Math.max(0, dt) / seconds;
  const next = goal > progress ? Math.min(goal, progress + step) : Math.max(goal, progress - step);
  return Math.abs(goal - next) < 1e-9 ? goal : next;   // land exactly: summed frame steps drift by an ulp or two
}

const ZERO = Object.freeze([0, 0, 0]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(a[0], a[1], a[2]);

// Largest s ∈ [0, 1] such that s·v stays inside the axis-aligned box { min, max } (ship-relative). The ship
// itself (the origin) is inside the box, so the answer shortens the ship→eye segment AT the wall it crosses.
export function segmentReach(v, box) {
  let s = 1;
  for (let axis = 0; axis < 3; axis++) {
    const component = v[axis];
    if (component > 0) s = Math.min(s, box.max[axis] / component);
    else if (component < 0) s = Math.min(s, box.min[axis] / component);
  }
  return s > 0 ? s : 0;
}

// The pose at blend t (0 = cockpit, 1 = full chase; the caller passes the EASED value).
//   shipBasis  { d, r, u } — the basis the ship flies and hears with
//   options    CHASE_DEFAULTS-shaped (cells / degrees)
//   unit       world units per cell
//   box        optional { min, max } ship-relative containment box (the Hilbert world, already padded)
// → { eye, basis, target, reach, full }:
//   eye    ship-relative eye position (the zero vector at t = 0)
//   basis  view basis; at t = 0 the ship's own basis OBJECT, so first person is untouched by construction
//   reach  fraction of the blended pull-back the box allowed (1 = unobstructed)
//   full   the unobstructed eye distance at this t, for the caller's ship-proximity fade
export function chasePose(shipBasis, options = CHASE_DEFAULTS, t = 1, { unit = 1, box = null } = {}) {
  if (!(t > 0)) return { eye: ZERO, basis: shipBasis, target: null, reach: 1, full: 0 };
  const k = t < 1 ? t : 1;
  const { d, u } = shipBasis;
  const D = options.distance * unit, L = options.lookAhead * unit;
  const theta = options.elevation * Math.PI / 180;
  const back = -D * Math.cos(theta) * k, up = D * Math.sin(theta) * k;
  let eye = [back * d[0] + up * u[0], back * d[1] + up * u[1], back * d[2] + up * u[2]];
  const reach = box ? segmentReach(eye, box) : 1;
  if (reach < 1) eye = [eye[0] * reach, eye[1] * reach, eye[2] * reach];
  const target = [L * d[0], L * d[1], L * d[2]];
  // look-at with the ship's up as reference
  let forward = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  let span = length(forward);
  if (!(span > 1e-9)) { forward = d; span = 1; }   // eye on its own target (D = L = 0): keep looking ahead
  const vd = [forward[0] / span, forward[1] / span, forward[2] / span];
  let vr = cross(u, vd), rl = length(vr);
  if (!(rl > 1e-9)) { vr = shipBasis.r; rl = 1; }   // looking straight along the ship's up: ship-right stays right
  vr = [vr[0] / rl, vr[1] / rl, vr[2] / rl];
  const vu = cross(vd, vr);
  return { eye, basis: { d: vd, r: vr, u: vu }, target, reach, full: D * k };
}
