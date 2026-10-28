// claves.js — the row's claves: each layer cut into bars, a tone set leaving a clave in each bar; the claves ranked for
// comping, their partners, and one laid on the composition's bars (COMP_ARP_ORDER.md, Amendment 1: decided 5–6, R1–R3).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
// Ported from Overworld's rhythm-claves.js (`readRhythm`, `layerTones`, `tonesOfPitchClasses`, `barSizes`, `toneSets`,
// `layerClaves`, `claveTable`) and chunk-comping.js (`COMP_RULES`, `claveOf`, `chunkClaves` as `rowClaves`,
// `scoreClave`, `compCandidates`, `clavePartners`), rule for rule. The words are theirs:
//
//   tone set   the tones that may sound. A strike whose tone is in the set is an onset; any other strike is a silent
//              step. Sets with no tone in common leave claves with no step in common, and laid together they are the
//              clave of the two sets joined.
//   bar        `size` strikes of the layer, counted from the cycle's start (a short last bar is clipped).
//   clave      a bar's onsets as a pattern over its steps ('x' sounds, '.' is silent); its id is 'steps:pattern'.
//   bar sizes  layer a strikes with layer b every a/gcd(a, b) of its strikes; 'meeting' sizes are those at which another
//              layer strikes on every bar's first step.
//   table      the claves over the layers, bar sizes and tone sets coarse to fine: every tone but 1/1, each 12-step
//              grid step holding two of the layer's tones or more, each tone alone. A bar sounding every step is the
//              pulse, not a clave, and is left out, as is one with fewer onsets than asked.
//   ranking    COMP_RULES: sizes 3–16, at least 2 onsets, the mean of held, density (1 inside 25–50 % of the steps) and
//              fit (straight 4/8/16: 1, triplet 3/6/12: 0.75, other: 0.4).
//   partners   claves of the same layer and bar size under a tone set with no tone of the clave's own: they never share
//              a step with it.
//
// What changed on the way in (Composer/DESIGN_NOTES.md, "The clave (Amendment 1, phase C core)"):
//   the row    the Composer's row (row.js), read in place: its active layers (ascending, as the kernel sorts them; a
//              layer is named by its value, or by its letter when two layers share one), each strike's tone, register and
//              node (on a superrow, whose nodes are (tick, tone) pairs, a strike is its tick's first node). Tones are the
//              row's EXACT fractions (the kernel spells a tone past a denominator of 1000 by rounding),
//              so on a row whose tones the kernel rounds the table can differ from chunk-tunes'.
//   one rhythm chunk-tunes pools the claves of a chunk's many rhythms, and `held` is the share of them that hold a clave.
//              A composition is one rhythm, so every clave is held by it and that term says nothing. The Composer reads
//              `held` as RECURRENCE: the bars of the table that hold the clave, over the most any clave of the same step
//              count has (`compCandidates(pool, { held: 'bars' })`; the port's default is still chunk-tunes' 'rhythms').
//   sizes      'meeting' finds nothing up to 16 strikes on a row whose layers share no small factor (768:769, 768:784,
//              the 16k row: a bar of 4099 meets nothing short of the whole layer). Decided 5 says the clave transcends
//              the numbers' scale, so `rowClaves` falls back tier by tier: 'meeting', then 'whole' (every size that cuts
//              a layer whole), then 'every' (each size 3–16, a clipped last bar left out), the first tier with a
//              candidate winning. `claveTable` gains `sizes: 'every'` for it; a number and 'whole' / 'meeting' are theirs.
//   cost       a dense row has thousands of tones a layer, so thousands of one-tone sets. A one-tone set is read from
//              the bar's own strikes (a tone absent from a bar is its silent pattern), not by walking the layer once a
//              set: the same rows in the same order (assert-claves.mjs checks it against `layerClaves`, set by set),
//              in a pass a cut. `clavePartners` reads them the same way.
//   curated    the drum patterns' clave lines (drum-patterns.js: son and rumba, two bars of 8 steps; bossa's rim, 16
//              steps) are choices beside the mined ones (decided 5), by name. A pass of a clave may span 2 bars (`span`: son, rumba).
//   laying     (R3, chunk-comping's `compStrokes`, adapted) a pass of the clave a bar (or `span` bars): step j of n at
//              place j·S·span/n slots, landed on the row's onset nearest it within half-way to the neighbouring places of
//              the clave's own n-step grid, then one place wider, else silent: drums.js `landPlace`, reused. A step lands
//              inside its own bar, or in a chart's split bar inside the span its place falls in (that span's chord).
//   fill       (decided 6) the partner, or with none the complement of the clave's steps Euclid-thinned to its own onset
//              count (`complementClave`).
//   words      (phase E, the window) `claveText` (the pattern a bar a group), `claveSource` ('from layer A · 4 steps',
//              'son clave 3-2'), `claveSetText` (a tone set's id in words). A live switch is rearrange.js `reclave`.
//
// The frame clave (BASS_VOICING_ORDER.md Amendment 1, phase I: Avery's rule 6, P16–P18; DESIGN_NOTES "The frame clave
// (phase I)"): everything above is `claveFrom: 'pattern'`, a fixed pattern from a generic tone set landed on any layer's
// onset. By default the clave is read from the composition's chords instead (`rankFrameClaves`, `chooseFrameClave`): a
// bar's clave is the clave layer's own strikes whose tones fit that bar's frame, so the pattern changes with the chord,
// and every stroke is that layer's strike, at its own time, in frame. The curated and asked claves keep their pattern and
// land only on in-frame onsets (`layInFrame`). The section's head says the rules. Amendment 2 (rule 10, P26–P27) adds the
// narrower tone sets (root and fifth, guide tones, roots) and the density tiers the clave is chosen in (`density`:
// sparse–medium by default), and the picker's ranking comes back from rearrange.js whenever a chord changes (P30).

import { lowerBoundTick } from './row.js';
import { euclidPattern } from './cells.js';
import { DRUM_PATTERNS } from './drum-patterns.js';
import { landPlace } from './drums.js';

export const COMPOSER_CLAVES_VERSION = 'composer-claves-v1';
/** chunk-comping.js' rules, as they are */
export const COMP_RULES = Object.freeze({ minSize: 3, maxSize: 16, minOnsets: 2, share: Object.freeze([0.25, 0.5]), straight: Object.freeze([4, 8, 16]), triplet: Object.freeze([3, 6, 12]), fit: Object.freeze({ straight: 1, triplet: 0.75, other: 0.4 }) });
/** the bar-size tiers `rowClaves` tries in turn (proposed: the first with a candidate wins) */
export const SIZE_TIERS = Object.freeze(['meeting', 'whole', 'every']);
/** the curated claves (decided 5: son, rumba, bossa's rim stay as choices): the drum patterns' perc lines */
export const CURATED_NAMES = Object.freeze(['son', 'rumba', 'bossa']);
/** the ranked list's length in the trace (R2) */
export const ALTERNATES_TOP = 12;
export const COMP_RELATIONS = Object.freeze(['sync', 'fill']);
/** where the comp's clave comes from (P19): 'frame' (the default: the clave layer's strikes in each bar's frame) or
 *  'pattern' (the fixed pattern of the table above, landed on any onset: the clave before phase I, byte for byte) */
export const CLAVE_FROM = Object.freeze(['frame', 'pattern']);
/** a frame clave's tone sets, in the reading order (P16: the bar's chord classes in tune, or anything inside the bar's
 *  frame; Amendment 2, P26: the narrower ones, still inside the frame: the chord's root and fifth, its guide tones (its
 *  classes but those two), its root alone) */
export const FRAME_SETS = Object.freeze(['chord', 'frame', 'root+5th', 'guide', 'root']);
/** the comp's density (BASS_VOICING_ORDER.md Amendment 2, rule 10, P27): the tier the frame clave is chosen in, by its
 *  share of steps sounding over the bars. 'sparse-med' (the default) is sparse and medium together */
export const COMP_DENSITIES = Object.freeze(['sparse-med', 'sparse', 'medium', 'dense']);
/** each tier's band of the share (P27): sparse 10–25 %, medium 25–50 %, dense 50–85 % (under 10 %, or over 85 % and a
 *  pulse, is no tier); 'sparse-med' 10–50 %. A tier's band is also its density term's (COMP_RULES' `share`, read
 *  against the band) */
export const DENSITY_BANDS = Object.freeze({ 'sparse-med': Object.freeze([0.1, 0.5]), sparse: Object.freeze([0.1, 0.25]), medium: Object.freeze([0.25, 0.5]), dense: Object.freeze([0.5, 0.85]) });
/** with no candidate in the asked tier, the tiers tried in turn (P27: the nearest; medium's two neighbours, the sparser
 *  first: proposed) */
export const DENSITY_FALLBACK = Object.freeze({ 'sparse-med': Object.freeze(['dense']), sparse: Object.freeze(['medium', 'dense']), medium: Object.freeze(['sparse', 'dense']), dense: Object.freeze(['medium', 'sparse']) });
/** the comp's density by default (rule 10, Avery) */
export const DEFAULT_COMP_DENSITY = 'sparse-med';
/** a Fill partner shares a clave's stroke when one of its strokes is within this many slots of it (P17) */
export const SHARE_SLOTS = 0.25;

const EPS = 1e-9;
const LETTERS = 'ABCD';
const mod = (v, n) => ((v % n) + n) % n;
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
const fail = (what) => { throw new Error(`composer/claves: ${what}`); };
const onsetsOf = (pattern) => [...pattern].flatMap((ch, j) => (ch === 'x' ? [j] : []));
const centsOf = (fraction) => { const [n, d] = String(fraction).split('/').map(Number); if (!(n > 0 && d > 0)) fail(`not a ratio: ${fraction}`); const c = 1200 * Math.log2(n / d); return ((c % 1200) + 1200) % 1200; };
const stepOf = (cents, centre) => mod(Math.round((cents - centre) / 100), 12);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ── rhythm-claves.js, on the Composer's row ──

