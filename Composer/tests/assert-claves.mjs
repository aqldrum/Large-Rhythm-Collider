// assert-claves.mjs — the clave (Composer/COMP_ARP_ORDER.md Amendment 1, phase C: R1–R5): core/claves.js, and the clave
// in compose.js, drums.js and rearrange.js. Exit non-zero on any mismatch.
//   • OVERWORLD PARITY (read-only, skipped when chunk-tunes is absent): on the rhythms whose tones the kernel spells
//     exactly and whose layers are distinct, rhythm-claves.js `readRhythm` and `claveTable` (whole and meeting) row for
//     row, chunk-comping.js `chunkClaves`, `compCandidates` and `clavePartners` as the port's (held: 'rhythms')
//   • the port's fast reads (a one-tone set from the bars' own strikes, a coarse set by bit mask) against `layerClaves`
//     set by set, and its partners against a line-for-line port of chunk-comping's, at every tier
//   • the table, the score and the partners on the Composer row: COMP_RULES, recurrence a step count, the tiers, partners
//     never sharing a step, the complement, the curated claves
//   • the clave laid and landed: every stroke a real onset, the nearest inside its place's window (half-way to the
//     neighbouring places of the clave's grid, then one place wider) and inside its bar or span; the silent steps are
//     exactly those with no onset there; sync and fill (fill never shares a step or an onset with the clave); the comp's
//     strokes; the perc on the clave (R4); a chart's split bars; the overrides; determinism; a chord swap keeps the clave
//   • the live clave step (phase E, rearrange.js `reclave`): equal, comp and drums byte for byte (and spec.clave, its
//     stats line, the strum's share), to a Compose given the same `overrides.clave` / `compRelation`, on plain bars, a
//     chart's split bars and a MIDI target; deterministic; `compStyle: 'notes'` refused; through rearrange (the worker's
//     door); the window's words (claveText, claveSource)
//   • the 16,359-onset row's timing (and the live step's on it)
//   node Composer/tests/assert-claves.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRow } from '../core/row.js';
import {
  readRhythm, layerTones, barSizes, toneSets, layerClaves, claveTable, rowClaves, scoreClave, compCandidates, clavePartners, complementClave,
  claveOf, curatedClaves, rankRowClaves, chooseClave, claveAlternates, claveText, claveSource, claveSetText, COMP_RULES, SIZE_TIERS, CURATED_NAMES,
} from '../core/claves.js';
import { compose, compNodesOf, compSourceOf } from '../core/compose.js';
import { arrangeDrums } from '../core/drums.js';
import { DRUM_PATTERNS } from '../core/drum-patterns.js';
import { euclidPattern } from '../core/cells.js';
import { rearrange, applyRearrange, materialsOf, reclave } from '../core/rearrange.js';
import { answer } from '../core/compose-worker.js';
import { decodeClip, readMidi } from '../core/midi.js';
import { CLIPS, clipBytes } from './fixtures/midi-clips.mjs';
import { RHYTHMS, OVERWORLD_RUNTIME } from './rhythms.mjs';

