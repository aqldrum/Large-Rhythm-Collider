// web-graph.js — pure proximity-graph helpers shared by the Web render worker and assertions.

export function buildWebGraph(members, cellOf, { neighbours = 3, bucketSize = 8 } = {}) {
  const n = members.length, positions = new Array(n);
  for (let i = 0; i < n; i++) positions[i] = cellOf(members[i]);
  const buckets = new Map();
  const bucketKey = (x, y, z) => (x / bucketSize | 0) + ',' + (y / bucketSize | 0) + ',' + (z / bucketSize | 0);
  for (let i = 0; i < n; i++) {
    const p = positions[i], key = bucketKey(p[0], p[1], p[2]);
    let bucket = buckets.get(key); if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(i);
  }
  const distance2 = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; };
  const edges = [], adjacency = Array.from({ length: n }, () => []), seen = new Set();
  for (let i = 0; i < n; i++) {
    const p = positions[i], bx = p[0] / bucketSize | 0, by = p[1] / bucketSize | 0, bz = p[2] / bucketSize | 0, candidates = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const bucket = buckets.get((bx + x) + ',' + (by + y) + ',' + (bz + z));
      if (bucket) for (const j of bucket) if (j !== i) candidates.push(j);
    }
    candidates.sort((a, b) => distance2(positions[a], p) - distance2(positions[b], p));
    for (let k = 0, limit = Math.min(neighbours, candidates.length); k < limit; k++) {
      const j = candidates[k], key = i < j ? i * n + j : j * n + i;
      if (seen.has(key)) continue;
      seen.add(key); const edgeIndex = edges.length;
      edges.push([i, j]); adjacency[i].push(edgeIndex); adjacency[j].push(edgeIndex);
    }
  }
  return { members, edges, adjacency };
}

export function familyMembers(grids, base) {
  const members = [];
  for (const grid of grids) if (grid % base === 0) members.push(grid);
  return members;
}
