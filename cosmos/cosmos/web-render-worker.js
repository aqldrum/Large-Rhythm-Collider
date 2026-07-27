// web-render-worker.js — the complete Cosmos Web pipeline off the UI thread:
// membership filtering, kNN graph builds, progressive reveal, projection, hit testing, drawing,
// and Return Home route planning. The flight loop only sends camera frames + zone deltas and consumes
// tiny hover/count snapshots.
import { setPlacement, macroCell, macroScale, backboneHash, CELL } from './spine.js';
import { buildWebGraph, familyMembers } from './web-graph.js';
import { planFamilyGrids, shortestWebPath, buildArcPath, unitDelta, rideDuration } from './web-return.js';

const WEB_K = 3, WEB_BUCKET = 8, WEB_LINE_W = 2, WEB_STRAND_A = 0.3, WEB_HIT = 9;
const WEB_REVEAL_FRAC = 0.75, WEB_ROUTE_MAX = 96, WEB_ROUTE_SUBDIV = 8, MN_REFRESH_MS = 200;
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
  const toScreen = point => {
    const x = dot(point, frame.r), y = dot(point, frame.u), z = dot(point, frame.d);
    if (z <= 5) return null;
    return { x: frame.cx + x * frame.focal / z, y: frame.cy - y * frame.focal / z, z };
  };
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
      let previous = null;
      for (const point of points) {
        const relative = [point[0] - cameraAbsolute[0], point[1] - cameraAbsolute[1], point[2] - cameraAbsolute[2]];
        const screen = toScreen(relative);
        if (screen && previous) {
          const fade = Math.min(fogAt(previous.z), fogAt(screen.z));
          if (fade > 0) { ctx.globalAlpha = 0.76 * fade; ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(screen.x, screen.y); ctx.stroke(); }
        }
        previous = screen;
      }
    }
  }
  ctx.globalAlpha = 1;
  return { hover, counts: [...webs.values()].map(web => [web.tag, web.visibleNodes, web.members?.length || 0]) };
}

function planReturn(webId, cameraStart) {
  const web = webs.get(webId);
  if (!web || !web.members?.length) throw new Error('Web has no local nodes yet.');
  let startGrid = null, nearest = Infinity;
  for (const grid of web.members) { const d = distance3(cameraStart, gridAbsolute(grid)); if (d < nearest) { nearest = d; startGrid = grid; } }
  let grids, logicalNodes, sampled = false;
  if (web.dynamic) {
    const plan = planFamilyGrids(startGrid, web.homeGrid, web.base, WEB_ROUTE_MAX);
    grids = plan.grids; logicalNodes = plan.logicalCount; sampled = plan.sampled;
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
  routePath = { webId, path, homePoint };
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
