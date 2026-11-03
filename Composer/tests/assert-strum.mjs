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
import { compose, partContext, COMP_TOLERANCES, COMP_GATES, COMP_ROLLS, toleranceWords, compStrumOf, COMPOSER_SPEC_VERSION } from '../core/compose.js';
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

/** the order's setting for a spec, read from its input (COMP_GATE_ORDER.md G4–G5, written here): Snap, else the old window
 *  asked, else the gate (25 ms unless asked); a spec of the version before phase P with neither a gate nor Snap: ±½ slot;
 *  `scale` the heard ms → spec ms factor (G2: the seed tempo, a target's clip tempo clamped 30–300, over the spec's) */
function settingOf(spec) {
  const ov = spec.input.overrides ?? {}, borrow = ov.compBorrow ?? false;
  const seed = spec.target?.tempoBpm > 0 ? Math.min(300, Math.max(30, spec.target.tempoBpm)) : spec.knobs.tempoBpm, scale = seed / spec.knobs.tempoBpm;
  if (spec.version !== COMPOSER_SPEC_VERSION && ov.compGate == null && ov.compSnap == null) return { tolerance: ov.compTolerance ?? 0.5, borrow, scale };
  if (ov.compSnap) return { snap: true, roll: ov.compRoll ?? 0, borrow, scale };
  if (ov.compTolerance != null) return { tolerance: ov.compTolerance, borrow, scale };
  return { gate: ov.compGate ?? 25, borrow, scale };
}
/** a setting's window around stroke s, in spec seconds: Snap ±¼ slot, the gate ±g ms heard (× scale), the old ±tolerance slot */
const windowOf = (G, st, s) => (st.snap ? 0.25 * G.ctx.slotSeconds(G.ctx.posSlot[s]) : st.gate != null ? (st.gate / 1000) * (st.scale ?? 1) : st.tolerance * G.ctx.slotSeconds(G.ctx.posSlot[s]));

/** the strum the order asks for, by brute force over the spec's chords, its chords part and its clave → { notes, strokes,
 *  groups: [{ s, tones: [expected note] }] }. Snap (G3): every tone found struck at the stroke's time (`snapped`, `from`
 *  its own onset; the stroke's own onset and a borrowed tone are not snapped), then rolled: the stroke's own tone first,
 *  the rest low to high, each `roll` ms heard (× scale) after the one before, the roll's span under half the hold */
function expected(spec, G, st) {
  const { borrow } = st;
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
      const w = windowOf(G, st, s);
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
      // Snap: each found tone on the stroke; the roll
      const placed = tones.map((t) => (st.snap && !t.borrowed && t.node !== s ? { ...t, snapped: true, from: t.node, node: s, own: t.node, moved: Math.abs(G.time(t.node) - ts) * 1000 / (st.scale ?? 1) } : { ...t, own: t.borrowed ? null : t.node }));
      for (const t of placed) t.time = t.borrowed || t.snapped ? ts : G.time(t.node);
      // the roll's order needs the tones' pitches (their octaves are P35's, audited apart): the audit reads them off the notes
      const roll = st.snap && st.roll > 0 && placed.length > 1 ? { step: Math.min((st.roll / 1000) * (st.scale ?? 1), (holdTo - ts) / (2 * (placed.length - 1))) } : null;
      groups.push({ s, U, tones: placed.map((t) => ({ ...t, holdTo })), ...(roll ? { roll } : {}) });
      for (const t of placed) notes.push({ ...t, bar: U.bar, holdTo, stroke: s });
    });
  }
  return { notes, strokes, groups };
}
/** the overrides a restrum lands on (G7, written from the order): a window asked takes the place of the others (an old
 *  window always written, a gate unless 25, Snap with its roll unless 0: kept from a Snap that plays when none is asked);
 *  `tolerance: null` or `snap: false` leaves that mode for the gate it played (none: 25); borrowing as asked, else as it
 *  played; nothing asked, the mode it played */
function doorOv(from, edit) {
  const borrow = edit.borrow ?? from.compBorrow ?? false, b = borrow ? { compBorrow: true } : {};
  const gate = (g) => (g != null && g !== 25 ? { compGate: g } : {}), snap = (r) => ({ compSnap: true, ...(r ? { compRoll: r } : {}) });
  if (edit.tolerance != null) return { compTolerance: edit.tolerance, ...b };
  if (edit.gate != null) return { ...gate(edit.gate), ...b };
  if (edit.snap === true) return { ...snap(edit.roll ?? (from.compSnap ? from.compRoll : 0)), ...b };
  if (from.compSnap && edit.snap !== false) return { ...snap(edit.roll ?? from.compRoll), ...b };
  if (from.compSnap) return { ...b };
  if (from.compTolerance != null && edit.tolerance !== null) return { compTolerance: from.compTolerance, ...b };
  return { ...gate(from.compGate), ...b };
}
const noteKey = (n) => J([n.node, n.bar, n.ratio, n.velocity, Math.round(n.holdTo * 1e9), n.borrowed ? n.from : null, !!n.offChord, n.snapped ? n.from : null]);

