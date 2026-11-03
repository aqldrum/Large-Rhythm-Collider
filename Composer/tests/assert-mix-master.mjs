// assert-mix-master.mjs — the Composer's mix and master (Composer/MIX_MASTER_ORDER.md): what is pure, in Node.
//   • the rack: composer-master.js' tables against Composer/mix-reference/drms-knock.adg.xml itself — every device's
//     saved values, the macros' values, every macro mapping (the nested rack's folded in), and the macros resolving to
//     the values the rack stores
//   • Chromium's DynamicsCompressor curve and its built-in makeup gain (the two the chain compensates)
//   • the curves: Tube level-neutral at small signals, the Saturator and Peak Clip In linear below their knees and
//     never past their ceilings
//   • the staging table (M2): trim = the drums' trim + target − the probe's median, every part; the high-passes
//   • the duck (M3): its shape, kicks overlapping take the deepest (no stacking), its points booked window by window
//     the same as all at once, and as a curve within 0.05 dB of the shape
//   • the limiter (M4): the true-peak detector (a 4× oversampled peak) and the core: under −1 dBTP on signals far over
//     it, bit-exact below it, its latency
//   • the meter's measures (M1): BS.1770 loudness of a 997 Hz sine, peak and RMS
//   • the player with `mix`: the graph (fader → trim → high-pass → duck → master → chain), the duck booked at the
//     kicks, setMix live; without `mix`, today's graph unchanged
//   • M6: MIDI velocity is the same note for note with the mix on or off, staged or not
//   node Composer/tests/assert-mix-master.mjs
import { readFileSync } from 'node:fs';
import { compose } from '../core/compose.js';
import { createPlayer } from '../perform/composer-player.js';
import { createComposerMidi, MIDI_PARTS } from '../perform/composer-midi.js';
import { DRMS_KNOCK, DRMS_MACROS, macroToParam, resolveMacros, chromiumCompressor, tubeShape, saturatorShape, peakClipShape, softClip, shaperTable, SHAPER_RANGE,
  MIX_STAGING, MIX_TARGETS_LU, MIX_PROBE_MMAX_LU, DRUMS_TRIM_DB, DUCK_DEFAULTS, duckShapeDb, duckGainAt, duckPoints, CLASSIC_COMPRESSOR, GLUE, KNOCK, createMasterChain,
  GLUE_ATTACK_MS, GLUE_RELEASE_S } from '../perform/composer-master.js';
import { createLimiterCore, createTruePeak, truePeakOf, LIMITER_DEFAULTS } from '../perform/composer-limiter.worklet.js';
import { measure, kWeight, PROBE_ROWS, METER_CONFIGS } from '../lab/mix-meter.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const db = (g) => 20 * Math.log10(g);

console.log('Composer mix and master');

