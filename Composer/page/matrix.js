// matrix.js — STEP 4e (DESIGN_NOTES "Step 4e: the matrix and the context inspector"): the Composer window's bar × part
// matrix and its context inspector, as plain data. PURE: no DOM, no clock, no controller. composer-tab.js renders it.
//
// Decision 8 (Avery): the lanes BECOME the matrix. Six part rows (Lead, Chords, Comping, Bass, Inner, Drums), one
// column a bar, each column as wide as its bar lasts (readouts.js barColumns). A cell is a mini view of that part in
// that bar: its notes as dots (x its time in the cell, y its pitch within the part's range), the chord's name, the
// drums' step grid in miniature. A lead cell spans its phrase (decision 2: lead alternates are per phrase).
//
//   phraseSpans(spec) → [{ from, bars }]                       the lead's phrases (harmony.js phrasesOf)
//   cellSpan(part, bar, spans) → { from, to, phrase }           the bars a cell covers (to exclusive)
//   matrixModel(state, { grid, composedGrid, alternates, retuned }) → { bars, rows: [{ id, cells: [cell] }], … }
//   retuneRanges(bars) → [{ from, to }]                          runs of re-pitched bars (to inclusive)
//   moveCell({ part, bar }, key, { bars, spans }) → { part, bar } the arrow keys
//   nextStep(ch) → '.' → 'x' → 'X' → '.'                         a drum step's click
//   waitToBoundary(t, barStarts, T) → spec seconds to the next bar start (the audition's moment)
//   fieldStrip(resolution) → per bar: { text, detail, mark, status, title }   the typed field's inline resolution
//   candidateRow(c) / lineRow(l)                                 an alternate as the inspector lists it
//   primeStrip(prime, T, bar, barStarts) → the level-1 lights at their real times (0..1), chosen and struck marked
//
// MIDI targets (phase B, B3): on a target spec the lead row IS the clip. Its dots are the clip's notes (y by the clip's
// own pitch), each with its kind (target-lines.js clipMarks): a hit, an amber substitute (fringe or shift), a red hard
// miss (silent: drawn hollow at its step, it has no onset), a late note-off marked. It has no alternates (P6).

import { phrasesOf } from '../core/harmony.js';
import { DRUM_VOICES, GRID_CHARS } from '../core/drums.js';
import { PART_LABELS, PART_COLORS } from './plot-highlights.js';
import { barColumns } from '../perform/readouts.js';
import { clipMarks, clipCounts } from './target-lines.js';

export const MATRIX_VERSION = 'composer-matrix-v1';
/** the matrix's rows, top to bottom (the lanes' order) */
export const MATRIX_PARTS = Object.freeze(['lead', 'chords', 'comp', 'bass', 'inner', 'drums']);
/** below this width (px) of the window's left half, the matrix shows one bar and a bar picker (proposed; a CSS
 *  container query in composer-tab.css, the same number) */
export const NARROW_PX = 600;
/** a drum step's click: off → a stroke → an accent → off */
export const STEP_CYCLE = Object.freeze([GRID_CHARS.off, GRID_CHARS.stroke, GRID_CHARS.accent]);
export const nextStep = (ch) => STEP_CYCLE[(STEP_CYCLE.indexOf(ch) + 1) % STEP_CYCLE.length] ?? GRID_CHARS.stroke;

/** a quality's id in words ('major_triad' → 'major triad') */
export const qualityName = (id) => String(id ?? '').replace(/_/g, ' ');
const fmtCents = (c) => `${c >= 0 ? '+' : '−'}${Math.abs(c).toFixed(1)}¢`;

/** the lead's phrases, for a composition's meter */
export const phraseSpans = (spec) => phrasesOf({ bars: spec.knobs.bars, slotsPerBar: spec.knobs.slotsPerBar });
/** the bars a cell covers: a lead cell its phrase, any other one its bar → { from, to (exclusive), phrase } */
export function cellSpan(part, bar, spans) {
  const phrase = Math.max(0, spans.findIndex((p) => bar >= p.from && bar < p.from + p.bars));
  if (part === 'lead' && spans.length) return { from: spans[phrase].from, to: spans[phrase].from + spans[phrase].bars, phrase };
  return { from: bar, to: bar + 1, phrase };
}

