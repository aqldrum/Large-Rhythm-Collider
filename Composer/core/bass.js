// bass.js — the bass's densities and its lock (Composer/BASS_VOICING_ORDER.md, phase G: P10–P15; Amendment 1's phase J:
// P22–P24): the bass mined bar by bar against its chord as Compose mines it, at one of four densities, landing anywhere
// or covering the kick's hits or the comp's strokes, each bar offering its runner-ups.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. Like the arp (arp.js `arrangeArp`), the bass is
// an arrangement over a finished spec: `arrangeBass(spec, materials, { density, lock, picks })` reads the spec and its
// materials (rearrange.js `materialsOf`: the row and the cells) and rebuilds the bass part, with no re-compose, so a
// switch is live. The default (Sparse, Free, no picks) is the bass Compose mined before Amendment 2 byte for byte (P10).
// Compose's own is now Moving · Kick (Amendment 2, rule 11, P28: COMPOSE_BASS), arranged by `arrangeBass` itself inside
// compose.js once the drums are, so arrangeBass at Moving · Kick over a default spec gives its bass again byte for byte;
// `bass: { density: 'sparse', lock: 'free' }` asks Compose for the bass before (no record), which pins the fixtures.
// What is decided (Avery, 2026-10-27: the order's Decided 1–2) and what is proposed (P10–P15, the builder's calls):
//
//   chords     the spec's chords rebuilt as harmony.js' records by rearrange.js' own path (`chordRecordsOf`), the targets
//              harmony.js `targetsOf` over them (Compose's own: the parent scale the union of the chords' classes). A bar
//              is mined against its chord (a chart's split bar over the whole bar, each span's target; it opens on the
//              first span's root), two octaves under the lead's range (compose.js REGISTER.bass), as compose.js
//              `bassOfBar` mines it: a line opening on a tone of the root's class (inside the frame) where it can.
//   densities  (decided 1, P11)
//                roots    a chord (a chart's span) one note: of the onsets its slots' windows hold, the root-class one
//                         nearest the chord's first anchor (ties: the one before it, then the earlier onset), in the
//                         bass's register (the lowest at or over the root less 2450¢, as Compose's root fallback); none:
//                         the chord's root onset, Compose's fallback.
//                sparse   lines.js' bass band `sparse` (20–35 % of the slots): Compose's bass.
//                moving   the band `mid` (40–60 %, strictness 1.5: the lead's mid band, two octaves down).
//                walking  the band `walking`: every slot of its clock (`maxGap` 1), the stepwise motion only, with the next
//                         chord's root (the bar after's first chord; the last bar's is bar 1's) as the line's `after`
//                         boundary (STEP 4a's rule), so its last move approaches the change. The pitch is the root's in
//                         the bass's register, cents above 1/1 as a candidate's (the bars' retunes aside, as STEP 4a's
//                         boundaries read them). The clock is the bar's slots, halved while above 8 and even (16 → 8,
//                         12 → 6): buildCells at that many anchors a bar, the spec's anchors mode and phase (a MIDI
//                         target's cut cropped to its bars), as arp.js builds its S × time cells (proposed).
//              Moving and Walking, mining nothing, mine again with `weakTies` (lines.js; arp.js M6). Sparse is Compose's
//              and never does. A mined density with no line falls back as Compose does: Free (or a locked bar with no hit
//              to cover), the chord's root onset; locked, Roots at the lock (a root on every hit).
//              Walking's fill (rule 5, P22): a bar whose full walk mines nothing (plain, then weak ties) walks the most
//              notes it can, max(2, the hits) up to one short of full, stepwise, `maxGap` lifted, the approach kept, under
//              weak ties: one mine of lines.js' Walking band at those counts with `most` (the largest count with a line,
//              the cheapest there; the same as the order's ladder W − 1, W − 2, … 2, first count wins). Only with no
//              such line does the bar fall back. `walkFill` (the count) on the bar; the stats count the bars and notes.
//   lock       (decided 2, rule 7, P23) a lock covers its HITS, and the density adds the rest:
//                free     no hits (the miner's own choice).
//                kick     a hit a kick hit (`spec.drums`), its onsets those within ¼ of the hit's slot of it in time
//                         (around the cycle), its own onset the one it landed on. The drums off (`drums: false`, or not
//                         enabled), or no kick in the mode: the lock falls back to Free and says why (`bassLockRefusal`;
//                         `stats.lock` says what ran).
//                clave    a hit a stroke of compose.js `compSourceOf(spec.clave)` (the clave's in Sync, its partner's in
//                         Fill), its onset the stroke's. A spec that comps in notes has no clave: Free, with the reason.
//              On a clock (the spec's slots, or Walking's) a hit is in the slot of its own onset (its window's, else the
//              nearest anchor's), and hits in one slot are one hit. A hit keeps its onsets inside that slot's frame;
//              with none it is MISSED: it rests (its slot's window onsets avoided) and is counted (`missedHits`).
//              Mined densities: lines.js' opt-in `requireNodes`, each hit's slot sounding on one of its in-frame onsets
//              (at most HIT_MOMENTS, the nearest it: a window's width, proposed), the other slots free. Sparse and
//              Moving count the whole bar, hits included (lines.js `coveredNotes`: the band's share of the bar to the
//              nearest note, at least the hits: a backbeat's 8 slots give Sparse 2–3, Moving 3–5). Walking every slot
//              but a missed hit's, the hits' on the hits (`maxGap` the longest run of missed slots plus one), then the
//              fill. Roots: a root on every hit, its root-class onset nearest the hit, else its chord-tone one, else its
//              own (its in-frame onset nearest it); a chord with no hit rests.
//   offers     (P13, P24) each bar offers its best BASS_ALTERNATES (8) lines at the density and lock: the lines opening on
//              the root's class first, then the rest, each in mineLines' order (cost per note, the whole cost, the id),
//              one of an id; the first is Compose's choice (a fill offers only lines at its count). Roots (rule 9, P24):
//              a chord's candidates are every root-class onset in frame in its windows, one a tone a slot, nearest the
//              chord's first anchor first (then the one before it, then the lower node); locked, a hit's are its
//              root-class onsets, nearest the hit (none: its one note). A bar offers up to 8 combinations of its chords'
//              (hits') candidates by summed distance (then by their ranks, in order), the first Roots' own note.
//              `picks: { [bar]: id }` chooses one; a pick the bar no longer offers plays the first and is recorded as
//              `missed`. The window drops picks on a change of density or lock (the arp's Time rule: Phase H).
//   rooted     (P15) a bar's first note on its (first) chord's root class, Compose's `bassRooted`; `onDown` a bar with a
//              note on its first slot.
//
// The result is the part as the spec has it (compose.js partOf's shape: it replaces the bass in spec.parts) with:
//   bass   { density, lock, picks (as asked), stats, bars, (refused: the lock's reason, when it fell back to Free) }
//            stats  { density, lock (the one that ran), bars, notes, perBar, rooted, onDown, mined, fallback, rests,
//                     (locked: lockedSlots and hits, the hits (a slot each) on the clock each bar played, missedHits),
//                     (walkFill, walkFillNotes: the bars that walked less than full, and their notes), (weakTies: bars
//                     mined only with ties) }
//            bars   [{ bar, how ('mined' | 'roots' | 'root onset' | 'locked roots' | 'rest'), picked (an alternate's id, or
//                     null), alternates, notes (how many), rooted, onDown, (locked: lockedSlots = hits, missedHits,
//                     missedSlots (the spec's slots)), (walkFill: its count), (weakTies), (missed) }]
//              alternate  { id, band, contour, motion, n, cost, perNote, rooted, notes: [{ slot (the spec's), node, octave }] }
//                         (Roots: { id, band: 'roots', n, rooted, distance (summed, in slots), notes: [{ slot, node,
//                         octave, ratio, cents (off its chord's root: `centsOffRoot`), root (on the root's class) }]:
//                         Amendment 2, P29) })
// Deterministic: no draws. The same spec, materials and options give byte-identical output.

