// assert-compose-dust.mjs — Cosmos's onset dust and the compose choreography (Compose mode E2, 2026-10-22 night), in Node:
//   • the inputs: the trace from both workers, a rhythm's onsets sampled in its worker (the spec unchanged), both
//     taken off the spec before it plays and handed to 'composed'
//   • the scene: deterministic; every voice, key and grain is a real onset of the spec's row (or the superrow's node)
//   • per-frame counts within the tier caps (motes, glows, flashes, lines, arcs, filaments), flashes stressed
//   • the phases run forward and land exactly on the performance layout
//   • a booked note flashes its own voice when the audio clock reaches `when`, where the hand is
//   • the veil: swells while composing, rises to full, follows the 'level' events; stop dissolves and clears all
//   • under a full veil the hidden layers are skipped (source checks on flight-view.js); idle draws nothing
//   • the painter: batched (no gradient per mote, sprites baked once), DPR-aware; dustView's orb → canvas
//   • the per-frame JS cost on a large superrow scene (printed)
//   node Cosmos/tests/assert-compose-dust.mjs
import { readFileSync } from 'node:fs';
import {
  buildDustScene, frameAt, moteAt, createDustDirector, dustCaps, dustNodeDim, voiceForNote, toneRadius, centsOfRatio,
  DUST_TIER_MAX, DUST_POOL_MAX, GLOW_CAP, FLASH_CAP, FILAMENT_CAP, LINE_CAP, ARC_CAP, BLOOM_OUT_SECONDS, SELECTION_SECONDS,
  DISSOLVE_SECONDS, VEIL_RISE_SECONDS, COMPOSING_VEIL, VEIL_FULL, OCTAVE_DEPTH,
} from '../engine/compose-choreo.js';
import { createDustRenderer, dustView, GLOW_BUCKETS } from '../ui/compose-dust.js';
import { createComposeMode } from '../engine/cosmos-compose.js';
import { bookingEvents } from '../audio/cosmos-composer-player.js';
import { QUALITY_ORDER, QUALITY_TIERS } from '../engine/cosmos-quality.js';
import { answer as answerRhythm, sampleRowDust } from '../../Composer/core/compose-worker.js';
import { answerSuperrow } from '../../Composer/core/superrow-worker.js';
import { buildRow } from '../../Composer/core/row.js';
import { cycleSecondsForTempo, flattenLayers } from '../../Composer/core/superrow.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const TAU = Math.PI * 2, mod = (v, n) => ((v % n) + n) % n;
const gcd = (a, b) => (b ? gcd(b, a % b) : a), lcm = (a, b) => (a / gcd(a, b)) * b;
const tick = () => new Promise((r) => setTimeout(r, 0));
/** a bloom's rhythms as grid-core.js streams them: 2–4 distinct divisors whose lcm is G (assert-superrow.mjs') */
function bloomOf(G, { maxLayers = 4, maxRhythms = Infinity } = {}) {
  const divs = []; for (let d = 2; d < G; d++) if (G % d === 0) divs.push(d);
  const out = [];
  const walk = (start, chosen) => {
    if (out.length >= maxRhythms) return;
    if (chosen.length >= 2 && chosen.reduce(lcm, 1) === G) out.push([...chosen].sort((a, b) => b - a));
    if (chosen.length === maxLayers) return;
    for (let i = start; i < divs.length; i++) { chosen.push(divs[i]); walk(i + 1, chosen); chosen.pop(); }
  };
  walk(0, []);
  return out;
}
/** a frame's motes, copied (the buffers are the scene's own) */
const motes = (f) => Array.from({ length: f.n }, (_, j) => moteAt(f, j));
const plainFrame = (f) => JSON.stringify({ ...f, x: [...f.x.slice(0, f.n)], y: [...f.y.slice(0, f.n)], z: [...f.z.slice(0, f.n)], size: [...f.size.slice(0, f.n)], alpha: [...f.alpha.slice(0, f.n)], hue: [...f.hue.slice(0, f.n)], glow: [...f.glow.slice(0, f.n)], id: [...f.id.slice(0, f.n)], paths: f.paths.map((p) => ({ ...p, pts: [...p.pts] })) });

