// assert-cells.mjs — Composer/core/cells.js. Exit non-zero on any mismatch.
//   • OVERWORLD PARITY: on 50 rhythms, even anchors give chunk-super-row.js `slotCandidates` of that one rhythm's
//     normalized row, slot for slot and tone for tone, over phases, slot counts and swings; and a window sized in
//     onsets has chunk-lines `buildLattice`'s swing and slot strikes. Imported read-only, skipped when absent.
//   • a second producer for both anchor modes: every node tested against every slot in exact fractions
//   • partitioned anchors: Partitions' own cut (the live PartitionsBlocks/PartitionsDistribution, run in a VM), G and
//     G ± 1, Bjorklund's spread up to a turn (chunk-timeline.js `euclid`, and one written here), anchors on grid ticks,
//     PARTITIONS.md's worked examples, a finer grid when P passes the grid, a given order of pulses
//   • windows: never overlapping, the midpoint to the slot it follows, every node in some slot at swing 0.5, about
//     `moments` onsets a slot at the row's density
//   node Composer/tests/assert-cells.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildRow } from '../core/row.js';
import { buildCells, partitionSizes, euclidPattern, swingForMoments, phaseAtTick, describeCells, SWING_DEN, COMPOSER_CELLS_VERSION } from '../core/cells.js';
import { RHYTHMS, OVERWORLD_RUNTIME } from './rhythms.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const necklace = (a) => { let best = null; for (let s = 0; s < a.length; s++) { const r = [...a.slice(s), ...a.slice(0, s)].join(','); if (best === null || r < best) best = r; } return best; };
let seed = 20261021;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

console.log(`Composer cells — ${RHYTHMS.length} rhythms`);

// ── a second producer: every node against every slot, in exact fractions ──────────────────────────────────────────
// A position is a fraction [n, d] (BigInt) of the cycle. Slot k's anchor A_k; a node's offset is its position − A_k
// brought into (−1/2, 1/2]; it is inside when |offset| ≤ swing × the distance to the neighbouring anchor on its side,
// strictly before the anchor at swing 1/2 (a node exactly midway goes to the slot it follows).
const B = BigInt;
const fr = (n, d) => { n = B(n); d = B(d); const g = ((a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; })(n, d) || 1n; return [n / g, d / g]; };
const sub = ([a, b], [c, d]) => fr(a * d - c * b, b * d), add = ([a, b], [c, d]) => fr(a * d + c * b, b * d);
const cmp = ([a, b], [c, d]) => { const l = a * d, r = c * b; return l < r ? -1 : l > r ? 1 : 0; };
const absF = ([a, b]) => [a < 0n ? -a : a, b], half = [1n, 2n];
const wrap = (f) => { let [n, d] = f; n %= d; if (n < 0n) n += d; let g = [n, d]; if (cmp(g, half) > 0) g = sub(g, [1n, 1n]); return g; };
const around = (f) => { const [n, d] = f; let r = n % d; if (r < 0n) r += d; return [r, d]; };   // into [0, 1)
function bruteCells(row, { P, slotsPerBar, mode, phase, swing: [sn, sd], sizes }) {
  const sw = fr(sn, sd), atHalf = 2 * sn === sd;
  let anchors;
  if (mode === 'even') anchors = Array.from({ length: P }, (_, k) => around(add(fr(phase[0], phase[1]), fr(k, P))));
  else {
    const T = sizes.reduce((a, b) => a + b, 0); let cum = 0; anchors = [];
    for (let k = 0; k < P; k++) { anchors.push(around(add(fr(phase[0], phase[1]), fr(cum, T)))); cum += sizes[k]; }
  }
  const mul = ([a, b], [c, d]) => fr(a * c, b * d);
  return anchors.map((A, k) => {
    const gapTo = (from, to) => { const g = around(sub(to, from)); return g[0] === 0n ? [1n, 1n] : g; };
    const dNext = P === 1 ? [1n, 1n] : gapTo(A, anchors[(k + 1) % P]), dPrev = P === 1 ? [1n, 1n] : gapTo(anchors[(k + P - 1) % P], A);
    const nodes = [];
    for (let i = 0; i < row.n; i++) {
      const off = wrap(sub(fr(row.tick[i], row.grid), A)), a = absF(off), neg = off[0] < 0n;
      const reach = mul(sw, neg ? dPrev : dNext), c = cmp(a, reach);
      if (off[0] === 0n || c < 0 || (c === 0 && !(neg && atHalf))) nodes.push({ i, off, a, neg });
    }
    const nearer = (p, q) => { const c = cmp(p.a, q.a); if (c) return c < 0; if (p.neg !== q.neg) return p.neg; return p.i < q.i; };
    const byTone = new Map();
    for (const n of nodes) {
      const t = row.tone[n.i];
      if (!byTone.has(t)) byTone.set(t, { tone: t, count: 0, strikes: 0, octaves: new Set(), near: n });
      const e = byTone.get(t); e.count++; e.strikes += row.strikes[n.i]; e.octaves.add(row.octave[n.i]); if (nearer(n, e.near)) e.near = n;
    }
    const tones = [...byTone.values()].sort((p, q) => (nearer(p.near, q.near) ? -1 : 1))
      .map((e) => ({ tone: e.tone, count: e.count, strikes: e.strikes, octaves: [...e.octaves].sort((x, y) => x - y), node: e.near.i }));
    return { at: A.map(Number).join('/'), bar: Math.floor(k / slotsPerBar), beat: k % slotsPerBar, nodes: nodes.length, members: nodes.map((n) => n.i), tones };
  });
}
const shapeOf = (cells) => cells.slots.map((s) => ({ at: s.at.join('/'), bar: s.bar, beat: s.beat, nodes: s.nodes, tones: s.tones.map(({ offset, ...t }) => t) }));
const bruteShape = (b) => b.map(({ members, ...s }) => s);
const firstDiff = (a, b) => { const A = JSON.stringify(a), Bs = JSON.stringify(b); let i = 0; while (i < A.length && A[i] === Bs[i]) i++; return `…${A.slice(Math.max(0, i - 60), i + 60)} ≠ …${Bs.slice(Math.max(0, i - 60), i + 60)}`; };

