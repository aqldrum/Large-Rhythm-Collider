// assert-arp.mjs — the Arp mode, mined (Composer/COMP_ARP_ORDER.md Amendment 1, phase D: M1–M7): core/arp.js
// `arrangeArp` over composed specs, read against the test's own S × time cells and the spec's chords.
//   • every mined note a real onset (its tick, ratio and time) inside its anchor's window on the S × time cells (one a
//     window), its class under the anchor's chord a chord tone, a parent-scale tone, or a foreign tone (fringe, or
//     out of the scale) resolved by step, never last;
//     its hz as Compose computes it; lengths (legato off: its anchor's span; on: to the next) and the strong-beat accent
//   • the chords rebuilt by rearrange.js' path (`chordRecordsOf`) are the spec's, modulations and all
//   • the ranking (M2): "no rests" before "few rests", then cost per note; at most 10 a phrase, distinct; the bands'
//     note counts; the part plays the picked arp, the first by default
//   • picks: another alternate plays where picked; a pick not offered falls back, marked `missed`
//   • the fallback (M4): a phrase with nothing mined is walked (B1's 'played': the earliest chord tone a step), marked;
//     M6: 768:769 mines (with weak ties) where lines.js' own weak rule finds nothing
//   • the inner's avoidance (M3): never on a lead onset, over a Line lead and over an arp lead; its `onLead` count
//   • register: the lead's arp on its line's median, the inner an octave under
//   • a chart's split bar: each anchor's chord the span's (spans scaled by the time); a 16-slot chart's ×3 runs ×2
//   • a MIDI target's lead refused; its inner arranged inside the window
//   • deterministic; Back to Line restores the part byte for byte; the options checked
//   • the 16,359-onset row at ×1, ×2, ×3 (materials prebuilt), and the report's rows
//   node Composer/tests/assert-arp.mjs
import { compose, VELOCITY } from '../core/compose.js';
import { materialsOf, chordRecordsOf } from '../core/rearrange.js';
import { buildCells, cropCells } from '../core/cells.js';
import { phrasesOf, isStrongBeat } from '../core/harmony.js';
import { bandNotes } from '../core/lines.js';
import { arrangeArp, arpRefusal, arpGeometry, arpLow, arpTimes, lineOf, readArpOptions, ARP_DEFAULTS, ARP_TYPE, ARP_ALTERNATES } from '../core/arp.js';
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
const EPS = 1e-9, STEP = 250;
const BAND = { 'no rests': 0, 'few rests': 1 };

console.log('═══ COMPOSER — Arp mode, mined: arrangeArp (Amendment 1, phase D) ═══');

/** a compose with its materials, and the test's own reading of its slots, chords and S × time cells (not arp.js') */
function composed(L, T, opts = {}) {
  const { label, ...rest } = opts;
  const spec = compose(L, T, { seed: 1, ...rest });
  if (spec.refused) return null;
  const M = materialsOf(spec), { row, cells } = M, k = spec.knobs;
  const rowT = k.rowCycleSeconds ?? k.cycleSeconds, phaseX = k.phase[0] / k.phase[1], W = cells.crop ? cells.crop.end : 1;
  const timeOf = (tick) => { const u = mod(tick / row.grid - phaseX, 1); return u < W ? u * rowT : k.cycleSeconds - (1 - u) * rowT; };
  const S = k.slotsPerBar, P = k.bars * S;
  const recs = chordRecordsOf(spec, row, cells), scale = new Set(recs.flatMap((c) => c.gridPcs));
  const chordAt = Array.from({ length: P }, (_, j) => recs.find((c) => (c.slots != null ? j >= c.from && j < c.from + c.slots : c.bar === Math.floor(j / S))));
  /** onset i under spec slot j's chord: { pc, dev, inside, chord (a chord tone), inScale } */
  const classOf = (i, j) => { const c = chordAt[j], q = classOfCents(row.toneCents[row.tone[i]] - c.rootCents), inside = Math.abs(q.dev) <= k.frameCentsEachSide + EPS;
    return { ...q, inside, chord: inside && c.intervals.includes(q.pc), inScale: scale.has(mod(q.pc + c.gridRootPc, 12)) }; };
  const fineCache = new Map();
  /** the S × time cells, built here (a target's cut cropped, as materialsOf crops the spec's) */
  const fine = (t) => {
    if (!fineCache.has(t)) {
      const o = { slotsPerBar: S * t, anchors: k.anchors, phase: k.phase };
      fineCache.set(t, k.cut ? cropCells(buildCells(row, { bars: k.cut.bars, ...o }), k.bars) : buildCells(row, { bars: k.bars, ...o }));
    }
    return fineCache.get(t);
  };
  const geo = arpGeometry(spec, M);
  return { spec, M, row, cells, k, rowT, timeOf, S, P, recs, chordAt, classOf, fine, geo, label: `${L.join(':')}${label ? ` ${label}` : ''}` };
}

