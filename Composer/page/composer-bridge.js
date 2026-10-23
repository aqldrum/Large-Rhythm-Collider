// Composer/page/composer-bridge.js — the Composer for the main page's classic <script> globals, the way
// Audio/lrc-voices-bridge.js exposes the voice library.
//
// Loaded from index.html as a module; it sets window.lrcComposer and announces itself with an `lrccomposerready`
// event. PartitionsUI.js (the Partitions window) calls it when its Composer tab is picked:
//   lrcComposer.mountTab({ left, inspector })   fill the window's two hosts (again if the window was rebuilt)
//   lrcComposer.showTab() / hideTab()           the tab shown or left (leaving it stops Composer playback, except
//                                               under the Composition lens, which owns playback then)
//   lrcComposer.isPlaying(), stop()
//   lrcComposer.animator                        the Compose animation's driver (compose-animator.js), for a look
// Everything the page provides goes through pageHost(window): the rhythm (LRCModule's layers, Playback's cycle), main
// playback (stopped before the Composer performs; its start stops the Composer), and the Linear Plot (LRCVisuals).
//
// Sprint 2, step 1 — the Composition lens. One composition store (Composer/store/composition-store.js) is shared by
// everything here: the glyph in the header (toolbar-glyph.js), the main-canvas overlay (one overlay, one seat), the
// Playback div's part strips (part-strips.js), the Scale and Families locks (panel-locks.js) and the Composer window
// (the tab, now an editor of the store). The page API for later steps:
//   lrcComposer.lens        lens.js: mode, phase, glyph(), press({ pace }), toComposition({ pace }), toRow(), skip(),
//                           onChange(fn) — a tutorial presses the glyph with lens.press(), and step 2's theater listens
//                           to 'composing' / 'animating' / 'landed' / 'row'
//   lrcComposer.transport   { owns(), isPlaying(), toggle() }: ToneRowPlayback routes the one Play/Stop through it
//   lrcComposer.store       the composition store (read it; the controller writes it)
//   lrcComposer.glyph       the glyph view (its element, its state)

import { createTabController, TAB_VERSION } from './tab-controller.js';
import { createComposerTab } from './composer-tab.js';
import { createComposeRunner } from '../perform/compose-runner.js';
import { createCompositionStore } from '../store/composition-store.js';
import { createPlotOverlay, createOverlaySeat } from './plot-overlay.js';
import { createComposeAnimator } from './compose-animator.js';
import { createLens } from './lens.js';
import { createToolbarGlyph } from './toolbar-glyph.js';
import { createPartStrips } from './part-strips.js';
import { createScaleLock, createFamiliesLock } from './panel-locks.js';

export const COMPOSER_BRIDGE_VERSION = 'composer-bridge-v2';

/** the page, as the tab controller and the lens see it */
export function pageHost(win) {
  return {
    /** the current main-page rhythm: { layers: [a, b, c, d] (0 absent), cycleSeconds }, or null before one exists */
    readRhythm() {
      const m = win.lrcModule;
      if (!m || !(m.currentGrid > 0) || !m.currentCompositeRhythm || !m.currentCompositeRhythm.length) return null;
      // the site spells an absent layer 1 (its inputs' minimum; its own readouts count only layers > 1): a layer of 1
      // strikes only tick 0, which every layer strikes, so it adds no onset and Compose is given it as absent
      const raw = [0, 1, 2, 3].map((i) => { const v = Number(m.currentRhythms?.[i]); return Number.isInteger(v) && v > 0 ? v : 0; });
      const layers = raw.some((v) => v > 1) ? raw.map((v) => (v > 1 ? v : 0)) : raw;
      const T = Number(win.toneRowPlayback?.cycleDuration);
      return { layers, cycleSeconds: T > 0 ? T : 10 };
    },
    /** one thing sounds at a time: main playback (and Partitions, which plays under it) stops */
    stopMain() { const p = win.toneRowPlayback; if (p && p.isPlaying && typeof p.stopPlayback === 'function') p.stopPlayback(); },
    onMainStarted(fn) { win.addEventListener('playbackStarted', fn); return () => win.removeEventListener('playbackStarted', fn); },
    // ── the lens's (sprint 2) ──
    visuals: () => win.lrcVisuals ?? null,
    plotType: () => win.lrcVisuals?.currentPlotType ?? null,
    /** the HUD's own switch when it is there (it keeps the Visualizations panel's sections in step), else the plot's */
    setPlotType(type) {
      if (win.lrcHUD && typeof win.lrcHUD.setVisualizationType === 'function') win.lrcHUD.setVisualizationType(type);
      else win.lrcVisuals?.setPlotType?.(type);
    },
    onVizChanged(fn) {
      const h = (e) => fn(e?.detail?.currentType ?? win.lrcVisuals?.currentPlotType ?? null);
      win.addEventListener('vizTypeChanged', h);
      return () => win.removeEventListener('vizTypeChanged', h);
    },
    /** the Playback div's Play/Stop (and the Partitions window's) show whatever the canvas plays */
    refreshTransport() { win.toneRowPlayback?.updatePlayButton?.(); },
  };
}

