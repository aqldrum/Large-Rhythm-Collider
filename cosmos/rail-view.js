// cosmos/rail-view.js — the performance RAIL: owns the knob DOM and binds it BOTH directions to
// railParams (cosmos/rail-params.js). Mirrors the dedicated-module house pattern — flight-view owns the
// cockpit, grid-row-aura owns the aura — so this owns the rail. Building the DOM here (not in index.html)
// keeps the markup clean and never touches the #lrc-head region the rhythm-inspector assert scans.
//
// It mounts its element as a SIBLING of #lrc-div inside #cosmos-view, constructs the site's ADSR rotary
// knobs (reused class-for-class; normalized [0,1] with vertical-drag, a double-click reset, and keyboard
// fine-adjust), forwards each gesture to the matching engine setter, and renders every readout from
// railParams. It's the panel-shaped bottom-centre rail, always visible.
//
// ── THE RAIL NOW OWNS THE ENGINE (ownership transfer, 2026-07-29) ────────────────────────────────────
// SCOPE: every knob of decision 9 that has an engine setter — FUNDAMENTAL · SPEED · DWELL · RICHNESS ·
// VOLUME · MIX · SPACE — plus the MUTE button (transport) and the advanced drawer (MODULATION · MIDI OUT).
// Only DENSITY is still absent, because Phase 4 has no setter to bind yet.
//
// RESTORATION IS ON. `applyRailToEngine()` pushes every param through its setter and repaints every
// control; flight-boot calls it on EVERY cosmos entry, right after initAudio(). It is deliberately NOT an
// emitNow replay on subscribe: that fires once, at subscribe time, and `ensureRail()` is guarded by
// `built` so it only ever runs on the FIRST entry — while `stopAudio()` tears the graph down on every exit
// and `initAudio()` rebuilds it with the engine's own defaults (`mix = 0`, unity volume, …). Restoration
// therefore has to be a call the boot path can repeat, not a one-shot side effect of subscribing.
//
// The audio lab (index.html #lrc-audio-lab, ?audioLab=1 / Z) is now a DEV overlay that mirrors this state
// and only writes on a gesture — it no longer applies anything at entry. Where both surfaces express the
// same parameter (mute, mix, modulation, MIDI out) the lab routes THROUGH railParams so there is exactly
// one owner; its remaining raw controls (ticks/s, scaled speed, cycle seconds, tuning λ) are debug probes
// that intentionally override the rail until the next entry. Add a param to RAIL_KNOBS (or RAIL_BUTTONS /
// RAIL_SWITCHES) plus a setter to ENGINE_SETTERS to grow the rail.

import { railParams } from './rail-params.js';
import {
  setMix, setVolume, setSpace, setRichness, setFundamentalOffset, setTargetOnsetRate, setDwell,
  setMuted, setModulation, setMidiOut,
} from './cosmos-audio.js';

// param → engine setter. Each is a thin, guarded, additive setter whose default reproduces the intended
// entry sound (assert-rail-bindings.mjs). A param with no setter yet (DENSITY, Phase 4) simply stays out of
// this map and out of the rendered rail — the optional call in the binding below no-ops rather than
// throwing. The value passed is the ENGINE-unit value (railParams.get): cents for FUNDAMENTAL, notes/sec
// for SPEED, cycle-fractions for DWELL, booleans for the toggles, [0,1] for the rest.
//
// MIDI OUT is deliberately ABSENT: `setMidiOut` is async, needs a user gesture for the Web MIDI permission
// prompt, and can fail with a reason the rail has to report and roll back — so it gets its own handler
// (applyMidiOut) instead of being replayed like a plain setter. It is transient (never persisted), so
// entry restoration has nothing to restore for it anyway.
export const ENGINE_SETTERS = Object.freeze({
  fundamental: setFundamentalOffset,   // cents (railParams 'fundamental' value is already in cents, ±1200 knob)
  speed: setTargetOnsetRate,           // notes/sec — puts the engine in ONSET mode (SPEED replaces fixed/scaled)
  dwell: setDwell,                     // [0,1] chord dwell past full exposure, in cycles (0 = advance at exposure)
  richness: setRichness,               // [0, 0.18] sky-reach weight
  volume: setVolume,                   // [0,1] master trim ahead of the limiter
  mix: setMix,                         // [0,1] constant-power bed↔rows crossfade
  space: setSpace,                     // [0,1] both reverb sends (0.5 = today's levels)
  mute: setMuted,                      // bool — master mute; the transport keeps ticking
  modulation: setModulation,           // bool — retune each newly solved root to the fundamental
});

