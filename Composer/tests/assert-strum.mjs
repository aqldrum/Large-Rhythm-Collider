// assert-strum.mjs — the comp's tolerance, single notes, sparser ties (Composer/BASS_VOICING_ORDER.md Amendment 3, phase
// O: Avery's rules 15–17, P33–P38): compose.js' `compTolerance` and `compBorrow`, rearrange.js' `restrum` door and the
// chord swap's re-strum, claves.js' tie order. Every spec is checked against a brute force written from the order, not
// from compose.js:
//   • P33–P34: a stroke's tones are its own onset (whatever its tone: a frame tone that is no chord class is `offChord`)
//     plus, for each other class of the chord (root first, at most 4 voices), the class's onset nearest the stroke within
//     ±tolerance × the stroke's slot, inside its bar or span (ties: the most strikes, then the earlier); nothing borrowed
//     unless `compBorrow`; a stroke with no other chord tone in its window a single note. Borrowing on: every class of the
//     first 4 the row doesn't sound in the window borrowed from the chord voice (its tone and onset, `from`, at the
//     stroke), velocities 0.55+ / 0.5 / 0.45; each tone held to the next stroke (or the span's end)
//   • P35: led, a class's tone at the octave nearest its chord voice (in its lane), an off-chord tone nearest the chord
//     voices' mean (a lane of its own), every stroke's lanes distinct; close, stacked from an octave under the root
//   • P36: the stats (compStrum 1 with nothing borrowed, compTones, compSingles) and the decision's words
//   • P37: restrum byte for byte a Compose given the same overrides (from the default and from another setting; led and
//     close; Fill; a chart; a MIDI target), one door through `rearrange`; the clave's strokes never move (the perc and
//     the bass's Clave lock read them); a chord swap re-strums its bar at the setting, no other bar's comp moving
//   • P34's pin: `compBorrow: true` with `compTolerance: 0.25` the comp before Amendment 3 (the brute force's borrowed
//     full chords at ±¼; assert-comp.mjs and assert-frame-clave.mjs' hashes hold it byte for byte)
//   • P38: the frame candidates ordered by score, a tie (within 1e-9) by share, the lower first; the clave Compose plays
//     among the sparsest of the best (the seed breaks only what is left)
//   • the probe's table (seed 1, ±½, nothing borrowed) and the 16,359-onset row's cost (Compose ≤ 1 s, a restrum ≤ ~15 ms)
//   node Composer/tests/assert-strum.mjs
import { compose, partContext, COMP_TOLERANCES, toleranceWords } from '../core/compose.js';
import { rearrange, restrum, applyRearrange, materialsOf } from '../core/rearrange.js';
import { classOfCents } from '../core/frame.js';
import { readMidi, decodeClip } from '../core/midi.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const EPS = 1e-9;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const ODE = () => ({ clip: decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'ode-to-joy')))) });

console.log('═══ COMPOSER — the comp\'s tolerance (BASS_VOICING_ORDER.md Amendment 3, phase O) ═══');

