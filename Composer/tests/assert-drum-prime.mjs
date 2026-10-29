// assert-drum-prime.mjs — step 4c-prime: the two-level prime partition (Composer/core/drums.js `mode: 'prime'`), as
// Avery re-ruled it on 2026-10-25: p a seeded random prime above the C = N·S cells, up to the low triple digits, and
// level 2 Partitions' own distribution of C over p. Against the row it plays and the site's own Partitions code (run
// in a vm, as the page runs it):
//   • Euclid parity: core's euclidPattern is the site's generateEuclideanPattern over many (steps, pulses)
//   • level 2 parity: primeSelection(p, C) is the site's getSecondaryAllowedSet(p, C), and the live UI's L2 cut
//     (computeL2Coverages over p unit lights) for every prime p in range
//   • p: prime, above C, within primeRange(C), drawn from `${seed}/drums/prime`: the same seed the same p, seeds
//     spread over the range; an asked p is kept, refused when not a prime above C
//   • level 1 by brute force over the row; exactly C lights chosen, light 0 first, so the downbeat cell sounds;
//     every stroke a real onset; hitsPerBar thinning; a grid's perc row over prime mode; perBar
//   • the other parts, and `against`'s bars, never move
//   node Composer/tests/assert-drum-prime.mjs
import fs from 'node:fs';
import path from 'node:path';
import { compose } from '../core/compose.js';
import { buildRow } from '../core/row.js';
import { euclidPattern } from '../core/cells.js';
import {
  arrangeDrums, beatsOf, drumGrid, gridShape, isPrime, nextPrime, primeRange, drawPrime, primeSelection, primeLights,
  cellLights, primePartition, levelOneLights, selectLights, DRUM_VOICES, DRUM_VELOCITY, GRID_ACCENT, ACCENT, PRIME_CEILING,
} from '../core/drums.js';
import { loadClass, ROOT } from './site-scripts.mjs';
import { makeDom } from './dom-stub.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const mod = (v, n) => ((v % n) + n) % n;
const throws = (f, re) => { try { f(); return false; } catch (e) { return !re || re.test(String(e.message)); } };
const J = (x) => JSON.stringify(x);

// the site's Partitions: PartitionsDistribution, PartitionsBlocks and PartitionsPlayback, in one vm, the playback's
// instance line left off (its constructor reaches for audio)
const read = (f) => fs.readFileSync(path.join(ROOT, 'Playback', 'Partitions', f), 'utf8');
const playback = read('PartitionsPlayback.js').replace(/\nwindow\.partitionsPlayback = new PartitionsPlayback\(\);\s*$/, '\n');
const site = loadClass('Playback/Partitions/PartitionsPlayback.js', '{ PD: PartitionsDistribution, PB: PartitionsBlocks, PP: PartitionsPlayback }', makeDom(),
  { source: `${read('PartitionsDistribution.js')}\n${read('PartitionsBlocks.js')}\n${playback}` });
const siteAllowed = (steps, pulses) => [...site.PP.prototype.getSecondaryAllowedSet.call({}, steps, pulses)].sort((a, b) => a - b);
const siteCoverageStarts = (p, C) => { const cov = site.PB.computeL2Coverages(new Array(p).fill(1), null, p, C), out = []; let at = 0; for (const c of cov) { out.push(at); at += c; } return out; };

