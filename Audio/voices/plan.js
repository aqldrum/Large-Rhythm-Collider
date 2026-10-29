// Audio/voices/plan.js — the pure recipe→plan compiler (moved from Cosmos/audio/instruments/voice-plan.js).
//
// planVoice() turns a frozen role recipe (recipes.js) plus a role/pitch/timing into a bounded,
// finite SYNTHESIS PLAN that voice.js realizes as Web Audio nodes. It creates NO nodes, reads
// NO clocks, and solves NO harmony — it is the seam between "what a palette is" and "how it sounds".
//
// It is where the two safety rules the work order names get enforced, purely and testably:
//   • out-of-band partials are DROPPED (an upper component whose pitch reaches the anti-alias ceiling adds
//     only alias risk), which also means they are not charged to the source budget; and
//   • the source COST is the count of real source nodes the plan will create (oscillators + noise), so a
//     caller can admit against its oscillator ceiling BEFORE building a graph.

// Shared with voice.js: the non-zero floor an exponential ramp can target (0 is illegal for
// exponentialRampToValueAtTime). Matches the row/bed engines' historical 0.0001.
export const ENV_FLOOR = 0.0001;

// Fraction of the sample rate above which a partial is treated as out of band. Matches the row player's
// long-standing `sampleRate * 0.45` oscillator-frequency clamp.
const NYQUIST_FRACTION = 0.45;

const num = (v, fallback = 0) => (Number.isFinite(+v) ? +v : fallback);

function ceilingHz(sampleRate) {
  return (num(sampleRate, 48000) || 48000) * NYQUIST_FRACTION;
}

// Normalize a role's amp-envelope inputs. The renderer schedules the actual curve; this only coerces the
// numbers each role supplies so a fixture or a bad recipe can't inject NaN onto an AudioParam.
//   • row      — the gap-aware plan from rowEnvelopePlan() (short pluck / micro window).
//   • bed      — swell shape only; the peak is supplied per-swell at runtime, not baked here.
//   • audition — a held linear ADSR.
function normalizeAmp(role, t = {}) {
  if (role === 'bed') {
    return Object.freeze({ attack: num(t.attack), release: num(t.release), sustainFrac: num(t.sustainFrac, 0.4) });
  }
  if (role === 'audition') {
    return Object.freeze({ peak: num(t.peak), attack: num(t.attack), decay: num(t.decay), sustain: num(t.sustain) });
  }
  return Object.freeze({
    peak: num(t.peak), attack: num(t.attack), decay: num(t.decay), hold: num(t.hold),
    release: num(t.release), sustain: num(t.sustain, ENV_FLOOR), duration: num(t.duration), micro: !!t.micro,
  });
}

// ── the generic `note` role's loudness ──────────────────────────────────────────────────────────────
// A note's amp is a list of MOMENTS from the note's start — { at, value, ramp: 'set' | 'linear' | 'exp' } — that
// the renderer schedules one for one on the amp gain, plus what a release needs. Three kinds:
//   • adsr   — the caller's { attack, decay, sustain (a fraction of peak), release }. With a duration it is
//              main Playback's startStandardNote curve; with duration null it is startLegatoNote's held curve.
//   • held   — a recipe amp { kind: 'held', attack, release }: at its peak for the note's length, the release inside it.
//   • struck — a recipe amp { kind: 'struck', attack, decay, track, ring, damp }: 80 dB down over its decay, rung
//              out or damped at the note's end. held and struck are chunk-tunes' ampMoments, value for value.
// duration null = hold until the handle's release(); a struck sound still dies away by itself.

const TAIL = 0.01;        // a struck sound's last step from its floor to silence
const STOP_PAD = 0.02;    // sources stop this long after a recipe-amp note is silent

// How long a struck sound takes to die away at a pitch: its decay at 220 Hz, a higher note sooner by `track`.
export function decaySeconds(amp, hz) {
  return Math.min(8, Math.max(0.08, num(amp.decay) * (220 / hz) ** num(amp.track)));
}

