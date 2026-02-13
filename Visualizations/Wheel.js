// Wheel.js - Large Rhythm Collider Wheel Visualization
// Renders composite rhythm nodes on a circular grid with optional layer slices

class LRCWheel {
    constructor(lrcVisuals) {
        this.visuals = lrcVisuals;
        this.canvas = lrcVisuals ? lrcVisuals.canvas : null;
        this.ctx = lrcVisuals ? lrcVisuals.ctx : null;

        this.spacesPlot = [];
        this.compositeRhythm = [];
        this.layerMap = [];
        this.rhythms = [1, 1, 1, 1];
        this.grid = 0;

        this.slicesEnabled = false;
        this.hiddenSpacesIndices = new Set();

        this.nodeAngles = [];
        this.sliceAngles = [];
        this.layerPulseIndices = {
            A: [],
            B: [],
            C: [],
            D: []
        };

        this.highlightDecayMs = 300;
        this.highlightTimes = new Map();
        this.cursorAngle = 0;
        this.lastCursorAngle = -1;

        this.isAnimating = false;
        this.animationId = null;
        this.cycleDurationMs = 10000;
        this.startTime = 0;
        this.lastPhaseMs = 0;

        this.handleScaleVisibilityChange = (e) => {
            const indices = e?.detail?.hiddenSpacesIndices;
            this.setHiddenSpacesIndices(indices);
            if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'wheel') {
                this.draw();
            }
        };

        window.addEventListener('spacesPlotVisibilityChanged', this.handleScaleVisibilityChange);

