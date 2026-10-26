// readouts.js — what a Composer view says about a spec, as plain data (no DOM): the knob fields and what Compose chose
// for each, the readouts line, a refusal in plain words, the decisions list, and the labels of the progression editor
// and the lanes. Shared by the lab (composer-lab.js) and the main page's Composer tab (Composer/page/composer-tab.js),
// promoted from the lab's view on 2026-10-22, so both say the same things the same way.

/** the knobs, as fields a view renders: a select (options [value, label]) or a number input (attrs). `read` turns the
 *  field's string into the controller's value (null = leave it to Compose). */
export const KNOB_FIELDS = Object.freeze([
  { name: 'bars', label: 'Bars', kind: 'select', options: [['', 'auto'], ['1', '1'], ['2', '2'], ['4', '4'], ['8', '8']], read: (v) => (v === '' ? null : Number(v)) },
  { name: 'slotsPerBar', label: 'Slots / bar', kind: 'number', attrs: { min: 2, max: 16, placeholder: 'auto' }, read: (v) => (v === '' ? null : Number(v)) },
  { name: 'frameCentsEachSide', label: 'Frame ±¢', kind: 'number', attrs: { min: 0, max: 50, step: 0.5, placeholder: 'auto' }, read: (v) => (v === '' ? null : Number(v)) },
  { name: 'modulation', label: 'Modulation', kind: 'select', options: [['', 'auto'], ['on', 'on'], ['off', 'off']], read: (v) => (v === '' ? null : v === 'on') },
  { name: 'anchors', label: 'Anchors', kind: 'select', options: [['', 'auto'], ['partitioned', 'partitioned'], ['even', 'even']], read: (v) => (v === '' ? null : v) },
  { name: 'settlePasses', label: 'Settle passes', kind: 'select', title: 'rounds of chords re-derived from the kept lead, then the lead re-mined over them, until the chords stop changing', options: [['', 'auto'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], read: (v) => (v === '' ? null : Number(v)) },
  { name: 'presence', label: 'Root presence', kind: 'select', title: "how the default root's presence is counted: its ±frame cluster, or its exact ratio alone", options: [['', 'auto'], ['cluster', 'cluster'], ['exact', 'exact']], read: (v) => (v === '' ? null : v) },
]);
/** the table field (where Compose runs) */
export const TABLE_FIELD = Object.freeze({ name: 'table', label: 'Table', kind: 'select', options: [['full', 'full (worker)'], ['lean', 'lean (main thread)']] });
/** a knob's controller value back to the field's string */
export const fieldValue = (name, value) => (value == null ? '' : name === 'modulation' ? (value ? 'on' : 'off') : String(value));

const fmt = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : String(v));

/** a refusal in plain words ('' when the spec isn't one) */
export function refusalText(spec) {
  if (!spec || !spec.refused) return '';
  const d = spec.detail;
  return spec.reason === 'tooDense' ? `Too dense: ${d.onsets.toLocaleString()} onsets is over the ${d.gate.toLocaleString()}-onset gate.`
    : spec.reason === 'tooLarge' ? `Grid too large: ${d.grid} is past 2^53, which v1 does not support.`
      : spec.reason === 'targetGrid' ? `The MIDI clip's grid is too fine: ${d.slotsPerBar} steps a bar is past the ${d.max} a line may hold.`   // MIDI targets (phase B)
      : `Too few tones: ${d.tones} distinct tone${d.tones === 1 ? '' : 's'}; Compose needs at least ${d.min}.`;
}

/** the readouts line: [[label, value]] (empty without a spec or for a refusal) */
export function readoutItems(spec, { lastMs = null, drums = null } = {}) {
  if (!spec || spec.refused) return [];
  const k = spec.knobs;
  return [['tempo', `${fmt(k.tempoBpm)} BPM${spec.target ? ' (the loop as composed)' : ''}`], ['meter', `${k.bars} × ${k.slotsPerBar}`], ['root', k.root], ['baseHz', fmt(k.baseHz, 2)], ['onsets', spec.stats.onsets.toLocaleString()],
    ['tones', spec.stats.tones.toLocaleString()], ['table', k.table], ['composed in', `${fmt(lastMs, 0)} ms`], ['chords', spec.chords.map((c) => c.name).join(' ')],
    ...(spec.target ? [['clip', `${spec.target.clip.name} · ${spec.target.placement.hits}/${spec.target.placement.J} hit · ${fmt(spec.target.tempoBpm)} BPM`]] : []),   // MIDI targets (phase B)
    ...(spec.input.progression ? [['progression', `${spec.chords.filter((c) => c.targeted).length}/${spec.chords.length} targeted (${k.leader})${spec.chords.some((c) => c.fallback) ? `, fallback on bar ${spec.chords.filter((c) => c.fallback).map((c) => c.bar + 1).join(', ')}` : ''}`]] : []),
    ...(drums ? [['drums', `${drums.mode}${drums.enabled ? '' : ' (off)'} · ${drums.stats.total} strokes`]] : [])];
}

