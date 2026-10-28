// lines.js — lines picked from one rhythm's row: one onset or a rest per slot, the cheapest line under a stated cost.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
// A port of Overworld's chunk-lines.js (its lattice, cost, rules and exact picker, the work order's §4.9 and §10.3)
// onto the Composer's row (row.js), cells (cells.js) and frame (frame.js). What is ruled there and here: a line is
// bars × slots per bar; register is free; a tone outside may sound where it resolves by step; a line may be rooted on
// any tone the row has; the pitch classes a line aims at come from the harmony. What changed on the way in:
//
//   lattice    a span of the CELLS' bars (`from`, `bars`), not a cut of its own: Compose fixes one phase and one meter
//              for the whole cycle (phase 4) and every part reads the same slots, so a note is an onset of the row at
//              its own time. chunk-lines' downbeat search becomes a helper (`downbeats`) for whoever picks that phase.
//              A slot's candidates are the cells' tones (about `moments` onsets around the anchor), each in every
//              register inside the line's range [low, low + width): pitch = cents + 1200 × octave above 1/1.
//   frame      root-centred (frame.js). A FRINGE tone (in a class, outside ±frameCentsEachSide) is chunk-lines' outside
//              tone (Sprint default 2): only on a weak slot, followed within a step by a tone inside, never last.
//   targets    chunk-lines' shape: { scale: steps | null, bars: [{ name, root: step, chord: steps | null,
//              tone: fraction | null, anchor: cents, scale?: steps }] }, a line's slots shared evenly among the bars.
//              Rooted with no harmony (`rootTargets`): one bar, the frame's root, no chord, no scale. Phase 3 hands in
//              a bar per chord, each read in its own frame (centred on the chord's root tone: `frame` may be one frame
//              per bar), so a bar may carry its own `scale`, the parent scale in its frame's steps.
//   types      lead and arp as chunk-lines has them; BASS added (proposed, not ruled): Overworld's bass is a sparse lead
//              two octaves down, which here would be the lead's own sparse lines again, so the bass is sparse, an octave
//              wide (its octave is set where it is played), leans twice as hard on strong slots and on closing to its
//              root, and moves stepwise or wide. A cell (one bar) is left to phase 4.
//   tables     'full': every type × density band × contour × motion; 'lean': each type at its first motion only (the
//              cost probe: the picker is nearly all of Compose, and the lean table about a tenth of it).
//   ids        `cl1:` + a hash of the line's type, span, phase and notes (slot, exact fraction, register).
//
// The cost, word for word from chunk-lines' header:
//   per note     accent × (1 − slot accent) + support × (1 − the tone's share of its window)
//                + outside (a foreign tone) + chord × the slot's accent (a scale tone) + contour × |pitch − the contour| / 600
//   per move     gap × (slots apart / slotsPerBar)² + strict × (interval × I + recovery × R)
//                I: the same pitch → repeat; up to a step → 0; up to a skip → skipCost; past it a leap,
//                   leapCost + (cents past the skip) / 1200
//                R: 1 when the move before was a leap and this one is not a step or skip back
//   first note   gap × (slots before it / slotsPerBar)²
//   last note    gap × (slots after it / slotsPerBar)² + close × C
//                C: min(1, log2(n·d) / 7) of the interval n/d from its bar's root tone up to it (one octave); where the
//                   row has no tone on the root: 0 on the root's step, 0.4 on the chord, else 1
//   pick         exact: the cheapest line with exactly n notes, for every n asked, by dynamic programming over
//                (slot, candidate, notes so far, what the last move left: a leap's direction or a run on one pitch).

import { toneGate, MIN_TONES } from './row.js';
import { clusterOf } from './frame.js';

