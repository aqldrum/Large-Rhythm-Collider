// superrow.js — many rhythms of ONE grid laid on one tone row (a SUPERROW), shaped as a Composer row so compose()
// can take it whole (compose(layers, T, { row })). Built for Cosmos's Grid-card Compose (2026-10-22 night, sprint).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker (superrow-worker.js) and Node.
//
// Where it comes from: Overworld's chunk-super-row.js lays every rhythm of a chunk on one row, each onset keeping its
// OWN tone (its rhythm's longest gap / that gap; the combined row's gaps are never read). In a Cosmos bloom every
// rhythm has lcm(layers) = G (grid-core.js shardGroups), so the common cycle is G itself and every position is an exact
// integer tick in [0, G). G < 2^24 (the Hilbert cube), far under row.js' 2^53 gate. (Survey: Cosmos/docs/
// composition-survey-2026-10-22/REPORT.md, Part 2.)
//
//   node       a distinct (tick, tone) pair (proposed, the survey's `tone` rule): every onset of every admitted rhythm,
//              merged when two share both tick and tone. Kept in tick order, then by tone (cents), as row.js keeps a row.
//   strikes    the merged layer strikes, SUMMED and saturated at 255 (row.js' Uint8Array) — the planner's default,
//              proposed. 'log2' (1 + ⌊log2 sum⌋) is the alternative the survey raised: summed strikes pin compose's
//              comping accent (0.1 × (strikes − 1), velocity clamped at 1) at the top on a wide superrow. ⚑ Avery.
//   octave     the lowest merged register.
//   layers     the pulses: the ≤ 4 layer values most admitted rhythms use (ties: first met in the admission order). A
//              value v strikes at k·G/v in EVERY rhythm of G that uses it, so `owners` bit b is set where pulse b
//              strikes. These are what compose's comping and the drums' partition light read. One admitted rhythm: its
//              own layers, active and owners exactly, so a one-rhythm superrow IS that rhythm's row (field for field).
//   window     a fill over a given order (the caller's: Cosmos orders a bloom's rhythms nearest the focus first):
//              walk it, skip a rhythm over the Composer's gate by itself, or over the budget by itself (a rhythm's own
//              onsets are distinct ticks, so it alone is that many nodes), or one that would not fit the room left
//              (exactly: only its NEW (tick, tone) pairs count), or one past the source budget; admit the rest.
//              `fitted` of `visible` is the barometer. A work cap bounds the rhythms examined, so a monster grid stays
//              bounded; rhythms past it are `unreached`.
//   sources    node → its (rhythm, onset) members, as CSR arrays (start[n + 1], rhythm[], onset[]): the dust a node is
//              made of, for the Cosmos animation (E2).
//
// The budget defaults are the survey's (proposed): Θ = 65,536 nodes, Σ ≤ 2^21 source onsets, the Composer's own gate
// (row.js ONSET_GATE, 1,048,576) as the hard ceiling. Cosmos picks Θ by quality tier (cosmos-quality.js composeBudget).

import { buildRow, onsetCount, siteFraction, COMPOSER_ROW_VERSION, ONSET_GATE, MAX_LAYERS } from './row.js';
import { BEATS_PER_BAR, BAR_CHOICES, SLOT_CHOICES, MIN_ONSETS_PER_SLOT } from './compose.js';

export const SUPERROW_VERSION = 'composer-superrow-v1';
export const DEFAULT_BUDGET = 65536;
export const DEFAULT_SOURCE_BUDGET = 2097152;   // 2^21 source onsets: ≈ 0.7 s of build at the survey's 0.3 µs an onset
export const DEFAULT_WORK_CAP = 8388608;        // 2^23 onsets examined at most (admitted or tested), then `unreached`
export const STRIKE_RULES = Object.freeze(['sum', 'log2']);
export const DEFAULT_TEMPO_BPM = 110;

const TONE_SHIFT = 2 ** 29;   // key = tick × 2^29 + tone id: tick < 2^24 and ids < 2^29 keep it an exact double
const fail = (what) => { throw new Error(`composer/superrow: ${what}`); };
const centsCompare = (a, b) => a.c - b.c || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0);   // row.js' tone order

