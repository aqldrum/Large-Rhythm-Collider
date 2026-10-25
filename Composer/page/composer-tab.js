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

import { soundChoices, drumModeChoices, DRUM_LAB_VOICES, TEMPO_LIMITS } from '../perform/composer-controller.js';
import { KNOB_FIELDS, TABLE_FIELD, fieldValue, refusalText, readoutItems, knobChosen, decisionRows, rootGroups, strayRootOption, chordGot, progressionNote,
  noteTitle, modulationLabel } from '../perform/readouts.js';
import { PART_COLORS, PART_LABELS, HIGHLIGHT_PARTS, plotOf } from './plot-highlights.js';
import { SECTIONS, SECTION_LABELS, CONTEXT_SECTION } from './tab-controller.js';
import { createPlotOverlay } from './plot-overlay.js';
import { createComposeAnimator, paintFrame, paintShimmer, readShowWork, writeShowWork } from './compose-animator.js';
import { matrixModel, moveCell, nextStep, fieldStrip, candidateRow, lineRow, primeStrip, barsLabel, retuneRanges, barAt, qualityName, phraseSpans } from './matrix.js';
import { createAudition } from './audition.js';
import { arrangeDrums, gridOf, DRUM_VOICES, beatsOf } from '../core/drums.js';

const KNOBS_OF = Object.freeze({ harmony: ['modulation', 'settlePasses', 'presence'], lines: ['bars', 'slotsPerBar', 'anchors'], tuning: ['frameCentsEachSide'] });
/** the caption's names for the trace's beats */
const BEAT_NAMES = Object.freeze({ row: 'row', root: 'root', meter: 'meter', cells: 'cells', progression: 'progression', line: 'lead', chords: 'chords', line2: 'lead again',
  settle: 'settle', harmony: 'harmony', parts: 'parts', drums: 'drums', done: 'done' });
const defaultStorage = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
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
 * → { mount({ left, inspector }), show(), hide(), render(), overlay, animator, audition, shown }
 */
