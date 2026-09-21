import { readFileSync } from 'node:fs';
import { gridRatioOwnerSolve, gridShardSystems, shardKeysOf } from '../grid-core.js';
import { ProgramWorkerPool } from '../program-worker-pool.js';
import { selectedGridRatioToneRows, setMix, currentMix, setAuditionListen, currentAuditionListen, leadNoteInChord,
  setFundamentalOffset, currentFundamental, currentModulation, totalDetuneCents, glideCentsAt,
  setHarmonySource, setHarmonyScale, currentHarmonyPolicy, currentSkyChord } from '../cosmos-audio.js';
import {
  CULLED_ROW_FUNDAMENTAL_HZ, CULLED_ROW_MAX_HZ, ROW_MICRO_GAP_SECONDS,
  SpatialGridRowPlayer, culledGridRowFrequency, nearestCulledToneVoices,
  nextRowLayerGapTicks, rowEnvelopePlan, shouldScheduleRowAction,
} from '../spatial-grid-row-player.js';
import { getRecipe } from '../instruments/instrument-presets.js';
import { bedTargetsForPolicy, harmonyPolicySelectionKey, matchHarmonyTarget, normalizeHarmonyPolicy, signedCircularCentsDistance } from '../harmony-policy.js';
import { AUDIO_LISTENER_FORWARD, AUDIO_LISTENER_UP, toAudioListenerPosition } from '../spatial-audio-frame.js';
import {
  AUDIO_MODES, CULLED_ROW_MAX_VOICES_PER_TONE, RHYTHM_VOICE_WAVEFORM,
  ROW_ACTIVE_STARS, ROW_PREWARM_STARS, ROW_RADIUS, ROW_MAX_COMPOSITE_ONSETS,
  audioCompileEligibility, buildRowScheduleTables, chooseSpatialRows, compileGridAudioProgram,
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
const microPolicy = normalizeHarmonyPolicy({ source: 'chord-walk', chordId: 'micro', chordTargets: [0, 386.314, 701.955], toleranceCents: 15 });
check('generic policy matching preserves arbitrary cent targets without semitone quantization',
  matchHarmonyTarget(390, 0, microPolicy).selected && matchHarmonyTarget(390, 0, microPolicy).targetCents === 386.314);
check('cent distance wraps signed around the octave boundary',
  signedCircularCentsDistance(1195, 0) === -5 && signedCircularCentsDistance(5, 0) === 5);
check('the new selection key carries policy ID, normalized targets, tolerance, and exact root identity', (() => {
  const key = harmonyPolicySelectionKey({ rootKey: 4, fraction: '5/4', cents: 386.314 }, microPolicy);
  return key.includes('policy:chord-walk:micro') && key.includes('targets:0,386.314,701.955') && key.includes('window:15') && key.includes('root:4:5/4:386.314000');
})());
check('scale source exposes one shared normalized policy to the bed/rows/root consumers', (() => {
  setHarmonyScale('diatonic-major'); setHarmonySource('scale');
  const policy = currentHarmonyPolicy(), readout = currentSkyChord();
  const ok = policy.id === 'diatonic-major' && policy.targets.join(',') === '0,200,400,500,700,900,1100' &&
    readout.targets.join(',') === policy.targets.join(',') && bedTargetsForPolicy(policy).join(',') === '0,400,700';
  setHarmonySource('chord-walk');
  return ok;
})());

console.log('\n  Schedule-time ROW 1/1 policy');
check('ROW 1/1 off skips only literal 1/1, not octave equivalents',
  !shouldScheduleRowAction({ rawFraction: '1/1', fraction: '1/1' }, false) &&
  shouldScheduleRowAction({ rawFraction: '2/1', fraction: '1/1' }, false) &&
  shouldScheduleRowAction({ rawFraction: '4/1', fraction: '1/1' }, false));
check('ROW 1/1 on preserves every scheduled action', shouldScheduleRowAction({ rawFraction: '1/1' }, true));

console.log('\n  Monster/final-ownership gate');
const owners = [{ fraction: '1/1', cents: 0, key: '2.3', layers: [2, 3], layerSum: 5 }];
check('gated monster is ineligible even though visual state says solved',
  audioCompileEligibility({ state: 'solved', monster: true, ratioOwners: owners }).reason === 'monster-gated');
check('partial ownership is ineligible',
  audioCompileEligibility({ state: 'solved', monster: false, shardsTotal: 3, shardsDone: 2, ratioOwners: owners }).reason === 'partial-ownership');
check('only all-shards-finalized ownership is compiler eligible',
  audioCompileEligibility({ state: 'solved', monster: false, shardsTotal: 3, shardsDone: 3, ratioOwners: owners }).eligible);
// Interim OOM cap: a drone-dense rhythm (layerSum over the onset cap) is skipped rather than OOM-compiled;
// the cap is on ONSETS (layerSum), so a huge-LCM zone built from small coprime layers stays eligible.
const finalized = { state: 'solved', monster: false, shardsTotal: 1, shardsDone: 1 };
check('a rhythm past the composite-onset cap is skipped as too-dense (interim OOM guard)',
  audioCompileEligibility({ ...finalized, ratioOwners: [{ fraction: '1/1', cents: 0, key: 'drone', layers: [ROW_MAX_COMPOSITE_ONSETS + 1], layerSum: ROW_MAX_COMPOSITE_ONSETS + 1 }] }).reason === 'too-dense');
check('a huge-LCM zone from small coprime layers stays eligible (cap is on onsets, not grid/LCM)',
  audioCompileEligibility({ ...finalized, ratioOwners: [{ fraction: '1/1', cents: 0, key: 'coprime', layers: [5, 7, 11, 13], layerSum: 36 }] }).eligible);

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

console.log('\n  Batch 4 — precomputed schedule tables (worker parity)');
// The worker now bakes three schedule tables into every program so the 40 Hz scheduler and the deck-swap
// seed never re-derive on the main thread. Each is a pure function of (events, grid, repeatCull), so the
// gate is exact parity with the runtime derivations these tables replaced: nextRowLayerGapTicks (per onset,
// was O(E²)/cycle), the two-pass _seedDeck, and the findIndex in _syncCursor.
const mapsEqual = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
// Reference derivations, verbatim to the code the tables replace.
const refSeed = (events, grid, absoluteTick) => {
  const cycleTick = ((absoluteTick % grid) + grid) % grid;
  const latest = new Map();
  for (const ev of events) for (const ac of ev.layerActions) latest.set(ac.layer, ac);
  for (const ev of events) { if (ev.tick >= cycleTick) break; for (const ac of ev.layerActions) latest.set(ac.layer, ac); }
  const out = new Map();
  for (const ac of latest.values()) out.set(ac.layer, ac.rawFraction);
  return out;
};
const refSync = (events, grid, absoluteTick) => {
  const cursorCycle = Math.floor(absoluteTick / grid);
  const cycleTick = absoluteTick - cursorCycle * grid;
  let cursorEvent = events.findIndex(ev => ev.tick >= cycleTick);
  let cycle = cursorCycle;
  if (cursorEvent < 0) { cursorEvent = 0; cycle++; }
  return { cursorEvent, cursorCycle: cycle };
};
const gapParityPlayer = Object.create(SpatialGridRowPlayer.prototype);
// One driver that checks all three tables on a program, over every integer boundary in [0, 2·grid).
const assertScheduleTableParity = (label, events, grid, repeatCull) => {
  const { eventGaps, seedTable } = buildRowScheduleTables(events, grid, repeatCull);
  let gapChecked = 0, gapMiss = 0;
  for (let e = 0; e < events.length; e++) {
    const la = events[e].layerActions;
    for (let a = 0; a < la.length; a++) {
      gapChecked++;
      if (eventGaps[events[e].gapBase + a] !== nextRowLayerGapTicks(events, e, la[a], grid, repeatCull)) gapMiss++;
    }
  }
  check(`${label}: every precomputed gap equals nextRowLayerGapTicks (repeatCull=${repeatCull})`,
    gapChecked > 0 && gapMiss === 0, `${gapMiss}/${gapChecked} mismatch`);
  const program = { events, grid, seedTable, repeatCull };
  let seedMiss = 0, syncMiss = 0;
  const span = Math.min(grid, 400);   // every boundary for small grids; a bounded scan for larger ones
  for (let at = 0; at < 2 * span; at++) {
    const seedDeck = { program, lastToneByLayer: new Map() };
    gapParityPlayer._seedDeck(seedDeck, at);
    if (!mapsEqual(seedDeck.lastToneByLayer, refSeed(events, grid, at))) seedMiss++;
    const syncDeck = { program, cursorEvent: -1, cursorCycle: -1 };
    gapParityPlayer._syncCursor(syncDeck, at);
    const ref = refSync(events, grid, at);
    if (syncDeck.cursorEvent !== ref.cursorEvent || syncDeck.cursorCycle !== ref.cursorCycle) syncMiss++;
  }
  check(`${label}: table-driven _seedDeck matches the two-pass derivation across boundaries`, seedMiss === 0, `${seedMiss} mismatch`);
  check(`${label}: binary-search _syncCursor matches the findIndex cursor across boundaries`, syncMiss === 0, `${syncMiss} mismatch`);
};
// Synthetic fixture with same-tone runs, a wrap, a single-occurrence layer, and two-tone layers — exercises
// every gap branch deterministically. Fields mirror an interned action (rawFraction/fraction/rawRatio).
const act = (layer, num, den) => ({ layer, rawFraction: `${num}/${den}`, fraction: `${num}/${den}`, rawRatio: num / den });
const syntheticEvents = () => [
  { tick: 0, layerActions: [act('A', 1, 1), act('B', 3, 2)] },
  { tick: 2, layerActions: [act('A', 1, 1)] },                     // same-tone hold on A
  { tick: 5, layerActions: [act('A', 5, 4), act('C', 7, 4)] },
  { tick: 7, layerActions: [act('A', 5, 4)] },                     // same-tone hold on A → wraps to occ 0
  { tick: 9, layerActions: [act('C', 9, 8)] },
];
assertScheduleTableParity('synthetic', syntheticEvents(), 12, true);
assertScheduleTableParity('synthetic', syntheticEvents(), 12, false);
// Dense fixture the chord-filtered real grids can't reach: long same-tone runs (the reverse-pass carry),
// multiple wraps, and a sparse layer, at a scale where the old per-onset scan was the O(E²) freeze.
const denseEvents = () => {
  const tones = [[1, 1], [5, 4], [3, 2], [7, 4]];
  const evs = [];
  for (let i = 0; i < 1500; i++) {
    const la = [act('A', ...tones[(i / 7 | 0) % tones.length])];   // A holds the same tone for 7 onsets → runs
    if (i % 4 === 0) la.push(act('B', ...tones[i % tones.length])); // B sparse, tone rotates every onset
    evs.push({ tick: i * 3, layerActions: la });
  }
  return evs;
};
assertScheduleTableParity('dense', denseEvents(), 1500 * 3, true);
assertScheduleTableParity('dense', denseEvents(), 1500 * 3, false);
// Real compiled programs across grids and both repeat-cull settings — realistic collision/hold shapes.
for (const g of [120, 660, 2520]) {
  const s = gridRatioOwnerSolve(g);
  const fr = selectedOwnerFractions(s.ratioOwners, 0, [0, 2, 4, 5, 7, 9, 11]);   // broad selection → denser tape
  for (const rc of [true, false]) {
    const prog = compileGridAudioProgram({ grid: g, ratioOwners: s.ratioOwners, abundance: s.keptCount,
      selectedFractions: fr, selectionKey: harmonicSelectionKey(0, 0), generation: 0, repeatCull: rc });
    assertScheduleTableParity(`grid ${g}`, prog.events, prog.grid, prog.repeatCull);
    // The emitted program must carry the tables the player reads, sized to the tape.
    const actionCount = prog.events.reduce((n, ev) => n + ev.layerActions.length, 0);
    check(`grid ${g} (repeatCull=${rc}): program carries a gap table sized to its onsets and a per-layer seed table`,
      prog.eventGaps.length === actionCount && prog.seedTable.length === new Set(prog.events.flatMap(ev => ev.layerActions.map(a => a.layer))).size &&
      prog.events.every(ev => Number.isInteger(ev.gapBase)));
  }
}

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
// The tone cap now reads a denormalized index (toneKey -> Map<voice, deck>) instead of scanning every
// star/deck/voice, so this white-box fixture maintains that index in lockstep with deck.voices — exactly
// as the live player does at its _startVoice / _releaseLayer / onended sites.
allocationPlayer._voicesByTone = new Map();
allocationPlayer._releaseLayer = (deck, layer) => {
  const voice = deck.voices.get(layer);
  deck.voices.delete(layer);
  if (voice) allocationPlayer._indexRemoveVoice(voice);
  allocationPlayer.logicalVoiceCount--;
};
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
for (const star of allocationPlayer.stars.values())
  for (const voice of star.currentDeck.voices.values()) allocationPlayer._indexAddVoice(star.currentDeck, voice);
const nearerDeck = allocationPlayer.stars.get(40).currentDeck;
check('a nearer live request claims the tone and evicts its farthest incumbent',
  allocationPlayer._claimToneVoice(nearerDeck, { layer: 'A', fraction: '1/1' }, 0) &&
  allocationPlayer.stars.get(50).currentDeck.voices.size === 0 && allocationPlayer.stats.toneCapEvictions === 1);
const claimedVoice = { layer: 'A', toneKey: '1/1' };
nearerDeck.voices.set('A', claimedVoice);
allocationPlayer._indexAddVoice(nearerDeck, claimedVoice);
allocationPlayer.stars.set(60, { id: 60, distance: 600, retiringDecks: [], currentDeck: allocationDeck(60, false) });
check('a fifth farther live request is rejected without disturbing the nearest four',
  !allocationPlayer._claimToneVoice(allocationPlayer.stars.get(60).currentDeck, { layer: 'A', fraction: '1/1' }, 0) &&
  allocationPlayer.stats.toneCapMisses === 1 && allocationPlayer._toneVoiceCandidates('1/1').length === 4);
check('the tone index stays consistent with deck.voices after eviction and rejection',
  allocationPlayer._voicesByTone.get('1/1').size === 4 &&
  [...allocationPlayer._voicesByTone.get('1/1').keys()].every(voice =>
    [...allocationPlayer.stars.values()].some(star => [...star.currentDeck.voices.values()].includes(voice))));

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
// Short gated voices end via the renderer handle's completion, not _releaseLayer — the slot must be
// freed exactly once on either path or the count leaks to MAX_ROW_OSC and all later attacks are silently
// dropped. The instrument seam moved the oscillator graph into the handle, so this fixture simulates a
// voice ending by firing the last-created oscillator's onended (which the handle wired up); classic's
// single-oscillator recipe keeps one source per voice, so cost is 1 and the accounting is unchanged.
const fakeParam = () => ({ value: 0.0001, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
const fakeCtx = () => {
  const ctx = {
    sampleRate: 48000, currentTime: 0, _oscs: [],
    createOscillator() { const o = { type: '', frequency: fakeParam(), detune: fakeParam(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; ctx._oscs.push(o); return o; },
    createGain: () => ({ gain: fakeParam(), connect() {}, disconnect() {} }),
  };
  return ctx;
};
const classicRecipe = role => getRecipe('classic', role);
const budgetPlayer = Object.create(SpatialGridRowPlayer.prototype);
budgetPlayer.ctx = fakeCtx();
budgetPlayer.getRecipe = classicRecipe;
budgetPlayer.logicalVoiceCount = 0;
budgetPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
budgetPlayer.stars = new Map();
budgetPlayer._voicesByTone = new Map();      // _startVoice / handle.onComplete maintain the tone index
budgetPlayer._claimToneVoice = () => true;   // isolate accounting from the per-tone spatial cap
const budgetDeck = () => ({ program: { grid: 7, repeatCull: true }, voices: new Map(), handles: new Set(), lastToneByLayer: new Map() });
const deckA = budgetDeck();
budgetPlayer._startVoice(deckA, { layer: 'A', rawRatio: 1, fraction: '1/1', rawFraction: '1/1' }, 0, false);
check('a started voice occupies exactly one budget slot', budgetPlayer.logicalVoiceCount === 1);
budgetPlayer.ctx._oscs.at(-1).onended();   // the voice's single source ends → handle completes → slot freed
check('a voice ending naturally frees its slot (no leak → no eventual total silence)', budgetPlayer.logicalVoiceCount === 0);
const deckB = budgetDeck();
budgetPlayer._startVoice(deckB, { layer: 'A', rawRatio: 1, fraction: '1/1', rawFraction: '1/1' }, 0, false);
const stolenOsc = budgetPlayer.ctx._oscs.at(-1);
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
holdPlayer.getRecipe = classicRecipe;
holdPlayer.logicalVoiceCount = 0;
holdPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
holdPlayer.stars = new Map();
holdPlayer._voicesByTone = new Map();
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
swapPlayer.getRecipe = classicRecipe;
swapPlayer.logicalVoiceCount = 0;
swapPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
swapPlayer.stars = new Map();
swapPlayer._claimToneVoice = () => true;
const swapDeck = { program, voices: new Map(), handles: new Set(), lastToneByLayer: new Map(), ownerKeyByFraction: new Map() };
swapPlayer._seedDeck(swapDeck, 3 * program.grid + Math.floor(program.grid / 2));
check('a program swap starts no voices and consumes no budget',
  swapDeck.handles.size === 0 && swapDeck.voices.size === 0 && swapPlayer.logicalVoiceCount === 0);
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
ledgerPlayer.getRecipe = classicRecipe;
ledgerPlayer.logicalVoiceCount = 0;
ledgerPlayer.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
ledgerPlayer.stars = new Map();
ledgerPlayer.soundedTones = new Map();
ledgerPlayer._voicesByTone = new Map();
ledgerPlayer._claimToneVoice = () => true;
const ledgerDeck = { program: { grid: 7, repeatCull: true }, voices: new Map(), handles: new Set(),
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

// An empty ledger means two opposite things, and the sky's exposure floor has to tell them apart: the
// rows have not finished saying this chord yet (hold), or there is no row source here to say it (the
// floor is vacuous — see chordExposure). soundingStarCount is that predicate. A pending deck counts, so
// the install boundary is not a hole in which a field full of rows briefly reports none.
const countPlayer = Object.create(SpatialGridRowPlayer.prototype);
const withEvents = { program: { events: [{ tick: 0 }] } };
countPlayer.stars = new Map([
  [1, { active: true, currentDeck: withEvents, pending: null }],
  [2, { active: true, currentDeck: null, pending: withEvents }],
  [3, { active: true, currentDeck: null, pending: null }],                              // no program yet
  [4, { active: true, currentDeck: { program: { events: [] } }, pending: null }],       // program, no onsets
  [5, { active: false, currentDeck: withEvents, pending: null }],                       // left the field, fading
]);
check('soundingStarCount counts only active stars that can actually articulate',
  countPlayer.soundingStarCount() === 2, `got ${countPlayer.soundingStarCount()}`);
countPlayer.stars = new Map();
check('an empty field reports no row source, so the floor can go vacuous instead of unsatisfiable',
  countPlayer.soundingStarCount() === 0);

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

console.log('\n  Bus split (MIX crossfade + audition independence)');
check('setMix(0) → bed-only, constant-power cos(0)=1', (() => {
  setMix(0); return currentMix() === 0;
})());
check('setMix(1) → rows-only, constant-power sin(π/2)=1', (() => {
  setMix(1); return currentMix() === 1;
})());
check('setMix clamps to [0,1]', (() => {
  setMix(-1); const lo = currentMix(); setMix(2); const hi = currentMix();
  setMix(0); return lo === 0 && hi === 1;
})());
check('audition listen is independent of mix', (() => {
  setMix(1); setAuditionListen(true); const onAtRows = currentAuditionListen();
  setMix(0); const onAtBed = currentAuditionListen();
  setAuditionListen(false); const offAtBed = currentAuditionListen();
  setMix(1); const offAtRows = currentAuditionListen();
  setAuditionListen(true); setMix(0);
  return onAtRows && onAtBed && !offAtBed && !offAtRows;
})());
check('leadMask is independent of mix (pure function, no AudioContext needed)', (() => {
  const inChord = leadNoteInChord(1.25, 0, 0);   // 5/4 → 386¢ → degree 4, in [0,4,7]
  setMix(1); const atRows = leadNoteInChord(1.25, 0, 0);
  setMix(0); return inChord && atRows;
})());

console.log('\n  Pitch-offset split (fundamental + modulation summed on one detune bus)');
// FUNDAMENTAL and modulation are two ConstantSourceNodes summed on one detune bus; the ensemble hears —
// and the MIDI mirror spells — their SUM, while each keeps its own independent automation.
check('total detune is the exact sum of the two offsets',
  totalDetuneCents(200, 298.045) === 498.045 && totalDetuneCents(-50, 50) === 0);
check('a not-yet-initialised offset contributes 0 rather than poisoning the sum with NaN',
  totalDetuneCents(NaN, 120) === 120 && totalDetuneCents(120, undefined) === 120 && totalDetuneCents(undefined, undefined) === 0);
// Two DIFFERENT recorded glides, each reproduced independently — one gesture never reads the other's curve.
const fundCurve = { from: 0, to: 1200, at: 0, timeConstant: 1 };
const modCurve = { from: 0, to: -600, at: 0, timeConstant: 1 };
check('each recorded glide reproduces setTargetAtTime\'s exponential approach independently, and their sum tracks both', (() => {
  const t = 1;   // one time-constant in → ~63.2% of the way home
  const f = glideCentsAt(fundCurve, t), m = glideCentsAt(modCurve, t);
  const expF = 1200 * (1 - Math.exp(-1)), expM = -600 * (1 - Math.exp(-1));
  return Math.abs(f - expF) < 1e-9 && Math.abs(m - expM) < 1e-9 && Math.abs(totalDetuneCents(f, m) - (expF + expM)) < 1e-9;
})());
check('FUNDAMENTAL clamps to ±2 octaves and setting it never disturbs the modulation offset', (() => {
  const modBefore = currentModulation().cents;
  const hi = setFundamentalOffset(99999), lo = setFundamentalOffset(-99999), mid = setFundamentalOffset(350);
  const ok = hi === 2400 && lo === -2400 && mid === 350 &&
    currentFundamental().cents === 350 && currentFundamental().maxCents === 2400 &&
    currentModulation().cents === modBefore;
  setFundamentalOffset(0);   // hygiene: leave the module offset at rest for later suites
  return ok;
})());

console.log('\n  Product wiring');
const audio = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../spatial-grid-row-player.js', import.meta.url), 'utf8');
const flight = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
const aura = readFileSync(new URL('../grid-row-aura.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./cull2-program-worker.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const style = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const voiceRenderer = readFileSync(new URL('../instruments/instrument-voice.js', import.meta.url), 'utf8');
check('compiler is a dedicated worker receiving compact finalized ownership',
  worker.includes('compileGridAudioProgram') && flight.includes('ProgramWorkerPool') && flight.includes('ratioOwners: z.ratioOwners'));
check('main scheduler only schedules precompiled row programs',
  audio.includes('gridRowPlayer?.tick') && !player.includes('buildGridCull2Readout') && !player.includes('ratioOwners'));
check('every Cosmos dry/wet path reaches the destination through a master trim then a fast safety limiter',
  audio.includes('createDynamicsCompressor()') && audio.includes('muteGainNode.connect(masterVolume)') &&
  audio.includes('masterVolume.connect(outputLimiter)') && audio.includes('outputLimiter.connect(audioCtx.destination)'));
// The instrument seam replaced the inline per-role oscillators with per-role RECIPES: row timbre is now
// tuned independently of the ambient bed via the palette catalog, and the row player builds its voice
// through the shared renderer instead of hardcoding a waveform. Classic reproduces today's split
// (rows/audition triangle, bed sine), which is what keeps this a parity change rather than a new sound.
check('each role has its own tunable voice recipe (rows distinct from the ambient bed), built via the renderer',
  getRecipe('classic', 'row').components[0].wave === 'triangle' &&
  getRecipe('classic', 'bed').components[0].wave === 'sine' &&
  player.includes('createInstrumentVoice(') && player.includes("this.getRecipe('row')"));
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
check('three independent gain buses feed muteGainNode through a constant-power MIX crossfade',
  audio.includes('bedGain.connect(muteGainNode)') && audio.includes('rowsGain.connect(muteGainNode)') &&
  audio.includes('auditionGain.connect(muteGainNode)') && audio.includes('Math.cos(mix * Math.PI / 2)') &&
  audio.includes('Math.sin(mix * Math.PI / 2)'));
check('audition bus is wired through its own gain, independent of bed/rows crossfade',
  audio.includes('distGainNode.connect(auditionGain)') && audio.includes('setAuditionListen'));
check('bed bus feeds bedGain (not the old ambientModeGain)',
  audio.includes('bedBus.connect(bedGain)') && audio.includes('reverbWet.connect(bedGain)') &&
  !audio.includes('ambientModeGain'));
check('row player receives rowsGain as output so the MIX crossfade gates it',
  audio.includes('SpatialGridRowPlayer(audioCtx, rowsGain,'));
check('the detune bus sums two independent offset sources — fundamental + modulation — into one bus',
  audio.includes('fundamentalOffset = audioCtx.createConstantSource()') &&
  audio.includes('modulationOffset = audioCtx.createConstantSource()') &&
  audio.includes('detuneBus = audioCtx.createGain()') &&
  audio.includes('fundamentalOffset.connect(detuneBus)') && audio.includes('modulationOffset.connect(detuneBus)'));
// Every pitched voice still tracks the one summed bus — but the connection now lives once, in the shared
// renderer, and each caller hands it the same bus (the row player through its constructor, cosmos-audio
// through the row player and, for bed/lead, into createInstrumentVoice). Birth frequency stays base pitch
// only, so transposition is applied exactly once (never folded into the frequency).
check('every voice detunes off the summed bus via the renderer, applied once (never a single offset, never twice)',
  voiceRenderer.includes('detuneBus.connect(osc.detune)') &&
  player.includes('detuneBus: this.detuneBus') &&
  audio.includes('SpatialGridRowPlayer(audioCtx, rowsGain, detuneBus'));
check('the row register ceiling stays DERIVED from the fundamental anchor, not a re-hardcoded literal',
  player.includes('CULLED_ROW_MAX_HZ = CULLED_ROW_FUNDAMENTAL_HZ * (2 ** CULLED_ROW_MAX_OCTAVES)') &&
  !/CULLED_ROW_MAX_HZ\s*=\s*\d/.test(player));
check('cockpit exposes the live local-tuning weight in voice-leading semitone units',
  page.includes('id="lrc-tuning-slider"') && page.includes('id="lrc-tuning-readout"') &&
  page.indexOf('id="lrc-tempo-slider"') < page.indexOf('id="lrc-tuning-slider"') &&
  flight.includes('setTuningStrength(tuningSliderEl.value)'));
check('flight guards every compile with finalized ownership and movement budgets',
  flight.includes('audioCompileEligibility(z)') && flight.includes('chooseSpatialRows(candidates, rowActiveIds)'));

// ── Two-clock safety valve (2026-08-18): setField is a SECOND reaper ─────────────────────────────────
// Stars are created on the rAF clock (setField) but normally destroyed only in tick() (transport-worker
// clock). If tick stalls/throws, inactive stars — each pinning a full program + audio nodes — pile up
// unbounded (the activeStars-climbs leak). setField must reap already-inactive stars past their removeAt
// itself, so a stalled tick cannot leak. This proves the reap fires WITHOUT tick ever being called.
{
  const vp = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {}, setPosition() {} });
  const vnode = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const vctx = {
    sampleRate: 48000, currentTime: 0,
    createBiquadFilter: () => vnode({ type: '', frequency: vp() }),
    createPanner: () => vnode({ panningModel: '', distanceModel: '', refDistance: 0, maxDistance: 0, rolloffFactor: 0, positionX: vp(), positionY: vp(), positionZ: vp(), setPosition() {} }),
    createGain: () => vnode({ gain: vp() }),
  };
  const V = Object.create(SpatialGridRowPlayer.prototype);
  V.ctx = vctx; V.master = vnode(); V.stars = new Map(); V._voicesByTone = new Map();
  V.logicalVoiceCount = 0; V.stats = { entries: 0, exits: 0, budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0 };
  const vitem = id => ({ id, position: [0, 0, 10], distance: 10, cutoff: 5000, gain: 0.5 });
  vctx.currentTime = 0;
  V.setField([vitem('A'), vitem('B')], 0);
  check('valve: field of two makes two stars', V.stars.size === 2);
  V.setField([vitem('A')], 0);                    // B leaves the field → marked inactive
  check('valve: a departed star is inactive and still in its crossfade tail (not yet reaped)',
    V.stars.size === 2 && V.stars.get('B').active === false && Math.abs(V.stars.get('B').removeAt - (0.35 + 0.08)) < 1e-9);
  vctx.currentTime = 1.0;                         // past removeAt, WITHOUT calling tick()
  V.setField([vitem('A')], 0);
  check('valve: setField ALONE reaps an inactive star past removeAt (tick never ran) — the strand cannot leak',
    V.stars.size === 1 && !V.stars.has('B') && V.stars.get('A').active === true);
}

console.log(`\n${PASS ? '✓✓✓ CULL2 GRID 3D AUDIO PASSES' : '✗ CULL2 GRID 3D AUDIO FAILED'}`);
process.exit(PASS ? 0 : 1);
