// assert-drum-grid.mjs — step 4c: the drum grid source, presets ⇄ grid, and the two-level prime partition
// (Composer/core/drums.js), against the row it plays and Partitions' own Euclid:
//   • byte identity: with no grid and no prime mode, arrangeDrums is exactly the drums of b69a39e (drums-baseline.mjs)
//   • the grid source: every grid stroke's tick is a real onset (its time and strikes the row's), a whole-slot cell
//     the onset cells.js finds nearest its anchor; the silent cells reported, and every lit cell accounted for
//   • presets ⇄ grid: gridOf(preset) arranges the preset's own hits, for every mode and pattern on many rows (odd,
//     prime and under-4 S), fills on and off; `with`, `against` and `partition` measured where they can't be exact
//   • the prime mode: the light count, level 1's placement (each light the onset nearest i/p, checked by brute force
//     over the row), level 2's mapping (cell j → light ⌊j·p/C⌋), Partitions' selection, the grid replacing it
//   • determinism; refusals
//   node Composer/tests/assert-drum-grid.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { compose } from '../core/compose.js';
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import {
  arrangeDrums, gridOf, readGrid, beatsOf, drumGrid, gridShape, nearestPrime, isPrime, primeLights, cellLights,
  primePartition, levelOneLights, DRUM_MODES, DRUM_VOICES, SOURCE_MODES, ALL_DRUM_MODES, DRUM_VELOCITY, GRID_ACCENT, ACCENT,
} from '../core/drums.js';
import { DRUM_BASELINE, DRUM_BASELINE_CASES, DRUM_BASELINE_VARIANTS, DRUM_BASELINE_SEED, caseName, sha } from './drums-baseline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const mod = (v, n) => ((v % n) + n) % n;
const EPS = 1e-9;
const throws = (f, re) => { try { f(); return false; } catch (e) { return !re || re.test(String(e.message)); } };
const J = (x) => JSON.stringify(x);

// Partitions' own Euclid and its secondary selection (PartitionsPlayback.getSecondaryAllowedSet), as assert-drums has it
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(HERE, '..', '..', 'Playback', 'Partitions', 'PartitionsDistribution.js'), 'utf8'), sandbox);
const PD = sandbox.window.PartitionsDistribution;
const secondaryAllowed = (steps, pulses) => {
  let pattern = PD.generateEuclideanPattern(steps, pulses);
  const firstOn = pattern.indexOf(1);
  if (firstOn > 0) pattern = pattern.slice(firstOn).concat(pattern.slice(0, firstOn));
  const allowed = []; pattern.forEach((flag, i) => { if (flag) allowed.push(i); });
  return allowed;
};

// the cases: assert-drums.mjs' (Compose's meters, then asked meters over odd, prime and under-4 S)
const CASES = [];
for (const [L, T] of [[[8, 7, 6, 5], 4], [[41, 42, 43], 8], [[19, 17, 16, 15], 6], [[119, 42, 15, 8], 8], [[768, 769], 8], [[11, 9, 7, 5], 6], [[97, 103, 37], 5]]) CASES.push([L, T, {}]);
for (const [L, T] of [[[119, 42, 15, 8], 8], [[41, 42, 43], 8], [[19, 17, 16, 15], 6]]) for (const [bars, slotsPerBar] of [[4, 5], [2, 7], [4, 3], [2, 11], [1, 13], [8, 6], [2, 2]]) CASES.push([L, T, { bars, slotsPerBar }]);
const specs = CASES.map(([L, T, ov]) => ({ name: `${L.join(':')} ${T}s ${ov.bars ? `${ov.bars}×${ov.slotsPerBar}` : 'auto'}`, L, T, spec: compose(L, T, { seed: 3, overrides: { ...ov } }) }));
const rowOf = new Map();
const row = (L) => { const k = L.join(':'); if (!rowOf.has(k)) rowOf.set(k, buildRow(L)); return rowOf.get(k); };
const nodeAt = (r, tick) => { let lo = 0, hi = r.n - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (r.tick[m] === tick) return m; if (r.tick[m] < tick) lo = m + 1; else hi = m - 1; } return -1; };
/** a seeded grid: each place lit with chance `rate`, a fifth of them accented */
const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const randomGrid = (spec, seed, rate = 0.4, voices = DRUM_VOICES) => {
  const rnd = seeded(seed), N = spec.knobs.bars, W = spec.knobs.slotsPerBar * beatsOf(spec.knobs.slotsPerBar).m;
  return Object.fromEntries(voices.map((v) => [v, Array.from({ length: N }, () => Array.from({ length: W }, () => { const x = rnd(); return x < rate * 0.2 ? 'X' : x < rate ? 'x' : '.'; }).join(''))]));
};
/** every hit an onset of the row: its tick a row onset, its time compose.js' own, its strikes the row's */
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