export const COMPOSER_LINES_VERSION = 'composer-lines-v1';
export const DEFAULT_WEIGHTS = Object.freeze({ accent: 1, support: 0.15, outside: 0.3, chord: 1, contour: 1, gap: 0.5, interval: 1, recovery: 1, close: 1, avoid: 0 });
/** under a harmony the chords pull the line and the contour only shapes it; a foreign tone is dearer (chunk-lines) */
export const HARMONY_WEIGHTS = Object.freeze({ contour: 0.5, outside: 0.8 });
/** cents: under `same` two pitches are one; a step is up to `step` (a whole tone, wide); a skip up to `skip` (a fourth, wide) */
export const DEFAULT_RULES = Object.freeze({ same: 40, step: 250, skip: 550, repeat: 1, skipCost: 0.35, leapCost: 0.6, strict: 1, maxGap: Infinity, maxRun: Infinity, contour: null, targets: null });
/** a lead's motions (chunk-lines §10.3): a repeat's price, a skip's price and the longest run on one pitch */
export const MOTIONS = Object.freeze({
  stepwise: Object.freeze({}),
  mixed: Object.freeze({ repeat: 0.25, skipCost: 0.15, maxRun: 2 }),
  wide: Object.freeze({ repeat: 0.25, skipCost: 0, maxRun: 2 }),
});
/** contour shapes: the line's height 0..1 at u = 0..1 along its slots */
export const CONTOURS = Object.freeze({
  rise: (u) => u, fall: (u) => 1 - u, arch: (u) => Math.sin(Math.PI * u), valley: (u) => 1 - Math.sin(Math.PI * u), wave: (u) => 0.5 + 0.5 * Math.sin(2 * Math.PI * u),
});
/** the contour's pitch at slot k of P: contour = { shape, low, span } */
export const contourAt = (contour, k, P) => contour.low + contour.span * CONTOURS[contour.shape](P > 1 ? k / (P - 1) : 0);
const OCTAVE = [{ register: 'octave', low: 0, span: 1200 }];
const shapes = (names, registers) => registers.flatMap((r) => names.map((shape) => Object.freeze({ shape, ...r })));
/** a line's range, in cents, from its root's own pitch up: 1/1 to a twelfth above */
export const RANGE_WIDTH = 1900;
/** a line is at most this many slots */
export const MAX_SLOTS = 32;
export const TABLES = Object.freeze(['full', 'lean']);

/** Line types (chunk-lines' lead and arp; the bass proposed here). A band is a share of the slots that sound, with how strictly the intervals are held there. */
export const LINE_TYPES = Object.freeze([
  Object.freeze({ type: 'lead', width: RANGE_WIDTH, bands: [{ band: 'sparse', share: [0.2, 0.35], strict: 1 }, { band: 'mid', share: [0.4, 0.6], strict: 1.5 }, { band: 'dense', share: [0.65, 0.85], strict: 2 }],
    contours: shapes(['rise', 'fall', 'arch', 'valley', 'wave'], OCTAVE), rules: {}, motions: ['stepwise', 'mixed', 'wide'] }),
  Object.freeze({ type: 'arp', width: RANGE_WIDTH, bands: [{ band: 'no rests', share: [1, 1], strict: 1 }],
    contours: shapes(['rise', 'fall', 'arch', 'valley', 'wave'], OCTAVE), rules: { maxGap: 1, repeat: 2, skipCost: 0 } }),
  Object.freeze({ type: 'bass', width: 1200, bands: [{ band: 'sparse', share: [0.2, 0.35], strict: 1 }],
    contours: shapes(['rise', 'fall', 'arch', 'valley'], OCTAVE), rules: { weights: { accent: 2, close: 2 } }, motions: ['stepwise', 'wide'] }),
]);

