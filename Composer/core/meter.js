// meter.js — Compose's meter from the layers' factors, and its tempo from the composition's own density
// (Composer/METER_TEMPO_ORDER.md; rulings Avery 2026-11-10).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   shape      a bar of S slots has beats of its own (decided 2: beats from the meter): 4, 8, 16 (any S a multiple of
//              4 and not of 3) are 4 beats in 4/4; 3 is 3/4; a multiple of 3 is beats of 3 slots in S/8 (6/8, 9/8,
//              12/8, 15/8); another even S is beats of 2 in S/2 / 4; another odd S is beats of 2 and a last of 3 in S/8
//              (5/8 = 2 + 3, 7/8 = 2 + 2 + 3). Under 3 slots there is no shape (null): the drums cut 4 beats on
//              sub-slots and the bar is 4/4, as before. `beatsPerBar` counts the beats (the BPM is theirs: a 6/8 BPM
//              counts dotted quarters); `quartersPerBar` is what MIDI's quarter-note tempo and clock need.
//   choice     (decided 1: factor-led, odd rare) N bars × S slots, from N ∈ METER_BARS and S ∈ METER_SLOTS, every
//              candidate holding at least MIN_ONSETS_PER_SLOT onsets a slot and at most MAX_METER_SLOTS slots in all.
//              The slots are weighed first, PRIOR[S] × (AFFINITY_FLOOR + affinity)^SLOT_SHARPNESS, then the bars under
//              them, BAR_PREFERENCE[N] × (AFFINITY_FLOOR + affinity)² (`meterCandidates`); affinity is the mean, over
//              the layers, of how well each layer sits on the meter: (gcd(L, x) − 1) / (min(L, x) − 1) for x the
//              cycle's slots (N·S) and, for a meter of even beats, its beats (N·b) — 1 when one divides the other, 0
//              when they share no factor. An odd S (5, 7) is a candidate only when a layer carries it as a factor, and
//              the odd meters together are held to ODD_SHARE of the draw. The meter is drawn by weight from its own
//              generator (`${seed}/meter`), so Compose's other draws never move and a new seed may change the meter.
//   tempo      (decided 3, 4) the seed tempo: every distinct attack of the finished composition (its parts' notes and the
//              drums' strokes, on a grid of 1/48 slot), D a loop, at a goal density drawn from DENSITY_GOAL (attacks a
//              second, `${seed}/tempo`): bpm = goal × 60 × N × b / D, clamped to SEED_TEMPO_RANGE. The comp's gate is
//              applied before the parts exist, at a provisional tempo from `attacksPerSlotOf(S)` attacks a slot; the spec
//              keeps it (`gateBpm`) so the gate's readout says what is heard.

export const METER_FROM = Object.freeze(['layers', 'cycle']);
/** the slot counts Compose may choose (ties go to the earlier) */
export const METER_SLOTS = Object.freeze([8, 16, 4, 12, 6, 9, 15, 3, 5, 7]);
export const METER_BARS = Object.freeze([4, 2, 8, 1]);
/** the meter's own preference, before the layers speak (proposed): binary about 80 % of a row with no shared factor,
 *  ternary most of the rest, odd rare */
export const PRIOR = Object.freeze({ 8: 1, 16: 0.35, 4: 0.45, 6: 0.16, 12: 0.12, 9: 0.07, 15: 0.04, 3: 0.05, 5: 0.06, 7: 0.06 });
export const BAR_PREFERENCE = Object.freeze({ 4: 1, 2: 0.45, 8: 0.35, 1: 0.12 });
export const AFFINITY_FLOOR = 0.25;
/** how hard the slots lean on the layers (the bars: 2) */
export const SLOT_SHARPNESS = 4;
export const MAX_METER_SLOTS = 64;
export const ODD_SLOTS = Object.freeze([5, 7]);
/** odd meters are rare (decided 1): their share of the draw is held to this however the layers lean */
export const ODD_SHARE = 0.15;
/** attacks a second the seed tempo aims for, drawn by the seed (decided 3) */
export const DENSITY_GOAL = Object.freeze([5, 8]);
export const SEED_TEMPO_RANGE = Object.freeze([70, 150]);
/** the provisional tempo's attacks a slot (measured 2026-11-10 over 48 compositions of rhythms.mjs: about 2.4 in a bar
 *  of 6 slots or fewer, 1.5 in a finer one) */
