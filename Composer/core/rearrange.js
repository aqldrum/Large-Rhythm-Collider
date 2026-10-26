// rearrange.js — local edits to a composed spec (STEP 4a; Composer/STEP4_ORDER.md): swap one bar's chord, or one
// phrase's lead for a runner-up line, and rebuild only what depends on it, with Compose's own builders (compose.js'
// per-bar functions, harmony.js' chordRecord). Nothing else is re-solved: no settle, no meter, no root.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   rearrange(spec, row, cells, { bar, chord })                     a chord swap at bar k
//   rearrange(spec, row, cells, { phrase, line, chordsFollow })     a lead swap over phrase p
//     → { parts, drums, chords, modulations, changedBars, retunedBars, changed, exceptions, stats }
//   applyRearrange(spec, result) → the spec with the result written in (a new object; the spec is not touched)
//   materialsOf(spec) → { row, cells }: the row and cells a spec was composed over, rebuilt from its input and knobs
//   materialsKey(spec) → the key they can be kept under (STEP 4d)
//
// A MIDI target's spec (phase A3, compose.js "MIDI targets") rearranges as any other: its cells are the N-bar cut
// cropped to the window (knobs.cut), its part context runs on the loop (knobs.rowCycleSeconds), and its
// lead's notes keep their note-off ends (`endTime`). It takes no lead swap (P6: the lead is the clip); a chord swap and
// the drums work as usual.
//
// What is decided (Avery, STEP4_ORDER.md "Decisions") and what is proposed:
//   pinned      the comp layer (spec.stats.compLayer), baseHz (spec.knobs) and every part's sound, legato and on/off
//               (the parts given): a local edit never becomes a global one. (decided, from the recommendations)
//   fixed       targets.scale, the union of the chords' classes as composed: a swap re-mines no other bar's line.
//               The swapped bar's own target reads its chord's classes too (scale ∪ the chord's; proposed), so a chord
//               tone is never a foreign one in its own bar.
//   chord swap  (decision 1) the lead stays. Bar k's chord voices, comping and bass are rebuilt over the new chord,
//               and its inner is re-mined bar-locally (lines.js `rules: { before, after }`: the inner's notes either
//               side of the bar as boundaries); the bar's exceptions are its lead's strong notes off the new chord (a
//               lead note foreign under the new chord's frame and target is a passing tone; proposed). An empty bar
//               that took bar k's chord takes the new one.
//   re-pitch    the modulation offset walks forward from bar 1, so a swap can retune bars k+1…: their notes stay, their
//               hz and folded names move (`retunedBars`), never re-mined.
//   lead swap   (decision 2) a phrase's line is replaced by another the miner made for it (a runner-up from the trace:
//               `line` is its id in `opts.trace.lines`, or a record with `notes: [{ slot, node, octave }]`). The inner
//               over the phrase is re-mined bar by bar with boundaries (`smoothPhrase: true`: over the whole phrase at
//               once, as Compose mines it: ~300 ms on the 16k row, for a worker). `chordsFollow` (off by default):
//               chooseChord again for the phrase's bars (a pinned bar keeps its chord), then each changed bar as a
//               chord swap.
//   unchanged   a bar whose chord is the same (root tone, quality, offset) keeps its inner; a phrase whose lead is the
//               same keeps its inner and exceptions. So an edit to what is already there is the spec byte for byte.
//   drums       arrangeDrums(the rearranged spec, the spec's own drum options), called as Compose calls it.
//
// `changedBars`: the bars whose material was rebuilt. `changed`: per part, the bars whose notes differ other than in
// their durations (a legato note before an edit may hold to a new next note). `retunedBars`: the bars after the edit
// whose fundamentalRatio moved.

import { buildRow, isRow, ONSET_GATE } from './row.js';
import { buildCells, cropCells } from './cells.js';
import { frameOf, classOfCents } from './frame.js';
import { CHORD_QUALITIES, pickFor, chordRecord, targetOfBar, barMaterial, chooseChord, exceptionsOfBar, phrasesOf, isStrongBeat } from './harmony.js';
import { FALLBACK_QUALITIES } from './progression.js';
import { arrangeDrums } from './drums.js';
import { partContext, chordVoicesOfBar, compOfBar, bassOfBar, innerOf, leadAvoidOf, partOf, specChordOf, PART_IDS } from './compose.js';

