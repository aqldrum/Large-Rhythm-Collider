// spatial-grid-row-player.js — WebAudio-only playback for compact, worker-built grid programs.
// It never enumerates rhythms or performs Cull2. Each star owns one persistent 3D panner and swaps
// immutable A–D program decks on a short shared tick boundary.
import { ROW_SWITCH_TICKS } from './cosmos-grid-audio-core.js';

const LAYERS = new Set(['A', 'B', 'C', 'D']);
const ROOT_HZ = 110;
const CROSSFADE = 0.35;
const VOICE_RELEASE = 0.07;
const MAX_ROW_OSC = 64; // 8 stars × A–D, with one transient crossfade deck per star.

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
    this.master.connect(output);
    this.enabled = false;
    this.stars = new Map();
    this.logicalVoiceCount = 0;
    this.stats = { budgetMisses: 0, installs: 0, entries: 0, exits: 0 };
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
    return { id, filter, panner, gain, currentDeck: null, retiringDecks: [], pending: null, active: true, removeAt: Infinity };
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
    return { program, gain, voices: new Map(), oscillators: new Set(), cursorCycle: 0, cursorEvent: 0, startTime: 0, retireAt: Infinity };
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
    for (const action of latest.values()) this._startLegato(deck, action, when, true);
  }

  _activatePending(star, switchTime) {
    const pending = star.pending;
    if (!pending) return;
    const deck = this._makeDeck(pending.program);
    deck.gain.disconnect();
    deck.gain.connect(star.filter);
    deck.startTime = switchTime;
    this._syncCursor(deck, pending.boundaryTick);
    this._seedDeck(deck, pending.boundaryTick, switchTime);
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
    this.stats.installs++;
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
          const voice = deck.voices.get(action.layer);
          const sameTone = voice?.rawFraction === action.rawFraction;
          if (!deck.program.repeatCull || !sameTone) this._startLegato(deck, action, Math.max(now, when), false);
        }
      }
      deck.cursorEvent++;
      if (deck.cursorEvent >= events.length) { deck.cursorEvent = 0; deck.cursorCycle++; }
    }
  }

  _startLegato(deck, action, when, seeded) {
    if (!Number.isFinite(action.rawRatio) || action.rawRatio <= 0) return;
    this._releaseLayer(deck, action.layer, when, VOICE_RELEASE);
    if (this.logicalVoiceCount >= MAX_ROW_OSC) { this.stats.budgetMisses++; return; }
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(Math.min(this.ctx.sampleRate * 0.45, ROOT_HZ * action.rawRatio), when);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(seeded ? 0.10 : 0.16, when + (seeded ? 0.06 : 0.018));
    env.gain.exponentialRampToValueAtTime(0.075, when + 0.14);
    osc.connect(env);
    env.connect(deck.gain);
    const voice = { osc, env, layer: action.layer, fraction: action.fraction, rawFraction: action.rawFraction, ratio: action.rawRatio };
    deck.voices.set(action.layer, voice);
    deck.oscillators.add(osc);
    this.logicalVoiceCount++;
    osc.start(when);
    osc.onended = () => {
      deck.oscillators.delete(osc);
      if (deck.voices.get(action.layer)?.osc === osc) deck.voices.delete(action.layer);
      try { osc.disconnect(); } catch {} try { env.disconnect(); } catch {}
    };
  }

  _releaseLayer(deck, layer, when, release) {
    const voice = deck.voices.get(layer);
    if (!voice) return;
    deck.voices.delete(layer);
    this.logicalVoiceCount = Math.max(0, this.logicalVoiceCount - 1);
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
          voices: star.currentDeck?.voices.size || 0,
          voiced: [...(star.currentDeck?.voices.values() || [])].map(voice => ({ layer: voice.layer, fraction: voice.fraction, rawFraction: voice.rawFraction })),
          position: star.panner.positionX ? [star.panner.positionX.value, star.panner.positionY.value, star.panner.positionZ.value] : null,
          gain: star.gain.gain.value,
        };
      }),
    };
  }

  destroy() {
    this.clear();
    try { this.master.disconnect(); } catch {}
  }
}
