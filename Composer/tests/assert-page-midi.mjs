// assert-page-midi.mjs — MIDI out in the Composer window (Composer/CLEAN_MIDI_ORDER.md phase B, B3 and B5), through
// the page bridge, in Node over dom-stub.mjs with a fake Web MIDI (recording outputs named like IAC buses) and a
// recording mock AudioContext:
//   • the MIDI button opens the panel; Send asks for access once; each part matched to "its" bus by name
//   • Perform: each part's notes on its own bus, Start on the clock's; a part set to "not sent" goes quiet there;
//     local sound off silences the voices; Stop: All Notes Off and Stop
//   • the choices kept (never Send itself); a bus vanishing drops its part
//   • without Web MIDI the button is disabled and says so; Details' MIDI file is a .mid of the composition
//   node Composer/tests/assert-page-midi.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { readMidi } from '../core/midi.js';
import { MIDI_KEY } from '../page/composer-tab.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function makeCtx() {
  const param = (value) => { const p = { value, targets: [] }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; p.setTargetAtTime = (v) => { p.targets.push(v); return p; }; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}
const port = (name) => ({ id: name, name, sent: [], send(bytes, ts) { this.sent.push({ bytes: [...bytes], ts }); } });
const kind = (b) => b[0] & 0xF0, chan = (b) => b[0] & 0x0F;
const ons = (p) => p.sent.filter((m) => kind(m.bytes) === 0x90 && m.bytes[2] > 0);

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

// the fake Web MIDI: six IAC buses named for the parts, and one more
const names = ['IAC Driver Composer Lead', 'IAC Driver Composer Chords', 'IAC Driver Composer Comp', 'IAC Driver Composer Bass', 'IAC Driver Composer Inner', 'IAC Driver Composer Drums', 'IAC Driver Bus 1'];
const outs = new Map(names.map((n) => [n, port(n)]));
const access = { outputs: outs, onstatechange: null };
let asked = 0;
const midiAccess = () => { asked++; return Promise.resolve(access); };
const bus = (word) => outs.get(`IAC Driver Composer ${word}`);

const audio = makeCtx();
let tickFn = null;
const storage = (() => { const m = new Map([['lrc.composer.showWork', '0']]); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; })();
const files = [];
const { createComposerBridge } = await import('../page/composer-bridge.js');
const bridge = createComposerBridge(win, { runCompose: async (l, T, o) => compose(l, T, o), createContext: () => audio, timers: { setInterval: (f) => { tickFn = f; return 1; }, clearInterval: () => { tickFn = null; } },
  storage, session: null, motion: () => false, midiAccess, download: (name, data) => files.push({ name, data }) });
const tab = bridge.controller, core = tab.core, sink = bridge.midi;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const run = (seconds) => { const end = audio.currentTime + seconds; while (audio.currentTime < end) { audio.currentTime += 0.025; tickFn?.(); } };

console.log('MIDI out in the Composer window');
console.log('\n— the button and the panel');
q(left, '.ctab-go').click(); await settle();
const spec = tab.state.spec;
check('composed', spec && !spec.refused);
const btn = q(left, '.ctab-midi'), panel = q(left, '.ctab-midi-panel');
check('the MIDI button, the panel closed, nothing asked yet', btn && !btn.disabled && panel.style.display === 'none' && asked === 0 && !sink.enabled);
btn.click(); await settle();
check('opened: the panel, a bus picker a part, the clock\'s, "send"', panel.style.display !== 'none' && qa(panel, '.ctab-midi-part').length === 6 && qa(panel, 'select').length === 7
  && qa(panel, '.ctab-toggle').some((b) => b.textContent === 'send'));
const send = () => qa(panel, '.ctab-toggle').find((b) => /^send/.test(b.textContent));
send().click(); await settle();
check(`Send: access asked once, sending (${q(panel, '.ctab-midi-status').textContent})`, asked === 1 && sink.enabled && /sending 6 of 6 parts, the clock on IAC Driver Composer Lead/.test(q(panel, '.ctab-midi-status').textContent) && btn.classList.contains('on'));
check('each part matched to its bus by name', ['lead', 'chords', 'comp', 'bass', 'inner', 'drums'].every((id, i) => sink.ports[id] === outs.get(names[i])) && sink.clockPort === bus('Lead'));
check('… the pickers show them', qa(panel, '.ctab-midi-part').map((k) => q(k, 'select').value).join('|') === names.slice(0, 6).join('|'));
check('the chords bus set up as an MPE zone (RPN 6 = 4 on channel 1)', bus('Chords').sent.some((m) => m.bytes[0] === 0xB0 && m.bytes[1] === 6 && m.bytes[2] === 4));

