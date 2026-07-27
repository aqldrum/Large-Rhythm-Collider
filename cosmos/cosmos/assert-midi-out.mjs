// assert-midi-out.mjs — proofs for the cosmos MIDI mirror (../cosmos-midi-out.js). Every wire
// convention here is deliberately identical to the main site's Playback/MIDIOut.js + MIDIOUT_SPEC.md,
// so a DAW template built for the site receives the cosmos the same way; these assertions pin that.
import { readFileSync } from 'node:fs';
import {
  CosmosMidiOut, MIDI_BEND_RANGE_SEMITONES, MIDI_MASTER_CHANNEL, MIDI_MEMBER_CHANNELS,
  allocateMemberChannel, bendFromSemitones, freqToMidiFloat, noteAndBend,
} from '../cosmos-midi-out.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ COSMOS MIDI OUT — assertions ═══');

console.log('\n  Boundary: cosmos must not reach into the site playback engine');
// cosmos-audio.js's hard rule names MIDIOut explicitly, and there is a correctness reason under it:
// Playback/MIDIOut.js times its sends off window.toneRowPlayback.audioContext, a DIFFERENT context with
// a different time origin. Sharing that singleton would mis-time every cosmos message.
const midiSource = readFileSync(new URL('../cosmos-midi-out.js', import.meta.url), 'utf8');
// Scan CODE only — the prose above names the module it must not use, and would match itself.
const midiCode = midiSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
check('the cosmos sender imports nothing from Playback/',
  !/from\s+['"].*Playback\//.test(midiCode) && !midiCode.includes('lrcMidiOut'));
check('it times its sends off the context it is GIVEN, not a global one',
  midiCode.includes('this.ctx.getOutputTimestamp') && !/window\.|globalThis\./.test(midiCode));

console.log('\n  Tuning: nearest note + per-channel bend (the site\'s exact convention)');
check('A440 is MIDI 69 dead centre', noteAndBend(440).note === 69 && noteAndBend(440).bend === 8192);
check('the cosmos fundamental 220Hz is MIDI 57 dead centre', noteAndBend(220).note === 57 && noteAndBend(220).bend === 8192);
// ±50¢ assignment: a tone just under an octave spells as the octave with a small DOWN bend, not as the
// semitone below with a large up bend. This is the .tun/.scl/MIDI-export convention.
const justUnderOctave = 220 * 2 ** (1151 / 1200);
check('a tone 49¢ under a note bends DOWN onto it rather than up from the semitone below',
  noteAndBend(justUnderOctave).note === 69 && noteAndBend(justUnderOctave).bend < 8192,
  `note ${noteAndBend(justUnderOctave).note}, bend ${noteAndBend(justUnderOctave).bend}`);
// The JI intervals this whole project exists for must survive the round trip.
const roundTrip = (hz, range = MIDI_BEND_RANGE_SEMITONES) => {
  const { note, bend } = noteAndBend(hz);
  return 440 * 2 ** ((note + ((bend - 8192) / 8192) * range - 69) / 12);
};
for (const [name, ratio] of [['5/4', 5 / 4], ['3/2', 3 / 2], ['7/4', 7 / 4], ['11/8', 11 / 8], ['81/64', 81 / 64]]) {
  const hz = 220 * ratio;
  const errorCents = Math.abs(1200 * Math.log2(roundTrip(hz) / hz));
  check(`${name} survives note+bend to well under the 3-5¢ JND`, errorCents < 0.5, `${errorCents.toFixed(3)}¢`);
}
check('bend range is the ±48 MPE convention, which resolves finer than 0.6¢ per step',
  MIDI_BEND_RANGE_SEMITONES === 48 && (2 * 48 * 100) / 16384 < 0.6);
check('bend saturates at the range edges instead of wrapping',
  bendFromSemitones(999) === 16383 && bendFromSemitones(-999) === 0);
check('freqToMidiFloat is the standard A440 mapping', Math.abs(freqToMidiFloat(440) - 69) < 1e-12);

console.log('\n  MPE channel allocation');
check('channel 1 is the MPE master and 2–16 are the 15 members',
  MIDI_MASTER_CHANNEL === 0 && MIDI_MEMBER_CHANNELS.length === 15 &&
  MIDI_MEMBER_CHANNELS[0] === 1 && MIDI_MEMBER_CHANNELS.at(-1) === 15 &&
  !MIDI_MEMBER_CHANNELS.includes(MIDI_MASTER_CHANNEL));
// A private channel per sounding note is the whole point: near-unison JI neighbours hold independent
// bends instead of colliding on one note number, which is what preserves the shimmer.
const empty = new Map();
check('an idle pool allocates round-robin from the cursor',
  allocateMemberChannel(MIDI_MEMBER_CHANNELS, empty, 0).channel === 1 &&
  allocateMemberChannel(MIDI_MEMBER_CHANNELS, empty, 3).channel === 4);
const busy = new Map([[1, { note: 60 }], [2, { note: 61 }]]);
check('a busy channel is skipped, never doubled up (that is the collision MPE exists to avoid)',
  allocateMemberChannel(MIDI_MEMBER_CHANNELS, busy, 0).channel === 3);
const allBusy = new Map(MIDI_MEMBER_CHANNELS.map(ch => [ch, { note: 60 + ch }]));
const stealing = allocateMemberChannel(MIDI_MEMBER_CHANNELS, allBusy, 4);
check('when all 15 members are live it steals round-robin and reports the displaced note',
  stealing.channel === 5 && stealing.stolen?.note === 65);
check('the cursor always advances, so allocation cannot livelock on one channel',
  allocateMemberChannel(MIDI_MEMBER_CHANNELS, empty, 14).cursor === 0);
check('an empty pool yields nothing rather than throwing', allocateMemberChannel([], empty, 0) === null);

console.log('\n  Live wire behaviour (fake MIDI port + fake AudioContext)');
const sent = [];
const fakePort = { name: 'IAC Driver Bus 1', send: (bytes, ts) => sent.push({ bytes: [...bytes], ts }) };
const player = new CosmosMidiOut({ currentTime: 10, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 1000 }) });
player.output = fakePort;
player.enabled = true;
sent.length = 0;
player._configureMpe();
const mcm = sent.slice(0, 3).map(m => m.bytes);
check('enabling emits the MPE Configuration Message (RPN 6) on the master first',
  mcm[0][0] === 0xB0 && mcm[0][1] === 101 && mcm[0][2] === 0 &&
  mcm[1][1] === 100 && mcm[1][2] === 6 && mcm[2][1] === 6 && mcm[2][2] === 15);
