// arp.js — the Arp mode, mined (Composer/COMP_ARP_ORDER.md, Amendment 1, phase D: M1–M7): the lead or the inner voice
// played as an arpeggio over the composition's final chords, MINED with chunk-lines' `arp` line type over partitioned
// anchors at ×1, ×2 or ×3 the slots a bar, every note an onset the row already plays, at its own time.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. Like the drums (drums.js `arrangeDrums`), an
// arp is an arrangement over a finished spec: `arrangeArp(spec, materials, partId, { time, picks, legato })` reads the
// spec and its materials (rearrange.js `materialsOf`: the row and the cells) and rebuilds one part, with no re-compose,
// so a switch or a knob is live. Compose's own output (Line) is untouched. What is decided (Avery, 2026-10-27: the
// order's Decided 3–4, then Amendment 1's 7–8) and what is proposed (M1–M7; the builder's calls marked "proposed"):
//
//   parts      the lead and the inner voice (decided 4). A MIDI target's lead is the clip: refused (`arpRefusal`).
//   anchors    (decided 7, M1) `buildCells(row, { bars, slotsPerBar: S × time, anchors, phase })`: the spec's own anchors
//              mode (partitioned: Partitions' G / G±1 cut) and phase, at the spec's slots a bar (time 1), double (2) or
//              triple (3); a MIDI target's N-bar cut cropped to its window, as materialsOf crops the spec's. Each anchor's
//              window is buildCells' own (about 12 onsets around it, Compose's `moments`). Built once per time and kept
//              against the materials' cells (a WeakMap: the materials object itself is not written to). A time whose
//              S × time passes a line's MAX_SLOTS (a chart's 12 or 16 slots a bar) falls to the largest that fits
//              (proposed; `stats.time` says which ran).
//   chords     the spec's chords rebuilt as harmony.js' records by rearrange.js' own path (`chordRecordsOf`: the
//              modulation offsets walked from bar 1, a chart's split bars a span each), each span's slots scaled by the
//              time; the targets are harmony.js `targetsOf` over them (the parent scale the union of the chords' classes).
//   phrases    (M1) harmony.js `phrasesOf` over the S × time cells: as many bars as 32 anchors hold (MAX_SLOTS).
//   mining     (decided 7, M1) each phrase `mineLines` with ARP_TYPE: chunk-lines' `arp` type (contours rise, fall,
//              arch, valley, wave over its octave; repeats dear, skips free) with a second band, "few rests" (60–95 % of
//              the anchors sound, `maxGap` 2), beside its own "no rests" — 5 contours × 2 bands, at most 10 lines a
//              phrase; one that mines nothing is mined again with `weakTies` (lines.js; M6 below). The miner's own
//              rules hold: a note is a chord tone, a scale tone (cheap on a light anchor, dear on a heavy one), or a
//              fringe tone (outside ±frameCentsEachSide) on a weak anchor resolving by step, never last.
//   ranking    (M2) "no rests" first, then "few rests", then cost per note (then the whole cost, then the id). A phrase
//              keeps its first ARP_ALTERNATES (10): `{ id, contour, band, n, perNote, chordTones, notes: [{ step (the
//              S × time cell), node, octave }] }`. `picks: { [phrase index]: id }` chooses one; the default is the first.
//              A pick the phrase no longer offers (its chords changed) falls back to the first, recorded as `missed`.
//   register   (M3) the lead's range starts 600¢ under its line's median, so the contour's octave is centred on it (the
//              line Compose mined; the lead is mined first and the chords settled over it, Q5); the inner's an octave
//              under the lead's (compose.js REGISTER.inner). No lead notes: the median from baseHz (Compose puts the
//              lead's median at √(440·660) Hz). A `register` on the miner, relative to the phrase's first chord root.
//   inner      (M3) never on the lead's onsets (`avoidNodes`); weights.avoid = 0.6 a note on an anchor whose window holds
//              a lead onset (`avoidSlots` on the S × time grid: compose.js innerOf's price), rather than resting there.
//              The lead is the part as the spec has it now: an arp lead's own onsets when the lead is an arp (Q5).
//   fallback   (M4) a phrase with nothing mined is WALKED: B1's ladder in 'played' (the closest to As played), at
//              `time` steps a slot over the phrase's spec slots — each step the earliest chord-tone onset in its
//              sub-window, on the rung of its class nearest the last note (ladder: the chord's classes over 2 octaves
//              from 1200¢ under the lead's line median; the inner's an octave lower; the inner off the lead's onsets
//              and, below 3 steps a slot, resting where the lead strikes). The phrase is marked `walked`.
//   M6         768:769 mined nothing at any time: its slots all tie in strikes (an evenly struck row), so lines.js'
//              "weak = strikes under the median" (chunk-lines' own rule) left no anchor weak and barred its foreign
//              tones (fringe, or out of the scale) everywhere — on a row whose 384 tones fill the octave (~70 %
//              outside every ±15¢ frame) and whose windows hold narrow bands of pitch. Two anchors in a row with no
//              in-frame scale tone break the bands' `maxGap`. `weakTies` (opt-in, lines.js) makes an anchor tied at
//              the median and off the strong beats weak too; Compose's lines never ask for it.
//   lengths    (Q6) legato off (the default): a note lasts its anchor's span (the S × time cell's seconds; a walked note
//              its step's), or the gap to the next note if shorter; on: it holds to the next note. compose.js
//              `articulate`, each note's `slotSeconds` the cell's — so `rearticulate` (a live legato or sound toggle)
//              keeps the arp's lengths.
//   velocity   the part's (compose.js VELOCITY: lead 0.8, inner 0.5), +0.1 on a note at a strong beat's anchor (the
//              bar's downbeat or middle on the spec's grid: the lead's accent; proposed — Q6's "a slot's first step"
//              accents every note at ×1).
//   pitch      hz = baseHz × ratio × 2^octave × the bar's fundamentalRatio (the span's, in a split bar): compose.js
//              `partOf`, exactly as Compose computes it. A note's `slot` and `bar` are the spec's (its cell ÷ time).
//
// The result is the part as the spec has it (partOf's shape: it replaces spec.parts[i]) with two more fields:
//   arp    { time, picks, legato, stats, phrases }
//            stats    { time (the one that ran), phrases, mined, walked, anchors, notes, rests, chordTones, chordShare,
//                       (inner) onLead (notes on an anchor where the lead sounds) }
//            phrases  [{ from, bars, anchors, picked (the alternate's id; null when walked), walked, (weakTies: mined
//                       only with M6's weak ties), alternates, (missed: a pick the phrase does not offer) }]
//   line   the part in Line mode, as the spec had it (Q5: the line stays in the spec, silent; Back to Line restores it
//          with no re-compose: `lineOf`). Arranging an arp part again starts from its `line`.
// Deterministic: no draws. The same spec, materials and options give byte-identical output.

