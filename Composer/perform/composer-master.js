// composer-master.js — the Composer's mix and master (MIX_MASTER_ORDER.md, Thread 2 of RELEASE_PLAN.md): the staging
// table (M2), the kick duck's schedule (M3), and the master chain mapped from Avery's Ableton rack "drms knock" (M4–M5,
// Composer/mix-reference/drms-knock.adg.xml). Pure tables and functions, plus createMasterChain, which builds the chain
// on an AudioContext. The player (composer-player.js) wires it in when it is given `mix`; without `mix` it plays
// today's graph unchanged (Cosmos does).
//
// The rule it keeps (M6, Avery 2026-11-03): MIDI velocity is kept apart from the mix. Everything here is audio only:
// the user's level faders still scale MIDI velocity (CLEAN_MIDI_ORDER.md M4); the trims, filters, duck and master
// never reach it.
//
//   staging   MIX_STAGING: a trim (dB) and a high-pass (Hz, 12 dB/oct) per part, AFTER its level fader, so a fader
//             means what it meant, and the MIDI does too.
//   duck      DUCK_DEFAULTS, duckGainAt, duckPoints: a gain dip on the chords, comp and inner at every kick, booked
//             from the kick times the player already knows (no detector, so nothing reacts late).
//   master    createMasterChain(ctx, { mode }): 'knock' (the rack) or 'classic' (today's DynamicsCompressor), switched
//             with a 30 ms crossfade. 'none' (the meter's) is no processing at all.
//             knock = input trim → Glue (Peak Clip In, then a DynamicsCompressor at the Glue's settings, its built-in
//             makeup taken back out) → Tube (a WaveShaper at 60 % wet) → Saturator (Analog Clip, soft clip, 4×
//             oversampled) → the limiter (composer-limiter.worklet.js, −1 dBTP; a stand-in compressor until the
//             worklet has loaded) → output.

import { LIMITER_DEFAULTS } from './composer-limiter.worklet.js';

const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (g) => 20 * Math.log10(g);

// ── the rack, as saved (drms-knock.adg.xml; the builder's reading, MIX_MASTER_ORDER.md M5) ──

/** Glue Compressor's Attack and Release are indexes into these (its switch positions) */
export const GLUE_ATTACK_MS = Object.freeze([0.01, 0.1, 0.3, 1, 3, 10, 30]);
export const GLUE_RELEASE_S = Object.freeze([0.1, 0.2, 0.4, 0.6, 0.8, 1.2, 'auto']);

/** every device in the rack's chain, in order, with its saved parameters (Manual values) and whether it is on */
export const DRMS_KNOCK = Object.freeze({
  name: 'drms knock',
  chain: Object.freeze([
    Object.freeze({ device: 'GlueCompressor', name: 'Mastering - Peak Catcher', on: true,
      params: Object.freeze({ Threshold: -9.52380943, Range: 64.3742142, Makeup: 0, Attack: 0, Ratio: 2, Release: 0, DryWet: 1, PeakClipIn: true, Oversample: false, SideChain: false }) }),
    Object.freeze({ device: 'Tube', on: true,
      params: Object.freeze({ DryWet: 0.6031746268, PreDrive: -15, PostDrive: 0, Bias: 0, AutoBias: 0.2380952388, AutoBiasAttack: 5.75381422, AutoBiasRelease: 35, Tone: 0.2539682686, Type: 2, Oversampling: 0 }) }),
    Object.freeze({ device: 'Delay', on: true,
      params: Object.freeze({ DryWet: 0, Feedback: 0, PingPong: true, SyncL: true, SyncR: true, SyncedSixteenthL: 2, SyncedSixteenthR: 3, FilterOn: true, FilterFrequency: 5587.11377, FilterBandwidth: 5.3092103 }) }),
    Object.freeze({ device: 'Eq8', on: false,
      params: Object.freeze({ band2: Object.freeze({ on: true, mode: 3, freq: 1726.05444, gain: 2.38095236, q: 2.01293349 }) }) }),
    Object.freeze({ device: 'BeatRepeat', on: false,
      params: Object.freeze({ Grid: 2, InstantRepeat: false, Chance: 0, Interval: 6, WetLevel: 0.8912508488 }) }),
    Object.freeze({ device: 'AudioEffectGroupDevice', name: 'Gradual Mid Scooper', on: true,
      chain: Object.freeze([Object.freeze({ device: 'FilterEQ3', on: true,
        params: Object.freeze({ GainLo: 1, GainMid: 1, GainHi: 1, FreqLo: 877.131042, FreqHi: 2954.59521, LowOn: true, MidOn: true, HighOn: true, Slope: 1 }) })]) }),
    Object.freeze({ device: 'Saturator', on: true,
      params: Object.freeze({ PreDrive: 0, Type: 0, PreDcFilter: false, ColorOn: true, ColorDepth: 0, BaseDrive: 0, PostClip: 1, PostDrive: 0, DryWet: 1, Oversampling: true }) }),
  ]),
});

