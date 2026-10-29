// playback-voices-before.js — main Playback's note voices as they were BEFORE Phase 1a moved them onto the shared
// library: methods copied verbatim from Playback/ToneRowPlayback.js and Playback/AudioEngine.js at e465ec3 (only the
// class wrappers are new). assert-playback-identity.mjs runs these against the new code. Never edit the method bodies.

class PlaybackVoicesBefore {
    getHighFrequencyAttenuation(frequencyHz) {
        if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return 1;
        const maxFrequency = Number(this.maxFrequencyHz);
        if (!Number.isFinite(maxFrequency) || maxFrequency <= 0) return 1;

        const kneeStart = maxFrequency / 2;
        if (frequencyHz <= kneeStart) return 1;

        const denominator = Math.max(1e-9, maxFrequency - kneeStart);
        const t = Math.max(0, Math.min(1, (frequencyHz - kneeStart) / denominator));
        const smooth = t * t * (3 - 2 * t); // smoothstep
        const minGain = Math.max(0, Math.min(1, this.highFreqAttenMinGain));

        return 1 - (1 - minGain) * smooth;
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
        // layerEvents may reference older noteData objects (e.g. after
        // generateToneRowData rebuilt toneRowDataByLayer without a
        // subsequent prepareLayerEvents call). Update those too so the
        // scheduler always uses the current fundamental.
        this.layerEvents.forEach(events => {
            events.forEach(evt => {
                if (evt.noteData?.ratio) {
                    evt.noteData.frequency = this.fundamentalFreq * evt.noteData.ratio;
                    evt.noteData.isMutedByFrequency = evt.noteData.frequency > maxFreq;
                }
            });
        });
    }

    handleFundamentalChange(glideTime = 0.05) {
        if (!this.baseToneRowDataByLayer || !this.toneRowDataByLayer) return;
        this.recalcFrequencies();

        window.lrcMidiOut?.handleFundamentalRetune?.(glideTime);

        if (!this.audioContext || !this.isPlaying) return;
        const now = this.audioContext.currentTime;

        const glideParam = (param, target) => {
            const safeTarget = Math.max(0.0001, target);
            const duration = Math.max(0, Number(glideTime) || 0);
            if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
            else {
                param.cancelScheduledValues(now);
                param.setValueAtTime(Math.max(0.0001, param.value), now);
            }
            if (duration > 0.001) param.exponentialRampToValueAtTime(safeTarget, now + duration);
            else param.setValueAtTime(safeTarget, now);
        };

        for (let i = 0; i < 4; i++) {
            const voice = this.activeLayerVoices[i];
            if (voice?.oscillator && voice.noteData?.ratio) {
                const newFreq = this.fundamentalFreq * voice.noteData.ratio;
                voice.noteData.frequency = newFreq;
                glideParam(voice.oscillator.frequency, newFreq);
            }

            const bridge = this.bridgeVoices[i];
            if (bridge?.osc && bridge.ratio) {
                const newFreq = this.fundamentalFreq * bridge.ratio;
                glideParam(bridge.osc.frequency, newFreq);
            }
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
        const highFreqAtten = this.getHighFrequencyAttenuation(noteData.frequency);
        const peakGain = highFreqAtten;
        const sustainGain = sustain * highFreqAtten;
        const sustainTime = Math.max(0, duration - attack - decay - release);
        const endTime = start + Math.max(0.01, duration);

        envelope.gain.linearRampToValueAtTime(peakGain, start + attack);
        envelope.gain.linearRampToValueAtTime(sustainGain, start + attack + decay);
        envelope.gain.setValueAtTime(sustainGain, start + attack + decay + sustainTime);
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

    startLegatoNote(noteData, layerIndex, layerState, startTime = null) {
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

        const { attack, decay, sustain, release } = layerState.adsr;

        const highFreqAtten = this.getHighFrequencyAttenuation(noteData.frequency);
        const peakGain = highFreqAtten;
        const sustainGain = sustain * highFreqAtten;

        envelope.gain.linearRampToValueAtTime(peakGain, start + attack);
        envelope.gain.linearRampToValueAtTime(sustainGain, start + attack + decay);
        envelope.gain.setValueAtTime(sustainGain, start + attack + decay + 0.01);

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
        const highFreqAtten = this.getHighFrequencyAttenuation(freq);
        const target = (Number(layerState.adsr?.sustain) || 1) * highFreqAtten;
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
}

class AudioEngineBefore {
    constructor(playback) {
        this.playback = playback;
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
}
