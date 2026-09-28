// Cosmos/ui/rail-view.js — the performance RAIL: owns the knob DOM and binds it BOTH directions to
// railParams (Cosmos/ui/rail-params.js). Mirrors the dedicated-module house pattern — flight-view owns the
// cockpit, grid-row-aura owns the aura — so this owns the rail. Building the DOM here (not in index.html)
// keeps the markup clean and never touches the #lrc-head region the rhythm-inspector assert scans.
//
// It mounts its element as a SIBLING of #lrc-div inside #cosmos-view, constructs the site's ADSR rotary
// knobs (reused class-for-class; normalized [0,1] with vertical-drag, a double-click reset, and keyboard
// fine-adjust), forwards each gesture to the matching engine setter, and renders every readout from
// railParams. It's the panel-shaped bottom-centre rail, always visible.
//
// ── THE RAIL NOW OWNS THE ENGINE (ownership transfer, 2026-07-29) ────────────────────────────────────
// SCOPE: the front performance face contains only controls with an immediate, unmistakable audible result:
// PITCH · SPEED · VOLUME · BED/ROWS · SPACE, plus MUTE and HOLD. The back face owns harmony source,
// scale, RICHNESS, ROW 1/1, MODULATION, and MIDI OUT without becoming a second state owner.
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
  setMix, setVolume, setSpace, setRichness, setFundamentalOffset, setTargetOnsetRate,
  setMuted, setHarmonyHold, setHarmonySource, setHarmonyScale, setRowFundamental, setModulation, setMidiOut,
  setInstrument,
} from '../audio/cosmos-audio.js';
import { HARMONY_SOURCES, SCALE_POLICIES } from '../audio/harmony-policy.js';
import { INSTRUMENTS } from '../audio/instruments/instrument-presets.js';

// param → engine setter. Each is a thin, guarded, additive setter whose default reproduces the intended
// entry sound (assert-rail-bindings.mjs). Values are in ENGINE units: cents for PITCH/FUNDAMENTAL,
// notes/sec for SPEED, cycle-fractions for DWELL, booleans for toggles, and [0,1] for the rest.
//
// MIDI OUT is deliberately ABSENT: `setMidiOut` is async, needs a user gesture for the Web MIDI permission
// prompt, and can fail with a reason the rail has to report and roll back — so it gets its own handler
// (applyMidiOut) instead of being replayed like a plain setter. It is transient (never persisted), so
// entry restoration has nothing to restore for it anyway.
export const ENGINE_SETTERS = Object.freeze({
  fundamental: setFundamentalOffset,   // cents (railParams 'fundamental' value is already in cents, ±1200 knob)
  speed: setTargetOnsetRate,           // notes/sec — puts the engine in ONSET mode (SPEED replaces fixed/scaled)
  richness: setRichness,               // detent 1–3 — the largest chord the walk may reach for
  volume: setVolume,                   // [0,1] master trim ahead of the limiter
  mix: setMix,                         // [0,1] constant-power bed↔rows crossfade
  space: setSpace,                     // [0,1] both reverb sends (0.5 = today's levels)
  mute: setMuted,                      // bool — master mute; the transport keeps ticking
  hold: setHarmonyHold,                // bool — freezes chord + solved root, never the transport
  harmonySource: setHarmonySource,     // chord-walk | scale
  scale: setHarmonyScale,              // normalized cent-target preset ID
  rowFundamental: setRowFundamental,   // bool — schedule-time literal 1/1 attacks only
  modulation: setModulation,           // bool — retune each newly solved root to the fundamental
  instrument: setInstrument,           // choice — synthesis palette (classic | glass | warm)
});

// Front-face ROTARY knobs, ordered within their groups. RICHNESS is a named back-face segment;
// retired DENSITY/DWELL do not participate in the product state model.
export const RAIL_KNOBS = Object.freeze(['fundamental', 'speed', 'volume', 'mix', 'space']);
export const RAIL_BUTTONS = Object.freeze(['mute', 'hold']);
export const RAIL_SWITCHES = Object.freeze(['rowFundamental', 'modulation', 'midiOut']);
export const RAIL_SEGMENTS = Object.freeze(['harmonySource', 'richness', 'instrument']);
export const RAIL_SELECTS = Object.freeze(['scale']);

const GROUP_ORDER = ['transport', 'pitch', 'time', 'harmony', 'texture'];

// Pure: a knob's readout string from its spec + current engine value. Export-visible and DOM-free so the
// headless assert can pin the formatting without a document.
export function formatReadout(spec, value) {
  if (!spec) return '';
  if (spec.curve === 'bool') return value ? 'ON' : 'OFF';
  if (spec.curve === 'choice') return String(value).toUpperCase().replaceAll('-', ' ');
  // A detent with `stops` reads its stop's NAME — a rail knob's readout is the only thing telling the
  // listener what a stop means, and "ext." says it where "3" does not. Unnamed detents still read numeric.
  if (spec.curve === 'detent') return spec.stops?.[value - spec.min] ?? String(value);
  const digits = spec.unit === '¢' ? 0 : Math.abs(spec.max) <= 1 ? 2 : 1;   // cents are ints; unit-fractions read to 2dp
  return `${(+value).toFixed(digits)}${spec.unit || ''}`;
}

