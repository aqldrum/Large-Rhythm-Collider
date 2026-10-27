// assert-comp.mjs — comping in chords (Composer/COMP_ARP_ORDER.md phase A, A1–A2; A5's core checks): compose.js
// `compChordsOfBar` and `strumOf`, the comp layer's new score, `compStyle`, and rearrange.js' chord swap over it.
// Every comp spec here is checked against a brute force written from the order, not from compose.js:
//   • every strike is a stroke: each slot the comp layer strikes, at its first strike there (a bar with none: the root onset)
//   • every strum tone is a real onset within ±¼ slot of its stroke, inside the bar (a split bar's span), of a chord class,
//     the class's nearest (ties: the most strikes, then the earliest)
//   • borrowed tones are exactly the classes missing from the window that the chords part has a voice of: at the stroke's
//     onset and time, the voice's tone, `from` the voice's onset
//   • the stroke's chord through a split bar (a chart's spans); at most 4 voices, one a class, root first, stacked close
//   • velocities (0.55 + 0.1 a layer more / 0.5 / 0.45); lengths with legato on and off (`holdTo`: the next stroke, never
//     past the span), and `rearticulate` agreeing with Compose
//   • `compStyle: 'notes'` byte for byte the frozen pre-refactor Compose (fixtures/compose-before.js), and the default
//     deterministic; the drums' `with` reading the strokes
//   • a chord swap rebuilds the bar's strum and its borrowed tones from the new chord's voices; a JSON round trip of the
//     spec rearranges the same (the store's)
//   • the 16,359-onset row: the comp's own cost, and Compose lean with it
//   node Composer/tests/assert-comp.mjs
import { compose, partContext, compChoicesOf, compChordsOfBar, rearticulate, STRUM_WINDOW, COMP_VELOCITY, MAX_COMP_VOICES } from '../core/compose.js';
import { compose as composeBefore } from './fixtures/compose-before.js';
import { rearrange, applyRearrange, materialsOf } from '../core/rearrange.js';
import { arrangeDrums } from '../core/drums.js';
import { classOfCents } from '../core/frame.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const EPS = 1e-9;

console.log('═══ COMPOSER — comping in chords (COMP_ARP_ORDER.md phase A) ═══');

/** the row's geometry from the spec alone (no crop): onset times, slots and the bars' and spans' ranges */
function geometryOf(spec) {
  const { row, cells } = materialsOf(spec), K = spec.knobs, T = K.cycleSeconds, S = K.slotsPerBar, N = K.bars, P = N * S, phaseX = K.phase[0] / K.phase[1];
  const starts = cells.slots.map((s) => mod(s.anchor - phaseX, 1));
  const slot = new Int32Array(row.n), time = new Float64Array(row.n);
  for (let i = 0; i < row.n; i++) {
    const x = mod(row.x[i] - phaseX, 1); let lo = 0, hi = P - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x + EPS) lo = mid; else hi = mid - 1; }
    slot[i] = lo; time[i] = mod(row.tick[i] / row.grid - phaseX, 1) * T;
  }
  const slotSeconds = (j) => cells.slots[j].length * T;
  // one unit a chord: a split bar's span, else a bar
  const units = spec.chords.map((c, u) => (c.slots != null ? { u, bar: c.bar, from: c.from, to: c.from + c.slots, c } : { u, bar: u, from: u * S, to: (u + 1) * S, c }));
  const toneOf = new Map(row.tones.map((t, i) => [t, i]));
  return { row, cells, T, S, N, P, starts, slot, time, slotSeconds, units, toneOf, e: K.frameCentsEachSide };
}
/** a chord class of tone t under chord c (from its root tone), or −1 */
const classOf = (G, c, t) => { const k = classOfCents(G.row.toneCents[t] - G.row.toneCents[G.toneOf.get(c.rootTone)]); return Math.abs(k.dev) <= G.e + EPS && c.intervals.includes(k.pc) ? k.pc : -1; };