const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 4], [[16, 12, 9], 4], [[7, 5, 3, 2], 4], [[19, 17, 16, 15], 4], [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
const VELOCITY = { stroke: 0.55, strum: 0.5, borrowed: 0.45 }, MAX = 4, CHORDS_REGISTER = -1200;

/** the spec's geometry: its materials and part context (the onsets' times and slots, a target's crop read as Compose
 *  reads it), each chord's unit (a split bar's span, else a bar) */
function geometryOf(spec) {
  const { row, cells } = materialsOf(spec), K = spec.knobs, S = K.slotsPerBar;
  const ctx = partContext(row, cells, { cycleSeconds: K.cycleSeconds, phase: K.phase, frameCentsEachSide: K.frameCentsEachSide, rowCycleSeconds: K.rowCycleSeconds ?? K.cycleSeconds });
  const toneOf = new Map(row.tones.map((t, i) => [t, i]));
  const units = spec.chords.map((c, u) => (c.slots != null ? { u, bar: c.bar, from: c.from, to: c.from + c.slots, c } : { u, bar: u, from: u * S, to: (u + 1) * S, c }));
  return { row, cells, ctx, K, S, units, toneOf, e: K.frameCentsEachSide, time: (i) => ctx.timeOf(row.tick[i]) };
}
const rootCentsOf = (G, c) => G.row.toneCents[G.toneOf.get(c.rootTone)];
/** a chord class of onset i under chord c (from its root tone, in tune within ±e), or −1 */
const classOf = (G, c, i) => { const k = classOfCents(G.row.toneCents[G.row.tone[i]] - rootCentsOf(G, c)); return Math.abs(k.dev) <= G.e + EPS && c.intervals.includes(k.pc) ? k.pc : -1; };
const strokeVelocity = (G, s) => Math.min(1, VELOCITY.stroke + 0.1 * Math.max(0, G.row.strikes[s] - 1));

/** the strum the order asks for, by brute force over the spec's chords, its chords part and its clave → { notes, strokes,
 *  groups: [{ s, tones: [expected note] }] } */
function expected(spec, G, { tolerance, borrow }) {
  const { row, ctx } = G, C = spec.clave;
  const took = new Set(C.strokes.map((x) => x.node)), source = C.relation === 'fill' ? C.partner.strokes.filter((x) => !took.has(x.node)) : C.strokes;
  const chordsPart = spec.parts.find((p) => p.id === 'chords').notes, notes = [], strokes = [], groups = [];
  for (const U of G.units) {
    const inside = []; for (let i = 0; i < row.n; i++) if (ctx.posSlot[i] >= U.from && ctx.posSlot[i] < U.to) inside.push(i);
    let mine = [...new Set(source.filter((x) => x.slot >= U.from && x.slot < U.to).map((x) => x.node))];
    if (!mine.length && U.c.rootNode != null && inside.includes(U.c.rootNode)) mine = [U.c.rootNode];
    mine.sort((a, b) => G.time(a) - G.time(b) || a - b);
    const P = ctx.P, end = U.to < P ? ctx.starts[U.to] * ctx.rowT : ctx.T;
    const voices = new Map(chordsPart.filter((n) => n.bar === U.bar && n.slot >= U.from && n.slot < U.to).map((n) => [n.voice, n]));
    mine.forEach((s, x) => {
      const ts = G.time(s), holdTo = ts < end ? Math.min(x + 1 < mine.length ? G.time(mine[x + 1]) : end, end) : ctx.T;
      strokes.push({ node: s, tick: row.tick[s], time: ts, bar: U.bar, slot: ctx.posSlot[s] });
      const w = tolerance * ctx.slotSeconds(ctx.posSlot[s]);
      // each class's onset nearest the stroke within the window (ties: the most strikes, then the earlier)
      const nearestOf = (pc) => {
        let best = -1, bd = Infinity;
        for (const i of inside) {
          if (classOf(G, U.c, i) !== pc) continue;
          const d = Math.abs(G.time(i) - ts);
          if (d > w + EPS) continue;
          if (best < 0 || d < bd - EPS || (d <= bd + EPS && (row.strikes[i] > row.strikes[best] || (row.strikes[i] === row.strikes[best] && G.time(i) < G.time(best))))) { best = i; bd = d; }
        }
        return best;
      };
      const tones = [];
      if (!borrow) {
        const own = classOf(G, U.c, s);
        tones.push({ node: s, ratio: row.tones[row.tone[s]], velocity: strokeVelocity(G, s), offChord: own < 0, cls: own });
        U.c.intervals.slice(0, MAX).forEach((pc) => {
          if (pc === own || tones.length >= MAX) return;
          const i = nearestOf(pc);
          if (i >= 0) tones.push({ node: i, ratio: row.tones[row.tone[i]], velocity: VELOCITY.strum, offChord: false, cls: pc });
        });
      } else {
        U.c.intervals.slice(0, MAX).forEach((pc, v) => {
          const i = nearestOf(pc);
          if (i >= 0) tones.push({ node: i, ratio: row.tones[row.tone[i]], velocity: i === s ? strokeVelocity(G, s) : VELOCITY.strum, offChord: false, cls: pc });
          else if (voices.has(v)) tones.push({ node: s, ratio: voices.get(v).ratio, velocity: VELOCITY.borrowed, borrowed: true, from: voices.get(v).node, offChord: false, cls: pc });
        });
      }
      for (const t of tones) notes.push({ ...t, bar: U.bar, holdTo, time: t.borrowed ? ts : G.time(t.node), stroke: s });
      groups.push({ s, U, tones: tones.map((t) => ({ ...t, holdTo })) });
    });
  }
  return { notes, strokes, groups };
}
const noteKey = (n) => J([n.node, n.bar, n.ratio, n.velocity, Math.round(n.holdTo * 1e9), n.borrowed ? n.from : null, !!n.offChord]);

let lastWant = null;
/** a spec's comp against the brute force and the order's rules → [problem] */
function audit(spec, setting = null) {
  const G = geometryOf(spec), comp = spec.parts.find((p) => p.id === 'comp');
  const st = setting ?? { tolerance: spec.input.overrides?.compTolerance ?? 0.5, borrow: spec.input.overrides?.compBorrow ?? false };
  const want = lastWant = expected(spec, G, st), bad = [];
  if (J(comp.strokes) !== J([...want.strokes].sort((a, b) => a.time - b.time || a.node - b.node))) bad.push('the strokes are not the clave\'s (its partner\'s in Fill)');
  const a = comp.notes.map(noteKey).sort(), b = want.notes.map(noteKey).sort();
  if (J(a) !== J(b)) { const miss = b.find((k) => !a.includes(k)), extra = a.find((k) => !b.includes(k)); bad.push(`the tones differ from the brute force's (missing ${miss}, extra ${extra})`); return bad; }
  if (!st.borrow && comp.notes.some((n) => n.borrowed)) bad.push('a borrowed tone with nothing borrowed');
  // every tone an onset of the row at its own time, inside its stroke's window and unit; the octaves and lanes (P35)
  const { row, ctx } = G, key = new Map(comp.notes.map((n) => [noteKey(n), n]));
  for (const g of want.groups) {
    const got = g.tones.map((t) => key.get(noteKey({ ...t, bar: g.U.bar })));
    const ts = G.time(g.s), w = st.tolerance * ctx.slotSeconds(ctx.posSlot[g.s]), root = rootCentsOf(G, g.U.c);
    for (const n of got) {
      if (n.tick !== row.tick[n.node] || Math.abs(n.time - (n.borrowed ? ts : G.time(n.node))) > EPS) bad.push(`node ${n.node}: not at its own onset`);
      if (!n.borrowed && Math.abs(G.time(n.node) - ts) > w + EPS) bad.push(`node ${n.node}: outside its stroke's ±${st.tolerance} slot`);
      if (ctx.posSlot[n.node] < g.U.from || ctx.posSlot[n.node] >= g.U.to) bad.push(`node ${n.node}: outside its bar or span`);
      if (!(Number.isInteger(n.voice) && n.voice >= 0 && n.voice < MAX)) bad.push(`node ${n.node}: voice ${n.voice}`);
    }
    if (new Set(got.map((n) => n.voice)).size !== got.length) bad.push(`stroke ${g.s}: two tones in one voice`);
    const pitch = (n) => row.toneCents[row.tone[n.borrowed ? n.from : n.node]] + 1200 * n.octave;
    const led = spec.stats.voicing != null, chordNotes = spec.parts.find((p) => p.id === 'chords').notes.filter((n) => n.bar === g.U.bar && n.slot >= g.U.from && n.slot < g.U.to);
    if (led) {
      if (new Set(got.map((n) => n.lane)).size !== got.length || got.some((n) => !(Number.isInteger(n.lane) && n.lane >= 0 && n.lane < MAX))) bad.push(`stroke ${g.s}: lanes ${got.map((n) => n.lane)}`);
      const mean = chordNotes.length ? chordNotes.reduce((x, n) => x + pitch(n), 0) / chordNotes.length : null;
      got.forEach((n, j) => {
        const v = n.offChord ? null : chordNotes.find((c) => c.voice === g.U.c.intervals.indexOf(g.tones[j].cls));
        const ref = v ? pitch(v) : mean;
        if (ref != null && Math.abs(pitch(n) - ref) > 600 + 1e-6) bad.push(`node ${n.node}: ${pitch(n).toFixed(0)}¢, ${n.offChord ? 'the chord voices\' mean' : 'its voice'} ${ref.toFixed(0)}¢`);
        if (v && n.lane !== v.lane) bad.push(`node ${n.node}: lane ${n.lane}, its voice's ${v.lane}`);
      });
    } else {
      // close: stacked from an octave under the root, in class order (an off-chord tone at its pitch class)
      const order = (t) => (t.cls >= 0 ? t.cls : classOfCents(row.toneCents[row.tone[t.node]] - root).pc + 0.5);
      const sorted = [...g.tones].sort((x, y) => order(x) - order(y) || x.cls - y.cls);
      let floor = root + CHORDS_REGISTER - 50;
      for (const t of sorted) {
        const n = key.get(noteKey({ ...t, bar: g.U.bar })), c = row.toneCents[row.tone[t.borrowed ? t.from : t.node]], oct = Math.ceil((floor - c) / 1200 - EPS);
        if (n.octave !== oct) { bad.push(`node ${n.node} (close): octave ${n.octave}, stacked ${oct}`); break; }
        floor = c + 1200 * oct + 1;
      }
    }
  }
  // the stats (P36)
  const strokes = want.groups.length, tones = want.notes.length, singles = want.groups.filter((g) => g.tones.length === 1).length;
  const found = want.notes.filter((n) => !n.borrowed).length;
  if (Math.abs(spec.stats.compTones - (strokes ? tones / strokes : 0)) > 1e-12 || Math.abs(spec.stats.compSingles - (strokes ? singles / strokes : 0)) > 1e-12) bad.push(`stats ${spec.stats.compTones}/${spec.stats.compSingles}, the brute force's ${tones / strokes}/${singles / strokes}`);
  if (Math.abs(spec.stats.compStrum - (tones ? found / tones : 0)) > 1e-12) bad.push(`compStrum ${spec.stats.compStrum}`);
  return bad;
}

// ── P33–P36: the tolerance, nothing borrowed, single notes, the stats ──
console.log('\n— P33–P36: every tone the row\'s, inside its stroke\'s window; single notes; the stats');
{
  const bad = [];
  let n = 0, singles = 0, offChord = 0, tonesAll = 0, strokesAll = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 2]) for (const tolerance of COMP_TOLERANCES) for (const borrow of [false, true]) {
    if (seed === 2 && borrow) continue;
    const spec = compose(L, T, { seed, overrides: { ...(tolerance !== 0.5 ? { compTolerance: tolerance } : {}), ...(borrow ? { compBorrow: true } : {}) } }); n++;
    for (const b of audit(spec).slice(0, 2)) bad.push(`${L.join(':')} s${seed} ±${tolerance}${borrow ? ' borrow' : ''}: ${b}`);
    if (!borrow) {
      for (const g of lastWant.groups) { strokesAll++; tonesAll += g.tones.length; if (g.tones.length === 1) singles++; if (g.tones[0].offChord) offChord++; }
    }
  }
  check(`${n} composes (8 rows × the 4 tolerances, borrowing off on 2 seeds and on): every tone the brute force's — off, ${strokesAll} strokes, ${tonesAll} tones, each a row onset within its stroke's window, none borrowed, ${singles} single notes, ${offChord} strokes on a frame tone no chord class; the octaves and lanes, the stats`, !bad.length && singles > 0 && offChord > 0, bad.slice(0, 4).join('; '));
  // close, Fill, charts, a MIDI target
  const more = [];
  let m = 0;
  for (const [L, T] of ROWS.slice(0, 6)) for (const overrides of [{ voicing: 'close' }, { compRelation: 'fill' }, { voicing: 'close', compTolerance: 1 }, { compRelation: 'fill', compBorrow: true, compTolerance: 0.125 }]) {
    const spec = compose(L, T, { seed: 1, overrides }); m++;
    for (const b of audit(spec).slice(0, 2)) more.push(`${L.join(':')} ${J(overrides)}: ${b}`);
  }
  for (const [L, T, changes] of [[[8, 7, 6, 5], 4, [[1, 1], [1]]], [[119, 42, 15, 8], 8, [[1, 1], [1], [1, 1], [1]]], [[768, 784], 8, [[1, 1], [2, 1], [1], [1, 1, 1, 1]]]]) for (const overrides of [{}, { compTolerance: 1 }, { compBorrow: true }]) {
    const spec = compose(L, T, { seed: 1, changes, overrides }); m++;
    for (const b of audit(spec).slice(0, 2)) more.push(`${L.join(':')} chart ${J(overrides)}: ${b}`);
  }
  for (const overrides of [{}, { compTolerance: 0.25, compBorrow: true }]) { const tg = compose([41, 42, 43], 8, { seed: 1, target: ODE(), overrides }); m++; for (const b of audit(tg).slice(0, 2)) more.push(`41:42:43 target ${J(overrides)}: ${b}`); }
  check(`${m} more (close, Fill, a wide and a tight window, charts with split bars, a MIDI target): the brute force's`, !more.length, more.slice(0, 4).join('; '));

  // a stroke with no other chord tone in its window is a single note: its own onset alone
  const s = compose([11, 9, 7, 5], 4, { seed: 1 }), comp = s.parts.find((p) => p.id === 'comp');
  audit(s);
  const lone = lastWant.groups.filter((g) => g.tones.length === 1), ok = lone.every((g) => comp.notes.filter((x) => x.node === g.s && x.bar === g.U.bar).length === 1);
  check(`11:9:7:5 at ±½: ${lone.length} of ${lastWant.groups.length} strokes find no other chord tone in their window, and each plays its own onset alone (stats ${s.stats.compTones.toFixed(1)} tones a stroke, ${Math.round(100 * s.stats.compSingles)} % single)`, lone.length === lastWant.groups.length && ok && s.stats.compSingles === 1 && s.stats.compStrum === 1);
  // the words (P36)
  const d = s.decisions.find((x) => x.what === 'compStrum').why, asked = compose([11, 9, 7, 5], 4, { seed: 1, overrides: { compTolerance: 1 } }).decisions.find((x) => x.what === 'compStrum').why;
  const b = compose([11, 9, 7, 5], 4, { seed: 1, overrides: { compBorrow: true, compTolerance: 0.25 } }).decisions.find((x) => x.what === 'compStrum').why;
  check(`the decision says the tolerance and what it found ("${d.slice(d.indexOf('±'))}"); asked, "asked"; borrowing, the old words`, /±½ slot: 1\.0 tones a stroke, 100 % single notes; nothing borrowed/.test(d) && /\(asked\): ±1 slot:/.test(asked)
    && /from the row within ±0\.25 slot, the rest borrowed from the chord voices$/.test(b) && toleranceWords(0.125) === '±⅛ slot');
  check('the overrides checked: a tolerance not in the list, a borrow not a boolean, either with the comp in notes', [() => compose([8, 7, 6, 5], 4, { overrides: { compTolerance: 0.3 } }), () => compose([8, 7, 6, 5], 4, { overrides: { compBorrow: 'yes' } }),
    () => compose([8, 7, 6, 5], 4, { overrides: { compStyle: 'notes', compTolerance: 1 } })].every((f) => { try { f(); return false; } catch { return true; } }));
}

