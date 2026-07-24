import { readFileSync } from 'node:fs';
import { gridRatioOwnerSolve } from '../grid-core.js';
import { ProgramWorkerPool } from '../program-worker-pool.js';
import { selectedGridRatioToneRows } from '../cosmos-audio.js';
import { SpatialGridRowPlayer } from '../spatial-grid-row-player.js';
import { AUDIO_LISTENER_FORWARD, AUDIO_LISTENER_UP, toAudioListenerPosition } from '../spatial-audio-frame.js';
import {
  AUDIO_MODES, ROW_ACTIVE_STARS, ROW_PREWARM_STARS, ROW_RADIUS,
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
const candidates = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, distance: 50 + i * 50, ready: i !== 1 && i !== 3 }));
const picked = chooseSpatialRows(candidates, new Set([8, 9, 10]));
check('prewarm is capped at the nearest 12 true-3D candidates', picked.prewarm.length === ROW_PREWARM_STARS && picked.prewarm.at(-1).id === 12);
check('active field is capped at 8 program-ready stars', picked.active.length === ROW_ACTIVE_STARS && picked.active.every(candidate => candidate.ready));
check('already-active ready stars retain hysteresis priority inside prewarm', picked.active.slice(0, 3).map(candidate => candidate.id).join(',') === '8,9,10');
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

console.log('\n  Audio-time visual activity');
const visualPlayer = Object.create(SpatialGridRowPlayer.prototype);
visualPlayer.enabled = true;
visualPlayer.ctx = { currentTime: 10 };
visualPlayer.stars = new Map([[120, {
  active: true,
  visualAttacks: [{ when: 9.9, strength: 1 }, { when: 10.05, strength: 1 }],
  visualLives: [{ startTime: 9, endTime: 10.12 }, { startTime: 10.05, endTime: Infinity }],
}]]);
let visual = visualPlayer.visualState()[0];
check('aura follows the voice sounding now, not the next lookahead-scheduled voice',
  visual.voices === 1 && visual.pulse > 0);
visualPlayer.ctx.currentTime = 10.08;
visual = visualPlayer.visualState()[0];
check('aura sees the brief real crossfade overlap once audio-context time reaches it', visual.voices === 2);

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
check('compiler is a dedicated worker receiving compact finalized ownership',
  worker.includes('compileGridAudioProgram') && flight.includes('ProgramWorkerPool') && flight.includes('ratioOwners: z.ratioOwners'));
check('main scheduler only schedules precompiled row programs',
  audio.includes('gridRowPlayer?.tick') && !player.includes('buildGridCull2Readout') && !player.includes('ratioOwners'));
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
