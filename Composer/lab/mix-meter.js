// mix-meter.js — the stem meter (MIX_MASTER_ORDER.md M1). It renders each part of a composition alone, and the whole
// mix, in an OfflineAudioContext (a Web Audio context that renders to a buffer as fast as it can instead of to the
// speakers) through the real player (perform/composer-player.js), and measures each render:
//   peak       the largest sample, dBFS (decibels below digital full scale, 0 dBFS = the largest value a sample holds)
//   true peak  the peak between the samples too (4× oversampled, ITU-R BS.1770), dBTP
//   RMS        the root-mean-square level over the render, dBFS: the average power, unweighted
//   M-max      the loudest momentary loudness (a 400 ms window, every 100 ms), LUFS: how loud a hit is heard
//   S-max      the loudest short-term loudness (a 3 s window, every 100 ms), LUFS: loudness as BS.1770 hears it,
//              K-weighted (a shelf that favours the presence band and a high-pass that discounts the lows)
//   integrated the whole render's gated loudness, LUFS (EBU R128's programme loudness)
//   GR         (mix renders) the master compressor's gain reduction, sampled every 20 ms while it renders: its median
//              and its 95th percentile (the deepest 5 %), dB; the first 100 ms are skipped (the node's start-up)
// The measures are pure (Node tests them: Composer/tests/assert-mix-master.mjs); the rendering needs a browser.
//
//   meterRow({ layers, cycleSeconds, seed, configs }) → Promise<{ row, tempo, stems: { [config]: { [stem]: measures } } }>
//   PROBE_ROWS, METER_CONFIGS

import { createComposerController } from '../perform/composer-controller.js';
import { createPlayer } from '../perform/composer-player.js';
import { truePeakOf } from '../perform/composer-limiter.worklet.js';

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// ── the measures ──

/** BS.1770's K-weighting at sample rate fs: the two biquads' { b, a } (libebur128's coefficients for any rate) */
export function kWeightCoefficients(fs) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs);
  a0 = 1 + K / Q + K * K;
  const highpass = { b: [1, -2, 1], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highpass];
}
const biquad = (x, { b, a }) => {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
};
/** a channel K-weighted */
export const kWeight = (x, fs) => kWeightCoefficients(fs).reduce(biquad, x);

/** loudness (LUFS) of the summed mean squares of K-weighted channels */
const lufs = (ms) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

/** windowed mean squares of K-weighted channels, summed over the channels: every `hop` samples, `win` long */
function windowPowers(weighted, win, hop) {
  const n = weighted[0].length, out = [];
  if (n < win) { let s = 0; for (const ch of weighted) for (let i = 0; i < n; i++) s += ch[i] * ch[i]; return [n ? s / n : 0]; }
  // running sums
  const cum = new Float64Array(n + 1);
  for (const ch of weighted) { let acc = 0; for (let i = 0; i < n; i++) { acc += ch[i] * ch[i]; cum[i + 1] += acc; } }
  for (let s = 0; s + win <= n; s += hop) out.push((cum[s + win] - cum[s]) / win);
  return out;
}

/**
 * measure(channels, fs) → { peakDb, truePeakDb, rmsDb, mMaxLufs, sMaxLufs, integratedLufs, crestDb }
 *   channels: arrays of samples (one a channel)
 */
export function measure(channels, fs) {
  let peak = 0, sq = 0, n = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; sq += ch[i] * ch[i]; n++; }
  const rms = n ? Math.sqrt(sq / n) : 0;
  const weighted = channels.map((ch) => kWeight(ch, fs));
  const short = windowPowers(weighted, Math.round(3 * fs), Math.round(0.1 * fs));
  const blocks = windowPowers(weighted, Math.round(0.4 * fs), Math.round(0.1 * fs));
  // integrated: the absolute gate (−70 LUFS), then the relative one (10 LU under the gated mean)
  const abs = blocks.filter((p) => lufs(p) > -70);
  const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const rel = lufs(mean(abs)) - 10, gated = abs.filter((p) => lufs(p) > rel);
  const tp = truePeakOf(channels);
  return { peakDb: db(peak), truePeakDb: db(tp), rmsDb: db(rms), mMaxLufs: lufs(Math.max(0, ...blocks)), sMaxLufs: lufs(Math.max(0, ...short)), integratedLufs: lufs(mean(gated)), crestDb: db(tp) - db(rms) };
}

// ── the probe ──

/** the rows the release plan probes, at the cycle lengths the comp-gate probe heard them (its tempos) */
export const PROBE_ROWS = Object.freeze([
  { layers: [8, 7, 6, 5], cycleSeconds: 4 },
  { layers: [11, 9, 7, 5], cycleSeconds: 4 },
  { layers: [16, 12, 9, 0], cycleSeconds: 4 },
  { layers: [7, 5, 3, 2], cycleSeconds: 4 },
  { layers: [19, 17, 16, 15], cycleSeconds: 4 },
  { layers: [119, 42, 15, 8], cycleSeconds: 8 },
  { layers: [768, 769, 0, 0], cycleSeconds: 8 },
  { layers: [768, 784, 0, 0], cycleSeconds: 8 },
].map(Object.freeze));

