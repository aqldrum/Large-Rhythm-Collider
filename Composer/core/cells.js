// cells.js — a row cut in N bars × S slots from a phase, and the onsets each slot can take, kept per tone.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   anchors     where slot k sits on the cycle, as an exact fraction of it.
//                 even          phase + k/P (chunk-super-row.js `slotCandidates`)
//                 partitioned   phase + the first k pulses, the cycle's grid cut in P pulses of G or G ± 1 ticks with
//                               the remainder spread Euclid-style, as Partitions cuts it (Playback/Partitions/PARTITIONS.md;
//                               PartitionsBlocks.calculatePartitionSizes + PartitionsDistribution.generateEuclideanPattern,
//                               ported here line for line, so a Composer slot and a Partitions block agree). Every
//                               anchor is then a tick of the rhythm's own grid. A grid with fewer ticks than P is cut on
//                               a finer grid, `subdivide` ticks to each of its own.
//   window      a node is a slot's candidate when it is within `swing` of the way from the slot's anchor to the
//               neighbouring anchor on its side: with even anchors that is swing / P of the cycle either side, the
//               window of chunk-super-row; with partitioned anchors each side scales with its own pulse. The swing is
//               given (a double, read to 1/10000 as chunk-super-row reads it), or sized in ONSETS as chunk-lines'
//               `buildLattice` sizes it: about `moments` onsets of the row around the anchor at the row's mean density,
//               swing = moments·P / (2n), held at most 0.5 — kept as that exact fraction, not rounded to 1/10000 as
//               chunk-lines rounds it (the probe found the rounded window drifting past ~0.6M onsets). At 0.5 the windows meet halfway, so every node is some slot's and a node exactly midway
//               belongs to the slot it follows. Membership at an edge is decided in whole numbers (BigInt), never in
//               doubles.
//   candidates  per tone: how many of the slot's nodes, their strikes, their registers, and the nearest node with its
//               signed offset from the anchor in cycles. A slot's tones are ordered by their nearest node (ties: the
//               one before the anchor, then the earlier on the row), as chunk-super-row orders them.
//
// chunk-lines' lattice (phase 2) reads exactly this per slot: { anchor, tones: [{ tone, count, strikes, node, offset }] }
// and the slot's strikes, from which it takes accent and weak.

import { isRow } from './row.js';

export const COMPOSER_CELLS_VERSION = 'composer-cells-v1';
export const ANCHOR_MODES = Object.freeze(['even', 'partitioned']);
/** onsets a window holds around its anchor, at the row's mean density (chunk-lines' default) */
export const DEFAULT_MOMENTS = 12;
export const SWING_DEN = 10000;

const fail = (what) => { throw new Error(`composer/cells: ${what}`); };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const gcdBig = (a, b) => { if (a < 0n) a = -a; while (b) [a, b] = [b, a % b]; return a; };
const absBig = (v) => (v < 0n ? -v : v);
const modBig = (v, n) => { const r = v % n; return r < 0n ? r + n : r; };
/** p / q of two BigInts as a double, rounded once (whole part and remainder apart, so large numerators keep their digits) */
const ratio = (p, q) => { const neg = p < 0n, a = neg ? -p : p, w = a / q, r = Number(a % q) / Number(q), v = Number(w) + r; return neg ? -v : v; };
const exactOut = (v) => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString());

/**
 * Bjorklund's pattern of `pulses` onsets in `steps` (1 onset, 0 rest), as Partitions draws it — a port of
 * PartitionsDistribution.generateEuclideanPattern, kept identical so the Composer's pulses are Partitions' blocks.
 */
