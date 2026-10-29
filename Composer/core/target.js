// target.js — where in a row a 12EDO clip can be played: the MIDI-target search (phase A2, Composer/TARGET_ORDER.md),
// ported from probe/midi-target/target.mjs (its vote is exact against brute force, 28/28, and the engine agrees with it
// 108/108 with the frame centred on the lattice tone: probe/midi-target/FINDINGS.md) and extended.
//
// PURE: no fetch, no DOM. One clock read: `ms`, how long `placeClip` took (globalThis.performance, when there is one),
// a measurement that steers nothing.
//
// The unknowns, and how each is found:
//   ψ   the tuning lattice: a tone of the row whose cents, mod 100, centre the ±e frame. Only ψ decides which onsets are
//       in tune. Candidates: the cluster representatives (frame.js), one per lattice (within 1¢), the ones whose frame
//       holds the most onsets first (`latticesOf`; "lattices best first", P7).
//   k   the transposition: clip pitch class m plays on lane (m + k) mod 12 of ψ's lattice.
//   N   bars in the cycle (P = N·S slots, S the clip's steps a bar). N = B is the clip over the whole cycle; a larger N
//       puts it in a window of B of the N bars (decided, Avery: a window crops the cycle, ruling 2).
//   φ   the phase: where the clip's bar 0, step 0 falls on the cycle.
//
// The vote (a Hough transform, the probe's): for each N, each note j at step s_j and each in-tune onset i at x_i on lane L,
// the onset says "note j sounds here if k = L − m_j and φ is within τ/P of x_i − s_j/P". A (k, φ-bin)'s count is how many
// notes find an in-tune onset of their class within τ of a slot for some φ in it. The peaks are refined exactly
// (`refine`: every interval end inside the peak's bins evaluated, then φ centred among the hits so the worst timing
// error is as small as it can be).
//
// What phase A adds (each proposed unless marked decided):
//   prune (P7)     N from B up; the first N whose best fits every note ends the search (the smallest N with a full fit
//                  wins), its lattices all tried, best first. A row with no full fit is searched to the probe's top N.
//   drift (P3; decided that the lattice may drift, Avery ruling 6)
//                  per lead phrase (harmony.js `phrasesOf`: as many bars as 32 slots hold), a Viterbi over the phrases
//                  at each candidate (N, φ) (the vote's peaks over all lattices, the best `driftCandidates` of an N):
//                  a state is a (ψ, k), scored on the phrase's notes; the clip's tonic, at its REALIZED cents (the
//                  lattice tone's cents + 100 × its lane), may move at most `maxDriftCents` (default 30, a comma's reach)
//                  between adjacent phrases. Ranked: hits, then the least total drift (so a phrase drifts only when that
//                  gains notes), then tight hits, then the cost (the order lists tight hits before drift; read so,
//                  a phrase would drift for timing alone, which the rule's first clause forbids: proposed).
//                  `maxDriftCents: 0` turns it off. The no-drift candidates stay in the pool, so drift never makes the
//                  best worse.
//   the engine     the best candidates are MATERIALIZED as Compose will play them: φ rounded to a tick, `buildCells`
//                  (N × S, partitioned, swing ½), each phrase's frame centred on its lattice tone (`frameAt`).
//                  A note takes its slot's in-frame onset of its class (the nearest, then the least deviation): a hit.
//                  A miss is played by substitution where it can be, and marked either way (P2):
//                    fringe  the class sounds in the slot outside the frame: that onset (amber)
//                    shift   an in-frame onset of the class one slot over, inside the window and between its
//                            neighbours: that onset (amber)
//                    hard    silent (red)
//   note-offs (P4; decided that they land on row onsets, Avery ruling 7)
//                  on the LOOP's time (the window, wrapping): a note whose note-off is the next note's step ends at that
//                  note-on; otherwise its end is the onset of the row (any tone) nearest its note-off slot's anchor
//                  within that slot's ±½-slot window, after its note-on and no later than the next note-on; with none
//                  there, the next onset after the anchor ("late off"), else the next note-on (also late).
//   ranking        after materializing: hits, then the least drift, then note-off hits (P4: "counted after note-on
//                  hits"), then tight hits, then the cost. The best is the placement; the next distinct ones (at most
//                  `alternates`, 8) are the alternates.
//   lanes          `laneReport`: the in-frame onsets a lattice holds per class, so the window can say which of the clip's
//                  classes the row can't play (decided, Avery ruling 5).
//
// Positions: a share of the row's cycle from the phase. LOOP time `lt` of an onset at u: u inside the window (u < W,
// W the window's share: 1 for N = B), else u − 1 + W (an onset just before the window's first anchor, in slot 0's
// window, sounds at the loop's end, as Compose times one before the cycle's first anchor at the cycle's end).

