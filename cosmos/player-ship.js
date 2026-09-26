// player-ship.js — the player's ship, seen from the chase camera (third-person work order,
// cosmos/docs/COSMOS_THIRD_PERSON_WORK_ORDER_2026-09-23.md). Canvas only: it draws what it is HANDED — a hull
// orientation, a view frame, a size, an opacity, a boost level and a clock — and reads no camera, input, audio or
// music state of its own.
//
// A SAUCER (Avery, 2026-09-26): a steel lens with a glass dome, chasing rim lights and a boost wake. It replaced a
// low-poly dart — faceted polytopes read wrong in a cosmos made of spheres — so there are no triangles here at all.
// The body is a surface of revolution about the hull's up axis, drawn as horizontal slices (projected circles)
// stacked from the side away from the eye toward it: each slice covers the one before except the strip of surface
// between them, which is exactly what a convex solid of revolution shows. One metal gradient per slice.
//
// MONOCHROME by decision (Avery, 2026-09-23): steel, glass, rim lights and wake share one neutral family and take
// no hue from the music. A key colour was considered and dropped — with root modulation every new key glides back
// onto the 1/1 fundamental, so a key-coloured ship would show the same hue after every change.
//
// A saucer looks the same from every side, so heading is carried by three cues instead of the silhouette: the
// forward rim light burns steadily brighter, the hull leans nose-down into flight (more under boost), and the wake
// trails off the back rim.
//
// The ship sits at the ship-relative ORIGIN — exactly where the first-person camera is — so it is transformed by
// its hull basis (and lean) only, never translated.

// ── geometry (ship space: x = right, y = up, z = forward; units of `length`) ─────────────────────────────────
// The lens profile as (radius, height) stations, listed bottom → top: belly, lower flank, the rim band, the upper
// flank, and the hub the dome sits on. Diameter 0.9 — the old dart's span — so shipScale reads the same.
const PROFILE = [
  [0.14, -0.08], [0.26, -0.07], [0.38, -0.045], [0.45, -0.012],   // underside, up to the bottom of the rim band
  [0.45, 0], [0.40, 0.035], [0.32, 0.063], [0.22, 0.083],         // rim edge, then the upper flank
  [0.16, 0.09],                                                   // hub: the cockpit floor under the dome
];
const HUB = PROFILE.length - 1, RIM = 4;
export const PLAYER_SHIP_SLICES = PROFILE.length;
const DOME_CENTRE = 0.075, DOME_RADIUS = 0.16;   // a sphere cut by the hub plane, a little above its equator
const DOME_BASE = PROFILE[HUB][1];
const SEGMENTS = 32;                             // points per slice circle
const DOME_LATS = 4, DOME_SEGMENTS = 24;
const RIM_LIGHTS = 12, RIM_LIGHT_RADIUS = 0.452, RIM_LIGHT_HEIGHT = -0.006;
const WAKE_ORIGIN = [0, -0.006, -0.45];          // the back rim

const TAU = Math.PI * 2;
const COS = Array.from({ length: SEGMENTS }, (_, i) => Math.cos(TAU * i / SEGMENTS));
const SIN = Array.from({ length: SEGMENTS }, (_, i) => Math.sin(TAU * i / SEGMENTS));

// Profile normal of the strip from station i to station j, as (radial, up). Walking the profile bottom → top,
// (dy, −dρ) points out of the solid on both the underside and the upper flank.
const stripNormal = (i, j) => {
  const dr = PROFILE[j][0] - PROFILE[i][0], dy = PROFILE[j][1] - PROFILE[i][1], l = Math.hypot(dr, dy) || 1;
  return [dy / l, -dr / l];
};

