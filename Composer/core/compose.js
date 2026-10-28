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
//                         inside the bar's frame, with the most strikes (then the earliest). A voice's notes sound at their
//                         onsets, so a chord builds as its tones arrive. The octaves (`voicing`; BASS_VOICING_ORDER.md
//                         phase F, decided 3–4, P1–P7 proposed; Amendment 1, rule 8, P25): led (the default), the loop
//                         closed: every chord's octaves chosen together inside a window centred on the first chord's close
//                         voicing (lifted clear of the mud limit), so the motion over the whole loop is least, the last
//                         chord back to the first weighed as every change (`voiceLead`), each note's `lane` its register
//                         order in its chord; close, stacked close from an
//                         octave under the bar's root up, each voice the lowest register above the one under it.
//                comping  in chords (`compStyle: 'chords'`, the default; COMP_ARP_ORDER.md, decided 1 and 5–6, P3–P9 and
//                         R1–R5 proposed): ONE CLAVE for the composition (claves.js), mined from this rhythm's layers (each
//                         read at the bar sizes where another layer meets it, then every size that cuts it whole, then
//                         every size 3–16, under tone sets coarse to fine), ranked by recurrence, density (25–50 % of its
//                         steps) and fit (straight or triplet), ties by the seed (a generator of its own); the curated
//                         son, rumba and bossa claves are choices (`clave` override). Laid a pass a bar, step j of n at
//                         j·S/n slots, landed on the onset nearest it (drums.js' landing) inside its bar (a split bar's
//                         span): those are the strokes (`compRelation: 'sync'`, the default), or its partner's, the
//                         clave's gaps ('fill'). A stroke plays the bar's chord as a strum: each chord class its onset
//                         nearest the stroke within ±¼ slot, inside the bar (a split bar's span), sounding at its own
//                         time (ties: the most strikes, then the earliest); a class the row doesn't sound there is
//                         BORROWED, the chord voice of that class at the stroke's time (`borrowed`, `from`: the voice's
//                         onset), velocity 0.45 (the strum's other tones 0.5, the stroke's own 0.55 + 0.1 a layer more).
//                         A voice a class (root first, ≤ 4), stacked close from an octave under the root (led chords: a
//                         strum tone the octave nearest its class's chord voice, a borrowed tone the voice itself, P5;
//                         the voice's `lane` too); each holds at
//                         most to the next stroke (`holdTo`), never past the span. `spec.clave` holds the clave, its
//                         landed strokes and its partner's; the drums play it on the perc (drums.js R4).
//                         FROM THE FRAME (`claveFrom: 'frame'`, the default; BASS_VOICING_ORDER.md phase I, Avery's rule 6,
//                         P16–P21): the clave is read after the chords, from them. A candidate is a layer, a grain (n steps
//                         a bar: the layer's own strikes a bar, or 3–16 when it is denser) and a tone set (the bar's chord
//                         tones in tune, or anything in its frame); a bar's pattern is the layer's strikes at its steps
//                         whose tones are in the set under the chord they sound under, and the strokes are those strikes,
//                         at their own times (nothing is landed). Ranked by the same rules over the bars' patterns, ties
//                         by the seed; Fill's partner the best candidate sharing no stroke (none within ¼ slot), else the
//                         complement landed in frame; the curated and asked claves keep their pattern and land only on
//                         in-frame onsets (claves.js). `claveFrom: 'pattern'` is the clave above, byte for byte.
//                         DENSITY TIERS (`compDensity`; Amendment 2, rule 10, P26–P27): three narrower sets too (the
//                         chord's root and fifth, its guide tones, its roots), and the clave is chosen in a tier of its
//                         share of steps sounding: 'sparse-med' (10–50 %, the default), 'sparse' (10–25 %), 'medium'
//                         (25–50 %), 'dense' (50–85 %), the density term read against the tier's band; with none in the
//                         tier, the nearest tier's best, said in the clave decision (and the trace's `density`).
//                         `compStyle: 'notes'` (the frozen core): one note a stroke (rhythm-claves.js and
//                         chunk-comping.js, ported), a slot's step sounding only where its strike is on one of the bar's
//                         chord tones; the layer whose bars make the best claves (25–50 % of its steps sounding, a
//                         straight or triplet count of steps to the bar, a stroke in every bar). Either way a bar with
//                         no stroke is struck once on its root onset.
//                bass     (Amendment 2, rule 11, P28) Moving · Kick by default: bass.js `arrangeBass` over the finished
//                         spec once its drums are (lines.js' mid band, every kick covered on an in-frame onset, the
//                         density adding the rest; the drums off or no kick in the mode: Moving · Free, said why), so the
//                         part carries its `bass` record and a later arrangeBass at those options gives it again. The
//                         `bass` override ({ density, lock }) asks another; Sparse · Free is the bass before, mined here:
//                         lines.js' bass bar by bar, each bar rooted on its chord's root tone, two octaves under the
//                         lead's range, opening on a tone of the root's class (inside the frame) where it can, else
//                         the cheapest line; a bar with no line plays its root onset (no record, no `bass` decision).
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
//   chart      (`changes`: a chord chart's bars, Composer/CHART_ORDER.md; chart.js) [[shares] × bars], each bar's chords
//              as shares of it. The chart sets the bars (decided, Avery, ruling 1); the slots split every bar evenly where
//              the row's density allows, else each bar's chords spread over them (Euclid; ruling 3) — `chartMeter`. A
//              bar with more than one chord is SPLIT: the chords are a span's each (harmony.js "spans"), and the parts
//              are cut at the spans: a span's chord voices and comping from its own slots, the bass mined over the
//              whole bar with each span's target (opening on the first span's root), the inner over each span's frame.
//              A progression's pins are then one a span. No `changes`, or one chord a bar: everything above, unchanged.
//
// Refusals: { refused: true, reason: 'tooDense' | 'tooLarge' | 'tooFewTones', detail }.
//
// The trace (`trace: true`, or `trace: { caps }` for longer lists: STEP 4a; trace.js, Composer/TRACE.md): `spec.trace`, every decision above as ordered, untimed events
// pointing at the row's onsets, for a renderer to animate. It observes and never steers: without `spec.trace` the spec
// is byte-identical to the one composed with the trace off, and off (the default) nothing of it runs.

import { buildRow, toneGate, isRow, ONSET_GATE, MIN_TONES } from './row.js';
import { buildCells, cropCells, ANCHOR_MODES } from './cells.js';
import { defaultRoot, toneIndexOf, classOfCents, clusterPresence, frameAt, PRESENCE_MODES, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { mineLines, downbeats, TABLES, MAX_SLOTS } from './lines.js';
import { harmonize, phrasesOf, isStrongBeat, harmonyOver, DEFAULT_SETTLE_PASSES, MAX_SETTLE_PASSES } from './harmony.js';
import { spread, evenIn, isPlain, MAX_SHARES } from './chart.js';
import { getInstrument } from '../../Audio/voices/recipes.js';
import { readProgression, harmonyPins, describeProgression } from './progression.js';
import { arrangeDrums, drumGrid } from './drums.js';
import { readRhythm, chooseClave, chooseFrameClave, claveAlternates, claveText, claveSource, layClave, densityWords, COMP_RELATIONS, CLAVE_FROM, COMP_DENSITIES, DEFAULT_COMP_DENSITY } from './claves.js';
import { arrangeBass, bassWhy, BASS_DENSITIES, BASS_LOCKS, COMPOSE_BASS } from './bass.js';
import { createTrace, refusedTrace, traceCapsOf } from './trace.js';
import { placeClip, targetRoot, registerOf, DEFAULTS as TARGET_DEFAULTS } from './target.js';
import { pcName } from './midi.js';

export const COMPOSER_SPEC_VERSION = 'composer-spec-v1';
export const BEATS_PER_BAR = 4;
export const TEMPO_RANGE = Object.freeze([90, 130]);
export const BAR_CHOICES = Object.freeze([1, 2, 4, 8]);
export const SLOT_CHOICES = Object.freeze([8, 6, 4, 3]);
export const MIN_ONSETS_PER_SLOT = 3;
/** the most bars a composition may ask for (the Bars knob is a number: CHART_ORDER.md P8, proposed) */
export const MAX_BARS = 64;
/** a chart's slot counts, in the order tried (P7, proposed): Compose's own, then finer ones for bars of more chords */
export const CHART_SLOT_CHOICES = Object.freeze([8, 6, 4, 3, 12, 16]);
export const PART_IDS = Object.freeze(['lead', 'chords', 'comp', 'bass', 'inner']);
export const SOUND_PAIRS = Object.freeze({ lead: ['flute', 'vibes'], chords: ['warm', 'glassbed'], comp: ['marimba', 'kalimba'], bass: ['sub', 'upright'], inner: ['reed', 'harp'] });
export const VELOCITY = Object.freeze({ lead: 0.8, chords: 0.45, comp: 0.55, bass: 0.75, inner: 0.5 });
export const LEAD_TARGET_HZ = Math.sqrt(440 * 660);
const REGISTER = Object.freeze({ inner: -1200, bass: -2400, chords: -1200 });
const COMP_SHARE = Object.freeze([0.25, 0.5]);
/** the comping's two styles: chords (the default: the clave's strokes, a strum then borrowed tones) and notes (one note a stroke, as before) */
export const COMP_STYLES = Object.freeze(['chords', 'notes']);
/** chords: the strum's window either side of a stroke, as a share of its slot (decided 1: ½ slot in all; P3) */
export const STRUM_WINDOW = 0.25;
/** chords: a stroke's own onset (plus 0.1 a layer more striking it), the strum's other tones, a borrowed tone (P7, proposed) */
export const COMP_VELOCITY = Object.freeze({ stroke: 0.55, strum: 0.5, borrowed: 0.45 });
export const MAX_COMP_VOICES = 4;
const OVERRIDES = Object.freeze(['bars', 'slotsPerBar', 'anchors', 'phase', 'frameCentsEachSide', 'root', 'modulation', 'foldOffsets', 'table', 'sounds', 'legato', 'enabled', 'baseHz', 'compLayer', 'presence', 'settlePasses', 'compStyle', 'clave', 'compRelation', 'voicing', 'claveFrom', 'compDensity', 'bass']);
/** the chords' two voicings (BASS_VOICING_ORDER.md, decided 3–4, P1–P7): led (the default: each tone the octave nearest
 *  the chord before, inside a window, clear of the mud limit) and close (root position from an octave under the root, as before) */
export const VOICINGS = Object.freeze(['led', 'close']);
/** led: two neighbouring voices under an octave apart, n/d in lowest terms, are muddy when the lower sounds under
 *  MUD_HZ × log2(n·d) Hz (P1, proposed) */
export const MUD_HZ = 27;
/** led: the limit never rises past 16/15's (MUD_HZ × log2(240) ≈ 213 Hz; the planner, after phase F): a dense row's
 *  near-simple intervals (191/152 beside 5/4) would otherwise lift the chords over the lead */
export const MUD_CAP_HZ = MUD_HZ * Math.log2(240);
/** led: the window (P3, proposed). No tone under VOICING_FLOOR cents of 1/1 (close's floor: an octave under 1/1, less
 *  50¢), each tone within ±VOICING_REACH of the first chord's centre (3 octaves a tone), the centre within ±VOICING_CENTRE */
export const VOICING_FLOOR = REGISTER.chords - 50;
export const VOICING_REACH = 1800;
export const VOICING_CENTRE = 600;
/** led: a muddy pair costs this, so a voicing clear of the limit always wins over one that is not (P2) */
export const MUD_COST = 1e6;
/** MIDI targets: the overrides a target sets itself (the meter, the phase and the cells from the placement, the root from the tonic, the lead pinned) */
export const TARGET_SETS = Object.freeze(['bars', 'slotsPerBar', 'anchors', 'phase', 'root', 'presence', 'settlePasses']);


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

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
/** a chart's changes checked: [[shares] × bars], whole shares, at most MAX_SHARES a bar and MAX_BARS bars → a copy */
export function checkChanges(changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > MAX_BARS) fail(`changes are [[shares] × bars], 1 to ${MAX_BARS} bars`);
  return changes.map((list, b) => {
    if (!Array.isArray(list) || !list.length || !list.every((n) => Number.isInteger(n) && n >= 1) || sum(list) > MAX_SHARES) fail(`bar ${b + 1}'s changes are whole shares, at most ${MAX_SHARES} in all`);
    return [...list];
  });
}
/**
 * The meter for a chord chart (CHART_ORDER.md; decided: the chart sets the bars, and a bar's chords split it evenly where
 * the row's density allows, else by Euclid): N = the chart's bars; S the first of CHART_SLOT_CHOICES (at least as many
 * slots as a bar has shares) that every bar divides evenly and that holds MIN_ONSETS_PER_SLOT onsets a slot, else
 * Compose's own S for N bars (raised to the most shares a bar has), each bar's shares spread over it (chart.js `spread`).
 * A Slots / bar asked is kept. → chooseMeter's + { even, spans: [{ bar, from (slot of the cycle), slots }] }
 */
