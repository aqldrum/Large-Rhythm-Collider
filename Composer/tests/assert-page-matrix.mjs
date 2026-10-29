// assert-page-matrix.mjs — STEP 4e: the Composer window's bar × part matrix and its context inspector
// (Composer/page/composer-tab.js, matrix.js, audition.js; the controller's audition helper), in Node over dom-stub.mjs
// with the site's own composite rhythm and a recording mock AudioContext:
//   • the matrix renders 6 rows × N bars, lead cells spanning their phrases, the typed field above the Chords row
//   • selecting a cell lights its notes on the mirrored plot (the overlay's getFocus seam); arrows move, Enter opens
//   • the alternates listed from alternatesOf; audition → keep applies a swap as one undo step; audition → revert
//     leaves no redo step (and keeps a redo stack that was there); audition at the next bar boundary while performing
//   • undo and redo through the keyboard handler (⌘Z / ⇧⌘Z / Ctrl), not while typing
//   • the typed field's inline resolution (✓ and amber), applied on Enter and on blur, the text kept as typed
//   • the drum step grid: a click cycles . → x → X through setDrumCell; the presets; a silent cell hollow; the prime
//     strip from the prime output
//   • the narrow fallback: the bar picker and the container query
//   • the edits reach the part strips and the glyph's recall
//   • comping in chords (COMP_ARP_ORDER.md A4): a borrowed tone's dot hollow in the comp row, its source ringed on the
//     plot (the cell's focus), the comp cell's line "N strokes · P% from the row" (the share behind Details), the
//     trace's comp part carrying its voices
//   node Composer/tests/assert-page-matrix.mjs
import fs from 'node:fs';
import path from 'node:path';
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm, ROOT } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';
import { ALL_DRUM_MODES } from '../core/drums.js';
import { highlightsOf, plotOf, indexOfTick } from '../page/plot-highlights.js';
import { matrixModel, moveCell, nextStep, fieldStrip, retuneRanges, waitToBoundary, primeStrip, NARROW_PX, phraseSpans } from '../page/matrix.js';
import { dominantLayer } from '../page/part-strips.js';
import { CONTEXT_SECTION } from '../page/tab-controller.js';

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
function setRhythm(layers) {
  const r = siteRhythm(layers);
  win.lrcModule = { currentRhythms: layers, currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm, currentLayerMap: r.layerMap };
  win.lrcVisuals.compositeRhythm = r.compositeRhythm; win.lrcVisuals.grid = r.grid;
  win.lrcVisuals.positions = Array.from({ length: r.compositeRhythm.length }, (_, i) => ({ x: 40 + i, y: 100, index: i }));
  return r;
}
win.toneRowPlayback = { isPlaying: false, cycleDuration: 8, stops: 0, stopPlayback() { this.isPlaying = false; this.stops++; } };
const canvas = doc.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
const ctx2d = canvas.getContext('2d');
win.lrcVisuals = {
  currentPlotType: 'linear', composerOverlay: null, draws: 0, compositeRhythm: null, grid: 0, positions: [],
  setComposerOverlay(o) { this.composerOverlay = o; this.drawPlot(); },
  drawPlot() { this.draws++; this.composerOverlay?.draw(ctx2d, { positions: this.positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false }); },
  setPlotType(t) { this.currentPlotType = t; this.drawPlot(); },
};
// the Playback div's layer controls, where the lens's part strips go
const layerBox = doc.createElement('div'); layerBox.id = 'layer-controls-content'; doc.body.append(layerBox);
setRhythm([41, 42, 43, 0]);