/** the rack's macros at their saved values (0–127) and what each drives: { device, param, min, max, curve }. The nested
 *  rack's own macros (Isolate Mids, Macro 2, Macro 3) are each driven 0–127 by an outer one, so they're folded in.
 *  curve: 'lin' (linear), 'log' (frequencies: linear in log Hz), 'db' (an amplitude, linear in dB), 'step' (rounded) */
export const DRMS_MACROS = Object.freeze([
  { index: 0, name: 'Turn it up', value: 0, targets: [{ device: 'GlueCompressor', param: 'Makeup', min: 0, max: 20, curve: 'lin' }] },
  { index: 1, name: 'Make it Dirty', value: 0, targets: [{ device: 'Tube', param: 'PreDrive', min: -15, max: 15, curve: 'lin' }] },
  { index: 2, name: 'A boost', value: 85, targets: [{ device: 'Eq8', param: 'band2.freq', min: 10, max: 22000, curve: 'log' }] },
  { index: 3, name: 'Loud', value: 63.5, targets: [{ device: 'Saturator', param: 'PreDrive', min: -36, max: 36, curve: 'lin' }] },
  { index: 4, name: 'PING PONG', value: 0, targets: [{ device: 'Delay', param: 'Feedback', min: 0, max: 0.9499999881, curve: 'lin' }, { device: 'Delay', param: 'DryWet', min: 0, max: 1, curve: 'lin' }] },
  { index: 5, name: 'Beat Repeat', value: 0, targets: [{ device: 'BeatRepeat', param: 'On', curve: 'toggle' }, { device: 'BeatRepeat', param: 'InstantRepeat', curve: 'toggle' }] },
  { index: 6, name: 'Macro 7', value: 13, targets: [{ device: 'BeatRepeat', param: 'Grid', min: 0, max: 15, curve: 'step' }] },
  { index: 7, name: 'Mids Only', value: 0, targets: [{ device: 'FilterEQ3', param: 'GainLo', min: 1, max: 0.0003162277571, curve: 'db' }, { device: 'FilterEQ3', param: 'GainHi', min: 1, max: 0.0003162277571, curve: 'db' }] },
  { index: 8, name: 'Lo Cut', value: 79, targets: [{ device: 'FilterEQ3', param: 'FreqLo', min: 50, max: 5000, curve: 'log' }] },
  { index: 9, name: 'Hi Cut', value: 76, targets: [{ device: 'FilterEQ3', param: 'FreqHi', min: 200, max: 18000, curve: 'log' }] },
].map((m) => Object.freeze({ ...m, targets: Object.freeze(m.targets.map((t) => Object.freeze(t))) })));

/** a macro value (0–127) → the parameter it drives */
export function macroToParam(value, { min, max, curve }) {
  const u = Math.min(1, Math.max(0, value / 127));
  if (curve === 'toggle') return u >= 0.5;
  if (curve === 'log') return min * Math.pow(max / min, u);
  if (curve === 'db') return dbToGain(gainToDb(min) + (gainToDb(max) - gainToDb(min)) * u);
  const v = min + (max - min) * u;
  return curve === 'step' ? Math.round(v) : v;
}

/** the parameters the macros set, at `values` (index → 0–127; the saved values by default): [{ macro, device, param, value }] */
export function resolveMacros(values = {}) {
  const out = [];
  for (const m of DRMS_MACROS) for (const t of m.targets) out.push({ macro: m.name, device: t.device, param: t.param, value: macroToParam(values[m.index] ?? m.value, t) });
  return out;
}

