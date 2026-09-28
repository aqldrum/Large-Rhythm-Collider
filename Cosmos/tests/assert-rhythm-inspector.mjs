import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRhythmInspectorModel, lightRhythmMetrics, plotSlotAtPhase } from '../ui/rhythm-inspector-model.js';
import { classifyLeadHarmony, deriveVoice, leadFrequencyHz, scheduledLeadLayers, shouldScheduleLeadNote } from '../audio/cosmos-audio.js';
import { normalizeHarmonyPolicy } from '../audio/harmony-policy.js';
import { shouldScheduleRowAction } from '../audio/spatial-grid-row-player.js';

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
assert.ok(model.nodes.every(node => Number.isFinite(node.rawRatio) && typeof node.rawFraction === 'string'));
assert.ok(model.nodes.every(node => Number.isFinite(node.foldedRatio) && typeof node.fraction === 'string'));

const octaveModel = buildRhythmInspectorModel([3, 2]);
const literalFundamental = octaveModel.nodes.find(node => node.rawFraction === '1/1');
const foldedOctave = octaveModel.nodes.find(node => node.rawFraction === '2/1');
assert.equal(literalFundamental.fraction, '1/1');
assert.equal(foldedOctave.fraction, '1/1');
assert.equal(shouldScheduleRowAction(literalFundamental, false), false);
assert.equal(shouldScheduleRowAction(foldedOctave, false), true);
const sharedVoice = deriveVoice(octaveModel);
assert.equal(sharedVoice.model, octaveModel);
assert.ok(sharedVoice.notes.some(note => note.rawFraction === '2/1' && note.fraction === '1/1'));
assert.deepEqual(sharedVoice.notes.map(note => note.ownerIndexes), octaveModel.nodes.map(node => node.ownerIndexes));
assert.deepEqual(sharedVoice.notes[0].ownerIndexes, [0, 1]);
const repeated = Array.from({ length: 1000 }, () => sharedVoice.notes[0]);
const harmony = classifyLeadHarmony(repeated, 0, normalizeHarmonyPolicy({ chordTargets: [0, 400, 700] }));
assert.equal(harmony.mask.length, repeated.length);
assert.equal(harmony.selectedByTone.size, 1);
assert.equal(shouldScheduleLeadNote(sharedVoice.notes[0], 0, [false], true), false);
assert.equal(shouldScheduleLeadNote(literalFundamental, 0, [true], false), false);
assert.equal(shouldScheduleLeadNote(foldedOctave, 0, [true], false), true);
assert.deepEqual(scheduledLeadLayers(sharedVoice.notes[0], 0, [true], true), [0, 1]);
assert.deepEqual(scheduledLeadLayers(sharedVoice.notes[0], 0, [false], true), []);
assert.deepEqual(scheduledLeadLayers({ ...sharedVoice.notes[0], ownerIndexes: [3, 3, 9, -1] }, 0, [true], true), [3]);
// The card's plot key mutes the audition: a hidden layer is dropped; an onset owned only by hidden layers voices nothing.
assert.deepEqual(scheduledLeadLayers(sharedVoice.notes[0], 0, [true], true, [true, false, true, true]), [0]);
assert.deepEqual(scheduledLeadLayers(sharedVoice.notes[0], 0, [true], true, [false, false, true, true]), []);
assert.deepEqual(scheduledLeadLayers(sharedVoice.notes[0], 0, [true], true, null), [0, 1]);
const octaveSources = [1, 2, 4].map(rawRatio => ({ ratio: 1, rawRatio, fraction: '1/1', rawFraction: `${rawRatio}/1` }));
assert.deepEqual(octaveSources.map(note => leadFrequencyHz(note)), [220, 440, 880]);
assert.equal(leadFrequencyHz(octaveSources[2], 1), 1760);
assert.equal(leadFrequencyHz({ ratio: 1, rawRatio: 32 }), null);
assert.equal(classifyLeadHarmony(octaveSources, 0, normalizeHarmonyPolicy({ chordTargets: [0] })).selectedByTone.size, 1);

const normalized = buildRhythmInspectorModel([3, 5, 4]);
assert.deepEqual(normalized.layers, [5, 4, 3]);
assert.equal(normalized.key, model.key);

