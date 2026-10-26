// harmony.js — harmony from melody: the lead first, then a chord a bar from what the lead and the row sound there,
// each chord rooted on a tone of the row, and a retune where a root cannot be read on the composition's grid.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
// DESIGN_NOTES rulings and leanings this follows: harmony follows melody, parsimony only breaks ties (Sprint default
// 4); roots belong to chords and the frame centres on the root, so it moves from chord to chord (decided); modulation
// is a jump at a bar boundary, chosen by Compose, with a switch (Sprint default 3). Everything numeric here is proposed,
// not ruled.
//
//   lead        mined first (lines.js), rooted on the frame's root with no harmony, phrase by phrase: a phrase is as many
//               bars as 32 slots hold. The best by the miner's ranking.
//   grid        the composition's 12 classes: 100¢ steps from the base root's pitch. A bar SOUNDS at an offset in cents
//               (0 until a modulation); a tone's reading on the grid is its cents plus the offset.
//   bar         its material: every tone the bar's slot windows hold (onsets and strikes), and the lead's notes in it.
//               The lead's STRONG notes are those on the bar's downbeat and, for an even slot count, its middle beat;
//               a bar whose lead sounds on neither has its first note as its strong one. A lead note on a fringe tone
//               (outside the base frame) is a passing tone: it neither asks for a chord tone nor counts toward one.
//   chord       for every candidate root tone r of the bar (a tone the bar holds, the most heard of the tones in its own
//               ±frame), every quality of CHORD_QUALITIES read in r's frame (classes from r, ±frame each side), ranked:
//                 1. fewest strong lead notes the chord does not hold (a strong note on a fringe tone of r is not held)
//                 2. most lead notes held
//                 3. most support: the bar's onsets + strikes on the chord's classes, inside r's frame, over the bar's
//                    total, less SUPPORT_PER_TONE a chord tone (a tone must earn its place) and the quality's prior
//                 4. parsimony: the least voice-leading distance from the chord before, on the grid (a tie-break)
//                 5. the lower root, then the simpler quality
//               The root tone is r; its frame (`frame`) is centred on it, and the bar's targets are read there.
//   modulation  the chosen root tone sounds, at the bar's offset, more than ±frame from the grid: then from this bar on
//               the fundamental is retuned so it lands exactly on a step of the grid — { bar, cents, fundamentalRatio }
//               relative to the base fundamental. Folding (`foldOffsets`, default on) is a relabel, not a retune: the
//               fundamental stays where the snap put it, and the grid that NAMES the classes moves by whole classes so the
//               reported offset stays in [−50, +50)¢ (chords' rootPc, pcs and names, modulations' `cents`). `rawCents`,
//               `rawOffsetCents`, `gridPcs` and `fundamentalRatio` are the sounding values, the same either way. With `modulation: false` the fundamental never moves: only roots on
//               the grid are candidates, and a bar with none keeps its best root flagged `offGrid`.
//   second pass the lead is mined again over the chords (a bar a chord, each in its own frame, the parent scale the
//               union of the chords' classes), and per phrase the cheaper per note under the harmony weights is kept.
//   settling    (`settlePasses`, 0..3, default 3; Avery asked for it, the rules proposed, not ruled) the chords are
//               derived again from the kept lead, and the lead mined again over them, until the chords settle, repeat
//               an earlier round's (the best round of the cycle is kept) or the cap. 0 keeps the chords of the first
//               lead. A strong note of the kept lead off its chord is counted as an exception on the chord.
//   targeted    (`progression: { roots, choose }`, from progression.js `harmonyPins`; built 2026-10-22 night, proposed)
//               a bar with a pinned root tone takes its chord from `choose` (chooseChordOnRoot) in every derivation,
//               so the settle rounds re-derive its quality and never its root; a phrase whose bars are all pinned
//               skips the first, unharmonized lead. No progression: everything above, unchanged.
//   pinned lead (`lead: { notes }`, MIDI targets phase A3, Composer/TARGET_ORDER.md; proposed) the lead is given (a
//               clip placed on the row: target.js): nothing is mined for it. The chords are derived from those notes
//               once, by the same rules (a progression's pins too); there is no first mining, no second pass and no
//               settle round (settle.rounds = 0, `pinned: true`). Each phrase's line is a record of the given notes
//               (type 'lead', band 'pinned'), so the trace and the rearrange read it as any line. No `lead`: everything
//               above, unchanged.