let PASS = true, checks = 0;
const check = (label, ok, detail = '') => { checks++; if (!ok) PASS = false; console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`); };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
const J = (x) => JSON.stringify(x);
const mod = (v, n) => ((v % n) + n) % n;
const EPS = 1e-9;
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

console.log('═══ COMPOSER — the clave (COMP_ARP_ORDER.md Amendment 1, phase C) ═══');

// ── Overworld parity ──
console.log('\n— Overworld parity (rhythm-claves.js, chunk-comping.js)');
const clavesFile = path.join(OVERWORLD_RUNTIME, 'rhythm-claves.js'), compingFile = path.join(OVERWORLD_RUNTIME, 'chunk-comping.js');
if (!fs.existsSync(clavesFile) || !fs.existsSync(compingFile)) {
  console.log(`  – skipped: ${clavesFile} or ${compingFile} is not on this machine`);
} else {
  const ow = await import(pathToFileURL(clavesFile).href), oc = await import(pathToFileURL(compingFile).href);
  const strip = (r) => { const { name, ...rest } = r; return rest; };
  let rows = 0, tables = 0, pools = 0, partnered = 0, n = 0, skipped = 0;
  const bad = [];
  for (const layers of RHYTHMS) {
    const row = buildRow(layers), values = layers.filter((v) => v > 0);
    if (row.tones.some((f, t) => f !== row.toneLabels[t]) || new Set(values).size !== values.length || row.n > 4000) { skipped++; continue; }
    n++;
    const mine = readRhythm(row), theirs = ow.readRhythm(values);
    const name = layers.join(':');
    if (J(mine.layers) !== J(theirs.layers) || mine.grid !== theirs.grid || mine.fundamental !== theirs.fundamental || mine.nodes !== theirs.nodes) { bad.push(`${name}: the rhythm read`); continue; }
    if (J(mine.tones.map((t) => [t.fraction, t.nodes])) !== J(theirs.tones.map((t) => [t.fraction, t.nodes])) || mine.tones.some((t, i) => Math.abs(t.cents - theirs.tones[i].cents) > 1e-9)) { bad.push(`${name}: the tones`); continue; }
    if (mine.layer.some((L, b) => J([...L.tone]) !== J([...theirs.layer[b].tone]) || J([...L.octave]) !== J([...theirs.layer[b].octave]) || J([...L.node]) !== J([...theirs.layer[b].node]))) { bad.push(`${name}: a layer's strikes`); continue; }
    for (const L of values) {
      if (J(layerTones(mine, L)) !== J(ow.layerTones(theirs, L)) || J(barSizes(mine, L)) !== J(ow.barSizes(theirs, L)) || J(toneSets(mine, L)) !== J(ow.toneSets(theirs, L))) bad.push(`${name}: layer ${L}'s tones, sizes or sets`);
      const set = ow.toneSets(theirs, L)[0], size = ow.barSizes(theirs, L)[0]?.size;
      if (set && size && J(layerClaves(mine, { layer: L, size, tones: set.tones })) !== J({ ...ow.layerClaves(theirs, { layer: L, size, tones: set.tones }), version: mine.version })) bad.push(`${name}: layerClaves ${L}/${size}/${set.id}`);
    }
    for (const sizes of ['whole', 'meeting', 4]) {
      const a = claveTable(mine, { sizes, maxSize: 16 }).map(strip), b = ow.claveTable(theirs, { sizes, maxSize: 16 });
      tables++; rows += b.length;
      if (J(a) !== J(b)) { const i = a.findIndex((x, k) => J(x) !== J(b[k])); bad.push(`${name}: claveTable '${sizes}' row ${i} (${J(a[i])?.slice(0, 120)} vs ${J(b[i])?.slice(0, 120)})`); }
    }
    const pool = rowClaves(mine), theirPool = oc.chunkClaves([{ villageId: 'v', layers: values }]);
    pools++;
    const as = (c) => ({ id: c.id, steps: c.steps, pattern: c.pattern, onsets: c.onsets, rhythms: c.rhythms, bars: c.bars, row: c.from.row });
    if (J(pool.claves.map(as)) !== J(theirPool.claves.map(as)) || pool.rows !== theirPool.rows) bad.push(`${name}: chunkClaves`);
    const ra = compCandidates(pool), rb = oc.compCandidates(theirPool);
    if (J(ra.candidates.map((c) => [c.id, c.score])) !== J(rb.candidates.map((c) => [c.id, c.score])) || J(Object.keys(ra.bySteps)) !== J(Object.keys(rb.bySteps))) bad.push(`${name}: compCandidates`);
    for (const c of rb.candidates.slice(0, 4)) {
      const p1 = clavePartners(mine, claveOf(c.id)), p2 = oc.clavePartners([{ villageId: 'v', layers: values }], oc.claveOf(c.id));
      if (p2.length) partnered++;
      if (J(p1) !== J(p2)) bad.push(`${name}: clavePartners of ${c.id}`);
    }
    const s = rb.candidates[0];
    if (s && J(scoreClave(s, 1)) !== J(oc.scoreClave(s, 1))) bad.push(`${name}: scoreClave`);
  }
  check(`${n} rhythms (${skipped} skipped: a rounded tone, a repeated layer, or past 4,000 onsets): readRhythm, layerTones, barSizes, toneSets, layerClaves; ${tables} tables (${rows} rows, whole / meeting / 4 strikes), ${pools} pools ranked, the top claves' partners (${partnered} with some) — all chunk-tunes'`, !bad.length, bad.slice(0, 3).join('; '));
  check('COMP_RULES are chunk-comping\'s', J(COMP_RULES) === J(oc.COMP_RULES));
  check('claveOf reads a clave as chunk-comping does', J(claveOf('8:x..x..x.')) === J({ ...oc.claveOf('8:x..x..x.'), span: 1 }) || (() => { const a = claveOf('8:x..x..x.'), b = oc.claveOf('8:x..x..x.'); return a.id === b.id && a.steps === b.steps && a.pattern === b.pattern && J(a.onsets) === J(b.onsets); })());
}

// ── the port's fast reads against a line-for-line reference ──
console.log('\n— the fast reads, against layerClaves set by set and a line-for-line clavePartners');
/** rhythm-claves.js `claveTable`, line for line over the port's layerClaves (the reference) */
function refTable(rh, { sizes, maxSize = 16, minOnsets = 2 }) {
  const rows = [];
  rh.layer.map((_, i) => i).reverse().forEach((at) => {
    const L = rh.layer[at], name = rh.layers.indexOf(L.value) === at ? L.value : L.name, value = L.value;
    const meets = (size) => rh.layers.filter((b, i) => i !== at && size % (value / gcd(value, b)) === 0);
    let cuts = [];
    if (typeof sizes === 'number') cuts = sizes <= value ? [{ size: sizes, meets: meets(sizes) }] : [];
    else if (sizes === 'every') for (let size = 2; size <= Math.min(maxSize, value); size++) cuts.push({ size, meets: meets(size) });
    else cuts = barSizes(rh, name).filter((x) => x.size <= maxSize && (sizes === 'whole' || x.meets.length));
    for (const cut of cuts) for (const set of toneSets(rh, name)) {
      const c = layerClaves(rh, { layer: name, size: cut.size, tones: set.tones });
      c.claves.forEach((x, clave) => {
        if (x.onsets < minOnsets || x.onsets === x.steps) return;
        rows.push({ id: `${value}/${cut.size}/${set.id}/${clave}`, layer: value, name: L.name, size: cut.size, steps: x.steps, of: c.bars.length, meets: cut.meets, clipped: x.steps < cut.size,
          set: { id: set.id, kind: set.kind, tones: c.set }, clave, pattern: x.pattern, onsets: x.onsets, count: x.bars.length, first: x.bars[0] });
      });
    }
  });
  return rows;
}
/** chunk-comping.js `clavePartners`, line for line over one rhythm, its cuts by tier */
function refPartners(rh, clave, { sizes, rules = COMP_RULES, top = 40 }) {
  const found = new Map();
  rh.layer.forEach((L, at) => {
    const name = rh.layers.indexOf(L.value) === at ? L.value : L.name;
    if (clave.steps > L.value) return;
    const ok = sizes === 'every' ? clave.steps <= rules.maxSize : barSizes(rh, name).some((cut) => cut.size === clave.steps && (sizes === 'whole' || cut.meets.length));
    if (!ok) return;
    const sets = toneSets(rh, name), strings = sets.map((set) => layerClaves(rh, { layer: name, size: clave.steps, tones: set.tones }));
    const patternAt = (i, b) => strings[i].claves[strings[i].sequence[b]].pattern;
    sets.forEach((set, i) => {
      const where = strings[i].claves.findIndex((x) => x.pattern === clave.pattern);
      if (where < 0) return;
      const own = new Set(strings[i].set);
      sets.forEach((other, j) => {
        if (j === i || strings[j].set.some((f) => own.has(f))) return;
        for (const b of strings[i].claves[where].bars) {
          const pattern = patternAt(j, b), n = strings[j].bars[b].onsets.length;
          if (n < rules.minOnsets || n === clave.steps) continue;
          const id = `${clave.steps}:${pattern}`;
          let p = found.get(id);
          if (!p) found.set(id, (p = { id, steps: clave.steps, pattern, onsets: [...pattern].flatMap((ch, k) => (ch === 'x' ? [k] : [])), together: 0, rhythms: 1 }));
          p.together++;
        }
      });
    });
  });
  return [...found.values()].sort((a, b) => b.rhythms - a.rhythms || b.together - a.together || (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0)).slice(0, top);
}
{
  const bad = []; let tables = 0, rows = 0, partners = 0;
  for (const L of [[8, 7, 6, 5], [11, 9, 7, 5], [19, 17, 16, 15], [16, 12, 9], [119, 42, 15, 8], [6, 6, 4], [426, 317, 285], [768, 769], [41, 42, 43], [401, 240, 393]]) {
    const rh = readRhythm(buildRow(L));
    for (const sizes of ['meeting', 'whole', 'every', 5]) {
      const a = claveTable(rh, { sizes, maxSize: 16 }), b = refTable(rh, { sizes });
      tables++; rows += b.length;
      if (J(a) !== J(b)) { const i = a.findIndex((x, k) => J(x) !== J(b[k])); bad.push(`${L.join(':')} '${sizes}': row ${i} of ${b.length}`); }
      if (typeof sizes !== 'string') continue;
      const ranked = compCandidates(rowClaves(rh, { sizes }), { held: 'bars' });
      for (const c of ranked.candidates.slice(0, 3)) { partners++; if (J(clavePartners(rh, c, { sizes })) !== J(refPartners(rh, c, { sizes }))) bad.push(`${L.join(':')} '${sizes}': the partners of ${c.id}`); }
    }
  }
  check(`${tables} tables (${rows} rows, every tier and a number) row for row the line-for-line reference's, and ${partners} claves' partners`, !bad.length, bad.slice(0, 3).join('; '));
}