export function chartMeter(n, T, changes, { slotsPerBar = null } = {}) {
  const N = changes.length, most = Math.max(...changes.map(sum)), notes = [`${N} bar${N > 1 ? 's' : ''}: the chart's (decided: a chart sets the bars)`];
  let S = slotsPerBar;
  if (S == null) {
    const dense = (x) => n / (N * x) >= MIN_ONSETS_PER_SLOT - EPS;
    S = CHART_SLOT_CHOICES.find((x) => x >= most && evenIn(changes, x) && dense(x)) ?? null;
    if (S != null) notes.push(`${S} slots a bar: every bar's chords split it evenly, ${(n / (N * S)).toFixed(1)} onsets a slot`);
    else {
      S = chooseMeter(n, T, { bars: N }).slotsPerBar;
      if (S < most) S = CHART_SLOT_CHOICES.filter((x) => x >= most).sort((a, b) => a - b)[0];
      notes.push(`no slot count splits every bar evenly at ${MIN_ONSETS_PER_SLOT}+ onsets a slot: ${S} slots a bar, ${evenIn(changes, S) ? 'even' : 'each bar\'s chords spread over them as evenly as whole slots allow (Euclid)'}`);
    }
  } else {
    if (S < most) fail(`a bar of ${most} chords needs at least ${most} slots, not ${S}`);
    notes.push(`${S} slots a bar asked${evenIn(changes, S) ? '' : ': the chords spread over them as evenly as whole slots allow (Euclid)'}`);
  }
  const spans = changes.flatMap((shares, b) => spread(shares, S).map((x) => ({ bar: b, from: b * S + x.from, slots: x.slots })));
  return { bars: N, slotsPerBar: S, tempoBpm: (60 * N * BEATS_PER_BAR) / T, notes, even: evenIn(changes, S), spans };
}

/** the recipe's own envelope: struck sounds die away and retrigger in legato */
export const isStruck = (sound) => getInstrument(sound)?.roles?.note?.amp?.kind === 'struck';

/**
 * Times and lengths for one voice's notes (each with `time` and `slotSeconds`), in place, in time order:
 * legato on, a note holds until the next; off, it lasts its slot or the gap to the next if shorter; the last runs
 * to the cycle's end. A note with its own `endTime` (a MIDI target's lead: its note-off onset, P4) lasts until then,
 * whatever the legato; one with a `holdTo` (a comp stroke's tone: the next stroke, or its span's end) holds no further.
 * A note retriggers unless the voice is legato on a held sound and it is not the first.
 */
export function articulate(notes, { legato, struck, cycleSeconds }) {
  notes.sort((a, b) => a.time - b.time || a.node - b.node);
  notes.forEach((n, i) => {
    const next = i + 1 < notes.length ? notes[i + 1].time : cycleSeconds;
    const gap = (n.holdTo != null ? Math.min(next, n.holdTo) : next) - n.time;
    n.duration = Math.max(0, n.endTime != null ? n.endTime - n.time : legato ? gap : Math.min(n.slotSeconds, gap));
    n.retrigger = !legato || struck || i === 0;
  });
  return notes;
}

/**
 * A part of a spec played with another sound or legato (the lab's toggles): its notes' durations and retriggers
 * re-derived by `articulate`, voice by voice in the chords part (and the comp in chords), nothing re-mined. → a new part
 */
export function rearticulate(part, { sound = part.sound, legato = part.legato, enabled = part.enabled, cycleSeconds }) {
  if (!(cycleSeconds > 0)) fail('rearticulate needs the cycle\'s seconds');
  const struck = isStruck(sound), notes = part.notes.map((n) => ({ ...n }));
  const voiced = part.id === 'chords' || (part.id === 'comp' && part.strokes != null);
  const laneOf = (n) => n.lane ?? n.voice;   // led chords lane by register (P6), close by class
  const groups = voiced ? [...new Set(notes.map(laneOf))].map((v) => notes.filter((n) => laneOf(n) === v)) : [notes];
  for (const g of groups) articulate(g, { legato, struck, cycleSeconds });
  notes.sort((a, b) => a.time - b.time || a.node - b.node);
  return { ...part, sound, struck, legato, enabled, notes };
}

// ── the part builders (STEP 4a: lifted out of compose() unchanged, so Compose and a rearrange are the same code) ──
//
// Each reads the row through a part context (`partContext`) and a bar's chord as harmony.js records it (`chordRecord`:
// rootCents, rootTone, rootNode, intervals, frame). A note here is the builders' own shape, { node, tone, octave, pitch,
// bar, slot, time, slotSeconds, (voice | strikes | strong) }; `partOf` turns a part's notes into the spec's.

/**
 * The geometry every part is read through: the cycle's time from the phase, each onset's slot and bar, the slots' onsets
 * in time order (built on first use), and the chord-class test.
 *   opts { cycleSeconds, phase ([num, den]: bar 1's downbeat), frameCentsEachSide,
 *          rowCycleSeconds (MIDI targets: the row's cycle when the cells are cropped to a window, cells.js `cropCells`;
 *          `cycleSeconds` is then the LOOP, the window's span) }
 * → { row, cells, T, rowT, S, N, P, e, phaseX, timeOf, slotSeconds, starts, posSlot, inBar, inSlot, pitchAtLeast, chordClass }
 * Cropped cells (a window): an onset inside the window sounds at its own time on the row's cycle; one before the window's
 * first anchor that slot 0's window holds sounds at the loop's end (as one before the cycle's first anchor sounds at the
 * cycle's end), in the last slot; any other onset outside the window is in no slot (posSlot −1) and no bar.
 */
export function partContext(row, cells, { cycleSeconds: T, phase, frameCentsEachSide: e, rowCycleSeconds: rowT = T }) {
  const S = cells.slotsPerBar, N = cells.bars, P = N * S, phaseX = phase[0] / phase[1];
  const crop = cells.crop ?? null, W = crop ? crop.end : 1;
  const timeOf = crop ? (tick) => { const u = mod(tick / row.grid - phaseX, 1); return u < W ? u * rowT : T - (1 - u) * rowT; }
    : (tick) => mod(tick / row.grid - phaseX, 1) * T;
  const slotSeconds = (cell) => cells.slots[cell].length * rowT;
  // every onset's bar and slot by its place from the phase (a bar runs from its first anchor to the next bar's)
  const starts = cells.slots.map((s) => mod(s.anchor - phaseX, 1));
  const posSlot = new Int32Array(row.n);
  for (let i = 0; i < row.n; i++) {
    const x = mod(row.x[i] - phaseX, 1); let lo = 0, hi = P - 1;
    if (crop && x >= W) { posSlot[i] = cells.slotOfNode[i] === 0 ? P - 1 : -1; continue; }
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x + EPS) lo = mid; else hi = mid - 1; }
    posSlot[i] = lo;
  }
  const inBar = Array.from({ length: N }, () => []);
  for (let i = 0; i < row.n; i++) if (posSlot[i] >= 0) inBar[Math.floor(posSlot[i] / S)].push(i);
  let inSlot = null;
  const pitchAtLeast = (tone, floor) => { const c = row.toneCents[tone], octave = Math.ceil((floor - c) / 1200 - EPS); return { octave, pitch: c + 1200 * octave }; };
  const chordClass = (c, tone) => { const k = classOfCents(row.toneCents[tone] - c.rootCents); return Math.abs(k.dev) <= e + EPS && c.intervals.includes(k.pc) ? k.pc : -1; };
  return {
    row, cells, T, rowT, S, N, P, e, phaseX, timeOf, slotSeconds, starts, posSlot, inBar, pitchAtLeast, chordClass,
    /** each slot's onsets, in time order (then row order) */
    get inSlot() {
      if (!inSlot) {
        inSlot = Array.from({ length: P }, () => []);
        for (let i = 0; i < row.n; i++) if (posSlot[i] >= 0) inSlot[posSlot[i]].push(i);
        for (const list of inSlot) list.sort((a, b) => timeOf(row.tick[a]) - timeOf(row.tick[b]) || a - b);
      }
      return inSlot;
    },
  };
}

/** a builder's note on onset i, in a register (octave and pitch given) */
const noteAt = (ctx, i, octave, pitch, bar, extra = {}) => ({ node: i, tone: ctx.row.tone[i], octave, pitch, bar, slot: ctx.posSlot[i], time: ctx.timeOf(ctx.row.tick[i]), slotSeconds: ctx.slotSeconds(ctx.posSlot[i]), ...extra });

/** the lead's notes (harmony.js' line notes: node, tone, octave, pitch, bar, cell, beat) as the builders' notes */
export function leadNotesOf(ctx, notes) {
  const { row, S, timeOf, slotSeconds } = ctx;
  return notes.map((n) => ({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: n.bar, slot: n.cell, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.cell), strong: isStrongBeat(n.beat, S) }));
}

/**
 * Bar k's chord voices: a voice a chord class (root first, then up), each the bar's onset of that class inside the bar's
 * frame with the most strikes (then the earliest), stacked close from an octave under the root up. → [note with `voice`]
 */
export function chordVoicesOfBar(ctx, c, k, range = null) {
  const { row, inBar, timeOf, pitchAtLeast, chordClass, posSlot } = ctx, out = [];
  let floor = c.rootCents + REGISTER.chords - 50;
  // a chart's span (CHART_ORDER.md P6): the bar's onsets in the span's slots [from, to) only
  const own = range ? inBar[k].filter((i) => posSlot[i] >= range.from && posSlot[i] < range.to) : inBar[k];
  c.intervals.forEach((pc, v) => {
    let best = -1;
    for (const i of own) if (chordClass(c, row.tone[i]) === pc && (best < 0 || row.strikes[i] > row.strikes[best] || (row.strikes[i] === row.strikes[best] && timeOf(row.tick[i]) < timeOf(row.tick[best])))) best = i;
    if (best < 0) return;
    const { octave, pitch } = pitchAtLeast(row.tone[best], floor);
    floor = pitch + 1;
    out.push(noteAt(ctx, best, octave, pitch, k, { voice: v }));
  });
  return out;
}

// ── the voicing pass (BASS_VOICING_ORDER.md phase F: decided 3–4, P1–P6; the loop closed, Amendment 1: rule 8, P25) ──

const fractionCache = new WeakMap();
/** the row's tones as exact fractions → [{ n, d (BigInt), value }] */
function fractionsOf(row) {
  let f = fractionCache.get(row);
  if (!f) { f = row.tones.map((t) => { const [n, d] = t.split('/').map((x) => BigInt(x)); return { n, d, value: Number(n) / Number(d) }; }); fractionCache.set(row, f); }
  return f;
}
const gcdBig = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
/** log2(n·d) of the interval from tone lo (octave ol) up to tone hi (octave oh), n/d in lowest terms */
function intervalWeight(F, lo, ol, hi, oh) {
  let num = F[hi].n * F[lo].d, den = F[hi].d * F[lo].n;
  const up = oh - ol;
  if (up > 0) num <<= BigInt(up); else if (up < 0) den <<= BigInt(-up);
  const g = gcdBig(num, den);
  return Math.log2(Number(num / g)) + Math.log2(Number(den / g));
}
/**
 * The mud limit (P1): a chord's notes ({ tone, bar, slot }) at the given octaves, how many neighbouring pairs (in pitch
 * order) are muddy — less than an octave apart, and the lower sounding (baseHz × its tone × 2^octave × its bar's retune)
 * under MUD_HZ × log2(n·d) (at most MUD_CAP_HZ), n/d the pair's interval in lowest terms. `memo` keeps the weights of one pass.
 */
export function muddyPairs(row, notes, octaves, { baseHz, ratioOf, memo = new Map() }) {
  const F = fractionsOf(row), idx = notes.map((_, i) => i), pitch = (i) => row.toneCents[notes[i].tone] + 1200 * octaves[i];
  idx.sort((a, b) => pitch(a) - pitch(b) || notes[a].voice - notes[b].voice);
  let muddy = 0;
  for (let x = 0; x + 1 < idx.length; x++) {
    const a = idx[x], b = idx[x + 1];
    if (pitch(b) - pitch(a) >= 1200 - EPS) continue;
    const ta = notes[a].tone, tb = notes[b].tone, key = `${ta}:${tb}:${octaves[b] - octaves[a]}`;
    let w = memo.get(key);
    if (w === undefined) { w = intervalWeight(F, ta, octaves[a], tb, octaves[b]); memo.set(key, w); }
    const hz = baseHz * F[ta].value * 2 ** octaves[a] * ratioOf(notes[a].bar, notes[a].slot);
    if (hz < Math.min(MUD_HZ * w, MUD_CAP_HZ) - EPS) muddy++;
  }
  return muddy;
}

/**
 * The voicing pass (P1–P3, P6; the loop closed, Amendment 1 P25, rule 8): the chord voices of every bar (a chart's span
 * each), their tones as chosen (which onset each class sounds) and only their octaves set, in place, the whole loop at once:
 *   the anchor   the first chord's close voicing (root first, each voice the lowest above the one under it, from an
 *                octave under the root, as `chordVoicesOfBar` stacks it), lifted by octaves until no pair is muddy; its
 *                centre (the mean pitch as it sounds) is the window's, so the register can't creep
 *   the states   each chord's octave assignments in the window — each tone not under VOICING_FLOOR and within
 *                ±VOICING_REACH of the anchor's centre (3 octaves), the voicing's centre within ±VOICING_CENTRE of it
 *                (none: those whose centre is nearest it) — the first chord's as well as the rest
 *   the cycle    one objective over the loop: every chord-to-chord motion (each tone to its nearest tone of the chord
 *                before, in cents as they sound: the bar's retune in), the last chord back to the first included, each
 *                the same weight, plus MUD_COST a muddy pair. Viterbi over the states, once for each of the first
 *                chord's (the wrap added), keeps the cheapest cycle; ties to less mud, then the first chord nearest the
 *                anchor (its motion from the anchor's voicing: the builder's, so a loop the motion can't tell from its
 *                octave shifts stays where the anchor put it), then the centres nearest the anchor's (summed), then the
 *                lower centres (summed), then the first in order (chord by chord from the first, voice 0's octave lowest
 *                first). The cycle's motion alone is solved first; when it is clear of the mud limit it is the answer
 *   one chord    no wrap and nothing to lead: the least mud, then nearest the anchor (the anchor itself when it is clear)
 * Each note gains `lane`, its order in its chord from the lowest (0). A unit with no voices is skipped (the chords either
 * side of it are neighbours). Every choice reads only the tones, never the octaves given, so running it again on its own
 * output changes nothing.
 *   units  [{ chord (harmony.js' record: rootCents), notes: [builder note with voice, tone, octave, pitch, bar, slot] }]
 *   opts   { baseHz, ratioOf ((bar, slot) → the bar's fundamentalRatio) }
 * → { chords (voiced), lifted (chords the mud limit moved: the anchor when lifted, and every chord whose octaves differ
 *     from the cycle that weighs motion alone), anchorLifted, muddy (chords left with a muddy pair: none in the window is
 *     clear), motion (cents, the bar lines': every chord from the one before, the wrap not in it), wrap (the last chord
 *     back to the first, led like every change), moves (the loop's changes: chords − 1 bar lines and the wrap; 0 for
 *     one chord), meanMotion ((motion + wrap) / moves), cost (the cycle's: motion + wrap + MUD_COST a muddy pair),
 *     centre (the anchor's, cents as it sounds), outside (chords with no assignment in the window), states (the most a
 *     chord had) }
 */