import { toneGate, MIN_TONES } from './row.js';
import { frameAt, frameOf, classOfCents, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { mineLines, buildLattice, scoreLine, rulesOf, fnv1aHex, LINE_TYPES, MOTIONS, MAX_SLOTS, HARMONY_WEIGHTS, TABLES } from './lines.js';

export const COMPOSER_HARMONY_VERSION = 'composer-harmony-v1';
/** triads, sevenths and sus chords, simplest first: intervals as QualityCatalog (Playback/AdvancedPlayback) has them;
 *  `suffix` spells the chord so ProgressionSolver.parseChordSymbol reads it back to the same classes; `prior` is taken
 *  off a chord's support (proposed): the common chords nothing, sus2 and the sevenths a little, the rarer colours more */
export const CHORD_QUALITIES = Object.freeze([
  { id: 'major_triad', suffix: '', intervals: [0, 4, 7], kind: 'triad', prior: 0 },
  { id: 'minor_triad', suffix: 'm', intervals: [0, 3, 7], kind: 'triad', prior: 0 },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7], kind: 'sus', prior: 0 },
  { id: 'sus2', suffix: 'sus2', intervals: [0, 2, 7], kind: 'sus', prior: 0.02 },
  { id: 'dim_triad', suffix: 'dim', intervals: [0, 3, 6], kind: 'triad', prior: 0.06 },
  { id: 'aug_triad', suffix: 'aug', intervals: [0, 4, 8], kind: 'triad', prior: 0.06 },
  { id: 'dominant_7th', suffix: '7', intervals: [0, 4, 7, 10], kind: 'seventh', prior: 0.02 },
  { id: 'minor_7th', suffix: 'm7', intervals: [0, 3, 7, 10], kind: 'seventh', prior: 0.02 },
  { id: 'major_7th', suffix: 'maj7', intervals: [0, 4, 7, 11], kind: 'seventh', prior: 0.02 },
  { id: 'half_dim7', suffix: 'm7b5', intervals: [0, 3, 6, 10], kind: 'seventh', prior: 0.06 },
  { id: 'dim7', suffix: 'dim7', intervals: [0, 3, 6, 9], kind: 'seventh', prior: 0.06 },
  { id: 'minor_major_7th', suffix: 'mMaj7', intervals: [0, 3, 7, 11], kind: 'seventh', prior: 0.06 },
  { id: 'dom7_sus4', suffix: '7sus4', intervals: [0, 5, 7, 10], kind: 'sus', prior: 0.02 },
].map((q) => Object.freeze({ ...q, intervals: Object.freeze(q.intervals) })));
/** support a chord tone must earn, as a share of the bar's onsets and strikes (proposed) */
export const SUPPORT_PER_TONE = 0.08;
export const PC_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

const EPS = 1e-9;
const mod = (v, n) => ((v % n) + n) % n;
const fail = (what) => { throw new Error(`composer/harmony: ${what}`); };
/** lexicographic: does key a rank before key b? */
const before = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };

/** the lead's strong beats in a bar of S slots: the downbeat and, for an even S, the middle */
export const isStrongBeat = (beat, S) => beat === 0 || (S % 2 === 0 && beat === S / 2);

/** the least voice-leading between two class sets: each class to the nearest of the other, both ways (semitones) */
export function voiceLeading(a, b) {
  if (!a || !b || !a.length || !b.length) return 0;
  const near = (p, set) => { let m = 12; for (const q of set) { const d = Math.abs(p - q) % 12; m = Math.min(m, d, 12 - d); } return m; };
  let sum = 0;
  for (const p of a) sum += near(p, b);
  for (const p of b) sum += near(p, a);
  return sum;
}

/**
 * The modulation rule on its own: a root at `rootCents` (above 1/1) in a bar sounding at `offset` cents, on the grid of
 * 100¢ steps from `gridBase`. → { dev (cents off the grid), modulate, offset (the bar's offset after it) }
 */
export function modulationStep(rootCents, offset, gridBase, eachSide, { fold = true } = {}) {
  const { dev } = classOfCents(rootCents + offset - gridBase);
  const modulate = Math.abs(dev) > eachSide + EPS, next = modulate ? offset - dev : offset;
  const shift = fold ? namingShift(next) : 0;
  return { dev, modulate, offset: next, named: next - 100 * shift, shift };
}
/**
 * The fold (proposed, not ruled): a RELABEL, never a retune. The sounding offset is left as it is; the grid that names
 * the classes is moved by whole classes so the offset it reports stays in [−50, +50)¢. → the shift in classes: the
 * named offset is offset − 100 × shift, and a class reads shift classes lower than on the unshifted grid.
 */
export const namingShift = (offset) => Math.floor((offset + 50) / 100);

/**
 * One bar's chord, from its material in cents (the pure core of `harmonize`, usable on made-up bars):
 *   tones  [{ tone, cents, weight (onsets + strikes), count }]   the bar's tones; a candidate root must be among them
 *   lead   [{ cents, strong }]                                   the lead's notes in the bar, passing tones left out
 *   opts   { eachSide, gridBase, offset, modulation, prevPcs, foldOffsets, observe (the compose trace's: called with
 *            every (root, quality) ranked: root, quality, rootPc, violations, held, support, key) }
 * → { root (an entry of tones), quality, intervals, pcs (on the grid), rootPc, violations, held, support, offGrid,
 *     modulate, dev, offset } | null (no tones)
 */
