import assert from 'node:assert/strict';
import test from 'node:test';
import ProgressionSolver from './ProgressionSolver.js';

const RATIOS = [
    ['1/1', 1], ['16/15', 16 / 15], ['9/8', 9 / 8], ['6/5', 6 / 5],
    ['5/4', 5 / 4], ['4/3', 4 / 3], ['45/32', 45 / 32], ['3/2', 3 / 2],
    ['8/5', 8 / 5], ['5/3', 5 / 3], ['9/5', 9 / 5], ['15/8', 15 / 8]
];

const scale = RATIOS.map(([fraction, ratio]) => ({
    fraction,
    ratio,
    cents: 1200 * Math.log2(ratio)
}));

test('solve returns a ranked pool while retaining the best candidate as primary', () => {
    const result = ProgressionSolver.solve('Cmaj7 Am7 Dm7 G7', scale, {
        candidateLimit: 8,
        windowCents: 15
    });

    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 8);
    assert.equal(result.candidate, result.candidates[0]);
    for (let i = 1; i < result.candidates.length; i++) {
        assert.ok(result.candidates[i - 1].strength >= result.candidates[i].strength);
    }
});

test('every candidate can regenerate all chord masks and preserve the reference root', () => {
    const result = ProgressionSolver.solve('Cmaj7 Am7 Dm7 G7', scale, {
        candidateLimit: 8,
        windowCents: 15
    });
    const c3Hz = ProgressionSolver.noteToHz('C3');

    for (const candidate of result.candidates) {
        const root = scale.find(row => row.fraction === candidate.rootFraction);
        const fundamental = c3Hz / root.ratio;
        assert.ok(Math.abs(fundamental * root.ratio - c3Hz) < 1e-9);

        const perChord = ProgressionSolver.analyzePerChord(
            result.parsed,
            candidate,
            result.ratioRows,
            result.windowCents
        );
        assert.equal(perChord.length, result.parsed.chords.length);
        perChord.forEach(chord => assert.ok(chord.fractions.length > 0));
    }
});
