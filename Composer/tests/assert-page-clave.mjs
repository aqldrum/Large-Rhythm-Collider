// assert-page-clave.mjs — the clave picker in the Composer window (Composer/COMP_ARP_ORDER.md Amendment 1, phase E): the
// controller and the store under it, the comp cell's inspector, the plot and the drums, in Node over dom-stub.mjs with
// the site's own composite rhythm and a recording mock AudioContext:
//   • the comp cell: the clave by its pattern (monospace) and its source, Sync on; Details its score and terms; the
//     claves to choose from (the trace's alternates: the mined top 12, then the curated), Compose's marked
//   • Sync | Fill live, no re-compose (rearrange.js reclave): the comp on the partner's strokes, the perc still on the
//     clave's, the plot lighting both; one undo step; Sync again removes the edit
//   • an alternate auditioned (stopped: at once; performing: held for the next bar boundary), Revert with no redo step,
//     Keep as one undo step; the comp and drums equal to a Compose given that clave; undo and redo
//   • a curated clave (son: two bars a pass), its perc
//   • a chord swap with a chosen clave: the clave stays, the bar re-strummed
//   • a re-compose keeps the choice where the composition still offers it, drops one it doesn't ("Compose dropped")
//   • the glyph's recall plays the chosen clave with no Compose; the Compose animation's caption names the clave
//   • a composition in notes has no clave (claveOf null, setClave refused); a big row's switch in the worker
//   node Composer/tests/assert-page-clave.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';
import { claveText, claveSource } from '../core/claves.js';
import { materialsOf, rearrange, applyRearrange, reclave } from '../core/rearrange.js';
import { arrangeDrums } from '../core/drums.js';
import { plotOf, indexOfTick, highlightsOf } from '../page/plot-highlights.js';
import { buildScene, frameAt } from '../page/trace-frames.js';
import { createComposerController } from '../perform/composer-controller.js';
import { newCompositionState } from '../store/composition-store.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const J = (x) => JSON.stringify(x);

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
const canvas = doc.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
const ctx2d = canvas.getContext('2d');
win.lrcVisuals = {
  currentPlotType: 'linear', composerOverlay: null, draws: 0, compositeRhythm: null, grid: 0, positions: [],
  setComposerOverlay(o) { this.composerOverlay = o; this.drawPlot(); },
  drawPlot() { this.draws++; this.composerOverlay?.draw(ctx2d, { positions: this.positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false }); },
  setPlotType(t) { this.currentPlotType = t; this.drawPlot(); },
};
win.toneRowPlayback = { isPlaying: false, cycleDuration: 8, stops: 0, stopPlayback() { this.isPlaying = false; this.stops++; } };
function setRhythm(layers, T = 8) {
  const r = siteRhythm(layers);
  win.lrcModule = { currentRhythms: layers, currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm, currentLayerMap: r.layerMap };
  win.lrcVisuals.compositeRhythm = r.compositeRhythm; win.lrcVisuals.grid = r.grid;
  win.lrcVisuals.positions = Array.from({ length: r.compositeRhythm.length }, (_, i) => ({ x: 40 + i, y: 100, index: i }));
  win.toneRowPlayback.cycleDuration = T;
  win.dispatchEvent(new win.Event('rhythmGenerated'));
  return r;
}
const layerBox = doc.createElement('div'); layerBox.id = 'layer-controls-content'; doc.body.append(layerBox);