import { buildCells, phaseAtTick } from './cells.js';
import { classOfCents, clusterPresence, frameOnsetsByRoot, frameAt, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { MAX_SLOTS } from './lines.js';

export const COMPOSER_TARGET_VERSION = 'composer-target-v1';
export const DEFAULTS = Object.freeze({
  e: DEFAULT_FRAME_CENTS_EACH_SIDE,   // the frame, ± cents
  tau: 0.5,             // a note's window either side of its slot's anchor, as a share of the slot (swing ½)
  tight: 0.25,          // a hit within this share of the slot is "tight"
  maxPsi: 12,           // lattices tried, most in-tune onsets first
  maxN: 256,            // bars in the cycle, at most…
  slotsPerOnset: 2,     // …and at most this many slots an onset of the row (P ≤ 2n)
  denseN: 64,           // every N up to here; past it N grows by `growN`
  growN: 1.15,
  peaksPerRun: 8,       // peaks refined per (ψ, N)
  keep: 40,             // search candidates kept overall
  maxDriftCents: 30,    // P3: the tonic's move between adjacent phrases, at most (0: no drift)
  driftCandidates: 8,   // the (N, φ) of an N given a drift path: its best candidates'
  alternates: 8,        // placements offered after the best
  materialize: 16,      // search candidates materialized (built on the engine's cells) to rank the final placements
});

const EPS = 1e-9;
const mod = (v, n) => ((v % n) + n) % n;
const fail = (what) => { throw new Error(`composer/target: ${what}`); };
const now = () => globalThis.performance?.now?.() ?? 0;

/** the lattices: [{ tone, cents (mod 100), held (onsets the frame holds), presence }], best first, at most maxPsi */
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

/** a lattice's in-tune onsets, by lane: lanes[L] = { x: Float64Array (sorted), node: Int32Array, dev: Float64Array }; plus count, and lane/dev by tone */
export function lanesOf(row, psiTone, e = DEFAULTS.e) {
  const rc = row.toneCents[psiTone], T = row.tones.length;
  const lane = new Int8Array(T).fill(-1), dev = new Float64Array(T);
  for (let t = 0; t < T; t++) { const c = classOfCents(row.toneCents[t] - rc); if (Math.abs(c.dev) <= e + EPS) { lane[t] = c.pc; dev[t] = c.dev; } }
  const buckets = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < row.n; i++) { const L = lane[row.tone[i]]; if (L >= 0) buckets[L].push(i); }   // row order = x order
  let count = 0;
  const lanes = buckets.map((b) => { count += b.length; return { x: Float64Array.from(b, (i) => row.x[i]), node: Int32Array.from(b), dev: Float64Array.from(b, (i) => dev[row.tone[i]]) }; });
  return { lanes, count, lane, dev };
}

/** a lattice's in-frame onsets per class (decided 5: what the row can't play) → { psiTone, ratio, cents (mod 1200), counts: [12], empty: [lane] } */
export function laneReport(row, psiTone, e = DEFAULTS.e) {
  const { lanes } = lanesOf(row, psiTone, e), counts = lanes.map((l) => l.x.length);
  return { psiTone, ratio: row.tones[psiTone], cents: row.toneCents[psiTone], counts, empty: counts.flatMap((c, L) => (c ? [] : [L])) };
}

/** where a placement sits: 'whole' (N = B), 'near' (N ≤ 4B), 'window' (past that) */
export const bandOf = (N, B) => (N === B ? 'whole' : N <= 4 * B ? 'near' : 'window');

/** the N to try for a clip on a row, smallest first */
export function barCounts(row, clip, o = {}) {
  const { maxN, slotsPerOnset, denseN, growN } = { ...DEFAULTS, ...o };
  const top = Math.max(clip.B, Math.min(maxN, Math.floor((slotsPerOnset * row.n) / clip.S)));
  const out = [];
  for (let N = clip.B; N <= top;) { out.push(N); N = N < denseN ? N + 1 : Math.max(N + 1, Math.round(N * growN)); }
  return out;
}

/** the clip's lead phrases (harmony.js `phrasesOf` over its B bars): [{ from, bars }] */
export function clipPhrases(clip) {
  const per = Math.max(1, Math.min(clip.B, Math.floor(MAX_SLOTS / clip.S))), out = [];
  for (let from = 0; from < clip.B; from += per) out.push({ from, bars: Math.min(per, clip.B - from) });
  return out;
}

