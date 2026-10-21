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
//               The chords stay those of the first lead; a strong note of the kept lead off its chord is counted as an
//               exception on the chord.

import { toneGate, MIN_TONES } from './row.js';
import { frameAt, frameOf, classOfCents, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { mineLines, buildLattice, scoreLine, rulesOf, LINE_TYPES, MOTIONS, MAX_SLOTS, HARMONY_WEIGHTS, TABLES } from './lines.js';

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
 *   opts   { eachSide, gridBase, offset, modulation, prevPcs }
 * → { root (an entry of tones), quality, intervals, pcs (on the grid), rootPc, violations, held, support, offGrid,
 *     modulate, dev, offset } | null (no tones)
 */
export function chooseChord(tones, lead, { eachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, gridBase = 0, offset = 0, modulation = true, prevPcs = null, foldOffsets = true } = {}) {
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
      if (!best || before(key, best.key)) {
        best = { key, root: r, quality: q, intervals: [...q.intervals], pcs, rootPc, violations, held, support };
      }
    });
  }
  const step = modulationStep(best.root.cents, offset, gridBase, eachSide, { fold: foldOffsets });
  const modulate = modulation && step.modulate, after = modulate ? step.offset : offset;
  // on the sounding grid (the base's, at the bar's offset): the root after the retune, and the chord's classes
  const rootPc = modulate ? classOfCents(best.root.cents + after - gridBase).pc : best.rootPc;
  const pcs = modulate ? best.intervals.map((i) => mod(rootPc + i, 12)).sort((a, b) => a - b) : best.pcs;
  // the names, on the folded grid: the same pitches, read `shift` classes lower
  const shift = foldOffsets ? namingShift(after) : 0, namedPc = mod(rootPc - shift, 12);
  return { root: best.root, quality: best.quality, intervals: best.intervals, pcs, rootPc, violations: best.violations, held: best.held, support: best.support,
    offGrid: offGrid || (!modulation && step.modulate), modulate, dev: step.dev, offset: after,
    named: { offset: after - 100 * shift, shift, rootPc: namedPc, pcs: best.intervals.map((i) => mod(namedPc + i, 12)).sort((a, b) => a - b) } };
}

/** the cycle's bars in phrases of as many bars as MAX_SLOTS slots hold: [{ from, bars }] */
export function phrasesOf(cells) {
  const S = cells.slotsPerBar;
  if (S > MAX_SLOTS) fail(`a bar of ${S} slots is past the ${MAX_SLOTS} a line may hold`);
  const per = Math.max(1, Math.min(cells.bars, Math.floor(MAX_SLOTS / S))), out = [];
  for (let from = 0; from < cells.bars; from += per) out.push({ from, bars: Math.min(per, cells.bars - from) });
  return out;
}

