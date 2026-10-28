// composer-controller.js — the Composer's state and actions, with no DOM. Shared (promoted from lab/lab-controller.js,
// 2026-10-22): the lab (Composer/lab/composer-lab.js) and the main page's Composer tab (Composer/page/tab-controller.js)
// are thin layers over it. Composer/tests/assert-lab.mjs drives it in Node with a recording mock AudioContext.
//
//   input      four layers (0 or blank absent), the cycle in seconds, a seed
//   knobs      bars, slots per bar, frame ±¢, modulation, anchors: null leaves the choice to Compose; a value overrides
//   table      'full' runs Compose in the module worker (its default there), 'lean' on the main thread (its default
//              there), so neither is an override: where Compose runs decides the table, as phase 4 set it up
//   button     Compose → (Composing…) → Perform ⇄ Stop; any change of input, knob or table goes back to Compose
//   parts      the spec's parts as they play now: a sound, legato or on/off change re-articulates the part from the
//              spec with compose.js' own `rearticulate` (the decided legato rule), nothing re-mined; a level is the
//              part's bus
//   tempo      a playback tempo over the spec's own (TEMPO_LIMITS): the player scales the spec's times by
//              factor = the spec's tempo / this one, live, nothing re-composed; a new Compose resets it to the new
//              spec's tempo (proposed). The spec is never touched; JSON export adds a top-level `playback`.
//   progression one root a bar, or null (auto), from `rootChoices()` (progression.js' rootCandidates, on this thread:
//              one row build and a sweep); as many bars as Compose will use (the bars knob, else compose.js'
//              chooseMeter). Compose sends it only when a bar is pinned, so all auto is today's Compose exactly.
//              "Take from last compose" seeds it with the spec's roots; Clear empties it; new layers clear it (the
//              ratios belong to the old row). The spec's `input.progression` is what JSON export carries.
//   drums      the Drums (Perc) part as it plays now: a mode or curated pattern, fills, on/off, a level and a kit sound
//              a voice. A change re-arranges the drums from the spec with drums.js' own `arrangeDrums`, on this
//              thread, nothing re-composed (live while playing); a new Compose re-arranges them with the same options.
//   in flight  a change while Compose runs (an input, knob or table) drops that compose's answer when it comes: the
//              button goes back to Compose at once (the main page's rhythm can change under a compose).
//   hooks      beforePerform () → called as Perform starts (the main page stops its own playback there: one thing
//              sounds at a time)
//   state      one composition's state (Composer/store/composition-store.js newCompositionState: the store's entry
//              shape). The lab keeps the one it starts with. The main page binds the store's current entry
//              (bind(state), sprint 2): a bind stops playback and re-renders; nothing else in the state moves.
//   one flight one compose in flight per state: Compose again on a state that is composing joins that compose (the
//              same promise). A compose lands in the state it was started for, even when another one is bound by
//              then (the main page's cache); a change to that state while it runs drops the answer, as before.
//   levels     setLevel notifies onLevel listeners (id, value), not onChange (a slider mid-drag is not re-rendered):
//              the main page's part strips and the window's inspector keep each other's level in step.
//   trace      every compose asks Compose for its trace (core/trace.js) and keeps it apart from the spec, in
//              `state.trace` (STEP 4a: always, at ALTERNATE_CAPS, for the alternates; before, only for
//              compose({ trace: true })): the spec, the lanes and JSON export are the same with it or without it.
//              The main page's tab animates Compose from it (page/compose-animator.js) while "show the work" is on.
//   edits      (STEP 4d; DESIGN_NOTES "Step 4d: store edits and pins") live local edits of the composition, held in the
//              entry (store/composition-store.js: composed, edits, field, undo/redo, dropped):
//                swapChord(bar, candidate | { rootTone, quality })   a bar's chord (decision 1: the lead stays)
//                swapLead(phrase, lineId, { chordsFollow, smooth })  a phrase's lead for a runner-up line (decision 2)
//                setProgressionField(text)   the typed field: resolved per bar (chord-symbols.js), its chords typed edits
//                setDrumGrid(grid) / setDrumCell(bar, voice, place, value) / applyDrumPreset(mode)   the step grid
//                undo() / redo()             (at most UNDO_LIMIT steps; a Compose clears them)
//              Each returns a Promise of { ok, changedBars, retunedBars, … }; on this thread it has applied before it
//              returns. `state.composed` is Compose's spec, untouched; `state.spec` is composed + edits (rearrange.js,
//              in the edits' order), so the player, the lanes, the plot, the part strips, the lens and its recall all
//              read the edited composition with no change of theirs. The parts' sound/legato/on-off and levels stay
//              live as before, over the edited notes. Edits never make the entry dirty.
//              Where an edit runs: this thread while the row has at most MAIN_THREAD_ONSETS onsets (a lead swap on
//              the full table: MAIN_THREAD_LEAD_FULL_ONSETS), else the module worker (runCompose.rearrange, the row
//              kept there per key); `smooth` (smoothPhrase) always in the worker. No worker given: this thread.
//              A re-compose (decision 5) keeps the chord edits as pins (into `progression` as { ratio, quality }),
//              drops the lead edits, drops a pin the new row lacks, keeps the drum grid only on the same meter, and
//              says what it dropped in `state.dropped`.
//   audition   (STEP 4e) audition(run) / keepAudition() / revertAudition() / auditioning(): an edit tried live (the
//              window's alternates); kept, it is one undo step; reverted, the edits AND the undo/redo stacks are as
//              they were before it (no redo step is left). Auditions in a row are one audition.
//   target     (MIDI targets, phase B; DESIGN_NOTES "MIDI targets (phase B)") a clip as the composition's lead:
//                setTarget(bytes | clip | null, { tonic, name })   decoded here (midi.js), placed and composed through
//                              runCompose (compose.js' `target`: the search runs where Compose runs, P7); null clears it
//                              and composes nothing (the entry goes dirty; Compose again for an ordinary one: Avery). Setting or clearing one clears the pins, the field and the
//                              edits (they were another meter's bars; proposed)
//                setTargetTonic(pc | null)   the 12-way tonic override (P5): placed again, composed
//                auditionPlacement(i) / keepPlacement() / revertPlacement() / placementAudition()   the search's
//                              alternates (state.placements.list), auditioned as the matrix's are: composed with that
//                              placement given (no search), played again from the top if it was playing; kept, it is
//                              the entry's placement; reverted, the entry is exactly as it was (no re-compose)
//              `state.input.target` holds the clip (as decoded: no bytes) and its tonic and kept placement, so the
//              glyph's recall, undo and the store's LRU carry it. A target compose seeds the playback tempo from the
//              clip's (spec.target.tempoBpm, decided 1/4), and `seedTempo()` is what Reset goes back to. A target spec
//              takes no lead swaps (P6): `alternatesOf(bar, 'lead')` is null, `swapLead` refuses. The overrides a
//              target sets itself (compose.js TARGET_SETS: bars, slots per bar, anchors, settle passes, presence) are
//              left out of its compose. On the lean table a target compose of a row past MAIN_THREAD_ONSETS goes to
//              the worker anyway (P7), its table kept lean.
//   charts     (Composer/CHART_ORDER.md, phase B) a typed field with a bar line is a chord chart (core/chart.js): it sets
//              the bars (decided) and may split a bar among chords. Compose is sent its `changes`; the progression is
//              then one pin a CHORD (a span), and so are the chord edits, swaps and alternates (`bar` there is the
//              chord's index; unitsOfBar(bar) lists a bar's). A chart of the composed spec's shape is live, as a typed
//              chord is; another shape (bars, or a bar split anew) waits for Compose (P9): the pins go to the next
//              Compose, the edits of the old shape are dropped, the entry goes dirty. A swap writes its chord into the
//              chart where the chord is written once, else the chart is written out played (repeats and holds unrolled).
//   arps       (COMP_ARP_ORDER.md B2; DESIGN_NOTES "Comping and Arp in the window") the lead and the inner voice each
//              play Line (the mined line) or Arp (core/arp.js arrangeArp: an arpeggio mined over the chords at ×1–×3
//              the slots a bar, COMP_ARP_ORDER.md Amendment 1, phase D; each phrase's ranked arps, one picked):
//                setArp(part, { mode: 'line' | 'arp', time (1 | 2 | 3), picks ({ [phrase]: id }) })   live, no
//                                                                      re-compose; one undo step
//                arpOf(part) → { mode, time, picks, times, playing, refusal, stats, phrases }
//              The choice is the entry's (`state.arps`, store/composition-store.js): in the undo snapshots, kept through
//              a re-compose and the glyph's recall. `state.spec` is composed + edits in Line (the fold), THEN the arps
//              over it, the lead first (the inner keeps off the lead as it sounds, Q4); the drums are arranged over
//              that. So a chord swap, a lead swap, an undo or a re-compose rebuilds the Line part and re-arps it from
//              the fresh line, an inner arp follows the lead's mode, and the drums' *with* hears the arp lead. A big
//              row's arps (past MAIN_THREAD_ONSETS) are arranged in the module worker (runCompose.arp), from its kept
//              materials; arrangeArp is ~20 / 35 / 50 ms a part on the 16k row at ×1 / ×2 / ×3 (phase D), so every
//              other row arranges on this thread. While the
//              lead is an arp its runner-ups are hidden (Q5: alternatesOf(bar, 'lead') is null). A MIDI target's lead
//              is the clip (arpRefusal): its Arp is refused, and setting a clip puts the lead back in Line (proposed).
//              An inner in Arp sounds the harp (INNER_ARP_SOUND, Q4) unless a sound was chosen for it: a part's sound
//              carries through a rebuild only where it differs from the spec's own.

