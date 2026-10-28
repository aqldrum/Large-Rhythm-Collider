// assert-drums.mjs — the Drums (Perc) part (Composer/core/drums.js, drum-patterns.js), against the row it plays:
//   • the bar's 4 beats: a 4-partition of S as Partitions cuts a block, any S (odd, prime, under 4 on sub-slots)
//   • the default backbeat: a kick on every bar's downbeat (bar 1's on the phase itself), snares on beats 2 and 4
//   • every stroke an onset the row plays: its tick a row onset, its time compose.js' own, its strikes the row's; a
//     stroke landed on a whole slot is the onset cells.js finds nearest that anchor in its swing-0.5 window
//   • determinism by seed; the seed moves only `against`
//   • the partition line starts on the downbeat, from a layer striking it, Partitions' secondary pattern exactly
//   • curated patterns land through the beats on every S; two-bar claves alternate; fills and crashes at phrase ends
//   • with / against read the lead and comping; the drums change no other part (every mode); refusals; options
//   node Composer/tests/assert-drums.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { compose } from '../core/compose.js';
import { buildRow } from '../core/row.js';
import { buildCells, partitionSizes } from '../core/cells.js';
import { arrangeDrums, beatsOf, drumGrid, downbeatLayers, partitionLine, selectLights, levelOneLights, isPrime, DRUM_MODES, LAYERED_MODES, DEFAULT_KIT, FILL_MIN_PHRASE_BARS } from '../core/drums.js';
import { DRUM_PATTERNS, PATTERN_NAMES, FILL, patternStrokes } from '../core/drum-patterns.js';
import { phrasesOf } from '../core/harmony.js';
import { RHYTHMS } from './rhythms.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const mod = (v, n) => ((v % n) + n) % n;
const EPS = 1e-9;
const throws = (f, re) => { try { f(); return false; } catch (e) { return !re || re.test(String(e.message)); } };

// Partitions' own Euclid (the page's class, run in a sandbox) and its secondary selection, as PartitionsPlayback has it
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.resolve(HERE, '..', '..', 'Playback', 'Partitions', 'PartitionsDistribution.js'), 'utf8'), sandbox);
const PD = sandbox.window.PartitionsDistribution;
const secondaryAllowed = (steps, pulses) => {   // PartitionsPlayback.getSecondaryAllowedSet, line for line
  let pattern = PD.generateEuclideanPattern(steps, pulses);
  const firstOn = pattern.indexOf(1);
  if (firstOn > 0) pattern = pattern.slice(firstOn).concat(pattern.slice(0, firstOn));
  const allowed = []; pattern.forEach((flag, i) => { if (flag) allowed.push(i); });
  return allowed;
};

// the cases: Compose's own meters, and asked meters over odd and prime S
const CASES = [];
for (const [L, T] of [[[8, 7, 6, 5], 4], [[41, 42, 43], 8], [[19, 17, 16, 15], 6], [[119, 42, 15, 8], 8], [[768, 769], 8], [[11, 9, 7, 5], 6], [[97, 103, 37], 5]]) CASES.push([L, T, {}]);
for (const [L, T] of [[[119, 42, 15, 8], 8], [[41, 42, 43], 8], [[19, 17, 16, 15], 6]]) for (const [bars, slotsPerBar] of [[4, 5], [2, 7], [4, 3], [2, 11], [1, 13], [8, 6], [2, 2]]) CASES.push([L, T, { bars, slotsPerBar }]);
const specs = CASES.map(([L, T, ov]) => ({ name: `${L.join(':')} ${T}s ${ov.bars ? `${ov.bars}×${ov.slotsPerBar}` : 'auto'}`, L, T, spec: compose(L, T, { seed: 3, overrides: { ...ov } }) }));
const rowOf = new Map();
const row = (L) => { const k = L.join(':'); if (!rowOf.has(k)) rowOf.set(k, buildRow(L)); return rowOf.get(k); };
const nodeAt = (r, tick) => { let lo = 0, hi = r.n - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (r.tick[m] === tick) return m; if (r.tick[m] < tick) lo = m + 1; else hi = m - 1; } return -1; };

