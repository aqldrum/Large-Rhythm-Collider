// Audio/lrc-voices-bridge.js — the shared voice library (Audio/voices/) for main Playback's classic <script> globals.
//
// Loaded from index.html as a module; it sets window.lrcVoices and announces itself with an `lrcvoicesready` event.
// ToneRowPlayback reads window.lrcVoices at note time (a bare oscillator stands in if a note fires before this has
// loaded). Everything Playback-specific about how a layer plays a library sound lives here:
//   • the basic waveforms (and any sound without its own envelope) take the layer's ADSR knobs;
//   • a HELD recipe envelope is set aside too, so its layer's knobs keep working as they do on a waveform;
//   • a STRUCK sound keeps its own envelope (the layer grays out Attack/Decay/Sustain), and the layer's Release is its
//     damp: how fast a damped sound falls silent at the note's end. A ringing one ignores it.
// For sine/triangle/sawtooth/square the voice is one oscillator into one envelope gain, scheduled exactly as the
// pre-library startStandardNote / startLegatoNote / startBridgeVoice did (proved in Audio/tests/assert-playback-identity.mjs).

import { NOTE_INSTRUMENT_IDS, getInstrument, getRecipe, normalizeNoteInstrumentId } from './voices/recipes.js';
import { planVoice } from './voices/plan.js';
import { createInstrumentVoice } from './voices/voice.js';

export const BASIC_SOUNDS = Object.freeze(['sine', 'triangle', 'sawtooth', 'square']);
// chunk-tunes sounds a Playback layer would only hear as Triangle again: plain is a held triangle, and pad differs only
// on a chord's bass note, which Playback never plays.
const HIDDEN_SOUNDS = new Set(['plain', 'pad']);

// The tempo bridge's envelope (startBridgeVoice before the library): up to its level over 10 ms, out over 20 ms.
const BRIDGE_AMP = Object.freeze({ kind: 'held', attack: 0.01, release: 0.02 });

// The layer sound choices, in menu order: the four waveforms, then every other note sound. [{ id, label, basic }]
export function soundOptions() {
  const others = NOTE_INSTRUMENT_IDS.filter(id => !BASIC_SOUNDS.includes(id) && !HIDDEN_SOUNDS.has(id));
  return [...BASIC_SOUNDS, ...others].map(id => ({ id, label: getInstrument(id).label, basic: BASIC_SOUNDS.includes(id) }));
}

// Any stored value (a sound id, an old `waveform`, junk) → a sound a layer can play; unknown → sine.
export function normalizeSound(id) {
  return normalizeNoteInstrumentId(id);
}

// Does this sound keep its own envelope (so the layer's Attack/Decay/Sustain do nothing)?
export function isStruck(id) {
  return getRecipe(normalizeSound(id), 'note').amp?.kind === 'struck';
}

function withoutAmp(recipe) {
  const { amp, ...rest } = recipe;
  return rest;
}

// The recipe a layer plays for `sound`, its envelope settled as described above.
function layerRecipe(sound, release) {
  const recipe = getRecipe(normalizeSound(sound), 'note');
  if (!recipe.amp) return recipe;
  if (recipe.amp.kind === 'struck') return { ...recipe, amp: { ...recipe.amp, damp: Math.max(0, Number(release) || 0) } };
  return withoutAmp(recipe);
}

function build({ ctx, destination, recipe, frequency, when, timing }) {
  const plan = planVoice(recipe, { role: 'note', baseFreq: frequency, timing, sampleRate: ctx.sampleRate });
  return createInstrumentVoice({ ctx, destination, plan, when });
}

// One layer note. adsr: the layer's { attack, decay, sustain, release }; peak: its high-frequency attenuation;
// duration: seconds, or null to hold until the handle's release() (legato). Returns the library's voice handle:
// release(at, seconds), fadeOut(at, seconds), stop(at), setFrequency(hz, at, glideSec), onComplete(cb).
export function createLayerVoice({ ctx, destination, sound, frequency, when, adsr, peak, duration = null }) {
  const { attack, decay, sustain, release } = adsr;
  return build({
    ctx, destination, frequency, when,
    recipe: layerRecipe(sound, release),
    timing: { attack, decay, sustain, release, peak, duration },
  });
}

// The tempo bridge: holds `sound` at `level` until released (release(at, 0.02)). A struck sound has nothing to hold,
// so it gets no bridge (null); its last note simply dies away as it would have.
export function createBridgeVoice({ ctx, destination, sound, frequency, when, level }) {
  if (isStruck(sound)) return null;
  const recipe = { ...withoutAmp(getRecipe(normalizeSound(sound), 'note')), amp: BRIDGE_AMP };
  return build({ ctx, destination, recipe, frequency, when, timing: { peak: level, duration: null } });
}

export const lrcVoices = Object.freeze({ BASIC_SOUNDS, soundOptions, normalizeSound, isStruck, createLayerVoice, createBridgeVoice });

if (typeof window !== 'undefined') {
  window.lrcVoices = lrcVoices;
  window.dispatchEvent(new Event('lrcvoicesready'));
}
