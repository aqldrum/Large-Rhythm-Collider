// chord-walk.js — Part A of the Chord Walk (see cosmos/docs/CHORD_WALK_HANDOFF.md). Pure module, no DOM,
// no audio: gives a star's tuning system a deterministic signature chord loop. Method: solve the star's
// tone row against the full chromatic (the "frame" — ProgressionSolver already searches every root), keep
// only major/minor triads whose 3 semitones are all well-tuned in that frame, then greedily walk that
// vocabulary by smoothest voice leading (parsimony + JI-coherence) under a tabu list. The walk is
// deterministic over a finite state set, so it must fall into a cycle — that cycle is the star's song.
import { deriveScale } from './oracle-core.js';
import '../Playback/AdvancedPlayback/ProgressionSolver.js';
const PS = globalThis.ProgressionSolver;

const ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const romanSymbol = (r, quality) => quality === 'min' ? ROMAN[r].toLowerCase() : ROMAN[r];
const circ12 = (a, b) => { const d = Math.abs(a - b) % 12; return Math.min(d, 12 - d); };
const PERMS3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

const DEFAULTS = {
  alpha: 1,            // semitone-units per circular semitone of voice motion (parsimony term)
  beta: 1 / 50,        // semitone-units per cent of pairDeviation (JI-coherence term; 50¢ ≈ 1 semitone)
  lambda: 0.01,        // semitone-units per cent of a candidate chord's own avgDeviation (fitness term)
  tabuK: 3, maxSteps: 64,
  playableMaxDev: 35,  // cents — a frame slot tuned worse than this is unplayable
  windowCents: 15,     // thick-mask window, same default as ProgressionSolver.solve
};

// Min-over-6-bijections voice-leading cost between two triads (each a Step-2 chord with 3 `matches`,
// sorted by semitone). Returns the winning bijection alongside so the walk can record `voices`.
function vlCost(A, B, opts) {
  let best = Infinity, bestPerm = PERMS3[0];
  for (const perm of PERMS3) {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const mA = A.matches[i], mB = B.matches[perm[i]];
      sum += opts.alpha * circ12(mA.semitone, mB.semitone) + opts.beta * PS.pairDeviation(mA, mB);
    }
    if (sum < best) { best = sum; bestPerm = perm; }
  }
  return { cost: best, perm: bestPerm };
}

function buildVoices(fromChord, toChord, perm) {
  return perm.map((toIdx, fromIdx) => {
    const mFrom = fromChord.matches[fromIdx], mTo = toChord.matches[toIdx];
    return {
      fromFraction: mFrom.fraction, toFraction: mTo.fraction,
      semitoneFrom: mFrom.semitone, semitoneTo: mTo.semitone,
      centsMove: PS.minCircularDistance(mFrom.cents, mTo.cents),   // actual JI distance this voice sounds
      gridDeviation: PS.pairDeviation(mFrom, mTo),                 // how far that motion strays from its 12TET step
    };
  });
}

