// LRCSearch.js - Enhanced Search Algorithms for LRC
// Handles special scale searches with configurable pitch counts

class LRCSearch {
    constructor() {
        // Search state
        this.isSearching = false;
        
        // Persistent result storage for each algorithm (accumulates between searches)
        this.algorithmResults = {
            rhythm: new Map(),
            grid: new Map(), 
            fundamental: new Map(),
            inversePG: new Map()
        };
        
        // Track searched combinations to avoid duplicates
        this.searchedCombinations = {
            rhythm: new Set(),
            grid: new Set(),
            fundamental: new Set(), 
            inversePG: new Set()
        };
        
        // Track search progress to resume from where left off
        this.searchState = {
            rhythm: { a: 1, b: 1, c: 1, d: 1 },
            grid: { factorIndex: { i: 0, j: 0, k: 0, l: 0 } },
            fundamental: { gridValue: 0 },
            inversePG: { b: 1, c: 1, d: 1 }
        };
        
        // Search configuration
        this.targetPitches = 12; // Default to 12, can be set to null for 'any'
        this.maxSearchTime = 5; // Now in seconds
        this.rangeLimit = 1000;
        
        // Sort state for each results table
        this.sortState = {
            rhythm: { column: 'grid', direction: 'asc' },
            grid: { column: 'grid', direction: 'asc' },
            fundamental: { column: 'grid', direction: 'asc' },
            inversePG: { column: 'grid', direction: 'asc' }
        };
        
        // Track last search parameters to detect changes
        this.lastSearchParams = {
            rhythm: null,
            grid: null,
            fundamental: null,
            inversePG: null
        };
        
        // Search algorithms
        this.algorithms = {
            rhythm: new RhythmLayerSearch(),
            grid: new GridSearch(),
            fundamental: new FundamentalSearch(),
            inversePG: new InversePGSearch()
        };

        // Set parent reference for validation methods
        Object.values(this.algorithms).forEach(algorithm => {
            algorithm.lrcSearch = this;
        });
        
        this.setupEventListeners();
        console.log('LRC Search module initialized with result accumulation');
    }

    // ====================================
    // EVENT LISTENERS
    // ====================================

    setupEventListeners() {
        // Search configuration controls
        this.setupConfigControls();
        
        // Search algorithm forms
        this.setupSearchForms();
        
        // Clear buttons
        this.setupClearButtons();
    }

    setupConfigControls() {
        // Target pitches
        const targetPitchesInput = document.getElementById('target-pitches');
        if (targetPitchesInput) {
            targetPitchesInput.addEventListener('input', (e) => {
                const value = e.target.value.trim();
                this.targetPitches = value === '' ? null : parseInt(value) || 12;
            });
        }

        // Max search time (now a simple number input in seconds)
        const maxTimeInput = document.getElementById('max-search-time');
        if (maxTimeInput) {
            maxTimeInput.addEventListener('input', (e) => {
                this.maxSearchTime = parseInt(e.target.value) || 5;
            });
        }

        // Range limit
        const rangeLimitInput = document.getElementById('range-limit');
        if (rangeLimitInput) {
            rangeLimitInput.addEventListener('input', (e) => {
                this.rangeLimit = parseFloat(e.target.value) || 1000;
            });
        }
    }

