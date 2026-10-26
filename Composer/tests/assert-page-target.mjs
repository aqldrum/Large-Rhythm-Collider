// assert-page-target.mjs — MIDI targets, phase B (Composer/TARGET_ORDER.md B1–B5): the Composer window's MIDI clip
// control, the controller and the store under it, the matrix's clip marks, the window playhead and the glyph's recall,
// in Node over dom-stub.mjs with the site's own composite rhythm and a recording mock AudioContext:
//   • the control: no rhythm says so; a .mid chosen (the file input) and one dropped on the window are read, decoded,
//     placed and composed (the same spec as compose() with the clip), the clip kept as decoded (no bytes in the store)
//   • the decode line (name, grid, bars, notes, the tonic estimate, "n notes dropped" for chords, P1) and the fit line
//     (hits, tight, note-offs, the window, substitutes, silent notes, the classes the row can't play, decided 5)
//   • the playback tempo seeded from the clip's own (decided 1/4), Reset back to it
//   • the 12-way tonic override (P5): placed again, the root following it
//   • the matrix: the lead row is the clip, its notes marked by kind (amber substitutes, red silent, late offs); no
//     lead alternates or swaps (P6); the lit lead nodes are the clip's; the lead's context lists the clip's notes
//   • the placements: audition (played again from the top), a second audition, Esc reverts exactly, a second click
//     keeps; a re-compose keeps the kept placement without searching again
//   • a window composition's playhead walks the window on the full-cycle plot (phase + loop share × window share)
//   • the typed progression and a chord swap on a window spec, undo keeping the target; the knobs the clip sets
//   • Clear: an ordinary Compose again; errors in plain words (not a MIDI file, a grid too fine, too few tones)
//   • the glyph's recall brings the target composition back (no re-solve), and the store carries it
//   • a big row's target through the worker path (a mocked worker running compose-worker.js' own answer), and the lean
//     table past MAIN_THREAD_ONSETS sent there too (P7)
//   node Composer/tests/assert-page-target.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose } from '../core/compose.js';
import { answer } from '../core/compose-worker.js';
import { readMidi, writeMidi, decodeClip } from '../core/midi.js';
import { buildRow } from '../core/row.js';
import { createComposeRunner } from '../perform/compose-runner.js';
import { createComposerController } from '../perform/composer-controller.js';
import { newCompositionState } from '../store/composition-store.js';
import { createTabController } from '../page/tab-controller.js';
import { plotOf, indexOfTick, playheadAt, playheadX, loopShare } from '../page/plot-highlights.js';
import { fitLine, decodeLine, clipMarks, targetError } from '../page/target-lines.js';
import { CLIPS, clipBytes, seq } from './fixtures/midi-clips.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
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
let composes = 0;
const runCompose = async (l, T, o) => { composes++; return compose(l, T, o); };
runCompose.rearrange = (job) => new Promise((resolve) => setTimeout(() => resolve(answer({ id: 1, kind: 'rearrange', ...job }).result), 1));
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
const keydown = (key, extra = {}) => doc.dispatchEvent({ type: 'keydown', key, ...extra });
const decoded = Object.fromEntries(CLIPS.map((c) => [c.name, decodeClip(readMidi(clipBytes(c)))]));
const bytesOf = (name) => clipBytes(CLIPS.find((c) => c.name === name));
/** a File as the page hands one over (a name and its bytes) */
const fileOf = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
const chooseFile = async (file) => { const input = q(left, '.ctab-clip-file'); input.files = [file]; dom.fire(input, 'change'); await settle(); };
const text = (sel) => q(left, sel)?.textContent ?? '';

console.log('MIDI targets, phase B — the Composer window');