console.log('Composer drum grid (step 4c)');

console.log('\n— unchanged without a grid');
{
  let bad = '', n = 0;
  for (const c of DRUM_BASELINE_CASES) {
    const [L, T, ov] = c, spec = compose(L, T, { seed: DRUM_BASELINE_SEED, overrides: { ...ov } }), want = DRUM_BASELINE[caseName(c)];
    DRUM_BASELINE_VARIANTS.forEach((v, i) => { n++; if (sha(v === null ? spec.drums : arrangeDrums(spec, v)) !== want[i]) bad ||= `${caseName(c)} variant ${i} ${J(v)}`; });
  }
  check(`every mode and option variant, no grid, no prime: byte for byte the drums of b69a39e (${n} = ${DRUM_BASELINE_CASES.length} cases × ${DRUM_BASELINE_VARIANTS.length} variants)`, !bad && n === 595, bad);
  const s = specs[1].spec, unused = arrangeDrums(s, { mode: 'rock', grid: randomGrid(s, 1) });
  const { options: o1, ...a } = unused, { options: o2, ...b } = arrangeDrums(s, { mode: 'rock' });
  check('a grid given to a bar in another mode waits unread: the drums are the mode\'s own (only the options echo it)', J(a) === J(b) && o1.grid && !o2.grid && !('silentCells' in unused));
  check('DRUM_MODES (the presets\' list the lab reads) is unchanged; the source modes are their own list', J(DRUM_MODES) === J(['backbeat', 'with', 'against', 'partition', 'rock', 'halftime', 'four', 'funk', 'soca', 'bossa', 'shuffle', 'son', 'rumba'])
    && J(SOURCE_MODES) === J(['grid', 'prime']) && J(ALL_DRUM_MODES) === J([...DRUM_MODES, ...SOURCE_MODES]));
}

