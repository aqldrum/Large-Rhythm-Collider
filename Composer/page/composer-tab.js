// composer-tab.js — the main page's Composer tab: DOM in, DOM out, over tab-controller.js (all state and actions live
// there and in the shared controller). It fills the two hosts the Partitions window gives it (PartitionsUI.js):
//
//   left       the header (the page's rhythm and cycle, Seed, Compose → Perform ⇄ Stop, Undo, Redo, JSON, show the
//              work, Tempo, Glide), the readouts, any refusal and what the last Compose dropped, the MATRIX (STEP 4e,
//              decision 8: the lanes became it — a row a part, a column a bar as wide as it lasts, a cell a mini view
//              of that part in that bar; the typed progression field across the top of the Chords row), and the
//              decisions list
//   inspector  a slim header row (the selected part: sound, legato, on/off, level; for the drums: mode, fills,
//              on/off, level), then the CONTEXT of the selected cell (STEP 4e: chords → its 12 candidates; lead → the
//              phrase's 8 runner-ups; bass, comping, inner → what they follow; drums → the bar's step grid, the
//              presets and the prime strip), beside four settings sections: Harmony (the root picks and the harmony
//              knobs), Lines (the meter and the table), Drums (mode, fills, the kit), Tuning (the frame, the root,
//              baseHz, the retunes)
//
// Details (CLEAN_MIDI_ORDER.md, phase A: a header toggle, off by default, kept in localStorage): off, the clean view —
// names over numbers, what you can act on, and the warnings that need you; on, the window as it was before. What only
// Details shows carries `ctab-detail` (and what only the clean view shows, `ctab-clean-only`), and the CSS hides it by
// the hosts' `ctab-details-on`, so the toggle changes what is seen and nothing else: no spec, no compose, no sound. A
// knob only Details shows keeps its value; when one is asked (not auto), the toggle carries a dot and names it.
//
// MIDI out (CLEAN_MIDI_ORDER.md, phase B): a MIDI button in the header opens the MIDI panel under it — Send (on or
// off), a bus a part (matched on first use to a bus whose name holds the part's: "Composer Lead", …; "not sent"
// leaves a part out), the clock's bus (the Lead's by default), the bend range, local sound, and what is going out.
// The page's sink (composer-midi.js, the bridge's) does the sending; the choices are kept in localStorage
// (lrc.composer.midi), never Send itself. Without Web MIDI (Safari) the button is disabled and says so. Details adds
// "MIDI file" beside JSON: the composition as it plays now, one cycle, as a .mid (M11).
//
// The upper right stays the Partitions window's mirror of the Linear Plot. While the tab is shown, the plot carries the
// Composer's lit nodes (plot-overlay.js, through LRCVisuals.setComposerOverlay), the selected cell ringed on it
// (getFocus), and, during Perform, its playhead.
//
// Show the work (a header toggle, on by default, kept in localStorage): Compose is animated from its trace
// (compose-animator.js, trace-frames.js). The plot shimmers while Compose runs, then plays the trace's steps over a
// cached base, with a caption above the matrix and its rows filling in as the parts land; it ends exactly on the lit
// nodes. The Compose button says Skip meanwhile; a click in the tab or on the plot, or Esc, skips to the end; any change
// (a knob, the rhythm, main playback, leaving the tab, the toggle) drops it. Off, Compose is exactly as before.
//
// Sprint 2: the tab is a view of the page's composition store. Its state is the store's current entry (read live:
// `tab.state` changes object when the rhythm does). The bridge hands it the page's one overlay and the overlay seat
// (the Composition lens shares both), so the lit nodes stay on the plot when the tab hides under the lens. A level
// moved elsewhere (the Playback panel's part strips) moves the inspector's slider too.
//
// STEP 4e (DESIGN_NOTES "Step 4e: the matrix and the context inspector"): the matrix (matrix.js, pure), the audition
// (audition.js: first click hears an alternate from the next bar, a second click or Keep keeps it, Esc or Revert takes
// it back with no redo step left), undo/redo (⌘Z / ⇧⌘Z, Ctrl on other systems, while focus is in the window, and the
// header's buttons), the keyboard on the matrix (arrows move, Enter opens the cell), and the narrow fallback (below
// ~600 px of the left half the matrix shows one bar and a bar picker: a container query in composer-tab.css).
//
// MIDI targets (phase B; DESIGN_NOTES "MIDI targets (phase B)"): the MIDI clip control under the header. Choose a .mid
// or drop one anywhere on the window: it is decoded, placed in the row and composed around (the controller's
// setTarget). The decode line (name, grid, bars, notes, the tonic with its 12-way override, the notes the skyline
// dropped), the fit line (target-lines.js: hits, tight, note-offs, whole cycle or the window, substitutes, silent
// notes, drift, the classes the row can't play), the placements to audition (the search's best and its alternates: a
// first click hears one, a second click or Keep keeps it, Esc or Revert takes it back), Clear, and errors in plain
// words. The matrix's lead row is the clip with its marks (matrix.js); the lead's context lists the clip's notes and
// their kinds instead of runner-up lines (P6: no lead swaps on a target).
//
// The Arp mode (COMP_ARP_ORDER.md B3, Q8; DESIGN_NOTES "Comping and Arp in the window"): the lead's and the inner's
// cell inspectors open on a Line | Arp switch (the controller's setArp: live, one undo step). With Arp: Time (×1, ×2,
// ×3 the slots a bar: the anchors the arp is mined over; COMP_ARP_ORDER.md Amendment 1, M5 — it replaced B3's Pattern,
// Rate and Range); Details adds the rests, the share of chord tones and the phrases mined (the rest walked). The
// phrases' ranked arps are the phase E picker below. A lead in Arp hides its runner-ups (Q5). On a MIDI target the
// lead's switch is disabled, its title arpRefusal's words. The matrix's lane name and the part strip say "· arp".
// Comping in chords (A4): a borrowed comp tone's dot is hollow; the comp cell says its strokes (and, with Details,
// the share of its tones the row sounds).
//
// The clave and arp pickers (COMP_ARP_ORDER.md Amendment 1, phase E; DESIGN_NOTES "The clave and arp pickers"):
//   comp cell   the clave by its pattern (monospace, a bar a group) and its source ("from layer A · 4 steps", "son clave
//               3-2"), a Sync | Fill switch (live: rearrange.js reclave, one undo step), then the claves to choose from
//               (the trace's alternates: the mined top 12, then the curated), auditioned from the next bar, kept or
//               reverted exactly as a chord's alternates are; Details: the scores and terms, the tone set, Fill's partner
//   arp cells   the phrase holding the cell lists its ranked arps by contour and band ("arch · no rests"), the one
//               playing marked, each auditioned the same way (Keep is one undo step: setArp's picks); a walked phrase
//               says so and offers nothing; Details: each arp's cost a note, its chord-tone share and its notes
//   dropped     a re-compose that can't keep a chosen clave, or an arp pick, says so with the other dropped edits
//
// The bass and the voicing (BASS_VOICING_ORDER.md phase H; DESIGN_NOTES "The window: bass and voicing (phase H)"):
//   bass cell   a row of Density (a select: Roots | Sparse | Moving | Walking) and Lands on (Free | Kick | Clave; a lock
//               refused — Kick with the drums off, Clave on a comp in notes — disabled, its reason its title and said
//               under the switch), both live (the controller's setBass: one undo step; a change drops the bar picks),
//               then the selected bar's runner-ups (up to 8, by contour and band, the one playing marked), auditioned
//               from the next bar, kept or reverted as the lead's (Roots' too, phase L); a bar that fell back
//               says why; Details: the stats (notes a bar, rooted, on the one), each line's cost a note, notes, motion
//   chords cell under its head, a Close | Led switch (setVoicing: live, one undo step) with the voicing's stats beside
//               it, in the clave line's quiet style ("2 lifted · 240¢ a chord")
//   dropped     a re-compose that can't keep a bass pick says so with the rest
//
// The window over Amendment 1 (BASS_VOICING_ORDER.md phase L; DESIGN_NOTES "The window over Amendment 1 (phase L)"):
//   comp cell   the head shows the bar's own clave (a frame clave's pattern changes with the chord: claveText(clave, k);
//               in Fill, the partner's beside it); the picker lists the frame candidates by their source ("layer A · 8
//               steps · chord tones") and score, the pattern in Details, then the curated, each tagged "lands in frame
//               only"; a clave read from the pattern (claveFrom 'pattern') is listed as phase E listed it
//   bass cell   Roots' runner-ups (rule 9: the root's other in-frame notes, by the tone each plays) in the same list, with
//               audition, Keep and Revert; a bar that walks less than full says so ("walks 6 of 8: a rest where no step
//               fits"); under a lock the bar's hits covered, and any missed (no onset in frame) in amber; Kick and Clave
//               COVER their hits (rule 7): every kick (or stroke) gets a note, and the density adds the rest
//   chords cell the voicing's stats and title say the loop is closed (rule 8: the wrap led like every change)
//   edit note   a chord swap that re-read a bar's clave says so (`reclavedBars`)

import { soundChoices, drumModeChoices, DRUM_LAB_VOICES, TEMPO_LIMITS, ARP_CHOICES } from '../perform/composer-controller.js';
import { KNOB_FIELDS, TABLE_FIELD, fieldValue, refusalText, readoutItems, knobChosen, decisionRows, rootGroups, strayRootOption, chordGot, progressionNote,
  noteTitle, modulationLabel } from '../perform/readouts.js';
import { PART_COLORS, PART_LABELS, HIGHLIGHT_PARTS, plotOf } from './plot-highlights.js';
import { SECTIONS, SECTION_LABELS, CONTEXT_SECTION } from './tab-controller.js';
import { createPlotOverlay } from './plot-overlay.js';
import { createComposeAnimator, paintFrame, paintShimmer, readShowWork, writeShowWork } from './compose-animator.js';
import { matrixModel, moveCell, nextStep, fieldStrip, candidateRow, lineRow, primeStrip, barsLabel, retuneRanges, barAt, qualityName, phraseSpans, compLine } from './matrix.js';
import { createAudition } from './audition.js';
import { MIDI_PARTS, matchPort, midiFileOf } from '../perform/composer-midi.js';
import { claveSetText, parseFrameId } from '../core/claves.js';   // phase E: the clave's tone set, in words; phase L: a frame clave's id
import { walkClock } from '../core/bass.js';   // phase L: Walking's clock, for "walks 6 of 8"
import { arrangeDrums, gridOf, DRUM_VOICES, beatsOf } from '../core/drums.js';
// MIDI targets (phase B)
import { TARGET_SETS } from '../core/compose.js';
import { decodeLine, fitLine, placementRow, tonicChoices, clipMarks, noteName, KIND_WORDS, targetError } from './target-lines.js';

const KNOBS_OF = Object.freeze({ harmony: ['modulation', 'settlePasses', 'presence'], lines: ['bars', 'slotsPerBar', 'anchors'], tuning: ['frameCentsEachSide'] });
/** the caption's names for the trace's beats */
const BEAT_NAMES = Object.freeze({ row: 'row', root: 'root', meter: 'meter', cells: 'cells', progression: 'progression', line: 'lead', chords: 'chords', line2: 'lead again',
  settle: 'settle', harmony: 'harmony', parts: 'parts', drums: 'drums', done: 'done' });
const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
/** Details (C1): where the toggle is kept, and reading and writing it (any access wrapped; off when unread) */
export const DETAILS_KEY = 'lrc.composer.details';
export function readDetails(storage) { try { return storage?.getItem?.(DETAILS_KEY) === '1'; } catch { return false; } }
export function writeDetails(storage, on) { try { storage?.setItem?.(DETAILS_KEY, on ? '1' : '0'); } catch { /* storage refused: the setting lasts the page */ } }
/** the knobs only Details shows (C5); the Table row too, though it is where Compose runs, not an ask */
export const DETAIL_KNOBS = Object.freeze(['settlePasses', 'presence', 'anchors', 'frameCentsEachSide']);
/** the asked knobs the clean view hides (C3): [label value] for the Details toggle's dot */
export const hiddenSettings = (knobs) => DETAIL_KNOBS.filter((n) => knobs?.[n] != null).map((n) => `${KNOB_FIELDS.find((f) => f.name === n).label} ${fieldValue(n, knobs[n])}`);
const DETAIL = 'ctab-detail', CLEAN = 'ctab-clean-only';
/** MIDI out (phase B): where the panel's choices are kept { ports: { [part]: name | '' (not sent) }, clock: name | '', bend } */
export const MIDI_KEY = 'lrc.composer.midi';
const MIDI_LABELS = Object.freeze({ lead: 'Lead', chords: 'Chords', comp: 'Comping', bass: 'Bass', inner: 'Inner', drums: 'Drums' });
/** M5: the Arp's Time words (× the slots a bar) */
export const ARP_TIME_LABELS = Object.freeze({ 1: '×1', 2: '×2', 3: '×3' });
const ARP_TIME_TITLES = Object.freeze({ 1: 'an anchor a slot: the arp mined at the bars\' own slots', 2: 'double time: two anchors a slot', 3: 'triple time: three anchors a slot' });
/** phase H: the bass's densities and locks in the window's words, and their titles */
export const BASS_DENSITY_LABELS = Object.freeze({ roots: 'Roots', sparse: 'Sparse', moving: 'Moving', walking: 'Walking' });
const BASS_DENSITY_TITLES = Object.freeze({ roots: 'one note a chord, on the change (locked: a root on every hit); its runner-ups the root\'s other notes in frame', sparse: 'Compose\'s own: 20–35% of the slots', moving: 'the lead\'s mid band, two octaves down: 40–60% of the slots',
  walking: 'every slot (8 a bar on 16-slot rows), stepwise, approaching the next chord\'s root; a bar that can\'t fill walks what it can, a rest where no step fits' });
export const BASS_LOCK_LABELS = Object.freeze({ free: 'Free', kick: 'Kick', clave: 'Clave' });
// phase L (rule 7): a lock COVERS its hits, and the density adds the rest
const BASS_LOCK_TITLES = Object.freeze({ free: 'anywhere: the miner\'s own choice', kick: 'covers the kick: every kick gets a note, and the density adds the rest',
  clave: 'covers the comp\'s strokes (the clave\'s in Sync, its partner\'s in Fill): every stroke gets a note, and the density adds the rest' });
/** phase L: what a lock's hits are, in words (a bar's "covers 3 of 3 kicks") */
const BASS_HIT_WORDS = Object.freeze({ kick: ['kick', 'kicks'], clave: ['stroke', 'strokes'] });
/** phase H: why a bar offers no bass lines (bass.js' `how`; phase L: the lock covers its hits) */
const BASS_HOW_WORDS = Object.freeze({ 'root onset': 'nothing could be mined here, so it plays the chord\'s root onset — no runner-ups',
  'locked roots': 'no line could cover every hit, so it plays a root on each hit (its chord tone where it has no root) — no runner-ups', rest: 'no hit to cover in this bar, so the bass rests here — no runner-ups' });
/** a part's name with its mode: "Lead · arp" (B3) */
export const partName = (id, part) => `${PART_LABELS[id]}${part?.arp ? ' · arp' : ''}`;
/** the narrowest a matrix column gets before the matrix scrolls (px; proposed) */
const MIN_COLUMN_PX = 56;
const isMac = () => { try { return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? ''); } catch { return false; } };

/**
 * createComposerTab({ tab, doc, visuals, raf, makeCanvas, download, clock, storage })
 *   tab       tab-controller.js
 *   doc       the document (the page's)
 *   visuals   () → window.lrcVisuals (the Linear Plot), or null
 *   raf       (fn) → requestAnimationFrame(fn)
 *   clock     () → ms (performance.now): the Compose animation's clock
 *   storage   where "show the work" is kept (localStorage; any access is wrapped)
 *   midiAccess () → Promise<MIDIAccess> (navigator.requestMIDIAccess), or null without Web MIDI (phase B)
 * → { mount({ left, inspector }), show(), hide(), render(), overlay, animator, audition, shown }
 */
