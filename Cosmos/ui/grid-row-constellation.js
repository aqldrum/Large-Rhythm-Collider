// grid-row-constellation.js — Canvas-only renderer for the note constellation (Order B of
// Cosmos/docs/COSMOS_NOTE_VISUALS_WORK_ORDER_2026-09-20.md). It draws the edges it is HANDED between the
// endpoints it is HANDED; it never decides which edges exist (constellation-core.js owns that) and never
// reads audio or Cosmos state. Everything camera-shaped arrives in one `view` bag — including the view FRAME
// (view-frame.js), the same projection every other Cosmos layer draws through — so this module imports nothing
// from flight-view; only the shared pitch→colour law from the aura, so lines and orbs agree.
import { pitchHue } from './grid-row-aura.js';

// Two strokes per edge: a wide faint halo under a narrow bright core. Widths are CONSTANT in pixels on
// purpose — a perspective-scaled width explodes as an endpoint approaches the near plane, which is exactly
// when the player is flying through the figure and can least afford a screen-filling white bar.
const LINE_HALO_PX = 5.2, LINE_CORE_PX = 1.5;
const LINE_HALO_ALPHA = 0.17, LINE_CORE_ALPHA = 0.66;
const LINE_MIN_ALPHA = 0.004;   // below this the pass is invisible; skip the two strokes entirely

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

// Draw-in (Avery's decision): the stroke begins AT the attack and reaches the new grid ≈drawIn seconds
// later, ease-out — the act of drawing is the synchronised event. Nothing is pre-drawn from lookahead data,
// because the core is only ever fed attacks that have already been reached.
const easeOut = t => 1 - (1 - t) * (1 - t);

// `view` is the whole camera contract: { positionOf(grid) → camera(ship)-relative world [x,y,z] or null,
// frame (a view-frame.js frame: eye, basis, focal, cx, cy, near, fog depth), fogAt(depth) → 0..1 visibility,
// detuneCents, now, drawIn }.
export function drawGridRowConstellation(ctx, edges, view) {
  if (!edges || !edges.length) return;
  const { positionOf, frame, fogAt, now } = view;
  const { near } = frame;
  const drawIn = view.drawIn > 0 ? view.drawIn : 0;
  const detuneCents = view.detuneCents || 0;
  const clipZ = near * 1.01;   // a hair in FRONT of the plane, so focal/vz can never divide by ~0
  // Additive so crossing lines and the glows beneath them bloom together instead of veiling each other.
  // Saved and restored around the whole batch — the star loop that follows assumes source-over.
  const previousOp = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  const previousCap = ctx.lineCap;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  let drew = 0;
  for (const edge of edges) {
    const pa = positionOf(edge.from), pb = positionOf(edge.to);
    if (!pa || !pb) continue;            // an end not placed this frame (evicted zone) — draw nothing
    let a = frame.toView(pa), b = frame.toView(pb), qb = pb;
    // Grow from the TIP: the `from` end is the note that was already sounding, the `to` end is the new
    // one. Interpolating in view space is the same straight line as in world space (the view transform is a
    // rigid motion), so the stroke extends through real space rather than sliding across the screen.
    const grown = drawIn > 0 ? clamp01((now - edge.bornAt) / drawIn) : 1;
    if (grown <= 0) continue;
    if (grown < 1) {
      const t = easeOut(grown);
      b = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      qb = [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
    }
    if (a.z <= near && b.z <= near) continue;   // wholly behind the eye — nothing to project
    if (a.z <= near || b.z <= near) {
      // Precedent: Cosmos/workers/web-render-worker.js's travel route. Clip the segment AT the camera plane so a
      // line toward a note sounding behind the player runs off the edge of the screen instead of popping
      // out of existence (a large share of sounding stars are behind the camera at any moment).
      const t = (clipZ - a.z) / (b.z - a.z);
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: clipZ };
      if (a.z <= near) a = cut; else b = cut;
    }
    // Min endpoint fog × lifecycle fade. Fog depth comes from the frame: in first person the (clipped) view
    // depth, exactly as before; in chase view each endpoint's UNCLIPPED distance from the ship, the same
    // sphere-of-light law the stars fade by, so a line and its stars always leave together.
    const alpha = Math.min(fogAt(frame.fogDepth(pa, a)), fogAt(frame.fogDepth(qb, b))) * clamp01(edge.fade);
    if (alpha <= LINE_MIN_ALPHA) continue;
    const as = frame.toScreen(a), bs = frame.toScreen(b);
    const ax = as.x, ay = as.y, bx = bs.x, by = bs.y;
    // The gradient IS the melodic interval: the source note's hue travels to the destination note's hue
    // along the line, through the same pitch→colour law the orbs use, with the live detune folded in so a
    // root modulation drifts lines and orbs together.
    const hueFrom = pitchHue(edge.fromHz, detuneCents), hueTo = pitchHue(edge.toHz, detuneCents);
    const halo = ctx.createLinearGradient(ax, ay, bx, by);
    halo.addColorStop(0, `hsla(${hueFrom},95%,62%,${LINE_HALO_ALPHA})`);
    halo.addColorStop(1, `hsla(${hueTo},95%,62%,${LINE_HALO_ALPHA})`);
    const core = ctx.createLinearGradient(ax, ay, bx, by);
    core.addColorStop(0, `hsla(${hueFrom},98%,78%,${LINE_CORE_ALPHA})`);
    core.addColorStop(1, `hsla(${hueTo},98%,78%,${LINE_CORE_ALPHA})`);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = halo; ctx.lineWidth = LINE_HALO_PX;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = core; ctx.lineWidth = LINE_CORE_PX;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    drew++;
  }
  ctx.globalCompositeOperation = previousOp;
  ctx.globalAlpha = previousAlpha;
  ctx.lineCap = previousCap;
  return drew;
}
