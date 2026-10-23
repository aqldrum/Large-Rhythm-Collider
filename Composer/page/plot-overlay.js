// plot-overlay.js — draws the Composer's lit nodes over the main page's Linear Plot, and its playhead during Perform.
//
// It is the object LRCVisuals.setComposerOverlay() takes. LRCVisuals calls draw(ctx, view) at the end of every Linear
// Plot draw (and never when no overlay is set); the Composer tab calls frame(at) on each animation frame while it
// performs. Nothing here knows the DOM except `makeCanvas`, which makes the one offscreen canvas the snapshot lives in.
//
//   draw    a dark wash over the plot (the invert button left clear), then a lit-node layer a part, from
//           plot-highlights.js: a dot in the part's colour on each of its nodes (drum strokes as squares), the selected
//           part on top with a ring, a part that is off faint. Then a snapshot of the whole canvas.
//   frame   the snapshot back (one blit, however many onsets the row has), then the playhead: a line at its place on
//           the plot, a ring on the onset under it, and a glow on each node sounding now. No dot of the row is redrawn
//           per frame, so a 16k-onset row costs the same as 8:7:6:5.
// While the main page animates its own lights (LRCVisuals.isAnimating: main playback), no snapshot is taken: the
// Composer is stopped then (one thing sounds at a time), and every main frame redraws the plot anyway.
//   scene   while Compose is animated (compose-animator.js), setScene(true): draw washes the plot and snapshots it with
//           no lit node (the animation's base, even before there is a spec), and paint(fn) blits that base and lets
//           fn draw the animation frame's few marks over it. setScene(false) and a redraw land on the lit nodes again.

import { HIGHLIGHT_PARTS, playheadAt, playheadX, soundingAt } from './plot-highlights.js';

export const OVERLAY_STYLE = Object.freeze({ wash: 'rgba(16, 16, 16, 0.62)', offAlpha: 0.25, ring: 3, glow: 6, playhead: 'rgba(255, 255, 255, 0.75)' });
/** a lit dot's radius on a view */
export const litRadius = (view) => Math.max(2, ((view && view.dotSize) || 4) * 0.9);

/** one part's lit nodes as one path: dots, or squares for the drums (the selected part ringed); `indices` defaults to
 *  all of the part's (an animation frame passes the ones landed so far) */
export function drawLitPart(ctx, h, positions, r, ringed, indices = h.indices) {
  ctx.save();
  ctx.globalAlpha = h.enabled ? 1 : OVERLAY_STYLE.offAlpha;
  ctx.fillStyle = h.color;
  ctx.beginPath();
  for (const i of indices) {
    const p = positions[i];
    if (!p) continue;
    if (h.id === 'drums') ctx.rect(p.x - r, p.y - r, 2 * r, 2 * r);
    else { ctx.moveTo(p.x + r, p.y); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
  }
  ctx.fill();
  if (ringed) {
    ctx.strokeStyle = h.color; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const i of indices) { const p = positions[i]; if (!p) continue; ctx.moveTo(p.x + r + OVERLAY_STYLE.ring, p.y); ctx.arc(p.x, p.y, r + OVERLAY_STYLE.ring, 0, Math.PI * 2); }
    ctx.stroke();
  }
  ctx.restore();
}
/** the order the parts are drawn in, the selected one on top */
export function partOrder(selected) {
  const ids = ['drums', 'inner', 'comp', 'bass', 'chords', 'lead'].filter((id) => HIGHLIGHT_PARTS.includes(id));
  return selected && ids.includes(selected) ? [...ids.filter((id) => id !== selected), selected] : ids;
}

/**
 * createPlotOverlay({ getHighlights, getSelected, makeCanvas })
 *   getHighlights () → plot-highlights.js highlights for the plot as drawn now, or null (nothing lit)
 *   getSelected   () → the selected part's id (drawn on top, ringed)
 *   makeCanvas    () → a canvas for the snapshot (document.createElement('canvas') in the page)
 */