// ── the table, the score, the partners on the Composer row ──
console.log('\n— the table, the score and the partners on the Composer row');
const ROWS = [[[8, 7, 6, 5], 4], [[11, 9, 7, 5], 6], [[19, 17, 16, 15], 3], [[16, 12, 9], 4], [[119, 42, 15, 8], 8], [[426, 317, 285], 8], [[768, 769], 8], [[768, 784], 8], [[41, 42, 43], 8]];
{
  const bad = [], tiers = {};
  for (const [L] of ROWS) {
    const rh = readRhythm(buildRow(L)), R = rankRowClaves(rh), name = L.join(':');
    tiers[name] = R.tier;
    // the first tier with a candidate, the earlier ones empty
    const at = SIZE_TIERS.indexOf(R.tier);
    if (at < 0 || R.tried.length !== at + 1 || R.tried.slice(0, at).some((t) => t.claves) || !R.tried[at].claves) bad.push(`${name}: the tiers ${J(R.tried)}`);
    for (const c of rowClaves(rh, { sizes: R.tier }).claves) {
      if (c.steps < 3 || c.steps > 16 || c.pattern.length !== c.steps || c.onsets.length < 2 || c.onsets.length === c.steps) bad.push(`${name}: ${c.id} breaks COMP_RULES`);
    }
    for (const c of R.ranked.candidates) {
      const x = c.onsets.length / c.steps, density = x < 0.25 ? x / 0.25 : x > 0.5 ? (1 - x) / 0.5 : 1, fit = [4, 8, 16].includes(c.steps) ? 1 : [3, 6, 12].includes(c.steps) ? 0.75 : 0.4;
      const all = rowClaves(rh, { sizes: R.tier }).claves.filter((y) => y.steps === c.steps), held = c.bars / Math.max(...all.map((y) => y.bars));
      if (Math.abs(c.terms.density - density) > EPS || Math.abs(c.terms.fit - fit) > EPS || Math.abs(c.terms.held - held) > EPS || Math.abs(c.score - (held + density + fit) / 3) > EPS) bad.push(`${name}: ${c.id}'s score`);
    }
    for (let i = 1; i < R.ranked.candidates.length; i++) if (R.ranked.candidates[i].score > R.ranked.candidates[i - 1].score + EPS) bad.push(`${name}: not ranked`);
    for (const c of R.ranked.candidates.slice(0, 5)) for (const p of clavePartners(rh, c, { sizes: R.tier })) if (p.onsets.some((j) => c.pattern[j] === 'x') || p.steps !== c.steps) bad.push(`${name}: ${p.id} shares a step with ${c.id}`);
  }
  check(`the rows' claves keep COMP_RULES (3–16 steps, 2+ onsets, never the pulse); scores are (recurrence + density + fit) / 3, recurrence the bars over the most of the step count; ranked; partners never share a step`, !bad.length, bad.slice(0, 3).join('; '));
  check(`the tiers: 'meeting' on the small rows, 'whole' where no layer meets another within 16 strikes (${['426:317:285', '768:769', '768:784', '41:42:43'].map((k) => `${k} ${tiers[k]}`).join(', ')})`, tiers['8:7:6:5'] === 'meeting' && tiers['19:17:16:15'] === 'meeting' && tiers['426:317:285'] === 'whole' && tiers['768:769'] === 'whole' && tiers['768:784'] === 'whole');
  const c = claveOf('16:x..x..x...x.x...'), f = complementClave(c), keep = euclidPattern(11, 5);
  const free = [...c.pattern].flatMap((ch, j) => (ch === '.' ? [j] : []));
  check(`the complement (no partner): ${c.pattern} → ${f.pattern}, its gaps Euclid-thinned to its own 5 onsets`, f.onsets.length === 5 && f.onsets.every((j) => c.pattern[j] === '.') && J(f.onsets) === J(free.filter((_, i) => keep[i])));
  const cur = curatedClaves();
  check(`the curated claves: ${cur.map((x) => `${x.id} ${x.steps}/${x.span} bar${x.span > 1 ? 's' : ''}`).join(', ')}, the drum patterns' perc lines`, J(cur.map((x) => x.id)) === J(CURATED_NAMES) && cur.every((x) => x.pattern === DRUM_PATTERNS[x.id].perc.toLowerCase() && x.span === DRUM_PATTERNS[x.id].bars));
  check('claveOf: a curated name, steps:pattern, and a bad one refused', claveOf('son').span === 2 && claveOf('5:x.x..').steps === 5 && throws(() => claveOf('5:x.x.'), /is not a clave/) && throws(() => claveOf('tresillo'), /is not a clave/));
  const rh = readRhythm(buildRow([8, 7, 6, 5])), a = chooseClave(rh, { rng: () => 0 }), b = chooseClave(rh, { rng: () => 0.999 });
  check(`ties by the generator: ${a.ties} claves tie at the top of 8:7:6:5, the first and last draws pick ${a.clave.id} and ${b.clave.id}`, a.ties > 1 && a.clave.id !== b.clave.id && a.clave.score === b.clave.score);
  const alts = claveAlternates(a.ranks);
  check(`the alternates: the top 12 mined, then the curated (${alts.length})`, alts.length === Math.min(12, a.ranks.ranked.candidates.length) + 3 && J(alts.slice(-3).map((x) => x.id)) === J(CURATED_NAMES));
}

