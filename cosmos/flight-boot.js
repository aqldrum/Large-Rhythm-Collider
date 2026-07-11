// flight-boot.js — the single ES-module island that bridges the LRC site and the Flight-View cosmos.
// Purely additive: it wires the title-bar cosmos icon (full-swallow ENTER) and the minimized #lrc-div
// (EXIT), toggling the `cosmos-active` body class that CSS uses to hide the page chrome/panels and reveal
// the full-canvas #cosmos-view. It never touches the engine modules (LRCModule/LRCSearch/LRCHudController).
import { ensureFlight, stopFlight } from './flight-view.js';
import { M } from './mode.js';

// ENTER: swallow the page and start flying. Add the class FIRST so the overlay/canvas have layout before
// ensureFlight()'s resize() reads clientWidth/Height (the class change forces a synchronous reflow on read).
function enterCosmos() {
  const canvas = document.getElementById('cosmos-canvas');
  const hud = document.getElementById('cosmos-hud');
  if (!canvas) { console.warn('[cosmos] #cosmos-canvas missing — overlay not in the page'); return; }
  document.body.classList.add('cosmos-active');   // CSS: hide title bar + panels, show #cosmos-view full-viewport
  M.mode = 'flight';
  ensureFlight(canvas, hud);
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

// Wire the icon + exit handle once (idempotent — safe if this ever runs twice).
function wire() {
  const icon = document.getElementById('cosmos-enter-btn');
  if (icon && !icon._cosmosWired) { icon._cosmosWired = true; icon.addEventListener('click', enterCosmos); }
  const lrcDiv = document.getElementById('lrc-div');
  if (lrcDiv && !lrcDiv._cosmosWired) { lrcDiv._cosmosWired = true; lrcDiv.addEventListener('click', exitCosmos); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
