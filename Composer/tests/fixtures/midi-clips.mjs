// midi-clips.mjs — the MIDI-target tests' clips (ported from probe/midi-target/clips.mjs): authored as note lists and
// written as real .mid files (core/midi.js writeMidi), so the tests read them back through readMidi like any file a user
// would drop in. `PPQ` and `seq` are exported for clips a test authors itself.
//
// Public-domain melodies (Beethoven's Ode to Joy, Twinkle Twinkle, Frère Jacques, Greensleeves) and three original
// riffs that push the grid decode and the search: a triplet shuffle, a syncopated sixteenth-note funk line with a
// chromatic passing tone, and a chromatic run that needs all twelve classes inside one bar. Two variants test the
// decode itself: a humanized Ode (note-ons jittered within tolerance, notes shortened) and Twinkle over block chords in
// the same track (the skyline must give the melody back). A heavily jittered Ode is decoded but not searched: it is the
// unquantized case.

import { writeMidi } from '../../core/midi.js';

export const PPQ = 480;
/** [pitch | null (a rest), quarters] in order → notes from a start (quarters) */
export function seq(items, start = 0) {
  const out = []; let at = start;
  for (const [pitch, q] of items) {
    if (pitch != null) out.push({ tick: Math.round(at * PPQ), end: Math.round((at + q) * PPQ), pitch, velocity: 90 });
    at += q;
  }
  return out;
}
const N = { C4: 60, Db4: 61, D4: 62, Eb4: 63, E4: 64, F4: 65, Gb4: 66, G4: 67, Ab4: 68, A4: 69, Bb4: 70, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, Fs4: 66, Gs4: 68, Cs5: 73 };

// Ode to Joy, D major (transposed up a tone from the usual C, so the key is not handed over)
const ode = seq([[N.Fs4, 1], [N.Fs4, 1], [N.G4, 1], [N.A4, 1], [N.A4, 1], [N.G4, 1], [N.Fs4, 1], [N.E4, 1],
  [N.D4, 1], [N.D4, 1], [N.E4, 1], [N.Fs4, 1], [N.Fs4, 1.5], [N.E4, 0.5], [N.E4, 2]]);

// Twinkle Twinkle, C major
const twinkle = seq([[N.C4, 1], [N.C4, 1], [N.G4, 1], [N.G4, 1], [N.A4, 1], [N.A4, 1], [N.G4, 2],
  [N.F4, 1], [N.F4, 1], [N.E4, 1], [N.E4, 1], [N.D4, 1], [N.D4, 1], [N.C4, 2]]);
// …over whole-note triads an octave down, in the same track
const triads = [[48, 52, 55], [53, 57, 60], [53, 57, 60], [48, 52, 55]].flatMap((chord, bar) => chord.map((pitch) => ({ tick: bar * 4 * PPQ, end: (bar + 1) * 4 * PPQ, pitch, velocity: 70 })));

// Frère Jacques, F major, 8 bars
const fj = [[N.F4, 1], [N.G4, 1], [N.A4, 1], [N.F4, 1]], fj2 = [[N.A4, 1], [N.Bb4, 1], [N.C5, 2]];
const fj3 = [[N.C5, 0.5], [N.D5, 0.5], [N.C5, 0.5], [N.Bb4, 0.5], [N.A4, 1], [N.F4, 1]], fj4 = [[N.F4, 1], [N.C4, 1], [N.F4, 2]];
const frere = seq([...fj, ...fj, ...fj2, ...fj2, ...fj3, ...fj3, ...fj4, ...fj4]);

// Greensleeves, A minor, 3/4 with a one-beat pickup
const green = seq([[N.A4, 1], [N.C5, 2], [N.D5, 1], [N.E5, 1.5], [N.F5, 0.5], [N.E5, 1], [N.D5, 2], [N.B4, 1],
  [N.G4, 1.5], [N.A4, 0.5], [N.B4, 1], [N.C5, 2], [N.A4, 1], [N.A4, 1.5], [N.Gs4, 0.5], [N.A4, 1], [N.B4, 2], [N.Gs4, 1], [N.E4, 2]], 2);

// a triplet shuffle in E, 4/4: long–short triplet pairs, then a held note
const t = 1 / 3;
const shuffle = seq([[N.E4, 2 * t], [N.E4, t], [N.G4, 2 * t], [N.A4, t], [N.Bb4, 2 * t], [N.A4, t], [N.G4, 2 * t], [N.E4, t],
  [N.D4, 2 * t], [N.E4, t], [N.G4, 2 * t], [N.E4, t], [N.E4, 2]]);

// a syncopated sixteenth funk line in D dorian, staccato (each note one sixteenth) with a chromatic G#
const funkSteps = [[0, N.D4], [3, N.D4], [6, N.F4], [7, N.G4], [10, N.A4], [12, N.C5], [14, N.A4], [15, N.G4],
  [16, N.F4], [18, N.G4], [19, N.Gs4], [20, N.A4], [23, N.C5], [26, N.D5], [28, N.C5], [30, N.A4]];
const funk = funkSteps.map(([s, pitch]) => ({ tick: s * PPQ / 4, end: (s + 1) * PPQ / 4, pitch, velocity: 95 }));

// a chromatic run: twelve sixteenths C4..B4, then C5 for a quarter
const chromatic = [...Array.from({ length: 12 }, (_, i) => [60 + i, 0.25]), [N.C5, 1]];

// a seeded jitter for the humanized variants
function jitter(notes, maxTicks, seed, shorten = 1) {
  let s = seed;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  return notes.map((n) => {
    const tick = Math.max(0, n.tick + Math.round((rnd() * 2 - 1) * maxTicks));
    return { ...n, tick, end: Math.max(tick + 1, tick + Math.round((n.end - n.tick) * shorten)) };
  });
}

/** name, file options, searched (false: the decode is reported, the search is not run) */
export const CLIPS = [
  { name: 'ode-to-joy', bpm: 108, timeSig: [4, 4], notes: ode },
  { name: 'twinkle', bpm: 100, timeSig: [4, 4], notes: twinkle },
  { name: 'frere-jacques', bpm: 112, timeSig: [4, 4], notes: frere },
  { name: 'greensleeves', bpm: 96, timeSig: [3, 4], notes: green },
  { name: 'shuffle-riff', bpm: 92, timeSig: [4, 4], notes: shuffle },
  { name: 'funk-line', bpm: 100, timeSig: [4, 4], notes: funk },
  { name: 'chromatic-run', bpm: 100, timeSig: [4, 4], notes: seq(chromatic) },
  { name: 'ode-humanized', bpm: 108, timeSig: [4, 4], notes: jitter(ode, 18, 7, 0.85), decodeAs: 'ode-to-joy' },
  { name: 'twinkle-with-chords', bpm: 100, timeSig: [4, 4], notes: [...twinkle, ...triads], decodeAs: 'twinkle' },
  { name: 'ode-unquantized', bpm: 108, timeSig: [4, 4], notes: jitter(ode, 70, 11, 0.9), searched: false },
].map((c) => ({ searched: true, ...c }));

/** a clip → .mid bytes */
export const clipBytes = (c) => writeMidi({ ppq: PPQ, bpm: c.bpm, timeSig: c.timeSig, tracks: [{ name: c.name, notes: c.notes }] });
