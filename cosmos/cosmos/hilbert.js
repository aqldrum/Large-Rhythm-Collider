// hilbert.js — 3D Hilbert space-filling curve (Skilling 2004), for the "cube" placement mode.
//
// A grid integer g is treated as the Hilbert INDEX; hilbertDecode(g) → its [x,y,z] lattice cell.
// Consecutive grids land in adjacent cells (Hilbert locality), so the 1D codex line snakes through
// a 3D cube filling it in all directions. hilbertEncode inverts it, so from a camera cell we can
// recover which grids live nearby (true 3D-proximity spawn).
//
// BITS = 10 → 8^10 = 2^30 ≈ 1.07e9 indices, cells in [0,1024)³. All intermediate values stay under
// 2^31 so plain 32-bit bit-ops are exact (no BigInt needed). Grids beyond 2^30 are clamped — far
// past any real codex use (12T saturates ~100K; exploration stays well under a billion).

export const BITS = 8;
export const SIDE = 1 << BITS;          // 1024 cells per axis
const MAXI = (1 << (3 * BITS - 1)) * 2 - 1 + 1; // 2^30, exclusive index ceiling (built without 1<<31)
const MASK = SIDE - 1;

// ── Skilling's in-place transforms on the transpose array X[0..2] ──
function transposeToAxes(X) {           // Hilbert transpose → geometric axes
  const N = 2 << (BITS - 1);            // = 2^BITS = SIDE
  let t = X[2] >> 1;
  X[2] ^= X[1]; X[1] ^= X[0]; X[0] ^= t;   // Gray decode
  for (let Q = 2; Q !== N; Q <<= 1) {       // undo excess work
    const P = Q - 1;
    for (let i = 2; i >= 0; i--) {
      if (X[i] & Q) X[0] ^= P;
      else { t = (X[0] ^ X[i]) & P; X[0] ^= t; X[i] ^= t; }
    }
  }
}
function axesToTranspose(X) {            // geometric axes → Hilbert transpose
  const M = SIDE >> 1;                  // 1 << (BITS-1)
  for (let Q = M; Q > 1; Q >>= 1) {     // inverse undo
    const P = Q - 1;
    for (let i = 0; i < 3; i++) {
      if (X[i] & Q) X[0] ^= P;
      else { const t = (X[0] ^ X[i]) & P; X[0] ^= t; X[i] ^= t; }
    }
  }
  X[1] ^= X[0]; X[2] ^= X[1];           // Gray encode
  let t = 0;
  for (let Q = M; Q > 1; Q >>= 1) if (X[2] & Q) t ^= Q - 1;
  X[0] ^= t; X[1] ^= t; X[2] ^= t;
}

// ── index ⇄ interleaved transpose (bit i of X[a] ↔ index bit (i*3 + (2-a))) ──
function indexToTranspose(index) {
  const X = [0, 0, 0];
  for (let k = 0; k < BITS; k++)
    for (let a = 0; a < 3; a++)
      X[a] |= ((index >> (k * 3 + (2 - a))) & 1) << k;
  return X;
}
function transposeToIndex(X) {
  let index = 0;
  for (let k = 0; k < BITS; k++)
    for (let a = 0; a < 3; a++)
      index += ((X[a] >> k) & 1) * (2 ** (k * 3 + (2 - a)));
  return index;
}

export function hilbertDecode(index) {  // index → [x,y,z]
  let i = index | 0; if (i < 0) i = 0; if (i >= MAXI) i = MAXI - 1;
  const X = indexToTranspose(i);
  transposeToAxes(X);
  return X;
}
export function hilbertEncode(x, y, z) { // [x,y,z] → index
  const X = [x & MASK, y & MASK, z & MASK];
  axesToTranspose(X);
  return transposeToIndex(X);
}

// Grid indices whose cells lie within a sphere of `radius` cells around camCell — the 3D-proximity
// frontier. Returns a flat array of candidate grid integers (caller filters validity).
export function neighborGrids(camCell, radius) {
  const [cx, cy, cz] = camCell, out = [], r2 = radius * radius;
  for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx; if (x < 0 || x >= SIDE) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy; if (y < 0 || y >= SIDE) continue;
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        const z = cz + dz; if (z < 0 || z >= SIDE) continue;
        out.push(hilbertEncode(x, y, z));
      }
    }
  }
  return out;
}