import { partContext, partOf, VELOCITY } from './compose.js';
import { buildCells, cropCells } from './cells.js';
import { mineLines, LINE_TYPES, MAX_SLOTS } from './lines.js';
import { phrasesOf, harmonyOver, targetsOf, isStrongBeat } from './harmony.js';
import { chordRecordsOf } from './rearrange.js';

export const COMPOSER_ARP_VERSION = 'composer-arp-v2';
export const ARP_PARTS = Object.freeze(['lead', 'inner']);
/** ×1, ×2, ×3 the slots a bar (decided 7) */
export const ARP_TIMES = Object.freeze([1, 2, 3]);
export const ARP_DEFAULTS = Object.freeze({ time: 1, picks: Object.freeze({}), legato: false });
/** a phrase keeps this many ranked arps (M2) */
export const ARP_ALTERNATES = 10;
const ARP_LINE = LINE_TYPES.find((t) => t.type === 'arp');
/** chunk-lines' arp type with the "few rests" band beside its "no rests" (M1; the planner's probe) */
export const ARP_TYPE = Object.freeze({ ...ARP_LINE, bands: Object.freeze([...ARP_LINE.bands, Object.freeze({ band: 'few rests', share: [0.6, 0.95], strict: 1 })]), rules: Object.freeze({ ...ARP_LINE.rules, maxGap: 2 }) });
const BAND_ORDER = Object.freeze({ 'no rests': 0, 'few rests': 1 });
/** the inner's price a note on an anchor where the lead sounds (compose.js innerOf's) */
export const INNER_AVOID = 0.6;
/** a strong beat's note is struck this much harder */
export const STRONG_ACCENT = 0.1;
/** the walked fallback's ladder: octaves (B1's default range) */
export const WALK_RANGE = 2;
/** the inner sits an octave under the lead (compose.js REGISTER.inner) */
const INNER_REGISTER = -1200;
const LEAD_TARGET_HZ = Math.sqrt(440 * 660);
const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/arp: ${what}`); };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** why a part of this spec can't be an arp, or null (the window's switch greys itself with this as its title) */
export function arpRefusal(spec, partId) {
  if (!spec || spec.refused) return 'there is no composition to arrange';
  if (!ARP_PARTS.includes(partId)) return `only the lead and the inner voice have an Arp mode, not "${partId}"`;
  if (partId === 'lead' && spec.target) return 'the lead is the MIDI clip: a target\'s lead has no Arp mode';
  if (!spec.parts?.some((p) => p.id === partId)) return `the spec has no ${partId} part`;
  return null;
}

/** the options checked, with the defaults filled → { time, picks, legato } (picks copied: { [phrase]: id }) */
export function readArpOptions(options = {}) {
  const o = { ...ARP_DEFAULTS, ...Object.fromEntries(Object.entries(options ?? {}).filter(([, v]) => v !== undefined)) };
  for (const k of Object.keys(o)) if (!(k in ARP_DEFAULTS)) fail(`no arp option "${k}" (the options are ${Object.keys(ARP_DEFAULTS).join(', ')})`);
  if (!ARP_TIMES.includes(o.time)) fail(`time must be 1, 2 or 3 (× the slots a bar), not ${JSON.stringify(o.time)}`);
  if (!o.picks || typeof o.picks !== 'object' || Array.isArray(o.picks)) fail(`picks must be { [phrase]: id }, not ${JSON.stringify(o.picks)}`);
  const picks = {};
  for (const [p, id] of Object.entries(o.picks)) {
    if (!/^\d+$/.test(p) || typeof id !== 'string') fail(`a pick is { [phrase index]: an arp's id }, not ${JSON.stringify({ [p]: id })}`);
    picks[p] = id;
  }
  if (typeof o.legato !== 'boolean') fail(`legato must be true or false, not ${JSON.stringify(o.legato)}`);
  return { time: o.time, picks, legato: o.legato };
}

