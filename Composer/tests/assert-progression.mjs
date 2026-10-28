// assert-progression.mjs — Composer/core/progression.js and the targeted path through harmony.js and compose.js.
// Exit non-zero on any mismatch.
//   • the fallback names read back through ProgressionSolver.parseChordSymbol; chooseChordOnRoot on made-up bars
//     (support, the slack of one class, the fallbacks, the lead's vote, modulation on and off)
//   • rootCandidates: the base root first, as Compose picks it; every candidate a tone of the row; refusals
//   • no progression, an empty one and an all-auto one: the spec byte-identical to today's, and the e3909e1 baseline
//   • targeted: every asked root kept on its bar after the settle passes; each quality supported by the bar's own
//     tones (or a named fallback); every note of every part an onset of the row; determinism; the worker
//   • "take from last compose": an auto compose's roots fed back come back the same
//   • a root the bar cannot support falls back, never throws (every candidate on every bar of a small row)
//   • an off-grid root modulates (for every part), and with modulation off is kept, flagged offGrid
//   • mixed auto/targeted; a progression longer or shorter than the bars; a ratio not of the row; bad input throws
//   • timing: targeted against auto on the 16,359-onset row (no slower)
//   node Composer/tests/assert-progression.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { classOfCents } from '../core/frame.js';
import { PC_NAMES, CHORD_QUALITIES } from '../core/harmony.js';
import { compose } from '../core/compose.js';
import { rootCandidates, readProgression, chooseChordOnRoot, FALLBACK_QUALITIES, MAX_MISSING } from '../core/progression.js';
import { composeCases, normSpec, sha, COMPOSE_HASHES } from './settle-baseline.mjs';
import { RHYTHMS } from './rhythms.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const mod = (v, n) => ((v % n) + n) % n;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
const E = 15;

/** every note against the row (node, tick, ratio, time, hz with its bar's retune) → '' or what broke */
function audit(spec) {
  const row = buildRow(spec.input.layers), k = spec.knobs, T = k.cycleSeconds, phaseX = k.phase[0] / k.phase[1], fr = spec.chords.map((c) => c.fundamentalRatio);
  for (const part of spec.parts) for (const n of part.notes) {
    const [num, den] = n.ratio.split('/').map(Number);
    // a comp tone borrowed in chords (COMP_ARP_ORDER.md P4) sounds at its stroke's onset with its source voice's tone (`from`)
    if (row.tick[n.node] !== n.tick || row.tones[row.tone[n.borrowed ? n.from : n.node]] !== n.ratio) return `${part.id}: node ${n.node} is not its tick and ratio`;
    if (!near(n.time, mod(n.tick / row.grid - phaseX, 1) * T)) return `${part.id}: node ${n.node} is not at its own time`;
    if (!near(n.hz, k.baseHz * (num / den) * 2 ** n.octave * fr[n.bar])) return `${part.id}: hz of node ${n.node}`;
  }
  return '';
}
/** the classes a chord's root reads in its bar's windows (as harmony.js' bar material) → Set */
function barClasses(spec, row, bar, rootRatio) {
  const k = spec.knobs, cells = buildCells(row, { bars: k.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase });
  const rc = row.toneCents[row.tones.indexOf(rootRatio)], out = new Set();
  for (const s of cells.slots) if (s.bar === bar) for (const t of s.tones) { const c = classOfCents(row.toneCents[t.tone] - rc); if (Math.abs(c.dev) <= k.frameCentsEachSide + 1e-9) out.add(c.pc); }
  return out;
}
/** a targeted spec against its asks: '' or what broke (roots kept, qualities supported, fallbacks named) */
function auditTargets(spec, asked) {
  const row = buildRow(spec.input.layers), N = spec.knobs.bars, all = [...CHORD_QUALITIES, ...FALLBACK_QUALITIES];
  for (let b = 0; b < N; b++) {
    const want = asked[b] ?? null, c = spec.chords[b];
    if (want == null) { if (c.targeted) return `bar ${b + 1}: auto but marked targeted`; continue; }
    if (c.rootTone !== want) return `bar ${b + 1}: root ${c.rootTone}, asked ${want}`;
    if (!c.targeted) return `bar ${b + 1}: not marked targeted`;
    const q = all.find((x) => x.id === c.quality), have = barClasses(spec, row, b, want), lacks = q.intervals.filter((i) => !have.has(i));
    if (!c.fallback && lacks.length > MAX_MISSING) return `bar ${b + 1}: ${c.name} lacks ${lacks} in the bar`;
    if (c.fallback && (c.fallback !== c.quality || q.intervals.slice(1).some((i) => !have.has(i)))) return `bar ${b + 1}: fallback ${c.name} not on the bar's tones`;
    if (c.fallback && CHORD_QUALITIES.some((x) => x.intervals.filter((i) => !have.has(i)).length <= MAX_MISSING)) return `bar ${b + 1}: fell back though a quality is supported`;
  }
  return '';
}