export function createComposerTab({ tab, doc = globalThis.document, visuals = () => globalThis.window?.lrcVisuals ?? null, raf = (f) => globalThis.requestAnimationFrame(f), makeCanvas, download, clock, storage = defaultStorage(), overlay: sharedOverlay = null, seat = null } = {}) {
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
      : el('input', { type: 'number', ...f.attrs });
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
    const undoBtn = button('↶ Undo', 'ctab-btn ctab-undo', `undo the last edit (${mod}Z): a swap, the typed field, a drum step`, () => undo());
    const redoBtn = button('↷ Redo', 'ctab-btn ctab-redo', `redo it (${isMac() ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`, () => redo());
    const work = el('button', { className: 'ctab-toggle ctab-work', textContent: 'show the work', title: 'animate Compose: the root, the lead, the chords under it, the settling and the parts, on the Linear Plot' });
    work.addEventListener('click', () => { const on = !tab.view.showWork; writeShowWork(storage, on); tab.setShowWork(on); });
    const json = el('button', { className: 'ctab-btn', textContent: 'JSON', title: 'download the spec as it plays now' });
    json.addEventListener('click', exportJSON);
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
    const note = el('div', { className: 'ctab-note' }), refusal = el('div', { className: 'ctab-refusal' }), readouts = el('div', { className: 'ctab-readouts' }), dropped = el('div', { className: 'ctab-dropped' });
    const capLabel = el('b', { className: 'ctab-caption-label' }), capDetail = el('span', { className: 'ctab-caption-detail' }), capBeats = el('div', { className: 'ctab-caption-beats' });
    const caption = el('div', { className: 'ctab-caption' }, el('div', { className: 'ctab-row' }, capLabel, capDetail), capBeats);
    caption.style.display = 'none';
    playheadEl = el('div', { className: 'ctab-playhead' });
    // the matrix: focusable, so the arrow keys and Enter reach it
    const lanes = el('div', { className: 'ctab-lanes ctab-matrix', tabIndex: 0, title: 'the matrix: click a cell, or use the arrow keys and Enter' }, playheadEl);
    lanes.setAttribute('role', 'grid');
    const barPick = el('div', { className: 'ctab-barpick' });
    const table = el('table', { className: 'ctab-decisions-table' });
    const decisions = el('details', { className: 'ctab-decisions' }, el('summary', { textContent: 'Decisions — what Compose chose, and why' }), table);
    left.replaceChildren(
      el('div', { className: 'ctab-head' },
        el('div', { className: 'ctab-row' }, rhythm, el('label', { className: 'ctab-muted', textContent: 'Seed' }), seed, go, undoBtn, redoBtn, json, work, status),
        el('div', { className: 'ctab-row' }, el('label', { className: 'ctab-muted', textContent: 'Tempo', title: 'playback tempo: the composed cycle faster or slower, live (pitch unchanged)' }), tempo, tempoBpm, tempoReset,
          el('label', { className: 'ctab-muted', textContent: 'Glide' }), glide, glideOut)),
      note, refusal, dropped, caption, readouts,
      el('div', { className: 'ctab-scroll' }, barPick, el('div', { className: 'ctab-matrix-wrap' }, lanes), decisions));
    // a click anywhere in the tab skips the animation (the button and the toggle do their own thing)
    left.addEventListener('click', (e) => { if (anim.status === 'playing' && !e.target?.closest?.('.ctab-go, .ctab-work')) skipAnimation(); });
    return { seed, go, undoBtn, redoBtn, json, work, tempo, tempoBpm, tempoReset, glide, glideOut, rhythm, status, note, refusal, dropped, caption, capLabel, capDetail, capBeats, readouts, lanes, barPick, table };
  }
  function showTempo() {
    if (!ui) return;
    const bpm = core.tempo(), spec = core.specTempo(), off = bpm == null;
    for (const e of [ui.tempo, ui.tempoBpm, ui.tempoReset]) e.disabled = off;
    if (off) { ui.tempoBpm.value = ''; return; }
    ui.tempo.value = bpm;
    if (doc.activeElement !== ui.tempoBpm) ui.tempoBpm.value = Number(bpm.toFixed(1));
    ui.tempoBpm.classList.toggle('changed', Math.abs(bpm - spec) > 1e-9);
  }
  function exportJSON() {
    if (!tab.state.spec) return;
    const name = `composer-${tab.state.input.layers.filter(Boolean).join('-')}-seed${tab.state.input.seed}.json`;
    if (download) { download(name, core.exportJSON()); return; }
    const blob = new Blob([core.exportJSON()], { type: 'application/json' }), a = el('a', { href: URL.createObjectURL(blob), download: name });
    doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
    return out;
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
    ui.dropped.replaceChildren(...drop.map((t) => el('div', { textContent: t })));
    ui.dropped.style.display = drop.length ? '' : 'none';
    ui.readouts.replaceChildren(...readoutItems(s, { lastMs: tab.state.lastMs, drums: tab.state.drums }).map(([k, val]) => el('span', {}, `${k} `, el('b', { textContent: val }))));
    ui.table.replaceChildren(...decisionRows(s, tab.state.drums).map((d) => el('tr', {}, el('td', { textContent: d.what }), el('td', { textContent: d.value }), el('td', { textContent: d.why }))));
    renderMatrix();
    showTempo();
  }

  // ── the matrix (STEP 4e) ──
  /** the grid of the drums as the mode the entry's grid came from plays them: the "edited" marks' reference */
  function composedGridOf(st) {
    if (!st.drumOptions.grid || !(st.drumOptions.mode === 'grid' || st.drumOptions.mode === 'prime')) return null;
    const { grid, ...rest } = st.drumOptions, from = st.edits?.grid?.from ?? 'backbeat';
    try { return gridOf(arrangeDrums(st.spec, { ...rest, mode: from === 'grid' ? 'backbeat' : from })); } catch { return null; }
  }
  const alternatesCount = (bar, part) => {
    if (part === 'chords') { const a = core.alternatesOf(bar, 'chords'); return a ? a.candidates.filter((c) => !c.current).length : 0; }
    if (part === 'lead') { const a = core.alternatesOf(bar, 'lead'); return a ? a.lines.filter((l) => !l.current).length : 0; }
    return 0;
  };
  /** the typed field's input: ONE element for the tab's life (a re-render moves it, never drops what is being typed) */
  let fieldInput = null, fieldApplied = '', rebuilding = false;
  function theFieldInput() {
    if (fieldInput) return fieldInput;
    const input = el('input', { type: 'text', className: 'ctab-field', placeholder: 'type a progression: Cmaj7 Am7 Dm7 G7 (a symbol a bar; - leaves a bar to Compose)', spellcheck: false,
      title: 'the typed progression: C is the composition\'s base root. Enter (or leaving the field) applies it; with a composition each typed bar is a live chord edit, and a pin for the next Compose' });
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
        b.detail && b.status !== 'auto' ? el('span', { className: 'ctab-res-detail', textContent: b.detail }) : null);
      cell.dataset.bar = String(k);
      return cell;
    }));
    const notes = f.resolution && !f.resolution.refused ? f.resolution.notes : [];
    const head = el('div', { className: 'ctab-lane-head ctab-field-head' }, el('span', { className: 'ctab-field-label', textContent: 'Typed', title: 'the typed progression field (decisions 3, 4)' }));
    return { row: el('div', { className: 'ctab-fieldrow' }, head, el('div', { className: 'ctab-field-wrap' }, input, res, notes.length ? el('div', { className: 'ctab-field-notes', textContent: notes.join(' · ') }) : null)), input };
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
        const dot = el('span', { className: `ctab-dot${d.accent ? '' : ' held'}` });
        dot.style.left = `${(100 * d.x).toFixed(2)}%`; dot.style.top = `${(8 + 76 * d.y).toFixed(1)}%`;
        dot.style.background = row.color;
        cell.append(dot);
      }
      if (c.part === 'chords') {
        cell.append(el('span', { className: `ctab-chord${c.targeted ? ' targeted' : ''}${c.fallback ? ' fallback' : ''}`, textContent: c.name }));
        const m = tab.state.spec.modulations.find((x) => x.bar === c.from);
        if (m) { const ml = modulationLabel(m); cell.append(el('span', { className: 'ctab-mod', textContent: ml.text, title: ml.title })); }
        if (c.retune) cell.append(el('span', { className: 'ctab-retune', textContent: `↻ retunes ${barsLabel(c.retune)}`, title: `this edit's modulation re-pitches ${barsLabel(c.retune)}: their notes stay, their tuning moves` }));
      }
    }
    if (c.badge) cell.append(el('span', { className: 'ctab-badge', textContent: String(c.badge), title: `${c.badge} alternate${c.badge === 1 ? '' : 's'}: select the cell to hear them` }));
    if (c.edited) cell.append(el('span', { className: 'ctab-edited', textContent: '✎', title: `edited${c.editKind ? `: ${c.editKind}` : ''} (not Compose's own)` }));
    cell.addEventListener('click', () => { tab.selectCell(c.part, c.from); ui?.lanes.focus?.(); });
    return cell;
  }
  function renderMatrix() {
    const typingField = !!fieldInput && doc.activeElement === fieldInput;
    rebuilding = true;
    try { buildMatrix(); } finally { rebuilding = false; }
    if (typingField && fieldInput.parentNode) fieldInput.focus();
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
      const name = el('button', { className: 'ctab-lane-name', textContent: row.label, title: `select ${row.label.toLowerCase()}: the inspector shows it` });
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
    first?.focus?.();
  }
  const onKey = (e) => {
    const a = doc.activeElement;
    if (e.key === 'Escape') {
      if (anim.status === 'playing') { e.preventDefault?.(); skipAnimation(); return; }
      if (audition.state !== 'idle' && !typing(a)) { e.preventDefault?.(); audition.revert().then(said); }
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
      const c = chosen[name];
      return el('div', { className: 'ctab-knob' }, el('label', { textContent: f.label, title: f.title || '' }), input, el('span', { className: `ctab-chosen${c.over ? ' over' : ''}`, textContent: c.text }));
    }));
  }
  function progressionEditor() {
    const rc = core.rootChoices(), roots = core.progression(), s = tab.state.spec;
    const take = el('button', { className: 'ctab-btn', textContent: 'take from last compose', title: 'fill every bar with the root the last compose chose', disabled: !s || s.refused });
    take.addEventListener('click', () => { if (core.takeProgression()) recomposeIfQuick(); });
    const clear = el('button', { className: 'ctab-btn', textContent: 'clear', title: 'every bar back to auto' });
    clear.addEventListener('click', () => { core.clearProgression(); recomposeIfQuick(); });
    const headRow = el('div', { className: 'ctab-row' }, el('span', { className: 'ctab-sub', textContent: 'Progression — a root a bar from the row; auto leaves the bar to Compose (or type chords above the Chords row)' }));
    if (!tab.view.hasRhythm) return el('div', {}, headRow, el('span', { className: 'ctab-muted', textContent: 'no rhythm yet' }));
    if (rc.refused) return el('div', {}, headRow, el('span', { className: 'ctab-muted', textContent: 'no roots: this row is refused' }));
    const opt = (o) => el('option', { value: o.value, textContent: o.text, title: o.title });
    const groups = rootGroups(rc), got = s && !s.refused && !tab.state.dirty ? s.chords : null;
    const bars = roots.map((ratio, k) => {
      const sel = el('select', { title: `bar ${k + 1}: its chord's root` }, el('option', { value: '', textContent: 'auto' }),
        el('optgroup', { label: 'most heard' }, ...groups.heard.map(opt)), el('optgroup', { label: 'all, by pitch from the root' }, ...groups.all.map(opt)));
      if (ratio && !rc.candidates.some((c) => c.ratio === ratio)) sel.prepend(opt(strayRootOption(ratio)));
      sel.value = ratio ?? '';
      sel.addEventListener('change', () => { core.setProgressionRoot(k, sel.value || null); recomposeIfQuick(); });
      const g = chordGot(got?.[k]);
      return el('div', { className: 'ctab-knob' }, el('label', { textContent: `Bar ${k + 1}` }), sel, el('span', { className: `ctab-chosen${g.over ? ' over' : ''}`, textContent: g.text }));
    });
    return el('div', {}, headRow, el('div', { className: 'ctab-knobs ctab-prog' }, ...bars), el('div', { className: 'ctab-row' }, take, clear, el('span', { className: 'ctab-muted', textContent: progressionNote(roots) })));
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
    return el('div', {}, el('div', { className: 'ctab-readouts' }, el('span', {}, 'root ', el('b', { textContent: k.root })), el('span', {}, 'baseHz ', el('b', { textContent: k.baseHz.toFixed(2) })),
      el('span', {}, 'modulation ', el('b', { textContent: k.modulation ? 'on' : 'off' })), el('span', {}, 'retunes ', el('b', { textContent: String(s.modulations.length) }))),
    el('table', { className: 'ctab-decisions-table' }, ...rows));
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
    if (r.silentCells?.length) parts.push(`${r.silentCells.length} silent cell${r.silentCells.length === 1 ? '' : 's'} (no onset there)`);
    return parts.length ? el('div', { className: 'ctab-editnote', textContent: parts.join(' · ') }) : null;
  }
  function chordsContext(bar) {
    const s = tab.state.spec, ch = s.chords[bar], a = core.alternatesOf(bar, 'chords'), e = tab.state.edits?.chords?.[bar];
    const head = ctxHead(`Bar ${bar + 1} · Chords`, el('span', { className: 'ctab-muted', textContent: ch.empty ? 'an empty bar' : `now ${ch.name} · root ${ch.rootTone} · ${qualityName(ch.quality)}` }),
      e ? el('span', { className: 'ctab-tag', textContent: e.from === 'typed' ? `typed${e.asked && e.asked !== e.quality ? ` (asked ${qualityName(e.asked)})` : ''}` : 'swapped' }) : null, retuneNote());
    if (!a) return [head, el('span', { className: 'ctab-muted', textContent: 'no alternates for this bar (Compose kept none)' })];
    const key = (c) => `chord:${bar}:${c.root.ratio}:${c.quality}`;
    const list = el('div', { className: 'ctab-alts' }, ...a.candidates.map((c) => {
      const r = candidateRow(c), k = key(c), trying = audition.key === k;
      const b = el('button', { className: `ctab-alt${r.current ? ' current' : ''}${r.composed ? ' composed' : ''}${trying ? ' auditioning' : ''}`, title: r.title },
        el('span', { className: 'ctab-alt-mark', textContent: `${r.current ? '●' : ''}${r.composed ? 'C' : ''}` }), el('b', { className: 'ctab-alt-name', textContent: r.name }),
        el('span', { className: 'ctab-alt-ratio', textContent: r.ratio }), el('span', { className: 'ctab-alt-cents', textContent: r.cents }), el('span', { className: 'ctab-alt-q', textContent: r.quality }),
        el('span', { className: `ctab-alt-support${r.amber ? ' amber' : ''}`, textContent: r.support }));
      b.dataset.key = k;
      b.addEventListener('click', () => audition.tryAlt(k, () => core.swapChord(bar, c), r.name));
      return b;
    }));
    const notes = [];
    if (a.currentIndex < 0 && !ch.empty) notes.push(el('div', { className: 'ctab-muted', textContent: `plays ${ch.name}, which isn't among Compose's candidates (typed)` }));
    if (a.pinned) notes.push(el('div', { className: 'ctab-muted', textContent: 'a pinned bar: its candidates keep the asked root' }));
    return [head, el('div', { className: 'ctab-muted ctab-legend', textContent: '● plays now · C Compose\'s · ✓ holds the lead\'s strong notes' }), list, ...notes, auditionBar(), editNote()];
  }
  function leadContext(bar) {
    const a = core.alternatesOf(bar, 'lead');
    if (!a) return [ctxHead(`Bar ${bar + 1} · Lead`), el('span', { className: 'ctab-muted', textContent: 'no runner-ups for this phrase' })];
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
    const list = el('div', { className: 'ctab-alts' }, ...a.lines.map((l) => {
      const r = lineRow(l), k = key(l), trying = audition.key === k;
      const b = el('button', { className: `ctab-alt${r.current ? ' current' : ''}${r.kept ? ' composed' : ''}${trying ? ' auditioning' : ''}`, title: r.title },
        el('span', { className: 'ctab-alt-mark', textContent: `${r.current ? '●' : ''}${r.kept ? 'C' : ''}` }), el('b', { className: 'ctab-alt-name', textContent: r.cost }), el('span', { className: 'ctab-muted', textContent: '/note' }),
        el('span', { className: 'ctab-alt-ratio', textContent: `${r.notes} notes` }), el('span', { className: 'ctab-alt-q', textContent: r.shape }));
      b.dataset.key = k;
      b.addEventListener('click', () => audition.tryAlt(k, () => core.swapLead(phrase, l.id, { chordsFollow: follow }), `line ${r.cost}`));
      return b;
    }));
    return [head, el('div', { className: 'ctab-row' }, followBtn, smooth), el('div', { className: 'ctab-muted ctab-legend', textContent: '● plays now · C Compose\'s line · cost a note: lower is closer to the rules' }), list, auditionBar(), editNote()];
  }
  function partContext(id, bar) {
    const s = tab.state.spec, ch = s.chords[bar], part = tab.state.parts[id];
    const notes = (part?.notes ?? []).filter((n) => n.bar === bar);
    const composedNotes = (tab.state.composed?.parts?.find((p) => p.id === id)?.notes ?? []).filter((n) => n.bar === bar);
    const edited = notes.map((n) => `${n.slot}:${n.node}:${n.octave}`).join() !== composedNotes.map((n) => `${n.slot}:${n.node}:${n.octave}`).join();
    const head = ctxHead(`Bar ${bar + 1} · ${PART_LABELS[id]}`, edited ? el('span', { className: 'ctab-tag', textContent: 're-mined' }) : null);
    const follows = el('div', { className: 'ctab-row' }, el('span', { textContent: ch.empty ? `bar ${bar + 1} has no chord: it plays its root's onset` : `follows bar ${bar + 1}'s chord: ${ch.name} (root ${ch.rootTone}, ${qualityName(ch.quality)})` }),
      button('the chord ▸', 'ctab-btn ctab-ctx-action', `select bar ${bar + 1}'s chord: swapping it re-mines this part's bar`, () => tab.selectCell('chords', bar)));
    const out = [head, follows];
    if (id === 'comp') {
      const L = s.stats?.compLayer;
      if (L) out.push(el('div', { className: 'ctab-muted ctab-pin', textContent: `comp layer: ${L.layer} (${L.value}), pinned through edits (read-only; Compose's layer choice scores every bar)` }));
    }
    if (id === 'inner') {
      const p = core.alternatesOf(bar, 'lead'), e = p?.edit;
      out.push(el('div', { className: 'ctab-row' }, el('span', { className: 'ctab-muted', textContent: 'the inner is re-mined bar by bar with its chord; smoothing re-mines the whole phrase (the worker)' }),
        button(e?.smooth ? 'smoothed ✓' : 'smooth the phrase', 'ctab-btn ctab-smooth', e ? 'smooth the inner over the whole phrase' : 'available once the phrase\'s lead is swapped (the Lead row)', () => { if (e) doEdit(() => core.swapLead(p.phrase, p.currentId, { chordsFollow: !!e.chordsFollow, smooth: !e.smooth })); }, { disabled: !e || core.applying() })));
    }
    if (id === 'bass' || id === 'comp') out.push(el('div', { className: 'ctab-muted', textContent: `re-mined with its chord: swap bar ${bar + 1}'s chord to move it` }));
    out.push(notes.length ? el('table', { className: 'ctab-decisions-table ctab-notes' }, el('tr', {}, ...['slot', 'ratio', 'oct', 'Hz'].map((h) => el('td', { textContent: h }))),
      ...notes.map((n) => el('tr', { title: noteTitle(n) }, el('td', { textContent: String(n.slot) }), el('td', { textContent: n.ratio }), el('td', { textContent: String(n.octave) }), el('td', { textContent: n.hz.toFixed(1) }))))
      : el('div', { className: 'ctab-muted', textContent: 'no notes in this bar' }));
    return out;
  }
  function drumsContext(bar) {
    const g = core.drumGrid(), d = tab.state.drums, s = tab.state.spec;
    const head = ctxHead(`Bar ${bar + 1} · Drums`, el('span', { className: 'ctab-muted', textContent: `${d?.bars?.[bar]?.mode ?? ''}${d?.bars?.[bar]?.fill ? ' + fill' : ''}` }), g?.own ? el('span', { className: 'ctab-tag', textContent: `grid${tab.state.edits?.grid?.from ? ` (from ${tab.state.edits.grid.from})` : ''}` }) : null);
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
      out.push(el('div', { className: 'ctab-sub', textContent: 'The prime partition' }), el('div', { className: 'ctab-prime' }, el('div', { className: 'ctab-muted', textContent: strip.label }), lane,
        el('div', { className: 'ctab-muted', textContent: 'each tick a level-1 light at its real time; tall: chosen by level 2 (Partitions\' distribution); bright: struck; hollow: dark. The shaded span is this bar.' })));
    } else if (mode !== 'prime') out.push(el('div', { className: 'ctab-muted', textContent: 'prime: the two-level prime partition — pick it above to see its lights' }));
    out.push(editNote());
    return out;
  }
  function contextBody() {
    const s = tab.state.spec;
    if (!s || s.refused) return [el('span', { className: 'ctab-muted', textContent: 'Compose first: then click a cell of the matrix — its alternates, its notes, its drum steps are here' })];
    const c = tab.cell();
    if (c.part === 'chords') return chordsContext(c.bar);
    if (c.part === 'lead') return leadContext(c.bar);
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
      body = [knobRow(KNOBS_OF.lines), el('div', { className: 'ctab-knobs' }, el('div', { className: 'ctab-knob' }, el('label', { textContent: TABLE_FIELD.label }), table, el('span', { className: 'ctab-chosen', textContent: chosen.text })))];
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
    undo, redo,
    /** fill the two hosts (again if the window was rebuilt) */
    mount({ left, inspector }) {
      if (hosts && hosts.left === left && hosts.inspector === inspector) return;
      hosts = { left, inspector };
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
      plotEl?.removeEventListener?.('click', onPlotClick); plotEl = null;
      tab.close();
      if (playheadEl) playheadEl.style.display = 'none';
      lastPlaying = false;
      releasePlot();
    },
    render,
  };
}
