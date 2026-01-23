// PartitionsGlobalControls.js - Mirrors main playback controls for Partitions view
// Keeps Partitions controls in sync with ToneRowPlayback settings

class PartitionsGlobalControls {
    constructor() {
        this.container = null;
        this.isInitialized = false;

        // Element references for the mirrored controls
        this.elements = {
            playBtn: null,
            cycleInput: null,
            fundamentalInput: null,
            volumeSlider: null,
            volumeValue: null,
            hipassInput: null,
            lopassInput: null
        };

        // Bound handlers for cleanup
        this.boundHandlers = {};

        console.log('🎛️ PartitionsGlobalControls initialized');
    }

    // ====================================
    // INITIALIZATION
    // ====================================

    init(container) {
        if (!container) {
            console.error('PartitionsGlobalControls: No container provided');
            return;
        }

        this.container = container;
        this.render();
        this.setupEventListeners();
        this.syncFromPlayback();
        this.isInitialized = true;

        console.log('🎛️ PartitionsGlobalControls rendered and synced');
    }

    destroy() {
        this.removeEventListeners();
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.isInitialized = false;
        this.elements = {
            playBtn: null,
            cycleInput: null,
            fundamentalInput: null,
            volumeSlider: null,
            volumeValue: null,
            hipassInput: null,
            lopassInput: null
        };
        console.log('🎛️ PartitionsGlobalControls destroyed');
    }

    // ====================================
    // RENDERING
    // ====================================