console.log('Composer progression');

console.log('\n— the fallback vocabulary, against the Progression Solver');
{
  const solver = require(path.join(ROOT, 'Playback', 'AdvancedPlayback', 'ProgressionSolver.js'));
  let bad = '';
  for (const q of FALLBACK_QUALITIES) for (let r = 0; r < 12; r++) {
    const name = `${PC_NAMES[r]}${q.suffix}`, parsed = solver.parseChordSymbol(name);
    const want = q.intervals.map((i) => mod(r + i, 12)).sort((a, b) => a - b).join();
    if (!parsed.ok || [...parsed.pitchClasses].sort((a, b) => a - b).join() !== want) { bad = `${name} reads as ${parsed.pitchClasses}`; break; }
  }
  check(`${FALLBACK_QUALITIES.length} fallbacks (${FALLBACK_QUALITIES.map((q) => q.suffix).join(', ')}): every name on every root read back by parseChordSymbol`, !bad, bad);
}

console.log('\n— chords on a pinned root, by hand');
{
  const T = (cents, weight = 2, tone = Math.round(cents)) => ({ tone, cents, weight, count: weight, node: tone + 1000 });
  const pin = { tone: 0, cents: 0 }, on = (tones, lead = [], o = {}) => chooseChordOnRoot(tones, lead, pin, { eachSide: E, ...o });
  let c = on([T(0)]);
  check('the root alone: the root-only fallback, its onset the rootNode', c.quality.id === 'root_only' && c.fallback === 'root_only' && c.root.node === 1000 && c.sounded === 'exact');
  c = on([T(0), T(702)]);
  check('root and fifth: a triad lacking one class is supported (the slack of one)', c.fallback === null && c.intervals.includes(7) && c.missing.length === 1, `${c.quality.id}`);
  c = on([T(0), T(386), T(702)]);
  check('root, major third, fifth: the major triad', c.quality.id === 'major_triad' && !c.fallback);
  c = on([T(310), T(702)]);
  check('no root in the bar: the minor triad over the asked root, the root kept, its node null', c.quality.id === 'minor_triad' && c.root.tone === 0 && c.root.node === null && c.sounded === 'absent');
  c = on([T(702, 2, 5)]);
  check('only the fifth, no root: the power chord', c.quality.id === 'power' && c.fallback === 'power');
  c = on([T(386, 2, 4)]);
  check('only the major third: the root and third, no fifth', c.quality.id === 'major_no5');
  c = on([]);
  check('an empty bar: the root alone, never a throw', c.quality.id === 'root_only' && c.sounded === 'absent');
  c = on([T(4, 2, 9)]);
  check('only a tone of the root\'s ±frame cluster: sounded "cluster", the node null', c.sounded === 'cluster' && c.root.node === null);
  const both = [T(0), T(310), T(386), T(702)];
  check('the lead votes: a strong minor third makes it minor, a strong major third major',
    on(both, [{ cents: 310, strong: true }]).quality.id === 'minor_triad' && on(both, [{ cents: 386, strong: true }]).quality.id === 'major_triad');
  const offPin = { tone: 0, cents: 30 };
  c = chooseChordOnRoot([T(30), T(732)], [], offPin, { eachSide: E });
  check('a root 30¢ off the grid modulates: offset −30, on class 0', c.modulate && near(c.offset, -30) && c.rootPc === 0 && !c.offGrid);
  c = chooseChordOnRoot([T(30), T(732)], [], offPin, { eachSide: E, modulation: false });
  check('modulation off: kept, flagged offGrid, nothing retuned', !c.modulate && c.offGrid && c.offset === 0);
  check('a pin without cents throws', throws(() => chooseChordOnRoot([], [], { tone: 0 }), /pinned root/));
}

