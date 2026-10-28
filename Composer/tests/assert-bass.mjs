// assert-bass.mjs — the bass's densities, its covering locks, Walking's fill and Roots' runner-ups
// (Composer/BASS_VOICING_ORDER.md, phase G: P10–P15, and Amendment 1's phase J: P22–P24): core/bass.js `arrangeBass` over
// composed specs, read against the test's own reading of the order (its slots, windows, hits, frames, shares and
// rankings are worked out here from the spec, the row and the cells, not from bass.js).
//   • Sparse and Free with no picks: Compose's bass byte for byte (rows, charts, a MIDI target, the 16k row)
//   • every note a real onset at its own time and hz, two octaves under the lead's range (the bass's octave over its root)
//   • Free: Sparse 20–35 %, Moving 40–60 % of the bar's slots; Walking every slot of its clock (the bar's slots, halved
//     while above 8), else (P22) the most notes a brute force finds a stepwise line can sound, rests where no step fits;
//     its last move no farther from the next chord's root than the same mine without the approach
//   • the lock (P23): every hit (Kick: a kick's onsets within ¼ slot; Clave: a comp stroke; hits in one slot one hit)
//     covered on one of its in-frame onsets, or counted missed and resting; Sparse and Moving's totals at least the
//     hits and inside their band of the whole bar (to the nearest note); Walking every slot but a missed hit's, the
//     hits' on the hits; Roots a root on every hit; Kick with the drums off or no kick, Clave with no clave: Free, with
//     the reason
//   • Roots' runner-ups (P24): a chord's every in-frame root-class onset, nearest its first anchor first (locked: a hit's,
//     nearest the hit), a bar's up to 8 combinations by summed distance, the first Roots' own note; picks
//   • offers: at most 8 a bar, distinct, root-opening first, then cost per note; the first plays unless picked; a pick not
//     offered is missed; another density's picks are not offered (the window drops them)
//   • a chord swap (rearrange.js, P14) re-mines the bar at the part's density and lock, keeping a pick only where it is
//     still offered (else `bassDropped`); Walking re-mines the bar before; an edit to what is there is byte for byte
//   • deterministic; the spec untouched; the options checked; the 16k row's timings; the report's rows
//   node Composer/tests/assert-bass.mjs
import { compose, partContext } from '../core/compose.js';
import { materialsOf, chordRecordsOf, rearrange, applyRearrange } from '../core/rearrange.js';
import { buildCells, cropCells } from '../core/cells.js';
import { targetsOf } from '../core/harmony.js';
import { mineLines, buildLattice, rolesOf, rulesOf, intervalCost, DEFAULT_RULES } from '../core/lines.js';
import { classOfCents } from '../core/frame.js';
import { arrangeBass, readBassOptions, bassLockRefusal, walkClock, BASS_DEFAULTS, BASS_ALTERNATES, HIT_MOMENTS } from '../core/bass.js';
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
/** the builder's cap on a mined hit's onsets (P23, proposed: a window's width) */
const CAP = 12;

console.log('═══ COMPOSER — the bass\'s densities, locks, fills and runner-ups: arrangeBass (BASS_VOICING_ORDER.md phases G, J) ═══');

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
  /** the chord of spec slot j */
  const chordOf = (j) => (split ? recs.find((c) => j >= c.from && j < c.from + c.slots) ?? recs[unitsOf(Math.floor(j / S))[0]] : recs[Math.floor(j / S)]);
  // each slot's window's onsets, from the cells
  const win = Array.from({ length: P }, () => []);
  for (let i = 0; i < row.n; i++) if (cells.slotOfNode[i] >= 0) win[cells.slotOfNode[i]].push(i);
  // Walking's clock (P11): the bar's slots, halved while above 8 (and even); its cells built here
  let SU = S; while (SU > 8 && SU % 2 === 0) SU /= 2;
  const o = { slotsPerBar: SU, anchors: k.anchors, phase: k.phase };
  const clock = SU === S ? cells : k.cut ? cropCells(buildCells(row, { bars: k.cut.bars, ...o }), N) : buildCells(row, { bars: N, ...o });
  return { spec, M, row, cells, k, S, N, P, rowT, ctx, recs, split, unitsOf, rangeOf, chordOf, win, SU, clock, label: `${L.join(':')}${label ? ` ${label}` : ''}` };
}
const bassOf = (spec) => spec.parts.find((p) => p.id === 'bass');
const withBass = (spec, part) => ({ ...spec, parts: spec.parts.map((p) => (p.id === 'bass' ? part : p)) });
const strip = (part) => { const { bass, ...rest } = part; return rest; };

const pcOf = (C, c, tone) => classOfCents(C.row.toneCents[tone] - c.rootCents);
const inFrame = (C, c, tone) => Math.abs(pcOf(C, c, tone).dev) <= C.k.frameCentsEachSide + EPS;
const rootClass = (C, c, tone) => { const q = pcOf(C, c, tone); return q.pc === 0 && Math.abs(q.dev) <= C.k.frameCentsEachSide + EPS; };
const chordTone = (C, c, tone) => { const q = pcOf(C, c, tone); return Math.abs(q.dev) <= C.k.frameCentsEachSide + EPS && c.intervals.includes(q.pc); };
/** the bass's register over chord c: the lowest octave at or over its root less 2450¢ (compose.js' root fallback) */
const octaveOver = (C, c, tone) => Math.ceil((c.rootCents - 2450 - C.row.toneCents[tone]) / 1200 - EPS);
/** nearest first, then the one before, then the lower node */
const nearest = (a, b) => (Math.abs(a.d - b.d) > EPS ? a.d - b.d : Math.abs(a.s - b.s) > EPS ? a.s - b.s : a.i - b.i);

