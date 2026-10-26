// target.mjs — where in a row a 12EDO clip can be played: the probe's search.
//
// PURE: no fetch, no DOM, no clock.
//
// The unknowns, and how each is found (Composer/probe/midi-target/FINDINGS.md has the why):
//   ψ   the tuning lattice: a tone of the row whose cents, mod 100, centre the ±e frame. Only ψ decides which onsets
//       are in tune (frame.js `frameAt` is root-centred, and its `inside` depends on the root's cents mod 100 alone).
//       Candidates: the cluster representatives (frame.js), deduplicated by their cents mod 100, the ones whose frame
//       holds the most onsets first (`frameOnsetsByRoot`).
//   k   the transposition: clip pitch class m plays on lane (m + k) mod 12 of ψ's lattice. Found by the vote.
//   N   bars in the cycle (P = N·S slots, S the clip's steps per bar). N = B is the clip spread over the whole cycle;
//       a larger N puts it in a window of B of the N bars.
//   φ   the phase: where the clip's bar 0, step 0 falls on the cycle. Found by the vote.
//
// The vote (a Hough transform): for each N, each clip note j at step s_j, and each in-tune onset i at x_i on lane L,
// the onset says "note j can sound here if k = L − m_j and φ is within τ/P of x_i − s_j/P". Each (k, φ-bin) counts the
// notes that vote for it (a note once per bin), so a bin's count is how many notes find an in-tune onset of their class
// within τ of a slot for any φ in it (up to the bin's width). The peaks are refined exactly; the best are checked
// against the engine's own cells (`buildCells`, partitioned anchors) and root-centred frame (`frameAt`).
//
// Rests and note lengths are not searched: a rest is a slot the line leaves empty, whatever the row plays there, and a
// note's length is articulation (Compose's `articulate`), so only the note-ons must land on onsets.

import { buildCells, phaseAtTick } from '../../core/cells.js';
import { classOfCents, clusterPresence, frameOnsetsByRoot, frameAt, DEFAULT_FRAME_CENTS_EACH_SIDE } from '../../core/frame.js';

export const DEFAULTS = Object.freeze({
  e: DEFAULT_FRAME_CENTS_EACH_SIDE,   // the frame, ± cents
  tau: 0.5,          // a note's window either side of its slot's anchor, as a share of the slot (the engine's widest swing)
  tight: 0.25,       // a hit within this share of the slot is "tight"
  maxPsi: 12,        // lattices tried, most in-tune onsets first
  maxN: 256,         // bars in the cycle, at most…
  slotsPerOnset: 2,  // …and at most this many slots an onset of the row (P ≤ 2n)
  denseN: 64,        // every N up to here; past it N grows by `growN`
  growN: 1.15,
  peaksPerRun: 8,    // peaks refined per (ψ, N)
  keep: 40,          // placements kept overall
});

const mod = (v, n) => ((v % n) + n) % n;

/** the lattices: [{ tone, cents (mod 100), held (onsets the frame holds) }], best first, at most maxPsi */
export function latticesOf(row, { e = DEFAULTS.e, maxPsi = DEFAULTS.maxPsi } = {}) {
  const held = frameOnsetsByRoot(row, e), { representative, presence } = clusterPresence(row, e);
  const cands = [];
  for (let t = 0; t < row.tones.length; t++) if (representative[t]) cands.push({ tone: t, cents: mod(row.toneCents[t], 100), held: held[t], presence: presence[t] });
  cands.sort((a, b) => b.held - a.held || b.presence - a.presence || a.tone - b.tone);
  const out = [];
  for (const c of cands) {
    if (out.some((o) => Math.abs(mod(o.cents - c.cents + 50, 100) - 50) < 1)) continue;   // the same lattice within 1¢
    out.push(c);
    if (out.length >= maxPsi) break;
  }
  return out;
}