// ── Web Audio's DynamicsCompressor, as Chromium computes its static curve (and the makeup gain it adds by itself) ──

/**
 * the compressor's static curve in Chromium (DynamicsCompressorKernel): linear to the threshold, an exponential knee
 * whose slope reaches 1/ratio at threshold + knee, then the ratio. Returns { curve(xLinear) → yLinear, makeupDb }: the
 * node multiplies its output by (1 / curve(1))^0.6, a makeup gain it applies by itself (the Web Audio spec writes this
 * down). Both chains compensate for it; 'classic' keeps it, as today.
 */
export function chromiumCompressor({ threshold, knee, ratio }) {
  const linearThreshold = dbToGain(threshold), slope = 1 / ratio;
  const kneeCurve = (x, k) => (x < linearThreshold ? x : linearThreshold + (1 - Math.exp(-k * (x - linearThreshold))) / k);
  const kneeThresholdDb = threshold + knee, kneeThreshold = dbToGain(kneeThresholdDb);
  const saturateWith = (x, k, ykneeDb) => {
    if (x < kneeThreshold) return kneeCurve(x, k);
    return dbToGain(ykneeDb + slope * (gainToDb(x) - kneeThresholdDb));
  };
  const slopeAt = (x, k) => {
    if (x < linearThreshold) return 1;
    const x2 = x * 1.001, xDb = gainToDb(x), x2Db = gainToDb(x2);
    const yDb = gainToDb(kneeCurve(x, k)), y2Db = gainToDb(kneeCurve(x2, k));
    return (y2Db - yDb) / (x2Db - xDb);
  };
  // kAtSlope: a bisection in log k on the knee's slope at its end
  let minK = 0.1, maxK = 10000, k = 5;
  for (let i = 0; i < 15; i++) {
    const s = slopeAt(kneeThreshold, k);
    if (s < slope) maxK = k; else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const ykneeDb = gainToDb(kneeCurve(kneeThreshold, k));
  const curve = (x) => saturateWith(x, k, ykneeDb);
  return { curve, makeupDb: 0.6 * -gainToDb(curve(1)), k };
}

// ── the curves (WaveShaper tables over ±SHAPER_RANGE: the shaper's input is scaled down by it, so the master's peaks
//    above 0 dBFS still land on the curve) ──
export const SHAPER_RANGE = 4;

/** a soft clip: linear below `knee` (linear amplitude), bending smoothly to an asymptote at `ceiling` */
export function softClip(x, knee, ceiling = 1) {
  const a = Math.abs(x);
  if (a <= knee) return x;
  const room = ceiling - knee;
  return Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
}

/** Tube (Dynamic Tube, type C, at its saved Drive and Bias): an asymmetric tanh, the drive in front of it and the same
 *  amount taken off after, so it colours without changing the small-signal level (the builder's assumption, M5) */
export function tubeShape(x, { driveDb = -15, bias = 0.12 } = {}) {
  const g = dbToGain(driveDb), b = bias;
  const f = (v) => Math.tanh(v + b) - Math.tanh(b);
  const slope0 = 1 - Math.tanh(b) ** 2;
  return f(g * x) / (g * slope0);
}

/** Saturator, Analog Clip at Drive 0 with Soft Clip on: linear to about −3 dBFS, rounding into 0 dBFS */
export const saturatorShape = (x) => softClip(x, dbToGain(-3), 1);
/** Glue's Peak Clip In: linear to −1 dBFS, rounding into +1 dBFS (the builder's reading of the switch, M5) */
export const peakClipShape = (x) => softClip(x, dbToGain(-1), dbToGain(1));

/** a WaveShaper table of `n` points over ±SHAPER_RANGE */
export function shaperTable(shape, n = 4097) {
  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1) * 2 - 1) * SHAPER_RANGE; t[i] = shape(x) / SHAPER_RANGE; }
  return t;
}

// ── M2: the staging table (audio only) ──

/** where each part should sit, in LU (loudness units, = dB of loudness) relative to the drums, by momentary-max
 *  loudness (M-max: the loudest 400 ms, how loud a hit is heard): the release plan's starting points (M2, overrulable) */
