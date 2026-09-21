// cosmos/instruments/instrument-presets.js — the pure palette catalog.
//
// Engine-agnostic, like harmony-policy.js: frozen IDs/labels, a default, a normalizer, and the
// per-role RECIPE DATA that voice-plan.js turns into a bounded synthesis plan. It owns NO Web Audio
// nodes, NO DOM, NO storage, and it never enumerates rhythms. Nothing here imports from cosmos-audio
// (so the module stays headless-testable) or from sound-design/ or docs/ (reference assets are local).
//
// A "recipe" is three ROLE recipes (row / bed / audition). Each role recipe is a small bag of
// oscillator components, an optional noise burst, an optional per-VOICE filter, and an output trim for
// matched loudness. voice-plan.js resolves component ratios to Hz, clamps out-of-band partials, scales
// bell energy by register, and reports the source COST; instrument-voice.js realizes the plan.
//
// Roles differ on purpose (the work order): rows are short articulate plucks, the bed is a sustained
// swell with much less attack coloration, audition is a held/legato voice. A palette is not one
// envelope applied to every role.

// ── Recipe field reference ────────────────────────────────────────────────────────────────────────
// component: {
//   wave: 'sine' | 'triangle' | 'sawtooth' | 'square'   — oscillator type (built-in, bandlimited)
//   ratio: number                                        — frequency multiplier over the base pitch (1 = fundamental)
//   level: number (0..1]                                 — static mix level; 1 with no `sub` routes straight to the amp env
//   detuneCents?: number                                 — STATIC per-osc detune (unison spread); sums with the shared bus, never replaces it
//   sub?: { attack, decay, sustain }                     — the component's OWN short envelope (e.g. a bell that decays under the body)
// }
// noise?:  { level, attack, decay }                      — a very-low-level attack chiff (rows/audition only in practice)
// filter?: { type: 'lowpass'|'highpass', freq, Q }       — a PER-VOICE filter (classic has none; the bed/lead keep their shared downstream filters)
// outputTrim: number                                     — per-recipe loudness match ahead of the shared limiter

// classic — the development comparison path. It reproduces today's bare oscillators EXACTLY so the seam
// can be verified at parity before any richer recipe is heard: rows/audition are a single triangle, the
// bed a single sine driven by the swell. It is deliberately NOT a third production palette; the rail
// selector exposes only the production instruments (see PRODUCTION_INSTRUMENT_IDS).
const CLASSIC = Object.freeze({
  id: 'classic',
  label: 'Classic',
  roles: Object.freeze({
    row: Object.freeze({
      components: Object.freeze([Object.freeze({ wave: 'triangle', ratio: 1, level: 1 })]),
      noise: null,
      filter: null,
      outputTrim: 1,
    }),
    bed: Object.freeze({
      components: Object.freeze([Object.freeze({ wave: 'sine', ratio: 1, level: 1 })]),
      noise: null,
      filter: null,
      outputTrim: 1,
    }),
    audition: Object.freeze({
      components: Object.freeze([Object.freeze({ wave: 'triangle', ratio: 1, level: 1 })]),
      noise: null,
      filter: null,
      outputTrim: 1,
    }),
  }),
});

// Recipes below nest a few levels; deepFreeze keeps them immutable without an Object.freeze at every line.
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const v of Object.values(value)) deepFreeze(v); return Object.freeze(value); }
  return value;
}

// Glass — Suitcase-inspired rounded electric-piano keys. A clear SINE body with a quiet, register-scaled
// high SINE bell on its own short decay (the "sparkle"), a whisper of attack noise for articulation, and a
// gentle low-pass that rounds the top. The bell's inharmonic ratio (≈ octave+3, −4 st, the Suitcase osc2
// color) and its rolloff keep high notes from ever becoming piercing while the sine body keeps an
// unambiguous fundamental. The BED drops the bell/noise transient entirely (a sustained body + a faint
// static octave sheen) so an internal swell never re-triggers a keys attack — "much less attack coloration".
const GLASS_BELL = { wave: 'sine', ratio: 6.32, level: 0.12, sub: { attack: 0.004, decay: 0.12, sustain: 0 }, registerRolloff: 0.35, rolloffFloor: 0.1, rolloffRefHz: 220 };
const GLASS_NOISE = { level: 0.04, attack: 0.001, decay: 0.018 };
const GLASS_LP = { type: 'lowpass', freq: 3200, Q: 0.7071 };
const GLASS = deepFreeze({
  id: 'glass',
  label: 'Glass',
  roles: {
    row: {
      components: [{ wave: 'sine', ratio: 1, level: 1 }, { ...GLASS_BELL }],
      noise: { ...GLASS_NOISE },
      filters: [{ ...GLASS_LP }],
      outputTrim: 0.95,
    },
    bed: {
      components: [{ wave: 'sine', ratio: 1, level: 1 }, { wave: 'sine', ratio: 2, level: 0.09 }],   // body + faint static octave sheen; NO bell/noise transient
      noise: null,
      filters: [{ type: 'lowpass', freq: 3500, Q: 0.7071 }],
      outputTrim: 1.0,
    },
    audition: {
      components: [{ wave: 'sine', ratio: 1, level: 1 }, { ...GLASS_BELL }],
      noise: { ...GLASS_NOISE },
      filters: [{ ...GLASS_LP }],
      outputTrim: 0.95,
    },
  },
});

