// LayerControlsUI.js - Renders and binds playback layer controls

class LayerControlsUI {
    constructor(playback, options = {}) {
        this.playback = playback;
        this.containerId = options.containerId || 'layer-controls-container';
    }

    setContainer(containerId) {
        if (containerId) {
            this.containerId = containerId;
        }
    }

    showLayerControls(layer, containerId = this.containerId) {
        this.playback.currentLayer = layer;

        document.querySelectorAll('.playback-layer-btn').forEach(toggle => {
            toggle.classList.toggle('active', toggle.dataset.layer === layer);
        });

        this.renderLayerControls(layer, containerId);
        this.bindLayerControlListeners(layer);
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
                this.playback.toggleLegatoMode();
            });
            this.playback.updateLegatoButton();
        }
        
        this.showLayerControls('a');
    }

    renderLayerControls(layer, containerId = this.containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const state = this.playback.layerStates[layer];
        const layerName = layer.toUpperCase();
        const layerColors = {
            a: '#ff6b6b', b: '#4ecdc4', c: '#00a638ff', d: '#f9ca24'
        };
        const { min: filterMin, max: filterMax } = this.playback.filterLimits;

        container.innerHTML = `
            <div class="layer-control-header">
                <h4 style="color: ${layerColors[layer]}">Layer ${layerName} Controls</h4>
                <div class="layer-control-buttons">
                    <button id="solo-${layer}" class="control-btn ${this.playback.soloLayer === layer ? 'active' : ''}">
                        Solo
                    </button>
                    <button id="mute-${layer}" class="control-btn ${this.playback.mutedLayers.has(layer) ? 'active' : ''}">
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
                    <input type="range" id="volume-${layer}" min="-40" max="0" step="1" value="${state.volume}">
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

        this.createADSRKnobs(layer, state);
    }

    createADSRKnobs(layer, state) {
        const adsrContainer = document.getElementById(`adsr-${layer}`);
        if (!adsrContainer) return;

        adsrContainer.innerHTML = '';

        const knobConfigs = {
            attack: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 },
            decay: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 },
            sustain: { min: 0.001, max: 1, step: 0.01, unit: '', precision: 2 },
            release: { min: 0.001, max: 5, step: 0.001, unit: 'ms', precision: 0 }
        };

        Object.entries(knobConfigs).forEach(([param, config]) => {
            const knob = new ADSRKnob(adsrContainer, param, state.adsr[param], config);
            knob.onChange = (value) => {
                state.adsr[param] = value;
                console.log(`Layer ${layer.toUpperCase()} ${param}: ${value}`);
            };
        });
    }

    bindLayerControlListeners(layer) {
        const state = this.playback.layerStates[layer];

        const soloBtn = document.getElementById(`solo-${layer}`);
        if (soloBtn) {
            soloBtn.addEventListener('click', () => {
                this.playback.toggleSolo(layer);
            });
        }

        const muteBtn = document.getElementById(`mute-${layer}`);
        if (muteBtn) {
            muteBtn.addEventListener('click', () => {
                this.playback.toggleMute(layer);
            });
        }

        const waveformSelect = document.getElementById(`waveform-${layer}`);
        if (waveformSelect) {
            waveformSelect.addEventListener('change', (e) => {
                state.waveform = e.target.value;
            });
        }

        const volumeSlider = document.getElementById(`volume-${layer}`);
        const volumeValue = document.getElementById(`volume-value-${layer}`);
        if (volumeSlider && volumeValue) {
            volumeSlider.addEventListener('input', (e) => {
                const dbValue = parseFloat(e.target.value);
                state.volume = dbValue;
                volumeValue.textContent = `${dbValue} dB`;
                this.playback.updateLayerVolume(layer, dbValue);
            });
        }

        const layerHipassInput = document.getElementById(`layer-hipass-${layer}`);
        if (layerHipassInput) {
            layerHipassInput.addEventListener('input', (e) => {
                this.playback.setLayerHighpass(layer, parseFloat(e.target.value), { syncInput: false });
            });

            const snapLayerHipass = () => {
                this.playback.setLayerHighpass(layer, parseFloat(layerHipassInput.value));
            };

            layerHipassInput.addEventListener('blur', snapLayerHipass);
            layerHipassInput.addEventListener('change', snapLayerHipass);
            layerHipassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapLayerHipass();
                }
            });
        }

        const layerLopassInput = document.getElementById(`layer-lopass-${layer}`);
        if (layerLopassInput) {
            layerLopassInput.addEventListener('input', (e) => {
                this.playback.setLayerLowpass(layer, parseFloat(e.target.value), { syncInput: false });
            });

            const snapLayerLopass = () => {
                this.playback.setLayerLowpass(layer, parseFloat(layerLopassInput.value));
            };

            layerLopassInput.addEventListener('blur', snapLayerLopass);
            layerLopassInput.addEventListener('change', snapLayerLopass);
            layerLopassInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    snapLayerLopass();
                }
            });
        }

        this.playback.setLayerHighpass(layer, state.filters.highpass);
        this.playback.setLayerLowpass(layer, state.filters.lowpass);
    }
}

window.LayerControlsUI = LayerControlsUI;