export const MIX_TARGETS_LU = Object.freeze({ drums: 0, bass: -3, lead: -4, chords: -10, comp: -8, inner: -9 });
/** where each part sits today, raw (no master processing, every fader at 0.8): the median over the 8 probe rows of its
 *  M-max relative to the drums' (the meter, headless Chromium, 2026-11-03; MIX_MASTER_ORDER.md, the probe) */
export const MIX_PROBE_MMAX_LU = Object.freeze({ drums: 0, bass: 11.8, lead: 19.3, chords: 19.4, comp: 11.3, inner: 6.8 });
/** the drums' own trim: their raw peaks (median −9.1 dBFS) to about −3 dBFS into the master */
export const DRUMS_TRIM_DB = 6;
const half = (x) => Math.round(x * 2) / 2;

/**
 * the per-part trim (dB, after the level fader: target − today + the drums' trim, to the half dB) and high-pass (Hz;
 * 12 dB/oct, Q 0.707: the low end left to the bass and the kick; the comp's lower, it's struck and goes to 135 Hz)
 */
export const MIX_STAGING = Object.freeze({
  trimsDb: Object.freeze(Object.fromEntries(Object.keys(MIX_TARGETS_LU).map((id) => [id, half(DRUMS_TRIM_DB + MIX_TARGETS_LU[id] - MIX_PROBE_MMAX_LU[id])]))),
  highpassHz: Object.freeze({ chords: 150, inner: 150, comp: 120 }),
});

// ── M3: the kick duck ──

export const DUCK_DEFAULTS = Object.freeze({ parts: Object.freeze(['chords', 'comp', 'inner']), depthDb: 3, attackMs: 5, holdMs: 10, recoveryMs: 120, stepMs: 10 });

/** the duck's level in dB, τ seconds from one kick (τ < 0 before it): down over the attack, so it is fully down AT the
 *  kick, held, then back up over the recovery, linear in dB */
export function duckShapeDb(tau, o = DUCK_DEFAULTS) {
  const a = o.attackMs / 1000, h = o.holdMs / 1000, r = o.recoveryMs / 1000;
  if (tau < -a || tau >= h + r - 1e-9) return 0;
  if (tau < 0) return -o.depthDb * (tau + a) / a;
  if (tau < h) return -o.depthDb;
  return -o.depthDb * (1 - (tau - h) / r);
}

/** the duck's gain at time t: the deepest of the kicks' shapes (overlapping kicks don't stack) */
export function duckGainAt(t, kicks, o = DUCK_DEFAULTS) {
  let db = 0;
  for (const k of kicks) { const d = duckShapeDb(t - k, o); if (d < db) db = d; }
  return dbToGain(db);
}

/**
 * the points to book on a duck gain, after `from` and up to `to` (clock seconds): [[t, gain]] ascending, each a
 * linear ramp from the one before. Every kick's corners are in, points every stepMs along its recovery and every 1 ms
 * along its attack, and where
 * overlapping kicks' shapes cross (linear ramps in gain between them follow the shape within 0.05 dB). A stretch at
 * 0 dB needs no points but the corner where the next dip starts.
 */
export function duckPoints(kicks, from, to, o = DUCK_DEFAULTS) {
  const a = o.attackMs / 1000, h = o.holdMs / 1000, r = o.recoveryMs / 1000, step = o.stepMs / 1000;
  const times = [];
  for (const k of kicks) {
    if (k + h + r < from || k - a > to) continue;
    times.push(k - a, k, k + h, k + h + r);
    for (let s = k + h + step; s < k + h + r - 1e-9; s += step) times.push(s);
    for (let s = k - a + 0.001; s < k - 1e-9; s += 0.001) times.push(s);   // the attack, every 1 ms
  }
  times.sort((x, y) => x - y);
  // where the deepest kick changes between two points (a dip's attack crossing an earlier kick's recovery), the
  // crossing itself, found by bisection: the shape is linear in dB on either side of it
  const deepest = (t) => { let best = -1, v = 0; kicks.forEach((k, i) => { const d = duckShapeDb(t - k, o); if (d < v) { v = d; best = i; } }); return best; };
  for (let i = times.length - 1; i > 0; i--) {
    let lo = times[i - 1], hi = times[i];
    if (hi - lo < 1e-6 || deepest(lo) === deepest(hi) || deepest(lo) < 0 || deepest(hi) < 0) continue;
    const left = deepest(lo);
    for (let j = 0; j < 30; j++) { const mid = (lo + hi) / 2; if (deepest(mid) === left) lo = mid; else hi = mid; }
    times.splice(i, 0, hi);
  }
  const out = [];
  for (const t of times) {
    if (t <= from || t > to) continue;
    if (out.length && t - out[out.length - 1][0] < 1e-6) continue;
    out.push([t, duckGainAt(t, kicks, o)]);
  }
  return out;
}

