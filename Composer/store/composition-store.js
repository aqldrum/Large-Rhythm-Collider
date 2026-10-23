// composition-store.js — the main page's one composition store (Composer sprint 2, step 1). PURE: no DOM, no audio,
// no clock. The glyph, the main-canvas overlay, the part strips and the Composer window all read the same entries.
//
// A composition is a reading of the row, so it is keyed by the rhythm it reads: its four layers and its cycle
// (rhythmKey). An entry IS one composition's state, the object the shared controller (perform/composer-controller.js)
// acts on: its input, knob overrides, table, spec and trace, the parts as they play now (on/off, sound, legato) and
// their levels, the drum options and drums, the progression, the playback tempo, and the status and dirty flags. The
// page's controller is bound to the current entry (controller.bind); a rhythm change binds another one, so whatever
// was made last for a rhythm, by the glyph or by hand in the window, is still there when the rhythm comes back.
//
//   rhythmKey({ layers, cycleSeconds })   → '8:7:6:5@4' (the layers as four whole numbers, 0 absent)
//   newCompositionState(input)            → a fresh entry state (the controller's own shape; the lab makes one too)
//   createCompositionStore({ capacity })  → the store:
//     select(rhythm | null)               the page's rhythm → { key, state, moved, created }; null: no rhythm
//     key, state, entry(key), keys()      the current key and state; an entry; the keys, least recently used first
//     recallable(key)                     has this rhythm a composition to recall (made, not refused)? no re-solve
//     made(key, by)                       who made the last spec: 'glyph' | 'window' (informational; step 2 reads it)
//     lens, setLens('row' | 'composition') the page-level lens
//     notify(key, type), subscribe(fn)    fn({ type, key, store }): select · lens · made · change · evict
//     keyOfState(state)                   the key an entry state is stored under (or null)
//
// The LRU keeps `capacity` rhythms (proposed: 4). The least recently selected goes first, never the current one and
// never one whose compose is in flight (the store may run over its capacity until that compose lands). A new cycle of
// the same layers starts from that row's last entry's edits (seed, knobs, table, progression, drum options, levels,
// glide), not its spec (proposed: the edits belong to the row, the spec to the row at that cycle). New layers start
// fresh. One compose in flight per entry is the controller's rule (a second Compose of the same entry joins the
// first); a compose keeps running when its rhythm stops being current, and lands in its own entry.

import { PART_IDS } from '../core/compose.js';
import { DEFAULT_KIT } from '../core/drums.js';

export const STORE_VERSION = 'composition-store-v1';
/** how many rhythms the store keeps (proposed) */
export const STORE_CAPACITY = 4;
export const LENSES = Object.freeze(['row', 'composition']);
export const KNOB_NAMES = Object.freeze(['bars', 'slotsPerBar', 'frameCentsEachSide', 'modulation', 'anchors', 'settlePasses', 'presence']);

/** four layers as whole numbers (0 absent) */
export const normalLayers = (layers = []) => [0, 1, 2, 3].map((i) => { const v = Number(layers[i]); return Number.isInteger(v) && v > 0 ? v : 0; });
/** the store's key for a rhythm: its layers and its cycle */
export function rhythmKey({ layers, cycleSeconds } = {}) {
  const T = Number(cycleSeconds);
  return `${normalLayers(layers).join(':')}@${T > 0 ? T : 0}`;
}

/** a fresh composition state: the shape the shared controller acts on */
export function newCompositionState({ layers = [0, 0, 0, 0], cycleSeconds = 10, seed = 1 } = {}) {
  return {
    input: { layers: normalLayers(layers), cycleSeconds: Number(cycleSeconds) > 0 ? Number(cycleSeconds) : 10, seed },
    knobs: Object.fromEntries(KNOB_NAMES.map((k) => [k, null])),
    table: 'full', spec: null, parts: {}, levels: { ...Object.fromEntries(PART_IDS.map((id) => [id, 0.8])), drums: 0.8 }, glideMs: 12, tempoBpm: null,
    drumOptions: { enabled: true, mode: 'backbeat', fills: true, kit: { ...DEFAULT_KIT } }, drums: null,
    status: 'idle', error: null, lastMs: null, dirty: true,
    progression: [], trace: null,
  };
}

