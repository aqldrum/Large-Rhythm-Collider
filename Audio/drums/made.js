// Audio/drums/made.js — the synthesized ("made") drums, ported from chunk-tunes (Overworld/econ/chunk-tunes.html:
// noiseOf, strike, and arrVoices' tick / drop / hiss). chunk-tunes keeps its own copy; this one is page-free.
//
// Every sound is a function of one options object and returns a HANDLE:
//   play({ ctx, out, at, peak = 1, pitch = 1, until = null }) -> { end, stop(at?), onEnded(cb) }
//     peak   scales the sound's own levels (1 = chunk-tunes' levels; the decay floors scale with it, so the shape holds)
//     pitch  multiplies every frequency in the sound: oscillator sweeps and noise filters (durations stay put)
//     until  optional cut-short: a 12 ms fade ending at `until`, when that falls before the sound's own end
//
// Graph per stroke:   osc ─▶ gain ─┐
//                     noise ─▶ filter ─▶ gain ─┼─▶ [cut gain, only with until] ─▶ out

// 0.25 s of white noise per AudioContext, as chunk-tunes' noiseOf. A stroke longer than that (the 0.4 s cymbal hiss)
// ends with the buffer, as it does in chunk-tunes.
const noiseCache = new WeakMap();   // ctx -> mono white-noise AudioBuffer
export function noiseOf(ctx) {
  let buf = noiseCache.get(ctx);
  if (buf) return buf;
  buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.25), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

const FLOOR = 0.0005;   // where chunk-tunes' exponential decays aim
const CUT_SECONDS = 0.012;

const positive = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
const hz = (ctx, f) => Math.min(f, ctx.sampleRate * 0.49);

// The handle over a stroke's sources. onEnded fires once, after every source has ended.
export function strokeHandle(sources, end) {
  let pending = sources.length, done = sources.length === 0, cb = null;
  const finish = () => { if (--pending === 0 && !done) { done = true; cb?.(); } };
  for (const s of sources) s.onended = finish;
  return {
    end,
    stop(at) {
      for (const s of sources) { try { if (at === undefined) s.stop(); else s.stop(at); } catch { /* already stopped */ } }
    },
    onEnded(fn) { cb = fn; if (done) fn(); },
  };
}

// The node a stroke's parts connect to: `out`, or a cut gain in front of it when `until` falls before `end`.
// Returns { input, stopAt(t) } — stopAt pulls each source's stop in to just after the cut.
export function cutInput(ctx, out, at, end, until) {
  if (until === null || until === undefined || !(until < end)) return { input: out, stopAt: t => t };
  const cut = ctx.createGain();
  cut.gain.setValueAtTime(1, Math.max(at, until - CUT_SECONDS));
  cut.gain.linearRampToValueAtTime(0, until);
  cut.connect(out);
  return { input: cut, stopAt: t => Math.min(t, until + 0.01) };
}

// ── the primitives (chunk-tunes' own shapes, scaled by peak and pitch) ──

// a sine (or other wave) falling in pitch and dying away: the kick, the snare's tone, chunk-tunes' low drums
function sweep(ctx, into, stopAt, { type, from, to, seconds, level }, at, peak, pitch) {
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(hz(ctx, from * pitch), at);
  osc.frequency.exponentialRampToValueAtTime(hz(ctx, to * pitch), at + seconds);
  gain.gain.setValueAtTime(level * peak, at);
  gain.gain.exponentialRampToValueAtTime(FLOOR * peak, at + seconds);
  osc.connect(gain); gain.connect(into);
  osc.start(at); osc.stop(stopAt(at + seconds + 0.01));
  return osc;
}

// a burst of filtered noise dying away: the snare's rattle, the hat, the cymbal
function burst(ctx, into, stopAt, { type, freq, Q = null, seconds, level }, at, peak, pitch) {
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  src.buffer = noiseOf(ctx);
  filter.type = type; filter.frequency.value = hz(ctx, freq * pitch);
  if (Q !== null) filter.Q.value = Q;
  gain.gain.setValueAtTime(level * peak, at);
  gain.gain.exponentialRampToValueAtTime(FLOOR * peak, at + seconds);
  src.connect(filter); filter.connect(gain); gain.connect(into);
  src.start(at); src.stop(stopAt(at + seconds + 0.01));
  return src;
}

