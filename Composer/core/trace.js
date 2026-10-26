// trace.js — the compose trace: an opt-in, pure observer of Compose's decisions, for renderers that animate them
// (built 2026-10-22 night, sprint; the shape is proposed, not ruled). Composer/TRACE.md is the contract.
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   on        `compose(layers, T, { trace: true })` makes a recorder (`createTrace`) and hands it to the steps; the spec
//             gains `spec.trace`, and nothing else of the spec moves (the recorder never draws from the seed, never
//             writes back into what it is shown). Off, the default, nothing here runs: the steps call `rec?.x(...)`
//             on a null recorder, which skips the call and its arguments.
//   events    an ordered list of untimed decisions, plain JSON: { kind, ...fields }. Onsets are referred to by their
//             row index (`node`); `trace.nodes[node]` spells each one referenced (tick, ratio, cents, layers, strikes),
//             so a renderer maps a ref to the plot without the row. Lines are referred to by id; `trace.lines[id]`
//             holds each one's notes once (slot, node, octave).
//   bounded   every list is capped (TRACE_CAPS): top-k root candidates, runner-up lines, chord candidates, part notes,
//             drum hits. On the 16,359-onset row the trace is about 100 KB of JSON.
//   pacing    `traceTimeline(trace, { pace, seconds })`: the events grouped into readable beats (root, line, chords,
//             settle 1..n, parts, drums), each step with a relative start and duration in seconds. Pure: no clock.

import { rankRoots, clusterOf } from './frame.js';
import { lowerBoundTick } from './row.js';
import { PC_NAMES } from './harmony.js';
import { downbeatLayers } from './drums.js';

export const COMPOSER_TRACE_VERSION = 'composer-trace-v1';
/** how many of each list a trace keeps (proposed) */
export const TRACE_CAPS = Object.freeze({
  rootCandidates: 8,    // the root's ranked candidates, the pick first
  rootSamples: 12,      // onsets sampled, evenly through the row, from each root candidate's cluster
  runnersUp: 3,         // lines a lead mining tested and ranked below the one it chose
  chordCandidates: 6,   // a bar's (root, quality) candidates, best first
  partNotes: 256,       // notes a part event lists
  drumHits: 512,        // strokes the drums event lists
});
/** STEP 4a: the caps of `trace: { caps }` (the alternates by bar × part: STEP4_RECOMMENDATIONS.md §1), before its
 *  own `caps`: a bar's 12 best chords and a phrase's 8 runner-up lines. `trace: true` keeps TRACE_CAPS (the show's,
 *  which Cosmos's dust and the main page's animation read), so nothing that asks `true` sees a longer list (proposed). */
export const ALTERNATE_CAPS = Object.freeze({ ...TRACE_CAPS, chordCandidates: 12, runnersUp: 8 });
/** the caps the `trace` option of compose() asks for: true → TRACE_CAPS; { caps } → ALTERNATE_CAPS with `caps` over them */
export function traceCapsOf(option) {
  if (option === true) return { ...TRACE_CAPS };
  const caps = option && typeof option === 'object' ? option.caps ?? {} : {};
  for (const [k, v] of Object.entries(caps)) if (!(k in TRACE_CAPS) || !(Number.isInteger(v) && v >= 0)) throw new Error(`composer/trace: no cap ${k} = ${JSON.stringify(v)} (caps are ${Object.keys(TRACE_CAPS).join(', ')}, each an integer ≥ 0)`);
  return { ...ALTERNATE_CAPS, ...caps };
}

const LAYER_NAMES = 'ABCD';
const mod = (v, n) => ((v % n) + n) % n;
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
/** lexicographic: does key a rank before key b? (harmony.js' `before`) */
const before = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };
const layersOf = (mask) => { let s = ''; for (let b = 0; b < 4; b++) if (mask & (1 << b)) s += LAYER_NAMES[b]; return s; };
const STAGES = { first: ['pass1', 0], second: ['pass2', 0] };
const stageOf = (tag) => STAGES[tag] ?? ['settle', Number(String(tag).replace('round', ''))];

/**
 * A recorder for one compose over a built row. Compose and harmonize call its methods in pipeline order; `finish`
 * hands back the trace. opts { cycleSeconds, meter: { bars, slots, tempoRange, beatsPerBar } (compose.js' constants),
 * caps (TRACE_CAPS overrides) }.
 */
