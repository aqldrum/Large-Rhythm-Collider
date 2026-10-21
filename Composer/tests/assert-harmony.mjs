// assert-harmony.mjs — Composer/core/harmony.js. Exit non-zero on any mismatch.
//   • the vocabulary is QualityCatalog's (Playback/AdvancedPlayback), and every chord name reads back through
//     ProgressionSolver.parseChordSymbol to the chord's own classes (both run read-only, as Node modules)
//   • chords by hand on made-up bars: the lead's strong notes held, the most heard root, support, parsimony as the
//     tie-break, and the modulation rule with its off switch
//   • on real rows: every chord holds its bar's strong lead classes or counts the exception; every root tone is an
//     onset in its bar; the frames are centred on the roots; the modulations follow the rule; `modulation: false`
//     never retunes; every lead note is an onset in its window; deterministic
//   • lean and full timing on the three rows of phase 2
//   node Composer/tests/assert-harmony.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { defaultRoot, classOfCents } from '../core/frame.js';
import { downbeats } from '../core/lines.js';
import { harmonize, chooseChord, modulationStep, voiceLeading, phrasesOf, isStrongBeat, CHORD_QUALITIES, PC_NAMES, COMPOSER_HARMONY_VERSION } from '../core/harmony.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);
let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const mod = (v, n) => ((v % n) + n) % n;

console.log('Composer harmony');

console.log('\n— the vocabulary, against the Progression Solver\'s');
{
  const catalog = require(path.join(ROOT, 'Playback', 'AdvancedPlayback', 'QualityCatalog.js'));
  const solver = require(path.join(ROOT, 'Playback', 'AdvancedPlayback', 'ProgressionSolver.js'));
  let bad = '';
  for (const q of CHORD_QUALITIES) {
    const c = catalog.byId(q.id);
    if (q.id !== 'sus2' && (!c || c.intervals.join() !== q.intervals.join())) bad = `${q.id}: ${c?.intervals}`;
    for (let r = 0; r < 12; r++) {
      const name = `${PC_NAMES[r]}${q.suffix}`, parsed = solver.parseChordSymbol(name);
      const want = q.intervals.map((i) => mod(r + i, 12)).sort((a, b) => a - b).join();
      if (!parsed.ok || [...parsed.pitchClasses].sort((a, b) => a - b).join() !== want) { bad = `${name} reads as ${parsed.pitchClasses}`; break; }
    }
  }
  check(`${CHORD_QUALITIES.length} qualities: intervals as QualityCatalog has them (sus2 as the solver spells it), every name on every root read back by parseChordSymbol`, !bad, bad);
  check('triads, sevenths and sus chords', ['triad', 'seventh', 'sus'].every((k) => CHORD_QUALITIES.some((q) => q.kind === k)));
}

