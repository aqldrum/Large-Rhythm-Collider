// Cosmos/audio/instruments/instrument-voice.js — the Web Audio renderer for one instrument voice.
//
// createInstrumentVoice() builds the node graph for a planVoice() plan and returns an opaque HANDLE.
// It is the only place in the instrument subsystem that touches Web Audio. It owns every node it
// creates — oscillators, the amp-envelope gain, per-component gains, an optional per-voice filter, an
// optional noise source, and each oscillator's connection to the shared detune bus. It does NOT choose
// notes, spell MIDI, place stars, or touch reverb/panners — those belong to the callers, which keep
// their own MIDI/visual/exposure side-channels. A consumer holds only the handle; it must never reach
// for an `osc` field or assume one oscillator equals one musical voice.
//
// Graph per voice:   component oscs ─┐   ('custom' oscs play a cached PeriodicWave harmonic table)
//                    (noise) ────────┼─▶ [per-voice filter?] ─▶ ampEnv ─▶ [output trim?] ─▶ destination
//                    detuneBus ─▶ osc.detune (pitched components only; sums with any static detune)
//
// The amp envelope is role-specific and reproduces today's three engines exactly for the `classic`
// recipe (row = gap-aware pluck, bed = silent-born swell, audition = held linear ADSR), so the seam can
// be verified at parity before richer recipes are heard.

import { ENV_FLOOR } from './voice-plan.js';

// ── shared immutable buffers, cached per AudioContext (never per onset; matches makeImpulse's lifetime) ──
const noiseBufferCache = new WeakMap();   // ctx -> mono white-noise AudioBuffer (a color ingredient, not a voice)
function noiseBuffer(ctx) {
  let buf = noiseBufferCache.get(ctx);
  if (buf) return buf;
  const len = Math.max(1, Math.floor(ctx.sampleRate * 1.0));   // 1s is ample; only the first tens of ms are ever gated open
  buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBufferCache.set(ctx, buf);
  return buf;
}

// A harmonic-table waveform (Warm's 'custom' wave), cached per AudioContext and per table so every voice
// playing that table shares one PeriodicWave. Sine terms only (imag); the browser normalizes it to peak 1.
const periodicCache = new WeakMap();   // ctx -> Map<tableKey, PeriodicWave>
function periodicWave(ctx, harmonics) {
  let byTable = periodicCache.get(ctx);
  if (!byTable) periodicCache.set(ctx, byTable = new Map());
  const key = harmonics.join(',');
  let wave = byTable.get(key);
  if (!wave) {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((h, i) => { imag[i + 1] = h; });
    wave = ctx.createPeriodicWave(real, imag);
    byTable.set(key, wave);
  }
  return wave;
}

// A filter's birth cutoff sweep, in cents on its detune: start → peak over `attack` → 0 (the resting cutoff)
// over `settle`. Linear in cents is exponential in Hz, which is how a brass attack brightens.
function applyFilterEnv(param, env, when) {
  param.setValueAtTime(env.startCents, when);
  param.linearRampToValueAtTime(env.peakCents, when + env.attack);
  param.linearRampToValueAtTime(0, when + env.attack + env.settle);
}

// A slow filter-cutoff LFO for the bed's gentle spectral drift, cached per AudioContext and per rate. ONE
// free-running oscillator serves every voice at that rate (a shared modulation source, never per onset);
// each voice owns only a small depth gain into its own filter. Cleared implicitly when the context closes.
const lfoCache = new WeakMap();   // ctx -> Map<rateHz, OscillatorNode>
function sharedDriftLFO(ctx, rateHz) {
  let byRate = lfoCache.get(ctx);
  if (!byRate) lfoCache.set(ctx, byRate = new Map());
  let lfo = byRate.get(rateHz);
  if (!lfo) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = rateHz;
    lfo.start();
    byRate.set(rateHz, lfo);
  }
  return lfo;
}

// ── pure envelope math (ported from the row player so the handle owns its own release) ──────────────
function exponentialValue(from, to, progress) {
  if (progress <= 0) return from;
  if (progress >= 1) return to;
  return from * ((to / from) ** progress);
}