/**
 * The row read layer by layer.
 * → { version, layers (values, ascending), names (each layer's letter), grid, fundamental, nodes, tones: [{ fraction, cents,
 *     nodes }] (the row's, low to high), layer: [{ value, name, bit, period, tone, octave, node }] } — per strike: its
 *     tone (an index of `tones`), the tone's register, and its node of the row. A layer's strike k is at tick k × period.
 */
export function readRhythm(row) {
  const order = [...row.active].sort((a, b) => row.layers[a] - row.layers[b] || a - b);
  const tones = row.tones.map((fraction, t) => ({ fraction, cents: row.toneCents[t], nodes: row.toneCount[t] }));
  const layer = order.map((b) => {
    const value = row.layers[b], tone = new Uint32Array(value), octave = new Int8Array(value), node = new Uint32Array(value);
    let k = 0;
    // a strike is a tick: on a superrow (superrow.js: a node a (tick, tone) pair) the tick's first node, the lowest tone
    for (let i = 0; i < row.n; i++) if (row.owners[i] & (1 << b) && (i === 0 || row.tick[i] !== row.tick[i - 1])) { if (k < value) { tone[k] = row.tone[i]; octave[k] = row.octave[i]; node[k] = i; } k++; }
    if (k !== value) fail(`layer ${LETTERS[b]} (${value}) struck ${k} times`);
    return { value, name: LETTERS[b], bit: b, period: row.grid / value, tone, octave, node };
  });
  let fundamental = 0; for (let i = 0; i < row.n; i++) if (row.gap[i] > fundamental) fundamental = row.gap[i];
  return { version: COMPOSER_CLAVES_VERSION, layers: layer.map((L) => L.value), names: layer.map((L) => L.name), grid: row.grid, fundamental, nodes: row.n, tones, layer };
}

/** a layer by its value (the first that has it) or its letter → its index in rhythm.layer */
export function layerOf(rhythm, layer) {
  const at = typeof layer === 'string' && /^[A-D]$/.test(layer) ? rhythm.names.indexOf(layer) : rhythm.layers.indexOf(layer);
  if (at < 0) fail(`${layer} is not a layer of ${rhythm.layers.join(':')}`);
  return at;
}

/** The tones a layer strikes, low to high: [{ fraction, cents, strikes }]. */
export function layerTones(rhythm, layer) {
  const L = rhythm.layer[layerOf(rhythm, layer)], n = new Uint32Array(rhythm.tones.length);
  for (const t of L.tone) n[t]++;
  return rhythm.tones.map((t, i) => ({ fraction: t.fraction, cents: t.cents, strikes: n[i] })).filter((t) => t.strikes);
}

/** The row's tones on these steps of a 12-step grid read from `centre` (step p: within 50¢ of centre + 100p). */
export function tonesOfPitchClasses(rhythm, pitchClasses, { centre = 0 } = {}) {
  const want = new Set([...pitchClasses].map((p) => mod(Number(p), 12)));
  return rhythm.tones.filter((t) => want.has(stepOf(t.cents, centre))).map((t) => t.fraction);
}

/** the layers (values) that strike on the first step of every bar of `size` strikes of the layer at `at` */
const meetsAt = (rhythm, at, size) => rhythm.layers.filter((b, i) => i !== at && size % (rhythm.layers[at] / gcd(rhythm.layers[at], b)) === 0);

/** The sizes that cut a layer whole, small to large: [{ size, bars, ticks, meets }]. */
export function barSizes(rhythm, layer) {
  const at = layerOf(rhythm, layer), { value, period } = rhythm.layer[at], out = [];
  for (let size = 2; size <= value; size++) {
    if (value % size) continue;
    out.push({ size, bars: value / size, ticks: size * period, meets: meetsAt(rhythm, at, size) });
  }
  return out;
}

/**
 * The tone sets a layer is tried with, coarse to fine: [{ id, kind, tones }], and `step` on a step's.
 *   rest   every tone the layer strikes but 1/1 (when there are two or more)
 *   step   the layer's tones on one step of the 12-step grid read from `centre`, where two or more share it
 *   tone   each tone alone
 */
export function toneSets(rhythm, layer, { centre = 0 } = {}) {
  const mine = layerTones(rhythm, layer), out = [];
  const rest = mine.filter((t) => t.fraction !== '1/1');
  if (rest.length > 1) out.push({ id: 'rest', kind: 'rest', tones: rest.map((t) => t.fraction) });
  for (let p = 0; p < 12; p++) {
    const on = mine.filter((t) => stepOf(t.cents, centre) === p);
    if (on.length > 1) out.push({ id: `step:${p}`, kind: 'step', step: p, tones: on.map((t) => t.fraction) });
  }
  for (const t of mine) out.push({ id: `tone:${t.fraction}`, kind: 'tone', tones: [t.fraction] });
  return out;
}

/**
 * A layer cut every `size` strikes, sounding only the tones of the set (rhythm-claves.js, line for line).
 * → { layer, period, size, ticksPerBar, set, strikes, onsets, clipped, bars, claves, sequence }
 */
export function layerClaves(rhythm, { layer, size, tones }) {
  const L = rhythm.layer[layerOf(rhythm, layer)];
  if (!Number.isInteger(size) || size < 1 || size > L.value) fail(`a bar of ${size} strikes is not within 1..${L.value}`);
  const asked = new Set();
  for (const f of tones || []) { centsOf(f); asked.add(String(f)); }
  const struck = new Uint8Array(rhythm.tones.length), inSet = new Uint8Array(rhythm.tones.length);
  for (const t of L.tone) struck[t] = 1;
  rhythm.tones.forEach((t, i) => { if (struck[i] && asked.has(t.fraction)) inSet[i] = 1; });
  const bars = [], claves = [], byPattern = new Map(), sequence = [];
  let total = 0;
  for (let start = 0, index = 0; start < L.value; start += size, index++) {
    const steps = Math.min(size, L.value - start), onsets = [], sounding = [], octaves = [];
    let pattern = '';
    for (let j = 0; j < steps; j++) {
      const t = L.tone[start + j];
      if (inSet[t]) { onsets.push(j); sounding.push(rhythm.tones[t].fraction); octaves.push(L.octave[start + j]); pattern += 'x'; } else pattern += '.';
    }
    let clave = byPattern.get(pattern);
    if (clave === undefined) { clave = claves.length; byPattern.set(pattern, clave); claves.push({ pattern, steps, onsets: onsets.length, bars: [] }); }
    claves[clave].bars.push(index); sequence.push(clave); total += onsets.length;
    bars.push({ index, start, steps, onsets, tones: sounding, octaves, clave });
  }
  return {
    version: COMPOSER_CLAVES_VERSION, layer: L.value, period: L.period, size, ticksPerBar: size * L.period,
    set: rhythm.tones.filter((_, i) => inSet[i]).map((t) => t.fraction), strikes: L.value, onsets: total, clipped: L.value % size,
    bars, claves, sequence,
  };
}

/**
 * One cut (a layer at a bar size) with its strikes grouped by bar and tone, so a one-tone set's string is read from the
 * bars' own strikes. → { at, size, nb, steps(b), toneSteps: [Map(tone → [step])] by bar, barsOf: Map(tone → [bar]) }
 */
function cutOf(rhythm, at, size) {
  const L = rhythm.layer[at], nb = Math.ceil(L.value / size), toneSteps = new Array(nb), barsOf = new Map();
  for (let b = 0; b < nb; b++) {
    const start = b * size, steps = Math.min(size, L.value - start), m = new Map();
    for (let j = 0; j < steps; j++) { const t = L.tone[start + j], list = m.get(t); if (list) list.push(j); else m.set(t, [j]); }
    for (const t of m.keys()) { const list = barsOf.get(t); if (list) list.push(b); else barsOf.set(t, [b]); }
    toneSteps[b] = m;
  }
  return { at, size, nb, steps: (b) => Math.min(size, L.value - b * size), toneSteps, barsOf };
}
const patternFrom = (steps, on) => { const a = new Array(steps).fill('.'); for (const j of on) a[j] = 'x'; return a.join(''); };

/**
 * A one-tone set's claves in a cut, numbered as `layerClaves` numbers them (first appearance, the silent pattern
 * included where the tone is absent from a bar): [{ pattern, steps, onsets, count, first }] in clave order.
 */
function toneClaves(cut, tone) {
  const claves = [], byKey = new Map(), small = cut.size <= 30;
  // a pattern keyed by its steps and bit mask (by its text past 30 steps), its text made once
  const add = (on, steps, bar, n = 1) => {
    let key;
    if (small) { let mask = 0; for (const j of on) mask |= 1 << j; key = mask * 32 + steps; } else key = patternFrom(steps, on);
    let c = byKey.get(key);
    if (c === undefined) { c = claves.length; byKey.set(key, c); claves.push({ pattern: small ? null : key, on: small ? on : null, steps, onsets: on.length, count: 0, first: bar }); }
    claves[c].count += n;
  };
  const silent = (from, to) => {   // bars [from, to) without the tone: the full bars' silent pattern, then a clipped last bar's
    if (from >= to) return;
    const lastFull = cut.steps(to - 1) === cut.size ? to : to - 1;
    if (lastFull > from) add([], cut.size, from, lastFull - from);
    if (lastFull < to) add([], cut.steps(to - 1), to - 1);
  };
  let prev = -1;
  for (const b of cut.barsOf.get(tone) || []) {
    silent(prev + 1, b);
    add(cut.toneSteps[b].get(tone), cut.steps(b), b);
    prev = b;
  }
  silent(prev + 1, cut.nb);
  return claves;
}
/** a one-tone clave's text, made when it is kept */
const textOf = (x) => x.pattern ?? (x.pattern = patternFrom(x.steps, x.on));

