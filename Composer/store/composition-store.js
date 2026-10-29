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
//     recallable(key)                     has this rhythm a composition to recall? made, not refused, and not
//                                         edited since (an input, knob, seed or progression change makes it dirty:
//                                         the glyph composes again then; live edits — parts, levels, drums — don't)
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
//
// STEP 4d (DESIGN_NOTES "Step 4d: store edits and pins"; the controller acts on these, the store only holds them):
//   composed   Compose's own spec, never touched. `spec` is the composition as it is EDITED: composed + edits (the
//              same object as `composed` with no edits), so everything that plays or draws reads it as before.
//   edits      { chords: { [bar]: { rootTone, quality, from: 'swap' | 'typed', asked? } }, lead: { [phrase]: { lineId,
//              chordsFollow, smooth? } }, order: ['chord:3', 'lead:1', …] (the order they apply in), grid: { bars,
//              slotsPerBar, from } | null (the meter `drumOptions.grid` was written for, and the mode it came from) }.
//              Live edits: they never make the entry dirty, and the glyph recalls spec + edits with no re-solve.
//   field      { text } | null: the typed progression as the user typed it, kept as the field's source (proposed)
//   undo/redo  snapshots of { edits, field, the drum mode and grid }, at most UNDO_LIMIT (proposed: 50)
//              clave: { id?, relation? } | null (COMP_ARP_ORDER.md Amendment 1, phase E): the comp's clave ('steps:pattern'
//              or a curated name) and Sync | Fill as chosen in the window, each only where it differs from Compose's;
//              applied last over the other edits (rearrange.js `reclave`: every bar re-strummed over its chord as edited)
//   dropped    what the last Compose dropped (amber in the UI): { pins: [{ bar, ratio, quality, reason }],
//              unhonored: [{ bar, ratio, asked, got }], lead: [{ phrase, lineId }], grid: { was, now } | null,
//              p: { was, cells } | null (STEP 4c-prime: an asked drumOptions.p the new meter's cells outgrew),
//              clave: { id, pattern } | null (phase E: a chosen clave the new composition doesn't offer),
//              arps: [{ part, phrase, id }] (phase E: an arp pick the re-composed phrase no longer offers),
//              bass: [{ bar, id }] (phase H: a bass pick the re-composed bar no longer offers) } | null
//   progression the pin list Compose is sent: [ratio | { ratio, quality } | null] a bar (the lab's root picks are the
//              ratio form; a Compose bakes the chord edits in here as { ratio, quality })
// A new cycle of the same row carries the chord edits as pins (into `progression`), the typed field and the drum
// grid (the controller drops it on its next Compose if the meter moved), and the clave choice (phase E; dropped on
// its next Compose where that composition doesn't offer the clave); never the lead edits (decision 5).
//
// MIDI targets (phase B; DESIGN_NOTES "MIDI targets (phase B)"; the controller acts on these, the store only holds them):
//   input.target  { clip (midi.js decodeClip, as decoded: no bytes), tonic (a pitch class, or null: the clip's key
//                 estimate), placement? (a kept alternate placement; absent: the search's best) }, absent with no
//                 target. It is the entry's INPUT, so the glyph's recall, undo (the edits apply over the target's
//                 spec) and the LRU carry it with the rest of the entry.
//   placements    the last search's answer, for the window's alternates: { tonic, list: [best, …alternates]
//                 (target.js placements), current (the index playing), lanes } | null. A compose with a placement
//                 given (an alternate auditioned or kept) doesn't search, so it keeps the list.
// A new cycle of the same row carries both (proposed: a placement is the row's, its phase a share of the cycle).
//
// The Arp mode (COMP_ARP_ORDER.md B2, Q7; DESIGN_NOTES "Comping and Arp in the window"; the controller acts on it):
//   arps     { lead, inner }: each { mode: 'line' | 'arp', time (1 | 2 | 3), picks ({ [phrase]: an arp's id }) }
//            (core/arp.js' options, phase D; the knobs are kept while the part is in Line, so Arp comes back as it was). A choice saved with the composition, like the
//            drum grid: in the undo snapshots, kept through a re-compose and the glyph's recall, and (proposed) carried
//            to a new cycle of the same row. `spec` plays the arps (composed + edits, then arrangeArp); `composed`
//            never does. Phase E: a pick is keyed by the phrase at its time, so a change of Time drops the part's picks
//            (one undo step restores both); a re-compose keeps a pick its phrase still offers (an arp's id is a hash of
//            its notes) and drops the rest into `dropped.arps`.
//
// The bass and the chords' voicing (BASS_VOICING_ORDER.md phase H; DESIGN_NOTES "The window: bass and voicing (phase
// H)"; the controller acts on them):
//   bass     { density ('roots' | 'sparse' | 'moving' | 'walking'), lock ('free' | 'kick' | 'clave'), picks ({ [bar]: a
//            bass line's id }) } (core/bass.js' options; Amendment 2, rule 11: COMPOSE_BASS, Moving · Kick · none, is
//            Compose's own bass, and a Sparse · Free is an arrangement like any other). Like
//            the arps: in the undo snapshots, kept through a re-compose and the glyph's recall, carried to a new cycle of
//            the same row. `spec` plays it (arrangeBass over composed + edits, unless it is Compose's own over the kick
//            Compose covered); `composed` never does. A pick is keyed by the bar at a density and lock, so a change of either drops the picks (one undo step
//            restores both); a re-compose keeps a pick its bar still offers and drops the rest into `dropped.bass`.
//   voicing  'led' | 'close' (compose.js' override; 'led' is Compose's default). Live (rearrange.js `revoice`, the fold's
//            first step, so the edits after it voice as Compose would), in the snapshots, kept and carried like the bass;
//            Compose is sent `voicing: 'close'` when it is close, so a re-compose needs no switch.
//
// The comp's density (BASS_VOICING_ORDER.md Amendment 2, phase N; DESIGN_NOTES "The window over Amendment 2 (phase N)"):
//   compDensity  'sparse-med' | 'sparse' | 'medium' | 'dense' (compose.js' override; claves.js DEFAULT_COMP_DENSITY,
//            sparse–medium, is Compose's default): the tier a frame clave is chosen in. Live (rearrange.js `reclave` with
//            `{ density }`, the fold's step after the voicing's, so the chord edits after it re-read and re-rank in it),
//            in the snapshots, kept and carried like the voicing; Compose is sent it when it isn't the default.
//
// The comp's tolerance (BASS_VOICING_ORDER.md Amendment 3, phase O; DESIGN_NOTES "The comp's tolerance (phase O)"):
//   compTolerance  0.125 | 0.25 | 0.5 | 1 (compose.js' override, slots either side of a clave stroke; ±½ is Compose's
//            default), compBorrow  true | false ("fill from the chords"; false by default). Live (rearrange.js `restrum`,
//            the fold's step after the density's), in the snapshots, kept and carried like the density; Compose is sent
//            them when they aren't the defaults.

