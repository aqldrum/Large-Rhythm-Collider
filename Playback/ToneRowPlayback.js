// ToneRowPlayback.js - Enhanced Tone Row Playback Module
// Handles polyrhythmic audio playback with layer control, ADSR, and effects

class ToneRowPlayback {
    constructor() {
        // Playback state
        this.isPlaying = false;
        this.audioContext = null;
        this.masterGain = null;
        this.limiter = null;
        
        // Defaults
        this.cycleDuration = 10.0; // seconds
        this.cycleDurationLimits = { min: 0.1, max: 6000 };
        this.fundamentalFreq = 110;
        this.fundamentalLimits = { min: 55, max: 880 };
        this.filterLimits = { min: 20, max: 20000 };
        this.maxFrequencyHz = 3520; // Five octaves above A110
        this.masterVolumeDb = -12;
        this.lastUpdateTime = 0;
        this.tempo = 1.0;
        
        // Data
        this.spacesPlot = [];
        this.spacesPlotByLayer = [[], [], [], []];
        this.currentRhythms = [1, 1, 1, 1];
        this.toneRowData = [];
        this.toneRowDataByLayer = [];
        this.layerEvents = [[], [], [], []];

        // Tick-based scheduler
        this.ticksPerSecond = 960; // PPQ-equivalent; 960 ticks/sec with cycleDuration control
        this.scheduleIntervalMs = 30;
        this.scheduleLookaheadMs = 150;
        this.transportStartTime = 0;
        this.transportStartTick = 0;
        this.lastScheduledTickAbs = 0;
        this.cycleTicks = 0;
        this.secondsPerTick = 0;
        this.schedulerTimer = null;
        this.pendingTempoCleanup = false;
        this.pendingBridgeHold = false;
        this.pendingBridgeReleaseTicks = [null, null, null, null];
        this.bridgeVoices = [null, null, null, null];
        this.lastNoteByLayer = [null, null, null, null];
        this.lastNoteTickAbs = [null, null, null, null];
        this.lastNotePulseTicks = [null, null, null, null];
        this.pendingBridgeSustain = false;
        
        // Audio routing
        this.layerNodes = [];
        this.activeOscillators = [];
        this.scheduledEvents = [];
        this.activeLayerVoices = [null, null, null, null];
        this.legatoEnabled = false;

        // Global filters
        this.globalHighpassFilter = null;
        this.globalLowpassFilter = null;
        this.globalFilterSettings = {
            highpass: 20,
            lowpass: 20000
        };
        
        // Layer states (now with individual filters)
        this.layerStates = {
            a: this.createDefaultLayerState(),
            b: this.createDefaultLayerState(),
            c: this.createDefaultLayerState(),
            d: this.createDefaultLayerState()
        };
        
        // Solo/Mute system
        this.soloLayer = null;
        this.mutedLayers = new Set();
        
        // Current layer tab
        this.currentLayer = 'a';

        // UI modules
        this.layerControlsUI = new LayerControlsUI(this);
        this.playbackMainUI = new PlaybackMainUI(this);
        this.scaleSelectionUI = new ScaleSelectionUI(this);
        this.consonanceFamiliesUI = new ConsonanceFamiliesUI(this);

        // Core modules
        this.audioEngine = new AudioEngine(this);
        this.scheduler = new Scheduler(this);
        
        // Scale note selection system
        this.selectedNotes = new Set(); // Set of selected ratio fractions
        this.availableRatios = []; // Current scale ratios from LRCModule
        this.noteToSpacesMapping = new Map(); // Maps ratio fractions to spaces plot indices

        // Consonance family playback state
        this.familyDisplayState = {
            currentPage: 0,
            itemsPerPage: 10,
            sortBy: 'size', // 'avgDeviation' or 'size'
            sortOrder: 'desc' // 'asc' or 'desc'
        };
        this.activeFamilySelection = null; // Tracks currently highlighted family selection
        
        this.setupEventListeners();
        console.log('Tone Row Playback initialized');
    }

    createDefaultLayerState() {
        return {
            volume: -12, // dB
            waveform: 'sine',
            adsr: {
                attack: 0.001,
                decay: 0.2,
                sustain: 0.7,
                release: 0.3
            },
            // Individual layer filters
            filters: {
                highpass: 20,
                lowpass: 20000
            }
        };
    }

    // ====================================
    // AUDIO CONTEXT SETUP
    // ====================================

    async initAudioContext() {
        await this.audioEngine.initAudioContext();
    }

    // ====================================
    // EVENT LISTENERS
    // ====================================

    setupEventListeners() {
        // Generate all HTML first
        setTimeout(() => {
            this.playbackMainUI.generatePlaybackHTML();
            this.playbackMainUI.setupMasterControls();
            this.setupLayerTabs();
            this.showLayerControls('a');
        }, 100);
        
        // Listen for data updates
        window.addEventListener('rhythmGenerated', (e) => {
            this.updateData(e.detail);
        });

        // Listen for Interconsonance analysis completion
        window.addEventListener('interconsonanceAnalysisComplete', (e) => {
            // Reset pagination state for new analysis
            this.familyDisplayState.currentPage = 0;
            this.updateInterconsonanceFamilies();
        });
    }

    setupMasterControls() {
        this.playbackMainUI.setupMasterControls();
    }

    setupLayerTabs() {
        this.layerControlsUI.setupLayerTabs();
    }

    // ====================================
    // LAYER CONTROL UI
    // ====================================

    showLayerControls(layer) {
        this.layerControlsUI.showLayerControls(layer);
    }

    generatePlaybackHTML() {
        this.playbackMainUI.generatePlaybackHTML();
    }


    // ====================================
    // SOLO/MUTE SYSTEM
    // ====================================

    toggleSolo(layer) {
        if (this.soloLayer === layer) {
            // Turn off solo
            this.soloLayer = null;
        } else {
            // Solo this layer
            this.soloLayer = layer;
        }
        
        this.updateSoloMuteStates();
        this.updateSoloMuteButtons();
        this.enforceMinCycleDuration();
        console.log(`Solo state: ${this.soloLayer || 'none'}`);
    }

