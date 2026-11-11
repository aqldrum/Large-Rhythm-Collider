// assert-form.mjs — Song v0 (Composer/ARRANGEMENT_ORDER.md, phase A: A3): core/form.js' planSong, songPasses and
// energyOf, and drums.js' `fillBars`. The rules are written here from the order, not read from form.js:
//   • determinism by seed (and by a fresh copy of the loop: no state kept between calls), the record's shape (S1)
//   • every section within its kind (S4): the intro without the lead on at most the order's first ⌈L/2⌉ layers (Build–
//     drop's exactly one, the planner's ruling of 11-04) at the low or loop densities; a build's layers holding the
//     section before's; a peak or drop every part, layer and the high preset; a break no drums, every layer, the bass
//     off or Roots; home the loop; each a mask of S3's seven or the planner's eighth (every part but drums and bass)
//   • the neighbour rule (S5): into an intro or a build at most 2 changes (a layer, a part, a density rung), into a
//     peak, a drop, a break (the planner's ruling, 11-04) or home anything; where a boundary takes more, no candidate of
//     its kind (enumerated here) could take fewer
//   • the curve: the sections' Σ |E − target| within TIE_BAND a section of the best path over the candidates (brute force)
//   • home equal to the loop byte for byte, parts and drums; a part off plays `enabled: false`
//   • the layer filter touching only the drums, the comp and the inner, and exactly the notes M's layers strike
//   • the order (S6) against a brute force over the permutations; Build–drop slowest first
//   • the passes from the cycle at the seed tempo (S7); the JSON round trip (S1)
//   • a density arranged as the controller arranges it (reclave's density, the arps, the drums, the bass over them)
//   • fillBars (S8) on and off: unset, drums-baseline.mjs' hashes hold; set, bar k fills and k + 1 crashes; a song's
//     fill pass, its crash moved to the next section's downbeat, the drumless break's fill alone
//   • an edited song (phase C's plain data changes) plays as written; bad songs refused
//   • the cost on the 16,359-onset row (planSong ≤ 1.5 s); the per-row table for the order's log
//   node Composer/tests/assert-form.mjs
import { compose, rearticulate } from './compose-cycle.mjs';
import { materialsOf, reclave, applyRearrange } from '../core/rearrange.js';
import { arrangeDrums, beatsOf } from '../core/drums.js';
import { arrangeBass } from '../core/bass.js';
import { arrangeArp, lineOf } from '../core/arp.js';
import { planSong, songPasses, energyOf, boundaryChanges, TEMPLATES, SECTION_KINDS, SONG_VERSION, TIE_BAND } from '../core/form.js';
import { DRUM_BASELINE, DRUM_BASELINE_CASES, DRUM_BASELINE_VARIANTS, DRUM_BASELINE_SEED, caseName, sha } from './drums-baseline.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const EPS = 1e-9;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const throws = (f, re) => { try { f(); return false; } catch (e) { return !re || re.test(String(e.message)); } };
const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; };

console.log('═══ COMPOSER — Song v0 (ARRANGEMENT_ORDER.md, phase A) ═══');

// ── the order's words, written out ──
const PARTS = ['lead', 'chords', 'comp', 'bass', 'inner', 'drums'];
// S3's seven, and the planner's eighth (11-04): every part but the drums and the bass
const MASKS = [['chords'], ['chords', 'inner'], ['drums', 'bass'], ['drums', 'bass', 'chords'], PARTS.filter((x) => x !== 'lead'), PARTS.filter((x) => x !== 'drums'), ['lead', 'chords', 'comp', 'inner'], PARTS];
const LADDER = { bass: ['roots', 'sparse', 'moving', 'walking'], comp: ['sparse', 'sparse-med', 'medium', 'dense'], lead: ['line', 'arp'], inner: ['line', 'arp'] };
const DENS = ['bass', 'comp', 'lead', 'inner'];
const LIMIT = 2, FREE = ['peak', 'drop', 'break', 'home'];
const KINDS = { arch: ['intro', 'build', 'peak', 'break', 'peak', 'home'], 'build-drop': ['intro', 'build', 'build', 'drop', 'break', 'home'] };
// the planner's rulings (11-04): the peaks and drops at 1.08; Build–drop's intro one layer
const TARGETS = { arch: [0.3, 0.6, 1.08, 0.4, 1.08, 1], 'build-drop': [0.15, 0.35, 0.65, 1.08, 0.35, 1] };
const INTRO_LAYERS = { arch: null, 'build-drop': 1 };
const NAMES = { arch: ['Intro', 'Build', 'Peak 1', 'Break', 'Peak 2', 'Home'], 'build-drop': ['Intro', 'Build 1', 'Build 2', 'Drop', 'Break', 'Home'] };
const onOf = (ids) => Object.fromEntries(PARTS.map((id) => [id, ids.includes(id)]));
const maskKey = (on) => PARTS.filter((id) => on[id]).join(',');
const MASK_KEYS = new Set(MASKS.map((m) => maskKey(onOf(m))));

/** the loop's own densities, read as the order reads them */
function ownOf(loop) {
  const by = Object.fromEntries(loop.parts.map((p) => [p.id, p]));
  return { bass: by.bass.bass?.density ?? 'sparse', lock: by.bass.bass?.lock ?? 'free', comp: loop.clave?.read === 'frame' && loop.clave.compDensity ? loop.clave.compDensity.asked : null,
    lead: by.lead.arp ? 'arp' : 'line', inner: by.inner.arp ? 'arp' : 'line' };
}
const step = (k, v, by) => { const L = LADDER[k]; return L[Math.max(0, Math.min(L.length - 1, L.indexOf(v) + by))]; };
/** S3's presets: low one rung down (Arp → Line), high one rung up (Line stays) */
const presetOf = (own, p) => (p === 'loop' ? { bass: own.bass, comp: own.comp, lead: own.lead, inner: own.inner }
  : p === 'low' ? { bass: step('bass', own.bass, -1), comp: own.comp && step('comp', own.comp, -1), lead: 'line', inner: 'line' }
    : { bass: step('bass', own.bass, 1), comp: own.comp && step('comp', own.comp, 1), lead: own.lead, inner: own.inner });
