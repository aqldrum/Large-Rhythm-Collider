// assert-voices.mjs — proofs for what the shared library adds over Cosmos's instrument layer, against a recording
// MOCK AudioContext (Node has no Web Audio; same mock shape as Cosmos/tests/assert-instrument-voice.mjs):
//   • the generic `note` role: the caller's ADSR (fixed length = main Playback's startStandardNote curve; held =
//     startLegatoNote's), and a recipe's own held / struck amp overriding it
//   • hold and release: a held note sounds until release(), a ringing struck sound ignores it, a damped one stops
//   • setFrequency(): every oscillator glides with its ratio kept, key-tracked filters follow, others stay put
//   • the four basic waveforms as recipes, and registerInstrument() with its live catalog views
import {
  registerInstrument, getInstrument, getRecipe, normalizeNoteInstrumentId, normalizeInstrumentId,
  INSTRUMENTS, INSTRUMENT_IDS, PRODUCTION_INSTRUMENT_IDS, NOTE_INSTRUMENT_IDS, CATALOG_IDS, VOICE_ROLES,
  DEFAULT_NOTE_INSTRUMENT,
} from '../voices/recipes.js';
import { planVoice, ampValueAt, decaySeconds, ENV_FLOOR } from '../voices/plan.js';
import { createInstrumentVoice } from '../voices/voice.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