// ── P34's pin: borrowing at ±¼ is the comp before Amendment 3 ──
console.log('\n— P34: `compBorrow: true` with `compTolerance: 0.25`, the comp before Amendment 3');
{
  const bad = [];
  let n = 0, borrowed = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 2, 3]) for (const overrides of [{}, { voicing: 'close' }, { compRelation: 'fill' }, { claveFrom: 'pattern' }]) {
    const spec = compose(L, T, { seed, overrides: { ...overrides, compBorrow: true, compTolerance: 0.25 } }); n++;
    for (const b of audit(spec).slice(0, 1)) bad.push(`${L.join(':')} s${seed} ${J(overrides)}: ${b}`);
    borrowed += spec.parts.find((p) => p.id === 'comp').notes.filter((x) => x.borrowed).length;
    // every stroke sounds the classes its bar's chord voices hold (full chords), as before Amendment 3
  }
  check(`${n} composes pinned (8 rows × 3 seeds × led, close, Fill, the pattern clave): the brute force's borrowed full chords at ±¼, tone for tone (${borrowed} borrowed tones)`, !bad.length && borrowed > 0, bad.slice(0, 4).join('; '));
}

// ── P37: restrum, live, byte for byte a Compose ──
console.log('\n— P37: restrum, byte for byte a Compose given the same overrides');
{
  const bad = [];
  let n = 0;
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !(k === 'compTolerance' && v === 0.5) && !(k === 'compBorrow' && v === false)));
  for (const [L, T] of ROWS) for (const from of [{}, { compTolerance: 1, compBorrow: true }]) for (const extra of [{}, { voicing: 'close' }, { compRelation: 'fill' }]) {
    if (L[0] > 100 && Object.keys(extra).length) continue;
    const base = compose(L, T, { seed: 1, overrides: { ...extra, ...from } }), M = materialsOf(base);
    for (const tolerance of COMP_TOLERANCES) for (const borrow of [false, true]) {
      const r = rearrange(base, M.row, M.cells, { tolerance, borrow }), got = applyRearrange(base, r), want = compose(L, T, { seed: 1, overrides: { ...extra, ...strip({ compTolerance: tolerance, compBorrow: borrow }) } }); n++;
      if (J(got) !== J(want)) bad.push(`${L.join(':')} ${J(from)} ${J(extra)} → ±${tolerance}${borrow ? ' borrow' : ''}: ${Object.keys(want).filter((k) => J(got[k]) !== J(want[k])).join(', ')}`);
      if (J(got.clave) !== J(base.clave) || J(got.parts.find((p) => p.id === 'comp').strokes) !== J(base.parts.find((p) => p.id === 'comp').strokes)) bad.push(`${L.join(':')}: the strokes moved`);
      if (J(got.drums.hits.filter((h) => h.voice === 'perc')) !== J(base.drums.hits.filter((h) => h.voice === 'perc'))) bad.push(`${L.join(':')}: the perc moved`);
      if (J(got.parts.filter((p) => p.id !== 'comp')) !== J(base.parts.filter((p) => p.id !== 'comp'))) bad.push(`${L.join(':')}: another part moved`);
    }
  }
  // a chart, a MIDI target, a restrum to the same setting
  for (const [L, T, changes] of [[[119, 42, 15, 8], 8, [[1, 1], [1], [1, 1], [1]]], [[768, 784], 8, [[1, 1], [2, 1], [1], [1, 1, 1, 1]]]]) {
    const base = compose(L, T, { seed: 1, changes }), M = materialsOf(base), got = applyRearrange(base, restrum(base, M.row, M.cells, { tolerance: 1 })); n++;
    if (J(got) !== J(compose(L, T, { seed: 1, changes, overrides: { compTolerance: 1 } }))) bad.push(`${L.join(':')} chart`);
  }
  {
    const tg = ODE(), base = compose([41, 42, 43], 8, { seed: 1, target: tg }), M = materialsOf(base), got = applyRearrange(base, restrum(base, M.row, M.cells, { borrow: true })), want = compose([41, 42, 43], 8, { seed: 1, target: tg, overrides: { compBorrow: true } }); n++;
    const norm = (x) => { const y = JSON.parse(J(x)); delete y.target.search; return y; };
    if (J(norm(got)) !== J(norm(want))) bad.push('41:42:43 target');
    const same = restrum(base, M.row, M.cells, {});
    if (J(applyRearrange(base, same)) !== J(base) || same.changedBars.length) bad.push('a restrum to the same setting moved something');
  }
  check(`${n} restrums (8 rows from the default and from ±1 with borrowing, led, close and Fill, to every tolerance with borrowing off and on; 2 charts; a MIDI target): byte for byte a Compose given the same overrides (input, parts, stats, decisions, drums), the clave, its strokes, the perc and every other part unmoved; the same setting moves nothing`, !bad.length, bad.slice(0, 4).join('; '));
  const s = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compStyle: 'notes' } }), M = materialsOf(s);
  check('restrum refuses a comp in notes, a tolerance not in the list, a borrow not a boolean', [() => restrum(s, M.row, M.cells, { tolerance: 1 }), () => { const d = compose([8, 7, 6, 5], 4, { seed: 1 }), m = materialsOf(d); restrum(d, m.row, m.cells, { tolerance: 2 }); },
    () => { const d = compose([8, 7, 6, 5], 4, { seed: 1 }), m = materialsOf(d); restrum(d, m.row, m.cells, { borrow: 1 }); }].every((f) => { try { f(); return false; } catch { return true; } }));
}