    setupSearchForms() {
        // Rhythm Layer Search
        const rhythmForm = document.getElementById('rhythm-search-form');
        if (rhythmForm) {
            rhythmForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.performRhythmLayerSearch();
            });
        }

        // Grid Search
        const gridForm = document.getElementById('grid-search-form');
        if (gridForm) {
            gridForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.performGridSearch();
            });
        }

        // Fundamental Search
        const fundamentalForm = document.getElementById('fundamental-search-form');
        if (fundamentalForm) {
            fundamentalForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.performFundamentalSearch();
            });
        }

        // Inverse PG Search
        const inversePGForm = document.getElementById('inverse-pg-form');
        if (inversePGForm) {
            inversePGForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.performInversePGSearch();
            });
        }
    }

    setupClearButtons() {
        const clearButtons = [
            { btn: 'clear-rhythm-search', algorithm: 'rhythm', results: 'rhythm-search-results' },
            { btn: 'clear-grid-search', algorithm: 'grid', results: 'grid-search-results' },
            { btn: 'clear-fundamental-search', algorithm: 'fundamental', results: 'fundamental-search-results' },
            { btn: 'clear-inverse-pg', algorithm: 'inversePG', results: 'inverse-pg-results' }
        ];

        clearButtons.forEach(({ btn, algorithm, results }) => {
            const button = document.getElementById(btn);
            const resultsDiv = document.getElementById(results);
            
            if (button && resultsDiv) {
                button.addEventListener('click', () => {
                    this.clearAlgorithmResults(algorithm);
                    resultsDiv.innerHTML = '';
                });
            }
        });
    }

    // ====================================
    // RESULT MANAGEMENT
    // ====================================

    clearAlgorithmResults(algorithmName) {
        this.algorithmResults[algorithmName].clear();
        this.searchedCombinations[algorithmName].clear();
        
        // Reset search state
        switch(algorithmName) {
            case 'rhythm':
                this.searchState.rhythm = { a: 1, b: 1, c: 1, d: 1 };
                break;
            case 'grid':
                this.searchState.grid = { factorIndex: { i: 0, j: 0, k: 0, l: 0 } };
                break;
            case 'fundamental':
                this.searchState.fundamental = { gridValue: 0 };
                break;
            case 'inversePG':
                this.searchState.inversePG = { b: 1, c: 1, d: 1 };
                break;
        }
        
        // Clear last search params
        this.lastSearchParams[algorithmName] = null;
        
        console.log(`Cleared ${algorithmName} search results and reset search state`);
    }

    checkAndClearIfParamsChanged(algorithmName, currentParams) {
        const lastParams = this.lastSearchParams[algorithmName];
        
        if (!lastParams) {
            // First search - store params
            this.lastSearchParams[algorithmName] = { ...currentParams };
            return false; // No clearing needed
        }
        
        // Check if any parameter changed
        const paramsChanged = Object.keys(currentParams).some(key => {
            return currentParams[key] !== lastParams[key];
        });
        
        if (paramsChanged) {
            console.log(`🔄 Search parameters changed for ${algorithmName}, clearing previous results`);
            this.clearAlgorithmResults(algorithmName);
            this.lastSearchParams[algorithmName] = { ...currentParams };
            return true; // Clearing occurred
        }
        
        return false; // No clearing needed
    }

    addResult(algorithmName, layers, result) {
        const combinationKey = layers.join(':');
        
        // Skip if already searched this layer combination
        if (this.searchedCombinations[algorithmName].has(combinationKey)) {
            return false;
        }
        
        // Add to searched combinations
        this.searchedCombinations[algorithmName].add(combinationKey);
        
        // MASTER CODEX FILTERING: Check for exact grid + fundamental + ratio set combination
        if (result.ratios && result.ratios.length > 0) {
            const fundamental = layers.length > 0 ? result.grid / Math.max(...layers) : 0;
            const scaleKey = result.ratios.join(',');
            const uniqueKey = `${result.grid}|${fundamental}|${scaleKey}`;
            
            // Check if this EXACT grid+fundamental+ratio combination already exists
            const existingResults = Array.from(this.algorithmResults[algorithmName].entries());
            const isDuplicate = existingResults.some(([, existingResult]) => {
                if (!existingResult.ratios) return false;
                const existingFundamental = existingResult.layers.length > 0 ? 
                    existingResult.grid / Math.max(...existingResult.layers) : 0;
                const existingScaleKey = existingResult.ratios.join(',');
                const existingUniqueKey = `${existingResult.grid}|${existingFundamental}|${existingScaleKey}`;
                return existingUniqueKey === uniqueKey;
            });
            
            if (isDuplicate) {
                console.log(`⚠️ Skipping redundant result: ${combinationKey} (duplicate grid+fundamental+ratios)`);
                return false;
            }
        }
        
        // Store result
        this.algorithmResults[algorithmName].set(combinationKey, {
            layers: layers,
            ...result
        });
        
        console.log(`✓ Added ${algorithmName} result: ${combinationKey} (Grid: ${result.grid}, Pitches: ${result.pitches})`);
        return true;
    }

    // ====================================
    // SEARCH ALGORITHMS
    // ====================================

    async performRhythmLayerSearch() {
        const layer = document.getElementById('search-layer').value;
        const value = parseInt(document.getElementById('search-layer-value').value);
        
        if (!value || value < 1) {
            alert('Please enter a valid layer value');
            return;
        }

        // Check if parameters changed and clear results if needed
        const currentParams = {
            layer: layer,
            value: value,
            targetPitches: this.targetPitches,
            rangeLimit: this.rangeLimit
        };
        this.checkAndClearIfParamsChanged('rhythm', currentParams);

        console.log(`🔍 Starting ${layer} = ${value} search (accumulating results)`);
        
        await this.algorithms.rhythm.search({
            layer: layer,
            value: value,
            targetPitches: this.targetPitches,
            maxSearchTime: this.maxSearchTime * 1000, // Convert to milliseconds
            rangeLimit: this.rangeLimit,
            algorithmName: 'rhythm'
        });

        this.displayAccumulatedResults('rhythm-search-results', 'rhythm', 'Rhythm Layer Search');
    }

    async performGridSearch() {
        const gridValue = parseInt(document.getElementById('search-grid-value').value);
        
        if (!gridValue || gridValue < 1) {
            alert('Please enter a valid grid value');
            return;
        }

        // Check if parameters changed and clear results if needed
        const currentParams = {
            gridValue: gridValue,
            targetPitches: this.targetPitches,
            rangeLimit: this.rangeLimit
        };
        this.checkAndClearIfParamsChanged('grid', currentParams);

        console.log(`🔍 Starting Grid ${gridValue} search (accumulating results)`);
        
        await this.algorithms.grid.search({
            gridValue: gridValue,
            targetPitches: this.targetPitches,
            maxSearchTime: this.maxSearchTime * 1000, // Convert to milliseconds
            rangeLimit: this.rangeLimit,
            algorithmName: 'grid'
        });

        this.displayAccumulatedResults('grid-search-results', 'grid', 'Grid Search');
    }

    async performFundamentalSearch() {
        const fundamental = parseInt(document.getElementById('search-fundamental').value);
        const minLayerA = parseInt(document.getElementById('min-layer-a').value) || 1;
        
        if (!fundamental || fundamental < 1) {
            alert('Please enter a valid fundamental value');
            return;
        }

        // Check if parameters changed and clear results if needed
        const currentParams = {
            fundamental: fundamental,
            minLayerA: minLayerA,
            targetPitches: this.targetPitches,
            rangeLimit: this.rangeLimit
        };
        this.checkAndClearIfParamsChanged('fundamental', currentParams);

        console.log(`🔍 Starting Fundamental ${fundamental} search (accumulating results)`);
        
        await this.algorithms.fundamental.search({
            fundamental: fundamental,
            minLayerA: minLayerA,
            targetPitches: this.targetPitches,
            maxSearchTime: this.maxSearchTime * 1000, // Convert to milliseconds
            rangeLimit: this.rangeLimit,
            algorithmName: 'fundamental'
        });

        this.displayAccumulatedResults('fundamental-search-results', 'fundamental', 'Fundamental Search');
    }

    async performInversePGSearch() {
        const layerA = parseInt(document.getElementById('inverse-pg-a').value);
        
        if (!layerA || layerA < 1) {
            alert('Please enter a valid Layer A value');
            return;
        }

        // Check if parameters changed and clear results if needed
        const currentParams = {
            layerA: layerA,
            targetPitches: this.targetPitches,
            rangeLimit: this.rangeLimit
        };
        this.checkAndClearIfParamsChanged('inversePG', currentParams);

        console.log(`🔍 Starting Inverse PG A=${layerA} search (accumulating results)`);
        
        await this.algorithms.inversePG.search({
            layerA: layerA,
            maxSearchTime: this.maxSearchTime * 1000, // Convert to milliseconds
            rangeLimit: this.rangeLimit,
            algorithmName: 'inversePG'
        });

        this.displayAccumulatedResults('inverse-pg-results', 'inversePG', 'Inverse PG Search');
    }

    // ====================================
    // RESULTS DISPLAY
    // ====================================

    displayAccumulatedResults(containerId, algorithmName, searchType) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const resultsMap = this.algorithmResults[algorithmName];
        const resultsArray = Array.from(resultsMap.entries()).map(([, value]) => value);

        if (resultsArray.length === 0) {
            container.innerHTML = `<div class="no-results">No ${searchType} results found yet.</div>`;
            return;
        }

        // Sort results using current sort state
        const sortState = this.sortState[algorithmName];
        this.sortResultsArray(resultsArray, sortState.column, sortState.direction);

        // Determine which columns to show
        const showPitchesColumn = (algorithmName === 'inversePG') || (this.targetPitches === null); // Show for Inverse PG or when target pitches is blank
        const showAvgDevColumn = this.targetPitches === 12; // Only show for 12-tone searches

        // Helper function to add sort indicators
        const getSortClass = (column) => {
            if (sortState.column === column) {
                return sortState.direction === 'asc' ? 'sorted-asc' : 'sorted-desc';
            }
            return '';
        };

        let html = `
            <div class="search-results-header">
                <h4>${searchType} Results: ${resultsArray.length}</h4>
            </div>
            <div class="results-table-container">
                <table class="results-table">
                    <thead>
                        <tr>
                            <th class="${getSortClass('layers')}" onclick="window.lrcSearch.sortResults('${containerId}', 'layers')">Layers</th>
                            <th class="${getSortClass('grid')}" onclick="window.lrcSearch.sortResults('${containerId}', 'grid')">Grid</th>`;
        
        if (showPitchesColumn) {
            html += `<th class="${getSortClass('pitches')}" onclick="window.lrcSearch.sortResults('${containerId}', 'pitches')">Pitches</th>`;
        }
        
        if (showAvgDevColumn) {
            html += `<th class="${getSortClass('avgDeviation')}" onclick="window.lrcSearch.sortResults('${containerId}', 'avgDeviation')">Avg Dev</th>`;
        }
        
        html += `           <th class="${getSortClass('range')}" onclick="window.lrcSearch.sortResults('${containerId}', 'range')">Range</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        resultsArray.forEach((result) => {
            const avgDev = result.avgDeviation ? result.avgDeviation.toFixed(3) : 'N/A';
            const range = result.range ? result.range.toFixed(2) : 'N/A';
            
            html += `
                <tr>
                    <td>${result.layers.join(':')}</td>
                    <td>${result.grid}</td>`;
            
            if (showPitchesColumn) {
                html += `<td>${result.pitches}</td>`;
            }
            
            if (showAvgDevColumn) {
                html += `<td>${avgDev}</td>`;
            }
            
            html += `   <td>${range}</td>
                    <td><button onclick="window.lrcSearch.applyResult([${result.layers.join(',')}])" class="apply-btn">Apply</button></td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    // ====================================
    // SORTING AND UTILITY FUNCTIONS
    // ====================================

    sortResults(containerId, column) {
        // Determine algorithm name from container ID
        const algorithmName = containerId.replace('-search-results', '').replace('-results', '');
        const mappedAlgorithmName = algorithmName === 'inverse-pg' ? 'inversePG' : algorithmName;
        
        // Toggle sort direction if same column, otherwise default to ascending
        const currentState = this.sortState[mappedAlgorithmName];
        if (currentState.column === column) {
            currentState.direction = currentState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentState.column = column;
            currentState.direction = 'asc';
        }
        
        // Re-display results with new sort
        const searchTypeMap = {
            'rhythm': 'Rhythm Layer Search',
            'grid': 'Grid Search', 
            'fundamental': 'Fundamental Search',
            'inversePG': 'Inverse PG Search'
        };
        
        this.displayAccumulatedResults(containerId, mappedAlgorithmName, searchTypeMap[mappedAlgorithmName]);
    }

    sortResultsArray(resultsArray, column, direction) {
        return resultsArray.sort((a, b) => {
            let valueA, valueB;
            
            switch(column) {
                case 'layers':
                    valueA = a.layers.join(':');
                    valueB = b.layers.join(':');
                    break;
                case 'grid':
                    valueA = a.grid;
                    valueB = b.grid;
                    break;
                case 'pitches':
                    valueA = a.pitches;
                    valueB = b.pitches;
                    break;
                case 'avgDeviation':
                    valueA = a.avgDeviation || 0;
                    valueB = b.avgDeviation || 0;
                    break;
                case 'range':
                    valueA = a.range || 0;
                    valueB = b.range || 0;
                    break;
                default:
                    return 0;
            }
            
            // Handle string vs number comparison
            if (typeof valueA === 'string' && typeof valueB === 'string') {
                return direction === 'asc' ? valueA.localeCompare(valueB) : valueB.localeCompare(valueA);
            } else {
                return direction === 'asc' ? valueA - valueB : valueB - valueA;
            }
        });
    }

    applyResult(layers) {
        // Apply the result to the main LRC interface
        document.getElementById('layer-a').value = layers[0] || 1;
        document.getElementById('layer-b').value = layers[1] || 1; 
        document.getElementById('layer-c').value = layers[2] || 1;
        document.getElementById('layer-d').value = layers[3] || 1;
        
        // Trigger form submission
        const form = document.getElementById('rhythm-form');
        if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
    }

    calculateRange(layers) {
        if (layers.length === 0) return 1;
        const sortedLayers = [...layers].sort((a, b) => b - a);
        return sortedLayers[0] / sortedLayers[sortedLayers.length - 1];
    }

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

    calculateTotalLCM(...layers) {
        return layers.reduce((acc, layer) => this.lcm(acc, layer), 1);
    }

    isValidLayerSet(layers) {
        // Remove any 1s and sort descending
        const validLayers = layers.filter(x => x > 1).sort((a, b) => b - a);
        
        if (validLayers.length < 2) return false;
        
        // Check for duplicates
        if (new Set(validLayers).size !== validLayers.length) {
            return false;
        }
        
        // Only check if the ENTIRE SET is coprime (GCD of all = 1)
        const commonDivisor = validLayers.reduce((acc, layer) => this.gcd(acc, layer), validLayers[0]);
        if (commonDivisor > 1) return false;
        
        return true;
    }
}

