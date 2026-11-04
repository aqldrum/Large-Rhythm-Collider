// assert-page-song.mjs — Song v0 in the Composer window (Composer/ARRANGEMENT_ORDER.md phase C: C1–C3, S14–S17): the
// controller's song state and edits, the lane (page/arrangement-lane.js) and the Song | Loop switch, in Node over
// dom-stub.mjs with the site's own composite rhythm, a RECORDING player (what Perform hands it: the spec and the two
// getters) and, at the end, the real player on a mock AudioContext with a recording MIDI sink. The rules are written
// here from the order, not read from the controller:
//   • Loop by default: the lane hidden, Loop lit; the getters Perform hands the player return the window's parts and
//     drums exactly (the same objects) whatever the pass
//   • Song before any Compose is kept (nothing planned); after it, Song plans from the loop AS IT PLAYS (S14: the
//     window's parts and drums, not Compose's): byte for byte form.js planSong over `{ ...spec, drums, parts }`; it is no
//     undo step; while playing, Song starts again from its top (a new play) and Loop carries on (none)
//   • in Song the getters map pass c → the song's pass c mod its length (form.js songPasses), the song repeating after
//     home, home the loop's own parts; songAt() names the section and the pass within it
//   • the lane: a column a section, its width ∝ passes, named and kind-coloured; a row a part and the Layers chips; on /
//     off and the density words where they differ; the energy line (solid, its target dotted); the template select,
//     Re-plan, the seed; the sounding section lit by frame()
//   • every edit through the lane's own controls, each ONE undo step, and its undo and redo: a part, a layer, ± passes,
//     a density (the strip's select), the template, Re-plan (seed + 1); a song step's undo runs no fold (the spec is the
//     same object) and keeps the mode; the getters follow each edit live; refusals said in words
//   • stale: a loop change (a chord swap) marks the song stale, nothing re-plans, the lane says "stale: re-plan", the song
//     plays its sections over the loop as it plays (home follows the edit); a loop step's undo never touches the song; a
//     sound or legato change isn't a loop change and stays live over the song (S16); the marker plans it again
//   • S16: in Song the part strips, the matrix's lane toggles and the inspector's on / off are read-only ("the lane
//     decides"), the strips showing the sounding section's on / off; sound and level stay live
//   • the JSON export carries the arrangement and loadSong takes it back (not stale on its own loop; a bare record is);
//     the store keeps it through a rhythm away and back; a re-compose keeps the song (stale) and clears the undo stack
//   • S17 on the real player: a section with the drums off sends no drum note, a part a section mutes sends nothing, and
//     the MIDI clock never stops across the sections
//   node Composer/tests/assert-page-song.mjs
import { makeDom, installGlobals } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';
import { compose, PART_IDS } from '../core/compose.js';
import { materialsOf } from '../core/rearrange.js';
import { planSong, songPasses, energyOf, TEMPLATES } from '../core/form.js';
import { createComposerController } from '../perform/composer-controller.js';
import { createPlayer } from '../perform/composer-player.js';
import { createComposerMidi, MIDI_PARTS, DRUM_CHANNEL } from '../perform/composer-midi.js';
import { newCompositionState } from '../store/composition-store.js';
import { laneModel, energyCell, KIND_COLORS } from '../page/arrangement-lane.js';
import { readFileSync } from 'node:fs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const J = (x) => JSON.stringify(x);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** the same parts or drums as data (form.js caches its passes by the loop object: a test's own loop object gets its own) */
const alike = (a, b) => J(a) === J(b);

console.log('═══ COMPOSER — Song v0 in the window (ARRANGEMENT_ORDER.md, phase C) ═══');