let lastWant = null;
/** a spec's comp against the brute force and the order's rules → [problem] */
function audit(spec, setting = null) {
  const G = geometryOf(spec), comp = spec.parts.find((p) => p.id === 'comp');
  const st = setting ?? settingOf(spec);
  const want = lastWant = expected(spec, G, st), bad = [];
  if (J(comp.strokes) !== J([...want.strokes].sort((a, b) => a.time - b.time || a.node - b.node))) bad.push('the strokes are not the clave\'s (its partner\'s in Fill)');
  const a = comp.notes.map(noteKey).sort(), b = want.notes.map(noteKey).sort();
  if (J(a) !== J(b)) { const miss = b.find((k) => !a.includes(k)), extra = a.find((k) => !b.includes(k)); bad.push(`the tones differ from the brute force's (missing ${miss}, extra ${extra})`); return bad; }
  if (!st.borrow && comp.notes.some((n) => n.borrowed)) bad.push('a borrowed tone with nothing borrowed');
  if (!st.snap && comp.notes.some((n) => n.snapped)) bad.push('a snapped tone with no Snap');
  // every tone an onset of the row at its own time, inside its stroke's window and unit; the octaves and lanes (P35)
  const { row, ctx } = G, key = new Map(comp.notes.map((n) => [noteKey(n), n]));
  for (const g of want.groups) {
    const got = g.tones.map((t) => key.get(noteKey({ ...t, bar: g.U.bar })));
    const ts = G.time(g.s), w = windowOf(G, st, g.s), root = rootCentsOf(G, g.U.c);
    for (const n of got) {
      const own = n.snapped ? n.from : n.node, rolled = !!g.roll;
      if (n.tick !== row.tick[n.node] || (!rolled && Math.abs(n.time - (n.borrowed || n.snapped ? ts : G.time(n.node))) > EPS)) bad.push(`node ${n.node}: not at its own onset (or, snapped, its stroke's)`);
      if (n.snapped && (n.node !== g.s || n.fromTick !== row.tick[n.from] || n.ratio !== row.tones[row.tone[n.from]])) bad.push(`node ${n.from}: snapped, not on its stroke ${g.s} with its own tone`);
      if (!n.borrowed && Math.abs(G.time(own) - ts) > w + EPS) bad.push(`node ${own}: outside its stroke's window (${st.snap ? 'Snap ±¼ slot' : st.gate != null ? `${st.gate} ms heard` : `±${st.tolerance} slot`})`);
      // G1: every gated tone a row onset within g ms, heard at the seed tempo, of its stroke
      if (st.gate != null && !n.borrowed && Math.abs(G.time(own) - ts) * 1000 / (st.scale ?? 1) > st.gate + 1e-6) bad.push(`node ${own}: ${(Math.abs(G.time(own) - ts) * 1000).toFixed(2)} ms from its stroke, past the ${st.gate} ms gate`);
      if (ctx.posSlot[own] < g.U.from || ctx.posSlot[own] >= g.U.to) bad.push(`node ${own}: outside its bar or span`);
      if (!(Number.isInteger(n.voice) && n.voice >= 0 && n.voice < MAX)) bad.push(`node ${n.node}: voice ${n.voice}`);
    }
    if (new Set(got.map((n) => n.voice)).size !== got.length) bad.push(`stroke ${g.s}: two tones in one voice`);
    const pitch = (n) => row.toneCents[row.tone[n.borrowed || n.snapped ? n.from : n.node]] + 1200 * n.octave;
    // G3: the roll — the stroke's own tone first, the rest low to high, `step` apart
    if (g.roll) {
      const own = got.find((n) => n.node === g.s && !n.snapped && !n.borrowed), rest = got.filter((n) => n !== own).sort((a, b) => pitch(a) - pitch(b) || a.voice - b.voice);
      [...(own ? [own] : []), ...rest].forEach((n, r) => { if (Math.abs(n.time - (ts + r * g.roll.step)) > EPS) bad.push(`stroke ${g.s}: tone ${r} rolled to ${(1000 * (n.time - ts)).toFixed(3)} ms, not ${(1000 * r * g.roll.step).toFixed(3)}`); });
    }
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
      const order = (t) => (t.cls >= 0 ? t.cls : classOfCents(row.toneCents[row.tone[t.snapped ? t.from : t.node]] - root).pc + 0.5);
      const sorted = [...g.tones].sort((x, y) => order(x) - order(y) || x.cls - y.cls);
      let floor = root + CHORDS_REGISTER - 50;
      for (const t of sorted) {
        const n = key.get(noteKey({ ...t, bar: g.U.bar })), c = row.toneCents[row.tone[t.borrowed || t.snapped ? t.from : t.node]], oct = Math.ceil((floor - c) / 1200 - EPS);
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
  // G6: Snap's compMovedMs, the mean and max a snapped tone moved (heard ms); none without Snap
  const moved = want.notes.filter((n) => n.snapped).map((n) => n.moved);
  if (st.snap) {
    const m = spec.stats.compMovedMs, mean = moved.length ? moved.reduce((a, b) => a + b, 0) / moved.length : 0, max = moved.length ? Math.max(...moved) : 0;
    if (!m || Math.abs(m.mean - mean) > 1e-6 || Math.abs(m.max - max) > 1e-6) bad.push(`compMovedMs ${J(m)}, the brute force's ${mean}/${max}`);
  } else if (spec.stats.compMovedMs !== undefined) bad.push('compMovedMs with no Snap');
  return bad;
}

// ── P33–P36: the tolerance, nothing borrowed, single notes, the stats ──
console.log('\n— P33–P36: every tone the row\'s, inside its stroke\'s window; single notes; the stats');
{
  const bad = [];
  let n = 0, singles = 0, offChord = 0, tonesAll = 0, strokesAll = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 2]) for (const tolerance of COMP_TOLERANCES) for (const borrow of [false, true]) {
    if (seed === 2 && borrow) continue;
    const spec = compose(L, T, { seed, overrides: { compTolerance: tolerance, ...(borrow ? { compBorrow: true } : {}) } }); n++;
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

  // a stroke with no other chord tone in its window is a single note: its own onset alone (pinned at ±½: phase P's
  // `compTolerance: 0.5` is the default before it, byte for byte)
  const s = compose([11, 9, 7, 5], 4, { seed: 1, overrides: { compTolerance: 0.5 } }), comp = s.parts.find((p) => p.id === 'comp');
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
  // phase P: the old window is no longer the default, so a restrum to ±½ writes `compTolerance: 0.5` (only `compBorrow: false` is left out)
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => !(k === 'compBorrow' && v === false)));
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
console.log('\n— the probe\'s table (seed 1, ±½ pinned, nothing borrowed) and the 16k row');
{
  const rows = [...ROWS.slice(0, 5), [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
  const table = rows.map(([L, T]) => { const s = compose(L, T, { seed: 1, overrides: { compTolerance: 0.5 } }); return `${L.join(':')} ${s.stats.compTones.toFixed(1)} tones a stroke, ${Math.round(100 * s.stats.compSingles)} % single (${s.stats.clave.strokes} strokes)`; });
  for (const line of table) console.log(`    ${line}`);
  check('every probe row composes at ±½ with nothing borrowed, the stats in range', rows.every(([L, T]) => { const s = compose(L, T, { seed: 1, overrides: { compTolerance: 0.5 } }); return s.stats.compTones >= 1 && s.stats.compTones <= 4 && s.stats.compSingles >= 0 && s.stats.compSingles <= 1 && s.stats.compStrum === 1; }));

  const L = [4099, 4093, 4091, 4079], T = 16;
  compose(L, T, { seed: 1 });   // warm
  let t0 = now();
  const big = compose(L, T, { seed: 1 }), composeMs = now() - t0, M = materialsOf(big);
  restrum(big, M.row, M.cells, { tolerance: 0.25 });   // warm: the part context
  const times = [];
  let last = null;
  for (const tolerance of COMP_TOLERANCES) for (const borrow of [false, true]) { t0 = now(); last = restrum(big, M.row, M.cells, { tolerance, borrow }); times.push(now() - t0); }
  // phase P: the gates, Snap and its rolls
  for (const gate of COMP_GATES) { t0 = now(); restrum(big, M.row, M.cells, { gate }); times.push(now() - t0); }
  for (const roll of COMP_ROLLS) { t0 = now(); restrum(big, M.row, M.cells, { snap: true, roll }); times.push(now() - t0); }
  const med = [...times].sort((a, b) => a - b)[times.length >> 1], worst = Math.max(...times);
  const sw = big.chords.length > 1 ? (() => { const t1 = now(); rearrange(applyRearrange(big, last), M.row, M.cells, { bar: 0, chord: { rootTone: big.chords[1].rootTone, quality: big.chords[1].quality } }); return now() - t1; })() : 0;
  console.log(`    16k: Compose ${composeMs.toFixed(0)} ms (lean, ${big.stats.clave.strokes} strokes, ${big.stats.compTones.toFixed(1)} tones a stroke, ${Math.round(100 * big.stats.compSingles)} % single); a restrum ${med.toFixed(1)} ms median, ${worst.toFixed(1)} ms the slowest; a chord swap after it ${sw.toFixed(1)} ms`);
  check(`16k: Compose ${composeMs.toFixed(0)} ms (≤ 1 s), a restrum ${med.toFixed(1)} ms median (≤ ~15 ms on the main thread)`, composeMs <= 1000 && med <= 15, `${composeMs.toFixed(0)} / ${med.toFixed(1)} ms`);
}

// ═══ phase P (COMP_GATE_ORDER.md G1–G9): the gate in ms, Snap and its roll, precedence, old specs, restrum ═══
const throws = (f, re = null) => { try { f(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const CHART_ROWS = [[[8, 7, 6, 5], 4, [[1, 1], [1]]], [[119, 42, 15, 8], 8, [[1, 1], [1], [1, 1], [1]]], [[768, 784], 8, [[1, 1], [2, 1], [1], [1, 1, 1, 1]]]];

console.log('\n— G1, G2, G6: the gate — every tone a row onset within g ms (heard) of its stroke; the stats and words');
{
  const bad = [];
  let n = 0, strokes = 0, tones = 0, singles = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 2]) for (const gate of [...COMP_GATES, null]) for (const borrow of [false, true]) {
    if (seed === 2 && borrow) continue;
    const spec = compose(L, T, { seed, overrides: { ...(gate != null ? { compGate: gate } : {}), ...(borrow ? { compBorrow: true } : {}) } }); n++;
    for (const b of audit(spec).slice(0, 2)) bad.push(`${L.join(':')} s${seed} ${gate ?? 'default'} ms${borrow ? ' borrow' : ''}: ${b}`);
    if (!borrow) for (const g of lastWant.groups) { strokes++; tones += g.tones.length; if (g.tones.length === 1) singles++; }
  }
  check(`${n} composes (8 rows × 15 | 25 | 40 ms and the default, borrowing off on 2 seeds and on): every tone the brute force's, each a row onset within the gate (heard) of its stroke at its own time — off, ${strokes} strokes, ${tones} tones, ${singles} single notes; octaves, lanes, stats`, !bad.length && singles > 0, bad.slice(0, 4).join('; '));
  const more = [];
  let m = 0;
  for (const [L, T] of ROWS.slice(0, 6)) for (const overrides of [{ voicing: 'close' }, { compRelation: 'fill' }, { voicing: 'close', compGate: 40 }, { compRelation: 'fill', compBorrow: true, compGate: 15 }]) {
    const spec = compose(L, T, { seed: 1, overrides }); m++;
    for (const b of audit(spec).slice(0, 2)) more.push(`${L.join(':')} ${J(overrides)}: ${b}`);
  }
  for (const [L, T, changes] of CHART_ROWS) for (const overrides of [{}, { compGate: 40 }, { compBorrow: true }]) {
    const spec = compose(L, T, { seed: 1, changes, overrides }); m++;
    for (const b of audit(spec).slice(0, 2)) more.push(`${L.join(':')} chart ${J(overrides)}: ${b}`);
  }
  check(`${m} more (close, Fill, charts with split bars): the brute force's`, !more.length, more.slice(0, 4).join('; '));
  // the probe's table as a check (G1): single notes on the simple rows, real chords on the dense near-unison row
  const at = (L, T, o = {}) => compose(L, T, { seed: 1, overrides: o });
  const p = { a: at([8, 7, 6, 5], 4), b: at([16, 12, 9], 4), c: at([7, 5, 3, 2], 4), d: at([768, 784], 8) };
  check(`the probe at 25 ms: 8:7:6:5 ${p.a.stats.compTones.toFixed(2)}, 16:12:9 ${p.b.stats.compTones.toFixed(2)}, 7:5:3:2 ${p.c.stats.compTones.toFixed(2)} tones a stroke (1.0); 768:784 ${p.d.stats.compTones.toFixed(2)} (≥ 2.5)`,
    [p.a, p.b, p.c].every((x) => x.stats.compTones === 1 && x.stats.compSingles === 1) && p.d.stats.compTones >= 2.5);
  for (const [L, T] of ROWS) { const r = COMP_GATES.map((g) => at(L, T, { compGate: g }).stats.compTones.toFixed(2)); console.log(`    ${L.join(':')} gate 15 / 25 / 40 ms: ${r.join(' / ')} tones a stroke`); }
  const d = p.a.decisions.find((x) => x.what === 'compStrum').why, asked = at([8, 7, 6, 5], 4, { compGate: 40 }).decisions.find((x) => x.what === 'compStrum').why;
  const fb = at([768, 784], 8, { compBorrow: true }).decisions.find((x) => x.what === 'compStrum').why;
  check(`the words (G6): "${d.slice(d.indexOf('25 ms'))}"; asked, "asked"; filled, the tones found within the gate and the rest borrowed`, /: 25 ms gate: 1\.0 tones a stroke, 100 % single notes; nothing borrowed/.test(d) && /by default/.test(d) && /\(asked\): 40 ms gate:/.test(asked)
    && /from the row within a 25 ms gate, the rest borrowed from the chord voices$/.test(fb));
  check('the default composes no strum override, and compStrumOf reads the gate at 25', J(p.a.input.overrides) === '{}' && J(compStrumOf(p.a)) === J({ gate: 25, tolerance: null, snap: false, roll: 0, borrow: false }) && p.a.version === COMPOSER_SPEC_VERSION);
}

console.log('\n— G2: a MIDI target — the gate heard at its clip\'s tempo');
{
  const tg = ODE(), bad = [];
  let n = 0, scale = 1, why = '';
  for (const overrides of [{}, { compGate: 40 }, { compGate: 15, compBorrow: true }, { compSnap: true, compRoll: 15 }, { compTolerance: 0.25, compBorrow: true }]) {
    const spec = compose([41, 42, 43], 8, { seed: 1, target: tg, overrides }); n++;
    scale = settingOf(spec).scale;
    for (const b of audit(spec).slice(0, 2)) bad.push(`${J(overrides)}: ${b}`);
    if (!Object.keys(overrides).length) why = spec.decisions.find((x) => x.what === 'compStrum').why;
  }
  const seed = Math.min(300, Math.max(30, tg.clip.tempoBpm));
  check(`${n} target composes (41:42:43 under ode-to-joy at ${tg.clip.tempoBpm} BPM, its natural tempo ×${(1 / scale).toFixed(3)}): the gate in spec time g × ${scale.toFixed(3)}, every tone the brute force's${scale !== 1 ? `; the words "heard at the clip's ${seed} BPM"` : ''}`,
    !bad.length && (scale === 1 || why.includes(`heard at the clip's ${+seed.toFixed(1)} BPM`)), bad.slice(0, 3).join('; '));
}

console.log('\n— G3, G6: Snap and its roll — every found tone on its stroke with its own tone; the roll\'s order and offsets; the stats');
{
  const bad = [];
  let n = 0, snapped = 0, rolled = 0;
  for (const [L, T] of ROWS) for (const roll of [null, ...COMP_ROLLS]) for (const borrow of [false, true]) {
    const overrides = { compSnap: true, ...(roll != null ? { compRoll: roll } : {}), ...(borrow ? { compBorrow: true } : {}) };
    const spec = compose(L, T, { seed: 1, overrides }); n++;
    for (const b of audit(spec).slice(0, 2)) bad.push(`${L.join(':')} ${J(overrides)}: ${b}`);
    snapped += spec.parts.find((p) => p.id === 'comp').notes.filter((x) => x.snapped).length;
    rolled += lastWant.groups.filter((g) => g.roll).length;
  }
  for (const [L, T] of ROWS.slice(0, 6)) for (const overrides of [{ voicing: 'close', compSnap: true, compRoll: 8 }, { compRelation: 'fill', compSnap: true }, { compRelation: 'fill', compSnap: true, compBorrow: true, compRoll: 15 }]) {
    const spec = compose(L, T, { seed: 2, overrides }); n++;
    for (const b of audit(spec).slice(0, 2)) bad.push(`${L.join(':')} s2 ${J(overrides)}: ${b}`);
  }
  for (const [L, T, changes] of CHART_ROWS) { const spec = compose(L, T, { seed: 1, changes, overrides: { compSnap: true, compRoll: 15 } }); n++; for (const b of audit(spec).slice(0, 2)) bad.push(`${L.join(':')} chart: ${b}`); }
  check(`${n} composes (8 rows × the rolls × borrowing; close, Fill, charts): every tone the brute force's — ${snapped} snapped tones on their strokes with their own tone and pitch class (from, fromTick), velocity 0.5; ${rolled} strokes rolled low to high, the stroke's own first; compMovedMs`, !bad.length && snapped > 0 && rolled > 0, bad.slice(0, 4).join('; '));
  // the probe's Snap column: 8:7:6:5 1.67 tones, up to 114 ms; 7:5:3:2 1.5, 286 ms; and the words
  const a = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compSnap: true } }), c = compose([7, 5, 3, 2], 4, { seed: 1, overrides: { compSnap: true } });
  const why = a.decisions.find((x) => x.what === 'compStrum').why;
  check(`the probe's Snap column: 8:7:6:5 ${a.stats.compTones.toFixed(2)} tones, moved up to ${a.stats.compMovedMs.max.toFixed(0)} ms; 7:5:3:2 ${c.stats.compTones.toFixed(2)}, ${c.stats.compMovedMs.max.toFixed(0)} ms; "${why.slice(why.indexOf('Snap'))}"`,
    a.stats.compTones.toFixed(2) === '1.67' && Math.round(a.stats.compMovedMs.max) === 114 && c.stats.compTones === 1.5 && Math.round(c.stats.compMovedMs.max) === 286 && /Snap \(±¼ slot\): 1\.7 tones a stroke, tones moved up to 114 ms/.test(why));
  // Snap with borrowing: every stroke a full chord on the beat (the stab) — each class of the first 4 the chord voices hold
  const st = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compSnap: true, compBorrow: true } }), comp = st.parts.find((p) => p.id === 'comp');
  // every stroke: as many tones as its bar's chord voices hold classes (the first 4), each at the stroke's time
  const chordsPart = st.parts.find((p) => p.id === 'chords').notes;
  const full = comp.strokes.every((x) => { const at = comp.notes.filter((y) => y.node === x.node && y.bar === x.bar), held = new Set(chordsPart.filter((y) => y.bar === x.bar && y.voice < 4).map((y) => y.voice)).size; return at.length === held && at.every((y) => Math.abs(y.time - x.time) < EPS); });
  check(`Snap with "fill from the chords": every stroke a full chord on the beat, each class its bar's chord voices hold (${st.stats.compTones.toFixed(1)} tones a stroke, all at the stroke's time; the gate's ${compose([8, 7, 6, 5], 4, { seed: 1 }).stats.compTones.toFixed(1)})`, full && st.stats.compTones > 2);
  // the stroke's own onset never moves; Snap's notes keep the stroke's tick
  check('a snapped note: its tick and node the stroke\'s, `from` its own onset, `snapped`; a borrowed one unchanged', comp.notes.every((y) => y.tick === comp.strokes.find((x) => x.node === y.node).tick) && comp.notes.some((y) => y.snapped) && comp.notes.some((y) => y.borrowed));
}

