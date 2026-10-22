// drums.js — the Drums (Perc) part: a pattern a bar, keyed to the composition's own time grid, every stroke an onset
// the row already plays.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. `arrangeDrums(spec, options)` reads only the
// spec (its input layers, knobs, timeline, stats.grid and parts), never the row, so the lab re-arranges the drums of a
// spec on the main thread without composing again (a few hundred strokes, well under a millisecond); compose() calls the
// same function at its end. Every choice here is proposed, not ruled, unless marked decided.
//
//   onsets     the row's onsets are its layers' pulses: layer v strikes every grid / v ticks (the grid is the layers'
//              lcm), so the onset nearest any place in the cycle is the nearest pulse of one of at most four layers,
//              found without the row (`drumGrid`). A stroke's strikes are the layers striking its tick, as row.js counts.
//   beats      the bar's S slots cut in 4 beats as Partitions cuts a block (cells.js `partitionSizes`, ported from
//              PartitionsBlocks.calculatePartitionSizes): any S, odd or prime too (S = 7: 1, 2, 2, 2 slots). Under 4
//              slots a bar is cut on half or quarter slots (S·m sub-slots, m = ceil(4 / S), as cells.js subdivides a
//              grid smaller than P), and a sub-slot beat lands on a real onset inside its slot (`beatsOf`).
//   landing    a stroke aims at a place in the bar (slot units: a whole slot is its anchor, a half slot the midpoint to
//              the next anchor) and lands on the row's onset nearest it inside that place's window: half-way to the
//              neighbouring places of the bar's 1/m-slot grid (for whole slots, the swing-0.5 window of cells.js, a
//              midpoint going to the earlier slot). With no onset there it looks once more, a whole place either side
//              (`snap: 'wide'`); with none there either, the stroke is left out (`stats.silent`). Anchors are grid
//              ticks, not always onsets: the downbeat (the phase) is one, the other anchors are landed on their
//              nearest onset. A stroke taken from a part's note, or from the partition layer, is that onset itself.
//   modes      backbeat   the default (Avery, the sprint brief): kick on beats 1 and 3, snare on 2 and 4, a hat on
//                         every slot (its beat slots a little louder) — the steady beat the other parts sit on
//              with       the backbeat, and a perc stroke on every slot where the lead or the comping strikes, on that
//                         note's own onset (the lead's first); accented where both strike, or on a strong slot
//              against    the backbeat, and a perc stroke on the slots both leave empty, on the slot's nearest onset:
//                         at most ⌊S / 2⌋ a bar (at least 1), the off-beat slots first, then by the seed
//              partition  the backbeat, and a perc line from the layer that strikes the downbeat (`partitionLine`)
//              a pattern  one of drum-patterns.js, landed through the beats (a pattern's step is a fraction of the bar)
//   fills      the last bar of each phrase of 4 bars or more (harmony.js `phrasesOf`) plays the fill over its second
//              half (from beat 3), and a crash opens the bar after it — the loop's first bar when the fill is the last.
//   seed       only `against` draws (a seeded generator of its own, `${seed}/drums`), so the drums never move a draw
//              Compose makes for the other parts.
//
// The partition layer, single level. Partitions' grid mode cuts the whole cycle from tick 0 in P blocks (P chosen per
// layer, up to the grid) and its secondary count lights an Euclidean subset of them (getSecondaryAllowedSet). Here the
// cycle starts at the composition's downbeat, the phase, which is one of the root's onsets, not tick 0: the layer is
// one that strikes it (the layer(s) whose pulse is the phase onset, Avery's idea; of several, the one with pulses a bar
// nearest S, then the slowest), its v pulses are the blocks (grid mode at P = v, from the phase: each block starts on
// one of that layer's onsets, and the first on the downbeat), and `hits` of them sound: Partitions' secondary pattern
// E(hits, v), turned so its first stroke is the downbeat. hits = min(v, N·S) by default (a pulse a slot on average), or
// N·hitsPerBar. The two-level prime partition (deferred, Avery) is the same selection over another level-1 source:
// `levelOneLights` names the source and `selectLights` chooses among them; see DESIGN_NOTES "Drums".

