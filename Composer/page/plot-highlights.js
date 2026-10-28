// plot-highlights.js — the seam between a composition and the main page's Linear Plot: a pure "spec → per-part node
// highlights" mapping, the playhead's place on the plot, and which nodes sound at a moment. No DOM, no clock.
//
// The Linear Plot draws one dot per composite onset, in tick order: dot i is the onset at compositeRhythm[i] (LRCModule),
// x evenly spaced by i, y by the gap after it. The Composer's row is the same onsets in the same order (row.js), so a
// note's `node` is its dot. The mapping does not trust that: it finds each note's and each drum stroke's absolute
// `tick` among the plotted onsets (binary search, exact), so every highlighted index is a real dot of the rhythm that
// is plotted, and a spec of another rhythm maps to nothing (null).
//
//   highlightsOf({ spec, parts, drums, composed, picked }, plot) → { parts: { [id]: { indices, notes, enabled, color } }, … } | null
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
 *       that ran), asked (the lock asked), refused (why it fell back, or null), (hits, missedHits: a lock's; walkFill:
 *       the bars a walk can't fill; phase L) }, clave (phase N, P31: the comp's clave as it plays, a reference: { id, from,
 *       read, steps, span, pattern, patterns?, relation, strokes (how many), partner: { pattern, patterns?, strokes, shared },
 *       compDensity?, share?, tier?, reread (the bars a chord edit re-read the same clave in: `composed`, Compose's own
 *       spec, given; else none), picked (`picked`: a clave chosen in the window) }; absent in notes) } (BASS_VOICING_ORDER.md phase H: what the trace's caption says the
 *       chords, the bass and (phase N) the comp play as) }
 *   `missed` counts notes or strokes whose tick is not a plotted onset (never, for a matching spec).
 */
/** phase N: a spec clave as the caption reads it (counts, not the strokes); `was` Compose's own clave: the bars a chord edit
 *  re-read (the same clave, its strokes moved there: phase I, P20), `reread`; `picked` a clave chosen in the window */
function claveRefOf(c, was = null, picked = false) {
  const p = c.partner ?? {};
  const barKey = (x, k) => JSON.stringify((x?.strokes ?? []).filter((y) => y.bar === k).map((y) => y.node));
  const N = Math.max(0, ...(c.strokes ?? []).map((y) => y.bar + 1), ...(was?.strokes ?? []).map((y) => y.bar + 1));
  const reread = was && was.id === c.id && Array.isArray(c.strokes) && Array.isArray(was.strokes)
    ? Array.from({ length: N }, (_, k) => k).filter((k) => barKey(c, k) !== barKey(was, k) || barKey(c.partner, k) !== barKey(was.partner, k)) : [];
  return { id: c.id, from: { ...(c.from ?? {}) }, ...(c.read ? { read: c.read } : {}), steps: c.steps, span: c.span ?? 1, pattern: c.pattern, ...(c.patterns ? { patterns: [...c.patterns] } : {}),
    relation: c.relation, strokes: Array.isArray(c.strokes) ? c.strokes.length : c.strokes ?? 0,
    partner: { pattern: p.pattern, ...(p.patterns ? { patterns: [...p.patterns] } : {}), strokes: Array.isArray(p.strokes) ? p.strokes.length : p.strokes ?? 0, shared: p.shared ?? 0 },
    ...(c.compDensity ? { compDensity: { ...c.compDensity } } : {}), ...(c.share != null ? { share: c.share, tier: c.tier ?? null } : {}), reread, picked: !!picked };
}
export function highlightsOf({ spec, parts = null, drums = undefined, composed = null, picked = false } = {}, plot) {
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
    bass: arr ? { density: arr.density, lock: arr.stats?.lock ?? arr.lock, asked: arr.lock, refused: arr.refused ?? null,
      // phase L: the lock's hits covered and missed, and the bars a walk can't fill (bass.js' stats)
      ...(arr.stats?.hits != null ? { hits: arr.stats.hits, missedHits: arr.stats.missedHits } : {}), ...(arr.stats?.walkFill ? { walkFill: arr.stats.walkFill } : {}) }
      : { density: 'sparse', lock: 'free', asked: 'free', refused: null },
    // phase N (P31): the comp's clave as it plays (a clave picked in the window, its tier, the bars re-read under new chords)
    ...(spec.clave ? { clave: claveRefOf(spec.clave, composed?.clave ?? null, picked) } : {}) };
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
