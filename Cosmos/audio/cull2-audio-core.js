// cull2-audio-core.js — a pure temporal port of Pathways._applyCull2, plus the Cosmos
// palindrome-reflection rule. No DOM/audio and no imports from the main LRC playback engine.
//
// A gap event belongs to the composite onset that STARTS the gap. Time reversal therefore maps
// event i to N-1-i: the mirrored event has the same gap/ratio, but commonly different layer owners.
// That distinction is the musical point of the reflection pass — it restores the back-half event at
// its real location and with its real ownership rather than cloning the front-half voice.
import { decimalToFraction, lcmAll, normalizeLayers, ratioToCents } from '../engine/oracle-core.js';

const LAYER_NAMES = ['A', 'B', 'C', 'D'];

export function parseRhythmInput(value) {
  const layers = String(value ?? '').match(/\d+/g)?.map(Number).filter(n => Number.isInteger(n) && n > 0) || [];
  if (layers.length < 2 || layers.length > 4) throw new Error('Enter 2–4 positive integer layers.');
  return layers;
}

const foldOctave = ratio => {
  let folded = ratio;
  while (folded >= 2) folded /= 2;
  while (folded < 1) folded *= 2;
  return folded;
};

function compositeTape(rawLayers) {
  const layers = normalizeLayers(rawLayers);
  const grid = lcmAll(layers);
  const ownersAt = new Map();
  layers.forEach((layer, layerIndex) => {
    const step = grid / layer;
    for (let i = 0; i < layer; i++) {
      const tick = i * step;
      let owners = ownersAt.get(tick);
      if (!owners) ownersAt.set(tick, owners = []);
      owners.push(LAYER_NAMES[layerIndex]);
    }
  });

  const nodes = [...ownersAt.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, owners], index) => ({ index, tick, owners, coincident: owners.length > 1 }));
  const gaps = nodes.map((node, i) => {
    const next = nodes[(i + 1) % nodes.length];
    return i + 1 < nodes.length ? next.tick - node.tick : grid - node.tick + next.tick;
  });
  // Largest gap = the fundamental (slowest) pulse. Do NOT use a spread Math.max over gaps: spreading a
  // grid-sized array as call arguments overflows the stack ("Maximum call stack size exceeded") once a
  // large grid makes `gaps` exceed the engine's argument limit — the huge-grid (e.g. grid ~994855)
  // audio-drop bug, where every affected zone's row compile threw and produced no program. Fold O(n).
  let fundamentalGap = 0;
  for (const gap of gaps) if (gap > fundamentalGap) fundamentalGap = gap;
  const events = nodes.map((node, i) => {
    const next = nodes[(i + 1) % nodes.length];
    const rawRatio = fundamentalGap / gaps[i];
    const foldedRatio = foldOctave(rawRatio);
    return {
      index: i,
      tick: node.tick,
      phase: node.tick / grid,
      owners: [...node.owners],
      gap: gaps[i],
      rawRatio,
      rawFraction: decimalToFraction(rawRatio),
      foldedRatio,
      fraction: decimalToFraction(foldedRatio),
      cents: ratioToCents(foldedRatio),
      nextTick: next.tick,
      nextOwners: [...next.owners],
      nextIsCoincident: next.coincident,
      half: node.tick < grid / 2 ? 'front' : node.tick > grid / 2 ? 'back' : 'midpoint',
      mirrorIndex: nodes.length - 1 - i,
    };
  });
  return { inputLayers: rawLayers.slice(), layers, grid, fundamentalGap, nodes, events };
}

