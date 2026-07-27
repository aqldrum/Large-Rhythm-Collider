// flight-view.js — fly the live, cache-free cosmos. Dependency-free canvas 3D (same engine as
// the bloom view; not Three.js). A real Web Worker pool solves grid abundances on approach; the
// proven cosmos runtime spawns/evicts/competes; stars are sized by abundance and orbit their
// district suns; connectors tether each zone to its anchor. Camera is free-fly with the
// integer-spine floating origin, so precision holds at any grid.
import { M } from './mode.js';
import { Cosmos } from './cosmos/cosmos-runtime.js';
import { renderPosCam, setPlacement, macroCell, macroScale, backboneHash, SPACING, CELL } from './cosmos/spine.js';
import { hilbertDecode, hilbertEncode, neighborGrids, INDEX_COUNT, SIDE } from './cosmos/hilbert.js';
import { clampHilbertWorld, nearbyHilbertWalls, rebaseHilbertCamera } from './cosmos/hilbert-boundary.js';
import { GOLDEN, cardColor, CHARTED } from './cosmos/bloom-core.js';
import { rhythmTriples, rhythmDoubles } from './cosmos/mn-core.js';
import { sampleArcPath } from './cosmos/web-return.js';
import { approximateStarSize, buildTravelBloomSamples, travelBloomWeight } from './cosmos/web-travel-bloom.js';
// agents.js (Collider-Battle ships / dragon-tail game) is DEFERRED for the POC and intentionally not ported.
import { binarySearch } from './oracle-core.js';
// Phase 0 generative-music instrument: a dedicated audio layer, fully separate from the site's playback
// engine (see cosmos-audio.js header). Cosmos owns wiring the lead voice + its live spatialization.
import { deriveVoice, setLead, setSpatial, setTickRate, setMuted, transportPhase, currentSkyChord, setField, debugSkyState, stopAudio, currentSkyRoot, proposeRoot, currentTicks, currentSkySeconds, setSpeedMode, currentSpeedMode, setHoldForFullQuality, setModulation, currentModulation, setAudioMode, currentAudioMode, setGridSpatialField, gridRowVisualState, setTuningStrength, setRootPolicyContext } from './cosmos-audio.js';
import { AUDIO_MODES, CULLED_ROW_MAX_VOICES_PER_TONE, ROW_ACTIVE_STARS, ROW_PREWARM_STARS, ROW_RADIUS, ROW_CONSONANCE_CENTS, audioCompileEligibility, chooseSpatialRows, harmonicSelectionKey, selectedOwnerFractions } from './cosmos-grid-audio-core.js';
import { ProgramWorkerPool } from './program-worker-pool.js';
import { toAudioListenerPosition } from './spatial-audio-frame.js';
import { drawGridRowAura } from './grid-row-aura.js';
// Full Sky (cosmos/FULL_SKY_HANDOFF.md): chord-walk.js (per-star Chord Walk) is retired from the flight
// path as of M4 — parked for a future main-page "auto-progression" feature, NOT imported here anymore.
// Sky Root handoff (cosmos/SKY_ROOT_HANDOFF_2026-07-22.md): anchor-independent root solve, Feature B.
import { solveRoots, scoreRootAt, poolFromTones } from './sky-root.js';

const STAR_SCALE = 4, NEAR = 5;
// ══ FLIGHT / LOD KNOBS ═══════════════════════════════════════════════════════════════════════
// Helix-style flight feel: arrow keys steer, WASD/QE translate, scroll dollies for fast travel.
const TURN = 1.5;          // camera turn rate (rad/sec)
const BOOST = 6;           // spacebar speed multiplier on top of WASD (cam.speed is the base)
const WEB_RETURN_LIFT_CELLS = 0.24; // ride slightly above the strand so it reads as a route, not a near-plane seam
const WEB_RETURN_LIFT_SPINE = 180;
const WEB_RETURN_LIFT_RAMP = 0.08;  // fraction of the ride used to ease onto/off the elevated camera rail
const WEB_RETURN_FRAME_CELLS = 2.2; // arc-length window used for a continuous heading across synthetic nodes
const WEB_RETURN_FRAME_SPINE = 900;
const WEB_RETURN_STAR_AHEAD_CELLS = 100.5; // illuminate the nearby sky before the camera reaches it
const WEB_RETURN_STAR_BEHIND_CELLS = 1.4; // short fading wake keeps passed stars from popping dark
const WEB_RETURN_STAR_RADIUS_CELLS = 12.35; // soft radius of the synthetic hyperspace tunnel
const WEB_RETURN_STAR_AHEAD_SPINE = 20200;
const WEB_RETURN_STAR_BEHIND_SPINE = 1100;
const WEB_RETURN_STAR_RADIUS_SPINE = 6000;
const WEB_RETURN_STAR_SAMPLES = 14;
const BOOST_STAR_STREAK_SCALE = 10.4; // extend one frame of true screen motion into a readable trail
const BOOST_STAR_STREAK_MAX = 100;    // px cap keeps close stars from drawing giant slashes
const BOOST_STAR_STREAK_ALPHA = 10.34;
const DOLLY = 700;         // SPINE: world units per scroll notch (fast travel down the codex line)
const HIL_DOLLY_CELLS = 0.7; // HILBERT: cells per scroll notch — small on purpose so you don't
                             //   rocket across the cube (spatial hops = huge grid-index jumps) and
                             //   outrun the solver. Raise for faster travel, lower if it still races.
const HIL_WALL_REVEAL_CELLS = 7; // forcefield fades in only near a face; collision uses the exact same box
const HIL_WALL_PATCH_CELLS = 9;  // local half-width — never construct/render an entire 256-by-256 face
const HIL_CAMERA_RADIUS = CELL * 0.12; // keeps the viewpoint in front of the near plane at contact
// Hilbert-cube LOD window (in CELL units). CRITICAL: HIL_EVICT is the distance BEHIND you that zones
// survive, so evict ≫ spawn keeps the whole TRAIL you fly (evict 20 → ~10k+ zones → jank). Keep evict
// ≈ spawn + 2. Zone count while flying ≈ 4.2·HIL_EVICT³·0.9: evict 8 → ~1900 · 10 → ~3800 · 12 → ~6500.
const HIL_SPAWN = 10;       // spawn grids within this many cells of the camera (frontier reach / density)
const HIL_EVICT = 40;      // drop zones beyond this — the zone-count ceiling; keep ≈ HIL_SPAWN + 2
const POOL_MAX = 8;        // max solver workers. Fewer = smoother flight (leaves cores for render), slower solve
// Backpressure: when the solve backlog (pending+solving in-window) exceeds SOLVE_BACKLOG, the frontier reach eases
// down toward HIL_SPAWN_MIN so we stop piling on work, and recovers when it catches up. Magnitude-agnostic — the
// natural home for a future LOD slider (raise HIL_SPAWN / SOLVE_BACKLOG for a denser, hungrier field).
const HIL_SPAWN_MIN = 4;   // floor for the adaptive reach under load
const SOLVE_BACKLOG = 80;  // backlog above which the frontier starts shrinking
let   hilSpawn = HIL_SPAWN;// live (eased) frontier reach in the cube
// Star bloom is CLICK-GATED: the ambient field stays a clean starry sky, and only the focused (clicked)
// star renders its cardinality-sphere point cloud — the FULL cloud, no point cap. Clicking a star focuses
// it (priority-solves via cosmos.setFocus if unsolved) and streams its whole cloud in; clicking empty
// space clears it. This keeps disjoint singletons/lines from small grids out of the sky.
const BLOOM_R = 6;         // world units per bloom radius step (overall bloom size)
const BLOOM_KNEE = 18;     // cardinality steps (above cmin) that grow the radius at FULL BLOOM_R; the common
                           //   bulk lives here so it stays proportional/spiky.
const BLOOM_TAIL = 0.35;   // beyond the knee, each extra cardinality step adds only this fraction of BLOOM_R —
                           //   so a lone very-high-cardinality outlier still pokes out (a spike) but doesn't
                           //   fling the bloom's outer radius (and its blot/bubble) way out. Economy > proportion.
const BLOOM_MAX_R_FRAC = 3.0; // cube: LOOSE safety ceiling on a bloom's outer radius (× CELL). Blooms grow to
                              //   the full BLOOM_R scale (big exciting stars); local DEFORMATION pushes the
                              //   neighbours out of the way, so this only bites a truly pathological grid.
let   BLOOM_MAX_R = Infinity; // resolved from CELL in ensureFlight (hilbert only; spine is left unbounded)
const BUBBLE_MARGIN = 0.5 * CELL; // cube: neighbours inside (bloom outer radius + this) are pushed out to that
                              //   shell — a big bloom carves a clearing; small blooms (shell+margin < CELL) don't disturb.
const BLOT_FRAC = 1.12;       // "black hole": screen disk radius = this × bloom outer radius. Background stars
                              //   behind it (farther in view depth) are culled from BOTH draw and hit-test — no
                              //   background noise behind a bloom, and no accidental clicks through it.
const BLOOM_OMEGA = 0;     // bloom spin (rad/sec) — 0: static so nodes stay clickable
const BLOOM_RV_MS = 320;   // per-node birth ease (each node fades + scales in)
const BLOOM_EASE = 0.14;   // re-flow easing: nodes glide as their sphere fills (recreates the solve animation)
const FOCUS_FILL_MS = 2500; // reveal the whole focused cloud over ~this long regardless of size (big grids
                            //   like 27720's ~19k systems fill just as fast as small ones — rate scales)
let   FOCUS_FETCH_CONC = 6; // bloom-shard fetches in flight across ALL bloomed grids (set from pool size in
                            //   ensureFlight): blooms DIVERT most of the pool to filling their clouds fast.
// Click-to-inspect: hover a star or bloom node → tooltip; click (no drag) → pin a detail panel.
const NODE_HIT = 9;        // px radius to grab a bloom node under the cursor (nodes take priority)
const STAR_HIT = 7;        // px padding added to a star's drawn radius for grabbing it
const DRAG_SLOP = 5;       // px of pointer travel before a press counts as a look-drag (not a click)
// ── NETWORK SPIDERWEB: connect all 12T grids that share a mother scale (oracle-index `mtag`), drawn
// PROGRESSIVELY — a strand lights up only once you've flown near both its endpoints, so warping from
// zone to zone traces a cosmic web across the cube. Membership is the codex index already loaded for the
// charted lookup (no new data); placement is deterministic (macroCell), so members that aren't loaded as
// stars still get positioned + connected. Node-level: click a node → trace ITS mother's family. ──
// Membership, graph construction, reveal, projection, picking, and drawing all live in the dedicated
// OffscreenCanvas worker. This thread keeps only tiny Web metadata for the HUD/card.
// Dragon-tail trim: cap how far behind/around the camera web strands draw, as a fraction of FOG_FAR, with a
// soft fade over the last stretch. The FUTURE graphics slider drives `webTailFrac` (lower = shorter tail =
// cheaper: low graphics keeps a stub, high graphics streams a long tail). Default 1.0 ≈ the fog range (no
// visible change until the slider lowers it).
let   webTailFrac = 1.0;
const WEB_COLORS = ['#ff6ec7', '#6ecbff', '#ffd86e', '#8dff6e', '#c58bff', '#ff9a6e'];
let   webColorN = 0;
const activeWebs = new Map(); // web id -> web { tag, color, slot, visible, dynamic?, ... }
let   hoverWeb = null;         // nearest visible strand, returned asynchronously by the Web worker
let   returnRide = null;       // active camera autopilot along a selected Web back to its authored grid
const WEB_MAX = 10;           // max simultaneous webs (mother + MN); number keys 1-9,0 hide/show each slot,
                              //   a hidden slot is reclaimed by the next trace (so you can swap webs in/out)
// MN "hyperlane" web: a motif (Root Double or CT/IT/RDCP triple) scanned live from a node's layers is
// realized at scalar s by layers (values·s), so its family = grids divisible by the motif's base-LCM.
// Cross-cardinality, cache-free, and EFFECTIVELY INFINITE (all multiples), so it's drawn as a DYNAMIC
// camera-local web: members = the current LOD stars divisible by base, rebuilt as you fly → it never
// "stops short", it flows with you. (Mother webs are finite lineages → stay global + persistent.)
const MN_CHIP_MAX = 12;       // most motif chips to show on a node panel (triples first, rarer first)
// Collider-Battle prototype: AI cube-frame ships that each SELECT a network and fly its family, leaving a
// tunnel-trail, crashing into one another. Toggle with the B key (off by default). All sim lives in agents.js.
const AGENT_COUNT = 6;        // ships spawned by the B toggle
const AGENT_WEB_LINE_W = 2, AGENT_WEB_STRAND_A = 0.3;
let   swarm = null;
// ═════════════════════════════════════════════════════════════════════════════════════════════
// Depth fog: stars fade to black between these view-depths so the field reads as deep space fading
// to dark, not a hard-edged tube. Set per placement in ensureFlight.
let FOG_NEAR = 3500, FOG_FAR = 13000, placement = 'spine';
const fogAt = vz => Math.max(0, Math.min(1, 1 - (vz - FOG_NEAR) / (FOG_FAR - FOG_NEAR)));

// ── cosmos-audio spatialization mapping: distance (view-depth z) → gain/register for the lead voice ──
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mapRange = (v, a, b, c, d) => clampN((v - a) / (b - a), 0, 1) * (d - c) + c;
const distGain = z => clampN(mapRange(z, FOG_NEAR, FOG_FAR, 1, 0.15), 0.05, 1);   // near→loud, far→quiet
const distOctave = z => Math.min(2, Math.floor(mapRange(z, FOG_NEAR, FOG_FAR, 0, 2.99)));   // near→0, far→+1/+2
// Full Sky (cosmos/FULL_SKY_HANDOFF.md): the ambient bed's audible-set selection. AUDIBLE_N here
// pairs with cosmos-audio.js's own SKY KNOBS block (CHORD_TICKS/TABU_K/LAMBDA_FIELD/etc — audio-side
// knobs live there; this is the camera/projection-side knob for WHICH zones feed the bed).
const AUDIBLE_N = 10;         // nearest zones (by view depth) with a non-empty skyPool feed the bed
const AUDIBLE_MARGIN = 4;     // hysteresis: a currently-audible star stays audible until it falls outside
                               // AUDIBLE_N+this — without it, a star sitting near the Nth-nearest boundary
                               // flickers in/out of the field every frame while flying (churns cosmos-audio's
                               // bed voices constantly — part of the "flight cuts the bed" fix).
const distCutoff = z => mapRange(z, FOG_NEAR, FOG_FAR, 8000, 600);   // near→open, far→muffled lowpass (Hz)
let audibleIds = new Set();   // previous frame's audible-set membership, for the hysteresis above

// Cull2 grid-row mode: true-3D, head-turn-independent movement field. Only this nearest prewarm set
// is allowed to touch the dedicated audio compiler; the thousands of other loaded zones remain pure
// visual/number-theory state. The consonance window is intentionally one constant ready for a UI knob.
const ROW_COMPILE_WORKERS = 1;
const rowDistanceGain = d => clampN(mapRange(d, 0, ROW_RADIUS, 0.9, 0.06), 0.04, 0.9);
const rowDistanceCutoff = d => mapRange(d, 0, ROW_RADIUS, 9000, 900);
let rowActiveIds = new Set();
let rowPrewarmIds = new Set();
let rowCompiler = null;
let rowGeneration = 0;
let rowSelectionKey = '';

// Sky Root handoff, Feature B3: camera/gather-side knobs (flight-view owns camera state — root-state
// display depth ROOT_TOP_K lives in cosmos-audio.js's SKY KNOBS, same split as AUDIBLE_N above).
const ROOT_RADIUS = 1400;        // world units — a true-3D-distance gather radius around the camera, NOT
                                  // the view-depth-sorted audible set (the root must not change on turning
                                  // your head). Start ≈ hilbert's FOG_NEAR; Avery tunes by ear/eye.
const SETTLE_SPEED = 5;          // world units/sec below which the camera counts as "stopped"
// Both on the SKY clock (rate-independent wall seconds), not the grid tick clock — scaled speed can put
// the tick rate in the thousands, and "settled" must mean the same duration to a listener at any speed.
const SETTLE_SECONDS = 3;        // seconds speed must stay under SETTLE_SPEED before solving (was 30 ticks)
const ROOT_RESOLVE_MIN_SECONDS = 29.7;   // rate limit: at most one solve this often (coprime with CHORD_SECONDS=25.6)
let camSpeed = 0;                // this frame's actual world-space translation speed (units/sec) — stepControls sets it
let settleSinceSecond = null;    // sky second when speed first dropped below SETTLE_SPEED, or null (moving)
let lastRootResolveSecond = -Infinity;   // sky second of the last proposed solve (rate limit)
let rootGeographyEpoch = 0;      // invalidates a settled solve once meaningful movement resumes
let rootPolicyWasSettled = false;

// ── number theory (frontier validity + solve cost proxy) ──
function factorInfo(n) {
  let m = n, primes = 0, divisors = 1;
  for (let p = 2; p * p <= m; p++) if (m % p === 0) { let e = 0; while (m % p === 0) { m /= p; e++; } primes++; divisors *= e + 1; }
  if (m > 1) { primes++; divisors *= 2; }
  return { primes, divisors };
}
const isValid = g => factorInfo(g).primes >= 2;

