// compose.js — Compose: one rhythm's row decomposed into an arranged tune, as a deterministic composition spec.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker (compose-worker.js) and Node. The same call runs in
// either place; the table (lean or full) is a parameter, lean by default and full when `worker: true`.
//
// Every note any part plays is an onset the row plays, at its own place in the cycle, with its own ratio; register is
// free (decided). v1 is one cycle (decided). What Compose decides, each overridable and each logged in `decisions`:
//
//   meter      N bars of S slots: the tempo is 60·N·b / T BPM for a cycle of T seconds, b = 4 beats a bar. N is the
//              one of 1, 2, 4, 8 that lands in 90–130 BPM (the nearest 110 when several do; the nearest the range when
//              none does). S is 8, lowered (to 6, 4, then 3) and then N halved while the slots would hold fewer than
//              3 onsets each on average (Sprint default 1): the tempo is kept before the slots.
//   anchors    partitioned (DESIGN_NOTES: "it starts with partitioned anchors").
//   phase      one of the root's first three downbeats, by the seed. Times count from that phase — bar 1's downbeat —
//              and the cycle loops, so a note in bar 1's first window that falls just before it sounds at the cycle's end.
//   frame      ±15¢ (decided); the root: frame.js `defaultRoot`, its presence measured by its ±frame cluster (decided,
//              Avery; `presence: 'exact'` for the phase 3 rule), and the phase from where that cluster sounds.
//   modulation on (Sprint default 3); harmony.js' fold relabels the classes so a reported offset stays in [−50, +50)¢,
//              never moving a pitch (`foldOffsets`, on unless asked).
//   leader     the lead (harmony follows melody, Sprint default 4), unless a progression is given: then
//              'progression' (every bar's root asked) or 'mixed' (progression.js: the asked roots kept, the quality
//              from the bar's own tones, the rest solved as always).
//   settle     `settlePasses` (0..3, default 3; Avery asked for it, the rules proposed): harmony.js derives the chords
//              again from the kept lead and mines the lead again over them until the chords settle; every part below
//              is built from the final chords and targets.
//   parts      lead (harmonize's), chords, comping, bass, one inner voice:
//                chords   each bar's chord, a voice a chord class (root first, then up): the bar's onset of that class,
//                         inside the bar's frame, with the most strikes (then the earliest); stacked close from an octave
//                         under the bar's root up, each voice the lowest register above the one under it. A voice's
//                         notes sound at their onsets, so a chord builds as its tones arrive.
//                comping  one layer of this rhythm cut into the bars and their slots, a slot's step the layer's first
//                         strike in it, sounding only where that strike is on one of the bar's chord tones
//                         (rhythm-claves.js and chunk-comping.js, ported): the layer whose bars make the best claves
//                         (25–50 % of its steps sounding, a straight or triplet count of steps to the bar, a stroke in
//                         every bar). A bar with no stroke is struck once on its root onset.
//                bass     lines.js' bass mined bar by bar, each bar rooted on its chord's root tone, two octaves under the
//                         lead's range, opening on a tone of the root's class (inside the frame) where it can, else
//                         the cheapest line; a bar with no line plays its root onset.
//                inner    a lead line (sparse or mid) over the chords an octave under the lead, never on the lead's
//                         onsets and paying weights.avoid = 0.6 a note on a slot where the lead sounds (proposed).
//   sounds     one Audio/voices instrument a part: lead flute (legato) or vibes; chords warm or glassbed; comping
//              marimba or kalimba; bass sub (legato) or upright; inner reed or harp — a pair by legato, else by the seed.
//   legato     per part, its own notes only (decided): on, a note holds until the part's next note (in a chord part,
//              until that voice's next note); off, it lasts its slot, or the gap to the part's next note if shorter.
//              A struck sound in legato retriggers on every note; a held one is struck once and moved (`retrigger`).
//              Defaults: chords and inner on, comping off, the lead on when its median gap is 2 slots or less, bass off.
//   pitch      hz = baseHz × ratio × 2^octave × the bar's fundamentalRatio, baseHz set so the lead's median sits at
//              √(440·660) ≈ 539 Hz.
//
// Refusals: { refused: true, reason: 'tooDense' | 'tooLarge' | 'tooFewTones', detail }.
//
// The trace (`trace: true`; trace.js, Composer/TRACE.md): `spec.trace`, every decision above as ordered, untimed events
// pointing at the row's onsets, for a renderer to animate. It observes and never steers: without `spec.trace` the spec
// is byte-identical to the one composed with the trace off, and off (the default) nothing of it runs.

