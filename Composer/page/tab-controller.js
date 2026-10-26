// tab-controller.js — the main page's Composer tab: its state and actions, with no DOM (composer-tab.js is the view,
// composer-bridge.js wires it to the page). It is the shared controller (Composer/perform/composer-controller.js, the
// same one the lab runs) plus what belongs to the page:
//
//   rhythm     Compose reads the CURRENT main-page rhythm: host.readRhythm() → { layers, cycleSeconds } (LRCModule's
//              layers, Playback's cycle). syncRhythm() takes it over; a change stops Composer playback and turns the
//              button back to Compose (new layers also clear the progression). There is no rhythm before the page has
//              generated one: the button stays Compose and does nothing.
//   one sound  Perform first stops main playback (host.stopMain; Partitions plays only under it). Main playback
//              starting (host.onMainStarted) stops the Composer. Closing the tab stops it too (proposed).
//   selection  one part is selected (lead by default): the inspector shows it, and its section (Harmony, Lines,
//              Drums, Tuning) follows it unless picked by hand.
//   plot       highlights(plot) → plot-highlights.js' lit nodes of the spec as it plays now (memoized on the spec, the
//              parts, the drums and the plot), or null when the spec isn't of the plotted rhythm.
//   show work  view.showWork (on by default; the view keeps it in localStorage): the Compose button asks for the compose
//              trace (state.trace) and the view animates it (compose-animator.js). Off, Compose is exactly as before.
//   store      (sprint 2) the tab is a view and editor of the page's composition store (Composer/store/): syncRhythm
//              selects the page's rhythm in the store and binds the controller to that entry, so `state` is the
//              current rhythm's composition. A compose started for one rhythm lands in that rhythm's entry even if
//              the page has moved on (it is cached, not dropped); coming back to the rhythm recalls it.
//   lens       keepPlaying () → true while the Composition lens owns playback: closing the tab doesn't stop it then.
//   cell       (STEP 4e: the matrix) the selection is a CELL, a part and a bar (view.selected, view.bar): the inspector's
//              context section ('cell', the default) follows it; selectCell(part, bar) picks one (a lead cell is its
//              phrase). select(part) keeps the bar. cellFocus(plot) → the cell's lit nodes, which the overlay rings
//              on the mirrored plot while the context section is shown (its getFocus seam).
//   target     (MIDI targets, phase B) setTarget(bytes | null, { name, tonic }) → the shared controller's, on the
//              page's rhythm (no rhythm: refused, said); setTargetTonic(pc | null); auditionPlacement(i),
//              keepPlacement(), revertPlacement(). A file that won't decode leaves the entry as it was and says why
//              in view.targetError (target-lines.js targetError); a target compose is the window's (store.made).

import { createComposerController, kitChoices as sharedKitChoices } from '../perform/composer-controller.js';
import { highlightsOf, plotOf, indexOfTick, HIGHLIGHT_PARTS } from './plot-highlights.js';
import { phraseSpans, cellSpan } from './matrix.js';
import { createCompositionStore } from '../store/composition-store.js';
import { targetError } from './target-lines.js';

export const TAB_VERSION = 'composer-tab-v1';
/** the site's samples, relative to index.html */
export const PAGE_SAMPLES_BASE = 'assets/audio/';
export const SECTIONS = Object.freeze(['harmony', 'lines', 'drums', 'tuning']);
export const SECTION_LABELS = Object.freeze({ harmony: 'Harmony', lines: 'Lines', drums: 'Drums', tuning: 'Tuning' });
/** the section a part opens on (proposed) */
export const SECTION_OF = Object.freeze({ lead: 'lines', chords: 'harmony', comp: 'lines', bass: 'lines', inner: 'lines', drums: 'drums' });
/** STEP 4e: the inspector's context section, the selected cell's (the default; proposed) */
export const CONTEXT_SECTION = 'cell';
export const kitChoices = (voice) => sharedKitChoices(voice, PAGE_SAMPLES_BASE);

