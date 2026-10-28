// drums.js — the Drums (Perc) part: a pattern a bar, keyed to the composition's own time grid, every stroke an onset
// the row already plays.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. `arrangeDrums(spec, options)` reads only the
// spec (its input layers, knobs, timeline, stats.grid and parts), never the row, so the lab re-arranges the drums of a
// spec on the main thread without composing again (a few hundred strokes, well under a millisecond); compose() calls the
// same function at its end. Every choice here is proposed, not ruled, unless marked decided.
//
//   onsets     the row's onsets are its layers' pulses: layer v strikes every grid / v ticks (the grid is the layers'
//              lcm), so the onset nearest any place in the cycle is the nearest pulse of one of at most four layers,
//              found without the row (`drumGrid`). A stroke's strikes are the layers striking its tick, as row.js counts.
//   beats      the bar's S slots cut in 4 beats as Partitions cuts a block (cells.js `partitionSizes`, ported from
//              PartitionsBlocks.calculatePartitionSizes): any S, odd or prime too (S = 7: 1, 2, 2, 2 slots). Under 4
//              slots a bar is cut on half or quarter slots (S·m sub-slots, m = ceil(4 / S), as cells.js subdivides a
//              grid smaller than P), and a sub-slot beat lands on a real onset inside its slot (`beatsOf`).
//   landing    a stroke aims at a place in the bar (slot units: a whole slot is its anchor, a half slot the midpoint to
//              the next anchor) and lands on the row's onset nearest it inside that place's window: half-way to the
//              neighbouring places of the bar's 1/m-slot grid (for whole slots, the swing-0.5 window of cells.js, a
//              midpoint going to the earlier slot). With no onset there it looks once more, a whole place either side
//              (`snap: 'wide'`); with none there either, the stroke is left out (`stats.silent`). Anchors are grid
//              ticks, not always onsets: the downbeat (the phase) is one, the other anchors are landed on their
//              nearest onset. A stroke taken from a part's note, or from the partition layer, is that onset itself.
//   modes      backbeat   the default (Avery, the sprint brief): kick on beats 1 and 3, snare on 2 and 4, a hat on
//                         every slot (its beat slots a little louder) — the steady beat the other parts sit on
//              with       the backbeat, and a perc stroke on every slot where the lead or the comping strikes, on that
//                         note's own onset (the lead's first; the comp in chords: its stroke's); accented where both
//                         strike, or on a strong slot
//              against    the backbeat, and a perc stroke on the slots both leave empty, on the slot's nearest onset:
//                         at most ⌊S / 2⌋ a bar (at least 1), the off-beat slots first, then by the seed
//              partition  the backbeat, and a perc line from the layer that strikes the downbeat (`partitionLine`)
//              a pattern  one of drum-patterns.js, landed through the beats (a pattern's step is a fraction of the bar)
//   fills      the last bar of each phrase of 4 bars or more (harmony.js `phrasesOf`) plays the fill over its second
//              half (from beat 3), and a crash opens the bar after it — the loop's first bar when the fill is the last.
//   seed       only `against` draws (a seeded generator of its own per bar, `${seed}/drums/${bar}`: STEP 4d), so the
//              drums never move a draw Compose makes for the other parts, and an edit to one bar never re-draws another.
//
// A window (MIDI targets, phase A3: a spec whose knobs carry `cut`, the cycle cropped to the clip's bars): the drums'
// cycle is the LOOP, W of the row's (W = knobs.cycleSeconds / knobs.rowCycleSeconds). Places run over [0, W) from the
// downbeat, the landing searches the row's onsets around them as always, and a stroke's time is its LOOP time: an onset
// just before the downbeat sounds at the loop's end, one just past the window's end at the loop's start. The partition
// layer counts its pulses inside the window, and the prime partition spreads its lights over the window (proposed).
// Without `cut` (W = 1) every expression here is the one it was.
//
// The partition layer, single level. Partitions' grid mode cuts the whole cycle from tick 0 in P blocks (P chosen per
// layer, up to the grid) and its secondary count lights an Euclidean subset of them (getSecondaryAllowedSet). Here the
// cycle starts at the composition's downbeat, the phase, which is one of the root's onsets, not tick 0: the layer is
// one that strikes it (the layer(s) whose pulse is the phase onset, Avery's idea; of several, the one with pulses a bar
// nearest S, then the slowest), its v pulses are the blocks (grid mode at P = v, from the phase: each block starts on
// one of that layer's onsets, and the first on the downbeat), and `hits` of them sound: Partitions' secondary pattern
// E(hits, v), turned so its first stroke is the downbeat. hits = min(v, N·S) by default (a pulse a slot on average), or
// N·hitsPerBar.
//
// Step 4c (DESIGN_NOTES "Step 4c: drum grid and the prime partition"):
//   grid       `drumOptions.grid`: { voice: [one string a bar] }, each string S·m places (`beatsOf`: m = 1 unless
//              S < 4; decided: slot resolution, no half-slots), `x` a stroke, `X` an accent, `.` off. A bar in mode
//              'grid' plays its strings; each cell lands through `land()` like any stroke (the nearest onset in the
//              place's window, then one place wider, else silent: `silentCells`). Fills and crashes stay options over
//              it. `gridOf(arrangement)` writes any arrangement back as a grid (a hit's `pos` → place round(pos·m)), so
//              every mode and pattern is a preset of the grid.
//   prime      the two-level prime partition (Avery's design; revised in step 4c-prime, DESIGN_NOTES "Step 4c"). Level 1:
//              p lights evenly over the cycle from the downbeat, each landed on its nearest onset (uneven in time: they
//              are real onsets). p is a seeded random prime above the C = N·S cells (decided, Avery 2026-10-25; C =
//              N·S·m under 4 slots, proposed), up to max(199, the smallest prime ≥ 2C) (proposed), drawn from the
//              drums' own generator (`${seed}/drums/prime`), so Compose's draws and `against`'s never move. Level 2:
//              Partitions' own distribution of C over p (getSecondaryAllowedSet: E(C, p) turned to start on a light,
//              which for a prime p is exactly the live UI's computeL2Coverages cut) chooses C of the p lights, in
//              order, one a cell; light 0 is always chosen, so the downbeat cell is the downbeat. A lit cell strikes
//              its chosen light. The cells lit are `selectLights(C, hits)` (Euclid from the downbeat; hits = C, every
//              cell, by default, or N·hitsPerBar), or the grid's perc row when a grid is given. The prime line plays on
//              the perc, over the backbeat (or over the grid's other voices) (proposed).

