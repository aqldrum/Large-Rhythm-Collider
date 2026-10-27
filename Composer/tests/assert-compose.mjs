// assert-compose.mjs — Composer/core/compose.js and compose-worker.js. Exit non-zero on any mismatch.
//   • determinism: the same layers, cycle and seed give byte-identical JSON
//   • every note of every part is an onset of the row: node, tick, ratio and time agree; hz is its formula
//   • per-part legato: on, a note holds to the part's (a chord voice's) next note; off, its slot or the gap if shorter;
//     a struck sound in legato retriggers on every note, a held one only on its first
//   • overrides, one by one; each gate's refusal; the tempo inside 90–130 BPM whenever a bar count allows it
//   • the root by its ±frame cluster and the phase from where the cluster sounds; settling (settlePasses 0 byte-identical
//     to e3909e1, the override, the stats, every note still an onset of the row)
//   • the module worker, through a fake worker scope
//   • timing: Compose lean on the three rows of phase 2 (target under 1 s), and full
//   node Composer/tests/assert-compose.mjs
import { buildRow } from '../core/row.js';
import { buildCells } from '../core/cells.js';
import { classOfCents, defaultRoot } from '../core/frame.js';
import { downbeats } from '../core/lines.js';
import { composeCases, normSpec, sha, COMPOSE_HASHES } from './settle-baseline.mjs';
import { compose, chooseMeter, articulate, isStruck, seededRandom, PART_IDS, SOUND_PAIRS, TEMPO_RANGE, BAR_CHOICES, BEATS_PER_BAR, LEAD_TARGET_HZ, COMPOSER_SPEC_VERSION } from '../core/compose.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const mod = (v, n) => ((v % n) + n) % n;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));

console.log('Composer compose');
const CASES = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 6], [[119, 42, 15, 8], 8], [[768, 769], 8], [[97, 103, 37], 5], [[19, 17, 16, 15], 3]];

/** every note against the row, and the legato rule, for one spec → '' or what broke */
function audit(spec) {
  const row = buildRow(spec.input.layers), k = spec.knobs, T = k.cycleSeconds, phaseX = k.phase[0] / k.phase[1];
  const cells = buildCells(row, { bars: k.bars, slotsPerBar: k.slotsPerBar, anchors: k.anchors, phase: k.phase });
  const fr = spec.chords.map((c) => c.fundamentalRatio);
  for (const part of spec.parts) {
    for (const n of part.notes) {
      const [num, den] = n.ratio.split('/').map(Number);
      // a comp tone borrowed in chords (COMP_ARP_ORDER.md P4) sounds at its stroke's onset with its source voice's tone (`from`)
      if (row.tick[n.node] !== n.tick || row.tones[row.tone[n.borrowed ? n.from : n.node]] !== n.ratio) return `${part.id}: node ${n.node} is not its tick and ratio`;
      if (!near(n.time, mod(n.tick / row.grid - phaseX, 1) * T)) return `${part.id}: node ${n.node} is not at its own time`;
      if (!Number.isInteger(n.octave) || !near(n.hz, k.baseHz * (num / den) * 2 ** n.octave * fr[n.bar])) return `${part.id}: hz`;
      if (!(n.duration >= 0 && n.time + n.duration <= T + 1e-9 && n.velocity > 0 && n.velocity <= 1)) return `${part.id}: duration or velocity`;
    }
    // legato, voice by voice (the comp in chords too, each tone held at most to its stroke's `holdTo`)
    const voiced = part.id === 'chords' || (part.id === 'comp' && part.strokes);
    const groups = voiced ? [...new Set(part.notes.map((n) => n.voice))].map((v) => part.notes.filter((n) => n.voice === v)) : [part.notes];
    for (const g of groups) {
      const s = [...g].sort((a, b) => a.time - b.time || a.node - b.node);
      for (let i = 0; i < s.length; i++) {
        const next = i + 1 < s.length ? s[i + 1].time : T, gap = Math.max(0, (s[i].holdTo != null ? Math.min(next, s[i].holdTo) : next) - s[i].time), slot = cells.slots[s[i].slot].length * T;
        const want = part.legato ? gap : Math.min(slot, gap);
        if (!near(s[i].duration, want, 1e-9)) return `${part.id}: note ${i} lasts ${s[i].duration}, legato ${part.legato} wants ${want}`;
        const re = !part.legato || part.struck || i === 0;
        if (s[i].retrigger !== re) return `${part.id}: note ${i} retrigger ${s[i].retrigger}, wants ${re}`;
      }
    }
  }
  // the chords' voices and comping strokes sound the bar's chord tones (comping may fall back to the root onset)
  const e = k.frameCentsEachSide;
  for (const part of spec.parts.filter((p) => p.id === 'chords' || p.id === 'comp')) for (const n of part.notes) {
    const c = spec.chords[n.bar], rc = row.toneCents[row.tones.indexOf(c.rootTone)], cl = classOfCents(row.toneCents[row.tone[n.borrowed ? n.from : n.node]] - rc);
    if (!(Math.abs(cl.dev) <= e + 1e-9 && c.intervals.includes(cl.pc))) return `${part.id}: ${n.ratio} in bar ${n.bar} is not a tone of ${c.name}`;
  }
  const comp = spec.parts.find((p) => p.id === 'comp'), b = 'ABCD'.indexOf(spec.stats.compLayer.layer);
  // in chords the strokes are the layer's strikes (the strum's tones any onset near them: assert-comp.mjs); in notes, every note
  for (const n of comp.strokes ?? comp.notes) if (!(row.owners[n.node] & (1 << b)) && n.node !== spec.chords[n.bar].rootNode) return `comp: node ${n.node} is not a strike of layer ${spec.stats.compLayer.layer}`;
  return '';
}

