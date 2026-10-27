// composer-midi.js — the Composer's MIDI out: each part on its own bus, in exact just intonation, so a DAW records the
// parts as tracks (Composer/CLEAN_MIDI_ORDER.md, phase B; Avery's rulings 2026-10-27).
//
// No DOM and no Web MIDI here: a port is anything with send(bytes, ts) (a Web MIDI output, or a test's recorder), and
// every time is a Web MIDI timestamp (performance.now's ms). The player (composer-player.js) books the notes and turns
// its clock into those timestamps; the Composer window (composer-tab.js) asks for MIDI access and picks the ports.
//
// It deliberately does NOT use the site's Playback/MIDIOut.js (window.lrcMidiOut), as Cosmos doesn't: that module times
// its sends off the main page's AudioContext, and the Composer plays on its own. The wire rules are the same as that
// module's, Playback/MIDIOUT_SPEC.md's and Cosmos/audio/cosmos-midi-out.js': the nearest MIDI note (±50¢) plus a
// per-channel pitch bend, the bend sent before the note-on, over ±48 semitones set by RPN 0, and the MPE
// configuration message (RPN 6) where a zone is used. So a DAW set up for the site receives the Composer the same way.
//
//   routing   decision 1, a bus per part, and every tonal bus an MPE lower zone (Avery, 2026-10-27, after the rig: an
//             MPE track uses the instrument's per-note bend range, 48 by MPE's convention, where an ordinary track
//             uses each device's own PB range, which differs instrument to instrument). Channel 1 is each zone's
//             master. Lead, comping, bass and inner play one note at a time: a zone of one member, their notes on
//             channel 2. Chords: a zone of four, each chord voice its own member channel (voice 1, the root, on
//             channel 2, up to voice 4 on channel 5). An ordinary track on All Channels still hears channel 2, at its
//             device's own range. Drums: channel 10, General MIDI
//             notes. Every voice owns its channel for the whole composition: no allocator, no stealing (M3).
//   notes     decision 3: a new note for each note, the synth doing any glide. A note on a channel that still holds
//             one ends that one first (the same-note guard, and a clip's overlapping note-off).
//   lengths   decision 4, M12: the same with the page's legato on or off — `midiNotesOf`: each note lasts until its
//             voice's next note (the part's; in the chords, that voice's), the last of the loop until the cycle's end;
//             a MIDI target's clip note keeps its own note-off where that is sooner.
//   velocity  M4: the note's velocity × its part's level, 1–127 (never 0, which MIDI reads as a note-off).
//   drums     M5: kick 36, snare 38, hat 42, perc 37, cymbal 49; a 50 ms note, no bend.
//   clock     decision 2: MIDI clock (24 a quarter), Start and Stop, on the clock's port, for the DAW to follow.
//   silence   M6: allOff() — every live note off, then All Sound Off and All Notes Off on every channel used, and Stop.
//
//   file      M11: midiFileOf — the composition as it plays now, one cycle, as a Standard MIDI File: a track a part,
//             on the same channels with the same bends, lengths and velocities, at the spec's tempo.
//
//   createComposerMidi({ now, bendRange }) → the sink (below); midiNotesOf(part, T); midiFileOf(spec, parts, drums,
//   levels); matchPort(outputs, part); noteAndBend(hz, range); bendFromSemitones(st, range); freqToMidiFloat(hz)

import { rearticulate } from '../core/compose.js';
import { writeMidi } from '../core/midi.js';

export const COMPOSER_MIDI_OUT_VERSION = 'composer-midi-v1';
/** the parts that go out, a bus each, in the window's order */
export const MIDI_PARTS = Object.freeze(['lead', 'chords', 'comp', 'bass', 'inner', 'drums']);
/** what a bus is matched by on first use (M8): its name holds the part's */
export const BUS_WORDS = Object.freeze({ lead: 'Lead', chords: 'Chords', comp: 'Comp', bass: 'Bass', inner: 'Inner', drums: 'Drums' });
export const MIDI_BEND_RANGE = 48;
export const ZONE_MASTER = 0;               // every tonal bus's MPE master, channel 1
export const MONO_CHANNEL = 1;              // a one-note part's member channel, channel 2
export const CHORD_MASTER = ZONE_MASTER;
export const CHORD_MEMBERS = Object.freeze([1, 2, 3, 4]);   // channels 2–5, one a chord voice
export const DRUM_CHANNEL = 9;              // channel 10
export const GM_DRUMS = Object.freeze({ kick: 36, snare: 38, hat: 42, perc: 37, cym: 49 });
export const DRUM_NOTE_MS = 50;
const MIN_NOTE_MS = 10;
const CLOCK = 0xF8, START = 0xFA, STOP = 0xFC;

