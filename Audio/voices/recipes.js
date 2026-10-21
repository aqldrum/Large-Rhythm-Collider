// Audio/voices/recipes.js — the pure palette catalog (moved from Cosmos/audio/instruments/instrument-presets.js).
//
// Engine-agnostic, like harmony-policy.js: frozen IDs/labels, a default, a normalizer, and the
// per-role RECIPE DATA that plan.js turns into a bounded synthesis plan. It owns NO Web Audio
// nodes, NO DOM, NO storage, and it never enumerates rhythms. Nothing here imports from cosmos-audio
// (so the module stays headless-testable) or from sound-design/ or docs/ (reference assets are local).
//
// A "recipe" is a set of ROLE recipes. Cosmos plays three (row / bed / audition); the shared library adds a
// generic `note` role for everything else (main Playback's layers, later the Composer). Each role recipe is
// a small bag of oscillator components, an optional noise burst, an optional per-VOICE filter, and an
// output trim for matched loudness. plan.js resolves component ratios to Hz, clamps out-of-band partials,
// scales bell energy by register, and reports the source COST; voice.js realizes the plan.
//
// Roles differ on purpose (the work order): rows are short articulate plucks, the bed is a sustained
// swell with much less attack coloration, audition is a held/legato voice. A palette is not one
// envelope applied to every role. A `note` takes the caller's ADSR unless its recipe carries its own `amp`.
//
// The catalog is a registry (registerInstrument), not a frozen literal. Cosmos sees only the instruments
// that define all three of its roles (INSTRUMENTS / INSTRUMENT_IDS / normalizeInstrumentId), so the
// note-only sounds below never reach its rail or its normalizer; everything else reads the full catalog
// (getInstrument / NOTE_INSTRUMENT_IDS / normalizeNoteInstrumentId).

// ── Recipe field reference ────────────────────────────────────────────────────────────────────────
// component: {
//   wave: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'custom' — oscillator type ('custom' = a PeriodicWave)
//   harmonics?: number[]                                 — 'custom' only: sine amplitudes of h1, h2, … (normalized to peak 1)
//   ratio: number                                        — frequency multiplier over the base pitch (1 = fundamental)
//   level: number (0..1]                                 — static mix level; 1 with no `sub` routes straight to the amp env
//   detuneCents?: number                                 — STATIC per-osc detune (unison spread); sums with the shared bus, never replaces it
//   sub?: { attack, decay, sustain }                     — the component's OWN short envelope (e.g. a bell that decays under the body)
//   registerRolloff?, rolloffFloor?, rolloffRefHz?       — quieten an upper component by this much per octave of played pitch above
//                                                          rolloffRefHz (default 220), never below rolloffFloor (default 0.12) of itself
// }
// low?: [component]                                      — `note` role only: the components of a chord's BASS note, where they differ
//                                                          (planVoice opts.low picks them)
// noise?:  { level, attack, decay }                      — a very-low-level attack chiff (rows/audition only in practice)
// filters?: [{ type: 'lowpass'|'highpass', freq, Q,      — a PER-VOICE chain (classic has none; the bed/lead keep their shared downstream filters)
//   keyTrack?: { harmonics, minHz, maxHz }               — cutoff = harmonics × base pitch, clamped (replaces freq)
//   env?: { startCents, peakCents, attack, settle }      — birth cutoff sweep in cents: start → peak over attack → 0 over settle
//   drift?: { rateHz, depthCents }                       — bed: shared slow LFO on the cutoff
//   swellCents?: number }]                               — bed: each swell lifts the cutoff by this, easing back with the amp
// outputTrim: number                                     — per-recipe loudness match ahead of the shared limiter
// amp?: — `note` role only: the recipe's OWN loudness envelope, which overrides the caller's ADSR (the caller still
//   sets the peak and the note's length). Taken from chunk-tunes' sound model:
//     { kind: 'held', attack, release }                  — lasts as long as its note; the release sits inside the note's length
//     { kind: 'struck', attack, decay, track, ring, damp } — dies away 80 dB over `decay` seconds at 220 Hz (a higher note
//                                                          sooner: × (220/hz)^track, clamped 0.08..8 s). `ring: true` lets it die
//                                                          by itself whatever the note's length; otherwise the note's end (or a
//                                                          release) damps it to silence over `damp` seconds

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
    // chunk-tunes' "glass keys": the row voice, struck — it dies away over its own decay, damped at the note's end.
    note: {
      components: [{ wave: 'sine', ratio: 1, level: 1 }, { ...GLASS_BELL }],
      noise: { ...GLASS_NOISE },
      filters: [{ ...GLASS_LP }],
      outputTrim: 0.95,
      amp: { kind: 'struck', attack: 0.004, decay: 2.4, track: 0.3, ring: false, damp: 0.09 },
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
    // chunk-tunes' "warm horn": the row voice (with its brass sweep), held for the note's length.
    note: {
      components: [{ ...WARM_TONE }],
      noise: null,
      filters: [{ ...WARM_HP }, { ...WARM_LP, env: { startCents: -1800, peakCents: 500, attack: 0.03, settle: 0.18 } }],
      outputTrim: 0.84,
      amp: { kind: 'held', attack: 0.03, release: 0.09 },
    },
  },
});

