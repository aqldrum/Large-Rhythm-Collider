// target-lines.js — MIDI targets, phase B (Composer/TARGET_ORDER.md B2–B3; DESIGN_NOTES "MIDI targets (phase B)"): the
// Composer window's MIDI clip control and the lead row's marks, as plain data. PURE: no DOM, no clock, no controller.
// composer-tab.js renders it; matrix.js reads the marks.
//
//   decodeLine(clip, { tonic })            → { name, grid, notes, tonic, dropped, unquantized, items: [{ text, tone }], title }
//   tonicChoices(clip)                     → [{ value ('' auto | '0'..'11'), label }]   the 12-way override (P5)
//   fitLine(target)                        → { items: [{ text, tone }], where, title }   spec.target, as Compose made it
//   placementRow(p, i, { current, best })  → { label, detail, where, title }             an alternate placement
//   clipMarks(spec)                        → [{ j, step, until, midi, pc, kind, sub, miss, late, sounding }] a clip note
//   clipCounts(marks)                      → { notes, hits, sub, fringe, shift, hard, late }
//   targetError(message)                   → the error in plain words
//
// The kinds (P2): hit (the class in its slot, inside the frame), fringe (the class in its slot, outside the frame:
// played, amber), shift (an in-frame onset of the class one slot over: played, amber), hard (silent, red). A late off
// (P4) is a note whose end found no onset near its note-off slot's anchor. A tone is '' | 'ok' | 'amber' | 'red'.

import { pcName } from '../core/midi.js';

export const TARGET_LINES_VERSION = 'composer-target-lines-v1';
/** the step's name, by steps a quarter (midi.js SUBDIVISIONS) */
const STEP_NAMES = Object.freeze({ 1: 'quarters', 2: 'eighths', 3: 'triplet eighths', 4: 'sixteenths', 6: 'triplet sixteenths', 8: '32nds', 12: 'triplet 32nds', 16: '64ths' });
export const stepName = (d) => STEP_NAMES[d] ?? `1/${d}-quarter steps`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** a note's name with its octave (MIDI 60 = C4) */
export const noteName = (midi) => `${pcName(midi)}${Math.floor(midi / 12) - 1}`;
/** a phase as a share of the cycle, in words */
const at = (phase) => `${(phase[0] / phase[1]).toFixed(3)} of the cycle`;

/**
 * The decode line: what the file held, on its own grid. tonic: the override (a pitch class) or null (the estimate).
 */
export function decodeLine(clip, { tonic = null } = {}) {
  if (!clip) return null;
  const est = clip.key, asked = tonic != null;
  const grid = `${clip.timeSig.join('/')} on ${stepName(clip.d)} (${clip.S} a bar)`;
  const items = [
    { text: clip.name, tone: '', name: true },
    { text: grid, tone: '' },
    { text: plural(clip.B, 'bar'), tone: '' },
    { text: plural(clip.notes.length, 'note'), tone: '' },
    { text: asked ? `tonic ${pcName(tonic)} (asked; the estimate ${pcName(est.tonic)} ${est.mode})` : `tonic ${pcName(est.tonic)} ${est.mode} (estimated, r ${est.r.toFixed(2)})`, tone: asked ? 'ok' : '' },
    { text: `${Math.round(clip.tempoBpm ?? clip.bpm)} BPM`, tone: '' },
  ];
  if (clip.dropped) items.push({ text: `chords reduced to their top note: ${plural(clip.dropped, 'note')} dropped`, tone: 'amber' });
  if (!clip.exact) items.push({ text: `unquantized: the grid is a guess (off by up to ${clip.residual.toFixed(2)} of a quarter)`, tone: 'amber' });
  const title = `${clip.name}: ${clip.timeSig.join('/')}, ${clip.S} steps a bar (${stepName(clip.d)}), ${clip.B} bars from the first note's bar${clip.pickup ? ` (a pickup of ${plural(clip.pickup, 'step')})` : ''}; `
    + `${clip.notes.length} notes (the top line); the key estimate (Krumhansl) is weak on short tunes, so the tonic can be picked`;
  return { name: clip.name, grid, notes: clip.notes.length, tonic: asked ? tonic : est.tonic, dropped: clip.dropped, unquantized: !clip.exact, items, title };
}

/** the 12-way tonic override (P5): auto (the estimate) first, then every class */
export function tonicChoices(clip) {
  const est = clip?.key;
  return [{ value: '', label: est ? `auto (${pcName(est.tonic)} ${est.mode})` : 'auto' }, ...Array.from({ length: 12 }, (_, pc) => ({ value: String(pc), label: pcName(pc) }))];
}

/** "whole cycle" or "window: bars B of N" */
export const whereOf = (p) => (p.N === p.B ? 'whole cycle' : `window: ${p.B} of ${p.N} bars`);

/**
 * The fit line (decided 3, 5; P2–P4): hits / notes, tight, note-offs, where it sits, the substitutes and the silent
 * notes, the drift when any, the classes the row can't play.
 */
