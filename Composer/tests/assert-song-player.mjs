// assert-song-player.mjs — the player's song (Composer/ARRANGEMENT_ORDER.md, phase B: S10–S13), in Node, against the
// recording mock AudioContext (assert-lab.mjs' own: every node, param call, connection and start/stop is recorded).
//   • no getter, or getters that ignore the pass: booked byte for byte as the frozen player before the song
//     (fixtures/player-before.js) — every node, param call, connection, start and stop, and every MIDI message — with
//     the mix and without, MIDI and its clock on, a live tempo change, a lookahead of whole cycles, chains that wrap
//   • a song by hand (three passes of one cycle, different parts and drums each, repeated): each pass's voices and
//     strokes at their clock times and nothing of a part that pass doesn't sound; the getters asked with the pass
//     index, once a tick each
//   • S12: a chain held over its pass's end is released at the boundary, with the usual release, when the next pass
//     doesn't sound its part (missing, or `enabled: false`); one whose part plays on holds to its own end; a lone
//     note's length is cut the same way
//   • the duck follows each pass's kicks (the next pass's downbeat kick included); a drumless pass ducks nothing
//   • MIDI sends only what sounds in each pass, no note of a muted part is held over the boundary, the clock runs on
//   • passAt across a live tempo change (S13)
//   node Composer/tests/assert-song-player.mjs
import { compose, rearticulate } from '../core/compose.js';
import { createPlayer, chainsOf } from '../perform/composer-player.js';
import { createPlayer as createPlayerBefore } from './fixtures/player-before.js';
import { createComposerMidi, midiNotesOf, MIDI_PARTS, DRUM_CHANNEL } from '../perform/composer-midi.js';
import { DUCK_DEFAULTS } from '../perform/composer-master.js';
import { planVoice } from '../../Audio/voices/plan.js';
import { createInstrumentVoice } from '../../Audio/voices/voice.js';
import { getRecipe } from '../../Audio/voices/recipes.js';
import * as drumLibrary from '../../Audio/drums/index.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ── the recording mock (assert-lab.mjs', with the master chain's wave shapers) ──
function makeCtx() {
  const nodes = [];
  const param = (value) => {
    const p = { value, calls: [] };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = (...a) => { p.calls.push([m, ...a]); if (m === 'setValueAtTime') p.value = a[0]; return p; };
    return p;
  };
  const node = (kind, extra = {}) => { const n = { kind, outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() { this.outs = []; }, ...extra }; nodes.push(n); return n; };
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', nodes, resume() {},
    destination: null,
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node('compressor', { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25), reduction: 0 }),
    createWaveShaper: () => node('shaper', { curve: null, oversample: 'none' }),
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440), detune: param(0), started: null, stopped: [], setPeriodicWave() { this.type = 'custom'; }, start(t) { this.started = t; }, stop(t) { this.stopped.push(t); } }),
    createBufferSource: () => node('noise', { buffer: null, started: null, stopped: [], start(t) { this.started = t; }, stop(t) { this.stopped.push(t); } }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createPeriodicWave: () => ({}),
  };
  ctx.destination = node('destination');
  return ctx;
}
/** the whole recording: every node in creation order, its params' values and calls, its starts, stops and connections */
function recordOf(ctx) {
  return JSON.stringify(ctx.nodes.map((n) => {
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'function') continue;
      if (k === 'outs') out.outs = v.map((d) => ctx.nodes.indexOf(d));
      else if (v && typeof v === 'object' && Array.isArray(v.calls)) out[k] = [v.value, v.calls];
      else if (ArrayBuffer.isView(v)) out[k] = Array.from(v);
      else if (v == null || typeof v !== 'object' || Array.isArray(v)) out[k] = v;
    }
    return out;
  }));
}
const recorder = (name) => { const sent = []; return { name, id: name, sent, send(bytes, ts) { sent.push({ bytes: [...bytes], ts }); } }; };
const kind = (b) => b[0] & 0xF0, chan = (b) => b[0] & 0x0F;
const MADE_KIT = Object.freeze({ kick: 'made:kick', snare: 'made:snare', hat: 'made:hihat', perc: 'made:perc', cym: 'made:cym' });

console.log('Composer player: the song (S10–S13)');

