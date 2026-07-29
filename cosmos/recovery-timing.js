// cosmos/recovery-timing.js — TEMP DEBUG instrument for Phase 2.4 (post-move audio recovery).
// PURPOSE: pin whether the "audio drops after a move" is wall-clock (the 3s camera settle + the CPU-bound
// zone solve) or TICK-PACED (row onset density: at a low tick rate onsets are so sparse the rows barely
// sound). It watches ONE episode — you fly, then stop — and records a TRAJECTORY of live row-voice counts
// across a fixed window after the stop, plus the settle / root-resolve / first-install milestones. The
// trajectory shape is the diagnostic: a dip-then-climb = a real recovery gap; a flat line near zero at a
// low tick rate = onsets too sparse to sustain voices (a SPEED/2.1 concern, not a re-solve gap).
//
// v2 fixes two v1 mistakes: (1) it no longer TERMINATES on chordExposure.complete — that flag is usually
// already true at the instant you stop (the chord's degrees were sounded before the flight), so v1 ended
// every episode at +0.0s and measured nothing; exposure is now just an observed milestone. (2) it detects
// movement from the CAMERA POSITION (cameraAbsolute), not camSpeed — camSpeed is only set on the WASD path
// (flight-view.js:940), so scroll/dolly flights never armed the probe.
//
// REMOVAL: delete this file, its import in flight-view.js, and the single sampleRecovery(...) call.

import { debugSkyState } from './cosmos-audio.js';

if (typeof window !== 'undefined') {
  window.__RECOVERY_PROBE_LOADED = true;   // type this in the console to confirm the edited module re-fetched
  console.log('%c[2.4 recovery] probe present but DORMANT — set window.RECOVERY_PROBE=true (no reload) to arm', 'color:#888');
}

const MOVE_SPEED = 5;       // world u/s (matches flight's SETTLE_SPEED) above which we count as "flying"
const WINDOW = 10;          // s (sky) — how long to watch recovery after a stop
const TRAJ_DT = 0.5;        // s (sky) — voice-trajectory sample spacing
const SAMPLE_DT = 0.1;      // s (sky) — throttle the heavy debugSkyState() pull so we don't perturb the loop

let phase = 'idle';                 // 'idle' | 'moving' | 'recovering'
let lastPos = null, lastPosAt = null;
let stopAt = 0, lastSampleAt = -Infinity, lastTrajAt = -Infinity;
let base = null;                    // snapshot at stop: ticksPerSec, mode, voices, installs, rootCents
let minV = Infinity, maxV = 0, minVAt = 0;
let minA = Infinity, maxA = 0;      // active ROW STARS (selected+compiled), vs voices (currently sounding)
let traj = [];                      // live row-voice counts, one per TRAJ_DT
let actTraj = [];                   // active-row-star counts, parallel to traj — separates sparsity from a solve gap
let mile = null;

const blankMiles = () => ({ settled: null, root: null, install: null, firstVoice: null, exposure: null });
const enabled = () => (typeof window !== 'undefined' && window.RECOVERY_PROBE === true);   // dormant by default; arm explicitly
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rel = t => (t == null ? '—' : `+${(t - stopAt).toFixed(2)}`);

function finish(reason) {
  // The active-stars line is the discriminator: active>0 with low voices ⇒ onset sparsity (SPEED/2.1);
  // active==0 ⇒ no selected/compiled row stars ⇒ the selection/solve recovery gap (2.4 proper).
  console.log(
    `[2.4 recovery] mode=${base.mode} ${Math.round(base.ticksPerSec)} t/s · ${reason === 'moved' ? 'INTERRUPTED by re-move' : `${WINDOW}s window`}\n` +
    `   voices: stop=${base.voices} min=${Number.isFinite(minV) ? minV : '—'}@${rel(minVAt)}s max=${maxV}` +
    `${minV === 0 ? ' · HIT ZERO' : ''}   active row stars: min=${Number.isFinite(minA) ? minA : '—'} max=${maxA}\n` +
    `   voices@${TRAJ_DT}s: [${traj.join(', ')}]\n` +
    `   active@${TRAJ_DT}s: [${actTraj.join(', ')}]\n` +
    `   settle ${rel(mile.settled)} · root ${rel(mile.root)} · 1st install ${rel(mile.install)} · ` +
    `first voice ${rel(mile.firstVoice)} · exposure(info) ${rel(mile.exposure)}`,
  );
  phase = 'idle'; base = null; minV = Infinity; maxV = 0; minVAt = 0; minA = Infinity; maxA = 0; traj = []; actTraj = []; mile = null;
}

// Called once per frame from flight-view's loop(), with the camera world position (cameraAbsolute) and the
// settle latch it already computes. Movement is derived here from position delta so it works for WASD,
// dolly/scroll, and web-return rides alike.
export function sampleRecovery({ skyNow, camPos, settled }) {
  if (!enabled() || !camPos) return;
  let speed = 0;
  if (lastPos && lastPosAt != null && skyNow > lastPosAt) speed = dist(camPos, lastPos) / (skyNow - lastPosAt);
  lastPos = camPos; lastPosAt = skyNow;
  const moving = speed > MOVE_SPEED;

  if (moving) {
    if (phase === 'recovering') finish('moved');   // a re-move ends the current window early (report what we have)
    phase = 'moving';
    return;
  }

  if (phase === 'moving') {   // just stopped → open the window, snapshot the baseline
    const s = debugSkyState();
    phase = 'recovering'; stopAt = skyNow; lastSampleAt = -Infinity; lastTrajAt = -Infinity;
    minV = maxV = s.gridRows?.voices ?? 0; minVAt = skyNow;
    minA = maxA = s.gridRows?.activeStars ?? 0; traj = []; actTraj = []; mile = blankMiles();
    base = { ticksPerSec: s.speed?.ticksPerSec ?? 0, mode: s.speed?.mode ?? '?',
             voices: s.gridRows?.voices ?? 0, installs: s.gridRows?.installs ?? 0, rootCents: s.root?.cents ?? 0 };
    console.log(`[2.4 recovery] stop — watching ${WINDOW}s (mode=${base.mode} ${Math.round(base.ticksPerSec)} t/s · rows@stop=${base.voices})`);
    return;
  }

  if (phase !== 'recovering') return;
  if (skyNow - lastSampleAt < SAMPLE_DT) return;    // throttle the heavy pull to ~10 Hz
  lastSampleAt = skyNow;

  const s = debugSkyState();
  const voices = s.gridRows?.voices ?? 0;
  const active = s.gridRows?.activeStars ?? 0;
  if (voices < minV) { minV = voices; minVAt = skyNow; }
  if (voices > maxV) maxV = voices;
  if (active < minA) minA = active;
  if (active > maxA) maxA = active;
  if (mile.settled == null && settled) mile.settled = skyNow;
  if (mile.root == null && Math.abs((s.root?.cents ?? base.rootCents) - base.rootCents) > 0.05) mile.root = skyNow;
  if (mile.install == null && (s.gridRows?.installs ?? 0) > base.installs) mile.install = skyNow;
  if (mile.firstVoice == null && voices > 0) mile.firstVoice = skyNow;
  if (mile.exposure == null && s.chordExposure?.complete) mile.exposure = skyNow;
  if (skyNow - lastTrajAt >= TRAJ_DT) { lastTrajAt = skyNow; traj.push(voices); actTraj.push(active); }

  if (skyNow - stopAt >= WINDOW) finish('window');
}