console.log('\n— determinism and real onsets');
{
  let bad = '', notes = 0, specs = 0;
  for (const [layers, T] of CASES) for (const seed of [1, 7]) {
    const a = compose(layers, T, { seed }), b = compose(layers, T, { seed });
    if (JSON.stringify(a) !== JSON.stringify(b)) { bad = `${layers} seed ${seed}: two runs differ`; break; }
    if (a.refused) continue;
    specs++;
    const broke = audit(a);
    if (broke) { bad = `${layers} seed ${seed}: ${broke}`; break; }
    notes += a.parts.reduce((n, p) => n + p.notes.length, 0);
  }
  check(`${specs} specs, ${notes} notes: byte-identical twice; every note an onset (node, tick, ratio, time), hz by its formula, durations and retriggers by the legato rule, chord and comp notes on the chord`, !bad && specs >= 10, bad);
  const s1 = compose([768, 769], 8, { seed: 1 }), s2 = compose([768, 769], 8, { seed: 2 });
  check('the seed drives the choices: two seeds, two sets of decisions', JSON.stringify(s1.decisions) !== JSON.stringify(s2.decisions));
  check('the spec\'s shape', s1.version === COMPOSER_SPEC_VERSION && ['version', 'input', 'knobs', 'chords', 'modulations', 'parts', 'decisions', 'stats'].every((x) => x in s1)
    && ['bars', 'slotsPerBar', 'anchors', 'phase', 'frameCentsEachSide', 'root', 'modulation', 'table', 'tempoBpm'].every((x) => x in s1.knobs)
    && s1.parts.map((p) => p.id).join() === PART_IDS.join() && s1.parts.every((p) => ['id', 'role', 'sound', 'legato', 'enabled', 'notes'].every((x) => x in p))
    && s1.parts.every((p) => p.notes.every((n) => ['node', 'tick', 'time', 'ratio', 'octave', 'hz', 'duration', 'velocity', 'bar'].every((x) => x in n)))
    && s1.decisions.every((d) => d.what && 'value' in d && d.why));
  const pitches = s1.parts[0].notes.map((n) => { const [a, b] = n.ratio.split('/').map(Number); return 1200 * Math.log2(a / b) + 1200 * n.octave; }).sort((a, b) => a - b), m = pitches.length >> 1;
  const mid = s1.knobs.baseHz * 2 ** ((pitches.length % 2 ? pitches[m] : (pitches[m - 1] + pitches[m]) / 2) / 1200);
  check(`the base fundamental puts the lead's median pitch at √(440·660) ≈ ${mid.toFixed(1)} Hz (before any bar's retune)`, near(mid, LEAD_TARGET_HZ, 1e-9));
  check('every decision Compose made is listed with a why', ['frameCentsEachSide', 'presence', 'settlePasses', 'root', 'bars', 'slotsPerBar', 'tempoBpm', 'anchors', 'phase', 'modulation', 'table', 'leader', 'compLayer', 'baseHz', ...PART_IDS.flatMap((p) => [`legato.${p}`, `sound.${p}`, `enabled.${p}`])].every((w) => s1.decisions.some((d) => d.what === w)));
  check('the sounds are each part\'s proposed pair, and real Audio/voices note instruments', s1.parts.every((p) => SOUND_PAIRS[p.id].includes(p.sound) && typeof isStruck(p.sound) === 'boolean'));
}