const mod = (v, n) => ((v % n) + n) % n;
const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/lines: ${what}`); };
const gcdBig = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/** min(1, log2(n·d) / 7): 1/1 → 0, 3/2 → 0.37, 5/4 → 0.62, 9/8 → 0.88 */
export function closeCost(fraction) {
  const [n, d] = String(fraction).split('/').map(Number), nd = n * d;
  return Math.min(1, (Number.isSafeInteger(nd) ? Math.log2(nd) : Math.log2(n) + Math.log2(d)) / 7);   // as chunk-lines rounds it, while n·d is exact
}
/** the interval from `root` up to `fraction`, inside one octave, as a reduced ratio (exact: BigInt, the row's fractions run to 2^53) */
export function intervalOver(fraction, root) {
  const [a, b] = String(fraction).split('/').map(BigInt), [c, d] = String(root).split('/').map(BigInt);
  let n = a * d, m = b * c;
  while (n >= 2n * m) m *= 2n;
  while (n < m) n *= 2n;
  const g = gcdBig(n, m);
  return `${n / g}/${m / g}`;
}

/** One target: a line rooted on a tone of the frame (default the frame's root), no chord, no scale. */
export function rootTargets(row, frame, tone = frame.root) {
  const t = typeof tone === 'string' ? row.tones.indexOf(tone) : tone;
  if (!(t >= 0 && t < row.tones.length) || !frame.inside[t]) fail(`${JSON.stringify(tone)} is not a tone inside the frame`);
  return { scale: null, bars: [{ name: row.tones[t], root: frame.pc[t], chord: null, tone: row.tones[t], anchor: row.toneCents[t] }] };
}

// the row's onsets, heaviest first (then in row order), sorted once per row: `downbeats` reads it for every P and tone
const heavyOrder = new WeakMap();
function heaviestFirst(row) {
  let order = heavyOrder.get(row);
  if (!order) {
    order = new Uint32Array(row.n);
    for (let i = 0; i < row.n; i++) order[i] = i;
    order.sort((a, b) => row.strikes[b] - row.strikes[a] || a - b);
    heavyOrder.set(row, order);
  }
  return order;
}
/**
 * Phases ([num, den] of the cycle) to cut P slots from, at most `count` (chunk-lines `downbeats`, for phase 4 to pick
 * the cycle's phase from). With a tone: where it first sounds, then the heaviest onsets where it sounds; without: the
 * row's heaviest onsets. With `cluster` (a number of cents each side) the tone sounds wherever a tone of its ±cluster
 * neighbourhood does (frame.js `clusterOf`: its class, within ±cluster of it): where the tone itself first sounds,
 * then the heaviest onsets of its cluster — so a root heard only a few times, in a cluster heard often, still finds
 * its downbeats. With even anchors, two phases a whole number of slots apart cut the same slots, so only the first in
 * this order is kept.
 */
export function downbeats(row, P, count = 6, tone = null, { anchors = 'even', cluster = null } = {}) {
  const order = heaviestFirst(row), out = [], seen = new Set(), t = tone == null ? -1 : typeof tone === 'string' ? row.tones.indexOf(tone) : tone;
  if (tone != null && t < 0) fail(`${tone} is not a tone of the row`);
  let member = null;
  if (t >= 0 && cluster != null) { member = new Uint8Array(row.tones.length); for (const u of clusterOf(row, t, cluster)) member[u] = 1; }
  const G = BigInt(row.grid), PB = BigInt(P);
  const take = (i) => {
    const tick = row.tick[i];
    let key;
    if (anchors === 'even') { const r = (BigInt(tick) * PB) % G, g = gcdBig(r, G) || G; key = `${r / g}/${G / g}`; } else key = String(tick);
    if (seen.has(key)) return false;
    seen.add(key);
    const g = Number(gcdBig(BigInt(tick), G) || G);
    out.push([tick / g, row.grid / g]);
    return out.length >= count;
  };
  if (t >= 0 && take(row.toneFirst[t])) return out;
  for (let k = 0; k < order.length; k++) { const i = order[k]; if ((t < 0 || (member ? member[row.tone[i]] : row.tone[i] === t)) && take(i)) break; }
  return out;
}

/**
 * The lattice: the cells' slots of bars [from, from + bars), each slot's candidates the frame's reading of its tones in
 * every register inside [low, low + width). A slot is WEAK (a fringe tone may sound there) when its strikes are under
 * the span's median; with `weakTies` (opt-in: the arps, arp.js — a row struck evenly ties every slot at the median, and
 * then none is weak) a slot AT the median and off the bar's strong beats (its downbeat and, S even, its middle) is weak
 * too. Absent, nothing changes (Compose's own lines never ask for it).
 * → { P, S, bars, from, mode, phase, swing, moments, low, width, frame: { root, frameCentsEachSide }, slots }
 *   slot { index (in the line), cell (in the cells), bar (of the cycle), beat, anchor, strikes, accent, weak, cands }
 *   cand { tone, fraction, cents, octave, pitch, pc, outside, share, close, count, node, offset }
 */
export function buildLattice(row, cells, frame, { from = 0, bars = cells.bars - from, low = 0, width = RANGE_WIDTH, weakTies = false } = {}) {
  const S = cells.slotsPerBar, P = bars * S;
  if (!(Number.isInteger(from) && from >= 0 && Number.isInteger(bars) && bars >= 1 && from + bars <= cells.bars)) fail(`bars ${from}..${from + bars} are not in the cells' ${cells.bars}`);
  if (P > MAX_SLOTS) fail(`a line is at most ${MAX_SLOTS} slots, not ${bars} × ${S}`);
  const frames = framesFor(frame, bars, S);
  const own = cells.slots.slice(from * S, from * S + P);
  let heaviest = 0; for (const s of own) if (s.strikes > heaviest) heaviest = s.strikes;
  const median = own.map((s) => s.strikes).sort((a, b) => a - b)[P >> 1];
  const slots = own.map((s, k) => {
    const frame = frames.length === P ? frames[k] : frames[Math.floor(k / S)];
    let most = 0; for (const t of s.tones) if (t.count > most) most = t.count;
    const cands = [];
    for (const t of s.tones) {
      const cents = row.toneCents[t.tone], fraction = row.tones[t.tone], close = closeCost(fraction);
      for (let octave = Math.ceil((low - cents) / 1200 - EPS); cents + 1200 * octave < low + width - EPS; octave++) {
        cands.push({ tone: t.tone, fraction, cents, octave, pitch: cents + 1200 * octave, pc: frame.pc[t.tone], outside: !frame.inside[t.tone],
          share: t.count / most, close, count: t.count, node: t.node, offset: t.offset });
      }
    }
    cands.sort((a, b) => a.pitch - b.pitch || a.tone - b.tone);
    const weak = s.strikes < median || (weakTies && s.strikes === median && !(s.beat === 0 || (S % 2 === 0 && s.beat === S / 2)));
    return { index: k, cell: s.index, bar: s.bar, beat: s.beat, anchor: s.anchor, strikes: s.strikes, accent: heaviest ? s.strikes / heaviest : 0, weak, cands };
  });
  return { P, S, bars, from, mode: cells.mode, phase: cells.phase, swing: cells.swing, moments: cells.moments, low, width, frame: frameSummary(frames), slots };
}
/** one frame for every bar of a span, one per bar (phase 3: each bar's frame centred on its chord's root tone), or one per
 *  slot (a chart's split bars, CHART_ORDER.md P6: each span's slots in its own chord's frame) */