export function chooseChord(tones, lead, { eachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, gridBase = 0, offset = 0, modulation = true, prevPcs = null, foldOffsets = true, observe = null } = {}) {
  if (!tones.length) return null;
  const e = eachSide + EPS;
  let total = 0; for (const t of tones) total += t.weight;
  // a candidate root is the most heard of the tones within its own ±frame on its class (onsets, then weight, then the lower index)
  const louder = (t, r) => t.count > r.count || (t.count === r.count && (t.weight > r.weight || (t.weight === r.weight && t.tone < r.tone)));
  const near = (t, r) => { const c = classOfCents(t.cents - r.cents); return c.pc === 0 && Math.abs(c.dev) <= e; };
  const roots = tones.filter((r) => !tones.some((t) => t !== r && near(t, r) && louder(t, r)));
  const onGrid = (r) => Math.abs(classOfCents(r.cents + offset - gridBase).dev) <= e;
  let pool = modulation ? roots : roots.filter(onGrid), offGrid = false;
  if (!pool.length) { pool = roots; offGrid = true; }
  let best = null;
  for (const r of pool) {
    const w = new Float64Array(12);
    for (const t of tones) { const c = classOfCents(t.cents - r.cents); if (Math.abs(c.dev) <= e) w[c.pc] += t.weight; }
    const leadPc = lead.map((n) => { const c = classOfCents(n.cents - r.cents); return Math.abs(c.dev) <= e ? c.pc : -1; });
    const rootPc = classOfCents(r.cents + offset - gridBase).pc;
    CHORD_QUALITIES.forEach((q, qi) => {
      let violations = 0, held = 0, support = 0;
      lead.forEach((n, i) => { const has = leadPc[i] >= 0 && q.intervals.includes(leadPc[i]); if (has) held++; else if (n.strong) violations++; });
      for (const i of q.intervals) support += w[i];
      support = (total ? support / total : 0) - SUPPORT_PER_TONE * q.intervals.length - q.prior;
      const pcs = q.intervals.map((i) => mod(rootPc + i, 12)).sort((a, b) => a - b);
      const key = [violations, -held, -Math.round(support * 1e9) / 1e9, voiceLeading(pcs, prevPcs), r.cents, qi];
      observe?.(r, q, rootPc, violations, held, support, key);   // the compose trace (trace.js), when on
      if (!best || before(key, best.key)) {
        best = { key, root: r, quality: q, intervals: [...q.intervals], pcs, rootPc, violations, held, support };
      }
    });
  }
  return pickFor(best.root, best.quality, { eachSide, gridBase, offset, modulation, foldOffsets, offGrid, violations: best.violations, held: best.held, support: best.support });
}

/**
 * A chord on a given root and quality, as chooseChord hands its pick on (its tail, lifted out in step 4a so a chord
 * swap builds the same pick): the modulation rule at the bar's incoming `offset`, the classes on the sounding grid,
 * and the names on the folded one.
 *   root     { tone, cents, node }   an entry of the bar's tones (barMaterial)
 *   quality  an entry of CHORD_QUALITIES (or progression.js' FALLBACK_QUALITIES)
 *   opts     { eachSide, gridBase, offset (the bar's incoming), modulation, foldOffsets, offGrid (no root of the bar was
 *            on the grid, with modulation off), violations, held, support (as ranked; carried, not recomputed) }
 * → chooseChord's pick: { root, quality, intervals, pcs, rootPc, violations, held, support, offGrid, modulate, dev, offset, named }
 */
export function pickFor(root, quality, { eachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, gridBase = 0, offset = 0, modulation = true, foldOffsets = true, offGrid = false, violations = 0, held = 0, support = 0 } = {}) {
  const intervals = [...quality.intervals], inPc = classOfCents(root.cents + offset - gridBase).pc;
  const step = modulationStep(root.cents, offset, gridBase, eachSide, { fold: foldOffsets });
  const modulate = modulation && step.modulate, after = modulate ? step.offset : offset;
  // on the sounding grid (the base's, at the bar's offset): the root after the retune, and the chord's classes
  const rootPc = modulate ? classOfCents(root.cents + after - gridBase).pc : inPc;
  const pcs = intervals.map((i) => mod(rootPc + i, 12)).sort((a, b) => a - b);
  // the names, on the folded grid: the same pitches, read `shift` classes lower
  const shift = foldOffsets ? namingShift(after) : 0, namedPc = mod(rootPc - shift, 12);
  return { root, quality, intervals, pcs, rootPc, violations, held, support,
    offGrid: offGrid || (!modulation && step.modulate), modulate, dev: step.dev, offset: after,
    named: { offset: after - 100 * shift, shift, rootPc: namedPc, pcs: intervals.map((i) => mod(namedPc + i, 12)).sort((a, b) => a - b) } };
}