// ── Web Worker pool: dispatch(payload) -> Promise<reply>. Payload is an op (plan|shard); the reply
// is the worker's message. Robust: a worker that throws/errors is RECOVERED (pushed back, its job
// resolved with {error}) so a crash can never leak a pool slot and stall flight. ──
class Pool {
  constructor(url, size) {
    this.free = []; this.workers = []; this.jobs = new Map(); this.queue = []; this.id = 0; this.errors = 0; this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(url, { type: 'module' });
      w.onmessage = e => this._settle(w, e.data.id, e.data);
      w.onerror = ev => { this.errors++; ev.preventDefault && ev.preventDefault(); console.error('[cosmos worker error]', ev.message || ev, 'payload', w._payload); this._settle(w, w._job, { error: ev.message || 'worker error' }); };
      this.free.push(w); this.workers.push(w);
    }
  }
  all() { return this.workers; }   // every worker (busy or free) — stopFlight() terminates the whole set

  _settle(w, id, data) {
    const job = id != null && this.jobs.get(id);
    if (job) { this.jobs.delete(id); job.res(data); }
    w._job = null; w._payload = null; this.free.push(w); this._drain();
  }
  dispatch(payload) { return new Promise(res => { this.queue.push({ payload, res }); this._drain(); }); }
  _drain() { while (this.queue.length && this.free.length) { const w = this.free.pop(), job = this.queue.shift(), id = ++this.id; this.jobs.set(id, job); w._job = id; w._payload = job.payload; w.postMessage({ id, ...job.payload }); } }
}

// One worker owns the complete Web pipeline and its transferred overlay canvas. Frames are
// backpressured: if the worker is still drawing, only the newest camera snapshot is retained.
class WebRenderer {
  constructor(url, canvas, placementMode, onFrame) {
    this.worker = new Worker(url, { type: 'module' });
    this.onFrame = onFrame; this.frameId = 0; this.requestId = 0; this.pending = new Map();
    this.busy = false; this.latestFrame = null; this.closed = false;
    this.worker.onmessage = event => this._message(event.data || {});
    this.worker.onerror = event => { event.preventDefault?.(); console.warn('[cosmos Web worker]', event.message || event); this._failAll(event.message || 'Web worker failed'); };
    const offscreen = canvas.transferControlToOffscreen();
    this.worker.postMessage({ type: 'init', canvas: offscreen, placement: placementMode }, [offscreen]);
  }
  post(message, transfer = []) { if (!this.closed) this.worker.postMessage(message, transfer); }
  resize(width, height, dpr) { this.post({ type: 'resize', width, height, dpr }); }
  upsert(web) { this.post({ type: 'upsert', web }); }
  remove(webId) { this.post({ type: 'remove', webId }); }
  visibility(webId, visible) { this.post({ type: 'visibility', webId, visible }); }
  select(webId) { this.post({ type: 'select', webId }); }
  clearRoute() { this.post({ type: 'clearRoute' }); }
  zones(added, removed) {
    if (!added.length && !removed.length) return;
    const a = Int32Array.from(added), r = Int32Array.from(removed);
    this.post({ type: 'zones', added: a, removed: r }, [a.buffer, r.buffer]);
  }
  frame(frame) { this.latestFrame = frame; if (!this.busy) this._sendFrame(); }
  _sendFrame() {
    if (!this.latestFrame || this.closed) return;
    const frame = this.latestFrame; this.latestFrame = null; this.busy = true;
    this.post({ type: 'frame', frameId: ++this.frameId, frame });
  }
  request(op, payload = {}) {
    if (this.closed) return Promise.reject(new Error('Web worker is closed.'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.post({ type: 'request', id, op, ...payload }); });
  }
  _message(message) {
    if (message.type === 'frameDone') {
      this.busy = false; this.onFrame?.(message); this._sendFrame(); return;
    }
    if (message.type === 'response') {
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    }
  }
  _failAll(reason) { this.closed = true; this.busy = false; for (const job of this.pending.values()) job.reject(new Error(reason)); this.pending.clear(); }
  terminate() { if (this.closed) return; this._failAll('Web worker terminated.'); this.worker.terminate(); }
}

// ── vec helpers ──
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// Local cube deformation: push a point radially OUT of each bloom's bubble (so neighbours make room for a
// big cloud). A bloom never deforms its own star (b.g === grid skipped). Composed over all bubbles.
function deform(p, grid, bubbles) {
  let x = p[0], y = p[1], z = p[2];
  for (const b of bubbles) {
    if (b.g === grid) continue;
    const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2], d = Math.hypot(dx, dy, dz);
    if (d > 1e-6 && d < b.bubbleR) { const k = b.bubbleR / d; x = b.c[0] + dx * k; y = b.c[1] + dy * k; z = b.c[2] + dz * k; }
  }
  return [x, y, z];
}

// ── network web helpers ──────────────────────────────────────────────────────────────────────
// World-relative position of ANY grid (loaded or not), same math a resting star uses. Web nodes
// prefer their live zone position when loaded (rpOf), and fall back to this so an unloaded member
// still sits where its star would.
function gridRP(g) {
  const c = macroCell(g), cc = macroCell(cam.anchor), s = macroScale(), h = backboneHash(g);
  return [(c[0] - cc[0]) * s + h[0] - cam.off[0],
          (c[1] - cc[1]) * s + h[1] - cam.off[1],
          (c[2] - cc[2]) * s + h[2] - cam.off[2]];
}
// Resolve a bloom node's key to its mother-scale tag via the same codex index used for charted lookup.
function mtagOfKey(key) {
  if (!indexKeys || !indexMtag || !key) return null;
  const i = binarySearch(indexKeys, key); if (i < 0) return null;
  return mtagNames[indexMtag[i]] || null;
}
// Assign a slot (0..WEB_MAX-1) for a new web: lowest free, else reclaim the lowest HIDDEN web's slot
// (toggling a web off frees it for the next trace). Returns -1 if all WEB_MAX slots are visible.
function claimSlot() {
  const used = new Map(); for (const w of activeWebs.values()) used.set(w.slot, w);
  for (let s = 0; s < WEB_MAX; s++) if (!used.has(s)) return s;
  let victim = null; for (const w of activeWebs.values()) if (w.visible === false && (!victim || w.slot < victim.slot)) victim = w;
  if (victim) { removeWeb(victim.tag); return victim.slot; }
  return -1;   // full (all visible) — hide one with its number key to free a slot
}
// number key 1-9,0 → toggle that slot's web visibility (hidden webs stop drawing but keep their state)
function toggleSlot(s) { for (const w of activeWebs.values()) if (w.slot === s) { w.visible = !w.visible; webRenderer?.visibility(w.tag, w.visible); return; } }

function removeWeb(id) {
  activeWebs.delete(id);
  webRenderer?.remove(id);
  if (returnRide && returnRide.webId === id) { returnRide = null; webRenderer?.clearRoute(); }
  if (selected && selected.kind === 'web' && selected.webId === id) { selected = null; showDetail(null); }
}

// Toggle a mother-scale network on/off. srcGrid (the clicked node's grid) is seeded revealed so the web
// has an anchor even before you fly to it.
function toggleWeb(tag, srcGrid) {
  if (activeWebs.has(tag)) { removeWeb(tag); return; }
  const members = mtagGrids && mtagGrids.get(tag);
  if (!members || !members.length) return;
  const slot = claimSlot(); if (slot < 0) return;
  const web = { tag, slot, visible: true, color: WEB_COLORS[webColorN++ % WEB_COLORS.length],
    homeGrid: srcGrid, memberCount: members.length, localNodes: members.length, visibleNodes: 0 };
  activeWebs.set(tag, web);
  webRenderer?.upsert({ tag, visible: true, dynamic: false, color: web.color, homeGrid: srcGrid, members });
}
// Toggle a Master-Network family web. Members = grids divisible by the motif's base-LCM (host it at some
// scalar) — but that set is infinite, so the worker rebuilds it from the current LOD
// stars every frame-ish, so it flows endlessly with the camera (smart LOD, never a hard cap).
function toggleMNWeb(id, base, srcGrid) {
  if (activeWebs.has(id)) { removeWeb(id); return; }
  if (!(base >= 2)) return;
  const slot = claimSlot(); if (slot < 0) return;
  const web = { tag: id, slot, visible: true, dynamic: true, base, homeGrid: srcGrid,
    color: WEB_COLORS[webColorN++ % WEB_COLORS.length], localNodes: 0, visibleNodes: 0 };
  activeWebs.set(id, web);
  webRenderer?.upsert({ tag: id, visible: true, dynamic: true, base, color: web.color, homeGrid: srcGrid });
}
// Draw all visible webs under the star field. Two kinds:
//  • static (mother): finite member list, revealed progressively as the camera nears each strand.
//  • dynamic (MN): infinite family, so members = the current LOD stars divisible by base, rebuilt on a
//    cadence → the web flows endlessly with the camera (smart LOD).
const cameraAbsolute = () => { const c = macroCell(cam.anchor), s = macroScale(); return [c[0] * s + cam.off[0], c[1] * s + cam.off[1], c[2] * s + cam.off[2]]; };

function cancelWebReturn(status = 'ride cancelled') {
  const webId = returnRide?.webId || (selected?.kind === 'web' ? selected.webId : null);
  webRouteGeneration++;
  const web = webId && activeWebs.get(webId); if (web) { web.rideStatus = status; web.routePlanning = false; }
  returnRide = null; camSpeed = 0; webRenderer?.clearRoute();
  if (selected && selected.kind === 'web') showDetail(selected);
}

