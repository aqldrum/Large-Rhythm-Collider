// assert-page-view.mjs — the Composer tab's view and bridge (Composer/page/composer-tab.js, composer-bridge.js), and
// the lab's view after the promotion (Composer/lab/composer-lab.js), run in Node over dom-stub.mjs with stand-ins for
// the page's globals (lrcModule, toneRowPlayback, lrcVisuals) and a recording mock AudioContext:
//   • the bridge: importing it sets window.lrcComposer and fires `lrccomposerready`; its exports
//   • the tab: mount, show (the overlay set on the plot), Compose the page's rhythm, the lanes (a row a part, Drums
//     included), Perform (main playback stopped first), the playhead frames, main playback taking over, the
//     inspector (selection, sections, drums and kit, the progression), the Linear Plot note, a rhythm change, a
//     refusal, hide (the overlay off, playback stopped)
//   • the lab still composes and renders through the shared modules
//   node Composer/tests/assert-page-view.mjs
import fs from 'node:fs';
import path from 'node:path';
import { makeDom, installGlobals, recordingContext } from './dom-stub.mjs';
import { siteRhythm, ROOT } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

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
/** a module worker, in this thread: compose-worker.js' own answer, a tick later */
class FakeWorker {
  constructor(url) { this.url = String(url); this.onmessage = null; }
  postMessage(data) { setTimeout(() => this.onmessage?.({ data: answer(data) }), 0); }
}

const dom = makeDom(), win = dom.window, doc = dom.document;
const restore = installGlobals(dom, { Worker: FakeWorker });

// ── the page's globals, as the bridge reads them ──
function setRhythm(layers) {
  const r = siteRhythm(layers);
  win.lrcModule = { currentRhythms: layers, currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm };
  if (win.lrcVisuals) { win.lrcVisuals.compositeRhythm = r.compositeRhythm; win.lrcVisuals.grid = r.grid; win.lrcVisuals.positions = Array.from({ length: r.compositeRhythm.length }, (_, i) => ({ x: 40 + i, y: 100, index: i })); }
  return r;
}
win.toneRowPlayback = { isPlaying: false, cycleDuration: 4, stops: 0, stopPlayback() { this.isPlaying = false; this.stops++; } };
const canvas = doc.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
const ctx2d = canvas.getContext('2d');
win.lrcVisuals = {
  currentPlotType: 'linear', composerOverlay: null, draws: 0, compositeRhythm: null, grid: 0, positions: [],
  setComposerOverlay(o) { this.composerOverlay = o; this.drawPlot(); },
  drawPlot() { this.draws++; this.composerOverlay?.draw(ctx2d, { positions: this.positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false }); },
  setPlotType(t) { this.currentPlotType = t; this.drawPlot(); },
};
setRhythm([8, 7, 6, 5]);

console.log('Composer tab — the view and the bridge');
console.log('\n— the bridge');
let readyEvents = 0;
win.addEventListener('lrccomposerready', () => readyEvents++);
const bridgeModule = await import('../page/composer-bridge.js');
check('importing it sets window.lrcComposer and fires lrccomposerready', win.lrcComposer && readyEvents === 1 && win.lrcComposer.version === bridgeModule.COMPOSER_BRIDGE_VERSION);
check('its API: mountTab, showTab, hideTab, isShown, isPlaying, stop, controller, overlay', ['mountTab', 'showTab', 'hideTab', 'isShown', 'isPlaying', 'stop'].every((k) => typeof win.lrcComposer[k] === 'function') && win.lrcComposer.controller && win.lrcComposer.overlay && Object.isFrozen(win.lrcComposer));
check('the module exports createComposerBridge and pageHost', typeof bridgeModule.createComposerBridge === 'function' && typeof bridgeModule.pageHost === 'function');
const host = bridgeModule.pageHost(win);
check('pageHost reads LRCModule\'s layers and Playback\'s cycle', JSON.stringify(host.readRhythm()) === JSON.stringify({ layers: [8, 7, 6, 5], cycleSeconds: 4 }));
win.lrcModule.currentRhythms = [768, 769, 1, 1];
check('a site layer of 1 (no onset of its own) is given to Compose as absent', host.readRhythm().layers.join() === '768,769,0,0');
win.lrcModule.currentRhythms = [8, 7, 6, 5];
check('no rhythm generated yet → null', bridgeModule.pageHost({ lrcModule: { currentGrid: 0, currentCompositeRhythm: [] } }).readRhythm() === null);