console.log('\n— rootCandidates');
{
  const s = compose([41, 42, 43], 8), rc = rootCandidates([41, 42, 43]), row = buildRow([41, 42, 43]);
  check('the base root first, the root Compose picks', rc.candidates[0].isRoot && rc.candidates[0].ratio === s.knobs.root && rc.root === s.knobs.root);
  check('every candidate a tone of the row, in pitch order up from the root', rc.candidates.every((c, i) => row.tones[c.tone] === c.ratio && (i < 2 || c.fromRoot >= rc.candidates[i - 1].fromRoot)));
  check('each with a name, cents and presence', rc.candidates.every((c) => typeof c.name === 'string' && Number.isFinite(c.cents) && c.presence >= c.onsets && c.onsets > 0 && c.label.includes(c.ratio)));
  check('a row works as well as the layers; a root override moves the names', rootCandidates(row).candidates.length === rc.candidates.length && rootCandidates(row, { root: '1/1' }).candidates[0].ratio === '1/1');
  check('refusals: too few tones', rootCandidates([1]).refused && rootCandidates([1]).candidates.length === 0);
  const t0 = performance.now(), big = rootCandidates([4099, 4093, 4091, 4079]), ms = performance.now() - t0;
  check(`the 16,359-onset row: ${big.candidates.length} clusters in ${ms.toFixed(0)} ms (main-thread cheap: under 250 ms)`, big.candidates.length > 0 && ms < 250);
}

console.log('\n— no progression is today\'s Compose');
{
  let bad = '';
  for (const [L, T] of [[[8, 7, 6, 5], 4], [[41, 42, 43], 8], [[19, 17, 16, 15], 6], [[768, 769], 8]]) {
    const want = JSON.stringify(compose(L, T, { seed: 3 }));
    for (const p of [null, [], [null, null, null, null, null, null, null, null], ['auto', '', null]]) if (JSON.stringify(compose(L, T, { seed: 3, progression: p })) !== want) bad = `${L.join(':')} ${JSON.stringify(p)}`;
  }
  check('null, [], all null and all auto: byte-identical specs, input included', !bad, bad);
  bad = '';
  // the baseline's comp is one note a stroke: compStyle 'notes' (COMP_ARP_ORDER.md P9), and its chords close (BASS_VOICING_ORDER.md
  // P7), the overrides themselves left out of the input
  const unasked = (spec) => { delete spec.input.overrides.compStyle; delete spec.input.overrides.voicing; delete spec.input.overrides.bass; return spec; };
  for (const [name, run] of composeCases((L, T, o) => unasked(compose(L, T, { ...o, overrides: { ...o.overrides, compStyle: 'notes', voicing: 'close', bass: { density: 'sparse', lock: 'free' } }, progression: Array(8).fill(null) })))) if (sha(normSpec(run())) !== COMPOSE_HASHES[name]) bad = name;
  check(`the e3909e1 baseline (settle-baseline.mjs, ${Object.keys(COMPOSE_HASHES).length} cases) with an all-null progression`, !bad, bad);
}

console.log('\n— targeted');
const SMALL = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 6], [[19, 17, 16, 15], 6], [[119, 42, 15, 8], 8], [[41, 42, 43], 8], [[768, 769], 8], [[97, 103, 37], 5]];
{
  let bad = '', settled = 0, total = 0, fallbacks = 0, mods = 0;
  for (const [L, T] of SMALL) for (const seed of [1, 7]) {
    const auto = compose(L, T, { seed }), N = auto.knobs.bars, rc = rootCandidates(L).candidates;
    // a progression through the most present clusters, a different one a bar
    const byPresence = [...rc].sort((a, b) => b.presence - a.presence), asked = Array.from({ length: N }, (_, b) => byPresence[(b * 3 + seed) % byPresence.length].ratio);
    const s = compose(L, T, { seed, progression: asked });
    total++;
    const why = auditTargets(s, asked) || audit(s);
    if (why) bad = `${L.join(':')} seed ${seed}: ${why}`;
    if (s.stats.settle.rounds > 0) settled++;
    fallbacks += s.chords.filter((c) => c.fallback).length; mods += s.modulations.length;
    if (s.knobs.leader !== 'progression' || !s.decisions.some((d) => d.what === 'progression' && d.value.length === N) || JSON.stringify(s.input.progression) !== JSON.stringify(asked)) bad = `${L.join(':')}: leader, decision or input`;
    if (JSON.stringify(compose(L, T, { seed, progression: asked })) !== JSON.stringify(s)) bad = `${L.join(':')}: not deterministic`;
  }
  check(`${total} targeted composes: every asked root kept after the settle passes (${settled} ran rounds), every quality supported or a named fallback (${fallbacks}), every note an onset of the row (${mods} retunes)`, !bad && settled === total, bad);
  // a sweep over the shared rhythm set, a quarter of it, two bars pinned
  bad = ''; let n = 0;
  for (const L of RHYTHMS.filter((_, i) => i % 4 === 0)) {
    const auto = compose(L, 6, { overrides: { table: 'lean' } });
    if (auto.refused) continue;
    const rc = rootCandidates(L).candidates, asked = Array.from({ length: auto.knobs.bars }, (_, b) => (b % 2 ? null : rc[(b + 1) % rc.length].ratio));
    const s = compose(L, 6, { progression: asked });
    n++;
    const why = auditTargets(s, asked) || audit(s);
    if (why) { bad = `${L.join(':')}: ${why}`; break; }
  }
  check(`${n} rhythms of the shared set, every other bar pinned: roots kept, qualities supported, notes onsets`, !bad, bad);
  // the worker carries the progression
  const w = await import('../core/compose-worker.js'), asked = ['7/4', '1/1'];
  const got = w.answer({ id: 1, layers: [8, 7, 6, 5], cycleSeconds: 4, options: { seed: 2, progression: asked } });
  check('the worker\'s answer honours options.progression', got.ok && got.spec.chords.map((c) => c.rootTone).join() === asked.join() && got.spec.knobs.table === 'full');
}