/** indices 0..n-1 sorted by a distance each (ascending, ties by index): the near-focus order */
export function orderByDistance(dist, n = dist ? dist.length : 0) {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (!dist) return idx;
  return idx.sort((a, b) => dist[a] - dist[b] || a - b);
}

/**
 * The superrow of `rhythms` (layer arrays, each as row.js reads one), windowed.
 *   order        indices into rhythms, the admission order (default: as given)
 *   grid         the common grid G (default: the first admitted rhythm's); a rhythm of another grid is `offGrid`
 *   budget       Θ, the most nodes (default 65,536; never past `gate`)
 *   sourceBudget the most source onsets admitted (default 2^21)
 *   gate         a rhythm over this many onsets is skipped by itself (default row.js ONSET_GATE)
 *   workCap      the most onsets examined, admitted or tested (default 2^23)
 *   strikes      'sum' (default) | 'log2'
 *   sources      false: no node → member arrays
 * → { version, row (a Composer row, or null when nothing fits), window, sources }
 *   window = { visible, fitted, picked: [rhythm index], whole, nodes, sourceOnsets, tones, grid,
 *              skipped: { alone, budget, room, source, unsupported, offGrid, unreached } }
 */
export function buildSuperrow(rhythms, { order = null, grid = null, budget = DEFAULT_BUDGET, sourceBudget = DEFAULT_SOURCE_BUDGET, gate = ONSET_GATE, workCap = DEFAULT_WORK_CAP, strikes: strikeRule = 'sum', sources: withSources = true } = {}) {
  if (!Array.isArray(rhythms)) fail('rhythms must be a list of layer arrays');
  if (!STRIKE_RULES.includes(strikeRule)) fail(`strikes must be one of ${STRIKE_RULES.join(', ')}`);
  const visible = rhythms.length, walk = order ?? rhythms.map((_, i) => i);
  const cap = Math.min(budget, gate);
  let G = grid;
  const skipped = { alone: 0, budget: 0, room: 0, source: 0, unsupported: 0, offGrid: 0, unreached: 0 };
  // tones met so far: fraction → provisional id; their cents (row.js' rounding, read off each rhythm's row)
  const toneIdOf = new Map(), toneList = [];
  // nodes so far, by key; their fields as growable arrays (merged in place)
  const nodeOf = new Map(), nTick = [], nTone = [], nOct = [], nStk = [];
  const mNode = [], mRhythm = [], mOnset = [];   // one entry per admitted source onset
  const picked = [], pulseUse = new Map();
  let sourceOnsets = 0, work = 0, soleRow = null;

  for (const r of walk) {
    const layers = rhythms[r];
    let n;
    try { n = onsetCount(layers); } catch { skipped.unsupported++; continue; }
    if (n > gate) { skipped.alone++; continue; }
    if (n > cap) { skipped.budget++; continue; }
    if (sourceOnsets + n > sourceBudget) { skipped.source++; continue; }
    if (work + n > workCap) { skipped.unreached++; continue; }
    const row = buildRow(layers, { gate });
    work += n;
    if (G == null) G = row.grid;
    else if (row.grid !== G) { skipped.offGrid++; continue; }
    const ids = row.tones.map((f) => toneIdOf.get(f) ?? -1);
    const room = cap - nTick.length;
    if (n > room) {   // may still fit: only its new (tick, tone) pairs take room
      let fresh = 0;
      for (let i = 0; i < row.n && fresh <= room; i++) { const t = ids[row.tone[i]]; if (t < 0 || !nodeOf.has(row.tick[i] * TONE_SHIFT + t)) fresh++; }
      if (fresh > room) { skipped.room++; continue; }
    }
    // admitted
    for (let t = 0; t < ids.length; t++) if (ids[t] < 0) { ids[t] = toneList.length; toneIdOf.set(row.tones[t], ids[t]); toneList.push({ f: row.tones[t], c: row.toneCents[t] }); }
    for (let i = 0; i < row.n; i++) {
      const key = row.tick[i] * TONE_SHIFT + ids[row.tone[i]];
      let k = nodeOf.get(key);
      if (k === undefined) { k = nTick.length; nodeOf.set(key, k); nTick.push(row.tick[i]); nTone.push(ids[row.tone[i]]); nOct.push(row.octave[i]); nStk.push(row.strikes[i]); }
      else { nStk[k] += row.strikes[i]; if (row.octave[i] < nOct[k]) nOct[k] = row.octave[i]; }
      if (withSources) { mNode.push(k); mRhythm.push(r); mOnset.push(i); }
    }
    for (const v of new Set(row.active.map((b) => row.layers[b]))) pulseUse.set(v, (pulseUse.get(v) || 0) + 1);
    soleRow = picked.length ? null : row;
    picked.push(r); sourceOnsets += n;
  }

  const n = nTick.length;
  const window = { visible, fitted: picked.length, picked, whole: picked.length === visible && visible > 0, nodes: n, sourceOnsets, tones: toneList.length, grid: G, skipped };
  if (!n) return { version: SUPERROW_VERSION, row: null, window, sources: null };

  // ── the tones, by cents then spelling (row.js), and the nodes by tick then tone ──
  const tuned = toneList.map((t, id) => ({ ...t, id })).sort(centsCompare);
  const remap = new Uint32Array(toneList.length); tuned.forEach((t, i) => { remap[t.id] = i; });
  const order2 = Array.from({ length: n }, (_, i) => i).sort((a, b) => nTick[a] - nTick[b] || remap[nTone[a]] - remap[nTone[b]]);
  const finalOf = new Uint32Array(n); order2.forEach((k, i) => { finalOf[k] = i; });
  const tick = new Float64Array(n), x = new Float64Array(n), gap = new Float64Array(n), tone = new Uint32Array(n);
  const octave = new Uint8Array(n), strikes = new Uint8Array(n), owners = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = order2[i];
    tick[i] = nTick[k]; x[i] = tick[i] / G; tone[i] = remap[nTone[k]]; octave[i] = nOct[k];
    const s = nStk[k];
    strikes[i] = Math.min(255, strikeRule === 'log2' ? 1 + Math.floor(Math.log2(Math.max(1, s))) : s);
  }
  let longest = 0;
  for (let i = 0; i < n; i++) { gap[i] = (i + 1 < n ? tick[i + 1] : G + tick[0]) - tick[i]; if (gap[i] > longest) longest = gap[i]; }
  let layers, active;
  if (soleRow) { layers = [...soleRow.layers]; active = [...soleRow.active]; owners.set(soleRow.owners); }
  else {
    const order3 = [...pulseUse.keys()];   // Map keeps first-met order: the tie-break
    const pulses = order3.map((v, i) => ({ v, i, use: pulseUse.get(v) })).sort((a, b) => b.use - a.use || a.i - b.i).slice(0, MAX_LAYERS).map((p) => p.v);
    layers = pulses; active = pulses.map((_, b) => b);
    const steps = pulses.map((v) => G / v);
    for (let i = 0; i < n; i++) { let m = 0; for (let b = 0; b < steps.length; b++) if (tick[i] % steps[b] === 0) m |= 1 << b; owners[i] = m; }
  }
  const T = tuned.length, toneCount = new Uint32Array(T), toneFirst = new Int32Array(T).fill(-1);
  for (let i = 0; i < n; i++) { toneCount[tone[i]]++; if (toneFirst[tone[i]] < 0) toneFirst[tone[i]] = i; }
  const row = {
    version: COMPOSER_ROW_VERSION, layers, active, grid: G, n, longest,
    tick, x, gap, tone, octave, owners, strikes,
    tones: tuned.map((t) => t.f), toneCents: Float64Array.from(tuned, (t) => t.c), toneCount, toneFirst,
  };
  // row.js' lazy spelling, the same expression
  let labels = null;
  Object.defineProperty(row, 'toneLabels', { enumerable: true, get: () => (labels ??= tuned.map((t) => { const [a, b] = t.f.split('/').map(Number); return siteFraction(a / b, [a, b]); })) });

  let src = null;
  if (withSources) {
    const m = mNode.length, start = new Uint32Array(n + 1), rhythm = new Uint32Array(m), onset = new Uint32Array(m);
    for (let j = 0; j < m; j++) start[finalOf[mNode[j]] + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const at = start.slice(0, n);
    for (let j = 0; j < m; j++) { const i = finalOf[mNode[j]], w = at[i]++; rhythm[w] = mRhythm[j]; onset[w] = mOnset[j]; }
    src = { start, rhythm, onset };
  }
  return { version: SUPERROW_VERSION, row, window, sources: src };
}

