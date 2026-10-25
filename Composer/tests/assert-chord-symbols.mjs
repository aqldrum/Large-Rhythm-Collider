// assert-chord-symbols.mjs — Composer/core/chord-symbols.js (the typed progression field, step 4b) and the object form
// of a progression in Composer/core/progression.js. Exit non-zero on any mismatch.
//   • the parser against the site's own ProgressionSolver.parseChordSymbol (loaded in a vm, as site-scripts.mjs loads
//     the site's scripts), over every root spelling × a broad suffix list × slash basses, and the field's tokens
//   • quality pins: chooseChordOnRoot keeps a supported asked quality (whole, one class short, a fallback dyad) and
//     falls back exactly as before otherwise; readProgression's object form; harmonyPins' identity and its seam
//   • the ratio form's identity: targeted specs hashed with the progression.js of b69a39e (before 4b), byte for byte;
//     `{ ratio, quality: null }` the same spec as `{ ratio }`
//   node Composer/tests/assert-chord-symbols.mjs
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './site-scripts.mjs';
import { parseChordSymbol, tokenizeField, readToken, AUTO_TOKENS } from '../core/chord-symbols.js';
import { buildRow } from '../core/row.js';
import { compose } from '../core/compose.js';
import { CHORD_QUALITIES } from '../core/harmony.js';
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
  for (const [name, L, T, o] of RATIO_CASES) { const h = sha(compose(L, T, o)); if (h !== RATIO_HASHES[name]) { bad = `${name}: ${h}`; break; } }
  check(`${RATIO_CASES.length} targeted specs byte-identical to b69a39e's (traced, worker, mod off, too long, not of the row)`, !bad, bad);
  const L = [119, 42, 15, 8], plain = compose(L, 8, { seed: 1, progression: ['1/1', '3/2', null, '5/3'] });
  const obj = compose(L, 8, { seed: 1, progression: [{ ratio: '1/1', quality: null }, { ratio: '3/2' }, null, { ratio: '5/3', quality: null }] });
  check('{ ratio, quality: null } and { ratio } compose the ratio form\'s spec', sha(sansAsk(obj)) === sha(sansAsk(plain)));
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
