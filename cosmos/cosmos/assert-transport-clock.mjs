// assert-transport-clock.mjs — proofs for the transport's PULSE and its late-event POLICY
// (../transport-clock.js), the fix for the measured mechanism behind "MIDI notes drag while the camera
// moves". Two independent claims, both guarded here:
//
//   1. The pulse must not live on the main thread. It is starved by the flight loop's per-frame work and
//      clamped to 1Hz outright in a hidden tab (measured 1001ms against a 25ms nominal). A worker timer
//      cannot be starved by frame cost — but it must degrade to setInterval rather than ever going silent.
//   2. A late event must not be DISPLACED into the wrong place. The old scheduler clamped anything within
//      30ms to `now`, which turns a starved pulse into a flam — a spread of onsets attacking together. A
//      rhythm is its spacing, so past the articulation threshold the honest outcome is a counted silence.
import { readFileSync } from 'node:fs';
import {
  TransportClock, TRANSPORT_TICK_MS, SCHEDULE_AHEAD_SECONDS,
  classifyLateEvent, LATE_CLAMP_TOLERANCE_SECONDS,
} from '../transport-clock.js';
import { ROW_MICRO_GAP_SECONDS } from '../spatial-grid-row-player.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

// A fake worker: records what it was told and lets the test fire ticks by hand.
const makeFakeWorker = () => {
  const w = { messages: [], terminated: false, onmessage: null, onerror: null,
    postMessage(m) { this.messages.push(m); }, terminate() { this.terminated = true; } };
  return w;
};
// A fake timer pair, so the fallback path is observable without real time passing.
const makeFakeTimers = () => {
  const t = { started: 0, cleared: 0, callbacks: [],
    setInterval(fn) { t.started++; t.callbacks.push(fn); return t.started; },
    clearInterval() { t.cleared++; } };
  return t;
};

console.log('═══ COSMOS TRANSPORT CLOCK — assertions ═══');

console.log('\n  The pulse prefers a worker (frame cost cannot starve another thread)');
const worker = makeFakeWorker();
const timers = makeFakeTimers();
const clock = new TransportClock({ workerFactory: () => worker, timers, intervalMs: TRANSPORT_TICK_MS });
let ticks = 0;
check('start() reports the worker source and never touches the main-thread timer',
  clock.start(() => ticks++) === 'worker' && timers.started === 0);
check('the worker is told the cadence, so the pulse rate lives in ONE place',
  worker.messages.length === 1 && worker.messages[0].op === 'start' && worker.messages[0].intervalMs === TRANSPORT_TICK_MS);
worker.onmessage();
worker.onmessage();
check('a worker message pulses the scheduler callback', ticks === 2);
check('start() is idempotent — re-starting a running clock re-points it without a second pulse source',
  clock.start(() => { ticks += 10; }) === 'worker' && worker.messages.length === 1 && timers.started === 0);
worker.onmessage();
check('…and the new callback is the one that receives ticks', ticks === 12);

console.log('\n  It degrades, it never goes silent');
const dying = makeFakeWorker();
const dyingTimers = makeFakeTimers();
const dyingClock = new TransportClock({ workerFactory: () => dying, timers: dyingTimers });
let dyingTicks = 0;
dyingClock.start(() => dyingTicks++);
dying.onerror(new Error('worker died'));
check('a worker that dies mid-session falls back to the timer IN PLACE (the transport keeps running)',
  dyingClock.source === 'timer' && dying.terminated && dyingTimers.started === 1);
dyingTimers.callbacks.at(-1)();
check('the fallback timer drives the same callback', dyingTicks === 1);
const blockedTimers = makeFakeTimers();
const blocked = new TransportClock({ workerFactory: () => { throw new Error('CSP'); }, timers: blockedTimers });
check('a Worker constructor that THROWS (CSP, file://) falls back instead of breaking audio',
  blocked.start(() => {}) === 'timer' && blockedTimers.started === 1);
const none = new TransportClock({ workerFactory: null, timers: makeFakeTimers() });
check('no factory at all still yields a running clock (headless / guard use)', none.start(() => {}) === 'timer');