console.log('\n— G4: precedence, and the failures with words');
{
  const L = [8, 7, 6, 5], T = 4, c = (o) => () => compose(L, T, { seed: 1, overrides: o });
  check('compGate with compTolerance fails ("two windows"); compSnap with either fails ("takes the place of both"); compRoll without compSnap fails; a gate, a roll or a Snap not in the lists fails; in notes they fail',
    throws(c({ compGate: 25, compTolerance: 0.5 }), /two windows/) && throws(c({ compSnap: true, compGate: 15 }), /takes the place of both/) && throws(c({ compSnap: true, compTolerance: 0.25 }), /takes the place of both/)
    && throws(c({ compRoll: 8 }), /needs compSnap/) && throws(c({ compGate: 30 }), /15, 25, 40/) && throws(c({ compSnap: true, compRoll: 10 }), /0, 8, 15/) && throws(c({ compSnap: 'yes' }), /true or false/)
    && throws(c({ compStyle: 'notes', compGate: 25 })) && throws(c({ compStyle: 'notes', compSnap: true })));
  // the pins: compTolerance 0.5 is the default before phase P (the ±½ brute force), compBorrow + 0.25 the comp before Amendment 3
  const half = compose(L, T, { seed: 1, overrides: { compTolerance: 0.5 } }), legacy = compose(L, T, { seed: 1, overrides: { compTolerance: 0.25, compBorrow: true } });
  check('compTolerance: 0.5 plays the old ±½ window (an arpeggio: 2.0 tones a stroke on 8:7:6:5); compBorrow + 0.25 the full chords before Amendment 3', !audit(half).length && half.stats.compTones === 2 && !audit(legacy).length && legacy.parts.find((p) => p.id === 'comp').notes.some((x) => x.borrowed));
  const snapGate = compose(L, T, { seed: 1, overrides: { compSnap: true } });
  check('compSnap plays its ±¼ slot, not the gate: 8:7:6:5 1.7 tones where the gate gives 1.0', snapGate.stats.compTones > 1.5);
}