// Light metrics for the TOO-DENSE card must equal the full model's fields exactly — the card shows these
// without the O(layerSum) composite walk that would freeze the click. Parity over the shared fields:
for (const layers of [[5, 4, 3], [3, 2], [7, 5, 3, 2], [6, 4, 2], [12, 8, 6]]) {
  const full = buildRhythmInspectorModel(layers);
  const light = lightRhythmMetrics(layers);
  assert.deepEqual(light.layers, full.layers, `layers ${layers}`);
  assert.equal(light.identity, full.identity, `identity ${layers}`);
  assert.equal(light.grid, full.grid, `grid ${layers}`);
  assert.equal(light.fundamental, full.fundamental, `fundamental ${layers}`);
  assert.equal(light.layerSum, full.layerSum, `layerSum ${layers}`);
  assert.equal(light.density, full.density, `density ${layers}`);
  assert.deepEqual(light.groupings, full.groupings, `groupings ${layers}`);
  assert.equal(light.range, full.range, `range ${layers}`);
  assert.equal(light.pulseToGrouping, full.pulseToGrouping, `pulseToGrouping ${layers}`);
  assert.ok(light.maxOnsets >= full.compositeLength, `maxOnsets upper-bounds composite onsets ${layers}`);
}
// Density is scale-invariant: a common factor reduces exactly as the full model reduces it.
assert.equal(lightRhythmMetrics([6, 4, 2]).density, lightRhythmMetrics([3, 2, 1]).density);
// Cheap even for a rhythm far past the card cap (the whole point): finite metrics, no composite tape, no throw.
const denseMetrics = lightRhythmMetrics([8192, 8193]);
assert.ok(Number.isFinite(denseMetrics.grid) && Number.isFinite(denseMetrics.fundamental) && denseMetrics.density > 0);
assert.equal(denseMetrics.maxOnsets, 8192 + 8193);

// Evenly spaced plot slots: the warped playhead sits EXACTLY on a dot's slot at that onset's true phase (so the
// light and the tone coincide), moves monotonically between them, and spends the wrap gap on the last slot.
for (const layers of [[3, 2], [4, 3], [5, 4, 3], [24, 23]]) {
  const { nodes } = buildRhythmInspectorModel(layers);
  nodes.forEach((node, index) => assert.equal(plotSlotAtPhase(nodes, node.phase), index, `slot ${index} of ${layers}`));
  let previous = -1;
  for (let step = 0; step < 1000; step++) {
    const slot = plotSlotAtPhase(nodes, step / 1000);
    assert.ok(slot >= previous && slot >= 0 && slot < nodes.length, `monotone slot ${layers} @${step}`);
    previous = slot;
  }
  const last = nodes.at(-1);
  assert.ok(Math.abs(plotSlotAtPhase(nodes, (last.phase + 1) / 2) - (nodes.length - 0.5)) < 1e-9, `wrap midpoint ${layers}`);
}
assert.equal(plotSlotAtPhase([], 0.4), 0);

const flightSource = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const cockpitPlotSource = flightSource.slice(
  flightSource.indexOf('function drawCockpitPlot()'),
  flightSource.indexOf('// Full Sky readout', flightSource.indexOf('function drawCockpitPlot()')),
);

