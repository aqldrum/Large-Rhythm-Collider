// web-render-worker.js — the complete Cosmos Web pipeline off the UI thread:
// membership filtering, kNN graph builds, progressive reveal, projection, hit testing, drawing,
// and Return Home route planning. The flight loop only sends camera frames + zone deltas and consumes
// tiny hover/count snapshots.
import { setPlacement, macroCell, macroScale, backboneHash, CELL } from './spine.js';
import { hilbertEncode, SIDE } from './hilbert.js';
import { buildWebGraph, familyMembers } from './web-graph.js';
import { planFamilyGrids, monotonicWebPath, shortestWebPath, buildArcPath, unitDelta, rideDuration } from './web-return.js';

const WEB_K = 3, WEB_BUCKET = 8, WEB_LINE_W = 2, WEB_STRAND_A = 0.3, WEB_HIT = 9;
const WEB_REVEAL_FRAC = 0.75, WEB_ROUTE_MAX = 96, WEB_ROUTE_SUBDIV = 8, MN_REFRESH_MS = 200;
const WEB_ROUTE_HOP_CELLS = 8, WEB_TUBE_CHOICES = 6, WEB_TUBE_RADIUS_MAX = 36;
const WEB_ROUTE_CAMERA_EPS = 0.001;
const webs = new Map(), zoneGrids = new Set();
let canvas = null, ctx = null, W = 0, H = 0, dpr = 1, placement = 'hilbert';
let selectedId = null, routePath = null, zonesDirty = true, lastDynamicBuild = -Infinity;

const gridAbsolute = grid => {
  const c = macroCell(grid), scale = macroScale(), h = backboneHash(grid);
  return [c[0] * scale + h[0], c[1] * scale + h[1], c[2] * scale + h[2]];
};
const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function rebuild(web) {
  const members = web.dynamic ? familyMembers(zoneGrids, web.base) : web.sourceMembers;
  const graph = buildWebGraph(members, macroCell, { neighbours: WEB_K, bucketSize: WEB_BUCKET });
  web.members = members; web.edges = graph.edges; web.adj = graph.adjacency;
  if (!web.dynamic) {
    web.revealedIdx = new Set(); web.liveEdges = [];
    const sourceIndex = members.indexOf(web.homeGrid); if (sourceIndex >= 0) web.revealedIdx.add(sourceIndex);
  }
}

function rebuildDynamic(now) {
  if (!zonesDirty || now - lastDynamicBuild < MN_REFRESH_MS) return;
  for (const web of webs.values()) if (web.dynamic) rebuild(web);
  zonesDirty = false; lastDynamicBuild = now;
}

function pointSegmentDistance2(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / denominator)) : 0;
  const x = a.x + dx * t, y = a.y + dy * t;
  return { d2: (px - x) ** 2 + (py - y) ** 2, x, y };
}

