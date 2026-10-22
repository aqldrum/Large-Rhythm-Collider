// assert-page-highlights.mjs — the Composer tab's plot seam (Composer/page/plot-highlights.js, plot-overlay.js), in
// Node, against the site's own composite rhythm (LRCModule.js, loaded in a vm) on rows from 8:7:6:5 to 16,359 onsets:
//   • every highlighted index is a real onset of the plotted rhythm (its tick), and the note's own node; a set a part
//   • the drums light the onsets their strokes land on; a part off is kept but marked; a spec of another rhythm → null
//   • the playhead: spec time → the onset at or before it and the way into its gap; at a note's time it is on that
//     note's node; it walks forward through the cycle and wraps; its x steps evenly between dots
//   • what sounds at a moment: each note from its time to its end (wrapping), each stroke briefly
//   • the overlay: a wash, a dot a lit node at its plotted position, the selected part ringed; a snapshot, then a frame
//     is one blit and the playhead — no node of the row redrawn — and it costs the same on the 16k row
//   node Composer/tests/assert-page-highlights.mjs
import { compose } from '../core/compose.js';
import { arrangeDrums } from '../core/drums.js';
import { highlightsOf, plotOf, playheadAt, playheadX, soundingAt, indexOfTick, nodeAtOrBefore, matchesPlot, HIGHLIGHT_PARTS, PART_COLORS, MIN_LIT_SECONDS, DRUM_LIT_SECONDS } from '../page/plot-highlights.js';
import { createPlotOverlay } from '../page/plot-overlay.js';
import { recordingContext } from './dom-stub.mjs';
import { siteRhythm } from './site-scripts.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

console.log('Composer tab — the plot seam');
const CASES = [
  { site: [8, 7, 6, 5], T: 4 }, { site: [41, 42, 43, 1], T: 8 }, { site: [19, 17, 16, 15], T: 6 }, { site: [768, 769, 1, 1], T: 8 },
  { site: [4099, 4093, 4091, 4079], T: 16 },
];
const fakePositions = (n) => Array.from({ length: n }, (_, i) => ({ x: 40 + (i * 720) / Math.max(1, n - 1), y: 100 + (i % 7), index: i }));

