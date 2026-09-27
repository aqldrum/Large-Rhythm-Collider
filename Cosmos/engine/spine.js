// spine.js — integer-spine coordinates + continuous-attractor motion.
//
// Coarse coordinate = the grid integer itself (exact); fine coordinate = a small float
// offset relative to a zone's current parent center. We NEVER form a giant absolute float:
// render/relative positions always come from INTEGER grid differences first, then scaled —
// so precision never degrades no matter how far out (grid in the millions) you fly.
//
// A zone stores { parentGrid, off (rel to parent backbone), vel }. Reparenting rewrites off
// so the absolute position and velocity are preserved exactly → motion stays C1-continuous.

import { hilbertDecode } from './hilbert.js';

export const SPACING = 10;        // world units per grid step ALONG the spine (the codex line)
export const CELL = 340;          // world units per Hilbert lattice cell (cube placement mode)

// Placement mode: 'spine' = the codex is a 1D line you fly down (transverse ball scatter);
// 'hilbert' = the codex snakes through a 3D CUBE (every grid at its Hilbert cell). Same Grid-Gravity
// math underneath — only where a grid SITS changes. Default 'spine' (asserts assume it).
let MODE = 'spine';
export function setPlacement(m) { MODE = (m === 'hilbert') ? 'hilbert' : 'spine'; }
export function getPlacement() { return MODE; }

// Integer lattice cell of a grid (EXACT integers → differences stay precise even at grid=millions).
// spine: [grid,0,0] scaled by SPACING (one unbounded axis, integer-diff precise).
// hilbert: hilbertDecode(grid) scaled by CELL (three bounded small-int axes → trivially precise).
export function macroCell(grid) {
  return MODE === 'hilbert' ? hilbertDecode(grid) : [grid, 0, 0];
}
export function macroScale() { return MODE === 'hilbert' ? CELL : SPACING; }
// Transverse structure: instead of a thin SHELL (old HASH_AMP put every grid at one fixed
// radius → you saw the skin of a pipe), grids now fill a solid BALL of this radius, and the
// ball's center snakes off the straight axis so the whole thing is a fat wandering rope you
// fly INSIDE — not a thread you watch from outside.
export const COIL_R = 2600;        // radius of the filled star-ball around each spine point (girth)
// Axis wander: DISABLED (0) for now. When >0 the rope snakes off the straight X line, but because
// the camera rides that centerline (renderPosCam subtracts spineCenter(camGrid)) a fixed heading
// swims/spirals as you advance. Re-enable only alongside a tangent-following camera. Straight rope
// + filled ball + fog already gives the immersive volume without the spiral.
export const PRECESS_AMP = 0;      // how far the rope's axis wanders off the straight X line
export const PRECESS_FREQ = 0.011; // radians of wander per grid-step (slow → a gentle snake)
const GA1 = 2.399963229728653;    // golden angle → longitude of the ball point
const PHI  = 0.6180339887498949;  // low-discrepancy fraction → radius fill
const PSI  = 0.7548776662466927;  // 2nd low-discrepancy fraction → latitude fill
const fract = x => x - Math.floor(x);

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = a => Math.hypot(a[0], a[1], a[2]);

// Smooth macro centerline offset (transverse only — the along-axis is the exact integer spine).
// Both the zones and the flying camera ride this, so advancing the camera keeps it inside the
// rope automatically. It's a slow analytic term, NOT per-grid hash, so it stays f64-precise.
export function spineCenter(grid) {
  const w = grid * PRECESS_FREQ;
  return [0, PRECESS_AMP * Math.sin(w), PRECESS_AMP * Math.cos(w)];
}

// Deterministic transverse position of a grid: a low-discrepancy point uniformly filling a BALL
// of radius COIL_R (cbrt(u) → uniform by volume, not clumped at the surface), offset by the
// snaking centerline. Magnitude is bounded (≤ COIL_R + PRECESS_AMP) so the integer-spine f32
// precision proof still holds — only the along-axis (g·SPACING) is unbounded.
export function backboneHash(grid) {
  // spine: a big filled ball (COIL_R) is the whole local scatter. hilbert: grids already fill the
  // cube by cell, so this is just a small sub-cell jitter to break the perfect lattice.
  const R = MODE === 'hilbert' ? CELL * 0.32 : COIL_R;
  const r = R * Math.cbrt(fract(grid * PHI));         // radius, uniform by volume
  const zc = fract(grid * PSI) * 2 - 1;              // cos(latitude), uniform in [-1,1]
  const s = Math.sqrt(Math.max(0, 1 - zc * zc));
  const a = grid * GA1;                              // longitude (golden angle → even spread)
  return [r * s * Math.cos(a), r * zc, r * s * Math.sin(a)];
}