/** a lattice's in-tune onsets, by lane: lanes[L] = { x: Float64Array (sorted), node: Int32Array, dev: Float64Array }; plus count */
export function lanesOf(row, psiTone, e = DEFAULTS.e) {
  const rc = row.toneCents[psiTone], T = row.tones.length;
  const lane = new Int8Array(T).fill(-1), dev = new Float64Array(T);
  for (let t = 0; t < T; t++) { const c = classOfCents(row.toneCents[t] - rc); if (Math.abs(c.dev) <= e + 1e-9) { lane[t] = c.pc; dev[t] = c.dev; } }
  const buckets = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < row.n; i++) { const L = lane[row.tone[i]]; if (L >= 0) buckets[L].push(i); }   // row order = x order
  let count = 0;
  const lanes = buckets.map((b) => { count += b.length; return { x: Float64Array.from(b, (i) => row.x[i]), node: Int32Array.from(b), dev: Float64Array.from(b, (i) => dev[row.tone[i]]) }; });
  return { lanes, count, lane, dev };
}

/** where a placement sits: 'whole' (N = B, the clip over the whole cycle), 'near' (N ≤ 4B), 'window' (past that) */
export const bandOf = (N, B) => (N === B ? 'whole' : N <= 4 * B ? 'near' : 'window');

/** the N to try for a clip on a row */
export function barCounts(row, clip, o = {}) {
  const { maxN, slotsPerOnset, denseN, growN } = { ...DEFAULTS, ...o };
  const top = Math.max(clip.B, Math.min(maxN, Math.floor((slotsPerOnset * row.n) / clip.S)));
  const out = [];
  for (let N = clip.B; N <= top;) { out.push(N); N = N < denseN ? N + 1 : Math.max(N + 1, Math.round(N * growN)); }
  return out;
}

/** the first index in sorted xs with xs[i] ≥ v */
function lowerBound(xs, v) { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; }

/**
 * Exact: each note's best in-tune onset of its lane within τ/P of its anchor (φ + s/P), even anchors. The cost of a
 * hit is |offset| in slots + 0.5·|dev|/e. → { hits, tightHits, cost, offsets (slots, signed; null for a miss), picks }
 */
export function evaluate(lanes, clip, k, P, phi, { tau = DEFAULTS.tau, tight = DEFAULTS.tight, e = DEFAULTS.e } = {}) {
  let hits = 0, tightHits = 0, cost = 0;
  const offsets = [], picks = [];
  for (const n of clip.notes) {
    const L = mod(n.pc + k, 12), { x, node, dev } = lanes[L], a = mod(phi + n.step / P, 1), r = tau / P;
    let best = -1, bestCost = Infinity, bestOff = 0;
    const scan = (from, to, shift) => {   // onsets with x in [from, to), their offset measured as x + shift − a
      for (let i = lowerBound(x, from); i < x.length && x[i] <= to; i++) {
        const off = (x[i] + shift - a) * P;
        if (Math.abs(off) > tau + 1e-12) continue;
        const c = Math.abs(off) + 0.5 * Math.abs(dev[i]) / (e || 1);
        if (c < bestCost) { bestCost = c; best = i; bestOff = off; }
      }
    };
    scan(a - r, a + r, 0);
    if (a - r < 0) scan(a - r + 1, 1, -1);
    if (a + r >= 1) scan(0, a + r - 1, 1);
    if (best < 0) { offsets.push(null); picks.push(null); continue; }
    hits++; if (Math.abs(bestOff) <= tight + 1e-12) tightHits++;
    cost += bestCost; offsets.push(bestOff); picks.push({ node: node[best], lane: L, dev: dev[best], off: bestOff });
  }
  return { hits, tightHits, cost, offsets, picks };
}

const better = (a, b) => !b || a.hits > b.hits || (a.hits === b.hits && (a.tightHits > b.tightHits || (a.tightHits === b.tightHits && a.cost < b.cost - 1e-12)));

/**
 * A vote peak, refined. A bin's count is an upper bound (a note counts if its interval touches any part of the bin),
 * and the φ where they all meet can be a sliver of it, so the hit count is evaluated just inside every interval end
 * that falls in the bin (and the bins either side): the exact best in the neighbourhood. Then φ is centred among its hits.
 */
