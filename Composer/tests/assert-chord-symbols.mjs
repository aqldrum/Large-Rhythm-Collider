// assert-chord-symbols.mjs — Composer/core/chord-symbols.js (the typed progression field, step 4b) and the object form
// of a progression in Composer/core/progression.js. Exit non-zero on any mismatch.
//   • the parser against the site's own ProgressionSolver.parseChordSymbol (loaded in a vm, as site-scripts.mjs loads
//     the site's scripts), over every root spelling × a broad suffix list × slash basses, and the field's tokens
//   • quality pins: chooseChordOnRoot keeps a supported asked quality (whole, one class short, a fallback dyad) and
//     falls back exactly as before otherwise; readProgression's object form; harmonyPins' identity and its seam
//   • the ratio form's identity: targeted specs hashed with the progression.js of b69a39e (before 4b), byte for byte;
//     `{ ratio, quality: null }` the same spec as `{ ratio }`
//   • barMaterials: the knobs, the cells and the bars' tones Compose builds for the same knobs (overrides and seeds, or a
//     spec's own knobs), the bars' tones those harmonize reads (each pinned chord's support re-derived from them)
//   • resolution: supported (✓, one class short), off the frame with modulation on (Compose retunes there) and off
//     (kept, offGrid, never snapped), a class the row lacks (the nearest cluster at any offset), an unsupported
//     quality (Compose's fallback), a symbol the Composer has no quality for, extras and shortfall, errors; and every
//     resolved field composed: the roots kept, the supported qualities kept, the unsupported ones not
//   • the display helpers: pins → field → pins and field → pins → field, the lab's pick kept through `keep`
//   • timing: barMaterials and resolveSymbols on small rows and the 16,359-onset row
//   node Composer/tests/assert-chord-symbols.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './site-scripts.mjs';
import { parseChordSymbol, tokenizeField, readToken, AUTO_TOKENS, barMaterials, resolveSymbols, progressionOf, pinsToField, fieldToPins, qualityOfIntervals } from '../core/chord-symbols.js';
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { classOfCents, clusterPresence } from '../core/frame.js';
import { compose } from '../core/compose.js';
import { CHORD_QUALITIES, PC_NAMES, harmonize } from '../core/harmony.js';
import { chooseChordOnRoot, readProgression, harmonyPins, qualityById, FALLBACK_QUALITIES } from '../core/progression.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const E = 15;
/** a spec without its input's progression (the object and ratio forms record what was asked) */
const sansAsk = (spec) => { const s = JSON.parse(JSON.stringify(spec)); delete s.input.progression; return s; };

// targeted composes in the ratio form, and their specs' sha256 as the progression.js of b69a39e made them (before 4b;
// one Node/V8 build, as settle-baseline.mjs: regenerate there if a Node upgrade moves a float)
const RATIO_CASES = [
  ['119:42:15:8 four roots', [119, 42, 15, 8], 8, { seed: 1, progression: ['1/1', '3/2', null, '5/3'] }],
  ['119:42:15:8 four roots seed 7', [119, 42, 15, 8], 8, { seed: 7, progression: ['1/1', '3/2', null, '5/3'] }],
  ['119:42:15:8 objects, off-frame', [119, 42, 15, 8], 8, { seed: 1, progression: ['8/5', { ratio: '1/1' }, '15/13', '6/5'] }],
  ['119:42:15:8 mod off', [119, 42, 15, 8], 8, { seed: 1, overrides: { modulation: false }, progression: ['15/13', '5/3', '1/1', '3/2'] }],
  ['119:42:15:8 traced', [119, 42, 15, 8], 8, { seed: 3, trace: true, progression: [null, '5/4', '1/1'] }],
  ['8:7:6:5', [8, 7, 6, 5], 4, { seed: 1, progression: ['1/1', '3/2'] }],
  ['11:9:7:5 too long, not of the row', [11, 9, 7, 5], 6, { seed: 2, progression: ['1/1', '9/7', '5/4', '7/5', '11/9', '3/2', '9/5', '1/1', '9/8'] }],
  ['41:42:43 worker', [41, 42, 43], 8, { worker: true, progression: ['1/1', null, '43/42'] }],
];
const RATIO_HASHES = {
  '119:42:15:8 four roots': '47d6854851da107cb6fc68e45c0d6839fc2262f91ea995ef6acddcefcf9b6a1f',
  '119:42:15:8 four roots seed 7': '414f21582ff0dcc20fb3cf112246b89ede3a7137e274a4099dfff28e0c0419ff',
  '119:42:15:8 objects, off-frame': 'b6d1b995dc8cef6532573f28cf22972573d3470e26b354715bd28d5ddcfab56d',
  '119:42:15:8 mod off': 'b41ba340dad256c5cdb121f6e197f06f29517026c9fb4c3aeebdd255b8f47ae7',
  '119:42:15:8 traced': 'a0657915994b73d9c0eeeea099c9b14aadd8eaf3c9a5979a175f9f3f86caa62b',
  '8:7:6:5': 'aace29ef892b91a94174319a0b4a80d034d35467179281cf381d03358d614166',
  '11:9:7:5 too long, not of the row': '013bb7f557624fcc61b68a2863f89dde88817ddf67b271419efd34f4317998f9',
  '41:42:43 worker': '31f0b5457d4f593306bb246d9e62dd31375668117fba52577f64070a3db00efa',
};

