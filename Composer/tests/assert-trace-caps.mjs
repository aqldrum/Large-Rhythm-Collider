// assert-trace-caps.mjs — STEP 4a, 1: the trace's caps option (`compose(..., { trace: { caps } })`, core/trace.js
// ALTERNATE_CAPS / traceCapsOf / capTrace) and the show reading it cut back (page/trace-frames.js):
//   • `trace: true` is exactly the trace it was (TRACE_CAPS: 6 chord candidates, 3 runners-up); `trace: {}` keeps a
//     bar's 12 best chords and a phrase's 8 runner-up lines; the spec without its trace is the same all three ways
//   • the longer lists extend the shorter ones (a prefix), and `capTrace` cuts a 12/8 trace back to the 6/3 trace
//     byte for byte (events, node and line tables, caps, stats)
//   • the main page's show (buildScene / frameAt) is the same frame for frame on either trace
//   • caps given over the defaults, and bad caps refused
//   • measured on the 16,359-onset row: the trace's JSON and Compose's time, off / show caps / alternate caps
//   node Composer/tests/assert-trace-caps.mjs
import { compose } from '../core/compose.js';
import { capTrace, traceCapsOf, TRACE_CAPS, ALTERNATE_CAPS } from '../core/trace.js';
import { answer } from '../core/compose-worker.js';
import { rootCandidates } from '../core/progression.js';
import { highlightsOf, plotOf } from '../page/plot-highlights.js';
import { buildScene, frameAt } from '../page/trace-frames.js';
import { siteRhythm } from './site-scripts.mjs';
import { RHYTHMS } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const strip = (spec) => { const { trace, ...plain } = spec; return plain; };

console.log('═══ COMPOSER — the trace caps option (step 4a) ═══');
check('ALTERNATE_CAPS: 12 chord candidates and 8 runners-up, the other caps as TRACE_CAPS (6 and 3)', ALTERNATE_CAPS.chordCandidates === 12 && ALTERNATE_CAPS.runnersUp === 8
  && TRACE_CAPS.chordCandidates === 6 && TRACE_CAPS.runnersUp === 3 && Object.keys(TRACE_CAPS).every((k) => ['chordCandidates', 'runnersUp'].includes(k) || ALTERNATE_CAPS[k] === TRACE_CAPS[k]));
check('traceCapsOf: true → TRACE_CAPS; {} → ALTERNATE_CAPS; { caps } over them', J(traceCapsOf(true)) === J(TRACE_CAPS) && J(traceCapsOf({})) === J(ALTERNATE_CAPS)
  && traceCapsOf({ caps: { runnersUp: 20 } }).runnersUp === 20 && traceCapsOf({ caps: { runnersUp: 20 } }).chordCandidates === 12);
let threw = 0;
for (const bad of [{ caps: { nope: 3 } }, { caps: { runnersUp: -1 } }, { caps: { chordCandidates: 2.5 } }]) { try { compose([8, 7, 6, 5], 4, { trace: bad }); } catch { threw++; } }
check('bad caps are refused (an unknown cap, a negative or fractional count)', threw === 3);

// ── the rhythms ──
const cases = [];
RHYTHMS.forEach((L, i) => { if (i % 3 === 0 || i < 8) cases.push({ L, T: 4 + (i % 4) * 2, seed: 1 + (i % 5) }); });
cases.push({ L: [19, 17, 16, 15], T: 6, seed: 3, progression: true }, { L: [41, 42, 43], T: 8, seed: 2, worker: true }, { L: [768, 769], T: 8, seed: 1, overrides: { modulation: false } });
let same = 0, prefix = 0, cut = 0, longer = 0, total = 0, sceneSame = 0, scenes = 0, refusals = 0;
const bad = [];
for (const c of cases) {
  const layers = [...c.L, 0, 0, 0, 0].slice(0, 4);
  let progression = null;
  if (c.progression) { const roots = rootCandidates(layers); if (Array.isArray(roots?.candidates)) progression = [roots.candidates[1]?.ratio ?? null, null, roots.candidates[0]?.ratio ?? null]; }
  const opts = { seed: c.seed, worker: !!c.worker, overrides: c.overrides ?? {}, ...(progression ? { progression } : {}) };
  const off = compose(layers, c.T, opts), show = compose(layers, c.T, { ...opts, trace: true }), alt = compose(layers, c.T, { ...opts, trace: {} });
  total++;
  if (off.refused) { refusals++; if (J(strip(show)) === J(off) && J(strip(alt)) === J(off) && show.trace.events[0].kind === 'refused' && alt.trace.caps.runnersUp === 8) same++; else bad.push(`${c.L.join(':')}: refusal`); continue; }
  if (J(strip(show)) === J(off) && J(strip(alt)) === J(off)) same++; else bad.push(`${c.L.join(':')}: the spec moved`);
  // the longer lists extend the shorter ones
  const ev6 = show.trace.events, ev12 = alt.trace.events;
  let ok = ev6.length === ev12.length;
  for (let i = 0; ok && i < ev6.length; i++) {
    const a = ev6[i], b = ev12[i];
    if (a.kind !== b.kind) ok = false;
    else if (a.kind === 'chord') { ok = J(b.candidates.slice(0, a.candidates.length)) === J(a.candidates) && b.candidates.length <= 12 && (b.candidates.length === Math.min(12, b.tested) || a.empty); if (b.candidates.length > a.candidates.length) longer++; }
    else if (a.kind === 'lead') { ok = J(b.runnersUp.slice(0, a.runnersUp.length)) === J(a.runnersUp) && b.runnersUp.length === Math.min(8, Math.max(0, (b.tested ?? 0) - 1)); if (b.runnersUp.length > a.runnersUp.length) longer++; }
    else ok = J(a) === J(b);
  }
  if (ok) prefix++; else bad.push(`${c.L.join(':')}: not a prefix`);
  if (J(capTrace(alt.trace)) === J(show.trace) && capTrace(show.trace) === show.trace) cut++; else bad.push(`${c.L.join(':')}: capTrace is not the 6/3 trace`);
}
check(`${same}/${total} rhythms (${refusals} refused): the spec without its trace is the same with the trace off, true or { caps }`, same === total, bad.join('; '));
check(`${prefix}/${total - refusals}: the 12/8 lists extend the 6/3 lists (${longer} events longer), every other event the same`, prefix === total - refusals && longer > 0, bad.join('; '));
check(`${cut}/${total - refusals}: capTrace(the 12/8 trace) is the 6/3 trace byte for byte; a 6/3 trace comes back as it is`, cut === total - refusals, bad.join('; '));

