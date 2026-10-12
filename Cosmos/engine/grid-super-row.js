// grid-super-row.js — one grid's rhythms laid on one row: the grid super-row.
//
// PURE: no DOM, no fetch, no wall clock. Browser, worker and Node.
//
// MacroTonal's chunk-tunes miner (econ/runtime/chunk-super-row.js) lays the rhythms of a map chunk on one row, each
// node keeping the tone of the gap that follows it in its own rhythm. On a Cosmos grid G every rhythm already shares
// one cycle (lcm = G), so the grid's rhythms need no stretching: a node at tick t sits at t/G. The row built here has
// chunk-super-row's `normalized` shape (x, num, rhythm, node, tone, octave, owners, moment, moments, rhythms, cycles,
// tones, toneCents), so the miner's slotCandidates / mineLines / mineAll read it unchanged. A rhythm stands where the
// chunk row has a village: `villageId` is the rhythm's codex key.
//
// SOURCES — which rhythms of G go on the row:
//   keep2    every kept rhythm: per (fundamental | ratioSet) the min and max layer-sum instance (gridResults, the codex).
//   owners   one rhythm per folded ratio, its lowest layer-sum owner — the set the Cull2 grid overlay already plays
//            (cull2-grid-core.js), the thinnest cover of the grid's tones.
//   maximal  one rhythm: every proper divisor that divides no other — the layers G/p for each prime p | G. Its onsets
//            are every tick t with gcd(t, G) > 1, G − φ(G) of them: the densest row G has. Its layers share the factor
//            G/rad(G), so unless G is squarefree it is the rad(G) rhythm repeated, not a codex rhythm.
//   onsets   one valid rhythm (lcm G, gcd 1, no layer dividing another, ANY number of layers) with the most onsets.
//   layers   one valid rhythm with the most layers.
//   `onsets` and `layers` drop keep-2's four-layer bound. Onset sets nest: owners ⊆ keep2 ⊆ maximal, and
//   |keep2| ≤ |onsets| ≤ |maximal| (a kept set's layers, made irredundant, are themselves a valid rhythm).
//
// TONES — two readings of one row:
//   native    a node keeps its own rhythm's tone (chunk-super-row's rule: the row re-tunes nothing).
//   respaced  the row's own composite read as one rhythm: a tick's tone is fold(longest gap / its gap) over the union
//             of every source's onsets, and every node at that tick shares it. The union of composites is the
//             composite of the union of layers, so a respaced keep2 row is the scale of ONE rhythm — every layer the
//             kept set uses. For a single-rhythm source the two readings coincide.
//
// Search for `onsets` / `layers` works on STEPS s = G/L (a layer of G strikes every s ticks). A tick t is struck by
// some step of S exactly when gcd(t, G) is a multiple of one, so with c(d) = φ(G/d) ticks having gcd(t, G) = d,
//   onsets(S) = Σ over divisors d of G that some s ∈ S divides of φ(G/d)
// — exact, with no tick walked. Validity in steps: gcd(steps) = 1 ⟺ lcm(layers) = G; lcm(steps) = G ⟺ gcd(layers) = 1.
import { decimalToFraction, gcd2 } from './oracle-core.js?v=3';
import { divisorsFast, gridResults, gridRatioOwnerSolve, directFactorRedundant } from './grid-core.js?v=6';

export const GRID_SUPER_ROW_VERSION = 'grid-super-row-v1';
export const SOURCE_MODES = Object.freeze(['keep2', 'owners', 'maximal', 'onsets', 'layers']);
export const TONE_MODES = Object.freeze(['native', 'respaced']);
/** owners is a bit mask per node, as chunk-super-row's; a rhythm of more layers cannot be laid */
export const MAX_ROW_LAYERS = 32;
/** nodes on one row (Σ over its rhythms of their onsets) — past this the row is refused, not truncated */
export const MAX_ROW_NODES = 4_000_000;
/** search nodes for `onsets` / `layers` before the best so far is returned marked inexact */
export const SEARCH_BUDGET = 2_000_000;

const mod = (v, n) => ((v % n) + n) % n;
const lcm2 = (a, b) => (a / gcd2(a, b)) * b;
const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; };

/** chunk-tunes.js toneCents: a ratio's cents folded into [0, 1200) */
export function toneCents(fraction) {
  const [n, d] = String(fraction).split('/').map(Number);
  return mod(1200 * Math.log2(n / d), 1200);
}