/** the site's parser, as the page loads it: a classic script that hangs ProgressionSolver on its global */
function siteSolver() {
  const file = 'Playback/AdvancedPlayback/ProgressionSolver.js', sandbox = { Math, Number, String, Array, Object, Set, Map, JSON };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  return sandbox.ProgressionSolver;
}
const site = siteSolver();

console.log('Composer chord symbols');

console.log('\n— the parser, against the site\'s');
{
  const roots = [];
  for (const L of 'ABCDEFGabcdefg') for (const a of ['', '#', 'b', '##', 'bb', '♯', '♭', '𝄪', '𝄫', '#b']) roots.push(L + a);
  const suffixes = ['', 'm', 'maj', 'M', 'min', 'mi', 'maj7', 'M7', 'Δ', 'Δ7', '∆9', '7', 'm7', '−7', '–7', '-7', 'm7b5', 'ø', 'ø7', '°', '°7', 'o7', 'dim', 'dim7',
    'halfdim', 'aug', '+', '+7', 'aug7', '7#5', '7b5', 'sus', 'sus2', 'sus4', '7sus4', '9sus4', '13sus4', '5', 'no3', 'no5', 'mno5', 'no3no5', 'omit3', '7no5',
    '6', 'm6', '69', '6/9', 'm6/9', 'add9', 'add2', 'add4', 'madd9', 'add#11', 'addb13', '9', 'm9', 'maj9', 'mMaj7', 'm(maj7)', 'mmaj9', '11', 'm11', 'maj11', '13',
    'maj13', 'm13', '7#9', '7b9', '7#11', '7b13', '7b9b13', '7#9#5', '13b9', '13#11', '7alt', '(b5)', '7(#9)', '[b9]', 'x', '7x', 'q', 'pent'];
  const slashes = ['', '/E', '/D', '/Bb', '/F#', '/G♭', '/H', '/', '//E', '/E/G'];
  let bad = '', count = 0;
  for (const r of roots) for (const s of suffixes) for (const b of slashes) {
    const text = r + s + b, mine = { ...parseChordSymbol(text) }, theirs = site.parseChordSymbol(text);
    delete mine.bass;
    count++;
    if (!bad && JSON.stringify(mine) !== JSON.stringify(theirs)) bad = `${text}: ${JSON.stringify(mine)} vs ${JSON.stringify(theirs)}`;
  }
  for (const text of ['', '   ', 'H7', '7', 'm7', '/E', 'C/', 'Cmaj7 ', ' Dm7', null, undefined]) {
    const mine = { ...parseChordSymbol(text) }, theirs = site.parseChordSymbol(text); delete mine.bass; count++;
    if (!bad && JSON.stringify(mine) !== JSON.stringify(theirs)) bad = `${JSON.stringify(text)}: ${JSON.stringify(mine)} vs ${JSON.stringify(theirs)}`;
  }
  check(`every field of ${count.toLocaleString()} symbols reads as the site reads it`, !bad, bad);
  const c = parseChordSymbol('Cmaj7/D'), e = parseChordSymbol('Ebm7'), f = parseChordSymbol('F#7/A#');
  check('the shape: { rootPc, intervals, bass? } (Cmaj7/D takes D and its fifth, as the site has it)', c.rootPc === 0 && c.intervals.join() === '0,2,4,7,9,11' && c.bass === 2 && e.rootPc === 3 && e.intervals.join() === '0,3,7,10' && !('bass' in e) && f.bass === 10,
    JSON.stringify([c, e, f]));
}