// Route-local "up": world-up projected perpendicular to the strand. Near a vertical strand there
// is no meaningful world-up component, so fall back to a stable horizontal perpendicular.
function webReturnLift(tangent) {
  let lift = [-tangent[0] * tangent[1], 1 - tangent[1] ** 2, -tangent[2] * tangent[1]];
  if (Math.hypot(...lift) < 0.12) {
    const fallback = Math.abs(tangent[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1], along = dot(fallback, tangent);
    lift = fallback.map((value, i) => value - tangent[i] * along);
  }
  return norm(lift);
}

// The sampler's immediate tangent changes at every subdivided spline point. A chord spanning a
// fixed arc-length window is continuous and ignores those synthetic joints while still anticipating
// real bends in the route. Near either endpoint the window naturally becomes one-sided.
function webReturnRailTangent(path, progress, windowDistance) {
  const halfWindow = Math.max(0.0001, Math.min(0.12, windowDistance / Math.max(1, path.total)));
  const before = sampleArcPath(path, Math.max(0, progress - halfWindow)).position;
  const after = sampleArcPath(path, Math.min(1, progress + halfWindow)).position;
  return norm(after.map((value, i) => value - before[i]));
}

function webReturnLookDirection(ride) {
  const forward = norm(ride.tangent), up = norm(ride.lift), right = norm(cross(up, forward));
  const cp = Math.cos(ride.lookPitch), sp = Math.sin(ride.lookPitch);
  const cy = Math.cos(ride.lookYaw), sy = Math.sin(ride.lookYaw);
  return norm([0, 1, 2].map(i => forward[i] * cp * cy + right[i] * cp * sy + up[i] * sp));
}

function applyWebReturnLook(ride) {
  const direction = webReturnLookDirection(ride);
  cam.yaw = Math.atan2(direction[0], direction[2]);
  cam.pitch = Math.asin(Math.max(-1, Math.min(1, direction[1])));
}

function beginWebReturn(webId) {
  const web = activeWebs.get(webId);
  if (!web || web.homeGrid == null || !webRenderer) return;
  const generation = ++webRouteGeneration;
  web.visible = true; web.routePlanning = true; web.rideProgress = 0; web.rideStatus = 'stitching route off-thread';
  webRenderer.visibility(webId, true); selected = { kind: 'web', webId }; webRenderer.select(webId); showDetail(selected);
  webRenderer.request('planReturn', { webId, cameraStart: cameraAbsolute() }).then(result => {
    if (generation !== webRouteGeneration || !activeWebs.has(webId)) { webRenderer.clearRoute(); return; }
    web.routePlanning = false;
    const liftHeight = placement === 'hilbert' ? CELL * WEB_RETURN_LIFT_CELLS : WEB_RETURN_LIFT_SPINE;
    const frameWindow = placement === 'hilbert' ? CELL * WEB_RETURN_FRAME_CELLS : WEB_RETURN_FRAME_SPINE;
    // Aim once from the elevated rail toward a point ahead on the actual strand. Position remains
    // route-owned afterward, while arrow-key steering stays fully available during travel.
    const openingTangent = webReturnRailTangent(result.path, 0.0001, frameWindow), lift = webReturnLift(openingTangent);
    returnRide = { ...result, elapsed: 0, lastUi: 0, liftHeight, frameWindow, lift, pathProgress: 0 };
    const lookProgress = Math.min(1, Math.max(0.0001, liftHeight * 4 / Math.max(1, result.path.total)));
    const lookAt = sampleArcPath(result.path, lookProgress).position;
    const elevated = result.path.points[0].map((value, i) => value + lift[i] * liftHeight);
    const openingView = norm(lookAt.map((value, i) => value - elevated[i]));
    const right = norm(cross(lift, openingTangent));
    returnRide.tangent = openingTangent;
    returnRide.lookYaw = Math.atan2(dot(openingView, right), dot(openingView, openingTangent));
    returnRide.lookPitch = Math.asin(Math.max(-1, Math.min(1, dot(openingView, lift))));
    applyWebReturnLook(returnRide);
    web.rideStatus = result.sampled ? `riding an adaptive ${result.routeNodes}-node route` : `riding ${result.routeNodes} connected nodes`;
    showDetail(selected);
  }).catch(error => {
    if (generation !== webRouteGeneration || !activeWebs.has(webId)) return;
    web.routePlanning = false; web.rideStatus = error.message || 'route planning failed'; webRenderer.clearRoute(); showDetail(selected);
  });
}

function stepWebReturn(now, dt) {
  if (!returnRide) return false;
  const ride = returnRide, web = activeWebs.get(ride.webId);
  if (!web) { cancelWebReturn(); return false; }
  // Space already means boost in free flight; during autopilot it accelerates the route clock by
  // the same multiplier. Accumulated ride time keeps press/release transitions continuous.
  ride.elapsed = Math.min(ride.duration, ride.elapsed + dt * (keys[' '] ? BOOST : 1));
  const raw = ride.elapsed / ride.duration;
  const eased = 0.5 - Math.cos(raw * Math.PI) * 0.5;
  const sample = sampleArcPath(ride.path, eased), here = cameraAbsolute();
  ride.pathProgress = eased;
  const railTangent = webReturnRailTangent(ride.path, eased, ride.frameWindow);
  const edgeRamp = Math.max(0, Math.min(1, raw / WEB_RETURN_LIFT_RAMP, (1 - raw) / WEB_RETURN_LIFT_RAMP));
  const liftEase = 0.5 - Math.cos(edgeRamp * Math.PI) * 0.5;
  let targetLift = webReturnLift(railTangent);
  if (dot(targetLift, ride.lift) < 0) targetLift = targetLift.map(value => -value);
  const liftBlend = 1 - Math.exp(-dt * 8);
  const blendedLift = ride.lift.map((value, i) => value + (targetLift[i] - value) * liftBlend);
  const liftAlong = dot(blendedLift, railTangent);
  ride.lift = norm(blendedLift.map((value, i) => value - railTangent[i] * liftAlong));
  ride.tangent = railTangent;
  const ridePosition = sample.position.map((value, i) => value + ride.lift[i] * ride.liftHeight * liftEase);
  const delta = ridePosition.map((v, i) => v - here[i]);
  const actualMove = translateCam(delta);
  camSpeed = dt > 0 ? Math.hypot(actualMove[0], actualMove[1], actualMove[2]) / dt : 0;

  if (now - ride.lastUi > 250) { ride.lastUi = now; web.rideProgress = raw; showDetail(selected); }
  if (raw < 1) return true;

  const hc = macroCell(ride.homeGrid), scale = macroScale();
  const arrival = placement === 'hilbert' ? clampHilbertWorld(ride.arrival, HIL_CAMERA_RADIUS) : ride.arrival;
  cam.anchor = ride.homeGrid;
  cam.off = [arrival[0] - hc[0] * scale, arrival[1] - hc[1] * scale, arrival[2] - hc[2] * scale];
  cosmos.setCamera(cam.anchor); camSpeed = 0;
  web.rideProgress = 1; web.rideStatus = 'home reached'; returnRide = null; webRenderer?.clearRoute(); showDetail(selected);
  return true;
}

// Draw the Collider-Battle ships: each agent's tunnel-trail (fading polyline) + a velocity-oriented cube
// frame; a crashing agent flashes an expanding ring. Agents live in absolute cube world coords, so we
// project them relative to the camera's absolute position (cellAbs), the same frame the trail is stored in.
function drawAgents(basis) {
  if (!swarm || !swarm.agents.length) return;
  const cc = macroCell(cam.anchor), s = macroScale();
  const camAbs = [cc[0] * s + cam.off[0], cc[1] * s + cam.off[1], cc[2] * s + cam.off[2]];
  const proj = wp => toScreen([wp[0] - camAbs[0], wp[1] - camAbs[1], wp[2] - camAbs[2]], basis);
  const cellW = g => { const c = macroCell(g); return [c[0] * s, c[1] * s, c[2] * s]; };
  const sgn = b => b ? 1 : -1;
  for (const a of swarm.agents) {
    // dragon tail = the agent's OWN network web: strands between the family-member grid cells it has
    // threaded (older = dimmer), plus a live edge from the last node to the ship, plus a bead per node.
    ctx.lineWidth = AGENT_WEB_LINE_W; ctx.strokeStyle = a.color; ctx.lineCap = 'round';
    const nodes = a.path, N = nodes.length;
    let prev = N ? proj(cellW(nodes[0])) : null;
    for (let i = 1; i < N; i++) {
      const sp = proj(cellW(nodes[i]));
      if (sp && prev) { const fog = fogAt(sp.z); if (fog > 0) { ctx.globalAlpha = AGENT_WEB_STRAND_A * fog * (i / N); ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(sp.x, sp.y); ctx.stroke(); } }
      prev = sp;
    }
    const c0 = proj(a.p);
    if (a.alive && prev && c0) { const fog = fogAt(c0.z); if (fog > 0) { ctx.globalAlpha = AGENT_WEB_STRAND_A * fog; ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(c0.x, c0.y); ctx.stroke(); } }   // growing edge
    ctx.fillStyle = a.color;
    for (let i = 0; i < N; i++) { const sp = proj(cellW(nodes[i])); if (!sp) continue; const fog = fogAt(sp.z); if (fog <= 0) continue; ctx.globalAlpha = 0.55 * fog * (0.3 + 0.7 * i / N); ctx.beginPath(); ctx.arc(sp.x, sp.y, AGENT_WEB_LINE_W * 1.1, 0, 7); ctx.fill(); }
    if (!a.alive) {                                   // crash flash: expanding rings
      if (c0) { const t = Math.max(0, Math.min(1, 1 - a.crashT / swarm.respawnMs)), fog = fogAt(c0.z);
        const rr = swarm.cubeR * (1 + 4 * t) * focal / c0.z;
        ctx.globalAlpha = (1 - t) * fog; ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(c0.x, c0.y, Math.max(1, rr), 0, 7); ctx.stroke();
        ctx.strokeStyle = a.color; ctx.beginPath(); ctx.arc(c0.x, c0.y, Math.max(1, rr * 0.6), 0, 7); ctx.stroke(); }
      continue;
    }
    if (!c0) continue;
    const fog = fogAt(c0.z); if (fog <= 0) continue;
    // cube frame oriented to velocity
    const R = swarm.cubeR, f = norm(a.v);
    let right = cross([0, 1, 0], f); if (Math.hypot(right[0], right[1], right[2]) < 1e-4) right = [1, 0, 0]; right = norm(right);
    const up = cross(f, right);
    const corners = [];
    for (let b = 0; b < 8; b++) { const sx = sgn(b & 1), sy = sgn(b & 2), sz = sgn(b & 4);
      corners.push(proj([a.p[0] + R * (sx * right[0] + sy * up[0] + sz * f[0]),
                          a.p[1] + R * (sx * right[1] + sy * up[1] + sz * f[1]),
                          a.p[2] + R * (sx * right[2] + sy * up[2] + sz * f[2])])); }
    ctx.strokeStyle = a.color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.95 * fog;
    for (let b = 0; b < 8; b++) for (const bit of [1, 2, 4]) { const d = b ^ bit; if (d > b && corners[b] && corners[d]) { ctx.beginPath(); ctx.moveTo(corners[b].x, corners[b].y); ctx.lineTo(corners[d].x, corners[d].y); ctx.stroke(); } }
    // core dot + glow so a ship reads at distance
    const cr = Math.max(1.5, R * 0.25 * focal / c0.z);
    const g = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, cr * 2.2);
    g.addColorStop(0, a.color); g.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.6 * fog; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr * 2.2, 0, 7); ctx.fill();
    ctx.globalAlpha = fog; ctx.fillStyle = a.color; ctx.beginPath(); ctx.arc(c0.x, c0.y, cr, 0, 7); ctx.fill();
    // BLOOM state: a pulsing ring (the ship is solving/inspecting the grid before it picks a hyperlane)
    if (a.state === 'bloom') { const ph = 0.5 + 0.5 * Math.sin(a.pulse * 9); const pr = (swarm.cubeR + 70 * ph) * focal / c0.z; ctx.globalAlpha = 0.5 * fog * (1 - ph * 0.6); ctx.strokeStyle = a.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c0.x, c0.y, Math.max(2, pr), 0, 7); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

let cv, ctx, hud, cosmos, pool, cam, webCanvas = null, webRenderer = null, webRouteGeneration = 0;
let webZoneAdded = [], webZoneRemoved = [], keys = {}, W = 0, H = 0, cx = 0, cy = 0, focal = 800, last = 0, started = false, bound = false;
let hbLast = 0, hbPlans = 0, hbShards = 0, hbSolved = 0;   // per-second solve-progress heartbeat
// Picking state. Cursor is tracked in CSS px (canvas-relative for hit-tests, client for the tooltip).
// `hover` is resolved each frame from what's actually drawn under the cursor; `selected` is pinned on
// click and drives the detail panel until the next click. Node identity = `${grid}:${systemIndex}`.
let tipEl = null, detailEl = null, indexKeys = null;
// Codex index columns kept for the network web: grid[] and mtag[] parallel to keys[], mtags[] the tag table.
// mtagGrids inverts them once on load: motherTag -> sorted unique member grids.
let indexGrid = null, indexMtag = null, mtagNames = null, mtagGrids = null;
let mouseX = -1, mouseY = -1, mClientX = 0, mClientY = 0;
let hover = null, selected = null;
// Cosmos-audio cockpit: the lead voice currently sounding (node's own tuning, from cosmos-audio.deriveVoice)
// + the DOM refs for the collapsible #lrc-div cockpit (Linear Plot + transport strip). `leadVoice.node.grid`
// is the star whose live screen projection drives spatialization each frame (see the `loop()` proj block).
let leadVoice = null, muted = false;
let lrcDivEl = null, lrcHeadEl = null, cockpitPlotEl = null, cockpitPlotCtx = null;
let muteBtnEl = null, tempoSliderEl = null, tempoReadoutEl = null, chordReadoutEl = null, audioModeEl = null;
let tuningSliderEl = null, tuningReadoutEl = null;
let scaledSpeedEl = null, scaledReadoutEl = null, cycleSliderEl = null, cycleReadoutEl = null;
let fullQualityEl = null, qualityReadoutEl = null;
let modulationEl = null, modulationReadoutEl = null;
// Cardinality band filter: only nodes with cardinality in [cardLo, cardHi] render + hit-test (isolate radial
// shells; makes monster clouds parseable). Elements + a change-guard so the DOM is only touched when needed.
// The band targets ONLY the currently-focused bloom (cosmos.focusGrid); other blooms render in full. filterGrid
// tracks which bloom the sliders currently represent, so switching focus resets the band to that bloom's range.
let loEl = null, hiEl = null, readoutEl = null, filterEl = null, fillEl = null, bodyEl = null, controlsEl = null, liveEl = null, helpPanelEl = null, filterShown = false, filterMax = 0, filterGrid = null;
let cardLo = 1, cardHi = 999;
const cardVisible = c => c >= cardLo && c <= cardHi;
// The focused bloom is fetched SHARD-BY-SHARD (same sharding as the abundance solve), so it streams in and
// never blocks a worker on a whole hyper-abundant grid. Cache entry: { systems (grows), cmin, plan, next }.
const bloomCache = new Map();   // grid -> entry | null (no shards → no bloom)
const bloomPlanning = new Set();// focused grids whose shard-plan fetch is in flight (planned here if the
                                //   runtime hasn't yet — so an unsolved star still blooms the moment it's clicked)
let   bloomInFlight = 0;        // concurrent bloom-shard fetches across ALL bloomed grids (≤ FOCUS_FETCH_CONC)
// EVERY star the player clicks blooms and PERSISTS (a trail of open stars); right-click a bloom collapses it.
const bloomed = new Set();      // grids currently bloomed & rendered (cleared per-grid on right-click / evict)

// Ensure a bloomed grid has a shard plan to stream. If the zone was already planned/solved reuse z.plan;
// otherwise dispatch a plan op ourselves (once) so an unsolved star still blooms the moment it's clicked.
// tooLarge / empty grids cache `null` → no bloom.
function ensureFocusBloom(z) {
  if (!z || bloomCache.has(z.grid)) return;
  if (z.plan) { bloomCache.set(z.grid, z.plan.length ? { systems: [], cmin: Infinity, cmax: 0, plan: z.plan, next: 0 } : null); return; }
  const g = z.grid;
  if (bloomPlanning.has(g)) return;
  bloomPlanning.add(g);
  pool.dispatch({ op: 'plan', grid: g, force: true })   // bloom is user-initiated → bypass the monster cost gate
    .then(r => { bloomPlanning.delete(g); bloomCache.set(g, (r && r.shards && r.shards.length) ? { systems: [], cmin: Infinity, cmax: 0, plan: r.shards, next: 0 } : null); })
    .catch(() => { bloomPlanning.delete(g); bloomCache.set(g, null); });
}
// Pump the bloomed grids' clouds with a SHARED budget (≤ FOCUS_FETCH_CONC shards in flight total). Set
// insertion order = oldest first; the already-streamed ones skip instantly so the budget flows to the newest
// unfinished bloom. Never caps — plan length bounds each cloud, so the whole thing lands.
function pumpBlooms() {
  for (const g of bloomed) {
    if (bloomInFlight >= FOCUS_FETCH_CONC) break;
    const e = bloomCache.get(g); if (!e) continue;
    while (bloomInFlight < FOCUS_FETCH_CONC && e.next < e.plan.length) {
      const A = e.plan[e.next++]; bloomInFlight++;
      pool.dispatch({ op: 'bloomShard', grid: g, A })
        .then(r => { bloomInFlight--; if (r && r.systems) for (const s of r.systems) { e.systems.push(s); if (s.c < e.cmin) e.cmin = s.c; if (s.c > e.cmax) e.cmax = s.c; } })
        .catch(() => { bloomInFlight--; });
    }
  }
}

// Agent bloom: the real "bloom a grid" a ship performs — plan it, then pull one shard's tuning systems from
// the worker pool (so a ship selects a REAL rhythm). Concurrency-gated so ships don't starve the camera's
// own solving; returns null when busy/empty and the ship retries.
let agentBloomN = 0;
const AGENT_BLOOM_CONC = 2;
function agentBloom(grid) {
  if (agentBloomN >= AGENT_BLOOM_CONC) return Promise.resolve(null);
  agentBloomN++;
  return pool.dispatch({ op: 'plan', grid, force: true })
    .then(r => (r && r.shards && r.shards.length) ? pool.dispatch({ op: 'bloomShard', grid, A: r.shards[Math.floor(r.shards.length * 0.6)] }) : null)   // upper-mid shard: rich systems, bounded cost
    .then(s => { agentBloomN--; return (s && s.systems && s.systems.length) ? s.systems : null; })
    .catch(() => { agentBloomN--; return null; });
}

export function ensureFlight(canvas, hudEl) {
  cv = canvas; ctx = cv.getContext('2d'); hud = hudEl;
  if (started) return;   // already flying (entering while active is a no-op)
  started = true;
  // ── ONE-TIME wiring: DOM refs + panel/filter listeners + controls + the ~12MB codex index. Guarded by
  //    `bound` so an exit→re-enter cycle (stopFlight then enterCosmos again) never double-binds. The overlay
  //    DOM + these listeners persist across sessions; only the engine (pool/cosmos) is rebuilt per entry.
  if (!bound) {
    bound = true;
    tipEl = document.getElementById('tooltip'); detailEl = document.getElementById('flight-detail');
    bodyEl = document.getElementById('flight-detail-body');
    filterEl = document.getElementById('flight-filter'); loEl = document.getElementById('card-lo');
    hiEl = document.getElementById('card-hi'); readoutEl = document.getElementById('card-readout');
    fillEl = document.getElementById('card-fill');
    controlsEl = document.getElementById('cosmos-help-controls'); liveEl = document.getElementById('cosmos-help-live');
    helpPanelEl = document.getElementById('cosmos-help-panel');
    const helpBtn = document.getElementById('cosmos-help-btn');
    if (helpBtn && helpPanelEl) helpBtn.addEventListener('click', () => helpPanelEl.classList.toggle('open'));
    if (detailEl) detailEl.addEventListener('click', e => {
      const home = e.target.closest && e.target.closest('.web-home-btn'); if (home) { beginWebReturn(home.dataset.id); return; }
      const cancel = e.target.closest && e.target.closest('.web-cancel-btn'); if (cancel) { cancelWebReturn(); return; }
      const ap = e.target.closest && e.target.closest('.apply-btn'); if (ap) { applyToEngine(selected); return; }
      const ov = e.target.closest && e.target.closest('.ov-btn'); if (ov) { overrideSolve(+ov.dataset.g); return; }
      const wb = e.target.closest && e.target.closest('.web-btn'); if (wb) { toggleWeb(wb.dataset.tag, +wb.dataset.g); showDetail(selected); return; }
      const mn = e.target.closest && e.target.closest('.mn-btn'); if (mn) { toggleMNWeb(mn.dataset.id, +mn.dataset.base, +mn.dataset.g); showDetail(selected); }
    });
    // cardinality WINDOW: two thumbs on one thin rail — drag either end; the fill bar tracks the [lo,hi] window
    const onFilter = () => { cardLo = Math.min(+loEl.value, +hiEl.value); cardHi = Math.max(+loEl.value, +hiEl.value); updateFillBar(); };
    const blur = e => e.target.blur();   // hand focus back to the canvas so WASD/arrows fly again without a re-click
    for (const el of [loEl, hiEl]) if (el) { el.addEventListener('input', onFilter); el.addEventListener('pointerup', blur); }
    // charted lookup: the same codex key index the Oracle/Bloom tab uses. Fire-and-forget — nodes read
    // as "uncharted" until it lands, then flip to charted on the next frame. Module-relative URL so it
    // resolves against cosmos/ regardless of the host document (index.html at site root).
    fetch(new URL('./data/oracle-index.json', import.meta.url)).then(r => r.json()).then(j => {
      indexKeys = j.keys; indexGrid = j.grid; indexMtag = j.mtag; mtagNames = j.mtags;
      // invert mtag -> member grids (skip the empty "" tag; dedupe + sort so the kNN build is stable)
      const acc = new Map();
      for (let i = 0; i < indexMtag.length; i++) {
        const t = mtagNames[indexMtag[i]]; if (!t) continue;
        let a = acc.get(t); if (!a) { a = []; acc.set(t, a); } a.push(indexGrid[i]);
      }
      mtagGrids = new Map();
      for (const [t, a] of acc) mtagGrids.set(t, [...new Set(a)].sort((x, y) => x - y));
    }).catch(() => {});
    // ── cosmos-audio cockpit: #lrc-div owns its own interaction (single-click/`+` → toggle cockpit,
    //    double-click → exit). Wired here (not flight-boot.js) so it shares the `bound` no-double-bind guard.
    lrcDivEl = document.getElementById('lrc-div'); lrcHeadEl = document.getElementById('lrc-head');
    cockpitPlotEl = document.getElementById('lrc-plot'); cockpitPlotCtx = cockpitPlotEl && cockpitPlotEl.getContext('2d');
    muteBtnEl = document.getElementById('lrc-mute-btn');
    tempoSliderEl = document.getElementById('lrc-tempo-slider'); tempoReadoutEl = document.getElementById('lrc-tempo-readout');
    chordReadoutEl = document.getElementById('lrc-chord-readout');
    audioModeEl = document.getElementById('lrc-audio-mode');
    tuningSliderEl = document.getElementById('lrc-tuning-slider');
    tuningReadoutEl = document.getElementById('lrc-tuning-readout');
    scaledSpeedEl = document.getElementById('lrc-scaled-speed'); scaledReadoutEl = document.getElementById('lrc-scaled-readout');
    cycleSliderEl = document.getElementById('lrc-cycle-slider'); cycleReadoutEl = document.getElementById('lrc-cycle-readout');
    fullQualityEl = document.getElementById('lrc-full-quality'); qualityReadoutEl = document.getElementById('lrc-quality-readout');
    modulationEl = document.getElementById('lrc-modulation'); modulationReadoutEl = document.getElementById('lrc-modulation-readout');
    if (lrcHeadEl) {
      let clickTimer = null;   // debounce: a dblclick fires two clicks — let the pending single-click resolve
      lrcHeadEl.addEventListener('click', () => {                 // toggles cockpit; ignored while a dblclick is landing
        if (clickTimer) return;
        clickTimer = setTimeout(() => { clickTimer = null; lrcDivEl.classList.toggle('open'); }, 220);
      });
      lrcHeadEl.addEventListener('dblclick', () => { clearTimeout(clickTimer); clickTimer = null; window.exitCosmos(); });
    }
    if (muteBtnEl) muteBtnEl.addEventListener('click', toggleMute);
    if (tempoSliderEl) tempoSliderEl.addEventListener('input', () => {
      const rate = +tempoSliderEl.value; setTickRate(rate, true);   // fromUser: scaled mode restores this on exit
      if (tempoReadoutEl) tempoReadoutEl.textContent = rate + '/s';
    });
    if (scaledSpeedEl) scaledSpeedEl.addEventListener('change', applySpeedControls);
    if (cycleSliderEl) cycleSliderEl.addEventListener('input', applySpeedControls);
    if (fullQualityEl) fullQualityEl.addEventListener('change', () => {
      const on = setHoldForFullQuality(fullQualityEl.checked);
      if (qualityReadoutEl) qualityReadoutEl.textContent = on ? 'hold' : 'off';
    });
    if (modulationEl) modulationEl.addEventListener('change', () => {
      setModulation(modulationEl.checked);
      drawModulationReadout();
    });
    if (audioModeEl) audioModeEl.addEventListener('change', () => changeAudioMode(audioModeEl.value));
    if (tuningSliderEl) tuningSliderEl.addEventListener('input', () => {
      const strength = setTuningStrength(tuningSliderEl.value);
      if (tuningReadoutEl) tuningReadoutEl.textContent = strength.toFixed(2).replace(/0$/, '') + ' st';
    });
    // Full Sky debug overlay: seeded once from ?skyDebug=1 (so a bookmarked link opens straight into
    // it); the C key (bindControls, below) is the primary toggle from here on. Seeding this per-session
    // instead would stomp a manual C-toggle every time you exit/re-enter cosmos.
    skyDebugOn = new URLSearchParams(location.search).get('skyDebug') === '1';
    bindControls();
  }
  // ── PER-SESSION engine: fresh worker pool + cosmos on every entry; stopFlight() tears both down on exit ──
  const poolSize = Math.max(2, Math.min(POOL_MAX, (navigator.hardwareConcurrency || 4) - 2));
  FOCUS_FETCH_CONC = Math.max(2, poolSize - 1);   // divert most of the pool to the focused cloud, keep 1 ambient
  // Module-relative Worker URL: `new Worker(relative)` resolves against the DOCUMENT (index.html at root),
  // which breaks under the full-swallow — resolve against this module so it lands on cosmos/cosmos/. The
  // ?v= busts the hard Web-Worker cache — bump it AND the worker's ../grid-core.js?v= on worker edits.
  pool = new Pool(new URL('./cosmos/abundance-worker.js?v=5', import.meta.url), poolSize);
  rowCompiler = new ProgramWorkerPool(new URL('./cosmos/cull2-program-worker.js?v=1', import.meta.url), { size: ROW_COMPILE_WORKERS });
  rowGeneration = 0; rowSelectionKey = ''; rowActiveIds = new Set(); rowPrewarmIds = new Set();
  settleSinceSecond = null; lastRootResolveSecond = -Infinity; rootGeographyEpoch = 0; rootPolicyWasSettled = false;
  if (audioModeEl) audioModeEl.value = AUDIO_MODES.AMBIENT_CHORDS;
  if (tuningSliderEl) setTuningStrength(tuningSliderEl.value);
  setTickRate(tempoSliderEl ? +tempoSliderEl.value : 10, true);
  if (fullQualityEl) setHoldForFullQuality(fullQualityEl.checked);
  if (modulationEl) setModulation(modulationEl.checked);
  applySpeedControls();
  drawModulationReadout();
  changeAudioMode(AUDIO_MODES.AMBIENT_CHORDS);
  // Placement: the owner prefers the 3D CUBE, so hilbert is the default here; ?placement=spine flies the 1D spine.
  placement = new URLSearchParams(location.search).get('placement') === 'spine' ? 'spine' : 'hilbert';
  setPlacement(placement);
  // A transferred canvas cannot be transferred a second time after exit/re-entry, so each flight session
  // replaces the inert overlay element with a fresh identical canvas before starting its Web worker.
  const previousWebCanvas = document.getElementById('cosmos-web-canvas');
  webCanvas = previousWebCanvas.cloneNode(false); previousWebCanvas.replaceWith(webCanvas);
  if (!webCanvas.transferControlToOffscreen) throw new Error('Cosmos Webs require OffscreenCanvas support.');
  webZoneAdded = []; webZoneRemoved = []; webRouteGeneration++;
  webRenderer = new WebRenderer(new URL('./cosmos/web-render-worker.js?v=1', import.meta.url), webCanvas, placement, message => {
    hoverWeb = message.hover || null;
    for (const [id, visibleNodes, localNodes] of message.counts || []) {
      const web = activeWebs.get(id); if (web) { web.visibleNodes = visibleNodes; web.localNodes = localNodes; }
    }
    if (message.error) console.warn('[cosmos Web frame]', message.error);
  });
  if (skyDebugEl) skyDebugEl.style.display = skyDebugOn ? 'block' : 'none';
  if (controlsEl) {
    const rows = [['WASD / QE', 'move'], ['space', 'boost'], ['arrows', 'steer'], ['scroll', 'dolly'],
                  ['click star', 'bloom'], ['click node', 'inspect / apply'], ['click Web', 'inspect / return'],
                  ['Esc', 'cancel return ride'], ['right-click', 'collapse'], ['1–0', 'toggle webs']];
    controlsEl.innerHTML = rows.map(([k, v]) => `<div class="help-kv"><span>${k}</span><b>${v}</b></div>`).join('') +
      `<div class="help-note">${placement === 'hilbert' ? 'cube' : 'spine'} placement</div>`;
  }
  BLOOM_MAX_R = placement === 'hilbert' ? BLOOM_MAX_R_FRAC * CELL : Infinity;   // keep clouds inside their cell
  const zoneHooks = { onZoneAdded: grid => webZoneAdded.push(grid), onZoneRemoved: grid => webZoneRemoved.push(grid) };
  if (placement === 'hilbert') {
    // 3D-proximity frontier: spawn/evict by cell distance; grids rest at their own cells (no puffs).
    FOG_NEAR = HIL_SPAWN * CELL * 0.4; FOG_FAR = HIL_EVICT * CELL;   // fade right up to the evict shell
    cosmos = new Cosmos({ reachScale: 0.15, evictRadius: HIL_EVICT, poolSize, isValid, puffs: false, compete: false, ...zoneHooks,
      dispatch: g => pool.dispatch(g),
      neighbors: cam => neighborGrids(hilbertDecode(cam), Math.max(2, Math.round(hilSpawn))),
      cellDist: (g, cam) => { const a = hilbertDecode(g), b = hilbertDecode(cam); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); } });
  } else {
    // evict window ≈ what the fog lets you see (FOG_FAR/SPACING) plus margin. spawn ~80% (hysteresis).
    FOG_NEAR = 3500; FOG_FAR = 13000;
    cosmos = new Cosmos({ reachScale: 0.15, spawnRadius: 1100, evictRadius: 1400, poolSize, isValid, dispatch: g => pool.dispatch(g), ...zoneHooks });
  }
  // agents deferred (POC): no ships — `swarm` stays null and all swarm paths guard on it.
  // yaw = π/2 points forward (+X); anchor = frontier center + render origin, off = world offset from it
  cam = { anchor: 2640, off: [0, 0, 0], yaw: Math.PI / 2, pitch: 0.05, speed: 180 };
  cosmos.setCamera(cam.anchor);
  resize();
  last = performance.now();
  requestAnimationFrame(loop);
}

