import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRhythmInspectorModel } from '../rhythm-inspector-model.js';

const model = buildRhythmInspectorModel([5, 4, 3]);
assert.equal(model.identity, '5 : 4 : 3');
assert.equal(model.grid, 60);
assert.equal(model.fundamental, 12);
assert.equal(model.layerSum, 12);
assert.equal(model.density, 20);
assert.equal(model.compositeLength, model.nodes.length);
assert.equal(model.nodes.reduce((sum, node) => sum + node.gap, 0), model.grid);
assert.deepEqual([...new Set(model.nodes.flatMap(node => node.owners))].sort(), ['A', 'B', 'C']);
assert.equal(model.ratios.length, model.pitchCount);
assert.ok(model.ratios.every((ratio, index, all) => index === 0 || ratio.cents >= all[index - 1].cents));
assert.ok(model.nodes.every(node => model.ratios.some(ratio => ratio.fraction === node.ratioFraction)));

const normalized = buildRhythmInspectorModel([3, 5, 4]);
assert.deepEqual(normalized.layers, [5, 4, 3]);
assert.equal(normalized.key, model.key);

const flightSource = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const cockpitPlotSource = flightSource.slice(
  flightSource.indexOf('function drawCockpitPlot()'),
  flightSource.indexOf('// Full Sky readout', flightSource.indexOf('function drawCockpitPlot()')),
);

assert.equal((pageSource.match(/data-plot-layer="[A-D]"/g) || []).length, 4);
assert.match(pageSource, /id="lrc-plot-key"[^>]+role="group"/);
assert.match(pageSource, /<div id="lrc-head"[\s\S]+id="lrc-listen-btn"[\s\S]+id="lrc-load-btn"[\s\S]+id="lrc-exit-btn"/);
assert.match(pageSource, /<dt>Density<\/dt><dd id="lrc-metric-density">/);
assert.doesNotMatch(pageSource, /lrc-metric-layer-sum/);
assert.match(flightSource, /\['Groupings',[^\n]+\n\s+\['Layer sum', rhythmInspectorModel\.layerSum\.toLocaleString\(\)\]/);
assert.match(pageSource, /id="lrc-scale-chart"[\s\S]+id="lrc-scale-table-body"/);
assert.ok(pageSource.indexOf('class="lrc-plot-frame"') < pageSource.indexOf('class="lrc-rhythm-titlebar"'));
assert.doesNotMatch(pageSource, /lrc-ratio-strip/);
assert.match(pageSource, /<aside id="lrc-audio-lab"[^>]+hidden>/);
assert.doesNotMatch(flightSource, /\['Codex key'|\['Scale tones'/);
assert.match(flightSource, /cockpitVisibleLayers\.(?:has|delete|add)/);
assert.match(flightSource, /COCKPIT_SCALE_HIGHLIGHT_MS = 300/);
assert.match(flightSource, /firstPress && k === 'z'/);
assert.match(cockpitPlotSource, /visibleOwners = node\.owners\.filter/);
assert.doesNotMatch(cockpitPlotSource, /g\.lineTo\(x, y\)/);
assert.doesNotMatch(cockpitPlotSource, /for \(const fraction of \[0\.25, 0\.5, 0\.75\]\)/);
assert.match(styleSource, /#lrc-div \{[^}]+width: min\(310px/);
assert.match(styleSource, /#lrc-div\.open \{ width: min\(620px/);
assert.match(styleSource, /#lrc-plot \{[^}]+height: 192px/);
assert.match(styleSource, /\.lrc-scale-table-container \{ height: 178px; max-height: 178px;/);
for (const layer of ['A', 'B', 'C', 'D']) {
  assert.match(styleSource, new RegExp(`button\\[data-plot-layer="${layer}"\\] \\{ color: var\\(--layer-${layer.toLowerCase()}\\); \\}`));
}

console.log('rhythm inspector model assertions passed');
