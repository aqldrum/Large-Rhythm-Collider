// ProgressionSolver.js — type a chord progression, voice it from the CURRENT
// rhythm's tone row. Ported from Overworld econ/runtime/progression-optimizer.js
// (de-moduled to the popout's global style; engine logic preserved verbatim).
//
// The solver does NOT touch the Codex/registry — the caller hands it the live
// rhythm's ratio set as the pool. It parses jazz chord symbols, flattens the
// progression to a required pitch-class set, then beam-searches the pool for one
// ratio per pitch class so the cent-INTERVALS between chosen tones best match the
// 12-TET intervals the chords demand. analyzePerChord() projects the global
// assignment down to each chord → that chord's tone subset = a paint-section mask.
//
// No Hz here (the engine is relative/cents only); the controller maps the chosen
// root ratio to the live Fundamental (Hz) control. Browser: window.ProgressionSolver.

(function (root) {
    'use strict';

    const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const toFinite = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
    const mod12 = v => ((Math.trunc(toFinite(v, 0)) % 12) + 12) % 12;
    const mod1200 = v => ((toFinite(v, 0) % 1200) + 1200) % 1200;
    const minCircularDistance = (a, b) => { const d = Math.abs(mod1200(a) - mod1200(b)); return Math.min(d, 1200 - d); };

    const normalizeAccidentals = v => String(v ?? '')
        .replaceAll('♯', '#').replaceAll('♭', 'b').replaceAll('𝄪', '##').replaceAll('𝄫', 'bb');
    const normalizeChordSuffix = v => normalizeAccidentals(v)
        .replaceAll('Δ', 'maj').replaceAll('∆', 'maj').replaceAll('−', 'm').replaceAll('–', 'm')
        .replaceAll('-', 'm').replaceAll('°', 'dim').replaceAll('ø', 'm7b5').replace(/[()\[\]\s]/g, '');

    function degreeBaseSemitone(d) {
        const n = Number(d);
        if (n === 1) return 0;
        if (n === 2 || n === 9) return 2;
        if (n === 3 || n === 10) return 4;
        if (n === 4 || n === 11) return 5;
        if (n === 5 || n === 12) return 7;
        if (n === 6 || n === 13) return 9;
        if (n === 7 || n === 14) return 11;
        return null;
    }
    function alteredDegreeSemitone(acc, degree) {
        const base = degreeBaseSemitone(degree);
        if (base === null) return null;
        const delta = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
        return mod12(base + delta);
    }
    const addInterval = (set, i) => set.add(mod12(i));
    function removeDegree(set, degree) {
        const n = Number(degree);
        if (n === 3 || n === 10) { set.delete(3); set.delete(4); }
        else if (n === 5 || n === 12) { set.delete(6); set.delete(7); set.delete(8); }
        else if (n === 7 || n === 14) { set.delete(9); set.delete(10); set.delete(11); }
        else if (n === 9 || n === 2) { set.delete(1); set.delete(2); set.delete(3); }
        else if (n === 11 || n === 4) { set.delete(5); set.delete(6); }
        else if (n === 13 || n === 6) { set.delete(8); set.delete(9); }
    }
    function addSeventh(set, { majorSeventh = false, diminishedSeventh = false } = {}) {
        if (majorSeventh) addInterval(set, 11);
        else if (diminishedSeventh) addInterval(set, 9);
        else addInterval(set, 10);
    }
    function parseNoteName(value) {
        const m = normalizeAccidentals(value).match(/^([A-Ga-g])([#b]{0,2})$/);
        if (!m) return null;
        const letter = m[1].toUpperCase();
        const acc = m[2] || '';
        let pc = NOTE_BASE[letter];
        for (const ch of acc) pc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
        return { name: `${letter}${acc}`, pc: mod12(pc) };
    }
    const pitchClassName = v => PITCH_CLASS_NAMES[mod12(v)];

    function shouldAddSlashBassFifth(baseIntervals, rootPc, slashBassPc) {
        return baseIntervals.includes(11) && mod12(slashBassPc - rootPc) === 2;
    }

    function resolveChordIntervals(rawSuffix = '') {
        const suffix = normalizeChordSuffix(rawSuffix);
        const lower = suffix.toLowerCase();
        const structural = lower
            .replace(/add[#b]?(?:2|4|9|11|13)/g, '')
            .replace(/[b#](?:5|9|11|13)/g, '')
            .replace(/(?:no|omit)(?:3|5|7|9|11|13)/g, '');
        const set = new Set();
        const isHalfDim = /^(m7b5|halfdim)/.test(lower);
        const isDim = !isHalfDim && /^(dim|o)/.test(lower);
        const isAug = /^(aug|\+)/.test(lower) || lower.startsWith('+');
        const isSus2 = /sus2/.test(lower);
        const isSus = !isSus2 && /sus/.test(lower);
        const isPower = structural === '5';
        const isMinor = !isHalfDim && !isDim && /^(m|min|mi)(?!aj)/.test(lower);
        if (isHalfDim) [0, 3, 6, 10].forEach(i => addInterval(set, i));
        else if (isDim) [0, 3, 6].forEach(i => addInterval(set, i));
        else if (isAug) [0, 4, 8].forEach(i => addInterval(set, i));
        else if (isSus2) [0, 2, 7].forEach(i => addInterval(set, i));
        else if (isSus) [0, 5, 7].forEach(i => addInterval(set, i));
        else if (isPower) [0, 7].forEach(i => addInterval(set, i));
        else if (isMinor) [0, 3, 7].forEach(i => addInterval(set, i));
        else [0, 4, 7].forEach(i => addInterval(set, i));

        const hasMajorSeventh = /maj(?:7|9|11|13)/.test(lower) || /mmaj(?:7|9|11|13)/.test(lower);
        const hasDimSeventh = isDim && /7/.test(structural);
        const has69 = /69/.test(structural);
        const has13 = /13/.test(structural);
        const has11 = /11/.test(structural);
        const has9 = /9/.test(structural);
        const has7 = /7/.test(structural);
        const has6 = /6/.test(structural);
        if (has69) { addInterval(set, 2); addInterval(set, 9); }
        else if (has13) { addSeventh(set, { majorSeventh: hasMajorSeventh, diminishedSeventh: hasDimSeventh }); addInterval(set, 2); addInterval(set, 9); }
        else if (has11) { addSeventh(set, { majorSeventh: hasMajorSeventh, diminishedSeventh: hasDimSeventh }); addInterval(set, 2); addInterval(set, 5); }
        else if (has9) { addSeventh(set, { majorSeventh: hasMajorSeventh, diminishedSeventh: hasDimSeventh }); addInterval(set, 2); }
        else if (has7) { addSeventh(set, { majorSeventh: hasMajorSeventh, diminishedSeventh: hasDimSeventh }); }
        else if (has6) { addInterval(set, 9); }

        for (const m of lower.matchAll(/add([#b]?)(2|4|9|11|13)/g)) {
            const s = alteredDegreeSemitone(m[1], m[2]);
            if (s !== null) addInterval(set, s);
        }
        for (const m of lower.matchAll(/([#b])(5|9|11|13)/g)) {
            const acc = m[1], degree = m[2];
            const s = alteredDegreeSemitone(acc, degree);
            if (s === null) continue;
            if (degree === '5') removeDegree(set, 5);
            else if (degree === '9') set.delete(2);
            else if (degree === '11') set.delete(5);
            else if (degree === '13') set.delete(9);
            addInterval(set, s);
        }
        for (const m of lower.matchAll(/(?:no|omit)(3|5|7|9|11|13)/g)) removeDegree(set, m[1]);
        return Array.from(set).sort((a, b) => a - b);
    }

    function parseChordSymbol(rawSymbol) {
        const original = String(rawSymbol ?? '').trim();
        if (!original) return { ok: false, symbol: original, error: 'empty chord symbol' };
        let text = normalizeAccidentals(original).replace(/6\/9/ig, '69');
        const slashParts = text.split('/');
        if (slashParts.length > 2 || !slashParts[0]) return { ok: false, symbol: original, error: 'invalid slash chord' };
        text = slashParts[0];
        const slashBass = slashParts[1] ? parseNoteName(slashParts[1]) : null;
        if (slashParts[1] && !slashBass) return { ok: false, symbol: original, error: 'invalid slash bass' };
        const m = text.match(/^([A-Ga-g])([#b]{0,2})(.*)$/);
        if (!m) return { ok: false, symbol: original, error: 'missing note root' };
        const letter = m[1].toUpperCase();
        const acc = m[2] || '';
        const suffix = normalizeChordSuffix(m[3] || '');
        let rootPc = NOTE_BASE[letter];
        for (const ch of acc) rootPc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
        rootPc = mod12(rootPc);
        const baseIntervals = resolveChordIntervals(suffix);
        const pcSet = new Set(baseIntervals.map(i => mod12(rootPc + i)));
        if (slashBass) {
            pcSet.add(slashBass.pc);
            if (shouldAddSlashBassFifth(baseIntervals, rootPc, slashBass.pc)) pcSet.add(mod12(slashBass.pc + 7));
        }
        const intervals = Array.from(pcSet).map(pc => mod12(pc - rootPc)).sort((a, b) => a - b);
        return {
            ok: true, symbol: original,
            rootName: `${letter}${acc}`, rootPc,
            slashBassName: slashBass?.name || null, slashBassPc: slashBass?.pc ?? null,
            suffix, baseIntervals, intervals,
            pitchClasses: intervals.map(i => mod12(rootPc + i))
        };
    }

    function tokenizeProgression(input) {
        return String(input ?? '').replace(/[|,;\n\r\t]+/g, ' ').split(/\s+/).map(t => t.trim()).filter(Boolean);
    }

    function parseProgression(input, options = {}) {
        const tokens = tokenizeProgression(input);
        const chords = [], errors = [];
        tokens.forEach((token, index) => {
            const parsed = parseChordSymbol(token);
            if (!parsed.ok) { errors.push({ token, index, error: parsed.error }); return; }
            chords.push({ ...parsed, index });
        });
        if (!chords.length) {
            return { ok: false, chords, errors: errors.length ? errors : [{ token: '', index: 0, error: 'no chord symbols parsed' }], requiredSemitones: [], referencePc: 0 };
        }
        const referencePc = options.reference === 'absolute-c' ? 0 : chords[0].rootPc;
        const requiredSet = new Set();
        const normalizedChords = chords.map(chord => {
            const tones = chord.pitchClasses.map(pc => mod12(pc - referencePc));
            tones.forEach(s => requiredSet.add(s));
            return { ...chord, rootSemitone: mod12(chord.rootPc - referencePc), relativeTones: Array.from(new Set(tones)).sort((a, b) => a - b) };
        });
        return {
            ok: errors.length === 0, chords: normalizedChords, errors, referencePc,
            referenceName: pitchClassName(referencePc),
            requiredSemitones: Array.from(requiredSet).sort((a, b) => a - b)
        };
    }

    // Build the solver's ratio rows from the live rhythm's scale [{fraction, ratio, cents}].
    function buildRatioRows(scale) {
        const rows = (scale || []).map(r => ({
            fraction: r.fraction,
            ratioId: `ratio:${r.fraction}`,
            ratio: r.ratio,
            cents: r.cents,
            centsMod: mod1200(r.cents),
            overallRhythmCount: 0,
            motherScaleCount: 0
        }));
        rows.sort((a, b) => a.centsMod - b.centsMod || a.fraction.localeCompare(b.fraction, undefined, { numeric: true }));
        rows.forEach((row, i) => { row.idx = i; });
        return rows;
    }

    function insertTopCandidate(top, cand, limit) {
        top.push(cand);
        top.sort((a, b) => a.deviation - b.deviation || a.ratioRow.fraction.localeCompare(b.ratioRow.fraction, undefined, { numeric: true }));
        if (top.length > limit) top.length = limit;
    }
    function buildTopKDistanceTable(ratios, semitones, topK = 1) {
        const clean = Array.from(new Set((semitones || []).map(mod12))).sort((a, b) => a - b);
        const depth = clamp(Math.trunc(toFinite(topK, 1)), 1, 12);
        const table = Array.from({ length: ratios.length }, () => Array.from({ length: 12 }, () => null));
        for (let rootIdx = 0; rootIdx < ratios.length; rootIdx++) {
            const r = ratios[rootIdx];
            for (const semitone of clean) {
                const targetCents = mod1200(r.cents + semitone * 100);
                const top = [];
                for (let ci = 0; ci < ratios.length; ci++) {
                    const row = ratios[ci];
                    insertTopCandidate(top, {
                        semitone, idx: ci, ratioRow: row, cents: row.cents, centsMod: row.centsMod,
                        targetCents, deviation: minCircularDistance(row.cents, targetCents),
                        relativeCents: mod1200(row.cents - r.cents)
                    }, depth);
                }
                table[rootIdx][semitone] = top;
            }
        }
        return table;
    }
    const createRootCandidate = (r, semitone = 0) => ({ semitone, idx: r.idx, ratioRow: r, cents: r.cents, centsMod: r.centsMod, targetCents: r.centsMod, deviation: 0, relativeCents: 0 });
    function pairDeviation(from, to) {
        return minCircularDistance(mod1200(to.cents - from.cents), mod1200((to.semitone - from.semitone) * 100));
    }
    function extendState(state, candidate, allowReuse) {
        let pairDeviationSum = state.pairDeviationSum, pairCount = state.pairCount;
        let maxDeviation = Math.max(state.maxDeviation, candidate.deviation);
        for (const existing of state.matches) {
            const d = pairDeviation(existing, candidate);
            pairDeviationSum += d; pairCount += 1; maxDeviation = Math.max(maxDeviation, d);
        }
        const used = allowReuse ? state.used : new Set(state.used);
        if (!allowReuse) used.add(candidate.idx);
        return { matches: state.matches.concat(candidate), used, singleDeviationSum: state.singleDeviationSum + candidate.deviation, pairDeviationSum, pairCount, maxDeviation };
    }
    function partialCost(state) {
        const mc = state.matches.length || 1;
        const pairAvg = state.pairCount > 0 ? state.pairDeviationSum / state.pairCount : state.singleDeviationSum / mc;
        return pairAvg + (state.singleDeviationSum / mc) * 0.12 + state.maxDeviation * 0.025;
    }
    function finalScore(state) {
        const mc = state.matches.length || 1;
        const avgDeviation = state.pairCount > 0 ? state.pairDeviationSum / state.pairCount : state.singleDeviationSum / mc;
        const targetAvgDeviation = state.singleDeviationSum / mc;
        return { avgDeviation, targetAvgDeviation, maxDeviation: state.maxDeviation, pairCount: state.pairCount, strength: clamp(1 - avgDeviation / 50, 0, 1), targetStrength: clamp(1 - targetAvgDeviation / 50, 0, 1) };
    }
    function compareFinalStates(a, b) {
        const sa = finalScore(a), sb = finalScore(b);
        return sb.strength - sa.strength || sa.avgDeviation - sb.avgDeviation || sa.maxDeviation - sb.maxDeviation || sa.targetAvgDeviation - sb.targetAvgDeviation;
    }
    function finalizeCandidate(root, state) {
        const score = finalScore(state);
        const matches = state.matches.slice().sort((a, b) => a.semitone - b.semitone).map(m => ({
            semitone: m.semitone, noteName: pitchClassName(m.semitone), ratioId: m.ratioRow.ratioId, fraction: m.ratioRow.fraction,
            cents: m.ratioRow.cents, centsMod: m.ratioRow.centsMod, relativeCents: mod1200(m.ratioRow.cents - root.cents),
            targetCents: mod1200(m.semitone * 100), deviation: minCircularDistance(mod1200(m.ratioRow.cents - root.cents), m.semitone * 100)
        }));
        return { rootRatioId: root.ratioId, rootFraction: root.fraction, rootCents: root.cents, rootCentsMod: root.centsMod, ...score, ratioTypes: matches.length, matches, signature: matches.slice().sort((a, b) => a.semitone - b.semitone).map(m => `${m.semitone}:${m.fraction}`).join('|') };
    }
    function optimizeRoot(rootIdx, ratios, requiredSemitones, table, options = {}) {
        const r = ratios[rootIdx];
        const beamWidth = clamp(Math.trunc(toFinite(options.beamWidth, 8)), 1, 1000);
        const allowReuse = !!options.allowReuse;
        const semitones = requiredSemitones.slice().sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
        let beam = [{ matches: [], used: new Set(), singleDeviationSum: 0, pairDeviationSum: 0, pairCount: 0, maxDeviation: 0 }];
        for (const semitone of semitones) {
            const candidates = semitone === 0 ? [createRootCandidate(r, semitone)] : (table[rootIdx]?.[semitone] || []);
            if (!candidates.length) return null;
            const next = [];
            for (const state of beam) for (const cand of candidates) {
                if (!allowReuse && state.used.has(cand.idx)) continue;
                next.push(extendState(state, cand, allowReuse));
            }
            if (!next.length) return null;
            next.sort((a, b) => partialCost(a) - partialCost(b));
            beam = next.slice(0, beamWidth);
        }
        beam.sort(compareFinalStates);
        return beam[0] ? finalizeCandidate(r, beam[0]) : null;
    }
    function optimize(input = {}) {
        const ratios = Array.isArray(input.ratios) ? input.ratios : [];
        const requiredSemitones = Array.from(new Set((input.requiredSemitones || []).map(mod12))).sort((a, b) => a - b);
        const topK = clamp(Math.trunc(toFinite(input.topK, 1)), 1, 12);
        const beamWidth = clamp(Math.trunc(toFinite(input.beamWidth, 8)), 1, 1000);
        const resultLimit = clamp(Math.trunc(toFinite(input.resultLimit, 40)), 1, 5000);
        const allowReuse = !!input.allowReuse;
        if (!ratios.length || !requiredSemitones.length) return { candidates: [], stats: { ratioCount: ratios.length, requiredToneCount: requiredSemitones.length } };
        const table = buildTopKDistanceTable(ratios, requiredSemitones, topK);
        const bySig = new Map();
        for (let rootIdx = 0; rootIdx < ratios.length; rootIdx++) {
            const cand = optimizeRoot(rootIdx, ratios, requiredSemitones, table, { beamWidth, allowReuse });
            if (!cand) continue;
            const ex = bySig.get(cand.signature);
            if (!ex || cand.strength > ex.strength || (cand.strength === ex.strength && cand.avgDeviation < ex.avgDeviation)) bySig.set(cand.signature, cand);
        }
        const candidates = Array.from(bySig.values())
            .sort((a, b) => b.strength - a.strength || a.avgDeviation - b.avgDeviation || a.maxDeviation - b.maxDeviation || a.rootFraction.localeCompare(b.rootFraction, undefined, { numeric: true }))
            .slice(0, resultLimit);
        return { candidates, stats: { ratioCount: ratios.length, requiredToneCount: requiredSemitones.length, topK, beamWidth, allowReuse } };
    }
    function scoreTonesWithBatch(semitones = [], candidate = null) {
        if (!candidate || !Array.isArray(candidate.matches)) return { strength: 0, avgDeviation: 50, maxDeviation: 50, pairCount: 0, matches: [] };
        const bySemitone = new Map(candidate.matches.map(m => [m.semitone, m]));
        const matches = Array.from(new Set(semitones.map(mod12))).map(s => bySemitone.get(s)).filter(Boolean);
        if (matches.length < 2) return { strength: 1, avgDeviation: 0, maxDeviation: 0, pairCount: 0, matches };
        let total = 0, maxDeviation = 0, pairCount = 0;
        for (let i = 0; i < matches.length; i++) for (let j = i + 1; j < matches.length; j++) {
            const d = pairDeviation(matches[i], matches[j]); total += d; maxDeviation = Math.max(maxDeviation, d); pairCount += 1;
        }
        const avgDeviation = pairCount > 0 ? total / pairCount : 0;
        return { strength: clamp(1 - avgDeviation / 50, 0, 1), avgDeviation, maxDeviation, pairCount, matches };
    }
    function analyzePerChord(parsed, candidate) {
        const chords = Array.isArray(parsed?.chords) ? parsed.chords : [];
        return chords.map(chord => ({
            symbol: chord.symbol, rootSemitone: chord.rootSemitone, relativeTones: chord.relativeTones,
            // the actual ratio fractions sounding for this chord = the section's mask
            fractions: scoreTonesWithBatch(chord.relativeTones, candidate).matches.map(m => m.fraction),
            ...scoreTonesWithBatch(chord.relativeTones, candidate)
        }));
    }

    // ---- high-level: text + scale -> per-chord masks, with relaxed-reuse fallback ----
    function solve(progressionText, scale, opts = {}) {
        const parsed = parseProgression(progressionText, opts);
        if (!parsed.ok && !parsed.chords.length) {
            return { ok: false, reason: 'parse', parsed, errors: parsed.errors };
        }
        const ratios = buildRatioRows(scale);
        if (!ratios.length) return { ok: false, reason: 'no-scale', parsed };
        // topK scaled to the pool so a small tone row has alternatives to avoid collision-empty beams
        const topK = clamp(ratios.length, 1, 8);
        let res = optimize({ ratios, requiredSemitones: parsed.requiredSemitones, topK, beamWidth: 12, resultLimit: 1 });
        let relaxed = false;
        if (!res.candidates.length) {
            // tone row has fewer distinct ratios than the progression's pitch classes:
            // allow a ratio to voice more than one pitch class (best partial fit)
            res = optimize({ ratios, requiredSemitones: parsed.requiredSemitones, topK, beamWidth: 12, resultLimit: 1, allowReuse: true });
            relaxed = true;
        }
        const candidate = res.candidates[0] || null;
        if (!candidate) return { ok: false, reason: 'no-solution', parsed };
        const perChord = analyzePerChord(parsed, candidate);
        return { ok: true, parsed, candidate, perChord, relaxed, strength: candidate.strength, avgDeviation: candidate.avgDeviation };
    }

    // Note name (e.g. "C", "F#", "Bb", optional octave "C4") -> frequency in Hz.
    // A4 = 440. If no octave given, defaults to octave 4.
    function noteToHz(noteText, a4 = 440) {
        const m = String(noteText ?? '').trim().match(/^([A-Ga-g])([#b]{0,2})(-?\d+)?$/);
        if (!m) return null;
        const letter = m[1].toUpperCase();
        const acc = m[2] || '';
        const octave = m[3] != null ? parseInt(m[3], 10) : 4;
        let semis = NOTE_BASE[letter];
        for (const ch of acc) semis += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
        const midi = (octave + 1) * 12 + semis; // MIDI: C-1=0, so C4=60, A4=69
        return a4 * Math.pow(2, (midi - 69) / 12);
    }

    if (root) root.ProgressionSolver = {
        parseProgression, parseChordSymbol, resolveChordIntervals, buildRatioRows,
        optimize, analyzePerChord, solve, noteToHz, parseNoteName, pitchClassName,
        NOTE_BASE
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root ? root.ProgressionSolver : null;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
