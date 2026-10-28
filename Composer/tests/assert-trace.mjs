// assert-trace.mjs — Composer/core/trace.js: the compose trace and its pacing helper. Exit non-zero on any mismatch.
//   • off is today's spec: the e3909e1 baseline still holds with `trace: false`, and with the trace on once it is taken off
//   • the trace observes, never steers: on, the spec without `trace` is byte-identical to off (rows, seeds, overrides,
//     progressions, drum modes, the full table)
//   • every onset ref resolves to a real onset of the row (tick, ratio, cents, layers, strikes); every line id to a line;
//     the trace is plain JSON
//   • event order follows the pipeline, the settle rounds counted as the spec counts them; the picks agree with the spec
//   • the targeted path (pinned bars, fallbacks, skipped pass 1) and the drums (mode, downbeat layer, hits) are traced
//   • size and time on the 16,359-onset row; rankRoots' first is defaultRoot's pick
//   • traceTimeline: monotonic, every event in exactly one step, every beat present, 4–8 s at pace 1, compressible, pure
//   • the module worker passes the trace through when asked
//   node Composer/tests/assert-trace.mjs
import { buildRow } from '../core/row.js';
import { defaultRoot, rankRoots } from '../core/frame.js';
import { compose } from '../core/compose.js';
import { traceTimeline, createTrace, TRACE_CAPS, COMPOSER_TRACE_VERSION } from '../core/trace.js';
import { CHORD_QUALITIES } from '../core/harmony.js';
import { MAX_MISSING } from '../core/progression.js';
import { composeCases, normSpec, sha, COMPOSE_HASHES } from './settle-baseline.mjs';
import { RHYTHMS } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const without = (spec) => { const { trace, ...rest } = spec; return rest; };
const LAYER = 'ABCD';
const BIG = [4099, 4093, 4091, 4079];

console.log('Composer trace');

// ── off is today's spec ──
console.log('\n— off: the spec as it was');
{
  let bad = '';
  // the baseline's comp is one note a stroke: compStyle 'notes' (COMP_ARP_ORDER.md P9), the override itself left out of the input
  const notes = (o) => ({ ...o, overrides: { ...o.overrides, compStyle: 'notes' } }), unasked = (spec) => { delete spec.input.overrides.compStyle; return spec; };
  for (const [name, run] of composeCases((L, T, o) => unasked(compose(L, T, { ...notes(o), trace: false })))) if (sha(normSpec(run())) !== COMPOSE_HASHES[name]) { bad = name; break; }
  check(`the e3909e1 baseline (${Object.keys(COMPOSE_HASHES).length} cases) with trace: false`, !bad, bad);
  bad = '';
  for (const [name, run] of composeCases((L, T, o) => unasked(without(compose(L, T, { ...notes(o), trace: true }))))) if (sha(normSpec(run())) !== COMPOSE_HASHES[name]) { bad = name; break; }
  check('… and with the trace on, once spec.trace is taken off', !bad, bad);
  const a = compose([8, 7, 6, 5], 4), b = compose([8, 7, 6, 5], 4, { trace: false });
  check('no `trace` key when off; the input never records it', !('trace' in a) && !('trace' in b) && JSON.stringify(a) === JSON.stringify(b) && !('trace' in compose([8, 7, 6, 5], 4, { trace: true }).input));
}