// The ROTARY knobs this rail renders, in order within their group. DENSITY (Phase 4) is the only decision-9
// knob still missing, for want of an engine setter.
export const RAIL_KNOBS = Object.freeze(['fundamental', 'speed', 'dwell', 'richness', 'volume', 'mix', 'space']);
// Momentary/latching BUTTONS (transport group) and the advanced drawer's SWITCHES.
export const RAIL_BUTTONS = Object.freeze(['mute']);
export const RAIL_SWITCHES = Object.freeze(['modulation', 'midiOut']);

const GROUP_ORDER = ['transport', 'pitch', 'time', 'harmony', 'texture'];

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
const knobEls = new Map();     // param → { dial, indicator, readout } — the DOM the shared sync repaints
const buttonEls = new Map();   // param → { button }
const switchEls = new Map();   // param → { input, readout }
let midiStatus = '';           // last MIDI-out outcome (port name or failure reason), shown on its readout

const KNOB_SWEEP_DEG = 270;                 // indicator arc, copied from the ADSR knob (ToneRowPlayback.js:1498)
const KNOB_DRAG_PER_PX = 0.005;             // normalized change per px of vertical drag (same feel as ADSR)

// Paint ANY rail control to match the state — knob, button, or switch. One place, called for the initial
// paint, from every change, and from applyRailToEngine's per-entry restoration, so a drag, a keyboard
// nudge, a programmatic reset and a re-entry all repaint identically.
function paintControl(name, value) {
  const knob = knobEls.get(name);
  if (knob) {
    const pos = railParams.norm(name);                                   // [0,1] knob position
    knob.indicator.style.transform = `translateX(-50%) rotate(${pos * KNOB_SWEEP_DEG - KNOB_SWEEP_DEG / 2}deg)`;
    knob.dial.setAttribute('aria-valuenow', pos.toFixed(3));
    knob.readout.textContent = formatReadout(railParams.spec(name), value);
    return;
  }
  const btn = buttonEls.get(name);
  if (btn) {
    const on = !!value;
    btn.button.classList.toggle('active', on);
    btn.button.setAttribute('aria-pressed', String(on));
    btn.button.title = name === 'mute' ? (on ? 'Unmute (M)' : 'Mute (M)') : railParams.spec(name).label;
    return;
  }
  const sw = switchEls.get(name);
  if (sw) {
    sw.input.checked = !!value;
    sw.readout.textContent = (name === 'midiOut' && midiStatus) ? midiStatus : formatReadout(railParams.spec(name), value);
  }
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
  paintControl(name, railParams.get(name));
  return wrap;
}

// A latching button (MUTE). A real <button> so it is keyboard- and screen-reader-native; the M key in
// flight-view routes through the same railParams param, so both stay in sync by construction.
function buildButton(name) {
  const spec = railParams.spec(name);
  const wrap = document.createElement('div');
  wrap.className = 'knob-container rail-button-wrap'; wrap.dataset.param = name;

  const button = document.createElement('button');
  button.type = 'button'; button.className = 'rail-button';
  button.textContent = spec.label; button.setAttribute('aria-label', spec.label);
  // stopPropagation for the same reason the knobs do it: a focused button must not also fly the ship.
  button.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  button.addEventListener('click', () => railParams.set(name, !railParams.get(name)));

  wrap.append(button);
  buttonEls.set(name, { button });
  paintControl(name, railParams.get(name));
  return wrap;
}

// A boolean switch for the advanced drawer (MODULATION / MIDI OUT), with its own live readout — MODULATION
// reads ON/OFF, MIDI OUT reports the real outcome (port name, or why enabling failed).
function buildSwitch(name) {
  const spec = railParams.spec(name);
  const row = document.createElement('label');
  row.className = 'rail-switch'; row.dataset.param = name;

  const label = document.createElement('span');
  label.className = 'rail-switch-label'; label.textContent = spec.label;

  const input = document.createElement('input');
  input.type = 'checkbox'; input.setAttribute('aria-label', spec.label);
  input.addEventListener('change', () => railParams.set(name, input.checked));

  const readout = document.createElement('b');
  readout.className = 'rail-switch-readout';

  row.append(label, input, readout);
  switchEls.set(name, { input, readout });
  paintControl(name, railParams.get(name));
  return row;
}