// ── P37: a chord swap re-strums its bar at the setting ──
console.log('\n— P37: a chord swap re-strums its bar at the setting');
{
  const bad = [];
  let n = 0, moved = 0;
  for (const [L, T] of ROWS.filter(([L]) => L.length > 2 || L[0] > 700)) for (const overrides of [{ compTolerance: 1 }, { compTolerance: 0.125 }, { compBorrow: true }, { voicing: 'close', compTolerance: 1 }]) {
    const full = compose(L, T, { seed: 1, trace: {}, overrides }), { trace, ...spec } = full, M = materialsOf(spec);
    const h = trace.events.find((x) => x.kind === 'harmony'), ev = trace.events.filter((x) => x.kind === 'chord' && x.round === h.chosenRound);
    for (const e of ev.slice(0, 3)) {
      const alt = e.candidates.slice(0, 4).find((c, i) => i !== e.pickIndex);
      if (!alt) continue;
      const r = rearrange(spec, M.row, M.cells, { bar: e.bar, chord: alt }), next = applyRearrange(spec, r); n++;
      for (const b of audit(next).slice(0, 1)) bad.push(`${L.join(':')} ${J(overrides)} bar ${e.bar}: ${b}`);
      const keyOf = (s, k) => J(s.parts.find((p) => p.id === 'comp').notes.filter((x) => x.bar === k).map((x) => J([x.node, x.ratio, x.velocity, x.borrowed ?? false])).sort());
      const others = spec.chords.map((_, k) => k).filter((k) => k !== e.bar);
      if (others.some((k) => keyOf(spec, k) !== keyOf(next, k))) bad.push(`${L.join(':')} bar ${e.bar}: another bar's comp moved`);
      if (keyOf(spec, e.bar) !== keyOf(next, e.bar)) moved++;
    }
  }
  check(`${n} chord swaps over composes at ±1, ±⅛, with borrowing and close: the swapped bar re-strummed at the setting (the brute force's tones, stats recounted; ${moved} bars' comp changed), no other bar's tones moved`, !bad.length && n > 10 && moved > 0, bad.slice(0, 4).join('; '));
}