console.log('\n— G5: an old spec (before phase P) reads as ±½ slot; it re-strums as it was made');
{
  const bad = [];
  let n = 0;
  for (const [L, T] of ROWS.filter(([L]) => L.length > 2 || L[0] > 700)) for (const extra of [{}, { compBorrow: true }, { voicing: 'close' }]) {
    // a spec as phase O composed it: ±½ by default, so no compTolerance in its input, the old version
    const made = compose(L, T, { seed: 1, trace: {}, overrides: { ...extra, compTolerance: 0.5 } }), { trace, ...now } = made;
    const old = JSON.parse(J(now)); old.version = 'composer-spec-v1'; delete old.input.overrides.compTolerance; n++;
    if (J(compStrumOf(old)) !== J({ gate: null, tolerance: 0.5, snap: false, roll: 0, borrow: !!extra.compBorrow })) bad.push(`${L.join(':')}: read as ${J(compStrumOf(old))}`);
    // a chord swap re-strums its bar the old way
    const h = trace.events.find((x) => x.kind === 'harmony'), e = trace.events.find((x) => x.kind === 'chord' && x.round === h.chosenRound), alt = e?.candidates.slice(0, 4).find((x, i) => i !== e.pickIndex);
    const M = materialsOf(old);
    if (alt) { const next = applyRearrange(old, rearrange(old, M.row, M.cells, { bar: e.bar, chord: alt })); for (const b of audit(next, { tolerance: 0.5, borrow: !!extra.compBorrow, scale: 1 }).slice(0, 1)) bad.push(`${L.join(':')} swap: ${b}`); }
    // a restrum to the same setting: the comp as it was; written as this version reads it (compTolerance: 0.5, the new version)
    const same = applyRearrange(old, restrum(old, M.row, M.cells, {}));
    if (J(same.parts) !== J(old.parts) || same.version !== COMPOSER_SPEC_VERSION || same.input.overrides.compTolerance !== 0.5) bad.push(`${L.join(':')}: a restrum to the same setting moved the comp or kept the old version`);
    // a restrum to the gate from an old spec: a Compose given the gate (Compose's default), byte for byte
    const gated = applyRearrange(old, restrum(old, M.row, M.cells, { gate: 25 })), want = compose(L, T, { seed: 1, overrides: { ...extra } });
    if (J(gated.parts) !== J(want.parts) || J(gated.stats) !== J(want.stats) || J(gated.input) !== J(want.input)) bad.push(`${L.join(':')}: old → 25 ms is not a Compose's (${Object.keys(want).filter((k) => J(gated[k]) !== J(want[k])).join(', ')})`);
  }
  check(`${n} old specs (v1, no compTolerance in the input): read as ±½ slot (and their borrowing); a chord swap re-strums its bar at ±½; a restrum keeps the comp and writes it as this version (compTolerance 0.5); to the gate, a Compose's`, !bad.length, bad.slice(0, 4).join('; '));
}

