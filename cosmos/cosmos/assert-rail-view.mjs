// assert-rail-view.mjs — proofs for the RAIL (../rail-view.js): the param→setter map, the readout
// formatter, and — critically — the OWNERSHIP invariants of the 2026-07-29 transfer: the rail restores its
// state into the engine on EVERY entry (a repeatable applyRailToEngine() call, never a one-shot emitNow),
// and the audio lab is a dev mirror that applies nothing at entry and writes shared params only through
// railParams. The DOM build (ensureRail) needs a document; here we pin the pure, export-visible pieces and
// scan the sources for the wiring/anti-regression facts.
import { readFileSync } from 'node:fs';
import { RAIL_KNOBS, RAIL_BUTTONS, RAIL_SWITCHES, RAIL_SEGMENTS, RAIL_SELECTS, ENGINE_SETTERS, formatReadout, applyRailToEngine, resetRailForEntry } from '../rail-view.js';
import { railParams, RAIL_PARAMS } from '../rail-params.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ COSMOS RAIL VIEW — assertions ═══');

console.log('\n  The rendered rail + its engine bindings');
// The front face is deliberately restricted to controls with an immediate audible result. HOLD replaces
// the retired DWELL product control; RICHNESS is a named segment on the harmony/back face.
const RENDERED = ['fundamental', 'speed', 'volume', 'mix', 'space'];
check('the front rail renders exactly PITCH / SPEED / VOLUME / BED-ROWS / SPACE',
  Array.isArray(RAIL_KNOBS) && RAIL_KNOBS.length === RENDERED.length && RENDERED.every(n => RAIL_KNOBS.includes(n)));
check('the renamed pitch control keeps the existing fundamental-offset parameter and cents contract',
  RAIL_PARAMS.fundamental.label === 'PITCH' && RAIL_PARAMS.fundamental.unit === '¢');
check('SPEED is wired to setTargetOnsetRate (its ONSET-mode flip is intentional; behaviour in assert-rail-bindings)',
  typeof ENGINE_SETTERS.speed === 'function');
check('DWELL is removed from the user-facing rail model and HOLD has a live engine setter',
  !RAIL_PARAMS.dwell && !RAIL_KNOBS.includes('dwell') && typeof ENGINE_SETTERS.hold === 'function');
check('RICHNESS is hidden from the front but retained for the future harmony/back face',
  !RAIL_KNOBS.includes('richness') && typeof ENGINE_SETTERS.richness === 'function');
check('MUTE/HOLD are transport buttons and the back face owns ROW 1/1 / MODULATION / MIDI OUT',
  RAIL_BUTTONS.join(',') === 'mute,hold' && RAIL_BUTTONS.every(n => RAIL_PARAMS[n]?.group === 'transport') &&
  RAIL_SWITCHES.join(',') === 'rowFundamental,modulation,midiOut' && RAIL_SWITCHES.every(n => RAIL_PARAMS[n]?.group === 'advanced'));
check('harmony source, scale, RICHNESS, and VOICE choices are explicit back-face controls',
  RAIL_SEGMENTS.join(',') === 'harmonySource,richness,instrument' && RAIL_SELECTS.join(',') === 'scale');
check('VOICE is a choice segment wired to setInstrument, defaulting to classic so the entry sound is unchanged',
  RAIL_SEGMENTS.includes('instrument') && RAIL_PARAMS.instrument?.curve === 'choice' &&
  RAIL_PARAMS.instrument.choices.join(',') === 'classic,glass,warm' && RAIL_PARAMS.instrument.default === 'classic' &&
  RAIL_PARAMS.instrument.persist === true && typeof ENGINE_SETTERS.instrument === 'function');
check('every rendered knob/button is a real param with a live engine setter',
  [...RAIL_KNOBS, ...RAIL_BUTTONS].every(n => RAIL_PARAMS[n] && typeof ENGINE_SETTERS[n] === 'function'));
check('every ENGINE_SETTERS key is a real param — the map can never bind a name the state layer lacks',
  Object.keys(ENGINE_SETTERS).every(n => n in RAIL_PARAMS));
