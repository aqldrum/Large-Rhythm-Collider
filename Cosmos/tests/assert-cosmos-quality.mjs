// Assertions for the Cosmos performance-quality authority: tier coverage, the
// monotonicity contract (raising quality only ever adds work), the device-class
// default detector, and — structurally — Avery's "never dumber harmony" rule.
import { QUALITY_TIERS, QUALITY_ORDER, ROW_PANNING_ORDER, gpuClass, detectDefaultTier, devicePoolMax, resolveTier, createQualityPrefs, qualityWarning, QUALITY_STORAGE_KEY } from '../engine/cosmos-quality.js';

let PASS = true;
const check = (name, ok, detail = '') => {
  PASS = PASS && ok;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('═══ COSMOS QUALITY — governor assertions ═══');

console.log('\n[1] Tier coverage');
check('QUALITY_ORDER lists every tier exactly once',
  QUALITY_ORDER.length === Object.keys(QUALITY_TIERS).length &&
  QUALITY_ORDER.every(id => QUALITY_TIERS[id]) &&
  new Set(QUALITY_ORDER).size === QUALITY_ORDER.length);
check('each tier\'s id matches its key', QUALITY_ORDER.every(id => QUALITY_TIERS[id].id === id));
check('order runs low → ultra', QUALITY_ORDER.join(',') === 'low,medium,high,ultra');

console.log('\n[2] Monotonicity — raising quality only adds work, never removes it');
// bloomMaxRange non-decreasing means a higher tier keeps MORE rhythms (bigger allowed range) — Low is strictest.
const NUMERIC_BUDGETS = ['poolCap', 'spawn', 'evict', 'spawnMin', 'dprCap', 'solveBacklog', 'bloomMaxRange', 'maxFps'];
for (const key of NUMERIC_BUDGETS) {
  let ok = true, prev = -Infinity, trail = [];
  for (const id of QUALITY_ORDER) { const v = QUALITY_TIERS[id][key]; trail.push(v); ok = ok && v >= prev; prev = v; }
  check(`${key} is non-decreasing`, ok, trail.join(' ≤ '));
}
{
  const rank = QUALITY_ORDER.map(id => ROW_PANNING_ORDER.indexOf(QUALITY_TIERS[id].rowPanning));
  check('every tier names a known row panning model, and it never gets cheaper as quality rises',
    rank.every(r => r >= 0) && rank.every((r, i) => i === 0 || r >= rank[i - 1]), QUALITY_ORDER.map(id => QUALITY_TIERS[id].rowPanning).join(' ≤ '));
  check('low caps the frame rate; high and ultra follow the display',
    QUALITY_TIERS.low.maxFps < 60 && QUALITY_TIERS.high.maxFps === Infinity && QUALITY_TIERS.ultra.maxFps === Infinity);
}
console.log('\n[3] "Never dumber harmony" — enforced structurally');
// If anyone ever tries to make harmony a quality knob, this fails. Horizon/pixels/CPU
// degrade with the tier; pitch selection (AUDIBLE_N, richness, roots, scale) does not.
const FORBIDDEN = ['audiblen', 'audible_n', 'richness', 'roots', 'rootradius', 'scale', 'harmony', 'chord', 'consonance', 'voices'];
let harmonyClean = true, offenders = [];
for (const id of QUALITY_ORDER) {
  for (const key of Object.keys(QUALITY_TIERS[id])) {
    if (FORBIDDEN.some(f => key.toLowerCase().includes(f))) { harmonyClean = false; offenders.push(`${id}.${key}`); }
  }
}
check('no tier carries a harmony/selection knob', harmonyClean, offenders.join(', '));

console.log('\n[4] Device-class default — conservative for an unknown public visitor');
check('a 2-core machine → low', detectDefaultTier({ hardwareConcurrency: 2 }) === 'low');
check('a 4-core machine → low', detectDefaultTier({ hardwareConcurrency: 4 }) === 'low');
check('an 8-core / 8 GiB machine → medium', detectDefaultTier({ hardwareConcurrency: 8, deviceMemory: 8 }) === 'medium');
check('an 8-core machine that admits ≤4 GiB → low', detectDefaultTier({ hardwareConcurrency: 8, deviceMemory: 4 }) === 'low');
check('a 16-core desktop → high', detectDefaultTier({ hardwareConcurrency: 16, deviceMemory: 8 }) === 'high');
check('a 16-core machine with no deviceMemory report → high (cores lead)', detectDefaultTier({ hardwareConcurrency: 16 }) === 'high');
check('an empty/unknown navigator → medium (safe middle)', detectDefaultTier({}) === 'medium');
check('ultra is never auto-selected', QUALITY_ORDER.every(id => detectDefaultTier({ hardwareConcurrency: 64, deviceMemory: 64 }) !== 'ultra'));

console.log('\n[4b] The GPU only ever lowers a tier');
{
  const irisMac = 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics, OpenGL 4.1)';
  check('the field-report MacBook (8 threads, Intel Iris Plus) → low', detectDefaultTier({ hardwareConcurrency: 8 }, irisMac) === 'low');
  check('built-in Intel graphics with > 8 cores → medium, never high', detectDefaultTier({ hardwareConcurrency: 16 }, 'Intel(R) UHD Graphics 630') === 'medium');
  check('a software renderer → low even on a big machine', detectDefaultTier({ hardwareConcurrency: 16 }, 'Google SwiftShader') === 'low');
  check('Intel Arc is a discrete card, not built-in graphics', gpuClass('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11)') === 'other');
  check('Apple Silicon and Safari\'s masked "Apple GPU" change nothing',
    detectDefaultTier({ hardwareConcurrency: 14 }, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)') === 'high' &&
    detectDefaultTier({ hardwareConcurrency: 8 }, 'Apple GPU') === 'medium');
  check('no GPU string → the core-count rules alone', detectDefaultTier({ hardwareConcurrency: 8 }, '') === 'medium');
  const tierRank = id => QUALITY_ORDER.indexOf(id);
  let never = true;
  for (const cores of [2, 4, 6, 8, 10, 12, 16, 24]) for (const gpu of ['', irisMac, 'Google SwiftShader', 'NVIDIA GeForce RTX 4090', 'Apple GPU'])
    if (tierRank(detectDefaultTier({ hardwareConcurrency: cores }, gpu)) > tierRank(detectDefaultTier({ hardwareConcurrency: cores }, ''))) never = false;
  check('across cores × GPUs, a GPU reading never RAISES the tier above the cores-only answer', never);
}

