// composer-lab.js — the lab page's view: DOM in, DOM out, over lab-controller.js (all state and actions live there).
// Compose runs in the module worker for the full table (Composer/core/compose-worker.js) and on the main thread for
// the lean one; Perform plays the spec through Audio/voices (lab-player.js).

import { compose } from '../core/compose.js';
import { createLabController, PRESETS, soundChoices } from './lab-controller.js';

// ── Compose: the worker for the full table, this thread for the lean one ──
let worker = null, seq = 0;
const pending = new Map();
function viaWorker(layers, cycleSeconds, { seed, overrides, progression }) {
  if (!worker) {
    worker = new Worker(new URL('../core/compose-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      if (event.data.ok) p.resolve(event.data.spec); else p.reject(new Error(event.data.error));
    };
    worker.onerror = (event) => { for (const p of pending.values()) p.reject(new Error(event.message || 'the Compose worker failed')); pending.clear(); worker = null; };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, layers, cycleSeconds, options: { seed, overrides, progression } }); });
}
const runCompose = (layers, cycleSeconds, options) => (options.worker
  ? viaWorker(layers, cycleSeconds, options)
  : new Promise((resolve) => setTimeout(() => resolve(compose(layers, cycleSeconds, { seed: options.seed, overrides: options.overrides, progression: options.progression })), 0)));

const lab = createLabController({ runCompose });
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
const KNOB_UI = [
  { name: 'bars', label: 'Bars', make: () => el('select', {}, ...['', '1', '2', '4', '8'].map((v) => el('option', { value: v, textContent: v || 'auto' }))), read: (v) => (v === '' ? null : Number(v)) },
  { name: 'slotsPerBar', label: 'Slots / bar', make: () => el('input', { type: 'number', min: 2, max: 16, placeholder: 'auto' }), read: (v) => (v === '' ? null : Number(v)) },
  { name: 'frameCentsEachSide', label: 'Frame ±¢', make: () => el('input', { type: 'number', min: 0, max: 50, step: 0.5, placeholder: 'auto' }), read: (v) => (v === '' ? null : Number(v)) },
  { name: 'modulation', label: 'Modulation', make: () => el('select', {}, el('option', { value: '', textContent: 'auto' }), el('option', { value: 'on', textContent: 'on' }), el('option', { value: 'off', textContent: 'off' })), read: (v) => (v === '' ? null : v === 'on') },
  { name: 'anchors', label: 'Anchors', make: () => el('select', {}, ...['', 'partitioned', 'even'].map((v) => el('option', { value: v, textContent: v || 'auto' }))), read: (v) => (v === '' ? null : v) },
  { name: 'settlePasses', label: 'Settle passes', make: () => el('select', { title: 'rounds of chords re-derived from the kept lead, then the lead re-mined over them, until the chords stop changing' }, ...['', '0', '1', '2', '3'].map((v) => el('option', { value: v, textContent: v || 'auto' }))), read: (v) => (v === '' ? null : Number(v)) },
  { name: 'presence', label: 'Root presence', make: () => el('select', { title: "how the default root's presence is counted: its ±frame cluster, or its exact ratio alone" }, ...['', 'cluster', 'exact'].map((v) => el('option', { value: v, textContent: v || 'auto' }))), read: (v) => (v === '' ? null : v) },
];
const chosenSpans = {};
for (const k of KNOB_UI) {
  const input = k.make(), chosen = el('span', { className: 'chosen' });
  input.addEventListener('change', () => { lab.setKnob(k.name, k.read(input.value)); if (lab.canAutoRecompose()) lab.compose(); });
  chosenSpans[k.name] = chosen;
  $('knobs').append(el('div', { className: 'knob' }, el('label', { textContent: k.label }), input, chosen));
}
{
  const table = el('select', {}, el('option', { value: 'full', textContent: 'full (worker)' }), el('option', { value: 'lean', textContent: 'lean (main thread)' }));
  table.addEventListener('change', () => lab.setTable(table.value));
  chosenSpans.table = el('span', { className: 'chosen' });
  $('knobs').append(el('div', { className: 'knob' }, el('label', { textContent: 'Table' }), table, chosenSpans.table));
}

