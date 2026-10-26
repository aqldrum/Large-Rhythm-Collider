// assert-store-edits.mjs — STEP 4d: the store's live edits and pins (store/composition-store.js, composition-edits.js)
// and the controller's merge (perform/composer-controller.js), in Node:
//   • edits apply live and recall with no re-solve: a chord swap is rearrange.js' own result, Compose's spec is never
//     touched, the entry never goes dirty; two swaps are rearrange twice; a swap back is the composed spec exactly;
//     the parts' sound / on-off stay live over the edited notes
//   • undo / redo (bounded), a lead swap and "chords follow", alternatesOf (12 candidates a bar, 1 + 8 lines a phrase)
//   • the typed field: the user's text kept (flats stay flats), its pins stored as typed chord edits, a swap rewriting
//     only its own bar's symbol; before a compose the field is Compose's progression
//   • a re-compose (decision 5): chord edits kept as pins through a seed change, lead edits dropped and said, a pin the
//     new row lacks dropped and flagged; the drum grid kept on the same meter, dropped (and said) on a new one
//   • drum grid edits, presets ⇄ grid, the grid and prime modes in the controller's choices
//   • the worker path for a big row (a mocked worker running compose-worker.js' own answer), smoothPhrase in the worker
//   • the store: a new cycle carries the chord edits as pins (not the lead's); the tab: recall with edits, no re-solve
//   • the page: the glyph's recall plays the edited composition; the part strips, the lit nodes, the Scale readout and
//     the window's lanes show it; JSON export carries the edits
//   • drums.js `against` is stable across a swap (seeded per bar, step 4d)
//   node Composer/tests/assert-store-edits.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
// imported before the stub's globals exist, so the bridge module's own page boot doesn't run
import { createComposerBridge } from '../page/composer-bridge.js';
import { compose, PART_IDS } from '../core/compose.js';
import { rearrange, applyRearrange, materialsOf } from '../core/rearrange.js';
import { arrangeDrums, gridOf, ALL_DRUM_MODES, beatsOf, drawPrime, nextPrime } from '../core/drums.js';
import { answer, keptMaterials } from '../core/compose-worker.js';
import { createComposeRunner } from '../perform/compose-runner.js';
import { createComposerController, drumModeChoices, MAIN_THREAD_ONSETS } from '../perform/composer-controller.js';
import { createCompositionStore, newCompositionState, UNDO_LIMIT } from '../store/composition-store.js';
import { rewriteToken, orderedEdits } from '../store/composition-edits.js';
import { createTabController } from '../page/tab-controller.js';
import { stripRows } from '../page/part-strips.js';
import { chordTonesByBar } from '../page/panel-locks.js';
import { tokenizeField } from '../core/chord-symbols.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const timers = { setInterval: () => 1, clearInterval: () => {} };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const names = (spec) => spec.chords.map((c) => c.name).join(' ');
/** a part's notes without their lengths (what an edit moves) */
const notesOf = (spec, id) => J(spec.parts.find((p) => p.id === id).notes.map(({ duration, retrigger, ...n }) => n));

/** a controller over a fresh state, composing on this thread by default */
function lab(layers, cycleSeconds, { seed = 1, table = 'lean', runCompose, ...rest } = {}) {
  let solves = 0;
  const run = runCompose ?? (async (l, T, o) => { solves++; return compose(l, T, o); });
  const c = createComposerController({ runCompose: run, createContext: () => ({}), timers, state: newCompositionState({ layers, cycleSeconds, seed }), ...rest });
  c.state.table = table;
  return { c, solves: () => solves };
}

console.log('Composer store — live edits and pins (step 4d)');