// MIDI OUT's own applier (see the ENGINE_SETTERS note). Web MIDI permission needs the user gesture and the
// port name is only known after it resolves, so the readout reports the real outcome rather than assuming
// success. On failure the param rolls back to false and the reason stays on the readout — `applying` keeps
// that rollback's notification from re-entering here and calling setMidiOut(false) over the reason.
let midiApplying = false;
function applyMidiOut(on) {
  if (midiApplying) return;
  midiApplying = true;
  midiStatus = on ? '…' : '';
  paintControl('midiOut', on);
  setMidiOut(on).then(result => {
    if (!result.ok) {
      midiStatus = result.reason;
      railParams.set('midiOut', false);   // notified, but short-circuited here by `midiApplying`
      midiApplying = false;
      paintControl('midiOut', false);
      return;
    }
    midiStatus = result.port ? `→ ${result.port}` : '';
    midiApplying = false;
    paintControl('midiOut', on);
  }).catch(() => { midiStatus = 'failed'; midiApplying = false; paintControl('midiOut', railParams.get('midiOut')); });
}

// RESTORATION (see the file header): push every param through its engine setter and repaint every control.
// Call it on EVERY cosmos entry, after initAudio() — the graph is rebuilt from scratch each time, so this
// is what makes the rail's persisted state the engine's actual state instead of a picture of it. Idempotent
// and safe before the rail is mounted (the setters guard on audioCtx; paintControl no-ops on missing DOM).
// MIDI OUT is skipped by design: it is transient, always false at entry, and enabling needs a gesture.
export function applyRailToEngine() {
  if (!railParams.get('midiOut')) midiStatus = '';   // the old graph's port died with stopAudio's disable()
  for (const name of Object.keys(railParams.specs)) {
    const value = railParams.get(name);
    ENGINE_SETTERS[name]?.(value);
    paintControl(name, value);
  }
}

// Mount the rail once and wire it to railParams. Idempotent + guarded by `built` (like flight-view's
// `bound`): the overlay DOM persists across exit→re-enter, so a second call is a no-op — which is exactly
// why restoration lives in applyRailToEngine() rather than in this function's subscribe call.
export function ensureRail() {
  if (built) return;
  const host = document.getElementById('cosmos-view');
  if (!host) { console.warn('[cosmos] #cosmos-view missing — rail not mounted'); return; }
  built = true;

  const rail = document.createElement('div');
  rail.id = 'cosmos-rail'; rail.className = 'cosmos-rail';
  rail.setAttribute('role', 'group'); rail.setAttribute('aria-label', 'Performance rail');

  // bucket every rendered control by spec.group, then emit columns in the fixed GROUP_ORDER. Knobs and
  // buttons share a group row (transport's MUTE sits where a knob would); the advanced switches are pulled
  // out into the drawer below rather than rendered as a column.
  const byGroup = new Map();
  for (const name of [...RAIL_BUTTONS, ...RAIL_KNOBS]) {
    const g = railParams.spec(name).group;
    let arr = byGroup.get(g); if (!arr) byGroup.set(g, arr = []); arr.push(name);
  }
  for (const g of GROUP_ORDER) {
    const names = byGroup.get(g); if (!names) continue;
    const col = document.createElement('div');
    col.className = 'rail-group'; col.dataset.group = g;
    const gl = document.createElement('span'); gl.className = 'rail-group-label'; gl.textContent = g;
    const knobs = document.createElement('div'); knobs.className = 'rail-knobs';
    for (const name of names) knobs.appendChild(RAIL_BUTTONS.includes(name) ? buildButton(name) : buildKnob(name));
    col.append(gl, knobs);
    rail.appendChild(col);
  }

  // ADVANCED drawer — a native <details> so it is keyboard-accessible and needs no open/close state of its
  // own. Holds the switches that are settings rather than performance gestures (decision 9).
  const drawer = document.createElement('details');
  drawer.className = 'rail-advanced';
  const summary = document.createElement('summary');
  summary.className = 'rail-advanced-summary'; summary.textContent = 'adv';
  summary.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  const switches = document.createElement('div');
  switches.className = 'rail-switches';
  for (const name of RAIL_SWITCHES) switches.appendChild(buildSwitch(name));
  drawer.append(summary, switches);
  rail.appendChild(drawer);

  host.appendChild(rail);

  // BOTH-directions binding. This single callback is the one place that (a) drives the engine and (b)
  // repaints the control DOM, so a programmatic reset(), the M key, and the audio lab's mirrored controls
  // all flow to the ship and the readout through the same path a drag does. No-op sets never notify
  // (rail-params.js), so a gesture's set→notify→(same value painted back) round-trip can't loop.
  railParams.subscribe((name, value) => {
    if (name === 'midiOut') { applyMidiOut(!!value); return; }   // async + rollback — its own applier
    ENGINE_SETTERS[name]?.(value);   // gestures drive the engine live
    paintControl(name, value);       // …and repaint the control through the same path
  });
}