let built = false;
const knobEls = new Map();     // param → { dial, indicator, readout } — the DOM the shared sync repaints
const buttonEls = new Map();   // param → { button }
const switchEls = new Map();   // param → { input, readout }
const segmentEls = new Map();  // param → { buttons }
const selectEls = new Map();   // param → { select }
let midiStatus = '';           // last MIDI-out outcome (port name or failure reason), shown on its readout
let activeFace = 'performance';
let performanceFace = null, harmonyFace = null, scaleControl = null, richnessControl = null;
let performanceFaceToggle = null, harmonyFaceToggle = null;

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
    btn.button.title = name === 'mute' ? (on ? 'Unmute (M)' : 'Mute (M)')
      : name === 'hold' ? (on ? 'Release harmony (H)' : 'Hold harmony (H)') : railParams.spec(name).label;
    return;
  }
  const sw = switchEls.get(name);
  if (sw) {
    sw.input.checked = !!value;
    // Only MIDI OUT carries a readout now — the pill itself is the ON/OFF for the pure booleans. Its status
    // is the port name, a '…' while connecting, or a failure reason; '' when off, which renders as nothing.
    if (sw.readout) sw.readout.textContent = midiStatus;
    return;
  }
  const segment = segmentEls.get(name);
  if (segment) {
    for (const [option, button] of segment.buttons) {
      const on = String(option) === String(value);
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
    updateBackFaceVisibility();
    return;
  }
  const select = selectEls.get(name);
  if (select) {
    select.select.value = String(value);
    updateBackFaceVisibility();
  }
}

