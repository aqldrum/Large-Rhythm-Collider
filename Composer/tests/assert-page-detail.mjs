// assert-page-detail.mjs — the clean view and its Details toggle (Composer/CLEAN_MIDI_ORDER.md, phase A), in Node over
// dom-stub.mjs with the site's own composite rhythm and a recording mock AudioContext:
//   • off by default and kept in storage (any access wrapped); the hosts carry ctab-details-on only with it on
//   • the clean view: the meter line, no readouts, no decisions, no JSON, the icons without their words, the advanced
//     knobs and every "chose" hidden, the chord candidates by name, no notes table
//   • Details on: everything as before, the clean view's short forms gone; toggling changes no spec and composes nothing
//   • an asked knob the clean view hides: the toggle's dot, naming it
// The stub has no CSS, so "seen" is the rule the stylesheet applies: a ctab-detail (or an ancestor) is hidden without
// ctab-details-on on its host, a ctab-clean-only with it, and an inline display: none always.
//   node Composer/tests/assert-page-detail.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { CONTEXT_SECTION } from '../page/tab-controller.js';
import { DETAILS_KEY, readDetails, writeDetails, hiddenSettings } from '../page/composer-tab.js';

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

console.log('Details — the clean view');
console.log('\n— the storage');
const mapStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const st0 = mapStorage();
check('unread: off', readDetails(st0) === false && readDetails(null) === false);
writeDetails(st0, true);
check(`written on: ${DETAILS_KEY} = "1", read on`, st0.m.get(DETAILS_KEY) === '1' && readDetails(st0) === true);
const throwing = { getItem() { throw new Error('refused'); }, setItem() { throw new Error('refused'); } };
let threw = false;
try { writeDetails(throwing, true); readDetails(throwing); } catch { threw = true; }
check('a storage that refuses: no throw, off', !threw && readDetails(throwing) === false);
check('hiddenSettings: the asked advanced knobs, labelled', hiddenSettings({ settlePasses: 2, anchors: 'even', bars: 4, presence: null }).join() === 'Settle passes 2,Anchors even' && hiddenSettings({}).length === 0);

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

const audio = makeCtx(), storage = mapStorage();
storage.setItem('lrc.composer.showWork', '0');
let composes = 0;
const { createComposerBridge } = await import('../page/composer-bridge.js');
const runCompose = async (l, T, o) => { composes++; return compose(l, T, o); };
const bridge = createComposerBridge(win, { runCompose, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} }, storage, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
/** what the stylesheet shows: no inline display: none on the way up, and the host's flag against the classes */
const seen = (e) => {
  if (!e) return false;
  let host = null;
  for (let x = e; x; x = x.parentNode) { if (x === left || x === inspector) { host = x; break; } }
  const on = !!host?.classList.contains('ctab-details-on');
  for (let x = e; x && x !== host?.parentNode; x = x.parentNode) {
    if (x.style?.display === 'none') return false;
    if (x.classList?.contains('ctab-detail') && !on) return false;
    if (x.classList?.contains('ctab-clean-only') && on) return false;
  }
  return true;
};
const knob = (label) => qa(inspector, '.ctab-knob').find((k) => q(k, 'label')?.textContent === label) ?? null;

console.log('\n— the clean view (the default)');
core.setKnob('bars', 8); core.setKnob('slotsPerBar', 8);
q(left, '.ctab-go').click(); await settle();
const spec0 = tab.state.spec;
check(`composed 41:42:43 at 8 × 8 (${composes} compose)`, spec0 && !spec0.refused && spec0.knobs.bars === 8);
check('off by default: no ctab-details-on on either host', !tab.view.details && !left.classList.contains('ctab-details-on') && !inspector.classList.contains('ctab-details-on'));
check(`the meter line is seen ("${q(left, '.ctab-summary').textContent}"), the readouts are not`, seen(q(left, '.ctab-summary')) && q(left, '.ctab-summary').textContent === '8 bars × 8' && !seen(q(left, '.ctab-readouts')) && q(left, '.ctab-readouts').children.length > 5);
check('no decisions, no JSON', !seen(q(left, '.ctab-decisions')) && !seen(qa(left, '.ctab-btn').find((b) => b.textContent === 'JSON')));
const undoBtn = q(left, '.ctab-undo');
check('Undo and Redo: their icons seen, their words not (the words still in the text)', seen(undoBtn) && !seen(q(undoBtn, '.ctab-word')) && undoBtn.textContent === '↶ Undo' && q(left, '.ctab-redo').textContent === '↷ Redo');
check('the Compose button, the seed, show the work and Details are seen', [q(left, '.ctab-go'), q(left, '.ctab-seed'), q(left, '.ctab-work'), q(left, '.ctab-details')].every(seen));
check('the matrix and the typed field are seen', seen(q(left, '.ctab-matrix')) && seen(q(left, '.ctab-field')) && qa(left, '.ctab-chord').every(seen));
tab.setSection('lines'); await settle();
check('Lines: Bars and Slots / bar seen, Anchors and Table not, no "chose" beside them', seen(knob('Bars')) && seen(knob('Slots / bar')) && !seen(knob('Anchors')) && !seen(knob('Table'))
  && !seen(q(knob('Bars'), '.ctab-chosen')) && /asked: 8/.test(q(knob('Bars'), '.ctab-chosen').textContent));