import { partitionSizes, euclidPattern } from './cells.js';
import { phrasesOf, isStrongBeat } from './harmony.js';
import { DRUM_PATTERNS, PATTERN_NAMES, FILL, patternStrokes } from './drum-patterns.js';

export const COMPOSER_DRUMS_VERSION = 'composer-drums-v1';
export const DRUM_VOICES = Object.freeze(['kick', 'snare', 'hat', 'perc', 'cym']);
/** the modes laid over the backbeat, then every curated pattern by name */
export const LAYERED_MODES = Object.freeze(['backbeat', 'with', 'against', 'partition']);
export const DRUM_MODES = Object.freeze([...LAYERED_MODES, ...PATTERN_NAMES]);
/** the modes that read a source of their own (step 4c): the step grid, and the two-level prime partition. Kept out of
 *  DRUM_MODES, the presets' list (the lab's mode select and the tests read it) */
export const SOURCE_MODES = Object.freeze(['grid', 'prime']);
export const ALL_DRUM_MODES = Object.freeze([...DRUM_MODES, ...SOURCE_MODES]);
/** a voice's sound: an Audio/drums choice (`made:<id>` or a sample URL); '' is that voice off */
export const DEFAULT_KIT = Object.freeze({ kick: 'made:kick', snare: 'made:snare', hat: 'made:hihat', perc: 'made:perc', cym: 'made:cym' });
export const DRUM_VELOCITY = Object.freeze({ kick: 0.85, snare: 0.75, hat: 0.3, perc: 0.5, cym: 0.55 });
export const ACCENT = 0.12;
/** a stroke on an onset more layers strike is that much louder a layer (the row's own accents) */
export const STRIKE_ACCENT = 0.04;
export const FILL_MIN_PHRASE_BARS = 4;
export const DRUM_OPTIONS = Object.freeze(['enabled', 'mode', 'fills', 'kit', 'seed', 'layer', 'hitsPerBar', 'perBar', 'grid', 'p']);
/** level-1 sources of the partition: 'layer' (a layer striking the downbeat) and 'prime' (p even lights, landed) */
export const PARTITION_SOURCES = Object.freeze(['layer', 'prime']);
/** what an `X` adds in a grid: the patterns' accent, but the hat's is the backbeat's own beat lift (+0.08), so a
 *  backbeat written as a grid plays back at its own velocities (proposed) */
export const GRID_ACCENT = Object.freeze({ kick: ACCENT, snare: ACCENT, hat: 0.08, perc: ACCENT, cym: ACCENT });
export const GRID_CHARS = Object.freeze({ off: '.', stroke: 'x', accent: 'X' });

const EPS = 1e-9;
const LAYER_NAMES = 'ABCD';
const fail = (what) => { throw new Error(`composer/drums: ${what}`); };
const mod = (v, n) => ((v % n) + n) % n;

/** a seeded generator, the same as compose.js' `seededRandom` (copied: compose.js imports this module) */
function seeded(seed) {
  let h = 0x811c9dc5; const text = String(seed);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The bar's 4 beats: S slots (S·m sub-slots under 4 slots) cut in 4 as Partitions cuts a block.
 * → { S, m, sizes (sub-slots), startU (sub-slots), pos (slot units: where each beat starts) }
 */
export function beatsOf(S) {
  if (!(Number.isInteger(S) && S >= 1)) fail(`bad slots per bar ${S}`);
  const m = Math.max(1, Math.ceil(4 / S)), { sizes } = partitionSizes(S * m, 4), startU = [];
  let at = 0; for (const s of sizes) { startU.push(at); at += s; }
  return { S, m, sizes: [...sizes], startU, pos: startU.map((u) => u / m) };
}

/**
 * The composition's time grid and its onsets, from the spec alone.
 * → { T, rowT, W, N, S, P, grid, phase, phaseX, layers: [{ layer, name, value, step }], starts (relative slot starts),
 *     barStarts, relOf(tick), timeOf(tick), rAt(g), nearest(r, lo, hi), strikesAt(tick) }
 *   r   a place in the cycle relative to the downbeat, as a share of the row's cycle (may run past [0, W) at the ends)
 *   W   the loop's share of the row's cycle: 1, or a window's (knobs.cut)
 *   g   a place in slot units over the cycle (slot k's anchor is k; may run past [0, P))
 */
export function drumGrid(spec) {
  const { knobs, input, stats, timeline } = spec;
  const T = knobs.cycleSeconds, N = knobs.bars, S = knobs.slotsPerBar, P = N * S, grid = stats.grid;
  const rowT = knobs.rowCycleSeconds ?? T, W = knobs.cut ? T / rowT : 1;
  if (!(Number.isSafeInteger(grid) && grid >= 1)) fail(`bad grid ${grid}`);
  const [pn, pd] = knobs.phase, phaseX = pn / pd;
  const layers = [];
  input.layers.forEach((v, i) => { if (v > 0) layers.push({ layer: i, name: LAYER_NAMES[i], value: v, step: grid / v }); });
  const starts = timeline.slotStarts.map((s) => s / rowT), barStarts = timeline.barStarts.map((s) => s / rowT);
  if (starts.length !== P) fail(`the timeline has ${starts.length} slots, not ${P}`);
  // the very expression compose.js times a note by, so a stroke on a note's onset sounds with it
  const relOf = (tick) => mod(tick / grid - phaseX, 1);
  /** a stroke's time on the loop: before the downbeat → the loop's end, past the window's end → the loop's start */
  const timeOf = W === 1 ? (tick) => relOf(tick) * T
    : (tick) => { const u = relOf(tick); return u < W ? u * rowT : u > (1 + W) / 2 ? T - (1 - u) * rowT : (u - W) * rowT; };
  const rAt = (g) => {
    const w = Math.floor(g / P), h = g - w * P, k = Math.min(P - 1, Math.floor(h)), frac = h - k;
    const a = starts[k], b = k + 1 < P ? starts[k + 1] : W;
    return w * W + a + frac * (b - a);
  };
  const strikesAt = (tick) => { let n = 0, owners = 0; for (const L of layers) if (tick % L.step === 0) { n++; owners |= 1 << L.layer; } return { strikes: n, owners }; };
  /** the onset nearest r with lo < its place ≤ hi: { tick, d } (d its signed distance from r), or null */
  const nearest = (r, lo, hi) => {
    let best = null;
    for (const L of layers) {
      const x = (phaseX + r) * L.value, f = Math.floor(x);
      for (const k of f === x ? [f] : [f, f + 1]) {
        const pr = k / L.value - phaseX;
        if (!(pr > lo - EPS * 1e-3 && pr <= hi + EPS * 1e-3)) continue;
        const d = pr - r, tick = mod(k, L.value) * L.step;
        if (!best || Math.abs(d) < Math.abs(best.d) - 1e-15 || (Math.abs(Math.abs(d) - Math.abs(best.d)) <= 1e-15 && d < best.d)) best = { tick, d };
      }
    }
    return best;
  };
  return { T, rowT, W, N, S, P, grid, phase: [pn, pd], phaseX, layers, starts, barStarts, relOf, timeOf, rAt, strikesAt, nearest };
}

/**
 * A place landed (the drums' landing, exported for claves.js R3): `gq` a place in slot units over the cycle, `h` half the
 * spacing of its grid's places. The onset nearest it within ±h (half-way to the neighbouring places), else within ±2h
 * (a whole place either side: 'wide'), else null. `clip` [from, to) in slot units bounds the search to those slots (a bar,
 * or a chart's span: an onset at `from` counts, one at `to` does not). → { tick, d, snap: 'slot' | 'wide' } | null
 */
export function landPlace(g, gq, h, clip = null) {
  const r = g.rAt(gq);
  const lo = (x) => (clip ? Math.max(x, g.rAt(clip[0])) : x), hi = (x) => (clip ? Math.min(x, g.rAt(clip[1]) - 2e-12) : x);
  let on = g.nearest(r, lo(g.rAt(gq - h)), hi(g.rAt(gq + h))), snap = 'slot';
  if (!on) { on = g.nearest(r, lo(g.rAt(gq - 2 * h)), hi(g.rAt(gq + 2 * h))); snap = 'wide'; }
  return on ? { tick: on.tick, d: on.d, snap } : null;
}

/** the bar a relative place falls in, and its place in slot units inside it */
function placeOf(g, r) {
  let j = 0, lo = 0, hi = g.P - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (g.starts[mid] <= r + EPS) { j = mid; lo = mid + 1; } else hi = mid - 1; }
  const next = j + 1 < g.P ? g.starts[j + 1] : g.W, bar = Math.floor(j / g.S);
  return { bar, slot: j, pos: (j - bar * g.S) + (next > g.starts[j] ? (r - g.starts[j]) / (next - g.starts[j]) : 0) };
}

