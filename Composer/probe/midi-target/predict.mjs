// predict.mjs — does lane density predict the whole-cycle hits? A Poisson estimate: expected = max over k of
// Σ_j (1 − exp(−n_lane(m_j + k) / P)), P = B·S, the lanes the best lattice's (laneStats.per). Observed vs expected, Pearson r.
//
//   node Composer/probe/midi-target/predict.mjs Composer/probe/midi-target/results-<date>.json

import { readFileSync } from 'node:fs';
import { CLIPS, clipBytes } from './clips.mjs';
import { readMidi, decodeClip } from './midi.mjs';

const res = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const clips = new Map(res.clips.map((c) => [c.name, c]));
const notes = new Map(CLIPS.map((c) => [c.name, decodeClip(readMidi(clipBytes(c))).notes]));
const xs = [], ys = [];
for (const r of res.results) {
  const per = res.laneStats[r.row].per, c = clips.get(r.clip), P = c.B * c.S;
  let best = 0;
  for (let k = 0; k < 12; k++) {
    let e = 0;
    for (const n of notes.get(r.clip)) e += 1 - Math.exp(-per[(n.pc + k) % 12] / P);
    best = Math.max(best, e);
  }
  const obs = r.bands.whole?.hits ?? 0;
  xs.push(best / r.J); ys.push(obs / r.J);
  console.log(`${r.row.padEnd(22)} ${r.clip.padEnd(20)} whole ${obs}/${r.J}  expected ${best.toFixed(1)}`);
}
const m = (a) => a.reduce((s, v) => s + v, 0) / a.length, mx = m(xs), my = m(ys);
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
console.log(`r = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} over ${xs.length} cases; mean expected ${mx.toFixed(3)}, observed ${my.toFixed(3)}`);
