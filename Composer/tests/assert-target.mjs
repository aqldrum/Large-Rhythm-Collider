// assert-target.mjs — MIDI targets, phase A (Composer/TARGET_ORDER.md A4): core/midi.js, core/target.js and Compose's
// target mode.
//   • the decode: every probe clip round-tripped through writeMidi / readMidi; the variants decode to their originals
//     (humanized note-ons, chords in the same track: the skyline and its `dropped`); the step-relative tolerance (the
//     unquantized Ode is a guess on eighths, not 48ths); running status and note-on velocity 0; the tempo
//   • the search: its best equals brute force on the small rows (the probe's verify.mjs); maxDriftCents 0 equals no
//     drift; drift never makes a fit worse (and drifts only when that gains notes); every note-on and note-off is an onset
//     of the row, every note-off after its note-on and no later than the next; the miss classes; laneReport
//   • Compose target mode: every lead note is the placement's onset; every part's notes (and the drums) lie in the
//     window; the loop is the window's span; materialsOf round-trips; the drums (every mode) and a chord swap work on a
//     window spec, a lead swap is refused; a progression under a clip; the trace; refusals; no target is no change
//   • timing: the 16,359-onset row places Frère Jacques (and Ode to Joy) under 1.5 s
//   node Composer/tests/assert-target.mjs
import { readMidi, writeMidi, decodeClip, skyline, estimateKey, EXACT_SHARE, ONSET_TOLERANCE } from '../core/midi.js';
import { placeClip, evaluate, latticesOf, lanesOf, barCounts, laneReport, clipPhrases, targetRoot, DEFAULTS } from '../core/target.js';
import { compose, rearticulate, TARGET_SETS } from '../core/compose.js';
import { materialsOf, materialsKey, rearrange, applyRearrange } from '../core/rearrange.js';
import { arrangeDrums, DRUM_MODES } from '../core/drums.js';
import { buildRow } from '../core/row.js';
import { buildCells, cropCells } from '../core/cells.js';
import { frameAt, classOfCents } from '../core/frame.js';
import { CLIPS, clipBytes, PPQ, seq } from './fixtures/midi-clips.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const rows = new Map();
const rowOf = (L) => { const k = L.join(':'); if (!rows.has(k)) rows.set(k, buildRow(L)); return rows.get(k); };
const decoded = new Map(CLIPS.map((c) => [c.name, decodeClip(readMidi(clipBytes(c)))]));
const clip = (name) => decoded.get(name);
const SEARCHED = CLIPS.filter((c) => c.searched && !c.decodeAs).map((c) => c.name);
const withoutMs = (r) => J({ ...r, ms: 0 });
/** two places on a loop of share W the same, up to a lap */
const sameOnLoop = (a, b, W) => Math.abs(mod(a - b + W / 2, W) - W / 2) < 1e-9;

console.log('═══ COMPOSER — MIDI targets, phase A: the decode, the search, Compose target mode ═══');

