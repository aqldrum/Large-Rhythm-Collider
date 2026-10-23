// assert-page-animate.mjs — Compose animated on the main page (Composer/page/trace-frames.js, compose-animator.js, and
// their wiring in plot-overlay.js, tab-controller.js and composer-tab.js), in Node, against the site's own composite
// rhythm (LRCModule.js in a vm) on rows from 8:7:6:5 to 16,359 onsets:
//   • frames: the steps run forward (monotonic), the parts only ever gain nodes, and the last frame is exactly the tab's
//     lit nodes and nothing else; every node a frame draws is a real plotted onset (a trace node found by its tick, or a
//     lit node); the stories (root candidates, bar lines, runner-up lines, chord flicks and tones, settle flashes, the
//     parts' cascade, the drums dropping in) are there; a frame's size doesn't grow with the row
//   • the painter on a recording canvas: a base with no lit node, then each frame one blit plus a bounded number of
//     marks (on the 16k row too); the painted last frame puts dots exactly where the overlay's own draw puts them
//   • the tab end to end (dom-stub.mjs, a fake clock, the worker in this thread): the shimmer while Compose runs, the
//     animation, the landing; skip by the button, a click, the plot, Esc; cancel on a knob, the rhythm, main playback,
//     leaving the tab, the toggle — with no stale draw after; "show the work" off is the tab as it was, kept in storage
//   node Composer/tests/assert-page-animate.mjs
import { compose } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';
import { arrangeDrums } from '../core/drums.js';
import { classOfCents } from '../core/frame.js';
import { highlightsOf, plotOf, indexOfTick, PART_COLORS } from '../page/plot-highlights.js';
import { createPlotOverlay } from '../page/plot-overlay.js';
import { buildScene, frameAt, finalFrame, frameIndices, animationTimeline, ANIMATION_LIMITS, ANIM_COLORS, traceMatchesPlot } from '../page/trace-frames.js';
import { createComposeAnimator, paintFrame, paintShimmer, readShowWork, writeShowWork, SHOW_WORK_KEY } from '../page/compose-animator.js';
import { createComposeRunner } from '../perform/compose-runner.js';
import { makeDom, installGlobals, recordingContext } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const fakePositions = (n) => Array.from({ length: n }, (_, i) => ({ x: 40 + (i * 720) / Math.max(1, n - 1), y: 100 + (i % 7), index: i }));
const same = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
const FPS = 60;

console.log('Compose animated on the main page');