export function createTrace(row, { cycleSeconds, meter: M = null, caps = {} } = {}) {
  const cap = { ...TRACE_CAPS, ...caps }, T = cycleSeconds;
  const events = [], nodes = new Map(), lines = new Map();
  const emit = (kind, data) => { const ev = { kind, ...data }; events.push(ev); return ev; };
  /** an onset by row index, registered in the nodes table → the index (null for none) */
  const ref = (i) => {
    if (i == null || !(i >= 0 && i < row.n)) return null;
    if (!nodes.has(i)) nodes.set(i, { tick: row.tick[i], ratio: row.tones[row.tone[i]], cents: r3(row.toneCents[row.tone[i]]), layers: layersOf(row.owners[i]), strikes: row.strikes[i] });
    return i;
  };
  /** the onset at a tick of the row (the drums' strokes and the phase are ticks) → its index, or null */
  const atTick = (tick) => { const i = lowerBoundTick(row, tick); return i < row.n && row.tick[i] === tick ? ref(i) : null; };
  /** a line, registered in the lines table → its id */
  const lineRef = (line) => {
    if (!line) return null;
    if (!lines.has(line.id)) lines.set(line.id, { id: line.id, type: line.type, band: line.band, motion: line.motion ?? null, contour: line.contour?.shape ?? null, from: line.from, bars: line.bars,
      notes: line.notes.map((n) => ({ slot: n.cell, node: ref(n.node), octave: n.octave })) });
    return line.id;
  };
  const toneRef = (t) => ({ tone: t, ratio: row.tones[t], cents: r3(row.toneCents[t]) });
  let phase = null, chordBuf = new Map(), prevKeys = null;
  const settleEvents = new Map(), bassBars = [], innerPhrases = [];

  return {
    row() {
      emit('row', { onsets: row.n, tones: row.tones.length, grid: row.grid, cycleSeconds: T, longest: row.longest,
        layers: row.active.map((b) => ({ layer: LAYER_NAMES[b], value: row.layers[b] })) });
    },
    root(e, presence, rootTone, asked) {
      const rank = rankRoots(row, e, { presence, count: cap.rootCandidates });
      const list = rank.ranked.map((c) => ({ ...c }));
      if (!list.some((c) => c.tone === rootTone)) list.push({ tone: rootTone, frameOnsets: null, presence: null, onsets: row.toneCount[rootTone], outside: true });
      // samples: onsets of each candidate's cluster (its own under 'exact'), evenly through the row
      const members = new Map(), heard = list.map(() => 0);
      list.forEach((c, ci) => { for (const u of presence === 'cluster' ? clusterOf(row, c.tone, e) : [c.tone]) { (members.get(u) ?? members.set(u, []).get(u)).push(ci); heard[ci] += row.toneCount[u]; } });
      const stride = heard.map((n) => Math.max(1, Math.ceil(n / cap.rootSamples))), seen = list.map(() => 0), samples = list.map(() => []);
      for (let i = 0; i < row.n; i++) {
        const cs = members.get(row.tone[i]);
        if (cs) for (const ci of cs) { if (seen[ci]++ % stride[ci] === 0 && samples[ci].length < cap.rootSamples) samples[ci].push(ref(i)); }
      }
      emit('root', { frameCentsEachSide: e, presence, asked: !!asked, pick: rootTone, need: rank.need, rung: rank.rung, pool: rank.pool, eligible: rank.eligible,
        candidates: list.map((c, ci) => ({ ...toneRef(c.tone), presence: c.presence, frameOnsets: c.frameOnsets, onsets: c.onsets, node: ref(row.toneFirst[c.tone]), samples: samples[ci],
          ...(c.outside ? { ranked: false } : {}) })) });
    },
    meter(meter, asked) {
      const tempo = (N) => (60 * N * M.beatsPerBar) / T, [lo, hi] = M.tempoRange;
      emit('meter', { asked: { bars: asked.bars ?? null, slotsPerBar: asked.slotsPerBar ?? null }, tempoRange: [lo, hi],
        candidates: M.bars.map((N) => ({ bars: N, tempoBpm: r3(tempo(N)), inRange: tempo(N) >= lo - 1e-9 && tempo(N) <= hi + 1e-9 })),
        slotCandidates: M.slots.map((S) => ({ slotsPerBar: S, onsetsPerSlot: r3(row.n / (meter.bars * S)) })),
        bars: meter.bars, slotsPerBar: meter.slotsPerBar, P: meter.bars * meter.slotsPerBar, tempoBpm: r3(meter.tempoBpm), onsetsPerSlot: r3(row.n / (meter.bars * meter.slotsPerBar)), notes: [...meter.notes] });
    },
    phase(beats, at, chosen) {
      phase = [...chosen];
      const tickOf = ([n, d]) => n * (row.grid / d);
      emit('phase', { asked: beats == null, candidates: (beats || []).map((p) => ({ phase: [...p], tick: tickOf(p), node: atTick(tickOf(p)) })), pick: beats == null ? null : at,
        phase: [...chosen], tick: tickOf(chosen), node: atTick(tickOf(chosen)) });
    },
    cells(cells) {
      const g = row.grid;
      emit('cells', { anchors: cells.mode, bars: cells.bars, slotsPerBar: cells.slotsPerBar, P: cells.P, swing: r4(cells.swing),
        pulses: cells.pulses ? { G: cells.pulses.G, R: cells.pulses.R, delta: cells.pulses.delta, subdivide: cells.pulses.subdivide } : null,
        slots: cells.slots.map((s) => ({ slot: s.index, bar: s.bar, beat: s.beat, tick: r3(s.tick), reach: [r3(s.reach[0] * g), r3(s.reach[1] * g)], onsets: s.nodes, tones: s.tones.length, node: ref(s.tones[0]?.node) })) });
    },
    progression(prog, leader) {
      emit('progression', { leader, targeted: !!prog.targeted, asked: prog.asked ? [...prog.asked] : null, notes: [...prog.notes],
        bars: prog.roots.map((t, k) => (t == null ? { bar: k, auto: true } : { bar: k, auto: false, ...toneRef(t), node: ref(row.toneFirst[t]) })) });
    },
    /** a lead mining for one phrase: pass 1 ('first'), pass 2 ('second') or a settle round ('roundN') */
    lead(tag, phrase, from, bars, mined, held = null) {
      const [stage, round] = stageOf(tag);
      if (mined == null) { emit('lead', { stage, round, phrase, from, bars, skipped: 'pinned', mined: null, runnersUp: [], tested: 0, held: null, kept: null, keptId: null }); return; }
      const top = mined[0] ?? null;
      const ev = { stage, round, phrase, from, bars, skipped: null, mined: top ? { id: lineRef(top), perNote: r4(top.perNote) } : null,
        runnersUp: mined.slice(1, 1 + cap.runnersUp).map((l) => ({ id: lineRef(l), perNote: r4(l.perNote) })), tested: mined.length };
      if (stage === 'pass1') Object.assign(ev, { held: null, kept: top ? 'mined' : null, keptId: top ? top.id : null });
      else {
        const { cur, curTag, under, useNewer } = held, kept = useNewer ? top : cur;
        Object.assign(ev, { held: cur ? { id: lineRef(cur), from: curTag, perNote: r4(under), fits: Number.isFinite(under) } : null, kept: kept ? (useNewer ? 'mined' : 'held') : null, keptId: kept ? kept.id : null });
      }
      emit('lead', ev);
    },
    /** the candidate collector for one bar of one derivation (chooseChord's `observe`); `shift` names a class (fold − the reference) */
    candidates(round, bar, shift) {
      const buf = { tested: 0, top: [], shift, unsupported: [] };
      chordBuf.set(bar, buf);
      return (root, quality, rootPc, violations, held, support, key, missing = null) => {
        if (key == null) { if (!buf.unsupported.some((x) => x.quality === quality.id)) buf.unsupported.push({ quality: quality.id, missing: [...missing] }); return; }
        buf.tested++;
        const top = buf.top;
        if (top.length >= cap.chordCandidates && !before(key, top[top.length - 1].key)) return;
        let j = top.length; while (j > 0 && before(key, top[j - 1].key)) j--;
        top.splice(j, 0, { key, root, quality, rootPc, violations, held, support });
        if (top.length > cap.chordCandidates) top.pop();
      };
    },
    /** one derivation's chords (round 0 from pass 1's lead, round i a settle round's) */
    chords(round, chords, modulations) {
      const keys = chords.map((c) => `${c.rootTone}|${c.quality}|${c.rawOffsetCents}`);
      chords.forEach((c, k) => {
        // a chart's split bar (CHART_ORDER.md): the chord is a span's; the event names its bar and its span
        const split = c.slots != null, buf = chordBuf.get(k) ?? { tested: 0, top: [], shift: 0, unsupported: [] }, m = modulations.find((x) => (split ? x.span === k : x.bar === k));
        const cands = c.empty ? [] : buf.top.map((x) => ({ root: { ...toneRef(x.root.tone), node: ref(x.root.node) }, quality: x.quality.id, label: `${PC_NAMES[mod(x.rootPc - buf.shift, 12)]}${x.quality.suffix}`,
          violations: x.violations, held: x.held, support: r4(x.support), voiceLeading: x.key[3] }));
        emit('chord', { stage: round === 0 ? 'chords' : 'settle', round, bar: split ? c.bar : k, ...(split ? { span: k } : {}), pinned: !!c.targeted, empty: !!c.empty,
          pick: { root: { ...toneRef(c.rootTone), node: ref(c.rootNode) }, name: c.name, quality: c.quality, intervals: [...c.intervals], pcs: [...c.pcs], violations: c.firstPass.violations, held: c.firstPass.held, support: r4(c.support) },
          pickIndex: cands.findIndex((x) => x.root.tone === c.rootTone && x.quality === c.quality), candidates: cands, tested: c.empty ? 0 : buf.tested,
          offsetCents: r3(c.offsetCents), retune: m ? { cents: r3(m.cents), rawCents: r3(m.rawCents), fundamentalRatio: m.fundamentalRatio } : null, offGrid: !!c.offGrid,
          ...(c.targeted ? { fallback: c.fallback ?? null, sounded: c.sounded, missing: [...(c.missing || [])], unsupported: c.empty ? [] : buf.unsupported } : {}),
          ...(round > 0 ? { changed: !prevKeys || prevKeys[k] !== keys[k] } : {}) });
      });
      prevKeys = keys; chordBuf = new Map();
    },
    /** a settle round opens (its outcome is filled in by `settled`) */
    settle(round) { settleEvents.set(round, emit('settle', { round, changedBars: null, outcome: null, leadChangedPhrases: [] })); },
    settled(run, passes) {
      for (const r of run.rounds) {
        const ev = settleEvents.get(r.round); if (!ev) continue;
        ev.changedBars = [...r.changedBars];
        ev.outcome = !r.changedBars.length ? 'converged' : 'repeats' in r ? 'repeats' : 'changed';
        if ('repeats' in r) ev.repeats = r.repeats;
        const p = passes.rounds.find((x) => x.round === r.round);
        ev.leadChangedPhrases = p ? p.phrases.flatMap((x, i) => (x.kept === 'newer' ? [i] : [])) : [];
      }
    },
    harmony(h) {
      emit('harmony', { cap: h.settle.cap, rounds: h.settle.rounds, converged: h.settle.converged, oscillated: h.settle.oscillated, cycle: h.settle.cycle ? [...h.settle.cycle] : null, chosenRound: h.settle.chosenRound,
        exceptions: h.exceptions, lead: { phrases: h.lead.phrases.map(lineRef), kept: [...h.lead.kept] },
        chords: h.chords.map((c) => ({ bar: c.bar, name: c.name, quality: c.quality, root: { ...toneRef(c.rootTone), node: ref(c.rootNode) }, offsetCents: r3(c.offsetCents), fundamentalRatio: c.fundamentalRatio, exceptions: c.exceptions.length })),
        modulations: h.modulations.map((m) => ({ bar: m.bar, cents: r3(m.cents), rawCents: r3(m.rawCents), fundamentalRatio: m.fundamentalRatio })) });
    },
    bassBar(bar, line, opened) { bassBars.push({ bar, line: lineRef(line), rootOnly: !line, opensOnRoot: !!opened }); },
    innerPhrase(from, bars, line) { innerPhrases.push({ from, bars, line: lineRef(line) }); },
    /** the arranged parts, in the order Compose builds them, each with what chose it */
    parts(partList, { comp, compChoices, compAsked }) {
      const extra = {
        lead: { phrases: null }, chords: {},
        comp: { layer: LAYER_NAMES[comp.layer], value: comp.value, score: r4(comp.score), asked: !!compAsked, candidates: compChoices.map((x) => ({ layer: LAYER_NAMES[x.layer], value: x.value, score: r4(x.score) })) },
        bass: { bars: bassBars.map((x) => ({ ...x })) }, inner: { phrases: innerPhrases.map((x) => ({ ...x })) },
      };
      const lead = events.find((x) => x.kind === 'harmony');
      extra.lead.phrases = lead ? [...lead.lead.phrases] : [];
      for (const p of partList) {
        emit('part', { part: p.id, sound: p.sound, count: p.notes.length, truncated: Math.max(0, p.notes.length - cap.partNotes),
          notes: p.notes.slice(0, cap.partNotes).map((n) => ({ node: ref(n.node), bar: n.bar, slot: n.slot, octave: n.octave, ...(n.voice != null ? { voice: n.voice } : {}) })), ...extra[p.id] });
      }
    },
    drums(spec) {
      const d = spec.drums;
      if (!d) return;
      emit('drums', { mode: d.mode, enabled: d.enabled, beats: [...d.beats.positions],
        downbeatLayers: downbeatLayers(spec).map((o) => ({ layer: o.name, value: o.value, pulse: o.pulse })), partition: d.partition ? { ...d.partition, candidates: [...d.partition.candidates] } : null,
        bars: d.bars.map((b) => ({ bar: b.bar, mode: b.mode, fill: b.fill, crash: b.crash })), count: d.hits.length, truncated: Math.max(0, d.hits.length - cap.drumHits),
        hits: d.hits.slice(0, cap.drumHits).map((x) => ({ voice: x.voice, bar: x.bar, slot: x.slot, pos: r3(x.pos), tick: x.tick, node: atTick(x.tick), velocity: r3(x.velocity), snap: x.snap })) });
    },
    done(spec) {
      emit('done', { leader: spec.knobs.leader, tempoBpm: r3(spec.knobs.tempoBpm), baseHz: r3(spec.knobs.baseHz), notes: { ...spec.stats.notes }, drums: spec.drums ? spec.drums.hits.length : 0 });
    },
    finish() {
      const nodeTable = {}; for (const i of [...nodes.keys()].sort((a, b) => a - b)) nodeTable[i] = nodes.get(i);
      const lineTable = {}; for (const [id, l] of lines) lineTable[id] = l;
      return { version: COMPOSER_TRACE_VERSION, layers: [...row.layers], grid: row.grid, onsets: row.n, cycleSeconds: T, phase, caps: { ...cap },
        nodes: nodeTable, lines: lineTable, events, stats: { events: events.length, nodes: nodes.size, lines: lines.size } };
    },
  };
}

