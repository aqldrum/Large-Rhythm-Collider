// cosmos-midi-out.js — streams the cosmos sky out over Web MIDI in exact just intonation, so a DAW
// (Ableton) plays the same tuning the browser does. MPE by default: every sounding note gets a private
// member channel and a private pitch bend, which is what keeps near-unison JI neighbours audible as
// separate pitches instead of collapsing onto one MIDI note number.
//
// This deliberately does NOT import Playback/MIDIOut.js. cosmos-audio.js's hard rule forbids it, and
// there is a correctness reason underneath the rule: that singleton derives its timestamps from
// `window.toneRowPlayback.audioContext`, a DIFFERENT AudioContext with a different time origin than the
// cosmos one. Sharing it would mis-time every message. The wire conventions below are deliberately
// identical to that module and to Playback/MIDIOUT_SPEC.md — nearest MIDI note plus per-channel bend,
// bend sent BEFORE note-on, ±48 semitone range via RPN 0, MPE Configuration Message via RPN 6 — so a
// DAW template set up for the main site receives the cosmos exactly the same way.

export const MIDI_BEND_RANGE_SEMITONES = 48;   // MPE convention; 14-bit over ±48 resolves 0.586¢/step,
                                  // far under the 3–5¢ JND, and leaves headroom for modulation bends
export const MIDI_MASTER_CHANNEL = 0;          // MPE master (channel 1); members are channels 2–16
export const MIDI_MEMBER_CHANNELS = Array.from({ length: 15 }, (_, i) => i + 1);
export const MIDI_DEFAULT_VELOCITY = 96;
const MIDI_MIN_NOTE_MS = 10;      // never emit a zero-length note
const MIDI_RETUNE_STEPS = 12;     // bend updates emitted across a modulation glide for still-sounding notes

// Prefer the user's virtual bus. macOS IAC is the rig here; loopMIDI is the Windows equivalent. Falls
// back to the first available output so a different setup still works without touching code.
const PREFERRED_PORT = /\b(IAC|loopMIDI)\b/i;

// ── pure tuning math (exported for the headless guard — no MIDI access required) ────────────────
export const freqToMidiFloat = hz => 69 + 12 * Math.log2(hz / 440);

// Nearest MIDI note + the bend that corrects the remainder. ±50¢ assignment (Math.round), matching the
// site's .tun/.scl/MIDI-export convention: a tone 49¢ under a note bends down to it rather than being
// spelled as the semitone below with a +51¢ bend.
export function noteAndBend(hz, bendRange = MIDI_BEND_RANGE_SEMITONES) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const midiFloat = freqToMidiFloat(hz);
  const note = Math.min(127, Math.max(0, Math.round(midiFloat)));
  return { note, bend: bendFromSemitones(midiFloat - note, bendRange) };
}

export function bendFromSemitones(semitones, bendRange = MIDI_BEND_RANGE_SEMITONES) {
  const range = Math.max(1, bendRange);
  return Math.min(16383, Math.max(0, Math.round(8192 + (semitones / range) * 8192)));
}

// Round-robin over the member pool, skipping channels with a live note; if every member is busy, steal
// the round-robin one. Pure so the allocation policy can be verified without a MIDI device: returns the
// chosen channel and the entry it displaced (which the caller must note-off before reusing the channel).
export function allocateMemberChannel(pool, liveByChannel, cursor) {
  if (!pool.length) return null;
  for (let i = 0; i < pool.length; i++) {
    const index = (cursor + i) % pool.length;
    if (!liveByChannel.has(pool[index])) return { channel: pool[index], cursor: (index + 1) % pool.length, stolen: null };
  }
  const index = cursor % pool.length;
  return { channel: pool[index], cursor: (index + 1) % pool.length, stolen: liveByChannel.get(pool[index]) || null };
}

export class CosmosMidiOut {
  // context: the COSMOS AudioContext — its clock is the one every scheduled time here is expressed in.
  constructor(context) {
    this.ctx = context;
    this.supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
    this.access = null;
    this.output = null;
    this.enabled = false;
    this.velocity = MIDI_DEFAULT_VELOCITY;
    this.live = new Map();          // channel -> { note, baseHz, offTimer }
    this.cursor = 0;
    this.stats = { notes: 0, steals: 0, dropped: 0 };
  }

  get portName() { return this.output?.name || null; }