/** a part's notes in bar k as compared for "edited": which notes, not their lengths or hz (a re-pitch is not an edit) */
const notesSig = (part, k) => (part ? part.notes.filter((n) => n.bar === k).map((n) => `${n.slot}:${n.node}:${n.octave}:${n.voice ?? ''}`).join('|') : '');
const chordSig = (c) => (c ? `${c.empty ? 'empty' : `${c.rootTone}/${c.quality}`}` : '');
/** runs of bars (sorted, unique) → [{ from, to }] (to inclusive) */
export function retuneRanges(bars) {
  const out = [];
  for (const k of [...new Set(bars)].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && k === last.to + 1) last.to = k; else out.push({ from: k, to: k });
  }
  return out;
}
/** "bars 3–4" (1-based) */
export const barsLabel = ({ from, to }) => (from === to ? `bar ${from + 1}` : `bars ${from + 1}–${to + 1}`);

/**
 * The matrix as data.
 *   state     the composition (tab.state): spec (as edited), composed, parts (as they play), drums, edits
 *   grid      the drum grid as it plays (controller drumGrid()), or null
 *   composedGrid  the grid of the drums as Compose's mode plays them, for "edited" (null: no mark)
 *   alternates (bar, part) → how many alternates the cell has (0: no badge)
 *   retuned   the bars re-pitched from Compose's (controller retunedBars())
 * → null without a composition, else { bars, cols, starts, lens, spans, rows: [{ id, label, color, enabled, cells }] }
 *   cell: { part, bar, from, to, phrase, dots: [{ x, y, accent, kind?, late?, j? }], clip? (a target's lead: its counts),
 *           name?, spans? (a chord chart's split bar: [{ unit (the chord's index), name, x, w (0..1 of the bar), targeted,
 *           fallback, edited, title }]), badge, edited, editKind, retuned, retune
 *           ({ from, to } on the cell whose edit re-pitched those later bars), steps? (drums: { voice: string }),
 *           silent? (drums: Set of `${voice}:${place}`), title }
 */
