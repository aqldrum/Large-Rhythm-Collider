// arrangement-lane.js — Song v0's lane in the Composer window (ARRANGEMENT_ORDER.md phase C2, S15; DESIGN_NOTES "Song v0
// (phase C)"), above the matrix while Song is on. A view of the shared controller's song (core.songState()), as the
// matrix is of the loop: every click is one of the controller's section edits, one undo step each (the window's ↶ ↷).
//
//   bar        "Song", the template select (Arch | Build–drop: planned again at the same seed), Re-plan (the same template
//              at a new seed), the seed, the song's length; "stale: re-plan" (amber) when the loop changed under the song
//              (a click plans it again at its own seed); a song this loop can't play, or an edit refused, said in words
//   the grid   a column a section, as wide as its passes (fr units, a floor of MIN_COLUMN_PX; past it the lane scrolls sideways), named and coloured by its kind; a
//              row a part (the matrix's order) and a Layers row:
//                energy    across the top, a step line of each section's energy (form.js energyOf on the loop as it
//                          plays: solid) and its target (dotted), on one scale; a column draws its own step and the join
//                          from the one before, so the line is continuous whatever the widths
//                head      the name (a click selects the section: the strip below), "−  N  +" passes, "→ fill" before a
//                          peak or drop, a dot when edited; the sounding section lit while Song plays (frame())
//                cells     on / off (a click toggles); where the section plays a density other than the loop's, its name
//                          ("Walking", "Dense", "Arp"); a part off in the loop can't be turned on (hatched, said)
//                Layers    the row's layers as chips (A B C D), each in or out of the section (a click toggles)
//   the strip  the selected section: its kind, energy against its target, passes, the planner's why; a density select for
//              the bass, the comp, the lead and the inner (the loop's own marked), each one undo step
// PURE half: laneModel(songState, { selected }) → the lane as data; energyCell(col, prev, scale) → its SVG's text. The DOM half
// createArrangementLane({ doc, core, view, edit, rerender }) → { root, render(), frame() }.

import { PART_LABELS, PART_COLORS } from './plot-highlights.js';

export const LANE_VERSION = 'composer-lane-v1';
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
/** the narrowest a section's column gets before the lane scrolls sideways (px; its floor in the column template too) */
export const MIN_COLUMN_PX = 56;
const fmt = (x) => (x == null || !Number.isFinite(x) ? '–' : x.toFixed(2));
const densityName = (part, v) => DENSITY_LABELS[part]?.[v] ?? String(v);

/**
 * The lane as data, from core.songState(): null with no song. → { template, templates, seed, stale, error, total (the
 * song's passes), seconds (its length at the spec's own tempo), scale (the energy line's top), columns: [{ index, name,
 * kind, color, passes, fillBefore, edited, energy, target, why, selected, sounding }], rows: [{ id, label, color, loopOn,
 * cells: [{ section, on, can, density, title }] }], layers: [{ section, chips: [{ index, name, value, on, title }] }],
 * template (the grid's column template, after the 84 px heads) }
 */
export function laneModel(ss, { selected = 0, cycleSeconds = null } = {}) {
  if (!ss?.song) return null;
  const S = ss.song.sections, at = ss.at, sel = Math.max(0, Math.min(S.length - 1, selected | 0));
  const energies = S.map((s, i) => ss.energies?.[i] ?? s.energy);
  const scale = Math.max(1.2, ...energies.filter(Number.isFinite), ...S.map((s) => s.target ?? 0)) * 1.08;
  const columns = S.map((s, i) => ({ index: i, name: s.name, kind: s.kind, color: KIND_COLORS[s.kind] ?? '#888', passes: s.passes, fillBefore: !!s.fillBefore, edited: !!s.edited,
    energy: energies[i], target: s.target, why: s.why ?? '', selected: i === sel, sounding: at?.section === i }));
  const rows = LANE_PARTS.map((id) => {
    const loopOn = ss.loopOn?.[id] !== false;
    return { id, label: PART_LABELS[id], color: PART_COLORS[id], loopOn, cells: S.map((s, i) => {
      const on = !!s.parts[id] && loopOn, d = s.density?.[id];
      const density = on && d != null && d !== ss.own?.[id] ? densityName(id, d) : null;
      const title = !loopOn ? `${PART_LABELS[id]} is off in the loop: it plays in no section (turn it on in Loop)`
        : `${s.name}: ${PART_LABELS[id]} ${on ? 'on' : 'off'}${density ? `, ${density} (the loop plays ${densityName(id, ss.own[id])})` : ''} — a click turns it ${on ? 'off' : 'on'}`;
      return { section: i, on, can: loopOn, density, title };
    }) };
  });
  const layers = S.map((s, i) => ({ section: i, chips: (ss.layers ?? []).map((L) => {
    const on = (s.layers & L.mask) !== 0, rank = (ss.song.order ?? []).indexOf(L.index);
    return { index: L.index, name: L.name, value: L.value, on, title: `${s.name}: layer ${L.name}${L.value} ${on ? 'in' : 'out'}${rank >= 0 ? ` (it enters ${ordinal(rank + 1)} in the build order)` : ''} — a click takes it ${on ? 'out' : 'in'}` };
  }) }));
  const total = S.reduce((a, s) => a + s.passes, 0);
  return { template: ss.template, templates: ss.templates, seed: ss.seed, stale: !!ss.stale, error: ss.error ?? null, total, seconds: cycleSeconds ? total * cycleSeconds : null, scale, columns, rows, layers,
    selected: sel, cols: S.map((s) => `minmax(${MIN_COLUMN_PX}px, ${s.passes}fr)`).join(' ') };
}
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** a column's energy step (its own and the join from the column before), as an SVG's text: x 0..100, y 0 (top)..40;
 *  the energy solid, the target dotted; preserveAspectRatio none, the strokes not scaled */