// ── frames ──
const CASES = [
  { site: [8, 7, 6, 5], T: 4 }, { site: [41, 42, 43, 1], T: 8 }, { site: [19, 17, 16, 15], T: 6 }, { site: [768, 769, 1, 1], T: 8 },
  { site: [41, 42, 43, 1], T: 8, drums: { mode: 'son' }, label: 'drums re-arranged (son)' },
  { site: [19, 17, 16, 15], T: 6, progression: 'pin', label: 'a targeted progression' },
  { site: [4099, 4093, 4091, 4079], T: 16, story: true },
];
const scenes = {};
for (const c of CASES) {
  const r = siteRhythm(c.site), plot = plotOf(r), layers = c.site.map((v) => (v > 1 ? v : 0));
  let progression = null;
  if (c.progression) { const first = compose(layers, c.T, { seed: 1 }); progression = first.chords.map((ch, k) => (k === 0 ? ch.rootTone : null)); }
  const t0 = performance.now(), spec = compose(layers, c.T, { seed: 1, trace: true, progression }), ms = performance.now() - t0;
  const { trace, ...plain } = spec;
  const drums = c.drums ? arrangeDrums(plain, c.drums) : undefined, final = highlightsOf({ spec: plain, drums }, plot);
  console.log(`\n— ${c.site.join(':')}${c.label ? `, ${c.label}` : ''} (${plot.n.toLocaleString()} onsets; compose with the trace ${ms.toFixed(0)} ms)`);
  const b0 = performance.now(), scene = buildScene({ trace, plot, final }), bms = performance.now() - b0;
  check(`a scene (${bms.toFixed(1)} ms): every trace node is a plotted onset (by its tick)`, scene && scene.missed === 0 && traceMatchesPlot(trace, plot));
  check(`the animation runs ${scene.end.toFixed(2)} s: inside ${ANIMATION_LIMITS[0]}–${ANIMATION_LIMITS[1]} s`, scene.end >= ANIMATION_LIMITS[0] - 1e-9 && scene.end <= ANIMATION_LIMITS[1] + 1e-9);
  const allowed = new Set();
  for (const [k, v] of Object.entries(trace.nodes)) { const i = indexOfTick(plot.ticks, v.tick); if (i >= 0 && i === Number(k)) allowed.add(i); }
  for (const h of Object.values(final.parts)) for (const i of h.indices) allowed.add(i);
  const finalTotal = Object.values(final.parts).reduce((x, h) => x + h.indices.length, 0), bound = 3 * trace.stats.nodes + finalTotal + 2 * scene.bars * 8 + 16;
  let prev = null, mono = '', grow = '', stray = '', range = '', maxDrawn = 0, frames = 0, fms = 0;
  for (let k = 0; k <= Math.ceil((scene.end + 0.2) * FPS); k++) {
    const t = k / FPS, a = performance.now(), f = frameAt(scene, t);
    fms += performance.now() - a; frames++;
    if (prev) {
      if (f.step < prev.step || f.groupIndex < prev.groupIndex) mono ||= `t ${t.toFixed(3)}: step ${prev.step} → ${f.step}`;
      for (const [id, ix] of Object.entries(prev.parts)) if ((f.parts[id] || []).length < ix.length) grow ||= `t ${t.toFixed(3)}: ${id} lost nodes`;
    }
    for (const [id, ix] of Object.entries(f.parts)) if (!ix.every((i) => final.parts[id].indices.includes(i))) grow ||= `${id}: a landed node that is not lit at the end`;
    const drawn = frameIndices(f);
    for (const i of drawn) if (!Number.isInteger(i) || i < 0 || i >= plot.n || !allowed.has(i)) { stray ||= `t ${t.toFixed(3)} (${f.kind}): index ${i}`; break; }
    for (const x of [...f.bands, ...f.spans]) if (!(x.from >= 0 && x.to < plot.n && x.from <= x.to)) range ||= `${f.kind}: ${x.from}..${x.to}`;
    if (f.sweep && !(Number.isInteger(f.sweep.index) && f.sweep.index >= 0 && f.sweep.index < plot.n)) range ||= `the sweep at ${f.sweep.index}`;
    maxDrawn = Math.max(maxDrawn, drawn.length + f.paths.length);
    prev = f;
  }
  check(`${frames} frames at ${FPS} fps run forward: the step and the beat never go back`, !mono, mono);
  check('the parts only gain nodes, and only nodes lit at the end', !grow, grow);
  check('every node a frame draws (marks, lines, rules, landed parts) is a real plotted onset the trace or the lit nodes name', !stray, stray);
  check('bar bands, slot windows and the row\'s scan line are on plotted onsets', !range, range);
  check(`a frame draws at most ${maxDrawn} nodes (bound ${bound}, the row ${plot.n.toLocaleString()}); ${(fms / frames).toFixed(3)} ms a frame`, maxDrawn <= bound && (plot.n < 2000 || maxDrawn < plot.n / 20));
  const end = frameAt(scene, scene.end), later = frameAt(scene, scene.end + 5);
  const exact = (f) => f.done && Object.keys(final.parts).every((id) => same(f.parts[id] || [], final.parts[id].indices)) && Object.keys(f.parts).length === Object.keys(final.parts).length
    && !f.marks.length && !f.paths.length && !f.rules.length && !f.spans.length && !f.bands.length;
  check('the last frame (t = end, and after) is exactly the tab\'s lit nodes, a part each, and nothing else', exact(end) && exact(later) && exact(finalFrame(scene)));
  const before = frameAt(scene, scene.end - 1e-6);
  check('just before the end the parts are all landed too (the landing is no jump)', Object.keys(final.parts).every((id) => same(before.parts[id] || [], final.parts[id].indices)));
  scenes[c.site.join(':') + (c.label ? `/${c.label}` : '')] = { scene, trace, final, plot, plain };
}