/** the lock as the order reads it (P12, P23) → { ran, hits: [{ own, x, nodes: Set }] | null } */
function lockOf(C, lock) {
  const { spec, row, cells, rowT, ctx } = C;
  if (lock === 'kick') {
    const kicks = spec.drums?.enabled ? spec.drums.hits.filter((h) => h.voice === 'kick') : [];
    if (!kicks.length) return { ran: 'free', hits: null };
    const hits = [], T = C.k.cycleSeconds;
    for (const h of kicks) {
      const t = ctx.timeOf(h.tick), w = 0.25 * cells.slots[h.slot].length * rowT, nodes = new Set();
      for (let i = 0; i < row.n; i++) { if (ctx.posSlot[i] < 0) continue; const d = Math.abs(ctx.timeOf(row.tick[i]) - t); if (Math.min(d, T - d) <= w + EPS) nodes.add(i); }
      if (!nodes.size) for (let i = 0; i < row.n; i++) if (row.tick[i] === h.tick) nodes.add(i);
      const own = [...nodes].filter((i) => row.tick[i] === h.tick).sort((a, b) => a - b)[0] ?? Math.min(...nodes);
      hits.push({ own, x: row.x[own], nodes });
    }
    return { ran: 'kick', hits };
  }
  if (lock === 'clave') {
    const cl = spec.clave;
    if (!cl) return { ran: 'free', hits: null };
    const strokes = cl.relation === 'fill' ? cl.partner.strokes.filter((x) => !x.shared) : cl.strokes;
    return strokes.length ? { ran: 'clave', hits: strokes.map((x) => ({ own: x.node, x: row.x[x.node], nodes: new Set([x.node]) })) } : { ran: 'free', hits: null };
  }
  return { ran: 'free', hits: null };
}
/** a node's slot on a clock: its window's, else the nearest anchor's (the one before it on a tie), within that slot's length */
function cellOf(C, cellsU, i) {
  if (cellsU.slotOfNode[i] >= 0) return cellsU.slotOfNode[i];
  let best = -1, bd = Infinity, bs = 0;
  cellsU.slots.forEach((s, c) => { let d = C.row.x[i] - s.anchor; d -= Math.round(d); if (Math.abs(d) < bd - EPS || (Math.abs(Math.abs(d) - bd) <= EPS && d > bs)) { best = c; bd = Math.abs(d); bs = d; } });
  return best >= 0 && bd <= cellsU.slots[best].length + EPS ? best : -1;
}
/** a node's distance from a hit's places (cycles): { d, s (signed) } */
function fromHit(C, xs, i) {
  let d = Infinity, s = 0;
  for (const x of xs) { let v = C.row.x[i] - x; v -= Math.round(v); if (Math.abs(v) < d - EPS || (Math.abs(Math.abs(v) - d) <= EPS && v < s)) { d = Math.abs(v); s = v; } }
  return { d, s };
}
/** bar b's hits on a clock (P23): grouped by their own onset's slot, kept to the slot's frame → { groups, missed } */
function hitsOf(C, cellsU, b, hits) {
  const SU = cellsU.slotsPerBar, r = C.S / SU, by = new Map();
  for (const h of hits) {
    const c = cellOf(C, cellsU, h.own);
    if (!(c >= b * SU && c < (b + 1) * SU)) continue;
    if (!by.has(c)) by.set(c, { cell: c, all: new Set(), xs: [] });
    const g = by.get(c); for (const i of h.nodes) g.all.add(i); g.xs.push(h.x);
  }
  const groups = [], missed = [];
  for (const g of [...by.values()].sort((a, b2) => a.cell - b2.cell)) {
    const ch = C.chordOf(g.cell * r), nodes = [...g.all].filter((i) => inFrame(C, ch, C.row.tone[i]));
    const capped = nodes.map((i) => ({ i, ...fromHit(C, g.xs, i) })).sort(nearest).slice(0, CAP).map((x) => x.i);
    (nodes.length ? groups : missed).push({ cell: g.cell, slot: g.cell * r, chord: ch, nodes: new Set(nodes), capped: new Set(capped), xs: g.xs });
  }
  return { groups, missed };
}
/** the top 8 combinations of one entry a list (each list ranked), by summed distance, then by their ranks: a brute force
 *  over the full product of each list's first 8 (a combination with a rank past 7 has 8 at least as good: exact) */
function combosWant(lists) {
  let all = [{ sum: 0, ranks: [], picks: [] }];
  for (const l of lists) { const next = []; for (const c of all) l.slice(0, 8).forEach((x, r) => next.push({ sum: c.sum + x.d, ranks: [...c.ranks, r], picks: [...c.picks, x] })); all = next; }
  const lexi = (a, b) => { for (let q = 0; q < a.length; q++) if (a[q] !== b[q]) return a[q] - b[q]; return 0; };
  return all.sort((a, b) => (Math.abs(a.sum - b.sum) > EPS ? a.sum - b.sum : lexi(a.ranks, b.ranks))).slice(0, 8);
}
/** a note is its slot, tone and octave: a ranked list keeps a tone's first in a slot (two onsets of one tone in one
 *  window are one note; the builder's call, as a window keeps a tone) */
