// composer-tab.js — the main page's Composer tab: DOM in, DOM out, over tab-controller.js (all state and actions live
// there and in the shared controller). It fills the two hosts the Partitions window gives it (PartitionsUI.js):
//
//   left       the header (the page's rhythm and cycle, Seed, Compose → Perform ⇄ Stop, JSON, Tempo, Glide), the
//              readouts and any refusal, the track lanes (a row a part, Drums included, a column a bar, each as wide
//              as its bar lasts; click a part's name to select it), and the decisions list
//   inspector  the selected part: its sound, legato, on/off and level (for the drums: mode, fills, on/off, level),
//              then four sections: Harmony (the progression editor and the harmony knobs), Lines (the meter and the
//              table, Glide), Drums (mode, fills, the kit), Tuning (the frame, the root, baseHz, the retunes)
//
// The upper right stays the Partitions window's mirror of the Linear Plot. While the tab is shown, the plot carries the
// Composer's lit nodes (plot-overlay.js, through LRCVisuals.setComposerOverlay) and, during Perform, its playhead.

import { soundChoices, drumModeChoices, DRUM_LAB_VOICES, TEMPO_LIMITS } from '../perform/composer-controller.js';
import { KNOB_FIELDS, TABLE_FIELD, fieldValue, refusalText, readoutItems, knobChosen, decisionRows, rootGroups, strayRootOption, chordGot, progressionNote,
  barColumns, noteTitle, chordTitle, modulationLabel, drumBarLabel, drumHitTitle } from '../perform/readouts.js';
import { PART_COLORS, PART_LABELS, HIGHLIGHT_PARTS } from './plot-highlights.js';
import { SECTIONS, SECTION_LABELS } from './tab-controller.js';
import { createPlotOverlay } from './plot-overlay.js';

const KNOBS_OF = Object.freeze({ harmony: ['modulation', 'settlePasses', 'presence'], lines: ['bars', 'slotsPerBar', 'anchors'], tuning: ['frameCentsEachSide'] });

/**
 * createComposerTab({ tab, doc, visuals, raf, makeCanvas, download })
 *   tab       tab-controller.js
 *   doc       the document (the page's)
 *   visuals   () → window.lrcVisuals (the Linear Plot), or null
 *   raf       (fn) → requestAnimationFrame(fn)
 * → { mount({ left, inspector }), show(), hide(), render(), overlay, shown }
 */
