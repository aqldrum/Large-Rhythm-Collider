// trace-frames.js — the compose trace as animation frames: a pure "timeline + a time t → what to draw" mapping for the
// main page's Linear Plot (built 2026-10-22 night, sprint; proposed, not ruled). No DOM, no clock, no canvas: a frame is
// plain data — marks on onsets, polylines through onsets, rules at onsets, tinted bar bands, and the parts landed so
// far — that a painter draws over a cached base (compose-animator.js paints it on the overlay's snapshot). Cosmos's
// dust renderer can follow the same pattern: build a scene once, ask it for frames.
//
//   animationTimeline(trace)                     → traceTimeline with the page's beat budgets, fitted to 4–8 s
//   buildScene({ trace, plot, final, timeline }) → a scene, or null (no trace, a refusal, a trace of another rhythm)
//   frameAt(scene, t)                            → the frame at t seconds into the animation; t ≥ scene.end is the
//                                                  final frame: exactly `final`'s lit nodes, nothing else
//
// Every onset a frame names is a dot of the plotted rhythm: a trace `node` is found among the plot's onsets by its tick
// (plot-highlights.js' exact search), and a part's notes are `final`'s own (the tab's highlights, as they play now).
// The story, a beat at a time (Composer/TRACE.md has the events):
//   row        a scan sweeps the row
//   root       the root's candidates pulse in turn, weakest first, each on its sampled onsets, sized by presence; the
//              rejects fade and the winner holds
//   meter      bar lines sweep in; the downbeat candidates flash and the chosen downbeat bursts
//   cells      the slots tick in, each with its window under the plot
//   lead       the runners-up are drawn as faint lines through their onsets, then fade; the chosen line draws in bright
//   chords     per bar, the candidates flick through on their root onsets (and in the lane), then the pick lands and
//              its chord tones light
//   settle     changed bars flash; the held lead is tested against a newly mined one, and re-drawn when it loses
//   parts      each part's notes cascade in, in its colour
//   drums      strokes drop in, bar by bar

import { traceTimeline, capTrace, TRACE_CAPS } from '../core/trace.js';
import { classOfCents } from '../core/frame.js';
import { indexOfTick, PART_COLORS, PART_LABELS } from './plot-highlights.js';

export const TRACE_FRAMES_VERSION = 'composer-trace-frames-v1';
/** the page's beat budgets at pace 1, seconds (proposed: chords and settle longer than traceTimeline's defaults, so a
 *  bar's flicks read; the row and cells shorter) */
export const ANIMATION_BUDGETS = Object.freeze({
  row: 0.3, root: 0.8, meter: 0.6, cells: 0.4, progression: 0.4, line: 0.9, chords: 1.1, line2: 0.6, settle: 0.55,
  harmony: 0.35, parts: 0.9, drums: 0.7, done: 0.25,
});
/** the whole animation is fitted into this range, seconds (the brief: brisk, about 4–8 s) */
export const ANIMATION_LIMITS = Object.freeze([4, 7.5]);
/** colours beyond the parts' own (proposed): the root and selections in the window's accent, the candidates pale, a
 *  change in the window's amber */
export const ANIM_COLORS = Object.freeze({ root: '#00ff88', candidate: '#dfe6e9', reject: '#7f8c8d', changed: '#ffb347', rule: '#ffffff', ...PART_COLORS });
/** the shortest a chord candidate shows during a flick, seconds */
export const FLICK_SECONDS = 0.035;
/** at most this many "just landed" pops a frame */
export const MAX_POPS = 24;

const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const ease = (x) => 1 - (1 - clamp01(x)) ** 3;
const pulse = (x) => Math.sin(Math.PI * clamp01(x));
const mod = (v, n) => ((v % n) + n) % n;

/** traceTimeline with the page's budgets, fitted to ANIMATION_LIMITS */
export function animationTimeline(trace, { budgets = {}, limits = ANIMATION_LIMITS } = {}) {
  const b = { ...ANIMATION_BUDGETS, ...budgets }, tl = traceTimeline(trace, { budgets: b });
  if (tl.seconds > limits[1]) return traceTimeline(trace, { budgets: b, seconds: limits[1] });
  if (tl.seconds < limits[0]) return traceTimeline(trace, { budgets: b, seconds: limits[0] });
  return tl;
}

