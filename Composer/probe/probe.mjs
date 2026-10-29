// probe.mjs — what chunk-tunes' row and line mining cost on ONE LRC rhythm's tone row.
//
// The Overworld modules are used read-only, imported by absolute path (override with OVERWORLD_RUNTIME):
//   chunk-super-row.js  buildNormalizedRow([{ layers }]) — a one-rhythm row; slotCandidates
//   chunk-lines.js      bestFrames, buildLattice, pickLines, planLines → prepare/solve/describeLinePiece → mergeLines
//
// Usage:
//   node --expose-gc probe.mjs                         the built-in sweep (CASES below) → results-<date>.json
//   node --expose-gc probe.mjs cases.json              a JSON list of { name, group?, layers } instead
//   node --expose-gc probe.mjs --only a,b --out x.json only the named cases; another output file
//
// Isolation: every case runs in its own child process (so peak RSS is that case's own), and inside the child in a
// worker thread with a large stack and heap (so the Overworld kernel's `Math.max(...gaps)` survives past ~120k onsets,
// see FINDINGS.md). The child's main thread samples RSS every 10 ms for each stage's peak, and terminates the worker
// when a stage overruns its budget; later stages are then skipped. Stages:
//   build     buildNormalizedRow (with the rhythm kernel timed on its own)
//   slots     slotCandidates at P = 8, 16, 32, swing 0.18 (the slot-share window)
//   frame     bestFrames(row, 25)[0], the row's own frame
//   lattice   buildLattice at 2×8 and 4×8 (window sized in onsets, moments = 12)
//   pick      pickLines on the 4×8 lattice, one run (lead 'mid' band, arch contour)
//   mineRooted     planLines + every piece, partitions 8 (cell 1×8, lead 2×8 + 4×8 × 3 motions, arp 2×8 + 4×8), 6 phases, no harmony
//   mineLean       the rooted table cut down: 2 phases, the lead under its first motion only (stepwise)
//   mineHarmony    the same over I–V–vi–IV in the row's frame, transposition 0 (no harmony solver run)
//   mineDefault    the chunk-tunes default table (each type's own meters), 6 phases, no harmony
// Each mine records its slowest piece (maxPieceMs): the floor of a worker pool's wall time.
// Wall times are medians of up to 5 runs when a run is under 400 ms (budget 1.5 s), else one run.

import { spawn } from 'node:child_process';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import v8 from 'node:v8';

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const RUNTIME = process.env.OVERWORLD_RUNTIME || '/Users/averylogan/Dev/LRC/Compiler/Codex Compiler (dev)/Overworld/econ/runtime';
const MAX_GRID = 2 ** 25;

const BUDGET_MS = { build: 180e3, slots: 90e3, frame: 120e3, lattice: 60e3, pick: 60e3, mineRooted: 300e3, mineLean: 300e3, mineHarmony: 300e3, mineDefault: 300e3 };
const CASE_WALL_MS = 25 * 60e3;