/**
 * A coarse set's string in a cut (`layerClaves`' claves and sequence, numbered the same), keyed by bit mask so a dense
 * layer is walked once a set and a cut with no string built a bar. `inSet` is by tone index.
 * → { claves: [{ pattern, steps, onsets, count, first }], sequence: Int32Array (bar → clave), onsetsAt: Uint16Array }
 */
function setString(rhythm, at, size, inSet) {
  const L = rhythm.layer[at], nb = Math.ceil(L.value / size), claves = [], byKey = new Map();
  const sequence = new Int32Array(nb), onsetsAt = new Uint16Array(nb), small = size <= 30;
  for (let b = 0; b < nb; b++) {
    const start = b * size, steps = Math.min(size, L.value - start);
    let mask = 0, n = 0, text = small ? null : '';
    for (let j = 0; j < steps; j++) { const on = inSet[L.tone[start + j]]; if (on) n++; if (small) { if (on) mask |= 1 << j; } else text += on ? 'x' : '.'; }
    const key = small ? mask * 32 + steps : text;
    let c = byKey.get(key);
    if (c === undefined) {
      c = claves.length; byKey.set(key, c);
      let pattern = text;
      if (small) { pattern = ''; for (let j = 0; j < steps; j++) pattern += mask & (1 << j) ? 'x' : '.'; }
      claves.push({ pattern, steps, onsets: n, count: 0, first: b });
    }
    claves[c].count++; sequence[b] = c; onsetsAt[b] = n;
  }
  return { claves, sequence, onsetsAt };
}
const inSetOf = (rhythm, at, tones, toneIndex) => {
  const L = rhythm.layer[at], struck = new Uint8Array(rhythm.tones.length), inSet = new Uint8Array(rhythm.tones.length);
  for (const t of L.tone) struck[t] = 1;
  for (const f of tones) { const t = toneIndex.get(String(f)); if (t !== undefined && struck[t]) inSet[t] = 1; }
  return inSet;
};

/** the name a layer is asked by: its value, or its letter when an earlier layer has the same value */
const nameFor = (rhythm, at) => (rhythm.layers.indexOf(rhythm.layer[at].value) === at ? rhythm.layer[at].value : rhythm.layer[at].name);

/** the cuts a tier reads a layer at: [{ size, meets, whole }] */
function cutsOf(rhythm, at, sizes, maxSize) {
  const value = rhythm.layer[at].value;
  if (typeof sizes === 'number') return sizes <= value ? [{ size: sizes, meets: meetsAt(rhythm, at, sizes) }] : [];
  if (sizes === 'every') { const out = []; for (let size = 2; size <= Math.min(maxSize, value); size++) out.push({ size, meets: meetsAt(rhythm, at, size) }); return out; }
  return barSizes(rhythm, nameFor(rhythm, at)).filter((s) => s.size <= maxSize && (sizes === 'whole' || s.meets.length));
}
const checkSizes = (sizes) => {
  const own = typeof sizes === 'number';
  if (own ? !(Number.isInteger(sizes) && sizes >= 1) : !(sizes === 'whole' || sizes === 'meeting' || sizes === 'every')) fail(`bar sizes "${sizes}" are not 'whole', 'meeting', 'every' or a number of strikes`);
};

/**
 * The row's claves, one row per distinct clave of a layer, a bar size and a tone set (rhythm-claves.js `claveTable`).
 *   layers     the layers to cut (values or letters; default all, fastest first)
 *   sizes      'whole', 'meeting', 'every' (each size 2..maxSize, the last bar clipped where it doesn't divide: the
 *              Composer's), or a number of strikes
 *   maxSize, custom, minOnsets, centre: as rhythm-claves.js'
 * → [{ id, layer, name, size, steps, of, meets, clipped, set: { id, kind, tones }, clave, pattern, onsets, count, first }]
 *   id = layer/size/set id/clave (`name`, the layer's letter, is the Composer's).
 */
export function claveTable(rhythm, { layers = null, sizes = 'whole', maxSize = 64, custom = null, minOnsets = 2, centre = 0 } = {}) {
  checkSizes(sizes);
  const rows = [];
  const order = layers ? layers.map((l) => layerOf(rhythm, l)) : rhythm.layer.map((_, i) => i).reverse();
  for (const at of order) {
    const L = rhythm.layer[at], layer = L.value, name = nameFor(rhythm, at), toneIndex = new Map(rhythm.tones.map((t, i) => [t.fraction, i]));
    const sets = toneSets(rhythm, name, { centre }), inSets = {};
    if (custom && custom.length) sets.unshift({ id: 'custom', kind: 'custom', tones: [...custom] });
    for (const c of cutsOf(rhythm, at, sizes, maxSize)) {
      const of = Math.ceil(layer / c.size);
      let cut = null;
      for (const set of sets) {
        const push = (x, clave, setTones) => {
          if (x.onsets < minOnsets || x.onsets === x.steps) return;
          rows.push({
            id: `${layer}/${c.size}/${set.id}/${clave}`, layer, name: L.name, size: c.size, steps: x.steps, of, meets: c.meets, clipped: x.steps < c.size,
            set: { id: set.id, kind: set.kind, tones: setTones }, clave, pattern: textOf(x), onsets: x.onsets, count: x.count, first: x.first,
          });
        };
        if (set.kind === 'tone' && minOnsets >= 1) {
          cut ||= cutOf(rhythm, at, c.size);
          // a tone no bar strikes minOnsets times leaves no row, however its claves are numbered
          const t = toneIndex.get(set.tones[0]);
          if (!(cut.barsOf.get(t) || []).some((b) => cut.toneSteps[b].get(t).length >= minOnsets)) continue;
          toneClaves(cut, t).forEach((x, clave) => push(x, clave, [...set.tones]));
        } else {
          const S = (inSets[set.id] ||= (() => { for (const f of set.tones) centsOf(f); const inSet = inSetOf(rhythm, at, set.tones, toneIndex); return { inSet, own: rhythm.tones.filter((_, t) => inSet[t]).map((t) => t.fraction) }; })());
          setString(rhythm, at, c.size, S.inSet).claves.forEach((x, clave) => push(x, clave, S.own));
        }
      }
    }
  }
  return rows;
}

// ── chunk-comping.js, on one rhythm ──

/** a clave from its id ('steps:pattern') or a curated name ('son', 'rumba', 'bossa') → { id, steps, span (bars a pass covers), pattern, onsets (steps) (, name, label) } */
export function claveOf(id) {
  if (CURATED_NAMES.includes(id)) return curatedClave(id);
  // a frame clave's id ('frame:A/8/chord', P16) names a layer, a grain and a tone set, not a pattern: its patterns are the
  // bars' (`readFrameClave`), so `pattern` is its source in words and `onsets` is empty
  const f = parseFrameId(id);
  if (f) return { id: f.id, source: 'frame', steps: f.grain, span: 1, pattern: frameWords(f), onsets: [], from: { name: f.name, grain: f.grain, set: f.set, frame: true } };
  const [steps, pattern] = String(id ?? '').split(':');
  if (!/^\d+$/.test(steps) || !/^[x.]+$/.test(pattern || '') || pattern.length !== Number(steps)) fail(`"${id}" is not a clave ('steps:pattern', or one of ${CURATED_NAMES.join(', ')})`);
  return { id: `${steps}:${pattern}`, steps: Number(steps), span: 1, pattern, onsets: onsetsOf(pattern) };
}

/** a curated clave: the drum pattern's perc line (son and rumba over two bars of 8 steps; bossa's rim over one of 16) */
export function curatedClave(name) {
  const p = DRUM_PATTERNS[name];
  if (!CURATED_NAMES.includes(name) || !p?.perc) fail(`no curated clave "${name}" (${CURATED_NAMES.join(', ')})`);
  const pattern = p.perc.toLowerCase();
  return { id: name, name, label: p.label, steps: pattern.length, span: p.bars, pattern, onsets: onsetsOf(pattern) };
}
export const curatedClaves = () => CURATED_NAMES.map(curatedClave);

/**
 * The row's claves gathered by pattern (chunk-comping.js `chunkClaves`, over one rhythm): every row of the table at
 * these sizes, steps 3–16 and not clipped.
 * → { rhythms: 1, rows, sizes, claves: [{ id, steps, pattern, onsets, rhythms, bars (of the table, holding it), from: { layer, name, size, set, row } }] }
 *   `from` is the first row it was found in (chunk-tunes': { villageId, layers, row }).
 */
export function rowClaves(rhythm, { sizes = 'meeting', rules = COMP_RULES, centre = 0 } = {}) {
  const pool = new Map();
  let rows = 0;
  for (const row of claveTable(rhythm, { sizes, maxSize: rules.maxSize, minOnsets: rules.minOnsets, centre })) {
    rows++;
    if (row.steps < rules.minSize || row.clipped) continue;
    const id = `${row.steps}:${row.pattern}`;
    let c = pool.get(id);
    if (!c) pool.set(id, (c = { id, steps: row.steps, pattern: row.pattern, onsets: onsetsOf(row.pattern), rhythms: 1, bars: 0, from: { layer: row.layer, name: row.name, size: row.size, set: row.set.id, row: row.id } }));
    c.bars += row.count;
  }
  return { rhythms: 1, rows, sizes, claves: [...pool.values()] };
}

/**
 * how a clave ranks: { score, terms: { held, density, fit } } (chunk-comping.js). `most` is the most rhythms any clave
 * of the pool is held by; with `held: 'bars'` (the Composer's recurrence) it is the most bars of the table any clave of
 * the same step count holds, and the clave's own is its `bars`. A clave spanning `span` bars a pass is fit by its steps a bar.
 */