/** the short version (sprint 2, step 2; proposed): a recall, or a later compose of a rhythm whose full show was seen,
 *  replays only the root → the lead → the parts landing (and the drums), in about 1.5 s at pace 1. Every other beat
 *  gets no time: its steps are zero-length, so a frame never stops on one (what they leave behind still persists). */
export const RECALL_SECONDS = 1.5;
export const RECALL_BUDGETS = Object.freeze({
  row: 0, root: 0.4, meter: 0, cells: 0, progression: 0, line: 0.5, chords: 0, line2: 0, settle: 0,
  harmony: 0, parts: 0.45, drums: 0.15, done: 0, refused: 0,
});
/** the short version's timeline → null when the trace has none of its beats (nothing to show: land at once) */
export function recallTimeline(trace, { seconds = RECALL_SECONDS } = {}) {
  if (!trace || !Array.isArray(trace.events)) return null;
  const tl = traceTimeline(trace, { budgets: RECALL_BUDGETS, seconds });
  return tl.seconds > 0 ? tl : null;
}

/** is this trace of the plotted rhythm, and not a refusal? */
export const traceMatchesPlot = (trace, plot) => !!(trace && plot && Array.isArray(trace.events) && trace.grid === plot.grid && trace.onsets === plot.n
  && !trace.events.some((e) => e.kind === 'refused'));

/**
 * A scene: the trace read once against the plot.
 *   trace     spec.trace (Composer/TRACE.md); plot: plotOf(...) of the plotted rhythm
 *   final     the tab's highlights (plot-highlights.js highlightsOf: the parts and drums as they play now) — where the
 *             animation lands
 *   timeline  animationTimeline(trace) by default
 * → null when there is nothing to animate, else { trace, plot, final, timeline, end, steps, missed, ... }
 */