function updateBackFaceVisibility() {
  const scaleOn = railParams.get('harmonySource') === HARMONY_SOURCES.SCALE;
  if (scaleControl) scaleControl.hidden = !scaleOn;
  if (richnessControl) richnessControl.hidden = scaleOn;
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
  const onMove = e => { if (dragging) railParams.setNorm(name, startPos + (startY - e.clientY) * KNOB_DRAG_PER_PX, { persist: false }); };   // live audio, no per-move localStorage write
  const onUp = () => { dragging = false; dial.classList.remove('active'); railParams.persistNow(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };   // flush the drag's final value once
  dial.addEventListener('mousedown', e => {
    e.preventDefault(); dragging = true; startY = e.clientY; startPos = railParams.norm(name);
    dial.classList.add('active'); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });
  // reset gesture (decision 10): double-click restores the default; reset() notifies → the sync repaints.
  dial.addEventListener('dblclick', e => { e.preventDefault(); railParams.reset(name); });
  // keyboard fine-adjust (decision 10). stopPropagation so the arrows don't ALSO reach flight's window
  // keydown and fly the ship. Only reached when the knob was focused by KEYBOARD: a mouse-focused knob hands
  // its focus back to the flight on the next key (flight-view.js bindControls, FOCUS HAND-BACK).
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

// A pill toggle for the harmony face (ROW 1/1 / MODULATION / MIDI OUT). The pill is a restyled checkbox, so
// it stays keyboard- and screen-reader-native, and the pill state IS the readout — which is why the two pure
// booleans drop their ON/OFF word. MIDI OUT alone keeps a sub-line, because its state is a port name, a '…'
// while connecting, or the reason it failed — information the pill cannot show.
function buildSwitch(name) {
  const spec = railParams.spec(name);
  const row = document.createElement('label');
  row.className = 'rail-switch'; row.dataset.param = name;

  const head = document.createElement('span');
  head.className = 'rail-switch-head';
  const label = document.createElement('span');
  label.className = 'rail-switch-label'; label.textContent = spec.label;

  const input = document.createElement('input');
  input.type = 'checkbox'; input.className = 'rail-switch-pill'; input.setAttribute('aria-label', spec.label);
  input.addEventListener('change', () => railParams.set(name, input.checked));
  head.append(label, input);
  row.append(head);

  let readout = null;
  if (name === 'midiOut') {
    readout = document.createElement('b');
    readout.className = 'rail-switch-readout';
    row.append(readout);
  }
  switchEls.set(name, { input, readout });
  paintControl(name, railParams.get(name));
  return row;
}

function buildSegmented(name, options) {
  const spec = railParams.spec(name);
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'rail-setting rail-segmented'; fieldset.dataset.param = name;
  const legend = document.createElement('legend'); legend.textContent = spec.label;
  const group = document.createElement('div'); group.className = 'rail-segment-options';
  const buttons = new Map();
  for (const option of options) {
    const value = option.value;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'rail-segment'; button.textContent = option.label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
    button.addEventListener('click', () => railParams.set(name, value));
    buttons.set(value, button); group.appendChild(button);
  }
  fieldset.append(legend, group);
  segmentEls.set(name, { buttons });
  paintControl(name, railParams.get(name));
  return fieldset;
}

function buildSelect(name, options) {
  const spec = railParams.spec(name);
  const label = document.createElement('label');
  label.className = 'rail-setting rail-select'; label.dataset.param = name;
  const text = document.createElement('span'); text.textContent = spec.label;
  const select = document.createElement('select'); select.setAttribute('aria-label', spec.label);
  for (const option of options) {
    const el = document.createElement('option'); el.value = option.value; el.textContent = option.label;
    select.appendChild(el);
  }
  select.addEventListener('change', () => railParams.set(name, select.value));
  label.append(text, select);
  selectEls.set(name, { select });
  paintControl(name, railParams.get(name));
  return label;
}

function setRailFace(face, { focus = true } = {}) {
  activeFace = face === 'harmony' ? 'harmony' : 'performance';
  if (!performanceFace || !harmonyFace) return;
  const performanceOn = activeFace === 'performance';
  performanceFace.hidden = !performanceOn; performanceFace.inert = !performanceOn;
  harmonyFace.hidden = performanceOn; harmonyFace.inert = performanceOn;
  if (focus) (performanceOn ? performanceFaceToggle : harmonyFaceToggle)?.focus();
}

// The two faces flip through a single icon button each (was a text pill: "HARMONY ›" / "‹ PERFORMANCE").
// GEAR opens the harmony face — it is effectively the settings/config face (harmony source, scale, richness,
// ROW 1/1, modulation, MIDI). A ROTARY-KNOB glyph returns to the main knob rail (echoing the rail's own dials
// — the instrument has no sliders). aria-label + title carry the meaning the text used to; stroke:currentColor
// lets the shared hover rule tint them like every other rail control.
const FACE_TOGGLE_ICONS = Object.freeze({
  harmony: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  performance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><line x1="12" y1="12" x2="12" y2="5"/></svg>',
});

function buildFaceToggle(destination) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'rail-face-toggle rail-face-toggle-icon';
  button.innerHTML = FACE_TOGGLE_ICONS[destination] || '';
  const label = destination === 'harmony' ? 'Harmony & scale settings' : 'Performance controls';
  button.setAttribute('aria-label', label); button.title = label;
  button.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') e.stopPropagation(); });
  button.addEventListener('click', () => setRailFace(destination));
  return button;
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

// Cosmos-entry reset for UI/transient state. Persisted musical choices survive; face, HOLD, MUTE, and
// MIDI permission state do not. Called on every entry even though the DOM itself mounts only once.
export function resetRailForEntry() {
  setRailFace('performance', { focus: false });
  railParams.set('hold', false);
  railParams.set('mute', false);
  railParams.set('midiOut', false);
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
  rail.setAttribute('role', 'group'); rail.setAttribute('aria-label', 'Cosmos audio controls');

  const stage = document.createElement('div'); stage.className = 'rail-face-stage';
  performanceFace = document.createElement('section');
  performanceFace.className = 'rail-face rail-performance-face'; performanceFace.setAttribute('aria-label', 'Performance controls');
  harmonyFace = document.createElement('section');
  harmonyFace.className = 'rail-face rail-harmony-face'; harmonyFace.setAttribute('aria-label', 'Harmony controls');

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
    performanceFace.appendChild(col);
  }

  performanceFaceToggle = buildFaceToggle('harmony');
  performanceFace.appendChild(performanceFaceToggle);

  const source = buildSegmented('harmonySource', [
    { value: HARMONY_SOURCES.CHORD_WALK, label: 'CHORD WALK' },
    { value: HARMONY_SOURCES.SCALE, label: 'SCALE' },
  ]);
  scaleControl = buildSelect('scale', Object.values(SCALE_POLICIES).map(policy => ({ value: policy.id, label: policy.label })));
  richnessControl = buildSegmented('richness', railParams.spec('richness').stops.map((label, index) => ({ value: index + 1, label: label.toUpperCase() })));
  // VOICE: the synthesis palette, rendered exactly like HARMONY SOURCE / RICHNESS. Labels come from the
  // presets so a future palette's display name stays single-sourced; the order follows the spec's `choices`.
  const voice = buildSegmented('instrument',
    railParams.spec('instrument').choices.map(id => ({ value: id, label: (INSTRUMENTS[id]?.label || id).toUpperCase() })));
  const switches = document.createElement('div'); switches.className = 'rail-switches';
  for (const name of RAIL_SWITCHES) switches.appendChild(buildSwitch(name));
  harmonyFaceToggle = buildFaceToggle('performance');
  harmonyFace.append(source, scaleControl, richnessControl, voice, switches, harmonyFaceToggle);

  stage.append(performanceFace, harmonyFace);
  rail.appendChild(stage);

  host.appendChild(rail);
  updateBackFaceVisibility();
  setRailFace('performance', { focus: false });

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