export function voiceLead(ctx, units, { baseHz, ratioOf }) {
  const { row } = ctx, memo = new Map(), mud = { baseHz, ratioOf, memo };
  const shiftOf = (n) => 1200 * Math.log2(ratioOf(n.bar, n.slot));
  const motionOf = (cur, prev) => { let m = 0; for (const s of cur) { let best = Infinity; for (const p of prev) { const d = Math.abs(s - p); if (d < best) best = d; } m += best; } return m; };
  const stats = { chords: 0, lifted: 0, anchorLifted: false, muddy: 0, motion: 0, wrap: 0, moves: 0, meanMotion: 0, cost: 0, centre: null, outside: 0, states: 0 };
  const chords = [];
  for (const unit of units) {
    const notes = [...unit.notes].sort((a, b) => a.voice - b.voice);
    if (!notes.length) continue;
    const cents = notes.map((n) => row.toneCents[n.tone]), shift = notes.map(shiftOf);
    chords.push({ unit, notes, cents, shift, sounding: (oct) => oct.map((o, i) => cents[i] + 1200 * o + shift[i]) });
  }
  const N = stats.chords = chords.length;
  if (!N) return stats;

  // the anchor: the first chord close, as chordVoicesOfBar stacks it, lifted an octave at a time while a pair is muddy
  const c0 = chords[0];
  let floor = c0.unit.chord.rootCents + REGISTER.chords - 50;
  const close = c0.notes.map((n, i) => { const o = Math.ceil((floor - c0.cents[i]) / 1200 - EPS); floor = c0.cents[i] + 1200 * o + 1; return o; });
  let lift = 0;
  while (lift < 12 && muddyPairs(row, c0.notes, close.map((o) => o + lift), mud) > 0) lift++;
  const anchor = close.map((o) => o + lift), anchorS = c0.sounding(anchor);
  const centre = anchorS.reduce((a, b) => a + b, 0) / anchorS.length;
  stats.centre = centre; stats.anchorLifted = lift > 0;

  // each chord's states: every assignment of octaves in the window, cut to those whose centre is inside (or nearest it)
  const states = chords.map((c) => {
    const options = c.notes.map((n, i) => {
      const lo = Math.max(Math.ceil((VOICING_FLOOR - c.cents[i]) / 1200 - EPS), Math.ceil((centre - VOICING_REACH - c.cents[i] - c.shift[i]) / 1200 - EPS));
      const hi = Math.ceil((centre + VOICING_REACH - c.cents[i] - c.shift[i]) / 1200 - EPS) - 1;
      const out = []; for (let o = lo; o <= hi; o++) out.push(o);
      return out.length ? out : [lo];
    });
    // each tone's pitch (as it sounds) at each of its octaves, and every assignment (its octaves' indices, `at`)
    c.heard = options.map((os, i) => os.map((o) => c.cents[i] + 1200 * o + c.shift[i]));
    const all = [];
    const walk = (i, acc) => { if (i === c.notes.length) { all.push([...acc]); return; } for (let a = 0; a < options[i].length; a++) { acc.push(a); walk(i + 1, acc); acc.pop(); } };
    walk(0, []);
    const scored = all.map((at) => { const oct = at.map((a, i) => options[i][a]), s = c.sounding(oct), mean = s.reduce((a, b) => a + b, 0) / s.length; return { oct, at, s, mean, off: Math.max(0, Math.abs(mean - centre) - VOICING_CENTRE) }; });
    const least = Math.min(...scored.map((x) => x.off));
    if (least > EPS) stats.outside++;
    const inside = scored.filter((x) => x.off <= least + EPS);
    for (const x of inside) x.mud = muddyPairs(row, c.notes, x.oct, mud);
    stats.states = Math.max(stats.states, inside.length);
    return inside;
  });
  // the first chord's: each one's motion from the anchor (the anchor's own 0), the ties' first order after the cost
  for (const x of states[0]) x.fromAnchor = motionOf(x.s, anchorS);
  let chosen;
  if (N === 1) {
    // one chord: no wrap, nothing to lead from; the least mud, then nearest the anchor (the anchor itself when it is
    // clear), then the centre nearest the anchor's, then the lower, then the first
    const key = (x) => [x.mud, x.fromAnchor, Math.abs(x.mean - centre), x.mean];
    const pick = states[0].reduce((b, x) => { const p = key(x), q = key(b); for (let i = 0; i < 4; i++) { if (p[i] < q[i] - (i ? EPS : 0)) return x; if (p[i] > q[i] + (i ? EPS : 0)) return b; } return b; });
    chosen = [pick];
    if (stats.anchorLifted || pick.fromAnchor > EPS) stats.lifted = 1;
  } else {
    // the motions, flat [from · S + to]: into chord i + 1 from chord i (step[i]), and the wrap, into the first from the
    // last. A state's motion from p is the sum of its tones' distances to p's nearest, so each tone's distance at each of
    // its octaves is found once a state p (near[j][a]) and a state's motion is the sum of its tones' (motionOf's, in order)
    const motions = (i, k) => {
      const from = states[i], to = states[k], heardTo = chords[k].heard, n = to.length, M = new Float64Array(from.length * n);
      from.forEach((p, x) => {
        const near = heardTo.map((hs) => hs.map((h) => { let best = Infinity; for (const u of p.s) { const d = Math.abs(h - u); if (d < best) best = d; } return best; }));
        for (let y = 0; y < n; y++) { const at = to[y].at; let m = 0; for (let j = 0; j < at.length; j++) m += near[j][at[j]]; M[x * n + y] = m; }
      });
      return M;
    };
    const step = [];
    for (let i = 0; i + 1 < N; i++) step.push(motions(i, i + 1));
    const wrapM = motions(N - 1, 0);
    // the cycle on motion alone first: clear of the mud limit, it is the cheapest with the mud weighed too (and the
    // same under the ties), so the mud limit moved nothing but, perhaps, the anchor
    const plain = solveCycle(states, step, wrapM, false, centre);
    const best = plain.some((x, i) => states[i][x].mud > 0) ? solveCycle(states, step, wrapM, true, centre) : plain;
    chosen = best.map((x, i) => states[i][x]);
    const moved = new Set(best.flatMap((x, i) => (x !== plain[i] ? [i] : [])));
    if (stats.anchorLifted) moved.add(0);
    stats.lifted = moved.size;
    for (let i = 0; i + 1 < N; i++) stats.motion += step[i][best[i] * states[i + 1].length + best[i + 1]];
    stats.wrap = wrapM[best[N - 1] * states[0].length + best[0]];
    stats.moves = N;
  }
  chords.forEach((c, i) => {
    const { oct, s } = chosen[i];
    if (chosen[i].mud > 0) stats.muddy++;
    stats.cost += MUD_COST * chosen[i].mud;
    c.notes.forEach((n, j) => { n.octave = oct[j]; n.pitch = c.cents[j] + 1200 * oct[j]; });
    [...c.notes.keys()].sort((a, b) => s[a] - s[b] || c.notes[a].voice - c.notes[b].voice).forEach((j, lane) => { c.notes[j].lane = lane; });
  });
  stats.cost += stats.motion + stats.wrap;
  stats.meanMotion = stats.moves ? (stats.motion + stats.wrap) / stats.moves : 0;
  return stats;
}

/** two cycle costs as voiceLead orders them: a before b — the cost (c) less by more than EPS, then fewer muddy pairs (m),
 *  then the centres nearer the anchor's (d, summed |centre − the anchor's|, by more than EPS), then the lower centres
 *  (z, summed, by more than EPS) */
const costLess = (ac, am, ad, az, bc, bm, bd, bz) => ac < bc - EPS || (ac <= bc + EPS && (am < bm || (am === bm && (ad < bd - EPS || (ad <= bd + EPS && az < bz - EPS)))));
/**
 * The cheapest cycle over the chords' states (P25). Cost: motion (`step[i]`, into chord i + 1 from chord i, and
 * `wrapM`, into the first from the last, each flat [from · S + to]) plus, `withMud`, MUD_COST a muddy pair; then the
 * muddy pairs; then the centres nearest the anchor's (`centre`); then the lower centres. For a first state f, the
 * cost-to-go is built back from the last chord (its wrap into f its terminal cost), and the cycle is read forward from f
 * taking, at each chord, the first state whose motion in plus cost-to-go is least, so among equal cycles the first in
 * order wins (chord by chord from the first). Every first state is weighed (the first of the least wins), but one whose
 * lower bound (the same pass with each last state's cheapest wrap into any first state) is already dearer than the best
 * found is skipped: it can't win. → each chord's state index
 */
function solveCycle(states, step, wrapM, withMud, centre) {
  const N = states.length, S = states.map((st) => st.length), S0 = S[0], L = S[N - 1];
  const nc = states.map((st) => Float64Array.from(st, (x) => (withMud ? MUD_COST * x.mud : 0)));
  const nm = states.map((st) => Float64Array.from(st, (x) => (withMud ? x.mud : 0)));
  const nd = states.map((st) => Float64Array.from(st, (x) => Math.abs(x.mean - centre)));
  const nz = states.map((st) => Float64Array.from(st, (x) => x.mean));
  // the cost-to-go from chord 0's states `fs`, the last chord's terminal cost `term`; keep: each chord's choice
  const back = (term, fs, keep) => {
    let Gc = new Float64Array(L), Gm = new Float64Array(L), Gd = new Float64Array(L), Gz = new Float64Array(L);
    for (let x = 0; x < L; x++) { Gc[x] = nc[N - 1][x] + term[x]; Gm[x] = nm[N - 1][x]; Gd[x] = nd[N - 1][x]; Gz[x] = nz[N - 1][x]; }
    const next = keep ? new Array(N - 1) : null;
    for (let i = N - 2; i >= 0; i--) {
      const n = S[i + 1], M = step[i], cnt = i === 0 ? fs.length : S[i];
      const Hc = new Float64Array(S[i]), Hm = new Float64Array(S[i]), Hd = new Float64Array(S[i]), Hz = new Float64Array(S[i]), arg = keep ? new Int32Array(S[i]) : null;
      for (let k = 0; k < cnt; k++) {
        const x = i === 0 ? fs[k] : k, base = x * n;
        let by = 0, bc = Gc[0] + M[base], bm = Gm[0], bd = Gd[0], bz = Gz[0];
        for (let y = 1; y < n; y++) {
          const c = Gc[y] + M[base + y];
          if (costLess(c, Gm[y], Gd[y], Gz[y], bc, bm, bd, bz)) { by = y; bc = c; bm = Gm[y]; bd = Gd[y]; bz = Gz[y]; }
        }
        Hc[x] = nc[i][x] + bc; Hm[x] = nm[i][x] + bm; Hd[x] = nd[i][x] + bd; Hz[x] = nz[i][x] + bz;
        if (keep) arg[x] = by;
      }
      Gc = Hc; Gm = Hm; Gd = Hd; Gz = Hz;
      if (keep) next[i] = arg;
    }
    return { Gc, Gm, Gd, Gz, next };
  };
  const all = Array.from({ length: S0 }, (_, f) => f), term = new Float64Array(L);
  for (let x = 0; x < L; x++) { let m = Infinity; for (let f = 0; f < S0; f++) m = Math.min(m, wrapM[x * S0 + f]); term[x] = m; }
  const lb = back(term, all, false).Gc;
  // the first states: by the cycle's cost and mud, then the first chord's motion from the anchor (`a`: constant for a
  // first state, so it only orders them), then the centres and the order
  const a = states[0].map((x) => x.fromAnchor);
  const firstLess = (f, c, m, d, z, g, gc, gm, gd, gz) => (Math.abs(c - gc) > EPS ? c < gc : m !== gm ? m < gm : Math.abs(a[f] - a[g]) > EPS ? a[f] < a[g]
    : costLess(c, m, d, z, gc, gm, gd, gz) || (!costLess(gc, gm, gd, gz, c, m, d, z) && f < g));
  let best = -1, bc = 0, bm = 0, bd = 0, bz = 0;
  for (const f of all.sort((x, y) => lb[x] - lb[y] || x - y)) {
    if (best >= 0 && lb[f] > bc + EPS) break;
    for (let x = 0; x < L; x++) term[x] = wrapM[x * S0 + f];
    const g = back(term, [f], false), c = g.Gc[f], m = g.Gm[f], d = g.Gd[f], z = g.Gz[f];
    if (best < 0 || firstLess(f, c, m, d, z, best, bc, bm, bd, bz)) { best = f; bc = c; bm = m; bd = d; bz = z; }
  }
  for (let x = 0; x < L; x++) term[x] = wrapM[x * S0 + best];
  const { next } = back(term, [best], true), path = [best];
  for (let i = 0; i + 1 < N; i++) path.push(next[i][path[i]]);
  return path;
}
/** the voicing decision's words for a led voicing (voiceLead's stats; asked: the override given): Compose's, and a
 *  live Close | Led switch's (rearrange.js `revoice`, Phase H), so the two say the same */
