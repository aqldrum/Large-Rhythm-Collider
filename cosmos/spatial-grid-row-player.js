// spatial-grid-row-player.js — WebAudio-only playback for compact, worker-built grid programs.
// It never enumerates rhythms or performs Cull2. Each star owns one persistent 3D panner and swaps
// immutable A–D program decks on a short shared tick boundary.
import {
  CULLED_ROW_MAX_VOICES_PER_TONE, ROW_ACTIVE_STARS, ROW_SWITCH_TICKS,
} from './cosmos-grid-audio-core.js';
import { AUDIO_LISTENER_FORWARD, AUDIO_LISTENER_UP } from './spatial-audio-frame.js';
import { classifyLateEvent, LATE_CLAMP_TOLERANCE_SECONDS } from './transport-clock.js';
// The instrument seam: a row voice's oscillator graph is now built by the shared renderer from a pure
// per-role recipe, not inlined here. This module stays harmony-blind AND timbre-blind — it owns note
// choice, timing, stealing, budget and the star bus; the renderer owns the nodes. The selected recipe
// arrives through the injected `getRecipe` accessor (see the constructor), so no palette definition or
// audio composition root is imported.
import { getRecipe as presetRecipe, DEFAULT_INSTRUMENT } from './instruments/instrument-presets.js';
import { planVoice } from './instruments/voice-plan.js';
import { createInstrumentVoice } from './instruments/instrument-voice.js';

const LAYERS = new Set(['A', 'B', 'C', 'D']);
export const CULLED_ROW_FUNDAMENTAL_HZ = 220;
export const CULLED_ROW_MAX_OCTAVES = 3;
export const CULLED_ROW_MAX_HZ = CULLED_ROW_FUNDAMENTAL_HZ * (2 ** CULLED_ROW_MAX_OCTAVES);
const CROSSFADE = 0.35;
const VOICE_RELEASE = 0.07;
// How late an event may be and still be sounded, and what happens past that — now one exported POLICY
// (transport-clock.js's classifyLateEvent) rather than a bare `Math.max(now, when)` in the scheduler. The
// old 30ms clamp turned a starved pulse into a FLAM: a spread of onsets all attacking at the same instant,
// which is what made MIDI "drag" while the camera moved. A rhythm IS its spacing, so past the threshold
// where two attacks stop being separately articulated (ROW_MICRO_GAP_SECONDS, 12ms) the honest outcome is
// silence — counted as a drop, never displaced into the wrong place. Both outcomes feed the telemetry.
export const LATE_EVENT_TOLERANCE_SECONDS = LATE_CLAMP_TOLERANCE_SECONDS;
// DERIVED, not a literal: the active-star count is tuned by ear, and a hardcoded ceiling silently
// starves it the moment the field widens — attacks just stop being scheduled and turn up only as
// stats.budgetMisses. Active stars × A–D, doubled for one transient crossfade deck per star. (At the
// historical 8 active stars this is exactly the 64 it replaces.) It stays a real cap: the typical
// concurrent count is far lower, since a row voice only lives ROW_GATE + release.
const MAX_ROW_OSC = ROW_ACTIVE_STARS * 4 * 2;
const VISUAL_ATTACK_SECONDS = 0.7;

// ══ ROW VOICE TUNABLES ════════════════════════════════════════════════════════════════════════
// This mode is short-notes-into-a-large-reverb, NOT legato: a voice plays a fixed short gate and
// releases into a shared reverb tail regardless of when the next onset lands. The reverb — not a
// sustained oscillator — is what makes tones "hold", which keeps the polyrhythm's onset timing
// crisp instead of smearing overlapping sustains. Everything the ear cares about is tunable here.
// Fixed-gate ADSR (seconds). ROW_GATE is the whole point: note length is decoupled from onset spacing.
const ROW_ATTACK = 0.004;           // fast pluck attack — long enough to avoid a click, short enough to bite
const ROW_DECAY = 0.46;             // attack peak → sustain fall
const ROW_SUSTAIN = 0.05;           // held level across the gate
const ROW_PEAK = 0.16;              // envelope peak for a real scheduled attack
const ROW_GATE = 0.14;              // note length from attack start to release start — DECOUPLED from onsets
const ROW_RELEASE = 0.09;           // exponential release into the reverb tail (no click)
export const ROW_MICRO_GAP_SECONDS = 0.012; // below 12ms, separate pitches are no longer cleanly articulated
const ROW_ENV_FLOOR = 0.0001;
// Shared reverb send — rows only (the ambient bed owns its own reverb). Pre-delay keeps dry attacks
// crisp; the wet-side highpass stops dense grids piling into low-end mud; damping darkens the tail.
const ROW_REVERB_SECONDS = 5;     // impulse length — the apparent "size" of the space
const ROW_REVERB_DECAY = 3.2;       // impulse decay exponent (higher = faster tail)
const ROW_REVERB_DAMPING = 0.12;    // one-pole lowpass on the impulse noise (lower = darker/smoother)
const ROW_REVERB_WET = 0.35;        // wet send level — the dry/wet balance is this mode's "sustain" control
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

