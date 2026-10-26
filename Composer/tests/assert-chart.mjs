// assert-chart.mjs — chord charts in the typed progression field (Composer/CHART_ORDER.md, phase A). Exit non-zero on
// any mismatch.
//   • the reader (core/chart.js): chunk-timeline's notation — bars, shares, holds over a bar line, %, ×n, |: :|, ‖,
//     form charts with a moved section — every chord's place in the text, the errors; spread (Euclid), writeChart
//   • the meter (compose.js chartMeter): the chart's bars (ruling 1), an even split preferred, else Euclid (ruling 3)
//   • Compose with `changes`: a chord a span, the spans covering the cycle, every part inside its span's chord; the
//     typed pins kept per span; one chord a bar = the plain path; the free bar count; a chart with a MIDI target refused
//   • the field (chord-symbols.js): a chart resolved per span against its own materials, a mismatch otherwise, written
//     back as a chart
//   • rearrange: a span's chord swap (the same chord is the spec byte for byte; another rebuilds its bar only)
//   • the controller (phase B): a typed chart before a compose (its bars and chords), Compose with it, a chart of the
//     same shape live, a swap written into the chart (or the chart written out played), another shape waiting for
//     Compose, the alternates per chord
//   node Composer/tests/assert-chart.mjs
import { parseChart, readChart, isChart, spread, evenIn, writeChart, transposeSymbol } from '../core/chart.js';
import { compose, chartMeter, MAX_BARS } from '../core/compose.js';
import { barMaterials, resolveSymbols, progressionOf, pinsToField } from '../core/chord-symbols.js';
import { rearrange, applyRearrange, materialsOf } from '../core/rearrange.js';
import { CHORD_QUALITIES } from '../core/harmony.js';
import { classOfCents } from '../core/frame.js';
import { decodeClip, readMidi, writeMidi } from '../core/midi.js';
import { createComposerController } from '../perform/composer-controller.js';
import { newCompositionState } from '../store/composition-store.js';
import { createComposeRunner } from '../perform/compose-runner.js';
import { answer } from '../core/compose-worker.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const words = (c) => c.spans.map((s) => `${s.bar}:${s.symbol}${s.hold ? '.' : ''}`).join(' ');

console.log('Composer chord charts');

console.log('\n— the reader');
{
  let c = parseChart('| C | G | ×3 ‖ | Am F | G . |');
  check('| C | G | ×3 ‖ | Am F | G . |: 8 bars, the section three times, a bar of two, a held share', c.bars === 8 && words(c) === '0:C 1:G 2:C 3:G 4:C 5:G 6:Am 6:F 7:G' && JSON.stringify(c.changes) === '[[1],[1],[1],[1],[1],[1],[1,1],[1]]' && c.sections.map((s) => s.times).join() === '3,1', words(c));
  check('… each chord keeps its place in the text; a repeat points at the one written', c.spans[0].token.start === 2 && c.spans[2].token.start === 2 && c.spans[7].token.text === 'F' && c.spans[7].token.start === 20);
  c = parseChart('| C . G | . | % | Dm7 G7 C |');
  check('| C . G | . | % | Dm7 G7 C |: 2 + 1 shares, a hold over two bar lines, three to the last bar', JSON.stringify(c.changes) === '[[2,1],[1],[1],[1,1,1]]' && words(c) === '0:C 0:G 1:G. 2:G. 3:Dm7 3:G7 3:C', words(c));
  c = parseChart('|: C G :|×2 | F . G | C |');
  check('|: C G :|×2: the bars inside twice, then the rest', c.bars === 4 && words(c) === '0:C 0:G 1:C 1:G 2:F 2:G 3:C');
  c = parseChart('| C | G :| | Am |');
  check('a :| with no |: before it repeats from the section\'s start', words(c) === '0:C 1:G 2:C 3:G 4:Am');
  c = parseChart('A: | C | G | Am | F |; B: |: Dm | G :|×2\nform: A A+2 B');
  check('a form chart: A, A moved up two (sharps for D), B twice; the sections named', words(c) === '0:C 1:G 2:Am 3:F 4:D 5:A 6:Bm 7:G 8:Dm 9:G 10:Dm 11:G' && c.spans[4].name === 'A+2' && c.spans[5].token.start === 9, words(c));
  check('… no form line: each section once as written', parseChart('A: | C |; B: | G |').bars === 2);
  c = parseChart('| C - | D* G | Am7, D7 |');
  check('the field\'s own marks pass through ("-" auto, "D*" a free quality); a comma is a space', words(c) === '0:C 0:- 1:D* 1:G 2:Am7 2:D7');
  check('transposeSymbol moves a root and a slash bass; a root-less mark stays', transposeSymbol('Am7/G', 2, { sharps: true }) === 'Bm7/A' && transposeSymbol('Bb', 3) === 'Db' && transposeSymbol('-', 5) === '-');
  const errs = [['| . C |', /open on a hold/], ['| C | | G |', /empty bar/], ['| % | C |', /% stands alone/], ['|: C | G |', /never closed/], ['| C :|×1 |', /at least twice/],
    ['| C C C C C C C C C | D D D D D D D D |', /divide into 72/], ['A: | C |; form: A B', /not written/], ['A: | C ‖ G |', /no ‖ inside/]];
  check('the errors, as chunk-timeline words them', errs.every(([t, re]) => re.test(readChart(t).error ?? '')), errs.filter(([t, re]) => !re.test(readChart(t).error ?? '')).map(([t]) => `${t}: ${readChart(t).error}`).join('; '));
  check('isChart: a bar line or a named section; a plain run is not', isChart('| C |') && isChart('C | G') && isChart('A: C G') && !isChart('C G Am F') && !isChart('Bb7, Am7'));
  check('spread: 3 over 8 is 3 3 2; 2 + 1 over 6 is 4 2; one over 8 is 8', JSON.stringify(spread([1, 1, 1], 8).map((x) => x.slots)) === '[3,3,2]' && JSON.stringify(spread([2, 1], 6).map((x) => x.slots)) === '[4,2]' && spread([1], 8)[0].slots === 8);
  check('spread refuses a bar of more shares than slots', throws(() => spread([1, 1, 1], 2), /at least 3 slots/));
  check('evenIn: 6 splits [1,1] and [1,1,1]; 8 does not', evenIn([[1, 1], [1, 1, 1]], 6) && !evenIn([[1, 1], [1, 1, 1]], 8));
  const back = writeChart([['C'], ['C'], ['Am', 'F'], [null], ['G', null, null, 'C']]);
  check(`writeChart: ${back}; read again, the same bars`, back === '| C | % | Am F | . | G . . C |' && JSON.stringify(parseChart(back).changes) === '[[1],[1],[1,1],[1],[3,1]]');
}