export function euclidPattern(steps, pulses) {
  const stepCount = Math.max(1, Math.floor(Number(steps) || 1));
  const pulseCount = Math.max(0, Math.floor(Number(pulses) || 0));
  if (pulseCount === 0) return new Array(stepCount).fill(0);
  if (pulseCount >= stepCount) return new Array(stepCount).fill(1);
  const pattern = [], counts = [], remainders = [];
  let divisor = stepCount - pulseCount, level = 0;
  remainders.push(pulseCount);
  for (;;) {
    counts.push(Math.floor(divisor / remainders[level]));
    remainders.push(divisor % remainders[level]);
    divisor = remainders[level];
    level += 1;
    if (remainders[level] <= 1) break;
  }
  counts.push(divisor);
  const build = (lvl) => {
    if (lvl === -1) { pattern.push(0); return; }
    if (lvl === -2) { pattern.push(1); return; }
    for (let i = 0; i < counts[lvl]; i += 1) build(lvl - 1);
    if (remainders[lvl] !== 0) build(lvl - 2);
  };
  build(level);
  return pattern.slice(0, stepCount);
}

/**
 * T ticks cut in P pulses (PARTITIONS.md "ALGORITHM", PartitionsBlocks.calculatePartitionSizes): G is the size whose
 * P-fold is nearest T (Math.round(T / P), a tie rounding up), R = |P·G − T| pulses are G − 1 (when P·G > T) or G + 1,
 * spread by `euclidPattern(P, R)`. → { T, P, G, R, delta, sizes }
 */
export function partitionSizes(T, P) {
  if (!(Number.isSafeInteger(T) && T >= 1)) fail(`bad span ${T}`);
  if (!(Number.isInteger(P) && P >= 1 && P <= T)) fail(`cannot cut ${T} ticks in ${P} pulses`);
  if (P === 1) return { T, P, G: T, R: 0, delta: 0, sizes: [T] };
  const G = Math.round(T / P), raw = G * P, R = Math.abs(raw - T), delta = R === 0 ? 0 : raw > T ? -1 : 1;
  if (R === 0) return { T, P, G, R, delta, sizes: new Array(P).fill(G) };
  const sizes = euclidPattern(P, R).map((flag) => G + (flag ? delta : 0));
  return { T, P, G, R, delta, sizes };
}

/**
 * The swing that holds about `moments` onsets in a window at the row's mean density, moments·P / (2n) at most 1/2, as
 * an exact fraction [num, den] (a moments that is not whole is read to 1e-6).
 */
export function swingForMoments(row, P, moments = DEFAULT_MOMENTS) {
  if (!(moments > 0 && Number.isFinite(moments))) fail(`bad moments ${moments}`);
  const scale = Number.isInteger(moments) ? 1 : 1e6;
  let num = Math.round(moments * scale) * P, den = 2 * row.n * scale;
  if (2 * num >= den) return [1, 2];
  const g = gcd(num, den);
  return [num / g, den / g];
}

/** the phase at a tick of the row: [tick, grid], reduced */
export function phaseAtTick(row, tick) {
  if (!(Number.isSafeInteger(tick) && tick >= 0 && tick < row.grid)) fail(`bad tick ${tick}`);
  const g = gcd(tick, row.grid) || row.grid;
  return [tick / g, row.grid / g];
}

function readPhase(phase) {
  if (!Array.isArray(phase) || phase.length !== 2) fail(`bad phase ${JSON.stringify(phase)}`);
  const [pn, pd] = phase;
  if (!(Number.isSafeInteger(pn) && Number.isSafeInteger(pd) && pd > 0 && pn >= 0 && pn < pd)) fail(`bad phase ${JSON.stringify(phase)}`);
  return [pn, pd];
}

/**
 * The anchors as BigInt numerators over one denominator AD, each in [0, AD):
 * → { AD, num: BigInt[P], pulses } (pulses: null for even anchors).
 */
