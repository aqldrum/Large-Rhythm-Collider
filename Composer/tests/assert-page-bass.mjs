// assert-page-bass.mjs — the bass and the chords' voicing in the Composer window (Composer/BASS_VOICING_ORDER.md phase H):
// the controller and the store under it, the bass and chords cell inspectors, the trace's caption, in Node over
// dom-stub.mjs with the site's own composite rhythm and a recording mock AudioContext:
//   • the bass cell: Density (Roots | Sparse | Moving | Walking, Sparse on), Lands on (Free | Kick | Clave, Free on), the
//     bar's runner-ups (the default offer's: arrangeBass at Sparse · Free), Compose's own bass playing untouched (no
//     arrangement runs at the default; its offer's first line is Compose's bar byte for byte)
//   • Density and Lands on through their controls: live, no re-compose; the bass exactly arrangeBass over the spec as it
//     plays (the drums as they play for Kick); one undo step each; Details' stats
//   • the runner-ups: a click auditions one (Revert with no redo step), a second click keeps it as one undo step, the
//     first again removes the pick; a change of density or lock drops the picks and one undo restores both
//   • Kick on the kick's onsets; the drums turned off under Kick: the bass re-arranged Free and said; Kick disabled with
//     its reason while the drums are off (and setBass refuses it); Clave on the comp's strokes, following Sync | Fill
//   • Roots: no runner-ups, said plainly; pickBass refuses
//   • a chord swap carries the arrangement (arrangeBass over the edited spec)
//   • the chords cell: Close | Led with the voicing's stats; Close live, the spec byte for byte a Compose given
//     `voicing: 'close'`; Led back byte for byte Compose's; a swap under Close is the swap of the close Compose; a
//     re-compose sends the override
//   • a re-compose keeps the density, the lock and the picks its bars still offer; one they don't is dropped and listed
//     with "Compose dropped"; the trace's caption says the voicing and the bass's density and lock
//   • the store: the snapshot, a new cycle of the same row, JSON export; a big row's bass (and its offer) in the worker
//   node Composer/tests/assert-page-bass.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose, compSourceOf } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';
import { arrangeBass, bassLockOf, bassLockRefusal, BASS_ALTERNATES } from '../core/bass.js';
import { materialsOf, rearrange, applyRearrange, chordRecordsOf } from '../core/rearrange.js';
import { partContext } from '../core/compose.js';
import { arrangeDrums } from '../core/drums.js';
import { plotOf, highlightsOf } from '../page/plot-highlights.js';
import { buildScene, bassDetail, chordsDetail } from '../page/trace-frames.js';
import { createComposerController } from '../perform/composer-controller.js';
import { newCompositionState, createCompositionStore, composedBass } from '../store/composition-store.js';
import { snapshotOf, restoreSnapshot } from '../store/composition-edits.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const J = (x) => JSON.stringify(x);
/** a part's notes as compared: which onsets, when, in which octave, at what pitch */
const sig = (p) => J(p.notes.map((n) => [n.node, n.time, n.octave, n.hz]));

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
let composes = 0, bassJobs = 0;
const runCompose = async (l, T, o) => { composes++; return compose(l, T, o); };
runCompose.rearrange = (job) => new Promise((resolve) => setTimeout(() => resolve(answer({ id: 1, kind: 'rearrange', ...job }).result), 1));
runCompose.arp = (job) => Promise.resolve(answer({ id: 1, kind: 'arp', ...job }).result);
runCompose.bass = (job) => { bassJobs++; return new Promise((resolve) => setTimeout(() => resolve(answer({ id: 1, kind: 'bass', ...job }).result), 1)); };
const { createComposerBridge } = await import('../page/composer-bridge.js');
const bridge = createComposerBridge(win, { runCompose, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem() {} }, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const pick = async (sel, value) => { const s = q(inspector, sel); s.value = String(value); dom.fire(s, 'change'); await settle(); };
const click = async (sel, root = inspector) => { q(root, sel).click(); await settle(); };
const S = () => tab.state;
const partOfSpec = (id, spec = S().spec) => spec.parts.find((p) => p.id === id);
/** the bass as the controller should play it: arrangeBass over the spec as it plays, the drums as they play */
const expectedBass = (st = S()) => arrangeBass({ ...st.spec, drums: st.drums }, materialsOf(st.composed), { density: st.bass.density, lock: st.bass.lock, picks: st.bass.picks });
const bassMatches = () => { const e = expectedBass(), p = partOfSpec('bass'); return sig(p) === sig(e) && J(p.bass) === J(e.bass); };
const L = [41, 42, 43, 0], T = 8, OV = { bars: 4, slotsPerBar: 8 };
/** a Compose as the window's (the full table: the worker's, here compose itself) with these overrides; no trace */
const composeAs = (over = {}) => { const { trace, ...plain } = compose(L, T, { seed: 1, worker: true, overrides: { ...OV, ...over } }); return plain; };

console.log('Phase H — the bass in the window');
setRhythm(L, T);
core.setKnob('bars', 4); core.setKnob('slotsPerBar', 8);
q(left, '.ctab-go').click(); await settle();
const composed0 = S().composed, bass0 = partOfSpec('bass', composed0);
check(`composed 41:42:43 at 4 bars × 8; the store's bass ${J(S().bass)}, voicing ${S().voicing}`, S().status === 'ready' && J(S().bass) === J(composedBass()) && S().voicing === 'led');
{
  const { bass, ...plain } = arrangeBass(composed0, materialsOf(composed0), {});
  check('the default arranges nothing: the spec\'s bass is Compose\'s own (and arrangeBass at the default is it byte for byte)', S().spec === composed0 && !partOfSpec('bass').bass && J(plain) === J(bass0));
}
tab.selectCell('bass', 0);
const density = () => q(inspector, '.ctab-bass-density'), lockSw = () => q(inspector, '.ctab-bass-lock');
const segs = () => qa(lockSw(), '.ctab-seg'), seg = (id) => q(lockSw(), `.ctab-bass-${id}`);
check('the bass cell: a Density select, Roots | Sparse | Moving | Walking, Sparse chosen', !!density() && qa(density(), 'option').map((o) => o.textContent).join('|') === 'Roots|Sparse|Moving|Walking' && density().value === 'sparse');
check('… and Lands on, Free | Kick | Clave, Free on, none disabled (the drums are on, the comp in chords)', !!lockSw() && segs().map((b) => b.textContent).join('|') === 'Free|Kick|Clave' && seg('free').classList.contains('on') && segs().every((b) => !b.disabled));
{
  const b = core.bassOf(), rec = b.bars[0], rows = qa(inspector, '.ctab-bass-alt');
  const first = rec.alternates[0], own = bass0.notes.filter((n) => n.bar === 0);
  check(`the bar's runner-ups (${rows.length}, at most ${BASS_ALTERNATES}): the offer at Sparse · Free, the first playing and marked C`, !b.playing && rows.length === rec.alternates.length && rows.length <= BASS_ALTERNATES && rows.length > 0
    && rows[0].classList.contains('current') && q(rows[0], '.ctab-alt-mark').textContent === '●C' && q(inspector, '.ctab-bass-sub')?.textContent === 'Bass lines · bar 1');
  check('… the offer\'s first line is Compose\'s bar 1 note for note', J(first.notes.map((n) => [n.slot, n.node, n.octave])) === J(own.map((n) => [n.slot, n.node, n.octave])));
  check('the muted "re-mined with its chord" line is Details\' now, and says the density and lock', [...qa(inspector, '.ctab-muted')].some((e) => e.classList.contains('ctab-detail') && /at this density and lock/.test(e.textContent)));
}

console.log('\n— Density and Lands on, live');
const c0 = composes, undo0 = S().undo.length;
await pick('.ctab-bass-density', 'walking');
check('Density → Walking: no Compose; the store\'s density; the bass exactly arrangeBass over the spec as it plays', composes === c0 && S().bass.density === 'walking' && partOfSpec('bass').bass?.density === 'walking' && bassMatches() && S().composed === composed0);
check('… one undo step; the other parts untouched', S().undo.length === undo0 + 1 && ['lead', 'chords', 'comp', 'inner'].every((id) => sig(partOfSpec(id)) === sig(partOfSpec(id, composed0))));
{
  const st = partOfSpec('bass').bass.stats, el = q(inspector, '.ctab-bass-stats');
  check(`Details: the stats ("${el?.textContent}")`, !!el && el.classList.contains('ctab-detail') && el.textContent.startsWith(`${st.notes} note${st.notes === 1 ? '' : 's'} · ${st.perBar.toFixed(1)} a bar · ${st.rooted} of ${st.bars} rooted · ${st.onDown} on the one`));
  check(`the head's tag says it ("${q(inspector, '.ctab-ctx-head .ctab-tag')?.textContent}")`, q(inspector, '.ctab-ctx-head .ctab-tag')?.textContent === 'walking');
}
await pick('.ctab-bass-density', 'moving');
check('Density → Moving: live, the lead\'s mid band', S().bass.density === 'moving' && bassMatches() && S().undo.length === undo0 + 2);

console.log('\n— the runner-ups');
{
  const bars = core.bassOf().bars, k = bars.findIndex((b) => b.alternates.length > 2), alt = bars[k].alternates;
  tab.selectCell('bass', k);
  const rows = () => qa(inspector, '.ctab-bass-alt');
  check(`bar ${k + 1}: ${alt.length} lines by contour and band ("${q(rows()[1], '.ctab-alt-name').textContent}"); Details their cost a note and notes`, k >= 0 && rows().length === alt.length
    && q(rows()[1], '.ctab-alt-name').textContent === `${alt[1].contour} · ${alt[1].band}` && q(rows()[1], '.ctab-alt-ratio').classList.contains('ctab-detail') && q(rows()[1], '.ctab-alt-ratio').textContent === `${alt[1].perNote.toFixed(3)}/note`);
  const undoA = S().undo.length, redoA = S().redo.length, sigA = sig(partOfSpec('bass')), cA = composes;
  rows()[1].click(); await settle();
  check('a click auditions the second (stopped: applied at once): the pick plays, nothing composed', core.auditioning() && J(S().bass.picks) === J({ [k]: alt[1].id }) && partOfSpec('bass').bass.bars[k].picked === alt[1].id && bassMatches() && composes === cA
    && rows()[1].classList.contains('auditioning'));
  await click('.ctab-revert');
  check('Revert: the first again, the undo and redo stacks as they were (no redo step)', !core.auditioning() && J(S().bass.picks) === '{}' && sig(partOfSpec('bass')) === sigA && S().undo.length === undoA && S().redo.length === redoA);
  rows()[1].click(); await settle(); rows()[1].click(); await settle();
  check('a second click keeps it: one undo step, marked as playing', !core.auditioning() && S().undo.length === undoA + 1 && J(S().bass.picks) === J({ [k]: alt[1].id }) && rows()[1].classList.contains('current') && q(rows()[1], '.ctab-alt-mark').textContent === '●');
  const r = await core.pickBass(k, alt[0].id);
  check('picking the bar\'s best again removes the pick (one undo step)', r.ok && J(S().bass.picks) === '{}' && sig(partOfSpec('bass')) === sigA && S().undo.length === undoA + 2);
  check('pickBass refuses an id the bar doesn\'t offer', (() => { try { core.pickBass(k, 'nope'); return false; } catch (e) { return /offers no line/.test(e.message); } })());
  await core.pickBass(k, alt[2].id);

  console.log('\n— the drop rule');
  const undoB = S().undo.length;
  await click('.ctab-bass-clave');
  const strokes = new Set(compSourceOf(S().spec.clave).map((x) => x.node));
  check('Lands on → Clave: the picks dropped (keyed by the bar at a density and lock); one undo step', S().bass.lock === 'clave' && J(S().bass.picks) === '{}' && S().undo.length === undoB + 1 && bassMatches());
  check(`… every bass note on one of the comp's ${strokes.size} strokes`, partOfSpec('bass').notes.length > 0 && partOfSpec('bass').notes.every((n) => strokes.has(n.node)) && seg('clave').classList.contains('on'));
  await core.setClave({ relation: 'fill' });
  const fill = new Set(compSourceOf(S().spec.clave).map((x) => x.node));
  check('Fill: the bass follows the comp to the partner\'s strokes', S().spec.clave.relation === 'fill' && partOfSpec('bass').notes.every((n) => fill.has(n.node)) && bassMatches());
  await core.undo();
  check('undo the Fill: Sync again, the bass on the clave\'s strokes', S().spec.clave.relation === 'sync' && partOfSpec('bass').notes.every((n) => strokes.has(n.node)) && bassMatches());
  await click('.ctab-undo', left);
  check('undo: Free, and the pick back (one undo step restores both)', S().bass.lock === 'free' && J(S().bass.picks) === J({ [k]: alt[2].id }) && partOfSpec('bass').bass.bars[k].picked === alt[2].id && bassMatches());
  await pick('.ctab-bass-density', 'walking');
  check('a change of density drops them too; undo restores both', J(S().bass.picks) === '{}' && (await core.undo()).ok && S().bass.density === 'moving' && J(S().bass.picks) === J({ [k]: alt[2].id }));
  await core.setBass({ picks: {} });
}

console.log('\n— Kick, and the drums off');
{
  core.setDrums({ mode: 'backbeat' }); await settle();
  await click('.ctab-bass-kick');
  const { row, cells } = materialsOf(S().composed), ctx = partContext(row, cells, { cycleSeconds: T, phase: S().spec.knobs.phase, frameCentsEachSide: S().spec.knobs.frameCentsEachSide });
  const kicks = bassLockOf({ ...S().spec, drums: S().drums }, ctx, 'kick').nodes;
  check(`Lands on → Kick: every bass note on an onset the kick strikes (${kicks.size} such onsets)`, S().bass.lock === 'kick' && partOfSpec('bass').bass.stats.lock === 'kick' && partOfSpec('bass').notes.every((n) => kicks.has(n.node)) && bassMatches());
  core.setDrums({ enabled: false }); await settle();
  const why = bassLockRefusal({ ...S().spec, drums: S().drums }, 'kick');
  check(`the drums off under Kick: the bass re-arranged Free, and said ("${q(inspector, '.ctab-bass-refused')?.textContent}")`, !!why && partOfSpec('bass').bass.stats.lock === 'free' && partOfSpec('bass').bass.refused === why && core.bassOf().refused === why
    && bassMatches() && /can't land now/.test(q(inspector, '.ctab-bass-refused')?.textContent ?? ''));
  await click('.ctab-bass-free');
  check(`Free; Kick disabled with its reason ("${seg('kick').title}"), said under the switch`, S().bass.lock === 'free' && seg('kick').disabled && seg('kick').title === why && seg('kick').classList.contains('refused')
    && q(inspector, '.ctab-bass-refusal')?.textContent === `Kick: ${why}` && !seg('clave').disabled);
  const refused = await core.setBass({ lock: 'kick' });
  check('… and setBass refuses it with those words', !refused.ok && refused.refused && refused.error === why && S().bass.lock === 'free');
  core.setDrums({ enabled: true }); await settle();
  check('the drums on again: Kick free to pick', !seg('kick').disabled && !q(inspector, '.ctab-bass-refusal'));
}

console.log('\n— Roots');
{
  await pick('.ctab-bass-density', 'roots');
  const recs = chordRecordsOf(S().spec, ...Object.values(materialsOf(S().composed)));
  check(`Roots: one note a chord (${partOfSpec('bass').notes.length} for ${recs.length}); no runner-ups, said plainly`, partOfSpec('bass').notes.length === recs.length && bassMatches() && !q(inspector, '.ctab-bass-alt')
    && /Roots plays one note a chord, on the change: no runner-ups/.test(q(inspector, '.ctab-bass-none')?.textContent ?? ''));
  check('pickBass refuses Roots', (() => { try { core.pickBass(0, 'x'); return false; } catch (e) { return /no runner-ups to pick/.test(e.message); } })());
  await pick('.ctab-bass-density', 'moving');
}

console.log('\n— a chord swap carries the arrangement');
{
  const alt = core.alternatesOf(1, 'chords').candidates.find((c) => !c.current);
  await core.swapChord(1, alt); await settle();
  check(`bar 2 swapped to ${S().spec.chords[1].name}: the bass re-arranged at Moving over the new chord`, S().spec.chords[1].rootTone === alt.root.ratio && partOfSpec('bass').bass.density === 'moving' && bassMatches());
  await core.undo(); await settle();
  check('undo the swap: over the composed chords again', J(S().spec.chords) === J(composed0.chords) && bassMatches());
}

console.log('\n— the chords\' Close | Led');
{
  await core.setBass({ density: 'sparse', lock: 'free', picks: {} });
  check('(the bass back to Compose\'s own: nothing arranged, the spec Compose\'s)', S().spec === composed0 || J(S().spec) === J({ ...composed0 }));
  tab.selectCell('chords', 0);
  const vs = () => q(inspector, '.ctab-voicing-switch'), v = composed0.stats.voicing;
  check(`the chords cell: Close | Led under the head, Led on, its stats ("${q(inspector, '.ctab-voicing-stats')?.textContent}")`, !!vs() && qa(vs(), '.ctab-seg').map((b) => b.textContent).join('|') === 'Close|Led'
    && q(vs(), '.ctab-voicing-led').classList.contains('on') && q(inspector, '.ctab-voicing-stats')?.textContent === `${v.lifted} lifted · ${v.meanMotion}¢ a chord`);
  const cV = composes, undoV = S().undo.length;
  await click('.ctab-voicing-close');
  const close = composeAs({ voicing: 'close' });
  check('Close: no Compose, one undo step; the spec byte for byte a Compose given voicing: close (input, parts, stats, decisions)', composes === cV && S().voicing === 'close' && S().undo.length === undoV + 1
    && J({ ...S().spec, drums: close.drums }) === J(close) && J(S().drums.hits) === J(arrangeDrums(S().spec, S().drumOptions).hits));
  check(`… the switch says it ("${q(inspector, '.ctab-voicing-stats')?.textContent}"), the lanes by class`, q(vs(), '.ctab-voicing-close').classList.contains('on') && q(inspector, '.ctab-voicing-stats')?.textContent === 'root position'
    && partOfSpec('chords').notes.every((n) => n.lane == null) && core.voicingOf().playing === 'close');
  await click('.ctab-voicing-led');
  check('Led: Compose\'s own spec again, byte for byte', S().voicing === 'led' && J({ ...S().spec, drums: composed0.drums }) === J(composed0));
  await click('.ctab-undo', left);
  check('undo: Close again', S().voicing === 'close' && J({ ...S().spec, drums: close.drums }) === J(close));
  const alt = core.alternatesOf(2, 'chords').candidates.find((c) => !c.current);
  await core.swapChord(2, alt); await settle();
  const { row, cells } = materialsOf(close), ref = applyRearrange(close, rearrange(close, row, cells, { bar: 2, chord: { rootTone: alt.root.ratio, quality: alt.quality } }));
  check('a swap under Close: the close Compose\'s own swap (the revoice runs first, then the edits)', sig(partOfSpec('chords')) === sig(partOfSpec('chords', ref)) && sig(partOfSpec('comp')) === sig(partOfSpec('comp', ref)) && !S().spec.stats.voicing);
  await core.undo(); await settle();
  core.setSeed(S().input.seed);
  const cR = composes;
  q(left, '.ctab-go').click(); await settle();
  check('Compose again under Close: the override sent, nothing to switch after it', composes === cR + 1 && S().composed.input.overrides.voicing === 'close' && !S().composed.stats.voicing && S().spec === S().composed && S().voicing === 'close');
  await core.setVoicing('led');
  check('Led again (live)', J({ ...S().spec, drums: composed0.drums, input: composed0.input }) === J({ ...composed0 }) && S().spec.stats.voicing != null);
}

console.log('\n— a re-compose, and the caption');
{
  await core.setBass({ density: 'moving' });
  const bars = core.bassOf().bars, k = bars.findIndex((b) => b.alternates.length > 1), gone = bars.findIndex((b, i) => i !== k && b.alternates.length > 0), keepId = bars[k].alternates[1].id;
  await core.setBass({ picks: { [k]: keepId, [gone]: 'no-such-line' } });
  tab.selectCell('bass', gone);
  check(`a pick its bar doesn't offer plays the bar's best, marked in bar ${gone + 1}'s list`, partOfSpec('bass').bass.bars[gone].missed === 'no-such-line' && !!q(inspector, '.ctab-bass-missed') && bassMatches());
  core.setSeed(S().input.seed);
  const c1 = composes;
  q(left, '.ctab-go').click(); await settle();
  check('Compose again (same seed): the density kept, the spec plays it', composes === c1 + 1 && S().bass.density === 'moving' && partOfSpec('bass').bass?.density === 'moving' && bassMatches());
  check(`… the pick its bar still offers kept; the other dropped and said (${J(S().dropped?.bass)})`, S().bass.picks[k] === keepId && partOfSpec('bass').bass.bars[k].picked === keepId && S().bass.picks[gone] === undefined
    && J(S().dropped?.bass) === J([{ bar: gone, id: 'no-such-line' }]) && partOfSpec('bass').bass.bars.every((b) => b.missed == null)
    && /bass pick \(bar \d+\) was dropped/.test(q(left, '.ctab-dropped').textContent) && q(left, '.ctab-dropped').style.display !== 'none');
  await core.setBass({ lock: 'clave' });
  await core.setVoicing('close');
  const plot = plotOf({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid }), final = tab.highlights({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid });
  const scene = buildScene({ trace: S().trace, plot, final }), said = (id) => scene.steps.find((x) => x.event.kind === 'part' && x.event.part === id)?.data.detail;
  check(`the trace's caption says the bass's density and lock ("${said('bass')}")`, said('bass') === bassDetail(final.arrangement.bass) && /^moving, on the comp's strokes/.test(said('bass')));
  check(`… and the voicing ("${said('chords')}")`, said('chords') === chordsDetail(final.arrangement) && /close/.test(said('chords')));
  await core.setVoicing('led');
  const led = buildScene({ trace: S().trace, plot, final: tab.highlights({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid }) });
  const ledSaid = led.steps.find((x) => x.event.kind === 'part' && x.event.part === 'chords')?.data.detail, vs = S().spec.stats.voicing;
  check(`… led, with its lifts and motion ("${ledSaid}")`, ledSaid === `a voice a chord tone, led: ${vs.lifted} lifted clear of the mud limit, ${vs.meanMotion}¢ of motion a chord`);
  const plain = highlightsOf({ spec: composed0 }, plot);
  check(`Compose's own bass in the caption: "${bassDetail(plain.arrangement.bass)}"`, bassDetail(plain.arrangement.bass) === 'sparse, landing anywhere: bar by bar against its chord');
}

console.log('\n— the store');
{
  const st = S(), snap = JSON.parse(JSON.stringify(snapshotOf(st))), fresh = newCompositionState({ layers: L, cycleSeconds: T });
  restoreSnapshot(fresh, snap);
  check(`a snapshot holds the bass and the voicing (${J(snap.bass)}, ${snap.voicing}) and a JSON round trip restores them`, J(fresh.bass) === J(st.bass) && fresh.voicing === st.voicing && J(snap.bass) === J(st.bass));
  const exp = core.editsExport();
  check('JSON export carries the bass (not Compose\'s own)', J(exp?.bass) === J(st.bass) && exp.voicing === undefined);
  await core.setVoicing('close');
  check('… and the voicing when close', core.editsExport().voicing === 'close');
  const store = createCompositionStore();
  const a = store.select({ layers: L, cycleSeconds: 8 });
  a.state.bass = { density: 'walking', lock: 'kick', picks: { 1: 'x' } }; a.state.voicing = 'close';
  const b = store.select({ layers: L, cycleSeconds: 6 });
  check('a new cycle of the same row carries them (the store, as the arps)', b.created && J(b.state.bass) === J(a.state.bass) && b.state.voicing === 'close' && b.state.bass !== a.state.bass);
  const c = store.select({ layers: [8, 7, 6, 5], cycleSeconds: 4 });
  check('new layers start from Compose\'s own', J(c.state.bass) === J(composedBass()) && c.state.voicing === 'led');
  await core.setVoicing('led');
}

console.log('\n— a big row\'s bass in the worker');
{
  const mk = (onWorker) => {
    const st = newCompositionState({ layers: [19, 17, 16, 15], cycleSeconds: 6 });
    return { st, c: createComposerController({ state: st, createContext: () => audio, runCompose, mainThreadOnsets: onWorker ? 10 : 1e9 }) };
  };
  const a = mk(true), b = mk(false);
  await a.c.compose(); await b.c.compose();
  const jobs0 = bassJobs, offer = a.c.bassOf();
  check('the default offer is on its way from the worker (pending), then lands', offer.pending && offer.bars === null && bassJobs === jobs0 + 1);
  await settle();
  check('… the same runner-ups as on this thread', !a.c.bassOf().pending && J(a.c.bassOf().bars) === J(b.c.bassOf().bars));
  const ra = await a.c.setBass({ density: 'walking', lock: 'clave' }), rb = await b.c.setBass({ density: 'walking', lock: 'clave' });
  const same = () => sig(a.st.spec.parts.find((p) => p.id === 'bass')) === sig(b.st.spec.parts.find((p) => p.id === 'bass')) && J(a.st.spec.parts.find((p) => p.id === 'bass').bass) === J(b.st.spec.parts.find((p) => p.id === 'bass').bass);
  check(`past mainThreadOnsets the bass goes to the worker (${bassJobs - jobs0 - 1} job), the same part as on this thread`, ra.ok && rb.ok && bassJobs - jobs0 === 2 && same());
  await a.c.setVoicing('close'); await b.c.setVoicing('close');
  check('… a voicing switch there (the worker\'s rearrange) the same as on this thread', J(a.st.spec.parts.find((p) => p.id === 'chords')) === J(b.st.spec.parts.find((p) => p.id === 'chords')) && same() && bassJobs - jobs0 === 3);
  a.c.setSeed(2); b.c.setSeed(2);
  await a.c.compose(); await b.c.compose();
  check('… and a re-compose there re-arranges it in the worker before it lands', bassJobs - jobs0 === 4 && a.st.status === 'ready' && same() && !!a.st.spec.parts.find((p) => p.id === 'bass').bass);
}

bridge.hideTab();
restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
