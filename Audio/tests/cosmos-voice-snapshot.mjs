// cosmos-voice-snapshot.mjs — the Cosmos byte-identity reference for the shared voice library.
//
// buildSnapshot() records, as JSON strings, everything Cosmos gets from Audio/voices/: the catalog views
// (ids, labels, normalization, role recipes), getRecipe() for every Cosmos role, every planVoice() plan for
// classic/glass/warm (and an unknown id) × row/bed/audition × a spread of pitches, timings and sample rates, and
// — at 48 kHz — the full node graph and automation the renderer builds for each plan on a recording mock context,
// alone and followed by release / swell / crossIn / stop.
//
// digestSnapshot() folds that into a small fixture of SHA-256 hashes, grouped by instrument/role so a mismatch says
// where. The committed fixture (fixtures/cosmos-voice-snapshot.json) was taken from the ORIGINAL modules, before
// they moved out of Cosmos/audio/instruments/ (commit 96008cf), and assert-cosmos-identity.mjs checks against it.
//
//   node Audio/tests/cosmos-voice-snapshot.mjs <recipes.js> <plan.js> <voice.js> [full.json]
//     prints the digest (and writes the full snapshot, for diffing, when a path is given)
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const IDS = ['classic', 'glass', 'warm', 'bogus'];
const ROLES = ['row', 'bed', 'audition'];
const PITCHES = [55, 82.40688922821748, 110, 220, 261.6255653005986, 440, 659.2551138257398, 880, 1760, 2637.02, 3520, 7040, 1e5];
const RATES = [44100, 48000];
// The timings each role takes in Cosmos (row: the gap-aware pluck incl. a micro window; bed: the swell shape;
// audition: the held ADSR), plus an empty bag for each so the defaults are pinned too.
const TIMINGS = {
  row: [
    { peak: 0.16, attack: 0.004, decay: 0.46, hold: 0, release: 0.09, sustain: 0.05, duration: 0.23, micro: false },
    { peak: 0.12, attack: 0.002, decay: 0.1, hold: 0.05, release: 0.03, sustain: 0.02, duration: 0.4, micro: false },
    { peak: 0.1, attack: 0.001, decay: 0, hold: 0, release: 0.012, sustain: 0.0001, duration: 0.013, micro: true },
    {},
  ],
  bed: [{ attack: 1.5, release: 2.5, sustainFrac: 0.4 }, {}],
  audition: [{ peak: 0.32, attack: 0.006, decay: 0.2, sustain: 0.224 }, { peak: 0.2, attack: 0.02, decay: 0.3, sustain: 0.1 }, {}],
};

// A mock AudioContext that logs, in order, every node made, connection, type, buffer and scheduled value.
function recordingCtx(sampleRate) {
  const log = [];
  const nodes = [];
  const idOf = n => (n && n.__id != null ? n.__id : (n && n.__name) || '?');
  const param = (owner, name, value) => {
    const p = { value, __name: `${owner}.${name}` };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) {
      p[m] = (...a) => { log.push([p.__name, m, ...a]); if (m !== 'cancelScheduledValues' && m !== 'cancelAndHoldAtTime') p.value = a[0]; return p; };
    }
    return p;
  };
  const node = (kind, extra = {}) => {
    const n = { __id: `${kind}#${nodes.length}`, kind };
    nodes.push(n);
    n.connect = t => { log.push([n.__id, 'connect', idOf(t)]); return t; };
    n.disconnect = t => { log.push([n.__id, 'disconnect', t ? idOf(t) : null]); };
    Object.assign(n, extra(n));
    return n;
  };
  const source = n => ({
    start: t => log.push([n.__id, 'start', t]),
    stop: t => log.push([n.__id, 'stop', t]),
  });
  const ctx = {
    sampleRate, currentTime: 10,
    createGain: () => node('gain', n => ({ gain: param(n.__id, 'gain', 1) })),
    createBiquadFilter: () => node('biquad', n => {
      let type = 'lowpass';
      return {
        frequency: param(n.__id, 'frequency', 350), Q: param(n.__id, 'Q', 1), detune: param(n.__id, 'detune', 0),
        get type() { return type; }, set type(v) { type = v; log.push([n.__id, 'type', v]); },
      };
    }),
    createOscillator: () => node('osc', n => {
      let type = 'sine';
      return {
        frequency: param(n.__id, 'frequency', 440), detune: param(n.__id, 'detune', 0), ...source(n),
        get type() { return type; }, set type(v) { type = v; log.push([n.__id, 'type', v]); },
        setPeriodicWave: w => log.push([n.__id, 'setPeriodicWave', w.__key]),
      };
    }),
    createBufferSource: () => node('noise', n => ({ ...source(n), set buffer(b) { log.push([n.__id, 'buffer', b.__len]); }, get buffer() { return null; } })),
    createBuffer: (ch, len) => ({ __len: len, getChannelData: () => new Float32Array(len) }),
    createPeriodicWave: (real, imag) => { const w = { __key: `pw:${[...real].join(',')}|${[...imag].join(',')}` }; log.push(['ctx', 'createPeriodicWave', w.__key]); return w; },
  };
  const destination = { __name: 'dest' };
  const bus = { __name: 'bus', connect: t => log.push(['bus', 'connect', t.__name]), disconnect: t => log.push(['bus', 'disconnect', t && t.__name]) };
  return { ctx, destination, bus, log };
}