// The loudness at `t` seconds from the note's start, read from its moments as an AudioParam would play them.
export function ampValueAt(moments, t) {
  if (!moments.length || t < moments[0].at) return 0;
  let value = moments[0].value;
  for (let i = 1; i < moments.length; i++) {
    const a = moments[i - 1], b = moments[i];
    if (t >= b.at) { value = b.value; continue; }
    if (b.ramp === 'set') return value;
    const x = (t - a.at) / (b.at - a.at);
    return b.ramp === 'exp' ? a.value * (b.value / a.value) ** x : a.value + (b.value - a.value) * x;
  }
  return value;
}

const moment = (at, value, ramp) => Object.freeze({ at, value, ramp });

function planNoteAmp(recipeAmp, t, hz) {
  const P = Math.max(0, num(t.peak, 1));
  const duration = t.duration == null ? null : Math.max(0, num(t.duration));
  let kind, moments, release, ring = false, seconds = null, stopAt = null;
  if (recipeAmp && recipeAmp.kind === 'struck') {
    kind = 'struck';
    const attack = Math.max(0, num(recipeAmp.attack)), D = decaySeconds(recipeAmp, hz), natural = attack + D;
    ring = !!recipeAmp.ring;
    release = Math.max(0, num(recipeAmp.damp));
    if (ring || duration == null || duration >= natural) {
      moments = [moment(0, 0, 'set'), moment(attack, P, 'linear'), moment(natural, P * ENV_FLOOR, 'exp'), moment(natural + TAIL, 0, 'linear')];
      seconds = natural + TAIL;
    } else if (duration <= attack) {
      moments = [moment(0, 0, 'set'), moment(duration, attack > 0 ? P * (duration / attack) : P, 'linear'), moment(duration + release, 0, 'linear')];
      seconds = duration + release;
    } else {
      moments = [moment(0, 0, 'set'), moment(attack, P, 'linear'), moment(duration, P * ENV_FLOOR ** ((duration - attack) / D), 'exp'), moment(duration + release, 0, 'linear')];
      seconds = duration + release;
    }
    stopAt = seconds + STOP_PAD;
  } else if (recipeAmp && recipeAmp.kind === 'held') {
    kind = 'held';
    release = Math.max(0, num(recipeAmp.release));
    if (duration == null) {
      moments = [moment(0, 0, 'set'), moment(Math.max(0, num(recipeAmp.attack)), P, 'linear')];
    } else {
      const r = Math.min(release, duration / 2), attack = Math.min(Math.max(0, num(recipeAmp.attack)), duration - r);
      moments = [moment(0, 0, 'set'), moment(attack, P, 'linear'), moment(Math.max(attack, duration - r), P, 'set'), moment(duration, 0, 'linear')];
      seconds = duration;
      stopAt = seconds + STOP_PAD;
    }
  } else {
    kind = 'adsr';
    const attack = Math.max(0, num(t.attack)), decay = Math.max(0, num(t.decay)), S = Math.max(0, num(t.sustain, 1)) * P;
    const r = Math.max(0, num(t.release));
    release = Math.max(r, 0.01);
    if (duration == null) {
      moments = [moment(0, 0, 'set'), moment(attack, P, 'linear'), moment(attack + decay, S, 'linear'), moment(attack + decay + 0.01, S, 'set')];
    } else {
      const sustainTime = Math.max(0, duration - attack - decay - r);
      moments = [moment(0, 0, 'set'), moment(attack, P, 'linear'), moment(attack + decay, S, 'linear'), moment(attack + decay + sustainTime, S, 'set'), moment(duration, 0, 'linear')];
      seconds = Math.max(0.01, duration);
      stopAt = seconds;
    }
  }
  return Object.freeze({ kind, peak: P, duration, moments: Object.freeze(moments), release, ring, seconds, stopAt });
}

