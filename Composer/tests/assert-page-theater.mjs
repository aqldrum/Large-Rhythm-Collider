// assert-page-theater.mjs — "show the work" as theater (sprint 2, step 2), in Node over dom-stub.mjs, with the site's
// own LRCModule, LRCVisuals, ToneRowPlayback transport and ProgressionBar in a vm (as assert-page-lens.mjs does).
//   • the scrim: on for a rhythm's first animated compose, off as the performance starts; the panels and the header
//     exactly as they were (the scrim is one class on <body>); the lift's fade class and its timer
//   • the caption floating on the canvas: the frame's own label; made when shown, removed when hidden
//   • every skip path: a click anywhere (swallowed), a click on the canvas, Esc, Play, lens.skip(); during Compose
//     (queued: the compose lands unanimated); a press (pointerdown) swallowed, not a skip; the glyph is a cancel
//   • first vs cached: the full show (4–7.5 s) once per rhythm, then the short version (~1.5 s: root → lead → parts)
//     for a recall and a later compose; a recall with no trace, or the work hidden, lands at once
//   • reduced motion and "show the work" off: no shimmer, no animation, no scrim — straight to the landing
//   • pace: the full show and the short one both scale; a bad pace is 1; press() resolves on the landing
//   • cancels: a new rhythm, a new cycle, the glyph, a window opened (Partitions' event, the Composer tab): no scrim,
//     no caption, no listener and no draw left; one frame loop after a cancel and a re-press in the same frame
//   • ProgressionBar's locked voicing yields the Scale chart to the lens's readout, and gets it back on the row
//   node Composer/tests/assert-page-theater.mjs
import fs from 'node:fs';
import path from 'node:path';
import { makeDom, installGlobals } from './dom-stub.mjs';
import { loadClass, ROOT } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { THEATER_CLASS, LIFTING_CLASS, LIFT_MS, THEATER_KEEP, CAPTION_ID, SKIP_HINT } from '../page/theater.js';
import { RECALL_SECONDS, ANIMATION_LIMITS, recallTimeline, frameAt } from '../page/trace-frames.js';
import { LOCK_CLASS } from '../page/panel-locks.js';
import { OVERLAY_STYLE } from '../page/plot-overlay.js';
import { createComposerBridge, motionAllowed } from '../page/composer-bridge.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

let now = 0;
function makeCtx() {
  const param = (value) => { const p = { value }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    get currentTime() { return now / 1000; }, sampleRate: 48000, state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}

const dom = makeDom(), win = dom.window, doc = dom.document;
const restoreGlobals = installGlobals(dom);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) e.append(k); return e; };
const withId = (e, id) => { e.id = id; return e; };

