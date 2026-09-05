// cosmos/audio-telemetry.js — the audio clock's instrument panel. PURE (no DOM, no WebAudio, injected
// clock), so the meters and the report format are headless-guardable; cosmos-audio owns an instance and
// feeds it, flight-view times the frame and prints it.
//
// WHY THIS EXISTS — the hypothesis it is built to falsify (2026-07-29). MIDI notes "drag"/repeat and audio
// drops out while the camera MOVES, including under ARROW keys, which are pure rotation (flight-view's
// stepControls only touches cam.yaw/cam.pitch). Rotation changes no zone membership, no distance, and no
// programKey — so `chooseSpatialRows` returns the same set and `setField` pends no deck. Solve/compile
// churn therefore CANNOT be the cause, and what is left is per-frame COST and how the transport reacts:
//
//   updateGridRowField runs every rAF frame (walks every zone, chooses rows twice, re-automates every
//   star) → the main thread janks → the 25ms setInterval scheduler runs late → late events are not
//   dropped but CLAMPED TO `now` (spatial-grid-row-player's `Math.max(now, when)` under a 30ms slop, and
//   cosmos-midi-out's `Math.max(performance.now(), …)`) → a spread of notes lands as one flam → the
//   15-channel MPE pool exhausts → channel steals + drops.
//
// PREDICTION, which this panel tests directly: under `steer`, installs/s and compiles/s stay ZERO while
// lateness, clamped/s and MIDI steals/s all rise. If installs or compiles climb instead, the diagnosis is
// wrong and the cause is upstream in the field update, not in the clock.
//
// The meters bucket everything BY MOTION MODE, so the experiment needs no stopwatch: sit still, steer,
// fly, then dump the table and compare rows.

export const MOTION_MODES = Object.freeze({ STILL: 'still', STEER: 'steer', FLY: 'fly' });
export const MOTION_ORDER = Object.freeze([MOTION_MODES.STILL, MOTION_MODES.STEER, MOTION_MODES.FLY]);

// Deadbands: a hand resting on the mouse and float drift in the camera basis must both read as STILL, or
// every bucket becomes `steer`. Translation wins when both are moving — it is the more expensive motion
// (it spawns/evicts zones and moves every star), so attributing a shared frame to `fly` is honest.
export const MOTION_ROTATION_DEADBAND = 0.01;     // rad/s
export const MOTION_TRANSLATION_DEADBAND = 1.0;   // world units/s

export function classifyMotion({ rotationRate = 0, translationRate = 0 } = {}) {
  if (Math.abs(translationRate) > MOTION_TRANSLATION_DEADBAND) return MOTION_MODES.FLY;
  if (Math.abs(rotationRate) > MOTION_ROTATION_DEADBAND) return MOTION_MODES.STEER;
  return MOTION_MODES.STILL;
}

// A fixed-capacity sample ring with order statistics. Percentiles, not means: the failure here is a TAIL
// (one 200ms stall inside a second of 4ms frames is inaudible as a mean and catastrophic as a flam), so a
// mean would hide exactly the thing being measured.
export class Samples {
  constructor(capacity = 512) { this.capacity = Math.max(1, capacity | 0); this.values = []; this.next = 0; this.count = 0; }
  add(value) {
    if (!Number.isFinite(value)) return;
    this.count++;
    if (this.values.length < this.capacity) this.values.push(value);
    else { this.values[this.next] = value; this.next = (this.next + 1) % this.capacity; }
  }
  reset() { this.values = []; this.next = 0; this.count = 0; }
  get sampled() { return this.values.length; }
  quantile(q) {
    if (!this.values.length) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
    return sorted[index];
  }
  get p50() { return this.quantile(0.5); }
  get p95() { return this.quantile(0.95); }
  get max() { return this.values.length ? this.values.reduce((a, b) => (b > a ? b : a), -Infinity) : 0; }
  get mean() { return this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : 0; }
}

// Per-second rate from a monotonically increasing external counter (pool totals, MIDI stats). Holds the
// last computed rate between windows so a sub-second read still reports something meaningful.
export class RateCounter {
  constructor() { this.last = null; this.lastAt = null; this.rate = 0; }
  // total: the counter's current value. nowMs: injected clock. Returns the current per-second rate.
  sample(total, nowMs) {
    if (!Number.isFinite(total)) return this.rate;
    if (this.last === null) { this.last = total; this.lastAt = nowMs; return this.rate; }
    const elapsed = (nowMs - this.lastAt) / 1000;
    if (elapsed <= 0) return this.rate;
    this.rate = Math.max(0, total - this.last) / elapsed;
    this.last = total; this.lastAt = nowMs;
    return this.rate;
  }
  reset() { this.last = null; this.lastAt = null; this.rate = 0; }
}

