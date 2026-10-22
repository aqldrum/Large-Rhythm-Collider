// assert-playback-identity.mjs — Phase 1a's guard: main Playback's notes now play through the shared voice library
// (Audio/lrc-voices-bridge.js → Audio/voices/), and with sine/triangle/sawtooth/square a layer must sound exactly as it
// did. The pre-library methods (fixtures/playback-voices-before.js, verbatim from e465ec3) and the new
// Playback/ToneRowPlayback.js + AudioEngine.js run side by side on a recording MOCK AudioContext whose params keep a
// real automation timeline (so `param.value` reads what a browser would read at currentTime):
//   • EXACT: standard note, legato note, the tempo bridge voice, a fundamental glide, stopPlayback — the same nodes,
//     wiring, oscillator type, automation events (times to 1e-9 s) and start/stop times.
//   • EXACT on an engine without cancelAndHoldAtTime (Firefox): every release, as well.
//   • RENDERED where the library is deliberately better and the events differ: with cancelAndHoldAtTime (Chrome,
//     Safari) a release holds the envelope's exact value instead of re-setting AudioParam.value (up to one render
//     quantum stale); a hard cleanup cancels the envelope's later events instead of leaving them under the fade. The
//     audible envelope (gain × oscillator running), sampled every 0.1 ms, must match within 1e-6.
// Then the new behavior: struck sounds, held recipes, legato retrigger, the bridge skipping struck sounds, the sound
// menu, and the bare-oscillator fallback before the module has loaded.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { lrcVoices } from '../lrc-voices-bridge.js';
import { planVoice } from '../voices/plan.js';
import { getRecipe } from '../voices/recipes.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// ── a recording mock AudioContext with real AudioParam timelines ────────────────────────────────────
function valueAt(param, t) {
  let prevT = 0, prevV = param._default;
  for (const e of param.events) {
    if (e.t <= t) { prevT = e.t; prevV = e.v; continue; }
    if (e.type === 'lin') return prevV + (e.v - prevV) * ((t - prevT) / (e.t - prevT));
    if (e.type === 'exp') return prevV > 0 && e.v > 0 ? prevV * (e.v / prevV) ** ((t - prevT) / (e.t - prevT)) : prevV;
    return prevV;
  }
  return prevV;
}
// Automation edited at currentTime can't change what was already rendered, so each param keeps the timeline as it
// stood before each moment's edits (`history`). `value` reads what the audio thread last rendered (the timeline before
// this moment's edits, so a cancelScheduledValues() just before reading it changes nothing — as in a browser), and
// renderedAt(param, t) reads the timeline that was in force when t was rendered.
function renderedAt(param, t, inclusive = false) {
  return valueAt(param.history.find(h => (inclusive ? h.at >= t : h.at > t)) || param, t);
}
function makeParam(ctx, initial, hold) {
  const p = { _default: initial, events: [], ops: [], history: [] };
  const edit = () => { if (p.history.at(-1)?.at !== ctx.currentTime) p.history.push({ at: ctx.currentTime, _default: p._default, events: [...p.events] }); };
  const insert = (type, v, t) => {
    edit();
    const i = p.events.findIndex(e => e.t > t);
    const e = { type, v, t };
    if (i < 0) p.events.push(e); else p.events.splice(i, 0, e);
  };
  Object.defineProperty(p, 'value', {
    get() { return renderedAt(p, ctx.currentTime, true); },
    set(v) { edit(); p._default = v; p.ops.push(['value', v]); },
  });
  p.setValueAtTime = (v, t) => { p.ops.push(['set', v, t]); insert('set', v, t); return p; };
  p.linearRampToValueAtTime = (v, t) => { p.ops.push(['lin', v, t]); insert('lin', v, t); return p; };
  p.exponentialRampToValueAtTime = (v, t) => { p.ops.push(['exp', v, t]); insert('exp', v, t); return p; };
  p.setTargetAtTime = (v, t, tc) => { p.ops.push(['target', v, t, tc]); return p; };
  p.cancelScheduledValues = t => { p.ops.push(['cancel', t]); edit(); p.events = p.events.filter(e => e.t < t); return p; };
  if (hold) {
    p.cancelAndHoldAtTime = t => {
      p.ops.push(['hold', t]);
      edit();
      const v = valueAt(p, t), next = p.events.find(e => e.t > t);
      p.events = p.events.filter(e => e.t <= t);
      p.events.push({ type: next && next.type !== 'set' ? next.type : 'set', v, t });
      return p;
    };
  }
  return p;
}
function makeCtx({ hold = true } = {}) {
  const nodes = [];
  const ctx = { currentTime: 10, sampleRate: 48000, nodes };
  const node = (kind, extra) => {
    const n = { kind, connections: [], connect(t) { this.connections.push(t); return t; }, disconnect() {}, ...extra };
    nodes.push(n);
    return n;
  };
  const source = kind => ({
    starts: [], stops: [], onended: null,
    start(t) { this.starts.push(t ?? ctx.currentTime); },
    stop(t) { this.stops.push(t || ctx.currentTime); },   // stop() / stop(0) = now
  });
  Object.assign(ctx, {
    createGain() { return node('gain', { gain: makeParam(ctx, 1, hold) }); },
    createOscillator() { return node('osc', { type: 'sine', frequency: makeParam(ctx, 440, hold), detune: makeParam(ctx, 0, hold), setPeriodicWave() { this.type = 'custom'; }, ...source() }); },
    createBiquadFilter() { return node('filter', { type: 'lowpass', frequency: makeParam(ctx, 350, hold), Q: makeParam(ctx, 1, hold), detune: makeParam(ctx, 0, hold) }); },
    createBufferSource() { return node('noise', { buffer: null, ...source() }); },
    createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; },
    createPeriodicWave(real, imag) { return { real, imag }; },
  });
  return ctx;
}

