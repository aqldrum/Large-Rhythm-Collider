import { TAU } from './AnimationGeometry.js';

const FUNDAMENTAL_MS = 1000;
const MARK_HIGHLIGHT_DECAY_MS = 300;
const TABLE_FLASH_DECAY_MS = 400;

export class FinalSlide {
  constructor(sequence) {
    this.sequence = sequence;
    this.active = false;
    this.startTime = 0;
    this.cycleMs = 0;
    this.baseCycleMs = 0;
    this.tempoScale = 1;
    this.cursorAngle = 0;
    this.lastCursorAngle = -1;

    this.boundaryAngles = [];
    this.boundaryToMarks = [];
    this.boundaryToSegment = [];
    this.boundaryToTableRow = [];

    this.markHighlights = new Map();
    this.tableHighlights = new Map();

    this.synth = null;
    this.output = null;
    this.baseFrequency = 220;

    this.lastTriggeredBoundary = -1;
    this.justStarted = false;
  }

  prepare() {
    const seq = this.sequence;
    const { lineLength } = seq.layout;
    const boundaries = seq.boundaries;
    const spacesPlot = seq.spacesPlotValues;
    const segments = seq.segments;
    const marks = seq.marks;

    if (!spacesPlot.length || !boundaries.length || !lineLength) return false;

    const grid = spacesPlot.reduce((sum, v) => sum + v, 0);
    if (!grid) return false;

    this.cycleMs = (grid / seq.fundamentalValue) * FUNDAMENTAL_MS;
    this.baseCycleMs = this.cycleMs;
    this.tempoScale = 1;

    this.boundaryAngles = boundaries.map((b) => (b / lineLength) * TAU);

    this.boundaryToMarks = [];
    this.boundaryToSegment = [];
    this.boundaryToTableRow = [];

    const epsilon = lineLength * 0.001;

    const indexToFraction = new Map();
    if (seq.spacesMapping && seq.spacesMapping.size) {
      seq.spacesMapping.forEach((indices, fraction) => {
        if (!Array.isArray(indices)) return;
        indices.forEach((idx) => {
          indexToFraction.set(idx, fraction);
        });
      });
    }

    for (let i = 0; i < boundaries.length - 1; i += 1) {
      const bPos = boundaries[i];
      const matching = [];
      marks.forEach((mark, markIdx) => {
        if (Math.abs(mark.arc - bPos) < epsilon) {
          matching.push(markIdx);
        }
      });
      this.boundaryToMarks.push(matching);
      this.boundaryToSegment.push(i);

      const fraction = indexToFraction.get(i);
      const mappedRow = fraction && seq.scaleRatioIndex ? seq.scaleRatioIndex.get(fraction) : undefined;
      if (mappedRow !== undefined) {
        this.boundaryToTableRow.push(mappedRow);
      } else {
        const seg = segments[i];
        this.boundaryToTableRow.push(seg ? seg.rowIndex : -1);
      }
    }

    return true;
  }

