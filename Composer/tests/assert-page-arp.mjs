// assert-page-arp.mjs — the Arp mode in the Composer window (Composer/COMP_ARP_ORDER.md B2–B4): the controller and the
// store under it, the cell inspectors' switch and knobs, the matrix and the part strips, in Node over dom-stub.mjs with
// the site's own composite rhythm and a recording mock AudioContext:
//   • the lead's and the inner's cell inspectors: a Line | Arp switch, Line by default, no knobs in Line
//   • Arp on the inner: live, no re-compose; the inner exactly arrangeArp over the spec in Line; the harp (Q4); the
//     matrix's lane and the part strip say "· arp"; Time shown (phase D, M5: it replaced Pattern, Rate, Range),
//     Details' rests, chord-tone share and phrases mined
//   • Time through its select, live; a phrase's pick through setArp; a change of Time drops the picks (phase E, ruled:
//     they are keyed by the phrase at a time) and one undo restores both; a sound chosen for the inner wins over the harp
//   • the phrase picker (phase E): the phrase holding the cell lists its ranked arps by contour and band, the one playing
//     marked; a click auditions one (stopped: at once; performing: held for the next bar boundary), Revert takes it back
//     with no redo step, a second click (or Keep) keeps it as one undo step; the first again removes the pick; Details
//     carries each arp's cost a note and chord-tone share; a pick its phrase no longer offers is marked; a walked phrase
//     offers nothing
//   • undo and redo step back through the switches and the knobs (the header's buttons)
//   • the lead in Arp: its runner-ups hidden (Q5), the inner re-arranged off the arp's onsets, the drums' *with*
//     re-arranged over the arp lead; Back to Line: the melody exactly as before
//   • a chord swap re-arps: the Line part rearranged first (the inner re-mined), the arp over it
//   • a re-compose (the same seed) keeps the modes, and the picks its phrases still offer; one they don't is dropped and
//     listed with "Compose dropped"; the glyph's recall plays them with no Compose; the part strips
//   • a MIDI target: the lead's switch disabled, its title arpRefusal's words; the inner's still free
//   • a big row's arps in the worker (runCompose.arp): the same parts as on this thread
//   node Composer/tests/assert-page-arp.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';
import { arrangeArp, arpRefusal, arpGeometry, lineOf } from '../core/arp.js';
import { materialsOf, rearrange, applyRearrange } from '../core/rearrange.js';
import { arrangeDrums } from '../core/drums.js';
import { midiNotesOf } from '../perform/composer-midi.js';
import { createComposerController, INNER_ARP_SOUND } from '../perform/composer-controller.js';
import { newCompositionState } from '../store/composition-store.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';

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
let composes = 0, arpJobs = 0;
const runCompose = async (l, T, o) => { composes++; return compose(l, T, o); };
runCompose.rearrange = (job) => new Promise((resolve) => setTimeout(() => resolve(answer({ id: 1, kind: 'rearrange', ...job }).result), 1));
runCompose.arp = (job) => { arpJobs++; return Promise.resolve(answer({ id: 1, kind: 'arp', ...job }).result); };
const { createComposerBridge } = await import('../page/composer-bridge.js');
const bridge = createComposerBridge(win, { runCompose, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem() {} }, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const lane = (id) => qa(left, '.ctab-lane').find((l) => l.dataset.part === id);
const laneName = (id) => q(lane(id), '.ctab-lane-name').textContent;
const pick = async (sel, value) => { const s = q(inspector, sel); s.value = String(value); dom.fire(s, 'change'); await settle(); };
const click = async (sel, root = inspector) => { q(root, sel).click(); await settle(); };
const S = () => tab.state;
const partOfSpec = (id) => S().spec.parts.find((p) => p.id === id);
/** the arps as the controller should play them: arrangeArp over the spec in Line, the lead first */
function expected(st = S()) {
  const m = materialsOf(st.composed);
  let spec = { ...st.spec, parts: st.spec.parts.map(lineOf) };
  const out = {};
  for (const id of ['lead', 'inner']) {
    const a = st.arps[id];
    if (a.mode !== 'arp' || arpRefusal(spec, id)) continue;
    const p = arrangeArp(spec, m, id, { time: a.time, picks: a.picks, legato: st.parts[id].legato });
    out[id] = p; spec = { ...spec, parts: spec.parts.map((x) => (x.id === id ? p : x)) };
  }
  return out;
}
const arpsMatch = () => { const e = expected(); return ['lead', 'inner'].every((id) => (e[id] ? !!partOfSpec(id).arp && sig(partOfSpec(id)) === sig(e[id]) : !partOfSpec(id).arp)); };

console.log('B2–B4 — the Arp mode in the window');
setRhythm([41, 42, 43, 0], 8);
core.setKnob('bars', 4); core.setKnob('slotsPerBar', 8);
q(left, '.ctab-go').click(); await settle();
const composed0 = S().composed, leadLine0 = sig(partOfSpec('lead')), innerLine0 = sig(partOfSpec('inner')), innerSound0 = S().parts.inner.sound;
check(`composed 41:42:43 at 4 bars × 8; both parts in Line (the store's arps: ${S().arps.lead.mode}, ${S().arps.inner.mode})`, S().status === 'ready' && S().arps.lead.mode === 'line' && S().arps.inner.mode === 'line' && !partOfSpec('lead').arp);

console.log('\n— the switch');
tab.selectCell('inner', 0);
const sw = () => q(inspector, '.ctab-arp-switch');
check('the inner\'s cell inspector: a Line | Arp switch, Line on, no knobs in Line', !!sw() && qa(sw(), '.ctab-seg').map((b) => b.textContent).join('|') === 'Line|Arp' && q(sw(), '.ctab-arp-line').classList.contains('on')
  && !q(inspector, '.ctab-arp-time') && !q(inspector, '.ctab-arp-stats'));
tab.selectCell('lead', 0);
check('the lead\'s too, above its runner-ups', !!sw() && q(sw(), '.ctab-arp-line').classList.contains('on') && qa(inspector, '.ctab-alt').length > 0 && !q(sw(), '.ctab-arp-on').disabled);

console.log('\n— Arp on the inner: live');
tab.selectCell('inner', 0);
const c0 = composes;
await click('.ctab-arp-on');
check('a click on Arp: no Compose; the store\'s mode and the spec\'s inner are the arp (time ×1, no picks)', composes === c0 && S().arps.inner.mode === 'arp' && partOfSpec('inner').arp?.time === 1 && J(partOfSpec('inner').arp.picks) === '{}');
check('… exactly arrangeArp over the spec in Line; Compose\'s own spec untouched', arpsMatch() && S().composed === composed0 && sig(composed0.parts.find((p) => p.id === 'inner')) === innerLine0 && sig(lineOf(partOfSpec('inner'))) === innerLine0);
check(`… the harp (Q4: it played ${innerSound0}); the drums re-arranged over it`, S().parts.inner.sound === INNER_ARP_SOUND && J(S().drums.hits) === J(arrangeDrums(S().spec, S().drumOptions).hits));
check(`the matrix's lane says so ("${laneName('inner')}"), and the inspector shows Time (no Pattern, Rate, Range)`, laneName('inner') === 'Inner · arp' && laneName('lead') === 'Lead' && q(sw(), '.ctab-arp-on').classList.contains('on')
  && q(inspector, '.ctab-arp-time').value === '1' && qa(q(inspector, '.ctab-arp-time'), 'option').map((o) => o.textContent).join('|') === '×1|×2|×3'
  && !q(inspector, '.ctab-arp-pattern') && !q(inspector, '.ctab-arp-rate') && !q(inspector, '.ctab-arp-range'));
const st0 = partOfSpec('inner').arp.stats, statsEl = q(inspector, '.ctab-arp-stats');
check(`Details: the rests, the chord tones' share and the phrases mined ("${statsEl?.textContent}")`, !!statsEl && statsEl.classList.contains('ctab-detail')
  && statsEl.textContent === `${st0.rests} rest${st0.rests === 1 ? '' : 's'} of ${st0.anchors} · ${Math.round(100 * st0.chordShare)}% chord tones · ${st0.mined} of ${st0.phrases} phrase${st0.phrases === 1 ? '' : 's'} mined`);
check('the inner\'s mined-line note (smoothing) is gone while it is an arp; its tag says arp', !q(inspector, '.ctab-smooth') && /arp/.test(q(inspector, '.ctab-ctx-head .ctab-tag')?.textContent ?? ''));
check('MIDI: the arp is one note at a time (its notes never overlap)', midiNotesOf(S().parts.inner, S().spec.knobs.cycleSeconds).every((n, i, a) => i === 0 || a[i - 1].end <= n.time + 1e-9));

console.log('\n— the phrase picker (phase E)');
{
  const phrases = partOfSpec('inner').arp.phrases, p = phrases.findIndex((x) => x.alternates.length > 2), ph = phrases[p];
  tab.selectCell('inner', ph.from);
  const rows = () => qa(inspector, '.ctab-arp-alt'), names = () => rows().map((b) => q(b, '.ctab-alt-name').textContent);
  check(`the inner's cell: the phrase holding it ("${q(inspector, '.ctab-arp-sub')?.textContent}") lists its ${ph.alternates.length} ranked arps by contour and band, the first playing and marked C`,
    q(inspector, '.ctab-arp-sub')?.textContent === `Arps · phrase ${p + 1}` && rows().length === ph.alternates.length && J(names()) === J(ph.alternates.map((x) => `${x.contour} · ${x.band}`))
    && rows()[0].classList.contains('current') && q(rows()[0], '.ctab-alt-mark').textContent === '●C' && !rows()[1].classList.contains('current'));
  const x1 = ph.alternates[1], share = Math.round((100 * x1.chordTones) / x1.n);
  check(`Details: each arp's cost a note and its chord tones ("${q(rows()[1], '.ctab-alt-ratio').textContent} · ${q(rows()[1], '.ctab-alt-cents').textContent}")`, q(rows()[1], '.ctab-alt-ratio').classList.contains('ctab-detail')
    && q(rows()[1], '.ctab-alt-ratio').textContent === `${x1.perNote.toFixed(3)}/note` && q(rows()[1], '.ctab-alt-cents').textContent === `${share}% chord` && rows()[1].title.includes(`${share}% chord tones`));
  const undoA = S().undo.length, redoA = S().redo.length, sigA = sig(partOfSpec('inner')), cA = composes;
  rows()[1].click(); await settle();
  check('a click auditions the second (stopped: applied at once): the pick plays, nothing composed', core.auditioning() && J(S().arps.inner.picks) === J({ [p]: x1.id }) && partOfSpec('inner').arp.phrases[p].picked === x1.id && arpsMatch() && composes === cA
    && rows()[1].classList.contains('auditioning') && /auditioning/.test(q(inspector, '.ctab-audition').textContent));
  await click('.ctab-revert');
  check('Revert: the first again, the undo and redo stacks as they were (no redo step)', !core.auditioning() && J(S().arps.inner.picks) === '{}' && sig(partOfSpec('inner')) === sigA && S().undo.length === undoA && S().redo.length === redoA);
  rows()[1].click(); await settle(); rows()[1].click(); await settle();
  check('a second click keeps it: one undo step, marked as playing', !core.auditioning() && S().undo.length === undoA + 1 && J(S().arps.inner.picks) === J({ [p]: x1.id }) && rows()[1].classList.contains('current') && q(rows()[1], '.ctab-alt-mark').textContent === '●');
  await click('.ctab-undo', left);
  check('undo: the pick gone, the first arp playing', J(S().arps.inner.picks) === '{}' && sig(partOfSpec('inner')) === sigA);
  await click('.ctab-redo', left);
  const viaFirst = await core.pickArp('inner', p, ph.alternates[0].id);
  check('redo: it plays again; picking the first again removes the pick (one undo step)', viaFirst.ok && J(S().arps.inner.picks) === '{}' && S().undo.length === undoA + 2 && sig(partOfSpec('inner')) === sigA);
  check('pickArp refuses an id the phrase doesn\'t offer, and a part not playing as an arp', (() => { try { core.pickArp('inner', p, 'nope'); return false; } catch (e) { return /offers no arp/.test(e.message); } })()
    && (() => { try { core.pickArp('lead', 0, x1.id); return false; } catch (e) { return /isn't playing as an arp/.test(e.message); } })());
  // performing: held for the next bar boundary, as the chords' and the runner-ups' are
  q(left, '.ctab-go').click(); await settle(2);
  const bs = S().spec.timeline.barStarts, k = Math.min(ph.from + 1, bs.length - 1), x2 = ph.alternates[2];
  audio.currentTime = 0.05 + bs[k - 1] + 0.1;
  rows()[2].click(); await settle();
  check(`performing (${S().status}): a click is held for the next bar boundary, nothing applied`, S().status === 'playing' && J(S().arps.inner.picks) === '{}' && /next bar/.test(q(inspector, '.ctab-audition').textContent));
  audio.currentTime = 0.05 + bs[k] - 0.25; dom.raf.flush(1); await settle();
  check('… applied just before the boundary', core.auditioning() && J(S().arps.inner.picks) === J({ [p]: x2.id }) && arpsMatch());
  await click('.ctab-revert');
  check('… Revert: back, no redo step', !core.auditioning() && J(S().arps.inner.picks) === '{}' && !core.canRedo());
  q(left, '.ctab-go').click(); await settle(2);
  audio.currentTime = 0;
  await core.undo(); await core.undo();   // the picker's two kept steps, so the knobs' undo chain below starts where it did
  check('(the picker\'s steps undone: the undo stack as before it)', S().undo.length === undoA && J(S().arps.inner.picks) === '{}');
  tab.selectCell('inner', 0);
}

console.log('\n— the knobs');
const undo0 = S().undo.length;
const pickAt = partOfSpec('inner').arp.phrases.findIndex((x) => x.alternates.length > 1), second = partOfSpec('inner').arp.phrases[pickAt]?.alternates[1];
await core.setArp('inner', { picks: second ? { [pickAt]: second.id } : {} });
check(`a pick through setArp (phrase ${pickAt + 1}'s second arp, ${second?.contour} · ${second?.band}): it plays`, !!second && partOfSpec('inner').arp.phrases[pickAt].picked === second.id && J(S().arps.inner.picks) === J({ [pickAt]: second.id }) && arpsMatch());
await pick('.ctab-arp-time', 2);
check('Time → ×2: live, mined over two anchors a slot; the picks dropped (phase E, ruled: keyed by the phrase at a time)', partOfSpec('inner').arp.time === 2 && S().arps.inner.time === 2 && partOfSpec('inner').arp.stats.anchors === 4 * 8 * 2
  && J(S().arps.inner.picks) === '{}' && partOfSpec('inner').arp.phrases.every((x) => x.missed == null) && arpsMatch() && composes === c0);
await pick('.ctab-arp-time', 3);
check('Time → ×3; each knob one undo step', partOfSpec('inner').arp.time === 3 && partOfSpec('inner').arp.stats.anchors === 4 * 8 * 3 && S().undo.length === undo0 + 3 && arpsMatch());
core.setPart('inner', { legato: !S().parts.inner.legato });
check('legato toggled on the arp: still the arp (its lengths the steps\')', !!S().parts.inner.arp && S().parts.inner.notes.length === partOfSpec('inner').notes.length);
core.setPart('inner', { legato: !S().parts.inner.legato });

console.log('\n— undo and redo');
await click('.ctab-undo', left);
check('undo: the last knob back (×3 → ×2)', partOfSpec('inner').arp.time === 2 && arpsMatch());
await click('.ctab-undo', left);
check('undo: ×1, the pick playing again (one undo step restores both)', partOfSpec('inner').arp.time === 1 && partOfSpec('inner').arp.phrases[pickAt]?.picked === second?.id && arpsMatch());
await click('.ctab-undo', left);
check('undo: the default Arp', J(S().arps.inner) === J({ mode: 'arp', time: 1, picks: {} }) && arpsMatch());
await click('.ctab-undo', left);
check('undo: the inner in Line again — its mined line, its own sound, the lane named plainly', S().arps.inner.mode === 'line' && !partOfSpec('inner').arp && sig(partOfSpec('inner')) === innerLine0 && S().parts.inner.sound === innerSound0 && laneName('inner') === 'Inner');
await click('.ctab-redo', left);
check('redo: Arp again', S().arps.inner.mode === 'arp' && arpsMatch() && S().parts.inner.sound === INNER_ARP_SOUND);
const other = ['marimba', 'kalimba', 'vibes'].find((x) => x !== innerSound0 && x !== INNER_ARP_SOUND);
core.setPart('inner', { sound: other });
await core.setArp('inner', { mode: 'line' }); await core.setArp('inner', { mode: 'arp' });
check(`a sound chosen for the inner (${other}) wins over the harp, in Line and in Arp`, S().parts.inner.sound === other && !!S().parts.inner.arp);

console.log('\n— the lead in Arp');
await core.setDrums({ mode: 'with' });
tab.selectCell('lead', 0);
const runnerUps = () => qa(inspector, '.ctab-alt').filter((b) => !b.classList.contains('ctab-arp-alt')).length;
const lineAlts = runnerUps();
await click('.ctab-arp-on');
const lead = partOfSpec('lead'), leadNodes = new Set(lead.notes.map((n) => n.node));
check(`Lead → Arp: live, the arp over the same chords; its ${lineAlts} runner-ups hidden (Q5)`, composes === c0 && !!lead.arp && arpsMatch() && J(S().spec.chords) === J(composed0.chords)
  && runnerUps() === 0 && core.alternatesOf(0, 'lead') === null && laneName('lead') === 'Lead · arp' && /Line brings the melody back/.test(inspector.textContent));
check('… its picker in their place: the phrase\'s ranked arps', qa(inspector, '.ctab-arp-alt').length === (lead.arp.phrases[0].walked ? 0 : lead.arp.phrases[0].alternates.length) && q(inspector, '.ctab-arp-sub')?.textContent === 'Arps · phrase 1');
check('the inner arp re-arranged off the arp lead\'s onsets (Q4)', partOfSpec('inner').notes.every((n) => !leadNodes.has(n.node)) && arpsMatch());
check('the drums\' with re-arranged over the arp lead', S().drums.mode === 'with' && J(S().drums.hits) === J(arrangeDrums(S().spec, S().drumOptions).hits)
  && J(S().drums.hits) !== J(arrangeDrums({ ...S().spec, parts: S().spec.parts.map(lineOf) }, S().drumOptions).hits));
await click('.ctab-arp-line');
check('Back to Line: the melody exactly as before, its runner-ups back (no picker)', !partOfSpec('lead').arp && sig(partOfSpec('lead')) === leadLine0 && runnerUps() === lineAlts && !q(inspector, '.ctab-arp-alt') && laneName('lead') === 'Lead');
await click('.ctab-arp-on');

console.log('\n— a chord swap re-arps');
const alt = core.alternatesOf(1, 'chords').candidates.find((c) => !c.current);
await core.swapChord(1, alt); await settle();
const { row, cells } = materialsOf(S().composed), ref = applyRearrange(S().composed, rearrange(S().composed, row, cells, { bar: 1, chord: { rootTone: alt.root.ratio, quality: alt.quality } }));
check(`bar 2 swapped to ${S().spec.chords[1].name}: the Line parts rearranged first (the inner re-mined), the arps over them`, S().spec.chords[1].rootTone === alt.root.ratio
  && sig(lineOf(partOfSpec('inner'))) === sig(ref.parts.find((p) => p.id === 'inner')) && sig(lineOf(partOfSpec('lead'))) === sig(ref.parts.find((p) => p.id === 'lead')) && arpsMatch());
const geo = arpGeometry(S().spec, { row, cells }), bar1 = partOfSpec('lead').notes.filter((n) => n.bar === 1);
check(`… the bar's ${bar1.length} arp notes are tones of the new chord`, bar1.length > 0 && bar1.every((n) => geo.chordOfSlot(n.slot).name === S().spec.chords[1].name && geo.ctx.chordClass(geo.chordOfSlot(n.slot), row.tone[n.node]) >= 0));
await core.undo(); await settle();
check('undo the swap: the arps over the composed chords again', J(S().spec.chords) === J(composed0.chords) && arpsMatch() && !!partOfSpec('lead').arp);

console.log('\n— a re-compose and the glyph\'s recall');
// a pick the phrase offers (kept through the same seed's Compose: an arp's id is a hash of its notes), and one it doesn't
const pp = ['inner', 'lead'].find((id) => partOfSpec(id).arp.phrases.some((x) => x.alternates.length > 1)) ?? 'inner', ip = partOfSpec(pp).arp.phrases;
const keepAt = ip.findIndex((x) => x.alternates.length > 1), goneAt = ip.findIndex((x, i) => i !== keepAt && !x.walked), keepId = ip[keepAt]?.alternates[1].id;
await core.setArp(pp, { picks: { [keepAt]: keepId, ...(goneAt >= 0 ? { [goneAt]: 'no-such-arp' } : {}) } });
tab.selectCell(pp, ip[Math.max(0, goneAt)].from);
check(`a pick its phrase doesn't offer plays the best-ranked, marked in the ${pp}'s picker`, keepAt >= 0 && (goneAt < 0 || (partOfSpec(pp).arp.phrases[goneAt].missed === 'no-such-arp' && !!q(inspector, '.ctab-arp-missed'))));
core.setSeed(S().input.seed);   // the same seed: dirty, Compose again
const c1 = composes;
q(left, '.ctab-go').click(); await settle();
check('Compose again (same seed): the modes kept, the spec plays them', composes === c1 + 1 && S().composed !== composed0 && S().arps.lead.mode === 'arp' && S().arps.inner.mode === 'arp' && !!partOfSpec('lead').arp && !!partOfSpec('inner').arp && arpsMatch());
check('… the undo stack cleared by the Compose, the knobs as they were', S().undo.length === 0 && S().arps.inner.time === 1);
check(`… the pick its phrase still offers kept and playing; the other dropped and said (${J(S().dropped?.arps)})`, S().arps[pp].picks[keepAt] === keepId && partOfSpec(pp).arp.phrases[keepAt].picked === keepId
  && (goneAt < 0 || (S().arps[pp].picks[goneAt] === undefined && J(S().dropped?.arps) === J([{ part: pp, phrase: goneAt, id: 'no-such-arp' }]) && partOfSpec(pp).arp.phrases.every((x) => x.missed == null)
    && /arp pick \((Inner|Lead) phrase \d+\) was dropped/.test(q(left, '.ctab-dropped').textContent) && q(left, '.ctab-dropped').style.display !== 'none')));
await core.setArp(pp, { picks: {} });
const before = composes, playing = S().spec;
const phase = await bridge.lens.press(); await settle();
check('the glyph recalls it: no Compose, it plays the arps', phase === 'landed' && composes === before && S().spec === playing && S().status === 'playing' && !!partOfSpec('lead').arp);
const strips = bridge.panels.strips.root, btn = (id) => strips?.querySelectorAll('.part-strip-btn').find((b) => b.dataset.part === id);
check(`the part strips name them ("${btn('lead')?.textContent}", "${btn('inner')?.textContent}")`, bridge.panels.strips.shown && /^Lead · arp/.test(btn('lead').textContent) && /^Inner · arp/.test(btn('inner').textContent) && /^Bass/.test(btn('bass').textContent) && !/arp/.test(btn('bass').textContent));
await bridge.lens.press(); await settle();
core.stop();

console.log('\n— a MIDI target locks the lead\'s Arp');
await tab.setTarget(clipBytes(CLIPS.find((c) => c.name === 'ode-to-joy')), { name: 'ode-to-joy.mid' }); await settle();
const why = arpRefusal(S().spec, 'lead');
check('setting a clip put the lead back in Line; the inner keeps its Arp', !!S().spec.target && S().arps.lead.mode === 'line' && !partOfSpec('lead').arp && S().arps.inner.mode === 'arp' && !!partOfSpec('inner').arp && arpsMatch());
tab.selectCell('lead', 0);
check(`the lead's switch disabled, its title arpRefusal's words ("${why}")`, !!why && q(sw(), '.ctab-arp-on').disabled && q(sw(), '.ctab-arp-line').disabled && q(sw(), '.ctab-arp-on').title === why && sw().title === why && sw().classList.contains('refused'));
const refused = await core.setArp('lead', { mode: 'arp' });
check('… and setArp refuses it with those words', !refused.ok && refused.error === why && S().arps.lead.mode === 'line' && !partOfSpec('lead').arp);
tab.selectCell('inner', 0);
check('the inner\'s switch is free on a target', !q(sw(), '.ctab-arp-on').disabled && q(sw(), '.ctab-arp-on').classList.contains('on'));
await tab.setTarget(null); await settle();

console.log('\n— a walked phrase offers nothing to pick');
{
  setRhythm([8, 7, 6, 5], 4);
  q(left, '.ctab-go').click(); await settle();
  await core.setArp('inner', { mode: 'arp', time: 2 });
  const ph = partOfSpec('inner').arp.phrases, w = ph.findIndex((x) => x.walked);
  if (w >= 0) tab.selectCell('inner', ph[w].from);
  check(`8:7:6:5 at ×2: phrase ${w + 1} walked — the picker says so and lists nothing; pickArp refuses it`, w >= 0 && !!q(inspector, '.ctab-arp-walked') && !q(inspector, '.ctab-arp-alt')
    && (() => { try { core.pickArp('inner', w, 'x'); return false; } catch (e) { return /walked/.test(e.message); } })());
}

console.log('\n— a big row\'s arps in the worker');
{
  const mk = (onWorker) => {
    const st = newCompositionState({ layers: [19, 17, 16, 15], cycleSeconds: 6 });
    return { st, c: createComposerController({ state: st, createContext: () => audio, runCompose, mainThreadOnsets: onWorker ? 10 : 1e9 }) };
  };
  const a = mk(true), b = mk(false);
  await a.c.compose(); await b.c.compose();
  const jobs0 = arpJobs;
  const ra = await a.c.setArp('lead', { mode: 'arp', time: 2 }), rb = await b.c.setArp('lead', { mode: 'arp', time: 2 });
  await a.c.setArp('inner', { mode: 'arp' }); await b.c.setArp('inner', { mode: 'arp' });
  const same = (id) => sig(a.st.spec.parts.find((p) => p.id === id)) === sig(b.st.spec.parts.find((p) => p.id === id));
  check(`past mainThreadOnsets the arps go to the worker (${arpJobs - jobs0} jobs), the same parts as on this thread`, ra.ok && rb.ok && arpJobs - jobs0 === 2 && same('lead') && same('inner') && a.st.parts.inner.sound === INNER_ARP_SOUND);
  a.c.setSeed(2); b.c.setSeed(2);
  await a.c.compose(); await b.c.compose();
  check('… and a re-compose there re-arps in the worker before it lands', arpJobs - jobs0 === 3 && a.st.status === 'ready' && same('lead') && same('inner') && !!a.st.spec.parts.find((p) => p.id === 'lead').arp);
}

bridge.hideTab();
restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