    toggleMute(layer) {
        if (this.mutedLayers.has(layer)) {
            this.mutedLayers.delete(layer);
        } else {
            this.mutedLayers.add(layer);
        }
        
        this.updateSoloMuteStates();
        this.updateSoloMuteButtons();
        this.enforceMinCycleDuration();
        console.log(`Muted layers: [${Array.from(this.mutedLayers).join(', ')}]`);
    }

    updateSoloMuteStates() {
        ['a', 'b', 'c', 'd'].forEach((layer, index) => {
            if (this.layerNodes[index]) {
                const shouldBeMuted = this.mutedLayers.has(layer) || 
                                      (this.soloLayer && this.soloLayer !== layer);
                
                const targetVolume = shouldBeMuted ? 
                    0 : // Complete silence for muted/non-solo layers
                    this.dbToLinear(this.layerStates[layer].volume);
                
                if (this.audioContext && this.layerNodes[index].gain) {
                    this.layerNodes[index].gain.gain.setTargetAtTime(
                        targetVolume, 
                        this.audioContext.currentTime, 
                        0.05
                    );
                }
            }
        });
    }

    updateSoloMuteButtons() {
        ['a', 'b', 'c', 'd'].forEach(layer => {
            const soloBtn = document.getElementById(`solo-${layer}`);
            const muteBtn = document.getElementById(`mute-${layer}`);
            
            if (soloBtn) {
                soloBtn.classList.toggle('active', this.soloLayer === layer);
            }
            
            if (muteBtn) {
                muteBtn.classList.toggle('active', this.mutedLayers.has(layer));
            }
        });
    }

    // ====================================
    // PARAMETER UPDATES
    // ====================================

    updateTempo(rawValue, options = {}) {
        const { syncInput = true } = options;
        const previousTempo = this.cycleDuration;
        const numericValue = Number.isFinite(rawValue) ? rawValue : previousTempo;
        const { min, max } = this.cycleDurationLimits || { min: 0.1, max: 6000 };
        const safeMin = this.getSafeMinCycleDuration(min);
        const clampedTempo = Math.min(max, Math.max(safeMin, numericValue));

        this.syncCycleDurationInputMin(safeMin);

        if (syncInput) {
            const cycleDurationInput = document.getElementById('cycle-duration');
            if (cycleDurationInput) {
                const displayValue = clampedTempo.toString();
                if (cycleDurationInput.value !== displayValue) {
                    cycleDurationInput.value = displayValue;
                }
            }
        }

        if (clampedTempo !== previousTempo) {
            console.log(`⏰ Tempo updated: ${clampedTempo}s cycle duration (realtime)`);
            this.cycleDuration = clampedTempo;
            this.handleCycleDurationChange(clampedTempo);

            // Notify visuals
            if (window.lrcVisuals) {
                window.lrcVisuals.setCycleDuration(this.cycleDuration);
            }
        }
    }

    /**
     * Calculate the safe minimum cycle duration based on current rhythm complexity.
     * Ensures notes don't fire faster than ~10ms apart to prevent dangerous audio artifacts.
     * When Scale Selection is active (some notes deselected), falls back to absolute minimum
     * to allow faster playback of smaller subsets.
     * @param {number} absoluteMin - The absolute minimum from cycleDurationLimits
     * @returns {number} - The safe minimum cycle duration in seconds
     */
    getSafeMinCycleDuration(absoluteMin = 0.1) {
        // If user has deselected any notes, allow the absolute minimum (loophole for subsets)
        const allNotesSelected = this.selectedNotes.size === 0 ||
            this.selectedNotes.size === this.availableRatios.length;
        if (!allNotesSelected) {
            return absoluteMin;
        }

        // Full scale: enforce dynamic minimum based on fastest audible layer
        const minNoteInterval = 0.01; // 10ms minimum between notes
        const layerKeys = ['a', 'b', 'c', 'd'];
        let audibleIndices = [];

        if (this.soloLayer) {
            const soloIndex = layerKeys.indexOf(this.soloLayer);
            if (soloIndex >= 0) {
                audibleIndices = [soloIndex];
            }
        } else {
            audibleIndices = layerKeys
                .map((layer, index) => (this.mutedLayers.has(layer) ? null : index))
                .filter((index) => index !== null);
        }

        if (audibleIndices.length === 0) {
            audibleIndices = [0];
        }

        const fastestLayer = Math.max(
            1,
            ...audibleIndices.map((index) => this.currentRhythms[index] || 1)
        );
        const safeMin = fastestLayer * minNoteInterval;
        return Math.max(absoluteMin, safeMin);
    }

    /**
     * Enforce the safe minimum cycle duration when rhythm data changes.
     * Updates the input field and internal value if current duration is too low.
     */
    enforceMinCycleDuration() {
        const { min } = this.cycleDurationLimits || { min: 0.1 };
        const safeMin = this.getSafeMinCycleDuration(min);
        this.syncCycleDurationInputMin(safeMin);
        if (this.cycleDuration < safeMin) {
            console.log(`⚠️ Cycle duration ${this.cycleDuration}s below safe minimum ${safeMin}s for this rhythm, adjusting...`);
            this.updateTempo(safeMin);
        }
    }

    syncCycleDurationInputMin(safeMin) {
        if (!Number.isFinite(safeMin)) return;
        const cycleDurationInput = document.getElementById('cycle-duration');
        if (cycleDurationInput) {
            const minValue = safeMin.toString();
            if (cycleDurationInput.min !== minValue) {
                cycleDurationInput.min = minValue;
            }
        }
    }


    clampFilterFrequency(value) {
        const { min, max } = this.filterLimits || { min: 20, max: 20000 };
        return Math.min(max, Math.max(min, value));
    }