const leadOf = (spec) => spec.parts.find((p) => p.id === 'lead');
const partIndex = (spec, id) => spec.parts.findIndex((p) => p.id === id);
const withPart = (spec, part) => { const s = { ...spec, parts: spec.parts.slice() }; s.parts[partIndex(s, part.id)] = part; return s; };

/** what breaks the order in an arranged part: '' or the first problem. `spec` is the one arranged over (its lead the inner avoids) */
function verify(C, part, partId, opt, spec = C.spec) {
  const { row, k } = C, a = part.arp, st = a.stats, time = st.time, F = C.fine(time), SF = C.S * time;
  const lead = partId === 'inner' ? leadOf(spec).notes : [], avoid = new Set(lead.map((n) => n.node));
  const leadAnchors = new Set(lead.map((n) => F.slotOfNode[n.node]).filter((f) => f >= 0));
  if (J(Object.keys(a)) !== J(['time', 'picks', 'legato', 'stats', 'phrases']) || a.time !== opt.time || J(a.picks) !== J(opt.picks) || a.legato !== opt.legato) return `the arp record ${J({ ...a, phrases: undefined })}`;
  if (J(arpTimes(C.spec)) !== J([1, 2, 3].filter((t) => C.S * t <= 32)) || time !== Math.max(...arpTimes(C.spec).filter((t) => t <= opt.time))) return `time ${time} for ${opt.time}`;
  const phrases = phrasesOf(F);
  if (J(a.phrases.map((p) => [p.from, p.bars, p.anchors])) !== J(phrases.map((p) => [p.from, p.bars, p.bars * SF]))) return 'the phrases are not phrasesOf(the S × time cells)';
  const byNode = new Map(part.notes.map((n) => [n.node, n]));
  if (byNode.size !== part.notes.length) return 'two notes on one onset';
  let counted = 0, chordTones = 0, onLead = 0, mined = 0, walked = 0;
  for (let p = 0; p < phrases.length; p++) {
    const ph = a.phrases[p], lo = ph.from * SF, hi = lo + ph.anchors, at = `${partId} ×${time} phrase ${p}`;
    const own = part.notes.filter((n) => n.bar >= ph.from && n.bar < ph.from + ph.bars);
    counted += own.length;
    if (ph.walked) {
      walked++;
      if (ph.picked !== null || ph.alternates.length) return `${at}: walked, yet ${ph.picked} of ${ph.alternates.length}`;
      // B1's walk, 'played': each step the earliest chord-tone onset in its sub-window, off the lead (and below rate 3 its steps)
      const leadSteps = new Set(lead.map((n) => C.geo.stepOf(n.node, time)));
      const want = [];
      for (let s = ph.from * C.S * time; s < (ph.from + ph.bars) * C.S * time; s++) {
        const j = Math.floor(s / time);
        if (partId === 'inner' && time < 3 && leadSteps.has(s)) continue;
        const cands = C.geo.ctx.inSlot[j].filter((i) => !avoid.has(i) && C.geo.stepOf(i, time) === s && C.classOf(i, j).chord);
        if (cands.length) want.push({ i: cands[0], s, j });
      }
      if (J(own.map((n) => n.node).sort((x, y) => x - y)) !== J(want.map((w) => w.i).sort((x, y) => x - y))) return `${at}: walked notes ${own.map((n) => n.node)} not the steps' earliest chord tones ${want.map((w) => w.i)}`;
      for (const w of want) {
        const n = byNode.get(w.i), stepSec = C.geo.slotLength(w.j) / time;
        if (n.slot !== w.j || Math.abs(n.slotSeconds - stepSec) > 1e-9) return `${at}: walked note ${w.i} slot ${n.slot} / ${n.slotSeconds}`;
        if (Math.abs(n.velocity - Math.min(1, VELOCITY[partId] + (w.s % time === 0 && isStrongBeat(w.j % C.S, C.S) ? 0.1 : 0))) > 1e-12) return `${at}: walked note ${w.i} velocity ${n.velocity}`;
        chordTones++;
        if (leadAnchors.has(F.slotOfNode[w.i])) onLead++;
      }
      continue;
    }
    mined++;
    // the ranking: no rests first, then few rests, then cost per note; distinct; ≤ 10; each band's note count
    const alts = ph.alternates;
    if (!alts.length || alts.length > ARP_ALTERNATES || new Set(alts.map((x) => x.id)).size !== alts.length) return `${at}: ${alts.length} alternates`;
    for (let i = 1; i < alts.length; i++) {
      const x = alts[i - 1], y = alts[i];
      if (BAND[x.band] > BAND[y.band] || (x.band === y.band && x.perNote > y.perNote + EPS)) return `${at}: alternates out of order at ${i}`;
    }
    for (const x of alts) {
      const [nMin, nMax] = bandNotes(ARP_TYPE.bands.find((b) => b.band === x.band), ph.anchors);
      if (!(x.n === x.notes.length && x.n >= nMin && x.n <= nMax)) return `${at}: a ${x.band} arp of ${x.n} notes over ${ph.anchors} anchors`;
      if (!['rise', 'fall', 'arch', 'valley', 'wave'].includes(x.contour)) return `${at}: contour ${x.contour}`;
      const steps = x.notes.map((n) => n.step);
      if (steps.some((s, i) => s < lo || s >= hi || (i && s <= steps[i - 1]))) return `${at}: an arp's anchors ${steps} outside ${lo}–${hi - 1} or out of order`;
    }
    // the part plays the picked arp
    const want = opt.picks[p], chosen = alts.find((x) => x.id === want) ?? alts[0];
    if (ph.picked !== chosen.id || (want != null && want !== chosen.id) !== (ph.missed === want && want != null)) return `${at}: picked ${ph.picked}, missed ${ph.missed} (asked ${want})`;
    if (J(own.map((n) => [n.node, n.octave]).sort((x, y) => x[0] - y[0])) !== J(chosen.notes.map((n) => [n.node, n.octave]).sort((x, y) => x[0] - y[0]))) return `${at}: the part is not the picked arp`;
    for (let q = 0; q < chosen.notes.length; q++) {
      const { step, node: i } = chosen.notes[q], n = byNode.get(i), j = Math.floor(step / time), wh = `${at} note ${q} (node ${i})`;
      // a real onset, inside its anchor's window, at its own time
      if (!(i >= 0 && i < row.n) || n.tick !== row.tick[i] || n.ratio !== row.tones[row.tone[i]]) return `${wh}: not its onset's tick or ratio`;
      if (Math.abs(n.time - C.timeOf(n.tick)) > 1e-9) return `${wh}: off its time`;
      if (F.slotOfNode[i] !== step) return `${wh}: not in anchor ${step}'s window (it is ${F.slotOfNode[i]}'s)`;
      if (n.bar !== Math.floor(step / SF) || n.slot !== j) return `${wh}: bar ${n.bar} slot ${n.slot} for anchor ${step}`;
      if (avoid.has(i)) return `${wh}: on a lead onset`;
      // its class under the anchor's chord: a chord tone, a parent-scale tone, or a foreign one (a fringe tone, or a
      // class outside the scale: lines.js' weak-anchor passing tone) resolved by step to one that is not, never last
      const cls = C.classOf(i, j), foreign = (x) => !x.inside || !x.inScale;
      if (cls.chord) chordTones++;
      else if (foreign(cls)) {
        const next = chosen.notes[q + 1];
        if (!next) return `${wh}: a foreign tone (pc ${cls.pc}, ${cls.dev.toFixed(1)}¢) last`;
        const pitch = (x) => row.toneCents[row.tone[x.node]] + 1200 * x.octave;
        if (foreign(C.classOf(next.node, Math.floor(next.step / time))) || Math.abs(pitch(next) - pitch(chosen.notes[q])) > STEP) return `${wh}: a foreign tone not resolved by step`;
      }
      if (leadAnchors.has(step)) onLead++;
      // hz, velocity, lengths
      const [num, den] = n.ratio.split('/').map(Number), hz = k.baseHz * (num / den) * 2 ** n.octave * C.chordAt[j].fundamentalRatio;
      if (Math.abs(n.hz - hz) > 1e-9 * hz) return `${wh}: hz ${n.hz} not ${hz}`;
      const beat = step % SF;
      if (Math.abs(n.velocity - Math.min(1, VELOCITY[partId] + (beat % time === 0 && isStrongBeat(beat / time, C.S) ? 0.1 : 0))) > 1e-12) return `${wh}: velocity ${n.velocity}`;
      if (Math.abs(n.slotSeconds - F.slots[step].length * C.rowT) > 1e-9) return `${wh}: slotSeconds ${n.slotSeconds} not its anchor's`;
    }
  }
  if (counted !== part.notes.length) return `${part.notes.length - counted} notes outside every phrase`;
  part.notes.forEach((n, i) => { const gap = (i + 1 < part.notes.length ? part.notes[i + 1].time : k.cycleSeconds) - n.time; if (Math.abs(n.duration - Math.max(0, opt.legato ? gap : Math.min(n.slotSeconds, gap))) > 1e-9) counted = -1; });
  if (counted < 0) return `a duration off (legato ${opt.legato})`;
  const want = { time, phrases: phrases.length, mined, walked, anchors: F.P, notes: part.notes.length, rests: F.P - part.notes.length, chordTones, chordShare: part.notes.length ? chordTones / part.notes.length : 0, ...(partId === 'inner' ? { onLead } : {}) };
  if (J(st) !== J(want)) return `stats ${J(st)}, not ${J(want)}`;
  if (part.id !== partId || part.role !== partId || part.legato !== opt.legato || part.sound !== lineOf(part).sound || part.enabled !== lineOf(part).enabled) return 'the part\'s id, sound, legato or on/off';
  if (J(lineOf(part)) !== J(lineOf(spec.parts[partIndex(spec, partId)]))) return 'the kept line is not the spec\'s';
  return '';
}