/** a Rhythm compose the way Cosmos asks for it: the trace and the sampled dust, in the worker */
function rhythmCompose(layers, { dust = DUST_POOL_MAX } = {}) {
  const row = buildRow(layers), T = cycleSecondsForTempo(row.n);
  const r = answerRhythm({ id: 1, layers, cycleSeconds: T, options: { seed: 1, trace: true, dust } });
  const { trace, dust: d, ...spec } = r.spec;
  return { row, T, reply: r, trace, spec, composed: { target: { kind: 'rhythm', grid: row.grid, key: layers.join('.'), layers }, dust: r.dust } };
}
/** a Grid compose: the superrow worker's answer */
function gridCompose(G, rhythms, budget = 65536) {
  const m = answerSuperrow({ id: 2, grid: G, layersFlat: flattenLayers(rhythms), budget, options: { seed: 1, trace: true } }).message;
  const { trace, ...spec } = m.spec;
  return { m, trace, spec, composed: { target: { kind: 'grid', grid: G }, superrow: { ...m.superrow, keys: rhythms.map((l) => l.join('.')), pis: rhythms.map((_, i) => i) }, window: m.window } };
}

console.log('═══ COSMOS COMPOSE DUST — assertions ═══');

console.log('\n  The inputs: the trace and the dust');
{
  const layers = [8, 7, 6, 5], T = cycleSecondsForTempo(22);
  const plain = answerRhythm({ id: 1, layers, cycleSeconds: T, options: { seed: 1 } }).spec;
  const withDust = answerRhythm({ id: 1, layers, cycleSeconds: T, options: { seed: 1, trace: true, dust: 10 } });
  const { trace, ...rest } = withDust.spec;
  check('compose-worker: options.dust adds `dust`, and the spec (its trace off) is the same as without', JSON.stringify(rest) === JSON.stringify(plain) && !!trace && !!withDust.dust && !('dust' in withDust.spec));
  const row = buildRow([41, 42, 43]), d = sampleRowDust(row, 100);
  let real = d.index.length === 100 && d.n === row.n;
  for (let j = 0; j < d.index.length; j++) { const i = d.index[j]; real = real && d.tick[j] === row.tick[i] && near(d.cents[j], row.toneCents[row.tone[i]], 1e-3) && (j === 0 || i > d.index[j - 1]); }
  check(`sampleRowDust: 100 of ${row.n} onsets, evenly in row order, each its row's own tick and tone`, real && d.index[99] > row.n * 0.95);
  check('…all of them when the row is smaller', sampleRowDust(buildRow([8, 7, 6, 5]), 1e4).index.length === 22);

  // the mode asks for them and takes them off the spec before it plays
  const calls = [], performed = [], composedEvents = [];
  let job;
  const composer = { rhythm: (l, t, o) => { calls.push(o); return new Promise((res) => { job = res; }); }, superrow: (p) => { calls.push(p.options); return new Promise((res) => { job = res; }); }, cancel() {} };
  const performer = { perform: (s) => { performed.push(s); return true; }, stop: () => true, setLevel() {}, startedAt: 3 };
  const mode = createComposeMode({ composer, performer, trace: true, dust: 500, gather: () => ({ ready: true, progress: {}, snapshot: () => ({ rhythms: [[8, 7, 6, 5]], dist: null, keys: ['a'], pis: [7] }) }) });
  mode.on('composed', (e) => composedEvents.push(e));
  mode.press({ kind: 'rhythm', grid: 840, key: 'k', layers });
  job({ ...withDust.spec, dust: withDust.dust }); await tick();
  check('cosmos-compose: a Rhythm compose asks for the trace and the dust', calls[0].trace === true && calls[0].dust === 500 && calls[0].seed === 1);
  check('…the player gets the plain spec (no trace, no dust)', performed[0] && !('trace' in performed[0]) && !('dust' in performed[0]) && JSON.stringify(performed[0]) === JSON.stringify(plain));
  check('…\'composed\' carries them apart', composedEvents[0].trace === trace && composedEvents[0].dust === withDust.dust && composedEvents[0].spec === performed[0]);
  mode.stop('test');
  mode.press({ kind: 'grid', grid: 840 }); mode.frame({});
  check('…a Grid compose asks the superrow worker for the trace (no dust: the superrow is its own pool)', calls[1].trace === true && !('dust' in calls[1]));
  job({ ok: true, spec: withDust.spec, window: { visible: 1, fitted: 1, picked: [0] }, superrow: { grid: 840, n: 22 } }); await tick();
  check('…and its superrow carries the snapshot\'s lattice indices (the dust\'s origins)', composedEvents[1].superrow.pis[0] === 7 && composedEvents[1].superrow.keys[0] === 'a');
  const off = []; const m2 = createComposeMode({ composer: { ...composer, rhythm: (l, t, o) => { off.push(o); return Promise.resolve(plain); } }, performer: { ...performer, perform: (s) => { off.push(s); return true; } } });
  m2.press({ kind: 'rhythm', grid: 840, key: 'k', layers }); await tick();
  check('…off (the default): no trace asked, and the very spec object is played (E1 as it was)', !('trace' in off[0]) && !('dust' in off[0]) && off[1] === plain);
}

