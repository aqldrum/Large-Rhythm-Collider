import { AnimationGeometry, COLORS, TAU, lerp, clamp } from './AnimationGeometry.js';
import { AnimationControls } from './AnimationControls.js';
import { AnimationPlayback } from './AnimationPlayback.js';
import { ScaleAnimation } from './ScaleAnimation.js';
import { FinalSlide } from './FinalSlide.js';

const LAYER_COLORS = [COLORS.layerA, COLORS.layerB, COLORS.layerC, COLORS.layerD];
const LAYER_NAMES = ['A', 'B', 'C', 'D'];
const CURSOR_PATH_D = 'M 14.78125 5 C 14.75 5.007813 14.71875 5.019531 14.6875 5.03125 C 14.644531 5.050781 14.601563 5.070313 14.5625 5.09375 C 14.550781 5.09375 14.542969 5.09375 14.53125 5.09375 C 14.511719 5.101563 14.488281 5.113281 14.46875 5.125 C 14.457031 5.136719 14.449219 5.144531 14.4375 5.15625 C 14.425781 5.167969 14.417969 5.175781 14.40625 5.1875 C 14.375 5.207031 14.34375 5.226563 14.3125 5.25 C 14.289063 5.269531 14.269531 5.289063 14.25 5.3125 C 14.238281 5.332031 14.226563 5.355469 14.21875 5.375 C 14.183594 5.414063 14.152344 5.457031 14.125 5.5 C 14.113281 5.511719 14.105469 5.519531 14.09375 5.53125 C 14.09375 5.542969 14.09375 5.550781 14.09375 5.5625 C 14.082031 5.582031 14.070313 5.605469 14.0625 5.625 C 14.050781 5.636719 14.042969 5.644531 14.03125 5.65625 C 14.03125 5.675781 14.03125 5.699219 14.03125 5.71875 C 14.019531 5.757813 14.007813 5.800781 14 5.84375 C 14 5.875 14 5.90625 14 5.9375 C 14 5.949219 14 5.957031 14 5.96875 C 14 5.980469 14 5.988281 14 6 C 13.996094 6.050781 13.996094 6.105469 14 6.15625 L 14 39 C 14.003906 39.398438 14.242188 39.757813 14.609375 39.914063 C 14.972656 40.070313 15.398438 39.992188 15.6875 39.71875 L 22.9375 32.90625 L 28.78125 46.40625 C 28.890625 46.652344 29.09375 46.847656 29.347656 46.941406 C 29.601563 47.035156 29.882813 47.023438 30.125 46.90625 L 34.5 44.90625 C 34.996094 44.679688 35.21875 44.09375 35 43.59375 L 28.90625 30.28125 L 39.09375 29.40625 C 39.496094 29.378906 39.84375 29.113281 39.976563 28.730469 C 40.105469 28.347656 39.992188 27.921875 39.6875 27.65625 L 15.84375 5.4375 C 15.796875 5.378906 15.746094 5.328125 15.6875 5.28125 C 15.648438 5.234375 15.609375 5.195313 15.5625 5.15625 C 15.550781 5.15625 15.542969 5.15625 15.53125 5.15625 C 15.511719 5.132813 15.492188 5.113281 15.46875 5.09375 C 15.457031 5.09375 15.449219 5.09375 15.4375 5.09375 C 15.386719 5.070313 15.335938 5.046875 15.28125 5.03125 C 15.269531 5.03125 15.261719 5.03125 15.25 5.03125 C 15.230469 5.019531 15.207031 5.007813 15.1875 5 C 15.175781 5 15.167969 5 15.15625 5 C 15.136719 5 15.113281 5 15.09375 5 C 15.082031 5 15.074219 5 15.0625 5 C 15.042969 5 15.019531 5 15 5 C 14.988281 5 14.980469 5 14.96875 5 C 14.9375 5 14.90625 5 14.875 5 C 14.84375 5 14.8125 5 14.78125 5 Z M 16 8.28125 L 36.6875 27.59375 L 27.3125 28.40625 C 26.992188 28.4375 26.707031 28.621094 26.546875 28.902344 C 26.382813 29.179688 26.367188 29.519531 26.5 29.8125 L 32.78125 43.5 L 30.21875 44.65625 L 24.21875 30.8125 C 24.089844 30.515625 23.828125 30.296875 23.511719 30.230469 C 23.195313 30.160156 22.863281 30.25 22.625 30.46875 L 16 36.6875 Z';
const CURSOR_VIEWBOX = {
  height: 50
};

