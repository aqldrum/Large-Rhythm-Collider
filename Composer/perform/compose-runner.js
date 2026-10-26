// compose-runner.js — where Compose runs, for a page: the module worker for the full table, this thread for the lean
// one (as phase 4 set it up). Shared by the lab and the main page's Composer tab (promoted from composer-lab.js,
// 2026-10-22). No DOM; it needs `Worker` only for the full table.
//
//   const runCompose = createComposeRunner();
//   runCompose(layers, cycleSeconds, { seed, overrides, worker, progression, trace, target, changes }) → Promise<spec>   (trace: true →
//     spec.trace, the compose trace, both ways; trace: { caps } passed through as it is: STEP 4a)
//     worker: true    the module worker (Composer/core/compose-worker.js), made on first use and kept
//     worker: false   compose() itself, a tick later (so the page can say "Composing…" first)
// A refusal is a spec with `refused: true`; only a thrown error (or the worker failing) rejects.
//
//   runCompose.rearrange({ key, spec, edit, opts }) → Promise<rearrange's result>   (STEP 4d) a local edit in the same
//     module worker (compose-worker.js keeps the row and cells per key); the controller sends the edits of big rows
//     and every smoothPhrase here
//
// Chord charts (Composer/CHART_ORDER.md): `changes` ([[shares] × bars]) goes through as it is, both ways.
// MIDI targets (phase B): `target` ({ clip, placement?, tonic?, maxDriftCents? }, compose.js) goes through as it is,
// both ways, so the search (target.js placeClip, inside compose) runs where Compose runs (P7). The clip travels as
// decoded (plain JSON: no bytes); the worker needs nothing new, since it hands its options to compose whole.

import { compose } from '../core/compose.js';

/**
 * createComposeRunner({ makeWorker, defer }) → runCompose
 *   makeWorker () → a Worker running compose-worker.js (the default makes it from this file's URL, as a module)
 *   defer (fn) → runs fn soon (setTimeout 0 by default)
 */
export function createComposeRunner({ makeWorker = () => new Worker(new URL('../core/compose-worker.js', import.meta.url), { type: 'module' }), defer = (fn) => setTimeout(fn, 0) } = {}) {
  let worker = null, seq = 0;
  const pending = new Map();
  function post(message, pick) {
    if (!worker) {
      worker = makeWorker();
      worker.onmessage = (event) => {
        const p = pending.get(event.data.id);
        if (!p) return;
        pending.delete(event.data.id);
        if (event.data.ok) p.resolve(p.pick(event.data)); else p.reject(new Error(event.data.error));
      };
      worker.onerror = (event) => { for (const p of pending.values()) p.reject(new Error(event.message || 'the Compose worker failed')); pending.clear(); worker = null; };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, pick }); worker.postMessage({ id, ...message }); });
  }
  const viaWorker = (layers, cycleSeconds, { seed, overrides, progression, trace, target, changes }) => post({ layers, cycleSeconds, options: { seed, overrides, progression, ...(trace ? { trace } : {}), ...(target ? { target } : {}), ...(changes ? { changes } : {}) } }, (d) => d.spec);
  const run = (layers, cycleSeconds, options = {}) => (options.worker
    ? viaWorker(layers, cycleSeconds, options)
    : new Promise((resolve, reject) => defer(() => { try { resolve(compose(layers, cycleSeconds, { seed: options.seed, overrides: options.overrides, progression: options.progression, ...(options.trace ? { trace: options.trace } : {}), ...(options.target ? { target: options.target } : {}), ...(options.changes ? { changes: options.changes } : {}) })); } catch (err) { reject(err); } })));
  /** STEP 4d: a local edit in the worker → rearrange's result */
  run.rearrange = ({ key = null, spec, edit, opts = {} }) => post({ kind: 'rearrange', key, spec, edit, opts }, (d) => d.result);
  return run;
}
