// composer-lab.js — the lab page's view: DOM in, DOM out, over the shared controller (Composer/perform/: all state
// and actions live there, and the main page's Composer tab uses the same ones). Compose runs in the module worker for
// the full table and on the main thread for the lean one (perform/compose-runner.js); Perform plays the spec through
// Audio/voices (perform/composer-player.js). What it says about a spec comes from perform/readouts.js.

import { createComposerController, PRESETS, soundChoices, drumModeChoices, kitChoices, DRUM_LAB_VOICES } from '../perform/composer-controller.js';
import { createComposeRunner } from '../perform/compose-runner.js';
import { KNOB_FIELDS, TABLE_FIELD, refusalText, readoutItems, knobChosen, decisionRows, rootGroups, strayRootOption, chordGot, progressionNote,
  barColumns, noteTitle, chordTitle, modulationLabel, drumBarLabel, drumHitTitle } from '../perform/readouts.js';

const runCompose = createComposeRunner();
const lab = createComposerController({ runCompose });
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
const S = lab.state;

// ── header ──
const layerInputs = [0, 1, 2, 3].map((i) => $(`l${i}`));
const syncInputs = () => {
  layerInputs.forEach((inp, i) => { inp.value = S.input.layers[i] || ''; });
  $('cycle').value = S.input.cycleSeconds; $('seed').value = S.input.seed;
};
syncInputs();
for (const inp of layerInputs) inp.addEventListener('change', () => lab.setLayers(layerInputs.map((x) => x.value)));
$('cycle').addEventListener('change', (e) => lab.setCycle(e.target.value));
$('seed').addEventListener('change', (e) => lab.setSeed(e.target.value));
const showGlide = () => { $('glide').value = lab.state.glideMs; $('glideOut').textContent = `${lab.state.glideMs} ms`; };
$('glide').addEventListener('input', (e) => { lab.setGlide(e.target.value); showGlide(); });
showGlide();
// tempo: the playback BPM (the spec's own until changed; a new Compose resets it), live while playing
const showTempo = () => {
  const bpm = lab.tempo(), spec = lab.specTempo(), off = bpm == null;
  for (const id of ['tempo', 'tempoBpm', 'tempoReset']) $(id).disabled = off;
  if (off) { $('tempoBpm').value = ''; return; }
  $('tempo').value = bpm;
  if (document.activeElement !== $('tempoBpm')) $('tempoBpm').value = Number(bpm.toFixed(1));
  $('tempoBpm').classList.toggle('changed', Math.abs(bpm - spec) > 1e-9);
  $('tempoReset').title = `back to the tempo Compose chose (${spec.toFixed(1)} BPM)`;
};
$('tempo').addEventListener('input', (e) => { lab.setTempo(e.target.value); showTempo(); });
$('tempoBpm').addEventListener('change', (e) => { lab.setTempo(e.target.value); e.target.blur(); showTempo(); });
$('tempoReset').addEventListener('click', () => { lab.resetTempo(); showTempo(); });
$('preset').append(el('option', { value: '', textContent: 'Presets…' }), ...PRESETS.map((p, i) => el('option', { value: String(i), textContent: p.name })));
$('preset').addEventListener('change', (e) => { if (e.target.value !== '') { lab.loadPreset(Number(e.target.value)); syncInputs(); e.target.value = ''; } });
$('go').addEventListener('click', () => lab.press());
$('export').addEventListener('click', () => {
  if (!S.spec) return;
  const blob = new Blob([lab.exportJSON()], { type: 'application/json' }), a = el('a', { href: URL.createObjectURL(blob), download: `composer-${S.input.layers.filter(Boolean).join('-')}-seed${S.input.seed}.json` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ── knobs ──
const field = (f) => (f.kind === 'select'
  ? el('select', f.title ? { title: f.title } : {}, ...f.options.map(([value, label]) => el('option', { value, textContent: label })))
  : el('input', { type: 'number', ...f.attrs, ...(f.title ? { title: f.title } : {}) }));
const chosenSpans = {};
for (const k of KNOB_FIELDS) {
  const input = field(k), chosen = el('span', { className: 'chosen' });
  input.addEventListener('change', () => { lab.setKnob(k.name, k.read(input.value)); if (lab.canAutoRecompose()) lab.compose(); });
  chosenSpans[k.name] = chosen;
  $('knobs').append(el('div', { className: 'knob' }, el('label', { textContent: k.label }), input, chosen));
}
{
  const table = field(TABLE_FIELD);
  table.addEventListener('change', () => lab.setTable(table.value));
  chosenSpans.table = el('span', { className: 'chosen' });
  $('knobs').append(el('div', { className: 'knob' }, el('label', { textContent: TABLE_FIELD.label }), table, chosenSpans.table));
}

// ── the progression editor: a root a bar (auto by default), from the row's ±frame clusters ──
$('progTake').addEventListener('click', () => { if (lab.takeProgression() && lab.canAutoRecompose()) lab.compose(); });
$('progClear').addEventListener('click', () => { lab.clearProgression(); if (lab.canAutoRecompose()) lab.compose(); });
function renderProgression() {
  const box = $('progression'), rc = lab.rootChoices(), roots = lab.progression(), s = S.spec;
  $('progTake').disabled = !s || s.refused;
  if (rc.refused) { box.replaceChildren(el('span', { className: 'note', textContent: 'no roots: this row is refused' })); return; }
  const opt = (o) => el('option', { value: o.value, textContent: o.text, title: o.title });
  const groups = rootGroups(rc);
  // the spec this editor's roots last reached: the chord each bar got
  const got = s && !s.refused && !S.dirty ? s.chords : null;
  box.replaceChildren(...roots.map((ratio, k) => {
    const sel = el('select', { title: `bar ${k + 1}: its chord's root` }, el('option', { value: '', textContent: 'auto' }),
      el('optgroup', { label: 'most heard' }, ...groups.heard.map(opt)), el('optgroup', { label: 'all, by pitch from the root' }, ...groups.all.map(opt)));
    if (ratio && !rc.candidates.some((c) => c.ratio === ratio)) sel.prepend(opt(strayRootOption(ratio)));
    sel.value = ratio ?? '';
    sel.addEventListener('change', () => { lab.setProgressionRoot(k, sel.value || null); if (lab.canAutoRecompose()) lab.compose(); });
    const g = chordGot(got?.[k]), chord = el('span', { className: `chosen${g.over ? ' over' : ''}`, textContent: g.text });
    return el('div', { className: 'knob' }, el('label', { textContent: `Bar ${k + 1}` }), sel, chord);
  }));
  $('progNote').textContent = progressionNote(roots);
}

// ── readouts, refusal, decisions ──
function renderReadouts() {
  const s = S.spec, out = $('readouts');
  out.replaceChildren();
  $('refusal').textContent = refusalText(s);
  if (!s || s.refused) return;
  for (const [label, value] of readoutItems(s, { lastMs: S.lastMs, drums: S.drums })) out.append(el('span', {}, `${label} `, el('b', { textContent: value })));
  const chosen = knobChosen(s, S.knobs);
  for (const [name, c] of Object.entries(chosen)) { chosenSpans[name].textContent = c.text; chosenSpans[name].className = `chosen${c.over ? ' over' : ''}`; }
}
function renderDecisions() {
  $('decisionTable').replaceChildren(...decisionRows(S.spec, S.drums).map((d) => el('tr', {}, el('td', { textContent: d.what }), el('td', { textContent: d.value }), el('td', { textContent: d.why }))));
}

// ── lanes ──
const sounds = soundChoices();
let laneKey = null;
function renderLanes() {
  const s = S.spec, lanes = $('lanes'), head = $('playhead');
  if (!s || s.refused) { lanes.replaceChildren(head); laneKey = null; return; }
  const { starts, lens, cols, barOf } = barColumns(s), N = starts.length;
  const mods = new Map(s.modulations.map((m) => [m.bar, m]));
  const rows = lab.currentParts().map((part) => {
    const name = el('span', { className: 'name', textContent: part.id });
    const sound = el('select', {}, ...sounds.map((x) => el('option', { value: x.id, textContent: x.label, selected: x.id === part.sound })));
    sound.addEventListener('change', () => lab.setPart(part.id, { sound: sound.value }));
    const legato = el('button', { className: `toggle${part.legato ? ' on' : ''}`, textContent: 'legato', title: 'on: each note holds to the part\'s next note' });
    legato.addEventListener('click', () => lab.setPart(part.id, { legato: !part.legato }));
    const on = el('button', { className: `toggle${part.enabled ? ' on' : ''}`, textContent: part.enabled ? 'on' : 'off' });
    on.addEventListener('click', () => lab.setPart(part.id, { enabled: !part.enabled }));
    const level = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: S.levels[part.id], title: 'level' });
    level.addEventListener('input', () => lab.setLevel(part.id, level.value));
    const bars = el('div', { className: 'bars' });
    bars.style.gridTemplateColumns = cols;
    const cells = starts.map((_, k) => {
      const cell = el('div', { className: 'bar' });
      if (part.id === 'chords') {
        const ch = s.chords[k];
        cell.append(el('span', { className: `chord${ch.targeted ? ' targeted' : ''}${ch.fallback ? ' fallback' : ''}`, textContent: ch.name, title: chordTitle(ch) }));
        const m = mods.get(k);
        if (m) { const ml = modulationLabel(m); cell.append(el('span', { className: 'mod', textContent: ml.text, title: ml.title })); }
      }
      return cell;
    });
    const counts = new Array(N).fill(0);
    for (const n of part.notes) {
      const k = barOf(n.time); counts[k]++;
      const tick = el('div', { className: 'tick', title: noteTitle(n) });
      tick.style.left = `${(100 * (n.time - starts[k])) / lens[k]}%`;
      tick.style.opacity = n.retrigger ? 0.9 : 0.45;
      cells[k].append(tick);
    }
    cells.forEach((c, k) => c.append(el('span', { className: 'count', textContent: counts[k] || '' })));
    bars.append(...cells);
    return el('div', { className: `lane${part.enabled ? '' : ' off'}` }, el('div', { className: 'head' }, name, sound, legato, on, level), bars);
  });
  if (S.drums) rows.push(drumLane(s, starts, lens, cols, barOf));
  lanes.replaceChildren(head, ...rows);
  laneKey = rows.length ? rows[0].querySelector('.bars') : null;
}

// ── the drums lane and kit: a change re-arranges the drums from the spec (lab.setDrums), nothing re-composed ──
const drumModes = drumModeChoices();
function drumLane(s, starts, lens, cols, barOf) {
  const d = S.drums, o = S.drumOptions;
  const mode = el('select', { title: 'the drum mode, or a curated pattern' }, ...drumModes.map((m) => el('option', { value: m.id, textContent: m.label, selected: m.id === o.mode })));
  mode.addEventListener('change', () => lab.setDrums({ mode: mode.value }));
  const fills = el('button', { className: `toggle${o.fills ? ' on' : ''}`, textContent: 'fills', title: 'on: the last bar of each phrase of 4 bars or more fills from beat 3, and a crash opens the next' });
  fills.addEventListener('click', () => lab.setDrums({ fills: !o.fills }));
  const on = el('button', { className: `toggle${d.enabled ? ' on' : ''}`, textContent: d.enabled ? 'on' : 'off' });
  on.addEventListener('click', () => lab.setDrums({ enabled: !d.enabled }));
  const level = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: S.levels.drums, title: 'level' });
  level.addEventListener('input', () => lab.setLevel('drums', level.value));
  const bars = el('div', { className: 'bars' });
  bars.style.gridTemplateColumns = cols;
  const cells = starts.map((_, k) => el('div', { className: 'bar' }, el('span', { className: 'dlabel', textContent: drumBarLabel(d.bars[k]), title: d.bars[k].why })));
  for (const h of d.hits) {
    const k = barOf(h.time), tick = el('div', { className: `dtick ${h.voice}`, title: drumHitTitle(h) });
    tick.style.left = `${(100 * (h.time - starts[k])) / lens[k]}%`;
    cells[k].append(tick);
  }
  bars.append(...cells);
  return el('div', { className: `lane${d.enabled ? '' : ' off'}` }, el('div', { className: 'head' }, el('span', { className: 'name', textContent: 'drums' }), mode, fills, on, level), bars);
}
function renderKit() {
  const box = $('drumKit'), kit = S.drumOptions.kit;
  box.replaceChildren(el('label', { textContent: 'Drum kit' }), ...DRUM_LAB_VOICES.map((v) => {
    const sel = el('select', {}, ...kitChoices(v).map((c) => el('option', { value: c.value, textContent: c.label, selected: c.value === kit[v] })));
    sel.addEventListener('change', () => lab.setDrums({ kit: { [v]: sel.value } }));
    return el('span', { className: 'knob' }, el('label', { textContent: v }), sel);
  }));
}

// ── the playhead ──
function frame() {
  const head = $('playhead'), x = lab.playhead();
  if (x == null || !laneKey) head.style.display = 'none';
  else {
    const box = $('lanes').getBoundingClientRect(), bars = laneKey.getBoundingClientRect();
    head.style.display = 'block';
    head.style.left = `${bars.left - box.left + x * bars.width}px`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── the button and status ──
function render() {
  const label = lab.button();
  $('go').textContent = label;
  $('go').className = label === 'Stop' ? 'stop' : '';
  $('go').disabled = label === 'Composing…';
  $('status').textContent = S.status === 'error' ? `error: ${S.error}` : S.dirty && S.spec ? 'changed — Compose again' : '';
  renderReadouts(); renderDecisions(); renderLanes(); renderProgression(); renderKit();
  showTempo();
}
lab.onChange(render);
render();
lab.compose();   // the default rhythm, at once