// ── 1. edits, live ──
console.log('\n— a chord swap, live');
const A = lab([41, 42, 43, 0], 8);
await A.c.compose();
const S = A.c.state, composedJSON = J(S.composed);
const { row, cells } = materialsOf(S.composed);
check('a fresh compose: no edits, the spec is Compose\'s own (the same object)', S.spec === S.composed && !A.c.hasEdits() && S.edits.order.length === 0 && S.undo.length === 0);
const alt1 = A.c.alternatesOf(1, 'chords');
check(`alternatesOf(bar, 'chords'): the trace's ${alt1.candidates.length} candidates (12 kept), the composed one current`, alt1.candidates.length === 12 && alt1.currentIndex === alt1.composedIndex && alt1.candidates[alt1.currentIndex].current && alt1.candidates.filter((x) => x.current).length === 1);
const pick = alt1.candidates.find((x) => !x.current && !x.composed);
const r1 = await A.c.swapChord(1, pick);
const want1 = applyRearrange({ ...S.composed, drums: undefined }, rearrange({ ...S.composed, drums: undefined }, row, cells, { bar: 1, chord: { rootTone: pick.root.ratio, quality: pick.quality } }));
check(`swapChord(1, candidate): bar 2 plays ${S.spec.chords[1].name}; the spec is rearrange's own result`, r1.ok && S.spec.chords[1].rootTone === pick.root.ratio && S.spec.chords[1].quality === pick.quality && J({ ...S.spec, drums: undefined }) === J(want1));
check('… Compose\'s spec untouched, the entry not dirty, nothing re-solved', J(S.composed) === composedJSON && !S.dirty && A.solves() === 1 && A.c.button() === 'Perform');
check('… the edit recorded: { rootTone, quality, from: swap }, and its result says which bars moved', J(S.edits.chords[1]) === J({ rootTone: pick.root.ratio, quality: pick.quality, from: 'swap' }) && J(S.edits.order) === J(['chord:1']) && r1.changedBars.includes(1));
check('… the parts as they play now are the edited ones (the lead kept: decision 1)', notesOf(S.spec, 'lead') === notesOf(S.composed, 'lead') && J(A.c.currentParts().map((p) => p.notes.length)) === J(S.spec.parts.map((p) => p.notes.length)) && notesOf({ parts: A.c.currentParts() }, 'chords') === notesOf(S.spec, 'chords'));
check('… and the drums are arranged over the edited spec', J(S.drums) === J(arrangeDrums(S.spec, S.drumOptions)));
const alt1b = A.c.alternatesOf(1, 'chords');
check('alternatesOf marks the swapped candidate current now (the composed one still composed)', alt1b.candidates[alt1b.currentIndex].index === pick.index && alt1b.candidates[alt1b.composedIndex].composed && alt1b.edit.from === 'swap');
// a second swap is rearrange over the first
const alt3 = A.c.alternatesOf(3, 'chords'), pick3 = alt3.candidates.find((x) => !x.current);
await A.c.swapChord(3, pick3);
const want2 = applyRearrange(want1, rearrange(want1, row, cells, { bar: 3, chord: { rootTone: pick3.root.ratio, quality: pick3.quality } }));
check('two swaps: rearrange twice, in the order made', J({ ...S.spec, drums: undefined }) === J(want2) && J(S.edits.order) === J(['chord:1', 'chord:3']));
// the parts' live controls, over edits
A.c.setPart('chords', { sound: 'marimba', enabled: false });
const alt0 = A.c.alternatesOf(0, 'chords');
await A.c.swapChord(0, alt0.candidates.find((x) => !x.current));
check('a part\'s sound and on/off stay as set over a later edit (re-articulated, not re-mined)', S.parts.chords.sound === 'marimba' && S.parts.chords.enabled === false && S.spec.parts.find((p) => p.id === 'chords').sound !== 'marimba');
A.c.setPart('chords', { sound: S.composed.parts.find((p) => p.id === 'chords').sound, enabled: true });
await A.c.swapChord(0, alt0.candidates[alt0.composedIndex]);
check('a swap back to Compose\'s chord removes the edit', !(0 in S.edits.chords) && J(S.edits.order) === J(['chord:1', 'chord:3']) && S.spec.chords[0].name === S.composed.chords[0].name);
const noop = await A.c.swapChord(1, pick);
check('a swap to what the bar plays already does nothing (no undo step)', noop.noop && S.undo.length === 4);

console.log('\n— undo / redo');
const snaps = [];
{
  const c2 = lab([41, 42, 43, 0], 8), s2 = c2.c.state;
  await c2.c.compose();
  snaps.push(J(s2.spec));
  for (const k of [1, 2, 3]) { const a = c2.c.alternatesOf(k, 'chords'); await c2.c.swapChord(k, a.candidates.find((x) => !x.current)); snaps.push(J(s2.spec)); }
  const u1 = await c2.c.undo();
  check('undo: back one edit, the spec exactly as it was then', u1.ok && J(s2.spec) === snaps[2] && s2.redo.length === 1 && s2.undo.length === 2);
  await c2.c.undo(); await c2.c.undo();
  check('… to the composition Compose made (the same object again)', s2.spec === s2.composed && !c2.c.hasEdits() && !c2.c.canUndo() && c2.c.canRedo());
  check('… one undo too many is nothing', (await c2.c.undo()).empty);
  await c2.c.redo(); await c2.c.redo();
  check('redo: forward again, exactly', J(s2.spec) === snaps[2] && c2.c.canRedo());
  const a = c2.c.alternatesOf(0, 'chords');
  await c2.c.swapChord(0, a.candidates.find((x) => !x.current));
  check('a new edit clears the redo stack', !c2.c.canRedo() && s2.undo.length === 3);
  check('undo/redo never re-solve and never dirty', c2.solves() === 1 && !s2.dirty);
  for (let i = 0; i < UNDO_LIMIT + 10; i++) { const k = i % s2.spec.knobs.bars, b = c2.c.alternatesOf(k, 'chords'); await c2.c.swapChord(k, b.candidates.find((x) => !x.current)); }
  check(`the undo stack is bounded: ${UNDO_LIMIT} steps (proposed)`, s2.undo.length === UNDO_LIMIT);
}

