// compose-dust.js — draws a frame of the onset dust (engine/compose-choreo.js) onto the flight canvas (Compose mode E2,
// built 2026-10-22 night, sprint; proposed, not ruled).
//
// The cosmos-perf lesson holds here: the flight's cost is main-thread Canvas 2D, and a gradient made per element was the
// big one. So nothing here makes a gradient per mote:
//   motes   batched: one Path2D per (colour, alpha band of 1/16, size bucket of 0.5 px), filled once each — a few dozen
//           fills for 10,000 motes. Tiny squares below 2.2 px (they read as dots), arcs above. Added with 'lighter',
//           so overlapping dust adds light.
//   glows   the few that glow (flashes, the selection's highlights; GLOW_CAP a frame) are one drawImage each of a sprite
//           pre-baked once per (colour, size bucket, DPR) — its gradient made at bake time, never per frame.
//   lines   spokes, the slots' ticks and the hand: one stroke per (colour, alpha band, width); arcs and filaments a
//           stroke each (ARC_CAP, FILAMENT_CAP).
// DPR-aware: flight-view draws in CSS px under setTransform(dpr); a mote is never under one device pixel, and sprites
// are baked at the backing store's resolution.
//
//   dustView({ W, H, cx, cy, centre, radius, veil, dpr }) → { cx, cy, R, sizeScale, dpr }: the face's place on screen —
//       the bloom's own disc (its projected centre and radius) at veil 0, the canvas centre at veil 1 (the orb has
//       become the canvas), eased between
//   createDustRenderer({ makePath, makeCanvas }).draw(ctx, frame, view) → { motes, glows, buckets, strokes, calls }

import { DUST_PALETTE, OCTAVE_DEPTH } from '../engine/compose-choreo.js';

export const ALPHA_BANDS = 16;
export const SIZE_STEP = 0.5, SIZE_BUCKETS = 16;          // mote sides 0.5 … 8 px
export const SQUARE_BELOW = 2.2;                          // px: under this a mote is a square, over it an arc
export const GLOW_BUCKETS = Object.freeze([6, 9, 13, 19, 28, 40]);   // sprite sizes, CSS px across
export const GLOW_SPAN = 4;                               // a glow is this × the mote's size across
export const CANVAS_RADIUS = 0.42;                        // the face's radius on the full canvas, × min(W, H)

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** where the face sits on screen this frame */
export function dustView({ W, H, cx = W / 2, cy = H / 2, centre = null, radius = null, veil = 1, dpr = 1 } = {}) {
  const Rc = CANVAS_RADIUS * Math.min(W, H), e = smooth(veil);
  let x = cx, y = cy, R = Rc;
  if (centre && radius > 0) {
    const Rp = Math.min(1.5 * Rc, radius);
    x = centre.x + (cx - centre.x) * e; y = centre.y + (cy - centre.y) * e; R = Rp + (Rc - Rp) * e;
  }
  return { cx: x, cy: y, R, sizeScale: clamp(R / Rc, 0.4, 1), dpr: dpr || 1 };
}

const defaultCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