// ── no getter, or getters that ignore the pass: today's booking, byte for byte ──
console.log('\n— a loop books as before, byte for byte (the frozen player, fixtures/player-before.js)');
/** one session on a fresh mock: play, run, a tempo change, run, stop → the recording and every MIDI message */
async function session(make, { spec, args, mix = null, ahead = null, factor = null, seconds, levels = null }) {
  const ctx = makeCtx(), now = () => ctx.currentTime * 1000;
  const ports = Object.fromEntries(MIDI_PARTS.map((id) => [id, recorder(id)])), clock = recorder('clock');
  const sink = createComposerMidi({ now });
  sink.setPorts(ports); sink.setClockPort(clock); sink.setEnabled(true);
  const player = make({ ctx, timers: {}, midi: sink, now, mix, ...(ahead ? { options: { aheadSeconds: ahead } } : {}) });
  if (player.chain) await player.chain.ready;
  if (levels) for (const [id, v] of Object.entries(levels)) player.setLevel(id, v);
  player.play(spec, ...args);
  const run = (s) => { const end = ctx.currentTime + s; while (ctx.currentTime < end) { ctx.currentTime += 0.025; player.tick(); } };
  run(seconds / 2);
  if (factor) player.setTimeFactor(factor);
  run(seconds / 2);
  player.stop();
  return recordOf(ctx) + JSON.stringify([...Object.values(ports), clock].map((p) => p.sent));
}
const note = (node, time, hz, duration, retrigger, extra = {}) => ({ node, time, hz, duration, velocity: 0.6, retrigger, ...extra });
// a spec by hand whose chains run past the cycle's end (a held chain, a lone note), kicks at both ends of the cycle
const WT = 2;
const wrapSpec = {
  knobs: { cycleSeconds: WT, tempoBpm: 120 },
  parts: [
    { id: 'lead', sound: 'flute', enabled: true, notes: [note(0, 0.2, 440, 0.6, true), note(1, 0.8, 495, 0.5, false), note(2, 1.4, 550, 0.3, true), note(3, 1.7, 660, 0.6, false)] },
    { id: 'bass', sound: 'sine', enabled: true, notes: [note(4, 0, 110, 0.4, true), note(5, 1.6, 123.75, 0.7, true)] },
    { id: 'inner', sound: 'sine', enabled: true, notes: [note(6, 0.5, 330, 0.5, true), note(7, 1.5, 352, 0.3, true), note(8, 1.8, 396, 0.4, false)] },
  ],
  drums: { enabled: true, kit: MADE_KIT, hits: [{ voice: 'kick', time: 0, velocity: 0.9 }, { voice: 'snare', time: 0.5, velocity: 0.7 }, { voice: 'kick', time: 1, velocity: 0.8 }, { voice: 'hat', time: 1.5, velocity: 0.4 }, { voice: 'kick', time: 1.997, velocity: 0.8 }] },
};
const s8 = compose([8, 7, 6, 5], 4, { seed: 1 }), s41 = compose([41, 42, 43, 0], 8, { seed: 1, worker: true });
const p8 = s8.parts.map((p, i) => (i === 1 ? rearticulate(p, { legato: !p.legato, cycleSeconds: s8.knobs.cycleSeconds }) : i === 3 ? { ...p, enabled: false } : p));
const d8 = { ...s8.drums, enabled: true, kit: MADE_KIT };
const levels = { lead: 0.5, chords: 0.3, comp: 0.9, bass: 1, inner: 0.2, drums: 0.6 };
const CASES = [
  { name: '8:7:6:5, no getter, no mix, a tempo change', spec: s8, args: [], seconds: 3.5 * 4, factor: 1.3 },
  { name: '8:7:6:5, getters that ignore the pass, the knock mix (the duck), levels, a part off, legato flipped', spec: s8, args: [() => p8, () => d8], argsNow: [(c) => p8, (c) => d8], mix: { master: 'knock' }, levels, seconds: 3 * 4, factor: 0.8 },
  { name: '41:42:43, the classic mix, a lookahead of two whole cycles', spec: s41, args: [() => s41.parts, () => s41.drums], argsNow: [(c) => s41.parts, (c) => s41.drums], mix: { master: 'classic' }, ahead: 2 * 8, seconds: 5 * 8, factor: 1.5 },
  { name: 'by hand: chains and a lone note over the cycle\'s end, kicks at both ends, the duck', spec: wrapSpec, args: [], mix: { master: 'none' }, seconds: 4 * WT + 0.3, factor: 1.25 },
  { name: 'by hand, getters that ignore the pass', spec: wrapSpec, args: [() => wrapSpec.parts, () => wrapSpec.drums], argsNow: [(c) => wrapSpec.parts, (c) => wrapSpec.drums], mix: { master: 'knock' }, seconds: 3 * WT, factor: 0.7 },
];
for (const k of CASES) {
  const before = await session(createPlayerBefore, k), after = await session(createPlayer, { ...k, args: k.argsNow ?? k.args });
  check(`${k.name}: the same recording (${(before.length / 1024).toFixed(0)} KB)`, before === after && before.length > 1000, `${before.length} vs ${after.length}`);
}