// ── 1. the control ──
console.log('\n— the MIDI clip control');
win.lrcModule = null; tab.syncRhythm(); bridge.view?.render?.();
const noRhythm = await tab.setTarget(bytesOf('ode-to-joy'), { name: 'ode-to-joy.mid' });
check('no rhythm on the page: the clip is refused and the window says so; Choose is disabled', !noRhythm.ok && /Generate a rhythm/.test(text('.ctab-clip-error')) && q(left, '.ctab-clip-choose').disabled);
const R = setRhythm([41, 42, 43, 0], 8);
check('a rhythm: the control is there — Choose a .mid…, a file input for .mid, the drop hint; no lines yet', !q(left, '.ctab-clip-choose').disabled && /\.mid/.test(q(left, '.ctab-clip-file').accept)
  && /drop one on the window/.test(text('.ctab-clip-hint')) && q(left, '.ctab-clip-decode').style.display === 'none' && q(left, '.ctab-clip-error').style.display === 'none');

const c0 = composes;
await chooseFile(fileOf('ode-to-joy.mid', bytesOf('ode-to-joy')));
const st = tab.state, spec = st.spec, ode = decoded['ode-to-joy'];
const direct = compose([41, 42, 43, 0], 8, { seed: st.input.seed, target: { clip: ode }, worker: true });
check('a .mid chosen: decoded, placed and composed (one Compose)', composes === c0 + 1 && st.status === 'ready' && !!spec?.target && spec.knobs.leader === 'target');
check('… the same composition as compose() with the clip (the parts, the chords, the placement)', J(spec.parts) === J(direct.parts) && J(spec.chords) === J(direct.chords) && J(spec.target.placement) === J(direct.target.placement));
check('the entry holds the clip as decoded, no bytes (state.input.target: clip, tonic)', J(st.input.target.clip) === J(ode) && st.input.target.tonic === null && !Object.values(st.input.target).some((v) => v instanceof Uint8Array || v instanceof ArrayBuffer)
  && bridge.store.entry().state.input.target === st.input.target);
const p = spec.target.placement;
check(`41:42:43 places the Ode in a window (N ${p.N}, B ${p.B}: ${(p.share * 100).toFixed(0)} % of the cycle), with misses of every kind`, p.N > p.B && p.misses.fringe > 0 && p.misses.shift > 0 && p.misses.hard > 0 && p.missing.length > 0);

console.log('\n— the lines');
const dec = text('.ctab-clip-decode'), fit = text('.ctab-clip-fit');
check(`the decode line: name, grid, bars, notes, the tonic estimate (${dec})`, dec.includes('ode-to-joy') && dec.includes('4/4 on eighths (8 a bar)') && dec.includes('4 bars') && dec.includes('15 notes')
  && dec.includes(`tonic F# ${ode.key.mode} (estimated`) && !/dropped/.test(dec));
check(`the fit line: hits, tight, note-offs, the window, substitutes, silent, the classes the row can't play (${fit})`, fit.includes(`${p.hits}/${p.J} notes hit`) && fit.includes(`${p.tight} tight`)
  && fit.includes(`${p.offHits}/${p.J - p.misses.hard} note-offs on onsets`) && fit.includes(`window: ${p.B} of ${p.N} bars`) && fit.includes(`${p.misses.fringe + p.misses.shift} substituted`)
  && fit.includes(`${p.misses.hard} silent`) && fit.includes("the row can't play A"));
check('… toned: the misses amber, silent and the missing classes red', qa(left, '.ctab-clip-fit .ctab-clip-item.red').length === 2 && qa(left, '.ctab-clip-fit .ctab-clip-item.amber').length >= 2);
check('the readouts name the clip', /clip ode-to-joy · 8\/15 hit · 108\.0 BPM/.test(text('.ctab-readouts')));