export const voicingWhy = (voiced, asked) => `${asked ? 'asked' : 'led by default (decided 3–4, Avery)'}: `
  + (voiced.chords > 1
    ? `the loop closed (rule 8, Avery): every chord's octaves chosen together, so the loop's motion is least, each change weighed the same, the last chord back to the first included, clear of the mud limit (${MUD_HZ} Hz × log2(n·d), at most ${Math.round(MUD_CAP_HZ)} Hz, under a pair less than an octave apart) where the window allows`
      + `; the window centred on the first chord's close voicing, ${voiced.anchorLifted ? '' : 'not '}lifted clear of the mud limit (no tone under ${VOICING_FLOOR}¢, each chord's centre within ±${VOICING_CENTRE}¢ of it), ${(voiced.meanMotion).toFixed(0)}¢ of motion a chord`
      + `; the mud limit moved ${voiced.lifted} of ${voiced.chords} chords${voiced.muddy ? `, ${voiced.muddy} left muddy (no voicing in the window clear of it)` : ''}; the loop's wrap ${voiced.wrap.toFixed(0)}¢ (led, as every change)`
    : `one chord, so no wrap and nothing to lead: its close voicing, ${voiced.anchorLifted ? '' : 'not '}lifted clear of the mud limit (${MUD_HZ} Hz × log2(n·d), at most ${Math.round(MUD_CAP_HZ)} Hz, under a pair less than an octave apart)`
      + `; the mud limit moved ${voiced.lifted} of 1 chord${voiced.muddy ? ', left muddy' : ''}; the loop's wrap 0¢`);
/** the voicing pass's stats as the spec keeps them (`stats.voicing`; rounded to the cent): motion the bar lines', wrap the
 *  last chord back to the first (led), meanMotion over the loop's changes, the wrap one of them */
export const voicingStats = (v) => ({ mode: 'led', chords: v.chords, lifted: v.lifted, muddy: v.muddy, motion: Math.round(v.motion), meanMotion: Math.round(v.meanMotion), wrap: Math.round(v.wrap), outside: v.outside });

/** a layer (its bit index b) cut into bar k's slots (or a span's [from, to)): { steps (slots it strikes), on (each struck
 *  slot's first strike, where it is a chord tone) }. `c` a chord, or a slot's chord (j → chord) across a split bar. */
function compStepsOfBar(ctx, c, k, b, range = null) {
  const { row, S, inSlot, chordClass } = ctx;
  let steps = 0; const on = [];
  for (let j = range ? range.from : k * S; j < (range ? range.to : (k + 1) * S); j++) {
    const first = inSlot[j].find((i) => row.owners[i] & (1 << b));
    if (first === undefined) continue;
    steps++;
    if (chordClass(typeof c === 'function' ? c(j) : c, row.tone[first]) >= 0) on.push(first);
  }
  return { steps, on };
}
/** the slots a chord's comping reads: its span's [from, to) in a chart's split bar, else bar k's */
const compRangeOf = (ctx, c, k) => (c.slots != null ? { from: c.from, to: c.from + c.slots } : { from: k * ctx.S, to: (k + 1) * ctx.S });
/**
 * The strum around stroke s (decided 1, P3): for each of chord c's classes, its onset nearest the stroke within
 * ±STRUM_WINDOW of the stroke's slot, inside slots [from, to) (ties: the most strikes, then the earliest).
 * → Map(class → node)
 */
export function strumOf(ctx, c, s, from, to) {
  const { row, inSlot, timeOf, chordClass, slotSeconds, posSlot } = ctx;
  const j = posSlot[s], ts = timeOf(row.tick[s]), w = STRUM_WINDOW * slotSeconds(j) + EPS, best = new Map();
  const take = (i, t) => {
    const pc = chordClass(c, row.tone[i]); if (pc < 0) return;
    const d = Math.abs(t - ts), was = best.get(pc);
    if (!was || d < was.d - EPS || (d <= was.d + EPS && (row.strikes[i] > row.strikes[was.i] || (row.strikes[i] === row.strikes[was.i] && t < was.t)))) best.set(pc, { i, t, d });
  };
  // outward from the stroke's slot, each slot's onsets in time order, until one falls past the window
  for (let q = j; q >= from; q--) {
    const list = inSlot[q]; let past = false;
    for (let x = list.length - 1; x >= 0; x--) { const i = list[x], t = timeOf(row.tick[i]); if (t < ts - w) { past = true; break; } if (t <= ts + w) take(i, t); }
    if (past) break;
  }
  for (let q = j + 1; q < to; q++) {
    const list = inSlot[q]; let past = false;
    for (const i of list) { const t = timeOf(row.tick[i]); if (t > ts + w) { past = true; break; } if (t >= ts - w) take(i, t); }
    if (past) break;
  }
  return new Map([...best].map(([pc, x]) => [pc, x.i]));
}
/**
 * Every layer's comping, scored over the bars (`compStyle: 'notes'`, the frozen core; rhythm-claves.js and
 * chunk-comping.js, ported): 25–50 % of its steps on chord tones, a straight or triplet count of steps to the bar, a
 * stroke in every bar. (The chords style's layer score, P2, retired with Amendment 1: the clave leads it, claves.js.)
 * → [{ layer (bit index), value, score, hits: [bar → strokes] }], in row.active's order
 */
export function compChoicesOf(ctx, chords, { chordAt = null, style = 'notes' } = {}) {
  const { row, N } = ctx;
  if (style !== 'notes') fail('the comp layer is scored for compStyle \'notes\' only: in chords the clave leads (claves.js)');
  return row.active.map((b) => {
    let density = 0, fit = 0, covered = 0;
    const hits = [];
    for (let k = 0; k < N; k++) {
      const { steps, on } = compStepsOfBar(ctx, chordAt ?? chords[k], k, b);
      const x = steps ? on.length / steps : 0, [lo, hi] = COMP_SHARE;
      density += x < lo ? x / lo : x > hi ? (1 - x) / (1 - hi) : 1;
      fit += [4, 8, 16].includes(steps) ? 1 : [3, 6, 12].includes(steps) ? 0.75 : 0.4;
      if (on.length) covered++;
      hits.push(on);
    }
    return { layer: b, value: row.layers[b], score: (density + fit + covered) / (3 * N), hits };
  });
}
/** bar k's comping on the given layer (its bit index): the struck slots on chord tones, else the root onset once → [note
 *  with `strikes`]. `range` ({ from, to }: a chart's span) cuts it to the span's slots. */
export function compOfBar(ctx, c, k, layer, range = null) {
  const { row, S, posSlot, pitchAtLeast } = ctx, floor = c.rootCents + REGISTER.chords - 50;
  const { on } = compStepsOfBar(ctx, c, k, layer, range);
  const inside = (i) => (range ? posSlot[i] >= range.from && posSlot[i] < range.to : Math.floor(posSlot[i] / S) === k);
  const strokes = on.length ? on : (c.rootNode != null && inside(c.rootNode) ? [c.rootNode] : []);
  return strokes.map((i) => { const { octave, pitch } = pitchAtLeast(row.tone[i], floor); return noteAt(ctx, i, octave, pitch, k, { strikes: row.strikes[i] }); });
}
/**
 * Bar k's comping in chords (P3–P7) on the given strokes (onsets: the clave's landed steps in the bar or span, claves.js
 * `layClave`; none: the root onset once), each the strum of the bar's chord around it, a class missing there borrowed from the bar's chord voice of that class (at
 * the stroke's time and onset, its tone the voice's: `borrowed`, `from`), left out if the chords have none either. A
 * voice a class (root first, at most MAX_COMP_VOICES), stacked close from an octave under the root; every tone holds at
 * most to the next stroke, or the span's end (`holdTo`). `range` ({ from, to }: a chart's span) cuts it to the span.
 * → { notes: [note with voice, velocity, holdTo (, borrowed, from)], strokes: [{ node, tick, time, bar, slot }], found, tones }
 */
export function compChordsOfBar(ctx, c, k, given, range = null, voiced = null) {
  const { row, S, P, T, rowT, starts, posSlot, pitchAtLeast, timeOf } = ctx;
  const from = range ? range.from : k * S, to = range ? range.to : (k + 1) * S;
  let strokes = [...new Set(given)].filter((s) => posSlot[s] >= from && posSlot[s] < to);
  if (!strokes.length && c.rootNode != null && posSlot[c.rootNode] >= from && posSlot[c.rootNode] < to) strokes = [c.rootNode];
  const voiceOf = new Map((voiced ?? chordVoicesOfBar(ctx, c, k, range)).map((n) => [n.voice, n]));
  const at = strokes.map((s) => ({ s, t: timeOf(row.tick[s]) })).sort((a, b) => a.t - b.t || a.s - b.s);
  const end = to < P ? starts[to] * rowT : T, notes = [];
  let found = 0, tones = 0;
  at.forEach(({ s, t }, x) => {
    // to the next stroke, never past the span; a stroke before the downbeat (sounding at the cycle's end) holds to that end
    const holdTo = t < end ? Math.min(x + 1 < at.length ? at[x + 1].t : end, end) : T;
    const got = strumOf(ctx, c, s, from, to);
    let floor = c.rootCents + REGISTER.chords - 50;
    c.intervals.slice(0, MAX_COMP_VOICES).forEach((pc, v) => {
      const i = got.get(pc), src = i === undefined ? voiceOf.get(v) : null;
      if (i === undefined && !src) return;
      const tone = i !== undefined ? row.tone[i] : src.tone;
      // led (P5): a strum tone the octave nearest its class's chord voice, a borrowed tone the voice itself; close: stacked
      const led = voiced ? voiceOf.get(v) : null;
      let octave, pitch;
      if (led) { octave = i === undefined ? led.octave : Math.round((led.pitch - row.toneCents[tone]) / 1200); pitch = row.toneCents[tone] + 1200 * octave; }
      else ({ octave, pitch } = pitchAtLeast(tone, floor));
      floor = pitch + 1; tones++;
      const lane = led ? { lane: led.lane } : {};
      if (i !== undefined) { found++; notes.push(noteAt(ctx, i, octave, pitch, k, { voice: v, ...lane, velocity: i === s ? Math.min(1, COMP_VELOCITY.stroke + 0.1 * Math.max(0, row.strikes[s] - 1)) : COMP_VELOCITY.strum, holdTo })); }
      else notes.push(noteAt(ctx, s, octave, pitch, k, { tone, voice: v, ...lane, velocity: COMP_VELOCITY.borrowed, holdTo, borrowed: true, from: src.node }));
    });
  });
  return { notes, strokes: at.map(({ s, t }) => ({ node: s, tick: row.tick[s], time: t, bar: k, slot: posSlot[s] })), found, tones };
}

/**
 * Bar k's bass: lines.js' bass mined over the bar, rooted on its chord's root tone, two octaves under the lead's range,
 * opening on a tone of the root's class (inside the frame) where it can, else the cheapest line; no line: the root onset.
 *   opts { table, scale (the parent scale, on the sounding grid), target (the bar's: harmony.js targetOfBar), over (a
 *          chart's split bar, P6: { frames (one a slot), targets (one a span) }; `c` is then the bar's first chord) }
 * → { line | null, notes, rooted (its first note on the root's class) }
 */
export function bassOfBar(ctx, c, k, { table, scale, target, over = null }) {
  const { row, cells, e, timeOf, slotSeconds, posSlot, pitchAtLeast } = ctx;
  // the root's class in the bar's frame: a bass line opens on it where it can
  const rootClass = []; for (let t = 0; t < row.tones.length; t++) { const k2 = classOfCents(row.toneCents[t] - c.rootCents); if (k2.pc === 0 && Math.abs(k2.dev) <= e + EPS) rootClass.push(t); }
  const bassOpts = { from: k, bars: 1, types: ['bass'], table, targets: { scale, bars: over ? over.targets : [target] }, register: REGISTER.bass };
  const frames = over ? over.frames : [c.frame];
  let lines = mineLines(row, cells, frames, { ...bassOpts, rules: { startTones: rootClass } }).lines || [];
  if (!lines.length) lines = mineLines(row, cells, frames, bassOpts).lines || [];
  const line = lines[0];
  const notes = line ? line.notes.map((n) => ({ node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: k, slot: n.cell, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.cell) }))
    : c.rootNode != null ? [(() => { const { octave, pitch } = pitchAtLeast(c.rootTone, c.rootCents + REGISTER.bass - 50); return { node: c.rootNode, tone: c.rootTone, octave, pitch, bar: k, slot: posSlot[c.rootNode], time: timeOf(row.tick[c.rootNode]), slotSeconds: slotSeconds(posSlot[c.rootNode]) }; })()] : [];
  return { line: line ?? null, notes, rooted: notes.length > 0 && classOfCents(row.toneCents[notes[0].tone] - c.rootCents).pc === 0 };
}

/** what the inner voice keeps off: the lead's slots (cells) and onsets → { cells: Set, nodes: [node] } */
export const leadAvoidOf = (notes) => ({ cells: new Set(notes.map((n) => (n.cell ?? n.slot))), nodes: notes.map((n) => n.node) });
/**
 * The inner voice over bars [from, from + bars): a lead line (sparse or mid) over the chords an octave under the lead,
 * never on the lead's onsets and paying weights.avoid = 0.6 a note on a slot where the lead sounds.
 *   opts { chords (every bar's chord record), targets ({ scale, bars: every bar's target }), lead (leadAvoidOf), table,
 *          rules (added to the miner's: STEP 4a's bar-local `before` / `after` boundaries, lines.js) }
 * → { line | null, notes, onLead (notes on a slot where the lead sounds) }
 */
