// row.js — one rhythm's tone row: its composite onsets in tick order, each owning the tone of the gap after it.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
// Ported from Overworld's chunk-super-row.js (the normalized row of ONE source, `rhythmCycle` + `buildNormalizedRow`)
// and the kernel it calls, settle-location.js `buildRhythmTimingKernel`. One rhythm means one denominator: every
// position is tick / grid, so the row is ordered and compared by whole ticks and nothing needs the super-row's
// k-way merge or its 2^25 grid cap. What changed on the way in (see Composer/DESIGN_NOTES.md, "Phase 1"):
//
//   layers     [a, b, c, d] in the order given, as the LRC names them: layer A is layers[0] (Overworld sorts them
//              ascending first). A 0 or a missing entry is an absent layer, as in LRCModule.generateCompositeRhythm.
//   tick       Float64Array, exact while the grid is a safe integer (2^53), not Uint32 under a 2^25 cap.
//   tone       the EXACT fraction longest gap / gap, folded into [1/1, 2/1) and reduced. The kernel (and the live
//              site, LRCModule.decimalToFraction) spells a ratio as its best fraction with a denominator ≤ 1000, which
//              is exact for small rhythms but rounds, and can merge two different tones, once a gap's reduced
//              denominator passes 1000. The Composer keys tones by the exact fraction and keeps the site's spelling
//              beside it as `toneLabels`, so the lab and the main page name a tone the same way.
//   octave     the tone's own register, as in chunk-super-row: longest / gap = fraction × 2^octave.
//   owners     bit b set when layer b (A = bit 0) strikes there; `strikes` is how many layers that is.
//   gate       by onset count (DESIGN_NOTES "Sprint defaults" 5, set from the cost probe): a row over it is not built.
//              The count comes from the layers alone (inclusion–exclusion over gcds), so a row too dense to build costs
//              nothing to refuse. No spread over a row-sized array anywhere (`Math.max(...gaps)` overflows the stack
//              past ~124k arguments): loops only.

export const COMPOSER_ROW_VERSION = 'composer-row-v1';
/** the hard onset cap (2^20), from the cost probe (Composer/probe/FINDINGS.md): past it build time and memory, not
 *  mining, become the cost. Proposed, not ruled. Where Compose may run inside it is phase 4's business. */
export const ONSET_GATE = 1048576;
/** a row with fewer distinct tones than this has nothing to compose (the probe's 1-tone row "composed" 83 lines on one
 *  pitch). The row still builds; `toneGate` is what Compose and the line miner ask. Proposed, not ruled. */
export const MIN_TONES = 3;
export const LAYER_NAMES = Object.freeze(['A', 'B', 'C', 'D']);
export const MAX_LAYERS = 4;

const fail = (what) => { throw new Error(`composer/row: ${what}`); };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const gcdBig = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; };

/** [a, b, c, d] → { values (as given, 0 for absent), active: [layer index] } */
function readLayers(layers) {
  if (!Array.isArray(layers)) fail(`layers must be an array, not ${JSON.stringify(layers)}`);
  if (layers.length > MAX_LAYERS) fail(`at most ${MAX_LAYERS} layers, not ${layers.length}`);
  const values = [], active = [];
  layers.forEach((v, i) => {
    if (v == null || v === 0) { values.push(0); return; }
    if (!(Number.isSafeInteger(v) && v > 0)) fail(`layer ${LAYER_NAMES[i]} is ${JSON.stringify(v)}, not a positive whole number`);
    values.push(v); active.push(i);
  });
  if (!active.length) fail('no layers');
  return { values, active };
}

/** the grid (lcm of the active layers) as a BigInt: it is checked against 2^53 before it is used as a Number */
function gridOf(values, active) {
  let g = 1n;
  for (const i of active) { const v = BigInt(values[i]); g = (g / gcdBig(g, v)) * v; }
  return g;
}

/**
 * How many composite onsets the rhythm has, from its layers alone: layer a strikes at the a multiples of grid / a, and
 * the layers of a set strike together at gcd(set) points, so the union is Σ over nonempty sets of (−1)^(|set|+1) gcd(set).
 */
