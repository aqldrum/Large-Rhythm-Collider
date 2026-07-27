// spatial-grid-row-player.js — WebAudio-only playback for compact, worker-built grid programs.
// It never enumerates rhythms or performs Cull2. Each star owns one persistent 3D panner and swaps
// immutable A–D program decks on a short shared tick boundary.
import {
  CULLED_ROW_MAX_VOICES_PER_TONE, ROW_SWITCH_TICKS,
} from './cosmos-grid-audio-core.js';
import { AUDIO_LISTENER_FORWARD, AUDIO_LISTENER_UP } from './spatial-audio-frame.js';

const LAYERS = new Set(['A', 'B', 'C', 'D']);
export const CULLED_ROW_FUNDAMENTAL_HZ = 220;
export const CULLED_ROW_MAX_OCTAVES = 3;
export const CULLED_ROW_MAX_HZ = CULLED_ROW_FUNDAMENTAL_HZ * (2 ** CULLED_ROW_MAX_OCTAVES);
const CROSSFADE = 0.35;
const VOICE_RELEASE = 0.07;
const MAX_ROW_OSC = 64; // 8 stars × A–D, with one transient crossfade deck per star.
const VISUAL_ATTACK_SECONDS = 0.7;

// ══ ROW VOICE TUNABLES ════════════════════════════════════════════════════════════════════════
// This mode is short-notes-into-a-large-reverb, NOT legato: a voice plays a fixed short gate and
// releases into a shared reverb tail regardless of when the next onset lands. The reverb — not a
// sustained oscillator — is what makes tones "hold", which keeps the polyrhythm's onset timing
// crisp instead of smearing overlapping sustains. Everything the ear cares about is tunable here.
const ROW_WAVEFORM = 'triangle';    // decoupled from ambient's RHYTHM_VOICE_WAVEFORM so row timbre tunes alone
// Fixed-gate ADSR (seconds). ROW_GATE is the whole point: note length is decoupled from onset spacing.
const ROW_ATTACK = 0.004;           // fast pluck attack — long enough to avoid a click, short enough to bite
const ROW_DECAY = 0.46;             // attack peak → sustain fall
const ROW_SUSTAIN = 0.05;           // held level across the gate
const ROW_PEAK = 0.16;              // envelope peak for a real scheduled attack
const ROW_GATE = 0.14;              // note length from attack start to release start — DECOUPLED from onsets
const ROW_RELEASE = 0.09;           // exponential release into the reverb tail (no click)
const ROW_SEED_PEAK = 0.10;         // softer peak for a program-swap seed blip
const ROW_SEED_ATTACK = 0.05;       // gentler attack for a seed blip
// Shared reverb send — rows only (the ambient bed owns its own reverb). Pre-delay keeps dry attacks
// crisp; the wet-side highpass stops dense grids piling into low-end mud; damping darkens the tail.
const ROW_REVERB_SECONDS = 10;     // impulse length — the apparent "size" of the space
const ROW_REVERB_DECAY = 3.2;       // impulse decay exponent (higher = faster tail)
const ROW_REVERB_DAMPING = 0.12;    // one-pole lowpass on the impulse noise (lower = darker/smoother)
const ROW_REVERB_WET = 0.56;        // wet send level — the dry/wet balance is this mode's "sustain" control
const ROW_REVERB_PREDELAY = 0.03;   // seconds of pre-delay — separates the dry attack from the wash
const ROW_REVERB_HIGHPASS_HZ = 200; // wet-only low-end roll-off so the tail doesn't accumulate rumble

