// frame.js — the 12 pitch classes of a row, measured from a root tone, and which tones are in tune for theirs.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   class    every tone has one: the nearest 100¢ step from the root (the ±50¢ bucket), 0..11. Its deviation is its
//            cents from that step's centre, in [−50, 50): a tone exactly halfway belongs to the step above.
//   inside   a tone within ±`frameCentsEachSide` of its class centre (default ±15¢, a 30¢ window, as the Progression
//            Solver's frame; decided). The rest of a class is its FRINGE: the line picker treats a fringe tone as
//            chunk-lines' "outside" tone (Sprint default 2). chunk-lines' `frameCents = 25` is a total width, ±12.5¢
//            here.
//   root     a tone of the row, given by index or by its exact fraction. The frame is root-centred, so it moves with the
//            root from chord to chord (phase 3). With no root asked, `defaultRoot` picks one. Presence is measured by
//            the tone's ±frame CLUSTER (decided, Avery): the onsets of every tone in its class within ±frameCentsEachSide
//            of it, found for every tone by one sweep round the 1200¢ circle. The candidates are the clusters'
//            representatives (the loudest tone of its own cluster, as chooseChord picks a bar's roots); of those whose
//            cluster is heard at least max(2, 1% of the onsets) times (else half the largest cluster), the one whose
//            frame holds the most onsets (proposed, not ruled) — chunk-lines' `bestFrames` re-centred on tones, found
//            by one sweep round the 100¢ circle, O(tones log tones), not bestFrames' O(tones²). `presence: 'exact'`
//            keeps the phase 3 rule (a tone's own onsets) for comparison.
//
// Nothing here walks the onsets but the representatives' strike tie-break (each tone's strikes, summed once per row):
// the row's per-tone counts (`toneCount`) are what the rest reads.

