// assert-lab.mjs — the Composer lab (Composer/lab/), in Node: its DOM-free controller and player against a recording
// mock AudioContext (Node has no Web Audio; every node, param call, connection and start/stop is recorded).
//   • the controller: the default rhythm (41:42:43), Compose → Perform ⇄ Stop, a change back to Compose, refusals
//   • one full cycle scheduled: every enabled part's notes start at their spec times, on that part's bus, at their hz;
//     a note without `retrigger` glides its part's held voice with setFrequency
//   • the toggles re-articulate from the spec by the decided legato rule (as Compose itself would); a part switched
//     off is not played; levels ride the part buses; stop silences everything and books nothing more
//   • the page imports only relative paths, and makes its worker with new URL(…, import.meta.url)
//   node Composer/tests/assert-lab.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLabController, PRESETS, soundChoices, readLayers } from '../lab/lab-controller.js';
import { chainsOf } from '../lab/lab-player.js';
import { compose, rearticulate, PART_IDS } from '../core/compose.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), LAB = path.resolve(HERE, '..', 'lab');
let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── the recording mock ──
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
    createDynamicsCompressor: () => node('compressor', { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }),
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440), detune: param(0), started: null, stopped: [], setPeriodicWave() { this.type = 'custom'; }, start(t) { this.started = t; }, stop(t) { this.stopped.push(t); } }),
    createBufferSource: () => node('noise', { buffer: null, started: null, stopped: [], start(t) { this.started = t; }, stop(t) { this.stopped.push(t); } }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createPeriodicWave: () => ({}),
  };
  ctx.destination = node('destination');
  return ctx;
}
/** the part bus an oscillator plays into, by following its connections */
function busOf(osc, buses) {
  const seen = new Set(), stack = [osc];
  while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); for (const [id, b] of Object.entries(buses)) if (n === b) return id; stack.push(...n.outs); }
  return null;
}

console.log('Composer lab');
const ctx = makeCtx(), timers = { setInterval: () => 1, clearInterval: () => {} };
const lab = createLabController({ createContext: () => ctx, timers });

console.log('\n— the controller');
check('the default rhythm is 41:42:43 in 8 s; the button says Compose', lab.state.input.layers.join() === '41,42,43,0' && lab.state.input.cycleSeconds === 8 && lab.button() === 'Compose');
check('presets span the sizes: 8:7:6:5, 768:769 and the 16k row among 4–6', PRESETS.length >= 4 && PRESETS.length <= 6 && ['8,7,6,5', '768,769,0,0', '4099,4093,4091,4079'].every((k) => PRESETS.some((p) => p.layers.join() === k)));
check('every note sound of Audio/voices is offered', soundChoices().length >= 14 && soundChoices().some((s) => s.id === 'flute') && soundChoices().some((s) => s.id === 'sine'));
check('layers as typed: blanks and zeros are absent', readLayers(['41', '', '0', 'x']).join() === '41,0,0,0');
await lab.press();
const spec = lab.state.spec;
check(`Compose (the full table, as in the worker): ${spec.chords.map((c) => c.name).join(' ')} at ${spec.knobs.tempoBpm} BPM; the button says Perform`, !spec.refused && spec.knobs.table === 'full' && lab.button() === 'Perform' && lab.state.status === 'ready');
check('the same spec as Compose itself', JSON.stringify(spec) === JSON.stringify(compose([41, 42, 43, 0], 8, { seed: 1, worker: true })));