// ── note-only sounds ──────────────────────────────────────────────────────────────────────────────
// These define only the generic `note` role, so Cosmos never sees them (its views below admit only
// instruments that define every Cosmos role).

// The four bare waveforms main Playback's layers play today. No recipe amp: the caller's ADSR shapes them.
const waveform = (wave, label) => ({
  id: wave,
  label,
  roles: { note: { components: [{ wave, ratio: 1, level: 1 }], noise: null, filters: [], outputTrim: 1 } },
});

// The chunk-tunes sounds (Overworld/econ/runtime/chunk-sounds.js), translated into this schema: `trim` →
// outputTrim, `rolloff: { perOctave, floor, refHz }` → registerRolloff / rolloffFloor / rolloffRefHz, and the
// chunk `amp` (sustain 1 = held, sustain 0 = struck; a struck sound's `release` is its damp time) → a recipe amp.
// Its glass, glassbed and warm were taken from Cosmos's recipes, so they map back onto them (glass and warm gain
// a `note` role above; glassbed is Glass's bed recipe, held) rather than being copied a second time.
// Except glass/glassbed/warm, these are first proposals that nobody has heard yet.
const rolloff = (perOctave, floor, refHz) => ({ registerRolloff: perOctave, rolloffFloor: floor, rolloffRefHz: refHz });
const BUTTERWORTH = -3.0103;   // Web Audio reads lowpass/highpass Q in dB
const struck = (attack, decay, track, ring, damp) => ({ kind: 'struck', attack, decay, track, ring, damp });
const held = (attack, release) => ({ kind: 'held', attack, release });
const note = (recipe) => ({ noise: null, filters: [], outputTrim: 1, ...recipe });