export function matrixModel(state, { grid = null, composedGrid = null, alternates = () => 0, retuned = [] } = {}) {
  const spec = state?.spec, composed = state?.composed ?? spec;
  if (!spec || spec.refused) return null;
  const N = spec.knobs.bars, T = spec.knobs.cycleSeconds, { starts, lens, cols } = barColumns(spec), spans = phraseSpans(spec);
  const playing = Object.fromEntries(Object.values(state.parts ?? {}).map((p) => [p.id, p]));
  const own = Object.fromEntries(spec.parts.map((p) => [p.id, p])), base = Object.fromEntries((composed?.parts ?? []).map((p) => [p.id, p]));
  const retunedSet = new Set(retuned), ranges = retuneRanges(retuned);
  // a retune's source: the last edited chord bar before its run (else the run's first bar)
  const editedChordBars = Object.keys(state.edits?.chords ?? {}).map(Number);
  for (const [p, e] of Object.entries(state.edits?.lead ?? {})) if (e.chordsFollow) { const s = spans[Number(p)]; if (s) for (let k = s.from; k < s.from + s.bars; k++) editedChordBars.push(k); }
  const sourceOf = new Map();
  for (const r of ranges) { const before = editedChordBars.filter((k) => k < r.from).sort((a, b) => b - a)[0]; sourceOf.set(before ?? r.from, r); }
  const endOf = (to) => (to < N ? starts[to] : T);
  const rows = MATRIX_PARTS.map((id) => {
    const part = playing[id] ?? own[id];
    const label = PART_LABELS[id], color = PART_COLORS[id];
    if (id === 'drums') {
      const d = state.drums;
      const cells = Array.from({ length: N }, (_, k) => {
        const steps = grid ? Object.fromEntries(DRUM_VOICES.map((v) => [v, grid.grid?.[v]?.[k] ?? ''])) : null;
        const silent = new Set((grid?.silentCells ?? []).filter((x) => x.bar === k).map((x) => `${x.voice}:${x.place}`));
        const edited = !!(grid?.own && composedGrid && DRUM_VOICES.some((v) => (grid.grid?.[v]?.[k] ?? '') !== (composedGrid[v]?.[k] ?? '')));
        const b = d?.bars?.[k];
        return { part: id, bar: k, from: k, to: k + 1, phrase: cellSpan(id, k, spans).phrase, dots: [], steps, silent, places: grid?.places ?? 0, badge: 0, edited, editKind: edited ? 'grid' : null,
          retuned: false, retune: null, name: b ? `${b.mode}${b.fill ? ' + fill' : ''}` : '', title: b?.why ?? '' };
      });
      return { id, label, color, enabled: d ? d.enabled !== false : true, cells };
    }
    // the part's pitch range, for the dots' height
    let lo = Infinity, hi = -Infinity;
    for (const n of part?.notes ?? []) { const v = Math.log2(n.hz); if (v < lo) lo = v; if (v > hi) hi = v; }
    const yOf = (hz) => (hi > lo ? 1 - (Math.log2(hz) - lo) / (hi - lo) : 0.5);
    const cellsOf = id === 'lead' ? spans.map((s) => ({ from: s.from, to: s.from + s.bars })) : Array.from({ length: N }, (_, k) => ({ from: k, to: k + 1 }));
    // MIDI targets: the lead row is the clip, its notes by kind (silent ones too), its height the clip's own pitch
    const marks = id === 'lead' && spec.target ? clipMarks(spec) : null;
    if (marks) { lo = Math.min(...marks.map((m) => m.midi)); hi = Math.max(...marks.map((m) => m.midi)); }
    const clipDots = (from, to, t0, len) => {
      const S = spec.knobs.slotsPerBar, byClip = new Map((part?.notes ?? []).map((n) => [n.clipNote, n]));
      return marks.filter((m) => m.step >= from * S && m.step < to * S).map((m) => {
        const n = m.sounding ? byClip.get(m.j) : null, slotT = spec.timeline.slotStarts[m.step] ?? t0;
        const t = n && n.time >= t0 - 1e-9 && n.time < t0 + len ? n.time : slotT;   // a note before slot 0's anchor sounds at the loop's end: drawn at its slot
        return { x: Math.min(1, Math.max(0, (t - t0) / len)), y: hi > lo ? (hi - m.midi) / (hi - lo) : 0.5, accent: n ? !!n.retrigger : true, kind: m.kind, late: m.late, j: m.j };
      });
    };
    const cells = cellsOf.map(({ from, to }, idx) => {
      const t0 = starts[from], len = endOf(to) - t0;
      const dots = marks ? clipDots(from, to, t0, len) : (part?.notes ?? []).filter((n) => n.bar >= from && n.bar < to).map((n) => ({ x: Math.min(1, Math.max(0, (n.time - t0) / len)), y: yOf(n.hz), accent: !!n.retrigger }));
      let edited = false;
      for (let k = from; k < to; k++) if (notesSig(own[id], k) !== notesSig(base[id], k)) edited = true;
      const cell = { part: id, bar: from, from, to, phrase: id === 'lead' ? idx : cellSpan(id, from, spans).phrase, dots, badge: alternates(from, id) || 0, edited, editKind: null, retuned: false, retune: null, title: '' };
      if (id === 'lead') {
        const e = state.edits?.lead?.[idx];
        if (e) { cell.edited = true; cell.editKind = e.chordsFollow ? 'swap + chords' : 'swap'; if (e.smooth) cell.editKind += ' + smooth'; }
        cell.title = `${label}, ${barsLabel({ from, to: to - 1 })} (phrase ${idx + 1}): ${dots.length} notes`;
        if (marks) {
          const c = cellClip(dots);
          cell.clip = c;
          cell.title = `${label} (the clip), ${barsLabel({ from, to: to - 1 })}: ${c.notes} notes, ${c.hits} hit${c.sub ? `, ${c.sub} substituted (amber)` : ''}${c.hard ? `, ${c.hard} silent (red)` : ''}${c.late ? `, ${c.late} late note-off${c.late === 1 ? '' : 's'}` : ''}`;
        }
      } else if (id === 'chords' && spec.chords.some((c) => c.slots != null) && spec.chords.filter((c) => c.bar === from).length > 1) {
        // a chord chart's split bar (CHART_ORDER.md P10): its chords, each at its span's place in the bar
        const units = spec.chords.flatMap((c, i) => (c.bar === from ? [i] : []));
        cell.spans = units.map((u) => {
          const ch = spec.chords[u], e = state.edits?.chords?.[u], x0 = spec.timeline.slotStarts[ch.from] ?? t0, x1 = ch.from + ch.slots < spec.timeline.slotStarts.length ? spec.timeline.slotStarts[ch.from + ch.slots] : t0 + len;
          const edited = chordSig(ch) !== chordSig(composed?.chords?.[u]) || !!e;
          if (edited) { cell.edited = true; cell.editKind = e?.from ?? cell.editKind; }
          return { unit: u, name: ch.empty ? '—' : ch.name, x: Math.min(1, Math.max(0, (x0 - t0) / len)), w: Math.min(1, Math.max(0, (x1 - x0) / len)), targeted: !!ch.targeted, fallback: !!ch.fallback, edited,
            title: `${ch.empty ? 'an empty span' : `${ch.name}: ${qualityName(ch.quality)}, root ${ch.rootTone}`}${ch.offsetCents ? `, ${fmtCents(ch.offsetCents)} retuned` : ''}${e ? ` (${e.from === 'typed' ? 'typed' : 'swapped'})` : ''}` };
        });
        cell.name = cell.spans.map((x) => x.name).join(' ');
        cell.targeted = cell.spans.every((x) => x.targeted); cell.fallback = cell.spans.some((x) => x.fallback);
        cell.retuned = retunedSet.has(from);
        cell.retune = sourceOf.get(from) ?? null;
        cell.title = `${barsLabel({ from, to: from })}, ${units.length} chords: ${cell.spans.map((x) => x.title).join('; ')}`;
      } else if (id === 'chords') {
        const ch = spec.chords.find((c) => c.bar === from) ?? spec.chords[from], u = spec.chords.indexOf(ch), e = state.edits?.chords?.[u];
        cell.name = ch.empty ? '—' : ch.name;
        cell.targeted = !!ch.targeted; cell.fallback = !!ch.fallback;
        if (chordSig(ch) !== chordSig(composed?.chords?.[u])) cell.edited = true;
        if (e) { cell.edited = true; cell.editKind = e.from; }
        cell.retuned = retunedSet.has(from);
        cell.retune = sourceOf.get(from) ?? null;
        cell.title = `${ch.empty ? 'an empty bar' : `${ch.name}: ${qualityName(ch.quality)}, root ${ch.rootTone}`}${ch.offsetCents ? `, ${fmtCents(ch.offsetCents)} retuned` : ''}${e ? ` (${e.from === 'typed' ? 'typed' : 'swapped'})` : ''}`;
      } else {
        const over = spec.chords.filter((c) => c.bar === from).map((c) => (c.empty ? 'no chord' : c.name)).join(', ');
        if (cell.edited) cell.editKind = 'follows';
        cell.title = `${label}, bar ${from + 1}: ${dots.length} notes, over ${over}`;
      }
      return cell;
    });
    return { id, label, color, enabled: part ? part.enabled !== false : true, cells };
  });
  return { version: MATRIX_VERSION, bars: N, cycleSeconds: T, cols, starts, lens, spans, rows, retuneRanges: ranges };
}

