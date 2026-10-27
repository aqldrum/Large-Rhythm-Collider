// arp.js — the Arp mode (Composer/COMP_ARP_ORDER.md, phase B): the lead or the inner voice played as an arpeggio over
// the composition's final chords, every note an onset the row already plays, at its own time.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. Like the drums (drums.js `arrangeDrums`), an
// arp is an arrangement over a finished spec: `arrangeArp(spec, materials, partId, options)` reads the spec and its
// materials (rearrange.js `materialsOf`: the row and the cells) and rebuilds one part, with no re-compose and no DP —
// one pass over the onsets, then one over the steps — so a switch or a knob is live. Compose's own output (Line) is
// untouched. What is decided (Avery, 2026-10-27, the order's "Decided" 3–4) and what is proposed (Q1–Q6):
//
//   parts      the lead and the inner voice (decided 4). A MIDI target's lead is the clip: refused (`arpRefusal`).
//   steps      (decided 3, Q2) each slot cut into `rate` equal sub-windows of its time (rate 1–4, default 2); a
//              sub-window is a step. Its candidates are its onsets (each in the step its time falls in, from the slot's
//              anchor) whose tone is a chord tone of the slot's chord (in a chart's split bar, the span's: CHART_ORDER.md
//              P6). A step with none rests. So the subdivisions keep the row's own timing, not a quantized grid.
//   ladder     (Q3) the chord's classes stacked close over `range` octaves (1–3, default 2) from the part's floor: each
//              class's nominal pitch (root + 100 × its interval) lifted to the first at or above the floor, then the
//              same an octave up, `range` times. A candidate may stand on any rung of its class; the rung sets its octave.
//   patterns   (Q3: the shape is strict, the order is loose) a step takes the candidate whose rung is next in the
//              pattern's direction from the last note's rung (more than half a semitone away, so a new chord's near-same
//              rung is not a step):
//                up       the nearest rung above; none above: wrap to the step's lowest rung
//                down     the nearest rung below; none below: wrap to the step's highest rung
//                updown   the nearest rung in the current direction (up first); none: turn, and the nearest the other
//                         way; none either: the rung nearest the last, the direction kept
//                played   the step's earliest candidate, on the rung of its class nearest the last note (the first note:
//                         nearest the ladder's middle)
//              Ties between candidates on one rung: the earliest, then the lower node. The first note of `up` (and
//              `updown`) is the step's lowest rung, of `down` its highest.
//   floor      the lead: its line's median pitch less half the ladder (median − 600 × range), so the arp's median sits
//              near the line's (the line Compose mined; the lead is still mined first and the chords settled over it,
//              Q5). The inner: the lead's floor less an octave (REGISTER.inner: the inner sits an octave under the lead,
//              as Compose places it). No lead notes: the median from baseHz (Compose puts the lead's median at
//              √(440·660) Hz).
//   inner      (Q4) never on the lead's onsets (as `avoidNodes` keeps the mined inner off them), and resting on a step
//              where the lead strikes (a lead onset's time in the step) unless the rate is 3 or more. The lead is the
//              part as the spec has it now: an arp lead's own onsets when the lead is an arp (Q5).
//   lengths    (Q6) legato off (the default): a note lasts its step (the slot's seconds / rate), or the gap to the next
//              note if shorter; on: it holds to the next note. compose.js `articulate`, with each note's `slotSeconds`
//              the STEP's seconds — so `rearticulate` (a live legato or sound toggle) keeps the arp's lengths.
//   velocity   (Q6) the part's (compose.js VELOCITY: lead 0.8, inner 0.5), +0.1 on a slot's first step.
//   pitch      hz = baseHz × ratio × 2^octave × the bar's fundamentalRatio (the span's, in a split bar): compose.js
//              `partOf`, exactly as Compose computes it.
//
// The result is the part as the spec has it (partOf's shape: it replaces spec.parts[i]) with two more fields:
//   arp    { pattern, rate, range, legato, stats: { floor, steps, notes, rests, chordSteps (steps holding a chord tone,
//          the inner's off the lead's onsets), chordShare, restsForLead (the inner's rests on a step where the lead
//          strikes) } }
//   line   the part in Line mode, as the spec had it (Q5: the line stays in the spec, silent; Back to Line restores it
//          with no re-compose: `lineOf`). Arranging an arp part again starts from its `line`.
// Deterministic: no draws. The same spec, materials and options give byte-identical output.