export function factorize(G) {
  const f = []; let n = G;
  for (let p = 2; p * p <= n; p++) { if (n % p) continue; let e = 0; while (n % p === 0) { n /= p; e++; } f.push([p, e]); }
  if (n > 1) f.push([n, 1]);
  return f;
}
function totient(n) { let r = n; for (const [p] of factorize(n)) r = (r / p) * (p - 1); return r; }

/** layers ascending, codex-valid on G: ≥2 layers, each a divisor in [2, G), lcm G, gcd 1, none dividing another */
export function isValidOnGrid(G, layers) {
  if (layers.length < 2 || layers.some((L) => !Number.isSafeInteger(L) || L < 2 || L >= G || G % L)) return false;
  return layers.reduce(lcm2) === G && layers.reduce(gcd2) === 1 && !directFactorRedundant(layers);
}

/** onsets of a layer set on G, by divisor classes (header); ticks are never walked */
export function onsetCount(G, layers, divisors = divisorsFast(G)) {
  const steps = layers.map((L) => G / L);
  let n = 0;
  for (const d of divisors) if (steps.some((s) => d % s === 0)) n += totient(G / d);
  return n;
}

const layerSum = (layers) => layers.reduce((a, b) => a + b, 0);
const describe = (layers, role) => ({ key: [...layers].sort((a, b) => b - a).join('.'), role, layers: [...layers].sort((a, b) => a - b) });

// ── the extremal rhythms ─────────────────────────────────────────────────────────────────────────────────────────────

/** layers G/p; null when G has one prime (one layer is no polyrhythm). `period` is rad(G): the row repeats G/rad(G) times. */
export function maximalLayers(G) {
  const f = factorize(G);
  if (f.length < 2) return null;
  const rad = f.reduce((r, [p]) => r * p, 1);
  return { layers: f.map(([p]) => G / p).sort((a, b) => a - b), valid: rad === G, period: rad };
}

/**
 * Branch-and-bound over antichains of steps, ascending. `objective` 'onsets' | 'layers'. Ties: onsets → fewer layers →
 * smaller layer sum; layers → more onsets → smaller layer sum. → { layers, onsets, exact, visited } or null if none.
 */
function searchExtremal(G, objective, { maxRange = Infinity, budget = SEARCH_BUDGET } = {}) {
  const divisors = divisorsFast(G);
  const steps = divisors.filter((d) => d > 1 && d < G);
  const weight = divisors.map((d) => totient(G / d));
  const idx = new Map(divisors.map((d, i) => [d, i]));
  const coverOf = steps.map((s) => divisors.filter((d) => d % s === 0).map((d) => idx.get(d)));
  const covered = new Uint16Array(divisors.length);   // how many chosen steps cover each class
  const chosen = [];
  let coveredWeight = 0, best = null, visited = 0, exact = true;

  const score = () => {
    const layers = chosen.map((s) => G / s).sort((a, b) => a - b);
    return { layers, onsets: coveredWeight, sum: layerSum(layers) };
  };
  const better = (c, b) => {
    if (!b) return true;
    if (objective === 'onsets') return c.onsets !== b.onsets ? c.onsets > b.onsets : c.layers.length !== b.layers.length ? c.layers.length < b.layers.length : c.sum < b.sum;
    return c.layers.length !== b.layers.length ? c.layers.length > b.layers.length : c.onsets !== b.onsets ? c.onsets > b.onsets : c.sum < b.sum;
  };
  const feasible = () => {
    if (chosen.length < 2) return false;
    let g = 0, l = 1;
    for (const s of chosen) { g = gcd2(g, s); l = lcm2(l, s); }
    return g === 1 && l === G;
  };
  const allowed = (s) => {
    if (chosen.length && s > maxRange * chosen[0]) return false;   // range = largest layer / smallest = largest step / smallest
    for (const c of chosen) if (s % c === 0) return false;          // ascending: only a chosen step can divide s
    return true;
  };
  const bound = (from) => {
    if (objective === 'onsets') {
      let b = coveredWeight;
      for (let j = 0; j < divisors.length; j++) if (!covered[j] && divisors[j] >= steps[from]) b += weight[j];
      return b;
    }
    let b = chosen.length;
    for (let j = from; j < steps.length; j++) if (allowed(steps[j])) b++;
    return b;
  };
  const beaten = (from) => {
    if (!best) return false;
    const b = bound(from);
    return objective === 'onsets' ? b < best.onsets : b < best.layers.length;
  };
  const rec = (from) => {
    if (++visited > budget) { exact = false; return; }
    if (feasible()) { const c = score(); if (better(c, best)) best = c; }
    if (from >= steps.length || beaten(from)) return;
    for (let i = from; i < steps.length; i++) {
      if (!exact) return;
      const s = steps[i];
      if (!allowed(s)) continue;
      if (beaten(i)) return;
      chosen.push(s);
      for (const j of coverOf[i]) if (covered[j]++ === 0) coveredWeight += weight[j];
      rec(i + 1);
      for (const j of coverOf[i]) if (--covered[j] === 0) coveredWeight -= weight[j];
      chosen.pop();
    }
  };
  rec(0);
  return best ? { layers: best.layers, onsets: best.onsets, exact, visited } : { layers: null, onsets: 0, exact, visited };
}