// MIDI OUT is async, gesture-gated, and can fail with a reason that must roll the param back — so it is
// deliberately NOT a plain setter that entry restoration would replay.
check('MIDI OUT is rendered but kept OUT of the setter map — it has its own async applier + rollback',
  RAIL_SWITCHES.includes('midiOut') && !('midiOut' in ENGINE_SETTERS));
check('DENSITY is fully absent from the active rail and engine binding',
  !('density' in ENGINE_SETTERS) && !RAIL_KNOBS.includes('density'));

console.log('\n  Readout formatting (spec + engine value → string)');
check('booleans read ON / OFF',
  formatReadout(RAIL_PARAMS.modulation, true) === 'ON' && formatReadout(RAIL_PARAMS.mute, false) === 'OFF');
check('a fixed choice reads as an uppercase label', formatReadout(RAIL_PARAMS.harmonySource, 'chord-walk') === 'CHORD WALK');
// A rail readout is the only thing telling the listener what a stop MEANS. "3" says nothing; "9ths" says
// where the vocabulary ceiling is without opening the debug overlay.
check('a detent with named stops reads its stop\'s name (RICHNESS)',
  formatReadout(RAIL_PARAMS.richness, 1) === 'triads' && formatReadout(RAIL_PARAMS.richness, 3) === '9ths' &&
  formatReadout(RAIL_PARAMS.richness, 4) === '11–13');
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
railParams.reset('mix');   // hygiene: back to the shipped default (0.8 = rows-forward blend)
check('reset(mix) restores the shipped default 0.8 — rows-forward, bed audible underneath', railParams.get('mix') === 0.8);
// FUNDAMENTAL is linear-in-cents (±1200 knob): the midpoint is 0¢, and the readout carries the ¢ unit.
railParams.setNorm('fundamental', 0.5);
check('setNorm(fundamental, 0.5) lands at 0¢ (knob midpoint = no offset)', railParams.get('fundamental') === 0);
railParams.setNorm('fundamental', 1);
check('setNorm(fundamental, 1) lands at the +1200¢ knob ceiling', railParams.get('fundamental') === 1200);
railParams.reset('fundamental');
check('reset(fundamental) restores 0¢', railParams.get('fundamental') === 0);

console.log('\n  Product wiring');
const src = readFileSync(new URL('../rail-view.js', import.meta.url), 'utf8');
check('the rail mounts as a sibling of #lrc-div inside #cosmos-view',
  src.includes("getElementById('cosmos-view')") && src.includes("rail.id = 'cosmos-rail'") && src.includes('host.appendChild(rail)'));
check('gestures drive the engine through the guarded setter map, then repaint the control',
  src.includes('ENGINE_SETTERS[name]?.(value)') && src.includes('railParams.subscribe(') && src.includes('paintControl(name'));
check('a gesture calls setNorm (normalized → curve) — never a raw engine value from the DOM',
  src.includes('railParams.setNorm(name,'));
// The knob is the site's ADSR rotary, reused class-for-class and swept the same 270° (ToneRowPlayback.js).
check('the knob reuses the ADSR rotary (.knob/.knob-indicator) and its 270° indicator sweep',
  src.includes("dial.className = 'knob'") && src.includes("indicator.className = 'knob-indicator'") && src.includes('KNOB_SWEEP_DEG = 270'));
check('two ordinary DOM faces replace the old <details> drawer',
  src.includes("createElement('section')") && src.includes("'rail-face rail-performance-face'") &&
  src.includes("'rail-face rail-harmony-face'") && !src.includes("createElement('details')"));
check('inactive-face focus is excluded with hidden + inert, and focus moves to the destination toggle',
  src.includes('performanceFace.inert') && src.includes('harmonyFace.inert') && src.includes('?.focus()'));
check('scale and RICHNESS visibility follows the single harmonySource state owner',
  src.includes("railParams.get('harmonySource')") && src.includes('scaleControl.hidden') && src.includes('richnessControl.hidden'));
check('the module imports its state from rail-params and its setters from cosmos-audio',
  src.includes("from './rail-params.js'") && src.includes("from './cosmos-audio.js'"));