/** each bar's tones from the cells' windows: [Map tone → { tone, count, strikes, node }], in the order the slots hold them */
function barMaterial(row, cells) {
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

/**
 * Harmony from melody over the cycle's cells.
 *   opts = { root (a tone, default the frame's default root), frameCentsEachSide (15), modulation (true), foldOffsets (true),
 *            table ('full' | 'lean'), referenceName ('C': the base root's name, for chord names), minTones }
 * → { version, root, frameCentsEachSide, modulation, table, lead, chords, targets, modulations, passes, exceptions }
 *   | { tooFewTones, tones, min }
 *   lead     { phrases: [line], notes: [note], kept: ['first' | 'second' per phrase] }
 *   chord    { bar, name, quality, kind, intervals, pcs, rootPc (named), gridPcs, gridRootPc (sounding grid), rootTone,
 *              rootFraction, rootCents, rootNode, offsetCents (named), rawOffsetCents, fundamentalRatio,
 *              strong (the kept lead's strong classes, on the grid), exceptions, support, offGrid, frame }
 *   modulations [{ bar, cents (named), rawCents, fundamentalRatio }]   from that bar on, relative to the base fundamental
 *   passes   { phrases: [{ from, bars, first: { id, perNote }, second: { id, perNote } | null, kept }], secondWins }
 */
export function harmonize(row, cells, opts = {}) {
  const { root = null, frameCentsEachSide: e = DEFAULT_FRAME_CENTS_EACH_SIDE, modulation = true, table = 'full', referenceName = 'C', minTones = MIN_TONES, foldOffsets = true } = opts;
  const refused = toneGate(row, minTones);
  if (refused) return refused;
  if (!TABLES.includes(table)) fail(`table must be one of ${TABLES.join(', ')}`);
  const refPc = PC_NAMES.indexOf(referenceName);
  if (refPc < 0) fail(`no note ${referenceName}`);
  const base = frameOf(row, root, e), S = cells.slotsPerBar, phrases = phrasesOf(cells);

  // 1. the lead, rooted, no harmony
  const firstLines = phrases.map(({ from, bars }) => mineLines(row, cells, base, { from, bars, types: ['lead'], table }).lines[0] ?? null);
  const leadNotesOf = (lines) => lines.flatMap((l) => (l ? l.notes : []));
  const firstNotes = leadNotesOf(firstLines);

  // 2. a chord a bar
  const material = barMaterial(row, cells), gridBase = base.rootCents, chords = [], modulations = [];
  let offset = 0, prevPcs = null;
  for (let k = 0; k < cells.bars; k++) {
    const tones = [...material[k].values()];
    const inBar = firstNotes.filter((n) => n.bar === k && !n.outside);
    let strong = inBar.filter((n) => isStrongBeat(n.beat, S));
    if (!strong.length && inBar.length) strong = [inBar[0]];
    const lead = inBar.map((n) => ({ cents: n.cents, strong: strong.includes(n) }));
    const pick = chooseChord(tones, lead, { eachSide: e, gridBase, offset, modulation, prevPcs, foldOffsets });
    if (!pick) { chords.push(null); continue; }
    if (pick.modulate) modulations.push({ bar: k, cents: pick.named.offset, rawCents: pick.offset, fundamentalRatio: 2 ** (pick.offset / 1200) });
    offset = pick.offset; prevPcs = pick.pcs;
    const r = pick.root;
    chords.push({
      bar: k, name: `${PC_NAMES[mod(pick.named.rootPc + refPc, 12)]}${pick.quality.suffix}`, quality: pick.quality.id, kind: pick.quality.kind,
      intervals: pick.intervals, pcs: pick.named.pcs, rootPc: pick.named.rootPc, gridPcs: pick.pcs, gridRootPc: pick.rootPc, rootTone: r.tone, rootFraction: row.tones[r.tone], rootCents: r.cents, rootNode: r.node,
      offsetCents: pick.named.offset, rawOffsetCents: offset, fundamentalRatio: 2 ** (offset / 1200), firstPass: { violations: pick.violations, held: pick.held }, support: pick.support, offGrid: pick.offGrid, frame: frameAt(row, r.tone, e),
    });
  }
  // a bar the windows left empty takes the chord before it (or after, for the first)
  for (let k = 0; k < chords.length; k++) if (!chords[k]) {
    const near = chords.slice(0, k).reverse().find(Boolean) ?? chords.slice(k + 1).find(Boolean);
    if (!near) fail('no bar of the cycle holds a tone');
    chords[k] = { ...near, bar: k, empty: true };
  }

  // 3. targets: a bar a chord, read in its own frame; the parent scale is the union of the chords' classes on the grid
  const scale = [...new Set(chords.flatMap((c) => c.gridPcs))].sort((a, b) => a - b);   // on the sounding grid: the names may fold
  const targets = {
    scale,
    bars: chords.map((c) => ({ name: c.name, root: 0, chord: [...c.intervals], tone: c.rootFraction, anchor: c.rootCents, scale: scale.map((p) => mod(p - c.gridRootPc, 12)).sort((a, b) => a - b) })),
  };

  // 4. the lead again over the chords; per phrase the cheaper per note under the harmony weights
  const passes = { phrases: [], secondWins: 0 }, kept = [], keptLines = [];
  phrases.forEach(({ from, bars }, i) => {
    const frames = chords.slice(from, from + bars).map((c) => c.frame), sub = { scale, bars: targets.bars.slice(from, from + bars) };
    const second = mineLines(row, cells, frames, { from, bars, types: ['lead'], table, targets: sub }).lines[0] ?? null;
    const first = firstLines[i];
    let firstUnder = Infinity;
    if (first) {
      const lattice = buildLattice(row, cells, frames, { from, bars, low: first.low, width: LINE_TYPES[0].width });
      firstUnder = costOn(lattice, first, rulesOfLine(first, sub, first.low, HARMONY_WEIGHTS));
    }
    const useSecond = second && !(firstUnder <= second.perNote + EPS);
    kept.push(useSecond ? 'second' : 'first'); keptLines.push(useSecond ? second : first);
    if (useSecond) passes.secondWins++;
    passes.phrases.push({ from, bars, first: first ? { id: first.id, perNote: first.perNote, perNoteUnderHarmony: firstUnder } : null, second: second ? { id: second.id, perNote: second.perNote } : null, kept: kept[i] });
  });
  const notes = leadNotesOf(keptLines);

  // 5. each chord against the kept lead: its strong notes off the chord are counted, not hidden
  let exceptions = 0;
  for (const c of chords) {
    const inBar = notes.filter((n) => n.bar === c.bar && !n.outside);
    let strong = inBar.filter((n) => isStrongBeat(n.beat, S));
    if (!strong.length && inBar.length) strong = [inBar[0]];
    c.strong = []; c.exceptions = [];
    for (const n of strong) {
      const { pc, dev } = classOfCents(n.cents - c.rootCents), held = Math.abs(dev) <= e + EPS && c.intervals.includes(pc);
      const onGrid = mod(c.rootPc + pc, 12);   // named
      c.strong.push(onGrid);
      if (!held) c.exceptions.push({ slot: n.slot, node: n.node, fraction: n.fraction, pc: onGrid, dev: Math.abs(dev) <= e + EPS ? dev : null });
    }
    exceptions += c.exceptions.length;
  }

  return {
    version: COMPOSER_HARMONY_VERSION, root: base.rootFraction, frameCentsEachSide: e, modulation, table,
    lead: { phrases: keptLines, notes, kept }, chords, targets, modulations, passes, exceptions,
  };
}
