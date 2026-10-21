// compose-worker.js — Compose in a module worker: the same pure call as compose.js, run off the main thread.
//
//   new Worker(new URL('./compose-worker.js', import.meta.url), { type: 'module' })
//   worker.postMessage({ id, layers, cycleSeconds, options })   options as compose(): { seed, overrides }
//   ← { id, ok: true, spec }  |  { id, ok: false, error }
//
// In a worker the table is the full one unless `options.overrides.table` asks otherwise (`worker: true`). A refusal
// (tooDense, tooLarge, tooFewTones) is a spec with `refused: true`, sent as ok; only a thrown error is not ok.

import { compose } from './compose.js';

/** one message's answer: the reply a worker posts (exported so a page or a test can run it without a worker) */
export function answer(data) {
  const { id = null, layers, cycleSeconds, options = {} } = data || {};
  try {
    return { id, ok: true, spec: compose(layers, cycleSeconds, { ...options, worker: true }) };
  } catch (err) {
    return { id, ok: false, error: String(err && err.message ? err.message : err) };
  }
}

const scope = typeof self !== 'undefined' ? self : null;
if (scope && typeof scope.postMessage === 'function') {
  scope.onmessage = (event) => scope.postMessage(answer(event.data));
}
