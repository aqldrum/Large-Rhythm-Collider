// assert-page-detail.mjs — the clean view and its Details toggle (Composer/CLEAN_MIDI_ORDER.md, phase A), in Node over
// dom-stub.mjs with the site's own composite rhythm and a recording mock AudioContext:
//   • off by default and kept in storage (any access wrapped); the hosts carry ctab-details-on only with it on
//   • the clean view: the Phrase strip (Bars, Steps / bar, what Compose chose when on auto), no readouts, no decisions, no JSON, the icons without their words, the advanced
//     knobs and every "chose" hidden, the chord candidates by name, no notes table
//   • Details on: everything as before, the clean view's short forms gone; toggling changes no spec and composes nothing
//   • an asked knob the clean view hides: the toggle's dot, naming it (on the View button too)
//   • the View menu (show the work, clean plot, advanced details) and its stored keys; the Phrase strip's fields and New version
// The stub has no CSS, so "seen" is the rule the stylesheet applies: a ctab-detail (or an ancestor) is hidden without
// ctab-details-on on its host, a ctab-clean-only with it, and an inline display: none always.
//   node Composer/tests/assert-page-detail.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { CONTEXT_SECTION } from '../page/tab-controller.js';
import { DETAILS_KEY, CLEAN_KEY, readDetails, writeDetails, hiddenSettings } from '../page/composer-tab.js';

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
const phraseField = (label) => qa(left, '.ctab-phrase-field').find((k) => q(k, 'label')?.textContent === label);
check('the Phrase strip is seen with the values asked (Bars 8, Steps / bar 8), the readouts are not', seen(q(left, '.ctab-phrase')) && seen(phraseField('Bars')) && q(phraseField('Bars'), 'input').value === '8' && q(phraseField('Steps / bar'), 'input').value === '8'
  && !seen(q(left, '.ctab-readouts')) && q(left, '.ctab-readouts').children.length > 5);
q(left, '.ctab-midi').click(); await settle();
check('no decisions; the MIDI menu\'s JSON is not seen, Download .mid is', !seen(q(left, '.ctab-decisions')) && !seen(qa(left, '.ctab-btn').find((b) => b.textContent === 'JSON')) && seen(q(left, '.ctab-midi-file')));
q(left, '.ctab-midi').click(); await settle();
const undoBtn = q(left, '.ctab-undo');
check('Undo and Redo: their icons seen, their words not (the words still in the text)', seen(undoBtn) && !seen(q(undoBtn, '.ctab-word')) && undoBtn.textContent === '↶ Undo' && q(left, '.ctab-redo').textContent === '↷ Redo');
check('the Compose button, the seed, New version and the two menu buttons are seen; the Glide slider (Details) is not', [q(left, '.ctab-go'), q(left, '.ctab-seed'), q(left, '.ctab-newversion'), q(left, '.ctab-midi'), q(left, '.ctab-view')].every(seen) && !seen(q(left, '.ctab-glide')));
check('the View panel is closed; opened it shows show the work, clean plot and advanced details', !seen(q(left, '.ctab-details')) && (q(left, '.ctab-view').click(), seen(q(left, '.ctab-work')) && seen(q(left, '.ctab-cleanplot')) && seen(q(left, '.ctab-details'))
  && q(left, '.ctab-details').textContent === 'advanced details' && ['.ctab-work', '.ctab-cleanplot', '.ctab-details'].every((c) => q(left, '.ctab-view-panel').contains(q(left, c)))));
