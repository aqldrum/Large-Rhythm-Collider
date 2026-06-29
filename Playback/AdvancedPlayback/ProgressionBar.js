// ProgressionBar.js — brings Quality-Painting progressions onto the MAIN Collider
// page. Adds a "Progression Solver" toggle under the Consonance Families section;
// opening it carves a strip above the viz canvas (gated --canvas-top-margin) and
// shows a compact input bar. Solve & voice runs ProgressionSolver against the live
// rhythm's tone row, applies per-section masks to playback via PaintEngine, and
// draws labeled chord BRACKETS over the existing Linear Plot — sections aligned to
// node-index ranges (so they match the index-spaced plot) and draggable.
//
// Inert by default: zero visual change to the main page until the user opens it.
// Reuses ProgressionSolver, PaintEngine, PaintTimeline, QualityMatcher. window.ProgressionBar.

(function (root) {
    'use strict';

    const STRIP_H = 64; // px carved above the canvas for the bracket bar

    const ProgressionBar = {
        open: false,
        _carved: false,
        timeline: null,
        paintEngine: null,
        _raf: null,
        _drag: null,

        init() {
            let tries = 0;
            const t = setInterval(() => {
                tries++;
                const ready = window.toneRowPlayback && window.lrcVisuals && window.lrcModule &&
                    window.ProgressionSolver && window.PaintEngine && window.PaintTimeline &&
                    document.getElementById('interconsonance-families-content');
                if (ready) { clearInterval(t); this._mount(); }
                else if (tries > 200) clearInterval(t);
            }, 80);
        },

        scale() {
            const lm = window.lrcModule;
            return (lm && lm.currentRatios) ? lm.currentRatios.map(r => ({ fraction: r.fraction, ratio: r.ratio, cents: r.cents })) : [];
        },

        _mount() {
            // toggle button injected right after the Consonance Families collapsible
            const cf = document.getElementById('interconsonance-families-content');
            const anchor = cf.parentElement;
            const wrap = document.createElement('div');
            wrap.className = 'prog-section';
            wrap.innerHTML = `
                <button class="prog-toggle" id="prog-toggle">🎹 Progression Solver</button>
                <div class="prog-bar" id="prog-bar" style="display:none">
                    <input type="text" id="prog-input" class="prog-input" value="Cmaj7 Am7 Dm7 G7" placeholder="Cmaj7 Am7 Dm7 G7">
                    <div class="prog-row2">
                        <label>root <input type="text" id="prog-root" class="prog-mini" value="C3"></label>
                        <button class="prog-mini-btn active" id="prog-thick" title="All ratios within the window per chord tone">Thick</button>
                        <input type="number" id="prog-window" class="prog-mini" value="15" min="0" max="60" title="consonance window ¢">
                        <button class="prog-solve" id="prog-solve">Solve &amp; voice</button>
                        <button class="prog-mini-btn" id="prog-clear" title="Clear voicing + restore">Clear</button>
                    </div>
                    <div class="prog-status" id="prog-status"></div>
                </div>
            `;
            anchor.insertAdjacentElement('afterend', wrap);

            // bracket overlay lives in the carved strip over the canvas container
            const host = document.getElementById('lrc-main') || (window.lrcVisuals.canvas && window.lrcVisuals.canvas.parentElement) || document.body;
            const ov = document.createElement('div');
            ov.className = 'prog-brackets';
            ov.id = 'prog-brackets';
            ov.style.display = 'none';
            host.appendChild(ov);
            this.overlay = ov;

            document.getElementById('prog-toggle').addEventListener('click', () => this.toggle());
            document.getElementById('prog-solve').addEventListener('click', () => this.solve());
            document.getElementById('prog-clear').addEventListener('click', () => this.clear());
            const thick = document.getElementById('prog-thick');
            thick.addEventListener('click', () => { thick.classList.toggle('active'); if (this.timeline) this.solve(); });
            document.getElementById('prog-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.solve(); } });
            window.addEventListener('pointermove', e => this._onDragMove(e));
            window.addEventListener('pointerup', () => { if (this._drag) { this._drag = null; } });

            // Watch the viz mode: the brackets only make sense over the Linear Plot, and
            // modes like Hinges don't use playback — so hide the whole feature + uncarve
            // the canvas when not in linear mode, and restore when it returns.
            this._lastMode = null;
            this._modeTimer = setInterval(() => this._watchMode(), 250);
            this._watchMode();
        },

        // Idempotent reconcile (runs on a 250ms poll + on open/close). The brackets only
        // overlay the Linear Plot, and modes like Hinges don't use playback — so the whole
        // feature is gated to linear mode. Cheap section-visibility every poll; the expensive
        // carve + resizeCanvas fire only when the carve state actually flips.
        _watchMode() {
            const linear = (((window.lrcVisuals && window.lrcVisuals.currentPlotType) || 'linear') === 'linear');
            const sec = document.querySelector('.prog-section');
            if (sec) sec.style.display = linear ? '' : 'none';
            const wantCarve = linear && this.open;
            if (wantCarve !== this._carved) {
                this._carved = wantCarve;
                this._setStrip(wantCarve ? STRIP_H : 0);
                this.overlay.style.display = wantCarve ? 'block' : 'none';
                if (wantCarve) this._renderBrackets();
            }
        },

        toggle() { this.open ? this._close() : this._openBar(); },

        _openBar() {
            this.open = true;
            document.getElementById('prog-bar').style.display = 'block';
            document.getElementById('prog-toggle').classList.add('active');
            if (!this._raf) this._loop();
            this._watchMode(); // applies the carve via reconcile
        },
        _close() {
            this.open = false;
            document.getElementById('prog-bar').style.display = 'none';
            document.getElementById('prog-toggle').classList.remove('active');
            this._watchMode(); // uncarves via reconcile
        },
        clear() {
            if (this.paintEngine) this.paintEngine.disable();
            this._lockScale(false);
            this.timeline = null;
            this.selectedSection = 0;
            this.overlay.innerHTML = '';
            const pb = window.toneRowPlayback;
            // restore the full scale: re-select everything (also re-dispatches plot visibility)
            try { pb.scaleSelectionUI && pb.scaleSelectionUI.selectAllNotes(); } catch (e) {}
            const s = document.getElementById('prog-status'); if (s) s.textContent = 'Cleared — scale unlocked, full scale restored.';
        },

        _setStrip(px) {
            document.documentElement.style.setProperty('--canvas-top-margin', px + 'px');
            if (window.lrcVisuals && window.lrcVisuals.resizeCanvas) window.lrcVisuals.resizeCanvas();
        },

        solve() {
            const text = (document.getElementById('prog-input').value || '').trim();
            const scale = this.scale();
            const status = document.getElementById('prog-status');
            if (!scale.length) { status.textContent = 'Generate a rhythm first.'; return; }
            const thick = document.getElementById('prog-thick').classList.contains('active');
            const windowCents = Math.max(0, parseFloat(document.getElementById('prog-window').value) || 15);
            const res = window.ProgressionSolver.solve(text, scale, { windowCents });
            if (!res.ok) { status.textContent = 'Could not parse — check chord symbols.'; return; }

            if (!this.paintEngine) this.paintEngine = new window.PaintEngine(window.toneRowPlayback);
            const n = res.perChord.length;
            this.timeline = new window.PaintTimeline();
            this.timeline.setAvailableFractions(scale.map(r => r.fraction));
            this.timeline.deriveEqual(n);
            res.perChord.forEach((c, i) => this.timeline.setStageMask(i, thick ? c.windowFractions : c.fractions));
            this.paintEngine.setTimeline(this.timeline);
            this.paintEngine.enable();
            this._retune(res.candidate);

            this.selectedSection = 0;
            this._lockScale(true);   // freeze the Scale Selection panel until Clear
            this._paintPlot();       // light each section's nodes per its chord
            this._refreshChart(true);

            const fits = res.perChord.map(c => Math.round(c.strength * 100) + '%').join(' ');
            status.textContent = `${n} chords — ${(res.strength * 100).toFixed(0)}% (${fits}). Scale panel locked; Clear to edit.`;
            this._renderBrackets();
        },

        _retune(candidate) {
            const noteText = (document.getElementById('prog-root').value || 'C3').trim();
            const hz = window.ProgressionSolver.noteToHz(noteText);
            if (!hz) return;
            const rootRow = this.scale().find(r => r.fraction === candidate.rootFraction);
            const rootDecimal = rootRow ? rootRow.ratio : Math.pow(2, candidate.rootCents / 1200);
            let fundamental = hz / rootDecimal;
            while (fundamental < 55) fundamental *= 2;
            while (fundamental > 880) fundamental /= 2;
            window.toneRowPlayback.updateFundamentalFreq(fundamental);
        },

        // Clicking a bracket selects it; the (locked) Scale Selection panel then shows that
        // chord. The plot keeps the whole-progression per-section painting (_paintPlot).
        _selectSection(si) {
            if (!this.timeline || !this.timeline.stages[si]) return;
            this.selectedSection = si;
            this._refreshChart(true);
            this._renderBrackets();
        },

        // Lock/unlock the main Scale Selection panel (display still updates; just not clickable).
        // Locks the chart's whole section so the Select All/None buttons can't override either.
        _lockScale(on) {
            this.locked = on;
            const chart = document.getElementById('scale-chart-container');
            if (chart) {
                chart.classList.toggle('prog-locked', on);
                const section = chart.closest('.collapse-content') || chart.parentElement;
                if (section) section.classList.toggle('prog-locked', on);
            }
            const pc = document.getElementById('partitions-scale-container');
            if (pc) pc.classList.toggle('prog-locked', on);
        },

        _activeSection() {
            const pb = window.toneRowPlayback;
            if (pb && pb.isPlaying && this.paintEngine) {
                const i = this.paintEngine.currentStageIndex();
                if (i >= 0) return i;
            }
            return this.selectedSection || 0;
        },

        // Scale chart follows the active section. Stopped → drive it from the selected
        // section's mask. Playing → read whatever PaintEngine set (no write — avoids
        // fighting the per-note audio masking) so the chart tracks the music live.
        _refreshChart(force) {
            if (!this.timeline) return;
            const pb = window.toneRowPlayback;
            const si = this._activeSection();
            if (!force && si === this._chartSection) return;
            this._chartSection = si;
            if (!pb.isPlaying) {
                const stage = this.timeline.stages[si];
                if (stage) pb.selectedNotes = new Set(stage.mask);
                if (this.paintEngine) this.paintEngine._snapshot = pb.selectedNotes; // keep restore sane
            }
            try { pb.scaleSelectionUI && pb.scaleSelectionUI.updateScaleDisplay(); } catch (e) {}
            try { pb.scaleSelectionUI && pb.scaleSelectionUI.updateSelectedNotesCount(); } catch (e) {}
        },

        // Drive the Linear Plot directly: each visible node is lit iff its OWN section's
        // mask contains its fraction. Dispatched as the engine's own visibility event so
        // LRCVisuals dims the rest. This shows the whole progression and re-toggles live
        // as section boundaries move — independent of the per-note audio selection.
        _paintPlot() {
            if (!this.timeline) return;
            const lm = window.lrcModule;
            const sp = lm.currentSpacesPlot || [], cr = lm.currentCompositeRhythm || [], grid = lm.currentGrid || 1;
            const map = lm.currentSpacesMapping, idxToFrac = [];
            if (map) for (const [f, idxs] of map.entries()) idxs.forEach(i => { idxToFrac[i] = f; });
            const hidden = [];
            for (let i = 0; i < sp.length; i++) {
                const f = idxToFrac[i];
                if (f == null) continue;
                const si = this.timeline.stageIndexAtFraction((cr[i] || 0) / grid);
                const stage = this.timeline.stages[si];
                if (!stage || stage.mask.indexOf(f) < 0) hidden.push(i);
            }
            window.dispatchEvent(new CustomEvent('spacesPlotVisibilityChanged', {
                detail: { hiddenSpacesIndices: hidden, selectedRatios: [], visibleSpacesIndices: [] }
            }));
        },

        // ---- bracket overlay aligned to the Linear Plot's node X positions ----
        _sectionSpans() {
            // group visible plot nodes by paint section -> {si, minX, maxX, label}
            const lv = window.lrcVisuals, lm = window.lrcModule;
            if (!lv || !lv.dotPositions || !this.timeline) return [];
            const cr = lm.currentCompositeRhythm || [], grid = lm.currentGrid || 1;
            const spans = new Map();
            lv.dotPositions.forEach(dot => {
                const t = (cr[dot.index] || 0) / grid;
                const si = this.timeline.stageIndexAtFraction(t);
                if (si < 0) return;
                const s = spans.get(si) || { si, minX: Infinity, maxX: -Infinity };
                s.minX = Math.min(s.minX, dot.x); s.maxX = Math.max(s.maxX, dot.x);
                spans.set(si, s);
            });
            return Array.from(spans.values()).sort((a, b) => a.si - b.si);
        },

        _chordLabel(si) {
            const QM = window.QualityMatcher;
            const stage = this.timeline.stages[si];
            if (!stage || !QM) return '·';
            const maskSet = new Set(stage.mask);
            const active = this.scale().filter(r => maskSet.has(r.fraction));
            const a = QM.analyze(active, { windowCents: 15, minCardinality: 3 });
            return a.primary ? (QM.PC_NAMES[a.primary.rootPc] + a.primary.quality.symbol) : (stage.mask.length ? '·' : '∅');
        },

        _renderBrackets() {
            if (!this.open || !this.timeline) return;
            if (!window.lrcVisuals || window.lrcVisuals.currentPlotType !== 'linear') return;
            const canvas = window.lrcVisuals.canvas;
            const host = this.overlay.parentElement;
            const cRect = canvas.getBoundingClientRect(), hRect = host.getBoundingClientRect();
            const offX = cRect.left - hRect.left; // canvas left within host
            const spans = this._sectionSpans();
            this.overlay.innerHTML = '';
            spans.forEach((s, k) => {
                if (!isFinite(s.minX)) return;
                const left = offX + s.minX, right = offX + s.maxX;
                const br = document.createElement('div');
                br.className = 'prog-bracket' + (s.si === this.selectedSection ? ' sel' : '');
                br.style.left = left + 'px';
                br.style.width = Math.max(8, right - left) + 'px';
                br.innerHTML = `<span class="prog-bracket-label tier-${this._tier(s.si)}">${this._chordLabel(s.si)}</span>`;
                br.addEventListener('click', () => this._selectSection(s.si));
                this.overlay.appendChild(br);
                // draggable boundary handle at the right edge (except last)
                if (k < spans.length - 1) {
                    const h = document.createElement('div');
                    h.className = 'prog-bhandle';
                    h.style.left = (right) + 'px';
                    h.dataset.si = String(s.si);
                    h.addEventListener('pointerdown', e => { e.preventDefault(); this._drag = { si: s.si, offX }; });
                    this.overlay.appendChild(h);
                }
            });
            // playhead
            const ph = document.createElement('div'); ph.className = 'prog-playhead'; ph.id = 'prog-ph'; this.overlay.appendChild(ph);
        },

        _tier(si) {
            const QM = window.QualityMatcher;
            const stage = this.timeline.stages[si];
            const maskSet = new Set(stage.mask);
            const active = this.scale().filter(r => maskSet.has(r.fraction));
            const a = QM ? QM.analyze(active, { windowCents: 15, minCardinality: 3 }) : null;
            return a && a.primary ? a.primary.quality.tier : 'empty';
        },

        _onDragMove(e) {
            if (!this._drag || !this.timeline) return;
            // map mouse X -> cycle fraction via nearest plot node, set the boundary
            const lv = window.lrcVisuals, lm = window.lrcModule;
            const host = this.overlay.parentElement, hRect = host.getBoundingClientRect();
            const localX = e.clientX - hRect.left - this._drag.offX;
            let nearest = null, best = Infinity;
            lv.dotPositions.forEach(dot => { const d = Math.abs(dot.x - localX); if (d < best) { best = d; nearest = dot; } });
            if (!nearest) return;
            const cr = lm.currentCompositeRhythm || [], grid = lm.currentGrid || 1;
            const frac = (cr[nearest.index] || 0) / grid;
            this.timeline.moveBoundary(this._drag.si, frac);
            if (this.paintEngine) this.paintEngine.markDirty();
            this._paintPlot();          // realtime: nodes re-toggle as the boundary moves
            this._refreshChart(true);
            this._renderBrackets();
        },

        _loop() {
            const tick = () => {
                if (this.open && this.timeline) {
                    // follow pan/zoom/resize by re-laying brackets from current dotPositions
                    this._renderBrackets();
                    // scale chart follows the active section live (only re-renders on change)
                    this._refreshChart(false);
                    // playhead
                    const ph = document.getElementById('prog-ph');
                    if (ph && this.paintEngine) {
                        const f = this.paintEngine.currentFraction();
                        const canvas = window.lrcVisuals.canvas, host = this.overlay.parentElement;
                        if (f == null) ph.style.opacity = '0';
                        else {
                            const cRect = canvas.getBoundingClientRect(), hRect = host.getBoundingClientRect();
                            const { padding, plotWidth } = window.lrcVisuals.getLinearPlotMetrics
                                ? window.lrcVisuals.getLinearPlotMetrics(canvas.clientWidth, canvas.clientHeight)
                                : { padding: 40, plotWidth: canvas.clientWidth - 80 };
                            ph.style.opacity = '1';
                            ph.style.left = ((cRect.left - hRect.left) + padding + f * plotWidth) + 'px';
                        }
                    }
                }
                this._raf = requestAnimationFrame(tick);
            };
            this._raf = requestAnimationFrame(tick);
        }
    };

    if (root) root.ProgressionBar = ProgressionBar;
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ProgressionBar.init());
        else ProgressionBar.init();
    }
})(typeof window !== 'undefined' ? window : null);
