// assert-audio-telemetry.mjs — proofs for the audio clock's instrument panel (../audio-telemetry.js) and
// for the late-event accounting it measures in the row player. The panel exists to falsify one specific
// mechanism (motion → main-thread jank → late events clamped into a flam → MPE channel steals), so what
// matters is that its numbers cannot lie in the ways that would make the experiment useless:
//   • a motion mode is attributed correctly, with a deadband, and translation beats rotation
//   • the tail is reported, not the mean (one 200ms stall must not average away)
//   • counted events are per-second in THAT MODE's dwell, not per wall-clock second
//   • a clamped (audible flam) event and a dropped (silent) one are never conflated
//   • the pre-install suppression a deck applies is NOT counted as a dropout
import { readFileSync } from 'node:fs';
import {
  AudioTelemetry, Samples, RateCounter, classifyMotion, formatLive, formatTable,
  MOTION_MODES, MOTION_ORDER, MOTION_ROTATION_DEADBAND, MOTION_TRANSLATION_DEADBAND, audioTelemetry,
} from '../audio-telemetry.js';
import { LATE_EVENT_TOLERANCE_SECONDS } from '../spatial-grid-row-player.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ COSMOS AUDIO TELEMETRY — assertions ═══');

console.log('\n  Motion classification (the experiment\'s independent variable)');
check('a still camera reads STILL, and drift inside the deadband is still STILL',
  classifyMotion({}) === MOTION_MODES.STILL &&
  classifyMotion({ rotationRate: MOTION_ROTATION_DEADBAND * 0.5, translationRate: MOTION_TRANSLATION_DEADBAND * 0.5 }) === MOTION_MODES.STILL);
check('pure rotation reads STEER — the arrow-key case that rules out solve/compile churn',
  classifyMotion({ rotationRate: 0.9 }) === MOTION_MODES.STEER);
check('translation reads FLY, and WINS when both are moving (it is the more expensive motion)',
  classifyMotion({ translationRate: 40 }) === MOTION_MODES.FLY &&
  classifyMotion({ rotationRate: 0.9, translationRate: 40 }) === MOTION_MODES.FLY);
check('sign is irrelevant — flying backwards or turning left are the same modes',
  classifyMotion({ translationRate: -40 }) === MOTION_MODES.FLY && classifyMotion({ rotationRate: -0.9 }) === MOTION_MODES.STEER);

console.log('\n  Samples — the TAIL is the signal (a mean would hide the stall that causes the flam)');
const s = new Samples(8);
for (const v of [4, 4, 4, 4, 4, 4, 4, 200]) s.add(v);
check('p95 and max surface a lone outlier that the mean buries', s.p95 >= 200 && s.max === 200 && s.mean < 30);
check('p50 still reports the typical frame', s.p50 === 4);
check('the ring is capacity-bounded but counts everything it saw',
  (() => { const r = new Samples(4); for (let i = 0; i < 100; i++) r.add(i); return r.sampled === 4 && r.count === 100; })());
check('non-finite samples are ignored rather than poisoning the order statistics',
  (() => { const r = new Samples(); r.add(NaN); r.add(undefined); r.add(5); return r.sampled === 1 && r.p50 === 5; })());
check('an empty meter reports zeros, never NaN (a readout must never print NaN)',
  (() => { const r = new Samples(); return r.p50 === 0 && r.p95 === 0 && r.max === 0 && r.mean === 0; })());

console.log('\n  RateCounter — deltas of an external monotonic counter');
const rc = new RateCounter();
check('the first sample only establishes the baseline (no rate from one reading)', rc.sample(100, 1000) === 0);
check('a delta over a known interval becomes a per-second rate', rc.sample(110, 2000) === 10);
check('a counter that resets downward reports 0, never a negative rate', rc.sample(5, 3000) === 0);

console.log('\n  Per-mode bucketing (the whole point: still vs steer vs fly, no stopwatch)');
const t = new AudioTelemetry();
t.frame({ rotationRate: 0, translationRate: 0, dtSeconds: 1 });
t.phase('field', 2);
t.lateEvent(1, true);
t.frameEnd(5);
t.frame({ rotationRate: 0.5, translationRate: 0, dtSeconds: 2 });
t.phase('field', 40);
t.lateEvent(80, true); t.lateEvent(500, false);
t.frameEnd(60);
const report = t.report();
const row = mode => report.rows.find(r => r.mode === mode);
check('every motion mode gets a row, in a stable order',
  report.rows.length === MOTION_ORDER.length && report.rows.map(r => r.mode).join() === MOTION_ORDER.join());
check('phases and frame costs land in the mode that was current when they were recorded',
  row('still').phases.find(p => p.name === 'field').p95 === 2 && row('steer').phases.find(p => p.name === 'field').p95 === 40 &&
  row('still').frameP95 === 5 && row('steer').frameP95 === 60);
check('a clamped event (audible flam) and a dropped one (silence) are counted SEPARATELY',
  row('steer').clampedPerSec === 0.5 && row('steer').droppedPerSec === 0.5 && row('still').droppedPerSec === 0);
