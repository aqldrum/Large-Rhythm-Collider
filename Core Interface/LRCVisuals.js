// LRCVisuals.js - Large Rhythm Collider Visualization Module
// Handles linear/circular plots with enhanced lighting and layer solo functionality

class LRCVisuals {
    constructor() {
        // Canvas and rendering
        this.canvas = null;
        this.ctx = null;
        this.currentPlotType = 'linear';
        this.lastNonPopupPlotType = 'linear';
        
        // Data
        this.spacesPlot = [];
        this.spacesPlotByLayer = [[], [], [], []]; // Individual layer space data
        this.layerMap = [];
        this.rhythms = [1, 1, 1, 1];
        this.dotPositions = [];
        this.compositeRhythm = []; // Full composite rhythm positions
        this.ratios = []; // Musical ratios
        this.grid = 0; // LCM grid size
        
        // Flag to temporarily disable auto-close during CreatePlayer operations
        this.suppressAutoClose = false;
        
        // Animation and lighting - Individual layer based approach
        this.isAnimating = false;
        this.animationId = null;
        this.layerLightingSequences = [[], [], [], []]; // Individual layer sequences [A, B, C, D]
        this.layerCycleDurations = [0, 0, 0, 0]; // Individual cycle durations per layer
        this.lastLightTime = 0;
        this.cycleDuration = 10000; // milliseconds (master cycle)
        this.lightsEnabled = true;
        this.currentCycleProgress = 0; // Track precise cycle position
        
        // Layer visibility and colors
        this.layerColors = {
            'A': '#ff6b6b',
            'B': '#4ecdc4', 
            'C': '#00a638ff',
            'D': '#f9ca24'
        };
        this.visibleLayers = new Set(['A', 'B', 'C', 'D']);
        this.showAllLayers = true;
        
        // Y-axis inversion for pitch representation
        this.yAxisInverted = false;
        this.toggleButtonBounds = null; // Will store button click area
        
        // Layer Connectors toggle
        this.layerConnectorsEnabled = false;
        
        // Scale chart integration - track hidden spaces plot indices
        this.hiddenSpacesIndices = new Set(); // Set of spaces plot indices to hide

        // Node popup system
        this.nodeUI = null;
        this.nodePopups = null;
        this.hoveredNode = null; // Track currently hovered node

        // Initialize
        this.setupCanvas();
        this.setupEventListeners();
        this.updateConnectorsButton(); // Set initial button state
        this.initializeNodePopupSystem(); // Initialize node popups
        console.log('LRC Visuals initialized');
    }

    // ====================================
    // SETUP AND INITIALIZATION
    // ====================================

    setupCanvas() {
        this.canvas = document.getElementById('visualization-canvas');
        if (!this.canvas) {
            console.error('Visualization canvas not found');
            return;
        }
        
        this.ctx = this.canvas.getContext('2d');
        
        // Enable crisp rendering for HD displays
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';
        
        this.resizeCanvas();
        
        // Setup canvas styling
        this.canvas.style.background = '#1a1a1a';
        this.canvas.style.border = '1px solid #444';
        this.canvas.style.borderRadius = '4px';
        
        // Setup canvas event listeners for Y-axis toggle button with capture
        this.canvas.addEventListener('click', (e) => {
            this.handleCanvasClick(e);
        }, { capture: true, passive: false });
        
        this.canvas.addEventListener('mousemove', (e) => {
            this.handleCanvasMouseMove(e);
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hideNodePopup();
        });

        // CRITICAL AMENDMENT: Draw blank canvas immediately
        this.clearCanvas();
    }

    resizeCanvas() {
        if (!this.canvas) return;
        
        const container = this.canvas.closest('#lrc-main') || this.canvas.parentElement;
        const containerWidth = container.clientWidth; // Full container width - no padding needed
        const containerHeight = container.clientHeight;
        const aspectRatio = 2; // 2:1 aspect ratio
        const isMobileMode = document.body && document.body.classList.contains('mobile-mode');
        const rootStyle = window.getComputedStyle(document.documentElement);
        const bottomMargin = parseFloat(rootStyle.getPropertyValue('--canvas-bottom-margin')) || 0;

        if (!containerWidth) return;
        
        // Get device pixel ratio for HD rendering
        const dpr = window.devicePixelRatio || 1;
        
        // Set logical size (no cap for HD quality)
        const logicalWidth = containerWidth;
        const baseHeight = (logicalWidth / aspectRatio) - 20;
        const availableHeight = Math.max(0, containerHeight - (isMobileMode ? 0 : bottomMargin));
        const logicalHeight = isMobileMode ? Math.max(0, baseHeight) : availableHeight;

        if (!logicalHeight) return;
        
        // Set actual canvas size for crisp rendering
        this.canvas.width = logicalWidth * dpr;
        this.canvas.height = logicalHeight * dpr;
        
        // Scale canvas back to logical size
        this.canvas.style.width = logicalWidth + 'px';
        this.canvas.style.height = logicalHeight + 'px';
        
        // Scale the drawing context to match device pixel ratio
        this.ctx.scale(dpr, dpr);
        
        // CRITICAL AMENDMENT: Always redraw, whether we have data or not
        if (this.spacesPlot.length > 0) {
            this.drawPlot();
        } else {
            // Draw blank canvas when no data is available
            this.clearCanvas();
        }
    }

