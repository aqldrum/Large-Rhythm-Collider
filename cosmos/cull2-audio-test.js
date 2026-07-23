import { buildCull2Readout, parseRhythmInput } from './cull2-audio-core.js';
import { Cull2AudioPlayer } from './cull2-audio-player.js';
import { normalizeLayers } from './oracle-core.js';

const $ = id => document.getElementById(id);
const input = $('rhythm-input');
const gridInput = $('grid-input');
const error = $('error');
const summary = $('summary');
const tape = $('tape');
const segmentBody = $('segment-body');
const eventBody = $('event-body');
const gridRhythmBody = $('grid-rhythm-body');
const gridEventBody = $('grid-event-body');
const reflectionToggle = $('reflection-toggle');
const repeatCullToggle = $('repeat-cull-toggle');
const scaleNotes = $('scale-notes');
const audioPlay = $('audio-play');
const audioStatus = $('audio-status');
let currentMode = 'rhythm';
let selectedFractions = new Set();
let currentSignature = '';
let initialNotes = null;
const selectionsBySignature = new Map();
let latestProgram = null;
let renderRequest = 0;
let activeGridWorker = null;
const gridOwnerCache = new Map();

const player = new Cull2AudioPlayer({ onState: playing => {
  audioPlay.textContent = playing ? '■ Stop' : `▶ Play ${currentMode === 'grid' ? 'grid composite' : 'culled tone row'}`;
  audioPlay.classList.toggle('playing', playing);
  audioStatus.textContent = `${playing ? 'playing' : 'stopped'} · ${currentMode === 'grid' ? 'one canonical voice per A–D layer' : 'per-layer legato'}`;
} });

const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const list = xs => xs.length ? xs.join(', ') : '—';
const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;

function setMode(mode, shouldRender = true) {
  if (!['rhythm', 'grid'].includes(mode)) mode = 'rhythm';
  currentMode = mode;
  const gridMode = mode === 'grid';
  $('rhythm-tab').setAttribute('aria-selected', String(!gridMode));
  $('grid-tab').setAttribute('aria-selected', String(gridMode));
  $('rhythm-controls').hidden = gridMode;
  $('grid-controls').hidden = !gridMode;
  $('rhythm-readouts').hidden = gridMode;
  $('grid-readouts').hidden = !gridMode;
  audioPlay.textContent = player.playing ? '■ Stop' : `▶ Play ${gridMode ? 'grid composite' : 'culled tone row'}`;
  audioStatus.textContent = `${player.playing ? 'playing' : 'stopped'} · ${gridMode ? 'one canonical voice per A–D layer' : 'per-layer legato'}`;
  if (shouldRender) render();
}

function toggleSection(trigger) {
  const body = document.getElementById(trigger.getAttribute('aria-controls'));
  if (!body) return;
  const expanded = trigger.getAttribute('aria-expanded') !== 'false';
  trigger.setAttribute('aria-expanded', String(!expanded));
  body.hidden = expanded;
}

document.addEventListener('dblclick', event => {
  const trigger = event.target.closest('.collapse-trigger');
  if (!trigger) return;
  event.preventDefault();
  toggleSection(trigger);
});
document.addEventListener('click', event => {
  const trigger = event.target.closest('.collapse-trigger');
  if (trigger && event.detail === 0) toggleSection(trigger);
});

function buildOptions(selectedFractionsOption = null) {
  return {
    reflect: reflectionToggle.checked,
    repeatCull: repeatCullToggle.checked,
    selectedFractions: selectedFractionsOption,
  };
}

function compileGrid(grid, options, requestId) {
  if (activeGridWorker) activeGridWorker.terminate();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cull2-grid-worker.js?v=6', import.meta.url), { type: 'module' });
    activeGridWorker = worker;
    worker.onmessage = event => {
      if (activeGridWorker === worker) activeGridWorker = null;
      worker.terminate();
      if (event.data?.id !== requestId) return reject(new Error('Stale grid solve.'));
      if (event.data.error) reject(new Error(event.data.error));
      else {
        if (event.data.result?.ownerSolve) gridOwnerCache.set(Number(grid), event.data.result.ownerSolve);
        resolve(event.data.result);
      }
    };
    worker.onerror = event => {
      if (activeGridWorker === worker) activeGridWorker = null;
      worker.terminate();
      const location = event.filename ? ` (${event.filename}${event.lineno ? `:${event.lineno}` : ''})` : '';
      reject(new Error(event.message ? `Grid worker failed: ${event.message}${location}` : 'Grid worker failed during module startup. Reload once to refresh the worker module graph.'));
    };
    worker.postMessage({ id: requestId, grid, options: { ...options, ownerSolve: gridOwnerCache.get(Number(grid)) || null } });
  });
}

