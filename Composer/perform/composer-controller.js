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
//              Phase E (COMP_ARP_ORDER.md Amendment 1): pickArp(part, phrase, id) plays one of a phrase's ranked arps (its
//              first again removes the pick), one undo step through setArp, and auditionable as the runner-ups are; a
//              change of Time drops the part's picks (they are keyed by the phrase at a time; one undo step restores
//              both); a re-compose keeps the picks its phrases still offer and says the rest (`state.dropped.arps`).
//   clave      (COMP_ARP_ORDER.md Amendment 1, phase E; DESIGN_NOTES "The clave and arp pickers") the comp's clave and
//              Sync | Fill, live (rearrange.js `reclave`: no re-compose):
//                setClave({ id ('steps:pattern' | 'son' | 'rumba' | 'bossa' | null: Compose's), relation ('sync' | 'fill') })
//                claveOf() → { id, text, source, relation, partner, alternates (the trace's: the mined top 12, then
//                            the curated; each current / composed), composedId, edit, … } | null (no clave: notes)
//              Phase L (BASS_VOICING_ORDER.md Amendment 1): a clave read from the frame (phase I, the default) is set and
//              read by its id ('frame:A/8/chord'); claveOf adds each bar's pattern (`barTexts`: a frame clave's changes
//              with the chord), the partner's, and on each alternate `frame` (a frame candidate) and `inFrame` (a
//              curated clave, landed in frame only). A chord swap that re-reads a bar's clave says so in its result
//              (`reclavedBars`, also among the `changedBars`: the comp and the perc moved there).
//              The choice is an edit (`state.edits.clave`, only what differs from Compose's): one undo step, in the
//              snapshots, applied LAST in the fold (every bar re-strummed over its chord as edited), auditionable. A
//              re-compose keeps it where the new composition still offers the clave (its trace's alternates), else
//              drops it and says so (`state.dropped.clave`); Sync | Fill is always kept.
//   bass       (BASS_VOICING_ORDER.md phase H; DESIGN_NOTES "The window: bass and voicing (phase H)") the bass's density,
//              lock and picks, live (core/bass.js arrangeBass over the spec as it plays: no re-compose):
//                setBass({ density ('roots' | 'sparse' | 'moving' | 'walking'), lock ('free' | 'kick' | 'clave'), picks
//                        ({ [bar]: a line's id }: replaces the picks whole) })   one undo step
//                bassOf() → { density, lock, picks, densities, locks: [{ id, refusal }], playing, ran, refused, stats,
//                           bars (each bar's runner-ups, `alternates`), pending }
//                pickBass(bar, id)   one of a bar's runner-ups (its first again removes the pick), through setBass;
//                                    Roots too (Amendment 1, rule 9: the root's other in-frame notes, phase L)
//                ratioOfOnset(node)  an onset's tone in the row (null: the row is the worker's); phase N: a Roots
//                                    runner-up's notes carry their tone and cents off the root themselves (bass.js, P29)
//              The choice is the entry's (`state.bass`, store/composition-store.js), as the arps are: in the snapshots,
//              kept through a re-compose and the glyph's recall. Compose's own bass (phase N: Moving, Kick, no picks)
//              arranges nothing over the kick it covers (its part is arrangeBass's at those options byte for byte, its
//              record the offer bassOf reads; Amendment 2 below for a kick it didn't cover). Anything else is arranged AFTER the arps and the drums, over the spec as it plays (the
//              Kick lock hears the drums as they play now: `state.drums`; the Clave lock, the comp's clave as edited): so
//              a chord swap, a clave switch, an undo or a re-compose re-arranges it from the fresh spec, and a drum change
//              under the Kick lock does too. A change of density or lock drops the picks (one undo step restores both);
//              a lock refused now (bassLockRefusal: the drums off, a comp in notes) is refused; a lock refused later (the
//              drums turned off under Kick) plays Free and says why (`bassOf().refused`). A re-compose keeps the picks its
//              bars still offer and says the rest (`state.dropped.bass`); a chord swap's stale pick plays the bar's first
//              line, marked `missed`, until an undo or a re-compose. A big row's bass (past MAIN_THREAD_ONSETS) is arranged
//              in the module worker (runCompose.bass), from its kept materials: arrangeBass is ≤ 25 ms on the 16k row.
//   voicing    (phase H) the chords' Close | Led, live: setVoicing('close' | 'led'), one undo step; voicingOf() → { voicing,
//              playing, stats }. The fold's FIRST step is rearrange.js `revoice` when the entry's voicing differs from the
//              composed spec's, so the edits after it voice as Compose would; byte for byte a Compose given
//              `overrides.voicing` (assert-page-bass.mjs). Compose is sent `voicing: 'close'` while it is close, so the
//              composed spec needs no switch. Kept through a re-compose and the recall, like the bass.
//   Amendment 2 (BASS_VOICING_ORDER.md phase N; DESIGN_NOTES "The window over Amendment 2 (phase N)"):
//              Compose's own bass is Moving · Kick (rule 11, P28: composedBass), its part carrying its `bass` record, so
//              bassOf reads it as composed and a stored Sparse · Free is an arrangement like any other. It covers the
//              kick Compose's drums strike; when the drums as they play strike another kick (another mode, or off), it is
//              arranged again over them (the planner's ruling: the bass covers the kick that PLAYS; the drums off, Moving ·
//              Free, said as an asked Kick's refusal is). The fold's base keeps Compose's drums, so a chord swap re-mines
//              its bar at Moving · Kick (rearrange's arranged-bass path), as Compose's own swap would.
//   density    (phase N, rule 10, P27) the comp's density tier, live: setCompDensity('sparse-med' | 'sparse' | 'medium' |
//              'dense'), one undo step (a clave picked from the list goes with it: the new tier's best plays, Sync | Fill
//              kept). The fold's step after the voicing's is rearrange.js `reclave` with `{ density }` when the entry's
//              differs from the composed spec's tier, so the edits after it re-read and re-rank in it. Compose is sent
//              `compDensity` when it isn't the default, so a re-compose keeps it. claveOf().density says the tier asked,
//              the one that played and a fall-back.
//   picker     (phase N, rule 14, P30) claveOf().alternates are the frame candidates re-ranked over the chords as they
//              play: the last fold step's `claveAlternates` (a chord swap, a typed chord, a Chords Follow, a density or a
//              clave chosen again), else the trace's (`reranked` says which).