/** layer arrays → a flat Uint32Array, `width` a rhythm, 0 = absent (what superrow-worker.js takes: one transfer) */
export function flattenLayers(rhythms, width = MAX_LAYERS) {
  const flat = new Uint32Array(rhythms.length * width);
  rhythms.forEach((l, r) => { for (let j = 0; j < Math.min(width, l.length); j++) flat[r * width + j] = l[j]; });
  return flat;
}
/** the flat layers back to layer arrays (zeros dropped) */
export function unflattenLayers(flat, width = MAX_LAYERS) {
  const out = [];
  for (let r = 0; r < flat.length / width; r++) {
    const l = []; for (let j = 0; j < width; j++) { const v = flat[r * width + j]; if (v) l.push(v); }
    out.push(l);
  }
  return out;
}

/** the members of superrow node i: [{ rhythm, onset }] */
export function membersOf(sources, i) {
  const out = [];
  for (let j = sources.start[i]; j < sources.start[i + 1]; j++) out.push({ rhythm: sources.rhythm[j], onset: sources.onset[j] });
  return out;
}

/**
 * The barometer: how much of what is visible fitted. → { fitted, visible, share, whole, tooDenseAlone, text }
 * (the text proposed: "the whole grid · 2,214 rhythms", or "705 of 24,615 rhythms (2.9 %)", then any skips over the
 * gate or the budget by themselves: "· 3 too dense to compose alone")
 */