// The instantaneous value of the row pluck envelope at `when` — the seed for a release on engines
// without cancelAndHoldAtTime (AudioParam.value is the current render quantum, not a future interruption).
function rowEnvelopeValueAt(amp, startTime, when) {
  if (!amp || when <= startTime) return ENV_FLOOR;
  const elapsed = when - startTime;
  if (elapsed < amp.attack) return ENV_FLOOR + (amp.peak - ENV_FLOOR) * (elapsed / amp.attack);
  if (amp.micro) return exponentialValue(amp.peak, ENV_FLOOR, (elapsed - amp.attack) / amp.release);
  if (elapsed < amp.attack + amp.decay) return exponentialValue(amp.peak, amp.sustain, (elapsed - amp.attack) / amp.decay);
  const releaseStart = amp.attack + amp.decay + amp.hold;
  if (elapsed < releaseStart) return amp.sustain;
  return exponentialValue(amp.sustain, ENV_FLOOR, (elapsed - releaseStart) / amp.release);
}

function holdRowEnvelope(param, when, amp, startTime) {
  if (typeof param.cancelAndHoldAtTime === 'function') { param.cancelAndHoldAtTime(when); return; }
  const value = Math.max(ENV_FLOOR, rowEnvelopeValueAt(amp, startTime, when));
  param.cancelScheduledValues(when);
  param.setValueAtTime(value, when);
}

// ── role-specific attack envelopes (scheduled once at birth) ────────────────────────────────────────
// row: the fixed pluck / micro window (reproduces spatial-grid-row-player _startVoice env scheduling).
function applyRowAttack(param, amp, when) {
  const attackEnd = when + amp.attack;
  const releaseStart = attackEnd + amp.decay + amp.hold;
  const endAt = when + amp.duration;
  param.setValueAtTime(ENV_FLOOR, when);
  param.linearRampToValueAtTime(amp.peak, attackEnd);
  if (amp.micro) {
    param.exponentialRampToValueAtTime(ENV_FLOOR, endAt);
  } else {
    param.exponentialRampToValueAtTime(amp.sustain, attackEnd + amp.decay);
    param.setValueAtTime(amp.sustain, releaseStart);
    param.exponentialRampToValueAtTime(ENV_FLOOR, endAt);
  }
}

// audition: held linear ADSR (reproduces startLeadLegatoVoice env scheduling).
function applyAuditionAttack(param, amp, when) {
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(amp.peak, when + amp.attack);
  param.linearRampToValueAtTime(amp.sustain, when + amp.attack + amp.decay);
  param.setValueAtTime(amp.sustain, when + amp.attack + amp.decay + 0.01);
}

// a component's OWN short envelope (e.g. a glass bell that decays under the body). Static-level components
// (no sub) skip this entirely and route straight through.
function applySubEnvelope(param, sub, level, when) {
  const peak = Math.max(ENV_FLOOR, level);
  const tail = Math.max(ENV_FLOOR, level * Math.max(0, sub.sustain));
  param.setValueAtTime(ENV_FLOOR, when);
  param.linearRampToValueAtTime(peak, when + Math.max(0.0005, sub.attack));
  param.exponentialRampToValueAtTime(tail, when + Math.max(0.0006, sub.attack + sub.decay));
}