        console.log('Wheel visualization initialized');
    }

    updateData({ spacesPlot, compositeRhythm, layerMap, rhythms, grid } = {}) {
        this.spacesPlot = spacesPlot || this.spacesPlot || [];
        this.compositeRhythm = compositeRhythm || this.compositeRhythm || [];
        this.layerMap = layerMap || this.layerMap || [];
        this.rhythms = rhythms || this.rhythms || [1, 1, 1, 1];
        this.grid = grid || this.grid || 0;

        this.rebuildGeometry();
    }

    setSlicesEnabled(enabled) {
        this.slicesEnabled = Boolean(enabled);
    }

    setHiddenSpacesIndices(indices) {
        const safe = Array.isArray(indices) ? indices : [];
        this.hiddenSpacesIndices = new Set(safe);
    }

    setCycleDurationSeconds(seconds) {
        if (Number.isFinite(seconds) && seconds > 0) {
            this.cycleDurationMs = seconds * 1000;
        }
    }

    setCycleDurationMs(ms) {
        if (Number.isFinite(ms) && ms > 0) {
            this.cycleDurationMs = ms;
        }
    }

    setPhase(cycleDurationMs, phaseMs = 0) {
        if (Number.isFinite(cycleDurationMs) && cycleDurationMs > 0) {
            this.cycleDurationMs = cycleDurationMs;
        }
        if (Number.isFinite(phaseMs)) {
            this.lastPhaseMs = phaseMs;
        }
        if (this.isAnimating) {
            this.startTime = performance.now() - this.lastPhaseMs;
        }
    }

    startAnimation() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.startTime = performance.now() - (this.lastPhaseMs || 0);
        this.animate();
    }

    stopAnimation() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.startTime) {
            const elapsed = (performance.now() - this.startTime) % this.cycleDurationMs;
            this.lastPhaseMs = Number.isFinite(elapsed) ? elapsed : 0;
        }
        this.cursorAngle = 0;
        this.lastCursorAngle = -1;
        this.highlightTimes.clear();
        this.draw();
    }

    resetPlaybackState() {
        this.lastPhaseMs = 0;
        this.startTime = 0;
        this.isAnimating = false;
        this.cursorAngle = 0;
        this.lastCursorAngle = -1;
        this.highlightTimes.clear();
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.draw();
    }

    animate() {
        if (!this.isAnimating) return;

        const now = performance.now();
        const elapsed = (now - this.startTime) % this.cycleDurationMs;
        this.lastPhaseMs = elapsed;

        this.updateCursorAndHighlights(elapsed, now);
        this.draw(elapsed, now);

        this.animationId = requestAnimationFrame(() => this.animate());
    }

    rebuildGeometry() {
        const compositePositions = this.getCompositePositions();
        const effectiveGrid = this.getEffectiveGrid(compositePositions);

        this.nodeAngles = [];
        this.sliceAngles = [];

        this.layerPulseIndices = {
            A: [],
            B: [],
            C: [],
            D: []
        };

        if (compositePositions.length === 0 || effectiveGrid <= 0) return;

        const angleOffset = 0;

        compositePositions.forEach((position, index) => {
            const angle = angleOffset + (position / effectiveGrid) * Math.PI * 2;
            this.nodeAngles[index] = angle;

            const layers = this.layerMap[index] || [];
            layers.forEach((layer) => {
                if (this.layerPulseIndices[layer]) {
                    this.layerPulseIndices[layer].push(index);
                }
            });
        });

        for (let i = 0; i < compositePositions.length; i++) {
            const startPos = compositePositions[i];
            const nextPos = i < compositePositions.length - 1
                ? compositePositions[i + 1]
                : compositePositions[0] + effectiveGrid;

            const startAngle = angleOffset + (startPos / effectiveGrid) * Math.PI * 2;
            let endAngle = angleOffset + (nextPos / effectiveGrid) * Math.PI * 2;

            if (endAngle < startAngle) {
                endAngle += Math.PI * 2;
            }

            this.sliceAngles[i] = {
                startAngle,
                endAngle
            };
        }
    }

    getCompositePositions() {
        if (this.compositeRhythm && this.compositeRhythm.length > 0) {
            return [...this.compositeRhythm];
        }

        if (this.spacesPlot && this.spacesPlot.length > 0) {
            const positions = [0];
            let acc = 0;
            for (let i = 0; i < this.spacesPlot.length - 1; i++) {
                acc += this.spacesPlot[i];
                positions.push(acc);
            }
            return positions;
        }

        return [];
    }

    getEffectiveGrid(compositePositions) {
        if (Number.isFinite(this.grid) && this.grid > 0) {
            return this.grid;
        }
        if (compositePositions.length > 0) {
            return compositePositions.length;
        }
        return 0;
    }

    draw(elapsedInCycle = null, now = null) {
        if (!this.ctx || !this.canvas) return;

        this.drawBase();

        if (elapsedInCycle !== null && Number.isFinite(elapsedInCycle)) {
            this.drawPlayhead(elapsedInCycle);
            this.drawLayerHighlights(elapsedInCycle, now);
        }
    }

    drawBase() {
        if (this.visuals && this.visuals.clearCanvas) {
            this.visuals.clearCanvas();
        } else {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        const metrics = this.getCanvasMetrics();
        if (!metrics) return;

        const { width, height, centerX, centerY, outerRadius, lineWidth, markLength } = metrics;
        if (width <= 0 || height <= 0) return;
        if (outerRadius <= 0) return;

        // Outer ring represents the grid
        this.ctx.lineCap = 'round';
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = lineWidth;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        this.ctx.stroke();

        if (!this.nodeAngles.length) return;

        if (this.slicesEnabled) {
            this.drawSlices(centerX, centerY, outerRadius);
        }

        this.drawMarks(centerX, centerY, outerRadius, markLength, lineWidth);
    }

    drawMarks(centerX, centerY, outerRadius, markLength, lineWidth) {
        const baseLength = Math.max(10, markLength || outerRadius * 0.08);
        const half = baseLength * 0.5;

        for (let i = 0; i < this.nodeAngles.length; i++) {
            const layers = this.layerMap[i] || [];
            if (!this.shouldShowNode(layers)) continue;

            const angle = this.nodeAngles[i];
            const isHidden = this.hiddenSpacesIndices.has(i);

            const baseColor = this.getNodeColor(layers);
            const color = isHidden ? this.getHiddenColor(baseColor) : baseColor;
            const tickLength = isHidden ? baseLength * 0.6 : baseLength;
            const halfLength = tickLength * 0.5;

            const radialX = Math.sin(angle);
            const radialY = -Math.cos(angle);
            const startRadius = outerRadius - halfLength;
            const endRadius = outerRadius + halfLength;

            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = lineWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(
                centerX + radialX * startRadius,
                centerY + radialY * startRadius
            );
            this.ctx.lineTo(
                centerX + radialX * endRadius,
                centerY + radialY * endRadius
            );
            this.ctx.stroke();
        }
    }

    drawSlices(centerX, centerY, outerRadius) {
        for (let i = 0; i < this.sliceAngles.length; i++) {
            const layers = this.layerMap[i] || [];
            if (!this.shouldShowNode(layers)) continue;

            const slice = this.sliceAngles[i];
            if (!slice) continue;

            const isHidden = this.hiddenSpacesIndices.has(i);
            const baseColor = this.getNodeColor(layers);
            const alpha = isHidden ? 0.1 : 0.99;
            const fillColor = this.applyAlpha(baseColor, alpha);

            const startCanvas = slice.startAngle - Math.PI / 2;
            const endCanvas = slice.endAngle - Math.PI / 2;

            this.ctx.fillStyle = fillColor;
            this.ctx.beginPath();
            this.ctx.moveTo(centerX, centerY);
            this.ctx.arc(centerX, centerY, outerRadius - 1, startCanvas, endCanvas);
            this.ctx.lineTo(centerX, centerY);
            this.ctx.closePath();
            this.ctx.fill();
        }
    }

    drawPlayhead(elapsedInCycle) {
        const metrics = this.getCanvasMetrics();
        if (!metrics || this.cycleDurationMs <= 0) return;

        const progress = (elapsedInCycle % this.cycleDurationMs) / this.cycleDurationMs;
        const angle = progress * Math.PI * 2;

        const { centerX, centerY, outerRadius, markLength, lineWidth } = metrics;
        const radialX = Math.sin(angle);
        const radialY = -Math.cos(angle);
        const cursorRadius = outerRadius;
        const dotRadius = Math.max(3, (markLength || 10) * 0.35);

        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(
            centerX + radialX * cursorRadius,
            centerY + radialY * cursorRadius,
            dotRadius,
            0,
            Math.PI * 2
        );
        this.ctx.fill();
    }

    drawLayerHighlights(elapsedInCycle, now = null) {
        if (this.cycleDurationMs <= 0) return;

        const metrics = this.getCanvasMetrics();
        if (!metrics) return;

        const { centerX, centerY, outerRadius, markLength, lineWidth } = metrics;
        const progress = (elapsedInCycle % this.cycleDurationMs) / this.cycleDurationMs;
        const timeNow = Number.isFinite(now) ? now : performance.now();

        const layerNames = ['A', 'B', 'C', 'D'];

        layerNames.forEach((layer, layerIndex) => {
            const rhythm = this.rhythms[layerIndex] || 0;
            if (rhythm <= 0) return;

            if (!this.shouldShowLayer(layer)) return;

            const indices = this.layerPulseIndices[layer] || [];
            if (indices.length === 0) return;

            const pulseIndex = Math.floor(progress * rhythm) % indices.length;
            const compositeIndex = indices[pulseIndex];
            const angle = this.nodeAngles[compositeIndex];
            if (angle === undefined) return;

            const isHidden = this.hiddenSpacesIndices.has(compositeIndex);
            const radius = outerRadius;
            const baseLength = Math.max(10, markLength || outerRadius * 0.08);
            const highlightLength = baseLength * 1.6;
            const innerLength = baseLength;
            const outerWidth = lineWidth * 2.5;
            const innerWidth = lineWidth * 1.5;
            const alphaBase = this.getHighlightAlpha(compositeIndex, timeNow);
            if (alphaBase <= 0) return;
            const alphaOuter = (isHidden ? 0.2 : 0.6) * alphaBase;
            const alphaInner = (isHidden ? 0.35 : 1) * alphaBase;

            const radialX = Math.sin(angle);
            const radialY = -Math.cos(angle);

            this.drawHighlightMark(centerX, centerY, radius, radialX, radialY, highlightLength, outerWidth, '#ffffff', alphaOuter);
            this.drawHighlightMark(centerX, centerY, radius, radialX, radialY, innerLength, innerWidth, '#ffffff', alphaInner);
        });
    }

    drawHighlightMark(centerX, centerY, radius, dirX, dirY, length, lineWidth, color, alpha) {
        const half = length * 0.5;
        const startRadius = radius - half;
        const endRadius = radius + half;

        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineWidth;
        this.ctx.beginPath();
        this.ctx.moveTo(centerX + dirX * startRadius, centerY + dirY * startRadius);
        this.ctx.lineTo(centerX + dirX * endRadius, centerY + dirY * endRadius);
        this.ctx.stroke();
        this.ctx.restore();
    }

    updateCursorAndHighlights(elapsedInCycle, now) {
        if (!this.nodeAngles.length || this.cycleDurationMs <= 0) return;

        const cursorAngle = (elapsedInCycle / this.cycleDurationMs) * Math.PI * 2;
        const lastAngle = this.lastCursorAngle;

        if (lastAngle < 0) {
            this.cursorAngle = cursorAngle;
            this.lastCursorAngle = cursorAngle;
            if (this.nodeAngles.length > 0) {
                this.highlightTimes.set(0, now);
            }
            return;
        }

        const numNodes = this.nodeAngles.length;
        for (let i = 0; i < numNodes; i += 1) {
            const markAngle = this.nodeAngles[i];
            let crossed = false;

            if (lastAngle <= cursorAngle) {
                crossed = lastAngle < markAngle && cursorAngle >= markAngle;
            } else {
                crossed = lastAngle < markAngle || cursorAngle >= markAngle;
            }

            if (crossed) {
                this.highlightTimes.set(i, now);
            }
        }

        this.cursorAngle = cursorAngle;
        this.lastCursorAngle = cursorAngle;
    }

    getHighlightAlpha(markIndex, now) {
        const timestamp = this.highlightTimes.get(markIndex);
        if (timestamp === undefined) return 0;
        const age = now - timestamp;
        if (age > this.highlightDecayMs) {
            this.highlightTimes.delete(markIndex);
            return 0;
        }
        return 1 - (age / this.highlightDecayMs);
    }

    getCanvasMetrics() {
        if (!this.canvas) return null;
        const width = parseInt(this.canvas.style.width || '0', 10);
        const height = parseInt(this.canvas.style.height || '0', 10);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
            return null;
        }
        const centerX = width / 2;
        const centerY = height / 2;
        const outerRadius = Math.min(centerX, centerY) - 50;
        const lineWidth = Math.max(2, outerRadius * 0.012);
        const markLength = Math.max(10, outerRadius * 0.08);
        return { width, height, centerX, centerY, outerRadius, lineWidth, markLength };
    }

    shouldShowNode(contributingLayers) {
        if (!this.visuals) return true;
        if (this.visuals.showAllLayers) return true;
        return contributingLayers.some(layer => this.visuals.visibleLayers.has(layer));
    }

    shouldShowLayer(layer) {
        if (!this.visuals) return true;
        if (this.visuals.showAllLayers) return true;
        return this.visuals.visibleLayers.has(layer);
    }

    getNodeColor(contributingLayers) {
        if (this.visuals && this.visuals.calculateDotColor) {
            return this.visuals.calculateDotColor(contributingLayers);
        }
        return '#ffffff';
    }

    getAnimationColor(contributingLayers) {
        if (this.visuals && this.visuals.calculateAnimationColor) {
            return this.visuals.calculateAnimationColor(contributingLayers);
        }
        return '#ffffff';
    }

    getHiddenColor(color) {
        if (this.visuals && this.visuals.makeColorTransparent) {
            return this.visuals.makeColorTransparent(color);
        }
        return 'rgba(128, 128, 128, 0.2)';
    }

    applyAlpha(color, alpha) {
        if (this.visuals && this.visuals.parseColor) {
            const rgb = this.visuals.parseColor(color);
            if (rgb) {
                return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
            }
        }

        const rgb = this.parseColor(color);
        if (rgb) {
            return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
        }
        return `rgba(128, 128, 128, ${alpha})`;
    }

    parseColor(color) {
        if (!color || typeof color !== 'string') return null;
        if (color.startsWith('#')) {
            const hex = color.replace('#', '');
            if (hex.length === 6) {
                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                return { r, g, b };
            }
        }

        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1], 10),
                g: parseInt(rgbMatch[2], 10),
                b: parseInt(rgbMatch[3], 10)
            };
        }

        return null;
    }
}