// TEARDOWN: exit flight completely. Terminates every worker (zero background compute once the engine UI is
// back), stops the rAF loop (the `if (!started) return` guard at the top of loop() breaks the chain), and
// clears transient flight state so a later re-entry starts clean. The one-time listeners + codex index are
// intentionally kept (see `bound`) so re-entering is cheap and never double-binds.
export function stopFlight() {
  if (!started && !pool) return;
  started = false;
  if (pool) { for (const w of pool.all()) w.terminate(); pool = null; }   // kill the whole pool — no lingering solve
  if (rowCompiler) { rowCompiler.terminate(); rowCompiler = null; }
  if (webRenderer) { webRenderer.terminate(); webRenderer = null; }
  webRouteGeneration++; webZoneAdded = []; webZoneRemoved = [];
  cosmos = null;
  bloomed.clear(); bloomCache.clear(); bloomPlanning.clear(); bloomInFlight = 0;
  activeWebs.clear(); webColorN = 0;
  returnRide = null; selected = null; hover = null; hoverWeb = null;
  leadVoice = null; stopAudio(); audibleIds = new Set(); rowActiveIds = new Set(); rowPrewarmIds = new Set();   // kill the cosmos-audio transport, mirroring the worker teardown
  if (skyDebugEl) skyDebugEl.style.display = 'none';   // dev overlay — hide, don't destroy (cheap to reuse on re-entry)
  if (ctx && cv) { const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); }
}

export function warpTo(G) {
  if (!cosmos) return;
  G = Math.max(2, Math.floor(G) || 2);
  if (placement === 'hilbert') G = Math.min(INDEX_COUNT - 1, G);
  if (!isValid(G)) G = G < INDEX_COUNT - 1 ? G + 1 : G - 1;
  cam.anchor = G;
  cam.off = [0, 0, 0];
  cosmos.setCamera(cam.anchor);
}

function camBasis() {
  const d = norm([Math.cos(cam.pitch) * Math.sin(cam.yaw), Math.sin(cam.pitch), Math.cos(cam.pitch) * Math.cos(cam.yaw)]);
  const r = norm(cross([0, 1, 0], d));
  const u = cross(d, r);
  return { d, r, u };
}

// Move the camera in world space, then RE-ANCHOR to the nearest lattice grid so `off` stays small
// (keeps the floating-origin precise) and the frontier follows wherever we fly. Re-anchoring never
// moves the camera: the offset is rebased by the exact integer cell delta.
function translateCam(v) {
  if (placement === 'hilbert') {
    const before = cameraAbsolute();
    const frame = rebaseHilbertCamera([before[0] + v[0], before[1] + v[1], before[2] + v[2]], HIL_CAMERA_RADIUS);
    cam.anchor = frame.anchor;
    cam.off = frame.off;
    cosmos.setCamera(cam.anchor);
    return frame.position.map((value, axis) => value - before[axis]);
  } else {
    cam.off[0] += v[0]; cam.off[1] += v[1]; cam.off[2] += v[2];
    const k = Math.round(cam.off[0] / SPACING);   // only the along-axis re-anchors; Y/Z stay free
    if (k) { const na = Math.max(2, cam.anchor + k); cam.off[0] -= (na - cam.anchor) * SPACING; cam.anchor = na; }
  }
  cosmos.setCamera(cam.anchor);
  return v;
}

function stepControls(dt, allowTranslation = true) {
  // During a return ride, arrow look is measured in the moving path frame. The pitch restriction
  // therefore remains ±80° around the strand even when its tangent points vertically or loops past
  // world-up; converting the resulting direction back to yaw/pitch does not impose a second clamp.
  if (returnRide) {
    if (keys['arrowleft'])  returnRide.lookYaw   -= TURN * dt;
    if (keys['arrowright']) returnRide.lookYaw   += TURN * dt;
    if (keys['arrowup'])    returnRide.lookPitch += TURN * dt;
    if (keys['arrowdown'])  returnRide.lookPitch -= TURN * dt;
    returnRide.lookPitch = Math.max(-1.4, Math.min(1.4, returnRide.lookPitch));
    applyWebReturnLook(returnRide);
  } else {
    // Free-flight arrows retain their original world-relative yaw/pitch behavior.
    if (keys['arrowleft'])  cam.yaw   -= TURN * dt;
    if (keys['arrowright']) cam.yaw   += TURN * dt;
    if (keys['arrowup'])    cam.pitch += TURN * dt;
    if (keys['arrowdown'])  cam.pitch -= TURN * dt;
    cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch));
  }
  if (!allowTranslation) return;

  // WASD/QE translate along the camera basis; Space boosts speed
  const { d, r, u } = camBasis();
  let mv = [0, 0, 0];
  const step = cam.speed * (keys[' '] ? BOOST : 1) * dt;
  if (keys['w']) mv = [mv[0] + d[0] * step, mv[1] + d[1] * step, mv[2] + d[2] * step];
  if (keys['s']) mv = [mv[0] - d[0] * step, mv[1] - d[1] * step, mv[2] - d[2] * step];
  if (keys['d']) mv = [mv[0] + r[0] * step, mv[1] + r[1] * step, mv[2] + r[2] * step];
  if (keys['a']) mv = [mv[0] - r[0] * step, mv[1] - r[1] * step, mv[2] - r[2] * step];
  if (keys['e']) mv = [mv[0] + u[0] * step, mv[1] + u[1] * step, mv[2] + u[2] * step];
  if (keys['q']) mv = [mv[0] - u[0] * step, mv[1] - u[1] * step, mv[2] - u[2] * step];
  // Sky Root B3: actual world-space translation speed this frame (turning alone doesn't count — the
  // root gather is position-only, "must not change when the player turns their head").
  const actualMove = translateCam(mv);
  camSpeed = dt > 0 ? Math.hypot(actualMove[0], actualMove[1], actualMove[2]) / dt : 0;
}

// world-relative (camera at origin, integer-spine) → view space (+z forward) → screen
function toScreen(rp, basis) {
  const vx = dot(rp, basis.r), vy = dot(rp, basis.u), vz = dot(rp, basis.d);
  if (vz <= NEAR) return null;
  return { x: cx + vx * focal / vz, y: cy - vy * focal / vz, z: vz };
}