/** the cycle's bars in phrases of as many bars as MAX_SLOTS slots hold: [{ from, bars }] */
export function phrasesOf(cells) {
  const S = cells.slotsPerBar;
  if (S > MAX_SLOTS) fail(`a bar of ${S} slots is past the ${MAX_SLOTS} a line may hold`);
  const per = Math.max(1, Math.min(cells.bars, Math.floor(MAX_SLOTS / S))), out = [];
  for (let from = 0; from < cells.bars; from += per) out.push({ from, bars: Math.min(per, cells.bars - from) });
  return out;
}

/** each bar's tones from the cells' windows: [Map tone → { tone, cents, count, strikes, weight, node }], in the order the
 *  slots hold them (exported in step 4a: a chord swap reads a bar's tones as harmonize does) */
export function barMaterial(row, cells) {
  const bars = Array.from({ length: cells.bars }, () => new Map());
  for (const s of cells.slots) for (const t of s.tones) {
    const m = bars[s.bar];
    if (!m.has(t.tone)) m.set(t.tone, { tone: t.tone, cents: row.toneCents[t.tone], count: 0, strikes: 0, weight: 0, node: t.node });
    const e = m.get(t.tone); e.count += t.count; e.strikes += t.strikes; e.weight = e.count + e.strikes;
  }
  return bars;
}

/** a line's rules as mineLines gave them, from its tags, under other targets (the second pass's scoring of the first) */
function rulesOfLine(line, targets, anchor, weights) {
  const type = LINE_TYPES.find((t) => t.type === line.type), band = type.bands.find((b) => b.band === line.band);
  return { ...type.rules, ...(line.motion ? MOTIONS[line.motion] : {}), strict: band.strict, contour: { ...line.contour, low: line.contour.low + anchor }, targets, weights: { ...(type.rules.weights || {}), ...weights } };
}
/** a line's cost per note on another lattice, or Infinity where its notes break a rule there (a fringe tone on a strong slot, unresolved, or last) */
function costOn(lattice, line, rules) {
  const picks = [];
  for (const x of line.notes) {
    const cand = lattice.slots[x.slot].cands.findIndex((c) => c.tone === x.tone && c.octave === x.octave);
    if (cand < 0) return Infinity;
    picks.push({ slot: x.slot, cand });
  }
  const { cost, roles } = scoreLine(lattice, picks, rules), r = rulesOf(rules);
  for (let i = 0; i < picks.length; i++) {
    if (!roles[i].foreign) continue;
    const slot = lattice.slots[picks[i].slot], next = picks[i + 1];
    if (!slot.weak || !next || roles[i + 1].foreign) return Infinity;
    const a = slot.cands[picks[i].cand].pitch, b = lattice.slots[next.slot].cands[next.cand].pitch;
    if (Math.abs(b - a) > r.step) return Infinity;
  }
  return cost / picks.length;
}

/** extra rounds of lead ↔ chords after the first derivation: at most this many (proposed, not ruled; Avery asked for settling) */
export const DEFAULT_SETTLE_PASSES = 3;
export const MAX_SETTLE_PASSES = 3;

/** the strong notes of a bar of S slots in a lead (passing tones left out): the downbeat and middle, else the first */
export function strongNotesOf(notes, bar, S) {
  const inBar = notes.filter((n) => n.bar === bar && !n.outside);
  let strong = inBar.filter((n) => isStrongBeat(n.beat, S));
  if (!strong.length && inBar.length) strong = [inBar[0]];
  return { inBar, strong };
}
/**
 * A bar's chord record, from a pick (chooseChord, pickFor or progression.js' chooseChordOnRoot): what harmonize hands
 * Compose for every bar (lifted out of harmonize in step 4a, so a chord swap builds the same record).
 *   opts { eachSide (the frame), referencePc (the base root's name: 0 for C), pinned (a progression's bar) }
 * → { bar, name, quality, kind, intervals, pcs, rootPc, gridPcs, gridRootPc, rootTone, rootFraction, rootCents, rootNode,
 *     offsetCents, rawOffsetCents, fundamentalRatio, firstPass, support, offGrid, frame, (pinned: targeted, fallback,
 *     sounded, missing) } — harmonize adds `strong` and `exceptions` once the lead is kept
 */