export function buildScene({ trace: given, plot, final, timeline = null } = {}) {
  if (!traceMatchesPlot(given, plot) || !final) return null;
  // STEP 4a: the store keeps a trace with longer lists (ALTERNATE_CAPS, for the alternates); the show reads it cut back
  // to the show's own caps (6 chord candidates, 3 runners-up), so it plays exactly as before
  const trace = capTrace(given, TRACE_CAPS);
  const tl = timeline || animationTimeline(trace), ev = trace.events;
  // trace nodes → plot indices, by tick
  const at = new Map();
  let missed = 0;
  for (const [k, v] of Object.entries(trace.nodes)) { const i = indexOfTick(plot.ticks, v.tick); if (i < 0) missed++; at.set(Number(k), i); }
  const idx = (node) => (node == null ? -1 : at.get(node) ?? -1);
  const ok = (i) => i >= 0;
  const lineIdx = (id) => (id && trace.lines[id] ? trace.lines[id].notes.map((n) => idx(n.node)).filter(ok) : []);

  // the geometry: slots, bar lines, bar bands, slot windows
  const root = ev.find((e) => e.kind === 'root'), meter = ev.find((e) => e.kind === 'meter'), phase = ev.find((e) => e.kind === 'phase'), cells = ev.find((e) => e.kind === 'cells');
  const S = cells ? cells.slotsPerBar : 1, bars = cells ? cells.bars : meter ? meter.bars : 1, grid = plot.grid, n = plot.n;
  const slots = cells ? cells.slots : [];
  const slotIdx = slots.map((s) => idx(s.node));
  const barLines = Array.from({ length: bars }, (_, k) => { for (let s = k * S; s < (k + 1) * S && s < slots.length; s++) if (ok(slotIdx[s])) return slotIdx[s]; return -1; });
  const bandsOf = (k) => {
    const from = barLines[k];
    if (!ok(from)) return [];
    let j = (k + 1) % bars; while (j !== k && !ok(barLines[j])) j = (j + 1) % bars;
    const next = j === k ? from : barLines[j];
    if (next > from) return [{ from, to: next - 1 }];
    return [{ from, to: n - 1 }, ...(next > 0 ? [{ from: 0, to: next - 1 }] : [])];
  };
  const firstAtOrAfter = (tick) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (plot.ticks[m] < tick) lo = m + 1; else hi = m; } return lo; };
  const windows = slots.map((s) => {
    const a = s.tick - s.reach[0], b = s.tick + s.reach[1], lo = firstAtOrAfter(mod(a, grid)), hiEx = firstAtOrAfter(mod(b, grid) + 1e-9);
    const wraps = a < 0 || b >= grid;
    if (!wraps) return hiEx > lo ? [{ from: lo, to: hiEx - 1 }] : [];
    return [...(lo < n ? [{ from: lo, to: n - 1 }] : []), ...(hiEx > 0 ? [{ from: 0, to: hiEx - 1 }] : [])];
  });
  // the bar a trace node falls in (by its tick, from bar 1's window), for a chord's tones
  const base = slots.length ? slots[0].tick - slots[0].reach[0] : 0;
  const barStartRel = Array.from({ length: bars }, (_, k) => (slots[k * S] ? mod(slots[k * S].tick - slots[k * S].reach[0] - base, grid) : Infinity));
  const nodesByBar = Array.from({ length: bars }, () => []);
  for (const [k, v] of Object.entries(trace.nodes)) {
    const i = at.get(Number(k)); if (!ok(i)) continue;
    const rel = mod(v.tick - base, grid);
    let b = 0; for (let j = 0; j < bars; j++) if (barStartRel[j] <= rel) b = j;
    nodesByBar[b].push({ index: i, cents: v.cents });
  }
  const e = root ? root.frameCentsEachSide : 15;
  const toneIdx = (bar, pick) => {
    if (!pick || !nodesByBar[bar]) return [];
    const seen = new Set();
    for (const x of nodesByBar[bar]) { const c = classOfCents(x.cents - pick.root.cents); if (Math.abs(c.dev) <= e + 1e-9 && pick.intervals.includes(c.pc)) seen.add(x.index); }
    return [...seen];
  };
  // a drum stroke's bar, by time (bar starts at their anchors)
  const T = trace.cycleSeconds, phaseX = trace.phase ? trace.phase[0] / trace.phase[1] : 0;
  const barStartT = Array.from({ length: bars }, (_, k) => (slots[k * S] ? mod(slots[k * S].tick / grid - phaseX, 1) * T : (k * T) / bars));
  barStartT[0] = 0;
  const barOfTime = (t) => { let b = 0; for (let j = 0; j < bars; j++) if (barStartT[j] <= t + 1e-9) b = j; return b; };

  // walk the steps once: what each step shows, and what persists into it from the steps before
  const state = { rootHeld: null, barsOn: false, leads: {}, picks: {}, landed: {} };
  const snap = () => ({ rootHeld: state.rootHeld, barsOn: state.barsOn, leads: { ...state.leads }, picks: { ...state.picks }, landed: { ...state.landed } });
  const steps = tl.steps.map((s) => {
    const event = ev[s.events[0]], pre = snap(), data = {};
    switch (event.kind) {
      case 'root': {
        const pickAt = event.candidates.findIndex((c) => c.tone === event.pick);
        const order = event.candidates.map((c, j) => j).filter((j) => j !== pickAt).reverse();
        if (pickAt >= 0) order.push(pickAt);
        const maxP = Math.max(1, ...event.candidates.map((c) => c.presence ?? c.onsets ?? 1));
        data.cands = order.map((j) => { const c = event.candidates[j]; return { ratio: c.ratio, presence: c.presence ?? c.onsets, strength: (c.presence ?? c.onsets ?? 0) / maxP, samples: c.samples.map(idx).filter(ok), pick: j === pickAt, node: idx(c.node) }; });
        const win = data.cands[data.cands.length - 1];
        state.rootHeld = win && win.pick ? win.samples : null;
        break;
      }
      case 'meter': state.barsOn = true; break;
      case 'phase': data.cands = event.candidates.map((c) => idx(c.node)); data.pickIdx = idx(event.node); data.pick = event.pick; break;
      case 'cells': data.slots = slotIdx; data.windows = windows; break;
      case 'progression': data.pinned = event.bars.filter((b) => !b.auto).map((b) => ({ bar: b.bar, index: idx(b.node) })); break;
      case 'lead': {
        data.phrase = event.phrase; data.skipped = !!event.skipped; data.stage = event.stage;
        data.from = event.from; data.bars = event.bars;
        data.mined = event.mined ? lineIdx(event.mined.id) : [];
        data.runners = event.runnersUp.map((r) => lineIdx(r.id));
        data.held = event.held ? lineIdx(event.held.id) : (pre.leads[event.phrase] ? lineIdx(pre.leads[event.phrase]) : []);
        data.kept = event.kept;
        data.detail = event.skipped ? 'every bar pinned: skipped'
          : event.stage === 'pass1' ? `${event.tested} lines tested · the best costs ${event.mined?.perNote ?? '–'} a note${event.runnersUp[0] ? ` (next ${event.runnersUp[0].perNote})` : ''}`
          : `the held line ${event.held ? (event.held.fits ? `costs ${event.held.perNote}` : 'breaks a rule here') : '–'} vs a new one at ${event.mined?.perNote ?? '–'} → ${event.kept === 'held' ? 'the held line stays' : 'the new line wins'}`;
        if (!event.skipped && event.keptId) state.leads[event.phrase] = event.keptId;
        state.rootHeld = null;
        break;
      }
      case 'chord': {
        const live = event.round === 0 || event.changed !== false;
        data.bar = event.bar; data.round = event.round; data.changed = event.round > 0 ? !!event.changed : true; data.pinned = !!event.pinned;
        data.cands = live ? event.candidates.map((c) => ({ index: idx(c.root.node), label: c.label })).filter((c) => ok(c.index)) : [];
        data.flicks = data.cands.length ? Math.max(1, Math.min(event.tested || data.cands.length, Math.floor((s.duration * 0.6) / FLICK_SECONDS))) : 0;
        data.pick = { index: idx(event.pick.root.node), name: event.pick.name, tones: toneIdx(event.bar, event.pick) };
        data.bands = bandsOf(event.bar);
        data.detail = event.empty ? 'no tone in its windows: the neighbour\'s chord'
          : `${event.tested} chords tested → ${event.pick.name}: holds ${event.pick.held} lead note${event.pick.held === 1 ? '' : 's'}, ${event.pick.violations} off${event.retune ? ` · retunes ${event.retune.cents > 0 ? '+' : ''}${event.retune.cents}¢` : ''}`;
        state.picks[event.bar] = { index: data.pick.index, tones: data.pick.tones, name: event.pick.name };
        break;
      }
      case 'settle':
        data.outcome = event.outcome; data.changedBars = event.changedBars || [];
        data.bands = (event.outcome === 'changed' ? data.changedBars : Array.from({ length: bars }, (_, k) => k)).flatMap(bandsOf);
        break;
      case 'part': {
        const h = final.parts[event.part];
        data.part = event.part; data.notes = h ? h.notes : [];
        data.detail = event.part === 'comp' ? `on layer ${event.layer} (${event.value}), the best of ${event.candidates.length} layers` : event.part === 'bass' ? `mined bar by bar from the root`
          : event.part === 'inner' ? 'in the lead\'s gaps' : event.part === 'chords' ? 'a voice a chord tone' : `the kept line${(event.phrases || []).length === 1 ? '' : 's'}`;
        if (h) state.landed[event.part] = true;
        if (event.part === 'lead') state.leads = {};
        if (event.part === 'chords') state.picks = {};
        break;
      }
      case 'drums': {
        const h = final.parts.drums;
        data.notes = h ? h.notes.map((x) => ({ ...x, bar: barOfTime(x.time) })) : [];
        data.mode = event.mode;
        if (h) state.landed.drums = true;
        break;
      }
      case 'done': state.barsOn = false; break;
      default: break;
    }
    return { ...s, event, pre, data };
  });
  return { version: TRACE_FRAMES_VERSION, trace, plot, final, timeline: tl, end: tl.seconds, steps, missed, bars, barLines, bandsOf, n };
}