// ── the rack ──
console.log('\n— the rack (drms-knock.adg.xml)');
const xml = readFileSync(new URL('../mix-reference/drms-knock.adg.xml', import.meta.url), 'utf8');
/** a device's block (its first occurrence, `<Tag Id=` to `</Tag>`) */
const blockOf = (src, tag, from = 0) => { const a = src.indexOf(`<${tag} Id=`, from); if (a < 0) return null; const b = src.indexOf(`</${tag}>`, a); return { text: src.slice(a, b), at: a }; };
/** a parameter's Manual value inside a block (its first `<Param>`) */
const manualOf = (text, param) => { const a = text.indexOf(`<${param}>`); if (a < 0) return null; const m = /<Manual Value="([^"]*)"/.exec(text.slice(a, text.indexOf(`</${param}>`, a))); return m ? m[1] : null; };
const num = (v) => (v === 'true' ? true : v === 'false' ? false : Number(v));
const flat = [];
for (const d of DRMS_KNOCK.chain) { if (d.chain) flat.push(...d.chain); else flat.push(d); }
let devMiss = '';
for (const d of flat) {
  const b = blockOf(xml, d.device);
  if (!b) { devMiss ||= `${d.device} missing`; continue; }
  if (num(manualOf(b.text, 'On')) !== d.on) devMiss ||= `${d.device} on`;
  for (const [k, v] of Object.entries(d.params)) {
    if (typeof v === 'object') continue;
    const key = { PingPong: 'DelayLine_PingPong', SyncL: 'DelayLine_SyncL', SyncR: 'DelayLine_SyncR', SyncedSixteenthL: 'DelayLine_SyncedSixteenthL', SyncedSixteenthR: 'DelayLine_SyncedSixteenthR', FilterOn: 'Filter_On', FilterFrequency: 'Filter_Frequency', FilterBandwidth: 'Filter_Bandwidth' }[k] ?? k;
    let got = manualOf(b.text, key);
    if (got == null) { const m = new RegExp(`<${key} Value="([^"]*)"`).exec(b.text); got = m ? m[1] : null; }
    if (k === 'SideChain') got = manualOf(b.text.slice(b.text.indexOf('<SideChain>')), 'OnOff');
    if (got == null || (typeof v === 'number' ? !near(num(got), v, 1e-6) : num(got) !== v)) devMiss ||= `${d.device}.${k}: ${got} ≠ ${v}`;
  }
}
check(`every device's saved values, in order (${flat.map((d) => d.device).join(' → ')})`, !devMiss, devMiss);
const order = flat.map((d) => blockOf(xml, d.device).at);
check('the chain in the rack\'s order (the Saturator after the nested rack, in the outer chain)', order.every((a, i) => i === 0 || a > order[i - 1]) && blockOf(xml, 'Saturator').at > xml.indexOf('</GroupDevicePreset>', blockOf(xml, 'FilterEQ3').at));
const eq8 = blockOf(xml, 'Eq8').text, band = eq8.slice(eq8.indexOf('<Bands.1>'), eq8.indexOf('</Bands.1>'));
const pa = band.slice(band.indexOf('<ParameterA>'));
check('EQ Eight (off): its second band, the one "A boost" moves (1726 Hz, +2.38 dB, Q 2.01, a bell)', ['IsOn', 'Mode', 'Freq', 'Gain', 'Q'].every((k, i) => near(num(manualOf(pa, k)), [1, 3, 1726.05444, 2.38095236, 2.01293349][i], 1e-4) || (k === 'IsOn' && manualOf(pa, k) === 'true')));
// the macros: values and mappings
const outer = blockOf(xml, 'AudioEffectGroupDevice');
const macroVal = (text, i) => num(manualOf(text, `MacroControls.${i}`));
check(`the macros' saved values (${DRMS_MACROS.map((m) => `${m.name} ${m.value}`).join(', ')})`, DRMS_MACROS.every((m) => macroVal(outer.text, m.index) === m.value)
  && DRMS_MACROS.every((m) => new RegExp(`<MacroDisplayNames\\.${m.index} Value="${m.name}"`).test(outer.text)));