// ====================================
// INDIVIDUAL SEARCH ALGORITHMS
// ====================================

class RhythmLayerSearch {
    constructor() {
        this.lrcSearch = null;
    }
    
    async search({ layer, value, targetPitches, maxSearchTime, rangeLimit, algorithmName }) {
        const startTime = Date.now();
        let newResultsCount = 0;
        
        // Resume from saved state
        const state = this.lrcSearch.searchState.rhythm;
        
        for (let a = state.a; a <= 200; a++) {
            for (let b = (a === state.a ? state.b : 1); b < a; b++) {
                for (let c = (a === state.a && b === state.b ? state.c : 1); c < b; c++) {
                    for (let d = (a === state.a && b === state.b && c === state.c ? state.d : 1); d < c; d++) {
                        if ((Date.now() - startTime) > maxSearchTime) {
                            // Save state for resume
                            this.lrcSearch.searchState.rhythm = { a, b, c, d };
                            console.log(`⏰ Search time limit reached. Found ${newResultsCount} new results.`);
                            return newResultsCount;
                        }
                        
                        const testLayers = [a, b, c, d];
                        let hasTargetLayer = false;
                        
                        switch(layer) {
                            case 'A': hasTargetLayer = (a === value); break;
                            case 'B': hasTargetLayer = (b === value); break;
                            case 'C': hasTargetLayer = (c === value); break;
                            case 'D': hasTargetLayer = (d === value); break;
                        }
                        
                        if (!hasTargetLayer) continue;
                        if (!this.lrcSearch.isValidLayerSet(testLayers)) continue;
                        
                        const validLayers = testLayers.filter(x => x > 1).sort((a, b) => b - a);
                        
                        // Skip if this combination was already searched
                        const combinationKey = validLayers.join(':');
                        if (this.lrcSearch.searchedCombinations[algorithmName].has(combinationKey)) {
                            continue;
                        }
                        
                        const range = this.lrcSearch.calculateRange(validLayers);
                        if (range > rangeLimit) continue;
                        
                        // USE LRCMODULE.JS METHODS
                        if (!window.lrcModule) continue;

                        // Pad layers to 4 elements for LRCModule compatibility
                        const paddedLayers = [...validLayers];
                        while (paddedLayers.length < 4) paddedLayers.push(1);

                        const grid = window.lrcModule.calculateTotalLCM(...paddedLayers);
                        const { rhythm, layerMap } = window.lrcModule.generateCompositeRhythm(paddedLayers);
                        const { spacesPlot } = window.lrcModule.generateSpacesPlot(rhythm, grid, layerMap);
                        const { ratios } = window.lrcModule.generateRatiosWithFrequency(spacesPlot);

                        // Check if it matches target pitches
                        const uniqueTones = new Set(ratios.map(r => r.fraction));
                        uniqueTones.delete("2/1");

                        if (targetPitches === null || uniqueTones.size === targetPitches) {
                            // Calculate average deviation for 12-tone scales
                            const deviations = ratios.map(r => Math.abs(100 - (r.cents % 100)));
                            const avgDeviation = uniqueTones.size === 12 ? 
                                (deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length) : null;
                            
                            const result = {
                                grid,
                                pitches: uniqueTones.size,
                                avgDeviation: avgDeviation || 0,
                                ratios: Array.from(uniqueTones).sort((a, b) => {
                                    const [numA, denA] = a.split('/').map(Number);
                                    const [numB, denB] = b.split('/').map(Number);
                                    return (numA / denA) - (numB / denB);
                                })
                            };
                            
                            const wasNew = this.lrcSearch.addResult(algorithmName, validLayers, { ...result, range });
                            if (wasNew) newResultsCount++;
                        }                    }
                }
            }
        }
        
        // Search completed - reset state for next run
        this.lrcSearch.searchState.rhythm = { a: 1, b: 1, c: 1, d: 1 };
        console.log(`✅ Rhythm Layer Search completed. Found ${newResultsCount} new results.`);
        return newResultsCount;
    }
}