/** a target lead cell's dots counted by kind (target-lines.js clipCounts' shape) */
const cellClip = (dots) => clipCounts(dots.map((d) => ({ kind: d.kind, sub: d.kind === 'fringe' || d.kind === 'shift', miss: d.kind === 'hard', late: d.late })));

/** the cell an arrow key moves to: left/right a bar (a lead cell: a phrase), up/down a part */
export function moveCell({ part, bar }, key, { bars, spans }) {
  const i = MATRIX_PARTS.indexOf(part), span = cellSpan(part, bar, spans);
  if (key === 'ArrowUp') return { part: MATRIX_PARTS[Math.max(0, i - 1)], bar };
  if (key === 'ArrowDown') return { part: MATRIX_PARTS[Math.min(MATRIX_PARTS.length - 1, i + 1)], bar };
  if (key === 'ArrowLeft') return { part, bar: part === 'lead' ? Math.max(0, span.from - 1 >= 0 ? cellSpan(part, span.from - 1, spans).from : 0) : Math.max(0, bar - 1) };
  if (key === 'ArrowRight') return { part, bar: part === 'lead' ? (span.to < bars ? span.to : span.from) : Math.min(bars - 1, bar + 1) };
  return { part, bar };
}

/** spec seconds from t (in the cycle) to the next bar start (the cycle's end counts: the loop's downbeat) */
export function waitToBoundary(t, barStarts, T) {
  for (const s of barStarts) if (s > t + 1e-9) return s - t;
  return T - t;
}
/** the bar sounding at t */
export function barAt(t, barStarts) { let k = 0; while (k + 1 < barStarts.length && barStarts[k + 1] <= t + 1e-9) k++; return k; }

/**
 * The typed field's inline resolution, a bar a column (chord-symbols.js resolveSymbols' perBar; a chord chart's split
 * bar is one column, its chords' names in a row and `chords` the parts):
 * → [{ bar, text (the symbol's name), detail (the root's cents, the quality's mark), mark ('✓' | '' ), status
 *     ('auto' | 'ok' | 'amber' | 'error'), offGrid, mayRetune, title (every amber reason) }]
 */