console.log('\n— take from last compose');
{
  let bad = '';
  for (const [L, T] of SMALL) {
    const auto = compose(L, T), roots = auto.chords.map((c) => c.rootTone), s = compose(L, T, { progression: roots });
    if (s.chords.map((c) => c.rootTone).join() !== roots.join() || audit(s)) bad = `${L.join(':')}: ${s.chords.map((c) => c.rootTone)} for ${roots}`;
  }
  check(`${SMALL.length} rows: an auto compose's roots, fed back as the progression, come back the same`, !bad, bad);
}

console.log('\n— a root the bar cannot support');
{
  let tried = 0, fell = 0, bad = '';
  for (const [L, T] of [[[8, 7, 6, 5], 4], [[41, 42, 43], 8]]) {
    const rc = rootCandidates(L).candidates, N = compose(L, T).knobs.bars;
    for (let b = 0; b < N; b++) for (const c of rc) {
      const asked = Array(N).fill(null); asked[b] = c.ratio;
      let s;
      try { s = compose(L, T, { progression: asked, overrides: { settlePasses: 1 } }); } catch (e) { bad = `${L.join(':')} bar ${b + 1} ${c.ratio}: threw ${e.message}`; break; }
      tried++;
      const ch = s.chords[b];
      if (ch.fallback) {
        fell++;
        const d = s.decisions.find((x) => x.what === 'progression');
        if (!d.why.includes(`bar ${b + 1}: no chord quality`) || !d.value[b].includes('(fallback)')) bad = `${L.join(':')} bar ${b + 1}: the fallback not in the decisions`;
      }
      const why = auditTargets(s, asked) || audit(s);
      if (why) bad = `${L.join(':')} bar ${b + 1} ${c.ratio}: ${why}`;
    }
  }
  check(`every candidate on every bar of 8:7:6:5 and 41:42:43 (${tried} composes): no throw, the root kept; ${fell} fell back, each named in the decisions`, !bad && fell > 0, bad);
}

console.log('\n— an off-grid root modulates');
{
  const L = [41, 42, 43], T = 8, rc = rootCandidates(L).candidates, off = rc.find((c) => c.offGrid && Math.abs(c.dev) > 20);
  const N = compose(L, T).knobs.bars, asked = Array(N).fill(null); asked[0] = off.ratio;
  const s = compose(L, T, { progression: asked }), m = s.modulations.find((x) => x.bar === 0);
  check(`${off.ratio} (${off.dev.toFixed(1)}¢ off the grid) on bar 1: a retune there, by −its deviation`, !!m && near(m.rawCents, -off.dev, 1e-6) && near(s.chords[0].fundamentalRatio, 2 ** (-off.dev / 1200)), JSON.stringify(s.modulations));
  const inBar1 = s.parts.flatMap((p) => p.notes.filter((n) => n.bar === 0).map((n) => p.id));
  check(`it applies to every part sounding in bar 1 (${[...new Set(inBar1)].join(', ')}), each hz carrying the retune`, !audit(s) && inBar1.length > 0);
  const flat = compose(L, T, { progression: asked, overrides: { modulation: false } });
  check('modulation off: the root kept, flagged offGrid, no retune', flat.chords[0].rootTone === off.ratio && flat.chords[0].offGrid && flat.modulations.length === 0 && /offGrid/.test(flat.decisions.find((d) => d.what === 'progression').why));
}