function stroke(parts, { ctx, out, at, peak = 1, pitch = 1, until = null }) {
  peak = positive(peak, 1); pitch = positive(pitch, 1);
  const end = at + Math.max(...parts.map(p => p.spec.seconds)) + 0.01;
  const { input, stopAt } = cutInput(ctx, out, at, end, until);
  const sources = parts.map(({ make, spec }) => make(ctx, input, stopAt, spec, at, peak, pitch));
  return strokeHandle(sources, end);
}

/** a sine falling `from` → `to` Hz over `seconds` (chunk-tunes' drop: its low drums) */
export function drop({ from, to, seconds, level, ...opts }) {
  return stroke([{ make: sweep, spec: { type: 'sine', from, to, seconds, level } }], opts);
}

/** highpassed noise at 7 kHz dying over `seconds` (chunk-tunes' hiss) */
export function hiss({ seconds, level, ...opts }) {
  return stroke([{ make: burst, spec: { type: 'highpass', freq: 7000, seconds, level } }], opts);
}

/** a short triangle at `freq` Hz (chunk-tunes' tick: the clave and the made perc) */
export function tick({ ctx, out, at, freq = 880, level = 0.2, peak = 1, pitch = 1, until = null }) {
  peak = positive(peak, 1); pitch = positive(pitch, 1);
  const end = at + 0.05;
  const { input, stopAt } = cutInput(ctx, out, at, end + 0.01, until);
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'triangle'; osc.frequency.value = hz(ctx, freq * pitch);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level * peak, at + 0.002);
  gain.gain.setValueAtTime(level * peak, end - 0.03);
  gain.gain.linearRampToValueAtTime(0, end);
  osc.connect(gain); gain.connect(input);
  osc.start(at); osc.stop(stopAt(end + 0.01));
  return strokeHandle([osc], end + 0.01);
}

// ── the five made kit sounds (chunk-tunes' arrVoices.made: strike kick/snare/hat, tick 880, hiss 0.4 s) ──

const KICK = [{ make: sweep, spec: { type: 'sine', from: 140, to: 46, seconds: 0.17, level: 0.5 } }];
const SNARE = [
  { make: sweep, spec: { type: 'triangle', from: 210, to: 160, seconds: 0.09, level: 0.14 } },
  { make: burst, spec: { type: 'bandpass', freq: 2200, Q: 0.6, seconds: 0.13, level: 0.26 } },
];
const HAT = [{ make: burst, spec: { type: 'highpass', freq: 7000, seconds: 0.035, level: 0.05 } }];

export const kick = opts => stroke(KICK, opts);
export const snare = opts => stroke(SNARE, opts);
export const hihat = opts => stroke(HAT, opts);
export const perc = opts => tick({ ...opts, freq: 880, level: 0.2 });
export const cym = opts => hiss({ ...opts, seconds: 0.4, level: 0.12 });

/** the made kit, in chunk-tunes' channel order. sampleLevel is chunk-tunes' KIT peak: how loud it plays a SAMPLE on
 *  that channel, so a caller playing samples at another level can keep chunk-tunes' made-vs-sample balance. */
export const MADE_DRUMS = Object.freeze({
  kick: Object.freeze({ label: 'Kick', play: kick, sampleLevel: 0.9 }),
  snare: Object.freeze({ label: 'Snare', play: snare, sampleLevel: 0.7 }),
  hihat: Object.freeze({ label: 'Hi-hat', play: hihat, sampleLevel: 0.4 }),
  perc: Object.freeze({ label: 'Perc', play: perc, sampleLevel: 0.5 }),
  cym: Object.freeze({ label: 'Cymbal', play: cym, sampleLevel: 0.35 }),
});
export const MADE_DRUM_IDS = Object.freeze(Object.keys(MADE_DRUMS));

/** play a made kit sound by id; null for an unknown id */
export function playMadeDrum(id, opts) {
  return Object.prototype.hasOwnProperty.call(MADE_DRUMS, id) ? MADE_DRUMS[id].play(opts) : null;
}