const actionToneKey = action => action?.rawFraction ?? action?.fraction ?? String(action?.rawRatio);

// Schedule-time ROW 1/1 policy. Exact source identity is rawFraction: folded `fraction` would also mute
// 2/1, 4/1, …, which are intentionally still playable octave articulations of the fundamental.
export function shouldScheduleRowAction(action, rowFundamental = true) {
  return rowFundamental !== false || action?.rawFraction !== '1/1';
}

// Time until this layer will ACTUALLY re-articulate. With repeat-cull enabled, identical tones inside
// the current cycle are silent holds; the first layer event after the loop wrap articulates because the
// runtime hold memory clears there. Keeping this calculation pure makes the dense-grid policy testable.
export function nextRowLayerGapTicks(events, eventIndex, action, grid, repeatCull = true) {
  if (!Array.isArray(events) || !events.length || !(grid > 0) || !action?.layer) return grid || 1;
  const startTick = Number(events[eventIndex]?.tick) || 0;
  const currentTone = actionToneKey(action);
  for (let i = eventIndex + 1; i < events.length; i++) {
    const next = events[i].layerActions?.find(candidate => candidate.layer === action.layer);
    if (next && (!repeatCull || actionToneKey(next) !== currentTone)) return events[i].tick - startTick;
  }
  // The hold memory clears at the wrap, so the first matching layer event in the next cycle articulates
  // even when its tone is identical to this one.
  for (let i = 0; i <= eventIndex; i++) {
    const next = events[i].layerActions?.find(candidate => candidate.layer === action.layer);
    if (next) return grid - startTick + events[i].tick;
  }
  return grid;
}

// Extremely short notes are windowed wholly inside their real onset gap and attenuated in proportion
// to that gap. This retains the mathematical onset/pitch, but prevents a sub-audio-quantum event from
// becoming a full-level broadband impulse. Longer notes keep the established fixed pluck envelope.
export function rowEnvelopePlan(gapSeconds = Infinity, sampleRate = 48000) {
  const renderFloor = 2 / Math.max(8000, Number(sampleRate) || 48000);
  if (Number.isFinite(gapSeconds) && gapSeconds <= renderFloor) {
    return { render: false, micro: true, duration: Math.max(0, gapSeconds), peak: ROW_ENV_FLOOR };
  }
  if (Number.isFinite(gapSeconds) && gapSeconds < ROW_MICRO_GAP_SECONDS) {
    const duration = Math.max(renderFloor, gapSeconds);
    const attack = duration * 0.4;
    return {
      render: true,
      micro: true,
      attack,
      decay: 0,
      hold: 0,
      release: duration - attack,
      duration,
      sustain: ROW_ENV_FLOOR,
      peak: Math.max(ROW_ENV_FLOOR * 1.01, ROW_PEAK * (duration / ROW_MICRO_GAP_SECONDS)),
    };
  }
  const attack = ROW_ATTACK;
  const decay = ROW_DECAY;
  const holdUntil = Math.max(ROW_GATE, attack + decay);
  return {
    render: true,
    micro: false,
    attack,
    decay,
    hold: holdUntil - attack - decay,
    release: ROW_RELEASE,
    duration: holdUntil + ROW_RELEASE,
    sustain: Math.max(ROW_ENV_FLOOR, ROW_SUSTAIN),
    peak: ROW_PEAK,
  };
}