console.log('\n— the tab');
// "show the work" off (as stored): the tab as it was before the Compose animation (assert-page-animate.mjs drives it on)
const bridge = bridgeModule.createComposerBridge(win, { runCompose: async (l, T, o) => compose(l, T, o), createContext: () => makeCtx(), timers: { setInterval: () => 1, clearInterval: () => {} }, storage: { getItem: () => '0', setItem() {} } });
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
const q = (root, cls) => root.querySelector(`.${cls}`), qa = (root, cls) => root.querySelectorAll(`.${cls}`);
check('mounted: the header, lanes and decisions on the left; the inspector on the right', q(left, 'ctab-head') && q(left, 'ctab-lanes') && q(left, 'ctab-decisions') && q(inspector, 'ctab-insp-head') && left.classList.contains('ctab-left'));
bridge.showTab();
check('shown: the overlay is on the plot, and the rhythm is the page\'s', win.lrcVisuals.composerOverlay === bridge.overlay && bridge.isShown() && q(left, 'ctab-rhythm').textContent.startsWith('8:7:6:5 · 4 s'));
const go = q(left, 'ctab-go');
check('the button says Compose', go.textContent === 'Compose' && !go.disabled);
go.click(); await settle();
check(`Compose: the button says Perform; readouts (${qa(left, 'ctab-readouts')[0].children.length}) and decisions (${q(left, 'ctab-decisions-table').children.length})`, go.textContent === 'Perform' && q(left, 'ctab-readouts').children.length > 5 && q(left, 'ctab-decisions-table').children.length > 10);
const lanes = qa(left, 'ctab-lane');
check(`a lane a part, Drums included (${lanes.length}), each name a part`, lanes.length === 6 && lanes.map((l) => q(l, 'ctab-lane-name').textContent).join() === 'Lead,Chords,Comping,Bass,Inner,Drums');
check('a column a bar', qa(lanes[0], 'ctab-bar').length === bridge.controller.state.spec.knobs.bars && qa(lanes[1], 'ctab-chord').length === bridge.controller.state.spec.knobs.bars);
check('the plot was redrawn with the lit nodes', bridge.overlay.highlights && bridge.overlay.highlights.parts.lead.indices.length > 0 && bridge.overlay.snapshotted);

win.toneRowPlayback.isPlaying = true;
go.click(); await settle(1);
check('Perform: main playback is stopped first; the button says Stop', win.toneRowPlayback.stops === 1 && go.textContent === 'Stop' && bridge.isPlaying());
const before = ctx2d.calls.length;
dom.raf.flush(3);
const frameCalls = ctx2d.calls.slice(before);
check('animation frames: the plot\'s snapshot blitted and the playhead drawn; the lanes\' playhead shown', frameCalls.some((c) => c[0] === 'drawImage') && frameCalls.some((c) => c[0] === 'lineTo') && q(left, 'ctab-playhead').style.display === 'block');
win.dispatchEvent(new win.Event('playbackStarted'));
check('main playback starts: the Composer stops', !bridge.isPlaying() && go.textContent === 'Perform');
dom.raf.flush(2);
check('… and the playhead goes away', q(left, 'ctab-playhead').style.display === 'none');

console.log('\n— the inspector');
check('lead is selected: its sound, legato, on/off and level; the Lines section', q(inspector, 'ctab-insp-name').textContent === 'Lead' && inspector.querySelector('select') && qa(inspector, 'ctab-toggle').length >= 2 && q(inspector, 'ctab-level') && inspector.querySelector('.ctab-insp-tab.active').textContent === 'Lines');
q(qa(left, 'ctab-lane')[5], 'ctab-lane-name').click();
check('click Drums in the lanes: the inspector shows the drums, on the Drums section, with the kit', q(inspector, 'ctab-insp-name').textContent === 'Drums' && inspector.querySelector('.ctab-insp-tab.active').textContent === 'Drums'
  && inspector.querySelectorAll('option').some((o) => o.value === 'assets/audio/kick1.wav') && qa(left, 'ctab-lane')[5].classList.contains('selected'));