import { PART_IDS, DEFAULT_COMP_TOLERANCE } from '../core/compose.js';
import { DEFAULT_KIT } from '../core/drums.js';
import { ARP_PARTS, ARP_DEFAULTS } from '../core/arp.js';
import { COMPOSE_BASS } from '../core/bass.js';
import { DEFAULT_COMP_DENSITY } from '../core/claves.js';

export const STORE_VERSION = 'composition-store-v1';
/** how many rhythms the store keeps (proposed) */
export const STORE_CAPACITY = 4;
export const LENSES = Object.freeze(['row', 'composition']);
export const KNOB_NAMES = Object.freeze(['bars', 'slotsPerBar', 'frameCentsEachSide', 'modulation', 'anchors', 'settlePasses', 'presence']);
/** how many edits an entry's undo stack keeps (proposed) */
export const UNDO_LIMIT = 50;
/** no edits (phase E: `clave`, the comp's clave and relation chosen in the window, or null: Compose's own) */
export const emptyEdits = () => ({ chords: {}, lead: {}, order: [], grid: null, clave: null });
/** B2: every Arp part in Line, its knobs at the defaults (phase D: time ×1, no picks) */
export const lineArps = () => Object.fromEntries(ARP_PARTS.map((id) => [id, { mode: 'line', time: ARP_DEFAULTS.time, picks: {} }]));
/** phase H: Compose's own bass (Amendment 2, rule 11, P28: Moving, Kick, no picks; phase N) */
export const composedBass = () => ({ density: COMPOSE_BASS.density, lock: COMPOSE_BASS.lock, picks: {} });
/** phase H: is this bass Compose's own (nothing arranged over it, while the kick it covers plays; phase N)? */
export const isComposedBass = (b) => !b || (b.density === COMPOSE_BASS.density && b.lock === COMPOSE_BASS.lock && !Object.keys(b.picks ?? {}).length);
const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
/** a pin list entry copied (a ratio, { ratio, quality }, or null) */
const copyPin = (x) => (x && typeof x === 'object' ? { ...x } : x);

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
    // STEP 4d
    composed: null, edits: emptyEdits(), field: null, undo: [], redo: [], dropped: null,
    // MIDI targets (phase B): the last search's placements (input.target, when set, holds the clip)
    placements: null,
    // B2 (COMP_ARP_ORDER.md): the lead's and the inner's mode, Line or Arp, and the Arp's knobs
    arps: lineArps(),
    // phase H (BASS_VOICING_ORDER.md): the bass's density, lock and picks, and the chords' voicing
    bass: composedBass(), voicing: 'led',
    // phase N (Amendment 2): the comp's density tier
    compDensity: DEFAULT_COMP_DENSITY,
    // phase O (Amendment 3): the comp's tolerance (slots either side of a stroke) and borrowing from the chords
    compTolerance: DEFAULT_COMP_TOLERANCE, compBorrow: false,
  };
}