// ── the tuning math: Playback/MIDIOut.js' and cosmos-midi-out.js' (tests/assert-composer-midi.mjs holds them equal) ──
export const freqToMidiFloat = (hz) => 69 + 12 * Math.log2(hz / 440);
export function bendFromSemitones(semitones, range = MIDI_BEND_RANGE) {
  const r = Math.max(1, range);
  return Math.min(16383, Math.max(0, Math.round(8192 + (semitones / r) * 8192)));
}
/** the nearest MIDI note (±50¢: a tone 49¢ under a note bends down to it) and the bend for the rest */
export function noteAndBend(hz, range = MIDI_BEND_RANGE) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const m = freqToMidiFloat(hz), note = Math.min(127, Math.max(0, Math.round(m)));
  return { note, bend: bendFromSemitones(m - note, range) };
}
export const velocityOf = (v) => Math.min(127, Math.max(1, Math.round(127 * Math.min(1, Math.max(0, Number(v) || 0)))));

/** the channel a part's note goes on (a chord voice: its member channel) */
export function channelOf(partId, voice = 0) {
  if (partId === 'drums') return DRUM_CHANNEL;
  if (partId === 'chords') return CHORD_MEMBERS[Math.min(CHORD_MEMBERS.length - 1, Math.max(0, voice | 0))];
  return MONO_CHANNEL;
}

const lengthsCache = new WeakMap();
/**
 * A part's notes as MIDI sends them (M12): [{ time, end, hz, velocity, voice }] in time order, end in the cycle's
 * spec seconds. The lengths are the page's legato-on rule (compose.js `articulate`) whatever the part's own legato,
 * so the toggle never reaches the MIDI; a clip note's own note-off is kept where it is sooner than its voice's next
 * note. Memoized on the part object (the player reads it every tick).
 */
export function midiNotesOf(part, T) {
  const had = lengthsCache.get(part);
  if (had && had.T === T) return had.notes;
  const held = rearticulate(part, { legato: true, cycleSeconds: T });
  const lanes = part.id === 'chords' ? [...new Set(held.notes.map((n) => n.voice ?? 0))].map((v) => held.notes.filter((n) => (n.voice ?? 0) === v)) : [held.notes];
  const out = [];
  for (const lane of lanes) {
    lane.forEach((n, i) => {
      const next = i + 1 < lane.length ? lane[i + 1].time : T;
      out.push({ time: n.time, end: Math.min(n.time + n.duration, next), hz: n.hz, velocity: n.velocity, voice: n.voice ?? 0 });
    });
  }
  out.sort((a, b) => a.time - b.time || a.voice - b.voice);
  lengthsCache.set(part, { T, notes: out });
  return out;
}

/** the RPN messages that set a channel's parameter (and the null RPN after, so no stray data entry follows) */
const rpnBytes = (ch, msb, lsb, value) => [[0xB0 | ch, 101, msb], [0xB0 | ch, 100, lsb], [0xB0 | ch, 6, value], [0xB0 | ch, 38, 0], [0xB0 | ch, 101, 127], [0xB0 | ch, 100, 127]];
/** a bus's set-up, its MPE zone: RPN 6 on the master (its members), RPN 0 (the bend range) on each member */
export function setupBytes(partId, range = MIDI_BEND_RANGE) {
  if (partId === 'drums') return [];
  if (partId === 'chords') return [...rpnBytes(CHORD_MASTER, 0, 6, CHORD_MEMBERS.length), ...CHORD_MEMBERS.flatMap((ch) => rpnBytes(ch, 0, 0, range))];
  return [...rpnBytes(ZONE_MASTER, 0, 6, 1), ...rpnBytes(MONO_CHANNEL, 0, 0, range)];
}

/**
 * M11: the composition as it plays now, one cycle, as a Standard MIDI File (format 1, 480 a quarter, the spec's
 * tempo): a track a part, enabled parts only, each note at its MIDI length on its channel with its bend before it,
 * and each track's set-up (setupBytes) at the start; the drums on 10, 50 ms strokes. levels: { [part]: 0..1 }
 * → Uint8Array
 */