// Render only the camera-local tiles of nearby faces. Collision and visuals share
// hilbert-boundary.js, so the glow always resolves onto the plane that actually stops the camera.
function drawHilbertBoundaryWalls(basis) {
  if (placement !== 'hilbert') return;
  const camera = cameraAbsolute(), reveal = HIL_WALL_REVEAL_CELLS * CELL;
  const walls = nearbyHilbertWalls(camera, reveal);
  if (!walls.length) return;
  const colors = ['110,203,255', '197,139,255', '255,110,199'];
  const parallelAxes = axis => axis === 0 ? [1, 2] : (axis === 1 ? [0, 2] : [0, 1]);
  const projected = absolute => toScreen(absolute.map((value, axis) => value - camera[axis]), basis);
  const smooth = value => value * value * (3 - 2 * value);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineJoin = 'round';
  for (const wall of walls.sort((a, b) => b.distance - a.distance)) {
    const [a, b] = parallelAxes(wall.axis);
    const centreA = Math.max(0, Math.min(SIDE - 1, Math.round(camera[a] / CELL)));
    const centreB = Math.max(0, Math.min(SIDE - 1, Math.round(camera[b] / CELL)));
    const a0 = Math.max(0, centreA - HIL_WALL_PATCH_CELLS), a1 = Math.min(SIDE - 1, centreA + HIL_WALL_PATCH_CELLS);
    const b0 = Math.max(0, centreB - HIL_WALL_PATCH_CELLS), b1 = Math.min(SIDE - 1, centreB + HIL_WALL_PATCH_CELLS);
    const proximity = smooth(Math.max(0, 1 - wall.distance / reveal));
    const incidence = Math.abs(basis.d[wall.axis]);
    const color = colors[wall.axis];

    for (let ia = a0; ia <= a1; ia++) for (let ib = b0; ib <= b1; ib++) {
      const corners = [[ia - 0.5, ib - 0.5], [ia + 0.5, ib - 0.5], [ia + 0.5, ib + 0.5], [ia - 0.5, ib + 0.5]].map(([ca, cb]) => {
        const point = [0, 0, 0]; point[wall.axis] = wall.plane; point[a] = ca * CELL; point[b] = cb * CELL;
        return projected(point);
      });
      if (corners.some(point => !point)) continue;
      const da = ia * CELL - camera[a], db = ib * CELL - camera[b];
      const radial = Math.max(0, 1 - Math.hypot(da, db) / ((HIL_WALL_PATCH_CELLS + 0.75) * CELL));
      const fade = smooth(radial);
      if (fade <= 0) continue;
      ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.globalAlpha = (0.012 + proximity * 0.075) * fade * (0.45 + incidence * 0.55);
      ctx.fillStyle = `rgb(${color})`; ctx.fill();
      ctx.globalAlpha = (0.045 + proximity * 0.32) * fade * (0.35 + incidence * 0.65);
      ctx.strokeStyle = `rgb(${color})`; ctx.lineWidth = 0.55 + proximity * 0.8; ctx.stroke();
    }

    // Close-range energy bloom at the point nearest the camera. It keeps a wall readable when its
    // perspective grid has expanded beyond the viewport, while still disappearing when looking away.
    const nearest = [...camera]; nearest[wall.axis] = wall.plane;
    const impact = projected(nearest);
    const contact = smooth(Math.max(0, 1 - wall.distance / (CELL * 1.5)));
    if (impact && contact > 0) {
      const radius = Math.max(W, H) * 0.85;
      const glow = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, radius);
      glow.addColorStop(0, `rgba(${color},${0.16 * contact})`);
      glow.addColorStop(0.35, `rgba(${color},${0.055 * contact})`);
      glow.addColorStop(1, `rgba(${color},0)`);
      ctx.globalAlpha = 1; ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}
function starColor(size) {
  const t = Math.max(0, Math.min(1, size / 5));
  if (t < 0.5) { const k = t / 0.5; return `rgb(${90 + k * 40},${110 + k * 80},${150 + k * 74})`; }   // dust: dim violet→blue
  const k = (t - 0.5) / 0.5; return `rgb(${130 + k * 125},${190 + k * 65},${224 + k * 31})`;             // sun: cyan→white
}

// cardinality offset → radial extent, with a soft knee so a few very-high-cardinality outliers don't blow
// out the bloom's footprint: linear (full BLOOM_R/step) up to BLOOM_KNEE, then BLOOM_TAIL/step beyond.
const cardExtent = d => d <= BLOOM_KNEE ? d : BLOOM_KNEE + (d - BLOOM_KNEE) * BLOOM_TAIL;
// prime factorization as a compact string, e.g. 2640 → "2^4·3·5·11" (detail panel)
function factorString(n) {
  let m = n; const parts = [];
  for (let p = 2; p * p <= m; p++) if (m % p === 0) { let e = 0; while (m % p === 0) { m /= p; e++; } parts.push(e > 1 ? `${p}^${e}` : `${p}`); }
  if (m > 1) parts.push(`${m}`);
  return parts.join('·') || `${n}`;
}
// a picking ring around a target's live screen position (selection = solid, hover = soft)
function ringAt(o, color, lw) {
  if (!o) return;
  ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(6, o.r + 5), 0, 7); ctx.stroke();
}
// position the accent fill between the two thumbs (the visible "window" of the dual-range slider)
function updateFillBar() {
  if (!fillEl || !loEl) return;
  const lo = +loEl.min, hi = +loEl.max, span = Math.max(1, hi - lo);
  const a = (Math.min(cardLo, cardHi) - lo) / span * 100, b = (Math.max(cardLo, cardHi) - lo) / span * 100;
  fillEl.style.left = a + '%'; fillEl.style.width = Math.max(0, b - a) + '%';
}
// show/size the cardinality WINDOW to the FOCUSED bloom only; the slider lives inside the grid info card,
// so it's a child of #flight-detail and only renders when that card is open (see showDetail). DOM touched on change.
function updateFilterUI() {
  if (!filterEl) return;
  const fg = cosmos.focusGrid, data = (fg != null && bloomed.has(fg)) ? bloomCache.get(fg) : null;
  const show = !!(data && data.systems.length);
  if (show !== filterShown) { filterEl.style.display = show ? 'flex' : 'none'; filterShown = show; }
  if (!show) { filterGrid = null; return; }
  const cmin = data.cmin, cmax = data.cmax;
  if (fg !== filterGrid) {                               // focus moved to a different bloom → reset window to its full range
    filterGrid = fg; filterMax = cmax;
    loEl.max = hiEl.max = cmax; loEl.value = 1; hiEl.value = cmax; cardLo = 1; cardHi = cmax;
  } else if (cmax !== filterMax) {                       // same bloom still streaming → grow the range, keep a top-parked hi at top
    const hiAtTop = +hiEl.value >= +hiEl.max;
    filterMax = cmax; loEl.max = hiEl.max = cmax;
    if (hiAtTop) { hiEl.value = cmax; cardHi = Math.max(cardLo, cmax); }
  }
  readoutEl.textContent = (cardLo <= cmin && cardHi >= cmax) ? 'all' : (cardLo === cardHi ? `${cardLo}` : `${cardLo}–${cardHi}`);
  updateFillBar();
}
// APPLY-TO-ENGINE: load a bloom node's rhythm into the live LRC engine via the same path Collections uses.
// The engine has exactly layer-a..d, so only ≤4-layer nodes are applyable; >4-layer nodes stay inspect-only
// (guarded here AND disabled in the detail panel). Apply happens under the full-swallow — the engine UI is
// hidden but its state updates, so on exit the rhythm is already loaded.
function applyToEngine(node) {
  if (!node || node.kind !== 'node' || !node.layers || node.layers.length > 4) return;
  try {
    if (window.lrcSearch && typeof window.lrcSearch.applyResult === 'function') window.lrcSearch.applyResult(node.layers);
    else if (window.lrcModule && typeof window.lrcModule.setRhythms === 'function') window.lrcModule.setRhythms(node.layers[0], node.layers[1], node.layers[2], node.layers[3]);
    else { console.warn('[cosmos] no engine apply hook (window.lrcSearch/lrcModule) found'); return; }
    node._applied = true; if (selected === node || (selected && selected.id === node.id)) showDetail(selected);   // reflect "loaded" in the panel
  } catch (err) { console.warn('[cosmos] applyResult failed', err); }
}
// override: solve a monster grid anyway (force past the cost gate) and bloom it — a few seconds of worker time
function overrideSolve(g) {
  if (!cosmos) return;
  cosmos.forceSolve(g);                                  // runtime re-plans with force → real abundance
  const z = cosmos.zones.get(g); if (z) { delete z._bloom; delete z._rowAudio; } // fresh solve/program generation
  bloomed.add(g); cosmos.setFocus(g); ensureFocusBloom(z);
  selected = { kind: 'star', grid: g }; showDetail(selected);
}
// cursor tooltip follows `hover` (a star or a bloom node), reusing the shared #tooltip element
function updateTooltip() {
  if (!tipEl) return;
  if (!hover) { tipEl.style.display = 'none'; return; }
  tipEl.style.display = 'block';
  tipEl.style.left = (mClientX + 14) + 'px'; tipEl.style.top = (mClientY + 14) + 'px';
  if (hover.kind === 'web') {
    const web = activeWebs.get(hover.webId);
    if (!web) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = `<div class="t-l" style="color:${web.color}">◈ ${web.dynamic ? web.tag.replace(/^mn:/, '') : web.tag}</div>` +
      `<div class="t-d">click to inspect · home grid ${web.homeGrid.toLocaleString()}</div>`;
  } else if (hover.kind === 'node') {
    tipEl.innerHTML = `<div class="t-l">${hover.layers ? hover.layers.join(' : ') : hover.c + '-tone'}</div>` +
      `<div class="t-d">${hover.c}-tone · fund ${hover.fund}${hover.dense ? ' · +dense' : ''} · ${hover.charted ? 'charted' : 'uncharted'}</div>`;
  } else {
    const fi = factorInfo(hover.grid), ab = hover.z ? hover.z.abundance : 0;
    tipEl.innerHTML = `<div class="t-l">grid ${hover.grid.toLocaleString()}</div>` +
      `<div class="t-d">${ab ? ab.toLocaleString() + ' systems · ' : ''}${fi.primes} primes · ${fi.divisors} divisors</div>`;
  }
}
// pinned detail panel. Stars re-read the live zone (abundance/state update as it solves); nodes are
// static so their snapshot is authoritative. Passing null hides the panel.
function showDetail(sel) {
  if (!detailEl) return;
  if (!sel) { detailEl.style.display = 'none'; return; }
  detailEl.style.display = 'block';
  const dismiss = `<div style="margin-top:8px;color:var(--dimmer);font-size:10px">click empty space to dismiss</div>`;
  if (sel.kind === 'web') {
    const web = activeWebs.get(sel.webId);
    if (!web) { detailEl.style.display = 'none'; return; }
    const homeCell = macroCell(web.homeGrid), camCell = macroCell(cam.anchor);
    const cellDistance = Math.hypot(homeCell[0] - camCell[0], homeCell[1] - camCell[1], homeCell[2] - camCell[2]);
    const riding = !!(web.routePlanning || (returnRide && returnRide.webId === web.tag));
    const title = web.dynamic ? web.tag.replace(/^mn:/, '') : `mother ${web.tag}`;
    const family = web.dynamic ? 'unbounded' : `${web.memberCount.toLocaleString()} grids`;
    const status = web.routePlanning ? 'stitching route off-thread' : riding
      ? `${Math.round((web.rideProgress || 0) * 100)}% · ${returnRide.duration.toFixed(0)}s bounded ride`
      : (web.rideStatus || 'ready');
    const travelButton = riding
      ? `<button class="web-cancel-btn" style="width:100%;margin-top:10px;background:rgba(255,255,255,.05);border:1px solid ${web.color};color:${web.color};font-family:var(--sans);font-size:11px;padding:7px;border-radius:var(--border-radius);cursor:pointer">cancel return ride</button>`
      : `<button class="web-home-btn" data-id="${web.tag}" style="width:100%;margin-top:10px;background:${web.color}22;border:1px solid ${web.color};color:${web.color};font-family:var(--sans);font-weight:600;font-size:11px;padding:8px;border-radius:var(--border-radius);cursor:pointer">Return Home · grid ${web.homeGrid.toLocaleString()}</button>`;
    bodyEl.innerHTML =
      `<div class="big" style="color:${web.color}">◈ ${title}</div>` +
      `<div class="r"><span>network reach</span><b>${family}</b></div>` +
      `<div class="r"><span>visible nodes</span><b>${(web.visibleNodes || 0).toLocaleString()}</b></div>` +
      (web.dynamic ? `<div class="r"><span>nested-ratio base</span><b>${web.base.toLocaleString()}</b></div>` : '') +
      `<div class="r"><span>home grid</span><b>${web.homeGrid.toLocaleString()}</b></div>` +
      `<div class="r"><span>distance</span><b>${cellDistance.toFixed(1)} cells</b></div>` +
      `<div class="r"><span>travel</span><b>${status}</b></div>` +
      (web.dynamic ? `<div style="margin-top:7px;color:var(--dimmer);font-size:10px;line-height:1.45">This family is infinite. Return Home samples qualifying NR grids adaptively while the local Web rebuilds around the camera.</div>` : '') +
      travelButton + dismiss;
  } else if (sel.kind === 'node') {
    const col = sel.charted ? CHARTED : cardColor(sel.c);
    const slotLbl = w => w ? ` [${w.slot === 9 ? '0' : w.slot + 1}${w.visible === false ? ' off' : ''}]` : '';
    const tag = mtagOfKey(sel.key), members = tag && mtagGrids && mtagGrids.get(tag);
    const mw = tag && activeWebs.get(tag), on = !!mw;
    const webBtn = (members && members.length)
      ? `<button class="web-btn" data-tag="${tag}" data-g="${sel.grid}" style="width:100%;margin-top:8px;background:rgba(0,0,0,.3);border:1px solid ${on ? '#ff6ec7' : 'var(--line)'};color:${on ? '#ff6ec7' : 'var(--dim)'};font-family:var(--sans);font-size:11px;padding:6px;border-radius:var(--border-radius);cursor:pointer">◈ ${on ? 'clear' : 'trace'} mother-scale network ${tag} · ${members.length} grids${slotLbl(mw)}</button>`
      : '';
    // MN motifs scanned live from the node's layer tuple (any cardinality): triples first (richer / rarer
    // by larger base-LCM), then Root Doubles. Each chip toggles its "hyperlane" family web.
    const motifs = sel.layers ? [...rhythmTriples(sel.layers).sort((a, b) => b.base - a.base),
                                 ...rhythmDoubles(sel.layers).sort((a, b) => b.base - a.base)].slice(0, MN_CHIP_MAX) : [];
    const typeCol = { CT: '#8dff6e', IT: '#6ecbff', RDCP: '#ffd86e', RD: '#c58bff' };
    const chip = m => { const id = 'mn:' + m.key, mnw = activeWebs.get(id), mon = !!mnw, c = typeCol[m.kind] || 'var(--dim)';
      return `<button class="mn-btn" data-id="${id}" data-base="${m.base}" data-g="${sel.grid}" title="${m.kind} · base ${m.base} → family = multiples of ${m.base}" style="display:inline-block;margin:3px 3px 0 0;padding:3px 7px;background:${mon ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.3)'};border:1px solid ${mon ? c : 'var(--line)'};color:${c};font-family:var(--mono);font-size:10px;border-radius:5px;cursor:pointer">${m.kind === 'RD' ? 'RD ' : ''}${m.key.replace(/^(CT|IT|RDCP):/, '$1 ')}${slotLbl(mnw)}</button>`; };
    const mnBlock = motifs.length
      ? `<div style="margin-top:8px;color:var(--dimmer);font-size:10px">master-network hyperlanes</div><div>${motifs.map(chip).join('')}</div>`
      : '';
    // apply-to-engine affordance: ≤4-layer rhythms load into the LRC engine; >4-layer nodes are inspect-only
    const applyBlock = sel.layers
      ? (sel.layers.length <= 4
          ? `<button class="apply-btn" style="width:100%;margin-top:8px;background:${sel._applied ? 'rgba(0,255,136,.18)' : 'rgba(0,255,136,.08)'};border:1px solid var(--known);color:var(--known);font-family:var(--sans);font-weight:500;font-size:11px;padding:7px;border-radius:var(--border-radius);cursor:pointer">${sel._applied ? '✓ loaded into engine' : '▶ load into engine'}</button>`
          : `<div style="margin-top:8px;padding:7px;border:1px dashed var(--dimmer);border-radius:6px;color:var(--dimmer);font-size:10px;text-align:center">${sel.layers.length}+ layers — not playable in engine</div>`)
      : '';
    bodyEl.innerHTML =
      `<div class="big" style="color:${col}">${sel.layers ? sel.layers.join(' : ') : sel.c + '-tone'}</div>` +
      `<div class="r"><span>cardinality</span><b>${sel.c}-tone</b></div>` +
      `<div class="r"><span>fundamental</span><b>${sel.fund}</b></div>` +
      `<div class="r"><span>grid</span><b>${sel.grid.toLocaleString()}</b></div>` +
      `<div class="r"><span>keep-two</span><b>${sel.dense ? 'paired (+dense)' : 'solo'}</b></div>` +
      `<div class="r"><span>codex</span><b>${sel.charted ? 'charted' : 'uncharted'}</b></div>` +
      (tag ? `<div class="r"><span>mother scale</span><b>${tag}</b></div>` : '') +
      (sel.rs ? `<div style="margin-top:8px;color:var(--dim);line-height:1.5">${sel.rs}</div>` : '') + applyBlock + webBtn + mnBlock + dismiss;
  } else {
    const z = cosmos.zones.get(sel.grid), fi = factorInfo(sel.grid);
    if (z && z.monster) {              // combinatorial black hole — identified, solve gated behind an override
      bodyEl.innerHTML =
        `<div class="big" style="color:#ff7869">grid ${sel.grid.toLocaleString()}</div>` +
        `<div class="r"><span>factors</span><b>${factorString(sel.grid)}</b></div>` +
        `<div class="r"><span>divisors</span><b>${z.divisors ?? fi.divisors}</b></div>` +
        `<div class="r"><span>class</span><b style="color:#ff7869">combinatorial monster</b></div>` +
        `<div style="margin:6px 0;color:var(--dimmer);font-size:10px;line-height:1.5">expensive to solve live — gated so the field keeps flowing. Solving may take a few seconds.</div>` +
        `<button class="ov-btn" data-g="${sel.grid}" style="width:100%;margin-top:2px;background:#3a1c1a;border:1px solid #ff7869;color:#ff7869;font-family:var(--mono);font-size:11px;padding:6px;border-radius:6px;cursor:pointer">◉ solve anyway</button>` + dismiss;
      return;
    }
    if (z && z.unsolvable) {           // beyond the live solve cap — be honest, don't imply "1 kept"
      bodyEl.innerHTML =
        `<div class="big">grid ${sel.grid.toLocaleString()}</div>` +
        `<div class="r"><span>factors</span><b>${factorString(sel.grid)}</b></div>` +
        `<div class="r"><span>primes · divisors</span><b>${fi.primes} · ${fi.divisors}</b></div>` +
        `<div class="r"><span>abundance</span><b style="color:var(--dimmer)">beyond solve cap</b></div>` +
        `<div style="margin-top:8px;color:var(--dimmer);font-size:10px;line-height:1.5">uncharted frontier — too large to solve live (grid &gt; cap)</div>` + dismiss;
      return;
    }
    const ab = z ? z.abundance : (sel.z ? sel.z.abundance : 0), state = z ? z.state : 'evicted';
    const sun = z && z.parentGrid !== z.grid ? z.parentGrid.toLocaleString() : '—';
    bodyEl.innerHTML =
      `<div class="big">grid ${sel.grid.toLocaleString()}</div>` +
      `<div class="r"><span>abundance</span><b>${(ab || 0).toLocaleString()} kept</b></div>` +
      `<div class="r"><span>factors</span><b>${factorString(sel.grid)}</b></div>` +
      `<div class="r"><span>primes · divisors</span><b>${fi.primes} · ${fi.divisors}</b></div>` +
      (placement !== 'hilbert' ? `<div class="r"><span>district sun</span><b>${sun}</b></div>` : '') +
      `<div class="r"><span>state</span><b>${state}</b></div>` + dismiss;
  }
}

// One handler for both speed controls: the mode and the target cycle are a single decision, and the
// tempo slider stays meaningful because leaving scaled mode restores exactly the rate it last set.
function applySpeedControls() {
  const scaled = !!scaledSpeedEl?.checked;
  const cycleSeconds = cycleSliderEl ? +cycleSliderEl.value : undefined;
  const state = setSpeedMode(scaled ? 'scaled' : 'fixed', cycleSeconds);
  if (cycleReadoutEl) cycleReadoutEl.textContent = state.cycleSeconds.toFixed(1) + ' s';
  if (scaledReadoutEl) scaledReadoutEl.textContent = scaled
    ? (state.medianGrid ? `${Math.round(state.ticksPerSec)}/s @ ${state.medianGrid.toLocaleString()}` : 'waiting for rows')
    : 'off';
  if (tempoSliderEl) tempoSliderEl.disabled = scaled;
}

// The modulation shift follows the solved root and the glide length follows the tick rate, so this
// readout has to track live state rather than the checkbox that switched it on.
function drawModulationReadout() {
  if (!modulationReadoutEl) return;
  const m = currentModulation();
  modulationReadoutEl.textContent = m.on
    ? `${m.cents >= 0 ? '+' : ''}${m.cents.toFixed(0)}¢ · ${m.glideSeconds.toFixed(2)}s glide` : 'off';
}

function openCockpit() { if (lrcDivEl) lrcDivEl.classList.add('open'); }

function changeAudioMode(mode) {
  const next = setAudioMode(mode);
  if (audioModeEl && audioModeEl.value !== next) audioModeEl.value = next;
  rowGeneration++;
  rowSelectionKey = '';
  rowActiveIds = new Set();
  rowPrewarmIds = new Set();
  rowCompiler?.cancelQueuedExcept(new Set());
  if (next === AUDIO_MODES.AMBIENT_CHORDS) setGridSpatialField([]);
}

