// assert-voicing.mjs — voice-led chords (Composer/BASS_VOICING_ORDER.md phase F, F1–F4): compose.js' voicing pass
// (`voicing: 'led'`, the default), the comp's octaves from it, `lane`, `voicing: 'close'`, and rearrange.js' chord swap and
// clave switch over it. Every led spec here is checked against a brute force written from the order, not from compose.js:
//   • only octaves change: every chords and comp note is the onset 'close' plays, at its time, with its class (`voice`)
//   • the mud limit (P1): neighbours under an octave apart, n/d in lowest terms, muddy when the lower sounds under
//     27 Hz × log2(n·d), at most 16/15's (27 × log2(240) ≈ 213 Hz); the first chord close, lifted by octaves until clear (P2)
//   • each chord after: every octave assignment in the window (no tone under 1/1 − 1250¢, each tone within ±1800¢ of the
//     first chord's centre, the centre within ±600¢ of it; P3) scored by its motion from the chord before (each tone to its
//     nearest there, cents as they sound) + a large cost a muddy pair; the voicing chosen is the brute force's cheapest
//     (ties to the lower centre, then the lowest octaves in voice order), so its motion is the least, and every chord is
//     clear of the limit where any voicing in the window is
//   • `lane` the register order in the chord (0 the lowest), on the comp too (its class's chord lane)
//   • the comp (P5): a strum tone the octave nearest its class's chord voice in its bar, a borrowed one the voice itself
//   • 'close' byte for byte the frozen Compose (fixtures/compose-before.js, with the comp in notes) and stacked close as
//     before (with the comp in chords); the stats, the decision and the trace say the voicing (P9); the loop's wrap (P4)
//   • a chord swap: tones unchanged outside its bar, `revoicedBars` exactly the other bars whose octaves moved, the result
//     the brute force's again, a JSON round trip the same; a clave switch equal to a Compose with the same override
//   • the probe rows (8:7:6:5, 11:9:7:5, 19:17:16:15, 7:5:3:2, 119:42:15:8, 768:769, 768:784), a chart, and the
//     16,359-onset row's cost; before (close) and after (led) motion and muddy chords printed
//   node Composer/tests/assert-voicing.mjs
import { compose, voiceLead, partContext } from '../core/compose.js';
import { compose as composeBefore } from './fixtures/compose-before.js';
import { rearrange, reclave, applyRearrange, materialsOf } from '../core/rearrange.js';
import { midiNotesOf, channelOf } from '../perform/composer-midi.js';
import { chainsOf } from '../perform/composer-player.js';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const J = (x) => JSON.stringify(x);
const EPS = 1e-6;

console.log('═══ COMPOSER — voice-led chords (BASS_VOICING_ORDER.md phase F) ═══');

// ── the order's rules, written out ──
const FLOOR = -1250, REACH = 1800, CENTRE = 600, MUD = 27, BIG = 1e6;
const centsOf = (ratio) => { const [n, d] = ratio.split('/').map(Number); return 1200 * Math.log2(n / d); };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
/** a note of a chord as the brute force reads it: its ratio, octave, and its bar's retune (from its own hz) */
const toneOf = (spec, n) => { const [a, b] = n.ratio.split('/').map(Number); return { voice: n.voice, ratio: n.ratio, num: BigInt(a), den: BigInt(b), cents: centsOf(n.ratio), octave: n.octave, retune: 1200 * Math.log2(n.hz / (spec.knobs.baseHz * (a / b) * 2 ** n.octave)), node: n.node }; };
const pitch = (t, o) => t.cents + 1200 * o;
const heard = (t, o) => t.cents + 1200 * o + t.retune;
/** P1: the chord's muddy neighbouring pairs at octaves `oct` */
function muddy(spec, tones, oct) {
  const idx = tones.map((_, i) => i).sort((a, b) => pitch(tones[a], oct[a]) - pitch(tones[b], oct[b]) || tones[a].voice - tones[b].voice);
  let m = 0;
  for (let x = 0; x + 1 < idx.length; x++) {
    const a = tones[idx[x]], b = tones[idx[x + 1]], oa = oct[idx[x]], ob = oct[idx[x + 1]];
    if (pitch(b, ob) - pitch(a, oa) >= 1200 - EPS) continue;
    let n = b.num * a.den, d = b.den * a.num;
    if (ob > oa) n *= 2n ** BigInt(ob - oa); else if (oa > ob) d *= 2n ** BigInt(oa - ob);
    const g = gcd(n, d); n /= g; d /= g;
    const hz = spec.knobs.baseHz * 2 ** ((a.cents + 1200 * oa + a.retune) / 1200);
    if (hz < Math.min(MUD * (Math.log2(Number(n)) + Math.log2(Number(d))), MUD * Math.log2(240)) - EPS) m++;
  }
  return m;
}
const motion = (cur, prev) => cur.reduce((s, x) => s + Math.min(...prev.map((p) => Math.abs(x - p))), 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** a spec's chords, a unit a chord (a chart's span, else a bar): each its voices (one note a class) */
function unitsOf(spec) {
  const notes = spec.parts.find((p) => p.id === 'chords').notes, S = spec.knobs.slotsPerBar;
  return spec.chords.map((c, u) => {
    const from = c.slots != null ? c.from : u * S, to = c.slots != null ? c.from + c.slots : (u + 1) * S;
    return { chord: c, notes: notes.filter((n) => n.slot >= from && n.slot < to).sort((a, b) => a.voice - b.voice) };
  });
}