class GridSearch {
    constructor() {
        this.lrcSearch = null;
    }
    
    async search({ gridValue, targetPitches, maxSearchTime, rangeLimit, algorithmName }) {
        const startTime = Date.now();
        let newResultsCount = 0;
        
        console.log(`🔍 Starting Grid ${gridValue} search for ${targetPitches}-pitch scales`);
        
        // Find all factors of the grid value
        const factors = [];
        for (let i = 1; i <= gridValue; i++) {
            if (gridValue % i === 0) {
                factors.push(i);
            }
        }
        console.log('Factors of grid value:', factors);
        
        // Resume from saved state  
        const state = this.lrcSearch.searchState.grid.factorIndex;
        
        // Iterate over combinations of factors for Special Scales by Grid
        for (let i = state.i; i < factors.length; i++) {
            for (let j = (i === state.i ? state.j : i); j < factors.length; j++) {
                for (let k = (i === state.i && j === state.j ? state.k : j); k < factors.length; k++) {
                    for (let l = (i === state.i && j === state.j && k === state.k ? state.l : k); l < factors.length; l++) {
                        if ((Date.now() - startTime) > maxSearchTime) {
                            // Save state for resume
                            this.lrcSearch.searchState.grid.factorIndex = { i, j, k, l };
                            console.log(`⏰ Grid search time limit reached. Found ${newResultsCount} new results.`);
                            return newResultsCount;
                        }
                        
                        const layersList = [
                            [factors[i], factors[j]],
                            [factors[i], factors[j], factors[k]],
                            [factors[i], factors[j], factors[k], factors[l]]
                        ];
                        
                        for (const layers of layersList) {
                            const nonOneLayers = layers.filter(x => x !== 1).sort((a, b) => b - a);
                            if (nonOneLayers.length < 2) continue;
                            
                            const range = this.lrcSearch.calculateRange(nonOneLayers);
                            if (range > rangeLimit) continue;
                            
                            const combinationKey = nonOneLayers.join(':');
                            if (this.lrcSearch.searchedCombinations[algorithmName].has(combinationKey)) continue;
                            
                            const gridSize = nonOneLayers.reduce((acc, layer) => this.lrcSearch.lcm(acc, layer), 1);
                            if (gridSize !== gridValue) continue;
                            
                            // Check for duplicates and direct factors
                            const hasRedundantLayers = nonOneLayers.some((layer, idx) => 
                                nonOneLayers.some((otherLayer, otherIdx) => 
                                    idx !== otherIdx && (otherLayer % layer === 0)
                                )
                            );
                            if (hasRedundantLayers) continue;
                            
                            // Check if layers share an unsimplified GCF
                            const commonDivisor = nonOneLayers.reduce((acc, layer) => this.lrcSearch.gcd(acc, layer), nonOneLayers[0]);
                            if (commonDivisor > 1) continue;
                            
                            // USE LRCMODULE.JS METHODS
                            if (!window.lrcModule) {
                                console.error('LRCModule not available');
                                continue;
                            }
                            
                            // Pad layers to 4 elements for LRCModule compatibility
                            const paddedLayers = [...nonOneLayers];
                            while (paddedLayers.length < 4) paddedLayers.push(1);
                            
                            const grid = window.lrcModule.calculateTotalLCM(...paddedLayers);
                            const { rhythm, layerMap } = window.lrcModule.generateCompositeRhythm(paddedLayers);
                            const { spacesPlot } = window.lrcModule.generateSpacesPlot(rhythm, grid, layerMap);
                            const { ratios } = window.lrcModule.generateRatiosWithFrequency(spacesPlot);
                            
                            // Check if it matches target pitches
                            const uniqueTones = new Set(ratios.map(r => r.fraction));
                            uniqueTones.delete("2/1");
                            
                            if (targetPitches === null || uniqueTones.size === targetPitches) {
                                // Calculate average deviation for 12-tone scales
                                const deviations = ratios.map(r => Math.abs(100 - (r.cents % 100)));
                                const avgDeviation = uniqueTones.size === 12 ? 
                                    (deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length) : null;
                                
                                const result = {
                                    grid: gridSize,
                                    pitches: uniqueTones.size,
                                    avgDeviation: avgDeviation || 0,
                                    ratios: Array.from(uniqueTones).sort((a, b) => {
                                        const [numA, denA] = a.split('/').map(Number);
                                        const [numB, denB] = b.split('/').map(Number);
                                        return (numA / denA) - (numB / denB);
                                    })
                                };
                                
                                const wasNew = this.lrcSearch.addResult(algorithmName, nonOneLayers, { ...result, range });
                                if (wasNew) newResultsCount++;
                            }
                        }
                    }
                }
            }
        }
        
        // Search completed - reset state for next run
        this.lrcSearch.searchState.grid.factorIndex = { i: 0, j: 0, k: 0, l: 0 };
        console.log(`✅ Grid Search completed. Found ${newResultsCount} new results.`);
        return newResultsCount;
    }
}