// ── the page ──
const dom = makeDom(), win = dom.window, doc = dom.document;
const restore = installGlobals(dom);
const canvas = doc.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
const ctx2d = canvas.getContext('2d');
win.lrcVisuals = {
  currentPlotType: 'linear', composerOverlay: null, compositeRhythm: null, grid: 0, positions: [],
  setComposerOverlay(o) { this.composerOverlay = o; this.drawPlot(); },
  drawPlot() { this.composerOverlay?.draw(ctx2d, { positions: this.positions, width: 800, height: 400, dotSize: 4, canvas, button: null, animating: false }); },
  setPlotType(t) { this.currentPlotType = t; this.drawPlot(); },
};
win.toneRowPlayback = { isPlaying: false, cycleDuration: 4, stopPlayback() { this.isPlaying = false; } };
function setRhythm(layers, T) {
  const r = siteRhythm(layers);
  win.lrcModule = { currentRhythms: layers, currentGrid: r.grid, currentCompositeRhythm: r.compositeRhythm, currentLayerMap: r.layerMap };
  win.lrcVisuals.compositeRhythm = r.compositeRhythm; win.lrcVisuals.grid = r.grid;
  win.lrcVisuals.positions = Array.from({ length: r.compositeRhythm.length }, (_, i) => ({ x: 40 + i, y: 100, index: i }));
  win.toneRowPlayback.cycleDuration = T;
  win.dispatchEvent(new win.Event('rhythmGenerated'));
}
const layerBox = doc.createElement('div'); layerBox.id = 'layer-controls-content'; doc.body.append(layerBox);

// the recording player: what Perform hands it, and a pass the test sets (S13's passAt)
const plays = [], levelCalls = [];
const fake = { playing: false, pass: 0, play(spec, gp, gd) { plays.push({ spec, gp, gd }); this.playing = true; }, stop() { this.playing = false; }, setLevel(id, v) { levelCalls.push([id, v]); },
  setGlide() {}, setTimeFactor() {}, localSound() {}, setMix() {}, playhead() { return this.playing ? 0.25 : null; }, passAt() { return this.playing ? this.pass : null; } };
const runCompose = async (l, T, o) => compose(l, T, o);
const { createComposerBridge } = await import('../page/composer-bridge.js');
const bridge = createComposerBridge(win, { runCompose, createContext: () => ({ state: 'running' }), createPlayer: () => fake, timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem() {} }, session: null, motion: () => false });
const tab = bridge.controller, core = tab.core;
const left = doc.createElement('div'), inspector = doc.createElement('div');
doc.body.append(left, inspector);
bridge.mountTab({ left, inspector });
bridge.showTab();
const q = (root, sel) => root.querySelector(sel), qa = (root, sel) => root.querySelectorAll(sel);
const S = () => tab.state, A = () => core.arrangement();
const laneEl = () => q(left, '.alane');
const click = async (el) => { el.click(); await settle(); };
const pick = async (el, value) => { el.value = String(value); dom.fire(el, 'change'); await settle(); };
const modeBtn = (name) => [...qa(left, '.ctab-mode')].find((b) => b.textContent === name);
/** the loop as it plays, as the order says the controller hands form.js */
const loopNow = () => ({ ...S().spec, drums: S().drums, parts: PART_IDS.map((id) => S().parts[id]) });
const lastPlay = () => plays[plays.length - 1];

const L = [8, 7, 6, 5], T = 4;
setRhythm(L, T);

// ── Loop by default ──
console.log('\n— Loop by default, and Song before any Compose');
check('the entry starts in Loop with no song (the store\'s newArrangement)', J(A()) === J({ mode: 'loop', template: 'arch', seed: 1, song: null, loop: null }) && J(newCompositionState().arrangement) === J(A()));
check('the switch sits beside the transport, Loop lit; the lane is hidden', !!modeBtn('Loop') && !!modeBtn('Song') && modeBtn('Loop').className.includes(' on') && !modeBtn('Song').className.includes(' on')
  && q(left, '.ctab-go').nextSibling === q(left, '.ctab-modes') && laneEl().style.display === 'none');
