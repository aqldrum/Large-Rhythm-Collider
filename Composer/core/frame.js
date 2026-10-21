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
//            root from chord to chord (phase 3). With no root asked, `defaultRoot` picks one (proposed, not ruled): the
//            tone whose frame holds the most onsets — chunk-lines' `bestFrames` re-centred on tones — found by one sweep
//            round the 100¢ circle, O(tones log tones), not bestFrames' O(tones²).
//
// Nothing here walks the onsets: the row's per-tone counts (`toneCount`) are all it reads.

export const COMPOSER_FRAME_VERSION = 'composer-frame-v1';
export const DEFAULT_FRAME_CENTS_EACH_SIDE = 15;
const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/frame: ${what}`); };
const mod = (v, n) => ((v % n) + n) % n;

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
    const rel = mod(row.toneCents[t] - rc, 1200);
    let step = Math.floor(rel / 100 + 0.5), d = rel - 100 * step;
    if (d >= 50 - EPS) { step++; d -= 100; }   // halfway, and float dust at it, goes up
    if (Math.abs(d) < EPS) d = 0;
    pc[t] = mod(step, 12); dev[t] = d;
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

/**
 * The root a frame defaults to (proposed, not ruled): the most onsets inside its frame; then the most heard root; then
 * 1/1; then the lowest cents. → tone index
 */
export function defaultRoot(row, frameCentsEachSide = DEFAULT_FRAME_CENTS_EACH_SIDE) {
  const held = frameOnsetsByRoot(row, frameCentsEachSide);
  let best = 0;
  for (let t = 1; t < row.tones.length; t++) {
    const d = held[t] - held[best] || row.toneCount[t] - row.toneCount[best];
    if (d > 0 || (d === 0 && row.tones[best] !== '1/1' && (row.tones[t] === '1/1' || row.toneCents[t] < row.toneCents[best]))) best = t;
  }
  return best;
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