/** what each knob shows beside it: { [name]: { text, over } } — what Compose chose, or "asked:" when overridden; and
 *  the table it ran */
export function knobChosen(spec, knobs) {
  const out = {};
  if (!spec || spec.refused) { for (const f of KNOB_FIELDS) out[f.name] = { text: '', over: false }; out.table = { text: '', over: false }; return out; }
  const k = spec.knobs, asked = (what) => spec.decisions.find((d) => d.what === what)?.value;
  for (const f of KNOB_FIELDS) {
    const over = knobs[f.name] != null;
    let v = f.name === 'modulation' ? (k.modulation ? 'on' : 'off') : k[f.name];
    if (f.name === 'settlePasses') { const st = spec.stats.settle || {}; v = `${asked('settlePasses') ?? '–'} · ${st.rounds ?? 0} used${st.oscillated ? ', oscillated' : st.converged ? ', settled' : ', cap hit'}`; }
    if (f.name === 'presence') v = asked('presence') ?? 'cluster';
    out[f.name] = { text: over ? `asked: ${v}` : `chose ${v}`, over };
  }
  out.table = { text: `ran ${k.table}`, over: false };
  return out;
}

/** the decisions list: Compose's, then the drums' own (as they play now), then what each drum bar plays and why;
 *  [{ what, value (JSON), why }] */
export function decisionRows(spec, drums) {
  const drumRows = drums ? [...drums.decisions, ...drums.bars.map((b) => ({ what: `drums.bar ${b.bar + 1}`, value: b.fill ? `${b.mode} + fill` : b.mode, why: b.why }))] : [];
  return [...(spec?.decisions || []), ...drumRows].map((d) => ({ what: d.what, value: JSON.stringify(d.value), why: d.why }));
}

// ── the progression editor ──
/** how many of the most heard roots the editor lists first */
export const MOST_HEARD = 8;
/** one root candidate as a menu entry: { value, text, title } */
export const rootOption = (c, rc) => ({
  value: c.ratio, text: `${c.ratio} · ${c.name} · ${c.cents.toFixed(1)}¢ · ${c.presence}×`,
  title: `${c.members} tone${c.members === 1 ? '' : 's'} in its ±${rc.frameCentsEachSide}¢ cluster, heard ${c.presence} times (${(100 * c.share).toFixed(1)} %)${c.isRoot ? '; the base root' : ''}${c.offGrid ? '; off the grid: a retune' : ''}`,
});
/** the menu's groups: the most heard, then all by pitch from the root */
export const rootGroups = (rc) => ({ heard: [...rc.candidates].sort((a, b) => b.presence - a.presence).slice(0, MOST_HEARD).map((c) => rootOption(c, rc)), all: rc.candidates.map((c) => rootOption(c, rc)) });
/** a pinned ratio that isn't a cluster's representative (still a tone of the row) */
export const strayRootOption = (ratio) => ({ value: ratio, text: `${ratio} (a tone of the row, not a cluster's loudest)`, title: '' });
/** the chord a bar got, under its select ('' before a compose reached it) */
export const chordGot = (c) => ({ text: c ? `${c.targeted ? 'asked → ' : 'chose '}${c.name}${c.fallback ? ' (fallback)' : ''}` : '', over: !!c?.targeted });
/** the editor's note */
export const progressionNote = (roots) => { const asked = roots.filter(Boolean).length; return asked ? `${asked} of ${roots.length} bars asked` : 'every bar auto: Compose leads with the melody'; };

// ── the lanes ──
/** each bar's length and the grid columns that make each bar as wide as it lasts */
export function barColumns(spec) {
  const T = spec.knobs.cycleSeconds, starts = spec.timeline.barStarts, N = starts.length;
  const lens = starts.map((t, i) => (i + 1 < N ? starts[i + 1] : T) - t);
  const barOf = (time) => { let k = 0; while (k + 1 < N && starts[k + 1] <= time + 1e-9) k++; return k; };
  return { starts, lens, cols: lens.map((l) => `${l.toFixed(4)}fr`).join(' '), barOf };
}
export const noteTitle = (n) => `${n.ratio} ×2^${n.octave} · ${n.hz.toFixed(1)} Hz · ${n.duration.toFixed(3)} s${n.retrigger ? '' : ' (glide)'}`;
export const chordTitle = (ch) => `${ch.quality}, root ${ch.rootTone}${ch.targeted ? ', the root asked' : ''}${ch.fallback ? ` (fallback: ${ch.fallback})` : ''}`;
export const modulationLabel = (m) => ({ text: `↻ ${m.cents >= 0 ? '+' : ''}${m.cents.toFixed(1)}¢`, title: `retuned from here: ${m.rawCents.toFixed(1)}¢ from the base fundamental` });
export const drumBarLabel = (b) => `${b.mode}${b.fill ? ' + fill' : ''}`;
export const drumHitTitle = (h) => `${h.voice} · bar ${h.bar + 1}, slot ${h.pos} · ${h.time.toFixed(3)} s · velocity ${h.velocity.toFixed(2)} · ${h.snap}`;
