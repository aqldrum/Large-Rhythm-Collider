// cosmos-runtime.js — the flying, cache-free cosmos runtime (headless-testable).
//
// Around a moving camera it: (1) expands a frontier of PENDING zones over valid grids,
// (2) feeds them to an async solver POOL nearest-first so big zones never block cheap ones,
// (3) runs the Grid-Gravity competition over the SOLVED set and re-tethers zones via the
// continuous attractor (C1, no teleport), (4) orbits everything, (5) EVICTS zones outside an
// LOD radius (re-spawned deterministically on return).
//
// Coordinate-agnostic generation stays in the injected solve(); positions/precision live here.
import { computeDistricts } from './gg-core.js';
import { reparent, stepAttractor, backboneHash, len, sub, absolutePos, scale, slotDirection, rotateY } from './spine.js';

// district puff: each zone springs to a deterministic 3D slot around its sun; the whole puff
// spins on the clock. SLOT radius grows with grid-distance to the sun (near hug, far orbit wide).
const PUFF = { omega: 0.25, base: 26, step: 1.6, spanCap: 30, k: 3, damping: 3.4 };

export class Cosmos {
  // solve(grid)->abundance (kept count), cost(grid)->relative solve time, isValid(grid)->bool
  // Two solve modes:
  //   virtual (tests): solve(grid)->abundance sync + cost(grid)->relative latency (virtual clock)
  //   async (browser): dispatch(grid)->Promise<abundance> (real Web Worker pool)
  // Placement is pluggable: `neighbors(cam)` yields candidate grids near the camera, `cellDist(g,cam)`
  // is the LOD distance for eviction/ordering, `puffs` toggles the district-orbit motion. The defaults
  // are the original 1D spine (frontier = integer interval, distance = |g-cam|, puffs on) — so the
  // headless asserts are unchanged. Hilbert mode injects 3D-cell versions.
  // `compete` runs the Grid-Gravity district competition (suns/dust reparenting). Off (hilbert cube)
  // means every grid stays at its own cell, no connectors, and no computeDistricts cost per solve —
  // the cube's Hilbert layout already carries the visual structure.
  constructor({ reachScale = 0.15, spawnRadius = 60, evictRadius = 90, poolSize = 4,
                costUnit = 1, solve, cost, isValid, dispatch, restRadius = 40,
                neighbors = null, cellDist = null, puffs = true, compete = true }) {
    Object.assign(this, { reachScale, spawnRadius, evictRadius, poolSize, costUnit, solve, cost, isValid, dispatch, restRadius, puffs, compete });
    this.neighbors = neighbors || (cam => { const a = []; for (let g = cam - this.spawnRadius; g <= cam + this.spawnRadius; g++) a.push(g); return a; });
    this.cellDist = cellDist || ((g, cam) => Math.abs(g - cam));
    this.zones = new Map();      // grid -> zone
    this.inFlight = [];          // { grid, doneAt } (virtual mode)
    this.inFlightSet = new Set();// task ids in flight (async mode: plan/shard tasks, not grids)
    this._tid = 0;               // task id counter
    this.clock = 0;
    this.cam = 0;
    this.focusGrid = null;       // a clicked grid the UI wants solved NOW — jumps the pump queue (#4)
    this._dirty = false;
    this.events = { solves: [], reparents: 0, maxStep: 0, spawned: 0, evicted: 0, plans: 0, shards: 0, errors: 0 };
  }

  setCamera(grid) { this.cam = Math.round(grid); }
  setFocus(grid) { this.focusGrid = grid == null ? null : Math.round(grid); }

  _makeZone(grid) {
    // provisional: self-parented at its own spine point with a tiny deterministic scatter
    const h = backboneHash(grid), hl = len(h) || 1;
    return { grid, state: 'pending', abundance: 0, size: 0, slotDir: slotDirection(grid),
             parentGrid: grid, off: scale(h, 0.02 / hl), vel: [0, 0, 0], bornAt: this.clock };
  }

  _expandFrontier() {
    for (const g of this.neighbors(this.cam)) {
      if (g < 2 || this.zones.has(g) || !this.isValid(g)) continue;
      this.zones.set(g, this._makeZone(g)); this.events.spawned++;
    }
  }

  _pumpPool() {
    if (this.inFlight.length >= this.poolSize) return;
    const pending = [];
    for (const z of this.zones.values()) if (z.state === 'pending') pending.push(z);
    pending.sort((a, b) => this.cellDist(a.grid, this.cam) - this.cellDist(b.grid, this.cam));
    for (const z of pending) {
      if (this.inFlight.length >= this.poolSize) break;
      z.state = 'solving';
      this.inFlight.push({ grid: z.grid, startAt: this.clock, doneAt: this.clock + this.cost(z.grid) * this.costUnit });
    }
  }

