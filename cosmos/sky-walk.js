// sky-walk.js — the global sky's one harmonic progression (see cosmos/docs/FULL_SKY_HANDOFF.md). Pure
// module, no DOM, no audio, no ProgressionSolver: the frame is an EXACT 12TET grid (degree 0 = 1/1),
// so chord-tone deviation is degenerate — the walk reduces to pure voice-leading parsimony (circular
// semitone motion) plus a field term that rewards whatever the nearby sky is actually well-tuned for.
// Reimplements the chord-table / min-over-bijections idea from chord-walk.js locally; does not import
// it — chord-walk.js is parked, not reused (see the handoff's hard rules).

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const circ12 = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };

// The chord vocabulary — ported from the Codex Compiler's MasterQualityCatalog.js: the CONSONANT (11)
// and SPECIALIZED (22) qualities by tier (the catalog's own "(18)" section label is stale — it lists 22).
// Scale modes are deliberately deferred. Each quality is a pitch-class
// set from root 0; cardinality varies 3–6 (see vlParsimony/coverage below for how the variable size is
// handled). ORDER IS THE ID SCHEME: id = rootSemitone*QUALITY_COUNT + qualityIndex, and major_triad is
// index 0 so I major stays id 0 (START_CHORD_ID). Keep major_triad/minor_triad first two — the P/L/R
// structural guards and the legacy Roman-numeral display rely on it.
export const CHORD_QUALITIES = [
  // Consonant (11)
  { id: 'major_triad',     symbol: 'maj',     intervals: [0, 4, 7],           tier: 'consonant' },
  { id: 'minor_triad',     symbol: 'm',       intervals: [0, 3, 7],           tier: 'consonant' },
  { id: 'sus4',            symbol: 'sus4',    intervals: [0, 5, 7],           tier: 'consonant' },
  { id: 'major_7th',       symbol: 'maj7',    intervals: [0, 4, 7, 11],       tier: 'consonant' },
  { id: 'minor_7th',       symbol: 'm7',      intervals: [0, 3, 7, 10],       tier: 'consonant' },
  { id: 'dominant_7th',    symbol: '7',       intervals: [0, 4, 7, 10],       tier: 'consonant' },
  { id: 'dom7_sus4',       symbol: '7sus4',   intervals: [0, 5, 7, 10],       tier: 'consonant' },
  { id: 'minor_major_7th', symbol: 'mMaj7',   intervals: [0, 3, 7, 11],       tier: 'consonant' },
  { id: 'major_6th',       symbol: '6',       intervals: [0, 4, 7, 9],        tier: 'consonant' },
  { id: 'minor_6th',       symbol: 'm6',      intervals: [0, 3, 7, 9],        tier: 'consonant' },
  { id: 'add9',            symbol: 'add9',    intervals: [0, 2, 4, 7],        tier: 'consonant' },
  // Specialized (22)
  { id: 'dim_triad',       symbol: 'dim',     intervals: [0, 3, 6],           tier: 'specialized' },
  { id: 'aug_triad',       symbol: 'aug',     intervals: [0, 4, 8],           tier: 'specialized' },
  { id: 'dim7',            symbol: 'dim7',    intervals: [0, 3, 6, 9],        tier: 'specialized' },
  { id: 'half_dim7',       symbol: 'm7b5',    intervals: [0, 3, 6, 10],       tier: 'specialized' },
  { id: 'aug7',            symbol: '7#5',     intervals: [0, 4, 8, 10],       tier: 'specialized' },
  { id: 'dom9',            symbol: '9',       intervals: [0, 2, 4, 7, 10],    tier: 'specialized' },
  { id: 'major_9th',       symbol: 'maj9',    intervals: [0, 2, 4, 7, 11],    tier: 'specialized' },
  { id: 'minor_9th',       symbol: 'm9',      intervals: [0, 2, 3, 7, 10],    tier: 'specialized' },
  { id: 'dom11',           symbol: '11',      intervals: [0, 2, 4, 5, 7, 10], tier: 'specialized' },
  { id: 'minor_11th',      symbol: 'm11',     intervals: [0, 2, 3, 5, 7, 10], tier: 'specialized' },
  { id: 'dom13',           symbol: '13',      intervals: [0, 2, 4, 7, 9, 10], tier: 'specialized' },
  { id: 'dom7_sharp9',     symbol: '7#9',     intervals: [0, 3, 4, 7, 10],    tier: 'specialized' },
  { id: 'dom7_flat9',      symbol: '7b9',     intervals: [0, 1, 4, 7, 10],    tier: 'specialized' },
  { id: 'dom13_flat9',     symbol: '13b9',    intervals: [0, 1, 4, 7, 9, 10], tier: 'specialized' },
  { id: 'dom7_sharp11',    symbol: '7#11',    intervals: [0, 4, 6, 7, 10],    tier: 'specialized' },
  { id: 'dom7_alt',        symbol: '7alt',    intervals: [0, 3, 4, 8, 10],    tier: 'specialized' },
  { id: 'dom9_sus4',       symbol: '9sus4',   intervals: [0, 2, 5, 7, 10],    tier: 'specialized' },
  { id: 'dom13_sus4',      symbol: '13sus4',  intervals: [0, 2, 5, 9, 10],    tier: 'specialized' },
  { id: 'aug_maj7',        symbol: 'augMaj7', intervals: [0, 4, 8, 11],       tier: 'specialized' },
  { id: 'italian_6th',     symbol: 'It6',     intervals: [0, 4, 6, 10],       tier: 'specialized' },
  { id: 'french_6th',      symbol: 'Fr6',     intervals: [0, 2, 6, 8],        tier: 'specialized' },
  { id: 'quartal_triad',   symbol: 'q',       intervals: [0, 5, 10],          tier: 'specialized' },
];
export const QUALITY_COUNT = CHORD_QUALITIES.length;   // 33 (11 consonant + 22 specialized)