check('every member channel is told the ±48 bend range via RPN 0',
  MIDI_MEMBER_CHANNELS.every(ch => sent.some(m => m.bytes[0] === (0xB0 | ch) && m.bytes[1] === 6 && m.bytes[2] === 48)));

sent.length = 0;
player.note(220 * (5 / 4), 10.5, 0.14, { gain: 1 });
const [bendMsg, onMsg, offMsg] = sent;
check('bend is sent BEFORE note-on, so the note never speaks at the wrong pitch even briefly',
  (bendMsg.bytes[0] & 0xF0) === 0xE0 && (onMsg.bytes[0] & 0xF0) === 0x90 && bendMsg.ts <= onMsg.ts);
check('note-on and its bend share one member channel', (bendMsg.bytes[0] & 0x0F) === (onMsg.bytes[0] & 0x0F));
check('a note-off is scheduled for the end of the gate',
  (offMsg.bytes[0] & 0xF0) === 0x80 && offMsg.bytes[1] === onMsg.bytes[1] && Math.abs(offMsg.ts - onMsg.ts - 140) < 1);
// Lookahead correctness: cosmos schedules 0.1s ahead on the AUDIO clock, and Web MIDI timestamps are in
// the performance.now domain. getOutputTimestamp pairs the two at one instant — reading them separately
// would fold the gap between reads into every timestamp.
check('an audio-clock time 0.5s ahead becomes a MIDI timestamp 500ms ahead of the paired reference',
  Math.abs(onMsg.ts - 1500) < 1, `${onMsg.ts.toFixed(1)}ms`);

sent.length = 0;
player.note(220, 10.5, 0.14, { cents: 498.045, gain: 1 });
// Modulation is applied in cosmos as a shared detune SIGNAL, which nothing downstream can read; the
// audio layer folds the glide's value at this note's start into the spelling, or the DAW would play the
// unmodulated sky. 220Hz shifted +498.045¢ is 293.33Hz — MIDI 62 (D4), a fourth up.
check('a modulated note is spelled at the pitch it will actually sound, not at its unshifted pitch',
  sent[1].bytes[1] === 62, `note ${sent[1].bytes[1]}`);

sent.length = 0;
player.velocity = 100;
player.note(220, 10.5, 0.14, { gain: 0.5 });
check('star distance-gain becomes MIDI velocity, so the DAW inherits the spatial mix',
  sent[1].bytes[2] === 50, `velocity ${sent[1].bytes[2]}`);

sent.length = 0;
const held = player.noteOn(220, 10.5, {});
const afterNoteOn = sent.length;      // the noteOn's own bend + note-on
player.retune(() => 100, 1);
const retuneMsgs = sent.slice(afterNoteOn);
check('a modulation glide bends sustained voices in place and never retriggers them',
  retuneMsgs.length > 0 && retuneMsgs.every(m => (m.bytes[0] & 0xF0) === 0xE0),
  `${retuneMsgs.length} bends, ${retuneMsgs.filter(m => (m.bytes[0] & 0xF0) === 0x90).length} note-ons`);
// Modulation is global — every voice still sounding bends, not just the newest.
check('every live channel is bent, since the modulation shifts the whole sky',
  new Set(retuneMsgs.map(m => m.bytes[0] & 0x0F)).size === player.live.size &&
  retuneMsgs.some(m => (m.bytes[0] & 0x0F) === held.channel),
  `${new Set(retuneMsgs.map(m => m.bytes[0] & 0x0F)).size} channels of ${player.live.size} live`);
check('the bends are spread across the glide, not dumped at one instant',
  new Set(retuneMsgs.map(m => Math.round(m.ts))).size > 4);

sent.length = 0;
player.allNotesOff();
check('panic sends a real note-off AND All Notes Off, so nothing can hang in the DAW',
  sent.some(m => (m.bytes[0] & 0xF0) === 0x80) && sent.some(m => m.bytes[1] === 123) && player.live.size === 0);

console.log(PASS ? '\n✓✓✓ COSMOS MIDI OUT PASSES' : '\n✗ COSMOS MIDI OUT FAILED');
process.exit(PASS ? 0 : 1);
