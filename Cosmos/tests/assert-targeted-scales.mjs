// assert-targeted-scales.mjs — the nine targeted Scale-mode presets (just major, harmonic/subharmonic modes,
// hexany, slendro, maqamat, gong pentatonic, Thai 7-EDO). They aim at exact ratio boundaries; chromatic and
// diatonic-major keep approximating 12TET and must come out of every path exactly as before.
import {
  SCALE_POLICIES, normalizeHarmonyPolicy, matchHarmonyTarget, bedTargetsForPolicy, smallestStepCents, ratioToCentsExact,
} from '../audio/harmony-policy.js';
import { poolFromTones } from '../audio/sky-root.js';
import { RAIL_PARAMS } from '../ui/rail-params.js';
import {
  bedDegreesForPolicy, leadNoteInHarmony, setHarmonySource, setHarmonyScale, currentSkyChord,
} from '../audio/cosmos-audio.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };
const scalePolicy = scaleId => normalizeHarmonyPolicy({ source: 'scale', scaleId });
const selects = (scaleId, ratio) => !!matchHarmonyTarget(ratioToCentsExact(ratio), 0, scalePolicy(scaleId))?.selected;
const tone = ratio => ({ f: ratio, c: ratioToCentsExact(ratio) });
const TARGETED = ['just-major', 'harmonic-8-16', 'subharmonic-16-8', 'hexany-1357', 'slendro-7',
  'maqam-rast', 'maqam-bayati', 'gong-pentatonic', 'thai-7edo'];

console.log('menu');
check('rail SCALE choices are exactly the policy table, in order',
  RAIL_PARAMS.scale.choices.join(',') === Object.keys(SCALE_POLICIES).join(','));
check('all nine targeted scales are registered', TARGETED.every(id => SCALE_POLICIES[id]?.bedTargets));

console.log('12TET presets untouched');
for (const id of ['chromatic', 'diatonic-major']) {
  const policy = scalePolicy(id);
  check(`${id}: policy shape is the pre-targeted one`,
    Object.keys(policy).join(',') === 'id,source,scaleId,targets,toleranceCents' && policy.toleranceCents === 15);
  check(`${id}: bed still guides to 0/400/700`, bedTargetsForPolicy(policy).join(',') === '0,400,700');
}
check('diatonic-major still rejects 5/3 (884¢ is 15.6¢ off 900) — the 12TET approximation is intended',
  !selects('diatonic-major', '5/3'));
check('no pins → poolFromTones is the plain 12TET fold',
  JSON.stringify(poolFromTones([tone('16/9'), tone('7/4'), tone('5/4')], 37)) ===
  JSON.stringify(poolFromTones([tone('16/9'), tone('7/4'), tone('5/4')], 37, [])));

console.log('ratio boundaries');
for (const id of TARGETED) {
  const scale = SCALE_POLICIES[id], policy = scalePolicy(id), step = smallestStepCents(scale.targets);
  if (scale.ratios) check(`${id}: every ratio is a target, hit dead on`,
    scale.ratios.every(ratio => Math.abs(matchHarmonyTarget(ratioToCentsExact(ratio), 0, policy).deviationCents) < 1e-5));
  check(`${id}: windows bounded by the smallest step (row ≤ ⅓, lead ≤ ½)`,
    policy.toleranceCents <= step / 3 + 1e-9 && policy.leadWindowCents <= step / 2 + 1e-9, `step ${step.toFixed(1)}¢`);
  check(`${id}: bed triad is three scale targets in three distinct pool slots`,
    policy.bedTargets.length === 3 && policy.bedTargets.every(t => policy.targets.includes(t)) &&
    new Set(policy.bedTargets.map(t => Math.round(t / 100) % 12)).size === 3);
}
check('Just Major catches 5/3 and 15/8', selects('just-major', '5/3') && selects('just-major', '15/8'));
check('Harmonic 8–16 catches 7/4, 11/8, 13/8', ['7/4', '11/8', '13/8'].every(r => selects('harmonic-8-16', r)));
check('Subharmonic 16–8 catches 16/13 and 16/11', selects('subharmonic-16-8', '16/13') && selects('subharmonic-16-8', '16/11'));
check('Maqam Rast catches the neutral 11/9 and 11/6, rejects 5/4 and 6/5',
  selects('maqam-rast', '11/9') && selects('maqam-rast', '11/6') && !selects('maqam-rast', '5/4') && !selects('maqam-rast', '6/5'));
check('Gong takes 81/64 not 5/4; Just Major the reverse — a syntonic comma apart',
  selects('gong-pentatonic', '81/64') && !selects('gong-pentatonic', '5/4') && selects('just-major', '5/4') && !selects('just-major', '81/64'));
check('Hexany has no 3/2', !selects('hexany-1357', '3/2'));

console.log('bed pins');
const field = ['1/1', '5/4', '16/9', '7/4', '3/2'].map(tone);
const plain = poolFromTones(field, 0), pinned = poolFromTones(field, 0, SCALE_POLICIES['harmonic-8-16'].bedTargets);
check('unpinned, slot 10 holds 16/9 (nearer 1000¢) — the loss pins exist for', plain[10].fraction === '16/9');
check('pinned, slot 10 holds 7/4 with dev measured from the pin', pinned[10].fraction === '7/4' && Math.abs(pinned[10].dev) < 1e-5);
check('the bed voices 4:5:7 from the pinned pool',
  bedDegreesForPolicy(scalePolicy('harmonic-8-16'), 0, pinned).join(',') === '0,4,10');
check('the same field unpinned cannot voice the 7', !bedDegreesForPolicy(scalePolicy('harmonic-8-16'), 0, plain).includes(10));
const anchor = 233.4, shifted = ['1/1', '5/4', '16/9', '7/4'].map(r => ({ f: r, c: (ratioToCentsExact(r) + anchor) % 1200 }));
check('pins follow the solved root', poolFromTones(shifted, anchor, [ratioToCentsExact('7/4')])[10].fraction === '7/4');

console.log('lead window');
const narrow = { ...scalePolicy('just-major'), leadWindowCents: 10 };
const off20 = 2 ** ((ratioToCentsExact('5/4') + 20) / 1200);
check('a scale lead window replaces the global 35¢', leadNoteInHarmony(off20, 0, scalePolicy('just-major')) && !leadNoteInHarmony(off20, 0, narrow));

console.log('readout');
setHarmonySource('scale'); setHarmonyScale('maqam-rast');
const chord = currentSkyChord();
check('currentSkyChord carries the scale ratios', chord.symbol === 'MAQAM RAST' && chord.ratios?.includes('11/9'));
setHarmonyScale('diatonic-major');
check('a 12TET preset reads out without ratios', currentSkyChord().ratios === undefined);
setHarmonySource('chord-walk');

console.log(PASS ? '\nPASS assert-targeted-scales' : '\nFAIL assert-targeted-scales');
process.exit(PASS ? 0 : 1);