// ── the cases every other check walks ──
const CASES = [];
for (const L of RHYTHMS) for (const seed of [1, 7]) CASES.push({ name: `${L.join(':')} seed ${seed}`, L, T: 4 + (L.length % 3) * 2, o: { seed } });
CASES.push({ name: '768:769 full', L: [768, 769], T: 8, o: { worker: true } });
CASES.push({ name: '41:42:43 full', L: [41, 42, 43], T: 8, o: { worker: true } });
CASES.push({ name: '8:7:6:5 exact, settle 0', L: [8, 7, 6, 5], T: 4, o: { overrides: { presence: 'exact', settlePasses: 0 } } });
CASES.push({ name: '1597:987:610:377 8 bars', L: [1597, 987, 610, 377], T: 8, o: { overrides: { bars: 8 } } });
CASES.push({ name: '768:769 8x8 even mod off', L: [768, 769], T: 8, o: { overrides: { bars: 8, slotsPerBar: 8, anchors: 'even', modulation: false } } });
CASES.push({ name: '119:42:15:8 root, phase, comp asked', L: [119, 42, 15, 8], T: 8, o: { overrides: { root: '3/2', phase: [1, 7], compStyle: 'notes', compLayer: 'B' } } });
CASES.push({ name: '119:42:15:8 clave asked, fill', L: [119, 42, 15, 8], T: 8, o: { overrides: { clave: '8:x..x..x.', compRelation: 'fill' } } });
CASES.push({ name: '41:42:43 settle 1', L: [41, 42, 43], T: 8, o: { overrides: { settlePasses: 1 } } });
for (const mode of ['with', 'against', 'partition', 'bossa']) CASES.push({ name: `11:9:7:5 drums ${mode}`, L: [11, 9, 7, 5], T: 6, o: { drums: { mode } } });
CASES.push({ name: '8:7:6:5 no drums', L: [8, 7, 6, 5], T: 4, o: { drums: false } });
CASES.push({ name: '41:42:43 drums per bar', L: [41, 42, 43], T: 8, o: { drums: { perBar: { 1: 'partition', 2: 'against' } } } });
// targeted progressions: every bar pinned, mixed, a fallback, a retune
const autoRoots = (L, T) => compose(L, T).chords.map((c) => c.rootTone);
CASES.push({ name: '1597:987:610:377 every bar pinned', L: [1597, 987, 610, 377], T: 8, o: { progression: autoRoots([1597, 987, 610, 377], 8) }, pinned: 'all' });
{ const r = autoRoots([41, 42, 43], 8); CASES.push({ name: '41:42:43 mixed', L: [41, 42, 43], T: 8, o: { progression: r.map((x, i) => (i % 2 ? null : x)) }, pinned: 'mixed' }); }
CASES.push({ name: '8:7:6:5 a fallback', L: [8, 7, 6, 5], T: 4, o: { progression: ['3/2', null] }, pinned: 'mixed' });
CASES.push({ name: '41:42:43 a retune on bar 1', L: [41, 42, 43], T: 8, o: { progression: ['21/11'] }, pinned: 'mixed' });

const traced = [];
console.log('\n— the trace observes, never steers');
{
  let bad = '', n = 0;
  for (const c of CASES) {
    const off = compose(c.L, c.T, c.o), on = compose(c.L, c.T, { ...c.o, trace: true });
    if (off.refused) { if (JSON.stringify(without(on)) !== JSON.stringify(off) || on.trace?.events?.[0]?.kind !== 'refused') bad ||= `${c.name}: refusal`; continue; }
    n++;
    if (JSON.stringify(without(on)) !== JSON.stringify(off)) { bad ||= `${c.name}: the spec moved`; continue; }
    traced.push({ ...c, spec: on, trace: on.trace });
  }
  check(`${n} composes (${CASES.length - n} refusals): the spec without its trace byte-identical to off, parts and all; a refusal's trace says why`, !bad && n > 40, bad);
  const r = compose([3, 2], 4, { trace: true });
  check('a refusal carries a one-event trace', r.refused && r.trace.version === COMPOSER_TRACE_VERSION && r.trace.events.length === 1 && r.trace.events[0].reason === 'tooFewTones');
}

