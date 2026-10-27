// midi.js — a minimal Standard MIDI File reader and writer, and the grid decode that turns a clip into steps (MIDI
// targets, phase A1: Composer/TARGET_ORDER.md; ported from probe/midi-target/midi.mjs, whose decode is verified there).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. Bytes in, objects out (and back).
//
//   readMidi   SMF format 0 or 1: the header's ticks per quarter (PPQ), every track's notes (note-on with velocity 0 is
//              a note-off; running status kept), the tempo map (FF 51) and time signatures (FF 58). SMPTE time division
//              and sysex are read past, not interpreted.
//   writeMidi  format 1: a conductor track (tempo, time signature) and one note track per part. The tests author their
//              clips with it, so the reader is exercised on real files.
//   decodeClip the lead of a clip on its own grid:
//                skyline   the highest note at each start tick, each cut at the next start (a monophonic line). A clip
//                          with overlapping notes is read as its top line, not refused; `dropped` counts the notes it
//                          left out (P1, proposed: "chords reduced to their top note: n notes dropped").
//                grid      the coarsest subdivision of the quarter that explains every note-on within ONSET_TOLERANCE
//                          quarters AND within EXACT_SHARE of its own step (the probe's fix: an absolute tolerance alone
//                          lets a fine enough grid explain anything). None does (an unquantized performance): a GUESS,
//                          the coarsest subdivision with every note-on within UNQUANTIZED_SHARE of its step, flagged
//                          `exact: false`. Real performances need beat tracking; v1 is scoped to quantized clips.
//                steps     steps a bar from the time signature, the bars the clip spans, and each note's step and
//                          note-off step (`until`). Rests are the steps between a note's note-off and the next note-on;
//                          nothing else records them. Two note-ons rounded onto one step: the higher is kept (a grace
//                          the grid cannot hold), and it counts as dropped too.
//                tempo     the first tempo event (`tempoBpm`, 120 when there is none): a target composition's playback
//                          tempo is seeded from it (decided, Avery: ruling 1).
//                key       Krumhansl–Kessler, duration-weighted: weak on short tunes (the probe: Ode to Joy reads as F#
//                          minor), so the window offers a 12-way override (P5). Matching never depends on it.

const fail = (what) => { throw new Error(`composer/midi: ${what}`); };

export const COMPOSER_MIDI_VERSION = 'composer-midi-v1';

// ── reading ──

function reader(bytes) {
  let p = 0;
  return {
    get pos() { return p; }, set pos(v) { p = v; },
    u8: () => { if (p >= bytes.length) fail('unexpected end of file'); return bytes[p++]; },
    u16: () => { if (p + 2 > bytes.length) fail('unexpected end of file'); const v = (bytes[p] << 8) | bytes[p + 1]; p += 2; return v; },
    u32: () => { if (p + 4 > bytes.length) fail('unexpected end of file'); const v = ((bytes[p] << 24) >>> 0) + ((bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]); p += 4; return v; },
    tag: () => { if (p + 4 > bytes.length) fail('unexpected end of file'); const s = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]); p += 4; return s; },
    vlq() { let v = 0; for (let i = 0; i < 4; i++) { const b = this.u8(); v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } return fail('variable-length quantity past 4 bytes'); },
    slice: (n) => { const s = bytes.subarray(p, p + n); p += n; return s; },
  };
}

/**
 * A Standard MIDI File, parsed.
 * → { format, ppq, tracks: [{ name, notes: [{ tick, end, pitch, velocity, channel }] }], tempos: [{ tick, usPerQuarter }],
 *     timeSigs: [{ tick, num, den }] }
 */