  // Distributed async pump. Each zone offers its NEXT single work item — a 'plan' (list its shards)
  // if unplanned, else its next undispatched 'shard'. We sort all offers by (camera distance, then
  // FEWEST shards already dispatched for that grid) and fill the pool. The second key interleaves
  // bites: a monster grid gets one shard, then yields to fresher nearby grids, then comes back — so
  // no worker is ever stuck on one hyper-abundant grid and cheap zones keep lighting up.
  _nextWork(z) {
    if (z.state === 'pending') return { z, op: 'plan' };
    if (z.state === 'solving' && z.dispatchIdx < z.shardsTotal) return { z, op: 'shard', A: z.plan[z.dispatchIdx] };
    return null;   // planning, solved, or all shards dispatched (awaiting replies)
  }

  _pumpPoolAsync() {
    if (this.inFlightSet.size >= this.poolSize) return;
    const items = [];
    for (const z of this.zones.values()) { const w = this._nextWork(z); if (w) items.push(w); }
    if (!items.length) return;
    const f = this.focusGrid;
    items.sort((a, b) => (a.z.grid === f ? 0 : 1) - (b.z.grid === f ? 0 : 1)   // focused grid jumps the queue
                      || this.cellDist(a.z.grid, this.cam) - this.cellDist(b.z.grid, this.cam)
                      || (a.z.dispatchIdx || 0) - (b.z.dispatchIdx || 0)
                      || a.z.grid - b.z.grid);
    for (const w of items) {
      if (this.inFlightSet.size >= this.poolSize) break;
      const z = w.z, tid = ++this._tid; this.inFlightSet.add(tid);
      if (w.op === 'plan') {
        z.state = 'planning';
        this.dispatch({ op: 'plan', grid: z.grid, force: z.force }).then(r => this._onPlan(z, r, tid)).catch(() => this._failTask(z, tid));
      } else {
        z.dispatchIdx++;
        this.dispatch({ op: 'shard', grid: z.grid, A: w.A }).then(r => this._onShard(z, r, tid)).catch(() => this._onShard(z, { count: 0 }, tid));
      }
    }
  }

  _onPlan(z, r, tid) {
    this.inFlightSet.delete(tid); this.events.plans++;
    if (this.zones.get(z.grid) !== z) return;                 // evicted while planning
    if (r && r.monster) { z.monster = true; z.divisors = r.divisors; z.cost = r.cost; this._finishMonster(z); return; }   // combinatorial black hole — identified, not auto-solved (override forces it)
    if (!r || r.error || !r.shards) { if (r && r.error) this.events.errors++; z.unsolvable = true; if (r) z.divisors = r.divisors; this._finishZone(z, 1); return; }
    if (r.tooLarge) { z.unsolvable = true; z.divisors = r.divisors; this._finishZone(z, 1); return; }   // beyond MAX_SHARDS/MAXLAYER_CAP → faint frontier dust, not truly solved (abundance 1 is a fallback, not a real count)
    z.plan = r.shards; z.divisors = r.divisors; z.shardsTotal = r.shards.length; z.dispatchIdx = 0; z.shardsDone = 0; z.partial = 0;
    if (z.shardsTotal === 0) this._finishZone(z, 0); else z.state = 'solving';
  }

  _onShard(z, r, tid) {
    this.inFlightSet.delete(tid); this.events.shards++;
    if (r && r.error) this.events.errors++;
    if (this.zones.get(z.grid) !== z) return;                 // evicted mid-solve
    z.shardsDone++; z.partial += (r && r.count || 0);
    z.size = Math.max(0.15, Math.log2(z.partial + 1) * 0.5);   // progressive glow as bites land
    if (z.shardsDone >= z.shardsTotal) this._finishZone(z, z.partial);
  }

  _finishZone(z, abundance) {
    z.abundance = abundance; z.state = 'solved';
    z.size = Math.max(0.15, Math.log2(abundance + 1) * 0.5);
    this._dirty = true;                                       // include in the next GG competition
    this.events.solves.push({ grid: z.grid, doneAt: this.clock });
  }

  _failTask(z, tid) { this.inFlightSet.delete(tid); if (this.zones.get(z.grid) === z) this._finishZone(z, 1); }

