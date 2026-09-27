// Cosmos/audio/transport-clock.js — where the audio transport's pulse comes from, and how far ahead it commits.
//
// The transport used to be pulsed by `setInterval` on the main thread, which is the wrong thread for it:
// the flight loop projects every zone and rebuilds the audio field on every frame, so the pulse was starved
// by the renderer (and clamped to 1Hz outright while the tab was hidden — measured at 1001ms against a 25ms
// nominal). A starved pulse arrives after its events were due, and the row scheduler then either clamps
// them all to `now` (a flam) or drops them (a hole). Moving the pulse to a worker fixes the CAUSE; the
// lookahead below is the safety margin for whatever starvation remains.
//
// This module deliberately owns no music: a tick carries no payload, and cosmos-audio's schedulerTick reads
// the AudioContext clock as the only source of truth. A late tick therefore cannot desynchronise anything —
// it can only delay when the next window of notes is scheduled, which the lookahead is sized to absorb.

export const TRANSPORT_TICK_MS = 25;   // pulse cadence (unchanged from the old LOOKAHEAD_MS interval)

// How far ahead the scheduler commits notes. This is the SAFETY MARGIN against a starved pulse, and the
// relationship is the whole design: as long as SCHEDULE_AHEAD exceeds the worst tick gap, no event is ever
// reached late, so neither the clamp nor the drop can fire. It was 100ms against a pulse that measurably
// stalled for 1000ms — four times too small even before frame contention. At 250ms a ten-tick stall is
// absorbed, and the cost is only that a note is committed 250ms before it sounds: deck swaps are already
// quantized to ROW_SWITCH_TICKS, and the chord clock advances on cycle boundaries, so nothing musical
// resolves faster than this horizon anyway.
export const SCHEDULE_AHEAD_SECONDS = 0.25;

// A tick source: a worker timer when one can be built, the old main-thread interval when it cannot (a
// blocked Worker constructor, a file:// document, a headless guard). Callers never branch on which — they
// read `source` only to report it.
export class TransportClock {
  // workerFactory: () => Worker | null. Injected so a headless guard can drive a fake, and so the caller
  // owns the module-relative URL (worker URLs must resolve against the importing module, not the document).
  constructor({ workerFactory = null, intervalMs = TRANSPORT_TICK_MS, timers = null } = {}) {
    this.workerFactory = workerFactory;
    this.intervalMs = Math.max(1, Number(intervalMs) || TRANSPORT_TICK_MS);
    this.timers = timers || { setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a) };
    this.worker = null;
    this.timerId = null;
    this.onTick = null;
    this.source = 'stopped';
  }

  // Idempotent: starting an already-running clock re-points it at the new callback without dropping a beat.
  start(onTick) {
    this.onTick = typeof onTick === 'function' ? onTick : null;
    if (this.source !== 'stopped') return this.source;
    try {
      this.worker = this.workerFactory ? this.workerFactory() : null;
    } catch { this.worker = null; }   // CSP, a bad URL, no Worker in this context — fall back, never throw
    if (this.worker) {
      this.worker.onmessage = () => { this.onTick?.(); };
      // A worker that dies mid-session must not silence the transport: fall back to the timer in place.
      this.worker.onerror = () => { this._fallback(); };
      this.worker.postMessage({ op: 'start', intervalMs: this.intervalMs });
      this.source = 'worker';
    } else {
      this.timerId = this.timers.setInterval(() => this.onTick?.(), this.intervalMs);
      this.source = 'timer';
    }
    return this.source;
  }

  stop() {
    if (this.worker) {
      try { this.worker.postMessage({ op: 'stop' }); } catch {}
      try { this.worker.terminate(); } catch {}
      this.worker = null;
    }
    if (this.timerId !== null) { this.timers.clearInterval(this.timerId); this.timerId = null; }
    this.onTick = null;
    this.source = 'stopped';
  }

  _fallback() {
    if (this.worker) { try { this.worker.terminate(); } catch {} this.worker = null; }
    if (this.timerId === null) this.timerId = this.timers.setInterval(() => this.onTick?.(), this.intervalMs);
    this.source = 'timer';
  }
}

// Pure: what the transport should do with an event it has reached LATE, i.e. whose time has already passed.
//
// The old behaviour was to sound anything within a 30ms slop clamped to `now`, which turns a starved pulse
// into a FLAM — a spread of onsets arriving as one simultaneous attack, and the reason MIDI "drags" while
// the camera moves. A rhythm's identity is its spacing, so a note in the wrong place is worse than a note
// that is missing: past the audible-simultaneity threshold the honest outcome is silence, counted.
//
// The tolerance stays small and non-zero on purpose. Below ROW_MICRO_GAP_SECONDS (12ms) two attacks are not
// separately articulated anyway, so clamping inside that window is inaudible as displacement and is worth
// it to avoid dropping notes over sub-millisecond scheduling noise.
export const LATE_CLAMP_TOLERANCE_SECONDS = 0.012;

// → { action: 'emit' | 'drop', latenessSeconds, clamped }
//   emit + clamped:false — on time, schedule at its own time
//   emit + clamped:true  — late but inaudibly so, schedule at `now`
//   drop                 — audibly late; sounding it would displace the rhythm, so it is skipped
export function classifyLateEvent(when, now, tolerance = LATE_CLAMP_TOLERANCE_SECONDS) {
  const latenessSeconds = now - when;
  if (!(latenessSeconds > 0)) return { action: 'emit', latenessSeconds: 0, clamped: false };
  if (latenessSeconds <= Math.max(0, tolerance)) return { action: 'emit', latenessSeconds, clamped: true };
  return { action: 'drop', latenessSeconds, clamped: false };
}
