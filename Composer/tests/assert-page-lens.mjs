// assert-page-lens.mjs — the Composition lens on the main page (sprint 2, step 1), in Node over dom-stub.mjs, with the
// site's own classic scripts in a vm where they matter: LRCModule (generating the rhythm from the real inputs),
// LRCVisuals (the real Linear Plot and its overlay hook), ToneRowPlayback's transport methods and
// PartitionsGlobalControls' play button. Playback itself (audio, the scheduler) is a stand-in; the Composer's player
// runs on a recording mock AudioContext.
//   • the glyph: hidden → ready (one breath a session) → composing → lit; aria-pressed; the tooltip
//   • the lens transitions: press → compose → animate on the main canvas → play; press again → back to the row;
//     skip (Esc, a click on the canvas, Play); press during Compose; refusal; the pace seam
//   • the one transport: ToneRowPlayback.togglePlayback plays and stops the composition under the lens, the row under
//     the row; both play buttons show it; Stop keeps the composition
//   • the panels: part strips ⇄ the Composer window (on/off, sound, level, drums, the selection), the layer dot; the
//     Scale Selection readout (the chord's tones, bar by bar) and its lock; the Families note; all restored on the row
//   • the main canvas: lit nodes and playhead with the window closed; back on the row the plot draws exactly as before
//   • a new rhythm, a new cycle, a cached recall with no re-solve (and the window's edits in it), a plot-type switch
//     and its restore, a < 4-layer rhythm (the LCM fix) composing end to end
//   node Composer/tests/assert-page-lens.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { loadClass } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { chordTonesByBar, compositionTones, barAt, scaleRowsFor, LOCK_CLASS, FAMILIES_NOTE } from '../page/panel-locks.js';
import { dominantLayer, PARTS_HEADER } from '../page/part-strips.js';
import { BREATH_KEY, BREATH_MS } from '../page/toolbar-glyph.js';
import { GLYPH_TIPS } from '../page/lens.js';
// imported before the stub's globals exist, so the module's own page boot (window.lrcComposer) doesn't run here: the
// test makes the one bridge itself
import { createComposerBridge } from '../page/composer-bridge.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

let now = 0;
function makeCtx() {
  const param = (value) => { const p = { value }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    get currentTime() { return now / 1000; }, sampleRate: 48000,   // the test's clock: the playhead moves as it runs state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}

const dom = makeDom(), win = dom.window, doc = dom.document;
const restoreGlobals = installGlobals(dom);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) e.append(k); return e; };

// ── the page, as index.html lays out what the lens touches ──
const header = dom.withId('header', 'title-bar');
const glyphBtn = el('button', { className: 'composition-glyph' }); glyphBtn.id = 'composition-glyph'; glyphBtn.hidden = true;
const cosmosBtn = el('button'); cosmosBtn.id = 'cosmos-enter-btn';
header.append(el('div', { className: 'title-bar-controls' }, glyphBtn, cosmosBtn));
const inputs = ['a', 'b', 'c', 'd'].map((x) => { const i = el('input', { type: 'number' }); i.id = `layer-${x}`; doc.body.append(i); return i; });
const main = dom.withId('main', 'lrc-main'), canvas = doc.createElement('canvas'); canvas.id = 'visualization-canvas'; main.append(canvas);
// the Playback div: Main Controls' play button, Layer Controls, Scale Selection, Consonance Families
const playBtn = el('button', { className: 'play-btn', textContent: '▶' }); playBtn.id = 'play-stop-btn';
const layerHeader = el('button', { className: 'collapse-btn layer-controls-header', textContent: 'Layer Controls' });
const layerToggles = el('div', { className: 'playback-layer-toggles' }, ...['a', 'b', 'c', 'd'].map((l) => el('button', { className: 'playback-layer-btn', textContent: l.toUpperCase() })));
const legatoRow = el('div', { className: 'playback-legato-row' }), layerBox = el('div'); layerBox.id = 'layer-controls-container';
const layerContent = el('div', { className: 'collapse-content' }, layerToggles, legatoRow, layerBox); layerContent.id = 'layer-controls-content';
const selectAll = el('button', { className: 'control-btn', textContent: 'Select All' }); selectAll.setAttribute('data-scale-action', 'select-all');
const countEl = el('span'); countEl.setAttribute('data-scale-count', '');
const chart = el('div', { className: 'scale-chart-container' }); chart.id = 'scale-chart-container';
const scaleContent = el('div', { className: 'collapse-content' }, el('div', { className: 'scale-controls' }, selectAll, countEl), chart); scaleContent.id = 'scale-content';
const familiesList = el('div'); familiesList.id = 'consonance-families-container';
const familiesContent = el('div', { className: 'collapse-content' }, familiesList); familiesContent.id = 'interconsonance-families-content';
const pbContainer = el('div', {}, el('div', { className: 'playback-controls' }, playBtn), el('div', { className: 'playback-section' }, layerHeader, layerContent), scaleContent, familiesContent);
pbContainer.id = 'playback-controls-container';
doc.body.append(pbContainer);