import { buildRow, toneGate, isRow, ONSET_GATE, MIN_TONES } from './row.js';
import { buildCells, ANCHOR_MODES } from './cells.js';
import { defaultRoot, toneIndexOf, classOfCents, clusterPresence, PRESENCE_MODES, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { mineLines, downbeats, TABLES } from './lines.js';
import { harmonize, phrasesOf, isStrongBeat, DEFAULT_SETTLE_PASSES, MAX_SETTLE_PASSES } from './harmony.js';
import { getInstrument } from '../../Audio/voices/recipes.js';
import { readProgression, harmonyPins, describeProgression } from './progression.js';
import { arrangeDrums } from './drums.js';
import { createTrace, refusedTrace } from './trace.js';

export const COMPOSER_SPEC_VERSION = 'composer-spec-v1';
export const BEATS_PER_BAR = 4;
export const TEMPO_RANGE = Object.freeze([90, 130]);
export const BAR_CHOICES = Object.freeze([1, 2, 4, 8]);
export const SLOT_CHOICES = Object.freeze([8, 6, 4, 3]);
export const MIN_ONSETS_PER_SLOT = 3;
export const PART_IDS = Object.freeze(['lead', 'chords', 'comp', 'bass', 'inner']);
export const SOUND_PAIRS = Object.freeze({ lead: ['flute', 'vibes'], chords: ['warm', 'glassbed'], comp: ['marimba', 'kalimba'], bass: ['sub', 'upright'], inner: ['reed', 'harp'] });
export const VELOCITY = Object.freeze({ lead: 0.8, chords: 0.45, comp: 0.55, bass: 0.75, inner: 0.5 });
export const LEAD_TARGET_HZ = Math.sqrt(440 * 660);
const REGISTER = Object.freeze({ inner: -1200, bass: -2400, chords: -1200 });
const COMP_SHARE = Object.freeze([0.25, 0.5]);
const OVERRIDES = Object.freeze(['bars', 'slotsPerBar', 'anchors', 'phase', 'frameCentsEachSide', 'root', 'modulation', 'foldOffsets', 'table', 'sounds', 'legato', 'enabled', 'baseHz', 'compLayer', 'presence', 'settlePasses']);

const EPS = 1e-9;
const mod = (v, n) => ((v % n) + n) % n;
const fail = (what) => { throw new Error(`composer/compose: ${what}`); };
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** a seeded generator (mulberry32 over an FNV-1a hash of the seed): the same seed, the same draws */
export function seededRandom(seed) {
  let h = 0x811c9dc5; const text = String(seed);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * N bars and S slots for n onsets in a cycle of T seconds, unless asked. → { bars, slotsPerBar, tempoBpm, notes: [why] }
 */
export function chooseMeter(n, T, { bars = null, slotsPerBar = null } = {}) {
  const tempo = (N) => (60 * N * BEATS_PER_BAR) / T, [lo, hi] = TEMPO_RANGE, notes = [];
  let N = bars;
  if (N == null) {
    const inRange = BAR_CHOICES.filter((x) => tempo(x) >= lo - EPS && tempo(x) <= hi + EPS);
    if (inRange.length) { N = inRange.reduce((a, b) => (Math.abs(tempo(b) - 110) < Math.abs(tempo(a) - 110) - EPS ? b : a)); notes.push(`${N} bar${N > 1 ? 's' : ''} put the tempo at ${tempo(N).toFixed(1)} BPM, inside ${lo}–${hi}`); }
    else {
      const off = (x) => (tempo(x) < lo ? lo - tempo(x) : tempo(x) - hi);
      N = BAR_CHOICES.reduce((a, b) => (off(b) < off(a) - EPS ? b : a));
      notes.push(`no bar count lands in ${lo}–${hi} BPM for a ${T}-second cycle; ${N} bar${N > 1 ? 's' : ''} come nearest, at ${tempo(N).toFixed(1)} BPM`);
    }
  } else notes.push(`${N} bars asked`);
  let S = slotsPerBar;
  if (S == null) {
    S = SLOT_CHOICES[0];
    const sparse = () => n / (N * S) < MIN_ONSETS_PER_SLOT - EPS;
    for (let i = 1; sparse() && i < SLOT_CHOICES.length; i++) { const was = S; S = SLOT_CHOICES[i]; notes.push(`${was} slots a bar would hold ${(n / (N * was)).toFixed(2)} onsets a slot (under ${MIN_ONSETS_PER_SLOT}); ${S} slots instead`); }
    while (sparse() && N > 1 && bars == null) { const was = N; N = N / 2; notes.push(`still sparse: ${N} bar${N > 1 ? 's' : ''} instead of ${was}, the tempo now ${tempo(N).toFixed(1)} BPM`); }
    if (sparse() && S > 2) { S = 2; notes.push(`still sparse: ${S} slots a bar`); }
    if (sparse()) notes.push(`the row has only ${n} onsets: ${(n / (N * S)).toFixed(2)} a slot even so`);
    else if (S === SLOT_CHOICES[0]) notes.push(`8 slots a bar hold ${(n / (N * S)).toFixed(1)} onsets each on average`);
  } else notes.push(`${S} slots a bar asked`);
  return { bars: N, slotsPerBar: S, tempoBpm: tempo(N), notes };
}

/** the recipe's own envelope: struck sounds die away and retrigger in legato */
export const isStruck = (sound) => getInstrument(sound)?.roles?.note?.amp?.kind === 'struck';

/**
 * Times and lengths for one voice's notes (each with `time` and `slotSeconds`), in place, in time order:
 * legato on, a note holds until the next; off, it lasts its slot or the gap to the next if shorter; the last runs
 * to the cycle's end. A note retriggers unless the voice is legato on a held sound and it is not the first.
 */
export function articulate(notes, { legato, struck, cycleSeconds }) {
  notes.sort((a, b) => a.time - b.time || a.node - b.node);
  notes.forEach((n, i) => {
    const gap = (i + 1 < notes.length ? notes[i + 1].time : cycleSeconds) - n.time;
    n.duration = Math.max(0, legato ? gap : Math.min(n.slotSeconds, gap));
    n.retrigger = !legato || struck || i === 0;
  });
  return notes;
}

/**
 * A part of a spec played with another sound or legato (the lab's toggles): its notes' durations and retriggers
 * re-derived by `articulate`, voice by voice in the chords part, nothing re-mined. → a new part
 */
export function rearticulate(part, { sound = part.sound, legato = part.legato, enabled = part.enabled, cycleSeconds }) {
  if (!(cycleSeconds > 0)) fail('rearticulate needs the cycle\'s seconds');
  const struck = isStruck(sound), notes = part.notes.map((n) => ({ ...n }));
  const groups = part.id === 'chords' ? [...new Set(notes.map((n) => n.voice))].map((v) => notes.filter((n) => n.voice === v)) : [notes];
  for (const g of groups) articulate(g, { legato, struck, cycleSeconds });
  notes.sort((a, b) => a.time - b.time || a.node - b.node);
  return { ...part, sound, struck, legato, enabled, notes };
}

/**
 * Compose.
 *   layers         the rhythm, [a, b, c, d] as the LRC names them
 *   cycleSeconds   how long one cycle lasts
 *   options        { seed (default 1), overrides: { bars, slotsPerBar, anchors, phase, frameCentsEachSide, root,
 *                  modulation, foldOffsets, table, sounds: { part: id }, legato: { part: bool }, enabled: { part: bool },
 *                  baseHz, compLayer, presence ('cluster' | 'exact'), settlePasses (an integer 0..3) }, worker (true:
 *                  the full table unless asked), progression ([a ratio of the row | null] a bar: progression.js;
 *                  absent or all null: lead-led, exactly as without it),
 *                  drums (drums.js `arrangeDrums` options, or false: no `drums` in the spec),
 *                  trace (true: `spec.trace`, the compose trace of trace.js; off by default) }
 * → the spec (see the head of this file and Composer/DESIGN_NOTES.md "Phase 4"), or a refusal
 */
export function compose(layers, cycleSeconds, { seed = 1, overrides = {}, worker = false, progression = null, drums = {}, trace = false } = {}) {
  const input = { layers: [...layers], cycleSeconds, seed, overrides: JSON.parse(JSON.stringify(overrides ?? {})) };
  // ── a targeted progression (progression.js): recorded in the input only when it asks for a root ──
  if (progression != null && !Array.isArray(progression)) fail(`progression must be a list, one root a bar (a ratio or null)`);
  if (progression && progression.some((x) => x != null && x !== '' && x !== 'auto')) input.progression = JSON.parse(JSON.stringify(progression));
  if (!(Number.isFinite(cycleSeconds) && cycleSeconds > 0)) fail(`cycleSeconds must be a positive number, not ${cycleSeconds}`);
  for (const k of Object.keys(overrides || {})) if (!OVERRIDES.includes(k)) fail(`no override "${k}" (overrides are ${OVERRIDES.join(', ')})`);
  const ov = overrides || {}, T = cycleSeconds;

  const refusal = (r) => (trace ? { ...r, trace: refusedTrace(r, { cycleSeconds }) } : r);
  const row = buildRow(layers, { gate: ONSET_GATE });
  if (!isRow(row)) return refusal({ version: COMPOSER_SPEC_VERSION, input, refused: true, reason: row.tooDense ? 'tooDense' : 'tooLarge', detail: row });
  const few = toneGate(row, MIN_TONES);
  if (few) return refusal({ version: COMPOSER_SPEC_VERSION, input, refused: true, reason: 'tooFewTones', detail: few });
  // the trace's recorder (trace.js), or null: every `rec?.` below is skipped, arguments and all, when it is off
  const rec = trace ? createTrace(row, { cycleSeconds: T, meter: { bars: BAR_CHOICES, slots: SLOT_CHOICES, tempoRange: TEMPO_RANGE, beatsPerBar: BEATS_PER_BAR } }) : null;
  rec?.row();

  const rng = seededRandom(seed), decisions = [];
  const decide = (what, value, why) => { decisions.push({ what, value, why }); return value; };

  // ── knobs ──
  const e = decide('frameCentsEachSide', ov.frameCentsEachSide ?? DEFAULT_FRAME_CENTS_EACH_SIDE, ov.frameCentsEachSide != null ? 'asked' : 'the default (decided): ±15¢, as the Progression Solver');
  const presence = decide('presence', ov.presence ?? 'cluster', ov.presence != null ? 'asked' : `a root is heard as its ±${e}¢ cluster: every tone of its class within ±${e}¢ of it (decided, Avery)`);
  if (!PRESENCE_MODES.includes(presence)) fail(`presence must be one of ${PRESENCE_MODES.join(', ')}`);
  const rootTone = ov.root != null ? toneIndexOf(row, ov.root) : defaultRoot(row, e, { presence });
  const heardAs = presence === 'cluster' ? clusterPresence(row, e).presence[rootTone] : null;
  rec?.root(e, presence, rootTone, ov.root != null);
  decide('root', row.tones[rootTone], ov.root != null ? 'asked' : presence === 'exact'
    ? `the tone heard at least max(2, 1%) of the onsets (or half the most heard) whose ±${e}¢ frame holds the most onsets; heard ${row.toneCount[rootTone]} times`
    : `the loudest tone of its ±${e}¢ cluster, the cluster heard at least max(2, 1%) of the onsets (or half the largest cluster), whose ±${e}¢ frame holds the most onsets; heard ${row.toneCount[rootTone]} times, its cluster ${heardAs}`);
  const meter = chooseMeter(row.n, T, { bars: ov.bars ?? null, slotsPerBar: ov.slotsPerBar ?? null });
  decide('bars', meter.bars, ov.bars != null ? 'asked' : meter.notes.filter((x) => /bar|BPM/.test(x) && !/slot/.test(x)).join('; '));
  decide('slotsPerBar', meter.slotsPerBar, ov.slotsPerBar != null ? 'asked' : meter.notes.filter((x) => /slot|onsets/.test(x)).join('; '));
  decide('tempoBpm', meter.tempoBpm, `60 × ${meter.bars} bars × ${BEATS_PER_BAR} beats / ${T} s`);
  rec?.meter(meter, { bars: ov.bars, slotsPerBar: ov.slotsPerBar });
  const anchors = decide('anchors', ov.anchors ?? 'partitioned', ov.anchors ? 'asked' : 'partitioned pulses first (decided: "it starts with partitioned anchors")');
  if (!ANCHOR_MODES.includes(anchors)) fail(`anchors must be one of ${ANCHOR_MODES.join(', ')}`);
  const P = meter.bars * meter.slotsPerBar;
  let phase;
  if (ov.phase) { phase = ov.phase; decide('phase', phase, 'asked'); rec?.phase(null, null, phase); }
  else {
    const beats = downbeats(row, P, 3, rootTone, { anchors, cluster: presence === 'cluster' ? e : null }), at = Math.floor(rng() * beats.length);
    phase = beats[at];
    decide('phase', phase, `downbeat ${at + 1} of the root's first ${beats.length} (where it first sounds, then ${presence === 'cluster' ? `the heaviest onsets of its ±${e}¢ cluster` : 'its heaviest onsets'}), by the seed`);
    rec?.phase(beats, at, phase);
  }
  const cells = buildCells(row, { bars: meter.bars, slotsPerBar: meter.slotsPerBar, anchors, phase });
  rec?.cells(cells);
  const modulation = decide('modulation', ov.modulation ?? true, ov.modulation != null ? 'asked' : 'on by default (Sprint default 3): a jump at a bar where a root is off the grid');
  const table = decide('table', ov.table ?? (worker ? 'full' : 'lean'), ov.table ? 'asked' : worker ? 'in a worker: the full table' : 'on the main thread: the lean table (the cost probe)');
  if (!TABLES.includes(table)) fail(`table must be one of ${TABLES.join(', ')}`);
  // ── a targeted progression: the asked roots per bar, read against the row and the bars ──
  const prog = input.progression ? readProgression(input.progression, row, meter.bars) : null, targeted = !!prog?.targeted;
  const leader = !targeted ? 'lead' : prog.roots.every((r) => r != null) ? 'progression' : 'mixed';
  decide('leader', leader, leader === 'lead' ? 'v1 is lead-led: the lead is mined first and the chords follow it'
    : leader === 'progression' ? 'a progression asked a root for every bar: the chords first, from those roots, and the lead over them'
    : 'a progression asked roots for some bars: those kept, the rest of the chords following the lead');
  if (prog) rec?.progression(prog, leader);

  // ── harmony and the lead ──
  const foldOffsets = ov.foldOffsets ?? true;
  if (ov.foldOffsets != null) decide('foldOffsets', foldOffsets, 'asked');
  const settlePasses = decide('settlePasses', ov.settlePasses ?? DEFAULT_SETTLE_PASSES, ov.settlePasses != null ? 'asked'
    : `up to ${DEFAULT_SETTLE_PASSES} more rounds of chords from the kept lead and the lead over them, until the chords settle or repeat (asked for by Avery; the cap and the stopping rules proposed, not ruled)`);
  if (!(Number.isInteger(settlePasses) && settlePasses >= 0 && settlePasses <= MAX_SETTLE_PASSES)) fail(`settlePasses must be an integer 0..${MAX_SETTLE_PASSES}`);
  const h = harmonize(row, cells, { root: rootTone, frameCentsEachSide: e, modulation, table, foldOffsets, settlePasses, ...(targeted ? { progression: harmonyPins(prog) } : {}), trace: rec });
  rec?.harmony(h);
  if (prog) { const d = targeted ? describeProgression(prog, h.chords, row) : { value: prog.roots.map(() => 'auto'), why: `no root of the progression could be used, so every bar is auto: ${prog.notes.join('; ')}` }; decide('progression', d.value, d.why); }
  const S = cells.slotsPerBar, N = cells.bars, phaseX = phase[0] / phase[1];
  const timeOf = (tick) => mod(tick / row.grid - phaseX, 1) * T;
  const ratioOf = (bar) => h.chords[bar].fundamentalRatio;   // the sounding retune: a folded name never moves it
  const slotSeconds = (cell) => cells.slots[cell].length * T;
  // every onset's bar and slot by its place from the phase (a bar runs from its first anchor to the next bar's)
  const starts = cells.slots.map((s) => mod(s.anchor - phaseX, 1));
  const posSlot = new Int32Array(row.n);
  for (let i = 0; i < row.n; i++) {
    const x = mod(row.x[i] - phaseX, 1); let lo = 0, hi = P - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x + EPS) lo = mid; else hi = mid - 1; }
    posSlot[i] = lo;
  }
  const inBar = Array.from({ length: N }, () => []);
  for (let i = 0; i < row.n; i++) inBar[Math.floor(posSlot[i] / S)].push(i);
  const pitchAtLeast = (tone, floor) => { const c = row.toneCents[tone], octave = Math.ceil((floor - c) / 1200 - EPS); return { octave, pitch: c + 1200 * octave }; };
  const chordClass = (c, tone) => { const k = classOfCents(row.toneCents[tone] - c.rootCents); return Math.abs(k.dev) <= e + EPS && c.intervals.includes(k.pc) ? k.pc : -1; };

  const parts = {};
  // lead
  parts.lead = h.lead.notes.map((n) => ({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: n.bar, slot: n.cell, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.cell), strong: isStrongBeat(n.beat, S) }));
  // chords: a voice a chord class
  const voices = [];
  for (let k = 0; k < N; k++) {
    const c = h.chords[k];
    let floor = c.rootCents + REGISTER.chords - 50;
    c.intervals.forEach((pc, v) => {
      let best = -1;
      for (const i of inBar[k]) if (chordClass(c, row.tone[i]) === pc && (best < 0 || row.strikes[i] > row.strikes[best] || (row.strikes[i] === row.strikes[best] && timeOf(row.tick[i]) < timeOf(row.tick[best])))) best = i;
      if (best < 0) return;
      const { octave, pitch } = pitchAtLeast(row.tone[best], floor);
      floor = pitch + 1;
      (voices[v] ||= []).push({ node: best, tone: row.tone[best], octave, pitch, bar: k, slot: posSlot[best], time: timeOf(row.tick[best]), slotSeconds: slotSeconds(posSlot[best]), voice: v });
    });
  }
  // comping: a layer cut into the bars and their slots: a slot's step is the layer's first strike in it, and it sounds
  // when that strike's tone is one of the bar's chord tones (rhythm-claves.js' tone set, chunk-comping.js' ranking)
  const inSlot = Array.from({ length: P }, () => []);
  for (let i = 0; i < row.n; i++) inSlot[posSlot[i]].push(i);
  for (const list of inSlot) list.sort((a, b) => timeOf(row.tick[a]) - timeOf(row.tick[b]) || a - b);
  const compChoices = row.active.map((b) => {
    let density = 0, fit = 0, covered = 0;
    const hits = [];
    for (let k = 0; k < N; k++) {
      let steps = 0; const on = [];
      for (let j = k * S; j < (k + 1) * S; j++) {
        const first = inSlot[j].find((i) => row.owners[i] & (1 << b));
        if (first === undefined) continue;
        steps++;
        if (chordClass(h.chords[k], row.tone[first]) >= 0) on.push(first);
      }
      const x = steps ? on.length / steps : 0, [lo, hi] = COMP_SHARE;
      density += x < lo ? x / lo : x > hi ? (1 - x) / (1 - hi) : 1;
      fit += [4, 8, 16].includes(steps) ? 1 : [3, 6, 12].includes(steps) ? 0.75 : 0.4;
      if (on.length) covered++;
      hits.push(on);
    }
    return { layer: b, value: row.layers[b], score: (density + fit + covered) / (3 * N), hits };
  });
  const tieOrder = compChoices.map(() => rng());
  let comp;
  if (ov.compLayer != null) {
    comp = compChoices.find((x) => x.value === ov.compLayer || 'ABCD'[x.layer] === ov.compLayer) ?? fail(`no layer ${ov.compLayer}`);
    decide('compLayer', 'ABCD'[comp.layer], 'asked');
  } else {
    comp = compChoices.reduce((a, b, i) => (b.score > a.score + EPS || (Math.abs(b.score - a.score) <= EPS && tieOrder[i] < tieOrder[compChoices.indexOf(a)]) ? b : a));
    decide('compLayer', 'ABCD'[comp.layer], `layer ${'ABCD'[comp.layer]} (${comp.value}) makes the best claves on the chord tones: ${comp.score.toFixed(3)} (a slot's step its first strike there; 25–50 % of the steps on chord tones, a straight or triplet count of steps to the bar, a stroke in every bar), ties by the seed`);
  }
  parts.comp = [];
  for (let k = 0; k < N; k++) {
    const c = h.chords[k], floor = c.rootCents + REGISTER.chords - 50;
    const strokes = comp.hits[k].length ? comp.hits[k] : (c.rootNode != null && Math.floor(posSlot[c.rootNode] / S) === k ? [c.rootNode] : []);
    for (const i of strokes) { const { octave, pitch } = pitchAtLeast(row.tone[i], floor); parts.comp.push({ node: i, tone: row.tone[i], octave, pitch, bar: k, slot: posSlot[i], time: timeOf(row.tick[i]), slotSeconds: slotSeconds(posSlot[i]), strikes: row.strikes[i] }); }
  }
  // bass: bar by bar, rooted on the bar's root tone
  parts.bass = [];
  let bassRooted = 0;
  for (let k = 0; k < N; k++) {
    const c = h.chords[k];
    // the root's class in the bar's frame: a bass line opens on it where it can
    const rootClass = []; for (let t = 0; t < row.tones.length; t++) { const k2 = classOfCents(row.toneCents[t] - c.rootCents); if (k2.pc === 0 && Math.abs(k2.dev) <= e + EPS) rootClass.push(t); }
    const bassOpts = { from: k, bars: 1, types: ['bass'], table, targets: { scale: h.targets.scale, bars: [h.targets.bars[k]] }, register: REGISTER.bass };
    let lines = mineLines(row, cells, [c.frame], { ...bassOpts, rules: { startTones: rootClass } }).lines || [];
    if (!lines.length) lines = mineLines(row, cells, [c.frame], bassOpts).lines || [];
    const line = lines[0];
    const notes = line ? line.notes.map((n) => ({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: k, slot: n.cell, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.cell) }))
      : c.rootNode != null ? [(() => { const { octave, pitch } = pitchAtLeast(c.rootTone, c.rootCents + REGISTER.bass - 50); return { node: c.rootNode, tone: c.rootTone, octave, pitch, bar: k, slot: posSlot[c.rootNode], time: timeOf(row.tick[c.rootNode]), slotSeconds: slotSeconds(posSlot[c.rootNode]) }; })()] : [];
    if (notes.length && classOfCents(row.toneCents[notes[0].tone] - c.rootCents).pc === 0) bassRooted++;
    rec?.bassBar(k, line ?? null, notes.length && classOfCents(row.toneCents[notes[0].tone] - c.rootCents).pc === 0);
    parts.bass.push(...notes);
  }
  // inner: over the chords an octave under the lead, off the lead's onsets
  parts.inner = [];
  const leadCells = new Set(h.lead.notes.map((n) => n.cell)), leadNodes = h.lead.notes.map((n) => n.node);
  let innerOnLead = 0;
  for (const { from, bars } of phrasesOf(cells)) {
    const frames = h.chords.slice(from, from + bars).map((c) => c.frame), sub = { scale: h.targets.scale, bars: h.targets.bars.slice(from, from + bars) };
    const avoidSlots = Array.from({ length: bars * S }, (_, j) => leadCells.has(from * S + j));
    const got = mineLines(row, cells, frames, { from, bars, types: ['lead'], table, targets: sub, register: REGISTER.inner, rules: { avoidSlots, avoidNodes: leadNodes }, weights: { avoid: 0.6 } });
    const line = (got.lines || []).find((l) => l.band !== 'dense');
    rec?.innerPhrase(from, bars, line ?? null);
    if (!line) continue;
    for (const n of line.notes) { if (leadCells.has(n.cell)) innerOnLead++; parts.inner.push({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: n.bar, slot: n.cell, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.cell) }); }
  }

  // ── legato, sounds, pitch ──
  const leadGaps = []; for (let i = 1; i < h.lead.notes.length; i++) leadGaps.push(h.lead.notes[i].cell - h.lead.notes[i - 1].cell);
  const leadGap = median(leadGaps);
  const legatoWhy = { chords: 'on by default: chords sustain', inner: 'on by default: an inner voice sustains', comp: 'off by default: comping is struck', bass: 'off by default (proposed)',
    lead: `the lead's median gap is ${leadGap ?? '–'} slot${leadGap === 1 ? '' : 's'}: ${leadGap != null && leadGap <= 2 ? 'on (2 or less)' : 'off (more than 2)'}` };
  const legatoDefault = { chords: true, inner: true, comp: false, bass: false, lead: leadGap != null && leadGap <= 2 };
  const legato = {}, sound = {}, enabled = {};
  for (const id of PART_IDS) {
    legato[id] = decide(`legato.${id}`, ov.legato?.[id] ?? legatoDefault[id], ov.legato?.[id] != null ? 'asked' : legatoWhy[id]);
    const pair = SOUND_PAIRS[id];
    let pick, why;
    if (ov.sounds?.[id]) { pick = ov.sounds[id]; why = 'asked'; if (!getInstrument(pick)?.roles?.note) fail(`no note instrument "${pick}" in Audio/voices`); }
    else if (id === 'lead' || id === 'bass') { pick = legato[id] ? pair[0] : pair[1]; why = `${pick}: ${legato[id] ? 'held, for a legato part' : 'struck, for a detached part'}`; }
    else { pick = pair[Math.floor(rng() * 2)]; why = `${pair.join(' or ')}, by the seed`; }
    sound[id] = decide(`sound.${id}`, pick, why);
    enabled[id] = decide(`enabled.${id}`, ov.enabled?.[id] ?? true, ov.enabled?.[id] != null ? 'asked' : 'every part plays');
  }
  const leadPitch = median(parts.lead.map((n) => n.pitch));
  const baseHz = decide('baseHz', ov.baseHz ?? (leadPitch == null ? 261.6255653005986 : LEAD_TARGET_HZ / 2 ** (leadPitch / 1200)),
    ov.baseHz ? 'asked' : leadPitch == null ? 'no lead notes: 1/1 at middle C' : `the lead's median pitch (${leadPitch.toFixed(1)}¢ above 1/1) at √(440·660) ≈ 539 Hz`);

  const out = (id, notes, { voice = false } = {}) => {
    const struck = isStruck(sound[id]), groups = voice ? notes : [notes];
    for (const g of groups) if (g) articulate(g, { legato: legato[id], struck, cycleSeconds: T });
    const flat = (voice ? groups.flat().filter(Boolean) : notes).sort((a, b) => a.time - b.time || a.node - b.node);
    return {
      id, role: id, sound: sound[id], struck, legato: legato[id], enabled: enabled[id],
      notes: flat.map((n) => {
        const [num, den] = row.tones[n.tone].split('/').map(Number);
        const accent = id === 'comp' ? 0.1 * Math.max(0, (n.strikes ?? 1) - 1) : id === 'lead' && n.strong ? 0.1 : 0;
        return {
          node: n.node, tick: row.tick[n.node], time: n.time, ratio: row.tones[n.tone], octave: n.octave, hz: baseHz * (num / den) * 2 ** n.octave * ratioOf(n.bar),
          duration: n.duration, velocity: Math.min(1, VELOCITY[id] + accent), bar: n.bar, slot: n.slot, slotSeconds: n.slotSeconds, retrigger: n.retrigger, ...(voice ? { voice: n.voice } : {}),
        };
      }),
    };
  };
  const partList = [out('lead', parts.lead), out('chords', voices, { voice: true }), out('comp', parts.comp), out('bass', parts.bass), out('inner', parts.inner)];
  rec?.parts(partList, { comp, compChoices, compAsked: ov.compLayer != null });

  const counts = Object.fromEntries(partList.map((p) => [p.id, p.notes.length]));
  const spec = {
    version: COMPOSER_SPEC_VERSION, input,
    knobs: {
      bars: N, slotsPerBar: S, beatsPerBar: BEATS_PER_BAR, anchors, phase: [...phase], frameCentsEachSide: e, root: row.tones[rootTone], modulation, table,
      tempoBpm: meter.tempoBpm, leader, baseHz, cycleSeconds: T,
    },
    chords: h.chords.map((c) => ({ bar: c.bar, name: c.name, quality: c.quality, intervals: [...c.intervals], pcs: [...c.pcs], rootPc: c.rootPc, rootTone: c.rootFraction, rootNode: c.rootNode,
      offsetCents: c.offsetCents, rawOffsetCents: c.rawOffsetCents, fundamentalRatio: ratioOf(c.bar), offGrid: !!c.offGrid, exceptions: c.exceptions.length, empty: !!c.empty,
      ...(targeted ? { targeted: prog.roots[c.bar] != null, fallback: prog.roots[c.bar] != null ? c.fallback ?? null : null } : {}) })),
    modulations: h.modulations.map((m) => ({ ...m })),
    timeline: { slotStarts: starts.map((x) => x * T), barStarts: starts.filter((_, j) => j % S === 0).map((x) => x * T) },
    parts: partList,
    decisions,
    stats: {
      onsets: row.n, tones: row.tones.length, grid: row.grid, onsetsPerSlot: row.n / P, notes: counts,
      leadPhrases: h.passes.phrases.length, secondPassWins: h.passes.secondWins, exceptions: h.exceptions,
      chordVoices: voices.reduce((n, v) => n + (v ? v.length : 0), 0) / N, bassRooted: `${bassRooted}/${N}`, innerOnLeadSlots: innerOnLead,
      compLayer: { layer: 'ABCD'[comp.layer], value: comp.value, score: comp.score },
      settle: { rounds: h.settle.rounds, converged: h.settle.converged, oscillated: h.settle.oscillated, changedBarsPerRound: [...h.settle.changedBarsPerRound],
        exceptionsPerRound: [...h.settle.exceptionsPerRound], chosenRound: h.settle.chosenRound },
    },
  };
  // ── drums (drums.js): from the spec alone, so the lab re-arranges them without composing again; `drums: false` leaves them out ──
  if (drums !== false) spec.drums = arrangeDrums(spec, drums === true ? {} : drums);
  if (rec) { rec.drums(spec); rec.done(spec); spec.trace = rec.finish(); }
  return spec;
}
