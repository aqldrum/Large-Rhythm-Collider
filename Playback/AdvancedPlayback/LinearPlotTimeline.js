// LinearPlotTimeline.js — the painting surface: the Linear Plot laid out on a
// true-time X axis with pitch on Y, chopped into paint sections.
//
//   X = compositeRhythm[i]/grid  (real cycle time — so a section divider cuts
//       exactly where notes actually sound, matching the scheduler's tick phase)
//   Y = ratio cents              (pitch; every instance of a fraction shares a row,
//       so a section's active pitches read as clean horizontal bands)
//   colour = layer (A/B/C/D)     (mirrors the live Linear Plot)
//
// Nodes are drawn on a canvas; section dividers, chord labels and the playhead are
// DOM overlays. Click a node to toggle its tone in that section; drag a divider to
// move a boundary; click empty band to select it. Browser: window.LinearPlotTimeline.

(function (root) {
    'use strict';

    const PAD = { l: 10, r: 10, t: 10, b: 22 };
    const LAYER_COLORS = { A: '#ff6b6b', B: '#4ecdc4', C: '#00a638', D: '#f9ca24' };

    class LinearPlotTimeline {
        constructor(opts) {
            this.container = opts.container;
            this.getNodes = opts.getNodes;             // () => [{x:0..1, cents, fraction, layers:[]}]
            this.timeline = opts.timeline;             // PaintTimeline
            this.paintEngine = opts.paintEngine;
            this.getSelectedStage = opts.getSelectedStage || (() => 0);
            this.onSelectStage = opts.onSelectStage || function () {};
            this.onChange = opts.onChange || function () {};
            this._nodeHits = [];
            this._drag = null;
            this._raf = null;
            this._build();
        }

        setTimeline(t) { this.timeline = t; this.render(); }

        _build() {
            this.container.classList.add('lpt');
            this.container.innerHTML = `
                <div class="lpt-labels"></div>
                <div class="lpt-plot">
                    <canvas class="lpt-canvas"></canvas>
                    <div class="lpt-overlay"></div>
                </div>
            `;
            this.elLabels = this.container.querySelector('.lpt-labels');
            this.elPlot = this.container.querySelector('.lpt-plot');
            this.canvas = this.container.querySelector('.lpt-canvas');
            this.elOverlay = this.container.querySelector('.lpt-overlay');
            this.ctx = this.canvas.getContext('2d');

            this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
            this.canvas.addEventListener('pointermove', (e) => this._onPointerHover(e));
            window.addEventListener('pointermove', (e) => this._onDragMove(e));
            window.addEventListener('pointerup', () => this._onDragEnd());
            window.addEventListener('resize', () => this.render());

            this.render();
            this._startPlayheadLoop();
        }

        _metrics() {
            const cssW = this.elPlot.clientWidth || 600;
            const cssH = this.elPlot.clientHeight || 200;
            return { cssW, cssH, plotW: cssW - PAD.l - PAD.r, plotH: cssH - PAD.t - PAD.b };
        }
        _xOf(frac, m) { return PAD.l + frac * m.plotW; }
        _yOf(cents, m) { return PAD.t + (1 - (cents % 1200) / 1200) * m.plotH; }
        _fracOfClientX(clientX) {
            const rect = this.canvas.getBoundingClientRect();
            const m = this._metrics();
            return Math.max(0, Math.min(1, (clientX - rect.left - PAD.l) / m.plotW));
        }

        render() {
            if (!this.timeline) return;
            const m = this._metrics();
            // size canvas for devicePixelRatio crispness
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = Math.round(m.cssW * dpr);
            this.canvas.height = Math.round(m.cssH * dpr);
            this.canvas.style.width = m.cssW + 'px';
            this.canvas.style.height = m.cssH + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this._draw(m);
            this._layoutLabels(m);
            this._layoutDividers(m);
        }

        _draw(m) {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, m.cssW, m.cssH);
            const stages = this.timeline.stages;
            const sel = this.getSelectedStage();

            // section background bands + boundary lines
            stages.forEach((s, i) => {
                const x0 = this._xOf(s.startFrac, m), x1 = this._xOf(s.endFrac, m);
                ctx.fillStyle = i === sel ? 'rgba(0,255,136,0.07)' : (i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)');
                ctx.fillRect(x0, PAD.t, x1 - x0, m.plotH);
            });
            // pitch gridlines (octave + fifth + fourth reference)
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            [0, 300, 500, 700, 900, 1200].forEach(c => {
                const y = this._yOf(c, m);
                ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + m.plotW, y); ctx.stroke();
            });

            // nodes
            const nodes = this.getNodes() || [];
            this._nodeHits = [];
            nodes.forEach(n => {
                const si = this.timeline.stageIndexAtFraction(n.x);
                const stage = this.timeline.stages[si];
                const active = stage && stage.mask.indexOf(n.fraction) >= 0;
                const sx = this._xOf(n.x, m), sy = this._yOf(n.cents, m);
                const layer = (n.layers && n.layers[0]) || 'A';
                const base = LAYER_COLORS[layer] || '#aaa';
                const r = active ? 5 : 3;
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.fillStyle = active ? base : this._dim(base);
                ctx.fill();
                if (active && n.layers && n.layers.length > 1) { // multi-layer coincidence ring
                    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(sx, sy, r + 2, 0, Math.PI * 2); ctx.stroke();
                }
                this._nodeHits.push({ sx, sy, r: r + 4, node: n, stageIndex: si });
            });
        }

        _dim(hex) {
            const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
            if (!m) return 'rgba(120,120,120,0.28)';
            return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0.22)`;
        }

        _layoutLabels(m) {
            const QM = root.QualityMatcher;
            const all = this._availableRatios();
            this.elLabels.innerHTML = '';
            this.timeline.stages.forEach((s, i) => {
                const mid = (s.startFrac + s.endFrac) / 2;
                const maskSet = new Set(s.mask);
                const active = all.filter(r => maskSet.has(r.fraction));
                const a = QM ? QM.analyze(active, { windowCents: 15, minCardinality: 3 }) : null;
                const lab = a && a.primary ? (QM.PC_NAMES[a.primary.rootPc] + a.primary.quality.symbol) : (s.mask.length ? '·' : '∅');
                const tier = a && a.primary ? a.primary.quality.tier : 'empty';
                const el = document.createElement('div');
                el.className = 'lpt-label tier-' + tier + (i === this.getSelectedStage() ? ' sel' : '');
                el.style.left = (this._xOf(mid, m)) + 'px';
                el.textContent = lab;
                el.addEventListener('click', () => { this.onSelectStage(i); });
                this.elLabels.appendChild(el);
            });
        }

        _availableRatios() {
            // derive {fraction,cents} list from current nodes (deduped) for quality labelling
            const seen = new Map();
            (this.getNodes() || []).forEach(n => { if (!seen.has(n.fraction)) seen.set(n.fraction, { fraction: n.fraction, cents: n.cents, ratio: Math.pow(2, n.cents / 1200) }); });
            return Array.from(seen.values());
        }

        _layoutDividers(m) {
            this.elOverlay.innerHTML = '';
            const stages = this.timeline.stages;
            for (let i = 0; i < stages.length - 1; i++) {
                const x = this._xOf(stages[i].endFrac, m);
                const d = document.createElement('div');
                d.className = 'lpt-divider';
                d.style.left = x + 'px';
                d.dataset.i = String(i);
                d.addEventListener('pointerdown', (e) => { e.stopPropagation(); this._drag = { type: 'divider', i }; });
                this.elOverlay.appendChild(d);
            }
            const ph = document.createElement('div');
            ph.className = 'lpt-playhead';
            this.elOverlay.appendChild(ph);
            this._playhead = ph;
        }

        _onPointerDown(e) {
            // node toggle or band select
            const rect = this.canvas.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            let hit = null, best = 1e9;
            for (const h of this._nodeHits) {
                const dd = (px - h.sx) ** 2 + (py - h.sy) ** 2;
                if (dd <= h.r * h.r && dd < best) { best = dd; hit = h; }
            }
            if (hit) {
                this.timeline.toggleInStage(hit.stageIndex, hit.node.fraction);
                if (this.paintEngine) this.paintEngine.markDirty();
                this.render();
                this.onChange();
            } else {
                const frac = this._fracOfClientX(e.clientX);
                const si = this.timeline.stageIndexAtFraction(frac);
                if (si >= 0) this.onSelectStage(si);
            }
        }

        _onPointerHover(e) {
            const rect = this.canvas.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            let over = false;
            for (const h of this._nodeHits) { if ((px - h.sx) ** 2 + (py - h.sy) ** 2 <= h.r * h.r) { over = true; break; } }
            this.canvas.style.cursor = over ? 'pointer' : 'default';
        }

        _onDragMove(e) {
            if (!this._drag) return;
            if (this._drag.type === 'divider') {
                const frac = this._fracOfClientX(e.clientX);
                this.timeline.moveBoundary(this._drag.i, frac);
                if (this.paintEngine) this.paintEngine.markDirty();
                this.render();
            }
        }
        _onDragEnd() {
            if (this._drag) { this._drag = null; this.onChange(); }
        }

        _startPlayheadLoop() {
            const loop = () => {
                if (this._playhead && this.paintEngine) {
                    const f = this.paintEngine.currentFraction();
                    const m = this._metrics();
                    if (f == null) this._playhead.style.opacity = '0';
                    else { this._playhead.style.opacity = '1'; this._playhead.style.left = this._xOf(f, m) + 'px'; }
                }
                this._raf = requestAnimationFrame(loop);
            };
            this._raf = requestAnimationFrame(loop);
        }
        destroy() { if (this._raf) cancelAnimationFrame(this._raf); }
    }

    if (root) root.LinearPlotTimeline = LinearPlotTimeline;
})(typeof window !== 'undefined' ? window : null);
