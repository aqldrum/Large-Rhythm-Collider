// form.js — Song v0 (Composer/ARRANGEMENT_ORDER.md, phase A: S1–S7, S9): the loop played as a song, a list of
// sections, each some passes of the same cycle, that thin, build, peak, break and come home, on an energy curve.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node. Nothing is re-solved: the decomposition, the
// chords, the lead and the meter are the loop's. A section has three tools (Avery's rulings 1–6, 2026-11-04; the rest
// the builder's proposals S1–S9, built as written unless marked "builder's call"):
//
//   the loop   `loopSpec` is the spec AS IT PLAYS: its parts as they play (the arps placed, the bass arranged, each part
//              rearticulated with its sound, legato and on/off) and `drums` the arrangement that plays (its `options`
//              are what every other section arranges with). The controller passes `{ ...st.spec, drums: st.drums,
//              parts: PART_IDS.map((id) => st.parts[id]) }` (st.spec.drums is Compose's). `materials` is its { row,
//              cells } (rearrange.js `materialsOf`). Home is this loop, byte for byte: its own part and drum objects.
//   layers     (ruling 1) a section on layers M (a mask, A = bit 0) keeps the drum hits, the comp's notes and the inner's
//              whose onset one of M's layers strikes (row.owners[node] & M; a drum hit's node is the onset at its tick).
//              The lead, the chords and the bass stay whole. A subset of layers is a different tone row, so a section
//              never recomposes from fewer: it filters the full row's notes. Builder's call: a part that loses notes is
//              rearticulated (compose.js `rearticulate`, the decided legato rule over what is left: a legato inner holds
//              over a filtered note, a struck comp keeps its slot or its stroke's hold), and the comp's `strokes` are
//              filtered with it; a part that loses none is the arrangement's own object.
//   parts      a part off in a section plays with `enabled: false` (its notes kept; the player and MIDI skip it), the
//              drums with `enabled: false`. A part off in the loop is off everywhere.
//   density    (ruling 4) `{ bass?, comp?, lead?, inner? }`, set only where it differs from the loop's (and, builder's
//              call, only for a part the section sounds: a density no one hears isn't recorded, so two candidates that
//              sound alike are one). bass is one of bass.js BASS_DENSITIES at the loop's lock (the loop's picks kept at
//              the loop's density, dropped at another: the window's own rule); comp a frame clave's tier (claves.js
//              COMP_DENSITIES; a clave from the pattern has none); lead and inner 'line' | 'arp'. A setting is arranged
//              as the controller arranges the window's choices, in its order: the comp's tier (rearrange.js `reclave`
//              { density }, applied), then the lead and the inner (Arp → Line: arp.js `lineOf`, rearticulated with the
//              part's legato and on/off, an inner's harp back to the line's own sound; Line → Arp: `arrangeArp` at the
//              part's time and picks, an inner arp the harp; an inner arp is arranged again over a lead that moved), then
//              the drums over that (`arrangeDrums` at the loop's options: the perc follows the clave), then the bass over
//              the drums as they play (`arrangeBass({ ...spec, drums })`). Each setting once a (loop, materials).
//   energy     (S2) E = Σ over the parts a section sounds of w·u, over home's sum (home = 1). w: drums 0.30, bass,
//              comp, lead, chords 0.15 each, inner 0.10. A struck part's u is its notes a cycle after the layer filter
//              (the cycle is the same in every section, so a second's starts are proportional) over that part's most
//              across the row's candidates — the most of the low, loop and high presets on every layer — capped at 1 (an
//              edited density past high); the chords' u the share of bars with a chord note. A proxy, not taste.
//   candidates (S3) layer prefixes of the order (k = 1…L) × part masks (PART_MASKS, a fixed seven) × three presets: low
//              (every density one rung down: bass roots < sparse < moving < walking; the comp's tier on COMP_LADDER,
//              sparse < sparse–medium < medium < dense, so the default sparse–medium goes to sparse; Arp → Line), loop,
//              high (one rung up; Line stays Line). Masks and layers are filters: only low, high and the break's Roots
//              cost an arrangement, each once a song.
//   kinds      (S4) intro: no lead, at most the order's first ⌈L/2⌉ layers, low or loop. build: layers non-decreasing
//              from the section before. peak, drop: every part, every layer, high. break: no drums, every layer, the bass
//              off or Roots (a mask with the bass plays it at Roots, the preset's other densities kept). home: the loop.
//   choice     (S5) each section takes a candidate of its kind near its target. The neighbour rule: a boundary into an
//              intro, a build or a break changes at most 2 things (a layer in or out, a part toggled, a rung of a density
//              the two sections both sound each count one); into a peak, a drop or home anything. Builder's calls:
//              (1) the sections are chosen TOGETHER, the path through their candidates nearest the targets (least
//              Σ |E − target|, the neighbour rule and a build's layers its edges: `choosePath`), not one by one, which
//              fell into dead ends; (2) the song's first section has no boundary (it opens the song, and the repeat
//              after home is the top again), so an intro first is free; (3) where no candidate of the kind keeps the
//              rule (a break after a peak: the drums off is one, and the bass off or down to Roots two or more), the
//              ones with the fewest changes stand, said in the section's why; (4) "ties break by the seed" reads a tie
//              as within TIE_BAND (0.05): each candidate's cost adds TIE_BAND × a key the seed's own generator
//              (`${seed}/form/${section}`) draws, so Re-plan (a new seed) gives another song where energies are close.
//   order      (S6, ruling 2) of the permutations of the active layers (at most 24), the one whose prefix energies
//              (every part, the loop's densities) step most evenly: the least variance of E_k − E_(k−1), k = 1…L.
//              Builder's call: the steps start from E_0, no layer at all (the lead, the chords and the bass alone), so a
//              two-layer row's order is chosen too (its one inner step would tie). Ties (1e-12) go to fastest-first: the
//              larger layer value first, position by position. Build–drop (its intro asks it) enters slowest-first.
//   passes     (S7, ruling 3) every section `passesEach` = clamp(round(20 s / the cycle at the seed tempo), 1, 16): the
//              cycle is knobs.cycleSeconds × knobs.tempoBpm / compose.js `seedTempoOf` (a MIDI target's clip tempo).
//   fills      (S8, ruling 5) a section followed by a peak or a drop (the song wrapping: the last section is followed by
//              the first) has `fillBefore`: its last pass's drums are arranged with drums.js `fillBars: [N − 1]`, the
//              last bar a fill from beat 3. Builder's calls: (1) the crash that bar wraps to (bar 1 of the same pass, in
//              a loop) is moved to the next pass's downbeat, the peak's: the fill pass keeps bar 1 as the section plays it,
//              and the first pass after a fillBefore section crashes on bar 1 (the crash hit as drums.js lands it); (2) a
//              section with the drums off (Arch's break, before its second peak) plays the fill alone on its last pass:
//              the fill bar's kick and snare from beat 3 (what gridOf calls the fill's strokes). The energy is the
//              section's, fill or none; the bass keeps the section's arrangement under a fill bar.
//
// The song (S1) is data, JSON-safe, replayable from (loop spec, template, seed, edits):
//   { version: SONG_VERSION, template, seed, (targetSeconds, only when not 20), order: [layer index], passesEach,
//     sections: [{ kind, name, passes, layers (mask), parts: { lead, chords, comp, bass, inner, drums: boolean },
//                  density: { bass?, comp?, lead?, inner? }, fillBefore, energy, target, why }], decisions: [{ what, value, why }] }
// songPasses reads only the sections' kind, passes, layers, parts, density and fillBefore, so an edited song (phase C:
// plain data changes to `song.sections`) plays as written. energyOf gives an edited section's energy again.