console.log('\n  The scene: a Rhythm card (8:7:6:5 and the 4,099-onset 41:42:43:…)');
const caps = (id) => dustCaps(QUALITY_TIERS[id]);
const R1 = rhythmCompose([8, 7, 6, 5]);
const R2 = rhythmCompose([1031, 1033, 1039, 1049]);
{
  check(`tier caps: dustMax ${QUALITY_ORDER.map((id) => QUALITY_TIERS[id].dustMax).join(' / ')} = the proposed 1.5k / 3k / 6k / 10k`, QUALITY_ORDER.every((id) => QUALITY_TIERS[id].dustMax === DUST_TIER_MAX[id]) && dustCaps(null).motes === 3000);
  for (const R of [R1, R2]) {
    const a = buildDustScene({ trace: R.trace, spec: R.spec, composed: R.composed, caps: caps('high') });
    const b = buildDustScene({ trace: R.trace, spec: R.spec, composed: R.composed, caps: caps('high') });
    const ts = [0, 0.3, 0.9, 1.4, 2.2, 3.1, 3.85, 4.5, 9];
    check(`${R.row.n} onsets: deterministic — two builds give identical frames at ${ts.length} times`, ts.every((t) => plainFrame(frameAt(a, t, { audioNow: 50, startedAt: 49 })) === plainFrame(frameAt(b, t, { audioNow: 50, startedAt: 49 }))));
    const { row } = R, [g0, g1] = a.ranges.grains, [k0, k1] = a.ranges.keys, [v0, v1] = a.ranges.voices;
    let bad = [];
    for (let i = v0; i < v1; i++) {
      const vo = a.voices[i - v0], node = vo.node;
      if (vo.part === 'drums') { if (!(node >= 0 && row.tick[node] === vo.tick)) bad.push(`drum ${i}`); continue; }
      if (!(row.tick[node] === a.tickOf[i] && near(a.centsOf[i], row.toneCents[row.tone[node]], 1e-3))) bad.push(`voice ${i}`);
    }
    for (let i = k0; i < k1; i++) { const node = a.nodeOfMote[i]; if (!(row.tick[node] === a.tickOf[i] && near(a.centsOf[i], row.toneCents[row.tone[node]], 1e-3))) bad.push(`key ${i}`); }
    for (let i = g0; i < g1; i++) { const node = a.nodeOfMote[i]; if (!(row.tick[node] === a.tickOf[i] && near(a.centsOf[i], row.toneCents[row.tone[node]], 1e-3))) bad.push(`grain ${i}`); }
    check(`every mote is a real onset of the row: ${a.counts.voices} voices, ${a.counts.keys} keys, ${a.counts.grains} grains of a pool of ${a.counts.pool}`, !bad.length && a.counts.voices > 0 && a.counts.keys > 0, bad.slice(0, 4).join(', '));
    // the angle is the onset's place in the cycle from the downbeat, the radius its tone
    const f = frameAt(a, a.performAt + 0.001, {}), M = motes(f).filter((m) => m.id >= v0 && a.voices[m.id - v0].part !== 'drums');
    const placed = M.every((m) => { const vo = a.voices[m.id - v0], ang = mod(Math.atan2(m.x, m.y), TAU), want = TAU * mod(vo.tick / a.grid - a.phaseFrac, 1); return near(Math.min(Math.abs(ang - want), TAU - Math.abs(ang - want)), 0, 1e-4) && near(Math.hypot(m.x, m.y), toneRadius(vo.cents), 1e-5) && m.z === Math.max(-3, Math.min(2, vo.octave)); });
    check('…placed by the music: angle = its time in the cycle (12 o\'clock the downbeat), radius = its tone, z = its octave', placed && M.length === a.counts.voices - (a.voicesByPart.drums || []).length);
  }
}