/** every value plain JSON: null, boolean, finite number, string, array, plain object */
function plainJson(x, path = 'trace') {
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return '';
  if (typeof x === 'number') return Number.isFinite(x) ? '' : `${path} is ${x}`;
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { const b = plainJson(x[i], `${path}[${i}]`); if (b) return b; } return ''; }
  if (typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype) { for (const [k, v] of Object.entries(x)) { if (v === undefined) return `${path}.${k} is undefined`; const b = plainJson(v, `${path}.${k}`); if (b) return b; } return ''; }
  return `${path} is not plain JSON (${Object.prototype.toString.call(x)})`;
}
/** every onset ref and line id in the trace against the row → '' or what broke */
function refsOf(trace, spec) {
  const row = buildRow(spec.input.layers);
  for (const [k, v] of Object.entries(trace.nodes)) {
    const i = Number(k);
    if (!(Number.isInteger(i) && i >= 0 && i < row.n)) return `node ${k} is not an onset index`;
    const owners = [...v.layers].reduce((m, ch) => m | (1 << LAYER.indexOf(ch)), 0);
    if (row.tick[i] !== v.tick || row.tones[row.tone[i]] !== v.ratio || Math.abs(row.toneCents[row.tone[i]] - v.cents) > 5e-4 || row.owners[i] !== owners || row.strikes[i] !== v.strikes) return `node ${i} is not the row's`;
  }
  let broke = '';
  const walk = (x, path) => {
    if (broke || x == null || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach((y, j) => walk(y, `${path}[${j}]`)); return; }
    for (const [k, v] of Object.entries(x)) {
      if (k === 'node' && v != null && !(v in trace.nodes)) { broke = `${path}.node ${v} is not in the nodes table`; return; }
      if (k === 'node' && v != null && 'tick' in x && path !== 'nodes' && Number.isFinite(x.tick) && Number.isInteger(x.tick) && trace.nodes[v].tick !== x.tick && !('reach' in x)) { broke = `${path}: tick ${x.tick} is not node ${v}'s`; return; }
      if (k === 'samples') for (const s of v) if (!(s in trace.nodes)) { broke = `${path}.samples ${s}`; return; }
      walk(v, `${path}.${k}`);
    }
  };
  walk(trace.events, 'events'); walk(trace.lines, 'lines');
  if (broke) return broke;
  const ids = [];
  for (const ev of trace.events) {
    if (ev.kind === 'lead') { if (ev.mined) ids.push(ev.mined.id); for (const r of ev.runnersUp) ids.push(r.id); if (ev.held) ids.push(ev.held.id); if (ev.keptId) ids.push(ev.keptId); }
    if (ev.kind === 'harmony') ids.push(...ev.lead.phrases.filter(Boolean));
    if (ev.kind === 'part' && ev.part === 'bass') ids.push(...ev.bars.map((b) => b.line).filter(Boolean));
    if (ev.kind === 'part' && ev.part === 'inner') ids.push(...ev.phrases.map((p) => p.line).filter(Boolean));
  }
  for (const id of ids) if (!trace.lines[id]) return `line ${id} is not in the lines table`;
  for (const l of Object.values(trace.lines)) for (const n of l.notes) if (n.node == null) return `line ${l.id}: a note without its onset`;
  // the part events are the spec's notes, the drums the spec's strokes, each on its onset
  for (const ev of trace.events.filter((e) => e.kind === 'part')) {
    const p = spec.parts.find((x) => x.id === ev.part);
    if (ev.count !== p.notes.length || ev.notes.length !== Math.min(p.notes.length, TRACE_CAPS.partNotes) || ev.notes.some((n, j) => n.node !== p.notes[j].node || n.bar !== p.notes[j].bar || n.octave !== p.notes[j].octave)) return `part ${ev.part}: not the spec's notes`;
  }
  const d = trace.events.find((e) => e.kind === 'drums');
  if (d && (d.count !== spec.drums.hits.length || d.hits.some((h, j) => h.node == null || h.tick !== spec.drums.hits[j].tick || h.voice !== spec.drums.hits[j].voice))) return 'drums: a stroke not the spec\'s, or off the onsets';
  return '';
}

console.log('\n— refs: every onset and line the trace names is real');
{
  let bad = '', nodes = 0, lines = 0;
  for (const t of traced) {
    const b = plainJson(t.trace) || refsOf(t.trace, t.spec);
    if (b) { bad = `${t.name}: ${b}`; break; }
    nodes += t.trace.stats.nodes; lines += t.trace.stats.lines;
  }
  check(`${traced.length} traces: plain JSON; ${nodes} onset refs, each the row's tick, ratio, cents, layers and strikes; ${lines} lines, every id resolved; parts and drums the spec's own`, !bad, bad);
}