import { PART_IDS, rearticulate, seededRandom, seedTempoOf } from './compose.js';
import { reclave, applyRearrange } from './rearrange.js';
import { arrangeBass, BASS_DENSITIES } from './bass.js';
import { arrangeArp, arpRefusal, lineOf, ARP_PARTS, ARP_DEFAULTS } from './arp.js';
import { arrangeDrums, DRUM_VOICES } from './drums.js';
import { COMP_DENSITIES, densityWords } from './claves.js';
import { lowerBoundTick, LAYER_NAMES } from './row.js';

export const SONG_VERSION = 'composer-song-v0';
export const SECTION_KINDS = Object.freeze(['intro', 'build', 'peak', 'break', 'drop', 'home']);
/** the parts a section turns on and off: Compose's five and the drums */
export const SONG_PARTS = Object.freeze([...PART_IDS, 'drums']);
/** the parts the layers filter (ruling 1) */
export const FILTERED_PARTS = Object.freeze(['drums', 'comp', 'inner']);
/** S2's weights */
export const PART_WEIGHTS = Object.freeze({ drums: 0.3, bass: 0.15, comp: 0.15, lead: 0.15, chords: 0.15, inner: 0.1 });
/** S3's part masks, in the order the planner reads them */
export const PART_MASKS = Object.freeze([
  Object.freeze({ id: 'chords', label: 'the chords', parts: Object.freeze(['chords']) }),
  Object.freeze({ id: 'chords+inner', label: 'the chords and the inner', parts: Object.freeze(['chords', 'inner']) }),
  Object.freeze({ id: 'drums+bass', label: 'the drums and the bass', parts: Object.freeze(['drums', 'bass']) }),
  Object.freeze({ id: 'drums+bass+chords', label: 'the drums, the bass and the chords', parts: Object.freeze(['drums', 'bass', 'chords']) }),
  Object.freeze({ id: 'no-lead', label: 'every part but the lead', parts: Object.freeze(SONG_PARTS.filter((id) => id !== 'lead')) }),
  Object.freeze({ id: 'no-drums', label: 'every part but the drums', parts: Object.freeze(SONG_PARTS.filter((id) => id !== 'drums')) }),
  Object.freeze({ id: 'all', label: 'every part', parts: SONG_PARTS }),
]);
export const DENSITY_PRESETS = Object.freeze(['low', 'loop', 'high']);
/** the parts a density is set for, and each one's rungs (a step is one rung) */
export const DENSITY_PARTS = Object.freeze(['bass', 'comp', 'lead', 'inner']);
export const COMP_LADDER = Object.freeze(['sparse', 'sparse-med', 'medium', 'dense']);
export const ARP_MODES = Object.freeze(['line', 'arp']);
export const DENSITY_LADDERS = Object.freeze({ bass: BASS_DENSITIES, comp: COMP_LADDER, lead: ARP_MODES, inner: ARP_MODES });
/** S5's templates: each section's kind and target energy (home units); `order` 'even' (S6) or 'slowest' */
export const TEMPLATES = Object.freeze({
  arch: Object.freeze({ id: 'arch', label: 'Arch', order: 'even', sections: Object.freeze([['intro', 0.3], ['build', 0.6], ['peak', 1.15], ['break', 0.4], ['peak', 1.15], ['home', 1]]) }),
  'build-drop': Object.freeze({ id: 'build-drop', label: 'Build–drop', order: 'slowest', sections: Object.freeze([['intro', 0.15], ['build', 0.35], ['build', 0.65], ['drop', 1.15], ['break', 0.35], ['home', 1]]) }),
});
export const TARGET_SECONDS = 20;
export const MAX_PASSES = 16;
/** an edited section's passes may go past the planner's 16, to this */
export const MAX_SECTION_PASSES = 64;
/** the neighbour rule's limit, and the kinds a boundary into is free (S5) */
export const NEIGHBOUR_LIMIT = 2;
export const FREE_INTO = Object.freeze(['peak', 'drop', 'home']);
/** builder's call (S5's ties): candidates within this of the nearest to the target are tied, and the seed picks */
export const TIE_BAND = 0.05;
/** the inner arp's own sound (perform/composer-controller.js INNER_ARP_SOUND: core can't import the controller) */
const INNER_ARP_SOUND = 'harp';
const KIND_WORDS = Object.freeze({ intro: 'Intro', build: 'Build', peak: 'Peak', break: 'Break', drop: 'Drop', home: 'Home' });
const EPS = 1e-9;
const TIE_EPS = 1e-12;
const fail = (what) => { throw new Error(`composer/form: ${what}`); };
const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>>= 1; } return n; };
const cap = (x) => x[0].toUpperCase() + x.slice(1);
const VOICE_ORDER = Object.fromEntries(DRUM_VOICES.map((v, i) => [v, i]));
const sortHits = (hits) => hits.sort((a, b) => a.time - b.time || VOICE_ORDER[a.voice] - VOICE_ORDER[b.voice]);

