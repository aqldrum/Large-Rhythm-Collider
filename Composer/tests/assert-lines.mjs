// assert-lines.mjs — Composer/core/lines.js. Exit non-zero on any mismatch.
//   • every note of every mined line is a real onset of the row inside its slot's window, at its own tone, in a
//     register inside the line's range — over rhythms, meters, spans, both anchor modes, both tables, three knobs
//   • the rules, read back from each line: slots in order, the gap limit, the run limit, a fringe tone only on a weak
//     slot and resolved by step and never last, the band's note count, at most 32 slots
//   • the picker is exact: on small lattices every line is enumerated and the cheapest of each length found
//   • a picked line's cost is its cost read back term by term (`scoreLine`)
//   • the table: ranked, one line per serial, deterministic, lean ⊂ full, the tooFewTones refusal
//   • downbeats: the root's first onset first, then the heaviest, no two cutting the same slots
//   • CHUNK-LINES PARITY (read-only, skipped when absent): on single Codex-sized rhythms whose tones the kernel spells
//     exactly, with its 25¢ frame matched by ±12.5¢ here and its window's swing, the lattice is candidate for candidate
//     the same, and its picker and ours pick the same lines at the same costs for every lead and arp setting
//   • a timing guard on a 16k-onset row (the full timing is Composer/tests/time-lines.mjs)
//   node Composer/tests/assert-lines.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { frameAt, frameOf } from '../core/frame.js';
import { LINE_TYPES, MOTIONS, MAX_SLOTS, RANGE_WIDTH, DEFAULT_RULES, buildLattice, pickLines, scoreLine, rulesOf, rootTargets, mineLines, downbeats, bandNotes, closeCost, intervalOver, COMPOSER_LINES_VERSION } from '../core/lines.js';
import { RHYTHMS, OVERWORLD_RUNTIME } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const typeOf = (name) => LINE_TYPES.find((t) => t.type === name);

console.log('Composer lines');

/** a line's rules, checked from its notes and the lattice it was picked on → '' or what broke */
function ruleBreak(line, lattice, rules) {
  const r = rulesOf(rules), notes = line.notes, maxGap = Math.min(lattice.P, r.maxGap);
  if (!notes.length) return 'no notes';
  if (notes[0].slot >= maxGap || notes[notes.length - 1].slot < lattice.P - maxGap) return 'gap at an end';
  let run = 1;
  for (let i = 0; i < notes.length; i++) {
    const x = notes[i], slot = lattice.slots[x.slot];
    if (i && x.slot <= notes[i - 1].slot) return 'slots out of order';
    if (i && x.slot - notes[i - 1].slot > maxGap) return `a gap of ${x.slot - notes[i - 1].slot} > ${maxGap}`;
    if (x.outside) {
      if (!slot.weak) return `fringe tone ${x.fraction} on a strong slot`;
      if (i === notes.length - 1) return 'fringe tone last';
      const next = notes[i + 1];
      if (next.outside || Math.abs(next.pitch - x.pitch) > r.step) return `fringe tone ${x.fraction} not resolved by step`;
    }
    if (i) { run = Math.abs(x.pitch - notes[i - 1].pitch) < r.same ? run + 1 : 1; if (run > r.maxRun) return `a run of ${run} on one pitch`; }
  }
  if (rules.nMin != null && (notes.length < rules.nMin || notes.length > rules.nMax)) return `${notes.length} notes outside ${rules.nMin}..${rules.nMax}`;
  return '';
}
/** the rules mineLines gave a line, rebuilt from its tags */
function rulesFor(line, targets) {
  const type = typeOf(line.type), band = type.bands.find((b) => b.band === line.band), [nMin, nMax] = bandNotes(band, line.slots);
  return { ...type.rules, ...(line.motion ? MOTIONS[line.motion] : {}), strict: band.strict, contour: { ...line.contour, low: line.contour.low + targets.bars[0].anchor }, targets, weights: { ...(type.rules.weights || {}) }, nMin, nMax };
}