console.log('\n  The scene: a Grid card (a superrow of grid 840\'s rhythms)');
const G840 = bloomOf(840);
const GR = gridCompose(840, G840.slice(0, 1200));
{
  const sr = GR.m.superrow, a = buildDustScene({ trace: GR.trace, spec: GR.spec, composed: GR.composed, caps: caps('ultra') });
  const [g0, g1] = a.ranges.grains, [k0, k1] = a.ranges.keys, [v0, v1] = a.ranges.voices;
  let bad = [];
  const at = (i, node) => sr.tick[node] === a.tickOf[i] && near(a.centsOf[i], sr.toneCents[sr.tone[node]], 1e-3);
  for (let i = v0; i < v1; i++) { const vo = a.voices[i - v0]; if (vo.part === 'drums' ? !(vo.node >= 0 && sr.tick[vo.node] === vo.tick) : !at(i, vo.node)) bad.push(`voice ${i}`); }
  for (let i = k0; i < k1; i++) if (!at(i, a.nodeOfMote[i])) bad.push(`key ${i}`);
  // a grain is a source onset: its rhythm's own row strikes at that tick with that tone
  const rows = new Map(), rowOf = (r) => rows.get(r) ?? rows.set(r, buildRow(G840[r])).get(r);
  let grainsReal = true;
  for (let i = g0; i < g1; i += 37) {
    const node = a.nodeOfMote[i]; if (!at(i, node)) { grainsReal = false; break; }
    const members = []; for (let j = sr.sources.start[node]; j < sr.sources.start[node + 1]; j++) members.push([sr.sources.rhythm[j], sr.sources.onset[j]]);
    grainsReal = grainsReal && members.some(([r, o]) => { const row = rowOf(r); return row.tick[o] === a.tickOf[i] && near(row.toneCents[row.tone[o]], a.centsOf[i], 1e-3); });
  }
  check(`every voice and key is a superrow node (${a.counts.voices} voices, ${a.counts.keys} keys)`, !bad.length, bad.slice(0, 4).join(', '));
  check(`…every grain sampled is a source onset of an admitted rhythm (${a.counts.grains} of a pool of ${a.counts.pool.toLocaleString('en-US')})`, grainsReal && a.counts.pool === sr.sources.rhythm.length);
  // evenly over the pool: a node gets grains in proportion to the source onsets merged into it (its rhythms striking there)
  const per = new Map(); for (let i = g0; i < g1; i++) per.set(a.nodeOfMote[i], (per.get(a.nodeOfMote[i]) || 0) + 1);
  const busiest = [...per.entries()].sort((x, y) => y[1] - x[1])[0], share = (sr.sources.start[busiest[0] + 1] - sr.sources.start[busiest[0]]) / sr.sources.rhythm.length;
  check(`…the pool sampled evenly: ${per.size} of ${sr.n} nodes have dust, the busiest (${busiest[1]} grains) in proportion to its ${(share * 100).toFixed(1)} % of the pool`, per.size > sr.n * 0.5 && near(busiest[1] / (g1 - g0), share, 0.002));
}

console.log('\n  Caps a frame, every tier (flashes stressed: every note booked at once)');
{
  for (const id of QUALITY_ORDER) {
    const c = caps(id), worst = { n: 0, glows: 0, lines: 0, arcs: 0, paths: 0, flashes: 0 };
    for (const [name, C] of [['8:7:6:5', R1], ['4k row', R2], ['superrow', GR]]) {
      const s = buildDustScene({ trace: C.trace, spec: C.spec, composed: C.composed, caps: c });
      const flashes = []; for (let v = 0; v < s.counts.voices; v++) flashes.push({ voice: v, when: 10, dur: 0.6 });
      for (let t = 0; t < s.performAt + 1; t += 0.03) {
        const f = frameAt(s, t, { audioNow: 10.05, startedAt: 9, flashes });
        for (const k of ['n', 'glows', 'flashes']) worst[k] = Math.max(worst[k], f[k]);
        worst.lines = Math.max(worst.lines, f.lines.length); worst.arcs = Math.max(worst.arcs, f.arcs.length); worst.paths = Math.max(worst.paths, f.paths.length);
      }
      if (name === 'superrow') check(`${id}: the superrow scene fills its cap (${s.counts.motes} motes)`, s.counts.motes === c.motes);
    }
    check(`${id}: at most ${worst.n} motes ≤ ${c.motes}, ${worst.glows} glows ≤ ${GLOW_CAP}, ${worst.flashes} flashes ≤ ${FLASH_CAP}, ${worst.lines} lines ≤ ${LINE_CAP}, ${worst.arcs} arcs ≤ ${ARC_CAP}, ${worst.paths} filaments ≤ ${FILAMENT_CAP}`,
      worst.n <= c.motes && worst.glows <= GLOW_CAP && worst.flashes <= FLASH_CAP && worst.lines <= LINE_CAP && worst.arcs <= ARC_CAP && worst.paths <= FILAMENT_CAP && worst.flashes > 0);
  }
}