/**
 * The layers that strike the downbeat (the phase onset): v strikes it when phase·v is whole.
 * → [{ layer, name, value, pulse }] (pulse: which of its v pulses the downbeat is), in layer order
 */
export function downbeatLayers(spec) {
  const [pn, pd] = spec.knobs.phase, out = [];
  spec.input.layers.forEach((v, i) => {
    if (!(v > 0)) return;
    const num = BigInt(pn) * BigInt(v);
    if (num % BigInt(pd) === 0n) out.push({ layer: i, name: LAYER_NAMES[i], value: v, pulse: Number(num / BigInt(pd)) });
  });
  return out;
}

/** which of `count` level-1 lights sound for `hits` strokes: Partitions' secondary pattern (getSecondaryAllowedSet),
 *  E(hits, count) turned to start on a stroke, so light 0 (the downbeat) sounds → [light index] ascending */
export function selectLights(count, hits) {
  if (!(Number.isInteger(count) && count >= 1)) fail(`bad light count ${count}`);
  const k = Math.max(1, Math.min(count, Math.floor(hits)));
  let pattern = euclidPattern(count, k);
  const first = pattern.indexOf(1);
  if (first > 0) pattern = pattern.slice(first).concat(pattern.slice(0, first));
  const out = [];
  pattern.forEach((on, i) => { if (on) out.push(i); });
  return out;
}

