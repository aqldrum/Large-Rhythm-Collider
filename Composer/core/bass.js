// bass.js — the bass's densities and its lock (Composer/BASS_VOICING_ORDER.md, phase G: P10–P15): the bass mined bar by
// bar against its chord as Compose mines it, at one of four densities, landing anywhere or only with the kick or the
// comp, each bar offering its runner-ups.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. Like the arp (arp.js `arrangeArp`), the bass is
// an arrangement over a finished spec: `arrangeBass(spec, materials, { density, lock, picks })` reads the spec and its
// materials (rearrange.js `materialsOf`: the row and the cells) and rebuilds the bass part, with no re-compose, so a
// switch is live. The default (Sparse, Free, no picks) is Compose's own bass byte for byte (P10), so no fixture moves.
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
//              and never does. A mined density with no line falls back as Compose does: Free, the chord's root onset;
//              locked, Roots at the lock.
//   lock       (decided 2, P12) lines.js' opt-in `allowNodes`: a lattice slot keeps only candidates on the locked onsets.
//                free     every onset (the miner's own choice).
//                kick     the onsets within ¼ of a slot (the hit's slot, `spec.drums`' own) of a kick hit, in time
//                         (around the cycle). The drums off (`drums: false`, or not enabled), or no kick in the mode: the
//                         lock falls back to Free and says why (`bassLockRefusal`; `stats.lock` says what ran).
//                clave    the onsets of compose.js `compSourceOf(spec.clave)`: the comp's strokes (the clave's in Sync, its
//                         partner's in Fill). A spec that comps in notes has no clave: Free, with the reason.
//              Locked, a band's share counts only the slots holding a locked onset (lines.js `lockedNotes`: to the nearest
//              note, at least 1, so Moving on 3 kicks a bar plays 1–2 and Walking all 3; bandNotes' "at least 2" would
//              leave most locked bars empty — proposed). Walking locked plays every locked slot (`maxGap` lifted: the
//              locked slots need not be neighbours). Roots locked: of the bar's locked onsets in the chord's windows,
//              the root-class one nearest the first; else the chord-tone one nearest it; else the first itself. A chord
//              with no locked onset rests.
//   offers     (P13) each bar offers its best BASS_ALTERNATES (8) lines at the density and lock: the lines opening on the
//              root's class first, then the rest, each in mineLines' order (cost per note, the whole cost, the id), one
//              of an id; the first is Compose's choice. Roots offers its one line. `picks: { [bar]: id }` chooses one; a
//              pick the bar no longer offers plays the first and is recorded as `missed`. The window drops picks on a
//              change of density or lock (the arp's Time rule: Phase H).
//   rooted     (P15) a bar's first note on its (first) chord's root class, Compose's `bassRooted`; `onDown` a bar with a
//              note on its first slot.
//
// The result is the part as the spec has it (compose.js partOf's shape: it replaces the bass in spec.parts) with:
//   bass   { density, lock, picks (as asked), stats, bars, (refused: the lock's reason, when it fell back to Free) }
//            stats  { density, lock (the one that ran), bars, notes, perBar, rooted, onDown, mined, fallback, rests,
//                     (locked: lockedSlots, the slots holding a locked onset on the density's clock), (weakTies: bars
//                     mined only with ties) }
//            bars   [{ bar, how ('mined' | 'roots' | 'root onset' | 'locked roots' | 'rest'), picked (an alternate's id, or
//                     null), alternates, notes (how many), rooted, onDown, (lockedSlots), (weakTies), (missed) }]
//              alternate  { id, band, contour, motion, n, cost, perNote, rooted, notes: [{ slot (the spec's), node, octave }] }
//                         (Roots: { id, band: 'roots', n, rooted, notes })
// Deterministic: no draws. The same spec, materials and options give byte-identical output.

import { partContext, partOf, compSourceOf } from './compose.js';
import { buildCells, cropCells } from './cells.js';
import { mineLines, fnv1aHex } from './lines.js';
import { harmonyOver, targetsOf } from './harmony.js';
import { classOfCents } from './frame.js';
import { chordRecordsOf } from './rearrange.js';

export const COMPOSER_BASS_VERSION = 'composer-bass-v1';
export const BASS_DENSITIES = Object.freeze(['roots', 'sparse', 'moving', 'walking']);
export const BASS_LOCKS = Object.freeze(['free', 'kick', 'clave']);
export const BASS_DEFAULTS = Object.freeze({ density: 'sparse', lock: 'free', picks: Object.freeze({}) });
/** a bar offers this many ranked lines (P13) */
export const BASS_ALTERNATES = 8;
/** two octaves under the lead's range (compose.js REGISTER.bass) */
export const BASS_REGISTER = -2400;
/** the kick lock's reach either side of a hit: this share of the hit's slot (P12) */
export const KICK_WINDOW = 0.25;
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

/** Walking's clock: S slots a bar, halved while above WALK_MAX and even */
export function walkClock(S) { let w = S; while (w > WALK_MAX && w % 2 === 0) w /= 2; return w; }