  // A monster is pre-identified (cost proxy over the worker's MONSTER_COST) and NOT solved — it just renders big
  // so the eye finds it, while workers keep flowing the cheap field. abundance is unknown until forceSolve().
  _finishMonster(z) {
    z.state = 'solved';                 // stop re-planning it
    z.abundance = 0; z.size = 4;        // a red giant on screen (flight tints monsters); real count needs override
    this.events.solves.push({ grid: z.grid, doneAt: this.clock });
  }

  // Override: the UI asks to solve a monster anyway. Reset it to pending with `force` so the next plan bypasses
  // the cost gate (worker sees {force:true}) and it flows through the normal shard-solve path.
  forceSolve(grid) {
    const z = this.zones.get(grid); if (!z) return;
    z.monster = false; z.unsolvable = false; z.force = true;
    z.state = 'pending'; z.abundance = 0; z.size = 0;
    z.plan = undefined; z.shardsTotal = 0; z.dispatchIdx = 0; z.shardsDone = 0; z.partial = 0;
  }

  _completeSolves() {
    const still = [];
    for (const f of this.inFlight) {
      if (f.doneAt <= this.clock) {
        const z = this.zones.get(f.grid);
        if (z) {
          z.abundance = this.solve(f.grid);
          z.state = 'solved';
          z.size = Math.max(0.15, Math.log2(z.abundance + 1) * 0.5); // suns big, dust small
          this._dirty = true;
          this.events.solves.push({ grid: f.grid, startAt: f.startAt, doneAt: f.doneAt, dur: f.doneAt - f.startAt });
        }
      } else still.push(f);
    }
    this.inFlight = still;
  }

  _recompete() {
    if (!this.compete) { this._dirty = false; return; }   // cube mode: no district reorg
    const solved = [];
    for (const z of this.zones.values()) if (z.state === 'solved') solved.push({ grid: z.grid, abundance: z.abundance });
    if (!solved.length) { this._dirty = false; return; }
    solved.sort((a, b) => a.grid - b.grid);
    const { anchorOf } = computeDistricts(solved, this.reachScale);
    for (const [grid, anchor] of anchorOf) {
      const z = this.zones.get(grid); if (!z) continue;
      const target = (anchor != null && this.zones.has(anchor)) ? anchor : grid; // roots self-parent (sit at spine)
      if (target !== z.parentGrid) {
        const before = absolutePos(z);
        reparent(z, target);
        if (len(sub(absolutePos(z), before)) > 1e-6) throw new Error(`teleport on reparent ${grid}->${target}`);
        this.events.reparents++;
      }
    }
    this._dirty = false;
  }

  _stepMotion(dt) {
    if (!this.puffs) return;              // hilbert: every grid rests at its own cell (no orbit)
    const spin = this.clock * PUFF.omega;
    for (const z of this.zones.values()) {
      if (z.parentGrid === z.grid) continue;                 // suns / provisional sit at spine
      const slotR = PUFF.base + Math.min(Math.abs(z.grid - z.parentGrid), PUFF.spanCap) * PUFF.step;
      const dir = rotateY(z.slotDir, spin);                  // whole district puff rotates rigidly
      const target = [dir[0] * slotR, dir[1] * slotR, dir[2] * slotR];
      const before = absolutePos(z);
      stepAttractor(z, dt, { target, k: PUFF.k, damping: PUFF.damping });
      this.events.maxStep = Math.max(this.events.maxStep, len(sub(absolutePos(z), before)));
    }
  }

  _evict() {
    for (const [g, z] of this.zones) {
      if (this.cellDist(g, this.cam) > this.evictRadius) {
        this.zones.delete(g); this.events.evicted++;
        // virtual mode: drop its queued solve. async mode: in-flight tasks free their pool slot when
        // they reply (callbacks see the zone is gone via identity check and no-op).
        if (this.inFlight.length) this.inFlight = this.inFlight.filter(f => f.grid !== g);
      }
    }
  }

  tick(dt) {
    this.clock += dt;
    this._expandFrontier();
    if (this.dispatch) { this._pumpPoolAsync(); }      // async completes via promise → sets _dirty
    else { this._pumpPool(); this._completeSolves(); } // virtual clock (tests)
    if (this._dirty) this._recompete();
    this._stepMotion(dt);
    this._evict();
  }

  stats() {
    let pending = 0, solving = 0, solved = 0;
    for (const z of this.zones.values()) z.state === 'solved' ? solved++ : z.state === 'pending' ? pending++ : solving++;
    return { total: this.zones.size, pending, solving, solved, inFlight: this.inFlight.length + this.inFlightSet.size, clock: this.clock };
  }
}
