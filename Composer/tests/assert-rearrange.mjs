// assert-rearrange.mjs — STEP 4a, 4: core/rearrange.js (a chord swap, a lead swap) and lines.js' boundaries.
//   • identity: every bar swapped to its own chord (from the spec, and from the trace's own candidate), and every phrase
//     to its own line, gives the spec byte for byte — over rhythms, seeds, modulation off, a targeted progression,
//     drum modes, the full table
//   • every candidate (the chosen round's, 12 a bar) swaps without throwing, and every runner-up line (8 a phrase), with
//     chords following too
//   • every note of every part, and every drum stroke, stays a real onset of the row, in its own bar and slot
//   • only the dependent parts and bars change: a chord swap moves bar k's chords, comping, bass and inner (and the empty
//     bars that take its chord); the lead stays (decision 1); later bars only re-pitch (`retunedBars`), never re-mine,
//     and under the led voicing their chord voices and comp tones may move by octaves (`revoicedBars`, BASS_VOICING_ORDER P8);
//     a lead swap moves the phrase's lead and inner, the chords only under `chordsFollow`; baseHz, the comp layer and
//     every part's sound and legato are pinned; targets.scale is fixed
//   • lines.js `rules: { before, after }`: the picker and the scorer agree on every boundary cost; absent, nothing moves
//   • the cost on the 16,359-onset row: a chord swap (lean and full table), a lead swap, `materialsOf`
//   node Composer/tests/assert-rearrange.mjs
import { compose as composeAny, PART_IDS } from '../core/compose.js';
import { rearrange, applyRearrange, materialsOf } from '../core/rearrange.js';
import { phrasesOf } from '../core/harmony.js';
import { classOfCents, frameAt } from '../core/frame.js';
import { lowerBoundTick } from '../core/row.js';
import { buildLattice, pickLines, scoreLine, LINE_TYPES, MOTIONS, bandNotes, rootTargets } from '../core/lines.js';
import { rootCandidates } from '../core/progression.js';
import { RHYTHMS } from './rhythms.mjs';
// the clave from the pattern (BASS_VOICING_ORDER.md P19): this suite freezes the clave before phase I, so every Compose
// here asks `claveFrom: 'pattern'` (as `voicing: 'close'` pinned phase F; not under compStyle 'notes', which has no clave).
// The frame clave's own checks are assert-frame-clave.mjs. It freezes Compose's bass before Amendment 2 too (P28: Compose's
// own is now Moving · Kick, a bass.js arrangement whose kick notes may sit on an onset across the slot's edge), so every
// Compose here asks `bass: { density: 'sparse', lock: 'free' }`; assert-bass.mjs checks a swap of the arranged default.
const OWN_BASS = { bass: { density: 'sparse', lock: 'free' } };
const compose = (L, T, o = {}) => composeAny(L, T, o.overrides?.compStyle === 'notes' ? { ...o, overrides: { ...OWN_BASS, ...(o.overrides ?? {}) } } : { ...o, overrides: { claveFrom: 'pattern', ...OWN_BASS, ...(o.overrides ?? {}) } });

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

console.log('═══ COMPOSER — rearrange: local chord and lead swaps (step 4a) ═══');

/** a compose, its trace apart, with its materials */
function composed(L, T, opts) {
  const full = compose(L, T, { ...opts, trace: {} });
  if (full.refused) return null;
  const { trace, ...spec } = full, { row, cells } = materialsOf(spec);
  return { spec, trace, row, cells, L, T, label: `${L.filter(Boolean).join(':')}${opts.label ? ` ${opts.label}` : ''} seed ${opts.seed}` };
}
/** the chosen round's chord events, by bar */
const chordEvents = (trace) => { const h = trace.events.find((e) => e.kind === 'harmony'); return trace.events.filter((e) => e.kind === 'chord' && e.round === h.chosenRound); };
/** per phrase, the runner-up lines of the mining whose line was kept */
function leadAlternates(trace) {
  const h = trace.events.find((e) => e.kind === 'harmony');
  return h.lead.phrases.map((id, p) => {
    const evs = trace.events.filter((e) => e.kind === 'lead' && e.phrase === p && e.mined && e.mined.id === id);
    return { kept: id, runnersUp: evs.length ? evs[evs.length - 1].runnersUp.map((r) => r.id) : [] };
  });
}

