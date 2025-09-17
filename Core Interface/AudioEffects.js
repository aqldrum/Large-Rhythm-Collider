// AudioEffects.js - Audio Effects Module for LRC
// Handles filters and effects for both master and individual layers

class AudioEffects {
    constructor() {
        // Effect nodes
        this.masterEffects = {
            filter: null,
            enabled: false
        };
        
        this.layerEffects = {
            a: { filter: null, enabled: false },
            b: { filter: null, enabled: false },
            c: { filter: null, enabled: false },
            d: { filter: null, enabled: false }
        };
        
        // Default settings
        this.defaultFilterSettings = {
            type: 'lowpass',
            frequency: 1000,
            Q: 1,
            gain: 0
        };
        
        console.log('Audio Effects module initialized');
    }

    // ====================================
    // INITIALIZATION AND SETUP
    // ====================================

    initializeEffects(audioContext, masterGain, layerNodes) {
        this.audioContext = audioContext;
        this.masterGain = masterGain;
        this.layerNodes = layerNodes;
        
        // Create master effects
        this.createMasterFilter();
        
        // Create layer effects
        this.createLayerFilters();
        
        console.log('Audio effects initialized with audio context');
    }

    createMasterFilter() {
        if (!this.audioContext) return;
        
        this.masterEffects.filter = this.audioContext.createBiquadFilter();
        this.masterEffects.filter.type = this.defaultFilterSettings.type;
        this.masterEffects.filter.frequency.value = this.defaultFilterSettings.frequency;
        this.masterEffects.filter.Q.value = this.defaultFilterSettings.Q;
        
        // Initially bypassed - connect master gain directly to destination
        this.updateMasterEffectChain();
    }

    createLayerFilters() {
        if (!this.audioContext || !this.layerNodes) return;
        
        ['a', 'b', 'c', 'd'].forEach((layer, index) => {
            if (this.layerNodes[index]) {
                const filter = this.audioContext.createBiquadFilter();
                filter.type = this.defaultFilterSettings.type;
                filter.frequency.value = this.defaultFilterSettings.frequency;
                filter.Q.value = this.defaultFilterSettings.Q;
                
                this.layerEffects[layer].filter = filter;
                
                // Initially bypassed
                this.updateLayerEffectChain(layer, index);
            }
        });
    }

    // ====================================
    // EFFECT CHAIN MANAGEMENT
    // ====================================

    updateMasterEffectChain() {
        if (!this.audioContext || !this.masterGain) return;
        
        // Disconnect all current connections
        this.masterGain.disconnect();
        
        if (this.masterEffects.enabled && this.masterEffects.filter) {
            // Route through filter
            this.masterGain.connect(this.masterEffects.filter);
            
            // Connect to final destination (limiter or audioContext destination)
            if (window.toneRowPlayback && window.toneRowPlayback.limiter) {
                this.masterEffects.filter.connect(window.toneRowPlayback.limiter);
            } else {
                this.masterEffects.filter.connect(this.audioContext.destination);
            }
        } else {
            // Bypass filter
            if (window.toneRowPlayback && window.toneRowPlayback.limiter) {
                this.masterGain.connect(window.toneRowPlayback.limiter);
            } else {
                this.masterGain.connect(this.audioContext.destination);
            }
        }
    }

    updateLayerEffectChain(layer, layerIndex) {
        if (!this.audioContext || !this.layerNodes || !this.layerNodes[layerIndex]) return;
        
        const layerGain = this.layerNodes[layerIndex].gain;
        const layerEffect = this.layerEffects[layer];
        
        // Disconnect current connections
        layerGain.disconnect();
        
        if (layerEffect.enabled && layerEffect.filter) {
            // Route through filter
            layerGain.connect(layerEffect.filter);
            layerEffect.filter.connect(this.masterGain);
        } else {
            // Bypass filter
            layerGain.connect(this.masterGain);
        }
    }

    // ====================================
    // MASTER EFFECTS CONTROL
    // ====================================

    setMasterFilterEnabled(enabled) {
        this.masterEffects.enabled = enabled;
        this.updateMasterEffectChain();
        console.log(`Master filter ${enabled ? 'enabled' : 'disabled'}`);
    }

    setMasterFilterType(type) {
        if (this.masterEffects.filter) {
            this.masterEffects.filter.type = type;
            console.log(`Master filter type: ${type}`);
        }
    }

    setMasterFilterFrequency(frequency) {
        if (this.masterEffects.filter) {
            const clampedFreq = Math.max(20, Math.min(20000, frequency));
            
            if (this.audioContext) {
                this.masterEffects.filter.frequency.setTargetAtTime(
                    clampedFreq,
                    this.audioContext.currentTime,
                    0.05
                );
            } else {
                this.masterEffects.filter.frequency.value = clampedFreq;
            }
            
            console.log(`Master filter frequency: ${clampedFreq} Hz`);
        }
    }