tab.setSection('harmony'); await settle();
check('Harmony: Modulation seen, Settle passes and Root presence not', seen(knob('Modulation')) && !seen(knob('Settle passes')) && !seen(knob('Root presence')));
check('… the progression\'s roots seen, what each bar got not', seen(q(inspector, '.ctab-prog select')) && qa(inspector, '.ctab-prog .ctab-chosen').every((c) => !seen(c)));
tab.setSection('tuning'); await settle();
check('Tuning: the root seen; baseHz, the retunes and the frame not', /root/.test(qa(inspector, '.ctab-readouts span').filter(seen).map((x) => x.textContent).join()) && !qa(inspector, '.ctab-readouts span').filter(seen).some((x) => /baseHz/.test(x.textContent)) && !seen(knob('Frame ±¢')));
tab.selectCell('chords', 0); tab.setSection(CONTEXT_SECTION); await settle();
const alts = qa(inspector, '.ctab-alt');
check(`a chord cell: the ${alts.length} candidates by name, their ratios and cents not`, alts.length > 1 && alts.every((a) => seen(q(a, '.ctab-alt-name')) && !seen(q(a, '.ctab-alt-ratio')) && !seen(q(a, '.ctab-alt-cents'))));
tab.selectCell('lead', 0); tab.setSection(CONTEXT_SECTION); await settle();
const lines = qa(inspector, '.ctab-alt');
check(`a lead cell: the runner-ups as line 1…${lines.length}, their costs not`, lines.length > 1 && lines.every((a, i) => seen(q(a, '.ctab-alt-rank')) && q(a, '.ctab-alt-rank').textContent === `line ${i + 1}` && qa(a, '.ctab-alt-name').filter(seen).length === 1));
tab.selectCell('bass', 0); tab.setSection(CONTEXT_SECTION); await settle();
check('a bass cell: the chord it follows seen, its notes table not', seen(qa(inspector, '.ctab-ctx-action').find((b) => /chord/.test(b.textContent))) && !seen(q(inspector, '.ctab-notes')));

console.log('\n— Details on');
const before = { spec: tab.state.spec, composes };
q(left, '.ctab-details').click(); await settle();
check('the toggle: on, stored, both hosts carry ctab-details-on', tab.view.details && storage.getItem(DETAILS_KEY) === '1' && left.classList.contains('ctab-details-on') && inspector.classList.contains('ctab-details-on') && q(left, '.ctab-details').classList.contains('on'));
check('nothing composed, the spec the same', tab.state.spec === before.spec && composes === before.composes && !tab.state.dirty);
check('the readouts, the decisions, JSON and the words seen; the meter line not', seen(q(left, '.ctab-readouts')) && seen(q(left, '.ctab-decisions')) && seen(qa(left, '.ctab-btn').find((b) => b.textContent === 'JSON')) && seen(q(undoBtn, '.ctab-word')) && !seen(q(left, '.ctab-summary')));
check('a bass cell: its notes table seen', seen(q(inspector, '.ctab-notes')));
tab.setSection('lines'); await settle();
check('Lines: Anchors, Table and every "chose" seen', seen(knob('Anchors')) && seen(knob('Table')) && seen(q(knob('Bars'), '.ctab-chosen')));
tab.selectCell('lead', 0); tab.setSection(CONTEXT_SECTION); await settle();
check('a lead cell: the costs seen, "line n" not', qa(inspector, '.ctab-alt').every((a) => !seen(q(a, '.ctab-alt-rank')) && qa(a, '.ctab-alt-name').filter(seen).length === 1));

console.log('\n— a hidden setting');
q(left, '.ctab-details').click(); await settle();
check('off again: stored "0", the clean view back', !tab.view.details && storage.getItem(DETAILS_KEY) === '0' && !left.classList.contains('ctab-details-on') && !seen(q(left, '.ctab-readouts')));
const dot = () => q(left, '.ctab-details');
check('no asked advanced knob: no dot', !dot().classList.contains('has-hidden') && dot().textContent === 'details');
core.setKnob('settlePasses', 2); await settle();
check(`Settle passes asked: the dot, naming it ("${dot().title}")`, dot().classList.contains('has-hidden') && dot().textContent === 'details •' && /Settle passes 2/.test(dot().title));
q(left, '.ctab-details').click(); await settle();
check('Details on: the dot goes (the knob is in sight)', !dot().classList.contains('has-hidden'));
q(left, '.ctab-details').click(); core.setKnob('settlePasses', null); await settle();
check('back to auto: no dot', !dot().classList.contains('has-hidden'));

console.log('\n— a tab mounted with Details stored on');
const storage2 = mapStorage(); storage2.setItem(DETAILS_KEY, '1'); storage2.setItem('lrc.composer.showWork', '0');
const bridge2 = createComposerBridge(win, { runCompose, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} }, storage: storage2, session: null, motion: () => false });
const left2 = doc.createElement('div'), inspector2 = doc.createElement('div');
doc.body.append(left2, inspector2);
bridge2.mountTab({ left: left2, inspector: inspector2 });
check('it opens in Details', bridge2.controller.view.details && left2.classList.contains('ctab-details-on'));

bridge.hideTab?.();
restore?.();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