for (const { site, T } of CASES) {
  const r = siteRhythm(site), plot = plotOf(r), layers = site.map((v) => (v > 1 ? v : 0));
  const spec = compose(layers, T, { seed: 1 });
  console.log(`\n— ${site.join(':')} (${r.compositeRhythm.length.toLocaleString()} onsets on the site's plot)`);
  check('the spec is of the plotted rhythm (same grid and onsets)', matchesPlot(spec, plot));
  const t0 = performance.now(), h = highlightsOf({ spec }, plot), ms = performance.now() - t0;
  check(`a lit-node set for each of ${HIGHLIGHT_PARTS.join(', ')} (${ms.toFixed(1)} ms)`, h && HIGHLIGHT_PARTS.every((id) => h.parts[id] && h.parts[id].color === PART_COLORS[id]));
  check(`nothing missed: every note and stroke (${h.total}) is a plotted onset`, h.missed === 0 && h.total === spec.parts.reduce((n, p) => n + p.notes.length, 0) + spec.drums.hits.length);
  let bad = '';
  for (const p of spec.parts) {
    const lit = h.parts[p.id], want = [...new Set(p.notes.map((n) => n.node))].sort((a, b) => a - b);
    if (lit.indices.join() !== want.join()) bad ||= `${p.id}: indices are not the notes' nodes`;
    for (const n of p.notes) {
      const i = indexOfTick(plot.ticks, n.tick);
      if (i !== n.node || plot.ticks[i] !== n.tick) bad ||= `${p.id}: node ${n.node} is not the plotted onset at tick ${n.tick}`;
    }
    if (lit.notes.length !== p.notes.length) bad ||= `${p.id}: ${lit.notes.length} lit notes for ${p.notes.length}`;
  }
  check('each part\'s indices are exactly its notes\' nodes, and each node is the site\'s onset at the note\'s tick', !bad, bad);
  const dl = h.parts.drums, strokeOk = spec.drums.hits.every((x) => plot.ticks[indexOfTick(plot.ticks, x.tick)] === x.tick);
  check(`the drums light their strokes' onsets (${dl.indices.length} nodes for ${spec.drums.hits.length} strokes)`, strokeOk && dl.indices.length > 0 && dl.indices.every((i) => i >= 0 && i < plot.n));
  check('indices are sorted, unique and in range', HIGHLIGHT_PARTS.every((id) => h.parts[id].indices.every((v, k, a) => v >= 0 && v < plot.n && (k === 0 || a[k - 1] < v))));

  // the playhead
  let phBad = '';
  for (const p of spec.parts) for (const n of p.notes) {
    const ph = playheadAt(plot, h.phaseX, n.time / T);
    if (ph.index !== n.node || ph.frac > 1e-6) { phBad ||= `${p.id} note at ${n.time.toFixed(4)} s: playhead on ${ph.index} (+${ph.frac.toFixed(3)}), the note's node ${n.node}`; }
  }
  check('at every note\'s time the playhead is on that note\'s node, at the start of its gap', !phBad, phBad);
  const steps = 997, seen = [];
  let back = 0;
  for (let k = 0; k < steps; k++) { const ph = playheadAt(plot, h.phaseX, k / steps); seen.push(ph.index + ph.frac); }
  for (let k = 1; k < steps; k++) if (seen[k] < seen[k - 1]) back++;
  check(`through the cycle the playhead moves forward, wrapping once at the cycle's start (${back} wrap${back === 1 ? '' : 's'})`, back <= 1 && seen.every((v) => v >= 0 && v < plot.n));
  const p0 = playheadAt(plot, h.phaseX, 0), p1 = playheadAt(plot, h.phaseX, 1);
  check('spec time 0 is the downbeat (the phase onset), and 1 is 0 again', p0.index === p1.index && near(p0.tick, h.phaseX * plot.grid, plot.grid * 1e-12) && plot.ticks[p0.index] === Math.round(h.phaseX * plot.grid) && p0.frac < 1e-9);
  const pos = fakePositions(plot.n), mid = { index: 3, frac: 0.5 };
  check('the playhead\'s x is between its dot and the next, by frac; the last gap holds at the last dot', near(playheadX(pos, mid), (pos[3].x + pos[4].x) / 2) && playheadX(pos, { index: plot.n - 1, frac: 0.7 }) === pos[plot.n - 1].x);

  // what sounds
  const lead = spec.parts.find((p) => p.id === 'lead'), ln = lead.notes[Math.floor(lead.notes.length / 2)];
  const at = soundingAt(h, ln.time + 1e-6);
  check('at a lead note\'s time its node sounds', at.some((x) => x.part === 'lead' && x.index === ln.node));
  const hit = spec.drums.hits[0];
  check(`a drum stroke lights for ${DRUM_LIT_SECONDS} s, then not`, soundingAt(h, hit.time + 0.01).some((x) => x.part === 'drums' && x.index === indexOfTick(plot.ticks, hit.tick))
    && !soundingAt(h, hit.time + DRUM_LIT_SECONDS + 0.01).some((x) => x.part === 'drums' && x.index === indexOfTick(plot.ticks, hit.tick) && !spec.drums.hits.some((y) => y !== hit && y.tick === hit.tick)));
  const wrap = h.parts.lead.notes.find((n) => n.end > T) || h.parts.bass.notes.find((n) => n.end > T) || h.parts.chords.notes.find((n) => n.end > T);
  if (wrap) check('a note held past the loop\'s end still sounds at the start of the next cycle', soundingAt(h, (wrap.end - T) / 2).some((x) => x.index === wrap.index));
  check(`a short note glows at least ${MIN_LIT_SECONDS} s`, Object.values(h.parts).every((p) => p.notes.every((n) => n.end - n.time >= Math.min(MIN_LIT_SECONDS, DRUM_LIT_SECONDS) - 1e-12)));
}

console.log('\n— the parts and drums as they play now; a stale or refused spec');
{
  const r = siteRhythm([41, 42, 43, 1]), plot = plotOf(r), spec = compose([41, 42, 43, 0], 8, { seed: 1 });
  const parts = spec.parts.map((p) => (p.id === 'bass' ? { ...p, enabled: false } : p));
  const drums = arrangeDrums(spec, { mode: 'with' }), h = highlightsOf({ spec, parts, drums }, plot);
  check('a part switched off keeps its nodes, marked off', h.parts.bass.enabled === false && h.parts.bass.indices.length > 0 && h.parts.lead.enabled === true);
  check('the drums as they play now (a re-arrangement) are the ones lit', h.parts.drums.notes.length === drums.hits.length && drums.hits.length !== spec.drums.hits.length);
  check('drums off: lit but marked off', highlightsOf({ spec, drums: { ...drums, enabled: false } }, plot).parts.drums.enabled === false);
  const other = plotOf(siteRhythm([8, 7, 6, 5]));
  check('a spec of another rhythm lights nothing (null)', highlightsOf({ spec }, other) === null && !matchesPlot(spec, other));
  check('a refusal, no spec, or no plot lights nothing', highlightsOf({ spec: compose([7, 0, 0, 0], 4) }, plotOf(siteRhythm([7, 1, 1, 1]))) === null && highlightsOf({ spec: null }, plot) === null && highlightsOf({ spec }, null) === null && plotOf({}) === null);
  check('nodeAtOrBefore: exact onsets, between them, past the last', nodeAtOrBefore(plot.ticks, plot.ticks[5]) === 5 && nodeAtOrBefore(plot.ticks, plot.ticks[5] + 0.5) === 5 && nodeAtOrBefore(plot.ticks, plot.grid - 0.1) === plot.n - 1);
}