/** the trace of a refused compose: one event saying why */
export function refusedTrace(spec, { cycleSeconds, caps = {} } = {}) {
  return { version: COMPOSER_TRACE_VERSION, layers: [...spec.input.layers], grid: null, onsets: spec.detail?.onsets ?? null, cycleSeconds, phase: null, caps: { ...TRACE_CAPS, ...caps },
    nodes: {}, lines: {}, events: [{ kind: 'refused', reason: spec.reason, detail: JSON.parse(JSON.stringify(spec.detail ?? null)) }], stats: { events: 1, nodes: 0, lines: 0 } };
}

/** every onset (`node`, `samples`) and line id ('cl1:…') an event names, into the two sets */
function refsOf(x, nodes, lines) {
  if (Array.isArray(x)) { for (const y of x) refsOf(y, nodes, lines); return; }
  if (typeof x === 'string') { if (x.startsWith('cl1:')) lines.add(x); return; }
  if (!x || typeof x !== 'object') return;
  for (const [k, v] of Object.entries(x)) {
    if (k === 'node') { if (Number.isInteger(v)) nodes.add(v); }
    else if (k === 'samples' && Array.isArray(v)) { for (const n of v) if (Number.isInteger(n)) nodes.add(n); }
    else refsOf(v, nodes, lines);
  }
}
/**
 * STEP 4a: a trace cut back to smaller caps of `chordCandidates` and `runnersUp` (by default the show's, TRACE_CAPS):
 * each chord event's candidates and each lead event's runners-up cut to their first k (a pick past the cut gets
 * `pickIndex` −1), and the node and line tables cut to what the events still name. The result is the trace a compose
 * with those caps makes, byte for byte (assert-trace-caps.mjs). A trace already within them comes back as it is.
 */