function requestRowProgram(candidate, root, chord, selectionKey, validRequestKeys) {
  const { z, distance } = candidate;
  if (!rowCompiler) return;
  if (!z._rowAudio) z._rowAudio = { program: null, programSelectionKey: '', requestKey: '', state: 'ownership-ready', compileMs: 0 };
  const state = z._rowAudio;
  if (state.programSelectionKey === selectionKey) return;
  const requestKey = `${rowGeneration}:${z.grid}:${selectionKey}`;
  validRequestKeys.add(requestKey);
  if (state.requestKey === requestKey && state.state === 'program-compiling') return;
  state.requestKey = requestKey;
  state.state = 'program-compiling';
  const selectedFractions = selectedOwnerFractions(z.ratioOwners, root.cents, chord.semitones, ROW_CONSONANCE_CENTS);
  const zoneIdentity = z;
  rowCompiler.request({
    grid: z.grid,
    ratioOwners: z.ratioOwners,
    abundance: z.abundance,
    selectedFractions,
    selectionKey,
    generation: rowGeneration,
    reflect: true,
    repeatCull: true,
  }, { key: requestKey, priority: distance }).then(reply => {
    if (reply.cancelled) {
      if (zoneIdentity._rowAudio?.requestKey === requestKey) {
        zoneIdentity._rowAudio.requestKey = '';
        zoneIdentity._rowAudio.state = zoneIdentity._rowAudio.program ? 'program-ready' : 'ownership-ready';
      }
      return;
    }
    // Every mutable boundary is checked: session, eviction/recreation identity, mode, harmonic
    // generation, and superseding request. A late worker reply can never enter live playback.
    if (!started || !cosmos || cosmos.zones.get(z.grid) !== zoneIdentity || currentAudioMode() !== AUDIO_MODES.CULLED_GRID_ROWS ||
        rowGeneration !== reply.result.generation || rowSelectionKey !== reply.result.selectionKey || zoneIdentity._rowAudio?.requestKey !== requestKey) return;
    zoneIdentity._rowAudio.program = reply.result;
    zoneIdentity._rowAudio.programSelectionKey = selectionKey;
    zoneIdentity._rowAudio.requestKey = '';
    zoneIdentity._rowAudio.state = 'program-ready';
    zoneIdentity._rowAudio.compileMs = reply.compileMs;
  }).catch(error => {
    if (zoneIdentity._rowAudio?.requestKey !== requestKey) return;
    zoneIdentity._rowAudio.requestKey = '';
    zoneIdentity._rowAudio.state = zoneIdentity._rowAudio.program ? 'program-ready' : 'compile-error';
    zoneIdentity._rowAudio.error = error.message;
  });
}

function updateGridRowField(placed, basis) {
  if (currentAudioMode() !== AUDIO_MODES.CULLED_GRID_ROWS) {
    rowActiveIds = new Set(); rowPrewarmIds = new Set();
    rowCompiler?.cancelQueuedExcept(new Set());
    setGridSpatialField([]);
    return;
  }
  const root = currentSkyRoot(), chord = currentSkyChord();
  const selectionKey = harmonicSelectionKey(root.rootKey, chord.id, ROW_CONSONANCE_CENTS);
  if (selectionKey !== rowSelectionKey) {
    rowSelectionKey = selectionKey;
    rowGeneration++;
    rowCompiler?.cancelQueuedExcept(new Set());
  }
  const candidates = [];
  for (const [grid, position] of placed) {
    const z = cosmos.zones.get(grid);
    if (!audioCompileEligibility(z).eligible) continue;
    const distance = Math.hypot(position[0], position[1], position[2]);
    candidates.push({ id: grid, z, position, distance, ready: !!z._rowAudio?.program });
  }
  let selection = chooseSpatialRows(candidates, rowActiveIds);
  rowPrewarmIds = new Set(selection.prewarm.map(candidate => candidate.id));
  const validRequestKeys = new Set();
  for (const candidate of selection.prewarm) requestRowProgram(candidate, root, chord, selectionKey, validRequestKeys);
  rowCompiler?.cancelQueuedExcept(validRequestKeys);

  // A completed older program stays active while its current-chord replacement compiles. This is
  // what keeps flight and chord changes from punching holes in the scheduler.
  for (const candidate of candidates) candidate.ready = !!candidate.z._rowAudio?.program;
  selection = chooseSpatialRows(candidates, rowActiveIds);
  rowActiveIds = new Set(selection.active.map(candidate => candidate.id));
  setGridSpatialField(selection.active.map(candidate => ({
    id: candidate.id,
    program: candidate.z._rowAudio.program,
    position: toAudioListenerPosition(candidate.position, basis),
    distance: candidate.distance,
    gain: rowDistanceGain(candidate.distance),
    cutoff: rowDistanceCutoff(candidate.distance),
  })));
}

// Master mute only — the transport keeps ticking (playhead keeps sweeping, notes keep scheduling) so
// unmuting resumes in sync rather than restarting the cycle. Shared by the cockpit button and the M key.
function toggleMute() {
  muted = !muted; setMuted(muted);
  if (muteBtnEl) { muteBtnEl.textContent = muted ? '\u{1F507}' : '\u{1F50A}'; muteBtnEl.classList.toggle('muted', muted); }
}

// Linear Plot: composite onsets as ticks along a horizontal track + a sweeping playhead. Only worth
// drawing while the cockpit is actually open (cheap either way — one canvas, tens of ticks).
function drawCockpitPlot() {
  if (!cockpitPlotCtx || !lrcDivEl || !lrcDivEl.classList.contains('open')) return;
  const w = cockpitPlotEl.width, h = cockpitPlotEl.height;
  cockpitPlotCtx.clearRect(0, 0, w, h);
  cockpitPlotCtx.strokeStyle = 'rgba(255,255,255,.14)'; cockpitPlotCtx.lineWidth = 1;
  cockpitPlotCtx.beginPath(); cockpitPlotCtx.moveTo(0, h / 2); cockpitPlotCtx.lineTo(w, h / 2); cockpitPlotCtx.stroke();
  if (leadVoice) {
    cockpitPlotCtx.fillStyle = '#00ff88';
    for (const n of leadVoice.notes) { const x = n.t * w; cockpitPlotCtx.fillRect(x - 0.75, h * 0.2, 1.5, h * 0.6); }
  }
  const ph = transportPhase();
  cockpitPlotCtx.strokeStyle = '#fff'; cockpitPlotCtx.lineWidth = 1.5;
  cockpitPlotCtx.beginPath(); cockpitPlotCtx.moveTo(ph * w, 0); cockpitPlotCtx.lineTo(ph * w, h); cockpitPlotCtx.stroke();
}

// Full Sky readout (M4): the GLOBAL walk's current chord — one sky-wide progression, not a per-star
// song strip. Shows regardless of whether a star is clicked (the bed plays from cosmos entry). Sky
// Root B3: Roman numerals are relative to the solved root, so the root fraction sits beside them —
// "I" beside "1/1" reads as the v1 default; once a swap lands, the root fraction itself changes.
function drawChordReadout() {
  if (!chordReadoutEl || !lrcDivEl || !lrcDivEl.classList.contains('open')) return;
  chordReadoutEl.innerHTML = `♪ <b>${currentSkyRoot().fraction}</b> <b class="cur">${currentSkyChord().symbol}</b>`;
  // The scaled rate is derived from the live field, so its readout has to follow the field, not the
  // control that switched the mode on.
  drawModulationReadout();
  if (scaledSpeedEl?.checked && scaledReadoutEl) {
    const speed = currentSpeedMode();
    scaledReadoutEl.textContent = speed.medianGrid
      ? `${Math.round(speed.ticksPerSec)}/s @ ${speed.medianGrid.toLocaleString()}` : 'waiting for rows';
    if (tempoReadoutEl) tempoReadoutEl.textContent = Math.round(speed.ticksPerSec) + '/s';
  }
}

// ── Full Sky DEBUG OVERLAY (dev-only, ?skyDebug=1) ──────────────────────────────────────────────
// Live readout for iterating on the progression/root-selection work (Avery, 2026-07-22 listening
// session): nearby tones (each audible star's FULL degree pool, not just what's voiced), what actually
// got selected for the bed + its live envelope gain, cents/dev tuning info, and coverage() per
// candidate triad (to see directly whether the field term is differentiating by location, rather than
// guessing from the ear). Built once and updated on a throttle so it doesn't thrash the DOM every rAF
// frame. The dense ratio readout uses a real table; the surrounding diagnostics remain preformatted.
// product UI; see cosmos/FULL_SKY_HANDOFF.md and the state doc for where this might go next (Avery:
// "maybe it can evolve into a semi-gamified thing users can play with").
let skyDebugOn = false, skyDebugEl = null, skyDebugLast = 0;
const SKY_DEBUG_MS = 200;   // DOM update cadence

function ensureSkyDebugPanel() {
  if (skyDebugEl) return;
  skyDebugEl = document.createElement('div');
  skyDebugEl.id = 'sky-debug-panel';
  skyDebugEl.style.cssText = 'position:fixed;top:12px;right:12px;width:min(760px,calc(100vw - 48px));max-height:82vh;overflow:auto;' +
    'background:rgba(8,10,16,.9);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:10px 12px;' +
    'font:10.5px/1.55 var(--mono,ui-monospace,monospace);color:#cfe3ff;z-index:700;pointer-events:auto;' +
    'overscroll-behavior:contain;scrollbar-gutter:stable;';
  // Native wheel scrolling belongs to the panel while the pointer is over it. Do not preventDefault:
  // stopping propagation keeps this diagnostic surface independent from present/future dolly handlers,
  // while overflow:auto performs the actual scroll. Outside the panel the canvas still owns the wheel.
  skyDebugEl.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
  // MUST land inside #cosmos-view, not document.body: `body.cosmos-active > *:not(#cosmos-view)` hides
  // every other top-level child with !important during the full-swallow (style.css) — a body-level
  // panel silently never shows while flying. #cosmos-view has no transform/filter, so position:fixed
  // descendants still anchor to the viewport exactly as if they were body-level.
  const host = document.getElementById('cosmos-view') || document.body;
  host.appendChild(skyDebugEl);
}

const fmtDev = d => (d > 0 ? '+' : '') + d.toFixed(1) + '¢';
const fmtPolicy = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : '—';

function rootPolicyBlock(policy) {
  const section = document.createElement('section');
  section.className = 'sky-root-policy';
  const heading = document.createElement('div');
  heading.className = 'sky-root-policy-heading';
  heading.textContent = 'ROOT SELECTION · LIVE POLICY';
  section.appendChild(heading);
  if (!policy?.available) {
    const waiting = document.createElement('div');
    waiting.className = 'sky-root-policy-summary';
    waiting.textContent = 'provisional 1/1 · waiting for the first settled root solve';
    section.appendChild(waiting);
    return section;
  }

  const p = policy, inc = p.incumbent, trigger = p.trigger;
  const confidence = p.ladder.normalizedRange < 0.25 ? 'vague' : p.ladder.normalizedRange < 0.75 ? 'mixed' : 'distinct';
  const triggerState = !p.solve.valid
    ? (p.solve.settled ? 'blocked: stale epoch' : 'blocked: moving')
    : !p.established && trigger.due
      ? `due: bootstrap → ${trigger.bootstrapChoice}`
    : !trigger.dwellReady
      ? 'blocked: dwell'
      : trigger.due
        ? `due: ${trigger.reason}`
        : p.phrase.exhaustionDue
          ? 'blocked: no eligible destination'
          : 'waiting: geography / phrase cycle';
  const destination = p.destination || p.previewDestination;
  const bootstrapRetain = !p.established && trigger.reason === 'bootstrap' && trigger.bootstrapChoice === 'incumbent';
  const destinationLabel = p.destination ? 'DESTINATION' : bootstrapRetain ? 'DESTINATION' : 'RANK PREVIEW';
  const destinationText = bootstrapRetain
    ? `${inc.fraction} · retain provisional anchor`
    : destination
      ? `${destination.fraction} · ${fmtPolicy(destination.motionCents, 0)}¢ · cost ${fmtPolicy(destination.cost, 2)}`
      : '—';
  const recent = p.recentRoots.length ? p.recentRoots.map(root => root.fraction || `${fmtPolicy(root.cents, 1)}¢`).join(' → ') : '—';
  const lastDecision = p.lastDecision
    ? `${p.lastDecision.reason}: ${p.lastDecision.from.fraction} → ${p.lastDecision.to.fraction}${p.lastDecision.changed ? '' : ' (retained)'}`
    : '—';
  const lines = [
    `ROOT  ${inc.fraction}${p.established ? '' : ' [provisional]'} · rank ${inc.rank || '—'}/${inc.candidateCount} · raw ${fmtPolicy(inc.score, 4)} · fitness ${fmtPolicy(inc.fitness, 3)}`,
    `FIELD spread ${fmtPolicy(p.ladder.spread, 4)} / ε ${fmtPolicy(p.ladder.epsilon, 4)} · range ${fmtPolicy(p.ladder.normalizedRange, 3)} · ${confidence}`,
    `PHRASE dwell ${p.phrase.chordsSinceRootChange}/${trigger.minDwellChords} · states ${p.phrase.seenStateKeys.length} · repeated ${p.phrase.exhaustionDue ? p.phrase.repeatedStateKey : 'no'}`,
    `SOLVE epoch ${p.solve.proposalEpoch ?? '—'}/${p.solve.currentEpoch} · ${p.solve.settled ? 'settled' : 'moving'} · ${p.solve.valid ? 'proposal valid' : 'proposal invalid'}`,
    `TRIGGER ${triggerState}`,
    `${destinationLabel} ${destinationText}`,
    `RECENT ${recent}`,
    `LAST ${lastDecision}`,
  ];
  const summary = document.createElement('div');
  summary.className = 'sky-root-policy-summary';
  summary.textContent = lines.join('\n');
  section.appendChild(summary);

  if (p.rows.length) {
    const table = document.createElement('table');
    table.className = 'sky-root-policy-table';
    const labels = ['Root', 'Rank', 'Raw', 'Fit', 'Arrival', 'Motion', 'Tune', 'Total', 'Status'];
    const thead = table.createTHead(), header = thead.insertRow();
    for (const label of labels) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.appendChild(th); }
    const tbody = table.createTBody();
    for (const row of p.rows) {
      const tr = tbody.insertRow();
      tr.className = `sky-root-status-${row.statusCode}`;
      const values = [
        row.fraction,
        row.rank,
        fmtPolicy(row.score, 4),
        fmtPolicy(row.fitness, 3),
        fmtPolicy(row.arrivalCoverage, 3),
        Number.isFinite(row.motionCents) ? `${fmtPolicy(row.motionCents, 0)}¢/${fmtPolicy(row.motionCost, 2)}` : '—',
        fmtPolicy(row.tuningCost, 2),
        fmtPolicy(row.cost, 2),
        row.status,
      ];
      for (const value of values) { const td = tr.insertCell(); td.textContent = value; }
    }
    section.appendChild(table);
  }
  return section;
}

function appendRatioTokens(cell, ratios) {
  if (!ratios.length) { cell.textContent = '—'; return; }
  const wrap = document.createElement('span');
  wrap.className = 'sky-ratio-tokens';
  for (const ratio of ratios) {
    const token = document.createElement('span');
    token.className = 'sky-ratio-token';
    token.textContent = `${ratio.fraction}${ratio.count > 1 ? `×${ratio.count}` : ''}`;
    wrap.appendChild(token);
  }
  cell.appendChild(wrap);
}

function makeRatioToneTable(rows, context) {
  const section = document.createElement('section');
  section.className = 'sky-ratio-section';
  const heading = document.createElement('div');
  heading.className = 'sky-ratio-heading';
  heading.textContent = `SELECTED RATIO TONES  (${context})`;
  section.appendChild(heading);
  const table = document.createElement('table');
  table.className = 'sky-ratio-table';
  const header = table.createTHead().insertRow();
  for (const label of ['deg', 'chord', 'selected', 'ON']) {
    const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; header.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const row of rows) {
    const tr = tbody.insertRow();
    const degree = tr.insertCell(); degree.textContent = row.degree;
    const chord = tr.insertCell(); chord.textContent = row.inChord ? '●' : '·';
    appendRatioTokens(tr.insertCell(), row.selected);
    appendRatioTokens(tr.insertCell(), row.sounding);
  }
  section.appendChild(table);
  return section;
}