console.log('\n— the tempo (decided 1/4)');
check(`playback is seeded from the clip's tempo (${core.tempo().toFixed(1)} BPM), not the spec's (${core.specTempo().toFixed(1)})`, Math.abs(core.tempo() - 108) < 1e-3 && Math.abs(core.specTempo() - 108) > 1 && Math.abs(core.tempoFactor() - core.specTempo() / core.tempo()) < 1e-12);
core.setTempo(90);
q(left, '.ctab-tempo').nextSibling.nextSibling.click();   // Reset
check("Reset goes back to the clip's tempo, and says so", Math.abs(core.tempo() - 108) < 1e-3 && /clip's own tempo/.test(q(left, '.ctab-tempo').nextSibling.nextSibling.title) && !q(left, '.ctab-tempo').nextSibling.classList.contains('changed'));

console.log('\n— the matrix: the lead row is the clip (B3)');
const marks = clipMarks(spec), leadDots = qa(lane('lead'), '.ctab-dot');
const count = (sel) => qa(lane('lead'), sel).length;
check(`a dot a clip note, silent ones too (${leadDots.length}/${p.J})`, leadDots.length === p.J && count('.ctab-dot.clip') === p.J);
check(`marks by kind: ${count('.ctab-dot.hard')} red hollow (silent), ${count('.ctab-dot.fringe') + count('.ctab-dot.shift')} amber (substituted), ${count('.ctab-dot.late')} late offs`, count('.ctab-dot.hard') === p.misses.hard
  && count('.ctab-dot.fringe') === p.misses.fringe && count('.ctab-dot.shift') === p.misses.shift && count('.ctab-dot.late') === marks.filter((m) => m.late).length && qa(lane('lead'), '.ctab-dot.hard').every((d) => !d.style.background));
check('no lead alternates (P6): no badge on the lead row, alternatesOf null, a lead swap refused', qa(lane('lead'), '.ctab-badge').length === 0 && core.alternatesOf(0, 'lead') === null
  && (() => { try { core.swapLead(0, 'x'); return false; } catch (err) { return /lead is the clip/.test(err.message); } })());
check('the lead cell\'s title counts its notes by kind', /Lead \(the clip\), bars? 1.*: 15 notes, 8 hit, 3 substituted \(amber\), 4 silent \(red\)/.test(q(lane('lead'), '.ctab-cell').title));
const row = buildRow([41, 42, 43, 0]), lit = bridge.overlay.highlights;
const clipNodes = [...new Set(p.notes.filter((x) => x.on.node != null).map((x) => indexOfTick(lit.plot.ticks, row.tick[x.on.node])))].sort((a, b) => a - b);
check(`the lead's lit nodes are the clip's (${clipNodes.length} nodes: the hits and substitutes; silent notes light nothing)`, J(lit.parts.lead.indices) === J(clipNodes));
q(lane('lead'), '.ctab-cell').click();
const noteRows = qa(inspector, '.ctab-clip-notes tr.ctab-clip-note');
check('the lead\'s context lists the clip\'s notes with their kinds (no runner-up lines)', noteRows.length === marks.filter((m) => m.step < spec.knobs.bars * spec.knobs.slotsPerBar).length && qa(inspector, '.ctab-clip-notes tr.hard').length === p.misses.hard
  && /no lead alternates/.test(inspector.textContent) && qa(inspector, '.ctab-alt').length === 0 && /lattice/.test(inspector.textContent));

console.log('\n— a window composition\'s playhead (B4)');
const plot = plotOf({ compositeRhythm: R.compositeRhythm, grid: R.grid }), W = spec.knobs.cycleSeconds / spec.knobs.rowCycleSeconds;
check(`the lit set carries the loop's share of the row's cycle (${lit.share.toFixed(3)} = the placement's ${p.share.toFixed(3)})`, Math.abs(lit.share - p.share) < 1e-9 && Math.abs(loopShare(spec) - W) < 1e-12 && W < 1);
let under = 0, sounding = 0;
for (const n of st.parts.lead.notes) { if (n.time >= spec.knobs.cycleSeconds) continue; sounding++; if (playheadAt(plot, lit.phaseX, n.time / spec.knobs.cycleSeconds, lit.share).index === indexOfTick(plot.ticks, n.tick)) under++; }
check(`every lead note sits under the playhead at its own loop time (${under}/${sounding}): phase + p × W`, under === sounding && sounding > 0);
const end = playheadAt(plot, lit.phaseX, 0.999999, lit.share), endTick = (lit.phaseX + 0.999999 * W) * R.grid;
check('the end of the loop is the window\'s end, not the cycle\'s', Math.abs(end.tick - (endTick % R.grid)) < R.grid * 1e-9 && Math.abs(playheadAt(plot, lit.phaseX, 0.999999).tick - ((lit.phaseX + 0.999999) % 1) * R.grid) < R.grid * 1e-9);
core.perform(); await settle(2);
ctx2d.calls.length = 0;
const at = { p: 0.5, t: 0.5 * spec.knobs.cycleSeconds };
bridge.overlay.frame(at);
const line = ctx2d.calls.filter((c) => c[0] === 'moveTo').find((c) => c[2] === 20), wantX = playheadX(win.lrcVisuals.positions, playheadAt(plot, lit.phaseX, 0.5, W));
check(`the overlay draws it there (x ${line?.[1]} = ${wantX})`, line && Math.abs(line[1] - wantX) < 1e-9);
core.stop();

console.log('\n— the tonic override (P5)');
const tonicSel = q(left, '.ctab-tonic');
check('a 12-way override: auto (the estimate) and the twelve classes', tonicSel.options.length === 13 && tonicSel.options[0].textContent === `auto (F# ${ode.key.mode})` && tonicSel.value === '');
tonicSel.value = '2'; dom.fire(tonicSel, 'change'); await settle();
const dSpec = compose([41, 42, 43, 0], 8, { seed: st.input.seed, target: { clip: ode, tonic: 2 }, worker: true });
check('pick D: placed again, the root following it (as compose with tonic 2)', tab.state.input.target.tonic === 2 && tab.state.spec.target.tonic === 2 && tab.state.spec.target.tonicAsked && tab.state.spec.knobs.root === dSpec.knobs.root
  && /tonic D \(asked/.test(text('.ctab-clip-decode')) && q(left, '.ctab-tonic').value === '2');
q(left, '.ctab-tonic').value = ''; dom.fire(q(left, '.ctab-tonic'), 'change'); await settle();
check('back to auto: the estimate again, the first composition\'s placement', tab.state.input.target.tonic === null && J(tab.state.spec.target.placement) === J(p) && tab.state.spec.knobs.root === spec.knobs.root);

console.log('\n— the placements: audition, revert, keep');
const list = tab.state.placements.list, chips = () => qa(left, '.ctab-place');
check(`the search's best and its alternates (${list.length}), the best current`, list.length >= 3 && list.length <= 9 && chips().length === list.length && chips()[0].classList.contains('current') && J(list[0]) === J(p)
  && J(list.slice(1)) === J(direct.target.alternates));
const base = tab.state.spec;
core.perform();
const cA = composes;
chips()[1].click(); await settle();
check('a first click auditions #2: composed with it given (no search), played again from the top', core.placementAudition()?.index === 1 && composes === cA + 1 && J(tab.state.spec.target.placement) === J(list[1])
  && tab.state.spec.target.search === null && tab.state.status === 'playing' && chips()[1].classList.contains('auditioning') && tab.state.placements.current === 1);
chips()[2].click(); await settle();
check('another click auditions #3 (still one audition)', core.placementAudition()?.index === 2 && J(tab.state.spec.target.placement) === J(list[2]) && core.placementAudition().from === 0);
keydown('Escape'); await settle();
check('Esc reverts it exactly: the composition before (the same object), the best current, still playing', tab.state.spec === base && !core.placementAudition() && tab.state.placements.current === 0 && !tab.state.input.target.placement
  && tab.state.status === 'playing' && composes === cA + 2);
chips()[1].click(); await settle();
chips()[1].click(); await settle();
check('a second click keeps it: the entry\'s placement from now on', !core.placementAudition() && J(tab.state.input.target.placement) === J(list[1]) && tab.state.placements.current === 1 && q(left, '.ctab-place.current') === chips()[1]);
core.stop();
const cK = composes;
core.setSeed(5); q(left, '.ctab-go').click(); await settle();
check('a re-compose (a new seed) keeps the kept placement, with no search', composes === cK + 1 && J(tab.state.spec.target.placement) === J(list[1]) && tab.state.spec.target.search === null && tab.state.placements.list.length === list.length);
core.setSeed(1);
await tab.auditionPlacement(0); await tab.keepPlacement();
check('keeping the best again leaves no placement in the input (the search\'s own)', !tab.state.input.target.placement && tab.state.placements.current === 0);
q(left, '.ctab-go').click(); await settle();

console.log('\n— edits on a window spec: the typed field, a chord swap, undo; the knobs the clip sets');
const pf = core.progressionField();
check(`the typed field reads the window's bars (${pf.resolution.bars} = B ${spec.knobs.bars}), from the spec's cropped cells`, pf.resolution && !pf.resolution.refused && pf.resolution.bars === spec.knobs.bars);
const a0 = core.alternatesOf(0, 'chords'), cand = a0.candidates.find((c) => !c.current);
const sw = await core.swapChord(0, cand); await settle();
check('a chord swap on the window spec applies; undo takes it back and the target stays', sw.ok && tab.state.spec.chords[0].rootTone === cand.root.ratio && tab.state.spec.target
  && (await core.undo()).ok && tab.state.spec === tab.state.composed && !!tab.state.input.target);
const typed = await core.setProgressionField('Am'); await settle();
check('the typed progression on a window spec: a live chord edit on bar 1', typed.ok && typed.live && !!tab.state.edits.chords[0]);
await core.undo();
tab.setSection('lines');
const barsKnob = qa(inspector, '.ctab-knob').find((k) => k.textContent.startsWith('Bars'));
check('the knobs the clip sets are disabled, "the clip\'s"', barsKnob && q(barsKnob, 'select').disabled && /the clip's/.test(barsKnob.textContent));
tab.setSection('cell');

console.log('\n— a clip dropped on the window; chords reduced (P1); a nameless clip takes the file\'s name');
dom.fire(left, 'dragenter', { dataTransfer: { types: ['Files'] } });
check('dragging a file over the window marks it', left.classList.contains('ctab-dropping'));
const stray = dom.fire(doc, 'drop', { dataTransfer: { types: ['Files'], files: [] }, prevented: false, preventDefault() { this.prevented = true; } });
check('a file dropped just outside the window (on the page) is caught, so the page never navigates to it', stray.prevented);
dom.fire(left, 'drop', { dataTransfer: { types: ['Files'], files: [fileOf('twinkle-chords.mid', bytesOf('twinkle-with-chords'))] } }); await settle();
check(`dropped: Twinkle over block triads, its top line; "chords reduced to their top note: 12 notes dropped" (${text('.ctab-clip-decode')})`, !left.classList.contains('ctab-dropping') && tab.state.input.target.clip.name === 'twinkle-with-chords'
  && /chords reduced to their top note: 12 notes dropped/.test(text('.ctab-clip-decode')) && tab.state.spec.target.clip.notes.length === 14 && !tab.state.input.target.placement && !tab.state.edits.order.length);
const nameless = writeMidi({ bpm: 96, tracks: [{ notes: seq([[60, 1], [62, 1], [64, 1], [65, 1], [67, 2], [65, 2]]) }] });
await chooseFile(fileOf('my-tune.mid', nameless));
check('a clip whose track names nothing takes the file\'s name', tab.state.input.target.clip.name === 'my-tune' && text('.ctab-clip-decode').startsWith('my-tune'));

console.log('\n— errors, in plain words');
const before = tab.state.spec, tBefore = tab.state.input.target;
await chooseFile(fileOf('notes.txt', new TextEncoder().encode('hello, not a midi file')));
check(`not a MIDI file: said, nothing changed (${text('.ctab-clip-error')})`, /Not a MIDI file/.test(text('.ctab-clip-error')) && tab.state.spec === before && tab.state.input.target === tBefore);
const fine = writeMidi({ tracks: [{ name: 'fine', notes: seq([[60, 1 / 12], [62, 1 / 12], [64, 1 / 12], [65, 1 / 12]]) }] });
await chooseFile(fileOf('fine.mid', fine));
check(`a grid too fine for a line: refused, said (${text('.ctab-refusal')})`, tab.state.spec.refused && tab.state.spec.reason === 'targetGrid' && /grid is too fine/.test(text('.ctab-refusal')) && q(left, '.ctab-clip-error').style.display === 'none'
  && q(left, '.ctab-clip-fit').style.display === 'none');
check('targetError words the rest', /no notes/.test(targetError('composer/midi: no notes')) && /cut short/.test(targetError('composer/midi: unexpected end of file')) && /too fine/.test(targetError('targetGrid')));

console.log('\n— Clear');
const cC = composes;
q(left, '.ctab-clip-clear').click(); await settle();
check('Clear composes nothing (Avery, 2026-10-26): no target, the lines gone, the entry dirty, the button Compose', composes === cC && !tab.state.input.target && tab.state.placements === null && tab.state.dirty
  && tab.button() === 'Compose' && q(left, '.ctab-clip-decode').style.display === 'none' && q(left, '.ctab-clip-clear').style.display === 'none');
q(left, '.ctab-go').click(); await settle();
const clearedSpec = tab.state.spec;
check('…then Compose: an ordinary composition, at its own tempo', composes === cC + 1 && !tab.state.spec.target && tab.state.spec.knobs.leader !== 'target' && Math.abs(core.tempo() - core.specTempo()) < 1e-9);

console.log('\n— too few tones');
setRhythm([3, 0, 0, 0], 4);
await chooseFile(fileOf('ode.mid', bytesOf('ode-to-joy')));
check(`a row of too few tones: refused, said (${text('.ctab-refusal')})`, tab.state.spec.refused && tab.state.spec.reason === 'tooFewTones' && /Too few tones/.test(text('.ctab-refusal')));

console.log('\n— the glyph\'s recall and the store (B1, B4)');
setRhythm([41, 42, 43, 0], 8);
check('back on 41:42:43: its entry as it was left (cleared: the ordinary composition, no clip), from the store\'s cache', tab.state.spec === clearedSpec && !tab.state.input.target);
await chooseFile(fileOf('ode-to-joy.mid', bytesOf('ode-to-joy')));
const odeSpec = tab.state.spec;
setRhythm([8, 7, 6, 5], 4);
check('another rhythm: its own entry, no clip', !tab.state.input.target);
await chooseFile(fileOf('frere-jacques.mid', bytesOf('frere-jacques')));
const lateMarks = clipMarks(tab.state.spec).filter((m) => m.late).length;
check(`8:7:6:5 plays Frère Jacques with late note-offs: each marked on the lead row (${lateMarks}), "late" on the fit line`, lateMarks > 0 && qa(lane('lead'), '.ctab-dot.late').length === lateMarks
  && new RegExp(`\\(${lateMarks} late\\)`).test(text('.ctab-clip-fit')) && qa(lane('lead'), '.ctab-dot.hard').length === tab.state.spec.target.placement.misses.hard);
setRhythm([41, 42, 43, 0], 8);
const cR = composes;
const phase = await bridge.lens.press();
check('the glyph recalls the target composition: no Compose, it plays, the clip is the lead', phase === 'landed' && composes === cR && tab.state.spec === odeSpec && tab.state.status === 'playing' && bridge.lens.mode === 'composition'
  && tab.state.spec.target.clip.name === 'ode-to-joy');
check('the one transport: Play/Stop stops and plays the target composition', bridge.transport.toggle() && tab.state.status === 'ready' && bridge.transport.toggle() && tab.state.status === 'playing');
const pl2 = plotOf({ compositeRhythm: win.lrcVisuals.compositeRhythm, grid: win.lrcVisuals.grid });
check('the lens\'s overlay walks the window too (its lit set carries the share)', bridge.overlay.highlights.share === loopShare(odeSpec) && bridge.overlay.highlights.parts.lead.indices.length > 0 && !!pl2);
await bridge.lens.press();
check('back to the row: the composition kept, the clip with it', bridge.lens.mode === 'row' && tab.state.spec === odeSpec && bridge.store.recallable());
setRhythm([41, 42, 43, 0], 10);
check('a new cycle of the same row: a new entry that carries the clip and the placements list (the row\'s, proposed)', tab.state !== bridge.store.entry('41:42:43:0@8')?.state && J(tab.state.input.target?.clip) === J(ode)
  && tab.state.placements?.list.length === odeSpec.target.alternates.length + 1 && !tab.state.spec);
q(left, '.ctab-go').click(); await settle();
check('… composed at the new cycle: the same placement (a share of the cycle), the loop scaled', J(tab.state.spec.target.placement) === J(odeSpec.target.placement) && Math.abs(tab.state.spec.knobs.cycleSeconds - odeSpec.knobs.cycleSeconds * 10 / 8) < 1e-9);

// ── 2. the worker path (P7) ──
console.log('\n— a big row\'s target through the worker');
class FakeWorker {
  constructor() { this.onmessage = null; this.posted = []; }
  postMessage(data) { this.posted.push(data); setTimeout(() => this.onmessage?.({ data: structuredClone(answer(structuredClone(data))) }), 0); }
}
{
  const worker = new FakeWorker(), runner = createComposeRunner({ makeWorker: () => worker });
  const host = { readRhythm: () => ({ layers: [4099, 4093, 4091, 4079], cycleSeconds: 16 }), stopMain() {}, onMainStarted: () => () => {} };
  const big = createTabController({ host, runCompose: runner, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} } });
  const fj = bytesOf('frere-jacques');
  const r = await big.setTarget(fj, { name: 'frere-jacques.mid' });
  const msg = worker.posted[0], s = big.state.spec;
  check('the 16,359-onset row: the compose (and so the search) posted to the worker, the clip as decoded (no bytes)', worker.posted.length === 1 && msg.options.target && J(msg.options.target.clip) === J(decoded['frere-jacques'])
    && !('placement' in msg.options.target) && !J(msg).includes('"0":77'));
  check(`… it lands: Frère Jacques ${s.target.placement.hits}/32, the whole cycle, with alternates and the placements list`, r.ok && s.target.placement.hits === 32 && s.target.placement.N === s.target.placement.B
    && s.target.alternates.length >= 1 && big.state.placements.list.length === 1 + s.target.alternates.length && Math.abs(big.core.tempo() - 112) < 1e-3);
  await big.auditionPlacement(1);
  check('an alternate through the worker: its placement given, no search there', J(worker.posted[1].options.target.placement) === J(big.state.placements.list[1]) && big.state.spec.target.search === null);
}
{
  const worker = new FakeWorker(), runner = createComposeRunner({ makeWorker: () => worker });
  const lean = createComposerController({ runCompose: runner, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} }, mainThreadOnsets: 1000,
    state: newCompositionState({ layers: [768, 769, 0, 0], cycleSeconds: 8, seed: 1 }) });
  lean.state.table = 'lean';
  await lean.setTarget(bytesOf('chromatic-run'));
  check('the lean table past mainThreadOnsets: a target compose goes to the worker anyway, its table kept lean (P7)', worker.posted.length === 1 && worker.posted[0].options.overrides.table === 'lean' && lean.state.spec.knobs.table === 'lean');
  const small = createComposerController({ runCompose: runner, createContext: () => audio, timers: { setInterval: () => 1, clearInterval: () => {} }, state: newCompositionState({ layers: [8, 7, 6, 5], cycleSeconds: 4, seed: 1 }) });
  small.state.table = 'lean';
  await small.setTarget(bytesOf('twinkle'));
  check('…below it, on this thread', worker.posted.length === 1 && small.state.spec.target && small.state.spec.knobs.table === 'lean');
}

// ── 3. the pure lines ──
console.log('\n— the lines as data');
const fl = fitLine({ placement: { ...p, N: p.B, drift: 6.4, phrases: [p.phrases[0], p.phrases[0]], missing: [] } });
check('fitLine: "whole cycle", the drift, no missing classes', fl.items.some((x) => x.text === 'whole cycle') && fl.items.some((x) => /drifts 6\.4¢ over 2 phrases/.test(x.text)) && !fl.items.some((x) => /can't play/.test(x.text)));
const unq = decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'ode-unquantized'))));
check('decodeLine: an unquantized clip says its grid is a guess', decodeLine(unq).items.some((x) => /unquantized/.test(x.text) && x.tone === 'amber'));

bridge.hideTab();
restore();
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
