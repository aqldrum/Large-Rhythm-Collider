// rhythm-inspector-model.js — pure selected-rhythm presentation data for the Cosmos inspector.
// It mirrors the main page's Rhythm Info vocabulary without importing its stateful UI/module graph.
import { deriveSelectedRhythmModel, lcmAll, normalizeLayers } from './oracle-core.js?v=2';

const LAYER_NAMES = ['A', 'B', 'C', 'D'];

// Cheap closed-form metrics for a rhythm too dense to build the full composite model without a synchronous
// freeze: deriveRhythm's positions loop materializes one entry per layer attack, i.e. O(layerSum), which is
// exactly the cost the card's onset cap exists to refuse. Everything here is O(layers) — it never walks the
// composite tape — and mirrors the same-named fields of buildRhythmInspectorModel EXACTLY (grid = LCM of the
// GCD-reduced layers, fundamental = grid / fastest layer, density = 100·layerSum/grid, which is scale-
// invariant), so a too-dense card and a normal card report identical structure for the fields it covers.
// The distinct composite onset COUNT still needs the walk; layerSum is its exact upper bound (Σ layer
// attacks, before coincidences merge), so the true count is ≤ maxOnsets.
export function lightRhythmMetrics(rawLayers) {
  const layers = normalizeLayers(rawLayers);
  const grid = lcmAll(layers);
  const groupings = layers.map(layer => grid / layer);
  const layerSum = layers.reduce((sum, layer) => sum + layer, 0);
  const groupingSum = groupings.reduce((sum, grouping) => sum + grouping, 0);
  return {
    layers,
    identity: layers.join(' : '),
    grid,
    groupings,
    fundamental: grid / layers[0],
    layerSum,
    range: layers.length ? layers[0] / layers.at(-1) : 0,
    density: grid ? 100 * layerSum / grid : 0,
    pulseToGrouping: groupingSum ? layerSum / groupingSum : 0,
    maxOnsets: layerSum,
  };
}

function averageStepDeviation(ratios) {
  if (ratios.length !== 12) return null;
  const cents = ratios.map(ratio => ratio.cents).sort((a, b) => a - b);
  const withOctave = [...cents, 1200];
  let total = 0;
  for (let i = 1; i < withOctave.length; i++) total += Math.abs(100 - (withOctave[i] - withOctave[i - 1]));
  return total / 12;
}

export function buildRhythmInspectorModel(rawLayers) {
  const scale = deriveSelectedRhythmModel(rawLayers);
  const layers = scale.layers;
  const nodes = scale.nodes.map(node => ({
    ...node,
    owners: node.ownerIndexes.map(index => LAYER_NAMES[index]),
  }));

  const groupings = layers.map(layer => scale.grid / layer);
  const layerSum = layers.reduce((sum, layer) => sum + layer, 0);
  const groupingSum = groupings.reduce((sum, grouping) => sum + grouping, 0);
  const range = layers.length ? layers[0] / layers.at(-1) : 0;

  return {
    key: scale.key,
    identity: layers.join(' : '),
    layers,
    groupings,
    grid: scale.grid,
    fundamental: scale.fundamental,
    range,
    density: scale.grid ? 100 * layerSum / scale.grid : 0,
    pulseToGrouping: groupingSum ? layerSum / groupingSum : 0,
    compositeLength: nodes.length,
    layerSum,
    pitchCount: scale.cardinality,
    avgDeviation: averageStepDeviation(scale.ratios),
    ratios: scale.ratios.map(ratio => ({ ...ratio })),
    nodes,
    maxGap: scale.maxGap,
  };
}