// Procedural stereo impulse for the row reverb send: exponentially decaying noise, one-pole lowpassed
// per channel so the tail reads darker/smoother than raw white noise. No assets — pure buffer synthesis,
// same separation rule as the ambient bed's makeImpulse.
function makeRowImpulse(ctx, seconds, decay, damping) {
  const rate = ctx.sampleRate, len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += ((Math.random() * 2 - 1) - lp) * damping;
      data[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// Preserve every raw tone's pitch class while constraining only its register. Folding the ratio
// before converting to Hz also avoids overflow for unusually large, but still finite, raw ratios.
export function culledGridRowFrequency(rawRatio) {
  if (!Number.isFinite(rawRatio) || rawRatio <= 0) return null;
  let registeredRatio = rawRatio;
  const maxRatio = 2 ** CULLED_ROW_MAX_OCTAVES;
  while (registeredRatio > maxRatio) registeredRatio /= 2;
  return CULLED_ROW_FUNDAMENTAL_HZ * registeredRatio;
}

const layerRank = layer => Math.max(0, ['A', 'B', 'C', 'D'].indexOf(layer));

// Pure ranking contract used by the live allocator and its headless guard. `current` only resolves
// equal-distance deck crossfades; geometric distance remains the first and dominant criterion.
export function nearestCulledToneVoices(candidates, limit = CULLED_ROW_MAX_VOICES_PER_TONE) {
  return [...(candidates || [])]
    .filter(candidate => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance || Number(b.current) - Number(a.current) ||
      a.starId - b.starId || layerRank(a.layer) - layerRank(b.layer))
    .slice(0, Math.max(0, limit));
}

function setParam(param, value, now, smoothing = 0.04) {
  if (!param) return;
  param.setTargetAtTime(value, now, smoothing);
}

function setTriplet(node, prefix, values, now, smoothing = 0.04) {
  const names = [`${prefix}X`, `${prefix}Y`, `${prefix}Z`];
  if (names.every(name => node[name])) {
    names.forEach((name, index) => setParam(node[name], values[index], now, smoothing));
    return true;
  }
  return false;
}

export class SpatialGridRowPlayer {
  constructor(context, output) {
    this.ctx = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(output);                    // dry path
    this.reverb = this._buildReverbSend(output);    // wet send, tapped post-master (fades with enable)
    this.enabled = false;
    this.stars = new Map();
    this.logicalVoiceCount = 0;
    this.stats = { budgetMisses: 0, toneCapMisses: 0, toneCapEvictions: 0, installs: 0, entries: 0, exits: 0 };
    this.setListenerPose(AUDIO_LISTENER_FORWARD, AUDIO_LISTENER_UP);
  }

  // One shared reverb for every row voice: master -> pre-delay -> highpass -> convolver -> wet -> output.
  // Tapped off master (post the enable crossfade) so the wash fades in/out with the mode. Distance gain
  // and HRTF panning happen per-star upstream of master, so the send already carries spatialized signal.
  _buildReverbSend(output) {
    const preDelay = this.ctx.createDelay(1);
    preDelay.delayTime.value = ROW_REVERB_PREDELAY;
    const highpass = this.ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = ROW_REVERB_HIGHPASS_HZ;
    const convolver = this.ctx.createConvolver();
    convolver.buffer = makeRowImpulse(this.ctx, ROW_REVERB_SECONDS, ROW_REVERB_DECAY, ROW_REVERB_DAMPING);
    const wet = this.ctx.createGain();
    wet.gain.value = ROW_REVERB_WET;
    this.master.connect(preDelay);
    preDelay.connect(highpass);
    highpass.connect(convolver);
    convolver.connect(wet);
    wet.connect(output);
    return { preDelay, highpass, convolver, wet };
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(0, this.master.gain.value), now);
    this.master.gain.linearRampToValueAtTime(this.enabled ? 1 : 0, now + CROSSFADE);
    if (!this.enabled) this.setField([], 0);
  }

  setListenerPose(forward, up) {
    const listener = this.ctx.listener;
    const now = this.ctx.currentTime;
    if (listener.positionX) {
      setTriplet(listener, 'position', [0, 0, 0], now);
      setTriplet(listener, 'forward', forward, now);
      setTriplet(listener, 'up', up, now);
    } else {
      listener.setPosition?.(0, 0, 0);
      listener.setOrientation?.(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
    }
  }

  _makeStar(id) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5000;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 300;
    panner.maxDistance = 4000;
    panner.rolloffFactor = 0; // flight-view owns the explicit, inspectable distance-gain law.
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.master);
    this.stats.entries++;
    return {
      id, filter, panner, gain,
      distance: Infinity,
      currentDeck: null, retiringDecks: [], pending: null,
      active: true, removeAt: Infinity, visualAttacks: [], visualLives: [],
    };
  }

  setField(items, absoluteTick) {
    const now = this.ctx.currentTime;
    const seen = new Set();
    for (const item of items || []) {
      seen.add(item.id);
      let star = this.stars.get(item.id);
      if (!star) { star = this._makeStar(item.id); this.stars.set(item.id, star); }
      star.active = true;
      star.removeAt = Infinity;
      star.distance = Number.isFinite(item.distance) ? item.distance
        : (Array.isArray(item.position) && item.position.length >= 3 ? Math.hypot(...item.position) : Infinity);
      setParam(star.filter.frequency, item.cutoff, now, 0.18);
      if (!setTriplet(star.panner, 'position', item.position, now, 0.035)) star.panner.setPosition?.(...item.position);
      star.gain.gain.cancelScheduledValues(now);
      star.gain.gain.setValueAtTime(Math.max(0.0001, star.gain.gain.value), now);
      star.gain.gain.linearRampToValueAtTime(Math.max(0, item.gain), now + CROSSFADE);
      const installedKey = star.currentDeck?.program.programKey;
      if (item.program && item.program.programKey !== installedKey && item.program.programKey !== star.pending?.program.programKey) {
        const boundaryTick = Math.ceil((absoluteTick + 1e-7) / ROW_SWITCH_TICKS) * ROW_SWITCH_TICKS;
        star.pending = { program: item.program, boundaryTick };
      }
    }
    for (const [id, star] of this.stars) {
      if (seen.has(id) || !star.active) continue;
      star.active = false;
      star.pending = null;
      star.gain.gain.cancelScheduledValues(now);
      star.gain.gain.setValueAtTime(Math.max(0.0001, star.gain.gain.value), now);
      star.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE);
      star.removeAt = now + CROSSFADE + 0.08;
      this.stats.exits++;
    }
  }

  _makeDeck(program) {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.stars.get(program.grid)?.filter || this.master);
    return { program, gain, voices: new Map(), oscillators: new Set(), lastToneByLayer: new Map(), cursorCycle: 0, cursorEvent: 0, startTime: 0, retireAt: Infinity };
  }

  _syncCursor(deck, absoluteTick) {
    const events = deck.program.events;
    const grid = deck.program.grid;
    if (!events.length) { deck.cursorCycle = 0; deck.cursorEvent = 0; return; }
    deck.cursorCycle = Math.floor(absoluteTick / grid);
    const cycleTick = absoluteTick - deck.cursorCycle * grid;
    deck.cursorEvent = events.findIndex(event => event.tick >= cycleTick);
    if (deck.cursorEvent < 0) { deck.cursorEvent = 0; deck.cursorCycle++; }
  }

  _seedDeck(deck, absoluteTick, when) {
    const events = deck.program.events;
    if (!events.length) return;
    const cycleTick = ((absoluteTick % deck.program.grid) + deck.program.grid) % deck.program.grid;
    const latest = new Map();
    // Previous-cycle tail seeds every canonical layer, then current-cycle events before the boundary
    // overwrite it. An event exactly ON the boundary is left to the scheduler as a real attack.
    for (const event of events) for (const action of event.layerActions) latest.set(action.layer, action);
    for (const event of events) {
      if (event.tick >= cycleTick) break;
      for (const action of event.layerActions) latest.set(action.layer, action);
    }
    for (const action of latest.values()) {
      deck.lastToneByLayer.set(action.layer, action.rawFraction);   // seed the hold memory at the boundary
      this._startVoice(deck, action, when, true);
    }
  }

  _activatePending(star, switchTime) {
    const pending = star.pending;
    if (!pending) return;
    const deck = this._makeDeck(pending.program);
    deck.gain.disconnect();
    deck.gain.connect(star.filter);
    deck.startTime = switchTime;
    this._syncCursor(deck, pending.boundaryTick);
    deck.gain.gain.setValueAtTime(0.0001, switchTime);
    deck.gain.gain.linearRampToValueAtTime(1, switchTime + CROSSFADE);
    if (star.currentDeck) {
      const old = star.currentDeck;
      old.gain.gain.cancelScheduledValues(switchTime);
      old.gain.gain.setValueAtTime(Math.max(0.0001, old.gain.gain.value), switchTime);
      old.gain.gain.linearRampToValueAtTime(0.0001, switchTime + CROSSFADE);
      old.retireAt = switchTime + CROSSFADE + 0.05;
      star.retiringDecks.push(old);
    }
    star.currentDeck = deck;
    star.pending = null;
    // Install the new deck as current before seeding so equal-distance crossfade voices yield to it.
    this._seedDeck(deck, pending.boundaryTick, switchTime);
    this.stats.installs++;
  }

  _toneVoiceCandidates(toneKey) {
    const candidates = [];
    for (const star of this.stars.values()) {
      const decks = star.currentDeck ? [star.currentDeck, ...star.retiringDecks] : [...star.retiringDecks];
      for (const deck of decks) {
        for (const voice of deck.voices.values()) {
          if (voice.toneKey !== toneKey) continue;
          candidates.push({
            starId: star.id,
            layer: voice.layer,
            distance: star.distance,
            current: deck === star.currentDeck,
            deck,
            voice,
          });
        }
      }
    }
    return candidates;
  }

  _claimToneVoice(deck, action, when) {
    const star = this.stars.get(deck.program.grid);
    if (!star) return false;
    const toneKey = action.fraction || action.rawFraction || String(action.rawRatio);
    const candidate = {
      starId: star.id,
      layer: action.layer,
      distance: star.distance,
      current: deck === star.currentDeck,
      deck,
      voice: null,
    };
    const incumbents = this._toneVoiceCandidates(toneKey);
    const ranked = nearestCulledToneVoices([...incumbents, candidate]);
    if (!ranked.includes(candidate)) { this.stats.toneCapMisses++; return false; }
    const kept = new Set(ranked);
    for (const incumbent of incumbents) {
      if (kept.has(incumbent)) continue;
      this._releaseLayer(incumbent.deck, incumbent.layer, when, VOICE_RELEASE);
      this.stats.toneCapEvictions++;
    }
    return true;
  }

  tick(now, horizon, transportStart, ticksPerSecond) {
    const canSchedule = this.enabled && ticksPerSecond > 0;
    for (const [id, star] of [...this.stars]) {
      if (!star.active && now >= star.removeAt) { this._destroyStar(star, now); this.stars.delete(id); continue; }
      if (canSchedule && star.pending) {
        const switchTime = transportStart + star.pending.boundaryTick / ticksPerSecond;
        if (switchTime <= horizon) this._activatePending(star, Math.max(now, switchTime));
      }
      if (canSchedule && star.active && star.currentDeck) this._scheduleDeck(star.currentDeck, now, horizon, transportStart, ticksPerSecond);
      const keep = [];
      for (const deck of star.retiringDecks) {
        if (now >= deck.retireAt) this._destroyDeck(deck, now);
        else keep.push(deck);
      }
      star.retiringDecks = keep;
    }
  }

  _scheduleDeck(deck, now, horizon, transportStart, ticksPerSecond) {
    const { events, grid } = deck.program;
    if (!events.length) return;
    while (true) {
      const event = events[deck.cursorEvent];
      const eventTick = deck.cursorCycle * grid + event.tick;
      const when = transportStart + eventTick / ticksPerSecond;
      if (when > horizon) break;
      if (when >= Math.max(deck.startTime, now - 0.03)) {
        for (const action of event.layerActions) {
          if (!LAYERS.has(action.layer)) continue;
          // Silent hold, re-derived per loop: suppress a re-strike only when this layer's IMMEDIATELY
          // preceding tone THIS CYCLE is identical. The memory clears at each loop wrap (below), so a
          // tone that persists across the wrap — or spans the whole loop — still re-articulates once per
          // cycle instead of falling permanently silent. (We can't trust the compiler's 'repeat-hold'
          // label directly: it seeds the comparison across the wrap for legato sustain, which under short
          // notes marks a loop-constant layer as all-hold and it never sounds again after its seed blip.)
          if (deck.program.repeatCull && deck.lastToneByLayer.get(action.layer) === action.rawFraction) continue;
          deck.lastToneByLayer.set(action.layer, action.rawFraction);
          this._startVoice(deck, action, Math.max(now, when), false);
        }
      }
      deck.cursorEvent++;
      if (deck.cursorEvent >= events.length) { deck.cursorEvent = 0; deck.cursorCycle++; deck.lastToneByLayer.clear(); }
    }
  }

  _startVoice(deck, action, when, seeded) {
    const frequencyHz = culledGridRowFrequency(action.rawRatio);
    if (frequencyHz === null) return;
    this._releaseLayer(deck, action.layer, when, VOICE_RELEASE);
    if (!this._claimToneVoice(deck, action, when)) return;
    if (this.logicalVoiceCount >= MAX_ROW_OSC) { this.stats.budgetMisses++; return; }
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = ROW_WAVEFORM;
    osc.frequency.setValueAtTime(Math.min(this.ctx.sampleRate * 0.45, frequencyHz), when);
    // Fixed-gate ADSR: the note lasts ROW_GATE regardless of the next onset, then releases into the
    // reverb tail. holdUntil is clamped so a very short tuned ROW_GATE can't invert the automation.
    const peak = seeded ? ROW_SEED_PEAK : ROW_PEAK;
    const attack = seeded ? ROW_SEED_ATTACK : ROW_ATTACK;
    const sustain = Math.max(0.0001, ROW_SUSTAIN);
    const holdUntil = when + Math.max(ROW_GATE, attack + ROW_DECAY);
    const endAt = holdUntil + ROW_RELEASE;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(peak, when + attack);
    env.gain.exponentialRampToValueAtTime(sustain, when + attack + ROW_DECAY);
    env.gain.setValueAtTime(sustain, holdUntil);
    env.gain.exponentialRampToValueAtTime(0.0001, endAt);
    osc.connect(env);
    env.connect(deck.gain);
    const voice = {
      osc, env, layer: action.layer, fraction: action.fraction,
      rawFraction: action.rawFraction, ratio: action.rawRatio, frequencyHz,
      toneKey: action.fraction || action.rawFraction || String(action.rawRatio), startTime: when,
      released: false,   // budget is freed exactly once — by whichever of onended / _releaseLayer runs first
    };
    deck.voices.set(action.layer, voice);
    deck.oscillators.add(osc);
    const star = this.stars.get(deck.program.grid);
    if (star) {
      // Bounded life now (was Infinity for held legato voices): short notes make the aura pulse per
      // attack rather than glow for a sustained voice. A same-layer steal shortens this in _releaseLayer.
      voice.visualLife = { startTime: when, endTime: endAt };
      star.visualLives.push(voice.visualLife);
      star.visualAttacks.push({ when, strength: seeded ? 0.45 : 1 });
    }
    this.logicalVoiceCount++;
    osc.start(when);
    osc.stop(endAt + 0.02);   // self-terminating; a same-layer steal reschedules this earlier in _releaseLayer
    osc.onended = () => {
      deck.oscillators.delete(osc);
      if (deck.voices.get(action.layer)?.osc === osc) deck.voices.delete(action.layer);
      // A voice that plays out its full gate ends HERE, not via _releaseLayer — so free its budget slot
      // here too, or the count leaks up to MAX_ROW_OSC and every later attack is silently dropped.
      if (!voice.released) { voice.released = true; this.logicalVoiceCount = Math.max(0, this.logicalVoiceCount - 1); }
      try { osc.disconnect(); } catch {} try { env.disconnect(); } catch {}
    };
  }

  _releaseLayer(deck, layer, when, release) {
    const voice = deck.voices.get(layer);
    if (!voice) return;
    deck.voices.delete(layer);
    // Guarded so a later natural onended on the same osc can't double-free (and vice-versa).
    if (!voice.released) { voice.released = true; this.logicalVoiceCount = Math.max(0, this.logicalVoiceCount - 1); }
    if (voice.visualLife) voice.visualLife.endTime = Math.min(voice.visualLife.endTime, when + release);
    try {
      voice.env.gain.cancelScheduledValues(when);
      voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value), when);
      voice.env.gain.exponentialRampToValueAtTime(0.0001, when + release);
      voice.osc.stop(when + release + 0.02);
    } catch {}
  }

  _destroyDeck(deck, now) {
    for (const layer of [...deck.voices.keys()]) this._releaseLayer(deck, layer, now, 0.035);
    for (const osc of [...deck.oscillators]) { try { osc.stop(now + 0.04); } catch {} }
    try { deck.gain.disconnect(); } catch {}
  }

  _destroyStar(star, now) {
    if (star.currentDeck) this._destroyDeck(star.currentDeck, now);
    for (const deck of star.retiringDecks) this._destroyDeck(deck, now);
    try { star.filter.disconnect(); } catch {} try { star.panner.disconnect(); } catch {} try { star.gain.disconnect(); } catch {}
  }

  clear() {
    const now = this.ctx.currentTime;
    for (const star of this.stars.values()) this._destroyStar(star, now);
    this.stars.clear();
    this.logicalVoiceCount = 0;
  }

  debugState() {
    return {
      enabled: this.enabled,
      activeStars: [...this.stars.values()].filter(star => star.active).length,
      voices: this.logicalVoiceCount,
      budget: MAX_ROW_OSC,
      ...this.stats,
      stars: [...this.stars.values()].filter(star => star.active).map(star => {
        const program = star.currentDeck?.program || star.pending?.program;
        return {
          id: star.id,
          programKey: star.currentDeck?.program.programKey || null,
          pendingKey: star.pending?.program.programKey || null,
          selectedRatios: program?.summary.selectedRatios || 0,
          selectedTones: program?.selectedTones || [],
          events: program?.events.length || 0,
          distance: star.distance,
          voices: star.currentDeck?.voices.size || 0,
          voiced: [...(star.currentDeck?.voices.values() || [])].map(voice => ({
            layer: voice.layer,
            fraction: voice.fraction,
            rawFraction: voice.rawFraction,
            frequencyHz: voice.frequencyHz,
          })),
          position: star.panner.positionX ? [star.panner.positionX.value, star.panner.positionY.value, star.panner.positionZ.value] : null,
          gain: star.gain.gain.value,
        };
      }),
    };
  }

  // Lightweight animation-frame projection. This exposes only already-scheduled WebAudio state;
  // it does not enumerate programs or feed anything back into playback. A sustained aura means at
  // least one canonical A–D voice is live, while `pulse` peaks on a real scheduled tone attack.
  visualState() {
    if (!this.enabled) return [];
    const now = this.ctx.currentTime;
    const out = [];
    for (const star of this.stars.values()) {
      star.visualAttacks = star.visualAttacks.filter(attack => attack.when >= now - VISUAL_ATTACK_SECONDS);
      star.visualLives = star.visualLives.filter(life => life.endTime > now);
      const voices = star.visualLives.reduce((count, life) => count + (life.startTime <= now ? 1 : 0), 0);
      if (!voices) continue;
      let pulse = 0;
      for (const attack of star.visualAttacks) {
        const age = now - attack.when;
        if (age < 0 || age > VISUAL_ATTACK_SECONDS) continue;
        pulse = Math.max(pulse, attack.strength * Math.pow(1 - age / VISUAL_ATTACK_SECONDS, 2));
      }
      out.push({ id: star.id, voices, pulse });
    }
    return out;
  }

  destroy() {
    this.clear();
    try { this.master.disconnect(); } catch {}
    if (this.reverb) for (const node of Object.values(this.reverb)) { try { node.disconnect(); } catch {} }
  }
}