// the cases: Compose's meters, then asked meters over S = 2, 3, 5, 7, 8, 11, 13 and N = 1–8
const CASES = [];
for (const [L, T] of [[[8, 7, 6, 5], 4], [[41, 42, 43], 8], [[19, 17, 16, 15], 6], [[119, 42, 15, 8], 8], [[768, 769], 8], [[11, 9, 7, 5], 6], [[97, 103, 37], 5]]) CASES.push([L, T, {}]);
for (const [L, T] of [[[119, 42, 15, 8], 8], [[41, 42, 43], 8], [[19, 17, 16, 15], 6]]) for (const [bars, slotsPerBar] of [[4, 5], [2, 7], [4, 3], [2, 11], [1, 13], [8, 6], [2, 2], [8, 13], [6, 8], [3, 7]]) CASES.push([L, T, { bars, slotsPerBar }]);
const specs = CASES.map(([L, T, ov]) => ({ name: `${L.join(':')} ${T}s ${ov.bars ? `${ov.bars}×${ov.slotsPerBar}` : 'auto'}`, L, T, ov, spec: compose(L, T, { seed: 3, overrides: { ...ov } }) }));
const rowOf = new Map();
const row = (L) => { const k = L.join(':'); if (!rowOf.has(k)) rowOf.set(k, buildRow(L)); return rowOf.get(k); };
const nodeAt = (r, tick) => { let lo = 0, hi = r.n - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (r.tick[m] === tick) return m; if (r.tick[m] < tick) lo = m + 1; else hi = m - 1; } return -1; };
const onsetFault = (L, spec, hits) => {
  const r = row(L), [pn, pd] = spec.knobs.phase, T = spec.knobs.cycleSeconds;
  for (const h of hits) {
    const i = nodeAt(r, h.tick);
    if (i < 0) return `${h.voice} at tick ${h.tick} is no onset`;
    if (h.time !== mod(r.tick[i] / r.grid - pn / pd, 1) * T) return `${h.voice} at ${h.time}`;
    if (h.strikes !== r.strikes[i]) return `${h.voice} strikes ${h.strikes}, the row ${r.strikes[i]}`;
  }
  return '';
};
const randomGrid = (spec, seed, rate = 0.4) => {
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const N = spec.knobs.bars, W = spec.knobs.slotsPerBar * beatsOf(spec.knobs.slotsPerBar).m;
  return Object.fromEntries(DRUM_VOICES.map((v) => [v, Array.from({ length: N }, () => Array.from({ length: W }, () => { const x = rnd(); return x < rate * 0.2 ? 'X' : x < rate ? 'x' : '.'; }).join(''))]));
};
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

console.log('Composer drum prime partition (step 4c-prime)');

console.log('\n— Partitions parity (the site\'s own scripts, in a vm)');
{
  check('the site\'s PartitionsDistribution, PartitionsBlocks and PartitionsPlayback load', typeof site.PD?.generateEuclideanPattern === 'function' && typeof site.PB?.computeL2Coverages === 'function' && typeof site.PP?.prototype?.getSecondaryAllowedSet === 'function');
  let bad = '', n = 0;
  for (let steps = 1; steps <= 230 && !bad; steps++) for (let pulses = 0; pulses <= steps + 1; pulses++) { n++; if (euclidPattern(steps, pulses).join() !== site.PD.generateEuclideanPattern(steps, pulses).join()) { bad = `E(${pulses}, ${steps})`; break; } }
  check(`euclidPattern is the site's generateEuclideanPattern exactly (${n} (steps, pulses), steps 1–230)`, !bad, bad);
  // C = 2 is the one count where the two cuts part (the second light at ⌊p/2⌋ or ⌈p/2⌉); a meter never has it (the
  // grid has at least 4 places a bar, so C ≥ 4)
  let sel = '', cov = '', m = 0, two = 0;
  for (let C = 1; C <= 120; C++) for (const p of primeRange(C).primes) {
    m++;
    const mine = primeSelection(p, C);
    if (J(mine) !== J(siteAllowed(p, C))) sel ||= `p ${p}, C ${C}`;
    if (J(mine) !== J(siteCoverageStarts(p, C))) { if (C === 2 && J(mine) === J([0, (p - 1) / 2])) two++; else cov ||= `p ${p}, C ${C}: ${mine.slice(0, 6)} vs ${siteCoverageStarts(p, C).slice(0, 6)}`; }
  }
  check(`level 2 is Partitions' own secondary selection, getSecondaryAllowedSet(p, C) (E(C, p) turned to start on a light), for every prime p in range, C = 1–120 (${m})`, !sel, sel);
  check(`…and the live UI's L2 cut (computeL2Coverages over p unit lights: the starts of calculatePartitionSizes(p, C)) is the same selection for every one of them but C = 2 (${two}: light ⌊p/2⌋ there, ⌈p/2⌉ in the UI; no meter has 2 cells)`, !cov && two === primeRange(2).primes.length, cov);
  check('selectLights is that same turn (light 0 first), for the cells as before', J(selectLights(37, 32)) === J(siteAllowed(37, 32)) && J(selectLights(32, 12)) === J(siteAllowed(32, 12)));
}