export function scoreClave(clave, most, rules = COMP_RULES, { held = 'rhythms' } = {}) {
  const [lo, hi] = rules.share, n = Array.isArray(clave.onsets) ? clave.onsets.length : clave.onsets, x = n / clave.steps, perBar = clave.steps / (clave.span ?? 1);
  const own = held === 'bars' ? clave.bars ?? 0 : clave.rhythms ?? 0;
  const terms = {
    held: most > 0 ? own / most : 0,
    density: x < lo ? x / lo : x > hi ? (1 - x) / (1 - hi) : 1,
    fit: rules.straight.includes(perBar) ? rules.fit.straight : rules.triplet.includes(perBar) ? rules.fit.triplet : rules.fit.other,
  };
  return { score: (terms.held + terms.density + terms.fit) / 3, terms };
}

/**
 * A pool's claves ranked, best first (chunk-comping.js): all of them, and each size's own.
 *   held   'rhythms' (chunk-tunes') or 'bars' (recurrence, the Composer's; ties then go to the more bars)
 * → { tried, sizes: [{ steps, claves }], candidates: [clave + { score, terms }] (the best `top`), bySteps, most }
 */
export function compCandidates(pool, { top = 40, rules = COMP_RULES, held = 'rhythms' } = {}) {
  const count = new Map(), mostOf = new Map();
  for (const c of pool.claves) {
    count.set(c.steps, (count.get(c.steps) || 0) + 1);
    if (held === 'bars') mostOf.set(c.steps, Math.max(mostOf.get(c.steps) || 0, c.bars || 0));
  }
  const most = pool.claves.reduce((m, c) => Math.max(m, c.rhythms || 0), 0);
  const tie = held === 'bars' ? (a, b) => (b.bars || 0) - (a.bars || 0) : (a, b) => b.rhythms - a.rhythms;
  const all = pool.claves.map((c) => ({ ...c, ...scoreClave(c, held === 'bars' ? mostOf.get(c.steps) : most, rules, { held }) }))
    .sort((a, b) => b.score - a.score || tie(a, b) || a.steps - b.steps || cmp(a.pattern, b.pattern));
  const bySteps = {};
  for (const c of all) { const list = (bySteps[c.steps] ||= []); if (list.length < top) list.push(c); }
  const sizes = [...count].sort((a, b) => a[0] - b[0]).map(([steps, claves]) => ({ steps, claves }));
  return { tried: all.length, sizes, candidates: all.slice(0, top), bySteps, most: held === 'bars' ? Object.fromEntries(mostOf) : most };
}

/**
 * The claves that go with one (chunk-comping.js `clavePartners`, over one rhythm): found in the same bar of the same
 * layer, at the clave's step count as a bar size of `sizes`, under a tone set with no tone of the clave's own set.
 * → [{ id, steps, pattern, onsets, together, rhythms }], most often found together first — none shares a step with it.
 */
export function clavePartners(rhythm, clave, { top = 40, rules = COMP_RULES, sizes = 'meeting', centre = 0 } = {}) {
  checkSizes(sizes);
  const found = new Map(), steps = clave.steps, n = clave.onsets.length;
  if ((clave.span ?? 1) !== 1 || rules.minOnsets < 1) return [];
  const credit = (pattern) => {
    const id = `${steps}:${pattern}`;
    let p = found.get(id);
    if (!p) found.set(id, (p = { id, steps, pattern, onsets: onsetsOf(pattern), together: 0, rhythms: 1 }));
    p.together++;
  };
  rhythm.layer.forEach((L, at) => {
    if (steps > L.value) return;
    const ok = typeof sizes === 'number' ? sizes === steps : sizes === 'every' ? steps <= rules.maxSize
      : L.value % steps === 0 && (sizes === 'whole' || meetsAt(rhythm, at, steps).length);
    if (!ok) return;
    const name = nameFor(rhythm, at);
    const sets = toneSets(rhythm, name, { centre }), cut = cutOf(rhythm, at, steps), nb = cut.nb;
    const toneIndex = new Map(rhythm.tones.map((t, i) => [t.fraction, i]));
    // the coarse sets (rest, steps) walked whole; a one-tone set read from the bars' own strikes
    const coarse = sets.filter((s) => s.kind !== 'tone').map((s) => ({ s, own: new Set(s.tones.map((f) => toneIndex.get(f))), str: setString(rhythm, at, steps, inSetOf(rhythm, at, s.tones, toneIndex)) }));
    const want = clave.pattern;
    // where set i holds the clave: [bars] (coarse: its string; tone t: the bars whose t-steps are the clave's)
    const sources = [];
    for (const c of coarse) { const at2 = c.str.claves.findIndex((x) => x.pattern === want); if (at2 >= 0) { const bars = []; for (let b = 0; b < nb; b++) if (c.str.sequence[b] === at2) bars.push(b); sources.push({ own: c.own, bars }); } }
    const byTone = new Map();
    for (let b = 0; b < nb; b++) {
      if (cut.steps(b) !== steps) continue;
      for (const [t, on] of cut.toneSteps[b]) if (on.length === n && patternFrom(steps, on) === want) { if (!byTone.has(t)) byTone.set(t, []); byTone.get(t).push(b); }
    }
    // in set order: the coarse sets first, then the tones low to high (toneSets' order)
    const order = sets.map((s) => (s.kind === 'tone' ? { tone: toneIndex.get(s.tones[0]) } : { coarse: coarse.find((c) => c.s === s) }));
    for (const o of order) {
      let own, bars;
      if (o.coarse) { const src = sources.find((x) => x.own === o.coarse.own); if (!src) continue; own = src.own; bars = src.bars; }
      else { bars = byTone.get(o.tone); if (!bars) continue; own = new Set([o.tone]); }
      // every other set with no tone in common: the coarse ones, then each one-tone set read from the bar's own strikes
      // (a tone absent from a bar has no onset there; the result's sort orders it whatever the walk)
      for (const p of coarse) {
        if (p === o.coarse || [...p.own].some((t) => own.has(t))) continue;
        for (const b of bars) { const k = p.str.onsetsAt[b]; if (k < rules.minOnsets || k === steps) continue; credit(p.str.claves[p.str.sequence[b]].pattern); }
      }
      for (const b of bars) for (const [t, on] of cut.toneSteps[b]) { if (own.has(t) || on.length < rules.minOnsets || on.length === steps) continue; credit(patternFrom(steps, on)); }
    }
  });
  return [...found.values()].sort((a, b) => b.rhythms - a.rhythms || b.together - a.together || cmp(a.pattern, b.pattern)).slice(0, top);
}

/** the complement of a clave's steps Euclid-thinned to its own onset count (decided 6's fallback partner, R2) */
export function complementClave(clave) {
  const free = []; for (let j = 0; j < clave.steps; j++) if (clave.pattern[j] !== 'x') free.push(j);
  const k = Math.min(clave.onsets.length, free.length), keep = euclidPattern(free.length, k), on = free.filter((_, i) => keep[i]);
  const pattern = patternFrom(clave.steps, on);
  return { id: (clave.span ?? 1) > 1 ? `${clave.id}~fill` : `${clave.steps}:${pattern}`, steps: clave.steps, span: clave.span ?? 1, pattern, onsets: on };
}

// ── the Composer's choice and laying (R2, R3) ──

/**
 * The row's comping claves, ranked (R2): the first size tier with a candidate (SIZE_TIERS), recurrence for `held`,
 * and the curated claves scored by the same rules (held by the row where their pattern is in the pool, else 0).
 * → { tier, tried: [{ sizes, rows, claves }], ranked (compCandidates' output, `top` 40), curated: [clave + score],
 *     table (the pool's claves by id) }
 */
export function rankRowClaves(rhythm, { rules = COMP_RULES, centre = 0 } = {}) {
  const tried = [];
  let pool = null, tier = null;
  for (const sizes of SIZE_TIERS) {
    const p = rowClaves(rhythm, { sizes, rules, centre });
    tried.push({ sizes, rows: p.rows, claves: p.claves.length });
    if (p.claves.length) { pool = p; tier = sizes; break; }
  }
  const ranked = compCandidates(pool ?? { claves: [] }, { held: 'bars', rules });
  const byId = new Map((pool?.claves ?? []).map((c) => [c.id, c]));
  const most = ranked.most || {};
  const curated = curatedClaves().map((c) => {
    const inPool = c.span === 1 ? byId.get(`${c.steps}:${c.pattern}`) : null, bars = inPool ? inPool.bars : 0;
    return { ...c, bars, ...scoreClave({ ...c, bars }, most[c.steps] || 0, rules, { held: 'bars' }), from: { pattern: c.name } };
  });
  return { tier, tried, ranked, curated, byId, rules };
}

/**
 * One clave for a composition (R2): asked (`clave`: 'steps:pattern' | a curated name), else the best ranked clave, ties
 * (scores within 1e-9) by the generator `rng`; with no mined candidate at all, the best curated clave the same way.
 * Its partner (Fill): the best `clavePartners`, else `complementClave`.
 * → { clave: { id, name?, label?, steps, span, pattern, onsets, score, terms, bars (of the table holding it), from }, partner: { id, steps, span,
 *     pattern, onsets, source: 'partner' | 'complement', together? }, asked, why, ranks: rankRowClaves' }
 */