export function innerOf(ctx, { from, bars }, { chords, targets, lead, table, rules = {} }) {
  const { row, cells, S, timeOf, slotSeconds } = ctx;
  const { frames, targets: sub } = harmonyOver(chords, targets, from, bars, S);
  const avoidSlots = Array.from({ length: bars * S }, (_, j) => lead.cells.has(from * S + j));
  const got = mineLines(row, cells, frames, { from, bars, types: ['lead'], table, targets: sub, register: REGISTER.inner, rules: { avoidSlots, avoidNodes: lead.nodes, ...rules }, weights: { avoid: 0.6 } });
  const line = (got.lines || []).find((l) => l.band !== 'dense');
  if (!line) return { line: null, notes: [], onLead: 0 };
  let onLead = 0;
  const notes = line.notes.map((n) => { if (lead.cells.has(n.cell)) onLead++; return { node: n.node, tone: n.tone, octave: n.octave, pitch: n.pitch, bar: n.bar, slot: n.cell, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.cell) }; });
  return { line, notes, onLead };
}

/**
 * The clave decision's words when it is read from the frames (BASS_VOICING_ORDER.md P21; Compose's and rearrange.js
 * `reclave`'s): its source ("layer A · 8 steps · chord tones"), the density tier it was chosen in (Amendment 2, P27, P31),
 * each bar's pattern, its score, and how its strokes were found. `choice` chooseFrameClave's, `clave` the laid spec.clave,
 * `fromAsked` whether `claveFrom` was asked, `densityAsked` whether `compDensity` was.
 */
export function frameClaveWhy(choice, clave, fromAsked = false, densityAsked = false) {
  const C = choice.clave, R = choice.ranks, f = C.from ?? {}, n = R.ranked.candidates.length;
  const head = `${choice.asked ? 'asked, read ' : ''}${fromAsked ? 'from the frame (asked)' : 'from the frame by default (rule 6, Avery)'}: a bar's clave is the clave layer's own strikes whose tones fit the bar's chord`;
  const tier = R.density ? `; ${densityWhy(R.density, densityAsked)}` : '';
  const how = choice.asked ? (f.frame ? 'the frame clave asked' : `${C.label ?? C.pattern}, its steps landed only on in-frame onsets`)
    : f.frame ? `the best of ${n} ${R.density?.played ? `${densityWords(R.density.played, { band: false })} ` : ''}frame clave${n === 1 ? '' : 's'} (${R.ranked.tried} readings: each layer at its strikes a bar, or at 3–16 steps when denser, under the chord tones, the frame, the root and fifth, the guide tones and the roots)` : `no layer reads a frame clave, so the curated ${C.label}`;
  const score = C.score != null ? ` scores ${C.score.toFixed(3)} (recurrence ${C.terms.held.toFixed(2)}, density ${C.terms.density.toFixed(2)}, fit ${C.terms.fit.toFixed(2)})` : '';
  const share = C.share != null ? `, ${Math.round(100 * C.share)} % of its steps sounding` : '';
  const laid = f.frame ? `${clave.strokes.length} strokes, each the layer's own strike at its own time` : `laid a pass ${C.span > 1 ? `each ${C.span} bars` : 'a bar'} on in-frame onsets only, ${clave.strokes.length} of its ${clave.strokes.length + clave.silent} steps landed (${clave.silent} silent: no in-frame onset there)`;
  return `${head}${tier}; ${how}: ${claveSource(C)}, ${claveText(C)}${share}${score}${choice.ties > 1 ? `, ${choice.ties} tied, by the seed` : ''}; ${laid}`;
}
/** the comp's density tier in words (P27, P31): asked or the default, the tier that played, and a fall-back said.
 *  `D` rankFrameClaves' `density` */
export function densityWhy(D, asked = false) {
  const own = `${asked ? `the comp's density asked, ${densityWords(D.asked)}` : `the comp's density ${densityWords(D.asked)} by default (rule 10, Avery)`}`;
  const c = D.counts, all = `${c.sparse} sparse, ${c.medium} medium, ${c.dense} dense${c.none ? `, ${c.none} in no tier` : ''}`;
  if (!D.fellBack) return `${own}: the frame claves ranked inside it, their density term read against its band (${all})`;
  return D.played ? `${own}: no frame clave in it (${all}), so the nearest tier's, ${densityWords(D.played)}, its density term read against that band`
    : `${own}: no frame clave in any tier (${all}: each under 10 % or over 85 % of its steps), so every one ranked by COMP_RULES (25–50 %)`;
}
/** the comp's strokes from a spec's clave (R3, decided 6): its own landed steps in Sync, its partner's in Fill (a partner
 *  step landed on an onset the clave took is left out, so the comp and the perc never strike together) → [stroke] */
export const compSourceOf = (clave) => (clave.relation === 'fill' ? clave.partner.strokes.filter((x) => !x.shared) : clave.strokes);
/** the comp's onsets in slots [from, to) of a spec's clave → [node] in time order */
export const compNodesOf = (clave, from, to) => compSourceOf(clave).filter((x) => x.slot >= from && x.slot < to).sort((a, b) => a.time - b.time || a.node - b.node).map((x) => x.node);
/** the slot ranges a clave step may land in (R3): a chart's spans (chords with `from` and `slots`), else the N bars of S
 *  slots → [{ from, to }] */
export const compUnitsOf = (spans, N, S) => (spans ? spans.map((c) => ({ from: c.from, to: c.from + c.slots })) : Array.from({ length: N }, (_, k) => ({ from: k * S, to: (k + 1) * S })));
/**
 * A chosen clave laid on the composition's bars (R3; Compose's, and rearrange.js `reclave`'s, one path): the clave and
 * its partner each laid a pass a bar through the drums' grid (drums.js `drumGrid`, `landPlace`), a partner stroke on
 * an onset the clave took marked `shared`.
 *   choice  claves.js chooseClave's { clave, partner }
 *   opts    { relation ('sync' | 'fill'), phase, units (compUnitsOf), cut (a MIDI target's { bars }, or null) }
 * → spec.clave: { …the clave, relation, strokes, silent, partner: { …the partner, strokes, silent, shared } }
 */
export function layCompClave(row, ctx, choice, { relation, phase, units, cut = null }) {
  const timed = (list) => list.map((y) => ({ bar: y.bar, step: y.step, place: y.place, node: y.node, tick: y.tick, time: ctx.timeOf(row.tick[y.node]), slot: y.slot, snap: y.snap }));
  let lay;
  if (choice.source === 'frame') {
    // read from the frames (BASS_VOICING_ORDER.md phase I, P16–P18): the clave and its partner come with their strokes,
    // each the clave layer's own strike or a fixed clave's step landed in frame, so nothing is landed here
    lay = (x) => ({ strokes: timed(x.strokes), silent: x.silent });
  } else {
    const g = drumGrid({ knobs: { cycleSeconds: ctx.T, rowCycleSeconds: ctx.rowT, bars: ctx.N, slotsPerBar: ctx.S, phase, ...(cut ? { cut: { bars: cut.bars } } : {}) },
      input: { layers: row.layers }, stats: { grid: row.grid }, timeline: { slotStarts: ctx.starts.map((x) => x * ctx.rowT), barStarts: [] } });
    lay = (x) => { const got = layClave(row, g, x, { units, slotOf: (i) => ctx.posSlot[i] }); return { strokes: timed(got.strokes), silent: got.silent.length }; };
  }
  const bare = ({ strokes, silent, ...rest }) => rest;
  const own = lay(choice.clave), other = lay(choice.partner), took = new Set(own.strokes.map((x) => x.node));
  let shared = 0; for (const x of other.strokes) if (took.has(x.node)) { x.shared = true; shared++; }
  return { ...bare(choice.clave), relation, strokes: own.strokes, silent: own.silent, partner: { ...bare(choice.partner), strokes: other.strokes, silent: other.silent, shared } };
}

/**
 * A part as the spec has it, from the builders' notes: articulated (legato, retriggers) voice by voice when `voice`
 * (the chords, and the comp in chords: notes is then [voice → notes]), each note's hz at baseHz × ratio × 2^octave × its
 * bar's retune. A note's own `velocity` (the comp in chords) stands; `borrowed`, `from` and `holdTo` are kept.
 *   opts { sound, legato, enabled, baseHz, ratioOf ((bar, slot) → fundamentalRatio), voice, strokes (the comp in chords:
 *          its strokes, kept on the part for the drums and the views) }
 */
export function partOf(ctx, id, notes, { sound, legato, enabled, baseHz, ratioOf, voice = false, strokes = null }) {
  const { row, T } = ctx;
  const struck = isStruck(sound);
  let groups = voice ? notes : [notes];
  // led chords (BASS_VOICING_ORDER.md P6): a lane (its register order in the chord) holds and moves, not a class
  if (voice) { const all = notes.flat().filter(Boolean); if (all.some((n) => n.lane != null)) { groups = []; for (const n of all) (groups[n.lane] ||= []).push(n); } }
  for (const g of groups) if (g) articulate(g, { legato, struck, cycleSeconds: T });
  const flat = (voice ? groups.flat().filter(Boolean) : notes).sort((a, b) => a.time - b.time || a.node - b.node);
  return {
    id, role: id, sound, struck, legato, enabled,
    notes: flat.map((n) => {
      const [num, den] = row.tones[n.tone].split('/').map(Number);
      const accent = id === 'comp' ? 0.1 * Math.max(0, (n.strikes ?? 1) - 1) : id === 'lead' && n.strong ? 0.1 : 0;
      return {
        node: n.node, tick: row.tick[n.node], time: n.time, ratio: row.tones[n.tone], octave: n.octave, hz: baseHz * (num / den) * 2 ** n.octave * ratioOf(n.bar, n.slot),
        duration: n.duration, velocity: n.velocity ?? Math.min(1, VELOCITY[id] + accent), bar: n.bar, slot: n.slot, slotSeconds: n.slotSeconds, retrigger: n.retrigger, ...(voice ? { voice: n.voice } : {}), ...(voice && n.lane != null ? { lane: n.lane } : {}),
        ...(n.endTime != null ? { endTime: n.endTime } : {}), ...(n.clipNote != null ? { clipNote: n.clipNote } : {}),
        ...(n.holdTo != null ? { holdTo: n.holdTo } : {}), ...(n.borrowed ? { borrowed: true, from: n.from } : {}),
      };
    }),
    ...(strokes ? { strokes: [...strokes].sort((a, b) => a.time - b.time || a.node - b.node) } : {}),
  };
}

/** a bar's chord as the spec has it, from harmony.js' record. opts { fundamentalRatio, targeted (a targeted progression's: is this bar pinned; undefined: no progression) } */
export const specChordOf = (c, { fundamentalRatio, targeted }) => ({ bar: c.bar, name: c.name, quality: c.quality, intervals: [...c.intervals], pcs: [...c.pcs], rootPc: c.rootPc, rootTone: c.rootFraction, rootNode: c.rootNode,
  offsetCents: c.offsetCents, rawOffsetCents: c.rawOffsetCents, fundamentalRatio, offGrid: !!c.offGrid, exceptions: c.exceptions.length, empty: !!c.empty,
  ...(targeted !== undefined ? { targeted, fallback: targeted ? c.fallback ?? null : null } : {}), ...(c.slots != null ? { span: c.span, from: c.from, slots: c.slots } : {}) });

// ── MIDI targets (phase A3, Composer/TARGET_ORDER.md) ──
//
// `compose(layers, T, { target: { clip, placement?, tonic?, maxDriftCents? } })`: the clip (midi.js `decodeClip`) is the
// lead and everything else is composed around it (decided, Avery: rulings 1–8; the rest proposed):
//   placement  target.js `placeClip` when none is given (it runs where Compose runs: the worker for a big row, P7)
//   cells      N bars × S slots (the clip's) from the placement's phase, partitioned, CROPPED to the B bars the clip
//              occupies (cells.js `cropCells`; decided: a window crops the cycle). Every part is composed inside. The
//              windows are Compose's own (about 12 onsets a slot), not the search's swing ½ (the order's; proposed: on
//              the 16k row swing ½ made the bass and inner miners take 30 s).
//   lead       pinned: the placement's notes (hits and the P2 substitutes; a hard miss is silent), each in the register
//              that follows the clip's own octave contour (target.js `registerOf`), each lasting to its note-off onset
//              (P4: `endTime`, which `articulate` honours). harmonize derives the chords from it once (no mining, no
//              settling: `settlePasses` 0, "pinned lead").
//   root       target.js `targetRoot` (P5): the tone of the tonic's class nearest the first phrase's lattice.
//   time       knobs.cycleSeconds is the LOOP (the window's span; all of T when N = B), knobs.rowCycleSeconds is T,
//              knobs.cut = { bars: N }; knobs.tempoBpm is the spec's natural tempo (60 × B × beats a bar /
//              the loop) and knobs.beatsPerBar the clip's time signature's numerator. spec.target holds the clip, the
//              placement, its misses and the clip's own tempo (playback's seed, decided 1/4).
//   overrides  TARGET_SETS are the target's own (refused); the rest apply as usual. A progression pins chords under the
//              clip as it pins them under a mined lead.

/**
 * A MIDI target's materials: the clip checked, its placement (given, or placeClip's), the tonic, the root (P5), the
 * N-bar cells from the placement's phase cropped to the window, the loop, the lead's registers.
 * → { clip, placement, alternates, lanes, search, tonic, tonicAsked, maxDriftCents, e, rootTone, N, B, S, beatsPerBar,
 *     phase, cells, loop, windowOnsets, octaves, why } | { refused: 'targetGrid', detail }
 */
