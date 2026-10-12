// Assertions for the grid super-row (engine/grid-super-row.js).
//   node Cosmos/tests/assert-grid-super-row.mjs
// Expected values come from a second producer written here that shares nothing with the module: rhythms are found
// by walking ticks, antichains by enumerating every subset of divisors, tones as reduced whole-number fractions.
// When a MacroTonal checkout sits beside this repo (or MACROTONAL_ROOT names one), the grid row is also checked
// node for node against chunk-super-row.js's own row of the same rhythms, and the chunk-tunes miner is run on it.
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildGridSuperRow, gridSuperRowSources, gridSuperRowSummary, onsetCount, isValidOnGrid, maximalLayers,
  maxOnsetRhythm, maxLayerRhythm, factorize,
} from '../engine/grid-super-row.js';
import { gridResults, directFactorRedundant } from '../engine/grid-core.js';
import { buildGridCull2Readout } from '../engine/cull2-grid-core.js';
import { deriveScale } from '../engine/oracle-core.js';

let PASS = true;
const check = (name, ok, detail = '') => {
  PASS = PASS && ok;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('═══ GRID SUPER-ROW — assertions ═══');

// ── the second producer ──
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const lcm = (a, b) => (a / gcd(a, b)) * b;
const divisors = (G) => { const d = []; for (let i = 1; i <= G; i++) if (G % i === 0) d.push(i); return d; };
const phi = (n) => { let c = 0; for (let i = 1; i <= n; i++) if (gcd(i, n) === 1) c++; return c; };
/** ticks of [0, G) some layer strikes */
const walk = (G, layers) => { const t = []; for (let i = 0; i < G; i++) if (layers.some((L) => (i * L) % G === 0)) t.push(i); return t; };
/** reduced fold(longest / gap) and its register, in whole numbers */
const foldTone = (longest, gap) => { let num = longest, den = gap, octave = 0; while (num >= 2 * den) { den *= 2; octave++; } const g = gcd(num, den); return { fraction: `${num / g}/${den / g}`, octave }; };
const bruteValid = (G, S) => S.length >= 2 && S.every((L) => L >= 2 && L < G && G % L === 0) && S.reduce(lcm) === G && S.reduce(gcd) === 1
  && !S.some((a) => S.some((b) => a !== b && a % b === 0));
/** every valid layer set of G, any size */
function allValid(G) {
  const ds = divisors(G).filter((d) => d >= 2 && d < G), out = [];
  for (let mask = 1; mask < 1 << ds.length; mask++) {
    const S = ds.filter((_, i) => mask & (1 << i));
    if (bruteValid(G, S)) out.push(S);
  }
  return out;
}

// ── onset counting by divisor classes ──
{
  let bad = 0, tried = 0;
  for (const G of [12, 30, 36, 60, 72, 120, 210, 360, 840]) {
    const ds = divisors(G).filter((d) => d >= 2 && d < G);
    for (let k = 0; k < 40; k++) {
      const S = ds.filter((_, i) => ((k * 2654435761 + i * 40503) >>> (i % 13)) & 1);
      if (!S.length) continue;
      tried++;
      if (onsetCount(G, S) !== walk(G, S).length) bad++;
    }
  }
  check('onsetCount (divisor classes) equals walking every tick', bad === 0, `${tried} layer sets, ${bad} wrong`);
}

// ── the extremal rhythms against exhaustive enumeration ──
{
  const grids = [12, 24, 30, 36, 48, 60, 72, 84, 90, 96, 120, 144, 168, 180, 210, 240];
  let onsetBad = [], layerBad = [], validBad = [];
  for (const G of grids) {
    const all = allValid(G);
    const bestOn = Math.max(0, ...all.map((S) => walk(G, S).length));
    const bestLy = Math.max(0, ...all.map((S) => S.length));
    const on = maxOnsetRhythm(G), ly = maxLayerRhythm(G);
    if (!on.exact || walk(G, on.layers).length !== bestOn) onsetBad.push(G);
    if (!ly.exact || ly.layers.length !== bestLy) layerBad.push(G);
    if (!isValidOnGrid(G, on.layers) || !isValidOnGrid(G, ly.layers)) validBad.push(G);
  }
  check('max-onset rhythm reaches the exhaustive optimum', !onsetBad.length, onsetBad.length ? `wrong at ${onsetBad}` : `${grids.length} grids`);
  check('max-layer rhythm reaches the exhaustive optimum (level shortcut and search alike)', !layerBad.length, layerBad.length ? `wrong at ${layerBad}` : `${grids.length} grids`);
  check('both extremal rhythms are codex-valid (lcm G, gcd 1, irredundant)', !validBad.length, validBad.join(','));
}

// ── the maximal-divisor rhythm ──
{
  let bad = [];
  for (const G of [6, 12, 30, 60, 210, 360, 2310, 2640]) {
    const m = maximalLayers(G), f = factorize(G), rad = f.reduce((r, [p]) => r * p, 1);
    const antichainOfMaxima = divisors(G).filter((d) => d >= 2 && d < G && !divisors(G).some((e) => e !== d && e < G && e % d === 0));
    if (!same(m.layers, antichainOfMaxima)) bad.push(`${G}: layers`);
    if (walk(G, m.layers).length !== G - phi(G)) bad.push(`${G}: onsets`);
    if (m.valid !== (rad === G)) bad.push(`${G}: validity`);
  }
  check('maximal = the divisors dividing no other proper divisor; onsets G − φ(G); valid iff squarefree', !bad.length, bad.join('; '));
  check('a prime power has no maximal polyrhythm', maximalLayers(64) === null && maximalLayers(81) === null);
}

// ── sources: keep2 is the codex kept set, owners is the Cull2 overlay's set ──
for (const G of [120, 360, 840]) {
  const k = gridSuperRowSources(G, 'keep2');
  const codex = gridResults(G).kept.map((s) => [...s.layers].sort((a, b) => b - a).join('.')).sort();
  check(`keep2 sources at ${G} are gridResults' kept set`, same(k.sources.map((s) => s.key).sort(), codex), `${k.sources.length} rhythms`);
  const o = gridSuperRowSources(G, 'owners');
  const overlay = buildGridCull2Readout(G).rhythms.map((r) => [...r.layers].sort((a, b) => b - a).join('.')).sort();
  check(`owners sources at ${G} are the Cull2 grid overlay's rhythms`, same(o.sources.map((s) => s.key).sort(), overlay), `${o.sources.length} rhythms`);
}

// ── the row against a tick-walked row ──
function bruteRow(G, sources, tones) {
  const all = [];
  sources.forEach((s, r) => {
    const ticks = walk(G, s.layers);
    const gaps = ticks.map((t, i) => (i + 1 < ticks.length ? ticks[i + 1] : G + ticks[0]) - t), longest = Math.max(...gaps);
    ticks.forEach((t, i) => all.push({ t, r, i, own: foldTone(longest, gaps[i]), owners: s.layers.reduce((m, L, b) => ((t * L) % G === 0 ? m | (1 << b) : m), 0) }));
  });
  all.sort((p, q) => p.t - q.t || p.r - q.r);
  if (tones === 'respaced') {
    const ticks = [...new Set(all.map((a) => a.t))];
    const gaps = ticks.map((t, i) => (i + 1 < ticks.length ? ticks[i + 1] : G + ticks[0]) - t), longest = Math.max(...gaps);
    const toneAt = new Map(ticks.map((t, j) => [t, foldTone(longest, gaps[j])]));
    for (const a of all) a.tone = toneAt.get(a.t);
  } else for (const a of all) a.tone = a.own;
  return all;
}
for (const [G, mode] of [[120, 'keep2'], [210, 'keep2'], [360, 'owners'], [360, 'onsets'], [840, 'layers'], [60, 'maximal']]) for (const tones of ['native', 'respaced']) {
  const row = buildGridSuperRow(G, { source: mode, tones }), brute = bruteRow(G, row.rhythms, tones);
  const got = Array.from({ length: row.n }, (_, i) => [row.num[i], row.rhythm[i], row.node[i], row.tones[row.tone[i]], row.octave[i], row.owners[i]]);
  const want = brute.map((a) => [a.t, a.r, a.i, a.tone.fraction, a.tone.octave, a.owners]);
  check(`row ${G} ${mode} ${tones} equals the tick-walked row`, same(got, want), `${row.n} nodes, ${row.moments.n} onsets, ${row.tones.length} tones`);
}

// ── onset sets nest; extremal counts order ──
{
  const bad = [];
  for (const G of [60, 120, 210, 360, 840, 2310]) {
    const ticks = (mode) => new Set(buildGridSuperRow(G, { source: mode }).moments.tick);
    const ow = ticks('owners'), k2 = ticks('keep2'), mx = ticks('maximal'), on = ticks('onsets');
    if (![...ow].every((t) => k2.has(t))) bad.push(`${G}: owners ⊄ keep2`);
    if (![...k2].every((t) => mx.has(t))) bad.push(`${G}: keep2 ⊄ maximal`);
    if (!(k2.size <= on.size && on.size <= mx.size)) bad.push(`${G}: |keep2| ${k2.size} ≤ |onsets| ${on.size} ≤ |maximal| ${mx.size}`);
    if (maximalLayers(G).valid && on.size !== mx.size) bad.push(`${G}: squarefree yet onsets < maximal`);
  }
  check('owners ⊆ keep2 ⊆ maximal; |keep2| ≤ |onsets| ≤ |maximal|, equal at the top when squarefree', !bad.length, bad.join('; '));
}

// ── respaced tones are the scale of the union of layers ──
{
  const bad = [];
  for (const G of [120, 360, 840, 2640]) {
    const row = buildGridSuperRow(G, { source: 'keep2', tones: 'respaced' });
    const union = [...new Set(row.rhythms.flatMap((r) => r.layers))];
    const irredundant = union.filter((a) => !union.some((b) => b !== a && b % a === 0));
    const scale = deriveScale(irredundant).ratios.map((r) => r.fraction);
    const tones = row.tones.filter((f) => f !== '2/1');
    if (!same([...tones].sort(), [...scale].sort())) bad.push(`${G}: row ${tones} vs scale ${scale}`);
    for (let j = 0; j < row.moments.n; j++) {
      const ts = new Set(); for (let i = row.moments.start[j]; i < row.moments.start[j + 1]; i++) ts.add(row.tone[i]);
      if (ts.size !== 1) { bad.push(`${G}: onset ${j} has ${ts.size} tones`); break; }
    }
    if (isValidOnGrid(G, irredundant.sort((a, b) => a - b)) !== true) bad.push(`${G}: the union is not a valid rhythm`);
  }
  check('a respaced keep2 row is deriveScale of every layer the kept set uses, one tone per onset', !bad.length, bad.join('; '));
}

// ── the finding: density starves the respaced scale ──
// Between two ticks coprime to an even G sits an even tick, so the gaps of the maximal row are 1 and 2: one tone.
{
  const evenGrids = [6, 30, 60, 120, 210, 360, 840, 2310, 2640, 27720];
  const ones = evenGrids.filter((G) => { const r = buildGridSuperRow(G, { source: 'maximal', tones: 'respaced' }); return same(r.tones, ['1/1']); });
  check('the maximal row of every even grid sounds one tone (1/1)', ones.length === evenGrids.length, `${ones.length}/${evenGrids.length}`);
  const rows = [840, 2310, 2640].map((G) => [G, gridSuperRowSummary(buildGridSuperRow(G, { source: 'keep2', tones: 'native' })), gridSuperRowSummary(buildGridSuperRow(G, { source: 'keep2', tones: 'respaced' }))]);
  check('keep2: respaced has far fewer tones than native', rows.every(([, n, r]) => r.toneCount * 5 < n.toneCount), rows.map(([G, n, r]) => `${G}: ${n.toneCount} → ${r.toneCount}`).join(', '));
}

// ── against MacroTonal's chunk-super-row, and the miner on a grid row ──
const here = path.dirname(fileURLToPath(import.meta.url));
const mtRoot = process.env.MACROTONAL_ROOT || path.resolve(here, '../../../MacroTonal');
const mtRow = path.join(mtRoot, 'econ/runtime/chunk-super-row.js');
if (!existsSync(mtRow)) {
  console.log(`  · MacroTonal not found at ${mtRoot} — chunk-super-row cross-check skipped (set MACROTONAL_ROOT)`);
} else {
  const mt = await import(pathToFileURL(mtRow).href);
  const lines = await import(pathToFileURL(path.join(mtRoot, 'econ/runtime/chunk-lines.js')).href);
  const fields = ['x', 'num', 'rhythm', 'node', 'tone', 'octave', 'owners', 'moment'];
  for (const G of [120, 360, 840]) {
    const row = buildGridSuperRow(G, { source: 'keep2', tones: 'native' });
    const theirs = mt.buildNormalizedRow(row.rhythms.map((r) => ({ villageId: r.key, layers: r.layers })));
    const diff = fields.filter((f) => !same(Array.from(row[f]), Array.from(theirs[f])));
    if (!same(row.tones, theirs.tones)) diff.push('tones');
    if (!same(Array.from(row.moments.start), Array.from(theirs.moments.start)) || !same(Array.from(row.moments.strikes), Array.from(theirs.moments.strikes))) diff.push('moments');
    check(`keep2 native row at ${G} is chunk-super-row's normalized row of the same rhythms`, !diff.length, diff.length ? `differs in ${diff}` : `${row.n} nodes`);
  }
  {
    const G = 360, row = buildGridSuperRow(G, { source: 'keep2', tones: 'native' });
    const theirs = mt.buildNormalizedRow(row.rhythms.map((r) => ({ villageId: r.key, layers: r.layers })));
    const a = mt.slotCandidates(row, { P: 8 }), b = mt.slotCandidates(theirs, { P: 8 });
    check(`slotCandidates reads the grid row as it reads its own (${G}, P 8)`, same(a, b));
    const types = lines.LINE_TYPES.filter((t) => t.type === 'cell');
    const mine = lines.mineLines(row, { types }), own = lines.mineLines(theirs, { types });
    check(`mineLines (cells) on the grid row finds what it finds on chunk-super-row's (${G})`, mine.lines.length > 0 && same(mine.lines.map((l) => l.serial), own.lines.map((l) => l.serial)), `${mine.lines.length} lines`);
  }
}

console.log(PASS ? '\nALL PASS' : '\nFAILURES ABOVE');
process.exit(PASS ? 0 : 1);