export const COMPOSER_FRAME_VERSION = 'composer-frame-v1';
export const DEFAULT_FRAME_CENTS_EACH_SIDE = 15;
const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/frame: ${what}`); };
const mod = (v, n) => ((v % n) + n) % n;

/** cents above a root (any real) → its class 0..11 by the nearest 100¢ step and its deviation in [−50, 50) */
export function classOfCents(cents) {
  const rel = mod(cents, 1200);
  let step = Math.floor(rel / 100 + 0.5), d = rel - 100 * step;
  if (d >= 50 - EPS) { step++; d -= 100; }   // halfway, and float dust at it, goes up
  if (Math.abs(d) < EPS) d = 0;
  return { pc: mod(step, 12), dev: d };
}

/** a tone of the row by index or exact fraction → its index */
export function toneIndexOf(row, tone) {
  if (Number.isInteger(tone) && tone >= 0 && tone < row.tones.length) return tone;
  if (typeof tone === 'string') { const t = row.tones.indexOf(tone); if (t >= 0) return t; }
  return fail(`${JSON.stringify(tone)} is not a tone of the row`);
}

function readEachSide(eachSide) {
  if (!(Number.isFinite(eachSide) && eachSide >= 0 && eachSide <= 50)) fail(`frameCentsEachSide must be in [0, 50], not ${eachSide}`);
  return eachSide;
}

/**
 * The frame on a root tone.
 * → { version, root (tone index), rootFraction, rootCents, frameCentsEachSide, width (the window, 2 × each side),
 *     pc: Int8Array by tone (0..11), dev: Float64Array by tone (cents from the class centre), inside: Uint8Array by tone,
 *     nodes (onsets on inside tones), tonesInside }
 */
export function frameAt(row, root, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE) {
  const r = toneIndexOf(row, root), e = readEachSide(frameCentsEachSide), T = row.tones.length, rc = row.toneCents[r];
  const pc = new Int8Array(T), dev = new Float64Array(T), inside = new Uint8Array(T);
  let nodes = 0, tonesInside = 0;
  for (let t = 0; t < T; t++) {
    const { pc: p, dev: d } = classOfCents(row.toneCents[t] - rc);
    pc[t] = p; dev[t] = d;
    if (Math.abs(d) <= e + EPS) { inside[t] = 1; nodes += row.toneCount[t]; tonesInside++; }
  }
  return { version: COMPOSER_FRAME_VERSION, root: r, rootFraction: row.tones[r], rootCents: rc, frameCentsEachSide: e, width: 2 * e, pc, dev, inside, nodes, tonesInside };
}

/**
 * For every tone as a root, the onsets its frame holds, by one sweep: a frame on root r holds the tones whose cents
 * mod 100 lie within ±e of r's on the 100¢ circle. → Float64Array by tone.
 */
export function frameOnsetsByRoot(row, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE) {
  const e = readEachSide(frameCentsEachSide), T = row.tones.length;
  const ph = Float64Array.from(row.toneCents, (c) => mod(c, 100)), order = Array.from({ length: T }, (_, t) => t).sort((a, b) => ph[a] - ph[b] || a - b);
  // the circle unrolled three times (−100, 0, +100), with prefix sums of onsets; each window is centred on the middle lap
  const at = new Float64Array(3 * T), pre = new Float64Array(3 * T + 1);
  for (let i = 0; i < 3 * T; i++) { const t = order[i % T]; at[i] = ph[t] + 100 * (Math.floor(i / T) - 1); pre[i + 1] = pre[i] + row.toneCount[t]; }
  const out = new Float64Array(T);
  if (2 * e >= 100 - EPS) { out.fill(pre[T]); return out; }
  let lo = 0, hi = T;
  for (let i = T; i < 2 * T; i++) {   // a window narrower than the circle sees each tone at most once
    while (at[lo] < at[i] - e - EPS) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < 3 * T && at[hi + 1] <= at[i] + e + EPS) hi++;
    out[order[i - T]] = pre[hi + 1] - pre[lo];
  }
  return out;
}

/** the onsets a default root must be heard (its cluster's, or its own under 'exact'): max(2, 1% of the row's onsets) (proposed, not ruled) */
export const rootPresence = (row) => Math.max(2, Math.ceil(row.n / 100));
/** how a default root's presence is measured: 'cluster' (decided, Avery) or 'exact' (the phase 3 rule, for comparison) */
export const PRESENCE_MODES = Object.freeze(['cluster', 'exact']);

// each tone's strikes over its onsets (the representative's second tie-break), summed once per row; a row without
// onsets (a made-up one: tones and counts only) has none
const strikesByTone = new WeakMap();
function toneStrikes(row) {
  let out = strikesByTone.get(row);
  if (!out) {
    out = new Float64Array(row.tones.length);
    if (row.tone && row.strikes) for (let i = 0; i < row.n; i++) out[row.tone[i]] += row.strikes[i];
    strikesByTone.set(row, out);
  }
  return out;
}
/** is tone a louder than tone b: more onsets, then more strikes, then the lower index (chooseChord's `louder`) */
const louderThan = (row, strikes, a, b) => row.toneCount[a] > row.toneCount[b] || (row.toneCount[a] === row.toneCount[b] && (strikes[a] > strikes[b] || (strikes[a] === strikes[b] && a < b)));
/** is u within ±e of t, octave-equivalent: t's own class, its deviation within ±e (chooseChord's `near`) */
export const inCluster = (row, t, u, e) => { const c = classOfCents(row.toneCents[u] - row.toneCents[t]); return c.pc === 0 && Math.abs(c.dev) <= e + EPS; };

/**
 * Every tone's ±e cluster, by one sweep round the 1200¢ circle (the tones sorted by cents mod 1200, unrolled three
 * times so the window wraps at 0/1200), O(tones log tones): a tone u is in t's cluster when it sits in t's class within
 * ±e of t (`inCluster`; at e = 50 the tone exactly 50¢ above is the next class's, as `classOfCents` has it).
 * → { presence: Float64Array by tone (the onsets of every tone in its cluster, its own among them),
 *     representative: Uint8Array by tone (1 when it is the loudest of its own cluster: onsets, then strikes, then the
 *     lower index — how chooseChord picks a bar's candidate roots), size: Uint32Array by tone (tones in the cluster) }
 */
export function clusterPresence(row, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE) {
  const e = readEachSide(frameCentsEachSide), T = row.tones.length, strikes = toneStrikes(row);
  const ph = Float64Array.from(row.toneCents, (c) => mod(c, 1200)), order = Array.from({ length: T }, (_, t) => t).sort((a, b) => ph[a] - ph[b] || a - b);
  const at = new Float64Array(3 * T), pre = new Float64Array(3 * T + 1);
  for (let i = 0; i < 3 * T; i++) { const t = order[i % T]; at[i] = ph[t] + 1200 * (Math.floor(i / T) - 1); pre[i + 1] = pre[i] + row.toneCount[t]; }
  const presence = new Float64Array(T), representative = new Uint8Array(T), size = new Uint32Array(T);
  // the window [lo, hi] on the unrolled circle, both ends moving forward, with a deque of its loudest tones
  const dq = new Int32Array(3 * T); let qh = 0, qt = 0, lo = 0, hi = -1;
  const push = (j) => { while (qt > qh && louderThan(row, strikes, order[j % T], order[dq[qt - 1] % T])) qt--; dq[qt++] = j; };
  for (let i = T; i < 2 * T; i++) {
    while (at[lo] - at[i] < -e - EPS) lo++;
    if (hi < lo - 1) hi = lo - 1;
    while (hi + 1 < 3 * T && at[hi + 1] - at[i] <= e + EPS && at[hi + 1] - at[i] < 50 - EPS) push(++hi);
    while (dq[qh] < lo) qh++;
    const t = order[i - T];
    presence[t] = pre[hi + 1] - pre[lo]; size[t] = hi - lo + 1;
    representative[t] = order[dq[qh] % T] === t ? 1 : 0;
  }
  return { presence, representative, size };
}

/**
 * The root a frame defaults to (proposed, not ruled, except the measure of presence: decided, Avery).
 *   presence 'cluster' (the default; decided, Avery: "the ±frame cluster neighborhood is the right call, at least for
 *            rhythms at this level of complexity"): the candidates are the cluster REPRESENTATIVES (`clusterPresence`),
 *            each heard as its whole ±e cluster. Rungs: a cluster heard max(2, 1% of the onsets) times, else half the
 *            largest representative's cluster (at least 2), else any representative. Among them the frame's total
 *            onsets wins; then the cluster's presence, then the root's own onsets, then 1/1, then the lowest cents.
 *   presence 'exact' (the phase 3 rule): every tone, heard as its own onsets, with the same rungs on those; the frame's
 *            onsets, then the most heard, then 1/1, then the lowest cents.
 * On a tone-rich row no single tone may be heard often (on 4099:4093:4091:4079 the most heard sounds 24 times of
 * 16,359) while clusters of near-identical ratios are. → tone index
 */
export function defaultRoot(row, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, { presence = 'cluster' } = {}) {
  const { heard, pool, better, rungs } = rootRanking(row, frameCentsEachSide, presence);
  for (const need of rungs) {
    let best = -1;
    for (const t of pool) {
      if (heard[t] < need) continue;
      if (best < 0 || better(t, best)) best = t;
    }
    if (best >= 0) return best;
  }
  return 0;
}
/** what defaultRoot ranks by: the frame's onsets by root, presence, the candidate pool, the comparator and the rungs */
function rootRanking(row, frameCentsEachSide, presence) {
  if (!PRESENCE_MODES.includes(presence)) fail(`presence must be one of ${PRESENCE_MODES.join(', ')}, not ${JSON.stringify(presence)}`);
  const held = frameOnsetsByRoot(row, frameCentsEachSide), T = row.tones.length;
  const cl = presence === 'cluster' ? clusterPresence(row, frameCentsEachSide) : null;
  const heard = cl ? cl.presence : row.toneCount, pool = [];
  for (let t = 0; t < T; t++) if (!cl || cl.representative[t]) pool.push(t);
  let most = 0; for (const t of pool) if (heard[t] > most) most = heard[t];
  const better = (t, best) => {
    const d = held[t] - held[best] || heard[t] - heard[best] || row.toneCount[t] - row.toneCount[best];
    return d > 0 || (d === 0 && row.tones[best] !== '1/1' && (row.tones[t] === '1/1' || row.toneCents[t] < row.toneCents[best]));
  };
  return { held, heard, pool, better, rungs: [rootPresence(row), Math.max(2, Math.ceil(most / 2)), 0] };
}
/**
 * defaultRoot's ranking, spelled out (for the compose trace): the first rung any candidate passes, and its candidates
 * best first, at most `count` — the first is defaultRoot's pick. → { need, rung (0..2), pool (candidates before the
 * rung), eligible (after it), ranked: [{ tone, frameOnsets, presence, onsets }] }
 */
export function rankRoots(row, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE, { presence = 'cluster', count = 8 } = {}) {
  const { held, heard, pool, better, rungs } = rootRanking(row, frameCentsEachSide, presence);
  for (let rung = 0; rung < rungs.length; rung++) {
    const need = rungs[rung], eligible = pool.filter((t) => heard[t] >= need);
    if (!eligible.length) continue;
    eligible.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : a - b));
    return { need, rung, pool: pool.length, eligible: eligible.length, ranked: eligible.slice(0, count).map((t) => ({ tone: t, frameOnsets: held[t], presence: heard[t], onsets: row.toneCount[t] })) };
  }
  return { need: 0, rung: rungs.length, pool: pool.length, eligible: 0, ranked: [] };
}

/** the tones of a tone's ±e cluster (`inCluster`), itself among them, by index → [tone] (O(tones)) */
export function clusterOf(row, tone, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE) {
  const t = toneIndexOf(row, tone), e = readEachSide(frameCentsEachSide), out = [];
  for (let u = 0; u < row.tones.length; u++) if (u === t || inCluster(row, t, u, e)) out.push(u);
  return out;
}

/** the frame on `root`, or on the default root when none is given */
export const frameOf = (row, root = null, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE) => frameAt(row, root ?? defaultRoot(row, frameCentsEachSide), frameCentsEachSide);

/**
 * The 12 classes of a frame: each class's unique ratios with their onset counts, split into core (inside) and fringe,
 * the most heard first (then the nearest the centre, then by cents). O(tones), plus each class's sort.
 * → [{ pc, centreCents (above 1/1), coreOnsets, fringeOnsets, core: [tone], fringe: [tone] }],
 *   tone = { tone, fraction, cents, dev, onsets }
 */
export function classReport(row, frame) {
  const classes = Array.from({ length: 12 }, (_, pc) => ({ pc, centreCents: mod(frame.rootCents + 100 * pc, 1200), coreOnsets: 0, fringeOnsets: 0, core: [], fringe: [] }));
  for (let t = 0; t < row.tones.length; t++) {
    const c = classes[frame.pc[t]], entry = { tone: t, fraction: row.tones[t], cents: row.toneCents[t], dev: frame.dev[t], onsets: row.toneCount[t] };
    if (frame.inside[t]) { c.core.push(entry); c.coreOnsets += entry.onsets; } else { c.fringe.push(entry); c.fringeOnsets += entry.onsets; }
  }
  const order = (a, b) => b.onsets - a.onsets || Math.abs(a.dev) - Math.abs(b.dev) || a.cents - b.cents;
  for (const c of classes) { c.core.sort(order); c.fringe.sort(order); }
  return classes;
}
