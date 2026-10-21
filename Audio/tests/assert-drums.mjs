// assert-drums.mjs — the shared drum library (Audio/drums/) and Partitions playing through it, against a recording
// MOCK AudioContext (Node has no Web Audio; same idea as assert-voices.mjs, with every node, param call, connection
// and start/stop recorded in creation order so whole graphs can be compared):
//   • DEFAULT IDENTITY: the real Playback/Partitions/PartitionsPlayback.js, run in a VM, builds the same graph through
//     Audio/drums/ as the pre-library triggerSample did (embedded below verbatim from e465ec3, and checked against git
//     when git is here) — same nodes, gains, playbackRate, envelope, routing, MIDI calls, fetches, stops — over a
//     matrix of samples, layers, transposes, ADSRs, timings and routings, and as the legacy path before the module loads
//   • the loader: any URL (blob: too), injected fetch/decode, cache per URL per context, in-flight sharing, failure retry
//   • the sample player's cut-short (`until`), with and without an envelope
//   • the made kit: transpose as a pitch multiplier, peak scaling, cut-short, handles, Partitions' routing and balance
//   • CHUNK-TUNES PARITY: the made sounds and the cut sample against chunk-tunes' own page code (strike/noiseOf and
//     arrVoices, lifted read-only out of chunk-tunes.html), skipped when that checkout is not on this machine
//   node Audio/tests/assert-drums.mjs [--chunk=<dir holding chunk-tunes.html>]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as drums from '../drums/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PARTITIONS_FILE = path.join(ROOT, 'Playback', 'Partitions', 'PartitionsPlayback.js');

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstDiff = (a, b) => {
  const A = JSON.stringify(a, null, 1).split('\n'), B = JSON.stringify(b, null, 1).split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return `line ${i}: ${A[i]?.trim()} ≠ ${B[i]?.trim()}`;
  return '';
};

// ── the recording mock ─────────────────────────────────────────────────────────────────────────────────────────────
// Every node gets an id in creation order; params keep their call list; `.value` writes are kept as the final value.
function makeCtx({ currentTime = 10, sampleRate = 48000, durations = {}, failing = new Set() } = {}) {
  const nodes = [];
  const decodes = [];
  const param = (initial) => {
    const calls = [];
    return {
      value: initial, calls,
      setValueAtTime(v, t) { calls.push(['set', v, t]); return this; },
      linearRampToValueAtTime(v, t) { calls.push(['lin', v, t]); return this; },
      exponentialRampToValueAtTime(v, t) { calls.push(['exp', v, t]); return this; },
      setTargetAtTime(v, t, tc) { calls.push(['target', v, t, tc]); return this; },
      cancelScheduledValues(t) { calls.push(['cancel', t]); return this; },
    };
  };
  const node = (kind, extra) => {
    const n = { id: nodes.length, kind, connections: [], connect(t) { this.connections.push(t); return t; }, disconnect() {}, ...extra };
    nodes.push(n);
    return n;
  };
  const source = (kind, extra) => node(kind, {
    starts: [], stops: [], onended: null,
    start(t) { this.starts.push(t); }, stop(...a) { this.stops.push(a.length ? a[0] : 'now'); },
    _end() { this.onended?.(); }, ...extra,
  });
  const ctx = {
    currentTime, sampleRate, nodes, decodes,
    destination: null,
    createGain() { return node('gain', { gain: param(1) }); },
    createBiquadFilter() { return node('filter', { type: 'lowpass', frequency: param(350), Q: param(1) }); },
    createOscillator() { return source('osc', { type: 'sine', frequency: param(440), detune: param(0) }); },
    createBufferSource() { return source('buffersrc', { buffer: null, playbackRate: param(1) }); },
    createBuffer(ch, len, rate) { return { tag: `noise:${len}@${rate}`, length: len, duration: len / rate, getChannelData() { return new Float32Array(len); } }; },
    async decodeAudioData(data) {
      decodes.push(data.url);
      if (failing.has(data.url)) throw new Error(`cannot decode ${data.url}`);
      return { tag: `buf:${data.url}`, duration: durations[data.url] ?? 1 };
    },
  };
  ctx.destination = node('destination', {});
  return ctx;
}
// A graph as plain data: nodes in creation order with their params, connections (by id), starts and stops.
function graphOf(ctx, from = 0) {
  const ref = (t) => (t && typeof t.id === 'number' ? t.id : String(t));
  return ctx.nodes.slice(from).map((n) => {
    const out = { id: n.id, kind: n.kind, to: n.connections.map(ref) };
    for (const [k, v] of Object.entries(n)) {
      if (v && typeof v === 'object' && Array.isArray(v.calls)) out[k] = { value: v.value, calls: v.calls };
    }
    if ('type' in n && n.kind !== 'gain') out.type = n.type;
    if (n.buffer !== undefined) out.buffer = n.buffer?.tag ?? null;
    if (n.starts) { out.starts = n.starts; out.stops = n.stops; }
    return out;
  });
}