    setGlobalHighpass(rawValue, options = {}) {
        const { syncInput = true } = options;
        const numericValue = Number.isFinite(rawValue) ? rawValue : this.globalFilterSettings.highpass;
        const clampedValue = this.clampFilterFrequency(numericValue);

        this.globalFilterSettings.highpass = clampedValue;

        if (syncInput) {
            const input = document.getElementById('global-hipass-freq');
            if (input && input.value !== clampedValue.toString()) {
                input.value = clampedValue;
            }
        }

        this.updateGlobalHighpassFilter(clampedValue);
    }

    setGlobalLowpass(rawValue, options = {}) {
        const { syncInput = true } = options;
        const numericValue = Number.isFinite(rawValue) ? rawValue : this.globalFilterSettings.lowpass;
        const clampedValue = this.clampFilterFrequency(numericValue);

        this.globalFilterSettings.lowpass = clampedValue;

        if (syncInput) {
            const input = document.getElementById('global-lopass-freq');
            if (input && input.value !== clampedValue.toString()) {
                input.value = clampedValue;
            }
        }

        this.updateGlobalLowpassFilter(clampedValue);
    }

    setLayerHighpass(layer, rawValue, options = {}) {
        const state = this.layerStates[layer];
        if (!state) return;

        const { syncInput = true } = options;
        const numericValue = Number.isFinite(rawValue) ? rawValue : state.filters.highpass;
        const clampedValue = this.clampFilterFrequency(numericValue);

        state.filters.highpass = clampedValue;

        if (syncInput) {
            const input = document.getElementById(`layer-hipass-${layer}`);
            if (input && input.value !== clampedValue.toString()) {
                input.value = clampedValue;
            }
        }

        this.updateLayerHighpassFilter(layer, clampedValue);
    }

    setLayerLowpass(layer, rawValue, options = {}) {
        const state = this.layerStates[layer];
        if (!state) return;

        const { syncInput = true } = options;
        const numericValue = Number.isFinite(rawValue) ? rawValue : state.filters.lowpass;
        const clampedValue = this.clampFilterFrequency(numericValue);

        state.filters.lowpass = clampedValue;

        if (syncInput) {
            const input = document.getElementById(`layer-lopass-${layer}`);
            if (input && input.value !== clampedValue.toString()) {
                input.value = clampedValue;
            }
        }

        this.updateLayerLowpassFilter(layer, clampedValue);
    }

    updateFundamentalFreq(rawValue, options = {}) {
        const { syncInput = true } = options;
        const previousFreq = this.fundamentalFreq;
        const numericValue = Number.isFinite(rawValue) ? rawValue : previousFreq;
        const { min, max } = this.fundamentalLimits;
        const clampedValue = Math.min(max, Math.max(min, numericValue));

        this.fundamentalFreq = clampedValue;

        if (syncInput) {
            const freqInput = document.getElementById('fundamental-freq');
            if (freqInput) {
                const clampedString = clampedValue.toString();
                if (freqInput.value !== clampedString) {
                    freqInput.value = clampedString;
                }
            }
        }

        if (clampedValue !== previousFreq) {
            console.log(`🎼 Fundamental frequency updated: ${clampedValue}Hz (cap: ${this.maxFrequencyHz}Hz)`);
            this.handleFundamentalChange();
        }
    }

    updateMasterVolume(dbValue) {
        this.audioEngine.updateMasterVolume(dbValue);
    }

    updateLayerVolume(layer, dbValue) {
        const shouldBeMuted = this.mutedLayers.has(layer) || 
                              (this.soloLayer && this.soloLayer !== layer);
        if (!shouldBeMuted) {
            this.audioEngine.updateLayerVolume(layer, dbValue);
        }
    }

    updateGlobalHighpassFilter(frequency) {
        this.audioEngine.setGlobalHighpassFrequency(frequency);
    }

    updateGlobalLowpassFilter(frequency) {
        this.audioEngine.setGlobalLowpassFrequency(frequency);
    }

    updateLayerHighpassFilter(layer, frequency) {
        this.audioEngine.updateLayerHighpassFilter(layer, frequency);
    }

    updateLayerLowpassFilter(layer, frequency) {
        this.audioEngine.updateLayerLowpassFilter(layer, frequency);
    }

    // ====================================
    // COLLAPSIBLE SECTIONS & SCALE CONTROLS
    // ====================================

    setupCollapsibleSections() {
        this.playbackMainUI.setupCollapsibleSections();
    }

    setupScaleControls() {
        this.scaleSelectionUI.setupScaleControls();
    }

    selectAllNotes() {
        this.scaleSelectionUI.selectAllNotes();
    }

    selectNoNotes() {
        this.scaleSelectionUI.selectNoNotes();
    }

    toggleNoteSelection(ratioFraction) {
        this.scaleSelectionUI.toggleNoteSelection(ratioFraction);
    }

    updateSelectedNotesCount() {
        this.scaleSelectionUI.updateSelectedNotesCount();
    }

    applyRealtimeNoteChanges() {
        this.scaleSelectionUI.applyRealtimeNoteChanges();
    }

    dispatchSelectedNotesEvent() {
        this.scaleSelectionUI.dispatchSelectedNotesEvent();
    }

    getRatioFractionFromFrequency(frequency) {
        return this.scaleSelectionUI.getRatioFractionFromFrequency(frequency);
    }

    isNoteMutedBySelection(globalSpacesIndex) {
        return this.scaleSelectionUI.isNoteMutedBySelection(globalSpacesIndex);
    }

    updateScaleDisplay(containerId = 'scale-chart-container') {
        this.scaleSelectionUI.updateScaleDisplay(containerId);
    }

    updateLinearPlotVisibility() {
        this.scaleSelectionUI.updateLinearPlotVisibility();
    }

    // ====================================
    // DATA MANAGEMENT
    // ====================================

