// oracle-core.js — pure, testable core. No DOM. Runs in browser and Node.
// Ports the engine's authoritative scale derivation (ReplicantCalculator.generateRatios)
// and the codex identity (gcd-normalized descending layer tuple).

export function gcd2(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
export function gcdAll(xs) { return xs.reduce((a, b) => gcd2(a, b)); }
export function lcm2(a, b) { return (a / gcd2(a, b)) * b; }
export function lcmAll(xs) { return xs.reduce((a, b) => lcm2(a, b)); }

// Canonical codex key: divide by gcd, sort descending. e.g. [46,48] -> "24.23"
export function normalizeLayers(layers) {
  const g = gcdAll(layers);
  return layers.map(x => x / g).sort((a, b) => b - a);
}
export function keyOf(layers) { return normalizeLayers(layers).join('.'); }

// LRC Core Interface fraction (tolerance 1e-6, denom<=1000). Implemented via continued-
// fraction convergents — verified bit-identical to the site's linear scan across 31.5M
// real ratios, but O(log) instead of O(1000): the key to generating dense grids live.
export function decimalToFraction(decimal) {
  const tolerance = 1e-6, maxDen = 1000;
  let h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = decimal;
  let bestN = 1, bestD = 1, bestErr = Math.abs(decimal - 1);
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    const err = Math.abs(decimal - h1 / k1);
    if (err < bestErr) { bestErr = err; bestN = h1; bestD = k1; }
    if (err < tolerance) break;
    const frac = b - a; if (frac < 1e-12) break; b = 1 / frac;
  }
  const g = gcd2(bestN, bestD);
  return `${bestN / g}/${bestD / g}`;
}

export function ratioToCents(ratio) { return 1200 * Math.log2(ratio); }

// One composite derivation shared by the scale-only solver path and the richer selected-rhythm UI/audio
// path. `withNodes` stays opt-in: deriveScale is called across enormous solve corpora and must retain its
// lean Set-based path, while a selected rhythm needs attack ownership plus raw/folded ratio identity.
function deriveRhythm(rawLayers, withNodes = false) {
  const layers = normalizeLayers(rawLayers);
  const grid = lcmAll(layers);
  const fundamental = grid / layers[0]; // grid / fastest layer (matches codex `fundamental`)

  // composite attack points: i*groupingSize for i in [0, L) — endpoint is the wraparound
  const positions = withNodes ? new Map() : new Set();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const L = layers[layerIndex];
    const gs = grid / L;
    for (let i = 0; i < L; i++) {
      const tick = i * gs;
      if (!withNodes) positions.add(tick);
      else {
        let owners = positions.get(tick);
        if (!owners) positions.set(tick, owners = []);
        owners.push(layerIndex);
      }
    }
  }
  const comp = Array.from(withNodes ? positions.keys() : positions).sort((a, b) => a - b);
  const spaces = [];
  for (let i = 0; i < comp.length - 1; i++) spaces.push(comp[i + 1] - comp[i]);
  spaces.push(grid - comp[comp.length - 1] + comp[0]); // wraparound space

  let spaceFund = 0; for (const s of spaces) if (s > spaceFund) spaceFund = s; // largest space (loop, not
  // spread: at huge grids `spaces` has millions of entries and Math.max(...spaces) overflows the call stack)
  const ratioMap = new Map();
  const fractionCache = withNodes ? new Map([[1, '1/1']]) : null;
  const fractionFor = value => {
    if (!fractionCache) return decimalToFraction(value);
    let fraction = fractionCache.get(value);
    if (!fraction) { fraction = decimalToFraction(value); fractionCache.set(value, fraction); }
    return fraction;
  };
  const nodes = withNodes ? [] : null;
  for (let i = 0; i < spaces.length; i++) {
    const s = spaces[i];
    if (s > 0) {
      const rawRatio = spaceFund / s;
      const rawFraction = fractionFor(rawRatio);
      let ratio = rawRatio;
      while (ratio >= 2) ratio /= 2;
      while (ratio < 1) ratio *= 2;
      const fraction = fractionFor(ratio);
      const existing = ratioMap.get(fraction);
      if (existing) {
        if (!existing.sourceFractions.includes(rawFraction)) existing.sourceFractions.push(rawFraction);
      } else {
        ratioMap.set(fraction, { fraction, ratio, cents: ratioToCents(ratio), sourceFractions: [rawFraction] });
      }
      if (nodes) nodes.push({
        tick: comp[i],
        phase: comp[i] / grid,
        gap: s,
        ownerIndexes: [...positions.get(comp[i])],
        rawRatio,
        rawFraction,
        foldedRatio: ratio,
        fraction,
        // Compatibility alias for the existing plot/scale-highlight consumers.
        ratioFraction: fraction,
      });
    }
  }
  ratioMap.delete('2/1'); // the octave is not a scale tone — presence of 2/1 never distinguishes a tuning system
  const ratios = Array.from(ratioMap.values()).sort((a, b) => a.ratio - b.ratio);
  const model = {
    inputLayers: rawLayers.slice(),
    layers,                    // normalized
    key: layers.join('.'),
    grid,                      // home grid (LCM of normalized layers)
    enteredGrid: lcmAll(rawLayers),
    fundamental,
    cardinality: ratios.length,
    ratios,
    ratioSet: ratios.map(r => r.fraction).join(' '),
  };
  if (nodes) { model.nodes = nodes; model.maxGap = spaceFund; }
  return model;
}