// ── a song by hand ──
console.log('\n— a song: each pass its own parts and drums');
// three passes of the one cycle, repeated; pass 1 drops the lead (missing) and the bass (off) and is drumless; pass 2
// switches the inner off and plays other drums
const [lead, bass, inner] = wrapSpec.parts;
const drums2 = { enabled: true, kit: MADE_KIT, hits: [{ voice: 'kick', time: 0, velocity: 0.9 }, { voice: 'snare', time: 0.75, velocity: 0.7 }, { voice: 'kick', time: 1.25, velocity: 0.8 }] };
const PASSES = [
  { parts: [lead, bass, inner], drums: wrapSpec.drums },
  { parts: [{ ...bass, enabled: false }, inner], drums: { ...wrapSpec.drums, enabled: false } },
  { parts: [lead, bass, { ...inner, enabled: false }], drums: drums2 },
];
const passOf = (c) => PASSES[c % PASSES.length];
const sounds = (c, id) => passOf(c).parts.some((p) => p.id === id && p.enabled);
const voicesRec = [], strokes = [], asks = [];
let tickNo = 0;
const voices = {
  getRecipe,
  planVoice: (r, opts) => { const p = planVoice(r, opts); voicesRec.push({ duration: opts.timing.duration, hz: opts.baseFreq, moves: [], releases: [] }); return p; },
  createInstrumentVoice: (args) => {
    const h = createInstrumentVoice(args), rec = voicesRec[voicesRec.length - 1];
    rec.when = args.when; rec.dest = args.destination;
    return { ...h, setFrequency: (hz, at, g) => { rec.moves.push([hz, at, g]); return h.setFrequency(hz, at, g); }, release: (at, r) => { rec.releases.push([at, r]); return h.release(at, r); } };
  },
};
const drumLib = { ...drumLibrary, playMadeDrum: (id, o) => { strokes.push({ id, at: o.at, out: o.out }); return drumLibrary.playMadeDrum(id, o); } };
const sctx = makeCtx(), snow = () => sctx.currentTime * 1000;
const sports = Object.fromEntries(MIDI_PARTS.map((id) => [id, recorder(id)])), sclock = recorder('clock');
const ssink = createComposerMidi({ now: snow });
ssink.setPorts(sports); ssink.setClockPort(sclock); ssink.setEnabled(true);
for (const p of Object.values(sports)) p.sent.length = 0;
const sp = createPlayer({ ctx: sctx, voices, drums: drumLib, timers: {}, midi: ssink, now: snow, mix: { master: 'classic' } });
for (const id of MIDI_PARTS) sp.setLevel(id, 1);
sp.play(wrapSpec, (c) => { asks.push(['parts', c, tickNo]); return passOf(c).parts; }, (c) => { asks.push(['drums', c, tickNo]); return passOf(c).drums; });
const L0 = sp.loopStart, NP = 5;   // five passes: 0 1 2, then 0 1 again
while (sctx.currentTime < L0 + NP * WT + 0.3) { sctx.currentTime += 0.025; tickNo++; sp.tick(); }
const bus = (d) => Object.keys(sp.buses).find((id) => sp.buses[id] === d);
const key = (when, id, hz) => `${when.toFixed(9)} ${id} ${hz}`;
const want = [], wantStrokes = [];
const MADE_OF = { kick: 'kick', snare: 'snare', hat: 'hihat', perc: 'perc', cym: 'cym' };
for (let c = 0; c <= NP; c++) {
  const base = L0 + c * WT;
  for (const part of passOf(c).parts) if (part.enabled) for (const ch of chainsOf(part)) if (c * WT + ch.notes[0].time < NP * WT) want.push(key(base + ch.notes[0].time, part.id, ch.notes[0].hz));
  const dr = passOf(c).drums;
  if (dr.enabled) for (const h of dr.hits) if (c * WT + h.time < NP * WT) wantStrokes.push(`${(base + h.time).toFixed(9)} ${MADE_OF[h.voice]}`);
}
const inSpan = (t) => t < L0 + NP * WT - 1e-9;
const got = voicesRec.filter((v) => inSpan(v.when)).map((v) => key(v.when, bus(v.dest), v.hz));
check(`every pass's voices at their clock times on their part's bus, and nothing of a part a pass doesn't sound (${want.length} over ${NP} passes)`, JSON.stringify(got.sort()) === JSON.stringify([...want].sort()), `${got.length} vs ${want.length}`);
const gotStrokes = strokes.filter((s) => inSpan(s.at)).map((s) => `${s.at.toFixed(9)} ${s.id}`);
check(`every pass's drum strokes at their clock times, none in the drumless pass (${wantStrokes.length})`, JSON.stringify(gotStrokes.sort()) === JSON.stringify([...wantStrokes].sort()) && strokes.every((s) => s.out === sp.buses.drums)
  && !strokes.some((s) => s.at > L0 + WT + 1e-9 && s.at < L0 + 2 * WT - 1e-9), `${gotStrokes.length} vs ${wantStrokes.length}`);