import { partitionSizes, euclidPattern } from './cells.js';
import { phrasesOf, isStrongBeat } from './harmony.js';
import { DRUM_PATTERNS, PATTERN_NAMES, FILL, patternStrokes } from './drum-patterns.js';

export const COMPOSER_DRUMS_VERSION = 'composer-drums-v1';
export const DRUM_VOICES = Object.freeze(['kick', 'snare', 'hat', 'perc', 'cym']);
/** the modes laid over the backbeat, then every curated pattern by name */
export const LAYERED_MODES = Object.freeze(['backbeat', 'with', 'against', 'partition']);
export const DRUM_MODES = Object.freeze([...LAYERED_MODES, ...PATTERN_NAMES]);
/** a voice's sound: an Audio/drums choice (`made:<id>` or a sample URL); '' is that voice off */
export const DEFAULT_KIT = Object.freeze({ kick: 'made:kick', snare: 'made:snare', hat: 'made:hihat', perc: 'made:perc', cym: 'made:cym' });
export const DRUM_VELOCITY = Object.freeze({ kick: 0.85, snare: 0.75, hat: 0.3, perc: 0.5, cym: 0.55 });
export const ACCENT = 0.12;
/** a stroke on an onset more layers strike is that much louder a layer (the row's own accents) */
export const STRIKE_ACCENT = 0.04;
export const FILL_MIN_PHRASE_BARS = 4;
export const DRUM_OPTIONS = Object.freeze(['enabled', 'mode', 'fills', 'kit', 'seed', 'layer', 'hitsPerBar', 'perBar']);
/** level-1 sources of the partition: 'layer' is built; 'prime' (Avery's two-level prime partition) is deferred */
export const PARTITION_SOURCES = Object.freeze(['layer', 'prime']);

const EPS = 1e-9;
const LAYER_NAMES = 'ABCD';
const fail = (what) => { throw new Error(`composer/drums: ${what}`); };
const mod = (v, n) => ((v % n) + n) % n;