export function fieldStrip(resolution) {
  if (!resolution || resolution.refused) return [];
  const per = resolution.perBar.map((b) => {
    if (b.kind === 'auto') return { bar: b.bar, text: '·', detail: 'auto', mark: '', status: 'auto', offGrid: false, mayRetune: false, title: 'auto: Compose chooses this bar' };
    if (b.kind === 'error') return { bar: b.bar, text: b.token?.text ?? '?', detail: 'not a chord', mark: '', status: 'error', offGrid: false, mayRetune: false, title: b.error };
    const q = b.quality, detail = [b.root.label.replace(/^[A-G]♯?/, '').trim() || '±0¢', q.support === 'whole' ? '' : q.label].filter(Boolean).join(' · ');
    const flag = b.root.offGrid ? 'offGrid' : b.root.mayRetune ? 'may retune' : '';
    return { bar: b.bar, text: b.name, detail: [detail, flag].filter(Boolean).join(' · '), mark: b.status === 'ok' ? '✓' : '', status: b.status, offGrid: !!b.root.offGrid, mayRetune: !!b.root.mayRetune,
      title: b.status === 'ok' ? `${b.name}: root ${b.root.ratio} (${b.root.label}), supported` : b.amber.join('; ') };
  });
  // a chord chart's split bar (CHART_ORDER.md P10): its chords in one column, the worst status the column's
  if (!resolution.spans) return per;
  const rank = { error: 3, amber: 2, ok: 1, auto: 0 }, out = [];
  for (const b of per) {
    const at = out.find((x) => x.bar === b.bar);
    if (!at) { out.push({ ...b, chords: [b] }); continue; }
    at.chords.push(b);
    at.text = at.chords.map((x) => x.text).join(' ');
    at.detail = at.chords.map((x) => x.detail).filter(Boolean).join(' / ');
    at.mark = at.chords.every((x) => x.mark) ? '✓' : '';
    if (rank[b.status] > rank[at.status]) at.status = b.status;
    at.offGrid ||= b.offGrid; at.mayRetune ||= b.mayRetune;
    at.title = at.chords.map((x) => `${x.text}: ${x.title}`).join(' · ');
  }
  return out;
}

/** a chord candidate as the inspector lists it */
export function candidateRow(c) {
  const q = qualityName(c.quality);
  return {
    name: c.label, ratio: c.root.ratio, cents: `${c.root.cents.toFixed(1)}¢`, quality: q,
    support: c.violations === 0 ? '✓' : `${c.violations} off`, amber: c.violations > 0,
    title: `${c.label}: root ${c.root.ratio} (${c.root.cents.toFixed(1)}¢), ${q}; ${c.violations === 0 ? 'holds every strong lead note' : `${c.violations} strong lead note${c.violations === 1 ? '' : 's'} off it`}, ${c.held} lead note${c.held === 1 ? '' : 's'} held, the bar's support ${c.support}`,
    current: !!c.current, composed: !!c.composed,
  };
}
/** a lead line (a runner-up) as the inspector lists it */
export function lineRow(l) {
  return { id: l.id, cost: l.perNote == null ? '–' : l.perNote.toFixed(3), notes: l.notes, shape: [l.band, l.motion, l.contour].filter(Boolean).join(' · '), kept: !!l.kept, current: !!l.current,
    title: `${l.kept ? "Compose's line" : 'a runner-up'}: ${l.notes} notes, cost ${l.perNote == null ? '–' : l.perNote.toFixed(4)} a note${l.band ? ` (${l.band}, ${l.motion}, ${l.contour})` : ''}` };
}

/**
 * The prime partition's strip (drums.js spec.drums.prime): every level-1 light at its real time over the cycle, the
 * level-2 chosen lights and the struck ones marked, bar k's span shaded.
 * → null without one, else { p, drawn, range: { above, upTo, primes }, cells, lights: [{ i, x (0..1) | null, dark,
 *   chosen, struck, inBar }], bar: { from, to } (0..1), label }
 */
export function primeStrip(prime, T, bar, barStarts) {
  if (!prime) return null;
  const chosen = new Set(prime.chosen ?? []), struck = new Set((prime.struck ?? []).map((s) => s.light));
  const from = (barStarts[bar] ?? 0) / T, to = (bar + 1 < barStarts.length ? barStarts[bar + 1] : T) / T;
  const lights = prime.lights.map((l) => ({ i: l.i, x: l.time == null ? null : l.time / T, at: l.at, dark: l.time == null, chosen: chosen.has(l.i), struck: struck.has(l.i), inBar: l.bar === bar }));
  const r = prime.range;
  return { p: prime.p, drawn: !!prime.drawn, range: r ?? null, cells: prime.cells, lights, bar: { from, to },
    label: `p = ${prime.p}${prime.drawn ? ', drawn' : ', asked'}${r ? ` — a prime in (${r.above}, ${r.upTo}], one of ${r.primes}` : ''} · ${prime.cells} cells choose ${chosen.size} of the ${prime.p} lights` };
}
