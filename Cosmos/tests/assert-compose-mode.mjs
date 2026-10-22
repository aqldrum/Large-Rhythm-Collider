// assert-compose-mode.mjs — Cosmos's Compose mode (E1, 2026-10-22 night), in Node:
//   • the pure policies: the range (stop a cell inside every tier's evict shell, fade before it, past the spawn reach),
//     the tier budget, a rhythm's composability, the button's faces, the lattice focus
//   • the state machine against mocks: rhythm and grid paths, gathering, cancel, a stale reply ignored, refusals,
//     replacement, the range stop with its dwell and hysteresis, every removal path, the E2 hooks
//   • the flight seam in cosmos-audio.js against a recording mock AudioContext: the flight gate and the composition bus,
//     silence (bed released, lead released, MIDI all-notes-off), the pulse handed over (no flight phase runs), the
//     clock bookkeeping (grid and lead held, re-anchored at resume: no deck jump, no lead burst, no immediate chord
//     step), SPEED inert while held and landing on flight at resume, the fade back in
//   • the Composer player inside Cosmos: its output on the composition bus, booked by Cosmos's pulse, the note hook,
//     stop handing the clock back
//   • flight-view.js calls the stop on every path that removes the grid or closes the card (source checks)
//   node Cosmos/tests/assert-compose-mode.mjs
import { readFileSync } from 'node:fs';
import {
  createComposeMode, composeStopRange, rangeLevel, composeBudgetFor, rhythmComposability, composeButtonView, targetKey,
  latticeTarget, latticeDistances, COMPOSE_STATES as S, STOP_DWELL_MS,
} from '../engine/cosmos-compose.js';
import { QUALITY_ORDER, QUALITY_TIERS } from '../engine/cosmos-quality.js';
import { ONSET_GATE } from '../../Composer/core/row.js';
import { compose } from '../../Composer/core/compose.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

console.log('═══ COSMOS COMPOSE MODE — assertions ═══');

