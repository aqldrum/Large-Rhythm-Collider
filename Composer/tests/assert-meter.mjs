// assert-meter.mjs — METER_TEMPO_ORDER.md: Compose's meter from the layers' factors, the bar's beats from the meter,
// and the seed tempo from the finished composition's density (core/meter.js; compose.js, drums.js, composer-midi.js,
// the controller).
//   • the shapes: 4 / 8 / 16 in 4/4, 3 in 3/4, multiples of 3 in S/8 beats of 3, odd S as 2s then a 3; none under 3
//   • the weights: they sum to 1; every candidate holds 3 onsets a slot and ≤ 64 slots; odd only on a layer carrying
//     it, and held to ODD_SHARE; a row with no shared factor mostly binary; a row of 3s mostly ternary
//   • Compose: the meter and the seed tempo never read the cycle; a new seed may move the meter; the meter's draw is
//     its own (asked the same meter, the lead and the chords are the cycle path's); the knobs carry the shape
//   • the seed tempo: the finished spec's distinct attacks at the drawn goal, clamped; seedTempoOf / heardScaleOf
//   • the drums under 2, 3, 4, 5 beats; 4, 8, 16 as the 4-cut's; the fill from beat ⌈b/2⌉ + 1
//   • MIDI: the time signature and the quarter tempo; the controller's tempo starts at the seed; the trace
//   node Composer/tests/assert-meter.mjs
import { compose, chooseMeter, chartMeter, seedTempoOf, heardScaleOf, gateTempoOf, BEATS_PER_BAR } from '../core/compose.js';
import { meterShape, meterCandidates, affinityOf, attacksOf, tempoForDensity, playFactorOf, ODD_SHARE, ODD_SLOTS, MAX_METER_SLOTS, DENSITY_GOAL, SEED_TEMPO_RANGE } from '../core/meter.js';
import { arrangeDrums, beatsOf } from '../core/drums.js';
import { onsetCount } from '../core/row.js';
import { midiFileOf } from '../perform/composer-midi.js';
import { readMidi } from '../core/midi.js';
import { createLabController } from '../perform/composer-controller.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = JSON.stringify, near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const ROWS = [[41, 42, 43], [8, 7, 6, 5], [19, 17, 16, 15], [119, 42, 15, 8], [768, 769], [30, 21, 10], [35, 25, 14], [13, 11, 7], [16, 12, 9], [97, 103, 37], [64, 48, 36, 27]];

console.log('═══ COMPOSER — the meter from the layers, the tempo from the density ═══');

console.log('\n— the shapes');
{
  const want = { 3: [[1, 1, 1], [3, 4], 3], 4: [[1, 1, 1, 1], [4, 4], 4], 5: [[2, 3], [5, 8], 2.5], 6: [[3, 3], [6, 8], 3], 7: [[2, 2, 3], [7, 8], 3.5], 8: [[2, 2, 2, 2], [4, 4], 4],
    9: [[3, 3, 3], [9, 8], 4.5], 10: [[2, 2, 2, 2, 2], [5, 4], 5], 11: [[2, 2, 2, 2, 3], [11, 8], 5.5], 12: [[3, 3, 3, 3], [12, 8], 6], 15: [[3, 3, 3, 3, 3], [15, 8], 7.5], 16: [[4, 4, 4, 4], [4, 4], 4] };
  let bad = '';
  for (const [S, [beats, sig, Q]] of Object.entries(want)) { const m = meterShape(+S); if (J(m.beats) !== J(beats) || J(m.timeSig) !== J(sig) || m.quartersPerBar !== Q || m.beatsPerBar !== beats.length) bad ||= `${S}: ${J(m)}`; }
  check('6 is 6/8 (3 + 3), 9 9/8, 12 12/8, 15 15/8; 5 is 2 + 3, 7 2 + 2 + 3; 4, 8, 16 4/4; 3 3/4', !bad, bad);
  check('under 3 slots there is no shape (the 4/4 of before)', meterShape(2) === null && meterShape(1) === null);
}

