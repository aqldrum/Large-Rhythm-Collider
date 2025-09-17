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
        this.fundamentalFreq = 110;
        this.maxFrequencyMultiplier = 32; // 32x fundamental = max frequency
        this.masterVolumeDb = -24;
        this.lastUpdateTime = 0;
        
        // Data
        this.spacesPlot = [];
        this.spacesPlotByLayer = [[], [], [], []];
        this.currentRhythms = [1, 1, 1, 1];
        this.toneRowData = [];
        this.toneRowDataByLayer = [];
        
        // Audio routing
        this.layerNodes = [];
        this.activeOscillators = [];
        this.scheduledEvents = [];
        
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
        
        // Family display pagination and sorting state
        this.familyDisplayState = {
            currentPage: 0,
            itemsPerPage: 10,
            sortBy: 'size', // 'avgDeviation' or 'size'
            sortOrder: 'desc' // 'asc' or 'desc'
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
            this.masterGain.gain.value = this.dbToLinear(-24); // Default -24dB
            
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
                this.updateTempo(parseFloat(e.target.value));
            });
        }

        // Fundamental frequency
        const freqInput = document.getElementById('fundamental-freq');
        if (freqInput) {
            freqInput.addEventListener('input', (e) => {
                this.updateFundamentalFreq(parseFloat(e.target.value));
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
                const freq = parseFloat(e.target.value);
                if (freq >= 20 && freq <= 20000) {
                    this.globalFilterSettings.highpass = freq;
                    this.updateGlobalHighpassFilter(freq);
                }
            });
        }

        // Global Low-Pass Filter
        const globalLopassInput = document.getElementById('global-lopass-freq');
        if (globalLopassInput) {
            globalLopassInput.addEventListener('input', (e) => {
                const freq = parseFloat(e.target.value);
                if (freq >= 20 && freq <= 20000) {
                    this.globalFilterSettings.lowpass = freq;
                    this.updateGlobalLowpassFilter(freq);
                }
            });
        }

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
                    <input type="number" id="layer-hipass-${layer}" min="20" max="20000" value="${state.filters.highpass}">
                </div>
                <div class="control-group">
                    <label for="layer-lopass-${layer}">Lo-Pass (Hz):</label>
                    <input type="number" id="layer-lopass-${layer}" min="20" max="20000" value="${state.filters.lowpass}">
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
                            <input type="number" id="cycle-duration" min="0.1" max="6000" step="0.1" value="${this.cycleDuration}">
                        </div>
                        
                        <div class="control-group">
                            <label>Fundamental (Hz):</label>
                            <input type="number" id="fundamental-freq" min="20" max="2000" value="${this.fundamentalFreq}">
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
                            <input type="number" id="global-hipass-freq" min="20" max="20000" value="${this.globalFilterSettings.highpass}">
                        </div>
                        <div class="control-group">
                            <label>Lo-Pass (Hz):</label>
                            <input type="number" id="global-lopass-freq" min="20" max="20000" value="${this.globalFilterSettings.lowpass}">
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
                        <button id="select-all-notes" class="control-btn">Select All</button>
                        <button id="select-none-notes" class="control-btn">None</button>
                        <span id="selected-notes-count">0 of 0 notes selected</span>
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
                const freq = parseFloat(e.target.value);
                if (freq >= 20 && freq <= 20000) {
                    state.filters.highpass = freq;
                    this.updateLayerHighpassFilter(layer, freq);
                }
            });
        }

        // Layer Low-Pass Filter
        const layerLopassInput = document.getElementById(`layer-lopass-${layer}`);
        if (layerLopassInput) {
            layerLopassInput.addEventListener('input', (e) => {
                const freq = parseFloat(e.target.value);
                if (freq >= 20 && freq <= 20000) {
                    state.filters.lowpass = freq;
                    this.updateLayerLowpassFilter(layer, freq);
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

    updateTempo(newTempo) {
        this.cycleDuration = Math.max(0.1, Math.min(6000, newTempo));
        console.log(`⏰ Tempo updated: ${this.cycleDuration}s cycle duration`);
        
        if (this.isPlaying) {
            this.stopPlayback();
            setTimeout(() => this.startPlayback(), 100);
        }
        
        // Notify visuals
        if (window.lrcVisuals) {
            window.lrcVisuals.setCycleDuration(this.cycleDuration);
        }
    }

    updateFundamentalFreq(newFreq) {
        this.fundamentalFreq = Math.max(55, Math.min(880, newFreq));
        const maxFreq = this.fundamentalFreq * this.maxFrequencyMultiplier;
        console.log(`🎼 Fundamental frequency updated: ${this.fundamentalFreq}Hz (max: ${maxFreq.toFixed(0)}Hz)`);
        
        if (this.spacesPlot.length > 0) {
            this.generateToneRowData();
        }
        
        if (this.isPlaying) {
            this.stopPlayback();
            setTimeout(() => this.startPlayback(), 100);
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
        // Select All button
        const selectAllBtn = document.getElementById('select-all-notes');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                this.selectAllNotes();
            });
        }

        // Select None button  
        const selectNoneBtn = document.getElementById('select-none-notes');
        if (selectNoneBtn) {
            selectNoneBtn.addEventListener('click', () => {
                this.selectNoNotes();
            });
        }

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
        
        console.log(`✅ Selected all ${this.selectedNotes.size} notes`);
    }

    selectNoNotes() {
        this.selectedNotes.clear();
        
        this.updateScaleDisplay();
        this.updateLinearPlotVisibility();
        this.updateSelectedNotesCount();
        this.generateToneRowData(); // Regenerate audio data with new selection
        
        console.log('✅ Deselected all notes');
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
        
        console.log(`🎵 Toggled note ${ratioFraction} (${this.selectedNotes.has(ratioFraction) ? 'selected' : 'deselected'})`);
    }

    updateSelectedNotesCount() {
        const countElement = document.getElementById('selected-notes-count');
        if (countElement) {
            countElement.textContent = `${this.selectedNotes.size} of ${this.availableRatios.length} notes selected`;
        }
    }

    applyRealtimeNoteChanges() {
        // No action needed - the scheduled note callbacks check current selection state dynamically
        console.log('🔄 Real-time note selection changes are active - scheduled notes will check current state');
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

    updateScaleDisplay() {
        const container = document.getElementById('scale-chart-container');
        if (!container || !this.availableRatios.length) {
            if (container) {
                container.innerHTML = '<p>No scale data available. Generate a rhythm first.</p>';
            }
            return;
        }

        // Preserve scroll position
        const scrollableElement = container.querySelector('.scale-chart-scroll');
        const currentScrollTop = scrollableElement ? scrollableElement.scrollTop : 0;

        // Create scrollable scale chart
        let html = `
            <div class="scale-chart-scroll ${this.availableRatios.length > 15 ? 'scrollable' : ''}">
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
        
        // Reset family display state for new rhythm
        this.familyDisplayState = {
            currentPage: 0,
            itemsPerPage: 10,
            sortBy: 'size',
            sortOrder: 'desc'
        };
        
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

    updateInterconsonanceFamilies() {
        const container = document.getElementById('consonance-families-container');
        const controls = document.getElementById('families-controls-playback');
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
                container.innerHTML = this.generatePlaybackFamiliesPage(families);
                
                // Update sort control selections
                this.updateSortControls();
                
                console.log(`🎵 Updated consonance families display with ${families.length} families`);
            } else {
                if (controls) controls.style.display = 'none';
                container.innerHTML = '<p>No consonance families detected for this scale.</p>';
            }
        } else {
            if (controls) controls.style.display = 'none';
            container.innerHTML = '<p>Run Interconsonance analysis first to see consonance families.</p>';
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
        
        console.log(`🎭 Selected consonance family ${familyIndex + 1} with ${family.ratios.length} ratios:`, family.ratios);
    }

    generateToneRowData() {
        if (!this.spacesPlot.length) return;
        
        const maxFrequency = this.fundamentalFreq * this.maxFrequencyMultiplier;
        
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

    async startPlayback() {
        try {
            await this.initAudioContext();
            
            if (this.spacesPlotByLayer.every(layer => layer.length === 0)) {
                alert('No rhythm data available. Please generate a rhythm first.');
                return;
            }
            
            console.log('Starting playback...');
            
            this.isPlaying = true;
            this.updatePlayButton();
            
            // Schedule all layers
            this.scheduleAllLayers();
            
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
        
        // Stop all oscillators
        this.activeOscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {
                // Oscillator may already be stopped
            }
        });
        this.activeOscillators = [];
        
        // Clear scheduled events
        this.scheduledEvents.forEach(id => clearTimeout(id));
        this.scheduledEvents = [];
        
        // Notify other modules
        window.dispatchEvent(new CustomEvent('playbackStopped'));
    }

    scheduleAllLayers() {
        ['a', 'b', 'c', 'd'].forEach((layer, layerIndex) => {
            const rhythmValue = this.currentRhythms[layerIndex];
            const layerData = this.toneRowDataByLayer[layerIndex];
            
            if (rhythmValue <= 1 || !layerData || layerData.length === 0) {
                return; // Skip inactive layers
            }
            
            this.scheduleLayer(layer, layerIndex, layerData, rhythmValue);
        });
    }

    scheduleLayer(layer, layerIndex, layerData, rhythmValue) {
        const noteDuration = this.cycleDuration / rhythmValue;
        const state = this.layerStates[layer];
        const cycleDurationMs = this.cycleDuration * 1000;
        
        // Schedule initial notes with precise timing to avoid accumulation errors
        layerData.forEach((noteData, noteIndex) => {
            // Calculate precise start time as fraction of total cycle
            const startTime = Math.round((noteIndex / rhythmValue) * cycleDurationMs);
            
            const timeoutId = setTimeout(() => {
                if (this.isPlaying) {
                    // Check current mute state dynamically (not captured at timeout creation time)
                    const currentlyMuted = noteData.isMutedByFrequency || this.isNoteMutedBySelection(noteData.globalSpacesIndex);
                    
                    // Only play the note if it's not muted (preserve timing for all notes)
                    if (!currentlyMuted) {
                        this.playNote(noteData.frequency, noteDuration, layerIndex, state);
                    } else {
                     //   console.log(`🔇 Muted note: ${noteData.frequency.toFixed(1)}Hz (${noteData.ratio.toFixed(2)}) in layer ${layer.toUpperCase()}`);
                    }
                    // Note: Muted notes still occupy their time slot, maintaining sequence integrity
                }
            }, startTime);
            
            this.scheduledEvents.push(timeoutId);
        });
        
        // Schedule looping with precise cycle duration
        const loopTimeoutId = setTimeout(() => {
            if (this.isPlaying) {
                this.scheduleLayer(layer, layerIndex, layerData, rhythmValue);
            }
        }, cycleDurationMs);
        
        this.scheduledEvents.push(loopTimeoutId);
    }

    playNote(frequency, duration, layerIndex, layerState) {
        if (!this.audioContext || !this.layerNodes[layerIndex]) return;
        
        // Frequency limit check
        const maxFrequency = this.fundamentalFreq * this.maxFrequencyMultiplier;
        if (frequency > maxFrequency) {
            console.warn(`🚫 Frequency ${frequency.toFixed(2)}Hz exceeds limit ${maxFrequency.toFixed(2)}Hz`);
            return;
        }

        const now = this.audioContext.currentTime;
        
        // Create oscillator
        const oscillator = this.audioContext.createOscillator();
        oscillator.type = layerState.waveform;
        oscillator.frequency.setValueAtTime(frequency, now);
        
        // Create envelope
        const envelope = this.audioContext.createGain();
        envelope.gain.setValueAtTime(0, now);
        
        // Connect: oscillator -> envelope -> layer gain
        oscillator.connect(envelope);
        envelope.connect(this.layerNodes[layerIndex].gain);
        
        // Apply ADSR envelope
        const { attack, decay, sustain, release } = layerState.adsr;
        const sustainTime = Math.max(0, duration - attack - decay - release);
        
        // Attack
        envelope.gain.linearRampToValueAtTime(1, now + attack);
        
        // Decay
        envelope.gain.linearRampToValueAtTime(sustain, now + attack + decay);
        
        // Sustain (hold)
        envelope.gain.setValueAtTime(sustain, now + attack + decay + sustainTime);
        
        // Release
        envelope.gain.linearRampToValueAtTime(0, now + duration);
        
        // Start and schedule stop
        oscillator.start(now);
        oscillator.stop(now + duration);
        
        this.activeOscillators.push(oscillator);
        
        // Clean up when done
        oscillator.onended = () => {
            const index = this.activeOscillators.indexOf(oscillator);
            if (index > -1) {
                this.activeOscillators.splice(index, 1);
            }
        };
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
    }

    // ====================================
    // UTILITY FUNCTIONS
    // ====================================

    dbToLinear(db) {
        return Math.pow(10, db / 20);
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

    generatePlaybackFamiliesPage(families) {
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
                            ${this.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>First</button>
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${this.familyDisplayState.currentPage - 1})" 
                            ${this.familyDisplayState.currentPage === 0 ? 'disabled' : ''}>Previous</button>
                    
                    <span class="page-info">Page ${this.familyDisplayState.currentPage + 1} of ${totalPages}</span>
                    
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${this.familyDisplayState.currentPage + 1})" 
                            ${this.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
                    <button class="page-btn" onclick="window.toneRowPlayback.goToFamilyPage(${totalPages - 1})" 
                            ${this.familyDisplayState.currentPage >= totalPages - 1 ? 'disabled' : ''}>Last</button>
                </div>
            `;
        }
        
        // Add event listeners to the buttons
        setTimeout(() => {
            const container = document.getElementById('consonance-families-container');
            if (container) {
                container.querySelectorAll('.consonance-family-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const familyIndex = parseInt(btn.getAttribute('data-family-index'));
                        this.selectConsonanceFamily(familyIndex);
                    });
                });
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
        
        const container = document.getElementById('consonance-families-container');
        if (container) {
            container.innerHTML = this.generatePlaybackFamiliesPage(window.lrcInterconsonance.currentAnalysis.families);
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