// ── 1. the order's rules, over rows × parts × times ──
console.log('\n— every note a real onset in its anchor\'s window; its class; ranking and picks as played; stats');
const PROBED = { '8:7:6:5': 4, '11:9:7:5': 5, '19:17:16:15': 6, '16:12:9': 6, '119:42:15:8': 8, '426:317:285': 8 };   // row → its cycle (s)
const ROWS = [...HAND_PICKED.filter((L) => L.join(':') in PROBED).map((L) => [L, PROBED[L.join(':')]]), [[768, 769], 8], [[768, 784], 8]];
const cases = ROWS.map(([L, T]) => composed(L, T));
const caseOf = (label) => cases.find((c) => c.label === label);
for (const C of cases) {
  let bad = '', runs = 0;
  for (const partId of ['lead', 'inner']) for (const time of [1, 2, 3]) for (const legato of [false, true]) {
    if (legato && time !== 2) continue;
    const opt = readArpOptions({ time, legato }), part = arrangeArp(C.spec, C.M, partId, opt);
    runs++;
    const why = verify(C, part, partId, opt);
    bad ||= why && `${partId} ${J(opt)}: ${why}`;
  }
  check(`${C.label}: ${runs} arrangements (lead and inner × ×1–×3, legato on and off) hold every rule`, !bad, bad);
}
{
  let same = true;
  for (const C of [...cases, composed([4099, 4093, 4091, 4079], 16)]) same &&= C.recs.length === C.spec.chords.length && C.recs.every((r, i) => { const c = C.spec.chords[i]; return r.name === c.name && r.rootFraction === c.rootTone && J(r.intervals) === J(c.intervals) && Math.abs(r.fundamentalRatio - c.fundamentalRatio) < 1e-12; });
  check('chordRecordsOf (rearrange.js\' path) rebuilds every spec\'s chords: names, roots, intervals, retunes (the 16k row modulates)', same);
}