console.log('Composer drums');

console.log('\n— the bar\'s 4 beats');
{
  let bad = '';
  for (let S = 1; S <= 32 && !bad; S++) {
    const b = beatsOf(S), m = Math.max(1, Math.ceil(4 / S)), want = partitionSizes(S * m, 4).sizes;
    const sum = b.sizes.reduce((x, y) => x + y, 0), spread = Math.max(...b.sizes) - Math.min(...b.sizes);
    if (b.m !== m || JSON.stringify(b.sizes) !== JSON.stringify(want) || sum !== S * m || spread > 1 || b.pos[0] !== 0 || b.pos.some((p, i) => i && p <= b.pos[i - 1]) || b.pos[3] >= S) bad = `S ${S}: ${JSON.stringify(b)}`;
  }
  check('S = 1..32: 4 beats, Partitions\' block cut of S (S·m sub-slots under 4), sizes within one, from the downbeat', !bad, bad);
  check('odd and prime S: 5 → 0 1 2 3, 7 → 0 2 4 6, 11 → 0 3 6 9, 13 → 0 3 6 9; 6 → 0 2 3 5; 3 on half slots → 0 1 1.5 2.5',
    [[5, '0,1,2,3'], [7, '0,2,4,6'], [11, '0,3,6,9'], [13, '0,3,6,9'], [6, '0,2,3,5'], [3, '0,1,1.5,2.5'], [8, '0,2,4,6']].every(([S, w]) => beatsOf(S).pos.join() === w), [5, 7, 11, 13, 6, 3].map((S) => `${S}: ${beatsOf(S).pos.join(' ')}`).join('; '));
}

console.log('\n— the default backbeat');
{
  let kickMiss = '', bar1 = '', snareMiss = '', meters = new Set(), bars = 0, silent = 0;
  for (const { name, spec } of specs) {
    const d = spec.drums, S = spec.knobs.slotsPerBar, N = spec.knobs.bars, beats = beatsOf(S), [pn, pd] = spec.knobs.phase;
    meters.add(S); silent += d.stats.silent;
    if (d.mode !== 'backbeat' || !d.enabled) { kickMiss = `${name}: mode ${d.mode}`; break; }
    for (let k = 0; k < N; k++) {
      bars++;
      const at = (v, q) => d.hits.some((h) => h.voice === v && h.bar === k && Math.abs(h.pos - q) < EPS);
      if (!at('kick', 0)) kickMiss ||= `${name}: bar ${k + 1} has no downbeat kick`;
      if (!d.bars[k].fill && !(at('snare', beats.pos[1]) && at('snare', beats.pos[3]))) snareMiss ||= `${name}: bar ${k + 1} snares ${d.hits.filter((h) => h.voice === 'snare' && h.bar === k).map((h) => h.pos)} not at ${beats.pos[1]}, ${beats.pos[3]}`;
      if (d.bars[k].fill && !at('snare', beats.pos[1])) snareMiss ||= `${name}: fill bar ${k + 1} lost its beat-2 snare`;
      if (!at('kick', beats.pos[2]) && !d.bars[k].fill) kickMiss ||= `${name}: bar ${k + 1} has no beat-3 kick`;
    }
    const k0 = d.hits.find((h) => h.voice === 'kick' && h.bar === 0 && h.pos === 0);
    if (!(k0 && k0.time === 0 && k0.tick * pd === pn * spec.stats.grid)) bar1 ||= `${name}: bar 1's kick at ${k0?.time} (tick ${k0?.tick})`;
  }
  check(`a kick on every bar's downbeat and on beat 3 (${bars} bars, S in ${[...meters].sort((a, b) => a - b).join(' ')})`, !kickMiss, kickMiss);
  check('bar 1\'s kick is the phase onset itself, at time 0', !bar1, bar1);
  check('snares on the 4-partition\'s beats 2 and 4 in every bar (a fill bar keeps beat 2, its second half the fill\'s)', !snareMiss, snareMiss);
  check(`no stroke went silent on these rows (${silent})`, silent === 0);
  const hats = specs.every(({ spec }) => { const d = spec.drums, S = spec.knobs.slotsPerBar; return d.bars.every((b) => b.fill || new Set(d.hits.filter((h) => h.voice === 'hat' && h.bar === b.bar).map((h) => h.pos)).size === S || d.stats.merged > 0); });
  check('a hat on every slot of every bar outside the fills (unless two slots landed on one onset)', hats);
}