    updateData(data) {
        this.spacesPlot = data.spacesPlot || [];
        this.spacesPlotByLayer = data.spacesPlotByLayer || [[], [], [], []];
        this.currentRhythms = data.rhythms || [1, 1, 1, 1];

        // Re-validate cycle duration against new rhythm's safe minimum
        this.enforceMinCycleDuration();

        // Reset family display state for new rhythm
        this.familyDisplayState = {
            currentPage: 0,
            itemsPerPage: 10,
            sortBy: 'size',
            sortOrder: 'desc'
        };
        this.clearActiveFamilySelection();
        
        // Update scale data from LRCModule
        if (window.lrcModule && window.lrcModule.currentRatios) {
            this.availableRatios = window.lrcModule.currentRatios;
            this.noteToSpacesMapping = window.lrcModule.currentSpacesMapping || new Map();
            this.selectAllNotes(); // Default behavior: select all notes
            this.updateScaleDisplay();
            this.updateInterconsonanceFamilies();
            
            console.log(`🗺️ Loaded spaces mapping for ${this.noteToSpacesMapping.size} unique ratios:`, 
                Array.from(this.noteToSpacesMapping.entries()).map(([fraction, indices]) => 
                    `${fraction}: [${indices.join(',')}]`).slice(0, 5));
        }
        
        this.generateToneRowData();
        
        console.log('Enhanced playback data updated:', {
            spacesLength: this.spacesPlot.length,
            layerLengths: this.spacesPlotByLayer.map(layer => layer.length),
            rhythms: this.currentRhythms,
            ratiosCount: this.availableRatios.length,
            selectedNotes: this.selectedNotes.size
        });
    }

    // buildNoteToSpacesMapping() method removed - now using direct mapping from LRCModule

    updateInterconsonanceFamilies(containerId = 'consonance-families-container', controlsId = 'families-controls-playback') {
        this.consonanceFamiliesUI.updateInterconsonanceFamilies(containerId, controlsId);
    }

    selectConsonanceFamily(familyIndex) {
        this.consonanceFamiliesUI.selectConsonanceFamily(familyIndex);
    }

    setActiveFamilySelection(family, index) {
        this.consonanceFamiliesUI.setActiveFamilySelection(family, index);
    }

    clearActiveFamilySelection() {
        this.consonanceFamiliesUI.clearActiveFamilySelection();
    }

    getFamilyKey(family) {
        return this.consonanceFamiliesUI.getFamilyKey(family);
    }

    updateFamilyHighlight(containerId = 'consonance-families-container') {
        this.consonanceFamiliesUI.updateFamilyHighlight(containerId);
    }

    checkActiveFamilyIntegrity() {
        this.consonanceFamiliesUI.checkActiveFamilyIntegrity();
    }

    generateToneRowData() {
        if (!this.spacesPlot.length) return;
        
        const maxFrequency = this.maxFrequencyHz;
        
        // Use the global fundamental from the full spaces plot for all layers
        const globalFundamental = Math.max(...this.spacesPlot);
        
        // Create a set of muted spaces plot indices based on note selection
        const mutedSpacesIndices = new Set();
        
        if (this.selectedNotes.size > 0) {
            // Find all spaces plot indices that correspond to deselected ratios
            this.availableRatios.forEach(ratioObj => {
                if (!this.selectedNotes.has(ratioObj.fraction)) {
                    // This ratio is deselected, so mute all its spaces plot positions
                    const spacesIndices = this.noteToSpacesMapping.get(ratioObj.fraction) || [];
                    spacesIndices.forEach(index => {
                        mutedSpacesIndices.add(index);
                    });
                }
            });
        }
        
        // Generate base tone row data by layer (without user selection muting)
        this.baseToneRowDataByLayer = this.spacesPlotByLayer.map((layerSpaces, layerIndex) => {
            if (layerSpaces.length === 0) return [];
            
            return layerSpaces
                .map((space, layerSpaceIndex) => {
                    const ratio = globalFundamental / space;
                    const frequency = this.fundamentalFreq * ratio;
                    
                    // Find the corresponding global spaces plot index for this layer space
                    const globalSpacesIndex = this.spacesPlot.indexOf(space);
                    
                    // Only check frequency limits for base muting (not user selection)
                    const isMutedByFrequency = frequency > maxFrequency;
                    
                    return {
                        index: layerSpaceIndex,
                        globalSpacesIndex: globalSpacesIndex,
                        spaceValue: space,
                        ratio: ratio,
                        frequency: frequency,
                        isMutedByFrequency: isMutedByFrequency
                    };
                });
        });
        
        // Create dynamic tone row data that includes current user selection state
        this.toneRowDataByLayer = this.baseToneRowDataByLayer.map(layerData => 
            layerData.map(noteData => ({
                ...noteData,
                isMuted: noteData.isMutedByFrequency || this.isNoteMutedBySelection(noteData.globalSpacesIndex)
            }))
        );
        
        // Log muting statistics for debugging
        const totalNotes = this.toneRowDataByLayer.reduce((sum, layer) => sum + layer.length, 0);
        const mutedNotes = this.toneRowDataByLayer.reduce((sum, layer) => sum + layer.filter(note => note.isMuted).length, 0);
        const mutedBySelection = this.toneRowDataByLayer.reduce((sum, layer) => sum + layer.filter(note => mutedSpacesIndices.has(note.globalSpacesIndex)).length, 0);
        console.log(`🎵 Generated tone row data: ${totalNotes} total, ${mutedNotes} muted (${mutedBySelection} by selection), ${totalNotes - mutedNotes} audible`);
        console.log(`🔇 Muted spaces indices:`, Array.from(mutedSpacesIndices).sort((a, b) => a - b));
    }

    recalcFrequencies() {
        const maxFreq = this.maxFrequencyHz;
        this.baseToneRowDataByLayer.forEach(layerData => {
            layerData.forEach(noteData => {
                noteData.frequency = this.fundamentalFreq * noteData.ratio;
                noteData.isMutedByFrequency = noteData.frequency > maxFreq;
            });
        });
        this.toneRowDataByLayer.forEach(layerData => {
            layerData.forEach(noteData => {
                noteData.frequency = this.fundamentalFreq * noteData.ratio;
                noteData.isMutedByFrequency = noteData.frequency > maxFreq;
                noteData.isMuted = noteData.isMutedByFrequency || this.isNoteMutedBySelection(noteData.globalSpacesIndex);
            });
        });
    }