console.log('\n  stop() releases both possible sources');
clock.stop();
check('stopping a worker clock tells it to stop AND terminates it (no orphan pulse after exit)',
  worker.messages.at(-1).op === 'stop' && worker.terminated && clock.source === 'stopped');
blocked.stop();
check('stopping a timer clock clears the interval', blockedTimers.cleared === 1 && blocked.source === 'stopped');
check('a stopped clock can be started again (exit → re-enter cosmos)',
  (() => { const w2 = makeFakeWorker(); const c = new TransportClock({ workerFactory: () => w2, timers: makeFakeTimers() }); c.start(() => {}); const ok = c.source === 'worker'; c.stop(); return ok; })());

console.log('\n  The lookahead must exceed the worst pulse gap, or lateness is structural');
// This is the design relationship, not a preference: while SCHEDULE_AHEAD > the worst tick gap, no event is
// ever reached late, so neither the clamp nor the drop can fire at all.
check('the horizon is many pulses deep (a ten-tick stall is absorbed)',
  SCHEDULE_AHEAD_SECONDS * 1000 >= TRANSPORT_TICK_MS * 10);
check('…and it is wider than the old 100ms, which was smaller than the measured 1001ms stall',
  SCHEDULE_AHEAD_SECONDS > 0.1);

console.log('\n  Late-event policy: silence over displacement');
check('an on-time event is emitted at its own time, unclamped',
  (() => { const r = classifyLateEvent(10, 9.9); return r.action === 'emit' && !r.clamped && r.latenessSeconds === 0; })());
check('an event late by less than the articulation threshold is emitted, clamped, and reported as late',
  (() => { const r = classifyLateEvent(10, 10.005); return r.action === 'emit' && r.clamped && Math.abs(r.latenessSeconds - 0.005) < 1e-9; })());
check('an audibly late event is DROPPED rather than stacked at `now` (this is the anti-flam rule)',
  (() => { const r = classifyLateEvent(10, 10.2); return r.action === 'drop' && !r.clamped && Math.abs(r.latenessSeconds - 0.2) < 1e-9; })());
// The tolerance is not arbitrary: below the micro-gap two attacks are not separately articulated, so a
// clamp inside it cannot be heard as displacement — which is exactly why it is safe to keep it non-zero.
check('the clamp tolerance sits at the articulation threshold, not above it',
  LATE_CLAMP_TOLERANCE_SECONDS > 0 && LATE_CLAMP_TOLERANCE_SECONDS <= ROW_MICRO_GAP_SECONDS);
// Just inside / just outside, NOT the exact boundary: `10 + 0.012 - 10` is 0.012000000000000455 in binary
// floating point, so which side the knife-edge lands on is a float artefact. A half-nanosecond of lateness
// has no musical meaning, so the contract worth pinning is monotonic behaviour AROUND the threshold.
check('the decision is monotonic around the tolerance — inside emits, outside drops',
  classifyLateEvent(10, 10 + LATE_CLAMP_TOLERANCE_SECONDS * 0.9).action === 'emit' &&
  classifyLateEvent(10, 10 + LATE_CLAMP_TOLERANCE_SECONDS * 1.1).action === 'drop');
check('a custom tolerance of zero drops anything late at all', classifyLateEvent(10, 10.0001, 0).action === 'drop');

