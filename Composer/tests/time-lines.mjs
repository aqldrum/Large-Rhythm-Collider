// time-lines.mjs — what phase 2 costs on single rows: the probe's cases (Composer/probe/FINDINGS.md) run through the
// Composer's own modules. Not an assert suite: it prints a table and exits 0.
//   full   6 downbeats × (2 × 8 and 4 × 8) × the full table (lead 3 motions, arp, bass 2 motions: 58 picker runs a cut)
//   lean   2 downbeats × (2 × 8 and 4 × 8) × the lean table (each type at its first motion: 24 runs a cut)
//   (downbeats: the root's, topped up with the row's heaviest where a rare root sounds at too few places)
//   node Composer/tests/time-lines.mjs [layers …]   e.g. node Composer/tests/time-lines.mjs 768:784 4099:4093:4091:4079
import { buildRow, describeRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { frameOf, classReport } from '../core/frame.js';
import { mineLines, downbeats } from '../core/lines.js';

const asked = process.argv.slice(2).map((a) => a.split(':').map(Number));
const ROWS = asked.length ? asked : [[4099, 4093, 4091, 4079], [768, 784], [768, 769], [2048, 2049]];
const ms = (f) => { const t = performance.now(), v = f(); return [performance.now() - t, v]; };

console.log('rhythm | onsets | tones | build | frame + classes | table | downbeats | cuts | runs | lines | mine ms | slowest cut ms');
for (const layers of ROWS) {
  const [tb, row] = ms(() => buildRow(layers));
  const [tf, frame] = ms(() => { const f = frameOf(row); classReport(row, f); return f; });
  for (const [table, count] of [['lean', 2], ['full', 6]]) {
    let td = 0, tm = 0, cuts = 0, runs = 0, lines = 0, slowest = 0;
    for (const [bars, S] of [[2, 8], [4, 8]]) {
      // the root's downbeats, topped up with the row's heaviest when a rare root has fewer than `count`
      const [d, phases] = ms(() => {
        const got = downbeats(row, bars * S, count, frame.rootFraction), keys = new Set(got.map(String));
        for (const p of downbeats(row, bars * S, count + got.length)) if (got.length < count && !keys.has(String(p))) got.push(p);
        return got;
      }); td += d;
      for (const phase of phases) {
        const [t, mined] = ms(() => mineLines(row, buildCells(row, { bars, slotsPerBar: S, phase }), frame, { table }));
        tm += t; cuts++; runs += mined.runs; lines += mined.lines.length; slowest = Math.max(slowest, t);
      }
    }
    const d = describeRow(row);
    console.log(`${layers.join(':')} | ${d.onsets} | ${d.tones} | ${tb.toFixed(1)} | ${tf.toFixed(1)} | ${table} | ${td.toFixed(1)} | ${cuts} | ${runs} | ${lines} | ${tm.toFixed(0)} | ${slowest.toFixed(0)}`);
  }
}