console.log('\n— the field\'s tokens');
{
  const fields = ['Cmaj7 Am7 Dm7 G7', 'Cmaj7 | Am7 | Dm7 | G7', '| Cmaj7 | Am7 |', 'Cmaj7,Am7, Dm7 ,G7', 'C;F;G', ' C\tF\nG\r\nC ', 'C||F,,G', '', '   ', 'C x Dm7 /E'];
  let bad = '';
  for (const f of fields) {
    const mine = tokenizeField(f), theirs = site.parseProgression(f), want = [...theirs.chords.map((c) => [c.index, c.symbol]), ...theirs.errors.filter((x) => x.token).map((x) => [x.index, x.token])].sort((a, b) => a[0] - b[0]);
    if (mine.map((t) => t.text).join('\u0000') !== want.map((x) => x[1]).join('\u0000') || mine.some((t, i) => t.index !== i || f.slice(t.start, t.end) !== t.text)) { bad = `${JSON.stringify(f)}: ${JSON.stringify(mine)} vs ${JSON.stringify(want)}`; break; }
  }
  check('the tokens and their order are the site\'s, each with its span', !bad, bad);
  const spans = tokenizeField('Cmaj7 | Am7');
  check('spans: "Cmaj7 | Am7" → [0, 5) and [8, 11)', spans.length === 2 && spans[0].start === 0 && spans[0].end === 5 && spans[1].start === 8 && spans[1].end === 11, JSON.stringify(spans));
  check('auto tokens leave the bar to Compose', AUTO_TOKENS.every((t) => readToken(t).kind === 'auto') && readToken('AUTO').kind === 'auto');
  const free = readToken('Eb*'), chord = readToken('Ebm7'), err = readToken('H7'), badFree = readToken('Cm*');
  check('"Eb*" pins the root, the quality free', free.kind === 'root' && free.parsed.rootPc === 3, JSON.stringify(free));
  check('"Ebm7" is a chord; "H7" and "Cm*" are errors, said', chord.kind === 'chord' && chord.parsed.intervals.join() === '0,3,7,10' && err.kind === 'error' && /missing note root/.test(err.error) && badFree.kind === 'error');
}

console.log('\n— quality pins on a pinned root, by hand');
{
  const T = (cents, weight = 2, tone = Math.round(cents)) => ({ tone, cents, weight, count: weight, node: tone + 1000 });
  const on = (tones, quality, lead = [], o = {}) => chooseChordOnRoot(tones, lead, { tone: 0, cents: 0, ...(quality !== undefined ? { quality } : {}) }, { eachSide: E, ...o });
  const dom = [T(0), T(386), T(702), T(1000)], free = on(dom);
  check('no quality asked: as before, and no `forced` field', free.quality.id === 'dominant_7th' && !('forced' in free) && JSON.stringify(on(dom, null)) === JSON.stringify(free));
  let c = on(dom, 'major_triad');
  check('a supported quality asked (whole in the bar): kept, forced.honored', c.quality.id === 'major_triad' && c.forced.honored && !c.forced.missing.length && c.fallback === null && c.intervals.join() === '0,4,7');
  c = on([T(0), T(386), T(702)], 'dominant_7th');
  check('one class short (no ♭7): still kept, the class said in missing', c.quality.id === 'dominant_7th' && c.forced.honored && c.missing.join() === '10');
  const thin = [T(0), T(702)];
  c = on(thin, 'major_7th');
  const was = on(thin), strip = (x) => { const y = { ...x }; delete y.forced; return JSON.stringify(y); };
  check('two classes short: falls back exactly as with no quality asked, said in forced', !c.forced.honored && c.forced.missing.join() === '4,11' && strip(c) === strip(was));
  check('the lead does not move a kept quality', on(dom, 'major_triad', [{ cents: 1000, strong: true }]).quality.id === 'major_triad');
  c = on(thin, 'power');
  check('a fallback dyad asked: kept when its other tone sounds', c.quality.id === 'power' && c.forced.honored && c.fallback === null);
  c = on([T(0), T(310)], 'power');
  check('… else falls back as before', !c.forced.honored && c.quality.id !== 'power');
  check('an unknown quality id throws', throws(() => on(dom, 'mystery'), /no quality/));
  check('qualityById covers the catalog and the fallbacks', [...CHORD_QUALITIES, ...FALLBACK_QUALITIES].every((q) => qualityById(q.id) === q) && qualityById('x') === null);
}