const soundsOf = (loop) => ({ ...Object.fromEntries(loop.parts.map((p) => [p.id, !!p.enabled])), drums: !!loop.drums?.enabled });
/** a setting written for the parts a section sounds, only where it differs from the loop's */
const recordOf = (own, sounds, s, on) => Object.fromEntries(DENS.filter((k) => on[k] && sounds[k] && s[k] !== own[k]).map((k) => [k, s[k]]));
const resolve = (own, d) => ({ bass: own.bass, comp: own.comp, lead: own.lead, inner: own.inner, ...d });
/** a boundary's changes: each layer in or out, each part toggled, each rung of a density both sound */
function changes(own, a, b) {
  const sa = resolve(own, a.density), sb = resolve(own, b.density);
  let n = popcount((a.layers ^ b.layers) >>> 0);
  for (const id of PARTS) if (a.parts[id] !== b.parts[id]) n++;
  for (const k of DENS) if (a.parts[k] && b.parts[k]) n += Math.abs(LADDER[k].indexOf(sa[k] ?? null) - LADDER[k].indexOf(sb[k] ?? null));
  return n;
}
const prefix = (order, k) => order.slice(0, k).reduce((m, b) => m | (1 << b), 0);
/** S3–S4's candidates of a kind, enumerated here */
function candidates(C, kind, order, template) {
  const L = order.length, own = C.own, sounds = C.sounds, out = [], seen = new Set();
  const no = (id) => MASKS.filter((m) => !m.includes(id));
  const [masks, ks, presets] = kind === 'intro' ? [no('lead'), Array.from({ length: INTRO_LAYERS[template] ?? Math.ceil(L / 2) }, (_, i) => i + 1), ['low', 'loop']]
    : kind === 'build' ? [MASKS, Array.from({ length: L }, (_, i) => i + 1), ['low', 'loop', 'high']]
      : kind === 'peak' || kind === 'drop' ? [[PARTS], [L], ['high']] : kind === 'break' ? [no('drums'), [L], ['low', 'loop', 'high']] : [[PARTS], [L], ['loop']];
  for (const m of masks) for (const k of ks) for (const p of presets) {
    const on = onOf(m);
    let s = presetOf(own, p);
    if (kind === 'break' && on.bass) s = { ...s, bass: 'roots' };
    const sec = { kind, passes: 1, layers: prefix(order, k), parts: on, density: kind === 'home' ? {} : recordOf(own, sounds, s, on), fillBefore: false };
    const key = J([maskKey(on), sec.layers, sec.density]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...sec, energy: energyOf(sec, C.loop, C.m) });
  }
  return out;
}