// ── M4: the master chain ──

/** today's master compressor (the player's LIMITER before this order): 'classic' */
export const CLASSIC_COMPRESSOR = Object.freeze({ threshold: -10, knee: 6, ratio: 6, attack: 0.003, release: 0.2 });
/** the Glue's settings on a DynamicsCompressor: the rack's threshold and ratio, its fastest attack and release (Attack 0
 *  = 0.01 ms, Release 0 = 0.1 s), a hard knee (Glue has none to set) */
export const GLUE = Object.freeze({ threshold: -9.52380943, knee: 0, ratio: 2, attack: GLUE_ATTACK_MS[0] / 1000, release: GLUE_RELEASE_S[0] });
/** the knock chain's settings: the input trim (where Avery's master would see the mix, M4: +4 dB puts the staged mix's
 *  drum peaks about 1 dB over 0 dBFS into the Glue, ~1.7 dB median reduction, −16.8 LUFS integrated, the probe), the
 *  Tube's wet share and drive, the limiter */
export const KNOCK = Object.freeze({ inputDb: 4, tubeWet: 0.6031746268, tubeDriveDb: -15, limiter: LIMITER_DEFAULTS });
export const MASTER_MODES = Object.freeze(['knock', 'classic', 'none']);
/** the Composer's mix (the controller's default; Cosmos plays without one): staged, ducked, through the rack */
export const COMPOSER_MIX = Object.freeze({ master: 'knock', staging: true, duck: true });

const setParams = (node, values) => { for (const [k, v] of Object.entries(values)) if (node[k]) node[k].value = v; };
const shaper = (ctx, shape, oversample) => {
  if (!ctx.createWaveShaper) return null;
  const s = ctx.createWaveShaper();
  s.curve = shaperTable(shape);
  s.oversample = oversample;
  return s;
};
/** in → [1/RANGE] → shaper → [RANGE] → out (a straight wire where the context has no WaveShaper) */
function shapedStage(ctx, shape, oversample) {
  const pre = ctx.createGain(), post = ctx.createGain(), s = shaper(ctx, shape, oversample);
  if (s) { pre.gain.value = 1 / SHAPER_RANGE; post.gain.value = SHAPER_RANGE; pre.connect(s); s.connect(post); } else pre.connect(post);
  return { input: pre, output: post, shaper: s };
}

/**
 * createMasterChain(ctx, { mode, limiterUrl }) → { input, output, mode, setMode(mode), ready, nodes, limiterReduction() }
 *   input/output  GainNodes: the player's master feeds `input`; `output` feeds the destination
 *   mode          'knock' | 'classic' | 'none'; setMode crossfades over 30 ms
 *   ready         a Promise, resolved once the limiter worklet is in (at once where the context has no AudioWorklet:
 *                 the stand-in compressor stays)
 */