/** the brute force: the voicing the order asks for, unit by unit, from the spec's tones → [{ oct, motion, mud, clearable, inWindow }] */
function bruteForce(spec) {
  const out = [];
  let prev = null, centre = null;
  for (const U of unitsOf(spec)) {
    const tones = U.notes.map((n) => toneOf(spec, n));
    if (!tones.length) { out.push(null); continue; }
    if (prev == null) {
      // close from an octave under the root (less 50¢), each voice the lowest above the one under it; lifted while muddy
      let floor = centsOf(U.chord.rootTone) - 1250;
      const close = tones.map((t) => { const o = Math.ceil((floor - t.cents) / 1200 - 1e-9); floor = t.cents + 1200 * o + 1; return o; });
      let lift = 0; while (lift < 12 && muddy(spec, tones, close.map((o) => o + lift))) lift++;
      const oct = close.map((o) => o + lift), s = tones.map((t, i) => heard(t, oct[i]));
      centre = mean(s); prev = s;
      out.push({ oct, motion: 0, mud: muddy(spec, tones, oct), clearable: true, first: true, lift });
      continue;
    }
    // every assignment, 3 octaves a tone around the centre, none under the floor
    const opts = tones.map((t) => { const o = []; for (let k = -8; k <= 8; k++) if (pitch(t, k) >= FLOOR - 1e-9 && heard(t, k) >= centre - REACH - 1e-9 && heard(t, k) < centre + REACH - 1e-9) o.push(k); return o; });
    let all = [[]];
    for (const o of opts) all = all.flatMap((a) => o.map((k) => [...a, k]));
    const rows = all.map((oct) => { const s = tones.map((t, i) => heard(t, oct[i])), m = mean(s); return { oct, s, mean: m, off: Math.max(0, Math.abs(m - centre) - CENTRE), motion: motion(s, prev), mud: muddy(spec, tones, oct) }; });
    const least = Math.min(...rows.map((r) => r.off)), ok = rows.filter((r) => r.off <= least + 1e-9);
    for (const r of ok) r.cost = r.motion + BIG * r.mud;
    const best = ok.reduce((a, b) => (b.cost < a.cost - 1e-9 || (Math.abs(b.cost - a.cost) <= 1e-9 && b.mean < a.mean - 1e-9) ? b : a));
    out.push({ oct: best.oct, motion: best.motion, mud: best.mud, clearable: ok.some((r) => r.mud === 0), least: Math.min(...ok.map((r) => r.cost)), inWindow: least <= 1e-9, centre });
    prev = best.s;
  }
  return out;
}