// ── laid and landed ──
console.log('\n— the clave laid and landed, sync and fill, the perc');
/** the spec's geometry, rebuilt from its timeline: each onset's place r (from the downbeat) and slot; a place in slot units → r */
function geometry(spec) {
  const { row } = materialsOf(spec), K = spec.knobs, S = K.slotsPerBar, N = K.bars, P = N * S, phaseX = K.phase[0] / K.phase[1];
  const rowT = K.rowCycleSeconds ?? K.cycleSeconds, starts = spec.timeline.slotStarts.map((x) => x / rowT), W = K.cut ? K.cycleSeconds / rowT : 1;
  const rOf = (tick) => mod(tick / row.grid - phaseX, 1);
  const rAt = (g) => { const w = Math.floor(g / P), h = g - w * P, k = Math.min(P - 1, Math.floor(h)), frac = h - k, a = starts[k], b = k + 1 < P ? starts[k + 1] : W; return w * W + a + frac * (b - a); };
  const slotOf = (r) => { let lo = 0, hi = P - 1; if (r >= W) return -1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= r + EPS) lo = mid; else hi = mid - 1; } return lo; };
  const sorted = Array.from({ length: row.n }, (_, i) => ({ i, r: rOf(row.tick[i]) })).sort((a, b) => a.r - b.r);
  /** the onsets with lo < r ≤ hi (r taken as-is and ±1 around the cycle) */
  const within = (lo, hi) => {
    const out = [];
    for (const shift of [-1, 0, 1]) {
      let a = 0, b = sorted.length; while (a < b) { const m = (a + b) >> 1; if (sorted[m].r + shift <= lo) a = m + 1; else b = m; }
      for (let k = a; k < sorted.length && sorted[k].r + shift <= hi; k++) out.push({ i: sorted[k].i, r: sorted[k].r + shift });
    }
    return out;
  };
  return { row, S, N, P, rOf, rAt, slotOf, within };
}
/** a clave's laying checked against the rule from the spec alone → '' or the first problem; `x` the clave or its partner */
function auditLaid(spec, G, x) {
  const units = spec.chords.map((c, u) => (c.slots != null ? { from: c.from, to: c.from + c.slots } : { from: u * G.S, to: (u + 1) * G.S }));
  const unitAt = (slot) => units.find((u) => slot >= u.from && slot < u.to);
  const B = x.span, n = x.steps, h = (G.S * B) / (2 * n), byPlace = new Map(x.strokes.map((s) => [`${s.bar}|${s.step}`, s]));
  let silent = 0;
  for (let pass = 0; pass * B < G.N; pass++) for (const j of x.onsets) {
    const place = pass * B * G.S + (j * G.S * B) / n, bar = Math.floor(place / G.S + EPS);
    if (bar >= G.N) continue;
    const u = unitAt(Math.floor(place + EPS)), r = G.rAt(place), s = byPlace.get(`${bar}|${j}`);
    // drums.js' window: lo < r ≤ hi with its 1e-12 slack either side, an onset at the span's start in and at its end out
    const look = (w) => G.within(Math.max(G.rAt(place - w), G.rAt(u.from)) - 1e-12, Math.min(G.rAt(place + w) + 1e-12, G.rAt(u.to) - 1e-12)).filter((o) => { const sl = G.slotOf(mod(o.r, 1)); return sl >= u.from && sl < u.to; });
    const narrow = look(h), wide = narrow.length ? narrow : look(2 * h);
    if (!wide.length) { silent++; if (s) return `step ${j} of bar ${bar + 1} landed with no onset in its window`; continue; }
    if (!s) return `step ${j} of bar ${bar + 1} is silent with ${wide.length} onsets in its window`;
    const best = wide.reduce((a, o) => (Math.abs(o.r - r) < Math.abs(a.r - r) - 1e-15 || (Math.abs(Math.abs(o.r - r) - Math.abs(a.r - r)) <= 1e-15 && o.r < a.r) ? o : a));
    if (G.row.tick[s.node] !== s.tick || s.node !== best.i) return `step ${j} of bar ${bar + 1}: onset ${s.node}, the nearest in its window is ${best.i}`;
    if (s.snap !== (narrow.length ? 'slot' : 'wide')) return `step ${j} of bar ${bar + 1}: snap ${s.snap}`;
    if (s.slot < u.from || s.slot >= u.to || Math.abs(s.place - place) > EPS) return `step ${j} of bar ${bar + 1}: outside its bar or span`;
  }
  if (silent !== x.silent || x.strokes.length + silent !== [...Array(Math.ceil(G.N / B))].reduce((a, _, pass) => a + x.onsets.filter((j) => Math.floor((pass * B * G.S + (j * G.S * B) / n) / G.S + EPS) < G.N).length, 0)) return `silent ${x.silent}, the rule says ${silent}`;
  return '';
}
/** the comp's strokes against the clave: in sync the clave's landed onsets, in fill the partner's not on a clave onset; a bar or span with none its root onset */
function auditComp(spec) {
  const comp = spec.parts.find((p) => p.id === 'comp'), C = spec.clave, S = spec.knobs.slotsPerBar;
  const src = C.relation === 'fill' ? C.partner.strokes.filter((x) => !C.strokes.some((y) => y.node === x.node)) : C.strokes;
  if (J(src) !== J(compSourceOf(C))) return 'compSourceOf';
  if (C.partner.onsets.some((j) => C.pattern[j] === 'x') && C.partner.source === 'partner') return 'the partner shares a step';
  const want = [];
  spec.chords.forEach((c, u) => {
    const from = c.slots != null ? c.from : u * S, to = c.slots != null ? c.from + c.slots : (u + 1) * S;
    const mine = [...new Set(src.filter((x) => x.slot >= from && x.slot < to).sort((a, b) => a.time - b.time || a.node - b.node).map((x) => x.node))];
    if (J(mine) !== J(compNodesOf(C, from, to).filter((v, i, a) => a.indexOf(v) === i))) want.push(null);
    if (mine.length) want.push(...mine); else if (c.rootNode != null) { const ok = comp.strokes.some((x) => x.node === c.rootNode && x.slot >= from && x.slot < to); if (ok) want.push(c.rootNode); }
  });
  const got = comp.strokes.map((x) => x.node);
  if (J([...got].sort((a, b) => a - b)) !== J([...want].sort((a, b) => a - b))) return `the comp's strokes ${J(got).slice(0, 80)} are not the clave's ${J(want).slice(0, 80)}`;
  if (C.relation === 'fill' && comp.strokes.some((x) => C.strokes.some((y) => y.node === x.node) && !spec.chords.some((c) => c.rootNode === x.node))) return 'a fill stroke on a clave onset';
  return '';
}
const summary = (spec) => { const c = spec.parts.find((p) => p.id === 'comp'); return `${spec.clave.id}${spec.clave.from.layer != null ? ` (${spec.clave.from.name} ${spec.clave.from.layer}/${spec.clave.from.size} ${spec.clave.from.set})` : spec.clave.from.pattern ? ' (curated)' : ''}: ${c.strokes.length} strokes, ${(100 * spec.stats.compStrum).toFixed(0)} % from the row`; };
{
  const bad = []; let n = 0, strokes = 0, wide = 0, silent = 0, fills = 0, partners = 0;
  for (const [L, T] of ROWS) for (const seed of [1, 5]) for (const compRelation of ['sync', 'fill']) {
    const spec = compose(L, T, { seed, overrides: { compRelation } }), G = geometry(spec); n++;
    const why = auditLaid(spec, G, spec.clave) || auditLaid(spec, G, spec.clave.partner) || auditComp(spec);
    if (why) bad.push(`${L.join(':')} seed ${seed} ${compRelation}: ${why}`);
    strokes += spec.clave.strokes.length; wide += spec.clave.strokes.filter((x) => x.snap === 'wide').length; silent += spec.clave.silent;
    if (compRelation === 'fill') { fills++; if (spec.clave.partner.source === 'partner') partners++; }
    if (seed === 1) console.log(`    · ${L.join(':')} ${compRelation}: ${summary(spec)}; partner ${spec.clave.partner.pattern} (${spec.clave.partner.source})`);
  }
  check(`${n} composes (${ROWS.length} rows × 2 seeds × sync, fill): every stroke the nearest real onset in its place's window, inside its bar; silent exactly where the window is empty (${strokes} strokes, ${wide} wide, ${silent} silent); the comp strikes the clave (sync) or its partner off the clave's onsets (fill: ${partners}/${fills} a mined partner)`, !bad.length, bad.slice(0, 3).join('; '));
}
{
  const spec = compose([19, 17, 16, 15], 3, { seed: 1 }), d = spec.drums, perc = d.hits.filter((h) => h.voice === 'perc' && h.snap === 'clave');
  check(`the perc on the clave (R4, backbeat): ${perc.length} strokes on its ${spec.clave.strokes.length} landed onsets, the pass's first accented`, perc.length === new Set(spec.clave.strokes.map((x) => x.tick)).size && perc.every((h) => spec.clave.strokes.some((x) => x.tick === h.tick && x.step === h.step)) && d.decisions.some((x) => x.what === 'drums.perc'));
  const pat = arrangeDrums(spec, { perc: 'pattern' }), base = arrangeDrums({ ...spec, clave: undefined }, {});
  check('perc: \'pattern\' is the drums with no clave, byte for byte but the option echoed', J(pat.hits) === J(base.hits) && J(pat.decisions) === J(base.decisions) && pat.options.perc === 'pattern');
  const fill = compose([19, 17, 16, 15], 3, { seed: 1, overrides: { compRelation: 'fill' } }), fc = fill.parts.find((p) => p.id === 'comp');
  const percTicks = new Set(fill.drums.hits.filter((h) => h.snap === 'clave').map((h) => h.tick));
  check(`fill hockets: none of the comp's ${fc.strokes.length} strokes on the perc's clave onsets`, fc.strokes.every((x) => !percTicks.has(x.tick)));
  const withMode = arrangeDrums(spec, { mode: 'with' }), son = arrangeDrums(spec, { mode: 'son' }), part = arrangeDrums(spec, { mode: 'partition' });
  check('with keeps its line (a perc stroke on each comp stroke) and adds the clave; son and partition keep their own perc', withMode.hits.some((h) => h.snap === 'clave') && withMode.hits.some((h) => h.snap === 'note') && !son.hits.some((h) => h.snap === 'clave') && !part.hits.some((h) => h.snap === 'clave'));
  check('a bad perc throws', throws(() => arrangeDrums(spec, { perc: 'cowbell' }), /perc must be one of clave, pattern/));
}