import { partContext, partOf, VELOCITY } from './compose.js';
import { classOfCents } from './frame.js';

export const COMPOSER_ARP_VERSION = 'composer-arp-v1';
export const ARP_PARTS = Object.freeze(['lead', 'inner']);
export const ARP_PATTERNS = Object.freeze(['up', 'down', 'updown', 'played']);
export const ARP_DEFAULTS = Object.freeze({ pattern: 'up', rate: 2, range: 2, legato: false });
export const ARP_RATES = Object.freeze([1, 2, 3, 4]);
export const ARP_RANGES = Object.freeze([1, 2, 3]);
/** the inner may sound on a step where the lead strikes from this rate on (Q4) */
export const INNER_SHARES_FROM_RATE = 3;
/** a slot's first step is struck this much harder (Q6) */
export const FIRST_STEP_ACCENT = 0.1;
/** the inner's floor under the lead's (compose.js REGISTER.inner) */
const INNER_REGISTER = -1200;
const LEAD_TARGET_HZ = Math.sqrt(440 * 660);
/** a rung more than this far from the last note's counts as a move (cents) */
const MOVE = 50;

const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/arp: ${what}`); };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** why a part of this spec can't be an arp, or null (B2's switch greys itself with this as its title) */
export function arpRefusal(spec, partId) {
  if (!spec || spec.refused) return 'there is no composition to arrange';
  if (!ARP_PARTS.includes(partId)) return `only the lead and the inner voice have an Arp mode, not "${partId}"`;
  if (partId === 'lead' && spec.target) return 'the lead is the MIDI clip: a target\'s lead has no Arp mode';
  if (!spec.parts?.some((p) => p.id === partId)) return `the spec has no ${partId} part`;
  return null;
}

/** the options checked, with the defaults filled → { pattern, rate, range, legato } */
export function readArpOptions(options = {}) {
  const o = { ...ARP_DEFAULTS, ...Object.fromEntries(Object.entries(options ?? {}).filter(([, v]) => v !== undefined)) };
  for (const k of Object.keys(o)) if (!(k in ARP_DEFAULTS)) fail(`no arp option "${k}" (the options are ${Object.keys(ARP_DEFAULTS).join(', ')})`);
  if (!ARP_PATTERNS.includes(o.pattern)) fail(`pattern must be one of ${ARP_PATTERNS.join(', ')}, not ${JSON.stringify(o.pattern)}`);
  if (!ARP_RATES.includes(o.rate)) fail(`rate must be a whole number 1..4, not ${JSON.stringify(o.rate)}`);
  if (!ARP_RANGES.includes(o.range)) fail(`range must be a whole number of octaves 1..3, not ${JSON.stringify(o.range)}`);
  if (typeof o.legato !== 'boolean') fail(`legato must be true or false, not ${JSON.stringify(o.legato)}`);
  return { pattern: o.pattern, rate: o.rate, range: o.range, legato: o.legato };
}

/** a part in Line mode: an arp part's kept line, else the part itself */
export const lineOf = (part) => part?.line ?? part;

/** the line's median pitch (cents above 1/1) of the lead as the spec has it, else from baseHz */
function leadMedian(spec, row) {
  const lead = lineOf(spec.parts.find((p) => p.id === 'lead'));
  const m = lead ? median(lead.notes.map((n) => row.toneCents[row.tone[n.node]] + 1200 * n.octave)) : null;
  return m ?? 1200 * Math.log2(LEAD_TARGET_HZ / spec.knobs.baseHz);
}

/**
 * The part's floor (cents above 1/1) for a range: the lead's line median less half the ladder; the inner an octave
 * under the lead's. → number
 */
export function arpFloor(spec, materials, partId, range = ARP_DEFAULTS.range) {
  const lead = leadMedian(spec, materials.row) - 600 * range;
  return partId === 'inner' ? lead + INNER_REGISTER : lead;
}

/**
 * The steps' geometry for a spec and its materials, once: the part context and each slot's chord. Exposed so the
 * tests (and a view) read a step exactly as the arp does. → { ctx, chordOfSlot (j → { rootCents, intervals, ... }),
 *   stepOf (onset i, rate → step index j·rate + sub, or −1) }
 */
export function arpGeometry(spec, materials) {
  const { row, cells } = materials, k = spec.knobs;
  const ctx = partContext(row, cells, { cycleSeconds: k.cycleSeconds, phase: k.phase, frameCentsEachSide: k.frameCentsEachSide, ...(k.rowCycleSeconds != null ? { rowCycleSeconds: k.rowCycleSeconds } : {}) });
  const { S, P, starts, rowT, timeOf, posSlot } = ctx;
  if (P !== k.bars * k.slotsPerBar) fail('the materials are not this spec\'s (materialsOf(spec))');
  const toneIndex = new Map(row.tones.map((t, i) => [t, i]));
  const record = (c) => {
    const t = toneIndex.get(c.rootTone);
    if (t === undefined) fail(`the chord ${c.name}'s root ${c.rootTone} is not a tone of the row`);
    return { name: c.name, bar: c.bar, rootCents: row.toneCents[t], intervals: c.intervals, fundamentalRatio: c.fundamentalRatio };
  };
  const recs = spec.chords.map(record);
  // a chart's split bars: a chord a span ({ from, slots }), else a chord a bar
  const split = spec.chords.some((c) => c.slots != null);
  const slotChord = new Array(P);
  if (split) spec.chords.forEach((c, i) => { for (let j = c.from; j < c.from + c.slots; j++) slotChord[j] = recs[i]; });
  for (let j = 0; j < P; j++) slotChord[j] ??= recs[split ? spec.chords.findIndex((c) => c.bar === Math.floor(j / S)) : Math.floor(j / S)];
  const chordOfSlot = (j) => slotChord[j];
  const slotStart = (j) => starts[j] * rowT, slotLength = (j) => cells.slots[j].length * rowT;
  /** onset i's step (j·rate + sub), its sub-window by where its time falls in the slot; −1 when it is in no slot */
  const stepOf = (i, rate) => {
    const j = posSlot[i];
    if (j < 0) return -1;
    const u = (timeOf(row.tick[i]) - slotStart(j)) / slotLength(j);
    return j * rate + Math.min(rate - 1, Math.max(0, Math.floor(u * rate + EPS)));
  };
  return { ctx, chordOfSlot, slotStart, slotLength, stepOf, ratioOf: (bar, slot) => slotChord[slot].fundamentalRatio };
}