import { compose, rearticulate, chooseMeter, PART_IDS, TARGET_SETS } from '../core/compose.js';
import { arrangeArp, arpRefusal, arpTimes, ARP_PARTS, ARP_TIMES, ARP_DEFAULTS } from '../core/arp.js';   // B2: the Arp mode (phase D: mined)
import { rootCandidates, chooseChordOnRoot, qualityById } from '../core/progression.js';
import { NOTE_INSTRUMENT_IDS, getInstrument } from '../../Audio/voices/recipes.js';
import { createPlayer } from './composer-player.js';
import { arrangeDrums, gridOf, readGrid, beatsOf, ALL_DRUM_MODES, DRUM_VOICES, DEFAULT_KIT, GRID_CHARS } from '../core/drums.js';
import { DRUM_PATTERNS } from '../core/drum-patterns.js';
import { MADE_DRUM_CHOICES } from '../../Audio/drums/index.js';
import { newCompositionState, KNOB_NAMES, emptyEdits, UNDO_LIMIT, lineArps } from '../store/composition-store.js';
import { ALTERNATE_CAPS } from '../core/trace.js';   // STEP 4a
// STEP 4d: the edits
import { rearrange, applyRearrange, materialsOf, materialsKey } from '../core/rearrange.js';
import { barMaterials, resolveSymbols, pinsToField } from '../core/chord-symbols.js';
import { isChart, readChart, isPlain } from '../core/chart.js';
import { phrasesOf, isStrongBeat } from '../core/harmony.js';
// MIDI targets (phase B)
import { readMidi, decodeClip } from '../core/midi.js';
import { onsetCount } from '../core/row.js';
import { orderedEdits, setChordEdit, removeChordEdit, setLeadEdit, removeLeadEdit, sameRecord, hasEdits, snapshotOf, restoreSnapshot, pushUndo, pinOf, asksOf,
  rewriteToken, rewriteChart, chordAlternates, leadAlternates, leadAlternatesOf, phraseOfBar } from '../store/composition-edits.js';

export const LAB_VERSION = 'composer-lab-v1';
/** a few rhythms across sizes; 41:42:43 first (tone-rich, mid-size) */
export const PRESETS = Object.freeze([
  { name: '41:42:43 — 124 onsets, 41 tones', layers: [41, 42, 43, 0], cycleSeconds: 8 },
  { name: '8:7:6:5 — 22 onsets, the LRC classic', layers: [8, 7, 6, 5], cycleSeconds: 4 },
  { name: '19:17:16:15 — 64 onsets', layers: [19, 17, 16, 15], cycleSeconds: 6 },
  { name: '119:42:15:8 — the 12EDO floor champion', layers: [119, 42, 15, 8], cycleSeconds: 8 },
  { name: '768:769 — 1,536 onsets, 384 tones', layers: [768, 769, 0, 0], cycleSeconds: 8 },
  { name: '4099:4093:4091:4079 — 16,359 onsets, 4,177 tones', layers: [4099, 4093, 4091, 4079], cycleSeconds: 16 },
]);
export const KNOBS = KNOB_NAMES;
export const AUTO_RECOMPOSE_MS = 300;
/** the playback tempo's range, BPM */
export const TEMPO_LIMITS = Object.freeze([30, 300]);
/** STEP 4d: an edit runs on this thread while the row has at most this many onsets (a chord swap measured ≤ ~17 ms at
 *  32,766 onsets on either table, 24–28 ms at 131,070), else in the module worker (proposed) */
export const MAIN_THREAD_ONSETS = 32768;
/** …a lead swap on the full table only up to this many (it is 35–50 ms from 10k onsets up, 15 ms at 1,536; proposed) */
export const MAIN_THREAD_LEAD_FULL_ONSETS = 2048;
/** B2 (Q4): an inner voice in Arp sounds this, unless a sound was chosen for it */
export const INNER_ARP_SOUND = 'harp';
/** B2: the Arp parts and their knob's choices, for a view (phase D, M5: Time replaced Pattern, Rate and Range) */
export const ARP_CHOICES = Object.freeze({ parts: ARP_PARTS, times: ARP_TIMES });
/** every sound a part can play: the note-role instruments of Audio/voices, in the catalog's order */
export const soundChoices = () => NOTE_INSTRUMENT_IDS.map((id) => ({ id, label: getInstrument(id).label }));

// ── drums ──
const DRUM_MODE_LABELS = { backbeat: 'backbeat (default)', with: 'clave: with lead + comping', against: 'clave: against lead + comping', partition: 'partition: the downbeat layer',
  grid: 'grid: the step grid', prime: 'prime: the two-level prime partition' };   // STEP 4d: grid and prime (drums.js keeps them out of DRUM_MODES)
/** every drum mode: the layered modes, each curated pattern, then the source modes (the step grid, the prime partition) */
export const drumModeChoices = () => ALL_DRUM_MODES.map((id) => ({ id, label: DRUM_MODE_LABELS[id] ?? `pattern: ${DRUM_PATTERNS[id].label}` }));
/** the built-in samples Partitions plays (assets/audio): relative to the lab page by default; the main page passes
 *  its own base ('assets/audio/') */
const SAMPLE_KINDS = { kick: 'kick', snare: 'snare', hat: 'hat', perc: 'perc', cym: 'cym' };
export const LAB_SAMPLES_BASE = '../../assets/audio/';
/** a voice's sound choices: off, the made kit of Audio/drums, the site's samples of that kind */
export const kitChoices = (voice, base = LAB_SAMPLES_BASE) => [{ value: '', label: 'off' }, ...MADE_DRUM_CHOICES.map((c) => ({ value: c.value, label: `${c.label} (made)` })),
  ...[1, 2, 3, 4].map((i) => ({ value: `${base}${SAMPLE_KINDS[voice]}${i}.wav`, label: `${SAMPLE_KINDS[voice]}${i}.wav` }))];
export const DRUM_LAB_VOICES = DRUM_VOICES;

/**
 * MIDI targets (phase B): a clip for setTarget → the clip as decoded (midi.js decodeClip). source: a .mid file's bytes
 * (Uint8Array, ArrayBuffer or any typed array), or a decoded clip (copied). opts { name: the file's name, for a clip
 * whose track names none }. Throws midi.js' own errors ("not a MIDI file", "no notes", …).
 */
export function readClip(source, { name = null } = {}) {
  if (source && typeof source === 'object' && Array.isArray(source.notes) && Number.isInteger(source.S)) return JSON.parse(JSON.stringify(source));
  const bytes = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source)
    : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : null;
  if (!bytes) throw new Error('composer: a MIDI clip is a .mid file\'s bytes');
  const clip = decodeClip(readMidi(bytes));
  if (name && (!clip.name || clip.name === 'clip')) clip.name = String(name).replace(/\.midi?$/i, '');
  return clip;
}

/** layers as typed: a number, blank or 0 (absent) → [a, b, c, d] */
export function readLayers(values) {
  return [0, 1, 2, 3].map((i) => { const v = Number(values[i]); return Number.isInteger(v) && v > 0 ? v : 0; });
}

/**
 * createComposerController({ runCompose, createContext, timers, clock, beforePerform, destination, state })
 *   runCompose(layers, cycleSeconds, { seed, overrides, worker, progression }) → Promise<spec>   (a page: the worker
 *               for 'full', compose() itself for 'lean' — compose-runner.js; by default compose() for both)
 *   createContext () → an AudioContext, made on the first Perform
 *   beforePerform () → called as Perform starts, before anything is booked
 *   destination   the AudioNode the player's limiter feeds (the context's destination by default)
 *   state         the composition state to start bound to (a fresh one, on the lab's first preset, by default)
 *   runRearrange  ({ key, spec, edit, opts }) → Promise<rearrange's result>: the worker for big rows (STEP 4d;
 *                 runCompose.rearrange by default, compose-runner.js'; none: every edit on this thread)
 *   mainThreadOnsets, leadFullOnsets   where an edit runs (MAIN_THREAD_ONSETS, MAIN_THREAD_LEAD_FULL_ONSETS)
 *   midi          the MIDI sink the player books into (composer-midi.js; CLEAN_MIDI_ORDER.md phase B), or none
 *   runArp        ({ key, spec, parts }) → Promise<[arranged parts]>: a big row's arps in the worker (B2; runCompose.arp
 *                 by default; none: every arp on this thread)
 */
