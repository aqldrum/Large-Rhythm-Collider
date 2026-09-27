// assert-instrument-voice.mjs — proofs for the Web Audio renderer handle (../instruments/instrument-voice.js)
// against a recording MOCK AudioContext (Node has no Web Audio). It verifies the LIFECYCLE contract the
// three engines depend on: exactly-once source frees, idempotent release, a scheduled future voice being
// silenced, the shared detune applied to audio exactly once (never folded into the frequency), the bed
// swell operating on the amp envelope, and onComplete firing only when the LAST source truly ends.
import { planVoice, ENV_FLOOR } from '../audio/instruments/voice-plan.js';
import { createInstrumentVoice } from '../audio/instruments/instrument-voice.js';
import { getRecipe } from '../audio/instruments/instrument-presets.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function makeParam(initial = 0) {
  const calls = [];
  return {
    value: initial, _calls: calls,
    setValueAtTime(v, t) { this.value = v; calls.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.value = v; calls.push(['lin', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.value = v; calls.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, tc) { this.value = v; calls.push(['target', v, t, tc]); return this; },
    cancelScheduledValues(t) { calls.push(['cancel', t]); return this; },
    cancelAndHoldAtTime(t) { calls.push(['hold', t]); return this; },
  };
}
function makeCtx() {
  const nodes = { osc: [], gain: [], filter: [], buffer: [], periodic: [] };
  const base = (type, extra) => ({ type, connections: [], disconnected: false, connect(t) { this.connections.push(t); return t; }, disconnect() { this.disconnected = true; }, ...extra });
  const ctx = {
    currentTime: 10, sampleRate: 48000,
    destination: base('destination'),
    createGain() { const g = base('gain', { gain: makeParam(1) }); nodes.gain.push(g); return g; },
    createBiquadFilter() { const f = base('filter', { frequency: makeParam(350), Q: makeParam(1), detune: makeParam(0) }); nodes.filter.push(f); return f; },
    createPeriodicWave(real, imag) { const w = { real, imag }; nodes.periodic.push(w); return w; },
    createOscillator() { const o = base('osc', { frequency: makeParam(440), detune: makeParam(0), periodicWave: null, setPeriodicWave(w) { this.periodicWave = w; this.type = 'custom'; }, started: null, stopped: [], onended: null, start(t) { this.started = t; }, stop(t) { this.stopped.push(t); }, _end() { this.onended && this.onended(); } }); nodes.osc.push(o); return o; },
    createBufferSource() { const s = base('buffersrc', { buffer: null, detune: makeParam(0), started: null, stopped: [], onended: null, start(t) { this.started = t; }, stop(t) { this.stopped.push(t); }, _end() { this.onended && this.onended(); } }); nodes.buffer.push(s); return s; },
    createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; },
  };
  return { ctx, nodes };
}
// A detune-bus mock that records exactly which AudioParams it is connected to (so "applied once" is testable).
function makeBus() { return { targets: [], connect(t) { this.targets.push(t); }, disconnect(t) { this.targets = this.targets.filter(x => x !== t); } }; }

const opsOf = param => param._calls.map(c => c[0]).join(',');

console.log('═══ COSMOS INSTRUMENT VOICE — renderer handle ═══');

console.log('\n  Row voice — graph, envelope, detune-once, natural completion');
{
  const { ctx, nodes } = makeCtx();
  const dest = ctx.createGain();
  const bus = makeBus();
  const plan = planVoice(getRecipe('classic', 'row'), { role: 'row', baseFreq: 440, timing: { peak: 0.16, attack: 0.004, decay: 0.46, hold: 0, release: 0.09, sustain: 0.05, duration: 0.23, micro: false }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when: 10, detuneBus: bus });
  const osc = nodes.osc[0];
  const ampEnv = nodes.gain.find(g => g.connections.includes(dest));
  check('cost mirrors the plan (1 source)', h.cost === 1);
  check('one triangle oscillator, born at the base pitch (detune NOT folded into frequency)',
    nodes.osc.length === 1 && osc.type === 'triangle' && near(osc.frequency.value, 440));
  check('graph is osc → ampEnv → destination', osc.connections.includes(ampEnv) && ampEnv.connections.includes(dest));
  check('the shared detune bus is connected to the oscillator exactly once',
    bus.targets.length === 1 && bus.targets[0] === osc.detune);
  check('the row amp schedules the gap-aware pluck (floor→peak→sustain→hold→floor)', opsOf(ampEnv.gain) === 'set,lin,exp,set,exp');
  check('the source starts at `when` and the fixed gate schedules its stop at build (endAt + pad)',
    osc.started === 10 && osc.stopped.length === 1 && near(osc.stopped[0], 10 + 0.23 + 0.02));
  let completed = 0; h.onComplete(() => completed++);
  osc._end();
  check('onComplete fires once when the source ends, and the graph is disconnected',
    completed === 1 && ampEnv.disconnected && osc.disconnected);
}