console.log('\n— the stories (16,359 onsets and 41:42:43)');
for (const key of ['4099:4093:4091:4079', '41:42:43:1']) {
  const { scene, trace, final } = scenes[key];
  const stepsOf = (kind, pred = () => true) => scene.steps.filter((s) => s.kind === kind && pred(s));
  const framesOf = (s, n = 24) => Array.from({ length: n }, (_, j) => frameAt(scene, s.start + (s.duration * (j + 0.5)) / n));
  console.log(`  ${key}:`);
  const rs = stepsOf('root')[0], rf = framesOf(rs, 40), root = trace.events.find((e) => e.kind === 'root');
  const said = new Set(rf.map((f) => f.detail).filter((d) => d.startsWith('candidate')));
  const winner = root.candidates.find((c) => c.tone === root.pick), winIdx = winner.samples.map((n) => indexOfTick(scene.plot.ticks, trace.nodes[n].tick));
  const last = rf[rf.length - 1];
  check(`root: ${said.size} candidates pulse in turn, then the winner (${winner.ratio}) holds on its ${winIdx.length} sampled onsets in the root colour`, said.size >= Math.min(3, root.candidates.length)
    && winIdx.every((i) => last.marks.some((m) => m.index === i && m.color === ANIM_COLORS.root)) && last.detail.includes('wins'));
  check('root: the rejects fade (grey, then gone by the step\'s end)', rf.some((f) => f.marks.some((m) => m.color === ANIM_COLORS.reject)) && frameAt(scene, rs.start + rs.duration - 1e-6).marks.filter((m) => m.color === ANIM_COLORS.reject).every((m) => m.alpha < 0.02));
  const ms = stepsOf('meter')[0], counts = framesOf(ms, 12).map((f) => f.rules.length);
  check(`meter: the bar lines sweep in (${counts[0]} → ${counts[counts.length - 1]} of ${scene.bars})`, counts[counts.length - 1] === scene.bars && counts[0] < counts[counts.length - 1]);
  const ps = stepsOf('phase')[0], pe = frameAt(scene, ps.start + ps.duration * 0.9), phase = trace.events.find((e) => e.kind === 'phase');
  check('phase: the chosen downbeat bursts on its onset', pe.marks.some((m) => m.shape === 'ring' && m.index === indexOfTick(scene.plot.ticks, trace.nodes[phase.node].tick)));
  const cs = stepsOf('cells')[0];
  check('cells: the slots tick in, each with its window under the plot', framesOf(cs, 8).some((f) => f.spans.length >= 8));
  const ls = stepsOf('lead', (s) => s.event.stage === 'pass1' && !s.event.skipped)[0], lf = framesOf(ls, 30), lev = ls.event;
  const minedIdx = trace.lines[lev.mined.id].notes.map((x) => indexOfTick(scene.plot.ticks, trace.nodes[x.node].tick));
  check(`lead: the ${lev.runnersUp.length} runners-up drawn faint through their onsets, then the chosen line drawn bright`, lf.some((f) => f.paths.filter((p) => p.color === ANIM_COLORS.candidate).length === lev.runnersUp.length)
    && lf[lf.length - 1].paths.some((p) => p.color === PART_COLORS.lead && same(p.indices, minedIdx)) && !lf[lf.length - 1].paths.some((p) => p.color === ANIM_COLORS.candidate && p.alpha > 0.02));
  const ch = stepsOf('chord', (s) => s.event.round === 0 && s.event.candidates.length > 1)[0];
  if (ch) {
    const cf = framesOf(ch, 60), labels = new Set(cf.map((f) => f.lanes.chords[ch.event.bar])), endF = cf[cf.length - 1];
    const e = root.frameCentsEachSide, pick = ch.event.pick, tones = endF.marks.filter((m) => m.color === PART_COLORS.chords && m.shape === 'dot' && m.index !== indexOfTick(scene.plot.ticks, trace.nodes[pick.root.node].tick));
    const nodeOf = new Map(Object.values(trace.nodes).map((v) => [indexOfTick(scene.plot.ticks, v.tick), v]));
    check(`chords: bar ${ch.event.bar + 1}'s candidates flick through in the lane (${[...labels].join(', ')}), landing on ${pick.name}`, labels.size >= 2 && endF.lanes.chords[ch.event.bar] === pick.name && endF.lanes.hot === ch.event.bar);
    check(`chords: the pick's chord tones light (${tones.length}), each a ${pick.name} tone within the frame`, tones.length > 0 && tones.every((m) => { const c = classOfCents(nodeOf.get(m.index).cents - pick.root.cents); return pick.intervals.includes(c.pc) && Math.abs(c.dev) <= e + 1e-9; }));
  }
  const sc = stepsOf('settle', (s) => s.event.outcome === 'changed')[0];
  if (sc) {
    const sf = framesOf(sc, 12), bands = Math.max(...sf.map((f) => f.bands.filter((b) => b.color === ANIM_COLORS.changed).length));
    check(`settle ${sc.event.round}: the changed bars (${sc.event.changedBars.map((b) => b + 1).join(', ')}) flash, in the lanes too`, bands >= sc.event.changedBars.length && sf.some((f) => same(f.lanes.flash, sc.event.changedBars)));
  }
  const re = stepsOf('lead', (s) => s.event.stage !== 'pass1' && s.event.kept === 'mined' && s.event.held)[0];
  if (re) {
    const rf2 = framesOf(re, 30), heldIdx = trace.lines[re.event.held.id].notes.map((x) => indexOfTick(scene.plot.ticks, trace.nodes[x.node].tick));
    check(`the lead re-tested (${re.label}): the held line flags, then the new line re-draws in its place`, rf2.some((f) => f.paths.some((p) => p.color === ANIM_COLORS.changed && same(p.indices, heldIdx)))
      && rf2[rf2.length - 1].paths.some((p) => p.color === PART_COLORS.lead && p.indices.length > 1));
  }
  const kept = stepsOf('lead', (s) => s.event.stage !== 'pass1' && s.event.kept === 'held')[0];
  if (kept) check(`a held line that wins (${kept.label}) stays, drawn bright`, frameAt(scene, kept.start + kept.duration * 0.9).paths.some((p) => p.color === PART_COLORS.lead && p.width >= 2));
  const part = stepsOf('part', (s) => (final.parts[s.event.part]?.notes.length || 0) >= 4)[0], pid = part.event.part;
  const mids = framesOf(part, 10).map((f) => (f.parts[pid] || []).length);
  check(`parts: ${pid}'s notes cascade in (${mids.join(' ')} of ${final.parts[pid].indices.length}), with the lanes revealed`, mids.some((x) => x > 0 && x < final.parts[pid].indices.length) && framesOf(part, 2)[1].lanes.show[pid] === 'shown');
  const ds = stepsOf('drums')[0], df = framesOf(ds, 20);
  check('drums: the strokes drop in bar by bar (squares falling into place)', df.some((f) => f.marks.some((m) => m.shape === 'square' && m.dy < -1)) && df.map((f) => (f.parts.drums || []).length).some((x, i, a) => i > 0 && x > a[i - 1]));
}

