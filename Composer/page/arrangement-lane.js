// arrangement-lane.js — Song v0's lane in the Composer window (ARRANGEMENT_ORDER.md phase C2, S15; DESIGN_NOTES "Song v0
// (phase C)", then "Song UI (visual pass)"), in place of the matrix while Song is on. A view of the shared controller's
// song (core.songState(), core.songClips()), as the matrix is of the loop: every click is one of the controller's section
// edits, one undo step each (the window's ↶ ↷). The visual pass (Avery's first browser pass: the song was squashed under
// the loop's cells) made it a DAW-like clip timeline; nothing it does plans, plays or stores anything new.
//
//   bar        "Song", the template select (Arch | Build–drop: planned again at the same seed), Re-plan (the same template
//              at a new seed), the seed, the song's length; "stale: re-plan" (amber) when the loop changed under the song
//              (a click plans it again at its own seed); a song this loop can't play, or an edit refused, said in words
//   the track  every column a section, its width EXACTLY ∝ its passes (minmax(0, N fr), no gap, the rows one min width:
//              PX a pass, the largest of MIN_PASS_PX, MIN_SECOND_PX a second of the cycle and MIN_SECTION_PX over the
//              shortest section; past it the lane scrolls sideways, the row heads sticky), so one mapping (timeline()) takes a pass position to x everywhere:
//                ruler     ONE element across the columns: the sections' kind-coloured bands (their names are the heads
//                          just under it, so they aren't said twice), a tick a section, a pass and a bar, and the time
//                          in seconds at the playing tempo; later, click / drag to seek attaches here (timeline().fromX)
//                energy    a slim band under the ruler: each section's energy (form.js energyOf on the loop as it plays:
//                          solid) and its target (dotted), on one scale; a column draws its own step and the join from
//                          the one before, so the line is continuous whatever the widths
//                head      the name (a click selects the section: the strip below), "−  N  +" passes, "→ fill" before a
//                          peak or drop, a dot when edited; the sounding section lit while Song plays (frame())
//                clips     a clip a section × part (`.alane-clip`, data-section, data-part: selection, copy and paste
//                          attach to these later), the notes of every pass it spans drawn tiled (core.songClips(): what
//                          the player gets), a faint rule at each pass: pitched parts as note bars, x the time in the
//                          pass, y the pitch within the part's own range over the whole song (so a register reads the
//                          same in every clip); the drums as ticks in five voice rows (kick, snare, hat, perc, cym), the
//                          fill pass its own. A pass whose part doesn't sound is drawn ghosted; a clip whose part the
//                          section has off is outlined, dim, and still a click toggles it; a part off in the loop is
//                          hatched and can't be turned on. The density word, where it differs from the loop's, a label
//                Layers    the row's layers as chips (A B C D), each in or out of the section (a click toggles)
//                playhead  a line over the track at songPosition() (the song's pass + its share), moved every frame
//   the strip  the selected section: its kind, energy against its target, passes, the planner's why; a density select for
//              the bass, the comp, the lead and the inner (the loop's own marked), each one undo step
// PURE half: laneModel(songState, { selected, cycleSeconds }) → the lane as data; energyCell(col, prev, scale) → its SVG's
// text; timeline(passes) the one mapping; rulerModel(m, …) → the ruler as data; pitchRanges(clips); clipSvg(…) → a clip's
// SVG text and its count. The DOM half createArrangementLane({ doc, core, view, edit, rerender }) → { root, render(), frame() }.

import { PART_LABELS, PART_COLORS } from './plot-highlights.js';