console.log('\n  The pure policies');
{
  let ok = true, trail = [];
  for (const id of QUALITY_ORDER) {
    const q = QUALITY_TIERS[id], r = composeStopRange(q.evict);
    trail.push(`${id} ${r.fadeFrom}→${r.stopAt}/${q.evict}`);
    ok = ok && r.stopAt < q.evict && r.fadeFrom < r.stopAt && r.fadeFrom > q.spawn;
  }
  check('every tier: it stops inside the evict shell, fades before that, and both lie past the spawn reach', ok, trail.join(' · '));
  check('Low (evict 10): fades from 7 cells, stops at 9', (() => { const r = composeStopRange(10); return r.fadeFrom === 7 && r.stopAt === 9; })());
  const r = composeStopRange(16);
  check('the level: 1 inside, linear through the fade, 0 at the stop', rangeLevel(3, r) === 1 && rangeLevel(r.fadeFrom, r) === 1 && near(rangeLevel(r.fadeFrom + 1, r), 0.5) && rangeLevel(r.stopAt, r) === 0);
  const budgets = QUALITY_ORDER.map((id) => composeBudgetFor(QUALITY_TIERS[id]));
  check(`composeBudget by tier: ${budgets.join(' ≤ ')} (Low = the card's 16,384), non-decreasing`, budgets.join() === '16384,65536,262144,262144');
  check('composeBudgetFor falls back to 65,536', composeBudgetFor({}) === 65536 && composeBudgetFor(null) === 65536);
  check('a rhythm is composable up to the Composer\'s gate, past the card\'s 16,384 Listen limit', rhythmComposability([20000, 3]).ok && rhythmComposability([20000, 3]).onsets > 16384);
  check('…not past the gate, nor with five layers', !rhythmComposability([ONSET_GATE + 7, 2]).ok && /over the Composer/.test(rhythmComposability([ONSET_GATE + 7, 2]).reason) && !rhythmComposability([9, 8, 7, 6, 5]).ok);
  const here = { kind: 'rhythm', grid: 840, key: 'k', layers: [8, 7, 6, 5] };
  const idle = composeButtonView({ state: S.IDLE }, here), none = composeButtonView({ state: S.IDLE }, null);
  check('the button: COMPOSE on a card that has something to compose, hidden on one that has not', idle.visible && idle.label === 'COMPOSE' && !idle.disabled && !none.visible);
  check('…disabled (with the reason) on a rhythm past the gate', composeButtonView({ state: S.IDLE }, { kind: 'rhythm', grid: 1, layers: [ONSET_GATE + 1, 1] }).disabled);
  const faces = [S.GATHERING, S.COMPOSING, S.PERFORMING].map((st) => composeButtonView({ state: st, target: { kind: 'grid', grid: 7 }, progress: { shardsDone: 2, shardsTotal: 9, rhythms: 40 } }, null));
  check(`…GATHERING… / COMPOSING… / STOP, shown on any card while busy (to stop it): ${faces.map((f) => f.label).join(' / ')}`, faces.map((f) => f.label).join() === 'GATHERING…,COMPOSING…,STOP' && faces.every((f) => f.visible && !f.disabled) && faces[2].active && /2 of 9 shards/.test(faces[0].title));
  check('target keys tell a rhythm from its grid', targetKey(here) === 'rhythm:840:k' && targetKey({ kind: 'grid', grid: 840 }) === 'grid:840');
  const lattice = { cmin: 2, rscale: 6, extent: (d) => d };
  const sys = [{ c: 2 }, { c: 3 }, { c: 4 }, { c: 9 }];
  const d = latticeDistances(sys, { ...lattice, eye: latticeTarget(2, 4, 4, lattice) });
  check('the lattice focus: a node is nearest itself', d[2] === 0 && d.every((x, i) => i === 2 || x > 0));
  // the layout is the draw loop's: guard the expression it is copied from
  const fv = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
  check('latticeTarget follows the draw loop\'s layout (radius by cardinality, Fibonacci sphere by index)',
    fv.includes('const R = rscale * (1 + cardExtent(p.c - data.cmin));') && fv.includes('const y = 1 - (pi + 0.5) / N * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), ang = pi * GOLDEN;') &&
    fv.includes('const tx = Math.cos(ang) * rr * R, ty = y * R, tz = Math.sin(ang) * rr * R;'));
}

