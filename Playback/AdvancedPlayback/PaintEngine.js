// PaintEngine.js — integrates a PaintTimeline with the live ToneRowPlayback engine
// WITHOUT modifying the engine. It wraps playNoteAtTime so that, for each scheduled
// note, the active note selection (playback.selectedNotes) is swapped to the mask of
// the stage the note's tick falls into. The engine's existing per-note mute check
// (isNoteMutedBySelection, evaluated live at schedule time) does the rest.
//
// Engine semantics gotcha: selectedNotes.size === 0 means "no selection -> everything
// audible". So an intentionally SILENT stage cannot use an empty set; we route it to a
// sentinel set that matches no real fraction, muting every note.
//
// Browser only (needs window.toneRowPlayback). window.PaintEngine.

(function (root) {
    'use strict';

    const SILENCE = new Set(['__paint_silence__']);

    class PaintEngine {
        constructor(playback) {
            this.playback = playback;       // ToneRowPlayback instance
            this.timeline = null;           // PaintTimeline
            this.enabled = false;
            this._origPlayNote = null;
            this._snapshot = null;          // user's selectedNotes before painting
            this._maskCache = new Map();    // stageId -> Set
            this._lastStageIndex = -1;
            this._dirty = false;
        }

        setTimeline(timeline) {
            this.timeline = timeline;
            this.markDirty();
            return this;
        }

        // Call when any stage mask changes so the cache rebuilds.
        markDirty() {
            this._dirty = true;
            this._maskCache.clear();
            return this;
        }

        _maskSetForStage(stage) {
            if (!stage) return this._snapshot || new Set();
            let set = this._maskCache.get(stage.id);
            if (!set) {
                set = stage.mask && stage.mask.length ? new Set(stage.mask) : SILENCE;
                this._maskCache.set(stage.id, set);
            }
            return set;
        }

        enable() {
            if (this.enabled) return this;
            const pb = this.playback;
            // snapshot the user's manual selection so we can restore it on disable
            this._snapshot = new Set(pb.selectedNotes);
            this._origPlayNote = pb.playNoteAtTime.bind(pb);
            const self = this;
            pb.playNoteAtTime = function (noteData, duration, layerIndex, layerState, startTime, absTick) {
                self._applyMaskForTick(absTick);
                return self._origPlayNote(noteData, duration, layerIndex, layerState, startTime, absTick);
            };
            this.enabled = true;
            this.markDirty();
            console.log('[PaintEngine] enabled');
            return this;
        }

        disable() {
            if (!this.enabled) return this;
            const pb = this.playback;
            if (this._origPlayNote) pb.playNoteAtTime = this._origPlayNote;
            this._origPlayNote = null;
            // restore the user's manual selection
            if (this._snapshot) pb.selectedNotes = this._snapshot;
            this.enabled = false;
            this._lastStageIndex = -1;
            // resync derived data + scale UI to the restored selection
            try { pb.generateToneRowData(); } catch (e) {}
            try { pb.scaleSelectionUI && pb.scaleSelectionUI.updateScaleDisplay(); } catch (e) {}
            console.log('[PaintEngine] disabled');
            return this;
        }

        _applyMaskForTick(absTick) {
            const pb = this.playback;
            if (!this.timeline || !this.timeline.stages.length || absTick == null) {
                pb.selectedNotes = this._snapshot || pb.selectedNotes;
                return;
            }
            const cycleTicks = pb.cycleTicks || 1;
            const phase = ((absTick % cycleTicks) + cycleTicks) % cycleTicks;
            const frac = phase / cycleTicks;
            const idx = this.timeline.stageIndexAtFraction(frac);
            if (idx !== this._lastStageIndex || this._dirty) {
                this._lastStageIndex = idx;
                this._dirty = false;
            }
            const stage = this.timeline.stages[idx];
            pb.selectedNotes = this._maskSetForStage(stage);
        }

        // Current normalized cycle position [0,1) from the live transport, for the UI playhead.
        currentFraction() {
            const pb = this.playback;
            if (!pb || !pb.scheduler || !pb.isPlaying) return null;
            const ms = pb.scheduler.computeCurrentPhaseMs();
            const cycleMs = (pb.cycleDuration || 0) * 1000;
            if (cycleMs <= 0) return null;
            return (((ms % cycleMs) + cycleMs) % cycleMs) / cycleMs;
        }

        currentStageIndex() {
            const f = this.currentFraction();
            if (f == null || !this.timeline) return -1;
            return this.timeline.stageIndexAtFraction(f);
        }
    }

    if (root) root.PaintEngine = PaintEngine;
})(typeof window !== 'undefined' ? window : null);