// every parameter mapped to a macro (KeyMidi on channel 16 = a macro, NoteOrController its index), with its range
const mapped = [];
const deviceTags = ['GlueCompressor', 'Tube', 'Delay', 'Eq8', 'BeatRepeat', 'FilterEQ3', 'Saturator'];
for (const tag of deviceTags) {
  const b = blockOf(xml, tag), re = /<(\w+)>\s*<LomId Value="0" \/>\s*<KeyMidi>[\s\S]*?<Channel Value="16" \/>\s*<NoteOrController Value="(\d+)" \/>[\s\S]*?<\/KeyMidi>\s*<Manual Value="[^"]*" \/>(\s*<MidiControllerRange>\s*<Min Value="([^"]*)" \/>\s*<Max Value="([^"]*)" \/>)?/g;
  let m;
  while ((m = re.exec(b.text))) mapped.push({ device: tag, param: m[1], macro: Number(m[2]), min: m[4] != null ? Number(m[4]) : null, max: m[5] != null ? Number(m[5]) : null });
}
// the nested rack's macros 0–2 are driven by the outer 7–9
const inner = blockOf(xml, 'AudioEffectGroupDevice', outer.at + 10);
const innerMap = {};
for (let i = 0; i < 16; i++) { const t = inner.text.slice(inner.text.indexOf(`<MacroControls.${i}>`), inner.text.indexOf(`</MacroControls.${i}>`)); const m = /<Channel Value="16" \/>\s*<NoteOrController Value="(\d+)"/.exec(t); if (m) innerMap[i] = Number(m[1]); }
check('the nested rack\'s macros (Isolate Mids, Macro 2, Macro 3) driven by Mids Only, Lo Cut, Hi Cut', JSON.stringify(innerMap) === JSON.stringify({ 0: 7, 1: 8, 2: 9 }));
const resolved = mapped.map((m) => ({ ...m, macro: m.device === 'FilterEQ3' ? innerMap[m.macro] : m.macro, param: m.param === 'Freq' ? 'band2.freq' : m.param }));
const listed = DRMS_MACROS.flatMap((m) => m.targets.map((t) => ({ ...t, macro: m.index })));
const same = resolved.length === listed.length && resolved.every((r) => listed.some((l) => l.macro === r.macro && l.device === r.device && l.param === r.param && (r.min == null || (near(l.min, r.min, 1e-6) && near(l.max, r.max, 1e-6)))));
check(`every macro mapping in the XML, and no other (${resolved.length}: ${resolved.map((r) => `${r.macro}→${r.device}.${r.param}`).join(', ')})`, same);
// the macros at their saved values give what the rack stores
const stored = { 'GlueCompressor.Makeup': 0, 'Tube.PreDrive': -15, 'Eq8.band2.freq': 1726.05444, 'Saturator.PreDrive': 0, 'Delay.Feedback': 0, 'Delay.DryWet': 0, 'BeatRepeat.On': false, 'BeatRepeat.InstantRepeat': false, 'BeatRepeat.Grid': 2,
  'FilterEQ3.GainLo': 1, 'FilterEQ3.GainHi': 1, 'FilterEQ3.FreqLo': 877.131042, 'FilterEQ3.FreqHi': 2954.59521 };
const rm = resolveMacros();
check('the macros at their saved values give the stored parameters (Lo Cut 79 → 877.13 Hz, Hi Cut 76 → 2954.6 Hz, A boost 85 → 1726.05 Hz on log curves; Loud 63.5 → Saturator Drive 0 dB)',
  rm.length === Object.keys(stored).length && rm.every((r) => { const v = stored[`${r.device}.${r.param}`]; return typeof v === 'number' ? Math.abs(r.value - v) <= Math.max(1e-6, Math.abs(v) * 1e-6) : r.value === v; }));
check('a macro at its ends: 0 → min, 127 → max (log and linear)', near(macroToParam(0, { min: 50, max: 5000, curve: 'log' }), 50) && near(macroToParam(127, { min: 50, max: 5000, curve: 'log' }), 5000, 1e-9) && near(macroToParam(127, { min: -36, max: 36, curve: 'lin' }), 36));
check('the Glue\'s Attack 0 and Release 0 are its fastest: 0.01 ms and 0.1 s', GLUE_ATTACK_MS[DRMS_KNOCK.chain[0].params.Attack] === 0.01 && GLUE_RELEASE_S[DRMS_KNOCK.chain[0].params.Release] === 0.1 && near(GLUE.attack, 0.00001) && GLUE.release === 0.1 && near(GLUE.threshold, DRMS_KNOCK.chain[0].params.Threshold) && GLUE.ratio === 2);

// ── Chromium's compressor ──
console.log('\n— the DynamicsCompressor\'s curve and its own makeup');
const cl = chromiumCompressor(CLASSIC_COMPRESSOR), gl = chromiumCompressor(GLUE);
check('linear below the threshold', [0.01, 0.1, 0.3].every((x) => near(cl.curve(x), x, 1e-12)));
const sl = (c, x) => (db(c.curve(x * 1.01)) - db(c.curve(x))) / (db(x * 1.01) - db(x));
check('the ratio\'s slope past the knee (1/6 classic, 1/2 Glue)', near(sl(cl, 1), 1 / 6, 1e-3) && near(sl(gl, 1), 1 / 2, 1e-3));
check(`the makeup the node adds by itself: classic +${cl.makeupDb.toFixed(2)} dB (headless Chromium measured +3.81), Glue +${gl.makeupDb.toFixed(2)} dB (a hard knee: 0.6 × 9.52/2)`, near(cl.makeupDb, 3.81, 0.01) && near(gl.makeupDb, 0.6 * 9.52380943 / 2, 1e-3));