/**
 * The widest valid antichain. When the dominant prime exponent a is at most Ω(G)/2 the answer is a middle rank of the
 * divisor lattice (Sperner: no antichain is larger, and rank r is valid exactly when a ≤ r ≤ Ω − a), so no search
 * runs. Otherwise — or when a range cap rules the level out — it falls to the search.
 */
export function maxLayerRhythm(G, { maxRange = Infinity, budget } = {}) {
  const f = factorize(G), omega = f.reduce((s, [, e]) => s + e, 0), a = Math.max(0, ...f.map(([, e]) => e));
  if (f.length >= 2 && a <= omega / 2) {
    const divisors = divisorsFast(G), rank = (d) => { let r = 0; for (const [p] of f) while (d % p === 0) { d /= p; r++; } return r; };
    let pick = null;
    for (let r = a; r <= omega - a; r++) {
      const level = divisors.filter((d) => rank(d) === r);
      const layers = level.map((s) => G / s).sort((x, y) => x - y);
      if (layers[layers.length - 1] / layers[0] > maxRange) continue;
      const c = { layers, onsets: onsetCount(G, layers, divisors), sum: layerSum(layers) };
      if (!pick || c.layers.length > pick.layers.length || (c.layers.length === pick.layers.length && (c.onsets > pick.onsets || (c.onsets === pick.onsets && c.sum < pick.sum)))) pick = c;
    }
    if (pick && maxRange === Infinity) return { layers: pick.layers, onsets: pick.onsets, exact: true, visited: 0, by: 'level' };
  }
  return { ...searchExtremal(G, 'layers', { maxRange, budget }), by: 'search' };
}

export function maxOnsetRhythm(G, opts = {}) {
  return { ...searchExtremal(G, 'onsets', opts), by: 'search' };
}

// ── sources ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** → { grid, mode, sources: [{ key, role, layers (ascending) }], exact, note } */
export function gridSuperRowSources(G, mode = 'keep2', { maxRange = Infinity, budget } = {}) {
  if (!Number.isSafeInteger(G) || G < 2) throw new Error(`grid-super-row: bad grid ${G}`);
  if (mode === 'keep2') {
    const solved = gridResults(G, { rangeCap: maxRange });
    if (solved.tooLarge) throw new Error(`grid-super-row: grid ${G} has ${solved.divisorCount} divisors, past gridResults' cap`);
    const sources = solved.kept.map((s) => describe(s.layers, s.role)).sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
    return { grid: G, mode, sources, exact: true, note: `${solved.tuningSystems} tuning systems, ${solved.keptCount} kept of ${solved.validCount} valid` };
  }
  if (mode === 'owners') {
    const solved = gridRatioOwnerSolve(G);
    if (solved.tooLarge) throw new Error(`grid-super-row: grid ${G} is past the ratio-owner solve's cap`);
    const byKey = new Map();
    for (const o of solved.ratioOwners) if (!byKey.has(o.key)) byKey.set(o.key, describe(o.layers, 'ratio owner'));
    const sources = [...byKey.values()].filter((s) => s.layers[s.layers.length - 1] / s.layers[0] <= maxRange).sort((p, q) => (p.key < q.key ? -1 : 1));
    return { grid: G, mode, sources, exact: true, note: `${solved.ratioOwners.length} ratios owned by ${sources.length} rhythms` };
  }
  if (mode === 'maximal') {
    const m = maximalLayers(G);
    if (!m) return { grid: G, mode, sources: [], exact: true, note: 'a prime power: one maximal divisor, no polyrhythm' };
    return { grid: G, mode, sources: [describe(m.layers, m.valid ? 'maximal' : 'maximal (scaled)')], exact: true,
      note: m.valid ? 'squarefree: a codex rhythm' : `not squarefree: the grid-${m.period} rhythm repeated ${G / m.period}×` };
  }
  if (mode === 'onsets' || mode === 'layers') {
    const r = mode === 'onsets' ? maxOnsetRhythm(G, { maxRange, budget }) : maxLayerRhythm(G, { maxRange, budget });
    if (!r.layers) return { grid: G, mode, sources: [], exact: r.exact, note: 'no valid rhythm' };
    return { grid: G, mode, sources: [describe(r.layers, mode === 'onsets' ? 'most onsets' : 'most layers')], exact: r.exact,
      note: `${r.by}${r.visited ? `, ${r.visited} search nodes` : ''}${r.exact ? '' : ' — budget spent, best found'}` };
  }
  throw new Error(`grid-super-row: unknown source mode ${mode}`);
}