const mode = inspector.querySelector('select');
mode.value = 'son'; mode.dispatchEvent(new win.Event('change'));
check('a drum mode from the inspector: re-arranged live (son), still Perform', bridge.controller.state.drums.mode === 'son' && go.textContent === 'Perform');
qa(inspector, 'ctab-part-pick').find((b) => b.textContent === 'Chords').click();
check('pick Chords: Harmony, with a root select a bar', inspector.querySelector('.ctab-insp-tab.active').textContent === 'Harmony' && q(inspector, 'ctab-prog').querySelectorAll('select').length === bridge.controller.state.spec.knobs.bars);
const bar1 = q(inspector, 'ctab-prog').querySelector('select'), root = bridge.controller.core.rootChoices().candidates[1].ratio;
bar1.value = root; bar1.dispatchEvent(new win.Event('change'));
check('ask a root for bar 1: the button goes back to Compose', bridge.controller.core.progressionInput()?.[0] === root && go.textContent === 'Compose' && q(left, 'ctab-status').textContent.includes('Compose again'));
go.click(); await settle();
check('Compose with it: bar 1 is targeted', bridge.controller.state.spec.chords[0].targeted === true && go.textContent === 'Perform');
qa(inspector, 'ctab-insp-tab').find((b) => b.textContent === 'Tuning').click();
check('Tuning: the frame knob and the root, baseHz and retunes', inspector.querySelector('input[type=number]') !== null || inspector.querySelectorAll('input').length > 0);

console.log('\n— the page around it');
win.lrcVisuals.currentPlotType = 'wheel';
win.dispatchEvent(new win.Event('vizTypeChanged'));
const note = q(left, 'ctab-note');
check('not on the Linear Plot: a note, and a button that shows it', note.style.display !== 'none' && note.textContent.includes('Linear Plot'));
note.querySelector('button').click();
check('… which switches the plot to linear', win.lrcVisuals.currentPlotType === 'linear');
win.toneRowPlayback.isPlaying = false;
go.click(); await settle(1);
check('(performing)', bridge.isPlaying());
win.lrcVisuals.currentPlotType = 'wheel';
const wheelAt = ctx2d.calls.length;
dom.raf.flush(2);
check('on another plot type the frames leave the canvas alone (the snapshot is the Linear Plot\'s)', ctx2d.calls.length === wheelAt);
win.lrcVisuals.currentPlotType = 'linear';
setRhythm([41, 42, 43, 1]);
win.dispatchEvent(new win.Event('rhythmGenerated'));
check('a new rhythm on the page: playback stops, the button says Compose, the rhythm label follows', !bridge.isPlaying() && go.textContent === 'Compose' && q(left, 'ctab-rhythm').textContent.startsWith('41:42:43 · 4 s'));
win.lrcVisuals.drawPlot();
check('the old composition lights nothing on the new plot', bridge.overlay.highlights === null);
win.toneRowPlayback.cycleDuration = 6;
dom.raf.flush(1);
check('a new Playback cycle, noticed on the next frame: the label follows', q(left, 'ctab-rhythm').textContent.startsWith('41:42:43 · 6 s'));
setRhythm([7, 1, 1, 1]);
win.dispatchEvent(new win.Event('rhythmGenerated'));
go.click(); await settle();
check(`a refusal is said in plain words ("${q(left, 'ctab-refusal').textContent}")`, /Too few tones/.test(q(left, 'ctab-refusal').textContent) && go.textContent === 'Compose' && qa(left, 'ctab-lane').length === 0);
setRhythm([8, 7, 6, 5]);
win.dispatchEvent(new win.Event('rhythmGenerated'));
go.click(); await settle(); go.click(); await settle(1);
bridge.hideTab();
check('hide: the overlay is off the plot, playback stopped', win.lrcVisuals.composerOverlay === null && !bridge.isPlaying() && !bridge.isShown());
const redraws = win.lrcVisuals.draws;
bridge.controller.core.setDrums({ mode: 'rock' });
check('hidden: changes don\'t redraw the plot', win.lrcVisuals.draws === redraws);
bridge.showTab();
check('shown again: the same view, the overlay back', win.lrcVisuals.composerOverlay === bridge.overlay && q(left, 'ctab-go') === go && bridge.controller.state.drums.mode === 'rock');
bridge.hideTab();

console.log('\n— the lab, through the shared modules');
{
  const html = fs.readFileSync(path.join(ROOT, 'Composer/lab/composer-lab.html'), 'utf8');
  for (const m of html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)) dom.withId(m[1], m[2]);
  await import('../lab/composer-lab.js');
  await settle(6);
  const lab = (id) => doc.getElementById(id);
  check(`the lab composes 41:42:43 at once, in the (fake) worker: the button says Perform`, lab('go').textContent === 'Perform');
  check('readouts, knobs (with what Compose chose), lanes and the drum lane render', lab('readouts').children.length > 5 && lab('knobs').querySelectorAll('.chosen').some((c) => c.textContent.startsWith('chose')) && lab('lanes').querySelectorAll('.lane').length === 6);
  check('the progression editor and the decisions render', lab('progression').querySelectorAll('select').length > 0 && lab('decisionTable').children.length > 10);
}

restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