/** the first index in sorted xs with xs[i] ≥ v */
function lowerBound(xs, v) { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; }

/**
 * Exact, on even anchors: each note's best in-tune onset of its lane within τ/P of its anchor (φ + s/P). A hit's cost is
 * |offset| in slots + 0.5·|dev|/e. notes [{ step, pc }] → { hits, tightHits, cost, offsets (slots, signed; null: a miss), picks }
 */
export function evaluate(lanes, notes, k, P, phi, { tau = DEFAULTS.tau, tight = DEFAULTS.tight, e = DEFAULTS.e } = {}) {
  let hits = 0, tightHits = 0, cost = 0;
  const offsets = [], picks = [];
  for (const n of notes) {
    const L = mod(n.pc + k, 12), { x, node, dev } = lanes[L], a = mod(phi + n.step / P, 1), r = tau / P;
    let best = -1, bestCost = Infinity, bestOff = 0;
    const scan = (from, to, shift) => {   // onsets with x in [from, to], their offset measured as x + shift − a
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

/** search ranking: more hits, then less drift (a phrase drifts only when that gains notes: P3), then more tight hits,
 *  then less cost — does a rank before b? */
const searchBefore = (a, b) => {
  if (!b) return true;
  if (a.hits !== b.hits) return a.hits > b.hits;
  const da = a.drift ?? 0, db = b.drift ?? 0;
  if (Math.abs(da - db) > EPS) return da < db;
  if (a.tightHits !== b.tightHits) return a.tightHits > b.tightHits;
  return a.cost < b.cost - 1e-12;
};
/** the final ranking (materialized): hits, less drift, note-off hits (P4: after note-on hits), tight hits, less cost */
const placedBefore = (a, b) => {
  const ka = [a.hits, -a.drift, a.offHits, a.tight, -a.cost], kb = [b.hits, -b.drift, b.offHits, b.tight, -b.cost];
  for (let i = 0; i < ka.length; i++) if (Math.abs(ka[i] - kb[i]) > 1e-9) return ka[i] > kb[i];
  return false;
};

/**
 * A vote peak, refined (the probe's): the hit count evaluated just inside every interval end in the peak's bins (and the
 * bins either side), the exact best there; then φ centred among its hits.
 */
function refine(lanes, notes, k, P, phi, w, o) {
  const r = o.tau / P, eps = 1e-9 / P, lo = phi - 1.5 * w, hi = phi + 1.5 * w;
  const tries = new Set([phi]);
  for (const n of notes) {
    const { x } = lanes[mod(n.pc + k, 12)], s = n.step / P;
    for (const shift of [-1, 0, 1]) {   // the interval ends c ± r, c = x − s (+ a lap), that fall in [lo, hi]
      for (let i = lowerBound(x, lo + s - shift - r - 1e-12); i < x.length; i++) {
        const c = x[i] - s + shift;
        if (c - r > hi) break;
        if (c - r >= lo) tries.add(c - r + eps);
        if (c + r >= lo && c + r <= hi) tries.add(c + r - eps);
      }
    }
  }
  let best = null;
  for (const t of tries) { const f = mod(t, 1), p = { ...evaluate(lanes, notes, k, P, f, o), phi: f }; if (searchBefore(p, best)) best = p; }
  const offs = best.offsets.filter((v) => v != null);
  if (offs.length) {
    const phi2 = mod(best.phi + (Math.max(...offs) + Math.min(...offs)) / (2 * P), 1);
    const next = { ...evaluate(lanes, notes, k, P, phi2, o), phi: phi2 };
    if (next.hits >= best.hits) best = next;
  }
  return best;
}

/** the vote for one lattice at P slots: the highest bins (at most peaksPerRun, none within 2 bins of a taken one on the same k) → [{ k, phi, w, count }] */
function vote(lanes, steps, pcs, P, o, buf) {
  const J = steps.length, Bn = Math.ceil((2 * P) / o.tau) * 2, w = 1 / Bn, r = o.tau / P;   // bins a quarter of τ/P wide
  const size = 12 * Bn;
  if (!buf.count || buf.count.length < size) { buf.count = new Uint16Array(size); buf.stamp = new Int32Array(size); }
  const count = buf.count, stamp = buf.stamp;
  count.fill(0, 0, size); stamp.fill(-1, 0, size);
  for (let j = 0; j < J; j++) {
    const s = steps[j] / P;
    for (let L = 0; L < 12; L++) {
      const base = mod(L - pcs[j], 12) * Bn, { x } = lanes[L];
      for (let i = 0; i < x.length; i++) {
        const c = x[i] - s, lo = Math.floor((c - r) / w), hi = Math.floor((c + r) / w);
        for (let b = lo; b <= hi; b++) { const at = base + (b < 0 ? b + Bn : b >= Bn ? b - Bn : b); if (stamp[at] !== j) { stamp[at] = j; count[at]++; } }
      }
    }
  }
  const order = [];
  let floor = 0;
  for (let at = 0; at < size; at++) if (count[at] > floor || (order.length < o.peaksPerRun && count[at] > 0)) {
    order.push(at); order.sort((a, b) => count[b] - count[a]);
    const kept = [];
    for (const a of order) if (!kept.some((q) => Math.floor(q / Bn) === Math.floor(a / Bn) && Math.abs(mod(q - a + Bn / 2, Bn) - Bn / 2) <= 2)) kept.push(a);
    order.length = 0; order.push(...kept.slice(0, o.peaksPerRun));
    floor = order.length >= o.peaksPerRun ? count[order[order.length - 1]] : 0;
  }
  return order.map((at) => ({ k: Math.floor(at / Bn), phi: ((at % Bn) + 0.5) * w, w, count: count[at] }));
}

/** the tonic's realized cents (mod 1200) on lattice tone `psiTone` at transposition k */
const tonicCentsOf = (row, psiTone, k, tonic) => mod(row.toneCents[psiTone] + 100 * mod(tonic + k, 12), 1200);
/** the signed move from cents a to cents b on the circle, in [−600, 600) */
const moveCents = (a, b) => mod(b - a + 600, 1200) - 600;

/** a path's notes evaluated at φ: per note its phrase's (ψ, k) → { hits, tightHits, cost, offsets } */
function evalPath(L, phraseNotes, path, P, phi, o) {
  let hits = 0, tightHits = 0, cost = 0; const offsets = [];
  phraseNotes.forEach((notes, p) => {
    const r = evaluate(L.lanes[path[p].li], notes, path[p].k, P, phi, o);
    hits += r.hits; tightHits += r.tightHits; cost += r.cost; offsets.push(...r.offsets);
  });
  return { hits, tightHits, cost, offsets };
}

/**
 * The drift Viterbi at one (N, φ): a state a (ψ, k), scored on each phrase's notes; adjacent phrases' tonics at most
 * maxDriftCents apart (realized cents). Lexicographic: hits, least total drift, tight hits, least cost.
 * → { path: [{ li, k }], hits, tightHits, cost, drift }
 */
function driftPath(L, phraseNotes, P, phi, o) {
  const states = L.states, trans = L.trans;
  let prev = null; const back = [];
  for (let p = 0; p < phraseNotes.length; p++) {
    const cur = new Array(states.length), bk = new Int32Array(states.length).fill(-1);
    for (let s = 0; s < states.length; s++) {
      const sc = evaluate(L.lanes[states[s].li], phraseNotes[p], states[s].k, P, phi, o);
      if (!prev) { cur[s] = { hits: sc.hits, tightHits: sc.tightHits, drift: 0, cost: sc.cost }; continue; }
      let best = null, from = -1;
      for (const [s2, d] of trans[s]) {
        const q = prev[s2], c = { hits: q.hits + sc.hits, tightHits: q.tightHits + sc.tightHits, drift: q.drift + d, cost: q.cost + sc.cost };
        if (searchBefore(c, best)) { best = c; from = s2; }
      }
      cur[s] = best; bk[s] = from;
    }
    back.push(bk); prev = cur;
  }
  let end = 0;
  for (let s = 1; s < states.length; s++) if (searchBefore(prev[s], prev[end])) end = s;
  const path = new Array(phraseNotes.length);
  for (let p = phraseNotes.length - 1, s = end; p >= 0; p--) { path[p] = { li: states[s].li, k: states[s].k }; s = back[p][s]; }
  return { path, ...prev[end] };
}

/** the total |drift| of a path (realized tonic cents, phrase to phrase) */
function pathDrift(L, path) {
  let d = 0;
  for (let p = 1; p < path.length; p++) d += Math.abs(moveCents(L.tonicCents(path[p - 1]), L.tonicCents(path[p])));
  return d;
}

/**
 * A search candidate built as Compose plays it (see the head of this file): the phase at its tick, the cells, each note's
 * onset (hit or substitute) and note-off. → a placement (see `placeClip`)
 */
function materialize(row, clip, cand, L, o) {
  const S = clip.S, B = clip.B, N = cand.N, BS = B * S, P = N * S, J = clip.notes.length, e = o.e;
  const tick = mod(Math.round(cand.phi * row.grid), row.grid), phase = phaseAtTick(row, tick), phaseX = phase[0] / phase[1];
  const cells = buildCells(row, { bars: N, slotsPerBar: S, anchors: 'partitioned', phase, swing: o.tau });
  const W = N > B ? mod(cells.slots[BS].anchor - phaseX, 1) : 1;
  const starts = cells.slots.slice(0, BS).map((s) => mod(s.anchor - phaseX, 1));
  const lt = (i) => { const u = mod(row.x[i] - phaseX, 1); return u < W ? u : u - 1 + W; };
  const phrases = L.phrases, per = phrases.length > 1 ? phrases[1].from : B;
  const frames = cand.path.map(({ li }) => L.frame(li));
  const phraseOf = (step) => Math.min(phrases.length - 1, Math.floor(step / (per * S)));
  const laneOf = (n) => mod(n.pc + cand.path[phraseOf(n.step)].k, 12);
  const offSlotsOf = (i, step) => { let d = lt(i) - starts[step]; d = mod(d + W / 2, W) - W / 2; return d / cells.slots[step].length; };
  const inFrame = (slot, f, lane) => (slot ? slot.tones.filter((c) => f.inside[c.tone] && f.pc[c.tone] === lane) : []);

  // note-ons: hits and fringes first; shifts once their neighbours are known
  const notes = clip.notes.map((n) => ({ step: n.step, until: n.until, midi: n.midi, pc: n.pc, on: null, off: null }));
  notes.forEach((x, j) => {
    const n = clip.notes[j], f = frames[phraseOf(n.step)], lane = laneOf(n), slot = cells.slots[n.step];
    const cands = inFrame(slot, f, lane);
    if (cands.length) {
      let best = null, bc = Infinity;
      for (const c of cands) { const off = c.offset / slot.length, cost = Math.abs(off) + 0.5 * Math.abs(f.dev[c.tone]) / (e || 1); if (cost < bc) { bc = cost; best = { c, off, cost }; } }
      x.on = { node: best.c.node, kind: 'hit', slot: n.step, offSlots: best.off, dev: f.dev[best.c.tone], cost: best.cost };
      return;
    }
    const fringe = slot.tones.filter((c) => f.pc[c.tone] === lane);   // ordered nearest first (cells.js)
    if (fringe.length) {
      const c = fringe.reduce((a, b) => (Math.abs(b.offset) < Math.abs(a.offset) - 1e-15 || (Math.abs(Math.abs(b.offset) - Math.abs(a.offset)) <= 1e-15 && Math.abs(f.dev[b.tone]) < Math.abs(f.dev[a.tone])) ? b : a));
      x.on = { node: c.node, kind: 'fringe', slot: n.step, offSlots: c.offset / slot.length, dev: f.dev[c.tone] };
    }
  });
  notes.forEach((x, j) => {
    if (x.on) return;
    const n = clip.notes[j], f = frames[phraseOf(n.step)], lane = laneOf(n);
    // the neighbours that sound: a shift lands strictly between them (in loop time), never on or past either
    let lo = -Infinity, hi = Infinity;
    for (let i = j - 1; i >= 0; i--) if (notes[i].on) { lo = lt(notes[i].on.node); break; }
    for (let i = j + 1; i < J; i++) if (notes[i].on) { hi = lt(notes[i].on.node); break; }
    let best = null;
    for (const s of [n.step - 1, n.step + 1]) {
      if (s < 0 || s >= BS || notes.some((y) => y.on?.node != null && y.on.slot === s)) continue;   // one sounding note a slot
      for (const c of inFrame(cells.slots[s], f, lane)) {
        const t = lt(c.node), d = Math.abs(offSlotsOf(c.node, n.step));
        if (!(t > lo + 1e-15 && t < hi - 1e-15)) continue;
        if (!best || d < best.d - 1e-12 || (Math.abs(d - best.d) <= 1e-12 && Math.abs(f.dev[c.tone]) < Math.abs(f.dev[best.c.tone]))) best = { c, s, d };
      }
    }
    if (best) x.on = { node: best.c.node, kind: 'shift', slot: best.s, offSlots: offSlotsOf(best.c.node, n.step), dev: f.dev[best.c.tone] };
    else x.on = { node: null, kind: 'hard', slot: n.step, offSlots: null, dev: null };
  });
  for (const x of notes) if (x.on.node != null) x.on.pos = lt(x.on.node);

  // note-offs, on the loop's onsets (the window's, and slot 0's before its first anchor), circular with period W
  const loop = [];
  for (let i = 0; i < row.n; i++) { const u = mod(row.x[i] - phaseX, 1); if (u < W || cells.slotOfNode[i] === 0) loop.push(i); }
  const lts = Float64Array.from(loop, lt), order = Array.from(lts.keys()).sort((a, b) => lts[a] - lts[b]);
  const ls = Float64Array.from(order, (q) => lts[q]), ln = Int32Array.from(order, (q) => loop[q]);
  const sounding = notes.map((x, j) => j).filter((j) => notes[j].on.node != null);
  let offHits = 0;
  sounding.forEach((j, q) => {
    const x = notes[j], on = x.on.pos, nj = sounding[(q + 1) % sounding.length], next = notes[nj];
    let relNext = mod(next.on.pos - on, W); if (relNext <= 1e-15) relNext = W;
    const U = x.until, adjacent = sounding.length > 1 && mod(U, BS) === next.step && (nj > j ? U === next.step : U === next.step + BS);
    let pick = null, late = false;
    if (adjacent) pick = { node: next.on.node, rel: relNext };
    else {
      // the anchor's place after the note-on: its distance from the note's own anchor, less the note-on's offset from it
      const own = starts[x.step], onOff = mod(on - own + W / 2, W) - W / 2, relA = (U < BS ? starts[U] : W) - own - onOff;
      const before = 0.5 * cells.slots[U - 1].length, after = 0.5 * cells.slots[U < BS ? U : 0].length;
      // the loop's onsets with rel in (lo, hi], rel = their loop time − the note-on's, wrapped into (0, W]
      const within = (lo, hi, take) => {
        lo = Math.max(lo, 0); hi = Math.min(hi, relNext);
        if (!(hi > lo)) return;
        for (const lap of [0, W]) {
          const from = on + lo - lap, to = on + hi - lap;
          for (let i = lowerBound(ls, from); i < ls.length && ls[i] <= to + 1e-15; i++) { const rel = ls[i] + lap - on; if (rel > lo + 1e-15 && rel <= hi + 1e-15) take(ln[i], rel); }
        }
      };
      within(relA - before, relA + after, (node, rel) => {
        const d = Math.abs(rel - relA);
        if (!pick || d < pick.d - 1e-15 || (Math.abs(d - pick.d) <= 1e-15 && rel < pick.rel)) pick = { node, rel, d };
      });
      if (!pick) {
        late = true;
        within(relA, W, (node, rel) => { if (!pick || rel < pick.rel) pick = { node, rel }; });
        if (!pick) pick = { node: next.on.node, rel: relNext };
      }
    }
    x.off = { node: pick.node, late, pos: on + pick.rel };
    if (!late) offHits++;
  });

  const misses = { fringe: 0, shift: 0, hard: 0 };
  let hits = 0, tight = 0, cost = 0;
  for (const x of notes) {
    if (x.on.kind === 'hit') { hits++; cost += x.on.cost; if (Math.abs(x.on.offSlots) <= o.tight + 1e-12) tight++; }
    else misses[x.on.kind]++;
    delete x.on.cost;
  }
  // the clip's classes the row can't play: no in-frame onset of the class's lane in its phrase's lattice (decided 5)
  const missing = new Set();
  for (const n of clip.notes) { const li = cand.path[phraseOf(n.step)].li; if (!L.lanes[li][laneOf(n)].x.length) missing.add(n.pc); }
  let prevTonic = null, drift = 0;
  const phraseList = phrases.map((ph, p) => {
    const { li, k } = cand.path[p], psiTone = L.lattices[li].tone, tonicCents = L.tonicCents(cand.path[p]);
    const driftCents = prevTonic == null ? 0 : moveCents(prevTonic, tonicCents);
    drift += Math.abs(driftCents); prevTonic = tonicCents;
    return { from: ph.from, bars: ph.bars, psiTone, psiRatio: row.tones[psiTone], k, tonicCents, driftCents };
  });
  return {
    N, B, S, P, phase, tick, window: N > B, share: W, band: bandOf(N, B), phrases: phraseList, notes,
    hits, tight, offHits, cost, drift, misses, missing: [...missing].sort((a, b) => a - b), J,
    search: { phi: cand.phi, hits: cand.hits, tightHits: cand.tightHits },
  };
}

/**
 * Where in a row a clip can be played.
 *   row    a built row (row.js); clip  decodeClip's (midi.js)
 *   opts   { e (±¢, default 15), tonic (the clip's tonic pc, default its key estimate: P5), maxDriftCents (30; 0: off),
 *            alternates (8), and the search's knobs (DEFAULTS) }
 * → { version, placement, alternates: [placement], lanes: { psiTone, ratio, cents, counts, empty, missing: [clip pc] },
 *     searched: { lattices, barCounts (tried), stoppedAt (the N a full fit stopped at, or null), candidates, hits (the
 *     search's best on even anchors) }, ms }
 *   placement { N, B, S, P, phase: [num, den], tick, window (N > B), share (the window's share of the cycle), band,
 *     phrases: [{ from, bars, psiTone, psiRatio, k, tonicCents, driftCents }], notes: [{ step, until, midi, pc,
 *     on: { node, kind: 'hit' | 'fringe' | 'shift' | 'hard', slot, offSlots, dev, pos }, off: { node, late, pos } | null }],
 *     hits, tight, offHits, cost, drift (total |¢|), misses: { fringe, shift, hard }, missing: [clip pc], J, search }
 *   `pos`: loop time as a share of the row's cycle from the phase (the head of this file); an off's pos is after its on's
 *   (it may pass the loop's end, wrapping onto the loop's first onsets).
 */
export function placeClip(row, clip, opts = {}) {
  const t0 = now(), o = { ...DEFAULTS, ...opts };
  if (!clip?.notes?.length) fail('a clip with notes is needed (midi.js decodeClip)');
  if (!(Number.isFinite(o.maxDriftCents) && o.maxDriftCents >= 0)) fail(`maxDriftCents must be ≥ 0, not ${o.maxDriftCents}`);
  const tonic = o.tonic ?? clip.key?.tonic ?? 0;
  if (!(Number.isInteger(tonic) && tonic >= 0 && tonic < 12)) fail(`tonic must be a pitch class 0..11, not ${JSON.stringify(o.tonic)}`);
  const lattices = latticesOf(row, o), Ns = barCounts(row, clip, o), J = clip.notes.length;
  if (!lattices.length) fail('the row has no lattice');
  const phrases = clipPhrases(clip), per = phrases.length > 1 ? phrases[1].from : clip.B;
  const phraseNotes = phrases.map((ph) => clip.notes.filter((n) => Math.min(phrases.length - 1, Math.floor(n.step / (per * clip.S))) === phrases.indexOf(ph)));
  const frameCache = new Map();
  const L = {
    lattices, phrases, lanes: lattices.map((x) => lanesOf(row, x.tone, o.e).lanes),
    frame: (li) => frameCache.get(li) ?? frameCache.set(li, frameAt(row, lattices[li].tone, o.e)).get(li),
    tonicCents: ({ li, k }) => tonicCentsOf(row, lattices[li].tone, k, tonic),
  };
  const drifting = o.maxDriftCents > 0 && phrases.length > 1;
  if (drifting) {
    L.states = []; for (let li = 0; li < lattices.length; li++) for (let k = 0; k < 12; k++) L.states.push({ li, k });
    L.trans = L.states.map((s) => L.states.flatMap((s2, j) => { const d = Math.abs(moveCents(L.tonicCents(s2), L.tonicCents(s))); return d <= o.maxDriftCents + EPS ? [[j, d]] : []; }));
  }
  const steps = Int32Array.from(clip.notes, (n) => n.step), pcs = Int8Array.from(clip.notes, (n) => n.pc), buf = {};
  const pool = [];
  const offer = (c) => {
    if (pool.length >= o.keep && !searchBefore(c, pool[pool.length - 1])) return;
    pool.push(c); pool.sort((a, b) => (searchBefore(a, b) ? -1 : searchBefore(b, a) ? 1 : 0));
    if (pool.length > o.keep) pool.pop();
  };
  const tried = [];
  let stoppedAt = null;
  for (const N of Ns) {
    const P = N * clip.S, here = [];
    tried.push(N);
    for (let li = 0; li < lattices.length; li++) {
      for (const pk of vote(L.lanes[li], steps, pcs, P, o, buf)) {
        const p = refine(L.lanes[li], clip.notes, pk.k, P, pk.phi, pk.w, o);
        here.push({ N, P, phi: p.phi, path: phrases.map(() => ({ li, k: pk.k })), hits: p.hits, tightHits: p.tightHits, cost: p.cost, drift: 0 });
      }
    }
    here.sort((a, b) => (searchBefore(a, b) ? -1 : searchBefore(b, a) ? 1 : 0));
    if (drifting) {
      const seen = [], drifted = [];
      for (const c of here) {
        if (seen.length >= o.driftCandidates) break;
        if (seen.some((s) => Math.abs(mod(s - c.phi + 0.5, 1) - 0.5) * P < 0.25)) continue;   // the same φ within ¼ slot
        seen.push(c.phi);
        let d = driftPath(L, phraseNotes, P, c.phi, o), phi = c.phi;
        const offs = evalPath(L, phraseNotes, d.path, P, phi, o).offsets.filter((v) => v != null);
        if (offs.length) {   // centre φ among the path's hits, kept when no worse
          const phi2 = mod(phi + (Math.max(...offs) + Math.min(...offs)) / (2 * P), 1), r = evalPath(L, phraseNotes, d.path, P, phi2, o);
          const next = { hits: r.hits, tightHits: r.tightHits, cost: r.cost, drift: d.drift };
          if (!searchBefore(d, next)) { d = { ...d, ...next }; phi = phi2; }
        }
        drifted.push({ N, P, phi, path: d.path, hits: d.hits, tightHits: d.tightHits, cost: d.cost, drift: pathDrift(L, d.path) });
      }
      here.push(...drifted);
    }
    for (const c of here) offer(c);
    if (here.some((c) => c.hits === J)) { stoppedAt = N; break; }
  }

  // materialize the best distinct candidates and rank them as Compose will play them
  const placed = [], sigs = new Set(), taken = [];
  for (const c of pool) {
    if (taken.length >= o.materialize) break;
    const key = `${c.N}|${c.path.map((s) => `${s.li}.${s.k}`).join(',')}`;
    if (taken.some((t) => t.key === key && Math.abs(mod(t.phi - c.phi + 0.5, 1) - 0.5) * c.P < 0.25)) continue;
    taken.push({ key, phi: c.phi });
    const p = materialize(row, clip, c, L, o), sig = `${p.N}|${p.notes.map((x) => `${x.on.node}:${x.on.kind}`).join(',')}`;
    if (sigs.has(sig)) continue;
    sigs.add(sig); placed.push(p);
  }
  placed.sort((a, b) => (placedBefore(a, b) ? -1 : placedBefore(b, a) ? 1 : 0));
  const placement = placed[0] ?? null, alternates = placed.slice(1, 1 + o.alternates);
  let lanes = null;
  if (placement) {
    const first = laneReport(row, placement.phrases[0].psiTone, o.e);
    lanes = { ...first, missing: placement.missing };
  }
  return {
    version: COMPOSER_TARGET_VERSION, tonic, maxDriftCents: o.maxDriftCents, placement, alternates, lanes,
    searched: { lattices: lattices.length, barCounts: tried, stoppedAt, candidates: pool.length, hits: pool[0]?.hits ?? 0 },
    ms: now() - t0,
  };
}

/**
 * The composition's root for a placement (P5): the tone of the tonic's class in the first phrase's lattice nearest that
 * lattice (then the most heard, then the lower index); with no such tone inside the frame, the nearest of the class at
 * all; else the lattice's own tone. → tone index
 */
export function targetRoot(row, placement, tonic, e = DEFAULTS.e) {
  const { psiTone, k } = placement.phrases[0], rc = row.toneCents[psiTone], lane = mod(tonic + k, 12);
  let best = -1, bestDev = Infinity, inside = false;
  for (let t = 0; t < row.tones.length; t++) {
    const c = classOfCents(row.toneCents[t] - rc);
    if (c.pc !== lane) continue;
    const ins = Math.abs(c.dev) <= e + EPS, d = Math.abs(c.dev);
    if ((ins && !inside) || (ins === inside && (d < bestDev - EPS || (Math.abs(d - bestDev) <= EPS && row.toneCount[t] > row.toneCount[best])))) { best = t; bestDev = d; inside = ins; }
  }
  return best >= 0 ? best : psiTone;
}

/**
 * The lead's registers (register is free, decided): each sounding note's octave chosen so the line follows the clip's
 * own octave contour, the clip's tonic just above the root (`rootCents`) placed at or above it — so the lead sits where
 * the miner's leads sit, from the root up. → [octave | null (a hard miss)] by clip note
 */
export function registerOf(row, placement, clip, tonic, rootCents) {
  const tonicRef = (() => { const lo = Math.min(...clip.notes.map((n) => n.midi)); let m = lo - mod(lo - tonic, 12); return m; })();
  return placement.notes.map((x) => {
    if (x.on.node == null) return null;
    const c = row.toneCents[row.tone[x.on.node]], want = rootCents + 100 * (x.midi - tonicRef);
    return Math.round((want - c) / 1200);
  });
}
