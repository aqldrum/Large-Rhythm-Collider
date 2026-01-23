// AudioEngine.js - Audio context and routing management

class AudioEngine {
    constructor(playback) {
        this.playback = playback;
    }

    async initAudioContext() {
        if (this.playback.audioContext) return;
        
        try {
            this.playback.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            this.playback.masterGain = this.playback.audioContext.createGain();
            this.playback.masterGain.gain.value = this.dbToLinear(this.playback.masterVolumeDb);
            
            this.playback.globalHighpassFilter = this.playback.audioContext.createBiquadFilter();
            this.playback.globalHighpassFilter.type = 'highpass';
            this.playback.globalHighpassFilter.frequency.value = this.playback.globalFilterSettings.highpass;
            this.playback.globalHighpassFilter.Q.value = 0.7;
            
            this.playback.globalLowpassFilter = this.playback.audioContext.createBiquadFilter();
            this.playback.globalLowpassFilter.type = 'lowpass';
            this.playback.globalLowpassFilter.frequency.value = this.playback.globalFilterSettings.lowpass;
            this.playback.globalLowpassFilter.Q.value = 0.7;
            
            this.playback.limiter = this.playback.audioContext.createDynamicsCompressor();
            this.playback.limiter.threshold.value = -1;
            this.playback.limiter.knee.value = 0;
            this.playback.limiter.ratio.value = 20;
            this.playback.limiter.attack.value = 0.003;
            this.playback.limiter.release.value = 0.01;
            
            this.playback.layerNodes = [];
            ['a', 'b', 'c', 'd'].forEach((layer, index) => {
                const layerGain = this.playback.audioContext.createGain();
                layerGain.gain.value = this.dbToLinear(this.playback.layerStates[layer].volume);
                
                const layerHighpass = this.playback.audioContext.createBiquadFilter();
                layerHighpass.type = 'highpass';
                layerHighpass.frequency.value = this.playback.layerStates[layer].filters.highpass;
                layerHighpass.Q.value = 0.7;
                
                const layerLowpass = this.playback.audioContext.createBiquadFilter();
                layerLowpass.type = 'lowpass';
                layerLowpass.frequency.value = this.playback.layerStates[layer].filters.lowpass;
                layerLowpass.Q.value = 0.7;
                
                layerGain.connect(layerHighpass);
                layerHighpass.connect(layerLowpass);
                layerLowpass.connect(this.playback.masterGain);
                
                this.playback.layerNodes[index] = {
                    gain: layerGain,
                    highpass: layerHighpass,
                    lowpass: layerLowpass,
                    layer: layer
                };
            });
            
            this.playback.masterGain.connect(this.playback.globalHighpassFilter);
            this.playback.globalHighpassFilter.connect(this.playback.globalLowpassFilter);
            this.playback.globalLowpassFilter.connect(this.playback.limiter);
            this.playback.limiter.connect(this.playback.audioContext.destination);

            this.updateMasterVolume(this.playback.masterVolumeDb);

            console.log('Audio context initialized');
            
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            throw error;
        }
    }

    updateMasterVolume(dbValue) {
        this.playback.masterVolumeDb = dbValue;
        if (this.playback.masterGain) {
            const linearValue = this.dbToLinear(dbValue);
            this.playback.masterGain.gain.setTargetAtTime(
                linearValue,
                this.playback.audioContext.currentTime,
                0.05
            );
        }
    }

    updateLayerVolume(layer, dbValue) {
        const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
        if (layerIndex === -1 || !this.playback.layerNodes[layerIndex]) return;
        const linearValue = this.dbToLinear(dbValue);
        this.playback.layerNodes[layerIndex].gain.gain.setTargetAtTime(
            linearValue,
            this.playback.audioContext.currentTime,
            0.05
        );
    }

    updateLayerHighpassFilter(layer, frequency) {
        const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
        if (layerIndex === -1 || !this.playback.layerNodes[layerIndex]) return;
        this.playback.layerNodes[layerIndex].highpass.frequency.setTargetAtTime(
            frequency, 
            this.playback.audioContext.currentTime, 
            0.05
        );
    }

    updateLayerLowpassFilter(layer, frequency) {
        const layerIndex = ['a', 'b', 'c', 'd'].indexOf(layer);
        if (layerIndex === -1 || !this.playback.layerNodes[layerIndex]) return;
        this.playback.layerNodes[layerIndex].lowpass.frequency.setTargetAtTime(
            frequency, 
            this.playback.audioContext.currentTime, 
            0.05
        );
    }

    setGlobalHighpassFrequency(frequency) {
        if (this.playback.globalHighpassFilter) {
            this.playback.globalHighpassFilter.frequency.setTargetAtTime(
                frequency, 
                this.playback.audioContext.currentTime, 
                0.05
            );
        }
    }

    setGlobalLowpassFrequency(frequency) {
        if (this.playback.globalLowpassFilter) {
            this.playback.globalLowpassFilter.frequency.setTargetAtTime(
                frequency, 
                this.playback.audioContext.currentTime, 
                0.05
            );
        }
    }

    stopAllOscillators() {
        const oscillators = [...this.playback.activeOscillators];
        this.playback.activeOscillators = [];
        oscillators.forEach((osc) => {
            try {
                const ctx = this.playback.audioContext;
                const now = ctx ? ctx.currentTime : 0;
                const tail = 0.02;
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
            } catch (_) {
                // Already stopped
            }
        });
    }

    dbToLinear(db) {
        return Math.pow(10, db / 20);
    }

    linearToDb(linear) {
        return 20 * Math.log10(linear);
    }
}

window.AudioEngine = AudioEngine;