console.log('\n[5] Physical pool max vs live throttle');
check('devicePoolMax mirrors max(2, min(8, cores-2)) on a 14-core host', devicePoolMax({ hardwareConcurrency: 14 }) === 8);
check('devicePoolMax floors at 2 on a dual-core host', devicePoolMax({ hardwareConcurrency: 2 }) === 2);
check('every tier\'s live poolCap fits inside the device pool max',
  QUALITY_ORDER.every(id => QUALITY_TIERS[id].poolCap <= devicePoolMax({ hardwareConcurrency: 14 })));

console.log('\n[6] resolveTier is brick-proof');
check('a known id resolves to its tier', resolveTier('high').id === 'high');
check('an unknown/stale id falls back to medium (never throws, never bricks)', resolveTier('garbage-from-localStorage').id === 'medium');
check('undefined resolves to the safe default', resolveTier(undefined).id === 'medium');

console.log('\n[7] The listener\'s choice — saved only when tapped, detection otherwise');
{
  const memoryStorage = () => { const m = new Map(); let writes = 0;
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { writes++; m.set(k, String(v)); }, removeItem: k => m.delete(k), m, writes: () => writes }; };
  const big = { hardwareConcurrency: 14 }, small = { hardwareConcurrency: 4 };

  const st = memoryStorage();
  const p = createQualityPrefs({ storage: st, nav: big });
  check('nothing saved → the detected tier, not an override', p.get() === 'high' && p.detected === 'high' && !p.isOverride());
  check('nothing saved → a later load re-detects on a different machine', createQualityPrefs({ storage: st, nav: small }).get() === 'low');
  check('creating the store writes nothing', st.writes() === 0);

  const seen = []; p.subscribe(id => seen.push(id));
  p.set('low');
  check('a tap changes the tier, saves it, and notifies once', p.get() === 'low' && p.isOverride() && seen.join() === 'low'
    && JSON.parse(st.m.get(QUALITY_STORAGE_KEY)).tier === 'low');
  check('a saved choice survives a reload regardless of the machine', createQualityPrefs({ storage: st, nav: big }).get() === 'low');
  const w = st.writes(); p.set('low');
  check('re-tapping the active override neither writes nor notifies', st.writes() === w && seen.length === 1);
  p.set('ludicrous');
  check('an unknown tier is ignored', p.get() === 'low' && seen.length === 1);

  const st2 = memoryStorage(), p2 = createQualityPrefs({ storage: st2, nav: big }), seen2 = [];
  p2.subscribe(id => seen2.push(id)); p2.set('high');
  check('tapping the recommended tier saves it (survives a later detection change) without notifying',
    p2.isOverride() && seen2.length === 0 && createQualityPrefs({ storage: st2, nav: small }).get() === 'high');

  p.forget();
  check('forget() clears the saved choice and returns to detection, notifying the change',
    p.get() === 'high' && !p.isOverride() && !st.m.has(QUALITY_STORAGE_KEY) && seen.at(-1) === 'high');

  const junk = ['{"tier":"garbage"}', '{"tier":"toString"}', '{"nope":1}', 'not json', '"high"', 'null'];
  check('an unreadable or stale saved value falls back to DETECTION, not medium',
    junk.every(v => { const s = memoryStorage(); s.m.set(QUALITY_STORAGE_KEY, v);
      const q = createQualityPrefs({ storage: s, nav: big }); return q.get() === 'high' && !q.isOverride(); }));

  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  let ok = true;
  try { const q = createQualityPrefs({ storage: throwing, nav: small }); ok = q.get() === 'low' && q.set('medium') === 'medium' && q.get() === 'medium' && q.forget() === 'low'; }
  catch { ok = false; }
  check('storage that throws never throws out — the tier still changes live', ok);
  const none = createQualityPrefs({ storage: null, nav: {} });
  check('no storage at all → detection only', none.get() === 'medium' && none.set('low') === 'low');
}

console.log('\n[8] The warning under the pills');
{
  let ok = true;
  for (const d of QUALITY_ORDER) for (const c of QUALITY_ORDER) {
    const above = QUALITY_ORDER.indexOf(c) > QUALITY_ORDER.indexOf(d);
    if (!!qualityWarning(c, d) !== above) ok = false;
  }
  check('warns only when the choice is strictly above the detected tier (all 16 pairs)', ok);
}

console.log(`\n${PASS ? '✓✓✓ QUALITY GOVERNOR PASSES — monotonic, harmony-safe, conservative default' : '✗ QUALITY GOVERNOR FAILED'}`);
process.exit(PASS ? 0 : 1);