export function onsetCount(layers) {
  const { values, active } = readLayers(layers);
  let n = 0;
  for (let mask = 1; mask < 1 << active.length; mask++) {
    let g = 0, size = 0;
    for (let j = 0; j < active.length; j++) if (mask & (1 << j)) { g = gcd(g, values[active[j]]); size++; }
    n += size & 1 ? g : -g;
  }
  return n;
}

/** n/d in cents in [0, 1200), rounded exactly as chunk-tunes' toneCents rounds it (its fold costs the low bits; keeping
 *  them would let two lines the picker prices alike by a hair break the other way) */
const centsOf = (n, d) => { const c = 1200 * Math.log2(n / d); return ((c % 1200) + 1200) % 1200; };

/** cents of a fraction string n/d, folded into [0, 1200) */
export function fractionCents(fraction) {
  const [n, d] = String(fraction).split('/').map(Number);
  if (!(n > 0 && d > 0)) fail(`not a ratio: ${fraction}`);
  return centsOf(n, d);
}

/**
 * The live site's spelling of a ratio (LRCModule.decimalToFraction and settle-location's kernel, line for line): the
 * first fraction with a denominator ≤ 1000 within 1e-6 of it, else the nearest. It can read "2/1" for a ratio just
 * under the octave. With the exact fraction in hand and its denominator ≤ 1000 that is the fraction itself: two
 * fractions with denominators ≤ 1000 differ by at least 1/999000 > 1e-6, so the loop can stop nowhere sooner.
 */
export function siteFraction(ratio, exact = null) {
  if (exact) { const [n, d] = exact; if (d <= 1000) { const g = gcd(n, d); return `${n / g}/${d / g}`; } }
  const value = Number(ratio);
  let numerator = 1, denominator = 1, minError = Math.abs(value - 1);
  for (let d = 1; d <= 1000; d++) {
    const n = Math.round(value * d), error = Math.abs(value - n / d);
    if (error < minError) { minError = error; numerator = n; denominator = d; if (error < 1e-6) break; }
  }
  const g = gcd(numerator, denominator);
  return `${numerator / g}/${denominator / g}`;
}

/** longest / gap folded into [1, 2) and reduced: → [num, den, octave] with longest / gap = num/den × 2^octave */
function foldedTone(longest, gap) {
  const g = gcd(longest, gap);
  let num = longest / g, den = gap / g, octave = 0;
  while (num >= 2 * den) { den *= 2; octave++; }
  const h = gcd(num, den);
  return [num / h, den / h, octave];
}

/**
 * The rhythm's row, or why it was not built:
 *   { tooDense: true, onsets, gate }   more onsets than the gate
 *   { tooLarge: true, grid, limit }    a grid past 2^53, where ticks stop being exact (only reachable with a raised gate)
 * Otherwise →
 *   { version, layers (as given, 0 absent), active, grid, n, longest,
 *     tick, x, gap (by node), tone, octave, owners, strikes (by node),
 *     tones (exact fractions, by cents then spelling), toneCents, toneLabels (the site's spelling), toneCount, toneFirst (by tone) }
 */