// ── a chart's split bars ──
console.log('\n— a chart\'s split bars');
{
  const bad = []; let split = 0;
  for (const [L, T, changes] of [[[119, 42, 15, 8], 8, [[1, 1], [1], [1, 1], [1]]], [[8, 7, 6, 5], 4, [[1, 1], [1]]], [[768, 784], 8, [[1, 1], [2, 1], [1], [1, 1, 1, 1]]], [[41, 42, 43], 8, [[1, 3], [1], [1, 1], [1]]]]) {
    for (const compRelation of ['sync', 'fill']) {
      const spec = compose(L, T, { seed: 1, changes, overrides: { compRelation } }), G = geometry(spec);
      const why = auditLaid(spec, G, spec.clave) || auditLaid(spec, G, spec.clave.partner) || auditComp(spec); if (why) bad.push(`${L.join(':')} ${J(changes)}: ${why}`);
      const comp = spec.parts.find((p) => p.id === 'comp');
      for (const s of spec.clave.strokes) { const c = spec.chords.find((x) => s.slot >= x.from && s.slot < x.from + x.slots); if (spec.chords.filter((x) => x.bar === c.bar).length > 1) split++; if (Math.floor(s.place + EPS) < c.from || Math.floor(s.place + EPS) >= c.from + c.slots) bad.push(`${L.join(':')}: a step landed outside the span its place is in`); }
      for (const n of comp.notes) { const c = spec.chords.find((x) => n.slot >= x.from && n.slot < x.from + x.slots); if (!c || n.bar !== c.bar) bad.push(`${L.join(':')}: a comp tone outside its span`); }
    }
  }
  check(`8 charts with split bars: every step lands inside the span its place falls in, the comp strums that span's chord (${split} strokes in split bars)`, !bad.length && split > 0, bad.slice(0, 3).join('; '));
}