console.log('\n— the weights');
{
  check('a layer sits on a meter it divides (or that divides it) fully, on one it shares no factor with not at all', affinityOf([6], 1, 6) === 1 && affinityOf([12], 1, 6) === 1 && affinityOf([7], 4, 8) === 0);
  let sums = '', dense = '', odd = '', share = '';
  for (const L of ROWS) {
    const n = onsetCount(L), c = meterCandidates(n, L), total = c.reduce((a, x) => a + x.weight, 0), oddW = c.filter((x) => ODD_SLOTS.includes(x.slotsPerBar)).reduce((a, x) => a + x.weight, 0);
    if (!near(total, 1, 1e-9)) sums ||= `${L.join(':')}: ${total}`;
    if (c.some((x) => x.onsetsPerSlot < 3 - 1e-9 || x.bars * x.slotsPerBar > MAX_METER_SLOTS)) dense ||= L.join(':');
    if (c.some((x) => ODD_SLOTS.includes(x.slotsPerBar) && !L.some((v) => v % x.slotsPerBar === 0))) odd ||= L.join(':');
    if (oddW > ODD_SHARE + 1e-9) share ||= `${L.join(':')}: ${oddW.toFixed(3)}`;
  }
  check(`the weights sum to 1 (${ROWS.length} rows)`, !sums, sums);
  check('every candidate holds 3 onsets a slot and at most 64 slots', !dense, dense);
  check('an odd meter only on a layer carrying its factor', !odd, odd);
  check(`odd meters together at most ${ODD_SHARE * 100} % of the draw`, !share, share);
  const fam = (L) => { const c = meterCandidates(onsetCount(L), L), w = (f) => c.filter((x) => f(x.slotsPerBar)).reduce((a, x) => a + x.weight, 0); return { bin: w((S) => [4, 8, 16].includes(S)), ter: w((S) => S % 3 === 0) }; };
  const none = fam([4099, 4093, 4091, 4079]), threes = fam([30, 21, 10]);
  check(`no shared factor (4099:4093:4091:4079): mostly binary (${(100 * none.bin).toFixed(0)} %)`, none.bin >= 0.7);
  check(`a row of 3s (30:21:10): mostly ternary (${(100 * threes.ter).toFixed(0)} %)`, threes.ter > 0.5 && threes.ter > threes.bin);
  check('asked bars and slots narrow the candidates to them', meterCandidates(500, [41, 42, 43], { bars: 2 }).every((x) => x.bars === 2) && meterCandidates(500, [41, 42, 43], { slotsPerBar: 7 }).every((x) => x.slotsPerBar === 7));
}

console.log('\n— Compose');
const specs = [];
for (const L of ROWS.slice(0, 8)) for (const seed of [1, 2, 3]) specs.push({ L, seed, spec: compose(L, 8, { seed }) });
{
  let moved = '';
  for (const { L, seed, spec } of specs.slice(0, 9)) {
    const other = compose(L, 5.5, { seed }), k = spec.knobs, o = other.knobs;
    if (k.bars !== o.bars || k.slotsPerBar !== o.slotsPerBar || J(k.beats) !== J(o.beats) || spec.seedTempo.bpm !== other.seedTempo.bpm) moved ||= `${L.join(':')} seed ${seed}`;
  }
  check('the meter and the seed tempo never read the cycle (8 s and 5.5 s alike)', !moved, moved);
  const meters = new Set(); for (let seed = 1; seed <= 10; seed++) { const k = compose([41, 42, 43], 8, { seed }).knobs; meters.add(`${k.bars}x${k.slotsPerBar}`); }
  check(`a new seed may move the meter (41:42:43 over 10 seeds: ${[...meters].join(' ')})`, meters.size >= 3);
  const s = specs[0].spec, k = s.knobs;
  check('the knobs carry the shape: beats, beats a bar, the time signature, quarters a bar', J(k.beats) === J(meterShape(k.slotsPerBar).beats) && k.beatsPerBar === k.beats.length && J(k.timeSig) === J(meterShape(k.slotsPerBar).timeSig) && k.quartersPerBar === meterShape(k.slotsPerBar).quartersPerBar);
  check('the natural tempo is 60·N·b / T', near(k.tempoBpm, (60 * k.bars * k.beatsPerBar) / k.cycleSeconds));
  check('the meter, the beats and the seed tempo are decided, with why', ['bars', 'slotsPerBar', 'beats', 'tempoBpm', 'seedTempo'].every((w) => s.decisions.some((d) => d.what === w && d.why)));
  // the meter's draw has its own generator: asked the meter, the lead and the chords are the cycle path's
  let drift = '';
  for (const { L, seed, spec } of specs.filter((_, i) => i % 3 === 0)) {
    const ov = { bars: spec.knobs.bars, slotsPerBar: spec.knobs.slotsPerBar }, a = compose(L, 8, { seed, overrides: ov }), b = compose(L, 8, { seed, overrides: { ...ov, meterFrom: 'cycle' } });
    const part = (x, id) => J(x.parts.find((p) => p.id === id).notes);
    if (part(a, 'lead') !== part(b, 'lead') || J(a.chords) !== J(b.chords) || J(a.knobs.phase) !== J(b.knobs.phase)) drift ||= `${L.join(':')} seed ${seed}`;
  }
  check('the meter\'s draw is its own: asked the same meter, the phase, the lead and the chords are the cycle path\'s', !drift, drift);
  const old = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { meterFrom: 'cycle' } });
  check('meterFrom \'cycle\': no beats knobs, no seed tempo, 4 beats a bar, the cycle\'s tempo', !('beats' in old.knobs) && !old.seedTempo && old.knobs.beatsPerBar === BEATS_PER_BAR && seedTempoOf(old) === old.knobs.tempoBpm);
  let threw = 0; for (const f of [() => compose([8, 7, 6, 5], 4, { overrides: { meterFrom: 'tempo' } }), () => chooseMeter(22, 4, {}), () => chooseMeter(22, 4, { from: 'x', layers: [8, 7, 6, 5] })]) { try { f(); } catch { threw++; } }
  check('a bad meterFrom is an error; a meter from the layers needs them', threw === 3);
  const cm = chartMeter(500, 8, [[1], [1, 1, 1], [1], [1]], { layers: [119, 42, 15, 8] });
  check(`a chord chart's meter keeps its bars, its tempo counts its beats (${cm.bars} × ${cm.slotsPerBar})`, cm.bars === 4 && near(cm.tempoBpm, (60 * 4 * (cm.shape ? cm.shape.beatsPerBar : 4)) / 8));
}

