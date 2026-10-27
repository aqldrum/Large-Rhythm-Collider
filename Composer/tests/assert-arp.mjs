// assert-arp.mjs — Arp mode, phase B1 (Composer/COMP_ARP_ORDER.md): core/arp.js `arrangeArp` over composed specs.
//   • every note a real onset (its tick, ratio and time), of a chord class of its slot's chord, inside its step's
//     sub-window (the slot cut in `rate` equal windows of its time), at most one a step, its hz as Compose computes it
//   • the shape holds for each pattern (up, down, up-down, as played): the rung next in the direction, a wrap or a turn
//     only where the step offers none, the earliest candidate on a rung
//   • `range` holds: every rung inside [floor, floor + 1200 × range); the lead's floor centres the ladder on its line
//   • rests: a step sounds exactly when it holds a chord tone (the inner: off the lead's onsets, and below rate 3 not
//     on a step where the lead strikes); the stats agree
//   • the inner's avoidance (Q4), over a Line lead and over an arp lead
//   • lengths (legato off: the step; on: to the next note) and velocity (+0.1 on a slot's first step)
//   • a chart's split bar: each slot's chord the span's
//   • a MIDI target's lead refused, its inner arranged inside the window
//   • deterministic; Back to Line restores the part byte for byte; the options checked
//   • the 16,359-onset row: arrangeArp alone under 50 ms (materials prebuilt)
//   node Composer/tests/assert-arp.mjs
import { compose, partContext, VELOCITY } from '../core/compose.js';
import { materialsOf } from '../core/rearrange.js';
import { arrangeArp, arpRefusal, arpFloor, lineOf, readArpOptions, ARP_PATTERNS, ARP_DEFAULTS } from '../core/arp.js';
import { classOfCents } from '../core/frame.js';
import { readMidi, decodeClip } from '../core/midi.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';
import { HAND_PICKED } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2) : NaN; };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const MOVE = 50, EPS = 1e-9;
const same = (a, b) => Math.abs(a - b) < 1e-6;

console.log('═══ COMPOSER — Arp mode: arrangeArp (phase B1) ═══');

/** a compose with its materials, and the test's own reading of its slots and chords (not arp.js') */
function composed(L, T, opts = {}) {
  const spec = compose(L, T, { seed: 1, ...opts });
  if (spec.refused) return null;
  const M = materialsOf(spec), { row, cells } = M, k = spec.knobs;
  const rowT = k.rowCycleSeconds ?? k.cycleSeconds, phaseX = k.phase[0] / k.phase[1], W = cells.crop ? cells.crop.end : 1;
  const ctx = partContext(row, cells, { cycleSeconds: k.cycleSeconds, phase: k.phase, frameCentsEachSide: k.frameCentsEachSide, rowCycleSeconds: rowT });
  const timeOf = (tick) => { const u = mod(tick / row.grid - phaseX, 1); return u < W ? u * rowT : k.cycleSeconds - (1 - u) * rowT; };
  const S = k.slotsPerBar, P = k.bars * S;
  const chordAt = Array.from({ length: P }, (_, j) => spec.chords.find((c) => (c.slots != null ? j >= c.from && j < c.from + c.slots : c.bar === Math.floor(j / S))));
  const cents = (c) => row.toneCents[row.tones.indexOf(c.rootTone)];
  /** the class of onset i under slot j's chord, and its deviation, or null */
  const classOf = (i, j) => { const c = chordAt[j], q = classOfCents(row.toneCents[row.tone[i]] - cents(c)); return Math.abs(q.dev) <= k.frameCentsEachSide + EPS && c.intervals.includes(q.pc) ? q : null; };
  const start = (j) => mod(cells.slots[j].anchor - phaseX, 1) * rowT, length = (j) => cells.slots[j].length * rowT;
  const stepOf = (i, rate) => { const j = ctx.posSlot[i]; if (j < 0) return -1; const u = (timeOf(row.tick[i]) - start(j)) / length(j); return j * rate + Math.min(rate - 1, Math.max(0, Math.floor(u * rate + EPS))); };
  return { spec, M, row, cells, ctx, timeOf, S, P, chordAt, cents, classOf, start, length, stepOf, label: `${L.join(':')}${opts.label ? ` ${opts.label}` : ''}` };
}