await click(modeBtn('Song'));
check('Song before any Compose is kept, nothing planned; the lane says to Compose first', A().mode === 'song' && A().song === null && laneEl().style.display === '' && /Compose first/.test(laneEl().textContent));
await click(modeBtn('Loop'));
check('…and back to Loop', A().mode === 'loop' && laneEl().style.display === 'none');

await tab.press();   // Compose
check('composed (8:7:6:5)', S().status === 'ready' && !!S().spec && !S().spec.refused, S().error);
await tab.press();   // Perform
const loopPlay = lastPlay();
const cur = () => core.currentParts();
check('Loop: Perform hands the player the spec and getters that return the window\'s parts and drums, the same objects, whatever the pass',
  loopPlay.spec === S().spec && [0, 1, 7, 33].every((c) => same(loopPlay.gp(c), cur()) && loopPlay.gd(c) === S().drums) && same(loopPlay.gp(), cur()));
check('Loop: no song arrangement is exported', !('arrangement' in (core.editsExport() ?? {})));

// ── Song: the plan ──
console.log('\n— Song plans from the loop as it plays (S14)');
const undoBefore = S().undo.length, playsBefore = plays.length;
await click(modeBtn('Song'));
const mats = materialsOf(S().composed);
const want = planSong(loopNow(), mats, { template: 'arch', seed: 1 });
check('the song is planSong over { ...spec, drums: the window\'s, parts: the window\'s } (Arch, seed 1), byte for byte', J(A().song) === J(want) && A().mode === 'song' && A().template === 'arch' && A().seed === 1);
check('…the loop handed is the one that plays: its drums the window\'s, not Compose\'s spec.drums', loopNow().drums === S().drums && loopNow().drums !== S().spec.drums);
check('planning is no undo step; playing, Song started again from its top (a new play)', S().undo.length === undoBefore && plays.length === playsBefore + 1 && lastPlay().spec === S().spec);
const songPlay = lastPlay();
let passes = songPasses(A().song, loopNow(), mats);
const total = () => passes.length;
check(`the getters: pass c → the song's pass c mod ${total()}, its parts and drums, two times round`, Array.from({ length: 2 * total() + 3 }, (_, c) => c).every((c) => {
  const e = passes[c % total()];
  return alike(songPlay.gp(c), e.parts) && alike(songPlay.gd(c), e.drums);
}));
const homeAt = passes.findIndex((e) => A().song.sections[e.section].kind === 'home');
check('home plays the loop\'s own parts (the window\'s objects) and drums', same(songPlay.gp(homeAt), cur()) && songPlay.gd(homeAt) === S().drums);
fake.pass = 7;
const at = core.songAt(), e7 = passes[7];
check('songAt(): the sounding section and the pass within it (S13)', at && at.pass === 7 && at.index === 7 && at.section === e7.section && at.passInSection === e7.pass && at.passes === A().song.sections[e7.section].passes, J(at));
fake.pass = total() + 2;
check('…past home the song repeats from the top', core.songAt().index === 2 && core.songAt().section === passes[2].section);

