// assert-chunk-parity.mjs — every chunk-tunes sound, translated into Audio/voices/, plans the note chunk-tunes does.
//
// Second producer: chunk-tunes' own planNote (Overworld/econ/runtime/chunk-sounds.js), imported READ-ONLY from the
// sibling Codex Compiler checkout. For every one of its sounds, over a spread of pitches, lengths, sample rates and
// bass/not-bass, our `note`-role plan must carry the same components (wave, pitch, level, harmonic table, own
// envelope), noise, filters (type, cutoff, Q, sweep) and loudness moments (when, how loud, which ramp — ours before
// the recipe's outputTrim, which the renderer applies as its own gain) and end when chunk-tunes' does.
// Where that checkout is not on this machine the comparison is skipped, and said so.
//   node Audio/tests/assert-chunk-parity.mjs [--chunk=<dir holding chunk-sounds.js>]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getRecipe, getInstrument, CHUNK_SOUND_INSTRUMENTS, NOTE_INSTRUMENT_IDS, INSTRUMENT_IDS } from '../voices/recipes.js';
import { planVoice } from '../voices/plan.js';

let PASS = true;
let checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) { PASS = false; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

console.log('═══ AUDIO VOICES — chunk-tunes parity ═══');

// Find chunk-sounds.js: --chunk=<dir>, else <an ancestor of this file>/Compiler/Codex Compiler (dev)/Overworld/econ/runtime
// (which holds from the main checkout and from a worktree under it alike).
const RELATIVE = path.join('Compiler', 'Codex Compiler (dev)', 'Overworld', 'econ', 'runtime');
function findChunkDir() {
  const arg = process.argv.find(a => a.startsWith('--chunk='));
  if (arg) return arg.slice('--chunk='.length);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, RELATIVE);
    if (fs.existsSync(path.join(candidate, 'chunk-sounds.js'))) return candidate;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
const chunkDir = findChunkDir();
if (!chunkDir || !fs.existsSync(path.join(chunkDir, 'chunk-sounds.js'))) {
  console.log(`  – SKIPPED: chunk-tunes is not on this machine (looked for …/${RELATIVE}/chunk-sounds.js above ${path.dirname(fileURLToPath(import.meta.url))}); pass --chunk=<dir> to point at it.`);
  console.log('\n✓✓✓ CHUNK PARITY SKIPPED (nothing compared)');
  process.exit(0);
}
const chunk = await import(pathToFileURL(path.join(chunkDir, 'chunk-sounds.js')).href);
console.log(`  chunk-tunes: ${path.join(chunkDir, 'chunk-sounds.js')} (${chunk.CHUNK_SOUNDS_VERSION})`);

// ── the mapping ──
check('every chunk-tunes sound maps to an instrument, and no other',
  JSON.stringify(Object.keys(CHUNK_SOUND_INSTRUMENTS).sort()) === JSON.stringify([...chunk.SOUND_IDS].sort()),
  `${Object.keys(CHUNK_SOUND_INSTRUMENTS).length} mapped, chunk-tunes has ${chunk.SOUND_IDS.length}`);
for (const id of chunk.SOUND_IDS) {
  const inst = CHUNK_SOUND_INSTRUMENTS[id];
  check(`${id}: plays on "${inst}", which defines the note role`, !!getInstrument(inst)?.roles.note && NOTE_INSTRUMENT_IDS.includes(inst));
}
// glass, glassbed and warm were Cosmos's: they map back onto Cosmos's recipes, not onto copies with other data
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const [inst, role] of [['glass', 'row'], ['warm', 'row'], ['glassbed', null]]) {
  const noteRecipe = getRecipe(inst, 'note');
  const cosmosRecipe = role ? getRecipe(inst, role) : getRecipe('glass', 'bed');
  check(`${inst}: its note role is Cosmos's ${role ? `${inst} ${role}` : 'glass bed'} recipe (components, noise, filters, trim) with an amp added`,
    same(noteRecipe.components, cosmosRecipe.components) && same(noteRecipe.noise, cosmosRecipe.noise) &&
    same(noteRecipe.filters, cosmosRecipe.filters) && noteRecipe.outputTrim === cosmosRecipe.outputTrim && !!noteRecipe.amp);
}
check('glass and warm are still Cosmos palettes; the other chunk sounds are not',
  INSTRUMENT_IDS.includes('glass') && INSTRUMENT_IDS.includes('warm') &&
  chunk.SOUND_IDS.filter(id => !['glass', 'warm'].includes(id)).every(id => !INSTRUMENT_IDS.includes(CHUNK_SOUND_INSTRUMENTS[id])));