console.log('\n— the seed tempo');
{
  let bad = '';
  for (const { L, seed, spec } of specs) {
    const t = spec.seedTempo, k = spec.knobs, D = attacksOf(spec), want = tempoForDensity(t.goal, D, k.bars, k.beatsPerBar);
    if (t.attacks !== D || Math.abs(want.bpm - t.bpm) > 0.11 || t.bpm < SEED_TEMPO_RANGE[0] || t.bpm > SEED_TEMPO_RANGE[1] || t.goal < DENSITY_GOAL[0] || t.goal > DENSITY_GOAL[1]) bad ||= `${L.join(':')} seed ${seed}: ${J(t)} vs ${J(want)} (${D})`;
    if (!t.clamped && Math.abs(t.perSecond - t.goal) > 0.02) bad ||= `${L.join(':')} seed ${seed}: ${t.perSecond}/s, goal ${t.goal}`;
  }
  check(`${specs.length} composes: the finished spec's distinct attacks at the drawn goal (5–8 a second), held to 70–150 BPM`, !bad, bad);
  const clamped = specs.filter((x) => x.spec.seedTempo.clamped).length;
  console.log(`    (${clamped} of ${specs.length} held at the range's edge)`);
  const s = specs[1].spec;
  check('playback starts at the seed tempo; the gate is heard at the provisional one', seedTempoOf(s) === s.seedTempo.bpm && gateTempoOf(s) === s.seedTempo.gateBpm && near(heardScaleOf(s), s.seedTempo.gateBpm / s.knobs.tempoBpm) && near(playFactorOf(s), s.knobs.tempoBpm / s.seedTempo.bpm));
  const noDrums = compose([119, 42, 15, 8], 8, { seed: 1, drums: false });
  check('without drums the attacks are the parts\' alone', noDrums.seedTempo.attacks === attacksOf(noDrums) && noDrums.seedTempo.attacks <= specs.find((x) => x.L.join() === '119,42,15,8' && x.seed === 1).spec.seedTempo.attacks);
}

console.log('\n— the drums under the beats');
{
  const pos = (d, voice) => d.hits.filter((h) => h.voice === voice && h.bar === 0 && !d.bars[0].fill && !d.bars[0].crash).map((h) => h.pos);
  const cases = [[5, [0], [2]], [6, [0], [3]], [7, [0], [2, 4]], [9, [0], [3, 6]], [12, [0, 6], [3, 9]], [15, [0, 6], [3, 9, 12]]];
  let bad = '';
  for (const [S, kicks, snares] of cases) {
    const spec = compose([119, 42, 15, 8], 8, { seed: 1, overrides: { bars: 2, slotsPerBar: S }, drums: { fills: false } }), d = spec.drums;
    if (J(d.beats.sizes) !== J(meterShape(S).beats)) bad ||= `${S}: beats ${J(d.beats.sizes)}`;
    const k = pos(d, 'kick'), sn = pos(d, 'snare');
    if (J(k) !== J(kicks) || J(sn) !== J(snares)) bad ||= `${S}: kick ${J(k)} snare ${J(sn)}`;
  }
  check('kick, snare in pairs over the beats, an odd last a snare: 5/8 K S, 6/8 K S, 7/8 K S S, 9/8 K S S, 12/8 K S K S, 15/8 K S K S S', !bad, bad);
  let same = '';
  for (const S of [4, 8, 16]) {
    const spec = compose([768, 769], 8, { seed: 2, overrides: { bars: 4, slotsPerBar: S } }), cut = { ...spec, knobs: { ...spec.knobs } };
    delete cut.knobs.beats;
    for (const mode of ['backbeat', 'with', 'against', 'rock', 'funk', 'shuffle']) if (J(arrangeDrums(spec, { mode }).hits) !== J(arrangeDrums(cut, { mode }).hits)) same ||= `${S} ${mode}`;
  }
  check('in 4, 8 and 16 the meter\'s beats are the 4-cut\'s: the same strokes, every mode', !same, same);
  const f = compose([768, 769], 8, { seed: 2, overrides: { bars: 2, slotsPerBar: 9 }, drums: { fillBars: [1] } }).drums, fb = f.bars.find((b) => b.fill);   // 9 slots: phrases of 3 bars, so the fill is asked
  const fillStrokes = f.hits.filter((h) => h.bar === fb.bar && (h.voice === 'snare' || h.voice === 'kick'));
  check(`the fill runs from beat ⌈b/2⌉ + 1 (9/8: beat 3, slot ${f.beats.fillFrom})`, f.beats.fillFrom === 6 && fillStrokes.some((h) => h.pos >= 6) && fillStrokes.every((h) => h.pos < 6 ? h.pos === 0 || h.pos === 3 : true));
  check('the step grid is whole slots under the meter\'s beats (3 slots: 3 places, not 6)', beatsOf(3, [1, 1, 1]).m === 1 && beatsOf(3).m === 2);
}