console.log('\n  The phases run forward and land exactly on the performance layout');
for (const [name, C, tier] of [['8:7:6:5', R1, 'low'], ['4k row', R2, 'medium'], ['superrow', GR, 'high']]) {
  const s = buildDustScene({ trace: C.trace, spec: C.spec, composed: C.composed, caps: caps(tier) });
  const order = { bloom: 0, select: 1, perform: 2 };
  let forward = true, prevP = 0, prevStep = -1, kinds = [];
  for (let t = 0; t <= s.performAt + 0.5; t += 0.01) {
    const f = frameAt(s, t, {});
    if (order[f.phase] < prevP) forward = false;
    if (f.phase === 'select') { if (f.step < prevStep) forward = false; prevStep = f.step; if (kinds.at(-1) !== f.kind) kinds.push(f.kind); }
    prevP = order[f.phase];
  }
  check(`${name}: bloom-out ${BLOOM_OUT_SECONDS} s → selection ${s.select} s (= ${SELECTION_SECONDS}) → performance, never back; steps in order (${kinds.length} beats seen)`, forward && near(s.select, SELECTION_SECONDS, 1e-6) && ['root', 'chord', 'part', 'drums'].every((k) => kinds.includes(k)));
  const [v0, v1] = s.ranges.voices, cs = Math.cos(s.turn), sn = Math.sin(s.turn);
  const layout = (i) => [s.homeX[i] * cs - s.homeY[i] * sn, s.homeY[i] * cs + s.homeX[i] * sn, s.homeZ[i]];
  const posOf = (f) => { const m = new Map(); for (let j = 0; j < f.n; j++) m.set(f.id[j], [f.x[j], f.y[j], f.z[j]]); return m; };
  const last = posOf(frameAt(s, s.performAt - 1e-4, {})), first = posOf(frameAt(s, s.performAt, {}));
  let exact = true, all = true;
  for (let i = v0; i < v1; i++) {
    const L = layout(i), a = last.get(i), b = first.get(i);
    if (!a || !b) { all = false; continue; }
    const f32 = (x) => Math.fround(x);
    if (!(a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && b[0] === f32(L[0]) && b[1] === f32(L[1]) && b[2] === f32(L[2]))) exact = false;
  }
  check(`${name}: every voice is on the face at the selection's last instant, exactly where the performance has it (${v1 - v0} voices)`, exact && all);
  const p0 = frameAt(s, 0.001, {});
  check(`${name}: the bloom-out starts at the source (no voice yet, the dust at its origin)`, p0.phase === 'bloom' && motes(p0).every((m) => m.id < v0));
}

console.log('\n  A booked note flashes its own voice at `when`, where the hand is');
{
  const C = R1, D = createDustDirector({ caps: () => caps('medium') });
  D.composed({ ...C.composed, spec: C.spec, trace: C.trace }, 100);
  D.perform({ startedAt: 200 });
  const s = D.scene, events = bookingEvents(C.spec), lead = events.find((e) => e.part === 'lead'), drum = events.find((e) => e.kind === 'drum');
  const book = (e) => D.note({ ...e, cycle: 0, when: 200 + e.time });
  const v = book(lead), vd = book(drum);
  check('the note and the stroke map to their voices (bookingEvents → voiceForNote)', v >= 0 && vd >= 0 && voiceForNote(s, lead) === v && s.voices[v].tick === lead.tick && s.voices[vd].part === 'drums');
  const wall = 100 + s.performAt + 0.5, when = 200 + lead.time, id = s.ranges.voices[0] + v;
  const find = (f) => motes(f).find((m) => m.id === id);
  const before = find(D.frame(wall, when - 0.01).frame), on = find(D.frame(wall, when).frame), after = find(D.frame(wall, when + 0.7).frame);
  check('…dark until the audio clock reaches when, lit at when (a glow, full alpha, bigger), back after the flash', !before.glow && on.glow === 1 && on.alpha >= 0.99 && on.size > before.size * 2 && !after.glow && near(after.alpha, before.alpha, 1e-6));
  const fOn = D.frame(wall, when).frame, ang = mod(Math.atan2(on.x, on.y), TAU);
  check(`…and the hand is on it: the mote at ${(ang / TAU).toFixed(4)} of the cycle, the hand at ${(fOn.hand / TAU).toFixed(4)}`, near(Math.min(Math.abs(ang - fOn.hand), TAU - Math.abs(ang - fOn.hand)), 0, 1e-4));
  const dm = s.ranges.voices[0] + vd, dOn = motes(D.frame(wall, 200 + drum.time + 0.01).frame).find((m) => m.id === dm);
  check('…a drum stroke flashes its mote on the drum ring', dOn && dOn.glow === 1 && Math.hypot(dOn.x, dOn.y) >= 0.99);
  const D2 = createDustDirector({ caps: () => caps('medium') });
  D2.composed({ ...C.composed, spec: C.spec, trace: C.trace }, 0); D2.perform({ startedAt: 10 });
  const vv = D2.note({ ...lead, cycle: 0, when: 10.4 }), early = motes(D2.frame(0.5, 10.45).frame).find((m) => m.id === D2.scene.ranges.voices[0] + vv);
  check('…during the selection (audio already playing) a note still flashes where its voice sits', early && early.glow === 1 && early.hue === D2.scene.hue[D2.scene.ranges.voices[0] + vv]);
  check('a note of no voice (another spec\'s) is ignored', D.note({ kind: 'note', part: 'lead', node: 99999, when: 1 }) === -1);
}