const CHUNK_SOUNDS = [
  // what every chunk-tunes part sounded on before there were sounds: a triangle, held
  { id: 'plain', label: 'Plain', roles: { note: note({ components: [{ wave: 'triangle', ratio: 1, level: 1 }], amp: held(0.012, 0.05) }) } },
  { id: 'pad', label: 'Plain Pad', roles: { note: note({ components: [{ wave: 'triangle', ratio: 1, level: 1 }], low: [{ wave: 'sine', ratio: 1, level: 1 }], amp: held(0.03, 0.14) }) } },
  { id: 'glassbed', label: 'Glass, Held', roles: { note: { ...GLASS.roles.bed, amp: held(0.05, 0.2) } } },
  // mallets: a bar's partials are not harmonics (a marimba's and a vibraphone's second is two octaves up, a
  // xylophone's a twelfth); the upper ones die first
  { id: 'marimba', label: 'Marimba', roles: { note: note({
    components: [{ wave: 'sine', ratio: 1, level: 1 },
      { wave: 'sine', ratio: 4, level: 0.28, sub: { attack: 0.002, decay: 0.12, sustain: 0 }, ...rolloff(0.3, 0.15, 220) },
      { wave: 'sine', ratio: 9.2, level: 0.08, sub: { attack: 0.001, decay: 0.03, sustain: 0 }, ...rolloff(0.35, 0.1, 220) }],
    noise: { level: 0.08, attack: 0.001, decay: 0.012 }, filters: [{ type: 'lowpass', freq: 5200, Q: 0.7071 }],
    amp: struck(0.002, 0.9, 0.5, true, 0.08), outputTrim: 1.1 }) } },
  { id: 'vibes', label: 'Vibraphone', roles: { note: note({
    components: [{ wave: 'sine', ratio: 1, level: 1 },
      { wave: 'sine', ratio: 4, level: 0.18, sub: { attack: 0.002, decay: 0.5, sustain: 0 }, ...rolloff(0.3, 0.15, 220) },
      { wave: 'sine', ratio: 10, level: 0.05, sub: { attack: 0.001, decay: 0.06, sustain: 0 }, ...rolloff(0.35, 0.1, 220) }],
    noise: { level: 0.03, attack: 0.001, decay: 0.01 }, filters: [{ type: 'lowpass', freq: 6000, Q: 0.7071 }],
    amp: struck(0.003, 4, 0.4, false, 0.12), outputTrim: 0.9 }) } },
  { id: 'xylophone', label: 'Xylophone', roles: { note: note({
    components: [{ wave: 'sine', ratio: 1, level: 1 },
      { wave: 'sine', ratio: 3, level: 0.35, sub: { attack: 0.001, decay: 0.08, sustain: 0 }, ...rolloff(0.3, 0.15, 440) },
      { wave: 'sine', ratio: 6.2, level: 0.1, sub: { attack: 0.001, decay: 0.025, sustain: 0 }, ...rolloff(0.35, 0.1, 440) }],
    noise: { level: 0.1, attack: 0.0005, decay: 0.008 }, filters: [{ type: 'lowpass', freq: 7000, Q: 0.7071 }],
    amp: struck(0.001, 0.35, 0.5, true, 0.05), outputTrim: 1.05 }) } },
  { id: 'kalimba', label: 'Kalimba', roles: { note: note({
    components: [{ wave: 'sine', ratio: 1, level: 1 },
      { wave: 'sine', ratio: 5.9, level: 0.15, sub: { attack: 0.001, decay: 0.06, sustain: 0 }, ...rolloff(0.3, 0.15, 330) }],
    noise: { level: 0.05, attack: 0.0005, decay: 0.01 }, filters: [{ type: 'lowpass', freq: 4800, Q: 0.7071 }],
    amp: struck(0.002, 1.1, 0.4, true, 0.08), outputTrim: 1.05 }) } },
  // a plucked string: every harmonic at the pluck, the top closing as it rings
  { id: 'harp', label: 'Harp', roles: { note: note({
    components: [{ wave: 'custom', harmonics: [1, 0.5, 0.33, 0.2, 0.12, 0.08, 0.05], ratio: 1, level: 1 }],
    filters: [{ type: 'lowpass', keyTrack: { harmonics: 5, minHz: 500, maxHz: 4200 }, Q: BUTTERWORTH, env: { startCents: 2400, peakCents: 2400, attack: 0.001, settle: 0.25 } }],
    amp: struck(0.002, 1.6, 0.35, true, 0.08), outputTrim: 0.8 }) } },
  { id: 'upright', label: 'Plucked Bass', roles: { note: note({
    components: [{ wave: 'custom', harmonics: [1, 0.6, 0.35, 0.2, 0.12, 0.07, 0.04], ratio: 1, level: 1 }],
    noise: { level: 0.03, attack: 0.001, decay: 0.015 },
    filters: [{ type: 'lowpass', keyTrack: { harmonics: 4, minHz: 220, maxHz: 1800 }, Q: BUTTERWORTH, env: { startCents: 1400, peakCents: 1400, attack: 0.001, settle: 0.12 } }],
    amp: struck(0.004, 1.6, 0.3, false, 0.06), outputTrim: 1 }) } },
  { id: 'sub', label: 'Round Bass', roles: { note: note({
    components: [{ wave: 'sine', ratio: 1, level: 1 }, { wave: 'sine', ratio: 2, level: 0.12 }], amp: held(0.012, 0.06), outputTrim: 1.1 }) } },
  // winds: held. A reed's odd harmonics; a flute's near-sine with breath at the attack (the horn is Warm's note, above)
  { id: 'reed', label: 'Reed', roles: { note: note({
    components: [{ wave: 'custom', harmonics: [1, 0.04, 0.5, 0.03, 0.28, 0.03, 0.14, 0.02, 0.08], ratio: 1, level: 1 }],
    noise: { level: 0.02, attack: 0.01, decay: 0.08 },
    filters: [{ type: 'lowpass', keyTrack: { harmonics: 7, minHz: 900, maxHz: 4500 }, Q: BUTTERWORTH }],
    amp: held(0.035, 0.07), outputTrim: 0.7 }) } },
  { id: 'flute', label: 'Flute', roles: { note: note({
    components: [{ wave: 'sine', ratio: 1, level: 1 }, { wave: 'sine', ratio: 2, level: 0.22 }, { wave: 'sine', ratio: 3, level: 0.07 }],
    noise: { level: 0.05, attack: 0.01, decay: 0.09 }, filters: [{ type: 'lowpass', freq: 3600, Q: 0.7071 }],
    amp: held(0.06, 0.09), outputTrim: 0.85 }) } },
];