/** a seeded generator, the same as compose.js' `seededRandom` (copied: compose.js imports this module) */
function seeded(seed) {
  let h = 0x811c9dc5; const text = String(seed);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The bar's 4 beats: S slots (S·m sub-slots under 4 slots) cut in 4 as Partitions cuts a block.
 * → { S, m, sizes (sub-slots), startU (sub-slots), pos (slot units: where each beat starts) }
 */
export function beatsOf(S) {
  if (!(Number.isInteger(S) && S >= 1)) fail(`bad slots per bar ${S}`);
  const m = Math.max(1, Math.ceil(4 / S)), { sizes } = partitionSizes(S * m, 4), startU = [];
  let at = 0; for (const s of sizes) { startU.push(at); at += s; }
  return { S, m, sizes: [...sizes], startU, pos: startU.map((u) => u / m) };
}

/**
 * The composition's time grid and its onsets, from the spec alone.
 * → { T, N, S, P, grid, phase, phaseX, layers: [{ layer, name, value, step }], starts (relative slot starts),
 *     barStarts, relOf(tick), rAt(g), nearest(r, lo, hi), strikesAt(tick) }
 *   r   a place in the cycle relative to the downbeat, as a share of the cycle (may run past [0, 1) at the ends)
 *   g   a place in slot units over the cycle (slot k's anchor is k; may run past [0, P))
 */
export function drumGrid(spec) {
  const { knobs, input, stats, timeline } = spec;
  const T = knobs.cycleSeconds, N = knobs.bars, S = knobs.slotsPerBar, P = N * S, grid = stats.grid;
  if (!(Number.isSafeInteger(grid) && grid >= 1)) fail(`bad grid ${grid}`);
  const [pn, pd] = knobs.phase, phaseX = pn / pd;
  const layers = [];
  input.layers.forEach((v, i) => { if (v > 0) layers.push({ layer: i, name: LAYER_NAMES[i], value: v, step: grid / v }); });
  const starts = timeline.slotStarts.map((s) => s / T), barStarts = timeline.barStarts.map((s) => s / T);
  if (starts.length !== P) fail(`the timeline has ${starts.length} slots, not ${P}`);
  // the very expression compose.js times a note by, so a stroke on a note's onset sounds with it
  const relOf = (tick) => mod(tick / grid - phaseX, 1);
  const rAt = (g) => {
    const w = Math.floor(g / P), h = g - w * P, k = Math.min(P - 1, Math.floor(h)), frac = h - k;
    const a = starts[k], b = k + 1 < P ? starts[k + 1] : 1;
    return w + a + frac * (b - a);
  };
  const strikesAt = (tick) => { let n = 0, owners = 0; for (const L of layers) if (tick % L.step === 0) { n++; owners |= 1 << L.layer; } return { strikes: n, owners }; };
  /** the onset nearest r with lo < its place ≤ hi: { tick, d } (d its signed distance from r), or null */
  const nearest = (r, lo, hi) => {
    let best = null;
    for (const L of layers) {
      const x = (phaseX + r) * L.value, f = Math.floor(x);
      for (const k of f === x ? [f] : [f, f + 1]) {
        const pr = k / L.value - phaseX;
        if (!(pr > lo - EPS * 1e-3 && pr <= hi + EPS * 1e-3)) continue;
        const d = pr - r, tick = mod(k, L.value) * L.step;
        if (!best || Math.abs(d) < Math.abs(best.d) - 1e-15 || (Math.abs(Math.abs(d) - Math.abs(best.d)) <= 1e-15 && d < best.d)) best = { tick, d };
      }
    }
    return best;
  };
  return { T, N, S, P, grid, phase: [pn, pd], phaseX, layers, starts, barStarts, relOf, rAt, strikesAt, nearest };
}

/** the bar a relative place falls in, and its place in slot units inside it */
function placeOf(g, r) {
  let j = 0, lo = 0, hi = g.P - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (g.starts[mid] <= r + EPS) { j = mid; lo = mid + 1; } else hi = mid - 1; }
  const next = j + 1 < g.P ? g.starts[j + 1] : 1, bar = Math.floor(j / g.S);
  return { bar, slot: j, pos: (j - bar * g.S) + (next > g.starts[j] ? (r - g.starts[j]) / (next - g.starts[j]) : 0) };
}

/**
 * The layers that strike the downbeat (the phase onset): v strikes it when phase·v is whole.
 * → [{ layer, name, value, pulse }] (pulse: which of its v pulses the downbeat is), in layer order
 */
export function downbeatLayers(spec) {
  const [pn, pd] = spec.knobs.phase, out = [];
  spec.input.layers.forEach((v, i) => {
    if (!(v > 0)) return;
    const num = BigInt(pn) * BigInt(v);
    if (num % BigInt(pd) === 0n) out.push({ layer: i, name: LAYER_NAMES[i], value: v, pulse: Number(num / BigInt(pd)) });
  });
  return out;
}

/** which of `count` level-1 lights sound for `hits` strokes: Partitions' secondary pattern (getSecondaryAllowedSet),
 *  E(hits, count) turned to start on a stroke, so light 0 (the downbeat) sounds → [light index] ascending */
export function selectLights(count, hits) {
  if (!(Number.isInteger(count) && count >= 1)) fail(`bad light count ${count}`);
  const k = Math.max(1, Math.min(count, Math.floor(hits)));
  let pattern = euclidPattern(count, k);
  const first = pattern.indexOf(1);
  if (first > 0) pattern = pattern.slice(first).concat(pattern.slice(0, first));
  const out = [];
  pattern.forEach((on, i) => { if (on) out.push(i); });
  return out;
}