/** each step's candidates, as the order defines them: { i, pc, dev, time } by time, avoiding the given onsets */
function candidates(C, rate, avoid = new Set()) {
  const out = Array.from({ length: C.P * rate }, () => []);
  for (let i = 0; i < C.row.n; i++) {
    if (avoid.has(i)) continue;
    const s = C.stepOf(i, rate);
    if (s < 0) continue;
    const q = C.classOf(i, Math.floor(s / rate));
    if (q) out[s].push({ i, pc: q.pc, dev: q.dev, time: C.timeOf(C.row.tick[i]) });
  }
  for (const l of out) l.sort((a, b) => a.time - b.time || a.i - b.i);
  return out;
}
/** a chord's rungs from a floor: [{ pc, nominal }] */
function rungsOf(C, c, floor, range) {
  const out = [];
  for (const pc of c.intervals) { const p = C.cents(c) + 100 * pc, base = p + 1200 * Math.ceil((floor - p) / 1200 - EPS); for (let o = 0; o < range; o++) out.push({ pc, nominal: base + 1200 * o }); }
  return out.sort((a, b) => a.nominal - b.nominal);
}

/** what breaks the order in an arranged part: '' or the first problem. `lead` the part the inner avoids */
function verify(C, part, partId, opt, lead = null) {
  const { row, spec } = C, { pattern, rate, range, legato } = opt, st = part.arp.stats;
  const avoid = new Set(partId === 'inner' ? lead.notes.map((n) => n.node) : []);
  const leadSteps = new Set(partId === 'inner' ? lead.notes.map((n) => C.stepOf(n.node, rate)) : []);
  const cands = candidates(C, rate, avoid), floor = st.floor;
  if (J(part.arp) !== J({ ...opt, stats: part.arp.stats })) return `arp record ${J(part.arp)}`;
  const seen = new Map();
  let prev = null, dir = 1, lastMove = 0;
  for (let n = 0; n < part.notes.length; n++) {
    const x = part.notes[n], i = x.node, at = `${partId} note ${n} (node ${i})`;
    // a real onset, at its own time, with its own ratio
    if (!(i >= 0 && i < row.n) || x.tick !== row.tick[i] || x.ratio !== row.tones[row.tone[i]]) return `${at}: not its onset's tick or ratio`;
    if (Math.abs(x.time - C.timeOf(x.tick)) > 1e-9) return `${at}: off its time`;
    if (avoid.has(i)) return `${at}: on a lead onset`;
    // its step and sub-window
    const s = C.stepOf(i, rate), j = Math.floor(s / rate);
    if (s < 0 || x.slot !== j || x.bar !== Math.floor(j / C.S)) return `${at}: slot ${x.slot} bar ${x.bar}, not its onset's ${j}`;
    const u = (x.time - C.start(j)) / C.length(j);
    if (!(u >= (s % rate) / rate - 1e-9 && (u < (s % rate + 1) / rate || s % rate === rate - 1))) return `${at}: u ${u} outside sub-window ${s % rate}/${rate}`;
    if (seen.has(s)) return `${at}: a second note in step ${s}`;
    seen.set(s, n);
    if (partId === 'inner' && rate < 3 && leadSteps.has(s)) return `${at}: on a step where the lead strikes (rate ${rate})`;
    // of a chord class, on a rung inside the range
    const q = C.classOf(i, j);
    if (!q) return `${at}: not a chord tone of ${C.chordAt[j].name}`;
    const nominal = row.toneCents[row.tone[i]] + 1200 * x.octave - q.dev;
    if (!(nominal >= floor - 1e-6 && nominal < floor + 1200 * range - 1e-6)) return `${at}: rung ${nominal.toFixed(1)} outside [${floor.toFixed(1)}, +${1200 * range})`;
    // hz and velocity as Compose computes them
    const [num, den] = x.ratio.split('/').map(Number), hz = spec.knobs.baseHz * (num / den) * 2 ** x.octave * C.chordAt[j].fundamentalRatio;
    if (Math.abs(x.hz - hz) > 1e-9 * hz) return `${at}: hz ${x.hz} not ${hz}`;
    if (Math.abs(x.velocity - Math.min(1, VELOCITY[partId] + (s % rate === 0 ? 0.1 : 0))) > 1e-12) return `${at}: velocity ${x.velocity}`;
    // lengths: the step (or the gap), or to the next note
    const gap = (n + 1 < part.notes.length ? part.notes[n + 1].time : spec.knobs.cycleSeconds) - x.time, stepSec = C.length(j) / rate;
    if (Math.abs(x.slotSeconds - stepSec) > 1e-9) return `${at}: slotSeconds ${x.slotSeconds} not the step's ${stepSec}`;
    if (Math.abs(x.duration - Math.max(0, legato ? gap : Math.min(stepSec, gap))) > 1e-9) return `${at}: duration ${x.duration} (legato ${legato})`;
    // the shape: the rung next in the direction
    const list = cands[s], choice = [];
    for (const y of list) for (const r of rungsOf(C, C.chordAt[j], floor, range)) if (r.pc === y.pc) choice.push({ y, nominal: r.nominal });
    if (Math.abs(nominal - Math.round(nominal)) > 1e-6 && !choice.some((o) => Math.abs(o.nominal - nominal) < 1e-6)) return `${at}: not on a rung`;
    const mine = choice.filter((o) => Math.abs(o.nominal - nominal) < 1e-6);
    if (!mine.length) return `${at}: rung ${nominal} is not a candidate rung`;
    if (pattern !== 'played' && mine[0].y.i !== i) return `${at}: not the earliest candidate on its rung (${mine[0].y.i})`;
    const ups = choice.filter((o) => o.nominal > prev + MOVE), downs = choice.filter((o) => o.nominal < prev - MOVE);
    const lo = Math.min(...choice.map((o) => o.nominal)), hi = Math.max(...choice.map((o) => o.nominal));
    if (pattern === 'played') {
      if (i !== list[0].i) return `${at}: not the step's earliest candidate (${list[0].i})`;
      const to = prev ?? floor + 600 * range, best = Math.min(...choice.filter((o) => o.y.i === i).map((o) => Math.abs(o.nominal - to)));
      if (Math.abs(Math.abs(nominal - to) - best) > 1e-6) return `${at}: not the rung of its class nearest the last note`;
    } else if (prev == null) {
      if (!same(nominal, pattern === 'down' ? hi : lo)) return `${at}: the first note is not the step's ${pattern === 'down' ? 'highest' : 'lowest'} rung`;
    } else if (pattern === 'up') {
      if (!same(nominal, ups.length ? Math.min(...ups.map((o) => o.nominal)) : lo)) return `${at}: up from ${prev} took ${nominal}`;
    } else if (pattern === 'down') {
      if (!same(nominal, downs.length ? Math.max(...downs.map((o) => o.nominal)) : hi)) return `${at}: down from ${prev} took ${nominal}`;
    } else {
      const go = dir > 0 ? ups : downs, back = dir > 0 ? downs : ups, near = (l) => (dir > 0 ? Math.min : Math.max)(...l.map((o) => o.nominal));
      if (go.length) { if (!same(nominal, near(go))) return `${at}: up-down (dir ${dir}) from ${prev} took ${nominal}`; }
      else if (back.length) { dir = -dir; if (!same(nominal, near(back))) return `${at}: up-down turned (now ${dir}) from ${prev} took ${nominal}`; }
      else if (Math.abs(nominal - prev) > MOVE) return `${at}: up-down with nowhere to go moved`;
    }
    prev = nominal;
  }
  // rests: a step sounds exactly when it holds a chord tone (and the inner may sound there)
  let chordSteps = 0, forLead = 0;
  for (let s = 0; s < cands.length; s++) {
    if (!cands[s].length) { if (seen.has(s)) return `step ${s} has no chord tone but sounds`; continue; }
    chordSteps++;
    const held = partId === 'inner' && rate < 3 && leadSteps.has(s);
    if (held) forLead++;
    if (!held && !seen.has(s)) return `step ${s} holds a chord tone but rests`;
  }
  if (st.steps !== C.P * rate || st.notes !== part.notes.length || st.rests !== st.steps - st.notes || st.chordSteps !== chordSteps || Math.abs(st.chordShare - chordSteps / st.steps) > 1e-12
    || (partId === 'inner' ? st.restsForLead !== forLead : 'restsForLead' in st)) return `stats ${J(st)} (chordSteps ${chordSteps}, forLead ${forLead})`;
  if (part.id !== partId || part.role !== partId || part.legato !== legato || part.sound !== lineOf(part).sound || part.enabled !== lineOf(part).enabled) return 'the part\'s id, sound, legato or on/off';
  return '';
}

