// assert-row.mjs — Composer/core/row.js. Exit non-zero on any mismatch.
//   • OVERWORLD PARITY: on 50 rhythms (Composer/tests/rhythms.mjs), the row equals chunk-super-row.js's normalized row
//     of that one rhythm — ticks, gaps, registers, struck layers, strikes per moment, and each node's tone as the
//     kernel spells it (settle-location.js) — imported read-only from the Overworld checkout, skipped when it is absent
//   • a second producer: the rhythm walked tick by tick, each tone the reduced fraction longest gap / gap
//   • the onset count from the layers alone, against the built row
//   • the gate: a row over it is refused as { tooDense, onsets, gate }; a grid past 2^53 as { tooLarge }
//   • the site's spelling: the fast path is the loop, and where it rounds, two tones may share a spelling
//   node Composer/tests/assert-row.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRow, onsetCount, siteFraction, fractionCents, nodeAt, isRow, lowerBoundTick, toneGate, ONSET_GATE, MIN_TONES, COMPOSER_ROW_VERSION } from '../core/row.js';
import { RHYTHMS, OVERWORLD_RUNTIME, lcmOf } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; };

console.log(`Composer row — ${RHYTHMS.length} rhythms`);

// ── a second producer, tick by tick ────────────────────────────────────────────────────────────────────────────────
function brute(layers) {
  const vals = layers.map((v, i) => ({ v, i })).filter((l) => l.v > 0), grid = lcmOf(layers), nodes = [];
  for (let t = 0; t < grid; t++) {
    let mask = 0; for (const { v, i } of vals) if ((t * v) % grid === 0) mask |= 1 << i;
    if (mask) nodes.push({ t, mask });
  }
  nodes.forEach((n, k) => { n.gap = (k + 1 < nodes.length ? nodes[k + 1].t : grid + nodes[0].t) - n.t; });
  const longest = Math.max(...nodes.map((n) => n.gap));
  for (const n of nodes) {
    let num = longest, den = n.gap, octave = 0;
    while (num >= 2 * den) { den *= 2; octave++; }
    const g = gcd(num, den); n.fraction = `${num / g}/${den / g}`; n.octave = octave;
  }
  return { grid, nodes };
}

console.log('\n— a second producer (grids ≤ 2·10^6)');
for (const layers of RHYTHMS) {
  if (lcmOf(layers) > 2e6) continue;
  const row = buildRow(layers), b = brute(layers);
  let bad = '';
  if (row.grid !== b.grid || row.n !== b.nodes.length) bad = `grid ${row.grid}/${b.grid}, n ${row.n}/${b.nodes.length}`;
  else for (let i = 0; i < row.n && !bad; i++) {
    const n = b.nodes[i];
    if (row.tick[i] !== n.t || row.gap[i] !== n.gap || row.owners[i] !== n.mask || row.octave[i] !== n.octave || row.tones[row.tone[i]] !== n.fraction) bad = `node ${i}: ${JSON.stringify(nodeAt(row, i))} vs ${JSON.stringify(n)}`;
    if (row.strikes[i] !== popcount(n.mask)) bad = `strikes at ${i}`;
  }
  check(`${layers.join(':')} (grid ${row.grid}, ${row.n} onsets, ${row.tones.length} tones)`, !bad, bad);
}

