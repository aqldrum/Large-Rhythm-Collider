// progression.js — targeted progressions: the user names a chord ROOT per bar, from the row's own tones, and Compose
// finds the rest (built 2026-10-22 night, sprint; Avery decided the input, the rules here are proposed, not ruled).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   input      `compose(layers, T, { progression })`: one entry a bar (one chord a bar in v1), each a ratio of the row
//              ('3/2'), `{ ratio }`, or null / '' / 'auto' for a bar Compose solves as it always has. All auto (or no
//              progression) is the lead-led path exactly as before. `readProgression` reads it against the row and N:
//                a longer list is cut to N bars, a shorter one padded with auto (the lab's bars knob may change N
//                under a progression typed for another N); a ratio that is not a tone of this row is auto, and said.
//   candidates `rootCandidates(layers | row, { frameCentsEachSide, presence, root })`: what the lab lists — the row's
//              ±frame clusters (frame.js `clusterPresence`), each by its representative (the loudest tone of its own
//              cluster, as a bar's candidate roots are picked), with its ratio, cents, note name on the composition's
//              grid (the base root called C, as chords are named, before any modulation), and presence. The same base
//              root Compose would pick (or `root`), so it runs before a compose; one row build and one sweep.
//   chord      `chooseChordOnRoot(tones, lead, pin, opts)`: harmony.js `chooseChord` with the root fixed. The bar's
//              tones are read in the pinned root's ±frame; a quality of CHORD_QUALITIES is SUPPORTED when the bar sounds
//              all its classes but at most one (MAX_MISSING; the root is one of them, so over a root the bar does not
//              sound, every other class must). That is the slack Compose's own chords take: of 70 auto chords on ten
//              rows, 45 sound whole in their bar, 22 lack one class, 3 (sevenths) two. The supported qualities are
//              ranked as chooseChord ranks them (strong lead notes not held, lead notes held, support, parsimony, the
//              simpler). None supported: the thinnest dyad whose other tone the bar sounds (a power chord on the
//              fifth, else the root and its major or minor third: FALLBACK_QUALITIES), else the root alone. Never a
//              throw for a tone of the row.
//              The root tone is the pin, exactly; `rootNode` is the bar's onset of that tone, or null when only its
//              cluster (or nothing of it) sounds there — every note any part plays stays an onset of the row.
//   modulation the pinned root runs harmony.js' own rule (`modulationStep`): off the grid at the bar's offset, the
//              fundamental retunes from that bar on, for every part. Modulation off: the root is kept, flagged offGrid.
//   in harmonize  `harmonize(..., { progression: { roots, choose } })` (harmony.js): a pinned bar's chord comes from
//              here in every derivation (round 0 and each settle round), so the settle passes re-derive the QUALITY
//              under the kept lead and never the root. A phrase whose bars are all pinned skips the first, unharmonized
//              lead pass (its chords need no lead); a phrase with an auto bar mines it as before, and the auto bars
//              are derived from it, the pinned ones ranked with it too.

import { buildRow, isRow, toneGate, ONSET_GATE, MIN_TONES } from './row.js';
import { classOfCents, clusterPresence, defaultRoot, toneIndexOf, PRESENCE_MODES, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { CHORD_QUALITIES, SUPPORT_PER_TONE, PC_NAMES, voiceLeading, modulationStep, namingShift } from './harmony.js';

export const COMPOSER_PROGRESSION_VERSION = 'composer-progression-v1';
/** the thin chords a pinned root falls back to when no quality of CHORD_QUALITIES is supported, thinnest last; each
 *  suffix reads back through ProgressionSolver.parseChordSymbol to its intervals ('5', 'no5', 'mno5', 'no3no5') */
export const FALLBACK_QUALITIES = Object.freeze([
  { id: 'power', suffix: '5', intervals: [0, 7], kind: 'dyad', prior: 0 },
  { id: 'major_no5', suffix: 'no5', intervals: [0, 4], kind: 'dyad', prior: 0 },
  { id: 'minor_no5', suffix: 'mno5', intervals: [0, 3], kind: 'dyad', prior: 0 },
  { id: 'root_only', suffix: 'no3no5', intervals: [0], kind: 'root', prior: 0 },
].map((q) => Object.freeze({ ...q, intervals: Object.freeze(q.intervals) })));
/** the classes a supported quality may lack in its bar (proposed) */
export const MAX_MISSING = 1;
const AUTO = new Set([null, undefined, '', 'auto']);

const EPS = 1e-9;
const mod = (v, n) => ((v % n) + n) % n;
const fail = (what) => { throw new Error(`composer/progression: ${what}`); };
const before = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };

/** a cents deviation as a label: '', '+3.2¢', '−14.0¢' */
const devLabel = (d) => (Math.abs(d) < 0.05 ? '' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}¢`);

/**
 * The roots a user may pick, for a row (or the layers to build one): the row's ±frame clusters by representative, in
 * pitch order up from the base root (the root first). opts { frameCentsEachSide (15), presence ('cluster'), root (a
 * tone: the base root; default as Compose picks it) }.
 * → { version, root (ratio), frameCentsEachSide, onsets, candidates: [{ tone, ratio, cents, fromRoot, pc, dev, name,
 *     label, presence (the cluster's onsets), share (of the row's onsets), onsets (its own), members, isRoot, offGrid }] }
 *   | { version, refused: true, reason, candidates: [] }
 */
export function rootCandidates(rowOrLayers, { frameCentsEachSide: e = DEFAULT_FRAME_CENTS_EACH_SIDE, presence = 'cluster', root = null } = {}) {
  const row = Array.isArray(rowOrLayers) ? buildRow(rowOrLayers, { gate: ONSET_GATE }) : rowOrLayers;
  if (!isRow(row)) return { version: COMPOSER_PROGRESSION_VERSION, refused: true, reason: row?.tooDense ? 'tooDense' : 'tooLarge', candidates: [] };
  if (toneGate(row, MIN_TONES)) return { version: COMPOSER_PROGRESSION_VERSION, refused: true, reason: 'tooFewTones', candidates: [] };
  if (!PRESENCE_MODES.includes(presence)) fail(`presence must be one of ${PRESENCE_MODES.join(', ')}`);
  const base = root != null ? toneIndexOf(row, root) : defaultRoot(row, e, { presence }), baseCents = row.toneCents[base];
  const cl = clusterPresence(row, e), out = [];
  for (let t = 0; t < row.tones.length; t++) {
    if (!cl.representative[t] && t !== base) continue;
    const k = classOfCents(row.toneCents[t] - baseCents), name = `${PC_NAMES[k.pc]}${devLabel(k.dev)}`;
    out.push({ tone: t, ratio: row.tones[t], cents: row.toneCents[t], fromRoot: mod(row.toneCents[t] - baseCents, 1200), pc: k.pc, dev: k.dev, name,
      label: `${row.tones[t]} · ${name} · ${row.toneCents[t].toFixed(1)}¢`, presence: cl.presence[t], share: cl.presence[t] / row.n, onsets: row.toneCount[t], members: cl.size[t],
      isRoot: t === base, offGrid: Math.abs(k.dev) > e + EPS });
  }
  out.sort((a, b) => (b.isRoot - a.isRoot) || a.fromRoot - b.fromRoot || a.cents - b.cents);
  return { version: COMPOSER_PROGRESSION_VERSION, root: row.tones[base], frameCentsEachSide: e, onsets: row.n, candidates: out };
}

/**
 * A progression read against a row of N bars. → { targeted (any bar pinned), roots: [tone | null] × N, asked: the
 * entries as given (for the spec's input), notes: [what was cut, padded or not found] }
 */
export function readProgression(progression, row, bars) {
  if (progression == null) return { targeted: false, roots: Array(bars).fill(null), asked: null, notes: [] };
  if (!Array.isArray(progression)) fail(`a progression is a list, one root a bar (a ratio or null), not ${JSON.stringify(progression)}`);
  const notes = [], given = progression.length;
  if (given > bars) notes.push(`${given} slots for ${bars} bars: the last ${given - bars} dropped`);
  else if (given < bars) notes.push(`${given} slot${given === 1 ? '' : 's'} for ${bars} bars: bar${bars - given > 1 ? 's' : ''} ${given + 1}${bars - given > 1 ? `–${bars}` : ''} auto`);
  const roots = Array.from({ length: bars }, (_, k) => {
    const x = progression[k];
    if (AUTO.has(x)) return null;
    const ratio = typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x.ratio ?? x.root) === 'string' ? (x.ratio ?? x.root) : fail(`bar ${k + 1}: a root is a ratio of the row ('3/2'), { ratio }, or null, not ${JSON.stringify(x)}`);
    const t = row.tones.indexOf(ratio);
    if (t < 0) { notes.push(`bar ${k + 1}: ${ratio} is not a tone of this row, so auto`); return null; }
    return t;
  });
  const asked = progression.map((x) => (AUTO.has(x) ? null : typeof x === 'string' ? x : (x.ratio ?? x.root)));
  return { targeted: roots.some((r) => r != null), roots, asked, notes };
}

/** does the bar sound a class of the pinned root: its weight there, read in the root's ±frame → Float64Array(12) */
function classWeights(tones, rootCents, e) {
  const w = new Float64Array(12);
  for (const t of tones) { const c = classOfCents(t.cents - rootCents); if (Math.abs(c.dev) <= e) w[c.pc] += t.weight; }
  return w;
}

/**
 * One bar's chord on a pinned root (chooseChord's shape, so harmonize takes it as its own):
 *   tones  [{ tone, cents, weight, count, node }]   the bar's tones (may be empty)
 *   lead   [{ cents, strong }]                      the lead's notes in the bar, passing tones left out (may be empty)
 *   pin    { tone, cents }                          the root asked
 *   opts   { eachSide, gridBase, offset, modulation, prevPcs, foldOffsets }
 * → chooseChord's fields + { targeted: true, fallback: null | quality id, sounded: 'exact' | 'cluster' | 'absent',
 *     missing: [interval] (the classes the chosen quality lacks in the bar; on a fallback, those of
 *     the catalog quality the bar comes nearest to) }
 */
export function chooseChordOnRoot(tones, lead, pin, { eachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, gridBase = 0, offset = 0, modulation = true, prevPcs = null, foldOffsets = true } = {}) {
  if (!pin || !Number.isFinite(pin.cents)) fail('a pinned root needs its tone and cents');
  const e = eachSide + EPS;
  let total = 0; for (const t of tones) total += t.weight;
  const own = tones.find((t) => t.tone === pin.tone);
  const kin = own ? null : tones.find((t) => { const c = classOfCents(t.cents - pin.cents); return c.pc === 0 && Math.abs(c.dev) <= e; });
  const root = { tone: pin.tone, cents: pin.cents, node: own ? own.node : null, count: own ? own.count : 0, weight: own ? own.weight : 0 };
  const sounded = own ? 'exact' : kin ? 'cluster' : 'absent';
  const w = classWeights(tones, pin.cents, e), present = (i) => w[i] > 0, lacks = (q) => q.intervals.filter((i) => !present(i));
  const leadPc = lead.map((n) => { const c = classOfCents(n.cents - pin.cents); return Math.abs(c.dev) <= e ? c.pc : -1; });
  const rootPc0 = classOfCents(pin.cents + offset - gridBase).pc;
  const rank = (q, qi) => {
    let violations = 0, held = 0, support = 0;
    lead.forEach((n, i) => { const has = leadPc[i] >= 0 && q.intervals.includes(leadPc[i]); if (has) held++; else if (n.strong) violations++; });
    for (const i of q.intervals) support += w[i];
    support = (total ? support / total : 0) - SUPPORT_PER_TONE * q.intervals.length - q.prior;
    const pcs = q.intervals.map((i) => mod(rootPc0 + i, 12)).sort((a, b) => a - b);
    return { key: [violations, -held, -Math.round(support * 1e9) / 1e9, voiceLeading(pcs, prevPcs), qi], quality: q, violations, held, support, pcs };
  };
  const pickOf = (list, ok, offsetIndex = 0) => {
    let best = null;
    list.forEach((q, qi) => { if (!ok(q)) return; const r = rank(q, qi + offsetIndex); if (!best || before(r.key, best.key)) best = r; });
    return best;
  };
  let best = pickOf(CHORD_QUALITIES, (q) => lacks(q).length <= MAX_MISSING), fallback = null, missing = best ? lacks(best.quality) : [];
  if (!best) {
    // the catalog quality the bar comes nearest to: what it lacks, for the decisions list
    missing = CHORD_QUALITIES.map(lacks).reduce((a, m) => (m.length < a.length ? m : a));
    const dyads = FALLBACK_QUALITIES.slice(0, -1), other = (q) => present(q.intervals[1]);
    best = pickOf([dyads[0]], other) ?? pickOf(dyads.slice(1), other, 1) ?? rank(FALLBACK_QUALITIES[FALLBACK_QUALITIES.length - 1], FALLBACK_QUALITIES.length - 1);
    fallback = best.quality.id;
  }
  const step = modulationStep(pin.cents, offset, gridBase, eachSide, { fold: foldOffsets });
  const modulate = modulation && step.modulate, after = modulate ? step.offset : offset;
  const rootPc = modulate ? classOfCents(pin.cents + after - gridBase).pc : rootPc0;
  const pcs = modulate ? best.quality.intervals.map((i) => mod(rootPc + i, 12)).sort((a, b) => a - b) : best.pcs;
  const shift = foldOffsets ? namingShift(after) : 0, namedPc = mod(rootPc - shift, 12);
  return { root, quality: best.quality, intervals: [...best.quality.intervals], pcs, rootPc, violations: best.violations, held: best.held, support: best.support,
    offGrid: !modulation && step.modulate, modulate, dev: step.dev, offset: after,
    named: { offset: after - 100 * shift, shift, rootPc: namedPc, pcs: best.quality.intervals.map((i) => mod(namedPc + i, 12)).sort((a, b) => a - b) },
    targeted: true, fallback, sounded, missing };
}

/** what harmonize takes for a read progression: { roots, choose } (null when no bar is pinned) */
export const harmonyPins = (read) => (read && read.targeted ? { roots: [...read.roots], choose: chooseChordOnRoot } : null);

const INTERVAL_NAMES = ['root', '♭2', '2nd', '♭3', '3rd', '4th', '♭5', '5th', '♯5', '6th', '♭7', '7th'];
/**
 * The decisions entry for a targeted compose: per bar 'auto' or 'ratio → name', and why, naming each fallback.
 * chords: harmonize's (each with targeted, fallback, sounded, missing, rootFraction, name). → { value, why }
 */
export function describeProgression(read, chords, row) {
  const value = read.roots.map((r, k) => (r == null ? 'auto' : `${row.tones[r]} → ${chords[k].name}${chords[k].fallback ? ' (fallback)' : ''}`));
  const pinned = read.roots.flatMap((r, k) => (r == null ? [] : [k + 1])), auto = read.roots.length - pinned.length;
  const parts = [`bar${pinned.length > 1 ? 's' : ''} ${pinned.join(', ')} targeted: the root asked, the quality the best of those the bar's own tones support over it (all its classes but at most one sounding in the bar, the root among them), ranked as Compose ranks chords (proposed); the settle passes re-derive the quality, never the root`];
  if (auto) parts.push(`${auto} auto bar${auto > 1 ? 's' : ''} from the lead as always${pinned.length ? ' (the first lead mined only for phrases holding an auto bar)' : ''}`);
  for (const k of pinned) {
    const c = chords[k - 1];
    if (c.fallback) parts.push(`bar ${k}: no chord quality has all but one of its tones in the bar over ${c.rootFraction} (the nearest lacks the ${c.missing.map((i) => INTERVAL_NAMES[i]).join(' and ')}), so ${c.name}, the ${c.fallback === 'root_only' ? 'root alone' : `${c.fallback.replace('_', ' ')} dyad`} (fallback, proposed)`);
    if (c.sounded !== 'exact') parts.push(`bar ${k}: ${c.rootFraction} itself does not sound in the bar${c.sounded === 'cluster' ? ', only its ±frame cluster' : ''}; the root is kept, and its onset is not played as one`);
    if (c.offGrid) parts.push(`bar ${k}: ${c.rootFraction} is off the grid and modulation is off, so it is kept, unretuned (offGrid)`);
  }
  parts.push(...read.notes);
  return { value, why: parts.join('; ') };
}
