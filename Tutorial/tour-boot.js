// tour-boot.js — the guided tour on the main page (Composer sprint 2, step 3): window.lrcTour, the header entry, and
// the first visit. Loaded from index.html as a module, after the Composer's bridge.
//
//   the header      the menu's Tutorial section: "Take the tour" (#tutorial-show-btn) starts it again, any time (the
//                   menu closes first); "Read the guide" (#tutorial-slides-btn) opens the old slides (TutorialUI.js)
//   first visit     proposed: the tour opens by itself once, AUTO_OPEN_DELAY_MS after the page's load, when the
//                   storage can say it hasn't been seen (tour-script.js autoOpen: never when the storage throws, never
//                   on a page launched with a rhythm in its URL, never in Cosmos)
//
//   bootTour(win, { storage, timers, tour }) → the tour (also window.lrcTour)

import { createTour } from './tour-driver.js';
import { autoOpen, AUTO_OPEN_DELAY_MS } from './tour-script.js';

export function bootTour(win, { storage, timers = win, tour = null } = {}) {
  const doc = win.document;
  const store = storage !== undefined ? storage : (() => { try { return win.localStorage ?? null; } catch { return null; } })();
  const t = tour ?? createTour({ win, doc, storage: store, timers });
  win.lrcTour = t;
  const closeMenu = () => {
    const panel = doc.getElementById('collections-panel'), toggle = doc.getElementById('collections-toggle');
    if (panel && panel.style.display === 'block' && toggle) toggle.click();
  };
  doc.getElementById('tutorial-show-btn')?.addEventListener('click', () => { closeMenu(); t.start(); });
  const inCosmos = () => !!doc.body?.classList?.contains('cosmos-active');
  let auto = false;
  const maybeOpen = () => {
    if (!autoOpen({ storage: store, search: win.location?.search ?? '' })) return;
    auto = true;
    timers.setTimeout(() => { if (!t.active && !inCosmos()) t.start(); }, AUTO_OPEN_DELAY_MS);
  };
  if (doc.readyState === 'complete') maybeOpen();
  else win.addEventListener('load', maybeOpen, { once: true });
  Object.defineProperty(t, 'autoOpening', { get: () => auto, configurable: true });
  return t;
}

if (typeof window !== 'undefined' && window.document && !globalThis.__LRC_TOUR_NO_BOOT__) bootTour(window);
