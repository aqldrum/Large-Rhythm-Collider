// assert-frame-clave.mjs — the frame clave (Composer/BASS_VOICING_ORDER.md Amendment 1, phase I: Avery's rule 6, P16–P21):
// claves.js' frame candidates, compose.js' clave read after the chords (`claveFrom: 'frame'`, the default), rearrange.js'
// chord swap and clave switch over it. Every spec is checked against a brute force written from the order, not from
// claves.js:
//   • P16: each layer's strikes a bar by place (its slot plus its share of the slot); read at n = its strikes a bar when
//     3 ≤ n ≤ 16, at each n of 3–16 when denser, not under 3; step j the bar's j-th strike when it holds n, else its
//     strike nearest k·S + j·S/n (ties: the earlier); 'chord' (a chord class within ±e of its centre from the root) and
//     'frame' (any class within ±e) read under the chord of the strike's own slot (a chart's span's); COMP_RULES over the
//     bars' patterns (density, fit by n, recurrence: the bars whose pattern another bar repeats; a pulse bar or one under
//     2 onsets scoring 0); the chosen clave among the brute force's best (ties by the seed), its patterns and strokes
//     the brute force's: every stroke the clave layer's own strike at its step, at its own time, its tone in the set
//   • P17: Fill's partner the brute force's best-ranked other candidate with a stroke and none within ¼ slot of the
//     clave's; with none, each bar's free steps Euclid-thinned to the clave's mean onsets a bar, landed in frame
//   • P18: the curated and asked claves keep their pattern, each step on the in-frame onset nearest its place within
//     half-way to its neighbours (then one place wider), inside its bar or span, else silent
//   • P19: `claveFrom: 'pattern'` byte for byte the clave before phase I (fixtures/clave-pattern.mjs, made at c009aaa)
//   • P20: a chord swap moves only its bar's strokes, those the brute force's under the new chord; the comp re-strums
//     there, the perc follows, `reclavedBars` names it; a clave switch equal to a Compose given that clave (rows, a chart's
//     split bars, a MIDI target)
//   • P21: the words: the source ("layer A · 8 steps · chord tones"), each bar's pattern, in the decision and the trace
//   • Amendment 2 (P26–P27, P30–P31): the narrower sets (root and fifth, guide tones, roots; a twin of a wider set's
//     reading dropped) and the density tiers (sparse 10–25 %, medium 25–50 %, dense 50–85 %; 'sparse-med' the default)
//     against the brute force on 8 rows × the 4 densities × 2 seeds, every stroke in frame; the nearest-tier fall-back
//     and its words; the trace's density; the alternates re-ranked over the chords as they play after a chord swap, a
//     typed chord and a lead follow (the brute force's, equal to a Compose pinning the same chords); a density switch
//     equal to a Compose given that compDensity. (P19's hashes were made with the bass before Amendment 2, so its
//     Composes ask for it: `bass: { density: 'sparse', lock: 'free' }`)
//   • the probe's table (each row's chosen candidate, its patterns, strokes in frame), the default tier's table, and the
//     16,359-onset row's cost
//   node Composer/tests/assert-frame-clave.mjs
import crypto from 'node:crypto';
import { buildRow } from '../core/row.js';
import { compose, partContext } from '../core/compose.js';
import { classOfCents } from '../core/frame.js';
import { euclidPattern } from '../core/cells.js';
import { claveText, claveSource, claveOf, rankFrameClaves, chooseFrameClave, COMP_RULES } from '../core/claves.js';
import { rearrange, reclave, applyRearrange, materialsOf, chordRecordsOf } from '../core/rearrange.js';
import { decodeClip, readMidi } from '../core/midi.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';
import { CASES, HASHES } from './fixtures/clave-pattern.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const EPS = 1e-9;

console.log('═══ COMPOSER — the frame clave (BASS_VOICING_ORDER.md phase I) ═══');

// ── the order's rules, written out ──
const RULES = { minSize: 3, maxSize: 16, minOnsets: 2, lo: 0.25, hi: 0.5, straight: [4, 8, 16], triplet: [3, 6, 12] };
const SHARE = 0.25;
const ODE = () => ({ clip: decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'ode-to-joy')))) });

/** a composition's geometry as the brute force reads it: its slots, each onset's place, its chords by slot */
function geometry(spec) {
  const { row, cells } = materialsOf(spec), K = spec.knobs, S = K.slotsPerBar, N = K.bars, P = N * S, e = K.frameCentsEachSide;
  const ctx = partContext(row, cells, { cycleSeconds: K.cycleSeconds, phase: K.phase, frameCentsEachSide: e, ...(K.rowCycleSeconds != null ? { rowCycleSeconds: K.rowCycleSeconds } : {}) });
  const W = cells.crop ? cells.crop.end : 1, phaseX = K.phase[0] / K.phase[1];
  const recs = chordRecordsOf(spec, row, cells);
  const chordAt = (slot) => (recs[0].slots != null ? recs.find((c) => slot >= c.from && slot < c.from + c.slots) : recs[Math.floor(slot / S)]);
  const rel = (i) => mod(row.x[i] - phaseX, 1);
  const place = (i) => { const j = ctx.posSlot[i], a = ctx.starts[j], b = j + 1 < P ? ctx.starts[j + 1] : W; return j + Math.min(Math.max((rel(i) - a) / (b - a), 0), 1 - 1e-9); };
  const rAt = (q) => { if (q <= 0) return ctx.starts[0]; if (q >= P) return W; const k = Math.min(P - 1, Math.floor(q)); return ctx.starts[k] + (q - k) * ((k + 1 < P ? ctx.starts[k + 1] : W) - ctx.starts[k]); };
  // the set tests, from the cents: a class within ±e of its centre measured from the chord's root
  const classOf = (c, i) => classOfCents(row.toneCents[row.tone[i]] - row.toneCents[recs.find((x) => x === c).rootTone]);
  const inFrame = (i) => Math.abs(classOf(chordAt(ctx.posSlot[i]), i).dev) <= e + EPS;
  const onChord = (i) => { const c = chordAt(ctx.posSlot[i]), k = classOf(c, i); return Math.abs(k.dev) <= e + EPS && c.intervals.includes(k.pc); };
  const units = recs[0].slots != null ? recs.map((c) => ({ from: c.from, to: c.from + c.slots })) : Array.from({ length: N }, (_, k) => ({ from: k * S, to: (k + 1) * S }));
  return { spec, row, cells, ctx, K, S, N, P, e, W, recs, chordAt, rel, place, rAt, inFrame, onChord, units, classOf };
}

/** the first node at a tick (a superrow's tick holds several), by a scan of the sorted ticks */
const firstAt = (row, tick) => { let lo = 0, hi = row.n; while (lo < hi) { const m = (lo + hi) >> 1; if (row.tick[m] < tick) lo = m + 1; else hi = m; } return row.tick[lo] === tick ? lo : -1; };

