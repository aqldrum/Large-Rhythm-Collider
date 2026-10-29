// cosmos-compose.js — Cosmos's Compose mode: the state machine and its pure policies (E1, 2026-10-22 night). No DOM,
// no audio graph, no workers of its own: those are injected (flight-view.js wires them; the tests mock them).
//
//   idle ──press(rhythm)──────────────────────────► composing ──spec──► performing ──stop(reason)──► stopping ─► idle
//   idle ──press(grid)──► gathering ──bloom done──► composing                │ refused / empty ─► idle (notice)
//        any state ──press(same target) / stop(reason)──► idle (a worker in flight is cancelled; a stale reply is ignored)
//
// Avery's calls (2026-10-22): a Rhythm card composes that one rhythm; a Grid card composes a SUPERROW of the bloom's
// rhythms up to a budget (Composer/core/superrow.js), a window of a huge grid rather than a refusal, "fitted of visible"
// the barometer; the ambient bed is silenced completely while it plays and restored after; the composition takes the
// clock at its own tempo and hands it back; the player keeps flying, and it stops when the player leaves and the grid
// falls out of range; the Composer's drums as they are.
//
// Proposed here (the planner's defaults, not ruled):
//   tempo      a cycle that lands the Composer's meter on 110 BPM (superrow.js cycleSecondsForTempo), never n / rate.
//   window     inside the Grid card's cardinality band, the rhythms nearest the focus first — the clicked node of that
//              bloom, else the eye — fixed at press time; Θ by quality tier (composeBudget), Σ ≤ 2^21 source onsets.
//   gathering  a Grid Compose waits for its bloom to finish streaming (cancel: press again).
//   range      it stops past `stopAt` = the tier's evict radius − 1 cell (Low: 9 of 10), sustained STOP_DWELL_MS, and
//              fades over the FADE_CELLS before it (the hysteresis: back inside, the level comes back). Every removal
//              path (zone evicted, bloom dropped or collapsed, a tier reset, Esc, the card folded or closed, exit) stops.
//
// Hooks for E2 (`on(type, fn)` → off): 'state' { state, prev, target } · 'gathering' { target, progress } ·
// 'composing' { target, rhythms? } · 'composed' { target, spec, window?, superrow? } · 'perform' { target, spec,
// startedAt } · 'note' (the player's booking events: { kind, part, node, tick, when, cycle, … }) · 'level' { level } ·
// 'refused' { target, reason, detail } · 'stop' { target, reason, prev }.
//
// COMPOSE DUST (E2, 2026-10-22 night): `createComposeMode({ trace: true, dust: k })` asks both workers for the compose
// trace (spec.trace) and a Rhythm compose for k of its onsets sampled (spec.dust). Both are taken OFF the spec before it
// is played (the player never sees them, as the main page keeps its trace apart) and ride on 'composed' instead:
// { target, spec (plain), trace, dust, window?, superrow? }. Off (the default), the spec goes through untouched.

import { onsetCount, ONSET_GATE, MAX_LAYERS } from '../../Composer/core/row.js';
import { cycleSecondsForTempo, barometer, flattenLayers, DEFAULT_BUDGET, DEFAULT_SOURCE_BUDGET, DEFAULT_TEMPO_BPM } from '../../Composer/core/superrow.js';

export const COMPOSE_STATES = Object.freeze({ IDLE: 'idle', GATHERING: 'gathering', COMPOSING: 'composing', PERFORMING: 'performing', STOPPING: 'stopping' });
const S = COMPOSE_STATES;
export const COMPOSE_TEMPO_BPM = DEFAULT_TEMPO_BPM;
export const STOP_MARGIN_CELLS = 1;   // stop this far inside the tier's evict shell (before the zone can be evicted)
export const FADE_CELLS = 2;          // fade the composition over the cells before the stop
export const STOP_DWELL_MS = 400;     // out of range this long before it stops (an anchor hop is not a departure)
export const COMPOSE_SEED = 1;        // deterministic: the same target, the same composition (proposed)

