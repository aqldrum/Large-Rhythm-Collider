// assert-instruments.mjs — proofs for the PURE instrument layer: the palette catalog
// (../instruments/instrument-presets.js) and the recipe→plan compiler (../instruments/voice-plan.js).
// No AudioContext or DOM — these two modules must be fully headless-testable (the renderer's Web Audio
// graph is covered by assert-instrument-voice.mjs).
import {
  INSTRUMENTS, INSTRUMENT_IDS, PRODUCTION_INSTRUMENT_IDS, INSTRUMENT_ROLES,
  DEFAULT_INSTRUMENT, normalizeInstrumentId, getRecipe, instrumentLabel,
} from '../instruments/instrument-presets.js';
import { planVoice, ENV_FLOOR } from '../instruments/voice-plan.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('═══ COSMOS INSTRUMENTS — presets & voice plan ═══');

console.log('\n  Catalog & normalization');
check('the default instrument is a known id (the safe fallback == today\'s sound)',
  Object.prototype.hasOwnProperty.call(INSTRUMENTS, DEFAULT_INSTRUMENT) && DEFAULT_INSTRUMENT === 'classic');
check('an unknown id normalizes to the default, a known id passes through',
  normalizeInstrumentId('bogus') === DEFAULT_INSTRUMENT && normalizeInstrumentId('classic') === 'classic' &&
  normalizeInstrumentId(undefined) === DEFAULT_INSTRUMENT && normalizeInstrumentId(42) === DEFAULT_INSTRUMENT);
check('the dev-only classic palette exists but is NOT a production palette; the retired warm-v1 is gone',
  INSTRUMENT_IDS.includes('classic') && !PRODUCTION_INSTRUMENT_IDS.includes('classic') &&
  !INSTRUMENT_IDS.includes('warm-v1') && normalizeInstrumentId('warm-v1') === DEFAULT_INSTRUMENT);
check('every catalog instrument defines all three roles',
  INSTRUMENT_IDS.every(id => INSTRUMENT_ROLES.every(role => INSTRUMENTS[id].roles[role])));
check('a label is available for a known and an unknown id (never throws)',
  instrumentLabel('classic') === 'Classic' && instrumentLabel('bogus') === instrumentLabel(DEFAULT_INSTRUMENT));

console.log('\n  Recipe lookup falls back safely');
check('getRecipe returns the requested role, and an unknown id folds to the default',
  getRecipe('classic', 'row').components[0].wave === 'triangle' &&
  getRecipe('bogus', 'bed').components[0].wave === getRecipe(DEFAULT_INSTRUMENT, 'bed').components[0].wave);
check('classic reproduces today\'s per-role split (rows/audition triangle, bed sine)',
  getRecipe('classic', 'row').components[0].wave === 'triangle' &&
  getRecipe('classic', 'audition').components[0].wave === 'triangle' &&
  getRecipe('classic', 'bed').components[0].wave === 'sine');
check('recipe data is frozen so a consumer cannot mutate the shared catalog',
  Object.isFrozen(getRecipe('classic', 'row')) && Object.isFrozen(getRecipe('classic', 'row').components));

console.log('\n  planVoice — classic parity (cost 1, single oscillator, no per-voice filter)');
const sr = 48000;
const rowPlan = planVoice(getRecipe('classic', 'row'), {
  role: 'row', baseFreq: 440,
  timing: { peak: 0.16, attack: 0.004, decay: 0.46, hold: 0.0, release: 0.09, sustain: 0.05, duration: 0.23, micro: false },
  sampleRate: sr,
});
check('classic row is one triangle at the base pitch, no filter, cost 1',
  rowPlan.cost === 1 && rowPlan.components.length === 1 && rowPlan.components[0].wave === 'triangle' &&
  near(rowPlan.components[0].freq, 440) && rowPlan.filters.length === 0 && rowPlan.outputTrim === 1 && rowPlan.noise === null);
