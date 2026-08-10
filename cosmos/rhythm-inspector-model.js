// rhythm-inspector-model.js — pure selected-rhythm presentation data for the Cosmos inspector.
// It mirrors the main page's Rhythm Info vocabulary without importing its stateful UI/module graph.
import { deriveSelectedRhythmModel } from './oracle-core.js?v=2';

const LAYER_NAMES = ['A', 'B', 'C', 'D'];

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