console.log('\n— a lead swap');
{
  const L = lab([19, 17, 16, 15], 6, { seed: 2 }), s = L.c.state;
  await L.c.compose();
  const la = L.c.alternatesOf(0, 'lead');
  check(`alternatesOf(bar, 'lead'): the phrase's kept line and its runner-ups (${la.lines.length - 1}, up to 8), the kept one current`, la.lines.length >= 2 && la.lines.length <= 9 && la.lines[0].kept && la.lines[0].current && la.lines.filter((x) => x.current).length === 1 && la.lines.every((x) => x.perNote != null));
  const line = la.lines[1];
  const { row: r2, cells: c2 } = materialsOf(s.composed);
  const res = await L.c.swapLead(la.phrase, line.id);
  const want = applyRearrange({ ...s.composed, drums: undefined }, rearrange({ ...s.composed, drums: undefined }, r2, c2, { phrase: la.phrase, line: { notes: s.trace.lines[line.id].notes } }));
  check('swapLead(phrase, runner-up): rearrange\'s own result; the chords stay (they don\'t follow by default)', res.ok && J({ ...s.spec, drums: undefined }) === J(want) && names(s.spec) === names(s.composed) && J(s.edits.lead[la.phrase]) === J({ lineId: line.id, chordsFollow: false }));
  check('… the runner-up current now', L.c.alternatesOf(0, 'lead').lines[1].current && L.c.alternatesOf(0, 'lead').currentId === line.id);
  // a chord edit in the phrase gives way to chords that follow
  const a1 = L.c.alternatesOf(1, 'chords');
  await L.c.swapChord(1, a1.candidates.find((x) => !x.current));
  check('a chord edit in the phrase, over the swapped lead', 1 in s.edits.chords);
  await L.c.swapLead(la.phrase, line.id, { chordsFollow: true });
  const want2 = applyRearrange({ ...s.composed, drums: undefined }, rearrange({ ...s.composed, drums: undefined }, r2, c2, { phrase: la.phrase, line: { notes: s.trace.lines[line.id].notes }, chordsFollow: true }));
  check('chords follow: the phrase\'s chord edits give way, and the spec is rearrange\'s with chordsFollow', !(1 in s.edits.chords) && J({ ...s.spec, drums: undefined }) === J(want2) && s.edits.lead[la.phrase].chordsFollow === true);
  await L.c.swapLead(la.phrase, la.keptId);
  check('its own line again removes the lead edit: Compose\'s spec exactly', !L.c.hasEdits() && s.spec === s.composed);
  let threw = false; try { L.c.swapLead(0, 'no-such-line'); } catch { threw = true; }
  check('a line not in the trace is refused', threw);
  check('alternatesOf has none for the other parts (they follow their bar\'s chord)', L.c.alternatesOf(0, 'bass') === null && L.c.alternatesOf(0, 'drums') === null);
}

console.log('\n— the typed progression field');
{
  const F = lab([41, 42, 43, 0], 8), s = F.c.state;
  check('before any compose: the field is empty', F.c.progressionField().text === '' && !F.c.progressionField().typed);
  const pre = await F.c.setProgressionField('Bb7 - Dm');
  check('before a compose the field\'s pins are Compose\'s progression ({ ratio, quality }), the text kept, the entry dirty', !pre.live && s.progression.length === 3 && s.progression[0].quality === 'dominant_7th' && s.progression[1] === null && s.field.text === 'Bb7 - Dm' && s.dirty);
  check('… the lab\'s root editor reads the same list as ratios', F.c.progression()[0] === s.progression[0].ratio && F.c.progression()[1] === null);
  await F.c.compose();
  check('Compose honors it: bars 1 and 3 targeted on the field\'s roots; the field kept as typed (flats stay flats)', s.spec.chords[0].targeted && s.spec.chords[0].rootTone === s.progression[0].ratio && s.spec.chords[2].targeted && F.c.progressionField().text === 'Bb7 - Dm');
  const text = 'Bb7, Am7, Dm7 G7';   // a plain field: a bar line would make it a chart (CHART_ORDER.md P2)
  const t = await F.c.setProgressionField(text);
  const res = t.resolution;
  check(`with a composition the field is live: its typed bars are typed chord edits (${Object.keys(s.edits.chords).length}), nothing re-solved, not dirty`, t.live && t.ok && F.solves() === 1 && !s.dirty && Object.values(s.edits.chords).every((e) => e.from === 'typed'));
  check('… each edit\'s root the field\'s pin, its asked quality kept for the next Compose', res.pins.every((p, k) => !p || (s.edits.chords[k] ? s.edits.chords[k].rootTone === p.ratio && s.edits.chords[k].asked === p.quality : s.spec.chords[k].targeted)));
  check('… and the bars play those roots', res.pins.every((p, k) => !p || s.spec.chords[k].rootTone === p.ratio));
  check('… a quality the bar supports plays as asked; one it doesn\'t falls back as Compose would', res.perBar.every((b) => !b.pin || b.quality.support === 'fallback' || !s.edits.chords[b.bar] || s.edits.chords[b.bar].quality === b.pin.quality));
  const pf = F.c.progressionField();
  check('the field reads back as typed, its separators and flats kept; the resolution per bar (cents, amber) with it', pf.text === text && pf.typed && pf.resolution.perBar.length === s.spec.knobs.bars && pf.resolution.perBar[0].root.label !== undefined);
  const a2 = F.c.alternatesOf(2, 'chords'), c2 = a2.candidates.find((x) => !x.current);
  await F.c.swapChord(2, c2);
  const toks = tokenizeField(s.field.text);
  check(`a swap rewrites only its own bar's symbol: "${s.field.text}"`, toks.length === 4 && toks[0].text === 'Bb7' && toks[1].text === 'Am7' && toks[3].text === 'G7' && s.field.text.split(',').length === 3 && s.edits.chords[2].from === 'swap');
  await F.c.undo();
  check('undo brings the text back too', s.field.text === text);
  await F.c.setProgressionField('Bb7 - Dm7');
  check('an auto bar in the field has no chord edit and no pin', !(1 in s.edits.chords) && !(3 in s.edits.chords) && s.progression[1] == null);
  check('rewriteToken keeps the rest of the text; a bar past it is reached with autos; trailing autos cut', rewriteToken('Bb7 | Am7', 1, 'D') === 'Bb7 | D' && rewriteToken('Bb7', 2, 'D') === 'Bb7 - D' && rewriteToken('Bb7 - D', 2, '-') === 'Bb7');
}

