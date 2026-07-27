import { planFamilyGrids, monotonicWebPath, shortestWebPath, buildArcPath, sampleArcPath, rideDuration } from './web-return.js';
import { buildWebGraph, familyMembers } from './web-graph.js';

let pass = true;
const check = (name, ok, detail = '') => { pass = pass && ok; console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

console.log('═══ COSMOS WEB RETURN — bounded routing assertions ═══');

const near = planFamilyGrids(120, 60, 12);
check('near route visits every family member', near.grids.join(',') === '120,108,96,84,72,60');
check('near route ends at authored home', near.grids.at(-1) === 60 && !near.sampled);

const far = planFamilyGrids(12 * 2_000_000, 60, 12, 64);
check('far route stays within waypoint budget', far.grids.length <= 64, `${far.grids.length} points`);
check('every adaptive waypoint still owns the NR', far.grids.every(g => g % 12 === 0));
check('far route reports full logical span', far.logicalCount === 1_999_996 && far.sampled);
check('extreme ride duration is bounded', rideDuration(far.logicalCount) <= 42, `${rideDuration(far.logicalCount).toFixed(1)}s`);

const filtered = familyMembers([18, 19, 36, 54, 55], 18);
check('worker membership filter keeps only NR-owning grids', filtered.join(',') === '18,36,54');
const proximity = buildWebGraph([10, 11, 12, 30], g => [g, 0, 0], { neighbours: 1, bucketSize: 8 });
check('worker graph build emits stable local edges', proximity.edges.some(([a, b]) => [10, 11].includes(proximity.members[a]) && [10, 11].includes(proximity.members[b])));
check('worker graph adjacency covers every emitted edge', proximity.edges.every((_, i) => proximity.adjacency.some(list => list.includes(i))));

const graph = shortestWebPath([10, 20, 30, 40], [[0, 1], [1, 2], [0, 3], [3, 2]], 10, 30,
  g => g === 40 ? [100, 0, 0] : [g, 0, 0]);
check('finite Web route follows cheapest connected strands', graph.join(',') === '10,20,30', graph.join(','));

const corridorPoints = new Map([
  [1, [0, 0, 0]], [2, [2, 8, 0]], [3, [3, 1, 0]], [4, [5, -1, 0]],
  [5, [7, 1, 0]], [6, [8, 9, 0]], [9, [10, 0, 0]], [20, [-2, 0, 0]],
]);
const corridor = monotonicWebPath([...corridorPoints.keys()], 1, 9, g => corridorPoints.get(g),
  { bands: 4, maxWaypoints: 8, candidatesPerBand: 3 });
const corridorX = corridor.map(g => corridorPoints.get(g)[0]);
check('tube route starts and ends at the requested nodes', corridor[0] === 1 && corridor.at(-1) === 9, corridor.join(','));
check('tube route advances monotonically toward home', corridorX.every((x, i) => !i || x > corridorX[i - 1]), corridorX.join(','));
check('tube route prefers the straight corridor over lateral distractors', corridor.includes(3) && corridor.includes(4) && corridor.includes(5) && !corridor.includes(2) && !corridor.includes(6), corridor.join(','));

const arc = buildArcPath([[0, 0, 0], [10, 5, 0], [20, 0, 5]], 8);
const start = sampleArcPath(arc, 0), middle = sampleArcPath(arc, 0.5), end = sampleArcPath(arc, 1);
check('arc sampler preserves endpoints', start.position[0] === 0 && end.position[0] === 20 && end.position[2] === 5);
check('arc sampler returns finite center/tangent', [...middle.position, ...middle.tangent].every(Number.isFinite));
check('arc-length progress advances through the route', middle.position[0] > 5 && middle.position[0] < 15, middle.position.map(n => n.toFixed(2)).join(','));

if (!pass) process.exit(1);
console.log('\nAll Web-return assertions passed.');