export function midiFileOf(spec, parts, drums = null, { levels = {}, bendRange = MIDI_BEND_RANGE, ppq = 480 } = {}) {
  const T = spec.knobs.cycleSeconds, bpm = spec.knobs.tempoBpm, tick = (sec) => Math.round(sec * (bpm / 60) * ppq);
  const tracks = [];
  for (const id of MIDI_PARTS) {
    if (id === 'drums') {
      if (!drums?.enabled) continue;
      const len = Math.max(1, tick(DRUM_NOTE_MS / 1000));
      tracks.push({ name: 'Drums', notes: drums.hits.filter((h) => GM_DRUMS[h.voice] != null).map((h) => ({ tick: tick(h.time), end: tick(h.time) + len, pitch: GM_DRUMS[h.voice], velocity: velocityOf(h.velocity * (levels.drums ?? 1)), channel: DRUM_CHANNEL })) });
      continue;
    }
    const part = parts.find((p) => p.id === id);
    if (!part || !part.enabled) continue;
    const notes = [];
    for (const n of midiNotesOf(part, T)) {
      const sp = noteAndBend(n.hz, bendRange);
      if (!sp) continue;
      const on = tick(n.time);
      notes.push({ tick: on, end: Math.max(on + 1, tick(n.end)), pitch: sp.note, velocity: velocityOf(n.velocity * (levels[id] ?? 1)), channel: channelOf(id, n.voice), bend: sp.bend });
    }
    tracks.push({ name: BUS_WORDS[id], notes, events: setupBytes(id, bendRange).map((bytes) => ({ tick: 0, bytes })) });
  }
  return writeMidi({ ppq, bpm, tracks });
}

/** the output a part is matched to on first use: the first whose name holds the part's word (M8), else null */
export function matchPort(outputs, partId) {
  const word = BUS_WORDS[partId];
  if (!word) return null;
  const re = new RegExp(`\\b${word}\\b`, 'i');
  return [...outputs].find((o) => re.test(o?.name ?? '')) ?? null;
}

/**
 * createComposerMidi({ now, bendRange }) → the sink the player books into and the window configures:
 *   setPorts({ [part]: port | null })   the bus each part goes to (a part with none isn't sent); configures them
 *   setClockPort(port | null)           where the clock goes (decision 2)
 *   setEnabled(on)                       off: everything silenced at once (M6)
 *   setBendRange(semitones)              for synths set by hand (M8); re-sends RPN 0
 *   active                               on, and at least one part has a port: the player books only then
 *   sends(partId)                        whether this part goes out
 *   note(partId, voice, hz, velocity, ts) → a handle; off(handle, ts)
 *   stroke(voice, velocity, ts)          a drum stroke
 *   clockStart(ts), clockTick(ts), clockStop(ts)
 *   allOff()                             M6
 *   stats                                { notes, strokes, ticks, guarded }
 */