// ── the curves ──
console.log('\n— the curves');
const xs = Array.from({ length: 801 }, (_, i) => (i / 400 - 1) * SHAPER_RANGE);
check('Tube: level-neutral at small signals (slope 1 at 0, within 0.1 dB at −40 dBFS), and monotonic', near((tubeShape(1e-6) - tubeShape(-1e-6)) / 2e-6, 1, 1e-6) && Math.abs(db(tubeShape(0.01) / 0.01)) < 0.1 && xs.every((x, i) => i === 0 || tubeShape(x) > tubeShape(xs[i - 1])));
check('Tube: asymmetric (its bias makes even harmonics)', Math.abs(tubeShape(3) + tubeShape(-3)) > 1e-3);
check('Saturator: straight below −3 dBFS, never past 0 dBFS', xs.filter((x) => Math.abs(x) <= 0.7).every((x) => near(saturatorShape(x), x, 1e-12)) && xs.every((x) => Math.abs(saturatorShape(x)) < 1));
check('Peak Clip In: straight below −1 dBFS, never past +1 dBFS', xs.filter((x) => Math.abs(x) <= 0.89).every((x) => near(peakClipShape(x), x, 1e-12)) && xs.every((x) => Math.abs(peakClipShape(x)) < Math.pow(10, 1 / 20)));
check('softClip: continuous with slope 1 at its knee', near(softClip(0.5 + 1e-7, 0.5) - softClip(0.5, 0.5), 1e-7, 1e-12));
const tb = shaperTable(saturatorShape, 4097);
check('a shaper table spans ±SHAPER_RANGE (its input scaled down by it, its output up)', near(tb[2048], 0) && near(tb[4096] * SHAPER_RANGE, saturatorShape(SHAPER_RANGE), 1e-6) && near(tb[0] * SHAPER_RANGE, saturatorShape(-SHAPER_RANGE), 1e-6));

// ── M2: staging ──
console.log('\n— the staging (M2)');
const ids = ['drums', 'bass', 'lead', 'chords', 'comp', 'inner'];
check(`trim = drums' trim + target − the probe's median, to the half dB (${ids.map((id) => `${id} ${MIX_STAGING.trimsDb[id]}`).join(', ')})`, ids.every((id) => near(MIX_STAGING.trimsDb[id], Math.round((DRUMS_TRIM_DB + MIX_TARGETS_LU[id] - MIX_PROBE_MMAX_LU[id]) * 2) / 2)));
check('the targets: the drums the loudest, the chords 10 under, comp 8, inner 9, lead 4, bass 3', MIX_TARGETS_LU.drums === 0 && ids.every((id) => MIX_TARGETS_LU[id] <= 0) && MIX_TARGETS_LU.chords === -10 && MIX_TARGETS_LU.comp === -8 && MIX_TARGETS_LU.inner === -9 && MIX_TARGETS_LU.lead === -4 && MIX_TARGETS_LU.bass === -3);
check('a high-pass on the chords and inner (150 Hz) and the comp (120 Hz); none on the drums, bass or lead', MIX_STAGING.highpassHz.chords === 150 && MIX_STAGING.highpassHz.inner === 150 && MIX_STAGING.highpassHz.comp === 120 && !['drums', 'bass', 'lead'].some((id) => MIX_STAGING.highpassHz[id]));

// ── M3: the duck ──
console.log('\n— the duck (M3)');
const D = DUCK_DEFAULTS;
check(`its shape: 0 dB until ${D.attackMs} ms before the kick, −${D.depthDb} dB at it, held ${D.holdMs} ms, back to 0 over ${D.recoveryMs} ms`, duckShapeDb(-0.0051) === 0 && near(duckShapeDb(0), -D.depthDb) && near(duckShapeDb(0.009), -D.depthDb)
  && near(duckShapeDb(0.01 + 0.06), -D.depthDb / 2, 1e-9) && duckShapeDb(0.13) === 0 && near(duckShapeDb(-0.0025), -D.depthDb / 2, 1e-9));