const audio = makeCtx();
let composes = 0, rearranges = 0;
// the clave from the pattern (BASS_VOICING_ORDER.md P19): this suite freezes the window over the clave before phase I, as
// `voicing: 'close'` pinned phase F's; the frame clave's own checks are assert-frame-clave.mjs (the window's, phase L)
const PIN = Object.freeze({ claveFrom: 'pattern' });
const runCompose = async (l, T, o) => { composes++; return compose(l, T, { ...o, overrides: { ...(o?.overrides ?? {}), ...PIN } }); };
runCompose.rearrange = (job) => { rearranges++; return new Promise((resolve) => setTimeout(() => resolve(answer({ id: 1, kind: 'rearrange', ...job }).result), 1)); };
runCompose.arp = (job) => Promise.resolve(answer({ id: 1, kind: 'arp', ...job }).result);
const { createComposerBridge } = await import('../page/composer-bridge.js');
const bridge = createComposerBridge(win, { runCompose, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem() {} }, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const click = async (sel, root = inspector) => { q(root, sel).click(); await settle(); };
const S = () => tab.state;
const partOf = (id, spec = S().spec) => spec.parts.find((p) => p.id === id);
const rows = () => qa(inspector, '.ctab-clave-alt');
const rowOf = (id) => rows().find((b) => b.dataset.key === `clave:${id}`);
/** the composition as the controller should play it: composed + its chord edits, then reclave with the entry's choice */
function expected(st = S()) {
  const m = materialsOf(st.composed), e = st.edits.clave;
  let spec = st.composed;
  for (const [bar, c] of Object.entries(st.edits.chords)) spec = applyRearrange(spec, rearrange(spec, m.row, m.cells, { bar: Number(bar), chord: { rootTone: c.rootTone, quality: c.quality } }));
  if (e) spec = applyRearrange(spec, reclave(spec, m.row, m.cells, { ...(e.id != null ? { clave: e.id } : {}), relation: e.relation ?? st.composed.clave.relation }));
  return spec;
}
const plays = () => { const want = expected(); return J(partOf('comp')) === J(partOf('comp', want)) && J(S().spec.clave) === J(want.clave) && J(S().drums.hits) === J(arrangeDrums(want, S().drumOptions).hits); };
/** the perc's clave strokes (drums.js: snap 'clave') by tick */
const percTicks = () => S().drums.hits.filter((h) => h.voice === 'perc' && h.snap === 'clave').map((h) => h.tick);
const plotted = () => ({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid });

console.log('Phase E — the clave picker in the window');
const L = [119, 42, 15, 8], T = 8;
const R = setRhythm(L, T);
q(left, '.ctab-go').click(); await settle();
const composed0 = S().composed, clave0 = composed0.clave, ev = S().trace.events.find((e) => e.kind === 'part' && e.part === 'comp');
check(`composed ${L.join(':')}: the clave ${clave0.id} (${claveSource(clave0)}), Sync; the trace offers ${ev.alternates.length} claves`, S().status === 'ready' && clave0.relation === 'sync' && ev.alternates.length === 15 && S().edits.clave === null);

console.log('\n— the comp cell');
tab.selectCell('comp', 0);
check(`the clave by its pattern ("${q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern')?.textContent}", a <code>) and its source ("${q(inspector, '.ctab-clave-source')?.textContent}")`,
  q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern')?.tagName === 'CODE' && q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern').textContent === claveText(clave0) && q(inspector, '.ctab-clave-source').textContent === claveSource(clave0) && /from layer [A-D] · \d+ steps/.test(claveSource(clave0)));
check('Sync | Fill, Sync on', !!q(inspector, '.ctab-clave-switch') && q(inspector, '.ctab-clave-sync').classList.contains('on') && !q(inspector, '.ctab-clave-fill').classList.contains('on'));
const det = q(inspector, '.ctab-clave-detail');
check(`Details: its score and terms, its tone set, Fill's partner ("${det?.textContent}")`, !!det && det.classList.contains('ctab-detail') && det.textContent.startsWith(`score ${clave0.score.toFixed(3)}`) && det.textContent.includes(clave0.partner.pattern) && /under /.test(det.textContent));
const curatedRows = rows().filter((b) => b.classList.contains('curated'));
check(`the ${rows().length} claves: the trace's alternates in order, each by pattern and source; Compose's marked ●C; the 3 curated last`, rows().length === ev.alternates.length
  && rows().every((b, i) => b.dataset.key === `clave:${ev.alternates[i].id}` && q(b, '.ctab-clave-pattern').textContent === claveText(ev.alternates[i]) && q(b, '.ctab-alt-q').textContent === claveSource(ev.alternates[i]))
  && q(rowOf(clave0.id), '.ctab-alt-mark').textContent === '●C' && rowOf(clave0.id).classList.contains('current') && J(curatedRows.map((b) => b.dataset.key)) === J(['clave:son', 'clave:rumba', 'clave:bossa'])
  && q(rowOf('son'), '.ctab-clave-pattern').textContent === 'x..x..x. ..x.x...' && q(rows()[0], '.ctab-alt-support').classList.contains('ctab-detail'));