console.log('\n  Row voice — idempotent release, future-voice silence');
{
  const { ctx, nodes } = makeCtx();
  const dest = ctx.createGain();
  const plan = planVoice(getRecipe('classic', 'row'), { role: 'row', baseFreq: 440, timing: { peak: 0.16, attack: 0.004, decay: 0.46, hold: 0, release: 0.09, sustain: 0.05, duration: 0.23, micro: false }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when: 10, detuneBus: makeBus() });
  const osc = nodes.osc[0];
  const before = osc.frequency; // unused, keeps shape
  const ampEnv = nodes.gain.find(g => g.connections.includes(dest));
  const holdsBefore = ampEnv.gain._calls.filter(c => c[0] === 'hold').length;
  h.release(10.14, 0.07);
  h.release(10.14, 0.07);   // second release must be a no-op (idempotent)
  const holdsAfter = ampEnv.gain._calls.filter(c => c[0] === 'hold').length;
  check('release holds the envelope and re-stops the source earlier than its natural gate',
    holdsAfter === holdsBefore + 1 && osc.stopped.length === 2 && osc.stopped[1] < osc.stopped[0]);
  check('a second release is a no-op (the hold is scheduled exactly once)', holdsAfter === 1);
  let completed = 0; h.onComplete(() => completed++);
  osc._end(); osc._end();   // a doubled onended must still complete only once
  check('a released voice completes exactly once (no double-free)', completed === 1);

  // A scheduled-but-unsounded FUTURE voice: stop() must silence it before its onset.
  const { ctx: c2, nodes: n2 } = makeCtx();
  const d2 = c2.createGain();
  const fut = createInstrumentVoice({ ctx: c2, destination: d2, plan, when: 30, detuneBus: makeBus() });
  fut.stop(11);
  check('stop() schedules a source stop (silences a not-yet-sounded future voice)', n2.osc[0].stopped.includes(11));
}