/** a part in Line mode: an arp part's kept line, else the part itself */
export const lineOf = (part) => part?.line ?? part;

/** the times a spec can run: S × time within a line's MAX_SLOTS (a chart's 12 or 16 slots a bar takes fewer) */
export const arpTimes = (spec) => ARP_TIMES.filter((t) => spec.knobs.slotsPerBar * t <= MAX_SLOTS);
/** the time that runs for the one asked: the largest that fits, at most the asked */
const timeFor = (spec, asked) => Math.max(1, ...arpTimes(spec).filter((t) => t <= asked));

/** the line's median pitch (cents above 1/1) of the lead as the spec has it (its Line), else from baseHz */
function leadMedian(spec, row) {
  const lead = lineOf(spec.parts.find((p) => p.id === 'lead'));
  const m = lead ? median(lead.notes.map((n) => row.toneCents[row.tone[n.node]] + 1200 * n.octave)) : null;
  return m ?? 1200 * Math.log2(LEAD_TARGET_HZ / spec.knobs.baseHz);
}

/**
 * The bottom of the part's mined range (cents above 1/1): the lead's line median less 600 (the contour's octave centred
 * on it); the inner's an octave lower (M3). → number
 */
export function arpLow(spec, materials, partId) {
  const lead = leadMedian(spec, materials.row) - 600;
  return partId === 'inner' ? lead + INNER_REGISTER : lead;
}