// ─── the sweep ───────────────────────────────────────────────────────────────────────────────────────────────────
// Onsets of a rhythm are at most its layer sum; its grid is the LCM; every gap is at most grid / (largest layer), so
// distinct tones ≤ that, and onsets × tones ≲ 4 × grid. Under MAX_GRID the two cannot both be large, so the sweep has
// families that push one or the other:
//   coprime   LRC-typical coprime sets: few onsets, grid explodes (MAX_GRID bites at a few hundred onsets)
//   pair      [a, a+1]: the most tones a given onset count can have (≈ 2/3 of a); the tone sweep
//   scaled    [g·a, g·(a+1)] and [g·a, g·(a+1), g·(a+2)]: the same pattern g times, tones fixed, onsets × g; the onset sweep
//   tones16k  ~16k onsets (the placeholder gate) at tones from ~5 to ~3k
//   dense     layers L/p for pairwise-coprime p (L = Πp): onsets up to ~L, tones ≤ min p; the millions
const scaled = (base, g) => base.map((x) => x * g);
const dense = (p) => { const L = p.reduce((a, b) => a * b, 1); return p.map((x) => L / x); };
export const CASES = [
  // coprime
  { group: 'coprime', name: '8:7:6:5', layers: [8, 7, 6, 5] },
  { group: 'coprime', name: '17:19:23:29', layers: [17, 19, 23, 29] },
  { group: 'coprime', name: '41:42:43', layers: [41, 42, 43] },
  { group: 'coprime', name: '61:67:71:73', layers: [61, 67, 71, 73] },
  { group: 'coprime', name: '201:202:203', layers: [201, 202, 203] },
  { group: 'coprime', name: '321:322:323', layers: [321, 322, 323] },
  { group: 'coprime', name: '83:89:97:101 (past MAX_GRID)', layers: [83, 89, 97, 101] },
  { group: 'coprime', name: '100:101:102:103 (past MAX_GRID)', layers: [100, 101, 102, 103] },
  // pair — tone sweep
  { group: 'pair', name: '32:33', layers: [32, 33] },
  { group: 'pair', name: '128:129', layers: [128, 129] },
  { group: 'pair', name: '512:513', layers: [512, 513] },
  { group: 'pair', name: '2048:2049', layers: [2048, 2049] },
  { group: 'pair', name: '5792:5793 (largest pair under MAX_GRID)', layers: [5792, 5793] },
  { group: 'pair', name: '5793:5794 (past MAX_GRID)', layers: [5793, 5794] },
  // scaled — onset sweep at fixed tones
  ...[16, 64, 256, 1024, 4096, 14266].map((g) => ({ group: 'scaled-48', name: `48:49 ×${g}`, layers: scaled([48, 49], g) })),
  ...[4, 16, 64, 128, 510].map((g) => ({ group: 'scaled-256', name: `256:257 ×${g}`, layers: scaled([256, 257], g) })),
  ...[64, 453].map((g) => ({ group: 'scaled-41', name: `41:42:43 ×${g}`, layers: scaled([41, 42, 43], g) })),
  ...[1024, 8224].map((g) => ({ group: 'scaled-15', name: `15:16:17 ×${g}`, layers: scaled([15, 16, 17], g) })),
  // tones16k — the placeholder gate at varying tone counts
  ...[[8, 1024], [32, 256], [128, 64], [512, 16], [2048, 4]].map(([a, g]) => ({ group: 'tones16k', name: `${a}:${a + 1} ×${g}`, layers: scaled([a, a + 1], g) })),
  // dense — millions of onsets, few tones
  { group: 'dense', name: 'L/p, p=16·27·25·7', layers: dense([16, 27, 25, 7]) },
  { group: 'dense', name: 'L/p, p=32·27·25·49', layers: dense([32, 27, 25, 49]) },
  { group: 'dense', name: 'L/p, p=64·81·25·49', layers: dense([64, 81, 25, 49]) },
  { group: 'dense', name: 'L/p, p=64·81·125·49', layers: dense([64, 81, 125, 49]) },
  { group: 'dense', name: 'L/p, p=2·3·5·10001', layers: dense([2, 3, 5, 10001]) },
  { group: 'dense', name: 'L/p, p=2·3·5·100001', layers: dense([2, 3, 5, 100001]) },
  { group: 'dense', name: 'L/p, p=2·3·5·1118479 (grid just under MAX_GRID)', layers: dense([2, 3, 5, 1118479]) },
];

