// assert-bass.mjs — the bass's densities and its lock (Composer/BASS_VOICING_ORDER.md, phase G: P10–P15): core/bass.js
// `arrangeBass` over composed specs, read against the test's own reading of the order (its slots, windows, locks and
// shares are worked out here from the spec, the row and the cells, not from bass.js).
//   • Sparse and Free with no picks: Compose's bass byte for byte (rows, charts, a MIDI target, the 16k row)
//   • every note a real onset at its own time and hz, two octaves under the lead's range (the bass's octave over its root)
//   • each density's share against a brute force: Sparse 20–35 %, Moving 40–60 % of the bar's slots; Walking every slot
//     of its clock (the bar's slots, halved while above 8), its last move no farther from the next chord's root than the
//     same mine without the approach; Roots one note a chord, the root-class onset nearest its first anchor
//   • the lock: every locked note on a locked onset (Kick: within ¼ slot of a kick; Clave: the comp's strokes), shares of
//     the locked slots (to the nearest note, at least 1); Kick with the drums off or no kick, Clave with no clave: Free,
//     with the reason
//   • offers: at most 8 a bar, distinct, root-opening first, then cost per note; the first plays unless picked; a pick not
//     offered is missed; another density's picks are not offered (the window drops them)
//   • a chord swap (rearrange.js, P14) re-mines the bar at the part's density and lock, keeping a pick only where it is
//     still offered (else `bassDropped`); Walking re-mines the bar before; an edit to what is there is byte for byte
//   • deterministic; the spec untouched; the options checked; the report's rows and costs
//   node Composer/tests/assert-bass.mjs
import { compose, partContext } from '../core/compose.js';
import { materialsOf, chordRecordsOf, rearrange, applyRearrange } from '../core/rearrange.js';
import { buildCells, cropCells } from '../core/cells.js';
import { targetsOf } from '../core/harmony.js';
import { mineLines, intervalCost, DEFAULT_RULES } from '../core/lines.js';
import { classOfCents } from '../core/frame.js';
import { arrangeBass, readBassOptions, bassLockRefusal, walkClock, BASS_DEFAULTS, BASS_ALTERNATES } from '../core/bass.js';
import { readMidi, decodeClip } from '../core/midi.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2) : NaN; };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const EPS = 1e-9;
/** the order's shares (P11): a band's share of the bar's slots */
const SHARE = { sparse: [0.2, 0.35], moving: [0.4, 0.6], walking: [1, 1] };
const DENSITIES = ['roots', 'sparse', 'moving', 'walking'], LOCKS = ['free', 'kick', 'clave'];

console.log('═══ COMPOSER — the bass\'s densities and lock: arrangeBass (BASS_VOICING_ORDER.md phase G) ═══');

/** a compose with its materials and the test's own reading of it */
function composed(L, T, opts = {}) {
  const { label, ...rest } = opts;
  const spec = compose(L, T, { seed: 1, ...rest });
  if (spec.refused) return null;
  const M = materialsOf(spec), { row, cells } = M, k = spec.knobs;
  const rowT = k.rowCycleSeconds ?? k.cycleSeconds, S = k.slotsPerBar, N = k.bars, P = N * S;
  const ctx = partContext(row, cells, { cycleSeconds: k.cycleSeconds, phase: k.phase, frameCentsEachSide: k.frameCentsEachSide, ...(k.rowCycleSeconds != null ? { rowCycleSeconds: k.rowCycleSeconds } : {}) });
  const recs = chordRecordsOf(spec, row, cells), split = recs.some((c) => c.slots != null);
  const unitsOf = (bar) => (split ? recs.flatMap((c, u) => (c.bar === bar ? [u] : [])) : [bar]);
  const rangeOf = (u) => (split ? { from: recs[u].from, to: recs[u].from + recs[u].slots } : { from: u * S, to: (u + 1) * S });
  // each slot's window's onsets, from the cells
  const win = Array.from({ length: P }, () => []);
  for (let i = 0; i < row.n; i++) if (cells.slotOfNode[i] >= 0) win[cells.slotOfNode[i]].push(i);
  // Walking's clock (P11): the bar's slots, halved while above 8 (and even); its cells built here
  let SU = S; while (SU > 8 && SU % 2 === 0) SU /= 2;
  const o = { slotsPerBar: SU, anchors: k.anchors, phase: k.phase };
  const clock = SU === S ? cells : k.cut ? cropCells(buildCells(row, { bars: k.cut.bars, ...o }), N) : buildCells(row, { bars: N, ...o });
  return { spec, M, row, cells, k, S, N, P, rowT, ctx, recs, split, unitsOf, rangeOf, win, SU, clock, label: `${L.join(':')}${label ? ` ${label}` : ''}` };
}
const bassOf = (spec) => spec.parts.find((p) => p.id === 'bass');
const withBass = (spec, part) => ({ ...spec, parts: spec.parts.map((p) => (p.id === 'bass' ? part : p)) });
const strip = (part) => { const { bass, ...rest } = part; return rest; };