// ── the loop's context: per (loop, materials), its own densities, the arrangements and the passes ──
const contexts = new WeakMap();
function contextOf(loop, materials) {
  if (!loop || loop.refused || !Array.isArray(loop.parts)) fail('a song plays a composed spec (not refused)');
  if (!materials?.row || !materials?.cells) fail('a song needs the loop\'s materials: { row, cells } (rearrange.js materialsOf)');
  let byMat = contexts.get(loop);
  if (!byMat) { byMat = new WeakMap(); contexts.set(loop, byMat); }
  const had = byMat.get(materials);
  if (had) return had;
  const { row, cells } = materials, K = loop.knobs;
  if (cells.bars !== K.bars || cells.slotsPerBar !== K.slotsPerBar || row.n !== loop.stats?.onsets) fail('the materials are not this loop\'s (materialsOf(loopSpec))');
  const byId = Object.fromEntries(loop.parts.map((p) => [p.id, p]));
  for (const id of PART_IDS) if (!byId[id]) fail(`the loop has no ${id} part`);
  const bass = byId.bass.bass;
  const own = {
    bass: bass?.density ?? 'sparse', lock: bass?.lock ?? 'free', picks: { ...(bass?.picks ?? {}) },
    // the comp's tier: a frame clave's (the controller's tierOf), else none
    comp: loop.clave?.read === 'frame' && loop.clave.compDensity ? loop.clave.compDensity.asked : null,
    lead: byId.lead.arp ? 'arp' : 'line', inner: byId.inner.arp ? 'arp' : 'line',
  };
  const sounds = Object.fromEntries(PART_IDS.map((id) => [id, !!byId[id].enabled]));
  sounds.drums = !!loop.drums?.enabled;
  const full = row.active.reduce((m, b) => m | (1 << b), 0);
  const cx = { loop, m: materials, row, T: K.cycleSeconds, N: K.bars, full, active: [...row.active], own, sounds, byId,
    drumOptions: loop.drums?.options ?? null, arrangements: new Map(), passes: new Map(), norm: null, nodeOfTick: new Map() };
  byMat.set(materials, cx);
  return cx;
}

/** a drum hit's onset (its tick is one the row plays; -1 when it isn't) */
function nodeOfTick(cx, tick) {
  let i = cx.nodeOfTick.get(tick);
  if (i === undefined) { const j = lowerBoundTick(cx.row, tick); i = j < cx.row.n && cx.row.tick[j] === tick ? j : -1; cx.nodeOfTick.set(tick, i); }
  return i;
}
const ownersOf = (cx, i) => (i < 0 ? cx.full : cx.row.owners[i]);

// ── densities ──
/** a section's density record → the full setting { bass, comp, lead, inner } (the loop's where unset), checked */
function settingOf(cx, density = {}) {
  if (!density || typeof density !== 'object' || Array.isArray(density)) fail(`a density is { bass?, comp?, lead?, inner? }, not ${JSON.stringify(density)}`);
  for (const k of Object.keys(density)) if (!DENSITY_PARTS.includes(k)) fail(`no density for "${k}" (${DENSITY_PARTS.join(', ')})`);
  const s = { bass: cx.own.bass, comp: cx.own.comp, lead: cx.own.lead, inner: cx.own.inner, ...density };
  if (!BASS_DENSITIES.includes(s.bass)) fail(`a bass density is one of ${BASS_DENSITIES.join(', ')}, not ${JSON.stringify(s.bass)}`);
  if (s.comp !== cx.own.comp) {
    if (cx.own.comp == null) fail('the loop\'s clave isn\'t read from the frames: the comp has no density tier');
    if (!COMP_DENSITIES.includes(s.comp)) fail(`a comp density is one of ${COMP_DENSITIES.join(', ')}, not ${JSON.stringify(s.comp)}`);
  }
  for (const id of ARP_PARTS) {
    if (!ARP_MODES.includes(s[id])) fail(`the ${id} is 'line' or 'arp', not ${JSON.stringify(s[id])}`);
    if (s[id] === 'arp' && s[id] !== cx.own[id] && arpRefusal(cx.loop, id)) fail(arpRefusal(cx.loop, id));
  }
  return s;
}
const settingKey = (s) => `${s.bass}|${s.comp}|${s.lead}|${s.inner}`;
const rung = (k, v) => (v == null ? 0 : DENSITY_LADDERS[k].indexOf(v));
const stepOf = (k, v, by) => { const L = DENSITY_LADDERS[k], i = L.indexOf(v); return L[Math.max(0, Math.min(L.length - 1, i + by))]; };
/** a preset's setting (S3): low one rung down everywhere (Arp → Line), high one rung up (Line stays Line) */
function presetSetting(cx, preset) {
  const o = cx.own;
  if (preset === 'loop') return { bass: o.bass, comp: o.comp, lead: o.lead, inner: o.inner };
  const by = preset === 'low' ? -1 : 1;
  return { bass: stepOf('bass', o.bass, by), comp: o.comp == null ? null : stepOf('comp', o.comp, by), lead: preset === 'low' ? 'line' : o.lead, inner: preset === 'low' ? 'line' : o.inner };
}
/** the density record of a setting for the parts a section sounds: only where it differs from the loop's */
function recordOf(cx, s, on) {
  const out = {};
  for (const k of DENSITY_PARTS) if (on[k] && cx.sounds[k] && s[k] !== cx.own[k]) out[k] = s[k];
  return out;
}