// ── overrides, determinism ──
console.log('\n— overrides and determinism');
{
  const son = compose([119, 42, 15, 8], 8, { seed: 1, overrides: { clave: 'son' } }), G = geometry(son);
  check(`clave 'son': the curated two-bar clave, laid a pass each 2 bars (${summary(son)}), the decision "asked"`, son.clave.id === 'son' && son.clave.span === 2 && son.clave.from.pattern === 'son' && !auditLaid(son, G, son.clave) && !auditComp(son) && son.decisions.find((d) => d.what === 'clave').why.startsWith('asked'));
  const own = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { clave: '5:x.x.x' } });
  check('clave \'5:x.x.x\': any steps:pattern, laid as asked', own.clave.id === '5:x.x.x' && own.clave.strokes.length + own.clave.silent === 3 * own.knobs.bars && !auditComp(own));
  check('a bad clave, compRelation, or compLayer under chords throws; clave under notes throws', throws(() => compose([8, 7, 6, 5], 4, { overrides: { clave: '3:xxxx' } }), /is not a clave/) && throws(() => compose([8, 7, 6, 5], 4, { overrides: { compRelation: 'hocket' } }), /compRelation must be one of sync, fill/)
    && throws(() => compose([8, 7, 6, 5], 4, { overrides: { compLayer: 'A' } }), /compLayer is compStyle 'notes''s/) && throws(() => compose([8, 7, 6, 5], 4, { overrides: { compStyle: 'notes', clave: 'son' } }), /are compStyle 'chords''s/));
  let det = 0; for (const [L, T] of ROWS) if (J(compose(L, T, { seed: 3, trace: true })) === J(compose(L, T, { seed: 3, trace: true }))) det++;
  check(`deterministic: ${det}/${ROWS.length} rows byte-identical twice (trace on)`, det === ROWS.length);
  const t = compose([426, 317, 285], 8, { seed: 2, trace: true }), { trace, ...rest } = t, off = compose([426, 317, 285], 8, { seed: 2 });
  const ev = trace.events.find((e) => e.kind === 'part' && e.part === 'comp');
  check(`the trace never steers it, and carries the clave, its partner and the ${ev.alternates.length} alternates (the top 12, then the curated)`, J(rest) === J(off) && ev.clave.id === t.clave.id && ev.partner.pattern === t.clave.partner.pattern && J(ev.alternates.slice(-3).map((x) => x.id)) === J(CURATED_NAMES) && ev.alternates.some((x) => x.id === t.clave.id));
  // the sounds' draws did not move: the comp's ties by a generator of its own
  const a = compose([8, 7, 6, 5], 4, { seed: 9 }), b = compose([8, 7, 6, 5], 4, { seed: 9, overrides: { clave: 'bossa' } });
  check('the clave\'s draws are its own: another clave leaves every sound and the phase as they were', J(['lead', 'chords', 'comp', 'bass', 'inner'].map((id) => a.parts.find((p) => p.id === id).sound)) === J(['lead', 'chords', 'comp', 'bass', 'inner'].map((id) => b.parts.find((p) => p.id === id).sound)) && J(a.knobs.phase) === J(b.knobs.phase));
  const notes = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compStyle: 'notes' } });
  check('compStyle \'notes\': no clave, no clave decision, no clave perc', notes.clave === undefined && !notes.decisions.some((d) => d.what === 'clave' || d.what === 'compRelation') && !notes.drums.hits.some((h) => h.snap === 'clave') && notes.stats.compLayer && notes.stats.clave === undefined);
}