import { partContext, partOf, compSourceOf } from './compose.js';
import { buildCells, cropCells } from './cells.js';
import { mineLines, fnv1aHex, LINE_TYPES } from './lines.js';
import { harmonyOver, targetsOf } from './harmony.js';
import { classOfCents } from './frame.js';
import { chordRecordsOf } from './rearrange.js';

export const COMPOSER_BASS_VERSION = 'composer-bass-v1';
export const BASS_DENSITIES = Object.freeze(['roots', 'sparse', 'moving', 'walking']);
export const BASS_LOCKS = Object.freeze(['free', 'kick', 'clave']);
export const BASS_DEFAULTS = Object.freeze({ density: 'sparse', lock: 'free', picks: Object.freeze({}) });
/** Compose's own bass (BASS_VOICING_ORDER.md Amendment 2, rule 11, P28): Moving, covering the kick. arrangeBass's options
 *  still default to BASS_DEFAULTS (Sparse · Free: the bass Compose mined before, which `bass: { density: 'sparse', lock:
 *  'free' }` asks Compose for) */
export const COMPOSE_BASS = Object.freeze({ density: 'moving', lock: 'kick' });
/** a bar offers this many ranked lines (P13) */
export const BASS_ALTERNATES = 8;
/** two octaves under the lead's range (compose.js REGISTER.bass) */
export const BASS_REGISTER = -2400;
/** the kick lock's reach either side of a hit: this share of the hit's slot (P12) */
export const KICK_WINDOW = 0.25;
/** a mined line's hit sounds on one of its in-frame onsets nearest it, at most this many (a window's width, cells.js
 *  DEFAULT_MOMENTS: a kick on the 16k row reaches ~127 onsets, ~38 in frame; Roots reads them all) (P23, proposed) */
export const HIT_MOMENTS = 12;
/** Walking's clock: the bar's slots, halved while above this (and even) (P11) */
export const WALK_MAX = 8;
/** each mined density's band in lines.js' bass type */
export const BASS_BANDS_OF = Object.freeze({ sparse: 'sparse', moving: 'mid', walking: 'walking' });
const EPS = 1e-9;
const mod = (v, n) => ((v % n) + n) % n;
const fail = (what) => { throw new Error(`composer/bass: ${what}`); };

/** the options checked, with the defaults filled → { density, lock, picks } (picks copied: { [bar]: id }) */
export function readBassOptions(options = {}) {
  const o = { ...BASS_DEFAULTS, ...Object.fromEntries(Object.entries(options ?? {}).filter(([, v]) => v !== undefined)) };
  for (const k of Object.keys(o)) if (!(k in BASS_DEFAULTS)) fail(`no bass option "${k}" (the options are ${Object.keys(BASS_DEFAULTS).join(', ')})`);
  if (!BASS_DENSITIES.includes(o.density)) fail(`density must be one of ${BASS_DENSITIES.join(', ')}, not ${JSON.stringify(o.density)}`);
  if (!BASS_LOCKS.includes(o.lock)) fail(`lock must be one of ${BASS_LOCKS.join(', ')}, not ${JSON.stringify(o.lock)}`);
  if (!o.picks || typeof o.picks !== 'object' || Array.isArray(o.picks)) fail(`picks must be { [bar]: id }, not ${JSON.stringify(o.picks)}`);
  const picks = {};
  for (const [b, id] of Object.entries(o.picks)) {
    if (!/^\d+$/.test(b) || typeof id !== 'string') fail(`a pick is { [bar index]: a line's id }, not ${JSON.stringify({ [b]: id })}`);
    picks[b] = id;
  }
  return { density: o.density, lock: o.lock, picks };
}