// ── look ──────────────────────────────────────────────────────────────────────────────────────────────────
const STEEL_RGB = [178, 186, 198];   // one cool neutral steel; shading only scales it
const AMBIENT = 0.2, DIFFUSE = 0.68, SPECULAR = 0.6, SHININESS = 20;
const HUB_SHADE = 0.5;               // the cockpit floor sits darker, so the glass above it reads
const GLASS_RGB = '192,206,226', GLASS_EDGE_RGB = '206,220,240', GLASS_RIM = 'rgba(222,236,255,0.55)';
const SILHOUETTE = 'rgba(226,234,248,0.4)', RIM_EDGE = 'rgba(240,245,255,0.85)';
const LIGHT_CORE_RGB = '240,246,255', LIGHT_HALO_RGB = '220,232,250', WAKE_RGB = '214,226,242';
// One fixed key light, in VIEW space: the direction TOWARD the light, which sits above-left and slightly behind
// the eye. Fixing it to the view (not the world) keeps the hull readable from every heading — deep space has no
// sun to be lit by. HALF is the Blinn half-vector with the eye (view −z), for the steel's sheen and the glint.
const unit = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const LIGHT = unit([-0.45, 0.7, -0.55]);
const HALF = unit([LIGHT[0], LIGHT[1], LIGHT[2] - 1]);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const steel = (k, m) => `rgb(${STEEL_RGB.map(c => Math.min(255, Math.round(c * k * m))).join(',')})`;

