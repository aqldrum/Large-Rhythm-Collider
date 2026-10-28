// assert-voicing.mjs — voice-led chords (Composer/BASS_VOICING_ORDER.md phase F, F1–F4; the loop closed, Amendment 1
// phase K, K2: rule 8, P25): compose.js' voicing pass (`voicing: 'led'`, the default), the comp's octaves from it, `lane`,
// `voicing: 'close'`, and rearrange.js' chord swap and clave switch over it. Every led spec here is checked against a
// brute force written from the order, not from compose.js:
//   • only octaves change: every chords and comp note is the onset 'close' plays, at its time, with its class (`voice`)
//   • the mud limit (P1): neighbours under an octave apart, n/d in lowest terms, muddy when the lower sounds under
//     27 Hz × log2(n·d), at most 16/15's (27 × log2(240) ≈ 213 Hz)
//   • the anchor (P25): the first chord close, lifted by octaves until clear; its centre is the window's (P3): no tone
//     under 1/1 − 1250¢, each tone within ±1800¢ of the anchor's centre, each chord's centre within ±600¢ of it (none:
//     those nearest it). Those are each chord's states, the first chord's included
//   • the cycle (P25): every chord-to-chord motion (each tone to its nearest of the chord before, cents as they sound),
//     the last chord back to the first included, each the same weight, plus a large cost a muddy pair; the voicing chosen
//     is the cheapest cycle. Small loops (N ≤ 4): a brute force over every cycle, the octaves exactly its first least
//     (ties: less mud, then the first chord's motion from the anchor, then the centres nearest the anchor's, then the
//     lower centres, then the first in order). Longer loops: the cost equal to an independent Viterbi's least (forward,
//     once a first state). Every chord clear of the limit where any of its states is
//   • the wrap counted: the cycle never costs more than the greedy pass (phase F: the anchor, then each chord the
//     cheapest from the one before) and costs less on rows whose wrap the greedy left large; the stats' wrap the measured
//   • `lane` the register order in the chord (0 the lowest), on the comp too (its class's chord lane)
//   • the comp (P5): a strum tone the octave nearest its class's chord voice in its bar, a borrowed one the voice itself
//   • 'close' byte for byte the frozen Compose (fixtures/compose-before.js, with the comp in notes) and stacked close as
//     before (with the comp in chords); the stats, the decision and the trace say the voicing (P9) and the loop closed
//   • a one-chord loop has no wrap (the anchor); a MIDI target's cut loops its own bars
//   • a chord swap: tones unchanged outside its bar, `revoicedBars` exactly the other bars whose octaves moved (before
//     the swap too, now), the result the brute force's again, a JSON round trip the same; a clave switch equal to a
//     Compose with the same override
//   • running the pass again on its own output changes nothing
//   • the budget: ≤ 5 ms a pass (the median of 7) on every test row and on a 32-bar chart over the 16,359-onset row
//     (every 4th bar split in two: 40 chords of 3–4 tones, about 60 states a chord)
//   • the probe rows (8:7:6:5, 11:9:7:5, 19:17:16:15, 7:5:3:2, 119:42:15:8, 768:769, 768:784), charts, and the
//     16,359-onset row; close, greedy and the loop's motion, wrap and muddy chords printed
//   node Composer/tests/assert-voicing.mjs
import { compose, voiceLead, partContext } from '../core/compose.js';
import { compose as composeBefore } from './fixtures/compose-before.js';
import { rearrange, reclave, applyRearrange, materialsOf } from '../core/rearrange.js';
import { midiNotesOf, channelOf } from '../perform/composer-midi.js';
import { chainsOf } from '../perform/composer-player.js';
import { readMidi, decodeClip } from '../core/midi.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const EPS = 1e-6;

console.log('═══ COMPOSER — voice-led chords, the loop closed (BASS_VOICING_ORDER.md phases F and K) ═══');

// ── the order's rules, written out ──
const FLOOR = -1250, REACH = 1800, CENTRE = 600, MUD = 27, BIG = 1e6;
const centsOf = (ratio) => { const [n, d] = ratio.split('/').map(Number); return 1200 * Math.log2(n / d); };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
/** a note of a chord as the brute force reads it: its ratio, octave, and its bar's retune (from its own hz) */
const toneOf = (spec, n) => { const [a, b] = n.ratio.split('/').map(Number); return { voice: n.voice, ratio: n.ratio, num: BigInt(a), den: BigInt(b), cents: centsOf(n.ratio), octave: n.octave, retune: 1200 * Math.log2(n.hz / (spec.knobs.baseHz * (a / b) * 2 ** n.octave)), node: n.node }; };
const pitch = (t, o) => t.cents + 1200 * o;
const heard = (t, o) => t.cents + 1200 * o + t.retune;
/** P1: the chord's muddy neighbouring pairs at octaves `oct` */
function muddy(spec, tones, oct) {
  const idx = tones.map((_, i) => i).sort((a, b) => pitch(tones[a], oct[a]) - pitch(tones[b], oct[b]) || tones[a].voice - tones[b].voice);
  let m = 0;
  for (let x = 0; x + 1 < idx.length; x++) {
    const a = tones[idx[x]], b = tones[idx[x + 1]], oa = oct[idx[x]], ob = oct[idx[x + 1]];
    if (pitch(b, ob) - pitch(a, oa) >= 1200 - EPS) continue;
    let n = b.num * a.den, d = b.den * a.num;
    if (ob > oa) n *= 2n ** BigInt(ob - oa); else if (oa > ob) d *= 2n ** BigInt(oa - ob);
    const g = gcd(n, d); n /= g; d /= g;
    const hz = spec.knobs.baseHz * 2 ** ((a.cents + 1200 * oa + a.retune) / 1200);
    if (hz < Math.min(MUD * (Math.log2(Number(n)) + Math.log2(Number(d))), MUD * Math.log2(240)) - EPS) m++;
  }
  return m;
}
const motion = (cur, prev) => cur.reduce((s, x) => s + Math.min(...prev.map((p) => Math.abs(x - p))), 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** a spec's chords, a unit a chord (a chart's span, else a bar): each its voices (one note a class) */
function unitsOf(spec) {
  const notes = spec.parts.find((p) => p.id === 'chords').notes, S = spec.knobs.slotsPerBar;
  return spec.chords.map((c, u) => {
    const from = c.slots != null ? c.from : u * S, to = c.slots != null ? c.from + c.slots : (u + 1) * S;
    return { chord: c, u, notes: notes.filter((n) => n.slot >= from && n.slot < to).sort((a, b) => a.voice - b.voice) };
  });
}