const asked = (what) => asks.filter((a) => a[0] === what);
const seenPasses = [...new Set(asked('parts').map((a) => a[1]))].sort((a, b) => a - b);
check(`the getters are asked with the pass index (${seenPasses.join(' ')}), each pass at most once a tick`, seenPasses.join() === [...Array(NP + 1).keys()].join()
  && ['parts', 'drums'].every((w) => new Set(asked(w).map((a) => `${a[1]}:${a[2]}`)).size === asked(w).length));

console.log('\n— S12: a held voice into a muted pass');
const voiceAt = (when, hz) => voicesRec.find((v) => near(v.when, when) && v.hz === hz);
const R = 0.08;   // the player's release
const lead0 = voiceAt(L0 + 1.4, 550), lead2 = voiceAt(L0 + 2 * WT + 1.4, 550), lead3 = voiceAt(L0 + 3 * WT + 1.4, 550);
check('the lead\'s chain over pass 0\'s end, the lead missing from pass 1: released at the boundary, with the usual release', lead0 && lead0.moves.length === 1 && near(lead0.moves[0][1], L0 + 1.7)
  && lead0.releases.length === 1 && near(lead0.releases[0][0], L0 + WT) && lead0.releases[0][1] === R, JSON.stringify([lead0?.moves, lead0?.releases]));
check('…and pass 2 → 3, where the lead plays on: held to its own end (as a loop holds it)', lead2 && lead2.releases.length === 1 && near(lead2.releases[0][0], L0 + 2 * WT + 2.3) && lead2.releases[0][1] === R
  && lead3 && near(lead3.releases[0][0], L0 + 4 * WT), JSON.stringify([lead2?.releases, lead3?.releases]));
const inner0 = voiceAt(L0 + 1.5, 352), inner1 = voiceAt(L0 + WT + 1.5, 352);
check('the inner\'s chain: pass 0 → 1 plays on to its end; pass 1 → 2, the inner `enabled: false`: released at the boundary', inner0 && near(inner0.releases[0][0], L0 + 2.2) && inner1 && inner1.releases.length === 1 && near(inner1.releases[0][0], L0 + 2 * WT) && inner1.releases[0][1] === R
  && !voicesRec.some((v) => bus(v.dest) === 'inner' && v.when >= L0 + 2 * WT - 1e-9 && v.when < L0 + 3 * WT - 1e-9), JSON.stringify([inner0?.releases, inner1?.releases]));
const bass0 = voiceAt(L0 + 1.6, 123.75), bass2 = voiceAt(L0 + 2 * WT + 1.6, 123.75), bass3 = voiceAt(L0 + 3 * WT + 1.6, 123.75);
check('a lone note over pass 0\'s end, the bass off in pass 1: its length cut at the boundary (0.4 s of 0.7); into a pass that plays it, whole', bass0 && near(bass0.duration, WT - 1.6, 1e-12)
  && bass2 && near(bass2.duration, 0.7, 1e-12) && bass3 && near(bass3.duration, WT - 1.6, 1e-12), JSON.stringify([bass0?.duration, bass2?.duration, bass3?.duration]));

