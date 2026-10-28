// plot-highlights.js — the seam between a composition and the main page's Linear Plot: a pure "spec → per-part node
// highlights" mapping, the playhead's place on the plot, and which nodes sound at a moment. No DOM, no clock.
//
// The Linear Plot draws one dot per composite onset, in tick order: dot i is the onset at compositeRhythm[i] (LRCModule),
// x evenly spaced by i, y by the gap after it. The Composer's row is the same onsets in the same order (row.js), so a
// note's `node` is its dot. The mapping does not trust that: it finds each note's and each drum stroke's absolute
// `tick` among the plotted onsets (binary search, exact), so every highlighted index is a real dot of the rhythm that
// is plotted, and a spec of another rhythm maps to nothing (null).
//
//   highlightsOf({ spec, parts, drums }, plot) → { parts: { [id]: { indices, notes, enabled, color } }, … } | null
//   playheadAt(plot, phaseX, p, share)        → { index, frac, tick }: where spec time p (0..1 of the cycle) is
//   soundingAt(highlights, t)                 → [{ part, index }]: the dots sounding at spec time t (seconds)
//
// A later sprint animates Compose from its trace on this same canvas: a trace step is just another highlight set.
//
// Comping in chords (COMP_ARP_ORDER.md A4, P12): a strummed tone lights its own onset. A BORROWED tone (`borrowed`,
// `from`: the chord voice it takes its tone from) sounds on the stroke's onset with another onset's tone, so it lights
// its SOURCE onset instead, as a ring (hollow; `rings`), the way the MIDI clip's substitutes are marked in the matrix.
// Its source's tick is the chord voice's (`sourceTicks`), so it is found among the plotted onsets like any note.
//
// MIDI targets (phase B): a WINDOW composition loops on a window of the row's cycle (knobs.cycleSeconds the loop,
// knobs.rowCycleSeconds the row's cycle; target.js' window share W = loop / row cycle), from the phase. Its playhead
// walks the window on the full-cycle plot: phase + p × W (p the share of the loop). `share` is 1 for every other spec.

import { PART_IDS } from '../core/compose.js';

/** every part the plot lights, the drums last */
export const HIGHLIGHT_PARTS = Object.freeze([...PART_IDS, 'drums']);
/** a colour a part (proposed): apart from the four layer colours (#ff6b6b #4ecdc4 #00a638 #f9ca24) */
export const PART_COLORS = Object.freeze({ lead: '#ffffff', chords: '#c56cf0', comp: '#ff9ff3', bass: '#54a0ff', inner: '#ff9f43', drums: '#ff4757' });
export const PART_LABELS = Object.freeze({ lead: 'Lead', chords: 'Chords', comp: 'Comping', bass: 'Bass', inner: 'Inner', drums: 'Drums' });
/** how long a dot glows when its note is very short, and after a drum stroke (seconds) */
export const MIN_LIT_SECONDS = 0.08;
export const DRUM_LIT_SECONDS = 0.12;

const mod = (v, n) => ((v % n) + n) % n;

/** the plotted rhythm: { compositeRhythm (onset ticks, ascending), grid } → { ticks, grid, n } (null when empty) */
export function plotOf({ compositeRhythm, grid } = {}) {
  if (!compositeRhythm || !compositeRhythm.length || !(grid > 0)) return null;
  return { ticks: compositeRhythm, grid, n: compositeRhythm.length };
}
/** the index of an onset at exactly `tick`, or −1 */
export function indexOfTick(ticks, tick) {
  let lo = 0, hi = ticks.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, v = ticks[m]; if (v === tick) return m; if (v < tick) lo = m + 1; else hi = m - 1; }
  return -1;
}
/** the last onset at or before `tick` (the first onset is tick 0, so there always is one) */
export function nodeAtOrBefore(ticks, tick) {
  let lo = 0, hi = ticks.length - 1, at = ticks.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ticks[m] <= tick) { at = m; lo = m + 1; } else hi = m - 1; }
  return ticks[0] > tick ? ticks.length - 1 : at;
}
/** is this spec a composition of the plotted rhythm? (same grid, same onset count) */
export const matchesPlot = (spec, plot) => !!(spec && !spec.refused && plot && spec.stats && spec.stats.grid === plot.grid && spec.stats.onsets === plot.n);

/** the share of the row's cycle a spec's loop spans: a window's W (MIDI targets), else 1 */
export const loopShare = (spec) => (spec?.knobs?.rowCycleSeconds > 0 ? spec.knobs.cycleSeconds / spec.knobs.rowCycleSeconds : 1);

/** the ticks of the chord voices' onsets, by node (a borrowed comp tone's `from` is one of them) */
export function sourceTicks(chordsPart) {
  const m = new Map();
  for (const n of chordsPart?.notes ?? []) if (!m.has(n.node)) m.set(n.node, n.tick);
  return m;
}
/** the tick a note lights: its own, or a borrowed tone's source's (null when the source isn't among the chord voices) */
export const litTickOf = (n, sources) => (n.borrowed ? sources.get(n.from) ?? null : n.tick);