export function chordRecord(row, bar, pick, { eachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, referencePc = 0, pinned = false } = {}) {
  const r = pick.root, offset = pick.offset;
  return {
    bar, name: `${PC_NAMES[mod(pick.named.rootPc + referencePc, 12)]}${pick.quality.suffix}`, quality: pick.quality.id, kind: pick.quality.kind,
    intervals: pick.intervals, pcs: pick.named.pcs, rootPc: pick.named.rootPc, gridPcs: pick.pcs, gridRootPc: pick.rootPc, rootTone: r.tone, rootFraction: row.tones[r.tone], rootCents: r.cents, rootNode: r.node,
    offsetCents: pick.named.offset, rawOffsetCents: offset, fundamentalRatio: 2 ** (offset / 1200), firstPass: { violations: pick.violations, held: pick.held }, support: pick.support, offGrid: pick.offGrid, frame: frameAt(row, r.tone, eachSide),
    ...(pinned ? { targeted: true, fallback: pick.fallback, sounded: pick.sounded, missing: pick.missing } : {}),
  };
}
/** one bar's target (lines.js' shape), its chord read in its own frame, the parent `scale` (on the sounding grid) moved there */
export const targetOfBar = (c, scale) => ({ name: c.name, root: 0, chord: [...c.intervals], tone: c.rootFraction, anchor: c.rootCents, scale: scale.map((p) => mod(p - c.gridRootPc, 12)).sort((a, b) => a - b) });
/** targets: a bar a chord, read in its own frame; the parent scale is the union of the chords' classes on the sounding grid (the names may fold) */
export function targetsOf(chords) {
  const scale = [...new Set(chords.flatMap((c) => c.gridPcs))].sort((a, b) => a - b);
  return { scale, bars: chords.map((c) => targetOfBar(c, scale)) };
}
/**
 * A chord's exceptions: the lead's strong notes in its bar (passing tones left out) that it does not hold, inside ±e.
 * → { strong: [named class of each strong note], exceptions: [{ slot, node, fraction, pc, dev }] }
 */
export function exceptionsOfBar(c, notes, S, e) {
  const { strong } = strongNotesOf(notes, c.bar, S), mine = [], strongPcs = [];
  for (const n of strong) {
    const { pc, dev } = classOfCents(n.cents - c.rootCents), held = Math.abs(dev) <= e + EPS && c.intervals.includes(pc);
    const onGrid = mod(c.rootPc + pc, 12);   // named
    strongPcs.push(onGrid);
    if (!held) mine.push({ slot: n.slot, node: n.node, fraction: n.fraction, pc: onGrid, dev: Math.abs(dev) <= e + EPS ? dev : null });
  }
  return { strong: strongPcs, exceptions: mine };
}

/** a pinned lead's notes ({ notes }), checked against the cells and put in slot order (copies) */
function pinnedNotes(lead, cells) {
  if (!Array.isArray(lead.notes)) fail('a pinned lead is { notes: [note] }');
  const out = lead.notes.map((n) => ({ ...n }));
  for (const n of out) {
    if (!(Number.isInteger(n.cell) && n.cell >= 0 && n.cell < cells.P)) fail(`a pinned lead note's cell ${n.cell} is not one of the ${cells.P} slots`);
    if (!(Number.isInteger(n.node) && Number.isFinite(n.cents))) fail('a pinned lead note needs its node and cents');
  }
  return out.sort((a, b) => a.cell - b.cell || a.node - b.node);
}
/** a pinned lead's phrase as a line record (lines.js' shape, as far as the trace and the rearrange read one) */
function pinnedLine(notes, from, bars, S) {
  const serial = `pinned|${from}+${bars}x${S}|${notes.map((x) => `${x.cell}:${x.node}:${x.octave}`).join(',')}`;
  return { id: `pl1:${fnv1aHex(serial)}`, serial, type: 'lead', band: 'pinned', motion: null, contour: null, root: null, over: [],
    from, bars, slotsPerBar: S, slots: bars * S, n: notes.length, cost: 0, perNote: 0, notes };
}

/** what makes two derivations' chords the same: per bar, the root tone, the quality and the (sounding) offset */
const chordKey = (chords) => chords.map((c) => `${c.rootTone}|${c.quality}|${c.rawOffsetCents}`);

/**
 * The settling loop on its own (pure; harmonize's rounds, testable on made-up states):
 *   start    round 0's state: { chords, exceptions, cost, ... }
 *   cap      the most rounds after it
 *   derive   (state) → the chords the state's lead implies
 *   key      (chords) → a string per bar: two derivations are the same when every bar's is
 *   advance  (chords, state, round) → the next state, over those chords
 * Round i derives chords from state i − 1. The same chords as state i − 1's: converged, stop. The same as an earlier
 * state j's: oscillated, stop, and keep the state of the cycle j..i − 1 with the fewest exceptions, then the lower cost,
 * then the earlier. Otherwise advance; at the cap, keep the last state.
 * → { states, rounds: [{ round, changedBars, repeats? }], converged, oscillated, cycle: [state index] | null, chosen }
 */
