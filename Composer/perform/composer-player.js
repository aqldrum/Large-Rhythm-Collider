// composer-player.js — plays a composition spec on a loop through the shared voice library (Audio/voices). Shared
// (promoted from lab/lab-player.js, 2026-10-22): the lab and the main page's Composer tab both play through it.
//
// No DOM. It takes an AudioContext (a real one in the page, a recording mock in Composer/tests/assert-lab.mjs) and
// schedules ahead of the clock: every `tickMs` (25 ms) it books what falls in the next `aheadSeconds` (150 ms), the
// cycle looping from the moment Perform was pressed.
//
//   graph    each part → its gain bus (a level per part) → master gain → limiter (DynamicsCompressor) → destination
//            With `mix` (MIX_MASTER_ORDER.md; the Composer's controller passes it, Cosmos doesn't): each part's bus (its
//            level fader) → its trim → its high-pass (chords, comp, inner) → its duck gain (the same three) → master
//            gain → the master chain (composer-master.js: 'knock', the rack; 'classic', today's compressor; 'none')
//            → destination. Audio only (M6): MIDI velocity is the note's × the level fader, as before; the trims,
//            filters, duck and master never reach it.
//   duck     (mix only, M3) every kick the drums book also books a dip on the duck gains, from the kick's own clock
//            time (composer-master.js duckPoints): down 3 dB over the 5 ms before it, back over 120 ms. No detector.
//   voices   a note with `retrigger` starts a voice of its part's sound (`note` role, its velocity the peak). The notes
//            after it without `retrigger` are a CHAIN: the same voice, held, moved to each one's pitch with
//            setFrequency at its time (in the chords, and the comp in chords, a chain is one voice's: one lane's when
//            led, BASS_VOICING_ORDER.md P6), released at the
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
//   song     (ARRANGEMENT_ORDER.md, phase B: S10–S13) a song is passes of the one cycle: getParts(c) and getDrums(c)
//            are asked for pass c (the cycle counted from Perform) as the booking reaches it, once a tick each, and
//            everything that cycle books reads that pass's: the voices, the drum strokes, the MIDI notes and strokes,
//            and the duck's kicks (a drumless pass ducks nothing). A getter that ignores c books as before, byte for
//            byte. Every pass shares the loop's cycleSeconds and tempo, so the tempo map and the MIDI clock run on
//            unchanged (S11). A voice held over the end of its pass (a chain still holding, or a wrap) is released at
//            the boundary, with the usual release, when the next pass doesn't sound its part (missing, or not
//            enabled); a lone note's planned length is cut there the same way, so its start asks for the next pass
//            when its note crosses the end. A part that plays on keeps its voice. MIDI needs no cut: midiNotesOf ends
//            every note by the cycle's end. passAt(t) → the pass sounding at clock time t (S13).

import { getRecipe, normalizeNoteInstrumentId } from '../../Audio/voices/recipes.js';
import { planVoice } from '../../Audio/voices/plan.js';
import { createInstrumentVoice } from '../../Audio/voices/voice.js';
import * as drumLibrary from '../../Audio/drums/index.js';
import { midiNotesOf, zonedPart } from './composer-midi.js';
import { createMasterChain, duckPoints, MIX_STAGING, DUCK_DEFAULTS, KNOCK } from './composer-master.js';

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
const kickCache = new WeakMap();
/** the cycle times of a drums' kicks, in hit order (the duck's scan; memoized on the hits, checked by their count) */
function kicksOf(hits) {
  const had = kickCache.get(hits);
  if (had && had.n === hits.length) return had.times;
  const times = [];
  for (const hit of hits) if (hit.voice === 'kick') times.push(hit.time);
  kickCache.set(hits, { n: hits.length, times });
  return times;
}
/** does this pass sound part `id` (present and enabled)? */
const sounds = (parts, id) => { for (const p of parts) if (p.id === id) return !!p.enabled; return false; };