export function readMidi(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const r = reader(bytes);
  if (r.tag() !== 'MThd') fail('not a MIDI file (no MThd)');
  const hlen = r.u32(), format = r.u16(), ntrk = r.u16(), division = r.u16();
  r.pos = 8 + hlen;
  if (division & 0x8000) fail('SMPTE time division is not supported');
  if (format > 1) fail(`format ${format} is not supported`);
  if (!(division > 0)) fail('no ticks per quarter');
  const out = { format, ppq: division, tracks: [], tempos: [], timeSigs: [] };
  for (let t = 0; t < ntrk && r.pos < bytes.length; t++) {
    const tag = r.tag(), len = r.u32(), endAt = r.pos + len;
    if (tag !== 'MTrk') { r.pos = endAt; t--; continue; }   // an unknown chunk is skipped, not counted
    const track = { name: '', notes: [] }, open = new Map();   // channel·128 + pitch → [note-on stack]
    let tick = 0, status = 0;
    while (r.pos < endAt) {
      tick += r.vlq();
      const b = r.u8();
      if (b === 0xff) {
        const type = r.u8(), n = r.vlq(), data = r.slice(n);
        if (type === 0x2f) break;
        if (type === 0x03) track.name = String.fromCharCode(...data);
        if (type === 0x51 && n === 3) out.tempos.push({ tick, usPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2] });
        if (type === 0x58 && n >= 2) out.timeSigs.push({ tick, num: data[0], den: 2 ** data[1] });
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { r.slice(r.vlq()); continue; }
      let d1;
      if (b & 0x80) { status = b; d1 = r.u8(); } else { if (!status) fail('running status with no status'); d1 = b; }
      const kind = status & 0xf0, ch = status & 0x0f;
      const two = kind !== 0xc0 && kind !== 0xd0, d2 = two ? r.u8() : 0;
      const key = ch * 128 + d1;
      if (kind === 0x90 && d2 > 0) {
        if (!open.has(key)) open.set(key, []);
        open.get(key).push({ tick, end: null, pitch: d1, velocity: d2, channel: ch });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const stack = open.get(key);
        if (stack?.length) { const n = stack.shift(); n.end = tick; track.notes.push(n); }
      }
    }
    for (const stack of open.values()) for (const n of stack) { n.end = tick; track.notes.push(n); }   // unterminated: to the track's end
    track.notes.sort((a, b) => a.tick - b.tick || b.pitch - a.pitch);
    r.pos = endAt;
    out.tracks.push(track);
  }
  out.tempos.sort((a, b) => a.tick - b.tick);
  out.timeSigs.sort((a, b) => a.tick - b.tick);
  return out;
}

// ── writing ──

function vlqBytes(v) {
  const out = [v & 0x7f];
  while ((v = Math.floor(v / 128)) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
}
const u32Bytes = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const chunk = (tag, body) => [...tag].map((c) => c.charCodeAt(0)).concat(u32Bytes(body.length), body);

/**
 * A Standard MIDI File, written (format 1: track 0 is the conductor).
 *   opts { ppq = 480, bpm = 120, timeSig: [num, den] = [4, 4], tracks: [{ name, notes: [{ tick, end, pitch, velocity = 90, channel = 0, bend }], events }] }
 *   bend     a note's pitch bend (0–16383), sent on its channel just before its note-on (the Composer's MIDI out, phase B)
 *   events   [{ tick, bytes }] more channel messages, before the notes at the same tick (an RPN set-up at 0)
 * → Uint8Array
 */
export function writeMidi({ ppq = 480, bpm = 120, timeSig = [4, 4], tracks }) {
  const us = Math.round(60e6 / bpm), [num, den] = timeSig;
  const conductor = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x58, 4, num, Math.log2(den), 24, 8, 0, 0xff, 0x2f, 0];
  const chunks = [chunk('MTrk', conductor)];
  for (const t of tracks) {
    const ev = (t.events ?? []).map((e) => ({ tick: e.tick, order: -1, bytes: e.bytes }));
    for (const n of t.notes) {
      const ch = n.channel ?? 0;
      if (n.bend != null) ev.push({ tick: n.tick, order: 1, bytes: [0xe0 | ch, n.bend & 0x7f, (n.bend >> 7) & 0x7f] });
      ev.push({ tick: n.tick, order: 2, bytes: [0x90 | ch, n.pitch, n.velocity ?? 90] });
      ev.push({ tick: n.end, order: 0, bytes: [0x80 | ch, n.pitch, 0] });   // a note-off before a bend and a note-on at the same tick
    }
    ev.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const body = [];
    if (t.name) body.push(0, 0xff, 0x03, ...vlqBytes(t.name.length), ...[...t.name].map((c) => c.charCodeAt(0) & 0x7f));
    let last = 0;
    for (const e of ev) { body.push(...vlqBytes(e.tick - last), ...e.bytes); last = e.tick; }
    body.push(0, 0xff, 0x2f, 0);
    chunks.push(chunk('MTrk', body));
  }
  const head = chunk('MThd', [0, 1, 0, chunks.length, (ppq >> 8) & 255, ppq & 255]);
  return Uint8Array.from(head.concat(...chunks));
}

