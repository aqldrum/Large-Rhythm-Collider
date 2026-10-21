// assert-frame.mjs — Composer/core/frame.js. Exit non-zero on any mismatch.
//   • 8:7:6:5 by hand: every tone's class, deviation and core/fringe at ±15¢ and ±30¢
//   • edges on a made-up row: the halfway tone goes up, ±frame is inclusive, the circle wraps at 1200¢
//   • the sweep (`frameOnsetsByRoot`) against a frame built on every root, and `defaultRoot` against a brute argmax
//   • the class report: every tone once, its counts, its order, and cheap on a 16k-onset row with 4,177 tones
//   • chunk-lines' frame of 25¢ total on the same edge holds the same tones as ±12.5¢ here (read-only, skipped if absent)
//   node Composer/tests/assert-frame.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRow } from '../core/row.js';
import { frameAt, frameOf, frameOnsetsByRoot, defaultRoot, rootPresence, classReport, toneIndexOf, DEFAULT_FRAME_CENTS_EACH_SIDE } from '../core/frame.js';
import { RHYTHMS, OVERWORLD_RUNTIME } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const mod = (v, n) => ((v % n) + n) % n;

console.log('Composer frame');

console.log('\n— 8:7:6:5 by hand, root 1/1');
{
  const row = buildRow([8, 7, 6, 5]);
  check('the default is ±15¢ each side (30¢ wide)', DEFAULT_FRAME_CENTS_EACH_SIDE === 15);
  // tone: class, deviation (cents from the class centre), inside at ±15, inside at ±30
  const want = {
    '1/1': [0, 0, 1, 1], '35/32': [2, 155.140 - 200, 0, 0], '5/4': [4, 386.314 - 400, 1, 1], '21/16': [5, 470.781 - 500, 0, 1],
    '3/2': [7, 701.955 - 700, 1, 1], '7/4': [10, 968.826 - 1000, 0, 0], '15/8': [11, 1088.269 - 1100, 1, 1],
  };
  const f15 = frameAt(row, '1/1'), f30 = frameAt(row, 0, 30);
  let bad = '';
  for (const [fraction, [pc, dev, in15, in30]] of Object.entries(want)) {
    const t = toneIndexOf(row, fraction);
    if (f15.pc[t] !== pc || !near(f15.dev[t], dev, 1e-3) || f15.inside[t] !== in15 || f30.inside[t] !== in30 || f30.pc[t] !== pc) bad = `${fraction}: pc ${f15.pc[t]} dev ${f15.dev[t]} in ${f15.inside[t]}/${f30.inside[t]}`;
  }
  check('classes, deviations, core at ±15 and ±30', !bad, bad);
  const onsets = (f) => row.tones.reduce((n, _, t) => n + (f.inside[t] ? row.toneCount[t] : 0), 0);
  check('frame.nodes counts the onsets on inside tones', f15.nodes === onsets(f15) && f30.nodes === onsets(f30) && f15.tonesInside === 4 && f30.tonesInside === 5, `${f15.nodes} ${f30.nodes}`);
  const on3 = frameAt(row, '3/2');
  check('root-centred: on 3/2, 1/1 is class 5 at −1.96¢ and 3/2 is class 0', on3.pc[toneIndexOf(row, '1/1')] === 5 && near(on3.dev[toneIndexOf(row, '1/1')], -1.955, 1e-3) && on3.pc[toneIndexOf(row, '3/2')] === 0 && on3.dev[toneIndexOf(row, '3/2')] === 0);
  check('frameAt names its knob', f15.frameCentsEachSide === 15 && f15.width === 30 && f15.rootFraction === '1/1' && f30.width === 60);
  check('bad roots and knobs throw', throws(() => frameAt(row, '9/8'), /not a tone/) && throws(() => frameAt(row, 99), /not a tone/) && throws(() => frameAt(row, 0, 51), /\[0, 50\]/) && throws(() => frameAt(row, 0, -1), /\[0, 50\]/));
}