// ── the pre-library triggerSample + loadSample (PartitionsPlayback.js at e465ec3, lines 529-593), verbatim ─────────
const LEGACY_SOURCE = `    async triggerSample(url, layerIndex, volumeDb, time, durationSec) {
        window.lrcMidiOut?.schedulePartitionHit(layerIndex, time, volumeDb, this.layerTranspose[layerIndex], durationSec);
        if (!url || !this.audioContext) return;
        const now = this.audioContext.currentTime;
        if (time < now - 0.005) {
            return;
        }
        const scheduleTime = Math.max(time, now + 0.001);
        const buffer = await this.loadSample(url);
        if (!buffer) return;

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        this.activeSources.add(source);
        source.onended = () => {
            this.activeSources.delete(source);
        };
        const gainNode = this.layerGains[layerIndex] || this.outputGain;
        const filterChain = this.layerFilters[layerIndex];
        const envelope = this.audioContext.createGain();
        envelope.gain.setValueAtTime(0, scheduleTime);
        const transpose = this.layerTranspose[layerIndex] ?? 0;
        const playbackRate = Math.pow(2, transpose / 12);
        const adsr = this.layerADSR[layerIndex] || this.layerADSR[0];
        const attack = Math.max(0.001, adsr.attack || 0.001);
        const decay = Math.max(0.001, adsr.decay || 0.2);
        const sustain = Math.min(1, Math.max(0, adsr.sustain ?? 0.7));
        const release = Math.max(0.001, adsr.release || 0.3);
        const duration = buffer.duration || 0;
        const sustainTime = Math.max(0, duration - attack - decay - release);

        envelope.gain.setValueAtTime(0, scheduleTime);
        envelope.gain.linearRampToValueAtTime(1, scheduleTime + attack);
        envelope.gain.linearRampToValueAtTime(sustain, scheduleTime + attack + decay);
        envelope.gain.setValueAtTime(sustain, scheduleTime + attack + decay + sustainTime);
        envelope.gain.linearRampToValueAtTime(0, scheduleTime + attack + decay + sustainTime + release);

        source.playbackRate.setValueAtTime(playbackRate, scheduleTime);

        source.connect(envelope);
        if (filterChain && gainNode) {
            envelope.connect(filterChain.highpass);
        } else if (gainNode) {
            envelope.connect(gainNode);
        } else {
            envelope.connect(this.audioContext.destination);
        }

        source.start(scheduleTime);
        source.stop(scheduleTime + Math.max(0.01, attack + decay + sustainTime + release + 0.01));
    }

    async loadSample(url) {
        if (this.sampleCache.has(url)) return this.sampleCache.get(url);
        try {
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.arrayBuffer();
            const buffer = await this.audioContext.decodeAudioData(data);
            this.sampleCache.set(url, buffer);
            return buffer;
        } catch (error) {
            console.warn('[PartitionsPlayback] Failed to load sample', url, error);
            return null;
        }
    }
`;

console.log('═══ AUDIO DRUMS — shared drum library, Partitions through it, chunk-tunes parity ═══');