/** why the bass of this spec can't lock this way, or null (the window's switch greys itself with this as its title) */
export function bassLockRefusal(spec, lock) {
  if (!spec || spec.refused) return 'there is no composition to arrange';
  if (lock === 'kick') {
    if (!spec.drums || !spec.drums.enabled) return 'the drums are off: there is no kick to land on';
    if (!spec.drums.hits.some((h) => h.voice === 'kick')) return `the drums' ${spec.drums.mode} mode strikes no kick`;
  }
  if (lock === 'clave') {
    if (!spec.clave) return 'this composition comps in notes (compStyle \'notes\'): there is no clave to land on';
    if (!compSourceOf(spec.clave).length) return 'the comp\'s clave lands no strokes';
  }
  return null;
}

/** the words a lock's hit is counted in */
const HIT_WORDS = Object.freeze({ kick: 'kick', clave: 'comp stroke' });
/** each density in a few words (the decision's) */
const DENSITY_WORDS = Object.freeze({ roots: 'a root a chord', sparse: 'lines.js\' sparse band (20–35 % of the slots)', moving: 'the mid band (40–60 % of the slots)', walking: 'every slot of its clock, stepwise' });
const cap = (x) => x[0].toUpperCase() + x.slice(1);
/**
 * The bass decision's words (compose.js, Amendment 2 P28): Compose's default (Moving · Kick) or asked, a lock refused and
 * why, the density, the hits covered, and what played. `B` an arranged part's `bass`; `asked` whether `bass` was asked.
 */
export function bassWhy(B, asked = false) {
  const S = B.stats;
  const head = asked ? 'asked' : `${cap(COMPOSE_BASS.density)} · ${cap(COMPOSE_BASS.lock)} by default (rule 11, Avery)`;
  const refused = B.refused ? `, but ${B.refused}, so ${cap(B.density)} · Free` : '';
  const lock = S.lock === 'free' ? 'landing anywhere' : `every ${HIT_WORDS[S.lock]} covered on one of its in-frame onsets (${S.hits - S.missedHits} of ${S.hits}${S.missedHits ? `; ${S.missedHits} missed: no onset in frame there, so it rests` : ''}), the density adding the rest`;
  return `${head}${refused}: ${DENSITY_WORDS[S.density]}, ${lock}; ${S.notes} notes (${S.perBar.toFixed(2)} a bar), ${S.rooted} of ${S.bars} bars opening on the root's class, ${S.mined} mined${S.fallback ? `, ${S.fallback} fell back` : ''}${S.walkFill ? `, ${S.walkFill} walking what they can` : ''}`;
}

/** Walking's clock: S slots a bar, halved while above WALK_MAX and even */
export function walkClock(S) { let w = S; while (w > WALK_MAX && w % 2 === 0) w /= 2; return w; }

/**
 * The lock's hits (P12, P23): null for Free; a lock refused falls back to Free with its reason.
 *   ctx  the spec's part context (compose.js partContext)
 * → { lock (the one that runs), hits ([{ own, x, nodes }], or null), nodes (Set: every hit's onsets, or null), refused }
 *   hit  Kick: a kick hit, `own` its landed onset (the lowest at its tick), `x` its place on the cycle, `nodes` the onsets
 *        within ¼ of the hit's slot of it in time (around the cycle). Clave: a comp stroke (compSourceOf), its onset.
 */
export function bassLockOf(spec, ctx, lock) {
  if (lock === 'free') return { lock, hits: null, nodes: null, refused: null };
  const refused = bassLockRefusal(spec, lock);
  if (refused) return { lock: 'free', hits: null, nodes: null, refused };
  const { row } = ctx;
  let hits;
  if (lock === 'clave') hits = compSourceOf(spec.clave).map((x) => ({ own: x.node, x: row.x[x.node], nodes: [x.node] }));
  else {
    const { P, T, timeOf, slotSeconds, inSlot } = ctx;
    hits = [];
    for (const h of spec.drums.hits) {
      if (h.voice !== 'kick') continue;
      const t = timeOf(h.tick), w = KICK_WINDOW * slotSeconds(h.slot) + EPS, got = new Set();
      // a quarter slot reaches at most into the slots either side
      for (const j of [mod(h.slot - 1, P), h.slot, mod(h.slot + 1, P)]) for (const i of inSlot[j]) {
        const d = Math.abs(timeOf(row.tick[i]) - t);
        if (Math.min(d, T - d) <= w) got.add(i);
      }
      if (!got.size) for (let i = 0; i < row.n; i++) if (row.tick[i] === h.tick) got.add(i);   // a landing past the slots either side
      if (!got.size) continue;
      const nodes = [...got].sort((a, b) => a - b), own = nodes.find((i) => row.tick[i] === h.tick) ?? nodes[0];
      hits.push({ own, x: row.x[own], nodes });
    }
  }
  return { lock, hits, nodes: new Set(hits.flatMap((h) => h.nodes)), refused: null };
}