const leadOf = (spec) => spec.parts.find((p) => p.id === 'lead');
const partIndex = (spec, id) => spec.parts.findIndex((p) => p.id === id);

// ── 1. the order's rules, over rows × parts × patterns × rates × ranges ──
console.log('\n— every note a real onset, a chord tone in its step; the shape; the range; rests; the inner\'s avoidance');
// the shared set's hand-picked rows the probe measured (8:7:6:5 … 426:317:285), and the probe's two 1,536-onset rows
const PROBED = { '8:7:6:5': 4, '11:9:7:5': 5, '19:17:16:15': 6, '16:12:9': 6, '119:42:15:8': 8, '426:317:285': 8 };   // row → its cycle (s)
const ROWS = [...HAND_PICKED.filter((L) => L.join(':') in PROBED).map((L) => [L, PROBED[L.join(':')]]), [[768, 769], 8], [[768, 784], 8]];
const cases = ROWS.map(([L, T]) => composed(L, T));
for (const C of cases) {
  let bad = '', runs = 0;
  for (const partId of ['lead', 'inner']) for (const pattern of ARP_PATTERNS) for (const rate of [1, 2, 3, 4]) for (const range of [1, 2, 3]) for (const legato of [false, true]) {
    if (legato && !(rate === 2 && range === 2)) continue;
    const opt = { pattern, rate, range, legato }, part = arrangeArp(C.spec, C.M, partId, opt);
    runs++;
    bad ||= verify(C, part, partId, opt, leadOf(C.spec)) && `${partId} ${J(opt)}: ${verify(C, part, partId, opt, leadOf(C.spec))}`;
  }
  check(`${C.label}: ${runs} arrangements (lead and inner × 4 patterns × rates 1–4 × ranges 1–3, legato on and off) hold every rule`, !bad, bad);
}