console.log('\n— legato');
{
  const T = 8, layers = [768, 769];
  const onStruck = compose(layers, T, { overrides: { legato: { lead: true, chords: true }, sounds: { lead: 'marimba', chords: 'harp' } } });
  const lead = onStruck.parts[0];
  check('a struck sound (marimba) in legato retriggers on every note, each held to the next', lead.struck && lead.legato && lead.notes.every((n) => n.retrigger) && !audit(onStruck));
  const onHeld = compose(layers, T, { overrides: { legato: { lead: true }, sounds: { lead: 'flute' } } }), held = onHeld.parts[0];
  check('a held sound (flute) in legato is struck once and moved: only its first note retriggers', !held.struck && held.notes[0].retrigger && held.notes.slice(1).every((n) => !n.retrigger) && !audit(onHeld));
  const off = compose(layers, T, { overrides: { legato: { lead: false, chords: false, inner: false, bass: false, comp: false } } });
  check('legato off: every note retriggers and lasts its slot or the gap, whichever is shorter', off.parts.every((p) => !p.legato && p.notes.every((n) => n.retrigger)) && !audit(off));
  const on = compose(layers, T, { overrides: { legato: { lead: true, chords: true, inner: true, bass: true, comp: true } } });
  check('legato on everywhere: each part (each chord voice) holds to its own next note, its last to the cycle\'s end', on.parts.every((p) => p.legato) && !audit(on));
  check('legato is per part: the bass held while the comping is not', (() => { const s = compose(layers, T, { overrides: { legato: { bass: true, comp: false } } }); return s.parts[3].legato && !s.parts[2].legato && !audit(s); })());
  const n = [{ time: 0, slotSeconds: 0.5, node: 0 }, { time: 0.2, slotSeconds: 0.5, node: 1 }, { time: 1.5, slotSeconds: 0.5, node: 2 }];
  articulate(n, { legato: false, struck: false, cycleSeconds: 2 });
  check('articulate by hand, off: 0.2 (the gap), 0.5 (the slot), 0.5', near(n[0].duration, 0.2) && near(n[1].duration, 0.5) && near(n[2].duration, 0.5));
  articulate(n, { legato: true, struck: false, cycleSeconds: 2 });
  check('…on: 0.2, 1.3, 0.5 (to the cycle\'s end); held, so only the first retriggers', near(n[0].duration, 0.2) && near(n[1].duration, 1.3) && near(n[2].duration, 0.5) && n.map((x) => x.retrigger).join() === 'true,false,false');
  const d = compose([768, 769], 8);
  const leadGaps = []; const ln = d.parts[0].notes; for (let i = 1; i < ln.length; i++) leadGaps.push(ln[i].slot - ln[i - 1].slot);
  check('the defaults: chords and inner on, comping and bass off, the lead by its median gap', d.parts[1].legato && d.parts[4].legato && !d.parts[2].legato && !d.parts[3].legato && d.decisions.find((x) => x.what === 'legato.lead').why.includes('median gap'));
}