/** the pipeline's grammar → '' or where the order broke */
function orderOf(trace, spec) {
  const ev = trace.events, N = spec.knobs.bars, S = spec.knobs.slotsPerBar, phrases = Math.ceil(N / Math.max(1, Math.min(N, Math.floor(32 / S))));
  let i = 0;
  const take = (kind, test = () => true) => (ev[i] && ev[i].kind === kind && test(ev[i]) ? ev[i++] : null);
  for (const k of ['row', 'root', 'meter', 'phase', 'cells']) if (!take(k)) return `expected ${k} at ${i}, got ${ev[i]?.kind}`;
  const prog = take('progression');
  if (!!spec.input.progression !== !!prog) return 'a progression event without a progression, or none with one';
  const leads = (stage, round) => { for (let p = 0; p < phrases; p++) if (!take('lead', (e) => e.stage === stage && e.round === round && e.phrase === p)) return `lead ${stage} ${round} phrase ${p} at ${i}`; return ''; };
  const chords = (round) => { for (let b = 0; b < N; b++) if (!take('chord', (e) => e.round === round && e.bar === b)) return `chord round ${round} bar ${b} at ${i}`; return ''; };
  const e1 = leads('pass1', 0) || chords(0) || leads('pass2', 0); if (e1) return e1;
  const st = spec.stats.settle;
  let rounds = 0;
  for (;;) {
    const s = take('settle', (e) => e.round === rounds + 1);
    if (!s) break;
    rounds++;
    const e2 = chords(rounds); if (e2) return e2;
    if (s.changedBars.length !== st.changedBarsPerRound[rounds - 1]) return `settle ${rounds}: ${s.changedBars.length} bars changed, the spec says ${st.changedBarsPerRound[rounds - 1]}`;
    const changed = trace.events.filter((e) => e.kind === 'chord' && e.round === rounds && e.changed).map((e) => e.bar);
    if (JSON.stringify(changed) !== JSON.stringify(s.changedBars)) return `settle ${rounds}: the chord events' changed flags are not its changed bars`;
    if (s.outcome === 'changed') { const e3 = leads('settle', rounds); if (e3) return e3; }
    else if (!['converged', 'repeats'].includes(s.outcome) || rounds !== st.rounds) return `settle ${rounds}: outcome ${s.outcome} before the last round`;
  }
  if (rounds !== st.rounds) return `${rounds} settle rounds traced, the spec counts ${st.rounds}`;
  const h = take('harmony'); if (!h) return `harmony at ${i}`;
  if (h.chosenRound !== st.chosenRound || h.rounds !== st.rounds) return 'harmony: not the spec\'s settle';
  for (const p of ['lead', 'chords', 'comp', 'bass', 'inner']) if (!take('part', (e) => e.part === p)) return `part ${p} at ${i}`;
  if (!!spec.drums !== !!take('drums')) return 'drums event and the spec disagree';
  if (!take('done') || i !== ev.length) return `done, and nothing after it (${i} of ${ev.length})`;
  return '';
}
/** the trace's picks against the spec → '' or what disagreed */
function picksOf(trace, spec) {
  const by = (k) => trace.events.filter((e) => e.kind === k), one = (k) => by(k)[0], row = buildRow(spec.input.layers);
  const root = one('root'), meter = one('meter'), phase = one('phase'), h = one('harmony');
  if (row.tones[root.pick] !== spec.knobs.root || !root.candidates.some((c) => c.tone === root.pick)) return 'root';
  if (spec.input.overrides.root == null && root.candidates[0].tone !== root.pick) return 'root: the pick is not the first candidate';
  if (meter.bars !== spec.knobs.bars || meter.slotsPerBar !== spec.knobs.slotsPerBar) return 'meter';
  if (JSON.stringify(phase.phase) !== JSON.stringify(spec.knobs.phase) || JSON.stringify(trace.phase) !== JSON.stringify(spec.knobs.phase)) return 'phase';
  if (!spec.input.overrides.phase && (phase.node == null || phase.candidates[phase.pick].tick !== phase.tick)) return 'phase: the downbeat onset';
  // the chosen round's chords are the spec's, and its kept lead is the spec's lead
  const chosen = by('chord').filter((e) => e.round === h.chosenRound);
  if (chosen.length !== spec.knobs.bars || chosen.some((e, b) => e.pick.root.ratio !== spec.chords[b].rootTone || e.pick.quality !== spec.chords[b].quality || e.pick.name !== spec.chords[b].name)) return `the chosen round's chords (round ${h.chosenRound})`;
  if (h.chords.some((c, b) => c.name !== spec.chords[b].name)) return 'harmony chords';
  const keptBy = by('lead').filter((e) => (h.chosenRound === 0 ? e.stage === 'pass2' : e.stage === 'settle' && e.round === h.chosenRound)).map((e) => e.keptId);
  if (JSON.stringify(keptBy) !== JSON.stringify(h.lead.phrases)) return 'the chosen round\'s kept leads are not the harmony\'s';
  const leadNodes = h.lead.phrases.flatMap((id) => (id ? trace.lines[id].notes.map((n) => n.node) : [])).sort((a, b) => a - b);
  if (JSON.stringify(leadNodes) !== JSON.stringify(spec.parts[0].notes.map((n) => n.node).sort((a, b) => a - b))) return 'the kept lines are not the lead part';
  for (const e of by('lead')) {
    if (e.skipped) continue;
    if (e.runnersUp.length > TRACE_CAPS.runnersUp || e.runnersUp.length !== Math.min(TRACE_CAPS.runnersUp, Math.max(0, e.tested - 1))) return 'runners-up: not the capped rest of the ranking';
    if (e.runnersUp.some((r) => r.perNote < e.mined.perNote - 1e-9)) return 'a runner-up cheaper than the chosen line';
  }
  for (const e of by('chord')) {
    if (e.candidates.length > TRACE_CAPS.chordCandidates) return 'chord candidates over the cap';
    if (!e.pinned && !e.empty && e.pickIndex !== 0) return `bar ${e.bar} round ${e.round}: the pick is not the first candidate`;
    if (e.tested < e.candidates.length) return 'tested < candidates';
  }
  const mods = new Set(spec.modulations.map((m) => m.bar)), retunes = new Set(chosen.filter((e) => e.retune).map((e) => e.bar));
  if (JSON.stringify([...mods]) !== JSON.stringify([...retunes])) return 'retunes: not the spec\'s modulations';
  const comp = by('part').find((e) => e.part === 'comp');
  // the comp in chords (Amendment 1): the clave, its partner and the alternates; in notes, the layer
  if (spec.clave) {
    if (comp.clave.id !== spec.clave.id || comp.clave.relation !== spec.clave.relation || comp.partner.pattern !== spec.clave.partner.pattern || !comp.alternates.length || comp.candidates !== comp.alternates && JSON.stringify(comp.candidates) !== JSON.stringify(comp.alternates)) return 'comp clave';
  } else if (comp.layer !== spec.stats.compLayer.layer) return 'comp layer';
  return '';
}