console.log('\n— the object form, read');
{
  const row = buildRow([8, 7, 6, 5]);
  const r = readProgression([{ ratio: '1/1', quality: 'minor_7th' }, '3/2', { ratio: '7/4', quality: 'nope' }, { ratio: '5/4', quality: null }], row, 4);
  check('qualities read on pinned bars; an unknown id is Compose\'s, and said', r.qualities.join() === 'minor_7th,,,' && r.roots.every((t) => t != null) && r.notes.some((n) => /bar 3: no quality "nope"/.test(n)), JSON.stringify(r));
  check('the asked list stays the ratios', r.asked.join() === '1/1,3/2,7/4,5/4');
  check('a quality on a ratio not of the row is dropped with its bar', readProgression([{ ratio: '9/9', quality: 'minor_7th' }], row, 1).qualities[0] === null);
  check('a quality that is not a string throws', throws(() => readProgression([{ ratio: '1/1', quality: 7 }], row, 1), /a quality is an id/));
  const plain = harmonyPins(readProgression(['1/1', null], row, 2));
  check('harmonyPins without a quality: { roots, choose: chooseChordOnRoot }, as before', Object.keys(plain).join() === 'roots,choose' && plain.choose === chooseChordOnRoot);
  const hp = harmonyPins(readProgression([{ ratio: '1/1', quality: 'minor_7th' }, { ratio: '3/2', quality: 'major_triad' }, { ratio: '1/1', quality: 'dominant_7th' }, '3/2'], row, 4));
  check('one root pinned with two qualities (or one and none): those bars are the seam\'s, said', hp.ambiguous.join() === '0,1,2,3', JSON.stringify(hp.ambiguous));
  const T = (cents, tone) => ({ tone, cents, weight: 2, count: 2, node: tone });
  const tones = [T(0, 0), T(386, 1), T(702, 2), T(1000, 3)];
  const hq = harmonyPins(readProgression([{ ratio: '1/1', quality: 'major_triad' }], row, 1)), t11 = row.tones.indexOf('1/1');
  check('choose keys an unambiguous quality by its root tone', hq.choose(tones, [], { tone: t11, cents: 0 }, { eachSide: E }).quality.id === 'major_triad');
  check('… and a pin\'s own quality (harmonize passing the bar\'s) wins', hq.choose(tones, [], { tone: t11, cents: 0, quality: 'dominant_7th' }, { eachSide: E }).quality.id === 'dominant_7th'
    && hq.choose(tones, [], { tone: t11, cents: 0, quality: null }, { eachSide: E }).quality.id === 'dominant_7th');
}

console.log('\n— the ratio form\'s identity');
{
  let bad = '';
  // the pins' comp is one note a stroke: compStyle 'notes' (COMP_ARP_ORDER.md P9), the override itself left out of the input
  const notes = (L, T, o) => { const spec = compose(L, T, { ...o, overrides: { ...o.overrides, compStyle: 'notes' } }); delete spec.input.overrides.compStyle; return spec; };
  for (const [name, L, T, o] of RATIO_CASES) { const h = sha(notes(L, T, o)); if (h !== RATIO_HASHES[name]) { bad = `${name}: ${h}`; break; } }
  check(`${RATIO_CASES.length} targeted specs byte-identical to b69a39e's (traced, worker, mod off, too long, not of the row)`, !bad, bad);
  const L = [119, 42, 15, 8], plain = compose(L, 8, { seed: 1, progression: ['1/1', '3/2', null, '5/3'] });
  const obj = compose(L, 8, { seed: 1, progression: [{ ratio: '1/1', quality: null }, { ratio: '3/2' }, null, { ratio: '5/3', quality: null }] });
  check('{ ratio, quality: null } and { ratio } compose the ratio form\'s spec', sha(sansAsk(obj)) === sha(sansAsk(plain)));
}