console.log('\n  The legacy reference is the pre-library code');
{
  let original = null;
  try { original = execFileSync('git', ['-C', ROOT, 'show', 'e465ec3:Playback/Partitions/PartitionsPlayback.js'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* no git or no history */ }
  if (original === null) console.log('  – git or commit e465ec3 not here: the embedded reference is taken as given');
  else check('the embedded triggerSample + loadSample are verbatim PartitionsPlayback.js at e465ec3', original.includes(LEGACY_SOURCE));
}

// ── PartitionsPlayback.js in a VM: a fake page (window, document, MIDI, toneRowPlayback, fetch) per context ──────
const PARTITIONS_CODE = fs.readFileSync(PARTITIONS_FILE, 'utf8');
const PARTITIONS_SCRIPT = new vm.Script(PARTITIONS_CODE, {
  filename: PARTITIONS_FILE,
  importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
});
const legacyMethods = new vm.Script(`(() => { const C = class {\n${LEGACY_SOURCE}}; return { triggerSample: C.prototype.triggerSample, loadSample: C.prototype.loadSample }; })()`);

function page(ctxOptions = {}, { withSliders = [] } = {}) {
  const ctx = makeCtx(ctxOptions);
  const midi = [], fetches = [], warnings = [];
  const listeners = {};
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent() {},
    lrcMidiOut: { schedulePartitionHit: (...a) => midi.push(a) },
    toneRowPlayback: { audioContext: null, masterGain: null, async initAudioContext() { this.audioContext = ctx; this.masterGain ||= ctx.createGain(); } },
  };
  const document = {
    currentScript: { src: `${pathToFileURL(PARTITIONS_FILE).href}?v=test` },
    baseURI: pathToFileURL(ROOT + path.sep).href,
    querySelectorAll: (sel) => (sel === '.partition-volume-slider' ? withSliders.map(v => ({ value: String(v) })) : []),
  };
  const sandbox = {
    window, document, URL, Math, Number, Promise, Map, Set, JSON, Array, Object, setTimeout, clearTimeout,
    console: { log() {}, warn: (...a) => warnings.push(a.slice(0, 2)) },
    fetch: async (url, opts) => { fetches.push([url, opts]); return { arrayBuffer: async () => ({ url }) }; },
  };
  vm.createContext(sandbox);
  // In a browser the module and the classic script share one global; here the module runs in Node's main context,
  // so its globalThis.fetch is pointed at this page's (runs are sequential for that reason).
  globalThis.fetch = sandbox.fetch;
  PARTITIONS_SCRIPT.runInContext(sandbox);
  const inst = window.partitionsPlayback;
  return { ctx, inst, midi, fetches, warnings, sandbox, window };
}

const DURATIONS = {
  'assets/audio/kick1.wav': 0.674, 'assets/audio/cym2.wav': 8.0, 'assets/audio/hat2.wav': 0.216,
  'short.wav': 0.05, 'blob:http://localhost/user-sample-1': 1.25,
};
const FAILING = new Set(['missing.wav']);

// mode: 'reference' (embedded pre-library code), 'legacy' (today's file before Audio/drums/ loads), 'module' (through it)
async function partitionsRun(mode, { setup, strokes, after }) {
  const p = page({ durations: DURATIONS, failing: FAILING }, { withSliders: [-18, -6, -30, 0] });
  const loaded = await p.inst.drumsReady;
  if (mode === 'module') {
    if (!loaded) throw new Error('Audio/drums/ did not load into PartitionsPlayback');
  } else {
    p.inst.drums = null;
    p.inst.drumsReady = Promise.resolve(null);
    if (mode === 'reference') Object.assign(p.inst, legacyMethods.runInContext(p.sandbox));
  }
  await p.inst.initAudioContext();
  setup?.(p.inst, p.ctx);
  for (const s of strokes) {
    if (typeof s === 'function') { await s(p.inst, p.ctx); continue; }
    await p.inst.triggerSample(s.url, s.layer, s.db ?? -18, p.ctx.currentTime + s.dt, s.dur ?? 0.5);
  }
  after?.(p.inst, p.ctx);
  return { graph: graphOf(p.ctx), midi: p.midi, fetches: p.fetches, decodes: p.ctx.decodes, warnings: p.warnings, active: p.inst.activeSources.size, p };
}
const comparable = (r) => ({ graph: r.graph, midi: r.midi, fetches: r.fetches, decodes: r.decodes, warnings: r.warnings, active: r.active });

console.log('\n  Partitions default identity — the graph through Audio/drums/ is the pre-library graph');
{
  const p = page();
  const mod = await p.inst.drumsReady;
  check('PartitionsPlayback resolves Audio/drums/index.js from its own script URL and loads it with import()',
    !!mod && typeof mod.playSample === 'function' && p.inst.drums === mod && typeof mod.MADE_DRUMS === 'object');
}
{
  const URLS = ['assets/audio/kick1.wav', 'assets/audio/cym2.wav', 'short.wav', 'blob:http://localhost/user-sample-1', 'missing.wav', ''];
  const TRANSPOSES = [0, 7, -12, 2.5];
  const ADSRS = [
    null,
    { attack: 0, decay: 0, sustain: 0, release: 0 },
    { attack: 0.05, decay: 0.5, sustain: 0.2, release: 1 },
    { attack: 0.3, decay: 0.3, sustain: undefined, release: 0.6 },
  ];
  const TIMES = [0.1, -0.01, -0.003, 0];
  const ROUTES = ['filters', 'gain only', 'bus only', 'destination'];
  const route = (inst, r) => {
    if (r === 'gain only' || r === 'bus only' || r === 'destination') inst.layerFilters = [null, null, null, null];
    if (r === 'bus only' || r === 'destination') inst.layerGains = [null, null, null, null];
    if (r === 'destination') inst.outputGain = null;
  };
  let cases = 0, mismatches = [];
  for (const url of URLS) for (let layer = 0; layer < 4; layer++) for (const t of TRANSPOSES) for (const adsr of ADSRS) for (const dt of TIMES) {
    const r = ROUTES[(cases + layer) % ROUTES.length];
    const spec = {
      setup: (inst) => { inst.layerTranspose[layer] = t; if (adsr) inst.layerADSR[layer] = { ...adsr }; route(inst, r); },
      strokes: [{ url, layer, dt, db: -18 + layer * 3, dur: 0.25 + layer }],
    };
    const ref = await partitionsRun('reference', spec), legacy = await partitionsRun('legacy', spec), mod = await partitionsRun('module', spec);
    cases++;
    if (!same(comparable(ref), comparable(mod)) || !same(comparable(ref), comparable(legacy))) {
      mismatches.push(`${url || '(none)'} L${layer} t${t} ${JSON.stringify(adsr)} dt${dt} ${r}: ${firstDiff(comparable(ref), comparable(mod)) || firstDiff(comparable(ref), comparable(legacy))}`);
    }
  }
  check(`${cases} single strokes (6 sources incl. blob: and a failing file × 4 layers × 4 transposes × 4 ADSRs × 4 timings, rotating 4 routings): reference = legacy path = through Audio/drums/`,
    mismatches.length === 0, mismatches.slice(0, 3).join(' | '));
}
{
  // One session on one context: repeats hit the cache, a re-picked sample is refetched, a failed load is retried,
  // a stop cuts everything in flight, and ended strokes leave activeSources.
  const spec = {
    setup: (inst) => { inst.layerTranspose = [0, 3, -5, 12]; inst.layerADSR[2] = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.05 }; },
    strokes: [
      { url: 'assets/audio/kick1.wav', layer: 0, dt: 0.05 },
      { url: 'assets/audio/kick1.wav', layer: 0, dt: 0.30 },
      { url: 'blob:http://localhost/user-sample-1', layer: 1, dt: 0.10 },
      { url: 'missing.wav', layer: 3, dt: 0.12 },
      { url: 'missing.wav', layer: 3, dt: 0.20 },
      (inst) => inst.invalidateSampleCache('assets/audio/kick1.wav'),
      { url: 'assets/audio/kick1.wav', layer: 2, dt: 0.40 },
      { url: 'assets/audio/hat2.wav', layer: 2, dt: 0.45 },
      (inst) => inst.updateLayerVolume(1, -3),
      (inst) => inst.updateLayerFilters(2, { highpass: 120, lowpass: 9000 }),
      (inst) => inst.updateBusVolume(-9),
      { url: 'assets/audio/cym2.wav', layer: 3, dt: 0.5 },
      (inst) => inst.stopAllActiveSources(),
    ],
  };
  const ref = await partitionsRun('reference', spec), legacy = await partitionsRun('legacy', spec), mod = await partitionsRun('module', spec);
  check('a session (cache hits, re-pick refetch, failed-load retry, layer/bus volume and filters, stop-all): identical graph, MIDI, fetches, decodes, warnings',
    same(comparable(ref), comparable(mod)) && same(comparable(ref), comparable(legacy)), firstDiff(comparable(ref), comparable(mod)) || firstDiff(comparable(ref), comparable(legacy)));
  check('fetches ask cache: no-store, as before', mod.fetches.every(([, o]) => o && o.cache === 'no-store') && mod.fetches.length === ref.fetches.length, `${mod.fetches.length} fetches`);
  const mod2 = await partitionsRun('module', { strokes: [{ url: 'assets/audio/kick1.wav', layer: 0, dt: 0.1 }, { url: 'assets/audio/kick1.wav', layer: 1, dt: 0.2 }] });
  const sources = mod2.p.ctx.nodes.filter(n => n.kind === 'buffersrc');
  const before = mod2.p.inst.activeSources.size;
  sources.forEach(s => s._end());
  check('strokes through Audio/drums/ sit in activeSources until they end', before === 2 && mod2.p.inst.activeSources.size === 0, `${before} → ${mod2.p.inst.activeSources.size}`);
}