// per materials' cells: Walking's cells at the halved clock (and the knobs their windows read)
const walkKept = new WeakMap();
/** Walking's cells: the spec's own at S slots a bar, else buildCells at its clock (a target's cut cropped), kept */
export function bassWalkCells(spec, materials) {
  const { row, cells } = materials, k = spec.knobs, W = walkClock(k.slotsPerBar);
  if (W === k.slotsPerBar) return cells;
  let kept = walkKept.get(cells);
  if (!kept) walkKept.set(cells, (kept = new Map()));
  const key = `${W}|${k.anchors}|${k.phase.join('/')}|${k.bars}|${k.cut ? k.cut.bars : ''}`;
  let got = kept.get(key);
  if (!got) {
    const opts = { slotsPerBar: W, anchors: k.anchors, phase: k.phase };
    got = k.cut ? cropCells(buildCells(row, { bars: k.cut.bars, ...opts }), k.bars) : buildCells(row, { bars: k.bars, ...opts });
    kept.set(key, got);
  }
  return got;
}

// per cells: each slot's window's onsets (cells.slotOfNode inverted), built once
const windowsKept = new WeakMap();
function windowsOf(cells) {
  let w = windowsKept.get(cells);
  if (!w) {
    w = Array.from({ length: cells.P }, () => []);
    cells.slotOfNode.forEach((j, i) => { if (j >= 0) w[j].push(i); });
    windowsKept.set(cells, w);
  }
  return w;
}

/** a node's slot on a clock: its window's, else the slot whose anchor is nearest it (the one before it on a tie), within
 *  that slot's length; else −1 (a cropped clock's onset far outside its window) */
function cellOfNode(row, cells, i) {
  const j = cells.slotOfNode[i];
  if (j >= 0) return j;
  let best = -1, bd = Infinity, bs = 0;
  cells.slots.forEach((s, c) => { let d = row.x[i] - s.anchor; d -= Math.round(d); const ad = Math.abs(d); if (ad < bd - EPS || (Math.abs(ad - bd) <= EPS && d > bs)) { best = c; bd = ad; bs = d; } });
  return best >= 0 && bd <= cells.slots[best].length + EPS ? best : -1;
}
// per hits (a lock's) and clock: each hit's slot, worked out once
const hitCellsKept = new WeakMap();
function hitCells(row, cells, hits) {
  let m = hitCellsKept.get(hits);
  if (!m) hitCellsKept.set(hits, (m = new WeakMap()));
  let got = m.get(cells);
  if (!got) { got = Int32Array.from(hits, (h) => cellOfNode(row, cells, h.own)); m.set(cells, got); }
  return got;
}
/**
 * Bar k's hits on a clock (P23): each hit in the slot of its own onset; hits in one slot are one hit, their onsets
 * together. A hit keeps its onsets inside the slot's frame (`frameOf(cell)`); with none it is missed (it rests).
 * → { groups: [{ cell, nodes (in frame, ascending), xs (the hits' places) }], missed: [{ cell, nodes: [], xs }] }, by cell
 */
function hitsOfBar(ctx, cells, k, hits, frameOf) {
  const { row } = ctx, SU = cells.slotsPerBar, at = hitCells(row, cells, hits), by = new Map();
  hits.forEach((h, q) => {
    const c = at[q];
    if (!(c >= k * SU && c < (k + 1) * SU)) return;
    let g = by.get(c);
    if (!g) by.set(c, (g = { cell: c, all: new Set(), xs: [] }));
    for (const i of h.nodes) g.all.add(i);
    g.xs.push(h.x);
  });
  const groups = [], missed = [];
  for (const g of [...by.values()].sort((a, b) => a.cell - b.cell)) {
    const f = frameOf(g.cell), nodes = [...g.all].filter((i) => f.inside[row.tone[i]]).sort((a, b) => a - b);
    (nodes.length ? groups : missed).push({ cell: g.cell, nodes, xs: g.xs });
  }
  return { groups, missed };
}
/** an onset's distance from a hit's places, in cycles: { d (the nearest, unsigned), s (signed: before it is negative) } */
function fromHit(row, xs, i) {
  let d = Infinity, s = 0;
  for (const x of xs) { let v = row.x[i] - x; v -= Math.round(v); if (Math.abs(v) < d - EPS || (Math.abs(Math.abs(v) - d) <= EPS && v < s)) { d = Math.abs(v); s = v; } }
  return { d, s };
}
/** nearest first, then the one before, then the lower node (P11, P24) */
const nearestFirst = (a, b) => (Math.abs(a.d - b.d) > EPS ? a.d - b.d : Math.abs(a.s - b.s) > EPS ? a.s - b.s : a.i - b.i);
/** the chord of spec slot j in bar k (a chart's split bar: its span's) */
const chordAt = (recs, k, j) => { const units = unitsOfBar(recs, k); return recs[units.find((u) => recs[u].slots != null && j >= recs[u].from && j < recs[u].from + recs[u].slots) ?? units[0]]; };
/**
 * The top `cap` combinations of one candidate from each list (each list ranked, its entries' `d` their distances), by
 * summed distance, then by their ranks in order (P24). → [{ picks, sum }]
 */
function bestCombos(lists, cap) {
  let combos = [{ sum: 0, ranks: [], picks: [] }];
  const lexi = (a, b) => { for (let q = 0; q < a.length; q++) if (a[q] !== b[q]) return a[q] - b[q]; return 0; };
  for (const list of lists) {
    const next = [];
    for (const c of combos) for (let r = 0; r < Math.min(cap, list.length); r++) next.push({ sum: c.sum + list[r].d, ranks: [...c.ranks, r], picks: [...c.picks, list[r]] });
    next.sort((a, b) => (Math.abs(a.sum - b.sum) > EPS ? a.sum - b.sum : lexi(a.ranks, b.ranks)));
    combos = next.slice(0, cap);
  }
  return combos;
}