console.log('\n— the meter');
{
  const m = chartMeter(400, 8, [[1], [1, 1], [1, 1, 1], [1]]);
  check(`a chart sets the bars; three to a bar takes an even 6 where dense enough (${m.bars} × ${m.slotsPerBar})`, m.bars === 4 && m.slotsPerBar === 6 && m.even && m.spans.length === 7);
  const sparse = chartMeter(20, 8, [[1, 1], [1, 1, 1]]);
  check(`a sparse row: no even split is dense enough, so Compose's slots (raised to the bar of most chords) and Euclid (${sparse.slotsPerBar} slots: ${sparse.spans.map((x) => x.slots).join(' ')})`, !sparse.even && sparse.slotsPerBar === 3 && sparse.spans.map((x) => x.slots).join() === '2,1,1,1,1', JSON.stringify(sparse));
  const asked = chartMeter(400, 8, [[1, 1, 1]], { slotsPerBar: 8 });
  check('a Slots / bar asked is kept, Euclid inside it', asked.slotsPerBar === 8 && asked.spans.map((x) => x.slots).join() === '3,3,2');
  check('… and refused below the most chords a bar holds', throws(() => chartMeter(400, 8, [[1, 1, 1, 1]], { slotsPerBar: 3 }), /at least 4 slots/));
  const twelve = chartMeter(2000, 10, Array.from({ length: 12 }, () => [1]));
  check(`a 12-bar chart: 12 bars, the tempo following (${twelve.tempoBpm.toFixed(0)} BPM)`, twelve.bars === 12 && Math.abs(twelve.tempoBpm - (60 * 12 * 4) / 10) < 1e-9);
}

