// LRCModule.js - Core Large Rhythm Collider Module
// Handles mathematical calculations, rhythm generation, and scale analysis

class LRCModule {
    constructor() {
        // Core state
        this.currentRhythms = [8, 7, 6, 5];
        this.currentGrid = 0;
        this.currentCompositeRhythm = [];
        this.currentSpacesPlot = [];
        this.currentSpacesPlotByLayer = [[], [], [], []];
        this.currentLayerMap = []; // Tracks which layers contribute to each position
        this.currentSpacesLayerMap = [];
        this.currentRatios = [];
        this.ratioFrequencies = new Map();
        this.currentSpacesMapping = new Map(); // Maps ratio fractions to spaces plot indices
        
        // Initialize
        this.setupEventListeners();
        console.log('LRC Module initialized');
    }

    // ====================================
    // CORE MATHEMATICAL FUNCTIONS
    // ====================================

    gcd(a, b) {
        a = Math.abs(a);
        b = Math.abs(b);
        while (b) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    lcm(a, b) {
        return (a * b) / this.gcd(a, b);
    }

    calculateTotalLCM(a, b, c, d) {
        const lcmAB = this.lcm(a, b);
        const lcmABC = this.lcm(lcmAB, c);
        return this.lcm(lcmABC, d);
    }

    // ====================================
    // ENHANCED RHYTHM GENERATION WITH LAYER TRACKING
    // ====================================

    generateCompositeRhythm(layers) {
        const filteredLayers = layers.filter(layer => layer > 0);
        if (filteredLayers.length === 0) return { rhythm: [], layerMap: [] };
        
        const totalLCM = this.calculateTotalLCM(...filteredLayers);
        const compositeMap = new Map(); // Track ALL layers for each position
        const layerNames = ['A', 'B', 'C', 'D'];
        
        // Add all multiples for each layer, accumulating layer IDs for each position
        layers.forEach((layer, layerIndex) => {
            if (layer > 0) {
                const groupingSize = totalLCM / layer;
                for (let i = 0; i < layer; i++) {
                    const position = i * groupingSize;
                    
                    if (compositeMap.has(position)) {
                        // Add this layer to existing position
                        compositeMap.get(position).layers.push(layerNames[layerIndex]);
                    } else {
                        // Create new position with this layer
                        compositeMap.set(position, {
                            position: position,
                            layers: [layerNames[layerIndex]]
                        });
                    }
                }
            }
        });
        
        // Sort by position and store complete layer tracking info
        const sortedEntries = Array.from(compositeMap.values()).sort((a, b) => a.position - b.position);
        const rhythm = sortedEntries.map(entry => entry.position);
        const layerMap = sortedEntries.map(entry => entry.layers);
        
        return { rhythm, layerMap };
    }

    generateSpacesPlot(compositeRhythm, totalLCM, layerMap) {
        if (compositeRhythm.length === 0) return { spacesPlot: [], spacesLayerMap: [] };
        
        const spacesPlot = [];
        const spacesLayerMap = [];
        
        // Calculate spaces between consecutive values
        for (let i = 0; i < compositeRhythm.length - 1; i++) {
            const currentValue = compositeRhythm[i];
            const nextValue = compositeRhythm[i + 1];
            const spaceValue = nextValue - currentValue;
            
            spacesPlot.push(spaceValue);
            
            // The space/duration is owned by whichever layer(s) generate the CURRENT attack point
            const spaceLayers = layerMap[i] || ['Composite'];
            spacesLayerMap.push(spaceLayers);
        }

        // Add wraparound space
        const lastValue = compositeRhythm[compositeRhythm.length - 1];
        const firstValue = compositeRhythm[0];
        const wraparoundSpace = totalLCM - lastValue + firstValue;
        spacesPlot.push(wraparoundSpace);

        // Wraparound space is owned by the last attack
        const wraparoundLayers = layerMap[layerMap.length - 1] || ['Composite'];
        spacesLayerMap.push(wraparoundLayers);
        
        return { spacesPlot, spacesLayerMap };
    }

    // ====================================
    // SPACES PLOT BY LAYER CALCULATION
    // ====================================

    calculateSpacesPlotByLayer(spacesPlot, spacesLayerMap, layers = null) {
        const spacesPlotByLayer = [[], [], [], []]; // [A, B, C, D]
        
        // Use provided layers or fallback to current (for standalone calculations)
        const rhythmsToUse = layers || this.currentRhythms;
        
        // For each active layer, find the space values at positions where that layer has attacks
        rhythmsToUse.forEach((layerValue, layerIndex) => {
            if (layerValue > 0) {
                const layerLetter = ['A', 'B', 'C', 'D'][layerIndex];
                const groupingSize = this.currentGrid / layerValue;
                
                // Generate the positions where this layer has attacks
                const layerPositions = [];
                for (let i = 0; i < layerValue; i++) {
                    layerPositions.push(i * groupingSize);
                }
                
                // Find the corresponding space values from the full spaces plot
                // Each layer position corresponds to a space in the composite rhythm
                const layerSpaces = [];
                for (let pos of layerPositions) {
                    // Find this position in the composite rhythm and get its corresponding space
                    const compositeIndex = this.currentCompositeRhythm.indexOf(pos);
                    if (compositeIndex >= 0 && compositeIndex < spacesPlot.length) {
                        layerSpaces.push(spacesPlot[compositeIndex]);
                    }
                }
                
                spacesPlotByLayer[layerIndex] = layerSpaces;
            }
        });
        
        return spacesPlotByLayer;
    }

    // ====================================
    // FUNDAMENTAL AND RANGE CALCULATIONS
    // ====================================

    calculateFundamental() {
        // Fundamental = Grid / Layer A (fastest layer)
        const activeLayers = this.currentRhythms.filter(layer => layer > 0);
        if (activeLayers.length === 0) return 0;
        
        const layerA = Math.max(...activeLayers); // Fastest layer
        return this.currentGrid / layerA;
    }

    calculateRange() {
        // Range = quotient between fastest and slowest layer
        // Exclude layer values of 1 (inactive layers)
        const activeLayers = this.currentRhythms.filter(layer => layer > 1);
        if (activeLayers.length === 0) return 0;

        const fastest = Math.max(...activeLayers);
        const slowest = Math.min(...activeLayers);
        return fastest / slowest;
    }

    calculatePulseToGrouping() {
        // P/G = (sum of layer values) / (sum of groupings)
        // Exclude layers with value 1 from both calculations
        const activeLayers = this.currentRhythms.filter(layer => layer > 1);
        if (activeLayers.length === 0) return 0;

        const layerSum = activeLayers.reduce((sum, layer) => sum + layer, 0);
        const groupingSum = activeLayers.reduce((sum, layer) => sum + (this.currentGrid / layer), 0);

        return groupingSum > 0 ? layerSum / groupingSum : 0;
    }

    getRhythmInfoData() {
        const activeLayers = this.currentRhythms.filter(layer => layer > 0);
        const displayLayers = activeLayers.filter(layer => layer > 1);
        const layersForDisplay = displayLayers.length > 0 ? displayLayers : [...activeLayers];
        const displayGroupings = layersForDisplay.map(layer => Math.round(this.currentGrid / layer));

        const fundamental = this.calculateFundamental();
        const range = this.calculateRange();
        const pulseToGrouping = this.calculatePulseToGrouping();

        // Calculate average deviation only for 12-tone scales
        const uniqueTones = new Set(this.currentRatios.map(r => r.fraction));
        uniqueTones.delete("2/1"); // Exclude octave
        const avgDeviation = uniqueTones.size === 12 ? this.calculateAverageDeviation(this.currentSpacesPlot) : null;

        // Calculate additional metrics
        const contributingLayers = this.currentRhythms.filter(layer => layer > 1);
        const layerSum = contributingLayers.reduce((sum, layer) => sum + layer, 0);
        const density = this.currentGrid > 0 ? (layerSum / this.currentGrid) * 100 : 0;



        return {
            layers: activeLayers,
            displayLayers: layersForDisplay,
            displayGroupings: displayGroupings,
            grid: this.currentGrid,
            fundamental: fundamental,
            range: range,
            pulseToGrouping: pulseToGrouping,
            avgDeviation: avgDeviation,
            density: density,
            compositeLength: this.currentCompositeRhythm.length,
            layerSum: layerSum,
            pitchCount: uniqueTones.size,
            spacesPlotByLayer: this.currentSpacesPlotByLayer,
            compositeRhythm: this.currentCompositeRhythm
        };
    }

    // ====================================
    // ENHANCED RATIO ANALYSIS WITH FREQUENCY TRACKING
    // ====================================

    generateRatiosWithFrequency(spacesPlot) {
        if (spacesPlot.length === 0) return { ratios: [], frequencies: new Map(), spacesMapping: new Map() };
        
        // Reset frequency tracking
        this.ratioFrequencies.clear();
        
        const fundamental = Math.max(...spacesPlot);
        const ratioMap = new Map();
        const spacesMapping = new Map(); // Maps fraction -> array of spaces plot indices
        
        // Single pass through spaces plot - count frequency, sum grid occupation, AND track indices
        spacesPlot.forEach((space, index) => {
            if (space > 0) {
                // Convert space to ratio and compress to single octave
                let ratio = fundamental / space;
                while (ratio >= 2) ratio /= 2;
                while (ratio < 1) ratio *= 2;
                
                const fraction = this.decimalToFraction(ratio);
                
                // Track frequency count and grid occupation sum
                if (ratioMap.has(fraction)) {
                    const existing = ratioMap.get(fraction);
                    existing.frequency++;
                    existing.gridOccupation += space;
                } else {
                    ratioMap.set(fraction, {
                        ratio: ratio,
                        fraction: fraction,
                        cents: this.ratioToCents(ratio),
                        frequency: 1,
                        gridOccupation: space
                    });
                }
                
                // Track spaces plot indices for this fraction
                if (!spacesMapping.has(fraction)) {
                    spacesMapping.set(fraction, []);
                }
                spacesMapping.get(fraction).push(index);
            }
        });
        
        // Store final frequencies
        ratioMap.forEach((ratioData, fraction) => {
            this.ratioFrequencies.set(fraction, ratioData.frequency);
        });
        
        return {
            ratios: Array.from(ratioMap.values()).sort((a, b) => a.ratio - b.ratio),
            frequencies: this.ratioFrequencies,
            spacesMapping: spacesMapping
        };
    }

    calculateAverageDeviation(spacesPlot) {
        if (!spacesPlot || spacesPlot.length === 0) {
            return null;
        }
        
        const fundamental = spacesPlot[0];
        const ratios = new Set(["1/1"]); // Always include 1/1
        let centsValues = [0]; // Array to store all cents values
        
        spacesPlot.forEach(space => {
            if (space === fundamental) return;
            let denominator = space;
            while (denominator <= fundamental) {
                const ratio = fundamental / denominator;
                if (ratio > 1 && ratio <= 2) {
                    const gcd = this.gcd(fundamental, denominator);
                    const simplifiedNumerator = fundamental / gcd;
                    const simplifiedDenominator = denominator / gcd;
                    const ratioStr = `${simplifiedNumerator}/${simplifiedDenominator}`;
                    ratios.add(ratioStr);
                    const centsValue = this.ratioToCents(simplifiedNumerator / simplifiedDenominator);
                    centsValues.push(centsValue);
                }
                denominator *= 2;
            }
        });
        
        // Sort and normalize the cents values to the same octave
        centsValues = centsValues.map(c => Number((c % 1200).toFixed(20))).sort((a, b) => a - b);
        
        // For deviation calculation, ensure we have exactly 13 values including the octave
        const deviationCentsValues = [...new Set(centsValues)];
        deviationCentsValues.push(1200);
        
        // Only calculate for 12-tone scales (13 values including octave)
        if (deviationCentsValues.length !== 13) {
            return null;
        }
        
        const deviations = [];
        for (let i = 1; i < deviationCentsValues.length; i++) {
            const intervalDistance = deviationCentsValues[i] - deviationCentsValues[i - 1];
            const deviation = Math.abs(100 - intervalDistance);
            deviations.push(deviation);
        }
        
        // Calculate average deviation
        const totalDeviation = deviations.reduce((sum, deviation) => sum + deviation, 0);
        return deviations.length > 0 ? totalDeviation / deviations.length : null;
    }

    // ====================================
    // TONE ROW GENERATION FUNCTIONS
    // ====================================

    generateToneRowData(spacesPlot, fundamentalFreq = 110) {
        if (!spacesPlot || spacesPlot.length === 0) return [];
        
        const fundamental = Math.max(...spacesPlot); // Largest space as fundamental
        const toneRowData = [];
        
        spacesPlot.forEach((space, index) => {
            const ratio = fundamental / space;
            const frequency = fundamentalFreq * ratio;
            
            // Calculate octave for MIDI export
            let octave = 1;
            let tempRatio = ratio;
            while (tempRatio >= 2) {
                tempRatio /= 2;
                octave++;
            }
            
            toneRowData.push({
                index: index,
                spaceValue: space,
                ratio: ratio,
                frequency: frequency,
                octave: octave,
                cents: this.ratioToCents(ratio)
            });
        });
        
        return toneRowData;
    }

    generateToneRowDataByLayer(spacesPlotByLayer, fundamentalFreq = 110) {
        return spacesPlotByLayer.map(layerSpaces => {
            return this.generateToneRowData(layerSpaces, fundamentalFreq);
        });
    }

    // ====================================
    // UTILITY FUNCTIONS
    // ====================================

    decimalToFraction(decimal) {
        const tolerance = 1e-6;
        let numerator = 1;
        let denominator = 1;
        let minError = Math.abs(decimal - 1);
        
        for (let d = 1; d <= 1000; d++) {
            const n = Math.round(decimal * d);
            const error = Math.abs(decimal - n/d);
            
            if (error < minError) {
                minError = error;
                numerator = n;
                denominator = d;
                
                if (error < tolerance) break;
            }
        }
        
        // Simplify fraction
        const gcd = this.gcd(numerator, denominator);
        return `${numerator / gcd}/${denominator / gcd}`;
    }

    ratioToCents(ratio) {
        return Math.log2(ratio) * 1200;
    }

    checkSpecialScale(ratios, targetPitches = 12) {
        const uniqueTones = new Set(ratios.map(r => r.fraction));
        uniqueTones.delete("2/1"); // Exclude the octave
        return uniqueTones.size === targetPitches;
    }

    // ====================================
    // EVENT LISTENERS AND UI INTERACTION
    // ====================================

    setupEventListeners() {
        // Form submission is now handled by LRCHudController to prevent duplicate listeners
        // LRCHudController calls setRhythms() which calls generateRhythm()

        // Individual input change handlers for real-time updates
        ['layer-a', 'layer-b', 'layer-c', 'layer-d'].forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', () => {
                    // Could add real-time preview here
                });
            }
        });

        // Toggle buttons for collapsible sections
        this.setupToggleButtons();
    }

    setupToggleButtons() {
        const toggleButtons = [
            { btn: 'toggle-scale', content: 'scale-content' },
            { btn: 'toggle-visualization', content: 'visualization-content' },
            { btn: 'toggle-playback', content: 'playback-content' },
            { btn: 'toggle-export', content: 'export-content' },
            { btn: 'toggle-search', content: 'search-content' }
        ];

        toggleButtons.forEach(({ btn, content }) => {
            const button = document.getElementById(btn);
            const contentEl = document.getElementById(content);
            
            if (button && contentEl) {
                button.addEventListener('click', () => {
                    const isVisible = contentEl.style.display !== 'none';
                    contentEl.style.display = isVisible ? 'none' : 'block';
                    
                    // Update button text to show +/− symbols
                    const baseText = button.textContent.replace(/[+−]/g, '').trim();
                    button.textContent = baseText + (isVisible ? ' +' : ' −');
                });
            }
        });
    }

    // ====================================
    // MAIN GENERATION FUNCTION
    // ====================================

    generateRhythm() {
        console.log('Generating rhythm...');
        
        // CRITICAL: Stop all systems before generating new rhythm
        this.stopAllSystems();
        
        // Get input values
        const layerA = parseInt(document.getElementById('layer-a').value) || 0;
        const layerB = parseInt(document.getElementById('layer-b').value) || 0;
        const layerC = parseInt(document.getElementById('layer-c').value) || 0;
        const layerD = parseInt(document.getElementById('layer-d').value) || 0;
        
        const layers = [layerA, layerB, layerC, layerD];
        const activeLayers = layers.filter(l => l > 0);
        
        if (activeLayers.length === 0) {
            alert('Please enter at least one valid layer value');
            return;
        }
        
        console.log('Input layers:', layers);
        
        // Calculate grid (LCM)
        this.currentGrid = this.calculateTotalLCM(...activeLayers);
        
        // Generate composite rhythm with layer tracking
        const { rhythm, layerMap } = this.generateCompositeRhythm(layers);
        this.currentCompositeRhythm = rhythm;
        this.currentLayerMap = layerMap;
        
        // Generate spaces plot with layer tracking
        const { spacesPlot, spacesLayerMap } = this.generateSpacesPlot(rhythm, this.currentGrid, layerMap);
        this.currentSpacesPlot = spacesPlot;
        this.currentSpacesLayerMap = spacesLayerMap;
        
        // Calculate spaces plot by layer (pass layers explicitly to avoid race condition)
        this.currentSpacesPlotByLayer = this.calculateSpacesPlotByLayer(spacesPlot, spacesLayerMap, layers);
        
        // Generate ratios with frequency analysis
        const ratioAnalysis = this.generateRatiosWithFrequency(spacesPlot);
        this.currentRatios = ratioAnalysis.ratios;
        this.currentSpacesMapping = ratioAnalysis.spacesMapping;
        
        // Store current rhythms
        this.currentRhythms = layers;
        
        console.log('Generation complete:', {
            grid: this.currentGrid,
            compositeLength: rhythm.length,
            spacesLength: spacesPlot.length,
            ratiosCount: this.currentRatios.length
        });
        
        // Ensure all data is ready before UI updates and event dispatch
        // Use setTimeout to ensure synchronous calculations complete
        setTimeout(() => {
            // Update UI
            this.updateUI();
            
            // Notify other modules (with complete data)
            this.notifyModules();
        }, 0);
    }

    // ====================================
    // SYSTEM CONTROL METHODS
    // ====================================

    stopAllSystems() {
        console.log('🛑 Stopping all systems before rhythm generation...');
        
        // Stop playback system
        if (window.toneRowPlayback && window.toneRowPlayback.stopPlayback) {
            window.toneRowPlayback.stopPlayback();
        }
        
        // Stop any visualization animation (e.g., Hinges) before clearing
        if (window.lrcVisuals && typeof window.lrcVisuals.stopAnimation === 'function') {
            try { window.lrcVisuals.stopAnimation(); } catch(e) { console.warn('stopAnimation failed:', e); }
        }
        // Clear visualization canvas but preserve viz type selection
        if (window.lrcVisuals && window.lrcVisuals.clearVisualization) {
            window.lrcVisuals.clearVisualization();
        }
        
        // Reset interconsonance
        if (window.lrcInterconsonance && window.lrcInterconsonance.resetSection) {
            window.lrcInterconsonance.resetSection();
        }
        
        console.log('🛑 All systems stopped, ready for new generation');
    }

    // ====================================
    // STANDALONE CALCULATION METHOD FOR EXTERNAL USE
    // ====================================

    calculateRhythmDataStandalone(layerA, layerB, layerC, layerD) {
        const layers = [layerA, layerB, layerC, layerD];
        const activeLayers = layers.filter(l => l > 0);
        
        console.log('🔍 LRCModule standalone calculation for layers:', layers);
        
        if (activeLayers.length === 0) {
            console.warn('No active layers provided to standalone calculation');
            return null;
        }
        
        try {
            // Calculate grid (LCM) - this method should be pure
            const grid = this.calculateTotalLCM(...activeLayers);
            console.log('🔍 Calculated grid:', grid);
            
            // Generate composite rhythm - this should be pure
            const { rhythm, layerMap } = this.generateCompositeRhythm(layers);
            console.log('🔍 Generated rhythm length:', rhythm.length);
            console.log('🔍 First few rhythm values:', rhythm.slice(0, 10));
            
            // Generate spaces plot - this should be pure
            const { spacesPlot, spacesLayerMap } = this.generateSpacesPlot(rhythm, grid, layerMap);
            console.log('🔍 Generated spaces plot length:', spacesPlot.length);
            console.log('🔍 First few spaces values:', spacesPlot.slice(0, 10));
            
            // Calculate unique nodes
            const uniqueValues = new Set(rhythm);
            const nodeCount = uniqueValues.size;
            console.log('🔍 Calculated node count:', nodeCount);
            
            const result = {
                layers,
                grid,
                rhythm,
                layerMap,
                spacesPlot,
                spacesLayerMap,
                nodeCount,
                hp: grid // HP = Grid value
            };
            
            console.log('✅ Standalone calculation completed successfully');
            return result;
            
        } catch (error) {
            console.error('❌ Error in standalone calculation:', error);
            return null;
        }
    }
    
    // ====================================
    // UI UPDATE FUNCTIONS
    // ====================================

    updateUI() {
        this.updateGridDisplay();
        this.updateScaleTable();
        this.updateCompositeDisplay();
        this.updateSpacesDisplay();
        
        // Notify HUD controller to update rhythm info
        if (window.lrcHUD) {
            window.lrcHUD.updateRhythmInfoFromModule();
        }
    }

    updateGridDisplay() {
        const gridValueEl = document.getElementById('grid-value');
        const compositeLengthEl = document.getElementById('composite-length');
        
        if (gridValueEl) gridValueEl.textContent = this.currentGrid;
        if (compositeLengthEl) compositeLengthEl.textContent = this.currentCompositeRhythm.length;
    }

    updateScaleTable() {
        const tableBody = document.getElementById('scale-table-body');
        const scaleStats = document.getElementById('scale-stats');
        
        if (!tableBody || !scaleStats) return;
        
        if (this.currentRatios.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4">No ratios to display</td></tr>';
            scaleStats.textContent = 'Pitches: 0';
            return;
        }
        
        const uniqueTones = new Set(this.currentRatios.map(r => r.fraction));
        uniqueTones.delete("2/1"); // Exclude octave
        scaleStats.textContent = `Pitches: ${uniqueTones.size}`;
        
        const totalGrid = this.currentSpacesPlot.reduce((sum, space) => sum + space, 0);
        
        // Sort by cents (ascending) - default view
        const sortedRatios = [...this.currentRatios].sort((a, b) => a.cents - b.cents);
        
        tableBody.innerHTML = sortedRatios.map(ratio => {
            const percentage = ((ratio.gridOccupation / totalGrid) * 100).toFixed(1);
            
            return `
                <tr>
                    <td>${ratio.fraction}</td>
                    <td>${ratio.cents.toFixed(1)}</td>
                    <td>${ratio.frequency}</td>
                    <td>${percentage}%</td>
                </tr>
            `;
        }).join('');
    }

    sortScaleTable(column) {
        const tableBody = document.getElementById('scale-table-body');
        if (!this.currentRatios.length) return;
        
        // Toggle sort direction or default to ascending for ratio/cents
        const isAscending = this.scaleSortState?.[column] !== 'asc';
        this.scaleSortState = { [column]: isAscending ? 'asc' : 'desc' };
        
        let sortedRatios;
        switch(column) {
            case 'ratio':
            case 'cents':
                sortedRatios = [...this.currentRatios].sort((a, b) => 
                    isAscending ? a.cents - b.cents : b.cents - a.cents
                );
                break;
            case 'count':
                sortedRatios = [...this.currentRatios].sort((a, b) => 
                    isAscending ? a.frequency - b.frequency : b.frequency - a.frequency
                );
                break;
            case 'percent':
                sortedRatios = [...this.currentRatios].sort((a, b) => 
                    isAscending ? a.gridOccupation - b.gridOccupation : b.gridOccupation - a.gridOccupation
                );
                break;
        }
        
        this.renderScaleTableRows(sortedRatios);
    }

    updateCompositeDisplay() {
        const display = document.getElementById('composite-rhythm-display');
        if (display) {
            if (this.currentCompositeRhythm && this.currentCompositeRhythm.length > 0) {
                display.textContent = this.currentCompositeRhythm.join(', ');
            } else {
                display.textContent = 'Generate a rhythm to view composite rhythm data';
            }
        }
    }

    updateSpacesDisplay() {
        const display = document.getElementById('spaces-plot-display');
        if (display) {
            if (this.currentSpacesPlot && this.currentSpacesPlot.length > 0) {
                display.textContent = this.currentSpacesPlot.join(', ');
            } else {
                display.textContent = 'Generate a rhythm to view spaces plot data';
            }
        }
    }

    // ====================================
    // MODULE COMMUNICATION
    // ====================================

    notifyModules() {
        // Use ONLY event-based notification to prevent double calls
        // All modules should listen to 'rhythmGenerated' event instead of direct calls
        
        window.dispatchEvent(new CustomEvent('rhythmGenerated', {
            detail: {
                spacesPlot: this.currentSpacesPlot,
                spacesPlotByLayer: this.currentSpacesPlotByLayer,
                compositeRhythm: this.currentCompositeRhythm,
                layerMap: this.currentLayerMap,
                spacesLayerMap: this.currentSpacesLayerMap, // Add this line
                ratios: this.currentRatios,
                grid: this.currentGrid,
                rhythms: this.currentRhythms
            }
        }));
    }

    // ====================================
    // PUBLIC API FOR OTHER MODULES
    // ====================================

    getCurrentData() {
        return {
            spacesPlot: this.currentSpacesPlot,
            spacesPlotByLayer: this.currentSpacesPlotByLayer,
            compositeRhythm: this.currentCompositeRhythm,
            layerMap: this.currentLayerMap,
            spacesLayerMap: this.currentSpacesLayerMap, // Add this line
            ratios: this.currentRatios,
            grid: this.currentGrid,
            rhythms: this.currentRhythms
        };
    }

    setRhythms(layerA, layerB, layerC, layerD) {
        document.getElementById('layer-a').value = layerA;
        document.getElementById('layer-b').value = layerB;
        document.getElementById('layer-c').value = layerC;
        document.getElementById('layer-d').value = layerD;
        this.generateRhythm();
    }
}

// Initialize LRC Module when DOM is loaded
let lrcModule;

document.addEventListener('DOMContentLoaded', () => {
    lrcModule = new LRCModule();
    window.lrcModule = lrcModule; // Make globally accessible
    
    // Initialize display sections with placeholder content
    lrcModule.updateCompositeDisplay();
    lrcModule.updateSpacesDisplay();
    
    console.log('LRCModule ready - awaiting user input');
});


// Global wrapper functions for HTML onclick handlers
function sortScaleTable(column) {
    if (window.lrcModule) {
        window.lrcModule.sortScaleTable(column);
    }
}
