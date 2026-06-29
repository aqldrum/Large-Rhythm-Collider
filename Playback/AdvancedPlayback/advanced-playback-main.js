// advanced-playback-main.js — page controller for the Advanced Playback / Quality
// Painting page. Boots the existing ToneRowPlayback engine headlessly, drives a
// rhythm through LRCModule, and wires the paint timeline (derive / auto-progression
// / paint toggle / transport).

(function () {
    'use strict';

    const App = {
        timeline: null,
        ui: null,
        paintEngine: null,
        ready: false
    };

    const STORAGE_KEY = 'lrc-quality-painting:autosave';

    function $(id) { return document.getElementById(id); }

    function setStatus(msg) { const el = $('ap-status'); if (el) el.textContent = msg; }

    // ---- persistence: autosave to localStorage + shareable ?prog= URL ----
    function currentState() {
        const lm = window.lrcModule;
        return {
            v: 1,
            rhythm: (lm && lm.currentRhythms) ? lm.currentRhythms.slice(0, 4) : [8, 7, 6, 5],
            mode: modeValue(),
            progression: ($('ap-progression') || {}).value || '',
            rootNote: ($('ap-root-note') || {}).value || '',
            timeline: App.timeline ? App.timeline.toJSON() : null
        };
    }

    function encodeState(state) {
        try { return btoa(encodeURIComponent(JSON.stringify(state))); } catch (e) { return null; }
    }
    function decodeState(str) {
        try { return JSON.parse(decodeURIComponent(atob(str))); } catch (e) { return null; }
    }

    let _persistTimer = null;
    function persist() {
        // debounce — paint edits can fire rapidly
        if (_persistTimer) clearTimeout(_persistTimer);
        _persistTimer = setTimeout(() => {
            const state = currentState();
            const enc = encodeState(state);
            if (!enc) return;
            try { localStorage.setItem(STORAGE_KEY, enc); } catch (e) {}
            try {
                const url = new URL(window.location.href);
                url.searchParams.set('prog', enc);
                window.history.replaceState(null, '', url.toString());
            } catch (e) {}
        }, 250);
    }

    // Rebuild the page from a saved state (rhythm + stage timeline).
    function applyState(state) {
        if (!state || !state.rhythm) return false;
        const [a, b, c, d] = state.rhythm;
        $('layer-a').value = a; $('layer-b').value = b; $('layer-c').value = c; $('layer-d').value = d;
        if (state.mode && $('ap-derive-mode')) $('ap-derive-mode').value = state.mode;
        if (state.progression && $('ap-progression')) $('ap-progression').value = state.progression;
        if (state.rootNote && $('ap-root-note')) $('ap-root-note').value = state.rootNote;
        try {
            window.lrcModule.setRhythms(a, b, c, d);
            window.toneRowPlayback.updateData(window.lrcModule.getCurrentData());
        } catch (e) { console.error('[AdvancedPlayback] applyState load failed', e); return false; }
        if (state.timeline && state.timeline.stages && state.timeline.stages.length) {
            App.timeline = window.PaintTimeline.fromJSON(state.timeline);
            App.timeline.setAvailableFractions(allFractions());
        } else {
            App.timeline = buildTimeline(defaultStageCount(window.lrcModule.currentRhythms), modeValue());
        }
        if (App.paintEngine) App.paintEngine.setTimeline(App.timeline);
        if (App.ui) App.ui.setTimeline(App.timeline);
        $('ap-stage-count').value = App.timeline.stages.length;
        setStatus(`Restored ${a}:${b}:${c}:${d} — ${App.timeline.stages.length} stages.`);
        return true;
    }

    function shareLink() {
        persist();
        setTimeout(() => {
            const href = window.location.href;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(href).then(
                    () => setStatus('Share link copied to clipboard.'),
                    () => setStatus('Share link is in the address bar (copy failed).')
                );
            } else { setStatus('Share link is in the address bar.'); }
        }, 300);
    }

    // Available scale as [{fraction, ratio, cents}] from the live LRCModule.
    function getAvailableRatios() {
        const lm = window.lrcModule;
        if (!lm || !lm.currentRatios) return [];
        return lm.currentRatios.map(r => ({ fraction: r.fraction, ratio: r.ratio, cents: r.cents }));
    }

    function allFractions() { return getAvailableRatios().map(r => r.fraction); }

    // smallest layer value > 1 -> fewest, widest stages (sensible harmonic rhythm).
    function defaultStageCount(rhythms) {
        const valid = (rhythms || []).filter(v => v > 1);
        if (!valid.length) return 4;
        return Math.min.apply(null, valid);
    }

    function buildTimeline(stageCount, mode) {
        const t = new window.PaintTimeline();
        t.setAvailableFractions(allFractions());
        if (mode === 'equal') t.deriveEqual(stageCount);
        else t.deriveByPulses(stageCount); // structural default (layer pulse onsets)
        return t;
    }

    function refreshTimelineUI() {
        if (App.ui) App.ui.render();
    }

    // ---- auto progression: assign each stage a named quality drawn from the scale ----
    function autoProgression() {
        const all = getAvailableRatios();
        if (!all.length || !App.timeline) return;
        const QM = window.QualityMatcher;
        // permissive analysis to harvest every catalog quality the scale contains
        const a = QM.analyze(all, { minCardinality: 3, windowCents: 60 });
        // candidate chords: triads/7ths, reasonably in tune, diverse (id+root)
        const seen = new Set();
        let cands = a.all
            .filter(m => m.quality.cardinality >= 3 && m.quality.cardinality <= 4 && m.avgAbsDeviation <= 22)
            .filter(m => { const k = m.quality.id + ':' + m.rootPc; if (seen.has(k)) return false; seen.add(k); return true; });
        // prefer consonant first, then by tuning
        const rank = window.AdvancedQualityCatalog.tierRank;
        cands.sort((x, y) => (rank[x.quality.tier] - rank[y.quality.tier]) || (x.avgAbsDeviation - y.avgAbsDeviation));

        const n = App.timeline.stages.length;
        if (!cands.length) {
            // fallback: rotating 3-degree windows of the scale
            const fr = allFractions();
            for (let i = 0; i < n; i++) {
                const w = [0, 1, 2].map(k => fr[(i + k) % fr.length]).filter(Boolean);
                App.timeline.setStageMask(i, w);
            }
        } else {
            // spread candidates across stages, rotating root to vary the progression
            for (let i = 0; i < n; i++) {
                const m = cands[i % cands.length];
                App.timeline.setStageMask(i, m.members.map(mm => mm.fraction));
            }
        }
        if (App.paintEngine) App.paintEngine.markDirty();
        refreshTimelineUI();
        persist();
        setStatus(`Auto-progression: ${n} stages from ${cands.length} catalog qualities in the scale.`);
    }

    // ---- type a progression, voice it from the current rhythm's tone row ----
    function retuneRoot(candidate) {
        const noteText = ($('ap-root-note').value || 'C3').trim();
        const hz = window.ProgressionSolver.noteToHz(noteText);
        if (!hz) { setStatus('Bad root note: ' + noteText); return null; }
        // chord-1's root is voiced by the solver's tonic-anchor ratio (rootFraction)
        const rootRow = getAvailableRatios().find(r => r.fraction === candidate.rootFraction);
        const rootDecimal = rootRow ? rootRow.ratio : Math.pow(2, candidate.rootCents / 1200);
        let fundamental = hz / rootDecimal;
        while (fundamental < 55) fundamental *= 2;     // keep within the engine's 55–880 Hz range
        while (fundamental > 880) fundamental /= 2;     // by octave-shifting (pitch class preserved)
        window.toneRowPlayback.updateFundamentalFreq(fundamental);
        return fundamental;
    }

    function solveProgression() {
        const text = ($('ap-progression').value || '').trim();
        const scale = getAvailableRatios();
        if (!scale.length) { setStatus('Load a rhythm first.'); return; }
        const res = window.ProgressionSolver.solve(text, scale);
        if (!res.ok) {
            setStatus('Progression: ' + (res.reason === 'parse' ? 'could not parse — check the chord symbols.' : res.reason));
            return;
        }
        // one equal section per chord; each section's mask = that chord's solved tones
        const n = res.perChord.length;
        App.timeline = new window.PaintTimeline();
        App.timeline.setAvailableFractions(allFractions());
        App.timeline.deriveEqual(n);
        res.perChord.forEach((c, i) => App.timeline.setStageMask(i, c.fractions));
        if (App.paintEngine) App.paintEngine.setTimeline(App.timeline);
        if (App.ui) App.ui.setTimeline(App.timeline);
        retuneRoot(res.candidate);
        setPaint(true);
        persist();
        const fits = res.perChord.map(c => Math.round(c.strength * 100) + '%').join(' ');
        setStatus(`Voiced ${n} chords on the ${scale.length}-note row — overall ${(res.strength * 100).toFixed(0)}% fit`
            + `${res.relaxed ? ' (reused tones — row too small to cover it cleanly)' : ''}. Per-chord: ${fits}. Root → ${$('ap-root-note').value}.`);
    }

    // ---- rhythm load ----
    function loadRhythm() {
        const a = parseInt($('layer-a').value) || 1;
        const b = parseInt($('layer-b').value) || 1;
        const c = parseInt($('layer-c').value) || 1;
        const d = parseInt($('layer-d').value) || 1;
        try {
            window.lrcModule.setRhythms(a, b, c, d);  // sets inputs + generateRhythm (current* sync)
            window.toneRowPlayback.updateData(window.lrcModule.getCurrentData());
        } catch (e) {
            console.error('[AdvancedPlayback] loadRhythm failed', e);
            setStatus('Load failed: ' + e.message);
            return;
        }
        const rhythms = window.lrcModule.currentRhythms || [a, b, c, d];
        const count = defaultStageCount(rhythms);
        $('ap-stage-count').value = count;
        App.timeline = buildTimeline(count, modeValue());
        if (App.paintEngine) App.paintEngine.setTimeline(App.timeline);
        if (App.ui) App.ui.setTimeline(App.timeline);
        const ratios = getAvailableRatios();
        persist();
        setStatus(`Loaded ${a}:${b}:${c}:${d} — ${ratios.length} pitches, grid ${window.lrcModule.currentGrid}. ${count} stages (by pulses).`);
    }

    function modeValue() { const el = $('ap-derive-mode'); return el ? el.value : 'pulses'; }

    function deriveStages() {
        if (!getAvailableRatios().length) { setStatus('Load a rhythm first.'); return; }
        const count = Math.max(1, parseInt($('ap-stage-count').value) || 1);
        App.timeline = buildTimeline(count, modeValue());
        if (App.paintEngine) App.paintEngine.setTimeline(App.timeline);
        if (App.ui) App.ui.setTimeline(App.timeline);
        persist();
        setStatus(`Derived ${App.timeline.stages.length} stages (${modeValue()}).`);
    }

    // ---- paint + transport ----
    function setPaint(on) {
        if (!App.paintEngine) return;
        if (on) App.paintEngine.enable(); else App.paintEngine.disable();
        const btn = $('ap-paint-toggle');
        if (btn) { btn.classList.toggle('active', on); btn.textContent = on ? 'Painting: ON' : 'Painting: OFF'; }
    }

    async function togglePlay() {
        const pb = window.toneRowPlayback;
        try {
            await pb.togglePlayback();
        } catch (e) { console.error(e); }
        const btn = $('ap-play');
        if (btn) btn.textContent = pb.isPlaying ? '■ Stop' : '▶ Play';
    }

    // ---- boot ----
    function wire() {
        $('ap-load').addEventListener('click', loadRhythm);
        $('ap-derive').addEventListener('click', deriveStages);
        $('ap-auto').addEventListener('click', autoProgression);
        $('ap-play').addEventListener('click', togglePlay);
        $('ap-paint-toggle').addEventListener('click', () => setPaint(!App.paintEngine.enabled));
        const share = $('ap-share'); if (share) share.addEventListener('click', shareLink);
        const solveBtn = $('ap-solve'); if (solveBtn) solveBtn.addEventListener('click', solveProgression);
        const progInput = $('ap-progression');
        if (progInput) progInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); solveProgression(); } });
        // keep my play label synced if the engine stops on its own
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); togglePlay(); }
        });
    }

    function boot() {
        // Wait for engine globals + generated controls (engine builds UI ~100ms after DOMContentLoaded).
        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            const ok = window.lrcModule && window.toneRowPlayback && window.PaintTimeline &&
                       window.PaintEngine && window.QualityMatcher && $('play-stop-btn');
            if (ok) {
                clearInterval(timer);
                App.paintEngine = new window.PaintEngine(window.toneRowPlayback);
                App.ui = new window.PaintTimelineUI({
                    container: $('ap-timeline'),
                    timeline: null,
                    paintEngine: App.paintEngine,
                    getAvailableRatios: getAvailableRatios,
                    onChange: persist
                });
                wire();
                App.ready = true;
                window.AdvancedPlaybackApp = App;
                // restore: URL ?prog -> localStorage autosave -> default rhythm
                const urlProg = new URLSearchParams(window.location.search).get('prog');
                const saved = urlProg || (function () { try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; } })();
                const restored = saved ? applyState(decodeState(saved)) : false;
                if (!restored) { setStatus('Engine ready.'); loadRhythm(); }
            } else if (tries > 100) {
                clearInterval(timer);
                setStatus('Engine failed to initialise (missing globals). Check console.');
                console.error('[AdvancedPlayback] boot timeout', {
                    lrcModule: !!window.lrcModule, toneRowPlayback: !!window.toneRowPlayback,
                    PaintTimeline: !!window.PaintTimeline, QualityMatcher: !!window.QualityMatcher,
                    playBtn: !!$('play-stop-btn')
                });
            }
        }, 50);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