// ── mocks for the state machine ──
function deferred() { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; }
function makeComposer() {
  const c = { calls: [], cancels: 0, jobs: [] };
  c.rhythm = (layers, T, options) => { const j = deferred(); c.calls.push({ kind: 'rhythm', layers, T, options }); c.jobs.push(j); return j.p; };
  c.superrow = (payload, transfer) => { const j = deferred(); c.calls.push({ kind: 'superrow', payload, transfer }); c.jobs.push(j); return j.p; };
  c.cancel = () => { c.cancels++; for (const j of c.jobs) j.reject(Object.assign(new Error('cancelled'), { cancelled: true })); };
  return c;
}
function makePerformer() {
  const p = { performed: [], stops: 0, levels: [], playing: false, startedAt: 12.5, hook: null };
  p.perform = (spec, { onNote }) => { p.performed.push(spec); p.playing = true; p.hook = onNote; return true; };
  p.stop = () => { p.stops++; p.playing = false; return true; };
  p.setLevel = (x) => p.levels.push(x);
  return p;
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const spec88 = compose([8, 7, 6, 5], 4.36, { seed: 1 });

console.log('\n  The state machine: a Rhythm card');
{
  const composer = makeComposer(), performer = makePerformer();
  let clock = 0;
  const mode = createComposeMode({ composer, performer, now: () => clock });
  const log = [];
  for (const type of ['state', 'composing', 'composed', 'perform', 'note', 'stop', 'refused', 'level']) mode.on(type, (e) => log.push([type, e]));
  const rhythm = { kind: 'rhythm', grid: 840, key: '8.7.6.5', layers: [8, 7, 6, 5] };
  mode.press(rhythm);
  check('press → composing, in a worker, with a cycle for 110 BPM (never n / rate)', mode.state === S.COMPOSING && composer.calls[0].kind === 'rhythm' && near(composer.calls[0].T, 60 * 2 * 4 / 110));
  composer.jobs[0].resolve(spec88); await tick();
  check('the spec → performing: the performer plays it, \'composed\' then \'perform\' are emitted', mode.state === S.PERFORMING && performer.performed[0] === spec88 &&
    log.some(([t]) => t === 'composed') && log.find(([t]) => t === 'perform')[1].startedAt === 12.5);
  performer.hook({ kind: 'note', part: 'lead', node: 3, when: 13 });
  check('the player\'s note hook reaches \'note\' listeners with the target', log.some(([t, e]) => t === 'note' && e.node === 3 && e.part === 'lead' && e.target === rhythm));
  mode.press(rhythm);
  check('press again (the same rhythm) → stop: the performer stops, idle, \'stop\' says why', mode.state === S.IDLE && performer.stops === 1 && log.at(-1)[0] === 'stop' && log.at(-1)[1].reason === 'toggle' && log.some(([t, e]) => t === 'state' && e.state === S.STOPPING));
  mode.press(rhythm); mode.press(rhythm);
  check('press while composing → cancel: the worker is cancelled, back to idle', mode.state === S.IDLE && composer.cancels === 1);
  composer.jobs[1].resolve(spec88); await tick();
  check('a reply after the cancel is ignored (no performance)', performer.performed.length === 1 && mode.state === S.IDLE);
  mode.press(rhythm); composer.jobs[2].resolve(compose([1, 1], 4, {})); await tick();
  check('a refused spec → idle, with a notice and \'refused\'', mode.state === S.IDLE && mode.info().notice?.reason === 'tooFewTones' && log.at(-1)[0] === 'state' && log.some(([t]) => t === 'refused'));
  mode.press({ ...rhythm, layers: [ONSET_GATE + 5, 2], key: 'big' });
  check('a rhythm over the gate refuses without a worker', mode.state === S.IDLE && composer.calls.length === 3);
  mode.press(rhythm); composer.jobs[3].resolve(spec88); await tick();
  const other = { kind: 'rhythm', grid: 840, key: 'o', layers: [5, 4, 3] };
  mode.press(other);
  check('press on another rhythm while one plays → that one stops (replaced), this one composes', performer.stops === 2 && mode.state === S.COMPOSING && mode.target === other && log.filter(([t]) => t === 'stop').at(-1)[1].reason === 'replaced');
  mode.stop('escape');
  check('stop(reason) from composing cancels the worker', composer.cancels === 2 && mode.state === S.IDLE);
}

console.log('\n  The state machine: a Grid card (gathering → superrow)');
{
  const composer = makeComposer(), performer = makePerformer();
  let clock = 0, bloom = { ready: false, progress: { shardsDone: 1, shardsTotal: 4, rhythms: 10 } };
  const rhythms = [[8, 7, 6, 5], [8, 7, 5, 3], [12, 10, 7]];
  const mode = createComposeMode({ composer, performer, now: () => clock, budget: () => 16384,
    gather: () => ({ ...bloom, snapshot: () => ({ rhythms, dist: Float64Array.from([3, 1, 2]), keys: ['a', 'b', 'c'] }) }) });
  const events = [];
  mode.on('gathering', (e) => events.push(e.progress.shardsDone));
  const grid = { kind: 'grid', grid: 840, eye: [0, 0, 0] };
  mode.press(grid);
  check('press → gathering while the bloom streams; progress reported', mode.state === S.GATHERING && mode.info().progress.shardsDone === 1 && events.length === 1);
  mode.frame({}); mode.frame({});
  check('…an unchanged progress is not re-reported each frame', events.length === 1);
  bloom = { ready: false, progress: { shardsDone: 3, shardsTotal: 4, rhythms: 30 } }; mode.frame({});
  bloom = { ready: true, progress: { shardsDone: 4, shardsTotal: 4, rhythms: 40 } }; mode.frame({});
  const call = composer.calls[0];
  check('the bloom done → composing: the window\'s rhythms flat, the focus distances, the tier budget, transferred', mode.state === S.COMPOSING && call.kind === 'superrow' &&
    call.payload.layersFlat.length === 12 && call.payload.dist[1] === 1 && call.payload.budget === 16384 && call.payload.bpm === 110 && call.transfer.length === 2);
  const window = { visible: 3, fitted: 2, whole: false, skipped: { alone: 1 } };
  composer.jobs[0].resolve({ ok: true, spec: spec88, window, superrow: { grid: 840, n: 22 } }); await tick();
  check(`the reply → performing; the barometer: "${mode.info().barometer?.text}"`, mode.state === S.PERFORMING && mode.info().barometer.fitted === 2 && /2 of 3 rhythms/.test(mode.info().barometer.text));

  console.log('\n  The range (the player keeps flying; it stops when the grid falls out of range)');
  const r = composeStopRange(10);
  mode.frame({ distance: 4, evictRadius: 10, at: clock });
  check('inside the range: full level, still performing', mode.state === S.PERFORMING && performer.levels.length === 0);
  mode.frame({ distance: 8, evictRadius: 10, at: clock });
  check('in the fade: the level follows the distance (8 of 7→9 cells → 0.5)', near(performer.levels.at(-1), 0.5));
  clock = 1000; mode.frame({ distance: 9.5, evictRadius: 10, at: clock });
  clock += STOP_DWELL_MS - 50; mode.frame({ distance: 9.5, evictRadius: 10, at: clock });
  check('past the stop for less than the dwell: still performing', mode.state === S.PERFORMING);
  clock += 10; mode.frame({ distance: 6, evictRadius: 10, at: clock });
  check('back inside: the level comes back (the hysteresis) and the dwell resets', near(performer.levels.at(-1), 1) && mode.state === S.PERFORMING);
  clock += 10; mode.frame({ distance: 12, evictRadius: 10, at: clock });
  clock += STOP_DWELL_MS - 5; mode.frame({ distance: 12, evictRadius: 10, at: clock });
  check('…so it needs a full dwell out again', mode.state === S.PERFORMING);
  clock += 10; mode.frame({ distance: 12, evictRadius: 10, at: clock });
  check(`out of range for the dwell (${STOP_DWELL_MS} ms past ${r.stopAt} cells) → stopped`, mode.state === S.IDLE && performer.stops === 1);

  console.log('\n  Every removal path stops it');
  for (const reason of ['evicted', 'bloom dropped', 'collapsed', 'quality reset']) {
    mode.press(grid); composer.jobs.at(-1).resolve({ ok: true, spec: spec88, window, superrow: null }); await tick();
    const before = performer.stops;
    const otherGone = mode.gridGone(841, reason);
    const gone = mode.gridGone(840, reason);
    check(`gridGone(G, '${reason}'): another grid leaves it playing, its own grid stops it`, !otherGone && gone && performer.stops === before + 1 && mode.state === S.IDLE);
  }
  mode.press({ kind: 'rhythm', grid: 840, key: 'r', layers: [8, 7, 6, 5] });
  check('…a Rhythm card\'s composition goes with its grid too', mode.gridGone(840, 'collapsed') && mode.state === S.IDLE);
  mode.press(grid);
  check('…and a gathering one (the stop cancels it before it composes)', mode.gridGone(840, 'evicted') && mode.state === S.IDLE);
  bloom = { empty: true }; mode.press(grid);
  check('an empty bloom refuses', mode.state === S.IDLE && mode.info().notice?.reason === 'empty');
  bloom = { ready: true, progress: {} };
  mode.press(grid); composer.jobs.at(-1).resolve({ ok: true, refused: { reason: 'empty' }, window: { visible: 3, fitted: 0, skipped: { budget: 3 } } }); await tick();
  check(`nothing fits the budget: refused, the notice says so ("${mode.info().notice?.text}")`, mode.state === S.IDLE && /nothing fits/.test(mode.info().notice?.text));
  mode.press(grid); composer.jobs.at(-1).reject(new Error('boom')); await tick();
  check('a worker error → idle with a notice, never stuck', mode.state === S.IDLE && /boom/.test(mode.info().notice?.text));
}

// ── a recording mock AudioContext (Node has no Web Audio): every node, connection and param call ──
function makeParam(value) {
  const p = { value, calls: [] };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime'])
    p[m] = (...a) => { p.calls.push([m, ...a]); if (m === 'setValueAtTime' || m === 'linearRampToValueAtTime' || m === 'setTargetAtTime' || m === 'exponentialRampToValueAtTime') p.value = a[0]; return p; };
  return p;
}
function makeCtx() {
  const nodes = [];
  const makeNode = (kind) => {
    const n = { kind, outs: [], started: null, connect(d) { this.outs.push(d); return d; }, disconnect() { this.outs = []; }, start(t) { this.started = t; }, stop() {}, setPeriodicWave() {} };
    const proxy = new Proxy(n, { get(t, prop) { if (prop in t || typeof prop === 'symbol' || prop === 'then') return t[prop]; if (/^on/.test(prop)) return null; t[prop] = makeParam(0); return t[prop]; } });
    nodes.push(proxy); return proxy;
  };
  const base = {
    currentTime: 0, sampleRate: 48000, state: 'running', nodes, resume() {}, close() {},
    createBuffer: (ch, len) => ({ length: len, numberOfChannels: ch, getChannelData: () => new Float32Array(len) }),
    createPeriodicWave: () => ({}),
  };
  base.destination = makeNode('destination');
  base.listener = makeNode('listener');
  return new Proxy(base, { get(t, prop) { if (prop in t || typeof prop === 'symbol') return t[prop]; if (typeof prop === 'string' && prop.startsWith('create')) return () => makeNode(prop.slice(6)); return undefined; } });
}

console.log('\n  The flight seam in cosmos-audio.js (mock AudioContext)');
const ctx = makeCtx(), pulses = [];
globalThis.window = { AudioContext: function () { return ctx; } };
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn) => { pulses.push(fn); return pulses.length; };   // TransportClock's fallback timer (no Worker in Node)
const audio = await import('../audio/cosmos-audio.js');
const { createCosmosComposerPlayer, bookingEvents } = await import('../audio/cosmos-composer-player.js');
audio.initAudio();
globalThis.setInterval = realSetInterval;
const pulse = () => { for (const fn of pulses) fn(); };
const advance = (seconds) => { for (let t = 0; t < seconds - 1e-9; t += 0.025) { ctx.currentTime += 0.025; pulse(); } };
check('the transport pulse is captured (the timer fallback)', pulses.length === 1);
{
  const { nodes } = audio.debugFlightHold();
  check('the graph: bed, rows and audition → flightGain → mute; the composition bus → mute, past the gate',
    [nodes.bedGain, nodes.rowsGain, nodes.auditionGain].every((g) => g.outs.includes(nodes.flightGain) && !g.outs.includes(nodes.muteGainNode)) &&
    nodes.flightGain.outs.includes(nodes.muteGainNode) && nodes.compositionGain.outs.includes(nodes.muteGainNode) && audio.compositionOutput().destination === nodes.compositionGain);
}
// a lead that sounds every onset (one layer: every onset 1/1, in every chord), at 4 onsets a second
audio.setTargetOnsetRate(4);
audio.setLead({ ...audio.deriveVoice([4]), node: { grid: 4, key: '4' } });
audio.setField([{ id: 99, pool: Array.from({ length: 12 }, (_, i) => ({ fraction: '1/1', dev: 0, degree: i })), pan: 0, gain: 0.5, octave: 0, cutoff: 2000 }]);
advance(2);
const seqOf = () => audio.lastSoundedLeadOnset()?.seq ?? 0;
const playedBefore = seqOf();
check(`flight plays: the lead voiced ${playedBefore} onsets in 2 s at 4/s`, playedBefore >= 6 && playedBefore <= 10);
const ticksBefore = audio.currentTicks(), skyBefore = audio.debugSkyState().chordExposure.lastChordSeconds;
let held = 0;
check('suspendFlight → true', audio.suspendFlight({ onTick: () => held++ }) === true && audio.flightSuspended());
check('…and refuses a second hold', audio.suspendFlight({ onTick: () => {} }) === false);
{
  const h = audio.debugFlightHold(), g = h.nodes.flightGain.gain.calls.at(-1);
  check('silence: flightGain ramps to 0 over 50 ms (the user\'s MUTE is untouched)', g[0] === 'linearRampToValueAtTime' && g[1] === 0 && near(g[2], ctx.currentTime + 0.05) &&
    !h.nodes.muteGainNode.gain.calls.some((c) => c[1] === 0));
  check('silence: the bed released (no star in the field), the lead\'s voices released', h.bedStars === 0);
}
advance(20);
check(`the pulse is the composition's: ${held} held ticks, no flight phase ran (no lead onset voiced)`, held >= 790 && seqOf() === playedBefore);
audio.setField([{ id: 98, pool: [], pan: 0, gain: 1, octave: 0, cutoff: 2000 }]);
check('while held, the bed takes no stars (flight re-voices it after)', audio.debugFlightHold().bedStars === 0);
check('the grid clock is held: currentTicks() does not move (gravity sees no motion)', audio.currentTicks() === audio.debugFlightHold().saved.gridTicks && near(audio.currentTicks(), ticksBefore, 1));
const tpsHeld = audio.debugFlightHold().ticksPerSec;
audio.setTargetOnsetRate(8);
check('SPEED is inert while held: the live rates do not move; the new rate waits in the saved transport', audio.debugFlightHold().ticksPerSec === tpsHeld && audio.debugFlightHold().saved.leadTicksPerSec === 8);
const saved = audio.debugFlightHold().saved;
check('resumeFlight → true', audio.resumeFlight() === true && !audio.flightSuspended());
{
  const h = audio.debugFlightHold(), now = ctx.currentTime;
  check('re-anchored: the grid and lead clocks read exactly what they read when held (no deck jump-ahead)',
    near((now - h.transportStart) * h.ticksPerSec, saved.gridTicks, 1e-6) && near((now - h.leadTransportStart) * h.leadTicksPerSec, saved.leadTicks, 1e-6));
  check('SPEED lands on flight at resume (the lead now at 8 onsets/s)', h.leadTicksPerSec === 8);
  const g = h.nodes.flightGain.gain.calls.at(-1);
  check('flightGain fades back in over 1.5 s', g[0] === 'linearRampToValueAtTime' && g[1] === 1 && near(g[2], now + 1.5));
}
advance(0.025);
const burst = seqOf() - playedBefore;
check(`no burst on resume: the first tick books what the 250 ms horizon holds (${burst} onset(s)), not the ~160 missed`, burst <= 3);
const ex = audio.debugSkyState().chordExposure;
check('no immediate chord step: the walk\'s baseline was reset (held ≈ 0 s, the last chord\'s length unchanged)', ex.heldSeconds < 0.1 && ex.lastChordSeconds === skyBefore);
advance(2);
check(`flight plays on after the hand-back (${seqOf() - playedBefore - burst} more onsets in 2 s at 8/s)`, seqOf() - playedBefore - burst >= 12);
check('a resume with nothing held is a no-op', audio.resumeFlight() === false);