check('the row amp passes the gap-aware plan through, including release (needed by the hold fallback)',
  rowPlan.amp.peak === 0.16 && rowPlan.amp.attack === 0.004 && rowPlan.amp.decay === 0.46 &&
  rowPlan.amp.hold === 0 && rowPlan.amp.release === 0.09 && rowPlan.amp.sustain === 0.05 &&
  rowPlan.amp.duration === 0.23 && rowPlan.amp.micro === false && rowPlan.flags.micro === false);
const bedPlan = planVoice(getRecipe('classic', 'bed'), { role: 'bed', baseFreq: 220, timing: { attack: 1.5, release: 2.5, sustainFrac: 0.4 }, sampleRate: sr });
check('classic bed is one sine, cost 1, with a swell-shaped amp (attack/release/sustainFrac only)',
  bedPlan.cost === 1 && bedPlan.components[0].wave === 'sine' && near(bedPlan.components[0].freq, 220) &&
  bedPlan.amp.attack === 1.5 && bedPlan.amp.release === 2.5 && bedPlan.amp.sustainFrac === 0.4 && bedPlan.amp.peak === undefined);
const audPlan = planVoice(getRecipe('classic', 'audition'), { role: 'audition', baseFreq: 660, timing: { peak: 0.32, attack: 0.006, decay: 0.2, sustain: 0.224 }, sampleRate: sr });
check('classic audition is one triangle, cost 1, with a held linear ADSR amp',
  audPlan.cost === 1 && audPlan.components[0].wave === 'triangle' && near(audPlan.components[0].freq, 660) &&
  audPlan.amp.peak === 0.32 && audPlan.amp.attack === 0.006 && audPlan.amp.decay === 0.2 && audPlan.amp.sustain === 0.224);

console.log('\n  planVoice — bounded, finite plans at register extremes');
const ceiling = sr * 0.45;
const highRow = planVoice(getRecipe('classic', 'row'), { role: 'row', baseFreq: 1e6, timing: { duration: 0.1 }, sampleRate: sr });
check('a base pitch above the anti-alias ceiling is CLAMPED, not dropped (the body always survives)',
  highRow.components.length === 1 && highRow.components[0].freq <= ceiling && Number.isFinite(highRow.components[0].freq));
check('every planned component frequency is finite and in-band for all three roles',
  [rowPlan, bedPlan, audPlan, highRow].every(p => p.components.every(c => Number.isFinite(c.freq) && c.freq > 0 && c.freq <= ceiling)));
const zeroRow = planVoice(getRecipe('classic', 'row'), { role: 'row', baseFreq: 0, timing: {}, sampleRate: sr });
check('a non-positive base pitch yields no components and cost 0 (never a NaN oscillator)',
  zeroRow.components.length === 0 && zeroRow.cost === 0);

console.log('\n  planVoice — cost tracks REAL sources (out-of-band partials are culled, not charged)');
// A synthetic two-component recipe: a body (ratio 1, always kept) plus an upper partial whose pitch, at a
// high base, exceeds the ceiling — it must be dropped AND not counted, so a caller admits by real cost.
const bellRecipe = Object.freeze({
  components: Object.freeze([
    Object.freeze({ wave: 'sine', ratio: 1, level: 1 }),
    Object.freeze({ wave: 'sine', ratio: 8, level: 0.1 }),
  ]),
  noise: null, filter: null, outputTrim: 1,
});
const lowBell = planVoice(bellRecipe, { role: 'row', baseFreq: 300, timing: { duration: 0.1 }, sampleRate: sr });
check('an in-band upper partial is kept and charged (cost 2)',
  lowBell.cost === 2 && lowBell.components.length === 2 && near(lowBell.components[1].freq, 2400));
const highBell = planVoice(bellRecipe, { role: 'row', baseFreq: 4000, timing: { duration: 0.1 }, sampleRate: sr });
check('an out-of-band upper partial (8×4000 ≥ ceiling) is culled and NOT charged (cost 1)',
  highBell.cost === 1 && highBell.components.length === 1 && highBell.components[0].freq <= ceiling);