export function createPlotOverlay({ getHighlights, getSelected = () => null, makeCanvas = () => (typeof document !== 'undefined' ? document.createElement('canvas') : null) } = {}) {
  let view = null, ctxOf = null, snap = null, snapOk = false, lit = null, scene = false;

  const washOver = (ctx, { width, height, button }) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    if (button) ctx.rect(button.x, button.y, button.width, button.height);   // a hole (even-odd): the invert button stays clear
    ctx.fillStyle = OVERLAY_STYLE.wash;
    ctx.fill('evenodd');
    ctx.restore();
  };
  const order = partOrder;
  const api = {
    /** LRCVisuals' hook: called at the end of each Linear Plot draw. view: { positions, width, height, dotSize, canvas,
     *  button, animating } */
    draw(ctx, v) {
      view = v; ctxOf = ctx; snapOk = false;
      lit = getHighlights();
      if (!lit && !scene) return;
      washOver(ctx, v);
      const selected = getSelected(), r = litRadius(v);
      if (!scene) for (const id of order(selected)) { const h = lit.parts[id]; if (h && h.indices.length) drawLitPart(ctx, h, v.positions, r, id === selected); }
      if (v.animating || !v.canvas) return;
      snap ??= makeCanvas();
      if (!snap) return;
      if (snap.width !== v.canvas.width) snap.width = v.canvas.width;
      if (snap.height !== v.canvas.height) snap.height = v.canvas.height;
      const s = snap.getContext('2d');
      s.clearRect(0, 0, snap.width, snap.height);
      s.drawImage(v.canvas, 0, 0);
      snapOk = true;
    },
    /** the playhead: at = { p (0..1 of the cycle), t (seconds) }, or null to clear it. → whether it drew */
    frame(at) {
      if (!snapOk || !view || !ctxOf || !lit) return false;
      const ctx = ctxOf;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(snap, 0, 0); ctx.restore();
      if (!at) return true;
      const ph = playheadAt(lit.plot, lit.phaseX, at.p), x = playheadX(view.positions, ph);
      if (x == null) return true;
      const r = litRadius(view);
      ctx.save();
      ctx.strokeStyle = OVERLAY_STYLE.playhead; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, view.height - 20); ctx.stroke();
      const under = view.positions[ph.index];
      if (under) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(under.x, under.y, r + 2, 0, Math.PI * 2); ctx.stroke(); }
      for (const { part, index } of soundingAt(lit, at.t)) {
        const p = view.positions[index];
        if (!p) continue;
        ctx.globalAlpha = 0.45; ctx.fillStyle = lit.parts[part].color;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + OVERLAY_STYLE.glow, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return true;
    },
    /** the animation's base on (no lit node is drawn under it) or off; the caller redraws the plot */
    setScene(on) { scene = !!on; },
    get scene() { return scene; },
    /** an animation frame: the base back in one blit, then fn(ctx, view) draws over it → whether it drew */
    paint(fn) {
      if (!snapOk || !view || !ctxOf) return false;
      const ctx = ctxOf;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(snap, 0, 0); ctx.restore();
      fn(ctx, view);
      return true;
    },
    /** what the last draw lit (for the view and tests) */
    get highlights() { return lit; },
    get snapshotted() { return snapOk; },
  };
  return api;
}

/**
 * The overlay seat (sprint 2): the page has ONE Composer overlay, and two things may want it on the Linear Plot: the
 * Composer tab while it is shown, and the Composition lens. Each claims and releases its own hold; the overlay is set
 * on the plot while anyone holds it and cleared when the last lets go (so with neither, the plot is drawn exactly as
 * it was before the Composer existed).
 *   createOverlaySeat({ visuals: () → window.lrcVisuals, overlay }) → { claim(who), release(who), holds(who), held }
 *   claim always (re)sets the overlay, which redraws the plot; release clears it only when no one is left.
 */
export function createOverlaySeat({ visuals = () => null, overlay } = {}) {
  const holders = new Set();
  return {
    overlay,
    claim(who) { holders.add(who); visuals()?.setComposerOverlay?.(overlay); },
    release(who) {
      if (!holders.delete(who)) return false;
      if (!holders.size) visuals()?.setComposerOverlay?.(null);
      return true;
    },
    holds: (who) => holders.has(who),
    get held() { return holders.size > 0; },
  };
}