// ── the row ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** fold(longest / gap) as the codex names it (oracle-core deriveRhythm), and its register: longest / gap = fold × 2^octave */
function toneOfGap(longest, gap) {
  let ratio = longest / gap;
  while (ratio >= 2) ratio /= 2;
  while (ratio < 1) ratio *= 2;
  let octave = 0; while (gap * 2 ** (octave + 1) <= longest) octave++;
  return { fraction: decimalToFraction(ratio), octave };
}

/** One rhythm's composite on G (layers ascending; bit b of `owners` is layers[b], as chunk-super-row's A, B, C, D). */
export function gridCycle(G, layers) {
  if (layers.length > MAX_ROW_LAYERS) throw new Error(`grid-super-row: ${layers.length} layers, past ${MAX_ROW_LAYERS}`);
  const at = new Map();
  layers.forEach((L, b) => { const step = G / L; for (let t = 0; t < G; t += step) at.set(t, (at.get(t) || 0) | (1 << b)); });
  const tick = Uint32Array.from([...at.keys()].sort((p, q) => p - q)), n = tick.length;
  const gap = new Uint32Array(n), owners = new Uint32Array(n), octave = new Int8Array(n), fractions = new Array(n);
  let longest = 0;
  for (let i = 0; i < n; i++) { gap[i] = (i + 1 < n ? tick[i + 1] : G + tick[0]) - tick[i]; if (gap[i] > longest) longest = gap[i]; owners[i] = at.get(tick[i]) >>> 0; }
  const byGap = new Map();
  for (let i = 0; i < n; i++) {
    let t = byGap.get(gap[i]); if (!t) byGap.set(gap[i], t = toneOfGap(longest, gap[i]));
    fractions[i] = t.fraction; octave[i] = t.octave;
  }
  return { layers: [...layers], grid: G, n, tick, gap, octave, owners, fractions };
}

/**
 * The grid super-row. `source` a mode (SOURCE_MODES) or an explicit { mode, sources } from gridSuperRowSources;
 * `tones` 'native' | 'respaced'. → a chunk-super-row-shaped normalized row, plus { grid, source, tonesMode, sourceNote }.
 */