console.log('\n  The loader');
{
  const ctx = makeCtx({ durations: { 'a.wav': 2 } });
  const seen = [];
  const inj = { fetch: async (url) => { seen.push(url); return { url }; }, decode: async (c, data) => ({ tag: `x:${data.url}`, duration: 3 }) };
  const [b1, b2] = await Promise.all([drums.loadSample(ctx, 'a.wav', inj), drums.loadSample(ctx, 'a.wav', inj)]);
  check('injected fetch + decode; two strokes asking at once share one load', b1 === b2 && b1.tag === 'x:a.wav' && same(seen, ['a.wav']));
  const b3 = await drums.loadSample(ctx, 'a.wav', inj);
  check('cached by URL: a later stroke gets the same buffer, no refetch', b3 === b1 && seen.length === 1 && drums.hasSample(ctx, 'a.wav'));
  const ctx2 = makeCtx();
  const b4 = await drums.loadSample(ctx2, 'a.wav', inj);
  check('cached per AudioContext: another context loads its own', b4 !== b1 && seen.length === 2);
  drums.invalidateSample(ctx, 'a.wav');
  const b5 = await drums.loadSample(ctx, 'a.wav', inj);
  check('invalidateSample forgets it on that context only', b5 !== b1 && seen.length === 3 && drums.hasSample(ctx2, 'a.wav'));
  const errs = [];
  let tries = 0;
  const flaky = { fetch: async (url) => { if (++tries === 1) throw new Error('offline'); return { url }; }, decode: inj.decode, onError: (u, e) => errs.push([u, e.message]) };
  const f1 = await drums.loadSample(ctx, 'blob:http://localhost/abc', flaky);
  const f2 = await drums.loadSample(ctx, 'blob:http://localhost/abc', flaky);
  check('a blob: URL loads like any other; a failure resolves null, reports, is not cached, and the next stroke retries',
    f1 === null && f2?.tag === 'x:blob:http://localhost/abc' && same(errs, [['blob:http://localhost/abc', 'offline']]) && tries === 2);
}