// ── the loops: Compose's own on the probe's rows, and loops played as the controller arranges the window's choices ──
const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 4], [[16, 12, 9], 4], [[7, 5, 3, 2], 4], [[19, 17, 16, 15], 4], [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
const placed = (spec, part) => ({ ...spec, parts: spec.parts.map((p) => (p.id === part.id ? part : p)) });
/** the loop as the window plays it (perform/composer-controller.js settleState): the arps over the spec in Line, the
 *  lead first (an inner arp the harp), the drums at the entry's options, the bass over the drums as they play, then
 *  each part's on/off */
function played(L, T, { arps = [], bass = null, drumOptions = null, off = [], overrides = {} } = {}) {
  const spec = compose(L, T, { seed: 1, overrides }), m = materialsOf(spec), TT = spec.knobs.cycleSeconds;
  let line = spec;
  for (const id of arps) {
    let p = arrangeArp(line, m, id, { time: 1, picks: {}, legato: line.parts.find((x) => x.id === id).legato });
    if (id === 'inner') p = rearticulate(p, { sound: 'harp', cycleSeconds: TT });
    line = placed(line, p);
  }
  const drums = drumOptions ? arrangeDrums(line, drumOptions) : arrangeDrums(line, spec.drums.options);
  let out = { ...line, drums };
  if (bass || drumOptions || arps.length) out = placed(out, arrangeBass({ ...line, drums }, m, bass ?? { density: 'moving', lock: 'kick' }));
  for (const id of off) out = placed(out, rearticulate(out.parts.find((p) => p.id === id), { enabled: false, cycleSeconds: TT }));
  return { loop: out, m };
}
const LOOPS = [];
for (const [L, T] of ROWS) { const spec = compose(L, T, { seed: 1 }); LOOPS.push({ label: `${L.join(':')}`, L, T, loop: spec, m: materialsOf(spec), own: true }); }
LOOPS.push({ label: '119:42:15:8 · Arp lead and inner, bass Walking', L: [119, 42, 15, 8], T: 8, ...played([119, 42, 15, 8], 8, { arps: ['lead', 'inner'], bass: { density: 'walking', lock: 'kick' } }) });
LOOPS.push({ label: '8:7:6:5 · Arp inner, bass Roots, drums with', L: [8, 7, 6, 5], T: 4, ...played([8, 7, 6, 5], 4, { arps: ['inner'], bass: { density: 'roots', lock: 'kick' }, drumOptions: { mode: 'with' } }) });
LOOPS.push({ label: '768:784 · the lead off, Sparse · Clave', L: [768, 784], T: 8, ...played([768, 784], 8, { bass: { density: 'sparse', lock: 'clave' }, off: ['lead'] }) });
LOOPS.push({ label: '11:9:7:5 · comp in notes (no tier)', L: [11, 9, 7, 5], T: 4, ...played([11, 9, 7, 5], 4, { overrides: { compStyle: 'notes' } }) });
LOOPS.push({ label: '19:17:16:15 · the drums off', L: [19, 17, 16, 15], T: 4, ...played([19, 17, 16, 15], 4, { drumOptions: { enabled: false } }) });
for (const C of LOOPS) { C.own = ownOf(C.loop); C.sounds = soundsOf(C.loop); C.row = C.m.row; C.full = C.row.active.reduce((a, b) => a | (1 << b), 0); C.N = C.loop.knobs.bars; }
const SEEDS = [1, 2, 3];
const songs = [];
for (const C of LOOPS) for (const template of Object.keys(TEMPLATES)) for (const seed of SEEDS) songs.push({ C, template, seed, song: planSong(C.loop, C.m, { template, seed }) });

// ── 1. the record (S1) and determinism ──
console.log('\n— the record and determinism');
{
  let bad = '';
  for (const { C, template, seed, song } of songs) {
    const at = `${C.label} ${template} seed ${seed}`, n = KINDS[template].length;
    const shapeOk = song.version === SONG_VERSION && song.template === template && song.seed === seed && Number.isInteger(song.passesEach) && Array.isArray(song.decisions)
      && J([...song.order].sort()) === J([...C.row.active].sort()) && song.sections.length === n
      && song.sections.every((s, i) => s.kind === KINDS[template][i] && s.name === NAMES[template][i] && s.target === TARGETS[template][i] && SECTION_KINDS.includes(s.kind)
        && Number.isInteger(s.layers) && typeof s.fillBefore === 'boolean' && typeof s.why === 'string' && Number.isFinite(s.energy) && PARTS.every((id) => typeof s.parts[id] === 'boolean')
        && Object.keys(s.parts).length === PARTS.length && Object.keys(s.density).every((k) => DENS.includes(k)));
    if (!shapeOk) bad ||= `${at}: shape`;
  }
  check('S1: every song is { version composer-song-v0, template, seed, order, passesEach, sections, decisions }, each section { kind, name, passes, layers, parts (six booleans), density, fillBefore, energy, target, why } in its template\'s order', !bad, bad);
  let det = '';
  for (const { C, template, seed, song } of songs.filter((x) => x.seed === 1)) {
    if (J(planSong(C.loop, C.m, { template, seed })) !== J(song)) det ||= `${C.label} ${template}: planSong twice`;
    const copy = JSON.parse(J(C.loop)), m2 = materialsOf(copy), again = planSong(copy, m2, { template, seed });
    if (J(again) !== J(song)) det ||= `${C.label} ${template}: a fresh copy of the loop`;
    if (J(songPasses(again, copy, m2)) !== J(songPasses(song, C.loop, C.m))) det ||= `${C.label} ${template}: songPasses on the copy`;
  }
  check('determinism: the same loop, template and seed give the same song, again and from a fresh JSON copy of the loop and its materials (nothing kept between calls steers it), and the same passes', !det, det);
  const variety = LOOPS.filter((C) => new Set(songs.filter((x) => x.C === C && x.template === 'arch').map((x) => J(x.song.sections.map((s) => [s.layers, s.parts, s.density])))).size > 1).length;
  check(`the seed breaks ties (within ${TIE_BAND}): Re-plan gives another Arch on ${variety} of ${LOOPS.length} loops (seeds 1–3)`, variety >= LOOPS.length / 2, `${variety}`);
  let rt = '';
  for (const { C, template, seed, song } of songs.filter((x) => x.seed === 2)) {
    const back = JSON.parse(J(song));
    if (J(back) !== J(song) || J(songPasses(back, C.loop, C.m)) !== J(songPasses(song, C.loop, C.m))) rt ||= `${C.label} ${template}`;
  }
  check('JSON round trip: a song parsed back from its JSON is the same song and plays the same passes', !rt, rt);
}

// ── 2. the kinds (S4) ──
console.log('\n— every section within its kind');
{
  let bad = '';
  for (const { C, template, seed, song } of songs) {
    const L = song.order.length, own = C.own, at = `${C.label} ${template} seed ${seed}`;
    const rec = (p, on, roots = false) => { let s = presetOf(own, p); if (roots) s = { ...s, bass: 'roots' }; return J(recordOf(own, C.sounds, s, on)); };
    song.sections.forEach((s, i) => {
      const prev = song.sections[i - 1], k = popcount(s.layers), isPrefix = s.layers === prefix(song.order, k), d = J(s.density), all = PARTS.every((id) => s.parts[id]);
      let ok = MASK_KEYS.has(maskKey(s.parts)) && isPrefix;
      if (s.kind === 'intro') ok &&= !s.parts.lead && k >= 1 && (INTRO_LAYERS[template] != null ? k === INTRO_LAYERS[template] : k <= Math.ceil(L / 2)) && [rec('low', s.parts), rec('loop', s.parts)].includes(d);
      if (s.kind === 'build') ok &&= k >= 1 && (!prev || (s.layers & prev.layers) === prev.layers) && ['low', 'loop', 'high'].some((p) => rec(p, s.parts) === d);
      if (s.kind === 'peak' || s.kind === 'drop') ok &&= all && s.layers === C.full && d === rec('high', s.parts);
      if (s.kind === 'break') ok &&= !s.parts.drums && s.layers === C.full && (!s.parts.bass || resolve(own, s.density).bass === 'roots') && ['low', 'loop', 'high'].some((p) => rec(p, s.parts, true) === d);
      if (s.kind === 'home') ok &&= all && s.layers === C.full && d === '{}' && Math.abs(s.energy - 1) < EPS;
      if (!ok) bad ||= `${at} section ${i + 1} (${s.kind}): ${J({ layers: s.layers, parts: maskKey(s.parts), density: s.density })}`;
    });
  }
  check('S4: an intro without the lead, on the order\'s first ⌈L/2⌉ layers or fewer (Build–drop\'s on exactly its first, the slowest), low or loop; a build holding the layers before; a peak or drop every part and layer, high; a break no drums, every layer, the bass off or Roots; home the loop (E 1); every section one of the eight masks on a prefix of the order', !bad, bad);
  let en = '';
  for (const { C, song } of songs) for (const s of song.sections) if (Math.abs(energyOf(s, C.loop, C.m) - s.energy) > EPS) en ||= `${C.label} ${s.name}`;
  check('each section\'s energy is energyOf of its own data (an edited section reads it again)', !en, en);
  const peaks = songs.filter((x) => x.seed === 1).flatMap((x) => x.song.sections.filter((s) => s.kind === 'peak' || s.kind === 'drop').map((s) => s.energy));
  check(`the peaks and drops at the high preset sit at or over home: ${Math.min(...peaks).toFixed(2)}–${Math.max(...peaks).toFixed(2)}`, peaks.every((e) => e >= 1 - EPS));
}

// ── 3. the neighbour rule and the curve (S5) ──
console.log('\n— the neighbour rule and the curve');
{
  let bad = '', relaxed = 0, kept = 0, mism = '';
  const candOf = new Map();
  const cands = (C, kind, order, template) => { const key = `${C.label}|${kind}|${order}|${template}`; if (!candOf.has(key)) candOf.set(key, candidates(C, kind, order, template)); return candOf.get(key); };
  for (const { C, template, seed, song } of songs) {
    song.sections.forEach((s, i) => {
      if (!i) return;
      const prev = song.sections[i - 1], n = changes(C.own, prev, s);
      if (n !== boundaryChanges(prev, s, C.loop, C.m)) mism ||= `${C.label} ${template} ${i}: ${n} here, ${boundaryChanges(prev, s, C.loop, C.m)} in form.js`;
      if (FREE.includes(s.kind)) return;
      if (n <= LIMIT) { kept++; return; }
      relaxed++;
      const held = cands(C, s.kind, song.order, template).filter((c) => s.kind !== 'build' || (c.layers & prev.layers) === prev.layers);
      const least = Math.min(...held.map((c) => changes(C.own, prev, c)));
      if (least <= LIMIT || n !== least) bad ||= `${C.label} ${template} seed ${seed} ${s.name}: ${n} changes, a candidate takes ${least}`;
    });
  }
  check(`S5: into an intro or a build at most ${LIMIT} changes (${kept} boundaries); any that take more (${relaxed}) take the fewest any candidate of the kind could`, !bad, bad);
  const breaks = songs.flatMap(({ C, song }) => song.sections.map((s, i) => (s.kind === 'break' ? changes(C.own, song.sections[i - 1], s) : null)).filter((n) => n != null));
  check(`… and into a break anything (the planner's ruling, 11-04: a contrast, not a drift): ${breaks.filter((n) => n > LIMIT).length} of ${breaks.length} breaks take more than ${LIMIT}, up to ${Math.max(...breaks)}`, breaks.some((n) => n > LIMIT));
  const nb = songs.flatMap(({ song }) => song.sections.filter((s) => s.kind === 'break' && maskKey(s.parts) === 'lead,chords,comp,inner')).length;
  check(`the eighth mask (every part but the drums and the bass) is a break's candidate: ${nb} breaks play it`, nb > 0);
  check('the boundaries\' changes counted here (a layer, a part, a density rung both sections sound) are boundaryChanges\'', !mism, mism);
  // the curve: the best path by brute force (every path the kinds' edges allow), Σ |E − target|
  let worse = '', paths = 0;
  for (const { C, template, seed, song } of songs.filter((x) => x.seed === 1 || x.seed === 3)) {
    const kinds = KINDS[template], T = TARGETS[template], C0 = kinds.map((k) => cands(C, k, song.order, template));
    let best = Infinity;
    const walk = (i, prev, sum) => {
      if (sum >= best) return;
      if (i === kinds.length) { best = sum; paths++; return; }
      let list = C0[i];
      if (prev && kinds[i] === 'build') list = list.filter((c) => (c.layers & prev.layers) === prev.layers);
      if (prev && !FREE.includes(kinds[i])) { const n = list.map((c) => changes(C.own, prev, c)), ok = list.filter((_, j) => n[j] <= LIMIT); list = ok.length ? ok : list.filter((_, j) => n[j] === Math.min(...n)); }
      for (const c of list) walk(i + 1, c, sum + Math.abs(c.energy - T[i]));
    };
    walk(0, null, 0);
    const got = song.sections.reduce((a, s, i) => a + Math.abs(s.energy - T[i]), 0);
    if (got > best + TIE_BAND * kinds.length + EPS) worse ||= `${C.label} ${template} seed ${seed}: ${got.toFixed(3)} against the best ${best.toFixed(3)}`;
  }
  check(`the curve: each song's Σ |E − target| within ${TIE_BAND} a section of the best path a brute force finds through the candidates (${paths} improving paths)`, !worse, worse);
}

// ── 4. the order (S6) ──
console.log('\n— the order');
{
  const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  let bad = '', slow = '';
  for (const C of LOOPS) {
    const all = onOf(PARTS), E = (M) => energyOf({ kind: 'build', passes: 1, layers: M, parts: all, density: {} }, C.loop, C.m);
    let best = null;
    for (const p of perms([...C.row.active])) {
      const e = Array.from({ length: p.length + 1 }, (_, k) => E(prefix(p, k))), d = e.slice(1).map((x, k) => x - e[k]), mu = d.reduce((a, b) => a + b, 0) / d.length, v = d.reduce((a, b) => a + (b - mu) ** 2, 0) / d.length;
      // ties: fastest first (the larger value first, position by position)
      const faster = (a, b) => { for (let i = 0; i < a.length; i++) { const x = C.row.layers[b[i]] - C.row.layers[a[i]]; if (x) return x < 0; if (a[i] !== b[i]) return a[i] < b[i]; } return false; };
      if (!best || v < best.v - 1e-12 || (Math.abs(v - best.v) <= 1e-12 && faster(p, best.p))) best = { p, v };
    }
    const arch = songs.find((x) => x.C === C && x.template === 'arch').song, bd = songs.find((x) => x.C === C && x.template === 'build-drop').song;
    if (J(arch.order) !== J(best.p)) bad ||= `${C.label}: ${J(arch.order)}, the brute force ${J(best.p)}`;
    const want = [...C.row.active].sort((a, b) => C.row.layers[a] - C.row.layers[b] || a - b);
    if (J(bd.order) !== J(want)) slow ||= `${C.label}: ${J(bd.order)}`;
    if (E(C.full) !== 1) bad ||= `${C.label}: every layer is not 1`;
  }
  check('S6: Arch\'s order is the permutation whose prefix energies (every part, the loop\'s densities, from no layer to all) step most evenly, ties fastest first — a brute force over every permutation, every loop', !bad, bad);
  check('Build–drop\'s order is slowest first (the smaller layer value first)', !slow, slow);
}

// ── 5. the passes (S7) and the expansion (S9) ──
console.log('\n— the passes');
{
  let bad = '', exp = '';
  for (const { C, song } of songs) {
    const K = C.loop.knobs, cycle = K.cycleSeconds;   // no MIDI target here: the seed tempo is the spec's own
    const want = Math.max(1, Math.min(16, Math.round(20 / cycle)));
    if (song.passesEach !== want || song.sections.some((s) => s.passes !== want)) bad ||= `${C.label}: ${song.passesEach}, want ${want}`;
    const P = songPasses(song, C.loop, C.m), idx = song.sections.flatMap((s, i) => Array.from({ length: s.passes }, (_, p) => [i, p]));
    if (P.length !== idx.length || P.some((e, j) => e.section !== idx[j][0] || e.pass !== idx[j][1] || e.parts.length !== 5)) exp ||= `${C.label}`;
  }
  check('S7: passesEach = clamp(round(20 s / the cycle), 1, 16), every section the same', !bad, bad);
  check('S9: songPasses gives one entry a pass, { section, pass, parts (five), drums }, sections in order', !exp, exp);
  const tgt = compose([8, 7, 6, 5], 4, { seed: 1 }), slowSpec = { ...tgt, target: { tempoBpm: 60 } };   // a clip seeding 60 BPM: the cycle at the seed tempo is twice as long
  const s2 = planSong(slowSpec, materialsOf(tgt), { targetSeconds: 20 }), s1 = planSong(tgt, materialsOf(tgt));
  check(`the cycle is the seed tempo's: a spec seeded at half its tempo plays half the passes (${s1.passesEach} → ${s2.passesEach}); targetSeconds asked is recorded`, s2.passesEach === Math.round(20 / (2 * tgt.knobs.cycleSeconds)) && planSong(tgt, materialsOf(tgt), { targetSeconds: 30 }).targetSeconds === 30 && !('targetSeconds' in s1));
}

// ── 6. home and the parts off ──
console.log('\n— home, and the parts off');
{
  let bad = '', ident = '', off = '';
  for (const { C, song } of songs) {
    const P = songPasses(song, C.loop, C.m);
    for (const e of P) {
      const s = song.sections[e.section];
      if (s.kind === 'home') {
        if (J(e.parts) !== J(C.loop.parts) || J(e.drums) !== J(C.loop.drums ?? null)) bad ||= `${C.label} pass ${e.section}.${e.pass}`;
        if (!e.parts.every((p, i) => p === C.loop.parts[i]) || e.drums !== (C.loop.drums ?? null)) ident ||= `${C.label}`;
      }
      for (const p of e.parts) if (!s.parts[p.id] && p.enabled) off ||= `${C.label} ${s.name} ${p.id}`;
      for (const p of e.parts) if (s.parts[p.id] && p.enabled !== C.sounds[p.id]) off ||= `${C.label} ${s.name} ${p.id} sounds as the loop doesn't`;
      if (e.drums && !s.parts.drums && e.drums.enabled && !(s.fillBefore && e.pass === s.passes - 1)) off ||= `${C.label} ${s.name} drums`;
    }
  }
  check('home is the loop byte for byte: every home pass\'s parts and drums are the loop\'s JSON', !bad, bad);
  check('… and the loop\'s own objects (nothing rebuilt)', !ident, ident);
  check('a part off in a section plays enabled: false (the drums too, but for a fill alone); a part off in the loop is off in every section', !off, off);
}

// ── 7. the layer filter (ruling 1) ──
console.log('\n— the layer filter');
{
  let whole = '', exact = '', n = 0, cut = 0;
  const noteKey = (x) => J([x.node, x.time, x.hz, x.velocity, x.voice ?? null, x.lane ?? null, x.bar, x.slot]);
  for (const { C, song } of songs.filter((x) => x.seed === 1)) {
    const full = { ...song, sections: song.sections.map((s) => ({ ...s, layers: C.full })) };
    const A = songPasses(song, C.loop, C.m), B = songPasses(full, C.loop, C.m), owners = C.row.owners;
    const nodeAt = (tick) => { let lo = 0, hi = C.row.n - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (C.row.tick[m] === tick) return m; if (C.row.tick[m] < tick) lo = m + 1; else hi = m - 1; } return -1; };
    A.forEach((e, j) => {
      const M = song.sections[e.section].layers, f = B[j];
      for (const p of e.parts) {
        const q = f.parts.find((x) => x.id === p.id);
        if (['lead', 'chords', 'bass'].includes(p.id)) { if (J(p) !== J(q)) whole ||= `${C.label} pass ${j} ${p.id}`; continue; }
        if (!p.enabled) continue;
        n++;
        const want = q.notes.filter((x) => owners[x.node] & M).map(noteKey);
        if (J(p.notes.map(noteKey)) !== J(want)) exact ||= `${C.label} pass ${j} ${p.id}`;
        if (p.notes.length < q.notes.length) cut++;
      }
      if (e.drums?.enabled) {
        n++;
        if (e.drums.hits.some((h) => nodeAt(h.tick) < 0)) exact ||= `${C.label} pass ${j}: a drum hit off the row`;
        if (J(e.drums.hits) !== J(f.drums.hits.filter((h) => owners[nodeAt(h.tick)] & M))) exact ||= `${C.label} pass ${j} drums`;
      }
    });
  }
  check('ruling 1: the lead, the chords and the bass play whole in every pass (byte for byte the same section on every layer)', !whole, whole);
  check(`… the comp, the inner and the drums keep exactly the notes and hits one of the section's layers strikes (${n} parts, ${cut} thinned), every drum hit on a row onset`, !exact && cut > 0, exact || `${cut} thinned`);
}

