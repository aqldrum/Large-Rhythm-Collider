// lab-controller.js — the Composer lab's state and actions, with no DOM: composer-lab.js is the thin view over it,
// and Composer/tests/assert-lab.mjs drives it in Node with a recording mock AudioContext.
//
//   input      four layers (0 or blank absent), the cycle in seconds, a seed
//   knobs      bars, slots per bar, frame ±¢, modulation, anchors: null leaves the choice to Compose; a value overrides
//   table      'full' runs Compose in the module worker (its default there), 'lean' on the main thread (its default
//              there), so neither is an override: where Compose runs decides the table, as phase 4 set it up
//   button     Compose → (Composing…) → Perform ⇄ Stop; any change of input, knob or table goes back to Compose
//   parts      the spec's parts as they play now: a sound, legato or on/off change re-articulates the part from the
//              spec with compose.js' own `rearticulate` (the decided legato rule), nothing re-mined; a level is the
//              part's bus
//   tempo      a playback tempo over the spec's own (TEMPO_LIMITS): the player scales the spec's times by
//              factor = the spec's tempo / this one, live, nothing re-composed; a new Compose resets it to the new
//              spec's tempo (proposed). The spec is never touched; JSON export adds a top-level `playback`.

import { compose, rearticulate, PART_IDS } from '../core/compose.js';
import { NOTE_INSTRUMENT_IDS, getInstrument } from '../../Audio/voices/recipes.js';
import { createPlayer } from './lab-player.js';

export const LAB_VERSION = 'composer-lab-v1';
/** a few rhythms across sizes; 41:42:43 first (tone-rich, mid-size) */
export const PRESETS = Object.freeze([
  { name: '41:42:43 — 124 onsets, 41 tones', layers: [41, 42, 43, 0], cycleSeconds: 8 },
  { name: '8:7:6:5 — 22 onsets, the LRC classic', layers: [8, 7, 6, 5], cycleSeconds: 4 },
  { name: '19:17:16:15 — 64 onsets', layers: [19, 17, 16, 15], cycleSeconds: 6 },
  { name: '119:42:15:8 — the 12EDO floor champion', layers: [119, 42, 15, 8], cycleSeconds: 8 },
  { name: '768:769 — 1,536 onsets, 384 tones', layers: [768, 769, 0, 0], cycleSeconds: 8 },
  { name: '4099:4093:4091:4079 — 16,359 onsets, 4,177 tones', layers: [4099, 4093, 4091, 4079], cycleSeconds: 16 },
]);
export const KNOBS = Object.freeze(['bars', 'slotsPerBar', 'frameCentsEachSide', 'modulation', 'anchors', 'settlePasses', 'presence']);
export const AUTO_RECOMPOSE_MS = 300;
/** the playback tempo's range, BPM */
export const TEMPO_LIMITS = Object.freeze([30, 300]);
/** every sound a part can play: the note-role instruments of Audio/voices, in the catalog's order */
export const soundChoices = () => NOTE_INSTRUMENT_IDS.map((id) => ({ id, label: getInstrument(id).label }));

/** layers as typed: a number, blank or 0 (absent) → [a, b, c, d] */
export function readLayers(values) {
  return [0, 1, 2, 3].map((i) => { const v = Number(values[i]); return Number.isInteger(v) && v > 0 ? v : 0; });
}

/**
 * createLabController({ runCompose, createContext, timers })
 *   runCompose(layers, cycleSeconds, { seed, overrides, worker }) → Promise<spec>   (the page: the worker for 'full',
 *               compose() itself for 'lean'; by default compose() for both)
 *   createContext () → an AudioContext, made on the first Perform
 */
