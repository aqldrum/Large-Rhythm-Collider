// Assertions for the Cosmos performance-quality authority: tier coverage, the
// monotonicity contract (raising quality only ever adds work), the device-class
// default detector, and — structurally — Avery's "never dumber harmony" rule.
import { QUALITY_TIERS, QUALITY_ORDER, detectDefaultTier, devicePoolMax, resolveTier } from '../cosmos-quality.js';

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
const NUMERIC_BUDGETS = ['poolCap', 'spawn', 'evict', 'spawnMin', 'dprCap', 'solveBacklog', 'bloomMaxRange'];
for (const key of NUMERIC_BUDGETS) {
  let ok = true, prev = -Infinity, trail = [];
  for (const id of QUALITY_ORDER) { const v = QUALITY_TIERS[id][key]; trail.push(v); ok = ok && v >= prev; prev = v; }
  check(`${key} is non-decreasing`, ok, trail.join(' ≤ '));
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

console.log('\n[5] Physical pool max vs live throttle');
check('devicePoolMax mirrors max(2, min(8, cores-2)) on a 14-core host', devicePoolMax({ hardwareConcurrency: 14 }) === 8);
check('devicePoolMax floors at 2 on a dual-core host', devicePoolMax({ hardwareConcurrency: 2 }) === 2);
check('every tier\'s live poolCap fits inside the device pool max',
  QUALITY_ORDER.every(id => QUALITY_TIERS[id].poolCap <= devicePoolMax({ hardwareConcurrency: 14 })));

console.log('\n[6] resolveTier is brick-proof');
check('a known id resolves to its tier', resolveTier('high').id === 'high');
check('an unknown/stale id falls back to medium (never throws, never bricks)', resolveTier('garbage-from-localStorage').id === 'medium');
check('undefined resolves to the safe default', resolveTier(undefined).id === 'medium');

console.log(`\n${PASS ? '✓✓✓ QUALITY GOVERNOR PASSES — monotonic, harmony-safe, conservative default' : '✗ QUALITY GOVERNOR FAILED'}`);
process.exit(PASS ? 0 : 1);
