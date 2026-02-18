// Scheduler.js - Tick-based scheduling and transport control

class Scheduler {
    constructor(playback) {
        this.playback = playback;
    }

    prepareLayerEvents() {
        this.playback.layerEvents = [[], [], [], []];
        const tps = Math.max(1, this.playback.ticksPerSecond);
        const cycleTicks = Math.max(1, Math.round(this.playback.cycleDuration * tps));
        this.playback.cycleTicks = cycleTicks;

        ['a', 'b', 'c', 'd'].forEach((layer, layerIndex) => {
            const rhythmValue = this.playback.currentRhythms[layerIndex];
            const layerData = this.playback.toneRowDataByLayer[layerIndex];
            if (rhythmValue <= 1 || !layerData || !layerData.length) return;

            const ticksPerNote = cycleTicks / rhythmValue;
            this.playback.layerEvents[layerIndex] = layerData.map((noteData, noteIndex) => {
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

    configureTiming(startPhaseMs = 0) {
        const tempo = Math.max(0.0001, this.playback.tempo || 1);
        this.playback.secondsPerTick = 1 / (this.playback.ticksPerSecond * tempo);
        this.playback.cycleTicks = Math.max(1, Math.round(this.playback.cycleDuration * this.playback.ticksPerSecond));

        const startTick = Math.floor((Math.max(0, startPhaseMs) / 1000) / this.playback.secondsPerTick) % this.playback.cycleTicks;
        this.playback.transportStartTick = startTick;
        this.playback.lastScheduledTickAbs = startTick;
        const now = this.playback.audioContext.currentTime;
        this.playback.transportStartTime = now;
    }

    runScheduler() {
        if (!this.playback.isPlaying || !this.playback.audioContext) return;

        const now = this.playback.audioContext.currentTime;
        const lookaheadSec = this.playback.scheduleLookaheadMs / 1000;
        const windowEndTime = now + lookaheadSec;

        const windowStartTickAbs = this.playback.lastScheduledTickAbs;
        const windowEndTickAbs = this.timeToAbsTick(windowEndTime);

        this.scheduleWindow(windowStartTickAbs, windowEndTickAbs);
        this.playback.lastScheduledTickAbs = windowEndTickAbs;

        this.playback.schedulerTimer = setTimeout(() => this.runScheduler(), this.playback.scheduleIntervalMs);
    }

    timeToAbsTick(targetTime) {
        const elapsedSec = Math.max(0, targetTime - this.playback.transportStartTime);
        const deltaTicks = Math.floor(elapsedSec / this.playback.secondsPerTick);
        return this.playback.transportStartTick + deltaTicks;
    }

    absTickToTime(absTick) {
        const deltaTicks = absTick - this.playback.transportStartTick;
        return this.playback.transportStartTime + (deltaTicks * this.playback.secondsPerTick);
    }

    handleCycleDurationChange(newDuration) {
        const tps = Math.max(1, this.playback.ticksPerSecond);
        const prevCycleTicks = this.playback.cycleTicks || Math.max(1, Math.round(this.playback.cycleDuration * tps));
        const tempo = Math.max(0.0001, this.playback.tempo || 1);

        let phaseRatio = 0;
        if (this.playback.isPlaying && this.playback.audioContext) {
            const now = this.playback.audioContext.currentTime;
            const currentAbsTick = this.timeToAbsTick(now);
            phaseRatio = ((currentAbsTick % prevCycleTicks) + prevCycleTicks) % prevCycleTicks;
            phaseRatio = phaseRatio / prevCycleTicks;
        }

        this.playback.cycleDuration = newDuration;
        this.playback.cycleTicks = Math.max(1, Math.round(this.playback.cycleDuration * tps));
        this.playback.secondsPerTick = 1 / (tps * tempo);
        this.prepareLayerEvents();

        if (this.playback.isPlaying && this.playback.audioContext) {
            const now = this.playback.audioContext.currentTime;
            const startTick = Math.floor(phaseRatio * this.playback.cycleTicks) % this.playback.cycleTicks;
            this.playback.transportStartTick = startTick;
            this.playback.lastScheduledTickAbs = startTick;
            this.playback.transportStartTime = now;
            if (this.playback.schedulerTimer) {
                clearTimeout(this.playback.schedulerTimer);
                this.playback.schedulerTimer = null;
            }
            this.runScheduler();
        }

        const currentPhaseMs = this.computeCurrentPhaseMs();
        this.emitTempoChange({ phaseMs: currentPhaseMs });
        this.armTransportBridge();
    }

    setTempoMultiplier(newTempo, { phaseMs = null } = {}) {
        const tempo = Math.max(0.0001, Number(newTempo) || 1);
        const tps = Math.max(1, this.playback.ticksPerSecond);
        const prevCycleTicks = this.playback.cycleTicks || Math.max(1, Math.round(this.playback.cycleDuration * tps));

        const prevTempoValue = this.playback.tempo || 1;
        const prevSecondsPerTick = this.playback.secondsPerTick || (1 / (tps * prevTempoValue));

        let targetPhaseTick = 0;
        if (phaseMs != null && Number.isFinite(phaseMs) && this.playback.cycleDuration > 0) {
            const phaseRatio = Math.max(0, phaseMs) / (this.playback.cycleDuration * 1000);
            targetPhaseTick = Math.floor(phaseRatio * prevCycleTicks) % prevCycleTicks;
        } else if (this.playback.isPlaying && this.playback.audioContext) {
            const now = this.playback.audioContext.currentTime;
            const currentAbsTick = this.timeToAbsTick(now);
            targetPhaseTick = ((currentAbsTick % prevCycleTicks) + prevCycleTicks) % prevCycleTicks;
        }

        this.playback.tempo = tempo;
        this.playback.secondsPerTick = 1 / (tps * tempo);

        if (this.playback.isPlaying && this.playback.audioContext) {
            const now = this.playback.audioContext.currentTime;
            this.playback.transportStartTick = targetPhaseTick;
            this.playback.lastScheduledTickAbs = targetPhaseTick;
            this.playback.transportStartTime = now;
            if (this.playback.schedulerTimer) {
                clearTimeout(this.playback.schedulerTimer);
                this.playback.schedulerTimer = null;
            }
            this.runScheduler();
        }

        const currentPhaseMs = this.computeCurrentPhaseMs();
        this.emitTempoChange({ phaseMs: currentPhaseMs });

        const newSecondsPerTick = this.playback.secondsPerTick;

        console.log('[ToneRowPlayback] Tempo change', {
            prevTempo: prevTempoValue,
            newTempo: tempo,
            prevSecondsPerTick,
            newSecondsPerTick,
            legatoEnabled: this.playback.legatoEnabled
        });

        this.armTransportBridge();
    }

    computeCurrentPhaseMs() {
        if (!this.playback.audioContext || !this.playback.isPlaying) return 0;
        if (!Number.isFinite(this.playback.secondsPerTick) || this.playback.secondsPerTick <= 0) return 0;
        const now = this.playback.audioContext.currentTime;
        const absTick = this.timeToAbsTick(now);
        const cycleTicks = Math.max(1, this.playback.cycleTicks || 1);
        const phaseTick = ((absTick % cycleTicks) + cycleTicks) % cycleTicks;
        return phaseTick * this.playback.secondsPerTick * 1000;
    }

    emitTempoChange({ phaseMs = 0 } = {}) {
        const cycleDurationMs = this.playback.cycleDuration * 1000;
        const rawPhase = Number.isFinite(phaseMs) ? phaseMs : 0;
        const safePhase = cycleDurationMs > 0
            ? ((rawPhase % cycleDurationMs) + cycleDurationMs) % cycleDurationMs
            : 0;
        window.dispatchEvent(new CustomEvent('playbackTempoChanged', {
            detail: {
                cycleDurationMs,
                tempo: this.playback.tempo,
                phaseMs: safePhase
            }
        }));
    }

    armTransportBridge() {
        const fullSelection = (this.playback.selectedNotes.size === 0) ||
            (this.playback.availableRatios && this.playback.selectedNotes.size === this.playback.availableRatios.length);

        if (!this.playback.audioContext || !this.playback.isPlaying || this.playback.legatoEnabled || !fullSelection) {
            this.playback.pendingBridgeHold = false;
            this.playback.pendingTempoCleanup = false;
            this.playback.pendingBridgeReleaseTicks = [null, null, null, null];
            if (this.playback.legatoEnabled) {
                console.log('[ToneRowPlayback] Bridge not armed (legato on)');
            } else if (!this.playback.isPlaying) {
                console.log('[ToneRowPlayback] Bridge not armed (not playing)');
            } else if (!fullSelection) {
                console.log('[ToneRowPlayback] Bridge not armed (scale has deselections)');
            } else {
                console.log('[ToneRowPlayback] Bridge not armed (no audio context)');
            }
            return;
        }

        const now = this.playback.audioContext.currentTime;
        const currentAbsTick = this.timeToAbsTick(now);
        const cycleTicks = this.playback.cycleTicks || 1;

        let latest = { tick: -Infinity, layerIndex: null, layerKey: null };
        ['a', 'b', 'c', 'd'].forEach((layerKey, layerIndex) => {
            const lastTick = this.playback.lastNoteTickAbs[layerIndex];
            if (Number.isFinite(lastTick) && lastTick > latest.tick) {
                latest = { tick: lastTick, layerIndex, layerKey };
            }
        });

        if (latest.layerIndex == null) {
            this.playback.pendingBridgeHold = false;
            this.playback.pendingTempoCleanup = false;
            this.playback.pendingBridgeReleaseTicks = [null, null, null, null];
            console.log('[ToneRowPlayback] Bridge not armed: no recent notes found');
            return;
        }

        const events = this.playback.layerEvents[latest.layerIndex] || [];
        let nextAbsTick = null;
        const ticksPerNote = this.playback.lastNotePulseTicks[latest.layerIndex] || (this.playback.cycleTicks / Math.max(1, this.playback.currentRhythms[latest.layerIndex] || 1));
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

        this.playback.pendingBridgeHold = true;
        this.playback.pendingTempoCleanup = true;
        this.playback.pendingBridgeReleaseTicks = [null, null, null, null];
        this.playback.pendingBridgeReleaseTicks[latest.layerIndex] = nextAbsTick;

        if (!this.playback.bridgeVoices[latest.layerIndex]) {
            const voice = this.playback.activeLayerVoices[latest.layerIndex];
            const noteData = voice?.noteData || this.playback.lastNoteByLayer[latest.layerIndex];
            if (noteData) {
                this.playback.startBridgeVoice(latest.layerIndex, noteData, this.playback.layerStates[latest.layerKey]);
                console.log(`[ToneRowPlayback] Bridge voice armed for layer ${latest.layerKey} release at abs tick ${nextAbsTick}`);
            } else {
                console.log(`[ToneRowPlayback] Bridge skipped: no last note for layer ${latest.layerKey}`);
            }
        } else {
            console.log(`[ToneRowPlayback] Bridge voice already active for layer ${latest.layerKey}`);
        }
    }

    scheduleWindow(startAbs, endAbs) {
        const cycle = this.playback.cycleTicks;
        ['a', 'b', 'c', 'd'].forEach((layer, layerIndex) => {
            const events = this.playback.layerEvents[layerIndex] || [];
            if (!events.length) return;

            events.forEach((evt) => {
                const base = evt.startTick;
                const firstCycle = Math.ceil((startAbs - base) / cycle);
                let occTick = base + Math.max(0, firstCycle) * cycle;
                while (occTick < endAbs) {
                    const startTime = this.absTickToTime(occTick);
                    const durationSec = evt.durationTicks * this.playback.secondsPerTick;
                    this.playback.playNoteAtTime(evt.noteData, durationSec, layerIndex, this.playback.layerStates[layer], startTime, occTick);
                    occTick += cycle;
                }
            });
        });
    }
}

window.Scheduler = Scheduler;