export function chooseClave(rhythm, { asked = null, rng = Math.random, rules = COMP_RULES, ranks = null } = {}) {
  const R = ranks ?? rankRowClaves(rhythm, { rules });
  const pick = (list) => {
    if (!list.length) return null;
    const top = list.filter((c) => c.score >= list[0].score - EPS);
    return top.length === 1 ? top[0] : top[Math.min(top.length - 1, Math.floor(rng() * top.length))];
  };
  let chosen, why, ties = 0;
  if (asked != null) {
    const want = claveOf(asked), fromPool = want.span === 1 ? R.byId.get(want.id) : null, cur = R.curated.find((c) => c.id === want.id);
    const scored = cur ?? (fromPool ? R.ranked.candidates.find((c) => c.id === want.id) ?? { ...fromPool, ...scoreClave(fromPool, (R.ranked.most || {})[fromPool.steps] || 0, rules, { held: 'bars' }) }
      : { ...want, bars: 0, ...scoreClave({ ...want, bars: 0 }, 0, rules, { held: 'bars' }), from: { asked: true } });
    chosen = { ...scored };
    why = 'asked';
  } else {
    const list = R.ranked.candidates.length ? R.ranked.candidates : [...R.curated].sort((a, b) => b.score - a.score || cmp(a.id, b.id));
    ties = list.filter((c) => c.score >= list[0].score - EPS).length;
    chosen = { ...pick(list) };
  }
  const partners = (chosen.span ?? 1) === 1 && R.tier ? clavePartners(rhythm, chosen, { rules, sizes: R.tier }) : [];
  const partner = partners.length ? { ...partners[0], span: 1, source: 'partner' } : { ...complementClave(chosen), source: 'complement' };
  const clave = { id: chosen.id, ...(chosen.name ? { name: chosen.name, label: chosen.label } : {}), steps: chosen.steps, span: chosen.span ?? 1, pattern: chosen.pattern, onsets: [...chosen.onsets],
    score: chosen.score, terms: { ...chosen.terms }, bars: chosen.bars ?? 0, from: { ...chosen.from } };
  return { clave, partner: { id: partner.id, steps: partner.steps, span: partner.span, pattern: partner.pattern, onsets: [...partner.onsets], source: partner.source, ...(partner.together != null ? { together: partner.together } : {}) },
    asked: asked != null, ties, partners: partners.length, ranks: R };
}

/** a clave's pattern as a window shows it (phase E): one group a bar, so a 2-bar pass reads 'x..x..x. ..x.x...' */
export function claveText(clave, bar = null) {
  // a frame clave (P21): each bar's own pattern, or bar `bar`'s
  if (Array.isArray(clave?.patterns)) return bar == null ? clave.patterns.join(' ') : clave.patterns[bar] ?? '';
  const p = clave?.pattern ?? '', B = clave?.span ?? 1;
  if (B <= 1 || p.length % B) return p;
  const w = p.length / B;
  return Array.from({ length: B }, (_, b) => p.slice(b * w, (b + 1) * w)).join(' ');
}
/** a clave's tone set in words (rhythm-claves' set ids: 'rest' every tone but 1/1, 'step:k' a 12-step grid step,
 *  'tone:f' one tone) */
export const claveSetText = (set) => (set == null ? '' : set === 'rest' ? 'every tone but 1/1' : set === 'chord' ? 'the chord tones' : set === 'frame' ? 'the tones in frame'
  : set === 'root+5th' ? 'the root and fifth' : set === 'guide' ? 'the guide tones' : set === 'root' ? 'the roots'
  : set.startsWith('step:') ? `grid step ${set.slice(5)}` : set.startsWith('tone:') ? `the tone ${set.slice(5)}` : String(set));
/** where a clave came from, in a few words (phase E): 'from layer A · 4 steps' (mined), the curated pattern's name
 *  ('son clave 3-2', "bossa's rim"), 'asked' (a pattern the row's table doesn't hold); a frame clave (P21) 'layer A ·
 *  8 steps · chord tones'. A curated or asked clave read in frame says so: 'son clave 3-2 · in frame' */
export function claveSource(clave) {
  const f = clave?.from ?? {};
  if (f.frame) return frameWords(f);
  if (clave?.read === 'frame') { const own = claveSource({ ...clave, read: null }); return `${own || 'asked'} · in frame`; }
  if (f.layer != null) return `from layer ${f.name ?? f.layer} · ${clave.steps} steps`;
  if (f.pattern) return f.pattern === 'bossa' ? 'bossa\'s rim' : curatedClave(f.pattern).label;
  return f.asked ? 'asked' : '';
}

/** the ranked alternates the trace carries (R2): the top `top` mined, then the curated, each { id, name?, steps, span,
 *  pattern, onsets, score, terms, bars, from }; a frame clave's ranks (Amendment 2, P27) are its tier's, each with its
 *  `share` and `tier`. rearrange.js returns them again over the chords as they play when a chord changes (P30) */
export function claveAlternates(R, top = ALTERNATES_TOP) {
  // a frame clave (phase I) also each bar's pattern, and a clave read in frame says so (`read`)
  const one = (c) => ({ id: c.id, ...(c.name ? { name: c.name } : {}), steps: c.steps, span: c.span ?? 1, pattern: c.pattern, onsets: c.onsets.length, score: c.score, terms: { ...c.terms }, bars: c.bars ?? 0, from: { ...c.from },
    ...(c.patterns ? { patterns: [...c.patterns] } : {}), ...(c.read ? { read: c.read } : {}), ...(c.share != null ? { share: c.share, tier: c.tier } : {}) });
  return [...R.ranked.candidates.slice(0, top).map(one), ...R.curated.map(one)];
}

/**
 * A clave laid on the bars (R3): a pass of it each `clave.span` bars from the first; step j of n at place
 * (pass start)·S + j·S·span/n slots, landed by drums.js `landPlace` (half-way to the neighbouring places of the clave's
 * own grid, then one place wider) inside its bar, or the chart's span its place falls in; else silent.
 *   g        drums.js `drumGrid` of the composition (the onsets are its layers' pulses)
 *   units    [{ from, to }] the slot ranges a step may land in (the bars, or a chart's spans), in order
 *   slotOf   node → its slot (compose.js' posSlot): a landed onset the grid puts across the edge is silent
 * → { strokes: [{ bar, pass, step, place, node, tick, slot, snap }], silent: [{ bar, step, place }] }
 */
export function layClave(row, g, clave, { units, slotOf }) {
  const { N, S, P } = g, B = clave.span ?? 1, n = clave.steps, wide = (S * B) / n, h = wide / 2;
  const unitAt = new Int32Array(P).fill(-1);
  units.forEach((u, i) => { for (let j = u.from; j < u.to; j++) unitAt[j] = i; });
  const strokes = [], silent = [];
  for (let pass = 0; pass * B < N; pass++) {
    for (const j of clave.onsets) {
      const place = pass * B * S + j * wide, bar = Math.floor(place / S + EPS);
      if (bar >= N) continue;
      const slot = Math.min(P - 1, Math.floor(place + EPS)), u = units[unitAt[slot]];
      const on = u ? landPlace(g, place, h, [u.from, u.to]) : null;
      const node = on ? nodeAtTick(row, on.tick) : -1;
      if (!on || node < 0 || slotOf(node) < u.from || slotOf(node) >= u.to) { silent.push({ bar, step: j, place }); continue; }
      strokes.push({ bar, pass, step: j, place, node, tick: on.tick, slot: slotOf(node), snap: on.snap });
    }
  }
  return { strokes, silent };
}

/** the row's node at a tick (the first, on a superrow where tones share one), or −1 */
function nodeAtTick(row, tick) {
  const i = lowerBoundTick(row, tick);
  return i < row.n && row.tick[i] === tick ? i : -1;
}

// ── the frame clave (BASS_VOICING_ORDER.md Amendment 1, phase I: rule 6, P16–P18) ──
//
// Avery's rule 6: a stroke on a tone outside the chord's frame doesn't count. A bar's clave is the clave layer's own
// strikes whose tones fit that bar's frame, so the pattern changes with the chord. Read over the composition: `ctx` its
// part context (compose.js `partContext`: the slots, each onset's slot, the chord-class test) and `chordAt(slot)` the
// chord record a slot sounds under (its bar's, or a chart's span's):
//   strikes    a layer's strikes (`readRhythm`: a tick's first node) in each bar, by place. A place is in slot units over
//              the bars, a strike's its slot plus its share of the slot (the drums' `rAt`, inverted).
//   grain      n steps a bar. A layer striking m times a bar (m: its strikes in the bars over N, rounded) is read at n = m
//              when 3 ≤ m ≤ 16, at each n of 3–16 when denser, and not at all under 3. Step j of bar k is the bar's j-th
//              strike where the bar holds n of them (each strike a step), else its strike nearest place k·S + j·S/n
//              (ties: the earlier). A bar the layer doesn't strike leaves its steps silent.
//   tone set   'chord': the strike's tone one of its chord's classes in tune (compose.js `chordClass`); 'frame': inside
//              its chord's frame (±frameCentsEachSide of its class from the root, the record's `frame.inside`). A
//              strike is read under the chord of the slot it sounds in, so a chart's split bar reads it under its span's.
//   pattern    a bar's n steps, 'x' where its strike's tone is in the set. The strokes are those strikes, at their own
//              places and times: nothing is landed, so every stroke is the clave layer's and in the set. A strike that
//              two steps share is one stroke, at the first.
//   ranking    COMP_RULES over the bars' patterns: density the bars' mean (a pulse bar or one under minOnsets scores 0,
//              as the table leaves it out), fit by n (straight, triplet, other), recurrence the share of the bars whose
//              pattern another bar repeats. A candidate with no bar left in is none. The frame set reading what the
//              chord set reads is the chord set's candidate. Sorted by score, ties in the reading order (the fastest
//              layer first, then n up, chord before frame); the seed breaks a tie at the top (`chooseFrameClave`).
//   partner    (Fill, P17) the best-ranked other candidate with a stroke and none within ¼ slot of the clave's; with none,
//              each bar's free steps Euclid-thinned to the clave's mean onsets a bar (rounded), landed in frame.
//   in frame   (P18) the curated and asked claves keep their fixed pattern; a step lands only on an onset inside the
//              frame of the chord its slot sounds under, the nearest within half-way to its neighbouring places (then
//              one place wider), inside its bar or span (`layInFrame`; none: silent).
//   ids        'frame:A/8/chord': the layer's letter, the grain and the set (`frameClaveId`, `parseFrameId`).
//
// Amendment 2 (BASS_VOICING_ORDER.md, Avery's rule 10, P26–P27; DESIGN_NOTES "Comp density tiers (phase M)"):
//   sets       three narrower sets, still inside the frame (so rule 6 holds): 'root+5th' (the chord's class 0 or its
//              fifth, the class of its 6–8 interval: 7, a dim chord's 6, an aug chord's 8), 'guide' (its other classes)
//              and 'root' (class 0), each in tune as 'chord' reads them. The reading order is chord, frame, root+5th,
//              guide, root: a reading equal to an earlier set's at the same layer and grain is dropped, the earlier
//              (wider) name kept, as the frame set's twin of the chord set's is.
//   share      a candidate's strokes over its steps, over the bars: the x's of its patterns over n·N.
//   tiers      sparse 10–25 %, medium 25–50 %, dense 50–85 % of the share; under 10 % or over 85 % is no tier.
//              `density` ('sparse-med', the default: 10–50 %; 'sparse', 'medium', 'dense') asks one. The ranking is the
//              tier's candidates only, each scored by COMP_RULES with the density term read against the tier's band.
//              With none in the tier, the nearest tier's (DENSITY_FALLBACK) plays, and `density.fellBack` says so; with
//              none in any, every candidate under COMP_RULES as phase I ranked them. Fill's partner is the best of the
//              same ranking sharing no stroke (else the complement, which keeps the clave's own onsets a bar).