// ── the show on the main page: the same frames on either trace ──
for (const site of [[8, 7, 6, 5], [41, 42, 43, 1], [19, 17, 16, 15]]) {
  const r = siteRhythm(site), plot = plotOf(r), layers = site.map((v) => (v > 1 ? v : 0)), T = 6;
  const show = compose(layers, T, { seed: 1, trace: true }), alt = compose(layers, T, { seed: 1, trace: {} });
  const final = highlightsOf({ spec: strip(show) }, plot);
  const a = buildScene({ trace: show.trace, plot, final }), b = buildScene({ trace: alt.trace, plot, final });
  scenes++;
  let ok = !!a && !!b && a.end === b.end && J(a.trace) === J(b.trace);
  for (let i = 0; ok && i <= 240; i++) { const t = (a.end * i) / 240; if (J(frameAt(a, t)) !== J(frameAt(b, t))) ok = false; }
  if (ok) sceneSame++;
}
check(`${sceneSame}/${scenes} rhythms: the main page's show is the same frame for frame (241 frames) on the 6/3 and the 12/8 trace`, sceneSame === scenes);

// ── through the worker: { caps } survives the message ──
const w = answer({ id: 1, layers: [8, 7, 6, 5], cycleSeconds: 4, options: { trace: { caps: { runnersUp: 5 } } } });
check('the worker passes { caps } through (runnersUp 5, chordCandidates 12)', w.ok && w.spec.trace.caps.runnersUp === 5 && w.spec.trace.caps.chordCandidates === 12);

// ── measured: the 16k row ──
{
  const L = [4099, 4093, 4091, 4079], T = 16, rows = [];
  for (const worker of [false, true]) {
    const time = (o) => { let best = Infinity, spec; for (let i = 0; i < 2; i++) { const t0 = performance.now(); spec = compose(L, T, { seed: 1, worker, ...o }); best = Math.min(best, performance.now() - t0); } return { best, spec }; };
    const off = time({}), show = time({ trace: true }), alt = time({ trace: {} });
    const kb = (s) => (J(s.trace).length / 1024).toFixed(0);
    rows.push(`${worker ? 'full' : 'lean'}: off ${off.best.toFixed(0)} ms · 6/3 ${show.best.toFixed(0)} ms, ${kb(show.spec)} KB, ${show.spec.trace.stats.nodes} nodes, ${show.spec.trace.stats.lines} lines · 12/8 ${alt.best.toFixed(0)} ms, ${kb(alt.spec)} KB, ${alt.spec.trace.stats.nodes} nodes, ${alt.spec.trace.stats.lines} lines`);
    if (worker) check(`16k row, full table: the 12/8 trace stays well under the 1 MB budget (${kb(alt.spec)} KB)`, J(alt.spec.trace).length < 400 * 1024);
  }
  console.log(`  · measured (best of 2): ${rows.join('\n  · measured (best of 2): ')}`);
}

console.log(PASS ? `\n✓✓✓ TRACE CAPS PASS (${checks} checks)` : `\n✗ TRACE CAPS FAILED`);
process.exit(PASS ? 0 : 1);