function anchorsOf(row, P, mode, [pn, pd], { sizes: given, subdivide } = {}) {
  if (mode === 'even') {
    const AD = BigInt(pd) * BigInt(P), base = BigInt(pn) * BigInt(P);
    return { AD, num: Array.from({ length: P }, (_, k) => modBig(base + BigInt(k) * BigInt(pd), AD)), pulses: null };
  }
  if (mode !== 'partitioned') fail(`anchors must be one of ${ANCHOR_MODES.join(', ')}, not ${JSON.stringify(mode)}`);
  const m = subdivide ?? Math.max(1, Math.ceil(P / row.grid));
  if (!(Number.isSafeInteger(m) && m >= 1 && Number.isSafeInteger(row.grid * m))) fail(`bad subdivide ${subdivide}`);
  const T = row.grid * m;
  let pulses;
  if (given) {
    if (!Array.isArray(given) || given.length !== P || !given.every((s) => Number.isSafeInteger(s) && s >= 1)) fail(`sizes must be ${P} whole numbers ≥ 1`);
    const sum = given.reduce((a, b) => a + b, 0);
    if (sum !== T) fail(`sizes sum to ${sum}, not the ${T} ticks of the cycle`);
    pulses = { ...partitionSizes(T, P), sizes: given.slice(), given: true };
  } else pulses = { ...partitionSizes(T, P), given: false };
  pulses.subdivide = m;
  const AD = BigInt(pd) * BigInt(T), base = BigInt(pn) * BigInt(T), num = [];
  let cum = 0n;
  for (let k = 0; k < P; k++) { num.push(modBig(base + cum * BigInt(pd), AD)); cum += BigInt(pulses.sizes[k]); }
  return { AD, num, pulses };
}

/**
 * The row's cells: N bars × S slots from a phase.
 *   opts = { bars, slotsPerBar, anchors: 'even' | 'partitioned', phase: [num, den] of the cycle (default [0, 1]),
 *            moments (default 12) or swing (a share of a mean slot, overriding moments),
 *            sizes (partitioned: P pulse sizes in ticks, e.g. a dragged order), subdivide (partitioned: ticks per grid tick) }
 * → { version, mode, bars, slotsPerBar, P, phase, moments, swing, swingExact: [num, den], window, pulses, slotOfNode,
 *     slots: [{ index, bar, beat, anchor, at, tick, length, reach, nodes, strikes, tones }] }
 *   anchor   the anchor as a double in [0, 1) of the cycle; `at` the same as an exact [num, den] (a string where past 2^53)
 *   tick     the anchor in ticks of the row (a double; whole for partitioned anchors unless subdivided)
 *   length   the cycle share to the next anchor; reach [before, after] how far the window runs either side (cycles)
 *   tones    [{ tone, count, strikes, octaves (sorted registers), node, offset (signed, cycles) }]
 *   slotOfNode  Int32Array by node: the slot whose window holds it, or −1
 */