console.log('\n  The sample player');
{
  const buf = { tag: 'b', duration: 1.0 };
  const ctx = makeCtx();
  const h = drums.playSample({ ctx, out: ctx.destination, buffer: buf, at: 10, rate: 1, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, until: 10.4 });
  const [src, env, cut] = ctx.nodes.slice(1);
  check('envelope + until: a cut gain after the envelope fades over 12 ms to the next stroke, the source stops 10 ms after',
    src.kind === 'buffersrc' && env.kind === 'gain' && cut.kind === 'gain' && env.connections[0] === cut && cut.connections[0] === ctx.destination &&
    same(cut.gain.calls, [['set', 1, 10.388], ['lin', 0, 10.4]]) && same(src.stops, [10.41]) && h.source === src,
    JSON.stringify(cut.gain.calls));
  const ctx2 = makeCtx();
  drums.playSample({ ctx: ctx2, out: ctx2.destination, buffer: buf, at: 10, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, until: 12 });
  check('envelope + an until past the stroke\'s end: no cut gain, the graph is the plain fitted one', ctx2.nodes.length === 3);
  const ctx3 = makeCtx();
  drums.playSample({ ctx: ctx3, out: ctx3.destination, buffer: buf, at: 10, peak: 0.9 });
  const [s3, g3] = ctx3.nodes.slice(1);
  check('no envelope, no until: the sample plays whole at peak and is never stopped early (chunk-tunes\' kit sample)',
    same(g3.gain.calls, [['set', 0.9, 10]]) && s3.stops.length === 0 && same(s3.starts, [10]));
  const fit = drums.fitEnvelope({ attack: 0.2, decay: 0.3, sustain: 0.4, release: 0.6 }, 0.5);
  check('fitEnvelope: a buffer shorter than A+D+R gets no sustain hold', fit.sustainTime === 0 && Math.abs(fit.length - 1.1) < 1e-12);
}