console.log('\n— a second producer, exact fractions, both anchor modes');
{
  let runs = 0, bad = '';
  for (const layers of RHYTHMS) {
    const row = buildRow(layers);
    if (row.n > 1600) continue;
    const meters = [[1, 1], [1, 3], [2, 4], [2, 8], [4, 8], [3, 5]];
    for (const [bars, S] of meters) for (const mode of ['even', 'partitioned']) {
      const P = bars * S, t = Math.floor(rnd() * row.grid), phases = [[0, 1], phaseAtTick(row, t), [2 * t + 1, 2 * row.grid], [1 + Math.floor(rnd() * 6), 7]];
      for (const phase of phases) {
        if (phase[0] >= phase[1]) continue;
        for (const swing of [0, 0.1, 0.18, 0.37, 0.5, null]) {
          const cells = buildCells(row, { bars, slotsPerBar: S, anchors: mode, phase, ...(swing == null ? {} : { swing }) });
          const b = bruteCells(row, { P, slotsPerBar: S, mode, phase, swing: swing == null ? swingForMoments(row, P) : [Math.round(swing * SWING_DEN), SWING_DEN], sizes: cells.pulses?.sizes });
          runs++;
          if (JSON.stringify(shapeOf(cells)) !== JSON.stringify(bruteShape(b))) { bad = `${layers} ${bars}×${S} ${mode} phase ${phase} swing ${swing}: ${firstDiff(shapeOf(cells), bruteShape(b))}`; break; }
          const slotOf = new Int32Array(row.n).fill(-1); b.forEach((s, k) => s.members.forEach((i) => { slotOf[i] = k; }));
          if (slotOf.join() !== cells.slotOfNode.join()) { bad = `${layers} ${mode}: slotOfNode`; break; }
          for (const s of cells.slots) for (const tn of s.tones) {
            let d = row.x[tn.node] - s.anchor; if (d > 0.5) d -= 1; else if (d <= -0.5) d += 1;
            if (Math.abs(d - tn.offset) > 1e-12) { bad = `${layers}: offset ${tn.offset} vs ${d}`; break; }
          }
        }
        if (bad) break;
      }
      if (bad) break;
    }
    if (bad) break;
  }
  check(`${runs} cuts (rows ≤ 1600 onsets × 6 meters × 2 modes × 4 phases × 6 swings): slots, tones, nearest nodes, slotOfNode, offsets`, !bad, bad);
}