/** the bridge over a window (the page's, or a test's stub) */
export function createComposerBridge(win, { runCompose = createComposeRunner(), createContext, timers, clock, storage, session } = {}) {
  const doc = win.document, host = pageHost(win);
  const store = createCompositionStore();
  const tab = createTabController({ host, runCompose, createContext, timers, store, keepPlaying: () => store.lens === 'composition' });
  const local = storage !== undefined ? storage : (() => { try { return win.localStorage ?? null; } catch { return null; } })();
  const sess = session !== undefined ? session : (() => { try { return win.sessionStorage ?? null; } catch { return null; } })();
  const visuals = () => win.lrcVisuals ?? null;
  const plotted = () => { const v = visuals(); return v && v.compositeRhythm ? { compositeRhythm: v.compositeRhythm, grid: v.grid } : null; };
  // the page's one overlay, and its seat: the tab while shown, the lens while on
  const overlay = createPlotOverlay({ getHighlights: () => tab.highlights(plotted()), getSelected: () => tab.view.selected, makeCanvas: () => doc.createElement('canvas') });
  const seat = createOverlaySeat({ visuals, overlay });
  const view = createComposerTab({ tab, doc, visuals, raf: (f) => win.requestAnimationFrame(f), clock, storage: local, overlay, seat });
  const panels = [
    createPartStrips({ doc, tab, highlights: () => tab.highlights(plotted()), layerMap: () => win.lrcModule?.currentLayerMap ?? null }),
    createScaleLock({ doc, tab, playback: () => win.toneRowPlayback ?? null }),
    createFamiliesLock({ doc }),
  ];
  const lens = createLens({ tab, store, host, overlay, seat, animator: createComposeAnimator(clock ? { clock } : {}), raf: (f) => win.requestAnimationFrame(f), doc, panels, tabShown: () => view.shown, plotted });
  const glyph = createToolbarGlyph({ doc, lens, session: sess, timers: timers && timers.setTimeout ? timers : win });
  // a new rhythm on the page: the store selects it (the lens goes back to the row; the glyph re-arms); the tab also
  // checks on every frame while shown, and the lens while it is on, for the cycle
  win.addEventListener('rhythmGenerated', () => tab.syncRhythm());
  win.addEventListener('vizTypeChanged', () => { if (view.shown) view.render(); });
  tab.syncRhythm();
  glyph.render();
  return Object.freeze({
    version: COMPOSER_BRIDGE_VERSION, tabVersion: TAB_VERSION,
    mountTab: (hosts) => view.mount(hosts),
    showTab: () => view.show(),
    hideTab: () => view.hide(),
    isShown: () => view.shown,
    isPlaying: () => tab.state.status === 'playing',
    stop: () => tab.core.stop(),
    controller: tab,
    overlay,
    seat,
    animator: view.animator,
    store,
    lens,
    transport: lens.transport,
    glyph,
    panels: Object.freeze({ strips: panels[0], scale: panels[1], families: panels[2] }),
  });
}

if (typeof window !== 'undefined' && window.document) {
  window.lrcComposer = createComposerBridge(window);
  window.dispatchEvent(new Event('lrccomposerready'));
}