console.log('\n— overrides, one by one');
{
  const L = [768, 769], T = 8, base = compose(L, T), asked = (s, w) => s.decisions.find((d) => d.what === w)?.why === 'asked';
  const one = (ov) => compose(L, T, { overrides: ov });
  let s = one({ bars: 2 }); check('bars', s.knobs.bars === 2 && asked(s, 'bars') && s.chords.length === 2 && Math.abs(s.knobs.tempoBpm - 60 * 2 * 4 / T) < 1e-9);
  s = one({ slotsPerBar: 6 }); check('slotsPerBar', s.knobs.slotsPerBar === 6 && asked(s, 'slotsPerBar') && !audit(s));
  s = one({ anchors: 'even' }); check('anchors', s.knobs.anchors === 'even' && asked(s, 'anchors') && !audit(s));
  s = one({ phase: [1, 7] }); check('phase', s.knobs.phase.join() === '1,7' && asked(s, 'phase') && !audit(s));
  s = one({ frameCentsEachSide: 10 }); check('frameCentsEachSide', s.knobs.frameCentsEachSide === 10 && asked(s, 'frameCentsEachSide') && !audit(s));
  s = one({ root: '1/1' }); check('root', s.knobs.root === '1/1' && asked(s, 'root'));
  s = one({ modulation: false }); check('modulation', s.knobs.modulation === false && s.modulations.length === 0 && s.chords.every((c) => c.offsetCents === 0) && asked(s, 'modulation'));
  s = one({ table: 'full' }); check('table', s.knobs.table === 'full' && asked(s, 'table'));
  s = one({ sounds: { lead: 'harp', bass: 'sub' } }); check('sounds', s.parts[0].sound === 'harp' && s.parts[3].sound === 'sub' && asked(s, 'sound.lead'));
  s = one({ legato: { comp: true } }); check('legato', s.parts[2].legato && asked(s, 'legato.comp') && !audit(s));
  s = one({ enabled: { comp: false } }); check('enabled', s.parts[2].enabled === false && s.parts[0].enabled && asked(s, 'enabled.comp'));
  s = one({ baseHz: 220 }); check('baseHz', s.knobs.baseHz === 220 && asked(s, 'baseHz') && !audit(s));
  s = one({ compLayer: 'A' }); check('compLayer', s.stats.compLayer.layer === 'A' && asked(s, 'compLayer') && !audit(s));
  {
    const row = buildRow(L), phase = downbeats(row, 64, 1, defaultRoot(row))[0], knobs = { bars: 8, slotsPerBar: 8, anchors: 'even', phase, table: 'lean' };
    const raw = one({ ...knobs, foldOffsets: false }), named = one(knobs);
    const hz = (x) => JSON.stringify(x.parts.map((p) => p.notes.map((n) => [n.node, n.hz, n.time, n.duration])));
    const deep = raw.modulations.find((m) => m.cents < -50 || m.cents >= 50), same = deep && named.modulations.find((m) => m.bar === deep.bar);
    check(`foldOffsets: a relabel only — 768:769 in 8 × 8 reads ${deep?.cents.toFixed(1)}¢ raw and ${same?.cents.toFixed(1)}¢ folded at bar ${deep?.bar}, and every note's hz is identical`,
      !!deep && !!same && Math.abs(same.cents - deep.cents - 100) < 1e-6 && hz(raw) === hz(named) && asked(raw, 'foldOffsets')
      && named.chords[deep.bar].rootPc === mod(raw.chords[deep.bar].rootPc + 1, 12) && named.chords.every((c, k) => c.fundamentalRatio === raw.chords[k].fundamentalRatio));
  }
  check('every override is in the input, as given', one({ bars: 2, sounds: { lead: 'harp' } }).input.overrides.sounds.lead === 'harp' && base.input.seed === 1);
  check('unknown overrides, sounds and layers throw', throws(() => one({ tempo: 100 }), /no override/) && throws(() => one({ sounds: { lead: 'kazoo' } }), /no note instrument/) && throws(() => one({ compLayer: 'D' }), /no layer/));
}

console.log('\n— gates');
{
  const dense = compose([1048576, 3], 8), large = compose([10007, 10009, 10037, 10039], 8), few = compose([3, 2], 4);
  check('over 1,048,576 onsets: refused tooDense', dense.refused && dense.reason === 'tooDense' && dense.detail.onsets === 1048578 && dense.detail.gate === 1048576);
  check('a grid past 2^53: refused tooLarge', large.refused && large.reason === 'tooLarge' && large.detail.tooLarge === true);
  check('under 3 tones: refused tooFewTones', few.refused && few.reason === 'tooFewTones' && few.detail.tones === 1 && few.detail.min === 3);
  check('a refusal carries its input and no parts', [dense, large, few].every((s) => s.version === COMPOSER_SPEC_VERSION && s.input && !s.parts));
  check('a bad cycle throws', throws(() => compose([8, 7, 6, 5], 0), /cycleSeconds/) && throws(() => compose([8, 7, 6, 5], NaN), /cycleSeconds/));
}