console.log('\n— Perform');
for (const p of outs.values()) p.sent.length = 0;
for (const id of ['comp', 'bass']) core.setPart(id, { enabled: true });
q(left, '.ctab-go').click(); await settle();
check('performing', tab.state.status === 'playing' && typeof tickFn === 'function');
run(spec.knobs.cycleSeconds + 0.5);
check(`each part's notes on its own bus (lead ${ons(bus('Lead')).length}, chords ${ons(bus('Chords')).length}, comp ${ons(bus('Comp')).length}, bass ${ons(bus('Bass')).length}, inner ${ons(bus('Inner')).length}, drums ${ons(bus('Drums')).length})`,
  ['Lead', 'Chords', 'Comp', 'Bass', 'Inner'].every((w) => ons(bus(w)).length > 0) && ons(outs.get('IAC Driver Bus 1')).length === 0
  && ons(bus('Chords')).every((m) => chan(m.bytes) >= 1 && chan(m.bytes) <= 4) && ons(bus('Lead')).every((m) => chan(m.bytes) === 0));
check('Start on the clock\'s bus, then the clock', bus('Lead').sent.some((m) => m.bytes[0] === 0xFA) && bus('Lead').sent.filter((m) => m.bytes[0] === 0xF8).length > 24);
const innerSel = qa(panel, '.ctab-midi-part').find((k) => q(k, 'label').textContent === 'Inner').querySelector('select');
innerSel.value = ''; innerSel.dispatchEvent({ type: 'change' }); await settle();
const innerBefore = ons(bus('Inner')).length;
run(2);
check('Inner set to "not sent": quiet on its bus, the rest going on', ons(bus('Inner')).length === innerBefore && !sink.sends('inner') && sink.sends('lead'));
check('… kept: { inner: "" }, never Send itself', JSON.parse(storage.getItem(MIDI_KEY)).ports.inner === '' && !('enabled' in JSON.parse(storage.getItem(MIDI_KEY))));
const local = () => qa(panel, '.ctab-toggle').find((b) => b.textContent === 'local sound');
local().click(); await settle();
check('local sound off: the controller says so, the MIDI goes on', !core.localSound() && !local().classList.contains('on') && (run(1), ons(bus('Lead')).length > 0));
local().click(); await settle();
q(left, '.ctab-go').click(); await settle();   // Stop
check('Stop: All Notes Off on the buses, Stop on the clock, nothing held', tab.state.status !== 'playing' && bus('Lead').sent.some((m) => m.bytes[0] === 0xFC)
  && ['Lead', 'Chords', 'Drums'].every((w) => bus(w).sent.some((m) => kind(m.bytes) === 0xB0 && m.bytes[1] === 123)) && sink.liveNotes === 0);

console.log('\n— a bus vanishing, Send off');
outs.delete('IAC Driver Composer Bass'); access.onstatechange?.(); await settle();
check('the Bass bus gone: bass not sent, the status still counts the rest', !sink.sends('bass') && /sending 4 of 6/.test(q(panel, '.ctab-midi-status').textContent), q(panel, '.ctab-midi-status').textContent);
send().click(); await settle();
check('Send off: not sending, the button unlit', !sink.enabled && !btn.classList.contains('on') && send().textContent === 'send');

console.log('\n— the MIDI file (Details)');
const fileBtn = q(left, '.ctab-midi-file');
check('in Details, beside JSON', fileBtn.classList.contains('ctab-detail') && !fileBtn.disabled);
fileBtn.click();
const f = files.at(-1), m = f && readMidi(f.data);
check(`a .mid of the composition (${f?.name}): a track a playing part`, /\.mid$/.test(f?.name ?? '') && m.tracks.filter((t) => t.name).map((t) => t.name).join() === 'Lead,Chords,Comp,Bass,Inner,Drums');

console.log('\n— without Web MIDI');
const bridge2 = createComposerBridge(win, { runCompose: async (l, T, o) => compose(l, T, o), createContext: () => makeCtx(), timers: { setInterval: () => 1, clearInterval: () => {} }, storage, session: null, motion: () => false, midiAccess: null });
const left2 = doc.createElement('div'), inspector2 = doc.createElement('div');
doc.body.append(left2, inspector2);
bridge2.mountTab({ left: left2, inspector: inspector2 });
check('the button disabled, saying why', q(left2, '.ctab-midi').disabled && /isn't available/.test(q(left2, '.ctab-midi').title));

bridge.hideTab?.();
restore?.();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