// ── a setting arranged (the controller's order: the comp's tier, the arps, the drums, the bass over the drums) ──
const placed = (spec, part) => ({ ...spec, parts: spec.parts.map((p) => (p.id === part.id ? part : p)) });
/** an arp part back in Line: its line, with the part's legato and on/off, its sound unless it is the inner arp's harp */
function toLine(part, T) {
  const line = lineOf(part), sound = part.id === 'inner' && part.sound === INNER_ARP_SOUND ? line.sound : part.sound;
  return rearticulate(line, { sound, legato: part.legato, enabled: part.enabled, cycleSeconds: T });
}
function histOf(cx, list, nodeOf) { const h = new Array(16).fill(0); for (const x of list) h[ownersOf(cx, nodeOf(x))]++; return h; }
function arrangementOf(cx, s) {
  const key = settingKey(s);
  let a = cx.arrangements.get(key);
  if (a) return a;
  const { loop, m, own, T } = cx;
  let spec = loop;
  if (key !== settingKey(own)) {
    // the comp's tier: rearrange.js reclave's density door, as the controller's fold runs it
    if (s.comp !== own.comp) spec = applyRearrange(spec, reclave(spec, m.row, m.cells, { density: s.comp }, { parts: spec.parts, ...(cx.drumOptions ? { drumOptions: cx.drumOptions } : {}) }));
    // the lead, then the inner (it keeps off the lead as it sounds)
    let leadMoved = false;
    for (const id of ARP_PARTS) {
      const was = spec.parts.find((p) => p.id === id);
      let part = was;
      if (s[id] === 'line' && was.arp) part = toLine(was, T);
      else if (s[id] === 'arp' && (!was.arp || (id === 'inner' && leadMoved))) {
        part = arrangeArp(spec, m, id, { time: was.arp?.time ?? ARP_DEFAULTS.time, picks: { ...(was.arp?.picks ?? {}) }, legato: was.legato });
        const sound = id === 'inner' && !was.arp ? INNER_ARP_SOUND : was.sound;
        if (part.sound !== sound) part = rearticulate(part, { sound, cycleSeconds: T });
      }
      if (part !== was) { spec = placed(spec, part); if (id === 'lead') leadMoved = true; }
    }
    // the drums read no bass: arranged first, so the Kick lock lands on them as they play
    const drums = loop.drums ? arrangeDrums(spec, cx.drumOptions) : loop.drums;
    const bass = arrangeBass({ ...spec, drums }, m, { density: s.bass, lock: own.lock, picks: s.bass === own.bass ? { ...own.picks } : {} });
    spec = { ...placed(spec, bass), drums };
  }
  const byId = Object.fromEntries(spec.parts.map((p) => [p.id, p]));
  a = { setting: s, spec, parts: spec.parts, drums: spec.drums ?? null, fill: undefined,
    counts: { lead: byId.lead.notes.length, bass: byId.bass.notes.length, comp: histOf(cx, byId.comp.notes, (n) => n.node), inner: histOf(cx, byId.inner.notes, (n) => n.node),
      drums: spec.drums ? histOf(cx, spec.drums.hits, (h) => nodeOfTick(cx, h.tick)) : new Array(16).fill(0) } };
  cx.arrangements.set(key, a);
  return a;
}
/** a part's notes a cycle on layers M (a filtered part's hist; a whole part all of its notes) */
function countOf(a, id, M) {
  const c = a.counts[id];
  if (typeof c === 'number') return c;
  let n = 0; for (let o = 0; o < 16; o++) if (o & M) n += c[o];
  return n;
}

// ── energy (S2) ──
function normOf(cx) {
  if (cx.norm) return cx.norm;
  const arrs = DENSITY_PRESETS.map((p) => arrangementOf(cx, presetSetting(cx, p))), home = arrs[1];
  const most = {};
  for (const id of ['drums', 'bass', 'comp', 'lead', 'inner']) most[id] = Math.max(...arrs.map((a) => countOf(a, id, cx.full)));
  const chords = cx.byId.chords, bars = new Set(chords.notes.map((n) => n.bar)).size;
  cx.norm = { most, chordShare: cx.N ? bars / cx.N : 0, homeSum: 0 };
  cx.norm.homeSum = rawEnergy(cx, home, Object.fromEntries(SONG_PARTS.map((id) => [id, true])), cx.full).sum;
  return cx.norm;
}
function rawEnergy(cx, a, on, M) {
  const { most, chordShare } = cx.norm, u = {};
  let sum = 0;
  for (const id of SONG_PARTS) {
    if (!on[id] || !cx.sounds[id]) continue;
    u[id] = id === 'chords' ? chordShare : most[id] > 0 ? Math.min(1, countOf(a, id, FILTERED_PARTS.includes(id) ? M : cx.full) / most[id]) : 0;
    sum += PART_WEIGHTS[id] * u[id];
  }
  return { sum, u };
}
function energyFor(cx, s, on, M) {
  const norm = normOf(cx);
  const { sum } = rawEnergy(cx, arrangementOf(cx, s), on, M);
  return norm.homeSum > 0 ? sum / norm.homeSum : 0;
}

