import { lcm, gcd, lerp } from './AnimationGeometry.js';

export class ScaleAnimation {
  constructor() {
    this.order = [];
    this.ratioMap = new Map();
    this.octaveGroups = [];
    this.leftoverRows = [];
  }

  static TRACE_MS = 100;
  static COLLAPSE_MS = 100;
  static TRACER_SUSTAIN_MS = 200;
  static BRACKET_MS = 500;
  static TABLE_MS = 2400;
  static TABLE_MOVE_MS = 900;

  setRatios(rows, fundamentalValue) {
    this.order = [];
    this.ratioMap.clear();
    this.octaveGroups = [];
    this.leftoverRows = [];
    const fundamentalRow = rows.find((row) => row.value === fundamentalValue);
    const fundamentalRowIndex = fundamentalRow ? fundamentalRow.rowIndex : null;

    rows.forEach((row) => {
      const lcmValue = lcm(fundamentalValue, row.value);
      const segmentRepeats = lcmValue / row.value;
      const fundamentalRepeats = lcmValue / fundamentalValue;
      this.ratioMap.set(row.rowIndex, {
        lcmValue,
        segmentRepeats,
        fundamentalRepeats,
        text: `${segmentRepeats}/${fundamentalRepeats}`
      });
    });

    const sortedByDenominator = [...rows]
      .filter((row) => row.rowIndex !== fundamentalRowIndex)
      .sort((a, b) => {
        const ra = this.ratioMap.get(a.rowIndex);
        const rb = this.ratioMap.get(b.rowIndex);
        return (ra?.fundamentalRepeats || 0) - (rb?.fundamentalRepeats || 0);
      })
      .map((row) => row.rowIndex);

    if (fundamentalRowIndex !== null) {
      this.order = [fundamentalRowIndex, ...sortedByDenominator];
    } else {
      this.order = sortedByDenominator;
    }

    const octaveGroups = new Map();
    const isPowerOfTwo = (value) => Number.isFinite(value)
      && value > 0
      && Math.abs(value - Math.round(value)) < 1e-6
      && ((Math.round(value) & (Math.round(value) - 1)) === 0);
    rows.forEach((row) => {
      const ratio = this.ratioMap.get(row.rowIndex);
      if (!ratio) return;
      const numerator = ratio.segmentRepeats;
      const denom = ratio.fundamentalRepeats;
      let reduced = denom;
      while (reduced % 2 === 0) {
        reduced /= 2;
      }
      const key = `${numerator}|${reduced}`;
      if (!octaveGroups.has(key)) {
        octaveGroups.set(key, {
          numerator,
          reducedDenominator: reduced,
          members: []
        });
      }
      octaveGroups.get(key).members.push({
        rowIndex: row.rowIndex,
        numerator,
        denominator: denom
      });
    });

    const fundamentalMembers = [];
    const absorbedKeys = new Set();
    const entries = Array.from(octaveGroups.entries());
    entries.forEach(([key, group]) => {
      if (group.reducedDenominator === 1 && isPowerOfTwo(group.numerator)) {
        group.members.forEach((member) => fundamentalMembers.push(member));
        absorbedKeys.add(key);
      }
    });

    const groupList = entries
      .filter(([key, group]) => !absorbedKeys.has(key) && group.members.length > 1)
      .map(([, group]) => group);

    if (fundamentalMembers.length > 1) {
      groupList.push({
        numerator: 1,
        reducedDenominator: 1,
        members: fundamentalMembers,
        octaveText: '1/1',
        isFundamental: true
      });
    }

    groupList.forEach((group) => {
      if (group.isFundamental) return;
      let denom = group.reducedDenominator;
      if (denom <= 0) {
        group.octaveText = `${group.numerator}/${group.reducedDenominator}`;
        return;
      }
      while (group.numerator / denom > 2) {
        denom *= 2;
      }
      if (group.numerator / denom < 1 && denom > group.reducedDenominator) {
        denom /= 2;
      }
      group.octaveText = `${group.numerator}/${denom}`;
    });

    groupList.sort((a, b) => {
      if (b.members.length !== a.members.length) {
        return b.members.length - a.members.length;
      }
      return a.numerator - b.numerator;
    });

    this.octaveGroups = groupList;

    const groupedRows = new Set();
    this.octaveGroups.forEach((group) => {
      group.members.forEach((member) => groupedRows.add(member.rowIndex));
    });

    this.leftoverRows = rows
      .filter((row) => {
        if (groupedRows.has(row.rowIndex)) return false;
        const ratio = this.ratioMap.get(row.rowIndex);
        if (!ratio) return false;
        return ratio.segmentRepeats / ratio.fundamentalRepeats > 2;
      })
      .map((row) => row.rowIndex);
  }