check('the chords, comp and inner duck; 2–4 dB, about 120 ms back', JSON.stringify(D.parts) === JSON.stringify(['chords', 'comp', 'inner']) && D.depthDb >= 2 && D.depthDb <= 4 && D.recoveryMs === 120);
check('kicks overlapping take the deepest, they don\'t stack', near(db(duckGainAt(0.05, [0, 0.05])), -D.depthDb, 1e-9) && near(db(duckGainAt(0.05, [0])), duckShapeDb(0.05), 1e-9));
const kicks = [0.5, 0.62, 1.0, 1.04, 2.0];
const all = duckPoints(kicks, 0, 3);
const windows = []; for (let t = 0; t < 3; t += 0.15) windows.push(...duckPoints(kicks, t, Math.min(3, t + 0.15)));
check('booked window by window (the player\'s 150 ms lookahead), the same points as all at once', JSON.stringify(windows) === JSON.stringify(all));
check('points ascending, after `from`, up to `to`', all.every(([t], i) => t > 0 && t <= 3 && (i === 0 || t > all[i - 1][0])));
// linear ramps between the points against the shape, every 0.5 ms
let worst = 0;
for (let t = 0.45; t < 2.2; t += 0.0005) {
  const j = all.findIndex(([pt]) => pt >= t); if (j <= 0) continue;
  const [t0, g0] = all[j - 1], [t1, g1] = all[j], g = g0 + (g1 - g0) * (t - t0) / (t1 - t0);
  worst = Math.max(worst, Math.abs(db(g) - db(duckGainAt(t, kicks))));
}
check(`as linear ramps, within 0.05 dB of the shape (worst ${worst.toFixed(3)} dB)`, worst < 0.05);
check('back to unity after the last kick', all.at(-1)[1] === 1 && near(all.at(-1)[0], 2.0 + (D.holdMs + D.recoveryMs) / 1000, 1e-9));

// ── M4: the limiter ──
console.log('\n— the limiter (M4)');
const fs = 48000;
check(`the true-peak detector: a sine at fs/4, 45° off its samples, peaks 0.707 on them and 1.0 between (read ${db(truePeakOf([Float32Array.from({ length: 4800 }, (_, i) => Math.sin(Math.PI * i / 2 + Math.PI / 4))])).toFixed(2)} dB)`,
  Math.abs(db(truePeakOf([Float32Array.from({ length: 4800 }, (_, i) => Math.sin(Math.PI * i / 2 + Math.PI / 4))]))) < 0.2);
check('the detector reports `delay` samples late, and no earlier', (() => { const tp = createTruePeak(); const out = []; for (let i = 0; i < 20; i++) out.push(tp.next(i === 3 ? 1 : 0)); return out.findIndex((v) => v >= 0.999) === 3 + tp.delay; })());
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
const N = fs * 2, x = [new Float32Array(N), new Float32Array(N)];
for (let i = 0; i < N; i++) { const a = (i % 12000) < 2000 ? 3 : 0.3; x[0][i] = a * rnd(); x[1][i] = a * Math.sin(2 * Math.PI * 3000 * i / fs + 1); }
const lim = createLimiterCore({ sampleRate: fs }), y = [new Float32Array(N), new Float32Array(N)];
for (let i = 0; i < N; i += 128) lim.process([x[0].subarray(i, i + 128), x[1].subarray(i, i + 128)], [y[0].subarray(i, i + 128), y[1].subarray(i, i + 128)], 128);
let sp = 0; for (const c of y) for (const v of c) sp = Math.max(sp, Math.abs(v));
const tpo = db(truePeakOf(y));
check(`signals 10 dB over: the samples under the ceiling (${db(sp).toFixed(2)} dBFS), the true peak within 0.1 dB of −1 dBTP (${tpo.toFixed(2)})`, db(sp) <= LIMITER_DEFAULTS.ceilingDb && tpo <= LIMITER_DEFAULTS.ceilingDb + 0.1);
const lat = Math.round(LIMITER_DEFAULTS.lookaheadMs * fs / 1000) + createTruePeak().delay;
check(`its latency: the lookahead (${LIMITER_DEFAULTS.lookaheadMs} ms) and the detector's delay = ${lat} samples`, lim.latency === lat);
const q = [Float32Array.from({ length: 4000 }, (_, i) => 0.5 * Math.sin(i / 7))], qo = [new Float32Array(4000)];
const l2 = createLimiterCore({ sampleRate: fs, channels: 1 }); l2.process(q, qo, 4000);
check('below the ceiling: the input, delayed, bit for bit', qo[0].slice(l2.latency).every((v, i) => v === q[0][i]));
check('linked: one gain for both channels (a loud left pulls the quiet right down with it)', (() => {
  const L = new Float32Array(9600).fill(0), R = new Float32Array(9600).fill(0.1); for (let i = 4000; i < 4100; i++) L[i] = 2;
  const o = [new Float32Array(9600), new Float32Array(9600)]; const c = createLimiterCore({ sampleRate: fs }); c.process([L, R], o, 9600);
  return Math.min(...o[1].slice(4000 + c.latency - 10, 4100 + c.latency)) < 0.1 * 0.5;
})());