// Vector from grid gB's backbone to grid gA's backbone. The coarse term uses the EXACT integer
// difference (gA-gB) before scaling — so it stays small and precise even for huge grids.
export function backboneDelta(gA, gB) {
  const cA = macroCell(gA), cB = macroCell(gB), s = macroScale(); // integer cells → exact diff
  const hA = backboneHash(gA), hB = backboneHash(gB);
  return [(cA[0] - cB[0]) * s + (hA[0] - hB[0]),
          (cA[1] - cB[1]) * s + (hA[1] - hB[1]),
          (cA[2] - cB[2]) * s + (hA[2] - hB[2])];
}

// Absolute position relative to a fixed reference grid G0 (f64-exact for continuity checks).
export function absolutePos(zone, G0 = 0) {
  return add(backboneDelta(zone.parentGrid, G0), zone.off);
}

// Render position relative to the camera (integer-spine: precise even at grid = millions).
// If f32 is true, simulate GPU single precision on the final small coordinate.
export function renderPos(zone, cameraGrid, cameraOff = [0, 0, 0], f32 = false) {
  const p = sub(add(backboneDelta(zone.parentGrid, cameraGrid), zone.off), cameraOff);
  return f32 ? p.map(Math.fround) : p;
}

// Render relative to a SMOOTH camera that rides the spine (no per-grid hash wobble on the
// camera side — only zones carry the hash scatter). This is what a flying camera uses so that
// advancing the camera's grid is a straight line, not a spiral. Still integer-diff precise.
export function renderPosCam(zone, camGrid, camOff = [0, 0, 0], f32 = false) {
  const c = macroCell(zone.parentGrid), cc = macroCell(camGrid), s = macroScale();
  const h = backboneHash(zone.parentGrid);           // integer cell diff → precise at any scale
  const p = [ (c[0] - cc[0]) * s + h[0] + zone.off[0] - camOff[0],
              (c[1] - cc[1]) * s + h[1] + zone.off[1] - camOff[1],
              (c[2] - cc[2]) * s + h[2] + zone.off[2] - camOff[2] ];
  return f32 ? p.map(Math.fround) : p;
}

// Reparent WITHOUT moving the zone: rewrite off so backbone(new)+off' == backbone(old)+off,
// and leave velocity untouched. Absolute position and velocity are both preserved → C1.
export function reparent(zone, newParentGrid) {
  if (newParentGrid === zone.parentGrid) return;
  zone.off = add(backboneDelta(zone.parentGrid, newParentGrid), zone.off); // = (old-new)*spacing + off
  zone.parentGrid = newParentGrid;
  // zone.vel unchanged (suns are static → local velocity == absolute velocity)
}

// Deterministic 3D slot direction for a grid (low-discrepancy sphere point) → each zone gets a
// stable spot in its district's puff, and rotateY spins the whole puff rigidly on the clock.
export function slotDirection(grid) {
  const z = ((grid * 0.6180339887498949) % 1) * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z)), a = grid * GA1;
  return [r * Math.cos(a), z, r * Math.sin(a)];
}
export function rotateY(v, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

// One attractor step. With params.target, critically-damped spring toward a 3D point in the
// parent's frame (the district slot). Otherwise the legacy radius+orbit behaviour. Pure → C1.
export function stepAttractor(zone, dt, params = {}) {
  if (params.target) {
    const t = params.target, k = params.k ?? 3, damping = params.damping ?? 3.4;
    for (let i = 0; i < 3; i++) {
      const acc = k * (t[i] - zone.off[i]) - damping * zone.vel[i];
      zone.vel[i] += acc * dt; zone.off[i] += zone.vel[i] * dt;
    }
    return;
  }
  const { k = 3.0, damping = 0.6, orbit = 1.4, restRadius = 0 } = params;
  const r = len(zone.off) || 1e-9;
  const radial = scale(zone.off, 1 / r);                 // unit outward
  const springMag = -k * (r - restRadius);               // pull toward rest radius
  // tangential direction: cross(radial, up) then re-orthogonalize (cheap orbit)
  const up = Math.abs(radial[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let tang = [radial[1] * up[2] - radial[2] * up[1], radial[2] * up[0] - radial[0] * up[2], radial[0] * up[1] - radial[1] * up[0]];
  const tl = len(tang) || 1e-9; tang = scale(tang, 1 / tl);
  let acc = add(scale(radial, springMag), scale(tang, orbit));
  acc = add(acc, scale(zone.vel, -damping));
  zone.vel = add(zone.vel, scale(acc, dt));
  zone.off = add(zone.off, scale(zone.vel, dt));
}

export { add, sub, scale, len };