console.log('\n— the grid source');
{
  let fault = '', strokes = 0, nearMiss = '', compared = 0, acct = '', velBad = '';
  for (const { name, L, spec } of specs) {
    const g = drumGrid(spec), { m, places: W } = gridShape(g);
    for (const seed of [1, 2, 3]) {
      const grid = randomGrid(spec, seed + 17 * W), d = arrangeDrums(spec, { mode: 'grid', grid, fills: false });
      strokes += d.hits.length;
      fault ||= onsetFault(L, spec, d.hits) && `${name}: ${onsetFault(L, spec, d.hits)}`;
      // every lit cell is a stroke, a silent cell, or merged with another cell on one onset
      const lit = Object.values(grid).flat().join('').replace(/\./g, '').length;
      if (lit !== d.hits.length + d.silentCells.length + d.stats.merged) acct ||= `${name}: ${lit} lit, ${d.hits.length} + ${d.silentCells.length} silent + ${d.stats.merged} merged`;
      // and gridOf gives the grid back, less what went silent or merged
      const back = gridOf(d);
      for (const v of DRUM_VOICES) back[v].forEach((line, k) => { for (let u = 0; u < W; u++) if (line[u] !== '.' && line[u] !== (grid[v]?.[k]?.[u] ?? '.')) acct ||= `${name}: gridOf put ${line[u]} at ${v} ${k}:${u}, the grid ${grid[v]?.[k]?.[u]}`; });
      for (const h of d.hits) {
        const ch = grid[h.voice][h.bar][Math.round(h.pos * m)];
        const want = Math.min(1, DRUM_VELOCITY[h.voice] + (ch === 'X' ? GRID_ACCENT[h.voice] : 0) + 0.04 * Math.max(0, h.strikes - 1));
        if (Math.abs(h.velocity - want) > 1e-12 || h.pos * m !== Math.round(h.pos * m)) velBad ||= `${name}: ${h.voice} ${h.velocity} at ${h.pos}`;
      }
    }
    // a whole-slot cell lands on the onset cells.js finds nearest its anchor (swing-0.5 window, exact BigInt)
    const r = row(L), k = spec.knobs, cells = buildCells(r, { bars: k.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase, swing: 0.5 });
    for (const h of arrangeDrums(spec, { mode: 'grid', grid: randomGrid(spec, 99), fills: false }).hits) {
      if (h.snap !== 'slot' || Math.abs(h.pos - Math.round(h.pos)) > EPS) continue;
      const slot = cells.slots[h.slot], want = slot.tones.length ? slot.tones[0].node : -1;
      compared++;
      if (want < 0 || r.tick[want] !== h.tick) nearMiss ||= `${name}: ${h.voice} in slot ${h.slot} at ${h.tick}`;
    }
  }
  check(`every grid stroke's tick is an onset of the row, its time compose.js' own, its strikes the row's (${strokes} strokes, ${specs.length} rows × 3 grids)`, !fault && strokes > 2000, fault);
  check(`a whole-slot cell is the onset cells.js finds nearest that anchor in its swing-0.5 window (${compared})`, !nearMiss && compared > 200, nearMiss);
  check('every lit cell is a stroke, a silent cell or merged; gridOf of the result is the grid less those', !acct, acct);
  check('x is the voice\'s velocity, X adds GRID_ACCENT (the hat\'s +0.08, the backbeat\'s beat lift; 0.12 else), the strikes\' lift on top', !velBad && GRID_ACCENT.hat === 0.08 && GRID_ACCENT.kick === ACCENT, velBad);

  // the silent cells: a sparse row under many places
  const sparse = compose([8, 7, 6, 5], 4, { seed: 3, overrides: { bars: 2, slotsPerBar: 16 } }), gs = drumGrid(sparse), Ws = gridShape(gs).places;
  const full = { hat: ['x'.repeat(Ws), 'x'.repeat(Ws)], kick: ['X' + '.'.repeat(Ws - 1), '.'.repeat(Ws)] };
  const ds = arrangeDrums(sparse, { mode: 'grid', grid: full, fills: false }), rs = row([8, 7, 6, 5]);
  let silentBad = '';
  for (const c of ds.silentCells) {
    // independently: no onset of the row within a whole place either side of the cell's place (the second look)
    const at = c.bar * gs.S + c.place / gridShape(gs).m, lo = gs.rAt(at - 1), hi = gs.rAt(at + 1);
    for (let i = 0; i < rs.n; i++) { const x = gs.relOf(rs.tick[i]); for (const y of [x - 1, x, x + 1]) if (y > lo + 1e-12 && y <= hi - 1e-12) silentBad ||= `${c.voice} ${c.bar}:${c.place} has onset ${rs.tick[i]} within a place`; }
  }
  check(`silent cells reported as { bar, voice, place } (${ds.silentCells.map((c) => `${c.voice} ${c.bar + 1}:${c.place}`).join(', ')}), each with no onset within a place either side`, ds.silentCells.length > 0 && !silentBad
    && ds.stats.silent === ds.silentCells.length && ds.silentCells.every((c) => c.voice === 'hat' && Object.keys(c).join() === 'bar,voice,place'), silentBad);
  check('…and a grid with nothing silent reports none', J(arrangeDrums(specs[1].spec, { grid: gridOf(arrangeDrums(specs[1].spec)) }).silentCells) === '[]');

  // fills and crashes stay options over the grid
  const s = specs[1].spec, grid = randomGrid(s, 5), on = arrangeDrums(s, { grid }), off = arrangeDrums(s, { grid, fills: false }), from3 = beatsOf(s.knobs.slotsPerBar).pos[2];
  const fb = on.bars.filter((b) => b.fill).map((b) => b.bar), cb = on.bars.filter((b) => b.crash).map((b) => b.bar);
  const outside = (d) => d.hits.filter((h) => !(fb.includes(h.bar) && h.pos >= from3 - EPS) && !(cb.includes(h.bar) && h.voice === 'cym' && h.pos === 0));
  check(`fills over the grid: bar ${fb.map((b) => b + 1)} fills from beat 3 (the grid's kick, snare and hat there give way, its perc and cym stay), a crash opens bar ${cb.map((b) => b + 1)}; elsewhere the grid is untouched`,
    fb.length === 1 && cb.length === 1 && on.mode === 'grid' && J(outside(on)) === J(outside(off)) && on.hits.some((h) => h.bar === cb[0] && h.voice === 'cym' && h.pos === 0)
    && !on.hits.some((h) => fb.includes(h.bar) && h.pos >= from3 - EPS && h.voice === 'hat'));
  const mixed = arrangeDrums(s, { mode: 'backbeat', perBar: { 2: 'grid' }, grid, fills: false }), plain = arrangeDrums(s, { fills: false }), gridOnly = arrangeDrums(s, { grid, fills: false });
  check('a bar may be in mode grid alone (perBar): it plays the grid, the others their mode', J(mixed.hits.filter((h) => h.bar !== 2)) === J(plain.hits.filter((h) => h.bar !== 2)) && J(mixed.hits.filter((h) => h.bar === 2)) === J(gridOnly.hits.filter((h) => h.bar === 2)));
  const viaCompose = compose([41, 42, 43], 8, { seed: 3, drums: { grid } });
  check('compose(..., { drums: { grid } }) arranges the grid, as arrangeDrums does from the spec', viaCompose.drums.mode === 'grid' && J(viaCompose.drums) === J(arrangeDrums(viaCompose, { grid })));
}