console.log('\n— every stroke an onset the row plays');
{
  let notOnset = '', timeMiss = '', strikeMiss = '', nearMiss = '', strokes = 0, compared = 0;
  const allModes = specs.slice(0, 10).flatMap(({ name, L, T, spec }) => DRUM_MODES.map((mode) => ({ name: `${name} ${mode}`, L, spec, d: arrangeDrums(spec, { mode }) })));
  for (const { name, L, spec, d } of [...specs.map((x) => ({ ...x, d: x.spec.drums })), ...allModes]) {
    const r = row(L), [pn, pd] = spec.knobs.phase, phaseX = pn / pd, T = spec.knobs.cycleSeconds;
    for (const h of d.hits) {
      strokes++;
      const i = nodeAt(r, h.tick);
      if (i < 0) { notOnset ||= `${name}: ${h.voice} at tick ${h.tick} is no onset`; continue; }
      if (h.time !== mod(r.tick[i] / r.grid - phaseX, 1) * T) timeMiss ||= `${name}: ${h.voice} at ${h.time}`;
      if (h.strikes !== r.strikes[i]) strikeMiss ||= `${name}: ${h.voice} strikes ${h.strikes}, the row ${r.strikes[i]}`;
    }
  }
  // a stroke landed on a whole slot is the onset nearest that slot's anchor in cells.js' swing-0.5 window (exact BigInt)
  for (const { name, L, spec } of specs) {
    const r = row(L), k = spec.knobs, cells = buildCells(r, { bars: k.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase, swing: 0.5 });
    for (const h of spec.drums.hits) {
      if (h.snap !== 'slot' || Math.abs(h.pos - Math.round(h.pos)) > EPS) continue;
      const slot = cells.slots[h.slot], want = slot.tones.length ? slot.tones[0].node : -1;
      compared++;
      if (want < 0 || r.tick[want] !== h.tick) nearMiss ||= `${name}: ${h.voice} in slot ${h.slot} at tick ${h.tick}, cells' nearest ${want < 0 ? 'none' : r.tick[want]}`;
    }
  }
  check(`every stroke's tick is an onset of the row (${strokes} strokes, every mode on ten rows)`, !notOnset, notOnset);
  check('…its time is compose.js\' own for that onset, so a stroke on a note\'s onset sounds with it', !timeMiss, timeMiss);
  check('…and its strikes are the row\'s (how many layers strike there)', !strikeMiss, strikeMiss);
  check(`a stroke on a whole slot is the onset cells.js finds nearest that anchor in its swing-0.5 window (${compared})`, !nearMiss && compared > 100, nearMiss);
  // a stroke aimed between anchors (under 4 slots a bar) lands within a sub-slot of its place, inside its own slot
  let subN = 0, subBad = '';
  for (const { name, spec } of specs.filter((x) => x.spec.knobs.slotsPerBar < 4)) {
    const g = drumGrid(spec), m = beatsOf(g.S).m;
    for (const h of spec.drums.hits) {
      if (h.pos % 1 === 0) continue;
      subN++;
      const at = h.bar * g.S + h.pos, r = g.relOf(h.tick), lo = g.rAt(at - 1 / m), hi = g.rAt(at + 1 / m);
      const inSlot = h.slot === h.bar * g.S + Math.floor(h.pos);
      if (!inSlot || !((r > lo && r <= hi) || (r - 1 > lo && r - 1 <= hi))) subBad ||= `${name}: ${h.voice} aimed at ${h.pos} of bar ${h.bar + 1} landed at ${r}`;
    }
  }
  check(`under 4 slots a bar, the beats between anchors land on real onsets near their place, inside their slots (${subN})`, subN > 0 && !subBad, subBad);
}