/** the comp the order asks for, by brute force over the spec's chords, chords part and comp layer → { notes, strokes } */
function expectedComp(spec, G) {
  const { row, slot, time, slotSeconds, T, P, starts } = G, b = 'ABCD'.indexOf(spec.stats.compLayer.layer);
  const chordsPart = spec.parts.find((p) => p.id === 'chords').notes;
  const notes = [], strokes = [];
  for (const U of G.units) {
    const inside = []; for (let i = 0; i < row.n; i++) if (slot[i] >= U.from && slot[i] < U.to) inside.push(i);
    const byTime = (a, z) => time[a] - time[z] || a - z;
    let mine = [];
    for (let j = U.from; j < U.to; j++) { const s = inside.filter((i) => slot[i] === j && row.owners[i] & (1 << b)).sort(byTime)[0]; if (s !== undefined) mine.push(s); }
    if (!mine.length && U.c.rootNode != null && slot[U.c.rootNode] >= U.from && slot[U.c.rootNode] < U.to) mine = [U.c.rootNode];
    mine.sort(byTime);
    const end = U.to < P ? starts[U.to] * T : T;
    const voices = new Map(chordsPart.filter((n) => n.bar === U.bar && n.slot >= U.from && n.slot < U.to).map((n) => [n.voice, n]));
    mine.forEach((s, x) => {
      const ts = time[s], w = STRUM_WINDOW * slotSeconds(slot[s]);
      const holdTo = ts < end ? Math.min(x + 1 < mine.length ? time[mine[x + 1]] : end, end) : T;
      strokes.push({ node: s, tick: row.tick[s], time: ts, bar: U.bar, slot: slot[s] });
      U.c.intervals.slice(0, 4).forEach((pc, v) => {
        let best = -1;
        for (const i of inside) {
          if (Math.abs(time[i] - ts) > w + EPS || classOf(G, U.c, row.tone[i]) !== pc) continue;
          const d = Math.abs(time[i] - ts), bd = best < 0 ? Infinity : Math.abs(time[best] - ts);
          if (best < 0 || d < bd - EPS || (d <= bd + EPS && (row.strikes[i] > row.strikes[best] || (row.strikes[i] === row.strikes[best] && time[i] < time[best])))) best = i;
        }
        if (best >= 0) notes.push({ node: best, voice: v, bar: U.bar, holdTo, velocity: best === s ? Math.min(1, COMP_VELOCITY.stroke + 0.1 * Math.max(0, row.strikes[s] - 1)) : COMP_VELOCITY.strum, ratio: row.tones[row.tone[best]] });
        else if (voices.has(v)) notes.push({ node: s, voice: v, bar: U.bar, holdTo, velocity: COMP_VELOCITY.borrowed, ratio: voices.get(v).ratio, borrowed: true, from: voices.get(v).node });
      });
    });
  }
  return { notes, strokes };
}
const noteKey = (n) => J([n.node, n.voice, n.bar, n.ratio, n.velocity, n.holdTo, n.borrowed ? n.from : null]);

