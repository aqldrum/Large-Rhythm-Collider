import { readFileSync } from 'node:fs';
import { gridRatioOwnerSolve, gridShardSystems, shardKeysOf } from '../grid-core.js';
import { ProgramWorkerPool } from '../program-worker-pool.js';
import { selectedGridRatioToneRows } from '../cosmos-audio.js';
import {
  CULLED_ROW_FUNDAMENTAL_HZ, CULLED_ROW_MAX_HZ, ROW_MICRO_GAP_SECONDS,
  SpatialGridRowPlayer, culledGridRowFrequency, nearestCulledToneVoices,
  nextRowLayerGapTicks, rowEnvelopePlan,
} from '../spatial-grid-row-player.js';
import { AUDIO_LISTENER_FORWARD, AUDIO_LISTENER_UP, toAudioListenerPosition } from '../spatial-audio-frame.js';
import {
  AUDIO_MODES, CULLED_ROW_MAX_VOICES_PER_TONE, RHYTHM_VOICE_WAVEFORM,
  ROW_ACTIVE_STARS, ROW_PREWARM_STARS, ROW_RADIUS,
  audioCompileEligibility, chooseSpatialRows, compileGridAudioProgram,
  harmonicSelectionKey, ownerChordMatch, selectedOwnerFractions,
} from '../cosmos-grid-audio-core.js';