// ── partitioned anchors ────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n— partitioned anchors');
{
  // the live Partitions code, run in a VM as the page runs it
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  for (const f of ['PartitionsDistribution.js', 'PartitionsBlocks.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'Playback', 'Partitions', f), 'utf8'), ctx, { filename: f });
  const live = ctx.window.PartitionsBlocks, liveDist = ctx.window.PartitionsDistribution;
  check('the live Partitions classes load', typeof live?.calculatePartitionSizes === 'function' && typeof liveDist?.generateEuclideanPattern === 'function');
  let bad = '';
  for (let T = 1; T <= 240 && !bad; T++) for (let P = 1; P <= Math.min(T, 48); P++) {
    const mine = partitionSizes(T, P), theirs = live.calculatePartitionSizes(T, P);
    if (mine.sizes.join() !== theirs.sizes.join() || (P > 1 && mine.G !== theirs.baseSize)) { bad = `${T}/${P}: ${mine.sizes} vs ${theirs.sizes}`; break; }
    if (euclidPattern(T, P).join() !== liveDist.generateEuclideanPattern(T, P).join()) { bad = `pattern ${T},${P}`; break; }
  }
  for (const [T, P] of [[948892238557, 32], [14280, 37], [302400, 64], [1e9 + 7, 24]]) {
    if (partitionSizes(T, P).sizes.join() !== live.calculatePartitionSizes(T, P).sizes.join()) bad = `${T}/${P}`;
  }
  check('the cut is Partitions\' own, block for block (T ≤ 240 × P ≤ 48, and four large grids)', !bad, bad);

  bad = '';
  let tl = null;
  const tlFile = path.join(OVERWORLD_RUNTIME, 'chunk-timeline.js');
  if (fs.existsSync(tlFile)) tl = await import(pathToFileURL(tlFile).href);
  const bjorklund = (k, n) => {   // onsets k in n steps, by pairing groups (written here, sharing nothing)
    let a = Array.from({ length: k }, () => [1]), b = Array.from({ length: n - k }, () => [0]);
    while (b.length > 1) { const m = Math.min(a.length, b.length); const na = a.slice(0, m).map((x, i) => x.concat(b[i])), rest = a.length > m ? a.slice(m) : b.slice(m); a = na; b = rest; }
    const bits = a.concat(b).flat(), out = []; let run = 0;
    for (let i = 0; i < bits.length; i++) { if (bits[i] && i) { out.push(run); run = 0; } run++; } out.push(run);
    return out;
  };
  for (let T = 2; T <= 200 && !bad; T++) for (let P = 1; P <= Math.min(T, 40); P++) {
    const { sizes, G, R, delta } = partitionSizes(T, P), lo = Math.min(...sizes), hi = Math.max(...sizes);
    if (sizes.reduce((a, b) => a + b, 0) !== T || sizes.length !== P) { bad = `${T}/${P}: sum`; break; }
    if (hi - lo > 1 || sizes.filter((s) => s !== G).length !== R || (R && !sizes.every((s) => s === G || s === G + delta))) { bad = `${T}/${P}: G ${G} R ${R}`; break; }
    if (Math.abs(P * G - T) > Math.abs(P * (G + 1) - T) || Math.abs(P * G - T) > Math.abs(P * (G - 1) - T)) { bad = `${T}/${P}: G not nearest`; break; }
    if (necklace(sizes) !== necklace(bjorklund(P, T))) { bad = `${T}/${P}: ${sizes} is not Bjorklund's ${bjorklund(P, T)} turned`; break; }
    if (tl && necklace(sizes) !== necklace(tl.euclid(P, T))) { bad = `${T}/${P}: not chunk-timeline's euclid turned`; break; }
  }
  check(`sizes are G and G ± 1, G nearest, R off by one, Bjorklund's spread up to a turn${tl ? ' (and chunk-timeline.js euclid)' : ' (chunk-timeline.js absent: skipped that one)'}`, !bad, bad);

  const ex1 = partitionSizes(60, 7), ex2 = partitionSizes(55, 9), ex3 = partitionSizes(55, 7);
  check('PARTITIONS.md: 7 of 60 is G 9, R 3 contracted (4 nines, 3 eights) — 9 8 9 8 9 8 9',
    ex1.G === 9 && ex1.R === 3 && ex1.delta === -1 && ex1.sizes.filter((s) => s === 9).length === 4 && necklace(ex1.sizes) === necklace([9, 8, 9, 8, 9, 8, 9]), ex1.sizes.join(' '));
  check('PARTITIONS.md: on 11:5\'s 55, nine is 6s with one 7, seven is 8s with one 7',
    ex2.sizes.filter((s) => s === 7).length === 1 && ex2.sizes.filter((s) => s === 6).length === 8 && ex3.sizes.filter((s) => s === 7).length === 1 && ex3.sizes.filter((s) => s === 8).length === 6);

  const row = buildRow([11, 9, 7, 5]), cells = buildCells(row, { bars: 2, slotsPerBar: 8, anchors: 'partitioned' });
  check('11:9:7:5 in 2 × 8 partitioned: every anchor a whole tick of grid 3465', cells.slots.every((s) => Number.isInteger(s.tick) && row.grid % s.at[1] === 0) && cells.pulses.subdivide === 1,
    cells.slots.map((s) => s.at.join('/')).join(' '));
  check('…and the anchors step by the pulse sizes', cells.slots.every((s, k) => k === 0 || s.tick - cells.slots[k - 1].tick === cells.pulses.sizes[k - 1]) && cells.pulses.sizes.reduce((a, b) => a + b, 0) === row.grid);
  const ph = phaseAtTick(row, 100), shifted = buildCells(row, { bars: 2, slotsPerBar: 8, anchors: 'partitioned', phase: ph });
  check('a phase at tick 100 moves every anchor by 100 ticks', shifted.slots.every((s, k) => s.tick === (cells.slots[k].tick + 100) % row.grid));
  const small = buildRow([3, 2]), fine = buildCells(small, { bars: 2, slotsPerBar: 8, anchors: 'partitioned', swing: 0.5 });
  check('3:2 (grid 6) in 16 pulses: cut on a grid 3 times finer (18), pulses of 1 and 2', fine.pulses.subdivide === 3 && fine.pulses.T === 18 && fine.pulses.sizes.every((s) => s === 1 || s === 2) && fine.slots.reduce((n, s) => n + s.nodes, 0) === small.n);
  const given = [5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3, 5, 3].map((s) => s * 3465 / 64);
  check('a given order of pulses must fill the cycle in whole ticks', throws(() => buildCells(row, { bars: 2, slotsPerBar: 8, anchors: 'partitioned', sizes: given }), /whole numbers|sum/));
  const order = cells.pulses.sizes.slice().reverse(), dragged = buildCells(row, { bars: 2, slotsPerBar: 8, anchors: 'partitioned', sizes: order });
  check('a given order (the pulses reversed, as if dragged) is used as given', dragged.pulses.given && dragged.pulses.sizes.join() === order.join() && dragged.slots[1].tick === order[0]);
  check('bad modes and meters throw', throws(() => buildCells(row, { bars: 2, slotsPerBar: 8, anchors: 'odd' }), /anchors must be/) && throws(() => buildCells(row, { bars: 0, slotsPerBar: 8 }), /bad meter/) && throws(() => buildCells(row, { bars: 1, slotsPerBar: 4, phase: [3, 2] }), /bad phase/));
  check('a refused row is not cut', throws(() => buildCells(buildRow([1048576, 3]), { bars: 1, slotsPerBar: 4 }), /built row/));
  check('partitionSizes refuses more pulses than ticks', throws(() => partitionSizes(6, 7), /cannot cut/));
}

// ── windows ────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n— windows');
{
  const four = buildRow([4]);   // ticks 0 1 2 3 of grid 4
  const e = buildCells(four, { bars: 1, slotsPerBar: 2, swing: 0.5 }), p = buildCells(four, { bars: 1, slotsPerBar: 2, anchors: 'partitioned', swing: 0.5 });
  check('a node midway goes to the slot it follows (grid 4, anchors 0 and 2: nodes 0 1 | 2 3)', e.slotOfNode.join() === '0,0,1,1' && p.slotOfNode.join() === '0,0,1,1', `${e.slotOfNode} ${p.slotOfNode}`);
  const three = buildCells(four, { bars: 1, slotsPerBar: 3, anchors: 'partitioned', swing: 0.5 });
  check('unequal pulses (grid 4 in 3): each side reaches halfway to its own neighbour at swing 0.5, and every node is a slot\'s',
    three.slots.every((s, k) => Math.abs(s.reach[1] - s.length / 2) < 1e-15 && Math.abs(three.slots[(k + 1) % 3].reach[0] - s.length / 2) < 1e-15) && three.slotOfNode.every((k) => k >= 0),
    JSON.stringify(three.slots.map((s) => [s.tick, s.reach, s.length])) + ' ' + three.slotOfNode.join());
  let bad = '';
  for (const layers of RHYTHMS) {
    const row = buildRow(layers);
    for (const mode of ['even', 'partitioned']) {
      const c = buildCells(row, { bars: 2, slotsPerBar: 8, anchors: mode, swing: 0.5 });
      const total = c.slots.reduce((n, s) => n + s.nodes, 0);
      if (total !== row.n || [...c.slotOfNode].some((k) => k < 0)) bad = `${layers} ${mode}: ${total} of ${row.n}`;
      const t = buildCells(row, { bars: 2, slotsPerBar: 8, anchors: mode, swing: 0.2 });
      if (t.slots.reduce((n, s) => n + s.nodes, 0) !== [...t.slotOfNode].filter((k) => k >= 0).length) bad = `${layers} ${mode}: a node in two slots`;
    }
  }
  check('at swing 0.5 every node is in exactly one slot; at 0.2 none is in two (both modes, every rhythm)', !bad, bad);

  bad = '';
  const densities = [];
  for (const layers of RHYTHMS) {
    const row = buildRow(layers);
    if (row.n < 1000) continue;
    for (const moments of [6, 12, 24]) {
      const c = buildCells(row, { bars: 4, slotsPerBar: 8, moments });
      const [sn, sd] = swingForMoments(row, 32, moments); if (c.swingExact.join() !== [sn, sd].join() || Math.abs(c.swing - Math.min(0.5, moments * 32 / (2 * row.n))) > 1e-15 || c.moments !== moments) bad = `${layers}: swing`;
      const mean = c.slots.reduce((n, s) => n + s.nodes, 0) / c.P;
      densities.push(mean / moments);
      if (mean < 0.6 * moments || mean > 1.4 * moments) bad = `${layers}: ${mean.toFixed(1)} onsets a slot for moments ${moments}`;
    }
  }
  check(`windows sized in onsets: rows of 1000+ onsets hold about \`moments\` a slot (mean ${(densities.reduce((a, b) => a + b, 0) / densities.length).toFixed(2)} × moments over ${densities.length} cuts)`, !bad && densities.length >= 15, bad);
  {
    const t0 = Date.now(), big = buildRow([700001, 300007]), built = Date.now() - t0;   // ~10^6 onsets
    const t1 = Date.now(), c = buildCells(big, { bars: 4, slotsPerBar: 8, moments: 12 }), cut = Date.now() - t1;
    const mean = c.slots.reduce((n, s) => n + s.nodes, 0) / c.P;
    check(`no drift at 10^6 onsets (the probe's rounded window drifted there): ${mean.toFixed(2)} onsets a slot for moments 12 (row ${built} ms, cut ${cut} ms)`, big.n === 1000007 && mean > 11 && mean < 13 && c.swing === 12 * 32 / (2 * big.n), `${mean} ${c.swingExact}`);
  }
  const r = buildRow([8, 7, 6, 5]);
  check('a small row: the onset window clamps at swing 0.5', buildCells(r, { bars: 2, slotsPerBar: 8 }).swing === 0.5);
  const a = buildCells(r, { bars: 2, slotsPerBar: 4, anchors: 'partitioned' }), b = buildCells(r, { bars: 2, slotsPerBar: 4, anchors: 'partitioned' });
  check('deterministic: the same cut twice is the same', JSON.stringify({ ...a, slotOfNode: [...a.slotOfNode] }) === JSON.stringify({ ...b, slotOfNode: [...b.slotOfNode] }));
  check('slots carry bar and beat', a.slots.map((s) => `${s.bar}.${s.beat}`).join(' ') === '0.0 0.1 0.2 0.3 1.0 1.1 1.2 1.3');
  check('describeCells', describeCells(a).meter === '2 × 4' && describeCells(a).covered === 22 && a.version === COMPOSER_CELLS_VERSION);
}

// ── Overworld parity ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n— Overworld parity (chunk-super-row.js slotCandidates, chunk-lines.js buildLattice)');
const superRowFile = path.join(OVERWORLD_RUNTIME, 'chunk-super-row.js'), linesFile = path.join(OVERWORLD_RUNTIME, 'chunk-lines.js');
if (!fs.existsSync(superRowFile) || !fs.existsSync(linesFile)) {
  console.log(`  – skipped: ${OVERWORLD_RUNTIME} is not on this machine`);
} else {
  const ow = await import(pathToFileURL(superRowFile).href), lines = await import(pathToFileURL(linesFile).href);
  // Overworld keys a tone by the kernel's spelling (row.js `toneLabels`); where two exact tones share one, it holds
  // them as one tone, so mine are merged by spelling before comparing.
  const mergeBySpelling = (row, slot) => {
    const byLabel = new Map();
    for (const t of slot.tones) {
      const label = row.toneLabels[t.tone];
      if (!byLabel.has(label)) { byLabel.set(label, { ...t, label, octaves: [...t.octaves] }); continue; }
      const e = byLabel.get(label); e.count += t.count; e.strikes += t.strikes; e.octaves = [...new Set([...e.octaves, ...t.octaves])];
    }
    return [...byLabel.values()];
  };
  let merged = 0, runs = 0;
  for (const layers of RHYTHMS) {
    const row = buildRow(layers), o = ow.buildNormalizedRow([{ layers: layers.filter((v) => v > 0).sort((a, b) => a - b) }]);
    if (new Set(row.toneLabels).size !== row.tones.length) merged++;
    const t = Math.floor(rnd() * row.grid), phases = [[0, 1], [1, 3], phaseAtTick(row, row.tick[Math.floor(rnd() * row.n)]), [2 * t + 1, 2 * row.grid]];
    let bad = '';
    for (const [bars, S] of [[1, 1], [1, 4], [2, 8], [4, 8], [3, 7]]) for (const phase of phases) for (const swing of [0, 0.1, 0.18, 0.5]) {
      if (bad || phase[0] >= phase[1]) continue;
      const P = bars * S, theirs = ow.slotCandidates(o, { P, phase, swing }), mine = buildCells(row, { bars, slotsPerBar: S, phase, swing });
      runs++;
      if (theirs.swing !== mine.swing || Math.abs(theirs.window - mine.window) > 1e-15 || theirs.slots.length !== mine.slots.length) { bad = `${bars}×${S} ${phase} ${swing}: header`; continue; }
      for (let k = 0; k < P && !bad; k++) {
        const ts = theirs.slots[k], ms = mine.slots[k];
        if (Math.abs(ts.anchor - ms.anchor) > 1e-15 || ts.nodes !== ms.nodes) { bad = `slot ${k}: anchor ${ts.anchor}/${ms.anchor} nodes ${ts.nodes}/${ms.nodes}`; break; }
        const mt = mergeBySpelling(row, ms);
        if (mt.length !== ts.tones.length) { bad = `slot ${k}: ${ts.tones.length} tones vs ${mt.length}`; break; }
        for (let j = 0; j < mt.length; j++) {
          const a = ts.tones[j], b = mt[j], mask = b.octaves.reduce((m, oc) => m | (1 << oc), 0);
          if (o.tones[a.tone] !== b.label || a.count !== b.count || a.strikes !== b.strikes || a.octaves !== mask || o.num[a.node] !== row.tick[b.node] || Math.abs(a.offset - b.offset) > 1e-12) {
            bad = `${bars}×${S} phase ${phase} swing ${swing} slot ${k} tone ${j}: ${JSON.stringify({ f: o.tones[a.tone], c: a.count, s: a.strikes, o: a.octaves, t: o.num[a.node], d: a.offset })} vs ${JSON.stringify({ f: b.label, c: b.count, s: b.strikes, o: mask, t: row.tick[b.node], d: b.offset })}`;
            break;
          }
        }
      }
    }
    // the window sized in onsets, as buildLattice sizes it (one moment per onset on a single rhythm's row)
    for (const [bars, S] of [[2, 4], [2, 8], [4, 8]]) for (const moments of [6, 12]) {
      if (bad) break;
      const frame = lines.bestFrames(o, 25)[0], phase = [0, 1];
      // chunk-lines rounds the onset-sized swing to 1/10000 (and floors it at 1e-4); ours is exact, so the strikes are
      // compared at its swing, and ours is checked to round to it
      const lat = lines.buildLattice(o, { bars, slotsPerBar: S, phase, moments, frame }), exact = buildCells(row, { bars, slotsPerBar: S, phase, moments }), mine = buildCells(row, { bars, slotsPerBar: S, phase, swing: lat.swing });
      if (lat.swing !== Math.min(0.5, Math.max(1e-4, Math.round(exact.swing * 1e4) / 1e4))) bad = `lattice swing ${lat.swing} vs ${exact.swing}`;
      else if (lat.slots.map((s) => s.strikes).join() !== mine.slots.map((s) => s.strikes).join()) bad = 'lattice strikes';
      else if (lat.slots.some((s, k) => Math.abs(s.anchor - mine.slots[k].anchor) > 1e-15)) bad = 'lattice anchors';
    }
    check(`${layers.join(':')} (${row.n} onsets)`, !bad, bad);
  }
  console.log(`  (${runs} slotCandidates cuts; ${merged} of ${RHYTHMS.length} rhythms have two tones the kernel spells alike, merged to compare)`);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