  async enable() {
    if (!this.supported) return { ok: false, reason: 'Web MIDI is unavailable in this browser' };
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return { ok: false, reason: 'MIDI access was refused' };
    }
    const outputs = [...this.access.outputs.values()];
    this.output = outputs.find(port => PREFERRED_PORT.test(port.name || '')) || outputs[0] || null;
    if (!this.output) return { ok: false, reason: 'no MIDI output — create an IAC Driver bus in Audio MIDI Setup' };
    this.enabled = true;
    this._configureMpe();
    return { ok: true, port: this.output.name };
  }

  disable() {
    this.allNotesOff();
    this.enabled = false;
    this.output = null;
  }

  // MPE Configuration Message (RPN 6) on the master, then the ±48 bend range (RPN 0) on every member,
  // so a compliant receiver self-configures instead of needing the range dialled in by hand.
  _configureMpe() {
    const ts = performance.now();
    this._send([0xB0 | MIDI_MASTER_CHANNEL, 101, 0], ts);
    this._send([0xB0 | MIDI_MASTER_CHANNEL, 100, 6], ts);
    this._send([0xB0 | MIDI_MASTER_CHANNEL, 6, MIDI_MEMBER_CHANNELS.length], ts);
    for (const channel of MIDI_MEMBER_CHANNELS) {
      this._send([0xB0 | channel, 101, 0], ts);
      this._send([0xB0 | channel, 100, 0], ts);
      this._send([0xB0 | channel, 6, MIDI_BEND_RANGE_SEMITONES], ts);
      this._send([0xB0 | channel, 38, 0], ts);
      this._send([0xB0 | channel, 101, 127], ts);
      this._send([0xB0 | channel, 100, 127], ts);
    }
  }

  _send(bytes, ts) {
    if (!this.output) return;
    try { this.output.send(bytes, ts); } catch { /* a port can vanish mid-session; never break audio */ }
  }

  // The cosmos audio clock → the Web MIDI (performance.now) clock. getOutputTimestamp pairs the two
  // domains at a single instant, which is the only way to convert a LOOKAHEAD-scheduled time correctly;
  // reading both clocks separately would fold the gap between the two reads into every timestamp.
  audioTimeToMidiTs(audioTime) {
    if (!this.ctx || !Number.isFinite(audioTime)) return performance.now();
    let perfRef = performance.now(), ctxRef = this.ctx.currentTime;
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp && Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime)) {
      perfRef = stamp.performanceTime; ctxRef = stamp.contextTime;
    }
    return perfRef + (audioTime - ctxRef) * 1000;
  }

  // One gated note: bend, then note-on, then a note-off at the end of the gate. `cents` is the live
  // modulation offset AT THIS NOTE'S START — cosmos applies modulation as a shared detune signal rather
  // than by recomputing frequencies, so it has to be folded back in here or the DAW plays the unmodulated
  // sky. Because a row note is far shorter than a modulation glide, tracing the glide note-by-note is
  // exactly right: no per-note bend ramp is needed, the sequence of notes IS the portamento.
  noteOn(hz, whenAudio, { cents = 0, gain = 1 } = {}) {
    if (!this.enabled || !this.output) return null;
    const spelled = noteAndBend(hz * 2 ** (cents / 1200));
    if (!spelled) return null;
    const allocation = allocateMemberChannel(MIDI_MEMBER_CHANNELS, this.live, this.cursor);
    if (!allocation) { this.stats.dropped++; return null; }
    const ts = Math.max(performance.now(), this.audioTimeToMidiTs(whenAudio));
    if (allocation.stolen) {
      this._send([0x80 | allocation.channel, allocation.stolen.note, 0], ts);
      clearTimeout(allocation.stolen.offTimer);
      allocation.stolen.released = true;
      this.stats.steals++;
    }
    this.cursor = allocation.cursor;
    const velocity = Math.min(127, Math.max(1, Math.round(this.velocity * Math.min(1, Math.max(0, gain)))));
    this._send([0xE0 | allocation.channel, spelled.bend & 0x7F, (spelled.bend >> 7) & 0x7F], ts);
    this._send([0x90 | allocation.channel, spelled.note, velocity], ts);
    this.stats.notes++;
    const entry = { channel: allocation.channel, note: spelled.note, baseHz: hz, onTs: ts, offTimer: null, released: false };
    this.live.set(allocation.channel, entry);
    return entry;
  }

  noteOff(entry, whenAudio) {
    if (!entry || entry.released) return;
    entry.released = true;
    clearTimeout(entry.offTimer);
    const ts = Math.max(entry.onTs + MIDI_MIN_NOTE_MS, this.audioTimeToMidiTs(whenAudio));
    this._send([0x80 | entry.channel, entry.note, 0], ts);
    // The scheduled off is authoritative for the DAW; the timer only frees the channel for reuse at the
    // same moment, so the allocator's idea of "busy" matches what the receiver actually hears.
    entry.offTimer = setTimeout(() => { if (this.live.get(entry.channel) === entry) this.live.delete(entry.channel); },
      Math.max(0, ts - performance.now()));
  }

  // One gated note — the row and lead voices, whose length is known at scheduling time.
  note(hz, whenAudio, durationSeconds, options = {}) {
    const entry = this.noteOn(hz, whenAudio, options);
    if (entry) this.noteOff(entry, whenAudio + Math.max(MIDI_MIN_NOTE_MS / 1000, durationSeconds));
    return entry;
  }

  // A modulation glide retunes tones that are ALREADY sounding. Short row notes need nothing (they are
  // over before the glide is), but a sustained bed voice would sit at its old pitch for seconds while
  // the browser glided underneath it. Emit a bend ramp per live channel across the glide, bent from each
  // note's ORIGINAL base note number so the note itself never has to be retriggered — the ±48 range
  // covers any modulation, which is at most a tritone.
  retune(centsAt, glideSeconds) {
    if (!this.enabled || !this.output || !this.live.size) return;
    const start = performance.now();
    const steps = Math.max(1, Math.round(MIDI_RETUNE_STEPS));
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps;
      const ts = start + fraction * glideSeconds * 1000;
      const cents = centsAt(fraction * glideSeconds);
      for (const [channel, entry] of this.live) {
        const semitones = freqToMidiFloat(entry.baseHz * 2 ** (cents / 1200)) - entry.note;
        const bend = bendFromSemitones(semitones);
        this._send([0xE0 | channel, bend & 0x7F, (bend >> 7) & 0x7F], ts);
      }
    }
  }

  allNotesOff() {
    const ts = performance.now();
    for (const [channel, entry] of this.live) {
      clearTimeout(entry.offTimer);
      this._send([0x80 | channel, entry.note, 0], ts);
      this._send([0xB0 | channel, 123, 0], ts);   // All Notes Off, so nothing can hang in the DAW
    }
    this.live.clear();
  }

  debugState() {
    return { enabled: this.enabled, supported: this.supported, port: this.portName, live: this.live.size, ...this.stats };
  }
}