/**
 * createTabController({ host, runCompose, createContext, timers, clock, store, keepPlaying })
 *   host   { readRhythm () → { layers, cycleSeconds } | null, stopMain (), onMainStarted (fn) → unsubscribe }
 *   store  the page's composition store (a store of its own by default)
 *   keepPlaying () → whether closing the tab leaves playback alone (the Composition lens owns it)
 *   the rest as the shared controller's
 */
export function createTabController({ host = {}, runCompose, createContext, timers, clock, store = createCompositionStore(), keepPlaying = () => false } = {}) {
  const core = createComposerController({ runCompose, createContext, timers, clock, beforePerform: () => host.stopMain?.() });
  const view = { open: false, selected: 'lead', bar: 0, section: CONTEXT_SECTION, hasRhythm: false, showWork: true, targetError: null };
  const listeners = new Set(), mainListeners = new Set();
  const changed = () => { for (const f of listeners) f(core.state, view); };
  // a change to any entry the controller acts on (the bound one, or one whose compose just landed) is the store's too
  core.onChange((st) => { changed(); const key = store.keyOfState(st); if (key) store.notify(key); });
  let memo = { key: null, value: null }, focusMemo = { key: null, value: null };

  const api = {
    core,
    store,
    /** the current rhythm's composition (the store's entry the controller is bound to) */
    get state() { return core.state; },
    view,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },

    /** take over the page's rhythm: select it in the store and bind its entry → whether it changed anything */
    syncRhythm() {
      const r = host.readRhythm ? host.readRhythm() : null;
      const has = !!(r && r.layers && r.layers.some((v) => v > 0)), flipped = has !== view.hasRhythm;
      view.hasRhythm = has;
      if (!has) { store.select(null); if (flipped) { core.stop(); changed(); } return flipped; }
      const { state } = store.select(r);
      if (state !== core.state) view.targetError = null;   // MIDI targets: a decode error was the other rhythm's
      const moved = core.bind(state);   // a bind stops playback and re-renders itself
      if (flipped && !moved) changed();
      return moved || flipped;
    },
    /** the store's key of the rhythm the tab is on (null with none) */
    key: () => (view.hasRhythm ? store.keyOfState(core.state) : null),
    /** what the main button says: Compose with no rhythm on the page (and it does nothing) */
    button: () => core.button(),
    canPress: () => view.hasRhythm && core.button() !== 'Composing…',
    async press() {
      api.syncRhythm();
      if (!view.hasRhythm) return null;
      if (core.button() === 'Compose') {
        const key = api.key(), spec = await core.compose({ trace: view.showWork });
        if (spec && store.keyOfState(core.state) === key) store.made(key, 'window');
        return spec;
      }
      return core.press();
    },
    // ── MIDI targets (phase B) ──
    /** a clip (a .mid file's bytes) as the lead of the page's rhythm's composition, or null to clear it → the
     *  controller's answer ({ ok, error? }); a decode error is said in view.targetError and changes nothing */
    async setTarget(source, opts = {}) {
      api.syncRhythm();
      if (source != null && !view.hasRhythm) {
        view.targetError = 'Generate a rhythm on the main page first: the clip is placed in its row.';
        changed();
        return { ok: false, error: view.targetError };
      }
      view.targetError = null;
      const key = api.key(), had = !!core.state.input.target;
      const r = await core.setTarget(source, opts);
      if (!r.ok && !r.spec) view.targetError = targetError(r.error);   // a refused compose says why in the refusal line
      else if (r.spec && (source != null || had) && store.keyOfState(core.state) === key) store.made(key, 'window');
      changed();
      return r;
    },
    /** the tonic override (P5): a pitch class, or null (the estimate); the clip placed again */
    async setTargetTonic(tonic) { const key = api.key(), r = await core.setTargetTonic(tonic); if (r.spec && store.keyOfState(core.state) === key) store.made(key, 'window'); return r; },
    auditionPlacement: (i) => core.auditionPlacement(i),
    keepPlacement: () => core.keepPlacement(),
    revertPlacement: () => core.revertPlacement(),
    /** "show the work": animate Compose from its trace, or not */
    setShowWork(on) { const v = !!on; if (v === view.showWork) return; view.showWork = v; changed(); },
    /** the main page started playing: the Composer gives way (and so does an animation of Compose) */
    mainStarted() { if (core.state.status === 'playing') core.stop(); for (const f of [...mainListeners]) f(); },
    onMainStarted(f) { mainListeners.add(f); return () => mainListeners.delete(f); },

    open() { view.open = true; api.syncRhythm(); changed(); },
    close() { view.open = false; if (!keepPlaying()) core.stop(); changed(); },

    /** a part (its name in the matrix, the strips' pick): the bar is kept; on a settings section, the part's own */
    select(id) {
      if (!HIGHLIGHT_PARTS.includes(id)) throw new Error(`composer tab: no part ${id}`);
      view.selected = id;
      if (view.section !== CONTEXT_SECTION) view.section = SECTION_OF[id];
      changed();
    },
    /** STEP 4e: a cell of the matrix (part, bar): the inspector's context section shows it */
    selectCell(id, bar) {
      if (!HIGHLIGHT_PARTS.includes(id)) throw new Error(`composer tab: no part ${id}`);
      const N = api.bars();
      if (!(Number.isInteger(bar) && bar >= 0 && (N === 0 || bar < N))) throw new Error(`composer tab: no bar ${bar}`);
      view.selected = id; view.bar = bar; view.section = CONTEXT_SECTION; changed();
    },
    setSection(name) {
      if (!SECTIONS.includes(name) && name !== CONTEXT_SECTION) throw new Error(`composer tab: no section ${name}`);
      view.section = name; changed();
    },
    /** the composition's bars (0 with none) */
    bars: () => (core.state.spec && !core.state.spec.refused ? core.state.spec.knobs.bars : 0),
    /** the selected cell: { part, bar, from, to } (a lead cell spans its phrase), the bar kept inside the meter */
    cell() {
      const N = api.bars();
      if (N && view.bar >= N) view.bar = N - 1;
      const spans = N ? phraseSpans(core.state.spec) : [];
      return { part: view.selected, bar: view.bar, ...cellSpan(view.selected, view.bar, spans) };
    },
    /** the selected cell's lit nodes on the plot: { part, indices } (null: no context shown, or nothing to light) */
    cellFocus(plotted) {
      const s = core.state;
      if (!view.open || view.section !== CONTEXT_SECTION || !s.spec || s.spec.refused) return null;
      const plot = plotOf(plotted || {}), c = api.cell(), parts = core.currentParts();
      const key = [s.spec, s.drums, plot?.ticks, plot?.grid, c.part, c.from, c.to, ...parts];
      if (focusMemo.key && focusMemo.key.length === key.length && focusMemo.key.every((v, i) => v === key[i])) return focusMemo.value;
      let value = null;
      if (plot && api.highlights(plotted)) {
        const items = c.part === 'drums' ? s.drums?.hits ?? [] : parts.find((p) => p.id === c.part)?.notes ?? [];
        const seen = new Set();
        for (const it of items) if (it.bar >= c.from && it.bar < c.to) { const i = indexOfTick(plot.ticks, it.tick); if (i >= 0) seen.add(i); }
        value = { part: c.part, from: c.from, to: c.to, indices: [...seen].sort((a, b) => a - b) };
      }
      focusMemo = { key, value };
      return value;
    },

    /** the lit nodes of the spec as it plays now, on the rhythm plotted ({ compositeRhythm, grid }) */
    highlights(plotted) {
      const plot = plotOf(plotted || {}), s = core.state;
      const parts = s.spec && !s.spec.refused ? core.currentParts() : null;
      const key = [s.spec, s.drums, plot?.ticks, plot?.grid, ...(parts || [])];
      if (memo.key && memo.key.length === key.length && memo.key.every((v, i) => v === key[i])) return memo.value;
      const value = plot && parts ? highlightsOf({ spec: s.spec, parts, drums: s.drums }, plot) : null;
      memo = { key, value };
      return value;
    },
    /** where Perform is: { p (0..1 of the cycle), t (seconds) } or null */
    playheadAt() {
      const p = core.playhead();
      return p == null || !core.state.spec ? null : { p, t: p * core.state.spec.knobs.cycleSeconds };
    },
    kitChoices,
  };
  if (host.onMainStarted) host.onMainStarted(() => api.mainStarted());
  api.syncRhythm();
  return api;
}