/** what breaks the onset rule in a rearranged spec: '' or the first problem */
function realOnsets(C, spec) {
  const { row, cells } = C, S = spec.knobs.slotsPerBar, phaseX = spec.knobs.phase[0] / spec.knobs.phase[1], T = spec.knobs.cycleSeconds;
  const starts = cells.slots.map((s) => mod(s.anchor - phaseX, 1));
  const slotOf = (i) => { const x = mod(row.x[i] - phaseX, 1); let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x + 1e-9) lo = mid; else hi = mid - 1; } return lo; };
  for (const p of spec.parts) for (const n of p.notes) {
    if (!(n.node >= 0 && n.node < row.n)) return `${p.id}: node ${n.node} is not an onset`;
    // a comp tone borrowed in chords (COMP_ARP_ORDER.md P4) sounds at its stroke's onset with its source voice's tone (`from`)
    if (n.tick !== row.tick[n.node] || n.ratio !== row.tones[row.tone[n.borrowed ? n.from : n.node]]) return `${p.id}: node ${n.node}'s tick or ratio is not its onset's`;
    if (Math.abs(n.time - mod(n.tick / row.grid - phaseX, 1) * T) > 1e-9) return `${p.id}: node ${n.node} off its time`;
    // a note's slot: the one its onset falls in from the phase (chord voices, comping) or the one whose window holds it (the mined lines)
    // (Compose's own quirk, kept: a bass bar with no line plays its chord's root onset, `slot` that onset's from the phase,
    // which may be the bar before's last when the root sounds in the bar's first window just before its downbeat)
    const held = cells.slotOfNode[n.node], inBar = Math.floor(n.slot / S) === n.bar || (held >= 0 && Math.floor(held / S) === n.bar);
    if ((slotOf(n.node) !== n.slot && held !== n.slot) || !inBar) return `${p.id}: node ${n.node} not in its slot ${n.slot} / bar ${n.bar}`;
    const [num, den] = n.ratio.split('/').map(Number), hz = spec.knobs.baseHz * (num / den) * 2 ** n.octave * spec.chords[n.bar].fundamentalRatio;
    if (Math.abs(hz - n.hz) > 1e-9 * hz) return `${p.id}: node ${n.node}'s hz is not baseHz × ratio × 2^octave × its bar's retune`;
  }
  for (const x of spec.drums?.hits || []) { const i = lowerBoundTick(row, x.tick); if (!(i < row.n && row.tick[i] === x.tick)) return `drums: a stroke at tick ${x.tick} is not an onset`; }
  return '';
}
/** notes of a part by bar, without duration/retrigger (and without hz, for a re-pitch; without octave, lane and hz, and in
 *  any order — simultaneous notes on one onset fall in lane order — for a led chord's revoicing: BASS_VOICING_ORDER.md P8) */
const barNotes = (part, bar, { hz = true, octaves = true } = {}) => { const xs = part.notes.filter((n) => n.bar === bar).map(({ duration, retrigger, hz: h, octave, lane, ...rest }) => J(octaves ? { ...rest, octave, ...(lane != null ? { lane } : {}), ...(hz ? { h } : {}) } : rest)); return (octaves ? xs : xs.sort()).join('\n'); };
const CHORD_PITCH_FIELDS = ['name', 'pcs', 'rootPc', 'offsetCents', 'rawOffsetCents', 'fundamentalRatio', 'offGrid'];
const chordBut = (c, fields) => { const x = { ...c }; for (const f of fields) delete x[f]; return J(x); };