console.log('\n— mixed, mismatched, malformed');
{
  const L = [119, 42, 15, 8], T = 8, auto = compose(L, T), N = auto.knobs.bars, rc = rootCandidates(L).candidates;
  const asked = Array.from({ length: N }, (_, b) => (b === 1 ? rc[2].ratio : null));
  const s = compose(L, T, { progression: asked });
  check(`mixed (bar 2 of ${N} pinned): leader "mixed", the pin kept, auto bars marked auto`, s.knobs.leader === 'mixed' && !auditTargets(s, asked) && !audit(s) && s.chords.filter((c) => c.targeted).length === 1);
  const d = s.decisions.find((x) => x.what === 'progression');
  check('the decisions list says which bars were targeted, the quality, and the auto ones', d.value[1].startsWith(`${rc[2].ratio} → ${s.chords[1].name}`) && d.value[0] === 'auto' && /bar 2 targeted/.test(d.why) && /auto bar/.test(d.why));

  const long = [...Array(N).fill(rc[1].ratio), rc[3].ratio, rc[4].ratio], sl = compose(L, T, { progression: long });
  check(`a progression longer than the ${N} bars: cut to them, and said`, sl.chords.every((c) => c.rootTone === rc[1].ratio) && /2 dropped/.test(sl.decisions.find((x) => x.what === 'progression').why));
  const four = compose(L, T, { progression: [rc[1].ratio, rc[2].ratio], overrides: { bars: 4 } });
  check('shorter (2 roots, 4 bars asked): bars 3–4 auto, and said', four.knobs.bars === 4 && four.chords[0].rootTone === rc[1].ratio && four.chords[1].rootTone === rc[2].ratio && !four.chords[2].targeted && !four.chords[3].targeted
    && /bars 3–4 auto/.test(four.decisions.find((x) => x.what === 'progression').why) && four.knobs.leader === 'mixed');
  const one = compose(L, T, { progression: [null, null, rc[1].ratio], overrides: { bars: 2 } });
  check('every pin cut off: lead-led, the progression decision all auto, saying why', one.knobs.leader === 'lead' && one.decisions.find((x) => x.what === 'progression').value.every((v) => v === 'auto') && one.chords.every((c) => !c.targeted));
  const stranger = compose(L, T, { progression: ['13/11', rc[1].ratio] });
  check('a ratio not of the row: that bar auto, and said', !stranger.chords[0].targeted && stranger.chords[1].rootTone === rc[1].ratio && /13\/11 is not a tone of this row/.test(stranger.decisions.find((x) => x.what === 'progression').why));
  check('{ ratio } entries read as ratios', compose(L, T, { progression: [{ ratio: rc[1].ratio }] }).chords[0].rootTone === rc[1].ratio);
  check('malformed input throws: not a list, or an entry not a ratio', throws(() => compose(L, T, { progression: '3/2' }), /progression must be a list/) && throws(() => compose(L, T, { progression: [3] }), /a root is a ratio/));
  const r = readProgression(['1/1', null], buildRow(L), 3);
  check('readProgression: pads, keeps what was asked', r.targeted && r.roots.length === 3 && r.roots[1] === null && r.roots[2] === null && r.asked.join() === '1/1,');
}

console.log('\n— timing: the 16,359-onset row');
{
  const L = [4099, 4093, 4091, 4079], T = 16, best = (f) => { let m = Infinity, out; for (let i = 0; i < 2; i++) { const t0 = performance.now(); out = f(); m = Math.min(m, performance.now() - t0); } return [m, out]; };
  const [ta, auto] = best(() => compose(L, T)), roots = auto.chords.map((c) => c.rootTone);
  const [tt, all] = best(() => compose(L, T, { progression: roots }));
  const [tm] = best(() => compose(L, T, { progression: roots.map((x, i) => (i % 2 ? null : x)) }));
  check(`lean: auto ${ta.toFixed(0)} ms, targeted ${tt.toFixed(0)} ms, mixed ${tm.toFixed(0)} ms — targeted no slower (the first lead skipped)`, tt <= ta * 1.1 + 30 && all.chords.map((c) => c.rootTone).join() === roots.join());
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