// ── 2. the shape, read as music: up climbs, down falls, up-down turns ──
console.log('\n— the shape, read off the dense rows');
for (const C of cases.filter((c) => c.row.n >= 1000)) {
  const moves = (p) => { const ps = p.notes.map((n) => n.octave * 1200 + C.row.toneCents[C.row.tone[n.node]]); let up = 0, down = 0; for (let i = 1; i < ps.length; i++) { if (ps[i] > ps[i - 1] + MOVE) up++; else if (ps[i] < ps[i - 1] - MOVE) down++; } return { up, down }; };
  const up = moves(arrangeArp(C.spec, C.M, 'lead', { pattern: 'up' })), dn = moves(arrangeArp(C.spec, C.M, 'lead', { pattern: 'down' })), ud = moves(arrangeArp(C.spec, C.M, 'lead', { pattern: 'updown' }));
  check(`${C.label}: up mostly climbs (${up.up} up, ${up.down} wraps), down mostly falls (${dn.down} down, ${dn.up} wraps), up-down both (${ud.up} up, ${ud.down} down)`,
    up.up > 2 * up.down && dn.down > 2 * dn.up && ud.up > 0 && ud.down > 0 && Math.abs(ud.up - ud.down) <= Math.max(ud.up, ud.down) * 0.6);
}

