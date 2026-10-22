// superrow-worker.js — a grid's superrow built and composed in a module worker (superrow.js + compose.js), so neither
// the build (≈ 0.3 µs a source onset) nor the compose ever stalls a frame. Cosmos's Grid-card Compose posts here.
//
//   new Worker(new URL('./superrow-worker.js', import.meta.url), { type: 'module' })
//   worker.postMessage({ id, grid, layersFlat (Uint32Array, 4 a rhythm, 0 = absent), dist (Float64Array | null: the
//                        near-focus order's distances, one a rhythm), budget, sourceBudget, bpm, options })
//   ← { id, ok: true, spec, window, superrow }  |  { id, ok: true, refused: { reason: 'empty' }, window }  |  { id, ok: false, error }
//     superrow = { grid, n, tick (Float64Array), tone (Uint32Array), tones, layers, sources: { start, rhythm, onset } }
//     (typed arrays transferred). `rhythm` indexes the rhythms as posted; spec notes' `node` indexes tick/tone.
//
// options are compose()'s ({ seed, overrides, drums, … }); the table is the full one (worker: true) unless asked.

import { buildSuperrow, orderByDistance, cycleSecondsForTempo, unflattenLayers } from './superrow.js';
import { compose } from './compose.js';

/** one message's answer → { message, transfer } (exported so a page or a test can run it without a worker) */
export function answerSuperrow(data) {
  const { id = null, grid = null, layersFlat, rhythms: given, dist = null, budget, sourceBudget, bpm, options = {} } = data || {};
  try {
    const rhythms = given ?? unflattenLayers(layersFlat);
    const order = orderByDistance(dist, rhythms.length);
    const built = buildSuperrow(rhythms, { grid, order, ...(budget ? { budget } : {}), ...(sourceBudget ? { sourceBudget } : {}) });
    if (!built.row) return { message: { id, ok: true, refused: { reason: 'empty' }, window: built.window }, transfer: [] };
    const row = built.row, cycleSeconds = cycleSecondsForTempo(row.n, bpm ? { bpm } : {});
    const spec = compose(row.layers, cycleSeconds, { ...options, worker: true, row });
    const superrow = { grid: row.grid, n: row.n, tick: row.tick, tone: row.tone, tones: row.tones, layers: row.layers, sources: built.sources };
    const transfer = [row.tick.buffer, row.tone.buffer, ...(built.sources ? [built.sources.start.buffer, built.sources.rhythm.buffer, built.sources.onset.buffer] : [])];
    return { message: { id, ok: true, spec, window: built.window, superrow }, transfer };
  } catch (err) {
    return { message: { id, ok: false, error: String(err && err.message ? err.message : err) }, transfer: [] };
  }
}

const scope = typeof self !== 'undefined' ? self : null;
// only inside a worker (never a page that imports this module for answerSuperrow)
if (scope && typeof WorkerGlobalScope !== 'undefined' && scope instanceof WorkerGlobalScope) {
  scope.onmessage = (event) => { const { message, transfer } = answerSuperrow(event.data); scope.postMessage(message, transfer); };
}
