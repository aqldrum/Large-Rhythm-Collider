// Small dedicated worker queue for finalized audio programs. It never shares the abundance pool:
// number-theory ownership may keep running while the current spatial field continues uninterrupted.
export class ProgramWorkerPool {
  constructor(url, { size = 1, WorkerClass = globalThis.Worker } = {}) {
    if (!WorkerClass) throw new Error('Web Workers are unavailable.');
    this.url = url;
    this.WorkerClass = WorkerClass;
    this.size = Math.max(1, Math.floor(size));
    this.workers = [];
    this.queue = [];
    this.jobs = new Map();
    this.byKey = new Map();
    this.nextId = 0;
    this.closed = false;
    this.stats = { queued: 0, compiling: 0, completed: 0, cancelled: 0, errors: 0, lastCompileMs: 0 };
    for (let i = 0; i < this.size; i++) this.workers.push(this._spawn());
  }

  _spawn() {
    const slot = { worker: null, job: null };
    this._attachWorker(slot);
    return slot;
  }

  _attachWorker(slot) {
    const worker = new this.WorkerClass(this.url, { type: 'module' });
    slot.worker = worker;
    worker.onmessage = event => this._settle(slot, event.data || {});
    worker.onerror = event => {
      event.preventDefault?.();
      try { worker.terminate(); } catch {}
      if (!this.closed) this._attachWorker(slot);
      this._settle(slot, { error: event.message || 'Audio compiler worker error.' });
    };
  }

  request(payload, { key, priority = 0 } = {}) {
    if (this.closed) return Promise.resolve({ cancelled: true });
    const jobKey = key || `${payload.grid}:${payload.selectionKey || ''}:${payload.generation || 0}`;
    const existing = this.byKey.get(jobKey);
    if (existing) return existing.promise;
    const job = { id: ++this.nextId, key: jobKey, priority, payload, state: 'queued' };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    this.byKey.set(jobKey, job);
    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.queue.sort((a, b) => a.priority - b.priority || a.id - b.id);
    this._drain();
    return job.promise;
  }

  cancelQueuedExcept(validKeys) {
    const keep = validKeys instanceof Set ? validKeys : new Set(validKeys || []);
    const retained = [];
    for (const job of this.queue) {
      if (keep.has(job.key)) retained.push(job);
      else this._cancel(job);
    }
    this.queue = retained;
    this._refreshStats();
  }

  _cancel(job) {
    this.jobs.delete(job.id);
    this.byKey.delete(job.key);
    job.state = 'cancelled';
    this.stats.cancelled++;
    job.resolve({ cancelled: true });
  }

  _drain() {
    if (this.closed) return;
    for (const slot of this.workers) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift();
      job.state = 'compiling';
      slot.job = job;
      slot.worker.postMessage({ id: job.id, ...job.payload });
    }
    this._refreshStats();
  }

  _settle(slot, data) {
    const job = slot.job;
    if (!job) return;
    slot.job = null;
    this.jobs.delete(job.id);
    this.byKey.delete(job.key);
    if (data.error) { this.stats.errors++; job.reject(new Error(data.error)); }
    else {
      this.stats.completed++;
      this.stats.lastCompileMs = Number(data.compileMs) || 0;
      job.resolve({ result: data.result, compileMs: this.stats.lastCompileMs });
    }
    this._drain();
  }

  _refreshStats() {
    this.stats.queued = this.queue.length;
    this.stats.compiling = this.workers.filter(slot => slot.job).length;
  }

  snapshot() { this._refreshStats(); return { ...this.stats }; }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    for (const job of [...this.queue]) this._cancel(job);
    this.queue = [];
    for (const slot of this.workers) {
      if (slot.job) this._cancel(slot.job);
      slot.job = null;
      slot.worker.terminate();
    }
    this.workers = [];
    this._refreshStats();
  }
}