// ── 2. the ranking (M2) ──
console.log('\n— the ranking');
{
  let noRestsFirst = 0, cheaperFew = 0, phrasesSeen = 0;
  for (const C of cases) for (const partId of ['lead', 'inner']) for (const time of [1, 2, 3]) for (const ph of arrangeArp(C.spec, C.M, partId, { time }).arp.phrases) {
    if (ph.walked) continue;
    phrasesSeen++;
    const no = ph.alternates.filter((x) => x.band === 'no rests'), few = ph.alternates.filter((x) => x.band === 'few rests');
    if (no.length) noRestsFirst++;
    if (no.length && few.some((x) => x.perNote < no[0].perNote - EPS)) cheaperFew++;
  }
  check(`"no rests" ranks first wherever it exists (${noRestsFirst} of ${phrasesSeen} mined phrases), even over cheaper "few rests" arps (${cheaperFew} phrases hold one)`, noRestsFirst > 0 && cheaperFew > 0);
  const C = caseOf('768:784'), p = arrangeArp(C.spec, C.M, 'lead');
  check(`768:784 ×1: the phrase's ${p.arp.phrases[0].alternates.length} arps, the first "no rests", one note an anchor (${p.notes.length} of ${p.arp.stats.anchors})`, p.arp.phrases[0].alternates.length === ARP_ALTERNATES && p.arp.phrases[0].alternates[0].band === 'no rests' && p.notes.length === p.arp.stats.anchors);
}