console.log('\n— Compose with a chart');
const L = [119, 42, 15, 8], T = 8, TEXT = '| C | Am F | G . . C | Dm7 G7 |';
const chart = parseChart(TEXT);
const M = barMaterials(L, T, { seed: 1 }, { changes: chart.changes });
const R = resolveSymbols(TEXT, M);
const spec = compose(L, T, { seed: 1, changes: chart.changes, progression: progressionOf(R) });
{
  const S = spec.knobs.slotsPerBar;
  check(`the chart's bars and spans: ${spec.knobs.bars} × ${S}, ${spec.chords.length} chords`, spec.knobs.bars === 4 && spec.chords.length === 7 && JSON.stringify(spec.knobs.changes) === JSON.stringify(chart.changes) && JSON.stringify(spec.input.changes) === JSON.stringify(chart.changes));
  let at = 0, inBar = true;
  for (const c of spec.chords) { if (c.from !== at || c.from < c.bar * S || c.from + c.slots > (c.bar + 1) * S) inBar = false; at += c.slots; }
  check('… every span in order, inside its bar, the cycle covered', inBar && at === 4 * S);
  check('… "G . . C": three shares and one', spec.chords[3].slots === 6 && spec.chords[4].slots === 2);
  const root = (c) => c.rootTone;
  check('… every typed chord pinned on its root, per span', spec.chords.every((c, i) => c.targeted && root(c) === R.pins[i].ratio), spec.chords.map((c) => `${c.name}${c.targeted ? '' : '?'}`).join(' '));
  check('… a supported quality kept as typed; an unsupported one falls back (flagged amber in the field)', R.perBar.every((b, i) => b.quality.support === 'fallback' ? spec.chords[i].fallback != null || spec.chords[i].quality !== b.pin.quality : spec.chords[i].quality === b.pin.quality),
    R.perBar.map((b, i) => `${b.name}:${b.quality.support}→${spec.chords[i].name}`).join(' '));
  // each chord voice and comping stroke inside its own span, on its own chord's classes
  const chordOfSlot = spec.chords.flatMap((c) => Array.from({ length: c.slots }, () => c));
  const voices = spec.parts.find((p) => p.id === 'chords').notes, comp = spec.parts.find((p) => p.id === 'comp').notes;
  const { row } = materialsOf(spec);
  const onChord = (n) => { const c = chordOfSlot[n.slot], k = classOfCents(row.toneCents[row.tone[n.node]] - row.toneCents[row.tones.indexOf(c.rootTone)]); return Math.abs(k.dev) <= spec.knobs.frameCentsEachSide + 1e-9 && c.intervals.includes(k.pc); };
  check(`the chord voices sound their span's chord (${voices.length} notes)`, voices.length > 0 && voices.every(onChord));
  check(`the comping strikes its span's chord, or its root (${comp.length} strokes)`, comp.every((n) => onChord(n) || chordOfSlot[n.slot].rootNode === n.node));
  check('the decisions say the spans and the even split', spec.decisions.some((d) => d.what === 'changes' && /every bar split evenly/.test(d.why)) && spec.decisions.find((d) => d.what === 'bars').why.includes('chart'));
  check('deterministic: the same chart, the same spec', JSON.stringify(compose(L, T, { seed: 1, changes: chart.changes, progression: progressionOf(R) })) === JSON.stringify(spec));
  const plain = parseChart('| C | F | G | C | Am | F | G | C | C | F | G | C |');
  const p12 = compose(L, T, { seed: 1, changes: plain.changes });
  check('a chart of one chord a bar: its 12 bars, no spans (the plain path)', p12.knobs.bars === 12 && p12.chords.length === 12 && p12.chords.every((c) => c.slots == null));
  const free = compose(L, T, { seed: 1, overrides: { bars: 12 } });
  check('the Bars knob takes any whole number (12 asked: 12 bars)', free.knobs.bars === 12 && free.chords.length === 12);
  check(`… whole and 1..${MAX_BARS} only`, throws(() => compose(L, T, { overrides: { bars: 2.5 } }), /whole number/) && throws(() => compose(L, T, { overrides: { bars: MAX_BARS + 1 } }), /whole number/));
  check('changes are checked', throws(() => compose(L, T, { changes: [[1], []] }), /whole shares/) && throws(() => compose(L, T, { changes: [] }), /bars/));
  const clip = decodeClip(readMidi(writeMidi({ tracks: [{ notes: [{ tick: 0, end: 480, pitch: 60 }, { tick: 480, end: 960, pitch: 62 }] }] })));
  check('a chart with a MIDI target is refused (not built yet)', throws(() => compose(L, T, { changes: chart.changes, target: { clip } }), /not built yet/));
  const odd = compose([11, 9, 7, 5], 6, { seed: 1, changes: parseChart('|: C G :|×2 | F . G | C |').changes });
  check(`a sparse row: the chart's bars, Euclid where the slots are odd (${odd.knobs.slotsPerBar} slots: ${odd.chords.map((c) => c.slots).join(' ')})`, odd.knobs.bars === 4 && odd.chords.length === 7 && odd.chords.reduce((a, c) => a + c.slots, 0) === 4 * odd.knobs.slotsPerBar);
}