  ensureAudio() {
    if (!window.Tone) return false;
    if (!this.synth) {
      this.output = new window.Tone.Volume(-4).toDestination();
      this.synth = new window.Tone.PolySynth(window.Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: {
          attack: 0.005,
          decay: 0.25,
          sustain: Math.pow(10, -18 / 20),
          release: 0.4
        }
      }).connect(this.output);
    }
    return true;
  }

  async start() {
    if (!this.prepare()) return;
    if (!this.ensureAudio()) return;
    try { await window.Tone.start(); } catch (e) { /* ok */ }

    this.active = true;
    this.startTime = performance.now();
    this.cursorAngle = 0;
    this.lastCursorAngle = -1;
    this.lastTriggeredBoundary = -1;
    this.justStarted = true;
    this.markHighlights.clear();
    this.tableHighlights.clear();
  }

  stop() {
    this.active = false;
    this.markHighlights.clear();
    this.tableHighlights.clear();
    this.cursorAngle = 0;
    this.lastTriggeredBoundary = -1;
    this.lastCursorAngle = -1;
    this.tempoScale = 1;
    this.baseCycleMs = this.cycleMs || 0;
  }

  toggle() {
    if (this.active) {
      this.stop();
    } else {
      this.start();
    }
  }

  isActive() {
    return this.active;
  }

  tick(now) {
    if (!this.active) return;
    if (!Number.isFinite(this.cycleMs) || this.cycleMs <= 0) return;

    const elapsed = (now - this.startTime) % this.cycleMs;
    this.lastCursorAngle = this.cursorAngle;
    this.cursorAngle = (elapsed / this.cycleMs) * TAU;

    if (this.justStarted) {
      this.justStarted = false;
      this.cursorAngle = 0;
      this.lastCursorAngle = -1;
      this.triggerBoundary(0, now);
      return;
    }

    const numBoundaries = this.boundaryAngles.length - 1;

    for (let i = 0; i < numBoundaries; i += 1) {
      const bAngle = this.boundaryAngles[i];
      let crossed = false;

      if (this.lastCursorAngle < 0) {
        crossed = i === 0;
      } else if (this.lastCursorAngle <= this.cursorAngle) {
        crossed = this.lastCursorAngle < bAngle && this.cursorAngle >= bAngle;
      } else {
        crossed = this.lastCursorAngle < bAngle || this.cursorAngle >= bAngle;
      }

      if (crossed) {
        this.triggerBoundary(i, now);
      }
    }
  }

  adjustTempo(deltaY, now) {
    if (!this.active || !Number.isFinite(this.baseCycleMs) || this.baseCycleMs <= 0) return;
    const direction = deltaY > 0 ? 1 : -1;
    const step = 0.06;
    const nextScale = Math.min(10, Math.max(0.25, this.tempoScale * (1 + direction * step)));
    if (nextScale === this.tempoScale) return;
    const prevCycle = this.cycleMs;
    this.tempoScale = nextScale;
    this.cycleMs = this.baseCycleMs * this.tempoScale;
    if (Number.isFinite(prevCycle) && prevCycle > 0) {
      const progress = ((now - this.startTime) % prevCycle) / prevCycle;
      this.startTime = now - progress * this.cycleMs;
    }
  }

  triggerBoundary(boundaryIndex, now) {
    this.lastTriggeredBoundary = boundaryIndex;

    const markIndices = this.boundaryToMarks[boundaryIndex];
    if (markIndices) {
      markIndices.forEach((idx) => {
        this.markHighlights.set(idx, now);
      });
    }

    const tableRow = this.boundaryToTableRow[boundaryIndex];
    if (tableRow >= 0) {
      this.tableHighlights.set(tableRow, now);
    }

    this.playNote(boundaryIndex);
  }

  playNote(boundaryIndex) {
    if (!this.synth) return;
    const seq = this.sequence;
    const segIndex = this.boundaryToSegment[boundaryIndex];
    const segment = seq.segments[segIndex];
    if (!segment) return;

    const ratio = seq.fundamentalValue / segment.value;
    const frequency = this.baseFrequency * ratio;
    const maxFrequency = this.baseFrequency * 32;
    if (frequency > maxFrequency) return;

    this.synth.triggerAttackRelease(frequency, 0.5);
  }

  getCursorAngle() {
    return this.cursorAngle;
  }

  getHighlightAlpha(markIndex, now) {
    const timestamp = this.markHighlights.get(markIndex);
    if (timestamp === undefined) return 0;
    const age = now - timestamp;
    if (age > MARK_HIGHLIGHT_DECAY_MS) {
      this.markHighlights.delete(markIndex);
      return 0;
    }
    return 1 - (age / MARK_HIGHLIGHT_DECAY_MS);
  }

  getTableHighlights(now) {
    const highlights = [];
    this.tableHighlights.forEach((timestamp, rowIndex) => {
      const age = now - timestamp;
      if (age > TABLE_FLASH_DECAY_MS) {
        this.tableHighlights.delete(rowIndex);
        return;
      }
      highlights.push({ rowIndex, alpha: 1 - (age / TABLE_FLASH_DECAY_MS) });
    });
    return highlights;
  }
}