/** a led spec against the brute force and the order's other rules → a list of what failed (empty: the order's) */
function audit(spec, close = null) {
  const bad = [], units = unitsOf(spec), want = bruteForce(spec);
  let first = null;
  units.forEach((U, u) => {
    const w = want[u];
    if (!w) return;
    const got = U.notes.map((n) => n.octave);
    if (J(got) !== J(w.oct)) bad.push(`unit ${u}: octaves ${J(got)}, the brute force's ${J(w.oct)}`);
    if (w.clearable && w.mud) bad.push(`unit ${u}: muddy though a clear voicing is in the window`);
    const tones = U.notes.map((n) => toneOf(spec, n)), s = tones.map((t, i) => heard(t, got[i]));
    if (tones.some((t, i) => pitch(t, got[i]) < FLOOR - 1e-6)) bad.push(`unit ${u}: a tone under the floor`);
    if (first == null) first = mean(s);
    else if (w.inWindow && Math.abs(mean(s) - first) > CENTRE + 1e-6) bad.push(`unit ${u}: centre ${mean(s).toFixed(0)} outside ±${CENTRE} of ${first.toFixed(0)}`);
    // lanes: the register order (0 the lowest)
    const order = U.notes.map((_, i) => i).sort((a, b) => s[a] - s[b] || U.notes[a].voice - U.notes[b].voice);
    order.forEach((i, lane) => { if (U.notes[i].lane !== lane) bad.push(`unit ${u}: voice ${U.notes[i].voice} lane ${U.notes[i].lane}, not ${lane}`); });
  });
  // the comp (in chords): a strum tone the octave nearest its class's chord voice, a borrowed tone the voice itself, its lane
  const comp = spec.parts.find((p) => p.id === 'comp');
  if (comp.strokes) {
    const S = spec.knobs.slotsPerBar;
    for (const n of comp.notes) {
      const U = units.find((x, u) => { const c = x.chord, from = c.slots != null ? c.from : u * S, to = c.slots != null ? c.from + c.slots : (u + 1) * S; return n.bar === (c.slots != null ? c.bar : u) && n.slot >= from && n.slot < to; });
      const v = U?.notes.find((x) => x.voice === n.voice);
      if (!v) { bad.push(`comp at ${n.node}: no chord voice of class ${n.voice}`); continue; }
      const p = pitch(toneOf(spec, n), n.octave), vp = pitch(toneOf(spec, v), v.octave);
      if (n.borrowed ? (n.octave !== v.octave || n.ratio !== v.ratio) : Math.abs(p - vp) > 600 + 1e-6) bad.push(`comp at ${n.node} (${n.borrowed ? 'borrowed' : 'strum'}): ${p.toFixed(0)}¢ against its voice's ${vp.toFixed(0)}¢`);
      if (n.lane !== v.lane) bad.push(`comp at ${n.node}: lane ${n.lane}, its voice's ${v.lane}`);
    }
  }
  // only octaves change: every chords and comp note the onset close plays, with its class and time
  if (close) for (const id of ['chords', 'comp']) {
    const sig = (p) => p.notes.map((n) => `${n.node}:${n.voice}:${n.time}:${n.ratio}:${n.velocity}:${n.borrowed ? n.from : ''}`).sort().join(',');
    if (sig(spec.parts.find((p) => p.id === id)) !== sig(close.parts.find((p) => p.id === id))) bad.push(`${id}: not the onsets 'close' plays`);
  }
  return bad;
}
/** before and after: motion (cents, each chord from the one before) and muddy chords (P1) */
function measure(spec) {
  const units = unitsOf(spec).filter((U) => U.notes.length);
  let mv = 0, md = 0, prev = null;
  for (const U of units) {
    const tones = U.notes.map((n) => toneOf(spec, n)), oct = U.notes.map((n) => n.octave), s = tones.map((t, i) => heard(t, oct[i]));
    if (muddy(spec, tones, oct)) md++;
    if (prev) mv += motion(s, prev);
    prev = s;
  }
  return { motion: Math.round(mv), muddy: md, chords: units.length };
}

const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 4], [[19, 17, 16, 15], 4], [[7, 5, 3, 2], 4], [[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8]];
const closeOf = (L, T, o = {}) => compose(L, T, { ...o, overrides: { ...o.overrides, voicing: 'close' } });

