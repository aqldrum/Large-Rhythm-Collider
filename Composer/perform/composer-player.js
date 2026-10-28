// composer-player.js — plays a composition spec on a loop through the shared voice library (Audio/voices). Shared
// (promoted from lab/lab-player.js, 2026-10-22): the lab and the main page's Composer tab both play through it.
//
// No DOM. It takes an AudioContext (a real one in the page, a recording mock in Composer/tests/assert-lab.mjs) and
// schedules ahead of the clock: every `tickMs` (25 ms) it books what falls in the next `aheadSeconds` (150 ms), the
// cycle looping from the moment Perform was pressed.
//
//   graph    each part → its gain bus (a level per part) → master gain → limiter (DynamicsCompressor) → destination
//   voices   a note with `retrigger` starts a voice of its part's sound (`note` role, its velocity the peak). The notes
//            after it without `retrigger` are a CHAIN: the same voice, held, moved to each one's pitch with
//            setFrequency at its time (in the chords, and the comp in chords, a chain is one voice's), released at the
//            chain's end. A note alone is planned with its own duration, so a struck sound damps where its note ends.
//   booking  everything is booked inside the lookahead, as the clock reaches it: a chain's start when its first note
//            comes up, then each of its moves, then its release, one tick at a time (a held chain is carried from
//            tick to tick, across the loop's end if it wraps). Nothing is booked further ahead than 150 ms, so a
//            tempo or glide change reaches a voice already holding.
//   tempo    playback runs on SPEC time (the spec's own seconds, counted on from the first cycle: cycle c's note at
//            `time` is at c·T + time) mapped to the clock by a piecewise-linear map, a segment per tempo:
//            clock = t0 + (spec − s0) × factor, factor = the spec's tempo / the chosen one. Every note's time and
//            length scale by it, and so the loop (T × factor); pitch does not, nor glide or release (seconds). A
//            change opens a new segment where the booking has reached (the lookahead's edge), so what is booked
//            keeps its place and the playhead never jumps: it takes effect within ~150 ms.
//   stop     every live voice fades out over 30 ms and stops; nothing more is booked.
//   midi     (CLEAN_MIDI_ORDER.md, phase B) an optional sink (composer-midi.js) booked from the same loop, on the same
//            clock map, as the voices: each of a part's notes its own note (its length midiNotesOf's, so the legato
//            and the glide never reach it), its off booked as the clock reaches its end (so a live tempo moves it),
//            each drum stroke, and MIDI clock — 24 a quarter of the spec's own tempo, so the DAW follows a live
//            tempo too — with Start at play and every note off (and Stop) at stop. The audio clock becomes a Web
//            MIDI timestamp through the context's getOutputTimestamp. `localSound(false)` silences the voices
//            (the master) while the MIDI goes on (M7).
//   drums    the spec's drum strokes (drums.js), booked like a note's start on the same clock map (so they loop, follow
//            the phase and the live tempo), each a one-shot through Audio/drums into its own bus, 'drums': a `made:`
//            choice is playMadeDrum at the stroke's velocity; a sample URL is playSample at the velocity × the made
//            channel's sampleLevel (chunk-tunes' balance), loaded on first use, the made sound standing in until it is.

import { getRecipe, normalizeNoteInstrumentId } from '../../Audio/voices/recipes.js';
import { planVoice } from '../../Audio/voices/plan.js';
import { createInstrumentVoice } from '../../Audio/voices/voice.js';
import * as drumLibrary from '../../Audio/drums/index.js';
import { midiNotesOf, zonedPart } from './composer-midi.js';

export const PLAYER_DEFAULTS = Object.freeze({ tickMs: 25, aheadSeconds: 0.15, master: 0.8, level: 0.8, release: 0.08, glide: 0.012, stopFade: 0.03, factor: 1 });
const LIMITER = Object.freeze({ threshold: -10, knee: 6, ratio: 6, attack: 0.003, release: 0.2 });
/** a drum voice's made kit sound (Audio/drums ids), its stand-in while a sample loads */
const MADE_OF = Object.freeze({ kick: 'kick', snare: 'snare', hat: 'hihat', perc: 'perc', cym: 'cym' });