console.log('\n— MIDI');
{
  let bad = '';
  for (const { L, seed, spec } of specs.filter((_, i) => i % 2 === 0)) {
    const k = spec.knobs, file = readMidi(midiFileOf(spec, spec.parts, spec.drums)), sig = file.timeSigs[0], qpm = 60e6 / file.tempos[0].usPerQuarter;
    const wantQ = spec.seedTempo.bpm * k.quartersPerBar / k.beatsPerBar;
    if (sig.num !== k.timeSig[0] || sig.den !== k.timeSig[1] || Math.abs(qpm - wantQ) > 0.01) bad ||= `${L.join(':')} seed ${seed}: ${sig.num}/${sig.den} ${qpm.toFixed(2)} vs ${k.timeSig.join('/')} ${wantQ}`;
    const tick = (sec) => Math.round(sec * (k.tempoBpm * k.quartersPerBar / k.beatsPerBar / 60) * 480);
    if (spec.timeline.barStarts.length > 1 && Math.abs(tick(spec.timeline.barStarts[1] - spec.timeline.barStarts[0]) - k.quartersPerBar * 480) > k.quartersPerBar * 480 * 0.5) bad ||= `${L.join(':')}: a bar is not ${k.quartersPerBar} quarters`;
  }
  check('the file says the meter\'s time signature and the seed tempo in quarters (a 6/8 beat is 1½ quarters)', !bad, bad);
}

console.log('\n— the controller');
{
  const timers = { setInterval: () => 1, clearInterval: () => {} }, lab = createLabController({ createContext: () => ({ state: 'running' }), timers });
  lab.loadPreset(1);
  const N = lab.progressionBars();
  await lab.compose();
  const s = lab.state.spec;
  check(`Compose seeds the tempo from the density (${s.seedTempo.bpm} BPM, the spec's own ${s.knobs.tempoBpm.toFixed(1)})`, lab.tempo() === s.seedTempo.bpm && near(lab.tempoFactor(), s.knobs.tempoBpm / s.seedTempo.bpm));
  check(`the progression editor's bars before Compose are Compose's (${N})`, N === s.knobs.bars);
  lab.setTempo(100); lab.resetTempo();
  check('Reset goes back to the seed tempo', lab.tempo() === s.seedTempo.bpm);
  lab.setKnob('meterFrom', 'cycle');
  await lab.compose();
  check('the meterFrom knob: \'cycle\' composes the meter of before, at the cycle\'s tempo', !lab.state.spec.seedTempo && lab.tempo() === lab.state.spec.knobs.tempoBpm && lab.tempoFactor() === 1);
}

console.log('\n— the trace');
{
  const t = compose([41, 42, 43], 8, { seed: 2, trace: true }), ev = t.trace.events, m = ev.find((e) => e.kind === 'meter'), done = ev.find((e) => e.kind === 'done');
  check(`the meter event says it came from the layers, in ${m.timeSig.join('/')}; the end says the seed tempo`, m.from === 'layers' && J(m.timeSig) === J(t.knobs.timeSig) && m.bars === t.knobs.bars && done.seedTempoBpm === t.seedTempo.bpm);
  const plain = compose([41, 42, 43], 8, { seed: 2 }), { trace: _t, ...rest } = t;
  check('the trace still only observes: the spec without it is the spec', J(rest) === J(plain));
}

console.log(`\n${PASS ? '✓' : '✗'} ${checks} meter checks ${PASS ? 'pass' : 'FAILED'}`);
process.exit(PASS ? 0 : 1);