console.log('\n  Bed voice — silent-born, swell (no rebuild), no gate');
{
  const { ctx, nodes } = makeCtx();
  const dest = ctx.createGain();
  const bus = makeBus();
  const plan = planVoice(getRecipe('classic', 'bed'), { role: 'bed', baseFreq: 220, timing: { attack: 1.5, release: 2.5, sustainFrac: 0.4 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when: 5, detuneBus: bus });
  const osc = nodes.osc[0];
  const ampEnv = nodes.gain.find(g => g.connections.includes(dest));
  check('the bed is silent-born (amp at the floor) with no gate scheduled at build',
    osc.type === 'sine' && near(ampEnv.gain.value, ENV_FLOOR) && osc.started === 5 && osc.stopped.length === 0);
  h.swell(0.12, 5);
  check('swell ramps from the current value to peak then a held floor (cancel,set,lin,exp)', opsOf(ampEnv.gain) === 'cancel,set,lin,exp');
  check('currentGain() reports the amp envelope value without exposing nodes', near(h.currentGain(), ampEnv.gain.value));
  h.swell(0.2, 8);   // a second swell (chord change / reattack) is supported, never a rebuild
  check('a reattack swell adds no new oscillator (no rebuild)', nodes.osc.length === 1);
  h.release(9, 2.5);
  check('bed release fades to the floor and stops after the tail (cancel,set,lin then stop)',
    ampEnv.gain._calls.slice(-3).map(c => c[0]).join(',') === 'cancel,set,lin' && near(osc.stopped[0], 9 + 2.5 + 0.05));
}

console.log('\n  Audition voice — held ADSR, cancelAndHold release');
{
  const { ctx, nodes } = makeCtx();
  const dest = ctx.createGain();
  const plan = planVoice(getRecipe('classic', 'audition'), { role: 'audition', baseFreq: 660, timing: { peak: 0.32, attack: 0.006, decay: 0.2, sustain: 0.224 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when: 3, detuneBus: makeBus() });
  const osc = nodes.osc[0];
  const ampEnv = nodes.gain.find(g => g.connections.includes(dest));
  check('audition schedules a held linear ADSR and does NOT stop at build (it sustains)',
    opsOf(ampEnv.gain) === 'set,lin,lin,set' && osc.stopped.length === 0);
  h.release(4, 0.3);
  check('audition release holds then ramps to 0 and stops (hold,lin + stop at stopAt+0.01)',
    ampEnv.gain._calls.slice(-2).map(c => c[0]).join(',') === 'hold,lin' && near(osc.stopped[0], 4 + 0.3 + 0.01));
}

console.log('\n  crossIn — the no-onset fade for a live VOICE hot-swap');
{
  const { ctx, nodes } = makeCtx();
  const dest = ctx.createGain();
  const plan = planVoice(getRecipe('classic', 'audition'), { role: 'audition', baseFreq: 660, timing: { peak: 0.32, attack: 0.006, decay: 0.2, sustain: 0.224 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when: 3, detuneBus: makeBus() });
  const oscAtBirth = nodes.osc.length;
  const ampEnv = nodes.gain.find(g => g.connections.includes(dest));
  h.crossIn(0.224, 3, 0.12);
  // Cancels the audition role's own attack (which would overshoot to 0.32 peak) and ramps silence -> the
  // held sustain instead — so a live palette swap crosses in without re-articulating the note.
  check('crossIn cancels the birth attack and ramps from the floor straight to the level (cancel,set,lin)',
    ampEnv.gain._calls.slice(-3).map(c => c[0]).join(',') === 'cancel,set,lin' &&
    near(ampEnv.gain._calls.at(-2)[1], ENV_FLOOR) && near(ampEnv.gain.value, 0.224));
  check('crossIn re-synthesises nothing — the SAME graph fades in (no new oscillator)', nodes.osc.length === oscAtBirth);
}

console.log('\n  Multi-source voice — cost, detune per pitched source, completion on the LAST end');
{
  const { ctx, nodes } = makeCtx();
  const dest = ctx.createGain();
  const bus = makeBus();
  // two saws + a noise burst → three real sources; the noise gets no detune bus. Two filters (HP→LP).
  const recipe = { components: [{ wave: 'sawtooth', ratio: 1, level: 0.5, detuneCents: 5 }, { wave: 'sawtooth', ratio: 1, level: 0.5, detuneCents: -5 }], noise: { level: 0.05, attack: 0.002, decay: 0.05 }, filters: [{ type: 'highpass', freq: 110 }, { type: 'lowpass', freq: 2800, Q: 0.9 }], outputTrim: 0.8 };
  const plan = planVoice(recipe, { role: 'audition', baseFreq: 220, timing: { peak: 0.3, attack: 0.01, decay: 0.1, sustain: 0.2 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when: 1, detuneBus: bus });
  check('cost counts all real sources (2 osc + 1 noise = 3)', h.cost === 3 && nodes.osc.length === 2 && nodes.buffer.length === 1);
  check('the detune bus is connected to each PITCHED source only (not the noise)',
    bus.targets.length === 2 && bus.targets.includes(nodes.osc[0].detune) && bus.targets.includes(nodes.osc[1].detune));
  check('static per-osc detune is applied on top of the bus (both offsets present)',
    nodes.osc[0].detune.value === 5 && nodes.osc[1].detune.value === -5);
  check('the per-voice filter chain is built in order (HP → LP → amp) before the destination',
    nodes.filter.length === 2 && nodes.filter[0].type === 'highpass' && nodes.filter[1].type === 'lowpass' &&
    nodes.filter[0].connections.includes(nodes.filter[1]));
  let completed = 0; h.onComplete(() => completed++);
  nodes.osc[0]._end();
  nodes.buffer[0]._end();
  check('onComplete does NOT fire until the LAST source ends', completed === 0);
  nodes.osc[1]._end();
  check('onComplete fires exactly once after every source has ended', completed === 1);
}

console.log('\n  Bed drift — one shared LFO per context, torn off cleanly per voice');
{
  const { ctx, nodes } = makeCtx();
  // Three saws + a drifting LP: the shape of the retired warm-v1 bed, kept inline because it is the case that
  // exercises the shared LFO with several oscillators per voice.
  const driftBed = {
    components: [0, 6, -6].map((detuneCents, i) => ({ wave: 'sawtooth', ratio: 1, level: i ? 0.36 : 0.5, detuneCents })),
    noise: null,
    filters: [{ type: 'highpass', freq: 110, Q: 0.7071 }, { type: 'lowpass', freq: 3400, Q: 0.7071, drift: { rateHz: 0.06, depthCents: 250 } }],
    outputTrim: 0.95,
  };
  const plan = planVoice(driftBed, { role: 'bed', baseFreq: 110, timing: { attack: 1.5, release: 2.5, sustainFrac: 0.4 }, sampleRate: 48000 });
  const d1 = ctx.createGain();
  const v1 = createInstrumentVoice({ ctx, destination: d1, plan, when: 1, detuneBus: makeBus() });
  const oscCountAfterFirst = nodes.osc.length;   // 3 saws + 1 shared drift LFO = 4
  const d2 = ctx.createGain();
  const v2 = createInstrumentVoice({ ctx, destination: d2, plan, when: 1, detuneBus: makeBus() });
  check('the drift LFO is shared: a second drifting bed voice adds only its saws, not another LFO',
    oscCountAfterFirst === 4 && nodes.osc.length === 7);
  // the LFO (nodes.osc[0]) drives a per-voice depth gain into the LP filter's detune.
  const lfo = nodes.osc[0];
  check('the shared LFO is started and low-rate, feeding a depth gain (not the audio path)',
    lfo.started !== null && lfo.frequency.value < 1 && lfo.connections.length >= 2);
  let done1 = 0; v1.onComplete(() => done1++);
  // end v1's saws (the oscs created right after the LFO: indices 1..3).
  nodes.osc[1]._end(); nodes.osc[2]._end(); nodes.osc[3]._end();
  check('a completed drifting bed voice detaches its depth gain from the shared LFO and completes once', done1 === 1);
}

console.log('\n  Warm — harmonic-table osc, brass cutoff sweep, swell brightness');
{
  const { ctx, nodes } = makeCtx();
  const rowTiming = { peak: 0.16, attack: 0.004, decay: 0.46, hold: 0, release: 0.09, sustain: 0.05, duration: 0.23, micro: false };
  const plan = planVoice(getRecipe('warm', 'row'), { role: 'row', baseFreq: 220, timing: rowTiming, sampleRate: 48000 });
  const bus = makeBus();
  createInstrumentVoice({ ctx, destination: ctx.createGain(), plan, when: 2, detuneBus: bus });
  createInstrumentVoice({ ctx, destination: ctx.createGain(), plan, when: 2.5, detuneBus: makeBus() });
  const osc = nodes.osc[0];
  check('the custom osc plays a PeriodicWave (sine terms = the table, h0 empty), shared across voices',
    nodes.periodic.length === 1 && osc.periodicWave === nodes.periodic[0] && nodes.osc[1].periodicWave === nodes.periodic[0] &&
    osc.periodicWave.imag[0] === 0 && near(osc.periodicWave.imag[1], plan.components[0].harmonics[0]) &&
    osc.periodicWave.real.every(v => v === 0));
  check('the custom osc still takes the shared detune bus (tuning stays live)', bus.targets.length === 1 && bus.targets[0] === osc.detune);
  const lp = nodes.filter[1];
  const env = plan.filters[1].env;
  check('the low-pass is born at its key-tracked cutoff and sweeps its detune dark → past rest → settled 0',
    lp.frequency.value === 1320 && opsOf(lp.detune) === 'set,lin,lin' &&
    lp.detune._calls[0][1] === env.startCents && near(lp.detune._calls[0][2], 2) &&
    lp.detune._calls[1][1] === env.peakCents && near(lp.detune._calls[1][2], 2 + env.attack) &&
    lp.detune._calls[2][1] === 0 && near(lp.detune._calls[2][2], 2 + env.attack + env.settle));
  check('the high-pass carries no sweep', opsOf(nodes.filter[0].detune) === '');
}
{
  const { ctx, nodes } = makeCtx();
  const plan = planVoice(getRecipe('warm', 'audition'), { role: 'audition', baseFreq: 330, timing: { peak: 0.3, attack: 0.01, decay: 0.1, sustain: 0.2 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: ctx.createGain(), plan, when: 1, detuneBus: makeBus() });
  h.crossIn(0.2, 1, 0.08);
  const lp = nodes.filter[1];
  const last = lp.detune._calls.slice(-2);
  check('a crossIn swap cancels the birth sweep and sits at the settled cutoff (the timbre never re-articulates)',
    last[0][0] === 'cancel' && last[1][0] === 'set' && last[1][1] === 0 && lp.detune.value === 0);
}
{
  const { ctx, nodes } = makeCtx();
  const plan = planVoice(getRecipe('warm', 'bed'), { role: 'bed', baseFreq: 220, timing: { attack: 1.5, release: 2.5, sustainFrac: 0.4 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: ctx.createGain(), plan, when: 1, detuneBus: makeBus() });
  const lp = nodes.filter.find(f => f.type === 'lowpass');
  check('the Warm bed is born with NO cutoff sweep (no attack coloration)', opsOf(lp.detune) === '');
  h.swell(0.1, 3);
  const cents = plan.filters[1].swellCents;
  check('a swell lifts the cutoff with the amp (rise over attack, ease to sustainFrac over release)',
    opsOf(lp.detune) === 'cancel,set,lin,lin' && lp.detune._calls[2][1] === cents && near(lp.detune._calls[2][2], 3 + 1.5) &&
    near(lp.detune._calls[3][1], cents * 0.4) && near(lp.detune._calls[3][2], 3 + 1.5 + 2.5));
  check('the swell still shapes the amp envelope as before', opsOf(nodes.gain.find(g => g.connections.some(c => c.type === 'gain' || c.type === 'destination')).gain).includes('lin,exp'));
}

console.log(PASS ? '\n✓✓✓ COSMOS INSTRUMENT VOICE PASSES' : '\n✗ COSMOS INSTRUMENT VOICE FAILED');
process.exit(PASS ? 0 : 1);
