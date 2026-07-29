// assert-chord-clock.mjs — proofs for the Phase 0.3 chord clock (../cosmos-audio.js). The old fixed
// 25.6s window and the full-quality checkbox are retired: a chord now advances on one mix-independent
// policy — an unconditional exposure FLOOR, a DWELL TARGET past it, a quantized boundary, and an ESCAPE
// cap — all derived from the current grid cycle so harmonic rhythm scales with playback.
import { readFileSync } from 'node:fs';
import {
  shouldAdvanceChord, chordTargetSeconds, chordEscapeSeconds, chordQuantumSeconds, effectiveCycleSecondsFor,
  setDwell, currentDwell, setMix,
  NOMINAL_FALLBACK_CYCLE_SECONDS, CHORD_QUANTIZE_DIVISIONS, CHORD_ESCAPE_MULT,
} from '../cosmos-audio.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ COSMOS CHORD CLOCK — assertions ═══');

console.log('\n  Exposure floor (unconditional, identical at every mix position)');
// The floor IS the whole of the retired full-quality hold, now always on. Below full exposure a chord
// never advances on the normal path — only the escape can release it (proven further down).
check('an unexposed chord never advances on the normal path, at any DWELL or held time',
  !shouldAdvanceChord({ complete: false, heldSeconds: 0, targetSeconds: 0 }) &&
  !shouldAdvanceChord({ complete: false, heldSeconds: 999, targetSeconds: 5, maxSeconds: 1e9 }));
check('a fully-exposed chord at DWELL 0 advances the moment it is exposed (today\'s full quality)',
  shouldAdvanceChord({ complete: true, heldSeconds: 0, targetSeconds: 0 }));
// The policy reads only `complete`, never the mix — moving the crossfade cannot change the decision, and
// the exposure ledger that feeds `complete` is already mix-wide (bed + rows both contribute; see wiring).
check('the advance decision is mix-independent — the same inputs decide the same at bed and at rows', (() => {
  const inputs = { complete: true, heldSeconds: 3, targetSeconds: 2, maxSeconds: 100, atBoundary: true };
  setMix(0); const atBed = shouldAdvanceChord(inputs);
  setMix(1); const atRows = shouldAdvanceChord(inputs);
  setMix(0);
  return atBed === true && atRows === true;
})());

console.log('\n  DWELL target (a fraction of the cycle, held past exposure)');
check('DWELL 0 = no dwell; DWELL 1 = a whole cycle; clamped in between',
  chordTargetSeconds(0, 12) === 0 && chordTargetSeconds(1, 12) === 12 &&
  chordTargetSeconds(0.5, 12) === 6 && chordTargetSeconds(2, 12) === 12 && chordTargetSeconds(-1, 12) === 0);
check('an exposed chord keeps holding until heldSeconds reaches the DWELL target, then advances',
  !shouldAdvanceChord({ complete: true, heldSeconds: 4, targetSeconds: 6, maxSeconds: 100 }) &&
  shouldAdvanceChord({ complete: true, heldSeconds: 6, targetSeconds: 6, maxSeconds: 100 }));
check('setDwell clamps to [0,1] and currentDwell reports it',
  setDwell(9) === 1 && setDwell(-9) === 0 && setDwell(0.375) === 0.375 && currentDwell().fraction === 0.375);
setDwell(0);   // hygiene: leave the module at its default for any later suite that imports it

console.log('\n  Escape cap (a degree the field cannot voice, or a chord flown away from, still releases)');
check('the escape is 4 full cycles and scales with the cycle',
  chordEscapeSeconds(12) === CHORD_ESCAPE_MULT * 12 && chordEscapeSeconds(24) === CHORD_ESCAPE_MULT * 24);
check('the escape fires even on a never-exposed chord and even off a quantize boundary',
  shouldAdvanceChord({ complete: false, heldSeconds: 48, targetSeconds: 0, maxSeconds: 48, atBoundary: false }) &&
  shouldAdvanceChord({ complete: false, heldSeconds: 100, targetSeconds: 0, maxSeconds: 48, atBoundary: false }));
check('the escape is generous below full DWELL so a slow exposure in a sparse field is not cut off early',
  chordEscapeSeconds(12) > chordTargetSeconds(1, 12) &&                       // 48s escape > 12s full-DWELL target
  chordEscapeSeconds(24) === CHORD_ESCAPE_MULT * chordTargetSeconds(1, 24));  // 4 cycles == 4× the max target

console.log('\n  Quantize grid (chord changes land on the form)');
check('the quantize grid is 1/8 of the cycle',
  chordQuantumSeconds(24) === 24 / CHORD_QUANTIZE_DIVISIONS && chordQuantumSeconds(12) === 12 / 8);
check('an exposed, past-target chord still waits for the next quantize boundary before advancing',
  !shouldAdvanceChord({ complete: true, heldSeconds: 7, targetSeconds: 5, maxSeconds: 100, atBoundary: false }) &&
  shouldAdvanceChord({ complete: true, heldSeconds: 7, targetSeconds: 5, maxSeconds: 100, atBoundary: true }));

console.log('\n  Effective cycle (rows → grid loop at the live rate; no rows → nominal fallback)');
check('with rows sounding the cycle is one grid loop at the live tick rate',
  effectiveCycleSecondsFor(1200, 100) === 12 && effectiveCycleSecondsFor(2400, 100) === 24);
check('with no rows (medianGrid 0 / rate 0) DWELL maps against the nominal fallback cycle',
  effectiveCycleSecondsFor(0, 100) === NOMINAL_FALLBACK_CYCLE_SECONDS &&
  effectiveCycleSecondsFor(1200, 0) === NOMINAL_FALLBACK_CYCLE_SECONDS && NOMINAL_FALLBACK_CYCLE_SECONDS > 0);

console.log('\n  Product wiring');
const audio = readFileSync(new URL('../cosmos-audio.js', import.meta.url), 'utf8');
// Scan CODE only — the constants block's comment still names the retired symbols as history.
const audioCode = audio.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
check('the retired fixed window and full-quality hold are gone from the engine code',
  !audioCode.includes('CHORD_SECONDS') && !audioCode.includes('CHORD_MAX_SECONDS') && !audioCode.includes('holdForFullQuality'));
check('stepSkyWalk runs the pure policy off the cycle-derived clock, quantized every tick',
  audio.includes('shouldAdvanceChord({ complete: exposure.complete') &&
  audio.includes('effectiveCycleSeconds()') && audio.includes('chordQuantumSeconds(cycleSeconds)') &&
  audio.includes('const atBoundary = step !== skyStep'));
check('the full-quality toggle is a no-op deprecation shim, absorbed into the always-on floor',
  audio.includes('export function setHoldForFullQuality() { return true; }'));
check('exposure stays mix-wide — both engines feed the floor at every crossfade position',
  audio.includes('gridRowPlayer?.soundedSince(since)') && audio.includes('for (const degree of bedSoundedDegrees)'));

console.log(PASS ? '\n✓✓✓ COSMOS CHORD CLOCK PASSES' : '\n✗ COSMOS CHORD CLOCK FAILED');
process.exit(PASS ? 0 : 1);