    render() {
        if (!this.container) return;

        // Get current values from ToneRowPlayback if available
        const playback = window.toneRowPlayback;
        const isPlaying = playback?.isPlaying || false;
        const cycleDuration = playback?.cycleDuration || 10.0;
        const fundamentalFreq = playback?.fundamentalFreq || 110;
        const masterVolumeDb = playback?.masterVolumeDb || -24;
        const hipassFreq = playback?.globalFilterSettings?.highpass || 20;
        const lopassFreq = playback?.globalFilterSettings?.lowpass || 20000;

        // Limits from playback module
        const cycleLimits = playback?.cycleDurationLimits || { min: 0.1, max: 6000 };
        const freqLimits = playback?.fundamentalLimits || { min: 55, max: 880 };
        const filterLimits = playback?.filterLimits || { min: 20, max: 20000 };

        this.container.innerHTML = `
            <div class="partitions-main-controls" style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px 15px;
                padding: 8px 12px;
                flex-wrap: wrap;
            ">
                <!-- Play Button (matches playback-div .play-btn styling) -->
                <button id="partitions-play-btn" class="play-btn ${isPlaying ? 'playing' : ''}" style="
                    background: ${isPlaying ? '#ff4444' : 'var(--hud-accent, #00ff88)'};
                    border: none;
                    color: #000;
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: bold;
                    width: fit-content;
                    flex-shrink: 0;
                ">${isPlaying ? '⏹ Stop' : '▶ Play'}</button>

                <!-- Cycle Time -->
                <div class="partitions-control-group" style="display: flex; align-items: center; gap: 4px;">
                    <label style="color: #888; font-size: 11px; white-space: nowrap;">Cycle:</label>
                    <input type="number" id="partitions-cycle-duration"
                        min="${cycleLimits.min}" max="${cycleLimits.max}" step="0.1"
                        value="${cycleDuration}"
                        style="
                            width: 60px;
                            padding: 4px 6px;
                            background: #222;
                            color: #fff;
                            border: 1px solid #444;
                            border-radius: 4px;
                            font-size: 11px;
                            font-family: monospace;
                        ">
                    <span style="color: #666; font-size: 10px;">s</span>
                </div>

                <!-- Fundamental Hz -->
                <div class="partitions-control-group" style="display: flex; align-items: center; gap: 4px;">
                    <label style="color: #888; font-size: 11px; white-space: nowrap;">Fund:</label>
                    <input type="number" id="partitions-fundamental-freq"
                        min="${freqLimits.min}" max="${freqLimits.max}"
                        value="${fundamentalFreq}"
                        style="
                            width: 55px;
                            padding: 4px 6px;
                            background: #222;
                            color: #fff;
                            border: 1px solid #444;
                            border-radius: 4px;
                            font-size: 11px;
                            font-family: monospace;
                        ">
                    <span style="color: #666; font-size: 10px;">Hz</span>
                </div>

                <!-- Master Volume -->
                <div class="partitions-control-group" style="display: flex; align-items: center; gap: 4px;">
                    <label style="color: #888; font-size: 11px; white-space: nowrap;">Vol:</label>
                    <input type="range" id="partitions-master-volume"
                        min="-40" max="0" value="${masterVolumeDb}"
                        style="
                            width: 70px;
                            height: 4px;
                            accent-color: #00ff88;
                        ">
                    <span id="partitions-volume-value" style="color: #00ff88; font-size: 10px; min-width: 40px;">${masterVolumeDb} dB</span>
                </div>

                <!-- Hi-Pass Filter -->
                <div class="partitions-control-group" style="display: flex; align-items: center; gap: 4px;">
                    <label style="color: #888; font-size: 11px; white-space: nowrap;">HP:</label>
                    <input type="number" id="partitions-hipass-freq"
                        min="${filterLimits.min}" max="${filterLimits.max}"
                        value="${hipassFreq}"
                        style="
                            width: 60px;
                            padding: 4px 4px;
                            background: #222;
                            color: #fff;
                            border: 1px solid #444;
                            border-radius: 4px;
                            font-size: 11px;
                            font-family: monospace;
                        ">
                </div>

                <!-- Lo-Pass Filter -->
                <div class="partitions-control-group" style="display: flex; align-items: center; gap: 4px;">
                    <label style="color: #888; font-size: 11px; white-space: nowrap;">LP:</label>
                    <input type="number" id="partitions-lopass-freq"
                        min="${filterLimits.min}" max="${filterLimits.max}"
                        value="${lopassFreq}"
                        style="
                            width: 60px;
                            padding: 4px 4px;
                            background: #222;
                            color: #fff;
                            border: 1px solid #444;
                            border-radius: 4px;
                            font-size: 11px;
                            font-family: monospace;
                        ">
                </div>
            </div>
        `;

        // Cache element references
        this.elements.playBtn = document.getElementById('partitions-play-btn');
        this.elements.cycleInput = document.getElementById('partitions-cycle-duration');
        this.elements.fundamentalInput = document.getElementById('partitions-fundamental-freq');
        this.elements.volumeSlider = document.getElementById('partitions-master-volume');
        this.elements.volumeValue = document.getElementById('partitions-volume-value');
        this.elements.hipassInput = document.getElementById('partitions-hipass-freq');
        this.elements.lopassInput = document.getElementById('partitions-lopass-freq');
    }

    // ====================================
    // EVENT LISTENERS
    // ====================================

