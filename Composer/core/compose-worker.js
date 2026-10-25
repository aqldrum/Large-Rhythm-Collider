// compose-worker.js — Compose in a module worker: the same pure call as compose.js, run off the main thread.
//
//   new Worker(new URL('./compose-worker.js', import.meta.url), { type: 'module' })
//   worker.postMessage({ id, layers, cycleSeconds, options })   options as compose(): { seed, overrides, progression,
//                                                                drums, trace }
//   ← { id, ok: true, spec }  |  { id, ok: false, error }
//
// `options.trace: true` sends the compose trace back in `spec.trace` (trace.js, Composer/TRACE.md): plain JSON, so it
// survives the structured clone as it is. A page that wants it apart takes it off the spec (`const { trace, ...spec }`).
//
// In a worker the table is the full one unless `options.overrides.table` asks otherwise (`worker: true`). A refusal
// (tooDense, tooLarge, tooFewTones) is a spec with `refused: true`, sent as ok; only a thrown error is not ok.
//
// `options.dust: k` (Cosmos's onset dust, E2, 2026-10-22 night) also sends `dust`: k of the row's onsets sampled evenly
// in row order (`sampleRowDust`), so a page can draw a rhythm's onsets without building a row of up to 1,048,576 on
// its main thread. The row is built once here and handed to compose (`{ row }`, the prebuilt-row entry): the spec is
// the same as without it. `dust` is not a compose option and never reaches compose.
//
// STEP 4d: a local edit of a big row runs here too (the controller's edits past MAIN_THREAD_ONSETS, and every
// smoothPhrase; perform/composer-controller.js):
//   worker.postMessage({ id, kind: 'rearrange', key, spec, edit, opts })   rearrange.js' rearrange(spec, row, cells,
//                                                                          edit, opts), the row and cells built here
//   ← { id, ok: true, result }  |  { id, ok: false, error }
// The row and cells are kept per `key` (materialsKey(spec): the layers and the knobs the cells read), the last
// REARRANGE_ROWS of them, so a second edit of the same composition builds nothing (the 524k row: ~250 ms once).
// `edit.line` must be the line's record ({ notes }), not an id: the trace stays on the page.

import { compose } from './compose.js';
import { buildRow, isRow, ONSET_GATE } from './row.js';
import { rearrange, materialsOf, materialsKey } from './rearrange.js';

/** how many rows' materials the worker keeps for edits (proposed) */
export const REARRANGE_ROWS = 3;
const kept = new Map();
function materialsFor(spec, key) {
  let m = kept.get(key);
  if (m) { kept.delete(key); kept.set(key, m); return m; }
  m = materialsOf(spec);
  kept.set(key, m);
  while (kept.size > REARRANGE_ROWS) kept.delete(kept.keys().next().value);
  return m;
}
/** how many rows' materials are kept now (for tests) */
export const keptMaterials = () => kept.size;

/** a rearrange message's answer (STEP 4d) */
export function answerRearrange(data) {
  const { id = null, key = null, spec, edit, opts = {} } = data || {};
  try {
    const { row, cells } = materialsFor(spec, key ?? materialsKey(spec));
    return { id, ok: true, result: rearrange(spec, row, cells, edit, opts || {}) };
  } catch (err) {
    return { id, ok: false, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * k onsets of a row, evenly spaced in row order (all of them when the row has ≤ k): → { n (the row's onsets), grid,
 * index (Uint32Array: row indices), tick (Float64Array), cents (Float32Array: each onset's tone), octave (Int8Array) }
 */
export function sampleRowDust(row, k) {
  const n = row.n, S = Math.max(0, Math.min(n, Math.floor(k) || 0));
  const index = new Uint32Array(S), tick = new Float64Array(S), cents = new Float32Array(S), octave = new Int8Array(S);
  for (let j = 0; j < S; j++) {
    const i = S === n ? j : Math.floor(((j + 0.5) * n) / S);
    index[j] = i; tick[j] = row.tick[i]; cents[j] = row.toneCents[row.tone[i]]; octave[j] = row.octave[i];
  }
  return { n, grid: row.grid, index, tick, cents, octave };
}

/** one message's answer: the reply a worker posts (exported so a page or a test can run it without a worker) */
export function answer(data) {
  if (data && data.kind === 'rearrange') return answerRearrange(data);
  const { id = null, layers, cycleSeconds, options = {} } = data || {};
  try {
    const { dust = 0, ...opts } = options || {};
    if (!(dust > 0)) return { id, ok: true, spec: compose(layers, cycleSeconds, { ...opts, worker: true }) };
    const row = buildRow(layers, { gate: ONSET_GATE });
    const spec = compose(layers, cycleSeconds, { ...opts, worker: true, row });
    return { id, ok: true, spec, ...(isRow(row) && !spec.refused ? { dust: sampleRowDust(row, dust) } : {}) };
  } catch (err) {
    return { id, ok: false, error: String(err && err.message ? err.message : err) };
  }
}

const scope = typeof self !== 'undefined' ? self : null;
if (scope && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => scope.postMessage(answer(event.data));
}