// ── 2. a re-compose (decision 5) ──
console.log('\n— a re-compose: pins kept, lead edits dropped');
{
  const R = lab([41, 42, 43, 0], 8), s = R.c.state;
  await R.c.compose();
  const a1 = R.c.alternatesOf(1, 'chords'), c1 = a1.candidates.find((x) => !x.current);
  await R.c.swapChord(1, c1);
  const la = R.c.alternatesOf(0, 'lead');
  await R.c.swapLead(la.phrase, la.lines[1].id);
  R.c.setSeed(7);
  check('a seed change: the entry dirty, the edits still playing over the old spec until Compose', s.dirty && s.spec.chords[1].rootTone === c1.root.ratio && R.c.hasEdits());
  await R.c.compose();
  check('Compose: the chord edit kept as a pin, { ratio, quality }, in the pin list Compose was sent', J(s.progression[1]) === J({ ratio: c1.root.ratio, quality: c1.quality }) && J(s.spec.input.progression?.[1]) === J({ ratio: c1.root.ratio, quality: c1.quality }));
  check('… the new spec pins bar 2 on it (targeted); the seed moved the rest', s.spec.chords[1].targeted && s.spec.chords[1].rootTone === c1.root.ratio && s.spec.input.seed === 7);
  check('… the lead edit dropped, and said (state.dropped.lead)', !R.c.hasEdits() && s.dropped?.lead?.length === 1 && s.dropped.lead[0].phrase === la.phrase && s.spec === s.composed);
  check('… the undo stack cleared with the old spec (proposed)', !R.c.canUndo() && !R.c.canRedo());
  // a pin past the new meter, and one the new row lacks
  const a2 = R.c.alternatesOf(3, 'chords');
  await R.c.swapChord(3, a2.candidates.find((x) => !x.current));
  R.c.setKnob('bars', 2);
  await R.c.compose();
  check(`a pin past the bars Compose now uses is dropped and flagged (${J(s.dropped?.pins?.map((x) => x.reason))})`, s.dropped?.pins?.some((x) => x.bar === 3 && x.reason === 'pastBars') && s.progression.length <= 2);
  R.c.setKnob('bars', null);
  await R.c.compose();
  const a5 = R.c.alternatesOf(1, 'chords'), c5 = a5.candidates.find((x) => !x.current);
  await R.c.swapChord(1, c5);
  R.c.setLayers([8, 7, 6, 5]);
  await R.c.compose();
  const gone = !materialsOf(s.composed).row.tones.includes(c5.root.ratio);
  check(`new layers: a pin whose root the new row lacks is dropped and flagged amber (${c5.root.ratio} ${gone ? 'is not' : 'is'} a tone of 8:7:6:5)`, gone && s.dropped?.pins?.some((x) => x.bar === 1 && x.reason === 'notInRow' && x.ratio === c5.root.ratio) && !s.spec.chords[1]?.targeted && s.progression.every((x) => x == null || x.ratio !== c5.root.ratio));
}