/** the anchor and every chord's states, from the spec's tones (never its octaves): P25's window */
function windowOf(spec) {
  const units = unitsOf(spec).filter((U) => U.notes.length);
  if (!units.length) return null;
  const tonesOf = units.map((U) => U.notes.map((n) => toneOf(spec, n)));
  // the anchor: close from an octave under the root (less 50¢), each voice the lowest above the one under it; lifted while muddy
  const t0 = tonesOf[0];
  let floor = centsOf(units[0].chord.rootTone) - 1250;
  const close = t0.map((t) => { const o = Math.ceil((floor - t.cents) / 1200 - 1e-9); floor = t.cents + 1200 * o + 1; return o; });
  let lift = 0; while (lift < 12 && muddy(spec, t0, close.map((o) => o + lift))) lift++;
  const anchor = close.map((o) => o + lift), anchorS = t0.map((t, i) => heard(t, anchor[i])), centre = mean(anchorS);
  // each chord's states: every assignment, 3 octaves a tone around the centre, none under the floor, cut to the centre window
  const states = tonesOf.map((tones) => {
    const opts = tones.map((t) => { const o = []; for (let k = -8; k <= 8; k++) if (pitch(t, k) >= FLOOR - 1e-9 && heard(t, k) >= centre - REACH - 1e-9 && heard(t, k) < centre + REACH - 1e-9) o.push(k); return o; });
    let all = [[]];
    for (const o of opts) all = all.flatMap((a) => o.map((k) => [...a, k]));
    const rows = all.map((oct) => { const s = tones.map((t, i) => heard(t, oct[i])), m = mean(s); return { oct, s, mean: m, off: Math.max(0, Math.abs(m - centre) - CENTRE), mud: muddy(spec, tones, oct) }; });
    const least = Math.min(...rows.map((r) => r.off));
    return rows.filter((r) => r.off <= least + 1e-9).map((r) => ({ ...r, inWindow: least <= 1e-9 }));
  });
  for (const x of states[0]) x.fromAnchor = motion(x.s, anchorS);
  return { units, tonesOf, anchor, anchorS, centre, lift, states };
}
/** a cycle's motion: every chord from the one before, and the wrap (the first from the last; none for one chord) */
function cycleOf(ss) {
  let bars = 0; for (let i = 1; i < ss.length; i++) bars += motion(ss[i], ss[i - 1]);
  const wrap = ss.length > 1 ? motion(ss[0], ss[ss.length - 1]) : 0;
  return { bars, wrap, total: bars + wrap };
}
/** the order's tie rule over two cycles' keys [cost, mud, the first chord from the anchor, Σ|centre − anchor's|, Σ centre] */
const keyLess = (a, b) => { for (let i = 0; i < a.length; i++) { const tol = i === 1 ? 0 : 1e-9; if (a[i] < b[i] - tol) return true; if (a[i] > b[i] + tol) return false; } return false; };
/** the brute force over every cycle (N ≤ 4): the first least by the order's key → { path (state indices), key } */
function bruteCycle(W) {
  const { states, centre } = W, N = states.length;
  const mv = states.map((st, i) => (i + 1 < N ? st.map((p) => states[i + 1].map((q) => motion(q.s, p.s))) : st.map((p) => states[0].map((q) => motion(q.s, p.s)))));
  let best = null;
  const path = [];
  const walk = (i, c, m, d, z) => {
    if (best && c > best.key[0] + 1e-9) return;   // costs only grow: a cycle already dearer can't win
    if (i === N) {
      const cc = N > 1 ? c + mv[N - 1][path[N - 1]][path[0]] : c, key = [cc, m, states[0][path[0]].fromAnchor, d, z];
      if (!best || keyLess(key, best.key)) best = { path: [...path], key };
      return;
    }
    for (let x = 0; x < states[i].length; x++) {
      const st = states[i][x], step = i ? mv[i - 1][path[i - 1]][x] : 0;
      path.push(x); walk(i + 1, c + step + BIG * st.mud, m + st.mud, d + Math.abs(st.mean - centre), z + st.mean); path.pop();
    }
  };
  walk(0, 0, 0, 0, 0);
  return best;
}
/** an independent least cycle cost for any N: forward Viterbi once a first state (cost only) */
function viterbiLeast(W) {
  const { states } = W, N = states.length;
  if (N === 1) return Math.min(...states[0].map((x) => BIG * x.mud));
  let least = Infinity;
  states[0].forEach((f) => {
    let D = states[1].map((q) => BIG * f.mud + motion(q.s, f.s) + BIG * q.mud);
    for (let i = 2; i < N; i++) D = states[i].map((q) => Math.min(...states[i - 1].map((p, x) => D[x] + motion(q.s, p.s))) + BIG * q.mud);
    least = Math.min(least, ...states[N - 1].map((p, x) => D[x] + motion(f.s, p.s)));
  });
  return least;
}
/** the greedy pass (phase F, P2): the anchor, then each chord the cheapest state from the one before (ties to the lower
 *  centre, then the first) → its cycle's cost, wrap included; null when the anchor is not one of the first chord's states */