console.log('\n— every note an onset in its window; the rules; costs read back');
{
  let lines = 0, notes = 0, fringe = 0, bad = '';
  const cases = [];
  for (const layers of [[8, 7, 6, 5], [11, 9, 7, 5], [19, 17, 16, 15], [119, 42, 15, 8], [768, 784], [504, 234, 520, 297], [97, 103, 37], [2003, 1999, 1997, 1993]]) {
    for (const [bars, S, from, span] of [[2, 8, 0, 2], [4, 8, 0, 4], [4, 6, 2, 2], [8, 4, 4, 4], [3, 5, 1, 1]]) for (const anchors of ['even', 'partitioned']) for (const e of [5, 15, 30]) cases.push({ layers, bars, S, from, span, anchors, e });
  }
  for (const c of cases) {
    const row = buildRow(c.layers), frame = frameOf(row, null, c.e);
    const phase = downbeats(row, c.bars * c.S, 1, frame.rootFraction, { anchors: c.anchors })[0];
    const cells = buildCells(row, { bars: c.bars, slotsPerBar: c.S, anchors: c.anchors, phase });
    const table = c.e === 15 ? 'full' : 'lean';
    const mined = mineLines(row, cells, frame, { from: c.from, bars: c.span, table });
    if (mined.tooFewTones) continue;
    const targets = rootTargets(row, frame);
    for (const line of mined.lines) {
      lines++;
      const type = typeOf(line.type), lattice = buildLattice(row, cells, frame, { from: c.from, bars: c.span, low: targets.bars[0].anchor, width: type.width });
      const rules = rulesFor(line, targets), broke = ruleBreak(line, lattice, rules);
      if (broke) { bad = `${c.layers} ${c.bars}×${c.S} ${c.anchors} ±${c.e} ${line.type}/${line.band}/${line.motion}: ${broke}`; break; }
      for (const x of line.notes) {
        notes++; if (x.outside) fringe++;
        if (row.tone[x.node] !== x.tone || row.tones[x.tone] !== x.fraction || row.tick[x.node] !== x.tick) { bad = `note ${JSON.stringify(x)} is not its onset`; break; }
        if (cells.slotOfNode[x.node] !== x.cell || x.cell !== (c.from * c.S + x.slot) || cells.slots[x.cell].bar !== x.bar) { bad = `note at node ${x.node} is not in its slot's window`; break; }
        if (!cells.slots[x.cell].tones.some((t) => t.node === x.node)) { bad = 'not the slot\'s nearest onset of that tone'; break; }
        if (x.pitch !== x.cents + 1200 * x.octave || x.pitch < lattice.low - 1e-9 || x.pitch >= lattice.low + type.width) { bad = `pitch ${x.pitch} outside [${lattice.low}, +${type.width})`; break; }
        if (x.outside !== !frame.inside[x.tone]) { bad = 'outside flag'; break; }
      }
      const picks = line.notes.map((x) => ({ slot: x.slot, cand: lattice.slots[x.slot].cands.findIndex((k) => k.tone === x.tone && k.octave === x.octave) }));
      const back = scoreLine(lattice, picks, rules);
      if (Math.abs(back.cost - line.cost) > 1e-9) { bad = `cost ${line.cost} reads back as ${back.cost}`; break; }
      if (bad) break;
    }
    if (bad) break;
  }
  check(`${lines} lines (${notes} notes, ${fringe} on fringe tones) from ${cases.length} cuts: every note its own onset, in its slot's window, in range`, !bad && lines > 1000 && fringe > 0, bad || `${lines} lines, ${fringe} fringe`);
}

console.log('\n— the picker is exact (every line enumerated on small lattices)');
{
  let bad = '', lattices = 0, enumerated = 0;
  const enumerate = (lattice, rules) => {
    const r = rulesOf(rules), best = new Map(), P = lattice.P;
    const walk = (k, picks) => {
      if (k === P) {
        if (!picks.length) return;
        const line = { notes: picks.map((p) => { const c = lattice.slots[p.slot].cands[p.cand]; return { slot: p.slot, pitch: c.pitch, fraction: c.fraction, outside: c.outside }; }) };
        // roles decide foreign (a scale may make a tone foreign); with no harmony it is the frame's outside flag
        if (ruleBreak(line, lattice, { ...rules, nMin: null })) return;
        enumerated++;
        const cost = scoreLine(lattice, picks, rules).cost, n = picks.length;
        if (!best.has(n) || cost < best.get(n)) best.set(n, cost);
        return;
      }
      walk(k + 1, picks);
      for (let c = 0; c < lattice.slots[k].cands.length; c++) walk(k + 1, [...picks, { slot: k, cand: c }]);
    };
    walk(0, []);
    return best;
  };
  for (const layers of [[8, 7, 6, 5], [11, 9, 7, 5], [5, 4, 3], [7, 5, 3, 2], [19, 17, 16, 15]]) for (const [bars, S] of [[1, 5], [2, 3], [1, 6]]) for (const e of [5, 15]) {
    const row = buildRow(layers), frame = frameAt(row, '1/1', e), targets = rootTargets(row, frame);
    const cells = buildCells(row, { bars, slotsPerBar: S, swing: 0.3 });
    const lattice = buildLattice(row, cells, frame, { low: 0, width: 900 });
    if (lattice.slots.reduce((p, s) => p * (s.cands.length + 1), 1) > 400000) continue;
    lattices++;
    for (const motion of ['stepwise', 'mixed']) for (const maxGap of [Infinity, 2]) {
      const rules = { ...MOTIONS[motion], maxGap, targets, contour: { shape: 'arch', low: 0, span: 900 } };
      const want = enumerate(lattice, rules), got = pickLines(lattice, rules);
      for (const g of got) if (!want.has(g.n) || Math.abs(want.get(g.n) - g.cost) > 1e-9) bad = `${layers} ${bars}×${S} ±${e} ${motion} gap ${maxGap}: n ${g.n} ${g.cost} vs ${want.get(g.n)}`;
      for (const [n] of want) if (!got.some((g) => g.n === n)) bad = `${layers}: the picker missed n = ${n}`;
      for (const g of got) if (Math.abs(scoreLine(lattice, g.picks, rules).cost - g.cost) > 1e-9) bad = 'pick cost';
    }
  }
  check(`${lattices} lattices × 4 rule sets, ${enumerated} valid lines enumerated: the cheapest of every length is the picker's`, !bad && lattices >= 10, bad || `${lattices}`);
}

