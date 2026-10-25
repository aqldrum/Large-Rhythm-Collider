// assert-chord-symbols.mjs — Composer/core/chord-symbols.js (the typed progression field, step 4b) and the object form
// of a progression in Composer/core/progression.js. Exit non-zero on any mismatch.
//   • the parser against the site's own ProgressionSolver.parseChordSymbol (loaded in a vm, as site-scripts.mjs loads
//     the site's scripts), over every root spelling × a broad suffix list × slash basses, and the field's tokens
//   node Composer/tests/assert-chord-symbols.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './site-scripts.mjs';
import { parseChordSymbol, tokenizeField, readToken, AUTO_TOKENS } from '../core/chord-symbols.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };

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

console.log(`\n${PASS ? 'PASS' : 'FAIL'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