// ─── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
/** grid and onset count without building: onsets by inclusion–exclusion (layers x, y coincide gcd(x, y) times a cycle) */
export function estimate(layers) {
  const grid = layers.reduce((a, b) => (a / gcd(a, b)) * b, 1);
  let onsets = 0;
  for (let m = 1; m < 1 << layers.length; m++) {
    const sub = layers.filter((_, i) => (m >> i) & 1);
    onsets += (sub.length % 2 ? 1 : -1) * sub.reduce(gcd);
  }
  return { grid, onsets, layerSum: layers.reduce((a, b) => a + b, 0), pastMaxGrid: grid > MAX_GRID };
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const MB = (b) => Math.round((b / 2 ** 20) * 10) / 10;

// ─── orchestrator ────────────────────────────────────────────────────────────────────────────────────────────────
async function orchestrate(argv) {
  let cases = CASES, out = null, only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--only') only = argv[++i].split(',');
    else cases = JSON.parse(readFileSync(argv[i], 'utf8'));
  }
  if (only) cases = cases.filter((c) => only.includes(c.name));
  const date = new Date().toISOString().slice(0, 10);
  out = out || path.join(HERE, `results-${date}.json`);
  const results = [];
  const meta = {
    date, node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length,
    memGB: Math.round(os.totalmem() / 2 ** 30), runtime: RUNTIME, mainThreadHeapLimitMB: MB(v8.getHeapStatistics().heap_size_limit),
    budgetsMs: BUDGET_MS, note: 'times in ms (median of up to 5 runs when a run < 400 ms); rss in MB, sampled every 10 ms in the case\'s own process; heap = worker isolate used heap + external (typed arrays) after gc',
  };
  for (const c of cases) {
    const est = estimate(c.layers);
    process.stderr.write(`· ${c.name}  grid ${est.grid}  onsets≈${est.onsets} … `);
    const t0 = Date.now();
    const res = await runChild(c);
    results.push({ ...c, estimate: est, ...res });
    process.stderr.write(`${((Date.now() - t0) / 1000).toFixed(1)} s ${res.error ? `[${res.error}]` : ''}\n`);
    writeFileSync(out, JSON.stringify({ meta, results }, null, 1));
  }
  process.stderr.write(`→ ${out}\n`);
}
function runChild(c) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--expose-gc', SELF, '--child', JSON.stringify(c)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), CASE_WALL_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(kill);
      try { resolve(JSON.parse(text.trim().split('\n').pop())); } catch { resolve({ error: `child exited ${code ?? signal} without a result` }); }
    });
  });
}

// ─── child: holds the worker, samples RSS, enforces budgets ─────────────────────────────────────────────────────
function childMain(c) {
  const stages = {}, order = [];
  let current = null, peak = 0, timer = null, finished = false, info = null;
  const sample = setInterval(() => { const r = process.memoryUsage.rss(); if (r > peak) peak = r; }, 10);
  const worker = new Worker(SELF, { workerData: { c }, resourceLimits: { stackSizeMb: 1024, maxOldGenerationSizeMb: 28000 } });
  const finish = (extra = {}) => {
    if (finished) return; finished = true;
    clearInterval(sample); clearTimeout(timer);
    const ru = process.resourceUsage();
    process.stdout.write(JSON.stringify({ info, stages, order, maxRssMB: MB(ru.maxRSS * 1024), ...extra }) + '\n');
    worker.terminate().finally(() => process.exit(0));
  };
  worker.on('message', (m) => {
    if (m.t === 'start') {
      current = m.stage; order.push(m.stage); peak = process.memoryUsage.rss();
      stages[m.stage] = { status: 'running', rssStartMB: MB(peak) };
      clearTimeout(timer);
      timer = setTimeout(() => { stages[current] = { ...stages[current], status: 'timeout', budgetMs: BUDGET_MS[current], rssPeakMB: MB(peak) }; finish({ error: `${current} over its ${BUDGET_MS[current] / 1000} s budget` }); }, BUDGET_MS[m.stage]);
    } else if (m.t === 'end') {
      clearTimeout(timer);
      stages[m.stage] = { ...stages[m.stage], ...m.data, rssPeakMB: MB(Math.max(peak, process.memoryUsage.rss())) };
      current = null;
    } else if (m.t === 'info') {
      info = m.info;
      // would the Overworld kernel's Math.max(...gaps) survive on a default (~1 MB) stack, as on a page's main thread?
      try { Math.max(...new Float64Array(info.onsets)); info.defaultStackSpreadOk = true; } catch (e) { info.defaultStackSpreadOk = false; info.defaultStackSpreadError = e.message; }
    } else if (m.t === 'done') finish();
  });
  worker.on('error', (e) => { if (current) stages[current] = { ...stages[current], status: 'crashed', error: e.message, rssPeakMB: MB(peak) }; finish({ error: `worker crashed in ${current}: ${e.message}` }); });
  worker.on('exit', () => finish(finished ? {} : { error: 'worker exited early' }));
}

