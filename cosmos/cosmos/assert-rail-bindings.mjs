// assert-rail-bindings.mjs — proofs for the Phase 2 ENGINE bindings the knob rail drives: SPEED's
// onset-rate law (2.1) and the thin RICHNESS / VOLUME / SPACE setters (2.3). Each is additive with a
// default that reproduces today's sound, so nothing changes until the rail pushes its own values. Pure
// math and setter clamps run headlessly; the audio-graph placement is checked by source scan.
import { readFileSync } from 'node:fs';
import {
  onsetRateToTickRate, setTargetOnsetRate, currentTargetOnsetRate, currentSpeedMode,
  setRichness, currentRichness, setVolume, currentVolume, setSpace, currentSpace,
  setDwell, currentDwell, setTuningStrength, currentTuningStrength, currentModulation,
} from '../cosmos-audio.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ COSMOS RAIL BINDINGS — assertions ═══');

console.log('\n  SPEED — target onsets/sec → tick rate (decision 2)');
// onsets/sec × ticks/onset = ticks/sec, under the same [1, 8000] clamp as scaledRateFor.
check('the onset rate becomes a tick rate through the field\'s mean onset gap',
  onsetRateToTickRate(2.5, 100).ticksPerSec === 250 && onsetRateToTickRate(2.5, 100).onsetTicks === 100);
check('the tick clamp still holds at both ends (a monster grid runs under target at the cap)',
  onsetRateToTickRate(16, 8000).ticksPerSec === 8000 && onsetRateToTickRate(0.5, 1).ticksPerSec === 1);
check('with no onset gap known yet it yields null — "keep the rate we have", like scaledRateFor',
  onsetRateToTickRate(0, 100) === null && onsetRateToTickRate(2.5, 0) === null && onsetRateToTickRate(-1, 5) === null);
check('setTargetOnsetRate clamps to the knob range and switches speed into ONSET mode',
  setTargetOnsetRate(3) === 3 && currentSpeedMode().mode === 'onset' && currentTargetOnsetRate() === 3 &&
  setTargetOnsetRate(9999) === 16 && setTargetOnsetRate(0.01) === 0.5);
check('rhythm-card playback advances at the SPEED target itself, not the density-derived grid tick rate',
  setTargetOnsetRate(3) === 3 && currentSpeedMode().leadOnsetsPerSec === 3 &&
  onsetRateToTickRate(3, 100).ticksPerSec === 300);
setTargetOnsetRate(2.5);   // hygiene: back to the calibrated default

console.log('\n  DWELL — chord dwell past full exposure, in cycle fractions (0 = advance at exposure)');
check('setDwell clamps to [0,1] and currentDwell reports the fraction alongside the live clock',
  setDwell(2) === 1 && setDwell(-1) === 0 && setDwell(0.25) === 0.25 && currentDwell().fraction === 0.25 &&
  Number.isFinite(currentDwell().cycleSeconds));
setDwell(0);   // hygiene: back to the exposure-floor-only default
check('the knob\'s default is a no-op — DWELL 0 reproduces the pre-rail advance rule', currentDwell().fraction === 0);

console.log('\n  λ — frozen at the ceiling, and the lab probe cannot corrupt it');
// Avery's call (2026-07-29): frozen at 8.0 because the bigger voice-leading jumps it buys are wanted.
// No rail knob binds it; setTuningStrength is the audio lab's dev probe.
check('LAMBDA_FIELD starts frozen at 8.0 — production never moves it', currentTuningStrength() === 8);
check('the probe clamps to [0, 8] and a garbled read HOLDS the current value instead of snapping to 2.0',
  setTuningStrength(99) === 8 && setTuningStrength(-1) === 0 && setTuningStrength('nonsense') === 0);
setTuningStrength(8);   // hygiene: back to the frozen value
check('the probe restores exactly the frozen λ', currentTuningStrength() === 8);

console.log('\n  MODULATION — default ON since the ownership transfer (carries f54198c forward)');
check('the engine\'s own default agrees with the rail\'s, so the two surfaces cannot disagree at entry',
  currentModulation().on === true);

console.log('\n  RICHNESS — a vocabulary-ceiling DETENT, not a weight');
check('setRichness snaps to an integer stop and clamps to 1–3',
  setRichness(9) === 3 && setRichness(-3) === 1 && setRichness(2.4) === 2 && setRichness(2.6) === 3);