const onePerTone = (C, list, slotOf) => { const seen = new Set(); return list.filter((x) => { const key = `${slotOf(x)}:${C.row.tone[x.i]}`; if (seen.has(key)) return false; seen.add(key); return true; }); };
/** Roots (P11, P23, P24), the test's brute force: bar b's ranked lists (a chord's, or a hit's) → { lists: [[{ node, slot, c, d }]], groups, missed } */
function rootsWant(C, b, lk) {
  const { row, cells, recs, win, ctx } = C, lists = [];
  if (!lk.hits) {
    for (const u of C.unitsOf(b)) {
      const c = recs[u], { from, to } = C.rangeOf(u), a0 = cells.slots[from].anchor, cands = [];
      for (let j = from; j < to; j++) for (const i of win[j]) {
        if (!rootClass(C, c, row.tone[i])) continue;
        const d = row.x[i] - cells.slots[j].anchor, at = mod(cells.slots[j].anchor - a0, 1) + d - Math.round(d);
        cands.push({ i, j, d: Math.abs(at), s: at });
      }
      if (cands.length) lists.push(onePerTone(C, cands.sort(nearest), (x) => x.j).map((x) => ({ node: x.i, slot: x.j, c, d: x.d })));
      else if (c.rootNode != null) lists.push([{ node: c.rootNode, slot: ctx.posSlot[c.rootNode], c, d: 0 }]);
    }
    return { lists, groups: [], missed: [] };
  }
  const { groups, missed } = hitsOf(C, cells, b, lk.hits);
  for (const g of groups) {
    const ranked = [...g.nodes].map((i) => ({ i, ...fromHit(C, g.xs, i) })).sort(nearest);
    const root = onePerTone(C, ranked.filter((x) => rootClass(C, g.chord, row.tone[x.i])), () => g.cell);
    const list = root.length ? root : [ranked.find((x) => chordTone(C, g.chord, row.tone[x.i])) ?? ranked[0]];
    lists.push(list.map((x) => ({ node: x.i, slot: g.cell, c: g.chord, d: x.d })));
  }
  return { lists, groups, missed };
}
const noteKey = (w) => [w.node, w.slot];
/** a band's fewest and most notes over the bar's slots: Free (P11) as bandNotes; locked (P23) to the nearest note, at
 *  least the H hits */
function notesRange(density, slots, H) {
  const [a, b] = SHARE[density];
  if (H == null) return [Math.max(2, Math.ceil(a * slots - EPS)), Math.floor(b * slots + EPS)];
  const lo = Math.max(1, Math.floor(a * slots + 0.5 + EPS)), hi = Math.max(lo, Math.floor(b * slots + 0.5 + EPS));
  return [Math.max(H, lo), Math.max(H, hi)];
}

/**
 * Walking's fill (P22), the test's brute force: the most notes any line of bar b can sound on its clock, over every line
 * (memoized, no maxGap): a foreign tone only on a weak slot (ties weak, the fill's lattice), followed by a tone inside
 * within a step, never last; a hit's slot sounding on its onsets, a missed hit's resting (the order's rules, lines.js'
 * lattice and roles read for the candidates). Non-split bars. → { most, full (the slots a full walk sounds), H }
 */