/** a new cycle of the same row: the row's edits carried over, the spec not (proposed) */
function inheritEdits(to, from) {
  to.input.seed = from.input.seed;
  to.knobs = { ...from.knobs };
  to.table = from.table;
  to.progression = [...from.progression];
  to.drumOptions = { ...from.drumOptions, kit: { ...from.drumOptions.kit } };
  to.levels = { ...from.levels };
  to.glideMs = from.glideMs;
  return to;
}

export function createCompositionStore({ capacity = STORE_CAPACITY } = {}) {
  if (!(Number.isInteger(capacity) && capacity >= 1)) throw new Error(`composition store: capacity ${capacity}`);
  const entries = new Map();   // key → { key, rhythm, state, madeBy }; Map order is the LRU order (oldest first)
  const byState = new WeakMap();
  const listeners = new Set();
  let current = null, lens = 'row';

  const emit = (type, key) => { for (const f of [...listeners]) f({ type, key, store: api }); };
  const sameLayers = (a, b) => a.every((v, i) => v === b[i]);
  function evict() {
    if (entries.size <= capacity) return;
    for (const [key, e] of entries) {
      if (entries.size <= capacity) break;
      if (key === current || e.state.status === 'composing') continue;
      entries.delete(key); byState.delete(e.state);
      emit('evict', key);
    }
  }

  const api = {
    version: STORE_VERSION,
    capacity,
    /** the page's rhythm → { key, state, moved, created }: the entry made (or recalled) and made current */
    select(rhythm) {
      if (!rhythm || !normalLayers(rhythm.layers).some((v) => v > 0)) {
        const moved = current !== null;
        current = null;
        if (moved) emit('select', null);
        return { key: null, state: null, moved, created: false };
      }
      const layers = normalLayers(rhythm.layers), cycleSeconds = Number(rhythm.cycleSeconds) > 0 ? Number(rhythm.cycleSeconds) : 10;
      const key = rhythmKey({ layers, cycleSeconds });
      let e = entries.get(key), created = false;
      if (e) { entries.delete(key); entries.set(key, e); }   // most recently used
      else {
        created = true;
        const state = newCompositionState({ layers, cycleSeconds });
        // the same row at another cycle: its edits carry over (the most recent such entry)
        const kin = [...entries.values()].reverse().find((x) => sameLayers(x.state.input.layers, layers));
        if (kin) inheritEdits(state, kin.state);
        e = { key, rhythm: { layers, cycleSeconds }, state, madeBy: null };
        entries.set(key, e); byState.set(state, key);
      }
      const moved = key !== current;
      current = key;
      evict();
      if (moved) emit('select', key);
      return { key, state: e.state, moved, created };
    },
    get key() { return current; },
    get state() { return current ? entries.get(current)?.state ?? null : null; },
    entry: (key = current) => (key ? entries.get(key) ?? null : null),
    has: (key) => entries.has(key),
    keys: () => [...entries.keys()],
    get size() { return entries.size; },
    keyOfState: (state) => (state ? byState.get(state) ?? null : null),
    /** a composition to recall for this rhythm (made and not refused): the glyph plays it with no re-solve */
    recallable(key = current) {
      const s = key ? entries.get(key)?.state : null;
      return !!(s && s.spec && !s.spec.refused && s.status !== 'composing' && s.status !== 'error');
    },
    made(key, by) {
      const e = key ? entries.get(key) : null;
      if (!e) return;
      e.madeBy = by;
      emit('made', key);
    },
    get lens() { return lens; },
    setLens(next) {
      if (!LENSES.includes(next)) throw new Error(`composition store: no lens ${next}`);
      if (next === lens) return false;
      lens = next;
      emit('lens', current);
      return true;
    },
    /** an entry changed (the controller acted on it) */
    notify(key, type = 'change') { emit(type, key); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}
