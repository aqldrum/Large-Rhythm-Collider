// mn-core.js — per-rhythm Master-Network content, ported from the Compiler's NetworkCalc. It's pure
// number theory on a rhythm's layer tuple (gcd-reduce pairs → Root Doubles; classify triples as
// CT/IT/RDCP), so it works at ANY cardinality with no network context or cache. Flight uses it to show
// a node's MN motifs and to seed the "hyperlane" family web (grids that host a motif at some scalar =
// multiples of the motif's base-LCM).
export function gcd(a, b) { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) { const t = b; b = a % b; a = t; } return a || 1; }
export function lcm(a, b) { return a / gcd(a, b) * b; }
export function arrLcm(vs) { return vs.reduce((m, v) => lcm(m, v), 1); }
export function arrGcd(vs) { return vs.reduce((g, v) => gcd(g, v)); }

// a layer pair, gcd-reduced to coprime hi:lo (base-LCM = hi·lo)
export function normPair(a, b) {
  const d = gcd(a, b); let x = Math.round(a / d), y = Math.round(b / d);
  if (x < y) { const t = x; x = y; y = t; }
  return (x > 0 && y > 0) ? { key: x + ':' + y, values: [x, y] } : null;
}

// classify a layer triple, gcd-reduced to a coprime SET → { type: CT|IT|RDCP, values(desc), key } | null.
// CT = all three pairwise-coprime · IT = all three pairwise share a factor · RDCP = mixed. Matches
// NetworkCalc._normalize{Triple,InterlockingTriple,RDCPTriple} (which each accept one class).
export function classifyTriple(a, b, c) {
  const d = arrGcd([a, b, c]); const x = Math.round(a / d), y = Math.round(b / d), z = Math.round(c / d);
  if (![x, y, z].every(v => Number.isFinite(v) && v > 0)) return null;
  if (arrGcd([x, y, z]) !== 1) return null;                    // must reduce to a coprime set
  const gAB = gcd(x, y), gAC = gcd(x, z), gBC = gcd(y, z);
  const type = (gAB === 1 && gAC === 1 && gBC === 1) ? 'CT'
             : (gAB > 1 && gAC > 1 && gBC > 1) ? 'IT' : 'RDCP';
  const s = [x, y, z].sort((p, q) => q - p);
  return { type, values: s, key: type + ':' + s.join(':') };
}

// distinct Root Doubles of a rhythm (all layer pairs)
export function rhythmDoubles(layers) {
  const seen = new Map();
  for (let i = 0; i < layers.length - 1; i++) for (let j = i + 1; j < layers.length; j++) {
    const p = normPair(layers[i], layers[j]); if (!p) continue;
    if (!seen.has(p.key)) seen.set(p.key, { kind: 'RD', key: p.key, values: p.values, base: p.values[0] * p.values[1] });
  }
  return [...seen.values()];
}
// distinct classified triples of a rhythm; base = LCM of the reduced triple (the family's scalar step)
export function rhythmTriples(layers) {
  const seen = new Map();
  for (let i = 0; i < layers.length - 2; i++) for (let j = i + 1; j < layers.length - 1; j++) for (let k = j + 1; k < layers.length; k++) {
    const t = classifyTriple(layers[i], layers[j], layers[k]); if (!t) continue;
    if (!seen.has(t.key)) seen.set(t.key, { kind: t.type, key: t.key, values: t.values, base: arrLcm(t.values) });
  }
  return [...seen.values()];
}