console.log('\n  The made kit');
{
  const ids = drums.MADE_DRUM_IDS;
  check('five made sounds, chunk-tunes\' kit channels in order', same(ids, ['kick', 'snare', 'hihat', 'perc', 'cym']));
  check('choices: made:<id> values; madeDrumOf reads them back and refuses sample URLs and unknown ids',
    same(drums.MADE_DRUM_CHOICES.map(c => c.value), ids.map(i => `made:${i}`)) && drums.madeDrumOf('made:snare') === 'snare' &&
    drums.madeDrumOf('assets/audio/kick1.wav') === null && drums.madeDrumOf('made:cowbell') === null && drums.madeDrumOf(null) === null);
  const ui = fs.readFileSync(path.join(ROOT, 'Playback', 'Partitions', 'PartitionsUI.js'), 'utf8');
  check('PartitionsUI offers every made sound in a Synth optgroup of each layer\'s sample select',
    /<optgroup label="Synth"/.test(ui) && drums.MADE_DRUM_CHOICES.every(c => ui.includes(`value="${c.value}"`)));

  const freqsOf = (ctx) => ctx.nodes.flatMap(n => [
    ...(n.kind === 'osc' ? [n.frequency.value, ...n.frequency.calls.map(c => c[1])] : []),
    ...(n.kind === 'filter' ? [n.frequency.value] : []),
  ].filter(v => v !== 440 && v !== 350));
  const levelsOf = (ctx) => ctx.nodes.filter(n => n.kind === 'gain').flatMap(n => n.gain.calls.map(c => c[1]));
  for (const id of ids) {
    const base = makeCtx(), up = makeCtx(), loud = makeCtx();
    drums.playMadeDrum(id, { ctx: base, out: base.destination, at: 10 });
    drums.playMadeDrum(id, { ctx: up, out: up.destination, at: 10, pitch: 2 ** (7 / 12) });
    drums.playMadeDrum(id, { ctx: loud, out: loud.destination, at: 10, peak: 2 });
    const f0 = freqsOf(base), f1 = freqsOf(up), l0 = levelsOf(base), l1 = levelsOf(loud);
    check(`${id}: pitch multiplies every frequency (oscillator sweeps and noise filters); peak scales every level; timing is unchanged`,
      f0.length > 0 && f0.every((f, i) => Math.abs(f1[i] / f - 2 ** (7 / 12)) < 1e-12) && l0.every((l, i) => Math.abs(l1[i] - 2 * l) < 1e-12) &&
      same(graphOf(base).map(n => n.starts), graphOf(up).map(n => n.starts)) && same(graphOf(base).map(n => n.stops), graphOf(up).map(n => n.stops)),
      `${f0.length} frequencies`);
    const cutCtx = makeCtx();
    const h = drums.playMadeDrum(id, { ctx: cutCtx, out: cutCtx.destination, at: 10, until: 10.02 });
    const cut = cutCtx.nodes.find(n => n.kind === 'gain' && n.connections[0] === cutCtx.destination);
    const srcs = cutCtx.nodes.filter(n => n.kind === 'osc' || n.kind === 'buffersrc');
    check(`${id}: until cuts it short (12 ms fade into the next stroke) and stops every source 10 ms after`,
      same(cut.gain.calls, [['set', 1, 10.008], ['lin', 0, 10.02]]) && srcs.every(s => Math.abs(s.stops[0] - 10.03) < 1e-12));
    let ended = 0;
    h.onEnded(() => ended++);
    srcs.forEach(s => s._end());
    h.stop(11);
    check(`${id}: the handle reports ended once every source has, and stop(at) reaches every source`, ended === 1 && srcs.every(s => s.stops.at(-1) === 11));
  }
  const n1 = makeCtx();
  drums.playMadeDrum('snare', { ctx: n1, out: n1.destination, at: 10 });
  drums.playMadeDrum('hihat', { ctx: n1, out: n1.destination, at: 11 });
  const noiseBufs = new Set(n1.nodes.filter(n => n.kind === 'buffersrc').map(n => n.buffer));
  check('one 0.25 s noise buffer per context, shared by every stroke (chunk-tunes\' noiseOf)', noiseBufs.size === 1 && [...noiseBufs][0].length === 12000);
}
{
  // Partitions: a made choice routes like a sample (layer filters → gain → bus), honours transpose, skips the ADSR,
  // keeps MIDI, and is cut by stop-all.
  const r = await partitionsRun('module', {
    setup: (inst) => { inst.layerTranspose[1] = -12; inst.layerADSR[1] = { attack: 0.5, decay: 0.5, sustain: 0.1, release: 2 }; },
    strokes: [{ url: 'made:kick', layer: 1, dt: 0.1, db: -6, dur: 0.75 }, { url: 'made:bogus', layer: 1, dt: 0.2 }],
  });
  const { inst, ctx } = r.p;
  const osc = ctx.nodes.find(n => n.kind === 'osc');
  const gain = ctx.nodes.find(n => n.kind === 'gain' && n.id > osc.id);
  check('a made kick on layer B: into the layer\'s highpass, an octave down with transpose −12, its own envelope (not the ADSR)',
    gain.connections[0] === inst.layerFilters[1].highpass && osc.frequency.calls[0][1] === 70 && osc.frequency.calls[1][1] === 23 &&
    Math.abs(gain.gain.calls[0][1] - 0.5 / 0.9) < 1e-12 && gain.gain.calls[1][0] === 'exp', JSON.stringify(gain.gain.calls));
  check('MIDI is scheduled for made hits exactly as for samples (and for an unknown made id, which stays silent)',
    r.midi.length === 2 && same(r.midi[0], [1, ctx.currentTime + 0.1, -6, -12, 0.75]) && ctx.nodes.filter(n => n.kind === 'osc').length === 1);
  check('made strokes are tracked, and stop-all reaches them', inst.activeSources.size === 1 && (inst.stopAllActiveSources(), osc.stops.at(-1) === 'now') && inst.activeSources.size === 0);
  const dbg = await partitionsRun('module', { strokes: [{ url: 'made:hihat', layer: 0, dt: -0.01 }] });
  check('a stale made hit is dropped like a stale sample (MIDI still asked, no audio)', dbg.midi.length === 1 && dbg.p.ctx.nodes.every(n => n.kind !== 'buffersrc'));
}