// ── the grid decode ──

/** subdivisions of the quarter the decode tries, coarsest first */
export const SUBDIVISIONS = Object.freeze([1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48]);
/** how far (in quarters) a note-on may sit from its grid step and still be read as on it */
export const ONSET_TOLERANCE = 0.05;
/** …and within this share of its own step (an absolute tolerance alone lets a fine enough grid explain anything) */
export const EXACT_SHARE = 0.15;
/** an unquantized clip's guess: the share of its own step a note-on may sit from it */
export const UNQUANTIZED_SHARE = 0.3;
const PC_NAMES = Object.freeze(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);
/** a pitch class's name (flats where the probe spelled them) */
export const pcName = (pc) => PC_NAMES[((pc % 12) + 12) % 12];

/** the lead: the highest note at each start tick, each cut at the next start (a monophonic line) */
export function skyline(notes) {
  const byTick = new Map();
  for (const n of notes) { const h = byTick.get(n.tick); if (!h || n.pitch > h.pitch) byTick.set(n.tick, n); }
  const line = [...byTick.values()].sort((a, b) => a.tick - b.tick).map((n) => ({ ...n }));
  for (let i = 0; i + 1 < line.length; i++) if (line[i].end > line[i + 1].tick) line[i].end = line[i + 1].tick;
  return line;
}

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/**
 * Krumhansl–Kessler key profiles, correlated with the clip's duration-weighted pitch classes: the tonic and mode that
 * correlate best. notes [{ pc, step, until }] → { tonic (pc), mode: 'major' | 'minor', r }
 */
export function estimateKey(notes) {
  const w = new Array(12).fill(0);
  for (const n of notes) w[n.pc] += Math.max(1, n.until - n.step);
  const corr = (prof, tonic) => {
    const x = w, y = Array.from({ length: 12 }, (_, i) => prof[(i - tonic + 12) % 12]);
    const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < 12; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  let best = { tonic: 0, mode: 'major', r: -Infinity };
  for (let t = 0; t < 12; t++) for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
    const r = corr(prof, t);
    if (r > best.r + 1e-12) best = { tonic: t, mode, r };
  }
  return best;
}

/**
 * A parsed file (readMidi) → the clip on its own grid.
 *   opts { track (index; default: the first with notes), tolerance (quarters; default ONSET_TOLERANCE) }
 * → { version, name, ppq, bpm, tempoBpm (= bpm: the file's first tempo, 120 when none), timeSig: [num, den],
 *     d (steps per quarter), S (steps per bar), B (bars), pickup (steps before the first note in its bar),
 *     residual (largest note-on error, quarters), exact (every note-on within tolerance; false: the grid is a guess),
 *     notes: [{ step, until, midi, pc, velocity }], dropped (notes of the track not in the line: chords' lower notes
 *     and graces), key: { tonic, mode, r }, stepSeconds }
 */
