// cosmos/rail-view.js — the performance RAIL: owns the knob DOM and binds it BOTH directions to
// railParams (cosmos/rail-params.js). Mirrors the dedicated-module house pattern — flight-view owns the
// cockpit, grid-row-aura owns the aura — so this owns the rail. Building the DOM here (not in index.html)
// keeps the markup clean and never touches the #lrc-head region the rhythm-inspector assert scans.
//
// It mounts its element as a SIBLING of #lrc-div inside #cosmos-view, constructs accessible knobs (native
// <input type=range> in normalized [0,1] — keyboard, focus, and a double-click reset come for free),
// forwards each gesture to the matching engine setter, and renders every readout from railParams.
//
// SKELETON SCOPE — build the interaction model before filling the rail: ONE knob, MIX (the bed↔rows
// crossfade), wired end-to-end. Gestures drive the engine LIVE, but persisted-value RESTORATION on entry
// is deliberately OFF (NO {emitNow}). A startup replay would push every stored value through the setters
// before they are calibrated by ear — flipping SPEED into ONSET mode and repainting today's default sound
// while the OLD cockpit controls (index.html #lrc-tempo-slider, …) still own it. Restoration turns on
// later, once SPEED/SPACE/DWELL are calibrated and the legacy controls retire. Add a param to RAIL_KNOBS
// to give it a knob; add its setter to ENGINE_SETTERS to make that knob audible.

import { railParams } from './rail-params.js';
import { setMix, setVolume } from './cosmos-audio.js';

// param → engine setter. Each is a thin, guarded, additive setter whose default reproduces today's sound
// (assert-rail-bindings.mjs). A param with no setter yet (DENSITY, Phase 4) simply stays out of this map
// and out of RAIL_KNOBS — the optional call in the binding below no-ops rather than throwing.
export const ENGINE_SETTERS = Object.freeze({
  mix: setMix,
  volume: setVolume,
});

// The knobs THIS rail build renders, in rail order. Skeleton = MIX only; grow the list as each knob is
// calibrated and adopted. Visual grouping (pitch / time / harmony / texture) is fixed by GROUP_ORDER.
export const RAIL_KNOBS = Object.freeze(['mix']);

const GROUP_ORDER = ['pitch', 'time', 'harmony', 'texture'];

// Pure: a knob's readout string from its spec + current engine value. Export-visible and DOM-free so the
// headless assert can pin the formatting without a document.
export function formatReadout(spec, value) {
  if (!spec) return '';
  if (spec.curve === 'bool') return value ? 'ON' : 'OFF';
  if (spec.curve === 'detent') return String(value);
  const digits = spec.unit === '¢' ? 0 : Math.abs(spec.max) <= 1 ? 2 : 1;   // cents are ints; unit-fractions read to 2dp
  return `${(+value).toFixed(digits)}${spec.unit || ''}`;
}

let built = false;
const knobEls = new Map();   // param → { dial, indicator, readout } — the DOM the shared sync repaints

const KNOB_SWEEP_DEG = 270;                 // indicator arc, copied from the ADSR knob (ToneRowPlayback.js:1498)
const KNOB_DRAG_PER_PX = 0.005;             // normalized change per px of vertical drag (same feel as ADSR)

// Paint a knob to match the state: rotate the indicator across the 270° sweep, mirror the position to
// aria-valuenow, and render the readout. One place, called for the initial paint and from every change —
// so a drag, a keyboard nudge, and a programmatic reset all repaint identically.
function paintKnob(name, value) {
  const k = knobEls.get(name); if (!k) return;
  const pos = railParams.norm(name);                                   // [0,1] knob position
  k.indicator.style.transform = `translateX(-50%) rotate(${pos * KNOB_SWEEP_DEG - KNOB_SWEEP_DEG / 2}deg)`;
  k.dial.setAttribute('aria-valuenow', pos.toFixed(3));
  k.readout.textContent = formatReadout(railParams.spec(name), value);
}