let lastG = null;   // the last audit's geometry
/** the comp of a spec against the brute force and the order's rules → '' or the first problem */
function audit(spec) {
  const G = lastG = geometryOf(spec), comp = spec.parts.find((p) => p.id === 'comp'), want = expectedComp(spec, G);
  if (!Array.isArray(comp.strokes)) return 'no strokes on the comp part';
  if (J(comp.strokes) !== J([...want.strokes].sort((a, b) => a.time - b.time || a.node - b.node))) return 'the strokes are not every slot the layer strikes, at its first strike';
  const a = comp.notes.map(noteKey).sort(), b = want.notes.map(noteKey).sort();
  if (J(a) !== J(b)) { const miss = b.find((k) => !a.includes(k)), extra = a.find((k) => !b.includes(k)); return `the strum and borrowed tones differ from the order's (missing ${miss}, extra ${extra})`; }
  const { row, time, slot, slotSeconds, units } = G;
  for (const n of comp.notes) {
    if (!(Number.isInteger(n.voice) && n.voice >= 0 && n.voice < MAX_COMP_VOICES)) return `voice ${n.voice}`;
    if (n.tick !== row.tick[n.node] || Math.abs(n.time - time[n.node]) > EPS || n.slot !== slot[n.node]) return `node ${n.node} is not at its own onset's time and slot`;
    const U = units.find((x) => x.bar === n.bar && n.slot >= x.from && n.slot < x.to);
    if (!U) return `a note outside its bar or span (bar ${n.bar}, slot ${n.slot})`;
    const tone = n.borrowed ? row.tone[n.from] : row.tone[n.node];
    if (row.tones[tone] !== n.ratio || classOf(G, U.c, tone) !== U.c.intervals[n.voice]) return `voice ${n.voice} of bar ${n.bar} is not its chord's class ${U.c.intervals[n.voice]}`;
    if (!n.borrowed) { const s = comp.strokes.find((x) => x.bar === n.bar && Math.abs(x.time - n.time) <= STRUM_WINDOW * slotSeconds(x.slot) + EPS); if (!s) return `strum tone ${n.node} is not within ±¼ slot of a stroke`; }
    else if (!comp.strokes.some((x) => x.node === n.node && x.time === n.time)) return `borrowed tone at ${n.node} is not at a stroke`;
  }
  // the voicing: per stroke, root first, each voice the lowest register above the one under it, from an octave under the root
  const byStroke = new Map(); for (const n of comp.notes) { const k = `${n.bar}|${n.holdTo}`; if (!byStroke.has(k)) byStroke.set(k, []); byStroke.get(k).push(n); }
  for (const list of byStroke.values()) {
    const U = units.find((x) => x.bar === list[0].bar && list[0].slot >= x.from && list[0].slot < x.to);
    let floor = row.toneCents[G.toneOf.get(U.c.rootTone)] - 1200 - 50;
    for (const n of [...list].sort((x, y) => x.voice - y.voice)) {
      const pitch = row.toneCents[G.toneOf.get(n.ratio)] + 1200 * n.octave;
      if (!(pitch >= floor - EPS && pitch - 1200 < floor - EPS)) return `voice ${n.voice} of a stroke in bar ${n.bar} is not stacked close (${pitch.toFixed(1)}¢ over a floor of ${floor.toFixed(1)}¢)`;
      floor = pitch + 1;
    }
  }
  // the lengths: a voice holds to its next note, at most to `holdTo`; legato off, at most its slot too
  const T = spec.knobs.cycleSeconds;
  for (const v of new Set(comp.notes.map((n) => n.voice))) {
    const lane = comp.notes.filter((n) => n.voice === v).sort((x, y) => x.time - y.time || x.node - y.node);
    for (let i = 0; i < lane.length; i++) {
      const n = lane[i], held = Math.min(i + 1 < lane.length ? lane[i + 1].time : T, n.holdTo) - n.time, want2 = Math.max(0, comp.legato ? held : Math.min(n.slotSeconds, held));
      if (Math.abs(n.duration - want2) > 1e-9) return `voice ${v}: a ${n.duration.toFixed(4)} s note, the rule says ${want2.toFixed(4)} s (legato ${comp.legato})`;
    }
  }
  const share = comp.notes.length ? comp.notes.filter((n) => !n.borrowed).length / comp.notes.length : 0;
  if (spec.stats.compStrum !== share) return `stats.compStrum ${spec.stats.compStrum}, the notes say ${share}`;
  return '';
}
/** the probe's numbers for a spec: strokes, tones, share unborrowed */
const probe = (spec) => { const c = spec.parts.find((p) => p.id === 'comp'); return `${c.strokes.length} strokes, ${c.notes.length} tones, ${(100 * spec.stats.compStrum).toFixed(0)} % from the row`; };