// ─── worker: the measurements ────────────────────────────────────────────────────────────────────────────────────
async function workerMain({ c }) {
  const imp = (f) => import(pathToFileURL(path.join(RUNTIME, f)).href);
  const SR = await imp('chunk-super-row.js'), CL = await imp('chunk-lines.js'), SL = await imp('settle-location.js');
  const now = () => performance.now();
  const gc = () => { if (globalThis.gc) { globalThis.gc(); globalThis.gc(); } };
  const heap = () => { const h = v8.getHeapStatistics(); return { heapMB: MB(h.used_heap_size), externalMB: MB(h.external_memory ?? 0) }; };
  const post = (m) => parentPort.postMessage(m);
  /** median of up to 5 runs when a run is cheap */
  const timed = (fn) => {
    const ts = []; let out, total = 0;
    do { const a = now(); out = fn(); const t = now() - a; ts.push(t); total += t; } while (ts[0] < 400 && ts.length < 5 && total < 1500);
    return { ms: r3(median(ts)), runs: ts.length, out };
  };
  const stage = (name, fn) => {
    gc(); post({ t: 'start', stage: name });
    let data;
    try { data = { status: 'ok', ...fn() }; } catch (e) { data = { status: 'error', error: String(e.message || e).slice(0, 300) }; }
    gc(); Object.assign(data, heap());
    post({ t: 'end', stage: name, data });
    return data.status === 'ok';
  };
  const stats = (xs) => { let s = 0, m = 0; for (const x of xs) { s += x; if (x > m) m = x; } return { mean: xs.length ? r3(s / xs.length) : 0, max: m }; };

  let row = null, frame = null;
  const ok = {};
  ok.build = stage('build', () => {
    const k = timed(() => SL.buildRhythmTimingKernel({ layers: c.layers }));
    const b = timed(() => SR.buildNormalizedRow([{ layers: c.layers }]));
    row = b.out;
    const cyc = row.cycles[0], odd = new Set();
    let maxGap = 0, maxOct = 0;
    for (let i = 0; i < cyc.n; i++) { let g = cyc.gap[i]; if (g > maxGap) maxGap = g; while (g % 2 === 0) g /= 2; odd.add(g); if (cyc.octave[i] > maxOct) maxOct = cyc.octave[i]; }
    const info = { grid: cyc.grid, onsets: row.n, moments: row.moments.n, tones: row.tones.length, exactTones: odd.size, maxGap, maxOctave: maxOct, toneIndexOverflow: row.tones.length > 65535 };
    post({ t: 'info', info });
    return { ms: b.ms, runs: b.runs, kernelMs: k.ms, kernelRuns: k.runs, ...info };
  });
  if (!ok.build) return post({ t: 'done' });

  ok.slots = stage('slots', () => {
    const out = {};
    for (const P of [8, 16, 32]) {
      const t = timed(() => SR.slotCandidates(row, { P }));
      out[`P${P}`] = { ms: t.ms, runs: t.runs, nodesPerSlot: stats(t.out.slots.map((s) => s.nodes)), tonesPerSlot: stats(t.out.slots.map((s) => s.tones.length)) };
    }
    return out;
  });

  ok.frame = stage('frame', () => {
    const t = timed(() => CL.bestFrames(row, 25)[0]);
    frame = t.out;
    return { ms: t.ms, runs: t.runs, theta: r3(frame.theta), frameTones: frame.inside.reduce((a, b) => a + b, 0), frameNodes: frame.nodes };
  });
  if (!ok.frame) return post({ t: 'done' });

  let lattice48 = null;
  ok.lattice = stage('lattice', () => {
    const out = {};
    for (const [bars, S] of [[2, 8], [4, 8]]) {
      const t = timed(() => CL.buildLattice(row, { bars, slotsPerBar: S, frame, moments: 12 }));
      const L = t.out;
      if (bars === 4) lattice48 = L;
      out[`${bars}x${S}`] = { ms: t.ms, runs: t.runs, swing: L.swing, windowMoments: r3((2 * L.swing * row.moments.n) / L.P), candsPerSlot: stats(L.slots.map((s) => s.cands.length)) };
    }
    return out;
  });
  if (!ok.lattice) return post({ t: 'done' });

  stage('pick', () => {
    const P = lattice48.P, lead = CL.LINE_TYPES.find((x) => x.type === 'lead'), band = lead.bands[1];
    const nMin = Math.max(2, Math.ceil(band.share[0] * P - 1e-9)), nMax = Math.floor(band.share[1] * P + 1e-9);
    const rules = { ...lead.rules, strict: band.strict, contour: { shape: 'arch', register: 'octave', low: 0, span: 1200 }, nMin, nMax };
    const t = timed(() => CL.pickLines(lattice48, rules));
    return { ms: t.ms, runs: t.runs, P, nMin, nMax, lines: t.out.length };
  });

  const HARMONY = { chords: [
    { name: 'C', rootSemitone: 0, relativeTones: [0, 4, 7] }, { name: 'G', rootSemitone: 7, relativeTones: [2, 7, 11] },
    { name: 'Am', rootSemitone: 9, relativeTones: [0, 4, 9] }, { name: 'F', rootSemitone: 5, relativeTones: [0, 5, 9] },
  ], transposition: 0 };
  const fixed = { theta: frame.theta, width: frame.width };
  const mine = (opts) => {
    const once = () => {
      let a = now();
      const plan = CL.planLines(row, { frame: fixed, phases: 6, moments: 12, ...opts });
      const t = { planMs: now() - a, latticeMs: 0, pickMs: 0, describeMs: 0, mergeMs: 0 };
      const answers = [], cands = [];
      let maxPiece = 0;
      for (let due = CL.linePiecesDue(plan, answers); due.length; due = CL.linePiecesDue(plan, answers)) for (const i of due) {
        const p0 = now();
        a = now(); const job = CL.prepareLinePiece(row, plan, i); t.latticeMs += now() - a;
        for (const s of job.lattice.slots) cands.push(s.cands.length);
        a = now(); const solved = CL.solveLinePiece(job); t.pickMs += now() - a;
        a = now(); answers[i] = CL.describeLinePiece(row, job, solved); t.describeMs += now() - a;
        maxPiece = Math.max(maxPiece, now() - p0);
      }
      a = now(); const table = CL.mergeLines(plan, answers); t.mergeMs = now() - a;
      t.maxPieceMs = maxPiece;
      t.ms = t.planMs + t.latticeMs + t.pickMs + t.describeMs + t.mergeMs;
      return { t, pieces: plan.pieces.length, tasks: plan.head.tasks.length, runs: table.runs, lines: table.lines.length, root: plan.head.root, cands };
    };
    const runs = [];
    do runs.push(once()); while (runs[0].t.ms < 400 && runs.length < 5 && runs.reduce((s, r) => s + r.t.ms, 0) < 1500);
    const pickMedian = (k) => r3(median(runs.map((r) => r.t[k])));
    const last = runs[runs.length - 1];
    return { ms: pickMedian('ms'), runs: runs.length, planMs: pickMedian('planMs'), latticeMs: pickMedian('latticeMs'), pickMs: pickMedian('pickMs'), describeMs: pickMedian('describeMs'), mergeMs: pickMedian('mergeMs'), maxPieceMs: pickMedian('maxPieceMs'),
      pieces: last.pieces, tasks: last.tasks, lineRuns: last.runs, lines: last.lines, root: last.root, candsPerSlot: stats(last.cands) };
  };
  // lean: the rooted table cut to 2 downbeats and the lead's first motion only (a main-thread candidate)
  const LEAN_TYPES = CL.LINE_TYPES.map((x) => (x.motions ? { ...x, motions: ['stepwise'] } : x));
  if (stage('mineRooted', () => mine({ partitions: 8 }))) {
    stage('mineLean', () => mine({ partitions: 8, phases: 2, types: LEAN_TYPES }));
    if (stage('mineHarmony', () => mine({ partitions: 8, harmony: HARMONY }))) stage('mineDefault', () => mine({ partitions: null }));
  }
  post({ t: 'done' });
}

// ─── entry ───────────────────────────────────────────────────────────────────────────────────────────────────────
if (!isMainThread) workerMain(workerData).catch((e) => { parentPort.postMessage({ t: 'end', stage: 'fatal', data: { status: 'error', error: String(e.message || e) } }); parentPort.postMessage({ t: 'done' }); });
else if (process.argv[2] === '--child') childMain(JSON.parse(process.argv[3]));
else if (process.argv[1] === SELF) orchestrate(process.argv.slice(2));