function buildProgram(snapshot, selectedFractionsOption, requestId) {
  const options = buildOptions(selectedFractionsOption);
  if (snapshot.mode === 'grid') return compileGrid(snapshot.grid, options, requestId);
  return Promise.resolve(buildCull2Readout(parseRhythmInput(snapshot.rhythm), options));
}

function currentSnapshot() {
  return {
    mode: currentMode,
    rhythm: input.value,
    grid: gridInput.value,
  };
}

function programSignature(result) {
  return result.mode === 'grid' ? `grid:${result.grid}` : `rhythm:${result.layers.join('.')}`;
}

function renderSummary(result) {
  const s = result.summary;
  if (result.mode === 'grid') {
    summary.innerHTML = `
      <div class="metric"><span>grid</span><b>${result.grid}</b></div>
      <div class="metric"><span>keep-2 / representative rhythms</span><b>${s.keptRhythms} / ${s.representativeRhythms}</b></div>
      <div class="metric"><span>ratio-owner reduction</span><b>${s.ownershipReductionPct.toFixed(1)}%</b></div>
      <div class="metric"><span>valid rhythms scanned</span><b>${s.validRhythms}</b></div>
      <div class="metric"><span>tuning systems</span><b>${s.tuningSystems}</b></div>
      <div class="metric"><span>selected ratios</span><b>${s.selectedRatios} / ${s.distinctRatios}</b></div>
      <div class="metric"><span>source onsets / survivors</span><b>${s.sourceOnsets} / ${s.sourceSurvivors}</b></div>
      <div class="metric"><span>source layer attacks</span><b>${s.sourceLayerAttacks}</b></div>
      <div class="metric"><span>composite ticks / actions</span><b>${s.compositeTicks} / ${s.canonicalActions}</b></div>
      <div class="metric"><span>canonical plays / repeat holds</span><b>${s.layerPlays} / ${s.layerRepeatHolds}</b></div>
      <div class="metric"><span>pitch collisions / losing candidates</span><b>${s.collisionActions} / ${s.suppressedCandidates}</b></div>
      <div class="metric"><span>synchronous solve</span><b>${s.solveMs.toFixed(1)} ms</b></div>
      <div class="checks">${badge('✓ lowest-layer-sum ratio owners', 'ok')}${badge('✓ representative Cull2', 'ok')}${badge('✓ palindromic reflection', result.reflect ? 'ok' : 'structural')}${badge('✓ canonical A–D overlay', 'ok')}</div>`;
    return;
  }
  const checks = [
    ['gap palindrome', result.gapPalindrome],
    ['ratio palindrome', result.ratioPalindrome],
    ['front survivors reflected', s.frontSurvivors === s.reflectedFrontSurvivors],
  ];
  summary.innerHTML = `
    <div class="metric"><span>normalized rhythm</span><b>${result.layers.join(' : ')}</b></div>
    <div class="metric"><span>grid / midpoint</span><b>${result.grid} / ${result.midpoint}</b></div>
    <div class="metric"><span>composite onsets</span><b>${s.compositeOnsets}</b></div>
    <div class="metric"><span>gaps / folded ratios</span><b>${s.distinctGaps} / ${s.distinctRatios}</b></div>
    <div class="metric"><span>selected ratios</span><b>${s.selectedRatios} / ${s.distinctRatios}</b></div>
    <div class="metric"><span>base cull2 survivors</span><b>${s.baseSurvivors}</b></div>
    <div class="metric"><span>reflection additions</span><b>${s.reflectedAdditions}</b></div>
    <div class="metric"><span>layer plays / repeat holds</span><b>${s.layerPlays} / ${s.layerRepeatHolds}</b></div>
    <div class="metric"><span>event play / off / structural hold</span><b>${s.playEvents} / ${s.deselectedEvents} / ${s.holds}</b></div>
    <div class="checks">${checks.map(([name, ok]) => badge(`${ok ? '✓' : '×'} ${name}`, ok ? 'ok' : 'bad')).join('')}</div>`;
}