export function settleRounds(start, cap, { derive, key, advance }) {
  const states = [start], keys = [key(start.chords).join('\u0000')], rounds = [];
  let chosen = 0, converged = false, oscillated = false, cycle = null;
  for (let i = 1; i <= cap; i++) {
    const prev = states[i - 1], chords = derive(prev), k = key(chords), prevK = key(prev.chords);
    const changedBars = k.flatMap((x, b) => (x !== prevK[b] ? [b] : []));
    if (!changedBars.length) { rounds.push({ round: i, changedBars }); converged = true; break; }
    const repeats = keys.indexOf(k.join('\u0000'));
    if (repeats >= 0) {
      rounds.push({ round: i, changedBars, repeats });
      oscillated = true; cycle = [];
      for (let j = repeats; j < i; j++) cycle.push(j);
      chosen = cycle.reduce((a, b) => (states[b].exceptions < states[a].exceptions || (states[b].exceptions === states[a].exceptions && states[b].cost < states[a].cost - EPS) ? b : a));
      break;
    }
    states.push(advance(chords, prev, i)); keys.push(k.join('\u0000'));
    rounds.push({ round: i, changedBars });
    chosen = i;
  }
  return { states, rounds, converged, oscillated, cycle, chosen };
}

/**
 * Harmony from melody over the cycle's cells.
 *   opts = { root (a tone, default the frame's default root), frameCentsEachSide (15), modulation (true), foldOffsets (true),
 *            table ('full' | 'lean'), referenceName ('C': the base root's name, for chord names), minTones,
 *            settlePasses (0..3, default 3: extra rounds of chords ↔ lead, below), progression (progression.js
 *            `harmonyPins`), trace (a trace.js recorder, or null: it is shown every decision and steers none),
 *            lead ({ notes }: a pinned lead, lines.js' note shape — slot, cell, bar, beat, node, tick, tone, fraction,
 *            cents, octave, pitch, pc, outside — the chords derived from it once; see the head of this file) }
 * → { version, root, frameCentsEachSide, modulation, table, lead, chords, targets, modulations, passes, exceptions, settle }
 *   | { tooFewTones, tones, min }
 *   lead     { phrases: [line], notes: [note], kept: ['first' | 'second' | 'round1'.. per phrase: the pass its line is from] }
 *   chord    { bar, name, quality, kind, intervals, pcs, rootPc (named), gridPcs, gridRootPc (sounding grid), rootTone,
 *              rootFraction, rootCents, rootNode, offsetCents (named), rawOffsetCents, fundamentalRatio,
 *              firstPass (violations and held against the lead it was derived from), strong (the kept lead's strong
 *              classes, on the grid), exceptions, support, offGrid, frame }
 *   modulations [{ bar, cents (named), rawCents, fundamentalRatio }]   from that bar on, relative to the base fundamental
 *   passes   { phrases: [{ from, bars, first: { id, perNote, perNoteUnderHarmony }, second: { id, perNote } | null, kept }],
 *              secondWins, rounds: [{ round, changedBars: [bar], newerKept, phrases: [{ from, bars,
 *              current: { id, line, perNoteUnderHarmony } | null, newer: { id, perNote } | null, kept: 'current' | 'newer' }],
 *              repeats? (the round whose chords this one reproduced) }] }
 *   settle   { cap, rounds, converged, oscillated, cycle: [round] | null, chosenRound, changedBarsPerRound,
 *              exceptionsPerRound, leadCostPerRound (per note, each round's kept lead on its own targets) }
 *
 * Settling (proposed, not ruled; Avery asked for it): round 0 is the first derivation (chords from the rooted lead, the
 * lead again over them, the cheaper per note per phrase kept). Each round i ≥ 1 re-derives every chord from the lead
 * round i − 1 kept, by the same rules (the modulation offset walked from bar 1 again), rebuilds the targets, mines the
 * lead over them and keeps, per phrase, the cheaper per note of that line and the kept one re-scored on the new
 * targets. It stops when a round's chords equal the round before's (converged), at `settlePasses` rounds, or when a
 * round's chords repeat an earlier round's (oscillated): then the round of the cycle with the fewest exceptions, then
 * the cheaper lead per note, then the earlier, is kept. Exceptions are counted at the end, the kept lead against the
 * kept chords.
 */