/** the step at t (the last one starting at or before it) */
function stepAt(steps, t) {
  let lo = 0, hi = steps.length - 1, at = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m].start <= t) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}
const blank = (scene) => ({ marks: [], paths: [], rules: [], spans: [], bands: [], sweep: null, parts: {}, lanes: { show: {}, chords: Array.from({ length: scene.bars }, () => null), hot: null, flash: [] } });

/** the final frame: exactly the final highlights, nothing else */
export function finalFrame(scene) {
  const f = blank(scene);
  for (const [id, h] of Object.entries(scene.final.parts)) { f.parts[id] = h.indices; f.lanes.show[id] = 'shown'; }
  return { ...f, t: scene.end, end: scene.end, u: 1, step: scene.steps.length, group: 'done', groupIndex: scene.timeline.groups.length - 1, kind: 'done', label: 'composed', detail: '', done: true };
}

/**
 * The frame at t seconds. → { t, end, u (0..1 into its step), step, group, groupIndex, kind, label, detail, done,
 *   marks: [{ index, color, alpha, size (× the dot radius), shape: 'dot' | 'ring' | 'square', dy (px) }],
 *   paths: [{ indices, color, alpha, width }], rules: [{ index, color, alpha, width }],
 *   spans: [{ from, to, color, alpha }] (a bracket under the plot), bands: [{ from, to, color, alpha }] (a bar tint),
 *   sweep: { index, color, alpha, width } | null (the row's scan line, at a plotted onset's x),
 *   parts: { [id]: indices } (landed: drawn as the final highlights draw them),
 *   lanes: { show: { [id]: 'shown' | 'labels' }, chords: [name | null a bar], hot: bar | null, flash: [bar] } }
 */