console.log('\n— one full cycle, scheduled');
lab.perform();
const player = lab.player, T = spec.knobs.cycleSeconds;
check('Perform makes the context and plays; the button says Stop', lab.context === ctx && player.playing && lab.button() === 'Stop');
const limiter = ctx.nodes.find((n) => n.kind === 'compressor'), master = player.master;
check('the graph: a bus per part → master → limiter → destination', PART_IDS.every((id) => player.buses[id] && player.buses[id].outs.includes(master)) && master.outs.includes(limiter) && limiter.outs.includes(ctx.destination));
while (ctx.currentTime < player.loopStart + T + 0.3) { ctx.currentTime += 0.025; player.tick(); }
const oscs = ctx.nodes.filter((n) => n.kind === 'osc');
const L0 = player.loopStart;
let missing = '', glides = 0, glideMiss = '', starts = 0;
for (const part of lab.currentParts()) {
  if (!part.enabled) continue;
  for (const chain of chainsOf(part)) {
    const first = chain.notes[0], when = L0 + first.time;
    const hit = oscs.find((o) => near(o.started, when, 1e-9) && busOf(o, player.buses) === part.id && o.frequency.calls.some((c) => c[0] === 'setValueAtTime' && near(c[1], Math.min(first.hz, 48000 * 0.45), 1e-6)));
    if (!hit) { missing = `${part.id}: a note at ${first.time.toFixed(3)} s (${first.hz.toFixed(2)} Hz)`; break; }
    starts++;
    for (const n of chain.notes.slice(1)) {
      glides++;
      const at = L0 + n.time;
      if (!hit.frequency.calls.some((c) => c[0] === 'exponentialRampToValueAtTime' && near(c[1], n.hz, 1e-6) && c[2] > at - 1e-9 && c[2] < at + 0.05)) glideMiss = `${part.id}: no glide to ${n.hz.toFixed(2)} at ${n.time.toFixed(3)}`;
    }
  }
  if (missing) break;
}
const expected = lab.currentParts().filter((p) => p.enabled).reduce((n, p) => n + p.notes.filter((x) => x.retrigger).length, 0);
check(`every enabled part's notes start at their spec times, on their part's bus, at their hz (${starts} voices for ${expected} retriggering notes)`, !missing && starts === expected, missing);
check(`a note without retrigger glides its part's held voice with setFrequency (${glides} glides)`, !glideMiss && glides === lab.currentParts().reduce((n, p) => n + p.notes.filter((x) => !x.retrigger).length, 0) && glides > 0, glideMiss || `${glides}`);
// The glide starts AT the note, not at the voice's last event: each ramp is anchored by a setValueAtTime of the
// previous pitch at the note's time, and ends glideMs later. (Without the anchor a ramp booked ahead slides across
// the whole gap between two notes; that was the long portamento Avery heard.)
const anchorMiss = (glideSec) => {
  for (const part of lab.currentParts()) {
    if (!part.enabled) continue;
    for (const chain of chainsOf(part)) {
      const first = chain.notes[0], hit = oscs.find((o) => near(o.started, L0 + first.time, 1e-9) && busOf(o, player.buses) === part.id);
      if (!hit) continue;
      let prev = first.hz;
      for (const n of chain.notes.slice(1)) {
        const at = L0 + n.time, calls = hit.frequency.calls;
        const r = calls.findIndex((c) => c[0] === 'exponentialRampToValueAtTime' && near(c[1], n.hz, 1e-6) && near(c[2], at + glideSec, 1e-9));
        if (r < 0) return `${part.id}: no ${Math.round(glideSec * 1000)} ms ramp to ${n.hz.toFixed(2)} at ${n.time.toFixed(3)}`;
        if (!calls.slice(0, r).some((c) => c[0] === 'setValueAtTime' && near(c[1], prev, 1e-6) && near(c[2], at, 1e-9))) return `${part.id}: the glide to ${n.hz.toFixed(2)} is not anchored at ${n.time.toFixed(3)}`;
        prev = n.hz;
      }
    }
  }
  return '';
};
const miss12 = anchorMiss(0.012);
check('every glide is anchored at its note and lasts the Glide setting (12 ms by default)', lab.state.glideMs === 12 && !miss12, miss12);
const chordsChains = chainsOf(lab.state.parts.chords);
check('in the chords part a chain is one voice\'s', chordsChains.every((c) => c.notes.every((n) => n.voice === c.voice)));
check('the second cycle starts booking after the first (loop)', oscs.some((o) => o.started >= L0 + T - 1e-9));

console.log('\n— the Glide control (portamento)');
{
  const gctx = makeCtx(), glab = createLabController({ createContext: () => gctx, timers });
  await glab.press();
  glab.setGlide(200);
  glab.perform();
  const gplayer = glab.player, G0 = gplayer.loopStart, T2 = glab.state.spec.knobs.cycleSeconds;
  for (let t = 0; t <= T2; t += 0.025) { gctx.currentTime = G0 + t; gplayer.tick(); }
  const goscs = gctx.nodes.filter((n) => n.kind === 'osc');
  let longMiss = '', checked = 0;
  for (const part of glab.currentParts()) {
    if (!part.enabled) continue;
    for (const chain of chainsOf(part)) {
      const hit = goscs.find((o) => near(o.started, G0 + chain.notes[0].time, 1e-9) && busOf(o, gplayer.buses) === part.id);
      for (const n of chain.notes.slice(1)) {
        checked++;
        if (!hit?.frequency.calls.some((c) => c[0] === 'exponentialRampToValueAtTime' && near(c[1], n.hz, 1e-6) && near(c[2], G0 + n.time + 0.2, 1e-9))) longMiss = `${part.id}: no 200 ms glide to ${n.hz.toFixed(2)}`;
      }
    }
  }
  check(`Glide set to 200 ms before Perform: every glide lasts 200 ms (${checked})`, glab.state.glideMs === 200 && gplayer.glide === 0.2 && checked > 0 && !longMiss, longMiss);
  glab.setGlide(0);
  check('Glide 0 reaches the playing player at once (notes booked from now on step)', gplayer.glide === 0);
  glab.stop();
}

