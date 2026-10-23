// assert-tutorial.mjs — the guided tour (sprint 2, step 3: Tutorial/tour-script.js, tour-driver.js, tour-boot.js), in
// Node over dom-stub.mjs, with the site's own LRCModule, LRCVisuals, the HUD's minimize and form handlers, the real
// Composer bridge (store, lens, theater) and the old slide tutorial (TutorialUI.js) in a vm.
//   • the layer generator over many seeds: four distinct 3-digit layers, none dividing another, the set's gcd 1, as the
//     Rhythm Input takes them, inside the tone band; Compose's own gates (and compose() itself, on a sample) accept them
//   • the script: its order, and every target on the page (the last of each step's targets in index.html; the others
//     made by the Playback div's or the lens's own code); index.html loads the tour
//   • the timing budget: the opening's model, with Compose's solve measured here on generated sets, ≤ 10 s; and the
//     driver's own clock agreeing with the model
//   • the driver end to end: real typing (an input event a digit), the real Generate, the glyph through lens.press at
//     the tour's pace; the scrim leads the show (the tour yields and clicks nothing); then every stop with Next, Back,
//     the keys, the Composer window peeked and closed; Skip, Esc (also mid-typing: the fields restored), the lens back
//     to the row mid-tour, a new rhythm mid-tour, reduced motion; the page left clean every time
//   • the first visit: auto-open once, never when the storage throws or the URL carries a rhythm; the header restarts
//     it; the old slides stay reachable ("Read the guide") and no longer open by themselves
//   node Composer/tests/assert-tutorial.mjs
import fs from 'node:fs';
import path from 'node:path';
import { makeDom, installGlobals } from './dom-stub.mjs';
import { loadClass, ROOT } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { buildRow } from '../core/row.js';
import { animationTimeline } from '../page/trace-frames.js';
import { STRIPS_CLASS } from '../page/part-strips.js';
import { createComposerBridge } from '../page/composer-bridge.js';
import * as script from '../../Tutorial/tour-script.js';
import { createTour, placePopup, TOUR_ROOT_ID, STILL_CLASS, YIELD_CLASS, TYPING_CLASS, LAYER_INPUT_IDS, GUTTER } from '../../Tutorial/tour-driver.js';
import { bootTour } from '../../Tutorial/tour-boot.js';

const { STEPS, generateLayers, layerProblems, siteAccepts, composerAccepts, openingBudget, typingMs, OPENING_TIMING, TOUR_PACE, OPENING_TARGET_SECONDS, TONE_BAND, autoOpen, markSeen, SEEN_KEY, OLD_DISMISSED_KEY, AUTO_OPEN_DELAY_MS, nextIndex, backIndex, stepIndex, gcd } = script;

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ════════════════════════════════════════ the generator ════════════════════════════════════════
console.log('The guided tour\n\n— the layer generator');
{
  const N = 400, sets = [], bad = [];
  for (let s = 1; s <= N; s++) {
    const g = generateLayers(s), L = g.layers;
    sets.push(L.join(':'));
    const row = buildRow(L);
    const ok = L.length === 4 && L.every((v) => Number.isInteger(v) && v >= 100 && v <= 999) && new Set(L).size === 4
      && L.every((a) => L.every((b) => a === b || a % b !== 0)) && L.reduce(gcd) === 1
      && L.every((v, i) => i === 0 || L[i - 1] > v) && row.tones.length >= TONE_BAND[0] && row.tones.length <= TONE_BAND[1] && row.tones.length === g.tones && !g.fallback;
    if (!ok) bad.push(`${s}: ${L.join(':')}`);
  }
  check(`${N} seeds: every set is four distinct 3-digit layers, none dividing another, gcd 1, greatest first, ${TONE_BAND.join('–')} tones`, bad.length === 0, bad.slice(0, 5).join('; '));
  check(`… varied: ${new Set(sets).size} different sets of ${N}`, new Set(sets).size >= N * 0.9);
  check('… seeded: the same seed gives the same set; another seed another', generateLayers(77).layers.join() === generateLayers(77).layers.join() && generateLayers(77).layers.join() !== generateLayers(78).layers.join());
  const tries = Array.from({ length: 200 }, (_, i) => generateLayers(1000 + i).tries);
  check(`… cheap: ${(tries.reduce((a, b) => a + b, 0) / tries.length).toFixed(1)} draws a set on average, at most ${Math.max(...tries)}`, Math.max(...tries) < 100);
  check('the criteria refuse a layer that divides another (840:420:…)', layerProblems([840, 420, 313, 211]).some((w) => /420 divides 840/.test(w)));
  check('… a set sharing a factor (924:660:396:252, all × 12)', layerProblems([924, 660, 396, 252]).some((w) => /factor 12/.test(w)));
  check('… a 2-digit layer, a repeat', layerProblems([999, 98, 97, 95]).some((w) => /3-digit/.test(w)) && layerProblems([999, 999, 97, 95]).some((w) => /distinct/.test(w)));
  check('… an order the Rhythm Input would reshuffle (it sorts greatest first)', !siteAccepts([175, 252, 320, 480]) && siteAccepts([480, 320, 252, 175]) && layerProblems([175, 252, 320, 480]).some((w) => /Rhythm Input/.test(w)));
  check(`… a valid set outside the tone band (869:794:551:435 has ${composerAccepts([869, 794, 551, 435]).tones} tones)`, layerProblems([869, 794, 551, 435]).some((w) => /tones, outside/.test(w)));
  check('composerAccepts is Compose\'s own gate: it refuses what compose() refuses (4:2, one tone) and passes what it composes', (() => {
    const c = composerAccepts([4, 2, 0, 0]), s = compose([4, 2, 0, 0], 10);
    return !c.ok && c.reason === 'tooFewTones' && s.refused && s.reason === 'tooFewTones' && composerAccepts([8, 7, 6, 5]).ok && !compose([8, 7, 6, 5], 10).refused;
  })());
  check('the fallback set passes the criteria', layerProblems([...script.FALLBACK_LAYERS]).length === 0);
}