/** a chord's slots [from, to) in bar k: its span's, or the bar's */
const unitRange = (c, k, S) => (c.slots != null ? { from: c.from, to: c.from + c.slots } : { from: k * S, to: (k + 1) * S });
/** the units (chord records' indices) of bar k */
const unitsOfBar = (recs, k) => (recs.some((c) => c.slots != null) ? recs.flatMap((c, u) => (c.bar === k ? [u] : [])) : [k]);
/** is a tone in the chord's root class, inside the frame (compose.js bassOfBar's test) */
const inRootClass = (ctx, c, tone) => { const q = classOfCents(ctx.row.toneCents[tone] - c.rootCents); return q.pc === 0 && Math.abs(q.dev) <= ctx.e + EPS; };

/** Compose's root-onset fallback note (compose.js bassOfBar), or none */
function rootOnsetNotes(ctx, c, k) {
  const { row, timeOf, slotSeconds, posSlot, pitchAtLeast } = ctx;
  if (c.rootNode == null) return [];
  const { octave, pitch } = pitchAtLeast(c.rootTone, c.rootCents + BASS_REGISTER - 50);
  return [{ node: c.rootNode, tone: c.rootTone, octave, pitch, bar: k, slot: posSlot[c.rootNode], time: timeOf(row.tick[c.rootNode]), slotSeconds: slotSeconds(posSlot[c.rootNode]) }];
}

/**
 * Roots (P11, P23, P24) over bar k on the spec's clock, each candidate ranked. Free: a chord (a span) one note, its
 * candidates every root-class onset (in frame) its slots' windows hold, nearest the chord's first anchor first (then the
 * one before it, then the lower node), one a tone a slot; none: Compose's root onset, its only one. Locked: every hit a
 * note, its candidates its root-class onsets (in frame, one a tone) nearest the hit first; none: its chord-tone one
 * nearest it, else its own (its in-frame onset nearest it), its only one; a hit with no onset in frame rests (missed); a
 * chord with no hit rests.
 * → { lists (a chord's, or a hit's, ranked: [{ note (a builder note), d (its distance, cycles) }]), hits, missed (cells) }
 */
function rootsOfBar(ctx, recs, k, hits) {
  const { row, cells, S, timeOf, slotSeconds, pitchAtLeast, chordClass } = ctx, win = windowsOf(cells), lists = [];
  const noteOf = (i, j, c) => { const tone = row.tone[i], { octave, pitch } = pitchAtLeast(tone, c.rootCents + BASS_REGISTER - 50); return { node: i, tone, octave, pitch, bar: k, slot: j, time: timeOf(row.tick[i]), slotSeconds: slotSeconds(j) }; };
  if (!hits) {
    for (const u of unitsOfBar(recs, k)) {
      const c = recs[u], { from, to } = unitRange(c, k, S), a0 = cells.slots[from].anchor, placed = [];
      // each onset's place from the chord's first anchor, in cycles: its slot's anchor, and its offset from it
      for (let j = from; j < to; j++) {
        const lead = mod(cells.slots[j].anchor - a0, 1);
        for (const i of win[j]) { if (!inRootClass(ctx, c, row.tone[i])) continue; const d = row.x[i] - cells.slots[j].anchor, at = lead + d - Math.round(d); placed.push({ i, j, d: Math.abs(at), s: at }); }
      }
      if (placed.length) lists.push(onePerTone(row, placed.sort(nearestFirst), (x) => x.j).map((x) => ({ note: noteOf(x.i, x.j, c), d: x.d })));
      else { const fb = rootOnsetNotes(ctx, c, k); if (fb.length) lists.push([{ note: fb[0], d: 0 }]); }
    }
    return { lists, hits: 0, missed: [] };
  }
  const { groups, missed } = hitsOfBar(ctx, cells, k, hits, (j) => chordAt(recs, k, j).frame);
  for (const g of groups) {
    const c = chordAt(recs, k, g.cell), ranked = g.nodes.map((i) => ({ i, ...fromHit(row, g.xs, i) })).sort(nearestFirst);
    const root = onePerTone(row, ranked.filter((x) => inRootClass(ctx, c, row.tone[x.i])), () => g.cell);
    const list = root.length ? root : [ranked.find((x) => chordClass(c, row.tone[x.i]) >= 0) ?? ranked[0]];
    lists.push(list.map((x) => ({ note: noteOf(x.i, g.cell, c), d: x.d })));
  }
  return { lists, hits: groups.length + missed.length, missed: missed.map((g) => g.cell) };
}
/** a ranked list kept to one onset a tone a slot (its first: the nearest), as a window keeps a tone (a note is its slot,
 *  tone and octave: two onsets of one tone in one slot would be one runner-up twice) */
const onePerTone = (row, list, slotOf) => { const seen = new Set(); return list.filter((x) => { const key = `${slotOf(x)}:${row.tone[x.i]}`; if (seen.has(key)) return false; seen.add(key); return true; }); };
/** a tone's cents off chord c's root, reduced to the nearest octave of it ((−600, 600]; a root-class tone's its offset
 *  inside the frame), to a thousandth (Amendment 2, rule 12, P29: Roots' runner-ups are named by it) */