export function frameAt(scene, t) {
  if (!(t < scene.end)) return finalFrame(scene);
  const C = ANIM_COLORS, k = stepAt(scene.steps, Math.max(0, t)), s = scene.steps[k], { event, pre, data } = s;
  const u = s.duration > 0 ? clamp01((t - s.start) / s.duration) : 1, f = blank(scene);
  const mark = (index, color, alpha, size = 1, shape = 'dot', dy = 0) => { if (index >= 0 && alpha > 0.005) f.marks.push({ index, color, alpha: Math.min(1, alpha), size, shape, dy }); };
  const path = (indices, color, alpha, width = 1.5) => { if (indices.length > 1 && alpha > 0.005) f.paths.push({ indices, color, alpha: Math.min(1, alpha), width }); };
  const line = (indices, color, alpha, width, dotSize = 1) => { path(indices, color, alpha, width); for (const i of indices) mark(i, color, alpha, dotSize); };
  const band = (b, color, alpha) => { if (alpha > 0.005) f.bands.push({ ...b, color, alpha: Math.min(1, alpha) }); };
  const kind = event.kind;
  const groupIndex = scene.timeline.groups.findIndex((g) => g.steps[0] <= k && k <= g.steps[1]);

  // ── what persists from the steps before ──
  for (const [id] of Object.entries(pre.landed)) if (scene.final.parts[id]) { f.parts[id] = scene.final.parts[id].indices; f.lanes.show[id] = 'shown'; }
  if (pre.barsOn) {
    const a = kind === 'done' ? 0.35 * (1 - u) : 0.35;
    scene.barLines.forEach((i, b) => { if (i >= 0) f.rules.push({ index: i, color: C.rule, alpha: b === 0 ? Math.min(1, a * 1.8) : a, width: b === 0 ? 1.5 : 1 }); });
  }
  if (pre.rootHeld) { const a = kind === 'lead' ? 0.5 * (1 - u) : 0.5; for (const i of pre.rootHeld) mark(i, C.root, a, 1.1); }
  const leadFade = kind === 'part' && data.part === 'lead' ? 1 - ease(u) : 1;
  for (const [ph, id] of Object.entries(pre.leads)) {
    if (kind === 'lead' && data.phrase === Number(ph)) continue;   // the step draws it itself
    line(leadPath(scene, id), C.lead, 0.75 * leadFade, 1.5, 0.9);
  }
  const chordFade = kind === 'part' && data.part === 'chords' ? 1 - ease(u) : 1;
  for (const [b, p] of Object.entries(pre.picks)) {
    f.lanes.chords[b] = p.name;
    if (kind === 'chord' && data.bar === Number(b)) continue;
    const hot = kind === 'harmony' ? 0.35 * pulse(u) : 0;
    mark(p.index, C.chords, (0.65 + hot) * chordFade, 1.6, 'ring');
    for (const i of p.tones) mark(i, C.chords, (0.4 + hot) * chordFade, 0.75);
  }
  if (Object.keys(pre.picks).length && !f.lanes.show.chords) f.lanes.show.chords = 'labels';

  // ── this step ──
  let detail = data.detail || '';
  switch (kind) {
    case 'row': {
      f.sweep = { index: Math.min(scene.n - 1, Math.floor(ease(u) * scene.n)), color: C.root, alpha: 0.9 * (1 - u * 0.5), width: 2 };
      detail = `${event.layers.map((l) => `${l.layer} ${l.value}`).join(' · ')}`;
      break;
    }
    case 'root': {
      const m = data.cands.length, A = 0.75;
      if (!m) break;
      if (u < A) {
        const pos = (u / A) * m, cur = Math.min(m - 1, Math.floor(pos)), v = pos - cur;
        for (let j = 0; j < cur; j++) if (!data.cands[j].pick) for (const i of data.cands[j].samples) mark(i, C.reject, 0.3, 0.7);
        const c = data.cands[cur];
        for (const i of c.samples) mark(i, C.candidate, 0.45 + 0.55 * pulse(v), 0.8 + 1.1 * c.strength * pulse(v));
        detail = `candidate ${cur + 1} of ${m}: ${c.ratio} · heard ${c.presence}× in its ±${event.frameCentsEachSide}¢ frame`;
      } else {
        const w = (u - A) / (1 - A), win = data.cands[m - 1];
        for (let j = 0; j < m - 1; j++) for (const i of data.cands[j].samples) mark(i, C.reject, 0.3 * (1 - w), 0.7);
        for (const i of win.samples) mark(i, C.root, 1, 1.3);
        if (win.samples.length) mark(win.samples[0], C.root, 1 - w, 1.5 + 3 * w, 'ring');
        detail = `${win.ratio} wins: heard ${win.presence}×${event.asked ? ' (asked)' : ''}`;
      }
      break;
    }
    case 'meter': {
      scene.barLines.forEach((i, b) => {
        const a = clamp01(u * scene.bars * 1.2 - b);
        if (i >= 0 && a > 0) f.rules.push({ index: i, color: C.rule, alpha: 0.35 + 0.6 * pulse(a) , width: b === 0 ? 1.5 : 1 });
      });
      detail = `${event.bars} bar${event.bars === 1 ? '' : 's'} × ${event.slotsPerBar} slots at ${event.tempoBpm} BPM, ${event.onsetsPerSlot} onsets a slot`;
      break;
    }
    case 'phase': {
      const m = data.cands.length;
      if (m && u < 0.6) {
        const cur = Math.min(m - 1, Math.floor((u / 0.6) * m)), v = (u / 0.6) * m - cur;
        data.cands.forEach((i, j) => { if (j < cur) mark(i, C.candidate, 0.35, 1.2, 'ring'); });
        mark(data.cands[cur], C.candidate, 0.5 + 0.5 * pulse(v), 1.4 + pulse(v), 'ring');
        mark(data.cands[cur], C.candidate, 0.9, 1.1);
        detail = `downbeat candidate ${cur + 1} of ${m}: the root's ${['first', 'second', 'third'][cur] ?? `#${cur + 1}`} onset`;
      } else {
        const w = m ? (u - 0.6) / 0.4 : u;
        mark(data.pickIdx, C.root, 1, 1.6);
        mark(data.pickIdx, C.root, 1 - w, 1.6 + 4 * ease(w), 'ring');
        detail = event.asked ? 'the downbeat (asked)' : `bar 1 starts on candidate ${data.pick + 1}`;
      }
      break;
    }
    case 'cells': {
      const P = data.slots.length, fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
      for (let j = 0; j < P; j++) {
        const a = clamp01(u * 1.4 * P - j);
        if (a <= 0) break;
        if (data.slots[j] >= 0) f.rules.push({ index: data.slots[j], color: C.candidate, alpha: 0.3 * fade, width: 1 });
        for (const w of data.windows[j]) f.spans.push({ ...w, color: j % 2 ? C.candidate : C.root, alpha: 0.6 * fade });
      }
      detail = `${event.P} slots on ${event.anchors} anchors, each a window of about ${Math.round(event.slots.reduce((x, y) => x + y.onsets, 0) / Math.max(1, P))} onsets`;
      break;
    }
    case 'progression': for (const p of data.pinned) { mark(p.index, C.root, 1, 1.4); mark(p.index, C.root, 1 - u, 1.4 + 3 * u, 'ring'); } break;
    case 'lead': {
      if (data.skipped) { for (let b = data.from; b < data.from + data.bars; b++) for (const x of scene.bandsOf(b)) band(x, C.root, 0.12 * pulse(u)); break; }
      const R = data.runners.length;
      if (data.stage === 'pass1') {
        data.runners.forEach((r, j) => {
          const a = u < 0.4 ? clamp01((u - (j * 0.4) / Math.max(1, R)) * 8) : clamp01(1 - (u - 0.4) / 0.2);
          line(r, C.candidate, 0.35 * a, 1, 0.7);
        });
        const L = data.mined.length, shown = Math.ceil(L * ease((u - 0.35) / 0.6));
        if (shown > 0) {
          const part = data.mined.slice(0, shown);
          line(part, C.lead, 0.95, 2, 1.1);
          mark(part[part.length - 1], C.lead, 1 - clamp01((u - 0.35) / 0.65) * 0.5, 1.9, 'ring');
        }
      } else {
        const verdict = u >= 0.5, w = verdict ? (u - 0.5) / 0.5 : 0;
        const test = verdict ? 1 - clamp01(w * 2) : clamp01(u * 4);
        data.runners.forEach((r) => line(r, C.candidate, 0.25 * test, 1, 0.6));
        if (data.kept === 'held') {
          line(data.mined, C.candidate, 0.4 * test, 1.2, 0.7);
          line(data.held, verdict ? C.lead : C.root, verdict ? 0.9 + 0.1 * pulse(w) : 0.55 + 0.4 * pulse(u * 4), verdict ? 2 + pulse(w) : 1.5, 1);
        } else {
          line(data.held, verdict ? C.changed : C.root, verdict ? 0.9 * (1 - w) : 0.55 + 0.4 * pulse(u * 4), 1.5, 0.9);
          const L = data.mined.length, shown = verdict ? Math.ceil(L * ease(w / 0.8)) : 0;
          if (!verdict) line(data.mined, C.candidate, 0.4 * test, 1.2, 0.7);
          if (shown > 0) line(data.mined.slice(0, shown), C.lead, 0.95, 2, 1.1);
        }
      }
      break;
    }
    case 'chord': {
      const colour = data.pinned ? C.root : data.round > 0 && data.changed ? C.changed : C.chords;
      for (const b of data.bands) band(b, colour, 0.12 + 0.08 * pulse(u));
      f.lanes.hot = data.bar;
      const flickEnd = data.flicks ? 0.6 : 0;
      if (u < flickEnd) {
        // the weakest first, building to the best (the pick lands after)
        const j = Math.min(data.flicks - 1, Math.floor((u / flickEnd) * data.flicks)), m = data.cands.length, c = data.cands[m - 1 - (j % m)];
        mark(c.index, C.chords, 0.9, 1.5);
        mark(c.index, C.candidate, 0.7, 2.1, 'ring');
        f.lanes.chords[data.bar] = c.label;
        detail = `bar ${data.bar + 1}: testing ${c.label}`;
      } else {
        const w = flickEnd ? (u - flickEnd) / (1 - flickEnd) : u;
        mark(data.pick.index, C.chords, 1, 1.4);
        mark(data.pick.index, C.chords, data.changed ? 1 - 0.5 * w : 0.6, data.changed ? 1.6 + 2.4 * ease(w) : 1.6, 'ring');
        data.pick.tones.forEach((i, j) => { const a = clamp01(w * 3 - (j / Math.max(1, data.pick.tones.length))); mark(i, C.chords, 0.85 * a, 0.9); });
        f.lanes.chords[data.bar] = data.pick.name;
        if (data.round > 0 && !data.changed) detail = `bar ${data.bar + 1}: ${data.pick.name}, unchanged`;
      }
      break;
    }
    case 'settle': {
      const colour = data.outcome === 'converged' ? C.root : C.changed;
      for (const b of data.bands) band(b, colour, (data.outcome === 'converged' ? 0.14 : 0.3) * Math.abs(Math.sin(2 * Math.PI * u)));   // two flashes
      f.lanes.flash = data.outcome === 'converged' ? [] : data.outcome === 'changed' ? data.changedBars : Array.from({ length: scene.bars }, (_, b) => b);
      detail = data.outcome === 'changed' ? `bar${data.changedBars.length === 1 ? '' : 's'} ${data.changedBars.map((b) => b + 1).join(', ')} moved: the lead is tested again`
        : data.outcome === 'converged' ? 'nothing moved: the chords hold' : 'the chords repeat an earlier round: the best round is kept';
      break;
    }
    case 'harmony': detail = event.chords.map((c) => c.name).join(' · '); break;
    case 'part': {
      const N = data.notes.length, shown = Math.ceil(N * ease(u / 0.85)), h = scene.final.parts[data.part];
      if (!h) break;
      const seen = new Set();
      for (let j = 0; j < shown; j++) seen.add(data.notes[j].index);
      f.parts[data.part] = [...seen];
      f.lanes.show[data.part] = 'shown';
      const pops = Math.max(1, Math.min(MAX_POPS, Math.ceil(N * 0.15)));
      for (let j = Math.max(0, shown - pops); j < shown && u < 1; j++) { const age = (shown - j) / pops; mark(data.notes[j].index, h.color, (1 - age) * 0.9, 1 + 1.4 * (1 - age), 'ring'); }
      detail = `${PART_LABELS[data.part]}: ${N} note${N === 1 ? '' : 's'}, ${data.detail}`;
      break;
    }
    case 'drums': {
      const h = scene.final.parts.drums;
      if (!h) break;
      f.lanes.show.drums = 'shown';
      const B = scene.bars, seen = new Set();
      let cur = 0;
      for (const x of data.notes) {
        const v = clamp01((u - (0.8 * x.bar) / B) / 0.2);
        if (v >= 1) seen.add(x.index);
        else if (v > 0) { mark(x.index, h.color, 0.4 + 0.6 * v, 1, 'square', -(1 - ease(v)) * 28); cur = Math.max(cur, x.bar); }
      }
      f.parts.drums = [...seen];
      detail = `${data.mode}: ${data.notes.length} strokes, bar ${Math.min(B, Math.floor(u * B / 0.8) + 1)} of ${B}`;
      break;
    }
    default: break;
  }
  return { ...f, t, end: scene.end, u, step: k, group: s.group, groupIndex, kind, label: s.label, detail, done: false };
}

const pathCache = new WeakMap();
/** a line's notes as plot indices (cached a scene) */
function leadPath(scene, id) {
  let m = pathCache.get(scene);
  if (!m) pathCache.set(scene, (m = new Map()));
  if (!m.has(id)) {
    const l = scene.trace.lines[id];
    m.set(id, l ? l.notes.map((x) => (x.node == null ? -1 : indexOfTick(scene.plot.ticks, scene.trace.nodes[x.node].tick))).filter((i) => i >= 0) : []);
  }
  return m.get(id);
}

/** every onset index a frame draws on (marks, paths, rules, landed parts), for checks */
export function frameIndices(frame) {
  const out = [];
  for (const m of frame.marks) out.push(m.index);
  for (const p of frame.paths) out.push(...p.indices);
  for (const r of frame.rules) out.push(r.index);
  for (const ix of Object.values(frame.parts)) out.push(...ix);
  return out;
}