/** a section's energy in home units (S2), from its parts, layers and density: a planned or an edited one */
export function energyOf(section, loopSpec, materials) {
  const cx = contextOf(loopSpec, materials);
  checkSection(cx, section, 0);
  return energyFor(cx, settingOf(cx, section.density), section.parts, section.layers);
}

// ── the order (S6) ──
function permutations(xs) {
  if (xs.length <= 1) return [xs.slice()];
  const out = [];
  xs.forEach((x, i) => { for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...p]); });
  return out;
}
const maskOfOrder = (order, k) => order.slice(0, k).reduce((m, b) => m | (1 << b), 0);
const layerName = (cx, b) => `${LAYER_NAMES[b]}${cx.row.layers[b]}`;
/** the prefix energies of an order (every part, the loop's densities), E_0 (no layer) to E_L (home) */
function prefixEnergies(cx, order) {
  const all = Object.fromEntries(SONG_PARTS.map((id) => [id, true])), own = presetSetting(cx, 'loop');
  return Array.from({ length: order.length + 1 }, (_, k) => energyFor(cx, own, all, maskOfOrder(order, k)));
}
const stepsOf = (E) => E.slice(1).map((e, k) => e - E[k]);
const varianceOf = (xs) => { const mu = xs.reduce((a, b) => a + b, 0) / xs.length; return xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length; };
/** fastest-first: the larger layer value first, position by position (then the lower layer index) */
function fasterFirst(cx, a, b) {
  for (let i = 0; i < a.length; i++) { const d = cx.row.layers[b[i]] - cx.row.layers[a[i]]; if (d) return d; if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}
function chooseOrder(cx, how) {
  if (how === 'slowest') {
    const order = [...cx.active].sort((a, b) => cx.row.layers[a] - cx.row.layers[b] || a - b);
    return { order, steps: stepsOf(prefixEnergies(cx, order)), of: 1 };
  }
  const perms = permutations(cx.active);
  let best = null;
  for (const order of perms) {
    const steps = stepsOf(prefixEnergies(cx, order)), v = varianceOf(steps);
    if (!best || v < best.v - TIE_EPS || (Math.abs(v - best.v) <= TIE_EPS && fasterFirst(cx, order, best.order) < 0)) best = { order, steps, v };
  }
  return { order: best.order, steps: best.steps, of: perms.length };
}

// ── candidates (S3–S4) and the neighbour rule (S5) ──
const partsOf = (ids) => Object.fromEntries(SONG_PARTS.map((id) => [id, ids.includes(id)]));
/** the things a boundary changes: layers in or out, parts toggled, rungs of a density both sections sound */
function changesBy(a, b, sa, sb) {
  let n = popcount((a.layers ^ b.layers) >>> 0);
  for (const id of SONG_PARTS) if (!!a.parts[id] !== !!b.parts[id]) n++;
  for (const k of DENSITY_PARTS) if (a.parts[k] && b.parts[k]) n += Math.abs(rung(k, sa[k]) - rung(k, sb[k]));
  return n;
}
const changesOf = (cx, a, b) => changesBy(a, b, settingOf(cx, a.density), settingOf(cx, b.density));
/** the boundary between two sections of a song on this loop: how many things it changes (S5) */
export function boundaryChanges(a, b, loopSpec, materials) { return changesOf(contextOf(loopSpec, materials), a, b); }

/** a kind's candidates (S3 filtered by S4; a build's "layers non-decreasing" is an edge of the path, not a filter) */
function candidatesOf(cx, kind, order) {
  const L = order.length, ks = [], masks = [], presets = [];
  const no = (id) => PART_MASKS.filter((x) => !x.parts.includes(id)), all = PART_MASKS.find((x) => x.id === 'all');
  if (kind === 'intro') { for (let k = 1; k <= Math.ceil(L / 2); k++) ks.push(k); masks.push(...no('lead')); presets.push('low', 'loop'); }
  else if (kind === 'build') { for (let k = 1; k <= L; k++) ks.push(k); masks.push(...PART_MASKS); presets.push(...DENSITY_PRESETS); }
  else if (kind === 'peak' || kind === 'drop') { ks.push(L); masks.push(all); presets.push('high'); }
  else if (kind === 'break') { ks.push(L); masks.push(...no('drums')); presets.push(...DENSITY_PRESETS); }
  else { ks.push(L); masks.push(all); presets.push('loop'); }
  const out = [], seen = new Set();
  for (const mask of masks) for (const k of ks) for (const preset of presets) {
    const on = partsOf(mask.parts), layers = maskOfOrder(order, k);
    let s = presetSetting(cx, preset);
    if (kind === 'break' && on.bass) s = { ...s, bass: 'roots' };
    const density = kind === 'home' ? {} : recordOf(cx, s, on), key = JSON.stringify([mask.id, layers, density]);
    if (seen.has(key)) continue;
    seen.add(key);
    const setting = settingOf(cx, density);
    out.push({ mask, k, preset, layers, parts: on, density, setting, energy: energyFor(cx, setting, on, layers) });
  }
  return out;
}

const layerWords = (cx, order, M) => ((M & cx.full) === cx.full ? `every layer (${order.map((b) => layerName(cx, b)).join(', ')})` : `layers ${order.filter((b) => M & (1 << b)).map((b) => layerName(cx, b)).join(', ') || 'none'}`);
const DENSITY_NAMES = { bass: (v) => cap(v), comp: (v) => densityWords(v, { band: false }), lead: (v) => cap(v), inner: (v) => cap(v) };
const densityText = (d) => (Object.keys(d).length ? DENSITY_PARTS.filter((k) => d[k] != null).map((k) => `${k} ${DENSITY_NAMES[k](d[k])}`).join(', ') : 'the loop\'s densities');
const PRESET_WORDS = Object.freeze({ low: 'the low preset', loop: 'the loop\'s own', high: 'the high preset' });

/**
 * The sections chosen together (S5): a shortest path through each section's candidates, a step's cost its distance to
 * the section's target plus TIE_BAND × the seed's key for it (so candidates within the band tie, and the seed breaks
 * them), its edges the boundaries the kinds allow — a build's layers holding the section before's, and into an intro, a
 * build or a break at most NEIGHBOUR_LIMIT changes (where no candidate keeps within it of the one before, the fewest
 * changes it can make). Builder's call: one by one (each section the nearest given the one before) fell into dead ends:
 * 7:5:3:2's Build–drop, from an intro of the chords and the inner, could reach nothing within two changes above 0.18
 * for builds targeting 0.35 and 0.65. → [{ pick (a candidate), cands, changes, relaxed }]
 */
function choosePath(cx, tpl, order, seed) {
  const n = tpl.sections.length;
  const C = tpl.sections.map(([kind, target], i) => {
    const cands = candidatesOf(cx, kind, order), rng = seededRandom(`${seed}/form/${i}`);
    for (const c of cands) c.cost = Math.abs(c.energy - target) + TIE_BAND * rng();
    return cands;
  });
  /** the candidates of section i a boundary from p allows: [{ c, changes, relaxed }] */
  const edges = (i, p) => {
    const kind = tpl.sections[i][0], held = kind === 'build' ? C[i].filter((c) => (c.layers & p.layers) === p.layers) : C[i];
    const list = held.map((c) => ({ c, changes: changesBy(p, c, p.setting, c.setting), relaxed: false }));
    if (FREE_INTO.includes(kind)) return list;
    const ok = list.filter((e) => e.changes <= NEIGHBOUR_LIMIT);
    if (ok.length) return ok;
    const least = Math.min(...list.map((e) => e.changes));
    return list.filter((e) => e.changes === least).map((e) => ({ ...e, relaxed: true }));
  };
  // backward: each candidate's cost to the end of the song
  const togo = Array.from({ length: n }, () => new Map());
  for (const c of C[n - 1]) togo[n - 1].set(c, c.cost);
  for (let i = n - 2; i >= 0; i--) for (const c of C[i]) {
    let rest = Infinity;
    for (const e of edges(i + 1, c)) rest = Math.min(rest, togo[i + 1].get(e.c));
    togo[i].set(c, c.cost + rest);
  }
  // forward: the cheapest first section, then the cheapest edge on (ties by the candidates' order)
  let pick = C[0].reduce((a, b) => (togo[0].get(b) < togo[0].get(a) - TIE_EPS ? b : a));
  const out = [{ pick, cands: C[0].length, changes: null, relaxed: false }];
  for (let i = 1; i < n; i++) {
    const e = edges(i, pick).reduce((a, b) => (togo[i].get(b.c) < togo[i].get(a.c) - TIE_EPS ? b : a));
    pick = e.c;
    out.push({ pick, cands: C[i].length, changes: e.changes, relaxed: e.relaxed });
  }
  return out;
}

/**
 * Plan a song over the loop (S1–S7): the template's sections, each a candidate of its kind, chosen together nearest
 * the template's curve (choosePath).
 *   loopSpec   the spec as it plays (the head of this file); materials its { row, cells }
 *   opts       { template ('arch' | 'build-drop'), seed (ties, S5), targetSeconds (a section's length, S7: 20) }
 * → the song (S1)
 */
export function planSong(loopSpec, materials, { template = 'arch', seed = 1, targetSeconds = TARGET_SECONDS } = {}) {
  const cx = contextOf(loopSpec, materials), tpl = TEMPLATES[template] ?? fail(`no template "${template}" (${Object.keys(TEMPLATES).join(', ')})`);
  if (!(Number.isFinite(targetSeconds) && targetSeconds > 0)) fail(`targetSeconds must be a positive number, not ${JSON.stringify(targetSeconds)}`);
  const decisions = [], decide = (what, value, why) => { decisions.push({ what, value, why }); return value; };
  decide('template', tpl.id, `${tpl.label}: ${tpl.sections.map(([k]) => k).join(' → ')} (ruling 5), the targets ${tpl.sections.map(([, t]) => t.toFixed(2)).join(' · ')} in home units (S5)`);

  // the order (S6)
  const o = chooseOrder(cx, tpl.order), order = o.order;
  const span = o.steps.length ? `steps of ${Math.min(...o.steps).toFixed(2)}–${Math.max(...o.steps).toFixed(2)}` : 'one layer';
  decide('order', [...order], `layers enter ${order.map((b) => layerName(cx, b)).join(', ')}${tpl.order === 'slowest' ? `: slowest first, as ${tpl.label}'s intro asks` : `: the most even of ${o.of} order${o.of === 1 ? '' : 's'} (the least variance of the prefix energies' steps, from the lead, chords and bass alone; ties fastest first)`}: ${span}`);

  // the passes (S7)
  const K = loopSpec.knobs, seedT = seedTempoOf(loopSpec), cycle = K.cycleSeconds * (K.tempoBpm > 0 && seedT > 0 ? K.tempoBpm / seedT : 1);
  const passesEach = Math.max(1, Math.min(MAX_PASSES, Math.round(targetSeconds / cycle)));
  decide('passes', passesEach, `the cycle is ${cycle.toFixed(2)} s at the seed tempo (${(seedT ?? K.tempoBpm).toFixed(1)} BPM): ${targetSeconds} s ÷ ${cycle.toFixed(2)} s ≈ ${passesEach} pass${passesEach === 1 ? '' : 'es'} a section (1–${MAX_PASSES}), every section the same`);
  const norm = normOf(cx);
  decide('energy', { ...PART_WEIGHTS }, `E = Σ w·u over the parts a section sounds, over home's (home = 1); u a struck part's notes a cycle after the layer filter over its most on every layer of the low, loop and high presets (${['drums', 'bass', 'comp', 'lead', 'inner'].map((id) => `${id} ${norm.most[id]}`).join(', ')}), the chords' the share of bars with a chord (${norm.chordShare.toFixed(2)})`);

  // the sections (S4–S5), chosen together
  const path = choosePath(cx, tpl, order, seed), off = path.reduce((a, x, i) => a + Math.abs(x.pick.energy - tpl.sections[i][1]), 0);
  decide('curve', +off.toFixed(6), `the sections chosen together: the path through their candidates nearest the targets (Σ |E − target| = ${off.toFixed(2)}), into an intro, a build or a break at most ${NEIGHBOUR_LIMIT} changes, candidates within ${TIE_BAND} of each other tied and broken by the seed (${seed})`);
  const counts = {}, seen = {};
  for (const [kind] of tpl.sections) counts[kind] = (counts[kind] ?? 0) + 1;
  const sections = [];
  path.forEach(({ pick, cands, changes, relaxed }, i) => {
    const [kind, target] = tpl.sections[i], prev = sections[i - 1];
    seen[kind] = (seen[kind] ?? 0) + 1;
    const name = counts[kind] > 1 ? `${KIND_WORDS[kind]} ${seen[kind]}` : KIND_WORDS[kind];
    const ch = `${changes} change${changes === 1 ? '' : 's'}`;
    const rule = !prev ? 'it opens the song' : FREE_INTO.includes(kind) ? `a boundary into a ${kind} may change anything (${ch})`
      : relaxed ? `no ${kind} keeps within ${NEIGHBOUR_LIMIT} changes of ${prev.name}: the fewest, ${changes}` : `${ch} from ${prev.name} (at most ${NEIGHBOUR_LIMIT})`;
    const why = kind === 'home' ? `the loop as it plays: every part, ${layerWords(cx, order, pick.layers)}, the loop's densities; E 1.00; ${rule}`
      : `E ${pick.energy.toFixed(2)} for ${target.toFixed(2)} (of ${cands} candidate${cands === 1 ? '' : 's'}): ${pick.mask.label}, ${layerWords(cx, order, pick.layers)}, ${densityText(pick.density)}${Object.keys(pick.density).length ? ` (${PRESET_WORDS[pick.preset]})` : ''}; ${rule}`;
    sections.push({ kind, name, passes: passesEach, layers: pick.layers, parts: { ...pick.parts }, density: { ...pick.density }, fillBefore: false, energy: pick.energy, target, why });
  });
  // the fills (S8): a section into a peak or a drop, the song wrapping
  sections.forEach((sec, i) => { const next = sections[(i + 1) % sections.length]; sec.fillBefore = sections.length > 1 && (next.kind === 'peak' || next.kind === 'drop'); });
  for (const [i, sec] of sections.entries()) decide(`section.${i}`, sec.name, `${sec.why}${sec.fillBefore ? `; its last bar a fill into ${sections[(i + 1) % sections.length].name}${sec.parts.drums && cx.sounds.drums ? '' : ' (the drums off: the fill alone)'}` : ''}`);
  return { version: SONG_VERSION, template: tpl.id, seed, ...(targetSeconds !== TARGET_SECONDS ? { targetSeconds } : {}), order: [...order], passesEach, sections, decisions };
}

