// cosmos-quality.js — the single performance-budget authority for Cosmos flight.
//
// ONE source of truth for every resource knob the flight engine spends CPU/GPU on:
// worker concurrency, frontier reach, eviction depth, backing-store DPR, solve
// backlog, the bloom-cloud range cull, the frame-rate cap, and the row voices' panning model.
// flight-view.js reads the ACTIVE tier from here and pushes it into its module knobs
// (see applyQuality there); this file stays pure data + detection so it is testable
// headless (assert-cosmos-quality.mjs) with no DOM/engine coupling.
//
// HARMONY IS NEVER A QUALITY KNOB. Avery's standing rule: "Low = shorter horizon +
// softer pixels, never dumber harmony." AUDIBLE_N, richness, and all pitch selection
// live in the audio core and are deliberately ABSENT from every tier below — the
// guard asserts none of those keys ever leak in, so "Low stays musically honest" is
// enforced structurally, not by discipline.

// Each tier is a flat bag of budgets. Values are non-decreasing across QUALITY_ORDER
// (the guard proves it) so "raise quality" only ever adds work, never removes it.
export const ROW_PANNING_ORDER = ['equalpower', 'HRTF'];   // cheaper → dearer; tiers climb it, never descend
export const QUALITY_TIERS = {
  // 2026-09-28: Low and Medium made stricter after a field report — an older MacBook on a lap overheated and
  // its audio crackled. Low now solves one shard at a time, reaches a cell less, and draws at 30 fps.
  low: {
    id: 'low', label: 'Low',
    poolCap: 1,        // live cap on cosmos.poolSize (concurrent solver shards); physical pool stays at device max
    spawn: 5,          // HIL_SPAWN — frontier reach in cube cells (the master working-set lever)
    evict: 10,         // HIL_EVICT — retention depth of the trailing wake (≈ spawn + a few)
    spawnMin: 3,       // HIL_SPAWN_MIN — floor the adaptive backpressure eases down to under load
    dprCap: 1,         // clamp on backing-store devicePixelRatio (fill cost ∝ dpr²)
    solveBacklog: 40,  // pending+solving above which the frontier starts shrinking
    // Bloom LOD by RANGE = fastest layer ÷ slowest layer. A huge range is a DEGENERATE "rhythm": one layer
    // firing hundreds of thousands of times against another firing twice (e.g. 443549:2 at grid 887,098,
    // range ≈ 221,774) — no musical content, and the priciest node to carry. Culling it is not culling
    // information; it also thins the per-frame bloom loop (hotspot C). High/Ultra keep everything.
    bloomMaxRange: 100,   // cull polyrhythms whose range exceeds this
    // Frame-rate cap. The Canvas 2D draw on the main thread is the biggest single per-frame cost, and heat is
    // sustained total CPU, so halving the frames halves it. Infinity = follow the display (60 / 120 Hz).
    maxFps: 30,
    // Row-voice panning. 'HRTF' is true 3D (above/below, front/back) but runs a convolution per sounding star
    // on the audio thread — ~8× equal-power in a measured offline render. 'equalpower' keeps left/right.
    rowPanning: 'equalpower',
  },
  medium: {
    id: 'medium', label: 'Medium',
    poolCap: 2, spawn: 8, evict: 16, spawnMin: 4, dprCap: 1.5,
    solveBacklog: 60, bloomMaxRange: 1000, maxFps: Infinity, rowPanning: 'equalpower',
  },
  high: {
    id: 'high', label: 'High',
    poolCap: 6, spawn: 10, evict: 20, spawnMin: 4, dprCap: 2,
    solveBacklog: 80, bloomMaxRange: Infinity,   // keep every rhythm
    maxFps: Infinity, rowPanning: 'HRTF',
  },
  ultra: {
    id: 'ultra', label: 'Ultra',
    poolCap: 8, spawn: 12, evict: 24, spawnMin: 5, dprCap: 2,
    solveBacklog: 120, bloomMaxRange: Infinity, maxFps: Infinity, rowPanning: 'HRTF',
  },
};

// Low → Ultra. The order IS the monotonicity contract and the slider-tab order.
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

// The physical solver pool is always spawned at the device maximum (this many workers
// exist); a tier's poolCap only throttles how many run CONCURRENTLY via cosmos.poolSize.
// So dialing quality down idles workers instead of tearing them down — the live slider
// costs nothing. Mirrors flight-view's historical poolSize expression.
export function devicePoolMax(nav = defaultNav()) {
  return Math.max(2, Math.min(8, (nav.hardwareConcurrency || 4) - 2));
}

// Resolve a tier id to its budget bag; unknown/empty ids fall back to the safe default
// tier rather than throwing, so a stale localStorage value can never brick a session.
export function resolveTier(id) {
  return QUALITY_TIERS[id] || QUALITY_TIERS[DEFAULT_TIER_FALLBACK];
}
const DEFAULT_TIER_FALLBACK = 'medium';