console.log('\n  planVoice — component fields (level, static detune, sub-envelope, filter)');
const richRecipe = Object.freeze({
  components: Object.freeze([
    Object.freeze({ wave: 'sawtooth', ratio: 1, level: 0.5, detuneCents: 4 }),
    Object.freeze({ wave: 'sawtooth', ratio: 1, level: -3, detuneCents: -4 }),   // negative level → clamp to 0
  ]),
  noise: Object.freeze({ level: 0.05, attack: 0.002, decay: 0.05 }),
  filters: Object.freeze([Object.freeze({ type: 'highpass', freq: 110 }), Object.freeze({ type: 'lowpass', freq: 2800, Q: 0.9, drift: { rateHz: 0.06, depthCents: 250 } })]),
  outputTrim: 0.8,
});
const rich = planVoice(richRecipe, { role: 'audition', baseFreq: 220, timing: { peak: 0.3, attack: 0.01, decay: 0.1, sustain: 0.2 }, sampleRate: sr });
check('static per-osc detune passes through and a negative level clamps to zero',
  rich.components[0].detuneCents === 4 && rich.components[1].detuneCents === -4 &&
  rich.components[0].level === 0.5 && rich.components[1].level === 0);
check('a per-voice filter CHAIN is carried in order (HP then LP), and a slow drift is resolved on the LP',
  rich.filters.length === 2 && rich.filters[0].type === 'highpass' && rich.filters[1].type === 'lowpass' &&
  rich.filters[1].Q === 0.9 && near(rich.filters[1].freq, 2800) && rich.filters[1].drift.rateHz === 0.06 && rich.filters[1].drift.depthCents === 250);
check('the noise source adds to the cost, filters do not (2 osc + 1 noise = 3)',
  rich.noise.level === 0.05 && rich.cost === 3 && rich.outputTrim === 0.8);
check('a filter cutoff above the ceiling is clamped in-band',
  planVoice({ components: [{ wave: 'sine', ratio: 1, level: 1 }], filters: [{ type: 'lowpass', freq: 1e6 }] }, { role: 'row', baseFreq: 220, timing: {}, sampleRate: sr }).filters[0].freq <= ceiling);
check('ENV_FLOOR is a small positive non-zero (a legal exponential-ramp target)', ENV_FLOOR > 0 && ENV_FLOOR < 0.01);

console.log('\n  Production palettes — Glass & Warm');
check('the two production palettes are Glass and Warm', PRODUCTION_INSTRUMENT_IDS.join(',') === 'glass,warm');
const glassRow = planVoice(getRecipe('glass', 'row'), { role: 'row', baseFreq: 220, timing: { peak: 0.16, attack: 0.004, decay: 0.46, hold: 0, release: 0.09, sustain: 0.05, duration: 0.23, micro: false }, sampleRate: sr });
check('Glass row = sine body + high sine bell (own decay) + attack noise through a low-pass (cost 3)',
  glassRow.cost === 3 && glassRow.components[0].wave === 'sine' && glassRow.components[1].wave === 'sine' &&
  glassRow.components[1].sub && glassRow.components[1].sub.decay > 0 && glassRow.noise && glassRow.filters[0].type === 'lowpass');
check('Glass BED has no bell/noise transient (a swell can never re-trigger a keys attack)',
  getRecipe('glass', 'bed').components.every(c => !c.sub) && getRecipe('glass', 'bed').noise === null);