export function centsOffRoot(row, c, tone) {
  let d = row.toneCents[tone] - c.rootCents;
  d -= 1200 * Math.round(d / 1200);
  if (d <= -600) d += 1200;
  return Math.round(d * 1000) / 1000 || 0;
}
/** Roots' offer over its ranked lists (P24): up to BASS_ALTERNATES combinations, the first Roots' own note(s) → [{ alt, notes }].
 *  Amendment 2 (rule 12, P29): each note also carries its tone (`ratio`), its cents off its chord's root (`cents`) and
 *  whether it is on the root's class (`root`), so the window names it with no row (a big row's lives in the worker) */
function rootsOffer(ctx, recs, k, lists, toSlots) {
  const { row } = ctx, c = recs[unitsOfBar(recs, k)[0]];
  if (!lists.length) return [];
  const named = (n) => { const own = chordAt(recs, k, n.slot); return { ratio: row.tones[n.tone], cents: centsOffRoot(row, own, n.tone), root: inRootClass(ctx, own, n.tone) }; };
  return bestCombos(lists, BASS_ALTERNATES).map((cmb) => {
    const notes = cmb.picks.map((x) => x.note), serial = `roots|${k}|${notes.map((n) => `${n.slot}:${row.tones[n.tone]}:${n.octave}`).join(',')}`;
    return { notes, alt: { id: `rt1:${fnv1aHex(serial)}`, band: 'roots', n: notes.length, rooted: inRootClass(ctx, c, notes[0].tone), distance: cmb.sum * toSlots, notes: notes.map((n) => ({ slot: n.slot, node: n.node, octave: n.octave, ...named(n) })) } };
  });
}

/** the frames and targets of bar k on a clock of SU slots a bar (S, or Walking's halved clock) */
function barHarmony(recs, targets, k, S, SU) {
  const split = recs.some((c) => c.slots != null);
  if (!split) return { frames: [recs[k].frame], targets: { scale: targets.scale, bars: [targets.bars[k]] } };
  if (SU === S) { const over = harmonyOver(recs, targets, k, 1, S); return { frames: over.frames, targets: { scale: targets.scale, bars: over.targets.bars } }; }
  // a split bar on the halved clock: each clock slot read under the chord of the spec slot its anchor sits on
  const units = unitsOfBar(recs, k), r = S / SU, frames = [], count = new Map();
  for (let c = 0; c < SU; c++) {
    const j = k * S + c * r, u = units.find((x) => j >= recs[x].from && j < recs[x].from + recs[x].slots);
    frames.push(recs[u].frame);
    count.set(u, (count.get(u) ?? 0) + 1);
  }
  return { frames, targets: { scale: targets.scale, bars: units.filter((u) => count.has(u)).map((u) => ({ ...targets.bars[u], slots: count.get(u) })) } };
}

/** a mined line as a bar's alternate (P13) */
const alternateOf = (line, rooted, toSlot) => ({ id: line.id, band: line.band, contour: line.contour.shape, motion: line.motion ?? null, n: line.n, cost: line.cost, perNote: line.perNote, rooted,
  notes: line.notes.map((n) => ({ slot: toSlot(n.cell), node: n.node, octave: n.octave })) });

/** the bass type (lines.js) and its Walking band: a walk at an exact count range, `maxGap` lifted, the most notes kept
 *  (P22's fill, P23's locked walk) */
const BASS_TYPE = LINE_TYPES.find((t) => t.type === 'bass'), WALK_BAND = BASS_TYPE.extraBands.find((b) => b.band === 'walking');
const walkTypeKept = new Map();
function walkType(lo, hi) {
  const key = `${lo}-${hi}`;
  let t = walkTypeKept.get(key);
  if (!t) walkTypeKept.set(key, (t = { ...BASS_TYPE, bands: [], extraBands: [{ ...WALK_BAND, notes: [lo, hi], rules: { ...WALK_BAND.rules, maxGap: Infinity }, most: true }] }));
  return t;
}

/**
 * Bar k's bass at a density and lock (P11–P13, P22–P24): what arrangeBass builds a bar from, and what a chord swap
 * re-mines (rearrange.js, P14).
 *   ctx       the spec's part context
 *   opts      { recs (every bar's, or span's, chord record), targets ({ scale, bars: a unit's each }), density, hits (the
 *               lock's: bassLockOf's `hits`, or null for Free), pick (an alternate's id, or null), table, walkCells
 *               (bassWalkCells), nodes (phase G's: a lock's onsets with no hits, each onset read as a hit of its own) }
 * → { notes (builder notes), how, picked, alternates, rooted, onDown, (hits, missedHits, missedSlots, lockedSlots: locked),
 *     (walkFill), (weakTies), (missed) }
 */