/** the composition's range from the tier's evict radius (cells): { fadeFrom, stopAt } */
export function composeStopRange(evictRadius) {
  const stopAt = Math.max(1, evictRadius - STOP_MARGIN_CELLS);
  return { fadeFrom: Math.max(0, stopAt - FADE_CELLS), stopAt };
}
/** the level at a distance (cells) inside the range: 1 to fadeFrom, then down to 0 at stopAt */
export function rangeLevel(distance, range) {
  if (!(distance > range.fadeFrom)) return 1;
  if (distance >= range.stopAt) return 0;
  return (range.stopAt - distance) / (range.stopAt - range.fadeFrom);
}
/** the quality tier's superrow budget Θ (nodes) */
export const composeBudgetFor = (tier) => (tier && tier.composeBudget > 0 ? tier.composeBudget : DEFAULT_BUDGET);

/** can this one rhythm be composed? → { ok, onsets, reason } (cheap: from the layers alone) */
export function rhythmComposability(layers, { gate = ONSET_GATE } = {}) {
  if (!Array.isArray(layers) || !layers.length) return { ok: false, onsets: 0, reason: 'no rhythm' };
  if (layers.length > MAX_LAYERS) return { ok: false, onsets: 0, reason: `${layers.length} layers: the Composer takes at most ${MAX_LAYERS}` };
  let onsets;
  try { onsets = onsetCount(layers); } catch (err) { return { ok: false, onsets: 0, reason: String(err.message || err) }; }
  if (onsets > gate) return { ok: false, onsets, reason: `${onsets.toLocaleString('en-US')} onsets: over the Composer's ${gate.toLocaleString('en-US')}` };
  return { ok: true, onsets, reason: null };
}

/** a target's identity: 'rhythm:<grid>:<key>' or 'grid:<grid>' */
export const targetKey = (t) => (!t ? '' : t.kind === 'rhythm' ? `rhythm:${t.grid}:${t.key ?? (t.layers || []).join('.')}` : `grid:${t.grid}`);

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/**
 * A rhythm node's place in its bloom (flight-view.js's draw-loop layout, before the ease): node pi of N on a Fibonacci
 * sphere, its radius by cardinality c. lattice = { cmin, rscale, extent(d), golden } as the draw loop has them. → [x, y, z]
 */
export function latticeTarget(pi, N, c, { cmin, rscale, extent, golden = GOLDEN_ANGLE }) {
  const R = rscale * (1 + extent(c - cmin));
  const y = 1 - (pi + 0.5) / N * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), ang = pi * golden;
  return [Math.cos(ang) * rr * R, y * R, Math.sin(ang) * rr * R];
}
/** squared distances from a bloom-local `eye` to every node's lattice place (systems = [{ c }] in stream order) → Float64Array */
export function latticeDistances(systems, { eye, ...lattice }) {
  const N = systems.length, out = new Float64Array(N);
  for (let pi = 0; pi < N; pi++) {
    const p = latticeTarget(pi, N, systems[pi].c, lattice);
    out[pi] = (p[0] - eye[0]) ** 2 + (p[1] - eye[1]) ** 2 + (p[2] - eye[2]) ** 2;
  }
  return out;
}

/**
 * The Compose control's face for the card. → { visible, label, disabled, active, title }
 *   info      mode.info()  ·  here: the card's own target (or null when the card offers nothing to compose)
 */
export function composeButtonView(info, here) {
  const busy = info && info.state !== S.IDLE, mine = busy && here && targetKey(here) === targetKey(info.target);
  if (busy) {
    const label = info.state === S.GATHERING ? 'GATHERING…' : info.state === S.COMPOSING ? 'COMPOSING…' : 'STOP';
    const progress = info.progress ? ` (${info.progress.shardsDone ?? 0} of ${info.progress.shardsTotal ?? '?'} shards, ${(info.progress.rhythms ?? 0).toLocaleString('en-US')} rhythms)` : '';
    const title = info.state === S.GATHERING ? `Waiting for the bloom to finish streaming${progress}. Press to cancel.`
      : info.state === S.COMPOSING ? 'Composing in a worker. Press to cancel.'
      : `Stop the composition${mine ? '' : ` of ${info.target.kind === 'grid' ? `grid ${info.target.grid.toLocaleString('en-US')}` : 'another rhythm'}`}`;
    return { visible: true, label, disabled: false, active: info.state === S.PERFORMING, title };
  }
  if (!here) return { visible: false, label: 'COMPOSE', disabled: true, active: false, title: '' };
  if (here.kind === 'rhythm') {
    const c = rhythmComposability(here.layers);
    const notice = info?.notice && targetKey(info.notice.target) === targetKey(here) ? ` Last try: ${info.notice.text}` : '';
    return { visible: true, label: 'COMPOSE', disabled: !c.ok, active: false, title: c.ok ? `Compose this rhythm (${c.onsets.toLocaleString('en-US')} onsets)${notice}` : `Can't compose: ${c.reason}` };
  }
  return { visible: true, label: 'COMPOSE', disabled: false, active: false, title: 'Compose the bloom\'s rhythms nearest you into one tune' };
}