// The voice nodes created since `from`, described independently of creation order: each labelled by kind and its
// index among that kind, with its params' automation ops, wiring (by label; the layer's gain is "layer"), starts and stops.
function describe(ctx, layerGains, from = 0) {
  const made = ctx.nodes.slice(from).filter(n => !layerGains.includes(n));
  const counts = {};
  const label = new Map(made.map(n => [n, `${n.kind}${(counts[n.kind] = (counts[n.kind] ?? -1) + 1)}`]));
  const name = n => (layerGains.includes(n) ? `layer${layerGains.indexOf(n)}` : label.get(n) || 'outside');
  const sorted = [...made].sort((a, b) => (name(a) < name(b) ? -1 : 1));
  return sorted.map(n => {
    const d = { node: name(n), to: n.connections.map(name) };
    if (n.kind === 'osc') Object.assign(d, { type: n.type, frequency: n.frequency.ops, detune: n.detune.ops, starts: n.starts, stops: n.stops });
    if (n.kind === 'gain') d.gain = n.gain.ops;
    if (n.kind === 'filter') Object.assign(d, { type: n.type, frequency: n.frequency.ops, Q: n.Q.ops, detune: n.detune.ops });
    return d;
  });
}
// Deep equality, numbers to 1e-9 (relative above 1): old code adds a note's offsets one by one (start + attack + decay),
// the library adds their sum (start + (attack + decay)); the two can differ in the last bit.
function sameDeep(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') return near(a, b) ? null : `${path}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} ≠ ${b.length} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
    for (let i = 0; i < a.length; i++) { const d = sameDeep(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { const d = sameDeep(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
}

// What a listener hears from each oscillator: its envelope gain × whether it is running, every 0.1 ms.
function rendered(ctx, from, t0, t1) {
  const oscs = ctx.nodes.slice(from).filter(n => n.kind === 'osc');
  return oscs.map(osc => {
    const env = osc.connections[0];
    const start = osc.starts.at(-1), stop = osc.stops.length ? osc.stops.at(-1) : Infinity;
    const out = [];
    for (let t = t0; t <= t1; t += 0.0001) {
      const running = t >= start && t < stop;
      out.push([running ? renderedAt(env.gain, t) : 0, running ? renderedAt(osc.frequency, t) : 0]);
    }
    return out;
  });
}
function renderDiff(a, b) {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  a.forEach((curve, i) => curve.forEach(([g, f], j) => {
    const [g2, f2] = b[i][j];
    worst = Math.max(worst, Math.abs(g - g2), f || f2 ? Math.abs(f - f2) / Math.max(f, f2) : 0);
  }));
  return worst;
}

// ── load the old and new Playback code into a sandbox ──────────────────────────────────────────────
const here = fileURLToPath(new URL('.', import.meta.url));
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  dispatchEvent() {}, addEventListener() {},
  setTimeout, clearTimeout, Math, Number, Set, Map,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${read('./fixtures/playback-voices-before.js')}\n;globalThis.PlaybackVoicesBefore = PlaybackVoicesBefore; globalThis.AudioEngineBefore = AudioEngineBefore;`, sandbox, { filename: 'playback-voices-before.js' });
vm.runInContext(read('../../Playback/AudioEngine.js'), sandbox, { filename: 'AudioEngine.js' });
vm.runInContext(`${read('../../Playback/ToneRowPlayback.js')}\n;globalThis.ToneRowPlayback = ToneRowPlayback;`, sandbox, { filename: 'ToneRowPlayback.js' });
const { PlaybackVoicesBefore, AudioEngineBefore, ToneRowPlayback, AudioEngine } = sandbox;
void here;

function playbackFields(ctx) {
  const layerGains = [0, 1, 2, 3].map(() => ctx.createGain());
  return {
    audioContext: ctx, layerNodes: layerGains.map(gain => ({ gain })), layerGains,
    activeLayerVoices: [null, null, null, null], bridgeVoices: [null, null, null, null],
    legatoEnabled: false, isPlaying: true, fundamentalFreq: 110, maxFrequencyHz: 3520, highFreqAttenMinGain: 0.58,
    baseToneRowDataByLayer: [[], [], [], []], toneRowDataByLayer: [[], [], [], []], layerEvents: [[], [], [], []],
    schedulerTimer: null, pendingBridgeHold: false, pendingBridgeReleaseTicks: [null, null, null, null], scheduledEvents: [],
    isNoteMutedBySelection: () => false, updatePlayButton() {},
  };
}
function oldPlayback({ hold = true } = {}) {
  const ctx = makeCtx({ hold });
  const p = Object.assign(Object.create(PlaybackVoicesBefore.prototype), playbackFields(ctx), { activeOscillators: [] });
  p.audioEngine = new AudioEngineBefore(p);
  return p;
}
function newPlayback({ hold = true, library = true } = {}) {
  sandbox.lrcVoices = library ? lrcVoices : undefined;
  const ctx = makeCtx({ hold });
  const p = Object.assign(Object.create(ToneRowPlayback.prototype), playbackFields(ctx), { activeVoices: new Set() });
  p.audioEngine = new AudioEngine(p);
  return p;
}
// Run the same steps on an old and a new playback; `steps(p, which)` may set currentTime and call methods.
function pair(steps, opts = {}) {
  const old = oldPlayback(opts), neu = newPlayback(opts);
  steps(old, 'old'); steps(neu, 'new');
  return { old, neu };
}
const graphDiff = ({ old, neu }) => sameDeep(describe(old.audioContext, old.layerGains), describe(neu.audioContext, neu.layerGains));
const renderGap = ({ old, neu }, t0, t1) => renderDiff(rendered(old.audioContext, 4, t0, t1), rendered(neu.audioContext, 4, t0, t1));

const note = (frequency, ratio = frequency / 110, i = 7) => ({ frequency, ratio, globalSpacesIndex: i, isMutedByFrequency: false });
const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
const ADSRS = [
  { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.3 },   // the layer default
  { attack: 0.3, decay: 0.4, sustain: 0.5, release: 0.6 },     // longer than the note: no sustain segment
  { attack: 0.05, decay: 0.01, sustain: 0.001, release: 0.001 },
];
// Old states say `waveform`; new ones say `sound` (both are accepted by the new code — checked below).
const oldState = (wave, adsr) => ({ waveform: wave, adsr: { ...adsr } });
const newState = (wave, adsr) => ({ sound: wave, adsr: { ...adsr } });
const state = (which, wave, adsr) => (which === 'old' ? oldState : newState)(wave, adsr);

console.log('═══ PLAYBACK IDENTITY — main Playback on the shared voice library, default sounds unchanged ═══');

console.log('\n  standard notes (legato off): node for node, event for event');
{
  const fails = [];
  for (const wave of WAVES) for (const adsr of ADSRS) for (const [freq, dur, startAt] of [[220, 0.5, 10.1], [330, 2, 10.05], [3000, 0.25, 10.1], [165, 0.004, null], [440, 1, 9.5]]) {
    const r = pair((p, w) => { p.startStandardNote(note(freq), dur, 1, state(w, wave, adsr), startAt); });
    const d = graphDiff(r);
    if (d) fails.push(`${wave} ${JSON.stringify(adsr)} ${freq}Hz ${dur}s: ${d}`);
  }
  check(`${WAVES.length * ADSRS.length * 5} notes (4 waveforms × 3 envelopes × pitch/length/start incl. high-pitch attenuation, a 4 ms note, a start in the past)`,
    !fails.length, fails[0]);
  const { neu } = pair((p, w) => p.startStandardNote(note(220), 0.5, 0, state(w, 'triangle', ADSRS[0]), 10.1));
  const nodes = neu.audioContext.nodes.slice(4);
  check('…which is one oscillator into one envelope gain into the layer gain, nothing else',
    nodes.length === 2 && nodes.filter(n => n.kind === 'osc').length === 1 && nodes.find(n => n.kind === 'gain').connections[0] === neu.layerGains[0]);
}

console.log('\n  legato: held notes, each released by the next');
{
  const steps = (p, w) => {
    p.legatoEnabled = true;
    const st = state(w, 'sawtooth', ADSRS[0]);
    p.audioContext.currentTime = 10;
    p.startLegatoNote(note(220), 2, st, 10.05);
    p.audioContext.currentTime = 10.13;    // mid-decay: the release seeds from a moving envelope
    p.startLegatoNote(note(275), 2, st, 10.2);
    p.audioContext.currentTime = 10.9;     // mid-sustain
    p.startLegatoNote(note(330), 2, { ...st, adsr: { ...ADSRS[1] } }, 11);
    p.audioContext.currentTime = 11.1;     // during a slow attack
    p.releaseLayerVoice(2);
  };
  const noHold = pair(steps, { hold: false });
  check('without cancelAndHoldAtTime: identical, releases included (seed value, linear fall, stop just after)', !graphDiff(noHold), graphDiff(noHold));
  const withHold = pair(steps, { hold: true });
  const evts = describe(withHold.neu.audioContext, withHold.neu.layerGains).find(d => d.node === 'gain0').gain.map(o => o[0]);
  check('with cancelAndHoldAtTime the library holds instead of re-setting .value (the only event difference)…', evts.includes('hold') && !evts.includes('cancel'));
  const gap = renderGap(withHold, 9.99, 12.5);
  check('…and the audible envelopes match', gap < 1e-6, `max diff ${gap.toExponential(2)}`);
}

console.log('\n  release before a fixed-length note ends (the tempo-change cleanup: release immediate, then stop all)');
{
  for (const hold of [false, true]) {
    const steps = (p, w) => {
      p.audioContext.currentTime = 10;
      p.startStandardNote(note(220), 1, 0, state(w, 'square', ADSRS[0]), 10.05);
      p.startStandardNote(note(330), 0.07, 1, state(w, 'sine', ADSRS[0]), 10.4);   // ends 10.47, inside the release
      p.audioContext.currentTime = 10.44;
      p.releaseAllLayerVoices({ immediate: true });
      p[w === 'old' ? 'stopAllOscillators' : 'stopAllVoices']();
    };
    const r = pair(steps, { hold });
    const gap = renderGap(r, 9.99, 11.2);
    check(`${hold ? 'with' : 'without'} cancelAndHoldAtTime: the audible envelopes match (the 20 ms cleanup fade overtakes the 50 ms release)`, gap < 1e-6, `max diff ${gap.toExponential(2)}`);
    const stops = p => p.audioContext.nodes.filter(n => n.kind === 'osc').map(n => n.stops.at(-1));
    check(`${hold ? 'with' : 'without'}: every oscillator stops when it did before`, !sameDeep(stops(r.old), stops(r.neu)), sameDeep(stops(r.old), stops(r.neu)));
  }
}

console.log('\n  fundamental glide while notes sound');
{
  for (const hold of [true, false]) {
    const steps = (p, w) => {
      p.audioContext.currentTime = 10;
      p.legatoEnabled = true;
      p.startLegatoNote(note(165, 3 / 2), 0, state(w, 'triangle', ADSRS[0]), 10.02);
      p.legatoEnabled = false;
      p.startStandardNote(note(220, 2), 1.5, 1, state(w, 'sine', ADSRS[0]), 10.03);
      p.startBridgeVoice(2, note(275, 5 / 2), state(w, 'square', ADSRS[0]));
      p.audioContext.currentTime = 10.3;
      p.fundamentalFreq = 130;
      p.handleFundamentalChange(0.05);
      p.audioContext.currentTime = 10.6;
      p.fundamentalFreq = 98;
      p.handleFundamentalChange(0);   // a step
    };
    const r = pair(steps, { hold });
    if (!hold) check('without cancelAndHoldAtTime: legato, standard and bridge voices glide identically (and a zero glide steps)', !graphDiff(r), graphDiff(r));
    else {
      // With cancelAndHoldAtTime the library also re-sets the settled pitch at the glide's start (2026-10-22): a real
      // engine inserts no hold when nothing is scheduled past that time, so without it a ramp would run from the
      // voice's last event. This mock always holds, so the extra set is redundant here: what is heard must match.
      const gap = renderGap(r, 9.99, 10.8);
      check('with cancelAndHoldAtTime: legato, standard and bridge voices glide as before, heard (and a zero glide steps)', gap < 1e-6, `max diff ${gap.toExponential(2)}`);
    }
    check(`${hold ? 'with' : 'without'}: the held note's noteData follows the new fundamental`, near(r.neu.activeLayerVoices[0].noteData.frequency, 98 * 1.5));
  }
}

console.log('\n  the tempo bridge voice');
{
  const steps = (p, w) => {
    p.audioContext.currentTime = 10.2;
    p.startBridgeVoice(3, note(440), state(w, 'triangle', ADSRS[0]));
    p.startBridgeVoice(2, note(3300), state(w, 'sawtooth', { ...ADSRS[0], sustain: 0 }));   // sustain 0 → full level, attenuated
    p.audioContext.currentTime = 10.205;   // mid-rise
    p.releaseBridgeVoice(3);
    p.audioContext.currentTime = 10.7;
    p.releaseBridgeVoice(2);
  };
  const noHold = pair(steps, { hold: false });
  check('start and release: identical without cancelAndHoldAtTime', !graphDiff(noHold), graphDiff(noHold));
  const withHold = pair(steps, { hold: true });
  check('with it: the start is identical and the audible release matches',
    renderGap(withHold, 10.19, 10.8) < 1e-6 && describe(withHold.neu.audioContext, withHold.neu.layerGains).filter(d => d.node.startsWith('osc')).every(d => d.stops.length === 1),
    `max diff ${renderGap(withHold, 10.19, 10.8).toExponential(2)}`);
  check('the bridge is not counted among the layer voices (as before)', withHold.neu.activeVoices.size === 0 && withHold.neu.bridgeVoices.every(b => b === null));
}

console.log('\n  stopPlayback: everything stops now');
{
  for (const legato of [false, true]) {
    const steps = (p, w) => {
      p.audioContext.currentTime = 10;
      p.legatoEnabled = legato;
      [0, 1, 2, 3].forEach(i => (legato ? p.startLegatoNote(note(110 * (i + 2)), i, state(w, WAVES[i], ADSRS[0]), 10.01 + i * 0.05)
        : p.startStandardNote(note(110 * (i + 2)), 2, i, state(w, WAVES[i], ADSRS[0]), 10.01 + i * 0.05)));
      p.startStandardNote(note(990), 0.5, 0, state(w, 'sine', ADSRS[0]), 10.25);   // scheduled ahead, not yet sounding
      if (!legato) p.startBridgeVoice(1, note(330), state(w, 'triangle', ADSRS[0]));
      p.audioContext.currentTime = 10.12;
      p.stopPlayback();
    };
    const r = pair(steps, { hold: false });
    if (!legato) check('legato off: identical (every oscillator stopped at the moment of stop; the bridge released)', !graphDiff(r), graphDiff(r));
    else check('legato on: identical (every held voice released, then every oscillator stopped at the moment of stop)', !graphDiff(r), graphDiff(r));
    check(`legato ${legato ? 'on' : 'off'}: nothing is left tracked`, r.neu.activeVoices.size === 0 && r.neu.activeLayerVoices.every(v => v === null) && r.neu.bridgeVoices.every(b => b === null));
  }
}

console.log('\n  a release before the note has started (fast legato: the next note is scheduled inside the lookahead)');
{
  // Before the library, releaseLayerVoice on a still-scheduled note seeded its fade from the gain's default (1), so the
  // note sounded as a short fade from full level. Fast legato depends on that to be heard at all; it is kept.
  const steps = (p, w) => {
    p.legatoEnabled = true;
    p.audioContext.currentTime = 10;
    const st = state(w, 'triangle', ADSRS[0]);
    [10.03, 10.06, 10.09, 10.12].forEach((t, i) => p.startLegatoNote(note(220 + 55 * i), 0, st, t));
  };
  const noHold = pair(steps, { hold: false });
  check('without cancelAndHoldAtTime: identical (each early-released note still sounds its fade)', !graphDiff(noHold), graphDiff(noHold));
  const withHold = pair(steps, { hold: true });
  const gap = renderGap(withHold, 9.99, 10.6);
  check('with it: the same sound', gap < 1e-6, `max diff ${gap.toExponential(2)}`);
}

console.log('\n  voice lifecycle');
{
  const p = newPlayback();
  p.startStandardNote(note(220), 0.5, 0, newState('sine', ADSRS[0]), 10.1);
  const osc = p.audioContext.nodes.find(n => n.kind === 'osc');
  check('a note is tracked as a handle while it sounds', p.activeVoices.size === 1 && p.activeLayerVoices[0]?.handle);
  osc.onended();
  check('…and forgotten when it ends (activeVoices and its layer slot)', p.activeVoices.size === 0 && p.activeLayerVoices[0] === null);
  const legacy = newPlayback();
  legacy.startStandardNote(note(220), 0.5, 0, { waveform: 'square', adsr: { ...ADSRS[0] } }, 10.1);
  check('an old layer state that says `waveform` still plays that waveform', legacy.audioContext.nodes.find(n => n.kind === 'osc').type === 'square');
  const empty = newPlayback();
  empty.startStandardNote(note(220), 0.5, 0, { adsr: { ...ADSRS[0] } }, 10.1);
  check('a state with neither plays a sine', empty.audioContext.nodes.find(n => n.kind === 'osc').type === 'sine');
}

console.log('\n  before the library module has loaded: the bare-oscillator fallback');
{
  const fallbackPair = (steps, hold) => {
    const old = oldPlayback({ hold }), neu = newPlayback({ hold, library: false });
    steps(old, 'old'); steps(neu, 'new');
    sandbox.lrcVoices = lrcVoices;
    return { old, neu };
  };
  const std = fallbackPair((p, w) => p.startStandardNote(note(220), 0.5, 0, state(w, 'sawtooth', ADSRS[0]), 10.1), true);
  check('a standard note is the old note exactly', !graphDiff(std), graphDiff(std));
  const leg = fallbackPair((p, w) => {
    p.startLegatoNote(note(220), 0, state(w, 'triangle', ADSRS[0]), 10.05);
    p.audioContext.currentTime = 10.4;
    p.startLegatoNote(note(330), 0, state(w, 'triangle', ADSRS[0]), 10.5);
    p.fundamentalFreq = 120; p.handleFundamentalChange(0.05);
  }, true);
  check('legato, its release and a glide are the old ones exactly', !graphDiff(leg), graphDiff(leg));
  const br = fallbackPair((p, w) => {
    p.audioContext.currentTime = 10.2;
    p.startBridgeVoice(0, note(440), state(w, 'sine', ADSRS[0]));
    p.audioContext.currentTime = 10.5;
    p.releaseBridgeVoice(0);
  }, true);
  check('the bridge voice sounds the same (two redundant held-level events aside)', renderGap(br, 10.19, 10.6) < 1e-6);
  const cleanup = fallbackPair((p, w) => {
    p.startStandardNote(note(220), 1, 0, state(w, 'square', ADSRS[0]), 10.05);
    p.audioContext.currentTime = 10.44;
    p[w === 'old' ? 'stopAllOscillators' : 'stopAllVoices']();
  }, false);
  check('and a hard cleanup sounds the same', renderGap(cleanup, 9.99, 11.2) < 1e-6);
}

console.log('\n  the new sounds');
{
  const opts = lrcVoices.soundOptions();
  check('the menu: sine, triangle, sawtooth, square first, then the instruments (plain and pad hidden: Triangle again here)',
    opts.slice(0, 4).map(o => o.id).join() === WAVES.join() && opts.slice(0, 4).every(o => o.basic) && opts.slice(4).every(o => !o.basic) &&
    ['glass', 'warm', 'marimba', 'vibes', 'harp', 'flute'].every(id => opts.some(o => o.id === id)) && !opts.some(o => o.id === 'plain' || o.id === 'pad' || o.id === 'classic'),
    opts.map(o => o.id).join(','));
  check('struck sounds are the ones that keep their own envelope', ['glass', 'marimba', 'vibes', 'xylophone', 'kalimba', 'harp', 'upright'].every(lrcVoices.isStruck) &&
    ![...WAVES, 'warm', 'glassbed', 'sub', 'reed', 'flute', 'nonsense'].some(lrcVoices.isStruck));

  // vibes: struck, damped. A note shorter than its decay is damped at its end over the LAYER's Release.
  const p = newPlayback();
  // the amp envelope's ops for the voice built since `from` (behind the output trim, if the sound has one)
  const ampOps = (pb, from) => {
    const nodes = pb.audioContext.nodes.slice(from);
    const trim = nodes.find(n => n.kind === 'gain' && n.connections.includes(pb.layerGains[0]));
    return (nodes.find(n => n.kind === 'gain' && n.connections.includes(trim)) || trim).gain.ops;
  };
  let mark = p.audioContext.nodes.length;
  p.startStandardNote(note(220), 0.5, 0, newState('vibes', { attack: 2, decay: 2, sustain: 0.2, release: 0.4 }), 10);
  const vib = ampOps(p, mark);
  check('a struck note ignores the layer\'s Attack/Decay/Sustain and plays its own strike (3 ms attack)', near(vib[1][2], 10.003) && vib[1][0] === 'lin' && vib[2][0] === 'exp');
  check('…and the layer\'s Release (0.4 s, not the recipe\'s 0.12) damps it at the note\'s end', near(vib.at(-1)[2], 10.5 + 0.4) && vib.at(-1)[1] === 0);
  const peakNow = vib[1][1];
  check('…at the layer\'s usual peak (high-frequency attenuation; 1 at 220 Hz)', near(peakNow, 1));

  // legato + struck: every note strikes again; the previous one is damped by Release.
  const q = newPlayback();
  q.legatoEnabled = true;
  const st = newState('vibes', { ...ADSRS[0], release: 0.25 });
  q.startLegatoNote(note(220), 0, st, 10.05);
  q.audioContext.currentTime = 10.4;
  q.startLegatoNote(note(330), 0, st, 10.5);
  const oscs = q.audioContext.nodes.filter(n => n.kind === 'osc');
  const firstAmp = q.audioContext.nodes.filter(n => n.kind === 'gain' && n.connections.some(c => c.kind === 'gain' && c.connections.includes(q.layerGains[0])))[0];
  check('legato: a struck sound strikes again on the next note (a fresh voice with its own strike)', oscs.filter(o => near(o.starts[0], 10.5)).length === 3 && q.activeVoices.size === 2);
  check('…and the previous strike is damped from where it is over the layer\'s Release', !!firstAmp && sameDeep(firstAmp.gain.ops.slice(-2), [['hold', 10.4], ['lin', 0, 10.65]]) === null,
    JSON.stringify(firstAmp?.gain.ops.slice(-2)));

  // a ringing struck sound (marimba) ignores Release, but a hard cleanup still fades it out.
  const r = newPlayback();
  r.legatoEnabled = true;
  r.startLegatoNote(note(220), 0, newState('marimba', ADSRS[0]), 10.05);
  r.audioContext.currentTime = 10.3;
  r.releaseLayerVoice(0);
  const mOsc = r.audioContext.nodes.find(n => n.kind === 'osc');
  check('a ringing sound (marimba) rings on through a release', mOsc.stops.length === 1 && mOsc.stops[0] > 10.9 && r.activeVoices.size === 1);
  r.stopAllVoices();
  check('…but the tempo-change cleanup fades it out in 20 ms', near(mOsc.stops.at(-1), 10.33) && r.activeVoices.size === 0);

  // a held recipe (warm) plays the layer's ADSR, with its own timbre (harmonic table, filters).
  const w = newPlayback();
  mark = w.audioContext.nodes.length;
  w.startStandardNote(note(220), 1, 0, newState('warm', ADSRS[1]), 10);
  const plan = planVoice({ ...getRecipe('warm', 'note'), amp: undefined }, { role: 'note', baseFreq: 220, timing: { ...ADSRS[1], peak: 1, duration: 1 }, sampleRate: 48000 });
  const warmAmp = ampOps(w, mark);
  check('a held sound (warm) takes the layer\'s ADSR, as a waveform does', plan.amp.kind === 'adsr' && near(warmAmp[1][2], 10.3) && near(warmAmp[2][1], 0.5) && near(warmAmp.at(-1)[2], 11));
  check('…and keeps its timbre (harmonic-table oscillator, high-pass + key-tracked low-pass)',
    w.audioContext.nodes.slice(mark).filter(n => n.kind === 'filter').length === 2 && w.audioContext.nodes.slice(mark).find(n => n.kind === 'osc').type === 'custom');

  // the bridge: nothing to hold for a struck sound; a held sound bridges with its timbre.
  const b = newPlayback();
  b.startBridgeVoice(0, note(220), newState('marimba', ADSRS[0]));
  check('a struck sound gets no tempo bridge (its last note dies away as it would)', b.bridgeVoices[0] === null && !b.audioContext.nodes.slice(4).length);
  b.startBridgeVoice(1, note(220), newState('flute', ADSRS[0]));
  check('a held sound bridges with its own timbre (flute: three partials)', b.bridgeVoices[1]?.handle && b.audioContext.nodes.filter(n => n.kind === 'osc').length === 3);
  b.audioContext.currentTime = 10.5;
  b.fundamentalFreq = 165; b.handleFundamentalChange(0.05);
  const fl = b.audioContext.nodes.filter(n => n.kind === 'osc');
  check('…and glides with the fundamental, every partial', fl.every((o, i) => near(o.frequency.ops.at(-1)[1], 330 * [1, 2, 3][i])));
}

console.log('\n  a hard cleanup overtakes a slow release');
{
  const p = newPlayback({ hold: true });
  p.legatoEnabled = true;
  p.startLegatoNote(note(220), 0, newState('sine', { ...ADSRS[0], release: 3 }), 10.01);
  p.audioContext.currentTime = 10.5;
  p.releaseLayerVoice(0);              // a 3 s fade
  const osc = p.audioContext.nodes.find(n => n.kind === 'osc');
  const slowStop = osc.stops.at(-1);
  p.audioContext.currentTime = 10.6;
  p.stopAllVoices();
  check('the 20 ms cleanup fade cuts a 3 s release short, without a click (it fades from where the release is)',
    near(slowStop, 13.51) && near(osc.stops.at(-1), 10.63) && near(valueAt(osc.connections[0].gain, 10.62), 0));
}

console.log(PASS ? '\n✓✓✓ PLAYBACK IDENTITY PASSES' : '\n✗ PLAYBACK IDENTITY FAILED');
process.exit(PASS ? 0 : 1);
