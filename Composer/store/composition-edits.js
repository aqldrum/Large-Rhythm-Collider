// composition-edits.js — STEP 4d: the pure half of an entry's live edits (DESIGN_NOTES "Step 4d: store edits and pins").
// PURE: no DOM, no audio, no clock, no worker. The controller (perform/composer-controller.js) applies the edits
// through core/rearrange.js and keeps the derived spec; this module only reads and writes the records an entry holds.
//
//   orderedEdits(edits) → [{ kind: 'chord', bar, rootTone, quality, from, asked? } | { kind: 'lead', phrase, lineId,
//                         chordsFollow, smooth? } | { kind: 'clave', id?, relation? }] in the order they apply
//                         (edits.order; the clave choice, phase E, always last)
//   setChordEdit / removeChordEdit / setLeadEdit / removeLeadEdit (edits, …)   the records and their order kept in step
//   hasEdits(state), snapshotOf(state), restoreSnapshot(state, snap), pushUndo(state, snap)   (a snapshot holds the
//                       edits, the field, the pins, the drum mode and grid, (B2) the Arp modes, (phase H) the bass
//                       and the voicing, and (phase N) the comp's density)
//   pinOf(entry) → { ratio, quality } | null   (a progression entry: a ratio, { ratio, quality }, or auto)
//   asksOf(state, N) → [{ ratio, quality } | null] × N   what each bar asks now: its chord edit, else its pin
//   rewriteToken(text, bar, word) → the field's text with bar's symbol replaced (the rest of the user's text kept)
//   chordEventsOf(trace) / leadAlternatesOf(trace) / chordAlternates(state, bar) / leadAlternates(state, phrase)
//                       pure reads of the kept trace (12 chord candidates a bar, 8 runner-up lines a phrase)
//
// The order: an edit applies on top of the ones before it (a swap at bar 3, then one at bar 5, is rearrange twice).
// Changing an edit moves it to the end; removing one drops it. A swap to the chord Compose made removes the edit
// (proposed), so swapping back is the composed spec byte for byte (rearrange's own identity); a typed chord is kept
// even then (the user typed it: it is a pin on the next Compose).

import { UNDO_LIMIT, emptyEdits } from './composition-store.js';
import { phrasesOf } from '../core/harmony.js';
import { tokenizeField } from '../core/chord-symbols.js';

const copy = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
export const chordKey = (bar) => `chord:${bar}`;
export const leadKey = (phrase) => `lead:${phrase}`;

/** the edits in the order they apply; the clave choice last (phase E: it re-strums every bar over the chords as edited) */
export function orderedEdits(edits) {
  const out = [];
  for (const key of edits?.order ?? []) {
    const [kind, at] = key.split(':'), n = Number(at);
    if (kind === 'chord' && edits.chords[n]) out.push({ kind, bar: n, ...edits.chords[n] });
    else if (kind === 'lead' && edits.lead[n]) out.push({ kind, phrase: n, ...edits.lead[n] });
  }
  if (edits?.clave) out.push({ kind: 'clave', ...edits.clave });
  return out;
}
const moveToEnd = (edits, key) => { edits.order = [...edits.order.filter((k) => k !== key), key]; };
const drop = (edits, key) => { edits.order = edits.order.filter((k) => k !== key); };
export function setChordEdit(edits, bar, rec) { edits.chords[bar] = { ...rec }; moveToEnd(edits, chordKey(bar)); }
export function removeChordEdit(edits, bar) { if (!(bar in edits.chords)) return false; delete edits.chords[bar]; drop(edits, chordKey(bar)); return true; }
export function setLeadEdit(edits, phrase, rec) { edits.lead[phrase] = { ...rec }; moveToEnd(edits, leadKey(phrase)); }
export function removeLeadEdit(edits, phrase) { if (!(phrase in edits.lead)) return false; delete edits.lead[phrase]; drop(edits, leadKey(phrase)); return true; }
/** are two records the same (key order aside)? */
export const sameRecord = (a, b) => !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** does the entry hold a chord, lead or clave edit (the drum grid is apart: it lives in drumOptions) */
export const hasEdits = (state) => !!state?.edits && (state.edits.order.length > 0 || !!state.edits.clave);