let PASS = true;
const check = (label, ok, detail = '') => {
  if (!ok) PASS = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('═══ CULL2 GRID 3D AUDIO — assertions ═══');

console.log('\n  Harmonic minimization');
check('mode identity is an explicit two-value enum',
  AUDIO_MODES.AMBIENT_CHORDS === 'ambient-chords' && AUDIO_MODES.CULLED_GRID_ROWS === 'culled-grid-rows');
check('root-relative chord matching includes an in-window chord tone', ownerChordMatch(395, 0, [0, 4, 7], 35).selected);
check('root-relative chord matching excludes the same degree outside the window', !ownerChordMatch(436, 0, [0, 4, 7], 35).selected);
check('octave wrap around the solved root is circular', ownerChordMatch(1190, 0, [0], 35).selected && ownerChordMatch(10, 20, [0], 35).selected);
check('selection generations key root, chord, and consonance window', harmonicSelectionKey(2, 7, 28) === 'root:2|chord:7|window:28');

console.log('\n  Monster/final-ownership gate');
const owners = [{ fraction: '1/1', cents: 0, key: '2.3', layers: [2, 3], layerSum: 5 }];
check('gated monster is ineligible even though visual state says solved',
  audioCompileEligibility({ state: 'solved', monster: true, ratioOwners: owners }).reason === 'monster-gated');
check('partial ownership is ineligible',
  audioCompileEligibility({ state: 'solved', monster: false, shardsTotal: 3, shardsDone: 2, ratioOwners: owners }).reason === 'partial-ownership');
check('only all-shards-finalized ownership is compiler eligible',
  audioCompileEligibility({ state: 'solved', monster: false, shardsTotal: 3, shardsDone: 3, ratioOwners: owners }).eligible);

console.log('\n  Movement field budgets');
// Sized RELATIVE to the knobs, not to their values: ROW_ACTIVE_STARS/ROW_PREWARM_STARS/ROW_RADIUS are
// tuned by ear, and a guard that hardcodes today's numbers fails the moment Avery widens the field
// without anything actually being wrong. Two candidates are held un-ready so the ready-filter is live.
const candidateCount = ROW_PREWARM_STARS + 4;
const spacing = ROW_RADIUS / (candidateCount + 1);   // every candidate inside the sphere, strictly ordered
const candidates = Array.from({ length: candidateCount }, (_, i) => ({ id: i + 1, distance: spacing * (i + 1), ready: i !== 1 && i !== 3 }));
const heldActive = new Set([8, 9, 10]);
const picked = chooseSpatialRows(candidates, heldActive);
check(`prewarm is capped at the nearest ${ROW_PREWARM_STARS} true-3D candidates`,
  picked.prewarm.length === ROW_PREWARM_STARS && picked.prewarm.at(-1).id === ROW_PREWARM_STARS,
  `${picked.prewarm.length} of ${candidateCount} candidates`);
check(`active field is capped at ${ROW_ACTIVE_STARS} program-ready stars`,
  picked.active.length === Math.min(ROW_ACTIVE_STARS, ROW_PREWARM_STARS - 2) && picked.active.every(candidate => candidate.ready),
  `${picked.active.length} active`);
check('already-active ready stars retain hysteresis priority inside prewarm',
  picked.active.slice(0, 3).map(candidate => candidate.id).join(',') === '8,9,10');
check('radius excludes candidates outside the spatial sphere', chooseSpatialRows([{ id: 1, distance: ROW_RADIUS + 1, ready: true }]).prewarm.length === 0);

console.log('\n  Dedicated compiler queue');
class FakeWorker {
  static instances = [];
  constructor() { FakeWorker.instances.push(this); this.messages = []; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(result, compileMs = 1) { const message = this.messages.shift(); this.onmessage({ data: { id: message.id, result, compileMs } }); }
}
const fakePool = new ProgramWorkerPool('fake-worker.js', { size: 1, WorkerClass: FakeWorker });
const firstJob = fakePool.request({ grid: 120 }, { key: 'first', priority: 1 });
const queuedJob = fakePool.request({ grid: 240 }, { key: 'queued', priority: 2 });
const duplicateJob = fakePool.request({ grid: 240 }, { key: 'queued', priority: 2 });
check('one worker compiles while later jobs remain queued', fakePool.snapshot().compiling === 1 && fakePool.snapshot().queued === 1);
check('equal request keys deduplicate to the same promise', queuedJob === duplicateJob);
fakePool.cancelQueuedExcept(new Set(['first']));
check('movement pruning cancels queued work that left prewarm', (await queuedJob).cancelled && fakePool.snapshot().cancelled === 1);
FakeWorker.instances[0].reply({ programKey: 'done' }, 2.5);
check('active worker completion returns its compact result and timing', (await firstJob).result.programKey === 'done' && fakePool.snapshot().lastCompileMs === 2.5);
fakePool.terminate();

console.log('\n  Compact worker program');
const solved = gridRatioOwnerSolve(120);
const fractions = selectedOwnerFractions(solved.ratioOwners, 0, [0, 4, 7]);
const program = compileGridAudioProgram({
  grid: 120,
  ratioOwners: solved.ratioOwners,
  abundance: solved.keptCount,
  selectedFractions: fractions,
  selectionKey: harmonicSelectionKey(0, 0),
  generation: 4,
});
check('worker program carries the exact generation and harmonic selection identity', program.generation === 4 && program.selectionKey === harmonicSelectionKey(0, 0));
check('program contains no rich lab ownerSolve/rhythm/collision payload',
  !('ownerSolve' in program) && !('rhythms' in program) && !JSON.stringify(program).includes('toneGroups'));
check('every emitted action belongs to a selected folded ratio',
  program.events.flatMap(event => event.layerActions).every(action => fractions.includes(action.fraction)));
check('compact program remains four canonical layers and materially small',
  program.layers.join('') === 'ABCD' && JSON.stringify(program).length < 20_000,
  `${Math.round(JSON.stringify(program).length / 1024)}KB`);
check('compact program retains selected ratio+cents rows for the live debug chart',
  program.selectedTones.length === fractions.length && program.selectedTones.every(tone => tone.fraction && Number.isFinite(tone.cents)));

console.log('\n  Bloom-node orb join (owner rhythm → bloom node)');
check('each selected tone carries its owning rhythm key + layers',
  program.selectedTones.length > 0 && program.selectedTones.every(t => typeof t.ownerKey === 'string' && Array.isArray(t.ownerLayers) && t.ownerLayers.length >= 2));
// The join that lets a bloomed grid light the exact node that sounded: an owner's canonical key must
// exist among the grid's bloom-node keys (gridShardSystems over every shard = the full system set).
const bloomKeys = new Set(shardKeysOf(120).flatMap(A => gridShardSystems(120, A).map(s => s.key)));
check('every ratio-owner key is present among the grid\'s bloom-node keys',
  solved.ratioOwners.every(o => bloomKeys.has(o.key)), `${solved.ratioOwners.filter(o => !bloomKeys.has(o.key)).length}/${solved.ratioOwners.length} unmatched`);
check('every selected tone\'s ownerKey resolves to a real bloom node', program.selectedTones.every(t => bloomKeys.has(t.ownerKey)));

console.log('\n  Culled-row pitch register');
check('culled rows share the Ambient Chords rhythm voice waveform', RHYTHM_VOICE_WAVEFORM === 'triangle');
check('culled grid rows use 220 Hz as their fundamental',
  CULLED_ROW_FUNDAMENTAL_HZ === 220 && culledGridRowFrequency(1) === 220);
check('the third octave is retained at the inclusive 1760 Hz ceiling',
  CULLED_ROW_MAX_HZ === 1760 && culledGridRowFrequency(8) === 1760);
check('tones above the ceiling fold downward by whole octaves',
  culledGridRowFrequency(10) === 1100 && culledGridRowFrequency(16) === 1760 && culledGridRowFrequency(32) === 1760);
check('register folding leaves already-in-range and sub-fundamental tones unchanged',
  culledGridRowFrequency(7.5) === 1650 && culledGridRowFrequency(0.5) === 110);
check('invalid raw ratios cannot reach an oscillator',
  culledGridRowFrequency(0) === null && culledGridRowFrequency(-1) === null && culledGridRowFrequency(Infinity) === null);

console.log('\n  Extreme short-note safety');
const gapEvents = [
  { tick: 0, layerActions: [{ layer: 'A', rawFraction: '1/1' }] },
  { tick: 1, layerActions: [{ layer: 'A', rawFraction: '1/1' }] },
  { tick: 2, layerActions: [{ layer: 'B', rawFraction: '3/2' }] },
  { tick: 3, layerActions: [{ layer: 'A', rawFraction: '5/4' }] },
];
check('next-layer gap skips silent same-tone holds when repeat-cull is active',
  nextRowLayerGapTicks(gapEvents, 0, gapEvents[0].layerActions[0], 8, true) === 3);
check('next-layer gap keeps the immediate articulation when repeat-cull is disabled',
  nextRowLayerGapTicks(gapEvents, 0, gapEvents[0].layerActions[0], 8, false) === 1);
check('next-layer gap wraps to the first real layer onset of the next cycle',
  nextRowLayerGapTicks(gapEvents, 3, gapEvents[3].layerActions[0], 8, true) === 5);
const fourMsPlan = rowEnvelopePlan(0.004, 48000);
const tenMsPlan = rowEnvelopePlan(0.010, 48000);
const normalPlan = rowEnvelopePlan(ROW_MICRO_GAP_SECONDS, 48000);
check('a micro-gap envelope fits wholly inside its source interval',
  fourMsPlan.micro && fourMsPlan.duration === 0.004 && Math.abs(fourMsPlan.attack + fourMsPlan.release - 0.004) < 1e-12);
check('shorter micro notes are attenuated instead of becoming full-level impulses',
  fourMsPlan.peak < tenMsPlan.peak && tenMsPlan.peak < normalPlan.peak);
check('events shorter than two samples are suppressed as unrenderable', !rowEnvelopePlan(1 / 48000, 48000).render);
check('ordinary gaps retain the established fixed pluck envelope', !normalPlan.micro && normalPlan.render);

console.log('\n  Per-tone spatial voice cap');
const toneVoiceCandidates = [
  { starId: 50, layer: 'A', distance: 500, current: true },
  { starId: 20, layer: 'B', distance: 200, current: true },
  { starId: 10, layer: 'C', distance: 100, current: true },
  { starId: 40, layer: 'D', distance: 400, current: true },
  { starId: 30, layer: 'A', distance: 300, current: true },
];
check('a folded tone admits at most four logical voices',
  CULLED_ROW_MAX_VOICES_PER_TONE === 4 && nearestCulledToneVoices(toneVoiceCandidates).length === 4);
check('the four admitted tone voices are the four nearest to the listener',
  nearestCulledToneVoices(toneVoiceCandidates).map(candidate => candidate.starId).join(',') === '10,20,30,40');
check('a current deck wins an exact-distance tie against its retiring predecessor',
  nearestCulledToneVoices([
    { starId: 10, layer: 'A', distance: 100, current: false },
    { starId: 10, layer: 'A', distance: 100, current: true },
  ], 1)[0].current);

const allocationPlayer = Object.create(SpatialGridRowPlayer.prototype);
allocationPlayer.stats = { toneCapMisses: 0, toneCapEvictions: 0 };
allocationPlayer.logicalVoiceCount = 4;
allocationPlayer._releaseLayer = (deck, layer) => { deck.voices.delete(layer); allocationPlayer.logicalVoiceCount--; };
const allocationDeck = (grid, tone = true) => ({
  program: { grid },
  voices: new Map(tone ? [['A', { layer: 'A', toneKey: '1/1' }]] : []),
});
allocationPlayer.stars = new Map([
  [10, { id: 10, distance: 100, retiringDecks: [], currentDeck: allocationDeck(10) }],
  [20, { id: 20, distance: 200, retiringDecks: [], currentDeck: allocationDeck(20) }],
  [30, { id: 30, distance: 300, retiringDecks: [], currentDeck: allocationDeck(30) }],
  [50, { id: 50, distance: 500, retiringDecks: [], currentDeck: allocationDeck(50) }],
  [40, { id: 40, distance: 400, retiringDecks: [], currentDeck: allocationDeck(40, false) }],
]);
const nearerDeck = allocationPlayer.stars.get(40).currentDeck;
check('a nearer live request claims the tone and evicts its farthest incumbent',
  allocationPlayer._claimToneVoice(nearerDeck, { layer: 'A', fraction: '1/1' }, 0) &&
  allocationPlayer.stars.get(50).currentDeck.voices.size === 0 && allocationPlayer.stats.toneCapEvictions === 1);
nearerDeck.voices.set('A', { layer: 'A', toneKey: '1/1' });
allocationPlayer.stars.set(60, { id: 60, distance: 600, retiringDecks: [], currentDeck: allocationDeck(60, false) });
check('a fifth farther live request is rejected without disturbing the nearest four',
  !allocationPlayer._claimToneVoice(allocationPlayer.stars.get(60).currentDeck, { layer: 'A', fraction: '1/1' }, 0) &&
  allocationPlayer.stats.toneCapMisses === 1 && allocationPlayer._toneVoiceCandidates('1/1').length === 4);

const rowChart = selectedGridRatioToneRows(0, 0, [{
  selectedTones: [{ fraction: '1/1', cents: 0 }, { fraction: '5/4', cents: 386.3137 }],
  voiced: [{ layer: 'A', fraction: '5/4' }],
}, {
  selectedTones: [{ fraction: '5/4', cents: 386.3137 }],
  voiced: [{ layer: 'C', fraction: '5/4' }],
}]);
check('row-mode ratio chart aggregates each active star program by solved-root degree',
  rowChart[0].selected[0].fraction === '1/1' && rowChart[4].selected[0].fraction === '5/4' && rowChart[4].selected[0].count === 2);
check('row-mode ON column counts live canonical voices independently of selection',
  rowChart[4].sounding[0].fraction === '5/4' && rowChart[4].sounding[0].count === 2 && rowChart[0].sounding.length === 0);

const rowPlayerSource = readFileSync(new URL('../spatial-grid-row-player.js', import.meta.url), 'utf8');

console.log('\n  Voice budget accounting');
// The ceiling must TRACK the field, not assume the field it was written against. A literal 64 (8 stars
// × A-D × a crossfade deck) silently starved a widened field: attacks stopped being scheduled and the
// only evidence was stats.budgetMisses.
check('the voice ceiling is derived from the active-star count, so widening the field cannot starve it',
  rowPlayerSource.includes('ROW_ACTIVE_STARS * 4 * 2') && !/const MAX_ROW_OSC = \d+;/.test(rowPlayerSource));
// Short gated voices end via osc.onended, not _releaseLayer — the slot must be freed exactly once on
// either path or the count leaks to MAX_ROW_OSC and all later attacks are silently dropped.
const fakeParam = () => ({ value: 0.0001, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
const fakeCtx = () => ({
  sampleRate: 48000, currentTime: 0,
  createOscillator: () => ({ type: '', frequency: fakeParam(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }),
  createGain: () => ({ gain: fakeParam(), connect() {}, disconnect() {} }),
});
const budgetPlayer = Object.create(SpatialGridRowPlayer.prototype);
budgetPlayer.ctx = fakeCtx();
budgetPlayer.logicalVoiceCount = 0;
budgetPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
budgetPlayer.stars = new Map();
budgetPlayer._claimToneVoice = () => true;   // isolate accounting from the per-tone spatial cap
const budgetDeck = () => ({ program: { grid: 7, repeatCull: true }, voices: new Map(), oscillators: new Set(), lastToneByLayer: new Map() });
const deckA = budgetDeck();
budgetPlayer._startVoice(deckA, { layer: 'A', rawRatio: 1, fraction: '1/1', rawFraction: '1/1' }, 0, false);
check('a started voice occupies exactly one budget slot', budgetPlayer.logicalVoiceCount === 1);
[...deckA.oscillators][0].onended();
check('a voice ending naturally frees its slot (no leak → no eventual total silence)', budgetPlayer.logicalVoiceCount === 0);
const deckB = budgetDeck();
budgetPlayer._startVoice(deckB, { layer: 'A', rawRatio: 1, fraction: '1/1', rawFraction: '1/1' }, 0, false);
const stolenOsc = [...deckB.oscillators][0];
budgetPlayer._startVoice(deckB, { layer: 'A', rawRatio: 1.25, fraction: '5/4', rawFraction: '5/4' }, 0, false);
check('a same-layer steal keeps exactly one live slot', budgetPlayer.logicalVoiceCount === 1);
stolenOsc.onended();
check('a stolen voice does not double-free when its oscillator later ends', budgetPlayer.logicalVoiceCount === 1);

const heldTimes = [];
const holdParam = () => ({
  value: 0.0001,
  setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {},
  cancelAndHoldAtTime(when) { heldTimes.push(when); },
});
const holdCtx = {
  sampleRate: 48000, currentTime: 0,
  createOscillator: () => ({ type: '', frequency: holdParam(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }),
  createGain: () => ({ gain: holdParam(), connect() {}, disconnect() {} }),
};
const holdPlayer = Object.create(SpatialGridRowPlayer.prototype);
holdPlayer.ctx = holdCtx;
holdPlayer.logicalVoiceCount = 0;
holdPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
holdPlayer.stars = new Map();
holdPlayer._claimToneVoice = () => true;
const holdDeck = budgetDeck();
holdPlayer._startVoice(holdDeck, { layer: 'A', rawRatio: 1, fraction: '1/1', rawFraction: '1/1' }, 0);
holdPlayer._startVoice(holdDeck, { layer: 'A', rawRatio: 1.25, fraction: '5/4', rawFraction: '5/4' }, 0.002);
check('an interrupted scheduled envelope holds its exact automation value before fading',
  heldTimes.length === 1 && heldTimes[0] === 0.002);

console.log('\n  Silent program swap');
// A deck install must be INAUDIBLE. Under fixed-gate short notes nothing is held across a boundary, so
// a sounding seed would invent one note per canonical layer per star, all landing on the same
// ROW_SWITCH_TICKS boundary and all drawn from the same loop tail — under flight churn (an install per
// star entry) that stacked into a ~20-note chord repeating on the switch grid, burying the polyrhythm.
// The seed may only restore the repeat-cull memory a deck running since the loop start would hold.
const swapPlayer = Object.create(SpatialGridRowPlayer.prototype);
swapPlayer.ctx = fakeCtx();
swapPlayer.logicalVoiceCount = 0;
swapPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
swapPlayer.stars = new Map();
swapPlayer._claimToneVoice = () => true;
const swapDeck = { program, voices: new Map(), oscillators: new Set(), lastToneByLayer: new Map(), ownerKeyByFraction: new Map() };
swapPlayer._seedDeck(swapDeck, 3 * program.grid + Math.floor(program.grid / 2));
check('a program swap starts no voices and consumes no budget',
  swapDeck.oscillators.size === 0 && swapDeck.voices.size === 0 && swapPlayer.logicalVoiceCount === 0);
check('a program swap still primes the repeat-cull memory for every canonical layer the loop uses',
  swapDeck.lastToneByLayer.size === new Set(program.events.flatMap(event => event.layerActions).map(action => action.layer)).size);
check('the primed tone is the layer\'s last tone at or before the boundary, as a running deck would hold',
  [...swapDeck.lastToneByLayer].every(([layer, tone]) => {
    const priorInCycle = program.events.filter(event => event.tick < Math.floor(program.grid / 2))
      .flatMap(event => event.layerActions).filter(action => action.layer === layer).at(-1);
    const loopTail = program.events.flatMap(event => event.layerActions).filter(action => action.layer === layer).at(-1);
    return tone === (priorInCycle || loopTail).rawFraction;
  }));
check('the row voice has one envelope shape — no separate softer seed blip', !rowPlayerSource.includes('ROW_SEED_'));

console.log('\n  Chord-exposure ledger');
// "Expose the full quality": the sky holds a chord until every one of its degrees has actually sounded.
// The player stays harmony-blind — it records only which folded tone sounded and when, carrying the
// tone's cents straight through from the program; cosmos-audio owns the root and does the folding.
const ledgerPlayer = Object.create(SpatialGridRowPlayer.prototype);
ledgerPlayer.ctx = fakeCtx();
ledgerPlayer.logicalVoiceCount = 0;
ledgerPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
ledgerPlayer.stars = new Map();
ledgerPlayer.soundedTones = new Map();
ledgerPlayer._claimToneVoice = () => true;
const ledgerDeck = { program: { grid: 7, repeatCull: true }, voices: new Map(), oscillators: new Set(),
  lastToneByLayer: new Map(), centsByFraction: new Map([['1/1', 0], ['5/4', 386.31], ['3/2', 701.96]]) };
ledgerPlayer.ctx.currentTime = 10;
ledgerPlayer._startVoice(ledgerDeck, { layer: 'A', rawRatio: 1, fraction: '1/1', rawFraction: '1/1' }, 9.5);
ledgerPlayer._startVoice(ledgerDeck, { layer: 'B', rawRatio: 1.25, fraction: '5/4', rawFraction: '5/4' }, 9.9);
ledgerPlayer._startVoice(ledgerDeck, { layer: 'C', rawRatio: 1.5, fraction: '3/2', rawFraction: '3/2' }, 10.4);  // lookahead
check('the ledger carries each sounded tone\'s cents through from the program',
  ledgerPlayer.soundedTones.get('5/4').cents === 386.31);
check('a lookahead attack is not counted as heard until audio-context time reaches it',
  ledgerPlayer.soundedSince(0).map(t => t.fraction).sort().join(',') === '1/1,5/4');
ledgerPlayer.ctx.currentTime = 10.5;
check('the same attack counts once its scheduled time arrives',
  ledgerPlayer.soundedSince(0).map(t => t.fraction).sort().join(',') === '1/1,3/2,5/4');
check('the ledger is windowed, so a chord only sees what sounded since it began',
  ledgerPlayer.soundedSince(10).map(t => t.fraction).sort().join(',') === '3/2');
// No reset on a chord change: an attack scheduled just before a boundary must still count toward the
// chord it lands in. Pruning is by age on read alone, which also bounds the map.
ledgerPlayer.ctx.currentTime = 400;
ledgerPlayer.soundedSince(0);
check('entries age out on read so the ledger cannot grow without bound', ledgerPlayer.soundedTones.size === 0);

console.log('\n  Audio-time visual activity');
const visualPlayer = Object.create(SpatialGridRowPlayer.prototype);
visualPlayer.enabled = true;
visualPlayer.ctx = { currentTime: 10 };
visualPlayer.stars = new Map([[120, {
  active: true,
  visualAttacks: [{ when: 9.9, strength: 1, ownerKey: 'A' }, { when: 10.05, strength: 1, ownerKey: 'B' }],
  visualLives: [{ startTime: 9, endTime: 10.12, ownerKey: 'A' }, { startTime: 10.05, endTime: Infinity, ownerKey: 'B' }],
}]]);
let visual = visualPlayer.visualState()[0];
check('aura follows the voice sounding now, not the next lookahead-scheduled voice',
  visual.voices === 1 && visual.pulse > 0);
// per-source breakdown: only the owner rhythm sounding NOW lights, and its lookahead attack (age < 0)
// does not light its node early.
check('sources light only the owner rhythm sounding now (future lookahead attack stays dark)',
  visual.sources.length === 1 && visual.sources[0].key === 'A' && visual.sources[0].voices === 1 && visual.sources[0].pulse > 0);
visualPlayer.ctx.currentTime = 10.08;
visual = visualPlayer.visualState()[0];
check('aura sees the brief real crossfade overlap once audio-context time reaches it', visual.voices === 2);
check('both overlapping owner rhythms now light their own nodes', (() => {
  const byKey = new Map(visual.sources.map(s => [s.key, s]));
  return visual.sources.length === 2 && byKey.get('A').voices === 1 && byKey.get('B').voices === 1 && byKey.get('B').pulse > 0;
})());

console.log('\n  Camera/WebAudio coordinate frame');
const basis = { r: [1, 0, 0], u: [0, 1, 0], d: [0, 0, 1] };
check('fixed listener uses WebAudio right-handed defaults',
  AUDIO_LISTENER_FORWARD.join(',') === '0,0,-1' && AUDIO_LISTENER_UP.join(',') === '0,1,0');
check('camera-front maps to WebAudio front and screen-right maps to audio +X',
  toAudioListenerPosition([3, 2, 10], basis).join(',') === '3,2,-10');
check('a genuinely rear source remains rear rather than being sign-flipped into view',
  toAudioListenerPosition([-3, 1, -10], basis).join(',') === '-3,1,10');

console.log('\n  Product wiring');
const audio = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../spatial-grid-row-player.js', import.meta.url), 'utf8');
const flight = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
const aura = readFileSync(new URL('../grid-row-aura.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./cull2-program-worker.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
check('compiler is a dedicated worker receiving compact finalized ownership',
  worker.includes('compileGridAudioProgram') && flight.includes('ProgramWorkerPool') && flight.includes('ratioOwners: z.ratioOwners'));
check('main scheduler only schedules precompiled row programs',
  audio.includes('gridRowPlayer?.tick') && !player.includes('buildGridCull2Readout') && !player.includes('ratioOwners'));
check('every Cosmos dry/wet path reaches the destination through a fast safety limiter',
  audio.includes('createDynamicsCompressor()') && audio.includes('muteGainNode.connect(outputLimiter)') &&
  audio.includes('outputLimiter.connect(audioCtx.destination)'));
check('culled rows use their own tunable voice waveform while ambient keeps the shared contract',
  audio.includes('osc.type = RHYTHM_VOICE_WAVEFORM') && player.includes('osc.type = ROW_WAVEFORM') &&
  player.includes("ROW_WAVEFORM = 'triangle'"));
check('row voices are short-gated into a shared reverb send, not sustained legato',
  player.includes('ROW_GATE') && player.includes('_buildReverbSend') && player.includes('makeRowImpulse') &&
  !player.includes('_startLegato'));
check('silent hold is re-derived per loop so held tones re-articulate each cycle instead of vanishing',
  player.includes('deck.lastToneByLayer') && player.includes('deck.lastToneByLayer.clear()'));
check('flight supplies true listener distance and the player enforces the four-voice tone cap',
  flight.includes('distance: candidate.distance') && player.includes('_claimToneVoice') &&
  CULLED_ROW_MAX_VOICES_PER_TONE === 4 && flight.includes('toneCapEvictions'));
check('3D graph uses one PannerNode per star and listener orientation, not screen pan',
  player.includes('createPanner()') && player.includes("panningModel = 'HRTF'") && player.includes('AUDIO_LISTENER_FORWARD'));
check('flight aura reads live row voices and attack pulses without entering the worker/compiler path',
  audio.includes('gridRowVisualState') && player.includes('visualState()') && player.includes('visualAttacks') &&
  aura.includes('drawGridRowAura') && flight.includes('gridRowVisualState()') && flight.includes("!bloomed.has(z.grid)"));
check('audio and aura concerns live in dedicated modules rather than the flight renderer',
  flight.includes("from './spatial-audio-frame.js'") && flight.includes("from './grid-row-aura.js'") &&
  !flight.includes('function drawGridRowAura'));
check('dense selected-ratio debug data uses real wrapping cells instead of pad-based text columns',
  flight.includes("createElement('table')") && flight.includes("className = 'sky-ratio-table'") &&
  flight.includes("className = 'sky-ratio-tokens'") && !flight.includes('selected.padEnd'));
check('debug overlay scroll captures the wheel only under the pointer and contains scroll chaining',
  flight.includes('pointer-events:auto') && flight.includes("addEventListener('wheel', event => event.stopPropagation()") &&
  flight.includes('overscroll-behavior:contain'));
check('debug overlay renders a sticky root-policy summary and explainable candidate table',
  flight.includes("className = 'sky-root-policy'") && flight.includes("className = 'sky-root-policy-table'") &&
  flight.includes('ROOT SELECTION · LIVE POLICY') && style.includes('#sky-debug-panel .sky-root-policy') && style.includes('position: sticky'));
check('cockpit exposes both explicit modes with ambient chords as default',
  page.includes('id="lrc-audio-mode"') && page.indexOf('value="ambient-chords" selected') < page.indexOf('value="culled-grid-rows"'));
check('cockpit exposes the live local-tuning weight in voice-leading semitone units',
  page.includes('id="lrc-tuning-slider"') && page.includes('id="lrc-tuning-readout"') &&
  page.indexOf('id="lrc-tempo-slider"') < page.indexOf('id="lrc-tuning-slider"') &&
  flight.includes('setTuningStrength(tuningSliderEl.value)'));
check('flight guards every compile with finalized ownership and movement budgets',
  flight.includes('audioCompileEligibility(z)') && flight.includes('chooseSpatialRows(candidates, rowActiveIds)'));

console.log(`\n${PASS ? '✓✓✓ CULL2 GRID 3D AUDIO PASSES' : '✗ CULL2 GRID 3D AUDIO FAILED'}`);
process.exit(PASS ? 0 : 1);
