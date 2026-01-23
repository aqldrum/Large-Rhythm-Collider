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
        this.masterVolumeDb = -24;
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
            volume: -24, // dB
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
        if (this.audioContext) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create master gain (volume control)
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.dbToLinear(this.masterVolumeDb); // Respect current master slider
            
            // Create global filters
            this.globalHighpassFilter = this.audioContext.createBiquadFilter();
            this.globalHighpassFilter.type = 'highpass';
            this.globalHighpassFilter.frequency.value = this.globalFilterSettings.highpass;
            this.globalHighpassFilter.Q.value = 0.7;
            
            this.globalLowpassFilter = this.audioContext.createBiquadFilter();
            this.globalLowpassFilter.type = 'lowpass';
            this.globalLowpassFilter.frequency.value = this.globalFilterSettings.lowpass;
            this.globalLowpassFilter.Q.value = 0.7;
            
            // Create limiter (simple compressor to prevent clipping)
            this.limiter = this.audioContext.createDynamicsCompressor();
            this.limiter.threshold.value = -1;
            this.limiter.knee.value = 0;
            this.limiter.ratio.value = 20;
            this.limiter.attack.value = 0.003;
            this.limiter.release.value = 0.01;
            
            // Create layer nodes (one for each rhythm layer with individual filters)
            this.layerNodes = [];
            ['a', 'b', 'c', 'd'].forEach((layer, index) => {
                const layerGain = this.audioContext.createGain();
                layerGain.gain.value = this.dbToLinear(this.layerStates[layer].volume);
                
                // Create individual layer filters
                const layerHighpass = this.audioContext.createBiquadFilter();
                layerHighpass.type = 'highpass';
                layerHighpass.frequency.value = this.layerStates[layer].filters.highpass;
                layerHighpass.Q.value = 0.7;
                
                const layerLowpass = this.audioContext.createBiquadFilter();
                layerLowpass.type = 'lowpass';
                layerLowpass.frequency.value = this.layerStates[layer].filters.lowpass;
                layerLowpass.Q.value = 0.7;
                
                // Connect layer audio chain: layerGain -> layerHighpass -> layerLowpass -> masterGain
                layerGain.connect(layerHighpass);
                layerHighpass.connect(layerLowpass);
                layerLowpass.connect(this.masterGain);
                
                this.layerNodes[index] = {
                    gain: layerGain,
                    highpass: layerHighpass,
                    lowpass: layerLowpass,
                    layer: layer
                };
            });
            
            // Connect global audio chain: masterGain -> globalHighpass -> globalLowpass -> limiter -> destination
            this.masterGain.connect(this.globalHighpassFilter);
            this.globalHighpassFilter.connect(this.globalLowpassFilter);
            this.globalLowpassFilter.connect(this.limiter);
            this.limiter.connect(this.audioContext.destination);

            // Apply current master volume immediately
            this.updateMasterVolume(this.masterVolumeDb);

            console.log('Audio context initialized');
            
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            throw error;
        }
    }

    // ====================================
    // EVENT LISTENERS
    // ====================================

    setupEventListeners() {
        // Generate all HTML first
        setTimeout(() => {
            this.generatePlaybackHTML();
            this.setupMasterControls();
            this.setupLayerTabs();
            this.showLayerControls('a'); // Show default layer
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
        // Play/Stop button
        const playBtn = document.getElementById('play-stop-btn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                this.togglePlayback();
            });
        }

        // Cycle duration (tempo)
        const cycleDurationInput = document.getElementById('cycle-duration');
        if (cycleDurationInput) {
            cycleDurationInput.addEventListener('input', (e) => {
                this.updateTempo(parseFloat(e.target.value), { syncInput: false });
            });

            const snapCycleDuration = () => {
                this.updateTempo(parseFloat(cycleDurationInput.value));
            };

            cycleDurationInput.addEventListener('blur', snapCycleDuration);
            cycleDurationInput.addEventListener('change', snapCycleDuration);
            cycleDurationInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapCycleDuration();
                }
            });
        }

        // Fundamental frequency
        const freqInput = document.getElementById('fundamental-freq');
        if (freqInput) {
            freqInput.addEventListener('input', (e) => {
                this.updateFundamentalFreq(parseFloat(e.target.value), { syncInput: false });
            });

            const snapToBounds = () => {
                this.updateFundamentalFreq(parseFloat(freqInput.value));
            };

            freqInput.addEventListener('blur', snapToBounds);
            freqInput.addEventListener('change', snapToBounds);
            freqInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapToBounds();
                }
            });
        }

        // Master volume
        const volumeSlider = document.getElementById('master-volume');
        const volumeValue = document.getElementById('master-volume-value');
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const dbValue = parseFloat(e.target.value);
                this.masterVolumeDb = dbValue;
                this.updateMasterVolume(dbValue);
                volumeValue.textContent = `${dbValue} dB`;
            });
        }

        // Global High-Pass Filter
        const globalHipassInput = document.getElementById('global-hipass-freq');
        if (globalHipassInput) {
            globalHipassInput.addEventListener('input', (e) => {
                this.setGlobalHighpass(parseFloat(e.target.value), { syncInput: false });
            });

            const snapGlobalHipass = () => {
                this.setGlobalHighpass(parseFloat(globalHipassInput.value));
            };

            globalHipassInput.addEventListener('blur', snapGlobalHipass);
            globalHipassInput.addEventListener('change', snapGlobalHipass);
            globalHipassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapGlobalHipass();
                }
            });
        }

        // Global Low-Pass Filter
        const globalLopassInput = document.getElementById('global-lopass-freq');
        if (globalLopassInput) {
            globalLopassInput.addEventListener('input', (e) => {
                this.setGlobalLowpass(parseFloat(e.target.value), { syncInput: false });
            });

            const snapGlobalLopass = () => {
                this.setGlobalLowpass(parseFloat(globalLopassInput.value));
            };

            globalLopassInput.addEventListener('blur', snapGlobalLopass);
            globalLopassInput.addEventListener('change', snapGlobalLopass);
            globalLopassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapGlobalLopass();
                }
            });
        }

        // Ensure filter values are clamped and synced on load
        this.setGlobalHighpass(this.globalFilterSettings.highpass);
        this.setGlobalLowpass(this.globalFilterSettings.lowpass);

        // Setup collapsible sections
        this.setupCollapsibleSections();

        // Setup scale section controls
        this.setupScaleControls();

        console.log('✅ Enhanced master controls setup complete');
    }

    setupLayerTabs() {
        const toggles = document.querySelectorAll('.playback-layer-btn');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const layer = e.target.dataset.layer;
                if (layer) {
                    this.showLayerControls(layer);
                }
            });
        });

        const legatoBtn = document.getElementById('legato-toggle');
        if (legatoBtn) {
            legatoBtn.addEventListener('click', () => {
                this.toggleLegatoMode();
            });
            this.updateLegatoButton();
        }
        
        // Show initial layer controls
        this.showLayerControls('a');
    }

    // ====================================
    // LAYER CONTROL UI
    // ====================================

    showLayerControls(layer) {
        this.currentLayer = layer;
        
        // Update toggle button appearance
        document.querySelectorAll('.playback-layer-btn').forEach(toggle => {
            toggle.classList.toggle('active', toggle.dataset.layer === layer);
        });
        
        // Generate layer controls HTML
        this.generateLayerControlsHTML(layer);
        
        // Setup layer control event listeners
        this.setupLayerControlListeners(layer);
    }

    generateLayerControlsHTML(layer) {
        const container = document.getElementById('layer-controls-container');
        if (!container) return;
        
        const state = this.layerStates[layer];
        const layerName = layer.toUpperCase();
        const layerColors = {
            a: '#ff6b6b', b: '#4ecdc4', c: '#00a638ff', d: '#f9ca24'
        };
        const { min: filterMin, max: filterMax } = this.filterLimits;
        
        container.innerHTML = `
            <div class="layer-control-header">
                <h4 style="color: ${layerColors[layer]}">Layer ${layerName} Controls</h4>
                <div class="layer-control-buttons">
                    <button id="solo-${layer}" class="control-btn ${this.soloLayer === layer ? 'active' : ''}">
                        Solo
                    </button>
                    <button id="mute-${layer}" class="control-btn ${this.mutedLayers.has(layer) ? 'active' : ''}">
                        Mute
                    </button>
                </div>
            </div>
            
            <!-- Oscillator Controls -->
            <div class="oscillator-controls">
                <div class="control-group">
                    <label for="waveform-${layer}">Waveform</label>
                    <select id="waveform-${layer}">
                        <option value="sine" ${state.waveform === 'sine' ? 'selected' : ''}>Sine</option>
                        <option value="triangle" ${state.waveform === 'triangle' ? 'selected' : ''}>Triangle</option>
                        <option value="sawtooth" ${state.waveform === 'sawtooth' ? 'selected' : ''}>Sawtooth</option>
                        <option value="square" ${state.waveform === 'square' ? 'selected' : ''}>Square</option>
                    </select>
                </div>
                <div class="control-group">
                    <label for="volume-${layer}">Volume</label>
                    <input type="range" id="volume-${layer}" min="-99" max="0" step="1" value="${state.volume}">
                    <div class="range-value" id="volume-value-${layer}">${state.volume} dB</div>
                </div>
            </div>
            
            <!-- Individual Layer Filters -->
            <div class="layer-filters">
                <div class="control-group">
                    <label for="layer-hipass-${layer}">Hi-Pass (Hz):</label>
                    <input type="number" id="layer-hipass-${layer}" min="${filterMin}" max="${filterMax}" value="${state.filters.highpass}">
                </div>
                <div class="control-group">
                    <label for="layer-lopass-${layer}">Lo-Pass (Hz):</label>
                    <input type="number" id="layer-lopass-${layer}" min="${filterMin}" max="${filterMax}" value="${state.filters.lowpass}">
                </div>
            </div>
            
            <!-- ADSR Envelope -->
            <div class="adsr-section">
                <h5>ADSR Envelope</h5>
                <div class="adsr-controls" id="adsr-${layer}">
                    <!-- Knobs will be created by JavaScript -->
                </div>
            </div>
        `;
        
        // Create ADSR knobs
        this.createADSRKnobs(layer, state);
    }

    createADSRKnobs(layer, state) {
        const adsrContainer = document.getElementById(`adsr-${layer}`);
        if (!adsrContainer) return;
        
        // Clear existing knobs
        adsrContainer.innerHTML = '';
        
        // ADSR knob configurations
        const knobConfigs = {
            attack: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 },
            decay: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 },
            sustain: { min: 0.001, max: 1, step: 0.01, unit: '', precision: 2 },
            release: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 }
        };
        
        // Create knobs
        Object.entries(knobConfigs).forEach(([param, config]) => {
            const knob = new ADSRKnob(adsrContainer, param, state.adsr[param], config);
            knob.onChange = (value) => {
                state.adsr[param] = value;
                console.log(`Layer ${layer.toUpperCase()} ${param}: ${value}`);
            };
        });
    }

    generatePlaybackHTML() {
        const container = document.getElementById('playback-controls-container');
        if (!container) return;
        
        const { min: filterMin, max: filterMax } = this.filterLimits;

        container.innerHTML = `
            <!-- Main Section (always expanded) -->
            <div class="playback-section main-section">
                <div class="section-header">
                    <h4>Main Controls</h4>
                </div>
                <div class="section-content">
                    <div class="playback-controls">
                        <button id="play-stop-btn" class="play-btn">▶</button>
                        
                        <div class="control-group">
                            <label>Cycle Time (s):</label>
                            <input type="number" id="cycle-duration" min="${this.cycleDurationLimits.min}" max="${this.cycleDurationLimits.max}" step="0.1" value="${this.cycleDuration}">
                        </div>
                        
                        <div class="control-group">
                            <label>Fundamental (Hz):</label>
                            <input type="number" id="fundamental-freq" min="${this.fundamentalLimits.min}" max="${this.fundamentalLimits.max}" value="${this.fundamentalFreq}">
                        </div>
                        
                        <div class="control-group">
                            <label>Master Volume:</label>
                            <input type="range" id="master-volume" min="-40" max="0" value="${this.masterVolumeDb}">
                            <span id="master-volume-value">${this.masterVolumeDb} dB</span>
                        </div>
                    </div>
                    
                    <!-- Global Filters -->
                    <div class="global-filters">
                        <div class="control-group">
                            <label>Hi-Pass (Hz):</label>
                            <input type="number" id="global-hipass-freq" min="${filterMin}" max="${filterMax}" value="${this.globalFilterSettings.highpass}">
                        </div>
                        <div class="control-group">
                            <label>Lo-Pass (Hz):</label>
                            <input type="number" id="global-lopass-freq" min="${filterMin}" max="${filterMax}" value="${this.globalFilterSettings.lowpass}">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Layer Controls Section (collapsible) -->
            <div class="playback-section collapsible-section">
                <button class="collapse-btn layer-controls-header" data-target="layer-controls-content">
                    Layer Controls
                </button>
                <div id="layer-controls-content" class="collapse-content">
                    <!-- Layer Toggle Buttons -->
                    <div class="playback-layer-toggles">
                        <button class="playback-layer-btn active" data-layer="a" style="background: #ff6b6b;">A</button>
                        <button class="playback-layer-btn" data-layer="b" style="background: #4ecdc4;">B</button>
                        <button class="playback-layer-btn" data-layer="c" style="background: #00a638ff;">C</button>
                        <button class="playback-layer-btn" data-layer="d" style="background: #f9ca24;">D</button>
                    </div>

                    <div class="playback-legato-row">
                        <button id="legato-toggle" class="legato-toggle-btn" title="Sustain layer notes until another retriggers">Legato</button>
                    </div>
                    
                    <!-- Dynamic Layer Controls -->
                    <div id="layer-controls-container"></div>
                </div>
            </div>
            
            <!-- Scale Section (collapsible) -->
            <div class="playback-section collapsible-section">
                <button class="collapse-btn scale-header" data-target="scale-content">
                    Scale Selection
                </button>
                <div id="scale-content" class="collapse-content">
                    <div class="scale-controls">
                        <button id="select-all-notes" class="control-btn" data-scale-action="select-all">Select All</button>
                        <button id="select-none-notes" class="control-btn" data-scale-action="select-none">None</button>
                        <span id="selected-notes-count" data-scale-count>0 of 0 notes selected</span>
                    </div>
                    <div id="scale-chart-container" class="scale-chart-container">
                        <!-- Scale chart will be populated by JavaScript -->
                    </div>
                </div>
            </div>
            
            <!-- Interconsonance Section (collapsible) -->
            <div class="playback-section collapsible-section">
                <button class="collapse-btn interconsonance-header" data-target="interconsonance-families-content">
                    Consonance Families
                </button>
                <div id="interconsonance-families-content" class="collapse-content">
                    <div class="families-controls-playback" id="families-controls-playback" style="display: none;">
                        <div class="sort-controls">
                            <label>Sort by:</label>
                            <select id="playback-family-sort-by" onchange="window.toneRowPlayback.changeFamilySort()">
                                <option value="size">Member Count</option>                                
                                <option value="avgDeviation">Average Deviation</option>
                            </select>
                            <select id="playback-family-sort-order" onchange="window.toneRowPlayback.changeFamilySort()">
                                <option value="desc">Descending</option>
                                <option value="asc">Ascending</option>
                            </select>
                        </div>
                    </div>
                    <div id="consonance-families-container">
                        <!-- Consonance families will be populated by JavaScript -->
                    </div>
                </div>
            </div>
        `;
        
        console.log('🎛️ Enhanced Playback HTML generated with collapsible sections');
    }

    setupLayerControlListeners(layer) {
        const state = this.layerStates[layer];
        
        // Solo button
        const soloBtn = document.getElementById(`solo-${layer}`);
        if (soloBtn) {
            soloBtn.addEventListener('click', () => {
                this.toggleSolo(layer);
            });
        }
        
        // Mute button
        const muteBtn = document.getElementById(`mute-${layer}`);
        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                this.toggleMute(layer);
            });
        }
        
        // Waveform selector
        const waveformSelect = document.getElementById(`waveform-${layer}`);
        if (waveformSelect) {
            waveformSelect.addEventListener('change', (e) => {
                state.waveform = e.target.value;
            });
        }
        
        // Volume slider
        const volumeSlider = document.getElementById(`volume-${layer}`);
        const volumeValue = document.getElementById(`volume-value-${layer}`);
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const dbValue = parseFloat(e.target.value);
                state.volume = dbValue;
                volumeValue.textContent = `${dbValue} dB`;
                this.updateLayerVolume(layer, dbValue);
            });
        }

        // Layer High-Pass Filter
        const layerHipassInput = document.getElementById(`layer-hipass-${layer}`);
        if (layerHipassInput) {
            layerHipassInput.addEventListener('input', (e) => {
                this.setLayerHighpass(layer, parseFloat(e.target.value), { syncInput: false });
            });

            const snapLayerHipass = () => {
                this.setLayerHighpass(layer, parseFloat(layerHipassInput.value));
            };

            layerHipassInput.addEventListener('blur', snapLayerHipass);
            layerHipassInput.addEventListener('change', snapLayerHipass);
            layerHipassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapLayerHipass();
                }
            });
        }

        // Layer Low-Pass Filter
        const layerLopassInput = document.getElementById(`layer-lopass-${layer}`);
        if (layerLopassInput) {
            layerLopassInput.addEventListener('input', (e) => {
                this.setLayerLowpass(layer, parseFloat(e.target.value), { syncInput: false });
            });

            const snapLayerLopass = () => {
                this.setLayerLowpass(layer, parseFloat(layerLopassInput.value));
            };

            layerLopassInput.addEventListener('blur', snapLayerLopass);
            layerLopassInput.addEventListener('change', snapLayerLopass);
            layerLopassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapLayerLopass();
                }
            });
        }

        // ADSR controls
        ['attack', 'decay', 'sustain', 'release'].forEach(param => {
            const slider = document.getElementById(`${param}-${layer}`);
            const valueSpan = document.getElementById(`${param}-value-${layer}`);
            
            if (slider && valueSpan) {
                slider.addEventListener('input', (e) => {
                    const value = parseFloat(e.target.value);
                    state.adsr[param] = value;
                    
                    if (param === 'sustain') {
                        valueSpan.textContent = value.toFixed(2);
                    } else {
                        valueSpan.textContent = `${value.toFixed(3)}s`;
                    }
                });
            }
        });

        // Clamp and sync current filter values after listeners are attached
        this.setLayerHighpass(layer, state.filters.highpass);
        this.setLayerLowpass(layer, state.filters.lowpass);
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

            if (this.spacesPlot.length > 0) {
                this.generateToneRowData();
            }

            if (this.isPlaying) {
                this.stopPlayback();
                setTimeout(() => this.startPlayback(), 100);
            }
        }
    }

    updateMasterVolume(dbValue) {
        if (this.masterGain) {
            const linearValue = this.dbToLinear(dbValue);
            this.masterGain.gain.setTargetAtTime(
                linearValue, 
                this.audioContext.currentTime, 
                0.05
            );
        }
    }

    updateLayerVolume(layer, dbValue) {
        const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
        if (layerIndex >= 0 && this.layerNodes[layerIndex]) {
            // Only update if not muted/soloed
            const shouldBeMuted = this.mutedLayers.has(layer) || 
                                  (this.soloLayer && this.soloLayer !== layer);
            
            if (!shouldBeMuted && this.audioContext) {
                const linearValue = this.dbToLinear(dbValue);
                this.layerNodes[layerIndex].gain.gain.setTargetAtTime(
                    linearValue, 
                    this.audioContext.currentTime, 
                    0.05
                );
            }
        }
    }

    updateGlobalHighpassFilter(frequency) {
        if (this.globalHighpassFilter && this.audioContext) {
            this.globalHighpassFilter.frequency.setTargetAtTime(
                frequency, 
                this.audioContext.currentTime, 
                0.05
            );
        }
    }

    updateGlobalLowpassFilter(frequency) {
        if (this.globalLowpassFilter && this.audioContext) {
            this.globalLowpassFilter.frequency.setTargetAtTime(
                frequency, 
                this.audioContext.currentTime, 
                0.05
            );
        }
    }

    updateLayerHighpassFilter(layer, frequency) {
        const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
        if (layerIndex >= 0 && this.layerNodes[layerIndex] && this.layerNodes[layerIndex].highpass && this.audioContext) {
            this.layerNodes[layerIndex].highpass.frequency.setTargetAtTime(
                frequency, 
                this.audioContext.currentTime, 
                0.05
            );
        }
    }

    updateLayerLowpassFilter(layer, frequency) {
        const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
        if (layerIndex >= 0 && this.layerNodes[layerIndex] && this.layerNodes[layerIndex].lowpass && this.audioContext) {
            this.layerNodes[layerIndex].lowpass.frequency.setTargetAtTime(
                frequency, 
                this.audioContext.currentTime, 
                0.05
            );
        }
    }

    // ====================================
    // COLLAPSIBLE SECTIONS & SCALE CONTROLS
    // ====================================

    setupCollapsibleSections() {
        // Setup all collapsible section buttons
        const collapseBtns = document.querySelectorAll('.collapse-btn');
        collapseBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = btn.getAttribute('data-target');
                const content = document.getElementById(target);
                
                if (content) {
                    const isExpanded = content.style.display !== 'none';
                    content.style.display = isExpanded ? 'none' : 'block';
                    
                    // Update button appearance
                    btn.classList.toggle('collapsed', isExpanded);
                    
                    console.log(`${target} section ${isExpanded ? 'collapsed' : 'expanded'}`);
                }
            });
        });

        // Default all sections to expanded
        document.querySelectorAll('.collapse-content').forEach(content => {
            content.style.display = 'block';
        });

        console.log('✅ Collapsible sections setup complete');
    }

    setupScaleControls() {
        const selectAllBtns = document.querySelectorAll('[data-scale-action="select-all"]');
        selectAllBtns.forEach(btn => {
            if (btn.dataset.scaleBound === 'true') return;
            btn.addEventListener('click', () => {
                this.selectAllNotes();
            });
            btn.dataset.scaleBound = 'true';
        });

        const selectNoneBtns = document.querySelectorAll('[data-scale-action="select-none"]');
        selectNoneBtns.forEach(btn => {
            if (btn.dataset.scaleBound === 'true') return;
            btn.addEventListener('click', () => {
                this.selectNoNotes();
            });
            btn.dataset.scaleBound = 'true';
        });

        console.log('✅ Scale controls setup complete');
    }

    selectAllNotes() {
        this.selectedNotes.clear();
        this.availableRatios.forEach(ratioObj => {
            this.selectedNotes.add(ratioObj.fraction);
        });

        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.generateToneRowData(); // Regenerate audio data with new selection
        this.dispatchSelectedNotesEvent();

        // Re-enforce safe minimum now that all notes are selected again
        this.enforceMinCycleDuration();

        console.log(`✅ Selected all ${this.selectedNotes.size} notes`);

        this.checkActiveFamilyIntegrity();
    }

    selectNoNotes() {
        this.selectedNotes.clear();
        
        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.generateToneRowData(); // Regenerate audio data with new selection
        this.dispatchSelectedNotesEvent();
        
        console.log('✅ Deselected all notes');

        this.checkActiveFamilyIntegrity();
    }

    toggleNoteSelection(ratioFraction) {
        if (this.selectedNotes.has(ratioFraction)) {
            this.selectedNotes.delete(ratioFraction);
        } else {
            this.selectedNotes.add(ratioFraction);
        }

        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.generateToneRowData(); // Regenerate audio data with new selection

        // If playback is currently running, apply the changes in real-time
        if (this.isPlaying) {
            this.applyRealtimeNoteChanges();
        }

        this.dispatchSelectedNotesEvent();

        // If all notes are now selected, re-enforce safe minimum cycle duration
        if (this.selectedNotes.size === this.availableRatios.length) {
            this.enforceMinCycleDuration();
        }

        console.log(`🎵 Toggled note ${ratioFraction} (${this.selectedNotes.has(ratioFraction) ? 'selected' : 'deselected'})`);

        this.checkActiveFamilyIntegrity();
    }

    updateSelectedNotesCount() {
        const countText = `${this.selectedNotes.size} of ${this.availableRatios.length} notes selected`;
        const countElements = document.querySelectorAll('[data-scale-count]');
        countElements.forEach(element => {
            element.textContent = countText;
        });
    }

    applyRealtimeNoteChanges() {
        if (this.legatoEnabled) {
            this.activeLayerVoices.forEach((voice, layerIndex) => {
                if (!voice) return;
                const shouldMute = voice.noteData?.isMutedByFrequency || this.isNoteMutedBySelection(voice.noteData?.globalSpacesIndex);
                if (shouldMute) {
                    this.releaseLayerVoice(layerIndex);
                }
            });
        }

        console.log('🔄 Real-time note selection changes are active - scheduled notes will check current state');
    }

    dispatchSelectedNotesEvent() {
        const selectedArray = Array.from(this.selectedNotes);
        window.dispatchEvent(new CustomEvent('scaleSelectionChanged', {
            detail: {
                selectedNotes: selectedArray
            }
        }));
    }

    getRatioFractionFromFrequency(frequency) {
        // Find the ratio object that matches this frequency
        for (const ratioObj of this.availableRatios) {
            // Calculate expected frequency for this ratio
            const expectedFreq = this.fundamentalFreq * ratioObj.ratio;
            if (Math.abs(expectedFreq - frequency) < 0.1) { // Small tolerance for float comparison
                return ratioObj.fraction;
            }
        }
        return null; // Not found
    }

    isNoteMutedBySelection(globalSpacesIndex) {
        // If no notes are selected, all notes should play
        if (this.selectedNotes.size === 0) return false;
        
        // Check if this spaces plot index corresponds to any selected ratio
        for (const [fraction, spacesIndices] of this.noteToSpacesMapping.entries()) {
            if (spacesIndices.includes(globalSpacesIndex)) {
                // This note corresponds to a ratio - check if that ratio is selected
                return !this.selectedNotes.has(fraction);
            }
        }
        
        // If we can't find the ratio, don't mute it (safer default)
        return false;
    }

    updateScaleDisplay(containerId = 'scale-chart-container') {
        const container = document.getElementById(containerId);
        if (!container || !this.availableRatios.length) {
            if (container) {
                container.innerHTML = '<p style="color: #666; font-size: 11px; padding: 8px;">No scale data available.</p>';
            }
            return;
        }

        // Preserve scroll position
        const scrollableElement = container.querySelector('.scale-chart-scroll');
        const currentScrollTop = scrollableElement ? scrollableElement.scrollTop : 0;

        // Create scrollable scale chart
        const scrollClass = containerId === 'partitions-scale-container'
            ? 'scale-chart-scroll partitions-scale-scroll'
            : 'scale-chart-scroll';
        let html = `
            <div class="${scrollClass} ${this.availableRatios.length > 15 ? 'scrollable' : ''}">
                <table class="scale-chart-table">
                    <thead>
                        <tr>
                            <th>Ratio</th>
                            <th>Cents</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        this.availableRatios.forEach(ratioObj => {
            const isSelected = this.selectedNotes.has(ratioObj.fraction);
            const rowClass = isSelected ? 'note-selected' : 'note-deselected';
            html += `
                <tr class="scale-row ${rowClass}" data-ratio="${ratioObj.fraction}">
                    <td>${ratioObj.fraction}</td>
                    <td>${ratioObj.cents.toFixed(1)}</td>
                    <td>${ratioObj.frequency}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = html;

        // Restore scroll position
        const newScrollableElement = container.querySelector('.scale-chart-scroll');
        if (newScrollableElement && currentScrollTop > 0) {
            newScrollableElement.scrollTop = currentScrollTop;
        }

        // Add click listeners to table rows
        container.querySelectorAll('.scale-row').forEach(row => {
            row.addEventListener('click', () => {
                const ratioFraction = row.getAttribute('data-ratio');
                if (ratioFraction) {
                    this.toggleNoteSelection(ratioFraction);
                }
            });
        });

        if (containerId === 'scale-chart-container') {
            const partitionsContainer = document.getElementById('partitions-scale-container');
            if (partitionsContainer) {
                this.updateScaleDisplay('partitions-scale-container');
            }
        }
    }

    updateLinearPlotVisibility() {
        // Calculate which spaces plot indices should be visible/hidden
        const hiddenSpacesIndices = new Set();
        
        if (this.selectedNotes.size > 0) {
            // Find all spaces plot indices that correspond to deselected ratios
            this.availableRatios.forEach(ratioObj => {
                if (!this.selectedNotes.has(ratioObj.fraction)) {
                    // This ratio is deselected, so hide all its spaces plot positions
                    const spacesIndices = this.noteToSpacesMapping.get(ratioObj.fraction) || [];
                    spacesIndices.forEach(index => {
                        hiddenSpacesIndices.add(index);
                    });
                }
            });
        }
        
        const selectedRatios = Array.from(this.selectedNotes);
        const hiddenIndices = Array.from(hiddenSpacesIndices);
        
        console.log(`🎨 Linear plot visibility update: ${selectedRatios.length} ratios selected, hiding ${hiddenIndices.length} spaces plot indices:`, hiddenIndices);
        
        // TODO: Interface with LRCVisuals to hide/show dots by spaces plot index
        // When ready, this should call something like:
        // if (window.lrcVisuals && window.lrcVisuals.updateDotVisibility) {
        //     window.lrcVisuals.updateDotVisibility(hiddenIndices);
        // }
        
        // Dispatch event for other systems that might want to know about visibility changes
        window.dispatchEvent(new CustomEvent('spacesPlotVisibilityChanged', {
            detail: {
                selectedRatios: selectedRatios,
                hiddenSpacesIndices: hiddenIndices,
                visibleSpacesIndices: Array.from(Array(this.spacesPlot.length).keys()).filter(i => !hiddenSpacesIndices.has(i))
            }
        }));
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
        const container = document.getElementById(containerId);
        const controls = controlsId ? document.getElementById(controlsId) : null;
        if (!container) return;

        // Get consonance families from Interconsonance analyzer if available
        if (window.lrcInterconsonance && window.lrcInterconsonance.currentAnalysis) {
            const families = window.lrcInterconsonance.currentAnalysis.families;

            if (families && families.length > 0) {
                // Show controls if there are families
                if (controls) controls.style.display = 'block';

                // Reset to first page when new data comes in
                this.familyDisplayState.currentPage = 0;

                // Generate paginated display
                container.innerHTML = this.generatePlaybackFamiliesPage(families, containerId);

                // Update sort control selections
                this.updateSortControls();
                this.updateFamilyHighlight(containerId);

                console.log(`🎵 Updated consonance families display with ${families.length} families`);
            } else {
                if (controls) controls.style.display = 'none';
                container.innerHTML = '<p style="color: #666; font-size: 11px; padding: 8px;">No consonance families detected.</p>';
                this.clearActiveFamilySelection();
            }
        } else {
            if (controls) controls.style.display = 'none';
            container.innerHTML = '<p style="color: #666; font-size: 11px; padding: 8px;">Run Interconsonance analysis first.</p>';
            this.clearActiveFamilySelection();
        }

        if (containerId === 'consonance-families-container') {
            const partitionsContainer = document.getElementById('partitions-families-container');
            if (partitionsContainer) {
                this.updateInterconsonanceFamilies('partitions-families-container', null);
            }
        }
    }

    selectConsonanceFamily(familyIndex) {
        if (!window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) return;
        
        const sortedFamilies = this.getSortedPlaybackFamilies(window.lrcInterconsonance.currentAnalysis.families);
        if (!sortedFamilies || familyIndex >= sortedFamilies.length) return;
        
        const family = sortedFamilies[familyIndex];
        
        // Clear current selection
        this.selectedNotes.clear();
        
        // Select only the ratios in this family
        family.ratios.forEach(ratioFraction => {
            this.selectedNotes.add(ratioFraction);
        });
        
        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.generateToneRowData(); // Regenerate audio data with new selection
        this.dispatchSelectedNotesEvent();
        
        console.log(`🎭 Selected consonance family ${familyIndex + 1} with ${family.ratios.length} ratios:`, family.ratios);

        this.setActiveFamilySelection(family, familyIndex);
    }

    setActiveFamilySelection(family, index) {
        if (!family) {
            this.clearActiveFamilySelection();
            return;
        }

        this.activeFamilySelection = {
            key: this.getFamilyKey(family),
            index: index,
            ratios: new Set(family.ratios)
        };

        this.updateFamilyHighlight();
    }

    clearActiveFamilySelection() {
        this.activeFamilySelection = null;
        this.updateFamilyHighlight();
    }

    getFamilyKey(family) {
        if (!family || !Array.isArray(family.ratios)) return null;
        return family.ratios.slice().sort().join('|');
    }

    updateFamilyHighlight(containerId = 'consonance-families-container') {
        const container = document.getElementById(containerId);
        const buttons = container ? container.querySelectorAll('.consonance-family-btn') : [];
        buttons.forEach(btn => btn.classList.remove('active'));

        if (!this.activeFamilySelection || !window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) {
            return;
        }

        const families = window.lrcInterconsonance.currentAnalysis.families;
        if (!families || families.length === 0) {
            this.activeFamilySelection = null;
            return;
        }

        const sortedFamilies = this.getSortedPlaybackFamilies(families);
        const key = this.activeFamilySelection.key;
        const newIndex = sortedFamilies.findIndex(fam => this.getFamilyKey(fam) === key);

        if (newIndex === -1) {
            this.activeFamilySelection = null;
            return;
        }

        this.activeFamilySelection.index = newIndex;
        this.activeFamilySelection.ratios = new Set(sortedFamilies[newIndex].ratios);

        buttons.forEach(btn => {
            const btnIndex = parseInt(btn.getAttribute('data-family-index'), 10);
            if (!Number.isNaN(btnIndex) && btnIndex === newIndex) {
                btn.classList.add('active');
            }
        });

        // Also update the Partitions view if it exists
        if (containerId === 'consonance-families-container') {
            const partitionsContainer = document.getElementById('partitions-families-container');
            if (partitionsContainer) {
                const partitionsButtons = partitionsContainer.querySelectorAll('.consonance-family-btn');
                partitionsButtons.forEach(btn => {
                    const btnIndex = parseInt(btn.getAttribute('data-family-index'), 10);
                    btn.classList.toggle('active', !Number.isNaN(btnIndex) && btnIndex === newIndex);
                });
            }
        }
    }

    checkActiveFamilyIntegrity() {
        if (!this.activeFamilySelection) return;

        const requiredRatios = this.activeFamilySelection.ratios;
        const allPresent = Array.from(requiredRatios).every(ratio => this.selectedNotes.has(ratio));

        if (!allPresent) {
            this.clearActiveFamilySelection();
        } else {
            this.updateFamilyHighlight();
        }
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
        this.layerEvents = [[], [], [], []];
        const tps = Math.max(1, this.ticksPerSecond);
        const cycleTicks = Math.max(1, Math.round(this.cycleDuration * tps));
        this.cycleTicks = cycleTicks;

        ['a', 'b', 'c', 'd'].forEach((layer, layerIndex) => {
            const rhythmValue = this.currentRhythms[layerIndex];
            const layerData = this.toneRowDataByLayer[layerIndex];
            if (rhythmValue <= 1 || !layerData || !layerData.length) return;

            const ticksPerNote = cycleTicks / rhythmValue;
            this.layerEvents[layerIndex] = layerData.map((noteData, noteIndex) => {
                const startTick = Math.round(noteIndex * ticksPerNote) % cycleTicks;
                const durationTicks = Math.max(1, Math.round(ticksPerNote));
                return {
                    layerIndex,
                    startTick,
                    durationTicks,
                    noteData
                };
            });
        });
    }

    /**
     * Configure timing params for the scheduler.
     */
    configureTiming(startPhaseMs = 0) {
        const tempo = Math.max(0.0001, this.tempo || 1);
        this.secondsPerTick = 1 / (this.ticksPerSecond * tempo);
        this.cycleTicks = Math.max(1, Math.round(this.cycleDuration * this.ticksPerSecond));

        // Convert start phase (ms into cycle) to ticks
        const startTick = Math.floor((Math.max(0, startPhaseMs) / 1000) / this.secondsPerTick) % this.cycleTicks;
        this.transportStartTick = startTick;
        this.lastScheduledTickAbs = startTick;
        const now = this.audioContext.currentTime;
        this.transportStartTime = now;
    }

    /**
     * Scheduler loop: schedules events in the upcoming lookahead window.
     */
    runScheduler() {
        if (!this.isPlaying || !this.audioContext) return;

        const now = this.audioContext.currentTime;
        const lookaheadSec = this.scheduleLookaheadMs / 1000;
        const windowEndTime = now + lookaheadSec;

        const windowStartTickAbs = this.lastScheduledTickAbs;
        const windowEndTickAbs = this.timeToAbsTick(windowEndTime);

        this.scheduleWindow(windowStartTickAbs, windowEndTickAbs);
        this.lastScheduledTickAbs = windowEndTickAbs;

        this.schedulerTimer = setTimeout(() => this.runScheduler(), this.scheduleIntervalMs);
    }

    /**
     * Convert AudioContext time to absolute tick (monotonic from transport start).
     */
    timeToAbsTick(targetTime) {
        const elapsedSec = Math.max(0, targetTime - this.transportStartTime);
        const deltaTicks = Math.floor(elapsedSec / this.secondsPerTick);
        return this.transportStartTick + deltaTicks;
    }

    /**
     * Convert absolute tick back to AudioContext time.
     */
    absTickToTime(absTick) {
        const deltaTicks = absTick - this.transportStartTick;
        return this.transportStartTime + (deltaTicks * this.secondsPerTick);
    }

    /**
     * Adjust cycle duration in real time while maintaining phase.
     */
    handleCycleDurationChange(newDuration) {
        const tps = Math.max(1, this.ticksPerSecond);
        const prevCycleTicks = this.cycleTicks || Math.max(1, Math.round(this.cycleDuration * tps));
        const tempo = Math.max(0.0001, this.tempo || 1);

        let phaseRatio = 0;
        if (this.isPlaying && this.audioContext) {
            const now = this.audioContext.currentTime;
            const currentAbsTick = this.timeToAbsTick(now);
            phaseRatio = ((currentAbsTick % prevCycleTicks) + prevCycleTicks) % prevCycleTicks;
            phaseRatio = phaseRatio / prevCycleTicks;
        }

        this.cycleDuration = newDuration;
        this.cycleTicks = Math.max(1, Math.round(this.cycleDuration * tps));
        this.secondsPerTick = 1 / (tps * tempo);
        this.prepareLayerEvents();

        if (this.isPlaying && this.audioContext) {
            const now = this.audioContext.currentTime;
            const startTick = Math.floor(phaseRatio * this.cycleTicks) % this.cycleTicks;
            this.transportStartTick = startTick;
            this.lastScheduledTickAbs = startTick;
            this.transportStartTime = now;
            if (this.schedulerTimer) {
                clearTimeout(this.schedulerTimer);
                this.schedulerTimer = null;
            }
            this.runScheduler();
        }

        const currentPhaseMs = this.computeCurrentPhaseMs();
        this.emitTempoChange({ phaseMs: currentPhaseMs });
        // Transport-based bridge/cleanup on cycle change (legato off only)
        this.armTransportBridge();
    }

    /**
     * Adjust tempo multiplier in real time while maintaining phase (optional phase override).
     */
    setTempoMultiplier(newTempo, { phaseMs = null } = {}) {
        const tempo = Math.max(0.0001, Number(newTempo) || 1);
        const tps = Math.max(1, this.ticksPerSecond);
        const prevCycleTicks = this.cycleTicks || Math.max(1, Math.round(this.cycleDuration * tps));

        const prevTempoValue = this.tempo || 1;
        const prevSecondsPerTick = this.secondsPerTick || (1 / (tps * prevTempoValue));

        let targetPhaseTick = 0;
        if (phaseMs != null && Number.isFinite(phaseMs) && this.cycleDuration > 0) {
            const phaseRatio = Math.max(0, phaseMs) / (this.cycleDuration * 1000);
            targetPhaseTick = Math.floor(phaseRatio * prevCycleTicks) % prevCycleTicks;
        } else if (this.isPlaying && this.audioContext) {
            const now = this.audioContext.currentTime;
            const currentAbsTick = this.timeToAbsTick(now);
            targetPhaseTick = ((currentAbsTick % prevCycleTicks) + prevCycleTicks) % prevCycleTicks;
        }

        this.tempo = tempo;
        this.secondsPerTick = 1 / (tps * tempo);

        if (this.isPlaying && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.transportStartTick = targetPhaseTick;
            this.lastScheduledTickAbs = targetPhaseTick;
            this.transportStartTime = now;
            if (this.schedulerTimer) {
                clearTimeout(this.schedulerTimer);
                this.schedulerTimer = null;
            }
            this.runScheduler();
        }

        const currentPhaseMs = this.computeCurrentPhaseMs();
        this.emitTempoChange({ phaseMs: currentPhaseMs });

        const newSecondsPerTick = this.secondsPerTick;

        console.log('[ToneRowPlayback] Tempo change', {
            prevTempo: prevTempoValue,
            newTempo: tempo,
            prevSecondsPerTick,
            newSecondsPerTick,
            legatoEnabled: this.legatoEnabled
        });

        // Transport-based bridge/cleanup (legato off only)
        this.armTransportBridge();
    }

    /**
     * Current phase within the cycle in milliseconds.
     */
    computeCurrentPhaseMs() {
        if (!this.audioContext) return 0;
        const now = this.audioContext.currentTime;
        const absTick = this.timeToAbsTick(now);
        const phaseTick = ((absTick % this.cycleTicks) + this.cycleTicks) % this.cycleTicks;
        return phaseTick * this.secondsPerTick * 1000;
    }

    /**
     * Notify listeners (e.g., visuals) of tempo/cycle changes.
     */
    emitTempoChange({ phaseMs = 0 } = {}) {
        window.dispatchEvent(new CustomEvent('playbackTempoChanged', {
            detail: {
                cycleDurationMs: this.cycleDuration * 1000,
                tempo: this.tempo,
                phaseMs
            }
        }));
    }

    /**
     * Arm bridge/cleanup based on transport: choose the nearest upcoming event across all layers (legato off).
     */
    armTransportBridge() {
        // Require: audio context, playing, legato off, and full scale selection (no deselected notes)
        const fullSelection = (this.selectedNotes.size === 0) ||
            (this.availableRatios && this.selectedNotes.size === this.availableRatios.length);

        if (!this.audioContext || !this.isPlaying || this.legatoEnabled || !fullSelection) {
            this.pendingBridgeHold = false;
            this.pendingTempoCleanup = false;
            this.pendingBridgeReleaseTicks = [null, null, null, null];
            if (this.legatoEnabled) {
                console.log('[ToneRowPlayback] Bridge not armed (legato on)');
            } else if (!this.isPlaying) {
                console.log('[ToneRowPlayback] Bridge not armed (not playing)');
            } else if (!fullSelection) {
                console.log('[ToneRowPlayback] Bridge not armed (scale has deselections)');
            } else {
                console.log('[ToneRowPlayback] Bridge not armed (no audio context)');
            }
            return;
        }

        const now = this.audioContext.currentTime;
        const currentAbsTick = this.timeToAbsTick(now);
        const cycleTicks = this.cycleTicks || 1;

        // Pick the most recently played layer (last note tick)
        let latest = { tick: -Infinity, layerIndex: null, layerKey: null };
        ['a', 'b', 'c', 'd'].forEach((layerKey, layerIndex) => {
            const lastTick = this.lastNoteTickAbs[layerIndex];
            if (Number.isFinite(lastTick) && lastTick > latest.tick) {
                latest = { tick: lastTick, layerIndex, layerKey };
            }
        });

        if (latest.layerIndex == null) {
            this.pendingBridgeHold = false;
            this.pendingTempoCleanup = false;
            this.pendingBridgeReleaseTicks = [null, null, null, null];
            console.log('[ToneRowPlayback] Bridge not armed: no recent notes found');
            return;
        }

        // Compute next event tick for the chosen layer
        const events = this.layerEvents[latest.layerIndex] || [];
        let nextAbsTick = null;
        const ticksPerNote = this.lastNotePulseTicks[latest.layerIndex] || (this.cycleTicks / Math.max(1, this.currentRhythms[latest.layerIndex] || 1));
        const phaseCurrent = ((currentAbsTick % cycleTicks) + cycleTicks) % cycleTicks;
        const phaseLast = ((latest.tick % cycleTicks) + cycleTicks) % cycleTicks;
        if (events.length) {
            const phaseTick = ((currentAbsTick % cycleTicks) + cycleTicks) % cycleTicks;
            let nextStartTickInCycle = null;
            for (const evt of events) {
                if (evt.startTick >= phaseTick) {
                    nextStartTickInCycle = evt.startTick;
                    break;
                }
            }
            if (nextStartTickInCycle == null) {
                nextStartTickInCycle = events[0].startTick + cycleTicks;
            }
            const base = currentAbsTick - phaseTick;
            nextAbsTick = base + nextStartTickInCycle;
        }

        // Arm only the last-played layer
        this.pendingBridgeHold = true;
        this.pendingTempoCleanup = true; // ensure cleanup runs before next note (legato off)
        this.pendingBridgeReleaseTicks = [null, null, null, null];
        this.pendingBridgeReleaseTicks[latest.layerIndex] = nextAbsTick;

        if (!this.bridgeVoices[latest.layerIndex]) {
            const voice = this.activeLayerVoices[latest.layerIndex];
            const noteData = voice?.noteData || this.lastNoteByLayer[latest.layerIndex];
            if (noteData) {
                this.startBridgeVoice(latest.layerIndex, noteData, this.layerStates[latest.layerKey]);
                console.log(`[ToneRowPlayback] Bridge voice armed for layer ${latest.layerKey} release at abs tick ${nextAbsTick}`);
            } else {
                console.log(`[ToneRowPlayback] Bridge skipped: no last note for layer ${latest.layerKey}`);
            }
        } else {
            console.log(`[ToneRowPlayback] Bridge voice already active for layer ${latest.layerKey}`);
        }
    }

    /**
     * Schedule all layer events whose startTick falls within [startAbs, endAbs).
     */
    scheduleWindow(startAbs, endAbs) {
        const cycle = this.cycleTicks;
        ['a', 'b', 'c', 'd'].forEach((layer, layerIndex) => {
            const events = this.layerEvents[layerIndex] || [];
            if (!events.length) return;

            events.forEach((evt) => {
                const base = evt.startTick;
                // Find first occurrence >= startAbs
                const firstCycle = Math.ceil((startAbs - base) / cycle);
                let occTick = base + Math.max(0, firstCycle) * cycle;
                while (occTick < endAbs) {
                    const startTime = this.absTickToTime(occTick);
                    const durationSec = evt.durationTicks * this.secondsPerTick;
                    this.playNoteAtTime(evt.noteData, durationSec, layerIndex, this.layerStates[layer], startTime, occTick);
                    occTick += cycle;
                }
            });
        });
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
        const oscillators = [...this.activeOscillators];
        this.activeOscillators = [];
        oscillators.forEach((osc) => {
            try {
                const ctx = this.audioContext;
                const now = ctx ? ctx.currentTime : 0;
                const tail = 0.02; // 20ms fade to avoid clicks
                osc.onended = null;
                if (osc.frequency && osc.frequency.cancelScheduledValues) {
                    osc.frequency.cancelScheduledValues(now);
                }
                const gainNode = osc.__cleanupGain;
                if (gainNode && gainNode.gain?.setValueAtTime) {
                    const current = gainNode.gain.value;
                    gainNode.gain.setValueAtTime(current, now);
                    gainNode.gain.linearRampToValueAtTime(0, now + tail);
                    osc.stop(now + tail + 0.01);
                } else {
                    osc.stop(now + tail);
                }
            } catch (err) {
                // Already stopped
            }
        });
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

        this.bridgeVoices[layerIndex] = { osc, gain };
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
        return Math.pow(10, db / 20);
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

    generatePlaybackFamiliesPage(families, containerId = 'consonance-families-container') {
        const sortedFamilies = this.getSortedPlaybackFamilies(families);
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

        html += '<div class="consonance-families-list">';

        pageFamily.forEach((family, pageIndex) => {
            const globalIndex = startIdx + pageIndex;
            html += `
                <button class="consonance-family-btn" data-family-index="${globalIndex}">
                    Family ${globalIndex + 1} (${family.size} notes, ${family.avgDeviation.toFixed(1)}¢)
                </button>
            `;
        });

        html += '</div>';

        if (totalPages > 1) {
            html += `
                <div class="pagination-controls">
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(0)"
                            ${this.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>&laquo;</button>
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${this.familyDisplayState.currentPage - 1})"
                            ${this.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>&lsaquo;</button>

                    <span class="page-info">Page ${this.familyDisplayState.currentPage + 1} of ${totalPages}</span>

                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${this.familyDisplayState.currentPage + 1})"
                            ${this.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>&rsaquo;</button>
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${totalPages - 1})"
                            ${this.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>&raquo;</button>
                </div>
            `;
        }

        // Add event listeners to the buttons
        setTimeout(() => {
            const container = document.getElementById(containerId);
            if (container) {
                container.querySelectorAll('.consonance-family-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const familyIndex = parseInt(btn.getAttribute('data-family-index'));
                        this.selectConsonanceFamily(familyIndex);
                    });
                });
                this.updateFamilyHighlight(containerId);
            }
        }, 0);

        return html;
    }

    changeFamilySort() {
        const sortBy = document.getElementById('playback-family-sort-by')?.value || 'size';
        const sortOrder = document.getElementById('playback-family-sort-order')?.value || 'desc';
        
        this.familyDisplayState.sortBy = sortBy;
        this.familyDisplayState.sortOrder = sortOrder;
        this.familyDisplayState.currentPage = 0; // Reset to first page when sorting changes
        
        this.refreshPlaybackFamiliesDisplay();
    }

    goToFamilyPage(pageNum) {
        if (!window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) return;
        
        const families = window.lrcInterconsonance.currentAnalysis.families;
        const totalPages = Math.ceil(families.length / this.familyDisplayState.itemsPerPage);
        
        if (pageNum >= 0 && pageNum < totalPages) {
            this.familyDisplayState.currentPage = pageNum;
            this.refreshPlaybackFamiliesDisplay();
        }
    }

    refreshPlaybackFamiliesDisplay() {
        if (!window.lrcInterconsonance || !window.lrcInterconsonance.currentAnalysis) return;

        const families = window.lrcInterconsonance.currentAnalysis.families;
        const container = document.getElementById('consonance-families-container');
        if (container) {
            container.innerHTML = this.generatePlaybackFamiliesPage(families);
            this.updateFamilyHighlight();
        }

        const partitionsContainer = document.getElementById('partitions-families-container');
        if (partitionsContainer) {
            partitionsContainer.innerHTML = this.generatePlaybackFamiliesPage(families, 'partitions-families-container');
            this.updateFamilyHighlight('partitions-families-container');
        }
    }

    updateSortControls() {
        const sortBySelect = document.getElementById('playback-family-sort-by');
        const sortOrderSelect = document.getElementById('playback-family-sort-order');
        
        if (sortBySelect) sortBySelect.value = this.familyDisplayState.sortBy;
        if (sortOrderSelect) sortOrderSelect.value = this.familyDisplayState.sortOrder;
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
            let newValue = parseFloat(input.value);
            if (this.config.unit === 'ms') {
                newValue = newValue / 1000; // Convert ms to seconds
            }
            this.setValue(newValue);
            input.remove();
        };
        
        input.addEventListener('blur', handleInput);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleInput();
            } else if (e.key === 'Escape') {
                input.remove();
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