console.log('\n— determinism and the seed');
{
  const a = compose([41, 42, 43], 8, { seed: 5 }), b = compose([41, 42, 43], 8, { seed: 5 });
  check('the same rhythm and seed: byte-identical drums', JSON.stringify(a.drums) === JSON.stringify(b.drums));
  check('arranging again from the spec gives the same drums as Compose did, however the defaults are spelled', JSON.stringify(arrangeDrums(a, {})) === JSON.stringify(a.drums)
    && JSON.stringify(arrangeDrums(a, { enabled: true, mode: 'backbeat', fills: true, kit: { ...DEFAULT_KIT } })) === JSON.stringify(a.drums));
  let same = true, moved = false;
  for (const { spec } of specs) for (const mode of DRUM_MODES) {
    const x = arrangeDrums(spec, { mode, seed: 1 }), y = arrangeDrums(spec, { mode, seed: 1 }), z = arrangeDrums(spec, { mode, seed: 2 });
    if (JSON.stringify(x) !== JSON.stringify(y)) same = false;
    if (mode !== 'against' && JSON.stringify(x.hits) !== JSON.stringify(z.hits)) same = false;
    if (mode === 'against' && JSON.stringify(x.hits) !== JSON.stringify(z.hits)) moved = true;
  }
  check('every mode on every case: the same seed, the same drums; only `against` reads the seed', same);
  check('…and against moves with it somewhere', moved);
  check('the drums\' seed is the spec\'s by default', JSON.stringify(arrangeDrums(a, { mode: 'against' })) === JSON.stringify(arrangeDrums(a, { mode: 'against', seed: 5 })));
}

