// composer-controller.js — the Composer's state and actions, with no DOM. Shared (promoted from lab/lab-controller.js,
// 2026-10-22): the lab (Composer/lab/composer-lab.js) and the main page's Composer tab (Composer/page/tab-controller.js)
// are thin layers over it. Composer/tests/assert-lab.mjs drives it in Node with a recording mock AudioContext.
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
//   progression one root a bar, or null (auto), from `rootChoices()` (progression.js' rootCandidates, on this thread:
//              one row build and a sweep); as many bars as Compose will use (the bars knob, else compose.js'
//              chooseMeter). Compose sends it only when a bar is pinned, so all auto is today's Compose exactly.
//              "Take from last compose" seeds it with the spec's roots; Clear empties it; new layers clear it (the
//              ratios belong to the old row). The spec's `input.progression` is what JSON export carries.
//   drums      the Drums (Perc) part as it plays now: a mode or curated pattern, fills, on/off, a level and a kit sound
//              a voice. A change re-arranges the drums from the spec with drums.js' own `arrangeDrums`, on this
//              thread, nothing re-composed (live while playing); a new Compose re-arranges them with the same options.
//   in flight  a change while Compose runs (an input, knob or table) drops that compose's answer when it comes: the
//              button goes back to Compose at once (the main page's rhythm can change under a compose).
//   hooks      beforePerform () → called as Perform starts (the main page stops its own playback there: one thing
//              sounds at a time)
//   state      one composition's state (Composer/store/composition-store.js newCompositionState: the store's entry
//              shape). The lab keeps the one it starts with. The main page binds the store's current entry
//              (bind(state), sprint 2): a bind stops playback and re-renders; nothing else in the state moves.
//   one flight one compose in flight per state: Compose again on a state that is composing joins that compose (the
//              same promise). A compose lands in the state it was started for, even when another one is bound by
//              then (the main page's cache); a change to that state while it runs drops the answer, as before.
//   levels     setLevel notifies onLevel listeners (id, value), not onChange (a slider mid-drag is not re-rendered):
//              the main page's part strips and the window's inspector keep each other's level in step.
//   trace      every compose asks Compose for its trace (core/trace.js) and keeps it apart from the spec, in
//              `state.trace` (STEP 4a: always, at ALTERNATE_CAPS, for the alternates; before, only for
//              compose({ trace: true })): the spec, the lanes and JSON export are the same with it or without it.
//              The main page's tab animates Compose from it (page/compose-animator.js) while "show the work" is on.

import { compose, rearticulate, chooseMeter, PART_IDS } from '../core/compose.js';
import { rootCandidates } from '../core/progression.js';
import { NOTE_INSTRUMENT_IDS, getInstrument } from '../../Audio/voices/recipes.js';
import { createPlayer } from './composer-player.js';
import { arrangeDrums, DRUM_MODES, DRUM_VOICES, DEFAULT_KIT } from '../core/drums.js';
import { DRUM_PATTERNS } from '../core/drum-patterns.js';
import { MADE_DRUM_CHOICES } from '../../Audio/drums/index.js';
import { newCompositionState, KNOB_NAMES } from '../store/composition-store.js';
import { ALTERNATE_CAPS } from '../core/trace.js';   // STEP 4a

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
export const KNOBS = KNOB_NAMES;
export const AUTO_RECOMPOSE_MS = 300;
/** the playback tempo's range, BPM */
export const TEMPO_LIMITS = Object.freeze([30, 300]);
/** every sound a part can play: the note-role instruments of Audio/voices, in the catalog's order */
export const soundChoices = () => NOTE_INSTRUMENT_IDS.map((id) => ({ id, label: getInstrument(id).label }));

// ── drums ──
const DRUM_MODE_LABELS = { backbeat: 'backbeat (default)', with: 'clave: with lead + comping', against: 'clave: against lead + comping', partition: 'partition: the downbeat layer' };
/** every drum mode: the layered modes, then each curated pattern */
export const drumModeChoices = () => DRUM_MODES.map((id) => ({ id, label: DRUM_MODE_LABELS[id] ?? `pattern: ${DRUM_PATTERNS[id].label}` }));
/** the built-in samples Partitions plays (assets/audio): relative to the lab page by default; the main page passes
 *  its own base ('assets/audio/') */