console.log('\n— the drum grid');
{
  const D = lab([41, 42, 43, 0], 8), s = D.c.state;
  await D.c.compose();
  const choices = drumModeChoices().map((x) => x.id);
  check('the controller\'s drum modes now offer grid and prime (labelled), after every preset', J(choices) === J(ALL_DRUM_MODES) && drumModeChoices().find((x) => x.id === 'grid').label.startsWith('grid') && drumModeChoices().find((x) => x.id === 'prime').label.startsWith('prime'));
  const g0 = D.c.drumGrid();
  check('drumGrid(): the backbeat written as a grid (gridOf), not the entry\'s own yet', !g0.own && g0.mode === 'backbeat' && J(g0.grid) === J(gridOf(s.drums)) && g0.places === s.spec.knobs.slotsPerBar);
  const r = await D.c.setDrumCell(1, 'perc', 3, 'X');
  check('setDrumCell: the mode turns to grid, the grid starts from the drums as they played, the cell set', r.ok && s.drumOptions.mode === 'grid' && s.drumOptions.grid.perc[1][3] === 'X' && s.drumOptions.grid.kick[0] === g0.grid.kick[0] && J(s.edits.grid) === J({ bars: s.spec.knobs.bars, slotsPerBar: s.spec.knobs.slotsPerBar, from: 'backbeat' }));
  check('… the stroke plays (a perc hit in bar 2 at place 3, accented), nothing re-composed, not dirty', s.drums.hits.some((h) => h.voice === 'perc' && h.bar === 1 && Math.round(h.pos) === 3) && D.solves() === 1 && !s.dirty);
  await D.c.applyDrumPreset('son');
  check('applyDrumPreset: the preset plays as itself (its own arrangement), the grid shows it', s.drumOptions.mode === 'son' && !s.drumOptions.grid && J(s.drums.hits) === J(arrangeDrums(s.spec, { ...s.drumOptions }).hits) && J(D.c.drumGrid().grid) === J(gridOf(s.drums)));
  await D.c.setDrumGrid(gridOf(s.drums));
  check('setDrumGrid(gridOf(preset)): the grid plays the preset\'s own strokes', s.drumOptions.mode === 'grid' && J(s.drums.hits.map((h) => [h.voice, h.tick])) === J(arrangeDrums(s.spec, { ...s.drumOptions, mode: 'son', grid: undefined }).hits.map((h) => [h.voice, h.tick])));
  await D.c.undo();
  check('undo: back to the preset', s.drumOptions.mode === 'son' && !s.drumOptions.grid);
  await D.c.undo(); await D.c.undo();
  check('… and back to the backbeat, no grid', s.drumOptions.mode === 'backbeat' && !s.drumOptions.grid);
  await D.c.applyDrumPreset('prime');
  check('the prime mode as a preset', s.drumOptions.mode === 'prime' && s.drums.prime && s.drums.prime.p > 0);
  await D.c.setDrumCell(0, 'kick', 1, 'x');
  check('a cell edit in the prime mode keeps it prime (the grid\'s perc row is its selection)', s.drumOptions.mode === 'prime' && s.drumOptions.grid.kick[0][1] === 'x');
  await D.c.applyDrumPreset('backbeat');
  await D.c.setDrumCell(0, 'snare', 0, 'x');
  D.c.setSeed(9);
  await D.c.compose();
  check('a re-compose on the same meter keeps the grid', s.drumOptions.mode === 'grid' && s.drumOptions.grid?.snare?.[0]?.[0] === 'x' && !s.dropped?.grid);
  D.c.setKnob('slotsPerBar', s.spec.knobs.slotsPerBar === 6 ? 8 : 6);
  await D.c.compose();
  check(`a new meter drops it, and says so; the mode goes back to the one it came from (${s.drumOptions.mode})`, !s.drumOptions.grid && s.drumOptions.mode === 'backbeat' && s.dropped?.grid?.now?.slotsPerBar === s.spec.knobs.slotsPerBar && s.edits.grid === null);
  let threw = false; try { D.c.setDrumCell(0, 'kick', 99, 'x'); } catch { threw = true; }
  check('a cell off the grid is refused', threw);
  D.c.setDrums({ mode: 'grid' });
  check('the grid picked as a mode starts from the drums as they play', s.drumOptions.mode === 'grid' && J(s.drumOptions.grid) === J(gridOf(arrangeDrums(s.spec, { ...s.drumOptions, mode: 'backbeat', grid: undefined }))));
  // STEP 4c-prime: p is drawn from the composition's seed; an asked p the meter's cells outgrow is dropped, and said
  D.c.setDrums({ mode: 'prime', grid: null });
  const cellsOf = (spec) => spec.knobs.bars * spec.knobs.slotsPerBar * beatsOf(spec.knobs.slotsPerBar).m, c0 = cellsOf(s.spec);
  check(`the prime mode draws p from the composition's seed (${s.drums.prime.p} above ${c0} cells)`, s.drums.prime.drawn && s.drums.prime.p === drawPrime(c0, s.spec.input.seed) && s.drums.prime.p > c0);
  const asked = nextPrime(c0 + 1);
  D.c.setDrums({ p: asked });
  check(`an asked p plays (${asked})`, s.drums.prime.p === asked && !s.drums.prime.drawn);
  const b0 = s.spec.knobs.bars;
  D.c.setKnob('bars', 2 * b0);
  await D.c.compose();
  check(`a meter whose cells outgrow the asked p drops it, and says so (${J(s.dropped?.p)}); the prime mode draws its own`, s.spec.knobs.bars === 2 * b0 && cellsOf(s.spec) >= asked
    && s.dropped?.p?.was === asked && s.dropped.p.cells === cellsOf(s.spec) && !('p' in s.drumOptions) && s.drums.prime.drawn && s.drums.prime.p > cellsOf(s.spec));
}