console.log('\n— the partition line, from the downbeat');
{
  let bad = '', phased = 0, n = 0;
  for (const { name, spec } of specs) {
    const d = arrangeDrums(spec, { mode: 'partition' }), g = drumGrid(spec), [pn, pd] = spec.knobs.phase, owners = downbeatLayers(spec);
    const line = partitionLine(spec, g), L = g.layers.find((x) => x.name === line.name);
    if (pn !== 0) phased++;
    n++;
    if (!owners.length || !owners.some((o) => o.name === line.name)) { bad ||= `${name}: ${line.name} does not strike the downbeat`; continue; }
    // the layer strikes the downbeat: phase · v is whole, and that pulse is the downbeat's
    const own = owners.find((o) => o.name === line.name);
    if (own.pulse * pd !== pn * own.value) bad ||= `${name}: pulse ${own.pulse} is not the phase`;
    const perc = d.hits.filter((h) => h.voice === 'perc' && h.snap === 'layer');
    const want = Math.min(L.value, g.N * g.S);
    if (perc.length !== want || line.hits !== want) bad ||= `${name}: ${perc.length} strokes, not min(${L.value}, ${g.N * g.S})`;
    if (!(perc[0] && perc[0].time === 0 && perc[0].bar === 0 && perc[0].pos === 0)) bad ||= `${name}: the line starts at ${perc[0]?.time}, not the downbeat`;
    if (perc.some((h) => h.tick % L.step !== 0)) bad ||= `${name}: a stroke off layer ${line.name}`;
    // Partitions exactly: its secondary pattern over the layer's v pulses (blocks), counted from the downbeat
    const allowed = secondaryAllowed(L.value, want), ticks = allowed.map((i) => mod(own.pulse + i, L.value) * L.step);
    if (JSON.stringify(selectLights(L.value, want)) !== JSON.stringify(allowed) || JSON.stringify([...ticks].sort((x, y) => x - y)) !== JSON.stringify(perc.map((h) => h.tick).sort((x, y) => x - y))) bad ||= `${name}: not Partitions' E(${want}, ${L.value}) from pulse ${own.pulse}`;
    const backbeat = arrangeDrums(spec, {}).hits.filter((h) => h.voice !== 'perc');
    if (JSON.stringify(d.hits.filter((h) => h.voice !== 'perc')) !== JSON.stringify(backbeat)) bad ||= `${name}: the backbeat under the line moved`;
  }
  check(`the line is a layer that strikes the downbeat, min(v, N·S) of its pulses, the first on the downbeat (${n} cases, ${phased} off the cycle's start)`, !bad && phased > 3, bad);
  check('…exactly Partitions\' secondary pattern (PartitionsDistribution, run as the page has it) over that layer\'s pulses, the backbeat under it unmoved', !bad);
  const s = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { phase: [0, 1] } }), all = downbeatLayers(s);
  const pick = partitionLine(s, drumGrid(s));
  check(`a downbeat every layer strikes (phase 0 of 8:7:6:5): ${all.map((o) => o.name).join(', ')}; the one with pulses a bar nearest S (${s.knobs.slotsPerBar}) is ${pick.name}`, all.length === 4 && pick.name === 'C' && pick.value === 6);
  check('a layer asked: by name or value, when it strikes the downbeat; refused when it does not', partitionLine(s, drumGrid(s), { layer: 'A' }).value === 8 && partitionLine(s, drumGrid(s), { layer: 6 }).name === 'C'
    && throws(() => partitionLine(specs[1].spec, drumGrid(specs[1].spec), { layer: 'A' }), /does not strike the downbeat/));
  check('hitsPerBar sets the count (N·hitsPerBar, at most v)', partitionLine(specs[1].spec, drumGrid(specs[1].spec), { hitsPerBar: 3 }).hits === 3 * specs[1].spec.knobs.bars);
  // step 4c-prime: p is a seeded random prime above the cells (assert-drum-prime.mjs)
  const p12 = levelOneLights(drumGrid(s), { source: 'prime' }).count;
  check(`the two-level prime source is built (step 4c, assert-drum-prime.mjs): a seeded prime above the 2 × 3·2 cells lights by default (${p12})`, isPrime(p12) && p12 > 12 && p12 <= 199 && throws(() => levelOneLights(drumGrid(s), { source: 'prime', p: 8 }), /prime/));
}