console.log('\n— the field');
{
  check(`resolved per span: ${R.perBar.map((b) => b.name).join(' ')}`, R.perBar.length === 7 && R.pins.length === 7 && R.perBar[2].bar === 1 && R.perBar[2].span === 2 && R.perBar.map((b) => b.name).join(' ') === 'C Am F G C Dm7 G7');
  check('… each span read on its own tones (the materials\' units)', M.units.length === 7 && M.spans.length === 7 && M.bars.length === 4);
  check('… the chart\'s tokens marked at their places in the text', R.perBar[1].token.text === 'Am' && TEXT.slice(R.perBar[1].token.start, R.perBar[1].token.end) === 'Am');
  const held = parseChart('| C . G | . |'), Mh = barMaterials(L, T, { seed: 1 }, { changes: held.changes }), Rh = resolveSymbols('| C . G | . |', Mh);
  check('a chord held over a bar line: the same pin again, flagged as a hold', Rh.perBar[2].hold && Rh.pins[2].ratio === Rh.pins[1].ratio && Rh.perBar[2].name === 'G');
  const mis = resolveSymbols('| C | G |', M);
  check('a chart of another shape than the materials: a mismatch (it needs a Compose)', !!mis.mismatch && mis.pins.length === 0 && /Compose/.test(mis.notes[0]));
  check('a chart that cannot be read: its error', /hold/.test(resolveSymbols('| . |', M).chart.error));
  const back = pinsToField(progressionOf(R), M);
  check(`pins → a chart again: ${back}`, back === '| C | Am F | G . . C | Dm7 G7 |');
  const rep = parseChart('|: C G :|×2 | F . G | C |'), Mr = barMaterials(L, T, { seed: 1 }, { changes: rep.changes });
  const backR = pinsToField(progressionOf(resolveSymbols('|: C G :|×2 | F . G | C |', Mr)), Mr);
  check(`… a repeat comes back played out, a bar again as % (${backR})`, backR === '| C G | % | F . G | C |' && JSON.stringify(parseChart(backR).changes) === JSON.stringify(rep.changes));
  const auto = resolveSymbols('| C - | Am F | G . . C | Dm7 G7 |', barMaterials(L, T, { seed: 1 }, { changes: parseChart('| C - | Am F | G . . C | Dm7 G7 |').changes }));
  check('an auto share inside a chart leaves its span to Compose', auto.perBar[1].kind === 'auto' && auto.pins[1] === null);
}

console.log('\n— rearrange');
{
  const { row, cells } = materialsOf(spec);
  const c = spec.chords[2];
  const same = applyRearrange(spec, rearrange(spec, row, cells, { span: 2, chord: { rootTone: c.rootTone, quality: c.quality } }));
  check('a span swapped for its own chord: the spec byte for byte', JSON.stringify(same) === JSON.stringify(spec));
  const q = CHORD_QUALITIES.find((x) => x.id !== c.quality && x.kind === 'triad').id;
  const r = rearrange(spec, row, cells, { span: 2, chord: { rootTone: c.rootTone, quality: q } });
  const moved = Object.values(r.changed).flat();
  check(`another quality on span 3 (bar 2's second chord): only bar 2 rebuilt (${JSON.stringify(r.changed)})`, r.changedBars.join() === '1' && moved.every((b) => b === 1) && r.chords[2].quality === q && r.chords.every((x, i) => i === 2 || x.quality === spec.chords[i].quality));
  check('a bar edit on a split spec is refused (a span names the chord)', throws(() => rearrange(spec, row, cells, { bar: 1, chord: { rootTone: c.rootTone, quality: q } }), /span/));
}

