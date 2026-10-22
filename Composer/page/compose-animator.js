// compose-animator.js — animating Compose on the main page's Linear Plot (built 2026-10-22 night, sprint; proposed,
// not ruled). The driver and the painter; what a frame shows is trace-frames.js' (pure). composer-tab.js wires it:
//
//   waiting    Compose runs first (in the worker for the full table): the plot washes and a "composing…" shimmer
//              sweeps it. No step is shown before the trace arrives (proposed: compose first, then animate).
//   playing    the trace arrives with the spec: a scene is built (trace-frames.js buildScene), and each animation frame
//              asks it for the frame at the clock's t, paints it over the overlay's base (one blit, then the frame's
//              few hundred marks at most: never the row), and the tab shows its caption and lanes.
//   ended      t passes the scene's end: the last frame is exactly the tab's lit nodes, and the tab hands the plot back
//              to the overlay's ordinary draw. Skip (a click, Esc) jumps there; cancel (any change) drops it.
//
//   const a = createComposeAnimator({ clock })
//   a.wait() · a.start({ trace, plot, final }) → whether there was anything to animate · a.skip() · a.cancel()
//   a.tick() → { kind: 'shimmer', phase } | { kind: 'frame', frame } | { kind: 'ended', frame } | null (idle)
//   paintFrame(ctx, view, frame, final, { selected }) · paintShimmer(ctx, view, phase)

import { buildScene, frameAt, finalFrame } from './trace-frames.js';
import { drawLitPart, litRadius, partOrder } from './plot-overlay.js';

export const COMPOSE_ANIMATOR_VERSION = 'composer-animator-v1';
/** where "show the work" is kept (localStorage; proposed) */
export const SHOW_WORK_KEY = 'lrc.composer.showWork';
/** one sweep of the waiting shimmer, seconds */
export const SHIMMER_SECONDS = 1.4;

/** the "show the work" setting from storage: on unless it says '0'; a storage that throws (private mode) reads as on */
export function readShowWork(storage) {
  try { return storage?.getItem?.(SHOW_WORK_KEY) !== '0'; } catch { return true; }
}
export function writeShowWork(storage, on) {
  try { storage?.setItem?.(SHOW_WORK_KEY, on ? '1' : '0'); } catch { /* storage refused: the setting lasts the page */ }
}

/** the driver: idle → waiting → playing → idle, on an injected clock (ms) */
export function createComposeAnimator({ clock = () => (globalThis.performance ? performance.now() : Date.now()) } = {}) {
  let status = 'idle', scene = null, t0 = 0, waitedAt = 0;
  return {
    get status() { return status; },
    get scene() { return scene; },
    /** Compose is running: shimmer until start() or cancel() */
    wait() { status = 'waiting'; scene = null; waitedAt = clock(); },
    /** the trace is here → whether there is anything to animate (a refusal, a trace of another rhythm: no) */
    start({ trace, plot, final, timeline = null }) {
      const s = buildScene({ trace, plot, final, timeline });
      if (!s) { status = 'idle'; scene = null; return false; }
      scene = s; status = 'playing'; t0 = clock();
      return true;
    },
    /** jump to the end (playing only) → whether it did */
    skip() { if (status !== 'playing') return false; status = 'idle'; scene = null; return true; },
    /** drop it, waiting or playing → whether there was one */
    cancel() { if (status === 'idle') return false; status = 'idle'; scene = null; return true; },
    /** seconds into the animation (null unless playing) */
    elapsed: () => (status === 'playing' ? (clock() - t0) / 1000 : null),
    tick() {
      if (status === 'waiting') return { kind: 'shimmer', phase: (((clock() - waitedAt) / 1000) / SHIMMER_SECONDS) % 1 };
      if (status !== 'playing') return null;
      const t = (clock() - t0) / 1000;
      if (t >= scene.end) { const frame = finalFrame(scene); status = 'idle'; scene = null; return { kind: 'ended', frame }; }
      return { kind: 'frame', frame: frameAt(scene, t) };
    },
  };
}

