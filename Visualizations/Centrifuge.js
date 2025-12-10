// Centrifuge.js - Large Rhythm Collider Centrifuge Visualization
// Creates rotating disc visualization with ratio ring and arc sector lighting

class LRCCentrifuge {
    constructor(lrcVisuals) {
        this.parent = lrcVisuals;
        this.canvas = null;
        this.ctx = null;
        
        // Animation state
        this.isAnimating = false;
        this.animationId = null;
        this.startTime = 0;
        this.cycleDuration = 10000; // ms
        
        // Data
        this.spacesPlot = [];
        this.rhythms = [1, 1, 1, 1];
        this.grid = 1;
        this.ratios = [];
        this.uniqueRatios = [];
        
        // Visual elements
        this.centerX = 0;
        this.centerY = 0;
        this.maxRadius = 0;
        this.layerDiscs = [];
        this.ratioRing = [];
        this.currentLitRatio = -1;
        this.currentLitArcs = new Set();
        this.previousAngles = []; // Track previous angles for crossing detection
        
        // Colors
        this.layerColors = {
            'A': '#ff6b6b',
            'B': '#4ecdc4',
            'C': '#00a638ff',
            'D': '#f9ca24'
        };

        // Ratio highlight tracking
        this.layerNames = ['A', 'B', 'C', 'D'];
        this.activeLayerRatios = [null, null, null, null];
        this.ratioHighlightCounts = new Map();
        this.ratioIndexLookup = new Map();
        this.legatoModeActive = !!(window.toneRowPlayback && window.toneRowPlayback.legatoEnabled);
        this.hasReceivedNoteEvent = false;
        this.visibleLayerSlices = new Set(this.layerNames);
        this.visibleRatios = null;
        this.layerHighlightStates = this.layerNames.map(() => ({
            ratio: null,
            ratioIndex: null,
            expiresAt: 0
        }));

        // Event listener bindings
        this.listenersAttached = false;
        this.handleLayerNoteTriggered = this.handleLayerNoteTriggered.bind(this);
        this.handlePlaybackStopped = this.handlePlaybackStopped.bind(this);
        this.handlePlaybackStarted = this.handlePlaybackStarted.bind(this);
        this.handleLegatoModeChanged = this.handleLegatoModeChanged.bind(this);
        this.handleScaleSelectionChanged = this.handleScaleSelectionChanged.bind(this);

        this.attachEventListeners();
        this.syncInitialSelectionState();
        
        console.log('🌀 Centrifuge visualization initialized');
    }

    // ====================================
    // SETUP AND DRAWING
    // ====================================

    decimalToFraction(decimal) {
        // Simple fraction conversion with limited precision
        const tolerance = 1e-6;
        let numerator = 1;
        let denominator = 1;
        let bestError = Math.abs(decimal - 1);
        let bestNum = 1;
        let bestDen = 1;
        
        // Try denominators up to 64 (common in musical ratios)
        for (let den = 1; den <= 64; den++) {
            const num = Math.round(decimal * den);
            const error = Math.abs(decimal - num / den);
            
            if (error < bestError && error < tolerance) {
                bestError = error;
                bestNum = num;
                bestDen = den;
            }
        }
        
        // Reduce fraction
        const gcd = this.calculateGCD(bestNum, bestDen);
        bestNum /= gcd;
        bestDen /= gcd;
        
        return `${bestNum}/${bestDen}`;
    }

