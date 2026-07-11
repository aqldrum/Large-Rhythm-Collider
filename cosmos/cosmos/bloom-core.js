// bloom-core.js — the Bloom tab's layout, factored out so Flight can render the SAME cardinality-
// sphere point cloud per near star (no rebuild). Given a grid's tuning systems (one entry per
// system: cardinality + a `dense` flag), it places one point per system on a Fibonacci lattice over
// a sphere whose radius grows with cardinality — identical to grid-3d.js.
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));   // golden angle
const RMIN = 1, GAP = 1;                               // inner radius + per-cardinality spacing
export const cardColor = c => `hsl(${40 + Math.max(0, Math.min(1, (c - 2) / 22)) * 268} 72% 62%)`;
export const CHARTED = '#00ff88';   // "charted / known in the codex" = the site's house accent (--hud-accent)

// systems: [{ c, dense }] → local 3D points [{ x, y, z, col, dense }] (bloom-centre-relative).
// `scale` = world units per radius step. Colour is precomputed per point (avoids per-frame work).
export function layoutBloom(systems, scale) {
  const byC = new Map();
  for (const s of systems) { let a = byC.get(s.c); if (!a) byC.set(s.c, a = []); a.push(s); }
  const cards = [...byC.keys()].sort((a, b) => a - b), cmin = cards[0] ?? 2;
  const pts = [];
  for (const c of cards) {
    const arr = byC.get(c), n = arr.length, R = scale * (RMIN + (c - cmin) * GAP), col = cardColor(c);
    for (let idx = 0; idx < n; idx++) {
      const y = 1 - (idx + 0.5) / n * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), ang = idx * GOLDEN;
      pts.push({ x: Math.cos(ang) * rr * R, y: y * R, z: Math.sin(ang) * rr * R, col, dense: !!arr[idx].dense });
    }
  }
  return pts;
}