function greedyCost(W) {
  const { states, anchor, anchorS } = W;
  if (!states[0].some((x) => J(x.oct) === J(anchor))) return null;
  const ss = [anchorS];
  let cost = BIG * states[0].find((x) => J(x.oct) === J(anchor)).mud;
  for (let i = 1; i < states.length; i++) {
    const rows = states[i].map((q) => ({ q, c: motion(q.s, ss[i - 1]) + BIG * q.mud }));
    const b = rows.reduce((a, r) => (r.c < a.c - 1e-9 || (Math.abs(r.c - a.c) <= 1e-9 && r.q.mean < a.q.mean - 1e-9) ? r : a));
    ss.push(b.q.s); cost += BIG * b.q.mud;
  }
  return cost + cycleOf(ss).total;
}

/** a led spec against the brute force and the order's other rules → a list of what failed (empty: the order's) */
function audit(spec, close = null) {
  const bad = [], W = windowOf(spec);
  if (!W) return bad;
  const { units, tonesOf, states, centre } = W, N = units.length;
  const got = units.map((U) => U.notes.map((n) => n.octave)), ss = tonesOf.map((tones, i) => tones.map((t, j) => heard(t, got[i][j])));
  const mudOf = tonesOf.map((tones, i) => muddy(spec, tones, got[i]));
  const cost = cycleOf(ss).total + BIG * mudOf.reduce((a, b) => a + b, 0);
  const size = states.reduce((a, st) => a * st.length, 1);
  if (N <= 4 && size <= 4e6) {
    const b = bruteCycle(W), want = b.path.map((x, i) => states[i][x].oct);
    units.forEach((U, i) => { if (J(got[i]) !== J(want[i])) bad.push(`chord ${U.u}: octaves ${J(got[i])}, the brute force's ${J(want[i])}`); });
    if (Math.abs(cost - b.key[0]) > 1e-6) bad.push(`the cycle costs ${cost.toFixed(3)}, the brute force's least ${b.key[0].toFixed(3)}`);
  } else {
    const least = viterbiLeast(W);
    if (Math.abs(cost - least) > 1e-6) bad.push(`the cycle costs ${cost.toFixed(3)}, the least (Viterbi) ${least.toFixed(3)}`);
  }
  units.forEach((U, i) => {
    if (mudOf[i] && states[i].some((x) => !x.mud)) bad.push(`chord ${U.u}: muddy though a clear voicing is in the window`);
    if (tonesOf[i].some((t, j) => pitch(t, got[i][j]) < FLOOR - 1e-6)) bad.push(`chord ${U.u}: a tone under the floor`);
    if (states[i][0].inWindow && Math.abs(mean(ss[i]) - centre) > CENTRE + 1e-6) bad.push(`chord ${U.u}: centre ${mean(ss[i]).toFixed(0)} outside ±${CENTRE} of the anchor's ${centre.toFixed(0)}`);
    // lanes: the register order (0 the lowest)
    const order = U.notes.map((_, j) => j).sort((a, b) => ss[i][a] - ss[i][b] || U.notes[a].voice - U.notes[b].voice);
    order.forEach((j, lane) => { if (U.notes[j].lane !== lane) bad.push(`chord ${U.u}: voice ${U.notes[j].voice} lane ${U.notes[j].lane}, not ${lane}`); });
  });
  // the comp (in chords): a strum tone the octave nearest its class's chord voice, a borrowed tone the voice itself, its lane
  const comp = spec.parts.find((p) => p.id === 'comp'), all = unitsOf(spec);
  if (comp.strokes) {
    const S = spec.knobs.slotsPerBar;
    for (const n of comp.notes) {
      const U = all.find((x, u) => { const c = x.chord, from = c.slots != null ? c.from : u * S, to = c.slots != null ? c.from + c.slots : (u + 1) * S; return n.bar === (c.slots != null ? c.bar : u) && n.slot >= from && n.slot < to; });
      const v = U?.notes.find((x) => x.voice === n.voice);
      if (!v) { bad.push(`comp at ${n.node}: no chord voice of class ${n.voice}`); continue; }
      const p = pitch(toneOf(spec, n), n.octave), vp = pitch(toneOf(spec, v), v.octave);
      if (n.borrowed ? (n.octave !== v.octave || n.ratio !== v.ratio) : Math.abs(p - vp) > 600 + 1e-6) bad.push(`comp at ${n.node} (${n.borrowed ? 'borrowed' : 'strum'}): ${p.toFixed(0)}¢ against its voice's ${vp.toFixed(0)}¢`);
      if (n.lane !== v.lane) bad.push(`comp at ${n.node}: lane ${n.lane}, its voice's ${v.lane}`);
    }
  }
  // only octaves change: every chords and comp note the onset close plays, with its class and time
  if (close) for (const id of ['chords', 'comp']) {
    const sig = (p) => p.notes.map((n) => `${n.node}:${n.voice}:${n.time}:${n.ratio}:${n.velocity}:${n.borrowed ? n.from : ''}`).sort().join(',');
    if (sig(spec.parts.find((p) => p.id === id)) !== sig(close.parts.find((p) => p.id === id))) bad.push(`${id}: not the onsets 'close' plays`);
  }
  return bad;
}
/** a spec as voiced: motion over the bar lines, the wrap, the loop's total, muddy chords (P1), the cycle's cost (unrounded) */
function measure(spec) {
  const units = unitsOf(spec).filter((U) => U.notes.length);
  const ss = units.map((U) => U.notes.map((n) => heard(toneOf(spec, n), n.octave)));
  const pairs = units.map((U) => muddy(spec, U.notes.map((n) => toneOf(spec, n)), U.notes.map((n) => n.octave)));
  const c = cycleOf(ss);
  return { motion: Math.round(c.bars), wrap: Math.round(c.wrap), total: Math.round(c.total), muddy: pairs.filter((x) => x).length, chords: units.length, cost: c.total + BIG * pairs.reduce((x, y) => x + y, 0) };
}