export function barometer(window) {
  const { fitted = 0, visible = 0, whole = false, skipped = {} } = window || {};
  const share = visible ? fitted / visible : 0, tooDenseAlone = (skipped.alone || 0) + (skipped.budget || 0);
  const plural = (k, w) => `${k.toLocaleString('en-US')} ${w}${k === 1 ? '' : 's'}`;
  let text = whole ? `the whole grid · ${plural(fitted, 'rhythm')}`
    : `${fitted.toLocaleString('en-US')} of ${plural(visible, 'rhythm')} (${(share * 100).toFixed(share < 0.1 ? 1 : 0)} %)`;
  if (tooDenseAlone) text += ` · ${tooDenseAlone.toLocaleString('en-US')} too dense to compose alone`;
  return { fitted, visible, share, whole, tooDenseAlone, text };
}

/**
 * A cycle that puts the Composer's meter at `bpm` (110 by default, proposed): N bars of 4 beats in T = 60·N·4 / bpm
 * seconds, N the most of 8, 4, 2, 1 the row's n onsets hold without going sparse (n ≥ 3 onsets a slot at the fewest
 * slots compose.js lowers to, 3 a bar). compose.js' chooseMeter then lands on exactly N bars at `bpm`, since N/2 and
 * 2N bars fall outside its 90–130 range, and never halves N. → seconds
 */
export function cycleSecondsForTempo(n, { bpm = DEFAULT_TEMPO_BPM } = {}) {
  if (!(bpm > 0)) fail(`bpm must be positive, not ${bpm}`);
  const fewestSlots = SLOT_CHOICES[SLOT_CHOICES.length - 1];
  const bars = [...BAR_CHOICES].sort((a, b) => b - a).find((N) => n >= MIN_ONSETS_PER_SLOT * fewestSlots * N) ?? BAR_CHOICES[0];
  return (60 * bars * BEATS_PER_BAR) / bpm;
}