// ── tones and their order ──────────────────────────────────────────────────────────────────────────────────────────
console.log('\n— tones');
{
  let bad = '';
  for (const layers of RHYTHMS) {
    const row = buildRow(layers), T = row.tones.length, counts = new Uint32Array(T);
    for (let i = 0; i < row.n; i++) counts[row.tone[i]]++;
    for (let t = 0; t < T && !bad; t++) {
      if (counts[t] !== row.toneCount[t] || !counts[t]) bad = `${layers}: count of ${row.tones[t]}`;
      if (row.tone[row.toneFirst[t]] !== t || [...row.tone.slice(0, row.toneFirst[t])].includes(t)) bad = `${layers}: first of ${row.tones[t]}`;
      if (Math.abs(row.toneCents[t] - fractionCents(row.tones[t])) > 1e-9) bad = `${layers}: cents of ${row.tones[t]}`;
      if (t && !(row.toneCents[t] > row.toneCents[t - 1] || (row.toneCents[t] === row.toneCents[t - 1] && row.tones[t] > row.tones[t - 1]))) bad = `${layers}: order at ${t}`;
      const [n, d] = row.tones[t].split('/').map(Number);
      if (!(n >= d && n < 2 * d && gcd(n, d) === 1)) bad = `${layers}: ${row.tones[t]} is not reduced in [1, 2)`;
    }
    if (row.tones[row.tone[row.gap.indexOf(row.longest)]] !== '1/1') bad = `${layers}: the longest gap is not 1/1`;
  }
  check('counts, first nodes, cents, order (by cents, then spelling), every tone reduced in [1/1, 2/1), the longest gap 1/1', !bad, bad);
  const a = buildRow([8, 7, 6, 5]), b = buildRow([5, 6, 7, 8]);
  check('layer order: 5:6:7:8 has the ticks and tones of 8:7:6:5', a.tick.join() === b.tick.join() && a.tones.join() === b.tones.join() && a.tone.join() === b.tone.join());
  check('layer order: A is layers[0] (bit 0) as the LRC names it', a.owners[1] === 0b0001 && b.owners[1] === 0b1000 && nodeAt(a, 1).struck[0].name === 'A' && nodeAt(b, 1).struck[0].name === 'D',
    `${a.owners[1]} ${b.owners[1]}`);
  const z = buildRow([0, 7, 0, 3]);
  check('an absent layer (0) keeps the others in place: 0:7:0:3 strikes B and D', z.active.join() === '1,3' && z.owners[0] === 0b1010 && z.layers.join() === '0,7,0,3');
  const r = buildRow([3, 2]);
  check('3:2 by hand: ticks 0 2 3 4, every gap an octave of 1/1', r.tick.join() === '0,2,3,4' && r.gap.join() === '2,1,1,2' && r.tones.join() === '1/1' && r.octave.join() === '0,1,1,0',
    `${r.tick.join()} | ${r.gap.join()} | ${r.tones.join()} | ${r.octave.join()}`);
  const e = buildRow([8, 7, 6, 5]);
  check('8:7:6:5: 22 onsets, 7 tones from 1/1 to 15/8', e.n === 22 && e.tones.join(' ') === '1/1 35/32 5/4 21/16 3/2 7/4 15/8', e.tones.join(' '));
  check('lowerBoundTick', lowerBoundTick(e, 0) === 0 && lowerBoundTick(e, 1) === 1 && lowerBoundTick(e, e.grid) === e.n && e.tick[lowerBoundTick(e, 200)] >= 200 && e.tick[lowerBoundTick(e, 200) - 1] < 200);
}

// ── the onset count and the gate ───────────────────────────────────────────────────────────────────────────────────
console.log('\n— onset count and gate');
{
  let bad = '';
  for (const layers of RHYTHMS) { const row = buildRow(layers); if (onsetCount(layers) !== row.n) bad = `${layers}: ${onsetCount(layers)} vs ${row.n}`; }
  for (let a = 1; a <= 14 && !bad; a++) for (let b = 1; b <= 14; b++) for (let c = 0; c <= 14; c += 2) for (let d = 0; d <= 14; d += 3) {
    const l = [a, b, c, d], n = onsetCount(l);
    if (lcmOf(l) <= 2e5 && n !== brute(l).nodes.length) { bad = `${l}: ${n}`; break; }
  }
  check('the count from the layers alone equals the built row, and a tick walk over 14·14·8·5 small rhythms', !bad, bad);
  check(`the default gate is the probe's 2^20 (${ONSET_GATE})`, ONSET_GATE === 1048576);
  const dense = [1048576, 3];   // 1048576 + 3 − gcd 1 = 1048578 onsets
  const refused = buildRow(dense);
  check('over the gate: { tooDense, onsets, gate }, no row', refused.tooDense === true && refused.onsets === 1048578 && refused.gate === 1048576 && !isRow(refused) && Object.keys(refused).length === 3, JSON.stringify(refused));
  const t0 = Date.now(), at = buildRow([1048576, 2]), took = Date.now() - t0;   // gcd 2: exactly 2^20 onsets
  check(`at the gate exactly: built (2^20 onsets in ${took} ms)`, isRow(at) && at.n === 1048576 && at.tones.length === 1);
  check('a raised gate builds it', isRow(buildRow(dense, { gate: 1100000 })) && buildRow(dense, { gate: 1100000 }).n === 1048578);
  check('a lowered gate refuses 8:7:6:5 (22 onsets) at 21 and builds it at 22', buildRow([8, 7, 6, 5], { gate: 21 }).tooDense === true && isRow(buildRow([8, 7, 6, 5], { gate: 22 })));
  const huge = buildRow([999983, 999979, 999961, 999959], { gate: Infinity });
  check('a grid past 2^53, past the gate: { tooLarge, grid, limit }', huge.tooLarge === true && huge.grid === (999983n * 999979n * 999961n * 999959n).toString() && huge.limit === Number.MAX_SAFE_INTEGER, JSON.stringify(huge));
  const inside = buildRow([10007, 10009, 10037, 10039]);
  check('a grid past 2^53 INSIDE the gate (four coprime layers near 10^4, 40,089 onsets): tooLarge', inside.tooLarge === true && onsetCount([10007, 10009, 10037, 10039]) === 40089, JSON.stringify(inside));
  check('the gate refuses before it allocates: 4 layers near 10^6 at the default gate is a quick tooDense', (() => { const t = Date.now(), r = buildRow([999983, 999979, 999961, 999959]); return r.tooDense && r.onsets === 999983 + 999979 + 999961 + 999959 - 6 + 4 - 1 && Date.now() - t < 50; })());
  const big = buildRow([997, 991, 983, 977]);
  check('a grid past 2^25 builds (997:991:983:977, grid 948892238557): ticks exact as doubles', isRow(big) && big.grid === 948892238557 && big.tick[big.n - 1] < big.grid && big.n === 3945 && Number.isSafeInteger(big.tick[big.n - 1]));
  check('bad layers throw', throws(() => buildRow([]), /no layers/) && throws(() => buildRow([0, 0]), /no layers/) && throws(() => buildRow([3, 2.5]), /positive whole/) && throws(() => buildRow([3, -2]), /positive whole/) && throws(() => buildRow([1, 2, 3, 4, 5]), /at most 4/));
  check(`toneGate: under ${MIN_TONES} distinct tones is { tooFewTones } (3:2 has 1, 8:7:6:5 has 7)`, JSON.stringify(toneGate(buildRow([3, 2]))) === JSON.stringify({ tooFewTones: true, tones: 1, min: 3 }) && toneGate(buildRow([8, 7, 6, 5])) === null && toneGate(buildRow([3, 2]), 1) === null);
  check('bad gate throws', throws(() => buildRow([3, 2], { gate: 0 }), /bad gate/));
}