// ── retune data, kept beside the plan ───────────────────────────────────────────────────────────────
// What setFrequency() needs (each built component's ratio, each key-tracked filter's rule, the ceiling) lives in a
// side table keyed by the frozen plan rather than on it, so the Cosmos row/bed/audition plans stay byte-identical to
// their pre-library shape (the Cosmos guard) while every voice can still retune.
const retuneTable = new WeakMap();
export function retuneSpec(plan) { return retuneTable.get(plan) || null; }

// noteRules: the `note` role (new with the shared library) also cuts a 'custom' harmonic table where it leaves the
// band and floors sub-envelope times at 0.5 ms, as chunk-tunes does. The Cosmos roles keep their frozen behavior.
function planComponent(component, baseFreq, sampleRate, noteRules = false) {
  const ratio = num(component.ratio, 1) || 1;
  const raw = baseFreq * ratio;
  if (!(raw > 0) || !Number.isFinite(raw)) return null;
  const ceiling = ceilingHz(sampleRate);
  // An UPPER partial (ratio > 1) whose fundamental reaches the ceiling contributes nothing but alias risk,
  // so it is culled and not charged to the budget. The body (ratio ≤ 1) always survives — its pitch is
  // merely clamped below, exactly as the row player has always clamped its single oscillator.
  if (ratio > 1 && raw >= ceiling) return null;
  let level = num(component.level, 1);
  if (level < 0) level = 0;
  // Register rolloff: quieten an upper component (e.g. a glass bell) as the PLAYED note climbs the keyboard,
  // so high notes never become piercing — the work order's "reduce upper-component energy with register".
  // Measured from the note's base pitch (not the component's own frequency) and floored so it never vanishes.
  if (component.registerRolloff) {
    const octavesUp = Math.max(0, Math.log2(baseFreq / (num(component.rolloffRefHz, 220) || 220)));
    level *= Math.max(num(component.rolloffFloor, 0.12), 1 - num(component.registerRolloff) * octavesUp);
  }
  const sub = !component.sub ? null : noteRules
    ? Object.freeze({ attack: Math.max(0.0005, num(component.sub.attack)), decay: Math.max(0.0005, num(component.sub.decay)), sustain: Math.max(0, num(component.sub.sustain)) })
    : Object.freeze({ attack: num(component.sub.attack), decay: num(component.sub.decay), sustain: num(component.sub.sustain) });
  // 'custom' needs a usable harmonic table (finite, non-negative, not all zero); otherwise it degrades to a
  // sine so a malformed recipe still sounds rather than throwing on the audio path.
  let wave = component.wave || 'sine';
  let harmonics = null;
  if (wave === 'custom') {
    let table = Array.isArray(component.harmonics) ? component.harmonics.map(h => Math.max(0, num(h))) : [];
    if (noteRules) table = table.filter((_, i) => raw * (i + 1) < ceiling);
    if (table.some(h => h > 0)) harmonics = Object.freeze(table);
    else wave = 'sine';
  }
  return Object.freeze({
    wave,
    harmonics,
    freq: Math.min(ceiling, raw),
    level,
    detuneCents: num(component.detuneCents),
    sub,
  });
}

