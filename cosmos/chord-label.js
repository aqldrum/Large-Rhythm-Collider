// chord-label.js — the on-screen chord name (flight-view's #cosmos-chord readout). Pure, no DOM, no audio.
//
// Two spellings, because modulation changes what the chord's root even IS:
//   MODULATION ON  → every solved root is retuned onto the fundamental (modulationCentsFor), so degree 0
//                    sounds at 1/1 = 220 Hz · 2^(fundamental/1200) and the chord walk is plain 12TET western
//                    harmony: name the root by its SOUNDING note. maj7 on degree 0 at fundamental 0 → Amaj7.
//   MODULATION OFF → the absolute frame: degree 0 sits on the solved sky root (e.g. 32/27), and the tones
//                    the field actually plays are just ratios. Name the root by the RATIO the loaded field
//                    sounds at the chord's root degree, then the quality: "32/27 7♯5".
// Roman numerals are gone on purpose: a modulation moves the root without playing it, so "IV" had no anchor.
import { CHORDS, GAIN_CEILING_CENTS } from './sky-walk.js';
import { HARMONY_SOURCES } from './harmony-policy.js';

// Degree 0 at fundamental 0 is ROOT_HZ = 220 Hz = A. Flats except F♯, the usual lead-sheet spelling.
const NOTE_NAMES = ['A', 'B♭', 'B', 'C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭'];
// Quality suffixes as a lead sheet writes them. The bare major triad is just its root in note mode, but a bare
// ratio reads as a pitch, not a chord, so ratio mode keeps "maj".
const QUALITY_TEXT = { maj: '', q: ' quartal', It6: ' It6', Fr6: ' Fr6' };
const accidentals = s => s.replace(/#/g, '♯').replace(/b(?=\d)/g, '♭');
const mod12 = n => ((n % 12) + 12) % 12;

function qualityText(chord, ratioMode) {
  if (chord.qualitySymbol === 'maj') return ratioMode ? ' maj' : '';
  const text = QUALITY_TEXT[chord.qualitySymbol] ?? chord.qualitySymbol;
  return accidentals(ratioMode && !text.startsWith(' ') ? ` ${text}` : text);
}

// The ratio the field is actually sounding at `degree`: the most common playable fraction across the audible
// stars' pools (folded at the current root), ties to the best-tuned. Null when no nearby star covers it.
export function dominantFraction(pools, degree) {
  const tally = new Map();
  for (const pool of pools || []) {
    const slot = pool?.[degree];
    if (!slot?.fraction || !(Math.abs(slot.dev) <= GAIN_CEILING_CENTS)) continue;
    const t = tally.get(slot.fraction) || { n: 0, dev: Infinity };
    t.n++; t.dev = Math.min(t.dev, Math.abs(slot.dev));
    tally.set(slot.fraction, t);
  }
  let best = null, bestT = null;
  for (const [fraction, t] of tally) {
    if (!bestT || t.n > bestT.n || (t.n === bestT.n && t.dev < bestT.dev)) { best = fraction; bestT = t; }
  }
  return best;
}

// → { root, quality, detail, text } — `text` is the whole label (for aria + change detection).
//   chord           currentSkyChord(): { id, source, symbol }
//   modulationOn    currentModulation().on
//   fundamentalCents currentFundamental().cents (the rail FUNDAMENTAL transpose)
//   rootCents / rootFraction  currentSkyRoot() — the solved root, used only when the field has no ratio
//   pools           the audible stars' pools folded at that root (ratio mode only)
export function chordLabel({ chord, modulationOn, fundamentalCents = 0, rootCents = 0, rootFraction = '1/1', pools = [] }) {
  const isScale = chord?.source === HARMONY_SOURCES.SCALE;
  const entry = isScale ? null : CHORDS[chord?.id];
  if (!isScale && !entry) return { root: '', quality: '', detail: '', text: '' };
  const degree = isScale ? 0 : entry.rootSemitone;
  let root, detail = '', quality;
  if (modulationOn) {
    const semis = degree + (Number(fundamentalCents) || 0) / 100;
    const nearest = Math.round(semis), off = Math.round((semis - nearest) * 100);
    root = NOTE_NAMES[mod12(nearest)];
    if (Math.abs(off) >= 3) detail = `${off > 0 ? '+' : '−'}${Math.abs(off)}¢`;
    quality = isScale ? ` ${chord.symbol.toLowerCase()}` : qualityText(entry, false);
  } else {
    root = dominantFraction(pools, degree) || (degree === 0 ? rootFraction : null);
    // No star nearby covers the chord root (rare — the walk favours covered chords): say where it is in cents
    // above 1/1 rather than invent a ratio.
    if (!root) root = `${Math.round((((rootCents + degree * 100) % 1200) + 1200) % 1200)}¢`;
    quality = isScale ? ` ${chord.symbol.toLowerCase()}` : qualityText(entry, true);
  }
  return { root, quality, detail, text: `${root}${quality}${detail ? ` ${detail}` : ''}` };
}