/** the ladder of a chord from a floor over `range` octaves: [{ nominal (cents), pc }], low to high */
function ladderOf(c, floor, range) {
  const one = c.intervals.map((pc) => { const p = c.rootCents + 100 * pc; return { pc, nominal: p + 1200 * Math.ceil((floor - p) / 1200 - EPS) }; }).sort((a, b) => a.nominal - b.nominal);
  const out = [];
  for (let o = 0; o < range; o++) for (const r of one) out.push({ pc: r.pc, nominal: r.nominal + 1200 * o });
  return out;
}

/**
 * The lead or the inner voice as an arpeggio over the spec's chords.
 *   spec       a composed spec (not refused)
 *   materials  { row, cells }: rearrange.js `materialsOf(spec)` (a big row's from the worker's cache)
 *   partId     'lead' | 'inner'
 *   options    { pattern ('up' | 'down' | 'updown' | 'played'), rate (1–4), range (1–3), legato } (ARP_DEFAULTS)
 * → the part as the spec has it, with `arp` and `line` (the head of this file). Throws on a refusal (`arpRefusal`).
 */
export function arrangeArp(spec, materials, partId, options = {}) {
  const refused = arpRefusal(spec, partId);
  if (refused) fail(refused);
  if (!materials?.row || !materials?.cells) fail('arrangeArp needs the spec\'s materials: { row, cells } (rearrange.js materialsOf)');
  const opt = readArpOptions(options), { pattern, rate, range, legato } = opt;
  const geo = arpGeometry(spec, materials), { ctx, chordOfSlot, slotLength, stepOf } = geo, { row, S, P, timeOf, chordClass } = ctx;
  const line = lineOf(spec.parts.find((p) => p.id === partId));
  const floor = arpFloor(spec, materials, partId, range);
  const steps = P * rate;

  // the inner keeps off the lead as it sounds now (Q4, Q5): its onsets, and below rate 3 its steps
  const avoid = new Set(), leadSteps = new Set();
  if (partId === 'inner') {
    for (const n of spec.parts.find((p) => p.id === 'lead')?.notes ?? []) { avoid.add(n.node); const s = stepOf(n.node, rate); if (s >= 0) leadSteps.add(s); }
  }
  const restOnLead = partId === 'inner' && rate < INNER_SHARES_FROM_RATE;

  // one pass over the onsets: each chord-tone onset into its step, with its class
  const cands = Array.from({ length: steps }, () => []);
  for (let i = 0; i < row.n; i++) {
    if (avoid.has(i)) continue;
    const s = stepOf(i, rate);
    if (s < 0) continue;
    const pc = chordClass(chordOfSlot(Math.floor(s / rate)), row.tone[i]);
    if (pc >= 0) cands[s].push({ i, pc, time: timeOf(row.tick[i]) });
  }

  // one pass over the steps: the ladder walk
  const ladders = new Map();
  const ladder = (c) => { let l = ladders.get(c); if (!l) { l = ladderOf(c, floor, range); ladders.set(c, l); } return l; };
  const notes = [], firsts = new Set();
  let chordSteps = 0, restsForLead = 0, prev = null, dir = 1;
  for (let s = 0; s < steps; s++) {
    const list = cands[s];
    if (!list.length) continue;
    chordSteps++;
    if (restOnLead && leadSteps.has(s)) { restsForLead++; continue; }
    const j = Math.floor(s / rate), c = chordOfSlot(j), rungs = ladder(c);
    list.sort((a, b) => a.time - b.time || a.i - b.i);
    // every (candidate, rung of its class) — the candidates in time order, so the first on a rung is the earliest
    const choices = [];
    for (const x of list) for (const r of rungs) if (r.pc === x.pc) choices.push({ x, nominal: r.nominal });
    const lowest = () => choices.reduce((a, b) => (b.nominal < a.nominal ? b : a));
    const highest = () => choices.reduce((a, b) => (b.nominal > a.nominal ? b : a));
    const above = () => choices.filter((o) => o.nominal > prev + MOVE).reduce((a, b) => (!a || b.nominal < a.nominal ? b : a), null);
    const below = () => choices.filter((o) => o.nominal < prev - MOVE).reduce((a, b) => (!a || b.nominal > a.nominal ? b : a), null);
    const nearest = (to, among) => among.reduce((a, b) => (Math.abs(b.nominal - to) < Math.abs(a.nominal - to) - EPS ? b : a));
    let pick;
    if (pattern === 'up') pick = prev == null ? lowest() : above() ?? lowest();
    else if (pattern === 'down') pick = prev == null ? highest() : below() ?? highest();
    else if (pattern === 'updown') {
      if (prev == null) pick = lowest();
      else {
        pick = dir > 0 ? above() : below();
        if (!pick) { const back = dir > 0 ? below() : above(); if (back) { dir = -dir; pick = back; } else pick = nearest(prev, choices); }
      }
    } else {
      const first = list[0];
      pick = nearest(prev ?? floor + 600 * range, choices.filter((o) => o.x === first));
    }
    prev = pick.nominal;
    const i = pick.x.i, tone = row.tone[i];
    const octave = Math.round((pick.nominal - row.toneCents[tone]) / 1200);
    notes.push({ node: i, tone, octave, pitch: row.toneCents[tone] + 1200 * octave, bar: Math.floor(j / S), slot: j, time: pick.x.time, slotSeconds: slotLength(j) / rate });
    if (s % rate === 0) firsts.add(i);
  }

  const built = partOf(ctx, partId, notes, { sound: line.sound, legato, enabled: line.enabled, baseHz: spec.knobs.baseHz, ratioOf: geo.ratioOf });
  for (const n of built.notes) n.velocity = Math.min(1, VELOCITY[partId] + (firsts.has(n.node) ? FIRST_STEP_ACCENT : 0));
  const stats = { floor, steps, notes: notes.length, rests: steps - notes.length, chordSteps, chordShare: chordSteps / steps, ...(partId === 'inner' ? { restsForLead } : {}) };
  return { ...built, arp: { ...opt, stats }, line };
}
