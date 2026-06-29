// QualityCatalog.js — ported from the Codex Compiler MasterQualityCatalog.
// Self-contained (no DOM). Works in browser (attaches to window) and Node (module.exports).
//
// Each quality is a 12-TET pitch-class set (intervals[] relative to a root of 0),
// grouped into four tiers. The Advanced Playback "Quality Painting" page matches
// active tone-row subsets against this catalog to name the chord/colour a stage
// produces. See FILAMENTS-style ethos: the labels are derived, not assigned.

(function (root) {
    'use strict';

    const IC_TO_SCHOOL = { 1: 'friction', 2: 'motion', 3: 'reflection', 4: 'resonance', 5: 'force', 6: 'chaos' };

    function computeSchoolProfile(intervals) {
        const profile = { friction: 0, motion: 0, reflection: 0, resonance: 0, force: 0, chaos: 0 };
        for (let i = 0; i < intervals.length; i++) {
            for (let j = i + 1; j < intervals.length; j++) {
                const diff = Math.abs(intervals[i] - intervals[j]);
                const ic = Math.min(diff, 12 - diff);
                const school = IC_TO_SCHOOL[ic];
                if (school) profile[school]++;
            }
        }
        return profile;
    }

    function lexSmaller(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] < b[i];
        }
        return false;
    }

    // Canonical (prime) set-class form: rotate so the lexicographically smallest
    // pitch-class vector wins. Used for transposition-invariant identity.
    function computeCanonicalSetClass(intervals) {
        if (!Array.isArray(intervals) || intervals.length === 0) {
            return { canonical: [], rotationOffset: 0 };
        }
        const normalized = Array.from(new Set(intervals.map(i => ((i % 12) + 12) % 12))).sort((a, b) => a - b);
        let best = null;
        let bestOffset = 0;
        for (const r of normalized) {
            const rotated = normalized.map(v => ((v - r) % 12 + 12) % 12).sort((a, b) => a - b);
            if (!best || lexSmaller(rotated, best)) { best = rotated; bestOffset = r; }
        }
        return { canonical: best, rotationOffset: bestOffset };
    }

    function setClassId(canonical) {
        return Array.isArray(canonical) ? canonical.join(',') : '';
    }

    function resolvePolarity(q) {
        if (q && typeof q.polarity === 'string' && q.polarity) return q.polarity;
        return q && q.tier === 'dissonant' ? 'dissonant' : 'concordant';
    }

    const RAW = [
        // === CONSONANT
        { id: 'major_triad',      name: 'Major Triad',         symbol: 'maj',    intervals: [0, 4, 7],              tier: 'consonant' },
        { id: 'minor_triad',      name: 'Minor Triad',         symbol: 'm',      intervals: [0, 3, 7],              tier: 'consonant' },
        { id: 'sus4',             name: 'Suspended 4th',       symbol: 'sus4',   intervals: [0, 5, 7],              tier: 'consonant' },
        { id: 'major_7th',        name: 'Major 7th',           symbol: 'maj7',   intervals: [0, 4, 7, 11],          tier: 'consonant' },
        { id: 'minor_7th',        name: 'Minor 7th',           symbol: 'm7',     intervals: [0, 3, 7, 10],          tier: 'consonant' },
        { id: 'dominant_7th',     name: 'Dominant 7th',        symbol: '7',      intervals: [0, 4, 7, 10],          tier: 'consonant' },
        { id: 'dom7_sus4',        name: '7sus4',               symbol: '7sus4',  intervals: [0, 5, 7, 10],          tier: 'consonant' },
        { id: 'minor_major_7th',  name: 'Minor Major 7th',     symbol: 'mMaj7',  intervals: [0, 3, 7, 11],          tier: 'consonant' },
        { id: 'major_6th',        name: 'Major 6th',           symbol: '6',      intervals: [0, 4, 7, 9],           tier: 'consonant' },
        { id: 'minor_6th',        name: 'Minor 6th',           symbol: 'm6',     intervals: [0, 3, 7, 9],           tier: 'consonant' },
        { id: 'add9',             name: 'Add 9',               symbol: 'add9',   intervals: [0, 2, 4, 7],           tier: 'consonant' },

        // === SPECIALIZED
        { id: 'dim_triad',        name: 'Diminished Triad',    symbol: 'dim',    intervals: [0, 3, 6],              tier: 'specialized' },
        { id: 'aug_triad',        name: 'Augmented Triad',     symbol: 'aug',    intervals: [0, 4, 8],              tier: 'specialized' },
        { id: 'dim7',             name: 'Diminished 7th',      symbol: 'dim7',   intervals: [0, 3, 6, 9],           tier: 'specialized' },
        { id: 'half_dim7',        name: 'Half-Diminished 7th', symbol: 'm7b5',   intervals: [0, 3, 6, 10],          tier: 'specialized' },
        { id: 'aug7',             name: 'Augmented 7th',       symbol: '7#5',    intervals: [0, 4, 8, 10],          tier: 'specialized' },
        { id: 'dom9',             name: 'Dominant 9th',        symbol: '9',      intervals: [0, 2, 4, 7, 10],       tier: 'specialized' },
        { id: 'major_9th',        name: 'Major 9th',           symbol: 'maj9',   intervals: [0, 2, 4, 7, 11],       tier: 'specialized' },
        { id: 'minor_9th',        name: 'Minor 9th',           symbol: 'm9',     intervals: [0, 2, 3, 7, 10],       tier: 'specialized' },
        { id: 'dom11',            name: 'Dominant 11th',       symbol: '11',     intervals: [0, 2, 4, 5, 7, 10],    tier: 'specialized' },
        { id: 'minor_11th',       name: 'Minor 11th',          symbol: 'm11',    intervals: [0, 2, 3, 5, 7, 10],    tier: 'specialized' },
        { id: 'dom13',            name: 'Dominant 13th',       symbol: '13',     intervals: [0, 2, 4, 7, 9, 10],    tier: 'specialized' },
        { id: 'dom7_sharp9',      name: '7#9 (Hendrix)',       symbol: '7#9',    intervals: [0, 3, 4, 7, 10],       tier: 'specialized' },
        { id: 'dom7_flat9',       name: '7b9',                 symbol: '7b9',    intervals: [0, 1, 4, 7, 10],       tier: 'specialized' },
        { id: 'dom13_flat9',      name: '13b9',                symbol: '13b9',   intervals: [0, 1, 4, 7, 9, 10],    tier: 'specialized' },
        { id: 'dom7_sharp11',     name: '7#11 (Lydian Dom)',   symbol: '7#11',   intervals: [0, 4, 6, 7, 10],       tier: 'specialized' },
        { id: 'dom7_alt',         name: '7#9#5 (Altered)',     symbol: '7alt',   intervals: [0, 3, 4, 8, 10],       tier: 'specialized' },
        { id: 'dom9_sus4',        name: '9sus4',               symbol: '9sus4',  intervals: [0, 2, 5, 7, 10],       tier: 'specialized' },
        { id: 'dom13_sus4',       name: '13sus4',              symbol: '13sus4', intervals: [0, 2, 5, 9, 10],       tier: 'specialized' },
        { id: 'aug_maj7',         name: 'Augmented Major 7th', symbol: 'augMaj7',intervals: [0, 4, 8, 11],          tier: 'specialized' },
        { id: 'italian_6th',      name: 'Italian 6th',         symbol: 'It6',    intervals: [0, 4, 6, 10],          tier: 'specialized' },
        { id: 'french_6th',       name: 'French 6th',          symbol: 'Fr6',    intervals: [0, 2, 6, 8],           tier: 'specialized' },
        { id: 'quartal_triad',    name: 'Quartal Triad',       symbol: 'q',      intervals: [0, 5, 10],             tier: 'specialized' },

        // === SCALE
        { id: 'pentatonic_major', name: 'Major Pentatonic',    symbol: 'pent',   intervals: [0, 2, 4, 7, 9],        tier: 'scale' },
        { id: 'pentatonic_minor', name: 'Minor Pentatonic',    symbol: 'pentm',  intervals: [0, 3, 5, 7, 10],       tier: 'scale' },
        { id: 'blues_scale',      name: 'Blues Scale',         symbol: 'blues',  intervals: [0, 3, 5, 6, 7, 10],    tier: 'scale' },
        { id: 'diatonic_major',   name: 'Diatonic Major',      symbol: 'ion',    intervals: [0, 2, 4, 5, 7, 9, 11], tier: 'scale' },
        { id: 'natural_minor',    name: 'Natural Minor',       symbol: 'aeo',    intervals: [0, 2, 3, 5, 7, 8, 10], tier: 'scale' },
        { id: 'harmonic_minor',   name: 'Harmonic Minor',      symbol: 'hmin',   intervals: [0, 2, 3, 5, 7, 8, 11], tier: 'scale' },
        { id: 'melodic_minor',    name: 'Melodic Minor',       symbol: 'mmin',   intervals: [0, 2, 3, 5, 7, 9, 11], tier: 'scale' },
        { id: 'dorian',           name: 'Dorian Mode',         symbol: 'dor',    intervals: [0, 2, 3, 5, 7, 9, 10], tier: 'scale' },
        { id: 'mixolydian',       name: 'Mixolydian Mode',     symbol: 'mix',    intervals: [0, 2, 4, 5, 7, 9, 10], tier: 'scale' },
        { id: 'phrygian',         name: 'Phrygian Mode',       symbol: 'phr',    intervals: [0, 1, 3, 5, 7, 8, 10], tier: 'scale' },
        { id: 'whole_tone',       name: 'Whole Tone Scale',    symbol: 'wt',     intervals: [0, 2, 4, 6, 8, 10],    tier: 'scale' },
        { id: 'chromatic_cluster_4', name: 'Chromatic Cluster',symbol: 'chr4',   intervals: [0, 1, 2, 3],           tier: 'scale' },

        // === DISSONANT
        { id: 'dim_cluster',      name: 'Diminished Cluster',  symbol: 'dim4',   intervals: [0, 1, 3, 6],           tier: 'dissonant' },
        { id: 'viennese_trichord',name: 'Viennese Trichord',   symbol: 'vt',     intervals: [0, 1, 6],              tier: 'dissonant' },
        { id: 'mystic_chord',     name: 'Mystic Chord',        symbol: 'myst',   intervals: [0, 2, 6, 8, 10],       tier: 'dissonant' },
        { id: 'afrocentric_susb9',name: 'AfroCentric susb9',   symbol: 'susb9',  intervals: [0, 1, 5, 7],           tier: 'dissonant' },
        { id: 'afrocentric_susb9_7', name: 'AfroCentric 7susb9', symbol: '7susb9', intervals: [0, 1, 5, 7, 10],     tier: 'dissonant' },
        { id: 'petrushka_chord',  name: 'Petrushka Chord',     symbol: 'pet',    intervals: [0, 1, 6, 7],           tier: 'dissonant' },
        { id: 'all_interval_tetrachord', name: 'All-Interval Tetrachord', symbol: 'ait4', intervals: [0, 1, 4, 6],  tier: 'dissonant' },
        { id: 'locrian_core_pentad', name: 'Locrian Core Pentad', symbol: 'loc5', intervals: [0, 1, 3, 5, 6],       tier: 'dissonant' },
        { id: 'octatonic_fragment_hexad', name: 'Octatonic Fragment', symbol: 'oct6', intervals: [0, 1, 3, 4, 6, 7], tier: 'dissonant' }
    ];

    const CATALOG = RAW.map(q => {
        const { canonical, rotationOffset } = computeCanonicalSetClass(q.intervals);
        const polarity = resolvePolarity(q);
        return Object.assign({}, q, {
            cardinality: q.intervals.length,
            schoolProfile: computeSchoolProfile(q.intervals),
            setClassId: setClassId(canonical),
            canonical: canonical,
            canonicalRootSemitone: rotationOffset,
            polarity: polarity
        });
    });

    const TIER_ORDER = ['consonant', 'specialized', 'scale', 'dissonant'];
    const TIER_LABELS = { consonant: 'Consonant', specialized: 'Specialized', scale: 'Scale', dissonant: 'Dissonant' };
    const TIER_RANK = { consonant: 0, specialized: 1, scale: 2, dissonant: 3 };

    const api = {
        catalog: CATALOG,
        tierOrder: TIER_ORDER,
        tierLabels: TIER_LABELS,
        tierRank: TIER_RANK,
        byId: id => CATALOG.find(q => q.id === id) || null,
        computeCanonicalSetClass,
        computeSchoolProfile
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) {
        root.AdvancedQualityCatalog = api;
        // Mirror the Compiler's globals if the host page wants them.
        if (!root.MasterQualityCatalog) root.MasterQualityCatalog = CATALOG;
    }
})(typeof window !== 'undefined' ? window : null);