/** what an undo step restores: the edits, the field, the pins, the drum mode and grid, (B2) the Arp modes, (phase H) the
 *  bass and the voicing, (phase N) the comp's density */
export function snapshotOf(state) {
  return { edits: copy(state.edits ?? emptyEdits()), field: copy(state.field ?? null), progression: copy(state.progression ?? []),
    drums: { mode: state.drumOptions.mode, grid: copy(state.drumOptions.grid ?? null) }, arps: copy(state.arps ?? null), bass: copy(state.bass ?? null), voicing: state.voicing ?? null,
    compDensity: state.compDensity ?? null };
}
export function restoreSnapshot(state, snap) {
  state.edits = copy(snap.edits);
  state.field = copy(snap.field);
  state.progression = copy(snap.progression);
  state.drumOptions.mode = snap.drums.mode;
  if (snap.drums.grid) state.drumOptions.grid = copy(snap.drums.grid); else delete state.drumOptions.grid;
  if (snap.arps) state.arps = copy(snap.arps);
  if (snap.bass) state.bass = copy(snap.bass);
  if (snap.voicing) state.voicing = snap.voicing;
  if (snap.compDensity) state.compDensity = snap.compDensity;
}
/** a step onto the undo stack (at most UNDO_LIMIT, the oldest dropped); a new edit clears the redo stack */
export function pushUndo(state, snap) {
  state.undo.push(snap);
  while (state.undo.length > UNDO_LIMIT) state.undo.shift();
  state.redo = [];
}

/** a progression entry → { ratio, quality } | null */
export function pinOf(x) {
  if (x == null || x === '' || x === 'auto') return null;
  if (typeof x === 'string') return { ratio: x, quality: null };
  const ratio = x.ratio ?? x.root;
  return typeof ratio === 'string' ? { ratio, quality: x.quality ?? null } : null;
}
/** what each bar asks now: its chord edit (as the pin it becomes: the asked quality of a typed chord), else its pin */
export function asksOf(state, N) {
  return Array.from({ length: N }, (_, k) => {
    const e = state.edits?.chords?.[k];
    if (e) return { ratio: e.rootTone, quality: 'asked' in e ? e.asked : e.quality };
    return pinOf(state.progression?.[k]);
  });
}

/** the field's text with bar's symbol replaced by `word` (the user's separators and spellings elsewhere kept); a bar
 *  past the text is reached with auto marks ('-'); trailing autos are cut */
export function rewriteToken(text, bar, word) {
  const s = String(text ?? ''), tokens = tokenizeField(s);
  let out;
  if (bar < tokens.length) { const t = tokens[bar]; out = s.slice(0, t.start) + word + s.slice(t.end); }
  else {
    if (word === '-') return s;
    const pad = Array(bar - tokens.length).fill('-');
    out = [s.replace(/\s+$/, ''), ...pad, word].filter((x) => x !== '').join(' ');
  }
  // trailing autos cut, as pinsToField writes them
  let t = tokenizeField(out);
  while (t.length && t[t.length - 1].text === '-') { out = out.slice(0, t[t.length - 1].start).replace(/[\s|,;]+$/, ''); t = tokenizeField(out); }
  return out;
}

/**
 * A chord chart's text (chart.js parseChart's `chart`) with the given chords' words, `wordAt(k)` for chord k: each written
 * in place when its chord is written once in the text (not a hold, no repeat or form plays that writing again), else the
 * whole chart is `unrolled()` (the chart written out played: Composer/CHART_ORDER.md P9, proposed). → string
 */
export function rewriteChart(text, chart, units, wordAt, unrolled) {
  const s = String(text ?? ''), uses = new Map();
  for (const sp of chart.spans) uses.set(sp.token.start, (uses.get(sp.token.start) ?? 0) + 1);
  const own = [...new Set(units)].map((k) => chart.spans[k]);
  if (own.some((sp) => !sp || sp.hold || uses.get(sp.token.start) > 1)) return unrolled();
  let out = s;
  for (const sp of own.sort((a, b) => b.token.start - a.token.start)) out = out.slice(0, sp.token.start) + wordAt(sp.index) + out.slice(sp.token.end);
  return out;
}

