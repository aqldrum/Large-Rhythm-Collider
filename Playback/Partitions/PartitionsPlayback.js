// PartitionsPlayback.js - Schedules partition layer ticks and sample playback

class PartitionsPlayback {
    constructor() {
        this.audioContext = null;
        this.outputGain = null;
        this.layerGains = [null, null, null, null];
        this.layerFilters = [null, null, null, null];
        this.layerADSR = [
            { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.3 },
            { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.3 },
            { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.3 },
            { attack: 0.001, decay: 0.2, sustain: 0.7, release: 0.3 }
        ];
        this.layerTranspose = [0, 0, 0, 0];
        this.sampleCache = new Map();
        this.activeSources = new Set();
        this.isRunning = false;

        this.baseStartTime = null;
        this.lastScheduledCycle = null;
        this.cycleDuration = 10;
        this.grid = 1;
        this.secondsPerGrid = 1;

        this.scheduleIntervalMs = 30;
        this.lookaheadSec = 0.2;
        this.schedulerTimer = null;

        this.setupEventListeners();
        console.log('🥁 PartitionsPlayback initialized');
    }

    setupEventListeners() {
        window.addEventListener('playbackStarted', () => {
            this.start();
        });
        window.addEventListener('playbackStopped', () => {
            this.stop();
        });
        window.addEventListener('playbackTempoChanged', (e) => {
            this.handleTempoChange(e.detail);
        });
        window.addEventListener('rhythmGenerated', () => {
            if (this.isRunning) {
                this.refreshTiming();
            }
        });
        window.addEventListener('partitionsConfigChanged', () => {
            if (this.isRunning) {
                this.rescheduleFromNow();
            }
        });
    }

    async initAudioContext() {
        if (this.audioContext) return;
        if (window.toneRowPlayback) {
            await window.toneRowPlayback.initAudioContext();
            this.audioContext = window.toneRowPlayback.audioContext;
            this.outputGain = this.audioContext.createGain();
            this.outputGain.gain.value = 1;
            if (window.toneRowPlayback.masterGain) {
                this.outputGain.connect(window.toneRowPlayback.masterGain);
            } else {
                this.outputGain.connect(this.audioContext.destination);
            }
            this.layerGains = this.layerGains.map(() => {
                const gain = this.audioContext.createGain();
                gain.gain.value = 1;
                gain.connect(this.outputGain);
                return gain;
            });
            this.layerFilters = this.layerGains.map((gain) => {
                const highpass = this.audioContext.createBiquadFilter();
                highpass.type = 'highpass';
                highpass.frequency.value = 20;
                highpass.Q.value = 0.7;

                const lowpass = this.audioContext.createBiquadFilter();
                lowpass.type = 'lowpass';
                lowpass.frequency.value = 20000;
                lowpass.Q.value = 0.7;

                highpass.connect(lowpass);
                lowpass.connect(gain);
                return { highpass, lowpass };
            });
        }
    }

    start() {
        if (this.isRunning) return;
        if (!window.toneRowPlayback || !window.toneRowPlayback.isPlaying) return;

        this.initAudioContext().then(() => {
            this.refreshTiming();
            this.isRunning = true;
            this.runScheduler();
        });
    }

    stop() {
        this.isRunning = false;
        this.baseStartTime = null;
        this.lastScheduledCycle = null;
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        this.stopAllActiveSources();
    }

    handleTempoChange(detail = {}) {
        if (!window.toneRowPlayback) return;
        this.cycleDuration = window.toneRowPlayback.cycleDuration || this.cycleDuration;
        if (detail && Number.isFinite(detail.cycleDurationMs)) {
            this.cycleDuration = detail.cycleDurationMs / 1000;
        }
        if (this.grid > 0) {
            this.secondsPerGrid = this.cycleDuration / this.grid;
        }
        if (this.audioContext) {
            const phaseSec = (detail.phaseMs || 0) / 1000;
            this.baseStartTime = this.audioContext.currentTime - phaseSec;
            this.lastScheduledCycle = null;
        }
        if (this.isRunning) {
            this.rescheduleFromNow();
        }
    }

    rescheduleFromNow() {
        if (!this.audioContext) return;
        const phaseMs = window.toneRowPlayback?.computeCurrentPhaseMs?.() || 0;
        this.baseStartTime = this.audioContext.currentTime - (phaseMs / 1000);
        this.lastScheduledCycle = null;
        this.stopAllActiveSources();
    }

    refreshTiming() {
        const rhythmInfo = window.lrcModule?.getRhythmInfoData?.();
        if (!rhythmInfo || !rhythmInfo.grid) return;
        this.grid = rhythmInfo.grid;
        this.cycleDuration = window.toneRowPlayback?.cycleDuration || this.cycleDuration;
        this.secondsPerGrid = this.grid > 0 ? this.cycleDuration / this.grid : 1;

        if (this.audioContext) {
            const phaseMs = window.toneRowPlayback?.computeCurrentPhaseMs?.() || 0;
            this.baseStartTime = this.audioContext.currentTime - (phaseMs / 1000);
            this.lastScheduledCycle = null;
        }
    }