// Legacy display stays clean for the two triads (I, i, bVI …); everything richer is Roman + the
// quality's own suffix (V7, IImaj7, bVIdim). The P/L/R guard and Feature-A worked example both look
// chords up by these symbols, so the triad forms must not change.
const chordSymbol = (r, quality) =>
  quality.id === 'major_triad' ? ROMAN[r]
  : quality.id === 'minor_triad' ? ROMAN[r].toLowerCase()
  : ROMAN[r] + quality.symbol;

// The vocabulary: every quality on all 12 roots, always ALL available (the frame IS 12TET; there's no
// per-star playability filter in the sky walk, only the field term). Built in ascending-id order.
// Historical export name was TRIADS; it now holds the full 12·QUALITY_COUNT chord set.
export const CHORDS = [];
for (let r = 0; r < 12; r++) {
  for (let qi = 0; qi < QUALITY_COUNT; qi++) {
    const q = CHORD_QUALITIES[qi];
    const semitones = [...new Set(q.intervals.map(iv => (r + iv) % 12))].sort((a, b) => a - b);
    CHORDS.push({
      id: r * QUALITY_COUNT + qi,
      rootSemitone: r,
      quality: q.id,
      qualitySymbol: q.symbol,
      tier: q.tier,
      cardinality: semitones.length,
      semitones,
      // The SOUNDING identity: a 12-bit pitch-class set. Two chords with the same mask are the same
      // sound under two names — nothing downstream reads rootSemitone, only semitones — so this is what
      // the walk compares to know whether a move is a move. See NO RENAMES in rankCandidates.
      pcMask: semitones.reduce((m, d) => m | (1 << d), 0),
      symbol: chordSymbol(r, q),
    });
  }
}
export const START_CHORD_ID = 0;   // I major — the frame's anchor chord (root at degree 0 = 1/1), id 0

