// assert-rail-view.mjs — proofs for the Phase 3 RAIL skeleton (../rail-view.js): the param→setter map,
// the readout formatter, and — critically — the "gestures only, NO emitNow" discipline that keeps a
// startup replay from repainting today's default sound before the knobs are calibrated (see the module
// header + the handoff's ⚠ gotcha). The DOM build (ensureRail) needs a document; here we pin the pure,
// export-visible pieces and scan the source for the wiring/anti-regression facts.
import { readFileSync } from 'node:fs';
import { RAIL_KNOBS, ENGINE_SETTERS, formatReadout } from '../rail-view.js';
import { railParams, RAIL_PARAMS } from '../rail-params.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ COSMOS RAIL VIEW — assertions ═══');

console.log('\n  The rendered rail + its engine bindings');
// The safe knobs (no mode side-effect, defaults reproduce today's sound) + MIX, across pitch/harmony/texture.
const SAFE_KNOBS = ['fundamental', 'richness', 'volume', 'mix', 'space'];
check('the rail renders the safe knobs + MIX (pitch/harmony/texture)',
  Array.isArray(RAIL_KNOBS) && RAIL_KNOBS.length === SAFE_KNOBS.length && SAFE_KNOBS.every(n => RAIL_KNOBS.includes(n)));
check('the time-group knobs (SPEED, DWELL) are NOT wired yet — mode-flip / calibration pending',
  !RAIL_KNOBS.includes('speed') && !RAIL_KNOBS.includes('dwell'));
check('every rendered knob is a real param and has a live engine setter (no dangling / silent knobs)',
  RAIL_KNOBS.every(n => RAIL_PARAMS[n] && typeof ENGINE_SETTERS[n] === 'function'));
check('every ENGINE_SETTERS key is a real param — the map can never bind a name the state layer lacks',
  Object.keys(ENGINE_SETTERS).every(n => n in RAIL_PARAMS));
// DENSITY has no engine setter yet (Phase 4): it must stay out of both the setter map and the rendered rail.
check('DENSITY stays unbound (Phase 4, no setter) — absent from the setter map and the rail',
  !('density' in ENGINE_SETTERS) && !RAIL_KNOBS.includes('density'));

console.log('\n  Readout formatting (spec + engine value → string)');
check('booleans read ON / OFF',
  formatReadout(RAIL_PARAMS.modulation, true) === 'ON' && formatReadout(RAIL_PARAMS.mute, false) === 'OFF');
check('detents read as integer stops', formatReadout(RAIL_PARAMS.density, 2) === '2');
check('cents read as a signed integer with the ¢ unit',
  formatReadout(RAIL_PARAMS.fundamental, -700) === '-700¢' && formatReadout(RAIL_PARAMS.fundamental, 0) === '0¢');
check('unit-fraction knobs read to two decimals (MIX / VOLUME / SPACE)',
  formatReadout(RAIL_PARAMS.mix, 0.5) === '0.50' && formatReadout(RAIL_PARAMS.volume, 0.85) === '0.85' &&
  formatReadout(RAIL_PARAMS.space, 0.5) === '0.50');
check('wider-range knobs read to one decimal with their unit (SPEED)',
  formatReadout(RAIL_PARAMS.speed, 2.5) === '2.5 notes/s');

console.log('\n  MIX round-trip through the state layer (what a drag then does)');
// A knob at 0.5 normalized → the crossfade midpoint; the readout mirrors railParams.get exactly.
railParams.setNorm('mix', 0.5);
check('setNorm(mix, 0.5) lands at 0.5 and the readout mirrors railParams.get',
  railParams.get('mix') === 0.5 && formatReadout(RAIL_PARAMS.mix, railParams.get('mix')) === '0.50');
railParams.reset('mix');   // hygiene: back to the shipped default (0 = pure bed)
check('reset(mix) restores the default 0 (pure bed)', railParams.get('mix') === 0);
// FUNDAMENTAL is linear-in-cents (±1200 knob): the midpoint is 0¢, and the readout carries the ¢ unit.
railParams.setNorm('fundamental', 0.5);
check('setNorm(fundamental, 0.5) lands at 0¢ (knob midpoint = no offset)', railParams.get('fundamental') === 0);
railParams.setNorm('fundamental', 1);
check('setNorm(fundamental, 1) lands at the +1200¢ knob ceiling', railParams.get('fundamental') === 1200);
railParams.reset('fundamental');
check('reset(fundamental) restores 0¢', railParams.get('fundamental') === 0);

console.log('\n  Product wiring + the critical anti-regression (⚠ gestures only)');
const src = readFileSync(new URL('../rail-view.js', import.meta.url), 'utf8');
check('the rail mounts as a sibling of #lrc-div inside #cosmos-view',
  src.includes("getElementById('cosmos-view')") && src.includes("rail.id = 'cosmos-rail'") && src.includes('host.appendChild(rail)'));
check('gestures drive the engine through the guarded setter map, then repaint the knob',
  src.includes('ENGINE_SETTERS[name]?.(value)') && src.includes('railParams.subscribe(') && src.includes('paintKnob(name'));
check('a gesture calls setNorm (normalized → curve) — never a raw engine value from the DOM',
  src.includes('railParams.setNorm(name,'));
// The knob is the site's ADSR rotary, reused class-for-class and swept the same 270° (ToneRowPlayback.js).
check('the knob reuses the ADSR rotary (.knob/.knob-indicator) and its 270° indicator sweep',
  src.includes("dial.className = 'knob'") && src.includes("indicator.className = 'knob-indicator'") && src.includes('KNOB_SWEEP_DEG = 270'));
// THE gotcha: subscribing with {emitNow} would replay every persisted value on entry and flip SPEED into
// ONSET mode + repaint the default sound before calibration. The skeleton must NOT restore on entry yet.
// Match the OPTION-KEY form (`emitNow:`), not the word — the header/prose legitimately name the gotcha.
check('⚠ NO emitNow — persisted values are NOT replayed on entry (restoration turns on post-calibration)',
  !/emitNow\s*:/.test(src));
check('the module imports its state from rail-params and its setters from cosmos-audio',
  src.includes("from './rail-params.js'") && src.includes("from './cosmos-audio.js'"));

console.log(PASS ? '\n✓✓✓ COSMOS RAIL VIEW PASSES' : '\n✗ COSMOS RAIL VIEW FAILED');
process.exit(PASS ? 0 : 1);