    setMasterFilterResonance(Q) {
        if (this.masterEffects.filter) {
            const clampedQ = Math.max(0.1, Math.min(30, Q));
            
            if (this.audioContext) {
                this.masterEffects.filter.Q.setTargetAtTime(
                    clampedQ,
                    this.audioContext.currentTime,
                    0.05
                );
            } else {
                this.masterEffects.filter.Q.value = clampedQ;
            }
            
            console.log(`Master filter resonance: ${clampedQ}`);
        }
    }

    // ====================================
    // LAYER EFFECTS CONTROL
    // ====================================

    setLayerFilterEnabled(layer, enabled) {
        if (this.layerEffects[layer]) {
            this.layerEffects[layer].enabled = enabled;
            const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
            this.updateLayerEffectChain(layer, layerIndex);
            console.log(`Layer ${layer.toUpperCase()} filter ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    setLayerFilterType(layer, type) {
        if (this.layerEffects[layer] && this.layerEffects[layer].filter) {
            this.layerEffects[layer].filter.type = type;
            console.log(`Layer ${layer.toUpperCase()} filter type: ${type}`);
        }
    }

    setLayerFilterFrequency(layer, frequency) {
        if (this.layerEffects[layer] && this.layerEffects[layer].filter) {
            const clampedFreq = Math.max(20, Math.min(20000, frequency));
            
            if (this.audioContext) {
                this.layerEffects[layer].filter.frequency.setTargetAtTime(
                    clampedFreq,
                    this.audioContext.currentTime,
                    0.05
                );
            } else {
                this.layerEffects[layer].filter.frequency.value = clampedFreq;
            }
            
            console.log(`Layer ${layer.toUpperCase()} filter frequency: ${clampedFreq} Hz`);
        }
    }

    setLayerFilterResonance(layer, Q) {
        if (this.layerEffects[layer] && this.layerEffects[layer].filter) {
            const clampedQ = Math.max(0.1, Math.min(30, Q));
            
            if (this.audioContext) {
                this.layerEffects[layer].filter.Q.setTargetAtTime(
                    clampedQ,
                    this.audioContext.currentTime,
                    0.05
                );
            } else {
                this.layerEffects[layer].filter.Q.value = clampedQ;
            }
            
            console.log(`Layer ${layer.toUpperCase()} filter resonance: ${clampedQ}`);
        }
    }

    // ====================================
    // UI GENERATION AND CONTROL
    // ====================================

    generateMasterEffectsUI() {
        return `
            <div class="effects-section">
                <h5>Master Effects</h5>
                <div class="effect-controls">
                    <div class="effect-toggle">
                        <label>
                            <input type="checkbox" id="master-filter-enabled"> 
                            Filter
                        </label>
                    </div>
                    <div class="filter-controls" id="master-filter-controls" style="display: none;">
                        <div class="control-group">
                            <label for="master-filter-type">Type</label>
                            <select id="master-filter-type">
                                <option value="lowpass">Low Pass</option>
                                <option value="highpass">High Pass</option>
                                <option value="bandpass">Band Pass</option>
                                <option value="notch">Notch</option>
                            </select>
                        </div>
                        <div class="control-group">
                            <label for="master-filter-frequency">Frequency (Hz)</label>
                            <input type="number" id="master-filter-frequency" min="20" max="20000" value="1000" step="1">
                        </div>
                        <div class="control-group">
                            <label for="master-filter-resonance">Resonance</label>
                            <input type="range" id="master-filter-resonance" min="0.1" max="30" value="1" step="0.1">
                            <span id="master-filter-resonance-value">1.0</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    generateLayerEffectsUI(layer) {
        const layerUpper = layer.toUpperCase();
        
        return `
            <div class="effects-section">
                <h5>Layer ${layerUpper} Effects</h5>
                <div class="effect-controls">
                    <div class="effect-toggle">
                        <label>
                            <input type="checkbox" id="${layer}-filter-enabled"> 
                            Filter
                        </label>
                    </div>
                    <div class="filter-controls" id="${layer}-filter-controls" style="display: none;">
                        <div class="control-group">
                            <label for="${layer}-filter-type">Type</label>
                            <select id="${layer}-filter-type">
                                <option value="lowpass">Low Pass</option>
                                <option value="highpass">High Pass</option>
                                <option value="bandpass">Band Pass</option>
                                <option value="notch">Notch</option>
                            </select>
                        </div>
                        <div class="control-group">
                            <label for="${layer}-filter-frequency">Frequency (Hz)</label>
                            <input type="number" id="${layer}-filter-frequency" min="20" max="20000" value="1000" step="1">
                        </div>
                        <div class="control-group">
                            <label for="${layer}-filter-resonance">Resonance</label>
                            <input type="range" id="${layer}-filter-resonance" min="0.1" max="30" value="1" step="0.1">
                            <span id="${layer}-filter-resonance-value">1.0</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    setupMasterEffectsListeners() {
        // Filter enabled toggle
        const enabledCheckbox = document.getElementById('master-filter-enabled');
        const controlsDiv = document.getElementById('master-filter-controls');
        
        if (enabledCheckbox && controlsDiv) {
            enabledCheckbox.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                this.setMasterFilterEnabled(enabled);
                controlsDiv.style.display = enabled ? 'block' : 'none';
            });
        }

        // Filter type
        const typeSelect = document.getElementById('master-filter-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.setMasterFilterType(e.target.value);
            });
        }

        // Filter frequency
        const freqInput = document.getElementById('master-filter-frequency');
        if (freqInput) {
            freqInput.addEventListener('input', (e) => {
                const frequency = parseInt(e.target.value);
                // Clamp value to valid range
                if (frequency >= 20 && frequency <= 20000) {
                    this.setMasterFilterFrequency(frequency);
                }
            });
        }

        // Filter resonance
        const resSlider = document.getElementById('master-filter-resonance');
        const resValue = document.getElementById('master-filter-resonance-value');
        if (resSlider && resValue) {
            resSlider.addEventListener('input', (e) => {
                const resonance = parseFloat(e.target.value);
                this.setMasterFilterResonance(resonance);
                resValue.textContent = resonance.toFixed(1);
            });
        }
    }

    setupLayerEffectsListeners(layer) {
        // Filter enabled toggle
        const enabledCheckbox = document.getElementById(`${layer}-filter-enabled`);
        const controlsDiv = document.getElementById(`${layer}-filter-controls`);
        
        if (enabledCheckbox && controlsDiv) {
            enabledCheckbox.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                this.setLayerFilterEnabled(layer, enabled);
                controlsDiv.style.display = enabled ? 'block' : 'none';
            });
        }

        // Filter type
        const typeSelect = document.getElementById(`${layer}-filter-type`);
        if (typeSelect) {
            typeSelect.addEventListener('change', (e) => {
                this.setLayerFilterType(layer, e.target.value);
            });
        }

        // Filter frequency
        const freqInput = document.getElementById(`${layer}-filter-frequency`);
        if (freqInput) {
            freqInput.addEventListener('input', (e) => {
                const frequency = parseInt(e.target.value);
                // Clamp value to valid range
                if (frequency >= 20 && frequency <= 20000) {
                    this.setLayerFilterFrequency(layer, frequency);
                }
            });
        }

        // Filter resonance
        const resSlider = document.getElementById(`${layer}-filter-resonance`);
        const resValue = document.getElementById(`${layer}-filter-resonance-value`);
        if (resSlider && resValue) {
            resSlider.addEventListener('input', (e) => {
                const resonance = parseFloat(e.target.value);
                this.setLayerFilterResonance(layer, resonance);
                resValue.textContent = resonance.toFixed(1);
            });
        }
    }

    // ====================================
    // CLEANUP
    // ====================================

    cleanup() {
        // Disconnect all effect nodes
        if (this.masterEffects.filter) {
            this.masterEffects.filter.disconnect();
        }
        
        Object.values(this.layerEffects).forEach(effect => {
            if (effect.filter) {
                effect.filter.disconnect();
            }
        });
        
        console.log('Audio effects cleaned up');
    }

    // ====================================
    // PRESET MANAGEMENT
    // ====================================

    getEffectsPreset() {
        return {
            master: {
                enabled: this.masterEffects.enabled,
                type: this.masterEffects.filter?.type || 'lowpass',
                frequency: this.masterEffects.filter?.frequency?.value || 1000,
                Q: this.masterEffects.filter?.Q?.value || 1
            },
            layers: Object.keys(this.layerEffects).reduce((acc, layer) => {
                const effect = this.layerEffects[layer];
                acc[layer] = {
                    enabled: effect.enabled,
                    type: effect.filter?.type || 'lowpass',
                    frequency: effect.filter?.frequency?.value || 1000,
                    Q: effect.filter?.Q?.value || 1
                };
                return acc;
            }, {})
        };
    }

    loadEffectsPreset(preset) {
        if (!preset) return;
        
        // Load master effects
        if (preset.master) {
            this.setMasterFilterEnabled(preset.master.enabled);
            this.setMasterFilterType(preset.master.type);
            this.setMasterFilterFrequency(preset.master.frequency);
            this.setMasterFilterResonance(preset.master.Q);
        }
        
        // Load layer effects
        if (preset.layers) {
            Object.keys(preset.layers).forEach(layer => {
                const layerPreset = preset.layers[layer];
                this.setLayerFilterEnabled(layer, layerPreset.enabled);
                this.setLayerFilterType(layer, layerPreset.type);
                this.setLayerFilterFrequency(layer, layerPreset.frequency);
                this.setLayerFilterResonance(layer, layerPreset.Q);
            });
        }
        
        console.log('Effects preset loaded');
    }
}

// Global instance
let audioEffects;

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    audioEffects = new AudioEffects();
    window.audioEffects = audioEffects; // Make globally accessible
});