// register rolloff: the bell is quieter for a HIGH note than a LOW one, and never fully vanishes.
const bellLow = planVoice(getRecipe('glass', 'row'), { role: 'row', baseFreq: 220, timing: { duration: 0.2 }, sampleRate: sr }).components[1].level;
const bellHigh = planVoice(getRecipe('glass', 'row'), { role: 'row', baseFreq: 880, timing: { duration: 0.2 }, sampleRate: sr }).components[1].level;
check('the Glass bell is register-scaled: quieter high, louder low, never zero', bellHigh < bellLow && bellHigh > 0);
const warmRow = planVoice(getRecipe('warm', 'row'), { role: 'row', baseFreq: 220, timing: {}, sampleRate: sr });
check('Warm = ONE harmonic-table osc, zero static detune (nothing beats), every role cost 1',
  INSTRUMENT_ROLES.every(role => {
    const p = planVoice(getRecipe('warm', role), { role, baseFreq: 220, timing: {}, sampleRate: sr });
    return p.cost === 1 && p.components[0].wave === 'custom' && p.components[0].harmonics.length >= 6 && p.components[0].detuneCents === 0;
  }));
check('Warm\'s harmonic table leans low: h2–h3 strong, falling steeply past h6',
  (h => h[1] >= 0.5 && h[2] >= 0.35 && h[7] < 0.1 && h.every((v, i) => i === 0 || v <= h[i - 1]))(warmRow.components[0].harmonics));
const warmLp = f => planVoice(getRecipe('warm', 'row'), { role: 'row', baseFreq: f, timing: {}, sampleRate: sr }).filters[1].freq;
check('Warm low-pass is key-tracked: cutoff rises with pitch, clamped at both ends',
  near(warmLp(220), 1320) && near(warmLp(330), 1980) && warmLp(55) === 800 && warmLp(1760) === 5000);
check('Warm high-pass sits under the fundamental (≤ 60 Hz) as a Butterworth (Q in dB)',
  warmRow.filters[0].type === 'highpass' && warmRow.filters[0].freq <= 60 && near(warmRow.filters[0].Q, -3.0103, 1e-3));
check('Warm rows/audition carry a brass cutoff sweep (dark start → past rest → settle), no drift',
  ['row', 'audition'].every(role => {
    const f = planVoice(getRecipe('warm', role), { role, baseFreq: 220, timing: {}, sampleRate: sr }).filters[1];
    return f.env && f.env.startCents < -600 && f.env.peakCents > 0 && f.env.attack < 0.1 && !f.drift && !f.swellCents;
  }));
const warmBed = planVoice(getRecipe('warm', 'bed'), { role: 'bed', baseFreq: 220, timing: { attack: 1.5, release: 2.5, sustainFrac: 0.4 }, sampleRate: sr });
check('Warm bed has NO birth sweep (no attack coloration) but brightens with each swell, over the slow drift',
  !warmBed.filters[1].env && warmBed.filters[1].swellCents > 0 && warmBed.filters[1].drift.depthCents > 0);
check('a custom wave with no usable table degrades to a sine (never throws on the audio path)',
  ['custom-empty', 'custom-zeros'].every((k, i) => {
    const c = i ? { wave: 'custom', harmonics: [0, 0], ratio: 1, level: 1 } : { wave: 'custom', ratio: 1, level: 1 };
    const p = planVoice({ components: [c] }, { role: 'row', baseFreq: 220, timing: {}, sampleRate: sr });
    return p.components[0].wave === 'sine' && p.components[0].harmonics === null;
  }));
// Every production role carries a finite, positive output trim — the per-recipe matched-loudness control
// (its VALUE is tuned by ear against a live level measurement, not asserted here; filters and trim interact,
// so a bare trim ordering is not a meaningful invariant).
check('every production role declares a finite positive output trim (the matched-loudness control)',
  PRODUCTION_INSTRUMENT_IDS.every(id => INSTRUMENT_ROLES.every(role => {
    const t = getRecipe(id, role).outputTrim; return Number.isFinite(t) && t > 0;
  })));

console.log(PASS ? '\n✓✓✓ COSMOS INSTRUMENTS PASSES' : '\n✗ COSMOS INSTRUMENTS FAILED');
process.exit(PASS ? 0 : 1);