/** what a chord swap at bar k moved that it should not have: '' or the first problem */
function swapBreak(C, k, cand, r, next) {
  const { spec } = C, N = spec.knobs.bars, moved = new Set([...r.changedBars, ...r.retunedBars]);
  const own = new Set(r.changedBars);
  if (r.chords[k].rootTone !== C.row.tones[cand.root.tone] || r.chords[k].quality !== cand.quality) return `bar ${k}: not the candidate's chord`;
  for (const j of r.changedBars) if (j !== k && !(spec.chords[j].empty)) return `bar ${j} changed (not k, not empty)`;
  for (let j = 0; j < N; j++) {
    if (own.has(j)) continue;
    const retuned = r.retunedBars.includes(j);
    if (retuned && j <= k) return `bar ${j} retuned, at or before the swap`;
    if (chordBut(r.chords[j], retuned ? CHORD_PITCH_FIELDS : []) !== chordBut(spec.chords[j], retuned ? CHORD_PITCH_FIELDS : [])) return `bar ${j}'s chord moved`;
    // led chords (BASS_VOICING_ORDER.md P8): a later bar's chord voices (and the comp's tones, in chords) may move by octaves
    const revoiced = (r.revoicedBars ?? []).includes(j);
    for (const id of PART_IDS) {
      const a = next.parts.find((p) => p.id === id), b = spec.parts.find((p) => p.id === id), octaves = !(revoiced && (id === 'chords' || id === 'comp'));
      if (barNotes(a, j, { hz: !retuned, octaves }) !== barNotes(b, j, { hz: !retuned, octaves })) return `${id} in bar ${j} moved`;
    }
  }
  // the lead stays (decision 1): only its hz in a retuned bar
  const leadA = next.parts[0], leadB = spec.parts[0];
  if (leadA.notes.length !== leadB.notes.length || leadA.notes.some((n, i) => n.node !== leadB.notes[i].node || n.octave !== leadB.notes[i].octave || (!moved.has(n.bar) && n.hz !== leadB.notes[i].hz))) return 'the lead moved';
  // pinned: baseHz, the comp's clave (in chords: Amendment 1) or its layer (notes), every part's sound and legato;
  // targets.scale fixed (no other bar re-mined, above)
  if (next.knobs.baseHz !== spec.knobs.baseHz || JSON.stringify(next.clave) !== JSON.stringify(spec.clave) || next.stats.compLayer?.layer !== spec.stats.compLayer?.layer) return 'baseHz, the clave or the comp layer moved';
  for (const p of next.parts) { const q = spec.parts.find((x) => x.id === p.id); if (p.sound !== q.sound || p.legato !== q.legato || p.enabled !== q.enabled) return `${p.id}'s sound or legato moved`; }
  // the comping: in chords every stroke of bar k a landed step of the pinned clave (Sync its own, Fill its partner's), or
  // the bar's root onset alone (the strum's tones any onset near them, and of the new chord: assert-comp.mjs); in notes
  // every note struck by the pinned layer
  const comp = next.parts.find((p) => p.id === 'comp');
  if (spec.clave) {
    const src = new Set((spec.clave.relation === 'fill' ? spec.clave.partner.strokes.filter((x) => !x.shared) : spec.clave.strokes).map((x) => x.node));
    for (const n of comp.strokes.filter((x) => x.bar === k)) if (!src.has(n.node) && n.node !== next.chords[k].rootNode) return `bar ${k}: a comp stroke off the pinned clave`;
  } else {
    const layer = 'ABCD'.indexOf(spec.stats.compLayer.layer);
    for (const n of comp.notes.filter((x) => x.bar === k)) if (!(C.row.owners[n.node] & (1 << layer)) && n.node !== next.chords[k].rootNode) return `bar ${k}: a comp stroke off the pinned layer`;
  }
  // the new chord's tones: every chord voice of bar k is a class of the chord, inside the frame
  const c = r.chords[k], rootCents = C.row.toneCents[C.row.tones.indexOf(c.rootTone)];
  for (const n of next.parts.find((p) => p.id === 'chords').notes.filter((x) => x.bar === k)) { const q = classOfCents(C.row.toneCents[C.row.tone[n.node]] - rootCents); if (!(c.intervals.includes(q.pc) && Math.abs(q.dev) <= spec.knobs.frameCentsEachSide + 1e-9)) return `bar ${k}: a chord voice off the chord`; }
  // the inner keeps off the lead's onsets
  const leadNodes = new Set(leadA.notes.map((n) => n.node));
  if (next.parts.find((p) => p.id === 'inner').notes.some((n) => leadNodes.has(n.node))) return 'the inner on a lead onset';
  return '';
}