function targetMaterials(row, T, target, ov) {
  const clip = target.clip, e = ov.frameCentsEachSide ?? DEFAULT_FRAME_CENTS_EACH_SIDE;
  if (!(Number.isInteger(clip.S) && clip.S >= 1 && Number.isInteger(clip.B) && clip.B >= 1 && Array.isArray(clip.timeSig))) fail('a target clip needs its grid (S, B, timeSig): midi.js decodeClip');
  if (clip.S > MAX_SLOTS) return { refused: 'targetGrid', detail: { slotsPerBar: clip.S, max: MAX_SLOTS, why: `a bar of ${clip.S} steps is past the ${MAX_SLOTS} slots a line may hold` } };
  const tonicAsked = target.tonic != null, tonic = target.tonic ?? clip.key?.tonic ?? 0;
  if (!(Number.isInteger(tonic) && tonic >= 0 && tonic < 12)) fail(`a target's tonic is a pitch class 0..11, not ${JSON.stringify(target.tonic)}`);
  const maxDriftCents = target.maxDriftCents ?? TARGET_DEFAULTS.maxDriftCents;
  let placement = target.placement ?? null, found = null;
  if (!placement) { found = placeClip(row, clip, { e, tonic, maxDriftCents }); placement = found.placement; }
  if (!placement || placement.S !== clip.S || placement.B !== clip.B || placement.notes?.length !== clip.notes.length || !(placement.N >= placement.B) || !Array.isArray(placement.phase)) fail('the target\'s placement is not one of this clip (target.js placeClip)');
  const { N, B } = placement, S = clip.S;
  // Compose's own windows (about 12 onsets a slot), not the search's swing ½: on the 16k row a slot then holds ~250
  // onsets and the line miner (bass, inner) runs ~40× longer (30 s; proposed, Log). The lead is pinned by node, so its
  // notes need no window; the anchors, and so the slots and the window, are the placement's.
  const cells = cropCells(buildCells(row, { bars: N, slotsPerBar: S, anchors: 'partitioned', phase: placement.phase }), B);
  const loop = (cells.crop ? cells.crop.end : 1) * T;
  const rootTone = targetRoot(row, placement, tonic, e);
  const sounding = placement.notes.filter((x) => x.on.node != null).length;
  const why = `${found ? `placed by target.js (${found.searched.barCounts.length} bar count${found.searched.barCounts.length > 1 ? 's' : ''} searched${found.searched.stoppedAt != null ? `, stopped at the first full fit, N = ${found.searched.stoppedAt}` : ''})` : 'the placement given'}: `
    + `${placement.hits} hits (${placement.tight} tight), ${placement.misses.fringe} fringe and ${placement.misses.shift} shifted substitutes, ${placement.misses.hard} silent; ${placement.offHits}/${sounding} note-offs on an onset near their anchor`
    + `${placement.drift ? `; the lattice drifts ${placement.drift.toFixed(1)}¢ over its phrases` : ''}${placement.missing.length ? `; the row can't play ${placement.missing.map(pcName).join(', ')}` : ''}`;
  return {
    clip, placement, alternates: found ? found.alternates : [], lanes: found ? found.lanes : null, search: found ? { ms: found.ms, barCounts: found.searched.barCounts, stoppedAt: found.searched.stoppedAt } : null,
    tonic, tonicAsked, maxDriftCents, e, rootTone, N, B, S, beatsPerBar: clip.timeSig[0], phase: [...placement.phase], cells, loop,
    windowOnsets: cells.slots.reduce((n, s) => n + s.nodes, 0), octaves: registerOf(row, placement, clip, tonic, row.toneCents[rootTone]), why,
  };
}

/** a target's sounding notes as harmonize's pinned lead (lines.js' note shape), with the clip note, its kind and its on/off places */
function targetLeadNotes(row, cells, tg, base) {
  const S = cells.slotsPerBar, out = [];
  tg.placement.notes.forEach((x, j) => {
    if (x.on.node == null) return;
    const node = x.on.node, tone = row.tone[node], cell = x.on.slot, octave = tg.octaves[j];
    out.push({ slot: cell, cell, bar: Math.floor(cell / S), beat: cell % S, node, tick: row.tick[node], tone, fraction: row.tones[tone], cents: row.toneCents[tone], octave, pitch: row.toneCents[tone] + 1200 * octave,
      pc: base.pc[tone], outside: x.on.kind === 'fringe', clipNote: j, kind: x.on.kind, onPos: x.on.pos, offPos: x.off.pos });
  });
  return out;
}

/** the `bass` override checked (Amendment 2, P28): { density?, lock? }, bass.js' densities and locks (no picks) */
function checkBassOverride(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail(`bass must be { density, lock }, not ${JSON.stringify(b)}`);
  for (const k of Object.keys(b)) if (k !== 'density' && k !== 'lock') fail(`the bass override takes density and lock, not "${k}"`);
  if (b.density != null && !BASS_DENSITIES.includes(b.density)) fail(`bass.density must be one of ${BASS_DENSITIES.join(', ')}`);
  if (b.lock != null && !BASS_LOCKS.includes(b.lock)) fail(`bass.lock must be one of ${BASS_LOCKS.join(', ')}`);
}
/** an arranged bass bar's played line as the trace's bass bar holds it (trace.js `bassBar`; null: a root onset or a rest) */
function bassLineOf(b) {
  const a = b.how === 'mined' || b.how === 'roots' ? b.alternates.find((x) => x.id === b.picked) : null;
  return a ? { id: a.id, type: 'bass', band: a.band, motion: a.motion ?? null, contour: a.contour ? { shape: a.contour } : null, from: b.bar, bars: 1, notes: a.notes.map((n) => ({ cell: n.slot, node: n.node, octave: n.octave })) } : null;
}

/**
 * Compose.
 *   layers         the rhythm, [a, b, c, d] as the LRC names them
 *   cycleSeconds   how long one cycle lasts
 *   options        { seed (default 1), overrides: { bars, slotsPerBar, anchors, phase, frameCentsEachSide, root,
 *                  modulation, foldOffsets, table, sounds: { part: id }, legato: { part: bool }, enabled: { part: bool },
 *                  baseHz, compLayer (compStyle 'notes'), presence ('cluster' | 'exact'), settlePasses (an integer 0..3),
 *                  compStyle ('chords', the default, | 'notes': the comping, above), clave ('steps:pattern' | 'son' |
 *                  'rumba' | 'bossa' | a frame clave's 'frame:A/8/chord': the comp's clave in chords), compRelation ('sync', the
 *                  default, | 'fill'), claveFrom ('frame', the default, | 'pattern': phase I, above), compDensity
 *                  ('sparse-med', the default, | 'sparse' | 'medium' | 'dense': the frame clave's tier, Amendment 2),
 *                  bass ({ density, lock }: bass.js', Moving · Kick by default; Sparse · Free the bass before) }, worker (true:
 *                  the full table unless asked), progression ([a ratio of the row | null] a bar: progression.js;
 *                  absent or all null: lead-led, exactly as without it),
 *                  drums (drums.js `arrangeDrums` options, or false: no `drums` in the spec),
 *                  trace (true: `spec.trace`, the compose trace of trace.js, at TRACE_CAPS; { caps }: the same at
                  ALTERNATE_CAPS (12 chord candidates a bar, 8 runner-up lines a phrase) with `caps` over them, STEP
                  4a; off by default),
                  target ({ clip, placement?, tonic?, maxDriftCents? }: a MIDI target, above; absent: Compose exactly as
                  without it), changes ([[shares] × bars]: a chord chart's bars, chart.js; the progression is then one
                  pin a span) }
 * → the spec (see the head of this file and Composer/DESIGN_NOTES.md "Phase 4"), or a refusal
 */