    setupEventListeners() {
        const playback = window.toneRowPlayback;
        if (!playback) {
            console.warn('ToneRowPlayback not available for control mirroring');
            return;
        }

        // Play button
        if (this.elements.playBtn) {
            this.boundHandlers.playClick = () => {
                playback.togglePlayback();
                this.updatePlayButtonState();
            };
            this.elements.playBtn.addEventListener('click', this.boundHandlers.playClick);
        }

        // Cycle duration
        if (this.elements.cycleInput) {
            this.boundHandlers.cycleInput = (e) => {
                playback.updateTempo(parseFloat(e.target.value), { syncInput: false });
                this.syncOriginalControl('cycle-duration', e.target.value);
            };
            this.boundHandlers.cycleSnap = () => {
                playback.updateTempo(parseFloat(this.elements.cycleInput.value));
                this.syncOriginalControl('cycle-duration', this.elements.cycleInput.value);
            };

            this.elements.cycleInput.addEventListener('input', this.boundHandlers.cycleInput);
            this.elements.cycleInput.addEventListener('blur', this.boundHandlers.cycleSnap);
            this.elements.cycleInput.addEventListener('change', this.boundHandlers.cycleSnap);
        }

        // Fundamental frequency
        if (this.elements.fundamentalInput) {
            this.boundHandlers.fundamentalInput = (e) => {
                playback.updateFundamentalFreq(parseFloat(e.target.value), { syncInput: false });
                this.syncOriginalControl('fundamental-freq', e.target.value);
            };
            this.boundHandlers.fundamentalSnap = () => {
                playback.updateFundamentalFreq(parseFloat(this.elements.fundamentalInput.value));
                this.syncOriginalControl('fundamental-freq', this.elements.fundamentalInput.value);
            };

            this.elements.fundamentalInput.addEventListener('input', this.boundHandlers.fundamentalInput);
            this.elements.fundamentalInput.addEventListener('blur', this.boundHandlers.fundamentalSnap);
            this.elements.fundamentalInput.addEventListener('change', this.boundHandlers.fundamentalSnap);
        }

        // Master volume
        if (this.elements.volumeSlider) {
            this.boundHandlers.volumeInput = (e) => {
                const dbValue = parseFloat(e.target.value);
                playback.masterVolumeDb = dbValue;
                playback.updateMasterVolume(dbValue);
                this.elements.volumeValue.textContent = `${dbValue} dB`;
                this.syncOriginalControl('master-volume', dbValue);

                // Update original display value
                const originalValue = document.getElementById('master-volume-value');
                if (originalValue) {
                    originalValue.textContent = `${dbValue} dB`;
                }
            };

            this.elements.volumeSlider.addEventListener('input', this.boundHandlers.volumeInput);
        }

        // Hi-pass filter
        if (this.elements.hipassInput) {
            this.boundHandlers.hipassInput = (e) => {
                playback.setGlobalHighpass(parseFloat(e.target.value), { syncInput: false });
                this.syncOriginalControl('global-hipass-freq', e.target.value);
            };
            this.boundHandlers.hipassSnap = () => {
                playback.setGlobalHighpass(parseFloat(this.elements.hipassInput.value));
                this.syncOriginalControl('global-hipass-freq', this.elements.hipassInput.value);
            };

            this.elements.hipassInput.addEventListener('input', this.boundHandlers.hipassInput);
            this.elements.hipassInput.addEventListener('blur', this.boundHandlers.hipassSnap);
            this.elements.hipassInput.addEventListener('change', this.boundHandlers.hipassSnap);
        }

        // Lo-pass filter
        if (this.elements.lopassInput) {
            this.boundHandlers.lopassInput = (e) => {
                playback.setGlobalLowpass(parseFloat(e.target.value), { syncInput: false });
                this.syncOriginalControl('global-lopass-freq', e.target.value);
            };
            this.boundHandlers.lopassSnap = () => {
                playback.setGlobalLowpass(parseFloat(this.elements.lopassInput.value));
                this.syncOriginalControl('global-lopass-freq', this.elements.lopassInput.value);
            };

            this.elements.lopassInput.addEventListener('input', this.boundHandlers.lopassInput);
            this.elements.lopassInput.addEventListener('blur', this.boundHandlers.lopassSnap);
            this.elements.lopassInput.addEventListener('change', this.boundHandlers.lopassSnap);
        }

        // Listen for playback state changes from external sources
        this.boundHandlers.playbackStateChange = () => {
            this.updatePlayButtonState();
        };
        window.addEventListener('playbackStateChanged', this.boundHandlers.playbackStateChange);

        console.log('🎛️ PartitionsGlobalControls event listeners setup');
    }