export function capTrace(trace, caps = TRACE_CAPS) {
  if (!trace || !Array.isArray(trace.events) || !trace.caps) return trace;
  const k = Math.min(caps.chordCandidates ?? Infinity, trace.caps.chordCandidates), r = Math.min(caps.runnersUp ?? Infinity, trace.caps.runnersUp);
  if (k === trace.caps.chordCandidates && r === trace.caps.runnersUp) return trace;
  const events = trace.events.map((ev) => {
    if (ev.kind === 'chord' && ev.candidates.length > k) return { ...ev, pickIndex: ev.pickIndex < k ? ev.pickIndex : -1, candidates: ev.candidates.slice(0, k) };
    if (ev.kind === 'lead' && ev.runnersUp.length > r) return { ...ev, runnersUp: ev.runnersUp.slice(0, r) };
    return ev;
  });
  const usedNodes = new Set(), usedLines = new Set();
  refsOf(events, usedNodes, usedLines);
  const lines = {};
  for (const [id, l] of Object.entries(trace.lines)) if (usedLines.has(id)) { lines[id] = l; for (const n of l.notes) if (n.node != null) usedNodes.add(n.node); }
  const nodes = {};
  for (const [i, v] of Object.entries(trace.nodes)) if (usedNodes.has(Number(i))) nodes[i] = v;
  return { ...trace, caps: { ...trace.caps, chordCandidates: k, runnersUp: r }, nodes, lines, events,
    stats: { ...trace.stats, events: events.length, nodes: Object.keys(nodes).length, lines: Object.keys(lines).length } };
}