export const LANE_VERSION = 'composer-lane-v2';
/** the lane's rows, top to bottom (the matrix's order) */
export const LANE_PARTS = Object.freeze(['lead', 'chords', 'comp', 'bass', 'inner', 'drums']);
/** a section's kind, coloured from the window's palette (the layers' and the parts' hues; home the accent) */
export const KIND_COLORS = Object.freeze({ intro: '#4ecdc4', build: '#f9ca24', peak: '#ff6b6b', break: '#a29bfe', drop: '#ff9f43', home: '#00ff88' });
/** the densities in the window's words */
export const DENSITY_LABELS = Object.freeze({
  bass: Object.freeze({ roots: 'Roots', sparse: 'Sparse', moving: 'Moving', walking: 'Walking' }),
  comp: Object.freeze({ sparse: 'Sparse', 'sparse-med': 'Sparse–Med', medium: 'Medium', dense: 'Dense' }),
  lead: Object.freeze({ line: 'Line', arp: 'Arp' }),
  inner: Object.freeze({ line: 'Line', arp: 'Arp' }),
});
export const DENSITY_ROWS = Object.freeze(['bass', 'comp', 'lead', 'inner']);
/** the drum clip's voice rows, top to bottom (the matrix's ticks' order), and their hues (the matrix's) */
export const DRUM_ROWS = Object.freeze(['kick', 'snare', 'hat', 'perc', 'cym']);
export const DRUM_COLORS = Object.freeze({ kick: '#ff6b6b', snare: '#f9ca24', hat: '#aaa', perc: '#4ecdc4', cym: '#fff' });
/** the track's scale: a pass at least MIN_PASS_PX, and MIN_SECOND_PX a second of the cycle (at the spec's tempo, so a
 *  tempo change doesn't move the layout: the notes stay readable), the shortest section at least MIN_SECTION_PX (its
 *  head's controls fit) */
export const MIN_PASS_PX = 36, MIN_SECOND_PX = 8, MIN_SECTION_PX = 76;
/** kept for callers of phase C: a section's floor */
export const MIN_COLUMN_PX = MIN_SECTION_PX;
/** the row heads' width (px; the CSS's --alane-head) and the gap after them */
export const HEAD_PX = 84, HEAD_GAP_PX = 6;
/** a clip's SVG units: a pass PASS_UNITS wide, the clip CLIP_UNITS tall (preserveAspectRatio none, strokes unscaled) */
export const PASS_UNITS = 1000, CLIP_UNITS = 100;
const fmt = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(2));
const densityName = (part, v) => DENSITY_LABELS[part]?.[v] ?? String(v);
const num = (x) => String(Math.round(x * 10) / 10);

/**
 * The lane as data, from core.songState(): null with no song. → { template, templates, seed, stale, error, total (the
 * song's passes), seconds (its length at the playing tempo), scale (the energy line's top), columns: [{ index, name,
 * kind, color, passes, fillBefore, edited, energy, target, why, selected, sounding, from (its first pass in the song) }],
 * rows: [{ id, label, color, loopOn, clips: [{ section, on, can, density, title, selected }] }], layers: [{ section, chips:
 * [{ index, name, value, on, title }] }], selected, cols (the columns' template), pxPerPass, minWidth (the rows', px) };
 * passSeconds the cycle at the spec's tempo (the track's scale)
 */