// ── the probe rows ──
console.log('\n— the probe rows (seeds 1–3): led against the brute force, close before');
{
  const tot = { close: { motion: 0, muddy: 0, chords: 0 }, led: { motion: 0, muddy: 0, chords: 0 } };
  let ok = 0, n = 0; const bad = [];
  for (const [L, T] of ROWS) for (const seed of [1, 2, 3]) {
    const led = compose(L, T, { seed }), close = closeOf(L, T, { seed });
    const b = audit(led, close); n++; if (!b.length) ok++; else bad.push(`${L.join(':')} s${seed}: ${b[0]}`);
    const a = measure(close), z = measure(led);
    for (const k of ['motion', 'muddy', 'chords']) { tot.close[k] += a[k]; tot.led[k] += z[k]; }
    if (seed === 1) console.log(`    · ${L.join(':').padEnd(12)} close ${String(a.motion).padStart(5)}¢ motion, ${a.muddy}/${a.chords} muddy → led ${String(z.motion).padStart(5)}¢, ${z.muddy}/${z.chords} muddy (lifted ${led.stats.voicing.lifted}, wrap ${led.stats.voicing.wrap}¢)`);
  }
  console.log(`    · all: close ${tot.close.motion}¢ motion, ${tot.close.muddy}/${tot.close.chords} chords muddy → led ${tot.led.motion}¢, ${tot.led.muddy}/${tot.led.chords}`);
  check(`${ok}/${n} composes: octaves, mud, window, lanes and the comp's octaves the brute force's; only octaves differ from close`, ok === n, bad.slice(0, 3).join('; '));
  check(`led moves less than close over the probe (${tot.led.motion}¢ < ${tot.close.motion}¢) and leaves no chord muddy (${tot.led.muddy})`, tot.led.motion < tot.close.motion && tot.led.muddy === 0);
}

// ── more rows, overrides, a MIDI-free spread: the brute force holds everywhere ──
console.log('\n— more rows and knobs');
{
  const cases = [[[9, 8, 7], 4, {}], [[5, 4, 3], 4, {}], [[13, 11, 7], 6, {}], [[16, 12, 9], 6, {}], [[41, 42, 43], 8, { bars: 4 }], [[97, 103, 37], 5, {}],
    [[426, 317, 285], 8, {}], [[11, 9, 7, 5], 8, { bars: 8 }], [[119, 42, 15, 8], 8, { compRelation: 'fill' }], [[768, 784], 8, { modulation: false }], [[8, 7, 6, 5], 4, { compStyle: 'notes' }], [[19, 17, 16, 15], 4, { baseHz: 60 }]];
  let ok = 0; const bad = [];
  for (const [L, T, ov] of cases) { const led = compose(L, T, { seed: 1, overrides: ov }); const b = led.refused ? ['refused'] : audit(led, closeOf(L, T, { seed: 1, overrides: ov })); if (!b.length) ok++; else bad.push(`${L.join(':')} ${J(ov)}: ${b[0]}`); }
  check(`${ok}/${cases.length} more composes the brute force's (a low baseHz, modulation off, Fill, 8 bars, comp in notes)`, ok === cases.length, bad.slice(0, 3).join('; '));
  const low = compose([19, 17, 16, 15], 4, { seed: 1, overrides: { baseHz: 60 } });
  check(`a low baseHz (60 Hz) lifts the first chord (lifted ${low.stats.voicing.lifted})`, low.stats.voicing.lifted >= 1);
}

// ── a chart: the spans each a chord ──
console.log('\n— a chart');
{
  const charts = [[[11, 9, 7, 5], 4, [[1, 1], [1], [2, 1], [1]]], [[119, 42, 15, 8], 8, [[1, 1], [1, 1], [1], [3, 1]]], [[768, 784], 8, [[1], [1, 1, 1], [1, 1], [1]]]];
  let ok = 0; const bad = [];
  for (const [L, T, changes] of charts) { const led = compose(L, T, { seed: 1, changes }), b = audit(led, closeOf(L, T, { seed: 1, changes })); if (!b.length) ok++; else bad.push(`${L.join(':')}: ${b[0]}`); }
  check(`${ok}/${charts.length} charts (split bars, a span a chord) the brute force's`, ok === charts.length, bad.slice(0, 3).join('; '));
}