// ── the cases ──
const CASES = [];
const add = (L, T, opts) => { const C = composed(L, T, opts); if (C) CASES.push(C); };
for (const [L, T] of [[[8, 7, 6, 5], 4], [[19, 17, 16, 15], 6], [[41, 42, 43, 0], 8], [[119, 42, 15, 8], 8], [[97, 103, 37, 0], 5], [[768, 769, 0, 0], 8]]) for (const seed of [1, 4]) add(L, T, { seed });
add([41, 42, 43, 0], 8, { seed: 2, overrides: { modulation: false }, label: 'modulation off' });
add([19, 17, 16, 15], 6, { seed: 3, overrides: { bars: 4, foldOffsets: false }, label: '4 bars, no fold' });
add([41, 42, 43, 0], 8, { seed: 1, worker: true, label: 'full table' });
add([119, 42, 15, 8], 8, { seed: 2, drums: { mode: 'with' }, label: 'drums with' });
add([768, 769, 0, 0], 8, { seed: 3, drums: { mode: 'against' }, label: 'drums against' });
add([97, 103, 37, 0], 5, { seed: 1, drums: { mode: 'son', fills: false }, label: 'drums son' });
{ const rc = rootCandidates([41, 42, 43, 0]).candidates; add([41, 42, 43, 0], 8, { seed: 1, progression: [rc[1].ratio, null, rc[2].ratio, null], label: 'targeted progression' }); }
RHYTHMS.slice(18).forEach((L, i) => { if (i % 4 === 1) add([...L, 0, 0, 0, 0].slice(0, 4), 4 + (i % 3) * 2, { seed: 1 + (i % 3) }); });
console.log(`  · ${CASES.length} compositions`);

// ── identity ──
{
  let bars = 0, barsOk = 0, cand = 0, candOk = 0, phrases = 0, phrasesOk = 0, smooth = 0;
  const bad = [];
  for (const C of CASES) {
    const base = J(C.spec), evs = chordEvents(C.trace);
    for (let k = 0; k < C.spec.knobs.bars; k++) {
      const c = C.spec.chords[k];
      bars++;
      if (J(applyRearrange(C.spec, rearrange(C.spec, C.row, C.cells, { bar: k, chord: { rootTone: c.rootTone, quality: c.quality } }))) === base) barsOk++; else bad.push(`${C.label} bar ${k}`);
      const ev = evs.find((x) => x.bar === k);
      if (ev && ev.pickIndex >= 0) { cand++; if (J(applyRearrange(C.spec, rearrange(C.spec, C.row, C.cells, { bar: k, chord: ev.candidates[ev.pickIndex] }))) === base) candOk++; else bad.push(`${C.label} bar ${k} (trace candidate)`); }
    }
    leadAlternates(C.trace).forEach((a, p) => {
      phrases++;
      const r = rearrange(C.spec, C.row, C.cells, { phrase: p, line: a.kept }, { trace: C.trace });
      const r2 = rearrange(C.spec, C.row, C.cells, { phrase: p, line: a.kept, chordsFollow: true }, { trace: C.trace, smoothPhrase: true });
      if (J(applyRearrange(C.spec, r)) === base) phrasesOk++; else bad.push(`${C.label} phrase ${p}`);
      if (J(applyRearrange(C.spec, r2)) === base) smooth++; else bad.push(`${C.label} phrase ${p} (follow, smooth)`);
    });
  }
  check(`identity: ${barsOk}/${bars} bars swapped to their own chord give the spec byte for byte`, barsOk === bars, bad.slice(0, 5).join('; '));
  check(`identity: ${candOk}/${cand} bars swapped to the trace's own candidate (its pickIndex) likewise`, candOk === cand && cand > 0, bad.slice(0, 5).join('; '));
  check(`identity: ${phrasesOk}/${phrases} phrases given their own line (and ${smooth}/${phrases} with chords following and smoothPhrase) give the spec byte for byte`, phrasesOk === phrases && smooth === phrases, bad.slice(0, 5).join('; '));
}