console.log('\n— presets ⇄ grid');
{
  const fidelity = {};
  let exactBad = '', againstBad = '', lineBad = '';
  for (const { name, spec } of specs) for (const mode of [...DRUM_MODES, 'prime']) for (const fills of [true, false]) {
    const d = arrangeDrums(spec, { mode, fills }), grid = gridOf(d);
    const e = arrangeDrums(spec, mode === 'prime' ? { mode, fills, grid } : { mode: 'grid', fills, grid });
    const f = fidelity[mode] ||= { runs: 0, exact: 0, line: 0, sameOnset: 0 };
    f.runs++; if (J(d.hits) === J(e.hits)) f.exact++;
    const what = `${name} ${mode}${fills ? '' : ' (no fills)'}`;
    if (mode === 'with' || mode === 'partition' || mode === 'against') {
      // the backbeat under the line is exact; the line is measured
      if (J(d.hits.filter((h) => h.voice !== 'perc')) !== J(e.hits.filter((h) => h.voice !== 'perc'))) lineBad ||= `${what}: the backbeat moved`;
      const got = new Set(e.hits.filter((h) => h.voice === 'perc').map((h) => h.tick));
      for (const h of d.hits.filter((x) => x.voice === 'perc')) { f.line++; if (got.has(h.tick)) f.sameOnset++; }
      if (mode === 'against') {
        // against's perc is landed on slots too: the onsets are exact, only its off-beat lift (+0.05) is not an x or an X
        const ea = e.hits.filter((h) => h.voice === 'perc'), da = d.hits.filter((h) => h.voice === 'perc');
        if (ea.length !== da.length || da.some((h, i) => h.tick !== ea[i].tick || !(Math.abs(h.velocity - ea[i].velocity) < 1e-12 || Math.abs(h.velocity - ea[i].velocity - 0.05) < 1e-12))) againstBad ||= what;
      }
      if (mode === 'with' && e.hits.filter((h) => h.voice === 'perc').length !== d.hits.filter((h) => h.voice === 'perc').length) lineBad ||= `${what}: with's ${d.hits.filter((h) => h.voice === 'perc').length} strokes became ${e.hits.filter((h) => h.voice === 'perc').length}`;
    } else if (J(d.hits) !== J(e.hits)) exactBad ||= what;
  }
  const exactModes = Object.keys(fidelity).filter((m) => !['with', 'against', 'partition'].includes(m));
  check(`gridOf(preset) arranges the preset's own hits, field for field: ${exactModes.join(', ')} (${exactModes.reduce((a, m) => a + fidelity[m].runs, 0)} runs: ${specs.length} rows × fills on/off)`, !exactBad && exactModes.every((m) => fidelity[m].exact === fidelity[m].runs), exactBad);
  check(`against: the same onsets every time (${fidelity.against.sameOnset}/${fidelity.against.line}); only its off-beat lift (+0.05) is lost to x/X, in ${fidelity.against.runs - fidelity.against.exact} of ${fidelity.against.runs} runs`, !againstBad && fidelity.against.sameOnset === fidelity.against.line, againstBad);
  const pct = (m) => `${(100 * fidelity[m].sameOnset / fidelity[m].line).toFixed(1)}%`;
  check(`with and partition (onset-exact strokes) re-land through land(): the backbeat exact, with keeps its stroke count; the same onset for ${pct('with')} of with's ${fidelity.with.line} line strokes and ${pct('partition')} of partition's ${fidelity.partition.line}`,
    !lineBad && fidelity.with.sameOnset / fidelity.with.line > 0.2 && fidelity.partition.sameOnset / fidelity.partition.line > 0.2, lineBad);
  const sample = gridOf(arrangeDrums(compose([119, 42, 15, 8], 8, { seed: 1 }), { mode: 'rock', fills: false }));
  check(`gridOf writes rock on 8 slots as kick ${sample.kick[0]}, snare ${sample.snare[0]}, hat ${sample.hat[0]}`, sample.kick[0] === 'X...x...' && sample.snare[0] === '..x...x.' && sample.hat[0] === 'xxxxxxxx' && sample.perc[0] === '........');
  const r3 = gridOf(arrangeDrums(compose([8, 7, 6, 5], 4, { seed: 1 }), { mode: 'rock' }));
  check(`under 4 slots a bar the grid has S·m places: rock on 3 slots is kick ${r3.kick[0]}, snare ${r3.snare[0]}, hat ${r3.hat[0]} (6 places)`, r3.kick[0] === 'X..x..' && r3.snare[0] === '..x..x' && r3.hat[0].length === 6);
}