// recipe: a frozen role recipe from recipes.getRecipe(id, role).
// opts.role: 'row' | 'bed' | 'audition' | 'note'. opts.baseFreq: pre-detune base pitch (Hz).
// opts.timing: role-specific envelope inputs (see normalizeAmp; for `note`: { attack, decay, sustain, release,
//   peak, duration } — duration null holds until release, and a recipe `amp` replaces the ADSR). opts.sampleRate:
//   ctx.sampleRate. opts.low (`note` only): play the recipe's `low` components (a chord's bass note) if it has them.
export function planVoice(recipe, { role = 'row', baseFreq, timing = {}, sampleRate = 48000, low = false } = {}) {
  const noteRole = role === 'note';
  const ceiling = ceilingHz(sampleRate);
  // The note role plans at the clamped pitch (as chunk-tunes does), so a register rolloff, a key-tracked cutoff and a
  // struck decay all read the pitch actually heard. The Cosmos roles keep the raw base (their frozen behavior).
  const base = noteRole ? Math.min(num(baseFreq), ceiling) : num(baseFreq);
  const components = [];
  const ratios = [];
  const componentSpecs = (noteRole && low && recipe?.low) || recipe?.components || [];
  for (const component of componentSpecs) {
    const planned = planComponent(component, base, sampleRate, noteRole);
    if (planned) { components.push(planned); ratios.push(num(component.ratio, 1) || 1); }
  }
  const noiseTime = v => (noteRole ? Math.max(0.0005, num(v)) : num(v));
  const noise = recipe?.noise
    ? Object.freeze({ level: num(recipe.noise.level), attack: noiseTime(recipe.noise.attack), decay: noiseTime(recipe.noise.decay) })
    : null;
  // A PER-VOICE filter chain (0..n biquads, applied in order before the amp envelope). Warm uses two — a
  // high-pass under the fundamental and a key-tracked low-pass; classic uses none. A filter may declare a slow
  // `drift` (a shared per-context LFO on its cutoff) for the bed's gentle spectral development. Filters are
  // processing nodes, not sources, so they never add to the source cost.
  // A `keyTrack` cutoff follows the played pitch (harmonics × base, clamped) so the harmonic balance holds
  // across the keyboard. An `env` is a birth sweep of the cutoff in cents (start → peak → settle at 0); a
  // `swellCents` lifts the bed's cutoff with each swell. Both ride the filter's detune, so they cost no nodes.
  const filterSpecs = recipe?.filters || (recipe?.filter ? [recipe.filter] : []);
  const keyTracks = [];
  const filters = Object.freeze((filterSpecs || []).map(f => {
    let freq = num(f.freq, 1000);
    const kt = f.keyTrack
      ? Object.freeze({ harmonics: num(f.keyTrack.harmonics, 6), minHz: num(f.keyTrack.minHz, 20), maxHz: num(f.keyTrack.maxHz, Infinity) })
      : null;
    keyTracks.push(kt);
    if (kt && base > 0) freq = Math.min(kt.maxHz, Math.max(kt.minHz, base * kt.harmonics));
    return Object.freeze({
      type: f.type === 'highpass' ? 'highpass' : 'lowpass',
      freq: Math.min(ceiling, freq),
      Q: num(f.Q, 0.7071),
      drift: f.drift ? Object.freeze({ rateHz: Math.max(0, num(f.drift.rateHz, 0.06)), depthCents: num(f.drift.depthCents) }) : null,
      env: f.env ? Object.freeze({
        startCents: num(f.env.startCents), peakCents: num(f.env.peakCents),
        attack: Math.max(0.001, num(f.env.attack, 0.03)), settle: Math.max(0.001, num(f.env.settle, 0.15)),
      }) : null,
      swellCents: num(f.swellCents),
    });
  }));
  // COST is the count of REAL source nodes (oscillators + one noise source). A culled partial does not
  // count. This is what a caller admits against its live-oscillator ceiling before creating any node.
  const cost = components.length + (noise ? 1 : 0);
  const plan = Object.freeze({
    role,
    cost,
    components: Object.freeze(components),
    noise,
    filters,
    outputTrim: num(recipe?.outputTrim, 1),
    amp: noteRole ? planNoteAmp(recipe?.amp, timing, base) : normalizeAmp(role, timing),
    flags: Object.freeze({ role, micro: !!timing.micro }),
  });
  retuneTable.set(plan, Object.freeze({ ceiling, ratios: Object.freeze(ratios), keyTracks: Object.freeze(keyTracks) }));
  return plan;
}