// ── pacing ──

/** each beat's share of the timeline at pace 1, in seconds (proposed: about 6–8 s for a whole compose) */
export const TIMELINE_SECONDS = Object.freeze({
  row: 0.35, root: 0.7, meter: 0.5, cells: 0.4, progression: 0.3, line: 0.9, chords: 0.9, line2: 0.6, settle: 0.45,
  harmony: 0.3, parts: 0.9, drums: 0.6, done: 0.15, refused: 0.5,
});
/** the beat an event belongs to */
function groupOf(ev) {
  switch (ev.kind) {
    case 'meter': case 'phase': return 'meter';
    case 'lead': return ev.stage === 'pass1' ? 'line' : ev.stage === 'pass2' ? 'line2' : 'settle';
    case 'chord': return ev.round === 0 ? 'chords' : 'settle';
    case 'part': return 'parts';
    default: return ev.kind;
  }
}
/** an event's weight inside its beat: what changed gets more time than what was kept */
function weightOf(ev) {
  if (ev.kind === 'meter') return 2;
  if (ev.kind === 'phase') return 3;
  if (ev.kind === 'settle') return 1.5;
  if (ev.kind === 'chord' && ev.round > 0) return ev.changed ? 2 : 1;
  if (ev.kind === 'lead' && ev.stage === 'settle') return ev.kept === 'mined' ? 2 : 1;
  return 1;
}
const roundOf = (ev) => (ev.kind === 'settle' || (ev.kind === 'chord' && ev.round > 0) || (ev.kind === 'lead' && ev.stage === 'settle') ? ev.round : null);
const ratioOrDash = (c) => (c ? c.ratio : '–');
/** a short caption for a step */
function labelOf(ev, trace) {
  switch (ev.kind) {
    case 'row': return `the row: ${ev.onsets} onsets, ${ev.tones} tones`;
    case 'root': { const c = ev.candidates.find((x) => x.tone === ev.pick); return `the root: ${ratioOrDash(c)}${ev.asked ? ' (asked)' : `, of ${ev.eligible} candidates`}`; }
    case 'meter': return `the meter: ${ev.bars} × ${ev.slotsPerBar} at ${ev.tempoBpm} BPM`;
    case 'phase': return `the downbeat${ev.asked ? ' (asked)' : `: ${ev.pick + 1} of ${ev.candidates.length}`}`;
    case 'cells': return `${ev.P} slots on ${ev.anchors} anchors`;
    case 'progression': return `a progression: ${ev.bars.filter((b) => !b.auto).length} bars pinned (${ev.leader})`;
    case 'lead': {
      const what = ev.stage === 'pass1' ? 'lead' : ev.stage === 'pass2' ? 'lead over the chords' : `settle ${ev.round}: lead`;
      if (ev.skipped) return `${what}, phrase ${ev.phrase + 1}: skipped (pinned)`;
      return `${what}, phrase ${ev.phrase + 1}: ${ev.tested} lines tested${ev.kept === 'held' ? ', the held line kept' : ''}`;
    }
    case 'chord': return `${ev.round > 0 ? `settle ${ev.round}: ` : ''}bar ${ev.bar + 1}: ${ev.pick.name}${ev.round > 0 && !ev.changed ? ' (unchanged)' : ''}`;
    case 'settle': return `settle ${ev.round}: ${ev.outcome === 'converged' ? 'the chords settle' : ev.outcome === 'repeats' ? `the chords repeat round ${ev.repeats}` : `${ev.changedBars.length} bar${ev.changedBars.length === 1 ? '' : 's'} changed`}`;
    case 'harmony': return `the chords: ${ev.chords.map((c) => c.name).join(' ')}`;
    case 'part': return `${ev.part}: ${ev.count} notes`;
    case 'drums': return `drums: ${ev.mode}, ${ev.count} strokes`;
    case 'done': return 'composed';
    case 'refused': return `refused: ${ev.reason}`;
    default: return ev.kind;
  }
}