console.log('\n— the prime partition');
{
  check('nearestPrime: 32 → 31, 16 → 17, 12 → 13 (11 and 13 tie: the larger), 64 → 67 (61 and 67 tie), 13 → 13, 1 → 2', nearestPrime(32) === 31 && nearestPrime(16) === 17 && nearestPrime(12) === 13 && nearestPrime(64) === 67 && nearestPrime(13) === 13 && nearestPrime(1) === 2 && isPrime(127) && !isPrime(91));
  let countBad = '', placeBad = '', mapBad = '', selBad = '', underBad = '', n = 0, lightsChecked = 0, under = 0;
  for (const { name, L, spec } of specs) {
    const g = drumGrid(spec), { cells: C, places: W } = gridShape(g), r = row(L), [pn, pd] = spec.knobs.phase, phaseX = pn / pd;
    for (const p of [null, nearestPrime(2 * C), 127]) {
      n++;
      const d = arrangeDrums(spec, { mode: 'prime', ...(p ? { p } : {}) }), pr = d.prime, want = p ?? nearestPrime(g.N * g.S * beatsOf(g.S).m);
      if (pr.p !== want || pr.lights.length !== want || pr.cells !== C || C !== g.N * W) countBad ||= `${name} p ${p}: ${pr.p} lights, ${pr.cells} cells`;
      // level 1, by brute force over the row: light i is the onset nearest i/p within half a light (lo < x ≤ hi; a tie the earlier), then a whole light
      const rel = Array.from(r.tick, (t) => mod(t / r.grid - phaseX, 1));
      for (const x of pr.lights) {
        lightsChecked++;
        let best = null;
        for (const w of [1 / (2 * want), 1 / want]) {
          for (let i = 0; i < r.n && !false; i++) for (const y of [rel[i] - 1, rel[i], rel[i] + 1]) {
            if (!(y > x.at - w - 1e-12 && y <= x.at + w + 1e-12)) continue;
            const dd = y - x.at;
            if (!best || Math.abs(dd) < Math.abs(best.d) - 1e-12 || (Math.abs(Math.abs(dd) - Math.abs(best.d)) <= 1e-12 && dd < best.d)) best = { tick: r.tick[i], d: dd };
          }
          if (best) break;
        }
        if ((best ? best.tick : null) !== x.tick) placeBad ||= `${name} p ${want}: light ${x.i} at ${x.tick}, the row's nearest ${best?.tick}`;
        else if (x.tick != null && Math.abs(x.time - mod(x.tick / r.grid - phaseX, 1) * g.T) > 1e-12) placeBad ||= `${name}: light ${x.i}'s time`;
      }
      if (pr.lights[0].tick * pd !== pn * g.grid || pr.lights[0].time !== 0) placeBad ||= `${name}: light 0 is not the downbeat`;
      // level 2: cells partition the lights in order, within one of each other; cell j strikes light ⌊j·p/C⌋
      let at = 0, lo = Infinity, hi = 0;
      for (let j = 0; j < C; j++) { const c = cellLights(j, want, C); if (c.from !== at || c.from !== Math.floor((j * want) / C)) mapBad ||= `${name}: cell ${j}`; at = c.to; lo = Math.min(lo, c.to - c.from); hi = Math.max(hi, c.to - c.from); }
      if (at !== want || hi - lo > 1 || pr.emptyCells !== Math.max(0, C - want)) mapBad ||= `${name} p ${want}: cells cover ${at} lights, ${lo}–${hi} a cell, ${pr.emptyCells} empty`;
      const perc = d.hits.filter((h) => h.snap === 'prime');
      for (const h of perc) if (h.light !== Math.floor((h.cell * want) / C) || h.tick !== pr.lights[h.light].tick || h.voice !== 'perc') mapBad ||= `${name}: cell ${h.cell} struck light ${h.light}`;
      // the default selection: every cell (hits = C), as Partitions' secondary pattern E(C, C) has it; silent cells where a cell covers no light
      if (J(pr.selected) !== J(secondaryAllowed(C, C)) || pr.struck.length + pr.silent.length !== C) selBad ||= `${name}: ${pr.selected.length} selected`;
      if (want < C) under++;
      if (want < C && !(d.silentCells.some((c) => c.voice === 'perc' && c.bar === 0 && c.place === 0))) underBad ||= `${name}: p ${want} < ${C} cells, yet the downbeat cell sounds`;
      if (J(d.hits.filter((h) => h.voice !== 'perc')) !== J(arrangeDrums(spec, {}).hits.filter((h) => h.voice !== 'perc'))) selBad ||= `${name}: the backbeat under the prime line moved`;
      if (onsetFault(L, spec, d.hits)) placeBad ||= `${name}: ${onsetFault(L, spec, d.hits)}`;
    }
  }
  check(`p lights over C = N·S·m cells (S·m = S unless S < 4), p the prime nearest C by default, or asked (${n} runs)`, !countBad, countBad);
  check(`level 1: each light the onset nearest i/p of the cycle (half a light either side, then a whole), by brute force over the row; light 0 the downbeat (${lightsChecked} lights)`, !placeBad, placeBad);
  check('level 2: the C cells cut the p lights in order (cell j from light ⌊j·p/C⌋), within one light of each other; a lit cell strikes its first light, on the perc', !mapBad, mapBad);
  check('the default selection is Partitions\' secondary pattern over the cells, every cell (hits = C); the backbeat under the line unmoved', !selBad, selBad);
  check(`with p < C (the nearest prime below, as 32 → 31) the cells ⌊j·p/C⌋ leaves empty include the downbeat's: reported silent (${under} runs)`, !underBad && under > 0, underBad);

  const s = specs[1].spec, g = drumGrid(s), { cells: C, places: W } = gridShape(g);
  const h3 = primePartition(s, g, { hitsPerBar: 3, p: 37 });
  check(`hitsPerBar thins the cells: E(${h3.hits}, ${C}) is Partitions' secondary pattern exactly`, h3.hits === 3 * g.N && J(h3.selected) === J(secondaryAllowed(C, 3 * g.N)));
  const d0 = arrangeDrums(s, { mode: 'prime', p: 37 }), first = d0.hits.find((h) => h.snap === 'prime' && h.cell === 0);
  check('the first cell (the downbeat) is accented, as the partition line\'s first stroke', first && first.velocity === Math.min(1, DRUM_VELOCITY.perc + ACCENT + 0.04 * (first.strikes - 1)) && first.time === 0);
  // a grid replaces the selection: its perc row lights the cells, its other voices land as the grid does
  const grid = randomGrid(s, 7), dg = arrangeDrums(s, { mode: 'prime', p: 37, grid }), lit = [];
  grid.perc.forEach((line, k) => { for (let u = 0; u < W; u++) if (line[u] !== '.') lit.push(k * W + u); });
  const asGrid = arrangeDrums(s, { mode: 'grid', grid: { ...grid, perc: grid.perc.map((l) => '.'.repeat(l.length)) } });
  check(`a grid replaces the selection: its perc row lights ${lit.length} cells (each striking its first light), its other voices play as the grid`,
    J(dg.prime.selected) === J(lit) && dg.prime.struck.length + dg.prime.silent.length === lit.length
    && dg.hits.filter((h) => h.voice === 'perc').length === new Set(dg.prime.struck.map((x) => dg.prime.lights[x.light].tick)).size
    && dg.hits.filter((h) => h.voice === 'perc').every((h) => lit.includes(h.cell) && h.light === Math.floor((h.cell * 37) / C))
    && J(dg.hits.filter((h) => h.voice !== 'perc')) === J(asGrid.hits.filter((h) => h.voice !== 'perc')) && dg.hits.filter((h) => h.voice === 'perc').every((h) => h.snap === 'prime'));
  const accented = dg.hits.filter((h) => h.voice === 'perc' && grid.perc[Math.floor(h.cell / W)][h.cell % W] === 'X');
  check('…an X in the perc row accents its cell', accented.length > 0 && accented.every((h) => h.velocity === Math.min(1, DRUM_VELOCITY.perc + GRID_ACCENT.perc + 0.04 * (h.strikes - 1))));
  const one = arrangeDrums(s, { perBar: { 1: 'prime' }, p: 37 });
  check('a bar may be prime alone (perBar): only its cells strike', one.hits.filter((h) => h.snap === 'prime').every((h) => Math.floor(h.cell / W) === 1) && one.hits.some((h) => h.snap === 'prime'));
  const lv = levelOneLights(g, { source: 'prime', p: 37 });
  check('levelOneLights({ source: \'prime\', p }) is the seam\'s level 1: p lights, tickAt(i) each light\'s onset', lv.count === 37 && lv.tickAt(0) === primeLights(g, 37)[0].tick && lv.tickAt(5) === d0.prime.lights[5].tick);
  const L1 = d0.prime.lights[3];
  check(`the lights are exposed for the UI strip: { i, at, tick, time, r, bar, pos, slot, snap } (light 3: ${L1.time.toFixed(4)} s, bar ${L1.bar + 1} slot ${L1.pos.toFixed(3)})`, Object.keys(L1).join() === 'i,at,tick,time,r,bar,pos,slot,snap' && L1.time === L1.r * g.T);
  check('the drums are JSON with the prime partition on (a spec stays serialisable)', J(JSON.parse(J(d0))) === J(d0));
}

