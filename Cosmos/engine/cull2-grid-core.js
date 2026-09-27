// cull2-grid-core.js — reduce one Cosmos grid star to the lowest-layer-sum rhythm owner of each
// folded ratio, compile only those representative rhythms through Cull2 + palindrome reflection,
// then overlay them into a single four-voice transport program. Same-tone holding is deliberately
// applied only AFTER the rhythms are overlaid: another rhythm may have replaced canonical voice
// A/B/C/D between two attacks of the first rhythm.
import { gridRatioOwnerSolve } from './grid-core.js?v=6';
import { buildCull2Readout } from '../audio/cull2-audio-core.js?v=6';

const CANONICAL_LAYERS = ['A', 'B', 'C', 'D'];

const compareToneGroups = (a, b) =>
  b.support - a.support ||
  a.rawRatio - b.rawRatio ||
  a.rawFraction.localeCompare(b.rawFraction) ||
  a.rhythmKeys[0].localeCompare(b.rhythmKeys[0]);

function aggregateRatioCatalog(compiledRhythms, ratioOwners, selection) {
  const rhythmByKey = new Map(compiledRhythms.map(rhythm => [rhythm.key, rhythm]));
  return ratioOwners.map(owner => {
    const rhythm = rhythmByKey.get(owner.key);
    const note = rhythm?.readout.ratioCatalog.find(candidate => candidate.fraction === owner.fraction);
    return {
      fraction: owner.fraction,
      cents: owner.cents,
      selected: selection == null || selection.has(owner.fraction),
      occurrenceCount: note?.occurrenceCount || 0,
      structuralEventCount: note?.structuralEventCount || 0,
      playEventCount: 0,
      repeatHoldCount: 0,
      rhythmCount: 1,
      rhythmKeys: [owner.key],
      owners: note?.owners || [],
      ownerKey: owner.key,
      ownerLayers: owner.layers,
      ownerLayerSum: owner.layerSum,
    };
  }).sort((a, b) => a.cents - b.cents || a.fraction.localeCompare(b.fraction));
}

function candidateGroups(candidates) {
  const byTone = new Map();
  for (const candidate of candidates) {
    let group = byTone.get(candidate.rawFraction);
    if (!group) byTone.set(candidate.rawFraction, group = {
      rawFraction: candidate.rawFraction,
      rawRatio: candidate.rawRatio,
      foldedRatio: candidate.foldedRatio,
      fraction: candidate.fraction,
      cents: candidate.cents,
      support: 0,
      rhythmKeys: [],
      sources: [],
    });
    group.support++;
    group.rhythmKeys.push(candidate.rhythmKey);
    group.sources.push(candidate);
  }
  return [...byTone.values()].map(group => ({
    ...group,
    rhythmKeys: [...new Set(group.rhythmKeys)].sort(),
  })).sort(compareToneGroups);
}