const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 4], [[19, 17, 16, 15], 4], [[7, 5, 3, 2], 4], [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
const closeOf = (L, T, o = {}) => compose(L, T, { ...o, overrides: { ...o.overrides, voicing: 'close' } });
/** a 32-bar chart: every 4th bar split in two (40 chords) */
const CHART32 = Array.from({ length: 32 }, (_, b) => (b % 4 === 3 ? [1, 1] : [1]));

/** a spec's chord voices as the pass takes them (builder notes, from `src`'s octaves), its context and retune */
function passOf(spec, src = spec) {
  const { row, cells } = materialsOf(spec), K = spec.knobs, ctx = partContext(row, cells, { cycleSeconds: K.cycleSeconds, phase: K.phase, frameCentsEachSide: K.frameCentsEachSide });
  const toneIdx = new Map(row.tones.map((x, i) => [x, i]));
  const units = unitsOf(src).map((U) => ({ chord: { rootCents: row.toneCents[toneIdx.get(U.chord.rootTone)] }, notes: U.notes.map((n) => ({ voice: n.voice, tone: row.tone[n.node], octave: n.octave, pitch: 0, bar: n.bar, slot: n.slot, lane: n.lane })) }));
  const slotChord = spec.chords.some((c) => c.slots != null) ? spec.chords.flatMap((c) => Array.from({ length: c.slots }, () => c)) : null;
  const ratioOf = (bar, slot) => (slotChord ? slotChord[slot] : spec.chords[bar]).fundamentalRatio;
  return { units, ctx, ratioOf };
}
/** the pass's time on a spec's chord voices: the median of 7 runs (ms) */
function timeOf(spec) {
  const ts = [];
  for (let r = 0; r < 7; r++) { const { units, ctx, ratioOf } = passOf(spec); const t0 = performance.now(); voiceLead(ctx, units, { baseHz: spec.knobs.baseHz, ratioOf }); ts.push(performance.now() - t0); }
  return ts.sort((a, b) => a - b)[3];
}

// ── the probe rows ──
console.log('\n— the probe rows (seeds 1–3): led against the brute force, close before; the greedy pass (phase F) for the wrap');
{
  const tot = { close: { total: 0, muddy: 0, chords: 0 }, led: { total: 0, muddy: 0, chords: 0 } };
  let ok = 0, n = 0, cheaper = 0, never = true; const bad = [];
  for (const [L, T] of ROWS) for (const seed of [1, 2, 3]) {
    const led = compose(L, T, { seed }), close = closeOf(L, T, { seed });
    const b = audit(led, close); n++; if (!b.length) ok++; else bad.push(`${L.join(':')} s${seed}: ${b[0]}`);
    const a = measure(close), z = measure(led), W = windowOf(led), g = greedyCost(W), cost = z.cost;
    if (g != null && cost > g + 1e-6) never = false;
    if (g != null && cost < g - 1) cheaper++;
    for (const k of ['total', 'muddy', 'chords']) { tot.close[k] += a[k]; tot.led[k] += z[k]; }
    if (seed === 1) console.log(`    · ${L.join(':').padEnd(12)} close ${String(a.motion).padStart(5)}¢ + wrap ${String(a.wrap).padStart(4)}¢, ${a.muddy}/${a.chords} muddy → greedy ${g == null ? '—' : String(Math.round(g)).padStart(5)}¢ the loop → led ${String(z.motion).padStart(5)}¢ + wrap ${String(z.wrap).padStart(4)}¢ = ${z.total}¢, ${z.muddy}/${z.chords} muddy (lifted ${led.stats.voicing.lifted})`);
  }
  console.log(`    · all: close ${tot.close.total}¢ over the loop, ${tot.close.muddy}/${tot.close.chords} chords muddy → led ${tot.led.total}¢, ${tot.led.muddy}/${tot.led.chords}`);
  check(`${ok}/${n} composes: octaves (the brute force's over every cycle), cost, mud, window, lanes and the comp's octaves; only octaves differ from close`, ok === n, bad.slice(0, 3).join('; '));
  check(`led moves less than close over the probe's loops (${tot.led.total}¢ < ${tot.close.total}¢) and leaves no chord muddy (${tot.led.muddy})`, tot.led.total < tot.close.total && tot.led.muddy === 0);
  check(`the wrap counted: the loop never costs more than the greedy pass, and less on ${cheaper} of ${n} composes`, never && cheaper >= 3);
}

// ── more rows, overrides, a MIDI-free spread: the brute force holds everywhere ──
console.log('\n— more rows and knobs');
{
  const cases = [[[9, 8, 7], 4, {}], [[5, 4, 3], 4, {}], [[13, 11, 7], 6, {}], [[16, 12, 9], 6, {}], [[41, 42, 43], 8, { bars: 4 }], [[97, 103, 37], 5, {}],
    [[426, 317, 285], 8, {}], [[11, 9, 7, 5], 8, { bars: 8 }], [[119, 42, 15, 8], 8, { compRelation: 'fill' }], [[768, 784], 8, { modulation: false }], [[8, 7, 6, 5], 4, { compStyle: 'notes' }], [[19, 17, 16, 15], 4, { baseHz: 60 }]];
  let ok = 0; const bad = [];
  for (const [L, T, ov] of cases) { const led = compose(L, T, { seed: 1, overrides: ov }); const b = led.refused ? ['refused'] : audit(led, closeOf(L, T, { seed: 1, overrides: ov })); if (!b.length) ok++; else bad.push(`${L.join(':')} ${J(ov)}: ${b[0]}`); }
  check(`${ok}/${cases.length} more composes the brute force's (a low baseHz, modulation off, Fill, 8 bars, comp in notes)`, ok === cases.length, bad.slice(0, 3).join('; '));
  const low = compose([19, 17, 16, 15], 4, { seed: 1, overrides: { baseHz: 60 } });
  check(`a low baseHz (60 Hz) lifts the first chord (lifted ${low.stats.voicing.lifted})`, low.stats.voicing.lifted >= 1);
}

// ── a chart: the spans each a chord ──
console.log('\n— a chart');
{
  const charts = [[[11, 9, 7, 5], 4, [[1, 1], [1], [2, 1], [1]]], [[119, 42, 15, 8], 8, [[1, 1], [1, 1], [1], [3, 1]]], [[768, 784], 8, [[1], [1, 1, 1], [1, 1], [1]]],
    [[8, 7, 6, 5], 4, [[1], [1]]], [[768, 784], 8, CHART32], [[119, 42, 15, 8], 8, CHART32]];
  let ok = 0; const bad = [];
  for (const [L, T, changes] of charts) { const led = compose(L, T, { seed: 1, changes }), b = audit(led, closeOf(L, T, { seed: 1, changes })); if (!b.length) ok++; else bad.push(`${L.join(':')} (${changes.length} bars): ${b[0]}`); }
  check(`${ok}/${charts.length} charts (split bars, a span a chord; 32 bars) the brute force's, or the least cycle's cost past 4 chords`, ok === charts.length, bad.slice(0, 3).join('; '));
}

// ── close ──
console.log('\n— voicing: \'close\'');
{
  const cases = [[[8, 7, 6, 5], 4, {}], [[11, 9, 7, 5], 6, {}], [[119, 42, 15, 8], 8, { compLayer: 'B' }], [[768, 769], 8, { legato: { comp: true } }], [[41, 42, 43], 8, { bars: 2 }]];
  let same = 0;
  for (const [L, T, ov] of cases) for (const seed of [1, 4]) {
    const live = compose(L, T, { seed, overrides: { ...ov, compStyle: 'notes', voicing: 'close' } });
    delete live.input.overrides.compStyle; delete live.input.overrides.voicing;
    if (J(live) === J(composeBefore(L, T, { seed, overrides: ov }))) same++;
  }
  check(`'close' with the comp in notes: ${same}/${cases.length * 2} byte for byte the frozen Compose (fixtures/compose-before.js)`, same === cases.length * 2);
  // with the comp in chords: stacked close from an octave under the root, each voice the lowest above the one under it
  let stacked = 0, total = 0;
  for (const [L, T] of ROWS) {
    const s = closeOf(L, T, { seed: 1 }); total++;
    const fine = unitsOf(s).every((U) => { let floor = centsOf(U.chord.rootTone) - 1250; return U.notes.every((n) => { const o = Math.ceil((floor - centsOf(n.ratio)) / 1200 - 1e-9); floor = centsOf(n.ratio) + 1200 * o + 1; return o === n.octave && n.lane === undefined; }); });
    const comp = s.parts.find((p) => p.id === 'comp').notes.every((n) => n.lane === undefined);
    if (fine && comp && !s.stats.voicing && !s.decisions.some((d) => d.what === 'voicing')) stacked++;
  }
  check(`'close' with the comp in chords: ${stacked}/${total} stacked close as before, no lane, no voicing stats or decision`, stacked === total);
  check('a bad voicing throws', (() => { try { compose([8, 7, 6, 5], 4, { overrides: { voicing: 'open' } }); return false; } catch (e) { return /voicing must be one of led, close/.test(e.message); } })());
  const asked = compose([11, 9, 7, 5], 4, { seed: 1, overrides: { voicing: 'led' } }), dflt = compose([11, 9, 7, 5], 4, { seed: 1 });
  check('\'led\' asked is the default\'s parts, the decision saying "asked"', J(asked.parts) === J(dflt.parts) && /^asked/.test(asked.decisions.find((d) => d.what === 'voicing').why));
}

// ── the stats, the decision, the trace, the wrap (P9, P25) ──
console.log('\n— stats, decision and trace');
{
  for (const [L, T] of [[[768, 769], 8], [[119, 42, 15, 8], 8], [[11, 9, 7, 5], 4]]) {
    const s = compose(L, T, { seed: 1 }), v = s.stats.voicing, m = measure(s);
    check(`${L.join(':')} stats.voicing: ${v.chords} chords, motion ${v.motion}¢ and the wrap ${v.wrap}¢ (${v.meanMotion}¢ a chord over the loop's ${v.chords} changes), lifted ${v.lifted}, muddy ${v.muddy} — the brute force's measure (${m.motion}¢, wrap ${m.wrap}¢)`,
      v.mode === 'led' && v.chords === m.chords && Math.abs(v.motion - m.motion) <= 1 && Math.abs(v.wrap - m.wrap) <= 1 && Math.abs(v.meanMotion - (v.motion + v.wrap) / v.chords) <= 1 && v.muddy === m.muddy);
  }
  const s = compose([768, 769], 8, { seed: 1 }), v = s.stats.voicing;
  const d = s.decisions.find((x) => x.what === 'voicing');
  check('the decision says the loop closed, the chords the mud limit moved, the motion a chord and the wrap, led', d && d.value === 'led' && /the loop closed/.test(d.why) && d.why.includes(`moved ${v.lifted} of ${v.chords}`) && /¢ of motion a chord/.test(d.why) && d.why.includes(`the loop's wrap ${v.wrap}¢ (led`));
  const idx = s.decisions.findIndex((x) => x.what === 'voicing'), close = closeOf([768, 769], 8, { seed: 1 });
  check('without it, the decisions are close\'s in the same order', J(s.decisions.filter((x) => x.what !== 'voicing').map((x) => x.what)) === J(close.decisions.map((x) => x.what)) && idx > 0);
  const t = compose([768, 769], 8, { seed: 1, trace: true }), { trace, ...rest } = t;
  check('the trace observes: the spec without it is byte for byte the one composed with it off', J(rest) === J(s));
  const part = trace.events.find((e) => e.kind === 'part' && e.part === 'chords');
  check('the trace\'s chords part says the voicing and each note\'s lane', J(part.voicing) === J(v) && part.notes.every((n) => Number.isInteger(n.lane)));
}

// ── a one-chord loop, a MIDI target's cut ──
console.log('\n— a one-chord loop; a MIDI target');
{
  const one = compose([7, 5, 3, 2], 4, { seed: 1 }), W = windowOf(one), v = one.stats.voicing, d = one.decisions.find((x) => x.what === 'voicing');
  check(`7:5:3:2, one chord: no wrap (${v.wrap}¢, ${v.meanMotion}¢ a chord), the anchor itself (${J(W.anchor)}), the brute force's; the decision says so`,
    v.chords === 1 && v.wrap === 0 && v.motion === 0 && v.meanMotion === 0 && J(unitsOf(one)[0].notes.map((n) => n.octave)) === J(W.anchor) && !audit(one, closeOf([7, 5, 3, 2], 4, { seed: 1 })).length && /one chord, so no wrap/.test(d.why));
  const clip = (name) => decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === name))));
  let ok = 0, n = 0; const bad = [];
  for (const name of ['twinkle', 'ode-to-joy', 'frere-jacques']) for (const [L, T] of [[[8, 7, 6, 5], 4], [[119, 42, 15, 8], 8]]) {
    const s = compose(L, T, { seed: 1, target: { clip: clip(name) } }); n++;
    if (s.refused) { bad.push(`${name} on ${L.join(':')}: refused`); continue; }
    const b = audit(s), m = measure(s);
    // the cut's own bars are the loop: its last chord back to its first
    if (s.stats.voicing.chords !== s.knobs.bars || m.chords !== s.knobs.bars) b.push(`${s.stats.voicing.chords} chords voiced, the cut's ${s.knobs.bars} bars`);
    if (Math.abs(s.stats.voicing.wrap - m.wrap) > 1) b.push(`wrap ${s.stats.voicing.wrap}¢, the cut's last bar to its first ${m.wrap}¢`);
    if (!b.length) ok++; else bad.push(`${name} on ${L.join(':')}: ${b[0]}`);
  }
  check(`${ok}/${n} MIDI targets: the cut's bars are the loop (its last back to its first), the brute force's`, ok === n, bad.slice(0, 3).join('; '));
}