// Convex hull of screen points (monotone chain). The saucer and the dome are both convex, so the hull of their
// projected surface points IS their silhouette.
function convexHull(points) {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length > 1 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length > 1 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const tracePolygon = (ctx, points) => {
  ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
};

// Draw the ship. `view` is a view-frame.js frame; `hull` the ship's orientation { d, r, u } (the route tangent
// during a Web ride, whatever the arrow keys do to the view); `length` the ship's size in world units; `alpha`
// the caller's opacity (the V blend × any proximity fade); `boost` 0..1; `time` seconds (drives the rim-light
// chase). Returns what was drawn: { slices, lights }.
export function drawPlayerShip(ctx, { view, hull, length, alpha = 1, boost = 0, time = 0 }) {
  const drawn = { slices: 0, lights: 0 };
  if (!(alpha > 0.004) || !(length > 0)) return drawn;
  const { r, u, d } = hull;
  // Lean: pitch nose-down about the hull's right axis, deeper under boost.
  const lean = (6 + 8 * boost) * Math.PI / 180, cl = Math.cos(lean), sl = Math.sin(lean);
  // ship-space DIRECTION → ship-relative world (lean, then hull basis); a point is the same, scaled by length
  const dir = (x, y, z) => {
    const ly = y * cl - z * sl, lz = z * cl + y * sl;
    return [x * r[0] + ly * u[0] + lz * d[0], x * r[1] + ly * u[1] + lz * d[1], x * r[2] + ly * u[2] + lz * d[2]];
  };
  const point = (x, y, z) => { const w = dir(x, y, z); return [w[0] * length, w[1] * length, w[2] * length]; };
  const vb = view.basis, eye = view.eye;
  const toEye = w => [eye[0] - w[0], eye[1] - w[1], eye[2] - w[2]];
  // Blinn–Phong in view space for a world-space unit normal.
  const shade = n => {
    const nv = [dot(n, vb.r), dot(n, vb.u), dot(n, vb.d)];
    return AMBIENT + DIFFUSE * Math.max(0, dot(nv, LIGHT)) + SPECULAR * Math.max(0, dot(nv, HALF)) ** SHININESS;
  };
  const above = dot(eye, dir(0, 1, 0)) > 0;   // eye on the dome side of the saucer's plane?

  // Project every slice circle once. A slice with a point behind the near plane is dropped — the eye is being
  // squeezed onto the hull, and the caller is already fading the ship out.
  const rings = PROFILE.map(([rho, y]) => {
    const ring = new Array(SEGMENTS);
    for (let i = 0; i < SEGMENTS; i++) {
      const world = point(rho * COS[i], y, rho * SIN[i]), screen = view.project(world);
      if (!screen) return null;
      ring[i] = { world, screen };
    }
    return ring;
  });

  const previousAlpha = ctx.globalAlpha, previousOp = ctx.globalCompositeOperation;
  const previousJoin = ctx.lineJoin, previousCap = ctx.lineCap;
  ctx.globalAlpha = alpha; ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  const drawDome = () => {
    const outline = [];
    const lat0 = Math.asin((DOME_BASE - DOME_CENTRE) / DOME_RADIUS);
    for (let l = 0; l <= DOME_LATS; l++) {
      const lat = lat0 + (Math.PI / 2 - lat0) * l / DOME_LATS;
      const rho = DOME_RADIUS * Math.cos(lat), y = DOME_CENTRE + DOME_RADIUS * Math.sin(lat);
      for (let i = 0; i < DOME_SEGMENTS; i++) {
        const a = TAU * i / DOME_SEGMENTS, s = view.project(point(rho * Math.cos(a), y, rho * Math.sin(a)));
        if (s) outline.push(s);
      }
    }
    const silhouette = convexHull(outline);
    const crown = view.project(point(0, DOME_CENTRE + DOME_RADIUS * 0.55, 0));
    if (silhouette.length < 3 || !crown) return;
    let reach = 1;
    for (const q of silhouette) reach = Math.max(reach, Math.hypot(q.x - crown.x, q.y - crown.y));
    // Glass: faint face-on, denser at grazing angles, over the darker cockpit floor.
    tracePolygon(ctx, silhouette);
    const glass = ctx.createRadialGradient(crown.x, crown.y, 0, crown.x, crown.y, reach);
    glass.addColorStop(0, `rgba(${GLASS_RGB},0.10)`);
    glass.addColorStop(0.75, `rgba(${GLASS_RGB},0.26)`);
    glass.addColorStop(1, `rgba(${GLASS_EDGE_RGB},0.5)`);
    ctx.fillStyle = glass; ctx.fill();
    ctx.strokeStyle = GLASS_RIM; ctx.lineWidth = 0.8; ctx.stroke();
    // The glint: where the dome's normal meets the half-vector — on the glass only if it is above the hub.
    const halfWorld = [0, 1, 2].map(k => HALF[0] * vb.r[k] + HALF[1] * vb.u[k] + HALF[2] * vb.d[k]);
    const up = dir(0, 1, 0);
    if (dot(halfWorld, up) * DOME_RADIUS > DOME_BASE - DOME_CENTRE) {
      const centre = point(0, DOME_CENTRE, 0);
      const glint = view.project([0, 1, 2].map(k => centre[k] + halfWorld[k] * DOME_RADIUS * length));
      if (glint) {
        const radius = Math.max(1.5, 0.06 * length * view.focal / glint.z);
        const g = ctx.createRadialGradient(glint.x, glint.y, 0, glint.x, glint.y, radius);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.4, 'rgba(235,244,255,0.35)');
        g.addColorStop(1, 'rgba(235,244,255,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(glint.x, glint.y, radius, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = previousOp;
      }
    }
  };

  // From below, the dome is behind the body: draw it first so the belly covers it.
  if (!above) drawDome();

  // The slices, far side first. Each one's visible strip runs to the NEXT slice drawn, so that strip's profile
  // normal lights it; the last slice drawn shows its whole face (the hub from above, the belly from below).
  for (let k = 0; k < PROFILE.length; k++) {
    const i = above ? k : HUB - k, ring = rings[i];
    if (!ring) continue;
    const [nr, ny] = above ? (i === HUB ? [0, 1] : stripNormal(i, i + 1)) : (i === 0 ? [0, -1] : stripNormal(i - 1, i));
    let kMax = -Infinity, kMin = Infinity, pMax = ring[0].screen, pMin = ring[0].screen;
    for (let s = 0; s < SEGMENTS; s++) {
      const lit = shade(dir(nr * COS[s], ny, nr * SIN[s]));
      if (lit > kMax) { kMax = lit; pMax = ring[s].screen; }
      if (lit < kMin) { kMin = lit; pMin = ring[s].screen; }
    }
    const m = i === HUB ? HUB_SHADE : 1;
    let fill = steel(kMax, m);
    if (Math.hypot(pMax.x - pMin.x, pMax.y - pMin.y) > 1) {
      fill = ctx.createLinearGradient(pMax.x, pMax.y, pMin.x, pMin.y);
      fill.addColorStop(0, steel(kMax, m));
      fill.addColorStop(1, steel(kMin, m));
    }
    tracePolygon(ctx, ring.map(q => q.screen));
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = fill; ctx.lineWidth = 0.5; ctx.stroke();   // same colour: seals the seam, draws no line
    drawn.slices++;
  }

  // Strokes only where they matter: the saucer's silhouette, and the near half of the rim edge from above.
  const body = convexHull(rings.flatMap(ring => (ring ? ring.map(q => q.screen) : [])));
  if (body.length >= 3) {
    tracePolygon(ctx, body);
    ctx.strokeStyle = SILHOUETTE; ctx.lineWidth = 0.8; ctx.stroke();
  }
  if (above && rings[RIM]) {
    const rim = rings[RIM];
    ctx.strokeStyle = RIM_EDGE; ctx.lineWidth = 1; ctx.beginPath();
    let pen = false;
    for (let s = 0; s <= SEGMENTS; s++) {
      const q = rim[s % SEGMENTS];
      if (dot(dir(COS[s % SEGMENTS], 0, SIN[s % SEGMENTS]), toEye(q.world)) > 0) {
        if (pen) ctx.lineTo(q.screen.x, q.screen.y); else ctx.moveTo(q.screen.x, q.screen.y);
        pen = true;
      } else pen = false;
    }
    ctx.stroke();
  }

  if (above) drawDome();

  // Rim lights: additive, near side only. A pulse chases around the rim, faster and brighter under boost; the
  // forward light (index 0, on +z) burns steadily as the heading marker.
  ctx.globalCompositeOperation = 'lighter';
  const phase = time * (0.35 + 1.3 * boost) * TAU;
  for (let j = 0; j < RIM_LIGHTS; j++) {
    const a = Math.PI / 2 + TAU * j / RIM_LIGHTS;
    const world = point(RIM_LIGHT_RADIUS * Math.cos(a), RIM_LIGHT_HEIGHT, RIM_LIGHT_RADIUS * Math.sin(a));
    if (dot(dir(Math.cos(a), 0, Math.sin(a)), toEye(world)) <= 0) continue;
    const s = view.project(world);
    if (!s) continue;
    let gap = ((a - phase) % TAU + TAU) % TAU;
    gap = Math.min(gap, TAU - gap) / 0.4;
    let level = 0.22 + 0.3 * boost + 0.7 * Math.exp(-gap * gap);
    if (j === 0) level = Math.max(level, 0.85);
    level = Math.min(1, level);
    const radius = 2.4 * Math.max(1, 0.013 * length * view.focal / s.z) * (j === 0 ? 1.3 : 1);
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
    g.addColorStop(0, `rgba(${LIGHT_CORE_RGB},${level})`);
    g.addColorStop(0.35, `rgba(${LIGHT_HALO_RGB},${level * 0.4})`);
    g.addColorStop(1, `rgba(${LIGHT_HALO_RGB},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, radius, 0, TAU); ctx.fill();
    drawn.lights++;
  }

  // Wake: a streak straight back along the flight line (the hull's −d, not the leaned axis) off the back rim,
  // lengthening and brightening with boost. One gradient per frame.
  const origin = point(...WAKE_ORIGIN), reach = (0.12 + 0.5 * boost) * length;
  const from = view.project(origin), to = view.project([0, 1, 2].map(k => origin[k] - d[k] * reach));
  if (from && to) {
    const width = Math.max(1.5, 0.07 * length * view.focal / from.z) * (1 + 0.5 * boost), core = 0.35 + 0.55 * boost;
    const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    g.addColorStop(0, `rgba(${WAKE_RGB},${core})`);
    g.addColorStop(0.3, `rgba(${WAKE_RGB},${core * 0.4})`);
    g.addColorStop(1, `rgba(${WAKE_RGB},0)`);
    ctx.strokeStyle = g; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
  }

  ctx.globalAlpha = previousAlpha; ctx.globalCompositeOperation = previousOp;
  ctx.lineJoin = previousJoin; ctx.lineCap = previousCap;
  return drawn;
}
