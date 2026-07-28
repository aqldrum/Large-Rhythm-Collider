// rhythm-inspector-model.js — pure selected-rhythm presentation data for the Cosmos inspector.
// It mirrors the main page's Rhythm Info vocabulary without importing its stateful UI/module graph.
import { decimalToFraction, deriveScale, normalizeLayers } from './oracle-core.js';

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
  const layers = normalizeLayers(rawLayers);
  const scale = deriveScale(layers);
  const ownersAt = new Map();

  layers.forEach((layer, layerIndex) => {
    const step = scale.grid / layer;
    for (let i = 0; i < layer; i++) {
      const tick = i * step;
      let owners = ownersAt.get(tick);
      if (!owners) ownersAt.set(tick, owners = []);
      owners.push(LAYER_NAMES[layerIndex]);
    }
  });

  const attacks = [...ownersAt.entries()].sort((a, b) => a[0] - b[0]);
  const nodes = attacks.map(([tick, owners], index) => {
    const nextTick = attacks[(index + 1) % attacks.length][0];
    const gap = index + 1 < attacks.length ? nextTick - tick : scale.grid - tick + nextTick;
    return { tick, phase: tick / scale.grid, gap, owners: [...owners] };
  });
  const maxGap = nodes.reduce((max, node) => Math.max(max, node.gap), 0);
  for (const node of nodes) {
    let ratio = maxGap / node.gap;
    while (ratio >= 2) ratio /= 2;
    while (ratio < 1) ratio *= 2;
    node.ratioFraction = decimalToFraction(ratio);
  }

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
    maxGap,
  };
}