console.log('\n— curated patterns');
{
  check(`${PATTERN_NAMES.length} patterns (${PATTERN_NAMES.join(', ')}), each voice line steps × bars long`, PATTERN_NAMES.length >= 8 && [...PATTERN_NAMES.map((n) => DRUM_PATTERNS[n]), FILL].every((p) => patternStrokes(p).length > 0));
  let bad = '', n = 0;
  for (const { name, spec } of specs) {
    const S = spec.knobs.slotsPerBar, b = beatsOf(S), phrases = phrasesOf({ bars: spec.knobs.bars, slotsPerBar: S });
    for (const pname of PATTERN_NAMES) {
      const pat = DRUM_PATTERNS[pname], d = arrangeDrums(spec, { mode: pname, fills: false });
      n++;
      // independently: a stroke at fraction f of the bar → beat ⌊4f⌋, then its share of that beat's sub-slots, rounded
      for (let k = 0; k < spec.knobs.bars; k++) {
        const ph = phrases.find((x) => k >= x.from && k < x.from + x.bars), pb = (k - ph.from) % pat.bars;
        const want = new Set();
        for (const s of patternStrokes(pat)) { if (s.bar !== pb) continue; const x = 4 * s.f, bt = Math.floor(x + EPS), u = Math.round(b.startU[bt] + (x - bt) * b.sizes[bt] + EPS); if (u < S * b.m) want.add(`${s.voice}@${u / b.m}`); }
        const got = new Set(d.hits.filter((h) => h.bar === k).map((h) => `${h.voice}@${h.pos}`));
        // two places may land on one onset (then one stroke): every stroke is wanted, and every place is struck unless merged or silent
        if ([...got].some((x) => !want.has(x)) || (got.size < want.size && d.stats.merged === 0 && d.stats.silent === 0)) { bad ||= `${name} ${pname} bar ${k + 1}: ${[...got].join(' ')} vs ${[...want].join(' ')}`; }
      }
    }
  }
  check(`every pattern on every case lands each stroke at its fraction of the bar, through the beats (${n})`, !bad, bad);
  const s8 = compose([119, 42, 15, 8], 8, { seed: 1 }), pos = (d, v, k = 1) => d.hits.filter((h) => h.voice === v && h.bar === k).map((h) => h.pos).join(' ');
  const rock = arrangeDrums(s8, { mode: 'rock' }), funk16 = arrangeDrums(compose([119, 42, 15, 8], 8, { seed: 1, overrides: { slotsPerBar: 16 } }), { mode: 'funk' });
  check(`rock on 8 slots: kick ${pos(rock, 'kick')}, snare ${pos(rock, 'snare')}, a hat every slot`, pos(rock, 'kick') === '0 4' && pos(rock, 'snare') === '2 6' && pos(rock, 'hat') === '0 1 2 3 4 5 6 7');
  check(`funk on 16 slots keeps its sixteenths: kick ${pos(funk16, 'kick')}`, pos(funk16, 'kick') === '0 2 6 10 13');
  const son = arrangeDrums(s8, { mode: 'son', fills: false });
  check(`the son clave alternates its two bars: ${pos(son, 'perc', 0)} | ${pos(son, 'perc', 1)}`, pos(son, 'perc', 0) === '0 3 6' && pos(son, 'perc', 1) === '2 4' && pos(son, 'perc', 2) === '0 3 6');
  const r3 = arrangeDrums(compose([8, 7, 6, 5], 4, { seed: 1 }), { mode: 'rock' });
  check(`rock on 3 slots: its quarter strokes stay four, on half slots (kick ${pos(r3, 'kick', 0)}, snare ${pos(r3, 'snare', 0)})`, pos(r3, 'kick', 0) === '0 1.5' && pos(r3, 'snare', 0) === '1 2.5');
}