class FundamentalSearch {
    constructor() {
        this.lrcSearch = null;
    }
    
    async search({ fundamental, minLayerA, targetPitches, maxSearchTime, rangeLimit, algorithmName }) {
        const startTime = Date.now();
        let newResultsCount = 0;
        
        // Resume from saved state or start fresh
        let gridValue = this.lrcSearch.searchState.fundamental.gridValue || (fundamental * minLayerA);
        const maxGridValue = 999999999;
        
        while ((Date.now() - startTime) <= maxSearchTime && gridValue <= maxGridValue) {
            gridValue += fundamental;
            
            // Find factors
            const factors = [];
            for (let i = 1; i <= gridValue; i++) {
                if (gridValue % i === 0 && i <= gridValue / fundamental) {
                    factors.push(i);
                }
            }
            
            // Test factor combinations
            for (let i = 0; i < factors.length; i++) {
                for (let j = i; j < factors.length; j++) {
                    for (let k = j; k < factors.length; k++) {
                        for (let l = k; l < factors.length; l++) {
                            if ((Date.now() - startTime) > maxSearchTime) {
                                // Save state for resume
                                this.lrcSearch.searchState.fundamental.gridValue = gridValue;
                                console.log(`⏰ Fundamental search time limit reached. Found ${newResultsCount} new results.`);
                                return newResultsCount;
                            }
                            
                            const testLayers = [factors[i], factors[j], factors[k], factors[l]];
                            if (!this.lrcSearch.isValidLayerSet(testLayers)) continue;
                            
                            const validLayers = testLayers.filter(x => x > 1).sort((a, b) => b - a);
                            
                            // Skip if this combination was already searched
                            const combinationKey = validLayers.join(':');
                            if (this.lrcSearch.searchedCombinations[algorithmName].has(combinationKey)) {
                                continue;
                            }
                            
                            // Verify grid and fundamental match
                            const actualGrid = validLayers.reduce((acc, layer) => this.lrcSearch.lcm(acc, layer), 1);
                            if (actualGrid !== gridValue) continue;
                            
                            const layerA = Math.max(...validLayers);
                            if (actualGrid / layerA !== fundamental) continue;
                            
                            const range = this.lrcSearch.calculateRange(validLayers);
                            if (range > rangeLimit) continue;
                            
                            // USE LRCMODULE.JS METHODS
                            if (!window.lrcModule) continue;

                            // Pad layers to 4 elements for LRCModule compatibility
                            const paddedLayers = [...validLayers];
                            while (paddedLayers.length < 4) paddedLayers.push(1);

                            const grid = window.lrcModule.calculateTotalLCM(...paddedLayers);
                            const { rhythm, layerMap } = window.lrcModule.generateCompositeRhythm(paddedLayers);
                            const { spacesPlot } = window.lrcModule.generateSpacesPlot(rhythm, grid, layerMap);
                            const { ratios } = window.lrcModule.generateRatiosWithFrequency(spacesPlot);

                            // Check if it matches target pitches
                            const uniqueTones = new Set(ratios.map(r => r.fraction));
                            uniqueTones.delete("2/1");

                            if (targetPitches === null || uniqueTones.size === targetPitches) {
                                // Calculate average deviation for 12-tone scales
                                const deviations = ratios.map(r => Math.abs(100 - (r.cents % 100)));
                                const avgDeviation = uniqueTones.size === 12 ? 
                                    (deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length) : null;
                                
                                const result = {
                                    grid,
                                    pitches: uniqueTones.size,
                                    avgDeviation: avgDeviation || 0,
                                    ratios: Array.from(uniqueTones).sort((a, b) => {
                                        const [numA, denA] = a.split('/').map(Number);
                                        const [numB, denB] = b.split('/').map(Number);
                                        return (numA / denA) - (numB / denB);
                                    })
                                };
                                
                                const wasNew = this.lrcSearch.addResult(algorithmName, validLayers, { ...result, range });
                                if (wasNew) newResultsCount++;
                            }
                        }
                    }
                }
            }
        }
        
        // Search completed (reached max grid value) - reset state for next run
        this.lrcSearch.searchState.fundamental.gridValue = 0;
        console.log(`✅ Fundamental Search completed. Found ${newResultsCount} new results.`);
        return newResultsCount;
    }
}

