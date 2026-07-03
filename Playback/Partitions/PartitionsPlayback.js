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

        this.lastScheduledTickAbs = null;
        this.grid = 1;
        this.cycleDuration = 10; // mirrored from toneRowPlayback each rebuild - LRCExport.js reads this as a fallback
        this.secondsPerGrid = 1;
        this.layerEvents = [[], [], [], []]; // precomputed per-layer hits in shared-tick space

        this.scheduleIntervalMs = 30;
        this.lookaheadMs = 200;
        this.schedulerTimer = null;
        this.flashEpoch = 0;
        this._lastEventsFingerprint = null;
        this._lastGroupingWarnKey = null;

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
        window.addEventListener('playbackTempoChanged', () => {
            if (this.isRunning) this.handleSharedClockChange();
        });
        window.addEventListener('rhythmGenerated', () => {
            if (this.isRunning) this.rebuildAndReschedule();
        });
        window.addEventListener('partitionsConfigChanged', () => {
            if (this.isRunning && this.hasEnabledLayers()) {
                this.rebuildAndReschedule();
            }
        });
    }

    hasEnabledLayers() {
        const layers = document.querySelectorAll('.partition-layer');
        return Array.from(layers).some((layer) => layer.dataset.enabled === 'true');
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
            const sliders = Array.from(document.querySelectorAll('.partition-volume-slider'));
            sliders.forEach((slider, index) => {
                const value = Number(slider.value);
                if (!Number.isFinite(value)) return;
                const gain = this.layerGains[index];
                if (gain) {
                    gain.gain.setValueAtTime(this.dbToLinear(value), this.audioContext.currentTime);
                }
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
            const rhythmInfo = window.lrcModule?.getRhythmInfoData?.();
            if (rhythmInfo && rhythmInfo.grid) {
                this.layerEvents = this.buildLayerEvents(rhythmInfo);
                this._lastEventsFingerprint = this.fingerprintEvents(this.layerEvents);
            }
            this.snapScheduleToNow();
            this.isRunning = true;
            this.runScheduler();
        });
    }

    stop() {
        this.isRunning = false;
        this.lastScheduledTickAbs = null;
        if (this.schedulerTimer) {
            clearTimeout(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        this.stopAllActiveSources();
        window.partitionsBlockLights?.clearAll?.();
        this.flashEpoch += 1;
    }

    // A cycle-duration/tempo change doesn't move any event's tick position - ticks are
    // shared-tick-relative (musical), only absTickToTime's wall-clock mapping changes -
    // so this only needs to resync the schedule pointer, never rebuild layerEvents.
    handleSharedClockChange() {
        if (!this.audioContext || !window.toneRowPlayback) return;
        this.snapScheduleToNow();
    }

    snapScheduleToNow() {
        if (!this.audioContext || !window.toneRowPlayback) return;
        this.lastScheduledTickAbs = window.toneRowPlayback.timeToAbsTick(this.audioContext.currentTime);
    }

    // Single entry point for both rhythm regeneration and any partitionsConfigChanged
    // firing (mode/count/mute/order/sample changes, but also volume/ADSR/transpose
    // sliders, which dispatch the same event on every drag tick). Rebuilding
    // layerEvents is cheap and safe to do unconditionally - it's pure, has no side
    // effects, and is what keeps MIDI velocity/flash timing live during a slider drag.
    // The disruptive part (stopping in-flight audio, clearing lights, resyncing the
    // schedule pointer) only fires when the rebuilt events are actually structurally
    // different from last time, so a volume nudge mid-drum-hit doesn't click/flicker.
    rebuildAndReschedule() {
        if (!this.audioContext || !window.toneRowPlayback) return;
        const rhythmInfo = window.lrcModule?.getRhythmInfoData?.();
        if (!rhythmInfo || !rhythmInfo.grid) return;

        const previousEvents = this.layerEvents;
        const newEvents = this.buildLayerEvents(rhythmInfo);
        const fingerprint = this.fingerprintEvents(newEvents);
        const structurallyChanged = fingerprint !== this._lastEventsFingerprint;

        if (structurallyChanged) {
            previousEvents.forEach((events, layerIndex) => {
                if (events.length > 0 && newEvents[layerIndex].length === 0) {
                    window.lrcMidiOut?.releasePartitionLayerNotes?.(layerIndex);
                }
            });
        }

        this.layerEvents = newEvents;
        this._lastEventsFingerprint = fingerprint;

        if (structurallyChanged) {
            this.snapScheduleToNow();
            this.stopAllActiveSources();
            window.partitionsBlockLights?.clearAll?.();
            this.flashEpoch += 1;
        }
    }

    // Cheap structural fingerprint: per-layer hit count + first/last tick is enough to
    // distinguish "ticks moved" from "cosmetic param changed" without a deep-equal.
    // False positives just cost an extra flush, not correctness.
    fingerprintEvents(layerEventsArr) {
        return layerEventsArr.map((events) => {
            if (!events.length) return '0';
            const first = events[0].startTick;
            const last = events[events.length - 1].startTick;
            return `${events.length}:${first}:${last}`;
        }).join('|');
    }

    // Precomputes each enabled layer's hits once, converted from grid-tick space
    // (0..grid-1, musical) into the tone row's shared 960-ticks/sec transport space,
    // so scheduling can ride the same clock as Scheduler.js instead of drifting.
    buildLayerEvents(rhythmInfo) {
        const cycleTicks = window.toneRowPlayback?.cycleTicks || 1;
        const grid = Math.max(1, rhythmInfo.grid || 1);
        const cycleDuration = window.toneRowPlayback?.cycleDuration || 10;
        const sharedTicksPerGridUnit = cycleTicks / grid;
        const secondsPerSharedTick = window.toneRowPlayback?.secondsPerTick || (1 / 960);

        this.grid = grid;
        this.cycleDuration = cycleDuration;
        this.secondsPerGrid = cycleDuration / grid;

        const layerConfigs = this.getLayerConfigs();
        const result = [[], [], [], []];
        layerConfigs.forEach((config, layerIndex) => {
            if (!config.enabled) return;
            const { events } = this.getHitEvents(config, rhythmInfo);
            result[layerIndex] = events.map((evt) => ({
                startTick: Math.round(evt.tick * sharedTicksPerGridUnit),
                durationSharedTicks: Math.max(1, Math.round(evt.durationSec / secondsPerSharedTick)),
                displayIndex: evt.displayIndex,
                sampleUrl: config.sampleUrl,
                volumeDb: config.volumeDb
            }));
        });
        return result;
    }

    runScheduler() {
        if (!this.isRunning || !this.audioContext || !window.toneRowPlayback?.isPlaying) return;

        const now = this.audioContext.currentTime;
        const lookaheadSec = this.lookaheadMs / 1000;
        const windowEndTime = now + lookaheadSec;

        if (this.lastScheduledTickAbs == null) {
            this.lastScheduledTickAbs = window.toneRowPlayback.timeToAbsTick(now);
        }

        const windowStartTickAbs = this.lastScheduledTickAbs;
        const windowEndTickAbs = window.toneRowPlayback.timeToAbsTick(windowEndTime);

        this.scheduleWindow(windowStartTickAbs, windowEndTickAbs);
        this.lastScheduledTickAbs = windowEndTickAbs;

        this.schedulerTimer = setTimeout(() => this.runScheduler(), this.scheduleIntervalMs);
    }

    // Mirrors Scheduler.scheduleWindow: walks each layer's precomputed events and fires
    // only the cycle occurrences landing inside [startAbs, endAbs) - never more than one
    // lookahead window of MIDI/audio is ever committed at a time.
    scheduleWindow(startAbs, endAbs) {
        const cycleTicks = window.toneRowPlayback?.cycleTicks || 1;
        const secondsPerSharedTick = window.toneRowPlayback?.secondsPerTick || (1 / 960);

        this.layerEvents.forEach((events, layerIndex) => {
            if (!events.length) return;
            events.forEach((evt) => {
                const base = evt.startTick;
                const firstCycle = Math.ceil((startAbs - base) / cycleTicks);
                let occTick = base + Math.max(0, firstCycle) * cycleTicks;
                while (occTick < endAbs) {
                    const startTime = window.toneRowPlayback.absTickToTime(occTick);
                    const durationSec = evt.durationSharedTicks * secondsPerSharedTick;
                    this.triggerSample(evt.sampleUrl, layerIndex, evt.volumeDb, startTime);
                    if (durationSec >= 0.01) {
                        this.scheduleFlash(layerIndex, evt.displayIndex, startTime, durationSec);
                    }
                    occTick += cycleTicks;
                }
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
            const p1Input = layer.querySelector('.partition-count-input-primary');
            const p2Input = layer.querySelector('.partition-count-input-secondary');
            const partitions = Number(p1Input?.dataset?.committed || p1Input?.value || 1);
            const secondaryPartitions = Number(p2Input?.dataset?.committed || p2Input?.value || 0);
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
            let p2Coverages = null;
            if (preview?.dataset?.p2Coverages) {
                try {
                    const parsed = JSON.parse(preview.dataset.p2Coverages);
                    if (Array.isArray(parsed) && parsed.length > 0) p2Coverages = parsed;
                } catch (_) {
                    // ignore
                }
            }
            configs.push({ enabled, mode, partitions, secondaryPartitions, sampleUrl, volumeDb, layerIndex: index, linkedLayerIndex, mutedIndices: muted, order, p2Coverages });
        });
        return configs;
    }

    getHitEvents(config, rhythmInfo) {
        const { mode, partitions, secondaryPartitions, mutedIndices, order, p2Coverages } = config;
        const mutedSet = new Set(mutedIndices || []);
        const secondaryValue = Number.isFinite(secondaryPartitions) ? secondaryPartitions : 0;
        const layers = rhythmInfo.displayLayers && rhythmInfo.displayLayers.length > 0
            ? rhythmInfo.displayLayers
            : rhythmInfo.layers || [];
        const layerIndex = config.layerIndex ?? 0;
        const linkedLayerIndex = Number.isFinite(config.linkedLayerIndex) ? config.linkedLayerIndex : layerIndex;
        const layerValue = layers[linkedLayerIndex] || 0;

        if (Array.isArray(p2Coverages) && p2Coverages.length > 0) {
            const { orderedSizes, orderedIndices } = this.getOrderedSizes(p2Coverages, order);
            const coverageTotal = p2Coverages.reduce((sum, c) => sum + c, 0);

            if (mode === 'sequence' && layerValue > 0) {
                const grouping = rhythmInfo.grid / layerValue;
                const events = this.getHitPositions(coverageTotal, orderedSizes, mutedSet, orderedIndices, null)
                    .map(({ tick, displayIndex }) => ({
                        tick: Math.round(tick * grouping),
                        displayIndex
                    }));
                return this.computeEventDurations(events, rhythmInfo.grid);
            }

            if (mode === 'grouping' && layerValue > 0) {
                const grouping = Math.round(rhythmInfo.grid / layerValue);
                if (rhythmInfo.grid % layerValue !== 0) {
                    this._warnNonDivisibleGrouping(layerIndex, rhythmInfo.grid, layerValue);
                }
                const groupHits = this.getHitPositions(coverageTotal, orderedSizes, mutedSet, orderedIndices, null);
                const ticks = [];
                for (let i = 0; i < layerValue; i += 1) {
                    const base = i * grouping;
                    groupHits.forEach((hit) => ticks.push({
                        tick: base + hit.tick,
                        displayIndex: hit.displayIndex
                    }));
                }
                return this.computeEventDurations(ticks, rhythmInfo.grid);
            }

            const events = this.getHitPositions(coverageTotal, orderedSizes, mutedSet, orderedIndices, null)
                .map(({ tick, displayIndex }) => ({ tick, displayIndex }));
            return this.computeEventDurations(events, rhythmInfo.grid);
        }

        if (mode === 'sequence' && layerValue > 0) {
            const sequenceLength = layerValue;
            const grouping = rhythmInfo.grid / layerValue;
            const { sizes } = PartitionsBlocks.calculatePartitionSizes(sequenceLength, partitions);
            const { orderedSizes, orderedIndices } = this.getOrderedSizes(sizes, order);
            const allowedSet = this.getSecondaryAllowedSet(orderedSizes.length, secondaryValue);
            const events = this.getHitPositions(sequenceLength, orderedSizes, mutedSet, orderedIndices, allowedSet)
                .map(({ tick, displayIndex }) => ({
                    tick: Math.round(tick * grouping),
                    displayIndex
                }));
            return this.computeEventDurations(events, rhythmInfo.grid);
        }

        if (mode === 'grouping' && layerValue > 0) {
            const grouping = Math.round(rhythmInfo.grid / layerValue);
            if (rhythmInfo.grid % layerValue !== 0) {
                this._warnNonDivisibleGrouping(layerIndex, rhythmInfo.grid, layerValue);
            }
            const { sizes } = PartitionsBlocks.calculatePartitionSizes(grouping, partitions);
            const { orderedSizes, orderedIndices } = this.getOrderedSizes(sizes, order);
            const allowedSet = this.getSecondaryAllowedSet(orderedSizes.length, secondaryValue);
            const groupHits = this.getHitPositions(grouping, orderedSizes, mutedSet, orderedIndices, allowedSet);
            const ticks = [];
            for (let i = 0; i < layerValue; i += 1) {
                const base = i * grouping;
                groupHits.forEach((hit) => ticks.push({
                    tick: base + hit.tick,
                    displayIndex: hit.displayIndex
                }));
            }
            return this.computeEventDurations(ticks, rhythmInfo.grid);
        }

        const { sizes } = PartitionsBlocks.calculatePartitionSizes(rhythmInfo.grid, partitions);
        const { orderedSizes, orderedIndices } = this.getOrderedSizes(sizes, order);
        const allowedSet = this.getSecondaryAllowedSet(orderedSizes.length, secondaryValue);
        const events = this.getHitPositions(rhythmInfo.grid, orderedSizes, mutedSet, orderedIndices, allowedSet)
            .map(({ tick, displayIndex }) => ({ tick, displayIndex }));
        return this.computeEventDurations(events, rhythmInfo.grid);
    }

    _warnNonDivisibleGrouping(layerIndex, grid, layerValue) {
        const key = `${layerIndex}:${grid}:${layerValue}`;
        if (this._lastGroupingWarnKey === key) return;
        this._lastGroupingWarnKey = key;
        console.warn('[PartitionsPlayback] Grouping mode: grid not evenly divisible by layer value, hits may spill past cycle boundary', { layerIndex, grid, layerValue });
    }

    getHitPositions(total, sizes, mutedSet = new Set(), orderedIndices = null, allowedSet = null) {
        const positions = [];
        let cursor = 0;
        sizes.forEach((size, index) => {
            if (cursor < total) {
                if (allowedSet && !allowedSet.has(index)) {
                    cursor += size;
                    return;
                }
                const mutedIndex = orderedIndices ? orderedIndices[index] : index;
                if (!mutedSet.has(mutedIndex)) {
                    positions.push({ tick: cursor, displayIndex: index, size });
                }
            }
            cursor += size;
        });
        return positions;
    }

    computeEventDurations(events, totalTicks) {
        if (!events.length) {
            return { events: [], minDurationSec: 0 };
        }
        const total = Math.max(1, Math.floor(Number(totalTicks) || 1));
        const withDurations = events.map((event, index) => {
            const next = events[(index + 1) % events.length];
            let durationTicks = ((next.tick - event.tick) + total) % total;
            if (durationTicks === 0) durationTicks = total;
            return {
                ...event,
                durationSec: durationTicks * this.secondsPerGrid
            };
        });
        const minDurationSec = withDurations.reduce((min, event) => Math.min(min, event.durationSec), Number.POSITIVE_INFINITY);
        return { events: withDurations, minDurationSec };
    }

    getSecondaryAllowedSet(stepCount, pulses) {
        const steps = Math.max(1, Math.floor(Number(stepCount) || 1));
        const pulseCount = Math.floor(Number(pulses) || 0);
        if (!pulseCount) return null;
        let pattern = PartitionsDistribution.generateEuclideanPattern(steps, pulseCount);
        const firstOn = pattern.indexOf(1);
        if (firstOn > 0) {
            pattern = pattern.slice(firstOn).concat(pattern.slice(0, firstOn));
        }
        const allowed = new Set();
        pattern.forEach((flag, index) => {
            if (flag) allowed.add(index);
        });
        return allowed;
    }

    scheduleFlash(layerIndex, displayIndex, time, durationSec = 0) {
        if (!this.audioContext) return;
        const now = this.audioContext.currentTime;
        if (time < now - 0.005) {
            return;
        }
        const msUntil = Math.max(0, (time - now) * 1000);
        const durationMs = Math.max(10, durationSec * 1000);
        const epoch = this.flashEpoch;
        if (window.partitionsDebug) {
            console.log('[PartitionsPlayback] Flash scheduled', { layerIndex, displayIndex, msUntil, durationMs });
        }
        const timeoutId = setTimeout(() => {
            if (this.flashEpoch !== epoch) {
                window.partitionsBlockLights?.untrackTimeout?.(timeoutId);
                return;
            }
            window.partitionsBlockLights?.flash?.(layerIndex, displayIndex, durationMs);
            window.partitionsBlockLights?.untrackTimeout?.(timeoutId);
        }, msUntil);
        window.partitionsBlockLights?.trackTimeout?.(timeoutId);
    }

    getOrderedSizes(sizes, order) {
        const orderedIndices = Array.isArray(order) && order.length === sizes.length
            ? order.slice()
            : sizes.map((_, index) => index);
        const orderedSizes = orderedIndices.map((index) => (typeof sizes[index] === 'number' ? sizes[index] : 0));
        return { orderedSizes, orderedIndices };
    }

    async triggerSample(url, layerIndex, volumeDb, time) {
        window.lrcMidiOut?.schedulePartitionHit(layerIndex, time, volumeDb, this.layerTranspose[layerIndex]);
        if (!url || !this.audioContext) return;
        const now = this.audioContext.currentTime;
        if (time < now - 0.005) {
            return;
        }
        const scheduleTime = Math.max(time, now + 0.001);
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
        envelope.gain.setValueAtTime(0, scheduleTime);
        const transpose = this.layerTranspose[layerIndex] ?? 0;
        const playbackRate = Math.pow(2, transpose / 12);
        const adsr = this.layerADSR[layerIndex] || this.layerADSR[0];
        const attack = Math.max(0.001, adsr.attack || 0.001);
        const decay = Math.max(0.001, adsr.decay || 0.2);
        const sustain = Math.min(1, Math.max(0, adsr.sustain ?? 0.7));
        const release = Math.max(0.001, adsr.release || 0.3);
        const duration = buffer.duration || 0;
        const sustainTime = Math.max(0, duration - attack - decay - release);

        envelope.gain.setValueAtTime(0, scheduleTime);
        envelope.gain.linearRampToValueAtTime(1, scheduleTime + attack);
        envelope.gain.linearRampToValueAtTime(sustain, scheduleTime + attack + decay);
        envelope.gain.setValueAtTime(sustain, scheduleTime + attack + decay + sustainTime);
        envelope.gain.linearRampToValueAtTime(0, scheduleTime + attack + decay + sustainTime + release);

        source.playbackRate.setValueAtTime(playbackRate, scheduleTime);

        source.connect(envelope);
        if (filterChain && gainNode) {
            envelope.connect(filterChain.highpass);
        } else if (gainNode) {
            envelope.connect(gainNode);
        } else {
            envelope.connect(this.audioContext.destination);
        }

        source.start(scheduleTime);
        source.stop(scheduleTime + Math.max(0.01, attack + decay + sustainTime + release + 0.01));
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

    updateLayerVolume(layerIndex, volumeDb) {
        if (!Number.isFinite(volumeDb)) return;
        const gainNode = this.layerGains[layerIndex];
        if (!gainNode || !this.audioContext) return;
        const linear = this.dbToLinear(volumeDb);
        gainNode.gain.setTargetAtTime(linear, this.audioContext.currentTime, 0.03);
    }

    updateBusVolume(volumeDb) {
        if (!Number.isFinite(volumeDb)) return;
        if (!this.outputGain || !this.audioContext) return;
        const linear = this.dbToLinear(volumeDb);
        this.outputGain.gain.setTargetAtTime(linear, this.audioContext.currentTime, 0.03);
    }
}

window.partitionsPlayback = new PartitionsPlayback();