assert.equal((pageSource.match(/data-plot-layer="[A-D]"/g) || []).length, 4);
assert.match(pageSource, /id="lrc-plot-key"[^>]+role="group"/);
assert.match(pageSource, /<div id="lrc-head"[\s\S]+id="lrc-listen-btn"[\s\S]+id="lrc-load-btn"/);
assert.match(pageSource, /<dt>Density<\/dt><dd id="lrc-metric-density">/);
assert.doesNotMatch(pageSource, /lrc-metric-layer-sum/);
assert.match(flightSource, /\['Groupings',[^\n]+\n\s+\['Layer sum', rhythmInspectorModel\.layerSum\.toLocaleString\(\)\]/);
assert.match(pageSource, /id="lrc-scale-chart"[\s\S]+id="lrc-scale-table-body"/);
assert.ok(pageSource.indexOf('class="lrc-plot-frame"') < pageSource.indexOf('class="lrc-rhythm-titlebar"'));
assert.doesNotMatch(pageSource, /lrc-ratio-strip/);
assert.match(pageSource, /<aside id="lrc-audio-lab"[^>]+hidden>/);
assert.doesNotMatch(flightSource, /\['Codex key'|\['Scale tones'/);
assert.match(flightSource, /cockpitVisibleLayers\.(?:has|delete|add)/);
assert.match(flightSource, /function modelForRhythmNode\(node\)/);
// The too-dense card shows the cheap metrics (fundamental + density), not a bare '—' refusal.
assert.match(flightSource, /const metrics = lightRhythmMetrics\(node\.layers\)/);
assert.match(flightSource, /metricFundamentalEl\.textContent = inspectorNumber\(metrics\.fundamental\)/);
assert.match(flightSource, /metricDensityEl\.textContent = `\$\{metrics\.density\.toFixed\(2\)\}%`/);
assert.match(flightSource, /leadVoice = \{ \.\.\.deriveVoice\(model\), node \}/);
assert.match(flightSource, /rhythmInspectorModel = modelForRhythmNode\(node\)/);
const audioSource = readFileSync(new URL('../audio/cosmos-audio.js', import.meta.url), 'utf8');
assert.match(audioSource, /const layers = scheduledLeadLayers\(note, noteIdx, leadMask, rowFundamental, leadLayerAudible\)/);
// The plot pulses what the scheduler VOICED: scheduleNote logs only onsets whose voices actually started.
assert.match(audioSource, /const voiced = layers\.filter\(layerIndex => startLeadLegatoVoice\([^)]*\)\);\s+if \(!voiced\.length\) return;\s+leadOnsetLog\.push/);
assert.match(audioSource, /const freq = leadFrequencyHz\(note, currentOctaveLift\)/);
assert.match(audioSource, /releaseLeadVoice\(leadLayerVoices\[layerIndex\], when\)/);
assert.match(audioSource, /for \(const voice of \[\.\.\.leadVoices\]\)[\s\S]+shouldScheduleLeadNote\(voice\.note, voice\.noteIdx, leadMask, rowFundamental\)/);
assert.match(flightSource, /COCKPIT_SCALE_HIGHLIGHT_MS = 300/);
assert.match(cockpitPlotSource, /visibleOwners = node\.owners\.filter/);
assert.match(cockpitPlotSource, /cockpitPlotBaseCanvas/);
assert.match(cockpitPlotSource, /baseKey !== cockpitPlotBaseKey/);
assert.match(cockpitPlotSource, /classifyLeadHarmony\(rhythmInspectorModel\.ratios/);
assert.match(cockpitPlotSource, /g\.drawImage\(cockpitPlotBaseCanvas/);
assert.match(cockpitPlotSource, /lastSoundedLeadOnset\(\)/);
assert.match(cockpitPlotSource, /xForSlot\(plotSlotAtPhase\(rhythmInspectorModel\.nodes, transportPhase\(\)\)\)/);
assert.doesNotMatch(cockpitPlotSource, /node\.phase \* \(w - 2\)/);
// Every onset is drawn; only an identical dot on the same device pixel is skipped (the old repeated-tone skip
// left real onsets undrawn, and their pulses lit empty spots).
assert.doesNotMatch(cockpitPlotSource, /prevDrawnFraction/);
assert.match(cockpitPlotSource, /drawnDots\.has\(dot\)/);
// The audition lives exactly as long as a rhythm is shown: every card exit routes through stopRhythmAudition.
assert.match(flightSource, /function resetRhythmInspector\(\) \{[^}]+stopRhythmAudition\(\)/);
assert.match(flightSource, /function showDetail\(sel\) \{[\s\S]+?leaveRhythmCard\(\);[\s\S]+?\n\}/);
assert.match(flightSource, /if \(!open\) stopRhythmAudition\(\)/);
assert.match(flightSource, /if \(leadVoice\?\.node\.grid === g\) stopRhythmAudition\(\)/);
assert.match(flightSource, /else if \(!closeCardOnEscape\(\)\) window\.exitCosmos\(\)/);
assert.doesNotMatch(flightSource, /leadVoice\?\.node\?\.id ===/);
assert.doesNotMatch(cockpitPlotSource, /coincident\s*=/);
assert.doesNotMatch(cockpitPlotSource, /strokeStyle\s*=\s*['"]#ffffff/);
assert.doesNotMatch(cockpitPlotSource, /g\.lineTo\(x, y\)/);
assert.doesNotMatch(cockpitPlotSource, /for \(const fraction of \[0\.25, 0\.5, 0\.75\]\)/);
assert.match(styleSource, /#lrc-div \{[^}]+width: min\(310px/);
assert.match(styleSource, /#lrc-div\.open\.lrc-wide \{ width: min\(620px/);   // the card is narrow until a rhythm widens it
assert.match(styleSource, /#lrc-plot \{[^}]+height: 192px/);
assert.match(styleSource, /\.lrc-scale-table-container \{ height: 178px; max-height: 178px;/);
for (const layer of ['A', 'B', 'C', 'D']) {
  assert.match(styleSource, new RegExp(`button\\[data-plot-layer="${layer}"\\] \\{ color: var\\(--layer-${layer.toLowerCase()}\\); \\}`));
}

console.log('rhythm inspector model assertions passed');