console.log('\n  The veil, the level and the dissolve');
{
  const C = R1, D = createDustDirector({ caps: () => caps('medium') });
  check('idle: no frame at all', !D.active && D.frame(0, 0) === null);
  D.composing({ target: C.composed.target }, 0);
  const c0 = D.frame(0, null), c1 = D.frame(VEIL_RISE_SECONDS, null);
  check(`composing: the orb swells to ${COMPOSING_VEIL}, no dust yet`, c0.veil === 0 && near(c1.veil, COMPOSING_VEIL) && c1.frame === null && !c1.full);
  D.composed({ ...C.composed, spec: C.spec, trace: C.trace }, 1);
  const r0 = D.frame(1, null), r1 = D.frame(1 + VEIL_RISE_SECONDS, null);
  check('composed: from there up to full over the rise, and full means cull', near(r0.veil, COMPOSING_VEIL) && r1.veil === 1 && r1.full && VEIL_FULL < 1);
  const full = D.frame(1 + s5(), 0).frame, fullAlpha = motes(full).reduce((x, m) => x + m.alpha, 0);
  D.level({ level: 0.4 });
  const lv = D.frame(1 + s5(), 0);
  check('a \'level\' event of 0.4: the veil is 0.4 and the dust fades with it', near(lv.veil, 0.4) && !lv.full && near(motes(lv.frame).reduce((x, m) => x + m.alpha, 0), fullAlpha * 0.4, fullAlpha * 0.02));
  D.level({ level: 0 }); const l0 = D.frame(1 + s5(), 0);
  D.level({ level: 1 }); const l1 = D.frame(1 + s5(), 0);
  check('…0 clears the veil (and the dust), 1 brings both back (the hysteresis is E1\'s)', l0.veil === 0 && l0.frame.n === 0 && l1.veil === 1 && l1.frame.n > 0);
  check('dustNodeDim: a full veil hides every bloom node; at 0.5 the chosen rhythm fades slower than the rest', dustNodeDim(l1, 840, 'x') === 0 && (() => { const d = { ...l1, veil: 0.5, grid: 840, chosen: new Set(['k']) }; return dustNodeDim(d, 840, 'k') > dustNodeDim(d, 840, 'other') && near(dustNodeDim(d, 7, 'k'), 0.5) && dustNodeDim(null, 840, 'k') === 1; })());
  D.stop({ reason: 'escape' }, 10);
  const h = D.frame(10 + DISSOLVE_SECONDS / 2, 0), g = D.frame(10 + DISSOLVE_SECONDS, 0);
  check(`stop: the dust and the veil dissolve over ${DISSOLVE_SECONDS} s, then everything is cleared`, near(h.veil, 0.5) && h.phase === 'dissolve' && h.frame.n > 0 && g === null && !D.active && D.frame(11, 0) === null);
  const D3 = createDustDirector(); D3.composing({ target: C.composed.target }, 0); D3.stop({ reason: 'cancel' }, 1);
  check('a cancel while composing dissolves the swell and clears', near(D3.frame(1, null).veil, COMPOSING_VEIL) && D3.frame(1 + DISSOLVE_SECONDS, null) === null);
  const D4 = createDustDirector(); D4.composed({ ...C.composed, spec: C.spec, trace: C.trace }, 0);
  check('click / Esc in the selection skips to the performance (and only then)', D4.skippable(1) && D4.skip(1) && D4.frame(1, null).phase === 'perform' && !D4.skippable(1.1) && !D4.skip(1.1));
  function s5() { return D.scene.performAt + 5; }
}