console.log('\n— determinism and refusals');
{
  let same = true;
  for (const { spec } of specs.slice(0, 12)) {
    const grid = randomGrid(spec, 3);
    for (const o of [{ grid }, { mode: 'prime' }, { mode: 'prime', grid }, { mode: 'prime', hitsPerBar: 2 }]) {
      const a = arrangeDrums(spec, { ...o, seed: 1 }), b = arrangeDrums(spec, { ...o, seed: 1 }), c = arrangeDrums(spec, { ...o, seed: 2 });
      if (J(a) !== J(b) || J(a.hits) !== J(c.hits)) same = false;
    }
  }
  check('grid and prime: the same inputs, byte-identical drums; the seed moves neither', same);
  const s = specs[1].spec, N = s.knobs.bars, W = s.knobs.slotsPerBar;
  const ok = { kick: Array(N).fill('x'.repeat(W)) };
  check('refusals: mode grid with no grid; a grid of the wrong bars or places, an unknown voice or character; p not a prime',
    throws(() => arrangeDrums(s, { mode: 'grid' }), /none was given/)
    && throws(() => arrangeDrums(s, { grid: { kick: ok.kick.slice(1) } }), /bar/)
    && throws(() => arrangeDrums(s, { grid: { kick: ok.kick.map((l) => l + 'x') } }), /places/)
    && throws(() => arrangeDrums(s, { grid: { cowbell: ok.kick } }), /no drum voice/)
    && throws(() => arrangeDrums(s, { grid: { kick: ok.kick.map(() => 'o'.repeat(W)) } }), /x a stroke/)
    && throws(() => arrangeDrums(s, { mode: 'prime', p: 32 }), /prime/)
    && throws(() => readGrid([]), /voice/));
  check('a grid with no mode plays as mode grid; a voice left out is silent', arrangeDrums(s, { grid: ok }).mode === 'grid' && arrangeDrums(s, { grid: ok }).hits.every((h) => h.voice === 'kick' || h.voice === 'snare' || h.voice === 'cym'));
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