// ── the comp against the order's rules ──
console.log('\n— every strike a stroke, the strum, the borrowed tones, the voicing, the lengths');
const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 6], [[19, 17, 16, 15], 3], [[16, 12, 9], 4], [[119, 42, 15, 8], 8], [[426, 317, 285], 8], [[768, 769], 8], [[768, 784], 8], [[41, 42, 43], 8]];
{
  const bad = []; let n = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 7]) { n++; const spec = compose(L, T, { seed }), why = audit(spec); if (why) bad.push(`${L.join(':')} seed ${seed}: ${why}`); if (seed === 1) console.log(`    · ${L.join(':')}: ${probe(spec)} (layer ${spec.stats.compLayer.layer})`); }
  check(`${n} composes (${ROWS.length} rows × 2 seeds): the comp is the order's, tone for tone`, !bad.length, bad.slice(0, 3).join('; '));
}
{
  const bad = []; let n = 0;
  for (const [L, T] of ROWS.slice(0, 6)) for (const ov of [{ legato: { comp: true } }, { legato: { comp: false } }, { compLayer: 'A' }, { compLayer: 'B' }, { bars: 2 }, { slotsPerBar: 4 }, { anchors: 'even' }]) {
    const spec = compose(L, T, { seed: 3, overrides: ov }); n++;
    const why = spec.refused ? '' : audit(spec); if (why) bad.push(`${L.join(':')} ${J(ov)}: ${why}`);
  }
  check(`${n} composes with overrides (legato on and off, an asked layer, other meters): the comp is the order's, lengths included`, !bad.length, bad.slice(0, 3).join('; '));
}
{
  const spec = compose([8, 7, 6, 5], 4, { seed: 1 }), comp = spec.parts.find((p) => p.id === 'comp');
  const own = comp.notes.filter((n) => !n.borrowed && comp.strokes.some((s) => s.node === n.node)), strum = comp.notes.filter((n) => !n.borrowed && !own.includes(n)), bor = comp.notes.filter((n) => n.borrowed);
  check(`8:7:6:5: borrowed tones there (${bor.length}), and velocities 0.55+ / 0.5 / 0.45`, bor.length > 0 && bor.every((n) => n.velocity === 0.45) && strum.every((n) => n.velocity === 0.5) && own.every((n) => n.velocity >= 0.55));
  const dense = compose([768, 784], 8, { seed: 1 });
  check(`768:784: mostly pure strums (${(100 * dense.stats.compStrum).toFixed(0)} % from the row, over 80 %)`, dense.stats.compStrum > 0.8);
  check('the decisions say the style, the layer and the strum', spec.decisions.some((d) => d.what === 'compStyle' && d.value === 'chords') && spec.decisions.some((d) => d.what === 'compStrum' && d.value === spec.stats.compStrum && /strokes?/.test(d.why)) && /strike/.test(spec.decisions.find((d) => d.what === 'compLayer').why));
  check('the comp\'s voices: at most 4, one a class', comp.notes.every((n) => n.voice >= 0 && n.voice < 4) && new Set(comp.notes.map((n) => `${n.bar}|${n.holdTo}|${n.voice}`)).size === comp.notes.length);
}

// ── a chart's split bars ──
console.log('\n— the stroke\'s chord through a split bar');
{
  const bad = []; let n = 0, splitTones = 0;
  for (const [L, T, changes] of [[[119, 42, 15, 8], 8, [[1, 1], [1], [1, 1], [1]]], [[8, 7, 6, 5], 4, [[1, 1], [1]]], [[768, 784], 8, [[1, 1], [2, 1], [1], [1, 1, 1, 1]]], [[41, 42, 43], 8, [[1, 3], [1], [1, 1], [1]]]]) {
    const spec = compose(L, T, { seed: 1, changes }); n++;
    const why = audit(spec); if (why) { bad.push(`${L.join(':')} ${J(changes)}: ${why}`); continue; }
    const G = lastG, comp = spec.parts.find((p) => p.id === 'comp'), endOf = (U) => (U.to < G.P ? G.starts[U.to] * G.T : G.T);
    for (const m of comp.notes) {
      const U = G.units.find((x) => m.slot >= x.from && m.slot < x.to);
      if (G.units.filter((x) => x.bar === U.bar).length > 1) splitTones++;
      if (m.time < endOf(U) && m.time + m.duration > endOf(U) + EPS) bad.push(`${L.join(':')}: a tone of bar ${m.bar} holds past its span`);
    }
  }
  check(`${n} charts with split bars: each stroke strums its span's chord, inside the span, held no further (${splitTones} tones in split bars)`, !bad.length && splitTones > 0, bad.slice(0, 3).join('; '));
}