// ── 3. range and register ──
console.log('\n— range and register');
{
  const C = cases.find((c) => c.label === '768:784');
  const spans = [1, 2, 3].map((range) => { const p = arrangeArp(C.spec, C.M, 'lead', { range }), ps = p.notes.map((n) => n.octave * 1200 + C.row.toneCents[C.row.tone[n.node]]); return { range, lo: Math.min(...ps), hi: Math.max(...ps), floor: p.arp.stats.floor }; });
  check(`768:784 lead: the ladder widens with the range (${spans.map((x) => `${x.range}: ${(x.hi - x.lo).toFixed(0)}¢`).join(', ')}), never past it`, spans.every((x) => x.hi - x.lo < 1200 * x.range + 2 * C.spec.knobs.frameCentsEachSide) && spans[2].hi - spans[2].lo > spans[0].hi - spans[0].lo);
  const meds = cases.filter((c) => c.row.n >= 100).map((c) => { const ps = (p) => p.notes.map((n) => n.octave * 1200 + c.row.toneCents[c.row.tone[n.node]]); return { c, arp: median(ps(arrangeArp(c.spec, c.M, 'lead'))), line: median(ps(leadOf(c.spec))), inner: median(ps(arrangeArp(c.spec, c.M, 'inner'))) }; });
  check(`the lead's arp sits on its line's median (Δ ${meds.map((m) => `${(m.arp - m.line).toFixed(0)}¢`).join(', ')}), the inner's an octave under it`,
    meds.every((m) => Math.abs(m.arp - m.line) <= 600 && Math.abs(m.arp - m.inner - 1200) <= 600));
  check('the floors: the lead\'s line median less half the ladder, the inner\'s an octave under it', [1, 2, 3].every((r) => Math.abs(arpFloor(C.spec, C.M, 'lead', r) - (median(leadOf(C.spec).notes.map((n) => n.octave * 1200 + C.row.toneCents[C.row.tone[n.node]])) - 600 * r)) < 1e-9
    && Math.abs(arpFloor(C.spec, C.M, 'inner', r) - arpFloor(C.spec, C.M, 'lead', r) + 1200) < 1e-9));
}

// ── 4. the inner's avoidance (Q4), over a Line lead and an arp lead (Q5) ──
console.log('\n— the inner keeps off the lead');
for (const C of cases.filter((c) => c.row.n >= 1000)) {
  const leadArp = arrangeArp(C.spec, C.M, 'lead', { rate: 3 }), withArp = structuredClone(C.spec);
  withArp.parts[partIndex(withArp, 'lead')] = leadArp;
  const bad = [false, true].map((arped) => { const spec = arped ? withArp : C.spec; let b = ''; for (const rate of [1, 2, 3, 4]) { const opt = readArpOptions({ rate }), p = arrangeArp(spec, C.M, 'inner', opt); b ||= verify({ ...C, spec }, p, 'inner', opt, leadOf(spec)); } return b; });
  const r2 = arrangeArp(C.spec, C.M, 'inner', { rate: 2 }), r3 = arrangeArp(C.spec, C.M, 'inner', { rate: 3 });
  const shared = (p, rate) => { const ls = new Set(leadOf(C.spec).notes.map((n) => C.stepOf(n.node, rate))); return p.notes.filter((n) => ls.has(C.stepOf(n.node, rate))).length; };
  check(`${C.label}: never on a lead onset, over the Line lead and over an arp lead (Q5); rate 2 rests ${r2.arp.stats.restsForLead} steps for the lead, rate 3 shares ${shared(r3, 3)} steps with it`,
    !bad[0] && !bad[1] && r2.arp.stats.restsForLead > 0 && shared(r2, 2) === 0 && shared(r3, 3) > 0 && !('restsForLead' in arrangeArp(C.spec, C.M, 'lead').arp.stats), bad.join(' / '));
}

// ── 5. rests ──
console.log('\n— rests');
{
  const small = cases.find((c) => c.label === '8:7:6:5'), p = arrangeArp(small.spec, small.M, 'lead', { rate: 4 });
  check(`8:7:6:5 at rate 4: ${p.arp.stats.rests} of ${p.arp.stats.steps} steps rest (${p.arp.stats.steps - p.arp.stats.chordSteps} with no chord tone)`, p.arp.stats.rests > 0 && p.arp.stats.rests === p.arp.stats.steps - p.arp.stats.chordSteps);
  const dense = cases.find((c) => c.label === '768:784'), d = arrangeArp(dense.spec, dense.M, 'lead');
  check(`768:784 at the defaults: every step holds a chord tone (${(100 * d.arp.stats.chordShare).toFixed(0)}%), none rests`, d.arp.stats.rests === 0 && d.arp.stats.chordShare === 1);
}