function framesFor(frame, bars, S = null) {
  if (!Array.isArray(frame)) return Array.from({ length: bars }, () => frame);
  if (frame.length !== bars && !(S != null && frame.length === bars * S)) fail(`${frame.length} frames for ${bars} bars`);
  return frame;
}
const frameSummary = (frames) => (frames.every((f) => f === frames[0])
  ? { root: frames[0].rootFraction, frameCentsEachSide: frames[0].frameCentsEachSide }
  : { roots: frames.map((f) => f.rootFraction), frameCentsEachSide: frames[0].frameCentsEachSide });

export const intervalCost = (ad, r) => (ad < r.same ? r.repeat : ad <= r.step ? 0 : ad <= r.skip ? r.skipCost : r.leapCost + (ad - r.skip) / 1200);
export const rulesOf = (rules) => ({ ...DEFAULT_RULES, ...rules, weights: { ...DEFAULT_WEIGHTS, ...(rules?.weights || {}) } });
// STEP 4a: the close cost of a tone over a bar's root tone, memoized across calls (a pure function of the two fractions:
// the same numbers, sooner; a bar-local re-mine reads it for every run). Cleared when it grows past CLOSE_MEMO_MAX.
const CLOSE_MEMO_MAX = 1 << 18, closeMemo = new Map();
function closeOver(fraction, tone) {
  const key = `${fraction}|${tone}`;
  let v = closeMemo.get(key);
  if (v === undefined) { if (closeMemo.size >= CLOSE_MEMO_MAX) closeMemo.clear(); closeMemo.set(key, (v = closeCost(intervalOver(fraction, tone)))); }
  return v;
}
/** each candidate's part under the targets: [slot][cand] → { role, bar, foreign, chord (its chord cost, unweighted), close } */
export function rolesOf(lattice, r) {
  const t = r.targets, P = lattice.P;
  // a target with its own `slots` (a chart's span, CHART_ORDER.md P6) holds that many slots in turn; else the slots are shared evenly
  const at = t && t.bars[0]?.slots != null ? t.bars.flatMap((b, i) => Array.from({ length: b.slots }, () => i)) : null;
  if (at && at.length !== P) fail(`targets of ${at.length} slots for a line of ${P}`);
  return lattice.slots.map((slot, k) => {
    const g = t ? t.bars[at ? at[k] : Math.floor(k * t.bars.length / P)] : null;
    return slot.cands.map((c) => {
      if (!t) return { role: c.outside ? 'foreign' : 'tone', bar: null, foreign: c.outside, chord: 0, close: c.close };
      const scale = g.scale ?? t.scale, foreign = c.outside || (scale ? !scale.includes(c.pc) : false), onChord = !foreign && (!g.chord || g.chord.includes(c.pc));
      let close;
      if (g.tone) close = closeOver(c.fraction, g.tone); else close = !foreign && c.pc === g.root ? 0 : onChord ? 0.4 : 1;
      return { role: foreign ? 'foreign' : onChord ? (g.chord ? 'chord' : 'tone') : 'scale', bar: g.name, foreign, chord: foreign || onChord ? 0 : slot.accent, close };
    });
  });
}