function walkMost(C, b, lk) {
  const cellsU = C.clock, SU = cellsU.slotsPerBar, c = C.recs[b], targets = targetsOf(C.recs), sub = { scale: targets.scale, bars: [targets.bars[b]] };
  let requireNodes = null, avoid = new Set(), H = 0, missed = 0;
  if (lk.hits) {
    const got = hitsOf(C, cellsU, b, lk.hits), need = new Set(got.groups.flatMap((g) => [...g.capped]));
    requireNodes = got.groups.map((g) => ({ cell: g.cell, nodes: [...g.capped] }));
    for (const g of got.missed) for (let i = 0; i < C.row.n; i++) if (cellsU.slotOfNode[i] === g.cell && !need.has(i)) avoid.add(i);
    H = got.groups.length; missed = got.missed.length;
  }
  const lat = buildLattice(C.row, cellsU, c.frame, { from: b, bars: 1, low: sub.bars[0].anchor - 2400, width: 1200, weakTies: true, ...(requireNodes ? { requireNodes } : {}) });
  const roles = rolesOf(lat, rulesOf({ targets: sub })), P = lat.P, req = lat.slots.map((s) => !!s.required);
  const ok = (k, ci) => !avoid.has(lat.slots[k].cands[ci].node) && (!roles[k][ci].foreign || lat.slots[k].weak);
  const memo = new Map();
  const best = (k, ci) => {
    const key = k * 4096 + ci;
    if (memo.has(key)) return memo.get(key);
    let v = !roles[k][ci].foreign && !req.slice(k + 1).some(Boolean) ? 1 : -Infinity;
    for (let j = k + 1; j < P; j++) {
      for (let cj = 0; cj < lat.slots[j].cands.length; cj++) {
        if (!ok(j, cj)) continue;
        if (roles[k][ci].foreign && (roles[j][cj].foreign || Math.abs(lat.slots[j].cands[cj].pitch - lat.slots[k].cands[ci].pitch) > DEFAULT_RULES.step)) continue;
        v = Math.max(v, 1 + best(j, cj));
      }
      if (req[j]) break;   // a line can't step over a hit's slot
    }
    memo.set(key, v);
    return v;
  };
  let most = -Infinity;
  for (let k = 0; k < P; k++) {
    for (let ci = 0; ci < lat.slots[k].cands.length; ci++) if (ok(k, ci)) most = Math.max(most, best(k, ci));
    if (req[k]) break;   // nor open after one
  }
  return { most, full: SU - missed, H };
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
  }
  const walking = opt.density === 'walking';
  let rooted = 0, onDown = 0, hitsAll = 0, missedAll = 0, fills = 0, fillNotes = 0;
  for (let b = 0; b < N; b++) {
    if (bars && !bars.includes(b)) continue;
    const rec = a.bars[b], own = part.notes.filter((n) => n.bar === b), c0 = recs[C.unitsOf(b)[0]], at = `bar ${b} (${rec.how})`;
    if (rec.bar !== b || rec.notes !== own.length) return `${at}: record ${rec.bar} of ${rec.notes} notes, the part ${own.length}`;
    // the hits on the clock the bar played (P23): each covered on one of its in-frame onsets, or missed and resting
    const onSpec = opt.density === 'roots' || rec.how === 'locked roots', cellsU = walking && !onSpec ? C.clock : C.cells, SU = cellsU.slotsPerBar, r = S / SU;
    const hb = lk.hits ? hitsOf(C, cellsU, b, lk.hits) : null;
    if (hb) {
      if (rec.hits !== hb.groups.length + hb.missed.length || rec.missedHits !== hb.missed.length || rec.lockedSlots !== rec.hits || J(rec.missedSlots) !== J(hb.missed.map((g) => g.slot))) return `${at}: hits ${rec.hits}/${rec.missedHits} ${J(rec.missedSlots)}, the order's ${hb.groups.length + hb.missed.length}/${hb.missed.length} ${J(hb.missed.map((g) => g.slot))}`;
      for (const g of hb.groups) if (!own.some((n) => n.slot === g.slot && (onSpec ? g.nodes : g.capped).has(n.node))) return `${at}: the hit at slot ${g.slot} not covered (${J(own.map((n) => [n.slot, n.node]))})`;
      for (const g of hb.missed) if (own.some((n) => n.slot === g.slot)) return `${at}: the missed hit at slot ${g.slot} sounds`;
      if (rec.how === 'root onset' && hb.groups.length) return `${at}: the root onset with ${hb.groups.length} hits to cover`;
      hitsAll += rec.hits; missedAll += rec.missedHits;
    } else if (rec.hits != null) return `${at}: hits recorded with no lock`;
    if (opt.density === 'roots' || rec.how === 'locked roots') {
      const want = rootsWant(C, b, lk), combos = combosWant(want.lists);
      if (opt.density === 'roots' && rec.how !== (combos[0]?.picks.length ? 'roots' : 'rest')) return `${at}: Roots is ${rec.how}`;
      if (rec.how === 'locked roots' && rec.alternates.length) return `${at}: a fallback with ${rec.alternates.length} alternates`;
      const shown = opt.density === 'roots' ? rec.alternates : [];
      if (opt.density === 'roots') {
        // P24: the offer is the top 8 combinations, each a note a chord (a hit), the first Roots' own
        if (shown.length !== (combos[0]?.picks.length ? combos.length : 0)) return `${at}: ${shown.length} alternates, the order's ${combos.length}`;
        for (const [q, x] of shown.entries()) {
          const w = combos[q].picks;
          if (J(x.notes.map((n) => [n.node, n.slot, n.octave])) !== J(w.map((p) => [...noteKey(p), octaveOver(C, p.c, row.tone[p.node])]))) return `${at}: alternate ${q} ${J(x.notes.map((n) => [n.node, n.slot]))}, the order's ${J(w.map(noteKey))}`;
          if (x.band !== 'roots' || x.n !== w.length || x.rooted !== rootClass(C, c0, row.tone[w[0].node])) return `${at}: alternate ${q}'s band, n or rooted`;
        }
      }
      const want0 = opt.density === 'roots' ? (shown.find((x) => x.id === opt.picks[b]) ?? shown[0])?.notes.map((n) => [n.node, n.slot, n.octave]) ?? [] : combos[0].picks.map((p) => [...noteKey(p), octaveOver(C, p.c, row.tone[p.node])]);
      const got = own.map((n) => [n.node, n.slot, n.octave]);
      if (J(got.slice().sort()) !== J(want0.slice().sort())) return `${at}: notes ${J(got)}, the order's ${J(want0)}`;
    } else if (rec.how === 'root onset') {
      if (rec.alternates.length || own.length !== 1 || own[0].node !== c0.rootNode) return `${at}: the root onset ${J(own.map((n) => n.node))} (root ${c0.rootNode}), ${rec.alternates.length} alternates`;
    } else if (rec.how === 'mined') {
      const H = hb ? hb.groups.length : null, L = SU - (hb ? hb.missed.length : 0);
      let lo, hi;
      if (walking) { lo = hi = rec.walkFill ?? L; if (rec.walkFill != null && !(rec.walkFill < L && rec.walkFill >= Math.max(2, H ?? 0))) return `${at}: a fill of ${rec.walkFill} of ${L}`; }
      else [lo, hi] = notesRange(opt.density, SU, H);
      if (!(own.length >= lo && own.length <= hi)) return `${at}: ${own.length} notes, the band ${lo}–${hi} of ${SU} slots${H != null ? ` (${H} hits)` : ''}`;
      const cellOfNote = (n) => n.slot / r, hitCell = new Map((hb?.groups ?? []).map((g) => [g.cell, g]));
      for (const n of own) {
        const cell = cellOfNote(n), g = hitCell.get(cell);
        if (n.slot % r || Math.floor(cell / SU) !== b || (g ? !g.capped.has(n.node) : cellsU.slotOfNode[n.node] !== cell)) return `${at}: node ${n.node} at slot ${n.slot} is not in its clock slot's window (or its hit's onsets)`;
        const p = row.toneCents[row.tone[n.node]] + 1200 * n.octave;
        if (!(p >= c0.rootCents - 2400 - EPS && p < c0.rootCents - 1200 - EPS)) return `${at}: pitch ${p.toFixed(1)} outside the bass's octave over ${c0.rootCents.toFixed(1)} − 2400`;
      }
      const slots = own.map(cellOfNote).sort((x, y) => x - y);
      if (new Set(slots).size !== slots.length) return `${at}: two notes on one slot`;
      if (walking && rec.walkFill == null && J(slots) !== J(Array.from({ length: SU }, (_, j) => b * SU + j).filter((j) => !hb?.missed.some((g) => g.cell === j)))) return `${at}: Walking leaves a slot (${J(slots)})`;
      if (rec.walkFill != null) { fills++; fillNotes += own.length; }
      // the offers: ≤ 8, distinct, root-opening first, then cost per note; each within the band; the picked one plays
      const alts = rec.alternates;
      if (!alts.length || alts.length > BASS_ALTERNATES || new Set(alts.map((x) => x.id)).size !== alts.length) return `${at}: ${alts.length} alternates`;
      for (let i = 1; i < alts.length; i++) if ((!alts[i - 1].rooted && alts[i].rooted) || (alts[i - 1].rooted === alts[i].rooted && alts[i - 1].perNote > alts[i].perNote + EPS)) return `${at}: alternates out of order at ${i}`;
      for (const x of alts) {
        if (!(x.n === x.notes.length && x.n >= lo && x.n <= hi) || x.notes.some((n) => n.slot % r)) return `${at}: alternate ${x.id} (${x.n} notes)`;
        if (x.rooted !== rootClass(C, c0, row.tone[x.notes[0].node])) return `${at}: alternate ${x.id} says rooted ${x.rooted}`;
      }
      const want = opt.picks[b], chosen = alts.find((x) => x.id === want) ?? alts[0];
      if (rec.picked !== chosen.id || (want != null && want !== chosen.id) !== (rec.missed === want && want != null)) return `${at}: picked ${rec.picked}, missed ${rec.missed} (asked ${want})`;
      if (J(chosen.notes.map((n) => [n.slot, n.node, n.octave])) !== J(own.slice().sort((x, y) => x.slot - y.slot).map((n) => [n.slot, n.node, n.octave]))) return `${at}: the part is not the picked line`;
    } else if (rec.how === 'rest') {
      if (own.length) return `${at}: a rest with ${own.length} notes`;
      if (opt.density !== 'roots' && hb?.groups.length) return `${at}: a rest with ${hb.groups.length} hits to cover`;
    } else return `${at}: how ${rec.how}`;
    // the bar's first note (Compose's notes[0]): a line's first, or the first chord's (hit's) Roots note
    const firstNode = rec.how === 'roots' || rec.how === 'locked roots' ? (opt.density === 'roots' ? (rec.alternates.find((x) => x.id === rec.picked)?.notes[0]?.node ?? null) : rootsWant(C, b, lk).lists[0]?.[0]?.node ?? null)
      : own.length ? own.slice().sort((x, y) => x.slot - y.slot)[0].node : null;
    const isRooted = firstNode != null && pcOf(C, c0, row.tone[firstNode]).pc === 0;
    if (rec.rooted !== isRooted || rec.onDown !== own.some((n) => n.slot === b * S)) return `${at}: rooted ${rec.rooted} / onDown ${rec.onDown}`;
    if (rec.rooted) rooted++;
    if (rec.onDown) onDown++;
  }
  if (!bars) {
    const s = a.stats, notes = part.notes.length;
    if (s.density !== opt.density || s.bars !== N || s.notes !== notes || Math.abs(s.perBar - notes / N) > 1e-12 || s.rooted !== rooted || s.onDown !== onDown
      || s.mined !== a.bars.filter((x) => x.how === 'mined').length || s.rests !== a.bars.filter((x) => x.how === 'rest').length) return `stats ${J(s)}`;
    if (lk.hits ? s.hits !== hitsAll || s.missedHits !== missedAll : 'hits' in s) return `stats' hits ${s.hits}/${s.missedHits}, the order's ${hitsAll}/${missedAll}`;
    if (fills ? s.walkFill !== fills || s.walkFillNotes !== fillNotes : 'walkFill' in s) return `stats' walkFill ${s.walkFill}/${s.walkFillNotes}, the order's ${fills}/${fillNotes}`;
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
const BIG = composed([4099, 4093, 4091, 4079], 16);
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

// ── 3. Roots: one note a chord, and its runner-ups (P24) ──
console.log('\n— Roots');
{
  let chords = 0, notes = 0, rootedNotes = 0;
  for (const C of [...cases, ...charts]) {
    const p = arrangeBass(C.spec, C.M, { density: 'roots' });
    chords += C.recs.length; notes += p.notes.length;
    rootedNotes += p.notes.filter((n) => rootClass(C, C.recs.find((c) => (C.split ? n.slot >= c.from && n.slot < c.from + c.slots : c.bar === n.bar)) ?? C.recs[n.bar], C.row.tone[n.node])).length;
  }
  check(`HIT_MOMENTS is the test's cap (${HIT_MOMENTS})`, HIT_MOMENTS === CAP);
  check(`free: one note a chord over every row and chart (${notes} notes for ${chords} chords; ${rootedNotes} on the chord's root class)`, notes === chords && rootedNotes > 0.8 * notes);
  const C = caseOf('119:42:15:8 chart'), p = arrangeBass(C.spec, C.M, { density: 'roots' });
  check(`a chart's split bars: a note a span (${p.notes.length} for ${C.recs.length} spans over ${C.N} bars)`, p.notes.length === C.recs.length && C.recs.length > C.N);
  // every in-frame root-class onset of a one-chord bar is offered (up to 8), nearest the chord's first anchor first
  let bars = 0, every = 0, ok = true, why = '', offered = 0;
  for (const X of cases) {
    const q = arrangeBass(X.spec, X.M, { density: 'roots' });
    for (let b2 = 0; b2 < X.N; b2++) {
      const want = rootsWant(X, b2, { hits: null }).lists[0], got = q.bass.bars[b2].alternates;
      bars++; offered += got.length;
      if (J(got.map((x) => x.notes[0].node)) !== J(want.slice(0, 8).map((w) => w.node))) { ok = false; why ||= `${X.label} bar ${b2 + 1}: ${J(got.map((x) => x.notes[0].node))}, the order's ${J(want.slice(0, 8).map((w) => w.node))}`; }
      for (let i = 1; i < got.length; i++) if (got[i].distance < got[i - 1].distance - 1e-9) { ok = false; why ||= `${X.label} bar ${b2 + 1}: distances out of order`; }
      if (want.length <= 8) every++;
    }
  }
  check(`free: a bar offers its every in-frame root-class onset, ranked nearest the change (${offered} runner-ups over ${bars} bars; ${every} bars offer them all, the rest their nearest 8)`, ok && offered > bars, why);
  // a pick plays; a pick not offered plays the first and is missed
  const R = caseOf('768:784'), base = arrangeBass(R.spec, R.M, { density: 'roots' }), b0 = base.bass.bars.findIndex((x) => x.alternates.length >= 3), alt = base.bass.bars[b0].alternates[2];
  const optP = readBassOptions({ density: 'roots', picks: { [b0]: alt.id } }), picked = arrangeBass(R.spec, R.M, optP);
  const optX = readBassOptions({ density: 'roots', picks: { [b0]: 'rt1:00000000' } }), stale = arrangeBass(R.spec, R.M, optX);
  check(`bar ${b0 + 1}'s third root picked: it plays (slot ${alt.notes[0].slot}), the others as before; a pick not offered plays the first, missed`,
    picked.bass.bars[b0].picked === alt.id && !verify(R, picked, optP) && J(picked.notes.filter((n) => n.bar === b0).map((n) => n.node)) === J(alt.notes.map((n) => n.node))
    && picked.bass.bars.every((x, i) => i === b0 || x.picked === base.bass.bars[i].picked) && stale.bass.bars[b0].missed === 'rt1:00000000' && J(stale.notes) === J(base.notes) && !verify(R, stale, optX));
  // a chart's split bar: the combinations of its spans' candidates, by summed distance (the brute force in verify)
  const CH = caseOf('119:42:15:8 chart'), ch = arrangeBass(CH.spec, CH.M, { density: 'roots' }), multi = ch.bass.bars.filter((x) => x.alternates[0]?.n > 1);
  check(`a chart's split bars offer combinations (${multi.length} bars of ${multi.map((x) => x.alternates[0].n).join(', ')} chords: ${multi.map((x) => x.alternates.length).join(', ')} runner-ups), by summed distance`,
    multi.length > 0 && multi.every((x) => x.alternates.every((y, i) => i === 0 || y.distance >= x.alternates[i - 1].distance - 1e-9)) && !verify(CH, ch, readBassOptions({ density: 'roots' })));
}

// ── 4. Walking: every slot of its clock, else the fullest walk; and the approach ──
console.log('\n— Walking');
{
  let bars = 0, closer = 0, same = 0, within = 0, ok = true, why = '';
  for (const C of cases) {
    const p = arrangeBass(C.spec, C.M, { density: 'walking' }), targets = targetsOf(C.recs);
    for (let b = 0; b < C.N; b++) {
      const rec = p.bass.bars[b];
      if (rec.how !== 'mined' || rec.walkFill != null) continue;
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
  check(`its last move never farther from the next chord's root than the same mine without the approach (${bars} full walks: ${closer} nearer, ${same} the same; ${within} end within a step of it)`, ok && closer > 0, why);
  const C = caseOf('768:784 chart, 16 slots'), p = arrangeBass(C.spec, C.M, { density: 'walking' });
  check(`16 slots a bar walk 8 (the clock halved: walkClock(16) = ${walkClock(16)}, (12) = ${walkClock(12)}, (8) = ${walkClock(8)}): ${p.notes.length} notes over ${C.N} bars, every one on an even slot`,
    walkClock(16) === 8 && walkClock(12) === 6 && walkClock(8) === 8 && p.bass.bars.every((b) => b.how !== 'mined' || b.notes === 8) && p.notes.every((n) => n.slot % 2 === 0) && !verify(C, p, readBassOptions({ density: 'walking' })));
  // P22: a bar that can't walk every slot walks the most a brute force finds any line can sound (free and locked)
  let walks = 0, full = 0, filled = 0, fell = 0, good = true, bad = '';
  const fillRows = [];
  for (const X of [...cases, BIG]) for (const lock of LOCKS) {
    const opt = readBassOptions({ density: 'walking', lock }), q = arrangeBass(X.spec, X.M, opt), lk = lockOf(X, lock), per = [];
    for (let b = 0; b < X.N; b++) {
      const rec = q.bass.bars[b], w = walkMost(X, b, lk), lo = Math.max(2, w.H);
      walks++;
      const want = w.most >= w.full ? 'full' : w.most >= lo ? 'fill' : 'fallback';
      const got = rec.how === 'mined' ? (rec.walkFill != null ? 'fill' : 'full') : 'fallback';
      if (want !== got || (got === 'fill' && (rec.walkFill !== w.most || rec.notes !== w.most)) || (got === 'full' && rec.notes !== w.full)) { good = false; bad ||= `${X.label} ${lock} bar ${b + 1}: ${got} ${rec.notes} (fill ${rec.walkFill}), the brute force ${want} ${w.most} of ${w.full}`; }
      if (got === 'full') full++; else if (got === 'fill') filled++; else fell++;
      per.push(got === 'fill' ? `${rec.walkFill}/${w.full}` : got === 'full' ? `${w.full}` : rec.how);
    }
    if (!X.label.startsWith('4099')) fillRows.push(`${X.label} ${lock}: ${per.join(' ')}`);
  }
  check(`the walk's count is the most a brute force finds (${walks} bar walks over 6 rows and the 16k row, free / kick / clave: ${full} full, ${filled} filled, ${fell} fell back)`, good && filled > 0, bad);
  console.log(`  · walks a bar (filled: notes/slots): ${fillRows.filter((x) => /^(11:9:7:5|768:769) /.test(x)).join('\n  · walks a bar (filled: notes/slots): ')}`);
}

// ── 5. the lock: every hit covered or missed (P23) ──
console.log('\n— the lock');
{
  let hits = 0, missed = 0, arr = 0, okBand = true, whyBand = '';
  for (const C of [...cases, ...charts]) for (const density of DENSITIES) for (const lock of ['kick', 'clave']) {
    const p = arrangeBass(C.spec, C.M, { density, lock });
    arr++; hits += p.bass.stats.hits ?? 0; missed += p.bass.stats.missedHits ?? 0;
    // Sparse and Moving: at least the hits, and inside the band of the bar's slots (verify holds each bar)
    if ((density === 'sparse' || density === 'moving') && p.bass.bars.some((b) => b.how === 'mined' && b.notes < b.hits - b.missedHits)) { okBand = false; whyBand ||= `${C.label} ${density}/${lock}`; }
  }
  check(`every hit covered on one of its in-frame onsets, or missed and resting (${arr} locked arrangements: ${hits} hits, ${missed} missed; verify checks each)`, hits > 0 && okBand, whyBand);
  // a backbeat (2 kicks, 8 slots): Sparse plays 2–3, Moving 3–5, the order's example
  const C = caseOf('119:42:15:8'), sp = arrangeBass(C.spec, C.M, { density: 'sparse', lock: 'kick' }), mv = arrangeBass(C.spec, C.M, { density: 'moving', lock: 'kick' });
  const two = sp.bass.bars.filter((b) => b.hits === 2 && !b.missedHits && b.how === 'mined');
  check(`a backbeat bar (2 kicks, 8 slots): Sparse plays ${J([...new Set(two.map((b) => b.notes))])} (2–3), Moving ${J([...new Set(mv.bass.bars.filter((b) => b.hits === 2 && !b.missedHits && b.how === 'mined').map((b) => b.notes))])} (3–5); notesRange says ${J(notesRange('sparse', 8, 2))} and ${J(notesRange('moving', 8, 2))}`,
    two.length > 0 && J(notesRange('sparse', 8, 2)) === '[2,3]' && J(notesRange('moving', 8, 2)) === '[3,5]' && two.every((b) => b.notes >= 2 && b.notes <= 3)
    && mv.bass.bars.every((b) => b.how !== 'mined' || b.hits !== 2 || b.missedHits || (b.notes >= 3 && b.notes <= 5)));
  const four = composed([119, 42, 15, 8], 8, { drums: { mode: 'four' }, label: 'four on the floor' });
  const kicks = four.spec.drums.hits.filter((h) => h.voice === 'kick').length;
  const sp4 = arrangeBass(four.spec, four.M, { density: 'sparse', lock: 'kick' }), wk = arrangeBass(four.spec, four.M, { density: 'walking', lock: 'kick' }), rt = arrangeBass(four.spec, four.M, { density: 'roots', lock: 'kick' });
  check(`four on the floor (${kicks} kicks): Roots ${rt.notes.length} (a root on every hit), Sparse ${sp4.notes.length} (at least the hits), Walking ${wk.notes.length}`,
    ['roots', 'sparse', 'walking'].every((d, q) => !verify(four, [rt, sp4, wk][q], readBassOptions({ density: d, lock: 'kick' }))) && rt.notes.length === rt.bass.stats.hits - rt.bass.stats.missedHits && sp4.notes.length >= sp4.bass.stats.hits - sp4.bass.stats.missedHits && wk.notes.length > sp4.notes.length);
  // Kick with the drums off (drums: false, and not enabled), and a mode with no kick: Free, with the reason
  const off = composed([119, 42, 15, 8], 8, { drums: false, label: 'drums off' }), dis = composed([119, 42, 15, 8], 8, { drums: { enabled: false }, label: 'drums disabled' });
  const hatOnly = composed([119, 42, 15, 8], 8, { drums: { mode: 'grid', fills: false, grid: { hat: Array.from({ length: 4 }, () => 'x'.repeat(8)) } }, label: 'hats only' });
  let fell = true;
  for (const X of [off, dis, hatOnly]) for (const density of DENSITIES) {
    const k = arrangeBass(X.spec, X.M, { density, lock: 'kick' }), f = arrangeBass(X.spec, X.M, { density });
    fell &&= k.bass.stats.lock === 'free' && k.bass.lock === 'kick' && typeof k.bass.refused === 'string' && J(k.notes) === J(f.notes) && J(k.bass.bars) === J(f.bass.bars) && !verify(X, k, readBassOptions({ density, lock: 'kick' }));
  }
  check(`Kick with the drums off ("${bassLockRefusal(off.spec, 'kick')}"), not enabled, or striking no kick ("${bassLockRefusal(hatOnly.spec, 'kick')}"): Free plays, the reason kept`, fell && /drums are off/.test(bassLockRefusal(dis.spec, 'kick')) && /no kick/.test(bassLockRefusal(hatOnly.spec, 'kick')));
  const notes2 = composed([11, 9, 7, 5], 5, { overrides: { compStyle: 'notes' }, label: 'notes' }), cl = arrangeBass(notes2.spec, notes2.M, { lock: 'clave' });
  check(`Clave on a spec that comps in notes: Free, with the reason ("${cl.bass.refused}")`, cl.bass.stats.lock === 'free' && /no clave/.test(cl.bass.refused) && J(strip(cl)) === J(bassOf(notes2.spec)));
  check('the refusal is null where the lock can land', bassLockRefusal(C.spec, 'kick') === null && bassLockRefusal(C.spec, 'clave') === null && bassLockRefusal(C.spec, 'free') === null);
  // Clave follows Sync | Fill: each covers its own strokes
  const fill = composed([119, 42, 15, 8], 8, { overrides: { compRelation: 'fill' }, label: 'fill' });
  const sy = arrangeBass(C.spec, C.M, { density: 'roots', lock: 'clave' }), fi = arrangeBass(fill.spec, fill.M, { density: 'roots', lock: 'clave' });
  check('Clave follows the comp: Sync covers the clave\'s strokes, Fill its partner\'s', !verify(fill, fi, readBassOptions({ density: 'roots', lock: 'clave' })) && !verify(C, sy, readBassOptions({ density: 'roots', lock: 'clave' })) && J(sy.notes.map((n) => n.node)) !== J(fi.notes.map((n) => n.node)));
  // locked Roots' runner-ups: a hit's candidates are its root-class onsets (verify's brute force holds the offer)
  let lockedAlts = 0; for (const X of cases) for (const b of arrangeBass(X.spec, X.M, { density: 'roots', lock: 'kick' }).bass.bars) lockedAlts += b.alternates.length;
  check(`locked Roots offers its hits' root-class onsets (${lockedAlts} runner-ups over the rows under Kick)`, lockedAlts > 0);
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
{
  const C = BIG, rows = [];
  let bad = '', worst = 0;
  check(`the default is Compose's bass byte for byte (${C.N} × ${C.S}, ${C.row.n} onsets)`, J(strip(arrangeBass(C.spec, C.M))) === J(bassOf(C.spec)));
  // the first offer on fresh materials (the window's first runner-up list), then each density × lock (median of 5)
  const fresh = materialsOf(C.spec), t0 = performance.now(); arrangeBass(C.spec, fresh); const first = performance.now() - t0;
  for (const density of DENSITIES) for (const lock of LOCKS) {
    const ms = []; let p;
    for (let r = 0; r < 5; r++) { const t1 = performance.now(); p = arrangeBass(C.spec, C.M, { density, lock }); ms.push(performance.now() - t1); }
    const m = median(ms), s = p.bass.stats;
    worst = Math.max(worst, m);
    bad ||= verify(C, p, readBassOptions({ density, lock })) && `${density}/${lock}: ${verify(C, p, readBassOptions({ density, lock }))}`;
    rows.push(`${density}/${lock}: ${s.perBar.toFixed(2)} a bar, ${s.onDown}/${s.bars} on the downbeat${s.hits != null ? `, ${s.hits - s.missedHits}/${s.hits} hits covered` : ''}, ${m.toFixed(1)} ms`);
  }
  check(`every density × lock holds every rule; each under 150 ms (the worst, median of 5: ${worst.toFixed(1)} ms; the first offer on fresh materials ${first.toFixed(1)} ms)`, !bad && worst < 150, bad);
  console.log(`  · measured: ${rows.join('\n  · measured: ')}`);
}

// ── 10. the report's rows ──
console.log('\n— the report\'s rows (notes a bar · bars with a note on the downbeat · locked: hits covered/hits, missed, extras · Roots: runner-ups · Walking: filled bars · ms)');
for (const C of [...cases, ...charts, BIG]) {
  const out = [];
  for (const lock of LOCKS) {
    const cells = [];
    for (const density of DENSITIES) {
      const t0 = performance.now(), p = arrangeBass(C.spec, C.M, { density, lock }), ms = performance.now() - t0, s = p.bass.stats;
      const covered = s.hits != null ? s.hits - s.missedHits : null, alts = p.bass.bars.reduce((n, b) => n + b.alternates.length, 0);
      cells.push(`${density} ${s.perBar.toFixed(2)}·${s.onDown}/${s.bars}${covered != null ? ` [${covered}/${s.hits} hits, ${s.missedHits} missed, ${s.notes - covered} extra]` : ''}`
        + `${density === 'roots' ? ` (${alts} alts)` : ''}${s.walkFill ? ` (${s.walkFill} filled)` : ''}${s.fallback ? ` (${s.fallback} fb)` : ''}${s.rests ? ` (${s.rests} rest)` : ''} ${ms.toFixed(1)}`);
    }
    out.push(`${lock}${arrangeBass(C.spec, C.M, { lock }).bass.refused ? ' (→ free)' : ''}: ${cells.join(', ')}`);
  }
  console.log(`  · ${C.label} (${C.N} × ${C.S}):\n      ${out.join('\n      ')}`);
}

console.log(PASS ? `\n✓✓✓ BASS PASSES (${checks} checks)` : `\n✗ BASS FAILED`);
process.exit(PASS ? 0 : 1);