// ── M1: the meter's measures ──
console.log('\n— the meter\'s measures (M1)');
const sine = Float32Array.from({ length: fs * 5 }, (_, i) => 0.1 * Math.sin(2 * Math.PI * 997 * i / fs));
const ms = measure([sine], fs);
check(`a 997 Hz sine at −20 dBFS, one channel: −23.0 LUFS integrated and short-term (BS.1770: ${ms.integratedLufs.toFixed(2)}, ${ms.sMaxLufs.toFixed(2)})`, near(ms.integratedLufs, -23.01, 0.1) && near(ms.sMaxLufs, -23.01, 0.1) && near(ms.mMaxLufs, -23.01, 0.1));
check(`… peak −20 dBFS, RMS −23 dBFS (${ms.peakDb.toFixed(2)}, ${ms.rmsDb.toFixed(2)})`, near(ms.peakDb, -20, 0.01) && near(ms.rmsDb, -23.01, 0.02));
const ms2 = measure([sine, sine], fs);
check('the same in both channels: 3 LU louder (the channels\' powers sum)', near(ms2.integratedLufs - ms.integratedLufs, 3.01, 0.02));
check('K-weighting: +4 dB at 10 kHz (the shelf), down at 20 Hz (the high-pass)', (() => {
  const tone = (f) => { const s = Float64Array.from({ length: fs }, (_, i) => Math.sin(2 * Math.PI * f * i / fs)); const w = kWeight(s, fs).slice(fs / 2); return db(Math.sqrt(w.reduce((a, v) => a + v * v, 0) / w.length) * Math.SQRT2); };
  return near(tone(10000), 4, 0.3) && tone(20) < -10;
})());
check('the probe: the 8 rows of the release plan; the configs today, raw, staged, knock, classic staged', PROBE_ROWS.length === 8 && ['today', 'raw', 'staged', 'knock', 'classicStaged'].every((c) => c in METER_CONFIGS) && METER_CONFIGS.today === null);