// ── the plans ──
const PITCHES = [55, 110, 220, 261.6255653005986, 440, 987.77, 1760, 3520, 7000, 9000];
const LENGTHS = [0.0005, 0.004, 0.03, 0.12, 0.5, 2, 9];
const RATES = [22050, 44100, 48000];
let notes = 0;
for (const id of chunk.SOUND_IDS) {
  const recipe = getRecipe(CHUNK_SOUND_INSTRUMENTS[id], 'note');
  const s = chunk.SOUNDS[id];
  check(`${id}: held or struck as chunk-tunes says`, (recipe.amp.kind === 'struck') === (s.amp.sustain === 0));
  for (const hz of PITCHES) for (const seconds of LENGTHS) for (const sampleRate of RATES) for (const low of [false, true]) {
    const peak = 0.3;
    const theirs = chunk.planNote(id, { hz, seconds, peak, low, sampleRate });
    const ours = planVoice(recipe, { role: 'note', baseFreq: hz, timing: { peak, duration: seconds }, sampleRate, low });
    const where = `${id} ${hz} Hz ${seconds} s @${sampleRate}${low ? ' bass' : ''}`;
    notes++;
    check(`${where}: as many components`, ours.components.length === theirs.components.length, `${ours.components.length} vs ${theirs.components.length}`);
    theirs.components.forEach((c, i) => {
      const d = ours.components[i];
      check(`${where}, component ${i}: wave, pitch, level, table and own envelope`,
        d && d.wave === c.wave && near(d.freq, c.freq) && near(d.level, c.level) && d.detuneCents === 0 &&
        same(d.harmonics, c.harmonics) && same(d.sub, c.sub), JSON.stringify({ ours: d, theirs: c }));
    });
    check(`${where}: noise`, same(ours.noise, theirs.noise), JSON.stringify({ ours: ours.noise, theirs: theirs.noise }));
    check(`${where}: filters (type, cutoff, Q, sweep), with no drift or swell`,
      same(ours.filters.map(f => [f.type, f.freq, f.Q, f.env]), theirs.filters.map(f => [f.type, f.freq, f.Q, f.env])) &&
      ours.filters.every(f => !f.drift && !f.swellCents));
    const trim = ours.outputTrim;
    check(`${where}: loudness peak (ours × trim)`, near(ours.amp.peak * trim, theirs.peak));
    check(`${where}: loudness moments (when, how loud × trim, which ramp)`,
      ours.amp.moments.length === theirs.amp.length && theirs.amp.every((m, i) => {
        const o = ours.amp.moments[i];
        return near(o.at, m.at) && near(o.value * trim, m.value) && o.ramp === m.ramp;
      }), JSON.stringify({ ours: ours.amp.moments, theirs: theirs.amp }));
    check(`${where}: silent when chunk-tunes' note is`, near(ours.amp.seconds, theirs.seconds));
  }
}

console.log(`  ${checks} checks: ${chunk.SOUND_IDS.length} sounds, ${notes} notes planned against chunk-tunes' planNote`);
console.log(PASS ? '\n✓✓✓ CHUNK PARITY PASSES' : '\n✗ CHUNK PARITY FAILED');
process.exit(PASS ? 0 : 1);