// per materials' cells: the S × time cells, kept per time (and the knobs their windows' times read)
const fine = new WeakMap();
/**
 * The anchors at a time: the S × time cells with the spec's anchors mode and phase (a target's cut cropped to its bars),
 * built once per time and kept against the materials' cells (time 1: the spec's own cells). → cells
 */
export function arpCells(spec, materials, time) {
  const { row, cells } = materials, k = spec.knobs;
  if (time === 1) return cells;
  let byTime = fine.get(cells);
  if (!byTime) fine.set(cells, (byTime = new Map()));
  const key = `${time}|${k.anchors}|${k.phase.join('/')}|${k.bars}|${k.cut ? k.cut.bars : ''}`;
  let got = byTime.get(key);
  if (!got) {
    const opts = { slotsPerBar: k.slotsPerBar * time, anchors: k.anchors, phase: k.phase };
    got = k.cut ? cropCells(buildCells(row, { bars: k.cut.bars, ...opts }), k.bars) : buildCells(row, { bars: k.bars, ...opts });
    byTime.set(key, got);
  }
  return got;
}

/**
 * The spec's geometry for an arp, once: the part context, the chords (rearrange.js' records, a bar's or a span's each)
 * and each spec slot's chord, and the walk's steps (B1). Exposed so the tests (and a view) read a slot exactly as the
 * arp does. → { ctx, recs, chordOfSlot (j → record), ratioOf ((bar, slot) → fundamentalRatio), slotStart, slotLength,
 *   stepOf (onset i, rate → the walk's step j·rate + sub, or −1) }
 */
export function arpGeometry(spec, materials) {
  const { row, cells } = materials, k = spec.knobs;
  const ctx = partContext(row, cells, { cycleSeconds: k.cycleSeconds, phase: k.phase, frameCentsEachSide: k.frameCentsEachSide, ...(k.rowCycleSeconds != null ? { rowCycleSeconds: k.rowCycleSeconds } : {}) });
  const { S, P, starts, rowT, timeOf, posSlot } = ctx;
  if (P !== k.bars * k.slotsPerBar) fail('the materials are not this spec\'s (materialsOf(spec))');
  const recs = chordRecordsOf(spec, row, cells);
  const split = recs.some((c) => c.slots != null), slotChord = new Array(P);
  if (split) recs.forEach((c) => { for (let j = c.from; j < c.from + c.slots; j++) slotChord[j] = c; });
  else for (let j = 0; j < P; j++) slotChord[j] = recs[Math.floor(j / S)];
  const slotStart = (j) => starts[j] * rowT, slotLength = (j) => cells.slots[j].length * rowT;
  /** onset i's walk step (j·rate + sub), its sub-window by where its time falls in the slot; −1 when it is in no slot */
  const stepOf = (i, rate) => {
    const j = posSlot[i];
    if (j < 0) return -1;
    const u = (timeOf(row.tick[i]) - slotStart(j)) / slotLength(j);
    return j * rate + Math.min(rate - 1, Math.max(0, Math.floor(u * rate + EPS)));
  };
  return { ctx, recs, chordOfSlot: (j) => slotChord[j], ratioOf: (bar, slot) => slotChord[slot].fundamentalRatio, slotStart, slotLength, stepOf };
}

/** the walk's ladder of a chord from a floor over `range` octaves: [{ nominal (cents), pc }], low to high (B1) */
function ladderOf(c, floor, range) {
  const one = c.intervals.map((pc) => { const p = c.rootCents + 100 * pc; return { pc, nominal: p + 1200 * Math.ceil((floor - p) / 1200 - EPS) }; }).sort((a, b) => a.nominal - b.nominal);
  const out = [];
  for (let o = 0; o < range; o++) for (const r of one) out.push({ pc: r.pc, nominal: r.nominal + 1200 * o });
  return out;
}

