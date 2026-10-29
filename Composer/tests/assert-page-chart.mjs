// assert-page-chart.mjs — chord charts in the Composer window (Composer/CHART_ORDER.md, phase B): the Bars knob a
// number; a typed chart sets the bars (not live until Compose, the knob set by it); a split bar's chords in the matrix
// (at their places, a rule between), the field strip a column a bar, the inspector a section a chord, a swap kept and
// written into the chart, the root editor a select a chord. In Node over dom-stub.mjs, as assert-page-matrix.mjs.
//   node Composer/tests/assert-page-chart.mjs
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


console.log('Chord charts in the Composer window (CHART_ORDER.md, phase B)');
const fieldEl = () => q(left, '.ctab-field');
const chordCells = () => qa(lane('chords'), '.ctab-cell');
const barsKnob = () => qa(inspector, '.ctab-knob').find((k) => q(k, 'label')?.textContent === 'Bars');

console.log('\n— the Bars knob is a number');
tab.select('chords'); tab.setSection('lines');
check('the Bars knob is a number input, 1..64, blank for auto', !!barsKnob() && q(barsKnob(), 'input')?.type === 'number' && String(q(barsKnob(), 'input').max) === '64' && !q(barsKnob(), 'select'));
core.setKnob('bars', 12);
q(left, '.ctab-go').click(); await settle();
check(`12 bars asked: 12 bars composed (${tab.state.spec.knobs.bars})`, tab.state.spec.knobs.bars === 12 && chordCells().length === 12);
core.setKnob('bars', null);

console.log('\n— a chart typed, then Compose');
const TEXT = '| C | Am F | G . . C | Dm7 G7 |';
fieldEl().value = TEXT;
fieldEl().dispatchEvent({ type: 'keydown', key: 'Enter' }); await settle();
check('a chart of other bars is not live: the entry goes dirty (Compose to hear it)', tab.state.field?.text === TEXT && tab.state.dirty);
tab.select('chords'); tab.setSection('lines');
check('the Bars knob is set by the chart: disabled, "4 · the chart\'s"', q(barsKnob(), 'input').disabled && /4 · the chart's/.test(barsKnob().textContent));
q(left, '.ctab-go').click(); await settle();
const spec = tab.state.spec;
check(`composed: 4 bars, 7 chords (${spec.chords.map((c) => c.name).join(' ')})`, spec.knobs.bars === 4 && spec.chords.length === 7 && chordCells().length === 4);
const bar2 = chordCells()[1];
check('a split bar shows each chord at its place, a rule between', qa(bar2, '.ctab-chord-span').length === 2 && qa(bar2, '.ctab-span-rule').length === 1
  && qa(bar2, '.ctab-chord-span').map((x) => x.textContent).join() === [spec.chords[1].name, spec.chords[2].name].join() && qa(chordCells()[0], '.ctab-chord-span').length === 0);
check('"G . . C": the second chord three quarters in', /^calc\(75\.00% \+ 4px\)$/.test(qa(chordCells()[2], '.ctab-chord-span')[1].style.left) || Math.abs(parseFloat(qa(chordCells()[2], '.ctab-chord-span')[1].style.left.slice(5)) - 75) < 15);
const strip = qa(left, '.ctab-res');
check(`the field strip: a column a bar, a split bar's chords together ("${strip[1]?.textContent}")`, strip.length === 4 && /Am/.test(strip[1].textContent) && /F/.test(strip[1].textContent));
const badge = q(bar2, '.ctab-badge'), wantBadge = core.unitsOfBar(1).reduce((n, u) => n + (core.alternatesOf(u, 'chords')?.candidates.filter((c) => !c.current).length ?? 0), 0);
check(`the badge counts both chords' alternates (${badge?.textContent})`, wantBadge === 0 ? !badge : Number(badge?.textContent) === wantBadge);

console.log('\n— the inspector');
bar2.click(); await settle();
const heads = qa(inspector, '.ctab-ctx-head').map((h) => q(h, 'b').textContent);
check(`a split bar's context: each chord in turn (${heads.join(' | ')})`, heads.join('|') === 'Bar 2 · chord 1 of 2|Bar 2 · chord 2 of 2' && qa(inspector, '.ctab-audition').length === 1);
const a2 = core.alternatesOf(2, 'chords'), pick = a2?.candidates.find((c) => !c.current);
if (pick) {
  const btn = qa(inspector, '.ctab-alt').find((b) => b.dataset.key === `chord:2:${pick.root.ratio}:${pick.quality}`);
  btn.click(); await settle();
  check(`an alternate of the second chord auditions on its span (${tab.state.spec.chords[2].name})`, tab.state.spec.chords[2].rootTone === pick.root.ratio && tab.state.spec.chords[2].quality === pick.quality && tab.state.spec.chords[1].rootTone === spec.chords[1].rootTone);
  q(inspector, '.ctab-keep').click(); await settle();
  check(`kept: the chart rewritten in place ("${tab.state.field.text}")`, tab.state.field.text.startsWith('| C | Am ') && tab.state.field.text.endsWith('| G . . C | Dm7 G7 |') && !tab.state.field.text.includes(' F |'));
} else check('the second chord of bar 2 has an alternate', false);
tab.select('chords'); tab.setSection('harmony');
const labels = qa(q(inspector, '.ctab-prog'), 'label').map((l) => l.textContent);
check(`the root editor: a select a chord, labelled by bar and place (${labels.join(' ')})`, labels.join(' ') === 'Bar 1 Bar 2·1 Bar 2·2 Bar 3·1 Bar 3·2 Bar 4·1 Bar 4·2');

restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
