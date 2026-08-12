// assert-harmony-policy-memo.mjs — proofs for the harmony-policy memoization landed in the audio
// main-thread campaign, Batch 1a (COSMOS_AUDIO_MAINTHREAD_CAMPAIGN_2026-08-12.md).
//
// harmonyPolicyDefinitionKey was re-normalizing policy.targets on every call, ~3×/scheduler-tick +
// 1×/rAF-frame against an unchanged policy. It now memoizes by policy identity via a WeakMap — but ONLY
// for FROZEN policies, whose targets can never mutate out from under a cached key. The two properties that
// must hold, and are guarded here:
//   1. VALUE PARITY — the memoized key is byte-identical to the from-formula key (the optimization changed
//      cost, not output), and is content-based (equal-content policies → equal keys; distinct → distinct).
//   2. NO STALENESS — a non-frozen policy is never cached, so mutating it is reflected on the next call.
//      This is the safety property the frozen-guard exists to provide.
import {
  normalizeHarmonyPolicy, normalizeCentTargets, harmonyPolicyDefinitionKey, harmonyPolicySelectionKey,
} from '../harmony-policy.js';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

// The from-formula key, independent of the function's internal caching — the parity oracle.
const expectedKey = policy =>
  `policy:${policy?.id || 'none'}|source:${policy?.source || 'none'}|targets:${normalizeCentTargets(policy?.targets).join(',')}|window:${policy?.toleranceCents ?? 15}`;

// ── value parity ───────────────────────────────────────────────────────────────────────────────────
const chord = normalizeHarmonyPolicy({ source: 'chord-walk', chordId: 5, chordTargets: [0, 400, 700], toleranceCents: 15 });
check('normalizeHarmonyPolicy output is frozen (so hot-path policies are cacheable)',
  Object.isFrozen(chord) && Object.isFrozen(chord.targets));
check('memoized key equals the from-formula key (memo changed cost, not value)',
  harmonyPolicyDefinitionKey(chord) === expectedKey(chord));
check('the frozen key is stable across repeated calls',
  harmonyPolicyDefinitionKey(chord) === harmonyPolicyDefinitionKey(chord));

// Distinct frozen policies must not cross-contaminate (WeakMap is per-object, but prove it).
const a = normalizeHarmonyPolicy({ source: 'chord-walk', chordId: 1, chordTargets: [0, 400, 700] });
const b = normalizeHarmonyPolicy({ source: 'chord-walk', chordId: 2, chordTargets: [0, 300, 700] });
check('distinct frozen policies get distinct, correct keys (no WeakMap cross-talk)',
  harmonyPolicyDefinitionKey(a) === expectedKey(a) &&
  harmonyPolicyDefinitionKey(b) === expectedKey(b) &&
  harmonyPolicyDefinitionKey(a) !== harmonyPolicyDefinitionKey(b));

// Two independently-built frozen objects with identical content must agree (content-based, not identity).
const s1 = normalizeHarmonyPolicy({ source: 'scale', scaleId: 'diatonic-major' });
const s2 = normalizeHarmonyPolicy({ source: 'scale', scaleId: 'diatonic-major' });
check('equal-content policies (distinct objects) produce equal keys',
  s1 !== s2 && harmonyPolicyDefinitionKey(s1) === harmonyPolicyDefinitionKey(s2));

// ── no staleness (the frozen-guard safety property) ──────────────────────────────────────────────────
const mutable = { id: 'adhoc', source: 'chord-walk', targets: [0, 400, 700], toleranceCents: 15 };
const before = harmonyPolicyDefinitionKey(mutable);
mutable.targets = [0, 300, 700];
const after = harmonyPolicyDefinitionKey(mutable);
check('a NON-frozen policy is never memoized — a mutation is reflected (no staleness)',
  before !== after && after === expectedKey(mutable));

// ── selection key (definition key + root identity) ───────────────────────────────────────────────────
const rootA = { rootKey: 3, fraction: '5/4', cents: 386.313714 };
const rootB = { rootKey: 7, fraction: '3/2', cents: 701.955001 };
check('selection key varies with root and is stable for a fixed root+policy',
  harmonyPolicySelectionKey(rootA, chord) !== harmonyPolicySelectionKey(rootB, chord) &&
  harmonyPolicySelectionKey(rootA, chord) === harmonyPolicySelectionKey(rootA, chord));

console.log(PASS ? '\n✓✓✓ HARMONY POLICY MEMO PASSES' : '\n✗ HARMONY POLICY MEMO FAILED');
process.exit(PASS ? 0 : 1);
