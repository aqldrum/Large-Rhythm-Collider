// assert-cosmos-identity.mjs — the shared library must give Cosmos EXACTLY what it had before it existed.
//
// Rebuilds the Cosmos snapshot (cosmos-voice-snapshot.mjs: catalog views, getRecipe for every Cosmos role, every
// classic/glass/warm plan over a spread of pitches/timings/sample rates, and the renderer's full mock-context graph
// and automation for each) from the CURRENT Audio/voices/ modules and checks it hash for hash against the fixture
// taken from the original Cosmos/audio/instruments/ modules before the move. Any drift fails, and names the
// instrument/role group it is in.
import { readFileSync } from 'node:fs';
import * as recipes from '../voices/recipes.js';
import { planVoice } from '../voices/plan.js';
import { createInstrumentVoice } from '../voices/voice.js';
import { buildSnapshot, digestSnapshot } from './cosmos-voice-snapshot.mjs';

let PASS = true;
const check = (label, ok, detail = '') => { if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

console.log('═══ AUDIO VOICES — Cosmos byte identity ═══');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cosmos-voice-snapshot.json', import.meta.url), 'utf8'));
const now = digestSnapshot(buildSnapshot(recipes, planVoice, createInstrumentVoice));

check(`as many plans, graphs and recipe lookups as the reference (${fixture.counts.plans} / ${fixture.counts.graphs} / ${fixture.counts.recipes})`,
  JSON.stringify(now.counts) === JSON.stringify(fixture.counts), JSON.stringify(now.counts));
check('the Cosmos catalog views (ids, production/dev split, labels, normalization) are unchanged', now.catalog === fixture.catalog);
check('getRecipe() for every Cosmos role (known, unknown and note-only ids) is unchanged', now.recipes === fixture.recipes);
for (const group of Object.keys(fixture.plans)) check(`planVoice ${group}: every plan byte-identical`, now.plans[group] === fixture.plans[group]);
for (const group of Object.keys(fixture.graphs)) check(`voice ${group}: graph + automation (+ release/swell/crossIn/stop) byte-identical`, now.graphs[group] === fixture.graphs[group]);
check('the whole snapshot is byte-identical to the pre-move reference', now.whole === fixture.whole);

if (!PASS) console.log('\n  To see what moved: node Audio/tests/cosmos-voice-snapshot.mjs <recipes> <plan> <voice> full.json, once on the\n  current modules and once on `git show 96008cf:Cosmos/audio/instruments/*`, and diff the two full.json files.');
console.log(PASS ? '\n✓✓✓ COSMOS IDENTITY PASSES' : '\n✗ COSMOS IDENTITY FAILED');
process.exit(PASS ? 0 : 1);