    removeEventListeners() {
        // Remove all bound handlers
        if (this.elements.playBtn && this.boundHandlers.playClick) {
            this.elements.playBtn.removeEventListener('click', this.boundHandlers.playClick);
        }
        if (this.elements.cycleInput) {
            if (this.boundHandlers.cycleInput) {
                this.elements.cycleInput.removeEventListener('input', this.boundHandlers.cycleInput);
            }
            if (this.boundHandlers.cycleSnap) {
                this.elements.cycleInput.removeEventListener('blur', this.boundHandlers.cycleSnap);
                this.elements.cycleInput.removeEventListener('change', this.boundHandlers.cycleSnap);
            }
        }
        if (this.elements.fundamentalInput) {
            if (this.boundHandlers.fundamentalInput) {
                this.elements.fundamentalInput.removeEventListener('input', this.boundHandlers.fundamentalInput);
            }
            if (this.boundHandlers.fundamentalSnap) {
                this.elements.fundamentalInput.removeEventListener('blur', this.boundHandlers.fundamentalSnap);
                this.elements.fundamentalInput.removeEventListener('change', this.boundHandlers.fundamentalSnap);
            }
        }
        if (this.elements.volumeSlider && this.boundHandlers.volumeInput) {
            this.elements.volumeSlider.removeEventListener('input', this.boundHandlers.volumeInput);
        }
        if (this.elements.hipassInput) {
            if (this.boundHandlers.hipassInput) {
                this.elements.hipassInput.removeEventListener('input', this.boundHandlers.hipassInput);
            }
            if (this.boundHandlers.hipassSnap) {
                this.elements.hipassInput.removeEventListener('blur', this.boundHandlers.hipassSnap);
                this.elements.hipassInput.removeEventListener('change', this.boundHandlers.hipassSnap);
            }
        }
        if (this.elements.lopassInput) {
            if (this.boundHandlers.lopassInput) {
                this.elements.lopassInput.removeEventListener('input', this.boundHandlers.lopassInput);
            }
            if (this.boundHandlers.lopassSnap) {
                this.elements.lopassInput.removeEventListener('blur', this.boundHandlers.lopassSnap);
                this.elements.lopassInput.removeEventListener('change', this.boundHandlers.lopassSnap);
            }
        }

        if (this.boundHandlers.playbackStateChange) {
            window.removeEventListener('playbackStateChanged', this.boundHandlers.playbackStateChange);
        }

        this.boundHandlers = {};
        console.log('🎛️ PartitionsGlobalControls event listeners removed');
    }

    // ====================================
    // SYNC METHODS
    // ====================================

    syncFromPlayback() {
        const playback = window.toneRowPlayback;
        if (!playback) return;

        // Sync all values from the main playback module
        if (this.elements.cycleInput) {
            this.elements.cycleInput.value = playback.cycleDuration;
        }
        if (this.elements.fundamentalInput) {
            this.elements.fundamentalInput.value = playback.fundamentalFreq;
        }
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.value = playback.masterVolumeDb;
            this.elements.volumeValue.textContent = `${playback.masterVolumeDb} dB`;
        }
        if (this.elements.hipassInput) {
            this.elements.hipassInput.value = playback.globalFilterSettings?.highpass || 20;
        }
        if (this.elements.lopassInput) {
            this.elements.lopassInput.value = playback.globalFilterSettings?.lowpass || 20000;
        }

        this.updatePlayButtonState();
    }

    syncOriginalControl(controlId, value) {
        // Sync the mirrored value back to the original control in the playback div
        const originalControl = document.getElementById(controlId);
        if (originalControl) {
            originalControl.value = value;
        }
    }

    updatePlayButtonState() {
        const playback = window.toneRowPlayback;
        if (!this.elements.playBtn || !playback) return;

        const isPlaying = playback.isPlaying;
        this.elements.playBtn.textContent = isPlaying ? '⏹ Stop' : '▶ Play';
        this.elements.playBtn.style.background = isPlaying ? '#ff4444' : 'var(--hud-accent, #00ff88)';
        this.elements.playBtn.classList.toggle('playing', isPlaying);

        // Also update the original play button
        const originalBtn = document.getElementById('play-stop-btn');
        if (originalBtn) {
            originalBtn.textContent = isPlaying ? '⏹ Stop' : '▶';
            originalBtn.classList.toggle('playing', isPlaying);
        }
    }

    // ====================================
    // PUBLIC API
    // ====================================

    refresh() {
        // Re-sync all controls from playback state
        this.syncFromPlayback();
    }
}

// Create singleton instance
window.partitionsGlobalControls = new PartitionsGlobalControls();
