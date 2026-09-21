import { readFileSync } from 'node:fs';
import { chooseSpatialRows, ROW_ACTIVE_STARS } from '../cosmos-grid-audio-core.js';
import { DEFAULT_GRAVITY_OPTIONS, gravityWindowWeight } from '../gravity-core.js';

let pass = true;
const check = (name, ok, detail = '') => {
  pass = pass && ok;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const flight = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
const gravityWorker = readFileSync(new URL('./gravity-worker.js', import.meta.url), 'utf8');
const webWorker = readFileSync(new URL('./web-render-worker.js', import.meta.url), 'utf8');

console.log('═══ COSMOS GRAVITY — production integration assertions ═══');

console.log('\n  Worker and player bubble');
check('production creates the gravity module worker', flight.includes("new URL('./cosmos/gravity-worker.js?v=1'") && gravityWorker.includes("import { GravitySimulation } from '../gravity-core.js'"));
check('player world location is the simulation centre', flight.includes('center: gravityCameraWorld'));
check('G hold and transport tick feed the worker', flight.includes('held: !!keys.g || gravityDebugHold') && flight.includes('const gravityTick = currentTicks()'));
check('worker offsets use transferable ping-pong buffers', flight.includes('this.transfer = new Float32Array(capacity * 3)') && gravityWorker.includes("[output.buffer]"));

console.log('\n  Composition and safety');
const gravityComposeAt = flight.indexOf('const gravityOf = new Map()');
const bloomComposeAt = flight.indexOf('const bubbles = []');
check('gravity offsets compose before bloom deformation', gravityComposeAt >= 0 && bloomComposeAt > gravityComposeAt);
check('displaced stars clamp to Hilbert walls', flight.includes('const clamped = clampHilbertWorld(absolute)'));
check('open blooms are sent as pinned bodies', flight.includes('pinned: bloomed.has(z.grid)'));
check('five-second ramp is the shared production default', DEFAULT_GRAVITY_OPTIONS.rampTime === 5);

console.log('\n  Audio identity and connector fade');
check('audio membership reads rest while pose reads displacement',
  flight.includes('const audioMembershipPositions = gravityRenderer ? rpOf : placed') &&
  flight.includes('updateGridRowField(audioMembershipPositions, placed, basis'));
const restCandidates = Array.from({ length: 25 }, (_, id) => ({ id, distance: 100 + id, ready: true }));
const visualOrder = [...restCandidates].reverse().map((candidate, index) => ({ ...candidate, distance: 100 + index }));
const restSelection = chooseSpatialRows(restCandidates).active.map(candidate => candidate.id);
const unchangedSelection = chooseSpatialRows(restCandidates).active.map(candidate => candidate.id);
const movedSelection = chooseSpatialRows(visualOrder).active.map(candidate => candidate.id);
check('rest selection holds the same twenty IDs despite a visual reorder', ROW_ACTIVE_STARS === 20 &&
  restSelection.join(',') === unchangedSelection.join(',') && restSelection.join(',') !== movedSelection.join(','));
check('macro and bloom Webs share the gravity window fade', webWorker.includes('gravityWindowWeight') && flight.includes('gravityWebVisibility(crp)'));
check('Web visibility is zero at the player and full outside the bubble',
  1 - gravityWindowWeight(0) === 0 && 1 - gravityWindowWeight(DEFAULT_GRAVITY_OPTIONS.windowOuter + 1) === 1);

if (!pass) process.exit(1);
console.log('\nAll gravity integration assertions passed.');