// ── 8. a density as the controller arranges it ──
console.log('\n— a density, as the controller arranges it');
{
  let bad = '', runs = 0;
  for (const C of LOOPS) {
    const own = C.own, all = onOf(PARTS);
    for (const p of ['low', 'high']) {
      const s = presetOf(own, p), rec = recordOf(own, C.sounds, s, all);
      if (!Object.keys(rec).length) continue;
      runs++;
      const got = songPasses({ version: SONG_VERSION, sections: [{ kind: 'build', passes: 1, layers: C.full, parts: all, density: rec, fillBefore: false }] }, C.loop, C.m)[0];
      // the controller's fold and settleState, written out: the comp's density door, the arps, the drums, the bass over them
      let spec = C.loop;
      if (s.comp !== own.comp) spec = applyRearrange(spec, reclave(spec, C.m.row, C.m.cells, { density: s.comp }, { parts: spec.parts, drumOptions: C.loop.drums.options }));
      for (const id of ['lead', 'inner']) {
        const was = spec.parts.find((x) => x.id === id);
        if (s[id] === 'line' && was.arp) { const line = lineOf(was); spec = placed(spec, rearticulate(line, { sound: id === 'inner' && was.sound === 'harp' ? line.sound : was.sound, legato: was.legato, enabled: was.enabled, cycleSeconds: spec.knobs.cycleSeconds })); }
      }
      const drums = arrangeDrums(spec, C.loop.drums.options);
      const bass = arrangeBass({ ...spec, drums }, C.m, { density: s.bass, lock: own.lock, picks: s.bass === own.bass ? { ...(C.loop.parts.find((x) => x.id === 'bass').bass?.picks ?? {}) } : {} });
      spec = placed({ ...spec, drums }, bass);
      if (J(got.parts) !== J(spec.parts) || J(got.drums) !== J(drums)) bad ||= `${C.label} ${p}: ${got.parts.map((x, i) => (J(x) === J(spec.parts[i]) ? '' : x.id)).filter(Boolean).join(',')}${J(got.drums) !== J(drums) ? ' drums' : ''}`;
    }
  }
  check(`S3: the low and high presets on every part and layer are the window's arrangement (reclave's density, Arp → Line, the drums at the loop's options, the bass over them at the loop's lock) byte for byte (${runs} presets)`, !bad && runs > 0, bad);
  const C = LOOPS.find((x) => x.label.startsWith('119:42:15:8 · Arp')), low = songs.find((x) => x.C === C && x.template === 'arch').song;
  const intro = songPasses(low, C.loop, C.m)[0], lead = intro.parts.find((p) => p.id === 'lead'), inner = intro.parts.find((p) => p.id === 'inner');
  // the intro sounds no lead: its density says nothing of it, and the lead it doesn't play stays the loop's (an arp)
  check(`a loop playing Arp: low plays Line (its line, the inner's own sound back), a part it doesn't sound left as the loop's — the Arch intro on 119:42:15:8 asks ${J(low.sections[0].density)}`,
    low.sections[0].density.inner === 'line' && !inner.arp && inner.sound === lineOf(C.loop.parts.find((p) => p.id === 'inner')).sound && !('lead' in low.sections[0].density) && !!lead.arp && !lead.enabled);
}