export function createComposerTab({ tab, doc = globalThis.document, visuals = () => globalThis.window?.lrcVisuals ?? null, raf = (f) => globalThis.requestAnimationFrame(f), makeCanvas, download, clock, storage = defaultStorage(), overlay: sharedOverlay = null, seat = null,
  midiAccess = null } = {}) {
  const core = tab.core;
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
  const plotted = () => { const v = visuals(); return v && v.compositeRhythm ? { compositeRhythm: v.compositeRhythm, grid: v.grid } : null; };
  const overlay = sharedOverlay ?? createPlotOverlay({ getHighlights: () => tab.highlights(plotted()), getSelected: () => tab.view.selected, getFocus: () => tab.cellFocus(plotted()), makeCanvas });
  // the overlay on the plot: through the page's seat when there is one (the lens shares it), else set directly
  const claimPlot = () => (seat ? seat.claim('tab') : visuals()?.setComposerOverlay?.(overlay));
  const releasePlot = () => (seat ? seat.release('tab') : visuals()?.setComposerOverlay?.(null));
  const levelEls = new Map();   // part id → its level slider in the inspector (kept in step with other views)
  let ownScene = false;   // whether the overlay's animation base is this tab's (the lens animates on it too)
  const sounds = soundChoices(), drumModes = drumModeChoices();
  let hosts = null, ui = null, shown = false, lastPlaying = false, playheadEl = null, firstBars = null;
  // the Compose animation: the driver, what it lands on, the rows it drives, the last frame shown
  const anim = createComposeAnimator(clock ? { clock } : {});
  let animFinal = null, laneEls = {}, laneKey = null, captionKey = null, lastFrame = null, plotEl = null;
  // STEP 4e: the last edit's result (said in the inspector), "chords follow" for the next lead swap, the bar now playing
  let lastEdit = null, followPref = false, nowBar = -1, pickEls = [], headEls = [], inspWhere = null;
  tab.view.showWork = readShowWork(storage);
  tab.view.details = readDetails(storage);

  // ── STEP 4e: the audition, and every edit through one door (an open audition is kept before another edit) ──
  const audition = createAudition({
    core,
    playhead: () => { const at = tab.playheadAt(), s = tab.state.spec; return at && s ? { t: at.t, T: s.knobs.cycleSeconds, barStarts: s.timeline.barStarts, factor: core.tempoFactor() } : null; },
    onChange: () => { if (shown) { render(); visuals()?.drawPlot?.(); } },
  });
  const said = (r) => { lastEdit = r; if (shown) render(); return r; };
  /** an ordinary (non-audition) edit: an open audition is kept first */
  const doEdit = (run) => audition.settle().then(() => { const p = Promise.resolve(run()); if (shown && core.applying()) render(); return p; })
    .then(said, (err) => said({ ok: false, error: String(err?.message ?? err) }));
  function undo() { if (audition.state !== 'idle') return audition.revert().then(said); return core.undo().then(said); }
  function redo() { return audition.settle().then(() => core.redo()).then(said); }

  const recomposeIfQuick = () => { if (core.canAutoRecompose()) core.compose(); };
  const field = (f, value) => {
    const e = f.kind === 'select'
      ? el('select', f.title ? { title: f.title } : {}, ...f.options.map(([v, label]) => el('option', { value: v, textContent: label })))
      : el('input', { type: 'number', ...f.attrs, ...(f.title ? { title: f.title } : {}) });
    e.value = value;
    return e;
  };
  const toggle = (label, on, title, onClick) => { const b = el('button', { className: `ctab-toggle${on ? ' on' : ''}`, textContent: label, title: title || '' }); b.addEventListener('click', onClick); return b; };
  const button = (label, className, title, onClick, extra = {}) => { const b = el('button', { className, textContent: label, title: title || '', ...extra }); b.addEventListener('click', onClick); return b; };
  const levelSlider = (id) => { const r = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: tab.state.levels[id], title: 'level', className: 'ctab-level' }); r.addEventListener('input', () => core.setLevel(id, r.value)); levelEls.set(id, r); return r; };
  core.onLevel((id, value) => { const r = levelEls.get(id); if (r && doc.activeElement !== r) r.value = value; });

  // ── the left host: built once, its moving parts re-rendered ──
  function buildLeft(left) {
    const seed = el('input', { type: 'number', step: 1, className: 'ctab-seed', value: tab.state.input.seed, title: 'the seed: the same seed, the same composition' });
    seed.addEventListener('change', () => core.setSeed(seed.value));
    const go = el('button', { className: 'ctab-go', textContent: 'Compose' });
    go.addEventListener('click', pressGo);
    const mod = isMac() ? '⌘' : 'Ctrl+';
    // the icons alone in the clean view, the words with Details (C5)
    const undoBtn = button('↶', 'ctab-btn ctab-undo', `undo the last edit (${mod}Z): a swap, the typed field, a drum step`, () => undo());
    const redoBtn = button('↷', 'ctab-btn ctab-redo', `redo it (${isMac() ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`, () => redo());
    undoBtn.append(el('span', { className: `ctab-word ${DETAIL}`, textContent: ' Undo' }));
    redoBtn.append(el('span', { className: `ctab-word ${DETAIL}`, textContent: ' Redo' }));
    const work = el('button', { className: 'ctab-toggle ctab-work', textContent: 'show the work', title: 'animate Compose: the root, the lead, the chords under it, the settling and the parts, on the Linear Plot' });
    work.addEventListener('click', () => { const on = !tab.view.showWork; writeShowWork(storage, on); tab.setShowWork(on); });
    const details = el('button', { className: 'ctab-toggle ctab-details', textContent: 'details' });
    details.addEventListener('click', () => { const on = !tab.view.details; writeDetails(storage, on); tab.setDetails(on); });
    const json = el('button', { className: `ctab-btn ${DETAIL}`, textContent: 'JSON', title: 'download the spec as it plays now' });
    json.addEventListener('click', exportJSON);
    const midiFile = el('button', { className: `ctab-btn ctab-midi-file ${DETAIL}`, textContent: 'MIDI file', title: 'download the composition as it plays now, one cycle, as a .mid: a track a part, in exact tuning (pitch bends)' });
    midiFile.addEventListener('click', exportMid);
    const midiBtn = el('button', { className: 'ctab-toggle ctab-midi', textContent: 'MIDI' });
    midiBtn.addEventListener('click', () => { midiOpen = !midiOpen; renderMidi(); });
    const midiPanel = el('div', { className: 'ctab-midi-panel' });
    midiPanel.style.display = 'none';
    const tempo = el('input', { type: 'range', min: TEMPO_LIMITS[0], max: TEMPO_LIMITS[1], step: 1, className: 'ctab-tempo' });
    const tempoBpm = el('input', { type: 'number', min: TEMPO_LIMITS[0], max: TEMPO_LIMITS[1], step: 0.1, title: 'BPM', className: 'ctab-num' });
    const tempoReset = el('button', { className: 'ctab-toggle', textContent: 'reset', title: 'back to the tempo Compose chose' });
    tempo.addEventListener('input', () => { core.setTempo(tempo.value); showTempo(); });
    tempoBpm.addEventListener('change', () => { core.setTempo(tempoBpm.value); tempoBpm.blur(); showTempo(); });
    tempoReset.addEventListener('click', () => { core.resetTempo(); showTempo(); });
    const glide = el('input', { type: 'range', min: 0, max: 500, step: 1, value: tab.state.glideMs, className: 'ctab-glide', title: 'portamento: how long a held (legato) voice slides to its next note' });
    const glideOut = el('span', { className: 'ctab-muted', textContent: `${tab.state.glideMs} ms` });
    glide.addEventListener('input', () => { core.setGlide(glide.value); glideOut.textContent = `${tab.state.glideMs} ms`; });
    const rhythm = el('span', { className: 'ctab-rhythm' }), status = el('span', { className: 'ctab-status' });
    const note = el('div', { className: 'ctab-note' }), refusal = el('div', { className: 'ctab-refusal' }), readouts = el('div', { className: `ctab-readouts ${DETAIL}` }), dropped = el('div', { className: 'ctab-dropped' });
    const summary = el('div', { className: `ctab-summary ${CLEAN}` });
    const capLabel = el('b', { className: 'ctab-caption-label' }), capDetail = el('span', { className: 'ctab-caption-detail' }), capBeats = el('div', { className: 'ctab-caption-beats' });
    const caption = el('div', { className: 'ctab-caption' }, el('div', { className: 'ctab-row' }, capLabel, capDetail), capBeats);
    caption.style.display = 'none';
    playheadEl = el('div', { className: 'ctab-playhead' });
    // the matrix: focusable, so the arrow keys and Enter reach it
    const lanes = el('div', { className: 'ctab-lanes ctab-matrix', tabIndex: 0, title: 'the matrix: click a cell, or use the arrow keys and Enter' }, playheadEl);
    lanes.setAttribute('role', 'grid');
    const barPick = el('div', { className: 'ctab-barpick' });
    const table = el('table', { className: 'ctab-decisions-table' });
    const decisions = el('details', { className: `ctab-decisions ${DETAIL}` }, el('summary', { textContent: 'Decisions — what Compose chose, and why' }), table);
    // MIDI targets (phase B): the MIDI clip control (a hidden file input behind a button; a drop anywhere on the window)
    const clipFile = el('input', { type: 'file', accept: '.mid,.midi,audio/midi,audio/x-midi', className: 'ctab-clip-file' });
    clipFile.style.display = 'none';
    clipFile.addEventListener('change', () => { const f = clipFile.files?.[0]; loadClip(f); clipFile.value = ''; });
    const clipChoose = button('Choose a .mid…', 'ctab-btn ctab-clip-choose', 'a monophonic 12EDO MIDI clip: the Composer finds where the row can play it, and composes everything else around it (or drop a .mid on the window)', () => clipFile.click());
    const clipTonic = el('select', { className: 'ctab-tonic', title: "the clip's tonic (P5): the key estimate, or any of the 12; the clip is placed again, and the chords' root follows it" });
    clipTonic.addEventListener('change', () => { audition.reset(); tab.setTargetTonic(clipTonic.value === '' ? null : Number(clipTonic.value)); });
    const clipClear = button('Clear', 'ctab-btn ctab-clip-clear', 'drop the clip; Compose again for an ordinary composition', () => { audition.reset(); tab.setTarget(null); });
    const clipTonicLabel = el('span', { className: 'ctab-muted', textContent: 'Tonic' });
    const clipHint = el('span', { className: 'ctab-muted ctab-clip-hint' }), clipError = el('div', { className: 'ctab-clip-error' });
    const clipDecode = el('div', { className: `ctab-clip-line ctab-clip-decode ${DETAIL}` }), clipFit = el('div', { className: `ctab-clip-line ctab-clip-fit ${DETAIL}` }), clipAlts = el('div', { className: 'ctab-clip-alts' });
    const clipSummary = el('div', { className: `ctab-clip-line ctab-clip-summary ${CLEAN}` });
    const target = el('div', { className: 'ctab-target' },
      el('div', { className: 'ctab-row' }, el('b', { className: 'ctab-target-label', textContent: 'MIDI clip' }), clipChoose, clipFile, clipTonicLabel, clipTonic, clipClear, clipHint),
      clipError, clipSummary, clipDecode, clipFit, clipAlts);
    left.replaceChildren(
      el('div', { className: 'ctab-head' },
        el('div', { className: 'ctab-row' }, rhythm, el('label', { className: 'ctab-muted', textContent: 'Seed' }), seed, go, undoBtn, redoBtn, json, midiFile, work, details, midiBtn, status),
        el('div', { className: 'ctab-row' }, el('label', { className: 'ctab-muted', textContent: 'Tempo', title: 'playback tempo: the composed cycle faster or slower, live (pitch unchanged)' }), tempo, tempoBpm, tempoReset,
          el('label', { className: 'ctab-muted', textContent: 'Glide' }), glide, glideOut)),
      midiPanel, target, note, refusal, dropped, caption, summary, readouts,
      el('div', { className: 'ctab-scroll' }, barPick, el('div', { className: 'ctab-matrix-wrap' }, lanes), decisions));
    // a click anywhere in the tab skips the animation (the button and the toggle do their own thing)
    left.addEventListener('click', (e) => { if (anim.status === 'playing' && !e.target?.closest?.('.ctab-go, .ctab-work')) skipAnimation(); });
    return { seed, go, undoBtn, redoBtn, json, midiFile, midiBtn, midiPanel, work, details, summary, clipSummary, tempo, tempoBpm, tempoReset, glide, glideOut, rhythm, status, note, refusal, dropped, caption, capLabel, capDetail, capBeats, readouts, lanes, barPick, table,
      target, clipFile, clipChoose, clipTonic, clipTonicLabel, clipClear, clipHint, clipError, clipDecode, clipFit, clipAlts };
  }
  function showTempo() {
    if (!ui) return;
    const bpm = core.tempo(), spec = core.specTempo(), off = bpm == null;
    for (const e of [ui.tempo, ui.tempoBpm, ui.tempoReset]) e.disabled = off;
    if (off) { ui.tempoBpm.value = ''; return; }
    ui.tempo.value = bpm;
    if (doc.activeElement !== ui.tempoBpm) ui.tempoBpm.value = Number(bpm.toFixed(1));
    // MIDI targets: the seed is the clip's tempo (decided 1/4), and Reset goes back to it
    const seed = core.seedTempo() ?? spec, clip = !!tab.state.spec?.target;
    ui.tempoBpm.classList.toggle('changed', Math.abs(bpm - seed) > 1e-9);
    ui.tempoReset.title = clip ? "back to the clip's own tempo (its MIDI file's)" : 'back to the tempo Compose chose';
  }
  function exportJSON() {
    if (!tab.state.spec) return;
    const name = `composer-${tab.state.input.layers.filter(Boolean).join('-')}-seed${tab.state.input.seed}.json`;
    if (download) { download(name, core.exportJSON()); return; }
    const blob = new Blob([core.exportJSON()], { type: 'application/json' }), a = el('a', { href: URL.createObjectURL(blob), download: name });
    doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** M11: the composition as it plays now, one cycle, as a .mid */
  function exportMid() {
    const s = tab.state.spec;
    if (!s || s.refused) return;
    const bytes = midiFileOf(s, core.currentParts(), tab.state.drums, { levels: tab.state.levels, bendRange: core.midi?.bendRange ?? undefined });
    const name = `composer-${tab.state.input.layers.filter(Boolean).join('-')}-seed${tab.state.input.seed}.mid`;
    if (download) { download(name, bytes); return; }
    const blob = new Blob([bytes], { type: 'audio/midi' }), a = el('a', { href: URL.createObjectURL(blob), download: name });
    doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── MIDI out (phase B, B3): the button, the panel, the ports ──
  const sink = core.midi;
  let midiOpen = false, access = null, midiError = null, asking = null, panelKey = null;
  const readPrefs = () => { try { const v = JSON.parse(storage?.getItem?.(MIDI_KEY) ?? 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const prefs = { ports: {}, ...readPrefs() };
  const savePrefs = () => { try { storage?.setItem?.(MIDI_KEY, JSON.stringify(prefs)); } catch { /* storage refused: the choices last the page */ } };
  const outputs = () => (access ? [...access.outputs.values()] : []);
  const outputNamed = (name) => outputs().find((o) => o.name === name) ?? null;
  /** each part's bus: as chosen ('' not sent), else the first whose name holds the part's (M8) */
  const portOf = (id) => { const v = prefs.ports?.[id]; return v === '' ? null : v != null ? outputNamed(v) : matchPort(outputs(), id); };
  const clockOf = () => (prefs.clock === '' ? null : prefs.clock != null ? outputNamed(prefs.clock) : portOf('lead'));
  function applyMidi() {
    if (!sink) return;
    sink.setPorts(Object.fromEntries(MIDI_PARTS.map((id) => [id, portOf(id)])));
    sink.setClockPort(clockOf());
    if (prefs.bend != null) sink.setBendRange(prefs.bend);
  }
  /** Web MIDI access, asked once (the browser may prompt); the lists follow ports coming and going */
  function ensureAccess() {
    if (access) return Promise.resolve(access);
    if (!midiAccess) return Promise.resolve(null);
    asking ??= Promise.resolve().then(() => midiAccess()).then((a) => {
      access = a; midiError = null;
      a.onstatechange = () => { applyMidi(); renderMidi(); };
      return a;
    }, () => { midiError = 'MIDI access was refused (the browser\'s site settings can allow it)'; return null; }).finally(() => { asking = null; });
    return asking;
  }
  async function toggleSend() {
    if (!sink) return;
    if (sink.enabled) { sink.setEnabled(false); renderMidi(); return; }
    if (!(await ensureAccess())) { renderMidi(); return; }
    applyMidi();
    sink.setEnabled(true);
    renderMidi();
  }
  /** the parts sharing a bus (the drums aside: they're on 10): [[a, b]] */
  const sharing = () => {
    const out = [], ids = MIDI_PARTS.filter((id) => id !== 'drums' && portOf(id));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (portOf(ids[i]) === portOf(ids[j])) out.push([ids[i], ids[j]]);
    return out;
  };
  function midiStatus() {
    if (!midiAccess) return { text: "Web MIDI isn't available in this browser (Chrome, Edge or Firefox): Details' MIDI file still works", tone: 'amber' };
    if (midiError) return { text: midiError, tone: 'amber' };
    if (!access) return { text: 'Send asks the browser for MIDI access', tone: '' };
    if (!outputs().length) return { text: 'no MIDI outputs: add IAC buses in Audio MIDI Setup (IAC Driver → +)', tone: 'amber' };
    const n = MIDI_PARTS.filter((id) => portOf(id)).length, shared = sharing();
    if (shared.length) return { text: `${shared.map(([a, b]) => `${MIDI_LABELS[a]} and ${MIDI_LABELS[b]}`).join(', ')} share a bus: their notes would collide`, tone: 'amber' };
    return { text: sink?.enabled ? `sending ${n} of ${MIDI_PARTS.length} parts${clockOf() ? `, the clock on ${clockOf().name}` : ''}` : `${n} of ${MIDI_PARTS.length} parts have a bus`, tone: '' };
  }
  function renderMidi() {
    if (!ui) return;
    const b = ui.midiBtn;
    b.disabled = !sink || !midiAccess;
    b.className = `ctab-toggle ctab-midi${sink?.enabled ? ' on' : ''}${midiOpen ? ' open' : ''}`;
    b.title = !midiAccess ? "Web MIDI isn't available in this browser (Chrome, Edge or Firefox)" : sink?.enabled ? 'MIDI out: sending (the panel)' : 'MIDI out: each part on its own bus (the panel)';
    ui.midiPanel.style.display = midiOpen && midiAccess ? '' : 'none';
    if (!midiOpen || !midiAccess) { panelKey = null; return; }
    const outs = outputs(), st = midiStatus();
    // rebuilt only when what it shows changes (a render mid-choice must not close an open select)
    const key = JSON.stringify([!!sink?.enabled, core.localSound(), outs.map((o) => o.name), prefs, st, sink?.bendRange, !!access]);
    if (key === panelKey) return;
    panelKey = key;
    const pick = (value, onPick, { none = 'not sent', auto = null } = {}) => {
      const sel = el('select', {}, el('option', { value: '', textContent: none }), ...outs.map((o) => el('option', { value: o.name, textContent: o.name })));
      sel.value = value?.name ?? '';
      sel.disabled = !access;
      sel.addEventListener('change', () => onPick(sel.value));
      if (auto) sel.title = auto;
      return sel;
    };
    const rows = MIDI_PARTS.map((id) => el('div', { className: 'ctab-knob ctab-midi-part' }, el('label', { textContent: MIDI_LABELS[id] }),
      pick(portOf(id), (v) => { prefs.ports = { ...prefs.ports, [id]: v }; savePrefs(); applyMidi(); renderMidi(); },
        { auto: id === 'chords' || id === 'comp' ? `an MPE zone: master channel 1, a ${id === 'comp' ? 'comp' : 'chord'} voice a channel on 2–5 (MPE on the Ableton track)` : id === 'drums' ? 'channel 10, General MIDI drum notes' : 'an MPE zone of one: master channel 1, its notes on 2 (MPE on the Ableton track)' })));
    const clockSel = pick(clockOf(), (v) => { prefs.clock = v; savePrefs(); applyMidi(); renderMidi(); }, { none: 'no clock', auto: 'MIDI clock, Start and Stop, for the DAW to follow the tempo (its Sync on this bus)' });
    const bend = el('input', { type: 'number', min: 1, max: 96, step: 1, className: 'ctab-num', value: String(sink?.bendRange ?? 48), title: 'the pitch-bend range, in semitones, for synths set by hand (48 is MPE\'s)' });
    bend.addEventListener('change', () => { const v = Math.round(Number(bend.value)); if (v >= 1 && v <= 96) { prefs.bend = v; savePrefs(); sink?.setBendRange(v); } renderMidi(); });
    ui.midiPanel.replaceChildren(
      el('div', { className: 'ctab-row' }, el('b', { className: 'ctab-sub', textContent: 'MIDI out' }),
        toggle(sink?.enabled ? 'sending' : 'send', !!sink?.enabled, 'send each part to its bus (turn it on before Perform, so the DAW gets Start)', () => { toggleSend(); }),
        toggle('local sound', core.localSound(), "on: the Composer's own voices play too; off: only the DAW sounds", () => core.setLocalSound(!core.localSound())),
        el('span', { className: `ctab-muted ctab-midi-status${st.tone ? ` ${st.tone}` : ''}`, textContent: st.text })),
      el('div', { className: 'ctab-knobs' }, ...rows,
        el('div', { className: 'ctab-knob' }, el('label', { textContent: 'Clock' }), clockSel),
        el('div', { className: `ctab-knob ${DETAIL}` }, el('label', { textContent: 'Bend ±' }), bend)));
  }

  /** what the last Compose dropped (decision 5), in words: [text] */
  function droppedLines(d) {
    if (!d) return [];
    const out = [];
    for (const x of d.pins ?? []) out.push(`bar ${x.bar + 1}'s pin (root ${x.ratio}${x.quality ? `, ${qualityName(x.quality)}` : ''}) was dropped: ${x.reason === 'pastBars' ? 'the new meter has fewer bars' : 'the new row has no such root'}`);
    for (const x of d.unhonored ?? []) out.push(`bar ${x.bar + 1} asked for ${qualityName(x.asked)} and plays ${qualityName(x.got)}: the bar doesn't support it (the pin stays)`);
    if (d.lead?.length) out.push(`the lead swap${d.lead.length === 1 ? '' : 's'} (phrase ${d.lead.map((x) => x.phrase + 1).join(', ')}) ${d.lead.length === 1 ? 'was' : 'were'} dropped: a Compose re-mines the lead`);
    if (d.grid) out.push(`the drum grid was dropped: the meter moved${d.grid.was ? ` (${d.grid.was.bars} × ${d.grid.was.slotsPerBar} → ${d.grid.now.bars} × ${d.grid.now.slotsPerBar})` : ''}`);
    if (d.p) out.push(`the asked prime p = ${d.p.was} was dropped: the new meter has ${d.p.cells} cells (p must be above them)`);
    // phase E: a chosen clave the new composition doesn't offer; arp picks their re-composed phrases don't
    // phase L: a frame clave is named by its source words (claves.js claveOf gives them as its `pattern`)
    if (d.clave) out.push(`the chosen clave ${parseFrameId(d.clave.id) ? `(${d.clave.pattern}, from the frame)` : d.clave.pattern} was dropped: the new composition doesn't offer it (its own clave plays)`);
    // phase H: bass picks their re-composed bars don't offer
    if (d.bass?.length) out.push(`${d.bass.length === 1 ? 'a bass pick' : `${d.bass.length} bass picks`} (bar ${d.bass.map((x) => x.bar + 1).join(', ')}) ${d.bass.length === 1 ? 'was' : 'were'} dropped: the re-composed bar no longer offers ${d.bass.length === 1 ? 'it' : 'them'} (its best line plays)`);
    if (d.arps?.length) out.push(`${d.arps.length === 1 ? 'an arp pick' : `${d.arps.length} arp picks`} (${d.arps.map((x) => `${PART_LABELS[x.part]} phrase ${x.phrase + 1}`).join(', ')}) ${d.arps.length === 1 ? 'was' : 'were'} dropped: the re-composed phrase no longer offers ${d.arps.length === 1 ? 'it' : 'them'} (its first arp plays)`);
    return out;
  }

  /** Details (C1, C3): the hosts' class, the toggle, and its dot when the clean view hides an asked knob */
  function renderDetails() {
    const on = !!tab.view.details, hidden = on ? [] : hiddenSettings(tab.state.knobs);
    for (const h of [hosts?.left, hosts?.inspector]) h?.classList?.toggle('ctab-details-on', on);
    ui.details.className = `ctab-toggle ctab-details${on ? ' on' : ''}${hidden.length ? ' has-hidden' : ''}`;
    ui.details.textContent = hidden.length ? 'details •' : 'details';
    ui.details.title = hidden.length ? `settings hidden: ${hidden.join(', ')}` : on ? 'hide the detail: the clean view' : 'show every readout, the decisions and the advanced knobs';
  }
  function renderLeft() {
    const label = tab.button(), s = tab.state.spec;
    ui.rhythm.replaceChildren(el('b', { textContent: tab.view.hasRhythm ? tab.state.input.layers.filter(Boolean).join(':') : '—' }), ` · ${tab.state.input.cycleSeconds} s cycle`);
    ui.rhythm.title = "the main page's rhythm and Playback cycle: Compose reads them; changing either goes back to Compose";
    if (doc.activeElement !== ui.seed) ui.seed.value = tab.state.input.seed;
    const skipping = anim.status === 'playing';
    ui.go.textContent = skipping ? 'Skip ▸' : label;
    ui.go.className = `ctab-go${skipping ? ' skip' : label === 'Stop' ? ' stop' : ''}`;
    ui.go.disabled = skipping ? false : !tab.canPress();
    ui.go.title = skipping ? 'skip to the end (or click the plot, or press Esc)' : '';
    ui.undoBtn.disabled = !(core.canUndo() || audition.state !== 'idle');
    ui.redoBtn.disabled = !core.canRedo();
    ui.work.className = `ctab-toggle ctab-work${tab.view.showWork ? ' on' : ''}`;
    renderDetails();
    renderMidi();
    ui.midiFile.disabled = !s || s.refused;
    ui.status.textContent = tab.state.status === 'error' ? `error: ${tab.state.error}` : core.applying() ? 'applying the edit in the worker…' : tab.state.dirty && s ? 'changed — Compose again' : '';
    // the plot note: no rhythm yet, or a plot that isn't the Linear Plot
    const v = visuals(), notes = [];
    if (!tab.view.hasRhythm) notes.push(el('span', { textContent: 'Generate a rhythm on the main page first: Compose reads its layers and its Playback cycle.' }));
    else if (v && v.currentPlotType !== 'linear') {
      const b = el('button', { className: 'ctab-btn', textContent: 'Show the Linear Plot' });
      b.addEventListener('click', () => v.setPlotType('linear'));
      notes.push(el('span', { textContent: "The Composer's selections light up on the Linear Plot. " }), b);
    }
    ui.note.replaceChildren(...notes);
    ui.note.style.display = notes.length ? '' : 'none';
    ui.refusal.textContent = refusalText(s);
    const drop = droppedLines(tab.state.dropped);
    // the clean view: one line, the list in its title; Details: the list (C5)
    ui.dropped.replaceChildren(el('div', { className: CLEAN, textContent: `Compose couldn't keep ${drop.length} of the edits`, title: drop.join('\n') }),
      ...drop.map((t) => el('div', { className: DETAIL, textContent: t })));
    ui.dropped.style.display = drop.length ? '' : 'none';
    ui.summary.textContent = s && !s.refused ? `${s.knobs.bars} bar${s.knobs.bars === 1 ? '' : 's'} × ${s.knobs.slotsPerBar}` : '';
    ui.summary.title = s && !s.refused ? 'the meter: bars × slots a bar (Details shows every readout)' : '';
    ui.summary.style.display = ui.summary.textContent ? '' : 'none';
    ui.readouts.replaceChildren(...readoutItems(s, { lastMs: tab.state.lastMs, drums: tab.state.drums }).map(([k, val]) => el('span', {}, `${k} `, el('b', { textContent: val }))));
    ui.table.replaceChildren(...decisionRows(s, tab.state.drums).map((d) => el('tr', {}, el('td', { textContent: d.what }), el('td', { textContent: d.value }), el('td', { textContent: d.why }))));
    renderTarget();
    renderMatrix();
    showTempo();
  }

  // ── MIDI targets (phase B): the MIDI clip control ──
  let clipBusy = null;   // the name of a file being read
  const readBytes = (file) => (typeof file.arrayBuffer === 'function' ? file.arrayBuffer().then((b) => new Uint8Array(b))
    : new Promise((resolve, reject) => { const r = new globalThis.FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.onerror = () => reject(r.error); r.readAsArrayBuffer(file); }));
  /** a .mid chosen or dropped: read, then decoded, placed and composed (tab.setTarget) → its answer */
  function loadClip(file) {
    if (!file) return Promise.resolve(null);
    clipBusy = file.name || 'the file';
    audition.reset();
    if (shown) render();
    return readBytes(file).then((bytes) => tab.setTarget(bytes, { name: file.name ?? null }),
      (err) => { tab.view.targetError = `Couldn't read ${file.name ?? 'the file'}: ${err?.message ?? err}`; return { ok: false, error: tab.view.targetError }; })
      .then((r) => { clipBusy = null; if (shown) render(); return r; });
  }
  /** a placement clicked: the first click auditions it, a second (or Keep) keeps it */
  function tryPlacement(i) {
    const pa = core.placementAudition();
    if (pa && pa.index === i) return keepPlacement();
    audition.reset();
    const p = tab.auditionPlacement(i).catch((err) => { tab.view.targetError = targetError(err?.message ?? err); return { ok: false }; });
    if (shown) render();
    return p.then((r) => { if (shown) render(); return r; });
  }
  const keepPlacement = () => tab.keepPlacement().then((r) => { if (shown) render(); return r; });
  const revertPlacement = () => tab.revertPlacement().then((r) => { if (shown) render(); return r; });
  /** a line of the control: its items, each toned (ok, amber, red) */
  function clipLine(host, line) {
    const items = line?.items ?? [];
    host.replaceChildren(...items.map((it, i) => el('span', { className: `ctab-clip-item${it.tone ? ` ${it.tone}` : ''}${it.name ? ' name' : ''}`, textContent: `${i ? '· ' : ''}${it.text}` })));
    host.title = line?.title ?? '';
    host.style.display = items.length ? '' : 'none';
  }
  function renderTarget() {
    const t = tab.state.input.target ?? null, s = tab.state.spec, composing = tab.state.status === 'composing';
    const fit = t && !composing && s && !s.refused && s.target ? s.target : null;
    ui.clipChoose.disabled = !tab.view.hasRhythm;
    ui.clipChoose.textContent = t ? 'Another .mid…' : 'Choose a .mid…';
    ui.clipHint.textContent = clipBusy ? `reading ${clipBusy}…` : composing && t ? 'placing the clip in the row…'
      : t ? '' : tab.view.hasRhythm ? 'or drop one on the window: the clip becomes the lead, and everything else is composed around it' : 'generate a rhythm first';
    for (const e of [ui.clipTonic, ui.clipTonicLabel, ui.clipClear]) e.style.display = t ? '' : 'none';
    if (t) {
      ui.clipTonic.replaceChildren(...tonicChoices(t.clip).map((o) => el('option', { value: o.value, textContent: o.label })));
      ui.clipTonic.value = t.tonic == null ? '' : String(t.tonic);
      ui.clipTonic.disabled = composing;
    }
    const err = tab.view.targetError;
    ui.clipError.textContent = err ?? '';
    ui.clipError.style.display = err ? '' : 'none';
    clipLine(ui.clipDecode, t ? decodeLine(t.clip, { tonic: t.tonic }) : null);
    clipLine(ui.clipFit, fit ? fitLine(fit) : null);
    // the clean view's one line: the clip and how much of it the row plays (C5)
    const P = fit?.placement;
    clipLine(ui.clipSummary, P ? { items: [{ text: t.clip.name ?? 'the clip', name: true }, { text: `${P.hits}/${P.J} notes fit`, tone: P.hits < P.J ? 'amber' : '' }], title: 'Details shows the decode and the fit' } : null);
    // the placements: the search's best and its alternates, auditioned as the matrix's alternates are
    const pl = t ? tab.state.placements : null, pa = core.placementAudition();
    if (!pl || pl.list.length < 2) { ui.clipAlts.replaceChildren(); ui.clipAlts.style.display = 'none'; return; }
    ui.clipAlts.style.display = '';
    const chips = pl.list.map((p, i) => {
      const r = placementRow(p, i, { current: i === pl.current });
      const b = el('button', { className: `ctab-place${r.current ? ' current' : ''}${pa?.index === i ? ' auditioning' : ''}`, title: r.title, disabled: composing && pa?.index !== i },
        el('b', { textContent: r.label }), el('span', { className: 'ctab-place-where', textContent: r.where }), r.detail ? el('span', { className: `ctab-muted ${DETAIL}`, textContent: r.detail }) : null);
      b.dataset.index = String(i);
      b.addEventListener('click', () => tryPlacement(i));
      return b;
    });
    const text = pa ? (composing ? 'composing it…' : `auditioning ${pa.index === 0 ? 'the best' : `#${pa.index + 1}`}${tab.state.status === 'playing' ? '' : ' (Perform to hear it)'} — click it again, or Keep`)
      : 'placements: click one to hear it (it plays from the top)';
    ui.clipAlts.replaceChildren(el('div', { className: 'ctab-places' }, ...chips),
      el('div', { className: `ctab-audition${pa ? ' on' : ''}` }, el('span', { className: 'ctab-muted', textContent: text }),
        button('Keep', 'ctab-btn ctab-keep ctab-place-keep', 'keep this placement', () => keepPlacement(), { disabled: !pa }),
        button('Revert', 'ctab-btn ctab-revert ctab-place-revert', 'back to the placement before (Esc)', () => revertPlacement(), { disabled: !pa })));
  }
  // a .mid dropped anywhere on the window (the left half or the inspector)
  let dragDepth = 0;
  const isFiles = (e) => { const types = e?.dataTransfer?.types; return !types || [...types].includes('Files'); };
  const onDragEnter = (e) => { if (!isFiles(e)) return; e.preventDefault?.(); dragDepth++; hosts?.left.classList?.add('ctab-dropping'); };
  const onDragOver = (e) => { if (!isFiles(e)) return; e.preventDefault?.(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
  const onDragLeave = () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hosts?.left.classList?.remove('ctab-dropping'); };
  const onDrop = (e) => {
    e.preventDefault?.();
    dragDepth = 0; hosts?.left.classList?.remove('ctab-dropping');
    const f = e.dataTransfer?.files?.[0];
    if (f) loadClip(f);
  };
  const DROP_EVENTS = [['dragenter', onDragEnter], ['dragover', onDragOver], ['dragleave', onDragLeave], ['drop', onDrop]];
  // while the tab is shown, a file dropped just outside the window must not navigate the page to it (proposed)
  const guardDrop = (e) => { if (isFiles(e)) e.preventDefault?.(); };

  // ── the matrix (STEP 4e) ──
  /** the grid of the drums as the mode the entry's grid came from plays them: the "edited" marks' reference */
  function composedGridOf(st) {
    if (!st.drumOptions.grid || !(st.drumOptions.mode === 'grid' || st.drumOptions.mode === 'prime')) return null;
    const { grid, ...rest } = st.drumOptions, from = st.edits?.grid?.from ?? 'backbeat';
    try { return gridOf(arrangeDrums(st.spec, { ...rest, mode: from === 'grid' ? 'backbeat' : from })); } catch { return null; }
  }
  const alternatesCount = (bar, part) => {
    // a chord chart's split bar: every chord's alternates (CHART_ORDER.md P10)
    if (part === 'chords') return core.unitsOfBar(bar).reduce((n, u) => { const a = core.alternatesOf(u, 'chords'); return n + (a ? a.candidates.filter((c) => !c.current).length : 0); }, 0);
    if (part === 'lead') { const a = core.alternatesOf(bar, 'lead'); return a ? a.lines.filter((l) => !l.current).length : 0; }
    return 0;
  };
  /** the typed field's input: ONE element for the tab's life (a re-render moves it, never drops what is being typed) */
  let fieldInput = null, fieldApplied = '', rebuilding = false;
  function theFieldInput() {
    if (fieldInput) return fieldInput;
    const input = el('input', { type: 'text', className: 'ctab-field', placeholder: 'type a progression: Cmaj7 Am7 Dm7 G7 (a symbol a bar), or a chart: | C | Am F | G . . C |×2', spellcheck: false,
      title: 'the typed progression: C is the composition\'s base root; - leaves a bar to Compose. With a bar line it is a chord chart, and sets the bars: the chords in a bar share it, . holds the chord before, % is the bar before again, ×n repeats a section, ‖ ends one, |: :| repeats (×n after :|), A: | … | lines and form: A A B A+2 name and move sections. Enter (or leaving the field) applies it; with a composition each typed chord is a live chord edit (a chart of other bars waits for Compose), and a pin for the next Compose' });
    const apply = () => { if (rebuilding || input.value === fieldApplied) return; fieldApplied = input.value; doEdit(() => core.setProgressionField(input.value)); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault?.(); apply(); } if (e.key === 'Escape') { input.value = fieldApplied; input.blur(); } });
    input.addEventListener('change', apply);
    input.addEventListener('blur', apply);
    return (fieldInput = input);
  }
  /** the typed field across the top of the Chords row: the text as typed, each bar's resolution under it */
  function fieldRow(cols, N) {
    const f = core.progressionField(), strip = fieldStrip(f.resolution), input = theFieldInput();
    if (doc.activeElement !== input) { input.value = f.text; fieldApplied = f.text; }
    const res = el('div', { className: 'ctab-field-strip' });
    res.style.gridTemplateColumns = cols ?? `repeat(${Math.max(1, N)}, 1fr)`;
    res.append(...Array.from({ length: N }, (_, k) => {
      const b = strip[k] ?? { text: '·', detail: '', mark: '', status: 'auto', title: '' };
      const cell = el('div', { className: `ctab-res ${b.status}${k === tab.view.bar ? ' in-pick' : ''}`, title: b.title },
        el('b', { className: 'ctab-res-name', textContent: b.text }), b.mark ? el('span', { className: 'ctab-res-mark', textContent: b.mark }) : null,
        b.detail && b.status !== 'auto' ? el('span', { className: `ctab-res-detail${b.status === 'error' ? '' : ` ${DETAIL}`}`, textContent: b.detail }) : null);
      cell.dataset.bar = String(k);
      return cell;
    }));
    const notes = f.resolution && !f.resolution.refused ? f.resolution.notes : [];
    const head = el('div', { className: 'ctab-lane-head ctab-field-head' }, el('span', { className: 'ctab-field-label', textContent: 'Typed', title: 'the typed progression field (decisions 3, 4)' }));
    return { row: el('div', { className: 'ctab-fieldrow' }, head, el('div', { className: 'ctab-field-wrap' }, input, res, notes.length ? el('div', { className: 'ctab-field-notes', textContent: notes.join(' · ') }) : null)), input };
  }
  /** a chord cell's modulation (the clean view: a glyph, its cents in the title) and an edit's retune (Details) */
  function modMarks(cell, c) {
    const m = tab.state.spec.modulations.find((x) => x.bar === c.from);
    if (m) {
      const ml = modulationLabel(m);
      cell.append(el('span', { className: `ctab-mod ${DETAIL}`, textContent: ml.text, title: ml.title }), el('span', { className: `ctab-mod ctab-mod-glyph ${CLEAN}`, textContent: '↻', title: `${ml.text}: ${ml.title}` }));
    }
    if (c.retune) cell.append(el('span', { className: `ctab-retune ${DETAIL}`, textContent: `↻ retunes ${barsLabel(c.retune)}`, title: `this edit's modulation re-pitches ${barsLabel(c.retune)}: their notes stay, their tuning moves` }));
  }
  function cellView(c, row) {
    const sel = tab.view.selected === c.part && tab.view.bar >= c.from && tab.view.bar < c.to;
    const cell = el('div', { className: `ctab-bar ctab-cell${sel ? ' selected' : ''}${c.edited ? ' edited' : ''}${c.retuned ? ' retuned' : ''}${tab.view.bar >= c.from && tab.view.bar < c.to ? ' in-pick' : ''}`, title: c.title });
    cell.setAttribute('role', 'gridcell');
    cell.dataset.part = c.part; cell.dataset.bar = String(c.from); cell.dataset.to = String(c.to);
    if (c.to - c.from > 1) cell.style.gridColumn = `${c.from + 1} / span ${c.to - c.from}`;
    if (c.part === 'drums') {
      const mini = el('div', { className: 'ctab-mini' });
      if (c.steps) {
        mini.style.gridTemplateColumns = `repeat(${Math.max(1, c.places)}, 1fr)`;
        for (const v of DRUM_VOICES) {
          const line = c.steps[v] || '';
          for (let i = 0; i < c.places; i++) {
            const ch = line[i] ?? '.', silent = c.silent.has(`${v}:${i}`);
            mini.append(el('span', { className: `ctab-mstep ${v}${ch === 'X' ? ' accent' : ch === 'x' ? ' on' : ''}${silent ? ' silent' : ''}` }));
          }
        }
      }
      cell.append(mini, el('span', { className: 'ctab-dlabel', textContent: c.name, title: c.title }));
    } else {
      for (const d of c.dots) {
        // MIDI targets: a clip note's kind (amber substitute, red silent) and a late note-off
        // comping in chords (A4): a borrowed tone hollow, a ring in the part's colour
        const dot = el('span', { className: `ctab-dot${d.accent ? '' : ' held'}${d.kind ? ` clip ${d.kind}` : ''}${d.late ? ' late' : ''}${d.borrowed ? ' borrowed' : ''}` });
        dot.style.left = `${(100 * d.x).toFixed(2)}%`; dot.style.top = `${(8 + 76 * d.y).toFixed(1)}%`;
        if (d.borrowed) dot.style.color = row.color;
        else if (d.kind !== 'hard') dot.style.background = row.color;
        cell.append(dot);
      }
      if (c.part === 'chords' && c.spans) {
        // a chord chart's split bar: each chord at its span's place, a rule between them
        for (const x of c.spans) {
          const lab = el('span', { className: `ctab-chord ctab-chord-span${x.targeted ? ' targeted' : ''}${x.fallback ? ' fallback' : ''}`, textContent: x.name, title: x.title });
          lab.style.left = `calc(${(100 * x.x).toFixed(2)}% + 4px)`; lab.style.maxWidth = `calc(${(100 * x.w).toFixed(2)}% - 6px)`;
          if (x.x > 0) { const rule = el('span', { className: 'ctab-span-rule' }); rule.style.left = `${(100 * x.x).toFixed(2)}%`; cell.append(rule); }
          cell.append(lab);
        }
        modMarks(cell, c);
      } else if (c.part === 'chords') {
        cell.append(el('span', { className: `ctab-chord${c.targeted ? ' targeted' : ''}${c.fallback ? ' fallback' : ''}`, textContent: c.name }));
        modMarks(cell, c);
      }
    }
    if (c.badge) cell.append(el('span', { className: 'ctab-badge', textContent: String(c.badge), title: `${c.badge} alternate${c.badge === 1 ? '' : 's'}: select the cell to hear them` }));
    if (c.edited) cell.append(el('span', { className: 'ctab-edited', textContent: '✎', title: `edited${c.editKind ? `: ${c.editKind}` : ''} (not Compose's own)` }));
    cell.addEventListener('click', () => { tab.selectCell(c.part, c.from); ui?.lanes.focus?.({ preventScroll: true }); });
    return cell;
  }
  function renderMatrix() {
    const typingField = !!fieldInput && doc.activeElement === fieldInput;
    rebuilding = true;
    try { buildMatrix(); } finally { rebuilding = false; }
    if (typingField && fieldInput.parentNode) fieldInput.focus({ preventScroll: true });
  }
  function buildMatrix() {
    const s = tab.state.spec;
    firstBars = null; laneEls = {}; laneKey = null; pickEls = []; headEls = []; nowBar = -1;
    if (!s || s.refused) {
      // no composition yet: the typed field alone (its pins are Compose's progression then), when there is a rhythm
      const N = tab.view.hasRhythm && !s?.refused ? core.progressionField().resolution?.bars ?? 0 : 0;
      ui.lanes.replaceChildren(playheadEl, ...(N ? [fieldRow(null, N).row] : []));
      ui.lanes.style.minWidth = '';
      ui.barPick.replaceChildren();
      return;
    }
    const model = matrixModel(tab.state, { grid: core.drumGrid(), composedGrid: composedGridOf(tab.state), alternates: alternatesCount, retuned: core.retunedBars() });
    const N = model.bars;
    ui.lanes.style.minWidth = `${112 + N * MIN_COLUMN_PX}px`;
    const head = (row) => {
      const name = el('button', { className: 'ctab-lane-name', textContent: partName(row.id, tab.state.parts[row.id]), title: `select ${row.label.toLowerCase()}: the inspector shows it` });
      name.style.borderLeftColor = row.color;
      name.addEventListener('click', () => tab.select(row.id));
      const onToggle = row.id === 'drums' ? () => core.setDrums({ enabled: !row.enabled }) : () => core.setPart(row.id, { enabled: !row.enabled });
      return el('div', { className: 'ctab-lane-head' }, name, toggle(row.enabled ? 'on' : 'off', row.enabled, 'play this part or not (live)', onToggle));
    };
    // the bar numbers, over the columns
    const nums = el('div', { className: 'ctab-bars ctab-mnums' });
    nums.style.gridTemplateColumns = model.cols;
    nums.append(...Array.from({ length: N }, (_, k) => { const b = el('span', { className: `ctab-mnum${k === tab.view.bar ? ' in-pick' : ''}`, textContent: String(k + 1) }); headEls.push(b); return b; }));
    const rows = [el('div', { className: 'ctab-mhead' }, el('span', { className: 'ctab-muted ctab-mcorner', textContent: 'bar' }), nums)];
    for (const row of model.rows) {
      const bars = el('div', { className: 'ctab-bars' });
      bars.style.gridTemplateColumns = model.cols;
      const cells = row.cells.map((c) => cellView(c, row));
      bars.append(...cells);
      const cellOfBar = Array.from({ length: N }, (_, k) => cells[row.cells.findIndex((c) => k >= c.from && k < c.to)] ?? null);
      firstBars ??= bars;
      const lane = el('div', { className: `ctab-lane${row.id === 'drums' ? ' drums' : ''}${row.enabled ? '' : ' off'}${tab.view.selected === row.id ? ' selected' : ''}` }, head(row), bars);
      lane.dataset.part = row.id;
      laneEls[row.id] = { lane, cells: cellOfBar, chords: row.id === 'chords' ? cells.map((c) => c.querySelector('.ctab-chord')) : null };
      if (row.id === 'chords') rows.push(fieldRow(model.cols, N).row);
      rows.push(lane);
    }
    ui.lanes.replaceChildren(playheadEl, ...rows);
    // the bar picker (shown only on narrow widths, by CSS)
    ui.barPick.replaceChildren(el('span', { className: 'ctab-muted', textContent: 'Bar' }), ...Array.from({ length: N }, (_, k) => {
      const b = button(String(k + 1), `ctab-pick${k === tab.view.bar ? ' active' : ''}`, `show bar ${k + 1}`, () => tab.selectCell(tab.view.selected, k));
      pickEls.push(b);
      return b;
    }));
    if (anim.status === 'playing' && lastFrame) applyFrame(lastFrame);
  }

  // ── the Compose animation ──
  /** the main button: Skip while animating; Compose starts the shimmer first when the work is shown */
  function pressGo() {
    if (anim.status === 'playing') { skipAnimation(); return; }
    tab.syncRhythm();
    if (tab.view.showWork && tab.canPress() && tab.button() === 'Compose') {
      anim.wait(); overlay.setScene(true); ownScene = true;
      hosts?.left.classList?.add('ctab-animating');
      showCaption('composing…', 'Compose is running: the steps play once its trace is back', null);
    }
    if (tab.button() === 'Compose') audition.reset();
    tab.press();
  }
  /** after a change: the awaited compose came back (start), or anything else happened (drop it) */
  function syncAnimation() {
    if (anim.status === 'waiting') {
      if (tab.state.status === 'composing') return;
      if (tab.state.status === 'ready' && !tab.state.dirty && tab.state.trace && tab.view.showWork) {
        const p = plotted(), final = tab.highlights(p);
        if (final && anim.start({ trace: tab.state.trace, plot: plotOf(p || {}), final })) {
          animFinal = final; buildBeats(anim.scene.timeline.groups);
          const a = anim.tick();
          if (a && a.kind === 'frame') applyFrame(a.frame);
          return;
        }
      }
      endAnimation(false);
    } else if (anim.status === 'playing') endAnimation(false);
  }
  /** back to the ordinary tab: the overlay's own draw, the matrix as it is; redraw when no change is about to */
  function endAnimation(redraw) {
    anim.cancel();
    if (ownScene) overlay.setScene(false);
    ownScene = false;
    animFinal = null; lastFrame = null; laneKey = null; captionKey = null;
    hosts?.left.classList?.remove('ctab-animating');
    if (ui) ui.caption.style.display = 'none';
    if (redraw) { render(); visuals()?.drawPlot?.(); }
  }
  function skipAnimation() { if (anim.skip()) endAnimation(true); }

  // ── the keyboard (STEP 4e): Esc, undo/redo inside the window, the arrows and Enter on the matrix ──
  const typing = (e) => !!e && ((e.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'radio'].includes(String(e.type || 'text').toLowerCase())) || e.tagName === 'TEXTAREA' || e.isContentEditable);
  const inWindow = (a) => !a || a === doc.body || !!(hosts && (hosts.left.contains?.(a) || hosts.inspector.contains?.(a))) || !!a.closest?.('.ctab-left, .ctab-inspector, #partitions-canvas-container');
  function openCell() {
    tab.setSection(CONTEXT_SECTION);
    const first = hosts?.inspector.querySelector('.ctab-alt, .ctab-step, .ctab-ctx-action');
    first?.focus?.({ preventScroll: true });
  }
  const onKey = (e) => {
    const a = doc.activeElement;
    if (e.key === 'Escape') {
      if (anim.status === 'playing') { e.preventDefault?.(); skipAnimation(); return; }
      if (audition.state !== 'idle' && !typing(a)) { e.preventDefault?.(); audition.revert().then(said); return; }
      if (core.placementAudition() && !typing(a)) { e.preventDefault?.(); revertPlacement(); }   // MIDI targets: a placement auditioned
      return;
    }
    const k = String(e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'z' || k === 'y')) {
      if (typing(a) || !inWindow(a)) return;   // a text field keeps its own undo
      e.preventDefault?.();
      if (k === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (!ui || !(a === ui.lanes || ui.lanes.contains?.(a)) || !tab.state.spec || tab.state.spec.refused || typing(a)) return;
    if (e.key === 'Enter') { e.preventDefault?.(); openCell(); return; }
    if (e.key?.startsWith?.('Arrow')) {
      e.preventDefault?.();
      const s = tab.state.spec, next = moveCell({ part: tab.view.selected, bar: tab.view.bar }, e.key, { bars: s.knobs.bars, spans: phraseSpans(s) });
      tab.selectCell(next.part, next.bar);
    }
  };
  const onPlotClick = () => { if (anim.status === 'playing') skipAnimation(); };
  function buildBeats(groups) {
    if (!ui) return;
    ui.capBeats.replaceChildren(...groups.map((g) => el('span', { className: 'ctab-beat', textContent: g.group === 'settle' ? `settle ${g.round}` : BEAT_NAMES[g.group] ?? g.group })));
  }
  function showCaption(label, detail, groupIndex) {
    if (!ui) return;
    const key = `${label}|${detail}|${groupIndex}`;
    if (key === captionKey) return;
    captionKey = key;
    ui.caption.style.display = '';
    ui.capLabel.textContent = label;
    ui.capDetail.textContent = detail || '';
    Array.from(ui.capBeats.children).forEach((b, i) => { b.className = `ctab-beat${groupIndex == null ? '' : i < groupIndex ? ' past' : i === groupIndex ? ' now' : ''}`; });
  }
  /** a frame in the tab: the caption, and the matrix's rows as far as the parts have landed */
  function applyFrame(frame) {
    lastFrame = frame;
    showCaption(frame.label, frame.detail, frame.groupIndex);
    const key = JSON.stringify(frame.lanes);
    if (key === laneKey) return;
    laneKey = key;
    for (const [id, x] of Object.entries(laneEls)) {
      const st = frame.lanes.show[id];
      x.lane?.classList.toggle('ctab-anim-hidden', !st);
      x.lane?.classList.toggle('ctab-anim-labels', st === 'labels');
      if (x.chords) x.chords.forEach((c, k) => {
        if (!c) return;
        const own = tab.state.spec?.chords?.[k]?.name ?? '';
        c.textContent = st === 'shown' ? own : frame.lanes.chords[k] ?? '…';
        c.classList.toggle('ctab-anim-hot', frame.lanes.hot === k);
      });
      const cells = [...new Set(x.cells.filter(Boolean))];
      cells.forEach((c) => { const from = Number(c.dataset.bar), to = Number(c.dataset.to); c.classList.toggle('ctab-anim-flash', frame.lanes.flash.some((k) => k >= from && k < to)); });
    }
  }
  tab.onMainStarted(() => { if (anim.status !== 'idle') endAnimation(true); });

  // ── the inspector ──
  function knobRow(names) {
    const chosen = knobChosen(tab.state.spec, tab.state.knobs);
    return el('div', { className: 'ctab-knobs' }, ...names.map((name) => {
      const f = KNOB_FIELDS.find((x) => x.name === name), input = field(f, fieldValue(name, tab.state.knobs[name]));
      input.addEventListener('change', () => { core.setKnob(name, f.read(input.value)); recomposeIfQuick(); });
      const c = chosen[name], byClip = !!tab.state.input.target && TARGET_SETS.includes(name);   // MIDI targets: the clip sets it
      if (byClip) { input.disabled = true; input.title = 'set by the MIDI clip (its meter, its placement, its pinned lead)'; }
      // a typed chord chart sets the bars (decided, CHART_ORDER.md)
      const chart = name === 'bars' && !byClip ? core.chartShape() : null, byChart = !!chart && !chart.error;
      if (byChart) { input.disabled = true; input.title = 'set by the typed chord chart: its bars, every repeat played'; }
      const said = byClip ? `${c.text.replace(/^asked: /, 'chose ')} · the clip's` : byChart ? `${chart.bars} · the chart's` : c.text;
      // the clean view: the knob alone, unless the clip or the chart set it (C5)
      return el('div', { className: `ctab-knob${DETAIL_KNOBS.includes(name) ? ` ${DETAIL}` : ''}` }, el('label', { textContent: f.label, title: f.title || '' }), input,
        el('span', { className: `ctab-chosen${c.over && !byClip && !byChart ? ' over' : ''}${byClip || byChart ? '' : ` ${DETAIL}`}`, textContent: said }));
    }));
  }
  function progressionEditor() {
    const rc = core.rootChoices(), roots = core.progression(), s = tab.state.spec;
    const take = el('button', { className: 'ctab-btn', textContent: 'take from last compose', title: 'fill every bar with the root the last compose chose', disabled: !s || s.refused });
    take.addEventListener('click', () => { if (core.takeProgression()) recomposeIfQuick(); });
    const clear = el('button', { className: 'ctab-btn', textContent: 'clear', title: 'every bar back to auto' });
    clear.addEventListener('click', () => { core.clearProgression(); recomposeIfQuick(); });
    const headRow = el('div', { className: 'ctab-row' }, el('span', { className: 'ctab-sub' }, 'Progression', el('span', { className: DETAIL, textContent: ' — a root a bar (a chord, where a typed chart splits a bar) from the row; auto leaves it to Compose (or type chords above the Chords row)' })));
    // a typed chart's split bars: each chord's bar, for its label (CHART_ORDER.md P10)
    const shape = core.chartShape(), split = !!shape && !shape.error && roots.length > shape.bars;
    const labelOf = (k) => {
      if (!split) return `Bar ${k + 1}`;
      const sp = shape.spans[k], mine = shape.spans.filter((x) => x.bar === sp.bar);
      return mine.length === 1 ? `Bar ${sp.bar + 1}` : `Bar ${sp.bar + 1}·${mine.indexOf(sp) + 1}`;
    };
    if (!tab.view.hasRhythm) return el('div', {}, headRow, el('span', { className: 'ctab-muted', textContent: 'no rhythm yet' }));
    if (rc.refused) return el('div', {}, headRow, el('span', { className: 'ctab-muted', textContent: 'no roots: this row is refused' }));
    const opt = (o) => el('option', { value: o.value, textContent: o.text, title: o.title });
    const groups = rootGroups(rc), got = s && !s.refused && !tab.state.dirty ? s.chords : null;
    const bars = roots.map((ratio, k) => {
      const sel = el('select', { title: `${labelOf(k).toLowerCase()}: its chord's root` }, el('option', { value: '', textContent: 'auto' }),
        el('optgroup', { label: 'most heard' }, ...groups.heard.map(opt)), el('optgroup', { label: 'all, by pitch from the root' }, ...groups.all.map(opt)));
      if (ratio && !rc.candidates.some((c) => c.ratio === ratio)) sel.prepend(opt(strayRootOption(ratio)));
      sel.value = ratio ?? '';
      sel.addEventListener('change', () => { core.setProgressionRoot(k, sel.value || null); recomposeIfQuick(); });
      const g = chordGot(got?.[k]);
      return el('div', { className: 'ctab-knob' }, el('label', { textContent: labelOf(k) }), sel, el('span', { className: `ctab-chosen${g.over ? ' over' : ''} ${DETAIL}`, textContent: g.text }));
    });
    return el('div', {}, headRow, el('div', { className: 'ctab-knobs ctab-prog' }, ...bars), el('div', { className: 'ctab-row' }, take, clear, el('span', { className: `ctab-muted ${DETAIL}`, textContent: progressionNote(roots) })));
  }
  function drumControls() {
    const o = tab.state.drumOptions, enabled = tab.state.drums ? tab.state.drums.enabled : o.enabled !== false;
    const mode = el('select', { title: 'the drum mode, or a curated pattern' }, ...drumModes.map((m) => el('option', { value: m.id, textContent: m.label })));
    mode.value = o.mode;
    mode.addEventListener('change', () => core.setDrums({ mode: mode.value }));
    return [mode, toggle('fills', o.fills, 'on: the last bar of each phrase of 4 bars or more fills from beat 3, and a crash opens the next', () => core.setDrums({ fills: !o.fills })),
      toggle(enabled ? 'on' : 'off', enabled, 'play the drums or not (live)', () => core.setDrums({ enabled: !enabled })), levelSlider('drums')];
  }
  function kitRow() {
    const kit = tab.state.drumOptions.kit;
    return el('div', { className: 'ctab-knobs' }, ...DRUM_LAB_VOICES.map((v) => {
      const sel = el('select', {}, ...tab.kitChoices(v).map((c) => el('option', { value: c.value, textContent: c.label })));
      sel.value = kit[v] ?? '';
      sel.addEventListener('change', () => core.setDrums({ kit: { [v]: sel.value } }));
      return el('div', { className: 'ctab-knob' }, el('label', { textContent: v }), sel);
    }));
  }
  function partControls(id) {
    if (id === 'drums') return drumControls();
    const part = tab.state.parts[id];
    if (!part) return [el('span', { className: 'ctab-muted', textContent: 'Compose first: then its sound, legato and level are here' })];
    const sound = el('select', { title: 'its sound (Audio/voices): live' }, ...sounds.map((x) => el('option', { value: x.id, textContent: x.label })));
    sound.value = part.sound;
    sound.addEventListener('change', () => core.setPart(id, { sound: sound.value }));
    return [sound, toggle('legato', part.legato, "on: each note holds to the part's next note", () => core.setPart(id, { legato: !part.legato })),
      toggle(part.enabled ? 'on' : 'off', part.enabled, 'play this part or not (live)', () => core.setPart(id, { enabled: !part.enabled })), levelSlider(id)];
  }
  function tuningReadout() {
    const s = tab.state.spec;
    if (!s || s.refused) return el('span', { className: 'ctab-muted', textContent: 'Compose first: the root, baseHz and retunes show here' });
    const k = s.knobs, rows = s.chords.map((c) => el('tr', {}, el('td', { textContent: `bar ${c.bar + 1}` }), el('td', { textContent: c.name }), el('td', { textContent: `root ${c.rootTone}` }),
      el('td', { textContent: c.offsetCents ? `${c.offsetCents >= 0 ? '+' : ''}${c.offsetCents.toFixed(1)}¢` : '' })));
    // the clean view: the root; Details: baseHz, modulation, the retunes and each bar's root and offset (C5)
    return el('div', {}, el('div', { className: 'ctab-readouts' }, el('span', {}, 'root ', el('b', { textContent: k.root })), el('span', { className: DETAIL }, 'baseHz ', el('b', { textContent: k.baseHz.toFixed(2) })),
      el('span', { className: DETAIL }, 'modulation ', el('b', { textContent: k.modulation ? 'on' : 'off' })), el('span', { className: DETAIL }, 'retunes ', el('b', { textContent: String(s.modulations.length) }))),
    el('table', { className: `ctab-decisions-table ${DETAIL}` }, ...rows));
  }

  // ── the context (STEP 4e): the selected cell ──
  const ctxHead = (title, ...kids) => el('div', { className: 'ctab-ctx-head' }, el('b', { textContent: title }), ...kids);
  const retuneNote = () => {
    const r = retuneRanges(core.retunedBars());
    return r.length ? el('span', { className: 'ctab-retune', textContent: `↻ retunes ${r.map(barsLabel).join(', ')}`, title: 'a swap\'s modulation re-pitches these later bars (their notes stay)' }) : null;
  };
  /** the audition's footer: what is being heard, Keep, Revert */
  function auditionBar() {
    const st = audition.state, playing = tab.state.status === 'playing';
    const text = st === 'pending' ? 'auditioning from the next bar…' : st === 'live' ? `auditioning${playing ? '' : ' (applied now: not performing)'} — click it again, or Keep` : playing ? 'click an alternate to hear it from the next bar' : 'click an alternate to try it (Perform to hear it live)';
    return el('div', { className: `ctab-audition${st !== 'idle' ? ' on' : ''}` }, el('span', { className: 'ctab-muted', textContent: text }),
      button('Keep', 'ctab-btn ctab-keep ctab-ctx-action', 'keep the alternate (one undo step)', () => audition.keep().then(said), { disabled: st === 'idle' }),
      button('Revert', 'ctab-btn ctab-revert', 'back to what played before (Esc); no redo step is left', () => audition.revert().then(said), { disabled: st === 'idle' }));
  }
  /** the last edit, said: changed bars, retunes, a failure */
  function editNote() {
    const r = audition.result ?? lastEdit;
    if (!r) return null;
    if (r.ok === false && !r.empty) return el('div', { className: 'ctab-editnote amber', textContent: `couldn't apply it: ${r.error ?? 'no change'}` });
    if (r.superseded || r.noop || r.empty || r.pending) return null;
    const parts = [];
    if (r.changedBars?.length) parts.push(`changed ${barsLabel({ from: Math.min(...r.changedBars), to: Math.max(...r.changedBars) })}`);
    if (r.retunedBars?.length) parts.push(`retunes ${retuneRanges(r.retunedBars).map(barsLabel).join(', ')}`);
    // phase L: a chord swap re-reads the clave under the new frame (phase I, P20): the comp and the perc moved there
    if (r.reclavedBars?.length) parts.push(`the clave re-read in ${r.reclavedBars.length === 1 ? `bar ${r.reclavedBars[0] + 1}` : `bars ${r.reclavedBars.map((k) => k + 1).join(', ')}`} (its new frame)`);
    if (r.silentCells?.length) parts.push(`${r.silentCells.length} silent cell${r.silentCells.length === 1 ? '' : 's'} (no onset there)`);
    return parts.length ? el('div', { className: 'ctab-editnote', textContent: parts.join(' · ') }) : null;
  }
  /** bar k's chords: one, or each chord of a chart's split bar in turn (CHART_ORDER.md P10); the audition bar once; phase H:
   *  the Close | Led switch under the first head */
  function chordsContext(bar) {
    const units = core.unitsOfBar(bar), voiced = ([head, ...rest]) => [head, voicingRow(), ...rest];
    if (units.length === 1) { const one = voiced(chordUnitContext(units[0], `Bar ${bar + 1} · Chords`)); return core.alternatesOf(units[0], 'chords') ? [...one, auditionBar(), editNote()] : [...one, editNote()]; }
    return [...voiced(units.flatMap((u, i) => chordUnitContext(u, `Bar ${bar + 1} · chord ${i + 1} of ${units.length}`, i > 0))), auditionBar(), editNote()];
  }
  /** Phase H: the chords' Close | Led (live, one undo step) and, while led, the voicing's stats in the clave line's quiet style */
  function voicingRow() {
    const v = core.voicingOf(), led = v.voicing === 'led', s = v.stats, set = (x) => doEdit(() => core.setVoicing(x));
    const sw = el('div', { className: 'ctab-arp-switch ctab-voicing-switch', title: 'Close: every chord root position, stacked from an octave under its root · Led: the octaves that move least round the whole loop, the last chord back to the first included' },
      button('Close', `ctab-seg ctab-voicing-close${led ? '' : ' on'}`, 'the old voicing: root position, stacked close from an octave under the root (the bar lines can lurch an octave): live, no re-compose', () => set('close')),
      button('Led', `ctab-seg ctab-voicing-led${led ? ' on' : ''}`, 'voice-led (the default): every chord\'s octaves chosen together, so the loop moves least, each change weighed the same (the last chord back to the first too), clear of the mud limit: live, no re-compose', () => set('led')));
    sw.setAttribute('role', 'group');
    // phase L (rule 8, phase K): the loop is closed, so the motion is a change's, the wrap one of them
    const said = led ? (s ? (s.chords > 1 ? `${s.lifted} lifted · ${s.meanMotion}¢ a change · loop closed` : `${s.lifted} lifted · one chord`) : '') : 'root position';
    return el('div', { className: 'ctab-row ctab-voicing', title: led && s ? voicingTitle(s) : 'close: the voicing before phase F' },
      el('span', { className: 'ctab-muted', textContent: 'voicing' }), sw, said ? el('span', { className: 'ctab-muted ctab-voicing-stats', textContent: said }) : null);
  }
  /** phase L: the led voicing's stats in words (phase K's closed loop: the wrap led like every change) */
  function voicingTitle(s) {
    if (s.chords <= 1) return `led: one chord, so no wrap and nothing to lead; the mud limit lifted ${s.lifted} of 1`;
    return `led, the loop closed: every chord's octaves chosen together, so the loop's motion is least, each change weighed the same, the last chord back to the first included; `
      + `the mud limit lifted ${s.lifted} of ${s.chords} chords${s.muddy ? `, ${s.muddy} left muddy` : ''}; ${s.meanMotion}¢ of motion a change over the loop's ${s.chords} changes, `
      + `${s.motion}¢ at the bar lines and the wrap back to the first chord ${s.wrap}¢ (led, as every change)`;
  }
  /**
   * Phase H: the bass's Density and Lands on (a lock refused disabled, its reason its title and said under the switch),
   * live, one undo step each (a change drops the bar picks); then bar k's runner-ups (up to 8, by contour and band, the
   * one playing marked), auditioned from the next bar, kept (one undo step: setBass's picks) or reverted as the lead's.
   * Phase L (Amendment 1): Roots' runner-ups in the same list (the root's other in-frame notes, named by the tone each
   * plays); under a lock the bar's hits covered and any missed (amber); a walk that can't fill says how far it walks.
   * Details: the stats, each line's cost a note, its notes and motion. → [elements]
   */
  function bassBlock(bar) {
    const b = core.bassOf(), set = (x) => doEdit(() => core.setBass(x));
    const density = el('select', { className: 'ctab-bass-density', title: 'the density: how many notes the bass plays (live, no re-compose)' },
      ...b.densities.map((d) => el('option', { value: d, textContent: BASS_DENSITY_LABELS[d], title: BASS_DENSITY_TITLES[d] })));
    density.value = b.density;
    density.addEventListener('change', () => set({ density: density.value }));
    const lock = el('div', { className: 'ctab-arp-switch ctab-bass-lock', title: 'what the bass covers: Free nothing (it lands anywhere) · Kick every kick · Clave every comp stroke; the density adds the rest' },
      ...b.locks.map((x) => button(BASS_LOCK_LABELS[x.id], `ctab-seg ctab-bass-${x.id}${b.lock === x.id ? ' on' : ''}${x.refusal ? ' refused' : ''}`, x.refusal ?? `${BASS_LOCK_TITLES[x.id]}: live, no re-compose`, () => set({ lock: x.id }), { disabled: !!x.refusal })));
    lock.setAttribute('role', 'group');
    const out = [el('div', { className: 'ctab-row ctab-bass' }, el('span', { className: 'ctab-muted', textContent: 'density' }), density, el('span', { className: 'ctab-muted', textContent: 'lands on' }), lock)];
    const refusals = b.locks.filter((x) => x.refusal && x.id !== b.lock).map((x) => `${BASS_LOCK_LABELS[x.id]}: ${x.refusal}`);
    if (b.refused) out.push(el('div', { className: 'ctab-muted ctab-bass-refused', textContent: `${BASS_LOCK_LABELS[b.lock]} can't land now (${b.refused}), so the bass lands anywhere` }));
    if (refusals.length) out.push(el('div', { className: 'ctab-muted ctab-bass-refusal', textContent: refusals.join(' · ') }));
    const st = b.stats;
    if (st) out.push(el('div', { className: `ctab-muted ctab-bass-stats ${DETAIL}`, textContent: `${st.notes} note${st.notes === 1 ? '' : 's'} · ${st.perBar.toFixed(1)} a bar · ${st.rooted} of ${st.bars} rooted · ${st.onDown} on the one${st.fallback ? ` · ${st.fallback} fell back` : ''}${st.rests ? ` · ${st.rests} resting` : ''}`
        + `${st.hits != null ? ` · ${st.hits - st.missedHits} of ${st.hits} hits covered` : ''}${st.walkFill ? ` · ${st.walkFill} walk${st.walkFill === 1 ? 's' : ''} what ${st.walkFill === 1 ? 'it' : 'they'} can` : ''}`,
      title: `${BASS_DENSITY_LABELS[st.density]}, ${BASS_LOCK_LABELS[st.lock]}: ${st.mined} bar${st.mined === 1 ? '' : 's'} mined${st.hits != null ? `, ${st.hits} hit${st.hits === 1 ? '' : 's'} to cover (${st.missedHits} missed: no onset in frame)` : ''}`
        + `${st.walkFill ? `, ${st.walkFill} bar${st.walkFill === 1 ? '' : 's'} walking less than full (${st.walkFillNotes} notes)` : ''}${st.weakTies ? `, ${st.weakTies} mined only with weak ties` : ''}` }));
    out.push(el('div', { className: `ctab-muted ${DETAIL}`, textContent: `re-mined with its chord at this density and lock: swap bar ${bar + 1}'s chord to move it` }));
    if (b.pending) return [...out, el('div', { className: 'ctab-muted ctab-bass-none', textContent: 'the bar\'s bass lines are on their way from the worker…' })];
    const rec = b.bars?.[bar], sub = el('div', { className: 'ctab-sub ctab-bass-sub', textContent: `Bass lines · bar ${bar + 1}` });
    const said = [...bassHitsLine(rec, st?.lock, bar), ...bassFillLine(rec)];
    if (!rec?.alternates?.length) return [...out, ...said, sub, el('div', { className: 'ctab-muted ctab-bass-none', textContent: BASS_HOW_WORDS[rec?.how] ?? 'no bass lines for this bar' })];
    const roots = rec.alternates[0].band === 'roots', S = tab.state.spec.knobs.slotsPerBar;
    const rows = rec.alternates.map((x, i) => {
      const k = `bass:${bar}:${x.id}`, trying = audition.key === k, current = x.id === rec.picked;
      // phase L (rule 9): a Roots runner-up is the root's other note in frame, named by the tone it plays and its slot (two
      // onsets of a tone in different slots are two runner-ups); the slot alone when the row is the worker's
      const slots = x.notes.map((n) => n.slot - bar * S + 1), tones = roots ? x.notes.map((n) => core.ratioOfOnset(n.node)) : [];
      const name = roots ? x.notes.map((n, j) => (tones[j] != null ? `${tones[j]}, slot ${slots[j]}` : `slot ${slots[j]}`)).join(' · ') : `${x.contour} · ${x.band}`;
      const title = roots
        ? `${i === 0 ? 'Roots\' own note (the default)' : `ranked ${i + 1} of ${rec.alternates.length}`}: ${name}, ${x.n} note${x.n === 1 ? '' : 's'} at slot ${slots.join(', ')} of the bar, ${x.distance.toFixed(2)} slot${x.distance === 1 ? '' : 's'} off the change${x.rooted ? '' : ' (not on the root\'s class)'}`
        : `${i === 0 ? 'the bar\'s best line (the default)' : `ranked ${i + 1} of ${rec.alternates.length}`}: ${name}, ${x.n} note${x.n === 1 ? '' : 's'}${x.rooted ? ', opening on the root' : ''}${x.motion ? `, ${x.motion} motion` : ''}, cost ${x.perNote.toFixed(4)} a note`;
      const btn = el('button', { className: `ctab-alt ctab-bass-alt${roots ? ' ctab-bass-root' : ''}${current ? ' current' : ''}${i === 0 ? ' composed' : ''}${trying ? ' auditioning' : ''}`, title },
        el('span', { className: 'ctab-alt-mark', textContent: `${current ? '●' : ''}${i === 0 ? 'C' : ''}` }), el('b', { className: 'ctab-alt-name', textContent: name }),
        ...(roots
          ? [el('span', { className: `ctab-alt-cents ${DETAIL}`, textContent: `${x.distance.toFixed(2)} off` })]
          : [el('span', { className: `ctab-alt-ratio ${DETAIL}`, textContent: `${x.perNote.toFixed(3)}/note` }), el('span', { className: `ctab-alt-cents ${DETAIL}`, textContent: `${x.n} note${x.n === 1 ? '' : 's'}` }),
            el('span', { className: `ctab-alt-support ${DETAIL}`, textContent: x.motion ?? '' })]));
      btn.dataset.key = k;
      btn.addEventListener('click', () => audition.tryAlt(k, () => core.pickBass(bar, x.id), name));
      return btn;
    });
    return [...out, ...said, sub, rec.missed != null ? el('div', { className: 'ctab-muted ctab-bass-missed', textContent: 'the line picked here is gone (its chord changed): the bar\'s best plays' }) : null,
      el('div', { className: `ctab-muted ctab-legend ${DETAIL}`, textContent: roots ? '● plays now · C Roots\' own note · the root\'s other notes in frame, nearest the change first' : '● plays now · C the bar\'s best · cost a note: lower is closer to the rules' }),
      el('div', { className: 'ctab-alts ctab-bass-alts' }, ...rows), auditionBar()].filter(Boolean);
  }
  /** phase L (rule 7): a locked bar's hits covered ("covers 3 of 4 kicks"), the missed ones in amber (no onset in frame
   *  there, so the slot rests) → [element] | [] (Free, or no record) */
  function bassHitsLine(rec, lock, bar) {
    if (rec?.hits == null || !BASS_HIT_WORDS[lock]) return [];
    const [one, many] = BASS_HIT_WORDS[lock], n = rec.hits, missed = rec.missedHits ?? 0, S = tab.state.spec.knobs.slotsPerBar;
    if (!n) return [el('div', { className: 'ctab-muted ctab-bass-hits', textContent: `no ${one} in this bar: nothing to cover` })];
    const slots = (rec.missedSlots ?? []).map((j) => +(j - bar * S + 1).toFixed(2));
    return [el('div', { className: 'ctab-muted ctab-bass-hits', title: `the lock covers its hits (rule 7, Avery): every ${one} in this bar gets a bass note on one of its onsets in frame, and the density adds the rest` },
      `covers ${n - missed} of ${n} ${n === 1 ? one : many}`,
      missed ? el('span', { className: 'ctab-bass-missed-hits', textContent: ` · ${missed} missed (slot ${slots.join(', ')}): no onset in frame there, so ${missed === 1 ? 'it rests' : 'they rest'}` }) : null)];
  }
  /** phase L (rule 5): a walk that can't fill its clock says how far it walks ("walks 6 of 8: a rest where no step
   *  fits") → [element] | [] */
  function bassFillLine(rec) {
    if (rec?.walkFill == null) return [];
    const full = walkClock(tab.state.spec.knobs.slotsPerBar) - (rec.missedHits ?? 0);
    return [el('div', { className: 'ctab-muted ctab-bass-fill', title: 'Walking fills what it can (rule 5, Avery): no walk sounds every slot here, so it walks the most notes it can, stepwise, still approaching the next chord\'s root' },
      `walks ${rec.walkFill} of ${full}: a rest where no step fits`)];
  }
  /** chord u's alternates (u: its index in spec.chords; a bar's, unless a chart splits it) */
  function chordUnitContext(u, title, more = false) {
    const bar = u, s = tab.state.spec, ch = s.chords[bar], a = core.alternatesOf(bar, 'chords'), e = tab.state.edits?.chords?.[bar];
    const head = ctxHead(title, el('span', { className: 'ctab-muted' }, ch.empty ? 'an empty bar' : `now ${ch.name}`, ch.empty ? null : el('span', { className: DETAIL, textContent: ` · root ${ch.rootTone} · ${qualityName(ch.quality)}` })),
      e ? el('span', { className: 'ctab-tag', textContent: e.from === 'typed' ? `typed${e.asked && e.asked !== e.quality ? ` (asked ${qualityName(e.asked)})` : ''}` : 'swapped' }) : null, more ? null : retuneNote());
    if (!a) return [head, el('span', { className: 'ctab-muted', textContent: 'no alternates for this chord (Compose kept none)' })];
    const key = (c) => `chord:${bar}:${c.root.ratio}:${c.quality}`;
    const list = el('div', { className: 'ctab-alts' }, ...a.candidates.map((c) => {
      const r = candidateRow(c), k = key(c), trying = audition.key === k;
      const b = el('button', { className: `ctab-alt${r.current ? ' current' : ''}${r.composed ? ' composed' : ''}${trying ? ' auditioning' : ''}`, title: r.title },
        el('span', { className: 'ctab-alt-mark', textContent: `${r.current ? '●' : ''}${r.composed ? 'C' : ''}` }), el('b', { className: 'ctab-alt-name', textContent: r.name }),
        el('span', { className: `ctab-alt-ratio ${DETAIL}`, textContent: r.ratio }), el('span', { className: `ctab-alt-cents ${DETAIL}`, textContent: r.cents }), el('span', { className: 'ctab-alt-q', textContent: r.quality }),
        el('span', { className: `ctab-alt-support${r.amber ? ' amber' : ''} ${DETAIL}`, textContent: r.support }));
      b.dataset.key = k;
      b.addEventListener('click', () => audition.tryAlt(k, () => core.swapChord(bar, c), r.name));
      return b;
    }));
    const notes = [];
    if (a.currentIndex < 0 && !ch.empty) notes.push(el('div', { className: 'ctab-muted', textContent: `plays ${ch.name}, which isn't among Compose's candidates (typed)` }));
    if (a.pinned) notes.push(el('div', { className: 'ctab-muted', textContent: 'a pinned bar: its candidates keep the asked root' }));
    return [head, more ? null : el('div', { className: `ctab-muted ctab-legend ${DETAIL}`, textContent: '● plays now · C Compose\'s · ✓ holds the lead\'s strong notes' }), list, ...notes].filter(Boolean);
  }
  /** MIDI targets (B3): a target's lead cell is the clip's phrase: its notes, their kinds, its lattice (no lead swaps, P6) */
  function clipContext(bar) {
    const s = tab.state.spec, c = tab.cell(), S = s.knobs.slotsPerBar, p = s.target.placement;
    const ph = p.phrases.find((x) => bar >= x.from && bar < x.from + x.bars) ?? p.phrases[0];
    const marks = clipMarks(s).filter((m) => m.step >= c.from * S && m.step < c.to * S);
    const byClip = new Map((tab.state.parts.lead?.notes ?? []).map((n) => [n.clipNote, n]));
    const head = ctxHead(`${c.to - c.from > 1 ? `Bars ${c.from + 1}–${c.to}` : `Bar ${c.from + 1}`} · Lead (the clip)`, el('span', { className: 'ctab-tag ctab-clip-tag', textContent: s.target.clip.name }));
    const lattice = el('div', { className: `ctab-muted ${DETAIL}`, textContent: `this phrase's lattice: ${ph.psiRatio} (lane +${ph.k}), the tonic at ${ph.tonicCents.toFixed(1)}¢${ph.driftCents ? `, drifted ${ph.driftCents >= 0 ? '+' : '−'}${Math.abs(ph.driftCents).toFixed(1)}¢` : ''}` });
    const rows = marks.map((m) => {
      const n = byClip.get(m.j);
      const tr = el('tr', { className: `ctab-clip-note ${m.kind}${m.late ? ' late' : ''}`, title: `clip note ${m.j + 1}: ${noteName(m.midi)} at bar ${Math.floor(m.step / S) + 1}, step ${(m.step % S) + 1} — ${KIND_WORDS[m.kind]}${m.late ? '; its note-off found no onset near its anchor (late)' : ''}` },
        el('td', { textContent: noteName(m.midi) }), el('td', { textContent: `${Math.floor(m.step / S) + 1}.${(m.step % S) + 1}` }), el('td', { className: 'ctab-clip-kind', textContent: m.kind }),
        el('td', { textContent: n ? n.ratio : '—' }), el('td', { textContent: m.dev == null ? '' : `${m.dev >= 0 ? '+' : '−'}${Math.abs(m.dev).toFixed(1)}¢` }), el('td', { textContent: m.late ? 'late off' : '' }));
      tr.dataset.clipNote = String(m.j);
      return tr;
    });
    return [head, arpControls('lead'), lattice,
      el('div', { className: `ctab-muted ctab-legend ${DETAIL}`, textContent: 'hit · amber: played off the frame (fringe) or a slot over (shift) · red: silent (the row has no onset of its class there) · late off: its end found no onset near its anchor' }),
      rows.length ? el('table', { className: 'ctab-decisions-table ctab-notes ctab-clip-notes' }, el('tr', {}, ...['note', 'bar.step', 'kind', 'ratio', 'dev', ''].map((h) => el('td', { textContent: h }))), ...rows)
        : el('div', { className: 'ctab-muted', textContent: 'no clip notes in this phrase' }),
      el('div', { className: 'ctab-muted', textContent: 'no lead alternates: the lead is the clip (its other placements are in the MIDI clip control)' })];
  }
  /**
   * B3 (Q8): the Line | Arp switch of the lead or the inner, and with Arp its Time (M5); Details: the rests, the share
   * of chord tones and the phrases mined. Refused (a MIDI target's lead): the switch disabled, arpRefusal's words its
   * title.
   */
  function arpControls(id) {
    const a = core.arpOf(id), refused = a.refusal, on = a.mode === 'arp' && !refused;
    const set = (x) => doEdit(() => core.setArp(id, x));
    const lineTitle = refused ?? (id === 'lead' ? 'the mined line: the melody Compose found (its runner-ups to audition)' : 'the mined inner line, in the lead\'s gaps');
    const arpTitle = refused ?? `an arpeggio mined over the chords, each note an onset the row plays: live, no re-compose${id === 'inner' ? ' (the harp, unless you chose a sound)' : ''}`;
    const sw = el('div', { className: `ctab-arp-switch${refused ? ' refused' : ''}`, title: refused ?? 'Line: the mined line · Arp: an arpeggio over the chords' },
      button('Line', `ctab-seg ctab-arp-line${on ? '' : ' on'}`, lineTitle, () => set({ mode: 'line' }), { disabled: !!refused }),
      button('Arp', `ctab-seg ctab-arp-on${on ? ' on' : ''}`, arpTitle, () => set({ mode: 'arp' }), { disabled: !!refused }));
    sw.setAttribute('role', 'group');
    const kids = [sw];
    if (on) {
      const pick = (cls, title, options, value, onPick) => {
        const sel = el('select', { className: cls, title }, ...options.map(([v, label, t, off]) => el('option', { value: String(v), textContent: label, ...(t ? { title: t } : {}), ...(off ? { disabled: true } : {}) })));
        sel.value = String(value);
        sel.addEventListener('change', () => onPick(sel.value));
        return sel;
      };
      kids.push(pick('ctab-arp-time', 'the time: the anchors the arp is mined over, × the slots a bar (each note still sounds at its own onset\'s time)',
        ARP_CHOICES.times.map((t) => [t, ARP_TIME_LABELS[t], a.times.includes(t) ? ARP_TIME_TITLES[t] : `${ARP_TIME_TITLES[t]}: past the 32 anchors a phrase holds at this many slots a bar`, !a.times.includes(t)]), a.time, (v) => set({ time: Number(v) })));
      const st = a.stats;
      if (st) kids.push(el('span', { className: `ctab-muted ctab-arp-stats ${DETAIL}`, textContent: `${st.rests} rest${st.rests === 1 ? '' : 's'} of ${st.anchors} · ${Math.round(100 * st.chordShare)}% chord tones · ${st.mined} of ${st.phrases} phrase${st.phrases === 1 ? '' : 's'} mined`,
        title: `${st.notes} notes over ${st.anchors} anchors (×${st.time}); a phrase the miner finds nothing for is walked (the chord tone the row sounds first in each step)${st.walked ? `: ${st.walked} walked` : ''}${st.onLead != null ? `; ${st.onLead} on an anchor where the lead sounds` : ''}` }));
    }
    return el('div', { className: 'ctab-row ctab-arp' }, ...kids);
  }
  /**
   * Phase E: the phrase holding bar k of a part playing as an arp — its ranked arps by contour and band, the one playing
   * marked (C: the best-ranked, the default), each auditioned from the next bar, kept (one undo step: setArp's picks)
   * or reverted as the runner-ups are; a walked phrase says so and offers nothing. Details: each arp's cost a note, its
   * share of chord tones and its notes. → [elements]
   */
  function arpPicker(id, bar) {
    const a = core.arpOf(id);
    if (!a.playing || !a.phrases) return [];
    const p = a.phrases.findIndex((x) => bar >= x.from && bar < x.from + x.bars);
    if (p < 0) return [];
    const ph = a.phrases[p], span = barsLabel({ from: ph.from, to: ph.from + ph.bars - 1 });
    const sub = el('div', { className: 'ctab-sub ctab-arp-sub', textContent: `Arps · phrase ${p + 1}`, title: `phrase ${p + 1}: ${span}, mined over ${ph.anchors} anchors (×${a.stats?.time ?? a.time})` });
    if (ph.walked) return [sub, el('div', { className: 'ctab-muted ctab-arp-walked', textContent: 'walked: nothing could be mined here, so it plays the chord tones as the row sounds them — no arp to pick' })];
    const rows = ph.alternates.map((x, i) => {
      const k = `arp:${id}:${p}:${x.id}`, trying = audition.key === k, current = x.id === ph.picked, name = `${x.contour} · ${x.band}`, share = x.n ? Math.round((100 * x.chordTones) / x.n) : 0;
      const b = el('button', { className: `ctab-alt ctab-arp-alt${current ? ' current' : ''}${i === 0 ? ' composed' : ''}${trying ? ' auditioning' : ''}`,
        title: `${i === 0 ? 'the best-ranked arp (the default)' : `ranked ${i + 1} of ${ph.alternates.length}`}: ${name}, ${x.n} notes, cost ${x.perNote.toFixed(4)} a note, ${share}% chord tones` },
        el('span', { className: 'ctab-alt-mark', textContent: `${current ? '●' : ''}${i === 0 ? 'C' : ''}` }), el('b', { className: 'ctab-alt-name', textContent: name }),
        el('span', { className: `ctab-alt-ratio ${DETAIL}`, textContent: `${x.perNote.toFixed(3)}/note` }), el('span', { className: `ctab-alt-cents ${DETAIL}`, textContent: `${share}% chord` }),
        el('span', { className: `ctab-alt-support ${DETAIL}`, textContent: `${x.n} notes` }));
      b.dataset.key = k;
      b.addEventListener('click', () => audition.tryAlt(k, () => core.pickArp(id, p, x.id), name));
      return b;
    });
    return [sub, ph.missed != null ? el('div', { className: 'ctab-muted amber ctab-arp-missed', textContent: 'the arp picked here is gone (its chords changed): the best-ranked plays' }) : null,
      el('div', { className: `ctab-muted ctab-legend ${DETAIL}`, textContent: '● plays now · C the best-ranked · cost a note: lower is closer to the rules' }),
      el('div', { className: 'ctab-alts ctab-arp-alts' }, ...rows), auditionBar()].filter(Boolean);
  }
  /** phase L (P21): the comp cell's head shows the bar's own clave (a frame clave's pattern changes with the chord), and
   *  in Fill the partner's bar beside it, the strokes the comp plays → an element | null (no clave: a comp in notes) */
  function compHeadClave(bar) {
    const c = core.claveOf();
    if (!c) return null;
    const own = c.barTexts[bar] ?? '', fill = c.relation === 'fill', theirs = c.partner.barTexts[bar] ?? '';
    return el('span', { className: 'ctab-clave-bar', title: `bar ${bar + 1}'s clave: ${own}${c.frame ? ' (read from the frame: it changes with the chord)' : ''}, ${c.source || 'asked'}${fill ? `; in Fill the comp strikes its gaps, ${theirs}` : ''}` },
      el('code', { className: 'ctab-clave-pattern ctab-clave-bar-own', textContent: own }),
      fill ? el('span', { className: 'ctab-muted', textContent: ' fill ' }) : null, fill ? el('code', { className: 'ctab-clave-pattern ctab-clave-bar-fill', textContent: theirs }) : null);
  }
  /**
   * Phase E: the comp's clave — its pattern (monospace, a bar a group) and its source, Sync | Fill (live, one undo
   * step), and the claves to choose from (the mined top 12, then the curated), auditioned from the next bar, kept or
   * reverted as a chord's alternates are. Details: the score and its terms, the tone set, the partner Fill strikes.
   * Phase L: a frame candidate is listed by its source and score (its bars' patterns in Details), a curated clave read in
   * frame tagged "lands in frame only"; a clave from the pattern (claveFrom 'pattern') as phase E listed it.
   * → [elements] (none for a composition in notes)
   */
  function claveBlock() {
    const c = core.claveOf();
    if (!c) return [];
    const fill = c.relation === 'fill', setRel = (relation) => doEdit(() => core.setClave({ relation }));
    const sw = el('div', { className: 'ctab-arp-switch ctab-clave-switch', title: 'Sync: the comp strikes with the clave (and the perc) · Fill: it strikes the clave\'s gaps' },
      button('Sync', `ctab-seg ctab-clave-sync${fill ? '' : ' on'}`, 'the comp strikes the clave\'s own steps, with the perc: live, no re-compose', () => setRel('sync')),
      button('Fill', `ctab-seg ctab-clave-fill${fill ? ' on' : ''}`, `the comp strikes the clave's gaps (${c.partner.source === 'partner' ? 'its partner' : 'the complement'} ${c.partner.text}), the perc keeps the clave: live, no re-compose`, () => setRel('fill')));
    sw.setAttribute('role', 'group');
    const line = el('div', { className: 'ctab-row ctab-clave', title: `the comp's clave: ${c.text}, ${c.source || 'asked'}; ${c.strokes} stroke${c.strokes === 1 ? '' : 's'} (${c.relation})${c.silent ? `, ${c.silent} step${c.silent === 1 ? '' : 's'} silent (no onset there)` : ''}` },
      el('span', { className: 'ctab-muted', textContent: 'clave' }), el('code', { className: 'ctab-clave-pattern', textContent: c.text }), el('span', { className: 'ctab-muted ctab-clave-source', textContent: c.source || 'asked' }),
      c.edit?.id ? el('span', { className: 'ctab-tag', textContent: 'chosen' }) : null, sw);
    const t = c.terms ?? {};
    const detail = el('div', { className: `ctab-muted ctab-clave-detail ${DETAIL}`, textContent: `score ${c.score.toFixed(3)} (recurrence ${t.held?.toFixed(2)}, density ${t.density?.toFixed(2)}, fit ${t.fit?.toFixed(2)})${c.from?.set ? ` · under ${claveSetText(c.from.set)}` : ''} · Fill strikes ${c.partner.text} (${c.partner.source})` });
    const key = (x) => `clave:${x.id}`;
    const terms = (x) => `score ${x.score.toFixed(3)} (recurrence ${x.terms.held.toFixed(2)}, density ${x.terms.density.toFixed(2)}, fit ${x.terms.fit.toFixed(2)})`;
    const rows = c.alternates.map((x) => {
      const k = key(x), trying = audition.key === k, mark = el('span', { className: 'ctab-alt-mark', textContent: `${x.current ? '●' : ''}${x.composed ? 'C' : ''}` });
      const cls = `ctab-alt ctab-clave-alt${x.current ? ' current' : ''}${x.composed ? ' composed' : ''}${x.curated ? ' curated' : ''}${x.frame ? ' frame' : ''}${trying ? ' auditioning' : ''}`;
      let b;
      if (x.frame) {
        // phase L (P21): a frame candidate by its source and score; each bar's pattern (it changes with the chord) in Details
        b = el('button', { className: cls, title: `${x.source}: read from the frame, each bar's own pattern ${x.text}; ${terms(x)}` },
          mark, el('b', { className: 'ctab-alt-name ctab-clave-name', textContent: x.source }), el('span', { className: 'ctab-alt-q ctab-clave-score', textContent: x.score.toFixed(3) }),
          el('code', { className: `ctab-alt-support ctab-clave-pattern ${DETAIL}`, textContent: x.text }));
      } else {
        // a curated clave read in frame keeps its fixed steps, each landed on an in-frame onset (P18): tagged so
        b = el('button', { className: cls, title: `${x.text}: ${x.label}${x.curated ? ' (curated)' : ''}${x.inFrame ? ', its fixed steps landed on in-frame onsets only (a step with none is silent); scored as a fixed pattern, so it comes after the frame\'s claves' : ''}; ${terms(x)}${x.bars ? `, held by ${x.bars} bar${x.bars === 1 ? '' : 's'} of the table` : ''}` },
          mark, el('code', { className: 'ctab-alt-name ctab-clave-pattern', textContent: x.text }), el('span', { className: 'ctab-alt-q', textContent: x.inFrame ? x.label : x.source }),
          x.inFrame ? el('span', { className: 'ctab-tag ctab-clave-inframe', textContent: 'lands in frame only' }) : null, el('span', { className: `ctab-alt-support ${DETAIL}`, textContent: x.score.toFixed(3) }));
      }
      b.dataset.key = k;
      b.addEventListener('click', () => audition.tryAlt(k, () => core.setClave({ id: x.id }), x.frame ? x.source : x.text));
      return b;
    });
    const legend = c.read === 'frame' ? '● plays now · C Compose\'s · the frame\'s claves by score (a layer\'s strikes in frame, each bar its own pattern), then the curated, landed in frame only · score: recurrence, density, fit'
      : '● plays now · C Compose\'s · the mined claves ranked, then the curated · score: recurrence, density, fit';
    return [line, detail, rows.length ? el('div', { className: `ctab-muted ctab-legend ${DETAIL}`, textContent: legend }) : null,
      rows.length ? el('div', { className: 'ctab-alts ctab-clave-alts' }, ...rows) : null, rows.length ? auditionBar() : null].filter(Boolean);
  }
  function leadContext(bar) {
    // B3 (Q5): an arp lead hides its runner-ups; the switch brings the line back
    if (core.arpOf('lead').playing) {
      const sp = phraseSpans(tab.state.spec).find((x) => bar >= x.from && bar < x.from + x.bars) ?? { from: bar, bars: 1 };
      return [ctxHead(`${barsLabel({ from: sp.from, to: sp.from + sp.bars - 1 }).replace(/^b/, 'B')} · Lead`, el('span', { className: 'ctab-tag', textContent: 'arp' })), arpControls('lead'),
        ...arpPicker('lead', bar), el('div', { className: 'ctab-muted', textContent: 'an arpeggio over the chords: Line brings the melody back, and its runner-ups' }), editNote()];
    }
    const a = core.alternatesOf(bar, 'lead');
    if (!a) return [ctxHead(`Bar ${bar + 1} · Lead`), arpControls('lead'), el('span', { className: 'ctab-muted', textContent: 'no runner-ups for this phrase' })];
    const e = a.edit, follow = e ? !!e.chordsFollow : followPref, phrase = a.phrase;
    const head = ctxHead(`${barsLabel({ from: a.from, to: a.from + a.bars - 1 }).replace(/^b/, 'B')} · Lead (phrase ${phrase + 1})`, e ? el('span', { className: 'ctab-tag', textContent: `swapped${e.chordsFollow ? ', chords follow' : ''}${e.smooth ? ', smoothed' : ''}` }) : null, retuneNote());
    const followBtn = toggle('chords follow', follow, "on: the phrase's chords are chosen again over the new line (its chord edits give way); off (the default): the chords stay", () => {
      if (e) doEdit(() => core.swapLead(phrase, a.currentId, { chordsFollow: !follow, smooth: !!e.smooth }));
      else { followPref = !followPref; render(); }
    });
    const smooth = button(e?.smooth ? 'smoothed ✓' : 'smooth the phrase', 'ctab-btn ctab-smooth', e ? "re-mine the inner over the whole phrase (in the worker)" : "Compose's own line: its inner is already mined over the phrase", () => {
      if (e) doEdit(() => core.swapLead(phrase, a.currentId, { chordsFollow: !!e.chordsFollow, smooth: !e.smooth }));
    }, { disabled: !e || core.applying() });
    const key = (l) => `lead:${phrase}:${l.id}`;
    const list = el('div', { className: 'ctab-alts' }, ...a.lines.map((l, i) => {
      const r = lineRow(l), k = key(l), trying = audition.key === k;
      const b = el('button', { className: `ctab-alt${r.current ? ' current' : ''}${r.kept ? ' composed' : ''}${trying ? ' auditioning' : ''}`, title: r.title },
        el('span', { className: 'ctab-alt-mark', textContent: `${r.current ? '●' : ''}${r.kept ? 'C' : ''}` }), el('b', { className: `ctab-alt-name ctab-alt-rank ${CLEAN}`, textContent: `line ${i + 1}` }),
        el('b', { className: `ctab-alt-name ${DETAIL}`, textContent: r.cost }), el('span', { className: `ctab-muted ${DETAIL}`, textContent: '/note' }),
        el('span', { className: `ctab-alt-ratio ${DETAIL}`, textContent: `${r.notes} notes` }), el('span', { className: 'ctab-alt-q', textContent: r.shape }));
      b.dataset.key = k;
      // "chords follow" read when the line lands, not when it was clicked: a line held for the bar boundary takes a
      // follow pressed while it waited (the phrase's edit's, else the preference)
      const followNow = () => { const ed = tab.state.edits.lead[phrase]; return ed ? !!ed.chordsFollow : followPref; };
      b.addEventListener('click', () => audition.tryAlt(k, () => core.swapLead(phrase, l.id, { chordsFollow: followNow() }), `line ${r.cost}`));
      return b;
    }));
    return [head, arpControls('lead'), el('div', { className: 'ctab-row' }, followBtn, smooth), el('div', { className: `ctab-muted ctab-legend ${DETAIL}`, textContent: '● plays now · C Compose\'s line · cost a note: lower is closer to the rules' }), list, auditionBar(), editNote()];
  }
  function partContext(id, bar) {
    const s = tab.state.spec, ch = s.chords[bar], part = tab.state.parts[id];
    const notes = (part?.notes ?? []).filter((n) => n.bar === bar);
    const composedNotes = (tab.state.composed?.parts?.find((p) => p.id === id)?.notes ?? []).filter((n) => n.bar === bar);
    const edited = notes.map((n) => `${n.slot}:${n.node}:${n.octave}`).join() !== composedNotes.map((n) => `${n.slot}:${n.node}:${n.octave}`).join();
    const arp = !!part?.arp;   // B3: an inner in Arp
    // phase H: an arranged bass's tag says its density (and its lock, when it covers one: phase L, rule 7)
    const arranged = id === 'bass' && part?.bass ? `${part.bass.density}${part.bass.stats.lock !== 'free' ? ` · covers the ${part.bass.stats.lock === 'kick' ? 'kick' : 'clave'}` : ''}` : null;
    const head = ctxHead(`Bar ${bar + 1} · ${PART_LABELS[id]}`, arp ? el('span', { className: 'ctab-tag', textContent: 'arp' }) : arranged ? el('span', { className: 'ctab-tag', textContent: arranged }) : edited ? el('span', { className: 'ctab-tag', textContent: 're-mined' }) : null,
      id === 'comp' ? compHeadClave(bar) : null);
    const follows = el('div', { className: 'ctab-row' }, el('span', {}, ch.empty ? `bar ${bar + 1} has no chord: it plays its root's onset` : `follows bar ${bar + 1}'s chord: ${ch.name}`,
      ch.empty ? null : el('span', { className: DETAIL, textContent: ` (root ${ch.rootTone}, ${qualityName(ch.quality)})` })),
      button('the chord ▸', 'ctab-btn ctab-ctx-action', `select bar ${bar + 1}'s chord: swapping it re-mines this part's bar`, () => tab.selectCell('chords', bar)));
    const out = [head, ...(id === 'inner' ? [arpControls('inner'), ...(arp ? arpPicker('inner', bar) : [])] : []), follows, ...(id === 'bass' ? bassBlock(bar) : [])];
    if (id === 'comp') {
      // A4 (P12): the strokes, and (Details) the share of the bar's tones the row sounds near them
      const cl = compLine(part, bar);
      if (cl) out.push(el('div', { className: 'ctab-row ctab-comp-line', title: cl.title }, el('span', { textContent: cl.text }), cl.detail ? el('span', { className: `ctab-muted ${DETAIL}`, textContent: ` · ${cl.detail}` }) : null));
      const L = s.stats?.compLayer;
      if (L) out.push(el('div', { className: `ctab-muted ctab-pin ${DETAIL}`, textContent: `comp layer: ${L.layer} (${L.value}), pinned through edits (read-only; Compose's layer choice scores every bar)` }));
      out.push(...claveBlock());   // phase E: the clave, Sync | Fill, the claves to choose from
    }
    if (id === 'inner' && !arp) {
      const p = core.alternatesOf(bar, 'lead'), e = p?.edit;
      out.push(el('div', { className: 'ctab-row' }, el('span', { className: `ctab-muted ${DETAIL}`, textContent: 'the inner is re-mined bar by bar with its chord; smoothing re-mines the whole phrase (the worker)' }),
        button(e?.smooth ? 'smoothed ✓' : 'smooth the phrase', 'ctab-btn ctab-smooth', e ? 'smooth the inner over the whole phrase' : s.target ? 'no lead swaps on a MIDI target (its lead is the clip), so no smoothing' : 'available once the phrase\'s lead is swapped (the Lead row)', () => { if (e) doEdit(() => core.swapLead(p.phrase, p.currentId, { chordsFollow: !!e.chordsFollow, smooth: !e.smooth })); }, { disabled: !e || core.applying() })));
    }
    if (id === 'comp') out.push(el('div', { className: `ctab-muted ${DETAIL}`, textContent: `re-mined with its chord: swap bar ${bar + 1}'s chord to move it` }));
    out.push(notes.length ? el('table', { className: `ctab-decisions-table ctab-notes ${DETAIL}` }, el('tr', {}, ...['slot', 'ratio', 'oct', 'Hz'].map((h) => el('td', { textContent: h }))),
      ...notes.map((n) => el('tr', { title: `${noteTitle(n)}${n.borrowed ? ' — borrowed: the chord voice\'s tone, at the stroke' : ''}`, ...(n.borrowed ? { className: 'borrowed' } : {}) }, el('td', { textContent: String(n.slot) }), el('td', { textContent: n.ratio }), el('td', { textContent: String(n.octave) }), el('td', { textContent: n.hz.toFixed(1) }))))
      : el('div', { className: 'ctab-muted', textContent: 'no notes in this bar' }));
    if (id === 'comp' || id === 'bass' || arp) out.push(editNote());   // phase E: what a clave switch or an arp pick changed; phase H: a bass change
    return out;
  }
  function drumsContext(bar) {
    const g = core.drumGrid(), d = tab.state.drums, s = tab.state.spec;
    const head = ctxHead(`Bar ${bar + 1} · Drums`, el('span', { className: `ctab-muted ${DETAIL}`, textContent: `${d?.bars?.[bar]?.mode ?? ''}${d?.bars?.[bar]?.fill ? ' + fill' : ''}` }), g?.own ? el('span', { className: 'ctab-tag', textContent: `grid${tab.state.edits?.grid?.from ? ` (from ${tab.state.edits.grid.from})` : ''}` }) : null);
    const out = [head];
    if (g) {
      const silent = new Set(g.silentCells.filter((x) => x.bar === bar).map((x) => `${x.voice}:${x.place}`));
      const { m } = beatsOf(s.knobs.slotsPerBar);
      const gridEl = el('div', { className: 'ctab-steps' });
      gridEl.style.gridTemplateColumns = `48px repeat(${g.places}, 1fr)`;
      gridEl.append(el('span', {}), ...Array.from({ length: g.places }, (_, i) => el('span', { className: 'ctab-step-num', textContent: i % m === 0 ? String(i / m + 1) : '·' })));
      for (const v of DRUM_VOICES) {
        gridEl.append(el('span', { className: 'ctab-step-voice', textContent: v }));
        const line = g.grid[v][bar];
        for (let i = 0; i < g.places; i++) {
          const ch = line[i], hollow = silent.has(`${v}:${i}`);
          const b = el('button', { className: `ctab-step ${v}${ch === 'X' ? ' accent' : ch === 'x' ? ' on' : ''}${hollow ? ' silent' : ''}`, title: `${v}, place ${i + 1}: ${ch === 'X' ? 'an accent' : ch === 'x' ? 'a stroke' : 'off'}${hollow ? ' — no onset here (silent)' : ''}; click: off → x → X` });
          b.dataset.voice = v; b.dataset.place = String(i);
          b.addEventListener('click', () => doEdit(() => core.setDrumCell(bar, v, i, nextStep(ch))));
          gridEl.append(b);
        }
      }
      out.push(gridEl);
      if (silent.size) out.push(el('div', { className: 'ctab-muted ctab-silent-note', textContent: `${silent.size} step${silent.size === 1 ? '' : 's'} hollow: no onset here, so silent` }));
    }
    const mode = tab.state.drumOptions.mode;
    out.push(el('div', { className: 'ctab-sub', textContent: 'Presets' }), el('div', { className: 'ctab-presets' }, ...drumModes.map((x) => {
      const b = button(x.id, `ctab-preset${mode === x.id ? ' active' : ''}`, x.label, () => doEdit(() => (x.id === 'grid' ? core.setDrumGrid(core.drumGrid().grid) : core.applyDrumPreset(x.id))));
      b.dataset.mode = x.id;
      return b;
    })));
    const strip = primeStrip(d?.prime, s.knobs.cycleSeconds, bar, s.timeline.barStarts);
    if (strip) {
      const lane = el('div', { className: 'ctab-prime-lane' });
      const shade = el('div', { className: 'ctab-prime-bar' });
      shade.style.left = `${(100 * strip.bar.from).toFixed(2)}%`; shade.style.width = `${(100 * (strip.bar.to - strip.bar.from)).toFixed(2)}%`;
      lane.append(shade, ...strip.lights.map((l) => {
        const t = el('span', { className: `ctab-light${l.dark ? ' dark' : ''}${l.chosen ? ' chosen' : ''}${l.struck ? ' struck' : ''}`, title: `light ${l.i}${l.dark ? ': dark (no onset near it)' : ''}${l.chosen ? ', chosen by level 2' : ''}${l.struck ? ', struck' : ''}` });
        t.style.left = `${(100 * (l.x ?? l.at)).toFixed(3)}%`;
        return t;
      }));
      out.push(el('div', { className: 'ctab-sub', textContent: 'The prime partition' }), el('div', { className: 'ctab-prime' }, el('div', { className: `ctab-muted ${DETAIL}`, textContent: strip.label }), lane,
        el('div', { className: `ctab-muted ${DETAIL}`, textContent: 'each tick a level-1 light at its real time; tall: chosen by level 2 (Partitions\' distribution); bright: struck; hollow: dark. The shaded span is this bar.' })));
    } else if (mode !== 'prime') out.push(el('div', { className: `ctab-muted ${DETAIL}`, textContent: 'prime: the two-level prime partition — pick it above to see its lights' }));
    out.push(editNote());
    return out;
  }
  function contextBody() {
    const s = tab.state.spec;
    if (!s || s.refused) return [el('span', { className: 'ctab-muted', textContent: 'Compose first: then click a cell of the matrix — its alternates, its notes, its drum steps are here' })];
    const c = tab.cell();
    if (c.part === 'chords') return chordsContext(c.bar);
    if (c.part === 'lead') return s.target ? clipContext(c.bar) : leadContext(c.bar);
    if (c.part === 'drums') return drumsContext(c.bar);
    return partContext(c.part, c.bar);
  }
  function contextLabel() {
    const s = tab.state.spec;
    if (!s || s.refused) return 'Bar';
    const c = tab.cell();
    return `${c.to - c.from > 1 ? `Bars ${c.from + 1}–${c.to}` : `Bar ${c.bar + 1}`} · ${PART_LABELS[c.part]}`;
  }
  function renderInspector() {
    const id = tab.view.selected, section = tab.view.section;
    levelEls.clear();
    const swatch = el('span', { className: 'ctab-swatch' });
    swatch.style.background = PART_COLORS[id];
    const tabs = el('div', { className: 'ctab-insp-tabs' }, ...[CONTEXT_SECTION, ...SECTIONS].map((name) => {
      const b = el('button', { className: `ctab-insp-tab${name === CONTEXT_SECTION ? ' ctab-ctx-tab' : ''}${name === section ? ' active' : ''}`, textContent: name === CONTEXT_SECTION ? contextLabel() : SECTION_LABELS[name] });
      b.addEventListener('click', () => tab.setSection(name));
      return b;
    }));
    const parts = el('div', { className: 'ctab-insp-parts' }, ...HIGHLIGHT_PARTS.map((p) => {
      const b = el('button', { className: `ctab-part-pick${p === id ? ' active' : ''}`, textContent: PART_LABELS[p] });
      b.style.borderColor = PART_COLORS[p];
      b.addEventListener('click', () => tab.select(p));
      return b;
    }));
    let body;
    if (section === CONTEXT_SECTION) body = contextBody();
    else if (section === 'harmony') body = [progressionEditor(), el('div', { className: 'ctab-sub', textContent: 'Harmony' }), knobRow(KNOBS_OF.harmony)];
    else if (section === 'lines') {
      const table = field(TABLE_FIELD, tab.state.table), chosen = knobChosen(tab.state.spec, tab.state.knobs).table;
      table.addEventListener('change', () => core.setTable(table.value));
      body = [knobRow(KNOBS_OF.lines), el('div', { className: 'ctab-knobs' }, el('div', { className: `ctab-knob ${DETAIL}` }, el('label', { textContent: TABLE_FIELD.label }), table, el('span', { className: 'ctab-chosen', textContent: chosen.text })))];
    } else if (section === 'drums') body = [el('div', { className: 'ctab-row' }, el('span', { className: 'ctab-sub', textContent: 'Drums' }), ...drumControls()), el('div', { className: 'ctab-sub', textContent: 'Kit — a sound a voice (the made kit, or the site\'s samples)' }), kitRow()];
    else body = [knobRow(KNOBS_OF.tuning), tuningReadout()];
    // the body keeps its scroll while it shows the same thing (a click on the 9th alternate doesn't jump to the top)
    const where = `${section}|${id}|${tab.view.bar}`, prev = hosts.inspector.querySelector?.('.ctab-insp-body'), keep = prev && inspWhere === where ? prev.scrollTop : 0;
    const bodyEl = el('div', { className: `ctab-insp-body${section === CONTEXT_SECTION ? ' ctab-ctx' : ''}` }, ...body.filter(Boolean));
    hosts.inspector.replaceChildren(
      el('div', { className: 'ctab-insp-head' }, swatch, el('b', { className: 'ctab-insp-name', textContent: PART_LABELS[id] }), ...partControls(id)),
      parts, tabs, bodyEl);
    bodyEl.scrollTop = keep; inspWhere = where;
  }

  function render() {
    if (!ui || !hosts) return;
    renderLeft();
    renderInspector();
  }

  // ── the playhead, on the matrix and on the plot; a held audition's boundary ──
  function frame() {
    if (!shown) return;
    tab.syncRhythm();
    const at = tab.playheadAt(), v = visuals();
    // the overlay's snapshot is of the Linear Plot: on any other plot type it is never blitted
    const onLinear = !!v && v.currentPlotType === 'linear';
    const a = anim.tick();
    if (a && a.kind === 'ended') endAnimation(true);
    else if (a) {
      const selected = tab.view.selected, final = animFinal;
      if (onLinear) overlay.paint((ctx, view) => (a.kind === 'frame' ? paintFrame(ctx, view, a.frame, final, { selected }) : paintShimmer(ctx, view, a.phase)));
      if (a.kind === 'frame') applyFrame(a.frame);
    }
    audition.tick();
    if (at) {
      if (onLinear) overlay.frame(at);
      if (firstBars && playheadEl) {
        const box = ui.lanes.getBoundingClientRect(), bars = firstBars.getBoundingClientRect();
        playheadEl.style.display = 'block';
        playheadEl.style.left = `${bars.left - box.left + ui.lanes.scrollLeft + at.p * bars.width}px`;
      }
      const s = tab.state.spec, k = s ? barAt(at.t, s.timeline.barStarts) : -1;
      if (k !== nowBar) { nowBar = k; for (const list of [pickEls, headEls]) list.forEach((b, i) => b.classList.toggle('now', i === k)); }
      lastPlaying = true;
    } else if (lastPlaying) {
      lastPlaying = false;
      if (onLinear) overlay.frame(null);
      if (playheadEl) playheadEl.style.display = 'none';
      nowBar = -1; [...pickEls, ...headEls].forEach((b) => b.classList.remove('now'));
    }
    raf(frame);
  }

  tab.onChange(() => {
    if (!shown) return;
    syncAnimation();
    render();
    visuals()?.drawPlot?.();   // the lit nodes follow the spec, the parts and the selection
  });

  return {
    overlay,
    animator: anim,
    audition,
    get shown() { return shown; },
    /** STEP 4e: the keyboard handler (the document's keydown while shown), for a look */
    onKey,
    /** MIDI targets: a .mid File (or a Blob with a name) read, decoded, placed and composed, as a drop does */
    loadClip,
    undo, redo,
    /** fill the two hosts (again if the window was rebuilt) */
    mount({ left, inspector }) {
      if (hosts && hosts.left === left && hosts.inspector === inspector) return;
      for (const h of [hosts?.left, hosts?.inspector]) for (const [type, fn] of DROP_EVENTS) h?.removeEventListener?.(type, fn);
      hosts = { left, inspector };
      for (const h of [left, inspector]) for (const [type, fn] of DROP_EVENTS) h.addEventListener?.(type, fn);   // MIDI targets: a .mid dropped
      left.classList?.add('ctab-left');
      inspector.classList?.add('ctab-inspector');
      ui = buildLeft(left);
      render();
    },
    show() {
      if (!hosts) return;
      const was = shown;
      shown = true;
      tab.open();
      render();
      claimPlot();
      if (!was) {
        doc.addEventListener?.('keydown', onKey);
        doc.addEventListener?.('dragover', guardDrop); doc.addEventListener?.('drop', guardDrop);
        plotEl = doc.getElementById?.('partitions-mirror-canvas') ?? null;   // the plot as the window shows it
        plotEl?.addEventListener?.('click', onPlotClick);
        raf(frame);
      }
    },
    hide() {
      if (!shown) return;
      shown = false;
      endAnimation(false);
      doc.removeEventListener?.('keydown', onKey);
      doc.removeEventListener?.('dragover', guardDrop); doc.removeEventListener?.('drop', guardDrop);
      plotEl?.removeEventListener?.('click', onPlotClick); plotEl = null;
      tab.close();
      if (playheadEl) playheadEl.style.display = 'none';
      lastPlaying = false;
      releasePlot();
    },
    render,
  };
}