console.log('\n— order: the pipeline, the settle rounds counted');
{
  let bad = '', rounds = 0, moved = 0, oscillated = 0;
  for (const t of traced) {
    const b = orderOf(t.trace, t.spec) || picksOf(t.trace, t.spec);
    if (b) { bad = `${t.name}: ${b}`; break; }
    rounds += t.spec.stats.settle.rounds; if (t.spec.stats.settle.changedBarsPerRound[0] > 0) moved++; if (t.spec.stats.settle.oscillated) oscillated++;
  }
  check(`${traced.length} traces in pipeline order (row … done), ${rounds} settle rounds counted as the spec counts them (${moved} composes with chords moved, ${oscillated} oscillating); every pick the spec's`, !bad && moved > 0, bad);
}

{
  // no real row oscillates (DESIGN_NOTES "Settle passes"), so the recorder is shown a made-up run: A → B → A
  const rec = createTrace(buildRow([8, 7, 6, 5]), { cycleSeconds: 4 });
  rec.settle(1); rec.settle(2);
  rec.settled({ rounds: [{ round: 1, changedBars: [0] }, { round: 2, changedBars: [0], repeats: 0 }] }, { rounds: [{ round: 1, phrases: [{ kept: 'newer' }] }, { round: 2, phrases: [] }] });
  const ev = rec.finish().events, tl = traceTimeline({ events: ev });
  check('an oscillating run: the round that repeats an earlier one is traced as `repeats`, naming it; the timeline gives it its own beat',
    ev[0].outcome === 'changed' && ev[0].leadChangedPhrases.join() === '0' && ev[1].outcome === 'repeats' && ev[1].repeats === 0 && tl.groups.length === 2 && tl.steps[1].label === 'settle 2: the chords repeat round 0');
}