function renderSkyDebug(now) {
  if (!skyDebugOn) return;
  ensureSkyDebugPanel();
  if (now - skyDebugLast < SKY_DEBUG_MS) return;
  skyDebugLast = now;
  const s = debugSkyState();
  const lines = [];
  lines.push(`FULL SKY DEBUG   mode ${s.audioMode}   tuning ${s.tuningStrength.toFixed(2)}st   sounding root ${s.root.fraction} (${s.root.cents}¢, ${s.root.hz}Hz)${s.rootPolicy.pending ? '  [policy decision pending]' : ''}`);
  const settleState = settleSinceSecond === null ? 'moving' : `settled ${(Math.max(0, (currentSkySeconds() - settleSinceSecond))).toFixed(1)}/${SETTLE_SECONDS}s`;
  lines.push(`  ${settleState}, camSpeed ${camSpeed.toFixed(1)}u/s (settle<${SETTLE_SPEED})`);
  // Two clocks: the grid clock (ticks/s, scales with speed) and the sky clock (seconds, never does).
  lines.push(`clock  ${s.speed.mode === 'scaled'
    ? `SCALED ${Math.round(s.speed.ticksPerSec)} ticks/s from median grid ${s.speed.medianGrid.toLocaleString()} → ${s.speed.cycleSeconds}s/cycle`
    : `fixed ${Math.round(s.speed.ticksPerSec)} ticks/s`}   ·   sky ${s.speed.skySeconds.toFixed(1)}s`);
  lines.push(`modul  ${s.modulation.on
    ? `ON  root → fundamental, shift ${s.modulation.cents >= 0 ? '+' : ''}${s.modulation.cents.toFixed(0)}¢, glide ${s.modulation.glideSeconds.toFixed(2)}s (${s.modulation.onsetTicks.toFixed(0)} ticks/onset)`
    : 'off  (absolute JI against a fixed 1/1 — a root change re-reads, it does not transpose)'}`);
  lines.push(`chord  ${s.chord.symbol}  degrees [${s.chord.semitones.join(',')}]`);
  // Exposure: which of the chord's degrees have actually SOUNDED this window. With the hold on, the
  // chord will not move until this is complete (or the cap fires).
  const exposure = s.chordExposure;
  if (exposure) {
    const missing = exposure.degrees.filter(d => !exposure.sounded.includes(d));
    lines.push(`quality  ${exposure.holding ? 'HOLD' : 'free'}  sounded [${exposure.sounded.join(',')}]` +
      `${missing.length ? `  waiting on [${missing.join(',')}]` : '  ✓ full quality exposed'}` +
      `  held ${exposure.heldSeconds.toFixed(1)}s · last chord ${exposure.lastChordSeconds.toFixed(1)}s`);
  }
  lines.push(`trail  ${s.tabu.map(c => c.symbol).join(' → ')}`);
  if (s.gridRows) {
    const compiler = rowCompiler?.snapshot() || { queued: 0, compiling: 0, completed: 0, cancelled: 0, errors: 0 };
    lines.push(`rows   ${s.gridRows.activeStars}/${ROW_ACTIVE_STARS} active · ${rowPrewarmIds.size}/${ROW_PREWARM_STARS} warm · ${s.gridRows.voices}/${s.gridRows.budget} voices · ${s.gridRows.budgetMisses} budget misses`);
    lines.push(`tone cap  ${CULLED_ROW_MAX_VOICES_PER_TONE} each · ${s.gridRows.toneCapMisses} rejected · ${s.gridRows.toneCapEvictions} farther voices swapped`);
    lines.push(`worker q${compiler.queued} c${compiler.compiling} done${compiler.completed} cancel${compiler.cancelled} err${compiler.errors} last${compiler.lastCompileMs?.toFixed?.(1) || 0}ms`);
    for (const star of s.gridRows.stars) lines.push(`  #${star.id} ${star.events} ticks · ${star.selectedRatios} ratios · ${star.voices} voices${star.pendingKey ? ' [swap pending]' : ''}`);
  }
  const ratioTableAt = lines.length;
  const ratioContext = s.audioMode === AUDIO_MODES.CULLED_GRID_ROWS
    ? `active grid-star programs; ON = live A–D voices, max ${CULLED_ROW_MAX_VOICES_PER_TONE} per tone`
    : 'audible-star pools; ON = live bed voices';
  const covSorted = [...s.coverageByTriad].sort((a, b) => b.coverage - a.coverage);
  lines.push(`coverage (best→worst)  ${covSorted.map(c => `${c.symbol}:${c.coverage.toFixed(2)}`).join('  ')}`);
  if (s.candidateCosts.length) {   // Sky Root Feature A: why the walk picked what it's about to pick
    // fieldCost is normalized within the candidate's own cardinality class; richness is the earned
    // extension incentive (weakest supported degree × RICHNESS), so it reads as a subtraction.
    lines.push(`candidates (cost = parsimony + field − richness, best→worst, top 6)`);
    lines.push('  ' + s.candidateCosts.slice(0, 6).map(c =>
      `${c.symbol}[${c.cardinality}]:${c.cost.toFixed(2)}(${c.parsimony}+${c.fieldCost.toFixed(2)}${c.richness ? `−${c.richness.toFixed(2)}` : ''})`).join('  '));
  }
  lines.push(`\naudible ${s.audibleCount} star(s), ${s.stars.reduce((n, st) => n + st.voiced.length, 0)} voice(s) sounding`);
  for (const st of s.stars.sort((a, b) => b.gain - a.gain)) {
    lines.push(`\n#${st.id}  pan${st.pan.toFixed(2)} gain${st.gain.toFixed(2)} oct+${st.octave} lpf${st.cutoff}Hz`);
    const poolLine = st.pool.map((slot, d) => slot ? `${d}:${slot.fraction}${fmtDev(slot.dev)}` : `${d}:-`).join(' ');
    lines.push(`  pool  ${poolLine}`);
    if (st.voiced.length) {
      for (const v of st.voiced) lines.push(`  ▶ deg${v.degree} dev${fmtDev(v.dev)} gainLaw${v.gainLaw} env${v.envGain} ${v.freqHz}Hz`);
    } else lines.push(`  ▶ (silent — no chord degree covered)`);
  }
  const fragment = document.createDocumentFragment();
  fragment.appendChild(rootPolicyBlock(s.rootPolicy));
  const before = document.createElement('div');
  before.className = 'sky-debug-text';
  before.textContent = lines.slice(0, ratioTableAt).join('\n');
  fragment.appendChild(before);
  fragment.appendChild(makeRatioToneTable(s.selectedRatioTones, ratioContext));
  const after = document.createElement('div');
  after.className = 'sky-debug-text';
  after.textContent = lines.slice(ratioTableAt).join('\n');
  fragment.appendChild(after);
  const priorScrollTop = skyDebugEl.scrollTop;
  skyDebugEl.replaceChildren(fragment);
  skyDebugEl.scrollTop = priorScrollTop;
}

function loop() {
  if (!started) return;                     // torn down by stopFlight() → break the rAF chain (no background frames)
  requestAnimationFrame(loop);
  if (M.mode !== 'flight' || !cosmos) return;
  const now = performance.now(); let dt = (now - last) / 1000; last = now; dt = Math.min(dt, 0.05);
  const ridingWeb = stepWebReturn(now, dt);
  stepControls(dt, !ridingWeb);
  cosmos.tick(dt);
  if (webZoneAdded.length || webZoneRemoved.length) {
    const added = webZoneAdded; const removed = webZoneRemoved; webZoneAdded = []; webZoneRemoved = [];
    webRenderer?.zones(added, removed);
  }
  if (swarm && swarm.agents.length) swarm.update(dt, cam.anchor);

  const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const basis = camBasis();
  drawHilbertBoundaryWalls(basis);
  webRenderer?.frame({
    now, anchor: cam.anchor, off: [...cam.off], d: basis.d, r: basis.r, u: basis.u,
    mouseX, mouseY, cx, cy, focal, fogNear: FOG_NEAR, fogFar: FOG_FAR, tailFrac: webTailFrac,
  });

  // bloom bookkeeping: drop any bloomed star that flew out of the world; keep the rest streaming their FULL
  // clouds (runtime priority-solves the most-recent click via setFocus; we stream all of them here).
  for (const g of bloomed) if (!cosmos.zones.has(g)) { bloomed.delete(g); if (cosmos.focusGrid === g) cosmos.setFocus(null); }
  for (const g of bloomed) ensureFocusBloom(cosmos.zones.get(g));
  pumpBlooms();
  updateFilterUI();

  // undeformed world positions (bloom centres come from these — a bloom shouldn't move itself)
  const rpOf = new Map();
  for (const z of cosmos.zones.values()) rpOf.set(z.grid, renderPosCam(z, cam.anchor, cam.off));

  // Return Home star lookahead. Sample only a short curved rail around the current ride position,
  // expressed camera-relative so it compares directly with rpOf without forming huge grid floats.
  // The sampled route drives visuals only; it never inserts zones or changes planner/solver state.
  let travelStarSamples = [], travelStarRadius = 0, travelStarColor = null;
  if (returnRide) {
    const hilbert = placement === 'hilbert';
    const cameraWorld = cameraAbsolute();
    travelStarRadius = hilbert ? CELL * WEB_RETURN_STAR_RADIUS_CELLS : WEB_RETURN_STAR_RADIUS_SPINE;
    travelStarColor = activeWebs.get(returnRide.webId)?.color || '#9edcff';
    travelStarSamples = buildTravelBloomSamples(returnRide.path, returnRide.pathProgress || 0, {
      behind: hilbert ? CELL * WEB_RETURN_STAR_BEHIND_CELLS : WEB_RETURN_STAR_BEHIND_SPINE,
      ahead: hilbert ? CELL * WEB_RETURN_STAR_AHEAD_CELLS : WEB_RETURN_STAR_AHEAD_SPINE,
      samples: WEB_RETURN_STAR_SAMPLES,
      samplePath: sampleArcPath,
    }).map(sample => ({ ...sample, position: sample.position.map((value, i) => value - cameraWorld[i]) }));
  }

  // each bloom's geometry: outer radius (spiky-ball extent), the deformation bubble, and — after projection —
  // the "black hole" screen disk. rscale matches the render loop so outerR is exact.
  const bubbles = [];
  for (const g of bloomed) {
    const rp = rpOf.get(g), data = bloomCache.get(g);
    if (!rp || !data || !data.systems.length) continue;
    // rscale uses the FULL range (stable node positions); the footprint (deform bubble + blot) tracks the
    // outermost VISIBLE shell so filtering to low cardinalities shrinks the bubble/blot to match the cloud.
    const rscale = Math.min(BLOOM_R, BLOOM_MAX_R / (1 + cardExtent(Math.max(1, data.cmax - data.cmin))));
    const cmaxVis = g === cosmos.focusGrid ? Math.min(data.cmax, cardHi) : data.cmax;   // filter only shrinks the focused bloom
    const outerR = rscale * (1 + cardExtent(Math.max(0, cmaxVis - data.cmin)));
    bubbles.push({ g, c: rp, outerR, bubbleR: outerR + BUBBLE_MARGIN });
  }
  const deforming = placement === 'hilbert' && bubbles.length > 0;   // cube-only local deformation

  // project all zones once (deforming out of bloom bubbles); keep the world-relative rp for bloom offsets
  const proj = new Map(), placed = new Map();
  for (const z of cosmos.zones.values()) {
    const rp = deforming ? deform(rpOf.get(z.grid), z.grid, bubbles) : rpOf.get(z.grid);
    placed.set(z.grid, rp);
    const s = toScreen(rp, basis);
    if (s) proj.set(z.grid, { z, s, rp });
  }

  // cosmos-audio: drive the lead voice's spatialization from its star's live projection this frame.
  if (leadVoice) {
    if (!cosmos.zones.has(leadVoice.node.grid)) { setLead(null); leadVoice = null; }   // evicted → clear the lead
    else {
      const lp = proj.get(leadVoice.node.grid);
      if (lp) setSpatial(clampN((cx - lp.s.x) / cx, -1, 1), distGain(lp.s.z), distOctave(lp.s.z));   // screen-right → pan right (Avery: was backwards)
      else setSpatial(0, 0, 0);   // flew out of view (still loaded) → silence via gain 0, don't crash
    }
  }
  // Full Sky: the ambient bed's audible set — EVERY solved zone with a degree pool is eligible (not
  // just bloomed/clicked stars, see cosmos/FULL_SKY_HANDOFF.md), nearest AUDIBLE_N by view depth wins.
  // No lead required — this is the un-gated bed, live from cosmos entry (flight-boot.js's unlock).
  // Hysteresis (AUDIBLE_MARGIN): pick from the wider N+margin window, but a star already in the field
  // keeps its seat over that same window — only genuinely falling further behind drops it. Plain
  // nearest-N-every-frame flickered stars near the boundary in/out constantly while flying, which
  // cosmos-audio.js heard as the bed cutting out (each flicker = a full voice release/re-attack cycle).
  const skyCandidates = [];
  for (const { z, s } of proj.values()) if (z.skyPool) skyCandidates.push({ z, s });
  skyCandidates.sort((a, b) => a.s.z - b.s.z);
  const skyWindow = skyCandidates.slice(0, AUDIBLE_N + AUDIBLE_MARGIN);
  const skyKept = skyWindow.filter(c => audibleIds.has(c.z.grid));
  const skyFresh = skyWindow.filter(c => !audibleIds.has(c.z.grid));
  const skyChosen = [...skyKept, ...skyFresh].slice(0, AUDIBLE_N);
  audibleIds = new Set(skyChosen.map(c => c.z.grid));

  // Sky Root handoff B3: settle trigger — solve when camera speed has stayed below SETTLE_SPEED for
  // SETTLE_SECONDS (the SKY clock, read via cosmos-audio's currentSkySeconds so "settled" means the same
  // duration at any tempo or scaled speed), rate-limited to one solve per ROOT_RESOLVE_MIN_SECONDS.
  // The gather set is a world-space RADIUS around the camera (rpOf is already camera-relative, so its
  // length IS true 3D distance) — NOT the view-depth-sorted proj/audible set above, so the root never
  // changes just because you turned to look somewhere else. Solving here is rare + main-thread-cheap
  // (a few thousand gainForDev evals) — never done per frame.
  const skyNow = currentSkySeconds();
  if (camSpeed < SETTLE_SPEED) { if (settleSinceSecond === null) settleSinceSecond = skyNow; }
  else {
    if (rootPolicyWasSettled) rootGeographyEpoch++;
    rootPolicyWasSettled = false;
    settleSinceSecond = null;
  }
  const settled = settleSinceSecond !== null && (skyNow - settleSinceSecond) >= SETTLE_SECONDS;
  if (settled) rootPolicyWasSettled = true;
  setRootPolicyContext({ settled, geographyEpoch: rootGeographyEpoch });
  if (settled && (skyNow - lastRootResolveSecond) >= ROOT_RESOLVE_MIN_SECONDS) {
    lastRootResolveSecond = skyNow;
    const rootField = [];
    for (const z of cosmos.zones.values()) {
      if (!z.skyTones || !z.skyTones.length) continue;
      const rp = rpOf.get(z.grid); if (!rp) continue;
      const d = Math.hypot(rp[0], rp[1], rp[2]);
      if (d > ROOT_RADIUS) continue;
      rootField.push({ tones: z.skyTones, weight: distGain(d) });
    }
    const ladder = solveRoots(rootField);
    const currentRoot = currentSkyRoot();
    const incumbentResult = scoreRootAt(currentRoot.cents, rootField);
    proposeRoot({
      ladder,
      incumbent: { fraction: currentRoot.fraction, cents: currentRoot.cents, score: incumbentResult.score, perDegree: incumbentResult.perDegree },
      proposalEpoch: rootGeographyEpoch,
    });
  }

  // Re-anchored playback: each zone lazily caches its re-folded pool at the CURRENT solved root,
  // invalidated by rootKey (a swap is rare — most frames every chosen zone's cache just hits).
  const root = currentSkyRoot();
  setField(skyChosen.map(({ z, s }) => {
    if (!z.skyPoolAt || z.skyPoolAt.rootKey !== root.rootKey) z.skyPoolAt = { rootKey: root.rootKey, pool: poolFromTones(z.skyTones || [], root.cents) };
    return {
      id: z.grid, pool: z.skyPoolAt.pool,
      pan: clampN((cx - s.x) / cx, -1, 1), gain: distGain(s.z), octave: distOctave(s.z), cutoff: distCutoff(s.z),
    };
  }));
  updateGridRowField(placed, basis);
  drawCockpitPlot();
  drawChordReadout();
  renderSkyDebug(now);

  // black-hole blots: a screen disk per bloom (from its projected centre) that occludes farther stars behind it
  const blots = [];
  for (const b of bubbles) {
    const p = proj.get(b.g); if (!p) continue;
    const vz = p.s.z, fade = Math.max(0, Math.min(1, (vz - b.outerR) / b.outerR));   // fade out as camera enters the cloud
    if (fade <= 0) continue;                                                          // inside the bloom → no blot, see everything
    blots.push({ x: p.s.x, y: p.s.y, vz, r: b.outerR * BLOT_FRAC * focal / vz, fade, g: b.g });
  }
  // a plain star is occluded if it sits behind (farther than) a nearer bloom's disk — culled from draw AND pick
  const occluded = (sx, sy, vz, g) => { for (const bl of blots) { if (bl.g === g || bl.vz >= vz) continue; const dx = sx - bl.x, dy = sy - bl.y; if (dx * dx + dy * dy < bl.r * bl.r) return true; } return false; };

  // connectors (behind stars), faded by depth — spine only. In the cube there's no district reorg,
  // so a connector would just be a random thread across space; the Hilbert layout carries structure.
  if (placement !== 'hilbert') {
    ctx.lineWidth = 1;
    for (const { z, s } of proj.values()) {
      if (z.parentGrid === z.grid) continue;
      const p = proj.get(z.parentGrid); if (!p) continue;
      const f = fogAt(s.z); if (f <= 0) continue;
      ctx.strokeStyle = `rgba(120,150,200,${0.10 * f})`;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(p.s.x, p.s.y); ctx.stroke();
    }
  }
  drawAgents(basis);   // Collider-Battle ships (over the web, under the picking rings)
  // ── picking: as we draw, note the star/node nearest the cursor and the pinned selection's live pos ──
  const havePtr = mouseX >= 0;
  let pickNode = null, pickNodeD2 = NODE_HIT * NODE_HIT, pickStar = null, pickStarD2 = Infinity, selPos = null;

  // stars, painter's order (far first). A blooming star dissolves into its point cloud (dot alpha ↓).
  const rowActivity = new Map(gridRowVisualState().map(activity => [activity.id, activity]));
  const order = [...proj.values()].sort((a, b) => b.s.z - a.s.z);
  for (const { z, s } of order) {
    const fog = fogAt(s.z); if (fog <= 0) continue;
    // Cache projected motion even while a star is occluded so uncovering it cannot produce a stale,
    // full-screen streak. Space is the shared free-flight/Return Home boost, so one law serves both.
    const previousScreen = z._starScreen;
    z._starScreen = { x: s.x, y: s.y, at: now };
    if (!bloomed.has(z.grid) && occluded(s.x, s.y, s.z, z.grid)) continue;   // behind a black-hole blot → no draw, no click
    const dim = (bloomed.has(z.grid) && z._bloom && z._bloom.pts.length) ? 0.18 : 1;   // bloomed dot dissolves into its cloud
    const travelTarget = returnRide && z.state !== 'solved'
      ? travelBloomWeight(rpOf.get(z.grid), travelStarSamples, travelStarRadius) : 0;
    const glowRate = travelTarget > (z._travelGlow || 0) ? 10 : 4.5;
    z._travelGlow = (z._travelGlow || 0) + (travelTarget - (z._travelGlow || 0)) * (1 - Math.exp(-dt * glowRate));
    if (z._travelGlow < 0.002 && !returnRide) delete z._travelGlow;
    const travelGlow = z._travelGlow || 0;
    if (travelGlow > 0 && z._travelStarSize == null) z._travelStarSize = approximateStarSize(z.divisors || factorInfo(z.grid).divisors);
    const previewSize = z._travelStarSize || 0.15;
    const displaySize = z.state === 'solved' ? z.size : z.size + (Math.max(z.size, previewSize) - z.size) * travelGlow;
    const lit = displaySize > 0;                               // real partial solve or visual route preview
    const worldR = (lit ? displaySize : 0.2) * STAR_SCALE;
    let r = worldR * focal / s.z; r = Math.max(0.5, Math.min(r, 400));
    const col = z.monster ? 'rgba(255,120,105,0.92)'           // red giant = combinatorial monster (solve-on-override)
              : z.unsolvable ? 'rgba(150,120,110,0.45)'         // warm-grey = uncharted frontier (beyond cap)
              : (lit ? starColor(displaySize) : 'rgba(120,130,150,0.5)');
    if (keys[' '] && previousScreen && now - previousScreen.at < 100) {
      let dx = previousScreen.x - s.x, dy = previousScreen.y - s.y;
      const motion = Math.hypot(dx, dy);
      if (motion > 0.35) {
        const length = Math.min(BOOST_STAR_STREAK_MAX, motion * BOOST_STAR_STREAK_SCALE), k = length / motion;
        const tailX = s.x + dx * k, tailY = s.y + dy * k;
        const streakColor = travelGlow > 0.01 && travelStarColor ? travelStarColor : col;
        const streak = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
        streak.addColorStop(0, streakColor); streak.addColorStop(0.22, streakColor); streak.addColorStop(1, 'transparent');
        ctx.globalAlpha = fog * dim * BOOST_STAR_STREAK_ALPHA;
        ctx.strokeStyle = streak; ctx.lineWidth = Math.max(0.65, Math.min(3, r * 0.55)); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tailX, tailY); ctx.stroke();
      }
    }
    const activity = rowActivity.get(z.grid);
    if (activity && !bloomed.has(z.grid)) drawGridRowAura(ctx, s, r, fog, activity);
    if (travelGlow > 0.01 && travelStarColor) {                // route-energy halo around unfinished stars
      const haloR = r * (2.4 + travelGlow * 2.2);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
      g.addColorStop(0, travelStarColor); g.addColorStop(0.18, travelStarColor); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = fog * dim * travelGlow * 0.32; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, haloR, 0, 7); ctx.fill();
    }
    if (lit && displaySize > 2.2) {                            // solved or synthetic sun glow
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 2.6);
      g.addColorStop(0, col); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.5 * fog * dim; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, r * 2.6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = fog * dim; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fill();
    if (selected && selected.kind === 'star' && selected.grid === z.grid) selPos = { x: s.x, y: s.y, r };
    if (havePtr) { const dx = s.x - mouseX, dy = s.y - mouseY, d2 = dx * dx + dy * dy, hit = r + STAR_HIT; if (d2 <= hit * hit && d2 < pickStarD2) { pickStarD2 = d2; pickStar = { kind: 'star', grid: z.grid, z, x: s.x, y: s.y, r }; } }
  }

  // black-hole disks: a soft dark sphere behind each bloom (drawn over the culled background, under the
  // cloud) so the bloom reads as a focal object floating in a clearing — no background noise bleeding through.
  for (const bl of blots) {
    const fog = fogAt(bl.vz); if (fog <= 0) continue;
    const g = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, bl.r);
    g.addColorStop(0, 'rgba(5,7,11,0.96)'); g.addColorStop(0.72, 'rgba(5,7,11,0.9)'); g.addColorStop(1, 'transparent');
    ctx.globalAlpha = fog * bl.fade; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // BLOOMS: every clicked star renders its FULL cloud (no point cap) as a SPIKY BALL — one global
  // Fibonacci direction lattice over ALL the grid's systems, each point pushed out to a radius set by its
  // cardinality (so cardinality reads as radial extent, not a separate concentric sphere). This kills the
  // radial-ray artifact that per-cardinality spheres produced for sparse grids: sparse grids read as
  // scattered spikes, abundant grids fill into a layered sun — same formula, no override. Nodes instantiate
  // over FOCUS_FILL_MS and re-flow as the lattice grows (recreating the solve animation); each is clickable.
  // Anim state rides on the zone (z._bloom) so it's freed on evict. BLOOM_OMEGA=0 keeps it hit-testable.
  const spin = now / 1000 * BLOOM_OMEGA, cs = Math.cos(spin), sn = Math.sin(spin);
  for (const g of bloomed) {
    const data = bloomCache.get(g), z = cosmos.zones.get(g), rpC = rpOf.get(g);
    if (!data || !data.systems.length || !z || !rpC) continue;
    // Centre world-relative position (deformed like everything else). We render PER NODE and do NOT gate on the
    // centre projecting in front of the camera — so flying INTO or THROUGH a cloud keeps the near-side nodes
    // visible even when the centre is beside/behind you. Each node's own near-plane + fog cull still applies.
    const crp = deforming ? deform(rpC, g, bubbles) : rpC;
    let B = z._bloom; if (!B) B = z._bloom = { born: now, pts: [] };
    const len = data.systems.length, reveal = Math.min(len, Math.ceil(len * (now - B.born) / FOCUS_FILL_MS));
    while (B.pts.length < reveal) {                              // instantiate the next rhythm node(s)
      const s = data.systems[B.pts.length];
      const charted = indexKeys ? binarySearch(indexKeys, s.key) >= 0 : false;   // codex membership (cyan)
      B.pts.push({ c: s.c, dense: s.dense, charted, layers: s.layers, fund: s.fund, rs: s.rs, key: s.key,
                   col: charted ? CHARTED : cardColor(s.c), px: 0, py: 0, pz: 0, placed: false, bt: now });
    }
    const N = B.pts.length;                                     // global lattice size (re-flows as it grows)
    // radial scale: plain BLOOM_R per cardinality step, soft-kneed so sparse high-cardinality outliers don't
    // blow out the footprint, and clamped so the OUTER radius stays within BLOOM_MAX_R (loose safety ceiling).
    const rscale = Math.min(BLOOM_R, BLOOM_MAX_R / (1 + cardExtent(Math.max(1, data.cmax - data.cmin))));
    // A bloomed grid gets no single grid-centre orb (suppressed below); instead each node whose OWNER
    // rhythm currently has a live/attacking row voice lights up, keyed by the shared canonical rhythm key.
    const act = rowActivity.get(g);
    const nodeSources = act && act.sources ? new Map(act.sources.map(src => [src.key, src])) : null;
    for (let pi = 0; pi < N; pi++) {
      const p = B.pts[pi];
      const R = rscale * (1 + cardExtent(p.c - data.cmin));    // radial extent = cardinality (soft-kneed spikes)
      const y = 1 - (pi + 0.5) / N * 2, rr = Math.sqrt(Math.max(0, 1 - y * y)), ang = pi * GOLDEN;   // uniform dir
      const tx = Math.cos(ang) * rr * R, ty = y * R, tz = Math.sin(ang) * rr * R;
      if (!p.placed) { p.px = tx; p.py = ty; p.pz = tz; p.placed = true; }
      else { p.px += (tx - p.px) * BLOOM_EASE; p.py += (ty - p.py) * BLOOM_EASE; p.pz += (tz - p.pz) * BLOOM_EASE; }
      if (g === cosmos.focusGrid && !cardVisible(p.c)) continue;          // band filter applies to the FOCUSED bloom only
      const wx = p.px * cs + p.pz * sn, wz = -p.px * sn + p.pz * cs;      // spin around Y
      const sp = toScreen([crp[0] + wx, crp[1] + p.py, crp[2] + wz], basis); if (!sp) continue;   // per-node near cull
      const fog = fogAt(sp.z); if (fog <= 0) continue;                    // per-node fog (far side of a big bloom fades)
      const rv = Math.min(1, (now - p.bt) / BLOOM_RV_MS), a0 = fog * rv;   // per-node birth ease
      const r = Math.max(0.4, Math.min(2.6 * focal / sp.z, 6)) * (0.5 + 0.5 * rv);
      if (nodeSources) { const src = nodeSources.get(p.key); if (src) drawGridRowAura(ctx, sp, r, fog, src); }
      ctx.globalAlpha = a0; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, 7); ctx.fill();
      if (p.dense) { ctx.globalAlpha = a0 * 0.5; ctx.strokeStyle = p.col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 1.6, 0, 7); ctx.stroke(); }
      const nid = g + ':' + pi;
      if (selected && selected.kind === 'node' && selected.id === nid) selPos = { x: sp.x, y: sp.y, r };
      if (havePtr) { const dx = sp.x - mouseX, dy = sp.y - mouseY, d2 = dx * dx + dy * dy; if (d2 < pickNodeD2) { pickNodeD2 = d2; pickNode = { kind: 'node', id: nid, grid: g, c: p.c, dense: p.dense, layers: p.layers, fund: p.fund, rs: p.rs, key: p.key, charted: p.charted, x: sp.x, y: sp.y, r }; } }
    }
  }
  // resolve hover (a node under the cursor wins — it's the specific target), draw the selection + hover
  // rings on their live screen positions, and drive the tooltip. The detail panel is pinned on click.
  hover = pickNode || pickStar || hoverWeb;
  ringAt(selPos, '#ffffff', 1.6);
  if (hover && hover.kind !== 'web' && !(selected && ((hover.kind === 'star' && selected.kind === 'star' && hover.grid === selected.grid) || (hover.kind === 'node' && selected.kind === 'node' && hover.id === selected.id))))
    ringAt(hover, 'rgba(255,255,255,0.7)', 1.2);
  if (cv) cv.style.cursor = hover ? 'pointer' : 'crosshair';
  updateTooltip();
  ctx.globalAlpha = 1;
  const st = cosmos.stats(), ev = cosmos.events;
  // backpressure: ease the frontier reach down when the solve backlog is deep, back up when it clears (cube only)
  if (placement === 'hilbert') { const tgt = (st.pending + st.solving) > SOLVE_BACKLOG ? HIL_SPAWN_MIN : HIL_SPAWN; hilSpawn += (tgt - hilSpawn) * 0.04; }
  // heartbeat: log solve throughput once/sec so stalls are visible (which op is flowing, worker errors)
  if (now - hbLast > 1000) {
    console.log(`[cosmos] zones ${st.total} · solved ${st.solved} (+${st.solved - hbSolved}/s) · solving ${st.solving} · pending ${st.pending} · tasks/s: plan ${ev.plans - hbPlans} shard ${ev.shards - hbShards} · inflight ${st.inFlight}/${pool.size} · worker-err ${pool.errors} · task-err ${ev.errors} · blooms ${bloomCache.size}`);
    hbLast = now; hbPlans = ev.plans; hbShards = ev.shards; hbSolved = st.solved;
    for (const g of bloomCache.keys()) if (!cosmos.zones.has(g)) bloomCache.delete(g);   // drop evicted blooms
    if (selected && (selected.kind === 'star' || selected.kind === 'web')) showDetail(selected);   // refresh live abundance/state / visible Web count
  }
  // top HUD is deliberately minimal: grid, active blooms, active webs — nothing else. Solve stats + flight
  // controls live in the top-right help popup (#cosmos-help-panel); full solve detail is in the console heartbeat.
  const focusHud = bloomed.size ? ` · <span style="color:var(--known)">◉ ${bloomed.size} bloom${bloomed.size > 1 ? 's' : ''}</span>` : '';
  // web slot legend: numbered chips (1-9,0) tinted by web colour, dim when that slot is toggled off
  let webHud = '';
  if (activeWebs.size) {
    const bySlot = new Map(); for (const w of activeWebs.values()) bySlot.set(w.slot, w);
    let chips = '';
    for (let s = 0; s < WEB_MAX; s++) { const w = bySlot.get(s); if (!w) continue; chips += `<span style="color:${w.color};opacity:${w.visible === false ? 0.35 : 1};font-weight:bold">${s === 9 ? '0' : s + 1}</span>`; }
    webHud = ` · ◈ ${chips}`;
  }
  const rideHud = returnRide ? ` · <span style="color:${activeWebs.get(returnRide.webId)?.color || 'var(--known)'}">↢ home ${Math.round((activeWebs.get(returnRide.webId)?.rideProgress || 0) * 100)}%</span>` : '';
  hud.innerHTML = `grid <b>${cam.anchor.toLocaleString()}</b>${focusHud}${webHud}${rideHud}`;
  // live solve queue → the help popup (only while open, so it's free when closed)
  if (helpPanelEl && liveEl && helpPanelEl.classList.contains('open')) {
    const errRow = (pool.errors || ev.errors) ? `<div class="help-kv"><span>errors</span><b style="color:#e88">${pool.errors + ev.errors}</b></div>` : '';
    liveEl.innerHTML =
      `<div class="help-kv"><span>solved</span><b>${st.solved}</b></div>` +
      `<div class="help-kv"><span>solving</span><b>${st.solving}</b></div>` +
      `<div class="help-kv"><span>pending</span><b>${st.pending}</b></div>` +
      `<div class="help-kv"><span>tasks</span><b>${st.inFlight}/${pool.size}</b></div>` + errRow;
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  cx = W / 2; cy = H / 2; focal = Math.min(W, H) * 0.9;
  webRenderer?.resize(W, H, dpr);
}