    calculateGCD(a, b) {
        while (b !== 0) {
            const temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    // ====================================
    // EVENT INTEGRATION
    // ====================================

    attachEventListeners() {
        if (this.listenersAttached || typeof window === 'undefined') return;

        window.addEventListener('layerNoteTriggered', this.handleLayerNoteTriggered);
        window.addEventListener('playbackStopped', this.handlePlaybackStopped);
        window.addEventListener('playbackStarted', this.handlePlaybackStarted);
        window.addEventListener('legatoModeChanged', this.handleLegatoModeChanged);
        window.addEventListener('scaleSelectionChanged', this.handleScaleSelectionChanged);

        this.listenersAttached = true;
    }

    handlePlaybackStarted() {
        this.legatoModeActive = this.isLegatoEnabled();
        this.clearAllRatioHighlights();
    }

    handlePlaybackStopped() {
        this.clearAllRatioHighlights();
    }

    handleLegatoModeChanged(event) {
        if (event && typeof event.detail?.enabled === 'boolean') {
            this.legatoModeActive = !!event.detail.enabled;
        } else {
            this.legatoModeActive = this.isLegatoEnabled();
        }
    }

    handleLayerNoteTriggered(event) {
        const detail = event?.detail;
        if (!detail) return;

        const layerIndex = typeof detail.layerIndex === 'number' ? detail.layerIndex : null;
        const ratioFractionRaw = detail.ratioFraction;
        const ratioFraction = typeof ratioFractionRaw === 'string' ? ratioFractionRaw.trim() : ratioFractionRaw;

        if (layerIndex === null || layerIndex < 0 || layerIndex >= this.activeLayerRatios.length) return;
        if (!ratioFraction) return;

        if (typeof detail.legato === 'boolean') {
            this.legatoModeActive = detail.legato;
        }

        const eventTimestamp = Number.isFinite(detail.timestamp) ? detail.timestamp : performance.now();
        const highlightDurationMs = this.calculateHighlightDurationMs(layerIndex, detail.durationSeconds);
        const expiresAt = eventTimestamp + highlightDurationMs;

        let layerState = this.layerHighlightStates[layerIndex];

        if (layerState.ratio && layerState.ratio !== ratioFraction) {
            this.removeLayerHighlight(layerState.ratio, layerIndex);
            layerState = this.layerHighlightStates[layerIndex];
        }

        if (layerState.ratio === ratioFraction) {
            this.extendLayerHighlight(layerIndex, expiresAt);
        } else {
            this.applyRatioHighlight(ratioFraction, layerIndex, expiresAt);
        }
    }

    isLayerVisible(layerName) {
        return this.visibleLayerSlices.has(layerName);
    }

    setVisibleLayers(layers) {
        const newLayers = layers instanceof Set ? new Set(layers) :
            Array.isArray(layers) ? new Set(layers) :
            new Set(this.layerNames);
        this.visibleLayerSlices = newLayers;

        // Remove arc highlights for hidden layers
        this.layerDiscs.forEach((disc, index) => {
            if (!this.isLayerVisible(disc.layerName)) {
                this.currentLitArcs.delete(index);
            } else if (this.isAnimating) {
                this.currentLitArcs.add(index);
            }
        });

        // Clear ratio highlights for hidden layers
        this.layerHighlightStates.forEach((state, layerIndex) => {
            const layerName = this.layerNames[layerIndex];
            if (!this.isLayerVisible(layerName) && state.ratio) {
                this.removeLayerHighlight(state.ratio, layerIndex);
            }
        });
    }

    syncInitialSelectionState() {
        if (window.toneRowPlayback && window.toneRowPlayback.selectedNotes) {
            this.setVisibleRatios(Array.from(window.toneRowPlayback.selectedNotes));
        } else {
            this.setVisibleRatios(null);
        }
    }

    handleScaleSelectionChanged(event) {
        const selected = event?.detail?.selectedNotes;
        if (Array.isArray(selected)) {
            this.setVisibleRatios(selected);
            if (!this.isAnimating) {
                this.draw();
            }
        }
    }

    setVisibleRatios(ratios) {
        if (ratios === null || ratios === undefined) {
            this.visibleRatios = null;
        } else if (ratios instanceof Set) {
            this.visibleRatios = ratios.size > 0 ? new Set(ratios) : new Set();
        } else if (Array.isArray(ratios)) {
            this.visibleRatios = ratios.length > 0 ? new Set(ratios.map(r => typeof r === 'string' ? r.trim() : r)) : new Set();
        } else {
            this.visibleRatios = null;
        }

        this.updateRatioVisibility();
    }

    isRatioVisible(ratioFraction) {
        if (!ratioFraction) return false;
        if (!this.visibleRatios || this.visibleRatios.size === 0) {
            // When null -> all visible, when empty set -> none visible
            return this.visibleRatios === null;
        }
        return this.visibleRatios.has(ratioFraction);
    }

    updateRatioVisibility() {
        if (!this.ratioRing) return;

        this.ratioHighlightCounts.forEach((_, fraction) => {
            if (!this.isRatioVisible(fraction)) {
                this.ratioHighlightCounts.delete(fraction);
            }
        });

        this.ratioRing.forEach(point => {
            const isVisible = this.isRatioVisible(point.ratio);
            point.hidden = !isVisible;
            if (!isVisible) {
                point.isLit = false;
                point.litIntensity = 0;
                if (point.activeLayers) {
                    point.activeLayers.clear();
                }
            }
        });

        this.layerHighlightStates.forEach((state, layerIndex) => {
            if (state.ratio && !this.isRatioVisible(state.ratio)) {
                this.removeLayerHighlight(state.ratio, layerIndex);
            }
        });
    }

    isLegatoEnabled() {
        if (typeof this.legatoModeActive === 'boolean') {
            return this.legatoModeActive;
        }
        return !!(window.toneRowPlayback && window.toneRowPlayback.legatoEnabled);
    }

    calculateHighlightDurationMs(layerIndex, durationSeconds) {
        let durationMs = Number.isFinite(durationSeconds) ? durationSeconds * 1000 : NaN;
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            const rhythmValue = this.rhythms && this.rhythms[layerIndex] ? this.rhythms[layerIndex] : 0;
            if (rhythmValue > 0) {
                durationMs = this.cycleDuration / rhythmValue;
            } else {
                durationMs = this.cycleDuration;
            }
        }
        return Math.max(durationMs, 1);
    }

    parseFractionToDecimal(fraction) {
        if (!fraction) return null;
        const trimmed = fraction.trim();
        if (trimmed.length === 0) return null;

        if (trimmed.includes('/')) {
            const [numeratorStr, denominatorStr] = trimmed.split('/');
            const numerator = Number(numeratorStr);
            const denominator = Number(denominatorStr);
            if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
                return null;
            }
            return numerator / denominator;
        }

        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? numeric : null;
    }

    findClosestRatioIndex(decimalValue) {
        if (!Number.isFinite(decimalValue) || this.ratioRing.length === 0) return null;

        let bestIndex = null;
        let smallestDiff = Infinity;

        this.ratioRing.forEach((point, index) => {
            const pointDecimal = this.ratioToDecimal(point.ratio);
            if (!Number.isFinite(pointDecimal)) return;
            const diff = Math.abs(pointDecimal - decimalValue);
            if (diff < smallestDiff) {
                smallestDiff = diff;
                bestIndex = index;
            }
        });

        if (bestIndex !== null && smallestDiff < 1e-3) {
            return bestIndex;
        }

        return null;
    }

    getRatioIndexForFraction(ratioFraction) {
        if (!ratioFraction) return null;
        const trimmed = ratioFraction.trim();
        if (trimmed.length === 0) return null;

        if (this.ratioIndexLookup.has(trimmed)) {
            return this.ratioIndexLookup.get(trimmed);
        }

        if (this.ratioIndexLookup.has(ratioFraction)) {
            return this.ratioIndexLookup.get(ratioFraction);
        }

        const decimal = this.parseFractionToDecimal(trimmed);
        if (decimal !== null) {
            const fallbackIndex = this.findClosestRatioIndex(decimal);
            if (fallbackIndex !== null) {
                this.ratioIndexLookup.set(trimmed, fallbackIndex);
                return fallbackIndex;
            }
        }

        console.log(`🌀 Centrifuge could not match ratio ${ratioFraction} to ring`);
        return null;
    }

    ensureRatioLit(ratioIndex) {
        if (ratioIndex === null || ratioIndex === undefined) return;
        const ratioPoint = this.ratioRing[ratioIndex];
        if (!ratioPoint) return;
        if (!ratioPoint.displayColor || ratioPoint.displayColor === '#fff') {
            this.updateRatioDisplayColor(ratioIndex);
        }
        ratioPoint.isLit = true;
        ratioPoint.litIntensity = 1;
    }

    ensureRatioCleared(ratioIndex) {
        if (ratioIndex === null || ratioIndex === undefined) return;
        const ratioPoint = this.ratioRing[ratioIndex];
        if (!ratioPoint) return;
        if (ratioPoint.activeLayers) {
            ratioPoint.activeLayers.clear();
        } else {
            ratioPoint.activeLayers = new Set();
        }
        ratioPoint.displayColor = '#fff';
        ratioPoint.isLit = false;
        ratioPoint.litIntensity = 0;
    }

    addLayerToRatio(ratioIndex, layerIndex) {
        const ratioPoint = this.ratioRing[ratioIndex];
        if (!ratioPoint) return;
        if (!ratioPoint.activeLayers) {
            ratioPoint.activeLayers = new Set();
        }
        ratioPoint.activeLayers.add(layerIndex);
        this.updateRatioDisplayColor(ratioIndex);
    }

