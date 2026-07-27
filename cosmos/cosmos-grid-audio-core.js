// cosmos-grid-audio-core.js — pure contracts shared by flight-view, the Cull2 compiler worker,
// and headless guards. No DOM, Worker, or WebAudio state belongs here.
import { buildGridCull2Readout } from './cull2-grid-core.js?v=6';

export const AUDIO_MODES = Object.freeze({
  AMBIENT_CHORDS: 'ambient-chords',
  CULLED_GRID_ROWS: 'culled-grid-rows',
});

// The clicked Ambient Chords rhythm and the spatial Cull2 rows intentionally share one voice color.
// Their envelopes and spatial graphs remain mode-specific.
export const RHYTHM_VOICE_WAVEFORM = 'triangle';

export const ROW_ACTIVE_STARS = 8;
export const ROW_PREWARM_STARS = 12;
export const ROW_RADIUS = 1400;
export const ROW_CONSONANCE_CENTS = 15;
export const ROW_SWITCH_TICKS = 16;
export const CULLED_ROW_MAX_VOICES_PER_TONE = 4;

const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

// A ratio owner's cents are absolute within the octave. The solved sky root is the harmonic frame's
// anchor, so chord degrees are measured from that anchor with signed circular deviation from 12TET.
export function ownerChordMatch(ownerCents, rootCents, chordSemitones, windowCents = ROW_CONSONANCE_CENTS) {
  if (!Number.isFinite(ownerCents) || !Number.isFinite(rootCents)) return null;
  const relative = mod(ownerCents - rootCents, 1200);
  const degree = Math.round(relative / 100) % 12;
  const target = degree * 100;
  let deviation = relative - target;
  if (deviation > 600) deviation -= 1200;
  if (deviation < -600) deviation += 1200;
  const selected = new Set(chordSemitones || []).has(degree) && Math.abs(deviation) <= windowCents;
  return { degree, deviation, selected };
}

export function selectedOwnerFractions(ratioOwners, rootCents, chordSemitones, windowCents = ROW_CONSONANCE_CENTS) {
  return (ratioOwners || []).filter(owner => ownerChordMatch(owner.cents, rootCents, chordSemitones, windowCents)?.selected)
    .map(owner => owner.fraction);
}

export function harmonicSelectionKey(rootKey, chordId, windowCents = ROW_CONSONANCE_CENTS) {
  return `root:${rootKey}|chord:${chordId}|window:${windowCents}`;
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

function compactAction(action) {
  return {
    layer: action.layer,
    action: action.action,
    rawRatio: action.rawRatio,
    rawFraction: action.rawFraction,
    foldedRatio: action.foldedRatio,
    fraction: action.fraction,
    gap: action.gap,
  };
}

// The lab readout intentionally retains rich diagnostics. The flight path must not structured-clone
// that ~MB-scale object per star, so this is the immutable playback projection crossing the worker.
export function compactGridAudioProgram(readout, metadata = {}) {
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
    selectedTones: readout.ratioCatalog.filter(note => note.selected).map(note => ({ fraction: note.fraction, cents: note.cents })),
    events: readout.events.map(event => ({
      tick: event.tick,
      layerActions: event.layerActions.map(compactAction),
    })),
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