// ── the lane ──
console.log('\n— the lane (S15)');
fake.pass = 0;
core.stop(); await settle();
const ss = core.songState(), model = laneModel(ss, { selected: 0 });
const cols = qa(left, '.alane-col'), secs = A().song.sections;
check(`a column a section (${secs.length}), named, coloured by kind`, cols.length === secs.length && [...cols].every((c, i) => c.textContent.includes(secs[i].name) && c.style['--alane-kind'] === KIND_COLORS[secs[i].kind] && c.dataset.kind === secs[i].kind));
const tplCols = q(left, '.alane-cols').style.gridTemplateColumns;
check('each column as wide as its passes (fr units)', secs.every((s) => tplCols.includes(`${s.passes}fr`)) && tplCols.split('minmax').length - 1 === secs.length, tplCols);
check('a row a part (the matrix\'s order) and a Layers row', [...qa(left, '.alane-part')].map((x) => x.textContent).join() === 'Lead,Chords,Comping,Bass,Inner,Drums' && qa(left, '.alane-layers-row').length === 1);
const cell = (part, i) => q(left, `.alane-cell[data-part="${part}"][data-section="${i}"]`);
check('every cell on or off as its section has it', secs.every((s, i) => PART_IDS.concat('drums').every((id) => cell(id, i).classList.contains('on') === !!s.parts[id])));
const dense = secs.findIndex((s) => s.parts.bass && s.density?.bass);
check('a density where it differs from the loop\'s, in words', dense >= 0 && cell('bass', dense).textContent === { roots: 'Roots', sparse: 'Sparse', moving: 'Moving', walking: 'Walking' }[secs[dense].density.bass], `${dense} ${cell('bass', Math.max(0, dense))?.textContent}`);
const chip = (layer, i) => q(left, `.alane-chip[data-layer="${layer}"][data-section="${i}"]`);
check('the Layers row: the row\'s layers as chips, in or out as the section has them', secs.every((s, i) => [0, 1, 2, 3].every((b) => chip(b, i).classList.contains('on') === !!(s.layers & (1 << b)))) && chip(0, 0).textContent === 'A');
const svgs = [...qa(left, '.alane-energy')].map((x) => x.innerHTML);
check('the energy line across the top: a step a section, solid E and its dotted target', svgs.length === secs.length && svgs.every((t, i) => t === energyCell(model.columns[i], model.columns[i - 1], model.scale) && /class="alane-e"/.test(t) && /class="alane-target"/.test(t)));
check('the energies are energyOf on the loop as it plays', secs.every((s, i) => Math.abs(ss.energies[i] - energyOf(s, loopNow(), mats)) < 1e-12) && secs.every((s, i) => Math.abs(ss.energies[i] - s.energy) < 1e-9));
check('the bar: the template select (Arch | Build–drop), Re-plan, the seed, no stale marker', q(left, '.alane-template').value === 'arch' && [...q(left, '.alane-template').options].map((o) => o.textContent).join('|') === Object.values(TEMPLATES).map((t) => t.label).join('|')
  && !!q(left, '.alane-replan') && /seed 1/.test(q(left, '.alane-seed').textContent) && !q(left, '.alane-stale'));
check('"→ fill" on a section before a peak', secs.every((s, i) => !!cols[i].querySelector('.alane-fill') === !!s.fillBefore) && secs.some((s) => s.fillBefore));
await tab.press(); await settle();   // Perform (Song)
fake.pass = passes.findIndex((e) => e.section === 2);
bridge.showTab();
dom.raf.flush(3);
check('the sounding section lit while Song plays (frame())', [...qa(left, '.alane-col')].every((c, i) => c.classList.contains('now') === (i === 2)) && cell('chords', 2).classList.contains('now') && !cell('chords', 1).classList.contains('now'));

// ── the edits, each one undo step ──
console.log('\n— every edit is one undo step (S15), live in the getters, its undo the song alone');
const specObj = S().spec;
/** a lane click → one undo step; its undo back to the song before (no fold: the same spec), the mode kept; redo again */
async function edit(label, act, expect) {
  const before = J(A().song), n = S().undo.length;
  await act();
  const after = J(A().song), stepped = S().undo.length === n + 1, ok1 = expect(A().song);
  await core.undo(); await settle();
  const back = J(A().song) === before && S().spec === specObj && A().mode === 'song';
  await core.redo(); await settle();
  const again = J(A().song) === after;
  await core.undo(); await settle();
  check(`${label}: one undo step; undo back exactly (no fold, the mode kept); redo again`, ok1 && stepped && back && again && J(A().song) === before && S().spec === specObj, J({ ok1, stepped, back, again }));
}
const s0 = () => A().song.sections;
const inSec = (i) => passes.findIndex((e) => e.section === i);
await edit('a part (Chords in the intro)', () => click(cell('chords', 0)), (song) => song.sections[0].parts.chords === !secs[0].parts.chords && song.sections[0].edited === true);
await click(cell('chords', 0));
passes = songPasses(A().song, loopNow(), mats);
check('…the getters follow it live (no new play): the intro\'s chords as the lane has them, the song otherwise as before', lastPlay() === plays[plays.length - 1] && lastPlay().gp(inSec(0)).find((p) => p.id === 'chords').enabled === s0()[0].parts.chords
  && same(lastPlay().gp(homeAt), cur()));