// ── the alternates: pure reads of the kept trace (STEP 4a: 12 candidates a bar, 8 runner-ups a phrase) ──
const chordMemo = new WeakMap(), leadMemo = new WeakMap();
/** the chosen round's chord events, by bar */
export function chordEventsOf(trace) {
  if (!trace?.events) return [];
  let v = chordMemo.get(trace);
  if (!v) {
    const h = trace.events.find((e) => e.kind === 'harmony');
    v = [];
    if (h) for (const e of trace.events) if (e.kind === 'chord' && e.round === h.chosenRound) v[e.span ?? e.bar] = e;   // a chart's split bars: by span
    chordMemo.set(trace, v);
  }
  return v;
}
/** per phrase: the line kept (its id) and the mining that made it (its runner-ups) */
export function leadAlternatesOf(trace) {
  if (!trace?.events) return [];
  let v = leadMemo.get(trace);
  if (!v) {
    const h = trace.events.find((e) => e.kind === 'harmony');
    v = (h?.lead?.phrases ?? []).map((id, p) => {
      const evs = trace.events.filter((e) => e.kind === 'lead' && e.phrase === p && e.mined && e.mined.id === id), ev = evs[evs.length - 1] ?? null;
      return { kept: id, perNote: ev?.mined?.perNote ?? null, runnersUp: ev ? ev.runnersUp.map((r) => ({ id: r.id, perNote: r.perNote })) : [] };
    });
    leadMemo.set(trace, v);
  }
  return v;
}
/** the phrase a bar is in, for a composition's meter */
export const phraseOfBar = (spec, bar) => phrasesOf({ bars: spec.knobs.bars, slotsPerBar: spec.knobs.slotsPerBar }).findIndex((p) => bar >= p.from && bar < p.from + p.bars);

/**
 * A bar's chord alternates: the trace's candidates for it (the chosen round's, up to 12), each marked `current` (what
 * the bar plays now, edits and all) and `composed` (Compose's pick).
 * → { part: 'chords', bar, pinned, empty, candidates: [{ …the trace's candidate, index, current, composed }],
 *     currentIndex (-1: the bar plays a chord that is not among them, a typed one say), composedIndex, current: the
 *     bar's chord now, edit: the bar's edit record | null } | null (no trace for it)
 */
export function chordAlternates(state, bar) {
  const ev = chordEventsOf(state.trace)[bar], cur = state.spec?.chords?.[bar];
  if (!ev || !cur) return null;
  const candidates = ev.candidates.map((c, i) => ({ ...c, index: i, current: !cur.empty && c.root.ratio === cur.rootTone && c.quality === cur.quality, composed: i === ev.pickIndex }));
  return { part: 'chords', bar, pinned: !!ev.pinned, empty: !!ev.empty, candidates, currentIndex: candidates.findIndex((c) => c.current), composedIndex: ev.pickIndex,
    current: { rootTone: cur.rootTone, quality: cur.quality, name: cur.name, empty: !!cur.empty }, edit: state.edits?.chords?.[bar] ? { ...state.edits.chords[bar] } : null };
}
/**
 * A phrase's lead alternates: the line Compose kept, then its mining's runner-ups (up to 8), each with its cost per
 * note under the composed chords and its shape from trace.lines, marked `current` and `kept`.
 * → { part: 'lead', phrase, from, bars, lines: [{ id, perNote, kept, current, band, motion, contour, notes (count) }],
 *     keptId, currentId, edit } | null
 */
export function leadAlternates(state, phrase) {
  const a = leadAlternatesOf(state.trace)[phrase], spec = state.spec;
  if (!a || !spec) return null;
  const span = phrasesOf({ bars: spec.knobs.bars, slotsPerBar: spec.knobs.slotsPerBar })[phrase];
  const edit = state.edits?.lead?.[phrase] ?? null, currentId = edit ? edit.lineId : a.kept;
  const line = (id, perNote, kept) => { const l = state.trace.lines?.[id]; return { id, perNote, kept, current: id === currentId, band: l?.band ?? null, motion: l?.motion ?? null, contour: l?.contour ?? null, notes: l?.notes?.length ?? 0 }; };
  return { part: 'lead', phrase, from: span.from, bars: span.bars, lines: [line(a.kept, a.perNote, true), ...a.runnersUp.map((r) => line(r.id, r.perNote, false))], keptId: a.kept, currentId, edit: edit ? { ...edit } : null };
}