function refine(lanes, clip, k, P, phi, w, o) {
  const r = o.tau / P, eps = 1e-9 / P, lo = phi - 1.5 * w, hi = phi + 1.5 * w;
  const tries = new Set([phi]);
  for (const n of clip.notes) {
    const { x } = lanes[mod(n.pc + k, 12)], s = n.step / P;
    for (const shift of [-1, 0, 1]) {   // the interval ends c ± r, c = x − s (+ a lap), that fall in [lo, hi]
      const from = lowerBound(x, lo + s - shift - r - 1e-12);
      for (let i = from; i < x.length; i++) {
        const c = x[i] - s + shift;
        if (c - r > hi) break;
        if (c - r >= lo) tries.add(c - r + eps);
        if (c + r >= lo && c + r <= hi) tries.add(c + r - eps);
      }
    }
  }
  let best = null;
  for (const t of tries) { const f = mod(t, 1), p = { ...evaluate(lanes, clip, k, P, f, o), phi: f }; if (better(p, best)) best = p; }
  // centre φ in the region where every hit stays a hit (the hits' intervals meet in [max c − r, min c + r]): the
  // worst timing error is then as small as it can be, and no hit sits on a window's edge for a tick's rounding to lose
  const offs = best.offsets.filter((v) => v != null);
  if (offs.length) {
    const phi2 = mod(best.phi + (Math.max(...offs) + Math.min(...offs)) / (2 * P), 1);
    const next = { ...evaluate(lanes, clip, k, P, phi2, o), phi: phi2 };
    if (next.hits >= best.hits) best = next;
  }
  return best;
}

/**
 * The search. → { lattices, barCounts, placements (best first, at most `keep`): [{ psi, psiTone, k, N, P, phi, hits,
 *   tightHits, cost, offsets, picks }], bands ({ whole, near, window }: each band's best), fullFits (distinct (ψ, k, N, peak) with every note hit), votes (increments),
 *   ms }
 */
export function search(row, clip, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, t0 = performance.now();
  const lattices = latticesOf(row, o), Ns = barCounts(row, clip, o), J = clip.notes.length;
  const placements = [], bands = {};
  let fullFits = 0, votes = 0, nearFits = 0;
  const offer = (p) => {
    const band = bandOf(p.N, clip.B);
    if (better(p, bands[band])) bands[band] = p;
    if (placements.length >= o.keep && !better(p, placements[placements.length - 1])) return;
    placements.push(p); placements.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    if (placements.length > o.keep) placements.pop();
  };
  const steps = Int32Array.from(clip.notes, (n) => n.step), pcs = Int8Array.from(clip.notes, (n) => n.pc);
  for (let li = 0; li < lattices.length; li++) {
    const { lanes } = lanesOf(row, lattices[li].tone, o.e);
    for (const N of Ns) {
      const P = N * clip.S, Bn = Math.ceil((2 * P) / o.tau) * 2, w = 1 / Bn, r = o.tau / P;   // bins a quarter of τ/P wide
      const count = new Uint16Array(12 * Bn), stamp = new Int32Array(12 * Bn).fill(-1);
      for (let j = 0; j < J; j++) {
        const s = steps[j] / P;
        for (let L = 0; L < 12; L++) {
          const k = mod(L - pcs[j], 12), base = k * Bn, { x } = lanes[L];
          for (let i = 0; i < x.length; i++) {
            const c = x[i] - s, lo = Math.floor((c - r) / w), hi = Math.floor((c + r) / w);
            for (let b = lo; b <= hi; b++) { const at = base + mod(b, Bn); if (stamp[at] !== j) { stamp[at] = j; count[at]++; } votes++; }
          }
        }
      }
      // peaks: the highest bins, at most peaksPerRun, none within 2 bins of a taken one on the same k
      const order = [];
      let floor = 0;
      for (let at = 0; at < 12 * Bn; at++) if (count[at] > floor || (order.length < o.peaksPerRun && count[at] > 0)) {
        order.push(at); order.sort((a, b) => count[b] - count[a]);
        const kept = [];
        for (const a of order) if (!kept.some((q) => Math.floor(q / Bn) === Math.floor(a / Bn) && Math.abs(mod(q - a + Bn / 2, Bn) - Bn / 2) <= 2)) kept.push(a);
        order.length = 0; order.push(...kept.slice(0, o.peaksPerRun));
        floor = order.length >= o.peaksPerRun ? count[order[order.length - 1]] : 0;
      }
      // full fits: runs of bins with every note counted (an upper bound before refining; refined below)
      for (let k = 0; k < 12; k++) {
        let inRun = false;
        for (let b = 0; b < Bn; b++) { const full = count[k * Bn + b] >= J; if (full && !inRun) nearFits++; inRun = full; }
      }
      for (const at of order) {
        const k = Math.floor(at / Bn), phi = ((at % Bn) + 0.5) * w;
        const p = refine(lanes, clip, k, P, phi, w, o);
        if (p.hits === J) fullFits++;
        offer({ psi: li, psiTone: lattices[li].tone, k, N, P, phi: p.phi, hits: p.hits, tightHits: p.tightHits, cost: p.cost, offsets: p.offsets, picks: p.picks });
      }
    }
  }
  return { lattices, barCounts: Ns, placements, bands, fullFits, nearFitBins: nearFits, votes, ms: performance.now() - t0 };
}

