// QualityMatcher.js — pure logic, no DOM.
// Given a set of active tone-row ratios (each carrying its cents value within the
// octave), quantise to 12-TET pitch classes and identify which catalog Qualities
// the subset produces, with the microtonal tuning deviation of each match.
//
// This is the analytical bridge that lets "Quality Painting" name what you paint:
// a stage's active pitch subset -> "maj7 (+6¢)" etc. Matching is transposition-
// invariant (a quality can be rooted on any pitch class present in the subset).
//
// Browser: window.QualityMatcher. Node: module.exports.

(function (root) {
    'use strict';

    const catalogApi = (typeof module !== 'undefined' && module.exports)
        ? require('./QualityCatalog.js')
        : (root && root.AdvancedQualityCatalog);

    // Quantise a cents value (any real) to {pc, deviation}.
    // pc in [0,11]; deviation = signed cents from the nearest 12-TET semitone.
    function quantiseCents(cents) {
        const semis = Math.round(cents / 100);
        const pc = ((semis % 12) + 12) % 12;
        const deviation = cents - semis * 100; // signed, ~[-50, +50]
        return { pc, deviation };
    }

    // Build per-pitch-class data from a list of active ratio objects.
    // ratios: [{ fraction, ratio, cents }]  (cents within the octave, 0..1200)
    // Returns { pcSet:Set<int>, byPc: Map<pc, {pc, members:[{fraction,cents,deviation}]}> }
    function buildPitchClasses(ratios) {
        const byPc = new Map();
        (ratios || []).forEach(r => {
            if (r == null || !isFinite(r.cents)) return;
            const { pc, deviation } = quantiseCents(r.cents);
            if (!byPc.has(pc)) byPc.set(pc, { pc, members: [] });
            byPc.get(pc).members.push({ fraction: r.fraction, cents: r.cents, deviation });
        });
        // Sort each pc's members by closeness to the ideal semitone.
        for (const data of byPc.values()) {
            data.members.sort((a, b) => Math.abs(a.deviation) - Math.abs(b.deviation));
            data.best = data.members[0];
        }
        return { pcSet: new Set(byPc.keys()), byPc };
    }

    // Test a quality (intervals) against an active pc set at every transposition.
    // Returns the list of valid rootings as match descriptors.
    function matchQuality(quality, pcInfo, opts) {
        const { pcSet, byPc } = pcInfo;
        const ivals = quality.intervals;
        const results = [];
        for (let t = 0; t < 12; t++) {
            const rooted = ivals.map(x => (x + t) % 12);
            // containment test
            let ok = true;
            for (const pc of rooted) { if (!pcSet.has(pc)) { ok = false; break; } }
            if (!ok) continue;

            const members = rooted.map((pc, i) => {
                const data = byPc.get(pc);
                const best = data.best;
                return {
                    interval: ivals[i],
                    pc,
                    idealCents: ivals[i] * 100,
                    fraction: best.fraction,
                    actualCents: best.cents,
                    deviation: best.deviation
                };
            });
            const devs = members.map(m => Math.abs(m.deviation));
            const avgAbsDeviation = devs.reduce((a, b) => a + b, 0) / devs.length;
            const maxAbsDeviation = Math.max.apply(null, devs);
            const rootMember = members[0];
            const isExact = rooted.length === pcSet.size;
            results.push({
                quality,
                rootPc: t,
                rootFraction: rootMember.fraction,
                isExact,
                members,
                avgAbsDeviation,
                maxAbsDeviation
            });
        }
        // Keep only the best-tuned rooting per quality (lowest avg deviation).
        results.sort((a, b) => a.avgAbsDeviation - b.avgAbsDeviation);
        return results.length ? results[0] : null;
    }

    // Rank comparator: exact matches first, then larger cardinality, then tier rank
    // (consonant before dissonant), then closer tuning.
    function rankMatches(a, b) {
        if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
        if (a.quality.cardinality !== b.quality.cardinality) return b.quality.cardinality - a.quality.cardinality;
        const catalog = catalogApi;
        const ra = catalog.tierRank[a.quality.tier] ?? 9;
        const rb = catalog.tierRank[b.quality.tier] ?? 9;
        if (ra !== rb) return ra - rb;
        return a.avgAbsDeviation - b.avgAbsDeviation;
    }

    // Main entry. Analyse a set of active ratios.
    // opts.windowCents (default 15): a match is "in-tune" if avgAbsDeviation <= window.
    // opts.minCardinality (default 3): ignore matches smaller than a triad for the
    //   "contained" list (dyads are too ambiguous to name as a quality).
    function analyze(ratios, opts) {
        opts = opts || {};
        const windowCents = opts.windowCents != null ? opts.windowCents : 15;
        const minCardinality = opts.minCardinality != null ? opts.minCardinality : 3;
        const catalog = catalogApi.catalog;

        const pcInfo = buildPitchClasses(ratios);
        const pcCount = pcInfo.pcSet.size;

        const matches = [];
        for (const q of catalog) {
            if (q.cardinality < minCardinality) continue;
            if (q.cardinality > pcCount) continue; // can't contain a bigger set
            const m = matchQuality(q, pcInfo, opts);
            if (m) matches.push(m);
        }
        matches.sort(rankMatches);

        const exact = matches.filter(m => m.isExact);
        const contained = matches.filter(m => !m.isExact);
        const primary = matches[0] || null;
        if (primary) primary.inTune = primary.avgAbsDeviation <= windowCents;

        return {
            pcCount,
            pitchClasses: Array.from(pcInfo.pcSet).sort((a, b) => a - b),
            byPc: pcInfo.byPc,
            primary,
            exact,
            contained,
            all: matches,
            windowCents
        };
    }

    // Short human label for a match, e.g. "maj7 (+6¢)" or "m7  (in tune)".
    const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    function labelFor(match, opts) {
        if (!match) return '—';
        opts = opts || {};
        const q = match.quality;
        const dev = match.avgAbsDeviation;
        const rootName = opts.showRoot ? (PC_NAMES[match.rootPc] + ' ') : '';
        const tuning = dev <= (opts.windowCents || 15)
            ? 'in tune'
            : (match.members.reduce((s, m) => s + m.deviation, 0) >= 0 ? '+' : '−') + dev.toFixed(0) + '¢';
        return `${rootName}${q.symbol} (${tuning})`;
    }

    const api = { quantiseCents, buildPitchClasses, matchQuality, analyze, labelFor, PC_NAMES };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.QualityMatcher = api;
})(typeof window !== 'undefined' ? window : null);
