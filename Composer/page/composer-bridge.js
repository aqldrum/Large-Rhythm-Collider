// Composer/page/composer-bridge.js — the Composer tab for the main page's classic <script> globals, the way
// Audio/lrc-voices-bridge.js exposes the voice library.
//
// Loaded from index.html as a module; it sets window.lrcComposer and announces itself with an `lrccomposerready`
// event. PartitionsUI.js (the Partitions window) calls it when its Composer tab is picked:
//   lrcComposer.mountTab({ left, inspector })   fill the window's two hosts (again if the window was rebuilt)
//   lrcComposer.showTab() / hideTab()           the tab shown or left (leaving it stops Composer playback)
//   lrcComposer.isPlaying(), stop()
// Everything the page provides goes through pageHost(window): the rhythm (LRCModule's layers, Playback's cycle), main
// playback (stopped before the Composer performs; its start stops the Composer), and the Linear Plot (LRCVisuals).

import { createTabController, TAB_VERSION } from './tab-controller.js';
import { createComposerTab } from './composer-tab.js';
import { createComposeRunner } from '../perform/compose-runner.js';

export const COMPOSER_BRIDGE_VERSION = 'composer-bridge-v1';

/** the page, as the tab controller sees it */
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
  };
}

/** the bridge over a window (the page's, or a test's stub) */
export function createComposerBridge(win, { runCompose = createComposeRunner(), createContext, timers } = {}) {
  const tab = createTabController({ host: pageHost(win), runCompose, createContext, timers });
  const view = createComposerTab({ tab, doc: win.document, visuals: () => win.lrcVisuals ?? null, raf: (f) => win.requestAnimationFrame(f) });
  // a new rhythm on the page: Compose again (the tab also checks on every frame while shown, for the cycle)
  win.addEventListener('rhythmGenerated', () => tab.syncRhythm());
  win.addEventListener('vizTypeChanged', () => { if (view.shown) view.render(); });
  return Object.freeze({
    version: COMPOSER_BRIDGE_VERSION, tabVersion: TAB_VERSION,
    mountTab: (hosts) => view.mount(hosts),
    showTab: () => view.show(),
    hideTab: () => view.hide(),
    isShown: () => view.shown,
    isPlaying: () => tab.state.status === 'playing',
    stop: () => tab.core.stop(),
    controller: tab,
    overlay: view.overlay,
  });
}

if (typeof window !== 'undefined' && window.document) {
  window.lrcComposer = createComposerBridge(window);
  window.dispatchEvent(new Event('lrccomposerready'));
}