// ── 9. fillBars (S8) ──
console.log('\n— fillBars');
{
  const usesAgainst = (v) => v && (v.mode === 'against' || Object.values(v.perBar ?? {}).includes('against'));
  let base = '', n = 0;
  for (const c of DRUM_BASELINE_CASES) {
    const [L, T, ov] = c, spec = compose(L, T, { seed: DRUM_BASELINE_SEED, overrides: { ...ov, compStyle: 'notes' } }), want = DRUM_BASELINE[caseName(c)];
    DRUM_BASELINE_VARIANTS.forEach((v, i) => { if (usesAgainst(v)) return; n++; if (sha(v === null ? spec.drums : arrangeDrums(spec, v)) !== want[i]) base ||= `${caseName(c)} variant ${i}`; });
  }
  check(`unset, the drums are byte for byte drums-baseline.mjs' (${n} cases × variants, never re-frozen)`, !base && n === 527, base);
  let own = '';
  for (const C of LOOPS.filter((x) => x.label.indexOf(' · ') < 0)) if (J(arrangeDrums(C.loop, C.loop.drums.options)) !== J(C.loop.drums)) own ||= C.label;
  check('… and arranging Compose\'s drums again from their own options gives them back', !own, own);
  let bad = '', same = '', runs = 0;
  for (const C of LOOPS.filter((x) => x.label.indexOf(' · ') < 0)) {
    const N = C.N, plain = C.loop.drums, from = beatsOf(C.loop.knobs.slotsPerBar).pos[2];
    for (let k = 0; k < N; k++) {
      const d = arrangeDrums(C.loop, { ...plain.options, fillBars: [k] }), next = (k + 1) % N;
      runs++;
      const other = (h) => h.bar !== k && h.bar !== next;
      const ok = d.bars[k].fill && d.bars[next].crash && J(d.options.fillBars) === J([k])
        && J(d.hits.filter(other)) === J(plain.hits.filter(other))
        && J(d.hits.filter((h) => h.bar === k && h.voice !== 'cym' && (h.pos < from - EPS || (h.voice !== 'kick' && h.voice !== 'snare' && h.voice !== 'hat')))) === J(plain.hits.filter((h) => h.bar === k && h.voice !== 'cym' && (h.pos < from - EPS || (h.voice !== 'kick' && h.voice !== 'snare' && h.voice !== 'hat'))))
        && !d.hits.some((h) => h.bar === k && h.voice === 'hat' && h.pos >= from - EPS) && d.hits.some((h) => h.bar === k && h.voice === 'snare' && h.pos >= from - EPS)
        && d.hits.some((h) => h.bar === next && h.voice === 'cym' && Math.abs(h.pos) < EPS);
      if (!ok) bad ||= `${C.label} bar ${k}`;
    }
    // the phrase ends asked as fillBars with the phrase fills off are the phrase fills
    const ends = plain.bars.filter((b) => b.fill).map((b) => b.bar);
    if (ends.length) { const d = arrangeDrums(C.loop, { ...plain.options, fills: false, fillBars: ends }); if (J(d.hits) !== J(plain.hits) || J(d.bars.map((b) => [b.fill, b.crash])) !== J(plain.bars.map((b) => [b.fill, b.crash]))) same ||= C.label; }
  }
  check(`set, bar k fills from beat 3 (the groove's kick, snare and hat there replaced by the fill) and bar k + 1 crashes (a one-bar row's own downbeat), every other bar untouched (${runs} bars)`, !bad, bad);
  check('the phrase ends asked as fillBars, with the phrase fills off, are the phrase fills hit for hit', !same, same);
  const C = LOOPS[0];
  check('fillBars refused: past the bars, negative, not whole, not a list; DRUM_OPTIONS has it', throws(() => arrangeDrums(C.loop, { fillBars: [C.N] }), /past/) && throws(() => arrangeDrums(C.loop, { fillBars: [-1] }), /fillBars/)
    && throws(() => arrangeDrums(C.loop, { fillBars: [0.5] }), /fillBars/) && throws(() => arrangeDrums(C.loop, { fillBars: 2 }), /fillBars/));
}