// ── the painter ──
console.log('\n— the painter on a recording canvas');
for (const key of ['41:42:43:1', '4099:4093:4091:4079']) {
  const { scene, final, plot } = scenes[key], positions = fakePositions(plot.n);
  const canvas = { width: 1600, height: 800 }, ctx = recordingContext(canvas), snapCanvas = { width: 0, height: 0, ctx: recordingContext(null), getContext() { return this.ctx; } };
  const overlay = createPlotOverlay({ getHighlights: () => final, getSelected: () => 'lead', makeCanvas: () => snapCanvas });
  const view = { positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false };
  overlay.setScene(true);
  overlay.draw(ctx, view);
  check(`${key}: the scene's base is the wash alone (no lit node), snapshotted`, ctx.calls.some((c) => c[0] === 'fill' && c[1] === 'evenodd') && !ctx.calls.some((c) => c[0] === 'arc') && overlay.snapshotted && overlay.scene);
  let maxOps = 0, firstOk = true;
  const OPS = new Set(['arc', 'rect', 'fillRect', 'lineTo', 'moveTo']);
  for (let k = 0; k <= Math.ceil(scene.end * 30); k++) {
    const f = frameAt(scene, k / 30), b = ctx.calls.length;
    overlay.paint((c, v) => paintFrame(c, v, f, final, { selected: 'lead' }));
    const calls = ctx.calls.slice(b);
    if (!(calls[0][0] === 'save' && calls[1][0] === 'setTransform' && calls[2][0] === 'drawImage' && calls[2][1] === snapCanvas)) firstOk = false;
    maxOps = Math.max(maxOps, calls.filter((c) => OPS.has(c[0])).length);
  }
  check('each frame: the base back in one blit, then the frame', firstOk);
  check(`each frame draws at most ${maxOps} marks and segments (the row has ${plot.n.toLocaleString()} onsets)`, maxOps <= 4 * (3 * scenes[key].trace.stats.nodes + 400) && (plot.n < 2000 || maxOps < plot.n / 4));
  // the landing: the painted last frame's dots are exactly the overlay's own draw's
  const a = recordingContext(canvas), b = recordingContext(canvas);
  paintFrame(a, view, finalFrame(scene), final, { selected: 'lead' });
  overlay.setScene(false);
  overlay.draw(b, view);
  const afterWash = (c) => c.calls.slice(Math.max(0, c.calls.findIndex((x) => x[0] === 'fill' && x[1] === 'evenodd') + 1));
  const dots = (c) => afterWash(c).filter((x) => x[0] === 'arc' || x[0] === 'rect').map((x) => x.slice(1, 4).map((v) => v.toFixed(4)).join()).sort().join('|');
  check('the painted last frame puts every lit dot, square and ring exactly where the overlay\'s own draw does', dots(a) === dots(b) && dots(a).length > 0);
  const s = recordingContext(canvas);
  paintShimmer(s, view, 0.4);
  check('the shimmer is a dozen rects and a word, whatever the row', s.calls.filter((c) => c[0] === 'fillRect').length <= 12 && s.calls.some((c) => c[0] === 'fillText' && c[1] === 'composing…'));
}