// ── the site's scripts ──
const TRP = loadClass('Playback/ToneRowPlayback.js', 'ToneRowPlayback', dom);
const PGC = loadClass('Playback/Partitions/PartitionsGlobalControls.js', 'PartitionsGlobalControls', dom);
const LRCModule = loadClass('Core Interface/LRCModule.js', 'LRCModule', dom);
const LRCVisuals = loadClass('Core Interface/LRCVisuals.js', 'LRCVisuals', dom);
// ToneRowPlayback: its own transport methods (togglePlayback, updatePlayButton, transportIsPlaying); playback itself and
// the scale chart are stand-ins (the chart is innerHTML on the page, which the stub DOM doesn't parse)
const pb = Object.create(TRP.prototype);
Object.assign(pb, {
  isPlaying: false, cycleDuration: 4, availableRatios: [], selectedNotes: new Set(), starts: 0, stops: 0,
  async startPlayback() { this.isPlaying = true; this.starts++; this.updatePlayButton(); win.dispatchEvent(new win.CustomEvent('playbackStarted', { detail: { cycleDuration: this.cycleDuration } })); },
  stopPlayback() { this.isPlaying = false; this.stops++; this.updatePlayButton(); win.dispatchEvent(new win.CustomEvent('playbackStopped')); },
  updateScaleDisplay() {
    chart.replaceChildren(...this.availableRatios.map((r) => { const row = el('div', { className: `scale-row ${this.selectedNotes.has(r.fraction) ? 'note-selected' : 'note-deselected'}` }); row.setAttribute('data-ratio', r.fraction); return row; }));
  },
  updateSelectedNotesCount() { countEl.textContent = `${this.selectedNotes.size} of ${this.availableRatios.length} notes selected`; },
});
win.toneRowPlayback = pb;
const pgc = Object.create(PGC.prototype);
pgc.elements = { playBtn: el('button', { textContent: '▶ Play' }) };
win.partitionsGlobalControls = pgc;

// the module bridge loads before the classic scripts' DOMContentLoaded boot (as on the page): its listeners come first
let solves = 0, slow = null;
const clock = () => now;
const runCompose = (l, T, o) => {
  solves++;
  return new Promise((resolve) => { const go = () => resolve(compose(l, T, o)); if (slow) slow.push(go); else setTimeout(go, 0); });
};
const local = new Map(), storage = { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)) };
const sessionMap = new Map(), session = { getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null), setItem: (k, v) => sessionMap.set(k, String(v)) };
const pending = [];
const timers = { setInterval: () => 1, clearInterval: () => {}, setTimeout: (f, ms) => { pending.push({ f, ms }); return pending.length; }, clearTimeout: () => {} };
const bridge = createComposerBridge(win, { runCompose, createContext: () => makeCtx(), timers, clock, storage, session });
win.lrcComposer = bridge;
const lens = bridge.lens, tab = bridge.controller, store = bridge.store;
// …then the site's boot
win.lrcModule = new LRCModule();
const vis = new LRCVisuals();
win.lrcVisuals = vis;
const ctx2d = canvas.getContext('2d');
// ToneRowPlayback's own listener: the scale for the new rhythm, every note selected
win.addEventListener('rhythmGenerated', (e) => { pb.availableRatios = e.detail.ratios; pb.selectedNotes = new Set(e.detail.ratios.map((r) => r.fraction)); pb.updateScaleDisplay(); pb.updateSelectedNotesCount(); });