/** The cost of a line, term by term (unweighted sums in `terms`, the weighted total in `cost`). picks = [{ slot, cand }] in slot order. */
export function scoreLine(lattice, picks, rules) {
  const r = rulesOf(rules), w = r.weights, S = lattice.S, roles = rolesOf(lattice, r);
  const terms = { accent: 0, support: 0, outside: 0, chord: 0, contour: 0, gap: 0, interval: 0, recovery: 0, close: 0, avoid: 0 };
  let leap = 0;
  picks.forEach((p, i) => {
    const slot = lattice.slots[p.slot], c = slot.cands[p.cand], role = roles[p.slot][p.cand];
    terms.accent += 1 - slot.accent; terms.support += 1 - c.share; if (role.foreign) terms.outside += 1;
    if (r.avoidSlots && r.avoidSlots[p.slot]) terms.avoid += 1;
    terms.chord += role.chord;
    if (r.contour) terms.contour += Math.abs(c.pitch - contourAt(r.contour, p.slot, lattice.P)) / 600;
    if (i === 0) { terms.gap += (p.slot / S) ** 2; return; }
    const q = picks[i - 1], a = lattice.slots[q.slot].cands[q.cand], d = c.pitch - a.pitch, ad = Math.abs(d);
    terms.gap += ((p.slot - q.slot) / S) ** 2;
    terms.interval += r.strict * intervalCost(ad, r);
    if (leap && !((leap > 0 ? d < 0 : d > 0) && ad >= r.same && ad <= r.skip)) terms.recovery += r.strict;
    leap = ad > r.skip ? Math.sign(d) : 0;
  });
  const last = picks[picks.length - 1];
  terms.gap += ((lattice.P - 1 - last.slot) / S) ** 2;
  terms.close = roles[last.slot][last.cand].close;
  // STEP 4a: boundaries (a bar-local re-mine): the moves in from the note before the span and out to the note after it
  if (r.before) terms.interval += r.strict * intervalCost(Math.abs(lattice.slots[picks[0].slot].cands[picks[0].cand].pitch - r.before.pitch), r);
  if (r.after) terms.interval += r.strict * intervalCost(Math.abs(r.after.pitch - lattice.slots[last.slot].cands[last.cand].pitch), r);
  let cost = 0; for (const k of Object.keys(terms)) cost += w[k] * terms[k];
  return { cost, terms, roles: picks.map((p) => roles[p.slot][p.cand]) };
}

/**
 * What a line carries from its last move: 0 nothing, 1 a leap up, 2 a leap down, 3 + i the (i + 2)th note in a row on
 * one pitch. → the flag after a move of d cents out of flag f, or −1 where the run would pass r.maxRun.
 */
export function flagAfter(f, d, r) {
  const ad = Math.abs(d);
  if (ad >= r.same) return ad > r.skip ? (d > 0 ? 1 : 2) : 0;
  if (!(r.maxRun < Infinity)) return 0;
  const run = f >= 3 ? f - 1 : 1;
  return run + 1 > r.maxRun ? -1 : run + 2;
}
/** a leap is owed its recovery: the move after it a step or a skip back */
export const recoveryDue = (f, d, r) => (f === 1 || f === 2) && !((f === 1 ? d < 0 : d > 0) && Math.abs(d) >= r.same && Math.abs(d) <= r.skip);

