// assert-page-drum-edit.mjs — the drum steps' paint stroke and ⌘D (2026-11-11; DESIGN_NOTES "Drum steps: paint and
// duplicate"), in Node over dom-stub.mjs with the site's own composite rhythm (41:42:43 at 8 bars × 8 slots):
//   • the controller: setDrumCells (one undo step, checked before any write, a noop with nothing to change) and
//     duplicateDrumBars (every voice copied onto the bars after the run, one undo step, the copies stop at the last bar,
//     a run ending on the last bar refused with nothing changed)
//   • the window: Shift+click on a drum bar runs the selection from the last pick (the cells marked, the label "Bars
//     3–5 · Drums"), Shift+←/→ too, a plain click drops it; ⌘D / Ctrl+D duplicates and selects the copies, its default
//     (the browser's bookmark) prevented, not while typing, nothing on another part (still prevented)
//   • the paint stroke, Partitions' shift toggle (PartitionsBlocks.js renderBlocks): Shift+press a step and every step
//     entered with Shift and a button held takes its own click's edit, once a stroke; shown as it goes, landed on the
//     release as ONE setDrumCells (one undo step, ⌘Z takes it all back); the press's own click is not a second edit; a
//     step entered without Shift or without a button is left; Shift let go and the pointer leaving the grid end it too
//   node Composer/tests/assert-page-drum-edit.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from './compose-cycle.mjs';
import { DRUM_VOICES } from '../core/drums.js';
import { nextStep } from '../page/matrix.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function makeCtx() {
  const param = (value) => { const p = { value }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}

const dom = makeDom(), win = dom.window, doc = dom.document;
const restore = installGlobals(dom);
const r = siteRhythm([41, 42, 43, 0]);
win.lrcModule = { currentRhythms: [41, 42, 43, 0], currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm, currentLayerMap: r.layerMap };
win.toneRowPlayback = { isPlaying: false, cycleDuration: 8, stops: 0, stopPlayback() { this.isPlaying = false; this.stops++; } };
const canvas = doc.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
const ctx2d = canvas.getContext('2d');
win.lrcVisuals = {
  currentPlotType: 'linear', composerOverlay: null, draws: 0, compositeRhythm: r.compositeRhythm, grid: r.grid,
  positions: Array.from({ length: r.compositeRhythm.length }, (_, i) => ({ x: 40 + i, y: 100, index: i })),
  setComposerOverlay(o) { this.composerOverlay = o; this.drawPlot(); },
  drawPlot() { this.draws++; this.composerOverlay?.draw(ctx2d, { positions: this.positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false }); },
  setPlotType(t) { this.currentPlotType = t; this.drawPlot(); },
};
const layerBox = doc.createElement('div'); layerBox.id = 'layer-controls-content'; doc.body.append(layerBox);