/** the site's own generation: type the layers into the inputs and generate (LRCModule.generateRhythm) */
async function generate(layers) {
  inputs.forEach((input, i) => { input.value = layers[i] == null ? '' : String(layers[i]); });
  win.lrcModule.generateRhythm();
  await settle(2);
}
const events = [];
lens.onChange((type, detail) => events.push({ type, ...detail }));
const flush = (n = 1) => dom.raf.flush(n);
/** run the clock forward a frame at a time */
const run = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; flush(1); } };
const glyph = () => ({ state: glyphBtn.dataset.state, hidden: glyphBtn.hidden, pressed: glyphBtn.getAttribute('aria-pressed'), tip: glyphBtn.dataset.tip, label: glyphBtn.getAttribute('aria-label') });
const plotCalls = () => { const b = ctx2d.calls.length; vis.drawPlot(); return JSON.stringify(ctx2d.calls.slice(b)); };
const stripsRoot = () => layerContent.querySelector('.composition-part-strips');
const stripBtn = (id) => stripsRoot().querySelectorAll('.part-strip-btn').find((b) => b.dataset.part === id);

console.log('Composition lens — the main page');

console.log('\n— the glyph before a rhythm');
check('no rhythm yet: the glyph is hidden, not pressed; the lens is on the row', glyph().hidden && glyph().state === 'hidden' && glyph().pressed === 'false' && lens.mode === 'row' && lens.glyph() === 'hidden');
check('Play with no composition lens is the row\'s own (the transport doesn\'t claim it)', !bridge.transport.owns() && pb.transportIsPlaying() === false);