export const COMPOSER_REARRANGE_VERSION = 'composer-rearrange-v1';
const EPS = 1e-9;
const fail = (what) => { throw new Error(`composer/rearrange: ${what}`); };
const QUALITY = new Map([...CHORD_QUALITIES, ...FALLBACK_QUALITIES].map((q) => [q.id, q]));

/** the row and cells a spec was composed over: buildRow(input.layers) and buildCells from its knobs — a MIDI target's
 *  N-bar cut (knobs.cut) cropped to its bars (not for a spec composed over a prebuilt row, as Cosmos's
 *  superrow composes are) → { row, cells } */
export function materialsOf(spec) {
  if (!spec || spec.refused) fail('no materials for a refused spec');
  const row = buildRow(spec.input.layers, { gate: ONSET_GATE });
  if (!isRow(row)) fail('the spec\'s row is past the gate');
  const k = spec.knobs;
  if (k.cut) return { row, cells: cropCells(buildCells(row, { bars: k.cut.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase }), k.bars) };
  return { row, cells: buildCells(row, { bars: k.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase }) };
}

/** the key a composition's row and cells can be kept under (STEP 4d: the controller's and the worker's caches): its
 *  layers and the knobs materialsOf builds the cells from (a target's cut too, only when there is one) */
export const materialsKey = (spec) => JSON.stringify([spec.input.layers, spec.knobs.bars, spec.knobs.slotsPerBar, spec.knobs.anchors, spec.knobs.phase,
  ...(spec.knobs.cut ? [{ cut: spec.knobs.cut.bars }] : [])]);

// per cells (one compose's materials): the part context and the bars' tones, built once for every edit of that spec
const cache = new WeakMap();
function materialCache(row, cells, spec) {
  let c = cache.get(cells);
  const key = `${spec.knobs.cycleSeconds}|${spec.knobs.phase.join('/')}|${spec.knobs.frameCentsEachSide}|${spec.knobs.rowCycleSeconds ?? ''}`;
  if (!c || c.row !== row || c.key !== key) {
    const rowT = spec.knobs.rowCycleSeconds;
    c = { row, key, ctx: partContext(row, cells, { cycleSeconds: spec.knobs.cycleSeconds, phase: spec.knobs.phase, frameCentsEachSide: spec.knobs.frameCentsEachSide, ...(rowT != null ? { rowCycleSeconds: rowT } : {}) }), material: barMaterial(row, cells) };
    c.toneIndex = new Map(row.tones.map((t, i) => [t, i]));
    cache.set(cells, c);
  }
  return c;
}

/** a ratio of the row (or a tone index) → its tone index */
function toneOf(m, x) {
  if (Number.isInteger(x) && x >= 0 && x < m.row.tones.length) return x;
  const t = m.toneIndex.get(String(x));
  if (t === undefined) fail(`${JSON.stringify(x)} is not a tone of the row`);
  return t;
}

/**
 * The bars' chord records (harmony.js' shape) walked from bar 1: each bar's root tone and quality, the modulation rule
 * run at its incoming offset (the offset after the last bar with a chord of its own), and an empty bar taking its
 * neighbour's (the one before, else the one after), as harmonize walks them.
 *   given  [{ tone, node, quality (id), empty, targeted?, fallback? } | null per bar]
 */
function walkChords(m, given, { e, gridBase, modulation, foldOffsets }) {
  const { row } = m, recs = [];
  let offset = 0;
  for (let k = 0; k < given.length; k++) {
    const g = given[k];
    if (!g || g.empty) { recs.push(null); continue; }
    const quality = QUALITY.get(g.quality) ?? fail(`no quality ${g.quality}`);
    const pick = pickFor({ tone: g.tone, cents: row.toneCents[g.tone], node: g.node }, quality, { eachSide: e, gridBase, offset, modulation, foldOffsets });
    offset = pick.offset;
    recs.push(chordRecord(row, k, pick, { eachSide: e }));
  }
  for (let k = 0; k < recs.length; k++) if (!recs[k]) {
    const near = recs.slice(0, k).reverse().find((x) => x && !x.empty) ?? recs.slice(k + 1).find((x) => x && !x.empty);
    if (!near) fail('no bar holds a chord');
    recs[k] = { ...near, bar: k, empty: true, from: near.bar };
  }
  return recs;
}