/** the tiers (Amendment 2, P27), written out: a share's tier, each density's band, the nearest tiers in turn */
const BANDS = { 'sparse-med': [0.1, 0.5], sparse: [0.1, 0.25], medium: [0.25, 0.5], dense: [0.5, 0.85] };
const NEAREST = { 'sparse-med': ['dense'], sparse: ['medium', 'dense'], medium: ['sparse', 'dense'], dense: ['medium', 'sparse'] };
const tierOfShare = (x) => (x < 0.1 - EPS || x > 0.85 + EPS ? null : x < 0.25 - EPS ? 'sparse' : x <= 0.5 + EPS ? 'medium' : 'dense');
const inDensity = (tier, d) => tier != null && (d === 'sparse-med' ? tier === 'sparse' || tier === 'medium' : tier === d);
/** the sets (P16, P26), from the cents: a class within ±e of its centre from the chord's root; the fifth its 6–8 interval */
const SETS = ['chord', 'frame', 'root+5th', 'guide', 'root'];
function setTest(G, set) {
  const k = (i) => { const c = G.chordAt(G.ctx.posSlot[i]); return { c, q: G.classOf(c, i) }; };
  const inTune = (q) => Math.abs(q.dev) <= G.e + EPS, fifth = (c) => c.intervals.find((x) => x >= 6 && x <= 8) ?? -1;
  if (set === 'frame') return (i) => inTune(k(i).q);
  return (i) => {
    const { c, q } = k(i);
    if (!inTune(q) || !c.intervals.includes(q.pc)) return false;
    return set === 'chord' ? true : set === 'root' ? q.pc === 0 : set === 'root+5th' ? q.pc === 0 || q.pc === fifth(c) : q.pc !== 0 && q.pc !== fifth(c);
  };
}

/** P16, P26–P27 by brute force: every reading, and the asked density's ranking (`density`, default 'sparse-med')
 *  → { list (the tier that plays, ranked), all (every reading, scored against that tier's band; the ranking's leftovers
 *  too: a wider set's twin, a reading with no bar left in), played, fellBack } */
function bruteRank(G, density = 'sparse-med') {
  const { row, ctx, S, N } = G, read = [];
  // the layers fastest first (equal values: the later letter first)
  const layers = [...row.active].sort((a, b) => row.layers[b] - row.layers[a] || b - a);
  for (const b of layers) {
    const v = row.layers[b], period = row.grid / v, bars = Array.from({ length: N }, () => []);
    let total = 0;
    for (let k = 0; k < v; k++) { const i = firstAt(row, k * period); if (ctx.posSlot[i] < 0) continue; bars[Math.floor(ctx.posSlot[i] / S)].push({ node: i, place: G.place(i) }); total++; }
    for (const list of bars) list.sort((x, y) => x.place - y.place || x.node - y.node);
    const m = Math.round(total / N), grains = m < 3 ? [] : m <= 16 ? [m] : Array.from({ length: 14 }, (_, x) => x + 3);
    for (const n of grains) {
      const earlier = [];
      for (const set of SETS) {
        const test = setTest(G, set), patterns = [], strokes = [];
        for (let k = 0; k < N; k++) {
          const st = bars[k], took = new Set();
          let p = '';
          for (let j = 0; j < n; j++) {
            let s = null;
            if (st.length === n) s = st[j];
            else { const q = k * S + (j * S) / n; for (const x of st) if (!s || Math.abs(x.place - q) < Math.abs(s.place - q) - EPS) s = x; }
            const on = !!s && test(s.node);
            p += on ? 'x' : '.';
            if (on && !took.has(s.node)) { took.add(s.node); strokes.push({ bar: k, step: j, node: s.node }); }
          }
          patterns.push(p);
        }
        // a reading equal to an earlier (wider) set's at this layer and grain is that set's
        const twin = earlier.some((q) => J(q) === J(patterns));
        earlier.push(patterns);
        const ons = patterns.map((p) => [...p].filter((ch) => ch === 'x').length), counted = ons.map((o) => o >= RULES.minOnsets && o < n);
        const share = ons.reduce((a, o) => a + o, 0) / (n * N);
        read.push({ id: `frame:${'ABCD'[b]}/${n}/${set}`, n, set, patterns, strokes, ons, counted, share, tier: tierOfShare(share), kept: !twin && counted.some(Boolean) });
      }
    }
  }
  // the score: density the bars' mean against [lo, hi], fit by n, recurrence the bars whose pattern another repeats
  const score = (c, [lo, hi]) => {
    let density = 0, held = 0;
    c.ons.forEach((o, k) => { if (!c.counted[k]) return; const x = o / c.n; density += x < lo ? x / lo : x > hi ? (1 - x) / (1 - hi) : 1; });
    c.patterns.forEach((p, k) => { if (c.counted[k] && c.patterns.some((q, k2) => k2 !== k && c.counted[k2] && q === p)) held++; });
    const fit = RULES.straight.includes(c.n) ? 1 : RULES.triplet.includes(c.n) ? 0.75 : 0.4;
    return (held / N + density / N + fit) / 3;
  };
  const kept = read.filter((c) => c.kept), played = [density, ...NEAREST[density]].find((d) => kept.some((c) => inDensity(c.tier, d))) ?? null;
  const band = played ? BANDS[played] : [RULES.lo, RULES.hi];
  const all = read.map((c, x) => ({ ...c, x, score: score(c, band) }));
  const list = all.filter((c) => c.kept && (!played || inDensity(c.tier, played))).sort((a, b) => b.score - a.score || a.x - b.x);
  return { list, all, played, fellBack: played !== density };
}
/** the ranking's candidates (P16 by brute force: `all` every reading) */
const bruteCandidates = (G, { all = false, density = 'sparse-med' } = {}) => (all ? bruteRank(G, density).all : bruteRank(G, density).list);

/** the least distance between a stroke of a and one of b, in slots round the loop */
const nearest = (G, a, b) => { let d = Infinity; for (const x of a) for (const y of b) { const q = Math.abs(G.place(x.node) - G.place(y.node)); d = Math.min(d, q, G.P - q); } return d; };

/** P18 by brute force: a place's in-frame onset, the nearest within ±h (then ±2h) in the cycle's share, inside its unit */
function bruteLand(G, place, h) {
  const { row, ctx, units } = G, slot = Math.min(G.P - 1, Math.floor(place + EPS)), u = units.find((x) => slot >= x.from && slot < x.to);
  if (!u) return null;
  const r = G.rAt(place), a = G.rAt(u.from), b = G.rAt(u.to) - 2e-12;
  for (const w of [h, 2 * h]) {
    const lo = Math.max(a, G.rAt(place - w)), hi = Math.min(b, G.rAt(place + w));
    let best = null;
    for (let i = 0; i < row.n; i++) {
      const s = ctx.posSlot[i];
      if (s < u.from || s >= u.to || !G.inFrame(i)) continue;
      const x = G.rel(i);
      if (x < lo - 1e-12 || x > hi + 1e-12) continue;
      if (!best || Math.abs(x - r) < Math.abs(best.d) - 1e-15 || (Math.abs(Math.abs(x - r) - Math.abs(best.d)) <= 1e-15 && (x - r < best.d || (x - r === best.d && i < best.node)))) best = { node: i, d: x - r };
    }
    if (best) return best.node;
  }
  return null;
}