const audio = makeCtx();
let composes = 0;
const { createComposerBridge } = await import('../page/composer-bridge.js');
// the module worker, faked in this thread: compose-worker.js' own answer a few ms later (smoothPhrase always goes there)
let workerJobs = 0;
const runCompose = async (l, T, o) => { composes++; return compose(l, T, o); };
runCompose.rearrange = (job) => { workerJobs++; return new Promise((resolve) => setTimeout(() => resolve(answer({ id: workerJobs, kind: 'rearrange', ...job }).result), 5)); };
const bridge = createComposerBridge(win, { runCompose, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem() {} }, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const lanes = () => qa(left, '.ctab-lane'), lane = (id) => lanes().find((l) => l.dataset.part === id);
const keydown = (key, extra = {}) => doc.dispatchEvent({ type: 'keydown', key, ...extra });

console.log('STEP 4e — the matrix and the context inspector');
console.log('\n— the matrix');
core.setKnob('bars', 8); core.setKnob('slotsPerBar', 8);
q(left, '.ctab-go').click(); await settle();
const spec0 = tab.state.spec, N = spec0.knobs.bars, spans = phraseSpans(spec0);
check(`composed 41:42:43 at 8 bars × ${spec0.knobs.slotsPerBar} (${spans.length} phrases)`, N === 8 && spans.length >= 2);
check('six rows, in the lanes\' order, each a part', lanes().length === 6 && lanes().map((l) => q(l, '.ctab-lane-name').textContent).join() === 'Lead,Chords,Comping,Bass,Inner,Drums');
check('a column a bar: Chords, Comping, Bass, Inner, Drums have N cells; the bar numbers too', ['chords', 'comp', 'bass', 'inner', 'drums'].every((id) => qa(lane(id), '.ctab-cell').length === N) && qa(left, '.ctab-mnum').length === N);
const leadCells = qa(lane('lead'), '.ctab-cell');
check(`lead cells span their phrases (${leadCells.map((c) => c.style.gridColumn).join(' | ')})`, leadCells.length === spans.length && leadCells.every((c, i) => c.dataset.bar === String(spans[i].from) && (spans[i].bars === 1 || c.style.gridColumn === `${spans[i].from + 1} / span ${spans[i].bars}`)));
check('the cells are mini views: dots for the notes, the chord names, the drum grid in miniature', qa(lane('lead'), '.ctab-dot').length === tab.state.parts.lead.notes.length
  && qa(lane('chords'), '.ctab-chord').map((c) => c.textContent).join() === spec0.chords.map((c) => (c.empty ? '—' : c.name)).join() && qa(lane('drums'), '.ctab-mini').length === N
  && qa(lane('drums'), '.ctab-mstep').length === N * 5 * core.drumGrid().places);
check('alternates badges where there are alternates (chords, lead); none on bass', qa(lane('chords'), '.ctab-badge').length > 0 && qa(lane('lead'), '.ctab-badge').length > 0 && qa(lane('bass'), '.ctab-badge').length === 0
  && Number(q(lane('chords'), '.ctab-badge').textContent) === core.alternatesOf(Number(q(lane('chords'), '.ctab-badge').parentNode.dataset.bar), 'chords').candidates.filter((c) => !c.current).length);
const kids = q(left, '.ctab-matrix').children;
check('the typed field runs across the top of the Chords row', kids.findIndex((c) => c.classList.contains('ctab-fieldrow')) === kids.indexOf(lane('chords')) - 1 && q(left, '.ctab-field-strip').children.length === N);
check('nothing edited yet: no edited marks', qa(left, '.ctab-cell.edited').length === 0 && !core.canUndo());

console.log('\n— selecting a cell lights it on the plot');
const chordCell = (k) => qa(lane('chords'), '.ctab-cell')[k];
chordCell(1).click();
const lit = bridge.overlay.highlights, focus = bridge.overlay.focus;
const want = [...new Set(tab.state.parts.chords.notes.filter((n) => n.bar === 1).map((n) => indexOfTick(lit.plot.ticks, n.tick)))].sort((a, b) => a - b);
check('click Chords bar 2: the cell selected, the inspector on its context', tab.view.selected === 'chords' && tab.view.bar === 1 && tab.view.section === CONTEXT_SECTION && chordCell(1).classList.contains('selected') && q(inspector, '.ctab-insp-tab.active').textContent === 'Bar 2 · Chords');
check(`the plot rings exactly that cell's notes (${focus?.indices.length} nodes)`, focus && focus.part === 'chords' && JSON.stringify(focus.indices) === JSON.stringify(want) && want.length > 0 && want.every((i) => lit.parts.chords.indices.includes(i)));
qa(lane('lead'), '.ctab-cell')[1].click();
const lf = bridge.overlay.focus, leadWant = new Set(tab.state.parts.lead.notes.filter((n) => n.bar >= spans[1].from && n.bar < spans[1].from + spans[1].bars).map((n) => indexOfTick(lit.plot.ticks, n.tick)));
check('a lead cell lights its whole phrase', lf.part === 'lead' && lf.from === spans[1].from && lf.indices.length === leadWant.size && tab.view.bar === spans[1].from);
tab.setSection('tuning');
win.lrcVisuals.drawPlot();
check('on a settings section the plot rings the whole part again (no focus)', bridge.overlay.focus === null);
tab.selectCell('chords', 1);
const matrixEl = q(left, '.ctab-matrix');
matrixEl.focus();
keydown('ArrowRight');
check('arrow right on the matrix: the next bar', tab.view.selected === 'chords' && tab.view.bar === 2);
keydown('ArrowDown'); keydown('ArrowUp'); keydown('ArrowUp');
check('arrow down then up twice: Lead (the bar kept)', tab.view.selected === 'lead' && tab.view.bar === 2);
keydown('ArrowRight');
check('arrow right on a lead cell: the next phrase', tab.view.bar === spans[1].from);
check('moveCell clamps at the edges', JSON.stringify(moveCell({ part: 'drums', bar: N - 1 }, 'ArrowRight', { bars: N, spans })) === JSON.stringify({ part: 'drums', bar: N - 1 }) && moveCell({ part: 'lead', bar: 0 }, 'ArrowUp', { bars: N, spans }).part === 'lead');
tab.selectCell('chords', 1); tab.setSection('tuning'); matrixEl.focus();
keydown('Enter');
check('Enter opens the cell: its context, focus on its first alternate', tab.view.section === CONTEXT_SECTION && doc.activeElement?.classList?.contains('ctab-alt'));

console.log('\n— the chords context: the alternates, audition, keep, revert');
const alts = core.alternatesOf(1, 'chords');
const altEls = () => qa(inspector, '.ctab-alt');
check(`the 12 candidates from alternatesOf (${altEls().length}), the current and Compose's marked`, altEls().length === alts.candidates.length && alts.candidates.length === 12
  && altEls()[alts.currentIndex].classList.contains('current') && altEls()[alts.composedIndex].classList.contains('composed') && /root|now/.test(q(inspector, '.ctab-ctx-head').textContent));
check('each lists its name, root ratio and cents, quality and support (✓ or amber)', altEls().every((b, i) => b.textContent.includes(alts.candidates[i].label) && b.textContent.includes(alts.candidates[i].root.ratio))
  && altEls().every((b, i) => q(b, '.ctab-alt-support').classList.contains('amber') === alts.candidates[i].violations > 0));
const other = alts.candidates.findIndex((c, i) => i !== alts.currentIndex && !(c.root.ratio === spec0.chords[1].rootTone && c.quality === spec0.chords[1].quality));
const before = { undo: tab.state.undo.length, redo: tab.state.redo.length };
altEls()[other].click(); await settle();
check(`a first click auditions it (not performing: applied now): bar 2 plays ${alts.candidates[other].label}`, tab.state.spec.chords[1].rootTone === alts.candidates[other].root.ratio && tab.state.spec.chords[1].quality === alts.candidates[other].quality
  && core.auditioning() && tab.state.undo.length === before.undo + 1);
check('…marked auditioning, Keep and Revert enabled', altEls()[other].classList.contains('auditioning') && !q(inspector, '.ctab-keep').disabled && !q(inspector, '.ctab-revert').disabled && core.auditioning());
check('…the cell shows edited', chordCell(1).classList.contains('edited') && q(chordCell(1), '.ctab-edited'));
altEls()[other].click(); await settle();
check('a second click keeps it: one undo step, no audition left, the edit a swap', !core.auditioning() && tab.state.undo.length === before.undo + 1 && tab.state.redo.length === 0 && tab.state.edits.chords[1]?.from === 'swap');
check('the matrix and the field show the swap', q(chordCell(1), '.ctab-chord').textContent === tab.state.spec.chords[1].name);
// undo it back to Compose's own, via the keyboard
matrixEl.focus();
keydown('z', { metaKey: true }); await settle();
check('⌘Z on the window: undone (bar 2 back to Compose\'s chord), a redo step', tab.state.spec.chords[1].rootTone === spec0.chords[1].rootTone && tab.state.spec.chords[1].quality === spec0.chords[1].quality && core.canRedo() && !core.canUndo());
keydown('z', { metaKey: true, shiftKey: true }); await settle();
check('⇧⌘Z: redone', tab.state.spec.chords[1].rootTone === alts.candidates[other].root.ratio && core.canUndo() && !core.canRedo());
keydown('z', { ctrlKey: true }); await settle();
check('Ctrl+Z (other systems): undone again', tab.state.spec.chords[1].rootTone === spec0.chords[1].rootTone && core.canRedo());
// audition then revert: no redo step left, and the redo stack that was there comes back
const redoBefore = tab.state.redo.length, undoBefore = tab.state.undo.length;
altEls()[other].click(); await settle();
check('audition with a redo step waiting (the swap cleared it for now)', core.auditioning() && tab.state.redo.length === 0);
const third = alts.candidates.findIndex((c, i) => i !== alts.currentIndex && i !== other);
altEls()[third].click(); await settle();
check('another alternate while auditioning: it replaces the audition', tab.state.spec.chords[1].rootTone === alts.candidates[third].root.ratio && tab.state.spec.chords[1].quality === alts.candidates[third].quality && core.auditioning());
keydown('Escape'); await settle();
check('Esc reverts: Compose\'s chord again, the undo stack as it was, the redo stack as it was (no redo step of its own)', tab.state.spec.chords[1].rootTone === spec0.chords[1].rootTone && tab.state.spec.chords[1].quality === spec0.chords[1].quality
  && !core.auditioning() && tab.state.undo.length === undoBefore && tab.state.redo.length === redoBefore && JSON.stringify(tab.state.spec.chords) === JSON.stringify(spec0.chords));
{ // straight on the controller: audition, revert, and nothing in redo when there was nothing
  while (core.canRedo()) await core.redo();
  while (core.canUndo()) await core.undo();
  tab.state.redo = [];
  const c = alts.candidates[other];
  await core.audition(() => core.swapChord(1, c));
  const mid = tab.state.redo.length;
  await core.revertAudition();
  check('controller: audition → revert leaves no redo step and no undo step', mid === 0 && tab.state.redo.length === 0 && tab.state.undo.length === 0 && !core.hasEdits());
  await core.audition(() => core.swapChord(1, c)); await core.audition(() => core.swapChord(2, core.alternatesOf(2, 'chords').candidates.find((x) => !x.current)));
  await core.keepAudition();
  check('controller: two auditions kept are ONE undo step', tab.state.undo.length === 1 && Object.keys(tab.state.edits.chords).length === 2);
  await core.undo();
  check('…and one undo takes both back', !core.hasEdits() && JSON.stringify(tab.state.spec.chords) === JSON.stringify(spec0.chords));
  tab.state.redo = []; tab.state.undo = [];
}
bridge.mountTab({ left, inspector }); tab.selectCell('chords', 1);
// audition at the next bar boundary while performing
q(left, '.ctab-go').click(); await settle(2);   // Perform
check('(performing)', tab.state.status === 'playing');
audio.currentTime = 0.05 + 0.2;   // 0.2 s into bar 1 (bars are 1 s): 0.8 s to the boundary
const T = tab.state.spec.knobs.cycleSeconds, barStarts = tab.state.spec.timeline.barStarts;
check('waitToBoundary: seconds to the next bar start (the loop counts)', Math.abs(waitToBoundary(0.2, barStarts, T) - (barStarts[1] - 0.2)) < 1e-9 && Math.abs(waitToBoundary(T - 0.1, barStarts, T) - 0.1) < 1e-9);
altEls()[other].click(); await settle();
check('performing, a first click is held for the next bar boundary (nothing applied yet)', tab.state.spec.chords[1].rootTone === spec0.chords[1].rootTone && /next bar/.test(q(inspector, '.ctab-audition').textContent));
dom.raf.flush(1); await settle();
check('…still held 0.8 s before it', tab.state.spec.chords[1].rootTone === spec0.chords[1].rootTone);
audio.currentTime = 0.05 + barStarts[1] - 0.25;   // 0.25 s before the boundary: inside the lead time
dom.raf.flush(1); await settle();
check('…applied just before the boundary (the player\'s lookahead then books bar 2 new)', tab.state.spec.chords[1].rootTone === alts.candidates[other].root.ratio && core.auditioning());
q(inspector, '.ctab-revert').click(); await settle();
check('Revert: back, no redo step', tab.state.spec.chords[1].rootTone === spec0.chords[1].rootTone && !core.canRedo() && !core.auditioning());
q(left, '.ctab-go').click(); await settle(2);   // Stop
audio.currentTime = 0;

console.log('\n— the lead context');
tab.selectCell('lead', spans[1].from);
const la = core.alternatesOf(spans[1].from, 'lead');
check(`the phrase's lines: Compose's and its runner-ups (${altEls().length}), cost a note each`, altEls().length === la.lines.length && la.lines.length >= 2 && altEls().every((b, i) => b.textContent.includes(la.lines[i].perNote.toFixed(3))) && q(inspector, '.ctab-smooth').disabled);
const chordsFollow = qa(inspector, '.ctab-toggle').find((b) => b.textContent === 'chords follow');
check('"chords follow" off by default', chordsFollow && !chordsFollow.classList.contains('on'));
altEls()[1].click(); await settle(); altEls()[1].click(); await settle();
check('a runner-up auditioned then kept: the lead swapped, chords kept (decision 1)', tab.state.edits.lead[1]?.lineId === la.lines[1].id && !tab.state.edits.lead[1].chordsFollow && JSON.stringify(tab.state.spec.chords.map((c) => c.name)) === JSON.stringify(spec0.chords.map((c) => c.name))
  && qa(lane('lead'), '.ctab-cell')[1].classList.contains('edited'));
qa(inspector, '.ctab-toggle').find((b) => b.textContent === 'chords follow').click(); await settle();
check('chords follow, on the swapped line: one more edit, the phrase\'s chords chosen again', tab.state.edits.lead[1]?.chordsFollow === true && tab.state.undo.length === 2);
q(inspector, '.ctab-smooth').click(); await settle(1);
check('smooth the phrase goes to the worker: "applying the edit in the worker…" meanwhile', core.applying() && workerJobs === 1 && /applying the edit in the worker/.test(q(left, '.ctab-status').textContent));
await new Promise((r) => setTimeout(r, 20)); await settle();
check('…then lands: the edit says smooth', tab.state.edits.lead[1]?.smooth === true && /smoothed/.test(q(inspector, '.ctab-smooth').textContent));
const leadIdx = new Set(tab.highlights({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid }).parts.lead.indices);
const composedLead = highlightsOf({ spec: tab.state.composed }, plotOf({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid })).parts.lead.indices;
check('the plot\'s lead is the swapped one', composedLead.join() !== [...leadIdx].sort((a, b) => a - b).join());

// a line held for the bar boundary takes a "chords follow" pressed while it waited (Avery, 2026-10-28: the follow was
// read at the click, so the line landed without it)
{
  const p0 = spans[0];
  tab.selectCell('lead', p0.from); await settle();
  const lines0 = core.alternatesOf(p0.from, 'lead')?.lines ?? [];
  if (lines0.length >= 2 && !tab.state.edits.lead[0]) {
    q(left, '.ctab-go').click(); await settle(2);   // Perform
    const bs = tab.state.spec.timeline.barStarts, nextBar = bs.findIndex((t) => t > 0.2);
    audio.currentTime = 0.05 + 0.2; dom.raf.flush(1); await settle();
    altEls()[1].click(); await settle();
    const held = /next bar/.test(q(inspector, '.ctab-audition')?.textContent ?? '');
    qa(inspector, '.ctab-toggle').find((b) => b.textContent === 'chords follow').click(); await settle();
    audio.currentTime = 0.05 + bs[nextBar] - 0.25; dom.raf.flush(1); await settle();
    check('a line held for the boundary, chords follow pressed while it waited: it lands with the follow', held && tab.state.edits.lead[0]?.lineId === lines0[1].id && tab.state.edits.lead[0].chordsFollow === true);
    q(inspector, '.ctab-revert').click(); await settle();
    qa(inspector, '.ctab-toggle').find((b) => b.textContent === 'chords follow').click(); await settle();   // the preference back off
    q(left, '.ctab-go').click(); await settle(2);   // Stop
    audio.currentTime = 0;
    check('…Revert takes it back, the preference off again', !tab.state.edits.lead[0] && !qa(inspector, '.ctab-toggle').find((b) => b.textContent === 'chords follow').classList.contains('on'));
  } else check('(phrase 1 has a runner-up and no edit, for the held-follow check)', false, `lines ${lines0.length}, edit ${JSON.stringify(tab.state.edits.lead[0])}`);
}

console.log('\n— bass, comping, inner');
tab.selectCell('bass', 2);
check('bass: "follows bar 3\'s chord", a way to its chord, its notes', /follows bar 3's chord/.test(q(inspector, '.ctab-ctx').textContent) && qa(inspector, '.ctab-notes tr').length === tab.state.parts.bass.notes.filter((n) => n.bar === 2).length + 1);
tab.selectCell('comp', 2);
// the comp in chords has no layer since Amendment 1 (the clave leads it; its picker is the window's Phase E): no layer pin
check(`comping: no comp layer pin (the clave ${tab.state.spec.clave.id} leads the comp)`, !q(inspector, '.ctab-pin') && !tab.state.spec.stats.compLayer);
tab.selectCell('inner', spans[1].from);
check('inner: smooth the phrase offered (the phrase\'s lead is swapped)', !q(inspector, '.ctab-smooth').disabled);
q(inspector, '.ctab-ctx-action').click();
check('"the chord ▸" selects the bar\'s chord', tab.view.selected === 'chords' && tab.view.bar === spans[1].from);

console.log('\n— the typed field');
const fieldEl = () => q(left, '.ctab-field');
// the chords as Compose named them (some whole, some a class short), bar 4 typed with a flat
const typed = tab.state.spec.chords.map((c, k) => (k === 3 ? 'Bb7' : c.empty ? '-' : c.name)).join(' ');
fieldEl().value = typed;
fieldEl().dispatchEvent({ type: 'keydown', key: 'Enter' }); await settle();
const pf = core.progressionField(), strip = fieldStrip(pf.resolution);
check('Enter applies it: the text kept as typed (flats stay flats)', tab.state.field?.text === typed && fieldEl().value === typed);
const resEls = qa(left, '.ctab-res');
check(`the inline resolution, a bar a column (${strip.map((b) => b.status).join(' ')})`, resEls.length === N && resEls.every((r, k) => r.classList.contains(strip[k].status) && q(r, '.ctab-res-name').textContent === strip[k].text));
check('✓ on a supported bar, amber with its reason on another', strip.some((b) => b.status === 'ok') && strip.some((b) => b.status === 'amber') && resEls.filter((r) => r.classList.contains('ok')).every((r) => q(r, '.ctab-res-mark')?.textContent === '✓')
  && resEls.filter((r) => r.classList.contains('amber')).every((r) => r.title.length > 0));
check('each typed bar is a live chord edit (from: typed), marked in the matrix', Object.values(tab.state.edits.chords).filter((e) => e.from === 'typed').length >= 1 && qa(lane('chords'), '.ctab-cell.edited').length >= 1);
const typed2 = 'D - Fmaj7';
fieldEl().value = typed2;
fieldEl().dispatchEvent({ type: 'blur' }); await settle();
check('leaving the field applies it too (auto bars: no edit)', tab.state.field?.text === typed2 && !tab.state.edits.chords[1]);
const undosNow = tab.state.undo.length;
fieldEl().focus();
keydown('z', { metaKey: true }); await settle();
check('⌘Z while typing in the field is the field\'s own (no composition undo)', tab.state.undo.length === undosNow);
fieldEl().blur();
check('fieldStrip: auto, error, ok and amber shapes', fieldStrip({ perBar: [{ bar: 0, kind: 'auto' }, { bar: 1, kind: 'error', token: { text: 'Hx' }, error: 'no' }] }).map((b) => b.status).join() === 'auto,error');

console.log('\n— the drums context');
tab.selectCell('drums', 0);
const grid0 = core.drumGrid();
check(`the bar's step grid: 5 voices × ${grid0.places} places`, qa(inspector, '.ctab-step').length === 5 * grid0.places);
const calls = [], realSet = core.setDrumCell;
core.setDrumCell = (...a) => { calls.push(a); return realSet(...a); };
const stepEl = (v, i) => qa(inspector, '.ctab-step').find((b) => b.dataset.voice === v && b.dataset.place === String(i));
const off = [...grid0.grid.perc[0]].findIndex((c) => c === '.');
stepEl('perc', off).click(); await settle();
check('a click on an off step calls setDrumCell(bar, voice, place, "x"): the mode turns to grid', calls.length === 1 && calls[0].join() === `0,perc,${off},x` && tab.state.drumOptions.mode === 'grid' && core.drumGrid().grid.perc[0][off] === 'x');
stepEl('perc', off).click(); await settle();
check('…again: "X" (an accent)', calls[1]?.[3] === 'X' && core.drumGrid().grid.perc[0][off] === 'X');
stepEl('perc', off).click(); await settle();
check('…again: "." (off)', calls[2]?.[3] === '.' && core.drumGrid().grid.perc[0][off] === '.');
check('nextStep cycles . → x → X → .', nextStep('.') === 'x' && nextStep('x') === 'X' && nextStep('X') === '.');
stepEl('perc', off).click(); await settle();
check('the drums cell shows edited while its grid differs from its preset (bar 1 only)', qa(lane('drums'), '.ctab-cell')[0].classList.contains('edited') && qa(lane('drums'), '.ctab-cell.edited').length === 1);
core.setDrumCell = realSet;
const presetEls = () => qa(inspector, '.ctab-preset');
check(`the presets: every mode and pattern, grid and prime (${presetEls().length})`, presetEls().map((b) => b.dataset.mode).join() === ALL_DRUM_MODES.join() && presetEls().some((b) => b.dataset.mode === 'grid') && presetEls().some((b) => b.dataset.mode === 'prime'));
presetEls().find((b) => b.dataset.mode === 'son').click(); await settle();
check('a pattern preset plays as itself (son), its own grid cleared', tab.state.drumOptions.mode === 'son' && !tab.state.drumOptions.grid && presetEls().find((b) => b.dataset.mode === 'son').classList.contains('active'));
presetEls().find((b) => b.dataset.mode === 'grid').click(); await settle();
check('the grid preset: the drums as they play, written as the grid (mode grid, own)', tab.state.drumOptions.mode === 'grid' && core.drumGrid().own);
presetEls().find((b) => b.dataset.mode === 'prime').click(); await settle();
const prime = tab.state.drums.prime;
check(`the prime preset: mode prime, p = ${prime?.p}`, tab.state.drumOptions.mode === 'prime' && prime && prime.p > N * spec0.knobs.slotsPerBar);
const lights = qa(inspector, '.ctab-light'), ps = primeStrip(prime, T, 0, barStarts);
check(`the prime strip: every level-1 light at its real time (${lights.length}), the chosen and struck marked`, lights.length === prime.p && qa(inspector, '.ctab-light.chosen').length === new Set(prime.chosen).size
  && qa(inspector, '.ctab-light.struck').length === new Set(prime.struck.map((s) => s.light)).size && lights.every((l, i) => l.style.left === `${(100 * (ps.lights[i].x ?? ps.lights[i].at)).toFixed(3)}%`));
check('…its p and range said', q(inspector, '.ctab-prime').textContent.includes(`p = ${prime.p}`) && q(inspector, '.ctab-prime').textContent.includes(`(${prime.range.above}, ${prime.range.upTo}]`) && q(inspector, '.ctab-prime-bar'));
check('every drum-mode list has grid and prime (the header select, the strips\' select)', qa(inspector, '.ctab-insp-head option').some((o) => o.value === 'grid') && qa(inspector, '.ctab-insp-head option').some((o) => o.value === 'prime'));

console.log('\n— the narrow fallback');
const picks = () => qa(left, '.ctab-barpick .ctab-pick');
check('the bar picker: a button a bar', picks().length === N);
picks()[5].click();
check('pick bar 6: the cells covering it marked in-pick (the matrix shows only them when narrow)', tab.view.bar === 5 && ['chords', 'bass', 'drums'].every((id) => qa(lane(id), '.ctab-cell').filter((c) => c.classList.contains('in-pick')).length === 1 && qa(lane(id), '.ctab-cell')[5].classList.contains('in-pick'))
  && qa(lane('lead'), '.ctab-cell.in-pick').length === 1 && picks()[5].classList.contains('active') && qa(left, '.ctab-res.in-pick').length === 1);
const css = fs.readFileSync(path.join(ROOT, 'Composer/page/composer-tab.css'), 'utf8');
check(`composer-tab.css: a container query at ${NARROW_PX} px shows the picker and one bar; wider, the matrix scrolls sideways`, css.includes(`@container ctab-left (max-width: ${NARROW_PX}px)`) && /container-type: inline-size/.test(css) && /\.ctab-barpick \{ display: none;/.test(css)
  && /\.ctab-matrix-wrap \{[^}]*overflow-x: auto/.test(css) && Number.parseInt(q(left, '.ctab-matrix').style.minWidth, 10) === 112 + N * 56);

console.log('\n— the pure model');
const model = matrixModel(tab.state, { grid: core.drumGrid(), alternates: () => 0, retuned: [2, 3, 5] });
check('matrixModel: 6 rows, the lead a cell a phrase, the drums a cell a bar', model.rows.length === 6 && model.rows[0].cells.length === spans.length && model.rows[5].cells.length === N && model.rows[5].cells[0].steps.kick.length === core.drumGrid().places);
check('retuneRanges: runs of bars', JSON.stringify(retuneRanges([5, 2, 3])) === JSON.stringify([{ from: 2, to: 3 }, { from: 5, to: 5 }]));
check('a retune is marked on the chord cell whose edit caused it', model.rows[1].cells.filter((c) => c.retune).length >= 1 && model.rows[1].cells[2].retuned);

console.log('\n— the edits reach the part strips and the glyph\'s recall');
const composesBefore = composes, edited = tab.state.spec;
check('(an edited composition: the lead swapped, chords typed)', edited !== tab.state.composed && core.hasEdits() && store().recallable());
function store() { return bridge.store; }
const phase = await bridge.lens.press();
check('the glyph recalls it: no Compose, it plays the edited spec', phase === 'landed' && composes === composesBefore && tab.state.status === 'playing' && tab.state.spec === edited && bridge.lens.mode === 'composition');
const strips = bridge.panels.strips.root, h = tab.highlights({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid });
const leadBtn = strips?.querySelectorAll('.part-strip-btn').find((b) => b.dataset.part === 'lead'), dot = leadBtn?.querySelector('.part-strip-layer');
check('the part strips read the edited composition: the lead\'s layer dot from the swapped lead\'s lit nodes', bridge.panels.strips.shown && dot && dot.dataset.layer === dominantLayer(h.parts.lead.indices, win.lrcModule.currentLayerMap));
const otherChord = core.alternatesOf(0, 'chords').candidates.find((c) => !c.current);
await core.swapChord(0, otherChord); await settle();
check('an edit under the lens: the strips re-render, the overlay lights the new chord', bridge.overlay.highlights.parts.chords.indices.join() === highlightsOf({ spec: tab.state.spec, parts: core.currentParts(), drums: tab.state.drums }, plotOf({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid })).parts.chords.indices.join());
await bridge.lens.press();

console.log('\n— a re-compose keeps chord pins, drops lead edits (decision 5), said in the window');
const pinsBefore = Object.keys(tab.state.edits.chords).length;
core.setSeed(7);
q(left, '.ctab-go').click(); await settle();
check(`Compose again: the chord edits are pins (${pinsBefore}), the lead edits dropped and said`, tab.state.status === 'ready' && !core.hasEdits() && (core.progressionInput() ?? []).filter(Boolean).length >= 1
  && tab.state.dropped?.lead?.length === 1 && /lead swap/.test(q(left, '.ctab-dropped').textContent) && q(left, '.ctab-dropped').style.display !== 'none');
check('the typed field\'s text kept', tab.state.field?.text != null && fieldEl().value === tab.state.field.text);

console.log('\n— a silent drum step (a sparse row)');
setRhythm([8, 7, 6, 5]);
win.dispatchEvent(new win.Event('rhythmGenerated'));
core.setKnob('bars', 8); core.setKnob('slotsPerBar', 8);   // 64 places over 22 onsets
// the strum before Amendment 3 (P34's pin: ±¼ slot, borrowing), so the borrowed tones below are there to draw
await core.setCompStrum({ borrow: true, tolerance: 0.25 });
q(left, '.ctab-go').click(); await settle();
const g8 = core.drumGrid(), full = Object.fromEntries(Object.entries(g8.grid).map(([v, rows]) => [v, rows.map((r) => (v === 'perc' ? 'x'.repeat(r.length) : r))]));
await core.setDrumGrid(full); await settle();
tab.selectCell('drums', 0);
const sc = core.drumGrid().silentCells;
check(`8:7:6:5 with a perc stroke on every place: silent cells (${sc.length}) shown hollow, "no onset here"`, sc.length > 0 && qa(inspector, '.ctab-step.silent').length === sc.filter((x) => x.bar === 0).length
  && qa(inspector, '.ctab-step.silent').every((b) => /no onset here/.test(b.title)) && qa(lane('drums'), '.ctab-mstep.silent').length === sc.length);

console.log('\n— comping in chords: borrowed tones (A4)');
{
  const comp = tab.state.parts.comp, chordsP = tab.state.parts.chords, bars = tab.state.spec.knobs.bars;
  const k = Array.from({ length: bars }, (_, i) => i).find((i) => comp.notes.some((n) => n.bar === i && n.borrowed)) ?? 0;
  const inBar = comp.notes.filter((n) => n.bar === k), borrowedHere = inBar.filter((n) => n.borrowed);
  const cellEl = lane('comp').querySelectorAll('.ctab-cell').find((c) => c.dataset.bar === String(k));
  check(`8:7:6:5's comp in chords: bar ${k + 1} has ${borrowedHere.length} borrowed of ${inBar.length} tones, drawn hollow in its cell`, borrowedHere.length > 0 && qa(cellEl, '.ctab-dot.borrowed').length === borrowedHere.length
    && qa(cellEl, '.ctab-dot').length === inBar.length && qa(cellEl, '.ctab-dot.borrowed').every((d) => d.style.color && !d.style.background));
  tab.selectCell('comp', k);
  const line = q(inspector, '.ctab-comp-line'), strokes = comp.strokes.filter((x) => x.bar === k).length, pct = Math.round(100 * (inBar.length - borrowedHere.length) / inBar.length);
  check(`the comp cell's line: "${line?.textContent}" — the share behind Details`, !!line && line.textContent === `${strokes} stroke${strokes === 1 ? '' : 's'} · ${pct}% from the row`
    && q(line, '.ctab-detail')?.textContent === ` · ${pct}% from the row` && /borrowed from the chord voices/.test(line.title));
  const plotted = { compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid }, f = tab.cellFocus(plotted), pl = plotOf(plotted);
  const srcIdx = [...new Set(borrowedHere.map((n) => indexOfTick(pl.ticks, chordsP.notes.find((c) => c.node === n.from).tick)))];
  const ownIdx = new Set(inBar.filter((n) => !n.borrowed).map((n) => n.node));
  check(`the cell's focus rings the borrowed tones' sources (${f.rings.join(', ')}), not their strokes' onsets`, f.part === 'comp' && f.rings.join() === srcIdx.filter((i) => !ownIdx.has(i)).sort((a, b) => a - b).join()
    && f.indices.join() === [...ownIdx].sort((a, b) => a - b).join());
  win.lrcVisuals.drawPlot();
  check('the overlay drew that focus, its rings hollow', bridge.overlay.focus?.part === 'comp' && bridge.overlay.focus.rings.join() === f.rings.join() && (bridge.overlay.highlights.parts.comp.rings.length > 0 || f.rings.length === 0));
  const ev = tab.state.trace?.events?.find((e) => e.kind === 'part' && e.part === 'comp');
  check('the trace\'s comp part carries every note\'s voice (the animation reads the lit notes, rings landing last)', !!ev && ev.notes.length === comp.notes.length && ev.notes.every((n) => Number.isInteger(n.voice)));
}

bridge.hideTab();
restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