check('the comp line counts the clave\'s strokes', /stroke/.test(q(inspector, '.ctab-comp-line').textContent) && /of the clave/.test(q(inspector, '.ctab-comp-line').title));

console.log('\n— Sync | Fill, live');
const c0 = composes, undo0 = S().undo.length;
await click('.ctab-clave-fill');
const fillStrokes = S().spec.clave.partner.strokes.filter((x) => !x.shared).map((x) => x.node).sort((a, b) => a - b);
check('Fill: no Compose; the store\'s edit { relation: fill }; the comp exactly reclave\'s; one undo step', composes === c0 && J(S().edits.clave) === J({ relation: 'fill' }) && S().spec.clave.relation === 'fill' && plays() && S().undo.length === undo0 + 1
  && q(inspector, '.ctab-clave-fill').classList.contains('on'));
check('… the comp strikes the partner\'s strokes (the clave\'s gaps); the perc stays on the clave\'s', J([...new Set(partOf('comp').strokes.map((x) => x.node))].sort((a, b) => a - b).filter((n) => fillStrokes.includes(n))) === J(fillStrokes)
  && J(percTicks()) === J(S().spec.clave.strokes.map((x) => x.tick)) && percTicks().every((t) => !partOf('comp').strokes.some((x) => x.tick === t)));
{
  const hl = tab.highlights(plotted()), plot = plotOf(plotted()), own = partOf('comp').notes.filter((n) => !n.borrowed).map((n) => indexOfTick(plot.ticks, n.tick));
  check('… the plot lights them: the comp lane on the Fill comp\'s own tones, the drums lane on the clave\'s perc', !!hl && own.length > 0 && J([...new Set(own)].sort((a, b) => a - b)) === J(hl.parts.comp.indices)
    && percTicks().every((t) => hl.parts.drums.indices.includes(indexOfTick(plot.ticks, t))));
}
await click('.ctab-undo', left);
check('undo: Sync, no edit, Compose\'s comp and drums byte for byte', S().edits.clave === null && S().spec.clave.relation === 'sync' && J(partOf('comp')) === J(partOf('comp', composed0)) && J(S().drums.hits) === J(arrangeDrums(composed0, S().drumOptions).hits));
await click('.ctab-redo', left);
check('redo: Fill again', S().spec.clave.relation === 'fill' && plays());
await click('.ctab-clave-sync');
check('Sync again removes the edit (one more undo step)', S().edits.clave === null && S().spec.clave.relation === 'sync' && S().undo.length === undo0 + 2);

