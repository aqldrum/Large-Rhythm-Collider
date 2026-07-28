// Recovering Web Worker pool for Cosmos abundance/bloom work. Deep shards may legitimately take a
// few seconds, but one that stops responding must not permanently consume a pool slot. Only heavy
// shard operations get a timeout; cheap plans and shards retain their ordinary completion semantics.
import { HEAVY_SHARD_LAYER, HEAVY_SHARD_TIMEOUT_MS } from '../grid-core.js';

export function isHeavySolvePayload(payload, heavyLayer = HEAVY_SHARD_LAYER) {
  return (payload?.op === 'shard' || payload?.op === 'bloomShard') && payload.A > heavyLayer;
}

export class SolverWorkerPool {
  constructor(url, size, {
    workerFactory = workerUrl => new Worker(workerUrl, { type: 'module' }),
    heavyLayer = HEAVY_SHARD_LAYER,
    heavyTimeoutMs = HEAVY_SHARD_TIMEOUT_MS,
    heavyLimit = 1,
  } = {}) {
    this.url = url; this.size = size; this.workerFactory = workerFactory;
    this.heavyLayer = heavyLayer; this.heavyTimeoutMs = heavyTimeoutMs; this.heavyLimit = heavyLimit;
    this.free = []; this.workers = []; this.jobs = new Map(); this.queue = [];
    this.id = 0; this.activeHeavy = 0; this.errors = 0; this.timeouts = 0; this.closed = false;
    for (let i = 0; i < size; i++) this._spawn();
  }

  _spawn() {
    if (this.closed) return null;
    const worker = this.workerFactory(this.url);
    worker.onmessage = event => this._settle(worker, event.data.id, event.data);
    worker.onerror = event => {
      if (worker._retired) return;
      this.errors++;
      event.preventDefault?.();
      console.error('[cosmos worker error]', event.message || event, 'payload', worker._payload);
      this._settle(worker, worker._job, { error: event.message || 'worker error' });
    };
    this.free.push(worker); this.workers.push(worker);
    return worker;
  }

  all() { return this.workers; }

  _clearTimer(worker) {
    if (worker._timeout != null) clearTimeout(worker._timeout);
    worker._timeout = null;
  }

  _settle(worker, id, data) {
    if (worker._retired || worker._job !== id) return;
    this._clearTimer(worker);
    const job = this.jobs.get(id);
    if (job) { this.jobs.delete(id); job.resolve(data); }
    if (worker._heavy) this.activeHeavy--;
    worker._job = null; worker._payload = null;
    worker._heavy = false;
    if (!this.closed) this.free.push(worker);
    this._drain();
  }

  _timeout(worker, id) {
    if (this.closed || worker._retired || worker._job !== id) return;
    worker._retired = true; this._clearTimer(worker);
    this.timeouts++; this.errors++;
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    if (job) job.resolve({
      error: `heavy ${job.payload.op} timed out after ${this.heavyTimeoutMs}ms`,
      timedOut: true,
      heavy: true,
    });
    if (worker._heavy) this.activeHeavy--;
    this.free = this.free.filter(candidate => candidate !== worker);
    this.workers = this.workers.filter(candidate => candidate !== worker);
    worker._job = null; worker._payload = null; worker._heavy = false;
    worker.terminate();
    this._spawn();
    this._drain();
  }

  dispatch(payload) {
    if (this.closed) return Promise.resolve({ error: 'worker pool is closed' });
    return new Promise(resolve => { this.queue.push({ payload, resolve }); this._drain(); });
  }

  _drain() {
    while (!this.closed && this.queue.length && this.free.length) {
      const next = this.queue.findIndex(job => !isHeavySolvePayload(job.payload, this.heavyLayer) || this.activeHeavy < this.heavyLimit);
      if (next < 0) break;                                      // all queued work is heavy and its lane is occupied
      const worker = this.free.pop(), [job] = this.queue.splice(next, 1), id = ++this.id;
      const heavy = isHeavySolvePayload(job.payload, this.heavyLayer);
      this.jobs.set(id, job); worker._job = id; worker._payload = job.payload; worker._heavy = heavy;
      if (heavy) this.activeHeavy++;
      if (this.heavyTimeoutMs > 0 && heavy) {
        worker._timeout = setTimeout(() => this._timeout(worker, id), this.heavyTimeoutMs);
      }
      worker.postMessage({ id, ...job.payload });
    }
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    for (const worker of this.workers) { worker._retired = true; this._clearTimer(worker); worker.terminate(); }
    for (const job of this.jobs.values()) job.resolve({ error: 'worker pool terminated' });
    for (const job of this.queue) job.resolve({ error: 'worker pool terminated' });
    this.jobs.clear(); this.queue = []; this.free = []; this.workers = [];
  }
}