console.log('\n— a rhythm generates');
await generate([8, 7, 6, 5]);
check('the site generated 8:7:6:5 and plotted it (the real LRCModule and LRCVisuals)', win.lrcModule.currentGrid === 840 && vis.allDotPositions.length === 22 && vis.currentPlotType === 'linear');
check(`the glyph appears, ready: "${glyph().tip}"; not pressed`, !glyph().hidden && glyph().state === 'ready' && glyph().tip === GLYPH_TIPS.ready && glyph().label === 'Compose' && glyph().pressed === 'false');
check('it breathes once: the class on, the session remembers it', glyphBtn.classList.contains('glyph-breathe') && sessionMap.get(BREATH_KEY) === '1' && bridge.glyph.breathed);
pending.find((p) => p.ms === BREATH_MS)?.f();
check('… and the breath ends', !glyphBtn.classList.contains('glyph-breathe'));
{
  const d2 = makeDom(), b2 = createComposerBridge(Object.assign(d2.window, { lrcModule: win.lrcModule, toneRowPlayback: pb }), { runCompose, session, storage, timers });
  check('another page in the same session: ready, but no second breath', b2.glyph.state === 'ready' && !b2.glyph.breathing);
  const d3 = makeDom(), b3 = createComposerBridge(Object.assign(d3.window, { lrcModule: win.lrcModule, toneRowPlayback: pb }), { runCompose, timers, storage, session: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  check('a session storage that throws: it breathes (once this page), never fatal', b3.glyph.breathing);
}
const rowPlot = plotCalls();
check(`under the row lens the plot draws with no overlay (${JSON.parse(rowPlot).length} canvas calls)`, vis.composerOverlay === null && JSON.parse(rowPlot).length > 22 * 3);
const scaleBefore = chart.children.map((r) => r.className).join('|');

console.log('\n— press: compose, animate on the main canvas, play');
await pb.togglePlayback();
check('(the row playing first, through the real togglePlayback)', pb.isPlaying && pb.starts === 1 && playBtn.textContent === '⏹ Stop');
const solves0 = solves;
glyphBtn.click();
check('pressed: the lens is on, composing; the glyph says so (pressed, "Back to the row")', lens.mode === 'composition' && lens.phase === 'composing' && glyph().state === 'composing' && glyph().pressed === 'true' && glyph().tip === GLYPH_TIPS.composing && glyphBtn.classList.contains('composing'));
check('main playback stopped first (one thing sounds at a time); Compose asked once, with the trace', !pb.isPlaying && solves === solves0 + 1 && tab.view.showWork);
check('the overlay is on the main canvas (the Composer window closed): the plot washes as the animation\'s base', vis.composerOverlay === bridge.overlay && bridge.seat.holds('lens') && !bridge.seat.holds('tab') && bridge.overlay.scene && !bridge.isShown());
check(`the Playback div: the layer strips step aside for part strips; the header says "${PARTS_HEADER}"`, layerToggles.style.display === 'none' && legatoRow.style.display === 'none' && layerBox.style.display === 'none' && stripsRoot() && stripsRoot().style.display !== 'none' && layerHeader.textContent === PARTS_HEADER);
check('Scale Selection locked (the chart and its section); Families locked with its note', chart.classList.contains(LOCK_CLASS) && scaleContent.classList.contains(LOCK_CLASS) && familiesContent.classList.contains(LOCK_CLASS) && familiesContent.firstChild.textContent === FAMILIES_NOTE);
let b0 = ctx2d.calls.length;
flush(2);   // (the row's own lighting loop may have a last frame queued: it stops itself)
check('while Compose runs: the main canvas shimmers (the base blitted, "composing…")', ctx2d.calls.slice(b0).some((c) => c[0] === 'drawImage') && ctx2d.calls.slice(b0).some((c) => c[0] === 'fillText' && c[1] === 'composing…'));
await settle();
check('the trace is back: the lens animates it on the main canvas; the glyph still composing', lens.phase === 'animating' && glyph().state === 'composing' && events.some((e) => e.type === 'animating') && store.entry().madeBy === 'glyph');
b0 = ctx2d.calls.length;
run(160);
check('animation frames paint over the base on the main canvas', ctx2d.calls.slice(b0).filter((c) => c[0] === 'drawImage').length >= 8 && lens.phase === 'animating');
run(8000);
check('the animation ends: landed and playing; the glyph lit, "Back to the row"', lens.phase === 'landed' && tab.state.status === 'playing' && tab.core.player.playing && glyph().state === 'lit' && glyphBtn.classList.contains('lit') && glyph().tip === GLYPH_TIPS.lit);
check('the main canvas shows the composition\'s lit nodes (no scene left)', !bridge.overlay.scene && bridge.overlay.highlights && bridge.overlay.highlights.parts.lead.indices.length > 0 && bridge.overlay.snapshotted);
check('the play buttons show the composition playing (Playback, Partitions)', playBtn.textContent === '⏹ Stop' && playBtn.classList.contains('playing') && (pgc.updatePlayButtonState(), pgc.elements.playBtn.textContent === '⏹ Stop'));
b0 = ctx2d.calls.length;
flush(2);
check('the playhead on the main canvas with the window closed: the snapshot back, a line', ctx2d.calls.slice(b0).some((c) => c[0] === 'drawImage') && ctx2d.calls.slice(b0).some((c) => c[0] === 'lineTo'));

console.log('\n— the scale readout');
{
  const spec = tab.state.spec, parts = tab.core.currentParts(), at = tab.playheadAt(), bar = barAt(spec, at.t);
  const want = scaleRowsFor(pb.availableRatios, chordTonesByBar(spec, parts)[bar]);
  const lit = new Set(chart.children.filter((r) => r.classList.contains('note-selected')).map((r) => r.getAttribute('data-ratio')));
  check(`playing: the rows lit are bar ${bar + 1}'s chord tones (${[...lit].join(' ')}); "${countEl.textContent}"`, want.size > 0 && lit.size === want.size && [...want].every((f) => lit.has(f)) && countEl.textContent === `${want.size} in ${spec.chords[bar].name} · bar ${bar + 1}`);
  const chordNotes = parts.find((p) => p.id === 'chords').notes;
  check('chordTonesByBar is the chord voices\' tones a bar, and the root', chordTonesByBar(spec, parts).every((s, k) => [...s].every((f) => chordNotes.some((n) => n.bar === k && n.ratio === f) || spec.chords[k].rootTone === f)));
  // the next bar
  // a bar later the readout is the next bar's chord
  const T = spec.knobs.cycleSeconds, next = (bar + 1) % spec.knobs.bars, before = countEl.textContent;
  const wait = ((spec.timeline.barStarts[next] - at.t + T) % T) * 1000 + 60;
  run(wait);
  const at2 = tab.playheadAt(), bar2 = barAt(spec, at2.t), want2 = scaleRowsFor(pb.availableRatios, chordTonesByBar(spec, parts)[bar2]);
  const lit2 = chart.children.filter((r) => r.classList.contains('note-selected')).map((r) => r.getAttribute('data-ratio'));
  check(`bar by bar: a bar later the readout is bar ${bar2 + 1}'s chord ("${before}" → "${countEl.textContent}")`, bar2 === next && countEl.textContent === `${want2.size} in ${spec.chords[bar2].name} · bar ${bar2 + 1}` && lit2.length === want2.size && lit2.every((f) => want2.has(f)));
}

console.log('\n— the one transport');
const starts0 = pb.starts;
await pb.togglePlayback();
check('Play/Stop under the lens stops the composition (not the row); the lens and the composition stay', tab.state.status === 'ready' && !tab.core.player.playing && lens.mode === 'composition' && lens.phase === 'landed' && glyph().state === 'lit' && pb.starts === starts0 && tab.state.spec);
// (the main button reads "▶" once the Partitions controls exist: their updatePlayButtonState writes it so)
check('… the buttons say Play; stopped, the readout shows every tone the composition plays', playBtn.textContent.startsWith('▶') && (pgc.updatePlayButtonState(), pgc.elements.playBtn.textContent.startsWith('▶'))
  && countEl.textContent === `${scaleRowsFor(pb.availableRatios, compositionTones(tab.state.spec, tab.core.currentParts())).size} in the composition`);
await pb.togglePlayback();
check('Play again: the composition plays (the row never started)', tab.state.status === 'playing' && !pb.isPlaying && pb.starts === starts0 && playBtn.textContent === '⏹ Stop');

console.log('\n— part strips ⇄ the Composer window');
const left = el('div'), inspector = el('div'); doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const lane = (id) => left.querySelectorAll('.ctab-lane').find((l) => l.querySelector('.ctab-lane-name').textContent === { lead: 'Lead', bass: 'Bass', drums: 'Drums' }[id]);
check('the window opens on the lens\'s composition (the same store entry): Stop, the lanes', left.querySelector('.ctab-go').textContent === 'Stop' && left.querySelectorAll('.ctab-lane').length === 6 && bridge.seat.holds('tab') && bridge.seat.holds('lens'));
const stripLabels = stripsRoot().querySelectorAll('.part-strip-btn').map((b) => b.textContent).join();
check(`six part strips in the layer strips' grammar (${stripLabels.replace(/[A-D]$/g, '')})`, stripsRoot().querySelectorAll('.part-strip-btn').length === 6 && stripsRoot().querySelector('.playback-layer-toggles') && stripsRoot().querySelector('.part-strip-mute') && stripsRoot().querySelector('.part-strip-sound') && stripsRoot().querySelector('.part-strip-level'));
{
  const h = bridge.overlay.highlights, lm = win.lrcModule.currentLayerMap, dot = stripBtn('lead').querySelector('.part-strip-layer');
  check(`each strip carries the layer it leans on (lead: layer ${dot?.dataset.layer})`, dot && dot.dataset.layer === dominantLayer(h.parts.lead.indices, lm) && ['A', 'B', 'C', 'D'].includes(dot.dataset.layer));
}
stripBtn('bass').click();
check('pick Bass in the strips: the window\'s inspector shows Bass too', tab.view.selected === 'bass' && inspector.querySelector('.ctab-insp-name').textContent === 'Bass' && stripBtn('bass').classList.contains('active'));
stripsRoot().querySelector('.part-strip-mute').click();
check('Mute bass in the strips: off in the store, in the window\'s lane, and on the plot', tab.state.parts.bass.enabled === false && lane('bass').classList.contains('off') && bridge.overlay.highlights.parts.bass.enabled === false && stripBtn('bass').classList.contains('off'));
lane('lead').querySelector('.ctab-toggle').click();
check('Lead off in the window: its strip shows it off', tab.state.parts.lead.enabled === false && stripBtn('lead').classList.contains('off'));
lane('lead').querySelector('.ctab-toggle').click();
const sound = stripsRoot().querySelector('.part-strip-sound'), other = sound.options.find((o) => o.value !== tab.state.parts.bass.sound).value;
sound.value = other; sound.dispatchEvent(new win.Event('change'));
check(`a sound from the strips (${other}): the part re-articulated, the window's inspector shows it`, tab.state.parts.bass.sound === other && inspector.querySelector('select').value === other);
const level = stripsRoot().querySelector('.part-strip-level');
level.value = '0.33'; level.dispatchEvent(new win.Event('input'));
check('a level from the strips: the store, the player and the window\'s slider follow (no re-render mid-drag)', tab.state.levels.bass === 0.33 && Number(inspector.querySelector('.ctab-level').value) === 0.33 && stripsRoot().querySelector('.part-strip-level-value').textContent === '33%');
const winLevel = inspector.querySelector('.ctab-level');
winLevel.value = '0.6'; winLevel.dispatchEvent(new win.Event('input'));
check('a level from the window: the strip\'s slider and readout follow', Number(stripsRoot().querySelector('.part-strip-level').value) === 0.6 && stripsRoot().querySelector('.part-strip-level-value').textContent === '60%');
stripBtn('drums').click();
const pattern = stripsRoot().querySelector('.part-strip-sound');
pattern.value = 'son'; pattern.dispatchEvent(new win.Event('change'));
check('Drums: the strip\'s sound is the pattern (son): re-arranged live, the window\'s drums lane says so', stripsRoot().querySelector('label').textContent === 'Pattern' && tab.state.drums.mode === 'son' && tab.state.status === 'playing' && inspector.querySelector('.ctab-insp-name').textContent === 'Drums');
bridge.hideTab();
check('closing the window under the lens: the composition keeps playing, its lit nodes stay on the plot', tab.state.status === 'playing' && vis.composerOverlay === bridge.overlay && bridge.seat.holds('lens') && !bridge.seat.holds('tab'));
stripBtn('inner').click();
const plotDraws = () => ctx2d.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === '#1a1a1a').length;   // clearCanvas: a draw of the plot
const draws0 = plotDraws();
stripsRoot().querySelector('.part-strip-mute').click();
check('the window closed, a strip edit (inner off) redraws the main canvas: the lit nodes follow', tab.state.parts.inner.enabled === false && bridge.overlay.highlights.parts.inner.enabled === false && plotDraws() > draws0);
stripsRoot().querySelector('.part-strip-mute').click();

console.log('\n— glyph back to the row: everything restored');
const evN = events.length;
glyphBtn.click();
check('pressed again: the row; the glyph ready, not pressed, "Compose"', lens.mode === 'row' && lens.phase === 'idle' && glyph().state === 'ready' && glyph().pressed === 'false' && glyph().tip === 'Compose' && events.slice(evN).some((e) => e.type === 'row'));
check('the composition stopped, kept in the store (recallable)', tab.state.status === 'ready' && !tab.core.player.playing && store.recallable());
check('the plot draws exactly as before the lens (call for call)', vis.composerOverlay === null && plotCalls() === rowPlot);
check('the layer strips back as they were, the part strips gone, the header "Layer Controls"', layerToggles.style.display === '' && legatoRow.style.display === '' && layerBox.style.display === '' && stripsRoot().style.display === 'none' && layerHeader.textContent === 'Layer Controls');
check('Scale Selection unlocked, its rows the row\'s own selection again; the count too', !chart.classList.contains(LOCK_CLASS) && !scaleContent.classList.contains(LOCK_CLASS) && chart.children.map((r) => r.className).join('|') === scaleBefore && countEl.textContent === `${pb.availableRatios.length} of ${pb.availableRatios.length} notes selected`);
check('Families unlocked, the note gone', !familiesContent.classList.contains(LOCK_CLASS) && !familiesContent.querySelectorAll(`.${'composition-lock-note'}`).length);
check('Play is the row\'s again', !bridge.transport.owns() && playBtn.textContent.startsWith('▶'));
await pb.togglePlayback();
check('… it plays the row (the composition stays stopped)', pb.isPlaying && pb.starts === starts0 + 1 && tab.state.status === 'ready');
pb.stopPlayback();

console.log('\n— a cached recall, no re-solve, with the window\'s edits');
const solves1 = solves;
glyphBtn.click();
await settle(1);
check('pressed on a rhythm with a composition: it plays at once — no Compose, no animation', solves === solves1 && lens.phase === 'landed' && tab.state.status === 'playing' && events.at(-1).type === 'landed' && events.at(-1).recalled === true && glyph().state === 'lit');
check('… with the window\'s edits as they were left (bass off, its sound and level, son)', tab.state.parts.bass.enabled === false && tab.state.parts.bass.sound === other && tab.state.levels.bass === 0.6 && tab.state.drums.mode === 'son' && bridge.overlay.highlights.parts.bass.enabled === false);
glyphBtn.click();
// an edit in the window between two presses shows in the recall
bridge.showTab();
inspector.querySelectorAll('.ctab-part-pick').find((b) => b.textContent === 'Lead').click();
inspector.querySelector('.ctab-insp-head').querySelectorAll('.ctab-toggle').find((b) => b.textContent === 'legato').click();
const legato = tab.state.parts.lead.legato;
bridge.hideTab();
glyphBtn.click(); await settle(1);
check('an edit made in the window (lead legato) is in the next recall, still no re-solve', solves === solves1 && tab.state.parts.lead.legato === legato && tab.state.status === 'playing');

console.log('\n— a new rhythm');
await generate([41, 42, 43, 1]);
check('a new rhythm under the lens: back to the row, the glyph re-armed (ready), the composition stopped', lens.mode === 'row' && glyph().state === 'ready' && !tab.core.player.playing && store.key === '41:42:43:0@4');
check('… the panels restored and the plot plain', layerToggles.style.display === '' && !chart.classList.contains(LOCK_CLASS) && vis.composerOverlay === null);
check('… the old rhythm\'s composition still cached', store.recallable('8:7:6:5@4') && store.entry('8:7:6:5@4').state.parts.bass.enabled === false);
await generate([8, 7, 6, 5]);
const solves2 = solves;
glyphBtn.click(); await settle(1);
check('8:7:6:5 again, pressed: recalled from the cache, no re-solve', solves === solves2 && lens.phase === 'landed' && tab.state.status === 'playing');

console.log('\n— a new cycle');
pb.cycleDuration = 6;
flush(2);
check('the Playback cycle changes under the lens: back to the row on the next frame, a new key', lens.mode === 'row' && store.key === '8:7:6:5@6' && glyph().state === 'ready' && !tab.core.player.playing);

console.log('\n— skip, and pressing during Compose');
async function pressToAnimating(pace) {
  const p = lens.press(pace ? { pace } : {});
  await settle();
  return p;
}
tab.core.setSeed(2);   // a fresh compose for 8:7:6:5@6
let settled = pressToAnimating();
check('(animating on 8:7:6:5 at 6 s)', lens.phase === 'animating' || (await settle(), lens.phase === 'animating'));
doc.dispatchEvent({ type: 'keydown', key: 'Enter' });
check('another key does nothing', lens.phase === 'animating');
doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
check('Esc skips to the landing, and it plays', lens.phase === 'landed' && tab.state.status === 'playing' && !bridge.overlay.scene && (await settled) === 'landed');
glyphBtn.click();
tab.core.setSeed(3);
settled = pressToAnimating(); await settle();
let was = lens.phase;
canvas.click();
check('a click on the main canvas skips', was === 'animating' && lens.phase === 'landed' && tab.state.status === 'playing');
glyphBtn.click();
tab.core.setSeed(4);
settled = pressToAnimating(); await settle();
was = lens.phase;
await pb.togglePlayback();
check('Play during the animation skips to the landing and plays', was === 'animating' && lens.phase === 'landed' && tab.state.status === 'playing' && !pb.isPlaying);
glyphBtn.click();
tab.core.setSeed(5);
slow = [];
const solves3 = solves;
glyphBtn.click();
check('(composing, the answer held back)', lens.phase === 'composing' && solves === solves3 + 1);
await pb.togglePlayback();
check('Play while Compose runs: it waits (nothing to play yet)', lens.phase === 'composing' && tab.state.status === 'composing');
glyphBtn.click();
check('the glyph pressed during Compose: back to the row at once (the scene dropped)', lens.mode === 'row' && !bridge.overlay.scene && glyph().state === 'ready' && vis.composerOverlay === null);
slow.forEach((f) => f()); slow = null; await settle();
check('… the compose lands in the store, and nothing plays', store.recallable() && tab.state.spec.input.seed === 5 && tab.state.status === 'ready' && lens.mode === 'row' && !tab.core.player.playing);

console.log('\n— the pace seam (for the tutorial)');
tab.core.setSeed(6);
settled = pressToAnimating(4); await settle();
check('press({ pace: 4 }): the animation\'s clock runs 4× (its scene unchanged)', lens.pace === 4 && bridge.lens.phase === 'animating');
run(Math.ceil((8000 / 4)) + 200);
check('… so it lands in a quarter of the time', lens.phase === 'landed' && (await settled) === 'landed');
glyphBtn.click();

console.log('\n— a plot-type switch');
vis.setPlotType('wheel');
check('(the plot on the Wheel)', vis.currentPlotType === 'wheel');
glyphBtn.click(); await settle(1);
check('the glyph pressed on another plot type: the canvas switches to the Linear Plot (recalled, playing)', vis.currentPlotType === 'linear' && lens.priorPlot === 'wheel' && lens.phase === 'landed' && lens.mode === 'composition');
glyphBtn.click();
check('back to the row: the Wheel comes back', vis.currentPlotType === 'wheel' && lens.mode === 'row');
vis.setPlotType('linear');
glyphBtn.click(); await settle(1);
vis.setPlotType('centrifuge');
check('a plot type picked by hand under the lens: back to the row, and the pick stands', lens.mode === 'row' && vis.currentPlotType === 'centrifuge' && !tab.core.player.playing && vis.composerOverlay === null);
vis.setPlotType('linear');

console.log('\n— fewer than four layers (the LCM fix), end to end');
await generate([768, 769, null, null]);
check('768:769 with C and D blank: the site\'s grid is the real lcm (590,592), not NaN; plotted', win.lrcModule.currentGrid === 590592 && win.lrcModule.currentCompositeRhythm.length === 1536 && vis.allDotPositions.length === 1536);
check('the glyph is ready on it', glyph().state === 'ready' && store.key === '768:769:0:0@6');
glyphBtn.click(); await settle();
run(8200);
check('pressed: composed, animated and playing on the 1,536-onset plot', lens.phase === 'landed' && tab.state.status === 'playing' && tab.state.spec.stats.onsets === 1536 && bridge.overlay.highlights.n === 1536);
glyphBtn.click();

console.log('\n— a refusal');
await generate([7, null, null, null]);
glyphBtn.click(); await settle();
check(`a rhythm Compose refuses: back to the row, the glyph's tip says why ("${glyph().tip}")`, lens.mode === 'row' && glyph().state === 'ready' && /Too few tones/.test(glyph().tip) && glyphBtn.classList.contains('refused') && vis.composerOverlay === null && layerToggles.style.display === '');
await generate([8, 7, 6, 5]);
check('a new rhythm clears the refusal', glyph().tip === 'Compose' && !glyphBtn.classList.contains('refused'));

console.log('\n— the page API for later steps');
check('lrcComposer.lens / transport / store / glyph', typeof bridge.lens.press === 'function' && typeof bridge.lens.toRow === 'function' && typeof bridge.lens.onChange === 'function' && typeof bridge.transport.toggle === 'function' && bridge.store.version && bridge.glyph.el === glyphBtn && Object.isFrozen(bridge));

restoreGlobals();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