export const isPrime = (n) => { if (!(Number.isSafeInteger(n) && n >= 2)) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
/** the prime nearest n; of two equally near, the larger. (Step 4c's first rule for p, decision 7 as first ruled, now
 *  superseded by `primeRange` / `drawPrime`; kept as a helper) */
export function nearestPrime(n) {
  if (!(Number.isFinite(n) && n >= 0)) fail(`bad count ${n}`);
  const c = Math.round(n);
  for (let d = 0; ; d++) { if (isPrime(c + d)) return c + d; if (c - d >= 2 && isPrime(c - d)) return c - d; }
}

/** the smallest prime ≥ n */
export function nextPrime(n) { let c = Math.max(2, Math.ceil(n)); while (!isPrime(c)) c++; return c; }

/** the low-triple-digit ceiling of p's range (proposed: Avery's "up to the low triple digits") */
export const PRIME_CEILING = 199;

/**
 * Where p is drawn from (decision 7, re-ruled by Avery 2026-10-25: a random prime above N·S, up to the low triple
 * digits): the primes in (C, U], U = max(PRIME_CEILING, the smallest prime ≥ 2C) (proposed: small meters reach the
 * triple digits, and a large one still has primes from just above C to about 2C).
 * → { above: C, upTo: U, primes: [ascending] }
 */
export function primeRange(C) {
  if (!(Number.isInteger(C) && C >= 1)) fail(`bad cell count ${C}`);
  const U = Math.max(PRIME_CEILING, nextPrime(2 * C)), primes = [];
  for (let q = C + 1; q <= U; q++) if (isPrime(q)) primes.push(q);
  return { above: C, upTo: U, primes };
}

/** the seeded random p over C cells: one of `primeRange(C).primes`, uniformly, drawn from the drums' own generator
 *  `${seed}/drums/prime` (one draw), so no other part's draws and no bar of `against` move. The same seed, the same p */
export function drawPrime(C, seed = 1) {
  const { primes } = primeRange(C), x = seeded(`${seed}/drums/prime`)();
  return primes[Math.min(primes.length - 1, Math.floor(x * primes.length))];
}

/** level 2 of the prime partition: the C of p lights that Partitions' own distribution chooses (its secondary pattern,
 *  PartitionsPlayback.getSecondaryAllowedSet(p, C): E(C, p) turned to start on a light), ascending, cell j's light the
 *  j-th; light 0 is always the first. For a prime p > C this is exactly the live UI's L2 cut too (computeL2Coverages,
 *  the starts of calculatePartitionSizes(p, C)): assert-drum-prime.mjs checks both */
export function primeSelection(p, C) {
  if (!(Number.isInteger(p) && Number.isInteger(C) && C >= 1 && p >= C)) fail(`level 2 chooses C = ${C} of p = ${p} lights: p must be at least C`);
  return selectLights(p, C);
}

/** the grid's places a bar and its cells over the cycle: S·m places a bar (decision 6), C = N·S·m cells */
export function gridShape(g) { const m = beatsOf(g.S).m; return { m, places: g.S * m, cells: g.N * g.S * m }; }

/**
 * Level 1 of the prime partition: p lights evenly over the cycle from the downbeat, light i aimed at i/p of it and
 * landed on the onset nearest that place within half a light either side (`snap: 'light'`), then a whole light
 * either side (`'wide'`), else dark (tick null). So they are uneven in time: each is a real onset.
 * → [{ i, at (i/p, its even place), tick, time (s from the downbeat), r (its real place, a share of the cycle),
 *      bar, pos (slot units in its bar), slot, snap }]
 */
export function primeLights(g, p) {
  if (!isPrime(p)) fail(`the prime partition's p must be a prime, not ${p}`);
  const out = [], w = g.W / p;
  for (let i = 0; i < p; i++) {
    const at = (i / p) * g.W;
    let on = g.nearest(at, at - w / 2, at + w / 2), snap = 'light';
    if (!on) { on = g.nearest(at, at - w, at + w); snap = 'wide'; }
    if (!on) { out.push({ i, at, tick: null, time: null, r: null, bar: null, pos: null, slot: null, snap: null }); continue; }
    const r = g.relOf(on.tick), where = placeOf(g, r);
    out.push({ i, at, tick: on.tick, time: g.timeOf(on.tick), r, bar: where.bar, pos: where.pos, slot: where.slot, snap });
  }
  return out;
}

/** level 2: the lights cell j of C covers, [from, to): from its chosen light (`primeSelection`) up to the next cell's,
 *  Partitions' L2 group (computeL2Coverages), 1 or more lights, whatever their timing. `chosen` may be passed in */
export function cellLights(j, p, C, chosen = primeSelection(p, C)) { return { from: chosen[j], to: j + 1 < C ? chosen[j + 1] : p }; }

/**
 * Level 1 of the partition: the lights the selection chooses among, counted from the downbeat.
 *   source 'layer'   a layer that strikes the downbeat: its v pulses, light i at pulse (downbeat's + i) mod v
 *   source 'prime'   Avery's two-level prime partition: p lights spread evenly over the cycle (p a prime above the
 *                    grid's cells, N·S when S ≥ 4: asked, or by default `drawPrime(cells, seed)`), each landed on an
 *                    onset (`primeLights`)
 * → { source, count, tickAt(i) } (+ lights, for 'prime')
 */
export function levelOneLights(g, { source = 'layer', layer, p = null, seed = 1 } = {}) {
  if (source === 'prime') {
    const count = p ?? drawPrime(gridShape(g).cells, seed), lights = primeLights(g, count);
    return { source, count, lights, tickAt: (i) => lights[mod(i, count)].tick };
  }
  if (source !== 'layer') fail(`no partition source ${JSON.stringify(source)} (${PARTITION_SOURCES.join(', ')})`);
  const L = g.layers.find((x) => x.layer === layer.layer);
  if (!L) fail(`layer ${layer.name} is not in the rhythm`);
  // a window counts the layer's pulses inside it, from the downbeat's
  return { source, count: g.W === 1 ? L.value : Math.max(1, Math.ceil(g.W * L.value - 1e-9)), tickAt: (i) => mod(layer.pulse + i, L.value) * L.step };
}

/**
 * The two-level prime partition: level 1's p lights, level 2's C cells (the lights Partitions' distribution chooses),
 * the cells lit and what each strikes.
 *   p     null: `drawPrime(C, seed)`; else a prime above C (refused otherwise)
 *   lit   null: `selectLights(C, hits)` (Euclid from the downbeat; hits = C by default, or N·hitsPerBar);
 *         else the lit cells' indices (a grid's perc row)
 * → { p, drawn (p was drawn, not asked), range: { above, upTo, primes (how many) }, cells, hits, lights (primeLights),
 *     chosen: [light] (cell j's light, `primeSelection`), selected: [cell] (the cells lit),
 *     struck: [{ cell, light, tick, snap }] (snap the light's own 'light' | 'wide', or 'cell' | 'cell-wide' for a dark
 *     light landed within its cell's reach),
 *     silent: [{ cell, why }], emptyCells (0: p > C), perCell (lights a cell, Partitions' L2 groups: min, max) }
 */
export function primePartition(spec, g = drumGrid(spec), { p = null, seed = spec?.input?.seed ?? 1, hitsPerBar = null, lit = null } = {}) {
  const C = gridShape(g).cells, range = primeRange(C);
  if (p != null && !(isPrime(p) && p > C)) fail(`p must be a prime above the ${C} cells (the prime partition's level 1), not ${JSON.stringify(p)}`);
  const L1 = levelOneLights(g, { source: 'prime', p, seed }), P1 = L1.count, chosen = primeSelection(P1, C);
  const hits = lit ? lit.length : Math.max(1, Math.min(C, hitsPerBar != null ? Math.round(hitsPerBar * g.N) : C));
  const selected = lit ? [...lit].sort((a, b) => a - b) : selectLights(C, hits);
  // a chosen light strikes its own onset; a dark one (no onset within a light of it: p runs to the triple digits, so
  // a light is narrow on a sparse row) strikes the onset nearest its place within its cell's reach, half a cell either
  // side, then a whole cell (snap 'cell' | 'cell-wide'), as land() widens a stroke's look (proposed); else silent
  const struck = [], silent = [], w = g.W / C;
  for (const j of selected) {
    const light = chosen[j], L = L1.lights[light];
    if (L.tick != null) { struck.push({ cell: j, light, tick: L.tick, snap: L.snap }); continue; }
    let on = g.nearest(L.at, L.at - w / 2, L.at + w / 2), snap = 'cell';
    if (!on) { on = g.nearest(L.at, L.at - w, L.at + w); snap = 'cell-wide'; }
    if (!on) { silent.push({ cell: j, why: `its light (${light}) found no onset within a cell` }); continue; }
    struck.push({ cell: j, light, tick: on.tick, snap });
  }
  let lo = Infinity, hi = 0;
  for (let j = 0; j < C; j++) { const { from, to } = cellLights(j, P1, C, chosen), n = to - from; lo = Math.min(lo, n); hi = Math.max(hi, n); }
  return { p: P1, drawn: p == null, range: { above: range.above, upTo: range.upTo, primes: range.primes.length }, cells: C, hits: selected.length, lights: L1.lights, chosen, selected, struck, silent, emptyCells: 0, perCell: { min: lo, max: hi } };
}

/**
 * The partition line, single level: the layer that strikes the downbeat (or `layer`, by name or value, when it does),
 * `hits` of its pulses from the downbeat. → { layer, name, value, from (the downbeat's pulse), hits, lights: [i],
 *   ticks: [tick], candidates: [name] } or null when no layer strikes the downbeat (never, for a Compose phase)
 */
export function partitionLine(spec, g = drumGrid(spec), { layer = null, hitsPerBar = null } = {}) {
  const owners = downbeatLayers(spec);
  if (!owners.length) return null;
  let pick;
  if (layer != null) {
    pick = owners.find((o) => o.name === layer || o.value === layer);
    if (!pick) fail(`layer ${layer} does not strike the downbeat (${owners.map((o) => `${o.name} ${o.value}`).join(', ')} do)`);
  } else {
    const off = (o) => Math.abs((o.value * g.W) / g.N - g.S);
    pick = owners.reduce((a, b) => (off(b) < off(a) - EPS || (Math.abs(off(b) - off(a)) <= EPS && b.value < a.value) ? b : a));
  }
  const lights = levelOneLights(g, { source: 'layer', layer: pick });
  const hits = Math.max(1, Math.min(lights.count, hitsPerBar != null ? Math.round(hitsPerBar * g.N) : g.N * g.S));
  const chosen = selectLights(lights.count, hits);
  return { layer: pick.layer, name: pick.name, value: pick.value, from: pick.pulse, hits: chosen.length, lights: chosen, ticks: chosen.map((i) => lights.tickAt(i)), candidates: owners.map((o) => o.name) };
}

/** options as given → every option, resolved (unknown keys refused) */
export function readDrumOptions(options = {}) {
  const o = options || {};
  for (const k of Object.keys(o)) if (!DRUM_OPTIONS.includes(k)) fail(`no drum option "${k}" (${DRUM_OPTIONS.join(', ')})`);
  const grid = o.grid == null ? null : readGrid(o.grid);
  // a grid given with no mode is played as the grid (an edit turns the mode to 'grid'); with another mode it waits,
  // unread, for a bar in mode 'grid' or 'prime'
  const mode = o.mode ?? (grid ? 'grid' : 'backbeat');
  if (!ALL_DRUM_MODES.includes(mode)) fail(`mode must be one of ${ALL_DRUM_MODES.join(', ')}, not ${JSON.stringify(mode)}`);
  const kit = { ...DEFAULT_KIT };
  for (const [v, c] of Object.entries(o.kit || {})) { if (!DRUM_VOICES.includes(v)) fail(`no drum voice ${v}`); kit[v] = c == null ? '' : String(c); }
  const perBar = {};
  for (const [b, m] of Object.entries(o.perBar || {})) { if (!ALL_DRUM_MODES.includes(m)) fail(`bar ${b}: no mode ${m}`); perBar[b] = m; }
  if (o.hitsPerBar != null && !(Number(o.hitsPerBar) > 0)) fail(`bad hitsPerBar ${o.hitsPerBar}`);
  if (o.p != null && !isPrime(o.p)) fail(`p must be a prime (the two-level prime partition's level 1), not ${JSON.stringify(o.p)}`);
  const out = { enabled: o.enabled ?? true, mode, fills: o.fills ?? true, kit, seed: o.seed ?? null, layer: o.layer ?? null, hitsPerBar: o.hitsPerBar == null ? null : Number(o.hitsPerBar), perBar };
  // only when given, so options without them resolve (and echo in `spec.drums.options`) exactly as before step 4c
  if (grid) out.grid = grid;
  if (o.p != null) out.p = o.p;
  return out;
}

/** a grid as given → a copy, checked: { voice: [string a bar] }, a voice left out silent, the strings of `x X .` */
export function readGrid(grid) {
  if (typeof grid !== 'object' || Array.isArray(grid)) fail('a drum grid is { voice: [one string a bar] }');
  const out = {};
  for (const [v, rows] of Object.entries(grid)) {
    if (!DRUM_VOICES.includes(v)) fail(`grid: no drum voice ${v} (${DRUM_VOICES.join(', ')})`);
    if (!Array.isArray(rows)) fail(`grid: ${v} must be one string a bar`);
    rows.forEach((line, k) => { if (typeof line !== 'string' || !/^[xX.]*$/.test(line)) fail(`grid: ${v} bar ${k + 1} is ${JSON.stringify(line)}: x a stroke, X an accent, . off`); });
    out[v] = [...rows];
  }
  return out;
}

/** a grid that bars in mode 'grid' or 'prime' read must fit the meter: N strings a voice, S·m places each */
function checkGridShape(grid, N, W) {
  for (const [v, rows] of Object.entries(grid)) {
    if (rows.length !== N) fail(`grid: ${v} has ${rows.length} bar${rows.length === 1 ? '' : 's'}, the composition ${N}`);
    rows.forEach((line, k) => { if (line.length !== W) fail(`grid: ${v} bar ${k + 1} has ${line.length} places, not ${W} (S·m)`); });
  }
}

/**
 * An arrangement written as a grid (the presets ⇄ grid): a hit at `pos` → place round(pos·m) of its bar (a place
 * rounding to the bar's end is the next bar's first), a prime stroke → its cell (in the perc row). The fills' strokes
 * (kick and snare from beat 3 of a fill bar) and the crashes (cym on a crash bar's downbeat) are left out: they are
 * options over the grid. `X` where the stroke's own velocity (its strikes' lift taken off) is accented.
 * → { voice: [one string a bar] }, every voice
 */
export function gridOf(d) {
  const S = d.beats.slotsPerBar, m = d.beats.subdivide, N = d.bars.length, W = S * m, fillFrom = beatsOf(S).pos[2];
  const rows = Object.fromEntries(DRUM_VOICES.map((v) => [v, Array.from({ length: N }, () => new Array(W).fill('.'))]));
  for (const h of d.hits) {
    let bar, place;
    if (h.snap === 'prime') { bar = Math.floor(h.cell / W); place = h.cell % W; }
    else {
      const b = d.bars[h.bar];
      if (b.fill && (h.voice === 'kick' || h.voice === 'snare') && h.pos >= fillFrom - EPS) continue;
      if (b.crash && h.voice === 'cym' && Math.abs(h.pos) < EPS) continue;
      bar = h.bar; place = Math.round(h.pos * m);
      if (place >= W) { place -= W; bar = mod(bar + 1, N); }
    }
    const lift = STRIKE_ACCENT * Math.max(0, h.strikes - 1), base = DRUM_VELOCITY[h.voice];
    const accent = h.velocity >= 1 - 1e-12 ? base + lift < 1 - 1e-12 : h.velocity - lift > base + GRID_ACCENT[h.voice] / 2;
    const row = rows[h.voice][bar];
    if (accent) row[place] = 'X'; else if (row[place] === '.') row[place] = 'x';
  }
  return Object.fromEntries(DRUM_VOICES.map((v) => [v, rows[v].map((r) => r.join(''))]));
}

/**
 * The drums of a spec.
 *   options  { enabled (true), mode ('backbeat' | 'with' | 'against' | 'partition' | a pattern name | 'grid' |
 *              'prime'), fills (true), kit: { voice: choice }, seed (the spec's), layer (partition: a layer striking
 *              the downbeat, by name or value), hitsPerBar (partition, prime), perBar: { bar: mode } (a bar's own mode),
 *              grid: { voice: [one string a bar] } (read by bars in mode 'grid', and as the lit cells of 'prime'),
 *              p (prime: level 1's light count, a prime above the cells; by default a seeded random one, `drawPrime`) }
 * → null for a refusal, else { version, enabled, mode, options, kit, beats, partition, bars: [{ bar, mode, fill, crash,
 *   why }], hits: [{ voice, bar, pos, slot, tick, time, velocity, strikes, snap }], decisions, stats }, and only when a
 *   bar is in mode 'grid' or 'prime': silentCells: [{ bar, voice, place }] (grid cells, and prime cells, no onset
 *   struck), and when one is 'prime': prime (`primePartition`'s, its lights' real times for the UI strip)
 *   snap  'slot' (the onset nearest its place), 'wide' (the second look), 'note' (a part's note), 'layer' (partition),
 *         'prime' (the prime partition: the hit also carries its `cell` and `light`)
 * With no grid read and no bar in mode 'prime', the output is byte for byte the drums of before step 4c (tested
 * against drums-baseline.mjs).
 */
export function arrangeDrums(spec, options = {}) {
  if (!spec || spec.refused) return null;
  const opt = readDrumOptions(options), g = drumGrid(spec), { N, S, P } = g;
  // STEP 4d: `against` draws from a generator of its bar's own (`${seed}/drums/${bar}`), so an edit to one bar (a chord
  // swap rebuilds its comping) never re-draws a later bar's strokes; before 4d one generator ran in bar order
  const seed = opt.seed ?? spec.input?.seed ?? 1, rngOfBar = (k) => seeded(`${seed}/drums/${k}`);
  const beats = beatsOf(S), m = beats.m, h = 1 / (2 * m);
  const decisions = [];
  const decide = (what, value, why) => { decisions.push({ what, value, why }); return value; };
  // what is decided depends on the options as resolved, never on how they were spelled ({} and the defaults agree)
  decide('drums.mode', opt.mode, opt.mode !== 'backbeat' ? 'asked' : 'the steady backbeat by default (the sprint brief): kick on beats 1 and 3, snare on 2 and 4, a hat on every slot');
  decide('drums.beats', beats.pos, m === 1
    ? `the bar's ${S} slots cut in 4 beats as Partitions cuts a block (${beats.sizes.join(', ')} slots)`
    : `${S} slot${S === 1 ? '' : 's'} a bar is under 4 beats: cut on 1/${m} slots (${beats.sizes.map((s) => `${s}/${m}`).join(', ')}), a beat between anchors landing on a real onset inside its slot`);

  const hits = [], stats = { silent: 0, wide: 0 }, silentCells = [];
  const push = (hit) => { const s = g.strikesAt(hit.tick); hits.push({ ...hit, time: g.timeOf(hit.tick), velocity: Math.min(1, hit.velocity + STRIKE_ACCENT * Math.max(0, s.strikes - 1)), strikes: s.strikes }); };
  /** a stroke at place q (slot units) of bar `bar`, landed on the onset nearest it */
  const land = (voice, bar, q, velocity, cell = false) => {
    const on = landPlace(g, bar * S + q, h);
    if (!on) { stats.silent++; if (cell) silentCells.push({ bar, voice, place: Math.round(q * m) }); return; }
    if (on.snap === 'wide') stats.wide++;
    push({ voice, bar, pos: q, slot: mod(bar * S + Math.floor(q + EPS), P), tick: on.tick, velocity, snap: on.snap });
  };
  const beatSet = new Set(beats.pos.map((x) => x.toFixed(6)));
  /** a fraction of the bar → its place through the beats (slot units on the 1/m grid), or null past the bar's end */
  const placeOfF = (f) => {
    const x = 4 * f, b = Math.min(3, Math.floor(x + EPS)), u = Math.round(beats.startU[b] + (x - b) * beats.sizes[b] + EPS);
    return u >= S * m ? null : u / m;
  };
  const fillFrom = beats.pos[2];

  // ── a mode a bar, fills at the phrase ends ──
  const phrases = phrasesOf({ bars: N, slotsPerBar: S });
  const fillBars = new Set();
  if (opt.fills) for (const ph of phrases) if (ph.bars >= FILL_MIN_PHRASE_BARS) fillBars.add(ph.from + ph.bars - 1);
  decide('drums.fills', [...fillBars], !opt.fills ? 'asked off' : fillBars.size
    ? `the last bar of each phrase of ${FILL_MIN_PHRASE_BARS} bars or more fills its second half (from beat 3), and a crash opens the bar after it`
    : `no phrase is ${FILL_MIN_PHRASE_BARS} bars or more (${phrases.map((x) => x.bars).join(' + ')} bar${N === 1 ? '' : 's'}): no fills`);
  const bars = [], W = S * m;
  const modes = Array.from({ length: N }, (_, k) => opt.perBar[k] ?? opt.mode);
  const usesGrid = modes.includes('grid'), usesPrime = modes.includes('prime');
  if (usesGrid && !opt.grid) fail('mode \'grid\' plays drumOptions.grid, and none was given');
  if ((usesGrid || usesPrime) && opt.grid) {
    checkGridShape(opt.grid, N, W);
    decide('drums.grid', W, `the step grid: ${W} places a bar (${m === 1 ? 'a place a slot' : `${S} slot${S === 1 ? '' : 's'} on 1/${m} slots`}), each cell landed on the onset nearest its place`);
  }
  /** a bar's grid strings → its strokes, voice by voice, place by place (perc left to the prime line in a prime bar) */
  const gridStrokes = (k, prime) => {
    const out = [];
    for (const voice of DRUM_VOICES) {
      if (prime && voice === 'perc') continue;
      const line = opt.grid[voice]?.[k];
      if (line) for (let u = 0; u < W; u++) if (line[u] !== '.') out.push({ voice, q: u / m, velocity: DRUM_VELOCITY[voice] + (line[u] === 'X' ? GRID_ACCENT[voice] : 0), cell: true });
    }
    return out;
  };
  for (let k = 0; k < N; k++) {
    const ph = phrases.find((x) => k >= x.from && k < x.from + x.bars), mode = opt.perBar[k] ?? opt.mode;
    const fill = fillBars.has(k), crash = fillBars.has(mod(k - 1, N)) && fillBars.size > 0;
    const pat = DRUM_PATTERNS[mode], patBar = pat ? (k - ph.from) % pat.bars : 0;
    const what = pat ? `${pat.label}${pat.bars > 1 ? ` (bar ${patBar + 1} of ${pat.bars})` : ''}` : mode === 'backbeat' ? 'backbeat'
      : mode === 'grid' ? 'the step grid' : mode === 'prime' ? `${opt.grid ? 'the step grid' : 'backbeat'} + the prime partition` : `backbeat + ${mode}`;
    bars.push({ bar: k, mode, fill, crash, why: `${what}${opt.perBar[k] ? ' (asked for this bar)' : ''}${fill ? `; fills from beat 3: the last bar of a ${ph.bars}-bar phrase` : ''}${crash ? '; a crash on the downbeat: the phrase opens after a fill' : ''}` });

    // the bar's groove: the backbeat, or the pattern's strokes through the beats
    const strokes = [];
    if (mode === 'grid' || (mode === 'prime' && opt.grid)) strokes.push(...gridStrokes(k, mode === 'prime'));
    else if (pat) {
      for (const s of patternStrokes(pat)) if (s.bar === patBar) { const q = placeOfF(s.f); if (q != null) strokes.push({ voice: s.voice, q, velocity: DRUM_VELOCITY[s.voice] + (s.accent ? ACCENT : 0) }); }
    } else {
      strokes.push({ voice: 'kick', q: beats.pos[0], velocity: DRUM_VELOCITY.kick + ACCENT }, { voice: 'kick', q: beats.pos[2], velocity: DRUM_VELOCITY.kick });
      strokes.push({ voice: 'snare', q: beats.pos[1], velocity: DRUM_VELOCITY.snare }, { voice: 'snare', q: beats.pos[3], velocity: DRUM_VELOCITY.snare });
      for (let q = 0; q < S; q++) strokes.push({ voice: 'hat', q, velocity: DRUM_VELOCITY.hat + (beatSet.has(q.toFixed(6)) ? 0.08 : 0) });
    }
    for (const s of strokes) if (!(fill && s.voice !== 'cym' && s.voice !== 'perc' && s.q >= fillFrom - EPS)) land(s.voice, k, s.q, s.velocity, !!s.cell);
    if (fill) for (const s of patternStrokes(FILL)) if (s.f >= 0.5 - EPS) {
      const q = placeOfF(s.f);
      if (q == null) continue;
      const rise = (s.f - 0.5) / 0.5;
      land(s.voice, k, q, s.voice === 'snare' ? 0.55 + 0.4 * rise : DRUM_VELOCITY[s.voice]);
    }
    if (crash) land('cym', k, 0, DRUM_VELOCITY.cym + ACCENT);
  }

  // ── the line over the backbeat: with, against, partition (each bar of that mode) ──
  const modeOf = (k) => bars[k].mode;
  const notesBySlot = (id) => { const by = new Map(); for (const n of spec.parts.find((p) => p.id === id)?.notes || []) if (!by.has(n.slot)) by.set(n.slot, n); return by; };
  let partition = null;
  if (bars.some((b) => b.mode === 'with' || b.mode === 'against')) {
    // the comp in chords (compose.js `compChordsOfBar`): its strokes, one a slot, not the strum's tones (COMP_ARP_ORDER.md P9)
    const strokes = spec.parts.find((p) => p.id === 'comp')?.strokes;
    const lead = notesBySlot('lead'), comp = strokes ? new Map(strokes.map((x) => [x.slot, x])) : notesBySlot('comp');
    for (let k = 0; k < N; k++) {
      if (modeOf(k) === 'with') {
        for (let q = 0; q < S; q++) {
          const j = k * S + q, a = lead.get(j), b = comp.get(j), n = a ?? b;
          if (!n) continue;
          push({ voice: 'perc', bar: k, pos: q, slot: j, tick: n.tick, velocity: DRUM_VELOCITY.perc + (a && b || isStrongBeat(q, S) ? ACCENT : 0), snap: 'note' });
        }
      } else if (modeOf(k) === 'against') {
        const empty = [], rng = rngOfBar(k);
        for (let q = 0; q < S; q++) if (!lead.has(k * S + q) && !comp.has(k * S + q)) empty.push({ q, off: beatSet.has(q.toFixed(6)) ? 1 : 0, r: rng() });
        empty.sort((x, y) => x.off - y.off || x.r - y.r);
        for (const e of empty.slice(0, Math.max(1, Math.floor(S / 2))).sort((x, y) => x.q - y.q)) land('perc', k, e.q, DRUM_VELOCITY.perc + (e.off ? 0 : 0.05));
      }
    }
  }
  if (bars.some((b) => b.mode === 'partition')) {
    partition = partitionLine(spec, g, { layer: opt.layer, hitsPerBar: opt.hitsPerBar });
    if (partition) {
      decide('drums.partition', `${partition.name} (${partition.value})`, `${partition.candidates.length > 1 ? `of the layers striking the downbeat (${partition.candidates.join(', ')}), ` : 'the layer striking the downbeat: '}${partition.name}, its ${partition.value} pulses the blocks from the downbeat (pulse ${partition.from}), ${partition.hits} of them sounding: Partitions' secondary pattern E(${partition.hits}, ${partition.value}) from the downbeat${opt.layer != null ? ' (layer asked)' : ''}`);
      partition.ticks.forEach((tick, i) => {
        const where = placeOf(g, g.relOf(tick));
        if (modeOf(where.bar) !== 'partition') return;
        push({ voice: 'perc', bar: where.bar, pos: where.pos, slot: where.slot, tick, velocity: DRUM_VELOCITY.perc + (i === 0 ? ACCENT : 0), snap: 'layer' });
      });
    }
  }
  let prime = null;
  if (usesPrime) {
    // the lit cells: the grid's perc row over the prime bars, or Euclid over every cell (each kept if its bar is prime)
    const lit = opt.grid ? [] : null;
    if (lit) for (let k = 0; k < N; k++) if (modes[k] === 'prime') { const line = opt.grid.perc?.[k] || ''; for (let u = 0; u < W; u++) if (line[u] && line[u] !== '.') lit.push(k * W + u); }
    prime = primePartition(spec, g, { p: opt.p ?? null, seed, hitsPerBar: opt.hitsPerBar, lit });
    const accentOf = (cell) => (opt.grid ? opt.grid.perc[Math.floor(cell / W)][cell % W] === 'X' : cell === prime.selected[0]);
    for (const x of prime.silent) if (modes[Math.floor(x.cell / W)] === 'prime') { stats.silent++; silentCells.push({ bar: Math.floor(x.cell / W), voice: 'perc', place: x.cell % W }); }
    for (const { cell, light, tick } of prime.struck) {
      if (modes[Math.floor(cell / W)] !== 'prime') continue;
      const L1 = prime.lights[light].tick === tick ? prime.lights[light] : placeOf(g, g.relOf(tick));
      push({ voice: 'perc', bar: L1.bar, pos: L1.pos, slot: L1.slot, tick, velocity: DRUM_VELOCITY.perc + (accentOf(cell) ? (opt.grid ? GRID_ACCENT.perc : ACCENT) : 0), snap: 'prime', cell, light });
    }
    const darkLanded = prime.struck.filter((x) => x.snap.startsWith('cell')).length, groups = prime.perCell.min === prime.perCell.max ? `${prime.perCell.min}` : `${prime.perCell.min}–${prime.perCell.max}`;
    decide('drums.prime', prime.p, `the two-level prime partition: level 1 lights ${prime.p} even places of the cycle from the downbeat, each landed on its nearest onset${prime.drawn ? ` (p a seeded random prime above the ${prime.cells} cells, one of the ${prime.range.primes} in ${prime.cells + 1}–${prime.range.upTo})` : ' (p asked)'}; level 2 chooses ${prime.cells} of them by Partitions' own distribution (E(${prime.cells}, ${prime.p}) from the downbeat), a cell each (${groups} light${prime.perCell.max === 1 ? '' : 's'} a cell), ${opt.grid ? `${prime.hits} lit by the grid's perc row` : prime.hits === prime.cells ? 'every cell lit' : `${prime.hits} lit by Partitions' secondary pattern E(${prime.hits}, ${prime.cells}) from the downbeat`}, each striking its light on the perc${darkLanded ? ` (${darkLanded} dark light${darkLanded === 1 ? '' : 's'} landed within ${darkLanded === 1 ? 'its cell' : 'their cells'})` : ''}${prime.silent.length ? `; ${prime.silent.length} lit cell${prime.silent.length === 1 ? '' : 's'} silent (${prime.silent[0].why})` : ''}`);
  }
  decide('drums.kit', { ...opt.kit }, DRUM_VOICES.some((v) => opt.kit[v] !== DEFAULT_KIT[v]) ? 'asked' : 'the made kit of Audio/drums (chunk-tunes\' strokes)');
  const seedsAgainst = opt.mode === 'against' || Object.values(opt.perBar).includes('against'), seedsPrime = !!prime?.drawn;
  if (seedsAgainst || seedsPrime) decide('drums.seed', seed, `the seed ${seedsAgainst ? `orders the empty slots \`against\` fills${seedsPrime ? ' and ' : ''}` : ''}${seedsPrime ? 'draws the prime partition\'s p' : ''} (a generator of its own: Compose's draws do not move)`);

  // ── one stroke a voice an onset (the louder kept), in time order ──
  const keep = new Map();
  for (const x of hits) { const key = `${x.voice}:${x.tick}`, had = keep.get(key); if (!had || x.velocity > had.velocity + EPS) keep.set(key, x); }
  const order = Object.fromEntries(DRUM_VOICES.map((v, i) => [v, i]));
  const out = [...keep.values()].sort((a, b) => a.time - b.time || order[a.voice] - order[b.voice]);
  const perVoice = Object.fromEntries(DRUM_VOICES.map((v) => [v, out.filter((x) => x.voice === v).length]));
  return {
    version: COMPOSER_DRUMS_VERSION, enabled: !!opt.enabled, mode: opt.mode,
    options: { ...opt, seed, kit: { ...opt.kit }, perBar: { ...opt.perBar }, ...(opt.grid ? { grid: readGrid(opt.grid) } : {}) }, kit: { ...opt.kit },
    beats: { slotsPerBar: S, subdivide: m, sizes: beats.sizes, positions: beats.pos },
    partition: partition && { layer: partition.name, value: partition.value, from: partition.from, hits: partition.hits, candidates: partition.candidates },
    bars, hits: out, decisions,
    stats: { hits: perVoice, total: out.length, wide: stats.wide, silent: stats.silent, merged: hits.length - out.length },
    ...(usesGrid || usesPrime ? { silentCells } : {}),
    ...(prime ? { prime } : {}),
  };
}
