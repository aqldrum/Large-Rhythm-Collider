// compose-runner.js — where Compose runs, for a page: the module worker for the full table, this thread for the lean
// one (as phase 4 set it up). Shared by the lab and the main page's Composer tab (promoted from composer-lab.js,
// 2026-10-22). No DOM; it needs `Worker` only for the full table.
//
//   const runCompose = createComposeRunner();
//   runCompose(layers, cycleSeconds, { seed, overrides, worker, progression }) → Promise<spec>
//     worker: true    the module worker (Composer/core/compose-worker.js), made on first use and kept
//     worker: false   compose() itself, a tick later (so the page can say "Composing…" first)
// A refusal is a spec with `refused: true`; only a thrown error (or the worker failing) rejects.

import { compose } from '../core/compose.js';

/**
 * createComposeRunner({ makeWorker, defer }) → runCompose
 *   makeWorker () → a Worker running compose-worker.js (the default makes it from this file's URL, as a module)
 *   defer (fn) → runs fn soon (setTimeout 0 by default)
 */
export function createComposeRunner({ makeWorker = () => new Worker(new URL('../core/compose-worker.js', import.meta.url), { type: 'module' }), defer = (fn) => setTimeout(fn, 0) } = {}) {
  let worker = null, seq = 0;
  const pending = new Map();
  function viaWorker(layers, cycleSeconds, { seed, overrides, progression }) {
    if (!worker) {
      worker = makeWorker();
      worker.onmessage = (event) => {
        const p = pending.get(event.data.id);
        if (!p) return;
        pending.delete(event.data.id);
        if (event.data.ok) p.resolve(event.data.spec); else p.reject(new Error(event.data.error));
      };
      worker.onerror = (event) => { for (const p of pending.values()) p.reject(new Error(event.message || 'the Compose worker failed')); pending.clear(); worker = null; };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, layers, cycleSeconds, options: { seed, overrides, progression } }); });
  }
  return (layers, cycleSeconds, options = {}) => (options.worker
    ? viaWorker(layers, cycleSeconds, options)
    : new Promise((resolve, reject) => defer(() => { try { resolve(compose(layers, cycleSeconds, { seed: options.seed, overrides: options.overrides, progression: options.progression })); } catch (err) { reject(err); } })));
}