/**
 * The trace as a timeline for a renderer: consecutive steps, each one or more events, grouped into beats.
 *   opts { pace (1: about 6–8 s; 2 twice as fast), seconds (fit the whole timeline to exactly this, ignoring pace),
 *          budgets ({ beat: seconds } overriding TIMELINE_SECONDS) }
 * → { version, pace, seconds, steps: [{ step, group, round, kind, label, start, duration, events: [event index] }],
 *     groups: [{ group, round, label, start, duration, steps: [first, last] }] }
 * Pure: the times are relative seconds from 0, for the renderer's own clock.
 */
export function traceTimeline(trace, { pace = 1, seconds = null, budgets = {} } = {}) {
  if (!trace || !Array.isArray(trace.events)) throw new Error('composer/trace: traceTimeline needs a trace');
  if (!(pace > 0)) throw new Error(`composer/trace: pace must be positive, not ${pace}`);
  const budget = { ...TIMELINE_SECONDS, ...budgets };
  // beats: runs of consecutive events in one group (a settle round is its own beat)
  const beats = [];
  trace.events.forEach((ev, i) => {
    const group = groupOf(ev), round = group === 'settle' ? roundOf(ev) : null, last = beats[beats.length - 1];
    if (last && last.group === group && last.round === round) last.events.push(i);
    else beats.push({ group, round, events: [i] });
  });
  const steps = [], groups = [];
  let at = 0;
  for (const b of beats) {
    const total = budget[b.group] ?? 0.3, w = b.events.map((i) => weightOf(trace.events[i])), sum = w.reduce((x, y) => x + y, 0);
    const first = steps.length, start = at;
    b.events.forEach((i, j) => {
      const ev = trace.events[i], duration = (total * w[j]) / sum;
      steps.push({ step: steps.length, group: b.group, round: b.round, kind: ev.kind, label: labelOf(ev, trace), start: at, duration, events: [i] });
      at += duration;
    });
    groups.push({ group: b.group, round: b.round, label: b.group === 'settle' ? `settle ${b.round}` : b.group, start, duration: at - start, steps: [first, steps.length - 1] });
  }
  const scale = seconds != null ? (at > 0 ? seconds / at : 0) : 1 / pace;
  const fix = (x) => Math.round(x * scale * 1e6) / 1e6;
  for (const s of steps) { s.start = fix(s.start); s.duration = fix(s.duration); }
  for (const g of groups) { g.start = fix(g.start); g.duration = fix(g.duration); }
  return { version: COMPOSER_TRACE_VERSION, pace: seconds != null ? null : pace, seconds: fix(at), steps, groups };
}