console.log('\n— the driver');
{
  let now = 0;
  const a = createComposeAnimator({ clock: () => now }), { trace, plot, final } = scenes['8:7:6:5'];
  check('idle: tick() is null; skip and cancel do nothing', a.status === 'idle' && a.tick() === null && !a.skip() && !a.cancel());
  a.wait(); now = 700;
  const w = a.tick();
  check('waiting: a shimmer, its phase from the clock; skip does nothing yet (no step is faked before the trace)', a.status === 'waiting' && w.kind === 'shimmer' && w.phase > 0 && !a.skip() && a.status === 'waiting');
  check('a trace of another rhythm, or a refusal, has nothing to animate', !a.start({ trace, plot: scenes['41:42:43:1'].plot, final }) && a.status === 'idle'
    && !a.start({ trace: compose([7, 0, 0, 0], 4, { trace: true }).trace, plot, final }));
  a.wait(); a.start({ trace, plot, final });
  now += 1000;
  const f1 = a.tick();
  check('playing: the frame at the clock\'s t', a.status === 'playing' && f1.kind === 'frame' && Math.abs(f1.frame.t - 1) < 1e-9);
  now += 1e6;
  const e = a.tick();
  check('past the end: ended, on the final frame, then idle', e.kind === 'ended' && e.frame.done && a.status === 'idle' && a.tick() === null);
  a.wait(); a.start({ trace, plot, final });
  check('skip: from playing straight to idle', a.skip() && a.status === 'idle');
  const store = new Map(), storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  check('"show the work": on by default; kept as 0/1; a storage that throws reads as on and is never fatal', readShowWork(storage) && (writeShowWork(storage, false), store.get(SHOW_WORK_KEY) === '0' && !readShowWork(storage))
    && readShowWork(throwing) && (writeShowWork(throwing, false), true) && readShowWork(null));
}