function render(frame) {
  if (!ctx) return { hover: null, counts: [] };
  rebuildDynamic(frame.now);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const scale = macroScale(), camCell = macroCell(frame.anchor);
  const gridRelative = grid => {
    const c = macroCell(grid), h = backboneHash(grid);
    return [(c[0] - camCell[0]) * scale + h[0] - frame.off[0],
            (c[1] - camCell[1]) * scale + h[1] - frame.off[1],
            (c[2] - camCell[2]) * scale + h[2] - frame.off[2]];
  };
  const toView = point => {
    const x = dot(point, frame.r), y = dot(point, frame.u), z = dot(point, frame.d);
    return { x, y, z };
  };
  const projectView = view => {
    const { x, y, z } = view;
    if (z <= 5) return null;
    return { x: frame.cx + x * frame.focal / z, y: frame.cy - y * frame.focal / z, z };
  };
  const projectRouteView = view => {
    const x = frame.cx + view.x * frame.focal / view.z, y = frame.cy - view.y * frame.focal / view.z;
    // The camera-plane intersection can project extremely far off-canvas. Keep that endpoint well
    // outside the viewport but numerically tame so Canvas reliably clips the line at its own edge.
    const dx = x - frame.cx, dy = y - frame.cy;
    const shrink = Math.max(1, Math.abs(dx) / Math.max(1, W * 2), Math.abs(dy) / Math.max(1, H * 2));
    return { x: frame.cx + dx / shrink, y: frame.cy + dy / shrink, z: view.z };
  };
  const toScreen = point => projectView(toView(point));
  const fogAt = z => Math.max(0, Math.min(1, 1 - (z - frame.fogNear) / (frame.fogFar - frame.fogNear)));
  const revealR2 = (frame.fogFar * WEB_REVEAL_FRAC) ** 2;
  const tailR2 = (frame.fogFar * frame.tailFrac) ** 2, tailKnee = tailR2 * 0.49;
  const distance2 = point => point[0] ** 2 + point[1] ** 2 + point[2] ** 2;
  const tailFade = value => value <= tailKnee ? 1 : Math.max(0, (tailR2 - value) / (tailR2 - tailKnee));
  let hover = null, pickD2 = WEB_HIT * WEB_HIT;

  const drawEdge = (web, aGrid, bGrid) => {
    const ar = gridRelative(aGrid), br = gridRelative(bGrid), ad = distance2(ar), bd = distance2(br);
    if (ad > tailR2 && bd > tailR2) return;
    const a = toScreen(ar), b = toScreen(br); if (!a || !b) return;
    const fade = Math.min(fogAt(a.z), fogAt(b.z)) * Math.min(tailFade(ad), tailFade(bd)); if (fade <= 0) return;
    const selected = selectedId === web.tag;
    ctx.lineWidth = selected ? WEB_LINE_W * 1.8 : WEB_LINE_W;
    ctx.globalAlpha = (selected ? 0.68 : WEB_STRAND_A) * fade;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (frame.mouseX >= 0) {
      const hit = pointSegmentDistance2(frame.mouseX, frame.mouseY, a, b);
      if (hit.d2 < pickD2) { pickD2 = hit.d2; hover = { kind: 'web', webId: web.tag, x: hit.x, y: hit.y, r: 2 }; }
    }
  };
  const drawBead = (web, grid) => {
    const relative = gridRelative(grid), d2 = distance2(relative); if (d2 > tailR2) return;
    const screen = toScreen(relative); if (!screen) return;
    const fade = fogAt(screen.z) * tailFade(d2); if (fade <= 0) return;
    const selected = selectedId === web.tag;
    ctx.globalAlpha = (selected ? 0.88 : 0.6) * fade;
    ctx.beginPath(); ctx.arc(screen.x, screen.y, WEB_LINE_W * (selected ? 1.55 : 1.1), 0, 7); ctx.fill();
    web.visibleNodes++;
  };

  for (const web of webs.values()) {
    web.visibleNodes = 0;
    if (!web.visible || !web.members) continue;
    // The selected Web enters a frozen travel mode. Its camera-local graph would lag a fast ride,
    // so only the immutable route below is rendered until arrival or cancellation.
    if (routePath?.webId === web.tag) continue;
    ctx.strokeStyle = web.color; ctx.fillStyle = web.color; ctx.lineCap = 'round';
    if (web.dynamic) {
      for (const [a, b] of web.edges) drawEdge(web, web.members[a], web.members[b]);
      for (const grid of web.members) drawBead(web, grid);
      continue;
    }
    for (let i = 0; i < web.members.length; i++) {
      if (web.revealedIdx.has(i)) continue;
      const rp = gridRelative(web.members[i]);
      if (distance2(rp) < revealR2) {
        web.revealedIdx.add(i);
        for (const edgeIndex of web.adj[i]) {
          const edge = web.edges[edgeIndex];
          if (web.revealedIdx.has(edge[0]) && web.revealedIdx.has(edge[1])) web.liveEdges.push(edgeIndex);
        }
      }
    }
    for (const edgeIndex of web.liveEdges) { const edge = web.edges[edgeIndex]; drawEdge(web, web.members[edge[0]], web.members[edge[1]]); }
    for (const index of web.revealedIdx) drawBead(web, web.members[index]);
  }

  if (routePath) {
    const cameraAbsolute = [camCell[0] * scale + frame.off[0], camCell[1] * scale + frame.off[1], camCell[2] * scale + frame.off[2]];
    const web = webs.get(routePath.webId), points = [...routePath.path.points, routePath.homePoint];
    if (web) {
      ctx.strokeStyle = web.color; ctx.lineWidth = WEB_LINE_W * 2.2; ctx.lineCap = 'round';
      let previousView = null;
      for (const point of points) {
        const relative = [point[0] - cameraAbsolute[0], point[1] - cameraAbsolute[1], point[2] - cameraAbsolute[2]];
        const view = toView(relative);
        if (previousView && (previousView.z > WEB_ROUTE_CAMERA_EPS || view.z > WEB_ROUTE_CAMERA_EPS)) {
          let a = previousView, b = view;
          // Travel strands persist to the camera itself, rather than using the normal 5-unit render
          // plane. The current grid-to-grid leg therefore runs offscreen until its next node is
          // reached, and only disappears once the whole sampled section has passed behind.
          if (a.z <= WEB_ROUTE_CAMERA_EPS || b.z <= WEB_ROUTE_CAMERA_EPS) {
            const clipZ = WEB_ROUTE_CAMERA_EPS * 1.01, t = (clipZ - a.z) / (b.z - a.z);
            const clipped = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: clipZ };
            if (a.z <= WEB_ROUTE_CAMERA_EPS) a = clipped; else b = clipped;
          }
          const as = projectRouteView(a), bs = projectRouteView(b);
          if (as && bs) {
            // A segment remains readable while either endpoint is within fog; it disappears only
            // once both ends are behind the player or beyond the forward visibility envelope.
            const fade = Math.max(fogAt(as.z), fogAt(bs.z));
            if (fade > 0) { ctx.globalAlpha = 0.76 * fade; ctx.beginPath(); ctx.moveTo(as.x, as.y); ctx.lineTo(bs.x, bs.y); ctx.stroke(); }
          }
        }
        previousView = view;
      }

      // Travel waypoints use an unmistakable diamond + core instead of the normal tiny Web bead.
      // Label only the nearest visible few so the player can read the actual grid connections
      // without a 96-node route becoming a wall of text.
      const visibleRouteNodes = [];
      for (let i = 0; i < routePath.grids.length; i++) {
        const grid = routePath.grids[i], relative = gridRelative(grid), screen = toScreen(relative);
        if (!screen) continue;
        const fade = fogAt(screen.z); if (fade <= 0) continue;
        const home = i === routePath.grids.length - 1, radius = home ? 6.5 : 5;
        ctx.globalAlpha = (home ? 1 : 0.88) * fade;
        ctx.fillStyle = web.color; ctx.strokeStyle = web.color; ctx.lineWidth = home ? 2 : 1.4;
        ctx.beginPath();
        ctx.moveTo(screen.x, screen.y - radius); ctx.lineTo(screen.x + radius, screen.y);
        ctx.lineTo(screen.x, screen.y + radius); ctx.lineTo(screen.x - radius, screen.y); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(screen.x, screen.y, home ? 2.5 : 2, 0, 7); ctx.fill();
        visibleRouteNodes.push({ grid, screen, fade, home }); web.visibleNodes++;
      }
      visibleRouteNodes.sort((a, b) => a.screen.z - b.screen.z);
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textBaseline = 'middle';
      for (let i = 0; i < Math.min(4, visibleRouteNodes.length); i++) {
        const node = visibleRouteNodes[i], label = node.grid.toLocaleString();
        ctx.globalAlpha = Math.max(0.55, node.fade); ctx.fillStyle = web.color;
        ctx.fillText(label, node.screen.x + 9, node.screen.y);
      }
    }
  }
  ctx.globalAlpha = 1;
  return { hover, counts: [...webs.values()].map(web => [web.tag, web.visibleNodes, web.members?.length || 0]) };
}

const cellDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Sample the unbounded family inside an expanding spatial tube around the direct start→home line.
// A family owns every positive multiple of `base`; Hilbert-encoding the visited lattice cells lets
// us test that membership without enumerating the family. Each progress sample stops widening once
// it has several choices, keeping planning bounded while still feeding a non-greedy path search.
function hilbertTubeCandidates(startGrid, homeGrid, base, bands) {
  if (bands <= 1) return [startGrid, homeGrid];
  const a = macroCell(startGrid), b = macroCell(homeGrid), centers = [];
  for (let band = 1; band < bands; band++) {
    const t = band / bands;
    centers.push(a.map((value, i) => Math.max(0, Math.min(SIDE - 1, Math.round(value + (b[i] - value) * t)))));
  }
  const found = centers.map(() => new Set()), candidates = new Set([startGrid, homeGrid]);
  const radiusTarget = Math.min(WEB_TUBE_RADIUS_MAX, Math.max(4, Math.ceil(Math.cbrt(base) * 1.5)));
  for (let radius = 0; radius <= radiusTarget; radius++) {
    let complete = true;
    for (let ci = 0; ci < centers.length; ci++) {
      if (found[ci].size >= WEB_TUBE_CHOICES) continue;
      complete = false;
      const center = centers[ci];
      for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
        const x = center[0] + dx, y = center[1] + dy, z = center[2] + dz;
        if (x < 0 || y < 0 || z < 0 || x >= SIDE || y >= SIDE || z >= SIDE) continue;
        const grid = hilbertEncode(x, y, z);
        if (grid < 2 || grid % base) continue;
        found[ci].add(grid); candidates.add(grid);
      }
    }
    if (complete) break;
  }

  // Very sparse families can outgrow the bounded tube radius. Probe nearby family multiples in
  // Hilbert-index space for only the still-empty samples; these remain genuine family nodes and
  // the monotonic search will reject probes that do not make spatial progress toward home.
  const maxGrid = SIDE ** 3 - 1, maxQ = Math.floor(maxGrid / base);
  for (let ci = 0; ci < centers.length; ci++) {
    if (found[ci].size) continue;
    const center = centers[ci], centerGrid = hilbertEncode(center[0], center[1], center[2]);
    const q0 = Math.max(1, Math.min(maxQ, Math.round(centerGrid / base))), probes = [];
    for (let dq = -128; dq <= 128; dq++) {
      const q = q0 + dq; if (q < 1 || q > maxQ) continue;
      const grid = q * base, cell = macroCell(grid);
      probes.push([cellDistance(cell, center), grid]);
    }
    probes.sort((x, y) => x[0] - y[0]);
    for (let i = 0; i < Math.min(WEB_TUBE_CHOICES, probes.length); i++) candidates.add(probes[i][1]);
  }
  return [...candidates];
}