// Exact section ranges used by Pathways._applyCull2:
//   ground [0, first connector), then each [connector i, connector i+1), while the final
//   wrap connector remains structural/kept. A connector is an event whose TARGET node is coincident.
function applyCull2(events) {
  const baseKeep = new Array(events.length).fill(true);
  const connectorIndices = events.filter(e => e.nextIsCoincident).map(e => e.index);
  const sections = [];

  if (connectorIndices.length < 2) {
    sections.push({ id: 0, kind: 'unsegmented', start: 0, end: events.length, eligible: false, culled: false });
  } else {
    sections.push({ id: 0, kind: 'ground', start: 0, end: connectorIndices[0], eligible: false, culled: false });
    for (let i = 0; i < connectorIndices.length - 1; i++) {
      sections.push({ id: sections.length, kind: 'z', start: connectorIndices[i], end: connectorIndices[i + 1], eligible: true, culled: false });
    }
    sections.push({ id: sections.length, kind: 'wrap', start: connectorIndices.at(-1), end: events.length, eligible: false, culled: false });
  }

  const seenGaps = new Set();
  for (const section of sections) {
    const sectionEvents = events.slice(section.start, section.end);
    const gapValues = [...new Set(sectionEvents.map(e => e.gap))];
    const seenBefore = new Set(seenGaps);
    const novelGaps = gapValues.filter(g => !seenBefore.has(g));

    if (section.kind === 'ground') gapValues.forEach(g => seenGaps.add(g));
    else if (section.eligible && gapValues.length) {
      section.culled = novelGaps.length === 0;
      if (section.culled) for (let i = section.start; i < section.end; i++) baseKeep[i] = false;
      else gapValues.forEach(g => seenGaps.add(g));
    }

    Object.assign(section, {
      eventCount: sectionEvents.length,
      gapValues,
      ratios: [...new Set(sectionEvents.map(e => e.fraction))],
      novelGaps,
      seenBefore: [...seenBefore],
    });
  }

  const eventToSection = new Array(events.length).fill(null);
  for (const section of sections) for (let i = section.start; i < section.end; i++) eventToSection[i] = section.id;
  return { baseKeep, connectorIndices, sections, eventToSection };
}

