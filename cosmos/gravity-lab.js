import { DEFAULT_GRAVITY_OPTIONS, GravitySimulation } from './gravity-core.js';
import { divisorsFast } from './grid-core.js';
import { approximateStarSize } from './cosmos/web-travel-bloom.js';
import { hilbertDecode, hilbertEncode, SIDE } from './cosmos/hilbert.js';
import { backboneHash, CELL, setPlacement, slotDirection } from './cosmos/spine.js';

setPlacement('hilbert');

const $ = selector => document.querySelector(selector);
const canvas = $('#view'), context = canvas.getContext('2d', { alpha: false });
const status = $('#status'), gravityButton = $('#gravity-button');
const centreGridInput = $('#centre-grid'), radiusInput = $('#radius');
const tickRateInput = $('#tick-rate'), sessionAgeInput = $('#session-age'), cameraScaleInput = $('#camera-scale');
const optionInputs = [...document.querySelectorAll('[data-option]')];
const slideInputs = [...document.querySelectorAll('[data-slide]')];
const angularVector = [0, 0, 0];
const simulation = new GravitySimulation({ capacity: 1024 });

let bodies = [];
let attractorFlags = new Uint8Array(simulation.capacity);
let holdingKeyboard = false, holdingButton = false;
let transportTick = 0;
let lastFrame = performance.now();
let cameraYaw = -0.72, cameraPitch = 0.5, cameraScale = Number(cameraScaleInput.value);
let drag = null;
let stepTotal = 0, stepWorst = 0, stepSamples = 0;
let frameNumber = 0;

function factorDivisorCount(grid) {
  return divisorsFast(Math.max(1, grid)).length;
}

function makeNeighbourhood(centerGrid, radius) {
  const centerCell = hilbertDecode(centerGrid);
  const nextBodies = [];
  for (let dx = -radius; dx <= radius; dx++) {
    const x = centerCell[0] + dx;
    if (x < 0 || x >= SIDE) continue;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = centerCell[1] + dy;
      if (y < 0 || y >= SIDE) continue;
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        const z = centerCell[2] + dz;
        if (z < 0 || z >= SIDE) continue;
        const grid = hilbertEncode(x, y, z);
        const hash = backboneHash(grid);
        nextBodies.push({
          id: grid,
          grid,
          rest: [dx * CELL + hash[0], dy * CELL + hash[1], dz * CELL + hash[2]],
          size: approximateStarSize(factorDivisorCount(grid)),
          spinAxis: slotDirection(grid),
          cycleTicks: Math.max(1, grid),
          pinned: false,
        });
      }
    }
  }
  return nextBodies;
}

function numericInput(input) {
  return input.type === 'range' || input.type === 'number' ? Number(input.value) : input.value;
}

function optionsFromControls() {
  const options = {};
  for (const input of optionInputs) options[input.dataset.option] = numericInput(input);
  let innerCells = Number($('#inner-window').value);
  let outerCells = Number($('#outer-window').value);
  if (outerCells <= innerCells) {
    outerCells = Math.min(8, innerCells + 0.1);
    $('#outer-window').value = String(outerCells);
  }
  options.windowInner = innerCells * CELL;
  options.windowOuter = outerCells * CELL;
  return options;
}

function formatControl(name, value) {
  if (name === 'strengthCeiling') return Math.round(value).toLocaleString();
  if (name === 'rampTime' || name === 'spinUpTime' || name === 'springTime') return `${Number(value).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')} s`;
  if (name === 'softening') return `${Math.round(value)} u`;
  if (name === 'pointerBlend' || name === 'massExponent') return Number(value).toFixed(2);
  return String(value);
}

function refreshControlLabels() {
  for (const output of document.querySelectorAll('[data-for]')) {
    const input = document.querySelector(`[data-option="${output.dataset.for}"]`);
    output.value = formatControl(output.dataset.for, input.value);
  }
  $('#inner-window-value').value = `${Number($('#inner-window').value).toFixed(1)} · ${Math.round(Number($('#inner-window').value) * CELL)} u`;
  $('#outer-window-value').value = `${Number($('#outer-window').value).toFixed(1)} · ${Math.round(Number($('#outer-window').value) * CELL)} u`;
  for (const input of slideInputs) document.querySelector(`[data-slide-for="${input.dataset.slide}"]`).value = Number(input.value).toFixed(1);
}

function updateAttractorFlags() {
  attractorFlags.fill(0);
  for (let i = 0; i < simulation._attractorCount; i++) {
    const index = simulation._attractors[i];
    if (index >= 0) attractorFlags[index] = 1;
  }
}

function applyOptions() {
  simulation.configure(optionsFromControls());
  updateAttractorFlags();
  refreshControlLabels();
}

function resetMotion() {
  simulation.reset();
  transportTick = Math.max(0, Number(sessionAgeInput.value) || 0) * Math.max(0, Number(tickRateInput.value) || 0);
  stepTotal = 0; stepWorst = 0; stepSamples = 0;
}