console.log('\n— barMaterials, against Compose');
{
  const cases = [[[8, 7, 6, 5], 4], [[119, 42, 15, 8], 8], [[11, 9, 7, 5], 6], [[41, 42, 43], 8], [[19, 17, 16, 15], 3]];
  const overrides = [{}, { bars: 4, slotsPerBar: 6 }, { anchors: 'even' }, { presence: 'exact' }, { frameCentsEachSide: 25 }, { root: '1/1' }, { phase: null }];
  let bad = '', n = 0;
  const cellsKey = (c) => JSON.stringify(c);
  for (const [L, T] of cases) for (const ov of overrides) for (const seed of [1, 7, 'tour']) {
    const o = { ...ov }; if (o.phase === null) delete o.phase;
    if (o.root && !buildRow(L).tones.includes(o.root)) continue;
    const spec = compose(L, T, { seed, overrides: o, drums: false }), M = barMaterials(L, T, { seed, ...o }), k = spec.knobs;
    n++;
    const row = buildRow(L), want = buildCells(row, { bars: k.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase });
    const knobsOk = M.meter.bars === k.bars && M.meter.slotsPerBar === k.slotsPerBar && M.anchors === k.anchors && M.phase.join() === k.phase.join() && M.root === k.root && M.frameCentsEachSide === k.frameCentsEachSide && M.meter.tempoBpm === k.tempoBpm;
    if (!knobsOk) { bad = `${L.join(':')} ${JSON.stringify(o)} seed ${seed}: knobs ${JSON.stringify([M.meter, M.phase, M.root])} vs ${JSON.stringify(k)}`; break; }
    if (cellsKey(M.cells) !== cellsKey(want)) { bad = `${L.join(':')} ${JSON.stringify(o)} seed ${seed}: the cells differ`; break; }
    const again = barMaterials(L, T, k, { row });
    if (cellsKey(again.cells) !== cellsKey(want) || again.root !== k.root) { bad = `${L.join(':')} ${JSON.stringify(o)} seed ${seed}: from the spec's knobs, the cells differ`; break; }
  }
  check(`${n} composes (5 rhythms × overrides × seeds): the meter, phase, root and cells Compose built; and again from spec.knobs`, !bad, bad);
  // the bars' tones are the ones harmonize reads: a pinned chord's support, from them alone
  let off = '', pinned = 0;
  for (const [L, T] of cases) {
    const M = barMaterials(L, T, { seed: 1 }), N = M.cells.bars;
    const roots = Array.from({ length: N }, (_, b) => M.candidates[b % M.candidates.length].ratio), read = readProgression(roots, M.row, N);
    const h = harmonize(M.row, M.cells, { root: M.rootTone, frameCentsEachSide: M.frameCentsEachSide, table: 'lean', progression: harmonyPins(read) });
    for (const c of h.chords) {
      if (c.empty) continue;
      const again = chooseChordOnRoot(M.bars[c.bar], [], { tone: c.rootTone, cents: c.rootCents, quality: c.quality }, { eachSide: M.frameCentsEachSide });
      pinned++;
      if (Math.abs(again.support - c.support) > 1e-12) { off = `${L.join(':')} bar ${c.bar + 1}: support ${again.support} vs ${c.support}`; break; }
    }
    // each bar's tones: every window's tone, once, its counts summed
    for (let b = 0; b < N && !off; b++) {
      const want = new Map();
      for (const sl of M.cells.slots) if (sl.bar === b) for (const t of sl.tones) want.set(t.tone, (want.get(t.tone) ?? 0) + t.count + t.strikes);
      if (want.size !== M.bars[b].length || M.bars[b].some((t) => want.get(t.tone) !== t.weight || t.cents !== M.row.toneCents[t.tone])) off = `${L.join(':')} bar ${b + 1}: the tones differ`;
    }
  }
  check(`${pinned} pinned chords: harmonize's support re-derived from barMaterials' bar tones; each bar's tones its windows'`, !off, off);
  const refused = barMaterials([1], 4);
  check('a row too thin is refused, as Compose refuses it', refused.refused && refused.reason === 'tooFewTones' && resolveSymbols('C', refused).refused);
}

// the composition the field tests stand on: 119:42:15:8 over 8 s, seed 1 — 4 bars of 8, the base root 3/2 (C)
const L = [119, 42, 15, 8], M = barMaterials(L, 8, { seed: 1 });
/** compose a resolved field and say what broke: roots kept, supported qualities kept, unsupported not → '' */
function composedAudit(r, o = {}) {
  const spec = compose(L, 8, { seed: 1, progression: progressionOf(r), drums: false, ...o }), tones = r.pins.map((p) => p?.ratio ?? null);
  for (const b of r.perBar) {
    if (!b.pin) { if (spec.chords[b.bar].targeted) return `bar ${b.bar + 1}: auto but targeted`; continue; }
    const c = spec.chords[b.bar], unique = tones.filter((t) => t === b.pin.ratio).length === 1;
    if (c.rootTone !== b.pin.ratio) return `bar ${b.bar + 1}: root ${c.rootTone}, pinned ${b.pin.ratio}`;
    if (!unique || !b.pin.quality) continue;
    const kept = c.quality === b.pin.quality;
    if ((b.quality.support === 'fallback') === kept) return `bar ${b.bar + 1}: ${b.name} resolved ${b.quality.support}, composed ${c.name}`;
  }
  return '';
}