function renderScaleSelector(result) {
  scaleNotes.innerHTML = result.ratioCatalog.map(note => `<button type="button" class="scale-note ${note.selected ? 'selected' : ''}" data-fraction="${esc(note.fraction)}" aria-pressed="${note.selected}">
    <b>${esc(note.fraction)}</b><small>${note.cents.toFixed(2)}¢ · ${note.structuralEventCount}/${note.occurrenceCount} structural${result.mode === 'grid' ? ` · ${note.rhythmCount} rhythms` : ''}</small>
  </button>`).join('');
}

function renderTape(result) {
  if (result.mode === 'grid') {
    tape.innerHTML = result.events.map((event, index) => {
      const next = result.events[(index + 1) % result.events.length];
      const width = next ? (index + 1 < result.events.length ? next.tick - event.tick : result.grid - event.tick + next.tick) : result.grid;
      const allHold = event.layerActions.every(action => action.action === 'repeat-hold');
      const tones = event.layerActions.map(action => `${action.layer}:${action.fraction}`).join(' ');
      const title = `tick ${event.tick} · ${event.layerActions.map(action => `${action.layer} ${action.rawFraction} ${action.action}`).join(' · ')}`;
      return `<div class="tape-event ${allHold ? 'repeat-hold' : 'survivor'}" style="flex-grow:${Math.max(1, width)}" title="${esc(title)}">
        <span>${event.index}</span><b>${esc(tones)}</b><small>${event.tick}</small>
      </div>`;
    }).join('');
    return;
  }
  tape.innerHTML = result.events.map(event => {
    const cls = event.audioAction === 'off' ? 'off' : event.audioAction === 'repeat-hold' ? 'repeat-hold' : event.action;
    const title = `#${event.index} tick ${event.tick} · ${event.owners.join('+')} · gap ${event.gap} · ${event.fraction} · ${event.audioAction}`;
    return `<div class="tape-event ${cls}" style="flex-grow:${Math.max(1, event.gap)}" title="${esc(title)}">
      <span>${event.index}</span><b>${esc(event.fraction)}</b><small>${esc(event.owners.join('+'))}</small>
    </div>`;
  }).join('');
}

function renderSegments(result) {
  segmentBody.innerHTML = result.sections.map(section => {
    const state = section.culled ? badge('CULLED → HOLD', 'hold')
      : section.kind === 'wrap' ? badge('STRUCTURAL KEEP', 'structural')
      : badge('SURVIVES', 'survivor');
    const mirror = section.mirrorSectionIds.length ? `z${section.mirrorSectionIds.join(', z')}` : '—';
    return `<tr>
      <td>z${section.id}<small>${esc(section.kind)}</small></td>
      <td>[${section.start}, ${section.end})<small>${esc(section.half)}</small></td>
      <td>${state}<small>${section.layerPlayCount} layer plays · ${section.layerRepeatHoldCount} repeat holds · ${section.deselectedEventCount} off · ${section.eventCount - section.finalEventCount} structural holds${section.reflectedEventCount ? ` · ${section.reflectedEventCount} restored` : ''}</small></td>
      <td>${esc(list(section.gapValues))}<small>new: ${esc(list(section.novelGaps))}</small></td>
      <td>${esc(list(section.ratios))}</td>
      <td>${esc(mirror)}<small>${section.reflectedGapSequenceMatches ? 'gap sequence matches' : 'partition/sequence differs'}</small></td>
    </tr>`;
  }).join('');
}