// Derive the scale exactly as the LRC site core (LRCModule.generateCompositeRhythm →
// generateSpacesPlot → generateRatiosWithFrequency, then delete "2/1"). Any cardinality.
export function deriveScale(rawLayers) {
  return deriveRhythm(rawLayers, false);
}

// Selected-rhythm canonical model: the same scale derivation plus ordered attacks and enough identity to
// distinguish literal 1/1 from octave-folded 2/1, 4/1, …. Build once, then share between card and audition.
export function deriveSelectedRhythmModel(rawLayers) {
  return deriveRhythm(rawLayers, true);
}

// Consult the codex. `index` is the loaded oracle-index.json (sorted keys[] + parallel arrays).
// Returns a verdict object the UI renders.
export function consult(rawLayers, index) {
  const scale = deriveScale(rawLayers);
  const reduced = scale.enteredGrid !== scale.grid; // input had a common factor

  if (scale.cardinality !== index.meta.cardinality) {
    return {
      status: 'off-cardinality', scale, reduced,
      headline: `${scale.cardinality}-TONE SCALE`,
      detail: `Outside the ${index.meta.cardinality}T codex. This is cardinality ${scale.cardinality} — ${scale.cardinality < index.meta.cardinality ? 'a smaller tuning system' : 'unexplored high-cardinality territory'}.`,
    };
  }

  const at = binarySearch(index.keys, scale.key);
  if (at >= 0) {
    return {
      status: 'known', scale, reduced, indexPos: at,
      homeGrid: index.grid[at], fundamental: index.fund[at],
      motherTag: index.mtags[index.mtag[at]], isMother: !!index.isMother[at],
      headline: 'KNOWN SCALE',
      detail: `Charted at grid ${index.grid[at]}, fundamental ${index.fund[at]}` +
              (index.isMother[at] ? ' — a Mother Scale.' : `, in network ${index.mtags[index.mtag[at]]}.`),
    };
  }
  return {
    status: 'new', scale, reduced,
    headline: 'NEW SCALE FOUND',
    detail: `This ${scale.cardinality}-tone scale is not in the charted codex. You found open space.`,
  };
}

export function binarySearch(arr, target) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

// Parse free-form input: "24 23", "24,23", "24:23", "7-5-3-2"
export function parseLayers(str) {
  const nums = (str.match(/\d+/g) || []).map(Number).filter(n => n >= 1);
  return nums;
}