console.log('\n— the table');
{
  const row = buildRow([119, 42, 15, 8]), frame = frameOf(row);
  const cells = buildCells(row, { bars: 4, slotsPerBar: 8, phase: downbeats(row, 32, 1, frame.rootFraction)[0] });
  const full = mineLines(row, cells, frame, { bars: 2 }), lean = mineLines(row, cells, frame, { bars: 2, table: 'lean' }), again = mineLines(row, cells, frame, { bars: 2 });
  check('ranked: cheapest per note first', full.lines.every((l, i) => !i || full.lines[i - 1].perNote <= l.perNote));
  check('one line per serial', new Set(full.lines.map((l) => l.serial)).size === full.lines.length && new Set(full.lines.map((l) => l.id)).size === full.lines.length);
  check('deterministic', JSON.stringify(full) === JSON.stringify(again));
  check(`runs: full ${full.runs} = lead 3 bands × 5 contours × 3 motions + arp 5 + bass 4 × 2 motions; lean ${lean.runs}`, full.runs === 45 + 5 + 8 && lean.runs === 15 + 5 + 4);
  const fullIds = new Set(full.lines.map((l) => l.id));
  check('lean is the full table\'s first motion (every lean line is in the full table)', lean.lines.every((l) => fullIds.has(l.id)) && lean.lines.every((l) => !l.motion || l.motion === 'stepwise'));
  check('the types are lead, arp and bass; arps never rest', ['lead', 'arp', 'bass'].every((t) => full.lines.some((l) => l.type === t)) && full.lines.filter((l) => l.type === 'arp').every((l) => l.n === l.slots));
  check('bass lines sit inside an octave above the root', full.lines.filter((l) => l.type === 'bass').every((l) => l.notes.every((x) => x.pitch >= l.low - 1e-9 && x.pitch < l.low + 1200)));
  check('a line records its span, cut and frame', full.lines.every((l) => l.from === 0 && l.bars === 2 && l.slotsPerBar === 8 && l.slots === 16 && l.frame.frameCentsEachSide === 15 && l.root === frame.rootFraction && l.id.startsWith('cl1:')) && full.version === COMPOSER_LINES_VERSION);
  const later = mineLines(row, cells, frame, { from: 2, bars: 2, table: 'lean' });
  check('a later span uses that span\'s onsets', later.lines.every((l) => l.notes.every((x) => x.bar >= 2 && x.bar < 4)) && later.lines.length > 0);
  check(`at most ${MAX_SLOTS} slots`, throws(() => mineLines(row, buildCells(row, { bars: 4, slotsPerBar: 9 }), frame), /at most 32/) && throws(() => buildLattice(row, cells, frame, { from: 3, bars: 2 }), /not in the cells/));
  check('tooFewTones: 3:2 (1 tone) is refused', mineLines(buildRow([3, 2]), buildCells(buildRow([3, 2]), { bars: 1, slotsPerBar: 4 }), frameOf(buildRow([3, 2]))).tooFewTones === true);
  check('bad table and type throw', throws(() => mineLines(row, cells, frame, { table: 'huge' }), /table must be/) && throws(() => mineLines(row, cells, frame, { types: ['tuba'] }), /no line type/));
  check('closeCost and intervalOver (exact past 2^53 products)', Math.abs(closeCost('3/2') - Math.log2(6) / 7) < 1e-12 && closeCost('1/1') === 0 && intervalOver('3/2', '9/8') === '4/3' && intervalOver('1/1', '3/2') === '4/3' && (() => {
    const got = intervalOver('1000000007/999999937', '999999929/999999893'), [n, m] = got.split('/').map(BigInt);   // cross products past 2^53
    const g = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    return g(n, m) === 1n && n * 999999937n * 999999929n === m * 1000000007n * 999999893n * (n * 999999937n * 999999929n / (m * 1000000007n * 999999893n));
  })());
  const dfl = typeOf('lead'), arp = typeOf('arp');
  check('lead and arp are chunk-lines\' own (bands, motions, the arp\'s rules)', dfl.bands.length === 3 && dfl.motions.join() === 'stepwise,mixed,wide' && arp.rules.maxGap === 1 && dfl.width === RANGE_WIDTH && DEFAULT_RULES.step === 250);
}