function buildNeighbourhood() {
  const centerGrid = Math.max(1, Math.min(SIDE ** 3 - 1, Math.round(Number(centreGridInput.value) || 1)));
  const radius = Math.max(2, Math.min(6, Math.round(Number(radiusInput.value) || 5)));
  centreGridInput.value = String(centerGrid);
  radiusInput.value = String(radius);
  bodies = makeNeighbourhood(centerGrid, radius);
  simulation.reset();
  simulation.setBodies(bodies);
  applyOptions();
  resetMotion();
  $('#body-count').textContent = `${bodies.length} · ${simulation._attractorCount} pull`;
}

function bubbleCenter() {
  const values = { x: 0, y: 0, z: 0 };
  for (const input of slideInputs) values[input.dataset.slide] = Number(input.value) * CELL;
  return [values.x, values.y, values.z];
}

function isHolding() {
  return holdingKeyboard || holdingButton;
}

function setHoldAppearance() {
  const held = isHolding();
  gravityButton.classList.toggle('active', held);
  status.classList.toggle('live', held);
  status.textContent = held ? `gravity ${Math.round(simulation.stats.activation * 100)}%` : simulation.stats.activation > 0.001 ? 'returning to stasis' : 'gravity idle';
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function rotatePoint(x, y, z) {
  const cy = Math.cos(cameraYaw), sy = Math.sin(cameraYaw);
  const cp = Math.cos(cameraPitch), sp = Math.sin(cameraPitch);
  const yawX = cy * x - sy * z;
  const yawZ = sy * x + cy * z;
  return [yawX, cp * y - sp * yawZ, sp * y + cp * yawZ];
}

function render() {
  const { width, height } = resizeCanvas();
  const centerX = width * 0.5, centerY = height * 0.49;
  context.fillStyle = '#080811';
  context.fillRect(0, 0, width, height);

  const center = bubbleCenter();
  const screenScale = cameraScale * Math.min(width, height) / (CELL * 4.5);
  const projected = new Array(simulation.count);
  for (let i = 0; i < simulation.count; i++) {
    const base = i * 3;
    const rest = rotatePoint(simulation.restPositions[base], simulation.restPositions[base + 1], simulation.restPositions[base + 2]);
    const moved = rotatePoint(
      simulation.restPositions[base] + simulation.offsets[base],
      simulation.restPositions[base + 1] + simulation.offsets[base + 1],
      simulation.restPositions[base + 2] + simulation.offsets[base + 2],
    );
    projected[i] = {
      i,
      rx: centerX + rest[0] * screenScale,
      ry: centerY - rest[1] * screenScale,
      x: centerX + moved[0] * screenScale,
      y: centerY - moved[1] * screenScale,
      z: moved[2],
    };
  }

  const bubble = rotatePoint(center[0], center[1], center[2]);
  const inner = simulation.options.windowInner * screenScale;
  const outer = simulation.options.windowOuter * screenScale;
  context.save();
  context.translate(centerX + bubble[0] * screenScale, centerY - bubble[1] * screenScale);
  context.strokeStyle = 'rgba(114,245,236,.12)'; context.lineWidth = 1;
  context.beginPath(); context.arc(0, 0, outer, 0, Math.PI * 2); context.stroke();
  context.setLineDash([4, 8]); context.strokeStyle = 'rgba(167,124,255,.13)';
  context.beginPath(); context.arc(0, 0, inner, 0, Math.PI * 2); context.stroke();
  context.restore();

  context.lineWidth = 1;
  for (const point of projected) {
    const dx = point.x - point.rx, dy = point.y - point.ry;
    if (dx * dx + dy * dy > 1) {
      context.strokeStyle = 'rgba(167,124,255,.12)';
      context.beginPath(); context.moveTo(point.rx, point.ry); context.lineTo(point.x, point.y); context.stroke();
    }
    context.strokeStyle = 'rgba(132,125,157,.28)';
    context.beginPath(); context.arc(point.rx, point.ry, 1.5, 0, Math.PI * 2); context.stroke();
  }

  projected.sort((a, b) => a.z - b.z);
  for (const point of projected) {
    const index = point.i;
    const mass = simulation.masses[index];
    const radius = Math.max(1.3, Math.min(8, 1.3 + Math.sqrt(mass) * 0.95));
    const beyond = simulation._windowWeights[index] <= 0;
    context.fillStyle = beyond ? 'rgba(255,113,150,.48)' : attractorFlags[index] ? '#ffd36d' : 'rgba(114,245,236,.82)';
    if (attractorFlags[index]) {
      context.shadowColor = 'rgba(255,211,109,.72)';
      context.shadowBlur = 9;
    }
    context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill();
    context.shadowBlur = 0;
  }
}

function updateReadouts() {
  const mean = stepSamples ? stepTotal / stepSamples : 0;
  $('#step-time').textContent = `${mean.toFixed(3)} / ${stepWorst.toFixed(3)} ms`;
  $('#largest-offset').textContent = `${simulation.stats.largestOffset.toFixed(2)} u`;
  $('#clamps').textContent = String(simulation.stats.clampEngagements);
  $('#clamp-metric').classList.toggle('alert', simulation.stats.clampEngagements > 0);
  $('#beyond').textContent = `${simulation.stats.bodiesBeyondWindow} / ${simulation.count}`;
  simulation.angularMomentum(angularVector);
  $('#angular').textContent = Math.hypot(...angularVector).toExponential(3);
  $('#coupling').textContent = `${Math.round(simulation.stats.activation * 100)}% · ${Math.round(simulation.stats.strength).toLocaleString()}`;
  setHoldAppearance();
}

function animate(now) {
  const frameTime = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const tickRate = Math.max(0, Number(tickRateInput.value) || 0);
  const stepsBefore = simulation.stats.steps;
  const start = performance.now();
  simulation.advance(frameTime, { held: isHolding(), center: bubbleCenter(), tick: transportTick, ticksPerSecond: tickRate });
  const duration = performance.now() - start;
  const performedSteps = simulation.stats.steps - stepsBefore;
  if (performedSteps > 0) {
    const perStep = duration / performedSteps;
    stepTotal += perStep * performedSteps; stepWorst = Math.max(stepWorst, perStep); stepSamples += performedSteps;
    transportTick += frameTime * tickRate;
  }
  render();
  if (++frameNumber % 6 === 0) updateReadouts();
  requestAnimationFrame(animate);
}

function resetControls() {
  const controlDefaults = {
    strengthCeiling: DEFAULT_GRAVITY_OPTIONS.strengthCeiling,
    rampTime: DEFAULT_GRAVITY_OPTIONS.rampTime,
    spinUpTime: DEFAULT_GRAVITY_OPTIONS.spinUpTime,
    softening: DEFAULT_GRAVITY_OPTIONS.softening,
    massExponent: DEFAULT_GRAVITY_OPTIONS.massExponent,
    attractorCount: DEFAULT_GRAVITY_OPTIONS.attractorCount,
    pointerBlend: DEFAULT_GRAVITY_OPTIONS.pointerBlend,
    axisMode: DEFAULT_GRAVITY_OPTIONS.axisMode,
    springTime: DEFAULT_GRAVITY_OPTIONS.springTime,
  };
  for (const input of optionInputs) input.value = String(controlDefaults[input.dataset.option]);
  $('#inner-window').value = String(DEFAULT_GRAVITY_OPTIONS.windowInner / CELL);
  $('#outer-window').value = String(DEFAULT_GRAVITY_OPTIONS.windowOuter / CELL);
  for (const input of slideInputs) input.value = '0';
  applyOptions();
}

function exportConstants() {
  const exportable = { ...simulation.options, sharedSpinAxis: [...simulation.options.sharedSpinAxis] };
  const output = $('#export-output');
  output.textContent = JSON.stringify(exportable, null, 2);
  output.style.display = 'block';
  navigator.clipboard?.writeText(output.textContent).catch(() => {});
}

for (const input of optionInputs) input.addEventListener('input', applyOptions);
for (const id of ['inner-window', 'outer-window']) $(`#${id}`).addEventListener('input', applyOptions);
for (const input of slideInputs) input.addEventListener('input', refreshControlLabels);
cameraScaleInput.addEventListener('input', () => { cameraScale = Number(cameraScaleInput.value) || 0.28; });
$('#rebuild').addEventListener('click', buildNeighbourhood);
$('#reset').addEventListener('click', resetMotion);
$('#reset-controls').addEventListener('click', resetControls);
$('#export').addEventListener('click', exportConstants);

window.addEventListener('keydown', event => {
  if (event.code !== 'KeyG' || event.repeat || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  event.preventDefault(); holdingKeyboard = true; setHoldAppearance();
});
window.addEventListener('keyup', event => {
  if (event.code !== 'KeyG') return;
  event.preventDefault(); holdingKeyboard = false; setHoldAppearance();
});
window.addEventListener('blur', () => { holdingKeyboard = false; holdingButton = false; setHoldAppearance(); });
gravityButton.addEventListener('pointerdown', event => {
  event.preventDefault(); gravityButton.setPointerCapture(event.pointerId); holdingButton = true; setHoldAppearance();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) gravityButton.addEventListener(type, () => { holdingButton = false; setHoldAppearance(); });

canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  drag = { x: event.clientX, y: event.clientY, yaw: cameraYaw, pitch: cameraPitch };
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  cameraYaw = drag.yaw + (event.clientX - drag.x) * 0.008;
  cameraPitch = Math.max(-1.45, Math.min(1.45, drag.pitch + (event.clientY - drag.y) * 0.008));
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  cameraScale = Math.max(0.05, Math.min(2, cameraScale * Math.exp(-event.deltaY * 0.001)));
  cameraScaleInput.value = cameraScale.toFixed(2);
}, { passive: false });

refreshControlLabels();
buildNeighbourhood();
requestAnimationFrame(animate);