// ── 1. the decode ──
console.log('\n— the decode (core/midi.js)');
{
  let same = 0;
  for (const c of CLIPS) {
    const f = readMidi(clipBytes(c)), tr = f.tracks.find((t) => t.notes.length);
    const want = [...c.notes].sort((a, b) => a.tick - b.tick || b.pitch - a.pitch).map((n) => `${n.tick}:${n.end}:${n.pitch}`).join(',');
    if (tr.notes.map((n) => `${n.tick}:${n.end}:${n.pitch}`).join(',') === want && f.ppq === PPQ && f.timeSigs[0].num === c.timeSig[0] && f.timeSigs[0].den === c.timeSig[1]) same++;
  }
  check(`every probe clip round-trips through writeMidi → readMidi: notes, PPQ, time signature (${same}/${CLIPS.length})`, same === CLIPS.length);
  const sameNotes = (a, b, offs) => a.notes.length === b.notes.length && a.notes.every((n, i) => n.step === b.notes[i].step && n.midi === b.notes[i].midi && (!offs || n.until === b.notes[i].until));
  const hum = clip('ode-humanized'), ode = clip('ode-to-joy');
  check('the humanized Ode decodes to the Ode: the same grid and note-ons, exactly', hum.exact && hum.d === ode.d && hum.S === ode.S && hum.B === ode.B && sameNotes(hum, ode, false));
  const tw = clip('twinkle'), twc = clip('twinkle-with-chords');
  check(`Twinkle over block triads decodes to Twinkle (note-offs too): the skyline; dropped ${twc.dropped} (4 triads × 3), Twinkle's own 0`, sameNotes(twc, tw, true) && twc.d === tw.d && twc.dropped === 12 && tw.dropped === 0);
  const unq = clip('ode-unquantized');
  check(`the unquantized Ode is a GUESS on eighths (d ${unq.d}), not 48ths: the step-relative tolerance (EXACT_SHARE ${EXACT_SHARE})`, !unq.exact && unq.d === 2 && unq.notes.length === ode.notes.length);
  // a note 0.04 quarter off the beat: inside the absolute tolerance, and inside EXACT_SHARE of a quarter step
  const near = decodeClip(readMidi(writeMidi({ tracks: [{ notes: [{ tick: 0, end: 480, pitch: 60 }, { tick: 499, end: 960, pitch: 62 }] }] })));
  check(`a note-on ${(19 / 480).toFixed(3)} q off its quarter (≤ ${ONSET_TOLERANCE} q, ≤ ${EXACT_SHARE} of the step) reads as on it: quarters, exact`, near.exact && near.d === 1 && near.notes[1].step === 1);
  const grn = clip('greensleeves'), sh = clip('shuffle-riff'), fk = clip('funk-line');
  check(`Greensleeves: 3/4, S ${grn.S}, pickup ${grn.pickup}; the shuffle on triplets (d ${sh.d}, S ${sh.S}); the funk line on sixteenths (d ${fk.d})`, grn.timeSig.join('/') === '3/4' && grn.S === 6 && grn.pickup === 4 && sh.d === 3 && sh.S === 12 && fk.d === 4);
  check(`the tempo: the file's (Ode ${ode.tempoBpm.toFixed(3)} BPM, written at 108)`, Math.abs(ode.tempoBpm - 108) < 0.01 && ode.tempoBpm === ode.bpm && Math.abs(clip('frere-jacques').tempoBpm - 112) < 0.01);
  // format 0 by hand: running status, note-off as note-on velocity 0, no time signature
  const bytes = Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 23, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0x90, 60, 100, 0x60, 60, 0, 0, 62, 100, 0x60, 62, 0, 0, 0xff, 0x2f, 0]);
  const hand = readMidi(bytes), handClip = decodeClip(hand);
  check('format 0 by hand: running status and velocity-0 note-offs read; no time signature is 4/4; 120 BPM', hand.format === 0 && J(hand.tracks[0].notes.map((n) => [n.tick, n.end, n.pitch])) === J([[0, 96, 60], [96, 192, 62]])
    && handClip.S === 4 && handClip.B === 1 && J(handClip.notes.map((n) => [n.step, n.until])) === J([[0, 1], [1, 2]]) && Math.abs(handClip.tempoBpm - 120) < 1e-9);
  check('skyline: the highest note at each start, cut at the next start', J(skyline([{ tick: 0, end: 100, pitch: 50 }, { tick: 0, end: 100, pitch: 60 }, { tick: 50, end: 80, pitch: 55 }]).map((n) => [n.tick, n.end, n.pitch])) === J([[0, 50, 60], [50, 80, 55]]));
  check(`the key estimate (Krumhansl): Twinkle C major, Frère Jacques F (${estimateKey(clip('frere-jacques').notes).tonic})`, tw.key.tonic === 0 && tw.key.mode === 'major' && clip('frere-jacques').key.tonic === 5);
  let threw = 0; for (const bad of [new Uint8Array([1, 2, 3, 4]), Uint8Array.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 2, 0, 1, 0, 96])]) { try { readMidi(bad); } catch { threw++; } }
  check('not a MIDI file, and format 2, are refused with an error', threw === 2);
}