function easeInOutCubic(t) {
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 6 ? normalized : normalized.slice(0, 6);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function blendHex(a, b, t) {
  const c1 = hexToRgb(a);
  const c2 = hexToRgb(b);
  const r = Math.round(lerp(c1.r, c2.r, t));
  const g = Math.round(lerp(c1.g, c2.g, t));
  const bVal = Math.round(lerp(c1.b, c2.b, t));
  return `rgb(${r}, ${g}, ${bVal})`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}

function lcm(a, b) {
  return (a * b) / gcd(a, b);
}

function lcmAll(values) {
  return values.reduce((acc, val) => lcm(acc, val), 1);
}

class AnimationSequence {
  constructor(canvas, { statusEl, layerRows }) {
    this.canvas = canvas;
    this.stageEl = canvas.parentElement;
    this.statusEl = statusEl;
    this.layerRows = layerRows;

    this.geometry = new AnimationGeometry(canvas);
    this.marks = [];
    this.layerSegments = new Map();
    this.boundaries = [];
    this.segments = [];
    this.segmentRows = [];
    this.spacesPlotValues = [];
    this.maxDenominator = 1;
    this.fundamentalValue = 1;
    this.scaleRatios = [];
    this.spacesMapping = new Map();
    this.scaleRatioIndex = new Map();
    this.showWaves = true;
    this.playbackRows = [];
    this.scaleAnimation = new ScaleAnimation();
    this.finalSlide = new FinalSlide(this);

    this.animationFrame = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.sequenceStart = 0;
    this.pauseStarted = 0;
    this.pausedDuration = 0;
    this.lastElapsed = 0;
    this.totalDuration = 0;
    this.layout = null;
    this.lastLayers = null;
    this.unrollView = null;
    this.octaveStart = 0;
    this.octaveEnd = 0;
    this.showOctaveCollapse = false;
    this.tableStart = 0;
    this.tableEnd = 0;
    this.tableMoveStart = 0;
    this.tableMoveEnd = 0;
    this.numberPhaseScale = 1;
    this.polyrhythmTitle = '';
    this.gridValue = 0;
    this.gridSubtitleStart = 0;
    this.gridStart = 0;
    this.gridEnd = 0;
    this.groupingDemoEntries = [];
    this.groupingDemoStart = 0;
    this.groupingDemoEnd = 0;
    this.groupingIntroDuration = 0;
    this.groupingStepDuration = 0;
    this.resizeRaf = null;
    this.resizeObserver = null;
    this.pointer = {
      x: 0,
      y: 0,
      inside: false,
      visible: false
    };
    this.pointerPath = typeof Path2D !== 'undefined'
      ? new Path2D(CURSOR_PATH_D)
      : null;

    this.handleResize = this.handleResize.bind(this);
    this.scheduleResize = this.scheduleResize.bind(this);
    this.tick = this.tick.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerEnter = this.handlePointerEnter.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);

    window.addEventListener('resize', this.scheduleResize);
    this.canvas.style.cursor = 'none';
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerenter', this.handlePointerEnter);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    if (typeof ResizeObserver !== 'undefined' && this.stageEl) {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleResize();
      });
      this.resizeObserver.observe(this.stageEl);
    }
    this.handleResize();
    this.renderIdle();
  }

  handlePointerMove(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const rect = this.canvas.getBoundingClientRect();
    const width = this.layout?.width ?? rect.width;
    const height = this.layout?.height ?? rect.height;
    this.pointer.x = clamp(event.clientX - rect.left, 0, Math.max(1, width));
    this.pointer.y = clamp(event.clientY - rect.top, 0, Math.max(1, height));
    this.pointer.inside = true;
    this.pointer.visible = true;

    if (!this.isPlaying) {
      this.renderIdle();
    }
  }

  handlePointerEnter(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    this.handlePointerMove(event);
  }

  handlePointerLeave(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    this.pointer.inside = false;
    this.pointer.visible = false;
    if (!this.isPlaying) {
      this.renderIdle();
    }
  }

  drawPointerOverlay() {
    if (!this.pointer.visible || !this.pointer.inside) return;
    if (!this.layout) return;
    const { x, y } = this.pointer;
    const size = clamp(Math.min(this.layout.width, this.layout.height) * 0.024, 13, 20);
    const ctx = this.geometry.ctx;
    const scale = size / CURSOR_VIEWBOX.height;

    if (this.pointerPath) {
      ctx.save();
      ctx.translate(x - scale * 14, y - scale * 6);
      ctx.scale(scale, scale);

      ctx.save();
      ctx.translate(1.2, 1.4);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fill(this.pointerPath);
      ctx.restore();

      ctx.fillStyle = '#000000';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.miterLimit = 2;
      ctx.fill(this.pointerPath);
      ctx.stroke(this.pointerPath);
      ctx.restore();
      return;
    }

    const drawShape = (offsetX = 0, offsetY = 0) => {
      const px = x + offsetX;
      const py = y + offsetY;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + size);
      ctx.lineTo(px + size * 0.3, py + size * 0.72);
      ctx.lineTo(px + size * 0.52, py + size * 1.28);
      ctx.lineTo(px + size * 0.72, py + size * 1.2);
      ctx.lineTo(px + size * 0.48, py + size * 0.66);
      ctx.lineTo(px + size * 0.94, py + size * 0.66);
      ctx.closePath();
    };

    ctx.save();
    ctx.globalAlpha = 0.35;
    drawShape(2, 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawShape(0, 0);
    ctx.fillStyle = '#0a0a0a';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, size * 0.09);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.miterLimit = 4;
    ctx.stroke();
    ctx.restore();
  }

  scheduleResize() {
    if (this.resizeRaf) {
      cancelAnimationFrame(this.resizeRaf);
    }
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = null;
      this.handleResize();
    });
  }

  handleResize() {
    const source = this.stageEl || this.canvas;
    const rect = source.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const needsResize = !this.layout
      || this.layout.width !== width
      || this.layout.height !== height
      || Math.abs((this.geometry.dpr || 1) - dpr) > 0.001;
    if (!needsResize) return;

    this.geometry.resize(width, height);
    this.layout = this.computeLayout(width, height);
    // Cached view translation/scale is screen-size dependent.
    // Reset it so it is recomputed for the current canvas dimensions.
    this.unrollView = null;
    if (this.isPlaying) {
      this.render(this.lastElapsed);
    } else {
      this.renderIdle();
    }
  }

  computeLayout(width, height) {
    const radius = Math.min(width, height) * 0.28;
    const center = { x: width * 0.5, y: height * 0.5 };
    const anchorStart = { x: center.x, y: center.y - radius };
    const anchorEnd = { x: width * 0.12, y: height * 0.75 };
    const lineLength = TAU * radius;
    const markLength = Math.max(10, radius * 0.08);
    const lineWidth = Math.max(2, radius * 0.012);

    const fontSize = Math.max(11, Math.min(18, Math.round(Math.min(width, height) * 0.018)));

    return {
      width,
      height,
      radius,
      center,
      anchorStart,
      anchorEnd,
      lineLength,
      markLength,
      lineWidth,
      fontSize
    };
  }

  setStatus(text) {
    if (this.statusEl) {
      this.statusEl.textContent = text;
    }
  }

  setActiveLayer(layerIndex) {
    if (!this.layerRows) return;
    this.layerRows.forEach((row) => row.classList.remove('is-active'));
    if (layerIndex === null || layerIndex === undefined) return;
    const row = this.layerRows[layerIndex];
    if (row) row.classList.add('is-active');
  }

  reset() {
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseStarted = 0;
    this.pausedDuration = 0;
    this.lastElapsed = 0;
    this.unrollView = null;
    this.showOctaveCollapse = false;
    this.tableStart = 0;
    this.tableEnd = 0;
    this.tableMoveStart = 0;
    this.tableMoveEnd = 0;
    this.numberPhaseScale = 1;
    this.polyrhythmTitle = '';
    this.gridValue = 0;
    this.gridSubtitleStart = 0;
    this.gridStart = 0;
    this.gridEnd = 0;
    this.groupingDemoEntries = [];
    this.groupingDemoStart = 0;
    this.groupingDemoEnd = 0;
    this.groupingIntroDuration = 0;
    this.groupingStepDuration = 0;
    if (this.finalSlide.isActive()) {
      this.finalSlide.stop();
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.setActiveLayer(null);
    this.setStatus('Enter a rhythm to begin the sequence.');
    this.renderIdle();
  }

  renderIdle() {
    const { center, radius, lineWidth } = this.layout;
    this.geometry.clear();
    this.geometry.drawCircle(center, radius, COLORS.white, lineWidth);
    this.drawPointerOverlay();
  }

  formatPolyrhythmTitle(layers) {
    if (!Array.isArray(layers)) return '';
    const parts = layers
      .map((value) => {
        const parsed = Number.isFinite(value) ? Math.floor(value) : parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      })
      .filter((value) => value > 1);
    return parts.join(' : ');
  }

  start(rawLayers) {
    const layers = rawLayers.map((value) => {
      const parsed = Number.isFinite(value) ? Math.floor(value) : parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    });

    const activeLayers = layers
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value > 1);

    if (activeLayers.length === 0) {
      this.setStatus('Enter at least one layer value greater than 1.');
      this.renderIdle();
      return;
    }

    if (this.finalSlide.isActive()) {
      this.finalSlide.stop();
    }
    this.setStatus('Animating serialization sequence...');
    this.isPlaying = true;
    this.isPaused = false;
    this.pauseStarted = 0;
    this.pausedDuration = 0;
    this.lastElapsed = 0;
    this.unrollView = null;
    this.showOctaveCollapse = false;
    this.tableStart = 0;
    this.tableEnd = 0;
    this.tableMoveStart = 0;
    this.tableMoveEnd = 0;
    this.numberPhaseScale = 1;
    this.polyrhythmTitle = this.formatPolyrhythmTitle(layers);
    this.groupingDemoEntries = [];
    this.groupingDemoStart = 0;
    this.groupingDemoEnd = 0;
    this.groupingIntroDuration = 0;
    this.groupingStepDuration = 0;
    this.sequenceStart = performance.now();
    this.lastLayers = [...layers];

    this.buildMarks(layers);
    this.buildTimeline(activeLayers);
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    this.pauseStarted = performance.now();
    this.setStatus('Paused — press P to resume.');
  }

  resume() {
    if (!this.isPaused) return;
    const now = performance.now();
    this.isPaused = false;
    this.pausedDuration += now - this.pauseStarted;
    this.pauseStarted = 0;
    this.setStatus('Animating serialization sequence...');
  }

  toggleWaves() {
    this.showWaves = !this.showWaves;
    if (this.isPaused) {
      this.render(this.lastElapsed);
    }
  }

  isAtPhase8() {
    return this.isPlaying && this.lastElapsed >= (this.tableMoveEnd || 0) - 0.01;
  }

  toggleFinalSlidePlayback() {
    this.finalSlide.toggle();
    if (this.finalSlide.isActive()) {
      this.setStatus('Tone row playback — press P to stop.');
    } else {
      this.setStatus('Phase 8 — press P to play tone row.');
    }
  }

  isStrumReady() {
    const afterWave = this.lastElapsed >= (this.waveEnd || 0) - 0.01;
    return this.isPaused && afterWave;
  }

  getPlaybackRows() {
    return this.playbackRows || [];
  }

  jumpToPhase(phaseIndex, layers) {
    const target = this.getPhaseTime(phaseIndex);
    if (target === null) return;

    if (this.finalSlide.isActive()) this.finalSlide.stop();

    const hasActiveLayers = Array.isArray(layers) && layers.some((value) => value > 1);
    const shouldRestart = !this.isPlaying || (hasActiveLayers && !this.layersMatch(layers, this.lastLayers));
    if (shouldRestart) {
      this.start(hasActiveLayers ? layers : this.lastLayers || []);
    }
    if (!this.isPlaying) return;

    const now = performance.now();
    this.sequenceStart = now - target * 1000 - this.pausedDuration;
    this.lastElapsed = target;
    this.isPaused = true;
    this.pauseStarted = now;
    this.showOctaveCollapse = phaseIndex >= 7;

    if (phaseIndex === 8) {
      this.setStatus('Phase 8 — press P to play tone row.');
    } else {
      this.setStatus(`Phase ${phaseIndex} — press P to resume.`);
    }
    this.render(target);
  }

  getPhaseTime(phaseIndex) {
    if (!this.layerSegments.size) return null;
    switch (phaseIndex) {
      case 1:
        return 0;
      case 2:
        return this.pauseStart ?? 0;
      case 3:
        return this.gridEnd ?? this.unrollEnd ?? this.totalDuration ?? 0;
      case 4:
        return this.organizeEnd ?? this.totalDuration ?? 0;
      case 5:
        return this.waveEnd ?? this.totalDuration ?? 0;
      case 6:
        return this.ratioEnd ?? this.totalDuration ?? 0;
      case 7:
        return this.octaveEnd ?? this.ratioEnd ?? this.totalDuration ?? 0;
      case 8:
        return this.tableMoveEnd ?? this.octaveEnd ?? this.totalDuration ?? 0;
      default:
        return null;
    }
  }

  layersMatch(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  buildMarks(layers) {
    const { lineLength } = this.layout;
    const marks = [];

    layers.forEach((value, layerIndex) => {
      if (value <= 1) return;
      const count = value;
      for (let i = 0; i < count; i += 1) {
        const angle = (i / count) * TAU;
        const arc = (angle / TAU) * lineLength;
        marks.push({
          layerIndex,
          order: i,
          angle,
          arc,
          color: LAYER_COLORS[layerIndex],
          isOrigin: i === 0
        });
      }
    });

    this.marks = marks;
    this.buildSegments(layers);

    this.marks.forEach((mark) => {
      mark.segmentIndex = this.resolveSegmentIndex(mark.arc);
    });
  }

  getAutoFitView({ center, radius, unrollProgress, markExtent, lineWidth }) {
    const samples = 220;
    const length = TAU * radius;
    const t = clamp(unrollProgress, 0, 1);
    const arcLen = (1 - t) * length;
    const thetaEnd = arcLen / radius;
    const tangent = { x: Math.cos(thetaEnd), y: Math.sin(thetaEnd) };

    const circlePointAt = (theta) => ({
      x: center.x + Math.sin(theta) * radius,
      y: center.y - Math.cos(theta) * radius
    });

    const lineStart = circlePointAt(thetaEnd);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i <= samples; i += 1) {
      const s = (i / samples) * length;
      let x;
      let y;

      if (s <= arcLen) {
        const theta = s / radius;
        const point = circlePointAt(theta);
        x = point.x;
        y = point.y;
      } else {
        const dist = s - arcLen;
        x = lineStart.x + tangent.x * dist;
        y = lineStart.y + tangent.y * dist;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const basePad = Math.max(24, markExtent + lineWidth * 8);
    const extraPad = Math.min(this.layout.width, this.layout.height) * 0.3 * t;
    const pad = basePad + extraPad;
    const boundsW = Math.max(1, maxX - minX + pad * 2);
    const boundsH = Math.max(1, maxY - minY + pad * 2);
    const scale = Math.min(1, (this.layout.width / boundsW), (this.layout.height / boundsH));
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const translate = {
      x: this.layout.width * 0.5 - centerX * scale,
      y: this.layout.height * 0.5 - centerY * scale
    };

    return { scale, translate };
  }

  computeBoundaries(layers) {
    const padded = layers.map((value) => (value > 0 ? value : 1));
    while (padded.length < 4) padded.push(1);

    let rhythm = null;
    let grid = null;

    const lrc = window.lrcModule || (typeof LRCModule !== 'undefined' ? new LRCModule() : null);

    if (lrc) {
      grid = lrc.calculateTotalLCM(...padded);
      const composite = lrc.generateCompositeRhythm(padded);
      rhythm = composite.rhythm;
    }

    if (!grid || !rhythm) {
      grid = lcmAll(padded);
      const positions = new Set();
      padded.forEach((value) => {
        if (value <= 0) return;
        const grouping = grid / value;
        for (let i = 0; i < value; i += 1) {
          positions.add(i * grouping);
        }
      });
      rhythm = Array.from(positions);
    }

    const uniquePositions = Array.from(new Set(rhythm)).sort((a, b) => a - b);
    const { lineLength } = this.layout;

    const boundaries = [0];
    uniquePositions.forEach((pos) => {
      if (pos !== 0) {
        boundaries.push((pos / grid) * lineLength);
      }
    });

    boundaries.push(lineLength);
    return boundaries;
  }

  computeSpacesPlotFromLayers(layers) {
    const activeLayers = layers.filter((value) => value > 0);
    if (!activeLayers.length) return null;

    const grid = lcmAll(activeLayers);
    const positions = new Set();

    layers.forEach((value) => {
      if (value <= 0) return;
      const grouping = grid / value;
      for (let i = 0; i < value; i += 1) {
        positions.add(i * grouping);
      }
    });

    const rhythm = Array.from(positions).sort((a, b) => a - b);
    const spacesPlot = [];
    for (let i = 0; i < rhythm.length - 1; i += 1) {
      spacesPlot.push(rhythm[i + 1] - rhythm[i]);
    }
    spacesPlot.push(grid - rhythm[rhythm.length - 1] + rhythm[0]);

    return { grid, spacesPlot };
  }

  buildSegments(layers) {
    const padded = layers.map((value) => (value > 0 ? value : 1));
    let grid = null;
    let spacesPlot = null;
    let ratios = null;
    let spacesMapping = null;

    if (window.lrcModule && typeof window.lrcModule.generateSpacesPlot === 'function') {
      grid = window.lrcModule.calculateTotalLCM(...padded);
      const composite = window.lrcModule.generateCompositeRhythm(padded);
      const spaces = window.lrcModule.generateSpacesPlot(composite.rhythm, grid, composite.layerMap);
      spacesPlot = spaces.spacesPlot;
      if (typeof window.lrcModule.generateRatiosWithFrequency === 'function') {
        const ratioAnalysis = window.lrcModule.generateRatiosWithFrequency(spacesPlot);
        ratios = ratioAnalysis.ratios || null;
        spacesMapping = ratioAnalysis.spacesMapping || null;
      }
    } else {
      const fallback = this.computeSpacesPlotFromLayers(padded);
      if (fallback) {
        grid = fallback.grid;
        spacesPlot = fallback.spacesPlot;
      }
    }

    if (!spacesPlot || !spacesPlot.length || !grid) {
      this.boundaries = this.computeBoundaries(layers);
      this.segments = [];
      this.segmentRows = [];
      this.spacesPlotValues = [];
      this.maxDenominator = 1;
      this.fundamentalValue = 1;
      this.scaleRatios = [];
      this.spacesMapping = new Map();
      this.scaleRatioIndex = new Map();
      this.gridValue = 0;
      for (let i = 0; i < this.boundaries.length - 1; i += 1) {
        const start = this.boundaries[i];
        const end = this.boundaries[i + 1];
        this.segments.push({
          index: i,
          start,
          end,
          length: end - start,
          value: end - start,
          key: `fallback-${i}`,
          isPrimary: true,
          rowIndex: i
        });
      }
      return;
    }

    this.spacesPlotValues = spacesPlot.slice();
    this.gridValue = grid;
    this.fundamentalValue = Math.max(...spacesPlot);
    this.maxDenominator = 1;
    this.scaleRatios = ratios ? ratios.slice() : [];
    this.spacesMapping = spacesMapping instanceof Map ? spacesMapping : new Map();
    this.scaleRatioIndex = new Map();
    this.scaleRatios.forEach((ratio, idx) => {
      if (ratio?.fraction) {
        this.scaleRatioIndex.set(ratio.fraction, idx);
      }
    });
    if (ratios) {
      ratios.forEach((ratio) => {
        if (!ratio?.fraction) return;
        const parts = ratio.fraction.split('/');
        if (parts.length !== 2) return;
        const denom = parseInt(parts[1], 10);
        if (Number.isFinite(denom)) {
          this.maxDenominator = Math.max(this.maxDenominator, denom);
        }
      });
    }

    const boundaries = [0];
    const { lineLength } = this.layout;
    let cumulative = 0;
    spacesPlot.forEach((space) => {
      cumulative += (space / grid) * lineLength;
      boundaries.push(cumulative);
    });
    boundaries[boundaries.length - 1] = lineLength;
    this.boundaries = boundaries;

    const segments = [];
    const rowsMap = new Map();

    spacesPlot.forEach((space, index) => {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      const length = end - start;
      const key = `space-${space}`;

      if (!rowsMap.has(space)) {
        rowsMap.set(space, {
          value: space,
          length,
          key,
          segments: [],
          primaryIndex: index
        });
      }

      const row = rowsMap.get(space);
      row.segments.push(index);

      segments.push({
        index,
        start,
        end,
        length,
        value: space,
        key,
        isPrimary: row.primaryIndex === index
      });
    });

    const rows = Array.from(rowsMap.values()).sort((a, b) => a.value - b.value);
    rows.forEach((row, idx) => {
      row.rowIndex = idx;
    });

    const rowMap = new Map(rows.map((row) => [row.key, row]));
    segments.forEach((segment) => {
      const row = rowMap.get(segment.key);
      segment.rowIndex = row ? row.rowIndex : 0;
      segment.isPrimary = row ? row.primaryIndex === segment.index : segment.isPrimary;
    });

    this.segments = segments;
    this.segmentRows = rows;
    this.scaleAnimation.setRatios(this.segmentRows, this.fundamentalValue);
  }

  resolveSegmentIndex(arcPosition) {
    const boundaries = this.boundaries;
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      if (arcPosition >= boundaries[i] && arcPosition < boundaries[i + 1]) {
        return i;
      }
    }
    return Math.max(0, boundaries.length - 2);
  }

  buildTimeline(activeLayers) {
    this.layerSegments.clear();
    let cursor = 0;

    activeLayers.forEach(({ value, index }) => {
      const duration = 2;
      const perMark = duration / value;
      this.layerSegments.set(index, {
        start: cursor,
        end: cursor + duration,
        perMark
      });
      cursor += duration;
    });

    const postSlicesStart = cursor;
    const preGridSubtitleBuffer = 1.0;
    const preGroupingBuffer = 1.0;
    this.gridSubtitleStart = postSlicesStart + preGridSubtitleBuffer;
    this.groupingDemoEntries = activeLayers
      .filter(({ value }) => value > 1 && this.gridValue > 0)
      .map(({ index, value }) => ({
        layerIndex: index,
        layerValue: value,
        groupingValue: Math.round(this.gridValue / value),
        color: LAYER_COLORS[index]
      }));
    this.groupingIntroDuration = 0;
    this.groupingStepDuration = 1.2;
    const groupingHoldDuration = 0;
    const groupingDuration = this.groupingIntroDuration
      + this.groupingDemoEntries.length * this.groupingStepDuration
      + groupingHoldDuration;
    this.groupingDemoStart = this.gridSubtitleStart + preGroupingBuffer;
    this.groupingDemoEnd = this.groupingDemoStart + groupingDuration;
    this.pauseStart = this.groupingDemoEnd;
    const pauseDuration = 2;
    this.pauseEnd = this.pauseStart + pauseDuration;
    cursor = this.pauseEnd;

    this.unrollStart = cursor;
    this.unrollEnd = cursor + 4;
    cursor = this.unrollEnd;

    const preSpacesBuffer = 0;
    this.gridStart = this.unrollEnd + preSpacesBuffer;
    this.gridEnd = this.gridStart + 1.0 + this.segments.length * 0.25;
    cursor = this.gridEnd;

    this.organizeStart = cursor;
    this.organizeEnd = cursor + 4.6;
    cursor = this.organizeEnd;

    this.waveStart = cursor;
    this.waveEnd = cursor + 3;
    cursor = this.waveEnd;

    const rowCount = this.segmentRows?.length || 0;
    const octaveGroupCount = this.scaleAnimation.octaveGroups?.length || 0;
    const adaptiveScale = 1
      + Math.max(0, rowCount - 8) * 0.04
      + octaveGroupCount * 0.03;
    this.numberPhaseScale = clamp(adaptiveScale, 1, 1.8);

    this.ratioStart = cursor;
    const ratioSteps = Math.max(1, this.segmentRows.length);
    const ratioStepMs = ScaleAnimation.TRACE_MS
      + ScaleAnimation.TRACER_SUSTAIN_MS
      + ScaleAnimation.COLLAPSE_MS;
    const ratioDuration = (ratioSteps * ratioStepMs * this.numberPhaseScale) / 1000;
    this.ratioEnd = cursor + ratioDuration;
    cursor = this.ratioEnd;

    this.octaveStart = cursor;
    const octaveGroups = this.scaleAnimation.octaveGroups?.length || 0;
    const leftoverCount = this.scaleAnimation.leftoverRows?.length || 0;
    const bracketDuration = octaveGroups > 0
      ? (octaveGroups * ScaleAnimation.BRACKET_MS * this.numberPhaseScale) / 1000
      : 0;
    const leftoverDuration = leftoverCount > 0
      ? (ScaleAnimation.BRACKET_MS * 2 * this.numberPhaseScale) / 1000
      : 0;
    const octaveDuration = bracketDuration + leftoverDuration;
    this.octaveEnd = cursor + octaveDuration;
    cursor = this.octaveEnd;

    this.tableStart = cursor;
    const tableDuration = (ScaleAnimation.TABLE_MS * this.numberPhaseScale) / 1000;
    this.tableEnd = cursor + tableDuration;
    cursor = this.tableEnd;

    this.tableMoveStart = cursor;
    const tableMoveDuration = (ScaleAnimation.TABLE_MOVE_MS * this.numberPhaseScale) / 1000;
    this.tableMoveEnd = cursor + tableMoveDuration;
    cursor = this.tableMoveEnd;

    this.totalDuration = cursor;
  }

  computeScaleTableLayout({ ratios, viewScale, viewTranslate }) {
    if (!ratios || ratios.length === 0) return null;
    const { width, height } = this.layout;
    const ctx = this.geometry.ctx;
    const fontBodySize = 13;
    const fontHeaderSize = 12;
    const fontFamily = 'monospace';
    const fontBody = `${fontBodySize}px ${fontFamily}`;
    const fontHeader = `bold ${fontHeaderSize}px ${fontFamily}`;
    ctx.save();
    ctx.font = fontBody;
    const padding = Math.min(width, height) * 0.06;
    const headerHeight = 20;
    const baseRowHeight = 21;
    const maxRowsBeforeCompress = 12;
    const availableHeight = height - padding * 2 - headerHeight;
    let rowHeight = baseRowHeight;
    if (ratios.length > maxRowsBeforeCompress) {
      rowHeight = Math.max(14, availableHeight / ratios.length);
    }
    const tableHeight = headerHeight + rowHeight * ratios.length;
    const tableTop = padding;

    ctx.font = fontHeader;
    let ratioColWidth = ctx.measureText('Ratio').width;
    let centsColWidth = ctx.measureText('Cents').width;
    ctx.font = fontBody;
    const formattedRatios = ratios.map((entry) => {
      const centsText = Number.isFinite(entry.cents)
        ? entry.cents.toFixed(1)
        : '0.0';
      ratioColWidth = Math.max(ratioColWidth, ctx.measureText(entry.fraction).width);
      centsColWidth = Math.max(centsColWidth, ctx.measureText(centsText).width);
      return {
        fraction: entry.fraction,
        centsText
      };
    });

    const cellPadX = 8;
    const colGap = 0;
    const ratioColFull = ratioColWidth + cellPadX * 2;
    const centsColFull = centsColWidth + cellPadX * 2;
    const tableWidth = ratioColFull + colGap + centsColFull;
    const rightX = width - padding - tableWidth;
    const leftX = padding;
    const tableRight = rightX + tableWidth;

    const screenToWorld = (point) => ({
      x: (point.x - viewTranslate.x) / viewScale,
      y: (point.y - viewTranslate.y) / viewScale
    });

    const headerY = tableTop + headerHeight * 0.5;
    const headerRightRatio = screenToWorld({ x: rightX + cellPadX, y: headerY });
    const headerRightCents = screenToWorld({ x: rightX + ratioColFull + colGap + cellPadX, y: headerY });
    const headerLeftRatio = screenToWorld({ x: leftX + cellPadX, y: headerY });
    const headerLeftCents = screenToWorld({ x: leftX + ratioColFull + colGap + cellPadX, y: headerY });

    const rows = formattedRatios.map((entry, index) => {
      const rowY = tableTop + headerHeight + index * rowHeight + rowHeight * 0.5;
      const rightRatioScreen = { x: rightX + cellPadX, y: rowY };
      const rightCentsScreen = { x: rightX + ratioColFull + colGap + cellPadX, y: rowY };
      const leftRatioScreen = { x: leftX + cellPadX, y: rowY };
      const leftCentsScreen = { x: leftX + ratioColFull + colGap + cellPadX, y: rowY };
      return {
        fraction: entry.fraction,
        centsText: entry.centsText,
        ratioRight: screenToWorld(rightRatioScreen),
        centsRight: screenToWorld(rightCentsScreen),
        ratioLeft: screenToWorld(leftRatioScreen),
        centsLeft: screenToWorld(leftCentsScreen),
        ratioRightScreen: rightRatioScreen,
        centsRightScreen: rightCentsScreen
      };
    });

    ctx.restore();

    const dividerRightX = rightX + ratioColFull + colGap * 0.5;
    const dividerLeftX = leftX + ratioColFull + colGap * 0.5;
    const rowYs = [];
    for (let i = 0; i <= ratios.length + 1; i += 1) {
      const y = tableTop + (i === 0 ? 0 : headerHeight + (i - 1) * rowHeight);
      rowYs.push(y);
    }

    return {
      boundsRight: {
        top: screenToWorld({ x: rightX, y: tableTop }).y,
        bottom: screenToWorld({ x: rightX, y: tableTop + tableHeight }).y,
        left: screenToWorld({ x: rightX, y: tableTop }).x,
        right: screenToWorld({ x: tableRight, y: tableTop }).x,
        divider: screenToWorld({ x: dividerRightX, y: tableTop }).x,
        rowYs: rowYs.map((y) => screenToWorld({ x: rightX, y }).y)
      },
      boundsLeft: {
        top: screenToWorld({ x: leftX, y: tableTop }).y,
        bottom: screenToWorld({ x: leftX, y: tableTop + tableHeight }).y,
        left: screenToWorld({ x: leftX, y: tableTop }).x,
        right: screenToWorld({ x: leftX + tableWidth, y: tableTop }).x,
        divider: screenToWorld({ x: dividerLeftX, y: tableTop }).x,
        rowYs: rowYs.map((y) => screenToWorld({ x: leftX, y }).y)
      },
      header: {
        ratioRight: headerRightRatio,
        centsRight: headerRightCents,
        ratioLeft: headerLeftRatio,
        centsLeft: headerLeftCents
      },
      rows,
      fontBodySize,
      fontHeaderSize,
      fontFamily,
      headerHeight,
      rowHeight
    };
  }

  tick(now) {
    if (!this.isPlaying) return;

    if (this.isPaused) {
      this.finalSlide.tick(now);
      this.render(this.lastElapsed);
      this.animationFrame = requestAnimationFrame(this.tick);
      return;
    }

    const elapsed = (now - this.sequenceStart - this.pausedDuration) / 1000;
    this.lastElapsed = elapsed;
    this.render(elapsed);

    if (elapsed <= this.totalDuration + 0.25) {
      this.animationFrame = requestAnimationFrame(this.tick);
    } else {
      this.isPaused = true;
      this.pauseStarted = now;
      this.lastElapsed = this.totalDuration;
      this.setActiveLayer(null);
      this.setStatus('Sequence complete — press P to play tone row.');
      this.animationFrame = requestAnimationFrame(this.tick);
    }
  }

  render(elapsed) {
    const {
      center,
      radius,
      anchorStart,
      anchorEnd,
      lineLength,
      markLength,
      lineWidth
    } = this.layout;

    const unrollProgressRaw = clamp((elapsed - this.unrollStart) / (this.unrollEnd - this.unrollStart), 0, 1);
    const unrollProgress = easeInOutCubic(unrollProgressRaw);

    const organizeDuration = this.organizeEnd - this.organizeStart;
    const organizeProgressRaw = organizeDuration > 0
      ? clamp((elapsed - this.organizeStart) / organizeDuration, 0, 1)
      : 0;
    const organizeProgress = easeInOutCubic(organizeProgressRaw);

    const waveDuration = this.waveEnd - this.waveStart;
    const waveProgressRaw = waveDuration > 0
      ? clamp((elapsed - this.waveStart) / waveDuration, 0, 1)
      : 0;
    const waveProgress = easeInOutCubic(waveProgressRaw);

    const ratioDuration = this.ratioEnd - this.ratioStart;
    const ratioProgress = ratioDuration > 0
      ? clamp((elapsed - this.ratioStart) / ratioDuration, 0, 1)
      : 0;

    const tableDuration = this.tableEnd - this.tableStart;
    const tableProgress = tableDuration > 0
      ? clamp((elapsed - this.tableStart) / tableDuration, 0, 1)
      : 0;
    const tableMoveDuration = this.tableMoveEnd - this.tableMoveStart;
    const tableMoveProgress = tableMoveDuration > 0
      ? clamp((elapsed - this.tableMoveStart) / tableMoveDuration, 0, 1)
      : 0;
    const titleFadeOutDuration = 0.9;
    let titleAlpha = 0;
    if (this.polyrhythmTitle) {
      if (elapsed < this.organizeStart) {
        titleAlpha = 1;
      } else {
        const t = clamp((elapsed - this.organizeStart) / titleFadeOutDuration, 0, 1);
        titleAlpha = 1 - easeInOutCubic(t);
      }

      const finalReturnStart = 0.68;
      const returnProgress = clamp((tableMoveProgress - finalReturnStart) / (1 - finalReturnStart), 0, 1);
      titleAlpha = Math.max(titleAlpha, easeInOutCubic(returnProgress));

      if (this.finalSlide.isActive()) {
        titleAlpha = 1;
      }
    }
    let gridSubtitleAlpha = 0;
    if (this.gridValue > 0 && elapsed >= this.gridSubtitleStart && elapsed <= this.organizeStart) {
      const gridSubtitleFadeIn = 0.22;
      const t = clamp((elapsed - this.gridSubtitleStart) / gridSubtitleFadeIn, 0, 1);
      gridSubtitleAlpha = easeInOutCubic(t);
    }

    const pauseFadeRaw = clamp((elapsed - this.pauseStart) / (this.pauseEnd - this.pauseStart), 0, 1);
    const pauseFade = 1 - easeInOutCubic(pauseFadeRaw);

    const viewShift = easeOutCubic(unrollProgress);
    const viewOffset = {
      x: lerp(0, anchorEnd.x - anchorStart.x, viewShift),
      y: lerp(0, anchorEnd.y - anchorStart.y, viewShift)
    };
    const anchor = {
      x: anchorStart.x + viewOffset.x,
      y: anchorStart.y + viewOffset.y
    };

    const centerShifted = {
      x: anchor.x,
      y: anchor.y + radius
    };
    const circumference = TAU * radius;
    const arcLen = (1 - unrollProgress) * circumference;
    const thetaEnd = arcLen / radius;
    const tangentDir = { x: Math.cos(thetaEnd), y: Math.sin(thetaEnd) };

    const autoView = this.getAutoFitView({
      center: centerShifted,
      radius,
      unrollProgress,
      markExtent: markLength,
      lineWidth
    });
    if (unrollProgress >= 0.999 && !this.unrollView) {
      // Lock view to match Stage 1's line geometry exactly:
      // line from width*0.14 to width*0.86 at y = height*0.5
      const s1Scale = (this.layout.width * 0.72) / lineLength;
      const worldLineLeft = centerShifted.x;
      const worldLineY = centerShifted.y - radius;
      this.unrollView = {
        scale: s1Scale,
        translate: {
          x: this.layout.width * 0.14 - worldLineLeft * s1Scale,
          y: this.layout.height * 0.5 - worldLineY * s1Scale
        }
      };
    }

    const baseView = (organizeProgress > 0 || waveProgress > 0 || ratioProgress > 0) && this.unrollView
      ? this.unrollView
      : autoView;
    const padding = Math.min(this.layout.width, this.layout.height) * 0.08;
    const fundamentalRow = this.segmentRows.length
      ? this.segmentRows[this.segmentRows.length - 1]
      : null;
    const fundamentalLength = fundamentalRow ? fundamentalRow.length : lineLength;
    const totalWaveLength = fundamentalLength * Math.max(1, this.maxDenominator);
    const waveScaleTarget = Math.min(
      2, // try 1.1–1.25
      (this.layout.width - padding * 2) / (totalWaveLength || 1)
    );
    const waveScaleBlend = clamp(waveProgress / 0.2, 0, 1);
    const viewScale = (waveProgress > 0 || ratioProgress > 0)
      ? lerp(baseView.scale, waveScaleTarget, waveScaleBlend)
      : baseView.scale;
    const viewTranslate = baseView.translate;
    const screenLineWidth = lineWidth / viewScale;
    const screenMarkLength = markLength / viewScale;
    this.geometry.clear();
    this.geometry.beginFrame({
      scale: viewScale,
      translate: viewTranslate
    });

    if (organizeProgress === 0) {
      this.geometry.drawUnrollPath({
        center: centerShifted,
        radius,
        progress: unrollProgress,
        samples: 180,
        strokeStyle: COLORS.white,
        lineWidth: screenLineWidth
      });
    }

    if (organizeProgress === 0
      && elapsed >= this.groupingDemoStart
      && elapsed < this.unrollStart
      && this.groupingDemoEntries.length) {
      const groupingElapsed = elapsed - this.groupingDemoStart;
      const stageElapsed = groupingElapsed - this.groupingIntroDuration;
      const topAngle = -Math.PI / 2;
      const groupingFont = `${Math.round(((this.layout.fontSize || 13) * 1.05) / viewScale)}px monospace`;
      const activeIndex = Math.floor(stageElapsed / this.groupingStepDuration);

      if (stageElapsed >= 0 && activeIndex >= 0 && activeIndex < this.groupingDemoEntries.length) {
        const entry = this.groupingDemoEntries[activeIndex];
        const localSlotProgress = clamp(
          (stageElapsed - activeIndex * this.groupingStepDuration) / this.groupingStepDuration,
          0,
          1
        );
        const fadeWindow = 0.14;
        const fadeIn = clamp(localSlotProgress / fadeWindow, 0, 1);
        const fadeOut = clamp((1 - localSlotProgress) / fadeWindow, 0, 1);
        const slotAlpha = easeInOutCubic(Math.min(fadeIn, fadeOut));
        const wedgeEnd = topAngle + (TAU / entry.layerValue);
        const startPoint = {
          x: centerShifted.x + Math.cos(topAngle) * radius,
          y: centerShifted.y + Math.sin(topAngle) * radius
        };
        const endPoint = {
          x: centerShifted.x + Math.cos(wedgeEnd) * radius,
          y: centerShifted.y + Math.sin(wedgeEnd) * radius
        };

        this.geometry.drawArcSlice({
          center: centerShifted,
          radius,
          startAngle: topAngle,
          endAngle: wedgeEnd,
          fillStyle: entry.color,
          strokeStyle: entry.color,
          lineWidth: Math.max(1, screenLineWidth),
          alpha: 0.7 * slotAlpha,
          fillAlpha: 0.16 * slotAlpha
        });

        this.geometry.drawLine({
          start: centerShifted,
          end: startPoint,
          strokeStyle: entry.color,
          lineWidth: Math.max(1, screenLineWidth * 0.9),
          alpha: 0.45 * slotAlpha
        });
        this.geometry.drawLine({
          start: centerShifted,
          end: endPoint,
          strokeStyle: entry.color,
          lineWidth: Math.max(1, screenLineWidth * 0.9),
          alpha: 0.45 * slotAlpha
        });

        const midTheta = (TAU / entry.layerValue) * 0.5;
        const labelRadius = radius + screenMarkLength * 1.25;
        const labelPos = {
          x: centerShifted.x + Math.sin(midTheta) * labelRadius,
          y: centerShifted.y - Math.cos(midTheta) * labelRadius
        };

        this.geometry.drawText({
          text: String(entry.groupingValue),
          position: labelPos,
          color: entry.color,
          font: groupingFont,
          align: 'center',
          baseline: 'middle',
          alpha: slotAlpha
        });
      }
    }

    if (organizeProgress === 0 && unrollProgress >= 0.999 && this.gridValue > 0) {
      const gridDur = this.gridEnd - this.gridStart;
      const gridProg = gridDur > 0
        ? clamp((elapsed - this.gridStart) / gridDur, 0, 1)
        : 0;

      if (gridProg > 0) {
        const fontSize = (this.layout.fontSize || 13) / viewScale;
        const font = `${Math.round(fontSize)}px monospace`;
        const labelOffsetY = markLength * 1.8;

        const segCount = this.segments.length;
        this.segments.forEach((segment, idx) => {
          const threshold = 0.25 + (idx / Math.max(1, segCount)) * 0.7;
          const segAlpha = clamp((gridProg - threshold) / 0.12, 0, 1);
          if (segAlpha <= 0) return;

          this.geometry.drawText({
            text: String(segment.value),
            position: { x: anchor.x + segment.start + segment.length * 0.5, y: anchor.y - labelOffsetY },
            color: COLORS.white,
            font,
            align: 'center',
            baseline: 'bottom',
            alpha: segAlpha
          });
        });
      }
    }

    let activeLayer = null;
    this.layerSegments.forEach((segment, index) => {
      if (elapsed >= segment.start && elapsed <= segment.end) {
        activeLayer = index;
      }
    });
    this.setActiveLayer(activeLayer);

    const worldToScreen = (point) => ({
      x: point.x * viewScale + viewTranslate.x,
      y: point.y * viewScale + viewTranslate.y
    });
    const screenToWorld = (point) => ({
      x: (point.x - viewTranslate.x) / viewScale,
      y: (point.y - viewTranslate.y) / viewScale
    });

    const tableLayout = (this.scaleRatios.length > 0 && (tableProgress > 0 || tableMoveProgress > 0))
      ? this.computeScaleTableLayout({ ratios: this.scaleRatios, viewScale, viewTranslate })
      : null;

    if (tableMoveProgress > 0) {
      const circleCenter = screenToWorld({ x: this.layout.width * 0.5, y: this.layout.height * 0.5 });
      const circleRadius = this.layout.radius / viewScale;
      this.geometry.drawCircle(circleCenter, circleRadius, COLORS.white, screenLineWidth, clamp(tableMoveProgress, 0, 1));
      const markAlpha = clamp(tableMoveProgress, 0, 1);
      const now = performance.now();
      const slideActive = this.finalSlide.isActive();

      this.marks.forEach((mark, markIdx) => {
        const radialDir = { x: Math.sin(mark.angle), y: -Math.cos(mark.angle) };
        const markX = circleCenter.x + radialDir.x * circleRadius;
        const markY = circleCenter.y + radialDir.y * circleRadius;
        this.geometry.drawMark({
          position: { x: markX, y: markY },
          direction: radialDir,
          length: screenMarkLength,
          color: mark.isOrigin ? COLORS.white : mark.color,
          progress: 1,
          lineWidth: screenLineWidth,
          alpha: markAlpha
        });

        if (slideActive) {
          const hlAlpha = this.finalSlide.getHighlightAlpha(markIdx, now);
          if (hlAlpha > 0) {
            this.geometry.drawMark({
              position: { x: markX, y: markY },
              direction: radialDir,
              length: screenMarkLength * 1.6,
              color: COLORS.white,
              progress: 1,
              lineWidth: screenLineWidth * 2.5,
              alpha: hlAlpha * 0.6
            });
            this.geometry.drawMark({
              position: { x: markX, y: markY },
              direction: radialDir,
              length: screenMarkLength,
              color: COLORS.white,
              progress: 1,
              lineWidth: screenLineWidth * 1.5,
              alpha: hlAlpha
            });
          }
        }
      });

      if (slideActive) {
        const cursorAngle = this.finalSlide.getCursorAngle();
        const cursorDir = { x: Math.sin(cursorAngle), y: -Math.cos(cursorAngle) };
        const cursorX = circleCenter.x + cursorDir.x * circleRadius;
        const cursorY = circleCenter.y + cursorDir.y * circleRadius;
        const dotRadius = Math.max(3, screenMarkLength * 0.35);
        this.geometry.fillDot({
          position: { x: cursorX, y: cursorY },
          radius: dotRadius,
          fillStyle: COLORS.white,
          alpha: 1
        });
      }
    }

    if ((organizeProgress > 0 || waveProgress > 0 || ratioProgress > 0) && this.segments.length && this.segmentRows.length) {
      const rowCount = this.segmentRows.length;
      const topY = padding;
      const bottomY = this.layout.height - padding;
      const rowGap = rowCount > 1 ? (bottomY - topY) / (rowCount - 1) : 0;

      const longestPrimary = this.segments.find(
        (segment) => segment.isPrimary && segment.rowIndex === rowCount - 1
      ) || this.segments[0];
      const baseLongestStart = {
        x: anchor.x + longestPrimary.start,
        y: anchor.y
      };
      const baseLongestScreen = worldToScreen(baseLongestStart);
      const targetLongestScreen = {
        x: padding,
        y: bottomY
      };

      const shiftPhase = waveProgress > 0 ? 1 : clamp(organizeProgress / 0.2, 0, 1);
      const shiftVec = {
        x: targetLongestScreen.x - baseLongestScreen.x,
        y: targetLongestScreen.y - baseLongestScreen.y
      };

      const detachProgress = waveProgress > 0 ? 1 : clamp((organizeProgress - 0.2) / 0.8, 0, 1);
      const segmentCount = this.segments.length;
      const stagger = segmentCount > 1 ? 0.6 / (segmentCount - 1) : 0;
      const moveDuration = 0.4;
      const segmentStates = new Map();

      this.segments.forEach((segment) => {
        const baseStartWorld = { x: anchor.x + segment.start, y: anchor.y };
        const baseEndWorld = { x: baseStartWorld.x + segment.length, y: anchor.y };

        const baseStartScreen = worldToScreen(baseStartWorld);
        const baseEndScreen = worldToScreen(baseEndWorld);

        const shiftedBaseStart = {
          x: baseStartScreen.x + shiftVec.x * shiftPhase,
          y: baseStartScreen.y + shiftVec.y * shiftPhase
        };
        const shiftedBaseEnd = {
          x: baseEndScreen.x + shiftVec.x * shiftPhase,
          y: baseEndScreen.y + shiftVec.y * shiftPhase
        };

        const rowY = topY + segment.rowIndex * rowGap;
        const targetStartScreen = { x: padding, y: rowY };
        const targetEndScreen = {
          x: padding + segment.length * viewScale,
          y: rowY
        };

        const startDelay = segment.index * stagger;
        const isAnchor = segment.isPrimary && segment.rowIndex === rowCount - 1;
        const segmentProgress = waveProgress > 0
          ? 1
          : (isAnchor ? 0 : clamp((detachProgress - startDelay) / moveDuration, 0, 1));

        const currentStartScreen = {
          x: lerp(shiftedBaseStart.x, targetStartScreen.x, segmentProgress),
          y: lerp(shiftedBaseStart.y, targetStartScreen.y, segmentProgress)
        };
        const currentEndScreen = {
          x: lerp(shiftedBaseEnd.x, targetEndScreen.x, segmentProgress),
          y: lerp(shiftedBaseEnd.y, targetEndScreen.y, segmentProgress)
        };

        let alpha = 1;
        if (!segment.isPrimary) {
          alpha = waveProgress > 0 ? 0 : 1 - clamp((segmentProgress - 0.85) / 0.15, 0, 1);
        }

        const drawStart = screenToWorld(currentStartScreen);
        const drawEnd = screenToWorld(currentEndScreen);

        if (organizeProgress > 0 && waveProgress === 0) {
          this.geometry.drawLine({
            start: drawStart,
            end: drawEnd,
            strokeStyle: COLORS.white,
            lineWidth: screenLineWidth,
            alpha
          });
        }

        segmentStates.set(segment.index, {
          startScreen: currentStartScreen,
          endScreen: currentEndScreen,
          alpha,
          progress: segmentProgress
        });
      });

      if (this.gridValue > 0) {
        const labelFadeMs = 400;
        const stepDurationMs = (ScaleAnimation.TRACE_MS + ScaleAnimation.TRACER_SUSTAIN_MS + ScaleAnimation.COLLAPSE_MS) * this.numberPhaseScale;
        const ratioElapsedMs = Math.max(0, (elapsed - this.ratioStart) * 1000);
        const fundamentalRowIndex = this.segmentRows.length - 1;
        const order = this.scaleAnimation.order || [];

        const fontSize = (this.layout.fontSize || 13) / viewScale;
        const font = `${Math.round(fontSize)}px monospace`;
        const labelOffsetY = markLength * 1.8;
        const labelMargin = markLength * 0.8;
        const positionBlend = clamp(waveProgress / 0.25, 0, 1);

        this.segments.forEach((segment) => {
          const state = segmentStates.get(segment.index);
          if (!state || state.alpha <= 0) return;

          let labelAlpha;
          if (segment.rowIndex === fundamentalRowIndex) {
            const fundamentalFadeStart = Math.max(0, (this.ratioEnd - labelFadeMs / 1000 - this.ratioStart) * 1000);
            labelAlpha = 1 - clamp((ratioElapsedMs - fundamentalFadeStart) / labelFadeMs, 0, 1);
          } else {
            const stepIndex = order.indexOf(segment.rowIndex);
            const fadeStart = stepIndex >= 0 ? stepIndex * stepDurationMs : 0;
            labelAlpha = 1 - clamp((ratioElapsedMs - fadeStart) / labelFadeMs, 0, 1);
          }

          const finalAlpha = state.alpha * labelAlpha;
          if (finalAlpha <= 0) return;

          const midXScreen = (state.startScreen.x + state.endScreen.x) * 0.5;
          const aboveWorld = screenToWorld({ x: midXScreen, y: state.startScreen.y });
          aboveWorld.y -= labelOffsetY;

          const leftWorld = screenToWorld({ x: state.startScreen.x, y: state.startScreen.y });
          leftWorld.x -= labelMargin;

          const labelWorld = {
            x: lerp(aboveWorld.x, leftWorld.x, positionBlend),
            y: lerp(aboveWorld.y, leftWorld.y, positionBlend)
          };
          const align = positionBlend > 0.5 ? 'right' : 'center';
          const baseline = positionBlend > 0.5 ? 'middle' : 'bottom';

          this.geometry.drawText({
            text: String(segment.value),
            position: labelWorld,
            color: COLORS.white,
            font,
            align,
            baseline,
            alpha: finalAlpha
          });
        });
      }

      if (organizeProgress > 0 && waveProgress === 0) {
        this.marks.forEach((mark) => {
          const state = segmentStates.get(mark.segmentIndex);
          const segment = this.segments[mark.segmentIndex];
          if (!state || !segment) return;

          const segmentLength = Math.max(1e-6, segment.length);
          const offset = clamp(mark.arc - segment.start, 0, segmentLength);
          const t = offset / segmentLength;
          const markScreen = {
            x: lerp(state.startScreen.x, state.endScreen.x, t),
            y: lerp(state.startScreen.y, state.endScreen.y, t)
          };

          const dx = state.endScreen.x - state.startScreen.x;
          const dy = state.endScreen.y - state.startScreen.y;
          const len = Math.hypot(dx, dy) || 1;
          const direction = { x: -dy / len, y: dx / len };

          const markColorBase = mark.isOrigin ? COLORS.white : mark.color;
          const detachFade = 1 - clamp(state.progress / 0.25, 0, 1);
          const markAlpha = state.alpha * detachFade;

          this.geometry.drawMark({
            position: screenToWorld(markScreen),
            direction,
            length: screenMarkLength,
            color: markColorBase,
            progress: 1,
            lineWidth: screenLineWidth,
            alpha: markAlpha
          });
        });
      }

      if (waveProgress > 0 && ratioProgress === 0) {
        const phaseBottom = clamp(waveProgress / 0.35, 0, 1);
        const phaseTop = clamp((waveProgress - 0.35) / 0.45, 0, 1);
        const waveFade = clamp((waveProgress - 0.8) / 0.2, 0, 1);
        const fundamentalRow = this.segmentRows[rowCount - 1];
        const fundamentalLength = fundamentalRow ? fundamentalRow.length : 0;
        const totalLength = fundamentalLength * Math.max(1, this.maxDenominator);
        const totalLengthScreen = totalLength * viewScale;
        const amplitude = Math.min(rowGap * 0.25, markLength * 0.9) / viewScale;
        const markerLength = screenMarkLength * 0.85;
        const playbackRows = [];

        this.segmentRows.forEach((row) => {
          const rowY = topY + row.rowIndex * rowGap;
          const rowStartScreen = { x: padding, y: rowY };
          const rowStartWorld = screenToWorld(rowStartScreen);
          const segmentLength = row.length || 1;
          const segmentLengthScreen = segmentLength * viewScale;
          const repeatCount = segmentLengthScreen > 0
            ? Math.floor(totalLengthScreen / segmentLengthScreen + 1e-6)
            : 1;
          const maxRepeats = Math.max(1, repeatCount);
          const rowPhase = row.rowIndex === rowCount - 1 ? phaseBottom : phaseTop;
          const repeatFloat = 1 + rowPhase * (maxRepeats - 1);
          const fullRepeats = Math.floor(repeatFloat);
          const partial = repeatFloat - fullRepeats;
          const rowTotalLength = segmentLength * (fullRepeats + partial);
          const rowTotalLengthScreen = rowTotalLength * viewScale;

          if (rowTotalLength > 0) {
            this.geometry.drawLine({
              start: rowStartWorld,
              end: { x: rowStartWorld.x + rowTotalLength, y: rowStartWorld.y },
              strokeStyle: COLORS.white,
              lineWidth: screenLineWidth,
              alpha: 1
            });
          }

          for (let i = 1; i <= fullRepeats; i += 1) {
            const markerScreen = {
              x: rowStartScreen.x + segmentLengthScreen * i,
              y: rowY
            };
            this.geometry.drawMark({
              position: screenToWorld(markerScreen),
              direction: { x: 0, y: -1 },
              length: markerLength,
              color: COLORS.white,
              progress: 1,
              lineWidth: screenLineWidth,
              alpha: 1
            });
          }

          if (this.showWaves && waveFade > 0 && rowTotalLength > 0) {
            this.geometry.drawSine({
              start: rowStartWorld,
              length: rowTotalLength,
              baselineY: rowStartWorld.y,
              amplitude,
              period: segmentLength,
              strokeStyle: COLORS.white,
              lineWidth: Math.max(1, screenLineWidth * 0.8),
              alpha: waveFade
            });
          }

          playbackRows.push({
            index: row.rowIndex,
            value: row.value,
            length: segmentLength,
            startScreen: rowStartScreen,
            endScreen: { x: rowStartScreen.x + rowTotalLengthScreen, y: rowY }
          });
        });

        this.playbackRows = playbackRows;
      }

      if (ratioProgress > 0) {
        const ratioElapsedMs = Math.max(0, (elapsed - this.ratioStart) * 1000);
        const octaveElapsedMs = Math.max(0, (elapsed - this.octaveStart) * 1000);
        const fundamentalRow = this.segmentRows[rowCount - 1];
        const fundamentalLength = fundamentalRow ? fundamentalRow.length : 1;
        const unitLength = fundamentalLength / (this.fundamentalValue || 1);
        const totalLength = fundamentalLength * Math.max(1, this.maxDenominator);
        const rowLayouts = this.segmentRows.map((row) => {
          const rowY = topY + row.rowIndex * rowGap;
          const rowStartWorld = screenToWorld({ x: padding, y: rowY });
          const repeatCount = Math.max(1, Math.floor(totalLength / (row.length || 1) + 1e-6));
          const tickCount = Math.max(1, repeatCount);
          const tickSpacing = (row.length || 1);
          const tickLength = screenMarkLength * 0.85;
          const tickLineWidth = Math.max(1, screenLineWidth * 0.85);
          const tickMarks = [];

          for (let i = 1; i <= tickCount; i += 1) {
            tickMarks.push({
              position: {
                x: rowStartWorld.x + tickSpacing * i,
                y: rowStartWorld.y
              },
              length: tickLength,
              lineWidth: tickLineWidth
            });
          }
          return {
            rowIndex: row.rowIndex,
            value: row.value,
            startWorld: rowStartWorld,
            singleLength: row.length,
            repeatedLength: row.length * repeatCount,
            lcmWorld: 0,
            labelOffset: Math.max(10, screenMarkLength * 1.2),
            tickMarks
          };
        });

        rowLayouts.forEach((row) => {
          row.lcmWorld = unitLength * (this.scaleAnimation.ratioMap.get(row.rowIndex)?.lcmValue || 0);
        });

        this.scaleAnimation.render({
          geometry: this.geometry,
          rows: rowLayouts,
          fundamentalRowIndex: rowCount - 1,
          progress: ratioProgress,
          elapsedMs: ratioElapsedMs,
          lineWidth: screenLineWidth,
          fontSize: (this.layout.fontSize || 13) / viewScale,
          textColor: COLORS.white,
          dimAlpha: 0.2,
          showOctaveCollapse: this.showOctaveCollapse || octaveElapsedMs > 0,
          octaveElapsedMs,
          tableProgress,
          tableMoveProgress,
          tableLayout,
          numberPhaseScale: this.numberPhaseScale,
          viewScale,
          viewTranslate,
          tableHighlights: this.finalSlide.isActive() ? this.finalSlide.getTableHighlights(performance.now()) : []
        });
      }
    }

    if (organizeProgress === 0) {
      this.marks.forEach((mark) => {
      const segment = this.layerSegments.get(mark.layerIndex);
      let drawProgress = 0;

      if (segment) {
        if (elapsed >= segment.end) {
          drawProgress = 1;
        } else if (elapsed >= segment.start) {
          const markStart = segment.start + segment.perMark * mark.order;
          drawProgress = clamp((elapsed - markStart) / segment.perMark, 0, 1);
        }
      }

      if (elapsed >= this.unrollStart) {
        drawProgress = 1;
      }

      const circleX = centerShifted.x + Math.sin(mark.angle) * radius;
      const circleY = centerShifted.y - Math.cos(mark.angle) * radius;

      let baseX;
      let baseY;
      if (mark.arc <= arcLen) {
        const theta = mark.arc / radius;
        baseX = centerShifted.x + Math.sin(theta) * radius;
        baseY = centerShifted.y - Math.cos(theta) * radius;
      } else {
        const dist = mark.arc - arcLen;
        const lineStart = {
          x: centerShifted.x + Math.sin(thetaEnd) * radius,
          y: centerShifted.y - Math.cos(thetaEnd) * radius
        };
        baseX = lineStart.x + tangentDir.x * dist;
        baseY = lineStart.y + tangentDir.y * dist;
      }

      const posX = baseX;
      const posY = baseY;

      const radialDir = { x: Math.sin(mark.angle), y: -Math.cos(mark.angle) };
      const lineDir = { x: -tangentDir.y, y: tangentDir.x };
      const direction = {
        x: lerp(radialDir.x, lineDir.x, unrollProgress),
        y: lerp(radialDir.y, lineDir.y, unrollProgress)
      };

      const markColorBase = mark.isOrigin ? COLORS.white : mark.color;
      const markColor = markColorBase;

      if (pauseFade > 0) {
        this.geometry.drawRadialLine({
          center: centerShifted,
          direction: radialDir,
          length: radius,
          color: markColorBase,
          progress: drawProgress,
          lineWidth: Math.max(1, lineWidth * 0.6),
          alpha: 0.35 * pauseFade
        });
      }

      this.geometry.drawMark({
        position: { x: posX, y: posY },
        direction,
        length: screenMarkLength,
        color: markColor,
        progress: drawProgress,
        lineWidth: screenLineWidth
      });
      });
    }

    if (titleAlpha > 0 && this.polyrhythmTitle) {
      const fontSize = ((this.layout.fontSize || 13) * 2.75) / viewScale;
      const titleLetterSpacing = 1.2 / viewScale;
      const titleScreenY = Math.max(28, this.layout.height * 0.07);
      const titlePos = screenToWorld({
        x: this.layout.width * 0.5,
        y: titleScreenY
      });
      this.geometry.drawText({
        text: this.polyrhythmTitle,
        position: titlePos,
        color: COLORS.white,
        font: `${Math.round(fontSize)}px "Space Grotesk", sans-serif`,
        align: 'center',
        baseline: 'middle',
        alpha: titleAlpha,
        letterSpacing: titleLetterSpacing
      });

      if (gridSubtitleAlpha > 0) {
        const subtitleFontSize = ((this.layout.fontSize || 13) * 1.25) / viewScale;
        const subtitlePos = screenToWorld({
          x: this.layout.width * 0.5,
          y: titleScreenY + Math.max(42, (this.layout.fontSize || 13) * 2)
        });
        this.geometry.drawText({
          text: `Grid: ${this.gridValue}`,
          position: subtitlePos,
          color: COLORS.white,
          font: `${Math.round(subtitleFontSize)}px monospace`,
          align: 'center',
          baseline: 'middle',
          alpha: gridSubtitleAlpha
        });
      }
    }

    this.geometry.endFrame();
    this.drawPointerOverlay();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('animation-canvas');
  const statusEl = document.getElementById('status');
  const layerRows = Array.from(document.querySelectorAll('.layer-row'));
  const form = document.getElementById('rhythm-form');
  const resetBtn = document.getElementById('reset-btn');
  const recordBtn = document.getElementById('record-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const appRoot = document.querySelector('.app');

  if (!canvas || !form) return;
  const stageEl = canvas.parentElement;
  const fullscreenTarget = stageEl || appRoot;

  const sequence = new AnimationSequence(canvas, { statusEl, layerRows });
  new AnimationControls(sequence);
  const playback = new AnimationPlayback(sequence, canvas);
  let mediaRecorder = null;
  let recordingChunks = [];
  let recordingAudioCleanup = null;
  let recordingDataInterval = null;
  let recordingCaptureCleanup = null;
  let isRecording = false;
  const RECORD_EXPORT_WIDTH = 1920;
  const RECORD_EXPORT_HEIGHT = 1080;
  const RECORD_EXPORT_FPS = 60;

  const readLayerValues = () => ['layer-a', 'layer-b', 'layer-c', 'layer-d'].map((id) => {
    const input = document.getElementById(id);
    return input ? parseInt(input.value, 10) : 0;
  });

  const setRecordingState = (recording) => {
    isRecording = recording;
    if (!recordBtn) return;
    recordBtn.classList.toggle('is-recording', recording);
    recordBtn.textContent = recording ? 'Stop Recording' : 'Record Sequence';
    recordBtn.setAttribute('aria-pressed', recording ? 'true' : 'false');
  };

  const cleanupRecordingAudioTap = () => {
    if (typeof recordingAudioCleanup === 'function') {
      try {
        recordingAudioCleanup();
      } catch (_) {
        // no-op
      }
    }
    recordingAudioCleanup = null;
  };

  const clearRecordingDataInterval = () => {
    if (recordingDataInterval) {
      clearInterval(recordingDataInterval);
      recordingDataInterval = null;
    }
  };

  const createCoverCaptureStream = (sourceCanvas, fps = RECORD_EXPORT_FPS) => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = RECORD_EXPORT_WIDTH;
    exportCanvas.height = RECORD_EXPORT_HEIGHT;
    const exportCtx = exportCanvas.getContext('2d', { alpha: false });
    if (!exportCtx || typeof exportCanvas.captureStream !== 'function') return null;

    let rafId = 0;
    let isRunning = true;

    const drawFrame = () => {
      if (!isRunning) return;
      const sourceWidth = Math.max(1, sourceCanvas.width || Math.round(sourceCanvas.getBoundingClientRect().width) || 1);
      const sourceHeight = Math.max(1, sourceCanvas.height || Math.round(sourceCanvas.getBoundingClientRect().height) || 1);
      const scale = Math.max(RECORD_EXPORT_WIDTH / sourceWidth, RECORD_EXPORT_HEIGHT / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      const offsetX = (RECORD_EXPORT_WIDTH - drawWidth) * 0.5;
      const offsetY = (RECORD_EXPORT_HEIGHT - drawHeight) * 0.5;

      exportCtx.fillStyle = '#000';
      exportCtx.fillRect(0, 0, RECORD_EXPORT_WIDTH, RECORD_EXPORT_HEIGHT);
      exportCtx.drawImage(sourceCanvas, offsetX, offsetY, drawWidth, drawHeight);
      rafId = requestAnimationFrame(drawFrame);
    };

    drawFrame();
    return {
      stream: exportCanvas.captureStream(fps),
      stop: () => {
        isRunning = false;
        if (rafId) cancelAnimationFrame(rafId);
      }
    };
  };

  const stopRecording = () => {
    clearRecordingDataInterval();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.requestData();
      } catch (_) {
        // no-op
      }
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      if (typeof recordingCaptureCleanup === 'function') recordingCaptureCleanup();
      recordingCaptureCleanup = null;
      cleanupRecordingAudioTap();
      setRecordingState(false);
    }
  };

  const getSupportedMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  };

  const startRecording = async () => {
    if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
      if (statusEl) {
        statusEl.textContent = 'Recording is not supported in this browser.';
      }
      return;
    }

    const layers = readLayerValues();
    if (!layers.some((value) => value > 1)) {
      if (statusEl) {
        statusEl.textContent = 'Enter at least one layer value greater than 1 before recording.';
      }
      return;
    }

    if (window.Tone && typeof window.Tone.start === 'function') {
      try {
        await window.Tone.start();
      } catch (_) {
        // continue without guaranteed audio context start
      }
    }

    const capture = createCoverCaptureStream(canvas, RECORD_EXPORT_FPS);
    if (!capture?.stream) {
      if (statusEl) {
        statusEl.textContent = 'Could not prepare 1920x1080 recording stream.';
      }
      return;
    }
    const stream = capture.stream;
    recordingCaptureCleanup = capture.stop;
    let recordingHasAudioTrack = false;

    // Try to include Tone.js output in the recording stream.
    if (window.Tone) {
      try {
        const toneContext = (typeof window.Tone.getContext === 'function')
          ? window.Tone.getContext()
          : window.Tone.context;
        const rawContext = toneContext?.rawContext || toneContext;
        if (rawContext && typeof rawContext.createMediaStreamDestination === 'function' && window.Tone.Destination) {
          const mediaDest = rawContext.createMediaStreamDestination();
          if (typeof window.Tone.Destination.connect === 'function') {
            const hookedOutputs = new Set();
            const disconnectFns = [];
            const hookEnsureFns = [];

            const connectNodeToTap = (node) => {
              if (!node || typeof node.connect !== 'function') return;
              if (hookedOutputs.has(node)) return;
              try {
                node.connect(mediaDest);
                hookedOutputs.add(node);
                disconnectFns.push(() => {
                  try { node.disconnect(mediaDest); } catch (_) { /* no-op */ }
                });
              } catch (_) {
                // no-op
              }
            };

            const hookEnsureAudio = (owner) => {
              if (!owner || typeof owner.ensureAudio !== 'function') return;
              const original = owner.ensureAudio.bind(owner);
              owner.ensureAudio = (...args) => {
                const ok = original(...args);
                if (ok && owner.output) connectNodeToTap(owner.output);
                return ok;
              };
              hookEnsureFns.push(() => {
                owner.ensureAudio = original;
              });
            };

            window.Tone.Destination.connect(mediaDest);
            connectNodeToTap(playback.output);
            connectNodeToTap(sequence.finalSlide?.output);
            hookEnsureAudio(playback);
            hookEnsureAudio(sequence.finalSlide);
            const audioTracks = mediaDest.stream.getAudioTracks();
            if (audioTracks && audioTracks.length) {
              audioTracks.forEach((track) => stream.addTrack(track));
              recordingHasAudioTrack = true;
            }

            // Keep a silent signal running so audio timestamps stay continuous.
            let keepAliveOsc = null;
            let keepAliveGain = null;
            try {
              keepAliveOsc = rawContext.createOscillator();
              keepAliveGain = rawContext.createGain();
              keepAliveGain.gain.value = 0.00001;
              keepAliveOsc.connect(keepAliveGain);
              keepAliveGain.connect(mediaDest);
              keepAliveOsc.start();
            } catch (_) {
              keepAliveOsc = null;
              keepAliveGain = null;
            }

            recordingAudioCleanup = () => {
              hookEnsureFns.forEach((fn) => {
                try { fn(); } catch (_) { /* no-op */ }
              });
              disconnectFns.forEach((fn) => {
                try { fn(); } catch (_) { /* no-op */ }
              });
              try {
                if (typeof window.Tone.Destination.disconnect === 'function') {
                  window.Tone.Destination.disconnect(mediaDest);
                }
              } catch (_) {
                // no-op
              }
              if (keepAliveOsc) {
                try { keepAliveOsc.stop(); } catch (_) { /* no-op */ }
                try { keepAliveOsc.disconnect(); } catch (_) { /* no-op */ }
              }
              if (keepAliveGain) {
                try { keepAliveGain.disconnect(); } catch (_) { /* no-op */ }
              }
              mediaDest.stream.getTracks().forEach((track) => track.stop());
            };
          }
        }
      } catch (_) {
        cleanupRecordingAudioTap();
      }
    }

    const mimeType = getSupportedMimeType();
    const options = { videoBitsPerSecond: 12_000_000 };
    if (mimeType) options.mimeType = mimeType;

    try {
      mediaRecorder = new MediaRecorder(stream, options);
    } catch (error) {
      if (typeof recordingCaptureCleanup === 'function') recordingCaptureCleanup();
      recordingCaptureCleanup = null;
      stream.getTracks().forEach((track) => track.stop());
      cleanupRecordingAudioTap();
      if (statusEl) {
        statusEl.textContent = 'Could not start recording in this browser.';
      }
      return;
    }

    recordingChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    };
    mediaRecorder.onerror = () => {
      if (typeof recordingCaptureCleanup === 'function') recordingCaptureCleanup();
      recordingCaptureCleanup = null;
      stream.getTracks().forEach((track) => track.stop());
      cleanupRecordingAudioTap();
      clearRecordingDataInterval();
      setRecordingState(false);
      if (statusEl) {
        statusEl.textContent = 'Recording failed. Please try again.';
      }
      mediaRecorder = null;
    };
    mediaRecorder.onstop = () => {
      if (typeof recordingCaptureCleanup === 'function') recordingCaptureCleanup();
      recordingCaptureCleanup = null;
      stream.getTracks().forEach((track) => track.stop());
      cleanupRecordingAudioTap();
      clearRecordingDataInterval();
      setRecordingState(false);

      if (!recordingChunks.length) {
        if (statusEl) {
          statusEl.textContent = 'No recording data was captured.';
        }
        mediaRecorder = null;
        return;
      }

      const finalType = mediaRecorder?.mimeType || mimeType || 'video/webm';
      const extension = finalType.includes('mp4') ? 'mp4' : 'webm';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `lrc-concept-animation-${timestamp}.${extension}`;
      const blob = new Blob(recordingChunks, { type: finalType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      if (statusEl) {
        statusEl.textContent = `Recording downloaded: ${filename}`;
      }
      mediaRecorder = null;
    };

    setRecordingState(true);
    mediaRecorder.start(1000);
    recordingDataInterval = setInterval(() => {
      if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
      try {
        mediaRecorder.requestData();
      } catch (_) {
        // no-op
      }
    }, 1000);
    sequence.start(layers);

    if (statusEl) {
      statusEl.textContent = recordingHasAudioTrack
        ? 'Recording... press "Stop Recording" when done (audio included).'
        : 'Recording... press "Stop Recording" when done.';
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const layers = readLayerValues();
    sequence.start(layers);
  });

  resetBtn.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    }
    sequence.reset();
  });

  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      if (isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });
  }

  const syncFullscreenUi = () => {
    const isFullscreen = document.fullscreenElement === fullscreenTarget;
    if (appRoot) {
      appRoot.classList.toggle('is-fullscreen-recording', isFullscreen);
    }
    // Fullscreen transitions can complete before layout settles.
    // Force a couple of resize passes so canvas dimensions and center stay correct.
    sequence.scheduleResize();
    requestAnimationFrame(() => {
      sequence.scheduleResize();
    });
    setTimeout(() => {
      sequence.scheduleResize();
    }, 220);
    if (fullscreenBtn) {
      fullscreenBtn.textContent = isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen';
      fullscreenBtn.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
    }
  };

  if (fullscreenBtn && fullscreenTarget) {
    if (typeof fullscreenTarget.requestFullscreen !== 'function') {
      fullscreenBtn.disabled = true;
      fullscreenBtn.textContent = 'Fullscreen Unavailable';
    } else {
      fullscreenBtn.addEventListener('click', async () => {
        try {
          if (document.fullscreenElement === fullscreenTarget) {
            await document.exitFullscreen();
          } else {
            await fullscreenTarget.requestFullscreen();
          }
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = 'Could not toggle fullscreen. Continue in windowed mode.';
          }
        }
      });
      document.addEventListener('fullscreenchange', syncFullscreenUi);
      syncFullscreenUi();
    }
  }
});