// Each chunk-tunes sound id → the instrument that now plays it (all 14; glass and warm are Cosmos's own).
export const CHUNK_SOUND_INSTRUMENTS = Object.freeze({
  plain: 'plain', pad: 'pad', glass: 'glass', glassbed: 'glassbed', marimba: 'marimba', vibes: 'vibes', xylophone: 'xylophone',
  kalimba: 'kalimba', harp: 'harp', upright: 'upright', sub: 'sub', reed: 'reed', flute: 'flute', warm: 'warm',
});

// ── the catalog: a registry ─────────────────────────────────────────────────────────────────────────

// The roles Cosmos plays. An instrument counts as a Cosmos palette only when it defines all three.
export const INSTRUMENT_ROLES = Object.freeze(['row', 'bed', 'audition']);
// Every role a recipe may define: Cosmos's three plus the generic `note`.
export const VOICE_ROLES = Object.freeze([...INSTRUMENT_ROLES, 'note']);
const AMP_KINDS = Object.freeze(['held', 'struck']);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

// The engine's safe fallback: classic == today's sound, so an unknown id degrades to no audible change
// rather than to silence or an unfinished palette. The RAIL's default production choice is a separate
// decision made after audition (Step 4); this is only the normalization backstop.
export const DEFAULT_INSTRUMENT = 'classic';
// The `note` role's fallback: a sine, main Playback's default layer waveform.
export const DEFAULT_NOTE_INSTRUMENT = 'sine';

const catalog = new Map();   // id -> frozen instrument def, in registration order

// Live views of the catalog, rebuilt on every registration (ES module bindings, so importers see updates).
// INSTRUMENTS: the Cosmos palettes, id -> def. normalizeInstrumentId folds any unknown id to classic, so a stale
// stored value or an early rail selection can never brick audio. Production palettes are Glass and Warm.
export let INSTRUMENTS = Object.freeze({});
// Every Cosmos palette id the engine understands (includes the dev-only classic).
export let INSTRUMENT_IDS = Object.freeze([]);
// Dev A/B paths (`dev: true`): reachable by id, never counted as production palettes.
export let DEV_INSTRUMENT_IDS = Object.freeze([]);
// The production palettes. classic is intentionally excluded — dev A/B paths, not choices.
export let PRODUCTION_INSTRUMENT_IDS = Object.freeze([]);
// Every instrument that defines the generic `note` role (main Playback's choices), in registration order.
export let NOTE_INSTRUMENT_IDS = Object.freeze([]);
// Every registered id.
export let CATALOG_IDS = Object.freeze([]);

function rebuildViews() {
  const defs = [...catalog.values()];
  const cosmos = defs.filter(def => INSTRUMENT_ROLES.every(role => def.roles[role]));
  INSTRUMENTS = Object.freeze(Object.fromEntries(cosmos.map(def => [def.id, def])));
  INSTRUMENT_IDS = Object.freeze(cosmos.map(def => def.id));
  DEV_INSTRUMENT_IDS = Object.freeze(cosmos.filter(def => def.dev).map(def => def.id));
  PRODUCTION_INSTRUMENT_IDS = Object.freeze(INSTRUMENT_IDS.filter(id => !DEV_INSTRUMENT_IDS.includes(id)));
  NOTE_INSTRUMENT_IDS = Object.freeze(defs.filter(def => def.roles.note).map(def => def.id));
  CATALOG_IDS = Object.freeze(defs.map(def => def.id));
}