console.log('\n— resolving the field');
{
  check('the composition: 4 bars of 8, the base root 3/2', M.cells.bars === 4 && M.cells.slotsPerBar === 8 && M.root === '3/2');
  let r = resolveSymbols('F Fmaj7 Fsus4 Fsus4', M);
  const f = r.perBar[0];
  check('"F": the 1/1 cluster, in the frame, its cents shown (F −2.0¢), whole in the bar (✓)', f.status === 'ok' && f.root.ratio === '1/1' && f.root.label === 'F −2.0¢' && f.root.inFrame && f.quality.support === 'whole' && f.quality.label === '✓' && f.pin.quality === 'major_triad', JSON.stringify(f));
  check('"Fmaj7" over bar 2: one class short, kept, amber "no 3"', r.perBar[1].quality.support === 'missing' && r.perBar[1].status === 'amber' && r.perBar[1].quality.label === 'no 3' && r.perBar[1].pin.quality === 'major_7th' && r.perBar[1].amber.some((x) => /sounds no 3/.test(x)), JSON.stringify(r.perBar[1].quality));
  check('supported and composed: the roots and the qualities kept', !composedAudit(r), composedAudit(r));
  // off the frame: D is 5/3, −17.6¢ (the only cluster of its class)
  r = resolveSymbols('D', M);
  const d = r.perBar[0];
  check('"D": the nearest cluster, amber with its cents (D −17.6¢), modulation on: may retune, not offGrid', d.status === 'amber' && d.root.ratio === '5/3' && d.root.label === 'D −17.6¢' && !d.root.inFrame && d.root.mayRetune && !d.root.offGrid, JSON.stringify(d.root));
  let spec = compose(L, 8, { seed: 1, progression: progressionOf(r), drums: false });
  check('… composed: the root kept, and Compose\'s own rule retunes at bar 1', spec.chords[0].rootTone === '5/3' && spec.modulations.some((m) => m.bar === 0) && !spec.chords[0].offGrid, JSON.stringify(spec.modulations));
  const Moff = barMaterials(L, 8, { seed: 1, modulation: false });
  r = resolveSymbols('D', Moff);
  check('modulation off: kept, flagged offGrid, never snapped into the frame', r.perBar[0].root.offGrid && !r.perBar[0].root.mayRetune && r.perBar[0].root.ratio === '5/3' && r.perBar[0].status === 'amber');
  check('modulation asked of resolve itself overrides the materials\'', resolveSymbols('D', M, { modulation: false }).perBar[0].root.offGrid);
  spec = compose(L, 8, { seed: 1, overrides: { modulation: false }, progression: progressionOf(r), drums: false });
  check('… composed with modulation off: the root 5/3, offGrid, nothing retuned', spec.chords[0].rootTone === '5/3' && spec.chords[0].offGrid && !spec.modulations.length);
  check('"G": a class whose only cluster is +45.8¢ off: amber, its cents', resolveSymbols('G', M).perBar[0].root.label === 'G +45.8¢' && resolveSymbols('G', M).perBar[0].status === 'amber');
  // a class with no cluster at all: on 8:7:6:5 nothing sounds within 50¢ of F
  const M8 = barMaterials([8, 7, 6, 5], 4, { seed: 1 }), r8 = resolveSymbols('F', M8).perBar[0];
  check('a class the row lacks: the nearest cluster at any offset (E, F −113.7¢), amber', r8.root.ratio === '35/32' && r8.root.label === 'F −113.7¢' && r8.status === 'amber' && r8.name === 'F', JSON.stringify(r8.root));
  // unsupported
  r = resolveSymbols('Cm Am7 Dm7 G7', M);
  check('unsupported qualities: amber, Compose\'s fallback named', r.perBar.every((b) => b.quality.support === 'fallback' && b.status === 'amber' && /^fallback: /.test(b.quality.label)), JSON.stringify(r.perBar.map((b) => b.quality)));
  check('… composed: every root kept, no unsupported quality forced', !composedAudit(r), composedAudit(r));
  // a field of every kind, composed
  let bad = '', fields = 0;
  for (const a of ['C', 'F', 'A', 'D', 'G', 'A#']) for (const q of ['', 'm', '7', 'maj7', 'sus4', 'sus2', 'm7', '5', 'no5']) {
    for (const field of [`${a}${q} F C*`, `- ${a}${q} Fsus4 C`, `F - - ${a}${q}`]) { fields++; const why = composedAudit(resolveSymbols(field, M)); if (why) { bad = `${field}: ${why}`; break; } }
    if (bad) break;
  }
  check(`${fields} fields composed: roots kept, the supported qualities kept, the unsupported not`, !bad, bad);
  // the seam: one root twice with two qualities
  r = resolveSymbols('F Cmaj7 Fsus4 F', M);
  spec = compose(L, 8, { seed: 1, progression: progressionOf(r), drums: false });
  {
    const why = spec.decisions.find((x) => x.what === 'progression').why, asked = progressionOf(r).map((p) => p && p.quality);
    const each = asked.every((q, k) => q == null || spec.chords[k].quality === q || new RegExp(`bar ${k + 1}: the quality asked, [^;]*, is not supported`).test(why));
    check('one root pinned with two qualities: the roots kept, and each bar honors its own quality where the bar supports it (the seam, applied)', spec.chords[0].rootTone === '1/1' && spec.chords[3].rootTone === '1/1' && !/waits on harmonize/.test(why) && each, why);
  }
  // the Composer's qualities for other symbols
  r = resolveSymbols('C9 C6 C/E C13#11 Cadd9', M);
  check('a symbol the Composer has no quality for: the richest inside it, the rest dropped and said', r.perBar[0].pin.quality === 'dominant_7th' && r.perBar[0].quality.dropped.join() === '2' && r.perBar[1].pin.quality === 'major_triad' && r.perBar[2].pin.quality === 'major_triad' && r.perBar[2].quality.exact && r.perBar[0].amber.some((x) => /no quality with its 2/.test(x)), JSON.stringify(r.perBar.map((b) => b.quality)));
  check('qualityOfIntervals: exact, reduced, none', qualityOfIntervals([0, 3, 7, 10]).quality === 'minor_7th' && qualityOfIntervals([0, 7]).quality === 'power' && qualityOfIntervals([0, 1, 6]).quality === 'root_only' && qualityOfIntervals([1, 6]).quality === null);
  // the bars
  r = resolveSymbols('C, F, G, Am, Dm7, E', M);
  check('more symbols than bars: the extras dropped and flagged', r.extras.map((t) => t.text).join() === 'Dm7,E' && r.pins.length === 4 && !r.ok && r.notes.some((x) => /6 symbols for 4 bars: "Dm7", "E" dropped/.test(x)));
  // a bar line makes the field a chart (CHART_ORDER.md P2), which sets its own bars: these materials are not its
  r = resolveSymbols('C | F | G | Am | Dm7 | E', M);
  check('a chart against materials of another shape: a mismatch, nothing pinned (CHART_ORDER P2, P9)', !!r.mismatch && r.chart.bars === 6 && r.pins.length === 0 && !r.ok, JSON.stringify(r.mismatch));
  r = resolveSymbols('F, Fsus4', M);
  check('fewer: the rest auto', r.pins.length === 4 && r.pins[2] === null && r.pins[3] === null && r.perBar[3].status === 'auto' && r.notes.some((x) => /bars 3–4 auto/.test(x)));
  r = resolveSymbols('F H7 F* ?', M);
  check('an error is said and left auto; "F*" pins the root with Compose\'s quality', r.perBar[1].status === 'error' && r.pins[1] === null && r.pins[2].ratio === '1/1' && r.pins[2].quality === null && r.perBar[2].name === 'F*' && r.pins[3] === null && !r.ok);
  check('an empty field is all auto, and no progression', resolveSymbols('', M).pins.every((p) => p === null) && progressionOf(resolveSymbols('  ', M)) === null);
  check('tokens may be given instead of the text', JSON.stringify(resolveSymbols(tokenizeField('F Fsus4'), M).pins) === JSON.stringify(resolveSymbols('F Fsus4', M).pins));
  check('every bar\'s token carries its span for the inline marks', resolveSymbols('F  Dm7', M).perBar[1].token.start === 3);
}