export function createMasterChain(ctx, { mode = 'knock', limiterUrl = new URL('./composer-limiter.worklet.js', import.meta.url), knock = KNOCK } = {}) {
  const input = ctx.createGain(), output = ctx.createGain();
  const sel = { knock: ctx.createGain(), classic: ctx.createGain(), none: ctx.createGain() };
  for (const [m, g] of Object.entries(sel)) { g.gain.value = m === mode ? 1 : 0; input.connect(g); }

  // classic: today's compressor, as it is (its own makeup kept)
  const classic = ctx.createDynamicsCompressor();
  setParams(classic, CLASSIC_COMPRESSOR);
  sel.classic.connect(classic); classic.connect(output);
  // none: a wire (the meter's)
  sel.none.connect(output);

  // knock: the input trim
  const trim = ctx.createGain();
  trim.gain.value = dbToGain(knock.inputDb);
  sel.knock.connect(trim);
  // Glue: Peak Clip In, the compressor, its built-in makeup taken back out (Makeup 0 dB)
  const peakClip = shapedStage(ctx, peakClipShape, 'none');
  const glue = ctx.createDynamicsCompressor();
  setParams(glue, GLUE);
  const glueOut = ctx.createGain();
  glueOut.gain.value = dbToGain(-chromiumCompressor(GLUE).makeupDb);
  trim.connect(peakClip.input); peakClip.output.connect(glue); glue.connect(glueOut);
  // Tube at its dry/wet
  const dry = ctx.createGain(), wet = ctx.createGain(), tubeSum = ctx.createGain();
  dry.gain.value = 1 - knock.tubeWet; wet.gain.value = knock.tubeWet;
  // not oversampled: Chromium's oversampled WaveShaper delays its output a few samples, which comb-filtered against the
  // dry path (−5.8 dB at 1 kHz, measured); at −15 dB drive the curve is nearly straight, so it aliases very little
  const tube = shapedStage(ctx, (x) => tubeShape(x, { driveDb: knock.tubeDriveDb }), 'none');
  glueOut.connect(dry); glueOut.connect(tube.input); tube.output.connect(wet);
  dry.connect(tubeSum); wet.connect(tubeSum);
  // Saturator: Analog Clip, soft clip, oversampled
  const sat = shapedStage(ctx, saturatorShape, '4x');
  tubeSum.connect(sat.input);
  // the limiter: a stand-in compressor (its makeup taken out) until the worklet is in
  const standIn = ctx.createDynamicsCompressor();
  const standInSettings = { threshold: knock.limiter.ceilingDb - 0.5, knee: 0, ratio: 20, attack: 0, release: knock.limiter.releaseMs / 1000 };
  setParams(standIn, standInSettings);
  const standInOut = ctx.createGain();
  standInOut.gain.value = dbToGain(-chromiumCompressor(standInSettings).makeupDb);
  sat.output.connect(standIn); standIn.connect(standInOut); standInOut.connect(output);

  let limiterNode = null, reduction = 0;
  const ready = (async () => {
    if (!ctx.audioWorklet || typeof AudioWorkletNode !== 'function') return false;
    try {
      await ctx.audioWorklet.addModule(limiterUrl);
      limiterNode = new AudioWorkletNode(ctx, 'composer-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        processorOptions: { ceilingDb: knock.limiter.ceilingDb, lookaheadMs: knock.limiter.lookaheadMs, releaseMs: knock.limiter.releaseMs } });
      limiterNode.port.onmessage = (e) => { if (e.data && Number.isFinite(e.data.reduction)) reduction = e.data.reduction; };
      const fade = ctx.createGain();
      fade.gain.value = 0;
      sat.output.connect(limiterNode); limiterNode.connect(fade); fade.connect(output);
      // crossfade from the stand-in (their delays match within ~0.1 ms: 6 ms lookahead each)
      const t = ctx.currentTime;
      fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(1, t + 0.03);
      standInOut.gain.setValueAtTime(standInOut.gain.value, t); standInOut.gain.linearRampToValueAtTime(0, t + 0.03);
      return true;
    } catch (err) {
      console.warn('[composer master] the limiter worklet did not load; the stand-in compressor stays', err);
      return false;
    }
  })();

  let current = mode;
  return {
    input, output, ready,
    get mode() { return current; },
    setMode(next) {
      if (!MASTER_MODES.includes(next) || next === current) return;
      const t = ctx.currentTime;
      for (const [m, g] of Object.entries(sel)) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(m === next ? 1 : 0, t + 0.03); }
      current = next;
    },
    /** the limiter's gain reduction (dB ≤ 0), about 10 times a second; 0 before the worklet is in */
    limiterReduction: () => reduction,
    nodes: { classic, glue, glueOut, peakClip, tube, dry, wet, sat, standIn, standInOut, trim, sel, get limiter() { return limiterNode; } },
  };
}