console.log('\n— p: a seeded random prime above the cells');
{
  check(`primeRange: (C, max(${PRIME_CEILING}, the smallest prime ≥ 2C)]: 32 cells → 37…199 (${primeRange(32).primes.length} primes), 104 → 107…211, 8 → 11…199`,
    J(primeRange(32).primes.slice(0, 2)) === '[37,41]' && primeRange(32).upTo === 199 && primeRange(104).upTo === 211 && primeRange(104).primes[0] === 107 && primeRange(8).primes[0] === 11 && nextPrime(208) === 211 && nextPrime(13) === 13);
  let bad = '', runs = 0;
  const seen = new Map();
  for (const { name, spec } of specs) {
    const C = gridShape(drumGrid(spec)).cells, R = primeRange(C);
    for (const seed of SEEDS) {
      runs++;
      const d = arrangeDrums(spec, { mode: 'prime', seed }), p = d.prime.p;
      if (!isPrime(p) || p <= C || p > R.upTo || !R.primes.includes(p) || !d.prime.drawn) bad ||= `${name} seed ${seed}: p ${p} over ${C} cells`;
      if (p !== drawPrime(C, seed) || d.prime.range.upTo !== R.upTo || d.prime.range.above !== C) bad ||= `${name} seed ${seed}: not drawPrime`;
      if (C === 32) { const k = seen.get(C) ?? new Set(); k.add(p); seen.set(C, k); }
    }
  }
  check(`p is a prime above C and within the range, for every meter and seed (${runs} runs, ${specs.length} meters × ${SEEDS.length} seeds)`, !bad, bad);
  const draws = Array.from({ length: 400 }, (_, i) => drawPrime(32, i + 1)), R32 = primeRange(32).primes, hist = new Map(R32.map((q) => [q, 0]));
  for (const q of draws) hist.set(q, hist.get(q) + 1);
  const hit = [...hist.values()].filter((x) => x > 0).length;
  check(`the seeds spread p over the range: 400 seeds over 32 cells take ${hit} of its ${R32.length} primes (${Math.min(...draws)}–${Math.max(...draws)}), none more than 3× its share`, hit >= R32.length - 2 && [...hist.values()].every((x) => x <= 3 * 400 / R32.length));
  let det = true;
  for (const { spec } of specs.slice(0, 14)) for (const seed of [1, 9]) { const a = arrangeDrums(spec, { mode: 'prime', seed }), b = arrangeDrums(spec, { mode: 'prime', seed }); if (J(a) !== J(b)) det = false; }
  const s = specs[1].spec;
  check('the same seed, the same p and byte-identical drums; the spec\'s own seed is the default', det && arrangeDrums(s, { mode: 'prime' }).prime.p === drawPrime(32, s.input.seed) && compose([41, 42, 43], 8, { seed: 3, drums: { mode: 'prime' } }).drums.prime.p === drawPrime(32, 3));
  const one = new Set(SEEDS.map((seed) => arrangeDrums(s, { mode: 'prime', seed }).prime.p));
  check(`different seeds draw different p (${[...one].join(', ')} over seeds 1–8)`, one.size >= 4);
  const asked = arrangeDrums(s, { mode: 'prime', p: 101, seed: 1 }), asked2 = arrangeDrums(s, { mode: 'prime', p: 101, seed: 2 });
  check('an asked p is kept (and the seed then moves nothing): p 101 on seeds 1 and 2', asked.prime.p === 101 && !asked.prime.drawn && J(asked.hits) === J(asked2.hits) && asked.decisions.find((x) => x.what === 'drums.prime').why.includes('p asked'));
  check('an asked p that is not a prime above the cells is refused: 32 (not prime), 31 and 29 (below 32 cells), 32 cells\' 1', throws(() => arrangeDrums(s, { mode: 'prime', p: 32 }), /prime/)
    && throws(() => arrangeDrums(s, { mode: 'prime', p: 31 }), /above the 32 cells/) && throws(() => arrangeDrums(s, { mode: 'prime', p: 29 }), /above/) && throws(() => primePartition(s, drumGrid(s), { p: 1 }), /prime/)
    && !throws(() => arrangeDrums(s, { mode: 'prime', p: 37 })));
  // p is the drums' own draw: no other part, and no bar of `against`, moves
  const plain = compose([41, 42, 43], 8, { seed: 5 }), withPrime = compose([41, 42, 43], 8, { seed: 5, drums: { mode: 'prime' } });
  const ag = arrangeDrums(s, { mode: 'against' }), agPrime = arrangeDrums(s, { mode: 'against', perBar: { 3: 'prime' } });
  check('drawing p moves nothing else: the parts and chords of a compose with the prime drums are the plain compose\'s; `against`\'s bars are their own beside a prime bar',
    J(plain.parts) === J(withPrime.parts) && J(plain.chords) === J(withPrime.chords) && J(ag.hits.filter((h) => h.bar !== 3)) === J(agPrime.hits.filter((h) => h.bar !== 3 && h.snap !== 'prime')));
  const dec = arrangeDrums(s, { mode: 'prime' }).decisions;
  check('the decisions say p was drawn, from where, and that the seed drew it', /seeded random prime above the 32 cells, one of the \d+ in 33–199/.test(dec.find((x) => x.what === 'drums.prime').why) && dec.find((x) => x.what === 'drums.seed')?.why.includes('draws the prime partition'));
}