export function buildCull2Readout(rawLayers, { reflect = true, repeatCull = true, selectedFractions = null } = {}) {
  if (!Array.isArray(rawLayers) || rawLayers.length < 2 || rawLayers.length > 4 || rawLayers.some(n => !Number.isInteger(n) || n <= 0)) {
    throw new Error('Rhythm must contain 2–4 positive integer layers.');
  }
  const tape = compositeTape(rawLayers);
  const cull = applyCull2(tape.events);
  const finalKeep = [...cull.baseKeep];
  const reflectedFrom = new Array(tape.events.length).fill(null);
  const selection = selectedFractions == null ? null : new Set(selectedFractions);

  if (reflect) {
    for (const event of tape.events) {
      if (event.tick >= tape.grid / 2 || !cull.baseKeep[event.index]) continue;
      finalKeep[event.mirrorIndex] = true;
      reflectedFrom[event.mirrorIndex] = event.index;
    }
  }

  const preRepeatEvents = tape.events.map(event => {
    const selected = selection == null || selection.has(event.fraction);
    const action = cull.baseKeep[event.index] ? 'survivor' : finalKeep[event.index] ? 'reflection' : 'hold';
    return {
      ...event,
      sectionId: cull.eventToSection[event.index],
      baseKeep: cull.baseKeep[event.index],
      reflectedFrom: reflectedFrom[event.index],
      finalKeep: finalKeep[event.index],
      selected,
      action,
    };
  });

  // Third culling layer: suppress a layer's attack when that SAME layer is already holding the same
  // exact tone. Gap equality is the identity here — unlike the folded Scale Selector, it preserves
  // octave/register because rawRatio = fundamentalGap/gap. Seed each layer from its final eligible
  // event in the prior cycle so the readout describes steady-state looping, not only the first pass.
  // The audition player still seeds a silent layer on demand at startup.
  const initialGapByLayer = new Map();
  for (const event of preRepeatEvents) if (event.finalKeep && event.selected) {
    for (const layer of event.owners) initialGapByLayer.set(layer, event.gap);
  }
  const heldGapByLayer = new Map(initialGapByLayer);
  const events = preRepeatEvents.map(event => {
    const layerActions = event.owners.map(layer => {
      if (!event.finalKeep) return { layer, action: 'structural-hold', gap: event.gap };
      if (!event.selected) return { layer, action: 'selector-off', gap: event.gap };
      const previousGap = heldGapByLayer.get(layer);
      if (repeatCull && previousGap === event.gap) return { layer, action: 'repeat-hold', gap: event.gap, previousGap };
      heldGapByLayer.set(layer, event.gap);
      return { layer, action: 'play', gap: event.gap, previousGap: previousGap ?? null };
    });
    const audioAction = layerActions.some(a => a.action === 'play') ? 'play'
      : layerActions.some(a => a.action === 'repeat-hold') ? 'repeat-hold'
      : !event.finalKeep ? 'hold' : 'off';
    return { ...event, layerActions, audioAction };
  });

  const sections = cull.sections.map(section => {
    const sectionEvents = events.slice(section.start, section.end);
    const mirrorSectionIds = [...new Set(sectionEvents.map(e => cull.eventToSection[e.mirrorIndex]).filter(id => id != null))];
    const mirroredGaps = sectionEvents.map(e => events[e.mirrorIndex].gap).reverse();
    const gaps = sectionEvents.map(e => e.gap);
    return {
      ...section,
      half: sectionEvents.length
        ? (sectionEvents.every(e => e.tick < tape.grid / 2) ? 'front'
          : sectionEvents.every(e => e.tick >= tape.grid / 2) ? 'back' : 'crosses midpoint')
        : 'empty',
      finalEventCount: sectionEvents.filter(e => e.finalKeep).length,
      selectedEventCount: sectionEvents.filter(e => e.finalKeep && e.selected).length,
      deselectedEventCount: sectionEvents.filter(e => e.finalKeep && !e.selected).length,
      layerPlayCount: sectionEvents.flatMap(e => e.layerActions).filter(a => a.action === 'play').length,
      layerRepeatHoldCount: sectionEvents.flatMap(e => e.layerActions).filter(a => a.action === 'repeat-hold').length,
      reflectedEventCount: sectionEvents.filter(e => e.action === 'reflection').length,
      mirrorSectionIds,
      reflectedGapSequenceMatches: gaps.length === mirroredGaps.length && gaps.every((g, i) => g === mirroredGaps[i]),
    };
  });

  const gapPalindrome = events.every(e => e.gap === events[e.mirrorIndex].gap);
  const ratioPalindrome = events.every(e => e.fraction === events[e.mirrorIndex].fraction);
  const frontSurvivors = events.filter(e => e.tick < tape.grid / 2 && e.baseKeep);
  const ratioCatalog = [...new Set(events.map(e => e.fraction))]
    .map(fraction => {
      const occurrences = events.filter(e => e.fraction === fraction);
      return {
        fraction,
        cents: occurrences[0].cents,
        selected: occurrences[0].selected,
        occurrenceCount: occurrences.length,
        structuralEventCount: occurrences.filter(e => e.finalKeep).length,
        playEventCount: occurrences.flatMap(e => e.layerActions).filter(a => a.action === 'play').length,
        repeatHoldCount: occurrences.flatMap(e => e.layerActions).filter(a => a.action === 'repeat-hold').length,
        owners: [...new Set(occurrences.flatMap(e => e.owners))],
      };
    })
    .sort((a, b) => a.cents - b.cents || a.fraction.localeCompare(b.fraction));
  return {
    inputLayers: tape.inputLayers,
    layers: tape.layers,
    grid: tape.grid,
    fundamentalGap: tape.fundamentalGap,
    midpoint: tape.grid / 2,
    connectorIndices: cull.connectorIndices,
    gapPalindrome,
    ratioPalindrome,
    repeatCull,
    ratioCatalog,
    sections,
    events,
    summary: {
      compositeOnsets: events.length,
      distinctGaps: new Set(events.map(e => e.gap)).size,
      distinctRatios: new Set(events.map(e => e.fraction)).size,
      selectedRatios: ratioCatalog.filter(r => r.selected).length,
      baseSurvivors: events.filter(e => e.baseKeep).length,
      reflectedAdditions: events.filter(e => e.action === 'reflection').length,
      finalEvents: events.filter(e => e.finalKeep).length,
      holds: events.filter(e => !e.finalKeep).length,
      playEvents: events.filter(e => e.audioAction === 'play').length,
      repeatHoldEvents: events.filter(e => e.audioAction === 'repeat-hold').length,
      deselectedEvents: events.filter(e => e.audioAction === 'off').length,
      layerPlays: events.flatMap(e => e.layerActions).filter(a => a.action === 'play').length,
      layerRepeatHolds: events.flatMap(e => e.layerActions).filter(a => a.action === 'repeat-hold').length,
      frontSurvivors: frontSurvivors.length,
      reflectedFrontSurvivors: frontSurvivors.filter(e => events[e.mirrorIndex].finalKeep).length,
    },
  };
}

// Project the final readout into the same conceptual unit ToneRowPlayback schedules: one trigger per
// owning layer. Coincident composite onsets intentionally yield simultaneous triggers on each owner.
// Structural HOLD, repeated-layer HOLD, and selector-OFF actions produce no triggers; their absence is
// what makes active layer voices sustain. Raw ratio is kept here (not foldedRatio): tone-row playback
// preserves the octave encoded by the exact gap value. Pure so this contract is guardable headlessly.
export function layerTriggersForReadout(readout) {
  if (!readout || !Array.isArray(readout.events)) return [];
  return readout.events.flatMap(event => event.layerActions
    .filter(layerAction => layerAction.action === 'play')
    .map(layerAction => ({
      eventIndex: event.index,
      tick: event.tick,
      phase: event.phase,
      layer: layerAction.layer,
      fraction: event.fraction,
      ratio: event.rawRatio,
      foldedRatio: event.foldedRatio,
      gap: event.gap,
      structuralAction: event.action,
    })));
}
