// Audio/drums/index.js — the shared drum library: made (synthesized) kit sounds, a sample player and a sample loader.
// Plain ES modules with no page globals; anything shared is cached per AudioContext in WeakMaps.
//
// A drum CHOICE is a string, so it can sit in a <select> next to sample URLs: a sample's URL, or `made:<id>` for a
// made kit sound (madeDrumOf reads it back).

export { MADE_DRUMS, MADE_DRUM_IDS, playMadeDrum, kick, snare, hihat, perc, cym, tick, drop, hiss, noiseOf, strokeHandle } from './made.js';
export { playSample, fitEnvelope } from './sample.js';
export { loadSample, invalidateSample, hasSample, fetchArrayBuffer, decodeWith } from './loader.js';

import { MADE_DRUMS, MADE_DRUM_IDS } from './made.js';

export const MADE_PREFIX = 'made:';

/** the made kit sound a choice names, or null (a sample URL, or an unknown made id) */
export function madeDrumOf(choice) {
  if (typeof choice !== 'string' || !choice.startsWith(MADE_PREFIX)) return null;
  const id = choice.slice(MADE_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(MADE_DRUMS, id) ? id : null;
}

/** the made kit as select choices, in kit order: { value: 'made:kick', id, label } */
export const MADE_DRUM_CHOICES = Object.freeze(MADE_DRUM_IDS.map(id => Object.freeze({ value: MADE_PREFIX + id, id, label: MADE_DRUMS[id].label })));
