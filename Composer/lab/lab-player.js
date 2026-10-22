// lab-player.js — plays a composition spec on a loop through the shared voice library (Audio/voices).
//
// No DOM. It takes an AudioContext (a real one in the page, a recording mock in Composer/tests/assert-lab.mjs) and
// schedules ahead of the clock: every `tickMs` (25 ms) it books the notes that start in the next `aheadSeconds`
// (150 ms), the cycle looping from the moment Perform was pressed.
//
//   graph    each part → its gain bus (a level per part) → master gain → limiter (DynamicsCompressor) → destination
//   voices   a note with `retrigger` starts a voice of its part's sound (`note` role, its velocity the peak). The notes
//            after it without `retrigger` are a CHAIN: the same voice, held, moved to each one's pitch with
//            setFrequency at its time (in the chords part a chain is one voice's), released at the chain's end. A
//            note alone is planned with its own duration, so a struck sound damps where its note ends.
//   stop     every live voice fades out over 30 ms and stops; nothing more is booked.

import { getRecipe, normalizeNoteInstrumentId } from '../../Audio/voices/recipes.js';
import { planVoice } from '../../Audio/voices/plan.js';
import { createInstrumentVoice } from '../../Audio/voices/voice.js';

export const PLAYER_DEFAULTS = Object.freeze({ tickMs: 25, aheadSeconds: 0.15, master: 0.8, level: 0.8, release: 0.08, glide: 0.012, stopFade: 0.03 });
const LIMITER = Object.freeze({ threshold: -10, knee: 6, ratio: 6, attack: 0.003, release: 0.2 });

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
  const lanes = part.id === 'chords' ? [...new Set(part.notes.map((n) => n.voice))].map((v) => part.notes.filter((n) => n.voice === v)) : [part.notes];
  const out = [];
  for (const lane of lanes) {
    const sorted = [...lane].sort((a, b) => a.time - b.time || a.node - b.node);
    let chain = null;
    for (const n of sorted) {
      if (n.retrigger || !chain) { chain = { voice: n.voice ?? null, notes: [n] }; out.push(chain); } else chain.notes.push(n);
    }
  }
  return out.sort((a, b) => a.notes[0].time - b.notes[0].time);
}

/**
 * createPlayer({ ctx, voices, timers, options }) → { buses, master, limiter, play(spec, getParts), stop(), tick(),
 *   setLevel(id, v), setGlide(seconds), playhead(), playing }
 *   voices   { planVoice, createInstrumentVoice, getRecipe } (the library's, by default; a test may wrap them)
 *   timers   { setInterval, clearInterval } (the page's, by default; a test drives tick() itself)
 *   getParts () → the parts as they play now (the lab's sound, legato and on/off), read at every tick
 */
export function createPlayer({ ctx, voices = { planVoice, createInstrumentVoice, getRecipe }, timers = globalThis, options = {} } = {}) {
  const o = { ...PLAYER_DEFAULTS, ...options };
  const limiter = ctx.createDynamicsCompressor();
  for (const [k, v] of Object.entries(LIMITER)) limiter[k].value = v;
  limiter.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = o.master;
  master.connect(limiter);
  const buses = {}, live = new Set();
  let spec = null, getParts = null, loopStart = 0, booked = 0, timer = null, playing = false;

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
  /** book one chain of one cycle, starting at `base` (the cycle's start on the clock) */
  const bookChain = (part, chain, base) => {
    const first = chain.notes[0], last = chain.notes[chain.notes.length - 1], bus = busOf(part.id);
    const alone = chain.notes.length === 1;
    const when = base + first.time, end = base + last.time + last.duration;
    const handle = startVoice(part.sound, first.hz, when, first.velocity, alone ? first.duration : null, bus);
    for (const n of chain.notes.slice(1)) handle.setFrequency(n.hz, base + n.time, o.glide);
    if (!alone) handle.release(end, o.release);
    live.add({ handle, end: end + 1 });
  };

  function tick() {
    if (!playing) return;
    const now = ctx.currentTime, horizon = now + o.aheadSeconds, T = spec.knobs.cycleSeconds;
    for (const v of live) if (v.end < now) live.delete(v);
    const parts = getParts();
    for (let c = Math.floor((booked - loopStart) / T); loopStart + c * T < horizon; c++) {
      const base = loopStart + c * T;
      for (const part of parts) {
        if (!part.enabled) continue;
        for (const chain of chainsOf(part)) {
          const at = base + chain.notes[0].time;
          if (at >= booked && at < horizon) bookChain(part, chain, base);
        }
      }
    }
    booked = horizon;
  }

  return {
    buses, master, limiter,
    get playing() { return playing; },
    /** start looping `spec` now (a little ahead, so the first notes are not late) */
    play(theSpec, theParts) {
      if (playing) this.stop();
      spec = theSpec; getParts = theParts || (() => theSpec.parts);
      for (const p of spec.parts) busOf(p.id);
      loopStart = ctx.currentTime + 0.05; booked = loopStart; playing = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(o.master, ctx.currentTime);
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
      live.clear();
    },
    setLevel(id, value) { const b = busOf(id); b.gain.setTargetAtTime(Math.max(0, value), ctx.currentTime, 0.02); },
    /** portamento: how long a held voice takes to move to its next note, in seconds (0 = a step). Notes booked
     *  from now on use it; the ~150 ms already booked keep the old length. */
    setGlide(seconds) { o.glide = Math.max(0, Number(seconds) || 0); },
    get glide() { return o.glide; },
    /** where the loop is, 0..1 of the cycle (null when stopped) */
    playhead() { if (!playing || !spec) return null; const T = spec.knobs.cycleSeconds, t = ctx.currentTime - loopStart; return t < 0 ? 0 : (t % T) / T; },
    get liveVoices() { return live.size; },
    get loopStart() { return loopStart; },
  };
}