export function bassBarOf(ctx, k, { recs, targets, density, hits = null, nodes = null, pick = null, table, walkCells = null }) {
  const { row, S, rowT, timeOf } = ctx, units = unitsOfBar(recs, k), c = recs[units[0]];
  if (!hits && nodes) hits = [...nodes].sort((a, b) => a - b).map((i) => ({ own: i, x: row.x[i], nodes: [i] }));
  const rec = { notes: [], how: 'rest', picked: null, alternates: [] };
  const lockedAs = (n, missed, r = 1) => { rec.hits = n; rec.missedHits = missed.length; rec.missedSlots = missed.map((j) => j * r); rec.lockedSlots = n; };
  /** Roots' offer played: the pick, else its first */
  const playRoots = (got, how) => {
    const offer = rootsOffer(ctx, recs, k, got.lists, ctx.P / (ctx.cells.crop ? ctx.cells.crop.end : 1));
    rec.alternates = offer.map((x) => x.alt);
    if (!offer.length) return;
    const chosen = offer.find((x) => x.alt.id === pick) ?? offer[0];
    rec.notes = chosen.notes; rec.how = how; rec.picked = chosen.alt.id;
  };
  if (density === 'roots') {
    const got = rootsOfBar(ctx, recs, k, hits);
    playRoots(got, 'roots');
    if (hits) lockedAs(got.hits, got.missed);
  } else {
    const walking = density === 'walking', cells = walking && walkCells ? walkCells : ctx.cells, SU = cells.slotsPerBar, r = S / SU;
    const toSlot = (cell) => cell * r;
    const { frames, targets: sub } = barHarmony(recs, targets, k, S, SU);
    const rootClass = []; for (let t = 0; t < row.tones.length; t++) if (inRootClass(ctx, c, t)) rootClass.push(t);
    const lock = {};
    let cover = null;
    if (hits) {
      // P23: each hit's slot sounds on one of its in-frame onsets; a missed hit's slot rests (its window's onsets avoided)
      cover = hitsOfBar(ctx, cells, k, hits, (cell) => (frames.length === SU && SU > 1 ? frames[cell - k * SU] : frames[0]));
      lock.requireNodes = cover.groups.map((g) => ({ cell: g.cell, nodes: g.nodes.length > HIT_MOMENTS ? g.nodes.map((i) => ({ i, ...fromHit(row, g.xs, i) })).sort(nearestFirst).slice(0, HIT_MOMENTS).map((x) => x.i).sort((a, b) => a - b) : g.nodes }));
      if (cover.missed.length) {
        const win = windowsOf(cells), need = new Set(cover.groups.flatMap((g) => g.nodes));
        lock.avoidNodes = cover.missed.flatMap((g) => win[g.cell]).filter((i) => !need.has(i));
      }
      if (walking) {
        // the full walk sounds every slot but a missed hit's: its longest gap is the longest run of those, plus one
        const miss = new Set(cover.missed.map((g) => g.cell - k * SU));
        let run = 0, longest = 0; for (let j = 0; j < SU; j++) { run = miss.has(j) ? run + 1 : 0; longest = Math.max(longest, run); }
        lock.maxGap = longest + 1;
      }
      lockedAs(cover.groups.length + cover.missed.length, cover.missed.map((g) => g.cell), r);
    }
    if (walking) {
      const next = recs[(units[units.length - 1] + 1) % recs.length];
      lock.after = { pitch: next.rootCents + BASS_REGISTER };
    }
    const H = cover ? cover.groups.length : 0, W = SU - (cover ? cover.missed.length : 0);
    const opts = { from: k, bars: 1, types: ['bass'], table, targets: sub, register: BASS_REGISTER, ...(density === 'sparse' ? {} : { bands: [BASS_BANDS_OF[density]] }) };
    // Walking locked (P23): every slot but a missed hit's, the hits' on the hits
    const full = walking && cover ? { types: [walkType(W, W)] } : {};
    const mine = (over, weakTies, also = null) => {
      const o = { ...opts, ...over, ...(weakTies ? { weakTies } : {}) }, rules = also ? { ...lock, ...also } : lock;
      const rooted = mineLines(row, cells, frames, { ...o, rules: { startTones: rootClass, ...rules } }).lines || [];
      const rest = mineLines(row, cells, frames, { ...o, ...(Object.keys(rules).length ? { rules } : {}) }).lines || [];
      return { rooted, rest };
    };
    const none = (g) => !g.rooted.length && !g.rest.length;
    let got = mine(full, false);
    if (density !== 'sparse' && none(got)) { got = mine(full, true); if (!none(got)) rec.weakTies = true; }
    // P22: a walk that can't fill its clock walks the most notes it can (2 up to one short), maxGap lifted, weak ties
    if (walking && none(got) && W - 1 >= Math.max(2, H)) {
      got = mine({ types: [walkType(Math.max(2, H), W - 1)] }, true, { maxGap: Infinity });
      if (!none(got)) {
        const most = Math.max(...[...got.rooted, ...got.rest].map((l) => l.n));
        got = { rooted: got.rooted.filter((l) => l.n === most), rest: got.rest.filter((l) => l.n === most) };
        rec.weakTies = true; rec.walkFill = most;
      }
    }
    const seen = new Set(), offer = [];
    for (const [list, rooted] of [[got.rooted, true], [got.rest, false]]) for (const line of list) {
      if (offer.length >= BASS_ALTERNATES || seen.has(line.id)) continue;
      seen.add(line.id); offer.push({ line, rooted });
    }
    rec.alternates = offer.map((x) => alternateOf(x.line, x.rooted, toSlot));
    if (offer.length) {
      const chosen = offer.find((x) => x.line.id === pick) ?? offer[0];
      rec.how = 'mined'; rec.picked = chosen.line.id;
      rec.notes = chosen.line.notes.map((n) => ({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: k, slot: toSlot(n.cell), time: timeOf(row.tick[n.node]), slotSeconds: cells.slots[n.cell].length * rowT }));
    } else if (!cover || !H) {
      // Compose's fallback (a locked bar with no hit to cover: unless a missed hit rests there)
      const avoid = new Set(lock.avoidNodes ?? []);
      rec.notes = rootOnsetNotes(ctx, c, k).filter((n) => !avoid.has(n.node));
      if (rec.notes.length) rec.how = 'root onset';
    } else {
      // locked, nothing mined: Roots at the lock, a root on every hit (on the spec's clock)
      const rt = rootsOfBar(ctx, recs, k, hits);
      rec.notes = rt.lists.map((l) => l[0].note);
      if (rec.notes.length) rec.how = 'locked roots';
      lockedAs(rt.hits, rt.missed);
    }
  }
  if (pick != null && rec.picked !== pick) rec.missed = pick;
  rec.rooted = rec.notes.length > 0 && classOfCents(row.toneCents[rec.notes[0].tone] - c.rootCents).pc === 0;
  rec.onDown = rec.notes.some((n) => n.slot === k * S);
  return rec;
}

