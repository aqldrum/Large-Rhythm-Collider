// PaintTimelineUI.js — renders the Quality Painting timeline editor.
// Depends on: PaintTimeline (data), PaintEngine (live mask swap), QualityMatcher.
//
// Layout:
//   [ stage strip ............... ] <- proportional blocks, playhead overlay
//   [ progression readout: II  V  I ... ]
//   [ selected-stage ratio editor | quality analysis panel ]
//
// Browser only. window.PaintTimelineUI.

(function (root) {
    'use strict';

    class PaintTimelineUI {
        constructor(opts) {
            this.container = opts.container;
            this.timeline = opts.timeline;
            this.paintEngine = opts.paintEngine;
            this.getAvailableRatios = opts.getAvailableRatios; // () => [{fraction, ratio, cents}]
            this.getNodes = opts.getNodes;                     // () => [{x, cents, fraction, layers}]
            this.onChange = opts.onChange || function () {};
            this.selectedStage = 0;
            this._build();
        }

        setTimeline(timeline) {
            this.timeline = timeline;
            this.selectedStage = 0;
            if (this.linear) this.linear.setTimeline(timeline);
            this.render();
        }

        _build() {
            this.container.innerHTML = `
                <div class="pt-linear" id="pt-linear"></div>
                <div class="pt-readout" id="pt-readout"></div>
                <div class="pt-editor">
                    <div class="pt-editor-col">
                        <div class="pt-editor-head">
                            <span id="pt-editor-title">Stage —</span>
                            <span class="pt-editor-actions">
                                <button class="pt-btn" id="pt-stage-all">All</button>
                                <button class="pt-btn" id="pt-stage-none">None</button>
                            </span>
                        </div>
                        <div class="pt-ratio-grid" id="pt-ratio-grid"></div>
                    </div>
                    <div class="pt-editor-col pt-quality-col">
                        <div class="pt-editor-head"><span>Quality</span></div>
                        <div class="pt-quality" id="pt-quality"></div>
                    </div>
                </div>
            `;
            this.elReadout = this.container.querySelector('#pt-readout');
            this.elTitle = this.container.querySelector('#pt-editor-title');
            this.elGrid = this.container.querySelector('#pt-ratio-grid');
            this.elQuality = this.container.querySelector('#pt-quality');

            // the Linear Plot is the painting surface (true-time X, pitch Y, draggable sections)
            this.linear = new root.LinearPlotTimeline({
                container: this.container.querySelector('#pt-linear'),
                getNodes: this.getNodes,
                timeline: this.timeline,
                paintEngine: this.paintEngine,
                getSelectedStage: () => this.selectedStage,
                onSelectStage: (i) => { this.selectedStage = i; this.render(); },
                onChange: () => { this.render(); this.onChange(); }
            });

            this.container.querySelector('#pt-stage-all').addEventListener('click', () => {
                this.timeline.setStageMaskAll(this.selectedStage);
                this._afterEdit();
            });
            this.container.querySelector('#pt-stage-none').addEventListener('click', () => {
                this.timeline.setStageMaskNone(this.selectedStage);
                this._afterEdit();
            });
            this.render();
        }

        _afterEdit() {
            if (this.paintEngine) this.paintEngine.markDirty();
            this.render();
            this.onChange();
        }

        _analyzeStage(stage) {
            const all = this.getAvailableRatios() || [];
            const maskSet = new Set(stage.mask);
            const active = all.filter(r => maskSet.has(r.fraction));
            return root.QualityMatcher.analyze(active, { windowCents: 15, minCardinality: 3 });
        }

        render() {
            if (!this.timeline) return;
            const stages = this.timeline.stages;
            // ---- the Linear Plot painting surface ----
            if (this.linear) this.linear.render();
            // ---- readout ----
            this.elReadout.innerHTML = stages.map((s, i) => {
                const a = this._analyzeStage(s);
                const lab = a.primary
                    ? `${root.QualityMatcher.PC_NAMES[a.primary.rootPc]}${a.primary.quality.symbol}`
                    : (s.mask.length ? '?' : '∅');
                return `<span class="pt-chip ${i === this.selectedStage ? 'sel' : ''}">${lab}</span>`;
            }).join('<span class="pt-arrow">→</span>');

            // ---- editor for selected stage ----
            const stage = stages[this.selectedStage];
            if (!stage) { this.elGrid.innerHTML = ''; this.elQuality.innerHTML = ''; return; }
            this.elTitle.textContent = `Stage ${this.selectedStage + 1}`;
            const all = this.getAvailableRatios() || [];
            const maskSet = new Set(stage.mask);
            this.elGrid.innerHTML = all.map(r => {
                const on = maskSet.has(r.fraction);
                return `<button class="pt-ratio ${on ? 'on' : ''}" data-fraction="${r.fraction}">
                            <span class="pt-ratio-frac">${r.fraction}</span>
                            <span class="pt-ratio-cents">${r.cents.toFixed(0)}¢</span>
                        </button>`;
            }).join('');
            this.elGrid.querySelectorAll('.pt-ratio').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.timeline.toggleInStage(this.selectedStage, btn.dataset.fraction);
                    this._afterEdit();
                });
            });
            this._renderQuality(stage);
        }

        _renderQuality(stage) {
            const a = this._analyzeStage(stage);
            if (!a.primary) {
                this.elQuality.innerHTML = `<div class="pt-q-empty">${stage.mask.length ? 'No catalog quality (≥3 notes needed, or unrecognised set)' : 'Silent stage'}</div>`;
                return;
            }
            const p = a.primary;
            const QM = root.QualityMatcher;
            const devTxt = p.avgAbsDeviation <= a.windowCents
                ? `in tune (avg ${p.avgAbsDeviation.toFixed(1)}¢, max ${p.maxAbsDeviation.toFixed(0)}¢)`
                : `avg ${p.avgAbsDeviation.toFixed(1)}¢ off (max ${p.maxAbsDeviation.toFixed(0)}¢)`;
            const others = a.all.slice(1, 6).map(m =>
                `<span class="pt-q-other tier-${m.quality.tier}" title="${m.quality.name} • avg ${m.avgAbsDeviation.toFixed(1)}¢">${QM.PC_NAMES[m.rootPc]}${m.quality.symbol}</span>`
            ).join('');
            this.elQuality.innerHTML = `
                <div class="pt-q-primary tier-${p.quality.tier}">
                    <div class="pt-q-name">${QM.PC_NAMES[p.rootPc]} ${p.quality.name}</div>
                    <div class="pt-q-sub">${p.isExact ? 'exact set' : 'contained'} • ${devTxt}</div>
                </div>
                <div class="pt-q-members">${p.members.map(m =>
                    `<span class="pt-q-mem ${Math.abs(m.deviation) <= a.windowCents ? 'good' : 'off'}">${m.fraction} <em>${m.deviation >= 0 ? '+' : ''}${m.deviation.toFixed(0)}¢</em></span>`
                ).join('')}</div>
                ${others ? `<div class="pt-q-others-head">also present</div><div class="pt-q-others">${others}</div>` : ''}
            `;
        }

        destroy() { if (this.linear) this.linear.destroy(); }
    }

    if (root) root.PaintTimelineUI = PaintTimelineUI;
})(typeof window !== 'undefined' ? window : null);
