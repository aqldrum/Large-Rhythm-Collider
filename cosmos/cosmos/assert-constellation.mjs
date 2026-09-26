// Behavioural guards for the note constellation (Order B of
// cosmos/docs/COSMOS_NOTE_VISUALS_WORK_ORDER_2026-09-20.md). These assert what the figure DOES, not what
// the source says: the rules, the lifecycle, the coincidence ordering, and the renderer's clipping maths
// against a recording mock context. Nothing here touches audio, a browser or a real canvas.
import { CONSTELLATION_DEFAULTS, CONSTELLATION_FIGURE_CEILING, CONSTELLATION_LIFECYCLES, chainCoincidentAttacks, chordHold, createConstellation, lifespanFade } from '../constellation-core.js';
import { drawGridRowConstellation } from '../grid-row-constellation.js';
import { createViewFrame } from '../view-frame.js';
import { pitchHue } from '../grid-row-aura.js';
import { SpatialGridRowPlayer } from '../spatial-grid-row-player.js';

let PASS = true;
const check = (label, ok, detail = '') => {
  if (!ok) PASS = false;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

console.log('═══ COSMOS NOTE CONSTELLATIONS — assertions ═══');

// Attacks as the feed delivers them: { id: grid, when: audio-context seconds, hz, harmonyKey? }.
const at = (id, when, hz = 220 * id) => ({ id, when, hz });
const under = (harmonyKey, attack) => ({ ...attack, harmonyKey });
const LIFESPAN = { lifecycle: 'lifespan' };
const edgeKeys = list => list.map(e => `${e.from}-${e.to}`).join(',');

console.log('\n  Rules 1–3 (seed, connect, replay)');
{
  const c = createConstellation();
  // Avery's worked example: attacks on 1, 2, 3, 1, 4 yield edges 1–2, 2–3, 3–4. The replay of 1 draws
  // nothing and the tip stays at 3 — so the LAST edge runs 3–4, not 1–4.
  c.ingest([at(1, 0), at(2, 0.1), at(3, 0.2), at(1, 0.3), at(4, 0.4)], 0.4);
  check('the 1,2,3,1,4 example yields exactly 1–2, 2–3, 3–4', edgeKeys(c.edges(0.4)) === '1-2,2-3,3-4',
    `got ${edgeKeys(c.edges(0.4))}`);
  check('after the replay of an in-figure grid the figure has four vertices and three edges',
    c.stats().structural === 3 && c.stats().vertices === 4);
}
{
  const c = createConstellation();
  c.ingest([at(1, 0), at(2, 0.1), at(3, 0.2)], 0.2);
  const tipBefore = c.tip;
  c.ingest([at(1, 0.3)], 0.3);
  check('a replay on a grid already in the figure leaves the tip exactly where it was',
    tipBefore === 3 && c.tip === 3 && c.edges(0.3).length === 2, `tip ${c.tip}, ${c.edges(0.3).length} edges`);
  const tipHzBefore = c.tipHz;
  c.ingest([at(3, 0.35, 999)], 0.35);
  check('a replay on the TIP itself draws nothing, keeps the tip, and refreshes only its source colour',
    c.tip === 3 && c.edges(0.35).length === 2 && tipHzBefore !== 999 && c.tipHz === 999);
  check('the first reached attack seeds the tip without drawing a line', (() => {
    const fresh = createConstellation();
    fresh.ingest([at(9, 0)], 0);
    return fresh.tip === 9 && fresh.edges(0).length === 0;
  })());
  check('an edge freezes the pitches of the step that created it', (() => {
    const fresh = createConstellation();
    fresh.ingest([at(1, 0, 300), at(2, 0.1, 450)], 0.1);
    const [edge] = fresh.edges(0.1);
    fresh.ingest([at(1, 0.2, 1111)], 0.2);   // 1 re-sounds at another pitch: the drawn edge must not move
    const [after] = fresh.edges(0.2);
    return edge.fromHz === 300 && edge.toHz === 450 && after.fromHz === 300 && after.toHz === 450;
  })());
}

console.log('\n  Batch ingest ≡ sequential ingest');
{
  const batch = createConstellation(), one = createConstellation();
  const attacks = [at(5, 0), at(11, 0.02), at(5, 0.03), at(7, 0.04), at(11, 0.05), at(2, 0.06)];
  batch.ingest(attacks, 0.06);
  for (const a of attacks) one.ingest([a], 0.06);
  check('one batch equals the same attacks fed one at a time (edges, tip and vertex count)',
    edgeKeys(batch.edges(0.06)) === edgeKeys(one.edges(0.06)) && batch.tip === one.tip &&
    batch.stats().vertices === one.stats().vertices, `${edgeKeys(batch.edges(0.06))} vs ${edgeKeys(one.edges(0.06))}`);
}

console.log('\n  Coincidence order is the caller\'s (rule 5 lives in flight-view)');
{
  // The core must take the supplied order at face value — it has no positions and must not re-sort.
  const a = createConstellation(), b = createConstellation();
  a.ingest([at(3, 1), at(1, 1), at(2, 1)], 1);
  b.ingest([at(3, 1), at(1, 1), at(2, 1)], 1);
  check('the supplied order of a coincident group is respected exactly', edgeKeys(a.edges(1)) === '3-1,1-2',
    `got ${edgeKeys(a.edges(1))}`);
  check('the same supplied order is deterministic across runs', edgeKeys(a.edges(1)) === edgeKeys(b.edges(1)));
}

console.log('\n  Rule 6 (leaving the field splits the chain — never bridge)');
{
  const c = createConstellation();
  c.ingest([at(1, 0), at(2, 0), at(3, 0), at(4, 0)], 0);
  check('the chain is built before the departure', edgeKeys(c.edges(0)) === '1-2,2-3,3-4');
  c.retain(new Set([1, 3, 4]), 0.1);   // grid 2 leaves the row field
  const after = c.edges(0.2);           // a beat later, so the departure fade has visibly started
  check('a departed grid\'s edges are no longer structural and NO bridge 1–3 appears',
    !after.some(e => e.from === 1 && e.to === 3) && !after.some(e => e.from === 3 && e.to === 1) &&
    c.stats().structural === 1 && edgeKeys(after.filter(e => e.fade === 1)) === '3-4', `got ${edgeKeys(after)}`);
  check('the departing edges fade out rather than popping, then really leave the collections',
    after.length === 3 && after.filter(e => e.fade < 1 && e.fade > 0).length === 2 &&
    (c.edges(0.1 + CONSTELLATION_DEFAULTS.fade + 0.01).length === 1) && c.stats().edges === 1,
    `${after.length} drawn, ${after.filter(e => e.fade < 1 && e.fade > 0).length} fading`);
  check('the surviving end of a split edge is free to take a new edge immediately', (() => {
    c.ingest([at(1, 0.2)], 0.2);   // 1 was orphaned by the split; the tip is still 4
    return c.edges(0.2).some(e => e.from === 4 && e.to === 1);
  })());
}
{
  const c = createConstellation();
  c.ingest([at(1, 0), at(2, 0), at(3, 0)], 0);
  c.retain(new Set([1, 2]), 0.1);   // the TIP (3) leaves
  check('when the tip leaves the field the tip clears', c.tip === null);
  c.ingest([at(8, 0.2)], 0.2);
  check('the next new grid re-seeds instead of drawing a line from a ghost', c.tip === 8 &&
    !c.edges(0.2).some(e => e.to === 8 || e.from === 8));
  check('null membership is a no-op, so a gap in the feed cannot tear the figure down', (() => {
    const keep = createConstellation();
    keep.ingest([at(1, 0), at(2, 0)], 0);
    keep.retain(null, 0.1);
    return keep.stats().structural === 1 && keep.tip === 2;
  })());
}

console.log('\n  Lifecycle (lifespan policy)');
{
  const T = CONSTELLATION_DEFAULTS.lifespan, F = CONSTELLATION_DEFAULTS.fade;
  const c = createConstellation(LIFESPAN);
  c.ingest([at(1, 0), at(2, 0)], 0);
  check('an edge is fully opaque until its fade window begins', c.edges(T - F - 0.01)[0].fade === 1);
  check('it fades linearly across the last `fade` seconds', (() => {
    const half = c.edges(T - F / 2)[0];
    return half && Math.abs(half.fade - 0.5) < 1e-9;
  })());
  check('at `lifespan` it is gone AND actually dropped from the collections',
    c.edges(T).length === 0 && c.stats().edges === 0 && c.stats().vertices === 0);
  check('the tip never expires by age — only rule 2 or rule 6 moves it', c.tip === 2);
  check('an edgeless grid is eligible again: the next attack on it draws a fresh edge', (() => {
    c.ingest([at(1, T + 0.1)], T + 0.1);
    const edges = c.edges(T + 0.1);
    return edges.length === 1 && edges[0].from === 2 && edges[0].to === 1;
  })());
  check('the policy is one pure replaceable function, not logic wired into the rules',
    typeof lifespanFade === 'function' &&
    lifespanFade({ bornAt: 0 }, 0, { lifespan: 2, fade: 1 }) === 1 &&
    lifespanFade({ bornAt: 0 }, 1.5, { lifespan: 2, fade: 1 }) === 0.5 &&
    lifespanFade({ bornAt: 0 }, 2, { lifespan: 2, fade: 1 }) === 0);
  check('configure re-points the one options object the core and renderer share', (() => {
    const tuned = createConstellation();
    tuned.configure({ lifecycle: 'lifespan', lifespan: 1, fade: 0.5, drawIn: 0.25, enabled: false });
    tuned.ingest([at(1, 0), at(2, 0)], 0);
    return tuned.options.drawIn === 0.25 && tuned.options.enabled === false &&
      tuned.edges(0.4)[0].fade === 1 && tuned.edges(0.75)[0].fade === 0.5 && tuned.edges(1).length === 0;
  })());
}

console.log('\n  Lifecycle (chord policy — the default)');
{
  check('the default lifecycle holds the figure until the chord changes',
    CONSTELLATION_DEFAULTS.lifecycle === 'chord' && CONSTELLATION_LIFECYCLES.join(',') === 'chord,lifespan' &&
    chordHold({ bornAt: 0 }, 1e6, CONSTELLATION_DEFAULTS) === 1);
  const c = createConstellation();
  const A = 'harmony-A', B = 'harmony-B';
  c.ingest(c.admit([under(A, at(1, 0))], A), 0);
  c.ingest(c.admit([under(A, at(2, 0.5))], A), 0.5);
  c.ingest(c.admit([under(A, at(3, 1))], A), 1);
  check('edges never age out under one chord: fully opaque and still structural long past any lifespan',
    c.edges(600).length === 2 && c.edges(600).every(e => e.fade === 1) && c.stats().structural === 2);
  // The walk has decided B, but the rows are still sounding A while their programs recompile.
  c.ingest(c.admit([under(A, at(4, 601))], B), 601);
  check('until a note of the new harmony sounds, old-harmony notes keep extending the figure',
    edgeKeys(c.edges(601)) === '1-2,2-3,3-4' && c.stats().structural === 3);
  // The first B note lands at 602.
  c.ingest(c.admit([under(B, at(5, 602))], B), 602);
  check('the first note of the new harmony flushes the figure and seeds the next one, drawing no line',
    c.stats().structural === 0 && c.stats().vertices === 0 && c.tip === 5 &&
    c.edges(602).length === 3 && c.edges(602).every(e => e.to !== 5));
  check('the old figure fades from THAT note\'s time, over `fade`, then really leaves the collections', (() => {
    const F = CONSTELLATION_DEFAULTS.fade;
    const half = c.edges(602 + F / 2);
    return half.length === 3 && half.every(e => Math.abs(e.fade - 0.5) < 1e-9) &&
      c.edges(602 + F).length === 0 && c.stats().edges === 0;
  })());
  c.ingest(c.admit([under(A, at(6, 603))], B), 603);
  check('a straggler still sounding the OLD harmony draws nothing and does not move the tip',
    c.tip === 5 && c.stats().edges === 0);
  c.ingest(c.admit([under(B, at(1, 604))], B), 604);
  check('a grid from the flushed figure is free to join the new one',
    edgeKeys(c.edges(604)) === '5-1' && c.tip === 1);
}
{
  // A coincident group straddling the change: admit must flush BEFORE chaining, so the chain is ordered
  // against the post-flush figure (no tip → seed at the lowest grid) and the old-harmony member is dropped.
  const c = createConstellation();
  c.ingest(c.admit([under('A', at(1, 0)), under('A', at(2, 0))], 'A'), 0);
  const points = new Map([[1, [0, 0, 0]], [2, [1, 0, 0]], [7, [50, 0, 0]], [8, [60, 0, 0]], [9, [55, 0, 0]]]);
  const group = c.admit([under('B', at(9, 1)), under('A', at(8, 1)), under('B', at(7, 1))], 'B');
  check('a mixed group admits only the new harmony\'s members', group.map(a => a.id).join(',') === '9,7');
  c.ingest(chainCoincidentAttacks(group, c.tip, g => points.get(g) || null, g => c.inFigure(g)), 1);
  check('and chains them against the flushed figure, not the old tip',
    edgeKeys(c.edges(1)) === '1-2,7-9' && c.stats().structural === 1 && c.stats().ghosts === 1 && c.tip === 9,
    `got ${edgeKeys(c.edges(1))}, tip ${c.tip}`);
}
{
  const c = createConstellation();
  c.ingest(c.admit([at(1, 0), at(2, 0)], 'A'), 0);
  check('an untagged attack always belongs to the figure (fixtures and pre-tag programs keep working)',
    c.stats().structural === 1 && c.admit([at(3, 1)], 'B').length === 1 && c.stats().structural === 1);
  check('no harmony information this frame is a pass-through that never flushes',
    c.admit([under('Z', at(4, 2))], '').length === 1 && c.admit([under('Z', at(4, 2))], null).length === 1 &&
    c.stats().structural === 1);
}
{
  const c = createConstellation(LIFESPAN);
  c.ingest(c.admit([under('A', at(1, 0)), under('A', at(2, 0))], 'A'), 0);
  const passed = c.admit([under('B', at(3, 0.5)), under('A', at(4, 0.5))], 'B');
  check('under lifespan, admit is a pure pass-through (no flush, no filtering)',
    passed.length === 2 && c.stats().structural === 1);
  c.ingest(passed, 0.5);
  c.configure({ lifecycle: 'chord' });
  c.ingest(c.admit([under('B', at(5, 1))], 'B'), 1);
  check('switching back to chord mid-harmony continues the figure instead of flushing it',
    c.stats().structural === 4 && c.tip === 5);
  c.configure({ lifecycle: 'no-such-policy' });
  check('configure ignores an unknown lifecycle name', c.options.lifecycle === 'chord');
}
{
  // Rapid chord changes: every flush turns the whole figure into ghosts at once. The live collections must
  // stay bounded however fast the harmony turns over.
  const c = createConstellation();
  let maxEdges = 0, maxGhosts = 0;
  for (let step = 0; step < 6000; step++) {
    const now = step / 100, key = `h${Math.floor(step / 7)}`;   // a new harmony every 70ms: absurdly fast
    c.ingest(c.admit([under(key, at(1 + (step * 7) % 20, now))], key), now);
    c.retain(null, now);
    c.edges(now);
    maxEdges = Math.max(maxEdges, c.stats().edges); maxGhosts = Math.max(maxGhosts, c.stats().ghosts);
  }
  check('flush ghosts stay under the ceiling at any rate of chord change',
    maxEdges <= 20 + 64 && maxGhosts <= 64, `max edges ${maxEdges}, max ghosts ${maxGhosts}`);
}
{
  // Rule 6 is keyed on the LOADED field now, so one long chord spent flying can join far more than the
  // ~20 row stars. Past the draw-cost ceiling the OLDEST structural edge fades out; nothing else changes.
  const N = CONSTELLATION_FIGURE_CEILING, c = createConstellation();
  for (let g = 1; g <= N + 1; g++) c.ingest(c.admit([under('A', at(g, g / 10))], 'A'), g / 10);
  check('a figure the size of the ceiling is kept whole', c.stats().structural === N && c.stats().ghosts === 0);
  c.ingest(c.admit([under('A', at(N + 2, 99))], 'A'), 99);
  const ghost = c.edges(99).find(e => e.fade === 1 && e.from === 1 && e.to === 2);
  check('one more join departs exactly the oldest edge (1–2), leaving the ceiling intact',
    c.stats().structural === N && c.stats().ghosts === 1 && !!ghost && c.edges(99 + CONSTELLATION_DEFAULTS.fade + 0.01).every(e => !(e.from === 1 && e.to === 2)));
  c.ingest(c.admit([under('B', at(9999, 100))], 'B'), 100);
  check('a chord change flushes even a ceiling-sized figure as ghosts — none culled, all fading together',
    c.stats().structural === 0 && c.stats().ghosts === N && c.edges(100 + CONSTELLATION_DEFAULTS.fade / 2).length === N);
}

console.log('\n  Boundedness and birth rate');
{
  // Edges ≤ vertices − 1 by construction: a grid can only take an edge while it is NOT in the figure, so
  // every birth adds exactly one new vertex. The structure is a forest — there is nothing to cap.
  const STARS = 20, T = CONSTELLATION_DEFAULTS.lifespan;
  const c = createConstellation(LIFESPAN);
  const field = new Set();
  for (let i = 1; i <= STARS; i++) field.add(i);
  let seed = 1337;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const births = new Set();
  let maxEdges = 0, maxVertices = 0, invariantHeld = true;
  // 120 seconds at 120 attacks/second: far denser than 20 stars can actually sound, on purpose.
  for (let step = 0; step < 14400; step++) {
    const now = step / 120;
    const group = [];
    for (let k = 0; k < 3; k++) group.push(at(1 + Math.floor(rand() * STARS), now));
    c.ingest(group, now);
    if (rand() < 0.01) {   // the field churns: a star drops out and comes back
      const live = new Set(field);
      live.delete(1 + Math.floor(rand() * STARS));
      c.retain(live, now);
    } else c.retain(field, now);
    for (const e of c.edges(now)) births.add(`${e.from}-${e.to}@${e.bornAt}`);
    const s = c.stats();
    maxEdges = Math.max(maxEdges, s.edges); maxVertices = Math.max(maxVertices, s.vertices);
    if (!(s.structural === 0 ? s.vertices === 0 : s.structural <= s.vertices - 1)) invariantHeld = false;
  }
  check('edges ≤ vertices − 1 held at every step of a long randomised run', invariantHeld);
  check('the live collections stayed bounded (real sizes, not a filtered view)',
    maxVertices <= STARS && maxEdges <= STARS + 64, `max edges ${maxEdges}, max vertices ${maxVertices}`);
  // Self-rate-limiting: a connected grid cannot take a new edge, so births are capped at about one per
  // grid per lifespan however dense the music. 120s / 3s × 20 stars ≈ 800, plus slack for field churn.
  const ceiling = (120 / T) * STARS * 1.35;
  check('edge births are bounded by roughly stars / lifespan per second, not by attack density',
    births.size <= ceiling, `${births.size} births vs ceiling ${Math.round(ceiling)} (${14400 * 3} attacks fed)`);
  c.reset();
  check('reset empties every collection so nothing survives a Cosmos teardown',
    c.stats().edges === 0 && c.stats().vertices === 0 && c.tip === null && c.edges(999).length === 0);
}

console.log('\n  Rule 5 chaining (pure helper, flight-view supplies the positions)');
{
  // A known point set. Tip at grid 1. Nearest to 1 is 2, nearest to 2 is 3, nearest to 3 is 4.
  const points = new Map([[1, [0, 0, 0]], [2, [10, 0, 0]], [3, [10, 10, 0]], [4, [10, 10, 10]], [5, [500, 0, 0]]]);
  const positionOf = g => points.get(g) || null;
  const group = [at(4, 1), at(5, 1), at(3, 1), at(2, 1)];
  const chained = chainCoincidentAttacks(group, 1, positionOf, () => false);
  check('a coincident group chains nearest-to-the-tip, then nearest-to-that, through the whole group',
    chained.map(a => a.id).join(',') === '2,3,4,5', `got ${chained.map(a => a.id).join(',')}`);
  check('members already in the figure are emitted but never move the head', (() => {
    // 3 is already connected: it must not become the head, so after 2 the walk continues from 2, whose
    // nearest remaining is 3 (emitted, head stays 2), then 4 — the head only ever moves to new grids.
    const out = chainCoincidentAttacks(group, 1, positionOf, g => g === 3);
    return out.map(a => a.id).join(',') === '2,3,4,5';
  })());
  check('with no tip the group seeds at its LOWEST grid number', (() => {
    const out = chainCoincidentAttacks([at(7, 1), at(3, 1), at(9, 1)], null,
      g => ({ 3: [0, 0, 0], 7: [1, 0, 0], 9: [2, 0, 0] })[g], () => false);
    return out.map(a => a.id).join(',') === '3,7,9';
  })());
  check('exact distance ties break by the lower grid number', (() => {
    const tie = new Map([[1, [0, 0, 0]], [6, [5, 0, 0]], [4, [-5, 0, 0]], [9, [0, 5, 0]]]);
    const out = chainCoincidentAttacks([at(9, 1), at(6, 1), at(4, 1)], 1, g => tie.get(g) || null, () => false);
    return out[0].id === 4;   // all three are 5 away from the tip; the lowest grid number wins
  })());
  check('an unplaced member ranks last and is still emitted', (() => {
    const out = chainCoincidentAttacks([at(8, 1), at(2, 1)], 1, g => (g === 8 ? null : points.get(g)), () => false);
    return out.map(a => a.id).join(',') === '2,8';
  })());
  check('the order is camera-independent: translating AND rotating the whole field changes nothing', (() => {
    // camera-relative positions shift by a constant when the player flies and rotate when they turn;
    // pairwise distances — and therefore the chain — must be invariant under both.
    const a = Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
    const moved = g => { const p = points.get(g); if (!p) return null;
      const x = p[0] * ca - p[2] * sa, z = p[0] * sa + p[2] * ca;   // yaw
      return [x + 9999, p[1] - 4242, z + 17]; };
    return chainCoincidentAttacks(group, 1, moved, () => false).map(x => x.id).join(',') === chained.map(x => x.id).join(',');
  })());
  check('a single-member group is passed straight through', chainCoincidentAttacks([at(3, 1)], 1, positionOf, () => false).length === 1);
  check('the chained order fed to the core produces exactly that chain of edges', (() => {
    const c = createConstellation();
    c.ingest([at(1, 0)], 0);
    c.ingest(chainCoincidentAttacks(group, c.tip, positionOf, g => c.inFigure(g)), 1);
    return edgeKeys(c.edges(1)) === '1-2,2-3,3-4,4-5';
  })());
}

console.log('\n  Renderer: camera-plane clipping and the additive pass');
{
  // Recording mock 2D context. shadowBlur is deliberately NOT predefined, so a write would show up as a
  // new own property — the work order forbids it (it is the most expensive way to glow on Canvas 2D).
  const makeCtx = () => {
    const rec = { strokes: [], points: [], gradients: 0, widths: [], globalCompositeOperation: 'source-over', globalAlpha: 1, lineCap: 'butt', strokeStyle: null, lineWidth: 1 };
    rec.createLinearGradient = () => { rec.gradients++; return { addColorStop() {} }; };
    rec.beginPath = () => {};
    rec.moveTo = (x, y) => rec.points.push([x, y]);
    rec.lineTo = (x, y) => rec.points.push([x, y]);
    rec.stroke = () => { rec.strokes.push(rec.globalAlpha); rec.widths.push(rec.lineWidth); };
    return rec;
  };
  const basis = { r: [1, 0, 0], u: [0, 1, 0], d: [0, 0, 1] };   // identity: view space === world-relative
  // The renderer projects through a view-frame.js frame; a first-person frame (eye at the ship) is exactly the
  // bare basis/focal/cx/cy/near contract these checks were written against.
  const frame = createViewFrame({ basis, focal: 800, cx: 400, cy: 300, near: 5 });
  const view = (points, extra = {}) => ({
    positionOf: g => points.get(g) || null,
    frame, fogAt: () => 1, detuneCents: 0, now: 10, drawIn: 0.1, ...extra,
  });
  const edge = (extra = {}) => ({ from: 1, to: 2, fromHz: 220, toHz: 330, bornAt: 0, fade: 1, ...extra });

  const bothFront = makeCtx();
  drawGridRowConstellation(bothFront, [edge()], view(new Map([[1, [0, 0, 100]], [2, [100, 0, 100]]])));
  check('an edge with both ends in front draws two strokes (wide faint under narrow bright)',
    bothFront.strokes.length === 2 && bothFront.widths[0] > bothFront.widths[1] && bothFront.gradients === 2);
  check('the projected endpoints are the expected screen positions',
    bothFront.points[0][0] === 400 && bothFront.points[1][0] === 1200);

  const behind = makeCtx();
  drawGridRowConstellation(behind, [edge()], view(new Map([[1, [0, 0, -400]], [2, [100, 0, 100]]])));
  check('one end behind the near plane is CLIPPED at the plane, not dropped',
    behind.strokes.length === 2 && behind.points.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  check('the clipped end runs off toward the note behind the player rather than collapsing onto it', (() => {
    // clipped at z ≈ 5.05 with x interpolated there: |x·focal/z| is enormous, i.e. far off-screen.
    const [a, b] = behind.points;
    return Math.abs(a[0] - 400) > 2000 && Math.abs(b[0] - 400) < 2000;
  })());

  const bothBehind = makeCtx();
  drawGridRowConstellation(bothBehind, [edge()], view(new Map([[1, [0, 0, -400]], [2, [10, 0, -100]]])));
  check('both ends behind the near plane draws nothing at all', bothBehind.strokes.length === 0 && bothBehind.gradients === 0);

  const missing = makeCtx();
  drawGridRowConstellation(missing, [edge()], view(new Map([[1, [0, 0, 100]]])));
  check('an end with no position this frame draws nothing', missing.strokes.length === 0);

  const restored = makeCtx();
  restored.globalCompositeOperation = 'source-over'; restored.globalAlpha = 0.42;
  drawGridRowConstellation(restored, [edge()], view(new Map([[1, [0, 0, 100]], [2, [100, 0, 100]]])));
  check('the additive pass restores composite mode and alpha for the star loop that follows',
    restored.globalCompositeOperation === 'source-over' && restored.globalAlpha === 0.42);
  check('nothing in the renderer ever touches shadowBlur', !('shadowBlur' in restored));

  const unborn = makeCtx();
  drawGridRowConstellation(unborn, [edge({ bornAt: 10 })], view(new Map([[1, [0, 0, 100]], [2, [100, 0, 100]]])));
  check('a line is never pre-drawn: at the instant of its attack it has zero length', unborn.strokes.length === 0);

  const growing = makeCtx();
  drawGridRowConstellation(growing, [edge({ bornAt: 9.95 })], view(new Map([[1, [0, 0, 100]], [2, [100, 0, 100]]])));
  check('mid draw-in the stroke reaches part way from the tip toward the new grid, ease-out',
    growing.points[0][0] === 400 && Math.abs(growing.points[1][0] - 1000) < 1e-9, `got ${growing.points[1] && growing.points[1][0]}`);
  const grown = makeCtx();
  drawGridRowConstellation(grown, [edge({ bornAt: 9.8 })], view(new Map([[1, [0, 0, 100]], [2, [100, 0, 100]]])));
  check('after drawIn the stroke has reached the new grid exactly', grown.points[1][0] === 1200);

  const faded = makeCtx();
  drawGridRowConstellation(faded, [edge({ fade: 0.5 })], view(new Map([[1, [0, 0, 100]], [2, [100, 0, 100]]]), { fogAt: () => 0.4 }));
  check('alpha is min endpoint fog × lifecycle fade', Math.abs(faded.strokes[0] - 0.2) < 1e-9, `got ${faded.strokes[0]}`);

  // Chase view: the eye pulls back and up, and fog reads each endpoint's distance from the SHIP — the same
  // sphere-of-light law the stars use — including an endpoint clipped at the eye's near plane.
  const chaseFrame = createViewFrame({ basis, eye: [0, 400, -1200], focal: 800, cx: 400, cy: 300, near: 5, fog: 1 });
  const depths = [];
  const recordFog = depth => { depths.push(depth); return 1; };
  drawGridRowConstellation(makeCtx(), [edge()], view(new Map([[1, [30, 0, 40]], [2, [0, 0, -3000]]]), { frame: chaseFrame, fogAt: recordFog }));
  check('chase fog reads each endpoint\'s UNCLIPPED ship distance (50 and 3000), not its eye depth',
    depths.length === 2 && Math.abs(depths[0] - 50) < 1e-9 && Math.abs(depths[1] - 3000) < 1e-9, `got ${depths}`);
  const firstDepths = [];
  drawGridRowConstellation(makeCtx(), [edge()], view(new Map([[1, [0, 0, 100]], [2, [0, 0, -400]]]), { fogAt: d => { firstDepths.push(d); return 1; } }));
  check('first-person fog still reads the CLIPPED view depth, exactly as before the view frame',
    firstDepths.length === 2 && firstDepths[0] === 100 && firstDepths[1] === 5 * 1.01, `got ${firstDepths}`);

  check('lines and orbs share one pitch→colour law, so a modulation drifts them together',
    typeof pitchHue === 'function' && pitchHue(440, 0) === pitchHue(220, 0) && pitchHue(220, 1200) === pitchHue(220, 0));
}

console.log('\n  Composition (the wiring flight-view performs, end to end)');
{
  // The real feed method, the real chaining helper, the real core and the real renderer — only the
  // AudioContext, the positions and the canvas are mocks. This is the one place the per-frame contract
  // (read once → group coincidences → chain → ingest → retain → draw) is exercised as a whole.
  const player = Object.create(SpatialGridRowPlayer.prototype);
  player.ctx = { currentTime: 0 };
  const star = (id, attacks) => [id, { id, active: true, visualAttacks: attacks, visualLives: [] }];
  player.stars = new Map([
    star(10, [{ when: 1, frequencyHz: 220, harmonyKey: 'A' }]),
    star(20, [{ when: 1.05, frequencyHz: 330, harmonyKey: 'A' }]),   // coincident with 30, but six times farther from the tip
    star(30, [{ when: 1.05, frequencyHz: 440, harmonyKey: 'A' }]),
  ]);
  const placed = new Map([[10, [0, 0, 100]], [20, [300, 0, 100]], [30, [50, 0, 100]]]);
  const core = createConstellation();
  let cursor = null, harmony = 'A';
  const field = new Set([10, 20, 30]);
  const frame = (clock, live = field) => {
    player.ctx.currentTime = clock;
    const feed = player.reachedAttacks(cursor);
    const gap = cursor === null ? Infinity : feed.now - cursor;
    const positionOf = grid => placed.get(grid) || null;
    if (gap >= 0 && gap < 0.7 && feed.attacks.length) {
      for (let i = 0; i < feed.attacks.length;) {
        let j = i + 1;
        while (j < feed.attacks.length && feed.attacks[j].when === feed.attacks[i].when) j++;
        const group = core.admit(feed.attacks.slice(i, j), harmony);
        core.ingest(group.length < 2 ? group : chainCoincidentAttacks(group, core.tip, positionOf, g => core.inFigure(g)), feed.now);
        i = j;
      }
    }
    cursor = feed.now;
    core.retain(live, feed.now);
    return core.edges(feed.now);
  };
  frame(0.9);
  check('the first frame primes the cursor without ingesting the retained backlog', core.tip === null && cursor === 0.9);
  frame(1.02);
  check('the first reached attack seeds the tip on the frame it is reached', core.tip === 10);
  const chained = frame(1.08);
  check('a coincident pair chains nearest-to-the-tip first, by 3D world distance',
    edgeKeys(chained) === '10-30,30-20', `got ${edgeKeys(chained)}`);
  check('the feed carries each attack\'s harmony key through to the core',
    player.reachedAttacks(0).attacks.every(a => a.harmonyKey === 'A'));
  const split = frame(1.12, new Set([10, 20]));   // 30 drops out of the row field
  check('a mid-chain departure splits the figure in the live wiring, with no bridge 10–20',
    core.stats().structural === 0 && !split.some(e => (e.from === 10 && e.to === 20) || (e.from === 20 && e.to === 10)));
  check('no attack is ingested twice across frames (the cursor carries `now` forward)', (() => {
    const before = core.stats();
    frame(1.14); frame(1.16);
    return core.stats().structural === before.structural && core.tip === 20;
  })());
  check('a frame gap longer than the player\'s attack retention re-primes instead of dumping a backlog', (() => {
    const tipBefore = core.tip;
    const after = frame(5.0);   // a long stall: the missed attacks are gone, and none arrive late
    return core.tip === tipBefore && after.length === 0 && cursor === 5.0;
  })());
  // A chord change in the live wiring: rebuild a figure under A, then the walk moves to B. An A note that
  // was already scheduled still extends the figure; the first B note flushes it on its own beat.
  core.reset(); cursor = null; harmony = 'A';
  player.stars.get(10).visualAttacks = [{ when: 6.0, frequencyHz: 220, harmonyKey: 'A' }];
  player.stars.get(20).visualAttacks = [{ when: 6.1, frequencyHz: 330, harmonyKey: 'A' }, { when: 6.4, frequencyHz: 330, harmonyKey: 'B' }];
  player.stars.get(30).visualAttacks = [{ when: 6.3, frequencyHz: 440, harmonyKey: 'A' }];
  frame(5.9); frame(6.15);
  harmony = 'B';
  const held = frame(6.35);
  check('after the walk moves on, notes still sounding the old chord keep drawing its figure',
    edgeKeys(held) === '10-20,20-30' && held.every(e => e.fade === 1));
  const flushed = frame(6.45);
  check('the first new-chord note flushes the figure in the live wiring and seeds the next',
    core.stats().structural === 0 && core.tip === 20 && flushed.length === 2 && flushed.every(e => e.fade < 1));
}

console.log(PASS ? '\n✓ COSMOS NOTE CONSTELLATIONS OK\n' : '\n✗ COSMOS NOTE CONSTELLATIONS FAILED\n');
process.exit(PASS ? 0 : 1);