check('…the energy said again (energyOf), the cell and the column marked edited', Math.abs(s0()[0].energy - energyOf(s0()[0], loopNow(), mats)) < 1e-12 && !!qa(left, '.alane-col')[0].querySelector('.alane-edited') && cell('chords', 0).classList.contains('on') === s0()[0].parts.chords);
await core.undo(); await settle();
await edit('a layer (A in the build)', () => click(chip(0, 1)), (song) => song.sections[1].layers === (secs[1].layers ^ 1));
const nudge = (i, sign) => [...qa(left, '.alane-col')[i].querySelectorAll('.alane-nudge')][sign < 0 ? 0 : 1];
await edit('+ a pass (the peak)', () => click(nudge(2, 1)), (song) => song.sections[2].passes === secs[2].passes + 1);
await click(nudge(2, 1));
check('…the song one pass longer in the getters', core.songState().passes === total() + 1 && lastPlay().gp(total()) && core.songState().passes === songPasses(A().song, loopNow(), mats).length);
await core.undo(); await settle();
await edit('− a pass (the break)', () => click(nudge(3, -1)), (song) => song.sections[3].passes === secs[3].passes - 1);
await click(q(left, '.alane-name'));   // select the intro
const nameOf = (i) => [...qa(left, '.alane-name')][i];
await click(nameOf(2));
check('a section\'s name selects it: the strip shows its kind, energy, passes and why', tab.view.songSection === 2 && q(left, '.alane-strip-name').textContent === secs[2].name && q(left, '.alane-why').textContent === secs[2].why);
const densSel = (part) => q(left, `.alane-density[data-part="${part}"]`);
await edit('a density (the peak\'s bass at Roots, from the strip)', () => pick(densSel('bass'), 'roots'), (song) => song.sections[2].density.bass === 'roots');
const own = core.songState().own;
await pick(densSel('bass'), own.bass);
check('…the loop\'s own density again removes it from the record (as the planner records it)', !('bass' in s0()[2].density) && S().undo.length >= 1);
await core.undo(); await settle();
await edit('the template (Build–drop)', () => pick(q(left, '.alane-template'), 'build-drop'), (song) => J(song) === J(planSong(loopNow(), mats, { template: 'build-drop', seed: 1 })));
await edit('Re-plan (the same template, seed + 1)', () => click(q(left, '.alane-replan')), (song) => song.seed === 2 && J(song) === J(planSong(loopNow(), mats, { template: 'arch', seed: 2 })));
await click(q(left, '.alane-replan'));
check('Re-plan while Song plays starts it again from the top; the seed shown', lastPlay() !== songPlay && A().seed === 2 && /seed 2/.test(q(left, '.alane-seed').textContent));
await core.undo(); await settle();
check('…undone: seed 1\'s song back', A().seed === 1 && J(A().song) === J(want));

console.log('\n— refusals, said');
const r1 = core.toggleSongLayer(0, 7), r2 = core.setSongPasses(0, 0), r3 = core.toggleSongPart(99, 'lead');
check('a layer the row lacks, a pass count of 0, a section the song lacks: refused with words, nothing changed', !r1.ok && /no layer/.test(r1.error) && !r2.ok && /whole number/.test(r2.error) && !r3.ok && /no section/.test(r3.error) && J(A().song) === J(want));
let threw = false; try { core.setSongDensity(0, 'comp', 'thick'); } catch (err) { threw = /one of/.test(err.message); }
check('a density off the part\'s ladder throws', threw);
check('nothing refused left an undo step', S().undo.length === 0);