// ── chunk-tunes parity: its own page code, lifted read-only out of chunk-tunes.html ───────────────────────────────
console.log('\n  chunk-tunes parity — the made sounds and the cut sample against chunk-tunes\' page code');
const RELATIVE = path.join('Compiler', 'Codex Compiler (dev)', 'Overworld', 'econ');
function findChunkDir() {
  const arg = process.argv.find(a => a.startsWith('--chunk='));
  if (arg) return arg.slice('--chunk='.length);
  for (let dir = HERE; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, RELATIVE);
    if (fs.existsSync(path.join(candidate, 'chunk-tunes.html'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}
// The source of `function <name>(` in `text`, braces matched past strings, template literals and comments.
function lift(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let i = text.indexOf('{', start), depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { for (i++; text[i] !== c; i++) if (text[i] === '\\') i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
const chunkDir = findChunkDir();
if (!chunkDir || !fs.existsSync(path.join(chunkDir, 'chunk-tunes.html'))) {
  console.log(`  – SKIPPED: chunk-tunes is not on this machine (looked for …/${RELATIVE}/chunk-tunes.html); pass --chunk=<dir> to point at it.`);
} else {
  const html = fs.readFileSync(path.join(chunkDir, 'chunk-tunes.html'), 'utf8');
  const sounds = await import(pathToFileURL(path.join(chunkDir, 'runtime', 'chunk-sounds.js')).href);
  const parts = ['noiseOf', 'strike', 'arrVoices'].map(n => [n, lift(html, n)]);
  const missing = parts.filter(([, src]) => !src).map(([n]) => n);
  check(`lifted noiseOf, strike and arrVoices out of ${path.join(chunkDir, 'chunk-tunes.html')}`, missing.length === 0, missing.join(', '));
  if (missing.length === 0) {
    const chunkSandbox = { state: { arrange: {} }, player: { voices: [] }, KIT: sounds.KIT, Math };
    vm.createContext(chunkSandbox);
    vm.runInContext(parts.map(([, src]) => src).join('\n') + '\nthis.arrVoices = arrVoices;', chunkSandbox);
    const CHANNELS = sounds.KIT_IDS;
    check('chunk-tunes\' kit channels are ours, in order, with our sampleLevel as its KIT peak',
      same(CHANNELS, drums.MADE_DRUM_IDS) && CHANNELS.every(id => drums.MADE_DRUMS[id].sampleLevel === sounds.KIT[id].peak));
    const chunkGraph = (fn) => { const ctx = makeCtx({ sampleRate: 44100 }); chunkSandbox.state.arrange = {}; const out = ctx.createGain(); fn(ctx, out); return graphOf(ctx); };
    for (const id of CHANNELS) for (const at of [10, 12.345]) {
      const theirs = chunkGraph((ctx, out) => chunkSandbox.arrVoices(ctx).play(id, [{ time: 0 }], at, out, { sample: null }));
      const ours = chunkGraph((ctx, out) => drums.playMadeDrum(id, { ctx, out, at }));
      check(`${id} at ${at}: our made stroke is chunk-tunes' made stroke, node for node`, same(theirs, ours), firstDiff(theirs, ours));
    }
    for (const id of CHANNELS) {
      const buffer = { tag: `buf:${id}`, duration: 0.5 };
      const notes = [{ time: 0 }, { time: 0.2 }, { time: 0.9 }];
      const theirs = chunkGraph((ctx, out) => chunkSandbox.arrVoices(ctx).play(id, notes, 10, out, { sample: buffer }));
      const ours = chunkGraph((ctx, out) => notes.forEach((n, i) => drums.playSample({ ctx, out, buffer, at: 10 + n.time, peak: sounds.KIT[id].peak, until: i + 1 < notes.length ? 10 + notes[i + 1].time : null })));
      // chunk-tunes leaves playbackRate alone; we set it to the rate (1). Everything else must match.
      const strip = g => g.map(({ playbackRate, ...n }) => n);
      const rates = ours.filter(n => n.kind === 'buffersrc').every(n => same(n.playbackRate.calls[0], ['set', 1, n.starts[0]]));
      check(`${id} kit sample: cut short at the next stroke as chunk-tunes does (whole when the next is past its end, and the last)`,
        same(strip(theirs), strip(ours)) && rates, firstDiff(strip(theirs), strip(ours)));
    }
  }
}

console.log(`\n${PASS ? '✓✓✓ AUDIO DRUMS PASSES' : '✗✗✗ AUDIO DRUMS FAILS'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