/**
 * M4: B1's walk in 'played' over one phrase's spec slots, `rate` steps a slot: each step the earliest chord-tone onset
 * in its sub-window, on the rung of its class nearest the last note (the first: nearest the ladder's middle, or the
 * note before the phrase). → { notes (builder notes, with `accent`), last (the last nominal, or the one given) }
 */
function walkPhrase(geo, { from, bars }, { rate, floor, avoid, leadSteps, restOnLead, prev }) {
  const { ctx, chordOfSlot, slotLength, stepOf } = geo, { row, S, inSlot, timeOf, chordClass } = ctx;
  const lo = from * S * rate, hi = (from + bars) * S * rate;
  const cands = Array.from({ length: hi - lo }, () => []);
  for (let j = from * S; j < (from + bars) * S; j++) for (const i of inSlot[j]) {
    if (avoid.has(i)) continue;
    const s = stepOf(i, rate), pc = chordClass(chordOfSlot(j), row.tone[i]);
    if (pc >= 0) cands[s - lo].push({ i, pc, time: timeOf(row.tick[i]) });   // inSlot is in time order
  }
  const notes = [], ladders = new Map();
  for (let s = lo; s < hi; s++) {
    const list = cands[s - lo];
    if (!list.length || (restOnLead && leadSteps.has(s))) continue;
    const j = Math.floor(s / rate), c = chordOfSlot(j);
    let rungs = ladders.get(c);
    if (!rungs) ladders.set(c, (rungs = ladderOf(c, floor, WALK_RANGE)));
    const first = list[0], to = prev ?? floor + 600 * WALK_RANGE;
    const pick = rungs.filter((r) => r.pc === first.pc).reduce((a, b) => (Math.abs(b.nominal - to) < Math.abs(a.nominal - to) - EPS ? b : a));
    prev = pick.nominal;
    const tone = row.tone[first.i], octave = Math.round((pick.nominal - row.toneCents[tone]) / 1200);
    notes.push({ node: first.i, tone, octave, pitch: row.toneCents[tone] + 1200 * octave, bar: Math.floor(j / S), slot: j, time: first.time, slotSeconds: slotLength(j) / rate,
      accent: s % rate === 0 && isStrongBeat(j % S, S) });
  }
  return { notes, last: prev };
}

/** a mined line as a phrase's alternate (M2) */
const alternateOf = (line) => ({ id: line.id, contour: line.contour.shape, band: line.band, n: line.n, perNote: line.perNote, chordTones: line.features.chordTones,
  notes: line.notes.map((n) => ({ step: n.cell, node: n.node, octave: n.octave })) });
/** M2: no rests first, then few rests, then cost per note, the whole cost, the id */
const rankLines = (a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band] || a.perNote - b.perNote || a.cost - b.cost || byId(a, b);

/**
 * The lead or the inner voice as a mined arpeggio over the spec's chords.
 *   spec       a composed spec (not refused)
 *   materials  { row, cells }: rearrange.js `materialsOf(spec)` (a big row's from the worker's cache)
 *   partId     'lead' | 'inner'
 *   options    { time (1 | 2 | 3: × the slots a bar), picks ({ [phrase]: an alternate's id }), legato } (ARP_DEFAULTS)
 * → the part as the spec has it, with `arp` and `line` (the head of this file). Throws on a refusal (`arpRefusal`).
 */