// ── 6. a chart's split bar: the span's chord ──
console.log('\n— a chart\'s split bar');
{
  const C = composed([119, 42, 15, 8], 8, { changes: [[1], [1, 1], [1], [1, 1, 1, 1]], label: 'chart' });
  const split = C.spec.chords.filter((c) => c.slots != null && c.slots < C.S);
  let bad = '', spanOnly = 0;
  for (const partId of ['lead', 'inner']) for (const pattern of ARP_PATTERNS) for (const rate of [1, 2, 4]) {
    const opt = readArpOptions({ pattern, rate }), p = arrangeArp(C.spec, C.M, partId, opt);
    bad ||= verify(C, p, partId, opt, leadOf(C.spec));
    // a note whose class is its span's chord's but not the bar's first chord's: the span decided it
    for (const n of p.notes) {
      const first = C.spec.chords.find((c) => c.bar === n.bar), own = C.chordAt[n.slot];
      if (own === first) continue;
      const q = classOfCents(C.row.toneCents[C.row.tone[n.node]] - C.cents(first));
      if (!(Math.abs(q.dev) <= C.spec.knobs.frameCentsEachSide + EPS && first.intervals.includes(q.pc))) spanOnly++;
    }
  }
  check(`${C.label}: ${split.length} spans in split bars; every note a chord tone of its span's chord, ${spanOnly} of them outside the bar's first chord`, split.length >= 5 && !bad && spanOnly > 0, bad);
}

// ── 7. a MIDI target ──
console.log('\n— a MIDI target');
{
  const twinkle = decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'twinkle'))));
  const C = composed([8, 7, 6, 5], 4, { target: { clip: twinkle }, label: 'twinkle' });
  const ode = decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'ode-to-joy'))));
  const W = composed([768, 769], 8, { target: { clip: ode }, label: 'ode-to-joy' });
  const R = composed([2047, 2048], 8, { target: { clip: decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'chromatic-run')))) }, label: 'chromatic-run' });
  check('the lead of a target spec is refused, with a reason a switch can show', /MIDI clip/.test(arpRefusal(C.spec, 'lead')) && throws(() => arrangeArp(C.spec, C.M, 'lead'), /MIDI clip/) && arpRefusal(C.spec, 'inner') === null);
  let bad = '';
  const windows = [C, W, R].map((T) => `${T.label} bars ${T.spec.target.placement.B} of ${T.spec.target.placement.N}`).join(', ');
  for (const T of [C, W, R]) for (const rate of [1, 2, 3]) { const opt = readArpOptions({ rate }), p = arrangeArp(T.spec, T.M, 'inner', opt); bad ||= verify(T, p, 'inner', opt, leadOf(T.spec)) && `${T.label}: ${verify(T, p, 'inner', opt, leadOf(T.spec))}`; }
  check(`its inner arranges inside the window (${windows}), off the clip's onsets`, !bad && [C, R].every((T) => T.spec.target.placement.N > T.spec.target.placement.B), bad);
}