export function createComposerController({ runCompose = async (l, T, o) => compose(l, T, o), createContext = () => new AudioContext(), timers = globalThis, clock = () => (globalThis.performance ? performance.now() : Date.now()), beforePerform = null, destination = null, state: initial = null,
  runRearrange = runCompose?.rearrange ?? null, mainThreadOnsets = MAIN_THREAD_ONSETS, leadFullOnsets = MAIN_THREAD_LEAD_FULL_ONSETS, midi = null, runArp = runCompose?.arp ?? null } = {}) {
  let state = initial ?? newCompositionState({ layers: PRESETS[0].layers, cycleSeconds: PRESETS[0].cycleSeconds, seed: 1 });
  const listeners = new Set(), levelListeners = new Set();
  const changed = (st = state) => { for (const f of listeners) f(st); };
  // per state: its compose generation (a change bumps it, dropping the answer in flight) and the compose in flight
  const runs = new WeakMap(), flights = new WeakMap();
  const bump = (st) => { const n = (runs.get(st) ?? 0) + 1; runs.set(st, n); return n; };
  let ctx = null, player = null, choices = null, choicesKey = null;
  let localSound = true;   // M7: the voices heard while the MIDI goes out (session only)

  const overrides = () => { const o = {}; for (const k of KNOBS) if (state.knobs[k] != null) o[k] = state.knobs[k]; return o; };
  const settled = (st = state) => (!st.spec ? 'idle' : st.spec.refused ? 'refused' : 'ready');
  const touch = () => {
    if (player?.playing) player.stop();
    placementMarks.delete(state);   // MIDI targets: an input change keeps an auditioned placement
    state.dirty = true;
    if (state.status === 'playing') state.status = settled();
    if (state.status === 'composing') { bump(state); flights.delete(state); state.status = settled(); }   // the answer in flight is for the old input
    changed();
  };
  const sameLayers = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  // MIDI targets: per state, the placement audition open on it: { snap (the entry before it), index, playing }
  const placementMarks = new WeakMap();
  /** new layers: a target's placement (and the search's list) belong to the old row */
  const dropPlacement = (st) => { if (st.input.target?.placement) { const { placement, ...rest } = st.input.target; st.input.target = rest; } st.placements = null; };

  // ── STEP 4d: the edits ──────────────────────────────────────────────────────────────────────────────────────────
  // per composed spec: its row and cells (materialsOf, ~8 ms on the 16k row, once), and the field's bar materials
  const mats = new WeakMap(), fieldMats = new WeakMap();
  let looseField = { key: null, value: null };   // the field's materials before any compose (the knobs as they are)
  // per state: the fold — each edit's spec in order, so a new edit is one rearrange and an undo of the last is none
  const folds = new WeakMap();
  // STEP 4e: per state, the audition open on it: { composed, base (the snapshot before it), undo, redo, last }
  const auditions = new WeakMap();
  const editListeners = new Set();
  const STALE = Symbol('stale');
  const ready = (st) => !!(st.composed && !st.composed.refused && st.spec && !st.spec.refused);
  const requireSpec = (st) => { if (!ready(st)) throw new Error('composer: nothing composed to edit'); };
  const materialsFor = (st) => { let m = mats.get(st.composed); if (!m) { m = materialsOf(st.composed); mats.set(st.composed, m); } return m; };
  // ── B2: the Arp mode (COMP_ARP_ORDER.md; arrangeArp over the spec in Line, the lead first) ──
  /** the parts this entry plays as arps over this spec: Arp chosen and not refused (a target's lead), the lead first */
  const arpsOn = (st, spec) => ARP_PARTS.filter((id) => st.arps?.[id]?.mode === 'arp' && !arpRefusal(spec, id));
  /** the arp jobs for a spec: [{ id, options: its time, its picks and its legato as it plays }] */
  const arpJobs = (st, spec) => arpsOn(st, spec).map((id) => {
    const a = st.arps[id];
    return { id, options: { time: a.time ?? ARP_DEFAULTS.time, picks: { ...(a.picks ?? {}) }, legato: st.parts?.[id]?.legato ?? spec.parts.find((p) => p.id === id)?.legato ?? false } };
  });
  /** arranged arp parts into a spec in Line; an inner arp's own sound the harp (Q4: a sound chosen for it wins in settleState) */
  function placeArps(spec, parts) {
    const T = spec.knobs.cycleSeconds, by = new Map(parts.map((p) => [p.id, p.id === 'inner' && p.sound !== INNER_ARP_SOUND ? rearticulate(p, { sound: INNER_ARP_SOUND, cycleSeconds: T }) : p]));
    return { ...spec, parts: spec.parts.map((p) => by.get(p.id) ?? p) };
  }
  /** a spec in Line with the entry's arps, arranged on this thread (each over the one before: the inner hears the lead) */
  function withArps(st, line) {
    const jobs = arpJobs(st, line);
    if (!jobs.length) return line;
    const m = materialsFor(st), out = [];
    let spec = line;
    for (const j of jobs) { const p = arrangeArp(spec, m, j.id, j.options); out.push(p); spec = { ...spec, parts: spec.parts.map((x) => (x.id === j.id ? p : x)) }; }
    return placeArps(line, out);
  }
  /** a big row's arps go to the worker (its kept materials), as its edits do */
  const arpOnWorker = (st) => !!runArp && st.composed.stats.onsets > mainThreadOnsets;
  // ── charts: the typed field read as a chord chart (null: not a chart; { error }: one that can't be read) ──
  let chartMemo = { text: null, value: null };
  const chartOfText = (text) => {
    if (text == null || !isChart(text)) return null;
    if (chartMemo.text !== text) chartMemo = { text, value: readChart(text) };
    return chartMemo.value;
  };
  const chartOf = (st) => chartOfText(st.field?.text);
  /** the shape a field asks for: a readable chart's changes, else null (Compose's own bars) */
  const shapeOfText = (text) => { const c = chartOfText(text); return c && !c.error ? c.changes : null; };
  const sameShape = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  /** a spec whose chords are a chart's spans (a bar split among chords)? */
  const splitSpec = (spec) => !!spec?.chords?.some((c) => c.slots != null);
  /** the chord indices of bar k (one a bar, unless split) */
  const unitsOf = (spec, k) => (splitSpec(spec) ? spec.chords.flatMap((c, i) => (c.bar === k ? [i] : [])) : [k]);
  const barOfUnit = (spec, u) => (splitSpec(spec) ? spec.chords[u].bar : u);
  /** the field's materials: the composed spec's bars (its knobs reproduce its cells) when the field asks for the composed
   *  shape, else Compose's for the knobs now and the field's chart (CHART_ORDER P9) */
  function fieldMaterialsOf(st, text = st.field?.text) {
    const want = shapeOfText(text);
    if (ready(st) && sameShape(want, st.composed.knobs.changes)) {
      let m = fieldMats.get(st.composed);
      // MIDI targets: a window's cells are cropped, so the spec's own (materialsOf) go in; the knobs alone can't rebuild them
      if (!m) { const own = materialsFor(st); m = barMaterials(st.composed.input.layers, st.composed.knobs.cycleSeconds, st.composed.knobs, { row: own.row, ...(st.composed.knobs.cut ? { cells: own.cells } : {}) }); fieldMats.set(st.composed, m); }
      return m;
    }
    const knobs = { ...overrides(), seed: st.input.seed }, key = JSON.stringify([st.input.layers, st.input.cycleSeconds, knobs, want]);
    if (looseField.key !== key) {
      let value;
      try { value = barMaterials(st.input.layers, st.input.cycleSeconds, knobs, want ? { changes: want } : {}); } catch (err) { value = { refused: true, reason: String(err && err.message ? err.message : err) }; }
      looseField = { key, value };
    }
    return looseField.value;
  }
  /** the field's word for a bar's (a chord's) ask (a pin or null): a bare word, never a chart */
  const wordOf = (m, ask) => (ask ? pinsToField([ask], { ...m, changes: null }) || '-' : '-');
  /** the field's text with the given bars' (chords') words, `wordAt(k)`: a plain field token by token; a chart where each
   *  chord is written once, else written out played (P9) */
  function rewriteField(st, m, units, wordAt) {
    const ch = chartOf(st);
    if (ch && !ch.error) return rewriteChart(st.field.text, ch, units, wordAt, () => pinsToField(asksOf(st, m.units.length), m));
    let text = st.field.text;
    for (const k of units) text = rewriteToken(text, k, wordAt(k));
    return text;
  }
  /** keep a typed field in step with a bar's (a chord's) ask after an edit (the user's text elsewhere untouched) */
  function syncField(st, bars) {
    if (!st.field || !bars.length) return;
    const m = fieldMaterialsOf(st);
    if (!m || m.refused) return;
    const asks = asksOf(st, m.units.length);
    st.field = { text: rewriteField(st, m, bars, (k) => wordOf(m, asks[k])) };
  }
  /** is bar (chord) k inside a phrase whose lead edit has the chords follow? */
  const followed = (st, k) => Object.entries(st.edits.lead).some(([p, e]) => e.chordsFollow && phraseOfBar(st.composed, barOfUnit(st.composed, k)) === Number(p));
  /** where an edit runs */
  function onWorker(st, e) {
    if (!runRearrange) return false;
    if (e.kind === 'lead' && e.smooth) return true;
    const n = st.composed.stats.onsets;
    return n > mainThreadOnsets || (e.kind === 'lead' && st.composed.knobs.table === 'full' && n > leadFullOnsets);
  }
  /** an edit record → rearrange's edit and options */
  function jobOf(st, e) {
    if (e.kind === 'chord') return { edit: { [splitSpec(st.composed) ? 'span' : 'bar']: e.bar, chord: { rootTone: e.rootTone, quality: e.quality } }, opts: {} };
    const line = st.trace?.lines?.[e.lineId];
    if (!line) throw new Error(`composer: no line ${e.lineId} in the trace`);
    return { edit: { phrase: e.phrase, line: { notes: line.notes }, chordsFollow: !!e.chordsFollow }, opts: e.smooth ? { smoothPhrase: true } : {} };
  }
  /** the bars that moved from one spec to the next: a chord or a part's notes (not their lengths), else only re-pitched */
  function movedBars(a, b) {
    const N = b.knobs.bars, changedBars = [], retunedBars = [];
    const chordOf = (c) => { const { name, pcs, rootPc, offsetCents, rawOffsetCents, fundamentalRatio, offGrid, ...rest } = c; return JSON.stringify(rest); };
    const notesOf = (spec, k) => spec.parts.map((p) => p.notes.filter((n) => n.bar === k).map(({ duration, retrigger, hz, ...rest }) => JSON.stringify(rest)).join('|')).join('/');
    // a bar's chords (a chart's split bar has several)
    const own = (spec, k) => unitsOf(spec, k).map((u) => spec.chords[u]);
    for (let k = 0; k < N; k++) {
      const ca = own(a, k), cb = own(b, k);
      if (ca.map(chordOf).join('/') !== cb.map(chordOf).join('/') || notesOf(a, k) !== notesOf(b, k)) changedBars.push(k);
      else if (ca.some((c, i) => Math.abs(c.fundamentalRatio - cb[i].fundamentalRatio) > 1e-12)) retunedBars.push(k);
    }
    return { changedBars, retunedBars };
  }
  /**
   * The edited spec in place: the arps over it (B2: `arped`, the parts the worker arranged; undefined, arranged here),
   * the parts re-articulated as they play now, the drums arranged over it. A part's sound carries over only where it
   * was chosen (it differs from the spec's own part's), so an inner switched to Arp takes the harp and back to Line its
   * own (Q4); legato and on/off always carry.
   */
  function settleState(st, eff, arped = undefined) {
    const line = eff ? { ...eff, drums: st.composed.drums } : st.composed, T = st.composed.knobs.cycleSeconds;
    const next = arped === undefined ? withArps(st, line) : arped ? placeArps(line, arped) : line;
    const own = Object.fromEntries((st.spec?.parts ?? []).map((p) => [p.id, p.sound]));
    const art = Object.fromEntries(Object.values(st.parts).map((p) => [p.id, { sound: p.sound !== own[p.id] ? p.sound : null, legato: p.legato, enabled: p.enabled }]));
    st.spec = next;
    st.parts = Object.fromEntries(next.parts.map((p) => {
      const a = art[p.id];
      return [p.id, a && ((a.sound != null && a.sound !== p.sound) || a.legato !== p.legato || a.enabled !== p.enabled) ? rearticulate(p, { sound: a.sound ?? p.sound, legato: a.legato, enabled: a.enabled, cycleSeconds: T }) : p];
    }));
    st.drums = arrangeDrums(next, st.drumOptions);
  }
  /**
   * composed + edits, in order, from the fold's cache: the steps whose edits are unchanged are kept, the rest run
   * (this thread, or the worker). → the summary, or a Promise of it (a step went to the worker), or STALE (a newer
   * fold took over). Throws (or rejects) when a step can't be made.
   */
  function runFold(st) {
    let f = folds.get(st);
    if (!f || f.composed !== st.composed) { f = { composed: st.composed, base: { ...st.composed, drums: undefined }, steps: [], gen: 0, applying: false }; folds.set(st, f); }
    const mine = ++f.gen, list = orderedEdits(st.edits), sigs = list.map((e) => JSON.stringify(e)), was = st.spec;
    let i = 0, spec = f.base;
    while (i < list.length && f.steps[i] && f.steps[i].sig === sigs[i]) { spec = f.steps[i].spec; i++; }
    f.steps.length = i;
    const commit = (r) => { spec = applyRearrange(spec, r); f.steps.push({ sig: sigs[i], spec }); i++; };
    // stale: a newer fold of this state took over, or a Compose landed (a new fold record) while a worker step ran; a
    // stale answer, or a stale failure, never touches the state
    const stale = () => mine !== f.gen || folds.get(st) !== f || st.composed !== f.composed;
    const finish = (arped) => { f.applying = false; settleState(st, list.length ? spec : null, arped); return { ok: true, ...movedBars(was, st.spec), edits: list.length }; };
    const loop = () => {
      while (i < list.length) {
        const e = list[i], job = jobOf(st, e);
        if (onWorker(st, e)) {
          f.applying = true;
          return Promise.resolve(runRearrange({ key: materialsKey(spec), spec, edit: job.edit, opts: job.opts })).then((r) => (stale() ? STALE : (commit(r), loop())),
            (err) => { if (stale()) return STALE; f.applying = false; throw err; });
        }
        const { row, cells } = materialsFor(st);
        commit(rearrange(spec, row, cells, job.edit, job.opts));
      }
      // B2: the arps over the spec in Line (the edits applied); a big row's in the worker
      const line = list.length ? spec : st.composed, jobs = arpJobs(st, line);
      if (jobs.length && arpOnWorker(st)) {
        f.applying = true;
        return Promise.resolve(runArp({ key: materialsKey(line), spec: line, parts: jobs })).then((parts) => (stale() ? STALE : finish(parts)),
          (err) => { if (stale()) return STALE; f.applying = false; throw err; });
      }
      return finish(undefined);
    };
    return loop();
  }
  /** apply the entry's edits now (after a change of them); on a failure the snapshot comes back (and the undo step goes) */
  function applyEdits(st, { rollback = null, kind = 'edit', detail = {} } = {}) {
    const done = (out) => {
      if (out === STALE) return { ok: true, superseded: true };
      changed(st);
      const result = { ...out, kind, ...detail };
      for (const fn of [...editListeners]) fn(result, st);
      return result;
    };
    const failed = (err) => {
      const error = String(err && err.message ? err.message : err);
      if (rollback) { restoreSnapshot(st, rollback); st.undo.pop(); }
      let again;
      try { again = runFold(st); } catch { again = null; }
      return Promise.resolve(again).catch(() => null).then(() => { changed(st); return { ok: false, error, kind, ...detail }; });
    };
    let out;
    try { out = runFold(st); } catch (err) { return failed(err); }
    return out && typeof out.then === 'function' ? out.then(done, failed) : Promise.resolve(done(out));
  }
  /** one undoable change of the bound entry's edits: mutate () → false for nothing to do */
  function edit(kind, detail, mutate) {
    const st = state;
    requireSpec(st);
    const before = snapshotOf(st);
    if (mutate(st) === false) { restoreSnapshot(st, before); return Promise.resolve({ ok: true, noop: true, kind, ...detail }); }
    pushUndo(st, before);
    return applyEdits(st, { rollback: before, kind, detail });
  }
  /** one undoable change of the bound entry's drum grid or mode (no rearrange: the drums re-arranged over the spec) */
  function drumEdit(kind, detail, mutate) {
    const st = state;
    requireSpec(st);
    const before = snapshotOf(st);
    if (mutate(st) === false) { restoreSnapshot(st, before); return Promise.resolve({ ok: true, noop: true, kind, ...detail }); }
    try { st.drums = arrangeDrums(st.spec, st.drumOptions); } catch (err) { restoreSnapshot(st, before); return Promise.resolve({ ok: false, error: String(err && err.message ? err.message : err), kind, ...detail }); }
    pushUndo(st, before);
    changed(st);
    const result = { ok: true, kind, ...detail, silentCells: st.drums.silentCells ?? [] };
    for (const fn of [...editListeners]) fn(result, st);
    return Promise.resolve(result);
  }
  /** the drum grid as it plays now: the entry's own (mode grid or prime), else the arrangement written as one */
  const gridNow = (st) => ((st.drumOptions.mode === 'grid' || st.drumOptions.mode === 'prime') && st.drumOptions.grid ? JSON.parse(JSON.stringify(st.drumOptions.grid)) : gridOf(st.drums));
  const gridWidth = (spec) => spec.knobs.slotsPerBar * beatsOf(spec.knobs.slotsPerBar).m;
  const noteGrid = (st) => { st.edits.grid ??= { bars: st.composed.knobs.bars, slotsPerBar: st.composed.knobs.slotsPerBar, from: st.drumOptions.mode === 'grid' ? 'backbeat' : st.drumOptions.mode }; };
  /** decision 5, as a compose starts: the chord edits written into the pin list as { ratio, quality } */
  function bakePins(st) {
    const entries = Object.entries(st.edits?.chords ?? {});
    if (!entries.length) return;
    const p = [...st.progression];
    for (const [bar, e] of entries) { while (p.length <= Number(bar)) p.push(null); p[Number(bar)] = { ratio: e.rootTone, quality: 'asked' in e ? e.asked : e.quality }; }
    st.progression = p;
  }
  /** decision 5, as a compose lands: pins the new row lacks dropped (amber), lead edits dropped, the grid kept on the
   *  same meter only; the edits cleared (they are pins now) and the undo stack with them */
  function landEdits(st, spec, sent) {
    const dropped = { pins: [], unhonored: [], lead: [], grid: null, p: null };
    for (const [phrase, e] of Object.entries(st.edits?.lead ?? {})) dropped.lead.push({ phrase: Number(phrase), lineId: e.lineId });
    if (!spec.refused) {
      const N = spec.knobs.bars, U = spec.chords.length, p = [...st.progression];
      sent.forEach((pin, k) => {
        if (!pin) return;
        const c = spec.chords[k];
        if (k >= U || !c?.targeted) { dropped.pins.push({ bar: k, ratio: pin.ratio, quality: pin.quality, reason: k >= U ? 'pastBars' : 'notInRow' }); if (k < p.length) p[k] = null; }
        else if (pin.quality && c.quality !== pin.quality) dropped.unhonored.push({ bar: k, ratio: pin.ratio, asked: pin.quality, got: c.quality });
      });
      while (p.length && pinOf(p[p.length - 1]) == null) p.pop();
      st.progression = p;
      const g = st.drumOptions.grid;
      if (g) {
        const meta = st.edits?.grid ?? null, W = gridWidth(spec), now = { bars: N, slotsPerBar: spec.knobs.slotsPerBar };
        const fits = meta ? meta.bars === N && meta.slotsPerBar === now.slotsPerBar : Object.values(g).every((rows) => rows.length === N && rows.every((r) => r.length === W));
        if (!fits) {
          delete st.drumOptions.grid;
          if (st.drumOptions.mode === 'grid') st.drumOptions.mode = meta?.from && meta.from !== 'grid' ? meta.from : 'backbeat';
          dropped.grid = { was: meta ? { bars: meta.bars, slotsPerBar: meta.slotsPerBar } : null, now };
          st.edits.grid = null;
        }
      }
      // STEP 4c-prime: an asked p must be a prime above the meter's N·S·m cells; one the new meter outgrew is dropped
      // (the prime mode then draws its own from the seed), and said
      if (st.drumOptions.p != null) {
        const cells = N * gridWidth(spec);
        if (!(st.drumOptions.p > cells)) { dropped.p = { was: st.drumOptions.p, cells }; delete st.drumOptions.p; }
      }
      if (st.field && dropped.pins.some((x) => x.reason === 'notInRow')) {
        const units = dropped.pins.filter((x) => x.reason === 'notInRow').map((x) => x.bar), m = chartOf(st) && !chartOf(st).error ? barMaterials(spec.input.layers, spec.knobs.cycleSeconds, spec.knobs) : null;
        st.field = { text: m && !m.refused ? rewriteChart(st.field.text, chartOf(st), units, () => '-', () => pinsToField(asksOf({ ...st, edits: emptyEdits() }, m.units.length), m))
          : units.reduce((text, k) => rewriteToken(text, k, '-'), st.field.text) };
      }
    }
    st.edits = { ...emptyEdits(), grid: st.drumOptions.grid ? st.edits?.grid ?? null : null };
    st.undo = []; st.redo = [];
    st.dropped = dropped.pins.length || dropped.unhonored.length || dropped.lead.length || dropped.grid || dropped.p ? dropped : null;
    folds.delete(st);
  }

  // ── MIDI targets (phase B) ──────────────────────────────────────────────────────────────────────────────────────
  const clampTempo = (v) => Math.min(TEMPO_LIMITS[1], Math.max(TEMPO_LIMITS[0], v));
  /** the playback tempo a compose lands with: a target's clip tempo (decided 1/4), else the spec's own */
  const seedTempoOf = (spec) => (spec?.target?.tempoBpm > 0 ? clampTempo(spec.target.tempoBpm) : spec.knobs.tempoBpm);
  /** as a compose lands: a search's placements become the list (current: the best); a compose given its placement
   *  keeps the list it came from; no target, or a refusal, none */
  function landPlacements(st, spec) {
    const t = spec && !spec.refused ? spec.target : null;
    if (!t || !st.input.target) { st.placements = null; return; }
    if (t.search || !st.placements) st.placements = { tonic: t.tonic, list: [t.placement, ...(t.alternates ?? [])], current: 0, lanes: t.lanes ?? null };
  }
  /** the entry as a placement audition finds it (everything a target compose moves), to put back exactly */
  const entrySnap = (st) => ({ target: st.input.target, placements: st.placements, spec: st.spec, composed: st.composed, trace: st.trace, parts: st.parts, drums: st.drums,
    drumOptions: JSON.parse(JSON.stringify(st.drumOptions)), edits: JSON.parse(JSON.stringify(st.edits)), undo: st.undo.slice(), redo: st.redo.slice(), dropped: st.dropped,
    progression: JSON.parse(JSON.stringify(st.progression)), field: st.field, tempoBpm: st.tempoBpm, lastMs: st.lastMs, dirty: st.dirty, error: st.error, status: settled(st),
    arps: JSON.parse(JSON.stringify(st.arps ?? lineArps())) });
  /** a compose in flight for this state is dropped (its answer is for another input), as touch() does */
  const dropFlight = (st) => { if (st.status === 'composing') { bump(st); flights.delete(st); st.status = settled(st); } };
  /** a new clip, or none: the pins, the field and the edits were another meter's bars (proposed) */
  function freshTarget(st) {
    st.progression = []; st.field = null; st.edits = emptyEdits(); st.undo = []; st.redo = []; st.dropped = null;
    delete st.drumOptions.grid; if (st.drumOptions.mode === 'grid') st.drumOptions.mode = 'backbeat';
    folds.delete(st); auditions.delete(st); placementMarks.delete(st);
  }
  /** a target action's answer once its compose lands */
  const outcome = (st, spec, extra = {}) => (spec && !spec.refused && st.status !== 'error' ? { ok: true, spec, ...extra }
    : { ok: false, spec, error: st.status === 'error' ? st.error : spec?.reason ?? 'nothing composed', ...extra });

  const api = {
    get state() { return state; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    /** a part's level moved: f(id, value) (onChange is not called for it) */
    onLevel(f) { levelListeners.add(f); return () => levelListeners.delete(f); },
    /** act on another composition state from now on (the main page's store entry) → whether it changed. Playback
     *  stops (it was the old state's); a compose in flight for the old state keeps running and lands there. */
    bind(next) {
      if (!next || next === state) return false;
      if (player?.playing) player.stop();
      if (state.status === 'playing') state.status = settled();
      state = next;
      changed();
      return true;
    },
    /** is a compose in flight for this state (the bound one by default)? */
    composing: (st = state) => st.status === 'composing' && flights.has(st),
    setLayers(values) { state.input.layers = readLayers(values); state.progression = []; state.field = null; dropPlacement(state); touch(); },
    /** the rhythm from outside (the main page): { layers, cycleSeconds } → whether it changed. A change goes back to
     *  Compose (and stops playback) exactly as typing it would; new layers clear the progression, a new cycle doesn't. */
    setInput({ layers, cycleSeconds } = {}) {
      const L = layers ? readLayers(layers) : state.input.layers, T = Number(cycleSeconds) > 0 ? Number(cycleSeconds) : state.input.cycleSeconds;
      const newLayers = !sameLayers(L, state.input.layers), newCycle = T !== state.input.cycleSeconds;
      if (!newLayers && !newCycle) return false;
      state.input.layers = L; state.input.cycleSeconds = T;
      if (newLayers) { state.progression = []; state.field = null; dropPlacement(state); }
      touch();
      return true;
    },
    setCycle(seconds) { const v = Number(seconds); if (v > 0) state.input.cycleSeconds = v; touch(); },
    setSeed(seed) { state.input.seed = Number.isFinite(Number(seed)) ? Number(seed) : String(seed); touch(); },
    setKnob(name, value) {
      if (!KNOBS.includes(name)) throw new Error(`lab: no knob ${name}`);
      state.knobs[name] = value === '' || value === undefined ? null : value;
      if (name === 'frameCentsEachSide') dropPlacement(state);   // MIDI targets: the frame decides what is in tune, so the clip is placed again
      touch();
    },
    setTable(table) { if (table !== 'full' && table !== 'lean') throw new Error(`lab: no table ${table}`); state.table = table; touch(); },
    loadPreset(i) { const p = PRESETS[i]; state.input.layers = [...p.layers]; state.input.cycleSeconds = p.cycleSeconds; state.progression = []; state.field = null; dropPlacement(state); touch(); },
    overrides,
    /** may a knob change re-compose by itself? lean only, and only while it is quick */
    canAutoRecompose: () => state.table === 'lean' && state.lastMs != null && state.lastMs < AUTO_RECOMPOSE_MS,

    /** opts { trace } (STEP 4a: no longer read; the trace is always asked for and kept in state.trace). One in flight
     *  per state: called again on a state that is composing, it returns that compose's promise. */
    compose({ trace = false } = {}) {
      const st = state;
      if (st.status === 'composing' && flights.has(st)) return flights.get(st);
      const mine = bump(st), t0 = clock();
      if (player?.playing) player.stop();
      st.status = 'composing'; st.error = null;
      // STEP 4d (decision 5): the chord edits go to Compose as pins, { ratio, quality }, written into the pin list now
      // (the edits themselves are cleared when the compose lands: until then they still play over the old spec)
      bakePins(st);
      const sent = st.progression.map(pinOf);
      const options = { seed: st.input.seed, overrides: overrides(), worker: st.table === 'full', progression: api.progressionInput() };
      // a typed chord chart (CHART_ORDER.md): its bars and changes (not with a MIDI target: the two together are not built)
      const shape = st.input.target ? null : shapeOfText(st.field?.text);
      if (shape) options.changes = shape;
      // MIDI targets (phase B): the clip, its tonic and a kept placement; the overrides the target sets left out; on
      // the lean table a row past mainThreadOnsets still searches in the worker (P7), its table kept lean
      const tg = st.input.target ?? null;
      if (tg) {
        options.target = { clip: tg.clip, ...(tg.tonic != null ? { tonic: tg.tonic } : {}), ...(tg.placement ? { placement: tg.placement } : {}) };
        for (const k of TARGET_SETS) delete options.overrides[k];
        if (!options.worker && onsetCount(st.input.layers) > mainThreadOnsets) { options.worker = true; options.overrides.table = st.table; }
      }
      // STEP 4a: always ask for the trace, at the alternates' caps (12 chords a bar, 8 runner-up lines a phrase), so the
      // alternates never depend on "show the work"; the show still obeys the setting (it reads state.trace only when on)
      options.trace = { caps: { ...ALTERNATE_CAPS } };
      const flight = (async () => {
        try {
          const answer = await runCompose(st.input.layers, st.input.cycleSeconds, options);
          if (mine !== runs.get(st)) return st.spec;   // a change to this state took over
          let spec = answer;
          if (answer && 'trace' in answer) { const { trace: tr, ...plain } = answer; spec = plain; st.trace = tr; } else st.trace = null;   // STEP 4a: kept whatever `trace` says
          st.spec = spec; st.composed = spec; st.lastMs = clock() - t0; st.dirty = false;
          landEdits(st, spec, sent);   // STEP 4d: the edits baked or dropped (decision 5), the undo stack cleared
          if (spec.refused) { st.parts = {}; st.drums = null; st.status = 'refused'; }
          else {
            st.parts = Object.fromEntries(spec.parts.map((p) => [p.id, p])); st.drums = arrangeDrums(spec, st.drumOptions);
            // B2: the entry's arps over the new spec (the fold: this thread, or the worker for a big row); the drums
            // re-arranged over them. An arp that can't be made leaves the parts in Line.
            if (arpsOn(st, spec).length) {
              try { const out = runFold(st); if (out && typeof out.then === 'function') await out; }
              catch { st.spec = spec; st.parts = Object.fromEntries(spec.parts.map((p) => [p.id, p])); st.drums = arrangeDrums(spec, st.drumOptions); }
            }
            st.status = 'ready'; st.tempoBpm = seedTempoOf(spec);
          }
          landPlacements(st, spec);   // MIDI targets: the search's list (kept when this compose was given its placement)
        } catch (err) {
          if (mine !== runs.get(st)) return st.spec;
          st.status = 'error'; st.error = String(err && err.message ? err.message : err);
        } finally {
          if (mine === runs.get(st)) flights.delete(st);
        }
        changed(st);
        return st.spec;
      })();
      flights.set(st, flight);
      changed(st);
      return flight;
    },
    /** what the main button says, and does */
    button() {
      if (state.status === 'composing') return 'Composing…';
      if (state.dirty || !state.spec || state.spec.refused || state.status === 'error') return 'Compose';
      return state.status === 'playing' ? 'Stop' : 'Perform';
    },
    async press() {
      const label = api.button();
      if (label === 'Compose') return api.compose();
      if (label === 'Perform') return api.perform();
      if (label === 'Stop') return api.stop();
      return null;
    },

    /** the parts as they play now, in the spec's order */
    currentParts: () => PART_IDS.map((id) => state.parts[id]).filter(Boolean),
    /** the spec with the parts as they play now: what JSON export downloads */
    currentSpec: () => (state.spec && !state.spec.refused ? { ...state.spec, parts: api.currentParts(), drums: state.drums } : state.spec),
    /** what JSON export downloads: the spec as it plays now (edits and all), plus how it is played (never written
     *  into the spec), and (STEP 4d) the edits that made it from Compose's spec, when there are any */
    exportObject: () => (state.spec && !state.spec.refused ? { ...api.currentSpec(), playback: { tempoBpm: api.tempo(), factor: api.tempoFactor() }, ...(api.editsExport() ? { edits: api.editsExport() } : {}) } : state.spec),
    exportJSON: () => JSON.stringify(api.exportObject(), null, 2),
    setPart(id, { sound, legato, enabled } = {}) {
      const part = state.parts[id];
      if (!part) return;
      state.parts[id] = rearticulate(part, { sound: sound ?? part.sound, legato: legato ?? part.legato, enabled: enabled ?? part.enabled, cycleSeconds: state.spec.knobs.cycleSeconds });
      changed();
    },
    /** the drums as they play now: { enabled, mode, fills, kit: { voice: choice }, layer, hitsPerBar } merged in, the
     *  drums re-arranged from the spec (cheap, this thread); live while playing, nothing re-composed */
    setDrums({ kit, ...rest } = {}) {
      const o = state.drumOptions;
      for (const [k, v] of Object.entries(rest)) { if (v === null) delete o[k]; else if (v !== undefined) o[k] = v; }
      if (kit) o.kit = { ...o.kit, ...kit };
      // STEP 4d: the step grid picked as a mode starts from the drums as they play now
      if (o.mode === 'grid' && !o.grid && state.drums) { o.grid = gridOf(state.drums); state.edits.grid ??= { bars: state.spec.knobs.bars, slotsPerBar: state.spec.knobs.slotsPerBar, from: 'backbeat' }; }
      if (state.spec && !state.spec.refused) state.drums = arrangeDrums(state.spec, o);
      changed();
    },
    setLevel(id, value) {   // no re-render: a slider is mid-drag (onLevel listeners keep other views in step)
      state.levels[id] = Number(value); player?.setLevel(id, state.levels[id]);
      for (const f of [...levelListeners]) f(id, state.levels[id]);
    },
    setGlide(ms) { state.glideMs = Math.max(0, Number(ms) || 0); player?.setGlide(state.glideMs / 1000); },   // portamento; no re-render
    /** the spec's own tempo (null without a spec) */
    specTempo: () => (state.spec && !state.spec.refused ? state.spec.knobs.tempoBpm : null),
    /** the tempo a compose seeds playback with, and Reset goes back to: a MIDI target's clip tempo (decided 1/4), else
     *  the spec's own (null without a spec) */
    seedTempo: () => (state.spec && !state.spec.refused ? seedTempoOf(state.spec) : null),
    /** the playback tempo, BPM (the seed until changed) */
    tempo: () => (api.specTempo() == null ? null : state.tempoBpm ?? api.seedTempo()),
    /** what the player scales spec time by: the spec's tempo / the playback tempo */
    tempoFactor: () => { const s = api.specTempo(), t = api.tempo(); return s && t ? s / t : 1; },
    /** a playback tempo, clamped to TEMPO_LIMITS; live while playing (within the lookahead); no re-render */
    setTempo(bpm) {
      const v = Number(bpm);
      if (!Number.isFinite(v) || v <= 0 || api.specTempo() == null) return;
      state.tempoBpm = Math.min(TEMPO_LIMITS[1], Math.max(TEMPO_LIMITS[0], v));
      player?.setTimeFactor(api.tempoFactor());
    },
    /** back to the seed tempo (the spec's own; a target's, the clip's) */
    resetTempo() { if (api.specTempo() == null) return; state.tempoBpm = api.seedTempo(); player?.setTimeFactor(api.tempoFactor()); },

    perform() {
      if (!state.spec || state.spec.refused) return;
      if (beforePerform) beforePerform();
      ctx ??= createContext();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      player ??= createPlayer({ ctx, timers, destination, midi });
      player.localSound(localSound);
      for (const id of [...PART_IDS, 'drums']) player.setLevel(id, state.levels[id]);
      player.setGlide(state.glideMs / 1000);
      player.setTimeFactor(api.tempoFactor());
      player.play(state.spec, api.currentParts, () => state.drums);
      state.status = 'playing'; changed();
    },
    stop() { player?.stop(); if (state.status === 'playing') state.status = 'ready'; changed(); },
    /** the MIDI sink (phase B), or null */
    get midi() { return midi; },
    /** M7: hear the Composer's own voices, or only the MIDI */
    setLocalSound(on) { localSound = !!on; player?.localSound(localSound); changed(); },
    localSound: () => localSound,
    playhead: () => player?.playhead() ?? null,

    // ── the progression editor (targeted progressions, progression.js) ──
    /** the roots a bar may ask for: the row's ±frame clusters, named from the root Compose would pick (memoized) */
    rootChoices() {
      const opts = { frameCentsEachSide: state.knobs.frameCentsEachSide ?? undefined, presence: state.knobs.presence ?? undefined };
      const key = JSON.stringify([state.input.layers, opts]);
      if (choicesKey !== key) {
        choicesKey = key;
        try { choices = rootCandidates(state.input.layers, opts); } catch (err) { choices = { refused: true, reason: String(err && err.message ? err.message : err), candidates: [] }; }
      }
      return choices;
    },
    /** how many bars the editor shows: a typed chart's, the bars knob, else what Compose's meter will choose (0 for a refused row) */
    progressionBars() {
      if (state.input.target?.clip) return state.input.target.clip.B;   // MIDI targets: the clip's bars
      const ch = chartOf(state);
      if (ch && !ch.error) return ch.bars;   // decided: a chart sets the bars
      if (state.knobs.bars != null) return state.knobs.bars;
      const rc = api.rootChoices();
      return rc.refused ? 0 : chooseMeter(rc.onsets, state.input.cycleSeconds, { slotsPerBar: state.knobs.slotsPerBar ?? null }).bars;
    },
    /** how many chords the editor shows: a typed chart's (a split bar has several), else one a bar */
    progressionUnits() {
      const ch = chartOf(state);
      return ch && !ch.error && !state.input.target?.clip && !isPlain(ch.changes) ? ch.spans.length : api.progressionBars();
    },
    /** the typed chart's shape, for the window (the Bars knob is set by it): { bars, changes, spans: [{ bar, share, shares }] }
     *  | { error } | null (no chart) */
    chartShape() {
      const ch = chartOf(state);
      if (!ch) return null;
      return ch.error ? { error: ch.error } : { bars: ch.bars, changes: ch.changes, spans: ch.spans.map((sp) => ({ bar: sp.bar, share: sp.share, shares: sp.shares })) };
    },
    /** the chord indices of bar k in the composition as it plays (a chart's split bar has several; else [k]) */
    unitsOfBar: (bar) => (state.spec && !state.spec.refused ? unitsOf(state.spec, bar) : [bar]),
    /** the editor's roots, one a chord (a bar, unless a chart splits it; null: auto), cut or padded to
     *  progressionUnits() (STEP 4d: a pin with a quality shows as its ratio here) */
    progression: () => Array.from({ length: api.progressionUnits() }, (_, k) => pinOf(state.progression[k])?.ratio ?? null),
    /** what Compose is sent: the pins, one a chord (a ratio, or { ratio, quality }: STEP 4d), or null when every one is auto */
    progressionInput: () => { const p = Array.from({ length: api.progressionUnits() }, (_, k) => state.progression[k] ?? null); return p.some((x) => pinOf(x) != null) ? p : null; },
    setProgressionRoot(bar, ratio) {
      if (!(Number.isInteger(bar) && bar >= 0)) throw new Error(`lab: no bar ${bar}`);
      const p = [...state.progression]; while (p.length <= bar) p.push(null);
      p[bar] = ratio === '' || ratio === 'auto' || ratio == null ? null : String(ratio);
      state.progression = p; touch();
    },
    clearProgression() { state.progression = []; state.field = null; touch(); },
    /** seed the editor with the roots the last compose chose → whether there was one to take */
    takeProgression() {
      if (!state.spec || state.spec.refused) return false;
      state.progression = state.spec.chords.map((c) => c.rootTone); touch();
      return true;
    },

    // ── STEP 4d: live edits (the entry's edits, applied over Compose's spec; DESIGN_NOTES "Step 4d") ──
    /** the composition as it plays, edits and all (state.spec) */
    effectiveSpec: () => state.spec,
    /** Compose's own spec, before any edit */
    composedSpec: () => state.composed,
    hasEdits: () => hasEdits(state),
    canUndo: () => state.undo.length > 0,
    canRedo: () => state.redo.length > 0,
    /** is an edit of this state (the bound one by default) running in the worker? */
    applying: (st = state) => !!folds.get(st)?.applying,
    /** an edit applied: f(result, state), result { ok, kind, changedBars, retunedBars, … } */
    onEdit(f) { editListeners.add(f); return () => editListeners.delete(f); },
    /** the bars whose fundamental differs from Compose's (a swap's modulation re-pitching later bars) */
    retunedBars: () => (ready(state) ? [...new Set(state.spec.chords.flatMap((c, k) => (Math.abs(c.fundamentalRatio - state.composed.chords[k].fundamentalRatio) > 1e-12 ? [c.bar] : [])))] : []),
    /** the edits as JSON export carries them (null with none); B2: `arps` when a part is in Arp */
    editsExport() {
      const e = state.edits, grid = state.drumOptions.grid && (state.drumOptions.mode === 'grid' || state.drumOptions.mode === 'prime');
      const arps = ARP_PARTS.some((id) => state.arps?.[id]?.mode === 'arp') ? JSON.parse(JSON.stringify(state.arps)) : null;
      if (!hasEdits(state) && !grid && !state.field && !arps) return null;
      return { chords: JSON.parse(JSON.stringify(e.chords)), lead: JSON.parse(JSON.stringify(e.lead)), order: [...e.order],
        drums: grid ? { mode: state.drumOptions.mode, grid: JSON.parse(JSON.stringify(state.drumOptions.grid)), from: e.grid?.from ?? null } : null, field: state.field ? state.field.text : null,
        ...(arps ? { arps } : {}) };
    },
    /**
     * A bar's alternates (a pure read of the kept trace): part 'chords' → the bar's 12 candidates; 'lead' → the bar's
     * phrase's kept line and its 8 runner-ups; each marked current. Other parts have none here (null).
     */
    alternatesOf(bar, part = 'chords') {
      if (!ready(state) || !state.trace) return null;
      if (part === 'chords') return chordAlternates(state, bar);
      if (part === 'lead') {
        if (state.spec.target) return null;   // P6: a target's lead is the clip
        if (state.spec.parts.find((x) => x.id === 'lead')?.arp) return null;   // B2 (Q5): an arp lead hides its runner-ups
        const p = phraseOfBar(state.spec, bar); return p < 0 ? null : leadAlternates(state, p);
      }
      return null;
    },
    /** swap bar k's chord (a chart's split bar: chord k's, unitsOfBar): a trace candidate ({ root: { ratio }, quality })
     *  or { rootTone, quality } (decision 1: the lead stays). A swap to Compose's own chord removes the bar's edit. */
    swapChord(bar, chord) {
      requireSpec(state);
      const N = state.composed.chords.length;
      if (!(Number.isInteger(bar) && bar >= 0 && bar < N)) throw new Error(`composer: no ${splitSpec(state.composed) ? 'chord' : 'bar'} ${bar}`);
      const rootTone = chord?.root?.ratio ?? chord?.rootTone, quality = chord?.quality?.id ?? chord?.quality;
      if (typeof rootTone !== 'string') throw new Error('composer: a chord swap needs a root (a candidate, or { rootTone })');
      if (!qualityById(quality)) throw new Error(`composer: no quality ${quality}`);
      return edit('chord', { bar }, (st) => {
        const cur = st.spec.chords[bar], own = st.composed.chords[bar];
        if (!cur.empty && cur.rootTone === rootTone && cur.quality === quality) return false;   // it plays already
        if (!own.empty && own.rootTone === rootTone && own.quality === quality && !followed(st, bar)) removeChordEdit(st.edits, bar);
        else setChordEdit(st.edits, bar, { rootTone, quality, from: 'swap' });
        syncField(st, [bar]);
        return true;
      });
    },
    /** swap phrase p's lead for another line the miner made for it (an id of the trace's lines; decision 2).
     *  { chordsFollow (false): the phrase's chords chosen again over it (its chord edits give way), smooth (false):
     *  the inner re-mined over the whole phrase, in the worker }. Its own line again removes the edit. */
    swapLead(phrase, lineId, { chordsFollow = false, smooth = false } = {}) {
      requireSpec(state);
      if (state.composed.target) throw new Error('composer: a MIDI target\'s lead is the clip: no lead swaps (P6)');
      const spans = phrasesOf({ bars: state.composed.knobs.bars, slotsPerBar: state.composed.knobs.slotsPerBar });
      if (!(Number.isInteger(phrase) && phrase >= 0 && phrase < spans.length)) throw new Error(`composer: no phrase ${phrase}`);
      if (!state.trace?.lines?.[lineId]) throw new Error(`composer: no line ${lineId} in the trace`);
      return edit('lead', { phrase }, (st) => {
        const kept = leadAlternatesOf(st.trace)[phrase]?.kept ?? null, want = { lineId, chordsFollow: !!chordsFollow, ...(smooth ? { smooth: true } : {}) };
        const had = st.edits.lead[phrase];
        if (lineId === kept) { if (!removeLeadEdit(st.edits, phrase)) return false; }
        else if (had && sameRecord(had, want)) return false;
        else setLeadEdit(st.edits, phrase, want);
        if (chordsFollow && lineId !== kept) {
          const span = spans[phrase], bars = [];
          for (let b = span.from; b < span.from + span.bars; b++) for (const k of unitsOf(st.composed, b)) if (removeChordEdit(st.edits, k)) bars.push(k);
          syncField(st, bars);
        }
        return true;
      });
    },
    /**
     * The typed progression field (chord-symbols.js): resolved per bar against the composition's bars (decisions 3
     * and 4). With a composition, each typed bar is a typed chord edit (live; the quality the bar supports, as Compose
     * would pick it over the root; the asked quality kept for the pin), an auto bar has none (and no pin). Before any
     * compose, the pins are Compose's progression (the entry goes dirty, as a root pick does). The text is kept as the
     * field's source either way. → Promise<{ ok, resolution, live, … }>
     */
    setProgressionField(text) {
      const st = state, value = String(text ?? ''), m = fieldMaterialsOf(st, value);
      if (!m || m.refused) { st.field = { text: value }; changed(); return Promise.resolve({ ok: false, error: m?.reason ?? 'no materials', resolution: null, live: false }); }
      // a chart of another shape than the composed spec's (CHART_ORDER P9): not live, it waits for Compose
      const reshape = ready(st) && !sameShape(shapeOfText(value), st.composed.knobs.changes);
      const N = m.units.length, resolution = resolveSymbols(value, m, { keep: reshape ? null : asksOf(st, N) });
      if (!ready(st) || reshape) {
        const pins = resolution.pins.map((x) => (x ? { ...x } : null));
        while (pins.length && pins[pins.length - 1] == null) pins.pop();
        st.progression = pins; st.field = { text: value };
        // the edits were the old shape's bars: dropped (proposed); the grid is kept or dropped by the Compose, as ever
        if (reshape && hasEdits(st)) { st.edits = { ...emptyEdits(), grid: st.edits.grid ?? null }; st.undo = []; st.redo = []; folds.delete(st); settleState(st, null); }
        touch();
        return Promise.resolve({ ok: true, resolution, live: false, ...(reshape ? { reshape: true } : {}) });
      }
      const S = st.composed.knobs.slotsPerBar, { row } = m, spans = m.spans;
      // a chord's lead notes: its bar's, or its span's (strong on the bar's strong beats or the span's first slot)
      const leadIn = (k) => (st.spec.parts.find((x) => x.id === 'lead')?.notes ?? []).filter((n) => (spans ? n.slot >= spans[k].from && n.slot < spans[k].from + spans[k].slots : n.bar === k))
        .map((n) => ({ cents: row.toneCents[row.tone[n.node]], strong: isStrongBeat(m.cells.slots[n.slot].beat, S) || (!!spans && n.slot === spans[k].from) }));
      return edit('field', {}, (s2) => {
        let any = value !== s2.field?.text;
        for (let k = 0; k < N; k++) {
          const pin = resolution.pins[k], had = s2.edits.chords[k];
          if (!pin) {
            if (removeChordEdit(s2.edits, k)) any = true;
            if (pinOf(s2.progression[k])) { s2.progression = s2.progression.map((x, j) => (j === k ? null : x)); any = true; }
            continue;
          }
          const tone = row.tones.indexOf(pin.ratio);
          const pick = chooseChordOnRoot(m.units[k], leadIn(k), { tone, cents: row.toneCents[tone], quality: pin.quality ?? null }, { eachSide: m.frameCentsEachSide, gridBase: m.baseCents, modulation: m.modulation });
          const rec = { rootTone: pin.ratio, quality: pick.quality.id, from: 'typed', asked: pin.quality ?? null };
          const prog = pinOf(s2.progression[k]), own = s2.composed.chords[k];
          // already pinned so, and composed over the pin: nothing to edit
          if (!had && prog && prog.ratio === pin.ratio && prog.quality === rec.asked && own.targeted && own.rootTone === pin.ratio) continue;
          if (had && sameRecord(had, rec)) continue;
          setChordEdit(s2.edits, k, rec); any = true;
        }
        s2.field = { text: value };
        return any;
      }).then((r) => ({ ...r, resolution, live: true }));
    },
    /** the field as it shows now: { text (the typed text, else the asks written in the Composer's names), typed,
     *  resolution (resolveSymbols': per bar cents, amber, the pin) } */
    progressionField() {
      const m = fieldMaterialsOf(state);
      if (!m || m.refused) return { text: state.field?.text ?? '', typed: !!state.field, resolution: null };
      const asks = asksOf(state, m.units.length), text = state.field ? state.field.text : pinsToField(asks, m);
      return { text, typed: !!state.field, resolution: resolveSymbols(text, m, { keep: asks }) };
    },
    /** the drum grid as it plays now (the entry's own, else the arrangement written as one: gridOf) */
    drumGrid() {
      if (!ready(state) || !state.drums) return null;
      const own = (state.drumOptions.mode === 'grid' || state.drumOptions.mode === 'prime') && !!state.drumOptions.grid;
      return { grid: gridNow(state), mode: state.drumOptions.mode, own, bars: state.spec.knobs.bars, places: gridWidth(state.spec), m: beatsOf(state.spec.knobs.slotsPerBar).m, silentCells: state.drums.silentCells ?? [] };
    },
    /** the whole grid ({ voice: [one string a bar] }, x X .): the mode turns to 'grid' (a prime mode stays prime: the
     *  grid's perc row is its selection) */
    setDrumGrid(grid) {
      requireSpec(state);
      const g = readGrid(grid), N = state.spec.knobs.bars, W = gridWidth(state.spec);
      for (const [v, rows] of Object.entries(g)) if (rows.length !== N || rows.some((r) => r.length !== W)) throw new Error(`composer: the grid's ${v} must be ${N} strings of ${W} places`);
      return drumEdit('drums', {}, (st) => {
        if (JSON.stringify(st.drumOptions.grid ?? null) === JSON.stringify(g) && (st.drumOptions.mode === 'grid' || st.drumOptions.mode === 'prime')) return false;
        noteGrid(st);
        st.drumOptions.grid = g;
        if (st.drumOptions.mode !== 'prime') st.drumOptions.mode = 'grid';
        return true;
      });
    },
    /** one cell: value 'x' | 'X' | '.' (or true / false); the grid starts from the drums as they play now */
    setDrumCell(bar, voice, place, value) {
      requireSpec(state);
      const N = state.spec.knobs.bars, W = gridWidth(state.spec), ch = value === true ? GRID_CHARS.stroke : value === false || value == null ? GRID_CHARS.off : String(value);
      if (!(Number.isInteger(bar) && bar >= 0 && bar < N)) throw new Error(`composer: no bar ${bar}`);
      if (!DRUM_VOICES.includes(voice)) throw new Error(`composer: no drum voice ${voice}`);
      if (!(Number.isInteger(place) && place >= 0 && place < W)) throw new Error(`composer: no place ${place} (a bar has ${W})`);
      if (!Object.values(GRID_CHARS).includes(ch)) throw new Error(`composer: a cell is x, X or . (not ${JSON.stringify(value)})`);
      return drumEdit('drums', { bar, voice, place }, (st) => {
        const g = gridNow(st), line = g[voice][bar];
        if (line[place] === ch && (st.drumOptions.mode === 'grid' || st.drumOptions.mode === 'prime') && st.drumOptions.grid) return false;
        g[voice][bar] = line.slice(0, place) + ch + line.slice(place + 1);
        noteGrid(st);
        st.drumOptions.grid = g;
        if (st.drumOptions.mode !== 'prime') st.drumOptions.mode = 'grid';
        return true;
      });
    },
    /** a preset (a layered mode, a pattern, or 'prime'): it plays as itself, and the grid shows it (gridOf) until a
     *  cell is edited */
    applyDrumPreset(mode) {
      requireSpec(state);
      if (!ALL_DRUM_MODES.includes(mode) || mode === 'grid') throw new Error(`composer: no drum preset ${mode}`);
      return drumEdit('drums', { mode }, (st) => {
        if (st.drumOptions.mode === mode && !st.drumOptions.grid) return false;
        st.drumOptions.mode = mode;
        delete st.drumOptions.grid;
        st.edits.grid = null;
        return true;
      });
    },
    // ── B2: the Arp mode (COMP_ARP_ORDER.md Q1–Q8) ──
    /** a part's Arp mode → { part, mode, time, picks, times (the times this composition can run: arp.js arpTimes),
     *  playing (it sounds as an arp now), refusal (why Arp is refused on this composition: arpRefusal's words; null),
     *  stats and phrases (arrangeArp's, while it plays: each phrase's ranked arps and the one picked, for phase E) } */
    arpOf(id) {
      if (!ARP_PARTS.includes(id)) throw new Error(`composer: only the lead and the inner voice have an Arp mode, not ${id}`);
      const a = (state.arps ??= lineArps())[id], s = state.spec && !state.spec.refused ? state.spec : null, part = s?.parts.find((p) => p.id === id);
      return { part: id, mode: a.mode, time: a.time ?? ARP_DEFAULTS.time, picks: { ...(a.picks ?? {}) }, times: s ? arpTimes(s) : [...ARP_TIMES], playing: !!part?.arp,
        refusal: s ? arpRefusal(s, id) : null, stats: part?.arp?.stats ?? null, phrases: part?.arp?.phrases ?? null };
    },
    /**
     * Line or Arp for the lead or the inner voice, and the Arp's knobs: { mode: 'line' | 'arp', time (1 | 2 | 3: × the
     * slots a bar), picks ({ [phrase index]: an arp's id }: replaces the part's picks whole) }, any of them. Live, no
     * re-compose; one undo step. Before any
     * Compose it is only kept (the Compose arranges it). A refused Arp (a MIDI target's lead) → { ok: false, error }.
     * → Promise<{ ok, kind: 'arp', part, changedBars, … }>
     */
    setArp(id, { mode, time, picks } = {}) {
      if (!ARP_PARTS.includes(id)) throw new Error(`composer: only the lead and the inner voice have an Arp mode, not ${id}`);
      const given = { mode, time: time == null || time === '' ? undefined : Number(time), picks: picks == null ? undefined : { ...picks } };
      if (given.mode !== undefined && given.mode !== 'line' && given.mode !== 'arp') throw new Error(`composer: a part's mode is 'line' or 'arp', not ${JSON.stringify(mode)}`);
      if (given.time !== undefined && !ARP_TIMES.includes(given.time)) throw new Error(`composer: an arp's time is 1, 2 or 3 (× the slots a bar), not ${JSON.stringify(time)}`);
      if (given.picks !== undefined && (typeof picks !== 'object' || Array.isArray(picks) || !Object.entries(given.picks).every(([p, v]) => /^\d+$/.test(p) && typeof v === 'string'))) throw new Error(`composer: an arp's picks are { [phrase index]: an arp's id }, not ${JSON.stringify(picks)}`);
      const st = state;
      st.arps ??= lineArps();
      const next = { ...st.arps[id], ...Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) };
      const why = next.mode === 'arp' && st.spec && !st.spec.refused ? arpRefusal(st.spec, id) : null;
      if (why) return Promise.resolve({ ok: false, error: why, refused: true, kind: 'arp', part: id });
      const same = (s) => JSON.stringify(s.arps[id]) === JSON.stringify(next);
      if (!ready(st)) {
        if (same(st)) return Promise.resolve({ ok: true, noop: true, kind: 'arp', part: id });
        st.arps = { ...st.arps, [id]: next }; changed();
        return Promise.resolve({ ok: true, live: false, kind: 'arp', part: id });
      }
      return edit('arp', { part: id }, (s) => { if (same(s)) return false; s.arps = { ...s.arps, [id]: next }; return true; });
    },
    /** back one edit (chords, lead, the field, the drum grid, an Arp mode) → Promise<{ ok, … }> */
    undo() {
      const st = state;
      if (!ready(st) || !st.undo.length) return Promise.resolve({ ok: false, empty: true, kind: 'undo' });
      const snap = st.undo.pop();
      st.redo.push(snapshotOf(st));
      restoreSnapshot(st, snap);
      return applyEdits(st, { kind: 'undo' });
    },
    redo() {
      const st = state;
      if (!ready(st) || !st.redo.length) return Promise.resolve({ ok: false, empty: true, kind: 'redo' });
      const snap = st.redo.pop();
      st.undo.push(snapshotOf(st));
      restoreSnapshot(st, snap);
      return applyEdits(st, { kind: 'redo' });
    },

    // ── STEP 4e: the audition (DESIGN_NOTES "Step 4e") — an edit tried live, then kept as one undo step or taken back
    // leaving no trace: the undo and redo stacks come back exactly as they were before the first audition ──
    /** try an edit: run () → one of the actions above (its Promise). Auditions in a row (a second alternate tried
     *  before keeping) are one audition: keeping it is one undo step, reverting it goes back to before the first. */
    audition(run) {
      const st = state;
      requireSpec(st);
      let mark = auditions.get(st);
      if (!mark || mark.composed !== st.composed) {
        mark = { composed: st.composed, base: snapshotOf(st), undo: st.undo.slice(), redo: st.redo.slice(), last: null };
        auditions.set(st, mark);
      }
      let p;
      try { p = Promise.resolve(run()); } catch (err) { p = Promise.reject(err); }   // run now: a worker edit is in flight (applying()) as this returns
      mark.last = p.catch(() => null);
      return p;
    },
    /** is an audition open on the bound entry (and not overtaken by a Compose)? */
    auditioning: () => { const m = auditions.get(state); return !!m && m.composed === state.composed; },
    /** keep the audition: it stays, as ONE undo step back to before it → Promise<{ ok }> */
    keepAudition() {
      const st = state, mark = auditions.get(st);
      auditions.delete(st);
      if (!mark) return Promise.resolve({ ok: false, empty: true, kind: 'keep' });
      return mark.last.then(() => {
        if (st.composed !== mark.composed) return { ok: false, stale: true, kind: 'keep' };
        const now = snapshotOf(st), same = JSON.stringify(now) === JSON.stringify(mark.base);
        st.undo = same ? mark.undo : [...mark.undo, mark.base];
        while (st.undo.length > UNDO_LIMIT) st.undo.shift();
        st.redo = same ? mark.redo : [];
        changed(st);
        return { ok: true, kind: 'keep', noop: same };
      });
    },
    /** take the audition back: the edits as they were before it, and the undo and redo stacks too (no redo step is
     *  left) → Promise<{ ok, … }> */
    revertAudition() {
      const st = state, mark = auditions.get(st);
      auditions.delete(st);
      if (!mark) return Promise.resolve({ ok: false, empty: true, kind: 'revert' });
      return mark.last.then(() => {
        if (st.composed !== mark.composed) return { ok: false, stale: true, kind: 'revert' };
        restoreSnapshot(st, mark.base);
        st.undo = mark.undo; st.redo = mark.redo;
        return applyEdits(st, { kind: 'revert' });
      });
    },
    // ── MIDI targets (phase B; DESIGN_NOTES "MIDI targets (phase B)") ──
    /**
     * A clip as the composition's lead: source a .mid file's bytes (or a decoded clip), or null to clear it (nothing
     * composed: the entry goes dirty, and the next Compose is an ordinary one; Avery, 2026-10-26). opts { tonic (a pitch class; null: the clip's key estimate), name (the file's name) }.
     * A file that won't decode leaves the entry as it was → Promise<{ ok, clip?, spec?, error?, cleared? }>
     */
    setTarget(source, { tonic = null, name = null } = {}) {
      const st = state;
      if (tonic != null && !(Number.isInteger(tonic) && tonic >= 0 && tonic < 12)) throw new Error(`composer: a tonic is a pitch class 0..11, not ${JSON.stringify(tonic)}`);
      if (source == null) {
        if (!st.input.target) return Promise.resolve({ ok: true, noop: true, cleared: true });
        // Clear does not compose (Avery, 2026-10-26): the entry goes dirty, as any input change, and Compose waits
        delete st.input.target; st.placements = null;
        freshTarget(st); touch();
        return Promise.resolve({ ok: true, cleared: true });
      }
      let clip;
      try { clip = readClip(source, { name }); } catch (err) { return Promise.resolve({ ok: false, error: String(err && err.message ? err.message : err) }); }
      st.input.target = { clip, tonic }; st.placements = null;
      freshTarget(st);
      // B2 (Q5): a target's lead is the clip, so its Arp goes back to Line (proposed; arpRefusal refuses it anyway)
      if (st.arps?.lead?.mode === 'arp') st.arps = { ...st.arps, lead: { ...st.arps.lead, mode: 'line' } };
      touch();
      return api.compose().then((spec) => outcome(st, spec, { clip }));
    },
    /** the clip on the bound entry (as decoded), or null */
    target: () => state.input.target ?? null,
    /** the tonic override (P5): a pitch class, or null for the clip's key estimate; the clip is placed again */
    setTargetTonic(tonic) {
      const st = state, t = st.input.target;
      if (!t) throw new Error('composer: no MIDI target to set a tonic for');
      const pc = tonic === '' || tonic == null ? null : Number(tonic);
      if (pc != null && !(Number.isInteger(pc) && pc >= 0 && pc < 12)) throw new Error(`composer: a tonic is a pitch class 0..11, not ${JSON.stringify(tonic)}`);
      if (pc === (t.tonic ?? null) && !t.placement && st.spec?.target) return Promise.resolve({ ok: true, noop: true, spec: st.spec });
      st.input.target = { clip: t.clip, tonic: pc }; st.placements = null;
      touch();
      return api.compose().then((spec) => outcome(st, spec, { tonic: pc }));
    },
    /** audition the search's placement i (state.placements.list: 0 the best, then the alternates): composed with it
     *  given, played again from the top when it was playing. Auditions in a row are one: revert goes back to before
     *  the first → Promise<{ ok, index, spec }> */
    auditionPlacement(index) {
      const st = state, list = st.placements?.list;
      if (!st.input.target || !list) throw new Error('composer: no placements to audition (set a MIDI target first)');
      if (!(Number.isInteger(index) && index >= 0 && index < list.length)) throw new Error(`composer: no placement ${index}`);
      let mark = placementMarks.get(st);
      if (index === st.placements.current && st.status !== 'composing') return Promise.resolve({ ok: true, noop: true, index, spec: st.spec });
      // playing: it plays on (a compose in flight for an earlier audition counts as playing when that one was)
      const live = st.status === 'playing' || (st.status === 'composing' && !!mark?.playing);
      if (!mark) { mark = { snap: entrySnap(st), index: st.placements.current, playing: live }; placementMarks.set(st, mark); }
      mark.playing = live;
      dropFlight(st);
      st.input.target = { ...st.input.target, placement: list[index] };
      st.placements = { ...st.placements, current: index };
      mark.index = index;
      return api.compose().then((spec) => {
        if (placementMarks.get(st) !== mark || mark.index !== index) return { ok: true, superseded: true, index };
        if (spec && !spec.refused && mark.playing && st === state && st.status === 'ready') api.perform();
        return outcome(st, spec, { index });
      });
    },
    /** the placement audition open on the bound entry: { index (auditioned), from (the one before it) } | null */
    placementAudition() { const m = placementMarks.get(state); return m ? { index: m.index, from: m.snap.placements?.current ?? 0 } : null; },
    /** keep the auditioned placement: it is the entry's from now on (the best is kept as no placement: the search's
     *  own) → Promise<{ ok, index }> */
    keepPlacement() {
      const st = state, mark = placementMarks.get(st);
      if (!mark) return Promise.resolve({ ok: false, empty: true });
      placementMarks.delete(st);
      const flight = flights.get(st) ?? Promise.resolve(st.spec);
      return flight.then(() => {
        if (mark.index === 0 && st.input.target?.placement) { const { placement, ...rest } = st.input.target; st.input.target = rest; }
        changed(st);
        return { ok: true, index: mark.index };
      });
    },
    /** take the audition back: the entry exactly as before the first one (no re-compose), playing again if it was */
    revertPlacement() {
      const st = state, mark = placementMarks.get(st);
      if (!mark) return Promise.resolve({ ok: false, empty: true });
      placementMarks.delete(st);
      const live = st.status === 'playing' || (st.status === 'composing' && mark.playing);
      dropFlight(st);
      if (player?.playing && st === state) player.stop();
      const x = mark.snap;
      if (x.target) st.input.target = x.target; else delete st.input.target;
      Object.assign(st, { placements: x.placements, spec: x.spec, composed: x.composed, trace: x.trace, parts: x.parts, drums: x.drums, drumOptions: x.drumOptions, edits: x.edits,
        undo: x.undo, redo: x.redo, dropped: x.dropped, progression: x.progression, field: x.field, tempoBpm: x.tempoBpm, lastMs: x.lastMs, dirty: x.dirty, error: x.error, status: x.status, arps: x.arps });
      folds.delete(st); auditions.delete(st);
      if (live && st.spec && !st.spec.refused) api.perform(); else changed(st);
      return Promise.resolve({ ok: true, index: x.placements?.current ?? 0 });
    },
    get player() { return player; },
    get context() { return ctx; },
  };
  return api;
}
/** the lab's name for it (kept for the lab and its tests) */
export const createLabController = createComposerController;
