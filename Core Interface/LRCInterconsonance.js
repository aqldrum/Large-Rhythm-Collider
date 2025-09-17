class LRCInterconsonance {
    constructor() {
        this.isAnalysisRunning = false;
        this.currentAnalysis = null;
        this.consonanceWindow = 15; // ±15 cent window for consonance
        this.pitchConsonanceMap = new Map(); // O(1) lookup for consonant relationships
        this.selectedPitch = null; // For lighting system
        
        // Family display pagination and sorting state
        this.familyDisplayState = {
            currentPage: 0,
            itemsPerPage: 10,
            sortBy: 'size', // 'avgDeviation' or 'size'
            sortOrder: 'desc' // 'asc' or 'desc'
        };
        
        this.initializeUI();
        console.log('🎵 LRCInterconsonance initialized');
    }

    initializeUI() {
        // Add the interconsonance section to the rhythm info div
        const rhythmInfoContent = document.querySelector('#rhythm-info-div .info-content');
        if (!rhythmInfoContent) {
            console.error('Could not find rhythm info content div');
            return;
        }

        // Create the interconsonance section HTML
        const interconsonanceSection = document.createElement('div');
        interconsonanceSection.className = 'info-subsection';
        interconsonanceSection.innerHTML = `
            <div class="subsection-header" data-target="interconsonance-content">Interconsonance</div>
            <div id="interconsonance-content" class="subsection-content" style="display: none;">
                <div class="interconsonance-controls">
                    <button class="analyze-btn" id="run-interconsonance-btn">Analyze</button>
                </div>
                <div id="interconsonance-display">
                    <p>Click "Analyze" to run consonance analysis for this rhythm scale.</p>
                </div>
            </div>
        `;

        // Append to rhythm info content
        rhythmInfoContent.appendChild(interconsonanceSection);
        
        // Create the export section HTML
        const exportSection = document.createElement('div');
        exportSection.className = 'info-subsection';
        exportSection.innerHTML = `
            <div class="subsection-header" data-target="export-content">Export</div>
            <div id="export-content" class="subsection-content" style="display: none;">
                <div class="export-controls" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <button class="export-btn" id="export-pdf-btn">Export Info</button>
                    <button class="export-btn" id="export-midi-btn">Export MIDI</button>
                    <button class="export-btn" id="export-scl-btn">Export .scl (root C)</button>
                    <button class="export-btn" id="export-tun-btn">Export .tun (root A)</button>
                </div>
            </div>
        `;
        rhythmInfoContent.appendChild(exportSection);

        // Set up event listeners
        this.setupEventListeners();
        this.setupExportEventListeners();
    }

    setupExportEventListeners() {
        // PDF Export
        const pdfBtn = document.getElementById('export-pdf-btn');
        if (pdfBtn) {
            pdfBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.lrcExport) {
                    window.lrcExport.export('pdf');
                } else {
                    console.error('LRCExport module not available');
                }
            });
        }

        // MIDI Export
        const midiBtn = document.getElementById('export-midi-btn');
        if (midiBtn) {
            midiBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.expandedInfoView) {
                    window.expandedInfoView.showMidiRootPopup();
                } else {
                    console.error('ExpandedInfoView not available');
                }
            });
        }

        // SCL Export
        const sclBtn = document.getElementById('export-scl-btn');
        if (sclBtn) {
            sclBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.lrcExport) {
                    window.lrcExport.export('tuning', 'scl');
                } else {
                    console.error('LRCExport module not available');
                }
            });
        }

        // TUN Export
        const tunBtn = document.getElementById('export-tun-btn');
        if (tunBtn) {
            tunBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.lrcExport) {
                    window.lrcExport.export('tuning', 'tun');
                } else {
                    console.error('LRCExport module not available');
                }
            });
        }

    }

    setupEventListeners() {
        const analyzeBtn = document.getElementById('run-interconsonance-btn');
        if (analyzeBtn) {
            analyzeBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent collapsible section from toggling
                this.runAnalysis();
            });
        }

        // Collapsible behavior handled by global LRCHudController system

        // Listen for rhythm generation to reset the section
        window.addEventListener('rhythmGenerated', () => {
            this.resetSection();
        });
    }

    async runAnalysis() {
        if (this.isAnalysisRunning) {
            console.log('Analysis already running');
            return;
        }

        // Get current rhythm data from LRCModule
        if (!window.lrcModule || !window.lrcModule.currentRatios) {
            this.displayError('No rhythm data available. Please generate a rhythm first.');
            return;
        }

        const ratios = window.lrcModule.currentRatios;

        console.log('🎵 Starting Interconsonance analysis for', ratios.length, 'ratios');
        
        this.isAnalysisRunning = true;
        this.updateAnalyzeButton('Analyzing...');

        try {
            const analysis = this.analyzeRhythmScale(ratios);
            const families = this.extractConsonanceFamilies(analysis);
            
            this.currentAnalysis = {
                analysis,
                families,
                ratios
            };

            this.displayResults();

            // Enable pitch lighting system
            this.enablePitchSelection();
            
            // Dispatch event to notify other systems (like playback) that analysis is complete
            window.dispatchEvent(new CustomEvent('interconsonanceAnalysisComplete', {
                detail: {
                    analysis: this.currentAnalysis.analysis,
                    families: this.currentAnalysis.families,
                    ratios: this.currentAnalysis.ratios
                }
            }));

        } catch (error) {
            console.error('Analysis error:', error);
            this.displayError('Analysis failed: ' + error.message);
        } finally {
            this.isAnalysisRunning = false;
            this.updateAnalyzeButton('Analyze');
        }
    }

    analyzeRhythmScale(ratios) {
        // Extract numeric ratio values from ratio objects
        const frequencies = ratios.map(ratioObj => ratioObj.ratio);
        
        if (frequencies.length < 2) {
            throw new Error('Need at least 2 ratios for interval analysis');
        }

        console.log(`🔍 Analyzing ${frequencies.length} ratios for consonance...`);
        console.log('First few ratios:', ratios.slice(0, 3).map(r => ({ fraction: r.fraction, ratio: r.ratio, cents: r.cents })));

        const consonantIntervals = [];
        const dissonantIntervals = [];
        const consonantRatios = new Set();
        const dissonantRatios = new Set();
        
        // Initialize pitch consonance map for O(1) lookups
        this.pitchConsonanceMap.clear();
        for (let i = 0; i < ratios.length; i++) {
            this.pitchConsonanceMap.set(i, {
                ratioIndex: i,
                ratioFraction: ratios[i].fraction,
                consonantWith: new Set()
            });
        }

        // Calculate all possible intervals between ratio pairs
        for (let i = 0; i < frequencies.length; i++) {
            for (let j = i + 1; j < frequencies.length; j++) {
                const freq1 = frequencies[i];
                const freq2 = frequencies[j];
                
                // Calculate the interval ratio and convert to cents
                const intervalRatio = Math.max(freq1, freq2) / Math.min(freq1, freq2);
                const cents = 1200 * Math.log2(intervalRatio);
                
                // Find nearest 12TET interval (multiple of 100 cents)
                const nearestET = Math.round(cents / 100) * 100;
                const deviation = cents - nearestET;
                const deviationAbs = Math.abs(deviation);
                
                const intervalData = {
                    positions: `${i + 1}-${j + 1}`,
                    ratio1: ratios[i].fraction,
                    ratio2: ratios[j].fraction,
                    ratioObj1: ratios[i],
                    ratioObj2: ratios[j],
                    pitchIndex1: i,
                    pitchIndex2: j,
                    freq1,
                    freq2,
                    intervalRatio,
                    cents,
                    nearestET,
                    deviation,
                    deviationAbs
                };

                // Check if within consonance window
                if (deviationAbs <= this.consonanceWindow) {
                    consonantIntervals.push(intervalData);
                    consonantRatios.add(ratios[i].fraction);
                    consonantRatios.add(ratios[j].fraction);
                    
                    // Build pitch consonance lookup map
                    this.pitchConsonanceMap.get(i).consonantWith.add(j);
                    this.pitchConsonanceMap.get(j).consonantWith.add(i);
                } else {
                    dissonantIntervals.push(intervalData);
                    dissonantRatios.add(ratios[i].fraction);
                    dissonantRatios.add(ratios[j].fraction);
                }
            }
        }

        const totalIntervals = consonantIntervals.length + dissonantIntervals.length;
        const consonanceRatio = totalIntervals > 0 ? consonantIntervals.length / totalIntervals : 0;

        console.log(`📊 Analysis complete: ${consonantIntervals.length} consonant, ${dissonantIntervals.length} dissonant intervals`);
        console.log(`📊 Consonance ratio: ${(consonanceRatio * 100).toFixed(1)}%`);

        return {
            consonantIntervals: consonantIntervals.sort((a, b) => a.deviationAbs - b.deviationAbs),
            dissonantIntervals: dissonantIntervals.sort((a, b) => a.deviationAbs - b.deviationAbs),
            consonantRatios: Array.from(consonantRatios),
            dissonantRatios: Array.from(dissonantRatios),
            totalIntervals,
            consonanceRatio,
            ratioCount: frequencies.length
        };
    }

    extractConsonanceFamilies(analysis) {
        const families = [];
        const consonantIntervals = analysis.consonantIntervals;
        
        if (consonantIntervals.length === 0) {
            console.log('No consonant intervals found - no families to extract');
            return families;
        }

        // Get pitch indices that have consonant relationships
        const consonantPitches = Array.from(this.pitchConsonanceMap.keys())
            .filter(pitchIndex => this.pitchConsonanceMap.get(pitchIndex).consonantWith.size > 0);
        
        if (consonantPitches.length < 3) {
            console.log('Need at least 3 consonant pitches for family analysis');
            return families;
        }

        console.log(`🔍 Searching for families among ${consonantPitches.length} consonant pitches...`);
        
        // Check for multiple approximates of the same 12-TET interval
        const intervalsByET = new Map();
        consonantIntervals.forEach(interval => {
            const et = interval.nearestET;
            if (!intervalsByET.has(et)) {
                intervalsByET.set(et, []);
            }
            intervalsByET.get(et).push(interval);
        });
        
        const multipleApproximateCounts = Array.from(intervalsByET.entries())
            .filter(([, intervals]) => intervals.length > 1)
            .map(([et, intervals]) => `${et}¢(${intervals.length})`);
        
        if (multipleApproximateCounts.length > 0) {
            console.log(`🎵 Multiple 12-TET approximates found: ${multipleApproximateCounts.join(', ')}`);
        }
        
        // Start with groups of 3, then expand - but with early pruning
        for (let size = 3; size <= Math.min(consonantPitches.length, 20); size++) {
            const combinations = this.getCombinationsIterative(consonantPitches, size);
            
            for (const pitchIndices of combinations) {
                if (this.areAllPitchPairsConsonant(pitchIndices)) {
                    const ratioFractions = pitchIndices.map(i => this.pitchConsonanceMap.get(i).ratioFraction);
                    const familyIntervals = this.getIntervalsForPitches(pitchIndices, consonantIntervals);
                    const avgDeviation = familyIntervals.reduce((sum, interval) => sum + interval.deviationAbs, 0) / familyIntervals.length;
                    
                    // Check for multiple approximates of same 12-TET interval in this family
                    const etCounts = new Map();
                    familyIntervals.forEach(interval => {
                        const et = interval.nearestET;
                        etCounts.set(et, (etCounts.get(et) || 0) + 1);
                    });
                    
                    const hasMultipleApproximates = Array.from(etCounts.values()).some(count => count > 1);
                    
                    families.push({
                        ratios: ratioFractions,
                        pitchIndices,
                        intervals: familyIntervals,
                        size: pitchIndices.length,
                        avgDeviation,
                        consonanceStrength: this.calculateConsonanceStrength(familyIntervals),
                        hasMultipleApproximates // Add this flag for analysis
                    });
                }
            }
            
            // Early exit if we're finding too many families (performance safeguard)
            if (families.length > 1000) {
                console.log('⚠️ Family search limit reached - stopping at size', size);
                break;
            }
        }

        // Add explicit families that contain multiple approximates of the same 12-TET interval
        this.addMultipleApproximateFamilies(families, consonantIntervals);
        
        // Remove subset families (keep only maximal families)
        const beforeRemoval = families.length;
        const familiesWithMultipleApproximates = families.filter(f => f.hasMultipleApproximates).length;
        
        const maximalFamilies = this.removeSubsetFamilies(families);
        
        const afterRemoval = maximalFamilies.length;
        const maximalWithMultipleApproximates = maximalFamilies.filter(f => f.hasMultipleApproximates).length;
        
        console.log(`👥 Family extraction summary:`);
        console.log(`  Before subset removal: ${beforeRemoval} families (${familiesWithMultipleApproximates} with multiple 12-TET approximates)`);
        console.log(`  After subset removal: ${afterRemoval} families (${maximalWithMultipleApproximates} with multiple 12-TET approximates)`);
        console.log(`  Removed: ${beforeRemoval - afterRemoval} families`);
        
        // Sort families, prioritizing those with multiple 12-TET approximates
        return maximalFamilies.sort((a, b) => {
            // First, prioritize families with multiple approximates
            if (a.hasMultipleApproximates && !b.hasMultipleApproximates) return -1;
            if (!a.hasMultipleApproximates && b.hasMultipleApproximates) return 1;
            
            // Then sort by average deviation
            return a.avgDeviation - b.avgDeviation;
        });
    }

    resetSection() {
        // Reset analysis state
        this.currentAnalysis = null;
        this.isAnalysisRunning = false;
        this.selectedPitch = null;
        this.pitchConsonanceMap.clear();
        
        // Reset family display state
        this.familyDisplayState = {
            currentPage: 0,
            itemsPerPage: 10,
            sortBy: 'size',
            sortOrder: 'desc'
        };
        
        // Clear any lighting
        this.clearPitchLighting();
        
        // Reset button text
        this.updateAnalyzeButton('Analyze');
        
        // Reset display content
        const displayDiv = document.getElementById('interconsonance-display');
        if (displayDiv) {
            displayDiv.innerHTML = '<p>Click "Analyze" to run consonance analysis for this rhythm scale.</p>';
        }
        
        // Keep section minimized
        const content = document.getElementById('interconsonance-content');
        if (content) {
            content.style.display = 'none';
        }
        
        console.log('🔄 Interconsonance section reset for new rhythm');
    }

    getCombinationsIterative(arr, size) {
        if (size === 1) return arr.map(el => [el]);
        if (size > arr.length) return [];
        
        const combinations = [];
        const indices = Array.from({ length: size }, (_, i) => i);
        
        while (true) {
            // Add current combination
            combinations.push(indices.map(i => arr[i]));
            
            // Find the rightmost index that can be incremented
            let i = size - 1;
            while (i >= 0 && indices[i] === arr.length - size + i) {
                i--;
            }
            
            // If no such index exists, we're done
            if (i < 0) break;
            
            // Increment the found index and reset all indices to its right
            indices[i]++;
            for (let j = i + 1; j < size; j++) {
                indices[j] = indices[j - 1] + 1;
            }
        }
        
        return combinations;
    }

    areAllPitchPairsConsonant(pitchIndices) {
        // O(1) lookup using pitch consonance map
        for (let i = 0; i < pitchIndices.length; i++) {
            for (let j = i + 1; j < pitchIndices.length; j++) {
                const pitch1 = pitchIndices[i];
                const pitch2 = pitchIndices[j];
                
                if (!this.pitchConsonanceMap.get(pitch1).consonantWith.has(pitch2)) {
                    return false;
                }
            }
        }
        return true;
    }

    areAllPairsConsonant(ratios, consonantIntervals) {
        for (let i = 0; i < ratios.length; i++) {
            for (let j = i + 1; j < ratios.length; j++) {
                const ratio1 = ratios[i];
                const ratio2 = ratios[j];
                
                const hasConsonantInterval = consonantIntervals.some(interval => 
                    (interval.ratio1 === ratio1 && interval.ratio2 === ratio2) ||
                    (interval.ratio1 === ratio2 && interval.ratio2 === ratio1)
                );
                
                if (!hasConsonantInterval) {
                    return false;
                }
            }
        }
        return true;
    }

    getIntervalsForPitches(pitchIndices, consonantIntervals) {
        return consonantIntervals.filter(interval => 
            pitchIndices.includes(interval.pitchIndex1) && pitchIndices.includes(interval.pitchIndex2)
        );
    }

    getIntervalsForRatios(ratios, consonantIntervals) {
        return consonantIntervals.filter(interval => 
            ratios.includes(interval.ratio1) && ratios.includes(interval.ratio2)
        );
    }

    calculateConsonanceStrength(intervals) {
        // Higher strength for lower average deviation
        const avgDeviation = intervals.reduce((sum, interval) => sum + interval.deviationAbs, 0) / intervals.length;
        return Math.max(0, 15 - avgDeviation) / 15; // Normalized 0-1 scale
    }

    addMultipleApproximateFamilies(families, consonantIntervals) {
        // Group consonant intervals by their 12-TET approximation
        const intervalsByET = new Map();
        consonantIntervals.forEach(interval => {
            const et = interval.nearestET;
            if (!intervalsByET.has(et)) {
                intervalsByET.set(et, []);
            }
            intervalsByET.get(et).push(interval);
        });
        
        // Look for 12-TET intervals that have multiple approximates
        for (const [et, intervals] of intervalsByET.entries()) {
            if (intervals.length > 1) {
                console.log(`🎵 Found ${intervals.length} intervals approximating ${et}¢`);
                
                // For each base pitch, find all pitches that form this 12-TET interval with it
                const pitchGroups = new Map();
                intervals.forEach(interval => {
                    const basePitch = interval.pitchIndex1;
                    const targetPitch = interval.pitchIndex2;
                    
                    if (!pitchGroups.has(basePitch)) {
                        pitchGroups.set(basePitch, new Set([basePitch]));
                    }
                    pitchGroups.get(basePitch).add(targetPitch);
                    
                    if (!pitchGroups.has(targetPitch)) {
                        pitchGroups.set(targetPitch, new Set([targetPitch]));
                    }
                    pitchGroups.get(targetPitch).add(basePitch);
                });
                
                // Create families from these pitch groups
                for (const [, pitchSet] of pitchGroups.entries()) {
                    if (pitchSet.size >= 3) { // Only create families with 3+ members
                        const pitchIndices = Array.from(pitchSet);
                        
                        // Check if all pairs are consonant
                        if (this.areAllPitchPairsConsonant(pitchIndices)) {
                            const ratioFractions = pitchIndices.map(i => this.pitchConsonanceMap.get(i).ratioFraction);
                            const familyIntervals = this.getIntervalsForPitches(pitchIndices, consonantIntervals);
                            const avgDeviation = familyIntervals.reduce((sum, interval) => sum + interval.deviationAbs, 0) / familyIntervals.length;
                            
                            // Check if this family already exists
                            const familyExists = families.some(existingFamily => {
                                return existingFamily.ratios.length === ratioFractions.length &&
                                       existingFamily.ratios.every(ratio => ratioFractions.includes(ratio));
                            });
                            
                            if (!familyExists) {
                                console.log(`🎯 Adding explicit multiple-approximate family for ${et}¢:`, ratioFractions);
                                families.push({
                                    ratios: ratioFractions,
                                    pitchIndices,
                                    intervals: familyIntervals,
                                    size: pitchIndices.length,
                                    avgDeviation,
                                    consonanceStrength: this.calculateConsonanceStrength(familyIntervals),
                                    hasMultipleApproximates: true,
                                    explicitMultipleApproximate: true // Flag to indicate this was explicitly added
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    removeSubsetFamilies(families) {
        const maximalFamilies = [];
        
        families.forEach(family => {
            const isSubset = families.some(otherFamily => {
                if (otherFamily === family) return false;
                if (otherFamily.ratios.length <= family.ratios.length) return false;
                return family.ratios.every(ratio => otherFamily.ratios.includes(ratio));
            });
            
            // Special case: If this family has multiple approximates of the same 12-TET interval,
            // we want to preserve it even if it might be considered a "subset" in some sense
            // This ensures that families with multiple approximates are not inadvertently removed
            const hasMultipleApproximates = family.hasMultipleApproximates;
            
            if (!isSubset || hasMultipleApproximates) {
                maximalFamilies.push(family);
                if (hasMultipleApproximates && isSubset) {
                    console.log(`🎯 Preserving family with multiple 12-TET approximates despite subset relationship:`, family.ratios);
                }
            }
        });
        
        return maximalFamilies;
    }

    displayResults() {
        const displayDiv = document.getElementById('interconsonance-display');
        if (!displayDiv) return;

        const { analysis, families } = this.currentAnalysis;
        
        let html = `
            <div class="interconsonance-results">
                <div class="analysis-summary">
                    <h4>Analysis Summary</h4>
                    <p><strong>Total Intervals:</strong> ${analysis.totalIntervals}</p>
                    <p><strong>Consonant Intervals:</strong> ${analysis.consonantIntervals.length} (${(analysis.consonanceRatio * 100).toFixed(1)}%)</p>
                    <p><strong>Dissonant Intervals:</strong> ${analysis.dissonantIntervals.length}</p>
                    <p><strong>Consonance Window:</strong> ±${this.consonanceWindow} cents</p>
                </div>
        `;

        if (families.length > 0) {
            html += `
                <div class="consonance-families">
                    <div class="families-header">
                        <h4>Local Consonance Families (${families.length})</h4>
                        <p>Groups of 3+ ratios where all pairs are within ${this.consonanceWindow} cents of 12TET intervals:</p>
                        
                        <div class="families-controls">
                            <div class="sort-controls">
                                <div class="sort-type-control">
                                    <label>Sort by:</label>
                                    <select id="family-sort-by" onchange="window.lrcInterconsonance.changeFamilySort()">
                                        <option value="size" ${this.familyDisplayState.sortBy === 'size' ? 'selected' : ''}>Member Count</option>
                                        <option value="avgDeviation" ${this.familyDisplayState.sortBy === 'avgDeviation' ? 'selected' : ''}>Average Deviation</option>
                                    </select>
                                </div>
                                <div class="sort-order-control">
                                    <label>Order:</label>
                                    <select id="family-sort-order" onchange="window.lrcInterconsonance.changeFamilySort()">
                                        <option value="desc" ${this.familyDisplayState.sortOrder === 'desc' ? 'selected' : ''}>Descending</option>
                                        <option value="asc" ${this.familyDisplayState.sortOrder === 'asc' ? 'selected' : ''}>Ascending</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div id="families-display">
                        ${this.generateFamiliesPage(families)}
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="no-families">
                    <h4>No Consonance Families Found</h4>
                    <p>This rhythm scale has no groups of 3+ ratios where all pairs are consonant within ±${this.consonanceWindow} cents.</p>
                </div>
            `;
        }

        // Add pitch selection controls
        html += `
            <div class="pitch-interaction">
                <h4>Pitch Consonance Explorer</h4>
                <p>Click any pitch in the scale chart above to see its consonant relationships.</p>
                ${this.selectedPitch !== null ? 
                    `<button class="clear-selection-btn" onclick="window.lrcInterconsonance.clearSelection()">Clear Selection</button>` : 
                    ''}
            </div>
        `;

        // Add interval matrix
        html += `
            <div class="interval-matrix">
                <h4>Complete Interval Matrix</h4>
                <button class="show-matrix-btn" onclick="window.lrcInterconsonance.toggleIntervalMatrix()">
                    Show All ${analysis.totalIntervals} Intervals
                </button>
                <div id="full-interval-matrix" style="display: none;">
                    ${this.generateFullIntervalMatrix(analysis)}
                </div>
            </div>
        `;

        html += `</div>`;
        displayDiv.innerHTML = html;
    }

    generateIntervalsTable(intervals) {
        let html = `
            <table class="intervals-table">
                <thead>
                    <tr>
                        <th>Positions</th>
                        <th>Ratio 1</th>
                        <th>Ratio 2</th>
                        <th>Cents</th>
                        <th>12TET</th>
                        <th>Deviation</th>
                    </tr>
                </thead>
                <tbody>
        `;

        intervals.forEach(interval => {
            html += `
                <tr>
                    <td>${interval.positions}</td>
                    <td>${interval.ratio1}</td>
                    <td>${interval.ratio2}</td>
                    <td>${interval.cents.toFixed(1)}</td>
                    <td>${interval.nearestET}</td>
                    <td>${interval.deviation >= 0 ? '+' : ''}${interval.deviation.toFixed(1)}¢</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        return html;
    }

    generateFullIntervalMatrix(analysis) {
        const allIntervals = [...analysis.consonantIntervals, ...analysis.dissonantIntervals]
            .sort((a, b) => a.deviationAbs - b.deviationAbs);

        let html = `
            <div class="matrix-summary">
                <p>${analysis.consonantIntervals.length} consonant intervals (green), ${analysis.dissonantIntervals.length} dissonant intervals (red)</p>
            </div>
            <table class="full-intervals-table">
                <thead>
                    <tr>
                        <th>Pos</th>
                        <th>Ratio 1</th>
                        <th>Ratio 2</th>
                        <th>Cents</th>
                        <th>12TET</th>
                        <th>Dev</th>
                        <th>Type</th>
                    </tr>
                </thead>
                <tbody>
        `;

        allIntervals.forEach(interval => {
            const isConsonant = interval.deviationAbs <= this.consonanceWindow;
            const rowClass = isConsonant ? 'consonant-row' : 'dissonant-row';
            
            html += `
                <tr class="${rowClass}">
                    <td>${interval.positions}</td>
                    <td>${interval.ratio1}</td>
                    <td>${interval.ratio2}</td>
                    <td>${interval.cents.toFixed(1)}</td>
                    <td>${interval.nearestET}</td>
                    <td>${interval.deviation >= 0 ? '+' : ''}${interval.deviation.toFixed(1)}¢</td>
                    <td>${isConsonant ? 'Consonant' : 'Dissonant'}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        return html;
    }

    toggleFamilyIntervals(familyIndex) {
        const detailDiv = document.getElementById(`family-intervals-${familyIndex}`);
        if (detailDiv) {
            detailDiv.style.display = detailDiv.style.display === 'none' ? 'block' : 'none';
        }
    }

    toggleIntervalMatrix() {
        const matrixDiv = document.getElementById('full-interval-matrix');
        if (matrixDiv) {
            matrixDiv.style.display = matrixDiv.style.display === 'none' ? 'block' : 'none';
        }
    }

    updateAnalyzeButton(text) {
        const btn = document.getElementById('run-interconsonance-btn');
        if (btn) {
            btn.textContent = text;
            btn.disabled = text !== 'Analyze';
        }
    }

    displayError(message) {
        const displayDiv = document.getElementById('interconsonance-display');
        if (displayDiv) {
            displayDiv.innerHTML = `
                <div class="error-message">
                    <p><strong>Error:</strong> ${message}</p>
                </div>
            `;
        }
    }

    selectPitch(pitchIndex) {
        if (!this.currentAnalysis || !this.pitchConsonanceMap.has(pitchIndex)) {
            console.log('No analysis available or invalid pitch index:', pitchIndex);
            return;
        }

        console.log(`🎯 Selected pitch ${pitchIndex + 1}:`, this.pitchConsonanceMap.get(pitchIndex).ratioFraction);
        
        this.selectedPitch = pitchIndex;
        this.updatePitchLighting();
    }

    updatePitchLighting() {
        this.clearPitchLighting();
        
        if (this.selectedPitch === null) return;

        const selectedPitchData = this.pitchConsonanceMap.get(this.selectedPitch);
        
        if (!selectedPitchData) return;

        // Highlight selected pitch in white with black text
        const selectedRow = document.querySelector(`[data-pitch-index="${this.selectedPitch}"]`);
        if (selectedRow) {
            selectedRow.classList.add('pitch-selected');
        }

        // Highlight consonant pitches in green
        selectedPitchData.consonantWith.forEach(consonantPitchIndex => {
            const consonantRow = document.querySelector(`[data-pitch-index="${consonantPitchIndex}"]`);
            if (consonantRow) {
                consonantRow.classList.add('pitch-consonant');
            }
        });

        console.log(`💡 Lighting: pitch ${this.selectedPitch + 1} selected, ${selectedPitchData.consonantWith.size} consonant pitches highlighted`);
    }

    clearPitchLighting() {
        const pitchRows = document.querySelectorAll('.pitch-row');
        pitchRows.forEach(row => {
            row.classList.remove('pitch-selected', 'pitch-consonant');
        });
    }

    enablePitchSelection() {
        console.log('🎯 Pitch selection enabled - click any pitch in the scale chart to see its consonant relationships');
        
        // Add instruction to the display
        const displayDiv = document.getElementById('interconsonance-display');
        if (displayDiv && this.currentAnalysis) {
            const instruction = document.createElement('div');
            instruction.className = 'pitch-selection-instruction';
            instruction.innerHTML = `
                <p><strong>💡 Interactive Mode:</strong> Click any pitch in the scale chart above to highlight its consonant relationships.</p>
            `;
            displayDiv.insertBefore(instruction, displayDiv.firstChild);
        }
    }

    clearSelection() {
        this.selectedPitch = null;
        this.clearPitchLighting();
        console.log('🎯 Pitch selection cleared');
        // Refresh the display to remove the clear button
        this.displayResults();
    }

    getSortedFamilies(families) {
        const sorted = [...families];
        
        sorted.sort((a, b) => {
            let comparison = 0;
            
            if (this.familyDisplayState.sortBy === 'avgDeviation') {
                comparison = a.avgDeviation - b.avgDeviation;
            } else if (this.familyDisplayState.sortBy === 'size') {
                comparison = a.size - b.size;
            }
            
            return this.familyDisplayState.sortOrder === 'desc' ? -comparison : comparison;
        });
        
        return sorted;
    }

    generateFamiliesPage(families) {
        const sortedFamilies = this.getSortedFamilies(families);
        const startIdx = this.familyDisplayState.currentPage * this.familyDisplayState.itemsPerPage;
        const endIdx = startIdx + this.familyDisplayState.itemsPerPage;
        const pageFamily = sortedFamilies.slice(startIdx, endIdx);
        const totalPages = Math.ceil(families.length / this.familyDisplayState.itemsPerPage);
        
        let html = '';
        
        if (totalPages > 1) {
            html += `
                <div class="pagination-info">
                    Page ${this.familyDisplayState.currentPage + 1} of ${totalPages} (${families.length} total families)
                </div>
            `;
        }
        
        pageFamily.forEach((family, pageIndex) => {
            const globalIndex = startIdx + pageIndex;
            html += `
                <div class="family-item">
                    <div class="family-header">
                        <strong>Family ${globalIndex + 1}</strong> (${family.size} ratios, avg dev: ${family.avgDeviation.toFixed(2)}¢)
                    </div>
                    <div class="family-ratios">
                        <strong>Ratios:</strong> ${family.ratios.join(', ')}
                    </div>
                    <div class="family-intervals">
                        <button class="show-intervals-btn" onclick="window.lrcInterconsonance.toggleFamilyIntervals(${globalIndex})">
                            Show Intervals (${family.intervals.length})
                        </button>
                        <div id="family-intervals-${globalIndex}" class="family-intervals-detail" style="display: none;">
                            ${this.generateIntervalsTable(family.intervals)}
                        </div>
                    </div>
                </div>
            `;
        });
        
        if (totalPages > 1) {
            html += `
                <div class="pagination-controls">
                    <button class="page-btn" onclick="window.lrcInterconsonance.goToFamilyPage(0)" 
                            ${this.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>First</button>
                    <button class="page-btn" onclick="window.lrcInterconsonance.goToFamilyPage(${this.familyDisplayState.currentPage - 1})" 
                            ${this.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>Previous</button>
                    
                    <span class="page-info">Page ${this.familyDisplayState.currentPage + 1} of ${totalPages}</span>
                    
                    <button class="page-btn" onclick="window.lrcInterconsonance.goToFamilyPage(${this.familyDisplayState.currentPage + 1})" 
                            ${this.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
                    <button class="page-btn" onclick="window.lrcInterconsonance.goToFamilyPage(${totalPages - 1})" 
                            ${this.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>Last</button>
                </div>
            `;
        }
        
        return html;
    }

    changeFamilySort() {
        const sortBy = document.getElementById('family-sort-by')?.value || 'size';
        const sortOrder = document.getElementById('family-sort-order')?.value || 'desc';
        
        this.familyDisplayState.sortBy = sortBy;
        this.familyDisplayState.sortOrder = sortOrder;
        this.familyDisplayState.currentPage = 0; // Reset to first page when sorting changes
        
        this.refreshFamiliesDisplay();
    }

    goToFamilyPage(pageNum) {
        if (!this.currentAnalysis) return;
        
        const totalPages = Math.ceil(this.currentAnalysis.families.length / this.familyDisplayState.itemsPerPage);
        
        if (pageNum >= 0 && pageNum < totalPages) {
            this.familyDisplayState.currentPage = pageNum;
            this.refreshFamiliesDisplay();
        }
    }

    refreshFamiliesDisplay() {
        if (!this.currentAnalysis) return;
        
        const displayDiv = document.getElementById('families-display');
        if (displayDiv) {
            displayDiv.innerHTML = this.generateFamiliesPage(this.currentAnalysis.families);
        }
    }
}

// Initialize when page loads
window.addEventListener('load', () => {
    window.lrcInterconsonance = new LRCInterconsonance();
});