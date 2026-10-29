// assert-refactor-identity.mjs — STEP 4a, 3: the builder refactor's gate. compose.js' part builders became exported
// per-bar functions (chordVoicesOfBar, compOfBar, bassOfBar, innerOf) and harmony.js' chord record a function of its
// own (chordRecord); Compose calls them. Compose must be byte for byte what it was: every spec here is composed twice,
// by the live core and by the frozen pre-refactor copy (tests/fixtures/compose-before.js, harmony-before.js and
// lines-before.js, taken at ba590d5 and never edited; row, cells, frame, progression, drums and trace are live in
// both), and the two JSON texts must be equal:
//   • every rhythm of rhythms.mjs × 2 seeds, at a spread of cycle lengths
//   • tone-rich rhythms × every override (each alone, and a few together), the full table too
//   • targeted progressions (every bar pinned, some, an off-frame root, a ratio not of the row)
//   • every drum mode × fills on and off, a per-bar mode, and no drums
//   • the trace off, `true` and `{ caps }`
//   • thrown errors (a bad override) are the same error
// The live core runs with `compStyle: 'notes'` and `voicing: 'close'` (BASS_VOICING_ORDER.md P7: the chords stacked close, as
// the frozen core stacks them) (COMP_ARP_ORDER.md P9: the frozen core's comping, one note a stroke; the
// default is now chords): the override is taken back out of the live spec's input, and out of the override list a bad
// override's error names, before the texts are compared. The fixtures are untouched.
//   node Composer/tests/assert-refactor-identity.mjs
import { compose } from '../core/compose.js';
import { compose as composeBefore } from './fixtures/compose-before.js';
import { rootCandidates } from '../core/progression.js';
import { DRUM_MODES } from '../core/drums.js';
import { RHYTHMS } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const run = (f, L, T, o) => { try { return JSON.stringify(f(L, T, o)); } catch (err) { return `throws: ${err.message}`; } };
/** the live core with the frozen core's comping (compStyle 'notes') and voicing (voicing 'close', BASS_VOICING_ORDER.md
 *  P7), the overrides themselves taken back out */
const live = (L, T, o = {}) => {
  try { const spec = compose(L, T, { ...o, overrides: { ...o.overrides, compStyle: 'notes', voicing: 'close', bass: { density: 'sparse', lock: 'free' } } }); delete spec.input.overrides.compStyle; delete spec.input.overrides.voicing; delete spec.input.overrides.bass; return spec; }
  catch (err) { throw new Error(err.message.replace(', compStyle, clave, compRelation, voicing, claveFrom, compDensity, bass, compTolerance, compBorrow)', ')')); }
};
const pad = (L) => [...L, 0, 0, 0, 0].slice(0, 4);

console.log('═══ COMPOSER — the builder refactor: Compose byte for byte as before (step 4a) ═══');
const t0 = performance.now();
const group = (label, cases) => {
  let same = 0, refused = 0, threw = 0;
  const bad = [];
  for (const [name, L, T, o] of cases) {
    const a = run(composeBefore, L, T, o), b = run(live, L, T, o);
    if (a === b) { same++; if (a.startsWith('throws')) threw++; else if (a.includes('"refused":true')) refused++; } else bad.push(name);
  }
  check(`${label}: ${same}/${cases.length} byte-identical (${refused} refused, ${threw} thrown alike)`, same === cases.length, bad.slice(0, 6).join('; '));
};

// every rhythm × 2 seeds
group('every rhythm of rhythms.mjs × 2 seeds', RHYTHMS.flatMap((L, i) => [1, 7].map((seed) => [`${L.join(':')} seed ${seed}`, pad(L), 3 + (i % 5) * 2.5, { seed }])));