// ── the progression editor: a root a bar (auto by default), from the row's ±frame clusters ──
$('progTake').addEventListener('click', () => { if (lab.takeProgression() && lab.canAutoRecompose()) lab.compose(); });
$('progClear').addEventListener('click', () => { lab.clearProgression(); if (lab.canAutoRecompose()) lab.compose(); });
const MOST_HEARD = 8;
function renderProgression() {
  const box = $('progression'), rc = lab.rootChoices(), roots = lab.progression(), s = S.spec;
  $('progTake').disabled = !s || s.refused;
  if (rc.refused) { box.replaceChildren(el('span', { className: 'note', textContent: 'no roots: this row is refused' })); return; }
  const opt = (c) => el('option', { value: c.ratio, textContent: `${c.ratio} · ${c.name} · ${c.cents.toFixed(1)}¢ · ${c.presence}×`, title: `${c.members} tone${c.members === 1 ? '' : 's'} in its ±${rc.frameCentsEachSide}¢ cluster, heard ${c.presence} times (${(100 * c.share).toFixed(1)} %)${c.isRoot ? '; the base root' : ''}${c.offGrid ? '; off the grid: a retune' : ''}` });
  const heard = [...rc.candidates].sort((a, b) => b.presence - a.presence).slice(0, MOST_HEARD);
  // the spec this editor's roots last reached: the chord each bar got
  const got = s && !s.refused && !S.dirty ? s.chords : null;
  box.replaceChildren(...roots.map((ratio, k) => {
    const sel = el('select', { title: `bar ${k + 1}: its chord's root` }, el('option', { value: '', textContent: 'auto' }),
      el('optgroup', { label: 'most heard' }, ...heard.map(opt)), el('optgroup', { label: 'all, by pitch from the root' }, ...rc.candidates.map(opt)));
    if (ratio && !rc.candidates.some((c) => c.ratio === ratio)) sel.prepend(el('option', { value: ratio, textContent: `${ratio} (a tone of the row, not a cluster's loudest)` }));
    sel.value = ratio ?? '';
    sel.addEventListener('change', () => { lab.setProgressionRoot(k, sel.value || null); if (lab.canAutoRecompose()) lab.compose(); });
    const c = got?.[k], chord = el('span', { className: `chosen${c?.targeted ? ' over' : ''}`, textContent: c ? `${c.targeted ? 'asked → ' : 'chose '}${c.name}${c.fallback ? ' (fallback)' : ''}` : '' });
    return el('div', { className: 'knob' }, el('label', { textContent: `Bar ${k + 1}` }), sel, chord);
  }));
  const asked = roots.filter(Boolean).length;
  $('progNote').textContent = asked ? `${asked} of ${roots.length} bars asked` : 'every bar auto: Compose leads with the melody';
}