    handleFundamentalChange(glideTime = 0.05) {
        if (!this.baseToneRowDataByLayer || !this.toneRowDataByLayer) return;
        this.recalcFrequencies();

        if (!this.audioContext || !this.isPlaying) return;
        const now = this.audioContext.currentTime;

        for (let i = 0; i < 4; i++) {
            const voice = this.activeLayerVoices[i];
            if (voice?.oscillator && voice.noteData?.ratio) {
                const newFreq = this.fundamentalFreq * voice.noteData.ratio;
                voice.noteData.frequency = newFreq;
                voice.oscillator.frequency.setTargetAtTime(newFreq, now, glideTime);
            }

            const bridge = this.bridgeVoices[i];
            if (bridge?.osc && bridge.ratio) {
                const newFreq = this.fundamentalFreq * bridge.ratio;
                bridge.osc.frequency.setTargetAtTime(newFreq, now, glideTime);
            }
        }
    }

    // ====================================
    // PLAYBACK CONTROL
    // ====================================

    async togglePlayback() {
        if (this.isPlaying) {
            this.stopPlayback();
        } else {
            await this.startPlayback();
        }
    }

    async startPlayback(startPhaseMs = 0) {
        try {
            await this.initAudioContext();

            if (this.spacesPlotByLayer.every(layer => layer.length === 0)) {
                alert('No rhythm data available. Please generate a rhythm first.');
                return;
            }

            // Prepare timing + events
            this.prepareLayerEvents();
            this.configureTiming(startPhaseMs);

            console.log('Starting playback (tick scheduler)...');

            this.isPlaying = true;
            this.updatePlayButton();

            // Kick off scheduler loop
            this.runScheduler();

            // Notify other modules
            window.dispatchEvent(new CustomEvent('playbackStarted', {
                detail: { cycleDuration: this.cycleDuration }
            }));

        } catch (error) {
            console.error('Failed to start playback:', error);
            this.isPlaying = false;
            this.updatePlayButton();
        }
    }

    stopPlayback() {
        console.log('Stopping playback...');

        this.isPlaying = false;
        this.updatePlayButton();

        // Stop scheduler
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }

        if (this.legatoEnabled) {
            this.releaseAllLayerVoices({ immediate: true });
        }
        this.activeLayerVoices = [null, null, null, null];