// ── S16: on / off is the lane's; sounds and levels stay live ──
console.log('\n— S16: the lane owns on / off; sounds, legato and levels stay live');
const strips = bridge.panels.strips;
strips.enter();
fake.pass = 0;
strips.frame();
const stripBtn = (id) => q(strips.root, `.part-strip-btn[data-part="${id}"]`);
check('the part strips are read-only in Song: Mute disabled, the title "the lane decides"; Sound and Level live', q(strips.root, '.part-strip-mute').disabled && /the lane decides/.test(q(strips.root, '.layer-control-header').textContent)
  && !q(strips.root, '.part-strip-sound').disabled && !q(strips.root, '.part-strip-level').disabled);
check('…they show the sounding section\'s on / off (the intro: no lead)', stripBtn('lead').classList.contains('off') === !secs[0].parts.lead && !secs[0].parts.lead);
fake.pass = homeAt; strips.frame();
check('…and follow the sounding section (home: every part on)', !stripBtn('lead').classList.contains('off'));
const owned = [...qa(left, '.ctab-lane-owned')], inspOwned = [...qa(inspector, '.ctab-lane-owned')];
check('the matrix\'s lane toggles and the inspector\'s on / off are read-only, titled "the lane decides"', owned.length === 6 && owned.every((b) => b.disabled && /the lane decides/.test(b.title)) && inspOwned.length === 1 && inspOwned[0].disabled);
const sig0 = core.songState().stale;
const bassNow = S().parts.bass, other = core.soundChoices ? null : null;
const { soundChoices } = await import('../perform/composer-controller.js');
const newSound = soundChoices().map((x) => x.id).find((id) => id !== bassNow.sound);
core.setPart('bass', { sound: newSound }); await settle();
const withBass = passes.findIndex((e) => e.parts.find((p) => p.id === 'bass').enabled);
const gb = lastPlay().gp(withBass).find((p) => p.id === 'bass'), pb = passes[withBass].parts.find((p) => p.id === 'bass');
check('a sound change isn\'t a loop change (not stale), and the song plays it: the pass\'s bass in the new sound, its notes the pass\'s', !sig0 && !core.songState().stale && gb.sound === newSound
  && J(gb.notes.map((n) => [n.node, n.time, n.hz])) === J(pb.notes.map((n) => [n.node, n.time, n.hz])) && gb.enabled === pb.enabled);
core.setPart('inner', { legato: !S().parts.inner.legato }); await settle();
check('…legato the same (live over the song, not stale)', !core.songState().stale && lastPlay().gp(homeAt).find((p) => p.id === 'inner').legato === S().parts.inner.legato);
core.setLevel('bass', 0.33);
check('…a level goes to the player\'s bus as before', J(levelCalls[levelCalls.length - 1]) === J(['bass', 0.33]));
core.setPart('bass', { sound: bassNow.sound }); core.setPart('inner', { legato: !S().parts.inner.legato }); await settle();
const muted = core.setPart('lead', { enabled: false });
check('a part off in the loop is a loop change: stale', core.songState().stale === true);
const rOff = core.toggleSongPart(0, 'lead');
check('…and a section can\'t turn it on: refused with words', !rOff.ok && /off in the loop/.test(rOff.error));
core.setPart('lead', { enabled: true }); await settle();
check('…on again: the loop\'s content as planned, so not stale', core.songState().stale === false);
strips.leave();