// ── every candidate swaps ──
{
  let swaps = 0, ok = 0, real = 0, local = 0, retuned = 0, changedK = 0, threw = 0, backbeatSame = 0, backbeat = 0, withLocal = 0, withN = 0;
  const bad = [];
  for (const C of CASES) {
    for (const ev of chordEvents(C.trace)) for (const cand of ev.candidates) {
      swaps++;
      let r;
      try { r = rearrange(C.spec, C.row, C.cells, { bar: ev.bar, chord: cand }); ok++; } catch (err) { threw++; bad.push(`${C.label} bar ${ev.bar} ${cand.label}: ${err.message}`); continue; }
      const next = applyRearrange(C.spec, r);
      const why = realOnsets(C, next);
      if (!why) real++; else bad.push(`${C.label} bar ${ev.bar} ${cand.label}: ${why}`);
      const why2 = swapBreak(C, ev.bar, cand, r, next);
      if (!why2) local++; else bad.push(`${C.label} bar ${ev.bar} ${cand.label}: ${why2}`);
      if (r.retunedBars.length) retuned++;
      if (r.changedBars.includes(ev.bar)) changedK++;
      const mode = C.spec.drums?.mode;
      if (mode === 'backbeat') { backbeat++; if (J(r.drums.hits) === J(C.spec.drums.hits)) backbeatSame++; }
      if (mode === 'with') { withN++; const moved = new Set([...r.changedBars, ...r.retunedBars]); if (J(r.drums.hits.filter((x) => !moved.has(x.bar))) === J(C.spec.drums.hits.filter((x) => !moved.has(x.bar)))) withLocal++; }
    }
  }
  check(`${ok}/${swaps} candidate swaps run without throwing (${changedK} change their bar, ${retuned} retune later bars)`, ok === swaps && threw === 0 && swaps > 500, bad.slice(0, 3).join('; '));
  check(`${real}/${ok}: every note of every part, and every drum stroke, is a real onset in its own bar and slot, at baseHz × ratio × 2^octave × its bar's retune`, real === ok, bad.slice(0, 3).join('; '));
  check(`${local}/${ok}: only bar k (and the empty bars taking its chord) is rebuilt; later bars only re-pitch; the lead, baseHz, the comp layer and the sounds stay`, local === ok, bad.slice(0, 3).join('; '));
  check(`the drums: backbeat untouched by a swap (${backbeatSame}/${backbeat}); 'with' moves only in the edited and retuned bars (${withLocal}/${withN})`, backbeatSame === backbeat && withLocal === withN && backbeat > 0 && withN > 0);
}