export function arrangeArp(spec, materials, partId, options = {}) {
  const refused = arpRefusal(spec, partId);
  if (refused) fail(refused);
  if (!materials?.row || !materials?.cells) fail('arrangeArp needs the spec\'s materials: { row, cells } (rearrange.js materialsOf)');
  const opt = readArpOptions(options), { picks, legato } = opt, time = timeFor(spec, opt.time);
  const geo = arpGeometry(spec, materials), { ctx, recs } = geo, { row, S, rowT, timeOf } = ctx, inner = partId === 'inner';
  const line = lineOf(spec.parts.find((p) => p.id === partId));
  const fc = arpCells(spec, materials, time), SF = S * time;
  const fineRecs = time === 1 || !recs.some((c) => c.slots != null) ? recs : recs.map((c) => ({ ...c, from: c.from * time, slots: c.slots * time }));
  const targets = targetsOf(fineRecs);
  const low = arpLow(spec, materials, partId), walkFloor = low + 600 - 600 * WALK_RANGE;

  // the inner keeps off the lead as it sounds now (M3, Q5): its onsets, and the anchors whose windows hold them
  const leadNotes = inner ? spec.parts.find((p) => p.id === 'lead')?.notes ?? [] : [];
  const avoid = new Set(leadNotes.map((n) => n.node)), leadAnchors = new Set(), leadSteps = new Set();
  for (const i of avoid) { const f = fc.slotOfNode[i]; if (f >= 0) leadAnchors.add(f); const s = geo.stepOf(i, time); if (s >= 0) leadSteps.add(s); }

  const notes = [], phrases = [];
  let mined = 0, walked = 0, chordTones = 0, onLead = 0, prev = null;
  phrasesOf(fc).forEach((ph, p) => {
    const P = ph.bars * SF, lo = ph.from * SF;
    const sub = harmonyOver(fineRecs, targets, ph.from, ph.bars, SF);
    const rules = inner ? { avoidNodes: [...avoid], avoidSlots: Array.from({ length: P }, (_, j) => leadAnchors.has(lo + j)) } : {};
    // M6: lines.js' own weak anchors first; a phrase that mines nothing so is mined again with `weakTies`
    const mine = (weakTies) => mineLines(row, fc, sub.frames, { from: ph.from, bars: ph.bars, types: [ARP_TYPE], table: 'full', targets: sub.targets, register: low - sub.targets.bars[0].anchor,
      rules, weights: inner ? { avoid: INNER_AVOID } : {}, weakTies }).lines ?? [];
    let found = mine(false), ties = false;
    if (!found.length) { found = mine(true); ties = found.length > 0; }
    const lines = found.slice().sort(rankLines).slice(0, ARP_ALTERNATES);
    const record = { from: ph.from, bars: ph.bars, anchors: P, picked: null, walked: false, ...(ties ? { weakTies: true } : {}), alternates: lines.map(alternateOf) };
    if (lines.length) {
      const want = picks[p], chosen = lines.find((l) => l.id === want) ?? lines[0];
      record.picked = chosen.id;
      if (want != null && chosen.id !== want) record.missed = want;
      mined++;
      for (const n of chosen.notes) {
        const slot = Math.floor(n.cell / time);
        notes.push({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: n.bar, slot, time: timeOf(row.tick[n.node]), slotSeconds: fc.slots[n.cell].length * rowT,
          accent: n.beat % time === 0 && isStrongBeat(n.beat / time, S) });
        if (n.role === 'chord') chordTones++;
        if (inner && leadAnchors.has(n.cell)) onLead++;
        prev = n.pitch;
      }
    } else {
      // M4: nothing mined — B1's walk, 'played', at `time` steps a slot
      record.walked = true;
      if (picks[p] != null) record.missed = picks[p];
      walked++;
      const w = walkPhrase(geo, ph, { rate: time, floor: walkFloor, avoid, leadSteps, restOnLead: inner && time < 3, prev });
      for (const n of w.notes) { notes.push(n); chordTones++; if (inner && leadAnchors.has(fc.slotOfNode[n.node])) onLead++; }
      prev = w.last;
    }
    phrases.push(record);
  });

  const accented = new Set(notes.filter((n) => n.accent).map((n) => n.node));
  const built = partOf(ctx, partId, notes, { sound: line.sound, legato, enabled: line.enabled, baseHz: spec.knobs.baseHz, ratioOf: geo.ratioOf });
  for (const n of built.notes) n.velocity = Math.min(1, VELOCITY[partId] + (accented.has(n.node) ? STRONG_ACCENT : 0));
  const anchors = fc.P;
  const stats = { time, phrases: phrases.length, mined, walked, anchors, notes: notes.length, rests: anchors - notes.length, chordTones, chordShare: notes.length ? chordTones / notes.length : 0, ...(inner ? { onLead } : {}) };
  return { ...built, arp: { time: opt.time, picks, legato, stats, phrases }, line };
}