// Build one rotary knob bound to `name` — the site's ADSR knob (Playback), reused CLASS-FOR-CLASS
// (.knob-container/.knob/.knob-indicator/.knob-label/.knob-value) so it looks and drags identically,
// but reimplemented here in NORMALIZED [0,1] (railParams.setNorm applies the curve) to keep the rail
// engine-agnostic and honour the Playback firewall (no import from Playback/*).
function buildKnob(name) {
  const spec = railParams.spec(name);
  const wrap = document.createElement('div');
  wrap.className = 'knob-container rail-knob'; wrap.dataset.param = name;

  const label = document.createElement('div');
  label.className = 'knob-label'; label.textContent = spec.label;

  const dial = document.createElement('div');
  dial.className = 'knob'; dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', spec.label);
  dial.setAttribute('aria-valuemin', '0'); dial.setAttribute('aria-valuemax', '1');
  const indicator = document.createElement('div');
  indicator.className = 'knob-indicator';
  dial.appendChild(indicator);

  const readout = document.createElement('div');
  readout.className = 'knob-value rail-knob-readout';

  // Vertical-drag adjust, copied from the ADSR knob (ToneRowPlayback.js:1411): up = increase, 0.005/px.
  // document-level move/up so a drag that wanders off the 40px dial still tracks, then unbinds on release.
  let dragging = false, startY = 0, startPos = 0;
  const onMove = e => { if (dragging) railParams.setNorm(name, startPos + (startY - e.clientY) * KNOB_DRAG_PER_PX); };
  const onUp = () => { dragging = false; dial.classList.remove('active'); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  dial.addEventListener('mousedown', e => {
    e.preventDefault(); dragging = true; startY = e.clientY; startPos = railParams.norm(name);
    dial.classList.add('active'); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
  // reset gesture (decision 10): double-click restores the default; reset() notifies → the sync repaints.
  dial.addEventListener('dblclick', e => { e.preventDefault(); railParams.reset(name); });
  // keyboard fine-adjust (decision 10). stopPropagation so the arrows don't ALSO reach flight's window
  // keydown and fly the ship — flight-view.js:2237 only exempts INPUT/SELECT/TEXTAREA, not this <div>.
  dial.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.002 : 0.02;
    const d = (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? step : (e.key === 'ArrowDown' || e.key === 'ArrowLeft') ? -step : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    railParams.setNorm(name, railParams.norm(name) + d);
  });

  wrap.append(label, dial, readout);
  knobEls.set(name, { dial, indicator, readout });
  paintKnob(name, railParams.get(name));   // initial paint (no emitNow — see header — so the sync won't do it)
  return wrap;
}

// Mount the rail once and wire it to railParams. Idempotent + guarded by `built` (like flight-view's
// `bound`): the overlay DOM persists across exit→re-enter, so a second call is a no-op. Call it from
// enterCosmos() AFTER initAudio() so the first gesture reaches a live graph.
export function ensureRail() {
  if (built) return;
  const host = document.getElementById('cosmos-view');
  if (!host) { console.warn('[cosmos] #cosmos-view missing — rail not mounted'); return; }
  built = true;

  const rail = document.createElement('div');
  rail.id = 'cosmos-rail'; rail.className = 'cosmos-rail';
  rail.setAttribute('role', 'group'); rail.setAttribute('aria-label', 'Performance rail');

  // bucket the rendered knobs by spec.group, then emit columns in the fixed pitch/time/harmony/texture order
  const byGroup = new Map();
  for (const name of RAIL_KNOBS) {
    const g = railParams.spec(name).group;
    let arr = byGroup.get(g); if (!arr) byGroup.set(g, arr = []); arr.push(name);
  }
  for (const g of GROUP_ORDER) {
    const names = byGroup.get(g); if (!names) continue;
    const col = document.createElement('div');
    col.className = 'rail-group'; col.dataset.group = g;
    const gl = document.createElement('span'); gl.className = 'rail-group-label'; gl.textContent = g;
    const knobs = document.createElement('div'); knobs.className = 'rail-knobs';
    for (const name of names) knobs.appendChild(buildKnob(name));
    col.append(gl, knobs);
    rail.appendChild(col);
  }
  host.appendChild(rail);

  // BOTH-directions binding, GESTURES ONLY (no emitNow — see file header). This single callback is the one
  // place that (a) drives the engine and (b) repaints the knob DOM, so a programmatic reset() flows to the
  // ship and the readout through the same path a drag does. No-op sets never notify (rail-params.js:103),
  // so a drag's input→setNorm→notify→(same value written back to input) round-trip can't loop.
  railParams.subscribe((name, value) => {
    ENGINE_SETTERS[name]?.(value);   // gestures drive the engine live
    paintKnob(name, value);          // …and repaint the knob (dial + readout) through the same path
  });
}