// ── a chord swap keeps the clave ──
console.log('\n— a chord swap re-strums the bar\'s clave strokes; the clave never moves');
{
  const bad = []; let swaps = 0;
  for (const [L, T, compRelation] of [[[8, 7, 6, 5], 4, 'sync'], [[119, 42, 15, 8], 8, 'fill'], [[768, 784], 8, 'sync'], [[19, 17, 16, 15], 3, 'fill']]) {
    const full = compose(L, T, { seed: 1, trace: {}, overrides: { compRelation } }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
    const h = trace.events.find((e) => e.kind === 'harmony'), evs = trace.events.filter((e) => e.kind === 'chord' && e.round === h.chosenRound);
    for (const ev of evs) for (const cand of ev.candidates.slice(0, 3)) {
      if (cand === ev.candidates[ev.pickIndex]) continue;
      const next = applyRearrange(spec, rearrange(spec, row, cells, { bar: ev.bar, chord: cand })); swaps++;
      if (J(next.clave) !== J(spec.clave)) bad.push(`${L.join(':')} bar ${ev.bar}: the clave moved`);
      const why = auditComp(next); if (why) bad.push(`${L.join(':')} bar ${ev.bar}: ${why}`);
      const S = spec.knobs.slotsPerBar, src = new Set(compNodesOf(spec.clave, ev.bar * S, (ev.bar + 1) * S));
      const was = spec.parts.find((p) => p.id === 'comp').strokes.filter((x) => x.bar === ev.bar && src.has(x.node)).map((x) => x.node);
      const now = next.parts.find((p) => p.id === 'comp').strokes.filter((x) => x.bar === ev.bar && src.has(x.node)).map((x) => x.node);
      if (J(was) !== J(now)) bad.push(`${L.join(':')} bar ${ev.bar}: the bar's clave strokes moved`);
      const perc = (s) => J(s.drums.hits.filter((x) => x.snap === 'clave'));
      if (perc(next) !== perc(spec)) bad.push(`${L.join(':')} bar ${ev.bar}: the clave's perc moved`);
    }
  }
  check(`${swaps} chord swaps: the clave and its perc byte for byte, the bar's strokes the same onsets, the comp still the clave's`, !bad.length && swaps > 10, bad.slice(0, 3).join('; '));
}

// ── the live clave step (phase E) ──
console.log('\n— the live clave step (rearrange.js reclave): equal to a Compose given the clave and the relation');
/** a reclave against the Compose it stands for: [comp, drums, clave, stats.clave, compStrum] all the same? */
const sameAsCompose = (got, want) => {
  const pc = (s) => J(s.parts.find((p) => p.id === 'comp'));
  return pc(got) === pc(want) && J(got.drums) === J(want.drums) && J(got.clave) === J(want.clave) && J(got.stats.clave) === J(want.stats.clave) && got.stats.compStrum === want.stats.compStrum
    && J(got.parts.filter((p) => p.id !== 'comp')) === J(want.parts.filter((p) => p.id !== 'comp'));
};
{
  const bad = []; let n = 0;
  const cases = [[[8, 7, 6, 5], 4, {}], [[19, 17, 16, 15], 3, {}], [[16, 12, 9], 4, {}], [[119, 42, 15, 8], 8, {}], [[768, 769], 8, {}], [[768, 784], 8, {}],
    [[19, 17, 16, 15], 6, { changes: [[1, 1], [1], [2, 1], [1]] }], [[8, 7, 6, 5], 4, { changes: [[1, 1], [1]] }],
    [[41, 42, 43], 8, { target: { clip: decodeClip(readMidi(clipBytes(CLIPS.find((c) => c.name === 'ode-to-joy')))) } }]];
  for (const [L, T, extra] of cases) {
    const full = compose(L, T, { seed: 1, trace: true, ...extra }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
    const ev = trace.events.find((e) => e.kind === 'part' && e.part === 'comp');
    const tries = [...ev.alternates.slice(0, 4).map((a) => [a.id, 'sync']), ...ev.alternates.slice(1, 3).map((a) => [a.id, 'fill']), ['son', 'sync'], ['rumba', 'fill'], ['bossa', 'sync'], [null, 'fill'], ['5:x.x.x', 'sync']];
    for (const [clave, relation] of tries) {
      n++;
      const got = applyRearrange(spec, reclave(spec, row, cells, { clave, relation }));
      const want = compose(L, T, { seed: 1, ...extra, overrides: { ...(clave ? { clave } : {}), compRelation: relation } });
      if (!sameAsCompose(got, want)) bad.push(`${L.join(':')}${extra.changes ? ' (chart)' : extra.target ? ' (target)' : ''} ${clave ?? 'its own'} ${relation}`);
    }
  }
  check(`${n} switches over 6 rows, 2 charts and a MIDI target: comp, drums, every other part, spec.clave, its stats and the strum's share byte for byte a Compose's with that clave and relation`, !bad.length, bad.slice(0, 4).join('; '));
  const full = compose([119, 42, 15, 8], 8, { seed: 1, trace: true }), { trace, ...spec } = full, { row, cells } = materialsOf(spec);
  const untouched = J(spec), a = reclave(spec, row, cells, { clave: 'son', relation: 'fill' }), b = reclave(spec, row, cells, { clave: 'son', relation: 'fill' });
  check('deterministic; the spec untouched; nothing but the comp, the drums, the clave, its stats and decisions moves', J(a) === J(b) && J(spec) === untouched
    && J(a.chords) === J(spec.chords) && J(a.modulations) === J(spec.modulations) && a.retunedBars.length === 0 && J(Object.keys(a.changed).filter((id) => a.changed[id].length)) === J(['comp']));
  const sw = applyRearrange(spec, a), dec = (s, w) => s.decisions.find((d) => d.what === w);
  check(`its decisions said again ("${dec(sw, 'clave').why.slice(0, 60)}…"), the rest as composed`, dec(sw, 'clave').value === 'son' && /chosen in the window/.test(dec(sw, 'clave').why) && dec(sw, 'compRelation').value === 'fill' && dec(sw, 'compStrum').value === sw.stats.compStrum
    && J(sw.decisions.filter((d) => !['clave', 'compRelation', 'compStrum'].includes(d.what))) === J(spec.decisions.filter((d) => !['clave', 'compRelation', 'compStrum'].includes(d.what))));
  const back = applyRearrange(sw, reclave(sw, row, cells, { clave: spec.clave.id, relation: 'sync' }));
  check('switched back to its own clave and Sync: the composed comp, drums and clave byte for byte', J(back.parts) === J(spec.parts) && J(back.drums) === J(spec.drums) && J(back.clave) === J(spec.clave) && back.stats.compStrum === spec.stats.compStrum);
  const viaRearrange = applyRearrange(spec, rearrange(spec, row, cells, { relation: 'fill' })), viaWorker = answer({ id: 1, kind: 'rearrange', spec, edit: { clave: 'rumba' } });
  check('through rearrange ({ clave, relation }: the worker\'s door) the same step', J(viaRearrange) === J(applyRearrange(spec, reclave(spec, row, cells, { relation: 'fill' }))) && viaWorker.ok && J(viaWorker.result) === J(reclave(spec, row, cells, { clave: 'rumba' })));
  const notes = compose([8, 7, 6, 5], 4, { seed: 1, overrides: { compStyle: 'notes' } }), nm = materialsOf(notes);
  check('compStyle \'notes\' refused (no clave); a bad relation or clave throws', throws(() => reclave(notes, nm.row, nm.cells, { relation: 'fill' }), /comps in notes/) && throws(() => reclave(spec, row, cells, { relation: 'hocket' }), /a relation is one of sync, fill/)
    && throws(() => reclave(spec, row, cells, { clave: '3:xxxx' }), /is not a clave/));
  const son = claveOf('son'), mined = { steps: 4, pattern: '.xx.', from: { layer: 8, name: 'A', size: 4, set: 'tone:7/4' } };
  check(`the window's words: "${claveText(son)}", "${claveSource(mined)}", "${claveSource({ from: { pattern: 'bossa' } })}", "${claveSetText('step:10')}"`, claveText(son) === 'x..x..x. ..x.x...' && claveText(mined) === '.xx.' && claveSource(mined) === 'from layer A · 4 steps'
    && claveSource({ from: { pattern: 'son' } }) === 'son clave 3-2' && claveSource({ from: { pattern: 'bossa' } }) === 'bossa\'s rim' && claveSource({ from: { asked: true } }) === 'asked' && claveSetText('rest') === 'every tone but 1/1');
}

// ── the 16k row ──
console.log('\n— the 16,359-onset row');
{
  const L = [4099, 4093, 4091, 4079], T = 16, row = buildRow(L);
  compose(L, T, { seed: 1 });
  let t0 = performance.now(); const rh = readRhythm(row), R = rankRowClaves(rh), tRank = performance.now() - t0;
  t0 = performance.now(); const ch = chooseClave(rh, { ranks: R, rng: () => 0.5 }), tPartners = performance.now() - t0;
  t0 = performance.now(); const lean = compose(L, T, { seed: 1 }), tLean = performance.now() - t0;
  t0 = performance.now(); const fill = compose(L, T, { seed: 1, overrides: { compRelation: 'fill' } }), tFill = performance.now() - t0;
  t0 = performance.now(); const notes = compose(L, T, { seed: 1, overrides: { compStyle: 'notes' } }), tNotes = performance.now() - t0;
  console.log(`    · 16k sync: ${summary(lean)}; fill: ${fill.parts.find((p) => p.id === 'comp').strokes.length} strokes, ${(100 * fill.stats.compStrum).toFixed(0)} % from the row; tier ${R.tier}, ${R.ranked.tried} claves`);
  const G = geometry(lean);
  check(`16k: laid and landed by the rule, sync and fill`, !auditLaid(lean, G, lean.clave) && !auditLaid(lean, G, lean.clave.partner) && !auditComp(lean) && !auditComp(fill), auditLaid(lean, G, lean.clave) || auditComp(lean) || auditComp(fill));
  check(`16k: the clave's own cost — the table ranked ${tRank.toFixed(0)} ms, the partners ${tPartners.toFixed(0)} ms (under 300 ms together); tier '${R.tier}'`, tRank + tPartners < 300 && R.tier === 'every' && ch.clave.id);
  check(`16k: Compose lean ${tLean.toFixed(0)} ms (sync), ${tFill.toFixed(0)} ms (fill), ${tNotes.toFixed(0)} ms (notes) — under 1.5 s`, tLean < 1500 && tFill < 1500);
  // the live step: Sync | Fill re-strums only; another clave ranks the row once (kept per row), then lays and strums
  const { row: r16, cells: c16 } = materialsOf(lean), alt = R.ranked.candidates.find((c) => c.id !== lean.clave.id);
  t0 = performance.now(); const relOnly = reclave(lean, r16, c16, { relation: 'fill' }), tRel = performance.now() - t0;
  t0 = performance.now(); reclave(lean, r16, c16, { clave: alt.id }); const tFirst = performance.now() - t0;
  t0 = performance.now(); const cl = reclave(lean, r16, c16, { clave: 'son', relation: 'fill' }), tNext = performance.now() - t0;
  const wantFill = sameAsCompose(applyRearrange(lean, relOnly), fill), wantSon = sameAsCompose(applyRearrange(lean, cl), compose(L, T, { seed: 1, overrides: { clave: 'son', compRelation: 'fill' } }));
  console.log(`    · 16k live step: Sync → Fill ${tRel.toFixed(1)} ms; another clave ${tFirst.toFixed(1)} ms (the row ranked once), then ${tNext.toFixed(1)} ms`);
  check(`16k live step: Fill ${tRel.toFixed(0)} ms, a clave ${tFirst.toFixed(0)} ms the first time and ${tNext.toFixed(0)} ms after (each under 150 ms, a tenth of a Compose), equal to Compose's`, tRel < 150 && tFirst < 150 && tNext < 150 && wantFill && wantSon);
}

console.log(PASS ? `\n✓✓✓ THE CLAVE PASSES (${checks} checks)` : `\n✗ THE CLAVE FAILED`);
process.exit(PASS ? 0 : 1);