const SAMPLE_KINDS = { kick: 'kick', snare: 'snare', hat: 'hat', perc: 'perc', cym: 'cym' };
export const LAB_SAMPLES_BASE = '../../assets/audio/';
/** a voice's sound choices: off, the made kit of Audio/drums, the site's samples of that kind */
export const kitChoices = (voice, base = LAB_SAMPLES_BASE) => [{ value: '', label: 'off' }, ...MADE_DRUM_CHOICES.map((c) => ({ value: c.value, label: `${c.label} (made)` })),
  ...[1, 2, 3, 4].map((i) => ({ value: `${base}${SAMPLE_KINDS[voice]}${i}.wav`, label: `${SAMPLE_KINDS[voice]}${i}.wav` }))];
export const DRUM_LAB_VOICES = DRUM_VOICES;

/** layers as typed: a number, blank or 0 (absent) → [a, b, c, d] */
export function readLayers(values) {
  return [0, 1, 2, 3].map((i) => { const v = Number(values[i]); return Number.isInteger(v) && v > 0 ? v : 0; });
}

/**
 * createComposerController({ runCompose, createContext, timers, clock, beforePerform, destination, state })
 *   runCompose(layers, cycleSeconds, { seed, overrides, worker, progression }) → Promise<spec>   (a page: the worker
 *               for 'full', compose() itself for 'lean' — compose-runner.js; by default compose() for both)
 *   createContext () → an AudioContext, made on the first Perform
 *   beforePerform () → called as Perform starts, before anything is booked
 *   destination   the AudioNode the player's limiter feeds (the context's destination by default)
 *   state         the composition state to start bound to (a fresh one, on the lab's first preset, by default)
 */