const pcOf = (C, c, tone) => classOfCents(C.row.toneCents[tone] - c.rootCents);
const rootClass = (C, c, tone) => { const q = pcOf(C, c, tone); return q.pc === 0 && Math.abs(q.dev) <= C.k.frameCentsEachSide + EPS; };
const chordTone = (C, c, tone) => { const q = pcOf(C, c, tone); return Math.abs(q.dev) <= C.k.frameCentsEachSide + EPS && c.intervals.includes(q.pc); };
/** the bass's register over chord c: the lowest octave at or over its root less 2450¢ (compose.js' root fallback) */
const octaveOver = (C, c, tone) => Math.ceil((c.rootCents - 2450 - C.row.toneCents[tone]) / 1200 - EPS);

/** the lock as the order reads it (P12) → { ran, nodes (Set | null) } */
function lockOf(C, lock) {
  const { spec, row, cells, rowT, ctx } = C;
  if (lock === 'kick') {
    const kicks = spec.drums?.enabled ? spec.drums.hits.filter((h) => h.voice === 'kick') : [];
    if (!kicks.length) return { ran: 'free', nodes: null };
    const nodes = new Set(), T = C.k.cycleSeconds;
    for (const h of kicks) {
      const t = ctx.timeOf(h.tick), w = 0.25 * cells.slots[h.slot].length * rowT;
      for (let i = 0; i < row.n; i++) { if (ctx.posSlot[i] < 0) continue; const d = Math.abs(ctx.timeOf(row.tick[i]) - t); if (Math.min(d, T - d) <= w + EPS) nodes.add(i); }
    }
    return { ran: 'kick', nodes };
  }
  if (lock === 'clave') {
    const cl = spec.clave;
    if (!cl) return { ran: 'free', nodes: null };
    const strokes = cl.relation === 'fill' ? cl.partner.strokes.filter((x) => !x.shared) : cl.strokes;
    return strokes.length ? { ran: 'clave', nodes: new Set(strokes.map((x) => x.node)) } : { ran: 'free', nodes: null };
  }
  return { ran: 'free', nodes: null };
}

/** Roots (P11), the test's brute force: per chord of bar k → [{ node, slot }] */
function rootsWant(C, k, nodes) {
  const { row, cells, recs, win, ctx } = C, out = [];
  for (const u of C.unitsOf(k)) {
    const c = recs[u], { from, to } = C.rangeOf(u), a0 = cells.slots[from].anchor, cands = [];
    for (let j = from; j < to; j++) for (const i of win[j]) {
      if (nodes && !nodes.has(i)) continue;
      const d = row.x[i] - cells.slots[j].anchor;
      cands.push({ i, j, at: mod(cells.slots[j].anchor - a0, 1) + d - Math.round(d) });
    }
    const near = (list, at) => list.slice().sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at) || a.at - b.at || a.i - b.i)[0];
    if (!nodes) {
      const r = near(cands.filter((x) => rootClass(C, c, row.tone[x.i])), 0);
      if (r) out.push({ node: r.i, slot: r.j, c }); else if (c.rootNode != null) out.push({ node: c.rootNode, slot: ctx.posSlot[c.rootNode], c });
      continue;
    }
    if (!cands.length) continue;
    const first = cands.slice().sort((a, b) => a.at - b.at || a.i - b.i)[0];
    const r = near(cands.filter((x) => rootClass(C, c, row.tone[x.i])), first.at) ?? near(cands.filter((x) => chordTone(C, c, row.tone[x.i])), first.at) ?? first;
    out.push({ node: r.i, slot: r.j, c });
  }
  return out;
}
/** the slots of bar k on Walking's clock (or the bar's) whose windows hold a locked onset */
function lockedSlots(cellsU, k, nodes) {
  const SU = cellsU.slotsPerBar, got = new Set();
  for (const i of nodes) { const j = cellsU.slotOfNode[i]; if (j >= k * SU && j < (k + 1) * SU) got.add(j); }
  return got;
}
/** a band's fewest and most notes (P11; locked, P12: of the locked slots, to the nearest note, at least 1) */
function notesRange(density, slots, locked) {
  const [a, b] = SHARE[density];
  if (locked) { const lo = Math.max(1, Math.floor(a * slots + 0.5 + EPS)); return [lo, Math.max(lo, Math.floor(b * slots + 0.5 + EPS))]; }
  return [Math.max(2, Math.ceil(a * slots - EPS)), Math.floor(b * slots + EPS)];
}