q(left, '.ctab-view').click();
check('the matrix and the typed field are seen', seen(q(left, '.ctab-matrix')) && seen(q(left, '.ctab-field')) && qa(left, '.ctab-chord').every(seen));
tab.setSection('harmony'); await settle();
const linesHead = () => qa(inspector, '.ctab-sub').find((x) => x.textContent === 'Lines');
check('Harmony: the "Lines" sub-heading, Anchors and Table are not seen; Bars and Steps / bar are not in the inspector any more', !!linesHead() && !seen(linesHead()) && !seen(knob('Anchors')) && !seen(knob('Table')) && !knob('Bars') && !knob('Slots / bar') && !knob('Steps / bar'));
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
q(left, '.ctab-midi').click(); await settle();
check('the readouts, the decisions, JSON (in the MIDI menu), the Glide slider and the words seen; the Phrase strip still is', seen(q(left, '.ctab-readouts')) && seen(q(left, '.ctab-decisions')) && seen(qa(left, '.ctab-btn').find((b) => b.textContent === 'JSON')) && seen(q(undoBtn, '.ctab-word')) && seen(q(left, '.ctab-glide')) && seen(q(left, '.ctab-phrase')));
q(left, '.ctab-midi').click(); await settle();
check('a bass cell: its notes table seen', seen(q(inspector, '.ctab-notes')));
tab.setSection('harmony'); await settle();
check('Harmony: the "Lines" sub-heading, Anchors, Table and every "chose" seen', seen(linesHead()) && seen(knob('Anchors')) && seen(knob('Table')) && seen(q(knob('Anchors'), '.ctab-chosen')) && seen(q(knob('Modulation'), '.ctab-chosen')));
tab.selectCell('lead', 0); tab.setSection(CONTEXT_SECTION); await settle();
check('a lead cell: the costs seen, "line n" not', qa(inspector, '.ctab-alt').every((a) => !seen(q(a, '.ctab-alt-rank')) && qa(a, '.ctab-alt-name').filter(seen).length === 1));

console.log('\n— a hidden setting');
q(left, '.ctab-details').click(); await settle();
check('off again: stored "0", the clean view back', !tab.view.details && storage.getItem(DETAILS_KEY) === '0' && !left.classList.contains('ctab-details-on') && !seen(q(left, '.ctab-readouts')));
const dot = () => q(left, '.ctab-details');
const viewDot = () => q(left, '.ctab-view');
check('no asked advanced knob: no dot', !dot().classList.contains('has-hidden') && dot().textContent === 'advanced details' && !viewDot().classList.contains('has-hidden') && viewDot().textContent === 'View ▾');
core.setKnob('settlePasses', 2); await settle();
check(`Settle passes asked: the dot, naming it ("${dot().title}")`, dot().classList.contains('has-hidden') && dot().textContent === 'advanced details •' && /Settle passes 2/.test(dot().title));
check('… and on the View button too, with the panel closed', viewDot().classList.contains('has-hidden') && viewDot().textContent === 'View • ▾' && /Settle passes 2/.test(viewDot().title) && seen(viewDot()));
q(left, '.ctab-details').click(); await settle();
check('Details on: the dot goes (the knob is in sight), on both buttons', !dot().classList.contains('has-hidden') && !viewDot().classList.contains('has-hidden'));
q(left, '.ctab-details').click(); core.setKnob('settlePasses', null); await settle();
check('back to auto: no dot', !dot().classList.contains('has-hidden'));

console.log('\n— the View menu: the toggles write their stored keys');
{
  const view = q(left, '.ctab-view'), midiB = q(left, '.ctab-midi'), vp = q(left, '.ctab-view-panel'), mp = q(left, '.ctab-midi-panel');
  check('both panels closed; the View button opens its panel and shuts the MIDI one (one at a time)', vp.style.display === 'none' && mp.style.display === 'none');
  midiB.click(); view.click();
  check('… MIDI open then View: only the View panel', vp.style.display !== 'none' && mp.style.display === 'none' && view.classList.contains('open') && !midiB.classList.contains('open'));
  midiB.click();
  check('… and MIDI again: only the MIDI panel', vp.style.display === 'none' && mp.style.display !== 'none');
  midiB.click(); view.click();
  const was = storage.getItem('lrc.composer.showWork');
  q(left, '.ctab-work').click(); await settle();
  check('show the work: stored, flips the view flag', storage.getItem('lrc.composer.showWork') === (was === '1' ? '0' : '1') && tab.view.showWork === (was !== '1'));
  q(left, '.ctab-work').click(); await settle();
  q(left, '.ctab-cleanplot').click(); await settle();
  check('clean plot: stored "1", the flag on, the button lit', storage.getItem(CLEAN_KEY) === '1' && tab.view.clean && q(left, '.ctab-cleanplot').classList.contains('on'));
  q(left, '.ctab-cleanplot').click(); await settle();
  check('… off: stored "0"', storage.getItem(CLEAN_KEY) === '0' && !tab.view.clean);
  q(left, '.ctab-details').click(); await settle();
  check('advanced details: stored "1", both hosts carry the class; the panel stays open', storage.getItem(DETAILS_KEY) === '1' && left.classList.contains('ctab-details-on') && vp.style.display !== 'none');
  q(left, '.ctab-details').click(); await settle();
  check('… off: stored "0"', storage.getItem(DETAILS_KEY) === '0' && !left.classList.contains('ctab-details-on'));
  view.click();
}