/**
 * Level 1 of the partition: the lights the selection chooses among, counted from the downbeat.
 *   source 'layer'   a layer that strikes the downbeat: its v pulses, light i at pulse (downbeat's + i) mod v
 *   source 'prime'   DEFERRED (Avery's two-level prime partition): a prime number of lights spread evenly over the
 *                    cycle, landed on onsets, which level 2 (the bars × slots partition) would treat as an even grid
 *                    irrespective of their uneven timing. Not built: it throws, so the seam is visible.
 * → { source, count, tickAt(i) }
 */
export function levelOneLights(g, { source = 'layer', layer } = {}) {
  if (source === 'prime') fail('the two-level prime partition is deferred (DESIGN_NOTES "Drums")');
  if (source !== 'layer') fail(`no partition source ${JSON.stringify(source)} (${PARTITION_SOURCES.join(', ')})`);
  const L = g.layers.find((x) => x.layer === layer.layer);
  if (!L) fail(`layer ${layer.name} is not in the rhythm`);
  return { source, count: L.value, tickAt: (i) => mod(layer.pulse + i, L.value) * L.step };
}

/**
 * The partition line, single level: the layer that strikes the downbeat (or `layer`, by name or value, when it does),
 * `hits` of its pulses from the downbeat. → { layer, name, value, from (the downbeat's pulse), hits, lights: [i],
 *   ticks: [tick], candidates: [name] } or null when no layer strikes the downbeat (never, for a Compose phase)
 */
export function partitionLine(spec, g = drumGrid(spec), { layer = null, hitsPerBar = null } = {}) {
  const owners = downbeatLayers(spec);
  if (!owners.length) return null;
  let pick;
  if (layer != null) {
    pick = owners.find((o) => o.name === layer || o.value === layer);
    if (!pick) fail(`layer ${layer} does not strike the downbeat (${owners.map((o) => `${o.name} ${o.value}`).join(', ')} do)`);
  } else {
    const off = (o) => Math.abs(o.value / g.N - g.S);
    pick = owners.reduce((a, b) => (off(b) < off(a) - EPS || (Math.abs(off(b) - off(a)) <= EPS && b.value < a.value) ? b : a));
  }
  const lights = levelOneLights(g, { source: 'layer', layer: pick });
  const hits = Math.max(1, Math.min(lights.count, hitsPerBar != null ? Math.round(hitsPerBar * g.N) : g.N * g.S));
  const chosen = selectLights(lights.count, hits);
  return { layer: pick.layer, name: pick.name, value: pick.value, from: pick.pulse, hits: chosen.length, lights: chosen, ticks: chosen.map((i) => lights.tickAt(i)), candidates: owners.map((o) => o.name) };
}

/** options as given → every option, resolved (unknown keys refused) */
export function readDrumOptions(options = {}) {
  const o = options || {};
  for (const k of Object.keys(o)) if (!DRUM_OPTIONS.includes(k)) fail(`no drum option "${k}" (${DRUM_OPTIONS.join(', ')})`);
  const mode = o.mode ?? 'backbeat';
  if (!DRUM_MODES.includes(mode)) fail(`mode must be one of ${DRUM_MODES.join(', ')}, not ${JSON.stringify(mode)}`);
  const kit = { ...DEFAULT_KIT };
  for (const [v, c] of Object.entries(o.kit || {})) { if (!DRUM_VOICES.includes(v)) fail(`no drum voice ${v}`); kit[v] = c == null ? '' : String(c); }
  const perBar = {};
  for (const [b, m] of Object.entries(o.perBar || {})) { if (!DRUM_MODES.includes(m)) fail(`bar ${b}: no mode ${m}`); perBar[b] = m; }
  if (o.hitsPerBar != null && !(Number(o.hitsPerBar) > 0)) fail(`bad hitsPerBar ${o.hitsPerBar}`);
  return { enabled: o.enabled ?? true, mode, fills: o.fills ?? true, kit, seed: o.seed ?? null, layer: o.layer ?? null, hitsPerBar: o.hitsPerBar == null ? null : Number(o.hitsPerBar), perBar };
}