export function fitLine(target) {
  const p = target?.placement;
  if (!p) return null;
  const sounding = p.notes.filter((x) => x.on.node != null).length, late = p.notes.filter((x) => x.off?.late).length;
  const items = [
    { text: `${p.hits}/${p.J} notes hit`, tone: p.hits === p.J ? 'ok' : 'amber' },
    { text: `${p.tight} tight`, tone: '' },
    { text: `${p.offHits}/${sounding} note-offs on onsets${late ? ` (${late} late)` : ''}`, tone: late ? 'amber' : '' },
    { text: p.N === p.B ? 'whole cycle' : `window: ${p.B} of ${p.N} bars, from ${at(p.phase)}`, tone: '' },
  ];
  const sub = p.misses.fringe + p.misses.shift;
  if (sub) items.push({ text: `${sub} substituted (${[p.misses.fringe ? `${p.misses.fringe} off the frame` : '', p.misses.shift ? `${p.misses.shift} a slot over` : ''].filter(Boolean).join(', ')})`, tone: 'amber' });
  if (p.misses.hard) items.push({ text: `${p.misses.hard} silent`, tone: 'red' });
  if (p.drift > 0) items.push({ text: `the lattice drifts ${p.drift.toFixed(1)}¢ over ${plural(p.phrases.length, 'phrase')}`, tone: '' });
  if (p.missing?.length) items.push({ text: `the row can't play ${p.missing.map(pcName).join(', ')}`, tone: 'red' });
  const title = `the best reading of the clip in this row: ${p.hits} of ${p.J} notes on an in-tune onset of their class in their slot (${p.tight} within a quarter slot); `
    + `${p.misses.fringe} played off the ±frame, ${p.misses.shift} a slot over, ${p.misses.hard} silent; ${p.offHits} of ${sounding} note-offs on an onset near their anchor`
    + `${p.N > p.B ? `; the cycle cut in ${p.N} bars and the composition loops on the clip's ${p.B}` : ''}`;
  return { items, where: whereOf(p), title };
}

/** an alternate placement as the control lists it (i: its index in the list, 0 the search's best) */
export function placementRow(p, i, { current = false } = {}) {
  const sub = p.misses.fringe + p.misses.shift;
  const detail = [`${p.tight} tight`, sub ? `${sub} subst.` : '', p.misses.hard ? `${p.misses.hard} silent` : '', p.drift > 0 ? `drift ${p.drift.toFixed(1)}¢` : ''].filter(Boolean).join(' · ');
  return {
    label: `${i === 0 ? 'best' : `#${i + 1}`} · ${p.hits}/${p.J}`, detail, where: whereOf(p), current,
    title: `${i === 0 ? "the search's best" : `alternate ${i}`}: ${p.hits}/${p.J} hit, ${p.tight} tight, ${p.offHits} note-offs on onsets; ${whereOf(p)}, from ${at(p.phase)}; `
      + `lattice ${p.phrases.map((ph) => `${ph.psiRatio} (k ${ph.k})`).join(' → ')}${p.missing?.length ? `; the row can't play ${p.missing.map(pcName).join(', ')}` : ''}`,
  };
}

/** a target's clip notes with their kinds (P2) and late offs (P4), in clip order ([] without a target) */
export function clipMarks(spec) {
  const p = spec?.target?.placement;
  if (!p) return [];
  return p.notes.map((x, j) => ({ j, step: x.step, until: x.until, midi: x.midi, pc: x.pc, kind: x.on.kind, sub: x.on.kind === 'fringe' || x.on.kind === 'shift', miss: x.on.kind === 'hard',
    late: !!x.off?.late, sounding: x.on.node != null, node: x.on.node, offSlots: x.on.offSlots ?? 0, dev: x.on.dev ?? null }));
}
/** the marks counted */
export function clipCounts(marks) {
  const n = (f) => marks.filter(f).length;
  return { notes: marks.length, hits: n((m) => m.kind === 'hit'), sub: n((m) => m.sub), fringe: n((m) => m.kind === 'fringe'), shift: n((m) => m.kind === 'shift'), hard: n((m) => m.miss), late: n((m) => m.late) };
}
/** a kind in words */
export const KIND_WORDS = Object.freeze({ hit: 'hit', fringe: 'off the frame (amber)', shift: 'a slot over (amber)', hard: 'silent (red)' });

/** a decode or compose error in plain words */
export function targetError(message) {
  const m = String(message ?? '').replace(/^composer(\/midi|\/target)?: /, '');
  if (/no MThd|not a MIDI file/.test(m)) return 'Not a MIDI file: drop a Standard MIDI File (.mid).';
  if (/unexpected end of file|variable-length/.test(m)) return 'The MIDI file is cut short or damaged.';
  if (/SMPTE/.test(m)) return 'This MIDI file counts time in SMPTE frames, which the Composer can\'t read yet (save it with ticks per quarter).';
  if (/format \d/.test(m)) return `This MIDI file's ${m} (only formats 0 and 1 are).`;
  if (/no notes/.test(m)) return 'The MIDI file has no notes.';
  if (/not a whole number of/.test(m)) return `The clip's time signature doesn't fit its grid: ${m}.`;
  if (m === 'targetGrid') return 'The MIDI clip\'s grid is too fine for a line (more than 32 steps a bar).';
  if (m === 'tooFewTones') return 'Too few tones: this row can\'t carry a melody.';
  if (m === 'tooDense' || m === 'tooLarge') return 'This row is past what the Composer takes.';
  return m || 'the clip could not be used';
}