/**
 * createComposeMode({ composer, performer, gather, now, budget })
 *   composer   { rhythm(layers, T, options) → Promise<spec>, superrow(payload, transfer) → Promise<reply>, cancel() }
 *   performer  { perform(spec, { onNote }) → bool, stop() → bool, setLevel(x), startedAt }
 *   gather     (target) → { ready, empty?, progress?, snapshot?() → { rhythms (layer arrays), dist (Float64Array | null),
 *              keys? } } — Grid targets only, polled every frame()
 *   budget     () → Θ (the tier's composeBudget)
 */
export function createComposeMode({ composer, performer, gather = null, now = () => Date.now(), budget = () => DEFAULT_BUDGET, sourceBudget = DEFAULT_SOURCE_BUDGET, bpm = COMPOSE_TEMPO_BPM, trace = false, dust = 0 } = {}) {
  // COMPOSE DUST (E2): what the workers are asked for beyond the spec, and the spec taken apart from it
  const extras = { ...(trace ? { trace: true } : {}) };
  const apart = (spec) => {
    if (!spec || (spec.trace === undefined && spec.dust === undefined)) return { spec, trace: null, dust: null };
    const { trace: tr = null, dust: du = null, ...plain } = spec;
    return { spec: plain, trace: tr, dust: du };
  };
  let state = S.IDLE, target = null, token = 0, progress = null, notice = null, result = null, outSince = null, level = 1;
  const listeners = new Map();
  const emit = (type, payload) => { for (const fn of listeners.get(type) || []) { try { fn(payload); } catch (err) { console.warn(`[cosmos compose] '${type}' listener threw`, err); } } };
  const setState = (next) => { if (next === state) return; const prev = state; state = next; emit('state', { state, prev, target }); };

  function refuse(reason, detail = null, text = null) {
    notice = { target, reason, text: text || reason, detail };
    emit('refused', { target, reason, detail });
    target = null; progress = null; result = null;
    setState(S.IDLE);
  }
  function startPerforming(t, given, extra = {}) {
    const { spec, trace: tr, dust: du } = apart(given);   // COMPOSE DUST (E2): the trace and dust never reach the player
    result = { spec, ...extra, barometer: extra.window ? barometer(extra.window) : null };
    emit('composed', { target: t, spec, ...extra, ...(tr || du ? { trace: tr, dust: du } : {}) });
    const ok = performer.perform(spec, { onNote: (e) => emit('note', { ...e, target: t }) });
    if (!ok) { refuse('audio', null, 'the audio is not running'); return; }
    level = 1; outSince = null;
    setState(S.PERFORMING);
    emit('perform', { target: t, spec, startedAt: performer.startedAt ?? null, cycleSeconds: spec.knobs.cycleSeconds });
  }
  function onSpec(my, t, spec, extra) {
    if (my !== token) return;   // cancelled or replaced meanwhile
    if (!spec || spec.refused) { refuse(spec?.reason || 'refused', spec?.detail || null, spec ? `the Composer refused (${spec.reason})` : 'no composition'); return; }
    startPerforming(t, spec, extra);
  }
  function onFail(my, err) {
    if (my !== token || err?.cancelled) return;
    refuse('error', String(err?.message || err), `compose failed: ${err?.message || err}`);
  }
  function composeRhythm(t) {
    const c = rhythmComposability(t.layers);
    if (!c.ok) { refuse('tooDense', c, c.reason); return; }
    setState(S.COMPOSING);
    emit('composing', { target: t, onsets: c.onsets });
    const my = token, T = cycleSecondsForTempo(c.onsets, { bpm });
    composer.rhythm(t.layers, T, { seed: COMPOSE_SEED, ...extras, ...(dust > 0 ? { dust } : {}) }).then((spec) => onSpec(my, t, spec, {}), (err) => onFail(my, err));
  }
  function composeGrid(t, g) {
    const snap = g.snapshot();
    if (!snap || !snap.rhythms.length) { refuse('empty', null, 'no rhythms in view to compose'); return; }
    setState(S.COMPOSING);
    emit('composing', { target: t, rhythms: snap.rhythms.length });
    const my = token, layersFlat = flattenLayers(snap.rhythms), dist = snap.dist || null;
    const payload = { grid: t.grid, layersFlat, dist, budget: budget(), sourceBudget, bpm, options: { seed: COMPOSE_SEED, ...extras } };
    composer.superrow(payload, [layersFlat.buffer, ...(dist ? [dist.buffer] : [])]).then((reply) => {
      if (my !== token) return;
      if (reply.refused) { refuse(reply.refused.reason, reply.window, reply.window ? `nothing fits: ${barometer(reply.window).text}` : 'nothing fits'); return; }
      const superrow = reply.superrow ? { ...reply.superrow, keys: snap.keys || null, pis: snap.pis || null } : null;   // pis: E2's dust origins
      onSpec(my, t, reply.spec, { window: reply.window, superrow });
    }, (err) => onFail(my, err));
  }

  const api = {
    get state() { return state; },
    get target() { return target; },
    get active() { return state !== S.IDLE; },
    info() { return { state, target, progress, notice, barometer: result?.barometer || null, tempoBpm: result?.spec?.knobs?.tempoBpm ?? null, level }; },
    /** is the composition about grid G (any kind)? */
    concerns(grid) { return !!target && target.grid === grid; },
    on(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); return () => listeners.get(type)?.delete(fn); },
    /**
     * press(target) — start; or, pressed on the target already going, stop/cancel it (a toggle); or, on another,
     * stop that one and start this. target = { kind: 'rhythm', grid, key, layers } | { kind: 'grid', grid, focus?, band? }
     */
    press(t) {
      if (!t) return state;
      if (state !== S.IDLE && targetKey(t) === targetKey(target)) { api.stop(state === S.PERFORMING ? 'toggle' : 'cancel'); return state; }
      if (state !== S.IDLE) api.stop('replaced');
      token++; target = t; progress = null; notice = null; result = null;
      if (t.kind === 'rhythm') composeRhythm(t);
      else { setState(S.GATHERING); api.frame({}); }
      return state;
    },
    /** stop(reason) — the ONE way out: cancels a worker in flight, stops the player and hands the clock back. */
    stop(reason = 'stop') {
      if (state === S.IDLE) return false;
      const prev = state, t = target;
      token++;
      if (prev === S.COMPOSING) composer.cancel?.();
      if (prev === S.PERFORMING) { setState(S.STOPPING); performer.stop(); }
      target = null; progress = null; outSince = null; level = 1;
      setState(S.IDLE);
      emit('stop', { target: t, reason, prev });
      return true;
    },
    /** stop if the composition is about grid G (a removal path: evicted, bloom dropped or collapsed, tier reset) */
    gridGone(grid, reason = 'grid removed') { return api.concerns(grid) ? api.stop(reason) : false; },
    /**
     * frame({ distance, evictRadius, at }) — per flight frame: polls the gathering bloom, and applies the range
     * (distance in cells from the composed grid; evictRadius the tier's) while gathering, composing or performing.
     */
    frame({ distance = null, evictRadius = null, at = now() } = {}) {
      if (state === S.IDLE || state === S.STOPPING) return;
      if (distance != null && evictRadius != null) {
        const range = composeStopRange(evictRadius);
        if (distance > range.stopAt) { if (outSince == null) outSince = at; if (at - outSince >= STOP_DWELL_MS) { api.stop('out of range'); return; } }
        else outSince = null;
        if (state === S.PERFORMING) {
          const next = rangeLevel(distance, range);
          if (Math.abs(next - level) > 0.005) { level = next; performer.setLevel(level); emit('level', { level, distance }); }
        }
      }
      if (state === S.GATHERING && gather) {
        const g = gather(target);
        if (!g) return;
        const p = g.progress;
        if (p && (!progress || p.shardsDone !== progress.shardsDone || p.rhythms !== progress.rhythms || p.shardsTotal !== progress.shardsTotal)) { progress = p; emit('gathering', { target, progress }); }
        if (g.empty) { refuse('empty', null, 'this grid has no rhythms to compose'); return; }
        if (g.ready) composeGrid(target, g);
      }
    },
  };
  return api;
}