/**
 * A placement against the engine itself: the root (rootMode 'tonic': the tone on the clip's tonic lane nearest the
 * lattice, else the lattice's own tone; 'lattice': the lattice's own tone, so the frame is exactly the searched one), `frameAt` on it, and `buildCells` with partitioned anchors at the phase's nearest tick and swing τ.
 * Each note takes its slot's candidates (the cells' tones) that are inside the root's frame on the note's class.
 * A miss is classed: 'fringe' (the class sounds in the slot, outside the frame), 'shift' (an in-frame tone of the class
 * one slot either side), else 'hard'.
 * → { root, rootFraction, rootDev, hits, tightHits, misses: { fringe, shift, hard }, notes: [{ step, midi, fraction,
 *     centsAboveRoot, dev, offSlots, node } | { step, midi, miss }], phase, sizes: { G, R } }
 */
export function checkWithEngine(row, clip, place, { tau = DEFAULTS.tau, tight = DEFAULTS.tight, e = DEFAULTS.e, rootMode = 'tonic' } = {}) {
  const { lane, dev } = lanesOf(row, place.psiTone, e);
  const tonicLane = mod(clip.key.tonic + place.k, 12);
  let root = -1;
  if (rootMode === 'tonic') for (let t = 0; t < row.tones.length; t++) if (lane[t] === tonicLane && (root < 0 || Math.abs(dev[t]) < Math.abs(dev[root]) || (Math.abs(dev[t]) === Math.abs(dev[root]) && row.toneCount[t] > row.toneCount[root]))) root = t;
  const rootLane = root >= 0 ? tonicLane : 0;
  if (root < 0) root = place.psiTone;
  const frame = frameAt(row, root, e);
  const tick = mod(Math.round(place.phi * row.grid), row.grid);
  const cells = buildCells(row, { bars: place.N, slotsPerBar: clip.S, anchors: 'partitioned', phase: phaseAtTick(row, tick), swing: tau });
  const want = (n) => mod(n.pc + place.k - rootLane, 12);
  const inFrameOf = (slot, pc) => (slot ? slot.tones.filter((c) => frame.inside[c.tone] && frame.pc[c.tone] === pc) : []);
  let hits = 0, tightHits = 0; const misses = { fringe: 0, shift: 0, hard: 0 }, notes = [];
  for (const n of clip.notes) {
    const slot = cells.slots[n.step], pc = want(n), cands = inFrameOf(slot, pc);
    if (cands.length) {
      let best = null, bc = Infinity;
      for (const c of cands) { const off = c.offset / slot.length, cost = Math.abs(off) + 0.5 * Math.abs(frame.dev[c.tone]) / (e || 1); if (cost < bc) { bc = cost; best = { c, off }; } }
      hits++; if (Math.abs(best.off) <= tight + 1e-12) tightHits++;
      const cents = mod(row.toneCents[best.c.tone] - row.toneCents[root], 1200);
      notes.push({ step: n.step, midi: n.midi, fraction: row.tones[best.c.tone], centsAboveRoot: cents, dev: frame.dev[best.c.tone], offSlots: best.off, node: best.c.node });
      continue;
    }
    let why = 'hard';
    if (slot?.tones.some((c) => frame.pc[c.tone] === pc)) why = 'fringe';
    else if (inFrameOf(cells.slots[n.step - 1], pc).length || inFrameOf(cells.slots[n.step + 1], pc).length) why = 'shift';
    misses[why]++;
    notes.push({ step: n.step, midi: n.midi, miss: why });
  }
  return { root, rootFraction: row.tones[root], rootDev: dev[root], hits, tightHits, misses, notes, phase: cells.phase, sizes: cells.pulses ? { G: cells.pulses.G, R: cells.pulses.R } : null };
}