console.log('\n— an alternate: audition, Revert, Keep');
const alt = ev.alternates.find((a) => a.id !== clave0.id && !a.from.pattern && a.pattern !== clave0.pattern);
const undoA = S().undo.length, redoA = S().redo.length;
rowOf(alt.id).click(); await settle();
check(`a click on ${alt.id} (${claveSource(alt)}) auditions it at once (stopped): the comp and drums on it, no Compose`, core.auditioning() && S().spec.clave.id === alt.id && J(S().edits.clave) === J({ id: alt.id }) && plays() && composes === c0
  && rowOf(alt.id).classList.contains('auditioning') && /auditioning/.test(q(inspector, '.ctab-audition').textContent));
{
  const want = compose(L, T, { seed: S().input.seed, overrides: { clave: alt.id, ...PIN }, worker: S().table === 'full' });
  check('… equal, comp and drums byte for byte, to a Compose given that clave', J(partOf('comp')) === J(partOf('comp', want)) && J(S().drums.hits) === J(arrangeDrums(want, S().drumOptions).hits) && J(S().spec.clave) === J(want.clave));
}
check(`… the perc follows it (${percTicks().length} clave strokes)`, J(percTicks()) === J(S().spec.clave.strokes.map((x) => x.tick)) && J(percTicks()) !== J(clave0.strokes.map((x) => x.tick)));
await click('.ctab-revert');
check('Revert: Compose\'s clave again, the undo and redo stacks as they were (no redo step)', !core.auditioning() && S().spec.clave.id === clave0.id && S().edits.clave === null && S().undo.length === undoA && S().redo.length === redoA);
rowOf(alt.id).click(); await settle();
await click('.ctab-keep');
check('Keep: one undo step; the row marked as playing, the clave line tagged "chosen"', !core.auditioning() && S().undo.length === undoA + 1 && S().spec.clave.id === alt.id && rowOf(alt.id).classList.contains('current')
  && q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern').textContent === claveText(alt) && /chosen/.test(q(q(inspector, '.ctab-clave'), '.ctab-tag')?.textContent ?? ''));
await click('.ctab-clave-fill');
check('Fill over the chosen clave: both kept in the edit', J(S().edits.clave) === J({ id: alt.id, relation: 'fill' }) && plays());
await click('.ctab-undo', left); await click('.ctab-undo', left);
check('two undos: Compose\'s clave, Sync', S().edits.clave === null && S().spec.clave.id === clave0.id && S().spec.clave.relation === 'sync');
// performing: held for the next bar boundary
q(left, '.ctab-go').click(); await settle(2);
const bs = S().spec.timeline.barStarts, redoP = S().redo.length;
audio.currentTime = 0.05 + 0.2;
rowOf(alt.id).click(); await settle();
check(`performing (${S().status}): a click is held for the next bar boundary, nothing applied`, S().status === 'playing' && S().spec.clave.id === clave0.id && /next bar/.test(q(inspector, '.ctab-audition').textContent));
audio.currentTime = 0.05 + bs[1] - 0.25; dom.raf.flush(1); await settle();
check('… applied just before the boundary', core.auditioning() && S().spec.clave.id === alt.id && plays());
await click('.ctab-revert');
check('… Revert: back, the redo stack as it was (no redo step of its own)', !core.auditioning() && S().spec.clave.id === clave0.id && S().redo.length === redoP);
q(left, '.ctab-go').click(); await settle(2);
audio.currentTime = 0;

console.log('\n— a curated clave');
rowOf('son').click(); await settle(); rowOf('son').click(); await settle();
check(`son, kept (a second click): two bars a pass ("${q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern').textContent}", "${q(inspector, '.ctab-clave-source').textContent}"), the perc on its strokes`, !core.auditioning() && S().spec.clave.id === 'son' && S().spec.clave.span === 2
  && q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern').textContent === 'x..x..x. ..x.x...' && q(inspector, '.ctab-clave-source').textContent === 'son clave 3-2' && plays() && J(percTicks()) === J(S().spec.clave.strokes.map((x) => x.tick)));
await click('.ctab-clave-fill');

console.log('\n— a chord swap with a chosen clave');
{
  const c = core.alternatesOf(1, 'chords').candidates.find((x) => !x.current);
  await core.swapChord(1, c); await settle();
  check(`bar 2 swapped to ${S().spec.chords[1].name}: the clave stays (son, Fill), the comp re-strummed over the new chord — chord edits first, the clave last`, S().spec.chords[1].rootTone === c.root.ratio && S().spec.clave.id === 'son' && S().spec.clave.relation === 'fill' && plays());
  await core.undo(); await settle();
  check('undo the swap: son and Fill over the composed chords', J(S().spec.chords) === J(composed0.chords) && S().spec.clave.id === 'son' && plays());
}

console.log('\n— a re-compose');
core.setSeed(S().input.seed);
const c1 = composes;
q(left, '.ctab-go').click(); await settle();
check('Compose again (same seed): the choice kept (son is still offered), and Fill; nothing dropped', composes === c1 + 1 && S().composed !== composed0 && J(S().edits.clave) === J({ id: 'son', relation: 'fill' }) && S().spec.clave.id === 'son' && S().spec.clave.relation === 'fill' && plays() && S().dropped === null && S().undo.length === 0);
tab.selectCell('comp', 0);
check('… the cell shows son, Fill on, its row marked', q(q(inspector, '.ctab-clave'), '.ctab-clave-pattern').textContent === 'x..x..x. ..x.x...' && q(inspector, '.ctab-clave-fill').classList.contains('on') && rowOf('son').classList.contains('current'));

console.log('\n— the glyph\'s recall');
{
  const before = composes, playing = S().spec;
  const phase = await bridge.lens.press(); await settle();
  check('the glyph recalls it: no Compose, it plays son in Fill', phase === 'landed' && composes === before && S().spec === playing && S().status === 'playing' && S().spec.clave.id === 'son' && S().spec.clave.relation === 'fill');
  await bridge.lens.press(); await settle();
  core.stop();
}

console.log('\n— a clave the composition no longer offers is dropped');
{
  const r = await core.setClave({ id: '5:x.x.x' });
  check('a clave set through the controller ("5:x.x.x", in no table): it plays, said "asked", in no row of the list', r.ok && S().spec.clave.id === '5:x.x.x' && core.claveOf().asked && core.claveOf().source === 'asked' && !rows().some((b) => b.classList.contains('current')));
  core.setSeed(S().input.seed);
  q(left, '.ctab-go').click(); await settle();
  check(`Compose again: it isn't among the claves offered, so dropped and said (${J(S().dropped?.clave)}); Fill kept; Compose's clave plays`, J(S().dropped?.clave) === J({ id: '5:x.x.x', pattern: 'x.x.x' }) && J(S().edits.clave) === J({ relation: 'fill' })
    && S().spec.clave.id === S().composed.clave.id && S().spec.clave.relation === 'fill' && plays() && /chosen clave x\.x\.x was dropped/.test(q(left, '.ctab-dropped').textContent) && q(left, '.ctab-dropped').style.display !== 'none');
  await core.setClave({ relation: 'sync' });
  check('Sync: no edit left', S().edits.clave === null && S().spec.clave.relation === 'sync');
}

console.log('\n— the Compose animation names the clave');
{
  const full = compose(L, T, { seed: 1, trace: true, overrides: { compRelation: 'fill', ...PIN } }), { trace, ...plain } = full, plot = plotOf(R);
  const scene = buildScene({ trace, plot, final: highlightsOf({ spec: plain }, plot) }), said = new Set();
  for (let t = 0; t <= scene.end + 0.2; t += 1 / 60) { const d = frameAt(scene, t).detail; if (d) said.add(d); }
  const line = [...said].find((d) => d.startsWith('Comping') && d.includes('the clave '));
  check(`the comp's caption: "${line}"`, !!line && line.includes(claveText(plain.clave)) && line.includes(claveSource(plain.clave)) && line.includes(`in its gaps (${plain.clave.partner.pattern})`) && ![...said].some((d) => /the best of \d+ layers/.test(d)));
}

console.log('\n— no clave in notes; a big row\'s switch in the worker');
{
  const notesRun = async (l, t, o) => compose(l, t, { ...o, overrides: { ...o.overrides, compStyle: 'notes' } });
  const st = newCompositionState({ layers: [8, 7, 6, 5], cycleSeconds: 4 }), c = createComposerController({ state: st, createContext: () => audio, runCompose: notesRun });
  await c.compose();
  check('a composition in notes: claveOf() null, setClave refused', st.status === 'ready' && !st.spec.clave && c.claveOf() === null && (() => { try { c.setClave({ relation: 'fill' }); return false; } catch (e) { return /comps in notes/.test(e.message); } })());
  const mk = (onWorker) => { const s = newCompositionState({ layers: [19, 17, 16, 15], cycleSeconds: 6 }); return { s, c: createComposerController({ state: s, createContext: () => audio, runCompose, mainThreadOnsets: onWorker ? 10 : 1e9 }) }; };
  const a = mk(true), b = mk(false);
  await a.c.compose(); await b.c.compose();
  const r0 = rearranges, ra = await a.c.setClave({ id: 'bossa', relation: 'fill' }), rb = await b.c.setClave({ id: 'bossa', relation: 'fill' });
  check(`past mainThreadOnsets the switch goes to the worker (${rearranges - r0} job), the same comp, clave and drums as on this thread`, ra.ok && rb.ok && rearranges - r0 === 1
    && J(a.s.spec.parts.find((p) => p.id === 'comp')) === J(b.s.spec.parts.find((p) => p.id === 'comp')) && J(a.s.spec.clave) === J(b.s.spec.clave) && J(a.s.drums) === J(b.s.drums) && a.s.spec.clave.id === 'bossa');
}

bridge.hideTab();
restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