export function laneModel(ss, { selected = 0, cycleSeconds = null, passSeconds = null } = {}) {
  if (!ss?.song) return null;
  const S = ss.song.sections, at = ss.at, sel = Math.max(0, Math.min(S.length - 1, selected | 0));
  const energies = S.map((s, i) => ss.energies?.[i] ?? s.energy);
  const scale = Math.max(1.2, ...energies.filter(Number.isFinite), ...S.map((s) => s.target ?? 0)) * 1.08;
  let from = 0;
  const columns = S.map((s, i) => {
    const c = { index: i, name: s.name, kind: s.kind, color: KIND_COLORS[s.kind] ?? '#888', passes: s.passes, fillBefore: !!s.fillBefore, edited: !!s.edited,
      energy: energies[i], target: s.target, why: s.why ?? '', selected: i === sel, sounding: at?.section === i, from };
    from += s.passes;
    return c;
  });
  const rows = LANE_PARTS.map((id) => {
    const loopOn = ss.loopOn?.[id] !== false;
    return { id, label: PART_LABELS[id], color: PART_COLORS[id], loopOn, clips: S.map((s, i) => {
      const on = !!s.parts[id] && loopOn, d = s.density?.[id];
      const density = on && d != null && d !== ss.own?.[id] ? densityName(id, d) : null;
      const title = !loopOn ? `${PART_LABELS[id]} is off in the loop: it plays in no section (turn it on in Loop)`
        : `${s.name}: ${PART_LABELS[id]} ${on ? 'on' : 'off'}${density ? `, ${density} (the loop plays ${densityName(id, ss.own[id])})` : ''} — a click turns it ${on ? 'off' : 'on'}`;
      return { section: i, on, can: loopOn, density, title, selected: i === sel };
    }) };
  });
  const layers = S.map((s, i) => ({ section: i, chips: (ss.layers ?? []).map((L) => {
    const on = (s.layers & L.mask) !== 0, rank = (ss.song.order ?? []).indexOf(L.index);
    return { index: L.index, name: L.name, value: L.value, on, title: `${s.name}: layer ${L.name}${L.value} ${on ? 'in' : 'out'}${rank >= 0 ? ` (it enters ${ordinal(rank + 1)} in the build order)` : ''} — a click takes it ${on ? 'out' : 'in'}` };
  }) }));
  const total = from, shortest = Math.min(...S.map((s) => s.passes));
  const pxPerPass = Math.max(MIN_PASS_PX, Math.ceil(MIN_SECOND_PX * (passSeconds > 0 ? passSeconds : 0)), Math.ceil(MIN_SECTION_PX / Math.max(1, shortest)));
  return { template: ss.template, templates: ss.templates, seed: ss.seed, stale: !!ss.stale, error: ss.error ?? null, total, seconds: cycleSeconds ? total * cycleSeconds : null, scale, columns, rows, layers,
    selected: sel, cols: S.map((s) => `minmax(0, ${s.passes}fr)`).join(' '), pxPerPass, minWidth: HEAD_PX + HEAD_GAP_PX + total * pxPerPass };
}
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * The track's one mapping (the ruler, the clips, the playhead; a seek attaches to fromX later): a position in the song
 * in passes (0..passes; pass k's start is k, its middle k + ½) ↔ the share of the track's width (0..1). The columns are
 * exactly ∝ passes, so it holds in every row. seconds(at, cycleSeconds) the time there.
 */
export function timeline(passes) {
  const n = Math.max(1, passes);
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  return { passes: n, toX: (at) => clamp(at / n, 1), fromX: (x) => clamp(x * n, n), seconds: (at, cycleSeconds) => clamp(at, n) * cycleSeconds };
}

/** the ruler's time labels: a step from these (seconds) at least RULER_LABEL_PX apart */
const LABEL_STEPS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600];
export const RULER_LABEL_PX = 56, MIN_BAR_TICK_PX = 6;
export const timeLabel = (s, long) => (long ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${num(s)} s`);
/**
 * The ruler as data. m laneModel's; cycleSeconds the cycle at the playing tempo; barStarts the bars' starts (spec seconds
 * in a cycle of specCycle). → { sections: [{ index, x, w, color, name, kind }] (shares of the track), passTicks [x],
 * barTicks [x], sectionTicks [x], labels [{ x, text }] } — every x a share (timeline().toX)
 */
export function rulerModel(m, { cycleSeconds = null, barStarts = [], specCycle = null } = {}) {
  const tl = timeline(m.total);
  const sections = m.columns.map((c) => ({ index: c.index, x: tl.toX(c.from), w: tl.toX(c.from + c.passes) - tl.toX(c.from), color: c.color, name: c.name, kind: c.kind }));
  const sectionTicks = m.columns.map((c) => tl.toX(c.from)).slice(1);
  const starts = new Set(m.columns.map((c) => c.from));
  const passTicks = [], barTicks = [];
  for (let k = 1; k < m.total; k++) if (!starts.has(k)) passTicks.push(tl.toX(k));
  const bars = specCycle > 0 ? barStarts.filter((b) => b > 1e-9 && b < specCycle - 1e-9) : [];
  if (bars.length && m.pxPerPass / (bars.length + 1) >= MIN_BAR_TICK_PX) for (let k = 0; k < m.total; k++) for (const b of bars) barTicks.push(tl.toX(k + b / specCycle));
  const labels = [];
  if (cycleSeconds > 0) {
    const total = m.total * cycleSeconds, perSecond = m.pxPerPass / cycleSeconds, long = total >= 60;
    const step = LABEL_STEPS.find((s) => s * perSecond >= RULER_LABEL_PX) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
    for (let s = 0; s < total - 1e-9; s += step) labels.push({ x: tl.toX(s / cycleSeconds), text: timeLabel(s, long) });
  }
  return { sections, passTicks, barTicks, sectionTicks, labels };
}
/** the ruler's ticks as an SVG's text: x 0..1000 (the track), y 0..24; sections full height, passes 2/3, bars 1/3 */
export function rulerSvg(r) {
  const d = (xs, y0) => xs.map((x) => `M${num(x * 1000)} ${y0}V24`).join('');
  const path = (xs, y0, cls) => (xs.length ? `<path class="${cls}" d="${d(xs, y0)}" vector-effect="non-scaling-stroke"/>` : '');
  return `<svg viewBox="0 0 1000 24" preserveAspectRatio="none" aria-hidden="true">${path(r.barTicks, 18, 'alane-tick-bar')}${path(r.passTicks, 10, 'alane-tick-pass')}${path(r.sectionTicks, 0, 'alane-tick-sec')}</svg>`;
}

/** each pitched part's range over the whole song, in octaves (log2 Hz): { part: [lo, hi] }, from core.songClips() */
export function pitchRanges(clips) {
  const out = {};
  for (const sec of clips?.sections ?? []) for (const p of sec.passes) for (const id of LANE_PARTS) {
    if (id === 'drums') continue;
    const notes = p.parts[id]?.notes;
    if (!notes) continue;
    const r = (out[id] ??= [Infinity, -Infinity]);
    for (const n of notes) { const v = Math.log2(n.hz); if (v < r[0]) r[0] = v; if (v > r[1]) r[1] = v; }
  }
  for (const id of Object.keys(out)) if (!(out[id][1] >= out[id][0])) delete out[id];
  return out;
}

// a pass's marks as a path's d (pass-local: x 0..PASS_UNITS), memoized by the part (or drums) object: passes alike are one
// object (form.js), so a song of five passes of one section draws its path once
const passMemo = new WeakMap();
function passPaths(obj, id, T, range) {
  const key = `${T}|${range ? range.join(',') : ''}`;
  let m = passMemo.get(obj);
  if (m?.key === key) return m;
  const x = (t) => num(Math.max(0, Math.min(PASS_UNITS, (PASS_UNITS * t) / T)));
  if (id === 'drums') {
    const rows = DRUM_ROWS.map(() => []), h = CLIP_UNITS / DRUM_ROWS.length;
    for (const hit of obj.hits ?? []) {
      const i = Math.max(0, DRUM_ROWS.indexOf(hit.voice)), y0 = i * h + h * 0.18, y1 = (i + 1) * h - h * 0.18;
      rows[i].push(`M${x(hit.time)} ${num(y0)}V${num(y1)}`);
    }
    m = { key, paths: rows.map((r, i) => ({ voice: DRUM_ROWS[i], d: r.join('') })), count: obj.hits?.length ?? 0 };
  } else {
    const [lo, hi] = range ?? [0, 0], span = hi - lo;
    const y = (hz) => num(span > 1e-9 ? CLIP_UNITS * (0.88 - (0.76 * (Math.log2(hz) - lo)) / span) : CLIP_UNITS / 2);
    const d = (obj.notes ?? []).map((n) => `M${x(n.time)} ${y(n.hz)}H${x(n.time + (n.duration || 0))}`).join('');
    m = { key, paths: [{ voice: null, d }], count: obj.notes?.length ?? 0 };
  }
  passMemo.set(obj, m);
  return m;
}
/**
 * A clip's SVG: each pass it spans (core.songClips()' passes) tiled, a rule at each pass boundary. id the part ('drums':
 * voice rows), T the cycle (spec seconds), range the part's pitchRanges(). → { html, count (marks drawn: the passes'
 * notes or hits, every one), sounding (passes whose part sounds) }
 */
export function clipSvg(passes, id, T, range) {
  const n = passes.length, W = n * PASS_UNITS;
  let count = 0, sounding = 0, body = '';
  const rules = Array.from({ length: n - 1 }, (_, k) => `M${(k + 1) * PASS_UNITS} 0V${CLIP_UNITS}`).join('');
  const guides = id === 'drums' ? DRUM_ROWS.slice(1).map((_, i) => `M0 ${num(((i + 1) * CLIP_UNITS) / DRUM_ROWS.length)}H${W}`).join('') : '';
  passes.forEach((p, k) => {
    const obj = id === 'drums' ? p.drums : p.parts[id];
    if (!obj) return;
    const on = !!obj.enabled, m = passPaths(obj, id, T, range);
    count += m.count; if (on) sounding++;
    const paths = m.paths.filter((x) => x.d).map((x) => `<path class="alane-n${x.voice ? ` alane-hit ${x.voice}` : ''}" d="${x.d}" vector-effect="non-scaling-stroke"/>`).join('');
    body += `<g class="alane-pass${on ? '' : ' mute'}${p.fill ? ' fill' : ''}" data-pass="${p.index}" transform="translate(${k * PASS_UNITS} 0)">${paths}</g>`;
  });
  const html = `<svg viewBox="0 0 ${W} ${CLIP_UNITS}" preserveAspectRatio="none" aria-hidden="true">${guides ? `<path class="alane-drow" d="${guides}" vector-effect="non-scaling-stroke"/>` : ''}${rules ? `<path class="alane-pdiv" d="${rules}" vector-effect="non-scaling-stroke"/>` : ''}${body}</svg>`;
  return { html, count, sounding };
}

/** a column's energy step (its own and the join from the column before), as an SVG's text: x 0..100, y 0 (top)..40;
 *  the energy solid, the target dotted; preserveAspectRatio none, the strokes not scaled */
export function energyCell(col, prev, scale) {
  const y = (e) => (Number.isFinite(e) ? (40 - (40 * Math.max(0, e)) / scale).toFixed(2) : null);
  const line = (a, b, cls) => (b == null ? '' : `<path class="${cls}" d="M0 ${a ?? b} L0 ${b} L100 ${b}" vector-effect="non-scaling-stroke"/>`);
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${line(y(prev?.target), y(col.target), 'alane-target')}${line(y(prev?.energy), y(col.energy), 'alane-e')}</svg>`;
}