export function buildGridCull2Readout(rawGrid, { reflect = true, repeatCull = true, selectedFractions = null, ownerSolve = null } = {}) {
  const grid = Number(rawGrid);
  if (!Number.isSafeInteger(grid) || grid < 2) throw new Error('Grid must be a safe integer of 2 or greater.');

  const solved = ownerSolve && ownerSolve.grid === grid ? ownerSolve : gridRatioOwnerSolve(grid);
  if (solved.tooLarge) throw new Error(`Grid ${grid} has ${solved.divisorCount} divisors and exceeds the lab's synchronous solve cap.`);

  const selection = selectedFractions == null ? null : new Set(selectedFractions);
  const ownersByRhythm = new Map();
  for (const owner of solved.ratioOwners) {
    let group = ownersByRhythm.get(owner.key);
    if (!group) ownersByRhythm.set(owner.key, group = { ...owner, ownedFractions: [] });
    group.ownedFractions.push(owner.fraction);
  }
  const compiledRhythms = [...ownersByRhythm.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(system => {
      const ownedSelection = system.ownedFractions.filter(fraction => selection == null || selection.has(fraction));
      // Per-rhythm repeated-gap culling would be incorrect after overlay. Compile structural Cull2,
      // reflection, and ONLY the ratios this rhythm globally owns; the canonical layer pass below
      // owns repeat holds.
      const readout = buildCull2Readout(system.layers, {
        reflect,
        repeatCull: false,
        selectedFractions: ownedSelection,
      });
      if (readout.grid !== grid) throw new Error(`Rhythm ${system.key} resolved to grid ${readout.grid}, expected ${grid}.`);
      return {
        key: system.key,
        role: 'ratio owner',
        cardinality: system.cardinality,
        ownedFractions: system.ownedFractions.sort(),
        layers: readout.layers,
        readout,
      };
    });

  const ratioCatalog = aggregateRatioCatalog(compiledRhythms, solved.ratioOwners, selection);
  const candidatesByTick = new Map();
  for (const rhythm of compiledRhythms) for (const event of rhythm.readout.events) {
    if (!event.finalKeep || !event.selected) continue;
    let tickLayers = candidatesByTick.get(event.tick);
    if (!tickLayers) candidatesByTick.set(event.tick, tickLayers = new Map());
    for (const layerAction of event.layerActions) {
      if (layerAction.action !== 'play') continue;
      let candidates = tickLayers.get(layerAction.layer);
      if (!candidates) tickLayers.set(layerAction.layer, candidates = []);
      candidates.push({
        rhythmKey: rhythm.key,
        rhythmRole: rhythm.role,
        sourceEventIndex: event.index,
        structuralAction: event.action,
        layer: layerAction.layer,
        gap: event.gap,
        rawFraction: event.rawFraction,
        rawRatio: event.rawRatio,
        foldedRatio: event.foldedRatio,
        fraction: event.fraction,
        cents: event.cents,
      });
    }
  }

  // At a coincident grid tick, one canonical layer can receive different pitches from several
  // rhythms. One voice cannot sound all of them. The prototype's deterministic neutral arbitration
  // keeps the pitch with the strongest cross-rhythm support; ties prefer the lower register, then
  // rhythm identity. The readout retains every losing candidate so this policy is inspectable.
  const choices = [...candidatesByTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, layerMap]) => ({
    tick,
    phase: tick / grid,
    layers: CANONICAL_LAYERS.flatMap(layer => {
      const candidates = layerMap.get(layer) || [];
      if (!candidates.length) return [];
      const toneGroups = candidateGroups(candidates);
      return [{
        layer,
        winner: toneGroups[0],
        toneGroups,
        candidateCount: candidates.length,
        collisionToneCount: toneGroups.length,
      }];
    }),
  }));

  // Seed with the final chosen pitch of the preceding cycle so the static program describes the
  // steady-state loop. A silent transport startup still seeds a repeat-hold in the audio player.
  const heldToneByLayer = new Map();
  for (const choice of choices) for (const layerChoice of choice.layers) heldToneByLayer.set(layerChoice.layer, layerChoice.winner.rawFraction);

  const events = choices.map((choice, index) => {
    const layerActions = choice.layers.map(layerChoice => {
      const winner = layerChoice.winner;
      const previousTone = heldToneByLayer.get(layerChoice.layer);
      const action = repeatCull && previousTone === winner.rawFraction ? 'repeat-hold' : 'play';
      heldToneByLayer.set(layerChoice.layer, winner.rawFraction);
      return {
        layer: layerChoice.layer,
        action,
        previousTone: previousTone ?? null,
        ...winner,
        candidateCount: layerChoice.candidateCount,
        collisionToneCount: layerChoice.collisionToneCount,
        toneGroups: layerChoice.toneGroups,
      };
    });
    return {
      index,
      tick: choice.tick,
      phase: choice.phase,
      finalKeep: true,
      selected: true,
      layerActions,
      audioAction: layerActions.some(action => action.action === 'play') ? 'play' : 'repeat-hold',
    };
  });

  const actionRows = events.flatMap(event => event.layerActions);
  for (const note of ratioCatalog) {
    const matching = actionRows.filter(action => action.fraction === note.fraction);
    note.playEventCount = matching.filter(action => action.action === 'play').length;
    note.repeatHoldCount = matching.filter(action => action.action === 'repeat-hold').length;
  }
  const sourceSurvivors = compiledRhythms.reduce((sum, rhythm) => sum + rhythm.readout.summary.finalEvents, 0);
  const sourceLayerAttacks = compiledRhythms.reduce((sum, rhythm) => sum + rhythm.readout.events
    .flatMap(event => event.layerActions).filter(action => action.action === 'play').length, 0);
  // Do not retain thousands of full per-rhythm event tapes in the star program. The composite events
  // below are the playback contract; this compact row is enough for the lab's per-rhythm readout.
  const rhythms = compiledRhythms.map(rhythm => ({
    key: rhythm.key,
    role: rhythm.role,
    cardinality: rhythm.cardinality,
    ownedFractions: rhythm.ownedFractions,
    ownedRatioCount: rhythm.ownedFractions.length,
    layers: rhythm.layers,
    grid: rhythm.readout.grid,
    structuralRepeatCull: rhythm.readout.repeatCull,
    summary: rhythm.readout.summary,
  }));

  return {
    mode: 'grid',
    grid,
    layers: CANONICAL_LAYERS,
    programKey: `grid:${grid}`,
    scheduleKey: events.map(event => `${event.tick}:${event.layerActions.map(action => `${action.layer}=${action.rawFraction}`).join(',')}`).join('|'),
    reflect,
    repeatCull,
    ownerSolve: solved,
    ratioOwners: solved.ratioOwners,
    ratioCatalog,
    rhythms,
    events,
    summary: {
      keptRhythms: solved.keptCount,
      representativeRhythms: rhythms.length,
      ownershipReductionPct: solved.keptCount ? 100 * (1 - rhythms.length / solved.keptCount) : 0,
      validRhythms: solved.validCount,
      tuningSystems: solved.tuningSystems,
      distinctRatios: ratioCatalog.length,
      selectedRatios: ratioCatalog.filter(note => note.selected).length,
      sourceOnsets: rhythms.reduce((sum, rhythm) => sum + rhythm.summary.compositeOnsets, 0),
      sourceSurvivors,
      sourceLayerAttacks,
      compositeTicks: events.length,
      canonicalActions: actionRows.length,
      layerPlays: actionRows.filter(action => action.action === 'play').length,
      layerRepeatHolds: actionRows.filter(action => action.action === 'repeat-hold').length,
      collisionActions: actionRows.filter(action => action.collisionToneCount > 1).length,
      suppressedCandidates: actionRows.reduce((sum, action) => sum + action.candidateCount - action.support, 0),
      solveMs: solved.ms,
    },
  };
}