// ── compStyle: 'notes', and determinism ──
console.log('\n— compStyle');
{
  const cases = [[[8, 7, 6, 5], 4, {}], [[11, 9, 7, 5], 6, {}], [[119, 42, 15, 8], 8, { compLayer: 'B' }], [[768, 769], 8, { legato: { comp: true } }], [[41, 42, 43], 8, { bars: 2 }], [[97, 103, 37], 5, { enabled: { comp: false } }]];
  let same = 0;
  for (const [L, T, ov] of cases) for (const seed of [1, 4]) {
    const live = compose(L, T, { seed, overrides: { ...ov, compStyle: 'notes' } });
    delete live.input.overrides.compStyle;   // the one field the frozen core can't have: the override itself
    if (J(live) === J(composeBefore(L, T, { seed, overrides: ov }))) same++;
  }
  check(`compStyle 'notes': ${same}/${cases.length * 2} byte for byte the frozen pre-refactor Compose (fixtures/compose-before.js)`, same === cases.length * 2);
  const notes = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compStyle: 'notes' } }), nc = notes.parts.find((p) => p.id === 'comp');
  check('compStyle \'notes\': no strokes, voices, compStrum or style decision', nc.strokes === undefined && nc.notes.every((n) => n.voice === undefined && n.holdTo === undefined) && notes.stats.compStrum === undefined && !notes.decisions.some((d) => d.what === 'compStyle' || d.what === 'compStrum'));
  check('a bad compStyle throws', (() => { try { compose([8, 7, 6, 5], 4, { overrides: { compStyle: 'arp' } }); return false; } catch (e) { return /compStyle must be one of chords, notes/.test(e.message); } })());
  const asked = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compStyle: 'chords' } }), dflt = compose([8, 7, 6, 5], 4, { seed: 1 });
  check('compStyle \'chords\' asked is the default\'s comp, the decision saying "asked"', J(asked.parts) === J(dflt.parts) && asked.decisions.find((d) => d.what === 'compStyle').why === 'asked');
  let det = 0; for (const [L, T] of ROWS) if (J(compose(L, T, { seed: 2, trace: true })) === J(compose(L, T, { seed: 2, trace: true }))) det++;
  check(`deterministic: ${det}/${ROWS.length} rows byte-identical twice (trace on)`, det === ROWS.length);
  const t = compose([8, 7, 6, 5], 4, { seed: 1, trace: true }), { trace, ...rest } = t;
  check('the trace never steers the comp', J(rest) === J(dflt));
}

// ── rearticulate, the drums ──
console.log('\n— rearticulate and the drums');
{
  const bad = [];
  for (const [L, T] of ROWS.slice(0, 5)) for (const legato of [true, false]) {
    const base = compose(L, T, { seed: 5 }), asked = compose(L, T, { seed: 5, overrides: { legato: { comp: legato } } });
    const c = base.parts.find((p) => p.id === 'comp'), r = rearticulate(c, { legato, cycleSeconds: base.knobs.cycleSeconds }), want = asked.parts.find((p) => p.id === 'comp');
    if (J(r.notes) !== J(want.notes) || J(r.strokes) !== J(want.strokes)) bad.push(`${L.join(':')} legato ${legato}`);
  }
  check('rearticulate (the live legato toggle) gives Compose\'s own lengths, voice by voice, strokes kept', !bad.length, bad.join('; '));
  let ok = 0, n = 0;
  for (const [L, T] of ROWS.slice(0, 6)) {
    const spec = compose(L, T, { seed: 2 }), comp = spec.parts.find((p) => p.id === 'comp'), leadNotes = spec.parts.find((p) => p.id === 'lead').notes, lead = new Set(leadNotes.map((x) => x.slot));
    const hits = arrangeDrums(spec, { mode: 'with' }).hits.filter((h) => h.voice === 'perc' && h.snap === 'note');
    // each comp stroke on a slot the lead leaves: a perc stroke on its tick (two on one tick merge); every perc stroke on a lead note's or a stroke's tick
    const ticks = new Set([...leadNotes.map((x) => x.tick), ...comp.strokes.map((x) => x.tick)]);
    n++; if (comp.strokes.filter((s) => !lead.has(s.slot)).every((s) => hits.some((h) => h.tick === s.tick)) && hits.every((h) => ticks.has(h.tick))) ok++;
  }
  check(`drums 'with': a perc stroke on each comp stroke's own onset, none on a strum tone's (${ok}/${n} rows)`, ok === n);
}