/** the spec's chords as `walkChords` takes them */
const givenOf = (m, chords) => chords.map((c) => ({ tone: toneOf(m, c.rootTone), node: c.rootNode, quality: c.quality, empty: !!c.empty }));

/** a spec part's notes back as the builders' notes (compose.js), for `partOf` to rebuild the part */
function builderNotes(m, part) {
  const { row, cells, S } = m.ctx;
  return part.notes.map((n) => ({ node: n.node, tone: row.tone[n.node], octave: n.octave, pitch: row.toneCents[row.tone[n.node]] + 1200 * n.octave, bar: n.bar, slot: n.slot, time: n.time, slotSeconds: n.slotSeconds,
    ...(n.voice != null ? { voice: n.voice } : {}), ...(part.id === 'comp' ? { strikes: row.strikes[n.node] } : {}), ...(part.id === 'lead' ? { strong: isStrongBeat(cells.slots[n.slot].beat, S) } : {}),
    ...(n.endTime != null ? { endTime: n.endTime } : {}), ...(n.clipNote != null ? { clipNote: n.clipNote } : {}) }));
}
/** a line's notes ({ slot (the cells' slot), node, octave }) as the lead part's builder notes */
function leadLineNotes(m, notes) {
  const { row, cells, S, timeOf, slotSeconds } = m.ctx;
  return notes.map((n) => { const tone = row.tone[n.node]; return { node: n.node, tone, octave: n.octave, pitch: row.toneCents[tone] + 1200 * n.octave, bar: Math.floor(n.slot / S), slot: n.slot, time: timeOf(row.tick[n.node]), slotSeconds: slotSeconds(n.slot), strong: isStrongBeat(cells.slots[n.slot].beat, S) }; });
}
/** the lead's notes as harmony.js reads them for chords and exceptions (cents, bar, beat, outside), each read under its bar's chord and target */
function leadForHarmony(m, notes, recs, targets) {
  const { row, cells } = m.ctx;
  return notes.map((n) => {
    const c = recs[n.bar], t = targets[n.bar], f = c.frame;
    return { slot: n.slot, node: n.node, fraction: row.tones[n.tone], cents: row.toneCents[n.tone], bar: n.bar, beat: cells.slots[n.slot].beat, outside: !f.inside[n.tone] || !t.scale.includes(f.pc[n.tone]) };
  });
}

/** the inner over one bar, re-mined with the inner's notes either side as its boundaries */
function innerOfBar(m, k, inner, { recs, targets, lead, table }) {
  const { S, row } = m.ctx, pitch = (n) => row.toneCents[n.tone] + 1200 * n.octave;
  let before = null, after = null;
  for (const n of inner) {
    if (n.slot < k * S && (!before || n.slot > before.slot)) before = n;
    if (n.slot >= (k + 1) * S && (!after || n.slot < after.slot)) after = n;
  }
  return innerOf(m.ctx, { from: k, bars: 1 }, { chords: recs, targets, lead, table, rules: { ...(before ? { before: { pitch: pitch(before) } } : {}), ...(after ? { after: { pitch: pitch(after) } } : {}) } });
}

/** per part, the bars whose notes differ other than in duration and retrigger */
function changedByBar(oldParts, newParts) {
  const key = (n) => { const { duration, retrigger, ...rest } = n; return JSON.stringify(rest); };
  const out = {};
  for (const p of newParts) {
    const was = oldParts.find((x) => x.id === p.id), bars = new Set();
    const group = (notes) => { const g = new Map(); for (const n of notes) { if (!g.has(n.bar)) g.set(n.bar, []); g.get(n.bar).push(key(n)); } return g; };
    const a = group(was ? was.notes : []), b = group(p.notes);
    for (const bar of new Set([...a.keys(), ...b.keys()])) if ((a.get(bar) || []).join('\n') !== (b.get(bar) || []).join('\n')) bars.add(bar);
    out[p.id] = [...bars].sort((x, y) => x - y);
  }
  return out;
}