// ── stale ──
console.log('\n— stale: the loop changed under the song (S14)');
await click(modeBtn('Loop'));
const playsAtLoop = plays.length;
check('Loop while playing carries on (no new play), and the getters are the loop\'s again', plays.length === playsAtLoop && same(lastPlay().gp(inSec(0)), cur()) && lastPlay().gd(inSec(0)) === S().drums && laneEl().style.display === 'none');
const alt = core.alternatesOf(0, 'chords').candidates.find((c) => !c.current);
const songBeforeSwap = J(A().song);
const sw = await core.swapChord(0, alt); await settle();
await click(modeBtn('Song'));
check('a chord swap in Loop marks the song stale; nothing re-planned; the lane says "stale: re-plan"', sw.ok && core.songState().stale && J(A().song) === songBeforeSwap && !!q(left, '.alane-stale') && /stale: re-plan/.test(q(left, '.alane-stale').textContent));
check('Song again with a song kept plans nothing (and starts it from the top)', J(A().song) === songBeforeSwap && lastPlay().spec === S().spec);
passes = songPasses(A().song, loopNow(), materialsOf(S().composed));
check('the stale song plays its sections over the loop as it plays: home is the edited loop', same(lastPlay().gp(homeAt), cur()) && cur().find((p) => p.id === 'chords') === S().parts.chords
  && alike(lastPlay().gp(inSec(1)), passes[inSec(1)].parts));
const undoN = S().undo.length;
await core.undo(); await settle();
check('the chord swap\'s undo (a loop step) leaves the song alone', S().undo.length === undoN - 1 && J(A().song) === songBeforeSwap && A().mode === 'song');
await core.redo(); await settle();
await click(q(left, '.alane-stale'));
check('the marker plans it again at its seed, on the edited loop: not stale, one undo step', !core.songState().stale && A().seed === 1 && J(A().song) === J(planSong(loopNow(), materialsOf(S().composed), { template: 'arch', seed: 1 })) && !q(left, '.alane-stale') && S().undo.length === undoN + 1);

// ── export, load, the store, a re-compose ──
console.log('\n— the JSON export, loadSong, the store, a re-compose');
const exported = JSON.parse(core.exportJSON());
const ea = exported.edits?.arrangement;
check('the export carries the arrangement: { mode, template, seed, loop, stale, song }', ea && J(Object.keys(ea)) === J(['mode', 'template', 'seed', 'loop', 'stale', 'song']) && ea.mode === 'song' && ea.stale === false && J(ea.song) === J(A().song) && ea.loop === A().loop);
const kept = J(A().song);
await click(cell('drums', 0));
const lr = core.loadSong(exported); await settle();
check('loadSong(the export): its song back on its own loop, not stale, one undo step', lr.ok && lr.stale === false && J(A().song) === kept && !core.songState().stale && !q(left, '.alane-stale'));
await core.undo(); await settle();
check('…its undo: the song before the load', J(A().song) !== kept && A().song.sections[0].parts.drums === !JSON.parse(kept).sections[0].parts.drums);
const lb = core.loadSong(JSON.parse(kept));
check('a bare S1 record loads too, stale (its loop is unknown)', lb.ok && lb.stale === true && core.songState().stale && J(A().song) === kept);
const bad = core.loadSong({ version: 'composer-song-v0', sections: [{ kind: 'nope' }] }), none = core.loadSong({});
check('a song this loop can\'t play, or none, is refused with words', !bad.ok && /kind/.test(bad.error) && !none.ok && /no song/.test(none.error) && J(A().song) === kept);
const heldSong = A().song, keyBefore = tab.key();
setRhythm([5, 4, 0, 0], 3); tab.syncRhythm(); await settle();
check('another rhythm: its own entry, in Loop with no song', tab.key() !== keyBefore && A().mode === 'loop' && A().song === null);
setRhythm(L, T); tab.syncRhythm(); await settle();
check('back: the store kept the song and Song (the entry\'s own)', tab.key() === keyBefore && A().song === heldSong && A().mode === 'song');
core.setSeed(2); await settle();
await tab.press(); await settle();   // Compose at seed 2
check('a re-compose keeps the song, stale; nothing re-planned; the undo stack cleared', S().status === 'ready' && A().song === heldSong && core.songState().stale && S().undo.length === 0);
check('…its sections still play over the new loop (home is it)', (await tab.press(), true) && same(lastPlay().gp(homeAt), cur()) && lastPlay().spec === S().spec);
core.stop();
restore();