// ── close ──
console.log('\n— voicing: \'close\'');
{
  const cases = [[[8, 7, 6, 5], 4, {}], [[11, 9, 7, 5], 6, {}], [[119, 42, 15, 8], 8, { compLayer: 'B' }], [[768, 769], 8, { legato: { comp: true } }], [[41, 42, 43], 8, { bars: 2 }]];
  let same = 0;
  for (const [L, T, ov] of cases) for (const seed of [1, 4]) {
    const live = compose(L, T, { seed, overrides: { ...ov, compStyle: 'notes', voicing: 'close' } });
    delete live.input.overrides.compStyle; delete live.input.overrides.voicing;
    if (J(live) === J(composeBefore(L, T, { seed, overrides: ov }))) same++;
  }
  check(`'close' with the comp in notes: ${same}/${cases.length * 2} byte for byte the frozen Compose (fixtures/compose-before.js)`, same === cases.length * 2);
  // with the comp in chords: stacked close from an octave under the root, each voice the lowest above the one under it
  let stacked = 0, total = 0;
  for (const [L, T] of ROWS) {
    const s = closeOf(L, T, { seed: 1 }); total++;
    const fine = unitsOf(s).every((U) => { let floor = centsOf(U.chord.rootTone) - 1250; return U.notes.every((n) => { const o = Math.ceil((floor - centsOf(n.ratio)) / 1200 - 1e-9); floor = centsOf(n.ratio) + 1200 * o + 1; return o === n.octave && n.lane === undefined; }); });
    const comp = s.parts.find((p) => p.id === 'comp').notes.every((n) => n.lane === undefined);
    if (fine && comp && !s.stats.voicing && !s.decisions.some((d) => d.what === 'voicing')) stacked++;
  }
  check(`'close' with the comp in chords: ${stacked}/${total} stacked close as before, no lane, no voicing stats or decision`, stacked === total);
  check('a bad voicing throws', (() => { try { compose([8, 7, 6, 5], 4, { overrides: { voicing: 'open' } }); return false; } catch (e) { return /voicing must be one of led, close/.test(e.message); } })());
  const asked = compose([11, 9, 7, 5], 4, { seed: 1, overrides: { voicing: 'led' } }), dflt = compose([11, 9, 7, 5], 4, { seed: 1 });
  check('\'led\' asked is the default\'s parts, the decision saying "asked"', J(asked.parts) === J(dflt.parts) && /^asked/.test(asked.decisions.find((d) => d.what === 'voicing').why));
}

// ── the stats, the decision, the trace, the wrap (P4, P9) ──
console.log('\n— stats, decision and trace');
{
  const s = compose([768, 769], 8, { seed: 1 }), v = s.stats.voicing, m = measure(s);
  const units = unitsOf(s).filter((U) => U.notes.length), heardOf = (U) => U.notes.map((n) => heard(toneOf(s, n), n.octave));
  const wrap = Math.round(motion(heardOf(units[0]), heardOf(units[units.length - 1])));
  check(`stats.voicing: ${v.chords} chords, motion ${v.motion}¢ (${v.meanMotion}¢ a chord), lifted ${v.lifted}, muddy ${v.muddy}, the wrap ${v.wrap}¢ — the brute force's measure (${m.motion}¢, wrap ${wrap}¢)`,
    v.mode === 'led' && v.chords === units.length && Math.abs(v.motion - m.motion) <= 1 && Math.abs(v.wrap - wrap) <= 1 && v.meanMotion === Math.round(v.motion / (units.length - 1)) && v.muddy === m.muddy);
  const d = s.decisions.find((x) => x.what === 'voicing');
  check('the decision says the voicing, the chords the mud limit moved, the motion a chord and the wrap', d && d.value === 'led' && d.why.includes(`moved ${v.lifted} of ${v.chords}`) && /¢ of motion a chord/.test(d.why) && /wrap/.test(d.why));
  const idx = s.decisions.findIndex((x) => x.what === 'voicing'), close = closeOf([768, 769], 8, { seed: 1 });
  check('without it, the decisions are close\'s in the same order', J(s.decisions.filter((x) => x.what !== 'voicing').map((x) => x.what)) === J(close.decisions.map((x) => x.what)) && idx > 0);
  const t = compose([768, 769], 8, { seed: 1, trace: true }), { trace, ...rest } = t;
  check('the trace observes: the spec without it is byte for byte the one composed with it off', J(rest) === J(s));
  const part = trace.events.find((e) => e.kind === 'part' && e.part === 'chords');
  check('the trace\'s chords part says the voicing and each note\'s lane', J(part.voicing) === J(v) && part.notes.every((n) => Number.isInteger(n.lane)));
}