/** what breaks the order in an arranged bass: '' or the first problem */
function verify(C, part, opt, bars = null) {
  const { spec, row, k, S, N, recs, ctx } = C, a = part.bass, lk = lockOf(C, opt.lock);
  if (J(Object.keys(a).filter((x) => x !== 'refused')) !== J(['density', 'lock', 'picks', 'stats', 'bars']) || a.density !== opt.density || a.lock !== opt.lock || J(a.picks) !== J(opt.picks)) return `the bass record ${J({ ...a, bars: undefined })}`;
  if (a.stats.lock !== lk.ran || (lk.ran !== opt.lock) !== (typeof a.refused === 'string' && a.refused.length > 0)) return `ran ${a.stats.lock} (want ${lk.ran}), refused ${a.refused}`;
  if (a.bars.length !== N) return `${a.bars.length} bar records`;
  const was = bassOf(spec);
  if (part.id !== 'bass' || part.sound !== was.sound || part.legato !== was.legato || part.enabled !== was.enabled) return 'the part\'s id, sound, legato or on/off';
  for (let i = 1; i < part.notes.length; i++) if (part.notes[i].time < part.notes[i - 1].time) return 'notes out of time order';
  for (const [i, n] of part.notes.entries()) {
    const gap = (i + 1 < part.notes.length ? part.notes[i + 1].time : k.cycleSeconds) - n.time;
    if (Math.abs(n.duration - Math.max(0, part.legato ? gap : Math.min(n.slotSeconds, gap))) > 1e-9) return `note ${i}: duration ${n.duration}`;
    if (n.tick !== row.tick[n.node] || n.ratio !== row.tones[row.tone[n.node]] || Math.abs(n.time - ctx.timeOf(n.tick)) > 1e-9) return `note ${i} (node ${n.node}): not its onset's tick, ratio or time`;
    const chord = C.split ? (recs.find((c) => n.slot >= c.from && n.slot < c.from + c.slots) ?? recs[C.unitsOf(n.bar)[0]]) : recs[n.bar];
    const [num, den] = n.ratio.split('/').map(Number), hz = k.baseHz * (num / den) * 2 ** n.octave * chord.fundamentalRatio;
    if (Math.abs(n.hz - hz) > 1e-9 * hz || Math.abs(n.velocity - 0.75) > 1e-12) return `note ${i}: hz ${n.hz} (want ${hz}) or velocity ${n.velocity}`;
    if (lk.nodes && !lk.nodes.has(n.node)) return `note ${i} (node ${n.node}, bar ${n.bar}): not on a locked onset`;
  }
  const walking = opt.density === 'walking', cellsU = walking ? C.clock : C.cells, SU = cellsU.slotsPerBar, r = S / SU;
  let rooted = 0, onDown = 0;
  for (let b = 0; b < N; b++) {
    if (bars && !bars.includes(b)) continue;
    const rec = a.bars[b], own = part.notes.filter((n) => n.bar === b), c0 = recs[C.unitsOf(b)[0]], at = `bar ${b} (${rec.how})`;
    if (rec.bar !== b || rec.notes !== own.length) return `${at}: record ${rec.bar} of ${rec.notes} notes, the part ${own.length}`;
    if (opt.density === 'roots' || rec.how === 'locked roots' || rec.how === 'root onset') {
      const want = rec.how === 'root onset' ? (c0.rootNode != null ? [{ node: c0.rootNode, slot: ctx.posSlot[c0.rootNode], c: c0 }] : []) : rootsWant(C, b, lk.nodes);
      if (opt.density === 'roots' && rec.how !== (want.length ? 'roots' : 'rest')) return `${at}: Roots is ${rec.how}`;
      if (opt.density !== 'roots' && (rec.alternates.length || (rec.how === 'root onset') !== !lk.nodes)) return `${at}: a fallback with ${rec.alternates.length} alternates, locked ${!!lk.nodes}`;
      const got = own.slice().sort((x, y) => x.slot - y.slot || x.time - y.time);
      if (J(want.map((w) => [w.node, w.slot, octaveOver(C, w.c, row.tone[w.node])]).sort()) !== J(got.map((n) => [n.node, n.slot, n.octave]).sort())) return `${at}: notes ${J(got.map((n) => [n.node, n.slot, n.octave]))}, the order's ${J(want.map((w) => [w.node, w.slot, octaveOver(C, w.c, row.tone[w.node])]))}`;
      if (opt.density === 'roots' && want.length && (rec.alternates.length !== 1 || rec.picked !== rec.alternates[0].id)) return `${at}: Roots offers ${rec.alternates.length}`;
    } else if (rec.how === 'mined') {
      const locked = lk.nodes ? lockedSlots(cellsU, b, lk.nodes) : null, L = locked ? locked.size : SU;
      const [lo, hi] = walking && !locked ? [SU, SU] : notesRange(opt.density, L, !!locked);
      if (!(own.length >= lo && own.length <= hi)) return `${at}: ${own.length} notes, the band ${lo}–${hi} of ${L} slots`;
      const cellOf = (n) => n.slot / r;
      for (const n of own) {
        if (n.slot % r || cellsU.slotOfNode[n.node] !== cellOf(n) || Math.floor(cellOf(n) / SU) !== b) return `${at}: node ${n.node} at slot ${n.slot} is not in its clock slot's window`;
        const p = row.toneCents[row.tone[n.node]] + 1200 * n.octave;
        if (!(p >= c0.rootCents - 2400 - EPS && p < c0.rootCents - 1200 - EPS)) return `${at}: pitch ${p.toFixed(1)} outside the bass's octave over ${c0.rootCents.toFixed(1)} − 2400`;
      }
      const slots = own.map(cellOf).sort((x, y) => x - y);
      if (new Set(slots).size !== slots.length) return `${at}: two notes on one slot`;
      if (walking && J(slots) !== J(locked ? [...locked].sort((x, y) => x - y) : Array.from({ length: SU }, (_, j) => b * SU + j))) return `${at}: Walking leaves a slot (${J(slots)})`;
      // the offers: ≤ 8, distinct, root-opening first, then cost per note; each within the band; the picked one plays
      const alts = rec.alternates;
      if (!alts.length || alts.length > BASS_ALTERNATES || new Set(alts.map((x) => x.id)).size !== alts.length) return `${at}: ${alts.length} alternates`;
      for (let i = 1; i < alts.length; i++) if ((!alts[i - 1].rooted && alts[i].rooted) || (alts[i - 1].rooted === alts[i].rooted && alts[i - 1].perNote > alts[i].perNote + EPS)) return `${at}: alternates out of order at ${i}`;
      for (const x of alts) {
        if (!(x.n === x.notes.length && x.n >= lo && x.n <= hi) || x.notes.some((n) => (lk.nodes && !lk.nodes.has(n.node)) || n.slot % r)) return `${at}: alternate ${x.id} (${x.n} notes)`;
        if (x.rooted !== rootClass(C, c0, row.tone[x.notes[0].node])) return `${at}: alternate ${x.id} says rooted ${x.rooted}`;
      }
      const want = opt.picks[b], chosen = alts.find((x) => x.id === want) ?? alts[0];
      if (rec.picked !== chosen.id || (want != null && want !== chosen.id) !== (rec.missed === want && want != null)) return `${at}: picked ${rec.picked}, missed ${rec.missed} (asked ${want})`;
      if (J(chosen.notes.map((n) => [n.slot, n.node, n.octave])) !== J(own.slice().sort((x, y) => x.slot - y.slot).map((n) => [n.slot, n.node, n.octave]))) return `${at}: the part is not the picked line`;
    } else if (rec.how === 'rest') {
      if (own.length || !lk.nodes) return `${at}: a rest with ${own.length} notes, locked ${!!lk.nodes}`;
    } else return `${at}: how ${rec.how}`;
    // the bar's first note (Compose's notes[0]): a line's first, or the first chord's Roots note
    const firstNode = rec.how === 'roots' || rec.how === 'locked roots' ? rootsWant(C, b, lk.nodes)[0]?.node ?? null : own.length ? own.slice().sort((x, y) => x.slot - y.slot)[0].node : null;
    const isRooted = firstNode != null && pcOf(C, c0, row.tone[firstNode]).pc === 0;
    if (rec.rooted !== isRooted || rec.onDown !== own.some((n) => n.slot === b * S)) return `${at}: rooted ${rec.rooted} / onDown ${rec.onDown}`;
    if (rec.rooted) rooted++;
    if (rec.onDown) onDown++;
  }
  if (!bars) {
    const s = a.stats, notes = part.notes.length;
    if (s.density !== opt.density || s.bars !== N || s.notes !== notes || Math.abs(s.perBar - notes / N) > 1e-12 || s.rooted !== rooted || s.onDown !== onDown
      || s.mined !== a.bars.filter((x) => x.how === 'mined').length || s.rests !== a.bars.filter((x) => x.how === 'rest').length) return `stats ${J(s)}`;
  }
  return '';
}

