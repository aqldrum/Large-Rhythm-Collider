// assert-page-song.mjs — Song v0 in the Composer window (Composer/ARRANGEMENT_ORDER.md phase C: C1–C3, S14–S17): the
// controller's song state and edits, the lane (page/arrangement-lane.js) and the Song | Loop switch, in Node over
// dom-stub.mjs with the site's own composite rhythm, a RECORDING player (what Perform hands it: the spec and the two
// getters) and, at the end, the real player on a mock AudioContext with a recording MIDI sink. The rules are written
// here from the order, not read from the controller:
//   • Loop by default: the lane hidden, Loop lit; the getters Perform hands the player return the window's parts and
//     drums exactly (the same objects) whatever the pass
//   • Song before any Compose is kept (nothing planned) and planned as the Compose lands; after it, Song plans from the loop AS IT PLAYS (S14: the
//     window's parts and drums, not Compose's): byte for byte form.js planSong over `{ ...spec, drums, parts }`; it is no
//     undo step; while playing, Song starts again from its top (a new play) and Loop carries on (none)
//   • in Song the getters map pass c → the song's pass c mod its length (form.js songPasses), the song repeating after
//     home, home the loop's own parts; songAt() names the section and the pass within it
//   • the lane: a column a section, its width ∝ passes, named and kind-coloured; a row a part and the Layers chips; on /
//     off and the density words where they differ; the energy line (solid, its target dotted); the template select,
//     Re-plan, the seed; the sounding section lit by frame()
//   • the Song UI's visual pass (DESIGN_NOTES "Song UI (visual pass)"): in Song the loop's matrix is hidden (a class
//     swap, the matrix still rendered under it), in Loop shown; a clip a section × part, each drawing every note or hit
//     of every pass it spans (form.js songPasses, counted from its SVG's text), tiled a pass at a time with a rule
//     between, the fill pass its own drums, each part on one pitch range over the song; an off clip present, outlined
//     and dim, its passes ghosted; the ruler one element with a band a section, a tick a section and a pass, and the
//     time; the playhead at songPosition(); the clean plot hides the plot (an opaque wash) and moves no state, undo or
//     export, in Song and in Loop
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
//   • Song seek and section start (ARRANGEMENT_ORDER.md "Song seek and section start"): a click on the ruler → the cue at
//     the bar it falls in (timeline().fromX of the click's share; shift-click the point), a jump while playing (a new
//     play from that pass and offset), stopped the playhead waiting there (dashed, the cue's flag on the ruler) and
//     Perform from it; Stop leaves it; a section head's double-click → the cue at its first pass, a jump while playing,
//     the single click still selecting; the cue no undo step and not exported; the top drops it, a new song drops it,
//     Loop ⇄ Song keeps it; Loop's Perform is untouched (from its top, no start), and Loop refuses a cue
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
import { laneModel, energyCell, KIND_COLORS, timeline } from '../page/arrangement-lane.js';
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
const fake = { playing: false, pass: 0, play(spec, gp, gd, start) { plays.push({ spec, gp, gd, start, args: start === undefined ? 3 : 4, was: this.playing }); this.playing = true; }, stop() { this.playing = false; }, setLevel(id, v) { levelCalls.push([id, v]); },
  setGlide() {}, setTimeFactor() {}, localSound() {}, setMix() {}, playhead() { return this.playing ? 0.25 : null; }, passAt() { return this.playing ? this.pass : null; } };
