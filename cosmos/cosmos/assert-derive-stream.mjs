// deriveScale streams the composite (oracle-core.js compositeSpaces) instead of materializing every attack.
// These guards hold it to the ORIGINAL materializing derivation, kept verbatim below as the reference: the
// model must be byte-identical — ratios, ratioSet, key, sourceFractions order and all — on every layer set whose
// grid is an exact double (≤ 2^53; the Hilbert cube stops at 2^24). It is the codex identity, so no drift.
import { deriveScale, deriveSelectedRhythmModel, normalizeLayers, lcmAll, decimalToFraction, ratioToCents } from '../oracle-core.js';
import { divisorsFast, shardKeysOf, gridShardSolve, REAL_RHYTHM_MAX_RANGE } from '../grid-core.js';

let PASS = true;
const check = (label, ok, detail = '') => {
  if (!ok) PASS = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
console.log('═══ COSMOS STREAMED deriveScale — assertions ═══');

// The pre-2026-09-27 scale-only derivation: every attack in a Set, sorted, every gap converted.
function referenceDeriveScale(rawLayers) {
  const layers = normalizeLayers(rawLayers);
  const grid = lcmAll(layers);
  const positions = new Set();
  for (const L of layers) { const gs = grid / L; for (let i = 0; i < L; i++) positions.add(i * gs); }
  const comp = Array.from(positions).sort((a, b) => a - b);
  const spaces = [];
  for (let i = 0; i < comp.length - 1; i++) spaces.push(comp[i + 1] - comp[i]);
  spaces.push(grid - comp[comp.length - 1] + comp[0]);
  let spaceFund = 0; for (const s of spaces) if (s > spaceFund) spaceFund = s;
  const ratioMap = new Map();
  for (const s of spaces) {
    if (!(s > 0)) continue;
    const rawRatio = spaceFund / s, rawFraction = decimalToFraction(rawRatio);
    let ratio = rawRatio; while (ratio >= 2) ratio /= 2; while (ratio < 1) ratio *= 2;
    const fraction = decimalToFraction(ratio), existing = ratioMap.get(fraction);
    if (existing) { if (!existing.sourceFractions.includes(rawFraction)) existing.sourceFractions.push(rawFraction); }
    else ratioMap.set(fraction, { fraction, ratio, cents: ratioToCents(ratio), sourceFractions: [rawFraction] });
  }
  ratioMap.delete('2/1');
  const ratios = Array.from(ratioMap.values()).sort((a, b) => a.ratio - b.ratio);
  return { inputLayers: rawLayers.slice(), layers, key: layers.join('.'), grid, enteredGrid: lcmAll(rawLayers),
    fundamental: grid / layers[0], cardinality: ratios.length, ratios, ratioSet: ratios.map(r => r.fraction).join(' ') };
}
const same = layers => JSON.stringify(deriveScale(layers)) === JSON.stringify(referenceDeriveScale(layers));

// 1. Codex grids: every 2- and (windowed) 3/4-layer subset of their divisors — the corpus the codex was built from.
{
  let n = 0, bad = null;
  for (const g of [552, 2640, 7920, 15840]) {
    const d = divisorsFast(g).filter(x => x > 1);
    for (let i = 0; i < d.length && !bad; i++) for (let j = i + 1; j < d.length && !bad; j++) {
      const sets = [[d[i], d[j]]];
      for (let k = j + 1; k < d.length && k < j + 4; k++) { sets.push([d[i], d[j], d[k]]); if (k + 1 < d.length) sets.push([d[i], d[j], d[k], d[k + 1]]); }
      for (const s of sets) { n++; if (!same(s)) { bad = s; break; } }
    }
  }
  check('identical to the materializing derivation across codex-grid layer subsets', !bad, bad ? `differs at [${bad}]` : `${n.toLocaleString()} sets`);
}
// 2. Random layer sets (1–5 layers), restricted to exact-double grids.
{
  let seed = 7, n = 0, bad = null;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  while (n < 2000 && !bad) {
    const s = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => 1 + Math.floor(rnd() * 5000));
    if (!Number.isSafeInteger(lcmAll(normalizeLayers(s)))) continue;
    n++; if (!same(s)) bad = s;
  }
  check('identical on random 1–5-layer sets with exact grids', !bad, bad ? `differs at [${bad}]` : `${n.toLocaleString()} sets`);
}
// 3. Deep layers (the case the old MAX_GRID_LAYER cap existed for), still small enough for the reference.
{
  const deep = [[999_983, 2], [1_048_576, 3, 7], [786_432, 1_000_003]];
  check('identical on deep (≥ ~1M-attack) layer sets', deep.every(same), deep.map(s => `[${s}]`).join(' '));
}
// 4. The selected-rhythm path (withNodes) still materializes, and agrees with the scale path on the scale.
{
  const s = [12, 8, 3], full = deriveSelectedRhythmModel(s), lean = deriveScale(s);
  check('the node path agrees with the streamed scale path', full.ratioSet === lean.ratioSet && full.key === lean.key && full.nodes.length > 0);
}
// 5. The shard that motivated it: grid 16,777,170's deepest shard (8,388,585) — was 19.7 s / 1.2 GB.
{
  const g = 16_777_170, keys = shardKeysOf(g), A = keys[keys.length - 1];
  const t0 = performance.now();
  const r = gridShardSolve(g, A, divisorsFast(g).filter(d => d >= 2 && d < A), REAL_RHYTHM_MAX_RANGE);
  const ms = performance.now() - t0;
  // Generous bound: the point is "seconds, not tens of seconds" on any reasonable machine, not a benchmark.
  check('the deepest shard of grid 16,777,170 solves in seconds, not tens', ms < 10_000 && r.count >= 0, `${Math.round(ms)} ms, ${r.count} kept`);
}

console.log(PASS ? '\n✓ COSMOS STREAMED deriveScale OK' : '\n✗ COSMOS STREAMED deriveScale FAILED');
process.exitCode = PASS ? 0 : 1;