// ── RICHNESS: the vocabulary CEILING (2026-07-30) ────────────────────────────────────────────────────
// Four stops, one axis: the largest chord the walk is allowed to reach for. Avery, 2026-07-29, on the old
// linear [0,0.18] weight: it "reads as ~3–4 discrete musical levels, not a continuum", and the measured
// sweep shows why — even at richness 0.00 the walk still ran 29% sevenths / 19% ninths / 8% 11th–13th,
// because that number is an incentive and an incentive cannot remove a chord from the candidate set.
//
// The axis is PURE CARDINALITY (Avery's call, 2026-07-30). It is not the only way to tier this vocabulary —
// dim/aug/quartal are dissonant three-note qualities that land at the lowest stop, and 7alt/7b9 are
// five-note qualities that land beside maj9 — but "how big" and "how spicy" are genuinely different axes,
// and one knob should travel along one of them. The dissonance axis, if it ever gets a control, is its own.
//
// The counts are uneven because the vocabulary is: stop 2 admits 14 new qualities, stop 4 only 4.
export const RICHNESS_LEVELS = Object.freeze([
  { level: 1, maxCardinality: 3, label: 'triads',  detail: 'maj · m · sus4 · dim · aug · quartal' },
  { level: 2, maxCardinality: 4, label: '7ths',    detail: '+ 7ths, 6ths, add9, dim7, m7b5, augMaj7, It6, Fr6' },
  { level: 3, maxCardinality: 5, label: '9ths',    detail: '+ 9ths, 9sus4, 13sus4, and the altered dominants' },
  { level: 4, maxCardinality: 6, label: '11–13',   detail: '+ 11ths and 13ths — the whole vocabulary' },
]);
export const RICHNESS_LEVEL_MIN = 1, RICHNESS_LEVEL_MAX = RICHNESS_LEVELS.length;
// Level → the ceiling rankCandidates filters on. Out-of-range clamps rather than throwing, so a stale
// persisted value or a bad caller degrades to a legal stop instead of silently emptying the vocabulary.
export function maxCardinalityForRichness(level) {
  const n = Math.round(Number(level));
  const i = Math.max(0, Math.min(RICHNESS_LEVELS.length - 1, (Number.isFinite(n) ? n : RICHNESS_LEVEL_MAX) - 1));
  return RICHNESS_LEVELS[i].maxCardinality;
}

const DEFAULTS = { tabuK: 3, lambdaField: 2.0, richness: 0.45 };
export const GAIN_CEILING_CENTS = 45;   // full at 0¢, ~half-power ~20¢, 0 by here — the ONE playability law
// Sky Root handoff Feature A: floor under the candidate set's raw coverage spread (maxCov-minCov) when
// normalizing the field term. Without it, a near-flat field (deep dust) would divide by ~0 and blow the
// field term up to dominate parsimony for no real reason — instead the term fades toward 0 as spread
// shrinks, and pure voice-leading parsimony (the hexatonic personality) takes back over. See the handoff's
// "hexatonic lock" proof for why the un-normalized version was field-blind after its first step.
export const EPS_SPREAD = 0.15;

