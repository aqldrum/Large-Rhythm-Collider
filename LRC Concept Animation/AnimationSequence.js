import { AnimationGeometry, COLORS, TAU, lerp, clamp } from './AnimationGeometry.js';
import { AnimationControls } from './AnimationControls.js';
import { AnimationPlayback } from './AnimationPlayback.js';
import { ScaleAnimation } from './ScaleAnimation.js';
import { FinalSlide } from './FinalSlide.js';

const LAYER_COLORS = [COLORS.layerA, COLORS.layerB, COLORS.layerC, COLORS.layerD];
const LAYER_NAMES = ['A', 'B', 'C', 'D'];

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

    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.renderIdle();
  }

  handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    this.geometry.resize(rect.width, rect.height);
    this.layout = this.computeLayout(rect.width, rect.height);
    if (!this.isPlaying) {
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
        return this.unrollEnd ?? this.totalDuration ?? 0;
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

    this.pauseStart = cursor;
    this.pauseEnd = cursor + 2;
    cursor = this.pauseEnd;

    this.unrollStart = cursor;
    this.unrollEnd = cursor + 4;
    cursor = this.unrollEnd;

    this.organizeStart = cursor;
    this.organizeEnd = cursor + 4.6;
    cursor = this.organizeEnd;

    this.waveStart = cursor;
    this.waveEnd = cursor + 3;
    cursor = this.waveEnd;

    this.ratioStart = cursor;
    const ratioSteps = Math.max(1, this.segmentRows.length);
    const ratioStepMs = ScaleAnimation.TRACE_MS
      + ScaleAnimation.TRACER_SUSTAIN_MS
      + ScaleAnimation.COLLAPSE_MS;
    const ratioDuration = (ratioSteps * ratioStepMs) / 1000;
    this.ratioEnd = cursor + ratioDuration;
    cursor = this.ratioEnd;

    this.octaveStart = cursor;
    const octaveGroups = this.scaleAnimation.octaveGroups?.length || 0;
    const leftoverCount = this.scaleAnimation.leftoverRows?.length || 0;
    const bracketDuration = octaveGroups > 0
      ? (octaveGroups * ScaleAnimation.BRACKET_MS) / 1000
      : 0;
    const leftoverDuration = leftoverCount > 0
      ? (ScaleAnimation.BRACKET_MS * 2) / 1000
      : 0;
    const octaveDuration = bracketDuration + leftoverDuration;
    this.octaveEnd = cursor + octaveDuration;
    cursor = this.octaveEnd;

    this.tableStart = cursor;
    const tableDuration = ScaleAnimation.TABLE_MS / 1000;
    this.tableEnd = cursor + tableDuration;
    cursor = this.tableEnd;

    this.tableMoveStart = cursor;
    const tableMoveDuration = ScaleAnimation.TABLE_MOVE_MS / 1000;
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
      this.unrollView = {
        scale: autoView.scale,
        translate: { ...autoView.translate }
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

    this.geometry.endFrame();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('animation-canvas');
  const statusEl = document.getElementById('status');
  const layerRows = Array.from(document.querySelectorAll('.layer-row'));
  const form = document.getElementById('rhythm-form');
  const resetBtn = document.getElementById('reset-btn');

  if (!canvas || !form) return;

  const sequence = new AnimationSequence(canvas, { statusEl, layerRows });
  new AnimationControls(sequence);
  new AnimationPlayback(sequence, canvas);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const layers = ['layer-a', 'layer-b', 'layer-c', 'layer-d'].map((id) => {
      const input = document.getElementById(id);
      return input ? parseInt(input.value, 10) : 0;
    });
    sequence.start(layers);
  });

  resetBtn.addEventListener('click', () => sequence.reset());
});