// ── running it again on its own output ──
console.log('\n— idempotent');
{
  let same = 0, n = 0;
  for (const [L, T, o = {}] of [...ROWS, [[11, 9, 7, 5], 4, { changes: [[1, 1], [1], [2, 1], [1]] }], [[768, 784], 8, { changes: CHART32 }]]) {
    const led = compose(L, T, { seed: 1, ...o }), { units, ctx, ratioOf } = passOf(led, led); n++;
    const before = J(units.map((U) => U.notes.map((x) => [x.octave, x.lane])));
    voiceLead(ctx, units, { baseHz: led.knobs.baseHz, ratioOf });
    if (J(units.map((U) => U.notes.map((x) => [x.octave, x.lane]))) === before) same++;
  }
  check(`${same}/${n} led voicings: the pass run again on its own output changes nothing`, same === n);
}

// ── lanes in the player and the MIDI ──
console.log('\n— lanes: legato, the player\'s chains, the MIDI zones');
{
  const s = compose([119, 42, 15, 8], 8, { seed: 1 }), T = s.knobs.cycleSeconds;
  const ch = s.parts.find((p) => p.id === 'chords'), comp = s.parts.find((p) => p.id === 'comp');
  // legato on: a chord note holds to its lane's next note
  const byLane = (p) => { const g = new Map(); for (const n of p.notes) { if (!g.has(n.lane)) g.set(n.lane, []); g.get(n.lane).push(n); } return g; };
  let held = true;
  for (const [, notes] of byLane(ch)) notes.forEach((n, i) => { const next = i + 1 < notes.length ? notes[i + 1].time : T; if (Math.abs(n.duration - (next - n.time)) > 1e-9) held = false; });
  check('chords legato: each note holds to its lane\'s next note (P6)', held);
  const chains = chainsOf(ch);
  check(`the player's chains are a lane's each (${chains.length} chains)`, chains.every((c) => c.notes.every((n) => n.lane === c.voice)));
  const mid = midiNotesOf(comp, T), midC = midiNotesOf(ch, T);
  check('the MIDI chords and comp zones put a note on its lane\'s member channel', [...midC, ...mid].every((x) => Number.isInteger(x.voice)) && midC.length === ch.notes.length && new Set(ch.notes.map((n) => channelOf('chords', n.lane))).size === new Set(ch.notes.map((n) => n.lane)).size);
  const lanes = [...byLane(ch).values()], steps = lanes.flatMap((notes) => notes.slice(1).map((n, i) => Math.abs(1200 * Math.log2(n.hz / notes[i].hz))));
  const byVoice = new Map(); for (const n of ch.notes) { if (!byVoice.has(n.voice)) byVoice.set(n.voice, []); byVoice.get(n.voice).push(n); }
  const vsteps = [...byVoice.values()].flatMap((notes) => notes.slice(1).map((n, i) => Math.abs(1200 * Math.log2(n.hz / notes[i].hz))));
  console.log(`    · 119:42:15:8: a channel's mean step ${mean(steps).toFixed(0)}¢ laned by lane, ${mean(vsteps).toFixed(0)}¢ by class`);
  check('a lane moves by smaller steps than a class would', mean(steps) <= mean(vsteps) + 1e-9);
}