const runCompose = async (l, T, o) => compose(l, T, o);
const { createComposerBridge } = await import('../page/composer-bridge.js');
const stored = {};
const bridge = createComposerBridge(win, { runCompose, createContext: () => ({ state: 'running' }), createPlayer: () => fake, timers: { setInterval: () => 1, clearInterval: () => {} },
  storage: { getItem: () => '0', setItem(k, v) { stored[k] = v; } }, session: null, motion: () => false });
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
check('Loop shows the loop\'s matrix (no ctab-song-on on the left host)', !left.classList.contains('ctab-song-on') && !!q(left, '.ctab-matrix-wrap'));
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
{
  const before = J({ arr: A(), undo: S().undo.length }), head = (id) => q(left, `.alane-part[data-part="${id}"]`), picked = [];
  for (const id of ['bass', 'drums', 'lead']) { await click(head(id)); picked.push(tab.view.selected === id && q(inspector, '.ctab-insp-name').textContent === head(id).textContent && q(left, '.alane-part.selected') === head(id)); }
  check('a part\'s name in the lane selects it, as the loop\'s matrix names do: the inspector shows it, the name lit, nothing edited', picked.every(Boolean) && J({ arr: A(), undo: S().undo.length }) === before, J(picked));
}
const cell = (part, i) => q(left, `.alane-clip[data-part="${part}"][data-section="${i}"]`);
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

// ── the Song UI's visual pass ──
console.log('\n— the Song UI: the matrix hidden, the clips, the ruler, the playhead, the clean plot');
const laneCss = readFileSync(new URL('../page/arrangement-lane.css', import.meta.url), 'utf8');
check('in Song the loop\'s matrix and its bar picker are hidden (ctab-song-on, a class swap), still rendered under it for an instant Loop', left.classList.contains('ctab-song-on')
  && /\.ctab-left\.ctab-song-on:not\(\.ctab-animating\) \.ctab-matrix-wrap, \.ctab-left\.ctab-song-on:not\(\.ctab-animating\) \.ctab-barpick \{ display: none !important; \}/.test(laneCss) && qa(left, '.ctab-lane').length === 6);
check('…except while Compose\'s animation plays: the matrix it builds shows, the lane held back until it ends', /\.ctab-left\.ctab-animating \.alane \{ display: none !important; \}/.test(laneCss));
const LANE_ROWS = ['lead', 'chords', 'comp', 'bass', 'inner', 'drums'];
const clipEls = [...qa(left, '.alane-clip')];
check(`a clip a section × part (${secs.length} × 6), each with its data-section and data-part`, clipEls.length === secs.length * 6
  && new Set(clipEls.map((c) => `${c.dataset.section}|${c.dataset.part}`)).size === clipEls.length && secs.every((_, i) => LANE_ROWS.every((id) => !!cell(id, i))));
/** what a clip draws, from its SVG's text: the marks (a subpath a note or hit) a pass group, the rules between passes */
const drawnOf = (c) => {
  const html = q(c, '.alane-notes').innerHTML, groups = [...html.matchAll(/<g class="alane-pass([^"]*)" data-pass="(\d+)"[^>]*>(.*?)<\/g>/g)];
  const marks = (t) => [...t.matchAll(/<path class="alane-n[^"]*" d="([^"]*)"/g)].reduce((a, m) => a + (m[1].match(/M/g) ?? []).length, 0);
  const rules = /class="alane-pdiv" d="([^"]*)"/.exec(html);
  return { groups: groups.map((g) => ({ cls: g[1], pass: +g[2], marks: marks(g[3]), body: g[3] })), marks: marks(html), rules: rules ? rules[1].match(/M/g).length : 0, html };
};
const passesOf = (i) => passes.filter((e) => e.section === i);
const contentOf = (e, id) => (id === 'drums' ? e.drums.hits.length : e.parts.find((p) => p.id === id).notes.length);
check('each clip draws every note or hit of each pass it spans (songPasses), a group a pass, a rule between passes', secs.every((sec, i) => LANE_ROWS.every((id) => {
  const d = drawnOf(cell(id, i)), ps = passesOf(i);
  return d.groups.length === sec.passes && d.rules === sec.passes - 1 && d.groups.every((g, k) => g.marks === contentOf(ps[k], id)) && d.marks === ps.reduce((a, e) => a + contentOf(e, id), 0)
    && cell(id, i).dataset.marks === String(d.marks);
})));
const fillSec = secs.findIndex((s) => s.fillBefore && s.passes > 1);
const fd = fillSec >= 0 ? drawnOf(cell('drums', fillSec)) : null, fps = fillSec >= 0 ? passesOf(fillSec) : [];
check('the fill pass draws its own drums (the fill bar\'s; a drumless section\'s the fill alone, sounding), marked, unlike the section\'s other passes', fillSec >= 0 && fd.groups[fd.groups.length - 1].cls.includes('fill')
  && fd.groups[0].body !== fd.groups[fd.groups.length - 1].body && !fd.groups[fd.groups.length - 1].cls.includes('mute') && fd.groups[0].cls.includes('mute') === !secs[fillSec].parts.drums
  && J(fps[fps.length - 1].drums.hits) !== J(fps[0].drums.hits) && !!q(cell('drums', fillSec), '.alane-clip-tag'), `${fillSec}`);