export const ATTACKS_PER_SLOT = Object.freeze({ coarse: 2.4, fine: 1.5 });
export const attacksPerSlotOf = (S) => (S <= 6 ? ATTACKS_PER_SLOT.coarse : ATTACKS_PER_SLOT.fine);
/** attacks closer than this share of a slot are one */
export const ATTACK_GRID = 48;

const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/meter: ${what}`); };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const r1 = (x) => Math.round(x * 10) / 10;

/** the bar's beats and signature for S slots, or null under 3 slots (the 4/4 of before) */
export function meterShape(S) {
  if (!(Number.isInteger(S) && S >= 1)) fail(`bad slots per bar ${S}`);
  if (S < 3) return null;
  let beats, timeSig, quartersPerBar;
  if (S === 3) { beats = [1, 1, 1]; timeSig = [3, 4]; quartersPerBar = 3; }
  else if (S % 4 === 0 && S % 3 !== 0) { beats = [S / 4, S / 4, S / 4, S / 4]; timeSig = [4, 4]; quartersPerBar = 4; }
  else if (S % 3 === 0) { beats = new Array(S / 3).fill(3); timeSig = [S, 8]; quartersPerBar = S / 2; }
  else if (S % 2 === 0) { beats = new Array(S / 2).fill(2); timeSig = [S / 2, 4]; quartersPerBar = S / 2; }
  else { beats = [...new Array((S - 3) / 2).fill(2), 3]; timeSig = [S, 8]; quartersPerBar = S / 2; }
  return { beats, beatsPerBar: beats.length, timeSig, quartersPerBar };
}

/** how well a layer of L pulses sits on x even places: 1 when one divides the other, 0 when they share no factor */
const align = (L, x) => { const m = Math.min(L, x); return m <= 1 ? 1 : (gcd(L, x) - 1) / (m - 1); };

/** the layers' mean fit to N bars of S slots (0..1) */
export function affinityOf(values, N, S) {
  if (!values.length) return 0;
  const shape = meterShape(S), even = shape && shape.beats.every((b) => b === shape.beats[0]), P = N * S, B = shape ? N * shape.beatsPerBar : null;
  let sum = 0;
  for (const L of values) sum += Math.max(align(L, P), even ? align(L, B) : 0);
  return sum / values.length;
}

/**
 * Every candidate meter for n onsets over the layers, weighted (asked bars or slots narrow it). The slots are weighed
 * first, PRIOR[S] × (AFFINITY_FLOOR + the best affinity of its bar counts)^SLOT_SHARPNESS (the odd ones held to
 * ODD_SHARE of the whole), then the bars under them, BAR_PREFERENCE[N] × (AFFINITY_FLOOR + affinity)², each
 * normalised: a candidate's weight is the product.
 * → [{ bars, slotsPerBar, weight (sums to 1), affinity, onsetsPerSlot }], heaviest first
 */
export function meterCandidates(n, values, { bars = null, slotsPerBar = null, minOnsetsPerSlot = 3 } = {}) {
  const Ns = bars != null ? [bars] : METER_BARS, Ss = slotsPerBar != null ? [slotsPerBar] : METER_SLOTS, bySlots = [];
  for (const S of Ss) {
    if (slotsPerBar == null && ODD_SLOTS.includes(S) && !values.some((L) => L % S === 0)) continue;
    const list = [];
    for (const N of Ns) {
      const P = N * S;
      if ((bars == null || slotsPerBar == null) && (P > MAX_METER_SLOTS || n / P < minOnsetsPerSlot - EPS)) continue;
      const affinity = affinityOf(values, N, S);
      list.push({ bars: N, slotsPerBar: S, w: (BAR_PREFERENCE[N] ?? 0.3) * (AFFINITY_FLOOR + affinity) ** 2, affinity, onsetsPerSlot: n / P });
    }
    if (list.length) bySlots.push({ S, w: (PRIOR[S] ?? 0.05) * (AFFINITY_FLOOR + Math.max(...list.map((c) => c.affinity))) ** SLOT_SHARPNESS, list });
  }
  // odd held to ODD_SHARE of the draw (unless asked, or nothing else is left)
  const odd = bySlots.filter((x) => ODD_SLOTS.includes(x.S)), oddW = odd.reduce((a, x) => a + x.w, 0), restW = bySlots.reduce((a, x) => a + x.w, 0) - oddW;
  if (slotsPerBar == null && oddW > 0 && restW > 0 && oddW / (oddW + restW) > ODD_SHARE) for (const x of odd) x.w *= (ODD_SHARE / (1 - ODD_SHARE)) * restW / oddW;
  const total = bySlots.reduce((a, x) => a + x.w, 0), out = [];
  for (const x of bySlots) {
    const sub = x.list.reduce((a, c) => a + c.w, 0);
    for (const { w, ...c } of x.list) out.push({ ...c, weight: (x.w / total) * (w / sub) });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** one candidate drawn by weight with r ∈ [0, 1) → the candidate */
export function drawCandidate(list, r) {
  const total = list.reduce((a, c) => a + c.weight, 0);
  let at = r * total;
  for (const c of list) { at -= c.weight; if (at < 0) return c; }
  return list[list.length - 1];
}

/** a spec's distinct attacks a loop: its enabled parts' notes and its drums' strokes, on 1/ATTACK_GRID of a slot */
export function attacksOf(spec) {
  const T = spec.knobs.cycleSeconds, P = spec.knobs.bars * spec.knobs.slotsPerBar, q = (t) => Math.round((t / T) * P * ATTACK_GRID), at = new Set();
  for (const p of spec.parts || []) if (p.enabled) for (const x of p.notes) at.add(q(x.time));
  if (spec.drums?.enabled) for (const h of spec.drums.hits) at.add(q(h.time));
  return at.size;
}

/** the tempo (beats a minute) at which D attacks a loop of N bars of b beats sound `goal` a second, clamped */
export function tempoForDensity(goal, attacks, N, b) {
  const [lo, hi] = SEED_TEMPO_RANGE, raw = attacks > 0 ? (goal * 60 * N * b) / attacks : lo;
  return { raw, bpm: r1(Math.min(hi, Math.max(lo, raw))), clamped: raw < lo - EPS ? 'low' : raw > hi + EPS ? 'high' : null };
}

/** the tempos a playback is seeded at stay inside these (the controller's TEMPO_LIMITS, composer-controller.js) */
const SEED_TEMPO_LIMITS = Object.freeze([30, 300]);
/** the tempo a spec's playback is seeded with (COMP_GATE_ORDER.md G2): a MIDI target's clip tempo (clamped as the
 *  controller clamps it), else its density tempo (`spec.seedTempo`), else the spec's own natural tempo */
export const seedTempoOf = (spec) => (spec?.target?.tempoBpm > 0 ? Math.min(SEED_TEMPO_LIMITS[1], Math.max(SEED_TEMPO_LIMITS[0], spec.target.tempoBpm))
  : spec?.seedTempo?.bpm > 0 ? spec.seedTempo.bpm : spec?.knobs?.tempoBpm ?? null);
/** the tempo the comp's gate was laid at: a density spec's provisional tempo (decided 4: the gate is laid before the
 *  parts exist), else the seed tempo */
export const gateTempoOf = (spec) => (!(spec?.target?.tempoBpm > 0) && spec?.seedTempo?.gateBpm > 0 ? spec.seedTempo.gateBpm : seedTempoOf(spec));
/** the player's time factor that plays a spec at its seed tempo (spec seconds × factor = clock seconds; 1 when none) */
export const playFactorOf = (spec) => { const s = spec?.knobs?.tempoBpm, t = seedTempoOf(spec); return s > 0 && t > 0 ? s / t : 1; };