console.log('\n— the Phrase strip: Bars, Steps / bar, the auto value, New version');
{
  const bars = () => q(qa(left, '.ctab-phrase-field').find((k) => q(k, 'label').textContent === 'Bars'), 'input'), steps = () => q(qa(left, '.ctab-phrase-field').find((k) => q(k, 'label').textContent === 'Steps / bar'), 'input');
  check('the field is labelled "Steps / bar" (the old "Slots / bar" is gone from the window)', !!steps() && !qa(left, 'label').some((l) => l.textContent === 'Slots / bar') && !qa(inspector, 'label').some((l) => l.textContent === 'Slots / bar'));
  core.setKnob('bars', null); core.setKnob('slotsPerBar', null);
  q(left, '.ctab-go').click(); await settle();
  const sp = tab.state.spec;
  check(`on auto, the boxes say what Compose chose, Details off ("${bars().placeholder}", "${steps().placeholder}")`, !tab.view.details && bars().value === '' && steps().value === '' && bars().placeholder === `auto · ${sp.knobs.bars}` && steps().placeholder === `auto · ${sp.knobs.slotsPerBar}` && seen(bars()) && seen(steps()));
  bars().value = '3'; bars().dispatchEvent({ type: 'change' }); await settle();
  check('a Bars typed: the knob is written, the entry dirty (Compose to hear it); the box shows the value', tab.state.knobs.bars === 3 && tab.state.dirty && bars().value === '3');
  q(left, '.ctab-go').click(); await settle();
  check('Compose: 3 bars', tab.state.spec.knobs.bars === 3 && qa(left, '.ctab-chord').length >= 3);
  steps().value = '4'; steps().dispatchEvent({ type: 'change' }); await settle();
  q(left, '.ctab-go').click(); await settle();
  check('Steps / bar typed: 4 a bar after Compose', tab.state.knobs.slotsPerBar === 4 && tab.state.spec.knobs.slotsPerBar === 4 && tab.state.spec.knobs.bars === 3);
  core.setTable('lean'); q(left, '.ctab-go').click(); await settle();
  const c1 = composes, spec1 = tab.state.spec;
  bars().value = '2'; bars().dispatchEvent({ type: 'change' }); await settle(12);
  check(`a quick (lean) compose recomposes on a change, as the inspector's knob did (${tab.state.spec.knobs.bars} bars, ${composes - c1} compose)`, core.canAutoRecompose() && tab.state.spec !== spec1 && tab.state.spec.knobs.bars === 2 && !tab.state.dirty);
  core.setTable('full');
  bars().value = ''; bars().dispatchEvent({ type: 'change' }); steps().value = ''; steps().dispatchEvent({ type: 'change' }); await settle();
  check('blank again is auto (knobs null)', tab.state.knobs.bars == null && tab.state.knobs.slotsPerBar == null);
  core.setKnob('bars', 8); core.setKnob('slotsPerBar', 8);
  q(left, '.ctab-go').click(); await settle();
  const nv = q(left, '.ctab-newversion'), seed0 = Number(tab.state.input.seed), cN = composes, spec2 = tab.state.spec;
  check('New version: a dice and words, a title, the seed field beside it', !nv.disabled && /🎲/.test(nv.textContent) && /New version/.test(nv.textContent) && nv.title.length > 10 && nv.parentNode === q(left, '.ctab-seed').parentNode);
  nv.click(); await settle(12);
  check(`New version: the seed + 1 (${seed0} → ${tab.state.input.seed}), composed (one Compose), a different composition from the same rhythm`, Number(tab.state.input.seed) === seed0 + 1 && composes === cN + 1 && tab.state.spec !== spec2 && !tab.state.dirty && tab.state.status === 'ready'
    && q(left, '.ctab-seed').value === String(seed0 + 1));
  core.setKnob('bars', null); core.setKnob('slotsPerBar', null);
}

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