// ── 2. the search ──
console.log('\n— the search (core/target.js)');
const SMALL = [[8, 7, 6, 5], [19, 17, 16, 15], [41, 42, 43], [119, 42, 15, 8]];
{
  // brute force (the probe's verify.mjs): a note hits for φ in [c − τ/P, c + τ/P], so the count is piecewise constant and
  // its maximum is reached just inside some interval's left end; evaluate there for every lattice, k and N
  let cases = 0, agree = 0; const bad = [];
  for (const L of SMALL) {
    const row = rowOf(L);
    for (const name of SEARCHED) {
      const c = clip(name);
      let brute = 0;
      for (const lat of latticesOf(row)) {
        const { lanes } = lanesOf(row, lat.tone);
        for (const N of barCounts(row, c)) {
          const P = N * c.S;
          for (let k = 0; k < 12; k++) for (const n of c.notes) {
            const { x } = lanes[mod(n.pc + k, 12)];
            for (let i = 0; i < x.length; i++) { const h = evaluate(lanes, c.notes, k, P, mod(x[i] - n.step / P - DEFAULTS.tau / P + 1e-9, 1)).hits; if (h > brute) brute = h; }
          }
        }
      }
      const got = placeClip(row, c, { maxDriftCents: 0 }).searched.hits;
      cases++; if (got === brute) agree++; else bad.push(`${L.join(':')} ${name} ${got} vs ${brute}`);
    }
  }
  check(`the search's best equals brute force on the small rows (${agree}/${cases})`, agree === cases, bad.join('; '));
}
const ROWS = [[8, 7, 6, 5], [19, 17, 16, 15], [119, 42, 15, 8], [768, 769], [2047, 2048], [275, 1144, 1260, 234]];
const results = [];
for (const L of ROWS) for (const name of SEARCHED) {
  const row = rowOf(L), c = clip(name);
  results.push({ L, name, row, c, off: placeClip(row, c, { maxDriftCents: 0 }), on: placeClip(row, c) });
}
{
  // drift: off is no drift; a one-phrase clip is the same either way; drift never worse, and drifts only for notes
  let offOk = 0, onePhrase = 0, onePhraseSame = 0, never = 0, onlyForNotes = 0, drifted = 0;
  for (const r of results) {
    const all = [r.off.placement, ...r.off.alternates];
    if (all.every((p) => p.drift === 0 && p.phrases.every((ph) => ph.psiTone === p.phrases[0].psiTone && ph.k === p.phrases[0].k && ph.driftCents === 0))) offOk++;
    if (clipPhrases(r.c).length === 1) { onePhrase++; if (withoutMs(r.on) === withoutMs({ ...r.off, maxDriftCents: r.on.maxDriftCents })) onePhraseSame++; }
    if (r.on.placement.hits >= r.off.placement.hits) never++;
    if (r.on.placement.drift > 0) drifted++;
    if (!(r.on.placement.drift > 0) || r.on.placement.hits > r.off.placement.hits) onlyForNotes++;
  }
  check(`maxDriftCents 0 is no drift: every placement and alternate one lattice and one k, drift 0 (${offOk}/${results.length})`, offOk === results.length);
  check(`a one-phrase clip places the same with drift on or off (${onePhraseSame}/${onePhrase})`, onePhrase > 0 && onePhraseSame === onePhrase);
  check(`drift never makes a fit worse (${never}/${results.length}), and a placement drifts only when that gains notes (${onlyForNotes}/${results.length}; ${drifted} drift)`, never === results.length && onlyForNotes === results.length);
  // a clip made to need drift: the same tune twice, the second phrase written 1 semitone up is NOT drift (k moves 100¢);
  // drift is about the row's lattice, so check the constraint itself: adjacent phrases' tonics within maxDriftCents
  let within = 0, total = 0;
  for (const r of results) for (const p of [r.on.placement, ...r.on.alternates]) { total++; if (p.phrases.every((ph, i) => i === 0 || Math.abs(ph.driftCents) <= 30 + 1e-9)) within++; }
  check(`every drifting phrase's tonic moves at most 30¢ from the phrase before (${within}/${total})`, within === total);
  // a row where drift recovers a note (found by scanning rhythms.mjs): the lattice moves under the second phrase
  const row = rowOf([426, 317, 285]), g = clip('greensleeves'), a = placeClip(row, g, { maxDriftCents: 0 }), b = placeClip(row, g), c = placeClip(row, g, { maxDriftCents: 5 });
  check(`drift recovers a note: 426:317:285 places Greensleeves ${a.placement.hits} → ${b.placement.hits}, its tonic moving ${b.placement.drift.toFixed(1)}¢ (${b.placement.phrases.map((p) => p.psiRatio).join(' → ')}); at ±5¢ it may not`,
    b.placement.hits > a.placement.hits && b.placement.drift > 5 && b.placement.drift <= 30 && b.placement.phrases[1].psiTone !== b.placement.phrases[0].psiTone && c.placement.hits === a.placement.hits);
}
{
  // every note-on and note-off an onset of the row, in place; offs after ons, no later than the next note-on
  let notes = 0, onOk = 0, offOk = 0, order = 0, kinds = 0, sounding = 0, placements = 0, counts = 0;
  for (const r of results) for (const p of [r.on.placement, ...r.on.alternates, r.off.placement]) {
    placements++;
    const { row, c } = r, phaseX = p.phase[0] / p.phase[1], W = p.share, BS = p.B * p.S, lt = (i) => { const u = mod(row.x[i] - phaseX, 1); return u < W ? u : u - 1 + W; };
    const cells = buildCells(row, { bars: p.N, slotsPerBar: p.S, anchors: 'partitioned', phase: p.phase, swing: DEFAULTS.tau });
    const per = clipPhrases(c), perBars = per.length > 1 ? per[1].from : p.B;
    const sound = p.notes.filter((x) => x.on.node != null);
    let h = 0, t = 0, oh = 0;
    p.notes.forEach((x, j) => {
      notes++;
      const ph = p.phrases[Math.min(per.length - 1, Math.floor(x.step / (perBars * p.S)))], f = frameAt(row, ph.psiTone, DEFAULTS.e), lane = mod(x.pc + ph.k, 12);
      if (x.on.kind === 'hard') { if (x.on.node == null && x.off == null) { onOk++; offOk++; order++; kinds++; } return; }
      sounding++;
      const node = x.on.node, slot = cells.slots[x.on.slot];
      if (node >= 0 && node < row.n && Math.abs(lt(node) - x.on.pos) < 1e-12 && cells.slotOfNode[node] === x.on.slot) onOk++;
      const tone = row.tone[node], inside = f.inside[tone] && f.pc[tone] === lane;
      if ((x.on.kind === 'hit' && inside && x.on.slot === x.step) || (x.on.kind === 'fringe' && !f.inside[tone] && f.pc[tone] === lane && x.on.slot === x.step)
        || (x.on.kind === 'shift' && inside && Math.abs(x.on.slot - x.step) === 1 && x.on.slot < BS)) kinds++;
      if (x.on.kind === 'hit') { h++; if (Math.abs(x.on.offSlots) <= DEFAULTS.tight + 1e-12) t++; }
      if (x.off && x.off.node >= 0 && x.off.node < row.n && sameOnLoop(lt(x.off.node), x.off.pos, W)) offOk++;
      if (!x.off.late) oh++;
      const q = sound.indexOf(x), next = sound[(q + 1) % sound.length];
      let nextPos = next.on.pos; while (nextPos <= x.on.pos + 1e-15) nextPos += W;
      if (sound.length === 1) nextPos = x.on.pos + W;
      if (x.off.pos > x.on.pos + 1e-15 && x.off.pos <= nextPos + 1e-12 && slot) order++;
    });
    if (h === p.hits && t === p.tight && oh === p.offHits && p.misses.fringe + p.misses.shift + p.misses.hard + p.hits === p.J) counts++;
    void sounding;
  }
  check(`every note-on is the row's onset at its recorded place, in its slot's window (${onOk}/${notes} notes over ${placements} placements)`, onOk === notes);
  check(`every note-off is an onset of the row at its recorded place (${offOk}/${notes})`, offOk === notes);
  check(`every note-off is after its note-on and no later than the next note-on (${order}/${notes})`, order === notes);
  check(`the miss classes (P2): a hit in its lattice's frame in its slot, a fringe its class outside the frame, a shift in frame one slot over (${kinds}/${notes})`, kinds === notes);
  check(`hits, tight hits, note-off hits and the misses add up (${counts}/${placements})`, counts === placements);
}
{
  const r = results.find((x) => x.L.join(':') === '119:42:15:8' && x.name === 'chromatic-run');
  const p = r.on.placement, rep = laneReport(r.row, p.phrases[0].psiTone);
  const { count } = lanesOf(r.row, p.phrases[0].psiTone);
  const missing = [...new Set(r.c.notes.filter((n) => rep.counts[mod(n.pc + p.phrases[0].k, 12)] === 0).map((n) => n.pc))].sort((a, b) => a - b);
  check(`laneReport: the lattice's in-frame onsets per class (sum ${rep.counts.reduce((a, b) => a + b, 0)} = ${count}); the chromatic run on 119:42:15:8 can't play ${J(p.missing)} (decided 5)`,
    rep.counts.reduce((a, b) => a + b, 0) === count && J(missing) === J(p.missing) && J(r.on.lanes.missing) === J(p.missing) && p.missing.length > 0 && rep.empty.length > 0);
  const win = results.filter((x) => x.on.placement.window);
  check(`windows are found where they win (${win.map((x) => `${x.L.join(':')} ${x.name} N ${x.on.placement.N}`).join(', ') || 'none'}), and every placement offers alternates (cap 8)`, win.length > 0 && results.every((x) => x.on.alternates.length >= 1 && x.on.alternates.length <= 8));
  const fits = results.filter((x) => x.L.join(':') === '275:1144:1260:234');
  check(`the smallest N with a full fit wins: 275:1144:1260:234 fits every clip at N = B, one bar count searched (${fits.map((x) => x.on.searched.barCounts.length).join(',')})`,
    fits.every((x) => x.on.placement.hits === x.c.notes.length && x.on.placement.N === x.c.B && x.on.searched.stoppedAt === x.c.B && x.on.searched.barCounts.length === 1));
}