console.log('\n— the display: symbols ⇄ pins');
{
  const ids = [...CHORD_QUALITIES, ...FALLBACK_QUALITIES].map((q) => q.id);
  let bad = '', n = 0;
  for (const c of M.candidates) for (const id of [...ids, null]) {
    const pins = [{ ratio: c.ratio, quality: id }, null, { ratio: M.candidates[(n + 3) % M.candidates.length].ratio, quality: ids[n % ids.length] }];
    n++;
    const field = pinsToField(pins, M), back = fieldToPins(field, M, { keep: pins });
    const want = [...pins, null];
    if (JSON.stringify(back) !== JSON.stringify(want)) { bad = `${JSON.stringify(pins)} → "${field}" → ${JSON.stringify(back)}`; break; }
  }
  check(`${n} pin lists → field → pins: the same list (every candidate × every quality, and none)`, !bad, bad);
  bad = '';
  for (const field of ['Fmaj7 Cm7 - G#m7b5', 'C - - D*', 'A#7sus4 Ddim7 EmMaj7 F#aug', 'C5 Cno5 Cmno5 Cno3no5', 'Csus2']) {
    const pins = fieldToPins(field, M), again = pinsToField(pins, M);
    if (again !== field) { bad = `"${field}" → "${again}"`; break; }
  }
  check('fields in the Composer\'s names → pins → the same field', !bad, bad);
  check('flats come back sharp; the ratio form and trailing autos', pinsToField(fieldToPins('Bb7 Eb', M), M) === 'A#7 D#' && pinsToField(['1/1', null, null], M) === 'F*' && pinsToField([null, { ratio: '9/9' }], M) === '- ?' && pinsToField([], M) === '');
  // keep: the lab's pick kept when it is of the symbol's class, even when it is not the class's nearest cluster
  const MK = barMaterials([41, 42, 43], 8, { seed: 1 }), row = MK.row, cl = clusterPresence(row, 15);
  const t = row.tones.findIndex((_, i) => !cl.representative[i] && i !== MK.rootTone), pc = classOfCents(row.toneCents[t] - MK.baseCents).pc;
  const kept = fieldToPins(PC_NAMES[pc], MK, { keep: [{ ratio: row.tones[t] }] })[0], fresh = fieldToPins(PC_NAMES[pc], MK)[0];
  check(`keep: the lab's ${row.tones[t]} stays under "${PC_NAMES[pc]}" (left alone, ${fresh.ratio}); another class re-picks`, kept.ratio === row.tones[t] && fresh.ratio !== row.tones[t]
    && fieldToPins(PC_NAMES[(pc + 1) % 12], MK, { keep: [{ ratio: row.tones[t] }] })[0].ratio !== row.tones[t], `tone ${t}`);
}