console.log('\n— the targeted path and the drums');
{
  const tc = traced.filter((t) => t.pinned);
  let bad = '';
  for (const t of tc) {
    const ev = t.trace.events, prog = ev.find((e) => e.kind === 'progression');
    const pins = t.spec.chords.map((c) => !!c.targeted);
    if (!prog || prog.bars.some((b, k) => b.auto === pins[k])) { bad = `${t.name}: the progression event's pinned bars`; break; }
    if (ev.filter((e) => e.kind === 'chord').some((e) => e.pinned !== pins[e.bar] || (e.pinned && !('fallback' in e && 'sounded' in e && Array.isArray(e.unsupported))))) { bad = `${t.name}: chord events' pins`; break; }
    const skipped = ev.filter((e) => e.kind === 'lead' && e.skipped === 'pinned').length;
    if (t.pinned === 'all' ? skipped === 0 || ev.some((e) => e.kind === 'lead' && e.stage === 'pass1' && !e.skipped) : skipped !== 0) { bad = `${t.name}: pass 1 skipped ${skipped}`; break; }
  }
  check(`${tc.length} targeted composes: the progression event names the pinned bars; pinned chord events carry fallback, sounded and the unsupported qualities; pass 1 skipped exactly for fully pinned phrases`, !bad && tc.length === 4, bad);
  const fb = traced.find((t) => t.name === '8:7:6:5 a fallback').trace.events.find((e) => e.kind === 'chord' && e.pinned && e.round === 0);
  const catalog = new Set(CHORD_QUALITIES.map((q) => q.id));
  check(`a fallback is traced with what was tested: ${fb?.pick.name}, ${fb?.unsupported.length} qualities unsupported, each with the classes it lacks`, fb && fb.fallback && fb.unsupported.filter((u) => catalog.has(u.quality)).length === CHORD_QUALITIES.length
    && fb.unsupported.every((u) => u.missing.length > (catalog.has(u.quality) ? MAX_MISSING : 0)));
  const rt = traced.find((t) => t.name === '41:42:43 a retune on bar 1').trace.events.find((e) => e.kind === 'chord' && e.round === 0 && e.bar === 0);
  check(`a pinned off-grid root's retune is traced (${rt?.retune?.cents}¢)`, rt && rt.pinned && rt.retune && Math.abs(rt.retune.cents) > 15);

  bad = '';
  const dc = traced.filter((t) => t.spec.drums);
  for (const t of dc) {
    const d = t.trace.events.find((e) => e.kind === 'drums'), owners = t.spec.input.layers.flatMap((v, i) => (v > 0 && (t.spec.knobs.phase[0] * v) % t.spec.knobs.phase[1] === 0 ? [LAYER[i]] : []));
    if (!d || d.mode !== t.spec.drums.mode || JSON.stringify(d.downbeatLayers.map((x) => x.layer)) !== JSON.stringify(owners)) { bad = `${t.name}: mode or downbeat layers`; break; }
    if (t.spec.drums.partition && (!d.partition || !owners.includes(d.partition.layer))) { bad = `${t.name}: the partition layer`; break; }
    if (JSON.stringify(d.bars.map((b) => b.mode)) !== JSON.stringify(t.spec.drums.bars.map((b) => b.mode))) { bad = `${t.name}: bar modes`; break; }
  }
  const part = traced.find((t) => t.name === '11:9:7:5 drums partition').trace.events.find((e) => e.kind === 'drums');
  check(`${dc.length} drummed traces: the mode, each bar's mode, the layers striking the downbeat, the partition layer, every stroke on its onset; none with drums: false`, !bad && part.partition && !traced.find((t) => t.name === '8:7:6:5 no drums').trace.events.some((e) => e.kind === 'drums'), bad);
}

console.log('\n— rankRoots: its first is defaultRoot\'s pick');
{
  let bad = '', n = 0;
  for (const L of RHYTHMS) {
    const row = buildRow(L);
    if (row.tones.length < 3) continue;
    for (const presence of ['cluster', 'exact']) for (const e of [15, 35]) {
      const r = rankRoots(row, e, { presence }), d = defaultRoot(row, e, { presence });
      n++;
      if (r.ranked[0]?.tone !== d || r.ranked.length > 8) { bad = `${L.join(':')} ${presence} ±${e}`; break; }
    }
  }
  check(`${n} rows × presence × frame: rankRoots' first candidate is defaultRoot`, !bad, bad);
}