/**
 * The drums of a spec.
 *   options  { enabled (true), mode ('backbeat' | 'with' | 'against' | 'partition' | a pattern name), fills (true),
 *              kit: { voice: choice }, seed (the spec's), layer (partition: a layer striking the downbeat, by name or
 *              value), hitsPerBar (partition), perBar: { bar: mode } (a bar's own mode) }
 * → null for a refusal, else { version, enabled, mode, options, kit, beats, partition, bars: [{ bar, mode, fill, crash,
 *   why }], hits: [{ voice, bar, pos, slot, tick, time, velocity, strikes, snap }], decisions, stats }
 *   snap  'slot' (the onset nearest its place), 'wide' (the second look), 'note' (a part's note), 'layer' (partition)
 */
export function arrangeDrums(spec, options = {}) {
  if (!spec || spec.refused) return null;
  const opt = readDrumOptions(options), g = drumGrid(spec), { N, S, P, T } = g;
  const seed = opt.seed ?? spec.input?.seed ?? 1, rng = seeded(`${seed}/drums`);
  const beats = beatsOf(S), m = beats.m, h = 1 / (2 * m);
  const decisions = [];
  const decide = (what, value, why) => { decisions.push({ what, value, why }); return value; };
  decide('drums.mode', opt.mode, options?.mode != null ? 'asked' : 'the steady backbeat by default (the sprint brief): kick on beats 1 and 3, snare on 2 and 4, a hat on every slot');
  decide('drums.beats', beats.pos, m === 1
    ? `the bar's ${S} slots cut in 4 beats as Partitions cuts a block (${beats.sizes.join(', ')} slots)`
    : `${S} slot${S === 1 ? '' : 's'} a bar is under 4 beats: cut on 1/${m} slots (${beats.sizes.map((s) => `${s}/${m}`).join(', ')}), a beat between anchors landing on a real onset inside its slot`);

  const hits = [], stats = { silent: 0, wide: 0 };
  const push = (hit) => { const s = g.strikesAt(hit.tick); hits.push({ ...hit, time: g.relOf(hit.tick) * T, velocity: Math.min(1, hit.velocity + STRIKE_ACCENT * Math.max(0, s.strikes - 1)), strikes: s.strikes }); };
  /** a stroke at place q (slot units) of bar `bar`, landed on the onset nearest it */
  const land = (voice, bar, q, velocity) => {
    const gq = bar * S + q, r = g.rAt(gq);
    let on = g.nearest(r, g.rAt(gq - h), g.rAt(gq + h)), snap = 'slot';
    if (!on) { on = g.nearest(r, g.rAt(gq - 2 * h), g.rAt(gq + 2 * h)); snap = 'wide'; }
    if (!on) { stats.silent++; return; }
    if (snap === 'wide') stats.wide++;
    push({ voice, bar, pos: q, slot: mod(bar * S + Math.floor(q + EPS), P), tick: on.tick, velocity, snap });
  };
  const beatSet = new Set(beats.pos.map((x) => x.toFixed(6)));
  /** a fraction of the bar → its place through the beats (slot units on the 1/m grid), or null past the bar's end */
  const placeOfF = (f) => {
    const x = 4 * f, b = Math.min(3, Math.floor(x + EPS)), u = Math.round(beats.startU[b] + (x - b) * beats.sizes[b] + EPS);
    return u >= S * m ? null : u / m;
  };
  const fillFrom = beats.pos[2];

  // ── a mode a bar, fills at the phrase ends ──
  const phrases = phrasesOf({ bars: N, slotsPerBar: S });
  const fillBars = new Set();
  if (opt.fills) for (const ph of phrases) if (ph.bars >= FILL_MIN_PHRASE_BARS) fillBars.add(ph.from + ph.bars - 1);
  decide('drums.fills', [...fillBars], !opt.fills ? 'asked off' : fillBars.size
    ? `the last bar of each phrase of ${FILL_MIN_PHRASE_BARS} bars or more fills its second half (from beat 3), and a crash opens the bar after it`
    : `no phrase is ${FILL_MIN_PHRASE_BARS} bars or more (${phrases.map((x) => x.bars).join(' + ')} bar${N === 1 ? '' : 's'}): no fills`);
  const bars = [];
  for (let k = 0; k < N; k++) {
    const ph = phrases.find((x) => k >= x.from && k < x.from + x.bars), mode = opt.perBar[k] ?? opt.mode;
    const fill = fillBars.has(k), crash = fillBars.has(mod(k - 1, N)) && fillBars.size > 0;
    const pat = DRUM_PATTERNS[mode], patBar = pat ? (k - ph.from) % pat.bars : 0;
    const what = pat ? `${pat.label}${pat.bars > 1 ? ` (bar ${patBar + 1} of ${pat.bars})` : ''}` : mode === 'backbeat' ? 'backbeat' : `backbeat + ${mode}`;
    bars.push({ bar: k, mode, fill, crash, why: `${what}${opt.perBar[k] ? ' (asked for this bar)' : ''}${fill ? `; fills from beat 3: the last bar of a ${ph.bars}-bar phrase` : ''}${crash ? '; a crash on the downbeat: the phrase opens after a fill' : ''}` });

    // the bar's groove: the backbeat, or the pattern's strokes through the beats
    const strokes = [];
    if (pat) {
      for (const s of patternStrokes(pat)) if (s.bar === patBar) { const q = placeOfF(s.f); if (q != null) strokes.push({ voice: s.voice, q, velocity: DRUM_VELOCITY[s.voice] + (s.accent ? ACCENT : 0) }); }
    } else {
      strokes.push({ voice: 'kick', q: beats.pos[0], velocity: DRUM_VELOCITY.kick + ACCENT }, { voice: 'kick', q: beats.pos[2], velocity: DRUM_VELOCITY.kick });
      strokes.push({ voice: 'snare', q: beats.pos[1], velocity: DRUM_VELOCITY.snare }, { voice: 'snare', q: beats.pos[3], velocity: DRUM_VELOCITY.snare });
      for (let q = 0; q < S; q++) strokes.push({ voice: 'hat', q, velocity: DRUM_VELOCITY.hat + (beatSet.has(q.toFixed(6)) ? 0.08 : 0) });
    }
    for (const s of strokes) if (!(fill && s.voice !== 'cym' && s.voice !== 'perc' && s.q >= fillFrom - EPS)) land(s.voice, k, s.q, s.velocity);
    if (fill) for (const s of patternStrokes(FILL)) if (s.f >= 0.5 - EPS) {
      const q = placeOfF(s.f);
      if (q == null) continue;
      const rise = (s.f - 0.5) / 0.5;
      land(s.voice, k, q, s.voice === 'snare' ? 0.55 + 0.4 * rise : DRUM_VELOCITY[s.voice]);
    }
    if (crash) land('cym', k, 0, DRUM_VELOCITY.cym + ACCENT);
  }

  // ── the line over the backbeat: with, against, partition (each bar of that mode) ──
  const modeOf = (k) => bars[k].mode;
  const notesBySlot = (id) => { const by = new Map(); for (const n of spec.parts.find((p) => p.id === id)?.notes || []) if (!by.has(n.slot)) by.set(n.slot, n); return by; };
  let partition = null;
  if (bars.some((b) => b.mode === 'with' || b.mode === 'against')) {
    const lead = notesBySlot('lead'), comp = notesBySlot('comp');
    for (let k = 0; k < N; k++) {
      if (modeOf(k) === 'with') {
        for (let q = 0; q < S; q++) {
          const j = k * S + q, a = lead.get(j), b = comp.get(j), n = a ?? b;
          if (!n) continue;
          push({ voice: 'perc', bar: k, pos: q, slot: j, tick: n.tick, velocity: DRUM_VELOCITY.perc + (a && b || isStrongBeat(q, S) ? ACCENT : 0), snap: 'note' });
        }
      } else if (modeOf(k) === 'against') {
        const empty = [];
        for (let q = 0; q < S; q++) if (!lead.has(k * S + q) && !comp.has(k * S + q)) empty.push({ q, off: beatSet.has(q.toFixed(6)) ? 1 : 0, r: rng() });
        empty.sort((x, y) => x.off - y.off || x.r - y.r);
        for (const e of empty.slice(0, Math.max(1, Math.floor(S / 2))).sort((x, y) => x.q - y.q)) land('perc', k, e.q, DRUM_VELOCITY.perc + (e.off ? 0 : 0.05));
      }
    }
  }
  if (bars.some((b) => b.mode === 'partition')) {
    partition = partitionLine(spec, g, { layer: opt.layer, hitsPerBar: opt.hitsPerBar });
    if (partition) {
      decide('drums.partition', `${partition.name} (${partition.value})`, `${partition.candidates.length > 1 ? `of the layers striking the downbeat (${partition.candidates.join(', ')}), ` : 'the layer striking the downbeat: '}${partition.name}, its ${partition.value} pulses the blocks from the downbeat (pulse ${partition.from}), ${partition.hits} of them sounding: Partitions' secondary pattern E(${partition.hits}, ${partition.value}) from the downbeat${opt.layer != null ? ' (layer asked)' : ''}`);
      partition.ticks.forEach((tick, i) => {
        const where = placeOf(g, g.relOf(tick));
        if (modeOf(where.bar) !== 'partition') return;
        push({ voice: 'perc', bar: where.bar, pos: where.pos, slot: where.slot, tick, velocity: DRUM_VELOCITY.perc + (i === 0 ? ACCENT : 0), snap: 'layer' });
      });
    }
  }
  decide('drums.kit', { ...opt.kit }, options?.kit ? 'asked' : 'the made kit of Audio/drums (chunk-tunes\' strokes)');
  if (opt.mode === 'against' || Object.values(opt.perBar).includes('against')) decide('drums.seed', seed, 'the seed orders the empty slots `against` fills (a generator of its own: Compose\'s draws do not move)');

  // ── one stroke a voice an onset (the louder kept), in time order ──
  const keep = new Map();
  for (const x of hits) { const key = `${x.voice}:${x.tick}`, had = keep.get(key); if (!had || x.velocity > had.velocity + EPS) keep.set(key, x); }
  const order = Object.fromEntries(DRUM_VOICES.map((v, i) => [v, i]));
  const out = [...keep.values()].sort((a, b) => a.time - b.time || order[a.voice] - order[b.voice]);
  const perVoice = Object.fromEntries(DRUM_VOICES.map((v) => [v, out.filter((x) => x.voice === v).length]));
  return {
    version: COMPOSER_DRUMS_VERSION, enabled: !!opt.enabled, mode: opt.mode,
    options: { ...opt, seed, kit: { ...opt.kit }, perBar: { ...opt.perBar } }, kit: { ...opt.kit },
    beats: { slotsPerBar: S, subdivide: m, sizes: beats.sizes, positions: beats.pos },
    partition: partition && { layer: partition.name, value: partition.value, from: partition.from, hits: partition.hits, candidates: partition.candidates },
    bars, hits: out, decisions,
    stats: { hits: perVoice, total: out.length, wide: stats.wide, silent: stats.silent, merged: hits.length - out.length },
  };
}