// ── 1. Sparse, Free, no picks: Compose's bass byte for byte (P10) ──
console.log('\n— the default is Compose\'s bass, byte for byte');
const clip = (name) => decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === name))));
const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 5], [[19, 17, 16, 15], 6], [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
const cases = ROWS.map(([L, T]) => composed(L, T));
const charts = [composed([119, 42, 15, 8], 8, { changes: [[1], [1, 1], [1], [1, 1, 1, 1]], label: 'chart' }),
  composed([768, 784], 8, { changes: [[1, 1, 1], [1], [1, 1], [1]], overrides: { slotsPerBar: 16 }, label: 'chart, 16 slots' })];
const caseOf = (label) => [...cases, ...charts].find((c) => c.label === label);
{
  const extra = [composed([8, 7, 6, 5], 4, { target: { clip: clip('twinkle') }, label: 'twinkle' }), composed([11, 9, 7, 5], 5, { overrides: { compStyle: 'notes' }, label: 'notes' }),
    composed([19, 17, 16, 15], 6, { seed: 2, label: 'seed 2' }), composed([768, 784], 8, { worker: true, label: 'full table' })];
  const all = [...cases, ...charts, ...extra].map((C) => ({ C, same: J(strip(arrangeBass(C.spec, C.M))) === J(bassOf(C.spec)) && J(strip(arrangeBass(C.spec, C.M, BASS_DEFAULTS))) === J(bassOf(C.spec)) }));
  check(`${all.filter((x) => x.same).length}/${all.length} specs (${all.map((x) => x.C.label).join(', ')}): the default arrangement is the spec's bass byte for byte`, all.every((x) => x.same), all.filter((x) => !x.same).map((x) => x.C.label).join(', '));
}

// ── 2. every density × lock holds the order's rules ──
console.log('\n— every density × lock: real onsets, shares, the lock, the offers');
for (const C of [...cases, ...charts]) {
  let bad = '';
  for (const density of DENSITIES) for (const lock of LOCKS) {
    const opt = readBassOptions({ density, lock }), why = verify(C, arrangeBass(C.spec, C.M, opt), opt);
    bad ||= why && `${density}/${lock}: ${why}`;
  }
  check(`${C.label} (${C.N} × ${C.S}${C.SU !== C.S ? `, walking ${C.SU} a bar` : ''}): 12 arrangements hold every rule`, !bad, bad);
}

// ── 3. Roots: one note a chord ──
console.log('\n— Roots');
{
  let chords = 0, notes = 0, rootedNotes = 0;
  for (const C of [...cases, ...charts]) {
    const p = arrangeBass(C.spec, C.M, { density: 'roots' });
    chords += C.recs.length; notes += p.notes.length;
    rootedNotes += p.notes.filter((n) => rootClass(C, C.recs.find((c) => (C.split ? n.slot >= c.from && n.slot < c.from + c.slots : c.bar === n.bar)) ?? C.recs[n.bar], C.row.tone[n.node])).length;
  }
  check(`free: one note a chord over every row and chart (${notes} notes for ${chords} chords; ${rootedNotes} on the chord's root class)`, notes === chords && rootedNotes > 0.8 * notes);
  const C = caseOf('119:42:15:8 chart'), p = arrangeBass(C.spec, C.M, { density: 'roots' });
  check(`a chart's split bars: a note a span (${p.notes.length} for ${C.recs.length} spans over ${C.N} bars)`, p.notes.length === C.recs.length && C.recs.length > C.N);
}

// ── 4. Walking: every slot of its clock, and the approach ──
console.log('\n— Walking');
{
  let bars = 0, closer = 0, same = 0, within = 0, ok = true, why = '';
  for (const C of cases) {
    const p = arrangeBass(C.spec, C.M, { density: 'walking' }), targets = targetsOf(C.recs);
    for (let b = 0; b < C.N; b++) {
      const rec = p.bass.bars[b];
      if (rec.how !== 'mined') continue;
      bars++;
      // the same mine without the approach (lines.js directly): its last move can't be nearer the next root
      const c = C.recs[b], next = C.recs[(b + 1) % C.N], after = next.rootCents - 2400;
      const rc = []; for (let t = 0; t < C.row.tones.length; t++) if (rootClass(C, c, t)) rc.push(t);
      const opts = { from: b, bars: 1, types: ['bass'], table: C.k.table, targets: { scale: targets.scale, bars: [targets.bars[b]] }, register: -2400, bands: ['walking'], ...(rec.weakTies ? { weakTies: true } : {}) };
      const plain = (mineLines(C.row, C.clock, [c.frame], { ...opts, rules: { startTones: rc } }).lines ?? [])[0] ?? (mineLines(C.row, C.clock, [c.frame], opts).lines ?? [])[0];
      const own = p.notes.filter((n) => n.bar === b).sort((x, y) => x.slot - y.slot), last = own[own.length - 1];
      const lastPitch = C.row.toneCents[C.row.tone[last.node]] + 1200 * last.octave, I = (x) => intervalCost(Math.abs(after - x), DEFAULT_RULES);
      if (!plain) { ok = false; why ||= `${C.label} bar ${b}: the walk mines nothing without its approach`; continue; }
      const plainLast = plain.notes[plain.notes.length - 1].pitch;
      if (I(lastPitch) > I(plainLast) + EPS) { ok = false; why ||= `${C.label} bar ${b}: the approach ends farther (${I(lastPitch)}) than without it (${I(plainLast)})`; }
      if (I(lastPitch) < I(plainLast) - EPS) closer++; else same++;
      if (Math.abs(after - lastPitch) <= DEFAULT_RULES.step) within++;
    }
  }
  check(`its last move never farther from the next chord's root than the same mine without the approach (${bars} mined bars: ${closer} nearer, ${same} the same; ${within} end within a step of it)`, ok && closer > 0, why);
  const C = caseOf('768:784 chart, 16 slots'), p = arrangeBass(C.spec, C.M, { density: 'walking' });
  check(`16 slots a bar walk 8 (the clock halved: walkClock(16) = ${walkClock(16)}, (12) = ${walkClock(12)}, (8) = ${walkClock(8)}): ${p.notes.length} notes over ${C.N} bars, every one on an even slot`,
    walkClock(16) === 8 && walkClock(12) === 6 && walkClock(8) === 8 && p.bass.bars.every((b) => b.how !== 'mined' || b.notes === 8) && p.notes.every((n) => n.slot % 2 === 0) && !verify(C, p, readBassOptions({ density: 'walking' })));
}

// ── 5. the lock ──
console.log('\n— the lock');
{
  let notes = 0, locked = 0;
  for (const C of [...cases, ...charts]) for (const density of DENSITIES) for (const lock of ['kick', 'clave']) {
    const p = arrangeBass(C.spec, C.M, { density, lock }), lk = lockOf(C, lock);
    notes += p.notes.length; locked += p.notes.filter((n) => lk.nodes?.has(n.node)).length;
  }
  check(`every locked note on a locked onset (${locked}/${notes} over every row, chart, density, Kick and Clave)`, notes > 0 && locked === notes);
  const C = caseOf('119:42:15:8');
  const four = composed([119, 42, 15, 8], 8, { drums: { mode: 'four' }, label: 'four on the floor' });
  const kicks = four.spec.drums.hits.filter((h) => h.voice === 'kick').length;
  const mv = arrangeBass(four.spec, four.M, { density: 'moving', lock: 'kick' }), wk = arrangeBass(four.spec, four.M, { density: 'walking', lock: 'kick' });
  check(`four on the floor (${kicks} kicks): Moving plays ${mv.notes.length}, Walking ${wk.notes.length} (every locked slot), the shares of the locked slots`, !verify(four, mv, readBassOptions({ density: 'moving', lock: 'kick' })) && !verify(four, wk, readBassOptions({ density: 'walking', lock: 'kick' })) && wk.notes.length > mv.notes.length);
  // Kick with the drums off (drums: false, and not enabled), and a mode with no kick: Free, with the reason
  const off = composed([119, 42, 15, 8], 8, { drums: false, label: 'drums off' }), dis = composed([119, 42, 15, 8], 8, { drums: { enabled: false }, label: 'drums disabled' });
  const hatOnly = composed([119, 42, 15, 8], 8, { drums: { mode: 'grid', fills: false, grid: { hat: Array.from({ length: 4 }, () => 'x'.repeat(8)) } }, label: 'hats only' });
  let fell = true;
  for (const X of [off, dis, hatOnly]) for (const density of DENSITIES) {
    const k = arrangeBass(X.spec, X.M, { density, lock: 'kick' }), f = arrangeBass(X.spec, X.M, { density });
    fell &&= k.bass.stats.lock === 'free' && k.bass.lock === 'kick' && typeof k.bass.refused === 'string' && J(k.notes) === J(f.notes) && J(k.bass.bars) === J(f.bass.bars) && !verify(X, k, readBassOptions({ density, lock: 'kick' }));
  }
  check(`Kick with the drums off ("${bassLockRefusal(off.spec, 'kick')}"), not enabled, or striking no kick ("${bassLockRefusal(hatOnly.spec, 'kick')}"): Free plays, the reason kept`, fell && /drums are off/.test(bassLockRefusal(dis.spec, 'kick')) && /no kick/.test(bassLockRefusal(hatOnly.spec, 'kick')));
  const notes2 = caseOf('11:9:7:5') && composed([11, 9, 7, 5], 5, { overrides: { compStyle: 'notes' }, label: 'notes' }), cl = arrangeBass(notes2.spec, notes2.M, { lock: 'clave' });
  check(`Clave on a spec that comps in notes: Free, with the reason ("${cl.bass.refused}")`, cl.bass.stats.lock === 'free' && /no clave/.test(cl.bass.refused) && J(strip(cl)) === J(bassOf(notes2.spec)));
  check('the refusal is null where the lock can land', bassLockRefusal(C.spec, 'kick') === null && bassLockRefusal(C.spec, 'clave') === null && bassLockRefusal(C.spec, 'free') === null);
  // Clave follows Sync | Fill
  const fill = composed([119, 42, 15, 8], 8, { overrides: { compRelation: 'fill' }, label: 'fill' });
  const sy = arrangeBass(C.spec, C.M, { density: 'walking', lock: 'clave' }), fi = arrangeBass(fill.spec, fill.M, { density: 'walking', lock: 'clave' });
  check('Clave follows the comp: Sync lands on the clave\'s strokes, Fill on its partner\'s', !verify(fill, fi, readBassOptions({ density: 'walking', lock: 'clave' })) && J(sy.notes.map((n) => n.node)) !== J(fi.notes.map((n) => n.node)));
}

// ── 6. offers and picks (P13) ──
console.log('\n— offers and picks');
{
  const C = caseOf('768:784'), base = arrangeBass(C.spec, C.M, { density: 'moving' });
  const b0 = base.bass.bars.findIndex((x) => x.alternates.length >= 3), third = base.bass.bars[b0].alternates[2];
  const opt = readBassOptions({ density: 'moving', picks: { [b0]: third.id } }), picked = arrangeBass(C.spec, C.M, opt);
  check(`bar ${b0 + 1}'s third line picked (of ${base.bass.bars[b0].alternates.length}): it plays, every other bar as before`, picked.bass.bars[b0].picked === third.id && !verify(C, picked, opt)
    && picked.bass.bars.every((x, i) => i === b0 || x.picked === base.bass.bars[i].picked) && J(picked.notes) !== J(base.notes));
  const optX = readBassOptions({ density: 'moving', picks: { [b0]: 'cl1:00000000' } }), stale = arrangeBass(C.spec, C.M, optX);
  check('a pick the bar does not offer: the first plays, the pick marked missed', stale.bass.bars[b0].missed === 'cl1:00000000' && J(stale.notes) === J(base.notes) && !verify(C, stale, optX));
  const optS = readBassOptions({ density: 'sparse', picks: { [b0]: third.id } }), other = arrangeBass(C.spec, C.M, optS);
  check('Moving\'s pick under Sparse is not offered (the window drops picks on a change of density: the arp\'s rule)', other.bass.bars[b0].missed === third.id && !other.bass.bars[b0].alternates.some((x) => x.id === third.id));
  let offers = 0, bars = 0;
  for (const X of cases) for (const density of ['sparse', 'moving', 'walking']) for (const b of arrangeBass(X.spec, X.M, { density }).bass.bars) if (b.how === 'mined') { offers += b.alternates.length; bars++; }
  check(`the offers: ${(offers / bars).toFixed(1)} lines a mined bar on average (at most ${BASS_ALTERNATES})`, bars > 0 && offers >= bars);
}

// ── 7. a chord swap (rearrange.js, P14) ──
console.log('\n— a chord swap re-mines the bar at the part\'s density and lock');
{
  const C = caseOf('119:42:15:8'), { row, cells } = C.M;
  const base = arrangeBass(C.spec, C.M, { density: 'moving', lock: 'kick' });
  // two bars with a runner-up: the first is swapped, the other keeps its pick
  const two = base.bass.bars.flatMap((b, i) => (b.alternates.length >= 2 ? [i] : [])), [bs, bk] = two;
  const picks = { [bs]: base.bass.bars[bs].alternates[1].id, [bk]: base.bass.bars[bk].alternates[1].id };
  const opt = readBassOptions({ density: 'moving', lock: 'kick', picks }), part = arrangeBass(C.spec, C.M, opt), spec = withBass(C.spec, part);
  const cs = C.spec.chords[bs], edit = { bar: bs, chord: { rootTone: cs.rootTone, quality: cs.quality === 'major_triad' ? 'minor_triad' : 'major_triad' } };
  const r = rearrange(spec, row, cells, edit), after = applyRearrange(spec, r), nb = bassOf(after);
  const C2 = { ...C, spec: after, recs: chordRecordsOf(after, row, cells) };
  const kept = nb.bass.bars[bs].alternates.some((x) => x.id === picks[bs]), rest = [0, 1, 2, 3].filter((b) => b !== bs);
  check(`bar ${bs + 1} swapped: re-mined at Moving / Kick (its rules hold), the other bars untouched`, two.length >= 2 && !verify(C2, nb, { ...opt, picks: nb.bass.picks }, [bs]) && nb.bass.density === 'moving' && nb.bass.lock === 'kick'
    && rest.every((b) => J(nb.bass.bars[b]) === J(part.bass.bars[b]) && J(nb.notes.filter((n) => n.bar === b).map(strip)) === J(part.notes.filter((n) => n.bar === b).map(strip))));
  check(`its pick ${kept ? 'is still offered: kept' : 'is no longer offered: dropped'} (bassDropped ${J(r.bassDropped)}); bar ${bk + 1}'s pick kept and playing`,
    (kept ? nb.bass.picks[bs] === picks[bs] && !r.bassDropped.length : !(bs in nb.bass.picks) && J(r.bassDropped) === J([{ bar: bs, id: picks[bs] }])) && nb.bass.picks[bk] === picks[bk] && nb.bass.bars[bk].picked === picks[bk]);
  check('the stats follow the bars', J(nb.bass.stats) === J({ ...nb.bass.stats, notes: nb.notes.length, rooted: nb.bass.bars.filter((b) => b.rooted).length }) && r.stats.bassRooted === `${nb.bass.bars.filter((b) => b.rooted).length}/${C.N}`);
  const same = rearrange(spec, row, cells, { bar: bs, chord: { rootTone: cs.rootTone, quality: cs.quality } });
  check('a swap to the chord that is there: the parts byte for byte, nothing dropped', J(same.parts) === J(spec.parts) && J(same.bassDropped) === '[]');
  const rt = rearrange(JSON.parse(J(spec)), row, cells, edit);
  check('a JSON round trip rearranges the same', J(rt.parts) === J(r.parts) && J(rt.bassDropped) === J(r.bassDropped));
  const plain = rearrange(C.spec, row, cells, edit);
  check('a bass with no arrangement is rebuilt as before (no bass record, no bassDropped)', !('bass' in bassOf(applyRearrange(C.spec, plain))) && !('bassDropped' in plain));
  // Walking: the bar before is re-mined too, its approach to the new chord
  const w = withBass(C.spec, arrangeBass(C.spec, C.M, { density: 'walking' })), e2 = { bar: 2, chord: { rootTone: C.spec.chords[0].rootTone, quality: 'major_triad' } };
  const rw = rearrange(w, row, cells, e2), aw = applyRearrange(w, rw), wb = bassOf(aw), W2 = { ...C, spec: aw, recs: chordRecordsOf(aw, row, cells) };
  check(`Walking: bars 2 and 3 re-mined (bar 2 approaches the new chord), bars 1 and 4 untouched (bass changed in bars ${J(rw.changed.bass.map((b) => b + 1))})`,
    !verify(W2, wb, readBassOptions({ density: 'walking' }), [1, 2]) && [0, 3].every((b) => J(wb.bass.bars[b]) === J(bassOf(w).bass.bars[b])) && rw.changed.bass.every((b) => b === 1 || b === 2));
}

// ── 8. deterministic; the spec untouched; the options ──
console.log('\n— deterministic, the spec untouched, the options');
{
  const C = caseOf('19:17:16:15');
  const a = arrangeBass(C.spec, C.M, { density: 'walking', lock: 'kick' }), b = arrangeBass(C.spec, materialsOf(C.spec), { density: 'walking', lock: 'kick' });
  check('the same spec and options, byte-identical output (materials rebuilt too)', J(a) === J(b));
  check('the spec is not touched', J(C.spec) === J(compose([19, 17, 16, 15], 6, { seed: 1 })));
  check('re-arranging an arranged bass starts from the spec (its sound, legato and on/off kept)', J(arrangeBass(withBass(C.spec, a), C.M, { density: 'roots' })) === J(arrangeBass(C.spec, C.M, { density: 'roots' })));
  check('the defaults: Sparse, Free, no picks', J(readBassOptions()) === J({ density: 'sparse', lock: 'free', picks: {} }));
  check('the options checked', [{ density: 'dense' }, { lock: 'snare' }, { picks: [] }, { picks: { a: 'x' } }, { picks: { 0: 3 } }, { time: 2 }].every((o) => throws(() => arrangeBass(C.spec, C.M, o), /composer\/bass/)));
  check('a refused spec; no materials; another spec\'s materials', throws(() => arrangeBass({ refused: true }, C.M), /no composition/) && throws(() => arrangeBass(C.spec, null), /materials/)
    && throws(() => arrangeBass(C.spec, caseOf('8:7:6:5').M), /materials|tone of the row/));
}

// ── 9. the 16,359-onset row ──
console.log('\n— the 16,359-onset row');
const BIG = composed([4099, 4093, 4091, 4079], 16);
{
  const C = BIG, rows = [];
  let bad = '', worst = 0;
  check(`the default is Compose's bass byte for byte (${C.N} × ${C.S}, ${C.row.n} onsets)`, J(strip(arrangeBass(C.spec, C.M))) === J(bassOf(C.spec)));
  for (const density of DENSITIES) for (const lock of LOCKS) {
    const ms = []; let p;
    for (let r = 0; r < 3; r++) { const t0 = performance.now(); p = arrangeBass(C.spec, C.M, { density, lock }); ms.push(performance.now() - t0); }
    const m = median(ms), s = p.bass.stats;
    worst = Math.max(worst, m);
    bad ||= verify(C, p, readBassOptions({ density, lock })) && `${density}/${lock}: ${verify(C, p, readBassOptions({ density, lock }))}`;
    rows.push(`${density}/${lock}: ${s.perBar.toFixed(2)} a bar, ${s.onDown}/${s.bars} on the downbeat, ${m.toFixed(1)} ms`);
  }
  check(`every density × lock holds every rule; each under 150 ms (the worst, median of 3: ${worst.toFixed(1)} ms)`, !bad && worst < 150, bad);
  console.log(`  · measured: ${rows.join('\n  · measured: ')}`);
}

// ── 10. the report's rows ──
console.log('\n— the report\'s rows (notes a bar · bars with a note on the downbeat · ms)');
for (const C of [...cases, ...charts, BIG]) {
  const out = [];
  for (const lock of LOCKS) {
    const cells = [];
    for (const density of DENSITIES) {
      const t0 = performance.now(), p = arrangeBass(C.spec, C.M, { density, lock }), ms = performance.now() - t0, s = p.bass.stats;
      cells.push(`${density} ${s.perBar.toFixed(2)}·${s.onDown}/${s.bars}${s.fallback ? ` (${s.fallback} fb)` : ''}${s.rests ? ` (${s.rests} rest)` : ''} ${ms.toFixed(1)}`);
    }
    out.push(`${lock}${arrangeBass(C.spec, C.M, { lock }).bass.refused ? ' (→ free)' : ''}: ${cells.join(', ')}`);
  }
  console.log(`  · ${C.label} (${C.N} × ${C.S}):\n      ${out.join('\n      ')}`);
}

console.log(PASS ? `\n✓✓✓ BASS PASSES (${checks} checks)` : `\n✗ BASS FAILED`);
process.exit(PASS ? 0 : 1);