// ── 3. picks ──
console.log('\n— picks');
{
  const C = caseOf('119:42:15:8'), base = arrangeArp(C.spec, C.M, 'lead', { time: 2 });
  const p0 = base.arp.phrases.findIndex((x) => x.alternates.length >= 3), third = base.arp.phrases[p0].alternates[2];
  const opt = readArpOptions({ time: 2, picks: { [p0]: third.id } }), picked = arrangeArp(C.spec, C.M, 'lead', opt);
  check(`phrase ${p0 + 1}'s third arp (${third.contour} · ${third.band}) picked: it plays, the other phrases as before`, picked.arp.phrases[p0].picked === third.id && !verify(C, picked, 'lead', opt)
    && picked.arp.phrases.every((x, i) => i === p0 || x.picked === base.arp.phrases[i].picked) && J(picked.notes) !== J(base.notes));
  const optX = readArpOptions({ time: 2, picks: { [p0]: 'cl1:00000000' } }), stale = arrangeArp(C.spec, C.M, 'lead', optX);
  check('a pick the phrase does not offer: the first plays, the pick marked missed', stale.arp.phrases[p0].picked === base.arp.phrases[p0].picked && stale.arp.phrases[p0].missed === 'cl1:00000000' && J(stale.notes) === J(base.notes) && !verify(C, stale, 'lead', optX));
}

// ── 4. the fallback (M4) and 768:769 (M6) ──
console.log('\n— the fallback, and 768:769');
{
  const small = caseOf('8:7:6:5'), w = arrangeArp(small.spec, small.M, 'lead', { time: 2 });
  check(`8:7:6:5 ×2: nothing mined, the phrase walked and marked (${w.arp.stats.notes} notes of ${w.arp.stats.anchors}, every one a chord tone)`, w.arp.stats.walked === 1 && w.arp.stats.mined === 0 && w.arp.phrases[0].walked && w.arp.phrases[0].picked === null && w.arp.stats.chordShare === 1 && w.notes.length > 0);
  const wp = arrangeArp(small.spec, small.M, 'lead', { time: 2, picks: { 0: 'cl1:00000000' } });
  check('… a pick on a walked phrase is marked missed', wp.arp.phrases[0].missed === 'cl1:00000000' && J(wp.notes) === J(w.notes));
  const C = caseOf('768:769'), m1 = arrangeArp(C.spec, C.M, 'lead', { time: 1 }), m2 = arrangeArp(C.spec, C.M, 'lead', { time: 2 });
  check(`768:769 (evenly struck: no anchor under the median) mines with weak ties: ×1 ${m1.arp.stats.mined}/${m1.arp.stats.phrases}, ×2 ${m2.arp.stats.mined}/${m2.arp.stats.phrases} phrases`,
    m1.arp.stats.mined === 1 && m1.arp.phrases[0].weakTies === true && m2.arp.stats.mined === 2 && m2.arp.phrases.every((x) => x.weakTies));
  const dense = caseOf('768:784'), d = arrangeArp(dense.spec, dense.M, 'lead', { time: 3 });
  check('a row with weak anchors of its own needs no ties (768:784 ×3)', d.arp.stats.walked === 0 && d.arp.phrases.every((x) => !x.weakTies));
}