console.log('\n— the two levels');
{
  let place = '', chose = '', down = '', strokes = '', groups = '', thin = '', lights = 0, runs = 0, struck = 0, landed = 0, silentN = 0;
  for (const { name, L, spec } of specs) {
    const g = drumGrid(spec), { cells: C } = gridShape(g), r = row(L), [pn, pd] = spec.knobs.phase, phaseX = pn / pd;
    const rel = Array.from(r.tick, (t) => mod(t / r.grid - phaseX, 1));
    for (const seed of SEEDS.slice(0, 4)) {
      runs++;
      const d = arrangeDrums(spec, { mode: 'prime', seed }), pr = d.prime, p = pr.p;
      // level 1, by brute force over the row: light i the onset nearest i/p within half a light (lo < x ≤ hi; a tie the earlier), then a whole light
      if (seed <= 2) for (const x of pr.lights) {
        lights++;
        let best = null;
        for (const w of [1 / (2 * p), 1 / p]) {
          for (let i = 0; i < r.n; i++) for (const y of [rel[i] - 1, rel[i], rel[i] + 1]) {
            if (!(y > x.at - w - 1e-12 && y <= x.at + w + 1e-12)) continue;
            const dd = y - x.at;
            if (!best || Math.abs(dd) < Math.abs(best.d) - 1e-12 || (Math.abs(Math.abs(dd) - Math.abs(best.d)) <= 1e-12 && dd < best.d)) best = { tick: r.tick[i], d: dd };
          }
          if (best) break;
        }
        if ((best ? best.tick : null) !== x.tick) place ||= `${name} p ${p}: light ${x.i} at ${x.tick}, the row's nearest ${best?.tick}`;
        else if (x.tick != null && Math.abs(x.time - mod(x.tick / r.grid - phaseX, 1) * g.T) > 1e-12) place ||= `${name}: light ${x.i}'s time`;
      }
      if (pr.lights.length !== p || pr.lights[0].tick * pd !== pn * g.grid || pr.lights[0].time !== 0) place ||= `${name}: light 0 is not the downbeat`;
      // level 2: exactly C distinct lights, ascending, light 0 first, Partitions' selection
      const ch = pr.chosen;
      if (ch.length !== C || ch[0] !== 0 || ch.some((x, j) => j && x <= ch[j - 1]) || ch[C - 1] >= p || J(ch) !== J(siteAllowed(p, C))) chose ||= `${name} p ${p}: ${ch.length} chosen`;
      // Partitions' groups: from each chosen light to the next, ⌊p/C⌋ or ⌈p/C⌉ lights, covering all p
      let total = 0, lo = Infinity, hi = 0;
      for (let j = 0; j < C; j++) { const c = cellLights(j, p, C); total += c.to - c.from; lo = Math.min(lo, c.to - c.from); hi = Math.max(hi, c.to - c.from); if (c.from !== ch[j]) groups ||= `${name}: cell ${j}`; }
      if (total !== p || lo !== Math.floor(p / C) || hi !== Math.ceil(p / C) || pr.perCell.min !== lo || pr.perCell.max !== hi || pr.emptyCells !== 0) groups ||= `${name} p ${p}: ${lo}–${hi} a cell, ${total}`;
      // the downbeat cell sounds: cell 0 lit, striking light 0, the downbeat, accented
      const first = d.hits.find((h) => h.snap === 'prime' && h.cell === 0);
      if (pr.selected[0] !== 0 || !first || first.light !== 0 || first.time !== 0 || first.velocity !== Math.min(1, DRUM_VELOCITY.perc + ACCENT + 0.04 * (first.strikes - 1))) down ||= `${name} p ${p}: the downbeat cell`;
      // every cell lit by default, each striking its chosen light on a real onset (or silent: a dark light)
      if (pr.hits !== C || pr.struck.length + pr.silent.length !== C) chose ||= `${name}: ${pr.hits} lit`;
      for (const h of d.hits.filter((x) => x.snap === 'prime')) { struck++; const x = pr.struck.find((y) => y.cell === h.cell); if (h.light !== ch[h.cell] || !x || h.tick !== x.tick || h.voice !== 'perc') strokes ||= `${name}: cell ${h.cell} struck light ${h.light}`; }
      // a lit light strikes its own onset; a dark one the onset nearest its place within its cell's reach (half a cell, then a whole), by brute force
      for (const x of pr.struck) {
        const L = pr.lights[x.light];
        if (L.tick != null) { if (x.tick !== L.tick || x.snap !== L.snap) strokes ||= `${name}: cell ${x.cell}'s lit light`; continue; }
        landed++;
        let best = null;
        for (const w of [1 / (2 * C), 1 / C]) {
          for (let i = 0; i < r.n; i++) for (const y of [rel[i] - 1, rel[i], rel[i] + 1]) {
            if (!(y > L.at - w - 1e-12 && y <= L.at + w + 1e-12)) continue;
            const dd = y - L.at;
            if (!best || Math.abs(dd) < Math.abs(best.d) - 1e-12 || (Math.abs(Math.abs(dd) - Math.abs(best.d)) <= 1e-12 && dd < best.d)) best = { tick: r.tick[i], d: dd, w };
          }
          if (best) break;
        }
        if (!best || best.tick !== x.tick || x.snap !== (best.w === 1 / C ? 'cell-wide' : 'cell')) strokes ||= `${name} p ${p}: dark light ${x.light} landed at ${x.tick}, the row's nearest ${best?.tick}`;
      }
      for (const x of pr.silent) if (!/no onset within a cell/.test(x.why)) strokes ||= `${name}: silent ${x.why}`;
      silentN += pr.silent.length;
      if (onsetFault(L, spec, d.hits)) strokes ||= `${name}: ${onsetFault(L, spec, d.hits)}`;
      if (J(d.hits.filter((h) => h.voice !== 'perc')) !== J(arrangeDrums(spec, {}).hits.filter((h) => h.voice !== 'perc'))) strokes ||= `${name}: the backbeat under the prime line moved`;
      // hitsPerBar thins the cells by Partitions' secondary pattern, the downbeat cell still first
      for (const hpb of [1, 3, 5]) {
        const t = primePartition(spec, g, { seed, hitsPerBar: hpb }), want = Math.max(1, Math.min(C, hpb * g.N));
        if (t.hits !== want || J(t.selected) !== J(siteAllowed(C, want)) || t.selected[0] !== 0 || !t.struck.some((x) => x.cell === 0 && x.light === 0)) thin ||= `${name} hitsPerBar ${hpb}`;
      }
    }
  }
  check(`level 1: each light the onset nearest i/p of the cycle (half a light either side, then a whole), by brute force over the row; light 0 the downbeat (${lights} lights)`, !place, place);
  check(`level 2: exactly C lights chosen, ascending, light 0 first: the site's getSecondaryAllowedSet(p, C) (${runs} runs)`, !chose, chose);
  check('each cell covers Partitions\' group, ⌊p/C⌋ or ⌈p/C⌉ lights from its chosen one, all p covered, no empty cell', !groups, groups);
  check('the downbeat cell always sounds: lit, striking light 0 at time 0, accented', !down, down);
  check(`every stroke on a real onset (its time and strikes the row's), each cell striking its chosen light on the perc, the backbeat under it unmoved (${struck} strokes)`, !strokes && struck > 3000, strokes);
  check(`a dark chosen light strikes the onset nearest its place within its cell's reach (half a cell, then a whole: ${landed}, by brute force); none found, the cell is silent (${silentN})`, !strokes && landed > 50, strokes);
  check('hitsPerBar 1, 3, 5 thin the cells by Partitions\' secondary pattern E(N·hitsPerBar, C), the downbeat cell first and sounding', !thin, thin);
}

