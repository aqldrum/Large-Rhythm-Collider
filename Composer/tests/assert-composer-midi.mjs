// assert-composer-midi.mjs — the Composer's MIDI out (Composer/perform/composer-midi.js and its hooks in
// composer-player.js; Composer/CLEAN_MIDI_ORDER.md phase B), against recording ports and a mock AudioContext:
//   • the tuning math is the Cosmos sender's (and so the site's), note for note and bend for bend
//   • the routing: a bus per part, every tonal bus an MPE zone (master 1): the one-note parts on 2, the chords and
//     (COMP_ARP_ORDER.md A3) the comp's voices on 2–5, the drums on 10 with General MIDI notes; RPN 0 and the zone's
//     RPN 6 sent when the ports are set
//   • the comp in chords (the default compStyle): its voices on 2–5, no channel holding two notes, a borrowed tone
//     sent at its own hz (the source voice's tone), not its onset's
//   • a note: its bend before its note-on; a note its channel holds ends first; velocity 1–127
//   • midiNotesOf: the same with legato on or off; a voice's notes never overlap; the last ends by the cycle's end
//   • the player: every note of every part booked once a cycle on its own channel, no channel holding two notes,
//     the drums' strokes, the clock at 24 a quarter following a live tempo, Start at play, Stop and All Notes Off at
//     stop, the voices silenced by localSound(false) while the MIDI goes on
//   node Composer/tests/assert-composer-midi.mjs
import { readFileSync } from 'node:fs';
import { compose, rearticulate } from '../core/compose.js';
import { createPlayer } from '../perform/composer-player.js';
import { readMidi, writeMidi } from '../core/midi.js';
import { createComposerMidi, midiNotesOf, midiFileOf, setupBytes, matchPort, noteAndBend, bendFromSemitones, channelOf, velocityOf, MIDI_PARTS, GM_DRUMS, CHORD_MEMBERS, COMP_MEMBERS, DRUM_CHANNEL, DRUM_NOTE_MS } from '../perform/composer-midi.js';
import { buildRow, ONSET_GATE } from '../core/row.js';
import * as cosmos from '../../Cosmos/audio/cosmos-midi-out.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const recorder = (name) => { const sent = []; return { name, id: name, sent, send(bytes, ts) { sent.push({ bytes: [...bytes], ts }); } }; };
const kind = (b) => b[0] & 0xF0, chan = (b) => b[0] & 0x0F;