/** a frame clave's strokes as the brute force keys them */
const keyOf = (strokes) => J(strokes.map((x) => [x.bar, x.step, x.node]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]));

/** audit one spec's frame clave against the brute force → [problem] */
function audit(spec) {
  const density = spec.input.overrides?.compDensity ?? 'sparse-med', G = geometry(spec), B = bruteRank(G, density);
  const bad = [], C = spec.clave, list = B.list;
  // the density it was chosen in (P27): asked, the tier the brute force plays, a fall-back
  if (J(C.compDensity) !== J({ asked: density, played: B.played, fellBack: B.fellBack })) bad.push(`compDensity ${J(C.compDensity)}, the brute force's ${density} → ${B.played}`);
  if (!C.from?.frame) return C.read === 'frame' ? [...bad, ...auditFixed(G, C, 'clave')] : ['not a frame clave'];
  const top = list.filter((c) => c.score >= list[0].score - EPS), mine = spec.input.overrides?.clave ? B.all.find((c) => c.id === C.id) : list.find((c) => c.id === C.id);
  if (!mine) return [`${C.id} is no candidate of the brute force's`];
  if (!spec.input.overrides?.clave && !top.includes(mine)) bad.push(`${C.id} (${mine.score.toFixed(4)}) is not among the best (${top.map((c) => c.id).join(', ')}, ${list[0].score.toFixed(4)})`);
  if (Math.abs(mine.score - C.score) > 1e-9) bad.push(`${C.id}'s score ${C.score} is not ${mine.score}`);
  if (J(mine.patterns) !== J(C.patterns)) bad.push(`${C.id}'s patterns ${claveText(C)}, the brute force's ${mine.patterns.join(' ')}`);
  if (keyOf(C.strokes) !== keyOf(mine.strokes)) bad.push(`${C.id}'s strokes are not the brute force's`);
  const v = spec.input.layers['ABCD'.indexOf(C.from.name)], period = G.row.grid / v;
  for (const x of C.strokes) {
    if (x.tick % period !== 0 || firstAt(G.row, x.tick) !== x.node) bad.push(`bar ${x.bar} step ${x.step}: not the layer's own strike`);
    if (!setTest(G, C.from.set)(x.node)) bad.push(`bar ${x.bar} step ${x.step}: its tone is out of the set`);
    if (!G.inFrame(x.node)) bad.push(`bar ${x.bar} step ${x.step}: out of frame`);
    if (Math.abs(x.time - G.ctx.timeOf(x.tick)) > 1e-12) bad.push(`bar ${x.bar} step ${x.step}: not at its own time`);
  }
  // P17: the partner
  const free = list.filter((c) => c.id !== C.id && c.strokes.length && nearest(G, c.strokes, C.strokes) > SHARE + EPS);
  const p = C.partner;
  if (free.length) {
    if (p.source !== 'partner' || p.id !== free[0].id) bad.push(`Fill's partner ${p.id} (${p.source}), the brute force's ${free[0].id}`);
    else if (keyOf(p.strokes) !== keyOf(free[0].strokes) || nearest(G, p.strokes, C.strokes) <= SHARE + EPS) bad.push('Fill\'s partner shares a stroke');
  } else {
    if (p.source !== 'complement') bad.push(`no partner clear of the clave, yet ${p.source} ${p.id}`);
    const n = C.steps, want = Math.round(C.patterns.reduce((a, q) => a + [...q].filter((ch) => ch === 'x').length, 0) / G.N), strokes = [];
    let silent = 0;
    C.patterns.forEach((q, k) => {
      const open = [...q].flatMap((ch, j) => (ch === 'x' ? [] : [j])), keep = euclidPattern(open.length, Math.min(want, open.length)), on = open.filter((_, i) => keep[i]);
      if (p.patterns[k] !== [...Array(n)].map((_, j) => (on.includes(j) ? 'x' : '.')).join('')) bad.push(`bar ${k}: the complement ${p.patterns[k]}`);
      for (const j of on) { const node = bruteLand(G, k * G.S + (j * G.S) / n, G.S / n / 2); if (node == null) silent++; else strokes.push({ bar: k, step: j, node }); }
    });
    if (keyOf(p.strokes) !== keyOf(strokes) || p.silent !== silent) bad.push(`the complement's strokes (${p.strokes.length}, ${p.silent} silent) are not the brute force's (${strokes.length}, ${silent})`);
  }
  return bad;
}
/** P18: a fixed clave (curated or asked) laid in frame, against the brute force's landing */
function auditFixed(G, C, what) {
  const bad = [], B = C.span ?? 1, wide = (G.S * B) / C.steps, strokes = [];
  let silent = 0;
  for (let pass = 0; pass * B < G.N; pass++) for (const j of C.onsets) {
    const place = pass * B * G.S + j * wide, bar = Math.floor(place / G.S + EPS);
    if (bar >= G.N) continue;
    const node = bruteLand(G, place, wide / 2);
    if (node == null) silent++; else strokes.push({ bar, step: j, node });
  }
  if (keyOf(C.strokes) !== keyOf(strokes) || C.silent !== silent) bad.push(`${what} ${C.id}: ${C.strokes.length} strokes (${C.silent} silent), the brute force's ${strokes.length} (${silent})`);
  for (const x of C.strokes) if (!G.inFrame(x.node)) bad.push(`${what} ${C.id}: a stroke out of frame`);
  return bad;
}

