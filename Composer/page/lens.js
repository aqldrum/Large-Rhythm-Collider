// lens.js — the Composition lens on the main page (Composer sprint 2, step 1). A composition is a reading of the row,
// not a second player: the lens says which reading the canvas shows, 'row' or 'composition', and the one transport
// (the Playback div's Play/Stop) plays whatever the canvas shows. The glyph in the header toggles it.
//
//   row → composition   (the glyph pressed, a rhythm on the page)
//     main playback stops; the plot switches to the Linear Plot if it was on another type (the type is put back on
//     the way out, proposed); the overlay seat is claimed (the lit nodes on the main canvas, the Composer window open
//     or not); the panels adapt (part strips, the scale readout, the families note). Then:
//       recall    the rhythm has a composition in the store (made last, by the glyph or in the window, and not
//                 edited since: a seed, knob or progression change makes the glyph compose again — proposed): it
//                 plays at once, no re-solve. Live edits (parts on/off, sounds, levels, drums) are in it.
//       compose   none yet: Compose runs (one in flight per rhythm: a window Compose of the same rhythm is joined).
//                 With "show the work" on, the plot shimmers, then the trace is animated on the main canvas
//                 (compose-animator.js; Esc or a click on the canvas skips to the landing); then it plays. A refusal
//                 or an error goes back to the row, and the glyph's tip says why.
//   composition → row   (the glyph again, a new rhythm or cycle, a plot type picked by hand, the row started)
//     the animation is dropped, the composition stops (it stays in the store), the seat released (the plot draws
//     exactly as before), the panels restored, the plot type put back (not when the user picked one by hand).
//   transport           under the lens, Play/Stop plays and stops the composition (the shared player, through the
//                       controller: one thing sounds at a time). Stop keeps the composition and the lens. Play during
//                       the animation skips to the landing and plays; during Compose it waits.
//
//   const lens = createLens({ tab, store, host, overlay, seat, animator, raf, doc, panels, tabShown, plotted })
//   lens.mode · lens.phase ('idle' | 'composing' | 'animating' | 'landed') · lens.glyph() · lens.tip() · lens.refusal
//   lens.press({ pace }) → Promise<phase once settled> · lens.toComposition({ pace }) · lens.toRow() · lens.skip()
//   lens.transport { owns(), isPlaying(), toggle() } · lens.onChange(fn) → unsubscribe; fn(event, detail)
//     events: 'composing' (detail { showWork, animate, short }) · 'animating' ({ scene, pace, recalled, short }) ·
//     'skip' ({ queued }) · 'landed' ({ recalled }) · 'row' · 'change' (the composition or its playback changed under
//     the lens) · 'glyph' (the rhythm appeared, went, or moved)
//   lens.onFrame(fn) → unsubscribe; fn(frame, { short }) on each animation frame (theater.js floats its caption)
//   `pace` scales the animation's clock (the tutorial's brisker theater); theater.js (sprint 2, step 2) puts its scrim
//   around 'composing'/'animating' and lifts it on 'skip', 'landed' and 'row'.
//
// Sprint 2, step 2 — the theater's timing (proposed):
//   the full show   only a rhythm's first animated compose (per store key, this page) plays the whole trace (4–7.5 s)
//   the short one   a recall, or a later compose of that rhythm, plays trace-frames.js' recallTimeline (~1.5 s: the
//                   root → the lead → the parts land). A recall with no trace (made with "show the work" off) lands
//   no motion       "show the work" off, or `motion()` false (prefers-reduced-motion): no shimmer, no animation —
//                   Compose runs, then it lands (the trace is still asked for while the work is shown, for the window)
//   skip            during the animation: the landing. During Compose (the shimmer): queued — the compose lands
//                   straight on the landing, unanimated
//
// The DOM it touches is injected: host (the page: its plot type, its transport button, its Linear Plot), doc (Esc and
// the main canvas's click, for skipping), raf, and the panels — views with enter(), leave(), update(), frame(at).

import { plotOf } from './plot-highlights.js';
import { paintFrame, paintShimmer } from './compose-animator.js';
import { recallTimeline } from './trace-frames.js';
import { refusalText } from '../perform/readouts.js';