function renderEvents(result) {
  eventBody.innerHTML = result.events.map(event => {
    const mirrored = result.events[event.mirrorIndex];
    const action = event.audioAction === 'off' ? badge('SELECTOR OFF', 'structural')
      : event.audioAction === 'repeat-hold' ? badge('REPEATED GAP → HOLD', 'reflection')
      : event.action === 'survivor' ? badge('PLAY', 'survivor')
      : event.action === 'reflection' ? badge('PLAY — REFLECTION', 'reflection')
      : badge('HOLD', 'hold');
    const layerActions = event.layerActions.map(a => `${a.layer}:${a.action === 'repeat-hold' ? 'HOLD=' + a.gap : a.action.toUpperCase()}`).join(' · ');
    return `<tr class="${event.audioAction === 'off' ? 'off' : event.audioAction === 'repeat-hold' ? 'repeat-hold' : event.action}">
      <td>${event.index}<small>${(event.phase * 100).toFixed(2)}%</small></td>
      <td>${event.tick}<small>${esc(event.half)}</small></td>
      <td>${esc(event.owners.join('+'))}<small>${esc(layerActions)}</small></td>
      <td>${event.gap}</td>
      <td><b>${esc(event.fraction)}</b><small>${event.cents.toFixed(2)}¢ · raw ${esc(event.rawFraction)}</small></td>
      <td>z${event.sectionId ?? '—'}</td>
      <td>#${event.mirrorIndex}<small>${esc(mirrored.owners.join('+'))}</small></td>
      <td>${action}${event.reflectedFrom != null ? `<small>from #${event.reflectedFrom}</small>` : ''}</td>
    </tr>`;
  }).join('');
}

function renderGridReadouts(result) {
  const rhythmLimit = 1200;
  gridRhythmBody.innerHTML = result.rhythms.slice(0, rhythmLimit).map(rhythm => {
    const s = rhythm.summary;
    const selectedAttacks = s.layerPlays;
    return `<tr>
      <td><b>${esc(rhythm.layers.join(' : '))}</b><small>${esc(rhythm.key)}</small></td>
      <td>${esc(rhythm.role || 'solo')}<small>${rhythm.cardinality}-tone · owns ${rhythm.ownedRatioCount} ratios</small></td>
      <td>${s.compositeOnsets}</td><td>${s.baseSurvivors}</td><td>${s.reflectedAdditions}</td><td>${selectedAttacks}</td>
    </tr>`;
  }).join('') + (result.rhythms.length > rhythmLimit ? `<tr><td colspan="6">${result.rhythms.length - rhythmLimit} additional rhythms remain compiled for playback but are omitted from the DOM readout.</td></tr>` : '');

  const actions = result.events.flatMap(event => event.layerActions.map(action => ({ event, action })));
  const actionLimit = 2500;
  gridEventBody.innerHTML = actions.slice(0, actionLimit).map(({ event, action }) => {
    const otherTones = action.toneGroups.slice(1).map(group => `${group.rawFraction} ×${group.support}`).join(', ');
    const state = action.action === 'repeat-hold' ? badge('REPEATED TONE → HOLD', 'reflection') : badge('PLAY', 'survivor');
    return `<tr class="${action.action === 'repeat-hold' ? 'repeat-hold' : 'survivor'}">
      <td>${event.index}<small>${(event.phase * 100).toFixed(3)}%</small></td>
      <td>${event.tick}</td><td><b>${action.layer}</b></td>
      <td><b>${esc(action.fraction)}</b><small>raw ${esc(action.rawFraction)} · ${action.cents.toFixed(2)}¢ folded</small></td>
      <td>${state}</td>
      <td>${action.support} / ${action.candidateCount}<small>${action.collisionToneCount} distinct tones</small></td>
      <td>${esc(otherTones || '—')}</td>
      <td>${esc(action.rhythmKeys.join(', '))}</td>
    </tr>`;
  }).join('') + (actions.length > actionLimit ? `<tr><td colspan="8">${actions.length - actionLimit} additional canonical actions remain compiled for playback but are omitted from the DOM readout.</td></tr>` : '');
}

function updateUrl(result) {
  const selected = result.ratioCatalog.filter(note => note.selected).map(note => note.fraction);
  const notes = selected.length === result.ratioCatalog.length ? '*' : selected.join(',');
  const params = new URLSearchParams({
    mode: currentMode,
    rhythm: input.value.trim(),
    grid: String(gridInput.value),
    reflect: reflectionToggle.checked ? '1' : '0',
    repeat: repeatCullToggle.checked ? '1' : '0',
    notes,
  });
  history.replaceState(null, '', `?${params}`);
}

async function render() {
  const requestId = ++renderRequest;
  if (activeGridWorker) { activeGridWorker.terminate(); activeGridWorker = null; }
  const snapshot = currentSnapshot();
  try {
    if (snapshot.mode === 'grid') error.textContent = `Building grid ${snapshot.grid} off the audio/UI thread…`;
    const requestedSignature = snapshot.mode === 'grid' && Number.isSafeInteger(Number(snapshot.grid))
      ? `grid:${Number(snapshot.grid)}`
      : snapshot.mode === 'rhythm'
        ? `rhythm:${normalizeLayers(parseRhythmInput(snapshot.rhythm)).join('.')}`
        : null;
    const canReuseSelection = requestedSignature != null && requestedSignature === currentSignature;
    const firstSelection = canReuseSelection ? selectedFractions : null;
    let result = await buildProgram(snapshot, firstSelection, requestId);
    if (requestId !== renderRequest) return;
    const nextSignature = programSignature(result);
    if (nextSignature !== currentSignature) {
      if (currentSignature) selectionsBySignature.set(currentSignature, new Set(selectedFractions));
      currentSignature = nextSignature;
      const available = new Set(result.ratioCatalog.map(note => note.fraction));
      const saved = selectionsBySignature.get(nextSignature);
      selectedFractions = saved
        ? new Set([...saved].filter(fraction => available.has(fraction)))
        : initialNotes == null
          ? new Set(available)
          : new Set([...initialNotes].filter(fraction => available.has(fraction)));
      initialNotes = null;
      const allSelected = selectedFractions.size === result.ratioCatalog.length && result.ratioCatalog.every(note => selectedFractions.has(note.fraction));
      if (!allSelected) {
        result = await buildProgram(snapshot, selectedFractions, requestId);
        if (requestId !== renderRequest) return;
      }
    }
    latestProgram = result;
    player.setProgram(result);
    error.textContent = '';
    renderSummary(result);
    renderScaleSelector(result);
    renderTape(result);
    if (currentMode === 'grid') renderGridReadouts(result);
    else { renderSegments(result); renderEvents(result); }
    updateUrl(result);
  } catch (err) {
    if (requestId !== renderRequest || err.message === 'Stale grid solve.') return;
    error.textContent = err.message;
  }
}

let debounce = null;
const debouncedRender = () => { clearTimeout(debounce); debounce = setTimeout(render, 120); };
input.addEventListener('input', debouncedRender);
gridInput.addEventListener('input', debouncedRender);
input.addEventListener('keydown', event => { if (event.key === 'Enter') render(); });
gridInput.addEventListener('keydown', event => { if (event.key === 'Enter') render(); });
reflectionToggle.addEventListener('change', render);
repeatCullToggle.addEventListener('change', render);
$('run').addEventListener('click', render);
$('run-grid').addEventListener('click', render);
$('rhythm-tab').addEventListener('click', () => setMode('rhythm'));
$('grid-tab').addEventListener('click', () => setMode('grid'));
scaleNotes.addEventListener('click', event => {
  const button = event.target.closest('button[data-fraction]');
  if (!button) return;
  const fraction = button.dataset.fraction;
  if (selectedFractions.has(fraction)) selectedFractions.delete(fraction);
  else selectedFractions.add(fraction);
  render();
});
$('select-all').addEventListener('click', () => {
  selectedFractions = new Set((latestProgram?.ratioCatalog || []).map(note => note.fraction));
  render();
});
$('select-none').addEventListener('click', () => { selectedFractions.clear(); render(); });
audioPlay.addEventListener('click', () => player.toggle());
$('audio-rate').addEventListener('input', event => {
  const ticksPerSecond = Number(event.target.value);
  $('audio-rate-value').textContent = `${ticksPerSecond} ticks/s`;
  player.setTickRate(ticksPerSecond);
});
$('audio-root').addEventListener('input', event => player.setRootHz(event.target.value));
$('audio-wave').addEventListener('change', event => player.setWaveform(event.target.value));
$('audio-level').addEventListener('input', event => player.setLevel(event.target.value));
window.addEventListener('pagehide', () => {
  if (activeGridWorker) activeGridWorker.terminate();
  player.stop();
});

const params = new URLSearchParams(location.search);
if (params.get('rhythm')) input.value = params.get('rhythm');
if (params.get('grid')) gridInput.value = params.get('grid');
if (params.has('reflect')) reflectionToggle.checked = params.get('reflect') !== '0';
if (params.has('repeat')) repeatCullToggle.checked = params.get('repeat') !== '0';
if (params.has('notes') && params.get('notes') !== '*') initialNotes = new Set(params.get('notes').split(',').filter(Boolean));
setMode(params.get('mode') === 'grid' ? 'grid' : 'rhythm', false);
render();