// ── P16–P17: the probe rows, charts and a MIDI target ──
console.log('\n— P16–P17: the clave read from the frames, against the brute force');
const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 4], [[19, 17, 16, 15], 4], [[7, 5, 3, 2], 4], [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8], [[16, 12, 9], 4]];
const CHARTS = [[[19, 17, 16, 15], 6, [[1, 1], [1], [2, 1], [1]]], [[8, 7, 6, 5], 4, [[1, 1], [1]]], [[119, 42, 15, 8], 8, [[1, 1], [1], [1, 1], [1]]]];
const table = [];
{
  const bad = []; let n = 0, strokes = 0, partners = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 2, 3]) for (const compRelation of ['sync', 'fill']) {
    const spec = compose(L, T, { seed, overrides: { compRelation } }); n++;
    for (const b of audit(spec)) bad.push(`${L.join(':')} seed ${seed} ${compRelation}: ${b}`);
    strokes += spec.clave.strokes.length; if (spec.clave.partner.source === 'partner') partners++;
    if (seed === 1 && compRelation === 'sync') {
      const G = geometry(spec), C = spec.clave, inF = C.strokes.filter((x) => G.inFrame(x.node)).length, onC = C.strokes.filter((x) => G.onChord(x.node)).length;
      table.push({ row: L.join(':'), meter: `${spec.knobs.bars} × ${spec.knobs.slotsPerBar}`, id: C.id, source: claveSource(C), text: claveText(C), score: C.score, inF, onC, n: C.strokes.length, partner: `${C.partner.source} ${claveText(C.partner)}` });
    }
  }
  check(`${n} composes (8 rows × 3 seeds × Sync, Fill): the clave among the brute force's best, its patterns and its ${strokes} strokes the brute force's, each the layer's own strike at its own time and in the set; Fill the brute force's partner (${partners / 2} of ${n / 2} a frame clave) or its complement landed in frame`, !bad.length, bad.slice(0, 4).join('; '));
}
{
  const bad = []; let n = 0;
  for (const [L, T, changes] of CHARTS) for (const compRelation of ['sync', 'fill']) { const spec = compose(L, T, { seed: 1, changes, overrides: { compRelation } }); n++; for (const b of audit(spec)) bad.push(`${L.join(':')} chart ${compRelation}: ${b}`); }
  const tg = compose([41, 42, 43], 8, { seed: 1, target: ODE() }); n++;
  for (const b of audit(tg)) bad.push(`41:42:43 target: ${b}`);
  check(`${n} charts with split bars and a MIDI target: each strike read under its own span's chord, the window's loop read as its bars`, !bad.length, bad.slice(0, 4).join('; '));
}
{
  // the comp and the perc play the frame clave; a bar with none is struck once on its root onset
  const bad = [];
  for (const [L, T] of ROWS) for (const compRelation of ['sync', 'fill']) {
    const spec = compose(L, T, { seed: 1, overrides: { compRelation } }), C = spec.clave, comp = spec.parts.find((p) => p.id === 'comp');
    const src = compRelation === 'fill' ? C.partner.strokes.filter((x) => !x.shared) : C.strokes, mine = new Set(src.map((x) => x.node));
    for (const x of comp.strokes) if (!mine.has(x.node) && !(spec.chords[x.bar].rootNode === x.node && !src.some((y) => y.bar === x.bar))) bad.push(`${L.join(':')} ${compRelation}: a comp stroke off the clave in bar ${x.bar}`);
    const perc = spec.drums.hits.filter((h) => h.voice === 'perc' && h.snap === 'clave');
    if (perc.some((h) => !C.strokes.some((x) => x.tick === h.tick))) bad.push(`${L.join(':')}: a perc stroke off the clave`);
    // the accent: each bar's first onset struck harder than the bar's other clave strokes on as many layers' strikes
    const firstOf = (k) => perc.find((h) => h.bar === k && h.step === C.patterns[k].indexOf('x'));
    if ([...new Set(perc.map((h) => h.bar))].some((k) => !firstOf(k) || perc.some((h) => h.bar === k && h !== firstOf(k) && h.strikes === firstOf(k).strikes && h.velocity >= firstOf(k).velocity))) bad.push(`${L.join(':')}: the perc's accent is not each bar's first onset`);
  }
  check('the comp strikes the clave (Sync) or its partner off it (Fill), a bar with none on its root onset; the perc on the clave\'s strokes, each bar\'s first accented', !bad.length, bad.slice(0, 4).join('; '));
}

