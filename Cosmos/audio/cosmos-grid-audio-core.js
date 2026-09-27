// cosmos-grid-audio-core.js — pure contracts shared by flight-view, the Cull2 compiler worker,
// and headless guards. No DOM, Worker, or WebAudio state belongs here.
import { buildGridCull2Readout } from '../engine/cull2-grid-core.js?v=6';
import {
  harmonyPolicySelectionKey,
  matchHarmonyTarget,
  normalizeHarmonyPolicy,
} from './harmony-policy.js';

export const AUDIO_MODES = Object.freeze({
  AMBIENT_CHORDS: 'ambient-chords',
  CULLED_GRID_ROWS: 'culled-grid-rows',
});

// The clicked Ambient Chords rhythm and the spatial Cull2 rows intentionally share one voice color.
// Their envelopes and spatial graphs remain mode-specific.
export const RHYTHM_VOICE_WAVEFORM = 'triangle';

export const ROW_ACTIVE_STARS = 20;
export const ROW_PREWARM_STARS = 30;
export const ROW_RADIUS = 5000;
export const ROW_CONSONANCE_CENTS = 15;
export const ROW_SWITCH_TICKS = 16;
// Interim OOM safety cap (until row compile streams huge grids). compositeTape materializes one node/gap/
// event per composite onset, and a rhythm's onset count is bounded by its layerSum (sum of its layers).
// A rhythm with a huge single layer (~1e6) makes that ~1e6-object array pause-then-OOM the worker, which
// kills audio everywhere — not just at that zone. Cap on the ONSET dimension (layerSum), NOT the grid/LCM:
// a huge LCM from small coprime layers is cheap and must stay eligible. 20000 onsets/cycle is already far
// past any perceptible rhythm, so this only excludes drone-dense zones. Tunable; the real fix is streaming.
export const ROW_MAX_COMPOSITE_ONSETS = 20000;
// Onset ceiling for the RHYTHM-CARD inspector/audition only — NOT the flight scene. Building a card's
// composite model (deriveSelectedRhythmModel) and auditioning it (deriveVoice → lead) are each O(onsets),
// so a very dense clicked rhythm freezes the page synchronously. Above this onset load the card refuses to
// build the model / audition (flight-view.js modelForRhythmNode). The flight scene is deliberately NOT
// capped: row playback may still need a >this-onset rhythm as a folded-ratio representative, and its
// scheduler cost is bounded incrementally (lookahead horizon + MAX_ROW_OSC), unlike the card's one-shot build.
export const ROW_MAX_PLAYBACK_ONSETS = 16384;
export const CULLED_ROW_MAX_VOICES_PER_TONE = 4;

// A ratio owner's cents are absolute within the octave. The solved sky root is the harmonic frame's
// anchor, so chord degrees are measured from that anchor with signed circular deviation from 12TET.
export function ownerChordMatch(ownerCents, rootCents, chordSemitones, windowCents = ROW_CONSONANCE_CENTS) {
  const policy = normalizeHarmonyPolicy({ chordTargets: (chordSemitones || []).map(degree => degree * 100), toleranceCents: windowCents });
  const match = matchHarmonyTarget(ownerCents, rootCents, policy);
  if (!match) return null;
  return { degree: Math.round(match.targetCents / 100) % 12, deviation: match.deviationCents, selected: match.selected };
}

export function ownerHarmonyMatch(ownerCents, rootCents, policy) {
  return matchHarmonyTarget(ownerCents, rootCents, policy);
}

export function selectedOwnerFractions(ratioOwners, rootCents, policyOrSemitones, windowCents = ROW_CONSONANCE_CENTS) {
  const policy = Array.isArray(policyOrSemitones)
    ? normalizeHarmonyPolicy({ chordTargets: policyOrSemitones.map(degree => degree * 100), toleranceCents: windowCents })
    : policyOrSemitones;
  return (ratioOwners || []).filter(owner => ownerHarmonyMatch(owner.cents, rootCents, policy)?.selected)
    .map(owner => owner.fraction);
}

export function harmonicSelectionKey(rootOrKey, policyOrChordId, windowCents = ROW_CONSONANCE_CENTS) {
  if (policyOrChordId && typeof policyOrChordId === 'object') return harmonyPolicySelectionKey(rootOrKey, policyOrChordId);
  return `root:${rootOrKey}|chord:${policyOrChordId}|window:${windowCents}`;
}