// One motion mode's accumulator. `seconds` is how long the camera has been in this mode, so counted events
// become honest per-second rates for that mode alone rather than for wall-clock.
class ModeBucket {
  constructor(mode) {
    this.mode = mode;
    this.seconds = 0;
    this.frames = 0;
    this.frame = new Samples();                      // total frame ms
    this.phases = new Map();                         // phase name → Samples of ms
    this.lateness = new Samples();                   // ms an event was late when the scheduler reached it
    this.tickGap = new Samples();                    // ms between consecutive scheduler ticks
    this.gauges = new Map();                         // name → Samples of an instantaneous level
    // bed* were added after the bed turned out to be the churn nobody was watching: it has no worker and no
    // pool, so every existing meter read zero while sustained rotation was burying the audio thread in
    // oscillators. `bedLiveOscs` is the one that matters — a GAUGE, because the danger is a level, not a rate.
    this.counts = { clamped: 0, dropped: 0, installs: 0, entries: 0, exits: 0, midiNotes: 0, midiSteals: 0, midiDropped: 0, compiles: 0,
      bedCreated: 0, bedReleased: 0, bedRefused: 0 };
  }
  phase(name) { let s = this.phases.get(name); if (!s) this.phases.set(name, s = new Samples()); return s; }
  gauge(name) { let s = this.gauges.get(name); if (!s) this.gauges.set(name, s = new Samples()); return s; }
  perSecond(key) { return this.seconds > 0 ? this.counts[key] / this.seconds : 0; }
}

export class AudioTelemetry {
  constructor() { this.buckets = new Map(MOTION_ORDER.map(m => [m, new ModeBucket(m)])); this.mode = MOTION_MODES.STILL; }

  bucket(mode = this.mode) { return this.buckets.get(mode) || this.buckets.get(MOTION_MODES.STILL); }

  // Call at the TOP of a rendered frame, after the camera has been stepped: it fixes the motion mode that
  // every phase(), lateEvent() and counters() call for the rest of the frame is attributed to, and accrues
  // the frame's wall time into that mode's dwell. Mode must be set before the phases, not after, or a
  // frame's costs land in whichever bucket the PREVIOUS frame was in.
  frame({ rotationRate, translationRate, dtSeconds }) {
    this.mode = classifyMotion({ rotationRate, translationRate });
    const bucket = this.bucket();
    bucket.frames++;
    if (Number.isFinite(dtSeconds)) bucket.seconds += Math.max(0, dtSeconds);
    return this.mode;
  }

  // Call at the BOTTOM of the frame with its total duration in ms.
  frameEnd(frameMs) { this.bucket().frame.add(frameMs); }

  phase(name, ms) { this.bucket().phase(name).add(ms); }

  // An instantaneous LEVEL rather than a count — live oscillators, voices held. Reported as p95/max, since
  // what matters is the worst level reached in this mode, not its average.
  gauge(name, value) { this.bucket().gauge(name).add(value); }

  // A scheduler tick's arrival: gapMs is the wall gap since the previous tick. The interval is nominal, so
  // gap − nominal is starvation, which is the mechanism's first link.
  tick(gapMs) { this.bucket().tickGap.add(gapMs); }

  // One scheduled event the transport reached LATE. latenessMs > 0 means its `when` had already passed.
  // emitted=true is the clamp-to-now path (a flam contributor); emitted=false is a silent drop (a dropout).
  lateEvent(latenessMs, emitted) {
    const bucket = this.bucket();
    bucket.lateness.add(latenessMs);
    if (emitted) bucket.counts.clamped++; else bucket.counts.dropped++;
  }

  // A recovery seek drops a whole overdue range without visiting each event. Keep exact drop counts;
  // record its worst lateness once so telemetry itself cannot recreate the skipped scheduling work.
  lateEventsSkipped(count, maxLatenessMs) {
    const bucket = this.bucket();
    bucket.lateness.add(maxLatenessMs);
    bucket.counts.dropped += count;
  }

  // External monotonic counters (player stats, MIDI stats, compile pool) folded in as DELTAS, so each
  // mode's bucket only carries what happened while the camera was in that mode.
  counters(totals) {
    if (!this._prev) this._prev = {};
    const bucket = this.bucket();
    for (const [key, value] of Object.entries(totals || {})) {
      if (!Number.isFinite(value) || !(key in bucket.counts)) continue;
      const previous = this._prev[key];
      if (previous !== undefined && value >= previous) bucket.counts[key] += value - previous;
      this._prev[key] = value;
    }
  }

  reset() { for (const mode of MOTION_ORDER) this.buckets.set(mode, new ModeBucket(mode)); this._prev = undefined; }