/** a new cycle of the same row: the row's edits carried over, the spec not (proposed) */
function inheritEdits(to, from) {
  to.input.seed = from.input.seed;
  to.knobs = { ...from.knobs };
  to.table = from.table;
  to.progression = from.progression.map(copyPin);
  // STEP 4d: the chord edits as pins (decision 5: a re-compose keeps them; a new cycle is one), the lead edits not
  for (const [bar, e] of Object.entries(from.edits?.chords ?? {})) {
    while (to.progression.length <= Number(bar)) to.progression.push(null);
    to.progression[Number(bar)] = { ratio: e.rootTone, quality: 'asked' in e ? e.asked : e.quality };
  }
  to.drumOptions = { ...from.drumOptions, kit: { ...from.drumOptions.kit }, ...(from.drumOptions.grid ? { grid: copy(from.drumOptions.grid) } : {}) };
  to.edits = { ...emptyEdits(), grid: copy(from.edits?.grid ?? null), clave: copy(from.edits?.clave ?? null) };
  to.field = copy(from.field ?? null);
  to.levels = { ...from.levels };
  to.glideMs = from.glideMs;
  // MIDI targets (phase B): the clip, its tonic and a kept placement, and the search's list (proposed)
  if (from.input.target) to.input.target = copy(from.input.target);
  to.placements = copy(from.placements ?? null);
  // B2: the Arp modes (proposed: a choice of the row's composition, like the drum options)
  to.arps = copy(from.arps ?? lineArps());
  // phase H: the bass and the voicing (proposed: as the arps)
  to.bass = copy(from.bass ?? composedBass());
  to.voicing = from.voicing ?? 'led';
  // phase N: the comp's density (proposed: as the voicing)
  to.compDensity = from.compDensity ?? DEFAULT_COMP_DENSITY;
  // phase O: the comp's tolerance and borrowing (proposed: as the density)
  to.compTolerance = from.compTolerance ?? DEFAULT_COMP_TOLERANCE;
  to.compBorrow = !!from.compBorrow;
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
    /** a composition to recall for this rhythm (made, not refused, its inputs not changed since): the glyph plays
     *  it with no re-solve (proposed: a dirty entry is composed again) */
    recallable(key = current) {
      const s = key ? entries.get(key)?.state : null;
      return !!(s && s.spec && !s.spec.refused && !s.dirty && s.status !== 'composing' && s.status !== 'error');
    },
    /** was this rhythm refused, its inputs unchanged since? (the glyph says why, with no re-solve) */
    refused(key = current) {
      const s = key ? entries.get(key)?.state : null;
      return !!(s && s.spec && s.spec.refused && !s.dirty && s.status === 'refused');
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