import { compose, rearticulate, chooseMeter, PART_IDS, TARGET_SETS, VOICINGS } from '../core/compose.js';
import { arrangeBass, bassLockRefusal, BASS_DENSITIES, BASS_LOCKS } from '../core/bass.js';   // phase H: the bass's densities and lock
import { arrangeArp, arpRefusal, arpTimes, ARP_PARTS, ARP_TIMES, ARP_DEFAULTS } from '../core/arp.js';   // B2: the Arp mode (phase D: mined)
import { rootCandidates, chooseChordOnRoot, qualityById } from '../core/progression.js';
import { NOTE_INSTRUMENT_IDS, getInstrument } from '../../Audio/voices/recipes.js';
import { createPlayer } from './composer-player.js';
import { arrangeDrums, gridOf, readGrid, beatsOf, ALL_DRUM_MODES, DRUM_VOICES, DEFAULT_KIT, GRID_CHARS } from '../core/drums.js';
import { DRUM_PATTERNS } from '../core/drum-patterns.js';
import { MADE_DRUM_CHOICES } from '../../Audio/drums/index.js';
import { newCompositionState, KNOB_NAMES, emptyEdits, UNDO_LIMIT, lineArps, composedBass, isComposedBass } from '../store/composition-store.js';
import { ALTERNATE_CAPS } from '../core/trace.js';   // STEP 4a
// STEP 4d: the edits
import { rearrange, applyRearrange, materialsOf, materialsKey } from '../core/rearrange.js';
import { barMaterials, resolveSymbols, pinsToField } from '../core/chord-symbols.js';
import { isChart, readChart, isPlain } from '../core/chart.js';
import { phrasesOf, isStrongBeat } from '../core/harmony.js';
// MIDI targets (phase B)
import { readMidi, decodeClip } from '../core/midi.js';
import { onsetCount } from '../core/row.js';
import { claveOf as readClave, claveText, claveSource, COMP_RELATIONS, COMP_DENSITIES, DEFAULT_COMP_DENSITY } from '../core/claves.js';   // phase E: the clave picker; phase N: the comp's density
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
/** phase H: the bass's densities and locks, and the chords' voicings, for a view */
export const BASS_CHOICES = Object.freeze({ densities: BASS_DENSITIES, locks: BASS_LOCKS, voicings: VOICINGS });
/** phase N: the comp's density tiers, for a view (claves.js COMP_DENSITIES; sparse–medium the default) */
export const COMP_DENSITY_CHOICES = COMP_DENSITIES;
/** every sound a part can play: the note-role instruments of Audio/voices, in the catalog's order */
export const soundChoices = () => NOTE_INSTRUMENT_IDS.map((id) => ({ id, label: getInstrument(id).label }));

// ── drums ──
/** phase L: a clave's pattern in each of N bars as the window shows it: a frame clave's own (claveText(clave, k): it
 *  changes with the chord), a fixed one's group of its pass (son's two bars alternate), else the one pattern */
function barTextsOf(clave, N) {
  if (!clave) return [];
  return Array.from({ length: N }, (_, k) => {
    if (Array.isArray(clave.patterns)) return claveText(clave, k);
    const p = clave.pattern ?? '', B = clave.span ?? 1;
    if (B <= 1 || p.length % B) return p;
    const w = p.length / B, g = k % B;
    return p.slice(g * w, (g + 1) * w);
  });
}
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
 *   runBass       ({ key, spec, options }) → Promise<the arranged bass part>: a big row's bass in the worker (phase H;
 *                 runCompose.bass by default; none: every bass on this thread)
 */