// ── 10. a song's fills ──
console.log('\n— a song\'s fills');
{
  let into = '', fill = '', crash = '', alone = '', moved = '', rest = '', nFill = 0, nAlone = 0, nCrash = 0;
  for (const { C, template, song } of songs.filter((x) => x.seed === 1)) {
    const S = song.sections, at = `${C.label} ${template}`;
    S.forEach((s, i) => { const want = ['peak', 'drop'].includes(S[(i + 1) % S.length].kind); if (s.fillBefore !== want) into ||= `${at} ${s.name}`; });
    if (!C.sounds.drums) continue;
    const bare = { ...song, sections: S.map((s) => ({ ...s, fillBefore: false })) };
    const A = songPasses(song, C.loop, C.m), B = songPasses(bare, C.loop, C.m), N = C.N, from = beatsOf(C.loop.knobs.slotsPerBar).pos[2];
    A.forEach((e, j) => {
      const s = S[e.section], isFill = s.fillBefore && e.pass === s.passes - 1, before = S[(e.section - 1 + S.length) % S.length], isCrash = before.fillBefore && e.pass === 0 && s.parts.drums;
      const d = e.drums, u = B[j].drums;
      if (isFill && s.parts.drums) {
        nFill++;
        if (!d.bars[N - 1].fill || !d.options.fillBars?.includes(N - 1)) fill ||= `${at} ${s.name}`;
        // the crash the fill bar wraps to is not this pass's: bar 1 as the section plays it (unless a crash opens it anyway)
        if (!isCrash && (d.bars[0].crash !== u.bars[0].crash || J(d.hits.filter((h) => h.bar === 0 && h.voice === 'cym')) !== J(u.hits.filter((h) => h.bar === 0 && h.voice === 'cym')))) moved ||= `${at} ${s.name}`;
        const other = (h) => h.bar !== N - 1 && h.bar !== 0;
        if (J(d.hits.filter(other)) !== J(u.hits.filter(other))) rest ||= `${at} ${s.name}`;
      } else if (isFill) {
        nAlone++;
        if (!d.enabled || !d.hits.length || d.hits.some((h) => h.bar !== N - 1 || (h.voice !== 'kick' && h.voice !== 'snare') || h.pos < from - EPS)) alone ||= `${at} ${s.name}: ${d.hits.length} hits`;
      }
      if (isCrash) {
        nCrash++;
        if (!d.bars[0].crash || !d.hits.some((h) => h.bar === 0 && h.voice === 'cym' && Math.abs(h.pos) < EPS && h.velocity >= 0.55 + 0.12 - EPS)) crash ||= `${at} ${s.name}`;
        const other = (h) => !(h.bar === 0 && h.voice === 'cym');
        if (!isFill && J(d.hits.filter(other)) !== J(u.hits.filter(other))) rest ||= `${at} ${s.name} (crash)`;
      }
      if (!isFill && !isCrash && J(d) !== J(u)) rest ||= `${at} pass ${j}`;
    });
  }
  check('S8: a section has fillBefore exactly when the next (the song wrapping) is a peak or a drop', !into, into);
  check(`its last pass plays the last bar a fill (drums.js fillBars) (${nFill} passes)`, !fill && nFill > 0, fill);
  check('… whose wrapped crash leaves bar 1 as the section plays it, every other bar the pass without the fill', !moved && !rest, moved || rest);
  check(`the next section opens on the crash, the downbeat struck at the crash's velocity (${nCrash} passes)`, !crash && nCrash > 0, crash);
  check(`a section with the drums off (Arch's break) plays the fill alone: kick and snare from beat 3 of its last bar (${nAlone} passes)`, !alone && nAlone > 0, alone);
}

