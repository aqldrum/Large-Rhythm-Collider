// assert-rail-params.mjs — proofs for the Phase 1 knob-rail parameter module (../rail-params.js). It owns
// defaults, clamps, curve mappings, a change-listener API, and a localStorage round-trip on the PERSISTED
// subset (decision 8), so every Phase-2 knob is a thin binding. No AudioContext or DOM required.
import {
  RailParams, RAIL_PARAMS, RAIL_SCHEMA_VERSION, railParams,
  clampParam, normToValue, valueToNorm, deserializeRail,
} from '../ui/rail-params.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const makeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _map: m }; };

console.log('═══ COSMOS RAIL PARAMS — assertions ═══');

console.log('\n  Defaults & the shipped rail');
const p = new RailParams({ storage: makeStorage() });
check('every param initialises to its declared default',
  Object.entries(RAIL_PARAMS).every(([name, spec]) => p.get(name) === spec.default));
// Decision 9's shipped rail must all be present and persisted; the transient toggles must not persist.
check('the shipped musical knobs are all present and persisted',
  ['volume', 'fundamental', 'speed', 'richness', 'mix', 'space', 'harmonySource', 'scale', 'rowFundamental'].every(n => RAIL_PARAMS[n]?.persist === true));
check('retired DENSITY/DWELL are absent from the user-facing state model', !RAIL_PARAMS.density && !RAIL_PARAMS.dwell);
check('modulation persists while mute, HOLD, and MIDI-out are transient',
  RAIL_PARAMS.modulation.persist === true && RAIL_PARAMS.modulation.default === true &&
  RAIL_PARAMS.mute.persist === false && RAIL_PARAMS.hold.persist === false && RAIL_PARAMS.midiOut.persist === false);
check('ROW 1/1 preserves today\'s sound by default', RAIL_PARAMS.rowFundamental.default === true && RAIL_PARAMS.rowFundamental.persist === true);
// The entry sound is now the RAIL's: MIX 0.8 is rows-forward with the bed audible underneath (Avery,
// 2026-07-29), replacing the pure-rows entry the audio lab's mode select used to impose.
check('MIX defaults to the rows-forward blend the rail restores on entry', RAIL_PARAMS.mix.default === 0.8);
// v1 blobs were written while the LAB still owned the engine — a stored `mix: 0` would come up ambient-only.
check('the schema version was bumped past the pre-transfer (v1) layout', RAIL_SCHEMA_VERSION >= 2);
check('a shared singleton is exported for the running instrument', railParams instanceof RailParams);

console.log('\n  Clamps (the stored form is always legal)');
check('linear values clamp to [min,max]',
  clampParam(RAIL_PARAMS.mix, 2) === 1 && clampParam(RAIL_PARAMS.mix, -1) === 0 &&
  clampParam(RAIL_PARAMS.fundamental, 99999) === 1200 && clampParam(RAIL_PARAMS.fundamental, -99999) === -1200);
check('detents snap to integer stops within range',
  clampParam(RAIL_PARAMS.richness, 2.4) === 2 && clampParam(RAIL_PARAMS.richness, 9) === 3 && clampParam(RAIL_PARAMS.richness, 0) === 1);
check('fixed choices accept known values and reject unknown values to the default',
  clampParam(RAIL_PARAMS.harmonySource, 'scale') === 'scale' && clampParam(RAIL_PARAMS.harmonySource, 'other') === 'chord-walk');
check('bools coerce and a non-finite value falls back to the default',
  clampParam(RAIL_PARAMS.modulation, 1) === true && clampParam(RAIL_PARAMS.mute, '') === false &&
  clampParam(RAIL_PARAMS.speed, NaN) === RAIL_PARAMS.speed.default);

console.log('\n  Curve mappings (normalized knob position ↔ engine value)');
check('linear FUNDAMENTAL is centred: pos 0/0.5/1 → −1200/0/+1200¢',
  normToValue(RAIL_PARAMS.fundamental, 0) === -1200 && normToValue(RAIL_PARAMS.fundamental, 0.5) === 0 &&
  normToValue(RAIL_PARAMS.fundamental, 1) === 1200);
check('log SPEED travels evenly in ratio: the knob midpoint is the geometric mean of the ends',
  near(normToValue(RAIL_PARAMS.speed, 0), 0.5) && near(normToValue(RAIL_PARAMS.speed, 1), 16) &&
  near(normToValue(RAIL_PARAMS.speed, 0.5), Math.sqrt(0.5 * 16)));
check('detent RICHNESS maps the travel to its three vocabulary stops',
  normToValue(RAIL_PARAMS.richness, 0) === 1 && normToValue(RAIL_PARAMS.richness, 0.5) === 2 && normToValue(RAIL_PARAMS.richness, 1) === 3);
check('valueToNorm inverts normToValue for every curve',
  [0, 0.25, 0.5, 0.75, 1].every(pos =>
    near(valueToNorm(RAIL_PARAMS.speed, normToValue(RAIL_PARAMS.speed, pos)), pos) &&
    near(valueToNorm(RAIL_PARAMS.fundamental, normToValue(RAIL_PARAMS.fundamental, pos)), pos)) &&
  valueToNorm(RAIL_PARAMS.richness, 2) === 0.5 && valueToNorm(RAIL_PARAMS.harmonySource, 'scale') === 1);
