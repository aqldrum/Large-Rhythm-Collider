// web-return.js — bounded route planning + smooth sampling for Cosmos Web travel.
//
// A Master-Network family contains every positive multiple of its base LCM. That set is infinite,
// so a return ride must never enumerate it. planFamilyGrids samples actual family members at an
// adaptive stride: nearby homes visit every node, while very distant homes stay within a fixed
// waypoint budget. The existing camera-local Web renderer fills in the visible neighbourhood as
// the camera travels.

const clamp01 = n => Math.max(0, Math.min(1, n));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function planFamilyGrids(startGrid, homeGrid, base, maxWaypoints = 96) {
  base = Math.max(2, Math.floor(base) || 0);
  maxWaypoints = Math.max(2, Math.floor(maxWaypoints) || 2);
  const homeQ = Math.max(1, Math.round(homeGrid / base));
  const startQ = Math.max(1, Math.round(startGrid / base));
  const logicalCount = Math.abs(homeQ - startQ) + 1;
  const steps = Math.min(logicalCount - 1, maxWaypoints - 1);
  if (!steps) return { grids: [homeQ * base], logicalCount, sampled: false };

  const grids = [];
  for (let i = 0; i <= steps; i++) {
    const q = Math.round(startQ + (homeQ - startQ) * (i / steps));
    const g = q * base;
    if (grids[grids.length - 1] !== g) grids.push(g);
  }
  grids[grids.length - 1] = homeQ * base; // keep the authored home exact despite rounding
  return { grids, logicalCount, sampled: logicalCount > grids.length };
}

// Shortest route through a finite Web graph (mother-scale Webs use this; MN Webs use the arithmetic
// planner above). A tiny binary heap keeps this responsive for the larger codex lineages.
export function shortestWebPath(members, edges, startGrid, homeGrid, pointOf) {
  const index = new Map(members.map((g, i) => [g, i]));
  const start = index.get(startGrid), goal = index.get(homeGrid);
  if (start == null || goal == null) return null;
  const adj = Array.from({ length: members.length }, () => []);
  for (const [a, b] of edges) {
    const w = pointOf ? dist(pointOf(members[a]), pointOf(members[b])) : 1;
    adj[a].push([b, w]); adj[b].push([a, w]);
  }
  const costs = new Float64Array(members.length); costs.fill(Infinity); costs[start] = 0;
  const prev = new Int32Array(members.length); prev.fill(-1);
  const heap = [[0, start]];
  const push = item => { let i = heap.length; heap.push(item); while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => {
    const root = heap[0], last = heap.pop();
    if (heap.length) { let i = 0; heap[0] = last; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[i][0]) break; const t = heap[i]; heap[i] = heap[c]; heap[c] = t; i = c; } }
    return root;
  };
  while (heap.length) {
    const [cost, at] = pop();
    if (cost !== costs[at]) continue;
    if (at === goal) break;
    for (const [next, weight] of adj[at]) {
      const nextCost = cost + weight;
      if (nextCost >= costs[next]) continue;
      costs[next] = nextCost; prev[next] = at; push([nextCost, next]);
    }
  }
  if (!Number.isFinite(costs[goal])) return null;
  const route = [];
  for (let at = goal; at >= 0; at = prev[at]) { route.push(members[at]); if (at === start) break; }
  return route.reverse();
}

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(i => 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t +
    (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
    (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
};

export function buildArcPath(controlPoints, subdivisions = 8) {
  if (!controlPoints || controlPoints.length < 2) throw new Error('A Web ride needs at least two points');
  subdivisions = Math.max(2, Math.floor(subdivisions) || 2);
  const points = [controlPoints[0].slice()];
  for (let i = 0; i < controlPoints.length - 1; i++) {
    const p0 = controlPoints[Math.max(0, i - 1)], p1 = controlPoints[i];
    const p2 = controlPoints[i + 1], p3 = controlPoints[Math.min(controlPoints.length - 1, i + 2)];
    for (let j = 1; j <= subdivisions; j++) points.push(catmull(p0, p1, p2, p3, j / subdivisions));
  }
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) cumulative[i] = cumulative[i - 1] + dist(points[i - 1], points[i]);
  return { points, cumulative, total: cumulative[cumulative.length - 1] };
}

export function sampleArcPath(path, progress) {
  const p = clamp01(progress), target = path.total * p, last = path.points.length - 1;
  if (target <= 0 || !path.total) return { position: path.points[0].slice(), tangent: unitDelta(path.points[0], path.points[Math.min(1, last)]) };
  if (target >= path.total) return { position: path.points[last].slice(), tangent: unitDelta(path.points[Math.max(0, last - 1)], path.points[last]) };
  let lo = 1, hi = last;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (path.cumulative[mid] < target) lo = mid + 1; else hi = mid; }
  const i = lo, a = path.points[i - 1], b = path.points[i];
  const span = path.cumulative[i] - path.cumulative[i - 1] || 1, t = (target - path.cumulative[i - 1]) / span;
  return { position: a.map((v, k) => v + (b[k] - v) * t), tangent: unitDelta(a, b) };
}

export function unitDelta(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.hypot(d[0], d[1], d[2]) || 1;
  return d.map(v => v / n);
}

// Logarithmic duration is the key far-space guarantee: a billion-node logical span is still a
// deliberate ride, not a multi-day simulation. Nearby rides remain long enough to read spatially.
export function rideDuration(logicalNodes) {
  return Math.max(8, Math.min(42, 7 + Math.log2(Math.max(2, logicalNodes)) * 2.4));
}