console.log('\n— tempo');
{
  let bad = '', inRange = 0, outOfRange = 0;
  for (const T of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10, 12, 16, 20, 24, 32, 48, 64, 100]) {
    const m = chooseMeter(16359, T), can = BAR_CHOICES.some((N) => { const t = 60 * N * BEATS_PER_BAR / T; return t >= TEMPO_RANGE[0] && t <= TEMPO_RANGE[1]; });
    const ok = m.tempoBpm >= TEMPO_RANGE[0] - 1e-9 && m.tempoBpm <= TEMPO_RANGE[1] + 1e-9;
    if (can && !ok) bad = `${T} s: ${m.tempoBpm}`;
    if (!can && !m.notes.some((x) => x.startsWith('no bar count'))) bad = `${T} s: out of range unsaid`;
    if (can) inRange++; else outOfRange++;
  }
  check(`the tempo is inside 90–130 BPM whenever a bar count allows it (${inRange} cycles), and the spec says so when none does (${outOfRange})`, !bad, bad);
  const sparse = chooseMeter(22, 4);
  check('a sparse row lowers the slots first, keeping the tempo: 22 onsets in 4 s → 2 bars of 3 slots at 120 BPM', sparse.bars === 2 && sparse.slotsPerBar === 3 && sparse.tempoBpm === 120 && sparse.notes.some((x) => x.includes('under 3')));
  const s = compose([8, 7, 6, 5], 4);
  check('…and Compose says so in its decisions', s.decisions.find((d) => d.what === 'slotsPerBar').why.includes('under 3'));
  check('seededRandom: one seed, one stream; another seed, another', (() => { const a = seededRandom(5), b = seededRandom(5), c = seededRandom(6); const x = [a(), a()], y = [b(), b()], z = [c(), c()]; return x.join() === y.join() && x.join() !== z.join(); })());
}

console.log('\n— the root\'s cluster, and settling');
{
  let bad = '', n = 0;
  // the baseline's comp is one note a stroke: compStyle 'notes' (COMP_ARP_ORDER.md P9), the override itself left out of the input
  const notesCompose = (L, T, o) => { const spec = compose(L, T, { ...o, overrides: { ...o.overrides, compStyle: 'notes' } }); delete spec.input.overrides.compStyle; return spec; };
  for (const [name, run] of composeCases(notesCompose)) { n++; if (sha(normSpec(run())) !== COMPOSE_HASHES[name]) { bad = name; break; } }
  check(`settlePasses 0 with presence 'exact' reproduces e3909e1's specs byte for byte (${n} specs: 10 rows × 2 seeds, 2 on the full table, 1 with modulation off)`, !bad && n === Object.keys(COMPOSE_HASHES).length, bad);
  const L = [4099, 4093, 4091, 4079], T = 16;
  const cl = compose(L, T), ex = compose(L, T, { overrides: { presence: 'exact' } }), why = (s, w) => s.decisions.find((d) => d.what === w);
  check(`4099:4093:4091:4079: the cluster rule roots on ${cl.knobs.root} (${why(cl, 'root').why.match(/heard \d+ times, its cluster \d+/)?.[0]}), the exact rule on ${ex.knobs.root}`,
    cl.knobs.root === '4093/2048' && ex.knobs.root === '4093/2304' && why(ex, 'presence').why === 'asked' && why(cl, 'presence').value === 'cluster' && !audit(cl) && !audit(ex));
  // a root heard twice in a cluster heard 428 times: its own onsets give 2 downbeats, its cluster 3
  const rare = { root: '4093/2324', settlePasses: 0 };
  const a = compose(L, T, { overrides: rare }), b = compose(L, T, { overrides: { ...rare, presence: 'exact' } });
  check(`a root heard twice (4093/2324): the phase is one of its cluster\'s first 3 downbeats ("${why(a, 'phase').why.slice(0, 32)}…"); on its own onsets only 2`, /of the root's first 3 /.test(why(a, 'phase').why) && /cluster/.test(why(a, 'phase').why) && /of the root's first 2 /.test(why(b, 'phase').why) && !audit(a));
  check('presence must be cluster or exact', throws(() => compose([8, 7, 6, 5], 4, { overrides: { presence: 'loud' } }), /presence must be/));

  // settling: the override, its decision and stats
  const one = (sp) => compose([768, 784], 8, { overrides: sp == null ? {} : { settlePasses: sp } });
  const d = one(null), s0 = one(0), s1 = one(1);
  check(`the default settles: up to ${d.decisions.find((x) => x.what === 'settlePasses').value} rounds; 768:784 runs ${d.stats.settle.rounds} (changed [${d.stats.settle.changedBarsPerRound}]), ${d.stats.settle.converged ? 'converged' : 'not converged'}`,
    why(d, 'settlePasses').value === 3 && why(d, 'settlePasses').why !== 'asked' && d.stats.settle.rounds >= 1 && d.stats.settle.rounds <= 3);
  check('the override: settlePasses 0 and 1 are asked, and run 0 and at most 1 rounds', why(s0, 'settlePasses').why === 'asked' && s0.stats.settle.rounds === 0 && s0.stats.settle.chosenRound === 0
    && why(s1, 'settlePasses').why === 'asked' && why(s1, 'settlePasses').value === 1 && s1.stats.settle.rounds <= 1 && s1.input.overrides.settlePasses === 1);
  check('stats.settle: rounds, converged, oscillated, changed bars per round, exceptions per round, the round kept', ['rounds', 'converged', 'oscillated', 'changedBarsPerRound', 'exceptionsPerRound', 'chosenRound'].every((x) => x in d.stats.settle)
    && d.stats.settle.changedBarsPerRound.length === d.stats.settle.rounds && d.stats.exceptions === d.stats.settle.exceptionsPerRound[d.stats.settle.chosenRound]);
  check('settlePasses outside 0..3 or not an integer throws', [4, -1, 0.5, 'x'].every((x) => throws(() => compose([8, 7, 6, 5], 4, { overrides: { settlePasses: x } }), /settlePasses/)));
  // every part is built from the final chords: the chords and comping sound them (audit), and settling changed some
  let moved = 0, specs = 0; bad = '';
  for (const [layers, T2] of [...CASES, [[2048, 2049], 8], [[41, 42, 43], 8], [[1597, 987, 610, 377], 8]]) for (const sp of [1, 3]) {
    const spec = compose(layers, T2, { overrides: { settlePasses: sp } });
    if (spec.refused) continue;
    specs++;
    if (spec.stats.settle.changedBarsPerRound[0] > 0) {
      moved++;
      const before = compose(layers, T2, { overrides: { settlePasses: 0 } });
      if (JSON.stringify(before.chords) === JSON.stringify(spec.chords)) bad = `${layers}: chords unmoved`;
    }
    const broke = audit(spec);
    if (broke) { bad = `${layers} settle ${sp}: ${broke}`; break; }
    if (JSON.stringify(spec) !== JSON.stringify(compose(layers, T2, { overrides: { settlePasses: sp } }))) { bad = `${layers} settle ${sp}: not deterministic`; break; }
  }
  check(`${specs} settled specs (caps 1 and 3), ${moved} with chords moved: every note an onset by its formula, chords and comping on the final chords, deterministic`, !bad && moved > 0, bad);
}