console.log('\n  The Composer player inside Cosmos');
{
  const spec = compose([8, 7, 6, 5], 4.36, { seed: 1 });
  const notes = [];
  const player = createCosmosComposerPlayer();
  audio.setLead(null);
  check('perform → the flight held, the composition playing', player.perform(spec, { onNote: (e) => notes.push(e) }) && audio.flightSuspended() && player.playing);
  const { nodes } = audio.debugFlightHold();
  const limiter = ctx.nodes.filter((n) => n.kind === 'DynamicsCompressor').at(-1);
  check('its limiter feeds the composition bus (the player\'s destination), not ctx.destination', limiter.outs.includes(nodes.compositionGain) && !limiter.outs.includes(ctx.destination));
  const startedAt = player.startedAt, oscBefore = ctx.nodes.filter((n) => n.kind === 'Oscillator').length;
  advance(spec.knobs.cycleSeconds + 0.5);
  const oscs = ctx.nodes.filter((n) => n.kind === 'Oscillator').length - oscBefore;
  check(`Cosmos's pulse books it: ${oscs} oscillators started across a cycle`, oscs > 0);
  const expected = bookingEvents(spec).filter((e) => e.time < spec.knobs.cycleSeconds).length;
  const firstCycle = notes.filter((e) => e.cycle === 0);
  check(`the note hook: every note and stroke of the first cycle reported once (${firstCycle.length} of ${expected}), with part, node and when`, firstCycle.length === expected &&
    firstCycle.every((e) => e.part && (e.kind === 'drum' || Number.isInteger(e.node)) && near(e.when, startedAt + e.time, 1e-9)) && notes.some((e) => e.kind === 'drum'));
  check('…reported ahead of their time (at booking, inside the 250 ms horizon)', notes.every((e) => e.when <= ctx.currentTime + 0.25 + 1e-9));
  check('…and the loop goes on into the next cycle', notes.some((e) => e.cycle === 1));
  check('perform refuses while one plays', !player.perform(spec));
  check('stop → the clock handed back, flightGain fading in', player.stop() && !audio.flightSuspended() && !player.playing && audio.debugFlightHold().nodes.flightGain.gain.calls.at(-1)[1] === 1);
  check('a refused spec is not performed', !player.perform({ refused: true }) && !audio.flightSuspended());
}