// ── S17: the real player, MIDI ──
console.log('\n— S17: MIDI through the player, section by section');
function makeCtx() {
  const param = (value) => { const p = { value }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0), reduction: 0 }),
    createWaveShaper: () => node({ curve: null, oversample: 'none' }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}
const actx = makeCtx(), now = () => actx.currentTime * 1000;
const recorder = (name) => { const sent = []; return { name, id: name, sent, send(bytes, ts) { sent.push({ bytes: [...bytes], ts }); } }; };
const ports = Object.fromEntries(MIDI_PARTS.map((id) => [id, recorder(id)])), clockPort = recorder('clock');
const sink = createComposerMidi({ now });
sink.setPorts(ports); sink.setClockPort(clockPort); sink.setEnabled(true);
// the player on the mock's clock (its Web MIDI timestamps from the mock's time, as assert-song-player.mjs runs it)
const mc = createComposerController({ createContext: () => actx, timers: {}, midi: sink, mix: null, createPlayer: (o) => createPlayer({ ...o, now }), state: newCompositionState({ layers: L, cycleSeconds: T, seed: 1 }) });
await mc.compose();
mc.setMode('song');
const msong = mc.arrangement().song, intro = msong.sections[0];
if (intro.parts.drums) mc.toggleSongPart(0, 'drums');
// the section after it plays the drums (the planner's breaks and builds may be drumless since its 11-04 amendments)
if (!mc.arrangement().song.sections[1].parts.drums) mc.toggleSongPart(1, 'drums');
check('the intro edited to play no drums (and, as planned, no lead)', mc.arrangement().song.sections[0].parts.drums === false && intro.parts.lead === false);
mc.perform();
const pl = mc.player, L0 = pl.loopStart, spanIntro = mc.arrangement().song.sections[0].passes * T;
const spanAll = mc.songState().passes * T;
while (actx.currentTime < L0 + spanIntro + 2 * T) { actx.currentTime += 0.025; pl.tick(); }
mc.stop();
const noteOns = (p) => p.sent.filter((m) => (m.bytes[0] & 0xF0) === 0x90 && m.bytes[2] > 0);
const inIntro = (m) => m.ts >= L0 * 1000 - 1e-6 && m.ts < (L0 + spanIntro) * 1000 - 1e-6, after = (m) => m.ts >= (L0 + spanIntro) * 1000 - 1e-6;
const drumOns = noteOns(ports.drums).filter((m) => (m.bytes[0] & 0x0F) === DRUM_CHANNEL);
check(`no drum note in the drumless intro (${spanIntro} s), and the drums from the build on (${drumOns.filter(after).length})`, !drumOns.some(inIntro) && drumOns.some(after));
check('the lead, muted in the intro, sends nothing there; it plays later in the song', !noteOns(ports.lead).some(inIntro) && spanAll > spanIntro);
const ticks = clockPort.sent.filter((m) => m.bytes[0] === 0xF8).map((m) => m.ts), gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
const dt = 60000 / mc.state.spec.knobs.tempoBpm / 24;
check(`the MIDI clock runs on across the sections: ${ticks.length} ticks, every gap ${dt.toFixed(2)} ms`, ticks.length > (spanIntro + T) * 1000 / dt && gaps.every((g) => Math.abs(g - dt) < 1e-6) && ticks.some((t) => t > (L0 + spanIntro) * 1000));

// ── the files ──
console.log('\n— the page\'s files');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
check('index.html links the lane\'s stylesheet with a ?v=', /Composer\/page\/arrangement-lane\.css\?v=\d+/.test(html));
const css = readFileSync(new URL('../page/arrangement-lane.css', import.meta.url), 'utf8');
check('the lane\'s colours are tokens on .alane (one place for a theme), the kinds\' and parts\' hues from the view', /\.alane \{[^}]*--alane-bg:/.test(css) && /var\(--alane-kind/.test(css) && /var\(--alane-part/.test(css));

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