// ── the expanded song (S9) ──
function checkSection(cx, sec, i) {
  const at = `section ${i + 1}`;
  if (!sec || typeof sec !== 'object') fail(`${at} is not a section`);
  if (!SECTION_KINDS.includes(sec.kind)) fail(`${at}: a kind is one of ${SECTION_KINDS.join(', ')}, not ${JSON.stringify(sec.kind)}`);
  if (!(Number.isInteger(sec.passes) && sec.passes >= 1 && sec.passes <= MAX_SECTION_PASSES)) fail(`${at}: passes must be a whole number 1..${MAX_SECTION_PASSES}, not ${JSON.stringify(sec.passes)}`);
  if (!(Number.isInteger(sec.layers) && sec.layers >= 0 && (sec.layers & ~cx.full) === 0)) fail(`${at}: layers must be a mask of the row's layers (${cx.full}), not ${JSON.stringify(sec.layers)}`);
  if (!sec.parts || typeof sec.parts !== 'object') fail(`${at}: parts must be { ${SONG_PARTS.join(', ')} }`);
  for (const id of SONG_PARTS) if (typeof sec.parts[id] !== 'boolean') fail(`${at}: parts.${id} must be true or false, not ${JSON.stringify(sec.parts[id])}`);
  if (sec.fillBefore != null && typeof sec.fillBefore !== 'boolean') fail(`${at}: fillBefore must be true or false`);
  settingOf(cx, sec.density ?? {});
}
function readSong(cx, song) {
  if (!song || song.version !== SONG_VERSION) fail(`not a ${SONG_VERSION} song`);
  if (!Array.isArray(song.sections) || !song.sections.length) fail('a song has at least one section');
  song.sections.forEach((s, i) => checkSection(cx, s, i));
}