function bindControls() {
  let down = false, lx = 0, ly = 0, downX = 0, downY = 0, dragged = false;
  const rel = e => { const b = cv.getBoundingClientRect(); mouseX = e.clientX - b.left; mouseY = e.clientY - b.top; mClientX = e.clientX; mClientY = e.clientY; };
  cv.addEventListener('pointerdown', e => { down = true; dragged = false; lx = downX = e.clientX; ly = downY = e.clientY; rel(e); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    rel(e);
    if (!down) return;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > DRAG_SLOP) dragged = true;   // look-drag, not a click
    if (returnRide) { lx = e.clientX; ly = e.clientY; return; }
    cam.yaw += (e.clientX - lx) * 0.004; cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch - (e.clientY - ly) * 0.004)); lx = e.clientX; ly = e.clientY;
  });
  // left-click (no drag): star → BLOOM it (persists as part of the trail) + pin its panel, priority-solving
  // via the runtime; node → pin its panel; empty space → just clear the panel (blooms stay — right-click
  // collapses them, so you can leave a trail of open stars).
  cv.addEventListener('pointerup', e => {
    down = false;
    if (e.button !== 0 || dragged) return;   // left-click only — right-click is handled by contextmenu (collapse)
    if (hover && hover.kind === 'star') {
      const g = hover.grid, gz = cosmos.zones.get(g);
      if (gz && (gz.unsolvable || gz.monster)) { selected = hover; }   // frontier dust / monster → inspect only (monster has a SOLVE ANYWAY button)
      else {
        if (!bloomed.has(g)) { if (gz) delete gz._bloom; bloomed.add(g); }   // fresh grow
        cosmos.setFocus(g); ensureFocusBloom(gz); selected = hover;
      }
    } else if (hover && hover.kind === 'node') {
      cosmos.setFocus(hover.grid); selected = hover;   // focus the bloom you're interacting with (the filter targets it)
      leadVoice = { ...deriveVoice(hover.layers), node: hover };   // node click = "make it sound" (stars don't set a lead)
      setLead(leadVoice); openCockpit();   // M4: no per-star song solve — the global sky chord tints it (cosmos-audio.js)
    } else if (hover && hover.kind === 'web') {
      selected = { kind: 'web', webId: hover.webId };
    } else {
      selected = null;
    }
    webRenderer?.select(selected?.kind === 'web' ? selected.webId : null);
    showDetail(selected);
  });
  // right-click a bloom (its star OR any of its nodes) → COLLAPSE it back to a plain dot
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    const g = hover && hover.grid;
    if (g != null && bloomed.has(g)) {
      bloomed.delete(g);
      const z = cosmos.zones.get(g); if (z) delete z._bloom;
      if (cosmos.focusGrid === g) cosmos.setFocus(null);
      if (selected && selected.grid === g) { selected = null; showDetail(null); }
    }
  });
  cv.addEventListener('pointerleave', () => { mouseX = -1; mouseY = -1; if (tipEl) tipEl.style.display = 'none'; if (cv) cv.style.cursor = 'crosshair'; });
  // scroll = quick "flight": dolly forward/back along the view direction (Helix's primary travel)
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (returnRide) return;
    const { d } = camBasis();
    const dist = placement === 'hilbert' ? CELL * HIL_DOLLY_CELLS : DOLLY;   // gentle in the cube
    const step = dist * (e.deltaY < 0 ? 1 : -1);
    translateCam([d[0] * step, d[1] * step, d[2] * step]);
  }, { passive: false });
  const typing = t => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  window.addEventListener('keydown', e => {
    if (M.mode !== 'flight' || typing(e.target)) return;
    const k = e.key.toLowerCase(); const firstPress = !keys[k]; keys[k] = true;
    if (firstPress && k === 'escape') { cancelWebReturn(); e.preventDefault(); }
    if (firstPress && /^[0-9]$/.test(k)) { toggleSlot(k === '0' ? 9 : +k - 1); if (selected) showDetail(selected); }   // 1-9,0 → hide/show web slots
    if (firstPress && k === 'b' && swarm) { if (swarm.agents.length) swarm.clear(); else swarm.spawn(AGENT_COUNT, cam.anchor); }   // B → toggle Collider-Battle ships
    if (firstPress && k === 'm') toggleMute();   // M → mute cosmos-audio (transport keeps ticking, only output is silenced)
    if (firstPress && k === 'c') { skyDebugOn = !skyDebugOn; if (skyDebugEl) skyDebugEl.style.display = skyDebugOn ? 'block' : 'none'; }   // C → toggle the Full Sky debug overlay (dev)
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();   // don't scroll the page
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('resize', () => { if (cv) resize(); });
}