// ── the page, as index.html lays it out: the header (title, the glyph, Cosmos, Reset), the canvas, the five panels ──
doc.body.className = 'site-body';
const title = el('div', { className: 'title-content' }, el('h1', { textContent: 'LARGE RHYTHM COLLIDER' }));
const glyphBtn = withId(el('button', { className: 'composition-glyph' }), 'composition-glyph'); glyphBtn.hidden = true;
const glyphIcon = el('svg'); glyphBtn.append(glyphIcon);
const cosmosBtn = withId(el('button', { className: 'reset-btn' }), 'cosmos-enter-btn'), resetBtn = withId(el('button', { className: 'reset-btn' }), 'reset-display-btn');
const controls = el('div', { className: 'title-bar-controls' }, glyphBtn, cosmosBtn, resetBtn);
const header = withId(el('header', { className: 'title-bar-fixed' }, title, controls), 'title-bar');
const main = withId(el('main'), 'lrc-main'), canvas = withId(doc.createElement('canvas'), 'visualization-canvas'); main.append(canvas);
const panel = (id, ...kids) => { const s = withId(el('section', { className: 'panel minimized' }, el('div', { className: 'panel-header' }, el('h2', { className: 'panel-title', textContent: id })), ...kids), id); s.setAttribute('data-default-pos', 'x'); s.style.left = '12px'; return s; };
const inputs = ['a', 'b', 'c', 'd'].map((x) => withId(el('input', { type: 'number' }), `layer-${x}`));
const generateBtn = el('button', { className: 'generate-btn', textContent: 'Generate' });
const submitDiv = panel('rhythm-submit-div', ...inputs, generateBtn); submitDiv.className = 'panel';
// the Playback div: Main Controls' play button, Layer Controls, Scale Selection, Consonance Families
const playBtn = withId(el('button', { className: 'play-btn', textContent: '▶' }), 'play-stop-btn');
const layerHeader = el('button', { className: 'collapse-btn layer-controls-header', textContent: 'Layer Controls' });
const layerToggles = el('div', { className: 'playback-layer-toggles' }, ...['a', 'b', 'c', 'd'].map((l) => el('button', { className: 'playback-layer-btn', textContent: l.toUpperCase() })));
const legatoRow = el('div', { className: 'playback-legato-row' }), layerBox = withId(el('div'), 'layer-controls-container');
const layerContent = withId(el('div', { className: 'collapse-content' }, layerToggles, legatoRow, layerBox), 'layer-controls-content');
const countEl = el('span'); countEl.setAttribute('data-scale-count', '');
const chart = withId(el('div', { className: 'scale-chart-container' }), 'scale-chart-container');
const scaleContent = withId(el('div', { className: 'collapse-content' }, el('div', { className: 'scale-controls' }, countEl), chart), 'scale-content');
const familiesContent = withId(el('div', { className: 'collapse-content' }, withId(el('div'), 'consonance-families-container')), 'interconsonance-families-content');
const pbContainer = withId(el('div', {}, el('div', { className: 'playback-controls' }, playBtn), el('div', { className: 'playback-section' }, layerHeader, layerContent), scaleContent, familiesContent), 'playback-controls-container');
const panels = [submitDiv, panel('rhythm-info-div'), panel('visualizations-div'), panel('playback-div', pbContainer), panel('search-div')];
doc.body.append(header, main, ...panels);

// ── the site's scripts ──
const TRP = loadClass('Playback/ToneRowPlayback.js', 'ToneRowPlayback', dom);
const LRCModule = loadClass('Core Interface/LRCModule.js', 'LRCModule', dom);
const LRCVisuals = loadClass('Core Interface/LRCVisuals.js', 'LRCVisuals', dom);
const pb = Object.create(TRP.prototype);
Object.assign(pb, {
  isPlaying: false, cycleDuration: 4, availableRatios: [], selectedNotes: new Set(), starts: 0,
  async startPlayback() { this.isPlaying = true; this.starts++; this.updatePlayButton(); win.dispatchEvent(new win.CustomEvent('playbackStarted', { detail: {} })); },
  stopPlayback() { this.isPlaying = false; this.updatePlayButton(); win.dispatchEvent(new win.CustomEvent('playbackStopped')); },
  updateScaleDisplay() {
    chart.replaceChildren(...this.availableRatios.map((r) => { const row = el('div', { className: `scale-row ${this.selectedNotes.has(r.fraction) ? 'note-selected' : 'note-deselected'}` }); row.setAttribute('data-ratio', r.fraction); return row; }));
  },
  updateSelectedNotesCount() { countEl.textContent = `${this.selectedNotes.size} of ${this.availableRatios.length} notes selected`; },
});
win.toneRowPlayback = pb;