/**
 * createPlayer({ ctx, destination, voices, timers, options, mix }) → { buses, master, limiter, play(spec, getParts, getDrums),
 *   stop(), tick(), setLevel(id, v), setGlide(seconds), setTimeFactor(factor), playhead(), passAt(t), playing, setMix(m),
 *   mix, chain, stages }
 *   destination  the AudioNode the limiter feeds (ctx.destination by default): a host routes the whole mix into its
 *            own graph here (Cosmos, next, into its gate)
 *   mix      null (today's graph, unchanged) or { master: 'knock' | 'classic' | 'none', staging: true | false |
 *            { trimsDb, highpassHz }, duck: true | false | { depthDb, attackMs, holdMs, recoveryMs, parts }, knock: { inputDb, … } }
 *            (MIX_MASTER_ORDER.md). With it, `limiter` is the chain's output node (what feeds the destination).
 *   voices   { planVoice, createInstrumentVoice, getRecipe } (the library's, by default; a test may wrap them)
 *   timers   { setInterval, clearInterval } (the page's, by default). A host that drives the pulse itself passes
 *            {} (no setInterval: nothing is started) and calls the public tick() from its own scheduler.
 *   getParts (c) → the parts as they play now (the lab's sound, legato and on/off), read at every tick; c is the pass
 *            being booked (a song's, S10), which a loop's getter ignores
 *   getDrums (c) → the drums the same way (the spec's own by default)
 */
