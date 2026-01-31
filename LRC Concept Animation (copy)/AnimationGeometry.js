const TAU = Math.PI * 2;

const COLORS = {
  background: '#000000',
  white: '#ffffff',
  layerA: '#ff6b6b',
  layerB: '#4ecdc4',
  layerC: '#00a638',
  layerD: '#f9ca24'
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalize(vec) {
  const length = Math.hypot(vec.x, vec.y) || 1;
  return { x: vec.x / length, y: vec.y / length };
}

export class AnimationGeometry {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = window.devicePixelRatio || 1;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.floor(width * this.dpr);
    this.canvas.height = Math.floor(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.lineCap = 'round';
  }

  clear() {
    this.ctx.fillStyle = COLORS.background;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  beginFrame({ scale = 1, translate = { x: 0, y: 0 } } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(translate.x, translate.y);
    if (scale !== 1) ctx.scale(scale, scale);
  }

  endFrame() {
    this.ctx.restore();
  }

  drawCircle(center, radius, strokeStyle, lineWidth, alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, TAU);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  drawMorphPath({ center, radius, anchor, progress, samples, strokeStyle, lineWidth, alpha = 1, curveDepth = 0 }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    for (let i = 0; i <= samples; i += 1) {
      const theta = (i / samples) * TAU;
      const circleX = center.x + Math.sin(theta) * radius;
      const circleY = center.y - Math.cos(theta) * radius;
      const arc = (theta / TAU) * (TAU * radius);
      const lineX = anchor.x + arc;
      const lineY = anchor.y;
      const depth = curveDepth * (theta / TAU);
      const controlX = lerp(circleX, lineX, 0.5);
      const controlY = lerp(circleY, lineY, 0.5) + depth;
      const q1x = lerp(circleX, controlX, progress);
      const q1y = lerp(circleY, controlY, progress);
      const q2x = lerp(controlX, lineX, progress);
      const q2y = lerp(controlY, lineY, progress);
      const x = lerp(q1x, q2x, progress);
      const y = lerp(q1y, q2y, progress);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  drawUnrollPath({ center, radius, progress, samples, strokeStyle, lineWidth, alpha = 1 }) {
    const ctx = this.ctx;
    const length = TAU * radius;
    const t = clamp(progress, 0, 1);
    const arcLen = (1 - t) * length;
    const thetaEnd = arcLen / radius;
    const tangent = { x: Math.cos(thetaEnd), y: Math.sin(thetaEnd) };

    const circlePointAt = (theta) => ({
      x: center.x + Math.sin(theta) * radius,
      y: center.y - Math.cos(theta) * radius
    });

    const lineStart = circlePointAt(thetaEnd);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();

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

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  drawSplitLine({ anchor, boundaries, gap, scale, strokeStyle, lineWidth, alpha = 1 }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    const segments = boundaries.length - 1;
    for (let i = 0; i < segments; i += 1) {
      const start = (boundaries[i] + gap * i) * scale;
      const end = (boundaries[i + 1] + gap * i) * scale;
      ctx.moveTo(anchor.x + start, anchor.y);
      ctx.lineTo(anchor.x + end, anchor.y);
    }

    ctx.stroke();
    ctx.restore();
  }

  drawMark({ position, direction, length, color, progress, lineWidth, alpha = 1 }) {
    const ctx = this.ctx;
    const half = (length * 0.5) * clamp(progress, 0, 1);
    const dir = normalize(direction);

    const x1 = position.x - dir.x * half;
    const y1 = position.y - dir.y * half;
    const x2 = position.x + dir.x * half;
    const y2 = position.y + dir.y * half;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  fillDot({ position, radius, fillStyle = '#ffffff', alpha = 1 }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, TAU);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
  }

  drawQuadratic({ start, control, end, strokeStyle, lineWidth, alpha = 1, dash = null }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (dash) {
      ctx.setLineDash(dash);
    }
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  drawLine({ start, end, strokeStyle, lineWidth, alpha = 1 }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  drawFilledRect({ x, y, width, height, fillStyle, alpha = 1 }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fillStyle;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }

  drawTable({
    left, right, rowYs, dividerX,
    strokeStyle = '#ffffff', lineWidth = 1,
    borderAlpha = 0.35, separatorAlpha = 0.12,
    bgAlpha = 0.03, headerBgAlpha = 0.045, altRowAlpha = 0.02
  }) {
    const ctx = this.ctx;
    if (!rowYs || rowYs.length < 2) return;

    const top = rowYs[0];
    const bottom = rowYs[rowYs.length - 1];
    const width = right - left;
    const height = bottom - top;

    ctx.save();
    ctx.fillStyle = strokeStyle;

    ctx.globalAlpha = bgAlpha;
    ctx.fillRect(left, top, width, height);

    if (rowYs.length >= 2) {
      ctx.globalAlpha = headerBgAlpha;
      ctx.fillRect(left, top, width, rowYs[1] - top);
    }

    for (let i = 2; i < rowYs.length - 1; i += 1) {
      if (i % 2 === 0) {
        ctx.globalAlpha = altRowAlpha;
        const rowBot = (i + 1 < rowYs.length) ? rowYs[i + 1] : bottom;
        ctx.fillRect(left, rowYs[i], width, rowBot - rowYs[i]);
      }
    }

    ctx.restore();

    ctx.save();
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;

    ctx.globalAlpha = borderAlpha;
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    if (rowYs.length > 2) {
      ctx.moveTo(left, rowYs[1]);
      ctx.lineTo(right, rowYs[1]);
    }
    ctx.stroke();

    ctx.globalAlpha = separatorAlpha;
    ctx.beginPath();
    for (let i = 2; i < rowYs.length - 1; i += 1) {
      ctx.moveTo(left, rowYs[i]);
      ctx.lineTo(right, rowYs[i]);
    }
    if (dividerX !== undefined && Number.isFinite(dividerX)) {
      ctx.moveTo(dividerX, top);
      ctx.lineTo(dividerX, bottom);
    }
    ctx.stroke();

    ctx.restore();
  }

  drawText({ text, position, color = '#ffffff', font = '12px sans-serif', align = 'left', baseline = 'middle', alpha = 1 }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, position.x, position.y);
    ctx.restore();
  }

  drawSine({ start, length, baselineY, amplitude, period, strokeStyle, lineWidth, alpha = 1 }) {
    const ctx = this.ctx;
    if (period <= 0 || length <= 0) return;
    const cycles = Math.max(1, length / period);
    const pointsPerCycle = 48;
    const samples = Math.max(64, Math.floor(cycles * pointsPerCycle), Math.floor(length / 2));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const x = start.x + t * length;
      const phase = (t * length / period) * TAU;
      const y = baselineY - Math.sin(phase) * amplitude;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  drawRadialLine({ center, direction, length, color, progress, lineWidth, alpha = 1 }) {
    const ctx = this.ctx;
    const dir = normalize(direction);
    const scaled = length * clamp(progress, 0, 1);

    const x2 = center.x + dir.x * scaled;
    const y2 = center.y + dir.y * scaled;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  lerp(a, b, t) {
    return lerp(a, b, t);
  }
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
  if (!a || !b) return 0;
  return Math.abs(a * b) / gcd(a, b);
}

export { COLORS, TAU, lerp, clamp, gcd, lcm };