const FRAME_ID = /^frame:([A-D])\/(\d+)\/(chord|frame|root\+5th|guide|root)$/;
/** a frame clave's id: 'frame:<layer letter>/<grain>/<set>' */
export const frameClaveId = (name, grain, set) => `frame:${name}/${grain}/${set}`;
/** a frame clave's id read → { id, name, grain, set } | null */
export function parseFrameId(id) {
  const m = FRAME_ID.exec(String(id ?? ''));
  return m ? { id: m[0], name: m[1], grain: Number(m[2]), set: m[3] } : null;
}
/** a frame tone set in words (P21, P26) */
export const FRAME_SET_WORDS = Object.freeze({ chord: 'chord tones', frame: 'tones in frame', 'root+5th': 'root and fifth', guide: 'guide tones', root: 'roots' });
/** a frame clave's source in words (P21): 'layer A · 8 steps · chord tones' */
const frameWords = (f) => `layer ${f.name} · ${f.grain} steps · ${FRAME_SET_WORDS[f.set] ?? f.set}`;
/** a share's tier (P27): 'sparse' | 'medium' | 'dense' | null (under 10 %, or over 85 %) */
export function densityTierOf(share) {
  if (share < DENSITY_BANDS.sparse[0] - EPS || share > DENSITY_BANDS.dense[1] + EPS) return null;
  return share < DENSITY_BANDS.sparse[1] - EPS ? 'sparse' : share <= DENSITY_BANDS.medium[1] + EPS ? 'medium' : 'dense';
}
/** is a tier inside the asked density ('sparse-med' holds sparse and medium) */
const tierIn = (tier, asked) => tier != null && (asked === 'sparse-med' ? tier === 'sparse' || tier === 'medium' : tier === asked);
/** a density in words: 'sparse–medium (10–50 %)' */
export const densityWords = (d, { band = true } = {}) => `${d === 'sparse-med' ? 'sparse–medium' : d}${band && DENSITY_BANDS[d] ? ` (${DENSITY_BANDS[d].map((x) => Math.round(100 * x)).join('–')} %)` : ''}`;
const checkDensity = (d) => { if (!COMP_DENSITIES.includes(d)) fail(`a comp density is one of ${COMP_DENSITIES.join(', ')}, not ${JSON.stringify(d)}`); return d; };

/** a place (slot units, clamped to the loop) → its share of the row's cycle from the downbeat (the drums' `rAt`) */
function rAtOf(ctx, W, q) {
  const { P, starts } = ctx;
  if (q <= 0) return starts[0];
  if (q >= P) return W;
  const k = Math.min(P - 1, Math.floor(q)), a = starts[k], b = k + 1 < P ? starts[k + 1] : W;
  return a + (q - k) * (b - a);
}
/** an onset's share of the cycle from the downbeat (as partContext reads it) */
const relOfNode = (ctx, i) => mod(ctx.row.x[i] - ctx.phaseX, 1);
/** an onset's place: its slot plus its share of the slot (an onset a cropped window wraps to its last slot clamps there) */
function placeOfNode(ctx, W, i) {
  const { P, starts, posSlot } = ctx, j = posSlot[i], a = starts[j], b = j + 1 < P ? starts[j + 1] : W;
  const f = b > a ? (relOfNode(ctx, i) - a) / (b - a) : 0;
  return j + Math.min(Math.max(f, 0), 1 - 1e-9);
}
const loopEnd = (ctx) => (ctx.cells?.crop ? ctx.cells.crop.end : 1);

// per part context: each layer's strikes a bar, read once for every candidate and every chord swap
const strikesKept = new WeakMap();
/**
 * Each layer's strikes in each bar, by place (P16), fastest layer first.
 * → [{ at (its index in rhythm.layer), value, name, m (strikes a bar, rounded), grains ([n]), bars: [[{ node, place }]] }]
 */
export function frameStrikes(row, ctx, rhythm = null) {
  let kept = strikesKept.get(ctx);
  if (kept) return kept;
  const R = rhythm ?? readRhythm(row), { S, N, posSlot } = ctx, W = loopEnd(ctx), rules = COMP_RULES;
  kept = R.layer.map((L, at) => {
    const bars = Array.from({ length: N }, () => []);
    let total = 0;
    for (let k = 0; k < L.value; k++) {
      const i = L.node[k], s = posSlot[i];
      if (s < 0) continue;
      bars[Math.floor(s / S)].push({ node: i, place: placeOfNode(ctx, W, i) });
      total++;
    }
    for (const b of bars) b.sort((x, y) => x.place - y.place || x.node - y.node);
    const m = Math.round(total / N), grains = [];
    if (m >= rules.minSize && m <= rules.maxSize) grains.push(m);
    else if (m > rules.maxSize) for (let n = rules.minSize; n <= rules.maxSize; n++) grains.push(n);
    return { at, value: L.value, name: L.name, m, grains, bars };
  }).reverse();
  strikesKept.set(ctx, kept);
  return kept;
}

/** bar k's step j of n: the bar's j-th strike when it holds n, else the strike nearest place q (ties: the earlier) */
function stepStrike(st, n, j, q) {
  if (!st.length) return null;
  if (st.length === n) return st[j];
  let lo = 0, hi = st.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (st[mid].place < q) lo = mid + 1; else hi = mid; }
  // lo: the first at or past q; the one before it wins a tie
  if (lo > 0 && q - st[lo - 1].place <= st[lo].place - q + EPS) return st[lo - 1];
  return st[lo];
}

/** a chord's fifth (P26): the class of its interval of 6–8 semitones (7; a dim chord's 6, an aug chord's 8), or −1 */
const fifthOf = (c) => { const f = c.intervals.find((x) => x >= 6 && x <= 8); return f ?? -1; };
/** the tone-set test (P16, P26) on a strike's reading under its chord: `pc` its chord class in tune (−1: none), `inside`
 *  its frame's test, `fifth` the chord's fifth */
const SET_TEST = Object.freeze({
  chord: (pc) => pc >= 0,
  frame: (pc, inside) => inside,
  'root+5th': (pc, inside, fifth) => pc === 0 || (pc >= 0 && pc === fifth),
  guide: (pc, inside, fifth) => pc > 0 && pc !== fifth,
  root: (pc) => pc === 0,
});
const checkSet = (set) => SET_TEST[set] ?? fail(`no frame tone set "${set}" (${FRAME_SETS.join(', ')})`);

/**
 * A layer read at grain n under several tone sets at once (P16, P26): each step's strike found once and read once under
 * the chord its slot sounds under, over every bar or the bars of `only` (a Set).
 * → [a reading a set, in `sets`' order: { patterns: [bar → 'x..x' | null (a bar not read)], strokes: [{ bar, step, place,
 *   node, tick, slot, snap: 'strike' }] }]
 */
function readFrameGrain(ctx, chordAt, L, n, sets, { only = null } = {}) {
  const { row, S, N, posSlot } = ctx, tests = sets.map(checkSet), Q = sets.length;
  const out = sets.map(() => ({ patterns: [], strokes: [] }));
  const chars = sets.map(() => new Array(n)), own = sets.map(() => new Set());
  for (let k = 0; k < N; k++) {
    if (only && !only.has(k)) { for (const o of out) o.patterns.push(null); continue; }
    const st = L.bars[k];
    for (const o of own) o.clear();
    for (let j = 0; j < n; j++) {
      const s = stepStrike(st, n, j, k * S + (j * S) / n);
      let pc = -1, inside = false, fifth = -1;
      if (s) { const c = chordAt(posSlot[s.node]), t = row.tone[s.node]; pc = ctx.chordClass(c, t); inside = c.frame.inside[t] === 1; fifth = fifthOf(c); }
      for (let q = 0; q < Q; q++) {
        if (!s || !tests[q](pc, inside, fifth)) { chars[q][j] = '.'; continue; }
        chars[q][j] = 'x';
        if (own[q].has(s.node)) continue;
        own[q].add(s.node);
        out[q].strokes.push({ bar: k, step: j, place: s.place, node: s.node, tick: row.tick[s.node], slot: posSlot[s.node], snap: 'strike' });
      }
    }
    for (let q = 0; q < Q; q++) out[q].patterns.push(chars[q].join(''));
  }
  return out;
}

/**
 * A layer read at grain n under a tone set (P16, P26), over every bar or the bars of `only` (a Set).
 * → { patterns: [bar → 'x..x' | null (a bar not read)], strokes: [{ bar, step, place, node, tick, slot, snap: 'strike' }] }
 */