// ── every runner-up line swaps ──
{
  let swaps = 0, ok = 0, real = 0, local = 0, follow = 0, followLocal = 0, threw = 0;
  const bad = [];
  for (const C of CASES) {
    const spans = phrasesOf(C.cells), S = C.spec.knobs.slotsPerBar;
    leadAlternates(C.trace).forEach((a, p) => {
      const span = spans[p], inP = (bar) => bar >= span.from && bar < span.from + span.bars;
      for (const id of a.runnersUp) {
        swaps++;
        let r, rf;
        try { r = rearrange(C.spec, C.row, C.cells, { phrase: p, line: id }, { trace: C.trace }); rf = rearrange(C.spec, C.row, C.cells, { phrase: p, line: id, chordsFollow: true }, { trace: C.trace }); ok++; } catch (err) { threw++; bad.push(`${C.label} phrase ${p}: ${err.message}`); continue; }
        const next = applyRearrange(C.spec, r), nf = applyRearrange(C.spec, rf);
        const why = realOnsets(C, next) || realOnsets(C, nf);
        if (!why) real++; else bad.push(`${C.label} phrase ${p}: ${why}`);
        // the phrase's lead is the line, note for note; the chords stay; only the phrase's lead and inner move
        const line = C.trace.lines[id], lead = next.parts[0].notes.filter((n) => inP(n.bar));
        let w = '';
        if (J(lead.map((n) => [n.slot, n.node, n.octave]).sort()) !== J(line.notes.map((n) => [n.slot, n.node, n.octave]).sort())) w = 'the lead is not the line';
        else if (J(next.chords.map((c) => chordBut(c, ['exceptions']))) !== J(C.spec.chords.map((c) => chordBut(c, ['exceptions'])))) w = 'the chords moved';
        else for (const pid of PART_IDS) for (let j = 0; j < C.spec.knobs.bars && !w; j++) {
          if (inP(j) && (pid === 'lead' || pid === 'inner')) continue;
          if (barNotes(next.parts.find((x) => x.id === pid), j) !== barNotes(C.spec.parts.find((x) => x.id === pid), j)) w = `${pid} in bar ${j} moved`;
        }
        if (!w && next.knobs.baseHz !== C.spec.knobs.baseHz) w = 'baseHz moved';
        if (!w && next.parts[0].legato !== C.spec.parts[0].legato) w = 'the lead legato moved';
        if (!w && next.parts.find((x) => x.id === 'inner').notes.some((n) => new Set(next.parts[0].notes.map((q) => q.node)).has(n.node))) w = 'the inner on a lead onset';
        if (!w) local++; else bad.push(`${C.label} phrase ${p}: ${w}`);
        // chords following: only the phrase's bars (and empty bars after them) rebuilt; later bars at most re-pitch
        if (rf.changedBars.some((j) => !inP(j))) bad.push(`${C.label} phrase ${p}: follow changed bar outside`); else followLocal++;
        if (rf.chords.some((c, j) => c.rootTone !== C.spec.chords[j].rootTone || c.quality !== C.spec.chords[j].quality)) follow++;
      }
    });
    void S;
  }
  check(`${ok}/${swaps} runner-up lines swap without throwing, with and without chords following`, ok === swaps && threw === 0 && swaps > 50, bad.slice(0, 3).join('; '));
  check(`${real}/${ok}: every note and stroke a real onset, at its bar's retune`, real === ok, bad.slice(0, 3).join('; '));
  check(`${local}/${ok}: the phrase's lead is the line; only the phrase's lead and inner move; the chords, baseHz and the lead legato stay`, local === ok, bad.slice(0, 3).join('; '));
  check(`chords following: ${followLocal}/${ok} rebuild only the phrase's bars (${follow} change a chord)`, followLocal === ok);
  // following its own lead (one note an octave up: the same classes), a settled spec's chords come back as they are
  let own = 0, settled = 0;
  for (const C of CASES) {
    if (!C.spec.stats.settle.converged || C.spec.chords.some((c) => c.targeted)) continue;
    leadAlternates(C.trace).forEach((a, p) => {
      const line = C.trace.lines[a.kept], up = { notes: line.notes.map((n, i) => (i === 0 ? { ...n, octave: n.octave + 1 } : n)) };
      const rf = rearrange(C.spec, C.row, C.cells, { phrase: p, line: up, chordsFollow: true }, { trace: C.trace });
      settled++;
      if (rf.chords.every((c, j) => c.rootTone === C.spec.chords[j].rootTone && c.quality === C.spec.chords[j].quality)) own++;
    });
  }
  check(`chords following a settled spec's own lead (an octave moved) choose its chords again: ${own}/${settled} phrases`, own === settled && settled > 10);
}