console.log('\n— against is stable across a swap (drums.js, seeded per bar in step 4d)');
{
  let swaps = 0, moved = 0, bad = '';
  for (const [L, T, seed] of [[[41, 42, 43, 0], 8, 1], [[768, 769, 0, 0], 8, 3], [[119, 42, 15, 8], 8, 2], [[19, 17, 16, 15], 6, 1]]) {
    const full = compose(L, T, { seed, trace: { caps: { chordCandidates: 12 } } });
    const { trace, ...spec } = full, { row: rw, cells: cl } = materialsOf(spec), h = trace.events.find((e) => e.kind === 'harmony');
    const before = arrangeDrums(spec, { mode: 'against' });
    for (const ev of trace.events.filter((e) => e.kind === 'chord' && e.round === h.chosenRound)) for (const cand of ev.candidates) {
      const next = applyRearrange(spec, rearrange(spec, rw, cl, { bar: ev.bar, chord: cand }));
      const after = arrangeDrums(next, { mode: 'against' });
      swaps++;
      const perc = (d, k) => J(d.hits.filter((x) => x.voice === 'perc' && x.bar === k).map((x) => [x.tick, x.velocity]));
      for (let k = 0; k < spec.knobs.bars; k++) if (k !== ev.bar) { if (perc(before, k) !== perc(after, k)) bad ||= `${L.join(':')} swap at bar ${ev.bar} moved bar ${k}`; }
      if (perc(before, ev.bar) !== perc(after, ev.bar)) moved++;
    }
  }
  check(`${swaps} swaps: \`against\` never re-draws a bar other than the swapped one (${moved} swapped bars changed their own)`, !bad && swaps > 100, bad);
}

// ── 3. the worker ──
console.log('\n— the worker path for a big row');
class FakeWorker {
  constructor() { this.onmessage = null; this.posted = []; }
  postMessage(data) { this.posted.push(data.kind ?? 'compose'); setTimeout(() => this.onmessage?.({ data: structuredClone(answer(structuredClone(data))) }), 0); }
}
{
  const worker = new FakeWorker(), runner = createComposeRunner({ makeWorker: () => worker });
  const big = createComposerController({ runCompose: runner, createContext: () => ({}), timers, state: newCompositionState({ layers: [65536, 65535, 0, 0], cycleSeconds: 16, seed: 1 }) });
  big.state.table = 'lean';
  await big.compose();
  const s = big.state, n = s.composed.stats.onsets;
  check(`the row: ${n} onsets, past MAIN_THREAD_ONSETS (${MAIN_THREAD_ONSETS})`, n > MAIN_THREAD_ONSETS && s.status === 'ready');
  const a = big.alternatesOf(2, 'chords'), cand = a.candidates.find((x) => !x.current);
  let t0 = performance.now();
  const p = big.swapChord(2, cand);
  check('a swap goes to the worker: not applied yet, applying', big.applying() && s.spec === s.composed && worker.posted.includes('rearrange'));
  const r = await p;
  const tWorker = performance.now() - t0;
  const m = materialsOf(s.composed);
  t0 = performance.now();
  const local = rearrange({ ...s.composed, drums: undefined }, m.row, m.cells, { bar: 2, chord: { rootTone: cand.root.ratio, quality: cand.quality } });
  const tMain = performance.now() - t0;
  check('… it lands: the same spec as rearrange on this thread', r.ok && !big.applying() && J({ ...s.spec, drums: undefined }) === J(applyRearrange({ ...s.composed, drums: undefined }, local)));
  const b = big.alternatesOf(3, 'chords');
  t0 = performance.now();
  await big.swapChord(3, b.candidates.find((x) => !x.current));
  const tWorker2 = performance.now() - t0;
  check('the worker keeps the row per key: a second edit builds nothing new', keptMaterials() === 1 && worker.posted.filter((x) => x === 'rearrange').length === 2);
  console.log(`    (65536:65535, ${n} onsets: a swap through the worker ${tWorker.toFixed(0)} ms first (the row built there), ${tWorker2.toFixed(0)} ms after; rearrange on this thread ${tMain.toFixed(0)} ms with the row given)`);
  // two quickly: the first superseded by the second, the result the fold of both
  const c1 = big.alternatesOf(4, 'chords').candidates.find((x) => !x.current), c2 = big.alternatesOf(5, 'chords').candidates.find((x) => !x.current);
  const [x1, x2] = await Promise.all([big.swapChord(4, c1), big.swapChord(5, c2)]);
  check('two edits in flight: the first gives way to the second, which applies both', x1.superseded && x2.ok && s.spec.chords[4].rootTone === c1.root.ratio && s.spec.chords[5].rootTone === c2.root.ratio && J(orderedEdits(s.edits).map((e) => e.bar)) === J([2, 3, 4, 5]));
  const posts = worker.posted.length, u = big.undo();
  check('an undo of the last edit is the fold\'s own step: no worker call, applied before the call returns', s.spec.chords[5].rootTone === s.composed.chords[5].rootTone && !big.applying() && worker.posted.length === posts && (await u).ok);
}
{
  const worker = new FakeWorker(), runner = createComposeRunner({ makeWorker: () => worker });
  const small = createComposerController({ runCompose: runner, createContext: () => ({}), timers, state: newCompositionState({ layers: [19, 17, 16, 15], cycleSeconds: 6, seed: 2 }) });
  small.state.table = 'lean';
  await small.compose();
  const la = small.alternatesOf(0, 'lead');
  const a = small.swapChord(1, small.alternatesOf(1, 'chords').candidates.find((x) => !x.current));
  check('a small row\'s swap stays on this thread (applied before the call returns)', small.state.spec !== small.state.composed && !worker.posted.includes('rearrange'));
  await a;
  const p = small.swapLead(la.phrase, la.lines[1].id, { smooth: true });
  check('smoothPhrase always goes to the worker', small.applying() && worker.posted.includes('rearrange'));
  const r = await p, m = materialsOf(small.state.composed);
  const step1 = applyRearrange({ ...small.state.composed, drums: undefined }, rearrange({ ...small.state.composed, drums: undefined }, m.row, m.cells, { bar: 1, chord: small.state.edits.chords[1] }));
  const want = applyRearrange(step1, rearrange(step1, m.row, m.cells, { phrase: la.phrase, line: { notes: small.state.trace.lines[la.lines[1].id].notes } }, { smoothPhrase: true }));
  check('… and lands as rearrange with smoothPhrase', r.ok && J({ ...small.state.spec, drums: undefined }) === J(want) && small.state.edits.lead[la.phrase].smooth === true);
}