// a sample composed for real, the way the lens composes it (the worker's full table, with the trace), timed
console.log('\n— Compose accepts them (a sample, composed), and the opening\'s budget');
const SITE = loadClass('Core Interface/LRCModule.js', 'LRCModule', makeDom());
const sample = [];
{
  compose([8, 7, 6, 5], 10, { worker: true, trace: true });   // warm the JIT, as a page's first compose isn't its worker's first either
  for (const s of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { layers } = generateLayers(s);
    const site = new SITE(), t0 = performance.now();
    site.currentGrid = site.calculateTotalLCM(...layers);
    const { rhythm, layerMap } = site.generateCompositeRhythm(layers);
    const { spacesPlot, spacesLayerMap } = site.generateSpacesPlot(rhythm, site.currentGrid, layerMap);
    site.calculateSpacesPlotByLayer(spacesPlot, spacesLayerMap, layers);
    site.generateRatiosWithFrequency(spacesPlot);
    const siteMs = performance.now() - t0, t1 = performance.now();
    const spec = compose(layers, 10, { worker: true, trace: true });
    const solveMs = performance.now() - t1;
    sample.push({ seed: s, layers, siteMs, solveMs, spec, sceneSeconds: spec.refused ? null : animationTimeline(spec.trace).seconds, onsets: rhythm.length, grid: site.currentGrid });
  }
  check(`8 generated sets composed at a 10 s cycle: none refused, every one with all five parts and drums (${sample.map((x) => x.layers.join(':')).join(', ')})`, sample.every((x) => !x.spec.refused && x.spec.parts.length === 5 && x.spec.parts.every((p) => p.notes.length > 0) && x.spec.drums));
  check('… the site\'s own LRCModule builds the same row (its grid and onset count are the Composer\'s)', sample.every((x) => { const r = buildRow(x.layers); return x.grid === r.grid && x.onsets === r.n && Number.isFinite(x.grid); }));
}
{
  const t = OPENING_TIMING;
  check(`typing four 3-digit layers: ${typingMs([945, 700, 240, 192])} ms (4 × ${t.clearMs} clear + 12 × ${t.charMs} digits + 3 × ${t.fieldGapMs} hops)`, typingMs([945, 700, 240, 192]) === 4 * t.clearMs + 12 * t.charMs + 3 * t.fieldGapMs);
  const rows = sample.map((x) => ({ ...x, budget: openingBudget({ layers: x.layers, solveSeconds: x.solveMs / 1000, sceneSeconds: x.sceneSeconds, siteSeconds: x.siteMs / 1000 }) }));
  for (const r of rows) console.log(`      ${r.layers.join(':').padEnd(16)} beats ${r.budget.beats.toFixed(2)} + typing ${r.budget.typing.toFixed(2)} + site ${r.budget.site.toFixed(3)} + solve ${r.budget.solve.toFixed(2)} + show ${r.sceneSeconds.toFixed(2)}/${TOUR_PACE} = ${r.budget.total.toFixed(2)} s`);
  const worst = Math.max(...rows.map((r) => r.budget.total)), typical = rows.map((r) => r.budget.total).sort((a, b) => a - b)[rows.length >> 1];
  check(`the opening, Begin → playing, measured solve included: typical ${typical.toFixed(2)} s, worst ${worst.toFixed(2)} s (≤ ${OPENING_TARGET_SECONDS} s)`, worst <= OPENING_TARGET_SECONDS);
  const slack = openingBudget({ layers: [999, 998, 997, 996], solveSeconds: 1.5, sceneSeconds: 7.5, siteSeconds: 0.3 });
  check(`… with headroom: a 1.5 s solve, 0.3 s of site work and the longest show (7.5 s) still fit (${slack.total.toFixed(2)} s)`, slack.total <= OPENING_TARGET_SECONDS);
  const slow = openingBudget({ layers: rows[0].layers, solveSeconds: rows[0].solveMs / 1000, sceneSeconds: rows[0].sceneSeconds, pace: 1 });
  check(`… the pace is what makes it fit: at pace 1 the same opening takes ${slow.total.toFixed(2)} s`, slow.total > OPENING_TARGET_SECONDS && Math.abs(slow.total - rows[0].budget.total + rows[0].budget.site - 0.2 - rows[0].sceneSeconds / 2) < 1e-9);
}