// The monster gate is deliberately repeated at the audio boundary. A visually "solved" gated
// monster has no shard plan or ownership payload and must never enter the compiler queue.
export function audioCompileEligibility(zone) {
  if (!zone) return { eligible: false, reason: 'missing' };
  if (zone.monster) return { eligible: false, reason: 'monster-gated' };
  if (zone.unsolvable) return { eligible: false, reason: 'unsolvable' };
  if (zone.state !== 'solved') return { eligible: false, reason: 'ownership-solving' };
  if (!Number.isInteger(zone.shardsTotal) || zone.shardsTotal <= 0) return { eligible: false, reason: 'no-final-shards' };
  if (zone.shardsDone !== zone.shardsTotal) return { eligible: false, reason: 'partial-ownership' };
  if (!Array.isArray(zone.ratioOwners) || !zone.ratioOwners.length) return { eligible: false, reason: 'no-ratio-owners' };
  // Interim OOM cap: skip a zone whose densest rhythm would materialize more composite onsets than the
  // worker can hold. Fold for the max layerSum (never spread — that was the huge-grid stack-overflow bug).
  // A missing layerSum reads as 0 (fail open: don't wrongly exclude an owner that predates the field).
  let maxLayerSum = 0;
  for (const owner of zone.ratioOwners) { const s = Number(owner?.layerSum) || 0; if (s > maxLayerSum) maxLayerSum = s; }
  if (maxLayerSum > ROW_MAX_COMPOSITE_ONSETS) return { eligible: false, reason: 'too-dense', maxLayerSum };
  return { eligible: true, reason: 'ownership-ready' };
}

// Movement-based selection. Prewarming is purely nearest-by-true-3D-distance; active membership adds
// hysteresis by keeping already-active ready stars ahead of fresh ready stars inside that window.
export function chooseSpatialRows(candidates, previousActiveIds = new Set(), {
  radius = ROW_RADIUS,
  prewarmLimit = ROW_PREWARM_STARS,
  activeLimit = ROW_ACTIVE_STARS,
} = {}) {
  const sorted = (candidates || []).filter(candidate => Number.isFinite(candidate.distance) && candidate.distance <= radius)
    .sort((a, b) => a.distance - b.distance || a.id - b.id);
  const prewarm = sorted.slice(0, prewarmLimit);
  const ready = prewarm.filter(candidate => candidate.ready);
  const kept = ready.filter(candidate => previousActiveIds.has(candidate.id));
  const fresh = ready.filter(candidate => !previousActiveIds.has(candidate.id));
  return { prewarm, active: [...kept, ...fresh].slice(0, activeLimit) };
}

// Playback reads only { layer, rawFraction, fraction, rawRatio } from an action (foldedRatio kept for parity;
// `gap` is DROPPED — it is per-occurrence and never read on the main thread, and keeping it would defeat the
// interning below). INTERNING: an action is fully determined by (layer, tone), but a program repeats each one
// across thousands of onsets. Emitting ONE shared object per distinct action lets structured clone (postMessage)
// preserve the shared reference — so ~80k action clones and their ~240k string copies collapse to a few dozen
// objects cloned once. This is what lets a dense/monster-grid program cross the worker boundary without a
// multi-tens-of-ms main-thread deserialization freeze on every chord change. Verified: structuredClone dedups
// shared refs. The player treats actions as read-only, so sharing is safe.
function makeActionInterner() {
  const pool = new Map();
  return action => {
    const key = `${action.layer}|${action.rawFraction}|${action.fraction}|${action.rawRatio}|${action.foldedRatio}|${action.action}`;
    let shared = pool.get(key);
    if (!shared) {
      shared = { layer: action.layer, action: action.action, rawRatio: action.rawRatio,
        rawFraction: action.rawFraction, foldedRatio: action.foldedRatio, fraction: action.fraction };
      pool.set(key, shared);
    }
    return shared;
  };
}

// Schedule-time tone identity, replicated from spatial-grid-row-player.js's actionToneKey so the
// worker-precomputed gap table keys tones exactly as the runtime scan did. Interned actions always
// carry rawFraction; the fallbacks match the runtime for parity, not because they fire here.
const actionToneKey = action => action?.rawFraction ?? action?.fraction ?? String(action?.rawRatio);