console.log('\n  flight-view.js: the wiring, the cull under a full veil, idle untouched (source)');
{
  const fv = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
  const has = (re) => re.test(fv);
  check('the Compose mode asks for the trace and the dust', has(/trace: true, dust: DUST_POOL_MAX/));
  check('every Compose event feeds the director (composing, composed with origins, perform, note, level, stop, refused)', ['composing', 'composed', 'perform', 'note', 'level', 'stop', 'refused'].every((t) => fv.includes(`composeMode.on('${t}', e => composeDust.`)) && fv.includes('origins: dustOrigins(e)'));
  check('idle: no director frame, and no dust draw without one', has(/const dust = composeDust\.active \? composeDust\.frame\(now \/ 1000, dustAudioNow\(\)\) : null;/) && has(/if \(dust && dust\.frame\) \{[\s\S]{0,400}?dustRenderer\.draw\(ctx, dust\.frame/));
  const culled = [
    ['the walls', /if \(!dustFull\) drawHilbertBoundaryWalls\(renderView\);/],
    ['the Web frame', /if \(!dustFull\) webRenderer\?\.frame\(\{/],
    ['the connectors', /if \(placement !== 'hilbert' && !dustFull\)/],
    ['the constellations', /if \(constellation\.options\.enabled && !dustFull\)/],
    ['the ships', /if \(!dustFull\) drawAgents\(renderView\);/],
    ['the stars (draw and pick)', /const order = dustFull \? \[\] : \[\.\.\.proj\.values\(\)\]\.sort/],
    ['the blots', /for \(const bl of dustFull \? \[\] : blots\)/],
    ['the bloom clouds (draw and pick)', /for \(const g of dustFull \? \[\] : bloomed\)/],
  ];
  for (const [what, re] of culled) check(`under a full veil: ${what} skipped`, has(re));
  check('the veil is the larger of the orb\'s and the dust\'s', has(/const veilA = dust \? Math\.max\(veil, dust\.veil\) : veil;/) && has(/if \(veilA > 0\) \{ ctx\.globalAlpha = veilA;/));
  check('the bloom nodes give way (dustNodeDim × alpha, skipped at 0)', has(/const dim = dust \? dustNodeDim\(dust, g, p\.key\) : 1; if \(dim <= 0\.004\) continue;/));
  check('a click skips the selection, and under a full veil does nothing (never closes the card)', has(/if \(composeDust\.skippable\(performance\.now\(\) \/ 1000\)\) \{ composeDust\.skip\(performance\.now\(\) \/ 1000\); return; \}[^\n]*\n\s+if \(dustCovering\) return;/));
  check('Esc: a ride first, then the selection skip, then the composition and the card', has(/if \(returnRide\) cancelWebReturn\(\); else if \(composeDust\.skippable\(performance\.now\(\) \/ 1000\)\) composeDust\.skip\(performance\.now\(\) \/ 1000\); else if \(!closeCardOnEscape\(\)\)/));
  check('leaving Cosmos clears the dust', has(/composeDust\.clear\(\); dustRenderer\.reset\(\);/));
}

console.log('\n  The painter');
function stubCtx() {
  const log = { calls: 0, fills: 0, strokes: 0, images: 0, gradients: 0, rects: 0, arcs: 0 };
  return { log, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    fill() { log.calls++; log.fills++; }, stroke() { log.calls++; log.strokes++; }, drawImage() { log.calls++; log.images++; },
    createRadialGradient() { log.gradients++; return { addColorStop() {} }; }, fillRect() { log.calls++; }, beginPath() { log.calls++; }, arc() { log.calls++; } };
}
function stubPath(log) { return () => ({ rect() { log.rects++; }, arc() { log.arcs++; }, moveTo() {}, lineTo() {} }); }
{
  const ctx = stubCtx(), spriteLog = { gradients: 0, made: 0 };
  const makeCanvas = (w, h) => { spriteLog.made++; return { width: w, height: h, getContext: () => ({ createRadialGradient() { spriteLog.gradients++; return { addColorStop() {} }; }, fillRect() {}, globalAlpha: 1, fillStyle: '' }) }; };
  const R = createDustRenderer({ makePath: stubPath(ctx.log), makeCanvas });
  check('idle: draw(ctx, null) makes no canvas call', R.draw(ctx, null, dustView({ W: 800, H: 600 })).calls === 0 && ctx.log.calls === 0);
  const s = buildDustScene({ trace: GR.trace, spec: GR.spec, composed: GR.composed, caps: caps('ultra') });
  const flashes = []; for (let v = 0; v < 60; v++) flashes.push({ voice: v, when: 10, dur: 0.6 });
  const f = frameAt(s, s.performAt + 1, { audioNow: 10.05, startedAt: 9, flashes });
  const view = dustView({ W: 1200, H: 800, veil: 1, dpr: 2 });
  const st = R.draw(ctx, f, view);
  check(`a 10k-mote frame: ${st.motes} motes in ${st.buckets} batched fills, ${st.glows} glow sprites, ${st.strokes} strokes = ${st.calls} canvas calls`, st.motes === f.n && st.calls === st.buckets + st.glows + st.strokes && st.buckets < 200 && st.glows === f.glows && ctx.log.calls === st.calls);
  check('no gradient on the flight canvas; sprites baked once each (a gradient apiece), none more on the next frame', ctx.log.gradients === 0 && spriteLog.gradients === spriteLog.made && (() => { const n0 = spriteLog.made; R.draw(ctx, f, view); return spriteLog.made === n0 && n0 > 0; })());
  check('DPR-aware: the sprites are baked at 2× for a 2× backing store', R.sprites > 0 && spriteLog.made === R.baked);
  const tiny = { n: 1, x: Float32Array.of(0), y: Float32Array.of(0), z: Float32Array.of(0), size: Float32Array.of(0.05), alpha: Float32Array.of(1), hue: Uint8Array.of(0), glow: Uint8Array.of(0), lines: [], arcs: [], paths: [] };
  let side = null; R.draw({ ...stubCtx() }, tiny, { ...view, dpr: 2 });
  const R2r = createDustRenderer({ makePath: () => ({ rect(x, y, w) { side = w; }, arc() {}, moveTo() {}, lineTo() {} }), makeCanvas });
  R2r.draw(stubCtx(), tiny, dustView({ W: 800, H: 600, veil: 1, dpr: 2 }));
  check(`…and a mote is never under one device pixel (side ${side} CSS px at DPR 2)`, side >= 0.5);
  const v0 = dustView({ W: 1000, H: 800, centre: { x: 200, y: 150 }, radius: 90, veil: 0 }), v1 = dustView({ W: 1000, H: 800, centre: { x: 200, y: 150 }, radius: 90, veil: 1 });
  check('dustView: at veil 0 the face is the bloom\'s own disc; at veil 1 the canvas (the orb become the canvas)', v0.cx === 200 && v0.cy === 150 && v0.R === 90 && v1.cx === 500 && v1.cy === 400 && near(v1.R, 0.42 * 800) && v0.sizeScale < 1);
  check('the z scale: a lead an octave up sits outside its tone ring, a bass two down inside', 1 / (1 - OCTAVE_DEPTH) > 1 && 1 / (1 + 2 * OCTAVE_DEPTH) < 1 && GLOW_BUCKETS.length > 0);
}

console.log('\n  The per-frame JS cost on a large superrow scene (Node, this machine)');
{
  const big = bloomOf(27720, { maxRhythms: 6000 });
  const t0 = performance.now(), C = gridCompose(27720, big, 262144), tBuild = performance.now() - t0;
  const t1 = performance.now(), s = buildDustScene({ trace: C.trace, spec: C.spec, composed: C.composed, caps: caps('ultra') }), tScene = performance.now() - t1;
  const flashes = []; for (let v = 0; v < Math.min(96, s.counts.voices); v++) flashes.push({ voice: v, when: 10, dur: 0.6 });
  const per = {};
  for (const [phase, t] of [['bloom', 0.5], ['select', BLOOM_OUT_SECONDS + 1.5], ['perform', s.performAt + 2]]) {
    for (let k = 0; k < 20; k++) frameAt(s, t, { audioNow: 10.1, startedAt: 9, flashes });
    const a = performance.now(); for (let k = 0; k < 200; k++) frameAt(s, t, { audioNow: 10.1, startedAt: 9, flashes }); per[phase] = (performance.now() - a) / 200;
  }
  const ctx = stubCtx(), R = createDustRenderer({ makePath: stubPath(ctx.log), makeCanvas: (w, h) => ({ width: w, height: h, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }) });
  const f = frameAt(s, s.performAt + 2, { audioNow: 10.1, startedAt: 9, flashes }), view = dustView({ W: 1400, H: 900, veil: 1, dpr: 2 });
  for (let k = 0; k < 20; k++) R.draw(ctx, f, view);
  const b = performance.now(); for (let k = 0; k < 200; k++) R.draw(ctx, f, view); const tDraw = (performance.now() - b) / 200;
  console.log(`    grid 27,720: ${C.m.window.fitted} rhythms → ${C.m.superrow.n.toLocaleString('en-US')} nodes, a pool of ${s.counts.pool.toLocaleString('en-US')} source onsets (worker job ${tBuild.toFixed(0)} ms, Node)`);
  console.log(`    scene (Ultra, ${s.counts.motes} motes: ${s.counts.voices} voices, ${s.counts.keys} keys, ${s.counts.grains} grains) built in ${tScene.toFixed(1)} ms`);
  console.log(`    frameAt: bloom ${per.bloom.toFixed(3)} ms · selection ${per.select.toFixed(3)} ms · performance ${per.perform.toFixed(3)} ms a frame`);
  console.log(`    the painter's JS (stub canvas: the batching, not the raster): ${tDraw.toFixed(3)} ms a frame`);
  check(`the choreography stays under 2 ms a frame at Ultra's 10,000 motes (worst ${Math.max(...Object.values(per)).toFixed(3)} ms)`, Math.max(...Object.values(per)) < 2 && s.counts.motes === 10000);
}

console.log(`\n${PASS ? '✓✓✓ COMPOSE DUST PASSES' : '✗ COMPOSE DUST FAILED'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
