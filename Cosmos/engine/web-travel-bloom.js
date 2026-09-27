// web-travel-bloom.js — cheap, visual-only star lookahead for Return Home travel.
//
// Route planning and abundance solving remain authoritative. These helpers only approximate how
// large an unfinished grid will eventually render, then shape that preview into a soft tube around
// the short section of route currently passing the camera.

const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => { const t = clamp01(value); return t * t * (3 - 2 * t); };

// Divisor count is known as soon as a grid is factored. Across the flight corpus, subtracting the
// four structural divisors of a small valid grid and assigning ~0.12 radius units per remainder
// tracks the solved log-abundance radius closely enough to preview its silhouette without claiming
// an exact solve. The renderer always replaces this with the real size once solving finishes.
export function approximateStarSize(divisorCount) {
  const count = Math.max(0, Number(divisorCount) || 0);
  return Math.min(5.5, Math.max(0.15, 0.15 + Math.max(0, count - 4) * 0.12));
}

// Arc-length samples keep the lit tunnel attached to curved routes. Each sample carries a strength:
// a small wake fades behind the camera, while the forward samples stay fully energized until the
// soft nose at the end of the lookahead.
export function buildTravelBloomSamples(path, progress, {
  behind = 0,
  ahead = 1,
  samples = 12,
  samplePath,
} = {}) {
  if (!path || !(path.total > 0) || typeof samplePath !== 'function') return [];
  const count = Math.max(2, Math.floor(samples) || 2);
  const at = clamp01(progress);
  const startDistance = Math.max(0, at * path.total - Math.max(0, behind));
  const endDistance = Math.min(path.total, at * path.total + Math.max(0, ahead));
  const span = endDistance - startDistance;
  if (!(span > 0)) return [{ position: samplePath(path, at).position, strength: 1 }];

  const currentDistance = at * path.total;
  const result = [];
  for (let i = 0; i < count; i++) {
    const distance = startDistance + span * (i / (count - 1));
    const routeProgress = clamp01(distance / path.total);
    let strength;
    if (distance < currentDistance && behind > 0) strength = smoothstep((distance - startDistance) / Math.max(1e-6, currentDistance - startDistance));
    else {
      const forward = Math.max(0, distance - currentDistance) / Math.max(1e-6, ahead);
      strength = 1 - smoothstep(Math.max(0, (forward - 0.72) / 0.28));
    }
    result.push({ position: samplePath(path, routeProgress).position, strength });
  }
  return result;
}

// Return the strongest nearby sample. Squaring the smooth radial falloff makes the core bright and
// leaves a broad, quiet edge rather than a hard cylinder wall.
export function travelBloomWeight(point, samples, radius) {
  if (!point || !samples?.length || !(radius > 0)) return 0;
  let strongest = 0;
  for (const sample of samples) {
    const dx = point[0] - sample.position[0], dy = point[1] - sample.position[1], dz = point[2] - sample.position[2];
    const radial = 1 - Math.hypot(dx, dy, dz) / radius;
    if (radial <= 0) continue;
    const weight = smoothstep(radial) * Math.max(0, sample.strength || 0);
    if (weight > strongest) strongest = weight;
  }
  return clamp01(strongest);
}