/**
 * Rearrange a spec locally.
 *   spec   a composed spec (not refused); row, cells: its materials (materialsOf(spec), or the ones Compose used)
 *   edit   { bar, chord: { root: { tone, node? } | rootTone (a ratio or tone index), quality } }   (a trace chord
 *            candidate, or a pin's { rootTone, quality })
 *        | { phrase, line: an id of opts.trace.lines | { notes: [{ slot, node, octave }] }, chordsFollow (false) }
 *   opts   { parts (the parts as they play now; default spec.parts), trace (for a line id), drumOptions (default the
 *            spec's own), smoothPhrase (false: the inner re-mined bar by bar; true: over the whole phrase) }
 * → { version, parts, drums, chords, modulations, changedBars, retunedBars, changed: { part: [bar] }, exceptions, stats }
 */
export function rearrange(spec, row, cells, edit, opts = {}) {
  if (!spec || spec.refused) fail('nothing to rearrange in a refused spec');
  if (!edit || (edit.bar == null) === (edit.phrase == null)) fail('an edit is { bar, chord } or { phrase, line }');
  const K = spec.knobs, N = K.bars, S = K.slotsPerBar;
  if (cells.bars !== N || cells.slotsPerBar !== S) fail(`the cells are ${cells.bars} × ${cells.slotsPerBar}, the spec ${N} × ${S}`);
  const m = materialCache(row, cells, spec), { ctx } = m;
  const e = K.frameCentsEachSide, modulation = K.modulation, foldOffsets = spec.input.overrides?.foldOffsets ?? true, table = K.table;
  const gridBase = frameOf(row, toneOf(m, K.root), e).rootCents, how = { e, gridBase, modulation, foldOffsets };
  const parts = opts.parts ?? spec.parts, partById = Object.fromEntries(parts.map((p) => [p.id, p]));
  for (const id of PART_IDS) if (!partById[id]) fail(`no ${id} part`);

  // the chords as composed, rebuilt as records; the parent scale fixed
  const given = givenOf(m, spec.chords), was = walkChords(m, given, how);
  const scale = [...new Set(was.flatMap((c) => c.gridPcs))].sort((a, b) => a - b);
  const notes = Object.fromEntries(PART_IDS.map((id) => [id, builderNotes(m, partById[id])]));
  const exceptions = spec.chords.map((c) => c.exceptions);

  // `target`: the bars whose chord voices, comping and bass are built again (the edit's bars); `rebuilt`: those whose
  // chord is another one (their inner is re-mined, their exceptions counted again, their target reads the new chord)
  let recs = was;
  const target = new Set(), rebuilt = new Set(), leadChanged = new Set();
  /** walk `next`; the bars in `bars` (and the empty bars that take their chord) are the edit's */
  const swap = (next, bars) => {
    recs = walkChords(m, next, how);
    for (let j = 0; j < N; j++) {
      const src = recs[j].empty ? recs[j].from : j;
      if (!bars.has(src)) continue;
      target.add(j);
      if (recs[j].rootTone !== was[j].rootTone || recs[j].quality !== was[j].quality || !!recs[j].empty !== !!was[j].empty || (recs[j].empty && recs[j].from !== was[j].from)) rebuilt.add(j);
    }
  };

  if (edit.bar != null) {
    // ── a chord swap ──
    const k = edit.bar;
    if (!(Number.isInteger(k) && k >= 0 && k < N)) fail(`no bar ${k}`);
    const c = edit.chord ?? fail('a chord swap needs { chord }');
    const tone = toneOf(m, c.root?.tone ?? c.rootTone), quality = c.quality?.id ?? c.quality;
    if (!QUALITY.has(quality)) fail(`no quality ${quality}`);
    const node = c.root?.node ?? (!given[k].empty && given[k].tone === tone ? given[k].node : m.material[k].get(tone)?.node ?? null);
    const next = given.map((g) => ({ ...g }));
    next[k] = { tone, node, quality, empty: false };
    swap(next, new Set([k]));
  } else {
    // ── a lead swap ──
    if (spec.target) fail('a MIDI target composition takes no lead swaps: its lead is the clip (P6)');
    const span = phrasesOf(cells)[edit.phrase] ?? fail(`no phrase ${edit.phrase}`);
    const line = typeof edit.line === 'string' ? (opts.trace?.lines?.[edit.line] ?? fail(`no line ${edit.line} in the trace`)) : edit.line;
    if (!line || !Array.isArray(line.notes)) fail('a lead swap needs { line } (an id in opts.trace.lines, or a record with notes)');
    const lo = span.from * S, hi = (span.from + span.bars) * S, inSpan = (n) => n.slot >= lo && n.slot < hi;
    for (const n of line.notes) if (!(n.slot >= lo && n.slot < hi) || !(n.node >= 0 && n.node < row.n)) fail(`a line note at slot ${n.slot} is outside phrase ${edit.phrase} (slots ${lo}–${hi - 1})`);
    const fresh = leadLineNotes(m, line.notes), old = notes.lead.filter(inSpan);
    const sig = (xs) => xs.map((n) => `${n.slot}:${n.node}:${n.octave}`).sort().join(',');
    if (sig(fresh) !== sig(old)) for (let j = span.from; j < span.from + span.bars; j++) leadChanged.add(j);
    notes.lead = [...notes.lead.filter((n) => !inSpan(n)), ...fresh];
    if (edit.chordsFollow && leadChanged.size) {
      // chooseChord again over the new lead, bar by bar along the phrase (a pinned bar keeps its chord); the modulation
      // offset and the voice-leading walk on from each new chord
      const next = given.map((g) => ({ ...g })), bars = new Set();
      let cur = was;
      for (let j = span.from; j < span.from + span.bars; j++) {
        if (spec.chords[j].targeted || given[j].empty) continue;
        const tg = cur.map((c) => targetOfBar(c, scale));
        const inBar = leadForHarmony(m, notes.lead.filter((n) => n.bar === j), cur, tg).filter((n) => !n.outside);
        let strong = inBar.filter((n) => isStrongBeat(n.beat, S));
        if (!strong.length && inBar.length) strong = [inBar[0]];
        let prev = null; for (let i = j - 1; i >= 0; i--) if (!cur[i].empty) { prev = cur[i]; break; }
        const pick = chooseChord([...m.material[j].values()], inBar.map((n) => ({ cents: n.cents, strong: strong.includes(n) })),
          { eachSide: e, gridBase, offset: prev ? prev.rawOffsetCents : 0, modulation, prevPcs: prev ? prev.gridPcs : null, foldOffsets });
        if (!pick) continue;
        next[j] = { tone: pick.root.tone, node: pick.root.node, quality: pick.quality.id, empty: false };
        bars.add(j);
        cur = walkChords(m, next, how);
      }
      swap(next, bars);
    }
  }

  // ── the targets: the parent scale fixed; a rebuilt bar's own target reads its chord's classes too ──
  const targets = recs.map((c, k) => targetOfBar(c, rebuilt.has(k) ? [...new Set([...scale, ...c.gridPcs])].sort((a, b) => a - b) : scale));
  const allTargets = { scale, bars: targets };

  // ── the rebuilt bars: chord voices, comping (the layer pinned), bass ──
  const compLayer = 'ABCD'.indexOf(spec.stats.compLayer.layer);
  if (compLayer < 0) fail('the spec names no comp layer');
  const bassRooted = [];
  for (const k of [...target].sort((a, b) => a - b)) {
    const c = recs[k];
    notes.chords = [...notes.chords.filter((n) => n.bar !== k), ...chordVoicesOfBar(ctx, c, k)];
    notes.comp = [...notes.comp.filter((n) => n.bar !== k), ...compOfBar(ctx, c, k, compLayer)];
    const b = bassOfBar(ctx, c, k, { table, scale, target: targets[k] });
    notes.bass = [...notes.bass.filter((n) => n.bar !== k), ...b.notes];
    bassRooted[k] = b.rooted;
  }
  // ── the inner: bar-local over each rebuilt bar or a bar of a changed lead, with boundaries (or the whole phrase) ──
  const innerBars = new Set([...rebuilt, ...leadChanged]);
  if (innerBars.size) {
    const lead = leadAvoidOf(notes.lead);
    if (opts.smoothPhrase) {
      for (const span of phrasesOf(cells)) {
        if (![...innerBars].some((k) => k >= span.from && k < span.from + span.bars)) continue;
        const got = innerOf(ctx, span, { chords: recs, targets: allTargets, lead, table });
        notes.inner = [...notes.inner.filter((n) => n.bar < span.from || n.bar >= span.from + span.bars), ...got.notes];
      }
    } else {
      for (const k of [...innerBars].sort((a, b) => a - b)) {
        const rest = notes.inner.filter((n) => n.bar !== k);
        const got = innerOfBar(m, k, rest, { recs, targets: allTargets, lead, table });
        notes.inner = [...rest, ...got.notes];
      }
    }
  }
  // ── exceptions: a rebuilt bar's, or a bar of a changed lead's, counted again; the rest as composed ──
  for (const k of new Set([...rebuilt, ...leadChanged])) {
    exceptions[k] = exceptionsOfBar(recs[k], leadForHarmony(m, notes.lead.filter((n) => n.bar === k), recs, targets), S, e).exceptions.length;
  }

  // ── the parts, rebuilt whole from their notes (re-articulated; hz at each bar's retune) ──
  const ratioOf = (bar) => recs[bar].fundamentalRatio, baseHz = K.baseHz;
  const byVoice = (list) => { const v = []; for (const n of list.sort((a, b) => a.bar - b.bar || a.time - b.time)) (v[n.voice] ||= []).push(n); return v; };
  const newParts = PART_IDS.map((id) => {
    const p = partById[id];
    return partOf(ctx, id, id === 'chords' ? byVoice(notes.chords) : notes[id], { sound: p.sound, legato: p.legato, enabled: p.enabled, baseHz, ratioOf, voice: id === 'chords' });
  });
  // ── the chords and modulations, as the spec has them ──
  const targeted = spec.chords.some((c) => 'targeted' in c);
  const chords = recs.map((c, k) => {
    const own = !rebuilt.has(k), old = spec.chords[k];
    const out = specChordOf({ ...c, exceptions: [] }, { fundamentalRatio: c.fundamentalRatio, targeted: targeted ? (own ? !!old.targeted : false) : undefined });
    out.exceptions = exceptions[k];
    if (targeted) out.fallback = own ? old.fallback ?? null : null;
    return out;
  });
  const modulations = [];
  for (let k = 0, prev = 0; k < N; k++) {
    const c = recs[k];
    if (c.empty) continue;
    if (Math.abs(c.rawOffsetCents - prev) > EPS) modulations.push({ bar: k, cents: c.offsetCents, rawCents: c.rawOffsetCents, fundamentalRatio: 2 ** (c.rawOffsetCents / 1200) });
    prev = c.rawOffsetCents;
  }
  const retunedBars = [];
  for (let k = 0; k < N; k++) if (!rebuilt.has(k) && Math.abs(recs[k].fundamentalRatio - was[k].fundamentalRatio) > 1e-12) retunedBars.push(k);

  // ── the drums: arrangeDrums over the rearranged spec, with the spec's own options ──
  const next = { ...spec, parts: newParts, chords };
  const drums = spec.drums === undefined && opts.drumOptions === undefined ? undefined : arrangeDrums(next, opts.drumOptions ?? spec.drums?.options ?? {});

  // ── stats ──
  const counts = Object.fromEntries(newParts.map((p) => [p.id, p.notes.length]));
  let rooted = 0;
  for (let k = 0; k < N; k++) {
    if (bassRooted[k] !== undefined) { if (bassRooted[k]) rooted++; continue; }
    const first = notes.bass.filter((n) => n.bar === k).sort((a, b) => a.slot - b.slot)[0];
    if (first && classOfCents(row.toneCents[first.tone] - recs[k].rootCents).pc === 0) rooted++;
  }
  const leadCells = new Set(notes.lead.map((n) => n.slot));
  const stats = { notes: counts, exceptions: exceptions.reduce((a, b) => a + b, 0), chordVoices: notes.chords.length / N, bassRooted: `${rooted}/${N}`, innerOnLeadSlots: notes.inner.filter((n) => leadCells.has(n.slot)).length };

  const changedBars = [...new Set([...rebuilt, ...leadChanged])].sort((a, b) => a - b);
  return { version: COMPOSER_REARRANGE_VERSION, parts: newParts, drums, chords, modulations, changedBars, retunedBars, changed: changedByBar(parts, newParts), exceptions: stats.exceptions, stats };
}

/** a spec with a rearrangement written in: parts, drums, chords, modulations and the stats it moves (a new object) */
export function applyRearrange(spec, r) {
  const out = { ...spec, chords: r.chords, modulations: r.modulations, parts: r.parts, stats: { ...spec.stats, notes: r.stats.notes, exceptions: r.stats.exceptions, chordVoices: r.stats.chordVoices, bassRooted: r.stats.bassRooted, innerOnLeadSlots: r.stats.innerOnLeadSlots } };
  if (r.drums !== undefined) out.drums = r.drums;
  return out;
}