// ── a chord swap and a clave switch ──
console.log('\n— a chord swap, a clave switch');
{
  let ok = 0, n = 0, moved = 0, before = 0; const bad = [];
  for (const [L, T] of [[[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8], [[11, 9, 7, 5], 4], [[19, 17, 16, 15], 4]]) {
    const s = compose(L, T, { seed: 1 }), { row, cells } = materialsOf(s);
    for (let k = 0; k < s.knobs.bars; k++) for (const root of ['1/1', s.chords[(k + 1) % s.knobs.bars].rootTone]) {
      const r = rearrange(s, row, cells, { bar: k, chord: { rootTone: root, quality: 'major_triad' } }); n++;
      const next = applyRearrange(s, r), b = audit(next);
      // tones unchanged outside the bar; revoicedBars the other bars whose octaves moved
      const sig = (spec, bar, f) => spec.parts.find((p) => p.id === 'chords').notes.filter((x) => x.bar === bar).map(f).join(',');
      const moves = [];
      for (let j = 0; j < s.knobs.bars; j++) {
        if (r.changedBars.includes(j)) continue;
        if (sig(s, j, (x) => `${x.node}:${x.voice}`) !== sig(next, j, (x) => `${x.node}:${x.voice}`)) b.push(`bar ${j}: tones changed outside the swap`);
        if (sig(s, j, (x) => x.octave) !== sig(next, j, (x) => x.octave)) moves.push(j);
      }
      if (J(moves) !== J(r.revoicedBars ?? [])) b.push(`revoicedBars ${J(r.revoicedBars)}, the bars that moved ${J(moves)}`);
      moved += moves.length; before += moves.filter((j) => j < k).length;
      const back = JSON.parse(J(s)), m2 = materialsOf(back), r2 = rearrange(back, m2.row, m2.cells, { bar: k, chord: { rootTone: root, quality: 'major_triad' } });
      if (J(r2) !== J(r)) b.push('a JSON round trip rearranges otherwise');
      if (!b.length) ok++; else bad.push(`${L.join(':')} bar ${k} → ${root}: ${b[0]}`);
    }
    // a swap to the chord it has: the spec byte for byte
    const same = rearrange(s, row, cells, { bar: 0, chord: { rootTone: s.chords[0].rootTone, quality: s.chords[0].quality } });
    if (J(same.parts) !== J(s.parts) || (same.revoicedBars ?? []).length) bad.push(`${L.join(':')}: a swap to its own chord moved something`);
  }
  check(`${ok}/${n} chord swaps: the brute force's voicing after, tones unchanged outside the bar, revoicedBars exact (${moved} bars revoiced, ${before} of them before the swap), a JSON round trip the same`, ok === n && !bad.length, bad.slice(0, 3).join('; '));
  // a chart's span swap
  const c = compose([119, 42, 15, 8], 8, { seed: 1, changes: [[1, 1], [1, 1], [1], [3, 1]] }), mc = materialsOf(c);
  const rc = rearrange(c, mc.row, mc.cells, { span: 1, chord: { rootTone: '1/1', quality: 'minor_triad' } });
  check('a chart\'s span swap: the brute force\'s voicing after', !audit(applyRearrange(c, rc)).length, audit(applyRearrange(c, rc))[0]);
  // the clave switch: equal to a Compose with the same override, comp and drums byte for byte
  let eq = 0, m = 0;
  for (const [L, T] of [[[119, 42, 15, 8], 8], [[768, 784], 8], [[11, 9, 7, 5], 4]]) {
    const s = compose(L, T, { seed: 1 }), { row, cells } = materialsOf(s);
    for (const edit of [{ relation: 'fill' }, { clave: 'son' }, { clave: 'bossa', relation: 'fill' }]) {
      m++;
      const r = reclave(s, row, cells, edit), full = compose(L, T, { seed: 1, overrides: { ...(edit.clave ? { clave: edit.clave } : {}), ...(edit.relation ? { compRelation: edit.relation } : {}) } });
      if (J(r.parts.find((p) => p.id === 'comp')) === J(full.parts.find((p) => p.id === 'comp')) && J(r.drums) === J(full.drums)) eq++;
    }
  }
  check(`${eq}/${m} clave switches equal a Compose with the same override (the comp's octaves from the led chords)`, eq === m);
}

// ── the 16k row, and the budget ──
console.log('\n— the 16,359-onset row; the budget');
{
  const L = [4099, 4093, 4091, 4079], T = 16;
  let t0 = performance.now(); const led = compose(L, T, { seed: 1 }); const tLed = performance.now() - t0;
  t0 = performance.now(); const close = closeOf(L, T, { seed: 1 }); const tClose = performance.now() - t0;
  const b = audit(led, close), a = measure(close), z = measure(led);
  console.log(`    · 16k: close ${a.motion}¢ + wrap ${a.wrap}¢, ${a.muddy}/${a.chords} muddy → led ${z.motion}¢ + wrap ${z.wrap}¢, ${z.muddy}/${z.chords}`);
  check('16k: the least cycle (an independent Viterbi), mud, window, lanes, the comp', !b.length, b[0]);
  // the pass over the close chord voices: the same octaves (it reads only the tones)
  const p = passOf(led, close);
  voiceLead(p.ctx, p.units, { baseHz: led.knobs.baseHz, ratioOf: p.ratioOf });
  check('16k: the pass over the close voices gives the led octaves', J(p.units.flatMap((U) => U.notes.map((n) => n.octave))) === J(unitsOf(led).flatMap((U) => U.notes.map((n) => n.octave))));
  check(`16k: Compose lean ${tLed.toFixed(0)} ms led, ${tClose.toFixed(0)} ms close (led under 1.5 s, and within 10 % + 50 ms of close)`, tLed < 1500 && tLed < 1.1 * tClose + 50);
  // the budget: ≤ 5 ms a pass (the median of 7) on every test row and on a 32-bar chart over this row
  const chart = compose(L, T, { seed: 1, changes: CHART32 }), cb = audit(chart);
  check(`16k as a 32-bar chart (${chart.stats.voicing.chords} chords): the least cycle (an independent Viterbi), mud, window, lanes`, !cb.length, cb[0]);
  const times = [];
  for (const [L2, T2, o = {}] of [...ROWS, [[11, 9, 7, 5], 4, { changes: [[1, 1], [1], [2, 1], [1]] }], [[768, 784], 8, { changes: CHART32 }], [[119, 42, 15, 8], 8, { changes: CHART32 }]]) {
    const s = compose(L2, T2, { seed: 1, ...o });
    times.push([`${L2.join(':')}${o.changes ? ` (${o.changes.length}-bar chart)` : ''}`, timeOf(s)]);
  }
  times.push(['16k', timeOf(led)], ['16k (32-bar chart)', timeOf(chart)]);
  console.log(`    · ${times.map(([k, t]) => `${k} ${t.toFixed(2)} ms`).join(', ')}`);
  const worst = Math.max(...times.map(([, t]) => t));
  check(`the budget: every pass ≤ 5 ms (the median of 7; the worst ${worst.toFixed(2)} ms)`, worst <= 5);
}

console.log(PASS ? `\n✓✓✓ VOICE-LED CHORDS PASS (${checks} checks)` : `\n✗ VOICE-LED CHORDS FAILED`);
process.exit(PASS ? 0 : 1);
