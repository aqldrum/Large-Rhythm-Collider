// compose-worker-client.js — Cosmos's handle on the Composer's two module workers (Compose mode, E1, 2026-10-22).
//
//   rhythm(layers, cycleSeconds, options)  → Promise<spec>          Composer/core/compose-worker.js (one rhythm);
//                                                                    options.trace → spec.trace, options.dust → spec.dust
//   superrow(payload, transfer)            → Promise<reply>          Composer/core/superrow-worker.js (a grid's window)
//   cancel()   terminates whichever worker is busy (the only way to stop a long compose) and rejects its promise with
//              { cancelled: true }; the next request builds a fresh worker.
//
// Worker URLs resolve against THIS module (Cosmos/engine/), never the document, the same rule as every other Cosmos
// worker (flight-view.js: "Module-relative Worker URL"), so the path works from the repo root and the deployed site.
// ⚠ Deploy: Composer/ is not on main yet; these URLs 404 there until it merges.

const defaultFactories = {
  rhythm: () => new Worker(new URL('../../Composer/core/compose-worker.js?v=1', import.meta.url), { type: 'module' }),
  superrow: () => new Worker(new URL('../../Composer/core/superrow-worker.js?v=1', import.meta.url), { type: 'module' }),
};

export function createComposeClient({ factories = defaultFactories } = {}) {
  const lanes = { rhythm: { worker: null, pending: new Map() }, superrow: { worker: null, pending: new Map() } };
  let nextId = 1;

  const laneWorker = (kind) => {
    const lane = lanes[kind];
    if (lane.worker) return lane.worker;
    const w = factories[kind]();
    w.onmessage = (event) => {
      const data = event.data || {}, job = lane.pending.get(data.id);
      if (!job) return;
      lane.pending.delete(data.id);
      if (data.ok) job.resolve(data); else job.reject(new Error(data.error || 'compose failed'));
    };
    w.onerror = (event) => {
      const err = new Error(event?.message || 'compose worker error');
      for (const job of lane.pending.values()) job.reject(err);
      lane.pending.clear();
      try { w.terminate(); } catch {}
      lane.worker = null;
    };
    lane.worker = w;
    return w;
  };
  const post = (kind, message, transfer = []) => new Promise((resolve, reject) => {
    const id = nextId++, w = laneWorker(kind);
    lanes[kind].pending.set(id, { resolve, reject });
    w.postMessage({ ...message, id }, transfer);
  });

  return {
    // COMPOSE DUST (E2): a reply's `dust` (options.dust, the row's onsets sampled) rides on the spec like its trace;
    // cosmos-compose.js takes both off before the spec is played
    rhythm(layers, cycleSeconds, options = {}) { return post('rhythm', { layers, cycleSeconds, options }).then((r) => (r.dust ? { ...r.spec, dust: r.dust } : r.spec)); },
    superrow(payload, transfer = []) { return post('superrow', payload, transfer); },
    get busy() { return lanes.rhythm.pending.size + lanes.superrow.pending.size > 0; },
    cancel() {
      for (const lane of Object.values(lanes)) {
        if (!lane.pending.size) continue;
        for (const job of lane.pending.values()) job.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        lane.pending.clear();
        try { lane.worker?.terminate(); } catch {}
        lane.worker = null;
      }
    },
    terminate() { this.cancel(); for (const lane of Object.values(lanes)) { try { lane.worker?.terminate(); } catch {} lane.worker = null; } },
  };
}
