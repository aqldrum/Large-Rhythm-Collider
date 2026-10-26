// run.mjs — the MIDI-target feasibility probe: every clip on every row, with controls, and a report.
//
//   node Composer/probe/midi-target/run.mjs [--quick]
//
// 1. Writes the clips (clips.mjs) as .mid files under clips/, reads them back from disk (readMidi), decodes each
//    (decodeClip) and checks the variants decode to their originals (the humanized Ode, Twinkle over chords).
// 2. For each row × searched clip: the search (target.mjs), the best placement overall and per band (whole cycle, near,
//    window), the engine check of the best overall and the best whole-cycle placement (root on the tonic, and root on
//    the lattice), and the tempo it implies at the preset's cycle.
// 3. Controls, the same search on the clip's rhythm with its pitches shuffled (3 seeds) and with uniform random pitch
//    classes (3 seeds): what share of the notes the search finds for a melody nobody wrote. A real melody that fits no
//    better than its shuffles is not being found; the row is just dense enough to play anything.
// → results-<date>.json beside this file, and the report on stdout (markdown).

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRow } from '../../core/row.js';
import { CLIPS, clipBytes } from './clips.mjs';
import { readMidi, decodeClip, describeClip, pcName } from './midi.mjs';
import { search, checkWithEngine, latticesOf, lanesOf, DEFAULTS } from './target.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const quick = process.argv.includes('--quick');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const ROWS = [
  // the lab's presets (composer-controller.js PRESETS), with their cycles
  { layers: [8, 7, 6, 5], cycle: 4 }, { layers: [19, 17, 16, 15], cycle: 6 }, { layers: [41, 42, 43], cycle: 8 },
  { layers: [119, 42, 15, 8], cycle: 8 }, { layers: [768, 769], cycle: 8 }, { layers: [4099, 4093, 4091, 4079], cycle: 16 },
  // between them: onsets and tones varied apart (tests/rhythms.mjs' large draws and consecutive sets)
  { layers: [201, 202, 203], cycle: 8 }, { layers: [504, 234, 520, 297], cycle: 8 }, { layers: [1512, 280, 840, 864], cycle: 8 },
  { layers: [275, 1144, 1260, 234], cycle: 8 }, { layers: [2047, 2048], cycle: 8 }, { layers: [756, 2079, 2574, 315], cycle: 8 },
];

// ── 1. the clips, through real files ──
mkdirSync(join(here, 'clips'), { recursive: true });
const decoded = new Map();
for (const c of CLIPS) {
  const path = join(here, 'clips', `${c.name}.mid`);
  writeFileSync(path, clipBytes(c));
  decoded.set(c.name, decodeClip(readMidi(readFileSync(path))));
}
const sameNotes = (a, b) => a.notes.length === b.notes.length && a.notes.every((n, i) => n.step === b.notes[i].step && n.midi === b.notes[i].midi);
const decodeChecks = CLIPS.filter((c) => c.decodeAs).map((c) => {
  const a = decoded.get(c.name), b = decoded.get(c.decodeAs);
  const onsAgree = sameNotes(a, b), offsAgree = onsAgree && a.notes.every((n, i) => n.until === b.notes[i].until);
  return { clip: c.name, as: c.decodeAs, grid: a.d === b.d && a.S === b.S && a.B === b.B, notes: onsAgree, noteOffs: offsAgree };
});

// ── controls ──
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
function shuffled(clip, seed) {
  const r = rng(seed), pitches = clip.notes.map((n) => n.midi);
  for (let i = pitches.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pitches[i], pitches[j]] = [pitches[j], pitches[i]]; }
  return { ...clip, notes: clip.notes.map((n, i) => ({ ...n, midi: pitches[i], pc: pitches[i] % 12 })) };
}
function randomPcs(clip, seed) {
  const r = rng(seed);
  return { ...clip, notes: clip.notes.map((n) => { const midi = 60 + Math.floor(r() * 12); return { ...n, midi, pc: midi % 12 }; }) };
}