// ── lanes in the player and the MIDI ──
console.log('\n— lanes: legato, the player\'s chains, the MIDI zones');
{
  const s = compose([119, 42, 15, 8], 8, { seed: 1 }), T = s.knobs.cycleSeconds;
  const ch = s.parts.find((p) => p.id === 'chords'), comp = s.parts.find((p) => p.id === 'comp');
  // legato on: a chord note holds to its lane's next note
  const byLane = (p) => { const g = new Map(); for (const n of p.notes) { if (!g.has(n.lane)) g.set(n.lane, []); g.get(n.lane).push(n); } return g; };
  let held = true;
  for (const [, notes] of byLane(ch)) notes.forEach((n, i) => { const next = i + 1 < notes.length ? notes[i + 1].time : T; if (Math.abs(n.duration - (next - n.time)) > 1e-9) held = false; });
  check('chords legato: each note holds to its lane\'s next note (P6)', held);
  const chains = chainsOf(ch);
  check(`the player's chains are a lane's each (${chains.length} chains)`, chains.every((c) => c.notes.every((n) => n.lane === c.voice)));
  const mid = midiNotesOf(comp, T), midC = midiNotesOf(ch, T);
  check('the MIDI chords and comp zones put a note on its lane\'s member channel', [...midC, ...mid].every((x) => Number.isInteger(x.voice)) && midC.length === ch.notes.length && new Set(ch.notes.map((n) => channelOf('chords', n.lane))).size === new Set(ch.notes.map((n) => n.lane)).size);
  const lanes = [...byLane(ch).values()], steps = lanes.flatMap((notes) => notes.slice(1).map((n, i) => Math.abs(1200 * Math.log2(n.hz / notes[i].hz))));
  const byVoice = new Map(); for (const n of ch.notes) { if (!byVoice.has(n.voice)) byVoice.set(n.voice, []); byVoice.get(n.voice).push(n); }
  const vsteps = [...byVoice.values()].flatMap((notes) => notes.slice(1).map((n, i) => Math.abs(1200 * Math.log2(n.hz / notes[i].hz))));
  console.log(`    · 119:42:15:8: a channel's mean step ${mean(steps).toFixed(0)}¢ laned by lane, ${mean(vsteps).toFixed(0)}¢ by class`);
  check('a lane moves by smaller steps than a class would', mean(steps) <= mean(vsteps) + 1e-9);
}

// ── a chord swap and a clave switch ──
console.log('\n— a chord swap, a clave switch');
{
  let ok = 0, n = 0, moved = 0; const bad = [];
  for (const [L, T] of [[[119, 42, 15, 8], 8], [[768, 769], 8], [[768, 784], 8], [[11, 9, 7, 5], 4]]) {
    const s = compose(L, T, { seed: 1 }), { row, cells } = materialsOf(s);
    for (let k = 0; k < s.knobs.bars; k++) for (const root of ['1/1', s.chords[(k + 1) % s.knobs.bars].rootTone]) {
      const r = rearrange(s, row, cells, { bar: k, chord: { rootTone: root, quality: 'major_triad' } }); n++;
      const next = applyRearrange(s, r), b = audit(next);
      // tones unchanged outside the bar; revoicedBars the other bars whose octaves moved
      const sig = (spec, bar, f) => spec.parts.find((p) => p.id === 'chords').notes.filter((x) => x.bar === bar).map(f).join(',');
      const moves = [];
      for (let j = 0; j < s.knobs.bars; j++) {
        if (r.changedBars.includes(j)) continue;
        if (sig(s, j, (x) => `${x.node}:${x.voice}`) !== sig(next, j, (x) => `${x.node}:${x.voice}`)) b.push(`bar ${j}: tones changed outside the swap`);
        if (sig(s, j, (x) => x.octave) !== sig(next, j, (x) => x.octave)) moves.push(j);
      }
      if (J(moves) !== J(r.revoicedBars ?? [])) b.push(`revoicedBars ${J(r.revoicedBars)}, the bars that moved ${J(moves)}`);
      moved += moves.length;
      const back = JSON.parse(J(s)), m2 = materialsOf(back), r2 = rearrange(back, m2.row, m2.cells, { bar: k, chord: { rootTone: root, quality: 'major_triad' } });
      if (J(r2) !== J(r)) b.push('a JSON round trip rearranges otherwise');
      if (!b.length) ok++; else bad.push(`${L.join(':')} bar ${k} → ${root}: ${b[0]}`);
    }
    // a swap to the chord it has: the spec byte for byte
    const same = rearrange(s, row, cells, { bar: 0, chord: { rootTone: s.chords[0].rootTone, quality: s.chords[0].quality } });
    if (J(same.parts) !== J(s.parts) || (same.revoicedBars ?? []).length) bad.push(`${L.join(':')}: a swap to its own chord moved something`);
  }
  check(`${ok}/${n} chord swaps: the brute force's voicing after, tones unchanged outside the bar, revoicedBars exact (${moved} bars revoiced), a JSON round trip the same`, ok === n && !bad.length, bad.slice(0, 3).join('; '));
  // a chart's span swap
  const c = compose([119, 42, 15, 8], 8, { seed: 1, changes: [[1, 1], [1, 1], [1], [3, 1]] }), mc = materialsOf(c);
  const rc = rearrange(c, mc.row, mc.cells, { span: 1, chord: { rootTone: '1/1', quality: 'minor_triad' } });
  check('a chart\'s span swap: the brute force\'s voicing after', !audit(applyRearrange(c, rc)).length, audit(applyRearrange(c, rc))[0]);
  // the clave switch: equal to a Compose with the same override, comp and drums byte for byte
  let eq = 0, m = 0;
  for (const [L, T] of [[[119, 42, 15, 8], 8], [[768, 784], 8], [[11, 9, 7, 5], 4]]) {
    const s = compose(L, T, { seed: 1 }), { row, cells } = materialsOf(s);
    for (const edit of [{ relation: 'fill' }, { clave: 'son' }, { clave: 'bossa', relation: 'fill' }]) {
      m++;
      const r = reclave(s, row, cells, edit), full = compose(L, T, { seed: 1, overrides: { ...(edit.clave ? { clave: edit.clave } : {}), ...(edit.relation ? { compRelation: edit.relation } : {}) } });
      if (J(r.parts.find((p) => p.id === 'comp')) === J(full.parts.find((p) => p.id === 'comp')) && J(r.drums) === J(full.drums)) eq++;
    }
  }
  check(`${eq}/${m} clave switches equal a Compose with the same override (the comp's octaves from the led chords)`, eq === m);
}