check('currentRichness reports the stop, its ceiling and a name the readout can show',
  setRichness(1) === 1 && currentRichness().maxCardinality === 3 && currentRichness().label === 'triads' &&
  setRichness(3) === 3 && currentRichness().maxCardinality === 6 && currentRichness().label === 'ext.' && currentRichness().max === 3);
setRichness(3);   // hygiene: back to the default stop

console.log('\n  VOLUME — master trim ahead of the limiter');
check('setVolume clamps to [0,1] and currentVolume reports it',
  setVolume(2) === 1 && setVolume(-1) === 0 && setVolume(0.7) === 0.7 && currentVolume() === 0.7);
setVolume(1);   // hygiene: back to unity

console.log('\n  SPACE — one knob over both reverb sends, midpoint = today');
const half = setSpace(0.5), dry = setSpace(0), wash = setSpace(1);
check('the knob midpoint reproduces today\'s sends (ambient 0.30, rows 0.35)',
  half.space === 0.5 && Math.abs(half.ambientWet - 0.3) < 1e-9 && Math.abs(half.rowWet - 0.35) < 1e-9);
check('the travel runs from fully dry to a wetter wash, continuously',
  dry.ambientWet === 0 && dry.rowWet === 0 && wash.ambientWet > half.ambientWet && wash.rowWet > half.rowWet);
check('SPACE clamps to [0,1] and currentSpace mirrors the derived sends',
  setSpace(2).space === 1 && setSpace(-1).space === 0 && currentSpace().space === 0 &&
  currentSpace().rowWet === setSpace(0).rowWet);
setSpace(0.5);   // hygiene: back to the calibrated midpoint

console.log('\n  Product wiring');
const audio = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../spatial-grid-row-player.js', import.meta.url), 'utf8');
check('VOLUME is a real master gain between the mute and the safety limiter',
  audio.includes('muteGainNode.connect(masterVolume)') && audio.includes('masterVolume.connect(outputLimiter)') &&
  audio.includes('masterVolume.gain.setTargetAtTime'));
check('SPEED\'s ONSET mode re-derives the tick rate as the field churns, under the same hysteresis',
  audio.includes('onsetRateToTickRate(targetOnsetRate, fieldOnsetTicks)') && audio.includes("SPEED_MODES.ONSET"));
check('rhythm-card scheduling has an independent onset clock pinned to SPEED while rows keep grid time',
  audio.includes('setLeadTickRate(targetOnsetRate)') &&
  audio.includes('leadTransportStart + noteTicks / leadTicksPerSec') &&
  audio.includes('gridRowPlayer?.tick(now, now + SCHEDULE_AHEAD, transportStart, ticksPerSec)'));
check('SPACE drives BOTH reverb sends — the ambient send here and the row send on the player',
  audio.includes('reverbWet?.gain.setTargetAtTime') && audio.includes('gridRowPlayer?.setReverbWet(') &&
  player.includes('setReverbWet(level)') && player.includes('this.reverb.wet.gain.setTargetAtTime'));
// The knob and the incentive are now two different mechanisms and must stay that way: the detent removes
// qualities from the candidate set, the constant decides between what is left. Collapsing them back into
// one number is what made the knob feel like nothing was happening.
check('RICHNESS drives the walk\'s vocabulary CEILING, live, on the next chord choice',
  audio.includes('let richnessLevel = RICHNESS_LEVEL_DEFAULT') &&
  audio.includes('maxCardinality: maxCardinalityForRichness(richnessLevel)'));
check('the earned extension incentive is a separate frozen constant at the swept knee',
  audio.includes('const EXTENSION_INCENTIVE = 0.05') && audio.includes('richness: EXTENSION_INCENTIVE'));
check('λ is a named frozen constant the walk reads live (so the lab probe still works)',
  audio.includes('const LAMBDA_FIELD_FROZEN = 8.0') && audio.includes('let LAMBDA_FIELD = LAMBDA_FIELD_FROZEN') &&
  audio.includes('lambdaField: LAMBDA_FIELD'));

console.log(PASS ? '\n✓✓✓ COSMOS RAIL BINDINGS PASSES' : '\n✗ COSMOS RAIL BINDINGS FAILED');
process.exit(PASS ? 0 : 1);