/**
 * The cheapest line of exactly n notes, for each n in [nMin, nMax] (chunk-lines' picker, unchanged).
 * → [{ n, cost, picks: [{ slot, cand }] }], an n with no line left out. rules: DEFAULT_RULES fields, `weights`, `nMin`, `nMax`.
 */
export function pickLines(lattice, rules = {}) {
  const r = rulesOf(rules), w = r.weights, { P, S, slots } = lattice, roles = rolesOf(lattice, r);
  const nMax = Math.min(P, rules.nMax ?? P), nMin = Math.max(1, rules.nMin ?? 1), maxGap = Math.min(P, r.maxGap);
  if (nMax < nMin) return [];
  const base = []; let total = 0; for (const s of slots) { base.push(total); total += s.cands.length; }
  const slotOf = new Int32Array(total); slots.forEach((s, k) => { for (let i = 0; i < s.cands.length; i++) slotOf[base[k] + i] = k; });
  const limited = r.maxRun < Infinity, F = limited ? 2 + Math.max(1, r.maxRun) : 3;
  const WIDTH = (nMax + 1) * F;
  const cost = new Float64Array(total * WIDTH).fill(Infinity), back = new Int32Array(total * WIDTH).fill(-1);
  const avoidNodes = r.avoidNodes ? new Set(r.avoidNodes) : null, startTones = r.startTones ? new Set(r.startTones) : null;
  const before = r.before ?? null, after = r.after ?? null;   // STEP 4a: { pitch } either side of the span, or null
  for (let k = 0; k < P; k++) {
    const slot = slots[k], busy = r.avoidSlots && r.avoidSlots[k] ? w.avoid : 0;
    for (let bi = 0; bi < slot.cands.length; bi++) {
      const b = slot.cands[bi], rb = roles[k][bi];
      if (rb.foreign && !slot.weak) continue;
      if (avoidNodes && avoidNodes.has(b.node)) continue;
      const own = busy + w.accent * (1 - slot.accent) + w.support * (1 - b.share) + (rb.foreign ? w.outside : 0) + w.chord * rb.chord
        + (r.contour ? w.contour * Math.abs(b.pitch - contourAt(r.contour, k, P)) / 600 : 0), sb = (base[k] + bi) * WIDTH;
      if (k < maxGap && (!startTones || startTones.has(b.tone))) cost[sb + F] = w.gap * (k / S) ** 2 + own + (before ? r.strict * w.interval * intervalCost(Math.abs(b.pitch - before.pitch), r) : 0);
      for (let j = Math.max(0, k - maxGap); j < k; j++) {
        const gap = w.gap * ((k - j) / S) ** 2, from = slots[j].cands;
        for (let ai = 0; ai < from.length; ai++) {
          const a = from[ai], d = b.pitch - a.pitch, ad = Math.abs(d);
          if (roles[j][ai].foreign && (rb.foreign || ad > r.step)) continue;
          const move = gap + own + r.strict * w.interval * intervalCost(ad, r), sa = (base[j] + ai) * WIDTH;
          const repeat = ad < r.same, leapt = ad > r.skip ? (d > 0 ? 1 : 2) : 0, back1 = !repeat && ad <= r.skip;
          for (let f = 0; f < F; f++) {   // flagAfter and recoveryDue, written out: this is the picker's inner loop
            let after = leapt;
            if (repeat && limited) { const run = f < 3 ? 2 : f; if (run > r.maxRun) continue; after = run + 1; }
            const add = move + ((f === 1 || f === 2) && !(back1 && (f === 1 ? d < 0 : d > 0)) ? r.strict * w.recovery : 0);
            for (let n = 1; n < nMax; n++) {
              const at = sa + n * F + f;
              if (cost[at] === Infinity) continue;
              const to = sb + (n + 1) * F + after, v = cost[at] + add;
              if (v < cost[to]) { cost[to] = v; back[to] = at; }
            }
          }
        }
      }
    }
  }
  const out = [];
  for (let n = nMin; n <= nMax; n++) {
    let best = Infinity, at = -1;
    for (let k = Math.max(0, P - maxGap); k < P; k++) for (let ci = 0; ci < slots[k].cands.length; ci++) {
      if (roles[k][ci].foreign) continue;
      const end = w.close * roles[k][ci].close + w.gap * ((P - 1 - k) / S) ** 2 + (after ? r.strict * w.interval * intervalCost(Math.abs(after.pitch - slots[k].cands[ci].pitch), r) : 0);
      for (let f = 0; f < F; f++) { const i = (base[k] + ci) * WIDTH + n * F + f, v = cost[i] + end; if (v < best) { best = v; at = i; } }
    }
    if (at < 0) continue;
    const picks = [];
    for (let i = at; i >= 0; i = back[i]) { const flat = Math.floor(i / WIDTH); picks.push({ slot: slotOf[flat], cand: flat - base[slotOf[flat]] }); }
    out.push({ n, cost: best, picks: picks.reverse() });
  }
  return out;
}