/** a bar's record as the part keeps it (its builder notes left out) */
export const bassBarRecord = (k, b) => ({ bar: k, how: b.how, picked: b.picked, alternates: b.alternates, notes: b.notes.length, rooted: b.rooted, onDown: b.onDown,
  ...(b.lockedSlots != null ? { lockedSlots: b.lockedSlots, hits: b.hits, missedHits: b.missedHits, missedSlots: b.missedSlots } : {}), ...(b.walkFill != null ? { walkFill: b.walkFill } : {}),
  ...(b.weakTies ? { weakTies: true } : {}), ...(b.missed != null ? { missed: b.missed } : {}) });
/** the arrangement's stats from its bars' records (P15, P22, P23) */
export function bassStatsOf(density, lock, bars) {
  const notes = bars.reduce((n, b) => n + b.notes, 0), locked = bars.some((b) => b.lockedSlots != null), ties = bars.filter((b) => b.weakTies).length, fills = bars.filter((b) => b.walkFill != null);
  return { density, lock, bars: bars.length, notes, perBar: bars.length ? notes / bars.length : 0, rooted: bars.filter((b) => b.rooted).length, onDown: bars.filter((b) => b.onDown).length,
    mined: bars.filter((b) => b.how === 'mined').length, fallback: bars.filter((b) => b.how === 'root onset' || b.how === 'locked roots').length, rests: bars.filter((b) => b.how === 'rest').length,
    ...(locked ? { lockedSlots: bars.reduce((n, b) => n + (b.lockedSlots ?? 0), 0), hits: bars.reduce((n, b) => n + (b.hits ?? 0), 0), missedHits: bars.reduce((n, b) => n + (b.missedHits ?? 0), 0) } : {}),
    ...(fills.length ? { walkFill: fills.length, walkFillNotes: fills.reduce((n, b) => n + b.notes, 0) } : {}), ...(ties ? { weakTies: ties } : {}) };
}

/**
 * The spec's geometry for the bass, once: the part context, the chords (rearrange.js' records), their targets, and the
 * hz retune of a note (Compose's: a bar's chord, or, in a chart's split bar, its slot's span). → { ctx, recs, targets, ratioOf }
 */
export function bassGeometry(spec, materials) {
  const { row, cells } = materials, k = spec.knobs;
  const ctx = partContext(row, cells, { cycleSeconds: k.cycleSeconds, phase: k.phase, frameCentsEachSide: k.frameCentsEachSide, ...(k.rowCycleSeconds != null ? { rowCycleSeconds: k.rowCycleSeconds } : {}) });
  if (ctx.P !== k.bars * k.slotsPerBar) fail('the materials are not this spec\'s (materialsOf(spec))');
  const recs = chordRecordsOf(spec, row, cells), targets = targetsOf(recs);
  const split = recs.some((c) => c.slots != null);
  let ratioOf;
  if (split) {
    const slotChord = recs.flatMap((c) => Array.from({ length: c.slots }, () => c));
    ratioOf = (bar, slot) => (slotChord[slot] ?? recs[unitsOfBar(recs, bar)[0]]).fundamentalRatio;
  } else ratioOf = (bar) => recs[bar].fundamentalRatio;
  return { ctx, recs, targets, ratioOf };
}

/**
 * The bass at a density and lock over the spec's chords.
 *   spec       a composed spec (not refused)
 *   materials  { row, cells }: rearrange.js `materialsOf(spec)` (a big row's from the worker's cache)
 *   options    { density ('roots' | 'sparse' | 'moving' | 'walking'), lock ('free' | 'kick' | 'clave'), picks ({ [bar]:
 *              an alternate's id }) } (BASS_DEFAULTS: Sparse, Free, none — Compose's own bass)
 * → the bass part as the spec has it, with `bass` (the head of this file). Its sound, legato and on/off are the spec's.
 */
export function arrangeBass(spec, materials, options = {}) {
  if (!spec || spec.refused) fail('there is no composition to arrange');
  if (!materials?.row || !materials?.cells) fail('arrangeBass needs the spec\'s materials: { row, cells } (rearrange.js materialsOf)');
  const was = spec.parts?.find((p) => p.id === 'bass') ?? fail('the spec has no bass part');
  const opt = readBassOptions(options), { density, picks } = opt;
  const geo = bassGeometry(spec, materials), { ctx, recs, targets } = geo, N = spec.knobs.bars;
  const lock = bassLockOf(spec, ctx, opt.lock), walkCells = density === 'walking' ? bassWalkCells(spec, materials) : null;
  const notes = [], bars = [];
  for (let k = 0; k < N; k++) {
    const b = bassBarOf(ctx, k, { recs, targets, density, hits: lock.hits, pick: picks[k] ?? null, table: spec.knobs.table, walkCells });
    notes.push(...b.notes);
    bars.push(bassBarRecord(k, b));
  }
  const built = partOf(ctx, 'bass', notes, { sound: was.sound, legato: was.legato, enabled: was.enabled, baseHz: spec.knobs.baseHz, ratioOf: geo.ratioOf });
  return { ...built, bass: { density, lock: opt.lock, picks, stats: bassStatsOf(density, lock.lock, bars), bars, ...(lock.refused ? { refused: lock.refused } : {}) } };
}