export function createComposerMidi({ now = () => (globalThis.performance ? performance.now() : Date.now()), bendRange = MIDI_BEND_RANGE } = {}) {
  let enabled = false, ports = {}, clockPort = null, range = bendRange, clockRunning = false;
  const live = new Map();   // `${part}:${channel}` → { port, channel, note, onTs, off }
  const stats = { notes: 0, strokes: 0, ticks: 0, guarded: 0 };
  const send = (port, bytes, ts) => { if (!port) return; try { port.send(bytes, ts); } catch { /* a port can vanish mid-session; never break the audio */ } };
  /** every used bus told its bend range, the chords' zone its members (RPN 6 on the master, MPE's configuration) */
  function configure(only = null) {
    const ts = now();
    for (const id of MIDI_PARTS) {
      const port = ports[id];
      if (!port || (only && only !== id)) continue;
      for (const bytes of setupBytes(id, range)) send(port, bytes, ts);
    }
  }
  const usedChannels = (id) => (id === 'drums' ? [DRUM_CHANNEL] : id === 'chords' ? [ZONE_MASTER, ...CHORD_MEMBERS] : [ZONE_MASTER, MONO_CHANNEL]);
  function endLive(entry, ts) {
    if (entry.off) return;
    entry.off = true;
    send(entry.port, [0x80 | entry.channel, entry.note, 0], Math.max(entry.onTs + MIN_NOTE_MS, ts));
    const key = entry.key;
    if (live.get(key) === entry) live.delete(key);
  }
  function allOff() {
    const ts = now();
    for (const e of [...live.values()]) { e.off = true; send(e.port, [0x80 | e.channel, e.note, 0], ts); }
    live.clear();
    const seen = new Set();
    for (const id of MIDI_PARTS) {
      const port = ports[id];
      if (!port) continue;
      for (const ch of usedChannels(id)) {
        const k = `${port.id ?? port.name ?? id}:${ch}`;
        if (seen.has(k)) continue;
        seen.add(k);
        send(port, [0xB0 | ch, 120, 0], ts);   // All Sound Off: cuts a releasing voice too
        send(port, [0xB0 | ch, 123, 0], ts);   // All Notes Off
      }
    }
    if (clockRunning) { send(clockPort, [STOP], ts); clockRunning = false; }
  }
  const sink = {
    version: COMPOSER_MIDI_OUT_VERSION,
    stats,
    get enabled() { return enabled; },
    get active() { return enabled && MIDI_PARTS.some((id) => !!ports[id]); },
    get ports() { return { ...ports }; },
    get clockPort() { return clockPort; },
    get bendRange() { return range; },
    get liveNotes() { return live.size; },
    sends: (id) => enabled && !!ports[id],
    setPorts(next) {
      const was = ports;
      for (const id of MIDI_PARTS) if (id in next && was[id] && was[id] !== next[id]) {
        // a part moved off a bus: its notes there end now
        for (const e of [...live.values()]) if (e.part === id) endLive(e, now());
      }
      ports = { ...ports, ...next };
      for (const id of MIDI_PARTS) if (!ports[id]) delete ports[id];
      if (enabled) for (const id of MIDI_PARTS) if (id in next && ports[id] && ports[id] !== was[id]) configure(id);
    },
    setClockPort(port) { if (clockRunning && clockPort && clockPort !== port) { send(clockPort, [STOP], now()); clockRunning = false; } clockPort = port || null; },
    setEnabled(on) {
      const v = !!on;
      if (v === enabled) return;
      if (!v) allOff();
      enabled = v;
      if (v) configure();
    },
    setBendRange(semitones) {
      const v = Math.round(Number(semitones));
      if (!(v >= 1 && v <= 96)) return;
      range = v;
      if (enabled) configure();
    },
    /** one note on its part's bus (M3): bend, then note-on; a note its channel still holds ends first */
    note(partId, voice, hz, velocity, ts) {
      const port = ports[partId];
      if (!enabled || !port || partId === 'drums') return null;
      const spelled = noteAndBend(hz, range);
      if (!spelled) return null;
      const channel = channelOf(partId, voice), key = `${partId}:${channel}`;
      const held = live.get(key);
      if (held) { stats.guarded++; endLive(held, ts); }
      send(port, [0xE0 | channel, spelled.bend & 0x7F, (spelled.bend >> 7) & 0x7F], ts);
      send(port, [0x90 | channel, spelled.note, velocityOf(velocity)], ts);
      stats.notes++;
      const entry = { key, part: partId, port, channel, note: spelled.note, onTs: ts, off: false };
      live.set(key, entry);
      return entry;
    },
    off(entry, ts) { if (entry) endLive(entry, ts); },
    /** a drum stroke (M5): a General MIDI note on channel 10, 50 ms */
    stroke(voice, velocity, ts) {
      const port = ports.drums, note = GM_DRUMS[voice];
      if (!enabled || !port || note == null) return;
      send(port, [0x90 | DRUM_CHANNEL, note, velocityOf(velocity)], ts);
      send(port, [0x80 | DRUM_CHANNEL, note, 0], ts + DRUM_NOTE_MS);
      stats.strokes++;
    },
    get clocking() { return enabled && !!clockPort; },
    clockStart(ts) { if (!enabled || !clockPort) return; send(clockPort, [START], ts); clockRunning = true; },
    clockTick(ts) { if (!enabled || !clockPort) return; send(clockPort, [CLOCK], ts); stats.ticks++; },
    clockStop(ts) { if (!clockRunning) return; send(clockPort, [STOP], ts ?? now()); clockRunning = false; },
    allOff,
  };
  return sink;
}