// ── 11. edits (phase C's plain data) and refusals ──
console.log('\n— an edited song, and refusals');
{
  const C = LOOPS.find((x) => x.label === '119:42:15:8'), song = planSong(C.loop, C.m), edited = JSON.parse(J(song));
  edited.sections[0].parts.comp = !edited.sections[0].parts.comp;
  edited.sections[1].passes = 3;
  edited.sections[1].layers = C.full;
  edited.sections[2].density = { bass: 'roots', lead: 'arp' };
  edited.sections[3].fillBefore = false;
  edited.sections.push({ ...JSON.parse(J(song.sections[5])), kind: 'build', name: 'Coda', passes: 1, layers: 1 << song.order[0], parts: { ...song.sections[5].parts, drums: false } });
  const P = songPasses(edited, C.loop, C.m), total = edited.sections.reduce((a, s) => a + s.passes, 0);
  const lead = P.find((e) => e.section === 2).parts.find((p) => p.id === 'lead');
  const ok = P.length === total && P.filter((e) => e.section === 1).length === 3 && P.find((e) => e.section === 0).parts.find((p) => p.id === 'comp').enabled === edited.sections[0].parts.comp
    && !!lead.arp && P.find((e) => e.section === 2).parts.find((p) => p.id === 'bass').bass.density === 'roots'
    && P.filter((e) => e.section === 6).every((e) => e.drums.enabled === false) && Number.isFinite(energyOf(edited.sections[2], C.loop, C.m));
  check('an edited song plays as written: a part toggled, passes and layers changed, a density edited (Roots, the lead to Arp), a fill taken out, a section added', ok);
  const bad = (f) => throws(() => songPasses(f(JSON.parse(J(song))), C.loop, C.m));
  check('refused: another version, no sections, a bad kind, passes 0, a layer the row hasn\'t, a part missing, a density not on its ladder or for no part',
    bad((s) => ({ ...s, version: 'x' })) && bad((s) => ({ ...s, sections: [] })) && bad((s) => { s.sections[0].kind = 'chorus'; return s; }) && bad((s) => { s.sections[0].passes = 0; return s; })
    && bad((s) => { s.sections[0].layers = 1 << 5; return s; }) && bad((s) => { delete s.sections[0].parts.inner; return s; }) && bad((s) => { s.sections[0].density = { bass: 'busy' }; return s; })
    && bad((s) => { s.sections[0].density = { drums: 'loud' }; return s; }));
  const notes = LOOPS.find((x) => x.label.startsWith('11:9:7:5 · comp in notes'));
  check('a comp density on a loop whose clave isn\'t read from the frames is refused (it has no tier), and its songs never ask one',
    throws(() => energyOf({ ...songs.find((x) => x.C === notes).song.sections[2], density: { comp: 'dense' } }, notes.loop, notes.m), /tier/) && songs.filter((x) => x.C === notes).every((x) => x.song.sections.every((s) => !('comp' in s.density))));
  check('planSong refuses an unknown template, a bad targetSeconds and a loop without its materials',
    throws(() => planSong(C.loop, C.m, { template: 'aaba' }), /template/) && throws(() => planSong(C.loop, C.m, { targetSeconds: 0 }), /targetSeconds/) && throws(() => planSong(C.loop, null), /materials/)
    && throws(() => planSong(C.loop, LOOPS[0].m), /materials/));
}