const { createComposerBridge } = await import('../page/composer-bridge.js');
const bridge = createComposerBridge(win, { runCompose: async (l, T, o) => compose(l, T, o), createContext: () => makeCtx(), timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem() {} }, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const lane = (id) => qa(left, '.ctab-lane').find((l) => l.dataset.part === id);
const drumCell = (k) => qa(lane('drums'), '.ctab-cell')[k];
/** a keydown on the document, its preventDefault recorded */
const keydown = (key, extra = {}) => { const ev = { type: 'keydown', key, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; doc.dispatchEvent(ev); return ev; };
const grid = () => core.drumGrid().grid;
const barOf = (g, k) => DRUM_VOICES.map((v) => g[v][k]).join('|');
const label = () => q(inspector, '.ctab-insp-tab.active')?.textContent;
const note = () => q(inspector, '.ctab-editnote')?.textContent ?? '';

console.log('Drum steps: paint, duplicate, copy and paste');
core.setKnob('bars', 8); core.setKnob('slotsPerBar', 8);
q(left, '.ctab-go').click(); await settle();
const N = tab.state.spec.knobs.bars, W = core.drumGrid().places;
check(`composed 41:42:43 at 8 bars (${W} places a bar)`, N === 8 && W > 0 && !core.canUndo());

console.log('\n— the controller: setDrumCells');
const g0 = grid(), off0 = [...g0.kick[0]].findIndex((c) => c === '.'), on0 = [...g0.kick[0]].findIndex((c) => c !== '.');
let res = await core.setDrumCells([{ bar: 0, voice: 'kick', place: off0, value: 'x' }, { bar: 2, voice: 'hat', place: 0, value: 'X' }, { bar: 0, voice: 'kick', place: on0, value: '.' }]);
check('three cells, two bars: written, ONE undo step, the mode grid', res.ok && grid().kick[0][off0] === 'x' && grid().hat[2][0] === 'X' && grid().kick[0][on0] === '.' && tab.state.undo.length === 1 && tab.state.drumOptions.mode === 'grid'
  && JSON.stringify(res.changedBars) === '[0,2]');
await core.undo();
check('…one undo takes all three back (the preset again)', JSON.stringify(grid()) === JSON.stringify(g0) && !core.canUndo() && tab.state.drumOptions.mode !== 'grid');
await core.redo(); await core.undo(); tab.state.redo = [];
let threw = false;
try { core.setDrumCells([{ bar: 0, voice: 'kick', place: off0, value: 'x' }, { bar: 99, voice: 'kick', place: 0, value: 'x' }]); } catch { threw = true; }
check('a bad cell throws before any is written', threw && JSON.stringify(grid()) === JSON.stringify(g0) && !core.canUndo());
await core.setDrumCell(0, 'snare', 0, g0.snare[0][0]);   // the grid made own, unchanged
const u1 = tab.state.undo.length;
res = await core.setDrumCells([{ bar: 0, voice: 'snare', place: 0, value: g0.snare[0][0] }]);
check('nothing to change on an own grid: a noop, no undo step', res.noop && tab.state.undo.length === u1);
res = await core.setDrumCells([]);
check('no cells: a noop', res.noop && tab.state.undo.length === u1);
while (core.canUndo()) await core.undo();
tab.state.redo = [];

console.log('\n— the controller: duplicateDrumBars');
await core.setDrumCell(1, 'perc', 0, 'X');   // bars 0 and 1 differ for sure
const ga = grid(), ua = tab.state.undo.length;
res = await core.duplicateDrumBars(1, 2);
check('bar 2 copied onto bar 3, every voice, ONE undo step', res.ok && barOf(grid(), 2) === barOf(ga, 1) && tab.state.undo.length === ua + 1 && res.onto.from === 2 && res.onto.to === 3 && res.cut === 0
  && [0, 1, 3, 4, 5, 6, 7].every((k) => barOf(grid(), k) === barOf(ga, k)));
res = await core.duplicateDrumBars(4, 7);
check('bars 5–7 onto bar 8 only: the copies stop at the last bar (2 left out, no wrap onto bar 1)', res.ok && res.onto.from === 7 && res.onto.to === 8 && res.cut === 2 && barOf(grid(), 7) === barOf(ga, 4) && barOf(grid(), 0) === barOf(ga, 0)
  && JSON.stringify(res.changedBars) === '[7]');
const ub = tab.state.undo.length, gb = grid();
res = await core.duplicateDrumBars(5, 8);
check('a run ending on the last bar: refused, said, nothing changed, no undo step', res.ok === false && /last bar/.test(res.error) && tab.state.undo.length === ub && JSON.stringify(grid()) === JSON.stringify(gb));
threw = false; try { core.duplicateDrumBars(3, 3); } catch { threw = true; }
check('an empty run throws', threw);
await core.undo();
check('undo: bar 8 back as it was', barOf(grid(), 7) === barOf(ga, 7));
while (core.canUndo()) await core.undo();
tab.state.redo = [];

console.log('\n— the window: a run of drum bars');
drumCell(2).click();
check('click Drums bar 3: that bar, no run', tab.view.selected === 'drums' && tab.view.bar === 2 && tab.view.range === null && label() === 'Bar 3 · Drums');
drumCell(4).dispatchEvent({ type: 'click', shiftKey: true });
check('Shift+click bar 5: bars 3–5 selected, the label says so, bar 5\'s steps shown', JSON.stringify(tab.view.range) === '{"from":2,"to":5}' && tab.view.bar === 4 && label() === 'Bars 3–5 · Drums'
  && [2, 3, 4].every((k) => drumCell(k).classList.contains('selected')) && !drumCell(1).classList.contains('selected') && !drumCell(5).classList.contains('selected'));
check('the inspector says what ⌘D will do', /bars 3–5 selected/.test(q(inspector, '.ctab-dup-hint')?.textContent ?? '') && /onto bars 6–8/.test(q(inspector, '.ctab-dup-hint').textContent));
check('the plot lights the whole run (the cell\'s focus)', bridge.overlay.focus?.part === 'drums' && bridge.overlay.focus.from === 2 && bridge.overlay.focus.to === 5);
drumCell(0).dispatchEvent({ type: 'click', shiftKey: true });
check('Shift+click bar 1: the run from the anchor (bar 3) back to bar 1', JSON.stringify(tab.view.range) === '{"from":0,"to":3}');
drumCell(6).click();
check('a plain click drops the run', tab.view.range === null && tab.view.bar === 6);
q(left, '.ctab-matrix').focus();
keydown('ArrowLeft', { shiftKey: true }); keydown('ArrowLeft', { shiftKey: true });
check('Shift+← twice on the matrix: bars 5–7', JSON.stringify(tab.view.range) === '{"from":4,"to":7}');
keydown('ArrowUp');
check('another part drops the run', tab.view.selected === 'inner' && tab.view.range === null && tab.cell().to - tab.cell().from === 1);
qa(lane('chords'), '.ctab-cell')[1].dispatchEvent({ type: 'click', shiftKey: true });
check('Shift+click on another part is a plain pick', tab.view.selected === 'chords' && tab.view.range === null);

console.log('\n— the window: ⌘D');
await core.setDrumCell(2, 'perc', 1, 'X'); await core.setDrumCell(3, 'hat', 0, 'X');
const gd = grid(), ud = tab.state.undo.length;
drumCell(2).click(); drumCell(3).dispatchEvent({ type: 'click', shiftKey: true });
let ev = keydown('d', { metaKey: true }); await settle();
check('⌘D on bars 3–4: copied onto bars 5–6, ONE undo step, the bookmark prevented', ev.prevented && barOf(grid(), 4) === barOf(gd, 2) && barOf(grid(), 5) === barOf(gd, 3) && tab.state.undo.length === ud + 1
  && [0, 1, 2, 3, 6, 7].every((k) => barOf(grid(), k) === barOf(gd, k)));
check('…the copies selected, so ⌘D again fills on; the note says it', JSON.stringify(tab.view.range) === '{"from":4,"to":6}' && label() === 'Bars 5–6 · Drums' && /bars 3–4 copied onto bars 5–6/.test(note()));
ev = keydown('d', { ctrlKey: true }); await settle();
check('Ctrl+D (other systems): bars 5–6 onto 7–8', ev.prevented && barOf(grid(), 6) === barOf(gd, 2) && barOf(grid(), 7) === barOf(gd, 3) && tab.state.undo.length === ud + 2 && JSON.stringify(tab.view.range) === '{"from":6,"to":8}');
ev = keydown('d', { metaKey: true }); await settle();
check('⌘D on a run ending on the last bar: prevented, refused in amber, no undo step', ev.prevented && tab.state.undo.length === ud + 2 && /couldn't apply it: .*last bar/.test(note()) && !!q(inspector, '.ctab-editnote.amber'));
keydown('z', { metaKey: true }); await settle();
check('⌘Z: bars 7–8 back', barOf(grid(), 6) === barOf(gd, 6) && barOf(grid(), 7) === barOf(gd, 7) && barOf(grid(), 4) === barOf(gd, 2));
keydown('z', { metaKey: true }); await settle();
check('⌘Z again: bars 5–6 back', JSON.stringify(grid()) === JSON.stringify(gd));
drumCell(7).click();
const ue = tab.state.undo.length;
ev = keydown('d', { metaKey: true, repeat: true }); await settle();
check('a held ⌘D (a repeat) is prevented but does nothing more', ev.prevented && tab.state.undo.length === ue);
tab.selectCell('chords', 1);
ev = keydown('d', { metaKey: true }); await settle();
check('⌘D with the chords selected: prevented, nothing duplicated', ev.prevented && tab.state.undo.length === ue && JSON.stringify(grid()) === JSON.stringify(gd));
const field = q(left, '.ctab-field');
field.focus();
ev = keydown('d', { metaKey: true }); await settle();
check('⌘D while typing in the field: left to the browser', !ev.prevented && tab.state.undo.length === ue);
field.blur();
ev = keydown('d', { metaKey: true, shiftKey: true });
check('⇧⌘D is not ⌘D', !ev.prevented);

console.log('\n— ⌘C / ⌘V: copy and paste drum bars');
{
  drumCell(5).click();
  let e = keydown('v', { metaKey: true }); await settle();
  const u0 = tab.state.undo.length, g0 = grid();
  check('⌘V before any ⌘C: prevented, said in amber, nothing changed', e.prevented && /nothing copied yet/.test(note()) && !!q(inspector, '.ctab-editnote.amber') && tab.state.undo.length === u0);
  // the controller
  const clip = core.copyDrumBars(2, 4);
  check('copyDrumBars(2, 4): two bars of every voice at the grid\'s width, as they play now; nothing changes', clip.bars === 2 && clip.places === W && DRUM_VOICES.every((v) => JSON.stringify(clip.grid[v]) === JSON.stringify(g0[v].slice(2, 4))) && tab.state.undo.length === u0);
  let res = await core.pasteDrumBars(5, clip);
  check('pasteDrumBars(5, clip): bars 6–7 are bars 3–4, ONE undo step, nothing else moved', res.ok && res.paste && barOf(grid(), 5) === barOf(g0, 2) && barOf(grid(), 6) === barOf(g0, 3) && tab.state.undo.length === u0 + 1 && res.cut === 0 && res.remapped === null
    && [0, 1, 2, 3, 4, 7].every((k) => barOf(grid(), k) === barOf(g0, k)));
  await core.undo();
  res = await core.pasteDrumBars(7, clip);
  check('a paste stops at the last bar: one of two bars written, one left out, no wrap onto bar 1', res.ok && res.onto.from === 7 && res.onto.to === 8 && res.cut === 1 && barOf(grid(), 7) === barOf(g0, 2) && barOf(grid(), 0) === barOf(g0, 0));
  await core.undo();
  const wide = { places: 2 * W, bars: 1, grid: Object.fromEntries(DRUM_VOICES.map((v) => [v, [[...g0[v][2]].map((c) => c + '.').join('')]])) };
  res = await core.pasteDrumBars(0, wide);
  check(`a clip of another width (${2 * W} places onto ${W}) is laid by place in the bar`, res.ok && JSON.stringify(res.remapped) === JSON.stringify({ from: 2 * W, to: W }) && barOf(grid(), 0) === barOf(g0, 2));
  await core.undo();
  let threw = 0;
  for (const bad of [null, { places: W, bars: 1, grid: { kick: ['x'] } }, { places: W, bars: 1, grid: { cowbell: [g0.kick[0]] } }]) { try { await core.pasteDrumBars(0, bad); } catch { threw++; } }
  try { core.copyDrumBars(3, 3); } catch { threw++; }
  check('a bad clip or an empty run throws, nothing written', threw === 4 && JSON.stringify(grid()) === JSON.stringify(g0) && tab.state.undo.length === u0);
  // the window
  drumCell(2).click(); drumCell(3).dispatchEvent({ type: 'click', shiftKey: true });
  e = keydown('c', { metaKey: true }); await settle();
  check('⌘C on bars 3–4: prevented, said, nothing changed', e.prevented && /bars 3–4 copied/.test(note()) && tab.state.undo.length === u0 && JSON.stringify(grid()) === JSON.stringify(g0));
  drumCell(5).click();
  e = keydown('v', { metaKey: true }); await settle();
  check('⌘V on bar 6: bars 6–7 are bars 3–4, ONE undo step, the pasted bars selected and said', e.prevented && barOf(grid(), 5) === barOf(g0, 2) && barOf(grid(), 6) === barOf(g0, 3) && tab.state.undo.length === u0 + 1
    && JSON.stringify(tab.view.range) === '{"from":5,"to":7}' && /pasted onto bars 6–7/.test(note()));
  drumCell(7).click();
  e = keydown('v', { ctrlKey: true }); await settle();
  check('Ctrl+V on the last bar: one bar pasted, the rest said left out', e.prevented && barOf(grid(), 7) === barOf(g0, 2) && tab.state.undo.length === u0 + 2 && /left out: a paste stops at the last bar/.test(note()));
  keydown('z', { metaKey: true }); await settle(); keydown('z', { metaKey: true }); await settle();
  check('⌘Z twice: both pastes back', JSON.stringify(grid()) === JSON.stringify(g0) && tab.state.undo.length === u0);
  e = keydown('v', { metaKey: true, repeat: true }); await settle();
  check('a held ⌘V (a repeat) pastes nothing more', e.prevented && tab.state.undo.length === u0);
  tab.selectCell('chords', 1);
  const ec = keydown('c', { metaKey: true }), ev2 = keydown('v', { metaKey: true }); await settle();
  check('with the chords selected, ⌘C and ⌘V are the browser\'s', !ec.prevented && !ev2.prevented && tab.state.undo.length === u0);
  drumCell(2).click();
  const fieldEl = q(left, '.ctab-field'); fieldEl.focus();
  const et = keydown('v', { metaKey: true }); await settle();
  check('⌘V while typing in the field: the browser\'s', !et.prevented && tab.state.undo.length === u0);
  fieldEl.blur();
  const had = doc.getSelection; doc.getSelection = () => 'some selected text';
  const es = keydown('c', { metaKey: true });
  doc.getSelection = had;
  check('⌘C with text selected on the page: the browser\'s copy', !es.prevented);
}

console.log('\n— the paint stroke (Partitions\' shift toggle)');
tab.selectCell('drums', 0);
const steps = () => qa(inspector, '.ctab-step');
const stepEl = (v, i) => steps().find((b) => b.dataset.voice === v && b.dataset.place === String(i));
const charOf = (b) => (b.classList.contains('accent') ? 'X' : b.classList.contains('on') ? 'x' : '.');
const fire = (b, type, extra = {}) => { const e = { type, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; b.dispatchEvent(e); return e; };
const gp = grid(), up = tab.state.undo.length, line = gp.hat[0], P = [0, 1, 2, 3].filter((i) => i < W);
const calls = [], realSet = core.setDrumCells, realOne = core.setDrumCell, ones = [];
core.setDrumCells = (cells) => { calls.push(cells); return realSet(cells); };
core.setDrumCell = (...a) => { ones.push(a); return realOne(...a); };
const down = fire(stepEl('hat', P[0]), 'mousedown', { shiftKey: true, buttons: 1 });
for (const i of P.slice(1)) fire(stepEl('hat', i), 'mouseenter', { shiftKey: true, buttons: 1 });
fire(stepEl('hat', P[1]), 'mouseenter', { shiftKey: true, buttons: 1 });   // back over a step already painted
fire(stepEl('snare', P[0]), 'mouseenter', { shiftKey: false, buttons: 1 });   // Shift not held
fire(stepEl('kick', P[0]), 'mouseenter', { shiftKey: true, buttons: 0 });     // no button down
check('Shift+press, then drag: each step shows its own next step as it goes (. → x → X → .), the press\'s default prevented', down.prevented && P.every((i) => charOf(stepEl('hat', i)) === nextStep(line[i])));
check('…once a stroke: back over a painted step leaves it', charOf(stepEl('hat', P[1])) === nextStep(line[P[1]]));
check('…a step entered without Shift, or without a button, is left', charOf(stepEl('snare', P[0])) === gp.snare[0][P[0]] && charOf(stepEl('kick', P[0])) === gp.kick[0][P[0]]);
check('…nothing landed before the release (no edit, no undo step)', calls.length === 0 && tab.state.undo.length === up && JSON.stringify(grid()) === JSON.stringify(gp));
doc.dispatchEvent({ type: 'mouseup' });
fire(stepEl('hat', P[0]), 'click', { shiftKey: true });   // the press's own click (the browser's, after the release)
await settle();
check(`the release lands it: ONE setDrumCells of ${P.length} cells, ONE undo step`, calls.length === 1 && calls[0].length === P.length && tab.state.undo.length === up + 1 && P.every((i) => grid().hat[0][i] === nextStep(line[i])));
check('…the press\'s own click is not a second edit', ones.length === 0 && grid().hat[0][P[0]] === nextStep(line[P[0]]));
check('…the steps re-drawn from the grid as it plays now', P.every((i) => charOf(stepEl('hat', i)) === nextStep(line[i])));
keydown('z', { metaKey: true }); await settle();
check('⌘Z takes the whole stroke back', JSON.stringify(grid()) === JSON.stringify(gp) && tab.state.undo.length === up);
stepEl('perc', 0).click(); await settle();
check('a plain click is still one step through setDrumCell', ones.length === 1 && grid().perc[0][0] === nextStep(gp.perc[0][0]));
const gq = grid(), uq = tab.state.undo.length;
fire(stepEl('kick', 0), 'mousedown', { shiftKey: true, buttons: 1 });
fire(stepEl('kick', 1), 'mouseenter', { shiftKey: true, buttons: 1 });
doc.dispatchEvent({ type: 'keyup', key: 'Shift' }); await settle();
check('Shift let go ends the stroke: it lands (one undo step)', calls.length === 2 && tab.state.undo.length === uq + 1 && grid().kick[0][0] === nextStep(gq.kick[0][0]) && grid().kick[0][1] === nextStep(gq.kick[0][1]));
fire(stepEl('kick', 2), 'mouseenter', { shiftKey: false, buttons: 1 }); doc.dispatchEvent({ type: 'mouseup' }); await settle();
check('…and the drag on without Shift paints nothing more', calls.length === 2 && grid().kick[0][2] === gq.kick[0][2]);
fire(stepEl('cym', 0), 'mousedown', { shiftKey: true, buttons: 1 });
q(inspector, '.ctab-steps').dispatchEvent({ type: 'mouseleave' }); await settle();
check('the pointer leaving the grid ends the stroke too (one more step)', calls.length === 3 && tab.state.undo.length === uq + 2 && grid().cym[0][0] === nextStep(gq.cym[0][0]));
doc.dispatchEvent({ type: 'mouseup' }); await settle();
check('a release with no stroke open does nothing', calls.length === 3);
check('the step titles say Shift+drag paints', /Shift\+drag: paint/.test(stepEl('kick', 0).title));
core.setDrumCells = realSet; core.setDrumCell = realOne;

bridge.hideTab();
restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