export function createComposerTab({ tab, doc = globalThis.document, visuals = () => globalThis.window?.lrcVisuals ?? null, raf = (f) => globalThis.requestAnimationFrame(f), makeCanvas, download } = {}) {
  const S = tab.state, core = tab.core;
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
  const plotted = () => { const v = visuals(); return v && v.compositeRhythm ? { compositeRhythm: v.compositeRhythm, grid: v.grid } : null; };
  const overlay = createPlotOverlay({ getHighlights: () => tab.highlights(plotted()), getSelected: () => tab.view.selected, makeCanvas });
  const sounds = soundChoices(), drumModes = drumModeChoices();
  let hosts = null, ui = null, shown = false, lastPlaying = false, playheadEl = null, firstBars = null;

  const recomposeIfQuick = () => { if (core.canAutoRecompose()) core.compose(); };
  const field = (f, value) => {
    const e = f.kind === 'select'
      ? el('select', f.title ? { title: f.title } : {}, ...f.options.map(([v, label]) => el('option', { value: v, textContent: label })))
      : el('input', { type: 'number', ...f.attrs });
    e.value = value;
    return e;
  };
  const toggle = (label, on, title, onClick) => { const b = el('button', { className: `ctab-toggle${on ? ' on' : ''}`, textContent: label, title: title || '' }); b.addEventListener('click', onClick); return b; };
  const levelSlider = (id) => { const r = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: S.levels[id], title: 'level', className: 'ctab-level' }); r.addEventListener('input', () => core.setLevel(id, r.value)); return r; };

  // ── the left host: built once, its moving parts re-rendered ──
  function buildLeft(left) {
    const seed = el('input', { type: 'number', step: 1, className: 'ctab-seed', value: S.input.seed, title: 'the seed: the same seed, the same composition' });
    seed.addEventListener('change', () => core.setSeed(seed.value));
    const go = el('button', { className: 'ctab-go', textContent: 'Compose' });
    go.addEventListener('click', () => tab.press());
    const json = el('button', { className: 'ctab-btn', textContent: 'JSON', title: 'download the spec as it plays now' });
    json.addEventListener('click', exportJSON);
    const tempo = el('input', { type: 'range', min: TEMPO_LIMITS[0], max: TEMPO_LIMITS[1], step: 1, className: 'ctab-tempo' });
    const tempoBpm = el('input', { type: 'number', min: TEMPO_LIMITS[0], max: TEMPO_LIMITS[1], step: 0.1, title: 'BPM', className: 'ctab-num' });
    const tempoReset = el('button', { className: 'ctab-toggle', textContent: 'reset', title: 'back to the tempo Compose chose' });
    tempo.addEventListener('input', () => { core.setTempo(tempo.value); showTempo(); });
    tempoBpm.addEventListener('change', () => { core.setTempo(tempoBpm.value); tempoBpm.blur(); showTempo(); });
    tempoReset.addEventListener('click', () => { core.resetTempo(); showTempo(); });
    const glide = el('input', { type: 'range', min: 0, max: 500, step: 1, value: S.glideMs, className: 'ctab-glide', title: 'portamento: how long a held (legato) voice slides to its next note' });
    const glideOut = el('span', { className: 'ctab-muted', textContent: `${S.glideMs} ms` });
    glide.addEventListener('input', () => { core.setGlide(glide.value); glideOut.textContent = `${S.glideMs} ms`; });
    const rhythm = el('span', { className: 'ctab-rhythm' }), status = el('span', { className: 'ctab-status' });
    const note = el('div', { className: 'ctab-note' }), refusal = el('div', { className: 'ctab-refusal' }), readouts = el('div', { className: 'ctab-readouts' });
    playheadEl = el('div', { className: 'ctab-playhead' });
    const lanes = el('div', { className: 'ctab-lanes' }, playheadEl);
    const table = el('table', { className: 'ctab-decisions-table' });
    const decisions = el('details', { className: 'ctab-decisions' }, el('summary', { textContent: 'Decisions — what Compose chose, and why' }), table);
    left.replaceChildren(
      el('div', { className: 'ctab-head' },
        el('div', { className: 'ctab-row' }, rhythm, el('label', { className: 'ctab-muted', textContent: 'Seed' }), seed, go, json, status),
        el('div', { className: 'ctab-row' }, el('label', { className: 'ctab-muted', textContent: 'Tempo', title: 'playback tempo: the composed cycle faster or slower, live (pitch unchanged)' }), tempo, tempoBpm, tempoReset,
          el('label', { className: 'ctab-muted', textContent: 'Glide' }), glide, glideOut)),
      note, refusal, readouts,
      el('div', { className: 'ctab-scroll' }, lanes, decisions));
    return { seed, go, json, tempo, tempoBpm, tempoReset, glide, glideOut, rhythm, status, note, refusal, readouts, lanes, table };
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
    if (!S.spec) return;
    const name = `composer-${S.input.layers.filter(Boolean).join('-')}-seed${S.input.seed}.json`;
    if (download) { download(name, core.exportJSON()); return; }
    const blob = new Blob([core.exportJSON()], { type: 'application/json' }), a = el('a', { href: URL.createObjectURL(blob), download: name });
    doc.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderLeft() {
    const label = tab.button(), s = S.spec;
    ui.rhythm.replaceChildren(el('b', { textContent: tab.view.hasRhythm ? S.input.layers.filter(Boolean).join(':') : '—' }), ` · ${S.input.cycleSeconds} s cycle`);
    ui.rhythm.title = "the main page's rhythm and Playback cycle: Compose reads them; changing either goes back to Compose";
    if (doc.activeElement !== ui.seed) ui.seed.value = S.input.seed;
    ui.go.textContent = label;
    ui.go.className = `ctab-go${label === 'Stop' ? ' stop' : ''}`;
    ui.go.disabled = !tab.canPress();
    ui.status.textContent = S.status === 'error' ? `error: ${S.error}` : S.dirty && s ? 'changed — Compose again' : '';
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
    ui.readouts.replaceChildren(...readoutItems(s, { lastMs: S.lastMs, drums: S.drums }).map(([k, val]) => el('span', {}, `${k} `, el('b', { textContent: val }))));
    ui.table.replaceChildren(...decisionRows(s, S.drums).map((d) => el('tr', {}, el('td', { textContent: d.what }), el('td', { textContent: d.value }), el('td', { textContent: d.why }))));
    renderLanes();
    showTempo();
  }

  function renderLanes() {
    const s = S.spec;
    firstBars = null;
    if (!s || s.refused) { ui.lanes.replaceChildren(playheadEl); return; }
    const { starts, lens, cols, barOf } = barColumns(s), mods = new Map(s.modulations.map((m) => [m.bar, m]));
    const head = (id, enabled, onToggle) => {
      const name = el('button', { className: 'ctab-lane-name', textContent: PART_LABELS[id], title: `select ${PART_LABELS[id].toLowerCase()}: the inspector shows it` });
      name.style.borderLeftColor = PART_COLORS[id];
      name.addEventListener('click', () => tab.select(id));
      return el('div', { className: 'ctab-lane-head' }, name, toggle(enabled ? 'on' : 'off', enabled, 'play this part or not (live)', onToggle));
    };
    const rows = core.currentParts().map((part) => {
      const bars = el('div', { className: 'ctab-bars' });
      bars.style.gridTemplateColumns = cols;
      const cells = starts.map((_, k) => {
        const cell = el('div', { className: 'ctab-bar' });
        if (part.id === 'chords') {
          const ch = s.chords[k];
          cell.append(el('span', { className: `ctab-chord${ch.targeted ? ' targeted' : ''}${ch.fallback ? ' fallback' : ''}`, textContent: ch.name, title: chordTitle(ch) }));
          const m = mods.get(k);
          if (m) { const ml = modulationLabel(m); cell.append(el('span', { className: 'ctab-mod', textContent: ml.text, title: ml.title })); }
        }
        return cell;
      });
      for (const n of part.notes) {
        const k = barOf(n.time), t = el('div', { className: 'ctab-tick', title: noteTitle(n) });
        t.style.left = `${(100 * (n.time - starts[k])) / lens[k]}%`;
        t.style.background = PART_COLORS[part.id];
        t.style.opacity = n.retrigger ? 0.9 : 0.45;
        cells[k].append(t);
      }
      bars.append(...cells);
      firstBars ??= bars;
      return el('div', { className: `ctab-lane${part.enabled ? '' : ' off'}${tab.view.selected === part.id ? ' selected' : ''}` }, head(part.id, part.enabled, () => core.setPart(part.id, { enabled: !part.enabled })), bars);
    });
    if (S.drums) {
      const d = S.drums, bars = el('div', { className: 'ctab-bars' });
      bars.style.gridTemplateColumns = cols;
      const cells = starts.map((_, k) => el('div', { className: 'ctab-bar' }, el('span', { className: 'ctab-dlabel', textContent: drumBarLabel(d.bars[k]), title: d.bars[k].why })));
      for (const h of d.hits) {
        const k = barOf(h.time), t = el('div', { className: `ctab-dtick ${h.voice}`, title: drumHitTitle(h) });
        t.style.left = `${(100 * (h.time - starts[k])) / lens[k]}%`;
        cells[k].append(t);
      }
      bars.append(...cells);
      rows.push(el('div', { className: `ctab-lane drums${d.enabled ? '' : ' off'}${tab.view.selected === 'drums' ? ' selected' : ''}` }, head('drums', d.enabled, () => core.setDrums({ enabled: !d.enabled })), bars));
    }
    ui.lanes.replaceChildren(playheadEl, ...rows);
  }

  // ── the inspector ──
  function knobRow(names) {
    const chosen = knobChosen(S.spec, S.knobs);
    return el('div', { className: 'ctab-knobs' }, ...names.map((name) => {
      const f = KNOB_FIELDS.find((x) => x.name === name), input = field(f, fieldValue(name, S.knobs[name]));
      input.addEventListener('change', () => { core.setKnob(name, f.read(input.value)); recomposeIfQuick(); });
      const c = chosen[name];
      return el('div', { className: 'ctab-knob' }, el('label', { textContent: f.label, title: f.title || '' }), input, el('span', { className: `ctab-chosen${c.over ? ' over' : ''}`, textContent: c.text }));
    }));
  }
  function progressionEditor() {
    const rc = core.rootChoices(), roots = core.progression(), s = S.spec;
    const take = el('button', { className: 'ctab-btn', textContent: 'take from last compose', title: 'fill every bar with the root the last compose chose', disabled: !s || s.refused });
    take.addEventListener('click', () => { if (core.takeProgression()) recomposeIfQuick(); });
    const clear = el('button', { className: 'ctab-btn', textContent: 'clear', title: 'every bar back to auto' });
    clear.addEventListener('click', () => { core.clearProgression(); recomposeIfQuick(); });
    const headRow = el('div', { className: 'ctab-row' }, el('span', { className: 'ctab-sub', textContent: 'Progression — a root a bar from the row; auto leaves the bar to Compose' }));
    if (!tab.view.hasRhythm) return el('div', {}, headRow, el('span', { className: 'ctab-muted', textContent: 'no rhythm yet' }));
    if (rc.refused) return el('div', {}, headRow, el('span', { className: 'ctab-muted', textContent: 'no roots: this row is refused' }));
    const opt = (o) => el('option', { value: o.value, textContent: o.text, title: o.title });
    const groups = rootGroups(rc), got = s && !s.refused && !S.dirty ? s.chords : null;
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
    const o = S.drumOptions, enabled = S.drums ? S.drums.enabled : o.enabled !== false;
    const mode = el('select', { title: 'the drum mode, or a curated pattern' }, ...drumModes.map((m) => el('option', { value: m.id, textContent: m.label })));
    mode.value = o.mode;
    mode.addEventListener('change', () => core.setDrums({ mode: mode.value }));
    return [mode, toggle('fills', o.fills, 'on: the last bar of each phrase of 4 bars or more fills from beat 3, and a crash opens the next', () => core.setDrums({ fills: !o.fills })),
      toggle(enabled ? 'on' : 'off', enabled, 'play the drums or not (live)', () => core.setDrums({ enabled: !enabled })), levelSlider('drums')];
  }
  function kitRow() {
    const kit = S.drumOptions.kit;
    return el('div', { className: 'ctab-knobs' }, ...DRUM_LAB_VOICES.map((v) => {
      const sel = el('select', {}, ...tab.kitChoices(v).map((c) => el('option', { value: c.value, textContent: c.label })));
      sel.value = kit[v] ?? '';
      sel.addEventListener('change', () => core.setDrums({ kit: { [v]: sel.value } }));
      return el('div', { className: 'ctab-knob' }, el('label', { textContent: v }), sel);
    }));
  }
  function partControls(id) {
    if (id === 'drums') return drumControls();
    const part = S.parts[id];
    if (!part) return [el('span', { className: 'ctab-muted', textContent: 'Compose first: then its sound, legato and level are here' })];
    const sound = el('select', { title: 'its sound (Audio/voices): live' }, ...sounds.map((x) => el('option', { value: x.id, textContent: x.label })));
    sound.value = part.sound;
    sound.addEventListener('change', () => core.setPart(id, { sound: sound.value }));
    return [sound, toggle('legato', part.legato, "on: each note holds to the part's next note", () => core.setPart(id, { legato: !part.legato })),
      toggle(part.enabled ? 'on' : 'off', part.enabled, 'play this part or not (live)', () => core.setPart(id, { enabled: !part.enabled })), levelSlider(id)];
  }
  function tuningReadout() {
    const s = S.spec;
    if (!s || s.refused) return el('span', { className: 'ctab-muted', textContent: 'Compose first: the root, baseHz and retunes show here' });
    const k = s.knobs, rows = s.chords.map((c) => el('tr', {}, el('td', { textContent: `bar ${c.bar + 1}` }), el('td', { textContent: c.name }), el('td', { textContent: `root ${c.rootTone}` }),
      el('td', { textContent: c.offsetCents ? `${c.offsetCents >= 0 ? '+' : ''}${c.offsetCents.toFixed(1)}¢` : '' })));
    return el('div', {}, el('div', { className: 'ctab-readouts' }, el('span', {}, 'root ', el('b', { textContent: k.root })), el('span', {}, 'baseHz ', el('b', { textContent: k.baseHz.toFixed(2) })),
      el('span', {}, 'modulation ', el('b', { textContent: k.modulation ? 'on' : 'off' })), el('span', {}, 'retunes ', el('b', { textContent: String(s.modulations.length) }))),
    el('table', { className: 'ctab-decisions-table' }, ...rows));
  }
  function renderInspector() {
    const id = tab.view.selected, section = tab.view.section;
    const swatch = el('span', { className: 'ctab-swatch' });
    swatch.style.background = PART_COLORS[id];
    const tabs = el('div', { className: 'ctab-insp-tabs' }, ...SECTIONS.map((name) => {
      const b = el('button', { className: `ctab-insp-tab${name === section ? ' active' : ''}`, textContent: SECTION_LABELS[name] });
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
    if (section === 'harmony') body = [progressionEditor(), el('div', { className: 'ctab-sub', textContent: 'Harmony' }), knobRow(KNOBS_OF.harmony)];
    else if (section === 'lines') {
      const table = field(TABLE_FIELD, S.table), chosen = knobChosen(S.spec, S.knobs).table;
      table.addEventListener('change', () => core.setTable(table.value));
      body = [knobRow(KNOBS_OF.lines), el('div', { className: 'ctab-knobs' }, el('div', { className: 'ctab-knob' }, el('label', { textContent: TABLE_FIELD.label }), table, el('span', { className: 'ctab-chosen', textContent: chosen.text })))];
    } else if (section === 'drums') body = [el('div', { className: 'ctab-row' }, el('span', { className: 'ctab-sub', textContent: 'Drums' }), ...drumControls()), el('div', { className: 'ctab-sub', textContent: 'Kit — a sound a voice (the made kit, or the site\'s samples)' }), kitRow()];
    else body = [knobRow(KNOBS_OF.tuning), tuningReadout()];
    hosts.inspector.replaceChildren(
      el('div', { className: 'ctab-insp-head' }, swatch, el('b', { className: 'ctab-insp-name', textContent: PART_LABELS[id] }), ...partControls(id)),
      parts, tabs, el('div', { className: 'ctab-insp-body' }, ...body));
  }

  function render() {
    if (!ui || !hosts) return;
    renderLeft();
    renderInspector();
  }

  // ── the playhead, on the lanes and on the plot ──
  function frame() {
    if (!shown) return;
    tab.syncRhythm();
    const at = tab.playheadAt(), v = visuals();
    // the overlay's snapshot is of the Linear Plot: on any other plot type it is never blitted
    const onLinear = !!v && v.currentPlotType === 'linear';
    if (at) {
      if (onLinear) overlay.frame(at);
      if (firstBars && playheadEl) {
        const box = ui.lanes.getBoundingClientRect(), bars = firstBars.getBoundingClientRect();
        playheadEl.style.display = 'block';
        playheadEl.style.left = `${bars.left - box.left + ui.lanes.scrollLeft + at.p * bars.width}px`;
      }
      lastPlaying = true;
    } else if (lastPlaying) {
      lastPlaying = false;
      if (onLinear) overlay.frame(null);
      if (playheadEl) playheadEl.style.display = 'none';
    }
    raf(frame);
  }

  tab.onChange(() => {
    if (!shown) return;
    render();
    visuals()?.drawPlot?.();   // the lit nodes follow the spec, the parts and the selection
  });

  return {
    overlay,
    get shown() { return shown; },
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
      visuals()?.setComposerOverlay?.(overlay);
      if (!was) raf(frame);
    },
    hide() {
      if (!shown) return;
      shown = false;
      tab.close();
      if (playheadEl) playheadEl.style.display = 'none';
      lastPlaying = false;
      visuals()?.setComposerOverlay?.(null);
    },
    render,
  };
}