/**
 * Paint one frame over the overlay's base (plot-overlay.js paint() has just blitted it).
 *   view   LRCVisuals' overlay view: { positions, width, height, dotSize }
 *   final  the tab's highlights (each landed part is drawn as the overlay's ordinary draw draws it)
 * Draws only what the frame names: tinted bar bands, rules, the slot windows' brackets, polylines, the landed parts'
 * nodes and the marks. A polyline breaks where the onsets run backwards (a line wrapping the cycle's end).
 */
export function paintFrame(ctx, view, frame, final, { selected = null } = {}) {
  const pos = view.positions, r = litRadius(view), top = 20, bottom = Math.max(top + 1, (view.height || 0) - 20), TAU = Math.PI * 2;
  ctx.save();
  for (const b of frame.bands) {
    const a = pos[b.from], z = pos[b.to];
    if (!a || !z) continue;
    ctx.globalAlpha = b.alpha; ctx.fillStyle = b.color;
    ctx.fillRect(a.x - r, top, Math.max(2 * r, z.x - a.x + 2 * r), bottom - top);
  }
  for (const x of frame.sweep ? [...frame.rules, frame.sweep] : frame.rules) {
    const p = pos[x.index];
    if (!p) continue;
    ctx.globalAlpha = x.alpha; ctx.strokeStyle = x.color; ctx.lineWidth = x.width || 1;
    ctx.beginPath(); ctx.moveTo(p.x, top); ctx.lineTo(p.x, bottom); ctx.stroke();
  }
  if (frame.spans.length) {
    ctx.lineWidth = 2;
    for (const w of frame.spans) {
      const a = pos[w.from], z = pos[w.to];
      if (!a || !z) continue;
      ctx.globalAlpha = w.alpha; ctx.strokeStyle = w.color;
      ctx.beginPath(); ctx.moveTo(a.x, bottom - 6); ctx.lineTo(a.x, bottom - 2); ctx.lineTo(z.x, bottom - 2); ctx.lineTo(z.x, bottom - 6); ctx.stroke();
    }
  }
  for (const l of frame.paths) {
    ctx.globalAlpha = l.alpha; ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1.5;
    ctx.beginPath();
    let prev = -1;
    for (const i of l.indices) { const p = pos[i]; if (!p) continue; if (prev < 0 || i < prev) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); prev = i; }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const id of partOrder(selected)) {
    const ix = frame.parts[id], h = final && final.parts[id];
    if (h && ix && ix.length) drawLitPart(ctx, h, pos, r, id === selected, ix);
  }
  for (const m of frame.marks) {
    const p = pos[m.index];
    if (!p) continue;
    const y = p.y + (m.dy || 0), rr = r * (m.size || 1);
    ctx.globalAlpha = m.alpha;
    if (m.shape === 'ring') { ctx.strokeStyle = m.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, y, rr + 2, 0, TAU); ctx.stroke(); }
    else if (m.shape === 'square') { ctx.fillStyle = m.color; ctx.fillRect(p.x - rr, y - rr, 2 * rr, 2 * rr); }
    else { ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(p.x, y, rr, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

/** the waiting shimmer: a soft band sweeping the plot, and "composing…" in its corner (a dozen rects, whatever the row) */
export function paintShimmer(ctx, view, phase) {
  const W = view.width || 0, H = view.height || 0, top = 20, bottom = Math.max(top + 1, H - 20), cx = -0.2 * W + 1.4 * W * phase, bw = W * 0.035;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  for (let k = -4; k <= 4; k++) {
    ctx.globalAlpha = 0.07 * Math.exp(-(k * k) / 6);
    ctx.fillRect(cx + k * bw - bw / 2, top, bw, bottom - top);
  }
  ctx.globalAlpha = 0.55 + 0.35 * Math.sin(phase * Math.PI * 2);
  ctx.fillStyle = '#00ff88'; ctx.font = '12px monospace'; ctx.textAlign = 'start';
  ctx.fillText('composing…', 48, top + 14);
  ctx.restore();
}