  // Plain data — no formatting, no DOM. One row per motion mode.
  report() {
    return {
      mode: this.mode,
      rows: MOTION_ORDER.map(mode => {
        const b = this.bucket(mode);
        return {
          mode, seconds: b.seconds, frames: b.frames,
          frameP50: b.frame.p50, frameP95: b.frame.p95, frameMax: b.frame.max,
          phases: [...b.phases].map(([name, s]) => ({ name, p50: s.p50, p95: s.p95 })),
          gauges: [...b.gauges].map(([name, s]) => ({ name, p95: s.p95, max: s.max })),
          tickGapP95: b.tickGap.p95, tickGapMax: b.tickGap.max,
          latenessP50: b.lateness.p50, latenessP95: b.lateness.p95, latenessMax: b.lateness.max,
          clampedPerSec: b.perSecond('clamped'), droppedPerSec: b.perSecond('dropped'),
          installsPerSec: b.perSecond('installs'), entriesPerSec: b.perSecond('entries'), exitsPerSec: b.perSecond('exits'),
          midiNotesPerSec: b.perSecond('midiNotes'), midiStealsPerSec: b.perSecond('midiSteals'), midiDroppedPerSec: b.perSecond('midiDropped'),
          compilesPerSec: b.perSecond('compiles'),
          bedCreatedPerSec: b.perSecond('bedCreated'), bedReleasedPerSec: b.perSecond('bedReleased'), bedRefusedPerSec: b.perSecond('bedRefused'),
          bedLiveOscP95: b.gauge('bedLiveOscs').p95, bedLiveOscMax: b.gauge('bedLiveOscs').max,
        };
      }),
    };
  }
}

// The one meter the running instrument feeds: cosmos-audio times its scheduler and injects it into the row
// player, flight-view times the frame and folds in the pool/MIDI counters. A singleton for the same reason
// railParams is one — two meters would each see half the picture.
export const audioTelemetry = new AudioTelemetry();

const n1 = value => (Math.round(value * 10) / 10).toFixed(1);

// The live one-liner for the per-second heartbeat: the CURRENT mode's numbers only.
export function formatLive(report) {
  const row = report.rows.find(r => r.mode === report.mode);
  if (!row) return '';
  const phases = row.phases.map(p => `${p.name} ${n1(p.p50)}`).join(' · ');
  return `[cosmos audio] ${row.mode} · frame p50 ${n1(row.frameP50)}ms p95 ${n1(row.frameP95)}ms` +
    (phases ? ` (${phases})` : '') +
    ` · tick-gap p95 ${n1(row.tickGapP95)}ms · late p95 ${n1(row.latenessP95)}ms` +
    ` · clamped ${n1(row.clampedPerSec)}/s dropped ${n1(row.droppedPerSec)}/s` +
    ` · midi ${n1(row.midiNotesPerSec)}n ${n1(row.midiStealsPerSec)}steal ${n1(row.midiDroppedPerSec)}drop /s` +
    ` · installs ${n1(row.installsPerSec)}/s · compiles ${n1(row.compilesPerSec)}/s` +
    ` · bed ${n1(row.bedCreatedPerSec)}new ${n1(row.bedReleasedPerSec)}rel ${n1(row.bedRefusedPerSec)}refused /s` +
    ` · bed-oscs p95 ${n1(row.bedLiveOscP95)} max ${n1(row.bedLiveOscMax)}`;
}

// The comparison table — the actual experiment. Sit still, steer, fly, then dump this: the prediction is
// that `installs` and `compiles` stay 0.0 across all three rows while `late`/`clamped`/`steal` climb from
// still → steer → fly.
export function formatTable(report) {
  const head = 'mode   dwell  frames  frame-p50  frame-p95  tick-p95  late-p95  clamped/s  dropped/s  installs/s  compiles/s  midi-steal/s  bed-new/s  bed-refused/s  bed-oscs-max';
  const lines = report.rows.filter(row => row.frames > 0).map(row => [
    row.mode.padEnd(6), `${n1(row.seconds)}s`.padStart(6), String(row.frames).padStart(7),
    `${n1(row.frameP50)}ms`.padStart(10), `${n1(row.frameP95)}ms`.padStart(10),
    `${n1(row.tickGapP95)}ms`.padStart(9), `${n1(row.latenessP95)}ms`.padStart(9),
    n1(row.clampedPerSec).padStart(10), n1(row.droppedPerSec).padStart(10),
    n1(row.installsPerSec).padStart(11), n1(row.compilesPerSec).padStart(11), n1(row.midiStealsPerSec).padStart(13),
    n1(row.bedCreatedPerSec).padStart(10), n1(row.bedRefusedPerSec).padStart(14), n1(row.bedLiveOscMax).padStart(13),
  ].join(' '));
  const phaseLines = report.rows.filter(row => row.phases.length).map(row =>
    `  ${row.mode.padEnd(6)} phases p95: ${row.phases.map(p => `${p.name} ${n1(p.p95)}ms`).join(' · ')}`);
  return [head, ...lines, ...phaseLines].join('\n');
}