// ── the tab, end to end ──
console.log('\n— the tab, end to end');
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
class FakeWorker {
  constructor() { this.onmessage = null; this.posted = []; }
  postMessage(data) { this.posted.push(data); setTimeout(() => this.onmessage?.({ data: structuredClone(answer(data)) }), 0); }
}
const dom = makeDom(), win = dom.window, doc = dom.document;
const restore = installGlobals(dom, { Worker: FakeWorker });
let now = 0;
const clock = () => now;
const store = new Map(), storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const canvas = doc.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
const ctx2d = canvas.getContext('2d');
win.toneRowPlayback = { isPlaying: false, cycleDuration: 6, stopPlayback() { this.isPlaying = false; } };
win.lrcVisuals = {
  currentPlotType: 'linear', composerOverlay: null, draws: 0, compositeRhythm: null, grid: 0, positions: [],
  setComposerOverlay(o) { this.composerOverlay = o; this.drawPlot(); },
  drawPlot() { this.draws++; ctx2d.calls.push(['plot']); this.composerOverlay?.draw(ctx2d, { positions: this.positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false }); },
};
function setRhythm(layers) {
  const r = siteRhythm(layers);
  win.lrcModule = { currentRhythms: layers, currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm };
  Object.assign(win.lrcVisuals, { compositeRhythm: r.compositeRhythm, grid: r.grid, positions: fakePositions(r.compositeRhythm.length) });
}
setRhythm([19, 17, 16, 15]);
const mirror = dom.withId('canvas', 'partitions-mirror-canvas');
const { createComposerBridge } = await import('../page/composer-bridge.js');
const asked = [], worker = new FakeWorker();
const runner = createComposeRunner({ makeWorker: () => worker });
const runCompose = (l, T, o) => { asked.push({ ...o }); return runner(l, T, o); };
const bridge = createComposerBridge(win, { runCompose, createContext: () => makeCtx(), timers: { setInterval: () => 1, clearInterval: () => {} }, clock, storage });
// (sprint 2) the tab's state is the composition store's current entry, so it is read live (a new rhythm is another entry)
const tab = bridge.controller, anim = bridge.animator, S = new Proxy({}, { get: (_, k) => tab.state[k] });
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (cls) => left.querySelector(`.${cls}`), qa = (cls) => left.querySelectorAll(`.${cls}`);
const go = q('ctab-go'), work = q('ctab-work'), caption = q('ctab-caption');
const plotted = () => ({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid });
const lanesHidden = () => qa('ctab-lane').filter((l) => l.classList.contains('ctab-anim-hidden')).length;
/** run the clock forward, a frame each 16 ms → the frames' draw calls */
const run = (ms) => { const out = []; for (let t = 0; t < ms; t += 16) { now += 16; const b = ctx2d.calls.length; dom.raf.flush(1); out.push(ctx2d.calls.slice(b)); } return out; };
const litNow = () => { const h = bridge.overlay.highlights, want = tab.highlights(plotted()); return h && want && h === want && !bridge.overlay.scene; };

check('"show the work" is on by default (nothing stored)', work.classList.contains('on') && tab.view.showWork);
go.click();
check('Compose: the worker is asked for the trace', asked.length === 1 && asked[0].trace === true && worker.posted[0].options.trace === true);
check('while it runs: waiting, the tab marked animating, a "composing…" caption, the plot washed as the base', anim.status === 'waiting' && left.classList.contains('ctab-animating') && caption.style.display !== 'none'
  && q('ctab-caption-label').textContent === 'composing…' && bridge.overlay.scene && bridge.overlay.snapshotted);