// Device-class default. Conservative on purpose: this is what an UNKNOWN visitor to a
// public deploy lands on before they've touched the slider, so it must be safe on a
// mid laptop, not tuned for the author's 14-core.
//   • cores ≤ 4, or a machine that admits ≤ 4 GiB RAM        → low
//   • a software renderer (no real GPU)                      → low
//   • built-in Intel graphics: ≤ 8 cores → low, else medium (never high)
//   • cores ≥ 12 (a real desktop)                            → high
//   • everything else / unknown                              → medium
// Ultra is NEVER auto-selected — it is an explicit opt-in for beasts.
// deviceMemory is coarse and unreliable (Chrome caps it at 8, Safari/Firefox omit it),
// so it can only DROP a machine to low, never lift one — cores is the primary signal.
// The GPU likewise only ever lowers a tier. Built-in Intel graphics marks a pre-Apple-Silicon
// Mac or a thin Windows laptop — the machines that throttle hot (2026-09-28 field report: a
// 2020 13" MacBook Pro, quad i5 = 8 threads, read as Medium by cores alone and crackled).
// Safari reports every Mac as "Apple GPU", so there this signal is simply absent.
export function detectDefaultTier(nav = defaultNav(), gpu = '') {
  const cores = nav.hardwareConcurrency;   // logical cores, or undefined on old/odd hosts
  const mem = nav.deviceMemory;            // GiB, or undefined (Safari/Firefox always omit)
  const g = gpuClass(gpu);
  // An EXPLICIT low reading drops the machine; a machine that reports NOTHING gets the
  // benefit of the doubt at medium (safe middle), never assumed to be a 4-core.
  if (cores !== undefined && cores <= 4) return 'low';
  if (mem !== undefined && mem <= 4) return 'low';
  if (g === 'software') return 'low';
  if (g === 'intel-integrated') return cores !== undefined && cores > 8 ? 'medium' : 'low';
  if (cores !== undefined && cores >= 12) return 'high';
  return 'medium';
}

// Classify a WebGL renderer string. Intel Arc is a discrete card, not built-in graphics.
export function gpuClass(renderer) {
  const r = String(renderer || '').toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(r)) return 'software';
  if (/\bintel\b/.test(r) && !/\barc\b/.test(r)) return 'intel-integrated';
  return 'other';
}

// The GPU name the browser admits to, or '' (no DOM, no WebGL, or anything throws). Firefox gives the
// real name through RENDERER; Chrome and Safari answer 'WebKit WebGL' there and need the debug extension
// (Safari then says 'Apple GPU' for every Mac). The throwaway context is released at once.
export function readGpuRenderer() {
  try {
    if (typeof document === 'undefined') return '';
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    let name = String(gl.getParameter(gl.RENDERER) || '');
    if (!name || /^webkit webgl$/i.test(name)) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || name);
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

function defaultNav() {
  return (typeof navigator !== 'undefined') ? navigator : {};
}

// ── The listener's choice ────────────────────────────────────────────────────────────────────────────
// The View popup's QUALITY pills. Only an explicit tap is saved: with nothing saved, every load re-detects,
// so a visitor who never touches the slider always gets this machine's recommendation. Once they tap a tier
// it sticks across visits. There is deliberately no automatic step-down — the listener has the final say,
// and the only nudge is qualityWarning() under the pills.
export const QUALITY_STORAGE_KEY = 'lrc.cosmos.quality.v1';

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function createQualityPrefs({ storage, nav, gpu, key = QUALITY_STORAGE_KEY } = {}) {
  const store = storage !== undefined ? storage : defaultStorage();
  // Probe the real GPU only for the real navigator; a caller passing a fake nav (the guard) stays pure.
  if (gpu === undefined) gpu = nav === undefined ? readGpuRenderer() : '';
  const detected = detectDefaultTier(nav, gpu);
  let tier = detected, override = false;
  try {
    const blob = JSON.parse(store?.getItem(key) || 'null');
    // An unreadable or stale choice is NO choice → detection. Not resolveTier's medium fallback: that
    // would pin a 14-core machine to medium because a tier was once renamed.
    if (blob && Object.hasOwn(QUALITY_TIERS, blob.tier)) { tier = blob.tier; override = true; }
  } catch {}
  const listeners = new Set();
  const persist = () => { try { store?.setItem(key, JSON.stringify({ tier })); } catch {} };
  const notify = () => { for (const fn of listeners) { try { fn(tier); } catch {} } };
  return {
    get: () => tier,
    detected,
    gpu,
    isOverride: () => override,
    set(id) {
      if (!Object.hasOwn(QUALITY_TIERS, id)) return tier;
      if (id === tier) {
        // Tapping the recommended tier still counts as a choice: it must survive a later change in detection.
        if (!override) { override = true; persist(); }
        return tier;
      }
      tier = id; override = true; persist(); notify();
      return tier;
    },
    // Dev-handle only: drop the saved choice and go back to this machine's recommendation.
    forget() {
      try { store?.removeItem(key); } catch {}
      override = false;
      if (tier !== detected) { tier = detected; notify(); }
      return tier;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// The one line under the pills: only when the listener has chosen more than this machine was recommended.
export function qualityWarning(chosenId, detectedId) {
  return QUALITY_ORDER.indexOf(chosenId) > QUALITY_ORDER.indexOf(detectedId)
    ? "Above this machine's recommended setting — may stutter or run hot."
    : '';
}