let solves = 0, slow = null, motionOn = true;
const runCompose = (l, T, o) => { solves++; return new Promise((resolve) => { const go = () => resolve(compose(l, T, o)); if (slow) slow.push(go); else setTimeout(go, 0); }); };
const local = new Map(), storage = { getItem: (k) => (local.has(k) ? local.get(k) : null), setItem: (k, v) => local.set(k, String(v)) };
const sessionMap = new Map([['lrc.composer.glyphBreathed', '1']]), session = { getItem: (k) => sessionMap.get(k) ?? null, setItem: (k, v) => sessionMap.set(k, String(v)) };
let pending = [];
const timers = { setInterval: () => 1, clearInterval: () => {}, setTimeout: (f, ms) => { pending.push({ f, ms }); return pending.length; }, clearTimeout: (id) => { if (pending[id - 1]) pending[id - 1].cleared = true; } };
const fireTimers = (ms) => { const due = pending.filter((p) => p.ms === ms && !p.cleared && !p.fired); for (const p of due) { p.fired = true; p.f(); } return due.length; };
const bridge = createComposerBridge(win, { runCompose, createContext: () => makeCtx(), timers, clock: () => now, storage, session, motion: () => motionOn });
win.lrcComposer = bridge;
const { lens, theater, store } = bridge, tab = bridge.controller;
win.lrcModule = new LRCModule();
const vis = new LRCVisuals();
win.lrcVisuals = vis;
const ctx2d = canvas.getContext('2d');
win.addEventListener('rhythmGenerated', (e) => { pb.availableRatios = e.detail.ratios; pb.selectedNotes = new Set(e.detail.ratios.map((r) => r.fraction)); pb.updateScaleDisplay(); pb.updateSelectedNotesCount(); });

async function generate(layers) {
  inputs.forEach((input, i) => { input.value = layers[i] == null ? '' : String(layers[i]); });
  win.lrcModule.generateRhythm();
  await settle(2);
}
const events = [];
lens.onChange((type, detail) => events.push({ type, ...detail, at: now }));
const flush = (n = 1) => dom.raf.flush(n);
const run = (ms) => { for (let t = 0; t < ms; t += 16) { now += 16; flush(1); } };
const plotCalls = () => { const b = ctx2d.calls.length; vis.drawPlot(); return JSON.stringify(ctx2d.calls.slice(b)); };
/** the panels' and the header's own state: class, style, attributes, dataset (the scrim must write none of it) */
const snapOf = (e) => JSON.stringify({ c: e.className, s: Object.fromEntries(Object.entries(e.style).filter(([, v]) => typeof v !== 'function')), a: e.attributes, d: e.dataset, h: e.hidden ?? null });
const watched = [...panels, header, title, controls, cosmosBtn, resetBtn];
const snapshot = () => watched.map(snapOf).join('\n');
const bodyClass = () => doc.body.className;
let cycle = 4;
/** a fresh store key for the same layers: the next cycle (a new key's first compose is a full show) */
const freshKey = () => { cycle += 1; pb.cycleDuration = cycle; tab.syncRhythm(); return store.key; };
/** a synthetic page event, the way a capture listener on the document sees it */
const pageEvent = (type, target, extra = {}) => { const ev = { type, target, prevented: 0, stopped: 0, ...extra }; ev.preventDefault = () => { ev.prevented++; }; ev.stopPropagation = () => { ev.stopped++; }; doc.dispatchEvent(ev); return ev; };
/** the caption is in the page (the stub's getElementById remembers removed elements, so search the tree) */
const captionInPage = () => doc.body.querySelectorAll(`#${CAPTION_ID}`).length > 0;
const lastOf = (type) => [...events].reverse().find((e) => e.type === type);