export function energyCell(col, prev, scale) {
  const y = (e) => (Number.isFinite(e) ? (40 - (40 * Math.max(0, e)) / scale).toFixed(2) : null);
  const line = (a, b, cls) => (b == null ? '' : `<path class="${cls}" d="M0 ${a ?? b} L0 ${b} L100 ${b}" vector-effect="non-scaling-stroke"/>`);
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${line(y(prev?.target), y(col.target), 'alane-target')}${line(y(prev?.energy), y(col.energy), 'alane-e')}</svg>`;
}

/**
 * createArrangementLane({ doc, core, view, edit, rerender })
 *   core      the shared controller (songState, the section edits, songAt)
 *   view      the tab's view: `songSection` (the selected section) is kept there
 *   edit      (run) → Promise of run()'s result (the window's one door for edits: an open audition is kept first)
 *   rerender  () → the window rendered again (after a selection)
 */
export function createArrangementLane({ doc = globalThis.document, core, view = {}, edit = (run) => Promise.resolve(run()), rerender = () => {} } = {}) {
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
  const root = el('div', { className: 'alane' });
  root.style.display = 'none';
  let said = null, colEls = [], lit = -1;
  /** a click's edit: refused ones are said in the bar */
  const run = (fn) => edit(fn).then((r) => { said = r && r.ok === false ? r.error : null; if (said) render(); return r; });
  const btn = (label, className, title, onClick, extra = {}) => { const b = el('button', { className, textContent: label, title, ...extra }); b.addEventListener('click', onClick); return b; };

  function render() {
    const ss = core.songState(), on = ss.mode === 'song';
    root.style.display = on ? '' : 'none';
    colEls = []; lit = -1;
    if (!on) { root.replaceChildren(); return; }
    const m = laneModel(ss, { selected: view.songSection ?? 0, cycleSeconds: core.state.spec && !core.state.spec.refused ? core.state.spec.knobs.cycleSeconds * core.tempoFactor() : null });
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
    if (!m) { root.replaceChildren(bar, ...notes); return; }

    // the grid: the energy line, the heads, a row a part, the layers
    const rowOf = (head, cells, cls = '') => {
      const cols = el('div', { className: 'alane-cols' }, ...cells);
      cols.style.gridTemplateColumns = m.cols;
      return el('div', { className: `alane-row ${cls}` }, head, cols);
    };
    colEls = m.columns.map(() => []);
    const mark = (i, e) => { colEls[i].push(e); return e; };
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
      h.dataset.kind = c.kind;
      return mark(i, h);
    }));
    const parts = m.rows.map((r) => {
      const head = el('span', { className: `alane-head alane-part${r.loopOn ? '' : ' off'}`, textContent: r.label, title: r.loopOn ? r.label : `${r.label} is off in the loop` });
      head.style.borderLeftColor = r.color;
      return rowOf(head, r.cells.map((c) => {
        const b = btn(c.density ?? (c.on ? '' : '·'), `alane-cell${c.on ? ' on' : ''}${c.can ? '' : ' cant'}${c.density ? ' dense' : ''}`, c.title, () => run(() => core.toggleSongPart(c.section, r.id)), { disabled: !c.can });
        b.style.setProperty('--alane-part', r.color);
        b.dataset.part = r.id; b.dataset.section = String(c.section);
        return mark(c.section, b);
      }), 'alane-part-row');
    });
    const layers = rowOf(el('span', { className: 'ctab-muted alane-head', textContent: 'Layers', title: 'the row\'s layers each section keeps: the drums, the comp and the inner play the notes they strike (ruling 1)' }),
      m.layers.map((L) => mark(L.section, el('div', { className: 'alane-chips' }, ...L.chips.map((ch) => {
        const b = btn(ch.name, `alane-chip${ch.on ? ' on' : ''}`, ch.title, () => run(() => core.toggleSongLayer(L.section, ch.index)));
        b.dataset.layer = String(ch.index); b.dataset.section = String(L.section);
        return b;
      })))), 'alane-layers-row');
    // every row the same width, so the columns line up (each row its own grid on one template); narrower, it scrolls
    const grid = el('div', { className: 'alane-grid-rows' }, energy, heads, ...parts, layers);
    grid.style.minWidth = `${90 + m.columns.length * MIN_COLUMN_PX}px`;
    root.replaceChildren(bar, ...notes, el('div', { className: 'alane-grid' }, grid), strip(m, ss));
    lit = m.columns.findIndex((c) => c.sounding);
    for (const e of colEls[lit] ?? []) e.classList.add('now');
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

  /** the sounding section lit (each animation frame while shown; nothing is rebuilt) */
  function frame() {
    if (root.style.display === 'none' || !colEls.length) return;
    const at = core.songAt(), k = at ? at.section : -1;
    if (k === lit) return;
    for (const e of colEls[lit] ?? []) e.classList.remove('now');
    for (const e of colEls[k] ?? []) e.classList.add('now');
    lit = k;
  }

  return { root, render, frame, get lit() { return lit; } };
}