// (The row-release envelope hold — cancelAndHoldAtTime or the analytic fallback that seeds a mid-ramp
// interruption — now lives inside the instrument renderer's handle.release, since the handle owns the
// amp-envelope node. rowEnvelopePlan above still describes the SHAPE; the renderer schedules it.)

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
  // detuneBus: the audio layer's shared detune bus (a GainNode carrying CENTS — the SUM of the fundamental
  // and modulation offsets). Summed into every row oscillator's detune param, so a fundamental transpose or
  // a root modulation glides these voices too — including the ones born mid-glide, which matters here more
  // than anywhere: a row note is a 140ms gate, so by the time a glide is half over every voice that existed
  // when it started is already gone.
  // midiBridge: optional { note(hz, whenAudio, seconds, gain) } mirror to a DAW. The player stays
  // harmony-blind here too — it reports pitch, time, length and loudness, and the audio layer folds in
  // the summed detune offset, which is the one harmonic fact it does not own.
  // telemetry: an optional sink with lateEvent(latenessMs, emitted) — cosmos/audio-telemetry.js's meter.
  // Optional so the headless guards can build a player without one.
  // getRecipe: (role) => a frozen instrument role recipe (instrument-presets.js). The NARROW instrument
  // dependency — the composition root injects one that reads the live selected palette, so a selection
  // change is picked up by the next scheduled voice without this module importing the audio root or any
  // palette catalog. Defaults to the classic (today's) recipe so headless guards render at parity.
  constructor(context, output, detuneBus = null, midiBridge = null, telemetry = null, getRecipe = null) {
    this.ctx = context;
    this.detuneBus = detuneBus;
    this.midiBridge = midiBridge;
    this.telemetry = telemetry;
    this.getRecipe = getRecipe || (role => presetRecipe(DEFAULT_INSTRUMENT, role));
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(output);                    // dry path
    this.reverb = this._buildReverbSend(output);    // wet send, tapped post-master (fades with enable)
    this.enabled = false;
    this.rowFundamental = true;
    this.stars = new Map();
    // Denormalized index mirroring deck.voices, keyed by tone: toneKey -> Map<voice, owningDeck>. It exists
    // so the per-tone voice cap (_toneVoiceCandidates) reads only the handful of live voices on THAT tone
    // instead of rescanning every star × deck × voice on every sounding note (was ~O(V) per note, super-
    // linear in field density). Maintained in lockstep with deck.voices at the three sites that set/delete.
    this._voicesByTone = new Map();
    // Exposure ledger for the sky's "hold the chord until its full quality has sounded" rule. The player
    // stays harmony-blind: it records only WHICH folded tone sounded and WHEN, carrying the tone's cents
    // straight through from the program. cosmos-audio owns the root and maps those cents to chord degrees.
    // Keyed by fraction so it stays bounded by the distinct tones of the active programs (tens), and
    // pruned by age on read rather than reset, so a lookahead attack scheduled across a chord boundary
    // is still counted at the moment it actually sounds.
    this.soundedTones = new Map();   // fraction -> { cents, when } (latest attack)
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

  setRowFundamental(enabled) {
    this.rowFundamental = enabled !== false;
    return this.rowFundamental;
  }

  // SPACE knob: the row half of the shared reverb send. cosmos-audio drives this and the ambient send
  // together off one control (ROW_REVERB_WET is the default, reproduced at the knob midpoint).
  setReverbWet(level) {
    if (!this.reverb) return;
    this.reverb.wet.gain.setTargetAtTime(Math.max(0, Number(level) || 0), this.ctx.currentTime, 0.1);
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

  // POSE only: where a star already in the field sits, how loud and how bright it is. Cheap and safe to run
  // every frame — it touches AudioParams and nothing else. No membership bookkeeping, no program installs,
  // no compile requests. This is the half of the old per-frame field rebuild that actually has to be
  // per-frame: rotating the camera moves every star in listener space and changes nothing else.
  setPose(items) {
    const now = this.ctx.currentTime;
    for (const item of items || []) {
      const star = this.stars.get(item.id);
      if (!star || !star.active) continue;   // a star that has left the field is fading out; don't re-aim it
      this._applyPose(star, item, now);
    }
  }

  _applyPose(star, item, now) {
    star.distance = Number.isFinite(item.distance) ? item.distance
      : (Array.isArray(item.position) && item.position.length >= 3 ? Math.hypot(...item.position) : Infinity);
    setParam(star.filter.frequency, item.cutoff, now, 0.18);
    if (!setTriplet(star.panner, 'position', item.position, now, 0.035)) star.panner.setPosition?.(...item.position);
    star.gain.gain.cancelScheduledValues(now);
    star.gain.gain.setValueAtTime(Math.max(0.0001, star.gain.gain.value), now);
    star.gain.gain.linearRampToValueAtTime(Math.max(0, item.gain), now + CROSSFADE);
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
      this._applyPose(star, item, now);
      const installedKey = star.currentDeck?.program.programKey;
      if (item.program && item.program.programKey !== installedKey && item.program.programKey !== star.pending?.program.programKey) {
        const boundaryTick = Math.ceil((absoluteTick + 1e-7) / ROW_SWITCH_TICKS) * ROW_SWITCH_TICKS;
        star.pending = { program: item.program, boundaryTick };
      }
    }
    for (const [id, star] of this.stars) {
      if (seen.has(id)) continue;
      // Two-clock safety valve. Stars are normally reaped in tick() (transport-worker clock). If that stalls
      // or its scheduling path throws, already-inactive stars — each pinning a full program (events[] +
      // eventGaps + seedTable) plus static audio nodes — would pile up unbounded (the activeStars-climbs
      // leak that __cosmosHealth() watches). setField runs on the rAF clock and does ONLY destruction here
      // (no scheduling that could throw), so an inactive star past its removeAt is reaped here too. Healthy
      // case is unchanged: tick (40Hz) still reaps first, before the next setField (~16Hz), so this rarely
      // fires; when it does, the star is one tick() would have destroyed at the same removeAt. Deleting
      // during Map iteration is safe (same as tick's reap loop — the iterator won't revisit the entry).
      if (!star.active) {
        if (now >= star.removeAt) { this._destroyStar(star, now); this.stars.delete(id); }
        continue;
      }
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
    // fraction -> owning rhythm key (from the compact program's selectedTones) so a sounding voice can be
    // traced to the bloom node that represents its rhythm. Missing/absent → null (voice just won't light a node).
    const ownerKeyByFraction = new Map((program.selectedTones || []).map(tone => [tone.fraction, tone.ownerKey ?? null]));
    // Same projection for the tone's absolute cents — the only harmonic datum the exposure ledger carries.
    const centsByFraction = new Map((program.selectedTones || []).map(tone => [tone.fraction, tone.cents]));
    return { program, gain, voices: new Map(), handles: new Set(), lastToneByLayer: new Map(), ownerKeyByFraction, centsByFraction, cursorCycle: 0, cursorEvent: 0, startTime: 0, retireAt: Infinity };
  }

  _syncCursor(deck, absoluteTick) {
    const events = deck.program.events;
    const grid = deck.program.grid;
    if (!events.length) { deck.cursorCycle = 0; deck.cursorEvent = 0; return; }
    deck.cursorCycle = Math.floor(absoluteTick / grid);
    const cycleTick = absoluteTick - deck.cursorCycle * grid;
    // Leftmost event with tick >= cycleTick. events are tick-ascending, so this is a binary search rather
    // than the old O(E) findIndex — a chord change re-syncs up to ~30 decks in one tick, each up to E=20000.
    let lo = 0, hi = events.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (events[mid].tick >= cycleTick) hi = mid; else lo = mid + 1; }
    if (lo >= events.length) { deck.cursorEvent = 0; deck.cursorCycle++; }  // wrapped past the last event
    else deck.cursorEvent = lo;
  }

  // A program swap is SILENT: it only restores the repeat-cull memory a deck that had been running
  // since the loop start would already hold. It must NOT sound the tones it restores.
  //
  // Under the old legato voicing a swap had to re-articulate every held tone or the sustain vanished.
  // Under fixed-gate short notes nothing is held — a pre-boundary voice is long over — so a sounding
  // seed invents up to four simultaneous notes per star, all quantized to the same ROW_SWITCH_TICKS
  // boundary, all drawn from the same loop tail. Under flight churn (a star install per entry) that
  // stacked into a ~20-note chord repeating on the switch grid, swamping the real polyrhythm with the
  // same chord over and over. Deck installs are now inaudible; onsets resume at the next real event.
  _seedDeck(deck, absoluteTick) {
    const program = deck.program;
    const events = program.events;
    if (!events.length) return;
    const grid = program.grid;
    const cycleTick = ((absoluteTick % grid) + grid) % grid;
    const seedTable = program.seedTable;
    if (seedTable) {
      // Table path: for each layer, the last occurrence with tick < cycleTick (else the loop tail — its
      // final occurrence) is the tone a deck running since loop start would hold. Binary-search each layer
      // instead of the old two full passes over every event.
      for (let s = 0; s < seedTable.length; s++) {
        const { layer, ticks, fractions } = seedTable[s];
        let lo = 0, hi = ticks.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid] < cycleTick) lo = mid + 1; else hi = mid; }
        deck.lastToneByLayer.set(layer, lo > 0 ? fractions[lo - 1] : fractions[fractions.length - 1]);
      }
      return;
    }
    // Fallback (fixtures / programs without a precomputed table): the original two-pass derivation.
    const latest = new Map();
    // Previous-cycle tail seeds every canonical layer, then current-cycle events before the boundary
    // overwrite it. An event exactly ON the boundary is left to the scheduler as a real attack.
    for (const event of events) for (const action of event.layerActions) latest.set(action.layer, action);
    for (const event of events) {
      if (event.tick >= cycleTick) break;
      for (const action of event.layerActions) latest.set(action.layer, action);
    }
    for (const action of latest.values()) deck.lastToneByLayer.set(action.layer, action.rawFraction);
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
    this._seedDeck(deck, pending.boundaryTick);
    this.stats.installs++;
  }

  // Index maintenance — call these exactly where a voice enters/leaves its deck.voices Map, so the tone
  // index never diverges from the authoritative per-layer state.
  _indexAddVoice(deck, voice) {
    let byVoice = this._voicesByTone.get(voice.toneKey);
    if (!byVoice) this._voicesByTone.set(voice.toneKey, byVoice = new Map());
    byVoice.set(voice, deck);
  }
  _indexRemoveVoice(voice) {
    const byVoice = this._voicesByTone.get(voice.toneKey);
    if (!byVoice) return;
    byVoice.delete(voice);
    if (!byVoice.size) this._voicesByTone.delete(voice.toneKey);
  }

  // Same candidate shape and (distance, current) semantics as the old full scan, but sourced from the tone
  // index: only the ≤(few) live voices on THIS tone are visited, and distance/current are read live off the
  // star so a flying field still ranks by current geometry. nearestCulledToneVoices re-sorts by those keys,
  // so the Map's iteration order doesn't affect the outcome (beyond an arbitrary pick between exact ties,
  // which the full-scan order was equally arbitrary about).
  _toneVoiceCandidates(toneKey) {
    const candidates = [];
    const byVoice = this._voicesByTone.get(toneKey);
    if (!byVoice) return candidates;
    for (const [voice, deck] of byVoice) {
      const star = this.stars.get(deck.program.grid);
      if (!star) continue;
      candidates.push({
        starId: star.id,
        layer: voice.layer,
        distance: star.distance,
        current: deck === star.currentDeck,
        deck,
        voice,
      });
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
    // Iterate the star Map directly — no per-tick [...this.stars] clone. Deleting the CURRENT key during
    // Map iteration is well-defined and safe (the iterator won't revisit it), and it's the only entry we
    // ever delete here. retiringDecks is compacted IN PLACE rather than rebuilt into a fresh array, so a
    // steady tick over a stable field allocates nothing in this loop.
    for (const [id, star] of this.stars) {
      if (!star.active && now >= star.removeAt) { this._destroyStar(star, now); this.stars.delete(id); continue; }
      if (canSchedule && star.pending) {
        const switchTime = transportStart + star.pending.boundaryTick / ticksPerSecond;
        if (switchTime <= horizon) this._activatePending(star, Math.max(now, switchTime));
      }
      if (canSchedule && star.active && star.currentDeck) this._scheduleDeck(star.currentDeck, now, horizon, transportStart, ticksPerSecond);
      const retiring = star.retiringDecks;
      if (retiring.length) {
        let write = 0;
        for (let read = 0; read < retiring.length; read++) {
          const deck = retiring[read];
          if (now >= deck.retireAt) this._destroyDeck(deck, now);
          else retiring[write++] = deck;
        }
        retiring.length = write;
      }
    }
  }

  // Recover from starvation in O(layers × log(events)), independent of the number of missed cycles.
  // Only skip notes the existing lateness policy would drop; restore repeat memory from the skipped
  // portion of this cycle. Unlike installation seeding, recovery must NOT borrow the previous tail:
  // normal playback clears its memory at every wrap, even when a layer has not played this cycle yet.
  _skipLateEvents(deck, now, transportStart, ticksPerSecond) {
    const { events, grid, seedTable } = deck.program;
    if (!seedTable || !events.length) return;
    const oldCycle = deck.cursorCycle, oldEvent = deck.cursorEvent;
    const oldTick = oldCycle * grid + events[oldEvent].tick;
    const oldWhen = transportStart + oldTick / ticksPerSecond;
    if (oldWhen < deck.startTime || now - oldWhen <= 0.25) return;
    this._syncCursor(deck, (now - LATE_CLAMP_TOLERANCE_SECONDS - transportStart) * ticksPerSecond);
    const skipped = (deck.cursorCycle - oldCycle) * events.length + deck.cursorEvent - oldEvent;
    if (skipped <= 0) return;
    if (deck.cursorCycle !== oldCycle) deck.lastToneByLayer.clear();
    const cycleTick = events[deck.cursorEvent].tick;
    const firstTick = deck.cursorCycle === oldCycle ? events[oldEvent].tick : 0;
    for (const { layer, ticks, fractions } of seedTable) {
      if (!LAYERS.has(layer)) continue;
      let lo = 0, hi = ticks.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid] < cycleTick) lo = mid + 1; else hi = mid; }
      let index = lo - 1;
      // Muted literal fundamentals never advance repeat memory in the ordinary scheduler either.
      while (index >= 0 && ticks[index] >= firstTick &&
             !shouldScheduleRowAction({ rawFraction: fractions[index] }, this.rowFundamental)) index--;
      if (index >= 0 && ticks[index] >= firstTick) deck.lastToneByLayer.set(layer, fractions[index]);
    }
    this.telemetry?.lateEventsSkipped?.(skipped, (now - oldWhen) * 1000);
  }

  _scheduleDeck(deck, now, horizon, transportStart, ticksPerSecond) {
    const { events, grid, eventGaps } = deck.program;
    if (!events.length) return;
    this._skipLateEvents(deck, now, transportStart, ticksPerSecond);
    while (true) {
      const event = events[deck.cursorEvent];
      const eventTick = deck.cursorCycle * grid + event.tick;
      const when = transportStart + eventTick / ticksPerSecond;
      if (when > horizon) break;
      // `when < deck.startTime` is the deliberate pre-install suppression (a deck must not sound the loop
      // tail it was seeded from) — not lateness, and excluded from the meters, or every install would
      // report a dropout and bury the real signal.
      const afterInstall = when >= deck.startTime;
      const late = classifyLateEvent(when, now);
      if (this.telemetry && afterInstall && late.latenessSeconds > 0) {
        this.telemetry.lateEvent(late.latenessSeconds * 1000, late.action === 'emit');
      }
      // A DROPPED event still happened musically: its layer memory must advance anyway, or the repeat-cull
      // comparison would measure against a stale tone and change which LATER notes re-strike. Dropping a
      // note must cost exactly that note — never a divergence in the sequence that follows it. (This is
      // also what lets a streamed window be compared against a full compile: same state, whatever sounded.)
      if (afterInstall) {
        const sounding = late.action === 'emit';
        const layerActions = event.layerActions;
        for (let ai = 0; ai < layerActions.length; ai++) {
          const action = layerActions[ai];
          if (!LAYERS.has(action.layer)) continue;
          if (!shouldScheduleRowAction(action, this.rowFundamental)) continue;
          // Silent hold, re-derived per loop: suppress a re-strike only when this layer's IMMEDIATELY
          // preceding tone THIS CYCLE is identical. The memory clears at each loop wrap (below), so a
          // tone that persists across the wrap — or spans the whole loop — still re-articulates once per
          // cycle instead of falling permanently silent. (We can't trust the compiler's 'repeat-hold'
          // label directly: it seeds the comparison across the wrap for legato sustain, which under short
          // notes marks a loop-constant layer as all-hold and it never sounds again after its seed blip.)
          if (deck.program.repeatCull && deck.lastToneByLayer.get(action.layer) === action.rawFraction) continue;
          deck.lastToneByLayer.set(action.layer, action.rawFraction);
          if (!sounding) continue;   // audibly late — the memory advanced, the note does not sound
          // Worker-precomputed gap (eventGaps[event.gapBase + ai]) — the forward/wrap scan that was O(E)
          // per onset. Fall back to the live scan only for a program without the table (e.g. a test fixture).
          const gapTicks = eventGaps
            ? eventGaps[event.gapBase + ai]
            : nextRowLayerGapTicks(events, deck.cursorEvent, action, grid, deck.program.repeatCull);
          // Math.max clamps by at most LATE_CLAMP_TOLERANCE_SECONDS now (12ms — under the threshold where
          // two attacks are separately articulated), so this can no longer stack a spread into a flam.
          this._startVoice(deck, action, Math.max(now, when), gapTicks / ticksPerSecond);
        }
      }
      deck.cursorEvent++;
      if (deck.cursorEvent >= events.length) { deck.cursorEvent = 0; deck.cursorCycle++; deck.lastToneByLayer.clear(); }
    }
  }

  _startVoice(deck, action, when, gapSeconds = Infinity) {
    const frequencyHz = culledGridRowFrequency(action.rawRatio);
    if (frequencyHz === null) return;
    const envelopePlan = rowEnvelopePlan(gapSeconds, this.ctx.sampleRate);
    if (!envelopePlan.render) return;
    this._releaseLayer(deck, action.layer, when, VOICE_RELEASE);
    if (!this._claimToneVoice(deck, action, when)) return;
    // Plan the voice from the selected instrument's ROW recipe, then admit against the live-oscillator
    // ceiling by its ACTUAL source cost — a multi-oscillator palette charges more than one, so a richer
    // timbre lowers the max simultaneous voices instead of inflating the real oscillator count. Classic
    // (today's single triangle) has cost 1, so this is byte-for-byte the previous budget behavior.
    const plan = planVoice(this.getRecipe('row'), { role: 'row', baseFreq: frequencyHz, timing: envelopePlan, sampleRate: this.ctx.sampleRate });
    if (this.logicalVoiceCount + plan.cost > MAX_ROW_OSC) { this.stats.budgetMisses++; return; }
    const endAt = when + envelopePlan.duration;
    // The renderer owns the oscillator graph, its detune-bus connections, and the gap-aware envelope; this
    // module owns note choice, stealing, budget, the star bus, and the visual/MIDI/exposure side-channels.
    const handle = createInstrumentVoice({ ctx: this.ctx, destination: deck.gain, plan, when, detuneBus: this.detuneBus });
    const voice = {
      handle, cost: plan.cost, layer: action.layer, fraction: action.fraction,
      rawFraction: action.rawFraction, ratio: action.rawRatio, frequencyHz,
      toneKey: action.fraction || action.rawFraction || String(action.rawRatio), startTime: when,
      endAt, envelopePlan,
      released: false,   // budget is freed exactly once — by whichever of the handle completion / _releaseLayer runs first
    };
    deck.voices.set(action.layer, voice);
    this._indexAddVoice(deck, voice);
    deck.handles.add(handle);
    const star = this.stars.get(deck.program.grid);
    if (star) {
      // Bounded life now (was Infinity for held legato voices): short notes make the aura pulse per
      // attack rather than glow for a sustained voice. A same-layer steal shortens this in _releaseLayer.
      // ownerKey tags the life/attack with the rhythm that sourced it, so a bloomed grid can light the
      // matching bloom node instead of a single grid-centre orb.
      const ownerKey = deck.ownerKeyByFraction?.get(action.fraction) ?? null;
      // frequencyHz is the BIRTH pitch (pre-detune). The global cents glide is applied at draw time so the
      // orb's hue tracks the sounding pitch; storing it here would freeze the colour against a live modulation.
      voice.visualLife = { startTime: when, endTime: endAt, ownerKey, frequencyHz };
      star.visualLives.push(voice.visualLife);
      star.visualAttacks.push({ when, strength: 1, ownerKey, frequencyHz });
    }
    this.midiBridge?.note(frequencyHz, when, endAt - when, this.stars.get(deck.program.grid)?.gain.gain.value ?? 1);
    const soundedCents = deck.centsByFraction?.get(action.fraction);
    if (Number.isFinite(soundedCents)) this.soundedTones.set(action.fraction, { cents: soundedCents, when });
    this.logicalVoiceCount += plan.cost;
    // A voice that plays out its full gate ends HERE (the handle's last source), not via _releaseLayer — so
    // free its cost here too, or the count leaks up to MAX_ROW_OSC and every later attack is silently dropped.
    handle.onComplete(() => {
      deck.handles.delete(handle);
      if (deck.voices.get(action.layer)?.handle === handle) deck.voices.delete(action.layer);
      this._indexRemoveVoice(voice);   // the ended voice leaves the tone index even if a newer one took its layer
      if (!voice.released) { voice.released = true; this.logicalVoiceCount = Math.max(0, this.logicalVoiceCount - voice.cost); }
    });
  }

  _releaseLayer(deck, layer, when, release) {
    const voice = deck.voices.get(layer);
    if (!voice) return;
    deck.voices.delete(layer);
    this._indexRemoveVoice(voice);
    // Guarded so a later natural completion of the same handle can't double-free (and vice-versa).
    if (!voice.released) { voice.released = true; this.logicalVoiceCount = Math.max(0, this.logicalVoiceCount - voice.cost); }
    if (voice.visualLife) voice.visualLife.endTime = Math.min(voice.visualLife.endTime, when + release);
    // The handle owns the micro-aware release curve and the source stop (including silencing a scheduled-
    // but-unsounded future voice); its onComplete later removes it from deck.handles and frees nothing more.
    voice.handle.release(when, release);
  }

  _destroyDeck(deck, now) {
    for (const layer of [...deck.voices.keys()]) this._releaseLayer(deck, layer, now, 0.035);
    for (const handle of [...deck.handles]) handle.stop(now + 0.04);
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
    this.soundedTones.clear();
    this._voicesByTone.clear();
    this.logicalVoiceCount = 0;
  }

  // The tones whose attack audio-context time has actually REACHED since `since` — a lookahead attack
  // scheduled past `now` does not count as heard yet. Entries older than `retain` are dropped on read,
  // which is the ledger's only pruning (no reset, so an attack scheduled just before a chord boundary
  // still counts toward the chord it lands in). Returns [{ fraction, cents }].
  soundedSince(since, retain = 300) {
    const now = this.ctx.currentTime;
    const out = [];
    for (const [fraction, entry] of this.soundedTones) {
      if (entry.when < now - retain) { this.soundedTones.delete(fraction); continue; }
      if (entry.when >= since && entry.when <= now) out.push({ fraction, cents: entry.cents });
    }
    return out;
  }

  // How many active stars hold a program that can actually articulate — an installed deck with events, or
  // one pending at the next switch boundary. The sky's exposure floor asks this to tell two situations
  // apart that produce the identical empty ledger: "the rows have not finished saying this chord yet" and
  // "there are no rows here to say it". Pending counts, so the install boundary is not a hole in which the
  // floor briefly reads as vacuous. Independent of the mix — a silenced row still articulates and still
  // exposes (see chordExposure in cosmos-audio.js).
  soundingStarCount() {
    let n = 0;
    for (const star of this.stars.values()) {
      if (!star.active) continue;
      if (star.currentDeck?.program.events.length || star.pending?.program.events.length) n++;
    }
    return n;
  }

  debugState() {
    return {
      enabled: this.enabled,
      rowFundamental: this.rowFundamental,
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
          mutedLiteralFundamentalActions: this.rowFundamental ? 0 : (program?.events || []).reduce((count, event) =>
            count + event.layerActions.filter(action => action.rawFraction === '1/1').length, 0),
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
    const attackPulse = attack => {
      const age = now - attack.when;
      return (age < 0 || age > VISUAL_ATTACK_SECONDS) ? 0 : attack.strength * Math.pow(1 - age / VISUAL_ATTACK_SECONDS, 2);
    };
    for (const star of this.stars.values()) {
      star.visualAttacks = star.visualAttacks.filter(attack => attack.when >= now - VISUAL_ATTACK_SECONDS);
      star.visualLives = star.visualLives.filter(life => life.endTime > now);
      const voices = star.visualLives.reduce((count, life) => count + (life.startTime <= now ? 1 : 0), 0);
      if (!voices) continue;
      // hz carries the star's colour: the pitch of its FRESHEST attack (the note just heard). A sustained
      // voice with no recent attack still needs a colour, so fall back below to a live voice's pitch.
      let pulse = 0, hz = 0;
      for (const attack of star.visualAttacks) {
        const p = attackPulse(attack);
        if (p > pulse) { pulse = p; hz = attack.frequencyHz || hz; }
      }
      if (!hz) for (const life of star.visualLives) if (life.startTime <= now && life.frequencyHz) { hz = life.frequencyHz; break; }
      // Per-source breakdown keyed by owning rhythm — a bloomed grid lights each node whose rhythm has a
      // live voice or a recent attack (attacks linger past the short note, so a node pulses then fades).
      // Each source carries its own hz the same way: freshest attack wins, else its live voice's pitch.
      const sources = new Map();
      const bump = key => { let s = sources.get(key); if (!s) sources.set(key, s = { key, voices: 0, pulse: 0, hz: 0 }); return s; };
      for (const life of star.visualLives) if (life.startTime <= now && life.ownerKey != null) { const s = bump(life.ownerKey); s.voices++; if (!s.hz) s.hz = life.frequencyHz || 0; }
      for (const attack of star.visualAttacks) {
        const p = attackPulse(attack);   // 0 for a not-yet-reached lookahead attack — don't light its node early
        if (p > 0 && attack.ownerKey != null) { const s = bump(attack.ownerKey); if (p > s.pulse) { s.pulse = p; s.hz = attack.frequencyHz || s.hz; } }
      }
      out.push({ id: star.id, voices, pulse, hz, sources: [...sources.values()] });
    }
    return out;
  }

  destroy() {
    this.clear();
    try { this.master.disconnect(); } catch {}
    if (this.reverb) for (const node of Object.values(this.reverb)) { try { node.disconnect(); } catch {} }
  }
}