console.log('\n— grid rows over prime mode');
{
  let bad = '', n = 0;
  for (const { name, spec } of specs.slice(0, 16)) {
    const g = drumGrid(spec), { cells: C, places: W } = gridShape(g);
    for (const seed of [1, 2]) {
      n++;
      const grid = randomGrid(spec, 7 + seed + W), dg = arrangeDrums(spec, { mode: 'prime', seed, grid }), lit = [];
      grid.perc.forEach((line, k) => { for (let u = 0; u < W; u++) if (line[u] !== '.') lit.push(k * W + u); });
      const asGrid = arrangeDrums(spec, { mode: 'grid', grid: { ...grid, perc: grid.perc.map((l) => '.'.repeat(l.length)) } });
      const perc = dg.hits.filter((h) => h.voice === 'perc');
      if (J(dg.prime.selected) !== J(lit) || dg.prime.struck.length + dg.prime.silent.length !== lit.length || dg.prime.p !== drawPrime(C, seed)) bad ||= `${name}: the perc row is not the selection`;
      if (perc.length !== new Set(dg.prime.struck.map((x) => x.tick)).size || !perc.every((h) => h.snap === 'prime' && lit.includes(h.cell) && h.light === dg.prime.chosen[h.cell])) bad ||= `${name}: the perc strokes`;
      if (J(dg.hits.filter((h) => h.voice !== 'perc')) !== J(asGrid.hits.filter((h) => h.voice !== 'perc'))) bad ||= `${name}: the other voices are not the grid's`;
      if (!perc.filter((h) => grid.perc[Math.floor(h.cell / W)][h.cell % W] === 'X').every((h) => h.velocity === Math.min(1, DRUM_VELOCITY.perc + GRID_ACCENT.perc + 0.04 * (h.strikes - 1)))) bad ||= `${name}: an X`;
      for (const x of dg.prime.silent) if (!dg.silentCells.some((c) => c.voice === 'perc' && c.bar === Math.floor(x.cell / W) && c.place === x.cell % W)) bad ||= `${name}: silent cell ${x.cell} unreported`;
    }
  }
  check(`a grid's perc row lights the cells (each striking its chosen light; an X accents it), its other voices play as the grid; a silent cell reported (${n} runs)`, !bad, bad);
  const s = specs[1].spec, W = gridShape(drumGrid(s)).places;
  const one = arrangeDrums(s, { perBar: { 1: 'prime' } });
  check('a bar may be prime alone (perBar): only its cells strike', one.hits.filter((h) => h.snap === 'prime').every((h) => Math.floor(h.cell / W) === 1) && one.hits.some((h) => h.snap === 'prime'));
}

console.log('\n— the seam and the shape');
{
  const s = specs[1].spec, g = drumGrid(s), d = arrangeDrums(s, { mode: 'prime' }), p = d.prime.p;
  const lv = levelOneLights(g, { source: 'prime', seed: s.input.seed });
  check('levelOneLights({ source: \'prime\' }) draws the same p from the seed; tickAt(i) each light\'s onset', lv.count === p && lv.tickAt(0) === primeLights(g, p)[0].tick && lv.tickAt(5) === d.prime.lights[5].tick);
  const L1 = d.prime.lights[3];
  check(`the lights for the UI strip: { i, at, tick, time, r, bar, pos, slot, snap } (light 3: ${L1.time.toFixed(4)} s)`, Object.keys(L1).join() === 'i,at,tick,time,r,bar,pos,slot,snap' && L1.time === L1.r * g.T);
  check(`prime: { ${Object.keys(d.prime).join(', ')} }`, Object.keys(d.prime).join() === 'p,drawn,range,cells,hits,lights,chosen,selected,struck,silent,emptyCells,perCell');
  check('the drums are JSON with the prime partition on (a spec stays serialisable)', J(JSON.parse(J(d))) === J(d));
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