console.log('Composer MIDI out');
console.log('\n— the boundary and the tuning');
const code = readFileSync(new URL('../perform/composer-midi.js', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('the sender uses neither the site\'s MIDIOut nor a global MIDI access', !/Playback\//.test(code) && !code.includes('lrcMidiOut') && !code.includes('requestMIDIAccess'));
let same = true;
for (let hz = 20; hz < 8000; hz *= 1.0137) {
  const a = noteAndBend(hz), b = cosmos.noteAndBend(hz);
  if (a.note !== b.note || a.bend !== b.bend) { same = false; break; }
}
check('noteAndBend: the Cosmos sender\'s, note for note and bend for bend, 20 Hz–8 kHz', same && bendFromSemitones(0.5) === cosmos.bendFromSemitones(0.5));
check('±50¢: a tone 49¢ under a note bends down onto it', noteAndBend(220 * 2 ** (1151 / 1200)).note === 69 && noteAndBend(220 * 2 ** (1151 / 1200)).bend < 8192);
check('velocity: 1–127, never 0', velocityOf(0) === 1 && velocityOf(1) === 127 && velocityOf(0.5) === 64 && velocityOf(2) === 127);
check('channels: one-note parts on 2, chord and comp voices on 2–5, drums on 10', ['lead', 'bass', 'inner'].every((id) => channelOf(id) === 1) && [0, 1, 2, 3].map((v) => channelOf('chords', v)).join() === '1,2,3,4'
  && [0, 1, 2, 3].map((v) => channelOf('comp', v)).join() === '1,2,3,4' && channelOf('comp') === 1 && channelOf('drums') === 9);
const outs = ['IAC Driver Composer Lead', 'IAC Driver Composer Chords', 'IAC Driver Bus 1', 'Composer Bass', 'composer inner', 'Drums'].map((name) => ({ name }));
check('matchPort: a bus whose name holds the part\'s word', matchPort(outs, 'lead').name === 'IAC Driver Composer Lead' && matchPort(outs, 'chords').name.endsWith('Chords') && matchPort(outs, 'comp') === null && matchPort(outs, 'inner').name === 'composer inner' && matchPort(outs, 'drums').name === 'Drums');

console.log('\n— the sink');
let clockMs = 1000;
const ports = Object.fromEntries(MIDI_PARTS.map((id) => [id, recorder(id)]));
const sink = createComposerMidi({ now: () => clockMs });
sink.setPorts(ports);
check('off until enabled: nothing sent, not active', !sink.active && MIDI_PARTS.every((id) => ports[id].sent.length === 0) && sink.note('lead', 0, 440, 1, 1000) === null);
sink.setEnabled(true);
const rpns = (p) => p.sent.filter((m) => kind(m.bytes) === 0xB0 && m.bytes[1] === 6).map((m) => [chan(m.bytes), m.bytes[2]]);
check('enabled: each one-note bus a zone of one (RPN 6 = 1 on the master), RPN 0 = 48 on channel 2', ['lead', 'bass', 'inner'].every((id) => JSON.stringify(rpns(ports[id])) === '[[0,1],[1,48]]'));
check('… the comp\'s zone (A3): RPN 6 = 4 members on the master, RPN 0 = 48 on each of 2–5', JSON.stringify(rpns(ports.comp)) === JSON.stringify([[0, 4], ...COMP_MEMBERS.map((c) => [c, 48])]));
check('… the chords\' zone: RPN 6 = 4 members on the master, RPN 0 = 48 on each member', JSON.stringify(rpns(ports.chords)) === JSON.stringify([[0, 4], ...CHORD_MEMBERS.map((c) => [c, 48])])
  && ports.chords.sent.some((m) => m.bytes[1] === 100 && m.bytes[2] === 6));
check('… nothing to the drums bus (no bend on 10)', ports.drums.sent.length === 0 && sink.active);
for (const p of Object.values(ports)) p.sent.length = 0;
const h = sink.note('chords', 2, 220 * 5 / 4, 0.5, 2000);
const [bend, on] = ports.chords.sent;
check('a chord voice 3 note: the bend, then the note-on, both on channel 4', kind(bend.bytes) === 0xE0 && kind(on.bytes) === 0x90 && chan(bend.bytes) === 3 && chan(on.bytes) === 3 && bend.ts === 2000 && on.ts === 2000
  && on.bytes[1] === noteAndBend(275).note && ((bend.bytes[2] << 7) | bend.bytes[1]) === noteAndBend(275).bend && on.bytes[2] === 64);
sink.note('chords', 2, 300, 0.5, 2100);
const guard = ports.chords.sent.slice(2);
check('a second note on the same voice ends the first, then bends and starts', kind(guard[0].bytes) === 0x80 && guard[0].bytes[1] === on.bytes[1] && kind(guard[1].bytes) === 0xE0 && kind(guard[2].bytes) === 0x90 && sink.stats.guarded === 1);
sink.off(h, 2200);
check('an off for a note already ended sends nothing more', ports.chords.sent.length === 5);
sink.stroke('kick', 1, 3000); sink.stroke('cym', 0.5, 3000);
const d = ports.drums.sent;
check(`drums: GM ${GM_DRUMS.kick} and ${GM_DRUMS.cym} on channel 10, ${DRUM_NOTE_MS} ms`, d.length === 4 && d.every((m) => chan(m.bytes) === DRUM_CHANNEL) && d[0].bytes[1] === 36 && d[2].bytes[1] === 49 && d[1].ts === 3000 + DRUM_NOTE_MS && kind(d[1].bytes) === 0x80);
const clock = recorder('clock');
sink.setClockPort(clock);
sink.clockStart(4000); sink.clockTick(4000);
for (const p of Object.values(ports)) p.sent.length = 0;
sink.note('lead', 0, 440, 1, 5000);
sink.allOff();
const cc = (p, n) => p.sent.filter((m) => kind(m.bytes) === 0xB0 && m.bytes[1] === n).map((m) => chan(m.bytes));
check('allOff: the live note off, All Sound Off and All Notes Off on every used channel, Stop on the clock', kind(ports.lead.sent[2].bytes) === 0x80 && cc(ports.lead, 123).join() === '0,1'
  && cc(ports.chords, 123).join() === '0,1,2,3,4' && cc(ports.comp, 123).join() === '0,1,2,3,4' && cc(ports.drums, 120).join() === '9' && clock.sent.map((m) => m.bytes[0]).join() === [0xFA, 0xF8, 0xFC].join() && sink.liveNotes === 0);
sink.setPorts({ bass: null });
check('a part with no bus isn\'t sent', !sink.sends('bass') && sink.sends('lead') && sink.note('bass', 0, 100, 1, 6000) === null);
sink.note('lead', 0, 440, 1, 7000); const n0 = ports.lead.sent.length;
sink.setEnabled(false);
check('disabled: the live note ended at once, not active', ports.lead.sent.length > n0 && !sink.active && sink.liveNotes === 0);

console.log('\n— the lengths (M12)');
// the default comp, in chords (COMP_ARP_ORDER.md A3: the Comp bus a zone of four, so the strums no longer stack)
const T = 8, spec = compose([41, 42, 43, 0], T, { seed: 1, worker: true }), ST = spec.knobs.cycleSeconds;
check('the composition\'s comp is in chords: voiced, with strokes and borrowed tones', !!spec.parts.find((p) => p.id === 'comp').strokes && spec.parts.find((p) => p.id === 'comp').notes.some((n) => n.borrowed));
const flip = (p) => rearticulate(p, { legato: !p.legato, cycleSeconds: ST });
check('every part the same with its legato flipped', spec.parts.every((p) => JSON.stringify(midiNotesOf(p, ST)) === JSON.stringify(midiNotesOf(flip(p), ST))));
const lanesOk = spec.parts.every((p) => {
  const ns = midiNotesOf(p, ST), by = new Map();
  for (const n of ns) { if (!by.has(n.voice)) by.set(n.voice, []); by.get(n.voice).push(n); }
  return [...by.values()].every((l) => l.every((n, i) => n.end > n.time - 1e-12 && n.end <= (i + 1 < l.length ? l[i + 1].time : ST) + 1e-9));
});
check('a voice\'s notes never overlap, and the last ends by the cycle\'s end', lanesOk);
check('a held voice\'s note lasts to its next note', (() => { const ns = midiNotesOf(spec.parts.find((p) => p.id === 'inner'), ST); return ns.length > 2 && Math.abs(ns[0].end - ns[1].time) < 1e-9; })());
check('chord voices are 0–3', midiNotesOf(spec.parts.find((p) => p.id === 'chords'), ST).every((n) => n.voice >= 0 && n.voice <= 3));
const compPart = spec.parts.find((p) => p.id === 'comp'), compMidi = midiNotesOf(compPart, ST);
check(`comp voices are 0–3, more than one of them (${[...new Set(compMidi.map((n) => n.voice))].join(', ')})`, compMidi.every((n) => n.voice >= 0 && n.voice <= 3) && new Set(compMidi.map((n) => n.voice)).size > 1);
// a borrowed tone: on the stroke's onset, with the source voice's tone (its `from`); MIDI sends its own hz
const row = buildRow(spec.input.layers, { gate: ONSET_GATE }), ratioOfNode = (i) => row.tones[row.tone[i]];
const borrowed = compPart.notes.filter((n) => n.borrowed), chordNotes = spec.parts.find((p) => p.id === 'chords').notes;
const fromOk = borrowed.every((n) => { const src = chordNotes.find((c) => c.node === n.from); return src && src.ratio === n.ratio && Math.abs(Math.log2(n.hz / src.hz) - Math.round(Math.log2(n.hz / src.hz))) < 1e-9; });
const offTone = borrowed.filter((n) => ratioOfNode(n.node) !== n.ratio);
check(`a borrowed tone (${borrowed.length}) has its source voice's ratio and pitch class; ${offTone.length} of them sit on an onset of another tone`, borrowed.length > 0 && fromOk && offTone.length > 0);
check('… and MIDI sends the note\'s own hz (the source\'s tone), not its onset\'s', offTone.every((n) => compMidi.some((m) => Math.abs(m.time - n.time) < 1e-12 && m.hz === n.hz && m.voice === n.voice)));
const oldComp = compose([41, 42, 43, 0], T, { seed: 1, worker: true, overrides: { compStyle: 'notes' } }).parts.find((p) => p.id === 'comp');
check('the old one-note comp (compStyle \'notes\'): one lane, on channel 2 of its zone', midiNotesOf(oldComp, ST).every((n) => n.voice === 0 && channelOf('comp', n.voice) === 1));

console.log('\n— the .mid file (M11)');
const fparts = spec.parts.map((p) => ({ ...p, enabled: true })), fdrums = { ...spec.drums, enabled: true };
const bytes = midiFileOf(spec, fparts, fdrums), file = readMidi(bytes);
const named = (n) => file.tracks.find((t) => t.name === n);
check(`a track a part, the drums last (${file.tracks.map((t) => t.name || '·').join(', ')})`, ['Lead', 'Chords', 'Comp', 'Bass', 'Inner', 'Drums'].every((n) => named(n)));
check('each track the part\'s MIDI notes, at their pitches, on their channels', fparts.every((p) => {
  const t = named({ lead: 'Lead', chords: 'Chords', comp: 'Comp', bass: 'Bass', inner: 'Inner' }[p.id]), want = midiNotesOf(p, ST);
  const got = [...t.notes].sort((a, b) => a.tick - b.tick || a.channel - b.channel), exp = want.map((n) => ({ pitch: noteAndBend(n.hz).note, channel: channelOf(p.id, n.voice) }));
  return got.length === want.length && got.every((g) => exp.some((e) => e.pitch === g.pitch && e.channel === g.channel));
}) && named('Drums').notes.every((n) => n.channel === DRUM_CHANNEL) && named('Drums').notes.length === spec.drums.hits.length);
const tempo = file.tempos[0];
check(`the spec's tempo (${spec.knobs.tempoBpm} BPM) at 480 a quarter`, file.ppq === 480 && Math.abs(60e6 / tempo.usPerQuarter - spec.knobs.tempoBpm) < 0.01);
const has = (seq) => { for (let i = 0; i + seq.length <= bytes.length; i++) if (seq.every((b, j) => bytes[i + j] === b)) return true; return false; };
check('the chords\' zone set up in the file (RPN 6 = 4 on channel 1, RPN 0 = 48 on 2)', has(setupBytes('chords')[2]) && has([0xB1, 6, 48]));
const compTrack = named('Comp');
check('the comp\'s track (A3): its voices on 2–5, RPN 6 = 4 and RPN 0 = 48 on 2–5 set up', compTrack.notes.length === compMidi.length && compTrack.notes.every((n) => n.channel >= 1 && n.channel <= 4)
  && new Set(compTrack.notes.map((n) => n.channel)).size > 1 && JSON.stringify(setupBytes('comp')) === JSON.stringify(setupBytes('chords')) && [0xB2, 0xB3, 0xB4].every((b) => has([b, 6, 48])));
const tiny = writeMidi({ tracks: [{ notes: [{ tick: 0, end: 10, pitch: 60, velocity: 90, channel: 1, bend: 8192 }, { tick: 10, end: 20, pitch: 60, velocity: 90, channel: 1, bend: 9000 }] }] });
const hasIn = (b, seq) => { for (let i = 0; i + seq.length <= b.length; i++) if (seq.every((x, j) => b[i + j] === x)) return true; return false; };
check('the writer: a note\'s bend just before its note-on, after the note-off at the same tick', hasIn(tiny, [0xE1, 0x00, 0x40, 0x00, 0x91, 60, 90]) && hasIn(tiny, [0x0A, 0x81, 60, 0, 0x00, 0xE1, 9000 & 0x7F, 9000 >> 7, 0x00, 0x91, 60, 90]));
check('legato flipped: the same file', JSON.stringify([...midiFileOf(spec, fparts.map((p) => ({ ...flip(p), enabled: true })), fdrums)]) === JSON.stringify([...bytes]));

console.log('\n— the player');
function makeCtx() {
  const param = (value) => { const p = { value, targets: [] }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime']) p[m] = () => p; p.setTargetAtTime = (v) => { p.targets.push(v); return p; }; return p; };
  const node = (extra = {}) => ({ outs: [], connect(d) { this.outs.push(d); return d; }, disconnect() {}, ...extra });
  return {
    currentTime: 0, sampleRate: 48000, state: 'running', resume() {}, destination: node(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ frequency: param(350), Q: param(1), detune: param(0), gain: param(0) }),
    createDynamicsCompressor: () => node({ threshold: param(0), knee: param(0), ratio: param(1), attack: param(0), release: param(0) }),
    createOscillator: () => node({ frequency: param(440), detune: param(0), setPeriodicWave() {}, start() {}, stop() {} }),
    createBufferSource: () => node({ start() {}, stop() {} }), createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createPeriodicWave: () => ({}),
  };
}
const ctx = makeCtx();
const now = () => ctx.currentTime * 1000;
const pp = Object.fromEntries(MIDI_PARTS.map((id) => [id, recorder(id)])), pclock = recorder('clock');
const msink = createComposerMidi({ now });
msink.setPorts(pp); msink.setClockPort(pclock); msink.setEnabled(true);
for (const p of Object.values(pp)) p.sent.length = 0;
const parts = spec.parts.map((p) => ({ ...p, enabled: true }));
const drums = { ...spec.drums, enabled: true, kit: { kick: 'made:kick', snare: 'made:snare', hat: 'made:hihat', perc: 'made:perc', cym: 'made:cym' } };
const player = createPlayer({ ctx, timers: {}, midi: msink, now });
for (const id of [...MIDI_PARTS]) player.setLevel(id, 1);
player.play(spec, () => parts, () => drums);
const run = (seconds) => { const end = ctx.currentTime + seconds; while (ctx.currentTime < end) { ctx.currentTime += 0.025; player.tick(); } };
run(ST * 2 + 0.3);   // two whole cycles booked
const ons = (p) => p.sent.filter((m) => kind(m.bytes) === 0x90 && m.bytes[2] > 0);
const counts = parts.filter((p) => p.id !== 'drums').map((p) => [p.id, ons(pp[p.id]).length, midiNotesOf(p, ST).length]);
check(`every note of every part, once a cycle (${counts.map(([id, got, n]) => `${id} ${got}/${2 * n}`).join(', ')})`, counts.every(([, got, n]) => got >= 2 * n && got <= 2 * n + n));
check('the one-note parts on channel 2, the chords and the comp\'s voices on 2–5', ['lead', 'bass', 'inner'].every((id) => ons(pp[id]).every((m) => chan(m.bytes) === 1))
  && ['chords', 'comp'].every((id) => ons(pp[id]).every((m) => chan(m.bytes) >= 1 && chan(m.bytes) <= 4) && new Set(ons(pp[id]).map((m) => chan(m.bytes))).size > 1));
const noOverlap = MIDI_PARTS.filter((id) => id !== 'drums').every((id) => {
  const evs = pp[id].sent.filter((m) => kind(m.bytes) === 0x90 || kind(m.bytes) === 0x80).map((m, i) => ({ ...m, i })).sort((a, b) => a.ts - b.ts || a.i - b.i), held = new Map();
  for (const e of evs) {
    const c = chan(e.bytes);
    if (kind(e.bytes) === 0x90) { if (held.get(c)) return false; held.set(c, e.bytes[1]); } else if (held.get(c) === e.bytes[1]) held.delete(c);
  }
  return true;
});
check('no channel ever holds two notes (each off before the next on)', noOverlap && msink.stats.guarded === 0);
check('every note-on follows its bend at the same time', MIDI_PARTS.filter((id) => id !== 'drums').every((id) => pp[id].sent.every((m, i, a) => kind(m.bytes) !== 0x90 || (kind(a[i - 1].bytes) === 0xE0 && a[i - 1].ts === m.ts && chan(a[i - 1].bytes) === chan(m.bytes)))));
const hitsPer = spec.drums.hits.length;
check(`the drums' strokes, twice (${ons(pp.drums).length} of ${2 * hitsPer})`, ons(pp.drums).length >= 2 * hitsPer && ons(pp.drums).every((m) => chan(m.bytes) === DRUM_CHANNEL));
const ticks = pclock.sent.filter((m) => m.bytes[0] === 0xF8), bpm = spec.knobs.tempoBpm;
const dtMs = 60000 / bpm / 24;
check(`Start, then the clock at 24 a quarter of ${bpm.toFixed(1)} BPM (${ticks.length} ticks, ${dtMs.toFixed(2)} ms apart)`, pclock.sent[0].bytes[0] === 0xFA
  && Math.abs(pclock.sent[0].ts - ticks[0].ts) < 1e-6 && ticks.slice(1, 50).every((t, i) => Math.abs(t.ts - ticks[i].ts - dtMs) < 1e-6) && ticks.length === Math.ceil((player.booked - player.loopStart) / (dtMs / 1000) - 1e-9));
const before = ticks.length;
player.setTimeFactor(2);   // half the tempo
run(2);
const later = pclock.sent.filter((m) => m.bytes[0] === 0xF8).slice(before + 10, before + 20);
check('a live tempo change: the clock follows (ticks twice as far apart at half the tempo)', later.length === 10 && later.slice(1).every((t, i) => Math.abs(t.ts - later[i].ts - 2 * dtMs) < 1e-6));
player.localSound(false);
check('localSound(false): the master goes to 0, the MIDI goes on', player.master.gain.targets.at(-1) === 0 && !player.local);
const n1 = ons(pp.lead).length + ons(pp.chords).length; run(ST);
check('… notes still booked meanwhile', ons(pp.lead).length + ons(pp.chords).length > n1);
player.stop();
check('stop: Stop on the clock, All Notes Off on every bus, nothing left held', pclock.sent.at(-1).bytes[0] === 0xFC && MIDI_PARTS.every((id) => cc(pp[id], 123).length >= 1) && msink.liveNotes === 0);

console.log('\n— the player without MIDI');
const ctx2 = makeCtx(), plain = createPlayer({ ctx: ctx2, timers: {} });
plain.play(spec);
for (let i = 0; i < 40; i++) { ctx2.currentTime += 0.025; plain.tick(); }
plain.stop();
check('no sink: plays and stops as before', !plain.playing);

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