// Warm — OB8-inspired analog warmth: two saws at MINIMAL detune (not the reference's big unison), a
// high-pass to clear low-mid mud and a 12 dB low-pass for the rounded body, no saturation. The BED adds a
// slow, restrained cutoff DRIFT (a shared per-context LFO — Utopia's "gentle harmonic development" without
// per-voice cost) and a slightly darker cutoff; rows/audition keep a static, prompt version. Pitch center
// stays clear because the detune is tiny and the tuning relationships are Cosmos's own.
// A center saw plus two quietly-detuned flankers (a small "supersaw-lite"): the center anchors the pitch so
// the flankers add analog width WITHOUT the deep two-saw cancellation that would make Warm quiet-and-peaky.
// Still minimal detune (±6 ¢) and a small unison of 3 — not the reference's big unison.
const WARM_SAWS = [
  { wave: 'sawtooth', ratio: 1, level: 0.5, detuneCents: 0 },
  { wave: 'sawtooth', ratio: 1, level: 0.36, detuneCents: 6 },
  { wave: 'sawtooth', ratio: 1, level: 0.36, detuneCents: -6 },
];
const WARM_HP = { type: 'highpass', freq: 110, Q: 0.7071 };
const WARM = deepFreeze({
  id: 'warm',
  label: 'Warm',
  roles: {
    row: {
      components: WARM_SAWS.map(c => ({ ...c })),
      noise: null,
      filters: [{ ...WARM_HP }, { type: 'lowpass', freq: 4000, Q: 0.7071 }],
      // A brighter cutoff keeps more of the saw's harmonic warmth (the "brassy OB8" body) AND more level,
      // so the trim need not push beat-peaks into the safety limiter. Final loudness is an ear-based trim.
      outputTrim: 0.95,
    },
    bed: {
      components: WARM_SAWS.map(c => ({ ...c })),
      noise: null,
      filters: [{ ...WARM_HP }, { type: 'lowpass', freq: 3400, Q: 0.7071, drift: { rateHz: 0.06, depthCents: 250 } }],
      outputTrim: 0.95,
    },
    audition: {
      components: WARM_SAWS.map(c => ({ ...c })),
      noise: null,
      filters: [{ ...WARM_HP }, { type: 'lowpass', freq: 4000, Q: 0.7071 }],
      outputTrim: 0.95,
    },
  },
});

// The catalog. normalizeInstrumentId folds any unknown id here, so a stale stored value or an early rail
// selection can never brick audio. Production palettes are Glass and Warm; classic stays a dev A/B path.
export const INSTRUMENTS = Object.freeze({
  glass: GLASS,
  warm: WARM,
  classic: CLASSIC,
});

// Every id the engine understands (includes the dev-only classic).
export const INSTRUMENT_IDS = Object.freeze(Object.keys(INSTRUMENTS));

// The ids the shipped rail selector offers. classic is intentionally excluded — it is a dev A/B path,
// not a production choice. (Populated with 'glass','warm' in Step 3/4.)
export const PRODUCTION_INSTRUMENT_IDS = Object.freeze(INSTRUMENT_IDS.filter(id => id !== 'classic'));

export const INSTRUMENT_ROLES = Object.freeze(['row', 'bed', 'audition']);

// The engine's safe fallback: classic == today's sound, so an unknown id degrades to no audible change
// rather than to silence or an unfinished palette. The RAIL's default production choice is a separate
// decision made after audition (Step 4); this is only the normalization backstop.
export const DEFAULT_INSTRUMENT = 'classic';

// Fold any value to a known instrument id (mirrors clampParam's choice behavior in rail-params.js).
export function normalizeInstrumentId(id) {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, id) ? id : DEFAULT_INSTRUMENT;
}

// The frozen role recipe for (id, role). Falls back through the normalized instrument, then to classic's
// role, so a partially-defined future palette can omit a role and still render (as classic for that role)
// rather than throwing on the audio path.
export function getRecipe(id, role) {
  const instrument = INSTRUMENTS[normalizeInstrumentId(id)];
  return instrument.roles[role] || CLASSIC.roles[role];
}

export function instrumentLabel(id) {
  return INSTRUMENTS[normalizeInstrumentId(id)].label;
}
