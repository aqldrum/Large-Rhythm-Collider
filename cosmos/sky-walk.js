// sky-walk.js — the global sky's one harmonic progression (see cosmos/FULL_SKY_HANDOFF.md). Pure
// module, no DOM, no audio, no ProgressionSolver: the frame is an EXACT 12TET grid (degree 0 = 1/1),
// so chord-tone deviation is degenerate — the walk reduces to pure voice-leading parsimony (circular
// semitone motion) plus a field term that rewards whatever the nearby sky is actually well-tuned for.
// Reimplements the triad-table / min-over-6-bijections idea from chord-walk.js locally (~30 lines);
// does not import it — chord-walk.js is parked, not reused (see the handoff's hard rules).

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const romanSymbol = (r, quality) => quality === 'min' ? ROMAN[r].toLowerCase() : ROMAN[r];
const circ12 = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };
const PERMS3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// The vocabulary: 24 major/minor triads on the global frame — always ALL available (the frame IS
// 12TET; there's no per-star playability filter in the sky walk, only the field term). Built in
// ascending-id order (id = rootSemitone*2 + (minor?1:0)), same id scheme chord-walk.js used.
export const TRIADS = [];
for (let r = 0; r < 12; r++) {
  for (const quality of ['maj', 'min']) {
    const semitones = (quality === 'maj' ? [r, (r + 4) % 12, (r + 7) % 12] : [r, (r + 3) % 12, (r + 7) % 12]).sort((a, b) => a - b);
    TRIADS.push({ id: r * 2 + (quality === 'min' ? 1 : 0), rootSemitone: r, quality, semitones, symbol: romanSymbol(r, quality) });
  }
}
export const START_CHORD_ID = 0;   // I major — the frame's anchor triad (root at degree 0 = 1/1)

const DEFAULTS = { tabuK: 3, lambdaField: 2.0 };
export const GAIN_CEILING_CENTS = 45;   // full at 0¢, ~half-power ~20¢, 0 by here — the ONE playability law

// Min-over-6-bijections voice-leading cost between two triads' semitone sets — pure circular-semitone
// parsimony, no JI/beta term (unlike chord-walk's vlCost): on an exact 12TET frame there's no JI
// deviation for the CHORD MOTION itself; JI deviation lives in each star's pool tones, scored separately.
export function vlParsimony(A, B) {
  let best = Infinity;
  for (const perm of PERMS3) {
    let sum = 0;
    for (let i = 0; i < 3; i++) sum += circ12(A.semitones[i], B.semitones[perm[i]]);
    if (sum < best) best = sum;
  }
  return best;
}

// The one gain law every sounded bed tone is scaled by (replaces all playability thresholds). Shape:
// monotone decreasing, g(0)=1, g(ceiling)=0. cos² of a quarter-cycle over [0, ceiling].
export function gainForDev(dev) {
  const a = Math.abs(dev);
  if (a >= GAIN_CEILING_CENTS) return 0;
  const c = Math.cos((Math.PI * a) / (2 * GAIN_CEILING_CENTS));
  return c * c;
}

// coverage(triad, audibleStars) ∈ [0,1]: the audibility-weighted mean, over the audible star set, of
// each star's own mean gainForDev across the triad's 3 degrees (a star missing a degree contributes 0
// for that degree, not a skip). audibleStars = [{ pool, weight }] — plain data, no zone/DOM coupling.
// Weight = a star's current distance-gain. (Weighted-mean-of-per-star-mean == per-degree-weighted-mean-
// then-averaged, since weight doesn't vary by degree — same double sum either order.)
export function coverage(triad, audibleStars) {
  if (!audibleStars || !audibleStars.length) return 0;
  let wSum = 0, num = 0;
  for (const star of audibleStars) {
    const weight = star.weight > 0 ? star.weight : 0;
    if (!weight) continue;
    let g = 0;
    if (star.pool) for (const d of triad.semitones) { const slot = star.pool[d]; if (slot) g += gainForDev(slot.dev); }
    num += weight * (g / 3); wSum += weight;
  }
  return wSum > 0 ? num / wSum : 0;
}

// The online walk step: argmin over non-tabu triads of vlParsimony(current,next) + lambdaField·(1 −
// fieldCoverage(next)). `tabu` already contains the current chord's id (FIFO, caller-maintained, same
// convention as chord-walk.js) so this never returns the current chord — the walk always moves.
// fieldCoverage: (triad) => number in [0,1], typically `next => coverage(next, audibleStars)`.
// Deterministic tie-break: TRIADS is ascending-id order and strict `<` keeps the first (lowest-id) best.
export function chooseNextChord(currentId, tabu, fieldCoverage, opts = {}) {
  const lambda = opts.lambdaField ?? DEFAULTS.lambdaField;
  const current = TRIADS[currentId];
  let best = null, bestCost = Infinity;
  for (const next of TRIADS) {
    if (tabu.includes(next.id)) continue;
    const cost = vlParsimony(current, next) + lambda * (1 - fieldCoverage(next));
    if (cost < bestCost) { bestCost = cost; best = next; }
  }
  return best;   // 24 triads, tabuK=3 ⇒ ≤4 excluded — never null in practice
}

// Push `id` into a FIFO tabu list, capped at `k` (chord-walk.js's exact tabu-shift pattern).
export function pushTabu(tabu, id, k = DEFAULTS.tabuK) {
  tabu.push(id);
  while (tabu.length > k) tabu.shift();
  return tabu;
}

// Pure function of the absolute tick count -> which chord-clock STEP we're at (resync-safe: recomputed
// fresh each frame from tick count alone, same pattern as cosmos-audio.js's chordIndexForCycle). This is
// NOT which triad is sounding — the walk is online/stateful (the field changes as you fly), so the
// caller advances chooseNextChord() once per step increase and remembers the resulting chord + tabu.
export function chordStepIndex(absoluteTicks, chordTicks) {
  return Math.floor(absoluteTicks / chordTicks);
}
