// assert-superrow.mjs — Composer/core/superrow.js (Cosmos's Grid-card Compose, 2026-10-22 night): many rhythms of one
// grid on one tone row, and compose()'s prebuilt-row entry.
//   • one rhythm's superrow IS its row, field for field, and composes to the identical spec (drums included)
//   • the duplicate rule: one node per distinct (tick, tone); strikes summed, saturated at 255 (or the log2 rule)
//   • the window: Θ nodes and the source budget respected; a rhythm over the gate or the budget alone skipped; the
//     near-focus order kept; a rhythm that does not fit passed over for a later one that does; the whole grid fits
//     when Θ allows; the work cap bounds what is examined
//   • the barometer's counts and text; node → source members; the tempo cycle lands the meter on 110 BPM
//   • superrow-worker.js' answer, run in Node
//   node Composer/tests/assert-superrow.mjs
import { buildRow, onsetCount, ONSET_GATE } from '../core/row.js';
import { compose } from '../core/compose.js';
import { buildSuperrow, barometer, cycleSecondsForTempo, orderByDistance, membersOf, flattenLayers, unflattenLayers, DEFAULT_BUDGET } from '../core/superrow.js';
import { answerSuperrow } from '../core/superrow-worker.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const gcd = (a, b) => (b ? gcd(b, a % b) : a), lcm = (a, b) => (a / gcd(a, b)) * b;
const ROW_FIELDS = ['version', 'layers', 'active', 'grid', 'n', 'longest', 'tick', 'x', 'gap', 'tone', 'octave', 'owners', 'strikes', 'tones', 'toneCents', 'toneCount', 'toneFirst', 'toneLabels'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const arr = (v) => (ArrayBuffer.isView(v) ? [...v] : v);

/** a bloom's rhythms the way grid-core.js streams them: 2–4 distinct divisors (descending) whose lcm is G */
function bloomOf(G, { maxLayers = 4, maxRhythms = Infinity } = {}) {
  const divs = []; for (let d = 2; d < G; d++) if (G % d === 0) divs.push(d);
  const out = [];   // small divisors first (8:7:6:5-like rhythms, not near-uniform ones), each rhythm descending
  const walk = (start, chosen) => {
    if (out.length >= maxRhythms) return;
    if (chosen.length >= 2 && chosen.reduce(lcm, 1) === G) out.push([...chosen].sort((a, b) => b - a));
    if (chosen.length === maxLayers) return;
    for (let i = start; i < divs.length; i++) { chosen.push(divs[i]); walk(i + 1, chosen); chosen.pop(); }
  };
  walk(0, []);
  return out;
}

console.log('Composer superrow');

console.log('\n— one rhythm: its superrow is its row, and composes identically');
for (const layers of [[8, 7, 6, 5], [11, 9, 7, 5], [119, 42, 15, 8], [19, 17, 16, 15], [33, 32], [5, 4, 3], [41, 42, 43]]) {
  const row = buildRow(layers), sr = buildSuperrow([layers]).row;
  const diff = ROW_FIELDS.find((f) => !same(arr(row[f]), arr(sr[f])));
  check(`${layers.join(':')}: every row field equal (${row.n} onsets, ${row.tones.length} tones)`, !diff, diff);
  const a = compose(layers, 8, { seed: 3 }), b = compose(sr.layers, 8, { seed: 3, row: sr });
  check(`${layers.join(':')}: compose(layers) and compose(…, { row: superrow }) give the identical spec${a.refused ? ` (both refused: ${a.reason})` : ''}`, same(a, b) && (a.refused || !!a.drums));
}
{
  const layers = [12, 10, 8, 7], sr = buildSuperrow([layers]).row;
  const a = compose(layers, 12, { seed: 7, worker: true }), b = compose(sr.layers, 12, { seed: 7, worker: true, row: sr });
  check('the full table (in a worker) too', same(a, b) && a.knobs.table === 'full');
}
check('a refusal handed in as the row refuses as buildRow\'s would', compose([1], 8, { row: { tooDense: true, onsets: 2e6, gate: ONSET_GATE } }).reason === 'tooDense');
check('no row option: compose is unchanged (the 8:7:6:5 spec as before)', same(compose([8, 7, 6, 5], 8, { seed: 2 }), compose([8, 7, 6, 5], 8, { seed: 2, row: null })));

console.log('\n— the duplicate rule and strikes');
{
  const A = [8, 7, 6, 5], B = [8, 7, 5, 3];   // G = 840: A's and B's onsets share ticks, not always tones
  const ra = buildRow(A), rb = buildRow(B), s = buildSuperrow([A, B]);
  const pairs = new Set();
  for (const r of [ra, rb]) for (let i = 0; i < r.n; i++) pairs.add(`${r.tick[i]}|${r.tones[r.tone[i]]}`);
  const sr = s.row;
  const got = new Set(); for (let i = 0; i < sr.n; i++) got.add(`${sr.tick[i]}|${sr.tones[sr.tone[i]]}`);
  check(`one node per distinct (tick, tone): ${sr.n} nodes from ${ra.n + rb.n} onsets`, sr.n === pairs.size && same([...pairs].sort(), [...got].sort()) && sr.n < ra.n + rb.n);
  let ordered = true; for (let i = 1; i < sr.n; i++) if (sr.tick[i] < sr.tick[i - 1] || (sr.tick[i] === sr.tick[i - 1] && sr.tone[i] <= sr.tone[i - 1])) ordered = false;
  check('nodes in tick order, then by tone (cents)', ordered);
  // the summed strikes at a shared (tick, tone)
  let sumOk = true;
  for (let i = 0; i < sr.n; i++) {
    let expect = 0;
    for (const r of [ra, rb]) for (let j = 0; j < r.n; j++) if (r.tick[j] === sr.tick[i] && r.tones[r.tone[j]] === sr.tones[sr.tone[i]]) expect += r.strikes[j];
    if (sr.strikes[i] !== expect) sumOk = false;
  }
  check('strikes: the merged layer strikes summed', sumOk);
  const sharedTickTwoTones = (() => { for (let i = 1; i < sr.n; i++) if (sr.tick[i] === sr.tick[i - 1]) return true; return false; })();
  check('a tick two rhythms strike with different tones keeps both', sharedTickTwoTones);
  const many = Array.from({ length: 100 }, () => [8, 7, 6, 5]), sm = buildSuperrow(many).row;
  check('100 copies of 8:7:6:5 merge to its own 22 nodes, tick 0 saturated at 255 (100 × 4 strikes)', sm.n === buildRow([8, 7, 6, 5]).n && sm.strikes[0] === 255 && sm.strikes[1] === 100);
  const lg = buildSuperrow(many, { strikes: 'log2' }).row;
  check('the log2 rule: 1 + ⌊log2 sum⌋ (400 → 9, 100 → 7)', lg.strikes[0] === 9 && lg.strikes[1] === 7);
  check('the pulses: the ≤ 4 commonest layer values (8, 7, 5 twice; then 6, met before 3), owners where each strikes', same(s.row.layers, [8, 7, 5, 6]) && s.row.active.join() === '0,1,2,3' &&
    [...Array(sr.n).keys()].every((i) => sr.owners[i] === [8, 7, 5, 6].reduce((m, v, b) => m | (sr.tick[i] % (840 / v) === 0 ? 1 << b : 0), 0)));
}

console.log('\n— the window');
{
  const G = 360, rhythms = bloomOf(G);
  const total = rhythms.reduce((s, l) => s + onsetCount(l), 0);
  const whole = buildSuperrow(rhythms, { grid: G });
  check(`grid 360: ${rhythms.length} rhythms, ${total} source onsets → ${whole.row.n} nodes, the whole grid under Θ = ${DEFAULT_BUDGET}`, whole.window.whole && whole.window.fitted === rhythms.length && whole.row.n < total);
  const dist = rhythms.map((l, i) => Math.abs(i - 40) + (i % 3) * 0.1), order = orderByDistance(dist);
  check('the near-focus order: nearest first, ties by index', order[0] === 40 && order.every((r, k) => k === 0 || dist[order[k - 1]] < dist[r] || (dist[order[k - 1]] === dist[r] && order[k - 1] < r)));
  for (const budget of [64, 150, 300]) {
    const w = buildSuperrow(rhythms, { grid: G, order, budget });
    check(`Θ = ${budget}: ${w.window.fitted} of ${rhythms.length} fit, ${w.window.nodes} nodes ≤ Θ, picked in the focus order`, w.window.nodes <= budget && w.row.n === w.window.nodes && !w.window.whole &&
      w.window.picked.every((r, k) => k === 0 || order.indexOf(w.window.picked[k - 1]) < order.indexOf(r)) && w.window.picked[0] === order.find((r) => onsetCount(rhythms[r]) <= budget));
  }
  const b = 150, w = buildSuperrow(rhythms, { grid: G, order, budget: b });
  const passedOver = order.findIndex((r) => !w.window.picked.includes(r));
  check('a rhythm that does not fit the room left is passed over for a later one that does', passedOver >= 0 && w.window.picked.some((r) => order.indexOf(r) > passedOver) && w.window.skipped.room > 0);
  // overlap counts: admission is by NEW (tick, tone) pairs, not by the rhythm's own onset count
  const big = buildSuperrow(Array.from({ length: 50 }, () => [8, 7, 6, 5]), { budget: 30 });
  check('a rhythm whose onsets are all already nodes takes no room (50 copies of 22 onsets fit in Θ = 30)', big.window.fitted === 50 && big.row.n === 22);
  const src = buildSuperrow(rhythms, { grid: G, order, sourceBudget: 500 });
  check(`the source budget: Σ admitted onsets ${src.window.sourceOnsets} ≤ 500`, src.window.sourceOnsets <= 500 && src.window.skipped.source > 0);
  const gated = buildSuperrow([[8, 7, 6, 5], [3000, 2999], [6, 5, 4]], { gate: 1000 });
  check('a rhythm over the Composer\'s gate by itself is skipped and counted (3000:2999, gate 1,000)', gated.window.skipped.alone === 1 && gated.window.fitted === 1 + 0 && gated.window.skipped.offGrid === 1);
  const overBudget = buildSuperrow([[30, 29], [8, 7, 6, 5]], { budget: 40 });
  check('a rhythm over the budget by itself is skipped (30:29 has 58 onsets, Θ = 40)', overBudget.window.skipped.budget === 1 && overBudget.window.fitted === 1);
  check('a rhythm the row cannot read (five layers) is unsupported, not fatal', buildSuperrow([[12, 6, 4, 3, 2], [12, 4, 3]]).window.skipped.unsupported === 1);
  const capped = buildSuperrow(rhythms, { grid: G, order, workCap: 400 });
  check('the work cap: past it, rhythms are unreached', capped.window.skipped.unreached > 0 && capped.window.fitted < rhythms.length);
  check('nothing fits: no row, the window says why', buildSuperrow([[3000, 2999]], { budget: 100 }).row === null);

  console.log('\n— the barometer');
  const bw = barometer(buildSuperrow(rhythms, { grid: G, order, budget: 150 }).window);
  check(`fitted of visible: "${bw.text}"`, bw.visible === rhythms.length && bw.fitted < bw.visible && Math.abs(bw.share - bw.fitted / bw.visible) < 1e-12 && bw.text.startsWith(`${bw.fitted.toLocaleString('en-US')} of ${rhythms.length.toLocaleString('en-US')} rhythms (`));
  const bwhole = barometer(whole.window);
  check(`the whole grid says so: "${bwhole.text}"`, bwhole.whole && bwhole.text === `the whole grid · ${rhythms.length.toLocaleString('en-US')} rhythms`);
  const bskip = barometer(buildSuperrow([[8, 7, 6, 5], [8, 7, 6, 5], [3000, 2999]], { gate: 1000, grid: 840 }).window);
  check(`skips over the gate alone are named: "${bskip.text}"`, bskip.tooDenseAlone === 1 && /1 too dense to compose alone$/.test(bskip.text));

  console.log('\n— sources');
  const s2 = buildSuperrow(rhythms.slice(0, 30), { grid: G }), rows = rhythms.slice(0, 30).map((l) => buildRow(l));
  let membersOk = s2.sources.start[s2.row.n] === s2.window.sourceOnsets;
  for (let i = 0; i < s2.row.n && membersOk; i++) for (const { rhythm, onset } of membersOf(s2.sources, i)) {
    const r = rows[rhythm]; if (r.tick[onset] !== s2.row.tick[i] || r.tones[r.tone[onset]] !== s2.row.tones[s2.row.tone[i]]) membersOk = false;
  }
  check(`every node's members are onsets at its tick with its tone (${s2.window.sourceOnsets} members, ${s2.row.n} nodes)`, membersOk);
  check('flattened layers round-trip', same(unflattenLayers(flattenLayers(rhythms)), rhythms));
}

console.log('\n— the tempo cycle');
for (const layers of [[5, 4, 3], [8, 7, 6, 5], [41, 42, 43], [119, 42, 15, 8]]) {
  const n = onsetCount(layers), T = cycleSecondsForTempo(n), spec = compose(layers, T, { seed: 1 });
  check(`${layers.join(':')} (${n} onsets): ${T.toFixed(2)} s → ${spec.knobs.bars} bars at ${spec.knobs.tempoBpm.toFixed(1)} BPM`, Math.abs(spec.knobs.tempoBpm - 110) < 1e-9);
}
{
  const sr = buildSuperrow(bloomOf(840, { maxRhythms: 120 }), { grid: 840 }).row, T = cycleSecondsForTempo(sr.n);
  const spec = compose(sr.layers, T, { seed: 1, row: sr });
  check(`a superrow (grid 840, ${sr.n} nodes): 8 bars at 110 BPM in ${T.toFixed(2)} s; ${spec.parts.reduce((k, p) => k + p.notes.length, 0)} notes, drums arranged`, !spec.refused && spec.knobs.bars === 8 && Math.abs(spec.knobs.tempoBpm - 110) < 1e-9 && spec.drums && spec.drums.hits.length > 0);
  let onNodes = true; for (const p of spec.parts) for (const note of p.notes) if (note.node < 0 || note.node >= sr.n || note.tick !== sr.tick[note.node]) onNodes = false;
  check('every note is a superrow node, at its tick', onNodes);
  check('cycleSecondsForTempo(…, { bpm }) moves the tempo', Math.abs(compose([8, 7, 6, 5], cycleSecondsForTempo(26, { bpm: 100 }), {}).knobs.tempoBpm - 100) < 1e-9);
}

console.log('\n— superrow-worker.js, run in Node');
{
  const rhythms = bloomOf(840, { maxRhythms: 200 }), dist = Float64Array.from(rhythms, (_, i) => (i * 7919) % 200);
  const { message, transfer } = answerSuperrow({ id: 9, grid: 840, layersFlat: flattenLayers(rhythms), dist, budget: 2000 });
  check(`a composed superrow: ${message.window.fitted} of ${message.window.visible} rhythms, ${message.superrow?.n} nodes ≤ 2,000, 110 BPM`, message.ok && message.id === 9 && !message.spec.refused && message.superrow.n <= 2000 && Math.abs(message.spec.knobs.tempoBpm - 110) < 1e-9);
  check('its arrays go as transfers (tick, tone, toneCents, octave — E2\'s dust — and the three source arrays)', transfer.length === 7 && transfer.every((b) => b instanceof ArrayBuffer));
  check('…with each tone\'s cents and each node\'s octave, for the dust\'s clock face (E2)', message.superrow.toneCents.length === message.superrow.tones.length && message.superrow.octave.length === message.superrow.n);
  const traced = answerSuperrow({ id: 10, grid: 840, layersFlat: flattenLayers(rhythms), dist, budget: 2000, options: { trace: true } }).message;
  check('options.trace: the superrow\'s compose trace comes back in spec.trace, of the superrow\'s own row (E2)', traced.ok && traced.spec.trace?.grid === 840 && traced.spec.trace.onsets === traced.superrow.n && !message.spec.trace);
  check('nothing fits: refused "empty", the window reported', (() => { const r = answerSuperrow({ id: 1, layersFlat: flattenLayers([[3000, 2999]]), budget: 100 }).message; return r.ok && r.refused.reason === 'empty' && r.window.skipped.budget === 1; })());
  check('a bad message is ok: false, not a throw', answerSuperrow({ id: 2 }).message.ok === false);
}

console.log(`\n${PASS ? '✓ all' : '✗ some'} ${checks} superrow checks ${PASS ? 'pass' : 'FAILED'}`);
process.exit(PASS ? 0 : 1);