// ── P38: a sparser clave wins a tie ──
console.log('\n— P38: the frame candidates\' tie order, sparser first');
{
  const bad = [];
  let n = 0, ties = 0, broke = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 2, 3]) for (const compDensity of ['sparse-med', 'medium', 'dense']) {
    const s = compose(L, T, { seed, trace: true, overrides: compDensity === 'sparse-med' ? {} : { compDensity } }); n++;
    const ev = s.trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave), alts = ev.alternates.filter((a) => a.from?.frame);
    for (let i = 1; i < alts.length; i++) {
      const a = alts[i - 1], b = alts[i];
      if (b.score > a.score + EPS) bad.push(`${L.join(':')} s${seed} ${compDensity}: ${b.id} outscores ${a.id} after it`);
      else if (Math.abs(a.score - b.score) <= EPS) { ties++; if (b.share < a.share - EPS) bad.push(`${L.join(':')} s${seed} ${compDensity}: ${b.id} (${b.share}) is sparser than ${a.id} (${a.share}) after it at the same score`); }
    }
    if (!alts.length || !s.clave.from?.frame) continue;
    // the clave Compose plays: among the best score, the sparsest (the trace keeps the top 12, the tie runs inside them)
    const best = alts.filter((a) => Math.abs(a.score - alts[0].score) <= EPS), sparsest = Math.min(...best.map((a) => a.share));
    const mine = best.find((a) => a.id === s.clave.id);
    if (!mine || Math.abs(mine.share - sparsest) > EPS) bad.push(`${L.join(':')} s${seed} ${compDensity}: ${s.clave.id} plays, not the sparsest of the best (${best.map((a) => `${a.id} ${a.share.toFixed(3)}`).join(', ')})`);
    if (best.length > 1 && new Set(best.map((a) => a.share.toFixed(9))).size > 1) broke++;
  }
  check(`${n} composes (8 rows × 3 seeds × 3 densities): the frame candidates by score, ${ties} ties by share (the lower first); the clave played the sparsest of the best (${broke} composes where the share broke a tie the seed used to)`, !bad.length && ties > 0 && broke > 0, bad.slice(0, 4).join('; '));
}