console.log('\n— downbeats');
{
  let bad = '';
  for (const layers of RHYTHMS) {
    const row = buildRow(layers);
    for (const P of [5, 8, 16]) for (const tone of [null, row.tones[row.tone[row.n - 1]]]) {
      const got = downbeats(row, P, 6, tone);
      const t = tone == null ? -1 : row.tones.indexOf(tone);
      const nodeOf = ([num, den]) => row.tick.indexOf(num * row.grid / den);
      const idx = got.map(nodeOf);
      if (idx.some((i) => i < 0 || (t >= 0 && row.tone[i] !== t))) { bad = `${layers}: not an onset of the tone`; break; }
      if (t >= 0 && idx[0] !== row.toneFirst[t]) { bad = `${layers}: the tone's first onset is not first`; break; }
      const rest = t >= 0 ? idx.slice(1) : idx;
      for (let k = 1; k < rest.length; k++) if (row.strikes[rest[k]] > row.strikes[rest[k - 1]]) bad = `${layers}: not heaviest first`;
      const keys = got.map(([n, d]) => ((BigInt(n) * BigInt(P)) % BigInt(d)) * BigInt(row.grid) / BigInt(d));
      if (new Set(keys.map(String)).size !== keys.length) bad = `${layers}: two downbeats cut the same slots`;
    }
    if (bad) break;
  }
  check('the root\'s first onset first, then the heaviest, no two cutting the same even slots (52 rhythms × 3 P × with and without a tone)', !bad, bad);
}