console.log('\n  Wiring (source scan)');
const audio = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
check('cosmos-audio pulses the transport from the clock, not from its own setInterval',
  audio.includes('schedulerClock = new TransportClock(') && audio.includes('schedulerClock.start(schedulerTick)') &&
  !/setInterval\(schedulerTick/.test(audio));
check('the worker URL resolves against the MODULE (it breaks against the document under the full-swallow)',
  audio.includes("new URL('./cosmos/transport-clock-worker.js?v=1', import.meta.url)"));
check('exit stops the clock, terminating the pulse worker with the rest of the engine',
  audio.includes('schedulerClock.stop(); schedulerClock = null;'));
check('the tick cadence and the horizon both come from the clock module (one definition each)',
  audio.includes('const LOOKAHEAD_MS = TRANSPORT_TICK_MS') && audio.includes('const SCHEDULE_AHEAD = SCHEDULE_AHEAD_SECONDS'));
const pulse = readFileSync(new URL('./transport-clock-worker.js', import.meta.url), 'utf8');
check('the pulse worker carries NO musical state — a missed tick can only delay, never desynchronise',
  pulse.includes('self.postMessage(0)') && !/audio|note|tick(Rate|s)\b/i.test(pulse.replace(/\/\/.*$/gm, '')));

const player = readFileSync(new URL('../spatial-grid-row-player.js', import.meta.url), 'utf8');
// The subtle one: a dropped note must cost exactly that note. If the repeat-cull memory only advanced when
// a note SOUNDED, a drop would leave a stale tone in the comparison and change which LATER notes re-strike
// — a silent divergence, and one that would make a streamed window fail an equivalence check.
check('a DROPPED event still advances the layer memory — dropping costs one note, never the sequence after it',
  player.includes('if (!sounding) continue;') &&
  player.indexOf('deck.lastToneByLayer.set(action.layer, action.rawFraction)') < player.indexOf('if (!sounding) continue;'));
check('the pre-install suppression stays separate from lateness (it is not a dropout)',
  player.includes('const afterInstall = when >= deck.startTime'));

console.log('\n  Cutting the cost that starved the pulse: POSE every frame, MEMBERSHIP only on cause');
check('the player can re-aim stars without any membership bookkeeping',
  player.includes('setPose(items)') && player.includes('_applyPose(star, item, now)') &&
  // setPose must not create stars, install programs, or run the exit sweep — that is setField's job alone.
  !/setPose\(items\)\s*\{[\s\S]{0,400}?_makeStar|setPose\(items\)\s*\{[\s\S]{0,400}?star\.pending/.test(player));
check('setField still routes its own pose through the SAME code (one definition of "where a star is")',
  (player.match(/_applyPose\(star, item, now\)/g) || []).length >= 2);
const flight = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
check('a pose-only frame skips the candidate walk, the selection and the compile requests entirely',
  flight.includes('setGridSpatialPose(pose)') && flight.includes('if (!fieldMembershipDirty && nowMs - fieldMembershipAt <'));
check('ROTATION alone never marks membership dirty — only translation does',
  flight.includes('if (translated) markFieldDirty()') && flight.includes('updateGridRowField(placed, basis, translationRate > 0, now)'));
check('every other cause that CAN change membership marks it: chord, zone spawn/evict, a landed compile',
  (flight.match(/markFieldDirty\(\)/g) || []).length >= 5 &&
  flight.includes('onZoneAdded: grid => { webZoneAdded.push(grid); markFieldDirty(); }') &&
  flight.includes('onZoneRemoved: grid => { webZoneRemoved.push(grid); markFieldDirty(); }'));
check('a safety re-run bounds staleness, so an un-enumerated cause delays the field rather than stranding it',
  /FIELD_MEMBERSHIP_MAX_INTERVAL_MS = \d+/.test(flight));
check('a fresh cosmos session always begins with a full membership pass',
  flight.includes('fieldMembershipDirty = true; fieldMembershipAt = -Infinity;'));

console.log('\n  The BED: membership on cause, pose per frame, and a ceiling on REAL nodes');
// The bed was the churn nobody was watching. Its audible set was built from `proj` (the on-screen zones)
// sorted by VIEW DEPTH, so merely turning the camera swung stars out of the frustum — where the hysteresis
// window cannot even see them to protect them — and swung new ones in. Each churn is a release/create cycle:
// new oscillators, plus a discrete MIDI note-on per voice (cosmos-audio's createVoice calls noteOn), which
// is why the same bed chord re-struck every frame in a DAW and why sustained rotation buried the audio
// thread. Rows and the root solver already selected by true 3D distance; the bed now agrees.
check('the bed selects by TRUE 3D DISTANCE, never from the on-screen projection or view depth',
  flight.includes('skyCandidates.push({ z, position, distance: Math.hypot(') &&
  flight.includes('skyCandidates.sort((a, b) => a.distance - b.distance)') &&
  !/for \(const \{ z, s \} of proj\.values\(\)\) if \(z\.skyPool\)/.test(flight) &&
  !/pan: clampN\(\(cx - s\.x\) \/ cx, -1, 1\), gain: distGain\(s\.z\)/.test(flight));
check('pose stays VIEW-relative — turning your head still sweeps a star across the stereo image',
  flight.includes('function skyPoseFor(position, distance, basis)') &&
  flight.includes('toAudioListenerPosition(position, basis)') && flight.includes('listener[0] / azimuth'));
check('membership is gated on the same causes as the row field, plus a root swap',
  flight.includes('if (bedRootKey !== root.rootKey) { bedRootKey = root.rootKey; markFieldDirty(); }') &&
  flight.includes('if (fieldMembershipDirty || now - bedMembershipAt >= FIELD_MEMBERSHIP_MAX_INTERVAL_MS)'));
check('the bed reads the solved root AFTER the root-policy block, so a same-frame swap still lands',
  flight.indexOf('proposeRoot({') < flight.indexOf('const root = currentSkyRoot();\n  // Full Sky'));
const audioSrc = audio;
check('setSkyPose CANNOT create or release a voice — it only automates params',
  /export function setSkyPose\(items\)/.test(audioSrc) &&
  !/export function setSkyPose\(items\)[\s\S]{0,600}?(createVoice|releaseVoice|makeBedStar|dropBedStar|syncBedDegrees)/.test(audioSrc));
check('a star not in the field is never re-aimed (a dropped star must stay dropped while it fades)',
  audioSrc.includes('const bs = bedStars.get(item.id);\n    if (!bs) continue;'));
check('setField (membership) and setSkyPose share ONE pose implementation',
  (audioSrc.match(/applySkyPose\(bs, item, now\)/g) || []).length >= 2);
check('chord voicing rides the AUDIO clock, so a chord change is not gated by the membership interval',
  /stepSkyWalk\(skySeconds\(now\)\);[\s\S]{0,900}?syncBedDegrees\(now\);[\s\S]{0,200}?pumpReattacks\(/.test(audioSrc));
// The logical budget is freed the instant a voice is released, ~2.55s before its oscillator actually stops —
// deliberately, so a release tail cannot starve incoming voices. That is precisely why it cannot be the
// ceiling on live nodes, and why a second, real count is needed.
// The live count is now charged by the voice's ACTUAL source cost (a multi-oscillator palette costs more
// than one), so the hard ceiling bounds real nodes regardless of timbre — the admission still gates on both
// the logical musical-voice budget and the real-source ceiling before any graph is built.
check('there are TWO counts: the eagerly-freed logical budget and a hard ceiling on live oscillators',
  audioSrc.includes('const MAX_BED_LIVE_OSC = MAX_BED_OSC * 3') &&
  audioSrc.includes('if (bedOscCount >= MAX_BED_OSC || bedLiveOscCount + plan.cost > MAX_BED_LIVE_OSC)'));
check('the live count is decremented only when the oscillator actually ENDS (handle.onComplete), not at release',
  /onComplete\(\(\) => \{\n\s*bedLiveOscCount = Math\.max\(0, bedLiveOscCount - v\.cost\)/.test(audioSrc) &&
  !/bedLiveOscCount = Math\.max\(0, bedLiveOscCount - v\.cost\)[\s\S]{0,200}?const rel = immediate/.test(audioSrc));
check('a refused voice is COUNTED — the pathology reports itself instead of the sound merely dying',
  audioSrc.includes('bedCounters.refused++') && audioSrc.includes('export function bedStats()'));
check('both counts reset with the graph, in initAudio and stopAudio',
  (audioSrc.match(/bedLiveOscCount = 0/g) || []).length >= 3);
check('the panel now watches the bed: rates for churn, a GAUGE for the level that buries the audio thread',
  flight.includes("audioTelemetry.gauge('bedLiveOscs', bed.liveOscs)") &&
  flight.includes('bedCreated: bed?.created') && flight.includes('bedRefused: bed?.refused'));

console.log(PASS ? '\n✓✓✓ COSMOS TRANSPORT CLOCK PASSES' : '\n✗ COSMOS TRANSPORT CLOCK FAILED');
process.exit(PASS ? 0 : 1);