// ── 8. deterministic; Back to Line; refusals and options ──
console.log('\n— deterministic, Back to Line, the options');
{
  const C = cases.find((c) => c.label === '19:17:16:15');
  const a = arrangeArp(C.spec, C.M, 'lead', { pattern: 'updown', rate: 3 }), b = arrangeArp(C.spec, materialsOf(C.spec), 'lead', { pattern: 'updown', rate: 3 });
  check('the same spec and options, byte-identical output (materials rebuilt too)', J(a) === J(b));
  check('the spec is not touched', J(C.spec) === J(compose([19, 17, 16, 15], 6, { seed: 1 })));
  const arped = structuredClone(C.spec);
  arped.parts[partIndex(arped, 'lead')] = a;
  arped.parts[partIndex(arped, 'inner')] = arrangeArp(arped, C.M, 'inner');
  check('Back to Line: lineOf(the arp part) is the Line part, byte for byte (lead and inner)', J(lineOf(arped.parts[partIndex(arped, 'lead')])) === J(leadOf(C.spec)) && J(lineOf(arped.parts[partIndex(arped, 'inner')])) === J(C.spec.parts[partIndex(C.spec, 'inner')]));
  check('re-arranging an arp part starts from its line: a knob change is the same as from Line', J(arrangeArp(arped, C.M, 'lead', { pattern: 'down' })) === J(arrangeArp(C.spec, C.M, 'lead', { pattern: 'down' })));
  check('the defaults: up, 2 a slot, 2 octaves, legato off', J(readArpOptions()) === J({ pattern: 'up', rate: 2, range: 2, legato: false }) && J(arrangeArp(C.spec, C.M, 'inner')) === J(arrangeArp(C.spec, C.M, 'inner', ARP_DEFAULTS)));
  check('the options checked', ['pattern', 'rate', 'range', 'legato', 'swing'].every((k) => throws(() => arrangeArp(C.spec, C.M, 'lead', { [k]: k === 'legato' ? 'yes' : 9 }), /composer\/arp/)));
  check('only the lead and the inner; a refused spec; no materials', /only the lead/.test(arpRefusal(C.spec, 'bass')) && throws(() => arrangeArp(C.spec, C.M, 'comp'), /only the lead/)
    && throws(() => arrangeArp({ refused: true }, C.M, 'lead'), /no composition/) && throws(() => arrangeArp(C.spec, null, 'lead'), /materials/));
  const other = cases.find((c) => c.label === '8:7:6:5');
  check('another spec\'s materials are refused', throws(() => arrangeArp(C.spec, other.M, 'lead'), /materials|root/));
}

// ── 9. the 16,359-onset row ──
console.log('\n— the 16,359-onset row');
{
  const C = composed([4099, 4093, 4091, 4079], 16);
  const rows = [];
  let worst = 0, bad = '';
  for (const partId of ['inner', 'lead']) {
    arrangeArp(C.spec, C.M, partId);
    const ms = [];
    let p;
    for (let k = 0; k < 7; k++) { const t0 = performance.now(); p = arrangeArp(C.spec, C.M, partId); ms.push(performance.now() - t0); }
    const m = median(ms), st = p.arp.stats;
    worst = Math.max(worst, m);
    bad ||= verify(C, p, partId, readArpOptions(), leadOf(C.spec));
    rows.push(`${partId}: ${st.notes} notes, ${st.rests} rests of ${st.steps} steps, ${(100 * st.chordShare).toFixed(0)}% holding a chord tone${partId === 'inner' ? ` (${st.restsForLead} rests for the lead)` : ''}, ${m.toFixed(2)} ms`);
  }
  const t0 = performance.now(); arrangeArp(C.spec, C.M, 'lead', { pattern: 'played', rate: 4, range: 3 }); const big = performance.now() - t0;
  check(`arrangeArp alone under 50 ms (median of 7: ${worst.toFixed(2)} ms; rate 4, range 3, as played: ${big.toFixed(2)} ms), every rule held`, worst < 50 && big < 50 && !bad, bad);
  console.log(`  · measured: ${rows.join('\n  · measured: ')}`);
}

// ── 10. the report's rows ──
console.log('\n— the report\'s rows, at the defaults');
for (const C of [cases[0], cases[2], cases.find((c) => c.label === '768:784')]) for (const partId of ['inner', 'lead']) {
  const t0 = performance.now(), p = arrangeArp(C.spec, C.M, partId), ms = performance.now() - t0, st = p.arp.stats;
  console.log(`  · ${C.label} ${partId}: ${st.notes} notes, ${st.rests} rests of ${st.steps}, ${(100 * st.chordShare).toFixed(0)}% holding a chord tone${partId === 'inner' ? ` (${st.restsForLead} for the lead)` : ''}, ${ms.toFixed(2)} ms`);
}

console.log(PASS ? `\n✓✓✓ ARP PASSES (${checks} checks)` : `\n✗ ARP FAILED`);
process.exit(PASS ? 0 : 1);