// ── the 16k row ──
console.log('\n— the 16,359-onset row');
{
  const L = [4099, 4093, 4091, 4079], T = 16;
  let t0 = performance.now(); const led = compose(L, T, { seed: 1 }); const tLed = performance.now() - t0;
  t0 = performance.now(); const close = closeOf(L, T, { seed: 1 }); const tClose = performance.now() - t0;
  const b = audit(led, close), a = measure(close), z = measure(led);
  console.log(`    · 16k: close ${a.motion}¢ motion, ${a.muddy}/${a.chords} muddy → led ${z.motion}¢, ${z.muddy}/${z.chords}`);
  check('16k: the brute force\'s voicing', !b.length, b[0]);
  // the pass's own cost, over the composed chord voices
  const { row, cells } = materialsOf(led), K = led.knobs, ctx = partContext(row, cells, { cycleSeconds: K.cycleSeconds, phase: K.phase, frameCentsEachSide: K.frameCentsEachSide });
  const toneIdx = new Map(row.tones.map((x, i) => [x, i]));
  const units = unitsOf(close).map((U) => ({ chord: { rootCents: row.toneCents[toneIdx.get(U.chord.rootTone)] }, notes: U.notes.map((n) => ({ voice: n.voice, tone: row.tone[n.node], octave: n.octave, pitch: 0, bar: n.bar, slot: n.slot })) }));
  const ratioOf = (bar) => led.chords[bar].fundamentalRatio;
  t0 = performance.now(); voiceLead(ctx, units, { baseHz: K.baseHz, ratioOf }); const tPass = performance.now() - t0;
  check(`16k: the voicing pass ${tPass.toFixed(2)} ms (under 5 ms), the same octaves`, tPass < 5 && J(units.flatMap((U) => U.notes.map((n) => n.octave))) === J(unitsOf(led).flatMap((U) => U.notes.map((n) => n.octave))));
  check(`16k: Compose lean ${tLed.toFixed(0)} ms led, ${tClose.toFixed(0)} ms close (led under 1.5 s, and within 10 % + 50 ms of close)`, tLed < 1500 && tLed < 1.1 * tClose + 50);
}

console.log(PASS ? `\n✓✓✓ VOICE-LED CHORDS PASS (${checks} checks)` : `\n✗ VOICE-LED CHORDS FAILED`);
process.exit(PASS ? 0 : 1);