// Precompute the playback schedule tables ONCE in the worker so the 40 Hz scheduler and the deck-swap
// seed read lookups instead of re-deriving per onset on the main thread. All three tables are pure
// functions of (events, grid, repeatCull) — no runtime voice state feeds them — so precomputing is exact:
//
//   • eventGaps  — flat array; eventGaps[event.gapBase + i] === nextRowLayerGapTicks(events, e, action_i,
//                  grid, repeatCull). That forward/wrap scan was O(E) PER ONSET → O(E²)/cycle in the hot
//                  loop; the table computes every gap in ONE reverse pass per layer (O(E·L) total).
//   • event.gapBase — each event's start offset into eventGaps (stamped in place on the emitted event).
//   • seedTable  — per layer, its occurrence ticks (ascending) + the rawFraction at each, so _seedDeck
//                  binary-searches the last tone at/before a swap boundary instead of scanning events twice.
//
// events are tick-ascending with a unique tick per event and ≤1 action per canonical layer per event
// (cull2-grid-core builds them that way), so per-layer occurrences are already in ascending tick order.
// Float64 (not Int32): grid is an LCM and a wrap gap can exceed 2^31; float64 holds these integer ticks
// exactly, and clones as a bulk copy rather than boxing each number.
export function buildRowScheduleTables(events, grid, repeatCull) {
  const perLayer = new Map();   // layer -> { flat:[], ticks:[], tones:[], fractions:[] } in event order
  let totalActions = 0;
  for (let e = 0; e < events.length; e++) {
    const layerActions = events[e].layerActions;
    events[e].gapBase = totalActions;
    for (let a = 0; a < layerActions.length; a++) {
      const action = layerActions[a];
      let rec = perLayer.get(action.layer);
      if (!rec) perLayer.set(action.layer, rec = { flat: [], ticks: [], tones: [], fractions: [] });
      rec.flat.push(totalActions + a);
      rec.ticks.push(events[e].tick);
      rec.tones.push(actionToneKey(action));
      rec.fractions.push(action.rawFraction);
    }
    totalActions += layerActions.length;
  }
  const eventGaps = new Float64Array(totalActions);
  const seedTable = [];
  for (const [layer, rec] of perLayer) {
    const m = rec.ticks.length, t0 = rec.ticks[0];
    if (repeatCull) {
      // Forward to the next occurrence with a DIFFERENT tone (same-tone holds are silent so they don't
      // count as a re-articulation); if none forward, the loop wraps to occurrence 0 regardless of tone,
      // because the hold memory clears at the wrap. nextDiff[j] = j+1 when tones differ, else nextDiff[j+1]
      // (same tone → same target) — one reverse pass carrying that value.
      let carry = -1;
      for (let j = m - 1; j >= 0; j--) {
        const nd = j === m - 1 ? -1 : (rec.tones[j + 1] !== rec.tones[j] ? j + 1 : carry);
        eventGaps[rec.flat[j]] = nd >= 0 ? rec.ticks[nd] - rec.ticks[j] : grid - rec.ticks[j] + t0;
        carry = nd;
      }
    } else {
      // No repeat-cull: the very next occurrence articulates regardless of tone; last wraps to occurrence 0.
      for (let j = m - 1; j >= 0; j--) {
        eventGaps[rec.flat[j]] = j + 1 < m ? rec.ticks[j + 1] - rec.ticks[j] : grid - rec.ticks[j] + t0;
      }
    }
    seedTable.push({ layer, ticks: Float64Array.from(rec.ticks), fractions: rec.fractions });
  }
  return { eventGaps, seedTable };
}

// The lab readout intentionally retains rich diagnostics. The flight path must not structured-clone
// that ~MB-scale object per star, so this is the immutable playback projection crossing the worker.
export function compactGridAudioProgram(readout, metadata = {}) {
  const internAction = makeActionInterner();   // shared action objects → structured clone dedups them across onsets
  const events = readout.events.map(event => ({
    tick: event.tick,
    layerActions: event.layerActions.map(internAction),
  }));
  // Precompute here (once, off the main thread) so deck swaps and the 40 Hz loop are table lookups.
  const { eventGaps, seedTable } = buildRowScheduleTables(events, readout.grid, readout.repeatCull);
  return {
    mode: AUDIO_MODES.CULLED_GRID_ROWS,
    grid: readout.grid,
    programKey: `grid:${readout.grid}|${metadata.selectionKey || 'all'}|g:${metadata.generation ?? 0}`,
    selectionKey: metadata.selectionKey || 'all',
    generation: metadata.generation ?? 0,
    reflect: readout.reflect,
    repeatCull: readout.repeatCull,
    layers: [...readout.layers],
    selectedFractions: readout.ratioCatalog.filter(note => note.selected).map(note => note.fraction),
    // ownerKey/ownerLayers identify the representative rhythm each selected tone comes from — the same
    // canonical key grid-core stamps on bloom nodes, so a sounding voice can light its own bloom node.
    selectedTones: readout.ratioCatalog.filter(note => note.selected).map(note => ({
      fraction: note.fraction, cents: note.cents, ownerKey: note.ownerKey ?? null, ownerLayers: note.ownerLayers ?? null,
    })),
    events,
    eventGaps,   // flat gap-ticks table; indexed by event.gapBase + layerAction index
    seedTable,   // per-layer occurrence ticks + rawFractions for the deck-swap seed binary search
    summary: {
      representativeRhythms: readout.summary.representativeRhythms,
      distinctRatios: readout.summary.distinctRatios,
      selectedRatios: readout.summary.selectedRatios,
      compositeTicks: readout.summary.compositeTicks,
      canonicalActions: readout.summary.canonicalActions,
      collisionActions: readout.summary.collisionActions,
      suppressedCandidates: readout.summary.suppressedCandidates,
    },
  };
}

export function compileGridAudioProgram({
  grid,
  ratioOwners,
  abundance = 0,
  selectedFractions = [],
  selectionKey = 'all',
  generation = 0,
  reflect = true,
  repeatCull = true,
} = {}) {
  if (!Number.isSafeInteger(grid) || grid < 2) throw new Error('A valid grid is required.');
  if (!Array.isArray(ratioOwners) || !ratioOwners.length) throw new Error(`Grid ${grid} has no finalized ratio owners.`);
  const ownerSolve = {
    grid,
    ratioOwners,
    keptCount: Math.max(0, Number(abundance) || 0),
    validCount: 0,
    tuningSystems: 0,
    tooLarge: false,
    ms: 0,
  };
  const readout = buildGridCull2Readout(grid, { reflect, repeatCull, selectedFractions, ownerSolve });
  return compactGridAudioProgram(readout, { selectionKey, generation });
}