const ysOf = (id) => secs.flatMap((_, i) => [...drawnOf(cell(id, i)).html.matchAll(/<path class="alane-n" d="([^"]*)"/g)].flatMap((m) => [...m[1].matchAll(/M[\d.]+ ([\d.]+)H/g)].map((y) => +y[1])));
const homeSec = passes[homeAt].section, peakSec = secs.findIndex((s) => s.kind === 'peak');
check('a part\'s register reads the same in every clip: one pitch range over the song (its lowest and highest notes at the same height in any clip)', ['bass', 'chords', 'lead'].every((id) => {
  const ys = ysOf(id); return ys.length > 0 && Math.min(...ys) === 12 && Math.max(...ys) === 88;
}) && drawnOf(cell('chords', homeSec)).groups[0].body === drawnOf(cell('chords', peakSec)).groups[0].body);
const offAt = secs.findIndex((s) => !s.parts.lead);
const offClip = offAt >= 0 ? cell('lead', offAt) : null, od = offClip ? drawnOf(offClip) : null;
check('a clip whose part is off in its section: present, outlined and dim (its passes ghosted), still clickable', !!offClip && offClip.classList.contains('off') && !offClip.classList.contains('on') && !offClip.disabled
  && od.groups.every((g) => g.cls.includes('mute')) && od.marks > 0 && /\.alane-clip\.off \{[^}]*dashed/.test(laneCss) && /\.alane-clip\.off \.alane-notes \{ opacity/.test(laneCss), `${offAt}`);
const rulers = [...qa(left, '.alane-ruler')], ruler = rulers[0], totalPasses = secs.reduce((a, s) => a + s.passes, 0);
const tickD = (cls) => (new RegExp(`class="${cls}" d="([^"]*)"`).exec(q(ruler, '.alane-ticks').innerHTML)?.[1].match(/M/g) ?? []).length;
const bands = [...qa(ruler, '.alane-ruler-sec')];
check('the ruler: one element across the track, a band a section in its kind\'s colour, a tick a section and a pass, the time from 0 s', rulers.length === 1 && bands.length === secs.length
  && bands.every((b, i) => b.style['--alane-kind'] === KIND_COLORS[secs[i].kind] && b.dataset.section === String(i)) && tickD('alane-tick-sec') === secs.length - 1 && tickD('alane-tick-pass') === totalPasses - secs.length
  && /^0(:00| s)$/.test(q(ruler, '.alane-ruler-label').textContent) && ruler.dataset.passes === String(totalPasses));
let from = 0;
check('…its bands on the one mapping (timeline): a section from its first pass to its last, as shares of the song', bands.every((b, i) => { const ok = Math.abs(parseFloat(b.style.left) - (100 * from) / totalPasses) < 1e-9 && Math.abs(parseFloat(b.style.width) - (100 * secs[i].passes) / totalPasses) < 1e-9; from += secs[i].passes; return ok; })
  && timeline(totalPasses).fromX(timeline(totalPasses).toX(2.5)) === 2.5);
await tab.press(); await settle();   // Perform (Song)
fake.pass = passes.findIndex((e) => e.section === 2);
bridge.showTab();
dom.raf.flush(3);
check('the sounding section lit while Song plays (frame())', [...qa(left, '.alane-col')].every((c, i) => c.classList.contains('now') === (i === 2)) && cell('chords', 2).classList.contains('now') && !cell('chords', 1).classList.contains('now'));
const pos = core.songPosition(), ph = q(left, '.alane-playhead');
check('the playhead over the track at songPosition(): the song\'s pass + the share of it played (the player\'s playhead)', pos && pos.at === fake.pass + 0.25 && pos.section === 2 && pos.passes === total()
  && ph.style.display === 'block' && ph.style.left === `${((100 * (fake.pass + 0.25)) / total()).toFixed(3)}%`, J(pos));
// the clean plot, in Song (playing)
const cleanBtn = q(left, '.ctab-cleanplot'), washes = () => ctx2d.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle' && /^rgba?\(16, 16, 16/.test(c[2])).map((c) => c[2]);
const stateNow = () => J({ arr: A(), undo: S().undo.length, redo: S().redo?.length ?? 0, edits: core.editsExport(), exp: core.exportJSON() });
const before = stateNow(), specBefore = S().spec, playsBeforeClean = plays.length;
ctx2d.calls.length = 0;
await click(cleanBtn);
const w1 = washes();
check('the clean plot (beside Details): the plot under the Composer\'s notes fully hidden (an opaque wash), kept as a view preference', !!cleanBtn && cleanBtn.nextSibling === q(left, '.ctab-midi') && tab.view.clean === true && cleanBtn.classList.contains('on')
  && w1.length > 0 && w1.every((c) => c === 'rgb(16, 16, 16)') && stored['lrc.composer.cleanPlot'] === '1', J(w1));
check('…and it moves nothing: the song, the undo stack, the edits, the export and the play are as they were', stateNow() === before && S().spec === specBefore && plays.length === playsBeforeClean);
ctx2d.calls.length = 0;
await click(cleanBtn);
check('…off again: the plot\'s usual wash (the row under the notes)', tab.view.clean === false && washes().length > 0 && washes().every((c) => c === 'rgba(16, 16, 16, 0.62)') && stored['lrc.composer.cleanPlot'] === '0' && stateNow() === before);

// ── Song seek and section start ──
console.log('\n— Song seek and section start: the ruler clicks anywhere, a section head double-clicks');
{
  const n = total(), tl = timeline(n), rulerEl = () => q(left, '.alane-ruler'), T4 = S().spec.knobs.cycleSeconds, bars = S().spec.timeline.barStarts;
  const exp0 = J({ arr: A(), undo: S().undo.length, edits: core.editsExport(), exp: core.exportJSON() });
  /** a click on the ruler at song position `at` (passes): its clientX on the ruler's box (the stub's: 0..100 px) */
  const rulerClick = async (at, extra = {}) => { dom.fire(rulerEl(), 'click', { clientX: 100 * tl.toX(at), detail: 1, ...extra }); await settle(); };
  const nameDbl = async (i) => { dom.fire([...qa(left, '.alane-name')][i], 'click', { detail: 1 }); await settle(); dom.fire([...qa(left, '.alane-name')][i], 'click', { detail: 2 }); await settle(); };
  const firstOf = (i) => passes.findIndex((e) => e.section === i);
  const brk = secs.findIndex((s) => s.kind === 'break'), idx = firstOf(brk) + (secs[brk].passes > 1 ? 1 : 0);
  // a bar's downbeat inside the pass: 0.6 of the way through it falls in bar ⌊0.6·bars⌋
  const barAt = (within) => bars.reduce((b, x) => (x <= within + 1e-9 && x > b ? x : b), 0);
  check(`the setting: Song plays (8:7:6:5, ${bars.length} bars a ${T4} s pass), no cue yet; the ruler takes a click (its title says so)`, S().status === 'playing' && A().mode === 'song' && core.songCue() === null && bars.length >= 2 && /click: play from the bar/.test(rulerEl().title));
  let n0 = plays.length;
  await rulerClick(idx + 0.6);
  const c1 = core.songCue(), p1 = lastPlay();
  check(`a click on the ruler while playing: a jump (a new play, the player playing: its cut) to the bar the click falls in — pass ${idx} (the ${secs[brk].name}), ${barAt(0.6 * T4)} s in`, plays.length === n0 + 1 && p1.was === true && p1.args === 4
    && p1.start.pass === idx && p1.start.offset === barAt(0.6 * T4) && c1 && c1.index === idx && c1.section === brk && c1.offset === barAt(0.6 * T4) && Math.abs(c1.at - (idx + barAt(0.6 * T4) / T4)) < 1e-12, J([p1.start, c1]));
  check('…the getters the same song: the play is the song from that pass on (pass c → the song\'s pass c mod its length)', p1.spec === S().spec && alike(p1.gp(idx), passes[idx].parts) && alike(p1.gp(idx + 1), passes[(idx + 1) % n].parts) && alike(p1.gd(idx), passes[idx].drums));
  n0 = plays.length;
  await rulerClick(idx + 0.6, { shiftKey: true });
  check('shift-click: the exact point (no snap)', plays.length === n0 + 1 && lastPlay().start.pass === idx && Math.abs(lastPlay().start.offset - 0.6 * T4) < 1e-9 && Math.abs(core.songCue().at - (idx + 0.6)) < 1e-9, J(lastPlay().start));
  n0 = plays.length;
  await rulerClick(0.3, { detail: 2 });
  check('the second click of a double click on the ruler is let go (one jump, not two restarts)', plays.length === n0 && core.songCue().index === idx);
  await rulerClick(0.3);
  check('a click in the first bar of the song: the top — the cue dropped, the play from the top (pass 0, 0 s)', core.songCue() === null && lastPlay().start === undefined && lastPlay().args === 3);
  await rulerClick(n);
  check('a click at the ruler\'s very end: the last pass\'s last bar', core.songCue().index === n - 1 && core.songCue().offset === barAt(T4));
  // stopped: the cue waits; the playhead at it, dashed; Perform from it; Stop leaves it
  await rulerClick(idx + 0.6);
  core.stop(); await settle();
  bridge.showTab(); dom.raf.flush(2);
  const cueEl = q(left, '.alane-cue'), phEl = q(left, '.alane-playhead'), cueX = `${(100 * tl.toX(core.songCue().at)).toFixed(3)}%`;
  check('stopped: the cue kept (Stop leaves it); its flag on the ruler and the playhead waiting at it, dashed (.cued)', core.songCue()?.index === idx && !!cueEl && cueEl.parentNode === rulerEl() && cueEl.style.display === 'block' && cueEl.style.left === cueX
    && phEl.style.display === 'block' && phEl.style.left === cueX && phEl.classList.contains('cued'), J([cueEl?.style.left, phEl?.style.left, cueX]));
  check('…the cue is no undo step and not in the export (transport, not the song)', J({ arr: A(), undo: S().undo.length, edits: core.editsExport(), exp: core.exportJSON() }) === exp0);
  await tab.press(); await settle();   // Perform
  check('Perform starts from the cue', S().status === 'playing' && lastPlay().was === false && lastPlay().start.pass === idx && lastPlay().start.offset === barAt(0.6 * T4));
  dom.raf.flush(2);
  check('…playing, the playhead is the sounding place again (not .cued); the cue\'s flag stays where Perform began', !q(left, '.alane-playhead').classList.contains('cued') && q(left, '.alane-cue').style.display === 'block');
  // the section heads: a double-click
  core.stop(); await settle();
  const pk = secs.findIndex((s) => s.kind === 'peak'), sel0 = tab.view.songSection;
  n0 = plays.length;
  await click([...qa(left, '.alane-name')][pk]);
  check('a single click on a section\'s name still only selects it (no cue moved, nothing played)', tab.view.songSection === pk && core.songCue().index === idx && plays.length === n0);
  await nameDbl(brk);
  check(`a double-click on a section's name (stopped): the cue at its first pass exactly (pass ${firstOf(brk)}, 0 s), the section selected, nothing played`, tab.view.songSection === brk && core.songCue().index === firstOf(brk) && core.songCue().offset === 0
    && core.songCue().section === brk && core.songCue().passInSection === 0 && plays.length === n0 && q(left, '.alane-cue').style.left === `${(100 * tl.toX(firstOf(brk))).toFixed(3)}%`);
  await tab.press(); await settle();
  check('…Perform starts there', lastPlay().start.pass === firstOf(brk) && lastPlay().start.offset === 0 && lastPlay().was === false);
  n0 = plays.length;
  await nameDbl(pk);
  check('playing, a double-click jumps to the section (one new play, its first pass)', plays.length === n0 + 1 && lastPlay().was === true && lastPlay().start.pass === firstOf(pk) && lastPlay().start.offset === 0);
  // the cue rides with its section: a pass more before it moves it on
  if (pk > 0) {
    await click([...qa(left, '.alane-col')][0].querySelectorAll('.alane-nudge')[1]);
    check('a pass more in an earlier section: the cue moves with its section (still its first pass)', core.songCue().section === pk && core.songCue().index === firstOf(pk) + 1);
    await core.undo(); await settle();
    passes = songPasses(A().song, loopNow(), mats);
  }
  // Loop is untouched
  n0 = plays.length;
  await click(modeBtn('Loop'));
  const rl = core.cueSong(1), rs = core.cueSection(0);
  check('Loop while playing carries on (no new play); a cue in Loop is refused with words; the song\'s cue kept', plays.length === n0 && !rl.ok && /song/.test(rl.error) && !rs.ok && core.songCue()?.index === firstOf(pk));
  core.stop(); await settle();
  await tab.press(); await settle();
  check('Loop\'s Perform: from its top, the player handed no start (as before)', lastPlay().args === 3 && lastPlay().start === undefined && same(lastPlay().gp(firstOf(pk)), cur()));
  n0 = plays.length;
  await click(modeBtn('Song'));
  check('Song again while playing: a clean restart, from the cue (Loop ⇄ Song keeps it)', plays.length === n0 + 1 && lastPlay().start?.pass === firstOf(pk));
  // a new song drops it
  const r = core.replan(); await settle();
  check('a re-plan (a new song) drops the cue, and plays it from the top', r.ok && core.songCue() === null && lastPlay().args === 3);
  await core.undo(); await settle();
  check('…its undo brings the song back, not the cue', J(A().song) === J(want) && core.songCue() === null && S().undo.length === 0);
  check('…and nothing of the cue was ever an undo step or exported', J({ arr: A(), undo: S().undo.length, edits: core.editsExport(), exp: core.exportJSON() }) === exp0);
  passes = songPasses(A().song, loopNow(), mats);
}

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
check('…the loop\'s matrix back (no ctab-song-on), as it was', !left.classList.contains('ctab-song-on') && qa(left, '.ctab-lane').length === 6);
const loopBefore = J({ arr: A(), undo: S().undo.length, exp: core.exportJSON() });
ctx2d.calls.length = 0;
await click(q(left, '.ctab-cleanplot'));
const wLoop = ctx2d.calls.filter((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === 'rgb(16, 16, 16)').length;
await click(q(left, '.ctab-cleanplot'));
check('the clean plot in Loop too, and nothing moved', wLoop > 0 && tab.view.clean === false && J({ arr: A(), undo: S().undo.length, exp: core.exportJSON() }) === loopBefore);
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
setRhythm([6, 5, 4, 0], 3); tab.syncRhythm(); await settle();   // a row of its own (5:4 is refused)
await click(modeBtn('Song'));
const songFirst = { song: A().song, undo: S().undo.length };
await tab.press(); await settle();   // Compose, in Song
check('Song before Compose: the song is planned as the Compose lands (no Perform needed), no undo step; the lane shows it', songFirst.song === null && S().status === 'ready' && !!A().song
  && J(A().song) === J(planSong(loopNow(), materialsOf(S().composed), { template: A().template, seed: A().seed })) && S().undo.length === 0 && qa(left, '.alane-clip').length > 0 && !fake.playing);
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