console.log('\n— the controller');
{
  const c = createComposerController({ runCompose: async (l, t, o) => compose(l, t, o), createContext: () => ({}), timers: { setInterval: () => 1, clearInterval: () => {} },
    state: newCompositionState({ layers: [...L], cycleSeconds: T, seed: 1 }) });
  const st = () => c.state;
  let r = await c.setProgressionField(TEXT);
  check('a chart typed before a compose: not live, its bars and chords the editor\'s, the pins Compose\'s', !r.live && c.progressionBars() === 4 && c.progressionUnits() === 7 && st().progression.length === 7 && c.chartShape().bars === 4);
  await c.compose();
  const sp = st().spec;
  check(`Compose sends the chart: ${sp.knobs.bars} bars, ${sp.chords.length} chords, every one pinned (${sp.chords.map((x) => x.name).join(' ')})`, sp.knobs.bars === 4 && sp.chords.length === 7 && sp.chords.every((x) => x.targeted) && !st().dirty);
  check('the field reads back as typed, resolved a chord a span', c.progressionField().text === TEXT && c.progressionField().resolution.perBar.length === 7);
  check('unitsOfBar: bar 2 holds chords 1 and 2', c.unitsOfBar(1).join() === '1,2' && c.unitsOfBar(0).join() === '0');
  const a = c.alternatesOf(2, 'chords');
  check(`the alternates are a chord's (span 3: ${a?.candidates.length} candidates)`, !!a && a.candidates.length > 0 && a.current.name === sp.chords[2].name);
  const alt = a.candidates.find((x) => !x.current);
  r = await c.swapChord(2, alt);
  check(`a swap of a chord written once: written into the chart in place ("${st().field.text}")`, r.ok && st().spec.chords[2].rootTone === alt.root.ratio && st().field.text.startsWith('| C | Am ') && st().field.text.endsWith(' | G . . C | Dm7 G7 |') && !st().dirty);
  await c.undo();
  check('undo: the chart back as typed', st().field.text === TEXT);
  const same = TEXT.replace('Dm7', 'Dm');
  r = await c.setProgressionField(same);
  check('a chart of the same shape is live: a typed chord edit on its span, nothing re-solved', r.live && !st().dirty && st().edits.chords[5]?.from === 'typed');
  // a repeated chord can't be swapped in place: the chart is written out
  const REP = '|: C G :|×2 | F . G | C |';
  await c.setProgressionField(REP);
  check('another shape: not live, the entry dirty, the edits of the old shape dropped', st().dirty && Object.keys(st().edits.chords).length === 0 && c.progressionUnits() === 7);
  await c.compose();
  const b = c.alternatesOf(0, 'chords'), other = b?.candidates.find((x) => !x.current);   // bar 1's C, played again by the repeat
  if (other) {
    await c.swapChord(0, other);
    check(`a swap of a repeated chord: the chart written out played ("${st().field.text}")`, !st().field.text.includes(':|') && JSON.stringify(parseChart(st().field.text).changes) === JSON.stringify(parseChart(REP).changes));
  } else check('a repeated chord has an alternate to swap to', false);
  await c.setProgressionField('C G Am F');
  check('a plain field again: Compose\'s own bars next time (dirty, no changes sent)', st().dirty && c.chartShape() === null);
  await c.compose();
  check('… and Compose makes its own meter', !st().spec.knobs.changes && st().spec.chords.every((x) => x.slots == null));
}

console.log('\n— the runner (the page\'s runCompose): the chart reaches Compose both ways');
{
  class FakeWorker { constructor() { this.onmessage = null; } postMessage(data) { setTimeout(() => this.onmessage?.({ data: structuredClone(answer(structuredClone(data))) }), 0); } }
  const runner = createComposeRunner({ makeWorker: () => new FakeWorker(), defer: (fn) => setTimeout(fn, 0) });
  for (const worker of [false, true]) {
    const c = createComposerController({ runCompose: runner, createContext: () => ({}), timers: { setInterval: () => 1, clearInterval: () => {} }, state: newCompositionState({ layers: [...L], cycleSeconds: T, seed: 1 }) });
    c.state.table = worker ? 'full' : 'lean';
    await c.setProgressionField(TEXT);
    await c.compose();
    const sp = c.state.spec;
    check(`${worker ? 'the worker' : 'this thread'}: the chart's 4 bars and 7 chords, pinned`, c.state.status === 'ready' && sp.knobs.bars === 4 && sp.chords.length === 7 && sp.chords.every((x) => x.targeted), `${c.state.status} ${c.state.error ?? ''} ${sp?.knobs?.bars}×${sp?.chords?.length}`);
    if (worker) {
      // a swap on a big row runs in the worker: its rearrange takes the span too
      const r = await c.swapChord(2, c.alternatesOf(2, 'chords').candidates.find((x) => !x.current));
      check('… and a span swap applies', r.ok && c.state.spec.chords.length === 7);
    }
  }
  const t0 = performance.now(), big = compose([4099, 4093, 4091, 4079], 16, { changes: parseChart('| C | Am F | G . . C | Dm7 G7 | C | F G | Am . F G | C |').changes });
  const ms = performance.now() - t0;
  check(`the 16,359-onset row with an 8-bar chart of split bars: ${big.chords?.length} chords in ${ms.toFixed(0)} ms (lean)`, !big.refused && big.chords.length === 14 && ms < 20000);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