export function buildGridSuperRow(G, { source = 'keep2', tones = 'native', maxRange = Infinity, budget, maxNodes = MAX_ROW_NODES } = {}) {
  if (!TONE_MODES.includes(tones)) throw new Error(`grid-super-row: unknown tone mode ${tones}`);
  const picked = typeof source === 'string' ? gridSuperRowSources(G, source, { maxRange, budget }) : source;
  if (!picked.sources.length) throw new Error(`grid-super-row: no rhythms for ${picked.mode} at grid ${G} (${picked.note})`);
  let estimate = 0; for (const s of picked.sources) estimate += layerSum(s.layers);
  if (estimate > maxNodes) throw new Error(`grid-super-row: up to ${estimate} nodes at grid ${G}, past ${maxNodes}`);

  const cycles = picked.sources.map((s) => gridCycle(G, s.layers));
  const rhythms = picked.sources.map((s, index) => ({ index, villageId: s.key, key: s.key, role: s.role, layers: [...s.layers], grid: G, nodes: cycles[index].n }));
  let n = 0; for (const c of cycles) n += c.n;

  // nodes ordered by (tick, rhythm): every position is t/G, so ordering ticks is ordering positions
  const order = new Uint32Array(n), tickOf = new Uint32Array(n), rhythmOf = new Uint32Array(n), nodeOf = new Uint32Array(n);
  for (let r = 0, k = 0; r < cycles.length; r++) for (let i = 0; i < cycles[r].n; i++, k++) { order[k] = k; tickOf[k] = cycles[r].tick[i]; rhythmOf[k] = r; nodeOf[k] = i; }
  order.sort((a, b) => tickOf[a] - tickOf[b] || rhythmOf[a] - rhythmOf[b]);

  const x = new Float64Array(n), num = new Uint32Array(n), rhythm = new Uint32Array(n), node = new Uint32Array(n);
  const owners = new Uint32Array(n), moment = new Uint32Array(n);
  const momentStart = [], momentStrikes = [], momentTick = [];
  for (let i = 0; i < n; i++) {
    const k = order[i], r = rhythmOf[k], at = nodeOf[k];
    num[i] = tickOf[k]; x[i] = num[i] / G; rhythm[i] = r; node[i] = at; owners[i] = cycles[r].owners[at];
    if (i === 0 || num[i] !== num[i - 1]) { momentStart.push(i); momentStrikes.push(0); momentTick.push(num[i]); }
    moment[i] = momentStart.length - 1; momentStrikes[moment[i]] += popcount(owners[i]);
  }
  const m = momentStart.length; momentStart.push(n);

  // tone of each node: its rhythm's own (native), or the row composite's (respaced)
  const fractionOf = new Array(n), octave = new Int8Array(n);
  let respaced = null;
  if (tones === 'native') {
    for (let i = 0; i < n; i++) { const c = cycles[rhythm[i]]; fractionOf[i] = c.fractions[node[i]]; octave[i] = c.octave[node[i]]; }
  } else {
    const gaps = new Uint32Array(m); let longest = 0;
    for (let j = 0; j < m; j++) { gaps[j] = (j + 1 < m ? momentTick[j + 1] : G + momentTick[0]) - momentTick[j]; if (gaps[j] > longest) longest = gaps[j]; }
    const byGap = new Map(), momentTone = new Array(m), momentOctave = new Int8Array(m);
    for (let j = 0; j < m; j++) { let t = byGap.get(gaps[j]); if (!t) byGap.set(gaps[j], t = toneOfGap(longest, gaps[j])); momentTone[j] = t.fraction; momentOctave[j] = t.octave; }
    for (let i = 0; i < n; i++) { fractionOf[i] = momentTone[moment[i]]; octave[i] = momentOctave[moment[i]]; }
    respaced = { gaps, longest };
  }
  const tuned = [...new Set(fractionOf)].map((f) => ({ f, c: toneCents(f) })).sort((a, b) => a.c - b.c || (a.f < b.f ? -1 : 1));
  const toneIndex = new Map(tuned.map((t, i) => [t.f, i]));
  const tone = Uint16Array.from(fractionOf, (f) => toneIndex.get(f));
  // a cycle's own tones, indexed into this row's table when it has them (native always; respaced only by coincidence)
  for (const c of cycles) c.tone = Uint16Array.from(c.fractions, (f) => (toneIndex.has(f) ? toneIndex.get(f) : 0xffff));

  return {
    version: GRID_SUPER_ROW_VERSION, kind: 'normalized', grid: G, source: picked.mode, tonesMode: tones, sourceNote: picked.note, exact: picked.exact,
    rhythms, cycles, tones: tuned.map((t) => t.f), toneCents: Float64Array.from(tuned, (t) => t.c),
    n, x, num, rhythm, node, tone, octave, owners, moment,
    moments: { n: m, start: Uint32Array.from(momentStart), strikes: Uint32Array.from(momentStrikes), tick: Uint32Array.from(momentTick) },
    ...(respaced ? { respaced } : {}),
  };
}

/** The numbers worth comparing across sources and tone readings. */
export function gridSuperRowSummary(row) {
  const layers = new Set(); for (const r of row.rhythms) for (const L of r.layers) layers.add(L);
  let maxStrikes = 0; for (const s of row.moments.strikes) if (s > maxStrikes) maxStrikes = s;
  const octaves = new Set(row.octave);
  return {
    grid: row.grid, source: row.source, tones: row.tonesMode, rhythms: row.rhythms.length, distinctLayers: layers.size,
    maxRhythmLayers: Math.max(...row.rhythms.map((r) => r.layers.length)), onsets: row.moments.n, nodes: row.n,
    density: row.moments.n / row.grid, toneCount: row.tones.length, octaves: octaves.size, maxStrikes, exact: row.exact,
  };
}