// ── readouts, refusal, decisions ──
const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : String(v));
function renderReadouts() {
  const s = S.spec, out = $('readouts');
  out.replaceChildren();
  $('refusal').textContent = '';
  if (!s) return;
  if (s.refused) {
    const d = s.detail;
    $('refusal').textContent = s.reason === 'tooDense' ? `Too dense: ${d.onsets.toLocaleString()} onsets is over the ${d.gate.toLocaleString()}-onset gate.`
      : s.reason === 'tooLarge' ? `Grid too large: ${d.grid} is past 2^53, which v1 does not support.`
      : `Too few tones: ${d.tones} distinct tone${d.tones === 1 ? '' : 's'}; Compose needs at least ${d.min}.`;
    return;
  }
  const k = s.knobs, items = [['tempo', `${fmt(k.tempoBpm)} BPM`], ['meter', `${k.bars} × ${k.slotsPerBar}`], ['root', k.root], ['baseHz', fmt(k.baseHz, 2)], ['onsets', s.stats.onsets.toLocaleString()],
    ['tones', s.stats.tones.toLocaleString()], ['table', k.table], ['composed in', `${fmt(S.lastMs, 0)} ms`], ['chords', s.chords.map((c) => c.name).join(' ')],
    ...(s.input.progression ? [['progression', `${s.chords.filter((c) => c.targeted).length}/${s.chords.length} targeted (${k.leader})${s.chords.some((c) => c.fallback) ? `, fallback on bar ${s.chords.filter((c) => c.fallback).map((c) => c.bar + 1).join(', ')}` : ''}`]] : [])];
  for (const [label, value] of items) out.append(el('span', {}, `${label} `, el('b', { textContent: value })));
  for (const kn of KNOB_UI) {
    const over = S.knobs[kn.name] != null, asked = (what) => s.decisions.find((d) => d.what === what)?.value;
    let v = kn.name === 'modulation' ? (k.modulation ? 'on' : 'off') : k[kn.name];
    if (kn.name === 'settlePasses') { const st = s.stats.settle || {}; v = `${asked('settlePasses') ?? '–'} · ${st.rounds ?? 0} used${st.oscillated ? ', oscillated' : st.converged ? ', settled' : ', cap hit'}`; }
    if (kn.name === 'presence') v = asked('presence') ?? 'cluster';
    chosenSpans[kn.name].textContent = over ? `asked: ${v}` : `chose ${v}`;
    chosenSpans[kn.name].className = `chosen${over ? ' over' : ''}`;
  }
  chosenSpans.table.textContent = `ran ${k.table}`;
}
function renderDecisions() {
  const t = $('decisionTable');
  t.replaceChildren(...(S.spec?.decisions || []).map((d) => el('tr', {}, el('td', { textContent: d.what }), el('td', { textContent: JSON.stringify(d.value) }), el('td', { textContent: d.why }))));
}

// ── lanes ──
const sounds = soundChoices();
let laneKey = null;
function renderLanes() {
  const s = S.spec, lanes = $('lanes'), head = $('playhead');
  if (!s || s.refused) { lanes.replaceChildren(head); laneKey = null; return; }
  const T = s.knobs.cycleSeconds, starts = s.timeline.barStarts, N = starts.length;
  const lens = starts.map((t, i) => (i + 1 < N ? starts[i + 1] : T) - t);
  const cols = lens.map((l) => `${l.toFixed(4)}fr`).join(' ');
  const barOf = (time) => { let k = 0; while (k + 1 < N && starts[k + 1] <= time + 1e-9) k++; return k; };
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
        cell.append(el('span', { className: `chord${ch.targeted ? ' targeted' : ''}${ch.fallback ? ' fallback' : ''}`, textContent: ch.name, title: `${ch.quality}, root ${ch.rootTone}${ch.targeted ? ', the root asked' : ''}${ch.fallback ? ` (fallback: ${ch.fallback})` : ''}` }));
        const m = mods.get(k);
        if (m) cell.append(el('span', { className: 'mod', textContent: `↻ ${m.cents >= 0 ? '+' : ''}${m.cents.toFixed(1)}¢`, title: `retuned from here: ${m.rawCents.toFixed(1)}¢ from the base fundamental` }));
      }
      return cell;
    });
    const counts = new Array(N).fill(0);
    for (const n of part.notes) {
      const k = barOf(n.time); counts[k]++;
      const tick = el('div', { className: 'tick', title: `${n.ratio} ×2^${n.octave} · ${n.hz.toFixed(1)} Hz · ${n.duration.toFixed(3)} s${n.retrigger ? '' : ' (glide)'}` });
      tick.style.left = `${(100 * (n.time - starts[k])) / lens[k]}%`;
      tick.style.opacity = n.retrigger ? 0.9 : 0.45;
      cells[k].append(tick);
    }
    cells.forEach((c, k) => c.append(el('span', { className: 'count', textContent: counts[k] || '' })));
    bars.append(...cells);
    return el('div', { className: `lane${part.enabled ? '' : ' off'}` }, el('div', { className: 'head' }, name, sound, legato, on, level), bars);
  });
  lanes.replaceChildren(head, ...rows);
  laneKey = rows.length ? rows[0].querySelector('.bars') : null;
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
  renderReadouts(); renderDecisions(); renderLanes(); renderProgression();
  showTempo();
}
lab.onChange(render);
render();
lab.compose();   // the default rhythm, at once