check('setNorm drives the engine value through the curve, and norm() reads it back',
  (() => { p.setNorm('speed', 0.5); return near(p.get('speed'), Math.sqrt(8)) && near(p.norm('speed'), 0.5); })());

console.log('\n  Change-listener API (knobs and the engine both subscribe)');
let events = [];
const off = p.subscribe((name, value) => events.push([name, value]));
p.set('mix', 0.4);
check('a set notifies subscribers with the clamped value', events.length === 1 && events[0][0] === 'mix' && events[0][1] === 0.4);
events = [];
p.set('mix', 0.4);
check('a no-op set (value unchanged) neither notifies nor churns the engine', events.length === 0);
events = [];
p.set('mix', 5);
check('an out-of-range set notifies with the clamped-into-range value', events.length === 1 && events[0][1] === 1);
events = [];
p.set('mix', 0.2, { silent: true });
check('a silent set updates state without notifying (for loading / programmatic sync)', events.length === 0 && p.get('mix') === 0.2);
off();
p.set('mix', 0.7);
check('unsubscribe stops delivery', events.length === 0);
const replay = [];
p.subscribe((name, value) => replay.push(name), { emitNow: true });
check('emitNow replays every current value so an engine binding syncs the persisted state at startup',
  replay.length === Object.keys(RAIL_PARAMS).length && replay.includes('mix') && replay.includes('fundamental'));

console.log('\n  Persistence round-trip (persisted subset only, schema-versioned)');
const store = makeStorage();
const a = new RailParams({ storage: store });
a.set('fundamental', 700); a.set('mix', 0.6); a.set('richness', 2); a.set('modulation', true);
a.set('harmonySource', 'scale'); a.set('scale', 'chromatic'); a.set('rowFundamental', false);
a.set('mute', true); a.set('hold', true); a.set('midiOut', true);   // transient — must NOT round-trip
const blob = JSON.parse(store.getItem(a.key));
check('the stored blob carries a schema version and the persisted subset',
  blob.v === RAIL_SCHEMA_VERSION && blob.params.fundamental === 700 && blob.params.mix === 0.6 && blob.params.richness === 2 &&
  blob.params.harmonySource === 'scale' && blob.params.scale === 'chromatic' && blob.params.rowFundamental === false);
check('transient params (mute, HOLD, MIDI-out) are excluded from the stored blob',
  !('mute' in blob.params) && !('hold' in blob.params) && !('midiOut' in blob.params));
const b = new RailParams({ storage: store });
check('a fresh instance reloads the persisted musical state, but transient state stays at its default',
  b.get('fundamental') === 700 && b.get('mix') === 0.6 && b.get('richness') === 2 && b.get('modulation') === true &&
  b.get('harmonySource') === 'scale' && b.get('scale') === 'chromatic' && b.get('rowFundamental') === false &&
  b.get('mute') === false && b.get('hold') === false && b.get('midiOut') === false);

console.log('\n  Stale / corrupt storage is discarded, never loaded');
check('deserializeRail rejects corrupt JSON and a mismatched schema version, accepts a current blob',
  deserializeRail('{not json').discarded && deserializeRail(JSON.stringify({ v: RAIL_SCHEMA_VERSION + 1, params: { mix: 1 } })).discarded &&
  !deserializeRail(JSON.stringify({ v: RAIL_SCHEMA_VERSION, params: { mix: 0.9 } })).discarded &&
  deserializeRail(null).params && Object.keys(deserializeRail('').params).length === 0);
const KEY = new RailParams({ storage: makeStorage() }).key;   // the module's storage key
const staleStore = makeStorage();
staleStore.setItem(KEY, JSON.stringify({ v: 999, params: { mix: 0.99, fundamental: 1200 } }));
const stale = new RailParams({ storage: staleStore });
check('an incompatible stored layout loads defaults, not its stale values', stale.get('mix') === RAIL_PARAMS.mix.default);
// A bad stored value inside a CURRENT-schema blob is re-clamped on load, not trusted verbatim.
const clampStore = makeStorage();
clampStore.setItem(KEY, JSON.stringify({ v: RAIL_SCHEMA_VERSION, params: { fundamental: 99999, richness: 7, harmonySource: 'bogus' } }));
const clamped = new RailParams({ storage: clampStore });
check('loaded values are re-clamped against the current spec', clamped.get('fundamental') === 1200 && clamped.get('richness') === 3 && clamped.get('harmonySource') === 'chord-walk');

console.log('\n  reset');
const r = new RailParams({ storage: makeStorage() });
r.set('mix', 0.9); r.set('speed', 10); r.reset();
check('reset returns every param to its default',
  Object.entries(RAIL_PARAMS).every(([name, spec]) => r.get(name) === spec.default));

console.log(PASS ? '\n✓✓✓ COSMOS RAIL PARAMS PASSES' : '\n✗ COSMOS RAIL PARAMS FAILED');
process.exit(PASS ? 0 : 1);