function invalid(id, why) { return new TypeError(`registerInstrument(${JSON.stringify(id)}): ${why}`); }

// Add an instrument to the catalog. def: { id, label?, dev?, roles: { [role]: role recipe } } — at least one
// role from VOICE_ROLES, each with ≥1 component; a recipe `amp` only on the `note` role. The def is frozen (deeply,
// in place) and returned. An id can be registered once: the built-ins can never be replaced, so Cosmos's palettes
// stay exactly what they are.
export function registerInstrument(def) {
  const id = def?.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw invalid(id, 'an id is letters, digits, - and _');
  if (catalog.has(id)) throw invalid(id, 'that id is already registered');
  const roles = def.roles;
  if (!roles || typeof roles !== 'object') throw invalid(id, 'needs a roles object');
  const roleNames = Object.keys(roles);
  if (!roleNames.length) throw invalid(id, 'needs at least one role');
  for (const role of roleNames) {
    if (!VOICE_ROLES.includes(role)) throw invalid(id, `unknown role "${role}" (roles are ${VOICE_ROLES.join(', ')})`);
    const recipe = roles[role];
    if (!recipe || !Array.isArray(recipe.components) || !recipe.components.length) throw invalid(id, `role "${role}" needs at least one component`);
    if (recipe.low != null && (role !== 'note' || !Array.isArray(recipe.low) || !recipe.low.length)) throw invalid(id, `role "${role}": \`low\` is a non-empty component list, note role only`);
    if (recipe.amp != null) {
      if (role !== 'note') throw invalid(id, `role "${role}": a recipe amp is read only by the note role`);
      if (!AMP_KINDS.includes(recipe.amp.kind)) throw invalid(id, `role "note": amp.kind is ${AMP_KINDS.join(' or ')}`);
    }
  }
  const entry = deepFreeze({ ...def, id, label: typeof def.label === 'string' && def.label ? def.label : id, dev: !!def.dev, roles });
  catalog.set(id, entry);
  rebuildViews();
  return entry;
}

// The built-ins, in the order Cosmos has always listed them (glass, warm, classic), then the note-only sounds.
registerInstrument(GLASS);
registerInstrument(WARM);
registerInstrument({ ...CLASSIC, dev: true });
for (const def of [waveform('sine', 'Sine'), waveform('triangle', 'Triangle'), waveform('sawtooth', 'Sawtooth'), waveform('square', 'Square')]) registerInstrument(def);
for (const def of CHUNK_SOUNDS) registerInstrument(def);

// Fold any value to a known COSMOS palette id (mirrors clampParam's choice behavior in rail-params.js). A
// note-only sound is not a Cosmos palette, so it folds to classic exactly as an unknown id always has.
export function normalizeInstrumentId(id) {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, id) ? id : DEFAULT_INSTRUMENT;
}

// Fold any value to an instrument that can play the `note` role (an unknown one → sine).
export function normalizeNoteInstrumentId(id) {
  return typeof id === 'string' && catalog.get(id)?.roles.note ? id : DEFAULT_NOTE_INSTRUMENT;
}

// The frozen def for an id, from the whole catalog, or null.
export function getInstrument(id) {
  return (typeof id === 'string' && catalog.get(id)) || null;
}

// The frozen role recipe for (id, role). Falls back through the instrument (an unknown id → classic), then to the
// role's default (classic's for a Cosmos role, sine's for `note`), so a partially-defined palette can omit a role
// and still render rather than throwing on the audio path. For the Cosmos roles this answers exactly as the frozen
// pre-registry catalog did: a note-only sound has no row/bed/audition, so it falls to classic's, as an unknown id did.
export function getRecipe(id, role) {
  const instrument = getInstrument(id) || catalog.get(DEFAULT_INSTRUMENT);
  const own = Object.prototype.hasOwnProperty.call(instrument.roles, role) ? instrument.roles[role] : null;
  return own || (role === 'note' ? catalog.get(DEFAULT_NOTE_INSTRUMENT).roles.note : CLASSIC.roles[role]);
}

export function instrumentLabel(id) {
  return INSTRUMENTS[normalizeInstrumentId(id)].label;
}