// tone-rich rhythms × every override
const RICH = [[[8, 7, 6, 5], 4], [[19, 17, 16, 15], 6], [[41, 42, 43, 0], 8], [[119, 42, 15, 8], 8], [[97, 103, 37, 0], 5], [[768, 769, 0, 0], 8]];
const overridesOf = (L) => {
  const rc = rootCandidates(L), other = rc.candidates?.find((c) => !c.isRoot)?.ratio ?? null;
  return [
    { bars: 2 }, { bars: 8 }, { bars: 1 }, { slotsPerBar: 6 }, { slotsPerBar: 4 }, { slotsPerBar: 3 }, { anchors: 'even' }, { phase: [1, 3] },
    { frameCentsEachSide: 8 }, { frameCentsEachSide: 25 }, ...(other ? [{ root: other }] : []), { modulation: false }, { foldOffsets: false }, { table: 'full' },
    { sounds: { lead: 'vibes', bass: 'upright', chords: 'glassbed' } }, { legato: { lead: true, bass: true, comp: true, chords: false } }, { enabled: { comp: false, inner: false } },
    { baseHz: 220 }, { compLayer: 'B' }, { compLayer: 'A' }, { presence: 'exact' }, { settlePasses: 0 }, { settlePasses: 1 }, { settlePasses: 2 },
    { bars: 4, slotsPerBar: 8, anchors: 'even', modulation: false, settlePasses: 1 }, { presence: 'exact', foldOffsets: false, frameCentsEachSide: 20, table: 'full' },
    { nope: 1 },
  ];
};
group('6 tone-rich rhythms × every override (each alone, a few together, one refused)', RICH.flatMap(([L, T]) => overridesOf(L).flatMap((ov) => [1, 3].map((seed) => [`${L.join(':')} ${JSON.stringify(ov)} seed ${seed}`, L, T, { seed, overrides: ov }]))));
group('the full table (worker: true)', RICH.slice(0, 5).map(([L, T]) => [`${L.join(':')} worker`, L, T, { seed: 2, worker: true }]));

// targeted progressions
const progCases = [];
for (const [L, T] of RICH) {
  const rc = rootCandidates(L), cs = rc.candidates || [];
  if (cs.length < 3) continue;
  const off = cs.find((c) => c.offGrid)?.ratio ?? cs[cs.length - 1].ratio;
  for (const [what, prog] of [['every bar', [cs[0].ratio, cs[1].ratio, cs[2].ratio, cs[1].ratio, cs[0].ratio, cs[2].ratio, cs[1].ratio, cs[0].ratio]], ['some', [null, cs[2].ratio, null, cs[1].ratio]],
    ['off-frame', [off, null, off]], ['not of the row', ['7/5', null]], ['all auto', [null, 'auto', '']]]) {
    for (const ov of [{}, { modulation: false }, { bars: 2, settlePasses: 0 }]) progCases.push([`${L.join(':')} ${what} ${JSON.stringify(ov)}`, L, T, { seed: 1, progression: prog, overrides: ov }]);
  }
}
group('targeted progressions (every bar, some, off-frame, not of the row, all auto) × modulation and settle', progCases);

// every drum mode
const drumCases = [];
for (const [L, T] of RICH.slice(0, 4)) {
  for (const mode of DRUM_MODES) for (const fills of [true, false]) drumCases.push([`${L.join(':')} ${mode} fills ${fills}`, L, T, { seed: 4, drums: { mode, fills } }]);
  drumCases.push([`${L.join(':')} perBar`, L, T, { seed: 4, drums: { mode: 'with', perBar: { 1: 'against', 2: 'partition' }, hitsPerBar: 3 } }], [`${L.join(':')} no drums`, L, T, { seed: 4, drums: false }],
    [`${L.join(':')} drums true`, L, T, { seed: 4, drums: true }], [`${L.join(':')} drums off`, L, T, { seed: 4, drums: { enabled: false } }]);
}
group(`every drum mode (${DRUM_MODES.length}) × fills on and off, a per-bar mode, no drums`, drumCases);

// the trace off, true and { caps }
const traceCases = [];
RHYTHMS.forEach((L, i) => { if (i % 2 === 0) for (const trace of [true, {}, { caps: { runnersUp: 1, chordCandidates: 20 } }]) traceCases.push([`${L.join(':')} trace ${JSON.stringify(trace)}`, pad(L), 4 + (i % 3) * 2, { seed: 1 + (i % 4), trace }]); });
for (const [L, T] of RICH) traceCases.push([`${L.join(':')} trace + progression + drums`, L, T, { seed: 5, trace: {}, progression: [null, rootCandidates(L).candidates?.[1]?.ratio ?? null], drums: { mode: 'against' } }]);
group('the trace (true, { caps }, caps given) — the whole spec with its trace', traceCases);

// the 16k row, once each way
group('the 16,359-onset row (lean, and the full table with the trace)', [['16k lean', [4099, 4093, 4091, 4079], 16, { seed: 1 }], ['16k full trace', [4099, 4093, 4091, 4079], 16, { seed: 3, worker: true, trace: {} }]]);

console.log(`  · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(PASS ? `\n✓✓✓ REFACTOR IDENTITY PASSES (${checks} checks)` : `\n✗ REFACTOR IDENTITY FAILED`);
process.exit(PASS ? 0 : 1);