console.log('\n  flight-view.js stops it on every path (source)');
{
  const fv = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
  const has = (re) => re.test(fv);
  check('zone eviction (onZoneRemoved)', has(/onZoneRemoved: grid => \{[^\n]+composeMode\.gridGone\(grid, 'evicted'\)/));
  check('the per-frame bloom drop', has(/bloomed\.delete\(g\);[^\n]+composeMode\.gridGone\(g, 'bloom dropped'\)/));
  check('the right-click collapse', has(/bloomed\.delete\(g\);\s+composeMode\.gridGone\(g, 'collapsed'\)/));
  check('the tier reset', has(/bloomCache\.delete\(g\);[^\n]+composeMode\.gridGone\(g, 'quality reset'\)/));
  check('Esc peels the composition before the card', has(/closeCardOnEscape = \(\) => \{\s+if \(composeMode\.active\) \{ composeMode\.stop\('escape'\); return true; \}/));
  check('the fold and the card closing', has(/if \(!open\) composeMode\.stop\('card folded'\)/) && has(/function resetRhythmInspector\(\) \{[^}]+composeMode\.stop\('card closed'\)/));
  check('leaving Cosmos, first thing in stopFlight', has(/started = false;\s+composeMode\.stop\('exit'\)/));
  check('the range and the gathering, per frame', has(/composeMode\.frame\(\{ distance: cosmos\.zones\.has\(cg\) \? cosmos\.cellDist\(cg, cosmos\.cam\) : Infinity, evictRadius: cosmos\.evictRadius/));
  check('no audition starts under a composition', has(/function setRhythmAudition\(node\) \{\s+if \(!node\?\.layers \|\| composeMode\.active\) return;/));
  check('SPEED shows held while it plays, and lets go on stop', has(/setKnobInert\('speed', true/) && has(/composeMode\.on\('stop', \(\) => \{ setKnobInert\('speed', false\)/));
  const ca = readFileSync(new URL('../audio/cosmos-audio.js', import.meta.url), 'utf8');
  check('cosmos-audio: the held pulse returns before every flight phase', /if \(flightHold\) \{ guardPhase\('composition', \(\) => flightHold\.onTick\?\.\(now\)\); return; \}\s+guardPhase\('skyWalk'/.test(ca));
  const adapter = readFileSync(new URL('../audio/cosmos-composer-player.js', import.meta.url), 'utf8');
  check('the Composer player is imported in exactly one Cosmos file, the shared one (Composer/perform/)', (adapter.match(/from '\.\.\/\.\.\/Composer\/perform\/composer-player\.js'/g) || []).length === 1 &&
    !adapter.includes('lab-player') && !fv.includes('perform/composer-player') && !ca.includes('perform/composer-player'));
}

audio.stopAudio();
console.log(`\n${PASS ? '✓✓✓ COMPOSE MODE PASSES' : '✗ COMPOSE MODE FAILED'} (${checks} checks)`);
process.exit(PASS ? 0 : 1);