console.log('\n— traceTimeline');
{
  let bad = '', lo = Infinity, hi = 0;
  for (const t of traced) {
    const before = JSON.stringify(t.trace), tl = traceTimeline(t.trace);
    if (JSON.stringify(t.trace) !== before) { bad = `${t.name}: it changed the trace`; break; }
    if (JSON.stringify(traceTimeline(t.trace)) !== JSON.stringify(tl)) { bad = `${t.name}: not deterministic`; break; }
    const seen = new Array(t.trace.events.length).fill(0);
    let at = 0;
    for (const s of tl.steps) {
      if (!(s.duration > 0) || Math.abs(s.start - at) > 1e-5 || typeof s.label !== 'string' || !s.label) { bad = `${t.name}: step ${s.step} not consecutive`; break; }
      at = s.start + s.duration;
      for (const i of s.events) seen[i]++;
    }
    if (bad) break;
    if (seen.some((x) => x !== 1)) { bad = `${t.name}: an event in ${Math.min(...seen)}..${Math.max(...seen)} steps`; break; }
    const groups = tl.groups.map((g) => g.group), want = ['row', 'root', 'meter', 'cells', 'line', 'chords', 'line2', 'harmony', 'parts', 'done', ...(t.spec.drums ? ['drums'] : []), ...(t.spec.input.progression ? ['progression'] : [])];
    if (want.some((g) => !groups.includes(g)) || groups.filter((g) => g === 'settle').length !== t.spec.stats.settle.rounds) { bad = `${t.name}: beats ${groups.join(' ')}`; break; }
    if (tl.groups.some((g, j) => j && g.start < tl.groups[j - 1].start)) { bad = `${t.name}: beats out of order`; break; }
    lo = Math.min(lo, tl.seconds); hi = Math.max(hi, tl.seconds);
  }
  check(`${traced.length} timelines: consecutive steps, every event in exactly one, every beat (settle 1..n as the rounds), pure — ${lo.toFixed(2)}–${hi.toFixed(2)} s at pace 1 (target 4–8)`, !bad && lo >= 4 && hi <= 8, bad);
  const tr = traced.find((t) => t.name.startsWith('1597')).trace, one = traceTimeline(tr), two = traceTimeline(tr, { pace: 2 }), five = traceTimeline(tr, { seconds: 5 });
  check(`compressible: pace 2 halves it (${one.seconds} → ${two.seconds} s), seconds: 5 fits it to 5 s`, Math.abs(two.seconds - one.seconds / 2) < 1e-5 && Math.abs(five.seconds - 5) < 1e-5 && five.steps.every((s, j) => Math.abs(s.duration - one.steps[j].duration * 5 / one.seconds) < 1e-5));
  let threw = 0; for (const f of [() => traceTimeline(null), () => traceTimeline(tr, { pace: 0 })]) { try { f(); } catch { threw++; } }
  check('no trace, or a pace that is not positive, throws', threw === 2);
}

console.log('\n— the module worker');
{
  globalThis.self = { postMessage: () => {} };
  const w = await import('../core/compose-worker.js');
  delete globalThis.self;
  const got = w.answer({ id: 3, layers: [11, 9, 7, 5], cycleSeconds: 6, options: { seed: 2, trace: true } }).spec, direct = compose([11, 9, 7, 5], 6, { seed: 2, worker: true, trace: true });
  const plain = w.answer({ id: 4, layers: [11, 9, 7, 5], cycleSeconds: 6, options: { seed: 2 } }).spec;
  const cloned = structuredClone(got.trace);
  check('asked, the worker sends the trace (the full table\'s), and it survives a structured clone; not asked, none', JSON.stringify(got.trace) === JSON.stringify(direct.trace) && JSON.stringify(cloned) === JSON.stringify(got.trace) && !('trace' in plain) && JSON.stringify(without(got)) === JSON.stringify(plain));
}

console.log('\n— size and time on the 16,359-onset row');
{
  const best = (f, n = 3) => { let m = Infinity, v; for (let i = 0; i < n; i++) { const t = performance.now(); v = f(); m = Math.min(m, performance.now() - t); } return [m, v]; };
  for (const [label, o] of [['lean', {}], ['full', { worker: true }]]) {
    const n = label === 'lean' ? 4 : 2;
    let off = Infinity, on = Infinity, spec;
    for (let i = 0; i < n; i++) {   // interleaved, so a slow patch of the machine hits both
      off = Math.min(off, best(() => compose(BIG, 16, o), 1)[0]);
      const [t, s] = best(() => compose(BIG, 16, { ...o, trace: true }), 1); on = Math.min(on, t); spec = s;
    }
    const bytes = JSON.stringify(spec.trace).length, tl = traceTimeline(spec.trace);
    check(`${label}: trace ${(bytes / 1024).toFixed(0)} KB (${spec.trace.stats.events} events, ${spec.trace.stats.nodes} onsets, ${spec.trace.stats.lines} lines; under 1 MB), compose ${off.toFixed(0)} ms off, ${on.toFixed(0)} ms on (${((on / off - 1) * 100).toFixed(1)} %, within +15 %), timeline ${tl.seconds} s`,
      bytes < 1024 * 1024 && on <= off * 1.15 + 10 && !refsOf(spec.trace, spec) && !orderOf(spec.trace, spec));
  }
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