console.log('\n— chunk-lines parity (lattice and picker, read-only)');
const linesFile = path.join(OVERWORLD_RUNTIME, 'chunk-lines.js'), superRowFile = path.join(OVERWORLD_RUNTIME, 'chunk-super-row.js');
if (!fs.existsSync(linesFile)) console.log(`  – skipped: ${linesFile} is not on this machine`);
else {
  const cl = await import(pathToFileURL(linesFile).href), ow = await import(pathToFileURL(superRowFile).href);
  const mod = (v, n) => ((v % n) + n) % n;
  let rhythms = 0, runs = 0, picked = 0, bad = '', skipped = [];
  for (const layers of RHYTHMS) {
    const row = buildRow(layers);
    if (row.tones.some((x, t) => x !== row.toneLabels[t])) { skipped.push(layers.join(':')); continue; }
    if (row.tones.length < 3 || row.n > 2000) continue;
    const o = ow.buildNormalizedRow([{ layers: layers.filter((v) => v > 0).sort((a, b) => a - b) }]);
    const root = row.tones.includes('1/1') ? '1/1' : row.tones[0], r = row.tones.indexOf(root);
    const mine = frameAt(row, root, 12.5), theirs = cl.frameAt(o, mod(row.toneCents[r] - 12.5, 100), 25);
    const myT = rootTargets(row, mine, root), theirT = cl.rootTargets(o, theirs, root), low = myT.bars[0].anchor;
    rhythms++;
    for (const [bars, S] of [[2, 4], [2, 8], [4, 6]]) {
      const phase = cl.downbeats(o, bars * S, 1, root)[0];
      const lat = cl.buildLattice(o, { bars, slotsPerBar: S, phase, moments: 12, frame: theirs, low });
      const cells = buildCells(row, { bars, slotsPerBar: S, phase, swing: lat.swing }), my = buildLattice(row, cells, mine, { low });
      for (let k = 0; k < lat.P && !bad; k++) {
        const a = lat.slots[k], b = my.slots[k];
        if (a.strikes !== b.strikes || Math.abs(a.accent - b.accent) > 1e-12 || a.weak !== b.weak || a.cands.length !== b.cands.length) { bad = `${layers} ${bars}×${S} slot ${k}: ${a.cands.length} vs ${b.cands.length} cands`; break; }
        a.cands.forEach((c, i) => {
          const d = b.cands[i];
          if (c.fraction !== d.fraction || c.octave !== d.octave || Math.abs(c.pitch - d.pitch) > 1e-9 || c.outside !== d.outside || Math.abs(c.share - d.share) > 1e-12 || Math.abs(c.close - d.close) > 1e-12 || c.count !== d.count || o.num[c.node] !== row.tick[d.node] || Math.abs(c.offset - d.offset) > 1e-12) bad = `${layers} slot ${k} cand ${i}`;
        });
      }
      for (const type of cl.LINE_TYPES.filter((t) => t.type !== 'cell')) for (const motion of type.motions || [null]) for (const band of type.bands) for (const contour of type.contours) {
        if (bad) break;
        const P = bars * S, [nMin, nMax] = [Math.max(2, Math.ceil((band.share?.[0] ?? 0) * P - 1e-9)), Math.floor((band.share?.[1] ?? 1) * P + 1e-9)];
        const base = { ...type.rules, ...(motion ? cl.MOTIONS[motion] : {}), strict: band.strict, contour: { ...contour, low: contour.low + low }, weights: {}, nMin, nMax };
        const a = cl.pickLines(lat, { ...base, targets: theirT }), b = pickLines(my, { ...base, targets: myT });
        runs++;
        const spell = (lattice, p) => p.picks.map((x) => { const c = lattice.slots[x.slot].cands[x.cand]; return `${x.slot}:${c.fraction}:${c.octave}`; }).join(',');
        if (a.length !== b.length) { bad = `${layers} ${type.type}: ${a.length} vs ${b.length} lengths`; break; }
        a.forEach((p, i) => { picked++; if (p.n !== b[i].n || Math.abs(p.cost - b[i].cost) > 1e-9 || spell(lat, p) !== spell(my, b[i])) bad = `${layers} ${bars}×${S} ${type.type}/${motion}/${band.band}/${contour.shape}: n ${p.n} ${p.cost} vs ${b[i].cost} | ${spell(lat, p)} | ${spell(my, b[i])}`; });
      }
    }
    if (bad) break;
  }
  check(`${rhythms} rhythms × 3 meters: lattices candidate for candidate, then ${runs} picker runs (${picked} lines) note for note and cost for cost`, !bad && rhythms >= 20, bad);
  console.log(`  (left out: ${skipped.join(', ')} — phase 1 keys tones by exact fraction and the kernel rounds them, so their tone sets differ; and rows past 2,000 onsets, to keep this quick)`);
  const ours = Object.fromEntries(LINE_TYPES.map((t) => [t.type, t])), theirs = Object.fromEntries(cl.LINE_TYPES.map((t) => [t.type, t]));
  check('our lead and arp settings are chunk-lines\' (bands, contours, rules, motions)', ['lead', 'arp'].every((n) => JSON.stringify([ours[n].bands, ours[n].contours, ours[n].rules, ours[n].motions]) === JSON.stringify([theirs[n].bands, theirs[n].contours, theirs[n].rules, theirs[n].motions])));
  check('the motions, rules and weights are chunk-lines\'', JSON.stringify(MOTIONS) === JSON.stringify(cl.MOTIONS) && JSON.stringify(DEFAULT_RULES) === JSON.stringify(cl.DEFAULT_RULES) && MAX_SLOTS === cl.MAX_SLOTS && RANGE_WIDTH === cl.RANGE_WIDTH);
}

console.log('\n— a timing guard (Composer/tests/time-lines.mjs has the full table of times)');
{
  const row = buildRow([4099, 4093, 4091, 4079]), frame = frameOf(row);
  const t0 = performance.now();
  for (const phase of downbeats(row, 16, 2, frame.rootFraction)) mineLines(row, buildCells(row, { bars: 2, slotsPerBar: 8, phase }), frame, { table: 'lean' });
  const ms = performance.now() - t0;
  check(`16,359 onsets, 4,177 tones: a lean 2 × 8 table at 2 downbeats in ${ms.toFixed(0)} ms`, ms < 3000);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