export function createPlayer({ ctx, destination = null, voices = { planVoice, createInstrumentVoice, getRecipe }, drums: drumLib = drumLibrary, timers = globalThis, options = {}, midi = null,
  now = () => (globalThis.performance ? performance.now() : Date.now()), mix = null } = {}) {
  const o = { ...PLAYER_DEFAULTS, ...options };
  const master = ctx.createGain();
  master.gain.value = o.master;
  // the end of the graph: today's compressor, or (mix) the master chain
  let limiter, chain = null;
  const mixState = mix ? {
    master: mix.master ?? 'knock',
    staging: mix.staging === false ? false : true,
    table: typeof mix.staging === 'object' && mix.staging ? { ...MIX_STAGING, ...mix.staging } : MIX_STAGING,
    duck: mix.duck === false ? false : true,
    duckOpts: { ...DUCK_DEFAULTS, ...(typeof mix.duck === 'object' && mix.duck ? mix.duck : {}) },
  } : null;
  if (mixState) {
    chain = createMasterChain(ctx, { mode: mixState.master, ...(mix.knock ? { knock: { ...KNOCK, ...mix.knock } } : {}) });
    master.connect(chain.input);
    limiter = chain.output;
  } else {
    limiter = ctx.createDynamicsCompressor();
    for (const [k, v] of Object.entries(LIMITER)) limiter[k].value = v;
    master.connect(limiter);
  }
  limiter.connect(destination ?? ctx.destination);
  const buses = {}, stages = {}, live = new Set();
  let spec = null, getParts = null, getDrums = null, loopStart = 0, timer = null, playing = false;
  const samples = new Map();   // url → AudioBuffer once loaded (null while loading or failed)
  // booked: the clock up to which everything is booked; bookedSpec: the same instant in spec time
  let booked = 0, bookedSpec = 0;
  /** the clock↔spec map: segments { t0, s0, factor } in time order, the last one current */
  let segments = [];
  /** chains whose voice has started but whose moves or release are not all booked yet: { chain, base, c, id, handle,
   *  next, entry } (c its pass, id its part) */
  let holding = [];
  // the passes this tick has asked for (S10): { c, parts, drums }, the slots reused tick to tick (a tick spans one
  // cycle, two at a boundary)
  const asked = [];
  let askedN = 0;
  /** pass c's parts and drums, asked of the getters once a tick */
  const passOf = (c) => {
    for (let i = 0; i < askedN; i++) if (asked[i].c === c) return asked[i];
    const p = asked[askedN] ??= { c: 0, parts: null, drums: null };
    p.c = c; p.parts = getParts(c); p.drums = getDrums(c); askedN++;
    return p;
  };
  const forgetPasses = () => { for (let i = 0; i < askedN; i++) { asked[i].parts = null; asked[i].drums = null; } askedN = 0; };
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

  const dbGain = (db) => Math.pow(10, db / 20);
  /** a part's staging (mix only): its trim, high-pass and duck gain, after its level fader */
  const stageOf = (id, bus) => {
    const t = mixState.table, trim = ctx.createGain();
    trim.gain.value = mixState.staging ? dbGain(t.trimsDb?.[id] ?? 0) : 1;
    bus.connect(trim);
    let last = trim, hpf = null, duck = null;
    if (t.highpassHz?.[id]) {
      hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass'; hpf.Q.value = Math.SQRT1_2;
      hpf.frequency.value = mixState.staging ? t.highpassHz[id] : 10;
      last.connect(hpf); last = hpf;
    }
    if (mixState.duckOpts.parts.includes(id)) { duck = ctx.createGain(); duck.gain.value = 1; last.connect(duck); last = duck; }
    last.connect(master);
    return { trim, hpf, duck };
  };
  const busOf = (id) => {
    if (!buses[id]) {
      const g = ctx.createGain(); g.gain.value = o.level; buses[id] = g;
      if (mixState) stages[id] = stageOf(id, g); else g.connect(master);
    }
    return buses[id];
  };
  // the duck (mix only): the kicks' clock times still shaping it, how far (spec time) kicks have been looked for, and
  // the clock up to which its points are booked
  let duckKicks = [], duckScanned = 0, duckBooked = 0;
  const duckGains = () => Object.values(stages).map((s) => s.duck).filter(Boolean);
  /** book the duck's points up to clock time `horizon`, looking for kicks a little past it (the dip starts before one):
   *  each cycle's kicks are its pass's (S10), so a drumless pass ducks nothing, and the pass after this tick's last is
   *  asked for when the look past reaches its downbeat */
  const bookDuck = (until, horizon, T) => {
    const d = mixState.duckOpts, pad = (d.attackMs / 1000 + 0.002) / o.factor;
    for (let c = Math.floor(duckScanned / T); c * T < until + pad; c++) {
      const drums = passOf(c).drums;
      if (!drums?.enabled || !drums.kit?.kick) continue;
      for (const time of kicksOf(drums.hits)) {
        const S = c * T + time;
        if (S >= duckScanned && S < until + pad) duckKicks.push(clockOf(S));
      }
    }
    duckScanned = Math.max(duckScanned, until + pad);
    const keepAfter = duckBooked - (d.holdMs + d.recoveryMs) / 1000 - 0.01;
    let kept = 0;
    for (const k of duckKicks) if (k >= keepAfter) duckKicks[kept++] = k;
    duckKicks.length = kept;
    duckKicks.sort((a, b) => a - b);
    if (mixState.duck) {
      const points = duckPoints(duckKicks, duckBooked, horizon, d);
      for (const g of duckGains()) for (const [t, v] of points) g.gain.linearRampToValueAtTime(v, t);
    }
    duckBooked = horizon;
  };
  const resetDuck = () => { const t = ctx.currentTime; for (const g of duckGains()) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(1, t); } };
  const startVoice = (sound, hz, when, velocity, duration, destination) => {
    const recipe = voices.getRecipe(normalizeNoteInstrumentId(sound), 'note');
    const timing = { attack: 0.01, decay: 0.12, sustain: 0.7, release: o.release, peak: velocity, duration };
    const plan = voices.planVoice(recipe, { role: 'note', baseFreq: hz, timing, sampleRate: ctx.sampleRate });
    return voices.createInstrumentVoice({ ctx, destination, plan, when });
  };
  /** start one chain of pass c (`base` = its start in spec time); a chain of one note is booked whole, its length cut
   *  at the pass's end when it crosses it and the next pass doesn't sound its part (S12) */
  const startChain = (part, chain, base, c) => {
    const first = chain.notes[0], S = base + first.time, alone = chain.notes.length === 1, T = spec.knobs.cycleSeconds;
    let length = first.duration;
    if (alone && first.time + length > T && !sounds(passOf(c + 1).parts, part.id)) length = T - first.time;
    const duration = alone ? length * segAtSpec(S).factor : null;
    const handle = startVoice(part.sound, first.hz, clockOf(S), first.velocity, duration, busOf(part.id));
    const entry = { handle, end: alone ? clockOf(S) + duration + 1 : Infinity };
    live.add(entry);
    if (!alone) holding.push({ chain, base, c, id: part.id, handle, next: 1, entry });
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
  /** book a held chain's moves and release that fall before spec time `until`; true once its release is booked. A
   *  chain held over its pass's end is released at the boundary when the next pass doesn't sound its part (S12). */
  const advance = (h, until, T) => {
    const notes = h.chain.notes;
    while (h.next < notes.length && h.base + notes[h.next].time < until) {
      const n = notes[h.next++];
      h.handle.setFrequency(n.hz, clockOf(h.base + n.time), o.glide);
    }
    if (h.next < notes.length) return false;
    const B = h.base + T;
    let E = h.base + endOf(h.chain);
    if (E > B && B < until && !sounds(passOf(h.c + 1).parts, h.id)) E = B;
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
    const m = midi?.active ? midi : null;
    askedN = 0;
    // MIDI: the offs that come due first, so a voice's next note-on follows its last note-off (M3)
    if (midiHeld.length) midiHeld = midiHeld.filter((h) => { if (h.end >= until) return true; midi.off(h.handle, msOf(clockOf(h.end))); return false; });
    for (let c = Math.floor(bookedSpec / T); c * T < until; c++) {
      const base = c * T, { parts, drums } = passOf(c);
      if (drums?.enabled) for (const hit of drums.hits) {
        const S = base + hit.time;
        if (S >= bookedSpec && S < until) { strike(drums.kit[hit.voice], hit, clockOf(S)); if (m) m.stroke(hit.voice, hit.velocity * (levels.drums ?? o.level), msOf(clockOf(S))); }
      }
      for (const part of parts) {
        if (!part.enabled) continue;
        for (const chain of chainsOf(part)) {
          const S = base + chain.notes[0].time;
          if (S >= bookedSpec && S < until) startChain(part, chain, base, c);
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
    holding = holding.filter((h) => !advance(h, until, T));
    if (mixState) bookDuck(until, horizon, T);
    forgetPasses();
    booked = horizon; bookedSpec = until;
  }
  /** S13: the pass sounding at clock time t (the cycle counted from Perform, on the tempo map); null when stopped */
  const passAt = (t = ctx.currentTime) => {
    if (!playing || !spec) return null;
    const s = specAt(t);
    return s < 0 ? 0 : Math.floor(s / spec.knobs.cycleSeconds);
  };

  return {
    buses, master, limiter, chain, stages,
    get playing() { return playing; },
    /** start looping `spec` now (a little ahead, so the first notes are not late), at the current time factor;
     *  theParts (c) / theDrums (c) → pass c's parts and drums (S10; the spec's own by default), read at every tick */
    play(theSpec, theParts, theDrums) {
      if (playing) this.stop();
      spec = theSpec; getParts = theParts || (() => theSpec.parts); getDrums = theDrums || (() => theSpec.drums);
      forgetPasses();
      for (const p of spec.parts) busOf(p.id);
      busOf('drums');
      loopStart = ctx.currentTime + 0.05; booked = loopStart; bookedSpec = 0; playing = true;
      segments = [{ t0: loopStart, s0: 0, factor: o.factor }]; holding = []; midiHeld = []; nextTick = 0;
      if (mixState) { resetDuck(); duckKicks = []; duckScanned = 0; duckBooked = ctx.currentTime; }
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
      live.clear(); holding = []; forgetPasses();
      if (mixState) { resetDuck(); duckKicks = []; }
      midiHeld = [];
      midi?.allOff();
    },
    /** the mix, live (mix only; MIX_MASTER_ORDER.md): { master: 'knock' | 'classic' | 'none', staging: bool, duck: bool }.
     *  The level faders, and so the MIDI, are untouched. */
    setMix({ master: m = null, staging = null, duck = null } = {}) {
      if (!mixState) return;
      const t = ctx.currentTime;
      if (m != null && chain) { chain.setMode(m); mixState.master = chain.mode; }
      if (staging != null) {
        mixState.staging = !!staging;
        for (const [id, s] of Object.entries(stages)) {
          s.trim.gain.setTargetAtTime(mixState.staging ? dbGain(mixState.table.trimsDb?.[id] ?? 0) : 1, t, 0.02);
          if (s.hpf) s.hpf.frequency.setTargetAtTime(mixState.staging ? mixState.table.highpassHz[id] : 10, t, 0.02);
        }
      }
      if (duck != null) { mixState.duck = !!duck; if (!mixState.duck) resetDuck(); }
    },
    get mix() { return mixState ? { master: mixState.master, staging: mixState.staging, duck: mixState.duck } : null; },
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
    /** the pass sounding at clock time t (now by default), counted from Perform: a song's section and pass (S13). Exact
     *  from the tempo segment sounding now on, through the lookahead; a time already sounded before a tempo change the
     *  map has let go of is read on the oldest segment kept. 0 before the loop starts, null when stopped. */
    passAt,
    get liveVoices() { return live.size; },
    get loopStart() { return loopStart; },
    /** the clock up to which everything is booked (a tempo change takes over here) */
    get booked() { return booked; },
  };
}