    removeLayerFromRatio(ratioIndex, layerIndex) {
        const ratioPoint = this.ratioRing[ratioIndex];
        if (!ratioPoint || !ratioPoint.activeLayers) return;
        ratioPoint.activeLayers.delete(layerIndex);
        if (ratioPoint.activeLayers.size > 0) {
            this.updateRatioDisplayColor(ratioIndex);
        } else {
            ratioPoint.displayColor = '#00ff88';
        }
    }

    updateRatioDisplayColor(ratioIndex) {
        const ratioPoint = this.ratioRing[ratioIndex];
        if (!ratioPoint) return;

        const activeLayers = ratioPoint.activeLayers || new Set();
        if (activeLayers.size === 0) {
            ratioPoint.displayColor = '#00ff88';
            return;
        }

        const colors = [];
        activeLayers.forEach(layerIndex => {
            const layerName = this.layerNames[layerIndex];
            const layerColor = this.layerColors[layerName];
            if (layerColor) {
                const normalized = this.normalizeHexColor(layerColor);
                if (normalized) {
                    colors.push(normalized);
                }
            }
        });

        if (colors.length === 0) {
            ratioPoint.displayColor = '#00ff88';
            return;
        }

        ratioPoint.displayColor = this.blendColors(colors);
    }

    normalizeHexColor(hexColor) {
        if (!hexColor || typeof hexColor !== 'string') return null;
        let value = hexColor.trim();
        if (!value.startsWith('#')) return null;
        value = value.slice(1);
        if (value.length === 3) {
            value = value.split('').map(char => char + char).join('');
        } else if (value.length === 8) {
            value = value.slice(0, 6);
        }
        if (value.length !== 6) return null;
        return `#${value.toLowerCase()}`;
    }

    blendColors(hexColors) {
        if (!hexColors || hexColors.length === 0) return '#00ff88';
        if (hexColors.length === 1) return hexColors[0];

        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let counted = 0;

        hexColors.forEach(hex => {
            const rgb = this.hexToRgb(hex);
            if (rgb) {
                totalR += rgb.r;
                totalG += rgb.g;
                totalB += rgb.b;
                counted += 1;
            }
        });

        if (counted === 0) return '#00ff88';

        return this.rgbToHex({
            r: Math.round(totalR / counted),
            g: Math.round(totalG / counted),
            b: Math.round(totalB / counted)
        });
    }

    hexToRgb(hex) {
        if (!hex || typeof hex !== 'string') return null;
        let value = hex.trim();
        if (value.startsWith('#')) {
            value = value.slice(1);
        }
        if (value.length === 3) {
            value = value.split('').map(char => char + char).join('');
        } else if (value.length === 8) {
            value = value.slice(0, 6);
        }
        if (value.length !== 6) return null;

        const r = parseInt(value.slice(0, 2), 16);
        const g = parseInt(value.slice(2, 4), 16);
        const b = parseInt(value.slice(4, 6), 16);

        if ([r, g, b].some(component => Number.isNaN(component))) {
            return null;
        }

        return { r, g, b };
    }