console.log('\n— timing');
{
  const time = (fn, runs) => { fn(); const t0 = performance.now(); for (let i = 0; i < runs; i++) fn(); return (performance.now() - t0) / runs; };
  const small = time(() => barMaterials([8, 7, 6, 5], 4, { seed: 1 }), 200), mid = time(() => barMaterials(L, 8, { seed: 1 }), 100);
  const resolve = time(() => resolveSymbols('Fmaj7 Cm7 Dsus4 G7', M), 200);
  const big = [4099, 4093, 4091, 4079], row = buildRow(big);
  const full = time(() => barMaterials(big, 16, { seed: 1 }), 3), given = time(() => barMaterials(big, 16, { seed: 1 }, { row }), 3);
  const MB = barMaterials(big, 16, { seed: 1 }, { row }), resolveBig = time(() => resolveSymbols('C Am7 Dm7 G7 C F G C', MB), 10);
  console.log(`    barMaterials: 8:7:6:5 ${small.toFixed(2)} ms, 119:42:15:8 ${mid.toFixed(2)} ms, the 16k row ${full.toFixed(1)} ms (${given.toFixed(1)} ms with its row built); resolveSymbols ${resolve.toFixed(3)} ms, on the 16k row ${resolveBig.toFixed(2)} ms`);
  check('small rows about a millisecond (under 5 ms here); the 16k row under 200 ms', small < 5 && mid < 5 && full < 200 && resolve < 5, `${small} ${mid} ${full}`);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