export const LENS_VERSION = 'composition-lens-v2';
export const GLYPH_STATES = Object.freeze(['hidden', 'ready', 'composing', 'lit']);
/** the glyph's tooltip a state (proposed) */
export const GLYPH_TIPS = Object.freeze({ hidden: '', ready: 'Compose', composing: 'Back to the row', lit: 'Back to the row' });
export const PHASES = Object.freeze(['idle', 'composing', 'animating', 'landed']);

/**
 * createLens(deps)
 *   tab       tab-controller.js (bound to the store's current entry; its core is the shared controller)
 *   store     composition-store.js
 *   host      { stopMain (), plotType () → string | null, setPlotType (t), onVizChanged (fn(type)) → unsub,
 *               refreshTransport (), visuals () → window.lrcVisuals | null }
 *   overlay   the page's plot overlay (plot-overlay.js); seat: its seat (createOverlaySeat)
 *   animator  a compose-animator.js driver of the lens's own
 *   raf, doc  the page's requestAnimationFrame and document
 *   panels    [{ enter(), leave(), update(), frame(at) }]: the Playback div's part strips, the scale and families locks
 *   tabShown  () → whether the Composer window's tab is shown (it paints the playhead itself then)
 *   plotted   () → { compositeRhythm, grid } of the plot, or null
 */