console.log('\n— edges, on a made-up row');
{
  const fake = (cents, counts = cents.map(() => 1)) => ({ tones: cents.map((c, i) => `t${i}`), toneCents: Float64Array.from(cents), toneCount: Uint32Array.from(counts) });
  const row = fake([0, 50, 150, 15, 1185, 15.001, 1199.5, 649.999]);
  const f = frameAt(row, 0, 15);
  check('halfway goes up: 50¢ is class 1 at −50, 150¢ class 2 at −50', f.pc[1] === 1 && f.dev[1] === -50 && f.pc[2] === 2 && f.dev[2] === -50, `${f.pc[1]} ${f.dev[1]} ${f.pc[2]} ${f.dev[2]}`);
  check('±15 is inclusive both ways (15¢ and 1185¢ in, 15.001¢ out)', f.inside[3] === 1 && f.inside[4] === 1 && f.pc[4] === 0 && near(f.dev[4], -15) && f.inside[5] === 0);
  check('the circle wraps: 1199.5¢ is class 0 at −0.5', f.pc[6] === 0 && near(f.dev[6], -0.5) && f.inside[6] === 1);
  const g = frameAt(row, 1, 15);   // root at 50¢
  check('a root at 50¢: 0¢ is class 0 at −50 (halfway goes up from 11), 150¢ class 1', g.pc[0] === 0 && near(g.dev[0], -50) && g.pc[2] === 1 && g.dev[2] === 0, `${g.pc[0]} ${g.dev[0]}`);
  check('a knob of 0 holds only exact steps; 50 holds everything', frameAt(row, 0, 0).tonesInside === 1 && frameAt(row, 0, 50).tonesInside === row.tones.length);
}

console.log('\n— the sweep and the default root');
{
  const brute = (row, e) => row.tones.map((_, r) => frameAt(row, r, e).nodes);
  let bad = '';
  const fakes = [
    { tones: ['a', 'b', 'c', 'd', 'e'], toneCents: Float64Array.from([0, 99, 101, 1190, 612]), toneCount: Uint32Array.from([3, 5, 1, 2, 7]) },
    { tones: ['a', 'b', 'c'], toneCents: Float64Array.from([0, 30, 60]), toneCount: Uint32Array.from([1, 1, 1]) },
  ];
  for (const row of [...RHYTHMS.map((l) => buildRow(l)), ...fakes]) for (const e of [0, 5, 12.5, 15, 30, 49.9, 50]) {
    const sweep = frameOnsetsByRoot(row, e), b = brute(row, e);
    if (sweep.join() !== b.join()) { bad = `${row.tones.length} tones at ±${e}: ${[...sweep].slice(0, 8)} vs ${b.slice(0, 8)}`; break; }
  }
  check('the onsets in each root\'s frame, by sweep, equal a frame built on every root (52 rhythms + 2 made up × 7 knobs)', !bad, bad);
  bad = '';
  let fellBack = 0;
  for (const layers of RHYTHMS) {
    const row = buildRow(layers), held = brute(row, 15), need = Math.max(2, Math.ceil(row.n / 100));
    const pickFrom = (pool) => {
      let best = pool[0];
      for (const t of pool.slice(1)) {
        const key = (x) => [held[x], row.toneCount[x], row.tones[x] === '1/1' ? 1 : 0, -row.toneCents[x]];
        const a = key(t), b = key(best);
        for (let k = 0; k < 4; k++) { if (a[k] > b[k]) { best = t; break; } if (a[k] < b[k]) break; }
      }
      return best;
    };
    const all = row.tones.map((_, t) => t), heard = all.filter((t) => row.toneCount[t] >= need);
    const most = Math.max(...row.toneCount), half = all.filter((t) => row.toneCount[t] >= Math.max(2, Math.ceil(most / 2)));
    if (!heard.length) fellBack++;
    const best = pickFrom(heard.length ? heard : half.length ? half : all);
    if (defaultRoot(row) !== best || rootPresence(row) !== need) bad = `${layers}: ${row.tones[defaultRoot(row)]} vs ${row.tones[best]}`;
  }
  check(`defaultRoot: of the tones heard max(2, 1% of onsets) times, the most onsets in its frame, then the most heard, then 1/1, then the lowest (${fellBack} rhythms drop to half the most heard)`, !bad, bad);
  const r = buildRow([8, 7, 6, 5]);
  check('frameOf: a root given is kept; none given takes the default', frameOf(r, '3/2').rootFraction === '3/2' && frameOf(r).root === defaultRoot(r));
  const big = buildRow([4099, 4093, 4091, 4079]);
  const t0 = performance.now(), br = defaultRoot(big), t1 = performance.now();
  check(`a tone-rich row with no tone at 1%: the root is heard ${big.toneCount[br]} times (the most heard: 24), not twice`, big.toneCount[br] >= 12);
  check(`defaultRoot on 4,177 tones in ${(t1 - t0).toFixed(1)} ms (one sweep, not tones²)`, t1 - t0 < 100);
}