const chainCache = new WeakMap();
/** a part's notes grouped as the player books them: [{ voice, notes: [note] }] — a chain begins at a retrigger */
export function chainsOf(part) {
  const had = chainCache.get(part);
  if (had) return had;
  const out = chainsOfUncached(part);
  chainCache.set(part, out);
  return out;
}
function chainsOfUncached(part) {
  // the chords' and the comp's voices each their own lane (COMP_ARP_ORDER.md A3: a comp in chords holds a voice a class;
  // led chords, BASS_VOICING_ORDER.md P6: a lane is the note's register order in the chord, `lane`, not its class)
  const laneOf = (n) => n.lane ?? n.voice;
  const lanes = zonedPart(part.id) ? [...new Set(part.notes.map(laneOf))].map((v) => part.notes.filter((n) => laneOf(n) === v)) : [part.notes];
  const out = [];
  for (const lane of lanes) {
    const sorted = [...lane].sort((a, b) => a.time - b.time || a.node - b.node);
    let chain = null;
    for (const n of sorted) {
      if (n.retrigger || !chain) { chain = { voice: laneOf(n) ?? null, notes: [n] }; out.push(chain); } else chain.notes.push(n);
    }
  }
  return out.sort((a, b) => a.notes[0].time - b.notes[0].time);
}
/** where a chain ends, in its cycle's spec time (its last note's end; past T when it wraps the loop) */
const endOf = (chain) => { const last = chain.notes[chain.notes.length - 1]; return last.time + last.duration; };

/**
 * createPlayer({ ctx, destination, voices, timers, options }) → { buses, master, limiter, play(spec, getParts), stop(),
 *   tick(), setLevel(id, v), setGlide(seconds), setTimeFactor(factor), playhead(), playing }
 *   destination  the AudioNode the limiter feeds (ctx.destination by default): a host routes the whole mix into its
 *            own graph here (Cosmos, next, into its gate)
 *   voices   { planVoice, createInstrumentVoice, getRecipe } (the library's, by default; a test may wrap them)
 *   timers   { setInterval, clearInterval } (the page's, by default). A host that drives the pulse itself passes
 *            {} (no setInterval: nothing is started) and calls the public tick() from its own scheduler.
 *   getParts () → the parts as they play now (the lab's sound, legato and on/off), read at every tick
 */