    rgbToHex({ r, g, b }) {
        const clamp = (value) => Math.max(0, Math.min(255, value));
        const toHex = (value) => clamp(value).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    applyRatioHighlight(ratioFraction, layerIndex, expiresAt) {
        if (!ratioFraction) return;

        const fractionKey = typeof ratioFraction === 'string' ? ratioFraction.trim() : `${ratioFraction}`;
        if (!fractionKey) return;

        const ratioIndex = this.getRatioIndexForFraction(fractionKey);
        if (ratioIndex === null) return;

        const layerName = this.layerNames[layerIndex];
        if (!this.isLayerVisible(layerName)) {
            this.removeLayerHighlight(fractionKey, layerIndex);
            return;
        }

        if (!this.isRatioVisible(fractionKey)) {
            this.removeLayerHighlight(fractionKey, layerIndex);
            return;
        }

        const currentCount = this.ratioHighlightCounts.get(fractionKey) || 0;
        this.ratioHighlightCounts.set(fractionKey, currentCount + 1);

        this.addLayerToRatio(ratioIndex, layerIndex);
        this.ensureRatioLit(ratioIndex);

        this.activeLayerRatios[layerIndex] = fractionKey;
        this.layerHighlightStates[layerIndex] = {
            ratio: fractionKey,
            ratioIndex,
            expiresAt
        };
        this.hasReceivedNoteEvent = true;
    }

    extendLayerHighlight(layerIndex, newExpiresAt) {
        const state = this.layerHighlightStates[layerIndex];
        if (!state || !state.ratio) return;

        const layerName = this.layerNames[layerIndex];
        if (!this.isLayerVisible(layerName)) {
            this.removeLayerHighlight(state.ratio, layerIndex);
            return;
        }

        if (!this.isRatioVisible(state.ratio)) {
            this.removeLayerHighlight(state.ratio, layerIndex);
            return;
        }

        state.expiresAt = Math.max(state.expiresAt, newExpiresAt);
        this.updateRatioDisplayColor(state.ratioIndex);
        this.ensureRatioLit(state.ratioIndex);
    }

    removeLayerHighlight(ratioFraction, layerIndex) {
        if (!ratioFraction) return;

        const fractionKey = typeof ratioFraction === 'string' ? ratioFraction.trim() : `${ratioFraction}`;
        if (!fractionKey) return;

        const state = this.layerHighlightStates[layerIndex];
        if (!state || state.ratio !== fractionKey) return;

        if (state.ratioIndex === null || state.ratioIndex === undefined) {
            this.ratioHighlightCounts.delete(fractionKey);
            this.activeLayerRatios[layerIndex] = null;
            this.layerHighlightStates[layerIndex] = {
                ratio: null,
                ratioIndex: null,
                expiresAt: 0
            };
            this.clearAllRatioHighlights();
            if (!this.areAnyHighlightsActive()) {
                this.hasReceivedNoteEvent = false;
            }
            return;
        }

        this.removeLayerFromRatio(state.ratioIndex, layerIndex);

        const currentCount = this.ratioHighlightCounts.get(fractionKey) || 0;
        const newCount = Math.max(currentCount - 1, 0);
        if (newCount <= 0) {
            this.ratioHighlightCounts.delete(fractionKey);
            this.ensureRatioCleared(state.ratioIndex);
        } else {
            this.ratioHighlightCounts.set(fractionKey, newCount);
            this.ensureRatioLit(state.ratioIndex);
        }

        this.activeLayerRatios[layerIndex] = null;
        this.layerHighlightStates[layerIndex] = {
            ratio: null,
            ratioIndex: null,
            expiresAt: 0
        };

        if (!this.areAnyHighlightsActive()) {
            this.hasReceivedNoteEvent = false;
        }
    }

    areAnyHighlightsActive() {
        return this.layerHighlightStates.some(state => state.ratio !== null);
    }

    updateExpiredHighlights(currentTime) {
        this.layerHighlightStates.forEach((state, layerIndex) => {
            if (!state.ratio) return;
            if (currentTime >= state.expiresAt) {
                this.removeLayerHighlight(state.ratio, layerIndex);
            }
        });
    }

    clearAllRatioHighlights() {
        this.ratioHighlightCounts.clear();
        this.activeLayerRatios = [null, null, null, null];
        this.layerHighlightStates = this.layerNames.map(() => ({
            ratio: null,
            ratioIndex: null,
            expiresAt: 0
        }));
        this.hasReceivedNoteEvent = false;
        this.currentLitRatio = -1;

        this.ratioRing.forEach(point => {
            if (point.activeLayers) {
                point.activeLayers.clear();
            } else {
                point.activeLayers = new Set();
            }
            point.displayColor = '#fff';
            point.isLit = false;
            point.litIntensity = 0;
        });
    }

    updateData(spacesPlot, rhythms, grid, ratios) {
        this.spacesPlot = spacesPlot || [];
        this.rhythms = rhythms || [1, 1, 1, 1];
        this.grid = grid || 1;
        this.ratios = ratios || [];
        this.cumulativeTimes = null;
        
        console.log('🌀 Centrifuge updateData called with ratios:', ratios);
        
        // Extract unique ratios excluding 2/1 (octave)
        this.uniqueRatios = this.extractUniqueRatios(ratios);
        
        // Calculate layer disc properties
        this.calculateLayerDiscs();
        
        // Setup ratio ring
        this.setupRatioRing();
        
        console.log('🌀 Centrifuge data updated:', {
            spacesLength: this.spacesPlot.length,
            rhythms: this.rhythms,
            grid: this.grid,
            originalRatios: ratios.length,
            uniqueRatios: this.uniqueRatios.length,
            uniqueRatiosList: this.uniqueRatios,
            hasLayerMap: !!this.parent.layerMap,
            layerMapLength: this.parent.layerMap ? this.parent.layerMap.length : 0
        });
    }

    extractUniqueRatios(ratios) {
        const unique = new Set();
        
        ratios.forEach(ratioObj => {
            // Handle both object format (from LRCModule) and string format
            let ratioString;
            if (typeof ratioObj === 'object' && ratioObj.fraction) {
                ratioString = ratioObj.fraction;
            } else if (typeof ratioObj === 'string') {
                ratioString = ratioObj;
            } else {
                console.log('🌀 Skipping unknown ratio format:', ratioObj);
                return;
            }
            
            // Exclude 2/1 (octave)
            if (ratioString !== '2/1') {
                unique.add(ratioString);
            }
        });
        
        // Convert to array and sort properly
        let sortedRatios = Array.from(unique);
        
        // Sort ratios numerically (convert fractions to decimals for sorting)
        sortedRatios.sort((a, b) => {
            const valueA = this.ratioToDecimal(a);
            const valueB = this.ratioToDecimal(b);
            return valueA - valueB;
        });
        
        console.log('🌀 Extracted and sorted ratios:', sortedRatios);
        return sortedRatios;
    }

    ratioToDecimal(ratio) {
        const [numerator, denominator] = ratio.split('/').map(Number);
        return numerator / denominator;
    }

    setupRatioRing() {
        this.ratioRing = [];
        this.ratioIndexLookup.clear();
        
        if (this.uniqueRatios.length === 0) {
            console.log('🌀 No unique ratios to create ring');
            this.clearAllRatioHighlights();
            return;
        }
        
        // Ensure 1/1 is first (it should be from sorting, but double-check)
        let orderedRatios = [...this.uniqueRatios];
        const oneOverOneIndex = orderedRatios.indexOf('1/1');
        if (oneOverOneIndex > 0) {
            // Move 1/1 to front if it's not already there
            orderedRatios.splice(oneOverOneIndex, 1);
            orderedRatios.unshift('1/1');
        }
        
        const angleStep = (Math.PI * 2) / orderedRatios.length;
        
        orderedRatios.forEach((ratio, index) => {
            // Start at top (1/1) and go clockwise
            const angle = -Math.PI / 2 + (index * angleStep);
            
            this.ratioRing.push({
                ratio: ratio,
                angle: angle,
                x: 0, // Will be calculated in draw()
                y: 0,
                isLit: false,
                litIntensity: 0,
                activeLayers: new Set(),
                displayColor: '#fff',
                hidden: false
            });

            this.ratioIndexLookup.set(ratio, index);
        });

        this.clearAllRatioHighlights();
        this.updateRatioVisibility();

        console.log(`🌀 Created ratio ring with ${this.ratioRing.length} ratios:`, 
                    this.ratioRing.map(r => r.ratio));
    }

    calculateLayerDiscs() {
        this.layerDiscs = [];
        this.previousAngles = [];
        const activeRhythms = this.rhythms.filter(r => r > 1);
        
        activeRhythms.forEach((rhythm, index) => {
            const groupingSize = this.grid / rhythm;
            const normalizedRadius = groupingSize / Math.max(...activeRhythms.map(r => this.grid / r));
            
            this.layerDiscs.push({
                rhythm: rhythm,
                groupingSize: groupingSize,
                normalizedRadius: normalizedRadius,
                color: this.layerColors[['A', 'B', 'C', 'D'][this.rhythms.indexOf(rhythm)]],
                layerName: ['A', 'B', 'C', 'D'][this.rhythms.indexOf(rhythm)],
                rotationsPerCycle: rhythm,
                currentAngle: -Math.PI / 2, // Start at top (0 degrees)
                completedRotations: 0 // Track completed rotations
            });
            
            this.previousAngles.push(-Math.PI / 2); // Initialize previous angles
        });
        
        // Sort by radius (largest first)
        this.layerDiscs.sort((a, b) => b.normalizedRadius - a.normalizedRadius);
    }

    setupCanvas() {
        this.canvas = this.parent.canvas;
        this.ctx = this.parent.ctx;
        
        if (!this.canvas || !this.ctx) {
            console.error('🌀 Centrifuge: Canvas not available');
            return false;
        }
        
        this.updateDimensions();
        return true;
    }

    updateDimensions() {
        if (!this.canvas) return;
        
        // Don't interfere with LRCVisuals' canvas setup - use its calculated dimensions
        const logicalWidth = parseInt(this.canvas.style.width) || this.canvas.width;
        const logicalHeight = parseInt(this.canvas.style.height) || this.canvas.height;
        
        this.centerX = logicalWidth / 2;
        this.centerY = logicalHeight / 2;
        this.maxRadius = Math.min(this.centerX, this.centerY) - 60;
    }

    draw() {
        if (this.parent && this.parent.currentPlotType !== 'centrifuge') {
            return;
        }

        if (!this.setupCanvas()) return;
        
        // Clear the canvas using parent's method (which handles DPR scaling correctly)
        this.parent.clearCanvas();
        
        // Update dimensions to match current canvas state
        this.updateDimensions();
        
        // Draw centrifuge elements (no save/restore needed - work with existing context)
        this.drawBackground();
        this.drawRatioRing();
        this.drawLayerDiscs();
        this.drawCenterPoint();
        this.drawDebugInfo();
    }

    drawBackground() {
        // No background circle needed - just individual ratio dots
    }

    drawRatioRing() {
        if (this.ratioRing.length === 0) {
            console.log('🌀 No ratio ring to draw');
            return;
        }
        
        const ringRadius = this.maxRadius + 30; // Move ring OUTSIDE the centrifuge
        
        // console.log(`🌀 Drawing ratio ring with ${this.ratioRing.length} ratios at radius ${ringRadius}`);
        
        this.ratioRing.forEach((ratioPoint, index) => {
            if (ratioPoint.hidden) return;

            ratioPoint.x = this.centerX + ringRadius * Math.cos(ratioPoint.angle);
            ratioPoint.y = this.centerY + ringRadius * Math.sin(ratioPoint.angle);
            
            // Draw individual ratio dot (larger and more visible)
            const intensity = ratioPoint.isLit ? ratioPoint.litIntensity : 0.8;
            const highlightColor = ratioPoint.displayColor || '#00ff88';
            const baseColor = ratioPoint.isLit ? highlightColor : '#fff';
            const dotSize = ratioPoint.isLit ? 8 : 5;
            const activeLayerIndices = ratioPoint.activeLayers ? Array.from(ratioPoint.activeLayers).sort((a, b) => a - b) : [];
            
            this.ctx.globalAlpha = intensity;
            if (ratioPoint.isLit && activeLayerIndices.length > 0) {
                const segmentAngle = (Math.PI * 2) / activeLayerIndices.length;
                activeLayerIndices.forEach((layerIdx, segmentIdx) => {
                    const layerName = this.layerNames[layerIdx];
                    const layerColor = this.normalizeHexColor(this.layerColors[layerName]) || highlightColor;
                    const startAngle = -Math.PI / 2 + segmentIdx * segmentAngle;
                    const endAngle = startAngle + segmentAngle;
                    
                    this.ctx.beginPath();
                    this.ctx.moveTo(ratioPoint.x, ratioPoint.y);
                    this.ctx.arc(ratioPoint.x, ratioPoint.y, dotSize, startAngle, endAngle);
                    this.ctx.closePath();
                    this.ctx.fillStyle = layerColor;
                    this.ctx.fill();
                });
            } else {
                this.ctx.fillStyle = baseColor;
                this.ctx.beginPath();
                this.ctx.arc(ratioPoint.x, ratioPoint.y, dotSize, 0, Math.PI * 2);
                this.ctx.fill();
            }
            this.ctx.globalAlpha = 1;
            
            // Draw ratio label (positioned outside the dot)
            this.ctx.fillStyle = ratioPoint.isLit ? highlightColor : '#ccc';
            this.ctx.font = '11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            
            const labelRadius = ringRadius + 20;
            const labelX = this.centerX + labelRadius * Math.cos(ratioPoint.angle);
            const labelY = this.centerY + labelRadius * Math.sin(ratioPoint.angle);
            
            this.ctx.fillText(ratioPoint.ratio, labelX, labelY);
        });
    }

    drawLayerDiscs() {
        let drawnArcs = [];
        
        this.layerDiscs.forEach((disc, index) => {
            if (!this.isLayerVisible(disc.layerName)) {
                return;
            }
            const discRadius = disc.normalizedRadius * (this.maxRadius - 40);
            
            // Draw disc outline
            this.ctx.strokeStyle = disc.color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.6;
            this.ctx.beginPath();
            this.ctx.arc(this.centerX, this.centerY, discRadius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
            
            // Draw layer dot on radius
            const dotX = this.centerX + discRadius * Math.cos(disc.currentAngle);
            const dotY = this.centerY + discRadius * Math.sin(disc.currentAngle);
            
            this.ctx.fillStyle = disc.color;
            this.ctx.beginPath();
            this.ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Draw arc sector if this layer is lit
            if (this.currentLitArcs.has(index)) {
                this.drawArcSector(index, discRadius, disc.color, disc.currentAngle);
                drawnArcs.push(`${disc.layerName}(${index})`);
            }
        });
        
        // Log drawn arcs every 200th frame
        if (Math.floor(performance.now() / 16) % 200 === 0) {
            //console.log(`🌀 Currently drawing arcs: ${drawnArcs.join(', ')}`);
        }
    }

    drawArcSector(layerIndex, radius, color, currentAngle) {
        const topAngle = -Math.PI / 2; // 0 degrees (top of circle)
        
        // Calculate inner radius (next smaller disc radius, or center if outermost)
        let innerRadius = 0;
        if (layerIndex < this.layerDiscs.length - 1) {
            const nextSmallerDisc = this.layerDiscs[layerIndex + 1];
            innerRadius = nextSmallerDisc.normalizedRadius * (this.maxRadius - 40);
        }
        
        // Determine rotation direction
        const isClockwise = layerIndex % 2 === 0;
        
        // Draw highlighted annular arc segment
        this.ctx.save();
        
        // Create more vibrant version of the color
        const vibrantColor = this.makeColorVibrant(color);
        
        // Draw thick outline arcs (both inner and outer)
        this.ctx.strokeStyle = vibrantColor;
        this.ctx.lineWidth = 4;
        this.ctx.globalAlpha = 0.8;
        
        // Draw arc in the correct direction
        this.ctx.beginPath();
        if (isClockwise) {
            this.ctx.arc(this.centerX, this.centerY, radius, topAngle, currentAngle);
        } else {
            this.ctx.arc(this.centerX, this.centerY, radius, currentAngle, topAngle);
        }
        this.ctx.stroke();
        
        // Inner arc (if there is one)
        if (innerRadius > 0) {
            this.ctx.beginPath();
            if (isClockwise) {
                this.ctx.arc(this.centerX, this.centerY, innerRadius, topAngle, currentAngle);
            } else {
                this.ctx.arc(this.centerX, this.centerY, innerRadius, currentAngle, topAngle);
            }
            this.ctx.stroke();
        }
        
        // Draw filled annular sector
        this.ctx.fillStyle = vibrantColor;
        this.ctx.globalAlpha = 0.4;
        this.ctx.beginPath();
        
        // Create the annular sector path based on direction
        if (isClockwise) {
            // Clockwise: from top to current position
            const startX = this.centerX + innerRadius * Math.cos(topAngle);
            const startY = this.centerY + innerRadius * Math.sin(topAngle);
            this.ctx.moveTo(startX, startY);
            this.ctx.arc(this.centerX, this.centerY, innerRadius, topAngle, currentAngle);
            const outerEndX = this.centerX + radius * Math.cos(currentAngle);
            const outerEndY = this.centerY + radius * Math.sin(currentAngle);
            this.ctx.lineTo(outerEndX, outerEndY);
            this.ctx.arc(this.centerX, this.centerY, radius, currentAngle, topAngle, true);
        } else {
            // Counterclockwise: from current position to top
            const startX = this.centerX + innerRadius * Math.cos(currentAngle);
            const startY = this.centerY + innerRadius * Math.sin(currentAngle);
            this.ctx.moveTo(startX, startY);
            this.ctx.arc(this.centerX, this.centerY, innerRadius, currentAngle, topAngle);
            const outerEndX = this.centerX + radius * Math.cos(topAngle);
            const outerEndY = this.centerY + radius * Math.sin(topAngle);
            this.ctx.lineTo(outerEndX, outerEndY);
            this.ctx.arc(this.centerX, this.centerY, radius, topAngle, currentAngle, true);
        }
        
        this.ctx.closePath();
        this.ctx.fill();
        
        this.ctx.restore();
    }

    makeColorVibrant(hexColor) {
        // Convert hex to more saturated version
        const colorMap = {
            '#ff6b6b': '#ff2020', // More vibrant red
            '#4ecdc4': '#00ffdd', // More vibrant teal  
            '#00a638ff': '#00ff44', // More vibrant green
            '#f9ca24': '#ffdd00'  // More vibrant yellow
        };
        
        return colorMap[hexColor] || hexColor;
    }

    drawCenterPoint() {
        this.ctx.fillStyle = '#00ff88';
        this.ctx.beginPath();
        this.ctx.arc(this.centerX, this.centerY, 3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    drawDebugInfo() {
        // Only show debug info if explicitly enabled (avoid cluttering the production interface)
        if (!window.centrifugeDebug) return;
        
        this.ctx.fillStyle = '#888';
        this.ctx.font = '11px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        const info = [
            `Grid: ${this.grid}`,
            `Layers: ${this.rhythms.filter(r => r > 1).join(':')}`,
            `Ratios: ${this.uniqueRatios.length}`,
            `Spaces: ${this.spacesPlot.length}`
        ];
        
        info.forEach((line, index) => {
            this.ctx.fillText(line, 10, 10 + (index * 14));
        });
    }

    // ====================================
    // ANIMATION SYSTEM
    // ====================================

    startAnimation() {
        if (this.isAnimating) return;
        
        this.isAnimating = true;
        this.startTime = performance.now();
        
        // Reset timing calculation
        this.cumulativeTimes = null;
        
        // Initialize separate rotation tracking array
        this.rotationCounts = this.layerDiscs.map(() => 0);
        
        // Start all discs at the top position
        this.layerDiscs.forEach(disc => {
            disc.currentAngle = -Math.PI / 2; // Start at top
        });
        
        // Initially light up all arcs
        this.currentLitArcs.clear();
        this.layerDiscs.forEach((disc, index) => {
            if (this.isLayerVisible(disc.layerName)) {
                this.currentLitArcs.add(index);
            }
        });
        this.clearAllRatioHighlights();
        
        console.log('🌀 Centrifuge animation started with proper timing sync');
        
        this.animate();
    }

    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.isAnimating = false;
        
        // Reset rotation tracking
        this.rotationCounts = null;
        
        // Reset other state
        this.currentLitRatio = -1;
        this.currentLitArcs.clear();
        this.clearAllRatioHighlights();
        
        this.layerDiscs.forEach(disc => {
            disc.currentAngle = -Math.PI / 2;
        });
        
        console.log('🌀 Centrifuge animation stopped and reset');
    }

    animate() {
        if (!this.isAnimating) return;
        
        const currentTime = performance.now();
        const elapsed = currentTime - this.startTime;
        const progress = (elapsed % this.cycleDuration) / this.cycleDuration;
        
        // Update layer disc rotations and check for crossings
        this.updateLayerRotations(progress);

        // Remove any highlights whose pulse durations have ended
        this.updateExpiredHighlights(currentTime);
        
        // Update ratio ring lighting (separate system)
        this.updateLighting(progress, currentTime);
        
        // Redraw
        this.draw();
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    updateLayerRotations(progress) {
        const topAngle = -Math.PI / 2; // 0 degrees (top of circle)
        const discsThatCrossed = [];
        
        // Initialize rotation tracking if not exists
        if (!this.rotationCounts) {
            this.rotationCounts = this.layerDiscs.map(() => 0);
        }
        
        // STEP 1: Update all disc positions and collect crossings
        this.layerDiscs.forEach((disc, index) => {
            // Get previous rotation count from our tracking array
            const prevRotationCount = this.rotationCounts[index];
            
            // Calculate total rotations
            const totalRotations = disc.rotationsPerCycle * progress;
            const currentRotationCount = Math.floor(totalRotations);
            
            // Determine rotation direction based on layer
            // D(0): clockwise, C(1): counterclockwise, B(2): clockwise, A(3): counterclockwise
            const isClockwise = index % 2 === 0; // Even indices clockwise, odd counterclockwise
            const rotationMultiplier = isClockwise ? 1 : -1;
            
            // Calculate visual angle with direction
            disc.currentAngle = topAngle + (rotationMultiplier * totalRotations * Math.PI * 2) % (Math.PI * 2);
            
            // Debug rotation direction occasionally
            // if (Math.floor(progress * 1000) % 200 === 0 && index === 0) {
            //     console.log(`🌀 Layer ${disc.layerName} (${index}): ${isClockwise ? 'clockwise' : 'counterclockwise'}, angle=${(disc.currentAngle * 180 / Math.PI).toFixed(1)}°`);
            // }
            
            // Check if rotation count increased (crossing detection remains the same)
            if (currentRotationCount > prevRotationCount) {
                discsThatCrossed.push({
                    index: index,
                    layerName: disc.layerName,
                    prevCount: prevRotationCount,
                    newCount: currentRotationCount,
                    direction: isClockwise ? 'CW' : 'CCW'
                });
                
                // console.log(`🌀 *** CROSSING: ${disc.layerName} (${isClockwise ? 'CW' : 'CCW'}) went from ${prevRotationCount} to ${currentRotationCount} rotations ***`);
            }
            
            // Update rotation count in our tracking array
            this.rotationCounts[index] = currentRotationCount;
        });
        
        // STEP 2: If ANY disc crossed, clear ALL arcs and light only the new ones
        if (discsThatCrossed.length > 0) {
            // console.log(`🌀 CLEARING ALL ARCS - Discs that crossed: ${discsThatCrossed.map(d => `${d.layerName}(${d.direction})`).join(', ')}`);
            
            // Clear ALL existing arcs first
            this.currentLitArcs.clear();
            
            // Light up ONLY the discs that just crossed
            discsThatCrossed.forEach(crossedDisc => {
                this.currentLitArcs.add(crossedDisc.index);
            });
            
            // console.log(`🌀 Now lighting arcs: ${discsThatCrossed.map(d => d.layerName).join(', ')}`);
        }
    }  
    
    updateLighting(progress, _currentTime) {
        if (this.ratioRing.length === 0) return;

        // Smooth intensities for currently lit/unlit ratios
        const decayFactor = 0.85;
        const riseFactor = 0.3;

        this.ratioRing.forEach(point => {
            if (point.isLit) {
                const delta = (1 - point.litIntensity) * riseFactor;
                point.litIntensity = Math.min(1, point.litIntensity + delta);
            } else if (point.litIntensity > 0) {
                point.litIntensity = Math.max(0, (point.litIntensity * decayFactor) - 0.02);
            }
        });

        // When driven by playback events, do not override active highlights
        if (this.hasReceivedNoteEvent) {
            return;
        }

        if (this.spacesPlot.length === 0) return;

        // Calculate cumulative times for each spaces plot position if needed
        if (!this.cumulativeTimes) {
            this.cumulativeTimes = [];
            let cumulative = 0;
            const gridTotal = this.spacesPlot.reduce((sum, space) => sum + space, 0);

            this.spacesPlot.forEach((space, index) => {
                this.cumulativeTimes[index] = cumulative / gridTotal;
                cumulative += space;
            });
        }

        // Determine current spaces index from progress
        let currentSpacesIndex = 0;
        for (let i = 0; i < this.cumulativeTimes.length; i++) {
            if (progress >= this.cumulativeTimes[i]) {
                currentSpacesIndex = i;
            } else {
                break;
            }
        }

        const spaceValue = this.spacesPlot[currentSpacesIndex];
        const ratioToLight = this.findRatioForSpaceValue(spaceValue, currentSpacesIndex);

        // Fallback highlight before any playback events have been observed
        this.ratioRing.forEach(point => {
            point.isLit = false;
            point.litIntensity = 0;
            if (!point.activeLayers || point.activeLayers.size === 0) {
                point.displayColor = '#fff';
            }
        });

        if (ratioToLight) {
            const ratioIndex = this.ratioIndexLookup.get(ratioToLight);
            if (ratioIndex !== undefined) {
                const ratioPoint = this.ratioRing[ratioIndex];
                if (ratioPoint && this.isRatioVisible(ratioToLight)) {
                    ratioPoint.isLit = true;
                    ratioPoint.litIntensity = 1;
                    ratioPoint.displayColor = '#00ff88';
                    this.currentLitRatio = ratioIndex;
                }
            }
        }
    }

    findRatioForSpaceValue(spaceValue, spacesIndex) {
        if (this.spacesPlot.length === 0 || this.uniqueRatios.length === 0) return null;
        
        // Calculate ratio the same way as scale generation
        const fundamental = Math.max(...this.spacesPlot);
        let ratio = fundamental / spaceValue;
        
        // Octaviate the ratio (compress to single octave between 1/1 and 2/1)
        while (ratio >= 2) ratio /= 2;
        while (ratio < 1) ratio *= 2;
        
        // Convert to fraction format
        const fraction = this.decimalToFraction(ratio);
        
        // Find this ratio in our unique ratios list
        const matchingRatio = this.uniqueRatios.find(r => r === fraction);
        
        // Debug logging occasionally
        if (spacesIndex % 20 === 0) {
            console.log(`🌀 Space ${spaceValue} → ratio ${ratio.toFixed(4)} → fraction ${fraction} → found: ${!!matchingRatio}`);
        }
        
        return matchingRatio;
    }

    // ====================================
    // PUBLIC API
    // ====================================

    setCycleDuration(duration) {
        this.cycleDuration = duration * 1000; // Convert to ms
        console.log(`🌀 Centrifuge cycle duration set to ${duration}s`);
    }

    /**
     * Update cycle duration and align phase (in ms) without restarting.
     * @param {number} cycleDurationMs
     * @param {number} phaseMs
     */
    setPhase(cycleDurationMs, phaseMs = 0) {
        if (Number.isFinite(cycleDurationMs) && cycleDurationMs > 0) {
            this.cycleDuration = cycleDurationMs;
        }
        if (Number.isFinite(phaseMs)) {
            // Align startTime so that elapsed % cycleDuration = phaseMs
            const now = performance.now();
            const offset = ((phaseMs % this.cycleDuration) + this.cycleDuration) % this.cycleDuration;
            this.startTime = now - offset;
        }
    }

    setVisible(visible) {
        if (visible) {
            this.draw();
        } else {
            this.stopAnimation();
        }
    }
}

// Integration with existing LRCVisuals system
function integrateCentrifugeVisualization() {
    if (!window.lrcVisuals || window.lrcVisuals.__centrifugeIntegrated) return;
    
    console.log('🌀 Starting Centrifuge integration...');
    
    window.lrcVisuals.centrifuge = null;

    const getOrCreateCentrifuge = () => {
        if (!window.lrcVisuals.centrifuge) {
            window.lrcVisuals.centrifuge = new LRCCentrifuge(window.lrcVisuals);
        }
        return window.lrcVisuals.centrifuge;
    };
    
    // Add centrifuge option to existing viz type selector  
    const vizTypeSelect = document.getElementById('viz-type-selector');
    if (vizTypeSelect) {
        // Check if centrifuge option already exists
        const existingOption = vizTypeSelect.querySelector('option[value="centrifuge"]');
        if (!existingOption) {
            const option = document.createElement('option');
            option.value = 'centrifuge';
            option.textContent = 'Centrifuge';
            vizTypeSelect.appendChild(option);
            console.log('🌀 Centrifuge option added to existing viz type selector');
        }
        
        // Add event listener for plot type changes
        vizTypeSelect.addEventListener('change', (e) => {
            if (window.lrcVisuals) {
                window.lrcVisuals.currentPlotType = e.target.value;
                window.lrcVisuals.drawPlot();
            }
        });
    } else {
        console.warn('🌀 Viz type selector not found - will retry later');
        // Try again after a short delay
        setTimeout(integrateCentrifugeVisualization, 500);
        return;
    }
    
    // Store original methods but don't override them immediately
    const originalDrawPlot = window.lrcVisuals.drawPlot.bind(window.lrcVisuals);
    const originalSetupEventListeners = window.lrcVisuals.setupEventListeners.bind(window.lrcVisuals);

    // Only override drawPlot when specifically needed
    window.lrcVisuals.drawPlot = function() {
        if (this.currentPlotType === 'centrifuge') {
            const centrifuge = getOrCreateCentrifuge();
            // Only use centrifuge logic for centrifuge plots
            if (this.spacesPlot && this.spacesPlot.length > 0) {
                this.drawCentrifugePlot();
            } else {
                this.clearCanvas();
            }
        } else {
            // Use completely original method for linear/circular - no interference
            originalDrawPlot();
        }
    };
    
    // Add centrifuge-specific draw method
    window.lrcVisuals.drawCentrifugePlot = function() {
        const centrifuge = getOrCreateCentrifuge();
        
        // Get current ratios from LRCModule
        let currentRatios = [];
        if (window.lrcModule && window.lrcModule.currentRatios) {
            currentRatios = window.lrcModule.currentRatios;
            console.log('🌀 Getting ratios from LRCModule:', currentRatios);
        } else {
            console.log('🌀 No ratios available from LRCModule');
        }
        
        this.centrifuge.updateData(
            this.spacesPlot,
            this.rhythms,
            window.lrcModule ? window.lrcModule.currentGrid : 1,
            currentRatios
        );
        centrifuge.draw();
    };
    
    // Extend animation methods - hook into existing playback events
    const originalStartAnimation = window.lrcVisuals.startAnimation || function() {};
    window.lrcVisuals.startAnimation = function() {
        if (this.currentPlotType === 'centrifuge') {
            const centrifuge = getOrCreateCentrifuge();
            centrifuge.setCycleDuration(this.cycleDuration / 1000);
            centrifuge.startAnimation();
        } else {
            originalStartAnimation.call(this);
        }
    };
    
    const originalStopAnimation = window.lrcVisuals.stopAnimation || function() {};
    window.lrcVisuals.stopAnimation = function() {
        if (this.centrifuge) {
            this.centrifuge.stopAnimation();
        }
        originalStopAnimation.call(this);
    };
    
    // Listen for playback events from ToneRowPlayback
    window.addEventListener('playbackStarted', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'centrifuge') {
            const centrifuge = getOrCreateCentrifuge();
            console.log('🌀 Centrifuge responding to playbackStarted event');
            const cycleDuration = e.detail?.cycleDuration || 10.0;
            centrifuge.setCycleDuration(cycleDuration);
            centrifuge.startAnimation();
            console.log('🌀 Centrifuge animation started with cycle duration:', cycleDuration);
        }
    });
    
    window.addEventListener('playbackStopped', () => {
        if (window.lrcVisuals && window.lrcVisuals.currentPlotType === 'centrifuge' && window.lrcVisuals.centrifuge) {
            console.log('🌀 Centrifuge responding to playbackStopped event');
            window.lrcVisuals.centrifuge.stopAnimation();
            console.log('🌀 Centrifuge animation stopped');
        }
    });
    
    // Also listen for live tempo/cycle updates
    window.addEventListener('playbackTempoChanged', (e) => {
        if (window.lrcVisuals && window.lrcVisuals.centrifuge) {
            const cycleMs = Number.isFinite(e.detail?.cycleDurationMs) ? e.detail.cycleDurationMs : null;
            const phaseMs = Number.isFinite(e.detail?.phaseMs) ? e.detail.phaseMs : 0;
            if (cycleMs != null) {
                window.lrcVisuals.centrifuge.setPhase(cycleMs, phaseMs);
                console.log('🌀 Centrifuge phase/cycle updated:', { cycleMs, phaseMs });
            }
        }
    });
    
    // Extend setCycleDuration
    const originalSetCycleDuration = window.lrcVisuals.setCycleDuration || function() {};
    window.lrcVisuals.setCycleDuration = function(duration) {
        originalSetCycleDuration.call(this, duration);
        if (this.centrifuge) {
            this.centrifuge.setCycleDuration(duration);
        }
    }; 
    
    window.lrcVisuals.__centrifugeIntegrated = true;
    console.log('🌀 Centrifuge visualization integrated with LRC interface');
}

// Integration with existing LRCVisuals system
if (typeof window !== 'undefined') {
    window.LRCCentrifuge = LRCCentrifuge;
    
    // Wait for both DOM and LRCVisuals to be ready
    document.addEventListener('DOMContentLoaded', () => {
        // Give LRCVisuals time to initialize
        setTimeout(() => {
            if (window.lrcVisuals) {
                integrateCentrifugeVisualization();
            } else {
                console.log('🌀 LRCVisuals not ready, waiting...');
                // Check periodically for LRCVisuals
                const checkInterval = setInterval(() => {
                    if (window.lrcVisuals) {
                        clearInterval(checkInterval);
                        integrateCentrifugeVisualization();
                    }
                }, 100);
                
                // Stop checking after 5 seconds
                setTimeout(() => {
                    clearInterval(checkInterval);
                    console.warn('🌀 LRCVisuals not found after 5 seconds');
                }, 5000);
            }
        }, 100);
    });
}