// Integration with existing LRCVisuals system
function integrateWheelVisualization() {
    if (!window.lrcVisuals || window.lrcVisuals.__wheelIntegrated) return;

    console.log('Starting Wheel integration...');

    window.lrcVisuals.wheel = null;

    const getOrCreateWheel = () => {
        if (!window.lrcVisuals.wheel) {
            window.lrcVisuals.wheel = new LRCWheel(window.lrcVisuals);
            // Sync current scale selection state (the Wheel missed any events fired before creation)
            if (window.lrcVisuals.hiddenSpacesIndices && window.lrcVisuals.hiddenSpacesIndices.size > 0) {
                window.lrcVisuals.wheel.setHiddenSpacesIndices(Array.from(window.lrcVisuals.hiddenSpacesIndices));
            }
        }
        return window.lrcVisuals.wheel;
    };

    const insertWheelOption = (select) => {
        if (!select || select.querySelector('option[value="wheel"]')) return;

        const option = document.createElement('option');
        option.value = 'wheel';
        option.textContent = 'Wheel';

        const linearOption = select.querySelector('option[value="linear"]');
        if (linearOption && linearOption.nextSibling) {
            linearOption.parentNode.insertBefore(option, linearOption.nextSibling);
        } else if (linearOption) {
            linearOption.parentNode.appendChild(option);
        } else {
            select.appendChild(option);
        }
    };

    const selectors = document.querySelectorAll('select#viz-type-selector');
    if (selectors.length > 0) {
        selectors.forEach(insertWheelOption);
    } else {
        console.warn('Viz type selector not found - will retry later');
        setTimeout(integrateWheelVisualization, 500);
        return;
    }

    const originalDrawPlot = window.lrcVisuals.drawPlot.bind(window.lrcVisuals);

    window.lrcVisuals.drawPlot = function() {
        if (this.currentPlotType === 'wheel') {
            const wheel = getOrCreateWheel();
            if (this.spacesPlot && this.spacesPlot.length > 0) {
                this.drawWheelPlot();
            } else {
                this.clearCanvas();
            }
        } else {
            originalDrawPlot();
        }
    };

    window.lrcVisuals.drawWheelPlot = function() {
        const wheel = getOrCreateWheel();

        wheel.updateData({
            spacesPlot: this.spacesPlot,
            compositeRhythm: this.compositeRhythm,
            layerMap: this.layerMap,
            rhythms: this.rhythms,
            grid: this.grid || window.lrcModule?.currentGrid || 1
        });

        wheel.draw();
    };

    const originalStartAnimation = window.lrcVisuals.startAnimation || function() {};
    window.lrcVisuals.startAnimation = function() {
        if (this.currentPlotType === 'wheel') {
            const wheel = getOrCreateWheel();
            wheel.setCycleDurationMs(this.cycleDuration);
            wheel.startAnimation();
        } else {
            originalStartAnimation.call(this);
        }
    };

    const originalStopAnimation = window.lrcVisuals.stopAnimation || function() {};
    window.lrcVisuals.stopAnimation = function() {
        if (this.wheel) {
            this.wheel.stopAnimation();
        }
        originalStopAnimation.call(this);
    };

    window.addEventListener('playbackStarted', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'wheel') {
            const wheel = getOrCreateWheel();
            const cycleDuration = e.detail?.cycleDuration || 10.0;
            wheel.setCycleDurationSeconds(cycleDuration);
            wheel.startAnimation();
            console.log('Wheel animation started with cycle duration:', cycleDuration);
        }
    });

    window.addEventListener('playbackStopped', () => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'wheel' && window.lrcVisuals.wheel) {
            window.lrcVisuals.wheel.resetPlaybackState();
            console.log('Wheel animation stopped');
        }
    });

    window.addEventListener('playbackTempoChanged', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.wheel) {
            const cycleMs = Number.isFinite(e.detail?.cycleDurationMs) ? e.detail.cycleDurationMs : null;
            const phaseMs = Number.isFinite(e.detail?.phaseMs) ? e.detail.phaseMs : 0;
            if (cycleMs != null) {
                window.lrcVisuals.wheel.setPhase(cycleMs, phaseMs);
                if (window.lrcVisuals.currentPlotType === 'wheel' && window.toneRowPlayback?.isPlaying) {
                    window.lrcVisuals.wheel.startAnimation();
                }
                console.log('Wheel phase/cycle updated:', { cycleMs, phaseMs });
            }
        }
    });

    const originalSetCycleDuration = window.lrcVisuals.setCycleDuration || function() {};
    window.lrcVisuals.setCycleDuration = function(duration) {
        originalSetCycleDuration.call(this, duration);
        if (this.wheel) {
            this.wheel.setCycleDurationSeconds(duration);
        }
    };

    window.lrcVisuals.__wheelIntegrated = true;
    console.log('Wheel visualization integrated with LRC interface');
}

if (typeof window !== 'undefined') {
    window.LRCWheel = LRCWheel;

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (window.lrcVisuals) {
                integrateWheelVisualization();
            } else {
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals) {
                        clearInterval(checkInterval);
                        integrateWheelVisualization();
                    }
                }, 100);
            }
        }, 500);
    });
}
