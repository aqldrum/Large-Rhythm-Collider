// cosmos/instruments/voice-plan.js — the pure recipe→plan compiler.
//
// planVoice() turns a frozen role recipe (instrument-presets.js) plus a role/pitch/timing into a bounded,
// finite SYNTHESIS PLAN that instrument-voice.js realizes as Web Audio nodes. It creates NO nodes, reads
// NO clocks, and solves NO harmony — it is the seam between "what a palette is" and "how it sounds".
//
// It is where the two safety rules the work order names get enforced, purely and testably:
//   • out-of-band partials are DROPPED (an upper component whose pitch reaches the anti-alias ceiling adds
//     only alias risk), which also means they are not charged to the source budget; and
//   • the source COST is the count of real source nodes the plan will create (oscillators + noise), so a
//     caller can admit against its oscillator ceiling BEFORE building a graph.

// Shared with instrument-voice.js: the non-zero floor an exponential ramp can target (0 is illegal for
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

function planComponent(component, baseFreq, sampleRate) {
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
  const sub = component.sub
    ? Object.freeze({ attack: num(component.sub.attack), decay: num(component.sub.decay), sustain: num(component.sub.sustain) })
    : null;
  // 'custom' needs a usable harmonic table (finite, non-negative, not all zero); otherwise it degrades to a
  // sine so a malformed recipe still sounds rather than throwing on the audio path.
  let wave = component.wave || 'sine';
  let harmonics = null;
  if (wave === 'custom') {
    const table = Array.isArray(component.harmonics) ? component.harmonics.map(h => Math.max(0, num(h))) : [];
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

// recipe: a frozen role recipe from instrument-presets.getRecipe(id, role).
// opts.role: 'row' | 'bed' | 'audition'. opts.baseFreq: pre-detune base pitch (Hz).
// opts.timing: role-specific envelope inputs (see normalizeAmp). opts.sampleRate: ctx.sampleRate.
export function planVoice(recipe, { role = 'row', baseFreq, timing = {}, sampleRate = 48000 } = {}) {
  const base = num(baseFreq);
  const components = [];
  for (const component of recipe?.components || []) {
    const planned = planComponent(component, base, sampleRate);
    if (planned) components.push(planned);
  }
  const noise = recipe?.noise
    ? Object.freeze({ level: num(recipe.noise.level), attack: num(recipe.noise.attack), decay: num(recipe.noise.decay) })
    : null;
  // A PER-VOICE filter chain (0..n biquads, applied in order before the amp envelope). Warm uses two — a
  // high-pass under the fundamental and a key-tracked low-pass; classic uses none. A filter may declare a slow
  // `drift` (a shared per-context LFO on its cutoff) for the bed's gentle spectral development. Filters are
  // processing nodes, not sources, so they never add to the source cost.
  // A `keyTrack` cutoff follows the played pitch (harmonics × base, clamped) so the harmonic balance holds
  // across the keyboard. An `env` is a birth sweep of the cutoff in cents (start → peak → settle at 0); a
  // `swellCents` lifts the bed's cutoff with each swell. Both ride the filter's detune, so they cost no nodes.
  const filterSpecs = recipe?.filters || (recipe?.filter ? [recipe.filter] : []);
  const filters = Object.freeze((filterSpecs || []).map(f => {
    let freq = num(f.freq, 1000);
    if (f.keyTrack && base > 0) {
      const kt = f.keyTrack;
      freq = Math.min(num(kt.maxHz, Infinity), Math.max(num(kt.minHz, 20), base * num(kt.harmonics, 6)));
    }
    return Object.freeze({
      type: f.type === 'highpass' ? 'highpass' : 'lowpass',
      freq: Math.min(ceilingHz(sampleRate), freq),
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
  return Object.freeze({
    role,
    cost,
    components: Object.freeze(components),
    noise,
    filters,
    outputTrim: num(recipe?.outputTrim, 1),
    amp: normalizeAmp(role, timing),
    flags: Object.freeze({ role, micro: !!timing.micro }),
  });
}