// ── the site's spelling ────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n— the site\'s spelling');
{
  let seed = 7, bad = '';
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let k = 0; k < 4000 && !bad; k++) {
    const d = 1 + Math.floor(rnd() * 1000), n = d + Math.floor(rnd() * d);
    if (siteFraction(n / d, [n, d]) !== siteFraction(n / d)) bad = `${n}/${d}`;
  }
  check('a denominator ≤ 1000: the fast path is the loop (4000 fractions)', !bad, bad);
  check('a ratio just under the octave reads 2/1, as on the site', siteFraction(1999999 / 1000000) === '2/1');
  const big = buildRow([512, 511, 509, 503]), labels = new Map();
  let merged = 0; for (const l of big.toneLabels) { if (labels.has(l)) merged++; labels.set(l, 1); }
  check(`512:511:509:503: ${big.tones.length} exact tones, ${big.tones.length - merged} spellings — exact keys keep apart what the spelling merges`, merged > 0 && new Set(big.tones).size === big.tones.length);
}

// ── Overworld parity ───────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n— Overworld parity (chunk-super-row.js normalized row of one rhythm)');
const superRowFile = path.join(OVERWORLD_RUNTIME, 'chunk-super-row.js');
if (!fs.existsSync(superRowFile)) {
  console.log(`  – skipped: ${superRowFile} is not on this machine`);
} else {
  const ow = await import(pathToFileURL(superRowFile).href);
  let rounded = 0;
  for (const layers of RHYTHMS) {
    const row = buildRow(layers), sorted = layers.filter((v) => v > 0).sort((a, b) => a - b);
    const o = ow.buildNormalizedRow([{ layers: sorted }]);
    let bad = '';
    if (o.n !== row.n || o.cycles[0].grid !== row.grid || o.moments.n !== row.n) bad = `n ${o.n}/${row.n}, grid ${o.cycles[0].grid}/${row.grid}`;
    for (let i = 0; i < row.n && !bad; i++) {
      const c = o.cycles[0], at = o.node[i];
      const theirs = sorted.filter((_, b) => o.owners[i] & (1 << b)).join(), mine = row.active.filter((b) => row.owners[i] & (1 << b)).map((b) => row.layers[b]).sort((p, q) => p - q).join();
      if (o.num[i] !== row.tick[i] || c.gap[at] !== row.gap[i] || o.octave[i] !== row.octave[i] || theirs !== mine) bad = `node ${i}`;
      else if (o.moments.strikes[o.moment[i]] !== row.strikes[i] || o.x[i] !== row.x[i]) bad = `node ${i}: strikes or x`;
      else if (o.tones[o.tone[i]] !== row.toneLabels[row.tone[i]]) bad = `node ${i}: ${o.tones[o.tone[i]]} vs ${row.toneLabels[row.tone[i]]}`;
      else if (Math.abs(o.toneCents[o.tone[i]] - row.toneCents[row.tone[i]]) > (row.tones[row.tone[i]] === row.toneLabels[row.tone[i]] ? 1e-9 : 2)) bad = `node ${i}: cents`;
    }
    if (row.tones.some((f, t) => f !== row.toneLabels[t])) rounded++;
    check(`${layers.join(':')} (${row.n} onsets)`, !bad, bad);
  }
  console.log(`  (${rounded} of ${RHYTHMS.length} rhythms have a tone the kernel spells by rounding, up to ~2¢ off; compared by that spelling)`);
}

check('version', buildRow([3, 2]).version === COMPOSER_ROW_VERSION);
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