// presets: the catalog module (recipes.js, or the original instrument-presets.js); planVoice; createInstrumentVoice.
export function buildSnapshot(presets, planVoice, createInstrumentVoice) {
  const out = { recipes: {}, plans: [], graphs: [], catalog: {} };
  out.catalog = {
    INSTRUMENT_IDS: [...presets.INSTRUMENT_IDS],
    PRODUCTION_INSTRUMENT_IDS: [...presets.PRODUCTION_INSTRUMENT_IDS],
    DEV_INSTRUMENT_IDS: [...presets.DEV_INSTRUMENT_IDS],
    INSTRUMENT_ROLES: [...presets.INSTRUMENT_ROLES],
    DEFAULT_INSTRUMENT: presets.DEFAULT_INSTRUMENT,
    INSTRUMENTS_keys: Object.keys(presets.INSTRUMENTS),
    INSTRUMENTS_labels: Object.fromEntries(Object.entries(presets.INSTRUMENTS).map(([k, v]) => [k, v.label])),
    INSTRUMENTS_rows: Object.fromEntries(Object.entries(presets.INSTRUMENTS).map(([k, v]) => [k, ROLES.map(r => JSON.stringify(v.roles[r]))])),
    normalize: Object.fromEntries(['classic', 'glass', 'warm', 'bogus', 'warm-v1', 'marimba', 'sine', 'note', '', 'constructor', 'toString'].map(id => [id, presets.normalizeInstrumentId(id)])),
    normalizeNonString: [undefined, null, 42, {}].map(v => presets.normalizeInstrumentId(v)),
    labels: Object.fromEntries(['classic', 'glass', 'warm', 'bogus', 'marimba'].map(id => [id, presets.instrumentLabel(id)])),
  };
  for (const id of [...IDS, 'marimba', 'sine', 'constructor']) for (const role of ROLES) out.recipes[`${id}/${role}`] = JSON.stringify(presets.getRecipe(id, role));

  for (const id of IDS) for (const role of ROLES) for (const timing of TIMINGS[role]) for (const baseFreq of PITCHES) for (const sampleRate of RATES) {
    const plan = planVoice(presets.getRecipe(id, role), { role, baseFreq, timing, sampleRate });
    const key = `${id}/${role}/${JSON.stringify(timing)}/${baseFreq}/${sampleRate}`;
    out.plans.push([key, JSON.stringify(plan)]);
    if (sampleRate !== 48000) continue;
    for (const after of ['none', 'release', 'swell', 'crossIn', 'stop']) {
      const { ctx, destination, bus, log } = recordingCtx(sampleRate);
      const h = createInstrumentVoice({ ctx, destination, plan, when: 10, detuneBus: bus });
      if (after === 'release') h.release(10.1, role === 'row' ? 0.09 : 0.05);
      if (after === 'swell') { h.swell(0.3, 10.05); h.swell(0.2, 11); }
      if (after === 'crossIn') h.crossIn(0.25, 10.02, 0.3);
      if (after === 'stop') h.stop(10.5);
      out.graphs.push([`${key}/${after}`, JSON.stringify({ cost: h.cost, role: h.role, log })]);
    }
  }
  return out;
}

const sha = text => createHash('sha256').update(text).digest('hex');

// { whole, catalog, recipes, plans: { 'glass/row': hash, … }, graphs: { … }, counts }
export function digestSnapshot(snapshot) {
  const group = entries => {
    const by = {};
    for (const [key, json] of entries) { const g = key.split('/').slice(0, 2).join('/'); (by[g] ||= []).push(`${key}\n${json}`); }
    return Object.fromEntries(Object.entries(by).map(([g, list]) => [g, sha(list.join('\n'))]));
  };
  return {
    whole: sha(JSON.stringify(snapshot)),
    catalog: sha(JSON.stringify(snapshot.catalog)),
    recipes: sha(JSON.stringify(snapshot.recipes)),
    plans: group(snapshot.plans),
    graphs: group(snapshot.graphs),
    counts: { plans: snapshot.plans.length, graphs: snapshot.graphs.length, recipes: Object.keys(snapshot.recipes).length },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [recipesPath, planPath, voicePath, fullOut] = process.argv.slice(2);
  if (!voicePath) { console.error('usage: cosmos-voice-snapshot.mjs <recipes.js> <plan.js> <voice.js> [full.json]'); process.exit(2); }
  const imp = p => import(pathToFileURL(path.resolve(p)).href);
  const snapshot = buildSnapshot(await imp(recipesPath), (await imp(planPath)).planVoice, (await imp(voicePath)).createInstrumentVoice);
  if (fullOut) writeFileSync(fullOut, JSON.stringify(snapshot));
  console.log(JSON.stringify(digestSnapshot(snapshot), null, 2));
}