// ════════════════════════════════════════ the script ════════════════════════════════════════
console.log('\n— the script and its targets');
{
  check(`the order: ${STEPS.map((s) => s.id).join(' → ')}`, STEPS.map((s) => s.id).join() === 'welcome,numbers,structure,music,parts,scale,composer,cosmos,row');
  check('Avery\'s four lines open it, in order', STEPS[0].title === 'Welcome to the Large Rhythm Collider!' && STEPS[1].title === 'This machine eats numbers…' && STEPS[2].title === '…to turn structure…' && STEPS[3].title === '…into music.');
  check('the opening\'s actions: type, generate, compose; the tour\'s stops after it', STEPS[1].action === 'type' && STEPS[2].action === 'generate' && STEPS[3].action === 'compose' && STEPS.slice(4).every((s) => s.phase === 'tour') && STEPS.slice(0, 4).every((s) => s.phase === 'opening'));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const classes = new Set([...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const tokenIn = (tok) => (tok[0] === '#' ? ids.has(tok.slice(1)) : tok[0] === '.' ? classes.has(tok.slice(1)) : false);
  /** "#a .b": #a is in index.html and its element (up to its own closing tag) holds a .b */
  const inHtml = (sel) => {
    const parts = sel.split(/\s+/);
    if (!parts.every(tokenIn)) return false;
    if (parts.length === 1) return true;
    const id = parts[0].slice(1), m = html.match(new RegExp(`<(\\w+)[^>]*\\bid="${id}"`));
    if (!m) return false;
    const from = m.index, to = html.indexOf(`</${m[1]}>`, from);
    return new RegExp(`class="[^"]*\\b${parts[1].slice(1)}\\b`).test(html.slice(from, to));
  };
  const lastInHtml = STEPS.filter((s) => !inHtml(s.targets[s.targets.length - 1]));
  check('every step\'s last target is in index.html (the anchor when the finer ones aren\'t on the page yet)', lastInHtml.length === 0, lastInHtml.map((s) => s.id).join());
  const playbackUI = fs.readFileSync(path.join(ROOT, 'Playback/PlaybackMainUI.js'), 'utf8');
  const made = (sel) => (sel === `.${STRIPS_CLASS}`) || new RegExp(`id="${sel.slice(1)}"`).test(playbackUI);
  const loose = script.allTargets().filter((sel) => !inHtml(sel) && !made(sel));
  check('every other target is made by the page\'s own code: the part strips (part-strips.js), the Playback div\'s sections (PlaybackMainUI.js)', loose.length === 0, loose.join());
  check('the window the Composer stop peeks into is in index.html (#expanded-playback-view)', ids.has('expanded-playback-view'));
  check('index.html: tour.css linked; tour-boot.js a module after the Composer bridge; "Take the tour" and "Read the guide" in the menu', /<link rel="stylesheet" href="Tutorial\/tour\.css\?v=\d+">/.test(html)
    && html.search(/<script type="module" src="Tutorial\/tour-boot\.js[^"]*"><\/script>/) > html.search(/<script type="module" src="Composer\/page\/composer-bridge\.js/)
    && /id="tutorial-show-btn"[^>]*>Take the tour</.test(html) && /id="tutorial-slides-btn"[^>]*>Read the guide</.test(html));
  check('… the old slides are still there (the guide), without their "Do not show again"', ids.has('tutorial-overlay') && /Tutorial\/TutorialContent\.js/.test(html) && /Tutorial\/TutorialUI\.js/.test(html) && !ids.has('tutorial-dismiss-checkbox'));
  const files = ['tour-script.js', 'tour-driver.js', 'tour-boot.js'].map((f) => fs.readFileSync(path.join(ROOT, 'Tutorial', f), 'utf8'));
  const missing = files.flatMap((src) => [...src.matchAll(/^import [^'"]*['"](\.[^'"]+)['"]/gm)].map((m) => m[1])).filter((rel) => !fs.existsSync(path.join(ROOT, 'Tutorial', rel)));
  check('the tour\'s module graph resolves (every relative import is a file)', missing.length === 0, missing.join());
  check('nextIndex skips the stops that need the composition while the lens is on the row; backIndex never goes into the opening', nextIndex(stepIndex('music'), { lens: 'row' }) === stepIndex('composer') && nextIndex(stepIndex('music')) === stepIndex('parts')
    && backIndex(stepIndex('parts')) === stepIndex('parts') && backIndex(stepIndex('row'), { lens: 'row' }) === stepIndex('cosmos') && nextIndex(stepIndex('row')) === -1);
  check('stepText follows the lens on the last stop', script.stepText(script.stepById('row'), 'row') === script.stepById('row').textRow && script.stepText(script.stepById('row'), 'composition') === script.stepById('row').text);
}
{
  const vp = { width: 1280, height: 800 }, size = { width: 320, height: 140 };
  const below = placePopup({ left: 1200, top: 10, width: 42, height: 28 }, 'below', size, vp);
  check(`placePopup: below the glyph, clamped inside the right gutter (${below.left}, ${below.top})`, below.top === 10 + 28 + 14 && below.left === 1280 - GUTTER - 320);
  const flip = placePopup({ left: 100, top: 700, width: 100, height: 80 }, 'below', size, vp);
  check('… flips above a target with no room below', flip.top === 700 - 14 - 140);
  const phone = placePopup({ left: 20, top: 500, width: 200, height: 100 }, 'right', { width: 343, height: 140 }, { width: 375, height: 812 });
  check(`… at phone width (375) it stays inside the 16 px gutters (${phone.left}..${phone.left + 343})`, phone.left >= GUTTER && phone.left + 343 <= 375 - GUTTER);
}

// ════════════════════════════════════════ the page ════════════════════════════════════════
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
// the virtual clock: the tour's and the bridge's timers, the animation clock; a tick runs to the next timer or 16 ms
let vid = 0, vt = [];
const timers = {
  setTimeout: (f, ms = 0) => { const id = ++vid; vt.push({ id, at: now + Math.max(0, Number(ms) || 0), f }); return id; },
  clearTimeout: (id) => { const t = vt.find((x) => x.id === id); if (t) t.dead = true; },
  setInterval: () => 0, clearInterval: () => {},
};
function fireDue() {
  for (;;) {
    let t = null;
    for (const x of vt) if (!x.dead && !x.done && x.at <= now && (!t || x.at < t.at || (x.at === t.at && x.id < t.id))) t = x;
    if (!t) break;
    t.done = true; t.f();
  }
  if (vt.length > 400) vt = vt.filter((x) => !x.dead && !x.done);
}

const dom = makeDom(), win = dom.window, doc = dom.document;
const restoreGlobals = installGlobals(dom);
win.innerWidth = 1280; win.innerHeight = 800;
const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) e.append(k); return e; };
const withId = (e, id) => { e.id = id; return e; };
async function tick() {
  let next = now + 16;
  for (const x of vt) if (!x.dead && !x.done && x.at > now && x.at < next) next = x.at;
  now = next;
  fireDue();
  dom.raf.flush(dom.raf.pending);
  await settle();
  fireDue();
}
async function advance(ms) { const end = now + ms; while (now < end) await tick(); }
async function until(pred, maxMs = 20000) { const end = now + maxMs; while (!pred() && now < end) await tick(); return !!pred(); }

// ── the page, as index.html lays it out ──
doc.body.className = 'site-body';
const collectionsToggle = withId(el('button', { className: 'collections-toggle', textContent: '▼' }), 'collections-toggle');
const tourBtn = withId(el('button', { className: 'tutorial-show-btn', textContent: 'Take the tour' }), 'tutorial-show-btn');
const slidesBtn = withId(el('button', { className: 'tutorial-show-btn', textContent: 'Read the guide' }), 'tutorial-slides-btn');
const collectionsPanel = withId(el('nav', { className: 'collections-panel' }, withId(el('div', { className: 'dropdown-section-content' }, tourBtn, slidesBtn), 'tutorial-panel')), 'collections-panel');
collectionsPanel.style.display = 'none';
collectionsToggle.addEventListener('click', () => { collectionsPanel.style.display = collectionsPanel.style.display === 'block' ? 'none' : 'block'; });
const title = el('div', { className: 'title-content' }, el('h1', { textContent: 'LARGE RHYTHM COLLIDER' }), collectionsToggle, collectionsPanel);
const glyphBtn = withId(el('button', { className: 'composition-glyph' }), 'composition-glyph'); glyphBtn.hidden = true;
const cosmosBtn = withId(el('button', { className: 'reset-btn' }), 'cosmos-enter-btn'), resetBtn = withId(el('button', { className: 'reset-btn' }), 'reset-display-btn');
const header = withId(el('header', { className: 'title-bar-fixed' }, title, el('div', { className: 'title-bar-controls' }, glyphBtn, cosmosBtn, resetBtn)), 'title-bar');
const main = withId(el('main'), 'lrc-main'), canvas = withId(doc.createElement('canvas'), 'visualization-canvas');
const expanded = withId(el('div'), 'expanded-playback-view'); expanded.style.display = 'none';
main.append(canvas, expanded);
const panel = (id, minimized, ...kids) => {
  const s = withId(el('section', { className: `panel${minimized ? ' minimized' : ''}` }, el('div', { className: 'info-header' }, el('h2', { className: 'panel-title', textContent: id }), el('button', { className: 'minimize-btn', textContent: minimized ? '+' : '−' })), el('div', { className: 'info-content' }, ...kids)), id);
  s.setAttribute('data-default-pos', 'x');
  return s;
};
const inputs = LAYER_INPUT_IDS.map((id, i) => withId(el('input', { type: 'number', value: String([8, 7, 6, 5][i]) }), id));
const genBtn = el('button', { className: 'submit-btn', textContent: 'Generate' }); genBtn.type = 'submit';
const form = withId(el('form', { className: 'rhythm-form' }, el('div', { className: 'layer-inputs' }, ...inputs.map((i) => el('div', { className: 'layer-input' }, i))), genBtn), 'rhythm-form');
// a submit button's default action: its form submits (the browser's; the stub has none)
genBtn.addEventListener('click', () => form.dispatchEvent({ type: 'submit', preventDefault() {} }));
// the Playback div as PlaybackMainUI.js makes it: Main Controls, Layer Controls, Scale Selection, Consonance Families
const playBtn = withId(el('button', { className: 'play-btn', textContent: '▶' }), 'play-stop-btn');
const collapse = (id, label, ...kids) => {
  const b = el('button', { className: 'collapse-btn', textContent: label }); b.setAttribute('data-target', id);
  const c = withId(el('div', { className: 'collapse-content' }, ...kids), id); c.style.display = 'block';
  b.addEventListener('click', () => { const open = c.style.display !== 'none'; c.style.display = open ? 'none' : 'block'; b.classList.toggle('collapsed', open); });
  return el('div', { className: 'playback-section collapsible-section' }, b, c);
};
const layerBox = withId(el('div'), 'layer-controls-container');
const countEl = el('span'); countEl.setAttribute('data-scale-count', '');
const chart = withId(el('div', { className: 'scale-chart-container' }), 'scale-chart-container');
const pbContainer = withId(el('div', {},
  el('div', { className: 'playback-controls' }, playBtn),
  collapse('layer-controls-content', 'Layer Controls', el('div', { className: 'playback-layer-toggles' }), el('div', { className: 'playback-legato-row' }), layerBox),
  collapse('scale-content', 'Scale Selection', el('div', { className: 'scale-controls' }, countEl), chart),
  collapse('interconsonance-families-content', 'Consonance Families', withId(el('div'), 'consonance-families-container'))), 'playback-controls-container');
const submitDiv = panel('rhythm-submit-div', false, form);
const playbackDiv = panel('playback-div', true, pbContainer);
const panels = [submitDiv, panel('rhythm-info-div', true), panel('visualizations-div', true), playbackDiv, panel('search-div', true)];
// the old slide tutorial's overlay (index.html)
const slideOverlay = withId(el('div', { className: 'tutorial-overlay' }, withId(el('div'), 'tutorial-slide-content'), withId(el('button'), 'tutorial-prev'), withId(el('span'), 'tutorial-nav-status'), withId(el('button'), 'tutorial-next'), el('button', { className: 'tutorial-close-btn' })), 'tutorial-overlay');
slideOverlay.style.display = 'none';
doc.body.append(header, main, ...panels, slideOverlay);

// ── the site's scripts ──
const TRP = loadClass('Playback/ToneRowPlayback.js', 'ToneRowPlayback', dom);
const LRCModule = loadClass('Core Interface/LRCModule.js', 'LRCModule', dom);
const LRCVisuals = loadClass('Core Interface/LRCVisuals.js', 'LRCVisuals', dom);
const HUD = loadClass('Core Interface/LRCHudController.js', 'LRCHUDController', dom);
loadClass('Tutorial/TutorialContent.js', 'undefined', dom);
loadClass('Tutorial/TutorialUI.js', 'undefined', dom);
const pb = Object.create(TRP.prototype);
Object.assign(pb, {
  isPlaying: false, cycleDuration: 10, availableRatios: [], selectedNotes: new Set(),
  async startPlayback() { this.isPlaying = true; this.updatePlayButton(); win.dispatchEvent(new win.CustomEvent('playbackStarted', { detail: {} })); },
  stopPlayback() { this.isPlaying = false; this.updatePlayButton(); win.dispatchEvent(new win.CustomEvent('playbackStopped')); },
  updateScaleDisplay() { chart.replaceChildren(...this.availableRatios.slice(0, 40).map((r) => { const row = el('div', { className: 'scale-row note-selected' }); row.setAttribute('data-ratio', r.fraction); return row; })); },
  updateSelectedNotesCount() { countEl.textContent = `${this.selectedNotes.size} of ${this.availableRatios.length} notes selected`; },
});
win.toneRowPlayback = pb;
let motionOn = true;
const runCompose = (l, T, o) => new Promise((resolve) => setTimeout(() => resolve(compose(l, T, o)), 0));
const sessionMap = new Map([['lrc.composer.glyphBreathed', '1']]), session = { getItem: (k) => sessionMap.get(k) ?? null, setItem: (k, v) => sessionMap.set(k, String(v)) };
const bridgeLocal = new Map(), bridgeStorage = { getItem: (k) => bridgeLocal.get(k) ?? null, setItem: (k, v) => bridgeLocal.set(k, String(v)) };
const bridge = createComposerBridge(win, { runCompose, createContext: () => makeCtx(), timers, clock: () => now, storage: bridgeStorage, session, motion: () => motionOn });
win.lrcComposer = bridge;
const { lens, theater, store } = bridge;
win.lrcModule = new LRCModule();
win.lrcVisuals = new LRCVisuals();
win.addEventListener('rhythmGenerated', (e) => { pb.availableRatios = e.detail.ratios; pb.selectedNotes = new Set(e.detail.ratios.map((r) => r.fraction)); pb.updateScaleDisplay(); pb.updateSelectedNotesCount(); });
// the HUD's own minimize buttons and form (its constructor isn't run: just these handlers)
const hud = Object.create(HUD.prototype);
hud.dragState = {}; hud.constrainPanelToBounds = () => {};
for (const p of panels) hud.addMinimizeHandler(p.id);
hud.setupRhythmForm();
// the Partitions window (PartitionsUI's show/hide/tab, as the tour meets them)
const partitionsUI = {
  isActive: false, activeTab: 'partitions', shows: 0, hides: 0,
  show() { this.isActive = true; this.shows++; expanded.style.display = 'flex'; win.dispatchEvent(new win.CustomEvent('visualizationOverlayStateChanged', { detail: { overlay: 'partitions', active: true } })); },
  hide() { this.isActive = false; this.hides++; expanded.style.display = 'none'; win.dispatchEvent(new win.CustomEvent('visualizationOverlayStateChanged', { detail: { overlay: 'partitions', active: false } })); },
  setActiveTab(n) { this.activeTab = n; },
};
win.partitionsUI = partitionsUI;
// every click on the page, and whether the theater's scrim was up for it
const clicks = [];
const origClick = dom.Element.prototype.click;
dom.Element.prototype.click = function () { clicks.push({ el: this, up: theater.up, at: now }); return origClick.call(this); };
// what the layer fields heard
const heard = new Map(LAYER_INPUT_IDS.map((id) => [id, []]));
for (const i of inputs) { i.addEventListener('input', (e) => heard.get(i.id).push({ value: i.value, inputType: e.inputType, data: e.data, at: now })); i.addEventListener('change', () => heard.get(i.id).push({ change: true, value: i.value })); }
const generates = []; win.addEventListener('rhythmGenerated', () => generates.push(now));
const pressed = []; const press0 = lens.press; lens.press = (o) => { pressed.push({ ...o, at: now }); return press0(o); };

const tourLocal = new Map(), tourStorage = { getItem: (k) => tourLocal.get(k) ?? null, setItem: (k, v) => tourLocal.set(k, String(v)) };
let seedNext = 1;
const tour = createTour({ win, doc, timers, raf: (f) => win.requestAnimationFrame(f), motion: () => motionOn, storage: tourStorage, seed: () => seedNext });
const tevents = []; tour.onEvent((type, detail) => tevents.push({ type, detail, at: now }));
const lastT = (type) => [...tevents].reverse().find((e) => e.type === type);
const tourInPage = () => doc.body.querySelectorAll(`#${TOUR_ROOT_ID}`).length > 0;
const pop = () => tour.popup;
const actions = () => (pop() ? pop().querySelectorAll('.lrc-tour-btn, .lrc-tour-link').map((b) => b.textContent) : []);
const btn = (label) => pop()?.querySelectorAll('.lrc-tour-btn, .lrc-tour-link').find((b) => b.textContent === label) ?? null;
const key = (k, target = doc.activeElement) => { const ev = { type: 'keydown', key: k, target, preventDefault() { ev.prevented = true; } }; doc.dispatchEvent(ev); return ev; };
const typingLeft = () => inputs.some((i) => i.classList.contains(TYPING_CLASS));
const clean = () => !tourInPage() && !typingLeft() && !partitionsUI.isActive && !theater.up;
/** to the first stop: start, Begin, run until the tour is on the part strips */
async function toFirstStop(seed) {
  seedNext = seed;
  tour.start(); tour.begin();
  const ok = await until(() => tour.stepId === 'parts' || (tour.stepId === 'row' && lastT('landed')), 30000);
  return ok;
}

// ════════════════════════════════════════ the driver ════════════════════════════════════════
console.log('\n— the old slides: the guide, not opened by themselves');
check('TutorialUI.js no longer opens the slides on load', slideOverlay.style.display === 'none' && typeof win.LRCTutorialSlidesUI?.show === 'function');
slidesBtn.click();
check('"Read the guide" in the menu opens them (window.LRCTutorialSlidesUI)', slideOverlay.style.display === 'flex' && win.LRCTutorialSlidesUI.isOpen());
win.LRCTutorialSlidesUI.hide();

console.log('\n— the welcome');
const before = { values: inputs.map((i) => i.value), submitMin: submitDiv.classList.contains('minimized'), playMin: playbackDiv.classList.contains('minimized') };
tour.start();
await tick();
check('start(): the tour\'s root on the page, the welcome popup a dialog with Begin / Not now / the guide', tourInPage() && tour.stepId === 'welcome' && pop().getAttribute('role') === 'dialog' && pop().getAttribute('aria-labelledby') === 'lrc-tour-title' && actions().join('|') === 'Begin|Not now|or read the guide');
check('… its title is Avery\'s first line; Begin has the focus (keyboard: Enter begins)', pop().querySelector('.lrc-tour-title').textContent === 'Welcome to the Large Rhythm Collider!' && doc.activeElement === btn('Begin'));
check('… the spotlight on the main canvas, glinting round it (motion allowed); the popup placed inside the gutters', tour.root.querySelector('.lrc-tour-spot').style.width === `${100 + 12}px` && tour.root.querySelector('.lrc-tour-spot').classList.contains('lrc-tour-orbit') && parseInt(pop().style.left, 10) >= GUTTER && !tour.root.classList.contains(STILL_CLASS));
check('… seen: the first-visit flag is written', tourLocal.get(SEEN_KEY) === '1');
key('Escape');
check('Esc on the welcome ends it: nothing of the tour left, the page as it was', !tour.active && clean() && lastT('end').detail === 'esc' && inputs.map((i) => i.value).join() === before.values.join() && clicks.length === 1);
key('Escape');
check('… Esc again is the page\'s own (the tour\'s listener is gone)', !tour.active && tevents.filter((e) => e.type === 'end').length === 1);

console.log('\n— the opening: real typing, the real Generate, the glyph at the tour\'s pace');
seedNext = 1;
const expect1 = generateLayers(1).layers;
tour.start();
const t0 = now;
btn('Begin').click();
check('Begin: "This machine eats numbers…", the spotlight on Rhythm Input, a "Skip ▸"', tour.stepId === 'numbers' && pop().querySelector('.lrc-tour-title').textContent === 'This machine eats numbers…' && actions().join() === 'Skip ▸');
await advance(OPENING_TIMING.readMs + 100);
check(`typing has begun in layer A (${heard.get('layer-a').map((h) => h.value).join(' → ')}), the field lit as it's typed`, heard.get('layer-a').length >= 2 && inputs.some((i) => i.classList.contains(TYPING_CLASS)));
await until(() => lastT('typed'), 5000);
{
  const seqs = inputs.map((i) => heard.get(i.id).filter((h) => !h.change).map((h) => h.value));
  const want = expect1.map((v) => ['', ...[...String(v)].map((_, k) => String(v).slice(0, k + 1))]);
  check(`typed ${expect1.join(':')} a digit at a time: an input event a keystroke (${seqs.map((s) => s.join('›')).join('  ')})`, JSON.stringify(seqs) === JSON.stringify(want));
  check('… insertText with its digit, a clear first; one change event a field; the fields left unlit, unfocused', inputs.every((i, k) => { const h = heard.get(i.id); return h[0].inputType === 'deleteContentBackward' && h.filter((x) => x.inputType === 'insertText').map((x) => x.data).join('') === String(expect1[k]) && h.filter((x) => x.change).length === 1; }) && !typingLeft() && !LAYER_INPUT_IDS.includes(doc.activeElement?.id));
  const typedFor = (lastT('typed').at - t0) / 1000;
  check(`… taking ${typedFor.toFixed(2)} s (the read, then ${typingMs(expect1)} ms of typing)`, Math.abs(typedFor - (OPENING_TIMING.readMs + typingMs(expect1)) / 1000) < 0.02);
}
await until(() => generates.length > 0, 5000);
check('"…to turn structure…": the real Generate clicked, the HUD\'s form handler ran, the site generated exactly those layers', tour.stepId === 'structure' && clicks.some((c) => c.el === genBtn) && win.lrcModule.currentRhythms.join() === expect1.join() && win.lrcModule.currentGrid === buildRow(expect1).grid && canvas.classList.contains('active'));
check('… the glyph is ready', lens.glyph() === 'ready');
await until(() => pressed.length > 0, 5000);
check(`"…into music.": the glyph pressed through lens.press({ pace: ${TOUR_PACE} }) — not a page click`, tour.stepId === 'music' && pressed.length === 1 && pressed[0].pace === TOUR_PACE && !clicks.some((c) => c.el === glyphBtn));
await until(() => theater.up, 3000);
await tick();   // the tour's own frame sees it
check('the theater\'s scrim is up and leads: the tour yields (its spotlight and popup hidden, aria-hidden)', theater.up && tour.root.classList.contains(YIELD_CLASS) && tour.root.getAttribute('aria-hidden') === 'true');
const showStart = now;
let yieldedThroughout = true, maxUp = 0;
while (!lastT('landed') && now - showStart < 15000) { await tick(); if (theater.up) { maxUp = now; if (!tour.root.classList.contains(YIELD_CLASS)) yieldedThroughout = false; } }
check('… the tour stays yielded for the whole show, and clicks nothing while the scrim is up', yieldedThroughout && clicks.filter((c) => c.up).length === 0);
const anim = lens.phase === 'landed' && bridge.lens.pace === TOUR_PACE;
check(`landed at pace ${TOUR_PACE}: the composition plays, the scrim lifted, the tour back`, anim && bridge.controller.state.status === 'playing' && !theater.up && !tour.root.classList.contains(YIELD_CLASS) && lastT('landed').detail === 'landed');
{
  const elapsed = (lastT('landed').at - t0) / 1000;
  const sc = animationTimeline(store.state.trace).seconds;
  const model = openingBudget({ layers: expect1, solveSeconds: 0, sceneSeconds: sc, siteSeconds: 0 });
  check(`the driver's own clock agrees with the budget model: ${elapsed.toFixed(2)} s from Begin (the model, with no solve: ${model.total.toFixed(2)} s; the show ${sc.toFixed(2)} s / ${TOUR_PACE})`, Math.abs(elapsed - model.total) < 0.1);
}

console.log('\n— the tour while it plays');
check('stop 1, the part strips: Playback opened by its own minimize button, the spot on the strips, Next focused', tour.stepId === 'parts' && !playbackDiv.classList.contains('minimized') && tour.revealed.includes('playback-div') && doc.activeElement === btn('Next ▸') && pop().querySelector('.lrc-tour-progress').textContent === '1 / 5' && doc.body.querySelectorAll(`.${STRIPS_CLASS}`).length === 1);
check('… Back is disabled on the first stop (no way back into the opening)', btn('◀ Back').disabled === true && tour.back() === false && tour.stepId === 'parts');
key('ArrowRight');
check('→ (focus in the popup): the Scale readout', tour.stepId === 'scale' && pop().querySelector('.lrc-tour-progress').textContent === '2 / 5' && chart.classList.contains('composition-locked'));
key('ArrowLeft');
check('← : back to the part strips', tour.stepId === 'parts');
glyphBtn.focus();
key('ArrowRight', glyphBtn);
check('… arrows elsewhere on the page are the page\'s (focus outside the popup)', tour.stepId === 'parts');
btn('Next ▸').click(); btn('Next ▸').click();
check('Next, Next: the advanced Composer, with "Peek inside"', tour.stepId === 'composer' && actions().join('|') === '◀ Back|Peek inside|Next ▸');
await advance(700);
check('… a double-click hint ripples on the Playback title', tour.root.querySelectorAll('.lrc-tour-ripple').length >= 1);
btn('Peek inside').click();
check('Peek inside: the window opens on its Composer tab, the spot on it; the button says "Close the window"', partitionsUI.isActive && partitionsUI.activeTab === 'composer' && actions().includes('Close the window') && lens.mode === 'composition' && bridge.controller.state.status === 'playing');
btn('Next ▸').click();
check('Next: the window closed again, its remembered tab put back; the Cosmos stop', !partitionsUI.isActive && partitionsUI.activeTab === 'partitions' && tour.stepId === 'cosmos');
btn('◀ Back').click();
partitionsUI.show(); partitionsUI.setActiveTab('composer');   // the user double-clicks the title, as invited
tour.skip();
check('Skip on a stop is Next; a window opened by hand during the Composer stop is closed on leaving it', tour.stepId === 'cosmos' && !partitionsUI.isActive);
partitionsUI.activeTab = 'partitions';
btn('Next ▸').click();
check('the last stop: the glyph back to the row, "Read the guide" and Done', tour.stepId === 'row' && actions().join('|') === '◀ Back|Read the guide|Done' && pop().querySelector('.lrc-tour-text').textContent === script.stepById('row').text);
glyphBtn.click();
check('pressing the glyph there: the row; the text follows the lens', lens.mode === 'row' && pop().querySelector('.lrc-tour-text').textContent === script.stepById('row').textRow);
btn('◀ Back').click();
check('Back from it on the row skips nothing it needn\'t: Cosmos', tour.stepId === 'cosmos');
btn('Next ▸').click(); btn('Done').click();
check('Done: the tour gone; the Playback div minimized again (the row: nothing plays there); the generated rhythm stays; the lens left on the row', !tour.active && clean() && playbackDiv.classList.contains('minimized') && lens.mode === 'row' && win.lrcModule.currentRhythms.join() === expect1.join() && lastT('end').detail === 'done');

console.log('\n— Esc while the composition plays');
check('(to the first stop again, a new seed: a new rhythm, its own full show)', await toFirstStop(2) && tour.stepId === 'parts' && lens.mode === 'composition');
key('Escape');
check('Esc: the tour ends; the composition keeps playing and the lens stays on it; the Playback div stays open (its transport)', !tour.active && clean() && lens.mode === 'composition' && bridge.controller.state.status === 'playing' && !playbackDiv.classList.contains('minimized'));
glyphBtn.click();
playbackDiv.querySelector('.minimize-btn').click();

console.log('\n— Esc mid-typing: no half state');
{
  const prior = inputs.map((i) => i.value);
  for (const h of heard.values()) h.length = 0;
  const g0 = generates.length, c0 = clicks.length;
  seedNext = 3; tour.start(); tour.begin();
  await until(() => heard.get('layer-b').length >= 2, 5000);
  const midA = inputs[0].value;
  key('Escape');
  check(`Esc while typing layer B: the fields back as they were (${prior.join(':')}, layer A had become ${midA})`, !tour.active && inputs.map((i) => i.value).join() === prior.join() && midA !== prior[0] && clean());
  await advance(3000);
  check('… and nothing after: no more keystrokes, no Generate', heard.get('layer-c').length === 0 && generates.length === g0 && !clicks.slice(c0).some((c) => c.el === genBtn));
}

console.log('\n— Skip ▸: the opening hurried');
{
  for (const h of heard.values()) h.length = 0;
  seedNext = 4; tour.start(); tour.begin();
  await advance(200);
  const at = now;
  btn('Skip ▸').click();
  check('Skip ▸: the button greys (once is enough)', tour.hurried && btn('Skip ▸').disabled);
  await until(() => tour.stepId === 'parts', 8000);
  const want = generateLayers(4).layers;
  check(`… still typed for real, a digit an event (${inputs.map((i) => i.value).join(':')}), then Generate, then the glyph`, inputs.every((i, k) => heard.get(i.id).filter((h) => h.inputType === 'insertText').length === String(want[k]).length) && win.lrcModule.currentRhythms.join() === want.join() && pressed.at(-1).pace === TOUR_PACE);
  check(`… and the show skipped to the landing: playing at once (${((now - at) / 1000).toFixed(2)} s after Skip)`, lens.phase === 'landed' && bridge.controller.state.status === 'playing' && now - at < 600);
}

console.log('\n— the lens back to the row mid-tour; a new rhythm mid-tour');
glyphBtn.click();
check('the glyph pressed on the part-strip stop: the strips are gone, so the tour moves to the last stop, its row text', lens.mode === 'row' && tour.stepId === 'row' && pop().querySelector('.lrc-tour-text').textContent === script.stepById('row').textRow);
glyphBtn.click();
await until(() => lens.phase === 'landed', 3000);
check('… the glyph again (a recall): the text says the composition again', lens.mode === 'composition' && pop().querySelector('.lrc-tour-text').textContent === script.stepById('row').text);
tour.end('test');
check('(ended; the composition plays on)', !tour.active && clean() && lens.mode === 'composition');
glyphBtn.click(); playbackDiv.querySelector('.minimize-btn').click();
check('(to the first stop again)', await toFirstStop(5));
btn('Next ▸').click();
inputs.forEach((i, k) => { i.value = String([8, 7, 6, 5][k]); });
genBtn.click();
await until(() => win.lrcModule.currentRhythms.join() === '8,7,6,5', 2000);
await tick();
check('a rhythm generated by hand on the Scale stop: the lens back to the row, the tour on its last stop', lens.mode === 'row' && tour.stepId === 'row');
tour.end('test');
check('(ended clean; the Playback div minimized again, the lens on the row)', clean() && playbackDiv.classList.contains('minimized'));

console.log('\n— reduced motion');
{
  motionOn = false;
  const rip0 = clicks.length;
  check('(prefers-reduced-motion)', true);
  tour.start();
  check('the root is still: no glide, no pulse, no glint (lrc-tour--still; the welcome\'s orbit off)', tour.root.classList.contains(STILL_CLASS) && !tour.root.querySelector('.lrc-tour-spot').classList.contains('lrc-tour-orbit') && tour.still);
  tour.begin();
  let everUp = false, ripples = 0;
  const done = await until(() => { everUp ||= theater.up; ripples = Math.max(ripples, tour.root?.querySelectorAll('.lrc-tour-ripple').length ?? 0); return tour.stepId === 'parts'; }, 20000);
  check('… the opening runs (typed, generated, pressed); the show jumps straight to the landing: no scrim, no ripple', done && !everUp && ripples === 0 && lens.phase === 'landed' && bridge.controller.state.status === 'playing');
  btn('Next ▸').click(); btn('Next ▸').click();
  await advance(3000);
  check('… the Composer stop: no double-click ripple, the text says it', tour.stepId === 'composer' && tour.root.querySelectorAll('.lrc-tour-ripple').length === 0);
  tour.end('test');
  check('(ended clean)', clean() && clicks.length >= rip0);
  glyphBtn.click(); playbackDiv.querySelector('.minimize-btn').click();
  motionOn = true;
}

console.log('\n— the old slides from the tour; the header restarts it');
{
  tour.start();
  btn('or read the guide').click();
  check('"or read the guide" on the welcome: the tour ends, the slides open', !tour.active && clean() && win.LRCTutorialSlidesUI.isOpen());
  tour.start();
  check('starting the tour closes the slides', tour.active && !win.LRCTutorialSlidesUI.isOpen());
  tour.end('test');
  globalThis.__LRC_TOUR_NO_BOOT__ = true;
  const booted = bootTour(win, { storage: tourStorage, timers, tour });
  check('bootTour: window.lrcTour; no auto-open (seen)', win.lrcTour === tour && booted.autoOpening === false);
  collectionsToggle.click();
  tourBtn.click();
  check('"Take the tour" in the menu: the menu closes, the tour starts on its welcome', tour.active && tour.stepId === 'welcome' && collectionsPanel.style.display === 'none');
  const ends = tevents.filter((e) => e.type === 'end').length;
  tourBtn.click();
  check('… pressed again mid-tour: it restarts (ended, then the welcome again)', tour.active && tour.stepId === 'welcome' && tevents.filter((e) => e.type === 'end').length === ends + 1 && lastT('end').detail === 'restart' && doc.body.querySelectorAll(`#${TOUR_ROOT_ID}`).length === 1);
  btn('Not now').click();
  check('Not now: ended clean', !tour.active && clean() && lastT('end').detail === 'later');
}

console.log('\n— the first visit');
{
  const mem = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  check('autoOpen: a fresh storage → yes; seen → no; the old slides\' "Do not show again" → no', autoOpen({ storage: mem() }) && !autoOpen({ storage: (() => { const s = mem(); markSeen(s); return s; })() }) && !autoOpen({ storage: (() => { const s = mem(); s.setItem(OLD_DISMISSED_KEY, 'true'); return s; })() }));
  check('… a storage that throws → no; none at all → no; markSeen on it doesn\'t throw', !autoOpen({ storage: throwing }) && !autoOpen({ storage: null }) && markSeen(throwing) === false);
  check('… a page launched with a rhythm in its URL (?layers=, ?a=) → no; other parameters → yes', !autoOpen({ storage: mem(), search: '?layers=8:7:6:5' }) && !autoOpen({ storage: mem(), search: '?a=8&b=7' }) && autoOpen({ storage: mem(), search: '?utm_source=x' }));
  // a fresh page each: the boot over its own small DOM
  const page = (storage, { cosmos = false, search = '' } = {}) => {
    const d = makeDom(); d.document.body.append(withIdIn(d, 'button', 'tutorial-show-btn'));
    if (cosmos) d.document.body.classList.add('cosmos-active');
    d.window.location = { search };
    const started = [];
    const t = { active: false, start() { this.active = true; started.push(now); }, end() {}, onEvent() {} };
    const b = bootTour(d.window, { storage, timers, tour: t });
    d.window.dispatchEvent(new d.Event('load'));
    return { b, started, win: d.window };
  };
  const first = mem(), p1 = page(first);
  check('a first visit: the tour is set to open by itself after the page loads', p1.b.autoOpening === true && p1.started.length === 0);
  await advance(AUTO_OPEN_DELAY_MS + 50);
  check(`… and opens ${AUTO_OPEN_DELAY_MS} ms after load`, p1.started.length === 1);
  const real = createTour({ win, doc, timers, storage: first, motion: () => true, raf: (f) => win.requestAnimationFrame(f) });
  real.start(); real.end('test');
  const p2 = page(first);
  await advance(AUTO_OPEN_DELAY_MS + 50);
  check('the next visit (seen): it doesn\'t', p2.b.autoOpening === false && p2.started.length === 0 && first.m.get(SEEN_KEY) === '1');
  const p3 = page(throwing);
  await advance(AUTO_OPEN_DELAY_MS + 50);
  check('a storage that throws: it doesn\'t open by itself (and the boot doesn\'t throw)', p3.b.autoOpening === false && p3.started.length === 0);
  const t3 = createTour({ win, doc, timers, storage: throwing, motion: () => true, raf: (f) => win.requestAnimationFrame(f) });
  check('… but the header still starts it', t3.start() === true && t3.active && t3.end('test'));
  const p4 = page(mem(), { search: '?layers=12:9' });
  const p5 = page(mem(), { cosmos: true });
  await advance(AUTO_OPEN_DELAY_MS + 50);
  check('a URL with a rhythm, or the page in Cosmos: no auto-open', p4.started.length === 0 && p5.started.length === 0);
}
function withIdIn(d, tag, id) { const e = d.document.createElement(tag); e.id = id; return e; }

check('the page is clean at the end: no tour, no typing light, no window, no scrim', clean());
dom.Element.prototype.click = origClick;
restoreGlobals();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