// ── the player ──
console.log('\n— the player with `mix`');
function makeCtx() {
  const param = (value) => {
    const p = { value, calls: [] };
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = (...a) => { p.calls.push([m, ...a]); if (m === 'setValueAtTime') p.value = a[0]; return p; };
    return p;
  };
  const nodes = [];
  const node = (kind, extra = {}) => { const n = { kind, outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() { this.outs = []; }, ...extra }; nodes.push(n); return n; };
  const ctx = {
    currentTime: 0, sampleRate: 48000, state: 'running', nodes, resume() {},
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'lowpass', frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node('compressor', { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25), reduction: 0 }),
    createWaveShaper: () => node('shaper', { curve: null, oversample: 'none' }),
    createOscillator: () => node('osc', { type: 'sine', frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node('noise', { buffer: null, start() {}, stop() {} }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createPeriodicWave: () => ({}),
  };
  ctx.destination = node('destination');
  return ctx;
}
const spec = compose([8, 7, 6, 5], 4, { seed: 1 }), T = spec.knobs.cycleSeconds;
const parts = spec.parts.map((p) => ({ ...p, enabled: true }));
const drums = { ...spec.drums, enabled: true, kit: { kick: 'made:kick', snare: 'made:snare', hat: 'made:hihat', perc: 'made:perc', cym: 'made:cym' } };
const run = (ctx, player, seconds) => { const end = ctx.currentTime + seconds; while (ctx.currentTime < end) { ctx.currentTime += 0.025; player.tick(); } };

const c0 = makeCtx(), p0 = createPlayer({ ctx: c0, timers: {} });
check('no `mix`: today\'s graph (each bus → master → the compressor → destination), its settings unchanged', p0.chain === null && p0.limiter.kind === 'compressor' && p0.master.outs.includes(p0.limiter) && p0.limiter.outs.includes(c0.destination)
  && Object.entries(CLASSIC_COMPRESSOR).every(([k, v]) => p0.limiter[k].value === v) && p0.mix === null);
p0.play(spec, () => parts, () => drums);
check('… the buses straight into the master', ['lead', 'chords', 'comp', 'bass', 'inner', 'drums'].every((id) => p0.buses[id].outs.length === 1 && p0.buses[id].outs[0] === p0.master));
p0.stop();

const c1 = makeCtx(), p1 = createPlayer({ ctx: c1, timers: {}, mix: { master: 'knock' } });
p1.play(spec, () => parts, () => drums);
const st = p1.stages;
const path = (id) => { const out = []; let n = p1.buses[id]; while (n && n !== p1.master) { out.push(n.kind); n = n.outs[0]; } return n === p1.master ? out.join(' → ') : null; };
check(`the chords: fader → trim → high-pass → duck → master (${path('chords')})`, path('chords') === 'gain → gain → filter → gain');
check('the comp and inner the same; the lead and bass fader → trim → master; the drums too', path('comp') === 'gain → gain → filter → gain' && path('inner') === 'gain → gain → filter → gain' && ['lead', 'bass', 'drums'].every((id) => path(id) === 'gain → gain'));
check('the trims and high-passes at the table\'s values', ids.every((id) => near(db(st[id].trim.gain.value), MIX_STAGING.trimsDb[id], 1e-9)) && ['chords', 'comp', 'inner'].every((id) => st[id].hpf.type === 'highpass' && st[id].hpf.frequency.value === MIX_STAGING.highpassHz[id] && near(st[id].hpf.Q.value, Math.SQRT1_2)));
check('the master → the chain\'s input; its output (the player\'s `limiter`) → the destination', p1.master.outs.includes(p1.chain.input) && p1.limiter === p1.chain.output && p1.chain.output.outs.includes(c1.destination));
check('the level faders start at the player\'s default, as before (the trims are not the faders)', ids.every((id) => p1.buses[id].gain.value === 0.8));
run(c1, p1, T * 2);
const kickAt = drums.hits.filter((h) => h.voice === 'kick').map((h) => p1.loopStart + h.time);
const ramps = (g) => g.gain.calls.filter((c) => c[0] === 'linearRampToValueAtTime');
const deep = (g) => ramps(g).filter((c) => near(db(c[1]), -D.depthDb, 1e-6)).map((c) => c[2]);
const duckHits = deep(st.chords.duck);
check(`the duck: down −${D.depthDb} dB at every kick of the first cycle (${kickAt.length} kicks), booked as the drums are`, kickAt.every((k) => duckHits.some((t) => near(t, k, 1e-9))));
check('… the same points on the chords, comp and inner', JSON.stringify(ramps(st.chords.duck)) === JSON.stringify(ramps(st.comp.duck)) && JSON.stringify(ramps(st.comp.duck)) === JSON.stringify(ramps(st.inner.duck)));
check('… booked in time order (each a ramp from the one before), never before the play', ramps(st.chords.duck).every((c, i, a) => c[2] >= p1.loopStart - 0.006 && (i === 0 || c[2] > a[i - 1][2])));
check('… the second cycle too (the loop)', kickAt.every((k) => duckHits.some((t) => near(t, k + T, 1e-9))));
const nBefore = ramps(st.chords.duck).length;
p1.setMix({ duck: false });
run(c1, p1, T);
check('setMix({ duck: false }): nothing more booked, the gain back to 1', ramps(st.chords.duck).length === nBefore && st.chords.duck.gain.calls.at(-1)[0] === 'setValueAtTime' && st.chords.duck.gain.calls.at(-1)[1] === 1);
p1.setMix({ staging: false });
check('setMix({ staging: false }): the trims to 0 dB, the high-passes down to 10 Hz', ids.every((id) => st[id].trim.gain.calls.at(-1)[1] === 1) && ['chords', 'comp', 'inner'].every((id) => st[id].hpf.frequency.calls.at(-1)[1] === 10));
p1.setMix({ master: 'classic' });
check('setMix({ master: \'classic\' }): crossfades to today\'s compressor', p1.mix.master === 'classic' && p1.chain.nodes.sel.classic.gain.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 1) && p1.chain.nodes.sel.knock.gain.calls.some((c) => c[0] === 'linearRampToValueAtTime' && c[1] === 0));
p1.stop();

// the chain alone
const c2 = makeCtx(), ch = createMasterChain(c2, { mode: 'knock' });
const ready = await ch.ready;
check('no AudioWorklet in the context: the stand-in compressor stays (ready → false), its makeup taken out', ready === false && near(db(ch.nodes.standInOut.gain.value), -chromiumCompressor({ threshold: KNOCK.limiter.ceilingDb - 0.5, knee: 0, ratio: 20 }).makeupDb, 1e-9));
check('knock: the Glue at the rack\'s settings, its built-in makeup taken back out; the Tube 60 % wet; the input trim', near(ch.nodes.glue.threshold.value, GLUE.threshold) && ch.nodes.glue.ratio.value === 2 && near(db(ch.nodes.glueOut.gain.value), -gl.makeupDb, 1e-9)
  && near(ch.nodes.wet.gain.value, 0.6031746268) && near(ch.nodes.dry.gain.value, 1 - 0.6031746268) && near(db(ch.nodes.trim.gain.value), KNOCK.inputDb, 1e-9));
check('the Saturator 4× oversampled; the Tube not (its dry path would comb against the oversampler\'s delay)', ch.nodes.sat.shaper.oversample === '4x' && ch.nodes.tube.shaper.oversample === 'none');
check('one mode heard at a time', ch.nodes.sel.knock.gain.value === 1 && ch.nodes.sel.classic.gain.value === 0 && ch.nodes.sel.none.gain.value === 0);

// ── M6: MIDI velocity apart from the mix ──
console.log('\n— M6: MIDI velocity is kept apart from the mix');
const recorder = (name) => { const sent = []; return { name, id: name, sent, send(bytes, ts) { sent.push({ bytes: [...bytes], ts }); } }; };
function midiOf(mix, levels = null) {
  const ctx = makeCtx(), now = () => ctx.currentTime * 1000;
  const ports = Object.fromEntries(MIDI_PARTS.map((id) => [id, recorder(id)]));
  const sink = createComposerMidi({ now });
  sink.setPorts(ports); sink.setEnabled(true);
  for (const p of Object.values(ports)) p.sent.length = 0;
  const player = createPlayer({ ctx, timers: {}, midi: sink, now, mix });
  if (levels) for (const [id, v] of Object.entries(levels)) player.setLevel(id, v);
  player.play(spec, () => parts, () => drums);
  run(ctx, player, T * 2);
  if (mix) { player.setMix({ staging: false, duck: false, master: 'none' }); run(ctx, player, T); player.setMix({ staging: true, duck: true, master: 'knock' }); run(ctx, player, T); } else run(ctx, player, 2 * T);
  player.stop();
  return Object.fromEntries(Object.entries(ports).map(([id, p]) => [id, p.sent.map((m) => [...m.bytes, Math.round(m.ts * 1e6)])]));
}
const plain = midiOf(null), staged = midiOf({ master: 'knock' });
const ons = (rec) => Object.values(rec).flat().filter((b) => (b[0] & 0xF0) === 0x90 && b[2] > 0);
check(`with the mix (staged, ducked, the knock chain, switched live): every MIDI message the same, velocity included (${ons(plain).length} note-ons)`, ons(plain).length > 0 && JSON.stringify(plain) === JSON.stringify(staged));
const lv = { lead: 0.5, chords: 0.3, comp: 0.9, bass: 1, inner: 0.2, drums: 0.6 };
const plainLv = midiOf(null, lv), stagedLv = midiOf({ master: 'knock' }, lv);
check('… and with the level faders moved: the faders still scale the velocity (CLEAN_MIDI_ORDER M4), the same with the mix or without', JSON.stringify(plainLv) === JSON.stringify(stagedLv) && JSON.stringify(plainLv) !== JSON.stringify(plain));

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