// ── lines.js boundaries: the picker and the scorer agree ──
{
  let runs = 0, agree = 0, moved = 0, same = 0;
  const C = CASES.find((x) => x.label.startsWith('41:42:43 seed 1')), { row, cells } = C, type = LINE_TYPES[0], S = cells.slotsPerBar;
  for (let k = 0; k < cells.bars; k++) {
    const frame = frameAt(row, C.row.tones.indexOf(C.spec.chords[k].rootTone)), lattice = buildLattice(row, cells, frame, { from: k, bars: 1, low: frame.rootCents - 1200, width: type.width });
    const targets = rootTargets(row, frame);
    for (const band of type.bands) for (const contour of type.contours.slice(0, 2)) for (const motion of ['stepwise', 'wide']) {
      const [nMin, nMax] = bandNotes(band, S);
      const base = { ...MOTIONS[motion], strict: band.strict, contour: { ...contour, low: contour.low + lattice.low }, targets, nMin, nMax };
      const plain = pickLines(lattice, base);
      for (const bounds of [{ before: { pitch: lattice.low + 100 } }, { after: { pitch: lattice.low + 1500 } }, { before: { pitch: lattice.low + 1800 }, after: { pitch: lattice.low } }]) {
        const rules = { ...base, ...bounds }, picks = pickLines(lattice, rules);
        for (const p of picks) { runs++; if (Math.abs(scoreLine(lattice, p.picks, rules).cost - p.cost) < 1e-9) agree++; }
        if (J(picks.map((p) => p.picks)) !== J(plain.map((p) => p.picks))) moved++;
      }
      if (J(pickLines(lattice, { ...base, before: undefined, after: undefined })) === J(plain)) same++;
    }
  }
  check(`boundaries: the picker's cost is the scorer's on ${agree}/${runs} picked lines; they move the pick on ${moved} runs; absent (undefined), nothing moves (${same})`, agree === runs && runs > 100 && moved > 0 && same > 0);
}

// ── the cost on the 16k row ──
{
  const L = [4099, 4093, 4091, 4079], T = 16, rows = [];
  for (const worker of [false, true]) {
    const full = compose(L, T, { seed: 1, trace: {}, worker }), { trace, ...spec } = full;
    let t0 = performance.now(); const { row, cells } = materialsOf(spec); const matMs = performance.now() - t0;
    const C = { spec, trace, row, cells };
    const evs = chordEvents(trace), times = [];
    t0 = performance.now(); rearrange(spec, row, cells, { bar: 1, chord: evs[1].candidates[1] }); const cold = performance.now() - t0;
    let real = 0, n = 0;
    for (const ev of evs) for (const cand of ev.candidates) { t0 = performance.now(); const r = rearrange(spec, row, cells, { bar: ev.bar, chord: cand }); times.push(performance.now() - t0); n++; if (!realOnsets(C, applyRearrange(spec, r))) real++; }
    const leadTimes = [], smoothTimes = [];
    leadAlternates(trace).forEach((a, p) => { for (const id of a.runnersUp.slice(0, 4)) { t0 = performance.now(); rearrange(spec, row, cells, { phrase: p, line: id }, { trace }); leadTimes.push(performance.now() - t0); } });
    const a0 = leadAlternates(trace)[0];
    if (a0.runnersUp[0]) { t0 = performance.now(); rearrange(spec, row, cells, { phrase: 0, line: a0.runnersUp[0] }, { trace, smoothPhrase: true }); smoothTimes.push(performance.now() - t0); }
    const tab = worker ? 'full' : 'lean';
    rows.push(`${tab}: materialsOf ${matMs.toFixed(1)} ms · chord swap cold ${cold.toFixed(1)} ms, then median ${median(times).toFixed(1)} / max ${Math.max(...times).toFixed(1)} ms over ${times.length} · lead swap median ${median(leadTimes).toFixed(1)} ms · smoothPhrase ${smoothTimes.length ? smoothTimes[0].toFixed(0) : '–'} ms`);
    check(`16k row, ${tab} table: a chord swap's median ≤ 20 ms (${median(times).toFixed(1)} ms), every note a real onset (${real}/${n})`, median(times) <= 20 && real === n);
  }
  console.log(`  · measured: ${rows.join('\n  · measured: ')}`);
}

console.log(PASS ? `\n✓✓✓ REARRANGE PASSES (${checks} checks)` : `\n✗ REARRANGE FAILED`);
process.exit(PASS ? 0 : 1);
