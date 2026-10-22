// drum-patterns.js — the curated drum patterns, written by hand, chunk-tunes style: `steps` to the bar, a string per
// voice with an x where it strikes (X: an accented stroke), over `bars` bars (a two-bar clave writes 2 × steps).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
// A step is a FRACTION OF THE BAR (step j of a bar of `steps` sits at j / steps), never a slot: drums.js lands it on
// the Composer's own bar through the bar's 4-partition (its four beats, `beatsOf`), so a pattern plays in any S slots
// to the bar, odd or prime S too. The first six are chunk-tunes' (Overworld/econ/runtime/chunk-timeline.js
// DRUM_PATTERNS: backbeat, four, funk, soca, bossa, shuffle), kept stroke for stroke; `rock` is chunk-tunes' backbeat
// under the name the lab shows. halftime, son, rumba and the phrase-end fill are new here. Every one but rock is a
// first proposal nobody has heard in the Composer (proposed, not ruled).
//
//   voices   kick, snare, hat, perc (the clave / rim: Audio/drums' made perc is chunk-tunes' 880 Hz tick), cym

export const COMPOSER_DRUM_PATTERNS_VERSION = 'composer-drum-patterns-v1';
export const PATTERN_VOICES = Object.freeze(['kick', 'snare', 'hat', 'perc', 'cym']);

const p = (o) => Object.freeze({ bars: 1, ...o });
export const DRUM_PATTERNS = Object.freeze({
  rock: p({ steps: 8, label: 'rock backbeat', says: 'kick on one and three, snare on two and four, a hat in eighths (chunk-tunes\' backbeat)', kick: 'X...x...', snare: '..x...x.', hat: 'xxxxxxxx' }),
  halftime: p({ steps: 8, label: 'half-time', says: 'kick on one and the and of three, the snare on three only, a hat in eighths', kick: 'X....x..', snare: '....X...', hat: 'xxxxxxxx' }),
  four: p({ steps: 8, label: 'four on the floor', says: 'a kick on every beat, snare on two and four, a hat between the beats (chunk-tunes)', kick: 'X.x.x.x.', snare: '..x...x.', hat: '.x.x.x.x' }),
  funk: p({ steps: 16, label: 'funk', says: 'a kick pushed off the beat in sixteenths, snare on two and four, a hat on every sixteenth (chunk-tunes)', kick: 'X.x...x...x..x..', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' }),
  soca: p({ steps: 16, label: 'soca', says: 'a kick on every beat, the snare a three-three-two across each half bar, a hat between the beats (chunk-tunes)', kick: 'X...x...x...x...', snare: '...x..x....x..x.', hat: '..x...x...x...x.' }),
  bossa: p({ steps: 16, label: 'bossa', says: 'a kick on each beat and the sixteenth before the next, a rim clave over it, a hat in eighths (chunk-tunes; its snare line is the rim, played here on the perc)', kick: 'X..xx..xx..xx..x', perc: 'x..x..x...x..x..', hat: 'x.x.x.x.x.x.x.x.' }),
  shuffle: p({ steps: 12, label: 'shuffle', says: 'a bar of twelve: kick on one and three, snare on two and four, a hat on the first and last of each three (chunk-tunes)', kick: 'X.....x.....', snare: '...x.....x..', hat: 'x.xx.xx.xx.x' }),
  son: p({ steps: 8, bars: 2, label: 'son clave 3-2', says: 'the son clave over two bars (three strokes, then two) on the perc, kick on one and three, a hat on the beats', perc: 'X..x..x...x.x...', kick: 'X...x...X...x...', hat: 'x.x.x.x.x.x.x.x.' }),
  rumba: p({ steps: 8, bars: 2, label: 'rumba clave 3-2', says: 'the rumba clave over two bars (its third stroke a step late), kick on one and three, a hat on the beats', perc: 'X..x...x..x.x...', kick: 'X...x...X...x...', hat: 'x.x.x.x.x.x.x.x.' }),
});
export const PATTERN_NAMES = Object.freeze(Object.keys(DRUM_PATTERNS));

/** the phrase-end fill: only its second half is played, over the first half of the bar's own pattern; the snare rises
 *  through it (velocities ramp in drums.js), and a crash opens the bar after it */
export const FILL = p({ steps: 16, label: 'fill', says: 'the bar\'s second half: snare in eighths then sixteenths, rising, a kick under its first and last strokes; a crash on the next downbeat', kick: '........x.....x.', snare: '........x.x.xxxx' });

/** a pattern's strokes: [{ voice, bar (of the pattern), f (fraction of the bar, [0, 1)), accent }] in pattern order */
export function patternStrokes(pattern) {
  const out = [];
  for (const voice of PATTERN_VOICES) {
    const line = pattern[voice];
    if (!line) continue;
    if (line.length !== pattern.steps * pattern.bars) throw new Error(`composer/drum-patterns: ${pattern.label} ${voice} has ${line.length} steps, not ${pattern.steps * pattern.bars}`);
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '.') continue;
      if (ch !== 'x' && ch !== 'X') throw new Error(`composer/drum-patterns: ${pattern.label} ${voice} step ${j} is "${ch}"`);
      out.push({ voice, bar: Math.floor(j / pattern.steps), f: (j % pattern.steps) / pattern.steps, accent: ch === 'X' });
    }
  }
  return out;
}