/** FNV-1a, 32 bits, as hex (the lines' ids; harmony.js' pinned lead reuses it) */
export function fnv1aHex(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
/** the fewest and the most notes of a band's line over P slots */
export const bandNotes = (band, P) => band.notes || [Math.max(2, Math.ceil(band.share[0] * P - EPS)), Math.floor(band.share[1] * P + EPS)];

/**
 * A picked line as a record. Each note is an onset of the row: `node` is its index, `tick` its place, `cell` the cells'
 * slot whose window holds it.
 * → { id, serial, type, band, motion, contour, root, over, from, bars, slotsPerBar, slots, mode, phase, swing, frame,
 *     n, cost, perNote, terms, notes, features }
 *   note { slot, cell, bar, beat, node, tick, tone, fraction, cents, octave, pitch, pc, outside, role, offset }
 */
export function describeLine(row, lattice, pick, rules, tag = {}) {
  const r = rulesOf(rules), { cost, terms, roles } = scoreLine(lattice, pick.picks, rules);
  const notes = pick.picks.map((p, i) => {
    const s = lattice.slots[p.slot], c = s.cands[p.cand];
    return { slot: p.slot, cell: s.cell, bar: s.bar, beat: s.beat, node: c.node, tick: row.tick[c.node], tone: c.tone, fraction: c.fraction, cents: c.cents, octave: c.octave, pitch: c.pitch, pc: c.pc, outside: roles[i].foreign, role: roles[i].role, offset: c.offset };
  });
  let steps = 0, skips = 0, leaps = 0, repeats = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < notes.length; i++) {
    lo = Math.min(lo, notes[i].pitch); hi = Math.max(hi, notes[i].pitch);
    if (!i) continue;
    const ad = Math.abs(notes[i].pitch - notes[i - 1].pitch);
    if (ad < r.same) repeats++; else if (ad <= r.step) steps++; else if (ad <= r.skip) skips++; else leaps++;
  }
  const over = r.targets ? r.targets.bars.map((b) => b.name) : [];
  const serial = `${tag.type ?? ''}|${lattice.from}+${lattice.bars}x${lattice.S}|${lattice.mode}:${lattice.phase.join('/')}|${r.targets?.scale ? over.join(' ') : ''}|${notes.map((x) => `${x.slot}:${x.fraction}:${x.octave}`).join(',')}`;
  return {
    id: `cl1:${fnv1aHex(serial)}`, serial, ...tag, over,
    from: lattice.from, bars: lattice.bars, slotsPerBar: lattice.S, slots: lattice.P, mode: lattice.mode, phase: lattice.phase, swing: lattice.swing, low: lattice.low, frame: lattice.frame,
    setting: { contour: r.contour, targets: r.targets },
    n: notes.length, cost, perNote: cost / notes.length, terms, notes,
    features: {
      density: notes.length / lattice.P, distinct: new Set(notes.map((x) => x.fraction)).size, pitchClasses: new Set(notes.filter((x) => !x.outside).map((x) => x.pc)).size,
      range: hi - lo, steps, skips, leaps, repeats, outside: notes.filter((x) => x.outside).length, chordTones: notes.filter((x) => x.role === 'chord').length,
    },
  };
}