export function createLens({ tab, store, host = {}, overlay, seat, animator, raf = (f) => globalThis.requestAnimationFrame?.(f), doc = null, panels = [], tabShown = () => false, plotted = () => null, motion = () => true } = {}) {
  const core = tab.core;
  const listeners = new Set(), frameListeners = new Set();
  // sprint 2, step 2: the keys whose full show has played (or been skipped); a skip asked for during Compose; whether
  // the animation running is a recall's; the frame loop's generation (a stale queued frame never runs a second loop)
  const fullShown = new Set();
  let skipQueued = false, animRecalled = false, animShort = false, loopGen = 0;
  let phase = 'idle', session = 0, lensKey = null, priorPlot = null, switching = false, ownScene = false, pace = 1;
  let looping = false, lastPlaying = false, finalLit = null, refusal = null, settle = null;

  const emit = (type, detail = {}) => { for (const f of [...listeners]) f(type, detail); };
  const visuals = () => host.visuals?.() ?? null;
  const redraw = () => visuals()?.drawPlot?.();
  const each = (m, ...a) => { for (const p of panels) { try { p[m]?.(...a); } catch (err) { globalThis.console?.warn?.(`composition lens: panel ${m} failed`, err); } } };
  const resolveSettle = () => { const s = settle; settle = null; s?.(phase); };
  const dropScene = () => { animator.cancel(); if (ownScene) overlay.setScene(false); ownScene = false; finalLit = null; skipQueued = false; };

  // ── the frame loop: the lens's own animation, the playhead (unless the window paints it), the panels' readouts ──
  const skippable = () => phase === 'animating' || (phase === 'composing' && ownScene && !skipQueued);
  const onKey = (e) => { if (e.key === 'Escape' && skippable()) { e.preventDefault?.(); api.skip(); } };
  const onCanvasClick = () => { if (skippable()) api.skip(); };
  let canvasEl = null;
  function startLoop() {
    if (looping) return;
    looping = true; lastPlaying = false;
    doc?.addEventListener?.('keydown', onKey);
    canvasEl = doc?.getElementById?.('visualization-canvas') ?? null;
    canvasEl?.addEventListener?.('click', onCanvasClick);
    const gen = ++loopGen;
    raf(() => frame(gen));
  }
  function stopLoop() {
    if (!looping) return;
    looping = false;
    doc?.removeEventListener?.('keydown', onKey);
    canvasEl?.removeEventListener?.('click', onCanvasClick); canvasEl = null;
  }
  function frame(gen) {
    if (!looping || gen !== loopGen) return;
    tab.syncRhythm();   // a new cycle (or rhythm) is a new store key: the select below takes the lens back to the row
    if (!looping) return;
    const v = visuals(), onLinear = !!v && v.currentPlotType === 'linear';
    const a = ownScene ? animator.tick() : null;
    if (a && a.kind === 'frame') for (const f of [...frameListeners]) f(a.frame, { short: animShort });
    if (a && a.kind === 'ended') land(session, { recalled: animRecalled });
    else if (a && onLinear) overlay.paint((ctx, view) => (a.kind === 'frame' ? paintFrame(ctx, view, a.frame, finalLit, { selected: tab.view.selected }) : paintShimmer(ctx, view, a.phase)));
    const at = phase === 'landed' ? tab.playheadAt() : null;
    if (!tabShown()) {
      if (at) { if (onLinear) overlay.frame(at); lastPlaying = true; }
      else if (lastPlaying) { lastPlaying = false; if (onLinear) overlay.frame(null); }
    }
    each('frame', at);
    if (looping && gen === loopGen) raf(() => frame(gen));
  }

  /** start the animation of `trace` (the short version when `short`) → whether there was anything to animate */
  function animate(trace, { short, recalled }) {
    const timeline = short ? recallTimeline(trace) : null;
    if (short && !timeline) return false;
    const pl = plotted(), final = tab.highlights(pl);
    if (!final || !animator.start({ trace, plot: plotOf(pl || {}), final, pace, timeline })) return false;
    finalLit = final; phase = 'animating'; animRecalled = recalled; animShort = short;
    emit('animating', { scene: animator.scene, pace, recalled, short });
    return true;
  }

  /** the composition lands: lit on the plot, and played */
  function land(my, { recalled = false } = {}) {
    if (my !== session || store.lens !== 'composition') return;
    dropScene();
    phase = 'landed';
    redraw();
    core.perform();   // stops main playback first (one thing sounds at a time)
    each('update');
    host.refreshTransport?.();
    emit('landed', { recalled });
    resolveSettle();
  }

  const api = {
    version: LENS_VERSION,
    get mode() { return store.lens; },
    get phase() { return phase; },
    get pace() { return pace; },
    /** why the last press on this rhythm went back to the row (a refusal or an error), or null */
    get refusal() { return refusal; },
    glyph() {
      if (!tab.view.hasRhythm && store.lens === 'row') return 'hidden';
      if (store.lens === 'row') return 'ready';
      return phase === 'composing' || phase === 'animating' ? 'composing' : 'lit';
    },
    tip() { const g = api.glyph(); return g === 'ready' && refusal ? `Compose — ${refusal}` : GLYPH_TIPS[g]; },
    canPress() { tab.syncRhythm(); return tab.view.hasRhythm || store.lens === 'composition'; },
    /** the glyph: a lens toggle, never a stop → a promise of the phase once it settles (landed, or idle: the row) */
    press({ pace: p = 1 } = {}) { return store.lens === 'composition' ? Promise.resolve(api.toRow()) : api.toComposition({ pace: p }); },

    async toComposition({ pace: p = 1 } = {}) {
      tab.syncRhythm();
      if (store.lens === 'composition') return phase;
      if (!tab.view.hasRhythm) return 'idle';
      const my = ++session;
      pace = Number(p) > 0 ? Number(p) : 1;
      refusal = null;
      const done = new Promise((resolve) => { settle = resolve; });
      host.stopMain?.();
      // the lit nodes are a Linear Plot's: switch to it, and remember the type to put back (proposed)
      const prior = host.plotType?.() ?? null;
      priorPlot = null;
      if (prior && prior !== 'linear') { switching = true; try { host.setPlotType?.('linear'); } finally { switching = false; } priorPlot = prior; }
      lensKey = store.key;
      store.setLens('composition');
      seat.claim('lens');
      each('enter');
      startLoop();
      host.refreshTransport?.();
      if (store.recallable(lensKey)) {
        // the short version (proposed), with the work shown and motion allowed; else straight to the landing
        const trace = store.state.trace;
        if (tab.view.showWork && motion() && trace) {
          animator.cancel(); overlay.setScene(true); ownScene = true; redraw();
          if (animate(trace, { short: true, recalled: true })) return done;
        }
        land(my, { recalled: true }); return done;
      }
      if (store.refused(lensKey)) { refusal = refusalText(store.state.spec); api.toRow(); return done; }   // known: no re-solve

      // compose (or join the compose in flight for this rhythm)
      phase = 'composing';
      const work = !!tab.view.showWork, moving = work && motion(), short = fullShown.has(lensKey);
      animRecalled = false; skipQueued = false;
      if (moving) { animator.wait(); overlay.setScene(true); ownScene = true; redraw(); }
      emit('composing', { showWork: work, animate: moving, short });
      const key = lensKey, spec = await core.compose({ trace: work });
      if (my !== session || store.lens !== 'composition') return done;   // the lens moved on; the composition is cached
      const st = store.entry(key)?.state ?? null;
      if (!st || !st.spec || st.spec.refused || st.status === 'error') {
        refusal = st?.status === 'error' ? `error: ${st.error}` : refusalText(st?.spec) || 'this rhythm can\'t be composed';
        api.toRow();
        return done;
      }
      store.made(key, 'glyph');
      if (moving) fullShown.add(key);   // seen, or skipped: the next show of this rhythm is the short one
      if (moving && st.trace && !skipQueued && animate(st.trace, { short, recalled: false })) return done;
      land(my);
      return done;
    },

    /** back to the row: everything as it was (the composition kept in the store) */
    toRow({ restorePlot = true } = {}) {
      session++;
      if (store.lens !== 'composition') { resolveSettle(); return phase; }
      dropScene();
      phase = 'idle'; animRecalled = false; animShort = false;
      stopLoop();
      if (core.state.status === 'playing') core.stop();
      store.setLens('row');
      each('leave');
      seat.release('lens');   // no one left holding it: the plot is drawn exactly as before
      if (priorPlot && restorePlot) { switching = true; try { host.setPlotType?.(priorPlot); } finally { switching = false; } }
      priorPlot = null; lensKey = null; lastPlaying = false;
      host.refreshTransport?.();
      emit('row');
      resolveSettle();
      return phase;
    },
    /** the animation jumps to its landing (and plays) → whether it did. During Compose with the work shown, the skip
     *  is queued: the compose lands straight on the landing (sprint 2, step 2) */
    skip() {
      if (phase === 'animating') { emit('skip', { queued: false }); land(session, { recalled: animRecalled }); return true; }
      if (phase === 'composing' && ownScene && !skipQueued) { skipQueued = true; emit('skip', { queued: true }); return true; }
      return false;
    },
    /** is a skip waiting for Compose to finish? */
    get skipQueued() { return skipQueued; },

    transport: Object.freeze({
      /** does the main Play/Stop belong to the composition now? */
      owns: () => store.lens === 'composition',
      isPlaying: () => store.lens === 'composition' && core.state.status === 'playing',
      toggle() {
        if (store.lens !== 'composition') return false;
        if (phase === 'animating') { api.skip(); return true; }
        if (phase === 'composing') return true;   // nothing to play yet
        if (core.state.status === 'playing') core.stop(); else core.perform();
        return true;
      },
    }),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    onFrame(f) { frameListeners.add(f); return () => frameListeners.delete(f); },
    /** the plot type the lens will put back on the way out (null: none) */
    get priorPlot() { return priorPlot; },
  };

  // a new rhythm or cycle (a new store key), or the rhythm gone: back to the row, the glyph re-armed
  store.subscribe(({ type, key }) => {
    if (type !== 'select') return;
    refusal = null;
    if (store.lens === 'composition' && key !== lensKey) api.toRow();
    emit('glyph');
  });
  // the composition changed under the lens (parts, drums, a window Compose, playback): the panels and the button
  // follow, and the lit nodes on the main canvas (the window redraws them itself while it is shown)
  tab.onChange(() => {
    if (store.lens !== 'composition') return;
    if (phase === 'landed' && !tabShown()) redraw();
    each('update');
    host.refreshTransport?.();
    emit('change');
  });
  // a plot type picked by hand under the lens: the lit nodes are the Linear Plot's, so the lens goes back to the row
  // and the user's pick stands (proposed)
  host.onVizChanged?.((type) => { if (!switching && store.lens === 'composition' && type && type !== 'linear') { priorPlot = null; api.toRow({ restorePlot: false }); } });
  // the row started playing (it can't from the transport under the lens; another path did): the row it is
  tab.onMainStarted?.(() => { if (store.lens === 'composition') api.toRow(); });
  return api;
}