console.log('\n— the module worker, in a fake worker scope');
{
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  const w = await import('../core/compose-worker.js');
  check('it listens on its scope', typeof globalThis.self.onmessage === 'function');
  globalThis.self.onmessage({ data: { id: 7, layers: [8, 7, 6, 5], cycleSeconds: 4, options: { seed: 3 } } });
  const got = posted[0], direct = compose([8, 7, 6, 5], 4, { seed: 3, worker: true });
  check('a message gets the same spec as the call, with the full table', got.id === 7 && got.ok && got.spec.knobs.table === 'full' && JSON.stringify(got.spec) === JSON.stringify(direct));
  globalThis.self.onmessage({ data: { id: 8, layers: [3, 2], cycleSeconds: 4 } });
  globalThis.self.onmessage({ data: { id: 9, layers: [8, 7, 6, 5], cycleSeconds: -1 } });
  check('a refusal is an answer; a thrown error is not ok', posted[1].ok && posted[1].spec.reason === 'tooFewTones' && !posted[2].ok && /cycleSeconds/.test(posted[2].error));
  check('`answer` runs without a worker', w.answer({ id: 1, layers: [8, 7, 6, 5], cycleSeconds: 4, options: { seed: 3 } }).spec.knobs.table === 'full');
  delete globalThis.self;
}

console.log('\n— timing');
{
  for (const [layers, T] of [[[4099, 4093, 4091, 4079], 16], [[768, 784], 8], [[768, 769], 8]]) {
    const t0 = performance.now(), lean = compose(layers, T), t1 = performance.now(), full = compose(layers, T, { worker: true }), t2 = performance.now();
    check(`${layers.join(':')} (${lean.stats.onsets} onsets, ${lean.stats.tones} tones), ${lean.knobs.bars} × ${lean.knobs.slotsPerBar}: lean ${(t1 - t0).toFixed(0)} ms (under 1 s), full ${(t2 - t1).toFixed(0)} ms`, t1 - t0 < 1000 && !audit(lean) && !audit(full));
  }
}

console.log(`\n${PASS ? 'PASS' : 'FAIL'} — ${checks} checks`);
process.exit(PASS ? 0 : 1);