/**
 * The Composer's selections as a lit-node layer a part.
 *   spec    a Compose spec; parts: the parts as they play now (default the spec's); drums: as they play now (default
 *           the spec's)
 *   plot    plotOf(...) of the rhythm on the plot
 * → null when there is nothing to light (no spec, a refusal, or a spec of another rhythm), else
 *   { grid, n, cycleSeconds, phaseX, share (the loop's share of the row's cycle: loopShare), plot, missed, total,
 *     parts: { [id]: { id, color, enabled, indices (sorted, unique), notes: [{ index, time, end, ring? }] (by time),
 *       rings (sorted, unique: the borrowed tones' source onsets not lit otherwise; drawn hollow) } },
 *     arrangement: { voicing ('led' | 'close'), voicingStats (the voicing pass's, or null), bass: { density, lock (the one
 *       that ran), asked (the lock asked), refused (why it fell back, or null) } } (BASS_VOICING_ORDER.md phase H: what
 *       the trace's caption says the chords and the bass play as) }
 *   `missed` counts notes or strokes whose tick is not a plotted onset (never, for a matching spec).
 */
export function highlightsOf({ spec, parts = null, drums = undefined } = {}, plot) {
  if (!matchesPlot(spec, plot)) return null;
  const T = spec.knobs.cycleSeconds, phase = spec.knobs.phase, out = {};
  let missed = 0, total = 0;
  const byId = Object.fromEntries((parts || spec.parts).map((p) => [p.id, p]));
  const sources = sourceTicks(byId.chords);
  const lane = (id, color, enabled, items, litFor) => {
    const notes = [], seen = new Set(), ringed = new Set();
    for (const it of items) {
      total++;
      const tick = litTickOf(it, sources), index = tick == null ? -1 : indexOfTick(plot.ticks, tick);
      if (index < 0) { missed++; continue; }
      if (it.borrowed) { ringed.add(index); notes.push({ index, time: it.time, end: it.time + litFor(it), ring: true }); continue; }
      seen.add(index);
      notes.push({ index, time: it.time, end: it.time + litFor(it) });
    }
    notes.sort((a, b) => a.time - b.time || a.index - b.index);
    out[id] = { id, color, enabled, indices: [...seen].sort((a, b) => a - b), notes, rings: [...ringed].filter((i) => !seen.has(i)).sort((a, b) => a - b) };
  };
  for (const id of PART_IDS) {
    const p = byId[id];
    if (p) lane(id, PART_COLORS[id], p.enabled !== false, p.notes, (n) => Math.max(n.duration || 0, MIN_LIT_SECONDS));
  }
  const d = drums === undefined ? spec.drums : drums;
  if (d && d.hits) lane('drums', PART_COLORS.drums, d.enabled !== false, d.hits, () => DRUM_LIT_SECONDS);
  // phase H: the chords' voicing, and the bass's density and lock (an arranged bass's own record; else Compose's: Sparse · Free)
  const arr = byId.bass?.bass;
  const arrangement = { voicing: spec.stats?.voicing ? 'led' : 'close', voicingStats: spec.stats?.voicing ?? null,
    bass: arr ? { density: arr.density, lock: arr.stats?.lock ?? arr.lock, asked: arr.lock, refused: arr.refused ?? null } : { density: 'sparse', lock: 'free', asked: 'free', refused: null } };
  return { grid: plot.grid, n: plot.n, cycleSeconds: T, phaseX: phase[0] / phase[1], share: loopShare(spec), plot, parts: out, missed, total, arrangement };
}

/**
 * Where the playhead is on the plot: spec time p (0..1 of the cycle, counted from the composition's downbeat, as the
 * player's playhead() is) → the absolute tick, the onset at or before it (`index`, a dot) and how far into that onset's
 * gap it is (`frac`, 0..1). The plot's x is by index, so the playhead steps evenly from dot to dot, however uneven
 * the gaps. `share` (MIDI targets: a window's W) scales the loop onto the row's cycle: phase + p × share.
 */
export function playheadAt(plot, phaseX, p, share = 1) {
  const x = mod(phaseX + mod(p, 1) * share, 1), tick = x * plot.grid;
  // a time computed from a tick (tick / grid − phase) × T comes back a hair under it: a relative 1e-12 of the grid
  // finds the onset itself (the smallest gap of any row Compose takes is far wider)
  const index = nodeAtOrBefore(plot.ticks, tick + plot.grid * 1e-12), start = plot.ticks[index];
  const next = index + 1 < plot.n ? plot.ticks[index + 1] : plot.grid + plot.ticks[0];
  const frac = next > start ? Math.min(1, Math.max(0, (tick - start) / (next - start))) : 0;
  return { index, frac, tick };
}
/** the playhead's x from the plotted dots' positions (LRCVisuals.allDotPositions): from dot index toward the next; the
 *  last dot's gap (the wrap) holds at the last dot */
export function playheadX(positions, { index, frac }) {
  const a = positions[index];
  if (!a) return null;
  const b = positions[index + 1];
  return b ? a.x + (b.x - a.x) * frac : a.x;
}
/** the dots sounding at spec time t (seconds into the cycle): each note from its time until its end (wrapping the
 *  loop), each stroke briefly → [{ part, index }] */
export function soundingAt(highlights, t) {
  if (!highlights) return [];
  const T = highlights.cycleSeconds, out = [];
  for (const h of Object.values(highlights.parts)) {
    if (!h.enabled) continue;
    for (const n of h.notes) {
      if ((t >= n.time && t < n.end) || (n.end > T && t + T < n.end && t + T >= n.time)) out.push({ part: h.id, index: n.index });
    }
  }
  return out;
}