export function createDustRenderer({ makePath = () => new Path2D(), makeCanvas = defaultCanvas } = {}) {
  const sprites = new Map();
  let baked = 0;
  /** a glow sprite, baked once: its one gradient is made here */
  function sprite(hue, b, dpr) {
    const key = `${hue}|${b}|${dpr}`;
    let s = sprites.get(key);
    if (s) return s;
    const px = Math.max(2, Math.ceil(GLOW_BUCKETS[b] * dpr)), c = makeCanvas(px, px), g2 = c.getContext('2d'), r = px / 2;
    const grad = g2.createRadialGradient(r, r, 0, r, r, r), col = DUST_PALETTE[hue] || '#ffffff';
    grad.addColorStop(0, col); grad.addColorStop(0.22, col); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g2.globalAlpha = 0.55; g2.fillStyle = grad; g2.fillRect(0, 0, px, px);
    sprites.set(key, (s = c)); baked++;
    return s;
  }
  const glowBucket = (w) => { let b = 0; while (b < GLOW_BUCKETS.length - 1 && GLOW_BUCKETS[b] < w) b++; return b; };

  return {
    get sprites() { return sprites.size; },
    get baked() { return baked; },
    reset() { sprites.clear(); },
    /** draw one frame; → counts (for the tests and the perf probe) */
    draw(ctx, frame, view) {
      const stats = { motes: 0, glows: 0, buckets: 0, strokes: 0, calls: 0 };
      if (!frame || !view) return stats;
      const { cx, cy, R, sizeScale, dpr } = view, minSide = 1 / dpr;
      const sx = (x, z) => cx + R * x / (1 - OCTAVE_DEPTH * z), sy = (y, z) => cy - R * y / (1 - OCTAVE_DEPTH * z);
      const prevOp = ctx.globalCompositeOperation;

      // ── lines: grouped by (colour, alpha band, width) ──
      const strokes = new Map();
      const strokeOf = (hue, alpha, width) => {
        const band = Math.max(1, Math.round(alpha * ALPHA_BANDS)), key = `${hue}|${band}|${width}`;
        let s = strokes.get(key); if (!s) strokes.set(key, (s = { hue, a: band / ALPHA_BANDS, width, path: makePath() }));
        return s.path;
      };
      for (const l of frame.lines) { const p = strokeOf(l.hue, l.alpha, l.width); p.moveTo(sx(l.x0, l.z0), sy(l.y0, l.z0)); p.lineTo(sx(l.x1, l.z1), sy(l.y1, l.z1)); }
      for (const f of frame.paths) {
        const p = strokeOf(f.hue, f.alpha, f.width), q = f.pts;
        p.moveTo(sx(q[0], q[2]), sy(q[1], q[2]));
        for (let j = 3; j < q.length; j += 3) p.lineTo(sx(q[j], q[j + 2]), sy(q[j + 1], q[j + 2]));
      }
      for (const a of frame.arcs) { const p = strokeOf(a.hue, a.alpha, a.width), r = R * a.r; p.moveTo(cx + r * Math.sin(a.a0), cy - r * Math.cos(a.a0)); p.arc(cx, cy, r, a.a0 - Math.PI / 2, a.a1 - Math.PI / 2); }
      ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'round';
      for (const s of strokes.values()) { ctx.globalAlpha = s.a; ctx.strokeStyle = DUST_PALETTE[s.hue]; ctx.lineWidth = s.width; ctx.stroke(s.path); stats.strokes++; stats.calls++; }

      // ── motes: batched paths; the glows' sprites after ──
      ctx.globalCompositeOperation = 'lighter';
      const buckets = new Map(), glowList = [];
      const { n, x, y, z, size, alpha, hue, glow } = frame;
      for (let j = 0; j < n; j++) {
        const zz = z[j], k = 1 / (1 - OCTAVE_DEPTH * zz), X = cx + R * x[j] * k, Y = cy - R * y[j] * k;
        const side = Math.max(minSide, size[j] * sizeScale * k);
        const sb = clamp(Math.round(side / SIZE_STEP), 1, SIZE_BUCKETS), band = Math.max(1, Math.round(alpha[j] * ALPHA_BANDS));
        const key = (hue[j] * (ALPHA_BANDS + 1) + band) * (SIZE_BUCKETS + 1) + sb;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { hue: hue[j], a: band / ALPHA_BANDS, d: Math.max(minSide, sb * SIZE_STEP), path: makePath() }));
        const d = b.d;
        if (d < SQUARE_BELOW) b.path.rect(X - d / 2, Y - d / 2, d, d);
        else { b.path.moveTo(X + d / 2, Y); b.path.arc(X, Y, d / 2, 0, 6.2832); }
        if (glow[j]) glowList.push(j, X, Y, side);
        stats.motes++;
      }
      for (const b of buckets.values()) { ctx.globalAlpha = b.a; ctx.fillStyle = DUST_PALETTE[b.hue]; ctx.fill(b.path); stats.calls++; }
      stats.buckets = buckets.size;
      for (let q = 0; q < glowList.length; q += 4) {
        const j = glowList[q], X = glowList[q + 1], Y = glowList[q + 2], w = glowList[q + 3] * GLOW_SPAN, gb = glowBucket(w), W = GLOW_BUCKETS[gb];
        ctx.globalAlpha = alpha[j]; ctx.drawImage(sprite(hue[j], gb, dpr), X - W / 2, Y - W / 2, W, W);
        stats.glows++; stats.calls++;
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = prevOp || 'source-over';
      return stats;
    },
  };
}