// Circular-semitone voice-leading cost between two chords' pitch-class sets — pure parsimony, no JI/beta
// term (on an exact 12TET frame there's no JI deviation for the CHORD MOTION itself; JI deviation lives
// in each star's pool tones, scored separately by coverage()). Generalized to chords of DIFFERENT sizes
// via minimal voice leading with doubling (Tymoczko): anchor every note of the smaller chord onto a
// DISTINCT note of the larger (an injection), then each leftover larger-chord note doubles onto its
// nearest smaller-chord note; minimize the total. For two equal-size chords this is exactly the old
// min-over-all-bijections (leftover set empty), so triad↔triad costs — and the P/L/R structure — are
// unchanged. Symmetric: the smaller chord is always the doubled one regardless of argument order.
export function vlParsimony(A, B) {
  const a = A.semitones, b = B.semitones;
  const S = a.length <= b.length ? a : b;   // smaller — gets doubled onto the larger
  const L = a.length <= b.length ? b : a;   // larger — every note used exactly once
  const used = new Array(L.length).fill(false);
  let best = Infinity;
  const recurse = (si, sum) => {
    if (sum >= best) return;                 // leftover cost is ≥ 0, so a partial sum ≥ best can't win
    if (si === S.length) {
      let total = sum;
      for (let li = 0; li < L.length; li++) if (!used[li]) {
        let near = Infinity;
        for (let k = 0; k < S.length; k++) { const d = circ12(L[li], S[k]); if (d < near) near = d; }
        total += near;
      }
      if (total < best) best = total;
      return;
    }
    for (let li = 0; li < L.length; li++) if (!used[li]) {
      used[li] = true;
      recurse(si + 1, sum + circ12(S[si], L[li]));
      used[li] = false;
    }
  };
  recurse(0, 0);
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

// coverage(chord, audibleStars) ∈ [0,1]: the audibility-weighted mean, over the audible star set, of
// each star's own MEAN gainForDev across the chord's degrees (a star missing a degree contributes 0 for
// that degree, not a skip). Dividing by the chord's cardinality (not a fixed 3) keeps the scale [0,1]
// across mixed chord sizes — so a bigger chord must have MORE of its degrees well-tuned to score as high
// as a triad (an intentional, mild size bias toward simpler chords in sparse fields). audibleStars =
// [{ pool, weight }], plain data, no zone/DOM coupling. Weight = a star's current distance-gain.
// (Weighted-mean-of-per-star-mean == per-degree-weighted-mean-then-averaged, since weight doesn't vary
// by degree — same double sum either order.)
export function coverage(chord, audibleStars) {
  if (!audibleStars || !audibleStars.length) return 0;
  const n = chord.semitones.length || 1;
  let wSum = 0, num = 0;
  for (const star of audibleStars) {
    const weight = star.weight > 0 ? star.weight : 0;
    if (!weight) continue;
    let g = 0;
    if (star.pool) for (const d of chord.semitones) { const slot = star.pool[d]; if (slot) g += gainForDev(slot.dev); }
    num += weight * (g / n); wSum += weight;
  }
  return wSum > 0 ? num / wSum : 0;
}

// The field's support at each of the 12 degrees: the audibility-weighted mean gainForDev there, over
// the audible star set (a star with no tone near that degree contributes 0, not a skip). Structurally
// identical to sky-root.js's scoreRootAt().perDegree, which scores candidate ROOTS the same way — and
// it is exactly coverage()'s double sum kept PER DEGREE instead of averaged over one chord's degrees.
export function perDegreeSupport(audibleStars) {
  const perDegree = new Array(12).fill(0);
  let wSum = 0;
  for (const star of audibleStars || []) {
    const weight = star.weight > 0 ? star.weight : 0;
    if (!weight) continue;
    wSum += weight;
    if (star.pool) for (let d = 0; d < 12; d++) { const slot = star.pool[d]; if (slot) perDegree[d] += weight * gainForDev(slot.dev); }
  }
  if (wSum > 0) for (let d = 0; d < 12; d++) perDegree[d] /= wSum;
  return perDegree;
}

// A chord's WEAKEST degree ∈ [0,1] — how well supported its least well-tuned note is here. coverage()'s
// mean cannot see this: averaging over more degrees pulls a big chord toward the field's mean, so one
// badly-tuned extension is glaring in a triad and invisible in a 13th. This is the earned half of the
// richness incentive — extensions are only worth reaching for where the sky can actually voice them.
export function weakestSupport(chord, perDegree) {
  if (!perDegree) return 0;
  let weakest = Infinity;
  for (const d of chord.semitones) weakest = Math.min(weakest, perDegree[d] ?? 0);
  return Number.isFinite(weakest) ? weakest : 0;
}

// Two-pass candidate ranking shared by chooseNextChord (picks the argmin) and candidateCosts (the debug
// overlay, so it shows exactly the numbers the walk actually used — never a re-derived approximation):
// 1. Gather the non-tabu candidates with their raw fieldCoverage.
// 2. Normalize WITHIN EACH CARDINALITY CLASS: maxCov/minCov/spread = maxCov−minCov over the candidates
//    of the same size, fieldCost(next) = λ·(maxCov_k−cov(next))/max(spread_k, EPS_SPREAD). When spread ≥
//    EPS_SPREAD, field costs span the full [0, λ] — λ literally means "perfect local alignment is worth λ
//    semitones of extra voice-leading motion." When spread < EPS_SPREAD (deep dust / flat field), the term
//    fades toward 0 and pure parsimony takes back over (dividing by the real tiny spread instead would blow
//    the term up for no reason — the opposite of "sparser region → vaguer").
//
//    Per CLASS, not over the whole set, because coverage is a MEAN over the chord's degrees: averaging
//    over more degrees regresses toward the field's mean, so the coverage spread shrinks monotonically
//    with cardinality (measured over real codex fields: 3-note 0.081 → 6-note 0.048, with the class MEANS
//    identical to three decimals). maxCov over the whole 396 is therefore always held by a triad, and a
//    7th was being scored against a target its size structurally cannot reach — it paid a field cost for
//    being large, not for being out of tune. Normalizing per class asks each chord only "how well tuned
//    are you for your own size here", so cardinality is chosen by voice leading and richness below,
//    never by an artifact of averaging.
// 3. Subtract an EARNED richness incentive: richness·(is this chord extended at all)·weakestSupport.
//    Without it, leveling the field term only makes a supported 7th TIE its triad, and the tie-break
//    would still take the triad. Two things keep it from becoming a thumb on the scale:
//    — It is EARNED. Scaling by the chord's weakest degree means extensions are cheap where the sky is
//      well tuned across all of the chord's degrees and full price where the extension has nothing to
//      sound on, so the geography still decides — which is also the only thing that makes a 7th audibly
//      different from a triad downstream, where a row tone must land within ROW_CONSONANCE_CENTS of the
//      extension degree to be selected at all.
//    — It SATURATES at the first extension. The musical event is leaving the triad; the fifth and sixth
//      notes must earn their place on voice leading and field support alone. A linear (cardinality−3)
//      instead gives a 13th three times the discount of a 7th, and measured over real codex fields that
//      runs away completely: even richness 0.15 put the walk on six-note chords 58% of the time.
// 0a. NO RENAMES — a candidate whose pitch-class set equals the current chord's is refused outright
//    (Avery, 2026-07-30: "the system loves to rename a chord for a zero-cost move, like Iaug to IIIaug").
//    The walk was taking those constantly because they are free: an argmin over `parsimony + field −
//    richness` is handed a cost of exactly 0 by a chord that changes nothing, and the tabu could not stop
//    it because a rename has a DIFFERENT id. So a chord boundary would pass, the symbol on the overlay
//    would change, and not one pitch would move.
//
//    This is far broader than the augmented triads it was noticed on: **144 of the 396 chords are a
//    rename of some other chord** — only 313 distinct pitch-class sets exist in the vocabulary — and it is
//    not confined to the symmetric qualities. Im7 IS bIII6. Isus4 IS Vq. I6 IS VIm7. Twelve qualities are
//    affected. Nothing downstream distinguishes them: only `semitones` reaches the bed, the rows and the
//    row-tone selection, so `rootSemitone` and the display symbol are the entire difference.
//
//    Comparing masks is exactly Avery's "the pitch class must change by at least one semitone": over
//    integer pitch classes, `vlParsimony(a, b) === 0` if and only if the two sets are equal (a zero-cost
//    injection forces S ⊆ L, and a leftover that cost nothing would have to duplicate an element of L).
//    So refusing equal masks refuses precisely the zero-motion moves, and every surviving candidate moves
//    at least one semitone. The guard pins that equivalence rather than trusting the argument.
// 0b. CEILING — `maxCardinality` removes every larger quality from the candidate set outright (the RICHNESS
//    detent, 2026-07-30). This is a different kind of control from the incentive in step 3 and the two are
//    not interchangeable: the incentive can only re-WEIGHT a vocabulary it cannot shrink, which is why the
//    swept table still shows 8% 11th–13th chords at richness 0.00 and why the knob never read as a
//    continuum. A ceiling is the only thing that can actually say "no 13ths here". It composes cleanly with
//    the per-class normalization below — the removed classes simply do not exist, so the classes that remain
//    keep exactly the field costs they would have had.
function rankCandidates(currentId, tabu, fieldCoverage, opts = {}) {
  const lambda = opts.lambdaField ?? DEFAULTS.lambdaField;
  const richnessWeight = opts.richness ?? DEFAULTS.richness;
  const maxCardinality = opts.maxCardinality ?? Infinity;
  const perDegree = opts.perDegree || null;
  const current = CHORDS[currentId];
  // The ceiling is applied BEFORE the tabu can starve it. 72 chords survive even at the tightest stop
  // against a tabu of 3, so the fallback is unreachable in production — it exists so a caller that pairs a
  // tight ceiling with a huge tabu degrades to the full vocabulary instead of returning no chord at all.
  let pool = CHORDS.filter(next => !tabu.includes(next.id) && next.cardinality <= maxCardinality && next.pcMask !== current.pcMask);
  if (!pool.length) pool = CHORDS.filter(next => !tabu.includes(next.id));
  const raw = [];
  for (const next of pool) raw.push({ chord: next, coverage: fieldCoverage(next) });
  const byCardinality = new Map();
  for (const r of raw) {
    let bounds = byCardinality.get(r.chord.cardinality);
    if (!bounds) byCardinality.set(r.chord.cardinality, bounds = { maxCov: -Infinity, minCov: Infinity });
    if (r.coverage > bounds.maxCov) bounds.maxCov = r.coverage;
    if (r.coverage < bounds.minCov) bounds.minCov = r.coverage;
  }
  return raw.map(({ chord, coverage }) => {
    const { maxCov, minCov } = byCardinality.get(chord.cardinality);
    const parsimony = vlParsimony(current, chord);
    const fieldCost = lambda * (maxCov - coverage) / Math.max(maxCov - minCov, EPS_SPREAD);
    const weakest = perDegree ? weakestSupport(chord, perDegree) : 0;
    const richness = chord.cardinality > 3 ? richnessWeight * weakest : 0;
    return { id: chord.id, symbol: chord.symbol, cardinality: chord.cardinality, coverage, parsimony, fieldCost, weakest, richness, cost: parsimony + fieldCost - richness };
  });
}

// The online walk step: argmin over non-tabu chords of the ranked cost (vlParsimony + normalized field
// term − earned richness). `tabu` already contains the current chord's id (FIFO, caller-maintained) so
// this never returns the current chord — the walk always moves. fieldCoverage: (chord) => number in
// [0,1], typically `next => coverage(next, audibleStars)`.
//
// Deterministic tie-break, richest first: an exact cost tie goes to the HIGHER cardinality, then to the
// lower id. CHORDS is built in ascending-id order with major_triad and minor_triad at quality indices 0
// and 1, so a plain lowest-id tie-break structurally handed every tie to a triad — the walk could never
// take a 7th that merely matched a triad, only one that strictly beat it.
export function chooseNextChord(currentId, tabu, fieldCoverage, opts = {}) {
  const ranked = rankCandidates(currentId, tabu, fieldCoverage, opts);
  let best = null;
  for (const r of ranked) {
    if (!best || r.cost < best.cost - 1e-9 ||
        (Math.abs(r.cost - best.cost) <= 1e-9 && (r.cardinality > best.cardinality ||
          (r.cardinality === best.cardinality && r.id < best.id)))) best = r;
  }
  return best ? CHORDS[best.id] : null;   // 12·QUALITY_COUNT chords, small tabuK ⇒ never null in practice
}

// Every non-tabu candidate's cost breakdown (id, symbol, raw coverage, parsimony, normalized fieldCost,
// total cost) — the debug overlay's "why did the walk choose this" readout. Pure, same ranking
// chooseNextChord uses internally, so the overlay can never show numbers that disagree with the real walk.
export function candidateCosts(currentId, tabu, fieldCoverage, opts = {}) {
  return rankCandidates(currentId, tabu, fieldCoverage, opts);
}

// Push `id` into a FIFO tabu list, capped at `k` (chord-walk.js's exact tabu-shift pattern).
export function pushTabu(tabu, id, k = DEFAULTS.tabuK) {
  tabu.push(id);
  while (tabu.length > k) tabu.shift();
  return tabu;
}

// Pure function of the absolute tick count -> which chord-clock STEP we're at (resync-safe: recomputed
// fresh each frame from tick count alone, same pattern as cosmos-audio.js's chordIndexForCycle). This is
// NOT which chord is sounding — the walk is online/stateful (the field changes as you fly), so the
// caller advances chooseNextChord() once per step increase and remembers the resulting chord + tabu.
export function chordStepIndex(absoluteTicks, chordTicks) {
  return Math.floor(absoluteTicks / chordTicks);
}