console.log('\n— G7: restrum — each new key byte for byte a Compose; the strokes never move; one door; a chord swap at the setting');
{
  const bad = [];
  let n = 0;
  const EDITS = [[{ gate: 15 }, { compGate: 15 }], [{ gate: 40, borrow: true }, { compGate: 40, compBorrow: true }], [{ gate: 25 }, {}], [{ snap: true }, { compSnap: true }], [{ snap: true, roll: 8 }, { compSnap: true, compRoll: 8 }],
    [{ snap: true, roll: 15, borrow: true }, { compSnap: true, compRoll: 15, compBorrow: true }], [{ tolerance: 0.5 }, { compTolerance: 0.5 }], [{ tolerance: null }, {}], [{ snap: false }, {}]];
  for (const [L, T] of ROWS) for (const from of [{}, { compSnap: true, compRoll: 15 }, { compTolerance: 1, compBorrow: true }, { compGate: 40 }]) for (const extra of [{}, { voicing: 'close' }, { compRelation: 'fill' }]) {
    if (L[0] > 100 && Object.keys(extra).length) continue;
    const base = compose(L, T, { seed: 1, overrides: { ...extra, ...from } }), M = materialsOf(base);
    for (const [edit, ov] of EDITS) {
      const keep = doorOv(from, edit);
      const got = applyRearrange(base, rearrange(base, M.row, M.cells, edit)), want = compose(L, T, { seed: 1, overrides: { ...extra, ...keep } }); n++;
      if (J(got) !== J(want)) bad.push(`${L.join(':')} ${J(from)} ${J(extra)} → ${J(edit)}: ${Object.keys(want).filter((k) => J(got[k]) !== J(want[k])).join(', ')}`);
      if (J(got.parts.find((p) => p.id === 'comp').strokes) !== J(base.parts.find((p) => p.id === 'comp').strokes) || J(got.drums.hits.filter((h) => h.voice === 'perc')) !== J(base.drums.hits.filter((h) => h.voice === 'perc'))) bad.push(`${L.join(':')} → ${J(edit)}: the strokes or the perc moved`);
      if (J(got.parts.filter((p) => p.id !== 'comp')) !== J(base.parts.filter((p) => p.id !== 'comp'))) bad.push(`${L.join(':')} → ${J(edit)}: another part moved`);
    }
  }
  for (const [L, T, changes] of CHART_ROWS) for (const [edit, ov] of [[{ snap: true, roll: 8 }, { compSnap: true, compRoll: 8 }], [{ gate: 40 }, { compGate: 40 }]]) {
    const base = compose(L, T, { seed: 1, changes }), M = materialsOf(base), got = applyRearrange(base, restrum(base, M.row, M.cells, edit)); n++;
    if (J(got) !== J(compose(L, T, { seed: 1, changes, overrides: ov }))) bad.push(`${L.join(':')} chart → ${J(edit)}`);
  }
  {
    const tg = ODE(), base = compose([41, 42, 43], 8, { seed: 1, target: tg }), M = materialsOf(base);
    const norm = (x) => { const y = JSON.parse(J(x)); delete y.target.search; return y; };
    for (const [edit, ov] of [[{ gate: 40 }, { compGate: 40 }], [{ snap: true, roll: 15 }, { compSnap: true, compRoll: 15 }]]) {
      const got = applyRearrange(base, restrum(base, M.row, M.cells, edit)), want = compose([41, 42, 43], 8, { seed: 1, target: tg, overrides: ov }); n++;
      if (J(norm(got)) !== J(norm(want))) bad.push(`41:42:43 target → ${J(edit)}`);
    }
  }
  check(`${n} restrums (8 rows from the default, Snap rolled, the old window filled and a 40 ms gate; led, close and Fill; to each gate, Snap and its rolls, the old window, back to the gate; charts; a MIDI target): byte for byte a Compose given the same overrides, the strokes, the perc and every other part unmoved`, !bad.length, bad.slice(0, 4).join('; '));
  const d = compose([8, 7, 6, 5], 4, { seed: 1 }), m = materialsOf(d);
  check('the door refuses two windows, a roll with no Snap, a gate not in the list; `rearrange` routes { gate }, { snap }, { roll } to it',
    throws(() => restrum(d, m.row, m.cells, { gate: 25, tolerance: 0.5 }), /two windows/) && throws(() => restrum(d, m.row, m.cells, { roll: 8 }), /needs/) && throws(() => restrum(d, m.row, m.cells, { gate: 30 }), /15, 25, 40/)
    && J(rearrange(d, m.row, m.cells, { snap: true }).strum) === J(restrum(d, m.row, m.cells, { snap: true }).strum) && rearrange(d, m.row, m.cells, { gate: 40 }).strum.gate === 40);
  const snapped = applyRearrange(d, restrum(d, m.row, m.cells, { snap: true, roll: 8 })), again = applyRearrange(snapped, restrum(snapped, m.row, m.cells, { roll: 15 }));
  check('Snap kept: a roll alone changes the roll; snap: false goes back to the gate (no override left)', J(again.input.overrides) === J({ compSnap: true, compRoll: 15 })
    && J(applyRearrange(again, restrum(again, m.row, m.cells, { snap: false })).input.overrides) === '{}');

  // a chord swap re-strums its bar at the setting (the gate, Snap and its roll)
  const sw = [];
  let k = 0, moved = 0;
  for (const [L, T] of ROWS.filter(([L]) => L.length > 2 || L[0] > 700)) for (const overrides of [{}, { compGate: 40 }, { compSnap: true }, { compSnap: true, compRoll: 15, voicing: 'close' }, { compSnap: true, compBorrow: true }]) {
    const full = compose(L, T, { seed: 1, trace: {}, overrides }), { trace, ...spec } = full, M = materialsOf(spec);
    const h = trace.events.find((x) => x.kind === 'harmony'), ev = trace.events.filter((x) => x.kind === 'chord' && x.round === h.chosenRound);
    for (const e of ev.slice(0, 2)) {
      const alt = e.candidates.slice(0, 4).find((c, i) => i !== e.pickIndex);
      if (!alt) continue;
      const next = applyRearrange(spec, rearrange(spec, M.row, M.cells, { bar: e.bar, chord: alt })); k++;
      for (const b of audit(next).slice(0, 1)) sw.push(`${L.join(':')} ${J(overrides)} bar ${e.bar}: ${b}`);
      const keyOf = (s, b) => J(s.parts.find((p) => p.id === 'comp').notes.filter((x) => x.bar === b).map((x) => J([x.node, x.ratio, x.velocity, x.time, x.from ?? null])).sort());
      if (spec.chords.map((_, b) => b).filter((b) => b !== e.bar).some((b) => keyOf(spec, b) !== keyOf(next, b))) sw.push(`${L.join(':')} bar ${e.bar}: another bar's comp moved`);
      if (keyOf(spec, e.bar) !== keyOf(next, e.bar)) moved++;
    }
  }
  check(`${k} chord swaps at the default gate, 40 ms, Snap (rolled, close; filled): the swapped bar re-strummed at the setting (the brute force's, stats recounted, compMovedMs too; ${moved} bars' comp changed), no other bar's tones moved`, !sw.length && k > 10 && moved > 0, sw.slice(0, 4).join('; '));
}

console.log(PASS ? `\n✓✓✓ THE COMP'S TOLERANCE, GATE AND SNAP PASS (${checks} checks)` : '\n✗ THE COMP\'S TOLERANCE, GATE AND SNAP FAILED');
process.exit(PASS ? 0 : 1);