/** what each render runs through: the player's `mix` option (null = today's graph) */
export const METER_CONFIGS = Object.freeze({
  today: null,                                                   // today: the buses at 0.8, master 0.8, the compressor
  raw: Object.freeze({ master: 'none', staging: false, duck: false }),      // the same, with no master processing at all
  staged: Object.freeze({ master: 'none', staging: true, duck: true }),     // M2 + M3, no master processing
  knock: Object.freeze({ master: 'knock', staging: true, duck: true }),     // M2 + M3 + M4: the new default
  classicStaged: Object.freeze({ master: 'classic', staging: true, duck: true }),   // M2 + M3 through today's compressor
});
export const STEMS = Object.freeze(['drums', 'bass', 'lead', 'chords', 'comp', 'inner', 'mix']);

/** compose a row on this thread, as the window would on the lean table (seed 1, the defaults) */
export async function composeRow({ layers, cycleSeconds, seed = 1 }) {
  const ctl = createComposerController();
  ctl.setLayers(layers); ctl.setCycle(cycleSeconds); ctl.setSeed?.(seed);
  await ctl.compose();
  const s = ctl.state;
  if (!s.spec || s.spec.refused) throw new Error(`${layers.join(':')}: refused`);
  return { spec: s.spec, parts: ctl.currentParts(), drums: s.drums, levels: { ...s.levels } };
}

/**
 * render one stem (a part alone, 'drums' alone, or 'mix') of a composed row through the player in an
 * OfflineAudioContext: two cycles when the cycle is under 6 s, else one, and a 1 s tail. Returns { channels,
 * sampleRate, gr } (gr: the master compressor's reduction, sampled every 20 ms, mix renders only).
 */
export async function renderStem(row, stem, mix, { sampleRate = 48000 } = {}) {
  const T = row.spec.knobs.cycleSeconds, cycles = T < 6 ? 2 : 1, start = 0.05, seconds = start + cycles * T + 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const player = createPlayer({ ctx, timers: {}, options: { aheadSeconds: cycles * T }, mix });
  if (player.chain) await player.chain.ready;
  for (const [id, v] of Object.entries(row.levels)) player.setLevel(id, v);
  const parts = row.parts.map((p) => ({ ...p, enabled: stem === 'mix' ? p.enabled : p.id === stem }));
  // a part alone still ducks under the kicks it plays against in the mix: the drums book (the duck follows them) with
  // their fader at 0
  const ghost = mix && mix.duck && stem !== 'mix' && stem !== 'drums';
  const drums = row.drums ? { ...row.drums, enabled: stem === 'mix' ? row.drums.enabled : stem === 'drums' || (ghost && row.drums.enabled) } : null;
  if (ghost) player.setLevel('drums', 0);
  // the master compressor's reduction, read at each suspend (mix renders, through a compressor)
  const gr = [];
  const comp = !mix ? player.limiter : mix.master === 'classic' ? player.chain.nodes.classic : mix.master === 'knock' ? player.chain.nodes.glue : null;
  if (stem === 'mix' && comp) {
    for (let t = start + 0.1; t < seconds - 1; t += 0.02) ctx.suspend(t).then(() => { gr.push(comp.reduction); ctx.resume(); });
  }
  player.play(row.spec, () => parts, () => drums);
  // the ghost drums silent from the first sample (setLevel glides, over 20 ms: the first kick would leak)
  if (ghost) { const g = player.buses.drums.gain; g.cancelScheduledValues(0); g.setValueAtTime(0, 0); }
  const buffer = await ctx.startRendering();
  player.stop();
  const from = Math.round(start * sampleRate);
  const channels = [buffer.getChannelData(0).slice(from), buffer.getChannelData(1).slice(from)];
  return { channels, sampleRate, gr };
}

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** a row's measures: every stem in every config asked (names of METER_CONFIGS, or { name: mix }) */
export async function meterRow(rowSpec, { configs = Object.keys(METER_CONFIGS), stems = STEMS, onProgress = null } = {}) {
  const row = await composeRow(rowSpec);
  const out = { row: rowSpec.layers.filter(Boolean).join(':'), tempoBpm: row.spec.knobs.tempoBpm, cycleSeconds: row.spec.knobs.cycleSeconds, stems: {} };
  const asked = Array.isArray(configs) ? Object.fromEntries(configs.map((c) => [c, METER_CONFIGS[c]])) : configs;
  for (const [c, mix] of Object.entries(asked)) {
    out.stems[c] = {};
    for (const stem of stems) {
      onProgress?.(`${out.row} · ${c} · ${stem}`);
      const r = await renderStem(row, stem, mix);
      const m = measure(r.channels, r.sampleRate);
      if (r.gr.length) { const s = [...r.gr].sort((a, b) => a - b); m.grMedianDb = median(r.gr); m.grP95Db = s[Math.floor(s.length * 0.05)]; }
      out.stems[c][stem] = m;
    }
  }
  return out;
}