// ── 5. the inner's avoidance (M3), over a Line lead and an arp lead (Q5) ──
console.log('\n— the inner keeps off the lead');
for (const C of cases.filter((c) => c.row.n >= 1000 || c.label === '119:42:15:8')) {
  const out = [];
  let bad = '';
  for (const time of [1, 2, 3]) {
    const leadArp = arrangeArp(C.spec, C.M, 'lead', { time }), arped = withPart(C.spec, leadArp);
    for (const [spec, how] of [[C.spec, 'line'], [arped, 'arp']]) {
      const opt = readArpOptions({ time }), p = arrangeArp(spec, C.M, 'inner', opt);
      bad ||= verify(C, p, 'inner', opt, spec) && `×${time} over the ${how} lead: ${verify(C, p, 'inner', opt, spec)}`;
      if (how === 'line') out.push(`×${time} ${p.arp.stats.onLead}/${p.arp.stats.notes}`);
    }
  }
  check(`${C.label}: never on a lead onset over the Line lead and over an arp lead, ×1–×3 (on an anchor where the Line lead sounds: ${out.join(', ')})`, !bad, bad);
}
check('the lead\'s stats carry no onLead', !('onLead' in arrangeArp(cases[0].spec, cases[0].M, 'lead').arp.stats));

// ── 6. register ──
console.log('\n— register');
{
  const ps = (c, p) => p.notes.map((n) => n.octave * 1200 + c.row.toneCents[c.row.tone[n.node]]);
  const meds = cases.filter((c) => c.row.n >= 100).map((c) => ({ c, line: median(ps(c, leadOf(c.spec))), arp: median(ps(c, arrangeArp(c.spec, c.M, 'lead'))), inner: median(ps(c, arrangeArp(c.spec, c.M, 'inner'))) }));
  check(`the lead's arp sits on its line's median (Δ ${meds.map((m) => `${(m.arp - m.line).toFixed(0)}`).join(', ')}¢), the inner's an octave under it (${meds.map((m) => `${(m.inner - m.arp).toFixed(0)}`).join(', ')}¢)`,
    meds.every((m) => Math.abs(m.arp - m.line) <= 700 && Math.abs(m.arp - m.inner - 1200) <= 700));
  const C = caseOf('768:784');
  check('arpLow: the lead\'s line median less 600, the inner\'s an octave under', Math.abs(arpLow(C.spec, C.M, 'lead') - (median(ps(C, leadOf(C.spec))) - 600)) < 1e-9 && Math.abs(arpLow(C.spec, C.M, 'inner') - arpLow(C.spec, C.M, 'lead') + 1200) < 1e-9);
}

