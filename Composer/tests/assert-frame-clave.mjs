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
//   • the probe's table (each row's chosen candidate, its patterns, strokes in frame) and the 16,359-onset row's cost
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
  return { spec, row, cells, ctx, K, S, N, P, e, W, recs, chordAt, rel, place, rAt, inFrame, onChord, units };
}

/** the first node at a tick (a superrow's tick holds several), by a scan of the sorted ticks */
const firstAt = (row, tick) => { let lo = 0, hi = row.n; while (lo < hi) { const m = (lo + hi) >> 1; if (row.tick[m] < tick) lo = m + 1; else hi = m; } return row.tick[lo] === tick ? lo : -1; };

/** P16 by brute force: every candidate, read and scored, in the order's ranking (`all`: every reading, the ones the
 *  ranking leaves out too: a frame set reading what the chord set reads, a reading with no bar left in) */
function bruteCandidates(G, { all = false } = {}) {
  const { row, ctx, S, N } = G, out = [];
  // the layers fastest first (equal values: the later letter first)
  const layers = [...row.active].sort((a, b) => row.layers[b] - row.layers[a] || b - a);
  for (const b of layers) {
    const v = row.layers[b], period = row.grid / v, bars = Array.from({ length: N }, () => []);
    let total = 0;
    for (let k = 0; k < v; k++) { const i = firstAt(row, k * period); if (ctx.posSlot[i] < 0) continue; bars[Math.floor(ctx.posSlot[i] / S)].push({ node: i, place: G.place(i) }); total++; }
    for (const list of bars) list.sort((x, y) => x.place - y.place || x.node - y.node);
    const m = Math.round(total / N), grains = m < 3 ? [] : m <= 16 ? [m] : Array.from({ length: 14 }, (_, x) => x + 3);
    for (const n of grains) {
      let chordRead = null;
      for (const set of ['chord', 'frame']) {
        const test = set === 'chord' ? G.onChord : G.inFrame, patterns = [], strokes = [];
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
        const twin = set === 'frame' && chordRead && J(patterns) === J(chordRead);
        if (set === 'chord') chordRead = patterns;
        // the score: density the bars' mean, fit by n, recurrence the bars whose pattern another repeats
        const ons = patterns.map((p) => [...p].filter((ch) => ch === 'x').length), counted = ons.map((o) => o >= RULES.minOnsets && o < n);
        if (!all && (twin || !counted.some(Boolean))) continue;
        let density = 0, held = 0;
        ons.forEach((o, k) => { if (!counted[k]) return; const x = o / n; density += x < RULES.lo ? x / RULES.lo : x > RULES.hi ? (1 - x) / (1 - RULES.hi) : 1; });
        patterns.forEach((p, k) => { if (counted[k] && patterns.some((q, k2) => k2 !== k && counted[k2] && q === p)) held++; });
        const fit = RULES.straight.includes(n) ? 1 : RULES.triplet.includes(n) ? 0.75 : 0.4;
        out.push({ id: `frame:${'ABCD'[b]}/${n}/${set}`, n, set, patterns, strokes, score: (held / N + density / N + fit) / 3 });
      }
    }
  }
  return out.map((c, x) => ({ ...c, x })).sort((a, b) => b.score - a.score || a.x - b.x);
}

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
  const bad = [], G = geometry(spec), C = spec.clave, list = bruteCandidates(G);
  if (!C.from?.frame) return C.read === 'frame' ? auditFixed(G, C, 'clave') : ['not a frame clave'];
  const top = list.filter((c) => c.score >= list[0].score - EPS), mine = list.find((c) => c.id === C.id);
  if (!mine) return [`${C.id} is no candidate of the brute force's`];
  if (!spec.input.overrides?.clave && !top.includes(mine)) bad.push(`${C.id} (${mine.score.toFixed(4)}) is not among the best (${top.map((c) => c.id).join(', ')}, ${list[0].score.toFixed(4)})`);
  if (Math.abs(mine.score - C.score) > 1e-9) bad.push(`${C.id}'s score ${C.score} is not ${mine.score}`);
  if (J(mine.patterns) !== J(C.patterns)) bad.push(`${C.id}'s patterns ${claveText(C)}, the brute force's ${mine.patterns.join(' ')}`);
  if (keyOf(C.strokes) !== keyOf(mine.strokes)) bad.push(`${C.id}'s strokes are not the brute force's`);
  const v = spec.input.layers['ABCD'.indexOf(C.from.name)], period = G.row.grid / v;
  for (const x of C.strokes) {
    if (x.tick % period !== 0 || firstAt(G.row, x.tick) !== x.node) bad.push(`bar ${x.bar} step ${x.step}: not the layer's own strike`);
    if (!(C.from.set === 'chord' ? G.onChord(x.node) : G.inFrame(x.node))) bad.push(`bar ${x.bar} step ${x.step}: its tone is out of the set`);
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
    const s = compose(c.L, c.T, { seed: c.seed, overrides: { ...c.overrides, claveFrom: 'pattern' }, ...(c.changes ? { changes: c.changes } : {}), ...(c.trace ? { trace: true } : {}), ...(c.target ? { target: ODE() } : {}) });
    delete s.input.overrides.claveFrom;
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

// ── the probe's table ──
console.log('\n— the probe rows (seed 1, Sync): the frame clave');
console.log('    | row | bars × slots | candidate | source | patterns | score | strokes in frame | on chord tones | Fill |');
for (const t of table) console.log(`    | ${t.row} | ${t.meter} | ${t.id} | ${t.source} | \`${t.text}\` | ${t.score.toFixed(3)} | ${t.inF}/${t.n} | ${t.onC}/${t.n} | ${t.partner} |`);
check('every probe row\'s strokes in frame', table.every((t) => t.inF === t.n));

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