export function compose(layers, cycleSeconds, { seed = 1, overrides = {}, worker = false, progression = null, drums = {}, trace = false, target = null, changes = null } = {}) {
  const input = { layers: [...layers], cycleSeconds, seed, overrides: JSON.parse(JSON.stringify(overrides ?? {})) };
  // ── a chord chart's bars (CHART_ORDER.md): recorded in the input only when given ──
  if (changes != null) {
    if (target != null) fail('a chord chart and a MIDI target together are not built yet (Composer/DIRECTIONS.md: how a clip and a typed progression combine is open)');
    input.changes = checkChanges(changes);
  }
  if (overrides?.bars != null && !(Number.isInteger(overrides.bars) && overrides.bars >= 1 && overrides.bars <= MAX_BARS)) fail(`bars must be a whole number 1..${MAX_BARS}, not ${JSON.stringify(overrides.bars)}`);
  // ── a targeted progression (progression.js): recorded in the input only when it asks for a root ──
  if (progression != null && !Array.isArray(progression)) fail(`progression must be a list, one root a bar (a ratio or null)`);
  if (progression && progression.some((x) => x != null && x !== '' && x !== 'auto')) input.progression = JSON.parse(JSON.stringify(progression));
  if (!(Number.isFinite(cycleSeconds) && cycleSeconds > 0)) fail(`cycleSeconds must be a positive number, not ${cycleSeconds}`);
  for (const k of Object.keys(overrides || {})) if (!OVERRIDES.includes(k)) fail(`no override "${k}" (overrides are ${OVERRIDES.join(', ')})`);
  if (overrides?.bass != null) checkBassOverride(overrides.bass);
  // ── a MIDI target (phase A3): recorded in the input only when given ──
  if (target != null) {
    if (typeof target !== 'object' || !target.clip?.notes?.length) fail('a target is { clip (midi.js decodeClip), placement?, tonic?, maxDriftCents? }');
    for (const k of Object.keys(overrides || {})) if (TARGET_SETS.includes(k)) fail(`the override "${k}" is set by the target`);
    input.target = JSON.parse(JSON.stringify(target));
  }
  const ov = overrides || {}, T = cycleSeconds;

  const traceCaps = trace ? traceCapsOf(trace) : null;   // STEP 4a: true → TRACE_CAPS; { caps } → ALTERNATE_CAPS + caps
  const refusal = (r) => (trace ? { ...r, trace: refusedTrace(r, { cycleSeconds, caps: traceCaps }) } : r);
  // PREBUILT ROW (Cosmos Compose, E1): options.row, a row built elsewhere (superrow.js), stands in for buildRow(layers)
  const row = arguments[2]?.row ?? buildRow(layers, { gate: ONSET_GATE });
  if (!isRow(row)) return refusal({ version: COMPOSER_SPEC_VERSION, input, refused: true, reason: row.tooDense ? 'tooDense' : 'tooLarge', detail: row });
  const few = toneGate(row, MIN_TONES);
  if (few) return refusal({ version: COMPOSER_SPEC_VERSION, input, refused: true, reason: 'tooFewTones', detail: few });
  // a MIDI target: the clip placed (target.js) and its window's cells, before anything is recorded
  const tg = target != null ? targetMaterials(row, T, input.target, ov) : null;
  if (tg?.refused) return refusal({ version: COMPOSER_SPEC_VERSION, input, refused: true, reason: tg.refused, detail: tg.detail });
  // the trace's recorder (trace.js), or null: every `rec?.` below is skipped, arguments and all, when it is off
  const rec = trace ? createTrace(row, { cycleSeconds: tg ? tg.loop : T, meter: { bars: BAR_CHOICES, slots: SLOT_CHOICES, tempoRange: TEMPO_RANGE, beatsPerBar: BEATS_PER_BAR }, caps: traceCaps }) : null;
  rec?.row();

  const rng = seededRandom(seed), decisions = [];
  const decide = (what, value, why) => { decisions.push({ what, value, why }); return value; };

  // ── knobs ──
  let e, rootTone, meter, anchors, P, phase, cells, modulation, table, prog, targeted, leader, h, spans = null;
  if (tg) {
    // ── a MIDI target (phase A3): the meter, the phase and the window from the placement, the lead pinned ──
    e = tg.e;
    decide('frameCentsEachSide', e, ov.frameCentsEachSide != null ? 'asked' : 'the default (decided): ±15¢, as the Progression Solver');
    decide('target', `${tg.clip.name}: ${tg.placement.hits}/${tg.placement.J} notes hit, bars ${tg.placement.B} of ${tg.placement.N}`, tg.why);
    rootTone = tg.rootTone;
    rec?.root(e, 'cluster', rootTone, true);
    decide('root', row.tones[rootTone], `the tone of the clip's tonic (${pcName(tg.tonic)}${tg.tonicAsked ? ', asked' : ', its key estimate'}) in the first phrase's lattice nearest that lattice (P5, proposed)`);
    meter = { bars: tg.B, slotsPerBar: tg.S, tempoBpm: (60 * tg.B * tg.beatsPerBar) / tg.loop, notes: [`${tg.B} bar${tg.B > 1 ? 's' : ''}: the clip's, from the placement (decided: the bar count comes from the placement)`, `${tg.S} slots a bar: the clip's steps a bar`] };
    decide('bars', meter.bars, tg.N > tg.B ? `the window: bars 1–${tg.B} of a ${tg.N}-bar cut of the cycle (decided: a window crops the cycle)` : `the clip over the whole cycle (${tg.N} bars)`);
    decide('slotsPerBar', meter.slotsPerBar, `the clip's steps a bar (${tg.clip.timeSig.join('/')} on 1/${tg.clip.d}-quarter steps)`);
    decide('tempoBpm', meter.tempoBpm, `60 × ${tg.B} bars × ${tg.beatsPerBar} beats / the ${tg.loop} s loop: the spec's natural tempo; playback is seeded from the clip's own, ${tg.clip.tempoBpm} BPM (decided)`);
    rec?.meter(meter, { bars: tg.B, slotsPerBar: tg.S });
    anchors = decide('anchors', 'partitioned', 'partitioned, from the placement\'s phase: the anchors the placement was found on (the windows Compose\'s own, about 12 onsets a slot; the search\'s swing-½ windows are its alone)');
    P = meter.bars * meter.slotsPerBar;
    phase = tg.phase;
    decide('phase', phase, `the placement's: the clip's bar 1 on the cycle, its phase centred among its hits and rounded to a tick`);
    rec?.phase(null, null, phase);
    cells = tg.cells;
    rec?.cells(cells);
    modulation = decide('modulation', ov.modulation ?? true, ov.modulation != null ? 'asked' : 'on by default (Sprint default 3): a jump at a bar where a root is off the grid');
    table = decide('table', ov.table ?? (worker ? 'full' : 'lean'), ov.table ? 'asked' : worker ? 'in a worker: the full table' : 'on the main thread: the lean table (the cost probe)');
    if (!TABLES.includes(table)) fail(`table must be one of ${TABLES.join(', ')}`);
    prog = input.progression ? readProgression(input.progression, row, meter.bars) : null; targeted = !!prog?.targeted;
    leader = !targeted ? 'target' : prog.roots.every((r) => r != null) ? 'progression' : 'mixed';
    decide('leader', leader, leader === 'target' ? 'a MIDI target: the lead is the clip, and the chords follow it'
      : leader === 'progression' ? 'a progression asked a root for every bar: those chords, under the clip'
      : 'a progression asked roots for some bars: those kept, the rest of the chords following the clip');
    if (prog) rec?.progression(prog, leader);
    const foldOffsets = ov.foldOffsets ?? true;
    if (ov.foldOffsets != null) decide('foldOffsets', foldOffsets, 'asked');
    decide('settlePasses', 0, 'pinned lead: the lead is the clip, so the chords are derived from it once (no mining, no settling)');
    const leadNotes = targetLeadNotes(row, cells, tg, frameAt(row, rootTone, e));
    h = harmonize(row, cells, { root: rootTone, frameCentsEachSide: e, modulation, table, foldOffsets, settlePasses: 0, lead: { notes: leadNotes }, ...(targeted ? { progression: harmonyPins(prog) } : {}), trace: rec });
    rec?.harmony(h);
    if (prog) { const d = targeted ? describeProgression(prog, h.chords, row) : { value: prog.roots.map(() => 'auto'), why: `no root of the progression could be used, so every bar is auto: ${prog.notes.join('; ')}` }; decide('progression', d.value, d.why); }
  } else {
    e = decide('frameCentsEachSide', ov.frameCentsEachSide ?? DEFAULT_FRAME_CENTS_EACH_SIDE, ov.frameCentsEachSide != null ? 'asked' : 'the default (decided): ±15¢, as the Progression Solver');
    const presence = decide('presence', ov.presence ?? 'cluster', ov.presence != null ? 'asked' : `a root is heard as its ±${e}¢ cluster: every tone of its class within ±${e}¢ of it (decided, Avery)`);
    if (!PRESENCE_MODES.includes(presence)) fail(`presence must be one of ${PRESENCE_MODES.join(', ')}`);
    rootTone = ov.root != null ? toneIndexOf(row, ov.root) : defaultRoot(row, e, { presence });
    const heardAs = presence === 'cluster' ? clusterPresence(row, e).presence[rootTone] : null;
    rec?.root(e, presence, rootTone, ov.root != null);
    decide('root', row.tones[rootTone], ov.root != null ? 'asked' : presence === 'exact'
      ? `the tone heard at least max(2, 1%) of the onsets (or half the most heard) whose ±${e}¢ frame holds the most onsets; heard ${row.toneCount[rootTone]} times`
      : `the loudest tone of its ±${e}¢ cluster, the cluster heard at least max(2, 1%) of the onsets (or half the largest cluster), whose ±${e}¢ frame holds the most onsets; heard ${row.toneCount[rootTone]} times, its cluster ${heardAs}`);
    meter = input.changes ? chartMeter(row.n, T, input.changes, { slotsPerBar: ov.slotsPerBar ?? null }) : chooseMeter(row.n, T, { bars: ov.bars ?? null, slotsPerBar: ov.slotsPerBar ?? null });
    if (input.changes) {
      decide('bars', meter.bars, `the chart's (decided: a chart sets the bars)${ov.bars != null && ov.bars !== meter.bars ? `, not the ${ov.bars} asked` : ''}`);
      decide('slotsPerBar', meter.slotsPerBar, meter.notes.slice(1).join('; '));
      spans = isPlain(input.changes) ? null : meter.spans;
      if (spans) decide('changes', meter.spans.map((x) => `${x.bar + 1}:${x.from % meter.slotsPerBar}+${x.slots}`), `${spans.length} chords over ${meter.bars} bars, a span each (bar:slot+slots): ${meter.even ? 'every bar split evenly' : 'a bar its chords cannot split evenly spreads them as evenly as whole slots allow (Euclid, decided)'}`);
    } else {
      decide('bars', meter.bars, ov.bars != null ? 'asked' : meter.notes.filter((x) => /bar|BPM/.test(x) && !/slot/.test(x)).join('; '));
      decide('slotsPerBar', meter.slotsPerBar, ov.slotsPerBar != null ? 'asked' : meter.notes.filter((x) => /slot|onsets/.test(x)).join('; '));
    }
    decide('tempoBpm', meter.tempoBpm, `60 × ${meter.bars} bars × ${BEATS_PER_BAR} beats / ${T} s`);
    rec?.meter(meter, { bars: ov.bars, slotsPerBar: ov.slotsPerBar });
    anchors = decide('anchors', ov.anchors ?? 'partitioned', ov.anchors ? 'asked' : 'partitioned pulses first (decided: "it starts with partitioned anchors")');
    if (!ANCHOR_MODES.includes(anchors)) fail(`anchors must be one of ${ANCHOR_MODES.join(', ')}`);
    P = meter.bars * meter.slotsPerBar;
    if (ov.phase) { phase = ov.phase; decide('phase', phase, 'asked'); rec?.phase(null, null, phase); }
    else {
      const beats = downbeats(row, P, 3, rootTone, { anchors, cluster: presence === 'cluster' ? e : null }), at = Math.floor(rng() * beats.length);
      phase = beats[at];
      decide('phase', phase, `downbeat ${at + 1} of the root's first ${beats.length} (where it first sounds, then ${presence === 'cluster' ? `the heaviest onsets of its ±${e}¢ cluster` : 'its heaviest onsets'}), by the seed`);
      rec?.phase(beats, at, phase);
    }
    cells = buildCells(row, { bars: meter.bars, slotsPerBar: meter.slotsPerBar, anchors, phase });
    rec?.cells(cells);
    modulation = decide('modulation', ov.modulation ?? true, ov.modulation != null ? 'asked' : 'on by default (Sprint default 3): a jump at a bar where a root is off the grid');
    table = decide('table', ov.table ?? (worker ? 'full' : 'lean'), ov.table ? 'asked' : worker ? 'in a worker: the full table' : 'on the main thread: the lean table (the cost probe)');
    if (!TABLES.includes(table)) fail(`table must be one of ${TABLES.join(', ')}`);
    // ── a targeted progression: the asked roots per bar, read against the row and the bars ──
    prog = input.progression ? readProgression(input.progression, row, spans ? spans.length : meter.bars) : null; targeted = !!prog?.targeted;
    leader = !targeted ? 'lead' : prog.roots.every((r) => r != null) ? 'progression' : 'mixed';
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
    h = harmonize(row, cells, { root: rootTone, frameCentsEachSide: e, modulation, table, foldOffsets, settlePasses, ...(targeted ? { progression: harmonyPins(prog) } : {}), ...(spans ? { spans } : {}), trace: rec });
    rec?.harmony(h);
    if (prog) { const d = targeted ? describeProgression(prog, h.chords, row) : { value: prog.roots.map(() => 'auto'), why: `no root of the progression could be used, so every bar is auto: ${prog.notes.join('; ')}` }; decide('progression', d.value, d.why); }
  }
  // ── the parts (STEP 4a: built by the exported per-bar builders below, which a rearrange calls too) ──
  const ctx = partContext(row, cells, tg ? { cycleSeconds: tg.loop, phase, frameCentsEachSide: e, rowCycleSeconds: T } : { cycleSeconds: T, phase, frameCentsEachSide: e });
  const { S, N } = ctx;
  // a chart's split bars: each bar's chords (a span's each) and each slot's chord
  const ownChords = spans ? Array.from({ length: N }, (_, k) => h.chords.filter((c) => c.bar === k)) : null;
  const slotChord = spans ? h.chords.flatMap((c) => Array.from({ length: c.slots }, () => c)) : null;
  const rangeOf = (c) => ({ from: c.from, to: c.from + c.slots });
  const ratioOf = spans ? (bar, slot) => (slotChord[slot] ?? ownChords[bar][0]).fundamentalRatio
    : (bar) => h.chords[bar].fundamentalRatio;   // the sounding retune: a folded name never moves it

  const parts = {};
  // lead
  parts.lead = leadNotesOf(ctx, h.lead.notes);
  // a MIDI target's lead: each note ends on its note-off onset (P4), and knows its clip note
  if (tg) parts.lead.forEach((b, i) => { const n = h.lead.notes[i]; b.clipNote = n.clipNote; b.endTime = b.time + (n.offPos - n.onPos) * T; });
  // baseHz (decided below, in its place among the decisions): the led voicing reads it for the mud limit
  const leadPitch = median(parts.lead.map((n) => n.pitch));
  const baseHzValue = ov.baseHz ?? (leadPitch == null ? 261.6255653005986 : LEAD_TARGET_HZ / 2 ** (leadPitch / 1200));
  // chords: a voice a chord class, a unit a bar (a chart's span)
  const units = [];
  if (spans) { for (let k = 0; k < N; k++) for (const c of ownChords[k]) units.push({ chord: c, bar: k, range: rangeOf(c), notes: chordVoicesOfBar(ctx, c, k, rangeOf(c)) }); }
  else for (let k = 0; k < N; k++) units.push({ chord: h.chords[k], bar: k, range: null, notes: chordVoicesOfBar(ctx, h.chords[k], k) });
  // the voicing (BASS_VOICING_ORDER.md phase F): led by default, each chord's octaves from the one before; close as before
  const voicing = ov.voicing ?? 'led';
  if (!VOICINGS.includes(voicing)) fail(`voicing must be one of ${VOICINGS.join(', ')}`);
  const led = voicing === 'led';
  const voiced = led ? voiceLead(ctx, units, { baseHz: baseHzValue, ratioOf }) : null;
  if (led) decide('voicing', voicing, voicingWhy(voiced, ov.voicing != null));
  const voices = [];
  for (const u of units) for (const n of u.notes) (voices[n.voice] ||= []).push(n);
  // comping. Chords (the default; Amendment 1, decided 5–6): one clave for the composition, mined from the row's layers
  // (claves.js), laid a pass a bar; its landed steps (Sync) or its partner's (Fill) are the strokes, each the bar's chord
  // strummed from the onsets around it and the rest borrowed from the chord voices. Notes: a layer cut into the bars and
  // their slots, a slot's step the layer's first strike in it, sounding when its tone is one of the bar's chord tones
  // (rhythm-claves.js' tone set, chunk-comping.js' ranking), the frozen core
  const compStyle = ov.compStyle ?? 'chords';
  if (!COMP_STYLES.includes(compStyle)) fail(`compStyle must be one of ${COMP_STYLES.join(', ')}`);
  const chordsStyle = compStyle === 'chords';
  if (chordsStyle && ov.compLayer != null) fail('compLayer is compStyle \'notes\'\'s: in chords the clave leads the comp (the override is clave)');
  if (!chordsStyle && (ov.clave != null || ov.compRelation != null || ov.claveFrom != null || ov.compDensity != null)) fail('clave, compRelation, claveFrom and compDensity are compStyle \'chords\'\'s: \'notes\' comps on a layer (compLayer)');
  if (chordsStyle) decide('compStyle', compStyle, ov.compStyle != null ? 'asked' : 'chords by default (decided, Avery): the clave\'s strokes (Amendment 1), each the chord strummed from the row, then borrowed');
  let comp = null, compChoices = null, clave = null, claveChoice = null;
  const compUnits = compUnitsOf(spans ? h.chords : null, N, S);
  if (chordsStyle) {
    // the draws the layer's ties took before the clave: the sounds' draws below stay where they were
    for (let i = 0; i < row.active.length; i++) rng();
    const relation = ov.compRelation ?? 'sync';
    if (!COMP_RELATIONS.includes(relation)) fail(`compRelation must be one of ${COMP_RELATIONS.join(', ')}`);
    const claveFrom = ov.claveFrom ?? 'frame';
    if (!CLAVE_FROM.includes(claveFrom)) fail(`claveFrom must be one of ${CLAVE_FROM.join(', ')}`);
    // the comp's density (Amendment 2, rule 10, P27): the tier the frame clave is chosen in; a pattern clave has none
    const compDensity = ov.compDensity ?? DEFAULT_COMP_DENSITY;
    if (!COMP_DENSITIES.includes(compDensity)) fail(`compDensity must be one of ${COMP_DENSITIES.join(', ')}`);
    if (claveFrom === 'pattern' && ov.compDensity != null) fail('compDensity is the frame clave\'s tier (claveFrom \'frame\'): a pattern clave has none');
    // the clave's ties by the seed, from a generator of its own (no draw of Compose's moves). From the frame (the default;
    // BASS_VOICING_ORDER.md phase I, rule 6, P16–P19): read from the chords above, so it comes after them, a bar's
    // strokes the clave layer's strikes whose tones fit the chord the slot sounds under; from the pattern: the table's
    // fixed pattern laid through the drums' grid (drums.js `landPlace`: the onsets are the row's layers' pulses)
    if (claveFrom === 'frame') {
      const chordAt = spans ? (j) => slotChord[j] : (j) => h.chords[Math.floor(j / S)];
      claveChoice = chooseFrameClave(row, ctx, chordAt, { asked: ov.clave ?? null, rng: seededRandom(`${seed}/clave`), units: compUnits, density: compDensity });
    } else claveChoice = chooseClave(readRhythm(row), { asked: ov.clave ?? null, rng: seededRandom(`${seed}/clave`) });
    clave = layCompClave(row, ctx, claveChoice, { relation, phase, units: compUnits, cut: tg ? { bars: tg.N } : null });
    const shared = clave.partner.shared;
    const C = claveChoice.clave, R = claveChoice.ranks, src = C.from;
    if (claveFrom === 'frame') {
      decide('clave', C.id, frameClaveWhy(claveChoice, clave, ov.claveFrom != null, ov.compDensity != null));
      decide('compRelation', relation, `${ov.compRelation != null ? 'asked' : 'sync by default (decided 6)'}: ${relation === 'sync' ? 'the comp strikes the clave\'s own strokes, with the perc' : 'the comp strikes the clave\'s gaps'}; for Fill, ${claveChoice.partner.source === 'partner'
        ? `its partner ${claveSource(claveChoice.partner)}, ${claveText(claveChoice.partner)} (the best-ranked of ${claveChoice.partners} frame claves with no stroke within ¼ slot of the clave's)` : `the complement of its steps Euclid-thinned to its mean onsets a bar, ${claveText(claveChoice.partner)}, landed in frame (no frame clave clear of its strokes)`}`
        + `${shared ? `, ${shared} of whose strokes share the clave's onset and are left out` : ''}`);
    } else {
      const tierWhy = R.tier === 'meeting' ? 'each layer read at the bar sizes where another layer meets it' : R.tier === 'whole' ? 'no layer meets another within 16 strikes, so each layer read at every size that cuts it whole'
        : R.tier === 'every' ? 'no layer meets another or divides within 16 strikes, so each layer read at every size 3–16 (a clipped last bar left out)' : 'the row\'s layers leave no clave of 3–16 steps';
      const steps = clave.strokes.length + clave.silent;
      decide('clave', C.id, `${claveChoice.asked ? 'asked' : src.pattern ? `${tierWhy}: no mined clave, so the curated ${C.label}` : `${tierWhy}, under tone sets coarse to fine (rhythm-claves.js): ${R.ranked.tried} claves of 3–16 steps; the best`}`
        + `${src.layer != null ? `, found on layer ${src.name} (${src.layer}) cut every ${src.size} strikes under ${src.set}` : ''}: ${C.pattern} scores ${C.score.toFixed(3)} (recurrence ${C.terms.held.toFixed(2)}, density ${C.terms.density.toFixed(2)}, fit ${C.terms.fit.toFixed(2)})`
        + `${claveChoice.ties > 1 ? `, ${claveChoice.ties} tied, by the seed` : ''}; laid a pass ${C.span > 1 ? `each ${C.span} bars` : 'a bar'}, ${clave.strokes.length} of its ${steps} onsets landed on the row (${clave.silent} silent)`);
      decide('compRelation', relation, `${ov.compRelation != null ? 'asked' : 'sync by default (decided 6)'}: ${relation === 'sync' ? 'the comp strikes the clave\'s own landed steps, with the perc' : 'the comp strikes the clave\'s gaps'}; for Fill, ${claveChoice.partner.source === 'partner'
        ? `its partner ${claveChoice.partner.pattern} (the best of ${claveChoice.partners}: the same bars under a tone set disjoint from the clave's, found together ${claveChoice.partner.together} time${claveChoice.partner.together === 1 ? '' : 's'})` : `the complement of its steps Euclid-thinned to its own ${C.onsets.length} onsets, ${claveChoice.partner.pattern} (no partner in the row)`}`
        + `${shared ? `, ${shared} of whose landed steps share the clave's onset and are left out` : ''}`);
    }
  } else {
    compChoices = compChoicesOf(ctx, h.chords, { ...(spans ? { chordAt: (j) => slotChord[j] } : {}), style: compStyle });
    const tieOrder = compChoices.map(() => rng());
    if (ov.compLayer != null) {
      comp = compChoices.find((x) => x.value === ov.compLayer || 'ABCD'[x.layer] === ov.compLayer) ?? fail(`no layer ${ov.compLayer}`);
      decide('compLayer', 'ABCD'[comp.layer], 'asked');
    } else {
      comp = compChoices.reduce((a, b, i) => (b.score > a.score + EPS || (Math.abs(b.score - a.score) <= EPS && tieOrder[i] < tieOrder[compChoices.indexOf(a)]) ? b : a));
      decide('compLayer', 'ABCD'[comp.layer], `layer ${'ABCD'[comp.layer]} (${comp.value}) makes the best claves on the chord tones: ${comp.score.toFixed(3)} (a slot's step its first strike there; 25–50 % of the steps on chord tones, a straight or triplet count of steps to the bar, a stroke in every bar), ties by the seed`);
    }
  }
  parts.comp = [];
  const compStrokes = [];
  let compFound = 0, compTones = 0;
  const compBar = (c, k, range = null, voicedNotes = null) => {
    if (!chordsStyle) { parts.comp.push(...compOfBar(ctx, c, k, comp.layer, range)); return; }
    const r = range ?? { from: k * S, to: (k + 1) * S };
    const got = compChordsOfBar(ctx, c, k, compNodesOf(clave, r.from, r.to), range, voicedNotes);
    for (const n of got.notes) (parts.comp[n.voice] ||= []).push(n);
    compStrokes.push(...got.strokes); compFound += got.found; compTones += got.tones;
  };
  for (const u of units) compBar(u.chord, u.bar, u.range, led ? u.notes : null);
  const compStrum = compTones ? compFound / compTones : 0;
  if (chordsStyle) decide('compStrum', compStrum, `the clave's ${compStrokes.length} stroke${compStrokes.length === 1 ? '' : 's'} (${clave.relation}${compStrokes.length > compSourceOf(clave).length ? '; a bar or span with none struck once on its root onset' : ''}), each the bar's chord: ${compFound} of ${compTones} tones (${(100 * compStrum).toFixed(0)} %) from the row within ±${STRUM_WINDOW} slot, the rest borrowed from the chord voices`);
  // bass (BASS_VOICING_ORDER.md Amendment 2, rule 11, P28): Moving · Kick by default, arranged by bass.js `arrangeBass`
  // over the finished spec once its drums are (below: it covers their kick, and falls back to Free, saying why, with the
  // drums off or no kick in the mode). Asked Sparse · Free (`bass` override), Compose's own bass, mined here bar by bar,
  // rooted on the bar's root tone, as before
  const bassAsk = { ...COMPOSE_BASS, ...(ov.bass ?? {}) }, bassOwn = bassAsk.density === 'sparse' && bassAsk.lock === 'free', bassDecisionAt = decisions.length;
  parts.bass = [];
  let bassRooted = 0;
  if (bassOwn) for (let k = 0; k < N; k++) {
    const over = spans ? harmonyOver(h.chords, h.targets, k, 1, S) : null;
    const b = spans ? bassOfBar(ctx, ownChords[k][0], k, { table, scale: h.targets.scale, over: { frames: over.frames, targets: over.targets.bars } })
      : bassOfBar(ctx, h.chords[k], k, { table, scale: h.targets.scale, target: h.targets.bars[k] });
    if (b.rooted) bassRooted++;
    rec?.bassBar(k, b.line, b.rooted);
    parts.bass.push(...b.notes);
  }
  // inner: over the chords an octave under the lead, off the lead's onsets
  parts.inner = [];
  const lead = leadAvoidOf(h.lead.notes);
  let innerOnLead = 0;
  for (const span of phrasesOf(cells)) {
    const got = innerOf(ctx, span, { chords: h.chords, targets: h.targets, lead, table });
    rec?.innerPhrase(span.from, span.bars, got.line);
    innerOnLead += got.onLead;
    parts.inner.push(...got.notes);
  }

  // ── legato, sounds, pitch ──
  const leadGaps = []; for (let i = 1; i < h.lead.notes.length; i++) leadGaps.push(h.lead.notes[i].cell - h.lead.notes[i - 1].cell);
  const leadGap = median(leadGaps);
  const legatoWhy = { chords: 'on by default: chords sustain', inner: 'on by default: an inner voice sustains', comp: chordsStyle ? 'off by default: comping is struck (a stroke\'s tones last to the next stroke or a slot, whichever is shorter)' : 'off by default: comping is struck', bass: 'off by default (proposed)',
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
  const baseHz = decide('baseHz', baseHzValue,
    ov.baseHz ? 'asked' : leadPitch == null ? 'no lead notes: 1/1 at middle C' : `the lead's median pitch (${leadPitch.toFixed(1)}¢ above 1/1) at √(440·660) ≈ 539 Hz`);

  const out = (id, notes, { voice = false, strokes = null } = {}) => partOf(ctx, id, notes, { sound: sound[id], legato: legato[id], enabled: enabled[id], baseHz, ratioOf, voice, strokes });
  const partList = [out('lead', parts.lead), out('chords', voices, { voice: true }), out('comp', parts.comp, chordsStyle ? { voice: true, strokes: compStrokes } : {}), out('bass', parts.bass), out('inner', parts.inner)];

  const counts = Object.fromEntries(partList.map((p) => [p.id, p.notes.length]));
  const spec = {
    version: COMPOSER_SPEC_VERSION, input,
    knobs: tg ? {
      bars: N, slotsPerBar: S, beatsPerBar: tg.beatsPerBar, anchors, phase: [...phase], frameCentsEachSide: e, root: row.tones[rootTone], modulation, table,
      tempoBpm: meter.tempoBpm, leader, baseHz, cycleSeconds: tg.loop, rowCycleSeconds: T, cut: { bars: tg.N },
    } : {
      bars: N, slotsPerBar: S, beatsPerBar: BEATS_PER_BAR, anchors, phase: [...phase], frameCentsEachSide: e, root: row.tones[rootTone], modulation, table,
      tempoBpm: meter.tempoBpm, leader, baseHz, cycleSeconds: T, ...(input.changes ? { changes: JSON.parse(JSON.stringify(input.changes)) } : {}),
    },
    chords: h.chords.map((c) => specChordOf(c, { fundamentalRatio: c.fundamentalRatio, targeted: targeted ? prog.roots[c.slots != null ? c.span : c.bar] != null : undefined })),
    modulations: h.modulations.map((m) => ({ ...m })),
    timeline: { slotStarts: ctx.starts.map((x) => x * T), barStarts: ctx.starts.filter((_, j) => j % S === 0).map((x) => x * T) },
    parts: partList,
    ...(clave ? { clave } : {}),
    decisions,
    stats: {
      onsets: row.n, tones: row.tones.length, grid: row.grid, onsetsPerSlot: (tg ? tg.windowOnsets : row.n) / P, notes: counts,
      leadPhrases: h.passes.phrases.length, secondPassWins: h.passes.secondWins, exceptions: h.exceptions,
      chordVoices: voices.reduce((n, v) => n + (v ? v.length : 0), 0) / N, ...(led ? { voicing: voicingStats(voiced) } : {}), bassRooted: `${bassRooted}/${N}`, innerOnLeadSlots: innerOnLead,
      ...(chordsStyle ? { clave: { id: clave.id, relation: clave.relation, strokes: compStrokes.length, silent: clave.relation === 'fill' ? clave.partner.silent + clave.partner.shared : clave.silent }, compStrum } : { compLayer: { layer: 'ABCD'[comp.layer], value: comp.value, score: comp.score } }),
      settle: { rounds: h.settle.rounds, converged: h.settle.converged, oscillated: h.settle.oscillated, changedBarsPerRound: [...h.settle.changedBarsPerRound],
        exceptionsPerRound: [...h.settle.exceptionsPerRound], chosenRound: h.settle.chosenRound, ...(h.settle.pinned ? { pinned: true } : {}) },
    },
  };
  // ── a MIDI target: the clip, its placement and how it fits, and the clip's own tempo (playback's seed: decided) ──
  if (tg) {
    spec.target = { clip: JSON.parse(JSON.stringify(tg.clip)), placement: tg.placement, misses: { ...tg.placement.misses }, tempoBpm: tg.clip.tempoBpm ?? tg.clip.bpm ?? null,
      tonic: tg.tonic, tonicAsked: tg.tonicAsked, maxDriftCents: tg.maxDriftCents, lanes: tg.lanes, alternates: tg.alternates, search: tg.search };
  }
  // ── drums (drums.js): from the spec alone, so the lab re-arranges them without composing again; `drums: false` leaves them out ──
  if (drums !== false) spec.drums = arrangeDrums(spec, drums === true ? {} : drums);
  // ── the bass arranged (Amendment 2, P28): bass.js `arrangeBass` over the spec as it plays (the drums above read no bass,
  // so its kick is theirs), at the density and lock asked or Moving · Kick; what it returns is the bass part, so a later
  // `arrangeBass` at those options gives it again byte for byte, and rearrange.js re-mines it at them ──
  if (!bassOwn) {
    const part = arrangeBass(spec, { row, cells }, bassAsk), B = part.bass;
    partList[partList.findIndex((p) => p.id === 'bass')] = part;
    counts.bass = part.notes.length;
    spec.stats.bassRooted = `${B.stats.rooted}/${N}`;
    decisions.splice(bassDecisionAt, 0, { what: 'bass', value: `${B.density} · ${B.stats.lock}`, why: bassWhy(B, ov.bass != null) });
    if (rec) for (const b of B.bars) rec.bassBar(b.bar, bassLineOf(b), b.rooted);
  }
  rec?.parts(partList, { ...(chordsStyle ? { clave, alternates: claveAlternates(claveChoice.ranks), asked: ov.clave != null, tier: claveChoice.ranks.tier, density: claveChoice.ranks.density ?? null } : { comp, compChoices, compAsked: ov.compLayer != null }), voicing: led ? voicingStats(voiced) : null });
  if (rec) { rec.drums(spec); rec.done(spec); spec.trace = rec.finish(); }
  return spec;
}
