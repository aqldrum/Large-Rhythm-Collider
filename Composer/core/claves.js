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

/** the ranked alternates the trace carries (R2): the top `top` mined, then the curated, each { id, name?, steps, span, pattern, onsets, score, terms, bars, from } */
export function claveAlternates(R, top = ALTERNATES_TOP) {
  const one = (c) => ({ id: c.id, ...(c.name ? { name: c.name } : {}), steps: c.steps, span: c.span ?? 1, pattern: c.pattern, onsets: c.onsets.length, score: c.score, terms: { ...c.terms }, bars: c.bars ?? 0, from: { ...c.from } });
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