// ── P18: the curated and asked claves land in frame ──
console.log('\n— P18: curated and asked claves, in frame only');
{
  const bad = []; let n = 0, silent = 0, total = 0;
  for (const [L, T] of ROWS) for (const clave of ['son', 'rumba', 'bossa', '5:x.x.x', '8:x..x..x.']) for (const compRelation of ['sync', 'fill']) {
    const spec = compose(L, T, { seed: 1, overrides: { clave, compRelation } }), G = geometry(spec); n++;
    for (const b of auditFixed(G, spec.clave, 'the clave')) bad.push(`${L.join(':')}: ${b}`);
    if (spec.clave.partner.source === 'complement') for (const b of auditFixed(G, spec.clave.partner, 'its complement')) bad.push(`${L.join(':')}: ${b}`);
    else if (nearest(G, spec.clave.partner.strokes, spec.clave.strokes) <= SHARE + EPS) bad.push(`${L.join(':')} ${clave}: the partner shares a stroke`);
    if (spec.clave.pattern !== claveOf(clave).pattern) bad.push(`${L.join(':')} ${clave}: its pattern moved`);
    if (!spec.decisions.find((d) => d.what === 'clave').why.startsWith('asked')) bad.push(`${L.join(':')} ${clave}: not said "asked"`);
    silent += spec.clave.silent; total += spec.clave.strokes.length + spec.clave.silent;
  }
  check(`${n} asked claves (son, rumba, bossa, 5:x.x.x, 8:x..x..x.; Sync and Fill): the pattern kept, each step on the brute force's in-frame onset or silent (${silent} of ${total} silent), every stroke in frame; Fill's partner shares none`, !bad.length, bad.slice(0, 4).join('; '));
  const frameId = (() => { const s = compose([19, 17, 16, 15], 4, { seed: 1, trace: true }); return s.trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave).alternates.find((a) => a.from.frame && a.id !== s.clave.id).id; })();
  const asked = compose([19, 17, 16, 15], 4, { seed: 1, overrides: { clave: frameId } });
  check(`a frame clave asked by id (${frameId}): it plays, said "asked", the brute force's`, asked.clave.id === frameId && asked.decisions.find((d) => d.what === 'clave').why.startsWith('asked') && !audit(asked).length, audit(asked).join('; '));
  const throws = (f, re) => { try { f(); return false; } catch (err) { return re.test(err.message); } };
  check('a bad claveFrom, a grain the layer isn\'t read at, and claveFrom under notes throw', throws(() => compose([8, 7, 6, 5], 4, { overrides: { claveFrom: 'table' } }), /claveFrom must be one of frame, pattern/)
    && throws(() => compose([8, 7, 6, 5], 4, { overrides: { clave: 'frame:A/9/chord' } }), /is read at 4, not 9/) && throws(() => compose([8, 7, 6, 5], 4, { overrides: { compStyle: 'notes', claveFrom: 'frame' } }), /compStyle 'chords''s/));
}

// ── P19: 'pattern' is the clave before phase I ──
console.log('\n— P19: claveFrom \'pattern\', byte for byte the clave before phase I');
{
  const hash = (x) => crypto.createHash('sha256').update(J(x)).digest('hex').slice(0, 24), bad = [];
  CASES.forEach((c, x) => {
    // the bass pinned to the one Compose mined at c009aaa (Amendment 2, P28: Compose's own is now Moving · Kick)
    const s = compose(c.L, c.T, { seed: c.seed, overrides: { ...c.overrides, claveFrom: 'pattern', bass: { density: 'sparse', lock: 'free' } }, ...(c.changes ? { changes: c.changes } : {}), ...(c.trace ? { trace: true } : {}), ...(c.target ? { target: ODE() } : {}) });
    delete s.input.overrides.claveFrom; delete s.input.overrides.bass;
    if (s.target) delete s.target.search.ms;   // the placement search's own timing
    const h = c.whole ? hash(s) : hash([s.clave, s.drums, s.parts.find((p) => p.id === 'comp').strokes]);
    if (h !== HASHES[x]) bad.push(`${c.L.join(':')} ${J(c.overrides)}${c.changes ? ' (chart)' : ''}${c.target ? ' (target)' : ''}`);
  });
  check(`${CASES.length} cases (8 rows × 2 seeds × Sync, Fill × close and led; son, rumba, bossa, an asked pattern; 2 charts, a MIDI target, a trace): the spec (close) or the clave, drums and comp strokes (led) hash as the core at c009aaa made them`, !bad.length, bad.slice(0, 4).join('; '));
  const a = compose([19, 17, 16, 15], 4, { seed: 1 }), b = compose([19, 17, 16, 15], 4, { seed: 1, overrides: { claveFrom: 'frame' } });
  const strip = (s) => J({ ...s, input: { ...s.input, overrides: {} }, decisions: s.decisions.map((d) => (d.what === 'clave' ? { ...d, why: '' } : d)) });
  check('\'frame\' is the default: asked, the same spec (the decision says it was asked)', strip(a) === strip(b) && /from the frame by default/.test(a.decisions.find((d) => d.what === 'clave').why) && /from the frame \(asked\)/.test(b.decisions.find((d) => d.what === 'clave').why));
  // the seed draws of the other parts do not move: every part but the comp, the sounds and the drums' own lines are the pattern's
  const bad2 = [];
  for (const [L, T] of ROWS) for (const seed of [1, 2]) {
    const f = compose(L, T, { seed }), p = compose(L, T, { seed, overrides: { claveFrom: 'pattern' } });
    if (J(f.parts.filter((x) => x.id !== 'comp')) !== J(p.parts.filter((x) => x.id !== 'comp')) || J(f.chords) !== J(p.chords) || f.parts.some((x, i) => x.sound !== p.parts[i].sound)) bad2.push(`${L.join(':')} seed ${seed}`);
  }
  check('the clave read after the chords moves no other part: lead, chords, bass, inner, the chords and every sound the pattern clave\'s', !bad2.length, bad2.join('; '));
}

// ── P20: a chord swap re-reads its bar; a clave switch is a Compose's ──
console.log('\n— P20: a chord swap re-reads its bar\'s clave; a switch equals a Compose');
{
  const bad = []; let swaps = 0, moved = 0;
  for (const [L, T, extra] of [...ROWS.map(([L, T]) => [L, T, {}]), [[19, 17, 16, 15], 6, { changes: CHARTS[0][2] }]]) for (const asked of [null, 'son']) for (const compRelation of ['sync', 'fill']) {
    const full = compose(L, T, { seed: 1, trace: true, ...extra, overrides: { compRelation, ...(asked ? { clave: asked } : {}) } }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
    const spans = spec.chords[0].slots != null, U = spec.chords.length;
    for (let u = 0; u < U; u++) {
      // the bar's (span's) runner-up chords from the trace
      const h = trace.events.find((e) => e.kind === 'harmony'), ev = trace.events.find((e) => e.kind === 'chord' && e.round === h.chosenRound && (spans ? e.span === u : e.bar === u));
      const cands = (ev?.candidates ?? []).filter((_, i) => i !== ev.pickIndex).slice(0, 2);
      for (const c of cands) {
        swaps++;
        const r = rearrange(spec, row, cells, spans ? { span: u, chord: c } : { bar: u, chord: c }), next = applyRearrange(spec, r), k = spec.chords[u].bar;
        const C0 = spec.clave, C1 = next.clave, tag = `${L.join(':')}${spans ? ' chart' : ''} ${asked ?? 'frame'} ${compRelation} ${spans ? 'span' : 'bar'} ${u}`;
        const rebuilt = new Set(r.changedBars.concat([k]));
        for (const which of [[C0, C1], [C0.partner, C1.partner]]) {
          const out = (C) => keyOf(C.strokes.filter((x) => !rebuilt.has(x.bar)));
          if (out(which[0]) !== out(which[1])) bad.push(`${tag}: strokes moved outside the swapped bar`);
        }
        if ((r.reclavedBars ?? []).some((b) => !rebuilt.has(b))) bad.push(`${tag}: reclavedBars ${J(r.reclavedBars)}`);
        if (r.reclavedBars?.length) moved++;
        // the swapped bar's strokes are the brute force's under the new chord, the comp on them, the perc too
        const G = geometry(next), audited = C1.from?.frame ? (() => { const mine = bruteCandidates(G, { all: true }).find((x) => x.id === C1.id); return !!mine && keyOf(C1.strokes) === keyOf(mine.strokes) && J(C1.patterns) === J(mine.patterns); })() : !auditFixed(G, C1, 'the clave').length;
        if (!audited) bad.push(`${tag}: the re-read is not the brute force's`);
        // its partner read again the same way: a frame clave's reading, or its complement at the onsets a bar it had
        const P1 = C1.partner;
        if (P1.from?.frame) { const mine = bruteCandidates(G, { all: true }).find((x) => x.id === P1.id); if (!mine || keyOf(P1.strokes) !== keyOf(mine.strokes)) bad.push(`${tag}: the partner's re-read is not the brute force's`); }
        else if (P1.patterns) {
          const q = C1.patterns[k], open = [...q].flatMap((ch, j) => (ch === 'x' ? [] : [j])), keep = euclidPattern(open.length, Math.min(P1.per, open.length));
          if (P1.patterns[k] !== [...q].map((_, j) => (open.filter((_, i) => keep[i]).includes(j) ? 'x' : '.')).join('') || P1.strokes.some((x) => !G.inFrame(x.node))) bad.push(`${tag}: the complement's re-read`);
        } else if (P1.read === 'frame' && auditFixed(G, P1, 'the complement').length) bad.push(`${tag}: the fixed complement's re-read`);
        if (C1.strokes.some((x) => !G.inFrame(x.node))) bad.push(`${tag}: a stroke out of frame after the swap`);
        const src = compRelation === 'fill' ? C1.partner.strokes.filter((x) => !x.shared) : C1.strokes, comp = next.parts.find((p) => p.id === 'comp');
        for (const c of next.chords.filter((x) => x.bar === k)) {
          const from = spans ? c.from : k * G.S, to = spans ? c.from + c.slots : (k + 1) * G.S, own = src.filter((y) => y.slot >= from && y.slot < to);
          if (comp.strokes.filter((x) => x.slot >= from && x.slot < to).some((x) => (own.length ? !own.some((y) => y.node === x.node) : x.node !== c.rootNode))) bad.push(`${tag}: the comp off the re-read clave`);
        }
        const perc = next.drums.hits.filter((h) => h.voice === 'perc' && h.snap === 'clave' && h.bar === k).map((h) => h.tick).sort((a, b) => a - b);
        const want = C1.strokes.filter((x) => x.bar === k).map((x) => x.tick).sort((a, b) => a - b);
        if (perc.length && J(perc) !== J(want)) bad.push(`${tag}: the perc doesn't follow`);
        if (J(JSON.parse(J(next))) !== J(next)) bad.push(`${tag}: no JSON round trip`);
      }
    }
  }
  check(`${swaps} chord swaps (8 rows and a chart's spans; the frame clave and son; Sync and Fill): only the swapped bar's strokes move (${moved} moved), the brute force's under its new chord and in frame; the comp and the perc on them; reclavedBars names the bar`, swaps > 40 && moved > 0 && !bad.length, bad.slice(0, 4).join('; '));
}
{
  const bad = []; let n = 0;
  const cases = [...ROWS.slice(0, 7).map(([L, T]) => [L, T, {}]), [CHARTS[0][0], CHARTS[0][1], { changes: CHARTS[0][2] }], [[41, 42, 43], 8, { target: ODE() }]];
  for (const [L, T, extra] of cases) {
    const full = compose(L, T, { seed: 1, trace: true, ...extra }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
    const ev = trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave);
    const tries = [...ev.alternates.filter((a) => a.from.frame).slice(0, 4).map((a) => [a.id, 'sync']), ...ev.alternates.filter((a) => a.from.frame).slice(1, 3).map((a) => [a.id, 'fill']), ['son', 'fill'], ['bossa', 'sync'], [null, 'fill'], ['5:x.x.x', 'sync']];
    for (const [clave, relation] of tries) {
      n++;
      const got = applyRearrange(spec, reclave(spec, row, cells, { clave, relation }));
      const want = compose(L, T, { seed: 1, ...extra, overrides: { ...(clave ? { clave } : {}), compRelation: relation } });
      const same = J(got.parts) === J(want.parts) && J(got.drums) === J(want.drums) && J(got.clave) === J(want.clave) && J(got.stats.clave) === J(want.stats.clave) && got.stats.compStrum === want.stats.compStrum;
      if (!same) bad.push(`${L.join(':')}${extra.changes ? ' (chart)' : extra.target ? ' (target)' : ''} ${clave ?? 'its own'} ${relation}`);
    }
  }
  check(`${n} clave switches over 7 rows, a chart and a MIDI target (frame alternates, curated, asked, Fill): every part, the drums, spec.clave and its stats byte for byte a Compose's with that clave`, !bad.length, bad.slice(0, 4).join('; '));
}

// ── P21: the words ──
console.log('\n— P21: the words');
{
  const spec = compose([19, 17, 16, 15], 4, { seed: 1, trace: true }), C = spec.clave, why = spec.decisions.find((d) => d.what === 'clave').why;
  const ev = spec.trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave);
  const src = `layer ${C.from.name} · ${C.steps} steps · ${C.from.set === 'chord' ? 'chord tones' : 'tones in frame'}`;
  check(`the source "${claveSource(C)}" and each bar's pattern "${claveText(C)}" (bar 2: "${claveText(C, 1)}") in the decision, and in the trace with every alternate's`, claveSource(C) === src && claveText(C) === C.patterns.join(' ') && claveText(C, 1) === C.patterns[1]
    && why.includes(src) && why.includes(claveText(C)) && J(ev.clave.patterns) === J(C.patterns) && ev.alternates.filter((a) => a.from.frame).every((a) => Array.isArray(a.patterns) && a.patterns.length === spec.knobs.bars));
  const son = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { clave: 'son' } });
  check(`a curated clave read in frame says so: "${claveSource(son.clave)}"; a frame id read back (claveOf): "${claveOf(C.id).pattern}"`, claveSource(son.clave) === 'son clave 3-2 · in frame' && claveOf(C.id).id === C.id && claveOf(C.id).pattern === src);
}