console.log('\n— the duck follows the pass\'s kicks');
const D = DUCK_DEFAULTS, duck = sp.stages.inner.duck;
const ramps = duck.gain.calls.filter((c) => c[0] === 'linearRampToValueAtTime');
const deep = ramps.filter((c) => near(20 * Math.log10(c[1]), -D.depthDb, 1e-6)).map((c) => c[2].toFixed(9));
const kicks = [];   // fully down from each kick through its hold
for (let c = 0; c <= NP; c++) { const dr = passOf(c).drums; if (dr.enabled) for (const h of dr.hits) if (h.voice === 'kick' && c * WT + h.time < NP * WT - 0.01) kicks.push(L0 + c * WT + h.time); }
const downs = kicks.flatMap((k) => [k, k + D.holdMs / 1000]).map((t) => t.toFixed(9));
check(`down −${D.depthDb} dB at each pass's own kicks, pass 2's downbeat kick included (${kicks.length}), and nowhere else`, JSON.stringify([...new Set(deep.filter((t) => Number(t) < L0 + NP * WT - 0.01))].sort()) === JSON.stringify(downs.sort()), `${deep.length} ${downs.length}`);
const quiet = (from, to) => ramps.filter((c) => c[2] > from && c[2] < to);
const tail = 1.997 + (D.holdMs + D.recoveryMs) / 1000 + 1e-6, pre = D.attackMs / 1000 + 1e-6;
check('a drumless pass ducks nothing: no point from the recovery of the kick before it to the attack of the kick after (passes 1 and 4)', ramps.length > 0
  && quiet(L0 + tail, L0 + 2 * WT - pre).length === 0 && quiet(L0 + 3 * WT + tail, L0 + 5 * WT - pre).length === 0);

console.log('\n— MIDI sends only what sounds');
const onsIn = (port, from, to) => port.sent.filter((m) => kind(m.bytes) === 0x90 && m.bytes[2] > 0 && m.ts >= from * 1000 - 1e-6 && m.ts < to * 1000 - 1e-6);
let midiMiss = '', midiN = 0;
for (let c = 0; c < NP; c++) {
  const from = L0 + c * WT, to = from + WT;
  for (const id of ['lead', 'bass', 'inner']) {
    const part = passOf(c).parts.find((p) => p.id === id && p.enabled);
    const wantTs = part ? midiNotesOf(part, WT).map((n) => (from + n.time).toFixed(6)) : [];
    const gotTs = onsIn(sports[id], from, to).map((m) => (m.ts / 1000).toFixed(6));
    midiN += gotTs.length;
    if (JSON.stringify(gotTs.sort()) !== JSON.stringify(wantTs.sort())) midiMiss ||= `pass ${c} ${id}: ${gotTs} ≠ ${wantTs}`;
  }
  const dr = passOf(c).drums, dWant = dr.enabled ? dr.hits.length : 0, dGot = onsIn(sports.drums, from, to);
  if (dGot.length !== dWant || !dGot.every((m) => chan(m.bytes) === DRUM_CHANNEL)) midiMiss ||= `pass ${c} drums: ${dGot.length} ≠ ${dWant}`;
}
check(`each pass's notes and strokes, and nothing of a part or drums a pass mutes (${midiN} notes over ${NP} passes)`, !midiMiss && midiN > 0, midiMiss);
/** the notes still sounding on a port at clock time t (on before it, off after it) */
const heldAt = (port, t) => {
  const held = new Map();
  for (const m of [...port.sent].sort((a, b) => a.ts - b.ts)) {
    if (m.ts > t * 1000 + 1e-6) break;
    const k = `${chan(m.bytes)}:${m.bytes[1]}`;
    if (kind(m.bytes) === 0x90 && m.bytes[2] > 0) held.set(k, (held.get(k) ?? 0) + 1); else if (kind(m.bytes) === 0x80 || kind(m.bytes) === 0x90) held.set(k, Math.max(0, (held.get(k) ?? 0) - 1));
  }
  return [...held.values()].reduce((a, b) => a + b, 0);
};
check('no note of a part muted in the next pass is held over the boundary (the lead and bass into pass 1, the inner into pass 2)', heldAt(sports.lead, L0 + WT + 1e-4) === 0 && heldAt(sports.bass, L0 + WT + 1e-4) === 0 && heldAt(sports.inner, L0 + 2 * WT + 1e-4) === 0
  && sounds(0, 'lead') && !sounds(1, 'lead') && !sounds(1, 'bass') && !sounds(2, 'inner'));