export function readFrameLayer(ctx, chordAt, L, n, set, { only = null } = {}) {
  return readFrameGrain(ctx, chordAt, L, n, [set], { only })[0];
}

/** a frame candidate's score over its bars' patterns (P16): { score, terms: { held, density, fit }, bars (recurring), counted } */
export function scoreFrameClave(patterns, n, rules = COMP_RULES) {
  const [lo, hi] = rules.share, N = patterns.length, ons = patterns.map((p) => onsetsOf(p).length);
  const counted = ons.map((x) => x >= rules.minOnsets && x < n);
  let density = 0;
  const seen = new Map();
  ons.forEach((o, k) => { if (!counted[k]) return; const x = o / n; density += x < lo ? x / lo : x > hi ? (1 - x) / (1 - hi) : 1; seen.set(patterns[k], (seen.get(patterns[k]) || 0) + 1); });
  let bars = 0; patterns.forEach((p, k) => { if (counted[k] && seen.get(p) > 1) bars++; });
  const terms = { held: bars / N, density: density / N, fit: rules.straight.includes(n) ? rules.fit.straight : rules.triplet.includes(n) ? rules.fit.triplet : rules.fit.other };
  return { score: (terms.held + terms.density + terms.fit) / 3, terms, bars, counted: counted.filter(Boolean).length };
}

/** a frame candidate's pattern for the one-pattern views: its most repeated counted bar's (ties: the earliest), else bar 1's */
function framePattern(patterns, rules = COMP_RULES) {
  const count = new Map(); let best = null;
  patterns.forEach((p) => { const o = onsetsOf(p).length; if (o >= rules.minOnsets && o < p.length) count.set(p, (count.get(p) || 0) + 1); });
  for (const p of patterns) if (count.has(p) && (best == null || count.get(p) > count.get(best))) best = p;
  return best ?? patterns[0] ?? '';
}

/** a candidate's share (P27): its patterns' x's over its steps */
const shareOf = (patterns, n) => patterns.reduce((a, p) => a + onsetsOf(p).length, 0) / (n * patterns.length);

/** a frame candidate from its reading (the record chooseClave's claves have, plus `patterns`, its `strokes`, its `share`
 *  and `tier` (P27)), scored by `rules` (a tier's: its band as the density term's share) */
function frameCandidate(L, n, set, got, rules) {
  const s = scoreFrameClave(got.patterns, n, rules), pattern = framePattern(got.patterns, rules), share = shareOf(got.patterns, n);
  return { id: frameClaveId(L.name, n, set), source: 'frame', steps: n, span: 1, pattern, onsets: onsetsOf(pattern), patterns: got.patterns,
    score: s.score, terms: s.terms, bars: s.bars, counted: s.counted, share, tier: densityTierOf(share), from: { layer: L.value, name: L.name, grain: n, set, frame: true }, strokes: got.strokes };
}
/** COMP_RULES with a tier's band as its density term's share (P27) */
const rulesOf = (rules, band) => (band ? { ...rules, share: band } : rules);

/**
 * The composition's frame claves, ranked (P16), in a density tier (P27), with the curated claves (scored as fixed
 * patterns, recurrence 0).
 *   density   'sparse-med' (the default), 'sparse', 'medium' or 'dense'
 * → { source: 'frame', tier: 'frame', density: { asked, played (a tier, or null: none in any), band, fellBack, counts:
 *     { sparse, medium, dense, none } }, ranked: { tried, read (every counted candidate), candidates (the tier's) }, curated,
 *     byId, rules (the tier's), strikes } (rankRowClaves' shape, so `claveAlternates` and the trace read either)
 */
export function rankFrameClaves(row, ctx, chordAt, { rules = COMP_RULES, rhythm = null, density = DEFAULT_COMP_DENSITY } = {}) {
  checkDensity(density);
  const strikes = frameStrikes(row, ctx, rhythm), readings = [];
  let tried = 0;
  for (const L of strikes) for (const n of L.grains) {
    const got = readFrameGrain(ctx, chordAt, L, n, FRAME_SETS);
    tried += FRAME_SETS.length;
    // a reading equal to an earlier (wider) set's at this layer and grain is that set's candidate (P16, P26)
    got.forEach((g, q) => { if (!got.slice(0, q).some((h) => h.patterns.every((p, k) => p === g.patterns[k]))) readings.push({ L, n, set: FRAME_SETS[q], got: g }); });
  }
  // every counted reading, scored as phase I scores (COMP_RULES), then its tier by its share
  const read = readings.map((x) => frameCandidate(x.L, x.n, x.set, x.got, rules)).filter((c) => c.counted);
  const counts = { sparse: 0, medium: 0, dense: 0, none: 0 };
  for (const c of read) counts[c.tier ?? 'none']++;
  // the asked tier, else the nearest with a candidate, else every candidate as phase I ranked them
  const played = [density, ...DENSITY_FALLBACK[density]].find((d) => read.some((c) => tierIn(c.tier, d))) ?? null;
  const band = played ? DENSITY_BANDS[played] : null, R = rulesOf(rules, band);
  // the tier's candidates scored again, their density term read against its band
  const list = played ? read.filter((c) => tierIn(c.tier, played)).map((c) => frameCandidate(strikes.find((L) => L.name === c.from.name), c.steps, c.from.set, c, R)) : read;
  const candidates = list.sort((a, b) => b.score - a.score);   // stable: ties stay in the reading order
  const curated = curatedClaves().map((c) => ({ ...c, bars: 0, ...scoreClave({ ...c, bars: 0 }, 0, rules, { held: 'bars' }), from: { pattern: c.name }, read: 'frame' }));
  return { source: 'frame', tier: 'frame', density: { asked: density, played, band: band ? [...band] : [...rules.share], fellBack: played !== density, counts },
    ranked: { tried, read: read.length, candidates }, curated, byId: new Map(candidates.map((c) => [c.id, c])), rules: R, strikes };
}

/**
 * The in-frame onsets each unit holds (P18): [unit → [{ node, r }]] by place, an onset kept when its tone is inside
 * the frame of the chord its slot sounds under.
 */
function inFrameOnsets(ctx, chordAt, units) {
  const { row, posSlot, P } = ctx, unitAt = new Int32Array(P).fill(-1), out = units.map(() => []);
  units.forEach((u, i) => { for (let j = u.from; j < u.to; j++) unitAt[j] = i; });
  for (let i = 0; i < row.n; i++) {
    const s = posSlot[i];
    if (s < 0 || unitAt[s] < 0 || !chordAt(s).frame.inside[row.tone[i]]) continue;
    out[unitAt[s]].push({ node: i, r: relOfNode(ctx, i) });
  }
  for (const list of out) list.sort((a, b) => a.r - b.r || a.node - b.node);
  return { unitAt, out };
}
/** the in-frame onset nearest r with lo ≤ its place ≤ hi (ties: the earlier) → { node, d } | null */
function nearestIn(list, r, lo, hi) {
  let best = null;
  for (const x of list) {
    if (x.r < lo - 1e-12) continue;
    if (x.r > hi + 1e-12) break;
    const d = x.r - r;
    if (!best || Math.abs(d) < Math.abs(best.d) - 1e-15) best = { node: x.node, d };
  }
  return best;
}

/**
 * Places landed on in-frame onsets only (P18; P17's complement): each { bar, step, place } on the in-frame onset nearest
 * it within ±h slot units (then ±2h: 'wide'), inside its unit (a bar, or a chart's span), else silent.
 *   units   [{ from, to }] (compose.js `compUnitsOf`)
 * → { strokes: [{ bar, step, place, node, tick, slot, snap }], silent: [{ bar, step, place }] }
 */
export function landInFrame(ctx, chordAt, places, h, { units, onsets = null }) {
  const { row, posSlot, P } = ctx, W = loopEnd(ctx), own = onsets ?? inFrameOnsets(ctx, chordAt, units), strokes = [], silent = [];
  for (const p of places) {
    const slot = Math.min(P - 1, Math.floor(p.place + EPS)), ui = own.unitAt[slot], u = units[ui];
    if (!u) { silent.push(p); continue; }
    const r = rAtOf(ctx, W, p.place), a = rAtOf(ctx, W, u.from), b = rAtOf(ctx, W, u.to) - 2e-12;
    let on = nearestIn(own.out[ui], r, Math.max(a, rAtOf(ctx, W, p.place - h)), Math.min(b, rAtOf(ctx, W, p.place + h))), snap = 'slot';
    if (!on) { on = nearestIn(own.out[ui], r, Math.max(a, rAtOf(ctx, W, p.place - 2 * h)), Math.min(b, rAtOf(ctx, W, p.place + 2 * h))); snap = 'wide'; }
    if (!on) { silent.push(p); continue; }
    strokes.push({ bar: p.bar, step: p.step, place: p.place, node: on.node, tick: row.tick[on.node], slot: posSlot[on.node], snap });
  }
  return { strokes, silent };
}

/** a fixed clave (curated or asked, P18) laid a pass each `span` bars, each step landed in frame (`landInFrame`) */
export function layInFrame(ctx, chordAt, clave, { units, onsets = null, only = null }) {
  const { N, S } = ctx, B = clave.span ?? 1, n = clave.steps, wide = (S * B) / n, places = [];
  for (let pass = 0; pass * B < N; pass++) for (const j of clave.onsets) {
    const place = pass * B * S + j * wide, bar = Math.floor(place / S + EPS);
    if (bar < N && (!only || only.has(bar))) places.push({ bar, step: j, place });
  }
  return landInFrame(ctx, chordAt, places, wide / 2, { units, onsets });
}

/** the least distance in slots between a stroke of `a` and one of `b`, each at its onset's own place (a landed step's
 *  `place` is the step's), round the loop (Infinity if either has none) */