function planReturn(webId, cameraStart) {
  const web = webs.get(webId);
  if (!web || !web.members?.length) throw new Error('Web has no local nodes yet.');
  let startGrid = null, nearest = Infinity;
  for (const grid of web.members) { const d = distance3(cameraStart, gridAbsolute(grid)); if (d < nearest) { nearest = d; startGrid = grid; } }
  let grids, logicalNodes, sampled = false;
  if (web.dynamic) {
    const logicalPlan = planFamilyGrids(startGrid, web.homeGrid, web.base, WEB_ROUTE_MAX);
    logicalNodes = logicalPlan.logicalCount;
    const startCell = macroCell(startGrid), homeCell = macroCell(web.homeGrid);
    const bands = Math.max(1, Math.min(WEB_ROUTE_MAX - 1,
      Math.ceil(cellDistance(startCell, homeCell) / WEB_ROUTE_HOP_CELLS)));
    const candidates = placement === 'hilbert'
      ? hilbertTubeCandidates(startGrid, web.homeGrid, web.base, bands)
      : planFamilyGrids(startGrid, web.homeGrid, web.base, WEB_ROUTE_MAX * 4).grids;
    grids = monotonicWebPath(candidates, startGrid, web.homeGrid, gridAbsolute,
      { bands, maxWaypoints: WEB_ROUTE_MAX, candidatesPerBand: WEB_TUBE_CHOICES });
    sampled = logicalNodes > grids.length;
  } else {
    grids = shortestWebPath(web.members, web.edges, startGrid, web.homeGrid, gridAbsolute);
    if (!grids) throw new Error('No connected strand reaches home.');
    logicalNodes = grids.length;
  }
  const gridPoints = grids.map(gridAbsolute), homePoint = gridAbsolute(web.homeGrid);
  const beforeHome = gridPoints.length > 1 ? gridPoints[gridPoints.length - 2] : cameraStart;
  const homeDirection = unitDelta(beforeHome, homePoint);
  const standoffMax = placement === 'hilbert' ? CELL * 0.8 : 700;
  const standoff = Math.min(standoffMax, Math.max(80, distance3(beforeHome, homePoint) * 0.32));
  const arrival = homePoint.map((value, i) => value - homeDirection[i] * standoff);
  const path = buildArcPath([cameraStart, ...gridPoints.slice(0, -1), arrival], WEB_ROUTE_SUBDIV);
  routePath = { webId, path, homePoint, grids };
  return { webId, homeGrid: web.homeGrid, startGrid, logicalNodes, sampled, routeNodes: grids.length,
    duration: rideDuration(logicalNodes), path, homePoint, arrival, homeDirection };
}

self.onmessage = event => {
  const message = event.data || {};
  try {
    if (message.type === 'init') {
      canvas = message.canvas; ctx = canvas.getContext('2d'); placement = message.placement; setPlacement(placement);
    } else if (message.type === 'resize') {
      W = message.width; H = message.height; dpr = message.dpr || 1; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    } else if (message.type === 'upsert') {
      const current = webs.get(message.web.tag);
      const web = { ...current, ...message.web, sourceMembers: message.web.members || current?.sourceMembers || [], visible: true };
      webs.set(web.tag, web); rebuild(web);
    } else if (message.type === 'remove') {
      webs.delete(message.webId); if (selectedId === message.webId) selectedId = null; if (routePath?.webId === message.webId) routePath = null;
    } else if (message.type === 'visibility') {
      const web = webs.get(message.webId); if (web) web.visible = message.visible;
    } else if (message.type === 'select') selectedId = message.webId;
    else if (message.type === 'zones') {
      for (const grid of message.added || []) zoneGrids.add(grid);
      for (const grid of message.removed || []) zoneGrids.delete(grid);
      zonesDirty = true;
    } else if (message.type === 'clearRoute') routePath = null;
    else if (message.type === 'frame') {
      const result = render(message.frame); self.postMessage({ type: 'frameDone', frameId: message.frameId, ...result });
    } else if (message.type === 'request') {
      if (message.op === 'planReturn') self.postMessage({ type: 'response', id: message.id, result: planReturn(message.webId, message.cameraStart) });
    }
  } catch (error) {
    if (message.type === 'frame') self.postMessage({ type: 'frameDone', frameId: message.frameId, hover: null, counts: [], error: error.message });
    else self.postMessage({ type: 'response', id: message.id, error: error.message || String(error) });
  }
};