{
  // a worker answer that comes back after a Compose has landed is for the old spec: dropped, the state untouched
  const held = [];
  const worker = { onmessage: null, postMessage(data) { held.push(() => this.onmessage?.({ data: structuredClone(answer(structuredClone(data))) })); } };
  const runner = createComposeRunner({ makeWorker: () => worker });
  const w = createComposerController({ runCompose: runner, createContext: () => ({}), timers, mainThreadOnsets: 0, state: newCompositionState({ layers: [19, 17, 16, 15], cycleSeconds: 6, seed: 2 }) });
  w.state.table = 'lean';
  await w.compose();
  const cand = w.alternatesOf(1, 'chords').candidates.find((x) => !x.current);
  const p = w.swapChord(1, cand);
  w.setSeed(3);
  await w.compose();
  const fresh = w.state.composed;
  held.splice(0).forEach((go) => go());
  const r = await p;
  check('a worker edit answered after a re-compose landed is dropped: the new spec stands, its pin from the edit', r.superseded && w.state.spec === fresh && !w.hasEdits() && w.state.spec.chords[1].targeted && w.state.spec.chords[1].rootTone === cand.root.ratio);
}

// ── 4. the store and the tab ──
console.log('\n— the store: a new cycle carries the chord edits as pins');
{
  const store = createCompositionStore();
  const a = store.select({ layers: [41, 42, 43, 0], cycleSeconds: 8 });
  const ctl = createComposerController({ createContext: () => ({}), timers, state: a.state });
  ctl.state.table = 'lean';
  await ctl.compose();
  await ctl.setProgressionField('C');
  const c1 = ctl.alternatesOf(1, 'chords').candidates.find((x) => !x.current);
  await ctl.swapChord(1, c1);
  const la = ctl.alternatesOf(0, 'lead');
  await ctl.swapLead(la.phrase, la.lines[1].id);
  await ctl.setDrumCell(0, 'perc', 2, 'x');
  const b = store.select({ layers: [41, 42, 43, 0], cycleSeconds: 10 });
  check('the new cycle\'s entry: the chord edits as pins, no lead edit, the grid and the field copied', J(b.state.progression[1]) === J({ ratio: c1.root.ratio, quality: c1.quality }) && b.state.progression[0]?.ratio === a.state.edits.chords[0]?.rootTone
    && !Object.keys(b.state.edits.lead).length && b.state.edits.order.length === 0 && b.state.drumOptions.grid?.perc?.[0]?.[2] === 'x' && b.state.field?.text === a.state.field.text && tokenizeField(a.state.field.text).length === 2 && b.state.spec === null);
  b.state.drumOptions.grid.perc[0] = '........';
  check('… as copies', a.state.drumOptions.grid.perc[0][2] === 'x');
  check('the entry shape: composed, edits, field, undo, redo, dropped', ['composed', 'edits', 'field', 'undo', 'redo', 'dropped'].every((k) => k in newCompositionState()));
}

console.log('\n— the tab: recall with edits, no re-solve');
{
  let solves = 0, rhythm = { layers: [41, 42, 43, 0], cycleSeconds: 8 };
  const host = { readRhythm: () => rhythm };
  const store = createCompositionStore();
  const tab = createTabController({ host, runCompose: async (l, T, o) => { solves++; return compose(l, T, { ...o, worker: false }); }, createContext: () => ({}), timers, store });
  tab.core.state.table = 'lean';
  await tab.press();
  const key = tab.key();
  const c1 = tab.core.alternatesOf(2, 'chords').candidates.find((x) => !x.current);
  await tab.core.swapChord(2, c1);
  const edited = J(tab.state.spec);
  check('edits keep the entry recallable (never dirty)', store.recallable(key) && !tab.state.dirty);
  rhythm = { layers: [8, 7, 6, 5], cycleSeconds: 4 }; tab.syncRhythm();
  rhythm = { layers: [41, 42, 43, 0], cycleSeconds: 8 }; tab.syncRhythm();
  check('away and back: the entry recalled with its edits, nothing re-solved', tab.key() === key && J(tab.state.spec) === edited && tab.state.spec.chords[2].rootTone === c1.root.ratio && solves === 1 && store.recallable(key));
  const site = siteRhythm([41, 42, 43]), hl = tab.highlights({ compositeRhythm: site.compositeRhythm, grid: site.grid });
  check('the lit nodes are the edited parts\'', hl && PART_IDS.every((id) => hl.parts[id].notes.length === tab.state.spec.parts.find((p) => p.id === id).notes.length) && hl.missed === 0);
}