    runScheduler() {
        if (!this.isRunning || !this.audioContext || !window.toneRowPlayback?.isPlaying) return;

        const now = this.audioContext.currentTime;
        if (this.baseStartTime == null) {
            this.baseStartTime = now;
        }

        const elapsed = Math.max(0, now - this.baseStartTime);
        const currentCycle = Math.floor(elapsed / this.cycleDuration);
        if (this.lastScheduledCycle == null) {
            this.lastScheduledCycle = currentCycle - 1;
        }

        const windowEnd = now + this.lookaheadSec;
        while (this.baseStartTime + (this.lastScheduledCycle + 1) * this.cycleDuration < windowEnd) {
            this.lastScheduledCycle += 1;
            this.scheduleCycle(this.lastScheduledCycle);
        }

        this.schedulerTimer = setTimeout(() => this.runScheduler(), this.scheduleIntervalMs);
    }

    scheduleCycle(cycleIndex) {
        if (!window.toneRowPlayback?.isPlaying) return;
        const cycleStartTime = this.baseStartTime + cycleIndex * this.cycleDuration;
        const rhythmInfo = window.lrcModule?.getRhythmInfoData?.();
        if (!rhythmInfo) return;

        const layerConfigs = this.getLayerConfigs();
        layerConfigs.forEach((config, layerIndex) => {
            if (!config.enabled) return;
            const hitTicks = this.getHitTicks(config, rhythmInfo);
            hitTicks.forEach((tick) => {
                const time = cycleStartTime + (tick * this.secondsPerGrid);
                this.triggerSample(config.sampleUrl, layerIndex, config.volumeDb, time);
            });
        });
    }

    getLayerConfigs() {
        const configs = [];
        const layers = document.querySelectorAll('.partition-layer');
        layers.forEach((layer, index) => {
            const enabled = layer.dataset.enabled === 'true';
            const linkedLayerIndex = Number(layer.dataset.linkedLayer ?? index);
            const mode = layer.querySelector('.partition-mode-select')?.value || 'grid';
            const partitions = Number(layer.querySelector('.partition-count-slider')?.value || 1);
            const sampleUrl = layer.querySelector('.partition-sample-select')?.value || '';
            const volumeDb = Number(layer.querySelector('.partition-volume-slider')?.value || -18);
            const preview = layer.querySelector('.partition-preview');
            let muted = [];
            if (preview?.dataset?.mutedIndices) {
                try {
                    const parsed = JSON.parse(preview.dataset.mutedIndices);
                    if (Array.isArray(parsed)) muted = parsed;
                } catch (_) {
                    // ignore
                }
            }
            let order = null;
            if (preview?.dataset?.orderIndices) {
                try {
                    const parsed = JSON.parse(preview.dataset.orderIndices);
                    if (Array.isArray(parsed)) order = parsed;
                } catch (_) {
                    // ignore
                }
            }
            configs.push({ enabled, mode, partitions, sampleUrl, volumeDb, layerIndex: index, linkedLayerIndex, mutedIndices: muted, order });
        });
        return configs;
    }

    getHitTicks(config, rhythmInfo) {
        const { mode, partitions, mutedIndices, order } = config;
        const mutedSet = new Set(mutedIndices || []);
        const layers = rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers || [];
        const layerIndex = config.layerIndex ?? 0;
        const linkedLayerIndex = Number.isFinite(config.linkedLayerIndex) ? config.linkedLayerIndex : layerIndex;
        const layerValue = layers[linkedLayerIndex] || 0;

        if (mode === 'sequence' && layerValue > 0) {
            const sequenceLength = layerValue;
            const grouping = rhythmInfo.grid / layerValue;
            const { sizes } = PartitionsBlocks.calculatePartitionSizes(sequenceLength, partitions);
            const { orderedSizes, orderedIndices } = this.getOrderedSizes(sizes, order);
            const hitIndices = this.getHitPositions(sequenceLength, orderedSizes, mutedSet, orderedIndices);
            return hitIndices.map((seqIndex) => Math.round(seqIndex * grouping));
        }

        if (mode === 'grouping' && layerValue > 0) {
            const grouping = Math.round(rhythmInfo.grid / layerValue);
            const { sizes } = PartitionsBlocks.calculatePartitionSizes(grouping, partitions);
            const { orderedSizes, orderedIndices } = this.getOrderedSizes(sizes, order);
            const groupHits = this.getHitPositions(grouping, orderedSizes, mutedSet, orderedIndices);
            const ticks = [];
            for (let i = 0; i < layerValue; i += 1) {
                const base = i * grouping;
                groupHits.forEach((hit) => ticks.push(base + hit));
            }
            return ticks;
        }

        const { sizes } = PartitionsBlocks.calculatePartitionSizes(rhythmInfo.grid, partitions);
        const { orderedSizes, orderedIndices } = this.getOrderedSizes(sizes, order);
        return this.getHitPositions(rhythmInfo.grid, orderedSizes, mutedSet, orderedIndices);
    }