/**
 * The locked onsets (P12): null for Free; a lock refused falls back to Free with its reason.
 *   ctx  the spec's part context (compose.js partContext)
 * → { lock (the one that runs), nodes (Set of onsets, or null), refused (the reason, or null) }
 */
export function bassLockOf(spec, ctx, lock) {
  if (lock === 'free') return { lock, nodes: null, refused: null };
  const refused = bassLockRefusal(spec, lock);
  if (refused) return { lock: 'free', nodes: null, refused };
  if (lock === 'clave') return { lock, nodes: new Set(compSourceOf(spec.clave).map((x) => x.node)), refused: null };
  const { row, P, T, timeOf, slotSeconds, inSlot } = ctx, nodes = new Set();
  for (const h of spec.drums.hits) {
    if (h.voice !== 'kick') continue;
    const t = timeOf(h.tick), w = KICK_WINDOW * slotSeconds(h.slot) + EPS;
    // a quarter slot reaches at most into the slots either side
    for (const j of [mod(h.slot - 1, P), h.slot, mod(h.slot + 1, P)]) for (const i of inSlot[j]) {
      const d = Math.abs(timeOf(row.tick[i]) - t);
      if (Math.min(d, T - d) <= w) nodes.add(i);
    }
  }
  return { lock, nodes, refused: null };
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
 * Roots (P11) over bar k's chords: a chord one note (or none, locked with no locked onset in it). Free: the root-class
 * onset nearest the chord's first anchor, else Compose's root onset. Locked: of the chord's locked onsets, the root-class
 * one nearest the first, else the chord-tone one nearest it, else the first. → builder notes, in the chords' order
 */
function rootsOfBar(ctx, recs, k, nodes) {
  const { row, cells, S, timeOf, slotSeconds, pitchAtLeast, chordClass } = ctx, win = windowsOf(cells), notes = [];
  for (const u of unitsOfBar(recs, k)) {
    const c = recs[u], { from, to } = unitRange(c, k, S), a0 = cells.slots[from].anchor;
    // each onset's place from the chord's first anchor, in cycles: its slot's anchor, and its offset from it
    const placed = [];
    for (let j = from; j < to; j++) {
      const lead = mod(cells.slots[j].anchor - a0, 1);
      for (const i of win[j]) { if (nodes && !nodes.has(i)) continue; const d = row.x[i] - cells.slots[j].anchor; placed.push({ i, j, at: lead + d - Math.round(d) }); }
    }
    placed.sort((a, b) => a.at - b.at || a.i - b.i);
    const nearest = (list, at) => list.reduce((best, x) => { const d = Math.abs(x.at - at), e = best ? Math.abs(best.at - at) : Infinity; return !best || d < e - EPS || (Math.abs(d - e) <= EPS && (x.at < best.at - EPS || (Math.abs(x.at - best.at) <= EPS && x.i < best.i))) ? x : best; }, null);
    let got;
    if (!nodes) {
      got = nearest(placed.filter((x) => inRootClass(ctx, c, row.tone[x.i])), 0);
      if (!got) { notes.push(...rootOnsetNotes(ctx, c, k)); continue; }
    } else {
      if (!placed.length) continue;
      const first = placed[0];
      got = nearest(placed.filter((x) => inRootClass(ctx, c, row.tone[x.i])), first.at) ?? nearest(placed.filter((x) => chordClass(c, row.tone[x.i]) >= 0), first.at) ?? first;
    }
    const tone = row.tone[got.i], { octave, pitch } = pitchAtLeast(tone, c.rootCents + BASS_REGISTER - 50);
    notes.push({ node: got.i, tone, octave, pitch, bar: k, slot: got.j, time: timeOf(row.tick[got.i]), slotSeconds: slotSeconds(got.j) });
  }
  return notes;
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

/**
 * Bar k's bass at a density and lock (P11–P13): what arrangeBass builds a bar from, and what a chord swap re-mines
 * (rearrange.js, P14).
 *   ctx       the spec's part context
 *   opts      { recs (every bar's, or span's, chord record), targets ({ scale, bars: a unit's each }), density, nodes (the
 *               locked onsets, or null), pick (an alternate's id, or null), table, walkCells (bassWalkCells) }
 * → { notes (builder notes), how, picked, alternates, rooted, onDown, (lockedSlots), (weakTies), (missed) }
 */
export function bassBarOf(ctx, k, { recs, targets, density, nodes = null, pick = null, table, walkCells = null }) {
  const { row, S, rowT, timeOf } = ctx, units = unitsOfBar(recs, k), c = recs[units[0]];
  const rec = { notes: [], how: 'rest', picked: null, alternates: [] };
  if (density === 'roots') {
    rec.notes = rootsOfBar(ctx, recs, k, nodes);
    if (rec.notes.length) {
      rec.how = 'roots';
      const serial = `roots|${k}|${rec.notes.map((n) => `${n.slot}:${row.tones[n.tone]}:${n.octave}`).join(',')}`;
      const alt = { id: `rt1:${fnv1aHex(serial)}`, band: 'roots', n: rec.notes.length, rooted: inRootClass(ctx, c, rec.notes[0].tone), notes: rec.notes.map((n) => ({ slot: n.slot, node: n.node, octave: n.octave })) };
      rec.alternates = [alt];
      rec.picked = alt.id;
    }
    if (nodes) rec.lockedSlots = lockedSlotsOf(ctx.cells, k, nodes);
  } else {
    const walking = density === 'walking', cells = walking && walkCells ? walkCells : ctx.cells, SU = cells.slotsPerBar, r = S / SU;
    const toSlot = (cell) => cell * r;
    const { frames, targets: sub } = barHarmony(recs, targets, k, S, SU);
    const rootClass = []; for (let t = 0; t < row.tones.length; t++) if (inRootClass(ctx, c, t)) rootClass.push(t);
    const lock = {};
    if (nodes) {
      const lo = k * SU, hi = lo + SU, mine = [];
      for (const i of nodes) { const j = cells.slotOfNode[i]; if (j >= lo && j < hi) mine.push(i); }
      lock.allowNodes = mine.sort((a, b) => a - b);
      rec.lockedSlots = new Set(mine.map((i) => cells.slotOfNode[i])).size;
      if (walking) lock.maxGap = Infinity;
    }
    if (walking) {
      const next = recs[(units[units.length - 1] + 1) % recs.length];
      lock.after = { pitch: next.rootCents + BASS_REGISTER };
    }
    const opts = { from: k, bars: 1, types: ['bass'], table, targets: sub, register: BASS_REGISTER, ...(density === 'sparse' ? {} : { bands: [BASS_BANDS_OF[density]] }) };
    const mine = (weakTies) => {
      const extra = weakTies ? { weakTies } : {};
      const rooted = mineLines(row, cells, frames, { ...opts, ...extra, rules: { startTones: rootClass, ...lock } }).lines || [];
      const rest = mineLines(row, cells, frames, { ...opts, ...extra, ...(Object.keys(lock).length ? { rules: lock } : {}) }).lines || [];
      return { rooted, rest };
    };
    let got = mine(false);
    if (density !== 'sparse' && !got.rooted.length && !got.rest.length) { got = mine(true); if (got.rooted.length || got.rest.length) rec.weakTies = true; }
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
    } else if (!nodes) {
      rec.notes = rootOnsetNotes(ctx, c, k);
      if (rec.notes.length) rec.how = 'root onset';
    } else {
      rec.notes = rootsOfBar(ctx, recs, k, nodes);
      if (rec.notes.length) rec.how = 'locked roots';
    }
  }
  if (pick != null && rec.picked !== pick) rec.missed = pick;
  rec.rooted = rec.notes.length > 0 && classOfCents(row.toneCents[rec.notes[0].tone] - c.rootCents).pc === 0;
  rec.onDown = rec.notes.some((n) => n.slot === k * S);
  return rec;
}
/** the slots of bar k (on the cells' clock) whose windows hold a locked onset */
function lockedSlotsOf(cells, k, nodes) {
  const S = cells.slotsPerBar, got = new Set();
  for (const i of nodes) { const j = cells.slotOfNode[i]; if (j >= k * S && j < (k + 1) * S) got.add(j); }
  return got.size;
}

/** a bar's record as the part keeps it (its builder notes left out) */
export const bassBarRecord = (k, b) => ({ bar: k, how: b.how, picked: b.picked, alternates: b.alternates, notes: b.notes.length, rooted: b.rooted, onDown: b.onDown,
  ...(b.lockedSlots != null ? { lockedSlots: b.lockedSlots } : {}), ...(b.weakTies ? { weakTies: true } : {}), ...(b.missed != null ? { missed: b.missed } : {}) });
/** the arrangement's stats from its bars' records (P15) */
export function bassStatsOf(density, lock, bars) {
  const notes = bars.reduce((n, b) => n + b.notes, 0), locked = bars.some((b) => b.lockedSlots != null), ties = bars.filter((b) => b.weakTies).length;
  return { density, lock, bars: bars.length, notes, perBar: bars.length ? notes / bars.length : 0, rooted: bars.filter((b) => b.rooted).length, onDown: bars.filter((b) => b.onDown).length,
    mined: bars.filter((b) => b.how === 'mined').length, fallback: bars.filter((b) => b.how === 'root onset' || b.how === 'locked roots').length, rests: bars.filter((b) => b.how === 'rest').length,
    ...(locked ? { lockedSlots: bars.reduce((n, b) => n + (b.lockedSlots ?? 0), 0) } : {}), ...(ties ? { weakTies: ties } : {}) };
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
    const b = bassBarOf(ctx, k, { recs, targets, density, nodes: lock.nodes, pick: picks[k] ?? null, table: spec.knobs.table, walkCells });
    notes.push(...b.notes);
    bars.push(bassBarRecord(k, b));
  }
  const built = partOf(ctx, 'bass', notes, { sound: was.sound, legato: was.legato, enabled: was.enabled, baseHz: spec.knobs.baseHz, ratioOf: geo.ratioOf });
  return { ...built, bass: { density, lock: opt.lock, picks, stats: bassStatsOf(density, lock.lock, bars), bars, ...(lock.refused ? { refused: lock.refused } : {}) } };
}
