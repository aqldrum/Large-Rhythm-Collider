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
//   wave: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'custom' — oscillator type ('custom' = a PeriodicWave)
//   harmonics?: number[]                                 — 'custom' only: sine amplitudes of h1, h2, … (normalized to peak 1)
//   ratio: number                                        — frequency multiplier over the base pitch (1 = fundamental)
//   level: number (0..1]                                 — static mix level; 1 with no `sub` routes straight to the amp env
//   detuneCents?: number                                 — STATIC per-osc detune (unison spread); sums with the shared bus, never replaces it
//   sub?: { attack, decay, sustain }                     — the component's OWN short envelope (e.g. a bell that decays under the body)
// }
// noise?:  { level, attack, decay }                      — a very-low-level attack chiff (rows/audition only in practice)
// filters?: [{ type: 'lowpass'|'highpass', freq, Q,      — a PER-VOICE chain (classic has none; the bed/lead keep their shared downstream filters)
//   keyTrack?: { harmonics, minHz, maxHz }               — cutoff = harmonics × base pitch, clamped (replaces freq)
//   env?: { startCents, peakCents, attack, settle }      — birth cutoff sweep in cents: start → peak over attack → 0 over settle
//   drift?: { rateHz, depthCents }                       — bed: shared slow LFO on the cutoff
//   swellCents?: number }]                               — bed: each swell lifts the cutoff by this, easing back with the amp
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

// Warm — a warm-brass voice built for exact ratios. ONE oscillator playing an authored harmonic table (a
// PeriodicWave): strictly harmonic, so nothing beats and the partial coincidences of a just interval lock
// exactly. The table leans on h2–h4 (horn/trombone body) and falls away fast after h6, keeping the energy in
// the low partials where Cosmos's ratios coincide cleanly and out of the dense near-misses high up.
//   • Key-tracked low-pass: the cutoff sits at N × the played pitch (clamped), so the harmonic balance holds
//     across the keyboard instead of buzzing low and thinning high.
//   • Brass articulation: rows/audition open the cutoff from ~1.5 oct dark, past its resting point, then
//     settle (the "bwah" — brightness building with the buzz). Pure automation on the filter's detune.
//   • The bed keeps NO attack coloration; instead each swell brightens the cutoff with the amp (louder =
//     brighter), on top of the existing slow drift.
// Q −3.0103 is a true Butterworth: Web Audio reads lowpass/highpass Q in dB, so 0.7071 would be a small bump.
// No saturation: on a shared bus it breeds difference tones that sit outside the tuning.
// Trims are an A-weighted steady-state match to the retired saw-stack Warm v1 (the single coherent osc is ~1.5 dB hotter); final
// loudness is still an ear trim.
const WARM_HORN = [1, 0.7, 0.45, 0.3, 0.2, 0.13, 0.08, 0.05, 0.03, 0.018];
const WARM_TONE = { wave: 'custom', harmonics: WARM_HORN, ratio: 1, level: 1 };
const WARM_HP = { type: 'highpass', freq: 60, Q: -3.0103 };
const WARM_LP = { type: 'lowpass', keyTrack: { harmonics: 6, minHz: 800, maxHz: 5000 }, Q: -3.0103 };
const WARM = deepFreeze({
  id: 'warm',
  label: 'Warm',
  roles: {
    row: {
      components: [{ ...WARM_TONE }],
      noise: null,
      filters: [{ ...WARM_HP }, { ...WARM_LP, env: { startCents: -1800, peakCents: 500, attack: 0.03, settle: 0.18 } }],
      outputTrim: 0.84,
    },
    bed: {
      components: [{ ...WARM_TONE }],
      noise: null,
      filters: [{ ...WARM_HP }, {
        type: 'lowpass', keyTrack: { harmonics: 5, minHz: 700, maxHz: 3400 }, Q: -3.0103,
        drift: { rateHz: 0.06, depthCents: 250 }, swellCents: 500,
      }],
      outputTrim: 0.86,
    },
    audition: {
      components: [{ ...WARM_TONE }],
      noise: null,
      filters: [{ ...WARM_HP }, { ...WARM_LP, env: { startCents: -1800, peakCents: 400, attack: 0.04, settle: 0.25 } }],
      outputTrim: 0.84,
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

// Dev A/B paths: reachable by id, never counted as production palettes.
export const DEV_INSTRUMENT_IDS = Object.freeze(['classic']);

// The production palettes. classic is intentionally excluded — dev A/B paths, not choices.
export const PRODUCTION_INSTRUMENT_IDS = Object.freeze(INSTRUMENT_IDS.filter(id => !DEV_INSTRUMENT_IDS.includes(id)));

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