console.log('Theater — "show the work" on the main page');
await generate([8, 7, 6, 5]);
const rowPlot = plotCalls(), before = snapshot();
check('(8:7:6:5 generated and plotted; the glyph ready; no scrim)', win.lrcModule.currentGrid === 840 && lens.glyph() === 'ready' && !theater.up && bodyClass() === 'site-body');
check('index.html links theater.css; the bridge has a new ?v=', (() => { const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); return /<link rel="stylesheet" href="Composer\/page\/theater\.css\?v=\d+">/.test(html) && /composer-bridge\.js\?v=20261023\.2"/.test(html); })());
{
  const css = fs.readFileSync(path.join(ROOT, 'Composer/page/theater.css'), 'utf8');
  const dimmed = [...css.matchAll(/body\.composition-theater (#[\w-]+-div)/g)].map((m) => m[1]);
  const all = panels.map((p) => `#${p.id}`);
  check(`theater.css dims the other four panels (${[...new Set(dimmed)].join(' ')}), not ${THEATER_KEEP.join()}, and the header but the glyph`, all.filter((id) => !THEATER_KEEP.includes(id.slice(1))).every((id) => dimmed.includes(id)) && THEATER_KEEP.every((id) => !dimmed.includes(`#${id}`))
    && /body\.composition-theater #title-bar \.title-bar-controls > :not\(#composition-glyph\)/.test(css) && /body\.composition-theater #title-bar \.title-content/.test(css));
}

console.log('\n— the first compose: the scrim, the caption, the lift');
glyphBtn.click();
check('pressed: composing, and the scrim is up (one class on <body>, the page\'s own class kept)', lens.phase === 'composing' && theater.up && doc.body.classList.contains(THEATER_CLASS) && doc.body.classList.contains('site-body') && lastOf('composing').animate === true && lastOf('composing').short === false);
check('the panels and the header are untouched while dimmed (the CSS does it)', snapshot() === before);
check('no caption while Compose runs (the canvas shimmers)', !theater.captionShown && !captionInPage());
await settle();
const full = lastOf('animating'), fullStart = now;
check(`the trace is back: the full show (${full?.scene?.end?.toFixed(2)} s, within ${ANIMATION_LIMITS.join('–')} s); the scrim still up`, lens.phase === 'animating' && full && full.short === false && full.recalled === false && full.scene.end >= ANIMATION_LIMITS[0] && full.scene.end <= ANIMATION_LIMITS[1] && theater.up);
run(48);
{
  const cap = doc.getElementById(CAPTION_ID), f = frameAt(full.scene, (now - fullStart) / 1000);
  check(`the caption floats on the canvas (in #lrc-main): "${cap?.children[0].textContent}"`, cap && cap.parentNode === main && theater.captionShown && cap.children[0].textContent.length > 0 && cap.getAttribute('aria-live') === 'polite');
  check(`… it is the animation frame's own label ("${f.label}"), with "${SKIP_HINT}"`, cap.children[0].textContent === f.label && cap.children[2].textContent === SKIP_HINT && !cap.children[2].hidden);
}
run(Math.ceil(full.scene.end * 1000) - 48 - 150);
check('a beat before its end: still animating, the scrim still up', lens.phase === 'animating' && theater.up);
run(300);
const landedAt = lastOf('landed')?.at;
check(`it lands at the scene's end (${((landedAt - fullStart) / 1000).toFixed(2)} s) and plays; the scrim lifts as it starts`, lens.phase === 'landed' && tab.state.status === 'playing' && !theater.up && !doc.body.classList.contains(THEATER_CLASS) && Math.abs((landedAt - fullStart) / 1000 - full.scene.end) < 0.05);
check('… fading: the lifting class, then (after its timer) <body> exactly as it was', doc.body.classList.contains(LIFTING_CLASS) && fireTimers(LIFT_MS) === 1 && bodyClass() === 'site-body');
check('the caption is gone; the panels and the header exactly as before', !theater.captionShown && !captionInPage() && snapshot() === before);
check('… and no listener left: a click on a panel now does nothing to the lens', (() => { const ev = pageEvent('click', generateBtn); return ev.prevented === 0 && ev.stopped === 0 && lens.phase === 'landed'; })());

console.log('\n— a cached recall: the short version');
glyphBtn.click();
check('(back to the row)', lens.mode === 'row' && !theater.up);
const solves0 = solves;
let pressed = lens.press();
check(`pressed again: no Compose; the short version (${lastOf('animating')?.scene?.end} s), recalled, with no scrim`, solves === solves0 && lens.phase === 'animating' && lastOf('animating').short === true && lastOf('animating').recalled === true && !theater.up && bodyClass() === 'site-body');
const shortStart = now, shortEnd = lastOf('animating').scene.end;
check(`… its timeline is recallTimeline's (${RECALL_SECONDS} s at pace 1)`, Math.abs(shortEnd - RECALL_SECONDS) < 1e-6);
run(48);
check('the short version has the caption, without the skip hint', theater.captionShown && doc.getElementById(CAPTION_ID).children[2].hidden === true);
{
  const sc = lastOf('animating').scene, groups = sc.timeline.groups.filter((g) => g.duration > 0).map((g) => g.group);
  check(`its beats: ${groups.join(' → ')} (root → lead → parts land)`, groups[0] === 'root' && groups.includes('line') && groups.includes('parts') && groups.every((g) => ['root', 'line', 'parts', 'drums'].includes(g)) && groups.indexOf('root') < groups.indexOf('line') && groups.indexOf('line') < groups.indexOf('parts'));
}
run(RECALL_SECONDS * 1000 - 48 - 120);
check('a beat before 1.5 s: still animating', lens.phase === 'animating');
run(250);
check(`it lands at ~${RECALL_SECONDS} s (${((lastOf('landed').at - shortStart) / 1000).toFixed(2)} s), recalled, and plays; press() resolved "landed"`, lens.phase === 'landed' && lastOf('landed').recalled === true && tab.state.status === 'playing' && Math.abs((lastOf('landed').at - shortStart) / 1000 - RECALL_SECONDS) < 0.05 && (await pressed) === 'landed' && !theater.captionShown);
glyphBtn.click();
tab.core.setSeed(11);   // an edit since the last Compose: the glyph composes again
const solves1 = solves;
glyphBtn.click();
check('a later compose of the same rhythm (after a seed change): composing, short, no scrim', solves === solves1 + 1 && lens.phase === 'composing' && lastOf('composing').short === true && !theater.up);
await settle();
check('… the short version of the new trace', lens.phase === 'animating' && lastOf('animating').short === true && lastOf('animating').recalled === false && Math.abs(lastOf('animating').scene.end - RECALL_SECONDS) < 1e-6);
run(1700);
check('… lands and plays', lens.phase === 'landed' && tab.state.status === 'playing' && tab.state.spec.input.seed === 11);
glyphBtn.click();
tab.setShowWork(false);
glyphBtn.click();
check('a recall with "show the work" off: straight to the landing (no animation)', lens.phase === 'landed' && lastOf('landed').recalled === true && events.at(-2).type !== 'animating');
glyphBtn.click();
tab.setShowWork(true);

console.log('\n— skip paths (each on a first compose: a fresh cycle)');
/** a fresh key pressed, run into its full show → { p } (press()'s promise, wrapped: an async function would adopt it) */
async function fullShow(opts) {
  freshKey();
  const p = lens.press(opts);
  await settle();
  run(32);
  return { p };
}
async function skipWith(label, act, { swallowed = false } = {}) {
  const { p } = await fullShow();
  const was = lens.phase === 'animating' && theater.up && lastOf('animating').short === false;
  const ev = act();
  check(`${label}: skips to the landing and plays; the scrim lifts${swallowed ? '; the click is swallowed' : ''}`, was && lens.phase === 'landed' && tab.state.status === 'playing' && !theater.up && !theater.captionShown && !bridge.overlay.scene
    && (!swallowed || (ev.prevented > 0 && ev.stopped > 0)) && (await p) === 'landed');
  fireTimers(LIFT_MS);
  glyphBtn.click();
}
await skipWith('a click on a dimmed panel (Generate)', () => pageEvent('click', generateBtn), { swallowed: true });
await skipWith('a click in the header (Reset Display)', () => pageEvent('click', resetBtn), { swallowed: true });
await skipWith('a click on the Playback div (its Play button, so it doesn\'t also press it)', () => pageEvent('click', playBtn), { swallowed: true });
await skipWith('a click on the canvas', () => pageEvent('click', canvas), { swallowed: true });
await skipWith('a click straight on the canvas element (the lens\'s own listener)', () => canvas.click());
await skipWith('Esc', () => pageEvent('keydown', doc.body, { key: 'Escape' }));
await skipWith('Play (the one transport)', () => { pb.togglePlayback(); return {}; });
await skipWith('lens.skip() (a caller)', () => ({ ok: lens.skip() }));
{
  await fullShow();
  const ev = pageEvent('pointerdown', submitDiv), ev2 = pageEvent('mousedown', submitDiv);
  check('a press (pointerdown, mousedown) on a panel under the scrim: swallowed (no drag starts), not a skip', ev.prevented && ev.stopped && ev2.prevented && lens.phase === 'animating' && theater.up);
  const k = pageEvent('keydown', doc.body, { key: 'Enter' });
  check('another key: nothing', lens.phase === 'animating' && theater.up && !k.prevented);
  const g = pageEvent('click', glyphIcon);
  check('a click on the glyph is not swallowed (the glyph\'s own: back to the row)', g.prevented === 0 && g.stopped === 0 && lens.phase === 'animating');
  glyphBtn.click();
  check('… the glyph: back to the row, the scrim down', lens.mode === 'row' && !theater.up && !theater.captionShown);
  fireTimers(LIFT_MS);
}
for (const [label, act] of [['a click', () => pageEvent('click', submitDiv)], ['Esc', () => pageEvent('keydown', doc.body, { key: 'Escape' })], ['a window opened', () => win.dispatchEvent(new win.CustomEvent('visualizationOverlayStateChanged', { detail: { overlay: 'partitions', active: true } }))]]) {
  freshKey();
  slow = [];
  const n = events.length, p = lens.press();
  const was = lens.phase === 'composing' && theater.up;
  act();
  check(`${label} during Compose: queued — the scrim lifts at once, the shimmer runs on`, was && lens.phase === 'composing' && lens.skipQueued && !theater.up && bridge.overlay.scene && events.slice(n).some((e) => e.type === 'skip' && e.queued));
  slow.forEach((f) => f()); slow = null; await settle();
  check('… the compose lands straight on the landing (no animation) and plays', lens.phase === 'landed' && tab.state.status === 'playing' && !events.slice(n).some((e) => e.type === 'animating') && !theater.up && !theater.captionShown && (await p) === 'landed');
  fireTimers(LIFT_MS);
  glyphBtn.click();
}
check('after all of it: <body> and the panels exactly as before', bodyClass() === 'site-body' && snapshot() === before);

console.log('\n— cancels: nothing stale');
/** after a cancel: frames run and nothing is drawn; the plot is the row's, call for call */
function noStaleDraws(label, plot = rowPlot) {
  flush(3);
  const b = ctx2d.calls.length;
  run(200);
  const drawn = ctx2d.calls.length - b;
  check(`${label}: no scrim, no caption, no scene; later frames draw nothing (${drawn} calls); the plot is the row's`, !theater.up && !doc.body.classList.contains(THEATER_CLASS) && !theater.captionShown && !captionInPage()
    && !bridge.overlay.scene && vis.composerOverlay === null && drawn === 0 && dom.raf.pending === 0
    && (plot ? plotCalls() === plot : !plotCalls().includes(OVERLAY_STYLE.wash)));
  fireTimers(LIFT_MS);
  check('… and <body> exactly as before', bodyClass() === 'site-body' && snapshot() === before);
}
await fullShow();
glyphBtn.click();
noStaleDraws('the glyph back to the row mid-show');
await fullShow();
pb.cycleDuration = cycle + 0.5;   // a new cycle: the lens notices on the next frame
flush(1);
check('(a new cycle under the show: the row)', lens.mode === 'row');
pb.cycleDuration = cycle;
tab.syncRhythm();
noStaleDraws('a new cycle mid-show');
await fullShow();
await generate([9, 7, 5, 4]);
check('(a new rhythm under the show: the row, the glyph re-armed)', lens.mode === 'row' && lens.glyph() === 'ready');
noStaleDraws('a new rhythm mid-show (its own plot, no wash)', null);
await generate([8, 7, 6, 5]);
{
  await fullShow();
  win.dispatchEvent(new win.CustomEvent('visualizationOverlayStateChanged', { detail: { overlay: 'partitions', active: true } }));
  check('a window opened mid-show (Partitions\' event): skips to the landing — playing, the scrim down, no scene', lens.phase === 'landed' && tab.state.status === 'playing' && !theater.up && !theater.captionShown && !bridge.overlay.scene);
  win.dispatchEvent(new win.CustomEvent('visualizationOverlayStateChanged', { detail: { overlay: 'partitions', active: false } }));
  check('… the window closing again changes nothing', lens.phase === 'landed');
  glyphBtn.click(); fireTimers(LIFT_MS);
  const left = el('div'), inspector = el('div'); doc.body.append(left, inspector);
  bridge.mountTab({ left, inspector });
  await fullShow();
  bridge.showTab();
  check('the Composer tab shown mid-show: skips first, so the window opens on the composition playing', lens.phase === 'landed' && tab.state.status === 'playing' && !theater.up && bridge.isShown() && left.querySelector('.ctab-go').textContent === 'Stop');
  bridge.hideTab();
  left.remove(); inspector.remove();
  glyphBtn.click(); fireTimers(LIFT_MS);
  noStaleDraws('(and back on the row after the window)');
}
{
  // a cancel and a re-press in the same frame: one frame loop, not two
  await fullShow();
  glyphBtn.click();
  const p = lens.press();   // a recall now, the short version
  run(1700);
  const loops = dom.raf.pending;
  flush(1); const after1 = dom.raf.pending; flush(1); const after2 = dom.raf.pending;
  check(`a cancel and a re-press before the next frame: one frame loop runs (${loops} → ${after1} → ${after2} queued), not two`, (await p) === 'landed' && loops === 1 && after1 === 1 && after2 === 1);
  glyphBtn.click(); fireTimers(LIFT_MS);
}

console.log('\n— reduced motion, and "show the work" off');
check('motionAllowed: false under prefers-reduced-motion; true without it, with no matchMedia, or one that throws', motionAllowed({ matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) }) === false
  && motionAllowed({ matchMedia: () => ({ matches: false }) }) === true && motionAllowed({}) === true && motionAllowed({ matchMedia() { throw new Error('no'); } }) === true);
motionOn = false;
{
  freshKey();
  const n = events.length, s0 = solves;
  glyphBtn.click();
  check('reduced motion, a first compose: composing with no shimmer and no scrim', lens.phase === 'composing' && !bridge.overlay.scene && !theater.up && lastOf('composing').animate === false && lastOf('composing').showWork === true && solves === s0 + 1);
  await settle();
  check('… straight to the landing, playing (no animating); the trace still kept for the window', lens.phase === 'landed' && tab.state.status === 'playing' && !events.slice(n).some((e) => e.type === 'animating') && !theater.up && !theater.captionShown && !!tab.state.trace);
  glyphBtn.click();
  const m = events.length;
  glyphBtn.click();
  check('reduced motion, a recall: straight to the landing', lens.phase === 'landed' && !events.slice(m).some((e) => e.type === 'animating') && !theater.up);
  glyphBtn.click();
}
motionOn = true;
{
  tab.setShowWork(false);
  freshKey();
  const n = events.length;
  glyphBtn.click();
  check('"show the work" off, a first compose: no shimmer, no scrim', lens.phase === 'composing' && !bridge.overlay.scene && !theater.up && lastOf('composing').showWork === false);
  await settle();
  check('… straight to the landing, playing; no trace asked for', lens.phase === 'landed' && tab.state.status === 'playing' && !events.slice(n).some((e) => e.type === 'animating') && !tab.state.trace);
  glyphBtn.click();
  tab.setShowWork(true);
  const m = events.length;
  glyphBtn.click();
  check('… recalled with the work shown again, but no trace to replay: straight to the landing', lens.phase === 'landed' && lastOf('landed').recalled && !events.slice(m).some((e) => e.type === 'animating'));
  glyphBtn.click();
  check('(recallTimeline of nothing is null)', recallTimeline(null) === null && recallTimeline({ events: [] }) === null);
}
check('none of it raised the scrim; <body> and the panels exactly as before', bodyClass() === 'site-body' && snapshot() === before);

console.log('\n— pace (the tutorial\'s brisker theater)');
{
  const { p } = await fullShow({ pace: 2 }), a = lastOf('animating'), start = now - 32;
  check(`press({ pace: 2 }): the full show at pace 2 (the event says so; lens.pace 2), the scrim up`, a.pace === 2 && lens.pace === 2 && a.short === false && theater.up);
  run(Math.ceil((a.scene.end * 1000) / 2) - 32 - 150);
  check(`… still animating a beat before ${(a.scene.end / 2).toFixed(2)} s`, lens.phase === 'animating');
  run(300);
  check(`… landed at half the scene (${((lastOf('landed').at - start) / 1000).toFixed(2)} s of ${a.scene.end.toFixed(2)} s); press() resolved "landed"`, lens.phase === 'landed' && Math.abs((lastOf('landed').at - start) / 1000 - a.scene.end / 2) < 0.05 && (await p) === 'landed');
  glyphBtn.click(); fireTimers(LIFT_MS);
  const q = lens.press({ pace: 3 }), b = lastOf('animating'), s = now;
  check('a recall at pace 3: the short version at pace 3', b.short && b.pace === 3 && lens.phase === 'animating');
  run(Math.ceil((RECALL_SECONDS * 1000) / 3) + 40);
  check(`… landed in a third of ${RECALL_SECONDS} s (${((lastOf('landed').at - s) / 1000).toFixed(2)} s)`, lens.phase === 'landed' && (lastOf('landed').at - s) / 1000 <= RECALL_SECONDS / 3 + 0.05 && (await q) === 'landed');
  glyphBtn.click();
  for (const bad of [0, -1, 'x', null]) {
    lens.press({ pace: bad });
    const ok = lens.pace === 1 && lastOf('animating').pace === 1;
    run(1700);
    glyphBtn.click();
    if (!ok) check(`a bad pace (${bad}) is 1`, false);
  }
  check('a bad pace (0, -1, "x", null) is 1', lens.pace === 1);
}

console.log('\n— ProgressionBar\'s locked voicing yields the Scale chart to the lens');
{
  const PB = loadClass('Playback/AdvancedPlayback/ProgressionBar.js', 'window.ProgressionBar', dom, { extra: { setInterval: () => 0, clearInterval() {} } });
  win.ProgressionBar = PB;
  const ratios = pb.availableRatios.map((r) => r.fraction);
  const mask = ratios.slice(0, 3);
  Object.assign(PB, { open: true, locked: true, timeline: { stages: [{ mask, chordSymbol: 'Cmaj7' }] }, paintEngine: null, overlay: el('div'), _bracketSig: () => 's', _lastSig: 's', _renderBrackets() {} });
  PB._loop();
  run(48);
  const lit = () => chart.children.filter((r) => r.classList.contains('note-selected')).map((r) => r.getAttribute('data-ratio')).join(' ');
  const pbView = `${lit()}|${countEl.textContent}`;
  check(`(the row: ProgressionBar paints its section — "${countEl.textContent}")`, lit() === mask.join(' ') && countEl.textContent === `${mask.length} in Cmaj7` && !PB.chartYielded());
  glyphBtn.click();
  run(1700);   // the recall's short version, then playing
  run(400);
  const lensView = lit(), lensCount = countEl.textContent;
  check(`under the lens its frame loop runs but yields: the chart is the lens's readout ("${lensCount}")`, lens.phase === 'landed' && chart.classList.contains(LOCK_CLASS) && PB.chartYielded() && / in .* · bar \d+$| in the composition$/.test(lensCount) && !/Cmaj7$/.test(lensCount));
  run(300);
  check('… frame after frame (no fight: the readout is still the lens\'s)', countEl.textContent === lensCount || / · bar \d+$/.test(countEl.textContent));
  PB._paintChartForSection(0);
  check('… and a direct paint (a bracket drag) yields too', countEl.textContent !== `${mask.length} in Cmaj7`);
  glyphBtn.click();
  check(`back to the row: the chart rebuilt, then handed back — ProgressionBar's section again ("${countEl.textContent}")`, !chart.classList.contains(LOCK_CLASS) && !PB.chartYielded() && `${lit()}|${countEl.textContent}` === pbView);
  run(48);
  check('… and its loop paints it again, as before the lens', `${lit()}|${countEl.textContent}` === pbView);
  PB.open = false; PB.locked = false; PB.timeline = null;
}

restoreGlobals();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