        // Stop all oscillators
        this.activeOscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {
                // Oscillator may already be stopped
            }
        });
        this.activeOscillators = [];

        // Release bridge voices
        this.bridgeVoices.forEach((_, idx) => this.releaseBridgeVoice(idx));
        this.pendingBridgeHold = false;
        this.pendingBridgeReleaseTicks = [null, null, null, null];

        // Clear scheduled events (legacy compatibility)
        this.scheduledEvents.forEach(id => clearTimeout(id));
        this.scheduledEvents = [];

        // Notify other modules
        window.dispatchEvent(new CustomEvent('playbackStopped'));
    }

    /**
     * Build repeating event lists for each layer (tick-based).
     */
    prepareLayerEvents() {
        this.scheduler.prepareLayerEvents();
    }

    /**
     * Configure timing params for the scheduler.
     */
    configureTiming(startPhaseMs = 0) {
        this.scheduler.configureTiming(startPhaseMs);
    }

    /**
     * Scheduler loop: schedules events in the upcoming lookahead window.
     */
    runScheduler() {
        this.scheduler.runScheduler();
    }

    /**
     * Convert AudioContext time to absolute tick (monotonic from transport start).
     */
    timeToAbsTick(targetTime) {
        return this.scheduler.timeToAbsTick(targetTime);
    }

    /**
     * Convert absolute tick back to AudioContext time.
     */
    absTickToTime(absTick) {
        return this.scheduler.absTickToTime(absTick);
    }

    /**
     * Adjust cycle duration in real time while maintaining phase.
     */
    handleCycleDurationChange(newDuration) {
        this.scheduler.handleCycleDurationChange(newDuration);
    }

    /**
     * Adjust tempo multiplier in real time while maintaining phase (optional phase override).
     */
    setTempoMultiplier(newTempo, { phaseMs = null } = {}) {
        this.scheduler.setTempoMultiplier(newTempo, { phaseMs });
    }

    /**
     * Current phase within the cycle in milliseconds.
     */
    computeCurrentPhaseMs() {
        return this.scheduler.computeCurrentPhaseMs();
    }

    /**
     * Notify listeners (e.g., visuals) of tempo/cycle changes.
     */
    emitTempoChange({ phaseMs = 0 } = {}) {
        this.scheduler.emitTempoChange({ phaseMs });
    }

    /**
     * Arm bridge/cleanup based on transport: choose the nearest upcoming event across all layers (legato off).
     */
    armTransportBridge() {
        this.scheduler.armTransportBridge();
    }

    /**
     * Schedule all layer events whose startTick falls within [startAbs, endAbs).
     */
    scheduleWindow(startAbs, endAbs) {
        this.scheduler.scheduleWindow(startAbs, endAbs);
    }

    playNoteAtTime(noteData, duration, layerIndex, layerState, startTime, absTick = null) {
        if (!this.audioContext || !this.layerNodes[layerIndex]) return;

        // If we're bridging a tempo change (legato off), release bridge voice just before the next note
        if (this.pendingBridgeHold || this.pendingBridgeReleaseTicks[layerIndex] != null) {
            const releaseTick = this.pendingBridgeReleaseTicks[layerIndex];
            if (releaseTick == null || (absTick != null && absTick >= releaseTick)) {
                this.pendingBridgeHold = false;
                this.pendingBridgeReleaseTicks[layerIndex] = null;
                console.log('[ToneRowPlayback] Tempo bridge: releasing held bridge voice before next note');
                this.releaseBridgeVoice(layerIndex);
                // Clear any legato-forced state for this layer after handoff
                // (only applies to the bridge layer; legato setting itself is untouched)
                this.lastNoteTickAbs[layerIndex] = absTick ?? this.lastNoteTickAbs[layerIndex];
            }
        }

        // After a tempo change, clear any hanging voices before the next note starts
        if (this.pendingTempoCleanup) {
            this.pendingTempoCleanup = false;
            console.log('[ToneRowPlayback] Tempo cleanup: releasing all voices before next note after tempo change');
            this.releaseAllLayerVoices({ immediate: true });
            this.stopAllOscillators();
            // Also clear any bridge voices/flags
            this.pendingBridgeHold = false;
            this.pendingBridgeReleaseTicks = [null, null, null, null];
            this.bridgeVoices.forEach((_, idx) => this.releaseBridgeVoice(idx));
        }

        const frequency = noteData.frequency;

        // Frequency limit check
        const maxFrequency = this.maxFrequencyHz;
        if (frequency > maxFrequency) {
            console.warn(`🚫 Frequency ${frequency.toFixed(2)}Hz exceeds limit ${maxFrequency.toFixed(2)}Hz`);
            return;
        }

        // Dynamic muting checks at schedule time
        const currentlyMuted = noteData.isMutedByFrequency || this.isNoteMutedBySelection(noteData.globalSpacesIndex);
        if (currentlyMuted || this.isLayerMuted(layerIndex)) {
            return;
        }

        const noteEventDetail = this.createNoteEventDetail(noteData, duration, layerIndex);
        if (noteEventDetail) {
            window.dispatchEvent(new CustomEvent('layerNoteTriggered', {
                detail: noteEventDetail
            }));
        }

        const useLegato = this.legatoEnabled;

        if (useLegato) {
            this.startLegatoNote(noteData, layerIndex, layerState, startTime, { softAttack: true });
        } else {
            this.startStandardNote(noteData, duration, layerIndex, layerState, startTime);
        }

        // Track last note per layer for potential bridging
        this.lastNoteByLayer[layerIndex] = noteData;
        if (absTick != null) {
            this.lastNoteTickAbs[layerIndex] = absTick;
            // store pulse length (ticks) at play time for window checks
            const rhythmValue = this.currentRhythms[layerIndex];
            const pulseTicks = this.cycleTicks / Math.max(1, rhythmValue || 1);
            this.lastNotePulseTicks[layerIndex] = pulseTicks;
        }
    }

    /**
     * Check mute/solo for a layer.
     */
    isLayerMuted(layerIndex) {
        const layerKey = ['a', 'b', 'c', 'd'][layerIndex];
        if (!layerKey) return false;
        if (this.soloLayer && this.soloLayer !== layerKey) return true;
        return this.mutedLayers.has(layerKey);
    }

    startStandardNote(noteData, duration, layerIndex, layerState, startTime = null) {
        const start = Math.max(
            startTime != null ? startTime : this.audioContext.currentTime,
            this.audioContext.currentTime
        );
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = layerState.waveform;
        oscillator.frequency.setValueAtTime(noteData.frequency, start);

        const envelope = this.audioContext.createGain();
        envelope.gain.setValueAtTime(0, start);

        oscillator.connect(envelope);
        envelope.connect(this.layerNodes[layerIndex].gain);

        const { attack, decay, sustain, release } = layerState.adsr;
        const sustainTime = Math.max(0, duration - attack - decay - release);
        const endTime = start + Math.max(0.01, duration);

        envelope.gain.linearRampToValueAtTime(1, start + attack);
        envelope.gain.linearRampToValueAtTime(sustain, start + attack + decay);
        envelope.gain.setValueAtTime(sustain, start + attack + decay + sustainTime);
        envelope.gain.linearRampToValueAtTime(0, start + duration);

        oscillator.start(start);
        oscillator.stop(endTime);

        // Track cleanup gain for smooth stopping if needed
        oscillator.__cleanupGain = envelope;
        this.activeLayerVoices[layerIndex] = {
            oscillator,
            envelope,
            release: Math.max(release, 0.01),
            sustain,
            endTime,
            noteData: {
                globalSpacesIndex: noteData.globalSpacesIndex,
                ratio: noteData.ratio,
                frequency: noteData.frequency,
                isMutedByFrequency: noteData.isMutedByFrequency
            }
        };
        this.trackOscillatorLifecycle(oscillator, layerIndex);
    }

    startLegatoNote(noteData, layerIndex, layerState, startTime = null, { softAttack = false } = {}) {
        if (!this.audioContext) return;

        // Release any currently sustained voice for this layer before starting the next one
        this.releaseLayerVoice(layerIndex);

        const now = this.audioContext.currentTime;
        const start = Math.max(startTime != null ? startTime : now, now);
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = layerState.waveform;
        oscillator.frequency.setValueAtTime(noteData.frequency, start);

        const envelope = this.audioContext.createGain();
        envelope.gain.setValueAtTime(0, start);

        oscillator.connect(envelope);
        envelope.connect(this.layerNodes[layerIndex].gain);

        let { attack, decay, sustain, release } = layerState.adsr;
        if (softAttack) {
            attack = Math.min(attack, 0.01);
        }

        envelope.gain.linearRampToValueAtTime(1, start + attack);
        envelope.gain.linearRampToValueAtTime(sustain, start + attack + decay);
        envelope.gain.setValueAtTime(sustain, start + attack + decay + 0.01);

        oscillator.start(start);

        // Track cleanup gain for smooth stopping if needed
        oscillator.__cleanupGain = envelope;
        const endTime = null; // legato holds until explicitly released
        this.activeLayerVoices[layerIndex] = {
            oscillator,
            envelope,
            release: Math.max(release, 0.01),
            sustain,
            endTime,
            noteData: {
                globalSpacesIndex: noteData.globalSpacesIndex,
                ratio: noteData.ratio,
                frequency: noteData.frequency,
                isMutedByFrequency: noteData.isMutedByFrequency
            }
        };

        this.trackOscillatorLifecycle(oscillator, layerIndex);
    }

    trackOscillatorLifecycle(oscillator, layerIndex = null) {
        this.activeOscillators.push(oscillator);

        oscillator.onended = () => {
            const index = this.activeOscillators.indexOf(oscillator);
            if (index > -1) {
                this.activeOscillators.splice(index, 1);
            }

            if (layerIndex !== null) {
                const voice = this.activeLayerVoices[layerIndex];
                if (voice && voice.oscillator === oscillator) {
                    this.activeLayerVoices[layerIndex] = null;
                }
            }
        };
    }

    releaseLayerVoice(layerIndex, { immediate = false } = {}) {
        const voice = this.activeLayerVoices[layerIndex];
        if (!voice || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        const releaseTime = immediate ? Math.min(voice.release, 0.05) : voice.release;
        const stopTime = now + Math.max(releaseTime, 0.01);

        try {
            voice.envelope.gain.cancelScheduledValues(now);
            const currentGain = voice.envelope.gain.value;
            voice.envelope.gain.setValueAtTime(currentGain, now);
            voice.envelope.gain.linearRampToValueAtTime(0, stopTime);
            voice.oscillator.stop(stopTime + 0.01);
        } catch (err) {
            console.warn('⚠️ Error releasing legato voice:', err);
            try {
                voice.oscillator.stop();
            } catch (stopErr) {
                // Oscillator already stopped
            }
        }

        this.activeLayerVoices[layerIndex] = null;
    }

    releaseAllLayerVoices(options = {}) {
        this.activeLayerVoices.forEach((voice, layerIndex) => {
            if (voice) {
                this.releaseLayerVoice(layerIndex, options);
            }
        });
    }

    /**
     * Stop all active oscillators immediately (used for hard cleanup).
     */
    stopAllOscillators() {
        this.audioEngine.stopAllOscillators();
    }

    /**
     * Start a temporary bridge voice to sustain until next note (legato off).
     */
    startBridgeVoice(layerIndex, noteData, layerState) {
        if (!this.audioContext || !this.layerNodes[layerIndex]) return;
        const freq = Number(noteData?.frequency) || Number(noteData?.freq) || null;
        if (!Number.isFinite(freq)) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);

        osc.type = layerState.waveform;
        osc.frequency.setValueAtTime(freq, this.audioContext.currentTime);
        osc.connect(gain);
        gain.connect(this.layerNodes[layerIndex].gain);

        const attack = 0.01;
        const target = Number(layerState.adsr?.sustain) || 1;
        gain.gain.linearRampToValueAtTime(target, this.audioContext.currentTime + attack);

        osc.start(this.audioContext.currentTime);

        this.bridgeVoices[layerIndex] = { osc, gain, ratio: noteData.ratio };
    }

    /**
     * Release a bridge voice softly.
     */
    releaseBridgeVoice(layerIndex) {
        const bridge = this.bridgeVoices[layerIndex];
        if (!bridge || !this.audioContext) return;
        const now = this.audioContext.currentTime;
        const tail = 0.02;
        try {
            bridge.gain.gain.cancelScheduledValues(now);
            bridge.gain.gain.setValueAtTime(bridge.gain.gain.value, now);
            bridge.gain.gain.linearRampToValueAtTime(0, now + tail);
            bridge.osc.stop(now + tail + 0.01);
        } catch (err) {
            try { bridge.osc.stop(); } catch (_) {}
        }
        this.bridgeVoices[layerIndex] = null;
    }

    toggleLegatoMode() {
        this.legatoEnabled = !this.legatoEnabled;
        this.updateLegatoButton();

        if (!this.legatoEnabled) {
            // Ensure any sustained notes fade out when legato is disabled
            this.releaseAllLayerVoices();
        }

        console.log(`🎼 Legato mode ${this.legatoEnabled ? 'enabled' : 'disabled'}`);

        window.dispatchEvent(new CustomEvent('legatoModeChanged', {
            detail: { enabled: this.legatoEnabled }
        }));
    }

    updateLegatoButton() {
        const legatoBtn = document.getElementById('legato-toggle');
        if (!legatoBtn) return;

        legatoBtn.classList.toggle('active', this.legatoEnabled);
    }

    updatePlayButton() {
        const playBtn = document.getElementById('play-stop-btn');
        if (playBtn) {
            if (this.isPlaying) {
                playBtn.textContent = '⏹ Stop';
                playBtn.classList.add('playing');
            } else {
                playBtn.textContent = '▶ Play';
                playBtn.classList.remove('playing');
            }
        }

        if (window.partitionsGlobalControls) {
            window.partitionsGlobalControls.updatePlayButtonState();
        }
    }

    // ====================================
    // UTILITY FUNCTIONS
    // ====================================

    dbToLinear(db) {
        return this.audioEngine.dbToLinear(db);
    }

    normalizeRatioValue(ratioValue) {
        if (!Number.isFinite(ratioValue) || ratioValue <= 0) return null;
        let normalized = ratioValue;
        while (normalized >= 2) normalized /= 2;
        while (normalized < 1) normalized *= 2;
        return normalized;
    }

    findFractionForRatio(ratioValue) {
        if (!Number.isFinite(ratioValue)) return null;

        if (this.availableRatios && this.availableRatios.length > 0) {
            let bestMatch = null;
            let smallestDiff = Infinity;

            for (const ratioObj of this.availableRatios) {
                const diff = Math.abs(ratioObj.ratio - ratioValue);
                if (diff < smallestDiff) {
                    smallestDiff = diff;
                    bestMatch = ratioObj;
                }
            }

            if (bestMatch && smallestDiff < 1e-4) {
                return bestMatch.fraction;
            }
        }

        if (window.lrcModule && typeof window.lrcModule.decimalToFraction === 'function') {
            return window.lrcModule.decimalToFraction(ratioValue);
        }

        return null;
    }

    createNoteEventDetail(noteData, duration, layerIndex) {
        if (!noteData || typeof layerIndex !== 'number') return null;

        const layerNames = ['A', 'B', 'C', 'D'];
        const layerName = layerNames[layerIndex] || `Layer${layerIndex + 1}`;
        const normalizedRatio = this.normalizeRatioValue(noteData.ratio);
        const ratioFraction = normalizedRatio ? this.findFractionForRatio(normalizedRatio) : null;

        if (!ratioFraction) {
            return null;
        }

        return {
            layerIndex,
            layerName,
            ratioFraction,
            ratioNormalized: normalizedRatio,
            ratioRaw: noteData.ratio,
            frequency: noteData.frequency,
            globalSpacesIndex: typeof noteData.globalSpacesIndex === 'number' ? noteData.globalSpacesIndex : null,
            durationSeconds: Number.isFinite(duration) ? duration : null,
            legato: this.legatoEnabled,
            timestamp: performance.now()
        };
    }

    getSortedPlaybackFamilies(families) {
        return this.consonanceFamiliesUI.getSortedPlaybackFamilies(families);
    }

    generatePlaybackFamiliesPage(families, containerId = 'consonance-families-container') {
        return this.consonanceFamiliesUI.generatePlaybackFamiliesPage(families, containerId);
    }

    changeFamilySort() {
        this.consonanceFamiliesUI.changeFamilySort();
    }

    goToFamilyPage(pageNum) {
        this.consonanceFamiliesUI.goToFamilyPage(pageNum);
    }

    refreshPlaybackFamiliesDisplay() {
        this.consonanceFamiliesUI.refreshPlaybackFamiliesDisplay();
    }

    updateSortControls() {
        this.consonanceFamiliesUI.updateSortControls();
    }
}