console.log('\n  ⚠ OWNERSHIP — the rail restores on EVERY entry (2026-07-29 transfer)');
// THE invariant that replaced the old "no emitNow" gotcha. emitNow fires once, at subscribe time, and
// ensureRail() is `built`-guarded to the FIRST entry — while stopAudio() destroys the graph on every exit
// and initAudio() rebuilds it at the engine's own defaults (mix = 0, unity volume). So restoration MUST be a
// call the boot path can repeat. The anti-regression scans the subscribe CALL for an emitNow option (prose
// elsewhere in the module legitimately names the gotcha).
check('restoration is a repeatable exported call, not a one-shot emitNow at subscribe time',
  typeof applyRailToEngine === 'function' && !/subscribe\([\s\S]{0,600}?emitNow/.test(src) &&
  /export function applyRailToEngine/.test(src) && src.includes('ENGINE_SETTERS[name]?.(value)'));
check('applyRailToEngine runs headlessly without an AudioContext (the setters are all guarded)',
  (() => { try { applyRailToEngine(); return true; } catch { return false; } })());
check('entry reset clears HOLD/MUTE/MIDI and returns to the performance face',
  typeof resetRailForEntry === 'function' && src.includes("setRailFace('performance'") &&
  src.includes("railParams.set('hold', false)") && src.includes("railParams.set('midiOut', false)"));
const boot = readFileSync(new URL('../flight-boot.js', import.meta.url), 'utf8');
check('flight-boot resets then restores the rail on every cosmos entry, after initAudio()',
  /initAudio\(\);[\s\S]*ensureRail\(\);[\s\S]*resetRailForEntry\(\);[\s\S]*applyRailToEngine\(\);/.test(boot) &&
  boot.includes('applyRailToEngine') && boot.split('applyRailToEngine()').length === 2);

console.log('\n  ⚠ OWNERSHIP — the audio lab is a dev MIRROR, not a second owner');
const flight = readFileSync(new URL('../flight-view.js', import.meta.url), 'utf8');
check('flight no longer reads DENSITY or adds it to row-program identity',
  !flight.includes("railParams.get('density')") &&
  !flight.includes('harmonicSelectionKey(root.rootKey, chord.id, ROW_CONSONANCE_CENTS, density)'));
const audioImport = flight.match(/import \{([^}]*)\} from '\.\/cosmos-audio\.js'/)?.[1] || '';
check('flight-view no longer imports the setters the rail owns (mute / mix / modulation / MIDI / full-quality)',
  audioImport.length > 0 && !/\bsetMuted\b|\bsetMix\b|\bsetModulation\b|\bsetMidiOut\b|\bsetHoldForFullQuality\b/.test(audioImport));
check('the shared params are written THROUGH railParams, so there is exactly one owner',
  flight.includes("from './rail-params.js'") && flight.includes("railParams.set('mute'") &&
  flight.includes("railParams.set('mix'") && flight.includes("railParams.set('modulation'") &&
  flight.includes("railParams.set('midiOut'"));
check('the lab applies NOTHING at entry — it syncs from the engine instead',
  flight.includes('syncAudioLab()') && !flight.includes('if (tuningSliderEl) setTuningStrength(') &&
  !flight.includes('changeAudioMode(AUDIO_MODES.CULLED_GRID_ROWS)') && !flight.includes('setHoldForFullQuality('));
check('a rail gesture repaints the lab, and revealing the lab re-reads the engine first',
  flight.includes('railParams.subscribe(() => syncAudioLab())') && /audioLabOn\) syncAudioLab\(\)/.test(flight));
check('the lab stays dev-gated exactly like the Full Sky overlay (?audioLab=1 seeds it, Z toggles)',
  flight.includes("get('audioLab') === '1'") && flight.includes("get('skyDebug') === '1'") &&
  /k === 'z'/.test(flight) && flight.includes('audioLabEl.hidden = !audioLabOn'));
check('the retired full-quality checkbox is gone from the markup as well as the wiring',
  !readFileSync(new URL('../../index.html', import.meta.url), 'utf8').includes('lrc-full-quality'));

console.log(PASS ? '\n✓✓✓ COSMOS RAIL VIEW PASSES' : '\n✗ COSMOS RAIL VIEW FAILED');
process.exit(PASS ? 0 : 1);