// ── Amendment 2 (P26–P27, P30–P31): the narrower sets, the density tiers, the picker re-ranked ──
console.log('\n— Amendment 2: the narrower sets and the density tiers (P26–P27)');
const tiers = [];
{
  const bad = []; let n = 0, fell = 0, narrow = 0;
  for (const [L, T] of ROWS) for (const compDensity of ['sparse-med', 'sparse', 'medium', 'dense']) for (const seed of [1, 2]) {
    const spec = compose(L, T, { seed, overrides: compDensity === 'sparse-med' ? {} : { compDensity } }); n++;
    for (const b of audit(spec)) bad.push(`${L.join(':')} ${compDensity} seed ${seed}: ${b}`);
    const C = spec.clave, d = spec.decisions.find((x) => x.what === 'clave').why;
    if (C.compDensity.fellBack) fell++;
    if (['root+5th', 'guide', 'root'].includes(C.from?.set)) narrow++;
    // the share and tier the clave carries are its patterns'; in the tier played (none: no tier at all)
    if (C.from?.frame) {
      const share = C.patterns.reduce((a, p) => a + [...p].filter((ch) => ch === 'x').length, 0) / (C.steps * spec.knobs.bars);
      if (Math.abs(share - C.share) > 1e-12 || C.tier !== tierOfShare(share) || (C.compDensity.played && !inDensity(C.tier, C.compDensity.played))) bad.push(`${L.join(':')} ${compDensity}: share ${C.share} / tier ${C.tier}`);
    }
    // the words (P31): the density asked or the default, and a fall-back said
    const want = compDensity === 'sparse-med' ? /the comp's density sparse–medium \(10–50 %\) by default \(rule 10, Avery\)/ : new RegExp(`the comp's density asked, ${compDensity}`);
    if (!want.test(d) || (C.compDensity.fellBack && !(C.compDensity.played ? /no frame clave in it .*so the nearest tier's/ : /no frame clave in any tier/).test(d))) bad.push(`${L.join(':')} ${compDensity}: the words "${d.slice(0, 160)}"`);
    if (seed === 1 && compDensity === 'sparse-med') tiers.push({ row: L.join(':'), id: C.id, set: C.from?.set ?? '—', grain: C.steps, share: C.share, tier: C.tier, fellBack: C.compDensity.fellBack, played: C.compDensity.played, text: claveText(C) });
  }
  check(`${n} composes (8 rows × the 4 densities × 2 seeds): the clave the brute force's in the tier asked (or the nearest: ${fell} fell back), every stroke in frame and in its set (${narrow} from a narrower set), its share and tier its patterns', the words naming the tier`, !bad.length && fell > 0 && narrow > 0, bad.slice(0, 4).join('; '));
  // the fall-back, by hand: a row whose ranking has no sparse candidate plays medium's best, and says so
  const G = geometry(compose([7, 5, 3, 2], 4, { seed: 1 })), B = bruteRank(G, 'sparse'), sp = compose([7, 5, 3, 2], 4, { seed: 1, overrides: { compDensity: 'sparse' } });
  check(`7:5:3:2 asked sparse: no sparse candidate (${B.all.filter((c) => c.kept && c.tier === 'sparse').length}), so medium's best (${sp.clave.id}, ${Math.round(100 * sp.clave.share)} %), said in the decision`, B.played === 'medium' && sp.clave.compDensity.played === 'medium' && sp.clave.compDensity.fellBack && sp.clave.id === B.list[0].id
    && /no frame clave in it .*so the nearest tier's, medium/.test(sp.decisions.find((x) => x.what === 'clave').why));
  // the trace says the tier: asked, played, the counts; every alternate in it, with its share
  const t = compose([768, 784], 8, { seed: 1, trace: true }), ev = t.trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave);
  const frameAlts = ev.alternates.filter((a) => a.from.frame);
  check(`the trace: the density (${J({ asked: ev.density.asked, played: ev.density.played, fellBack: ev.density.fellBack })}), its counts, and ${frameAlts.length} alternates every one in the tier with its share`,
    ev.density.asked === 'sparse-med' && ev.density.played === 'sparse-med' && !ev.density.fellBack && J(ev.density.band) === '[0.1,0.5]' && frameAlts.length > 0 && frameAlts.every((a) => inDensity(a.tier, 'sparse-med') && a.share >= 0.1 - EPS && a.share <= 0.5 + EPS)
    && J(ev.clave.compDensity) === J(t.clave.compDensity));
  const throws = (f, re) => { try { f(); return false; } catch (err) { return re.test(err.message); } };
  check('a bad compDensity, compDensity under notes, under the pattern clave: each throws', throws(() => compose([8, 7, 6, 5], 4, { overrides: { compDensity: 'thick' } }), /compDensity must be one of sparse-med, sparse, medium, dense/)
    && throws(() => compose([8, 7, 6, 5], 4, { overrides: { compStyle: 'notes', compDensity: 'dense' } }), /compStyle 'chords''s/) && throws(() => compose([8, 7, 6, 5], 4, { overrides: { claveFrom: 'pattern', compDensity: 'dense' } }), /a pattern clave has none/));
  // a narrower set's twin of a wider one's reading is dropped, the wider name kept: no two candidates read alike
  let twins = 0, cands = 0;
  for (const [L, T] of ROWS) {
    const s = compose(L, T, { seed: 1 }), g = geometry(s), R = rankFrameClaves(g.row, g.ctx, g.chordAt, { density: 'dense' });
    const key = (c) => `${c.from.name}/${c.steps}/${J(c.patterns)}`, seen = new Set();
    for (const c of R.ranked.candidates) { cands++; if (seen.has(key(c))) twins++; seen.add(key(c)); }
  }
  check(`no twin readings among ${cands} candidates (dense; a twin keeps the wider set's name)`, twins === 0 && cands > 0);
}

console.log('\n— Amendment 2: the picker re-ranked when a chord changes (P30), a density switch live');
{
  const bad = []; let n = 0, same = 0, pinned = 0, own = 0;
  const alts = (C, list) => J(list.filter((a) => a.from.frame).map((a) => [a.id, +a.score.toFixed(12)]));
  for (const [L, T, extra] of [...ROWS.slice(0, 7).map(([L, T]) => [L, T, {}]), [CHARTS[0][0], CHARTS[0][1], { changes: CHARTS[0][2] }]]) {
    const full = compose(L, T, { seed: 1, trace: true, ...extra }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
    const spans = spec.chords[0].slots != null, h = trace.events.find((e) => e.kind === 'harmony');
    for (let u = 0; u < Math.min(spec.chords.length, 3); u++) {
      const ev = trace.events.find((e) => e.kind === 'chord' && e.round === h.chosenRound && (spans ? e.span === u : e.bar === u));
      const c = (ev?.candidates ?? []).find((_, i) => i !== ev.pickIndex);
      if (!c) continue;
      for (const edit of [spans ? { span: u, chord: c } : { bar: u, chord: c }, spans ? { span: u, chord: { rootTone: c.root.ratio, quality: 'minor_triad' } } : { bar: u, chord: { rootTone: c.root.ratio, quality: 'minor_triad' } }]) {
        const r = rearrange(spec, row, cells, edit), next = applyRearrange(spec, r); n++;
        const tag = `${L.join(':')}${spans ? ' chart' : ''} ${J(edit).slice(0, 60)}`;
        if (J(next.chords) === J(spec.chords)) { if (r.claveAlternates) bad.push(`${tag}: alternates with no chord changed`); continue; }
        if (!r.claveAlternates) { bad.push(`${tag}: no re-ranked alternates`); continue; }
        // the brute force's ranking over the chords as they play, in the spec's tier
        const B = bruteRank(geometry(next), 'sparse-med');
        if (J(r.claveAlternates.filter((a) => a.from.frame).map((a) => a.id)) !== J(B.list.slice(0, 12).map((x) => x.id))) bad.push(`${tag}: not the brute force's ranking`);
        // what plays keeps its layer, grain and set
        if (next.clave.id !== spec.clave.id) bad.push(`${tag}: the playing clave switched`);
        // a Compose over the edited chords (a progression pinning their roots, where it voices the same chords): the same alternates
        if (!spans) {
          const pin = compose(L, T, { seed: 1, trace: true, progression: next.chords.map((x) => x.rootTone) });
          if (J(pin.chords.map((x) => [x.rootTone, x.quality, x.offsetCents])) === J(next.chords.map((x) => [x.rootTone, x.quality, x.offsetCents]))) {
            pinned++;
            const pe = pin.trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave);
            if (J(pe.alternates.filter((a) => a.from.frame).map((a) => [a.id, a.score])) !== J(r.claveAlternates.filter((a) => a.from.frame).map((a) => [a.id, Math.round(a.score * 1e4) / 1e4]))) bad.push(`${tag}: not a Compose's over the same chords`);
            else same++;
          }
        }
      }
    }
    // a swap to the chord a bar has: nothing re-ranked
    const r0 = rearrange(spec, row, cells, spans ? { span: 0, chord: { rootTone: spec.chords[0].rootTone, quality: spec.chords[0].quality } } : { bar: 0, chord: { rootTone: spec.chords[0].rootTone, quality: spec.chords[0].quality } });
    if (!r0.claveAlternates) own++;
  }
  // a lead follow that changes a chord re-ranks too
  let follows = 0;
  for (const [L, T] of ROWS.slice(0, 6)) {
    const full = compose(L, T, { seed: 1, trace: true }), { trace, ...spec } = full, { row, cells } = materialsOf(spec), h = trace.events.find((e) => e.kind === 'harmony');
    h.lead.phrases.forEach((id, p) => {
      const evs = trace.events.filter((e) => e.kind === 'lead' && e.phrase === p && e.mined && e.mined.id === id), up = evs.length ? evs[evs.length - 1].runnersUp[0]?.id : null;
      if (!up) return;
      const r = rearrange(spec, row, cells, { phrase: p, line: up, chordsFollow: true }, { trace }), next = applyRearrange(spec, r);
      if (J(next.chords) === J(spec.chords)) return;
      follows++;
      const B = bruteRank(geometry(next), 'sparse-med');
      if (J((r.claveAlternates ?? []).filter((a) => a.from.frame).map((a) => a.id)) !== J(B.list.slice(0, 12).map((x) => x.id))) bad.push(`${L.join(':')} phrase ${p} follow: not the brute force's ranking`);
    });
  }
  check(`${n} chord swaps and typed chords over 7 rows and a chart, ${follows} lead follows changing a chord: the alternates re-ranked over the chords as they play (the brute force's, ${same}/${pinned} equal to a Compose pinning the same chords), the playing clave kept; a swap to its own chord re-ranks nothing (${own}/8)`,
    !bad.length && pinned > 0 && same === pinned && own === 8 && follows > 0, bad.slice(0, 4).join('; '));
  void alts;
}
{
  // a density switch is live: reclave({ density }) equal to a Compose given that compDensity, its alternates that Compose's
  const bad = []; let n = 0;
  for (const [L, T, extra] of [...ROWS.map(([L, T]) => [L, T, {}]), [CHARTS[0][0], CHARTS[0][1], { changes: CHARTS[0][2] }], [[41, 42, 43], 8, { target: ODE() }]]) {
    const spec = compose(L, T, { seed: 1, ...extra }), { row, cells } = materialsOf(spec);
    for (const [density, relation] of [['dense', 'sync'], ['sparse', 'fill'], ['medium', 'sync'], ['sparse-med', 'sync']]) {
      n++;
      const r = reclave(spec, row, cells, { density, relation }), got = applyRearrange(spec, r);
      const want = compose(L, T, { seed: 1, trace: true, ...extra, overrides: { ...(density !== 'sparse-med' ? { compDensity: density } : {}), compRelation: relation } });
      const ev = want.trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave);
      const sameAlts = density === 'sparse-med' ? !r.claveAlternates : J(r.claveAlternates.map((a) => a.id)) === J(ev.alternates.map((a) => a.id));
      if (!(J(got.parts) === J(want.parts) && J(got.drums) === J(want.drums) && J(got.clave) === J(want.clave) && J(got.stats.clave) === J(want.stats.clave) && sameAlts)) bad.push(`${L.join(':')}${extra.changes ? ' chart' : extra.target ? ' target' : ''} ${density} ${relation}`);
      if (density !== 'sparse-med' && !got.decisions.find((d) => d.what === 'clave').why.includes(`the comp's density asked, ${density}`)) bad.push(`${L.join(':')} ${density}: the words`);
    }
  }
  check(`${n} density switches (reclave { density }) over 8 rows, a chart and a MIDI target: every part, the drums, spec.clave and its stats byte for byte a Compose given that compDensity, the alternates its trace's, the decision naming the tier`, !bad.length, bad.slice(0, 4).join('; '));
}

// ── the probe's table ──
console.log('\n— the probe rows (seed 1, Sync): the frame clave');
console.log('    | row | bars × slots | candidate | source | patterns | score | strokes in frame | on chord tones | Fill |');
for (const t of table) console.log(`    | ${t.row} | ${t.meter} | ${t.id} | ${t.source} | \`${t.text}\` | ${t.score.toFixed(3)} | ${t.inF}/${t.n} | ${t.onC}/${t.n} | ${t.partner} |`);
check('every probe row\'s strokes in frame', table.every((t) => t.inF === t.n));
console.log('\n— the default tier (sparse–medium), seed 1: the chosen comp clave');
console.log('    | row | clave | set | grain | share | tier | fell back | patterns |');
for (const t of tiers) console.log(`    | ${t.row} | ${t.id} | ${t.set} | ${t.grain} | ${(100 * t.share).toFixed(0)} % | ${t.tier} | ${t.fellBack ? `yes (${t.played})` : 'no'} | \`${t.text}\` |`);

// ── the 16,359-onset row ──
console.log('\n— the 16k row');
{
  const L = [4099, 4093, 4091, 4079], T = 16;
  compose(L, T, { seed: 1 });
  let t0 = performance.now(); const spec = compose(L, T, { seed: 1 }), tFrame = performance.now() - t0;
  t0 = performance.now(); compose(L, T, { seed: 1, overrides: { claveFrom: 'pattern' } }); const tPattern = performance.now() - t0;
  const G = geometry(spec), { row, cells } = materialsOf(spec), units = G.units;
  t0 = performance.now(); const R = rankFrameClaves(row, G.ctx, G.chordAt); const tRank = performance.now() - t0;
  t0 = performance.now(); chooseFrameClave(row, G.ctx, G.chordAt, { ranks: R, units }); const tChoose = performance.now() - t0;
  const bad = audit(spec);
  t0 = performance.now(); const r = rearrange(spec, row, cells, { bar: 2, chord: { rootTone: spec.chords[0].rootTone, quality: spec.chords[0].quality } }); const tSwap = performance.now() - t0;
  console.log(`    · 16k: ${spec.knobs.bars} × ${spec.knobs.slotsPerBar}, ${R.ranked.tried} readings, ${R.ranked.candidates.length} candidates; ${spec.clave.id} (${claveSource(spec.clave)}) ${claveText(spec.clave)}; Compose ${tFrame.toFixed(0)} ms (frame), ${tPattern.toFixed(0)} ms (pattern); ranked ${tRank.toFixed(1)} ms, chosen ${tChoose.toFixed(1)} ms; a swap ${tSwap.toFixed(0)} ms (reclaved ${J(r.reclavedBars)})`);
  check(`16k: the brute force's clave; ranked and chosen in ${(tRank + tChoose).toFixed(1)} ms (under 50 ms); Compose ${tFrame.toFixed(0)} ms (under 1.5 s)`, !bad.length && tRank + tChoose < 50 && tFrame < 1500, bad.slice(0, 3).join('; '));
}

console.log(`\n${PASS ? '✓✓✓ THE FRAME CLAVE PASSES' : '✗ THE FRAME CLAVE FAILED'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