export function solveStarSong(rawLayers, opts = {}) {
  const o = { ...DEFAULTS, ...opts };

  // ── Step 1: the chromatic frame — best root + semitone→ratio "keyboard" for the full chromatic ──
  const scale = deriveScale(rawLayers);
  const ratios = PS.buildRatioRows(scale.ratios);
  const allSemitones = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  let res = PS.optimize({ ratios, requiredSemitones: allSemitones, topK: 12, beamWidth: 16, resultLimit: 1 });
  let relaxed = false;
  if (!res.candidates.length) {   // cardinality < 12 → pigeonhole; allow a ratio to voice >1 semitone
    res = PS.optimize({ ratios, requiredSemitones: allSemitones, topK: 12, beamWidth: 16, resultLimit: 1, allowReuse: true });
    relaxed = true;
  }
  const frameCandidate = res.candidates[0];
  if (!frameCandidate) return null;   // degenerate: no frame at all

  const playableSlots = frameCandidate.matches.filter(m => m.deviation <= o.playableMaxDev).map(m => m.semitone);
  const playable = new Set(playableSlots);
  const frame = {
    rootFraction: frameCandidate.rootFraction, rootCents: frameCandidate.rootCents,
    strength: frameCandidate.strength, relaxed, matches: frameCandidate.matches, playableSlots,
  };

  // ── Step 2: chord vocabulary — 24 major/minor triads, kept only if all 3 semitones are playable ──
  const vocab = [];
  for (let r = 0; r < 12; r++) {
    for (const quality of ['maj', 'min']) {
      const semitones = quality === 'maj' ? [r, (r + 4) % 12, (r + 7) % 12] : [r, (r + 3) % 12, (r + 7) % 12];
      if (!semitones.every(s => playable.has(s))) continue;
      const scored = PS.scoreTonesWithBatch(semitones, frameCandidate);
      if (scored.matches.length < 3) continue;   // a semitone the frame couldn't voice
      vocab.push({
        id: r * 2 + (quality === 'min' ? 1 : 0),
        rootSemitone: r, quality, semitones: semitones.slice().sort((a, b) => a - b),
        symbol: romanSymbol(r, quality),
        strength: scored.strength, avgDeviation: scored.avgDeviation, maxDeviation: scored.maxDeviation,
        pairCount: scored.pairCount, matches: scored.matches,
        fractions: scored.matches.map(m => m.fraction),
        windowFractions: PS.chordWindowFractions(ratios, frameCandidate, semitones, o.windowCents),
      });
    }
  }
  if (!vocab.length) return null;   // degenerate: no playable triad → caller keeps plain Phase 0 behavior
  if (vocab.length === 1) return { frame, vocabularySize: 1, transient: [], cycle: [{ ...vocab[0], voices: null }] };

  // ── Step 4 setup: start chord + effective tabu length ──
  const pickBest = list => list.slice().sort((a, b) =>
    b.strength - a.strength || a.avgDeviation - b.avgDeviation || a.id - b.id)[0];
  const rootZero = vocab.filter(c => c.rootSemitone === 0);
  const start = rootZero.length ? pickBest(rootZero) : pickBest(vocab);

  // shrink the tabu length when the vocabulary is too small for tabuK to leave any legal move
  const effectiveTabuK = vocab.length <= o.tabuK + 1 ? Math.max(0, vocab.length - 2) : o.tabuK;

  // ── Step 4: the walk — deterministic tabu search; state = (current chord, tabu contents) ──
  let tabu = [start.id];
  while (tabu.length > effectiveTabuK) tabu.shift();
  const trajectory = [start];
  const voicesTraj = [null];
  const seenAt = new Map();
  let transient = null, cycle = null;

  for (let k = 0; k < o.maxSteps; k++) {
    const current = trajectory[k];
    const key = [current.id, ...tabu].join('|');
    if (seenAt.has(key)) {
      const i = seenAt.get(key);
      transient = trajectory.slice(0, i);
      cycle = trajectory.slice(i, k).map((c, idx) => ({ ...c, voices: voicesTraj[i + idx] }));
      break;
    }
    seenAt.set(key, k);

    const pool = vocab.filter(c => !tabu.includes(c.id));
    let bestNext = null, bestCost = Infinity, bestPerm = null;
    for (const next of pool) {   // pool is already in ascending-id order (vocab built r-then-quality) —
      const { cost, perm } = vlCost(current, next, o);   // strict `<` naturally breaks ties by lowest id
      const total = cost + o.lambda * next.avgDeviation;
      if (total < bestCost) { bestCost = total; bestNext = next; bestPerm = perm; }
    }
    trajectory.push(bestNext);
    voicesTraj.push(buildVoices(current, bestNext, bestPerm));
    tabu.push(bestNext.id); while (tabu.length > effectiveTabuK) tabu.shift();
  }

  if (!cycle) {   // maxSteps safety net — shouldn't happen with ≤24 chords in the vocabulary
    transient = [];
    cycle = trajectory.map((c, idx) => ({ ...c, voices: voicesTraj[idx] }));
  } else {
    transient = transient.map((c, idx) => ({ ...c, voices: voicesTraj[idx] }));
  }

  return { frame, vocabularySize: vocab.length, transient, cycle };
}