const isCrash = (h) => h.voice === 'cym' && h.bar === 0 && Math.abs(h.pos) < EPS;
const CRASH_WHY = '; a crash on the downbeat: the phrase opens after a fill';
/** drums with new hits: the per-voice counts and the total said again */
function rehit(d, hits) {
  const perVoice = Object.fromEntries(DRUM_VOICES.map((v) => [v, 0]));
  for (const h of hits) perVoice[h.voice]++;
  return { ...d, hits, stats: { ...d.stats, hits: perVoice, total: hits.length } };
}
/** an arrangement's drums with the last bar a fill (fillBars), the crash it wraps to bar 1 left out unless the loop
 *  crashes there anyway (builder's call: it moves to the next pass's downbeat); `raw` keeps the crash, for crashOf */
function fillOf(cx, a) {
  if (a.fill !== undefined) return a.fill;
  const plain = a.drums, opts = { ...plain.options, fillBars: [...(plain.options.fillBars ?? []), cx.N - 1] };
  const raw = arrangeDrums(a.spec, opts);
  let d = raw;
  if (!plain.bars[0].crash && raw.bars[0].crash) {
    const hits = sortHits([...raw.hits.filter((h) => !isCrash(h)), ...plain.hits.filter(isCrash)]);
    const bars = raw.bars.map((b, k) => (k ? b : { ...b, crash: false, why: `${b.why.replace(CRASH_WHY, '')}; its crash moves to the next section's downbeat` }));
    d = rehit({ ...raw, bars }, hits);
  }
  a.fill = { raw, drums: d };
  return a.fill;
}
/** drums opening on a crash (the first pass after a fill): drums.js' own crash hit, the louder kept on its onset */
function withCrash(cx, a, d) {
  if (d.bars[0].crash) return d;
  const hit = fillOf(cx, a).raw.hits.filter(isCrash).reduce((x, y) => (!x || y.velocity > x.velocity ? y : x), null);
  if (!hit) return d;
  const louder = d.hits.find((h) => h.voice === 'cym' && h.tick === hit.tick && h.velocity >= hit.velocity - EPS);
  const hits = louder ? d.hits : sortHits([...d.hits.filter((h) => !(h.voice === 'cym' && h.tick === hit.tick)), { ...hit }]);
  const bars = d.bars.map((b, k) => (k ? b : { ...b, crash: true, why: `${b.why}; a crash on the downbeat: the section opens after a fill` }));
  return rehit({ ...d, bars }, hits);
}
/** the fill alone (a section with the drums off, into a peak): the fill bar's kick and snare from beat 3 */
function fillAlone(cx, d) {
  const from = d.beats.positions[2], k = cx.N - 1;
  return rehit({ ...d, enabled: true }, d.hits.filter((h) => h.bar === k && (h.voice === 'kick' || h.voice === 'snare') && h.pos >= from - EPS));
}
function filterPart(cx, part, M) {
  if ((M & cx.full) === cx.full) return part;
  const keep = (x) => (cx.row.owners[x.node] & M) !== 0, notes = part.notes.filter(keep);
  if (notes.length === part.notes.length) return part;
  return rearticulate({ ...part, notes, ...(part.strokes ? { strokes: part.strokes.filter(keep) } : {}) }, { cycleSeconds: cx.T });
}
function filterDrums(cx, d, M) {
  if ((M & cx.full) === cx.full || !d.enabled) return d;
  const hits = d.hits.filter((h) => (ownersOf(cx, nodeOfTick(cx, h.tick)) & M) !== 0);
  return hits.length === d.hits.length ? d : rehit(d, hits);
}
function passOf(cx, sec, fill, crash) {
  const s = settingOf(cx, sec.density ?? {});
  const key = JSON.stringify([sec.layers, SONG_PARTS.map((id) => sec.parts[id]), settingKey(s), fill, crash]);
  const had = cx.passes.get(key);
  if (had) return had;
  const a = arrangementOf(cx, s), M = sec.layers;
  const parts = a.parts.map((p) => (!sec.parts[p.id] ? (p.enabled ? { ...p, enabled: false } : p) : FILTERED_PARTS.includes(p.id) ? filterPart(cx, p, M) : p));
  let drums = a.drums;
  if (drums && drums.enabled) {
    if (fill) drums = fillOf(cx, a).drums;
    if (crash && sec.parts.drums) drums = withCrash(cx, a, drums);
    if (!sec.parts.drums) drums = fill ? fillAlone(cx, drums) : { ...drums, enabled: false };
    drums = filterDrums(cx, drums, M);
  }
  const out = { parts, drums };
  cx.passes.set(key, out);
  return out;
}

/**
 * The song pass by pass (S9): one entry a pass, { section (its index), pass (within it), parts (the parts as that pass
 * plays them: the density's arrangement, the mask's on/off, the layer filter), drums (that pass's: the fill, the crash) }.
 * Pure, and cached by section: passes alike are one object. The player reads it by pass index, the song repeating from
 * the top after the last. Reads only the sections' kind, passes, layers, parts, density and fillBefore.
 */
export function songPasses(song, loopSpec, materials) {
  const cx = contextOf(loopSpec, materials);
  readSong(cx, song);
  const S = song.sections, out = [];
  S.forEach((sec, i) => {
    const before = S[(i - 1 + S.length) % S.length];
    for (let p = 0; p < sec.passes; p++) {
      const { parts, drums } = passOf(cx, sec, !!sec.fillBefore && p === sec.passes - 1, !!before.fillBefore && p === 0);
      out.push({ section: i, pass: p, parts, drums });
    }
  });
  return out;
}
