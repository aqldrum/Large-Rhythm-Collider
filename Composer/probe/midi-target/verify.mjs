// verify.mjs — does the vote find the best placement? Brute force on small rows, against search().
//
//   node Composer/probe/midi-target/verify.mjs
//
// A note hits for φ in an interval [c − τ/P, c + τ/P] (c = an onset of its lane minus its step / P), so the hit count is
// piecewise constant in φ and its maximum is reached just inside some interval's left end. For every lattice, k and N,
// evaluate() at every left end + ε: the true best hits. The vote must reach it (search() refines its peaks with the same
// evaluate()). Prints the rows × clips where it does not, and the totals.

import { buildRow } from '../../core/row.js';
import { CLIPS, clipBytes } from './clips.mjs';
import { readMidi, decodeClip } from './midi.mjs';
import { search, evaluate, latticesOf, lanesOf, barCounts, DEFAULTS } from './target.mjs';

const ROWS = [[8, 7, 6, 5], [19, 17, 16, 15], [41, 42, 43], [119, 42, 15, 8]];
const clips = CLIPS.filter((c) => c.searched && !c.decodeAs).map((c) => decodeClip(readMidi(clipBytes(c))));
const mod = (v, n) => ((v % n) + n) % n;
let cases = 0, agree = 0;
for (const layers of ROWS) {
  const row = buildRow(layers);
  for (const clip of clips) {
    let brute = 0;
    for (const L of latticesOf(row)) {
      const { lanes } = lanesOf(row, L.tone);
      for (const N of barCounts(row, clip)) {
        const P = N * clip.S;
        for (let k = 0; k < 12; k++) for (const n of clip.notes) {
          const { x } = lanes[mod(n.pc + k, 12)];
          for (let i = 0; i < x.length; i++) {
            const phi = mod(x[i] - n.step / P - DEFAULTS.tau / P + 1e-9, 1);
            const h = evaluate(lanes, clip, k, P, phi).hits;
            if (h > brute) brute = h;
          }
        }
      }
    }
    const got = search(row, clip).placements[0]?.hits ?? 0;
    cases++; if (got === brute) agree++;
    if (got !== brute) console.log(`${layers.join(':')} ${clip.name}: vote ${got}, brute force ${brute}`);
  }
}
console.log(`the vote reached the brute-force best in ${agree} of ${cases} cases`);