    getHitPositions(total, sizes, mutedSet = new Set(), orderedIndices = null) {
        const positions = [];
        let cursor = 0;
        sizes.forEach((size, index) => {
            if (cursor < total) {
                const mutedIndex = orderedIndices ? orderedIndices[index] : index;
                if (!mutedSet.has(mutedIndex)) {
                    positions.push(cursor);
                }
            }
            cursor += size;
        });
        return positions;
    }

    getOrderedSizes(sizes, order) {
        const orderedIndices = Array.isArray(order) && order.length === sizes.length
            ? order.slice()
            : sizes.map((_, index) => index);
        const orderedSizes = orderedIndices.map((index) => (typeof sizes[index] === 'number' ? sizes[index] : 0));
        return { orderedSizes, orderedIndices };
    }

    async triggerSample(url, layerIndex, volumeDb, time) {
        if (!url || !this.audioContext) return;
        const now = this.audioContext.currentTime;
        if (time <= now + 0.002) {
            return;
        }
        const buffer = await this.loadSample(url);
        if (!buffer) return;

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        this.activeSources.add(source);
        source.onended = () => {
            this.activeSources.delete(source);
        };
        const gainNode = this.layerGains[layerIndex] || this.outputGain;
        const filterChain = this.layerFilters[layerIndex];
        const envelope = this.audioContext.createGain();
        envelope.gain.setValueAtTime(0, time);
        const transpose = this.layerTranspose[layerIndex] ?? 0;
        const playbackRate = Math.pow(2, transpose / 12);
        const adsr = this.layerADSR[layerIndex] || this.layerADSR[0];
        const attack = Math.max(0.001, adsr.attack || 0.001);
        const decay = Math.max(0.001, adsr.decay || 0.2);
        const sustain = Math.min(1, Math.max(0, adsr.sustain ?? 0.7));
        const release = Math.max(0.001, adsr.release || 0.3);
        const duration = buffer.duration || 0;
        const sustainTime = Math.max(0, duration - attack - decay - release);

        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(1, time + attack);
        envelope.gain.linearRampToValueAtTime(sustain, time + attack + decay);
        envelope.gain.setValueAtTime(sustain, time + attack + decay + sustainTime);
        envelope.gain.linearRampToValueAtTime(0, time + attack + decay + sustainTime + release);

        if (gainNode) {
            gainNode.gain.setValueAtTime(this.dbToLinear(volumeDb), time);
        }

        source.playbackRate.setValueAtTime(playbackRate, time);

        source.connect(envelope);
        if (filterChain && gainNode) {
            envelope.connect(filterChain.highpass);
        } else if (gainNode) {
            envelope.connect(gainNode);
        } else {
            envelope.connect(this.audioContext.destination);
        }

        source.start(time);
        source.stop(time + Math.max(0.01, attack + decay + sustainTime + release + 0.01));
    }

    async loadSample(url) {
        if (this.sampleCache.has(url)) return this.sampleCache.get(url);
        try {
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.arrayBuffer();
            const buffer = await this.audioContext.decodeAudioData(data);
            this.sampleCache.set(url, buffer);
            return buffer;
        } catch (error) {
            console.warn('[PartitionsPlayback] Failed to load sample', url, error);
            return null;
        }
    }

    dbToLinear(db) {
        return Math.pow(10, db / 20);
    }

    invalidateSampleCache(url) {
        if (!url) return;
        this.sampleCache.delete(url);
    }

    stopAllActiveSources() {
        this.activeSources.forEach((source) => {
            try {
                source.stop();
            } catch (_) {
                // Already stopped
            }
        });
        this.activeSources.clear();
    }

    updateLayerFilters(layerIndex, { highpass, lowpass }) {
        const filters = this.layerFilters[layerIndex];
        if (!filters || !this.audioContext) return;
        if (Number.isFinite(highpass)) {
            filters.highpass.frequency.setTargetAtTime(highpass, this.audioContext.currentTime, 0.05);
        }
        if (Number.isFinite(lowpass)) {
            filters.lowpass.frequency.setTargetAtTime(lowpass, this.audioContext.currentTime, 0.05);
        }
    }

    updateLayerADSR(layerIndex, param, value) {
        if (!this.layerADSR[layerIndex]) return;
        if (!Number.isFinite(value)) return;
        this.layerADSR[layerIndex][param] = value;
    }

    updateLayerTranspose(layerIndex, value) {
        if (!Number.isFinite(value)) return;
        if (typeof this.layerTranspose[layerIndex] !== 'number') return;
        this.layerTranspose[layerIndex] = value;
    }
}

window.partitionsPlayback = new PartitionsPlayback();