const ticks = sclock.sent.filter((m) => m.bytes[0] === 0xF8), dtMs = 60000 / wrapSpec.knobs.tempoBpm / 24;
check(`the MIDI clock runs on across the passes (${ticks.length} ticks, ${dtMs.toFixed(2)} ms apart throughout)`, ticks.length > NP * WT * 1000 / dtMs - 2 && ticks.slice(1).every((t, i) => Math.abs(t.ts - ticks[i].ts - dtMs) < 1e-6));
check('S13: passAt names the pass sounding (0 at the start, 2 mid-pass 2, 4 now)', sp.passAt(L0 + 0.01) === 0 && sp.passAt(L0 + 2 * WT + 1) === 2 && sp.passAt() === Math.floor((sctx.currentTime - L0) / WT));
sp.stop();
check('…and null once stopped', sp.passAt() === null);

console.log('\n— passAt across a live tempo change');
{
  const ctx = makeCtx(), p = createPlayer({ ctx, timers: {} });
  check('null before play', p.passAt() === null);
  p.play(wrapSpec, (c) => passOf(c).parts, (c) => passOf(c).drums);
  const P0 = p.loopStart;
  let B = Infinity, SB = Infinity, F = 1, miss = '', seen = new Set();
  const specOf = (t) => (t < B ? t - P0 : SB + (t - B) / F);
  // every tick: the pass now, and the pass at the edge of the booking and just inside it (the lookahead, on the map)
  const step = () => {
    ctx.currentTime += 0.025; p.tick();
    for (const t of [ctx.currentTime, p.booked - 1e-6, (ctx.currentTime + p.booked) / 2]) {
      const want = Math.max(0, Math.floor(specOf(t) / WT)), got = p.passAt(t);
      seen.add(got);
      if (got !== want) miss ||= `clock ${t.toFixed(6)} (spec ${specOf(t).toFixed(6)}): ${got} ≠ ${want}`;
    }
  };
  check('before the loop starts: pass 0', p.passAt(P0 - 0.04) === 0);
  while (ctx.currentTime < P0 + 1.3 * WT) step();
  B = p.booked; SB = B - P0; F = 1.5;
  p.setTimeFactor(F);
  while (ctx.currentTime < B + 3 * WT * F) step();
  // either side of each boundary still to come, on the new tempo
  for (const S of [4 * WT - 1e-6, 4 * WT + 1e-6, 5 * WT - 1e-6, 5 * WT + 1e-6]) {
    const t = B + (S - SB) * F, want = Math.floor(S / WT);
    if (p.passAt(t) !== want) miss ||= `spec ${S} (clock ${t.toFixed(6)}): ${p.passAt(t)} ≠ ${want}`;
  }
  check(`now, and through the lookahead, every tick, before and after a change to ×${F} mid-pass 1 (passes ${[...seen].sort().join(' ')}); either side of the boundaries to come`, !miss && seen.size >= 4, miss);
  check('the playhead and passAt agree on the place: pass + playhead = spec time / cycle', near(p.passAt() + p.playhead(), (SB + (ctx.currentTime - B) / F) / WT, 1e-9));
  p.stop();
}

console.log('\n— the call: in a loop, a part switched off while its voice holds over the loop\'s end');
{
  // the same rule as a song's (S12): the loop's next pass is the loop again, without the part
  const ctx = makeCtx(), recs = [];
  const v = { getRecipe, planVoice, createInstrumentVoice: (args) => { const h = createInstrumentVoice(args), rec = { when: args.when, releases: [] }; recs.push(rec); return { ...h, release: (at, r) => { rec.releases.push([at, r]); return h.release(at, r); } }; } };
  let parts = wrapSpec.parts;
  const p = createPlayer({ ctx, voices: v, timers: {} });
  p.play(wrapSpec, () => parts);
  const P0 = p.loopStart;
  while (ctx.currentTime < P0 + 1.75) { ctx.currentTime += 0.025; p.tick(); }
  parts = parts.map((x) => (x.id === 'lead' ? { ...x, enabled: false } : x));
  while (ctx.currentTime < P0 + 2.5) { ctx.currentTime += 0.025; p.tick(); }
  const held = recs.find((r) => near(r.when, P0 + 1.4));
  check('released at the loop\'s end instead of its own (2.3 s)', held && held.releases.length === 1 && near(held.releases[0][0], P0 + WT), JSON.stringify(held?.releases));
  p.stop();
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