// 1 clamped event in 2 seconds of steering = 0.5/s. Dividing by that mode's OWN dwell is what makes the
// rows comparable — per wall-clock second, a mode you were briefly in would read as near-zero activity.
check('counted events are per-second of THAT MODE\'S dwell, not of wall-clock',
  row('steer').seconds === 2 && row('still').seconds === 1 && row('still').clampedPerSec === 1);
check('an unvisited mode reports zeros rather than dividing by zero', row('fly').clampedPerSec === 0 && row('fly').frames === 0);
check('lateness percentiles are reported per mode', row('steer').latenessP95 >= 80 && row('still').latenessP95 <= 1);

console.log('\n  External counters fold in as DELTAS (absolute totals would be attributed wholesale)');
const c = new AudioTelemetry();
c.frame({ dtSeconds: 1 });
c.counters({ installs: 100, compiles: 50 });          // baseline only
c.counters({ installs: 103, compiles: 50 });
check('the first read establishes a baseline; only the increase is charged to the bucket',
  c.report().rows.find(r => r.mode === MOTION_MODES.STILL).installsPerSec === 3);
c.frame({ rotationRate: 0.5, dtSeconds: 1 });
c.counters({ installs: 103, compiles: 50 });
check('a mode with no new counter activity reports 0.0 — the prediction for steer',
  c.report().rows.find(r => r.mode === MOTION_MODES.STEER).installsPerSec === 0 &&
  c.report().rows.find(r => r.mode === MOTION_MODES.STEER).compilesPerSec === 0);
check('an unknown counter key is ignored rather than inventing a row',
  (() => { const x = new AudioTelemetry(); x.frame({ dtSeconds: 1 }); x.counters({ nonsense: 5 }); return x.report().rows[0].installsPerSec === 0; })());
check('reset clears every bucket AND the delta baselines',
  (() => { c.reset(); const r = c.report(); return r.rows.every(row => row.frames === 0 && row.installsPerSec === 0); })());

console.log('\n  Readouts (pure string building, so the format is pinned without a browser)');
const live = formatLive(t.report());
check('the live line names the current mode and the numbers the mechanism predicts',
  live.includes('steer') && live.includes('frame p50') && live.includes('late p95') &&
  live.includes('clamped') && live.includes('dropped') && live.includes('installs') && live.includes('compiles'));
check('the live line never prints NaN or undefined', !/NaN|undefined/.test(live));
const table = formatTable(t.report());
check('the table has a row per VISITED mode and columns for the whole causal chain',
  table.includes('still') && table.includes('steer') && !/^fly/m.test(table) &&
  table.includes('tick-p95') && table.includes('late-p95') && table.includes('installs/s') && table.includes('midi-steal/s'));
check('the table never prints NaN or undefined', !/NaN|undefined/.test(table));
check('a shared singleton is exported for the running instrument', audioTelemetry instanceof AudioTelemetry);

console.log('\n  What the panel measures in the player (source scan — the flam it is built to expose)');
const player = readFileSync(new URL('../spatial-grid-row-player.js', import.meta.url), 'utf8');
check('the 30ms late tolerance is a NAMED constant, not a literal buried in the scheduler',
  LATE_EVENT_TOLERANCE_SECONDS === 0.03 && player.includes('LATE_EVENT_TOLERANCE_SECONDS') &&
  !/now - 0\.03/.test(player));
check('late events are counted before the clamp acts on them, split by emitted-vs-dropped',
  player.includes('this.telemetry.lateEvent((now - when) * 1000, when >= now - LATE_EVENT_TOLERANCE_SECONDS)'));
// A deck must not sound the loop tail it was seeded from; counting that as a dropout would report one every
// install and drown the real signal in exactly the condition (flight churn) under investigation.
check('the deliberate pre-install suppression is NOT counted as a dropout',
  player.includes('when >= deck.startTime'));
check('the telemetry sink is optional, so a headless player can be built without one',
  player.includes('telemetry = null'));
const audio = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
check('the transport times its own tick arrival (main-thread starvation is the first link)',
  audio.includes('audioTelemetry.tick(wall - lastSchedulerTickAt)') && audio.includes('lastSchedulerTickAt = null'));
check('the row player is handed the meter, and its counters are exposed for the panel',
  audio.includes('new SpatialGridRowPlayer(audioCtx, rowsGain, detuneBus, midiBridge, audioTelemetry)') &&
  audio.includes('export function rowPlayerStats()'));
const flight = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
check('the frame classifies motion AFTER the camera steps, and closes the frame it opened',
  flight.includes('audioTelemetry.frame({ rotationRate, translationRate, dtSeconds: dt })') &&
  flight.includes('audioTelemetry.frameEnd('));
check('the suspect phase is timed by name, so the field update can be seen in isolation',
  flight.includes("phase('field')") && flight.includes("phase('proj')") && flight.includes("phase('web')"));
check('an anchor hop counts as translation however little the offset moved',
  flight.includes('cam.anchor !== telemetryAnchor ? Infinity : 0'));

console.log(PASS ? '\n✓✓✓ COSMOS AUDIO TELEMETRY PASSES' : '\n✗ COSMOS AUDIO TELEMETRY FAILED');
process.exit(PASS ? 0 : 1);