/**
 * The table of lines over one span of the cells: every type × density band × contour (× motion, in the full table),
 * the cheapest line per note inside each band, ranked cheapest per note first. A type's line found twice is kept once:
 * the cheaper per note under one motion, the first found across motions (chunk-lines' rule).
 *   opts = { from = 0, bars, table: 'full' | 'lean', types: [type name] | LINE_TYPES entries, targets (default:
 *            rooted on the frame's root), weights, minTones, register (cents added to the range and contour: −1200 an
 *            octave down), rules (added to every run's: e.g. avoidSlots [bool by lattice slot] and avoidNodes [onset
 *            index] — an avoided node is never a candidate, an avoided slot costs weights.avoid a note; startTones [tone
 *            index] — the tones a line may open on; before, after — STEP 4a's boundaries for a bar-local re-mine: { pitch }
 *            (cents above 1/1, as a lattice candidate's) of the note just before the span and just after it, each move
 *            to them priced as a move inside the line, strict × interval × I; absent, nothing changes), weakTies
 *            (buildLattice's: a slot tied at the median, off the strong beats, weak too; default false) }
 * → { version, table, from, bars, slotsPerBar, root, over, frame, runs, lines } | { tooFewTones, tones, min }
 */
export function mineLines(row, cells, frame, opts = {}) {
  const { from = 0, table = 'full', weights = {}, minTones = MIN_TONES, register = 0, rules: extra = {}, weakTies = false } = opts;
  const refused = toneGate(row, minTones);
  if (refused) return refused;
  if (!TABLES.includes(table)) fail(`table must be one of ${TABLES.join(', ')}, not ${JSON.stringify(table)}`);
  const bars = opts.bars ?? cells.bars - from;
  const types = (opts.types ?? LINE_TYPES).map((t) => (typeof t === 'string' ? LINE_TYPES.find((x) => x.type === t) ?? fail(`no line type ${t}`) : t));
  const targets = opts.targets ?? rootTargets(row, Array.isArray(frame) ? frame[0] : frame), first = targets.bars[0];
  const harmonyWeights = targets.scale ? HARMONY_WEIGHTS : {};
  const lattices = new Map(), P = bars * cells.slotsPerBar;
  const low = first.anchor + register;
  const latticeFor = (width) => { if (!lattices.has(width)) lattices.set(width, buildLattice(row, cells, frame, { from, bars, low, width, weakTies })); return lattices.get(width); };
  const lines = [], bySerial = new Map();
  let runs = 0;
  const passes = table === 'lean' ? 1 : Math.max(...types.map((t) => (t.motions || [null]).length));
  for (let pass = 0; pass < passes; pass++) for (const type of types) {
    const motions = type.motions || [null];
    if (pass >= motions.length) continue;
    const motion = motions[pass], lattice = latticeFor(type.width ?? RANGE_WIDTH);
    for (const band of type.bands) for (const contour of type.contours) {
      const [nMin, nMax] = bandNotes(band, P);
      const rules = { ...type.rules, ...(motion ? MOTIONS[motion] : {}), ...extra, strict: band.strict, contour: { ...contour, low: contour.low + low }, targets,
        weights: { ...(type.rules.weights || {}), ...harmonyWeights, ...weights }, nMin, nMax };
      runs++;
      let best = null;
      for (const pick of pickLines(lattice, rules)) if (!best || pick.cost / pick.n < best.cost / best.n - EPS) best = pick;
      if (!best) continue;
      const line = describeLine(row, lattice, best, rules, { type: type.type, band: band.band, ...(motion ? { motion } : {}), contour, root: first.tone });
      const had = bySerial.get(line.serial);
      if (had === undefined) { bySerial.set(line.serial, lines.length); lines.push(line); }
      else if ((line.motion || '') === (lines[had].motion || '') && line.perNote < lines[had].perNote - EPS) lines[had] = line;
    }
  }
  lines.sort((a, b) => a.perNote - b.perNote || a.cost - b.cost || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    version: COMPOSER_LINES_VERSION, table, from, bars, slotsPerBar: cells.slotsPerBar, root: first.tone, over: targets.bars.map((b) => b.name),
    frame: frameSummary(framesFor(frame, bars, cells.slotsPerBar)), runs, lines,
  };
}