// ── 3. Compose target mode ──
console.log('\n— Compose target mode (core/compose.js)');
const CASES = [
  { L: [768, 769], T: 8, name: 'ode-to-joy' },
  { L: [2047, 2048], T: 8, name: 'chromatic-run' },
  { L: [2047, 2048], T: 8, name: 'greensleeves' },
  { L: [19, 17, 16, 15], T: 6, name: 'frere-jacques' },
  { L: [8, 7, 6, 5], T: 4, name: 'twinkle' },
  { L: [275, 1144, 1260, 234], T: 8, name: 'funk-line' },
  { L: [426, 317, 285], T: 8, name: 'greensleeves' },   // a drifting placement (below)
];
const specs = CASES.map((x) => ({ ...x, row: rowOf(x.L), clip: clip(x.name), spec: compose(x.L, x.T, { target: { clip: clip(x.name) } }) }));
{
  const label = specs.map((s) => `${s.L.join(':')} ${s.name} N ${s.spec.target.placement.N}/B ${s.spec.target.placement.B}`).join(', ');
  check(`target composes (${label}), with at least one window`, specs.every((s) => !s.spec.refused && s.spec.knobs.leader === 'target') && specs.some((s) => s.spec.target.placement.window));
  let leadOk = 0, endOk = 0;
  for (const s of specs) {
    const p = s.spec.target.placement, lead = s.spec.parts.find((x) => x.id === 'lead'), rowT = s.spec.knobs.rowCycleSeconds, W = p.share;
    const want = p.notes.flatMap((x, j) => (x.on.node != null ? [`${j}:${x.on.node}`] : [])).sort().join(',');
    if (lead.notes.map((n) => `${n.clipNote}:${n.node}`).sort().join(',') === want) leadOk++;
    const phaseX = p.phase[0] / p.phase[1], lt = (i) => { const u = mod(s.row.x[i] - phaseX, 1); return u < W ? u : u - 1 + W; };
    if (lead.notes.every((n) => { const x = p.notes[n.clipNote]; return n.duration > 0 && Math.abs(n.endTime - n.time - n.duration) < 1e-9 && Math.abs(n.time - lt(n.node) * rowT) < 1e-9
      && sameOnLoop(n.endTime / rowT, lt(x.off.node), W); })) endOk++;
  }
  check(`every lead note is the placement's onset, one per sounding clip note (${leadOk}/${specs.length})`, leadOk === specs.length);
  check(`every lead note sounds at its onset's loop time and ends on its note-off onset (P4: endTime, the duration) (${endOk}/${specs.length})`, endOk === specs.length);
  let inWin = 0, loopOk = 0, drumsIn = 0;
  for (const s of specs) {
    const k = s.spec.knobs, p = s.spec.target.placement, phaseX = k.phase[0] / k.phase[1], W = p.share, loop = k.cycleSeconds;
    const full = buildCells(s.row, { bars: p.N, slotsPerBar: p.S, anchors: 'partitioned', phase: k.phase });
    const before = 0.5 * full.slots[full.P - 1].length;
    const ok = s.spec.parts.every((part) => part.notes.every((n) => { const u = mod(s.row.x[n.node] - phaseX, 1); return n.time >= 0 && n.time < loop && (u < W || 1 - u <= before + 1e-12) && n.bar >= 0 && n.bar < k.bars; }));
    if (ok) inWin++;
    const end = p.N > p.B ? mod(full.slots[p.B * p.S].anchor - phaseX, 1) : 1;
    if (Math.abs(loop - end * k.rowCycleSeconds) < 1e-9 && k.cut.bars === p.N && k.bars === p.B && Math.abs(k.tempoBpm - (60 * k.bars * k.beatsPerBar) / loop) < 1e-9
      && s.spec.timeline.barStarts.length === k.bars && s.spec.timeline.slotStarts.every((t) => t >= 0 && t < loop) && k.beatsPerBar === s.clip.timeSig[0]) loopOk++;
    if (s.spec.drums.hits.every((h) => h.time >= 0 && h.time < loop && h.bar >= 0 && h.bar < k.bars && s.row.tick.includes(h.tick))) drumsIn++;
  }
  check(`every part's notes lie in the window (or half a slot before its first anchor, sounding at the loop's end), in its bars (${inWin}/${specs.length})`, inWin === specs.length);
  check(`the loop is the window's span (all of T when N = B); bars B, cut N, beats a bar the clip's, the natural tempo 60·B·beats / loop (${loopOk}/${specs.length})`, loopOk === specs.length);
  check(`the drums lie in the loop, every stroke a row onset (${drumsIn}/${specs.length})`, drumsIn === specs.length);
  const s0 = specs[1];
  check(`spec.target: the clip, the placement, the misses and the clip's tempo (${s0.spec.target.tempoBpm.toFixed(1)} BPM), the alternates; settle pinned`,
    s0.spec.target.clip.notes.length === s0.clip.notes.length && J(s0.spec.target.misses) === J(s0.spec.target.placement.misses) && Math.abs(s0.spec.target.tempoBpm - s0.clip.tempoBpm) < 1e-9
    && Array.isArray(s0.spec.target.alternates) && s0.spec.stats.settle.rounds === 0 && s0.spec.stats.settle.pinned === true && J(s0.spec.input.target.clip) === J(s0.clip));
}
{
  // materialsOf round-trips; a chord swap and the drums on a window spec; no lead swap
  let mat = 0, swaps = 0, drumModes = 0, keys = 0;
  for (const s of specs) {
    const m = materialsOf(s.spec), p = s.spec.target.placement;
    const fresh = cropCells(buildCells(s.row, { bars: p.N, slotsPerBar: p.S, anchors: 'partitioned', phase: p.phase }), p.B);
    if (J({ ...m.cells, slotOfNode: [...m.cells.slotOfNode] }) === J({ ...fresh, slotOfNode: [...fresh.slotOfNode] }) && m.cells.bars === s.spec.knobs.bars && (p.N === p.B) === !m.cells.crop) mat++;
    const plain = { ...s.spec, knobs: { ...s.spec.knobs } }; delete plain.knobs.cut;
    if (materialsKey(s.spec) !== materialsKey(plain) && JSON.parse(materialsKey(s.spec)).length === 6) keys++;
    const k = s.spec.chords.findIndex((c) => !c.empty), c = s.spec.chords[k];
    const r = rearrange(s.spec, m.row, m.cells, { bar: k, chord: { rootTone: c.rootTone, quality: c.quality === 'major_triad' ? 'minor_triad' : 'major_triad' } });
    const next = applyRearrange(s.spec, r), loop = s.spec.knobs.cycleSeconds;
    const same = rearrange(s.spec, m.row, m.cells, { bar: k, chord: { rootTone: c.rootTone, quality: c.quality } });
    if (J(next.parts[0]) === J(s.spec.parts[0]) && r.changedBars.includes(k) && next.parts.every((part) => part.notes.every((n) => n.time >= 0 && n.time < loop)) && next.drums.hits.every((h) => h.time >= 0 && h.time < loop)
      && J(applyRearrange(s.spec, same).parts) === J(s.spec.parts)) swaps++;
    let modesOk = true;
    for (const mode of [...DRUM_MODES, 'prime']) {
      const d = arrangeDrums(s.spec, { mode });
      if (!d.hits.length || !d.hits.every((h) => h.time >= 0 && h.time < loop && h.bar >= 0 && h.bar < s.spec.knobs.bars && s.row.tick.includes(h.tick))) { modesOk = false; break; }
    }
    if (modesOk) drumModes++;
  }
  check(`materialsOf rebuilds the cells a target spec was composed over (the cut, cropped) (${mat}/${specs.length}); materialsKey carries the cut (${keys}/${specs.length})`, mat === specs.length && keys === specs.length);
  check(`a chord swap on a target spec: the lead stays, the bar changes, everything stays in the loop; the same chord is the spec byte for byte (${swaps}/${specs.length})`, swaps === specs.length);
  check(`the drums in every mode (${DRUM_MODES.length} + prime) on every target spec: strokes in the loop, in the bars, on onsets (${drumModes}/${specs.length})`, drumModes === specs.length);
  const s = specs[1], m = materialsOf(s.spec);
  let refused = false; try { rearrange(s.spec, m.row, m.cells, { phrase: 0, line: { notes: [] } }); } catch (err) { refused = /no lead swaps/.test(err.message); }
  check('a lead swap on a target spec is refused (P6: the lead is the clip)', refused);
  const lead = s.spec.parts.find((x) => x.id === 'lead'), re = rearticulate(lead, { legato: !lead.legato, cycleSeconds: s.spec.knobs.cycleSeconds });
  check('a legato toggle keeps the lead\'s note-off ends (endTime wins over legato)', J(re.notes.map((n) => n.duration)) === J(lead.notes.map((n) => n.duration)));
}
{
  const s = specs[0];
  const traced = compose(s.L, s.T, { target: { clip: s.clip }, trace: true });
  const { trace, ...rest } = traced, untimed = (x) => J({ ...x, target: { ...x.target, search: { ...x.target.search, ms: 0 } } });
  check(`the trace observes a target compose and never steers it (${trace.events.length} events, the lead pinned)`, untimed(rest) === untimed(s.spec) && trace.events.some((e) => e.kind === 'lead' && e.skipped === 'pinned') && trace.events.some((e) => e.kind === 'harmony'));
  const given = compose(s.L, s.T, { target: { clip: s.clip, placement: s.spec.target.placement } });
  check('a target with its placement given composes the same parts (the placement not searched again)', J(given.parts) === J(s.spec.parts) && J(given.chords) === J(s.spec.chords) && given.target.search === null);
  const alt = s.spec.target.alternates[0], altSpec = compose(s.L, s.T, { target: { clip: s.clip, placement: alt } });
  check('an alternate placement composes too (the window auditions alternates)', !altSpec.refused && J(altSpec.target.placement) === J(alt));
  const B = s.spec.knobs.bars, roots = s.spec.chords.map((c) => c.rootTone);
  const progSpec = compose(s.L, s.T, { target: { clip: s.clip }, progression: roots.map((r, i) => (i === 0 ? r : null)) });
  check(`a progression under a clip: bar 1 pinned, the rest following the clip (leader ${progSpec.knobs.leader}), the lead the same`, progSpec.knobs.leader === 'mixed' && progSpec.chords[0].targeted === true && progSpec.chords.length === B
    && J(progSpec.parts[0].notes.map((n) => n.node)) === J(s.spec.parts[0].notes.map((n) => n.node)));
  const tonicSpec = compose(s.L, s.T, { target: { clip: s.clip, tonic: (s.clip.key.tonic + 7) % 12 } });
  const pl = tonicSpec.target.placement, rt = targetRoot(s.row, pl, (s.clip.key.tonic + 7) % 12);
  check(`the tonic override (P5): the root is the tone of the asked tonic's class nearest the first lattice (${tonicSpec.knobs.root})`, tonicSpec.knobs.root === s.row.tones[rt] && tonicSpec.target.tonic === (s.clip.key.tonic + 7) % 12
    && classOfCents(s.row.toneCents[rt] - s.row.toneCents[pl.phrases[0].psiTone]).pc === mod((s.clip.key.tonic + 7) % 12 + pl.phrases[0].k, 12));
  let setRefused = 0;
  for (const k of TARGET_SETS) { try { compose(s.L, s.T, { target: { clip: s.clip }, overrides: { [k]: k === 'phase' ? [0, 1] : k === 'anchors' ? 'even' : k === 'presence' ? 'exact' : k === 'root' ? s.row.tones[0] : 1 } }); } catch (err) { if (/set by the target/.test(err.message)) setRefused++; } }
  check(`the overrides a target sets itself are refused (${setRefused}/${TARGET_SETS.length}: ${TARGET_SETS.join(', ')})`, setRefused === TARGET_SETS.length);
  const fine = decodeClip(readMidi(writeMidi({ tracks: [{ notes: seq([[60, 1 / 12], [62, 1 / 12], [64, 1 / 12], [65, 1 / 12]]) }] })));
  const r = compose(s.L, s.T, { target: { clip: fine } });
  check(`a clip on a grid finer than a line holds (S ${fine.S} > 32) is refused, not thrown: targetGrid`, r.refused === true && r.reason === 'targetGrid');
  const plainA = compose(s.L, s.T, { seed: 3 }), plainB = compose(s.L, s.T, { seed: 3, target: null });
  check('no target (absent or null) is Compose as it was: the same spec, no `target` anywhere', J(plainA) === J(plainB) && !('target' in plainA) && !('target' in plainA.input) && !('cut' in plainA.knobs));
}

// ── 4. timing ──
console.log('\n— timing (P7: the search under ~1.5 s on the 16k row)');
{
  const row = rowOf([4099, 4093, 4091, 4079]), out = [];
  for (const name of ['frere-jacques', 'ode-to-joy']) {
    placeClip(row, clip(name));   // warm
    const r = placeClip(row, clip(name));
    out.push({ name, ms: r.ms, hits: r.placement.hits, J: clip(name).notes.length });
  }
  check(`the 16,359-onset row places ${out.map((x) => `${x.name} in ${x.ms.toFixed(0)} ms (${x.hits}/${x.J})`).join(', ')}: under 1.5 s`, out.every((x) => x.ms < 1500 && x.hits === x.J));
  const t0 = performance.now(), spec = compose([4099, 4093, 4091, 4079], 16, { target: { clip: clip('frere-jacques') } }), ms = performance.now() - t0;
  console.log(`  · measured: a whole target compose of Frère Jacques on the 16k row, lean table: ${ms.toFixed(0)} ms (placement ${spec.target.search.ms.toFixed(0)} ms)`);
}

console.log(PASS ? `\nPASS — ${checks} checks` : `\nFAIL`);
process.exit(PASS ? 0 : 1);