export function harmonize(row, cells, opts = {}) {
  const { root = null, frameCentsEachSide: e = DEFAULT_FRAME_CENTS_EACH_SIDE, modulation = true, table = 'full', referenceName = 'C', minTones = MIN_TONES, foldOffsets = true, settlePasses = DEFAULT_SETTLE_PASSES, progression = null, trace: rec = null } = opts;
  const refused = toneGate(row, minTones);
  if (refused) return refused;
  if (!TABLES.includes(table)) fail(`table must be one of ${TABLES.join(', ')}`);
  if (!(Number.isInteger(settlePasses) && settlePasses >= 0 && settlePasses <= MAX_SETTLE_PASSES)) fail(`settlePasses must be an integer 0..${MAX_SETTLE_PASSES}, not ${JSON.stringify(settlePasses)}`);
  const refPc = PC_NAMES.indexOf(referenceName);
  if (refPc < 0) fail(`no note ${referenceName}`);
  const base = frameOf(row, root, e), S = cells.slotsPerBar, phrases = phrasesOf(cells);
  // a targeted progression (progression.js): a pinned root tone per bar, or null for a bar derived as below
  const pins = progression ? progression.roots : null;
  if (pins && (pins.length !== cells.bars || typeof progression.choose !== 'function')) fail(`a progression is { roots: [tone | null] × ${cells.bars} bars, choose }`);
  const allPinned = (from, bars) => !!pins && pins.slice(from, from + bars).every((t) => t != null);
  // a pinned lead (MIDI targets): its notes in slot order, read as a line's
  const given = opts.lead ? pinnedNotes(opts.lead, cells) : null;

  // 1. the lead, rooted, no harmony (not for a phrase whose every bar is pinned, nor a pinned lead)
  const firstLines = given ? null : phrases.map(({ from, bars }, i) => {
    if (allPinned(from, bars)) { rec?.lead('first', i, from, bars, null); return null; }
    const mined = mineLines(row, cells, base, { from, bars, types: ['lead'], table }).lines;
    rec?.lead('first', i, from, bars, mined);
    return mined[0] ?? null;
  });
  const leadNotesOf = (lines) => lines.flatMap((l) => (l ? l.notes : []));

  // 2. a chord a bar, from a lead: the offset walked from bar 1
  const material = barMaterial(row, cells), gridBase = base.rootCents;
  const chordsFrom = (leadNotes, round = 0) => {
    const chords = [], modulations = [];
    let offset = 0, prevPcs = null;
    for (let k = 0; k < cells.bars; k++) {
      const tones = [...material[k].values()];
      const { inBar, strong } = strongNotesOf(leadNotes, k, S);
      const lead = inBar.map((n) => ({ cents: n.cents, strong: strong.includes(n) }));
      const pin = pins ? pins[k] : null, how = { eachSide: e, gridBase, offset, modulation, prevPcs, foldOffsets, observe: rec?.candidates(round, k, (foldOffsets ? namingShift(offset) : 0) - refPc) };
      const pick = pin != null ? progression.choose(tones, lead, { tone: pin, cents: row.toneCents[pin], ...(progression.qualities ? { quality: progression.qualities[k] } : {}) }, how) : chooseChord(tones, lead, how);
      if (!pick) { chords.push(null); continue; }
      if (pick.modulate) modulations.push({ bar: k, cents: pick.named.offset, rawCents: pick.offset, fundamentalRatio: 2 ** (pick.offset / 1200) });
      offset = pick.offset; prevPcs = pick.pcs;
      chords.push(chordRecord(row, k, pick, { eachSide: e, referencePc: refPc, pinned: pin != null }));
    }
    // a bar the windows left empty takes the chord before it (or after, for the first)
    for (let k = 0; k < chords.length; k++) if (!chords[k]) {
      const near = chords.slice(0, k).reverse().find(Boolean) ?? chords.slice(k + 1).find(Boolean);
      if (!near) fail('no bar of the cycle holds a tone');
      chords[k] = { ...near, bar: k, empty: true };
    }
    rec?.chords(round, chords, modulations);
    return { chords, modulations };
  };

  // 3. targets: a bar a chord, read in its own frame; the parent scale is the union of the chords' classes on the grid
  // (targetsOf, exported above)

  // 4. the lead again over the chords; per phrase the cheaper per note under the harmony weights, the line held so far
  //    re-scored on the new targets
  const leadOver = (chords, targets, held, heldTags, tag) => {
    const lines = [], tags = [], info = [];
    let newerWins = 0, cost = 0, count = 0;
    phrases.forEach(({ from, bars }, i) => {
      const frames = chords.slice(from, from + bars).map((c) => c.frame), sub = { scale: targets.scale, bars: targets.bars.slice(from, from + bars) };
      const mined = mineLines(row, cells, frames, { from, bars, types: ['lead'], table, targets: sub }).lines, newer = mined[0] ?? null;
      const cur = held[i];
      let under = Infinity;
      if (cur) {
        const lattice = buildLattice(row, cells, frames, { from, bars, low: cur.low, width: LINE_TYPES[0].width });
        under = costOn(lattice, cur, rulesOfLine(cur, sub, cur.low, HARMONY_WEIGHTS));
      }
      const useNewer = newer && !(under <= newer.perNote + EPS), kept = useNewer ? newer : cur;
      lines.push(kept); tags.push(useNewer ? tag : heldTags[i]);
      if (useNewer) newerWins++;
      if (kept) { cost += (useNewer ? newer.perNote : under) * kept.notes.length; count += kept.notes.length; }
      info.push({ from, bars, cur, curTag: heldTags[i], under, newer, useNewer });
      rec?.lead(tag, i, from, bars, mined, { cur, curTag: heldTags[i], under, useNewer });
    });
    return { lines, tags, info, newerWins, perNote: count ? cost / count : 0 };
  };

  // 5. a lead's strong notes against chords: those off their chord are exceptions (written onto the chords when kept)
  const exceptionsOf = (chords, notes, write = false) => {
    let total = 0;
    for (const c of chords) {
      const { strong: strongPcs, exceptions: mine } = exceptionsOfBar(c, notes, S, e);
      if (write) { c.strong = strongPcs; c.exceptions = mine; }
      total += mine.length;
    }
    return total;
  };

  // a pinned lead: the chords from its notes once, no second pass, no settling
  if (given) {
    phrases.forEach(({ from, bars }, i) => rec?.lead('first', i, from, bars, null));
    const d = chordsFrom(given), targets = targetsOf(d.chords), exceptions = exceptionsOf(d.chords, given, true);
    const lines = phrases.map(({ from, bars }) => pinnedLine(given.filter((n) => n.bar >= from && n.bar < from + bars), from, bars, S));
    const passes = { phrases: phrases.map(({ from, bars }) => ({ from, bars, first: null, second: null, kept: 'pinned' })), secondWins: 0, rounds: [] };
    rec?.settled({ rounds: [] }, passes);
    return {
      version: COMPOSER_HARMONY_VERSION, root: base.rootFraction, frameCentsEachSide: e, modulation, table,
      lead: { phrases: lines, notes: given, kept: phrases.map(() => 'pinned'), pinned: true }, chords: d.chords, targets, modulations: d.modulations, passes, exceptions,
      settle: { cap: 0, rounds: 0, converged: true, oscillated: false, cycle: null, chosenRound: 0, changedBarsPerRound: [], exceptionsPerRound: [exceptions], leadCostPerRound: [], pinned: true },
    };
  }

  // round 0: the chords of the rooted lead, and the lead over them
  const firstTags = phrases.map(() => 'first');
  const d0 = chordsFrom(leadNotesOf(firstLines)), t0 = targetsOf(d0.chords), l0 = leadOver(d0.chords, t0, firstLines, firstTags, 'second');
  const passes = { phrases: l0.info.map((x) => ({ from: x.from, bars: x.bars, first: x.cur ? { id: x.cur.id, perNote: x.cur.perNote, perNoteUnderHarmony: x.under } : null, second: x.newer ? { id: x.newer.id, perNote: x.newer.perNote } : null, kept: x.useNewer ? 'second' : 'first' })),
    secondWins: l0.newerWins, rounds: [] };
  const stateOf = (d, targets, l, info = null) => ({ chords: d.chords, modulations: d.modulations, targets, lines: l.lines, tags: l.tags, cost: l.perNote, exceptions: exceptionsOf(d.chords, leadNotesOf(l.lines)), info, newerWins: l.newerWins });

  // rounds 1..settlePasses: the chords from the kept lead, until they settle, repeat, or the cap
  let round = 0;
  const run = settleRounds(stateOf(d0, t0, l0), settlePasses, {
    derive: (state) => { round++; rec?.settle(round); return chordsFrom(leadNotesOf(state.lines), round); },
    key: (x) => chordKey(Array.isArray(x) ? x : x.chords),
    advance: (d, prev, i) => { const targets = targetsOf(d.chords), l = leadOver(d.chords, targets, prev.lines, prev.tags, `round${i}`); return stateOf(d, targets, l, l.info); },
  });
  for (const r of run.rounds) {
    const st = !('repeats' in r) && r.changedBars.length ? run.states[r.round] : null;
    passes.rounds.push({ round: r.round, changedBars: r.changedBars, newerKept: st ? st.newerWins : 0,
      phrases: st ? st.info.map((x) => ({ from: x.from, bars: x.bars, current: x.cur ? { id: x.cur.id, line: x.curTag, perNoteUnderHarmony: x.under } : null, newer: x.newer ? { id: x.newer.id, perNote: x.newer.perNote } : null, kept: x.useNewer ? 'newer' : 'current' })) : [],
      ...('repeats' in r ? { repeats: r.repeats } : {}) });
  }
  rec?.settled(run, passes);
  const final = run.states[run.chosen], notes = leadNotesOf(final.lines);
  const exceptions = exceptionsOf(final.chords, notes, true);

  return {
    version: COMPOSER_HARMONY_VERSION, root: base.rootFraction, frameCentsEachSide: e, modulation, table,
    lead: { phrases: final.lines, notes, kept: final.tags }, chords: final.chords, targets: final.targets, modulations: final.modulations, passes, exceptions,
    settle: { cap: settlePasses, rounds: run.rounds.length, converged: run.converged, oscillated: run.oscillated, cycle: run.cycle, chosenRound: run.chosen,
      changedBarsPerRound: run.rounds.map((r) => r.changedBars.length), exceptionsPerRound: run.states.map((x) => x.exceptions), leadCostPerRound: run.states.map((x) => x.cost) },
  };
}