// ── the probe's table and the 16k row ──
console.log('\n— the probe\'s table (seed 1, ±½, nothing borrowed) and the 16k row');
{
  const rows = [...ROWS.slice(0, 5), [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
  const table = rows.map(([L, T]) => { const s = compose(L, T, { seed: 1 }); return `${L.join(':')} ${s.stats.compTones.toFixed(1)} tones a stroke, ${Math.round(100 * s.stats.compSingles)} % single (${s.stats.clave.strokes} strokes)`; });
  for (const line of table) console.log(`    ${line}`);
  check('every probe row composes at ±½ with nothing borrowed, the stats in range', rows.every(([L, T]) => { const s = compose(L, T, { seed: 1 }); return s.stats.compTones >= 1 && s.stats.compTones <= 4 && s.stats.compSingles >= 0 && s.stats.compSingles <= 1 && s.stats.compStrum === 1; }));

  const L = [4099, 4093, 4091, 4079], T = 16;
  compose(L, T, { seed: 1 });   // warm
  let t0 = now();
  const big = compose(L, T, { seed: 1 }), composeMs = now() - t0, M = materialsOf(big);
  restrum(big, M.row, M.cells, { tolerance: 0.25 });   // warm: the part context
  const times = [];
  let last = null;
  for (const tolerance of COMP_TOLERANCES) for (const borrow of [false, true]) { t0 = now(); last = restrum(big, M.row, M.cells, { tolerance, borrow }); times.push(now() - t0); }
  const med = [...times].sort((a, b) => a - b)[times.length >> 1], worst = Math.max(...times);
  const sw = big.chords.length > 1 ? (() => { const t1 = now(); rearrange(applyRearrange(big, last), M.row, M.cells, { bar: 0, chord: { rootTone: big.chords[1].rootTone, quality: big.chords[1].quality } }); return now() - t1; })() : 0;
  console.log(`    16k: Compose ${composeMs.toFixed(0)} ms (lean, ${big.stats.clave.strokes} strokes, ${big.stats.compTones.toFixed(1)} tones a stroke, ${Math.round(100 * big.stats.compSingles)} % single); a restrum ${med.toFixed(1)} ms median, ${worst.toFixed(1)} ms the slowest; a chord swap after it ${sw.toFixed(1)} ms`);
  check(`16k: Compose ${composeMs.toFixed(0)} ms (≤ 1 s), a restrum ${med.toFixed(1)} ms median (≤ ~15 ms on the main thread)`, composeMs <= 1000 && med <= 15, `${composeMs.toFixed(0)} / ${med.toFixed(1)} ms`);
}

console.log(PASS ? `\n✓✓✓ THE COMP'S TOLERANCE PASSES (${checks} checks)` : '\n✗ THE COMP\'S TOLERANCE FAILED');
process.exit(PASS ? 0 : 1);