let fr = run(32);
check('… and the plot shimmers (the base blitted, then a word and a few rects)', fr.every((c) => c.some((x) => x[0] === 'drawImage') && c.some((x) => x[0] === 'fillText' && x[1] === 'composing…')));
await settle();
check('the trace is back: playing; the button says Skip; the trace is kept apart (not in the spec or its JSON)', anim.status === 'playing' && go.textContent.startsWith('Skip') && S.trace && !('trace' in S.spec) && !tab.core.exportJSON().includes('"events"'));
check('the lanes are there, every part waiting to land', qa('ctab-lane').length === 6 && lanesHidden() === 6);
const afterStart = ctx2d.calls.slice(ctx2d.calls.lastIndexOf(ctx2d.calls.findLast((c) => c[0] === 'plot')));
check('the plot was redrawn as the base: washed, with no lit node', afterStart.some((c) => c[0] === 'fill') && !afterStart.some((c) => c[0] === 'arc'));
const end = anim.scene.end, labels = new Set(), hiddenSeen = new Set();
let chordFlicks = new Set(), painted = 0, maxDraw = 0;
for (let k = 0; k < Math.ceil((end - 0.2) * 1000 / 16); k++) {
  const c = run(16)[0];
  if (c.length && c[2]?.[0] === 'drawImage') painted++;
  maxDraw = Math.max(maxDraw, c.filter((x) => x[0] === 'arc' || x[0] === 'rect' || x[0] === 'fillRect').length);
  labels.add(q('ctab-caption-label').textContent); hiddenSeen.add(lanesHidden());
  const chord = left.querySelector('.ctab-chord'); if (chord) chordFlicks.add(chord.textContent);
}
check(`the frames paint over the base (${painted}), a bounded few marks each (at most ${maxDraw})`, painted > 100 && maxDraw < 400);
check(`the caption walks the steps (${labels.size} captions), the beats strip lit as it goes`, labels.size > 10 && qa('ctab-beat').length === anim.scene.timeline.groups.length && qa('ctab-beat').some((b) => b.classList.contains('past')));
check(`the lanes land part by part (${[...hiddenSeen].sort((a, b) => b - a).join(' → ')} waiting)`, hiddenSeen.has(6) && hiddenSeen.has(0) && hiddenSeen.size >= 4);
check(`bar 1's chord flicks through its candidates in the lane (${[...chordFlicks].join(', ')})`, chordFlicks.size >= 2 && chordFlicks.has(S.spec.chords[0].name));
check('the readouts and decisions wait (hidden) until the end', left.classList.contains('ctab-animating'));
run(400);
check('the end: idle, the overlay\'s own draw back, lit exactly as the tab lights the spec', anim.status === 'idle' && litNow() && bridge.overlay.snapshotted);
check('… the button says Perform, the caption gone, every lane shown, the readouts back', go.textContent === 'Perform' && caption.style.display === 'none' && lanesHidden() === 0 && !left.classList.contains('ctab-animating')
  && !qa('ctab-anim-hot').length && !qa('ctab-anim-flash').length);
const quiet = ctx2d.calls.length;
dom.raf.flush(3);
check('after the end, frames draw nothing (no stale animation)', ctx2d.calls.length === quiet);
go.click(); await settle(1);
check('then Perform works as before', tab.state.status === 'playing' && go.textContent === 'Stop');
go.click();

/** compose again (a new seed) and start playing → the frames so far */
async function playAgain(seed) {
  tab.core.setSeed(seed);
  go.click(); await settle();
  run(48);
  return anim.status === 'playing';
}
const noStale = (what) => {
  const b = ctx2d.calls.length; dom.raf.flush(3);
  const lastPlot = ctx2d.calls.findLastIndex((c) => c[0] === 'plot');
  return anim.status === 'idle' && !bridge.overlay.scene && ctx2d.calls.length === b && lastPlot >= 0 && !left.classList.contains('ctab-animating') && lanesHidden() === 0 && what;
};
console.log('\n— skip');
check('(playing again)', await playAgain(2));
go.click();
check('the button (Skip) jumps to the end: lit exactly, Perform (not played)', anim.status === 'idle' && litNow() && go.textContent === 'Perform' && S.status === 'ready');
await playAgain(3);
left.click();
check('a click in the tab skips', anim.status === 'idle' && litNow());
await playAgain(4);
mirror.click();
check('a click on the plot (the window\'s mirror) skips', anim.status === 'idle' && litNow());
await playAgain(5);
doc.dispatchEvent({ type: 'keydown', key: 'Enter' });
check('another key does nothing', anim.status === 'playing');
doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
check('Esc skips', anim.status === 'idle' && litNow() && noStale(true));