export function buildRow(layers, { gate = ONSET_GATE } = {}) {
  const { values, active } = readLayers(layers);
  if (!(gate === Infinity || (Number.isSafeInteger(gate) && gate >= 1))) fail(`bad gate ${gate}`);
  const onsets = onsetCount(values);
  if (onsets > gate) return { tooDense: true, onsets, gate };
  const gridBig = gridOf(values, active);
  if (gridBig > BigInt(Number.MAX_SAFE_INTEGER)) return { tooLarge: true, grid: gridBig.toString(), limit: Number.MAX_SAFE_INTEGER };
  const grid = Number(gridBig), n = onsets;

  // merge the layers' strikes (each already in tick order) into the composite
  const tick = new Float64Array(n), owners = new Uint8Array(n);
  const step = active.map((i) => grid / values[i]), at = active.map(() => 0);
  for (let k = 0; k < n; k++) {
    let t = Infinity;
    for (let j = 0; j < active.length; j++) if (at[j] < values[active[j]]) { const v = at[j] * step[j]; if (v < t) t = v; }
    let mask = 0;
    for (let j = 0; j < active.length; j++) if (at[j] < values[active[j]] && at[j] * step[j] === t) { mask |= 1 << active[j]; at[j]++; }
    tick[k] = t; owners[k] = mask;
  }
  for (let j = 0; j < active.length; j++) if (at[j] !== values[active[j]]) fail('onset count and composite disagree');

  const gap = new Float64Array(n), strikes = new Uint8Array(n), x = new Float64Array(n);
  let longest = 0;
  for (let i = 0; i < n; i++) {
    gap[i] = (i + 1 < n ? tick[i + 1] : grid + tick[0]) - tick[i];
    if (gap[i] > longest) longest = gap[i];
    strikes[i] = popcount(owners[i]); x[i] = tick[i] / grid;
  }

  // tones: one per distinct gap length (a gap's tone depends on nothing else), then sorted by cents
  const byGap = new Map(), names = new Map();
  for (let i = 0; i < n; i++) {
    if (byGap.has(gap[i])) continue;
    const [num, den, octave] = foldedTone(longest, gap[i]), f = `${num}/${den}`;
    byGap.set(gap[i], { f, octave });
    if (!names.has(f)) names.set(f, { f, num, den, c: centsOf(num, den) });
  }
  const tuned = [...names.values()].sort((a, b) => a.c - b.c || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0));
  const toneIndex = new Map(tuned.map((t, i) => [t.f, i]));
  const T = tuned.length, tone = new Uint32Array(n), octave = new Uint8Array(n);
  const toneCount = new Uint32Array(T), toneFirst = new Int32Array(T).fill(-1);
  for (let i = 0; i < n; i++) {
    const g = byGap.get(gap[i]), t = toneIndex.get(g.f);
    tone[i] = t; octave[i] = g.octave; toneCount[t]++; if (toneFirst[t] < 0) toneFirst[t] = i;
  }
  const row = {
    version: COMPOSER_ROW_VERSION, layers: values, active, grid, n, longest,
    tick, x, gap, tone, octave, owners, strikes,
    tones: tuned.map((t) => t.f), toneCents: Float64Array.from(tuned, (t) => t.c), toneCount, toneFirst,
  };
  // the site's spellings cost up to a thousand divisions a tone past a denominator of 1000, so they are made when first read
  let labels = null;
  Object.defineProperty(row, 'toneLabels', { enumerable: true, get: () => (labels ??= tuned.map((t) => siteFraction(t.num / t.den, [t.num, t.den]))) });
  return row;
}

/** null when the row has tones enough to compose, else { tooFewTones: true, tones, min } */
export function toneGate(row, min = MIN_TONES) {
  return row.tones.length >= min ? null : { tooFewTones: true, tones: row.tones.length, min };
}

/** is this a built row, not a refusal? */
export const isRow = (r) => !!r && r.version === COMPOSER_ROW_VERSION;

/** the layers striking at node i: [{ name, value }] */
export const struckAt = (row, i) => row.active.filter((b) => row.owners[i] & (1 << b)).map((b) => ({ name: LAYER_NAMES[b], value: row.layers[b] }));

/** Node i, spelled out. */
export function nodeAt(row, i) {
  const t = row.tone[i];
  return {
    index: i, tick: row.tick[i], x: row.x[i], gap: row.gap[i],
    tone: t, fraction: row.tones[t], label: row.toneLabels[t], cents: row.toneCents[t], octave: row.octave[i],
    struck: struckAt(row, i),
  };
}

/** the first node at or after `tick` (row.n when none) */
export function lowerBoundTick(row, tick) {
  let lo = 0, hi = row.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (row.tick[mid] < tick) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A short summary for logs and the lab: sizes, not arrays. */
export function describeRow(row) {
  if (!isRow(row)) return row;
  return { layers: row.layers, grid: row.grid, onsets: row.n, tones: row.tones.length, longest: row.longest };
}