// createInstrumentVoice({ ctx, destination, plan, when, detuneBus }) -> handle
//   ctx         — the AudioContext.
//   destination — the node this voice connects INTO (row: deck.gain, bed: star filter, audition: leadFilter).
//   plan        — a frozen planVoice() result (role, components, noise, filter, amp, outputTrim, cost, flags).
//   when        — absolute AudioContext start time.
//   detuneBus   — the shared cents bus; connected to each pitched osc's `detune` (applied to audio ONCE,
//                 here, never folded into the birth frequency).
export function createInstrumentVoice({ ctx, destination, plan, when, detuneBus = null } = {}) {
  const role = plan.role;
  const amp = plan.amp;
  const startTime = when;
  const endAt = role === 'row' ? when + amp.duration : Infinity;
  const sampleSeconds = 1 / ctx.sampleRate;

  const ampEnv = ctx.createGain();
  const graphNodes = [ampEnv];   // non-source nodes to disconnect once the voice is fully done

  // ampEnv -> [output trim] -> destination
  let tail = ampEnv;
  if (plan.outputTrim !== 1) {
    const trim = ctx.createGain();
    trim.gain.value = plan.outputTrim;
    ampEnv.connect(trim);
    graphNodes.push(trim);
    tail = trim;
  }
  tail.connect(destination);

  // components/noise feed into `head` — the first of a per-voice filter CHAIN if the recipe has one, else
  // the amp env directly. filters[0] sits closest to the sources; filters[n-1] feeds the amp env.
  const driftPairs = [];   // [lfo, depthGain] to detach on completion (the lfo is shared per context)
  const envFilters = [];   // [biquad, spec] carrying a birth sweep or swell brightness (both on detune)
  let head = ampEnv;
  if (plan.filters.length) {
    const chain = plan.filters.map(spec => {
      const bq = ctx.createBiquadFilter();
      bq.type = spec.type;
      bq.frequency.setValueAtTime(spec.freq, when);
      bq.Q.value = spec.Q;
      graphNodes.push(bq);
      if (spec.drift && spec.drift.depthCents) {
        const lfo = sharedDriftLFO(ctx, spec.drift.rateHz);
        const depth = ctx.createGain();
        depth.gain.value = spec.drift.depthCents;   // cents of cutoff wobble
        lfo.connect(depth);
        depth.connect(bq.detune);
        graphNodes.push(depth);
        driftPairs.push([lfo, depth]);
      }
      if (spec.env) applyFilterEnv(bq.detune, spec.env, when);
      if (spec.env || spec.swellCents) envFilters.push([bq, spec]);
      return bq;
    });
    for (let i = 0; i < chain.length; i++) chain[i].connect(chain[i + 1] || ampEnv);
    head = chain[0];
  }

  const sources = [];
  for (const component of plan.components) {
    const osc = ctx.createOscillator();
    if (component.wave === 'custom' && component.harmonics) osc.setPeriodicWave(periodicWave(ctx, component.harmonics));
    else osc.type = component.wave;
    osc.frequency.setValueAtTime(component.freq, when);
    if (component.detuneCents) osc.detune.setValueAtTime(component.detuneCents, when);   // static spread; the bus sums on top
    if (detuneBus) { detuneBus.connect(osc.detune); osc._instrDetuneBus = detuneBus; }
    if (component.level !== 1 || component.sub) {
      const gain = ctx.createGain();
      if (component.sub) applySubEnvelope(gain.gain, component.sub, component.level, when);
      else gain.gain.value = component.level;
      osc.connect(gain);
      gain.connect(head);
      graphNodes.push(gain);
    } else {
      osc.connect(head);
    }
    sources.push(osc);
  }

  if (plan.noise) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const gain = ctx.createGain();
    applySubEnvelope(gain.gain, { attack: plan.noise.attack, decay: plan.noise.decay, sustain: 0 }, plan.noise.level, when);
    src.connect(gain);
    gain.connect(head);
    graphNodes.push(gain);
    sources.push(src);
  }

  // role attack (bed is silent-born — the caller drives it via swell()).
  if (role === 'row') applyRowAttack(ampEnv.gain, amp, when);
  else if (role === 'audition') applyAuditionAttack(ampEnv.gain, amp, when);
  else ampEnv.gain.value = ENV_FLOOR;   // bed

  // start every source; the row's fixed gate also schedules the stop here.
  for (const src of sources) {
    src.start(when);
    if (role === 'row') { try { src.stop(endAt + (amp.micro ? sampleSeconds : 0.02)); } catch {} }
  }

  // ── lifecycle bookkeeping ──
  let released = false;
  let completed = false;
  let endedCount = 0;
  let completeCb = null;

  const finishIfDone = () => {
    if (endedCount < sources.length || completed) return;
    completed = true;
    for (const node of graphNodes) { try { node.disconnect(); } catch {} }
    // Detach this voice's depth gains from the SHARED drift LFO specifically (the LFO itself outlives the
    // voice), so a released bed voice leaves nothing hanging off the context-wide modulation source.
    for (const [lfo, depth] of driftPairs) { try { lfo.disconnect(depth); } catch {} }
    if (completeCb) { try { completeCb(); } catch {} }
  };
  for (const src of sources) {
    src.onended = () => {
      if (src._instrDetuneBus) { try { src._instrDetuneBus.disconnect(src.detune); } catch {} }
      try { src.disconnect(); } catch {}
      endedCount++;
      finishIfDone();
    };
  }

  const stopAll = at => { for (const src of sources) { try { src.stop(at); } catch {} } };

  function releaseRow(at, release) {
    const param = ampEnv.gain;
    holdRowEnvelope(param, at, amp, startTime);
    const releaseTime = amp.micro && at >= endAt - sampleSeconds
      ? sampleSeconds
      : Math.max(2 / ctx.sampleRate, release);
    param.exponentialRampToValueAtTime(ENV_FLOOR, at + releaseTime);
    stopAll(at + releaseTime + (amp.micro ? sampleSeconds : 0.002));
  }

  function releaseBed(at, release) {
    const param = ampEnv.gain;
    param.cancelScheduledValues(at);
    param.setValueAtTime(Math.max(0.0001, param.value), at);
    param.linearRampToValueAtTime(0.0001, at + release);
    stopAll(at + release + 0.05);
  }

  function releaseAudition(at, release) {
    const param = ampEnv.gain;
    const stopAt = at + Math.max(0.01, release);
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(at);
    } else {
      param.cancelScheduledValues(at);
      param.setValueAtTime(Math.max(0.0001, param.value || amp.sustain), at);
    }
    param.linearRampToValueAtTime(0, stopAt);
    stopAll(stopAt + 0.01);
  }

  return {
    cost: plan.cost,
    role,

    // Graceful release from `at`. Idempotent (a later natural end, or a second release, is a no-op).
    // `release` is the release time in seconds the caller wants (role conventions preserved: the row
    // player passes VOICE_RELEASE, the bed BED_RELEASE/0.05, audition LEAD_RELEASE/0.05).
    release(at, release = 0.05) {
      if (released) return;
      released = true;
      try {
        if (role === 'bed') releaseBed(at, release);
        else if (role === 'audition') releaseAudition(at, release);
        else releaseRow(at, release);
      } catch {
        // last-ditch: never leave a scheduled voice able to sound later.
        try { stopAll(at); } catch {}
      }
    },

    // Hard stop / disposal at `at` — silences even a scheduled-but-unsounded future voice. Safe to call
    // repeatedly and in addition to release() (used by deck/star/context teardown).
    stop(at) { stopAll(at); },

    // Called once when the LAST source truly ends (the natural free point for the caller's budget/index).
    onComplete(cb) { completeCb = cb; if (completed) cb(); },

    // Read-only introspection for dev overlays only (never the product path): the amp envelope's current
    // value. Keeps node references private while letting the sky-debug panel show a voice's live gain.
    currentGain() { return ampEnv.gain.value; },

    // BED only: re-attack the amp envelope from its current value to `peak` — a swell, never a rebuild.
    // No-op for roles without a swell shape. (Composes with nothing else: the bed recipe has no timbral
    // sub-envelope, so a swell can never re-trigger a keys transient.)
    swell(peak, at) {
      if (role !== 'bed') return;
      const param = ampEnv.gain;
      const cur = Math.max(0.0001, param.value);
      param.cancelScheduledValues(at);
      param.setValueAtTime(cur, at);
      param.linearRampToValueAtTime(Math.max(0.0002, peak), at + amp.attack);
      param.exponentialRampToValueAtTime(Math.max(0.0001, peak * amp.sustainFrac), at + amp.attack + amp.release);
      // Louder = brighter: the cutoff rides the same rise-and-ease as the amp (never an attack transient).
      for (const [bq, spec] of envFilters) {
        if (!spec.swellCents) continue;
        const detune = bq.detune;
        const curCents = detune.value;
        detune.cancelScheduledValues(at);
        detune.setValueAtTime(curCents, at);
        detune.linearRampToValueAtTime(spec.swellCents, at + amp.attack);
        detune.linearRampToValueAtTime(spec.swellCents * amp.sustainFrac, at + amp.attack + amp.release);
      }
    },

    // Crossfade fade-IN for a no-onset instrument hot-swap. Cancels whatever attack this voice scheduled at
    // birth and ramps from silence up to `level` over `seconds`. Role-agnostic (the audition role's attack
    // overshoots to a peak before its sustain; this replaces it with a plain rise, so the swap never
    // re-articulates). The caller pairs it with the OLD voice's release() — the two graphs cross while the
    // logical MIDI note stays held, so no note-on/off reaches a DAW.
    crossIn(level, at, seconds) {
      const param = ampEnv.gain;
      param.cancelScheduledValues(at);
      param.setValueAtTime(ENV_FLOOR, at);
      param.linearRampToValueAtTime(Math.max(0.0002, level), at + Math.max(0.005, seconds));
      // Nor re-articulate the timbre: drop any birth filter sweep and sit at the settled cutoff (for a bed,
      // the post-swell brightness).
      for (const [bq, spec] of envFilters) {
        bq.detune.cancelScheduledValues(at);
        bq.detune.setValueAtTime(spec.swellCents ? spec.swellCents * (amp.sustainFrac || 0) : 0, at);
      }
    },
  };
}