// ── 7. a chart's split bar ──
console.log('\n— a chart\'s split bar');
{
  const C = composed([119, 42, 15, 8], 8, { changes: [[1], [1, 1], [1], [1, 1, 1, 1]], label: 'chart' });
  const split = C.recs.filter((c) => c.slots != null && c.slots < C.S);
  let bad = '', spanOnly = 0;
  for (const partId of ['lead', 'inner']) for (const time of [1, 2, 3]) {
    const opt = readArpOptions({ time }), p = arrangeArp(C.spec, C.M, partId, opt);
    bad ||= verify(C, p, partId, opt) && `${partId} ×${time}: ${verify(C, p, partId, opt)}`;
    // a chord tone of its span's chord that the bar's first chord does not hold: the span decided it
    for (const n of p.notes) {
      const first = C.recs.find((c) => c.bar === n.bar), own = C.chordAt[n.slot];
      if (own === first || !C.classOf(n.node, n.slot).chord) continue;
      const q = classOfCents(C.row.toneCents[C.row.tone[n.node]] - first.rootCents);
      if (!(Math.abs(q.dev) <= C.k.frameCentsEachSide + EPS && first.intervals.includes(q.pc))) spanOnly++;
    }
  }
  check(`${C.label}: ${split.length} spans in split bars; every note read under its span's chord, ${spanOnly} chord tones outside the bar's first chord`, split.length >= 5 && !bad && spanOnly > 0, bad);
  const W = composed([768, 784], 8, { changes: [[1, 1], [1, 1], [1, 1], [1, 1]], overrides: { slotsPerBar: 16 }, label: '16 slots a bar' });
  const p3 = arrangeArp(W.spec, W.M, 'lead', { time: 3 });
  check(`a chart at 16 slots a bar: ×3 would pass 32 anchors a phrase, so ×2 runs (stats.time ${p3.arp.stats.time}, arpTimes ${J(arpTimes(W.spec))})`, W.S === 16 && J(arpTimes(W.spec)) === '[1,2]' && p3.arp.time === 3 && p3.arp.stats.time === 2 && !verify(W, p3, 'lead', readArpOptions({ time: 3 })));
}

// ── 8. a MIDI target ──
console.log('\n— a MIDI target');
{
  const clip = (name) => decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === name))));
  const targets = [composed([8, 7, 6, 5], 4, { target: { clip: clip('twinkle') }, label: 'twinkle' }), composed([768, 769], 8, { target: { clip: clip('ode-to-joy') }, label: 'ode-to-joy' }),
    composed([2047, 2048], 8, { target: { clip: clip('chromatic-run') }, label: 'chromatic-run' })];
  const C = targets[0];
  check('the lead of a target spec is refused, with a reason a switch can show', /MIDI clip/.test(arpRefusal(C.spec, 'lead')) && throws(() => arrangeArp(C.spec, C.M, 'lead'), /MIDI clip/) && arpRefusal(C.spec, 'inner') === null);
  let bad = '';
  for (const T of targets) for (const time of [1, 2, 3]) { const opt = readArpOptions({ time }), p = arrangeArp(T.spec, T.M, 'inner', opt); bad ||= verify(T, p, 'inner', opt) && `${T.label} ×${time}: ${verify(T, p, 'inner', opt)}`; }
  check(`its inner arranges inside the window (${targets.map((T) => `${T.label} bars ${T.spec.target.placement.B} of ${T.spec.target.placement.N}`).join(', ')}), off the clip's onsets`,
    !bad && [targets[0], targets[2]].every((T) => T.spec.target.placement.N > T.spec.target.placement.B), bad);
}