export function createComposerController({ runCompose = async (l, T, o) => compose(l, T, o), createContext = () => new AudioContext(), timers = globalThis, clock = () => (globalThis.performance ? performance.now() : Date.now()), beforePerform = null, destination = null, state: initial = null } = {}) {
  let state = initial ?? newCompositionState({ layers: PRESETS[0].layers, cycleSeconds: PRESETS[0].cycleSeconds, seed: 1 });
  const listeners = new Set(), levelListeners = new Set();
  const changed = (st = state) => { for (const f of listeners) f(st); };
  // per state: its compose generation (a change bumps it, dropping the answer in flight) and the compose in flight
  const runs = new WeakMap(), flights = new WeakMap();
  const bump = (st) => { const n = (runs.get(st) ?? 0) + 1; runs.set(st, n); return n; };
  let ctx = null, player = null, choices = null, choicesKey = null;

  const overrides = () => { const o = {}; for (const k of KNOBS) if (state.knobs[k] != null) o[k] = state.knobs[k]; return o; };
  const settled = (st = state) => (!st.spec ? 'idle' : st.spec.refused ? 'refused' : 'ready');
  const touch = () => {
    if (player?.playing) player.stop();
    state.dirty = true;
    if (state.status === 'playing') state.status = settled();
    if (state.status === 'composing') { bump(state); flights.delete(state); state.status = settled(); }   // the answer in flight is for the old input
    changed();
  };
  const sameLayers = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  const api = {
    get state() { return state; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    /** a part's level moved: f(id, value) (onChange is not called for it) */
    onLevel(f) { levelListeners.add(f); return () => levelListeners.delete(f); },
    /** act on another composition state from now on (the main page's store entry) → whether it changed. Playback
     *  stops (it was the old state's); a compose in flight for the old state keeps running and lands there. */
    bind(next) {
      if (!next || next === state) return false;
      if (player?.playing) player.stop();
      if (state.status === 'playing') state.status = settled();
      state = next;
      changed();
      return true;
    },
    /** is a compose in flight for this state (the bound one by default)? */
    composing: (st = state) => st.status === 'composing' && flights.has(st),
    setLayers(values) { state.input.layers = readLayers(values); state.progression = []; touch(); },
    /** the rhythm from outside (the main page): { layers, cycleSeconds } → whether it changed. A change goes back to
     *  Compose (and stops playback) exactly as typing it would; new layers clear the progression, a new cycle doesn't. */
    setInput({ layers, cycleSeconds } = {}) {
      const L = layers ? readLayers(layers) : state.input.layers, T = Number(cycleSeconds) > 0 ? Number(cycleSeconds) : state.input.cycleSeconds;
      const newLayers = !sameLayers(L, state.input.layers), newCycle = T !== state.input.cycleSeconds;
      if (!newLayers && !newCycle) return false;
      state.input.layers = L; state.input.cycleSeconds = T;
      if (newLayers) state.progression = [];
      touch();
      return true;
    },
    setCycle(seconds) { const v = Number(seconds); if (v > 0) state.input.cycleSeconds = v; touch(); },
    setSeed(seed) { state.input.seed = Number.isFinite(Number(seed)) ? Number(seed) : String(seed); touch(); },
    setKnob(name, value) { if (!KNOBS.includes(name)) throw new Error(`lab: no knob ${name}`); state.knobs[name] = value === '' || value === undefined ? null : value; touch(); },
    setTable(table) { if (table !== 'full' && table !== 'lean') throw new Error(`lab: no table ${table}`); state.table = table; touch(); },
    loadPreset(i) { const p = PRESETS[i]; state.input.layers = [...p.layers]; state.input.cycleSeconds = p.cycleSeconds; state.progression = []; touch(); },
    overrides,
    /** may a knob change re-compose by itself? lean only, and only while it is quick */
    canAutoRecompose: () => state.table === 'lean' && state.lastMs != null && state.lastMs < AUTO_RECOMPOSE_MS,

    /** opts { trace } (STEP 4a: no longer read; the trace is always asked for and kept in state.trace). One in flight
     *  per state: called again on a state that is composing, it returns that compose's promise. */
    compose({ trace = false } = {}) {
      const st = state;
      if (st.status === 'composing' && flights.has(st)) return flights.get(st);
      const mine = bump(st), t0 = clock();
      if (player?.playing) player.stop();
      st.status = 'composing'; st.error = null;
      const options = { seed: st.input.seed, overrides: overrides(), worker: st.table === 'full', progression: api.progressionInput() };
      // STEP 4a: always ask for the trace, at the alternates' caps (12 chords a bar, 8 runner-up lines a phrase), so the
      // alternates never depend on "show the work"; the show still obeys the setting (it reads state.trace only when on)
      options.trace = { caps: { ...ALTERNATE_CAPS } };
      const flight = (async () => {
        try {
          const answer = await runCompose(st.input.layers, st.input.cycleSeconds, options);
          if (mine !== runs.get(st)) return st.spec;   // a change to this state took over
          let spec = answer;
          if (answer && 'trace' in answer) { const { trace: tr, ...plain } = answer; spec = plain; st.trace = tr; } else st.trace = null;   // STEP 4a: kept whatever `trace` says
          st.spec = spec; st.lastMs = clock() - t0; st.dirty = false;
          if (spec.refused) { st.parts = {}; st.drums = null; st.status = 'refused'; }
          else { st.parts = Object.fromEntries(spec.parts.map((p) => [p.id, p])); st.drums = arrangeDrums(spec, st.drumOptions); st.status = 'ready'; st.tempoBpm = spec.knobs.tempoBpm; }
        } catch (err) {
          if (mine !== runs.get(st)) return st.spec;
          st.status = 'error'; st.error = String(err && err.message ? err.message : err);
        } finally {
          if (mine === runs.get(st)) flights.delete(st);
        }
        changed(st);
        return st.spec;
      })();
      flights.set(st, flight);
      changed(st);
      return flight;
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
    currentSpec: () => (state.spec && !state.spec.refused ? { ...state.spec, parts: api.currentParts(), drums: state.drums } : state.spec),
    /** what JSON export downloads: the spec as it plays now, plus how it is played (never written into the spec) */
    exportObject: () => (state.spec && !state.spec.refused ? { ...api.currentSpec(), playback: { tempoBpm: api.tempo(), factor: api.tempoFactor() } } : state.spec),
    exportJSON: () => JSON.stringify(api.exportObject(), null, 2),
    setPart(id, { sound, legato, enabled } = {}) {
      const part = state.parts[id];
      if (!part) return;
      state.parts[id] = rearticulate(part, { sound: sound ?? part.sound, legato: legato ?? part.legato, enabled: enabled ?? part.enabled, cycleSeconds: state.spec.knobs.cycleSeconds });
      changed();
    },
    /** the drums as they play now: { enabled, mode, fills, kit: { voice: choice }, layer, hitsPerBar } merged in, the
     *  drums re-arranged from the spec (cheap, this thread); live while playing, nothing re-composed */
    setDrums({ kit, ...rest } = {}) {
      const o = state.drumOptions;
      for (const [k, v] of Object.entries(rest)) { if (v === null) delete o[k]; else if (v !== undefined) o[k] = v; }
      if (kit) o.kit = { ...o.kit, ...kit };
      if (state.spec && !state.spec.refused) state.drums = arrangeDrums(state.spec, o);
      changed();
    },
    setLevel(id, value) {   // no re-render: a slider is mid-drag (onLevel listeners keep other views in step)
      state.levels[id] = Number(value); player?.setLevel(id, state.levels[id]);
      for (const f of [...levelListeners]) f(id, state.levels[id]);
    },
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
      if (beforePerform) beforePerform();
      ctx ??= createContext();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      player ??= createPlayer({ ctx, timers, destination });
      for (const id of [...PART_IDS, 'drums']) player.setLevel(id, state.levels[id]);
      player.setGlide(state.glideMs / 1000);
      player.setTimeFactor(api.tempoFactor());
      player.play(state.spec, api.currentParts, () => state.drums);
      state.status = 'playing'; changed();
    },
    stop() { player?.stop(); if (state.status === 'playing') state.status = 'ready'; changed(); },
    playhead: () => player?.playhead() ?? null,

    // ── the progression editor (targeted progressions, progression.js) ──
    /** the roots a bar may ask for: the row's ±frame clusters, named from the root Compose would pick (memoized) */
    rootChoices() {
      const opts = { frameCentsEachSide: state.knobs.frameCentsEachSide ?? undefined, presence: state.knobs.presence ?? undefined };
      const key = JSON.stringify([state.input.layers, opts]);
      if (choicesKey !== key) {
        choicesKey = key;
        try { choices = rootCandidates(state.input.layers, opts); } catch (err) { choices = { refused: true, reason: String(err && err.message ? err.message : err), candidates: [] }; }
      }
      return choices;
    },
    /** how many bars the editor shows: the bars knob, else what Compose's meter will choose (0 for a refused row) */
    progressionBars() {
      if (state.knobs.bars != null) return state.knobs.bars;
      const rc = api.rootChoices();
      return rc.refused ? 0 : chooseMeter(rc.onsets, state.input.cycleSeconds, { slotsPerBar: state.knobs.slotsPerBar ?? null }).bars;
    },
    /** the editor's roots, one a bar (null: auto), cut or padded to progressionBars() */
    progression: () => Array.from({ length: api.progressionBars() }, (_, k) => state.progression[k] ?? null),
    /** what Compose is sent: the editor's roots, or null when every bar is auto */
    progressionInput: () => { const p = api.progression(); return p.some((x) => x != null) ? p : null; },
    setProgressionRoot(bar, ratio) {
      if (!(Number.isInteger(bar) && bar >= 0)) throw new Error(`lab: no bar ${bar}`);
      const p = [...state.progression]; while (p.length <= bar) p.push(null);
      p[bar] = ratio === '' || ratio === 'auto' || ratio == null ? null : String(ratio);
      state.progression = p; touch();
    },
    clearProgression() { state.progression = []; touch(); },
    /** seed the editor with the roots the last compose chose → whether there was one to take */
    takeProgression() {
      if (!state.spec || state.spec.refused) return false;
      state.progression = state.spec.chords.map((c) => c.rootTone); touch();
      return true;
    },
    get player() { return player; },
    get context() { return ctx; },
  };
  return api;
}
/** the lab's name for it (kept for the lab and its tests) */
export const createLabController = createComposerController;