console.log('\n— chords by hand');
{
  const T = (list) => list.map(([cents, count], i) => ({ tone: i, cents, count, weight: 2 * count }));
  const L = (list) => list.map(([cents, strong]) => ({ cents, strong }));
  const name = (p) => p && `${PC_NAMES[p.rootPc]}${p.quality.suffix}`;
  const tones = T([[0, 10], [386.3, 8], [702, 8], [1088.3, 2]]);
  check('a C major bar with the lead on E: C', name(chooseChord(tones, L([[386.3, true]]))) === 'C');
  check('…the lead on B and E held by Cmaj7 over C', name(chooseChord(tones, L([[1088.3, true], [386.3, false]]))) === 'Cmaj7');
  const strongOff = chooseChord(tones, L([[1088.3, true]]));
  check('…the lead\'s strong note decides, even against support: B held', strongOff.intervals.map((i) => mod(strongOff.rootPc + i, 12)).includes(11) && strongOff.violations === 0, name(strongOff));
  const loud = chooseChord(T([[0, 5], [8, 9], [394, 6], [710, 6]]), []);
  check('the root is the most heard tone within ±15¢ of its class (8¢ over 0¢)', loud.root.cents === 8, `${loud.root.cents}`);
  // parsimony: the lead holds C and G; C, Cm, Csus4 and Gsus4 then tie on everything before it
  const two = T([[0, 1], [702, 1]]), lead = L([[0, true], [702, true]]);
  check('no chord before: the tie goes to the lower root, then the simpler quality (C)', name(chooseChord(two, lead)) === 'C');
  check('parsimony breaks the tie: after Cm, Cm', name(chooseChord(two, lead, { prevPcs: [0, 3, 7] })) === 'Cm');
  check('…after Gsus4 (C D G), Gsus4', name(chooseChord(two, lead, { prevPcs: [0, 2, 7] })) === 'Gsus4');
  check('voiceLeading by hand: C→Am 4, C→C 0, C→F#: 2+1+1 + 2+1+1... both ways', voiceLeading([0, 4, 7], [0, 4, 9]) === 4 && voiceLeading([0, 4, 7], [0, 4, 7]) === 0 && voiceLeading([0, 4, 7], [1, 6, 10]) === 1 + 2 + 1 + 1 + 2 + 1);

  // modulation
  const high = T([[30, 10], [416.3, 8], [732, 8]]);
  const up = chooseChord(high, [], { gridBase: 0, offset: 0, eachSide: 15 });
  check('a bar rooted 30¢ off the grid modulates: offset −30, a C major on the grid', up.modulate && Math.abs(up.offset + 30) < 1e-9 && name(up) === 'C', JSON.stringify({ m: up.modulate, o: up.offset, n: name(up) }));
  const stay = chooseChord(high, [], { gridBase: 0, offset: -30, eachSide: 15 });
  check('…the next bar on the same root stays: no retune', !stay.modulate && stay.offset === -30);
  const inside = chooseChord(T([[10, 10], [396.3, 8], [712, 8]]), [], { gridBase: 0, eachSide: 15 });
  check('a root 10¢ off (inside ±15) does not modulate', !inside.modulate && inside.offset === 0 && !inside.offGrid);
  const narrow = chooseChord(T([[10, 10], [396.3, 8], [712, 8]]), [], { gridBase: 0, eachSide: 5 });
  check('…at ±5 it does, by −10', narrow.modulate && Math.abs(narrow.offset + 10) < 1e-9);
  const off = chooseChord(T([[30, 10], [416.3, 8], [732, 8], [0, 1]]), [], { gridBase: 0, modulation: false });
  check('modulation off: only roots on the grid (the faint 0¢), never a retune', off.root.cents === 0 && !off.modulate && off.offset === 0 && !off.offGrid);
  const none = chooseChord(high, [], { gridBase: 0, modulation: false });
  check('modulation off with no root on the grid: the best root kept, flagged offGrid, no retune', none.root.cents === 30 && none.offGrid && !none.modulate && none.offset === 0);
  const s = modulationStep(1140, 0, 0, 15);
  check('modulationStep: 40¢ sharp of B snaps by −40 onto B', s.modulate && Math.abs(s.dev - 40) < 1e-6 && Math.abs(s.offset + 40) < 1e-6 && classOfCents(1140 + s.offset).pc === 11 && classOfCents(1140 + s.offset).dev === 0);
  check('…a root 49¢ flat snaps up by 49, a root at exactly ±15 stays', Math.abs(modulationStep(951, 0, 0, 15).offset - 49) < 1e-9 && !modulationStep(15, 0, 0, 15).modulate && !modulationStep(-15, 0, 0, 15).modulate);
  // folding is a relabel: −48.2¢ in, a root (1098¢) sounding 49.8¢ sharp of A#; the snap takes the offset to −98¢ either
  // way, and folded the grid NAMES it +2¢ with the root one class up (B, not A#), the pitch unmoved
  const unf = modulationStep(1098, -48.2, 0, 15, { fold: false }), fol = modulationStep(1098, -48.2, 0, 15);
  check('folding: the −98¢ case reads as +2¢, one class up; the sounding offset stays −98¢', Math.abs(unf.offset + 98) < 1e-9 && Math.abs(fol.offset + 98) < 1e-9
    && Math.abs(unf.named + 98) < 1e-9 && Math.abs(fol.named - 2) < 1e-9 && fol.shift === -1 && classOfCents(1098 + unf.offset).pc === 10 && classOfCents(1098 + fol.named).pc === 11, JSON.stringify({ unf, fol }));
  check('folding keeps every named offset in [−50, +50)', [[30, 0], [1140, 49], [951, -49], [649, 30], [10, -45]].every(([c, o]) => { const x = modulationStep(c, o, 0, 15).named; return x >= -50 && x < 50; }));
  check('strong beats: the downbeat and, in an even bar, the middle', isStrongBeat(0, 8) && isStrongBeat(4, 8) && !isStrongBeat(2, 8) && isStrongBeat(0, 5) && !isStrongBeat(2, 5));
}