console.log('\n— fills, with and against');
{
  const s = compose([41, 42, 43], 8, { seed: 1 }), d = s.drums, N = s.knobs.bars, S = s.knobs.slotsPerBar, from3 = beatsOf(S).pos[2];
  const fillBars = d.bars.filter((b) => b.fill).map((b) => b.bar);
  check(`a ${N}-bar phrase: bar ${N} fills, bar 1 opens with a crash (${d.bars.map((b) => b.why).join(' | ')})`, fillBars.join() === String(N - 1) && d.bars[0].crash && d.hits.some((h) => h.voice === 'cym' && h.bar === 0 && h.pos === 0));
  const fillHalf = d.hits.filter((h) => h.bar === N - 1 && h.pos >= from3 - EPS);
  check(`the fill's half: no hat, the snare rising (${fillHalf.filter((h) => h.voice === 'snare').map((h) => h.velocity.toFixed(2)).join(' ')})`, !fillHalf.some((h) => h.voice === 'hat') && fillHalf.filter((h) => h.voice === 'snare').length >= 3
    && fillHalf.filter((h) => h.voice === 'snare').every((h, i, a) => !i || h.velocity >= a[i - 1].velocity - 0.1));
  check('fills off: no fill, no crash', arrangeDrums(s, { fills: false }).bars.every((b) => !b.fill && !b.crash) && !arrangeDrums(s, { fills: false }).hits.some((h) => h.voice === 'cym'));
  const short = specs.filter(({ spec }) => phrasesOf({ bars: spec.knobs.bars, slotsPerBar: spec.knobs.slotsPerBar }).every((p) => p.bars < FILL_MIN_PHRASE_BARS));
  check(`phrases under ${FILL_MIN_PHRASE_BARS} bars do not fill (${short.length} cases)`, short.length > 0 && short.every(({ spec }) => spec.drums.bars.every((b) => !b.fill)));
  const big = compose([4099, 4093, 4091, 4079], 16, { seed: 1 });
  check(`the 16k row's ${big.knobs.bars} bars: two phrases, fills on bars 4 and 8`, big.drums.bars.filter((b) => b.fill).map((b) => b.bar + 1).join() === '4,8');
  let withBad = '', againstBad = '';
  for (const { name, spec } of specs) {
    // the comp in chords: its strokes, one a slot, not the strum's tones (COMP_ARP_ORDER.md P9); in notes, its notes
    const compPart = spec.parts.find((p) => p.id === 'comp'), lead = spec.parts.find((p) => p.id === 'lead').notes, comp = compPart.strokes ?? compPart.notes, Sx = spec.knobs.slotsPerBar;
    const busy = new Set([...lead, ...comp].map((n) => n.slot));
    // the mode's own line, without the clave on the perc (Amendment 1, R4: perc 'pattern'; the clave over it is checked below)
    const w = arrangeDrums(spec, { mode: 'with', perc: 'pattern' }).hits.filter((h) => h.voice === 'perc');
    // (two slots may hold one onset: a lead note's slot is its window's, a comping note's its place's — then one stroke)
    const ticks = new Set(w.map((h) => h.tick)), first = (j) => (lead.find((n) => n.slot === j) ?? comp.find((n) => n.slot === j));
    if ([...busy].some((j) => !ticks.has(first(j).tick)) || w.some((h) => ![...lead, ...comp].some((n) => n.slot === h.slot && n.tick === h.tick))) withBad ||= `${name}: ${w.length} strokes for ${busy.size} busy slots`;
    const a = arrangeDrums(spec, { mode: 'against', perc: 'pattern' }).hits.filter((h) => h.voice === 'perc');
    const perBar = new Map(); for (const h of a) perBar.set(h.bar, (perBar.get(h.bar) || 0) + 1);
    if (a.some((h) => busy.has(h.slot)) || [...perBar.values()].some((c) => c > Math.max(1, Math.floor(Sx / 2)))) againstBad ||= `${name}: ${a.length} strokes`;
  }
  check('with: a perc stroke on every slot the lead or comping strikes, on that note\'s (that stroke\'s) own onset', !withBad, withBad);
  check('against: perc only on slots both leave empty, at most ⌊S/2⌋ a bar', !againstBad, againstBad);
  // R4: backbeat, with and against add the clave on the perc, on its landed strokes; the line's own strokes stay
  let claveBad = '';
  for (const { name, spec } of specs) for (const mode of ['backbeat', 'with', 'against']) {
    const d = arrangeDrums(spec, { mode }), line = arrangeDrums(spec, { mode, perc: 'pattern' }), clave = new Set(spec.clave.strokes.map((x) => x.tick));
    const perc = d.hits.filter((h) => h.voice === 'perc'), own = line.hits.filter((h) => h.voice === 'perc');
    if (!spec.clave.strokes.every((x) => perc.some((h) => h.tick === x.tick)) || !own.every((h) => perc.some((x) => x.tick === h.tick)) || perc.some((h) => !clave.has(h.tick) && !own.some((x) => x.tick === h.tick))) claveBad ||= `${name} ${mode}`;
    if (JSON.stringify(d.hits.filter((h) => h.voice !== 'perc')) !== JSON.stringify(line.hits.filter((h) => h.voice !== 'perc'))) claveBad ||= `${name} ${mode}: the other voices moved`;
  }
  check('the clave on the perc (R4): backbeat, with and against play its landed strokes over their own line, the other voices unmoved', !claveBad, claveBad);
  const mixed = arrangeDrums(s, { perBar: { 1: 'halftime', 2: 'partition' } });
  check('a bar may have a mode of its own (perBar)', mixed.bars[1].mode === 'halftime' && mixed.bars[2].mode === 'partition' && mixed.hits.some((h) => h.bar === 2 && h.snap === 'layer') && !mixed.hits.some((h) => h.bar !== 2 && h.snap === 'layer'));
}