// ====================================
// ADSR KNOBS
// ====================================

class ADSRKnob {
    constructor(container, param, initialValue, config) {
        this.container = container;
        this.param = param;
        this.value = initialValue;
        this.config = {
            min: config.min || 0,
            max: config.max || 1,
            step: config.step || 0.001,
            unit: config.unit || 's',
            precision: config.precision || 3,
            ...config
        };
        
        this.isDragging = false;
        this.startY = 0;
        this.startValue = 0;
        
        this.createElement();
        this.setupEventListeners();
        this.updateDisplay();
    }
    
    createElement() {
        this.element = document.createElement('div');
        this.element.className = 'knob-container';
        this.element.innerHTML = `
            <div class="knob-label">${this.param}</div>
            <div class="knob">
                <div class="knob-indicator"></div>
            </div>
            <div class="knob-value"></div>
        `;
        
        this.knob = this.element.querySelector('.knob');
        this.indicator = this.element.querySelector('.knob-indicator');
        this.valueDisplay = this.element.querySelector('.knob-value');
        
        this.container.appendChild(this.element);
    }
    
    setupEventListeners() {
        // Mouse drag
        this.knob.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isDragging = true;
            this.startY = e.clientY;
            this.startValue = this.value;
            this.knob.classList.add('active');
            
            document.addEventListener('mousemove', this.handleMouseMove.bind(this));
            document.addEventListener('mouseup', this.handleMouseUp.bind(this));
        });
        
        // Double-click for direct input
        this.knob.addEventListener('dblclick', () => {
            this.showDirectInput();
        });
    }
    
    handleMouseMove(e) {
        if (!this.isDragging) return;
        
        const deltaY = this.startY - e.clientY; // Inverted: up = increase
        const sensitivity = 0.005;
        const change = deltaY * sensitivity * (this.config.max - this.config.min);
        
        this.setValue(this.startValue + change);
    }
    
    handleMouseUp() {
        this.isDragging = false;
        this.knob.classList.remove('active');
        document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
        document.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    }
    
    showDirectInput() {
        const input = document.createElement('input');
        input.className = 'knob-input';
        input.type = 'number';
        input.value = this.config.unit === 'ms' ? 
            (this.value * 1000).toFixed(0) : 
            this.value.toFixed(this.config.precision);
        input.step = this.config.step;
        
        this.element.appendChild(input);
        input.focus();
        input.select();
        
        const handleInput = () => {
            if (handleInput.handled) return;
            handleInput.handled = true;
            if (!input.isConnected) return;
            let newValue = parseFloat(input.value);
            if (this.config.unit === 'ms') {
                newValue = newValue / 1000; // Convert ms to seconds
            }
            this.setValue(newValue);
            if (input.parentElement) {
                input.remove();
            }
        };
        
        input.addEventListener('blur', handleInput, { once: true });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleInput();
            } else if (e.key === 'Escape') {
                if (!handleInput.handled && input.parentElement) {
                    handleInput.handled = true;
                    input.remove();
                }
            }
        });
    }
    
    setValue(newValue) {
        this.value = Math.max(this.config.min, Math.min(this.config.max, newValue));
        this.updateDisplay();
        
        // Notify parent of change
        if (this.onChange) {
            this.onChange(this.value);
        }
    }
    
    updateDisplay() {
        // Update indicator rotation (270 degrees range)
        const normalizedValue = (this.value - this.config.min) / (this.config.max - this.config.min);
        const rotation = (normalizedValue * 270) - 135; // -135° to +135°
        this.indicator.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        
        // Update value display
        let displayValue;
        if (this.config.unit === 'ms') {
            displayValue = `${(this.value * 1000).toFixed(0)}ms`;
        } else if (this.config.unit === 'dB' && this.param === 'sustain') {
            displayValue = `${(20 * Math.log10(this.value)).toFixed(1)}dB`;
        } else {
            displayValue = `${this.value.toFixed(this.config.precision)}${this.config.unit}`;
        }
        this.valueDisplay.textContent = displayValue;
    }
}

// Initialize ToneRowPlayback when DOM is loaded
let toneRowPlayback;

document.addEventListener('DOMContentLoaded', () => {
    toneRowPlayback = new ToneRowPlayback();
    window.toneRowPlayback = toneRowPlayback; // Make globally accessible
});