export function createPlayer({ ctx, destination = null, voices = { planVoice, createInstrumentVoice, getRecipe }, drums: drumLib = drumLibrary, timers = globalThis, options = {}, midi = null,
  now = () => (globalThis.performance ? performance.now() : Date.now()) } = {}) {
  const o = { ...PLAYER_DEFAULTS, ...options };
  const limiter = ctx.createDynamicsCompressor();
  for (const [k, v] of Object.entries(LIMITER)) limiter[k].value = v;
  limiter.connect(destination ?? ctx.destination);
  const master = ctx.createGain();
  master.gain.value = o.master;
  master.connect(limiter);
  const buses = {}, live = new Set();
  let spec = null, getParts = null, getDrums = null, loopStart = 0, timer = null, playing = false;
  const samples = new Map();   // url → AudioBuffer once loaded (null while loading or failed)
  // booked: the clock up to which everything is booked; bookedSpec: the same instant in spec time
  let booked = 0, bookedSpec = 0;
  /** the clock↔spec map: segments { t0, s0, factor } in time order, the last one current */
  let segments = [];
  /** chains whose voice has started but whose moves or release are not all booked yet: { chain, base, handle, next, entry } */
  let holding = [];
  // MIDI (phase B): the notes whose off isn't booked yet { handle, end (spec time) }, the next clock tick (spec time),
  // each part's level (the velocity scales by it, M4), and whether the voices sound (M7)
  let midiHeld = [], nextTick = 0, local = true;
  const levels = {};
  /** an audio-clock time as a Web MIDI timestamp: the two clocks paired at one instant (cosmos-midi-out.js' way) */
  const msOf = (t) => {
    let perf = now(), ref = ctx.currentTime;
    const stamp = ctx.getOutputTimestamp?.();
    if (stamp && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime)) { perf = stamp.performanceTime; ref = stamp.contextTime; }
    return Math.max(now(), perf + (t - ref) * 1000);
  };

  const segAtClock = (t) => { let i = segments.length - 1; while (i > 0 && segments[i].t0 > t) i--; return segments[i]; };
  const segAtSpec = (s) => { let i = segments.length - 1; while (i > 0 && segments[i].s0 > s) i--; return segments[i]; };
  const specAt = (t) => { const g = segAtClock(t); return g.s0 + (t - g.t0) / g.factor; };
  const clockOf = (s) => { const g = segAtSpec(s); return g.t0 + (s - g.s0) * g.factor; };

  const busOf = (id) => {
    if (!buses[id]) { const g = ctx.createGain(); g.gain.value = o.level; g.connect(master); buses[id] = g; }
    return buses[id];
  };
  const startVoice = (sound, hz, when, velocity, duration, destination) => {
    const recipe = voices.getRecipe(normalizeNoteInstrumentId(sound), 'note');
    const timing = { attack: 0.01, decay: 0.12, sustain: 0.7, release: o.release, peak: velocity, duration };
    const plan = voices.planVoice(recipe, { role: 'note', baseFreq: hz, timing, sampleRate: ctx.sampleRate });
    return voices.createInstrumentVoice({ ctx, destination, plan, when });
  };
  /** start one chain of one cycle (`base` = the cycle's start in spec time); a chain of one note is booked whole */
  const startChain = (part, chain, base) => {
    const first = chain.notes[0], S = base + first.time, alone = chain.notes.length === 1;
    const duration = alone ? first.duration * segAtSpec(S).factor : null;
    const handle = startVoice(part.sound, first.hz, clockOf(S), first.velocity, duration, busOf(part.id));
    const entry = { handle, end: alone ? clockOf(S) + duration + 1 : Infinity };
    live.add(entry);
    if (!alone) holding.push({ chain, base, handle, next: 1, entry });
  };
  /** one drum stroke at clock time `at` through the drums bus; a sample not loaded yet starts loading, the made sound
   *  of its voice standing in */
  const strike = (choice, hit, at) => {
    if (!choice) return;
    const out = busOf('drums'), made = drumLib.madeDrumOf(choice);
    let handle = null;
    if (made) handle = drumLib.playMadeDrum(made, { ctx, out, at, peak: hit.velocity });
    else {
      const buffer = samples.get(choice);
      if (buffer) handle = drumLib.playSample({ ctx, out, buffer, at, peak: hit.velocity * (drumLib.MADE_DRUMS[MADE_OF[hit.voice]]?.sampleLevel ?? 0.6) });
      else {
        if (!samples.has(choice)) { samples.set(choice, null); drumLib.loadSample(ctx, choice).then((b) => { if (b) samples.set(choice, b); else samples.delete(choice); }); }
        handle = drumLib.playMadeDrum(MADE_OF[hit.voice], { ctx, out, at, peak: hit.velocity });
      }
    }
    if (handle) live.add({ handle, end: handle.end + 0.05 });
  };
  /** book a held chain's moves and release that fall before spec time `until`; true once its release is booked */
  const advance = (h, until) => {
    const notes = h.chain.notes;
    while (h.next < notes.length && h.base + notes[h.next].time < until) {
      const n = notes[h.next++];
      h.handle.setFrequency(n.hz, clockOf(h.base + n.time), o.glide);
    }
    if (h.next < notes.length) return false;
    const E = h.base + endOf(h.chain);
    if (E >= until) return false;
    const at = clockOf(E);
    h.handle.release(at, o.release);
    h.entry.end = at + 1;
    return true;
  };

  function tick() {
    if (!playing) return;
    const now = ctx.currentTime, horizon = now + o.aheadSeconds, T = spec.knobs.cycleSeconds;
    for (const v of live) if (v.end < now) live.delete(v);
    const keep = Math.min(now, booked);
    while (segments.length > 1 && segments[1].t0 <= keep) segments.shift();
    const until = specAt(horizon);
    const parts = getParts(), drums = getDrums ? getDrums() : null, m = midi?.active ? midi : null;
    // MIDI: the offs that come due first, so a voice's next note-on follows its last note-off (M3)
    if (midiHeld.length) midiHeld = midiHeld.filter((h) => { if (h.end >= until) return true; midi.off(h.handle, msOf(clockOf(h.end))); return false; });
    for (let c = Math.floor(bookedSpec / T); c * T < until; c++) {
      const base = c * T;
      if (drums?.enabled) for (const hit of drums.hits) {
        const S = base + hit.time;
        if (S >= bookedSpec && S < until) { strike(drums.kit[hit.voice], hit, clockOf(S)); if (m) m.stroke(hit.voice, hit.velocity * (levels.drums ?? o.level), msOf(clockOf(S))); }
      }
      for (const part of parts) {
        if (!part.enabled) continue;
        for (const chain of chainsOf(part)) {
          const S = base + chain.notes[0].time;
          if (S >= bookedSpec && S < until) startChain(part, chain, base);
        }
        if (m && m.sends(part.id)) for (const n of midiNotesOf(part, T)) {
          const S = base + n.time;
          if (S < bookedSpec || S >= until) continue;
          const handle = m.note(part.id, n.voice, n.hz, n.velocity * (levels[part.id] ?? o.level), msOf(clockOf(S)));
          if (handle) {
            const E = base + n.end;
            if (E < until) m.off(handle, msOf(clockOf(E))); else midiHeld.push({ handle, end: E });
          }
        }
      }
    }
    // MIDI clock (decision 2): 24 a quarter of the spec's tempo, on spec time, so it follows a live tempo
    if (m && m.clocking && spec.knobs.tempoBpm > 0) {
      const dt = 60 / spec.knobs.tempoBpm / 24;
      if (nextTick < bookedSpec - dt) nextTick = Math.ceil(bookedSpec / dt) * dt;   // the clock came on mid-play
      for (; nextTick < until; nextTick += dt) m.clockTick(msOf(clockOf(nextTick)));
    }
    holding = holding.filter((h) => !advance(h, until));
    booked = horizon; bookedSpec = until;
  }

  return {
    buses, master, limiter,
    get playing() { return playing; },
    /** start looping `spec` now (a little ahead, so the first notes are not late), at the current time factor;
     *  theDrums () → the drums as they play now (the spec's own by default), read at every tick */
    play(theSpec, theParts, theDrums) {
      if (playing) this.stop();
      spec = theSpec; getParts = theParts || (() => theSpec.parts); getDrums = theDrums || (() => theSpec.drums);
      for (const p of spec.parts) busOf(p.id);
      busOf('drums');
      loopStart = ctx.currentTime + 0.05; booked = loopStart; bookedSpec = 0; playing = true;
      segments = [{ t0: loopStart, s0: 0, factor: o.factor }]; holding = []; midiHeld = []; nextTick = 0;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(local ? o.master : 0, ctx.currentTime);
      if (midi?.active) midi.clockStart(msOf(loopStart));
      tick();
      timer = timers.setInterval ? timers.setInterval(tick, o.tickMs) : null;
    },
    tick,
    /** everything off at once: each live voice fades over 30 ms and stops */
    stop() {
      if (timer != null && timers.clearInterval) timers.clearInterval(timer);
      timer = null; playing = false;
      const now = ctx.currentTime;
      for (const v of live) { try { v.handle.fadeOut(now, o.stopFade); } catch {} try { v.handle.stop(now + o.stopFade + 0.02); } catch {} }
      live.clear(); holding = [];
      midiHeld = [];
      midi?.allOff();
    },
    setLevel(id, value) { levels[id] = Math.max(0, Number(value) || 0); const b = busOf(id); b.gain.setTargetAtTime(Math.max(0, value), ctx.currentTime, 0.02); },
    /** M7: the voices heard or not (the master), the MIDI going on either way */
    localSound(on) { local = !!on; master.gain.setTargetAtTime(local ? o.master : 0, ctx.currentTime, 0.02); },
    get local() { return local; },
    /** portamento: how long a held voice takes to move to its next note, in seconds (0 = a step). Moves booked from
     *  now on use it (held voices too); the ~150 ms already booked keep the old length. */
    setGlide(seconds) { o.glide = Math.max(0, Number(seconds) || 0); },
    get glide() { return o.glide; },
    /** tempo, as the factor every spec time and length is scaled by on the clock (the spec's tempo / the chosen
     *  one; 1 = as composed). Playing, it takes over where the booking has reached — within the lookahead — with
     *  the playhead's place in the cycle kept; stopped, the next play starts at it. */
    setTimeFactor(factor) {
      const f = Number(factor);
      if (!(f > 0) || !Number.isFinite(f)) return;
      o.factor = f;
      if (!playing) return;
      const cur = segments[segments.length - 1], now = ctx.currentTime;
      const t0 = Math.max(booked, now), s0 = t0 === booked ? bookedSpec : specAt(t0);
      if (t0 === cur.t0) cur.factor = f;   // nothing booked on the current segment yet: retime it
      else segments.push({ t0, s0, factor: f });
    },
    get factor() { return o.factor; },
    /** where the loop is, 0..1 of the cycle (null when stopped) */
    playhead() { if (!playing || !spec) return null; const T = spec.knobs.cycleSeconds, s = specAt(ctx.currentTime); return s < 0 ? 0 : (s % T) / T; },
    get liveVoices() { return live.size; },
    get loopStart() { return loopStart; },
    /** the clock up to which everything is booked (a tempo change takes over here) */
    get booked() { return booked; },
  };
}