export function decodeClip(file, { track = null, tolerance = ONSET_TOLERANCE } = {}) {
  const tr = track != null ? file.tracks[track] : file.tracks.find((t) => t.notes.length);
  if (!tr?.notes.length) fail('no notes');
  const line = skyline(tr.notes), ppq = file.ppq;
  const ts = file.timeSigs[0] ?? { num: 4, den: 4 }, tempo = file.tempos[0]?.usPerQuarter ?? 500000;
  const errAt = (tick, d) => { const q = tick / ppq, s = Math.round(q * d); return Math.abs(q - s / d); };
  let d = null, residual = Infinity;
  for (const cand of SUBDIVISIONS) {
    let worst = 0;
    for (const n of line) worst = Math.max(worst, errAt(n.tick, cand));
    if (worst <= tolerance + 1e-12 && worst * cand <= EXACT_SHARE + 1e-12) { d = cand; residual = worst; break; }
    if (worst < residual) residual = worst;
  }
  const exact = d != null;
  if (!exact) {   // nothing within tolerance (an unquantized performance): a GUESS — the coarsest subdivision whose every
    // note-on is within UNQUANTIZED_SHARE of its own step (a finer grid always errs less, so "least error" would pick the finest)
    d = SUBDIVISIONS[SUBDIVISIONS.length - 1];
    for (const cand of SUBDIVISIONS) {
      let worst = 0; for (const n of line) worst = Math.max(worst, errAt(n.tick, cand));
      if (worst * cand <= UNQUANTIZED_SHARE) { d = cand; break; }
    }
    residual = 0; for (const n of line) residual = Math.max(residual, errAt(n.tick, d));
  }
  const S = Math.round((d * ts.num * 4) / ts.den);
  if (!(S >= 1 && (d * ts.num * 4) % ts.den === 0)) fail(`a bar of ${ts.num}/${ts.den} is not a whole number of 1/${d}-quarter steps`);
  const toStep = (tick) => Math.round((tick / ppq) * d);
  const raw = line.map((n) => ({ on: toStep(n.tick), off: Math.max(toStep(n.tick) + 1, toStep(n.end)), midi: n.pitch, velocity: n.velocity }));
  // two note-ons rounded onto one step: the later is a grace the grid cannot hold; keep the higher
  const merged = [];
  for (const n of raw) { const last = merged[merged.length - 1]; if (last && last.on === n.on) { if (n.midi > last.midi) merged[merged.length - 1] = n; } else merged.push(n); }
  for (let i = 0; i + 1 < merged.length; i++) if (merged[i].off > merged[i + 1].on) merged[i].off = merged[i + 1].on;
  const bar0 = Math.floor(merged[0].on / S), origin = bar0 * S;
  const notes = merged.map((n) => ({ step: n.on - origin, until: n.off - origin, midi: n.midi, pc: n.midi % 12, velocity: n.velocity }));
  const B = Math.ceil(notes[notes.length - 1].until / S);
  const bpm = 60e6 / tempo;
  const clip = {
    version: COMPOSER_MIDI_VERSION, name: tr.name || 'clip', ppq, bpm, tempoBpm: bpm, timeSig: [ts.num, ts.den], d, S, B, pickup: notes[0].step, residual, exact, notes,
    dropped: tr.notes.length - notes.length, stepSeconds: tempo / 1e6 / d,
  };
  clip.key = estimateKey(notes);
  return clip;
}

/** a clip in a line: its grid, its notes, its key */
export function describeClip(c) {
  return `${c.name}: ${c.timeSig.join('/')} d=${c.d} S=${c.S} B=${c.B} notes=${c.notes.length}${c.dropped ? ` (${c.dropped} dropped)` : ''} key=${pcName(c.key.tonic)} ${c.key.mode}${c.exact ? '' : ` (unquantized, residual ${c.residual.toFixed(3)} q)`}`;
}
