// PaintTimeline.js — pure data model for Quality Painting, no DOM.
//
// A Timeline divides one playback cycle [0,1) into contiguous, non-overlapping
// stages. Each stage carries a pitch MASK: the subset of the rhythm's available
// ratio fractions that should sound while the playhead is inside that stage.
// As the Scheduler sweeps the cycle, PaintEngine swaps the active selection to
// the current stage's mask, turning one tone row into a chord progression.
//
// Stage boundaries can be derived from the rhythm's own structure (pulse onsets
// of a chosen layer) so the harmonic rhythm follows the math, or set to N equal
// slices, or edited freely.
//
// Browser: window.PaintTimeline. Node: module.exports.

(function (root) {
    'use strict';

    let _id = 0;
    const nextId = () => `stage_${++_id}`;

    function clampFrac(x) { return Math.max(0, Math.min(1, x)); }

    class PaintTimeline {
        constructor() {
            this.stages = []; // [{ id, startFrac, endFrac, mask:[fraction], label }]
            this.allFractions = []; // the full available scale (fraction strings)
        }

        setAvailableFractions(fractions) {
            this.allFractions = Array.isArray(fractions) ? fractions.slice() : [];
            return this;
        }

        // Replace stages from an array of boundary fractions in [0,1).
        // boundaries=[0, 0.25, 0.5, 0.75] -> 4 stages. A leading 0 is implied.
        _stagesFromBoundaries(boundaries, fillMask) {
            const bs = Array.from(new Set(boundaries.map(clampFrac))).sort((a, b) => a - b);
            if (bs[0] !== 0) bs.unshift(0);
            const stages = [];
            for (let i = 0; i < bs.length; i++) {
                const start = bs[i];
                const end = (i + 1 < bs.length) ? bs[i + 1] : 1;
                if (end - start < 1e-9) continue; // skip zero-width
                stages.push({
                    id: nextId(),
                    startFrac: start,
                    endFrac: end,
                    mask: (fillMask || this.allFractions).slice(),
                    label: null
                });
            }
            this.stages = stages;
            return this;
        }

        // N equal slices, each defaulting to the full scale.
        deriveEqual(n) {
            n = Math.max(1, Math.floor(n));
            const boundaries = [];
            for (let i = 0; i < n; i++) boundaries.push(i / n);
            return this._stagesFromBoundaries(boundaries);
        }

        // Stage boundaries at each pulse onset of a layer with `pulses` evenly spaced
        // attacks (i.e. one stage per pulse). This ties harmonic rhythm to the layer's
        // own subdivision — the structural default.
        deriveByPulses(pulses) {
            pulses = Math.max(1, Math.floor(pulses));
            const boundaries = [];
            for (let i = 0; i < pulses; i++) boundaries.push(i / pulses);
            return this._stagesFromBoundaries(boundaries);
        }

        // Stage boundaries from an explicit, already-normalised list of onset fractions
        // (e.g. Euclidean hit positions over the cycle). Each onset starts a new stage.
        deriveByOnsets(onsetFractions) {
            const bs = (onsetFractions || []).map(clampFrac);
            if (!bs.length) return this.deriveEqual(1);
            return this._stagesFromBoundaries(bs);
        }

        // ---- queries ----

        stageIndexAtFraction(frac) {
            const f = ((frac % 1) + 1) % 1;
            for (let i = 0; i < this.stages.length; i++) {
                const s = this.stages[i];
                const end = (i === this.stages.length - 1) ? 1.0000001 : s.endFrac;
                if (f >= s.startFrac && f < end) return i;
            }
            return this.stages.length ? this.stages.length - 1 : -1;
        }

        stageAtFraction(frac) {
            const i = this.stageIndexAtFraction(frac);
            return i >= 0 ? this.stages[i] : null;
        }

        getStageMaskSet(i) {
            const s = this.stages[i];
            return s ? new Set(s.mask) : new Set();
        }

        // ---- edits ----

        setStageMask(i, maskArray) {
            if (this.stages[i]) {
                this.stages[i].mask = Array.isArray(maskArray) ? maskArray.slice() : [];
                this.stages[i].label = null; // invalidate cached label
            }
            return this;
        }

        toggleInStage(i, fraction) {
            const s = this.stages[i];
            if (!s) return this;
            const idx = s.mask.indexOf(fraction);
            if (idx >= 0) s.mask.splice(idx, 1);
            else s.mask.push(fraction);
            s.label = null;
            return this;
        }

        setStageMaskAll(i) { return this.setStageMask(i, this.allFractions); }
        setStageMaskNone(i) { return this.setStageMask(i, []); }

        // Move the boundary between stage i and i+1 to fraction f.
        moveBoundary(i, f) {
            if (i < 0 || i >= this.stages.length - 1) return this;
            const lo = this.stages[i].startFrac;
            const hi = this.stages[i + 1].endFrac;
            const nf = Math.max(lo + 1e-3, Math.min(hi - 1e-3, clampFrac(f)));
            this.stages[i].endFrac = nf;
            this.stages[i + 1].startFrac = nf;
            return this;
        }

        // Split stage i at fraction f (absolute, within the stage).
        splitStage(i, f) {
            const s = this.stages[i];
            if (!s) return this;
            const nf = clampFrac(f);
            if (nf <= s.startFrac + 1e-3 || nf >= s.endFrac - 1e-3) return this;
            const right = { id: nextId(), startFrac: nf, endFrac: s.endFrac, mask: s.mask.slice(), label: null };
            s.endFrac = nf;
            this.stages.splice(i + 1, 0, right);
            return this;
        }

        mergeWithNext(i) {
            if (i < 0 || i >= this.stages.length - 1) return this;
            this.stages[i].endFrac = this.stages[i + 1].endFrac;
            this.stages[i].label = null;
            this.stages.splice(i + 1, 1);
            return this;
        }

        // ---- serialization ----

        toJSON() {
            return {
                version: 1,
                allFractions: this.allFractions.slice(),
                stages: this.stages.map(s => ({
                    startFrac: s.startFrac, endFrac: s.endFrac, mask: s.mask.slice(), label: s.label || null,
                    chordSymbol: s.chordSymbol || null, chordTier: s.chordTier || null
                }))
            };
        }

        static fromJSON(obj) {
            const t = new PaintTimeline();
            if (!obj) return t;
            t.allFractions = Array.isArray(obj.allFractions) ? obj.allFractions.slice() : [];
            t.stages = (obj.stages || []).map(s => ({
                id: nextId(),
                startFrac: clampFrac(s.startFrac),
                endFrac: clampFrac(s.endFrac),
                mask: Array.isArray(s.mask) ? s.mask.slice() : [],
                label: s.label || null,
                chordSymbol: s.chordSymbol || null,
                chordTier: s.chordTier || null
            }));
            return t;
        }
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = PaintTimeline;
    if (root) root.PaintTimeline = PaintTimeline;
})(typeof window !== 'undefined' ? window : null);