console.log('\n— the class report');
{
  let bad = '';
  for (const layers of RHYTHMS) for (const e of [12.5, 15, 30]) {
    const row = buildRow(layers), f = frameOf(row, null, e), rep = classReport(row, f);
    const seen = new Uint8Array(row.tones.length); let onsets = 0;
    for (const c of rep) {
      if (!near(c.centreCents, mod(f.rootCents + 100 * c.pc, 1200))) bad = 'centre';
      for (const [list, core] of [[c.core, 1], [c.fringe, 0]]) {
        let sum = 0;
        list.forEach((x, i) => {
          seen[x.tone]++; sum += x.onsets;
          if (f.inside[x.tone] !== core || f.pc[x.tone] !== c.pc || x.onsets !== row.toneCount[x.tone] || x.fraction !== row.tones[x.tone] || x.dev !== f.dev[x.tone]) bad = `${layers}: ${x.fraction}`;
          if (i && (list[i - 1].onsets < x.onsets || (list[i - 1].onsets === x.onsets && Math.abs(list[i - 1].dev) > Math.abs(x.dev)))) bad = `${layers}: order`;
        });
        if (sum !== (core ? c.coreOnsets : c.fringeOnsets)) bad = `${layers}: sums`;
      }
      onsets += c.coreOnsets + c.fringeOnsets;
    }
    if (rep.length !== 12 || onsets !== row.n || seen.some((s) => s !== 1)) bad = `${layers}: every tone once`;
    if (rep.reduce((n, c) => n + c.coreOnsets, 0) !== f.nodes) bad = `${layers}: core onsets`;
  }
  check('12 classes, every tone in exactly one, core = inside, counts and order (52 rhythms × 3 knobs)', !bad, bad);
  const row = buildRow([8, 7, 6, 5]), rep = classReport(row, frameAt(row, '1/1'));
  check('8:7:6:5 on 1/1: class 7 holds 3/2 as core; class 10 holds 7/4 as fringe; classes 1 3 6 8 9 are empty',
    rep[7].core[0]?.fraction === '3/2' && rep[10].fringe[0]?.fraction === '7/4' && [1, 3, 6, 8, 9].every((p) => !rep[p].core.length && !rep[p].fringe.length));
  const big = buildRow([4099, 4093, 4091, 4079]), f = frameOf(big);
  const t0 = performance.now(); const r2 = classReport(big, f); const t1 = performance.now();
  check(`a 16,359-onset row with 4,177 tones: the report in ${(t1 - t0).toFixed(1)} ms`, t1 - t0 < 100 && r2.reduce((n, c) => n + c.core.length + c.fringe.length, 0) === 4177);
}

console.log('\n— chunk-lines\' frame, read-only');
const linesFile = path.join(OVERWORLD_RUNTIME, 'chunk-lines.js'), superRowFile = path.join(OVERWORLD_RUNTIME, 'chunk-super-row.js');
if (!fs.existsSync(linesFile)) console.log(`  – skipped: ${linesFile} is not on this machine`);
else {
  const lines = await import(pathToFileURL(linesFile).href), ow = await import(pathToFileURL(superRowFile).href);
  let bad = '', compared = 0, skipped = 0;
  for (const layers of RHYTHMS) {
    const row = buildRow(layers);
    if (row.tones.some((x, t) => x !== row.toneLabels[t])) { skipped++; continue; }   // phase 1 keys tones exactly; the kernel's rounded spellings would not line up
    const o = ow.buildNormalizedRow([{ layers: layers.filter((v) => v > 0).sort((a, b) => a - b) }]);
    for (let r = 0; r < row.tones.length; r++) {
      const mine = frameAt(row, r, 12.5), theirs = lines.frameAt(o, mod(row.toneCents[r] - 12.5, 100), 25);
      const shift = mod(mine.pc[r] - theirs.pc[o.tones.indexOf(row.tones[r])], 12);
      for (let t = 0; t < row.tones.length; t++) {
        const u = o.tones.indexOf(row.tones[t]);
        if (theirs.inside[u] !== mine.inside[t] || (mine.inside[t] && mod(theirs.pc[u] + shift, 12) !== mine.pc[t])) { bad = `${layers} root ${row.tones[r]}: ${row.tones[t]}`; break; }
      }
      if (theirs.nodes !== mine.nodes) bad = `${layers} root ${row.tones[r]}: nodes`;
      compared++;
      if (bad) break;
    }
    if (bad) break;
  }
  check(`a 25¢ frame on the edge root − 12.5 holds what ±12.5 on the root holds, classes up to a turn (${compared} roots; ${skipped} rhythms with rounded spellings left out)`, !bad, bad);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