// ── 5. the page ──
console.log('\n— the page: the glyph, the strips, the lanes');
{
  function makeCtx() {
    const param = (value) => { const p = { value }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
    const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
    return { currentTime: 0, sampleRate: 48000, state: 'running', resume() {}, destination: node(), createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
      createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }), createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
      createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}) };
  }
  const dom = makeDom(), win = dom.window, doc = dom.document;
  const restore = installGlobals(dom);
  const layers = [19, 17, 16, 15], r = siteRhythm(layers);
  win.lrcModule = { currentRhythms: layers, currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm };
  win.toneRowPlayback = { isPlaying: false, cycleDuration: 6, stopPlayback() { this.isPlaying = false; }, updatePlayButton() {} };
  win.lrcVisuals = { currentPlotType: 'linear', composerOverlay: null, compositeRhythm: r.compositeRhythm, grid: r.grid, positions: r.compositeRhythm.map((_, i) => ({ x: i, y: 0, index: i })), setComposerOverlay(o) { this.composerOverlay = o; }, drawPlot() {}, setPlotType(t) { this.currentPlotType = t; } };
  const layerContent = doc.createElement('div'); layerContent.id = 'layer-controls-content'; doc.body.append(layerContent);
  let solves = 0;
  const bridge = createComposerBridge(win, { runCompose: async (l, T, o) => { solves++; return compose(l, T, { ...o, worker: false }); }, createContext: () => makeCtx(), timers: { ...timers, setTimeout: (f) => setTimeout(f, 0), clearTimeout() {} }, storage: { getItem: () => '0', setItem() {} }, session: { getItem: () => '1', setItem() {} }, motion: () => false });
  const tab = bridge.controller, core = tab.core, lens = bridge.lens;
  core.state.table = 'lean';
  await lens.press(); await settle();
  check('the glyph composes and plays the composition', lens.mode === 'composition' && core.state.status === 'playing' && solves === 1);
  const a = core.alternatesOf(1, 'chords'), c1 = a.candidates.find((x) => !x.current);
  core.setPart('lead', { sound: 'marimba' });
  await core.swapChord(1, c1);
  const player = core.player;
  check('an edit under the lens: the player plays the edited parts at once (its parts getter reads them)', core.state.status === 'playing' && notesOf({ parts: core.currentParts() }, 'chords') === notesOf(core.state.spec, 'chords') && core.currentParts().find((p) => p.id === 'lead').sound === 'marimba');
  const rows = stripRows({ parts: core.state.parts, drums: core.state.drums, drumOptions: core.state.drumOptions, levels: core.state.levels });
  check('the part strips read the edited entry (the lead\'s sound as set)', rows.find((x) => x.id === 'lead').sound === 'marimba' && rows.every((x) => x.has));
  const strips = layerContent.querySelector('.composition-part-strips');
  check('… and are drawn under the lens', !!strips && strips.querySelectorAll('.part-strip-btn').length === 6);
  check('the Scale readout\'s chord tones are the edited bar\'s', [...chordTonesByBar(core.state.spec, core.currentParts())[1]].includes(c1.root.ratio));
  await lens.press();
  check('back to the row: the composition stops, kept', lens.mode === 'row' && core.state.status !== 'playing' && core.state.spec.chords[1].rootTone === c1.root.ratio);
  const events = [];
  const off = lens.onChange((type, d) => events.push({ type, ...d }));
  await lens.press(); await settle();
  off();
  check('the glyph again: a recall of the edited composition, no re-solve, playing', events.some((e) => e.type === 'landed' && e.recalled) && solves === 1 && core.state.status === 'playing' && core.state.spec.chords[1].rootTone === c1.root.ratio);
  const left = doc.createElement('div'), inspector = doc.createElement('div'); doc.body.append(left, inspector);
  bridge.mountTab({ left, inspector }); bridge.showTab();
  const chordCells = left.querySelectorAll('.ctab-chord').map((x) => x.textContent);
  check(`the window's lanes show the edited chords (${chordCells.join(' ')})`, chordCells[1] === core.state.spec.chords[1].name && chordCells.join(' ') === names(core.state.spec));
  const exp = JSON.parse(core.exportJSON());
  check('JSON export: the composition as it plays (edits and all), plus the edits that made it', exp.chords[1].rootTone === c1.root.ratio && J(exp.edits.chords) === J(core.state.edits.chords) && J(exp.edits.order) === J(['chord:1']) && exp.parts.find((p) => p.id === 'lead').sound === 'marimba' && exp.playback);
  await core.undo();
  check('undo under the lens: back to Compose\'s spec, still playing, the lanes follow', core.state.spec === core.state.composed && core.state.status === 'playing' && !('edits' in JSON.parse(core.exportJSON())));
  bridge.hideTab(); await lens.press();
  restore();
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