class InversePGSearch {
    constructor() {
        this.lrcSearch = null;
    }
    
    async search({ layerA, maxSearchTime, rangeLimit, algorithmName }) {
        const startTime = Date.now();
        let newResultsCount = 0;
        
        // Resume from saved state
        const state = this.lrcSearch.searchState.inversePG;
        
        for (let b = state.b; b <= layerA && b <= 200; b++) {
            for (let c = (b === state.b ? state.c : 1); c <= layerA && c <= 200; c++) {
                for (let d = (b === state.b && c === state.c ? state.d : 1); d <= layerA && d <= 200; d++) {
                    if ((Date.now() - startTime) > maxSearchTime) {
                        // Save state for resume
                        this.lrcSearch.searchState.inversePG = { b, c, d };
                        console.log(`⏰ Inverse PG search time limit reached. Found ${newResultsCount} new results.`);
                        return newResultsCount;
                    }
                    
                    const layers = [layerA, b, c, d].filter(x => x !== 1).sort((a, b) => b - a);
                    if (layers.length !== 4) continue;
                    
                    // Skip if this combination was already searched
                    const combinationKey = layers.join(':');
                    if (this.lrcSearch.searchedCombinations[algorithmName].has(combinationKey)) {
                        continue;
                    }
                    
                    // Check for duplicate layers
                    if (new Set(layers).size !== layers.length) continue;
                    
                    const range = this.lrcSearch.calculateRange(layers);
                    if (range > rangeLimit) continue;
                    
                    // USE LRCMODULE.JS METHODS
                    if (!window.lrcModule) continue;

                    // Pad layers to 4 elements for LRCModule compatibility
                    const paddedLayers = [...layers];
                    while (paddedLayers.length < 4) paddedLayers.push(1);

                    const grid = window.lrcModule.calculateTotalLCM(...paddedLayers);
                    const { rhythm, layerMap } = window.lrcModule.generateCompositeRhythm(paddedLayers);
                    const { spacesPlot } = window.lrcModule.generateSpacesPlot(rhythm, grid, layerMap);
                    const { ratios } = window.lrcModule.generateRatiosWithFrequency(spacesPlot);

                    // Check for valid scale (Inverse PG now respects target pitches when set)
                    const uniqueTones = new Set(ratios.map(r => r.fraction));
                    uniqueTones.delete("2/1");

                    // Get target pitches from parent search instance
                    const targetPitches = this.lrcSearch.targetPitches;
                    if (targetPitches === null || uniqueTones.size === targetPitches) {
                        // Calculate average deviation for 12-tone scales
                        const deviations = ratios.map(r => Math.abs(100 - (r.cents % 100)));
                        const avgDeviation = uniqueTones.size === 12 ? 
                            (deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length) : null;
                        
                        const result = {
                            grid,
                            pitches: uniqueTones.size,
                            avgDeviation: avgDeviation || 0,
                            ratios: Array.from(uniqueTones).sort((a, b) => {
                                const [numA, denA] = a.split('/').map(Number);
                                const [numB, denB] = b.split('/').map(Number);
                                return (numA / denA) - (numB / denB);
                            })
                        };
                        
                        const wasNew = this.lrcSearch.addResult(algorithmName, layers, { ...result, range });
                        if (wasNew) newResultsCount++;
                    }
                }
            }
        }
        
        // Search completed - reset state for next run
        this.lrcSearch.searchState.inversePG = { b: 1, c: 1, d: 1 };
        console.log(`✅ Inverse PG Search completed. Found ${newResultsCount} new results.`);
        return newResultsCount;
    }
}

// Initialize LRC Search when DOM is loaded
let lrcSearch;

document.addEventListener('DOMContentLoaded', () => {
    lrcSearch = new LRCSearch();
    window.lrcSearch = lrcSearch; // Make globally accessible
});

// Global wrapper functions for HTML onclick handlers
function toggleSearchSection(sectionId) {
    if (window.lrcSearch) {
        window.lrcSearch.toggleSearchSection(sectionId);
    }
}

function sortSearchResults(containerId, column) {
    if (window.lrcSearch) {
        window.lrcSearch.sortSearchResults(containerId, column);
    }
}

function applySearchResult(layers) {
    if (window.lrcSearch) {
        window.lrcSearch.applyResult(layers);
    }
}