// ── a chord swap ──
console.log('\n— a chord swap rebuilds the bar\'s comp chords');
{
  let swaps = 0, ok = 0, ident = 0, idN = 0, moved = 0, round = 0;
  const bad = [];
  for (const [L, T] of [[[8, 7, 6, 5], 4], [[119, 42, 15, 8], 8], [[768, 784], 8], [[19, 17, 16, 15], 3]]) {
    const full = compose(L, T, { seed: 1, trace: {} }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
    const h = trace.events.find((e) => e.kind === 'harmony'), evs = trace.events.filter((e) => e.kind === 'chord' && e.round === h.chosenRound);
    for (const ev of evs) {
      idN++; if (J(applyRearrange(spec, rearrange(spec, row, cells, { bar: ev.bar, chord: ev.candidates[ev.pickIndex] }))) === J(spec)) ident++;
      for (const cand of ev.candidates.slice(0, 4)) {
        if (cand === ev.candidates[ev.pickIndex]) continue;
        const r = rearrange(spec, row, cells, { bar: ev.bar, chord: cand }), next = applyRearrange(spec, r); swaps++;
        const why = audit(next); if (why) { bad.push(`${L.join(':')} bar ${ev.bar}: ${why}`); continue; }
        const was = spec.parts.find((p) => p.id === 'comp'), now = next.parts.find((p) => p.id === 'comp');
        const other = (p) => J(p.notes.filter((x) => x.bar !== ev.bar).map(({ duration, retrigger, hz, ...x }) => x));
        if (other(was) === other(now) && J(was.strokes.filter((x) => x.bar !== ev.bar)) === J(now.strokes.filter((x) => x.bar !== ev.bar))) ok++; else bad.push(`${L.join(':')} bar ${ev.bar}: another bar's comp moved`);
        if (r.changed.comp.includes(ev.bar)) moved++;
        // the store's round trip: the spec as JSON, rearranged again, the same
        if (round < 6) { round++; const back = JSON.parse(J(spec)); if (J(applyRearrange(back, rearrange(back, row, cells, { bar: ev.bar, chord: cand }))) !== J(next)) bad.push(`${L.join(':')} bar ${ev.bar}: the JSON round trip rearranges otherwise`); }
      }
    }
  }
  check(`every bar swapped to its own chord: the spec byte for byte (${ident}/${idN})`, ident === idN);
  check(`${swaps} swaps to other candidates: the bar's comp is the new chord's strum and borrowed tones (checked tone for tone), no other bar's moves, stats.compStrum recounted (${ok} ok, ${moved} bars' comp changed)`, ok === swaps && !bad.length && moved > 0, bad.slice(0, 3).join('; '));
}

// ── the 16k row ──
console.log('\n— the 16,359-onset row');
{
  const L = [4099, 4093, 4091, 4079], T = 16;
  let t0 = performance.now(); const lean = compose(L, T, { seed: 1 }); const tLean = performance.now() - t0;
  t0 = performance.now(); const notes = compose(L, T, { seed: 1, overrides: { compStyle: 'notes' } }); const tNotes = performance.now() - t0;
  console.log(`    · 16k: ${probe(lean)} (layer ${lean.stats.compLayer.layer})`);
  check(`16k: the comp is the order's (lean)`, !audit(lean), audit(lean));
  // the comp's own cost: the scoring and the bars, over records rebuilt from the spec (what they read: root, classes, root onset)
  const { row, cells } = materialsOf(lean), K = lean.knobs, ctx = partContext(row, cells, { cycleSeconds: K.cycleSeconds, phase: K.phase, frameCentsEachSide: K.frameCentsEachSide });
  const toneOf = new Map(row.tones.map((t, i) => [t, i])), recs = lean.chords.map((c) => ({ rootCents: row.toneCents[toneOf.get(c.rootTone)], intervals: c.intervals, rootNode: c.rootNode }));
  void ctx.inSlot;
  t0 = performance.now();
  const choices = compChoicesOf(ctx, recs, { style: 'chords' }), b = 'ABCD'.indexOf(lean.stats.compLayer.layer), built = recs.map((c, k) => compChordsOfBar(ctx, c, k, b));
  const tComp = performance.now() - t0;
  const same = built.reduce((n, x) => n + x.notes.length, 0) === lean.parts.find((p) => p.id === 'comp').notes.length && Math.abs(choices.find((x) => x.layer === b).score - lean.stats.compLayer.score) < 1e-12;
  check(`16k: the comp's own cost (every layer scored, the bars built) ${tComp.toFixed(1)} ms (under 50 ms), the same comp`, tComp < 50 && same);
  check(`16k: Compose lean ${tLean.toFixed(0)} ms with chords, ${tNotes.toFixed(0)} ms with notes (under 1 s)`, tLean < 1000);
}

console.log(PASS ? `\n✓✓✓ COMPING IN CHORDS PASSES (${checks} checks)` : `\n✗ COMPING IN CHORDS FAILED`);
process.exit(PASS ? 0 : 1);
