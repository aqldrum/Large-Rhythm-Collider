// Headless guards for the Cull2 Audio Reflection Lab.
import { readFileSync } from 'fs';
import { buildCull2Readout, layerTriggersForReadout, parseRhythmInput } from '../cull2-audio-core.js';
import { buildGridCull2Readout } from '../cull2-grid-core.js';
import { Cull2AudioPlayer } from '../cull2-audio-player.js';
import { compareRatioOwners, gridResults } from '../grid-core.js';

let PASS = true;
const check = (name, ok, detail = '') => {
  PASS = PASS && ok;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('═══ CULL2 AUDIO REFLECTION — assertions ═══');

check('parser accepts colon/comma/space-separated rhythms',
  JSON.stringify(parseRhythmInput('20 : 15, 8 6')) === JSON.stringify([20, 15, 8, 6]));
let parseRejected = false;
try { parseRhythmInput('24'); } catch { parseRejected = true; }
check('parser rejects rhythms outside 2–4 layers', parseRejected);

const sample = buildCull2Readout([20, 15, 8, 6]);
check('normalization and grid are deterministic', sample.layers.join('.') === '20.15.8.6' && sample.grid === 120,
  `${sample.layers.join('.')} @ ${sample.grid}`);
check('sample has real cull2 work to inspect', sample.summary.baseSurvivors < sample.summary.compositeOnsets && sample.sections.some(s => s.culled),
  `${sample.summary.baseSurvivors}/${sample.summary.compositeOnsets} base survivors`);

// Regression (huge-grid audio-drop bug): the fundamental gap must be found by a FOLD, never
// Math.max(...gaps) — spreading a grid-sized gaps array as call arguments overflows the stack at large
// grids ("Maximum call stack size exceeded"), which silently failed every affected zone's row compile.
const cull2Src = readFileSync(new URL('../cull2-audio-core.js', import.meta.url), 'utf8');
check('fundamental gap is folded, not spread into Math.max/min (stack-overflow guard for large grids)',
  !/Math\.(max|min)\(\.\.\./.test(cull2Src));
// …and the fold still resolves the correct fundamental: the widest gap is the slowest pulse (rawRatio 1).
const maxGap = sample.events.reduce((m, e) => (e.gap > m ? e.gap : m), 0);
check('the widest-gap event is the fundamental (rawRatio === 1) — fold matches Math.max semantics',
  maxGap > 0 && sample.events.filter(e => e.gap === maxGap).every(e => Math.abs(e.rawRatio - 1) < 1e-9),
  `maxGap ${maxGap}`);

let mirrorInvolutionFail = 0, mirrorGapFail = 0, mirrorRatioFail = 0;
for (const event of sample.events) {
  const mirror = sample.events[event.mirrorIndex];
  if (mirror.mirrorIndex !== event.index) mirrorInvolutionFail++;
  if (mirror.gap !== event.gap) mirrorGapFail++;
  if (mirror.fraction !== event.fraction) mirrorRatioFail++;
}
check('event reflection is an involution (mirror(mirror(i)) = i)', mirrorInvolutionFail === 0, `${mirrorInvolutionFail} failures`);
check('every reflected event has the same gap value', mirrorGapFail === 0 && sample.gapPalindrome, `${mirrorGapFail} failures`);
check('every reflected event has the same folded ratio', mirrorRatioFail === 0 && sample.ratioPalindrome, `${mirrorRatioFail} failures`);

let cullRuleFail = 0;
for (const section of sample.sections.filter(s => s.eligible)) {
  const shouldCull = section.gapValues.length > 0 && section.gapValues.every(g => section.seenBefore.includes(g));
  if (section.culled !== shouldCull) cullRuleFail++;
}
check('base cull2 uses cumulative prior gap vocabulary exactly', cullRuleFail === 0, `${cullRuleFail} section mismatches`);

const frontSurvivors = sample.events.filter(e => e.tick < sample.midpoint && e.baseKeep);
check('every first-half cull2 survivor is kept at its real back-half mirror',
  frontSurvivors.every(e => sample.events[e.mirrorIndex].finalKeep),
  `${sample.summary.reflectedFrontSurvivors}/${sample.summary.frontSurvivors}`);
check('reflection restores culled back-half events rather than merely relabelling survivors',
  sample.events.some(e => e.action === 'reflection') && sample.summary.reflectedAdditions > 0,
  `${sample.summary.reflectedAdditions} additions`);
check('restored events retain the back-half event owners (not copied front owners)',
  sample.events.some(e => e.action === 'reflection' && e.owners.join(',') !== sample.events[e.reflectedFrom].owners.join(',')));
check('final event accounting is exact',
  sample.summary.finalEvents + sample.summary.holds === sample.summary.compositeOnsets &&
  sample.summary.baseSurvivors + sample.summary.reflectedAdditions === sample.summary.finalEvents);

console.log('\n  Scale selection');
const rootOnly = buildCull2Readout([20, 15, 8, 6], { selectedFractions: ['1/1'] });
check('ratio catalog exposes every distinct folded system tone in cents order',
  rootOnly.ratioCatalog.length === rootOnly.summary.distinctRatios &&
  rootOnly.ratioCatalog.every((r, i, rows) => i === 0 || rows[i - 1].cents <= r.cents));
check('selector state is attached by folded ratio identity',
  rootOnly.ratioCatalog.find(r => r.fraction === '1/1')?.selected === true &&
  rootOnly.ratioCatalog.filter(r => r.fraction !== '1/1').every(r => !r.selected));
check('selected structural root events PLAY',
  rootOnly.events.filter(e => e.finalKeep && e.fraction === '1/1').every(e => ['play', 'repeat-hold'].includes(e.audioAction)));
check('deselected structural tones report OFF without becoming Cull2 holds',
  rootOnly.events.filter(e => e.finalKeep && e.fraction !== '1/1').every(e => e.audioAction === 'off'));
check('Cull2 holds remain holds regardless of scale selection',
  rootOnly.events.filter(e => !e.finalKeep).every(e => e.audioAction === 'hold'));
check('play/off/hold accounting covers the complete tape',
  rootOnly.summary.playEvents + rootOnly.summary.repeatHoldEvents + rootOnly.summary.deselectedEvents + rootOnly.summary.holds === rootOnly.summary.compositeOnsets);

console.log('\n  Same-layer repeated-gap culling');
const allSelected = buildCull2Readout([20, 15, 8, 6]);
const repeatActions = allSelected.events.flatMap(e => e.layerActions.map(a => ({ ...a, event: e })) ).filter(x => x.action === 'repeat-hold');
check('sample contains repeated same-layer gap holds', repeatActions.length > 0, `${repeatActions.length} layer holds`);
check('a repeated-layer hold only occurs when the held gap exactly matches',
  repeatActions.every(x => x.previousGap === x.gap));
check('every event has one layer decision per real owner',
  allSelected.events.every(e => e.layerActions.length === e.owners.length && e.layerActions.every(a => e.owners.includes(a.layer))));
check('repeat holds preserve octave identity by exact gap, not folded ratio alone',
  repeatActions.every(x => x.event.rawRatio === allSelected.fundamentalGap / x.gap));
const repeatCullOff = buildCull2Readout([20, 15, 8, 6], { repeatCull: false });
check('same-layer repeated-gap culling can be disabled for A/B listening',
  repeatCullOff.repeatCull === false && repeatCullOff.summary.layerRepeatHolds === 0 &&
  repeatCullOff.events.flatMap(e => e.layerActions).every(a => a.action !== 'repeat-hold'));
check('disabled repeat cull restores every structurally surviving selected layer attack',
  repeatCullOff.events.filter(e => e.finalKeep && e.selected).every(e => e.layerActions.every(a => a.action === 'play')));

console.log('\n  Per-layer legato trigger projection');
const triggers = layerTriggersForReadout(rootOnly);
const expectedTriggerCount = rootOnly.events.flatMap(e => e.layerActions).filter(a => a.action === 'play').length;
check('every PLAY event emits one trigger per real owning layer', triggers.length === expectedTriggerCount,
  `${triggers.length}/${expectedTriggerCount}`);
check('structural HOLD, repeat HOLD, and selector-OFF layer actions emit no triggers',
  triggers.every(t => rootOnly.events[t.eventIndex].layerActions.some(a => a.layer === t.layer && a.action === 'play')));
check('triggers preserve event phase, ratio, and structural survivor/reflection identity',
  triggers.every(t => {
    const event = rootOnly.events[t.eventIndex];
    return t.phase === event.phase && t.ratio === event.rawRatio && t.foldedRatio === event.foldedRatio && t.gap === event.gap && t.fraction === event.fraction &&
      t.structuralAction === event.action && event.owners.includes(t.layer);
  }));
check('empty/missing readouts produce no triggers', layerTriggersForReadout(null).length === 0 && layerTriggersForReadout({ events: [] }).length === 0);

const noReflection = buildCull2Readout([20, 15, 8, 6], { reflect: false });
check('reflection can be disabled for an A/B readout',
  noReflection.summary.reflectedAdditions === 0 && noReflection.events.every(e => e.finalKeep === e.baseKeep));

console.log('\n  Grid-star composite mode');
const gridProgram = buildGridCull2Readout(120);
check('grid mode counts the complete keep-two set but Cull2-compiles only ratio owners',
  gridProgram.mode === 'grid' && gridProgram.grid === 120 && gridProgram.summary.keptRhythms === 14 &&
  gridProgram.summary.representativeRhythms === gridProgram.rhythms.length && gridProgram.rhythms.length < 14);
const kept120 = gridResults(120).kept;
check('every folded ratio chooses its globally lowest-layer-sum rhythm',
  gridProgram.ratioOwners.every(owner => {
    const candidates = kept120.filter(system => system.ratios.some(ratio => ratio.fraction === owner.fraction));
    const expected = candidates.map(system => ({ ...system, fraction: owner.fraction })).sort(compareRatioOwners)[0];
    return expected && owner.key === expected.key && owner.layerSum === expected.layerSum;
  }));
check('every representative rhythm is independently Cull2-processed on the shared grid',
  gridProgram.rhythms.every(rhythm => rhythm.grid === 120 && rhythm.structuralRepeatCull === false &&
    rhythm.ownedRatioCount > 0 && rhythm.summary.finalEvents === rhythm.summary.baseSurvivors + rhythm.summary.reflectedAdditions));
check('non-owning keep-two rhythms are removed before temporal construction',
  gridProgram.summary.ownershipReductionPct > 0 && gridProgram.summary.representativeRhythms < gridProgram.summary.keptRhythms);
check('the overlay exposes exactly four canonical voice identities',
  gridProgram.layers.join('') === 'ABCD' && gridProgram.events.every(event =>
    event.layerActions.every(action => gridProgram.layers.includes(action.layer)) &&
    new Set(event.layerActions.map(action => action.layer)).size === event.layerActions.length));
check('every collision winner has maximum source-rhythm support',
  gridProgram.events.flatMap(event => event.layerActions).every(action =>
    action.support === Math.max(...action.toneGroups.map(group => group.support)) && action.rawFraction === action.toneGroups[0].rawFraction));
let cyclicRepeatFail = 0;
for (const layer of gridProgram.layers) {
  const actions = gridProgram.events.flatMap(event => event.layerActions.filter(action => action.layer === layer));
  actions.forEach((action, index) => {
    const prior = actions[(index - 1 + actions.length) % actions.length];
    if (prior && (action.action === 'repeat-hold') !== (action.rawFraction === prior.rawFraction)) cyclicRepeatFail++;
  });
}
check('same-tone holds are applied after overlay against the canonical layer state', cyclicRepeatFail === 0, `${cyclicRepeatFail} mismatches`);
const gridRepeatOff = buildGridCull2Readout(120, { repeatCull: false });
check('grid repeated-tone holding remains independently toggleable',
  gridRepeatOff.summary.layerRepeatHolds === 0 && gridRepeatOff.events.flatMap(event => event.layerActions).every(action => action.action === 'play'));
const gridRootOnly = buildGridCull2Readout(120, { selectedFractions: ['1/1'] });
check('one global Scale Selector filters every rhythm before canonical overlay',
  gridRootOnly.ratioCatalog.filter(note => note.selected).map(note => note.fraction).join(',') === '1/1' &&
  gridRootOnly.events.flatMap(event => event.layerActions).every(action => action.fraction === '1/1'));
check('grid summary accounting preserves the full source program while bounding output voices',
  gridProgram.summary.sourceLayerAttacks >= gridProgram.summary.canonicalActions &&
  gridProgram.summary.layerPlays + gridProgram.summary.layerRepeatHolds === gridProgram.summary.canonicalActions);

console.log('\n  Tick-rate transport');
const rateTransport = new Cull2AudioPlayer();
rateTransport.setProgram(sample);
check('transport defaults to 15 grid ticks per second', rateTransport.ticksPerSecond === 15);
rateTransport.setTickRate(120);
check('tick-rate control clamps at the requested 100 ticks per second ceiling', rateTransport.ticksPerSecond === 100);
rateTransport.setTickRate(0);
check('zero ticks per second is a valid halted transport rate', rateTransport.ticksPerSecond === 0);

const page = readFileSync(new URL('../cull2-audio-test.html', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../cull2-audio-test.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../cull2-audio-player.js', import.meta.url), 'utf8');
const gridWorker = readFileSync(new URL('../cull2-grid-worker.js', import.meta.url), 'utf8');
check('test page wires the module and both readout tables',
  page.includes('./cull2-audio-test.js?v=6') && page.includes('repeat-cull-toggle') && page.includes('audio-play') && page.includes('scale-notes') && page.includes('segment-body') && page.includes('event-body') &&
  page.includes('grid-tab') && page.includes('grid-input') && page.includes('grid-rhythm-body') && page.includes('grid-event-body') && page.includes('audio-rate'));
check('every lab section exposes a double-click collapse trigger with an owned body',
  (page.match(/class="collapse-trigger"/g) || []).length >= 8 &&
  (page.match(/class="[^"]*collapsible-body/g) || []).length >= 8 &&
  ui.includes("addEventListener('dblclick'") && ui.includes("getAttribute('aria-controls')") && ui.includes("setAttribute('aria-expanded'"));
check('UI calls the rhythm compiler and delegates grid compilation to a worker',
  ui.includes('buildCull2Readout') && ui.includes('parseRhythmInput') && ui.includes('cull2-grid-worker.js?v=6') &&
  gridWorker.includes('buildGridCull2Readout') && gridWorker.includes('cull2-grid-core.js?v=6'));
check('audition transport stays separate from the main playback engine',
  player.includes('class Cull2AudioPlayer') && player.includes('layerAction.rawRatio') && player.includes('setTickRate') &&
  player.includes('(this.cursorCycle * grid + event.tick) / this.ticksPerSecond') &&
  !player.includes("from '../Playback") && !player.includes("from './Playback"));

console.log(`\n${PASS ? '✓✓✓ CULL2 AUDIO REFLECTION PASSES' : '✗ CULL2 AUDIO REFLECTION FAILED'}`);
process.exit(PASS ? 0 : 1);