console.log('\n— the overlay on a recording canvas');
for (const site of [[41, 42, 43, 1], [4099, 4093, 4091, 4079]]) {
  const r = siteRhythm(site), plot = plotOf(r), layers = site.map((v) => (v > 1 ? v : 0)), spec = compose(layers, site[0] > 1000 ? 16 : 8, { seed: 1 });
  const h = highlightsOf({ spec }, plot), positions = fakePositions(plot.n);
  const canvas = { width: 1600, height: 800 }, ctx = recordingContext(canvas), snapCanvas = { width: 0, height: 0, ctx: recordingContext(null), getContext() { return this.ctx; } };
  let selected = 'chords';
  const overlay = createPlotOverlay({ getHighlights: () => h, getSelected: () => selected, makeCanvas: () => snapCanvas });
  const view = { positions, width: 800, height: 400, dotSize: 4, canvas, button: { x: 762, y: 362, width: 28, height: 28 }, animating: false };
  overlay.draw(ctx, view);
  const calls = ctx.calls, arcs = calls.filter((c) => c[0] === 'arc'), rects = calls.filter((c) => c[0] === 'rect');
  const litDots = HIGHLIGHT_PARTS.filter((id) => id !== 'drums').reduce((n, id) => n + h.parts[id].indices.length, 0);
  console.log(`  ${site.join(':')}: ${plot.n.toLocaleString()} onsets, ${litDots} lit dots, ${h.parts.drums.indices.length} lit drum nodes`);
  check('a wash over the plot first, with the invert button left clear (even-odd)', calls.findIndex((c) => c[0] === 'fill' && c[1] === 'evenodd') >= 0 && rects[0][1] === 0 && rects[1][1] === 762);
  const arcAt = new Set(arcs.map((c) => `${c[1].toFixed(3)},${c[2].toFixed(3)}`));
  const missingDot = HIGHLIGHT_PARTS.filter((id) => id !== 'drums').flatMap((id) => h.parts[id].indices).find((i) => !arcAt.has(`${positions[i].x.toFixed(3)},${positions[i].y.toFixed(3)}`));
  check('every lit node is a dot at its plotted position (one path a part)', missingDot === undefined, `node ${missingDot}`);
  check('the drums are squares on their nodes', rects.length - 2 === h.parts.drums.indices.length);
  const ringed = h.parts.chords.indices.length;
  check(`the selected part (chords) is ringed: ${ringed} rings, drawn last`, arcs.length === litDots + ringed && calls.filter((c) => c[0] === 'stroke').length === 1);
  check('no dot of the row is drawn: only the lit ones', arcs.length < plot.n + 1 || plot.n < 200);
  check('then a snapshot of the canvas', snapCanvas.width === 1600 && snapCanvas.height === 800 && snapCanvas.ctx.calls.some((c) => c[0] === 'drawImage' && c[1] === canvas) && overlay.snapshotted);
  const before = ctx.calls.length;
  overlay.frame({ p: 0.25, t: 0.25 * spec.knobs.cycleSeconds });
  const frameCalls = ctx.calls.slice(before);
  check('a frame: the snapshot back in one blit (identity transform), then the playhead line', frameCalls[0][0] === 'save' && frameCalls[1][0] === 'setTransform' && frameCalls[2][0] === 'drawImage' && frameCalls[2][1] === snapCanvas && frameCalls.some((c) => c[0] === 'lineTo'));
  check(`a frame draws a few marks, not the row (${frameCalls.filter((c) => c[0] === 'arc').length} arcs)`, frameCalls.filter((c) => c[0] === 'arc').length <= 2 + 2 * (HIGHLIGHT_PARTS.length + 6));
  const b2 = ctx.calls.length;
  overlay.frame(null);
  check('frame(null) clears the playhead: the snapshot alone', ctx.calls.slice(b2).filter((c) => c[0] === 'drawImage').length === 1 && !ctx.calls.slice(b2).some((c) => c[0] === 'lineTo'));
  overlay.draw(ctx, { ...view, animating: true });
  check('while the main page animates its lights: drawn, but no snapshot (and frames do nothing)', !overlay.snapshotted && overlay.frame({ p: 0.1, t: 0.1 }) === false);
  selected = 'lead';
  const off = createPlotOverlay({ getHighlights: () => null, makeCanvas: () => snapCanvas }), c2 = recordingContext(canvas);
  off.draw(c2, view);
  check('nothing lit (a stale spec): the overlay draws nothing at all', c2.calls.length === 0 && off.frame({ p: 0, t: 0 }) === false);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