  render({
    geometry,
    rows,
    fundamentalRowIndex,
    progress,
    elapsedMs,
    lineWidth,
    fontSize = 11,
    textColor = '#ffffff',
    dimAlpha = 0.25,
    showOctaveCollapse = false,
    octaveElapsedMs = 0,
    tableProgress = 0,
    tableMoveProgress = 0,
    tableLayout = null,
    viewScale = 1,
    viewTranslate = { x: 0, y: 0 },
    tableHighlights = []
  }) {
    if (!rows.length || !this.order.length) return;

    const baseFont = `${fontSize}px "Space Grotesk", sans-serif`;
    const stepCount = this.order.length;
    const traceMs = ScaleAnimation.TRACE_MS;
    const sustainMs = ScaleAnimation.TRACER_SUSTAIN_MS;
    const collapseMs = ScaleAnimation.COLLAPSE_MS;
    const stepMs = traceMs + sustainMs + collapseMs;
    const totalMs = stepMs * stepCount;
    const effectiveElapsedMs = elapsedMs !== undefined && elapsedMs !== null
      ? Math.min(Math.max(elapsedMs, 0), totalMs)
      : Math.min(Math.max((progress || 0) * totalMs, 0), totalMs);
    const activeStep = Math.min(stepCount - 1, Math.floor(effectiveElapsedMs / stepMs));
    const stepElapsed = effectiveElapsedMs - activeStep * stepMs;
    const traceProgress = Math.min(stepElapsed / traceMs, 1);
    const collapseProgress = stepElapsed > traceMs + sustainMs
      ? Math.min((stepElapsed - traceMs - sustainMs) / collapseMs, 1)
      : 0;
    const tracerHold = stepElapsed >= traceMs;
    const tracerAlpha = tracerHold
      ? (stepElapsed <= traceMs + sustainMs ? 1 : 1 - collapseProgress)
      : 0;

    const activeRowIndex = this.order[activeStep];

    const tableFade = tableProgress > 0 ? Math.max(0, 1 - tableProgress) : 1;
    const sourcePositions = tableLayout ? new Map() : null;
    const worldToScreen = (point) => ({
      x: point.x * viewScale + viewTranslate.x,
      y: point.y * viewScale + viewTranslate.y
    });

    const collapseRatio = (numerator, denominator) => {
      let num = numerator;
      let den = denominator;
      if (den === 0) {
        return { num, den, text: `${num}/${den}` };
      }
      while (num / den > 2) {
        den *= 2;
      }
      const divisor = gcd(Math.round(num), Math.round(den));
      if (divisor) {
        num /= divisor;
        den /= divisor;
      }
      return { num, den, text: `${num}/${den}` };
    };

    rows.forEach((row) => {
      const ratio = this.ratioMap.get(row.rowIndex);
      const isActive = row.rowIndex === activeRowIndex;
      const rowOrderIndex = this.order.indexOf(row.rowIndex);
      const isComplete = rowOrderIndex < activeStep;
      const isUpcoming = rowOrderIndex > activeStep;

      const baseAlpha = (isActive ? 1 : (isUpcoming ? dimAlpha : 1)) * tableFade;
      const collapseAmount = isActive ? collapseProgress : (isComplete ? 1 : 0);
      let rowLength = row.repeatedLength;
      if (isComplete) rowLength = row.singleLength;
      if (isActive) {
        const tracedLength = row.lcmWorld * traceProgress;
        rowLength = tracedLength;
        if (collapseProgress > 0) {
          rowLength = row.lcmWorld + (row.singleLength - row.lcmWorld) * collapseProgress;
        }
      }

      geometry.drawLine({
        start: row.startWorld,
        end: { x: row.startWorld.x + rowLength, y: row.startWorld.y },
        strokeStyle: textColor,
        lineWidth,
        alpha: baseAlpha
      });

      if (row.tickMarks && row.tickMarks.length) {
        const tickAlpha = baseAlpha * (1 - collapseAmount) * (isActive ? 1 : 0.85);
        row.tickMarks.forEach((tick) => {
          if (isActive && tick.position.x > row.startWorld.x + row.lcmWorld + 0.001) return;
          if (isActive && tick.position.x > row.startWorld.x + rowLength + 0.001) return;
          geometry.drawMark({
            position: tick.position,
            direction: { x: 0, y: -1 },
            length: tick.length,
            color: textColor,
            progress: 1,
            lineWidth: tick.lineWidth,
            alpha: tickAlpha
          });
        });
      }

      if (ratio && (isComplete || isActive)) {
        const textAlpha = (isComplete
          ? 1
          : Math.min(Math.max((traceProgress - 0.7) / 0.3, 0), 1)) * tableFade;
        const finalTextPos = {
          x: row.startWorld.x + row.singleLength + row.labelOffset,
          y: row.startWorld.y + row.labelOffset * 0.15
        };
        const tracerX = row.startWorld.x + row.lcmWorld;
        const lcmTextPos = {
          x: tracerX + row.labelOffset * 0.6,
          y: row.startWorld.y + row.labelOffset * 0.15
        };
        const settle = isActive ? collapseProgress : 1;
        const textPos = {
          x: lcmTextPos.x + (finalTextPos.x - lcmTextPos.x) * settle,
          y: lcmTextPos.y + (finalTextPos.y - lcmTextPos.y) * settle
        };
        geometry.drawText({
          text: ratio.text,
          position: textPos,
          color: textColor,
          font: baseFont,
          align: 'left',
          baseline: 'middle',
          alpha: textAlpha
        });

        if (sourcePositions && ratio) {
          const ratioValue = ratio.segmentRepeats / ratio.fundamentalRepeats;
          if (ratioValue >= 1 && ratioValue <= 2) {
            const collapsed = collapseRatio(ratio.segmentRepeats, ratio.fundamentalRepeats);
            if (!sourcePositions.has(collapsed.text)) {
              sourcePositions.set(collapsed.text, finalTextPos);
            }
          }
        }
      }

      if (isActive && ratio) {
        const tracerOpacity = tracerAlpha * tableFade;
        if (tracerOpacity > 0) {
          const tracerX = row.startWorld.x + row.lcmWorld;
          const targetRow = rows.find((item) => item.rowIndex === fundamentalRowIndex);
          if (targetRow) {
            geometry.drawLine({
              start: { x: tracerX, y: row.startWorld.y },
              end: { x: tracerX, y: targetRow.startWorld.y },
              strokeStyle: textColor,
              lineWidth: Math.max(1, lineWidth * 0.7),
              alpha: tracerOpacity * baseAlpha
            });

            geometry.drawLine({
              start: targetRow.startWorld,
              end: { x: tracerX, y: targetRow.startWorld.y },
              strokeStyle: textColor,
              lineWidth,
              alpha: tracerOpacity * baseAlpha
            });
          }
        }
      }
    });

    if (showOctaveCollapse && this.octaveGroups.length) {
      const rowMap = new Map(rows.map((row) => [row.rowIndex, row]));
      const fontSpec = baseFont;
      let maxTextRight = -Infinity;
      if (geometry.ctx) {
        geometry.ctx.save();
        geometry.ctx.font = fontSpec;
        rows.forEach((row) => {
          const ratio = this.ratioMap.get(row.rowIndex);
          if (!ratio) return;
          const textPosX = row.startWorld.x + row.singleLength + row.labelOffset;
          const metrics = geometry.ctx.measureText(ratio.text);
          maxTextRight = Math.max(maxTextRight, textPosX + metrics.width);
        });
        geometry.ctx.restore();
      }
      if (!Number.isFinite(maxTextRight)) {
        maxTextRight = Math.max(...rows.map((row) => row.startWorld.x + row.singleLength + row.labelOffset));
      }
      const columnGap = Math.max(18, rows[0].labelOffset * 1.4);
      const capSize = Math.max(6, lineWidth * 3);
      const bracketMs = ScaleAnimation.BRACKET_MS;
      const totalBracketMs = bracketMs * this.octaveGroups.length;
      const elapsed = Math.min(Math.max(octaveElapsedMs, 0), totalBracketMs);

      let bracketRight = maxTextRight;
      const bracketXs = [];
      if (geometry.ctx) {
        geometry.ctx.save();
        geometry.ctx.font = fontSpec;
        let cursorX = maxTextRight + capSize;
        this.octaveGroups.forEach((group) => {
          const width = geometry.ctx.measureText(group.octaveText || '').width;
          const columnWidth = Math.max(columnGap, capSize * 1.4 + width + capSize);
          bracketXs.push(cursorX);
          cursorX += columnWidth;
        });
        bracketRight = cursorX;
        geometry.ctx.restore();
      }

      this.octaveGroups.forEach((group, index) => {
        const memberRows = group.members
          .map((member) => rowMap.get(member.rowIndex))
          .filter(Boolean);
        if (memberRows.length < 2) return;
        const localProgress = bracketMs > 0
          ? Math.min(Math.max((elapsed - index * bracketMs) / bracketMs, 0), 1)
          : 1;
        if (localProgress <= 0) return;
        const smooth = localProgress * localProgress * (3 - 2 * localProgress);
        const ys = memberRows.map((row) => row.startWorld.y + row.labelOffset * 0.15);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const bracketX = bracketXs[index] ?? (maxTextRight + capSize + columnGap * index);
        const midY = (minY + maxY) / 2;
        const halfSpan = (maxY - minY) * 0.5 * smooth;
        const topY = midY - halfSpan;
        const bottomY = midY + halfSpan;
        const capLen = capSize * smooth;
        const alpha = smooth * tableFade;
        const notchLen = capSize * 0.55 * smooth;

        geometry.drawLine({
          start: { x: bracketX, y: topY },
          end: { x: bracketX, y: bottomY },
          strokeStyle: textColor,
          lineWidth,
          alpha
        });
        geometry.drawLine({
          start: { x: bracketX, y: topY },
          end: { x: bracketX - capLen, y: topY },
          strokeStyle: textColor,
          lineWidth,
          alpha
        });
        geometry.drawLine({
          start: { x: bracketX, y: bottomY },
          end: { x: bracketX - capLen, y: bottomY },
          strokeStyle: textColor,
          lineWidth,
          alpha
        });

        ys.forEach((y) => {
          geometry.drawLine({
            start: { x: bracketX, y },
            end: { x: bracketX - notchLen, y },
            strokeStyle: textColor,
            lineWidth,
            alpha
          });
        });

        geometry.drawText({
          text: group.octaveText,
          position: { x: bracketX + capSize * 1.4, y: midY },
          color: textColor,
          font: fontSpec,
          align: 'left',
          baseline: 'middle',
          alpha
        });

        if (sourcePositions && group.octaveText) {
          const labelPos = { x: bracketX + capSize * 1.4, y: midY };
          if (!sourcePositions.has(group.octaveText)) {
            sourcePositions.set(group.octaveText, labelPos);
          }
        }
      });

      if (this.leftoverRows.length) {
        const totalLeftoverMs = bracketMs * 2;
        const leftoverElapsed = Math.min(Math.max(octaveElapsedMs - totalBracketMs, 0), totalLeftoverMs);
        if (leftoverElapsed > 0) {
          const drawProgress = bracketMs > 0
            ? Math.min(Math.max(leftoverElapsed / bracketMs, 0), 1)
            : 1;
          const flipProgress = bracketMs > 0
            ? Math.min(Math.max((leftoverElapsed - bracketMs) / bracketMs, 0), 1)
            : 1;
          const smooth = drawProgress * drawProgress * (3 - 2 * drawProgress);
          const lineStartX = bracketRight + columnGap * 0.4;
          const lineLen = Math.max(capSize * 1.6, columnGap * 0.6);
          const lineEndX = lineStartX + lineLen * smooth;

          rows.forEach((row) => {
            if (!this.leftoverRows.includes(row.rowIndex)) return;
            const ratio = this.ratioMap.get(row.rowIndex);
            if (!ratio) return;
            const y = row.startWorld.y + row.labelOffset * 0.15;
            geometry.drawLine({
              start: { x: lineStartX, y },
              end: { x: lineEndX, y },
              strokeStyle: textColor,
              lineWidth,
              alpha: tableFade
            });
            const rawText = `${ratio.segmentRepeats}/${ratio.fundamentalRepeats}`;
            const collapsed = collapseRatio(ratio.segmentRepeats, ratio.fundamentalRepeats);
            const simplifiedText = collapsed.text;
            geometry.drawText({
              text: rawText,
              position: { x: lineEndX + capSize * 0.35, y },
              color: textColor,
              font: fontSpec,
              align: 'left',
              baseline: 'middle',
              alpha: (1 - flipProgress) * tableFade
            });
            geometry.drawText({
              text: simplifiedText,
              position: { x: lineEndX + capSize * 0.35, y },
              color: textColor,
              font: fontSpec,
              align: 'left',
              baseline: 'middle',
              alpha: flipProgress * tableFade
            });

            if (sourcePositions && simplifiedText) {
              const labelPos = { x: lineEndX + capSize * 0.35, y };
              if (!sourcePositions.has(simplifiedText)) {
                sourcePositions.set(simplifiedText, labelPos);
              }
            }
          });
        }
      }
    }

    if (tableLayout && (tableProgress > 0 || tableMoveProgress > 0)) {
      const fontFamily = tableLayout.fontFamily || 'monospace';
      const fontBody = `${(tableLayout.fontBodySize || 10) / viewScale}px ${fontFamily}`;
      const fontHeader = `bold ${(tableLayout.fontHeaderSize || 9) / viewScale}px ${fontFamily}`;
      const entries = tableLayout.rows || [];
      if (entries.length) {
        const totalTableMs = ScaleAnimation.TABLE_MS;
        const elapsedTableMs = Math.min(Math.max(tableProgress, 0), 1) * totalTableMs;
        const perMs = entries.length > 0 ? totalTableMs / entries.length : totalTableMs;
        const moveProgress = Math.min(Math.max(tableMoveProgress, 0), 1);

        const lerpPoint = (a, b, t) => ({
          x: lerp(a.x, b.x, t),
          y: lerp(a.y, b.y, t)
        });

        const ordered = entries
          .map((entry) => {
            const start = sourcePositions?.get(entry.fraction) || entry.ratioRight;
            const startScreen = worldToScreen(start);
            const targetScreen = entry.ratioRightScreen
              ? entry.ratioRightScreen
              : worldToScreen(entry.ratioRight);
            const dist = Math.hypot(startScreen.x - targetScreen.x, startScreen.y - targetScreen.y);
            return { entry, start, dist };
          })
          .sort((a, b) => a.dist - b.dist);

        const headerAlpha = Math.min(1, Math.max(tableProgress, tableMoveProgress) * 2);
        const borderColor = 'rgba(100, 100, 100, 0.3)';
        const headerColor = '#00ff88';
        if (tableLayout.boundsRight && tableLayout.boundsLeft) {
          const lerpValue = (a, b, t) => a + (b - a) * t;
          const top = lerpValue(tableLayout.boundsRight.top, tableLayout.boundsLeft.top, moveProgress);
          const left = lerpValue(tableLayout.boundsRight.left, tableLayout.boundsLeft.left, moveProgress);
          const right = lerpValue(tableLayout.boundsRight.right, tableLayout.boundsLeft.right, moveProgress);
          const divider = lerpValue(tableLayout.boundsRight.divider, tableLayout.boundsLeft.divider, moveProgress);
          const rowYs = tableLayout.boundsRight.rowYs && tableLayout.boundsLeft.rowYs
            ? tableLayout.boundsRight.rowYs.map((y, idx) => lerpValue(y, tableLayout.boundsLeft.rowYs[idx] ?? y, moveProgress))
            : [];

          geometry.drawTable({
            left, right, rowYs,
            dividerX: Number.isFinite(divider) ? divider : undefined,
            strokeStyle: borderColor,
            lineWidth,
            borderAlpha: headerAlpha * 0.9,
            separatorAlpha: headerAlpha * 0.45,
            bgAlpha: headerAlpha * 0.3,
            headerBgAlpha: headerAlpha * 0.7,
            altRowAlpha: headerAlpha * 0.18
          });

          if (tableHighlights && tableHighlights.length) {
            tableHighlights.forEach(({ rowIndex, alpha }) => {
              if (rowYs.length <= rowIndex + 2) return;
              const hlTop = rowYs[rowIndex + 1];
              const hlBottom = rowYs[rowIndex + 2];
              geometry.drawFilledRect({
                x: left,
                y: hlTop,
                width: right - left,
                height: hlBottom - hlTop,
                fillStyle: '#00ff64',
                alpha: alpha * 0.18
              });
            });
          }

          const tableCenterX = (left + right) / 2;
          const titleOffset = (tableLayout.fontSize || 13) * 1.4 / viewScale;
          geometry.drawText({
            text: `${entries.length}-Tone Scale`,
            position: { x: tableCenterX, y: top - titleOffset },
            color: textColor,
            font: fontHeader,
            align: 'center',
            baseline: 'middle',
            alpha: headerAlpha
          });
        }
        const headerRatioPos = lerpPoint(tableLayout.header.ratioRight, tableLayout.header.ratioLeft, moveProgress);
        const headerCentsPos = lerpPoint(tableLayout.header.centsRight, tableLayout.header.centsLeft, moveProgress);

        geometry.drawText({
          text: 'Ratio',
          position: headerRatioPos,
          color: headerColor,
          font: fontHeader,
          align: 'left',
          baseline: 'middle',
          alpha: headerAlpha
        });
        geometry.drawText({
          text: 'Cents',
          position: headerCentsPos,
          color: headerColor,
          font: fontHeader,
          align: 'left',
          baseline: 'middle',
          alpha: headerAlpha
        });

        ordered.forEach((item, index) => {
          const localStart = index * perMs;
          const local = perMs > 0
            ? Math.min(Math.max((elapsedTableMs - localStart) / perMs, 0), 1)
            : 1;
          const smooth = local * local * (3 - 2 * local);
          const entry = item.entry;
          const targetRatio = lerpPoint(entry.ratioRight, entry.ratioLeft, moveProgress);
          const targetCents = lerpPoint(entry.centsRight, entry.centsLeft, moveProgress);
          const currentRatio = lerpPoint(item.start, targetRatio, smooth);
          const ratioAlpha = smooth;
          const centsAlpha = smooth;

          geometry.drawText({
            text: entry.fraction,
            position: currentRatio,
            color: textColor,
            font: fontBody,
            align: 'left',
            baseline: 'middle',
            alpha: ratioAlpha
          });

          if (centsAlpha > 0) {
            geometry.drawText({
              text: entry.centsText,
              position: targetCents,
              color: textColor,
              font: fontBody,
              align: 'left',
              baseline: 'middle',
              alpha: centsAlpha
            });
          }
        });
      }
    }
  }
}