export function createComposerController({ runCompose = async (l, T, o) => compose(l, T, o), createContext = () => new AudioContext(), timers = globalThis, clock = () => (globalThis.performance ? performance.now() : Date.now()), beforePerform = null, destination = null, state: initial = null,
  runRearrange = runCompose?.rearrange ?? null, mainThreadOnsets = MAIN_THREAD_ONSETS, leadFullOnsets = MAIN_THREAD_LEAD_FULL_ONSETS, midi = null, runArp = runCompose?.arp ?? null, runBass = runCompose?.bass ?? null } = {}) {
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
  // ── phase H: the bass (core/bass.js arrangeBass over the spec as it plays) and the chords' voicing ──
  /** does this entry's bass arrange (anything but Compose's own: Moving, Kick, no picks; phase N)? */
  const bassOn = (st) => !isComposedBass(st.bass);
  // phase N (Amendment 2, P28): Compose's own bass covers the kick Compose's drums strike. The window plays its own drums
  // (st.drumOptions: another mode, or off), and the bass covers the kick that PLAYS (the planner's ruling), so where the
  // drums as they play strike another kick, Compose's own is arranged again over them (its options, Moving · Kick; the
  // drums off or no kick: arrangeBass's Moving · Free, its `refused` the reason)
  /** a drum arrangement's kick, as the Kick lock hears it (its hits' ticks and slots), or 'off' */
  const kickOf = (drums) => (!drums || !drums.enabled ? 'off' : JSON.stringify(drums.hits.filter((h) => h.voice === 'kick').map((h) => [h.tick, h.slot])));
  /** does Compose's own bass cover the kick (its record's lock)? */
  const ownCoversKick = (st) => st.composed?.parts?.find((p) => p.id === 'bass')?.bass?.lock === 'kick';
  /** do the drums as they play strike another kick than the one Compose's own bass covers? */
  const kickMoved = (st, drums) => ownCoversKick(st) && kickOf(drums) !== kickOf(st.composed.drums);
  /** is the bass arranged over this spec: the entry's own choice, or Compose's own over a kick it didn't cover */
  const bassArranges = (st, drums) => bassOn(st) || (!!st.composed && kickMoved(st, drums));
  /** the entry's bass as arrangeBass takes it */
  const bassOptions = (st) => ({ density: st.bass.density, lock: st.bass.lock, picks: { ...(st.bass.picks ?? {}) } });
  /** the spec the bass locks against: the drums as they play (the Kick lock hears them; the Clave lock reads spec.clave) */
  const lockSpecOf = (spec, drums) => ({ ...spec, drums });
  /** an arranged bass part into a spec */
  const placeBass = (spec, part) => ({ ...spec, parts: spec.parts.map((p) => (p.id === 'bass' ? part : p)) });
  /** a spec (its arps placed) with the entry's bass, arranged on this thread over the drums as they play */
  const withBass = (st, spec, drums) => (bassArranges(st, drums) ? placeBass(spec, arrangeBass(lockSpecOf(spec, drums), materialsFor(st), bassOptions(st))) : spec);
  /** a big row's bass goes to the worker, as its arps do */
  const bassOnWorker = (st) => !!runBass && st.composed.stats.onsets > mainThreadOnsets;
  /** the voicing a spec plays: led when the voicing pass ran (its stats say so), else close */
  const voicedAs = (spec) => (spec?.stats?.voicing ? 'led' : 'close');
  /** the fold's first step: the entry's voicing when the composed spec plays the other one (rearrange.js revoice), or null */
  const voicingStep = (st) => ((st.voicing ?? 'led') !== voicedAs(st.composed) ? { kind: 'voicing', voicing: st.voicing ?? 'led' } : null);
  // ── phase N (Amendment 2, rule 10, P27): the comp's density tier ──
  /** the tier a spec's clave was chosen in (a frame clave's compDensity.asked), or null (a clave from the pattern, none) */
  const tierOf = (spec) => (spec?.clave?.read === 'frame' && spec.clave.compDensity ? spec.clave.compDensity.asked : null);
  /** the fold's step after the voicing's: the entry's density when the composed spec's clave was chosen in another tier
   *  (rearrange.js reclave `{ density }`), or null */
  const densityStep = (st) => { const t = tierOf(st.composed), d = st.compDensity ?? DEFAULT_COMP_DENSITY; return t && d !== t ? { kind: 'density', density: d } : null; };
  /** phase N (rule 14, P30): the frame candidates as the edits leave them, the last fold step's that re-ranked them
   *  (rearrange's `claveAlternates`: a chord change, a density or a clave chosen again), or null (the trace's) */
  function rerankedOf(st) {
    const f = folds.get(st);
    if (!f || f.composed !== st.composed) return null;
    for (let i = f.steps.length - 1; i >= 0; i--) if (f.steps[i].alts) return f.steps[i].alts;
    return null;
  }
  // per spec: the bass's offer while a bass with no record plays (arrangeBass at Compose's own: its bars' runner-ups), for
  // bassOf; null while a big row's is on its way from the worker. Phase N: Compose's own bass carries its record, so this
  // is only a spec composed with the bass pinned to the one before (`bass: { density: 'sparse', lock: 'free' }`)
  const offers = new WeakMap();
  function offerOf(st) {
    const spec = st.spec;
    if (offers.has(spec)) return offers.get(spec);
    const over = lockSpecOf(spec, st.drums);
    if (bassOnWorker(st)) {
      offers.set(spec, null);
      Promise.resolve(runBass({ key: materialsKey(spec), spec: over, options: composedBass() })).then((p) => { offers.set(spec, p); if (st.spec === spec) changed(st); }, () => offers.delete(spec));
      return null;
    }
    const p = arrangeBass(over, materialsFor(st), composedBass());
    offers.set(spec, p);
    return p;
  }
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
    if (e.kind === 'clave' || e.kind === 'voicing' || e.kind === 'density') return n > mainThreadOnsets;
    return n > mainThreadOnsets || (e.kind === 'lead' && st.composed.knobs.table === 'full' && n > leadFullOnsets);
  }
  /** an edit record → rearrange's edit and options */
  function jobOf(st, e) {
    // phase E: the clave choice, rearrange's `reclave` door ({ clave, relation }: only what differs from Compose's)
    if (e.kind === 'clave') return { edit: { ...(e.id != null ? { clave: e.id } : {}), relation: e.relation ?? st.composed.clave?.relation ?? 'sync' }, opts: {} };
    // phase H: the chords' voicing, rearrange's `revoice` door
    if (e.kind === 'voicing') return { edit: { voicing: e.voicing }, opts: {} };
    // phase N: the comp's density, rearrange's `reclave` door ({ density })
    if (e.kind === 'density') return { edit: { density: e.density }, opts: {} };
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
   * the drums arranged over it, then (phase H) the bass over that (`bassed`, the part the worker arranged; undefined,
   * arranged here, or Compose's own), the parts re-articulated as they play now. A part's sound carries over only where it
   * was chosen (it differs from the spec's own part's), so an inner switched to Arp takes the harp and back to Line its
   * own (Q4); legato and on/off always carry.
   */
  function settleState(st, eff, arped = undefined, bassed = undefined) {
    const line = eff ? { ...eff, drums: st.composed.drums } : st.composed, T = st.composed.knobs.cycleSeconds;
    const arpedSpec = arped === undefined ? withArps(st, line) : arped ? placeArps(line, arped) : line;
    // the drums read no bass, so they are arranged before it: the Kick lock lands on them as they play
    const drums = arrangeDrums(arpedSpec, st.drumOptions);
    const next = bassed === undefined ? withBass(st, arpedSpec, drums) : bassed ? placeBass(arpedSpec, bassed) : arpedSpec;
    const own = Object.fromEntries((st.spec?.parts ?? []).map((p) => [p.id, p.sound]));
    const art = Object.fromEntries(Object.values(st.parts).map((p) => [p.id, { sound: p.sound !== own[p.id] ? p.sound : null, legato: p.legato, enabled: p.enabled }]));
    st.spec = next;
    st.parts = Object.fromEntries(next.parts.map((p) => {
      const a = art[p.id];
      return [p.id, a && ((a.sound != null && a.sound !== p.sound) || a.legato !== p.legato || a.enabled !== p.enabled) ? rearticulate(p, { sound: a.sound ?? p.sound, legato: a.legato, enabled: a.enabled, cycleSeconds: T }) : p];
    }));
    st.drums = drums;
  }
  /**
   * composed + edits, in order, from the fold's cache: the steps whose edits are unchanged are kept, the rest run
   * (this thread, or the worker). → the summary, or a Promise of it (a step went to the worker), or STALE (a newer
   * fold took over). Throws (or rejects) when a step can't be made.
   */
  function runFold(st) {
    let f = folds.get(st);
    // phase N: the base keeps Compose's drums, so a chord swap re-mines Compose's own bass (Moving · Kick) over the kick it
    // covers, as Compose's own swap would (with none, the lock would fall back to Free in that bar)
    if (!f || f.composed !== st.composed) { f = { composed: st.composed, base: { ...st.composed }, steps: [], gen: 0, applying: false }; folds.set(st, f); }
    // phase H: the voicing switch first (rearrange.js revoice), so the edits after it voice as Compose would; phase N: then
    // the comp's density (reclave), so the chord edits after it re-read and re-rank the clave in its tier
    const v = voicingStep(st), d = densityStep(st), mine = ++f.gen, list = [...(v ? [v] : []), ...(d ? [d] : []), ...orderedEdits(st.edits)], sigs = list.map((e) => JSON.stringify(e)), was = st.spec;
    let i = 0, spec = f.base;
    while (i < list.length && f.steps[i] && f.steps[i].sig === sigs[i]) { spec = f.steps[i].spec; i++; }
    f.steps.length = i;
    // phase L: the bars a step run now re-read the clave in (a chord swap, phase I P20): the comp and the perc moved there
    const reclaved = new Set();
    // phase N (P30): a step that re-ranked the frame candidates keeps them (`alts`), for the picker
    const commit = (r) => { for (const k of r.reclavedBars ?? []) reclaved.add(k); spec = applyRearrange(spec, r); f.steps.push({ sig: sigs[i], spec, alts: r.claveAlternates ?? null }); i++; };
    // stale: a newer fold of this state took over, or a Compose landed (a new fold record) while a worker step ran; a
    // stale answer, or a stale failure, never touches the state
    const stale = () => mine !== f.gen || folds.get(st) !== f || st.composed !== f.composed;
    const finish = (arped, bassed) => {
      f.applying = false; settleState(st, list.length ? spec : null, arped, bassed);
      const moved = movedBars(was, st.spec), re = [...reclaved].sort((a, b) => a - b);
      if (re.length) moved.changedBars = [...new Set([...moved.changedBars, ...re])].sort((a, b) => a - b);
      return { ok: true, ...moved, ...(re.length ? { reclavedBars: re } : {}), edits: list.length };
    };
    // phase H: a big row's bass in the worker, over the spec with its arps and the drums as they play
    const bassStep = (arped) => {
      if (!bassOnWorker(st) || (!bassOn(st) && !ownCoversKick(st))) return finish(arped);
      const line = list.length ? { ...spec, drums: st.composed.drums } : st.composed, arpedSpec = arped === undefined ? withArps(st, line) : arped ? placeArps(line, arped) : line;
      const drums = arrangeDrums(arpedSpec, st.drumOptions);
      if (!bassArranges(st, drums)) return finish(arped);   // phase N: Compose's own, over the kick it covers
      f.applying = true;
      return Promise.resolve(runBass({ key: materialsKey(arpedSpec), spec: lockSpecOf(arpedSpec, drums), options: bassOptions(st) })).then((part) => (stale() ? STALE : finish(arped, part)),
        (err) => { if (stale()) return STALE; f.applying = false; throw err; });
    };
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
        return Promise.resolve(runArp({ key: materialsKey(line), spec: line, parts: jobs })).then((parts) => (stale() ? STALE : bassStep(parts)),
          (err) => { if (stale()) return STALE; f.applying = false; throw err; });
      }
      return bassStep(undefined);
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
    const again = rebass(st);   // phase H: a bass locked to the kick follows the drums
    return again ? again.then(() => result) : Promise.resolve(result);
  }
  /** phase H: the drums moved under a bass locked to the kick → the bass arranged again (the fold, its edits kept), or null;
   *  phase N: Compose's own bass covers the kick too, so it follows the drums as they play (settleState arranges it again
   *  where their kick isn't the one it covers, and plays Compose's again where it is) */
  function rebass(st) {
    if (!ready(st) || (bassOn(st) ? st.bass.lock !== 'kick' : !ownCoversKick(st))) return null;
    return applyEdits(st, { kind: 'bass', detail: { drums: true } });
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
    const dropped = { pins: [], unhonored: [], lead: [], grid: null, p: null, clave: null, arps: [], bass: [] };
    // phase E: the clave choice kept where the new composition still offers that clave (its trace's alternates), else
    // dropped and said; Sync | Fill kept (a composition in notes has no clave: both go)
    let clave = st.edits?.clave ? { ...st.edits.clave } : null;
    if (clave && !spec.refused) {
      if (!spec.clave) { if (clave.id != null) dropped.clave = { id: clave.id, pattern: readClave(clave.id).pattern }; clave = null; }
      else {
        if (clave.id != null && !(compEventOf(st.trace)?.alternates ?? []).some((a) => a.id === clave.id)) { dropped.clave = { id: clave.id, pattern: readClave(clave.id).pattern }; delete clave.id; }
        if (clave.id === spec.clave.id) delete clave.id;
        if (clave.relation === spec.clave.relation) delete clave.relation;
        if (!Object.keys(clave).length) clave = null;
      }
    }
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
    st.edits = { ...emptyEdits(), grid: st.drumOptions.grid ? st.edits?.grid ?? null : null, clave: spec.refused ? st.edits?.clave ?? null : clave };
    st.undo = []; st.redo = [];
    st.dropped = droppedOrNull(dropped);
    folds.delete(st);
  }
  const droppedOrNull = (d) => (d.pins.length || d.unhonored.length || d.lead.length || d.grid || d.p || d.clave || d.arps?.length || d.bass?.length ? d : null);
  /** phase E, after a re-compose's fold: an arp pick its phrase no longer offers (`missed`) is dropped from the entry
   *  and said (state.dropped.arps); phase H: a bass pick its bar no longer offers, the same (state.dropped.bass) → whether
   *  any was */
  function dropMissedPicks(st) {
    const out = [];
    for (const id of ARP_PARTS) {
      const part = st.spec?.parts?.find((p) => p.id === id);
      if (!part?.arp) continue;
      const picks = { ...(st.arps[id].picks ?? {}) };
      part.arp.phrases.forEach((ph, i) => { if (ph.missed != null && picks[i] === ph.missed) { out.push({ part: id, phrase: i, id: ph.missed }); delete picks[i]; } });
      if (out.some((x) => x.part === id)) st.arps = { ...st.arps, [id]: { ...st.arps[id], picks } };
    }
    const bass = st.spec?.parts?.find((p) => p.id === 'bass')?.bass, lost = [];
    if (bass) {
      const picks = { ...(st.bass.picks ?? {}) };
      for (const b of bass.bars) if (b.missed != null && picks[b.bar] === b.missed) { lost.push({ bar: b.bar, id: b.missed }); delete picks[b.bar]; }
      if (lost.length) st.bass = { ...st.bass, picks };
    }
    if (!out.length && !lost.length) return false;
    st.dropped = { ...(st.dropped ?? { pins: [], unhonored: [], lead: [], grid: null, p: null, clave: null, arps: [], bass: [] }), ...(out.length ? { arps: out } : {}), ...(lost.length ? { bass: lost } : {}) };
    return true;
  }
  /** the trace's comp event (the clave's alternates: R2), memoized per trace */
  const compEvents = new WeakMap();
  function compEventOf(trace) {
    if (!trace?.events) return null;
    if (!compEvents.has(trace)) compEvents.set(trace, trace.events.find((e) => e.kind === 'part' && e.part === 'comp' && e.clave) ?? null);
    return compEvents.get(trace);
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
    arps: JSON.parse(JSON.stringify(st.arps ?? lineArps())), bass: JSON.parse(JSON.stringify(st.bass ?? composedBass())), voicing: st.voicing ?? 'led',
    compDensity: st.compDensity ?? DEFAULT_COMP_DENSITY });
  /** a compose in flight for this state is dropped (its answer is for another input), as touch() does */
  const dropFlight = (st) => { if (st.status === 'composing') { bump(st); flights.delete(st); st.status = settled(st); } };
  /** a new clip, or none: the pins, the field and the edits were another meter's bars (proposed) */
  function freshTarget(st) {
    st.progression = []; st.field = null; st.edits = { ...emptyEdits(), clave: st.edits?.clave ?? null }; st.undo = []; st.redo = []; st.dropped = null;
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
      // phase H: the chords' voicing, sent only when close (led is Compose's default), so the composed spec needs no switch
      if ((st.voicing ?? 'led') === 'close') options.overrides.voicing = 'close';
      // phase N: the comp's density, sent when it isn't the default (sparse–medium), so the composed spec needs no switch;
      // not to a composition whose clave has no tier (the pattern's, or a comp in notes: Compose refuses it there)
      if ((st.compDensity ?? DEFAULT_COMP_DENSITY) !== DEFAULT_COMP_DENSITY && !(st.composed && !st.composed.refused && !tierOf(st.composed))) options.overrides.compDensity = st.compDensity;
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
            // Phase E: the clave choice kept through it is applied the same way (the fold's last step), and an arp pick
            // its phrase no longer offers is dropped (said in state.dropped.arps), the arps then arranged again without it.
            // Phase H: the bass the same (a pick its bar no longer offers dropped: state.dropped.bass), and the voicing.
            // Phase N: the comp's density, and Compose's own bass over a kick it didn't cover (the window's drums).
            if (arpsOn(st, spec).length || st.edits.clave || bassOn(st) || voicingStep(st) || densityStep(st) || kickMoved(st, st.drums)) {
              try {
                const out = runFold(st); if (out && typeof out.then === 'function') await out;
                if (dropMissedPicks(st)) { const again = runFold(st); if (again && typeof again.then === 'function') await again; }
              } catch { st.spec = spec; st.parts = Object.fromEntries(spec.parts.map((p) => [p.id, p])); st.drums = arrangeDrums(spec, st.drumOptions); }
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
      rebass(state);   // phase H: a bass locked to the kick follows the drums
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
    /** the edits as JSON export carries them (null with none); B2: `arps` when a part is in Arp; phase E: `clave` when chosen;
     *  phase H: `bass` when it isn't Compose's own, `voicing` when close; phase N: `compDensity` when it isn't the default */
    editsExport() {
      const e = state.edits, grid = state.drumOptions.grid && (state.drumOptions.mode === 'grid' || state.drumOptions.mode === 'prime');
      const arps = ARP_PARTS.some((id) => state.arps?.[id]?.mode === 'arp') ? JSON.parse(JSON.stringify(state.arps)) : null;
      // phase H: the bass when it isn't Compose's own, the voicing when close
      const bass = isComposedBass(state.bass) ? null : JSON.parse(JSON.stringify(state.bass)), voicing = (state.voicing ?? 'led') === 'led' ? null : state.voicing;
      const compDensity = (state.compDensity ?? DEFAULT_COMP_DENSITY) === DEFAULT_COMP_DENSITY ? null : state.compDensity;
      if (!hasEdits(state) && !grid && !state.field && !arps && !bass && !voicing && !compDensity) return null;
      return { chords: JSON.parse(JSON.stringify(e.chords)), lead: JSON.parse(JSON.stringify(e.lead)), order: [...e.order],
        drums: grid ? { mode: state.drumOptions.mode, grid: JSON.parse(JSON.stringify(state.drumOptions.grid)), from: e.grid?.from ?? null } : null, field: state.field ? state.field.text : null,
        ...(arps ? { arps } : {}), ...(e.clave ? { clave: { ...e.clave } } : {}), ...(bass ? { bass } : {}), ...(voicing ? { voicing } : {}), ...(compDensity ? { compDensity } : {}) };
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
        if (reshape && st.edits.order.length) { st.edits = { ...emptyEdits(), grid: st.edits.grid ?? null, clave: st.edits.clave ?? null }; st.undo = []; st.redo = []; folds.delete(st); settleState(st, null); }
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
     * re-compose; one undo step. A change of Time without picks drops the part's picks (phase E: they are keyed by the
     * phrase at a time). Before any
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
      // phase E (ruled): a pick is keyed by the phrase at its time, so a change of Time drops the part's picks
      if (given.time !== undefined && given.picks === undefined && given.time !== (st.arps[id].time ?? ARP_DEFAULTS.time)) next.picks = {};
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
    /**
     * Phase E: play one of phrase p's ranked arps (arpOf(part).phrases[p].alternates; its first, the default, again
     * removes the pick): setArp with the part's picks so changed, one undo step; the window auditions it as a runner-up
     * (audition(() => pickArp(…))). A part not playing as an arp, a walked phrase or an id it doesn't offer throws.
     */
    pickArp(id, phrase, altId) {
      const a = api.arpOf(id);
      if (!a.playing) throw new Error(`composer: the ${id} isn't playing as an arp`);
      const ph = a.phrases?.[phrase];
      if (!ph) throw new Error(`composer: the ${id}'s arp has no phrase ${phrase}`);
      if (ph.walked) throw new Error(`composer: phrase ${phrase + 1} is walked (nothing mined there): no arp to pick`);
      if (!ph.alternates.some((x) => x.id === altId)) throw new Error(`composer: phrase ${phrase + 1} offers no arp ${altId}`);
      const picks = { ...a.picks };
      if (altId === ph.alternates[0].id) delete picks[phrase]; else picks[phrase] = altId;
      return api.setArp(id, { picks });
    },
    // ── phase E: the clave (COMP_ARP_ORDER.md Amendment 1; rearrange.js reclave) ──
    /**
     * The comp's clave as it plays → { id, name?, text (the pattern a bar a group), pattern, source (claveSource's words),
     * steps, span, score, terms, from, bars, read ('frame' | 'pattern'), frame (a frame clave), barTexts (each bar's
     * pattern, phase L), relation, partner: { pattern, text, source, barTexts }, strokes (the comp's, as it plays), silent,
     * composedId, composedRelation, edit (state.edits.clave), asked (not among the alternates), alternates: [{ …the
     * trace's (id, steps, span, pattern, onsets, score, terms, bars, from, patterns?, read?), text, source, label, curated,
     * frame, inFrame, current, composed }] } | null (nothing composed, or a composition in notes).
     * Phase N (Amendment 2): `alternates` are the frame candidates re-ranked over the chords as they play (P30: the last
     * fold step's `claveAlternates`), else the trace's; `reranked` says which. `density` (a frame clave's; else null):
     * { asked (the entry's), playing (spec.clave.compDensity: { asked, played, fellBack }), share, tier (the clave's own),
     * choices }.
     */
    claveOf() {
      const s = ready(state) ? state.spec : null;
      if (!s?.clave) return null;
      const c = s.clave, own = state.composed.clave, ev = compEventOf(state.trace), N = s.knobs.bars, re = rerankedOf(state);
      // phase L: a frame candidate (`frame`) and a curated clave read in frame (`inFrame`: its fixed steps land on in-frame
      // onsets only), named by its own label (`label`: the source without "· in frame")
      const alternates = (re ?? ev?.alternates ?? []).map((x) => ({ ...x, text: claveText(x), source: claveSource(x), curated: !!x.from?.pattern, frame: !!x.from?.frame, inFrame: !!x.from?.pattern && x.read === 'frame',
        label: x.read === 'frame' && !x.from?.frame ? claveSource({ ...x, read: null }) : claveSource(x), current: x.id === c.id, composed: x.id === own?.id }));
      const p = c.partner;
      return { id: c.id, ...(c.name ? { name: c.name } : {}), text: claveText(c), pattern: c.pattern, source: claveSource(c), steps: c.steps, span: c.span ?? 1, score: c.score, terms: { ...c.terms }, from: { ...c.from }, bars: c.bars,
        read: c.read ?? 'pattern', frame: !!c.from?.frame, barTexts: barTextsOf(c, N),
        relation: c.relation, partner: { pattern: p.pattern, text: claveText(p), source: p.source, barTexts: barTextsOf(p, N) }, strokes: s.parts.find((x) => x.id === 'comp')?.strokes?.length ?? 0,
        silent: c.relation === 'fill' ? p.silent + p.shared : c.silent, composedId: own?.id ?? null, composedRelation: own?.relation ?? null,
        edit: state.edits?.clave ? { ...state.edits.clave } : null, asked: !alternates.some((x) => x.current), alternates, reranked: !!re,
        density: tierOf(state.composed) ? { asked: state.compDensity ?? DEFAULT_COMP_DENSITY, playing: c.compDensity ? { ...c.compDensity } : null, share: c.share ?? null, tier: c.tier ?? null, choices: [...COMP_DENSITIES] } : null };
    },
    /**
     * Phase N (Amendment 2, rule 10, P27): the comp's density tier ('sparse-med' | 'sparse' | 'medium' | 'dense'), live
     * with no re-compose (rearrange.js reclave `{ density }`: the tier's best plays, byte for byte a Compose given that
     * `compDensity`), one undo step. A clave picked from the list goes with it (it was the old tier's candidate; one undo
     * restores both), Sync | Fill stays. Before any Compose it is only kept (the Compose is sent it). A clave with no tier
     * (the pattern's, or a comp in notes) throws. → Promise<{ ok, kind: 'density', density, changedBars, … }>
     */
    setCompDensity(density) {
      if (!COMP_DENSITIES.includes(density)) throw new Error(`composer: the comp's density is one of ${COMP_DENSITIES.join(', ')}, not ${JSON.stringify(density)}`);
      const st = state;
      if (!ready(st)) {
        if ((st.compDensity ?? DEFAULT_COMP_DENSITY) === density) return Promise.resolve({ ok: true, noop: true, kind: 'density', density });
        st.compDensity = density; changed();
        return Promise.resolve({ ok: true, live: false, kind: 'density', density });
      }
      if (!tierOf(st.composed)) throw new Error('composer: this composition\'s clave has no density tier (a clave from the pattern, or a comp in notes)');
      return edit('density', { density }, (x) => {
        if ((x.compDensity ?? DEFAULT_COMP_DENSITY) === density) return false;
        x.compDensity = density;
        if (x.edits.clave?.id != null) { const { id, ...rest } = x.edits.clave; x.edits.clave = Object.keys(rest).length ? rest : null; }
        return true;
      });
    },
    /**
     * Phase E: the comp's clave ({ id: 'steps:pattern' | a curated name | a frame clave's 'frame:A/8/chord' (phase L) |
     * null (Compose's own) }) and/or its relation
     * ({ relation: 'sync' | 'fill' }), live with no re-compose (rearrange.js reclave), one undo step; Compose's own
     * choice again removes the edit. A composition in notes (no clave) throws. → Promise<{ ok, kind: 'clave', … }>
     */
    setClave({ id, relation } = {}) {
      requireSpec(state);
      if (!state.composed.clave) throw new Error('composer: this composition comps in notes (compStyle \'notes\'): it has no clave');
      if (relation !== undefined && relation !== null && !COMP_RELATIONS.includes(relation)) throw new Error(`composer: a relation is one of ${COMP_RELATIONS.join(', ')}, not ${JSON.stringify(relation)}`);
      const want = id === undefined || id === null ? id : readClave(id).id;   // throws on a bad clave
      return edit('clave', { id: want ?? null, relation: relation ?? null }, (st) => {
        const own = st.composed.clave, next = { ...(st.edits.clave ?? {}) };
        if (want !== undefined) { if (want === null || want === own.id) delete next.id; else next.id = want; }
        if (relation !== undefined) { if (relation === null || relation === own.relation) delete next.relation; else next.relation = relation; }
        const value = Object.keys(next).length ? next : null;
        if (JSON.stringify(value) === JSON.stringify(st.edits.clave ?? null)) return false;
        st.edits.clave = value;
        return true;
      });
    },
    // ── phase H: the bass and the chords' voicing (BASS_VOICING_ORDER.md H1) ──
    /**
     * The bass as it plays → { density, lock, picks (the entry's), densities, locks: [{ id, refusal (bassLockRefusal's
     * words over the spec and the drums as they play; null: free to pick) }], playing (an arrangement plays, not Compose's
     * own), ran (the lock that ran: a refused one falls back to 'free'), refused (why, or null), stats and bars (arrangeBass'
     * `bass`: each bar's `alternates`, its runner-ups, the first the bar's best; Compose's own: its record, or a pinned
     * spec's offer at Compose's own), pending (a big row's offer is on its way from the worker). Phase N: `own` (the entry's
     * is Compose's own: Moving · Kick, no picks), `playing` (the window arranged it: not Compose's own as composed),
     * `refollowed` (Compose's own arranged again over the drums as they play: their kick isn't the one it covered)
     */
    bassOf() {
      const b = (state.bass ??= composedBass()), s = ready(state) ? state.spec : null, part = s?.parts.find((p) => p.id === 'bass');
      const arr = part?.bass ?? (s ? offerOf(state)?.bass : null) ?? null, over = s ? lockSpecOf(s, state.drums) : null, moved = !!s && !bassOn(state) && kickMoved(state, state.drums);
      return { density: b.density, lock: b.lock, picks: { ...(b.picks ?? {}) }, densities: [...BASS_DENSITIES], locks: BASS_LOCKS.map((id) => ({ id, refusal: over && id !== 'free' ? bassLockRefusal(over, id) : null })),
        own: isComposedBass(b), playing: !!part?.bass && (bassOn(state) || moved), refollowed: moved, ran: arr?.stats?.lock ?? null, refused: part?.bass?.refused ?? null, stats: arr?.stats ?? null, bars: arr?.bars ?? null, pending: !!s && !arr };
    },
    /**
     * The bass's density, lock and picks: { density, lock, picks ({ [bar]: a line's id }: replaces the picks whole) }, any
     * of them. Live, no re-compose; one undo step. A change of density or lock without picks drops the picks (they are
     * keyed by the bar at a density and lock; one undo restores both). A lock refused now → { ok: false, error } (its
     * words). Before any Compose it is only kept (the Compose arranges it). → Promise<{ ok, kind: 'bass', changedBars, … }>
     */
    setBass({ density, lock, picks } = {}) {
      if (density !== undefined && !BASS_DENSITIES.includes(density)) throw new Error(`composer: the bass's density is one of ${BASS_DENSITIES.join(', ')}, not ${JSON.stringify(density)}`);
      if (lock !== undefined && !BASS_LOCKS.includes(lock)) throw new Error(`composer: the bass lands on one of ${BASS_LOCKS.join(', ')}, not ${JSON.stringify(lock)}`);
      if (picks != null && (typeof picks !== 'object' || Array.isArray(picks) || !Object.entries(picks).every(([k, v]) => /^\d+$/.test(k) && typeof v === 'string'))) throw new Error(`composer: the bass's picks are { [bar index]: a line's id }, not ${JSON.stringify(picks)}`);
      const st = state;
      st.bass ??= composedBass();
      const next = { ...st.bass, ...(density !== undefined ? { density } : {}), ...(lock !== undefined ? { lock } : {}), ...(picks != null ? { picks: { ...picks } } : {}) };
      // a pick is keyed by the bar at a density and lock, so a change of either drops the picks (the arp's Time rule)
      if (picks == null && (next.density !== st.bass.density || next.lock !== st.bass.lock)) next.picks = {};
      const why = next.lock !== st.bass.lock && next.lock !== 'free' && ready(st) ? bassLockRefusal(lockSpecOf(st.spec, st.drums), next.lock) : null;
      if (why) return Promise.resolve({ ok: false, error: why, refused: true, kind: 'bass' });
      const same = (x) => JSON.stringify(x.bass) === JSON.stringify(next);
      if (!ready(st)) {
        if (same(st)) return Promise.resolve({ ok: true, noop: true, kind: 'bass' });
        st.bass = next; changed();
        return Promise.resolve({ ok: true, live: false, kind: 'bass' });
      }
      return edit('bass', {}, (x) => { if (same(x)) return false; x.bass = next; return true; });
    },
    /**
     * Play one of bar k's bass runner-ups (bassOf().bars[k].alternates; its first, the bar's best, again removes the
     * pick): setBass with the picks so changed, one undo step; the window auditions it as the lead's runner-ups
     * (audition(() => pickBass(…))). Roots too (Amendment 1, rule 9: the root's other in-frame notes; phase L). A bar
     * with no offer, or an id it doesn't offer, throws.
     */
    pickBass(bar, altId) {
      const b = api.bassOf(), rec = b.bars?.[bar];
      if (!rec) throw new Error(`composer: the bass has no bar ${bar}${b.pending ? ' yet (its offer is on its way from the worker)' : ''}`);
      if (!rec.alternates.some((x) => x.id === altId)) throw new Error(`composer: bar ${bar + 1}'s bass offers no line ${altId}`);
      const picks = { ...b.picks };
      if (altId === rec.alternates[0].id) delete picks[bar]; else picks[bar] = altId;
      return api.setBass({ picks });
    },
    /** phase L: an onset's tone in the row ('3/2'), to name a Roots runner-up by the note it plays; null when the row is
     *  the worker's (a big row's bass is arranged there: its materials are never built on this thread) or out of range */
    ratioOfOnset(node) {
      const st = state;
      if (!ready(st) || bassOnWorker(st) || !Number.isInteger(node)) return null;
      const { row } = materialsFor(st);
      return node >= 0 && node < row.n ? row.tones[row.tone[node]] : null;
    },
    /** the chords' voicing → { voicing (the entry's), playing (the spec's, or null), stats (the voicing pass's, while led:
     *  lifted, meanMotion, …), voicings } */
    voicingOf() {
      const s = ready(state) ? state.spec : null;
      return { voicing: state.voicing ?? 'led', playing: s ? voicedAs(s) : null, stats: s?.stats?.voicing ?? null, voicings: [...VOICINGS] };
    },
    /** the chords' Close | Led: live, no re-compose (rearrange.js revoice, the fold's first step), one undo step; before
     *  any Compose only kept (the Compose is sent it) → Promise<{ ok, kind: 'voicing', changedBars, … }> */
    setVoicing(voicing) {
      if (!VOICINGS.includes(voicing)) throw new Error(`composer: a voicing is one of ${VOICINGS.join(', ')}, not ${JSON.stringify(voicing)}`);
      const st = state;
      if (!ready(st)) {
        if ((st.voicing ?? 'led') === voicing) return Promise.resolve({ ok: true, noop: true, kind: 'voicing', voicing });
        st.voicing = voicing; changed();
        return Promise.resolve({ ok: true, live: false, kind: 'voicing', voicing });
      }
      return edit('voicing', { voicing }, (x) => { if ((x.voicing ?? 'led') === voicing) return false; x.voicing = voicing; return true; });
    },
    /** back one edit (chords, lead, the field, the drum grid, an Arp mode, the clave, the bass, the voicing) → Promise<{ ok, … }> */
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
        undo: x.undo, redo: x.redo, dropped: x.dropped, progression: x.progression, field: x.field, tempoBpm: x.tempoBpm, lastMs: x.lastMs, dirty: x.dirty, error: x.error, status: x.status, arps: x.arps, bass: x.bass, voicing: x.voicing, compDensity: x.compDensity });
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