function nearestStroke(ctx, a, b) {
  if (!a.length || !b.length) return Infinity;
  const W = loopEnd(ctx), at = (x) => placeOfNode(ctx, W, x.node), xs = b.map(at).sort((x, y) => x - y), P = ctx.P;
  let best = Infinity;
  for (const s of a) {
    const p = at(s);
    let lo = 0, hi = xs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid] < p) lo = mid + 1; else hi = mid; }
    for (const q of [xs[lo % xs.length], xs[(lo - 1 + xs.length) % xs.length]]) { const d = Math.abs(q - p); best = Math.min(best, d, P - d); }
  }
  return best;
}
/** does a candidate share a stroke with the clave (P17: one of its strokes within ¼ slot of one of the clave's) */
export const sharesStroke = (ctx, a, b) => nearestStroke(ctx, a.strokes, b.strokes) <= SHARE_SLOTS + EPS;

/**
 * The complement of a frame clave (P17's fallback): each bar's free steps of its own pattern, Euclid-thinned to the
 * clave's mean onsets a bar (rounded), each landed in frame at its place. → the partner record with its strokes
 */
function frameComplement(ctx, chordAt, clave, { units, onsets, per = null, only = null }) {
  const { N, S } = ctx, n = clave.steps, total = clave.patterns.reduce((a, p) => a + onsetsOf(p).length, 0), want = per ?? Math.round(total / N);
  const patterns = [], places = [];
  clave.patterns.forEach((p, k) => {
    if (only && !only.has(k)) { patterns.push(null); return; }
    const free = []; for (let j = 0; j < n; j++) if (p[j] !== 'x') free.push(j);
    const keep = euclidPattern(free.length, Math.min(want, free.length)), on = free.filter((_, i) => keep[i]);
    patterns.push(patternFrom(n, on));
    for (const j of on) places.push({ bar: k, step: j, place: k * S + (j * S) / n });
  });
  const got = landInFrame(ctx, chordAt, places, S / n / 2, { units, onsets }), pattern = only ? null : framePattern(patterns);
  return { id: `${clave.id}~fill`, steps: n, span: 1, pattern, onsets: pattern == null ? null : onsetsOf(pattern), patterns, per: want, source: 'complement', strokes: got.strokes, silent: got.silent.length };
}

/**
 * One clave for a composition, read from its frames (P16–P18): asked (a frame id, a curated name or 'steps:pattern'),
 * else the best frame candidate, ties (within 1e-9) by the generator `rng`; with no candidate, the best curated clave
 * the same way, laid in frame. Its partner (Fill, P17): the best-ranked other candidate sharing no stroke with it, else
 * the complement landed in frame (a frame clave's, bar by bar; a fixed clave's, `complementClave`).
 * → chooseClave's { clave, partner, asked, ties, partners, ranks }, the clave and the partner carrying their `strokes`
 *   (and `silent`: a count) and `read: 'frame'`; a frame clave and a frame partner also `patterns` and `from.frame`
 */
export function chooseFrameClave(row, ctx, chordAt, { asked = null, rng = Math.random, rules = COMP_RULES, ranks = null, units, density = DEFAULT_COMP_DENSITY } = {}) {
  const R = ranks ?? rankFrameClaves(row, ctx, chordAt, { rules, density });
  const onsets = inFrameOnsets(ctx, chordAt, units);
  const pick = (list) => {
    if (!list.length) return null;
    const top = list.filter((c) => c.score >= list[0].score - EPS);
    return top.length === 1 ? top[0] : top[Math.min(top.length - 1, Math.floor(rng() * top.length))];
  };
  const fixed = (c) => { const got = layInFrame(ctx, chordAt, c, { units, onsets }); return { ...c, read: 'frame', strokes: got.strokes, silent: got.silent.length }; };
  let chosen, ties = 0;
  if (asked != null) {
    const f = parseFrameId(asked);
    if (f) {
      // a frame id the ranking left out (no bar left in, a wider set's twin, or outside the tier) is read as asked,
      // scored as the tier's are
      let c = R.byId.get(f.id);
      if (!c) {
        const L = R.strikes.find((x) => x.name === f.name) ?? fail(`"${asked}": no layer ${f.name} in ${R.strikes.map((x) => x.name).join(', ')}`);
        if (!L.grains.includes(f.grain)) fail(`"${asked}": layer ${f.name} strikes ${L.m} times a bar, so it is read at ${L.grains.length ? L.grains.join(', ') : 'no grain'}, not ${f.grain}`);
        c = frameCandidate(L, f.grain, f.set, readFrameLayer(ctx, chordAt, L, f.grain, f.set), R.rules ?? rules);
      }
      chosen = { ...c, read: 'frame', silent: 0 };
    } else {
      const want = claveOf(asked), cur = R.curated.find((c) => c.id === want.id);
      chosen = fixed(cur ?? { ...want, bars: 0, ...scoreClave({ ...want, bars: 0 }, 0, rules, { held: 'bars' }), from: { asked: true } });
    }
  } else if (R.ranked.candidates.length) {
    ties = R.ranked.candidates.filter((c) => c.score >= R.ranked.candidates[0].score - EPS).length;
    chosen = { ...pick(R.ranked.candidates), read: 'frame', silent: 0 };
  } else {
    const list = [...R.curated].sort((a, b) => b.score - a.score || cmp(a.id, b.id));
    ties = list.filter((c) => c.score >= list[0].score - EPS).length;
    chosen = fixed(pick(list));
  }
  // the partner: the best-ranked other frame candidate with a stroke and none within ¼ slot of the clave's
  const others = R.ranked.candidates.filter((c) => c.id !== chosen.id && c.strokes.length);
  const free = others.filter((c) => !sharesStroke(ctx, c, chosen));
  let partner;
  if (free.length) partner = { ...free[0], source: 'partner', silent: 0 };
  else if (chosen.patterns) partner = frameComplement(ctx, chordAt, chosen, { units, onsets });
  else { const c = complementClave(chosen), got = layInFrame(ctx, chordAt, c, { units, onsets }); partner = { ...c, source: 'complement', strokes: got.strokes, silent: got.silent.length }; }
  const keep = (x) => {
    const { strokes, silent, patterns, from, score, terms, bars, counted, ...rest } = x;
    return { ...rest, ...(score != null ? { score, terms: { ...terms }, bars: bars ?? 0 } : {}), ...(from ? { from: { ...from } } : {}), ...(patterns ? { patterns: [...patterns] } : {}),
      onsets: [...x.onsets], read: 'frame', strokes: strokes.map((s) => ({ ...s })), silent };
  };
  // the density it was chosen in (P27): asked, the tier that played (none: no candidate in any), and whether it fell back
  const compDensity = R.density ? { asked: R.density.asked, played: R.density.played, fellBack: R.density.fellBack } : null;
  return { clave: { ...keep(chosen), ...(compDensity ? { compDensity } : {}) }, partner: keep(partner), asked: asked != null, ties, partners: free.length, ranks: R, source: 'frame' };
}

/** a stroke as spec.clave keeps it (compose.js `layCompClave`'s order), timed by the part context */
const timedStroke = (ctx, y) => ({ bar: y.bar, step: y.step, place: y.place, node: y.node, tick: y.tick, time: ctx.timeOf(ctx.row.tick[y.node]), slot: y.slot, snap: y.snap });
const xsOf = (patterns) => patterns.reduce((a, p) => a + onsetsOf(p).length, 0);

/**
 * A clave read in frame (spec.clave, or its partner; `read: 'frame'`) read again over some bars under the chords as they
 * are now (P20: a chord swap): a frame clave at the same layer, grain and set; a frame complement from the clave's new
 * patterns (`of`) at the same onsets a bar (`per`); a fixed clave (curated, asked, or a fixed clave's complement) its
 * steps landed in frame again. The other bars' strokes are kept as they are. `bars` a Set; `units` compose.js
 * `compUnitsOf`. → the record with its `patterns`, `strokes` (timed, in bar order) and `silent` (a count) new, and no
 * `shared` (layCompClave's, marked again by the caller)
 */
export function rereadClave(row, ctx, chordAt, rec, bars, { units, of = null }) {
  const keep = rec.strokes.filter((x) => !bars.has(x.bar)).map(({ shared, ...x }) => x), was = rec.strokes.length - keep.length;
  let got;
  if (rec.from?.frame) {
    const L = frameStrikes(row, ctx).find((x) => x.name === rec.from.name) ?? fail(`no layer ${rec.from.name}`);
    got = readFrameLayer(ctx, chordAt, L, rec.from.grain, rec.from.set, { only: bars });
  } else if (rec.source === 'complement' && rec.patterns) {
    got = frameComplement(ctx, chordAt, of ?? fail('a frame complement is read again from its clave (`of`)'), { units, per: rec.per, only: bars });
  } else got = layInFrame(ctx, chordAt, rec, { units, only: bars });
  const patterns = rec.patterns ? rec.patterns.map((p, k) => (bars.has(k) ? got.patterns[k] : p)) : null;
  const strokes = [...keep, ...got.strokes.map((y) => timedStroke(ctx, y))].sort((a, b) => a.bar - b.bar || a.step - b.step || a.node - b.node);
  // silent: a frame clave lands nothing (none); a frame complement, its steps less its strokes; a fixed clave, its silent
  // steps in the other bars (the same places laid again) and the bars' new ones
  const silent = rec.from?.frame ? 0 : patterns ? xsOf(patterns) - strokes.length : rec.silent - (got.strokes.length + got.silent.length - was) + got.silent.length;
  // a frame clave's share and tier (Amendment 2, P27) read again from its new patterns; its score stays the one it was chosen by
  const share = rec.from?.frame && rec.share != null ? shareOf(patterns, rec.steps) : null;
  return { ...rec, ...(patterns ? { patterns } : {}), strokes, silent, ...(share != null ? { share, tier: densityTierOf(share) } : {}) };
}