console.log('\n— on real rows');
{
  let runs = 0, chords = 0, exceptions = 0, strongNotes = 0, mods = 0, offGrid = 0, phrases = 0, second = 0, bad = '';
  const qualities = new Map(CHORD_QUALITIES.map((q) => [q.id, 0]));
  const rows = [[8, 7, 6, 5], [11, 9, 7, 5], [19, 17, 16, 15], [119, 42, 15, 8], [768, 784], [768, 769], [504, 234, 520, 297], [2048, 2049], [97, 103, 37]];
  for (const layers of rows) for (const [bars, S] of [[2, 8], [4, 8], [8, 8], [4, 6], [3, 5]]) for (const anchors of ['even', 'partitioned']) for (const modulation of [true, false]) {
    const row = buildRow(layers), root = defaultRoot(row), e = 15;
    const cells = buildCells(row, { bars, slotsPerBar: S, anchors, phase: downbeats(row, bars * S, 1, root, { anchors })[0] });
    const h = harmonize(row, cells, { modulation, table: 'lean' });
    runs++; phrases += h.passes.phrases.length; second += h.passes.secondWins;
    const where = `${layers} ${bars}×${S} ${anchors} mod ${modulation}`;
    if (h.chords.length !== bars) { bad = `${where}: ${h.chords.length} chords`; break; }
    let offset = 0;
    const byBar = new Map(h.modulations.map((m) => [m.bar, m]));
    for (const c of h.chords) {
      chords++;
      if (c.empty) continue;
      if (modulation) qualities.set(c.quality, qualities.get(c.quality) + 1);
      // the root tone is an onset in its bar, and the bar's frame is centred on it
      if (row.tone[c.rootNode] !== c.rootTone || cells.slotOfNode[c.rootNode] < 0 || cells.slots[cells.slotOfNode[c.rootNode]].bar !== c.bar) { bad = `${where} bar ${c.bar}: root ${c.rootFraction} is not an onset in its bar`; break; }
      if (c.frame.root !== c.rootTone || c.frame.frameCentsEachSide !== e || c.pcs.join() !== c.intervals.map((i) => mod(c.rootPc + i, 12)).sort((a, b) => a - b).join()) { bad = `${where} bar ${c.bar}: frame or classes`; break; }
      // the modulation rule: offsets change only where a modulation is recorded
      const m = byBar.get(c.bar);
      if (m) { mods++; if (!modulation || Math.abs(m.fundamentalRatio - 2 ** (m.rawCents / 1200)) > 1e-12 || Math.abs(classOfCents(m.rawCents - m.cents).dev) > 1e-9) { bad = `${where}: a modulation ${JSON.stringify(m)}`; break; } offset = m.cents; }
      if (c.offsetCents !== offset) { bad = `${where} bar ${c.bar}: offset ${c.offsetCents} vs ${offset}`; break; }
      if (c.offGrid) offGrid++;
      // every strong note held, or counted
      const inBar = h.lead.notes.filter((n) => n.bar === c.bar && !n.outside);
      let strong = inBar.filter((n) => isStrongBeat(n.beat, S)); if (!strong.length && inBar.length) strong = [inBar[0]];
      strongNotes += strong.length;
      const unheld = strong.filter((n) => { const k = classOfCents(n.cents - c.rootCents); return !(Math.abs(k.dev) <= e + 1e-9 && c.intervals.includes(k.pc)); });
      if (unheld.length !== c.exceptions.length) { bad = `${where} bar ${c.bar}: ${unheld.length} strong notes off the chord, ${c.exceptions.length} counted`; break; }
      exceptions += c.exceptions.length;
    }
    if (bad) break;
    // the grid reading: on the base root's grid, each root sounds within ±frame of a step at its bar's offset, unless flagged
    const base = buildRow(layers).toneCents[root];
    for (const c of h.chords) if (!c.offGrid && Math.abs(classOfCents(c.rootCents + c.offsetCents - base).dev) > e + 1e-9) bad = `${where} bar ${c.bar}: root off the grid, unflagged`;
    for (const c of h.chords) if (!c.offGrid && classOfCents(c.rootCents + c.offsetCents - base).pc !== c.rootPc) bad = `${where} bar ${c.bar}: rootPc`;
    if (!modulation && h.modulations.length) bad = `${where}: retuned with modulation off`;
    for (let i = 0; i < h.modulations.length; i++) {
      const m = h.modulations[i], prev = i ? h.modulations[i - 1].cents : 0, c = h.chords[m.bar];
      if (Math.abs(classOfCents(c.rootCents + prev - base).dev) <= e + 1e-9) bad = `${where}: modulated at bar ${m.bar} with the root already on the grid`;
      if (Math.abs(classOfCents(c.rootCents + m.cents - base).dev) > 1e-6) bad = `${where}: bar ${m.bar}'s root not snapped onto the grid`;
    }
    // the lead's notes are onsets in their windows
    for (const n of h.lead.notes) if (row.tone[n.node] !== n.tone || cells.slotOfNode[n.node] !== n.cell) bad = `${where}: lead note at ${n.node}`;
    if (h.exceptions !== h.chords.reduce((k, c) => k + (c.exceptions?.length ?? 0), 0)) bad = `${where}: exception total`;
    if (bad) break;
  }
  check(`${runs} harmonizations, ${chords} chords: roots are onsets in their bars, frames on the roots, the modulation rule (${mods} retunes, ${offGrid} off-grid flags with it off or forced), the lead's notes onsets`, !bad, bad);
  check(`every strong lead note held or counted: ${exceptions} exceptions of ${strongNotes} strong notes`, !bad);
  console.log(`  (the second pass's lead was kept in ${second} of ${phrases} phrases)`);
  const sum = [...qualities.values()].reduce((a, b) => a + b, 0);
  console.log(`  (qualities over the ${sum} chords with modulation on: ${[...qualities].map(([q, n]) => `${q} ${n} (${(100 * n / sum).toFixed(1)}%)`).join(', ')})`);

  {
    const row = buildRow([768, 769]), cells = buildCells(row, { bars: 8, slotsPerBar: 8, phase: downbeats(row, 64, 1, defaultRoot(row))[0] });
    const loose = harmonize(row, cells, { table: 'lean', foldOffsets: false }), folded = harmonize(row, cells, { table: 'lean' });
    const unnamed = (t) => ({ scale: t.scale, bars: t.bars.map(({ name, ...b }) => b) });   // the names may fold; nothing else
    const deep = loose.modulations.find((m) => m.cents < -50 || m.cents >= 50);
    const same = deep && folded.modulations.find((m) => m.bar === deep.bar);
    check(`a real row: unfolded, 768:769 in 8 × 8 reaches ${deep ? deep.cents.toFixed(1) : '?'}¢ at bar ${deep?.bar}; folded it reads ${same ? same.cents.toFixed(1) : '?'}¢, its root named one class up`,
      !!deep && !!same && Math.abs(same.cents - (deep.cents + 100)) < 1e-6 && folded.chords[deep.bar].rootPc === mod(loose.chords[deep.bar].rootPc + 1, 12) && folded.modulations.every((m) => m.cents >= -50 && m.cents < 50));
    check('…and nothing sounds different: the same retunes, root tones, chords, targets (but their names) and lead',
      JSON.stringify(folded.chords.map((c) => [c.fundamentalRatio, c.rawOffsetCents, c.rootTone, c.quality, c.gridPcs])) === JSON.stringify(loose.chords.map((c) => [c.fundamentalRatio, c.rawOffsetCents, c.rootTone, c.quality, c.gridPcs]))
      && JSON.stringify(folded.modulations.map((m) => [m.bar, m.rawCents, m.fundamentalRatio])) === JSON.stringify(loose.modulations.map((m) => [m.bar, m.rawCents, m.fundamentalRatio]))
      && JSON.stringify(unnamed(folded.targets)) === JSON.stringify(unnamed(loose.targets)) && JSON.stringify(folded.lead.notes) === JSON.stringify(loose.lead.notes));
  }
  const row = buildRow([768, 769]), cells = buildCells(row, { bars: 8, slotsPerBar: 8, phase: downbeats(row, 64, 1, defaultRoot(row))[0] });
  const a = harmonize(row, cells), b = harmonize(row, cells);
  check('deterministic (the full table, twice)', JSON.stringify(a) === JSON.stringify(b) && a.version === COMPOSER_HARMONY_VERSION);
  check('8 bars of 8 slots: the lead in two phrases of 4 bars (32 slots each)', JSON.stringify(phrasesOf(cells)) === JSON.stringify([{ from: 0, bars: 4 }, { from: 4, bars: 4 }]) && a.lead.phrases.length === 2);
  check('the targets: a bar a chord in its own frame (root 0, its intervals, its tone), a parent scale over them',
    a.targets.bars.length === 8 && a.targets.bars.every((t, k) => t.root === 0 && t.tone === a.chords[k].rootFraction && t.chord.join() === a.chords[k].intervals.join() && t.scale.length === a.targets.scale.length)
    && a.chords.every((c) => c.gridPcs.every((p) => a.targets.scale.includes(p))));
  const r3 = buildRow([3, 2]);
  check('tooFewTones refused', harmonize(r3, buildCells(r3, { bars: 1, slotsPerBar: 4 })).tooFewTones === true);
  const given = harmonize(buildRow([8, 7, 6, 5]), buildCells(buildRow([8, 7, 6, 5]), { bars: 2, slotsPerBar: 8 }), { root: '3/2', referenceName: 'G' });
  check('a given root and reference name: rooted on 3/2, named from G', given.root === '3/2' && given.chords.every((c) => /^[A-G]/.test(c.name)));
}

console.log('\n— timing (lean and full, one downbeat, the rows of phase 2)');
for (const layers of [[4099, 4093, 4091, 4079], [768, 784], [768, 769]]) {
  const row = buildRow(layers), root = defaultRoot(row), out = [];
  for (const [bars, S] of [[2, 8], [4, 8], [8, 8]]) {
    const cells = buildCells(row, { bars, slotsPerBar: S, phase: downbeats(row, bars * S, 1, root)[0] });
    for (const table of ['lean', 'full']) { const t = performance.now(); harmonize(row, cells, { table }); out.push(`${bars}×${S} ${table} ${(performance.now() - t).toFixed(0)} ms`); }
  }
  console.log(`  ${layers.join(':')} (${row.n} onsets, ${row.tones.length} tones): ${out.join(', ')}`);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