console.log('\n— the drums move nothing else');
{
  let bad = '', n = 0;
  // pinned to Sparse · Free (BASS_VOICING_ORDER.md Amendment 2, P28): Compose's own bass now covers the kick, so the drums
  // move it by design; the check below is that they move nothing else
  const own = { bass: { density: 'sparse', lock: 'free' } };
  let bassOnly = 0, kicked = 0;
  for (const [L, T] of [[[8, 7, 6, 5], 4], [[41, 42, 43], 8], [[119, 42, 15, 8], 8], [[768, 769], 8], [[97, 103, 37], 5]]) {
    const plain = JSON.stringify(compose(L, T, { seed: 2, drums: false, overrides: own }));
    // the default: the drums move the bass (Moving · Kick; off, Moving · Free) and its decision and stats, nothing else
    const strip = (x) => { const { drums: _d, ...r } = x; return JSON.stringify({ ...r, parts: r.parts.filter((p) => p.id !== 'bass'), decisions: r.decisions.filter((d) => d.what !== 'bass'), stats: { ...r.stats, notes: { ...r.stats.notes, bass: 0 }, bassRooted: '' } }); };
    const off = compose(L, T, { seed: 2, drums: false }), on = compose(L, T, { seed: 2 });
    if (strip(off) === strip(on)) bassOnly++;
    if (on.parts.find((p) => p.id === 'bass').bass.stats.lock === 'kick' && off.parts.find((p) => p.id === 'bass').bass.stats.lock === 'free') kicked++;
    for (const mode of [...LAYERED_MODES, 'son', 'funk']) {
      const s = compose(L, T, { seed: 2, drums: { mode, kit: { hat: '' } }, overrides: own }), { drums, ...rest } = s;
      n++;
      if (!drums || drums.mode !== mode || JSON.stringify(rest) !== plain) bad ||= `${L.join(':')} ${mode}`;
    }
  }
  check(`compose with drums of every kind (the bass pinned Sparse · Free): every other field byte-identical to compose without them (${n})`, !bad, bad);
  check(`Compose's own bass (Moving · Kick): the drums move only the bass, its decision and its stats; on, it covers the kick, off it lands anywhere (${bassOnly}/5, ${kicked}/5)`, bassOnly === 5 && kicked === 5);
  check('drums: false leaves them out; a refusal has none', !('drums' in compose([8, 7, 6, 5], 4, { drums: false })) && !('drums' in compose([3, 2], 4)) && arrangeDrums({ refused: true }) === null);
  check('the default kit is the made kit of Audio/drums; a voice set to \'\' is off', JSON.stringify(specs[0].spec.drums.kit) === JSON.stringify(DEFAULT_KIT) && arrangeDrums(specs[0].spec, { kit: { hat: '' } }).kit.hat === '');
  check('options are checked: an unknown option or mode is refused', throws(() => arrangeDrums(specs[0].spec, { style: 'x' }), /no drum option/) && throws(() => arrangeDrums(specs[0].spec, { mode: 'polka' }), /mode must be/));
  check('the drums are JSON (a spec stays serialisable)', JSON.stringify(JSON.parse(JSON.stringify(specs[1].spec.drums))) === JSON.stringify(specs[1].spec.drums));
  const big = compose([4099, 4093, 4091, 4079], 16, { seed: 1, drums: false }), t0 = performance.now();
  for (let i = 0; i < 20; i++) for (const mode of DRUM_MODES) arrangeDrums(big, { mode });
  const ms = (performance.now() - t0) / (20 * DRUM_MODES.length);
  check(`arranging from a spec is cheap enough to be live: ${ms.toFixed(2)} ms a mode on the 16k row`, ms < 5);
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