// ── 2–3. the search ──
const summary = (p, J) => (p ? { hits: p.hits, tight: p.tightHits, of: J, N: p.N, k: p.k, psiTone: p.psiTone, phi: p.phi, meanAbsOff: mean(p.offsets.filter((v) => v != null).map(Math.abs)) } : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const NOTE = (m) => `${pcName(m)}${Math.floor(m / 12) - 1}`;

const searched = CLIPS.filter((c) => c.searched).map((c) => decoded.get(c.name));
const rows = quick ? ROWS.filter((r) => r.layers.length && buildRow(r.layers).n < 2000) : ROWS;
const results = [], laneStats = {};
for (const R of rows) {
  const row = buildRow(R.layers), name = R.layers.join(':');
  { // the best lattice's in-tune onsets, lane by lane: what the search has to work with
    const L = latticesOf(row)[0], { lanes, count } = lanesOf(row, L.tone), per = lanes.map((l) => l.x.length);
    laneStats[name] = { inFrame: count, share: count / row.n, lanesUsed: per.filter((c) => c > 0).length, minLane: Math.min(...per), maxLane: Math.max(...per), per };
  }
  log(`row ${name}: ${row.n} onsets, ${row.tones.length} tones, in-frame ${laneStats[name].inFrame}, lanes ${laneStats[name].lanesUsed}/12, min lane ${laneStats[name].minLane}`);
  for (const clip of searched) {
    const J = clip.notes.length, s = search(row, clip);
    const best = s.placements[0];
    const engine = {};
    for (const [which, p] of [['best', best], ['whole', s.bands.whole]]) {
      if (!p) continue;
      engine[which] = {};
      for (const rootMode of ['tonic', 'lattice']) {
        const c = checkWithEngine(row, clip, p, { rootMode });
        engine[which][rootMode] = { hits: c.hits, tight: c.tightHits, misses: c.misses, root: c.rootFraction, rootDev: c.rootDev, notes: c.notes };
      }
    }
    const tempo = best ? { bpmAtPresetCycle: (60 * best.P) / (clip.d * R.cycle), cycleForClipTempo: best.P * clip.stepSeconds } : null;
    const controls = { shuffled: [], random: [] };
    for (let seed = 1; seed <= 3; seed++) {
      controls.shuffled.push(search(row, shuffled(clip, seed)).placements[0]?.hits ?? 0);
      controls.random.push(search(row, randomPcs(clip, 1000 + seed)).placements[0]?.hits ?? 0);
    }
    const rec = {
      row: name, onsets: row.n, tones: row.tones.length, cycle: R.cycle, clip: clip.name, J, S: clip.S, B: clip.B,
      ms: s.ms, votes: s.votes, lattices: s.lattices.length, barCounts: [s.barCounts[0], s.barCounts[s.barCounts.length - 1], s.barCounts.length],
      best: summary(best, J), bands: { whole: summary(s.bands.whole, J), near: summary(s.bands.near, J), window: summary(s.bands.window, J) },
      fullFits: s.fullFits, engine, tempo, controls,
    };
    results.push(rec);
    log(`  ${clip.name.padEnd(14)} ${String(best?.hits).padStart(2)}/${J} N=${best?.N} whole=${s.bands.whole?.hits ?? '-'} engine(tonic)=${engine.best?.tonic.hits} engine(lattice)=${engine.best?.lattice.hits} shuf=${controls.shuffled.join(',')} rand=${controls.random.join(',')} ${s.ms.toFixed(0)}ms`);
  }
}
const date = new Date().toISOString().slice(0, 10);
writeFileSync(join(here, `results-${date}${quick ? '-quick' : ''}.json`), JSON.stringify({ date, defaults: DEFAULTS, laneStats, clips: searched.map((c) => ({ name: c.name, d: c.d, S: c.S, B: c.B, J: c.notes.length, key: c.key })), decodeChecks, results }, null, 1));

// ── the report ──
const out = [];
out.push(`# MIDI-target probe report (${date})`, '');
out.push('## Clips', '', ...CLIPS.map((c) => `- ${describeClip(decoded.get(c.name))}${c.searched ? '' : ' — decoded only'}`), '');
out.push('Decode checks (variant → original): ' + decodeChecks.map((d) => `${d.clip} → ${d.as}: grid ${d.grid ? '✓' : '✗'}, note-ons ${d.notes ? '✓' : '✗'}, note-offs ${d.noteOffs ? '✓' : 'differ'}`).join('; '), '');
out.push('## Hits by row × clip', '', 'Each cell: best hits / notes (N bars), then `w` the best with N = B (whole cycle). Controls: mean best hits of 3 pitch shuffles / 3 random-pitch clips.', '');
out.push(`| row | onsets | tones | in-frame (lanes, min lane) | ${searched.map((c) => c.name).join(' | ')} |`, `|---|--:|--:|---|${searched.map(() => '---').join('|')}|`);
for (const R of rows) {
  const name = R.layers.join(':'), rs = results.filter((r) => r.row === name), ls = laneStats[name];
  out.push(`| ${name} | ${rs[0].onsets} | ${rs[0].tones} | ${ls.inFrame} (${ls.lanesUsed}/12, ${ls.minLane}) | ${rs.map((r) => `**${r.best.hits}/${r.J}** (N ${r.best.N}) w ${r.bands.whole?.hits ?? '–'} · ctl ${mean(r.controls.shuffled).toFixed(1)}/${mean(r.controls.random).toFixed(1)}`).join(' | ')} |`);
}
const lost = results.filter((r) => r.engine.best && r.engine.best.lattice.hits !== r.best.hits);
out.push('', `Search vs. engine (lattice root): ${results.length - lost.length} of ${results.length} agree${lost.length ? '; differ: ' + lost.map((r) => `${r.row} ${r.clip} ${r.best.hits}→${r.engine.best.lattice.hits}`).join(', ') : ''}.`);
out.push('', '## Engine check of the best placement (buildCells partitioned + frameAt)', '', 'hits (tight ≤ ¼ slot) with the root on the clip\'s tonic lane vs. on the lattice tone; misses as fringe/shift/hard (tonic root).', '');
out.push('| row | clip | search | engine, tonic root (dev ¢) | engine, lattice root | misses (f/s/h) | BPM at preset cycle | cycle for clip tempo (s) | search ms |', '|---|---|--:|--:|--:|---|--:|--:|--:|');
for (const r of results) {
  const t = r.engine.best?.tonic, l = r.engine.best?.lattice;
  out.push(`| ${r.row} | ${r.clip} | ${r.best.hits}/${r.J} | ${t.hits} (${t.tight}) ${t.rootDev.toFixed(1)} | ${l.hits} (${l.tight}) | ${t.misses.fringe}/${t.misses.shift}/${t.misses.hard} | ${r.tempo.bpmAtPresetCycle.toFixed(0)} | ${r.tempo.cycleForClipTempo.toFixed(2)} | ${r.ms.toFixed(0)} |`);
}
// a few readings, note by note: what the melody becomes
out.push('', '## Readings (engine, tonic root): MIDI note → the row\'s fraction, cents above the root, deviation', '');
for (const r of results.filter((r) => r.engine.best?.tonic.hits === r.J && ['ode-to-joy', 'greensleeves', 'chromatic-run'].includes(r.clip)).slice(0, 6)) {
  const e = r.engine.best.tonic;
  out.push(`- **${r.clip} on ${r.row}** (N ${r.best.N}, root ${e.root}): ` + e.notes.map((n) => (n.miss ? `${NOTE(n.midi)}→miss(${n.miss})` : `${NOTE(n.midi)}→${n.fraction.length > 12 ? '…' : n.fraction} ${n.centsAboveRoot.toFixed(0)}¢${n.dev >= 0 ? '+' : ''}${n.dev.toFixed(1)}`)).join(', '));
}
process.stdout.write(out.join('\n') + '\n');
