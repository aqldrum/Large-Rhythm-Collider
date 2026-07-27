// hilbert-boundary.js — one source of truth for the physical extent of the Hilbert lattice.
//
// Hilbert cells are centred at integer multiples of CELL. The enclosing walls therefore sit half a
// cell beyond the first/last centres. Keeping this geometry separate from flight-view lets movement,
// rendering, and headless assertions agree without coupling the codec to canvas concerns.

import { hilbertEncode, SIDE } from './hilbert.js';
import { CELL } from './spine.js';

export const HILBERT_WORLD_MIN = -CELL * 0.5;
export const HILBERT_WORLD_MAX = (SIDE - 0.5) * CELL;
export const HILBERT_WORLD_SIZE = SIDE * CELL;

export function clampHilbertWorld(position, padding = 0) {
  const lo = HILBERT_WORLD_MIN + Math.max(0, padding);
  const hi = HILBERT_WORLD_MAX - Math.max(0, padding);
  return position.map(value => Math.max(lo, Math.min(hi, value)));
}

export function rebaseHilbertCamera(position, padding = 0) {
  const clamped = clampHilbertWorld(position, padding);
  const cell = clamped.map(value => Math.max(0, Math.min(SIDE - 1, Math.round(value / CELL))));
  return {
    position: clamped,
    cell,
    anchor: hilbertEncode(cell[0], cell[1], cell[2]),
    off: clamped.map((value, axis) => value - cell[axis] * CELL),
  };
}

// Only return faces close enough to matter. The renderer can draw small camera-local patches for
// these descriptors instead of ever constructing the six enormous SIDE x SIDE walls.
export function nearbyHilbertWalls(position, revealDistance) {
  const walls = [];
  for (let axis = 0; axis < 3; axis++) {
    const lowDistance = position[axis] - HILBERT_WORLD_MIN;
    const highDistance = HILBERT_WORLD_MAX - position[axis];
    if (lowDistance <= revealDistance) walls.push({ axis, side: -1, plane: HILBERT_WORLD_MIN, distance: Math.max(0, lowDistance) });
    if (highDistance <= revealDistance) walls.push({ axis, side: 1, plane: HILBERT_WORLD_MAX, distance: Math.max(0, highDistance) });
  }
  return walls;
}