console.log('\n— stop, levels, toggles');
const before = oscs.length, now = ctx.currentTime;
lab.stop();
const silenced = ctx.nodes.filter((n) => n.kind === 'osc' && n.started != null).every((o) => o.stopped.some((t) => t <= now + 0.06));
check('Stop silences everything at once: every voice stopped within 60 ms; the button says Perform', silenced && !player.playing && lab.button() === 'Perform');
for (let i = 0; i < 20; i++) { ctx.currentTime += 0.025; player.tick(); }
check('…and nothing more is booked', ctx.nodes.filter((n) => n.kind === 'osc').length === before);
lab.setLevel('bass', 0.3);
check('a level rides its part\'s bus', player.buses.bass.gain.calls.some((c) => c[0] === 'setTargetAtTime' && c[1] === 0.3));
const lead = lab.state.parts.lead, flipped = !lead.legato;
lab.setPart('lead', { legato: flipped });
const viaCompose = compose([41, 42, 43, 0], 8, { seed: 1, worker: true, overrides: { legato: { lead: flipped }, sounds: { lead: lead.sound } } }).parts[0];
check('the legato toggle re-articulates from the spec, as Compose would with that legato', JSON.stringify(lab.state.parts.lead.notes) === JSON.stringify(viaCompose.notes) && lab.state.parts.lead.legato === flipped);
lab.setPart('lead', { sound: 'marimba', legato: true });
check('a struck sound in legato: every note retriggers, each held to the next', lab.state.parts.lead.struck && lab.state.parts.lead.notes.every((n) => n.retrigger));
lab.setPart('lead', { sound: 'flute' });
check('a held sound in legato: only the first note retriggers', !lab.state.parts.lead.struck && lab.state.parts.lead.notes.filter((n) => n.retrigger).length === 1);
check('the spec\'s own durations are untouched (nothing re-mined)', JSON.stringify(spec.parts[0]) === JSON.stringify(compose([41, 42, 43, 0], 8, { seed: 1, worker: true }).parts[0]));
lab.setPart('comp', { enabled: false });
const mark = ctx.nodes.length;
lab.perform();
while (ctx.currentTime < player.loopStart + T + 0.2) { ctx.currentTime += 0.025; player.tick(); }
const fresh = ctx.nodes.slice(mark).filter((n) => n.kind === 'osc' && n.started != null);
check('a part switched off is not played; the others are', fresh.length > 0 && !fresh.some((o) => busOf(o, player.buses) === 'comp') && fresh.some((o) => busOf(o, player.buses) === 'lead'));
lab.stop();
const exported = JSON.parse(lab.exportJSON());
check('JSON export is the spec with the parts as they play now', exported.version === spec.version && exported.parts.find((p) => p.id === 'comp').enabled === false && exported.parts.find((p) => p.id === 'lead').sound === 'flute');
check('rearticulate needs the cycle', (() => { try { rearticulate(spec.parts[0], {}); return false; } catch { return true; } })());

console.log('\n— back to Compose');
lab.setKnob('bars', 2);
check('a knob change: back to Compose, the knob an override', lab.button() === 'Compose' && JSON.stringify(lab.overrides()) === '{"bars":2}');
await lab.press();
check('…and Compose honours it', lab.state.spec.knobs.bars === 2 && lab.button() === 'Perform');
lab.setTable('lean');
await lab.compose();
check(`the lean table runs where Compose defaults to it (${lab.state.lastMs.toFixed(0)} ms); quick enough to re-compose on a knob change`, lab.state.spec.knobs.table === 'lean' && lab.canAutoRecompose() === (lab.state.lastMs < 300));
lab.setLayers([3, 2, '', '']);
await lab.press();
check('a refusal is shown, and the button stays Compose', lab.state.status === 'refused' && lab.state.spec.reason === 'tooFewTones' && lab.button() === 'Compose');
lab.setLayers([1048576, 3]);
await lab.press();
check('tooDense too', lab.state.spec.reason === 'tooDense');

console.log('\n— serving');
const page = fs.readFileSync(path.join(LAB, 'composer-lab.html'), 'utf8'), view = fs.readFileSync(path.join(LAB, 'composer-lab.js'), 'utf8');
const imports = [...[page, view, fs.readFileSync(path.join(LAB, 'lab-controller.js'), 'utf8'), fs.readFileSync(path.join(LAB, 'lab-player.js'), 'utf8')].join('\n').matchAll(/(?:from\s+|src=)['"]([^'"]+)['"]/g)].map((m) => m[1]);
check(`only relative imports (${imports.length})`, imports.length >= 6 && imports.every((x) => x.startsWith('./') || x.startsWith('../')), imports.join(' '));
check('the worker is made with new URL(…, import.meta.url), as a module', /new Worker\(new URL\('\.\.\/core\/compose-worker\.js', import\.meta\.url\), \{ type: 'module' \}\)/.test(view));
check('not linked from index.html', !fs.readFileSync(path.resolve(HERE, '..', '..', 'index.html'), 'utf8').includes('composer-lab'));

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