function makeParam(initial = 0, { hold = true } = {}) {
  const calls = [];
  const p = {
    value: initial, _calls: calls,
    setValueAtTime(v, t) { this.value = v; calls.push(['set', v, t]); return this; },
    linearRampToValueAtTime(v, t) { this.value = v; calls.push(['lin', v, t]); return this; },
    exponentialRampToValueAtTime(v, t) { this.value = v; calls.push(['exp', v, t]); return this; },
    setTargetAtTime(v, t, tc) { this.value = v; calls.push(['target', v, t, tc]); return this; },
    cancelScheduledValues(t) { calls.push(['cancel', t]); return this; },
  };
  if (hold) p.cancelAndHoldAtTime = function (t) { calls.push(['hold', t]); return this; };
  return p;
}
function makeCtx({ hold = true } = {}) {
  const nodes = { osc: [], gain: [], filter: [], buffer: [], periodic: [] };
  const base = (type, extra) => ({ type, connections: [], disconnected: false, connect(t) { this.connections.push(t); return t; }, disconnect() { this.disconnected = true; }, ...extra });
  const param = v => makeParam(v, { hold });
  const ctx = {
    currentTime: 10, sampleRate: 48000,
    createGain() { const g = base('gain', { gain: param(1) }); nodes.gain.push(g); return g; },
    createBiquadFilter() { const f = base('filter', { frequency: param(350), Q: param(1), detune: param(0) }); nodes.filter.push(f); return f; },
    createPeriodicWave(real, imag) { const w = { real, imag }; nodes.periodic.push(w); return w; },
    createOscillator() { const o = base('osc', { frequency: param(440), detune: param(0), setPeriodicWave(w) { this.type = 'custom'; }, started: null, stopped: [], onended: null, start(t) { this.started = t; }, stop(t) { this.stopped.push(t); }, _end() { this.onended && this.onended(); } }); nodes.osc.push(o); return o; },
    createBufferSource() { const s = base('buffersrc', { buffer: null, started: null, stopped: [], onended: null, start(t) { this.started = t; }, stop(t) { this.stopped.push(t); }, _end() { this.onended && this.onended(); } }); nodes.buffer.push(s); return s; },
    createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; },
  };
  return { ctx, nodes };
}
// Build a note voice; returns the handle, the mock nodes and the amp-envelope gain (the one feeding the trim/destination).
function noteVoice(id, timing, { baseFreq = 440, when = 10, low = false, hold = true } = {}) {
  const { ctx, nodes } = makeCtx({ hold });
  const dest = ctx.createGain();
  const plan = planVoice(getRecipe(id, 'note'), { role: 'note', baseFreq, timing, sampleRate: ctx.sampleRate, low });
  const h = createInstrumentVoice({ ctx, destination: dest, plan, when });
  const tail = nodes.gain.find(g => g.connections.includes(dest));
  const ampEnv = plan.outputTrim !== 1 ? nodes.gain.find(g => g.connections.includes(tail)) : tail;
  return { h, plan, ctx, nodes, dest, ampEnv };
}
const calls = param => param._calls.map(c => c.map(x => (typeof x === 'number' ? +x.toFixed(9) : x)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('═══ AUDIO VOICES — note role, hold/release, setFrequency, registry ═══');

console.log('\n  The four waveforms, as note recipes');
for (const wave of ['sine', 'triangle', 'sawtooth', 'square']) {
  const r = getRecipe(wave, 'note');
  check(`${wave}: one ${wave} oscillator at the pitch, no noise/filters/amp, trim 1`,
    r.components.length === 1 && r.components[0].wave === wave && r.components[0].ratio === 1 && r.components[0].level === 1 &&
    r.noise === null && r.filters.length === 0 && !r.amp && r.outputTrim === 1 && NOTE_INSTRUMENT_IDS.includes(wave));
}
check('the note role falls back to sine (unknown id, or an instrument without a note role)',
  DEFAULT_NOTE_INSTRUMENT === 'sine' && normalizeNoteInstrumentId('bogus') === 'sine' && normalizeNoteInstrumentId(7) === 'sine' &&
  normalizeNoteInstrumentId('classic') === 'sine' && normalizeNoteInstrumentId('marimba') === 'marimba' &&
  getRecipe('bogus', 'note') === getRecipe('sine', 'note') && getRecipe('classic', 'note') === getRecipe('sine', 'note'));
check('the waveforms and note-only sounds stay out of Cosmos (its views, normalizer and row recipes)',
  ['sine', 'square', 'marimba', 'glassbed'].every(id => !INSTRUMENT_IDS.includes(id) && !(id in INSTRUMENTS) && normalizeInstrumentId(id) === 'classic' &&
    getRecipe(id, 'row') === getRecipe('classic', 'row')));

console.log('\n  note role — the caller\'s ADSR, fixed length (main Playback\'s startStandardNote)');
{
  const adsr = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 };
  const peak = 0.8, duration = 1, when = 10;
  const { h, nodes, ampEnv, plan } = noteVoice('sine', { ...adsr, peak, duration }, { when });
  // ToneRowPlayback.startStandardNote, transcribed: the curve the library must reproduce for Phase 1a.
  const sustainGain = adsr.sustain * peak, sustainTime = Math.max(0, duration - adsr.attack - adsr.decay - adsr.release);
  const legacy = [['set', 0, when], ['lin', peak, when + adsr.attack], ['lin', sustainGain, when + adsr.attack + adsr.decay],
    ['set', sustainGain, when + adsr.attack + adsr.decay + sustainTime], ['lin', 0, when + duration]];
  check('one sine at the pitch, cost 1, straight into the amp envelope', h.cost === 1 && nodes.osc.length === 1 && nodes.osc[0].type === 'sine' && near(nodes.osc[0].frequency.value, 440) && nodes.osc[0].connections[0] === ampEnv);
  check('the amp envelope is startStandardNote\'s, event for event', same(calls(ampEnv.gain), calls({ _calls: legacy })), JSON.stringify(calls(ampEnv.gain)));
  check('the oscillator starts at `when` and stops at when + max(0.01, duration)', nodes.osc[0].started === when && same(nodes.osc[0].stopped, [when + 1]));
  check('the plan knows its kind, length and release (max(release, 0.01))', plan.amp.kind === 'adsr' && plan.amp.seconds === 1 && plan.amp.release === 0.2 && plan.amp.duration === 1);
}

console.log('\n  note role — held (duration null) until release (main Playback\'s startLegatoNote + releaseLayerVoice)');
{
  const adsr = { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.3 };
  const { h, nodes, ampEnv, plan } = noteVoice('triangle', { ...adsr, peak: 0.5, duration: null });
  const S = 0.6 * 0.5;
  check('the held curve rises, decays to sustain and holds there (no fall, no stop scheduled)',
    same(calls(ampEnv.gain), calls({ _calls: [['set', 0, 10], ['lin', 0.5, 10.02], ['lin', S, 10.17], ['set', S, 10.18]] })) &&
    nodes.osc[0].stopped.length === 0 && plan.amp.seconds === null && plan.amp.stopAt === null);
  check('reading the held curve far past its attack gives the sustain level', near(ampValueAt(plan.amp.moments, 60), S));
  h.release(12);
  check('release(at) holds the envelope there, re-sets the settled sustain at `at`, and falls linearly to 0 over the ADSR release, then stops',
    same(calls(ampEnv.gain).slice(-3), [['hold', 12], ['set', S, 12], ['lin', 0, 12.3]]) && same(nodes.osc[0].stopped, [12.31]));
  const n = ampEnv.gain._calls.length;
  h.release(13);
  check('a second release is a no-op', ampEnv.gain._calls.length === n && nodes.osc[0].stopped.length === 1);
  let done = 0; h.onComplete(() => done++); nodes.osc[0]._end();
  check('onComplete fires once the source ends', done === 1);
}
{
  const { h, ampEnv } = noteVoice('sine', { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2, peak: 1, duration: null }, { hold: false });
  h.release(11);
  check('without cancelAndHoldAtTime, a release seeds from the planned curve\'s value at `at`',
    same(calls(ampEnv.gain).slice(-3), [['cancel', 11], ['set', 0.5, 11], ['lin', 0, 11.2]]));
}
{
  const { h, nodes, ampEnv } = noteVoice('sine', { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2, peak: 1, duration: 0.5 });
  h.release(10.6);
  check('a release after a fixed-length note has ended changes nothing', calls(ampEnv.gain).length === 5 && same(nodes.osc[0].stopped, [10.5]));
}

{
  // The click at the Composer lab's loop point (2026-10-22): a real engine's cancelAndHoldAtTime inserts no hold when no
  // event lies past `at`, so a release booked on a settled (sustaining) note would ramp from the envelope's LAST event —
  // a jump partway down when booked late. The release must start from the sustain value AT `at`.
  const adsr = { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.08 };
  const { h, ampEnv } = noteVoice('triangle', { ...adsr, peak: 0.5, duration: null });
  h.release(18);
  check('a release long after the envelope settled starts from the sustain at its own time (no ramp from the decay\'s end)',
    same(calls(ampEnv.gain).slice(-3), [['hold', 18], ['set', 0.3, 18], ['lin', 0, 18.08]]));
}
{
  const { h, ampEnv } = noteVoice('triangle', { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.08, peak: 0.5, duration: null });
  h.release(10.05);
  check('…while a release mid-decay just holds the ramp there (an event lies past it), with nothing re-set',
    same(calls(ampEnv.gain).slice(-2), [['hold', 10.05], ['lin', 0, 10.13]]));
}
{
  const { h, ampEnv } = noteVoice('triangle', { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.08, peak: 0.5, duration: null });
  h.fadeOut(20, 0.03);
  check('a fadeOut on a settled held note (Stop) also starts from the sustain at its own time',
    same(calls(ampEnv.gain).slice(-3), [['hold', 20], ['set', 0.3, 20], ['lin', 0, 20.03]]));
}

console.log('\n  note role — a recipe amp overrides the caller\'s envelope');
{
  // sub: held { attack 0.012, release 0.06 }. The caller's ADSR (here deliberately odd) is ignored; peak and length are kept.
  const { plan, ampEnv, nodes } = noteVoice('sub', { attack: 1, decay: 1, sustain: 0.1, release: 1, peak: 0.4, duration: 1 });
  check('held: at its peak from its own attack to its own release, inside the note\'s length',
    plan.amp.kind === 'held' && same(plan.amp.moments.map(m => [m.at, m.value, m.ramp]), [[0, 0, 'set'], [0.012, 0.4, 'linear'], [0.94, 0.4, 'set'], [1, 0, 'linear']]) &&
    near(ampEnv.gain._calls[3][2], 11));
  check('held: two sines (body + octave), stopped just after the note', nodes.osc.length === 2 && near(nodes.osc[1].frequency.value, 880) && nodes.osc.every(o => near(o.stopped[0], 11.02)));
}
{
  const { h, plan, ampEnv, nodes } = noteVoice('sub', { peak: 0.4, duration: null });
  check('held, duration null: rises to its peak and stays', same(plan.amp.moments.map(m => [m.at, m.value]), [[0, 0], [0.012, 0.4]]) && nodes.osc.every(o => !o.stopped.length));
  h.release(11);
  check('…and release() with no time uses the recipe\'s own release (0.06)', same(calls(ampEnv.gain).slice(-1), [['lin', 0, 11.06]]));
}
{
  // marimba: struck, ring true. A ringing sound dies away by itself and ignores the note's end and release().
  const hz = 440;
  const { h, plan, ampEnv, nodes } = noteVoice('marimba', { peak: 0.5, duration: null }, { baseFreq: hz });
  const D = decaySeconds(getRecipe('marimba', 'note').amp, hz), natural = 0.002 + D;
  check('struck + ring: falls 80 dB over its pitch-tracked decay, then to silence',
    plan.amp.kind === 'struck' && plan.amp.ring && near(D, 0.9 * (220 / 440) ** 0.5) &&
    same(plan.amp.moments.map(m => m.ramp), ['set', 'linear', 'exp', 'linear']) && near(plan.amp.moments[2].value, 0.5 * ENV_FLOOR) && near(plan.amp.seconds, natural + 0.01));
  check('…and its sources stop by themselves when it is over (noise sooner, after its chiff)',
    nodes.osc.every(o => near(o.stopped[0], 10 + natural + 0.01 + 0.02)) && near(nodes.buffer[0].stopped[0], 10 + 0.001 + 0.012 + 0.01));
  const n = ampEnv.gain._calls.length;
  h.release(10.1);
  check('…and a release lets it ring (no new automation, no earlier stop)', ampEnv.gain._calls.length === n && nodes.osc.every(o => o.stopped.length === 1));
  const fixed = planVoice(getRecipe('marimba', 'note'), { role: 'note', baseFreq: hz, timing: { peak: 0.5, duration: 0.05 }, sampleRate: 48000 });
  check('…and a short note rings out just the same', same(fixed.amp.moments, plan.amp.moments));
}
{
  // vibes: struck, ring false. A short note is damped at its end; held, a release damps it.
  const hz = 220;
  const short = planVoice(getRecipe('vibes', 'note'), { role: 'note', baseFreq: hz, timing: { peak: 1, duration: 0.5 }, sampleRate: 48000 });
  check('struck + damped: a note shorter than its decay is damped at its end over the recipe\'s damp (0.12)',
    near(short.amp.moments[2].at, 0.5) && near(short.amp.moments[2].value, ENV_FLOOR ** ((0.5 - 0.003) / 4)) && near(short.amp.moments[3].at, 0.62) && near(short.amp.seconds, 0.62));
  const { h, ampEnv, nodes } = noteVoice('vibes', { peak: 1, duration: null }, { baseFreq: hz });
  h.release(11);
  check('…and held, a release damps it from where it is and stops the sources',
    same(calls(ampEnv.gain).slice(-2), [['hold', 11], ['lin', 0, 11.12]]) && nodes.osc.every(o => near(o.stopped.at(-1), 11.13)) &&
    nodes.buffer[0].stopped.length === 1);
}
{
  const bass = planVoice(getRecipe('pad', 'note'), { role: 'note', baseFreq: 110, timing: { duration: 1 }, sampleRate: 48000, low: true });
  const top = planVoice(getRecipe('pad', 'note'), { role: 'note', baseFreq: 110, timing: { duration: 1 }, sampleRate: 48000 });
  check('a chord\'s bass note plays the recipe\'s `low` components (pad: a sine under the triangle)', bass.components[0].wave === 'sine' && top.components[0].wave === 'triangle');
  const harp = planVoice(getRecipe('harp', 'note'), { role: 'note', baseFreq: 3520, timing: { duration: 1 }, sampleRate: 48000 });
  const warmRow = planVoice(getRecipe('warm', 'row'), { role: 'row', baseFreq: 3520, timing: {}, sampleRate: 48000 });
  // 0.45 × 48000 = 21600 Hz: harp's 7 harmonics at 3520 keep h1–h6 (6 × 3520 = 21120); Warm's 10 would keep the same 6.
  check('the note role cuts a harmonic table where it leaves the band; Cosmos\'s roles keep theirs whole',
    harp.components[0].harmonics.length === 6 && warmRow.components[0].harmonics.length === 10);
}

console.log('\n  setFrequency — every oscillator glides, ratios kept; key-tracked filters follow');
{
  const { h, nodes, plan } = noteVoice('marimba', { peak: 0.5, duration: null }, { baseFreq: 440 });
  h.setFrequency(330, 11, 0.05);
  const ratios = [1, 4, 9.2];
  check('a ramp is scheduled on EVERY oscillator (hold, re-set the settled pitch at the start, then an exponential glide to the new pitch × its ratio)',
    nodes.osc.length === 3 && nodes.osc.every((o, i) => same(calls(o.frequency).slice(-3), calls({ _calls: [['hold', 11], ['set', 440 * ratios[i], 11], ['exp', 330 * ratios[i], 11.05]] }))));
  check('the noise source is unpitched and untouched', nodes.buffer.length === 1 && !nodes.buffer[0].frequency);
  check('a fixed-cutoff filter stays put', calls(nodes.filter[0].frequency).length === 1 && plan.filters[0].freq === 5200);
}
{
  // Glides booked ahead (the Composer lab books a held voice's whole chain at once): each must start at its own
  // time from the pitch the last one settled on. A real engine inserts no hold when nothing is scheduled past
  // that time, so without the re-set the ramp would run from the previous event, across the whole gap.
  const { h, nodes } = noteVoice('sine', { peak: 0.5, duration: null }, { baseFreq: 440 });
  h.setFrequency(330, 11, 0.02);
  h.setFrequency(495, 12, 0.02);
  check('glides booked ahead each start at their own time, from the pitch the one before settled on',
    same(calls(nodes.osc[0].frequency).slice(-6), [['hold', 11], ['set', 440, 11], ['exp', 330, 11.02], ['hold', 12], ['set', 330, 12], ['exp', 495, 12.02]]));
  h.setFrequency(660, 12.01, 0.05);
  check('…a glide that starts while one is still moving holds where it is instead (no jump to the old target)',
    same(calls(nodes.osc[0].frequency).slice(-2), [['hold', 12.01], ['exp', 660, 12.06]]));
}
{
  const { h, nodes } = noteVoice('warm', { peak: 0.5, duration: null }, { baseFreq: 220 });
  const [hp, lp] = nodes.filter;
  h.setFrequency(330, 11, 0.1);
  check('Warm: its harmonic-table osc glides; its key-tracked low-pass follows (6 × 330 = 1980); its high-pass does not',
    same(calls(nodes.osc[0].frequency).slice(-1), [['exp', 330, 11.1]]) && same(calls(lp.frequency).slice(-1), [['exp', 1980, 11.1]]) && calls(hp.frequency).length === 1);
  h.setFrequency(2000, 12, 0.1);
  check('…a key-tracked cutoff stays inside its limits (5000 Hz)', same(calls(lp.frequency).slice(-1), [['exp', 5000, 12.1]]));
  h.setFrequency(440, 13, 0);
  check('…a zero glide is a step', same(calls(nodes.osc[0].frequency).slice(-1), [['set', 440, 13]]));
}
{
  const { h, nodes } = noteVoice('sine', { duration: null }, { baseFreq: 440, when: 20 });
  h.setFrequency(550, 10, 0.05);
  check('before the voice has started, the birth pitch is replaced (no glide)', same(calls(nodes.osc[0].frequency).slice(-1), [['set', 550, 20]]));
}
{
  const { h, nodes } = noteVoice('sine', { duration: null }, { hold: false });
  nodes.osc[0].frequency.value = 440;
  h.setFrequency(660, 11, 0.05);
  check('without cancelAndHoldAtTime, a glide seeds from the current value', same(calls(nodes.osc[0].frequency).slice(-3), [['cancel', 11], ['set', 440, 11], ['exp', 660, 11.05]]));
}
{
  // a Cosmos-role voice retunes too (its plan is byte-identical to before; the retune data sits beside it)
  const { ctx, nodes } = makeCtx();
  const plan = planVoice(getRecipe('glass', 'audition'), { role: 'audition', baseFreq: 220, timing: { peak: 0.3, attack: 0.01, decay: 0.2, sustain: 0.2 }, sampleRate: 48000 });
  const h = createInstrumentVoice({ ctx, destination: ctx.createGain(), plan, when: 10 });
  h.setFrequency(330, 11, 0.05);
  check('a Cosmos role (glass audition): body and bell both glide, bell ratio 6.32 kept',
    near(nodes.osc[0].frequency._calls.at(-1)[1], 330) && near(nodes.osc[1].frequency._calls.at(-1)[1], 330 * 6.32));
  // a hand-built plan has no retune data: components keep their ratios to the first
  const hand = { ...plan };
  const { ctx: c2, nodes: n2 } = makeCtx();
  createInstrumentVoice({ ctx: c2, destination: c2.createGain(), plan: hand, when: 10 }).setFrequency(110, 11, 0);
  check('a hand-built plan still retunes, ratios taken from its components', near(n2.osc[0].frequency._calls.at(-1)[1], 110) && near(n2.osc[1].frequency._calls.at(-1)[1], 110 * 6.32));
  h.setFrequency(-5, 12, 0); h.setFrequency(NaN, 12, 0);
  check('a bad pitch is ignored', nodes.osc[0].frequency._calls.at(-1)[2] === 11.05);
}

console.log('\n  registerInstrument — the catalog is a registry');
{
  const ids = [...CATALOG_IDS];
  const def = registerInstrument({ id: 'test-bell', label: 'Test Bell', roles: { note: { components: [{ wave: 'sine', ratio: 1, level: 1 }, { wave: 'sine', ratio: 3, level: 0.2 }], amp: { kind: 'struck', attack: 0.001, decay: 1, track: 0.3, ring: true, damp: 0.05 } } } });
  check('a note-only instrument registers, frozen, and is found by id', def.id === 'test-bell' && Object.isFrozen(def) && Object.isFrozen(def.roles.note.components[1]) && getInstrument('test-bell') === def);
  check('…the live views update: it is a note choice, not a Cosmos palette',
    NOTE_INSTRUMENT_IDS.includes('test-bell') && CATALOG_IDS.length === ids.length + 1 && !INSTRUMENT_IDS.includes('test-bell') && normalizeInstrumentId('test-bell') === 'classic');
  check('…and it plans and plays', planVoice(getRecipe('test-bell', 'note'), { role: 'note', baseFreq: 220, timing: { peak: 0.5, duration: 1 }, sampleRate: 48000 }).cost === 2);
  check('an id registers once: a duplicate, or any built-in (glass, classic, sine), throws',
    throws(() => registerInstrument({ id: 'test-bell', roles: { note: { components: [{ wave: 'sine' }] } } }), /already registered/) &&
    ['glass', 'classic', 'sine', 'marimba'].every(id => throws(() => registerInstrument({ id, roles: { note: { components: [{ wave: 'sine' }] } } }), /already registered/)));
  check('a malformed def throws a clear error (bad id, no roles, unknown role, no components, amp off the note role, bad amp kind, bad low)',
    throws(() => registerInstrument({ id: '', roles: {} }), /an id is/) && throws(() => registerInstrument({ id: 'x1' }), /roles object/) &&
    throws(() => registerInstrument({ id: 'x2', roles: {} }), /at least one role/) &&
    throws(() => registerInstrument({ id: 'x3', roles: { lead: { components: [{ wave: 'sine' }] } } }), /unknown role/) &&
    throws(() => registerInstrument({ id: 'x4', roles: { note: { components: [] } } }), /at least one component/) &&
    throws(() => registerInstrument({ id: 'x5', roles: { row: { components: [{ wave: 'sine' }], amp: { kind: 'held' } } } }), /only by the note role/) &&
    throws(() => registerInstrument({ id: 'x6', roles: { note: { components: [{ wave: 'sine' }], amp: { kind: 'plucked' } } } }), /held or struck/) &&
    throws(() => registerInstrument({ id: 'x7', roles: { row: { components: [{ wave: 'sine' }], low: [{ wave: 'sine' }] } } }), /note role only/) &&
    !CATALOG_IDS.some(id => /^x\d$/.test(id)));
  // A full-role instrument joins Cosmos's views (Phase 2's route onto the rail); dev:true keeps it out of production.
  const roles = Object.fromEntries(['row', 'bed', 'audition'].map(r => [r, { components: [{ wave: 'sine', ratio: 1, level: 1 }] }]));
  registerInstrument({ id: 'test-full', roles });
  registerInstrument({ id: 'test-dev', dev: true, roles });
  check('an instrument with every Cosmos role becomes a Cosmos palette (dev: true stays out of production)',
    INSTRUMENT_IDS.join(',') === 'glass,warm,classic,test-full,test-dev' && PRODUCTION_INSTRUMENT_IDS.join(',') === 'glass,warm,test-full' &&
    normalizeInstrumentId('test-full') === 'test-full' && INSTRUMENTS['test-dev'].label === 'test-dev');
  check('VOICE_ROLES are Cosmos\'s three plus note', VOICE_ROLES.join(',') === 'row,bed,audition,note');
}

console.log(PASS ? '\n✓✓✓ AUDIO VOICES PASSES' : '\n✗ AUDIO VOICES FAILED');
process.exit(PASS ? 0 : 1);
