// flight-boot.js — the single ES-module island that bridges the LRC site and the Flight-View cosmos.
// Purely additive: it wires the title-bar cosmos icon (full-swallow ENTER) and the minimized #lrc-div
// (EXIT), toggling the `cosmos-active` body class that CSS uses to hide the page chrome/panels and reveal
// the full-canvas #cosmos-view. It never touches the engine modules (LRCModule/LRCSearch/LRCHudController).
import { ensureFlight, stopFlight } from './flight-view.js';
import { M } from './mode.js';
import { initAudio, resumeAudio, panicMidiOut } from './cosmos-audio.js';
import { ensureRail, resetRailForEntry, applyRailToEngine } from './rail-view.js';

// ENTER: swallow the page and start flying. Add the class FIRST so the overlay/canvas have layout before
// ensureFlight()'s resize() reads clientWidth/Height (the class change forces a synchronous reflow on read).
function enterCosmos() {
  const canvas = document.getElementById('cosmos-canvas');
  const hud = document.getElementById('cosmos-hud');
  if (!canvas) { console.warn('[cosmos] #cosmos-canvas missing — overlay not in the page'); return; }
  document.body.classList.add('cosmos-active');   // CSS: hide title bar + panels, show #cosmos-view full-viewport
  M.mode = 'flight';
  ensureFlight(canvas, hud);
  initAudio(); resumeAudio();   // user-gesture unlock for the cosmos-audio transport (autoplay policy)
  ensureRail();                 // mount the performance rail over the live graph (idempotent — first entry only)
  resetRailForEntry();          // front face + transient buttons always start clean on every entry
  applyRailToEngine();          // …then RESTORE its state into the fresh graph. Every entry: initAudio()
                                //   rebuilds the buses at the engine's own defaults, so this — not the
                                //   one-shot mount above — is what makes the rail the engine's owner.
}

// EXIT: expand the minimized #lrc-div → restore the interface AND terminate every flight worker (no
// background compute once the engine UI is back). Whatever rhythm was last applied is already loaded.
function exitCosmos() {
  M.mode = 'engine';
  stopFlight();                                   // terminate the worker pool + stop the rAF loop
  document.body.classList.remove('cosmos-active');
}

window.enterCosmos = enterCosmos;   // exposed for console / future callers
window.exitCosmos = exitCosmos;

// Wire the icon once (idempotent — safe if this ever runs twice). #lrc-div's own interaction (cockpit
// toggle / double-click exit) is wired by flight-view.js, which owns the overlay DOM + the loop + the
// lead voice state — see its `bound` one-time setup.
function wire() {
  const icon = document.getElementById('cosmos-enter-btn');
  if (icon && !icon._cosmosWired) { icon._cosmosWired = true; icon.addEventListener('click', enterCosmos); }
}

// MIDI stuck-note guard: a hard refresh / tab close / Chrome quit never calls exitCosmos → stopAudio, so
// held MIDI notes would hang on the receiving DAW/synth (audio outliving the browser — the receiver holds
// them). pagehide fires synchronously on all of those; panicMidiOut blasts All-Sound/Notes-Off. No-op when
// MIDI-out is off. (Home/Esc already flush via stopAudio; visibilitychange is deliberately NOT used —
// switching tabs must not cut the performance.)
window.addEventListener('pagehide', panicMidiOut);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
