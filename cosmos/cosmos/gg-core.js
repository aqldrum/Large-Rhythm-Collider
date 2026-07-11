// gg-core.js — faithful port of the Grid Gravity clustering core (borders.js:
// computeDistrictSystemImpl). Pure: given nodes [{grid, abundance}] sorted ascending by grid,
// returns each grid's immediate district anchor (its connector target) plus the district tree.
//
// Reach is in INDEX units: reach_i = round(abundance_i * reachScale). A node reaches
// ±reach positions in the sorted valid-grid list. Roots are local abundance maxima; the
// verify/promote loop guarantees no district center sits under a higher-abundance zone.

export function computeReach(nodes, reachScale, useLog = false) {
  const total = nodes.length, LN2 = Math.log(2);
  nodes.forEach((n, i) => {
    n.order = i; n.baseIndex = i;
    const base = useLog ? Math.log(n.abundance + 1) / LN2 : n.abundance;
    const reach = Math.max(1, Math.round(base * reachScale));
    n.reach = reach;
    n.intervalStart = Math.max(0, i - reach);
    n.intervalEnd = Math.min(total - 1, i + reach);
    const idxs = [];
    for (let k = n.intervalStart; k <= n.intervalEnd; k++) idxs.push(k);
    n.intervalIndices = idxs;
  });
}

// Returns { roots, anchorOf: Map(grid -> anchorGrid|null), districtOf: Map(grid -> centerGrid) }
export function computeDistricts(nodesIn, reachScale, useLog = false) {
  const nodes = nodesIn.map(n => ({ grid: n.grid, abundance: n.abundance }));
  const total = nodes.length;
  if (!total) return { roots: [], anchorOf: new Map(), districtOf: new Map() };
  computeReach(nodes, reachScale, useLog);

  const sortedByAb = nodes.slice().sort((a, b) =>
    b.abundance - a.abundance || a.grid - b.grid || a.order - b.order);
  const hasHigh = sortedByAb.some(n => n.abundance > 1);
  const highAb = sortedByAb.filter(n => n.abundance > 1);

  const roots = [];
  const centerAssigned = new Set();
  let rootAssignments = new Array(total).fill(null);

  const makeDistrict = (center, parent, level) => ({
    center, centerIndex: center.baseIndex, level, parent: parent || null, children: [],
    candidateIndices: center.intervalIndices.slice(), assignedIndices: [], assignedSet: new Set(),
    availableSet: new Set(),
  });

  const recomputeRootAssignments = () => {
    const assignment = new Array(total).fill(null);
    const distance = new Array(total).fill(Infinity);
    for (const root of roots) {
      const cg = root.center.grid;
      for (const idx of root.candidateIndices) {
        if (idx < 0 || idx >= total) continue;
        const d = Math.abs(nodes[idx].grid - cg), cur = assignment[idx];
        if (d < distance[idx] || (d === distance[idx] && (
          root.center.abundance > (cur ? cur.center.abundance : -Infinity) ||
          (cur && root.center.abundance === cur.center.abundance && root.center.grid < cur.center.grid)))) {
          assignment[idx] = root; distance[idx] = d;
        }
      }
    }
    for (const root of roots) root.assignedIndices = [];
    assignment.forEach((r, idx) => { if (r) r.assignedIndices.push(idx); });
    for (const root of roots) {
      root.assignedIndices.sort((a, b) => a - b);
      root.assignedSet = new Set(root.assignedIndices);
    }
    return assignment;
  };

  const verifyAndCorrect = () => {
    let it = 0;
    while (it++ < 50) {
      let corrected = false;
      for (let i = 0; i < roots.length; i++) {
        const root = roots[i];
        let maxAb = root.center.abundance, champ = null;
        for (const idx of root.assignedIndices) {
          const n = nodes[idx];
          if (n.abundance > maxAb && !centerAssigned.has(n)) { maxAb = n.abundance; champ = n; }
        }
        if (champ) {
          corrected = true;
          roots.splice(i, 1); centerAssigned.delete(root.center);
          const nr = makeDistrict(champ, null, 0);
          roots.push(nr); centerAssigned.add(champ);
          rootAssignments = recomputeRootAssignments();
          break;
        }
      }
      if (!corrected) break;
    }
  };

  // PHASE 1: roots = abundance maxima not already covered by a bigger root's reach
  for (const node of sortedByAb) {
    const idx = node.baseIndex;
    if (centerAssigned.has(node) || !node.intervalIndices.length) continue;
    if (rootAssignments[idx]) continue;
    if (hasHigh && node.abundance <= 1) continue;
    const root = makeDistrict(node, null, 0);
    roots.push(root); centerAssigned.add(node);
    rootAssignments = recomputeRootAssignments();
    verifyAndCorrect();
  }
  rootAssignments = recomputeRootAssignments();

  const deep = rootAssignments.slice();          // deepest district claiming each index
  const parentCenterGrid = new Map();            // centerGrid -> its parent center grid

  // PHASE 2: recursive subdistricts (higher-abundance nodes claim reach ∩ available)
  const constructSub = (parent) => {
    parent.availableSet = new Set(parent.assignedIndices);
    parent.availableSet.delete(parent.centerIndex);
    parent.children = [];
    if (!parent.assignedIndices.length) return;
    const pMin = parent.assignedIndices[0], pMax = parent.assignedIndices[parent.assignedIndices.length - 1];
    for (const node of highAb) {
      if (centerAssigned.has(node) || !node.intervalIndices.length) continue;
      const idx = node.baseIndex;
      if (idx < pMin || idx > pMax || !parent.availableSet.has(idx)) continue;
      const cand = node.intervalIndices.filter(i => parent.availableSet.has(i));
      if (!cand.length) continue;
      const child = makeDistrict(node, parent, parent.level + 1);
      child.assignedIndices = cand.slice().sort((a, b) => a - b);
      parent.children.push(child); centerAssigned.add(node);
      parentCenterGrid.set(node.grid, parent.center.grid);
      for (const i of cand) { parent.availableSet.delete(i); deep[i] = child; }
      if (child.assignedIndices.length > 1) constructSub(child);
    }
  };
  for (const root of roots) constructSub(root);

  // PHASE 3 / straggler sweep: any unassigned index → nearest root by grid value
  for (let idx = 0; idx < total; idx++) {
    if (deep[idx]) continue;
    let nearest = null, best = Infinity;
    for (const root of roots) {
      const d = Math.abs(nodes[idx].grid - root.center.grid);
      if (d < best) { best = d; nearest = root; }
    }
    if (nearest) deep[idx] = nearest;
  }

  // Resolve each grid's immediate anchor (connector target):
  //  - a member zone anchors to the center of the deepest district holding it
  //  - a district center anchors to its parent district's center (null for a root)
  const anchorOf = new Map(), districtOf = new Map();
  for (let idx = 0; idx < total; idx++) {
    const g = nodes[idx].grid, d = deep[idx];
    districtOf.set(g, d ? d.center.grid : null);
    if (d && d.center.grid === g) {
      anchorOf.set(g, d.parent ? d.parent.center.grid : (parentCenterGrid.has(g) ? parentCenterGrid.get(g) : null));
    } else {
      anchorOf.set(g, d ? d.center.grid : null);
    }
  }
  return { roots, anchorOf, districtOf, nodes };
}