/**
 * createArrangementLane({ doc, core, view, edit, rerender })
 *   core      the shared controller (songState, songClips, songPosition, the section edits, songAt)
 *   view      the tab's view: `songSection` (the selected section) is kept there
 *   edit      (run) → Promise of run()'s result (the window's one door for edits: an open audition is kept first)
 *   rerender  () → the window rendered again (after a selection)
 */
export function createArrangementLane({ doc = globalThis.document, core, view = {}, edit = (run) => Promise.resolve(run()), rerender = () => {} } = {}) {
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
  const root = el('div', { className: 'alane' });
  root.style.display = 'none';
  let said = null, colEls = [], lit = -1, playhead = null, tl = null, phLeft = '';
  // a clip's drawing kept by its place, reused while its SVG's text is the same (no re-parse on a re-render)
  const drawn = new Map();
  /** a click's edit: refused ones are said in the bar */
  const run = (fn) => edit(fn).then((r) => { said = r && r.ok === false ? r.error : null; if (said) render(); return r; });
  const btn = (label, className, title, onClick, extra = {}) => { const b = el('button', { className, textContent: label, title, ...extra }); b.addEventListener('click', onClick); return b; };

  function render() {
    const ss = core.songState(), on = ss.mode === 'song';
    root.style.display = on ? '' : 'none';
    colEls = []; lit = -1; playhead = null; tl = null; phLeft = '';
    if (!on) { root.replaceChildren(); return; }
    const spec = core.state.spec, okSpec = spec && !spec.refused, cycleSeconds = okSpec ? spec.knobs.cycleSeconds * core.tempoFactor() : null;
    const m = laneModel(ss, { selected: view.songSection ?? 0, cycleSeconds, passSeconds: okSpec ? spec.knobs.cycleSeconds : null });
    // the bar: the template, Re-plan, the seed, the length, stale, what went wrong
    const tpl = el('select', { className: 'alane-template', title: 'the song\'s shape: planned again on the loop as it plays, at the same seed (one undo step)', disabled: !ss.ready },
      ...ss.templates.map((t) => el('option', { value: t.id, textContent: t.label })));
    tpl.value = ss.template;
    tpl.addEventListener('change', () => run(() => core.setSongTemplate(tpl.value)));
    const replan = btn(m ? 'Re-plan' : 'Plan', 'ctab-btn alane-replan', m ? `a new song on the same template: seed ${Number(ss.seed) + 1} (one undo step)` : 'plan a song on the loop as it plays', () => run(() => (m ? core.replan() : core.planSong())), { disabled: !ss.ready });
    const bar = el('div', { className: 'ctab-row alane-bar' }, el('b', { className: 'alane-label', textContent: 'Song' }), tpl, replan,
      el('span', { className: 'ctab-muted alane-seed', textContent: `seed ${ss.seed}`, title: 'the planner\'s seed: it breaks ties between sections of near energy' }),
      m ? el('span', { className: 'ctab-muted alane-length', textContent: `${m.columns.length} sections · ${m.total} passes${m.seconds ? ` · ${Math.round(m.seconds)} s` : ''}` }) : null,
      m?.stale ? btn('stale: re-plan', 'alane-stale', 'the loop changed since this song was planned: its sections still play, over the loop as it plays now; a click plans it again at its seed (one undo step)', () => run(() => core.planSong())) : null);
    const notes = [];
    if (!ss.ready) notes.push(el('div', { className: 'ctab-muted alane-note', textContent: 'Compose first: Song plans a song from the loop as it plays.' }));
    if (m?.error || (!m && ss.error)) notes.push(el('div', { className: 'alane-note amber', textContent: `this song can't play the loop as it is: ${m?.error ?? ss.error} — re-plan` }));
    if (said) notes.push(el('div', { className: 'alane-note amber', textContent: `couldn't apply it: ${said}` }));
    if (!m) { root.replaceChildren(bar, ...notes); drawn.clear(); return; }

    tl = timeline(m.total);
    const rowOf = (head, cells, cls = '') => {
      const cols = el('div', { className: 'alane-cols' }, ...cells);
      cols.style.gridTemplateColumns = m.cols;
      return el('div', { className: `alane-row ${cls}` }, head, cols);
    };
    colEls = m.columns.map(() => []);
    const mark = (i, e) => { colEls[i].push(e); return e; };
    // the ruler: one element over the track (a seek attaches here later: timeline().fromX of the click's share)
    const r = rulerModel(m, { cycleSeconds, barStarts: okSpec ? spec.timeline?.barStarts ?? [] : [], specCycle: okSpec ? spec.knobs.cycleSeconds : null });
    const ticks = el('div', { className: 'alane-ticks' });
    ticks.innerHTML = rulerSvg(r);
    const ruler = el('div', { className: 'alane-ruler', title: `the song's time: ${m.columns.length} sections, ${m.total} passes${m.seconds ? `, ${Math.round(m.seconds)} s at this tempo` : ''} (a tick a pass and a bar)` },
      el('div', { className: 'alane-ruler-secs' }, ...r.sections.map((s) => {
        const b = el('div', { className: 'alane-ruler-sec', title: `${s.name} (${s.kind})` });
        b.style.left = `${100 * s.x}%`; b.style.width = `${100 * s.w}%`; b.style.setProperty('--alane-kind', s.color);
        b.dataset.section = String(s.index); b.dataset.kind = s.kind;
        return b;
      })),
      ticks,
      el('div', { className: 'alane-ruler-labels' }, ...r.labels.map((L) => { const t = el('span', { className: 'alane-ruler-label', textContent: L.text }); t.style.left = `${100 * L.x}%`; return t; })));
    ruler.dataset.passes = String(m.total);
    const rulerRow = el('div', { className: 'alane-row alane-ruler-row' }, el('span', { className: 'ctab-muted alane-head', textContent: m.seconds ? 'time' : 'passes' }), ruler);
    const energy = rowOf(el('span', { className: 'ctab-muted alane-head', textContent: 'energy', title: 'each section\'s energy (solid) and the template\'s target (dotted), home = 1' }),
      m.columns.map((c, i) => { const e = el('div', { className: 'alane-energy', title: `${c.name}: E ${fmt(c.energy)} for ${fmt(c.target)}` }); e.innerHTML = energyCell(c, m.columns[i - 1], m.scale); return mark(i, e); }), 'alane-energy-row');
    const heads = rowOf(el('span', { className: 'ctab-muted alane-head', textContent: 'section' }), m.columns.map((c, i) => {
      const name = btn(c.name, 'alane-name', `${c.name} (${c.kind}): E ${fmt(c.energy)} for ${fmt(c.target)} — a click shows it below`, () => { view.songSection = i; rerender(); });
      const passes = el('span', { className: 'alane-passes' },
        btn('−', 'alane-nudge', 'one pass fewer (one undo step)', () => run(() => core.nudgeSongPasses(i, -1)), { disabled: c.passes <= 1 }),
        el('span', { className: 'alane-n', textContent: String(c.passes), title: `${c.passes} pass${c.passes === 1 ? '' : 'es'} of the cycle` }),
        btn('+', 'alane-nudge', 'one pass more (one undo step)', () => run(() => core.nudgeSongPasses(i, 1)), { disabled: c.passes >= ss.maxPasses }));
      const h = el('div', { className: `alane-col${c.selected ? ' selected' : ''}${c.sounding ? ' now' : ''}` }, name, passes,
        c.fillBefore ? el('span', { className: 'alane-fill', textContent: '→ fill', title: 'its last bar fills into the next section, which opens on a crash' }) : null,
        c.edited ? el('span', { className: 'alane-edited', textContent: '•', title: 'edited since the plan' }) : null);
      h.style.setProperty('--alane-kind', c.color);
      h.dataset.kind = c.kind; h.dataset.section = String(i);
      return mark(i, h);
    }), 'alane-heads-row');
    // the clips: what each pass plays, as the player gets it
    const clips = core.songClips?.() ?? null, ranges = pitchRanges(clips), T = clips?.T ?? (okSpec ? spec.knobs.cycleSeconds : 1);
    const live = new Set();
    const parts = m.rows.map((row) => {
      const head = el('span', { className: `alane-head alane-part${row.loopOn ? '' : ' off'}`, textContent: row.label, title: row.loopOn ? row.label : `${row.label} is off in the loop` });
      head.style.borderLeftColor = row.color;
      return rowOf(head, row.clips.map((c) => {
        const passes = clips?.sections[c.section]?.passes ?? [], key = `${c.section}|${row.id}`;
        const svg = clipSvg(passes, row.id, T, ranges[row.id]);
        let had = drawn.get(key);
        if (!had || had.html !== svg.html) { const box = el('span', { className: 'alane-notes' }); box.innerHTML = svg.html; had = { html: svg.html, box }; drawn.set(key, had); }
        live.add(key);
        const what = row.id === 'drums' ? 'hits' : 'notes';
        const b = btn('', `alane-clip ${row.id === 'drums' ? 'drums' : 'pitched'}${c.on ? ' on' : ' off'}${c.can ? '' : ' cant'}${c.density ? ' dense' : ''}${c.selected ? ' selected' : ''}`,
          `${c.title} · ${svg.count} ${what} over ${passes.length} pass${passes.length === 1 ? '' : 'es'}${svg.sounding < passes.length && svg.sounding > 0 ? ` (${svg.sounding} sounding)` : ''}`, () => run(() => core.toggleSongPart(c.section, row.id)), { disabled: !c.can });
        b.append(had.box);
        if (c.density) b.append(el('span', { className: 'alane-clip-label', textContent: c.density }));
        const fill = row.id === 'drums' ? passes.findIndex((p) => p.fill) : -1;
        if (fill >= 0) { const t = el('span', { className: 'alane-clip-tag', title: 'the fill: this pass\'s last bar fills into the next section' }); t.style.left = `${(100 * fill) / passes.length}%`; t.dataset.pass = String(passes[fill].index); b.append(t); }
        b.style.setProperty('--alane-part', row.color);
        b.dataset.part = row.id; b.dataset.section = String(c.section); b.dataset.passes = String(passes.length); b.dataset.marks = String(svg.count);
        return mark(c.section, b);
      }), `alane-part-row${row.id === 'drums' ? ' drums' : ''}`);
    });
    for (const k of [...drawn.keys()]) if (!live.has(k)) drawn.delete(k);
    const layers = rowOf(el('span', { className: 'ctab-muted alane-head', textContent: 'Layers', title: 'the row\'s layers each section keeps: the drums, the comp and the inner play the notes they strike (ruling 1)' }),
      m.layers.map((L) => mark(L.section, el('div', { className: 'alane-chips' }, ...L.chips.map((ch) => {
        const b = btn(ch.name, `alane-chip${ch.on ? ' on' : ''}`, ch.title, () => run(() => core.toggleSongLayer(L.section, ch.index)));
        b.dataset.layer = String(ch.index); b.dataset.section = String(L.section);
        return b;
      })))), 'alane-layers-row');
    // the playhead: one line over the track's rows, at songPosition() (frame())
    playhead = el('div', { className: 'alane-playhead' });
    playhead.style.display = 'none';
    const over = el('div', { className: 'alane-over' }, playhead);
    // every row the same width, so the columns line up (each row its own grid on one template); narrower, it scrolls
    const grid = el('div', { className: 'alane-grid-rows' }, rulerRow, energy, heads, ...parts, layers, over);
    grid.style.minWidth = `${m.minWidth}px`;
    root.replaceChildren(bar, ...notes, el('div', { className: 'alane-grid' }, grid), strip(m, ss));
    lit = m.columns.findIndex((c) => c.sounding);
    for (const e of colEls[lit] ?? []) e.classList.add('now');
    frame();
  }

  /** the selected section: its words and its densities */
  function strip(m, ss) {
    const c = m.columns[m.selected], sec = ss.song.sections[m.selected];
    const selects = DENSITY_ROWS.map((part) => {
      const own = ss.own?.[part], ladder = ss.ladders[part], can = !!sec.parts[part] && ss.loopOn?.[part] !== false && !(part === 'comp' && own == null);
      const s = el('select', { className: 'alane-density', disabled: !can, title: !can ? (part === 'comp' && own == null ? 'the loop\'s clave isn\'t read from the frames: the comp has no density tier' : `${PART_LABELS[part]} doesn't play in ${sec.name}`) : `${PART_LABELS[part]}'s density in ${sec.name} (one undo step)` },
        ...ladder.map((v) => el('option', { value: v, textContent: `${densityName(part, v)}${v === own ? ' (the loop\'s)' : ''}` })));
      s.value = sec.density?.[part] ?? own ?? ladder[0];
      s.dataset.part = part;
      s.addEventListener('change', () => run(() => core.setSongDensity(m.selected, part, s.value === own ? null : s.value)));
      return el('label', { className: 'alane-dens' }, el('span', { className: 'ctab-muted', textContent: PART_LABELS[part] }), s);
    });
    const head = el('div', { className: 'ctab-row' }, el('b', { className: 'alane-strip-name', textContent: c.name }), el('span', { className: 'ctab-muted', textContent: c.kind }),
      el('span', { className: 'alane-strip-e', textContent: `E ${fmt(c.energy)} for ${fmt(c.target)}` }), el('span', { className: 'ctab-muted', textContent: `${c.passes} pass${c.passes === 1 ? '' : 'es'}${c.edited ? ' · edited' : ''}` }), ...selects);
    const box = el('div', { className: 'alane-strip' }, head, el('div', { className: 'ctab-muted alane-why', textContent: c.why }));
    box.style.setProperty('--alane-kind', c.color);
    return box;
  }

  /** each animation frame while shown: the playhead moved (a style write only when it moved), the sounding section lit
   *  (nothing is rebuilt) */
  function frame() {
    if (root.style.display === 'none' || !colEls.length) return;
    const pos = core.songPosition?.() ?? null;
    if (playhead) {
      const left = pos && tl ? `${(100 * tl.toX(pos.at)).toFixed(3)}%` : '';
      if (left !== phLeft) { phLeft = left; playhead.style.display = left ? 'block' : 'none'; if (left) playhead.style.left = left; }
    }
    const k = pos ? pos.section : -1;
    if (k === lit) return;
    for (const e of colEls[lit] ?? []) e.classList.remove('now');
    for (const e of colEls[k] ?? []) e.classList.add('now');
    lit = k;
  }

  return { root, render, frame, get lit() { return lit; }, get playhead() { return playhead; } };
}