export function createLabController({ runCompose = async (l, T, o) => compose(l, T, o), createContext = () => new AudioContext(), timers = globalThis, clock = () => (globalThis.performance ? performance.now() : Date.now()) } = {}) {
  const state = {
    input: { layers: [...PRESETS[0].layers], cycleSeconds: PRESETS[0].cycleSeconds, seed: 1 },
    knobs: Object.fromEntries(KNOBS.map((k) => [k, null])),
    table: 'full', spec: null, parts: {}, levels: Object.fromEntries(PART_IDS.map((id) => [id, 0.8])), glideMs: 12, tempoBpm: null,
    status: 'idle', error: null, lastMs: null, dirty: true,
  };
  const listeners = new Set();
  const changed = () => { for (const f of listeners) f(state); };
  let ctx = null, player = null, run = 0;

  const overrides = () => { const o = {}; for (const k of KNOBS) if (state.knobs[k] != null) o[k] = state.knobs[k]; return o; };
  const touch = () => { if (player?.playing) player.stop(); state.dirty = true; if (state.status === 'playing') state.status = state.spec && !state.spec.refused ? 'ready' : 'idle'; changed(); };

  const api = {
    state,
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    setLayers(values) { state.input.layers = readLayers(values); touch(); },
    setCycle(seconds) { const v = Number(seconds); if (v > 0) state.input.cycleSeconds = v; touch(); },
    setSeed(seed) { state.input.seed = Number.isFinite(Number(seed)) ? Number(seed) : String(seed); touch(); },
    setKnob(name, value) { if (!KNOBS.includes(name)) throw new Error(`lab: no knob ${name}`); state.knobs[name] = value === '' || value === undefined ? null : value; touch(); },
    setTable(table) { if (table !== 'full' && table !== 'lean') throw new Error(`lab: no table ${table}`); state.table = table; touch(); },
    loadPreset(i) { const p = PRESETS[i]; state.input.layers = [...p.layers]; state.input.cycleSeconds = p.cycleSeconds; touch(); },
    overrides,
    /** may a knob change re-compose by itself? lean only, and only while it is quick */
    canAutoRecompose: () => state.table === 'lean' && state.lastMs != null && state.lastMs < AUTO_RECOMPOSE_MS,

    async compose() {
      const mine = ++run, t0 = clock();
      if (player?.playing) player.stop();
      state.status = 'composing'; state.error = null; changed();
      try {
        const spec = await runCompose(state.input.layers, state.input.cycleSeconds, { seed: state.input.seed, overrides: overrides(), worker: state.table === 'full' });
        if (mine !== run) return state.spec;   // a newer compose took over
        state.spec = spec; state.lastMs = clock() - t0; state.dirty = false;
        if (spec.refused) { state.parts = {}; state.status = 'refused'; }
        else { state.parts = Object.fromEntries(spec.parts.map((p) => [p.id, p])); state.status = 'ready'; state.tempoBpm = spec.knobs.tempoBpm; }
      } catch (err) {
        if (mine !== run) return state.spec;
        state.status = 'error'; state.error = String(err && err.message ? err.message : err);
      }
      changed();
      return state.spec;
    },
    /** what the main button says, and does */
    button() {
      if (state.status === 'composing') return 'Composing…';
      if (state.dirty || !state.spec || state.spec.refused || state.status === 'error') return 'Compose';
      return state.status === 'playing' ? 'Stop' : 'Perform';
    },
    async press() {
      const label = api.button();
      if (label === 'Compose') return api.compose();
      if (label === 'Perform') return api.perform();
      if (label === 'Stop') return api.stop();
      return null;
    },

    /** the parts as they play now, in the spec's order */
    currentParts: () => PART_IDS.map((id) => state.parts[id]).filter(Boolean),
    /** the spec with the parts as they play now: what JSON export downloads */
    currentSpec: () => (state.spec && !state.spec.refused ? { ...state.spec, parts: api.currentParts() } : state.spec),
    /** what JSON export downloads: the spec as it plays now, plus how it is played (never written into the spec) */
    exportObject: () => (state.spec && !state.spec.refused ? { ...api.currentSpec(), playback: { tempoBpm: api.tempo(), factor: api.tempoFactor() } } : state.spec),
    exportJSON: () => JSON.stringify(api.exportObject(), null, 2),
    setPart(id, { sound, legato, enabled } = {}) {
      const part = state.parts[id];
      if (!part) return;
      state.parts[id] = rearticulate(part, { sound: sound ?? part.sound, legato: legato ?? part.legato, enabled: enabled ?? part.enabled, cycleSeconds: state.spec.knobs.cycleSeconds });
      changed();
    },
    setLevel(id, value) { state.levels[id] = Number(value); player?.setLevel(id, state.levels[id]); },   // no re-render: a slider is mid-drag
    setGlide(ms) { state.glideMs = Math.max(0, Number(ms) || 0); player?.setGlide(state.glideMs / 1000); },   // portamento; no re-render
    /** the spec's own tempo (null without a spec) */
    specTempo: () => (state.spec && !state.spec.refused ? state.spec.knobs.tempoBpm : null),
    /** the playback tempo, BPM (the spec's own until changed) */
    tempo: () => (api.specTempo() == null ? null : state.tempoBpm ?? api.specTempo()),
    /** what the player scales spec time by: the spec's tempo / the playback tempo */
    tempoFactor: () => { const s = api.specTempo(), t = api.tempo(); return s && t ? s / t : 1; },
    /** a playback tempo, clamped to TEMPO_LIMITS; live while playing (within the lookahead); no re-render */
    setTempo(bpm) {
      const v = Number(bpm);
      if (!Number.isFinite(v) || v <= 0 || api.specTempo() == null) return;
      state.tempoBpm = Math.min(TEMPO_LIMITS[1], Math.max(TEMPO_LIMITS[0], v));
      player?.setTimeFactor(api.tempoFactor());
    },
    /** back to the spec's own tempo */
    resetTempo() { if (api.specTempo() == null) return; state.tempoBpm = api.specTempo(); player?.setTimeFactor(1); },

    perform() {
      if (!state.spec || state.spec.refused) return;
      ctx ??= createContext();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      player ??= createPlayer({ ctx, timers });
      for (const id of PART_IDS) player.setLevel(id, state.levels[id]);
      player.setGlide(state.glideMs / 1000);
      player.setTimeFactor(api.tempoFactor());
      player.play(state.spec, api.currentParts);
      state.status = 'playing'; changed();
    },
    stop() { player?.stop(); if (state.status === 'playing') state.status = 'ready'; changed(); },
    playhead: () => player?.playhead() ?? null,
    get player() { return player; },
    get context() { return ctx; },
  };
  return api;
}