// ── 9. deterministic; Back to Line; refusals and options ──
console.log('\n— deterministic, Back to Line, the options');
{
  const C = caseOf('19:17:16:15');
  const a = arrangeArp(C.spec, C.M, 'lead', { time: 2 }), b = arrangeArp(C.spec, materialsOf(C.spec), 'lead', { time: 2 });
  check('the same spec and options, byte-identical output (materials rebuilt too)', J(a) === J(b));
  check('the spec is not touched', J(C.spec) === J(compose([19, 17, 16, 15], 6, { seed: 1 })));
  const arped = withPart(C.spec, a), both = withPart(arped, arrangeArp(arped, C.M, 'inner'));
  check('Back to Line: lineOf(the arp part) is the Line part, byte for byte (lead and inner)', J(lineOf(both.parts[partIndex(both, 'lead')])) === J(leadOf(C.spec)) && J(lineOf(both.parts[partIndex(both, 'inner')])) === J(C.spec.parts[partIndex(C.spec, 'inner')]));
  check('re-arranging an arp part starts from its line: a knob change is the same as from Line', J(arrangeArp(arped, C.M, 'lead', { time: 3 })) === J(arrangeArp(C.spec, C.M, 'lead', { time: 3 })));
  check('the defaults: ×1, no picks, legato off', J(readArpOptions()) === J({ time: 1, picks: {}, legato: false }) && J(arrangeArp(C.spec, C.M, 'inner')) === J(arrangeArp(C.spec, C.M, 'inner', ARP_DEFAULTS)));
  check('the options checked (B1\'s pattern, rate and range are gone)', [{ time: 4 }, { time: '2' }, { picks: [] }, { picks: { a: 'x' } }, { picks: { 0: 3 } }, { legato: 'yes' }, { pattern: 'up' }, { rate: 2 }, { range: 2 }]
    .every((o) => throws(() => arrangeArp(C.spec, C.M, 'lead', o), /composer\/arp/)));
  check('only the lead and the inner; a refused spec; no materials', /only the lead/.test(arpRefusal(C.spec, 'bass')) && throws(() => arrangeArp(C.spec, C.M, 'comp'), /only the lead/)
    && throws(() => arrangeArp({ refused: true }, C.M, 'lead'), /no composition/) && throws(() => arrangeArp(C.spec, null, 'lead'), /materials/));
  check('another spec\'s materials are refused', throws(() => arrangeArp(C.spec, caseOf('8:7:6:5').M, 'lead'), /materials|tone of the row/));
}

// ── 10. the 16,359-onset row (M7) ──
console.log('\n— the 16,359-onset row');
const BIG = composed([4099, 4093, 4091, 4079], 16);
{
  const C = BIG, rows = [];
  let bad = '', worst = 0;
  for (const time of [1, 2, 3]) {
    const leadArp = arrangeArp(C.spec, C.M, 'lead', { time }), arped = withPart(C.spec, leadArp);
    for (const partId of ['lead', 'inner']) {
      const ms = [];
      let p;
      for (let r = 0; r < 3; r++) { const t0 = performance.now(); p = arrangeArp(C.spec, C.M, partId, { time }); ms.push(performance.now() - t0); }
      const m = median(ms), st = p.arp.stats;
      worst = Math.max(worst, m);
      bad ||= verify(C, p, partId, readArpOptions({ time })) && `${partId} ×${time}: ${verify(C, p, partId, readArpOptions({ time }))}`;
      rows.push(`×${time} ${partId}: ${st.mined} mined / ${st.walked} walked of ${st.phrases} phrases, ${st.notes} notes of ${st.anchors}, ${(100 * st.chordShare).toFixed(0)}% chord tones, ${m.toFixed(1)} ms`);
    }
    const opt = readArpOptions({ time }), inner = arrangeArp(arped, C.M, 'inner', opt);
    bad ||= verify(C, inner, 'inner', opt, arped) && `inner ×${time} over the arp lead: ${verify(C, inner, 'inner', opt, arped)}`;
  }
  check(`×1–×3, lead and inner, every rule held; each under 150 ms (the worst, median of 3: ${worst.toFixed(1)} ms)`, !bad && worst < 150, bad);
  console.log(`  · measured: ${rows.join('\n  · measured: ')}`);
}

// ── 11. the report's rows ──
console.log('\n— the report\'s rows');
for (const C of [caseOf('8:7:6:5'), caseOf('19:17:16:15'), caseOf('768:769'), caseOf('768:784'), caseOf('119:42:15:8'), BIG]) for (const time of [1, 2, 3]) for (const partId of ['inner', 'lead']) {
  const t0 = performance.now(), p = arrangeArp(C.spec, C.M, partId, { time }), ms = performance.now() - t0, st = p.arp.stats;
  console.log(`  · ${C.label} ×${time} ${partId}: arps a phrase [${p.arp.phrases.map((x) => (x.walked ? 'walked' : x.alternates.length)).join(', ')}], ${st.mined} mined / ${st.walked} walked, ${(100 * st.chordShare).toFixed(0)}% chord tones, ${ms.toFixed(1)} ms`);
}

console.log(PASS ? `\n✓✓✓ ARP PASSES (${checks} checks)` : `\n✗ ARP FAILED`);
process.exit(PASS ? 0 : 1);