// ── 12. the 16,359-onset row ──
console.log('\n— the 16,359-onset row');
{
  const big = compose([4099, 4093, 4091, 4079], 16, { seed: 1 }), m = materialsOf(big);
  const t0 = now(), song = planSong(big, m), t1 = now(), P = songPasses(song, big, m), t2 = now(), bd = planSong(big, m, { template: 'build-drop' }), t3 = now();
  const home = P.filter((e) => song.sections[e.section].kind === 'home');
  check(`planSong ≤ 1.5 s on the 16,359-onset row: ${(t1 - t0).toFixed(0)} ms (a fresh loop: the low and high arrangements included); songPasses ${(t2 - t1).toFixed(0)} ms; Build–drop after ${(t3 - t2).toFixed(0)} ms`,
    t1 - t0 <= 1500 && big.stats.onsets === 16359 && home.every((e) => J(e.parts) === J(big.parts) && J(e.drums) === J(big.drums)));
  LOOPS.push({ label: '4099:4093:4091:4079 (16,359 onsets)', L: [4099, 4093, 4091, 4079], T: 16, loop: big, m, table: [song, bd] });
}

// ── the table (for the order's log) ──
console.log('\n— the songs, seed 1 (layers in the order they enter; E against the target)');
const short = { 'lead,chords,comp,inner': 'all−drums−bass', 'chords': 'chords', 'chords,inner': 'chords+inner', 'bass,drums': 'drums+bass', 'chords,bass,drums': 'drums+bass+chords', 'chords,comp,bass,inner,drums': 'all−lead', 'lead,chords,comp,bass,inner': 'all−drums', 'lead,chords,comp,bass,inner,drums': 'all' };
const LN = 'ABCD';
for (const C of LOOPS.filter((x) => x.label.indexOf(' · ') < 0)) {
  const pair = C.table ?? ['arch', 'build-drop'].map((t) => songs.find((x) => x.C === C && x.template === t && x.seed === 1).song);
  for (const song of pair) {
    const L = C.loop.input.layers, ord = song.order.map((b) => `${LN[b]}${L[b]}`).join(' ');
    console.log(`  ${C.label} · ${TEMPLATES[song.template].label} · ${ord} · ${song.passesEach} pass${song.passesEach === 1 ? '' : 'es'} a section`);
    for (const s of song.sections) {
      const lay = song.order.filter((b) => s.layers & (1 << b)).map((b) => LN[b]).join('');
      const den = Object.entries(s.density).map(([k, v]) => `${k} ${v}`).join(', ') || '–';
      console.log(`    ${s.name.padEnd(8)} ${lay.padEnd(4)} ${(short[maskKey(s.parts)] ?? maskKey(s.parts)).padEnd(17)} ${den.padEnd(30)} ${s.energy.toFixed(2)} / ${s.target.toFixed(2)}${s.fillBefore ? '  fill →' : ''}`);
    }
  }
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