export function buildCells(row, opts = {}) {
  if (!isRow(row)) fail('a built row is needed (buildRow refused this one?)');
  const { bars, slotsPerBar, anchors: mode = 'even', phase = [0, 1], moments = DEFAULT_MOMENTS, swing: swingIn } = opts;
  if (!(Number.isInteger(bars) && bars >= 1 && Number.isInteger(slotsPerBar) && slotsPerBar >= 1)) fail(`bad meter ${bars} × ${slotsPerBar}`);
  const P = bars * slotsPerBar, ph = readPhase(phase);
  let sn, sd;
  if (swingIn != null) {
    const asked = Math.min(0.5, Math.max(0, Number(swingIn)));
    if (!Number.isFinite(asked)) fail(`bad swing ${swingIn}`);
    sn = Math.round(asked * SWING_DEN); sd = SWING_DEN;
  } else [sn, sd] = swingForMoments(row, P, moments);
  const swing = sn / sd;
  const { AD, num, pulses } = anchorsOf(row, P, mode, ph, opts);

  const grid = row.grid, G = BigInt(grid), M = G * AD;   // a node's offset from an anchor is s / M of the cycle, s in (−M/2, M/2]
  const SN = BigInt(sn), SD = BigInt(sd), half = 2 * sn === sd;
  const w = swing / P;
  const T = row.tones.length, stamp = new Int32Array(T).fill(-1), at = new Int32Array(T);
  const slotOfNode = new Int32Array(row.n).fill(-1);
  const slots = [];

  for (let k = 0; k < P; k++) {
    const a = num[k], prev = num[(k + P - 1) % P], next = num[(k + 1) % P];
    const dPrev = P === 1 ? AD : modBig(a - prev, AD), dNext = P === 1 ? AD : modBig(next - a, AD);
    // each side reaches `swing` of the way to that neighbour (with even anchors, swing / P of the cycle); at swing 0.5
    // the two windows meet halfway and the midpoint goes to the earlier slot
    const limPrev = SN * dPrev * G, limNext = SN * dNext * G;
    const inside = (s) => {
      if (s === 0n) return true;
      if (s < 0n) { const d = -s * SD; return half ? d < limPrev : d <= limPrev; }
      return s * SD <= limNext;
    };
    const offsetOf = (i) => { const r = modBig(BigInt(row.tick[i]) * AD - a * G, M); return 2n * r > M ? r - M : r; };
    const nearer = (si, i, sj, j) => { const ai = absBig(si), aj = absBig(sj); if (ai !== aj) return ai < aj; if ((si < 0n) !== (sj < 0n)) return si < 0n; return i < j; };

    const anchorD = ratio(a, AD), anchorTick = ratio(a * G, AD);
    const reachPrev = swing * ratio(dPrev, AD), reachNext = swing * ratio(dNext, AD);
    const found = [], exactNear = []; let nodes = 0, strikes = 0;
    const visit = (i) => {
      const s = offsetOf(i);
      if (!inside(s)) return;
      nodes++; strikes += row.strikes[i]; slotOfNode[i] = k;
      const t = row.tone[i];
      if (stamp[t] !== k) { stamp[t] = k; at[t] = found.length; found.push({ tone: t, count: 0, strikes: 0, octaves: [], node: i, offset: 0 }); exactNear.push(s); }
      const e = found[at[t]];
      e.count++; e.strikes += row.strikes[i];
      if (!e.octaves.includes(row.octave[i])) e.octaves.push(row.octave[i]);
      if (e.node !== i && nearer(s, i, exactNear[at[t]], e.node)) { e.node = i; exactNear[at[t]] = s; }
    };
    // scan the ticks the window can touch, padded by a tick either side, then let `inside` decide
    const lo = Math.floor(anchorTick - reachPrev * grid) - 1, hi = Math.ceil(anchorTick + reachNext * grid) + 1;
    const scan = (from, to) => { for (let i = lowerTick(row, from); i < row.n && row.tick[i] <= to; i++) visit(i); };
    if (hi - lo >= grid) scan(0, grid);
    else if (lo < 0) { scan(lo + grid, grid); scan(0, hi); } else if (hi >= grid) { scan(lo, grid); scan(0, hi - grid); } else scan(lo, hi);

    const order = found.map((e, j) => j).sort((p, q) => (nearer(exactNear[p], found[p].node, exactNear[q], found[q].node) ? -1 : 1));
    const tones = order.map((j) => { const e = found[j]; e.offset = ratio(exactNear[j], M); e.octaves.sort((x, y) => x - y); return e; });
    const g = gcdBig(a, AD) || AD;
    slots.push({
      index: k, bar: Math.floor(k / slotsPerBar), beat: k % slotsPerBar,
      anchor: anchorD, at: [exactOut(a / g), exactOut(AD / g)], tick: anchorTick,
      length: ratio(dNext, AD), reach: [reachPrev, reachNext],
      nodes, strikes, tones,
    });
  }
  return {
    version: COMPOSER_CELLS_VERSION, mode, bars, slotsPerBar, P, phase: ph,
    moments: swingIn != null ? null : moments, swing, swingExact: [sn, sd], window: w, pulses, slotOfNode, slots,
  };
}

function lowerTick(row, tick) {
  let lo = 0, hi = row.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (row.tick[mid] < tick) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A short summary for logs and the lab. */
export function describeCells(cells) {
  const covered = cells.slots.reduce((n, s) => n + s.nodes, 0);
  return {
    mode: cells.mode, meter: `${cells.bars} × ${cells.slotsPerBar}`, swing: cells.swing, covered,
    empty: cells.slots.filter((s) => !s.nodes).length,
    pulses: cells.pulses ? { G: cells.pulses.G, R: cells.pulses.R, delta: cells.pulses.delta, subdivide: cells.pulses.subdivide } : null,
  };
}