    setupEventListeners() {
        // Plot type selector
        const plotTypeSelect = document.getElementById('plot-type');
        if (plotTypeSelect) {
            plotTypeSelect.addEventListener('change', (e) => {
                this.currentPlotType = e.target.value;
                this.drawPlot();
            });
        }

        // Layer solo buttons
        ['a', 'b', 'c', 'd'].forEach(layer => {
            const btn = document.getElementById(`solo-layer-${layer}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    this.toggleLayerVisibility(layer.toUpperCase());
                });
            }
        });

        // Show all layers button
        const showAllBtn = document.getElementById('show-all-layers');
        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                this.showAllLayers = true;
                this.visibleLayers = new Set(['A', 'B', 'C', 'D']);
                this.updateLayerButtons();
                this.drawPlot();
            });
        }

        // Layer Connectors toggle button
        const connectorsBtn = document.getElementById('layer-connectors-toggle');
        if (connectorsBtn) {
            connectorsBtn.addEventListener('click', () => {
                this.layerConnectorsEnabled = !this.layerConnectorsEnabled;
                console.log(`🔗 Layer Connectors ${this.layerConnectorsEnabled ? 'enabled' : 'disabled'}`);
                this.updateConnectorsButton();
                this.drawPlot();
            });
        }

        // Listen for data updates from main module
        window.addEventListener('rhythmGenerated', (e) => {
            this.updateVisualization(
                e.detail.spacesPlot,
                e.detail.layerMap,
                e.detail.rhythms,
                e.detail.spacesPlotByLayer,
                e.detail.compositeRhythm,
                e.detail.ratios,
                e.detail.grid
            );
        });

        // Listen for playback events - only respond if we're the active visualization
        window.addEventListener('playbackStarted', (e) => {
            // Only respond if Linear or Circular plot is active (core LRCVisuals plots)
            if (this.currentPlotType === 'linear' || this.currentPlotType === 'circular') {
                const detail = e.detail || {};
                if (Number.isFinite(detail.cycleDurationMs) && detail.cycleDurationMs > 0) {
                    this.cycleDuration = detail.cycleDurationMs;
                } else {
                    this.cycleDuration = (detail.cycleDuration || 10) * 1000; // Convert to ms
                }
                const phaseMs = Number.isFinite(detail.phaseMs) ? detail.phaseMs : 0;
                this.startLightingAnimation(phaseMs);
                console.log(`📊 LRCVisuals (${this.currentPlotType}) responding to playback started`);
            }
        });

        window.addEventListener('playbackStopped', () => {
            // Always stop if running so stale animation does not survive view transitions.
            if (this.isAnimating) {
                this.stopLightingAnimation();
                console.log(`📊 LRCVisuals (${this.currentPlotType}) responding to playback stopped`);
            }
        });

        // Tempo / cycle updates (live)
        window.addEventListener('playbackTempoChanged', (e) => {
            const isCorePlot = this.currentPlotType === 'linear' || this.currentPlotType === 'circular';
            if (!isCorePlot && !this.isAnimating) return;
            const detail = e.detail || {};
            if (Number.isFinite(detail.cycleDurationMs)) {
                this.cycleDuration = detail.cycleDurationMs;
            }
            if (Number.isFinite(detail.phaseMs)) {
                // Align lighting phase to playback phase
                this.lastLightTime = performance.now() - detail.phaseMs;
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.resizeCanvas();
        });

        // Listen for spaces plot visibility changes from Scale chart
        window.addEventListener('spacesPlotVisibilityChanged', (e) => {
            this.updateSpacesPlotVisibility(e.detail.hiddenSpacesIndices);
        });
    }

    initializeNodePopupSystem() {
        // Initialize node popup system if classes are available
        if (typeof NodeUI !== 'undefined' && typeof NodePopups !== 'undefined') {
            this.nodeUI = new NodeUI();
            this.nodePopups = new NodePopups();
            console.log('Node popup system initialized');
        } else {
            console.warn('NodeUI or NodePopups classes not available');
        }
    }

    // ====================================
    // DATA UPDATE AND PROCESSING
    // ====================================

    updateVisualization(spacesPlot, layerMap, rhythms, spacesPlotByLayer, compositeRhythm, ratios, grid) {
        this.spacesPlot = spacesPlot || [];
        this.spacesPlotByLayer = spacesPlotByLayer || [[], [], [], []];
        this.layerMap = layerMap || [];
        this.rhythms = rhythms || [1, 1, 1, 1];
        this.compositeRhythm = compositeRhythm || [];
        this.ratios = ratios || [];
        this.grid = grid || 0;

        console.log('Updating visualization with:', {
            spacesLength: this.spacesPlot.length,
            layerLengths: this.spacesPlotByLayer.map(layer => layer.length),
            layerMapLength: this.layerMap.length,
            rhythms: this.rhythms,
            compositeRhythmLength: this.compositeRhythm.length,
            ratiosLength: this.ratios.length,
            grid: this.grid
        });
        
        // AUTO-CLOSE popups but preserve current visualization type
        if (!this.suppressAutoClose) {
            this.closePopupsButPreserveVizType();
        } else {
            // Still update dropdown even when suppressed
            this.updateDropdownSelection();
        }
        
        this.prepareLightingSequences();
        this.drawPlot();
    }

    closeAllPopupsAndResetToLinear() {
        console.log('🔄 Auto-closing visualization popups and resetting to Linear Plot');
        
        // Close Reflections popup if open (only if not already Linear Plot)
        if (this.plotTypes && this.plotTypes['reflections'] && this.currentPlotType !== 'linear') {
            this.plotTypes['reflections'].deactivate();
        }
        
        // Close Collider popup ONLY if it's in battle stage (not creation stage)
        if (this.plotTypes && this.plotTypes['collider']) {
            const colliderUI = this.plotTypes['collider'].colliderUI;
            if (colliderUI && colliderUI.currentStage === 'battle') {
                this.plotTypes['collider'].deactivate();
            }
            // Don't close if in 'creation' stage - CreatePlayer needs to stay open
        }
        
        // Reset to Linear Plot
        this.currentPlotType = 'linear';
    }

    closePopupsButPreserveVizType() {
        console.log('🔄 Auto-closing visualization popups but preserving current viz type:', this.currentPlotType);
        
        // Close Collider popup ONLY if it's in battle stage (not creation stage)
        if (this.plotTypes && this.plotTypes['collider']) {
            const colliderUI = this.plotTypes['collider'].colliderUI;
            if (colliderUI && colliderUI.currentStage === 'battle') {
                this.plotTypes['collider'].deactivate();
                // Only reset to linear if we were in Collider mode
                if (this.currentPlotType === 'collider') {
                    this.currentPlotType = 'linear';
                }
            }
            // Don't close if in 'creation' stage - CreatePlayer needs to stay open
        }
        
        // Keep current plot type for Centrifuge, Hinges, Linear, Reflections, etc.
        // Linear plot drawing happens in background automatically
        
        this.updateDropdownSelection();
    }

    // Method for CreatePlayer to temporarily suppress auto-close
    setSuppressAutoClose(suppress) {
        this.suppressAutoClose = suppress;
        if (suppress) {
            console.log('🔒 Auto-close suppressed for CreatePlayer operations');
        } else {
            console.log('🔓 Auto-close re-enabled');
        }
    }

    // Clear visualization canvas but preserve current plot type selection
    clearVisualization() {
        console.log('🧹 Clearing visualization canvas');
        
        if (this.canvas) {
            const ctx = this.canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        }
        
        // Clear data but don't change plot type
        this.spacesPlot = [];
        this.spacesPlotByLayer = [[], [], [], []];
        this.layerMap = [];
        this.rhythms = [1, 1, 1, 1];
        
        console.log('🧹 Visualization cleared, plot type preserved:', this.currentPlotType);
    }

    // Continue with the dropdown update
    updateDropdownSelection() {
        // Update every viz selector (main panel + any clones) to reflect current plot type
        const selectors = document.querySelectorAll('select#viz-type-selector');
        selectors.forEach((vizSelector) => {
            if (vizSelector) {
                vizSelector.value = this.currentPlotType || 'linear';
            }
        });
        console.log('📊 Viz selector synced to:', this.currentPlotType);
    }

    prepareLightingSequences() {
        // Only prepare individual layer sequences - no composite needed
        this.prepareLayerLightingSequences();
    }

    prepareLayerLightingSequences() {
        const layerNames = ['A', 'B', 'C', 'D'];
        
        this.layerLightingSequences = this.spacesPlotByLayer.map((layerSpaces, layerIndex) => {
            if (layerSpaces.length === 0 || this.rhythms[layerIndex] <= 1) {
                console.log(`Layer ${layerNames[layerIndex]}: Inactive (rhythm: ${this.rhythms[layerIndex]})`);
                return [];
            }

            const layerRhythm = this.rhythms[layerIndex];
            const layerSequence = [];
            
            // Each layer has uniform pulse timing: cycleDuration / rhythmValue
            const pulseDuration = this.cycleDuration / layerRhythm;
            
            // Create sequence for each pulse in this layer
            for (let pulseIndex = 0; pulseIndex < layerRhythm; pulseIndex++) {
                const startTime = pulseIndex * pulseDuration;
                const endTime = startTime + pulseDuration;
                
                // Find the coordinate that corresponds to this pulse
                const coordinateIndex = this.findCoordinateForLayerPulse(layerIndex, pulseIndex);
                
                layerSequence.push({
                    layerIndex: layerIndex,
                    layerName: layerNames[layerIndex],
                    pulseIndex: pulseIndex,
                    coordinateIndex: coordinateIndex,
                    startTime: startTime,
                    endTime: endTime,
                    duration: pulseDuration,
                    rhythm: layerRhythm,
                    spaceValue: layerSpaces[pulseIndex] || layerSpaces[0] // Fallback to first space
                });
            }

            console.log(`Layer ${layerNames[layerIndex]}: ${layerSequence.length} pulses, rhythm: ${layerRhythm}, pulse duration: ${pulseDuration.toFixed(1)}ms`);
            return layerSequence;
        });
    }

    findCoordinateForLayerPulse(layerIndex, pulseIndex) {
        // Find which coordinate on the plot corresponds to this layer's pulse
        const layerName = ['A', 'B', 'C', 'D'][layerIndex];
        let layerPulseCount = 0;
        
        for (let i = 0; i < this.layerMap.length; i++) {
            const contributingLayers = this.layerMap[i] || [];
            if (contributingLayers.includes(layerName)) {
                if (layerPulseCount === pulseIndex) {
                    return i; // Found the coordinate index
                }
                layerPulseCount++;
            }
        }
        
        return -1; // Not found - this pulse doesn't have a visible coordinate
    }

    calculateDotColor(contributingLayers) {
        // If lights are disabled, return neutral color for all dots
        if (!this.lightsEnabled) {
            return '#888888'; // Neutral gray when lights are off
        }
        
        // Original layer color logic when lights are enabled
        if (!contributingLayers || contributingLayers.length === 0) {
            return '#ffffff';
        }
        
        if (contributingLayers.length === 1) {
            const layer = contributingLayers[0];
            const color = this.layerColors[layer];
            
            return color || '#ffffff';
        }
        
        // Blend colors for multiple layers
        return this.blendColors(contributingLayers.map(layer => this.layerColors[layer]));
    }

    blendColors(colors) {
        if (colors.length === 0) return '#ffffff';
        if (colors.length === 1) return colors[0];
        
        let r = 0, g = 0, b = 0;
        
        colors.forEach(color => {
            if (color) {
                const rgb = this.hexToRgb(color);
                r += rgb.r;
                g += rgb.g;
                b += rgb.b;
            }
        });
        
        r = Math.round(r / colors.length);
        g = Math.round(g / colors.length);
        b = Math.round(b / colors.length);
        
        return `rgb(${r}, ${g}, ${b})`;
    }

    hexToRgb(hex) {
        // Handle both 6-character (#rrggbb) and 8-character (#rrggbbaa) hex codes
        const result6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        const result8 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})[a-f\d]{2}$/i.exec(hex);
        
        const result = result6 || result8;
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 255, b: 255 };
    }

    // ====================================
    // SPACES PLOT VISIBILITY CONTROL (Scale Chart Integration)
    // ====================================

    updateSpacesPlotVisibility(hiddenIndices) {
        // Safety check - ensure hiddenIndices is an array
        const indices = Array.isArray(hiddenIndices) ? hiddenIndices : [];
        
        this.hiddenSpacesIndices = new Set(indices);
        console.log(`📊 Linear Plot: Hiding ${indices.length} spaces plot indices:`, indices);
        
        // Immediately redraw the plot to reflect hidden dots
        this.drawPlot();
    }

    // ====================================
    // LAYER VISIBILITY CONTROL
    // ====================================

    toggleLayerVisibility(layer) {
        if (this.showAllLayers) {
            // Switch to solo mode
            this.showAllLayers = false;
            this.visibleLayers = new Set([layer]);
        } else {
            // Toggle layer in solo mode
            if (this.visibleLayers.has(layer)) {
                this.visibleLayers.delete(layer);
            } else {
                this.visibleLayers.add(layer);
            }
            
            // If no layers visible, switch back to show all
            if (this.visibleLayers.size === 0) {
                this.showAllLayers = true;
                this.visibleLayers = new Set(['A', 'B', 'C', 'D']);
            }
        }
        
        this.updateLayerButtons();
        this.drawPlot();
        
        // If animation is running, seamlessly switch to new layer sequence
        if (this.isAnimating) {
            console.log(`🔄 Smooth layer transition: visible layers now [${Array.from(this.visibleLayers).join(', ')}]`);
            console.log(`Current dotPositions count: ${this.dotPositions.length}`);
            // Animation will automatically pick up the new layer configuration on next frame
        }
    }

    updateLayerButtons() {
        ['a', 'b', 'c', 'd'].forEach(layer => {
            const btn = document.getElementById(`solo-layer-${layer}`);
            if (btn) {
                const upperLayer = layer.toUpperCase();
                const isVisible = this.showAllLayers || this.visibleLayers.has(upperLayer);
                
                btn.classList.toggle('active', isVisible && !this.showAllLayers);
                btn.style.backgroundColor = isVisible && !this.showAllLayers ? 
                    this.layerColors[upperLayer] : '';
            }
        });
        
        const showAllBtn = document.getElementById('show-all-layers');
        if (showAllBtn) {
            showAllBtn.classList.toggle('active', this.showAllLayers);
        }
    }

    updateConnectorsButton() {
        const connectorsBtn = document.getElementById('layer-connectors-toggle');
        if (!connectorsBtn) {
            return;
        }

        connectorsBtn.classList.toggle('active', this.layerConnectorsEnabled);
        connectorsBtn.style.backgroundColor = '';
        connectorsBtn.style.color = '';
        connectorsBtn.style.borderColor = '';

        connectorsBtn.setAttribute('aria-pressed', String(this.layerConnectorsEnabled));
        connectorsBtn.setAttribute(
            'aria-label',
            this.layerConnectorsEnabled ? 'Hide layer connectors' : 'Show layer connectors'
        );
    }

    shouldShowDot(contributingLayers, spaceIndex = -1) {
        // Layer visibility check only - Scale chart hiding is handled in drawing
        if (this.showAllLayers) return true;
        
        return contributingLayers.some(layer => this.visibleLayers.has(layer));
    }

    isDotHiddenByScale(spaceIndex) {
        // Separate method to check if dot should be visually hidden by Scale chart
        return spaceIndex >= 0 && this.hiddenSpacesIndices.has(spaceIndex);
    }

    // ====================================
    // DRAWING FUNCTIONS
    // ====================================

    drawPlot() {
        if (!this.ctx || this.spacesPlot.length === 0) return;
        
        this.clearCanvas();
        this.dotPositions = [];
        
        if (this.currentPlotType === 'linear') {
            this.drawLinearPlot();
        } else if (this.currentPlotType === 'circular') {
            this.drawCircularPlot();
        }
    }

    clearCanvas() {
        if (!this.ctx) return;
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawLinearPlot() {
        const width = parseInt(this.canvas.style.width);
        const height = parseInt(this.canvas.style.height);
        const padding = 40;
        const plotWidth = width - (padding * 2);
        const plotHeight = height - (padding * 2);
        
        const maxValue = Math.max(...this.spacesPlot);
        const spacing = plotWidth / (this.spacesPlot.length - 1);
        
        // Draw dots - maintain all positions for timing, but make some transparent
        this.spacesPlot.forEach((space, index) => {
            const contributingLayers = this.layerMap[index] || ['Composite'];
            
            // Skip only for layer visibility, not for scale hiding
            if (!this.shouldShowDot(contributingLayers)) return;
            
            const x = padding + (index * spacing);
            // Y-axis inversion: if inverted, flip the coordinate calculation
            const y = this.yAxisInverted ? 
                padding + ((space / maxValue) * plotHeight) : 
                height - padding - ((space / maxValue) * plotHeight);
            
            const size = this.calculateDotSize();
            const baseColor = this.calculateDotColor(contributingLayers);
            
            // If hidden by scale chart, make transparent but keep the dot
            const isHiddenByScale = this.isDotHiddenByScale(index);
            const color = isHiddenByScale ? this.makeColorTransparent(baseColor) : baseColor;
            const actualSize = isHiddenByScale ? size * 0.3 : size; // Make smaller when hidden
            
            this.drawDot(x, y, actualSize, color, false);
            
            // Always add to dotPositions to maintain timing structure
            this.dotPositions.push({
                x: x,
                y: y,
                size: actualSize,
                index: index,
                space: space,
                layers: contributingLayers,
                defaultColor: baseColor,
                hiddenByScale: isHiddenByScale
            });
        });
        
        // Draw layer connectors if enabled
        if (this.layerConnectorsEnabled) {
            this.drawLayerConnectors(width, height, padding, plotWidth, plotHeight, maxValue, spacing);
        }
        
        // Draw Y-axis inversion toggle button (only for linear plot)
        this.drawInvertToggleButton(width, height);
    }

    drawCircularPlot() {
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        const maxRadius = Math.min(centerX, centerY) - 40;
        
        const maxValue = Math.max(...this.spacesPlot);
        const angleStep = (Math.PI * 2) / this.spacesPlot.length;
        
        // Draw center circle
        this.ctx.strokeStyle = '#444';
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
        this.ctx.stroke();
        
        // Draw dots - maintain all positions for timing, but make some transparent
        this.spacesPlot.forEach((space, index) => {
            const contributingLayers = this.layerMap[index] || ['Composite'];
            
            // Skip only for layer visibility, not for scale hiding
            if (!this.shouldShowDot(contributingLayers)) return;
            
            const angle = (index * angleStep) - (Math.PI / 2); // Start from top
            const radius = (space / maxValue) * maxRadius;
            
            const x = centerX + (radius * Math.cos(angle));
            const y = centerY + (radius * Math.sin(angle));
            const size = this.calculateDotSize();
            const baseColor = this.calculateDotColor(contributingLayers);
            
            // If hidden by scale chart, make transparent but keep the dot
            const isHiddenByScale = this.isDotHiddenByScale(index);
            const color = isHiddenByScale ? this.makeColorTransparent(baseColor) : baseColor;
            const actualSize = isHiddenByScale ? size * 0.3 : size; // Make smaller when hidden
            
            this.drawDot(x, y, actualSize, color, false);
            
            // Always add to dotPositions to maintain timing structure
            this.dotPositions.push({
                x: x,
                y: y,
                size: actualSize,
                index: index,
                space: space,
                layers: contributingLayers,
                defaultColor: baseColor,
                hiddenByScale: isHiddenByScale
            });
        });
    }

    drawDot(x, y, size, color, highlighted = false) {
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, size, 0, Math.PI * 2);
        this.ctx.fill();
        
        if (highlighted) {
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(x, y, size + 2, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    drawSustainedIlluminatedDot(x, y, baseSize, color, expansionAmount = 2, brightnessMultiplier = 1) {
        const expandedSize = baseSize + expansionAmount;
        
        // Adjust color brightness based on brightness multiplier
        const adjustedColor = this.adjustColorBrightness(color, brightnessMultiplier);
        
        // Create sustained glow gradient
        const glowRadius = expandedSize * 2;
        const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
        gradient.addColorStop(0, adjustedColor);
        gradient.addColorStop(0.5, adjustedColor);
        gradient.addColorStop(0.8, this.makeColorTransparent(adjustedColor));
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        // Draw sustained outer glow
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Draw main sustained dot
        this.ctx.fillStyle = adjustedColor;
        this.ctx.beginPath();
        this.ctx.arc(x, y, expandedSize, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Add bright core for sustained effect
        const coreGradient = this.ctx.createRadialGradient(x, y, 0, x, y, expandedSize * 0.7);
        coreGradient.addColorStop(0, '#ffffff');
        coreGradient.addColorStop(0.4, this.lightenColor(adjustedColor, 0.6));
        coreGradient.addColorStop(1, adjustedColor);
        
        this.ctx.fillStyle = coreGradient;
        this.ctx.beginPath();
        this.ctx.arc(x, y, expandedSize * 0.7, 0, Math.PI * 2);
        this.ctx.fill();
    }
    
    adjustColorBrightness(color, multiplier) {
        const rgb = this.parseColor(color);
        if (!rgb) return color;
        
        const r = Math.min(255, Math.round(rgb.r * multiplier));
        const g = Math.min(255, Math.round(rgb.g * multiplier));
        const b = Math.min(255, Math.round(rgb.b * multiplier));
        
        return `rgb(${r}, ${g}, ${b})`;
    }

    lightenColor(color, amount) {
        // Helper function to lighten a color
        const rgb = this.hexToRgb(color);
        if (!rgb) return color;
        
        const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount));
        const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount));
        const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount));
        
        return `rgb(${r}, ${g}, ${b})`;
    }

    makeColorTransparent(color) {
        // Convert any color format to rgba with low alpha (not fully transparent)
        const rgb = this.parseColor(color);
        if (!rgb) return 'rgba(128, 128, 128, 0.2)';
        
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`; // 20% opacity for hidden notes
    }

    parseColor(color) {
        // Parse hex colors
        if (color.startsWith('#')) {
            return this.hexToRgb(color);
        }
        
        // Parse rgb colors
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
            return {
                r: parseInt(rgbMatch[1]),
                g: parseInt(rgbMatch[2]),
                b: parseInt(rgbMatch[3])
            };
        }
        
        // Parse rgba colors
        const rgbaMatch = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/);
        if (rgbaMatch) {
            return {
                r: parseInt(rgbaMatch[1]),
                g: parseInt(rgbaMatch[2]),
                b: parseInt(rgbaMatch[3])
            };
        }
        
        // Fallback
        return { r: 255, g: 255, b: 255 };
    }

    // ====================================
    // Y-AXIS INVERSION TOGGLE
    // ====================================

    drawLayerConnectors(width, height, padding, plotWidth, plotHeight, maxValue, spacing) {
        // Draw connector lines for each individual layer
        const layerNames = ['A', 'B', 'C', 'D'];
        
        layerNames.forEach((layerName, layerIndex) => {
            // Only draw connectors for visible layers
            if (!this.showAllLayers && !this.visibleLayers.has(layerName)) {
                return;
            }
            
            // Get layer color
            const layerColor = this.layerColors[layerName];
            const connectorColor = this.lightsEnabled ? layerColor : '#888888';
            
            // Find all positions in the plot that belong to this layer
            const layerPositions = [];
            
            this.spacesPlot.forEach((space, index) => {
                const contributingLayers = this.layerMap[index] || [];
                
                // Check if this position belongs to the current layer
                if (contributingLayers.includes(layerName)) {
                    // Only include if the dot should be shown (layer visibility)
                    if (this.shouldShowDot(contributingLayers)) {
                        const x = padding + (index * spacing);
                        const y = this.yAxisInverted ? 
                            padding + ((space / maxValue) * plotHeight) : 
                            height - padding - ((space / maxValue) * plotHeight);
                        
                        layerPositions.push({
                            x: x,
                            y: y,
                            index: index,
                            space: space,
                            isHiddenByScale: this.isDotHiddenByScale(index)
                        });
                    }
                }
            });
            
            // Filter to only visible positions (respect scale selection state)
            const visiblePositions = layerPositions.filter(pos => !pos.isHiddenByScale);

            // Draw connector lines between sequential visible positions for this layer
            if (visiblePositions.length > 1) {
                this.ctx.strokeStyle = connectorColor;
                this.ctx.lineWidth = 1.5;
                this.ctx.lineCap = 'round';
                this.ctx.setLineDash([]); // Solid line

                this.ctx.beginPath();
                this.ctx.moveTo(visiblePositions[0].x, visiblePositions[0].y);

                for (let i = 1; i < visiblePositions.length; i++) {
                    this.ctx.lineTo(visiblePositions[i].x, visiblePositions[i].y);
                }

                this.ctx.stroke();
            }
        });
    }

    drawInvertToggleButton(canvasWidth, canvasHeight) {
        // Button position: bottom right corner with some padding
        const buttonSize = 28;
        const padding = 10;
        const buttonX = canvasWidth - buttonSize - padding;
        const buttonY = canvasHeight - buttonSize - padding;
        
        // Store button bounds for click detection
        this.toggleButtonBounds = {
            x: buttonX,
            y: buttonY,
            width: buttonSize,
            height: buttonSize
        };
        
        // Draw solid green button background
        this.ctx.fillStyle = '#4CAF50'; // Solid green background
        this.ctx.fillRect(buttonX, buttonY, buttonSize, buttonSize);
        
        // Draw white arrow
        this.ctx.fillStyle = '#ffffff'; // White color for arrow
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        const centerX = buttonX + buttonSize / 2;
        const centerY = buttonY + buttonSize / 2;
        const arrowSize = 6;
        
        this.ctx.beginPath();
        if (this.yAxisInverted) {
            // Up arrow - pointing up
            this.ctx.moveTo(centerX, centerY - arrowSize);
            this.ctx.lineTo(centerX - arrowSize, centerY + arrowSize);
            this.ctx.lineTo(centerX + arrowSize, centerY + arrowSize);
            this.ctx.closePath();
        } else {
            // Down arrow - pointing down
            this.ctx.moveTo(centerX, centerY + arrowSize);
            this.ctx.lineTo(centerX - arrowSize, centerY - arrowSize);
            this.ctx.lineTo(centerX + arrowSize, centerY - arrowSize);
            this.ctx.closePath();
        }
        this.ctx.fill();
    }

    handleCanvasClick(event) {
        if (!this.toggleButtonBounds || this.currentPlotType !== 'linear') return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Check if click is within button bounds
        if (x >= this.toggleButtonBounds.x && 
            x <= this.toggleButtonBounds.x + this.toggleButtonBounds.width &&
            y >= this.toggleButtonBounds.y && 
            y <= this.toggleButtonBounds.y + this.toggleButtonBounds.height) {
            
            // CRITICAL: Stop all event propagation immediately
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            
            // Toggle Y-axis inversion
            this.yAxisInverted = !this.yAxisInverted;
            console.log(`🔄 Y-axis ${this.yAxisInverted ? 'inverted' : 'normal'} - ${this.yAxisInverted ? 'higher values at top' : 'higher values at bottom'}`);
            
            // Immediately redraw just the linear plot to avoid interference
            console.log(`📊 Redrawing plot with Y-axis inversion: ${this.yAxisInverted}`);
            this.clearCanvas();
            this.dotPositions = [];
            this.drawLinearPlot();
            
            // Do NOT call drawPlot() as it might trigger other systems
            return false; // Prevent any further event handling
        }
    }

    handleCanvasMouseMove(event) {
        if (this.currentPlotType !== 'linear') return;

        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Check if mouse is over toggle button
        let isOverButton = false;
        if (this.toggleButtonBounds) {
            isOverButton = x >= this.toggleButtonBounds.x &&
                          x <= this.toggleButtonBounds.x + this.toggleButtonBounds.width &&
                          y >= this.toggleButtonBounds.y &&
                          y <= this.toggleButtonBounds.y + this.toggleButtonBounds.height;
        }

        // Check if mouse is over any node (only if not over button)
        let hoveredNode = null;
        if (!isOverButton && this.dotPositions && this.dotPositions.length > 0) {
            hoveredNode = this.findNodeAtPosition(x, y);
        }

        // Handle node popup
        if (hoveredNode && this.nodeUI && this.nodePopups) {
            // Mouse is over a node - show popup
            if (this.hoveredNode !== hoveredNode) {
                // New node or first time hovering
                this.hoveredNode = hoveredNode;
                const screenX = event.clientX;
                const screenY = event.clientY;

                // Prepare complete rhythm data for popup
                const rhythmData = {
                    spacesPlot: this.spacesPlot,
                    layerMap: this.layerMap,
                    rhythms: this.rhythms,
                    compositeRhythm: this.compositeRhythm,
                    ratios: this.ratios,
                    grid: this.grid
                };

                // Get node data from NodePopups
                const nodeData = this.nodePopups.getNodeData(hoveredNode.index, rhythmData);

                this.nodeUI.showPopup(screenX, screenY, nodeData);
            }
            this.canvas.style.cursor = 'pointer';
        } else {
            // Mouse is not over any node - hide popup
            if (this.hoveredNode && this.nodeUI) {
                this.nodeUI.hidePopup();
                this.hoveredNode = null;
            }
            this.canvas.style.cursor = isOverButton ? 'pointer' : 'default';
        }
    }

    /**
     * Hide the node popup and clear hover state.
     * Called when mouse leaves the canvas.
     */
    hideNodePopup() {
        if (this.nodeUI) {
            this.nodeUI.hidePopup();
        }
        this.hoveredNode = null;
    }

    findNodeAtPosition(x, y) {
        // Find if mouse is over any node
        const hoverRadius = 8; // Slightly larger than dot size for easier hovering

        for (let i = 0; i < this.dotPositions.length; i++) {
            const dot = this.dotPositions[i];
            const distance = Math.sqrt(
                Math.pow(x - dot.x, 2) +
                Math.pow(y - dot.y, 2)
            );

            if (distance <= hoverRadius) {
                // Found a node under the mouse
                return dot;
            }
        }

        return null; // No node found
    }

    calculateDotSize() {
        // Return uniform size for all dots to maintain visual symmetry
        const uniformSize = 4;
        return uniformSize;
    }

    calculateAnimationColor(contributingLayers) {
        // For animation, use white when lightswitch is off, otherwise use layer color
        if (!this.lightsEnabled) {
            return '#ffffff';
        }
        
        // Use the same logic as calculateDotColor but ensure it's for animation
        if (!contributingLayers || contributingLayers.length === 0) {
            return '#ffffff';
        }
        
        if (contributingLayers.length === 1) {
            const layer = contributingLayers[0];
            const color = this.layerColors[layer];
            
            // Debug Layer C specifically for animation
            if (layer === 'C' || layer === 'c') {
                console.log(`🟢 Layer C ANIMATION color lookup:`, {
                    layer: layer,
                    color: color,
                    lightsEnabled: this.lightsEnabled,
                    fallback: color || '#ffffff'
                });
            }
            
            return color || '#ffffff';
        }
        
        // Blend colors for multiple layers
        return this.blendColors(contributingLayers.map(layer => this.layerColors[layer]));
    }

    // ====================================
    // LIGHTING ANIMATION
    // ====================================

    startLightingAnimation(phaseMs = 0) {
        const safePhase = (Number.isFinite(phaseMs) && this.cycleDuration > 0)
            ? ((phaseMs % this.cycleDuration) + this.cycleDuration) % this.cycleDuration
            : 0;
        const phaseAlignedStartTime = performance.now() - safePhase;

        if (this.isAnimating) {
            this.lastLightTime = phaseAlignedStartTime;
            return;
        }

        this.isAnimating = true;
        this.currentLightIndex = 0;
        this.lastLightTime = phaseAlignedStartTime;
        
        // Ensure lighting sequences are prepared with current data
        if (!this.layerLightingSequences || this.layerLightingSequences.length === 0 || 
            this.layerLightingSequences.every(seq => !seq || seq.length === 0)) {
            this.prepareLightingSequences();
        }
        
        const totalLights = this.layerLightingSequences.reduce((total, seq) => total + (seq ? seq.length : 0), 0);
        console.log(`Starting lighting animation with ${totalLights} layer lights, cycle: ${this.cycleDuration}ms`);
        console.log('Layer sequences:', this.layerLightingSequences.map((seq, i) => `${['A','B','C','D'][i]}: ${seq ? seq.length : 0}`));
        console.log('Animation timing sync: lights enabled =', this.lightsEnabled);
        
        this.animateLights();
    }

    stopLightingAnimation() {
        this.isAnimating = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Redraw without highlights
        this.drawPlot();
    }

    animateLights() {
        if (!this.isAnimating) return;
        
        const currentTime = performance.now();
        const elapsedInCycle = (currentTime - this.lastLightTime) % this.cycleDuration;
        this.currentCycleProgress = elapsedInCycle / this.cycleDuration; // 0 to 1
        
        // Always redraw the basic plot (shows dots)
        this.drawPlot();
        
        // Get all currently active layer pulses
        const activeLayerPulses = this.getActiveLayerPulses(elapsedInCycle);
        
        // Draw sustained illumination for all active pulses
        activeLayerPulses.forEach(pulse => {
            const dotIndex = pulse.filteredCoordinateIndex;
            if (dotIndex >= 0 && dotIndex < this.dotPositions.length) {
                const dot = this.dotPositions[dotIndex];
                if (dot) {
                    // Check if this dot is hidden by scale chart
                    const isHiddenByScale = dot.hiddenByScale;
                    
                    // Calculate pulse progress (0 to 1 within the pulse duration)
                    const progressInPulse = (elapsedInCycle - pulse.startTime) / pulse.duration;
                    
                    // Adjust brightness based on whether dot is hidden
                    const baseBrightness = isHiddenByScale ? 0.1 : 0.8; // Much dimmer when hidden
                    const pulseEffect = Math.sin(progressInPulse * Math.PI * 2) * (isHiddenByScale ? 0.05 : 0.2);
                    const brightnessMultiplier = baseBrightness + pulseEffect;
                    
                    // Expansion based on layer rhythm (faster rhythms = more prominent)
                    const rhythmMultiplier = Math.log(pulse.rhythm + 1) * 0.5 + 1;
                    const expansionAmount = (3 * rhythmMultiplier + 1) * (isHiddenByScale ? 0.3 : 1);
                    
                    // Get layer-specific color
                    const layerColor = this.layerColors[pulse.layerName] || '#ffffff';
                    let animationColor = this.lightsEnabled ? layerColor : '#ffffff';
                    
                    // If hidden by scale, make the animation color more transparent
                    if (isHiddenByScale) {
                        animationColor = this.makeColorTransparent(animationColor);
                    }
                    
                    // Draw sustained illuminated dot
                    this.drawSustainedIlluminatedDot(
                        dot.x, 
                        dot.y, 
                        dot.size, 
                        animationColor, 
                        expansionAmount,
                        brightnessMultiplier
                    );
                }
            }
        });
        
        this.animationId = requestAnimationFrame(() => this.animateLights());
    }

    getActiveLayerPulses(elapsedInCycle) {
        const activePulses = [];
        
        // Check each visible layer for active pulses
        ['A', 'B', 'C', 'D'].forEach((layerName, layerIndex) => {
            if (this.showAllLayers || this.visibleLayers.has(layerName)) {
                const layerSequence = this.layerLightingSequences[layerIndex];
                
                layerSequence.forEach(pulse => {
                    // Check if this pulse is currently active (sustained duration)
                    if (elapsedInCycle >= pulse.startTime && elapsedInCycle < pulse.endTime) {
                        // Map the pulse to the current filtered coordinate position
                        const filteredCoordinateIndex = this.mapPulseToFilteredCoordinate(pulse, layerName);
                        if (filteredCoordinateIndex >= 0) {
                            activePulses.push({
                                ...pulse,
                                filteredCoordinateIndex: filteredCoordinateIndex
                            });
                        }
                    }
                });
            }
        });
        
        return activePulses;
    }

    mapPulseToFilteredCoordinate(pulse, layerName) {
        // Find which position in the current filtered dotPositions array corresponds to this pulse
        const originalCompositeIndex = pulse.coordinateIndex;
        
        if (originalCompositeIndex < 0) {
            return -1; // This pulse doesn't have a coordinate
        }
        
        // Count how many coordinates appear before this pulse's coordinate in the filtered view
        let filteredIndex = -1;
        let visibleCount = 0;
        
        for (let i = 0; i <= originalCompositeIndex && i < this.layerMap.length; i++) {
            const contributingLayers = this.layerMap[i] || [];
            
            // Check if this coordinate should be visible in current layer filter
            if (this.shouldShowDot(contributingLayers)) {
                if (i === originalCompositeIndex) {
                    filteredIndex = visibleCount;
                    break;
                }
                visibleCount++;
            }
        }
        
        // Debug logging for coordinate mapping issues
        if (filteredIndex < 0 && originalCompositeIndex >= 0) {
            console.log(`⚠️ Coordinate mapping failed: layer ${layerName}, composite index ${originalCompositeIndex}, layers: [${this.layerMap[originalCompositeIndex]?.join(', ') || 'none'}]`);
        }
        
        return filteredIndex;
    }

    // ====================================
    // LIGHTING CONTROL (separate from layer visibility)
    // ====================================

    toggleLightingOverlay(enabled) {
        this.lightsEnabled = enabled;
        console.log(`Lighting overlay ${enabled ? 'enabled' : 'disabled'}`);
        
        // If animation is running, the next frame will respect the new setting
        // If not animating, just redraw the plot without highlights
        if (!this.isAnimating) {
            this.drawPlot();
        }
    }

    setLightsEnabled(enabled) {
        this.lightsEnabled = enabled;
        console.log(`🔦 Layer colors ${enabled ? 'enabled' : 'disabled'} - Dots will be ${enabled ? 'colored' : 'neutral gray'}`);
        
        // Immediately redraw to show the change
        this.drawPlot();
    }

    // ====================================
    // PUBLIC API
    // ====================================

    setPlotType(type) {
        const requestedType = type || 'linear';
        const previousType = this.currentPlotType;
        
        // Stop playback when switching visualization types to prevent lighting conflicts
        if (window.toneRowPlayback && window.toneRowPlayback.isPlaying) {
            window.toneRowPlayback.stopPlayback();
            console.log('🛑 Auto-stopped playback due to visualization type change');
        }

        // Ensure all animation loops are cleared before transitioning plot state.
        if (typeof this.stopAnimation === 'function') {
            this.stopAnimation();
        } else {
            this.stopLightingAnimation();
        }
        
        this.currentPlotType = requestedType;
        if (!this.isPopupVisualization(requestedType)) {
            this.lastNonPopupPlotType = requestedType;
        }
        
        const select = document.getElementById('plot-type');
        if (select) select.value = requestedType;
        
        this.updateDropdownSelection();
        
        if (previousType !== requestedType) {
            console.log(`📊 Visualization changed from ${previousType} to ${requestedType}`);
        }
        
        this.drawPlot();

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('vizTypeChanged', {
                detail: {
                    currentType: this.currentPlotType,
                    previousType
                }
            }));
        }
    }

    isPopupVisualization(type) {
        return type === 'reflections' || type === 'collider';
    }

    getLastNonPopupPlotType() {
        return this.lastNonPopupPlotType || 'linear';
    }

    setCycleDuration(duration) {
        this.cycleDuration = duration * 1000; // Convert to ms
        this.prepareLightingSequences();
    }

    exportPlotAsImage() {
        if (!this.canvas) return null;
        
        // Create a temporary canvas with white background for export
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = this.canvas.width;
        exportCanvas.height = this.canvas.height;
        const exportCtx = exportCanvas.getContext('2d');
        
        // White background
        exportCtx.fillStyle = '#ffffff';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        
        // Draw the plot on export canvas
        exportCtx.drawImage(this.canvas, 0, 0);
        
        return exportCanvas.toDataURL('image/png');
    }
}

// Initialize LRC Visuals when DOM is loaded
let lrcVisuals;

document.addEventListener('DOMContentLoaded', () => {
    lrcVisuals = new LRCVisuals();
    window.lrcVisuals = lrcVisuals; // Make globally accessible
});