console.log('\n— cancel: any change drops it, with no stale draw');
await playAgain(6);
tab.core.setKnob('settlePasses', 1);
check('a knob: dropped; the spec\'s nodes stay lit as before a knob change, Compose again', noStale(litNow()) && go.textContent === 'Compose');
await playAgain(7);
tab.select('bass');
check('the selection: dropped, lit with bass on top', noStale(litNow()));
await playAgain(8);
win.dispatchEvent(new win.Event('playbackStarted'));
check('main playback starting: dropped', noStale(litNow()));
await playAgain(9);
setRhythm([41, 42, 43, 1]);
win.dispatchEvent(new win.Event('rhythmGenerated'));
check('a new rhythm on the page: dropped, nothing lit (the composition is of the old rhythm)', noStale(bridge.overlay.highlights === null) && go.textContent === 'Compose');
check('(playing on 41:42:43)', await playAgain(10));
bridge.hideTab();
check('leaving the tab: dropped, the overlay off the plot, no frame left running', anim.status === 'idle' && win.lrcVisuals.composerOverlay === null && !left.classList.contains('ctab-animating') && dom.raf.flush(2) <= 2);
bridge.showTab();
check('back on the tab: no animation, the lanes as they are', anim.status === 'idle' && lanesHidden() === 0 && litNow());
tab.core.setSeed(11);
go.click();
win.dispatchEvent(new win.Event('playbackStarted'));
check('main playback starting while Compose runs: the shimmer is dropped', anim.status === 'idle' && !bridge.overlay.scene);
await settle();
check('… and the compose lands as it would have, with no animation', S.status === 'ready' && anim.status === 'idle' && go.textContent === 'Perform' && litNow());
await playAgain(12);
work.click();
check('turning "show the work" off mid-animation drops it, and is kept in storage', noStale(litNow()) && store.get('lrc.composer.showWork') === '0' && !work.classList.contains('on'));

console.log('\n— "show the work" off: the tab as it was');
tab.core.setSeed(13);
const nAsked = asked.length, b0 = ctx2d.calls.length;
go.click();
check('Compose asks for no trace (the options exactly as before)', asked.length === nAsked + 1 && !('trace' in asked[nAsked]) && !('trace' in worker.posted[worker.posted.length - 1].options));
check('no shimmer: not waiting, no caption, the base never set', anim.status === 'idle' && caption.style.display === 'none' && !bridge.overlay.scene && !left.classList.contains('ctab-animating'));
await settle();
check('the spec lands at once: Perform, lit, no trace kept', go.textContent === 'Perform' && S.trace === null && litNow() && lanesHidden() === 0);
const arcsOff = ctx2d.calls.slice(b0).some((c) => c[0] === 'fillText');
const q2 = ctx2d.calls.length; dom.raf.flush(3);
check('no frame paints (no animation, no playhead)', !arcsOff && ctx2d.calls.length === q2);
{
  const dom2 = makeDom(), l2 = dom2.document.createElement('div'), i2 = dom2.document.createElement('div');
  const t2 = createComposerBridge(Object.assign(dom2.window, { lrcModule: win.lrcModule, toneRowPlayback: win.toneRowPlayback }), { runCompose, storage });
  t2.mountTab({ left: l2, inspector: i2 });
  check('a new page reads the stored setting: off', !t2.controller.view.showWork && !l2.querySelector('.ctab-work').classList.contains('on'));
  const t3 = createComposerBridge(dom2.window, { runCompose, storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } });
  check('a storage that throws: on, and toggling it is not fatal', t3.controller.view.showWork);
}
work.click();
check('on again', tab.view.showWork && store.get('lrc.composer.showWork') === '1');

console.log('\n— a refusal');
setRhythm([7, 1, 1, 1]);
win.dispatchEvent(new win.Event('rhythmGenerated'));
go.click(); await settle();
check('a refused row with the work shown: no animation, the refusal said as before', anim.status === 'idle' && /Too few tones/.test(q('ctab-refusal').textContent) && !bridge.overlay.scene && caption.style.display === 'none');

restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
