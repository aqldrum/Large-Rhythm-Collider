// chord-symbols.js — the typed progression field: chord symbols read the way the site reads them, then resolved bar by
// bar against a row's own tones (step 4b, 2026-10-25; Avery's decisions 3 and 4 of STEP4_ORDER.md, the rest proposed).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
//   parse      `parseChordSymbol(text)`: a port of the site's ProgressionSolver.parseChordSymbol (accidentals ♯ ♭ 𝄪 𝄫,
//              suffixes Δ − ° ø, 6/9, alterations, add/no/omit, slash bass), the same fields, plus `bass` (the slash
//              bass's class, or absent). Parity with the site's parser is tested (assert-chord-symbols.mjs).
//   tokenize   `tokenizeField(text)`: the site's tokenizer (`|`, `,`, `;`, tabs and newlines are spaces), each token with
//              its character span so a UI can mark it inline. Two marks of the Composer's own (proposed): an AUTO
//              token ('-', '.', '_', '?', 'auto') leaves its bar to Compose; a trailing '*' ('D*') pins the root and
//              leaves the quality to Compose (what a ratio pick from the lab is).
//   (materials, resolution and the display helpers: their own header, below the parser)

import { buildRow, isRow, toneGate, ONSET_GATE, MIN_TONES } from './row.js';
import { buildCells } from './cells.js';
import { defaultRoot, toneIndexOf, classOfCents, PRESENCE_MODES, DEFAULT_FRAME_CENTS_EACH_SIDE } from './frame.js';
import { downbeats } from './lines.js';
import { chooseMeter, seededRandom } from './compose.js';
import { CHORD_QUALITIES, PC_NAMES } from './harmony.js';
import { rootCandidates, chooseChordOnRoot, qualityById, isFallbackQuality, FALLBACK_QUALITIES, MAX_MISSING, COMPOSER_PROGRESSION_VERSION } from './progression.js';

const NOTE_BASE = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const toFinite = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const mod12 = (v) => ((Math.trunc(toFinite(v, 0)) % 12) + 12) % 12;

const normalizeAccidentals = (v) => String(v ?? '')
  .replaceAll('♯', '#').replaceAll('♭', 'b').replaceAll('𝄪', '##').replaceAll('𝄫', 'bb');
const normalizeChordSuffix = (v) => normalizeAccidentals(v)
  .replaceAll('Δ', 'maj').replaceAll('∆', 'maj').replaceAll('−', 'm').replaceAll('–', 'm')
  .replaceAll('-', 'm').replaceAll('°', 'dim').replaceAll('ø', 'm7b5').replace(/[()[\]\s]/g, '');

function degreeBaseSemitone(d) {
  const n = Number(d);
  if (n === 1) return 0;
  if (n === 2 || n === 9) return 2;
  if (n === 3 || n === 10) return 4;
  if (n === 4 || n === 11) return 5;
  if (n === 5 || n === 12) return 7;
  if (n === 6 || n === 13) return 9;
  if (n === 7 || n === 14) return 11;
  return null;
}
function alteredDegreeSemitone(acc, degree) {
  const base = degreeBaseSemitone(degree);
  if (base === null) return null;
  return mod12(base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0));
}
const addInterval = (set, i) => set.add(mod12(i));
function removeDegree(set, degree) {
  const n = Number(degree);
  if (n === 3 || n === 10) { set.delete(3); set.delete(4); }
  else if (n === 5 || n === 12) { set.delete(6); set.delete(7); set.delete(8); }
  else if (n === 7 || n === 14) { set.delete(9); set.delete(10); set.delete(11); }
  else if (n === 9 || n === 2) { set.delete(1); set.delete(2); set.delete(3); }
  else if (n === 11 || n === 4) { set.delete(5); set.delete(6); }
  else if (n === 13 || n === 6) { set.delete(8); set.delete(9); }
}
function addSeventh(set, { majorSeventh = false, diminishedSeventh = false } = {}) {
  if (majorSeventh) addInterval(set, 11);
  else if (diminishedSeventh) addInterval(set, 9);
  else addInterval(set, 10);
}
/** a note name ('Eb', 'F♯') → { name, pc } | null */
export function parseNoteName(value) {
  const m = normalizeAccidentals(value).match(/^([A-Ga-g])([#b]{0,2})$/);
  if (!m) return null;
  const letter = m[1].toUpperCase(), acc = m[2] || '';
  let pc = NOTE_BASE[letter];
  for (const ch of acc) pc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
  return { name: `${letter}${acc}`, pc: mod12(pc) };
}
const shouldAddSlashBassFifth = (baseIntervals, rootPc, slashBassPc) => baseIntervals.includes(11) && mod12(slashBassPc - rootPc) === 2;

/** a chord suffix ('m7b5', 'maj9', '7#9', 'sus4', '6/9' as '69') → its intervals above the root, sorted */
export function resolveChordIntervals(rawSuffix = '') {
  const lower = normalizeChordSuffix(rawSuffix).toLowerCase();
  const structural = lower
    .replace(/add[#b]?(?:2|4|9|11|13)/g, '')
    .replace(/[b#](?:5|9|11|13)/g, '')
    .replace(/(?:no|omit)(?:3|5|7|9|11|13)/g, '');
  const set = new Set();
  const isHalfDim = /^(m7b5|halfdim)/.test(lower);
  const isDim = !isHalfDim && /^(dim|o)/.test(lower);
  const isAug = /^(aug|\+)/.test(lower) || lower.startsWith('+');
  const isSus2 = /sus2/.test(lower);
  const isSus = !isSus2 && /sus/.test(lower);
  const isPower = structural === '5';
  const isMinor = !isHalfDim && !isDim && /^(m|min|mi)(?!aj)/.test(lower);
  if (isHalfDim) [0, 3, 6, 10].forEach((i) => addInterval(set, i));
  else if (isDim) [0, 3, 6].forEach((i) => addInterval(set, i));
  else if (isAug) [0, 4, 8].forEach((i) => addInterval(set, i));
  else if (isSus2) [0, 2, 7].forEach((i) => addInterval(set, i));
  else if (isSus) [0, 5, 7].forEach((i) => addInterval(set, i));
  else if (isPower) [0, 7].forEach((i) => addInterval(set, i));
  else if (isMinor) [0, 3, 7].forEach((i) => addInterval(set, i));
  else [0, 4, 7].forEach((i) => addInterval(set, i));

  const hasMajorSeventh = /maj(?:7|9|11|13)/.test(lower) || /mmaj(?:7|9|11|13)/.test(lower);
  const hasDimSeventh = isDim && /7/.test(structural);
  const sev = { majorSeventh: hasMajorSeventh, diminishedSeventh: hasDimSeventh };
  if (/69/.test(structural)) { addInterval(set, 2); addInterval(set, 9); }
  else if (/13/.test(structural)) { addSeventh(set, sev); addInterval(set, 2); addInterval(set, 9); }
  else if (/11/.test(structural)) { addSeventh(set, sev); addInterval(set, 2); addInterval(set, 5); }
  else if (/9/.test(structural)) { addSeventh(set, sev); addInterval(set, 2); }
  else if (/7/.test(structural)) addSeventh(set, sev);
  else if (/6/.test(structural)) addInterval(set, 9);

  for (const m of lower.matchAll(/add([#b]?)(2|4|9|11|13)/g)) {
    const s = alteredDegreeSemitone(m[1], m[2]);
    if (s !== null) addInterval(set, s);
  }
  for (const m of lower.matchAll(/([#b])(5|9|11|13)/g)) {
    const degree = m[2], s = alteredDegreeSemitone(m[1], degree);
    if (s === null) continue;
    if (degree === '5') removeDegree(set, 5);
    else if (degree === '9') set.delete(2);
    else if (degree === '11') set.delete(5);
    else if (degree === '13') set.delete(9);
    addInterval(set, s);
  }
  for (const m of lower.matchAll(/(?:no|omit)(3|5|7|9|11|13)/g)) removeDegree(set, m[1]);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * A chord symbol, as the site's ProgressionSolver.parseChordSymbol reads it.
 * → { ok: true, symbol, rootName, rootPc, slashBassName, slashBassPc, suffix, baseIntervals, intervals, pitchClasses,
 *     bass? (the slash bass's class, when there is one) } | { ok: false, symbol, error }
 *   intervals  above the root, the slash bass among them (and its fifth, for a maj7 over its 9th), as the site has it
 */
export function parseChordSymbol(rawSymbol) {
  const original = String(rawSymbol ?? '').trim();
  if (!original) return { ok: false, symbol: original, error: 'empty chord symbol' };
  let text = normalizeAccidentals(original).replace(/6\/9/ig, '69');
  const slashParts = text.split('/');
  if (slashParts.length > 2 || !slashParts[0]) return { ok: false, symbol: original, error: 'invalid slash chord' };
  text = slashParts[0];
  const slashBass = slashParts[1] ? parseNoteName(slashParts[1]) : null;
  if (slashParts[1] && !slashBass) return { ok: false, symbol: original, error: 'invalid slash bass' };
  const m = text.match(/^([A-Ga-g])([#b]{0,2})(.*)$/);
  if (!m) return { ok: false, symbol: original, error: 'missing note root' };
  const letter = m[1].toUpperCase(), acc = m[2] || '', suffix = normalizeChordSuffix(m[3] || '');
  let rootPc = NOTE_BASE[letter];
  for (const ch of acc) rootPc += ch === '#' ? 1 : ch === 'b' ? -1 : 0;
  rootPc = mod12(rootPc);
  const baseIntervals = resolveChordIntervals(suffix);
  const pcSet = new Set(baseIntervals.map((i) => mod12(rootPc + i)));
  if (slashBass) {
    pcSet.add(slashBass.pc);
    if (shouldAddSlashBassFifth(baseIntervals, rootPc, slashBass.pc)) pcSet.add(mod12(slashBass.pc + 7));
  }
  const intervals = Array.from(pcSet).map((pc) => mod12(pc - rootPc)).sort((a, b) => a - b);
  return {
    ok: true, symbol: original, rootName: `${letter}${acc}`, rootPc,
    slashBassName: slashBass?.name || null, slashBassPc: slashBass?.pc ?? null,
    suffix, baseIntervals, intervals, pitchClasses: intervals.map((i) => mod12(rootPc + i)),
    ...(slashBass ? { bass: slashBass.pc } : {}),
  };
}

/** tokens that leave their bar to Compose (proposed) */
export const AUTO_TOKENS = Object.freeze(['-', '–', '—', '.', '_', '?', 'auto']);
/** a trailing mark that pins the root and leaves the quality to Compose ('D*'; proposed) */
export const FREE_QUALITY_MARK = '*';
const SEPARATORS = /[|,;\n\r\t ]/;

/**
 * A whole field, one symbol a bar: split as the site's tokenizeProgression splits (`|`, `,`, `;`, tabs, newlines and
 * spaces all separate), each token with its span. → [{ text, index (the token's place), start, end (characters) }]
 */
export function tokenizeField(text) {
  const s = String(text ?? ''), out = [];
  let start = -1;
  for (let i = 0; i <= s.length; i++) {
    const sep = i === s.length || SEPARATORS.test(s[i]);
    if (!sep && start < 0) start = i;
    else if (sep && start >= 0) { out.push({ text: s.slice(start, i), index: out.length, start, end: i }); start = -1; }
  }
  return out;
}

/** one token of the field → { kind: 'auto' } | { kind: 'root', parsed } (a '*' mark) | { kind: 'chord', parsed } | { kind: 'error', error } */
export function readToken(text) {
  const t = String(text ?? '').trim();
  if (!t || AUTO_TOKENS.includes(t.toLowerCase())) return { kind: 'auto' };
  const free = t.endsWith(FREE_QUALITY_MARK), body = free ? t.slice(0, -FREE_QUALITY_MARK.length) : t;
  if (free) {
    const n = parseNoteName(body);
    return n ? { kind: 'root', parsed: { ok: true, symbol: t, rootName: n.name, rootPc: n.pc } } : { kind: 'error', error: `"${t}": a '*' follows a bare note name ('D*')` };
  }
  const parsed = parseChordSymbol(body);
  return parsed.ok ? { kind: 'chord', parsed } : { kind: 'error', error: `"${t}": ${parsed.error}` };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   materials  `barMaterials(layers, T, knobs, { row })`: what resolving needs before any compose — the row, the
//              meter, the root, the phase and the cells exactly as Compose builds them for the same knobs (a spec's
//              `knobs`, or Compose's overrides plus `seed`: the phase is the seed's first draw, as in Compose), each
//              bar's tones as harmony.js reads them, and progression.js' `rootCandidates` on that root.
//   resolve    `resolveSymbols(field, materials, { frameCentsEachSide, modulation, keep })`, a bar a symbol:
//                the root  symbols are RELATIVE (decided, 3): C is the composition's base root, as the Composer names
//                          chords, read on the base grid. The candidate cluster of the symbol's class with the least
//                          |dev|, more presence breaking ties; inside the ±frame it is supported. Off the frame
//                          (decided, 4) it is the nearest cluster at any offset, amber with its cents; with modulation
//                          on Compose's own rule may retune there (`mayRetune`), off it stays and is flagged `offGrid`.
//                          Never snapped into the frame. `keep` (the pin list the field was made from) keeps a pinned
//                          ratio that is still of the symbol's class, so the lab's pick and the field stay one list.
//                the quality  the symbol's intervals as a quality of the Composer (exact, else the richest catalog
//                          quality inside them, the rest dropped and said; proposed), tested by chooseChordOnRoot's own
//                          rule on the bar's tones: ✓ (whole), amber 'no ♭7' (one class missing: still kept), or
//                          amber 'fallback' (Compose's own pick over the root, shown without the lead: provisional).
//                bars      more symbols than bars: the extras dropped and flagged; fewer: the rest auto.
//              → per bar the display and the pin, and `pins` ([{ ratio, quality } | null] × N: `compose`'s progression).
//   display    `pinsToField(pins, materials)`: a pin list → the field, in the Composer's chord names (the base root
//              C, sharps, CHORD_QUALITIES' suffixes; a root without a quality 'D*', an auto bar '-', trailing autos
//              cut). With `keep`, field → pins → field and pins → field → pins are both the identity (tested).

export const COMPOSER_CHORD_SYMBOLS_VERSION = 'composer-chord-symbols-v1';
/** a class above a root, as the field names what a bar lacks ('no ♭7'; proposed) */
export const INTERVAL_SHORT = Object.freeze(['root', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♯5', '6', '♭7', '7']);
const EPS = 1e-9;
const mod = (v, n) => ((v % n) + n) % n;
const fail = (what) => { throw new Error(`composer/chord-symbols: ${what}`); };
const devLabel = (d) => (Math.abs(d) < 0.05 ? '' : ` ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}¢`);

/**
 * The bars' material before a compose.
 *   knobs  { seed (1), bars, slotsPerBar, anchors ('partitioned'), phase, frameCentsEachSide (15), root, presence
 *          ('cluster'), modulation (true) }: a spec's `knobs` reproduce its cells; Compose's overrides + seed the
 *          cells that compose would build
 *   opts   { row: a row already built for these layers (skips the build), cells: the spec's own cells (MIDI targets,
 *          phase B: a window spec's are cropped, rearrange.js materialsOf; the knobs alone can't rebuild them) }
 * → { version, row, meter, rootTone, root (ratio), baseCents, frameCentsEachSide, presence, modulation, anchors, phase,
 *     cells, bars: [[{ tone, cents, count, strikes, weight, node }] in the order the slots hold them] × N, candidates }
 *   | { version, refused: true, reason }
 */
export function barMaterials(layers, cycleSeconds, knobs = {}, { row: given = null, cells: givenCells = null } = {}) {
  const k = knobs ?? {};
  const row = given ?? buildRow(layers, { gate: ONSET_GATE });
  if (!isRow(row)) return { version: COMPOSER_CHORD_SYMBOLS_VERSION, refused: true, reason: row?.tooDense ? 'tooDense' : 'tooLarge' };
  if (toneGate(row, MIN_TONES)) return { version: COMPOSER_CHORD_SYMBOLS_VERSION, refused: true, reason: 'tooFewTones' };
  if (!(Number.isFinite(cycleSeconds) && cycleSeconds > 0)) fail(`cycleSeconds must be a positive number, not ${cycleSeconds}`);
  const e = k.frameCentsEachSide ?? DEFAULT_FRAME_CENTS_EACH_SIDE, presence = k.presence ?? 'cluster';
  if (!PRESENCE_MODES.includes(presence)) fail(`presence must be one of ${PRESENCE_MODES.join(', ')}`);
  const rootTone = k.root != null ? toneIndexOf(row, k.root) : defaultRoot(row, e, { presence });
  const meter = chooseMeter(row.n, cycleSeconds, { bars: k.bars ?? null, slotsPerBar: k.slotsPerBar ?? null });
  const anchors = k.anchors ?? 'partitioned', P = meter.bars * meter.slotsPerBar;
  let phase = k.phase;
  if (!phase) {   // Compose's own draw: the seed's first, over the root's first three downbeats
    const beats = downbeats(row, P, 3, rootTone, { anchors, cluster: presence === 'cluster' ? e : null });
    phase = beats[Math.floor(seededRandom(k.seed ?? 1)() * beats.length)];
  }
  const cells = givenCells ?? buildCells(row, { bars: meter.bars, slotsPerBar: meter.slotsPerBar, anchors, phase });
  // each bar's tones from the cells' windows, as harmony.js' bar material reads them
  const maps = Array.from({ length: cells.bars }, () => new Map());
  for (const s of cells.slots) for (const t of s.tones) {
    const m = maps[s.bar];
    if (!m.has(t.tone)) m.set(t.tone, { tone: t.tone, cents: row.toneCents[t.tone], count: 0, strikes: 0, weight: 0, node: t.node });
    const x = m.get(t.tone); x.count += t.count; x.strikes += t.strikes; x.weight = x.count + x.strikes;
  }
  const candidates = rootCandidates(row, { frameCentsEachSide: e, presence, root: rootTone });
  return { version: COMPOSER_CHORD_SYMBOLS_VERSION, row, meter, rootTone, root: row.tones[rootTone], baseCents: row.toneCents[rootTone], frameCentsEachSide: e, presence,
    modulation: k.modulation ?? true, anchors, phase, cells, bars: maps.map((m) => [...m.values()]), candidates: candidates.candidates };
}

/**
 * A symbol's intervals as one of the Composer's qualities: exact (CHORD_QUALITIES, then the fallbacks), else the
 * richest catalog quality inside them (more classes, then catalog order; proposed), the rest dropped.
 * → { quality: id | null, exact, dropped: [interval] }
 */
export function qualityOfIntervals(intervals) {
  const want = [...new Set(intervals.map((i) => mod(i, 12)))].sort((a, b) => a - b), key = want.join();
  const exact = [...CHORD_QUALITIES, ...FALLBACK_QUALITIES].find((q) => q.intervals.join() === key);
  if (exact) return { quality: exact.id, exact: true, dropped: [] };
  let best = null;
  for (const q of CHORD_QUALITIES) if (q.intervals.every((i) => want.includes(i)) && (!best || q.intervals.length > best.intervals.length)) best = q;
  if (!best) for (const q of FALLBACK_QUALITIES) if (q.intervals.every((i) => want.includes(i))) { best = q; break; }
  return best ? { quality: best.id, exact: false, dropped: want.filter((i) => !best.intervals.includes(i)) } : { quality: null, exact: false, dropped: want };
}

/** a quality's suffix in the Composer's chord names ('' major, 'm7', …; the fallbacks' '5', 'no5', 'mno5', 'no3no5') */
const suffixOf = (id) => qualityById(id)?.suffix ?? '';

/** the candidate a symbol's root class resolves to, on the base grid → { cand, dev (signed, from the class's centre) } */
function rootFor(pc, candidates, keepTone, row, baseCents) {
  if (keepTone != null) {
    const c = classOfCents(row.toneCents[keepTone] - baseCents);
    if (c.pc === pc) return { cand: candidates.find((x) => x.tone === keepTone) ?? { tone: keepTone, ratio: row.tones[keepTone], cents: row.toneCents[keepTone], pc: c.pc, dev: c.dev, presence: row.toneCount[keepTone], kept: true }, dev: c.dev, kept: true };
  }
  let best = null, bestDev = 0;
  for (const x of candidates) {
    // in the class: its own deviation; any other: the signed way round the circle from the class's centre
    const dev = x.pc === pc ? x.dev : mod(x.fromRoot - 100 * pc + 600, 1200) - 600;
    const better = !best || Math.abs(dev) < Math.abs(bestDev) - EPS || (Math.abs(Math.abs(dev) - Math.abs(bestDev)) <= EPS && (x.presence > best.presence || (x.presence === best.presence && x.tone < best.tone)));
    if (better) { best = x; bestDev = dev; }
  }
  return { cand: best, dev: bestDev, kept: false };
}

/** the bar's weight of each class over a root, read in its ±frame (chooseChordOnRoot's own reading) */
function classesOver(tones, rootCents, e) {
  const w = new Float64Array(12);
  for (const t of tones) { const c = classOfCents(t.cents - rootCents); if (Math.abs(c.dev) <= e + EPS) w[c.pc] += t.weight; }
  return w;
}

/**
 * The field read against a composition's bars.
 *   field      a string ('Cmaj7 Am7 Dm7 G7', '|' or ',' separated too) or tokenizeField's tokens
 *   materials  barMaterials'
 *   opts       { frameCentsEachSide, modulation (materials' by default), keep: a pin list the field came from }
 * → { version, bars, ok (nothing amber, dropped or wrong), pins: [{ ratio, quality } | null] × N, notes: [what was
 *     dropped, padded or not read], extras: [{ text, index, start, end }], perBar: [{
 *       bar, token ({ text, index, start, end } | null), kind ('auto' | 'chord' | 'root' | 'error'), status ('auto' |
 *       'ok' | 'amber' | 'error'), error?, symbol?, name (the chord as the Composer names it: base root C, sharps),
 *       root?: { tone, ratio, cents, pc, dev, label ('D +6.2¢'), inFrame, presence, kept, offGrid, mayRetune },
 *       quality?: { asked (id | null), exact, dropped: [interval], support ('whole' | 'missing' | 'fallback' | 'free'),
 *         missing: [interval], label ('✓' | 'no ♭7' | 'fallback: Dm' | ''), fallback?: { quality, name } },
 *       amber: [why], pin }] }
 *   | { version, refused: true, reason }
 */
export function resolveSymbols(field, materials, { frameCentsEachSide = null, modulation = null, keep = null } = {}) {
  if (!materials || materials.refused) return { version: COMPOSER_CHORD_SYMBOLS_VERSION, refused: true, reason: materials?.reason ?? 'noMaterials' };
  const { row, baseCents, candidates } = materials, N = materials.cells.bars;
  const e = frameCentsEachSide ?? materials.frameCentsEachSide, mods = modulation ?? materials.modulation;
  const tokens = typeof field === 'string' || field == null ? tokenizeField(field) : field;
  const notes = [], extras = tokens.slice(N);
  if (extras.length) notes.push(`${tokens.length} symbols for ${N} bars: ${extras.map((t) => `"${t.text}"`).join(', ')} dropped`);
  else if (tokens.length && tokens.length < N) notes.push(`${tokens.length} symbol${tokens.length === 1 ? '' : 's'} for ${N} bars: bar${N - tokens.length > 1 ? 's' : ''} ${tokens.length + 1}${N - tokens.length > 1 ? `–${N}` : ''} auto`);
  const perBar = Array.from({ length: N }, (_, k) => {
    const token = tokens[k] ?? null, read = readToken(token?.text);
    if (read.kind === 'auto') return { bar: k, token, kind: 'auto', status: 'auto', name: '', amber: [], pin: null };
    if (read.kind === 'error') { notes.push(`bar ${k + 1}: ${read.error}, so auto`); return { bar: k, token, kind: 'error', status: 'error', error: read.error, name: '', amber: [read.error], pin: null }; }
    const sym = read.parsed, keepTone = keep?.[k]?.ratio != null ? row.tones.indexOf(keep[k].ratio) : -1;
    const { cand, dev, kept } = rootFor(sym.rootPc, candidates, keepTone >= 0 ? keepTone : null, row, baseCents);
    const amber = [], inFrame = Math.abs(dev) <= e + EPS;
    const root = { tone: cand.tone, ratio: cand.ratio, cents: cand.cents, pc: sym.rootPc, dev, label: `${PC_NAMES[sym.rootPc]}${devLabel(dev)}`, inFrame, presence: cand.presence, kept,
      offGrid: !inFrame && !mods, mayRetune: !inFrame && mods };
    if (!inFrame) amber.push(`${root.label}: off the ±${e}¢ frame${mods ? ', so Compose may retune there' : ' and modulation is off, so it stays unretuned (offGrid)'}`);
    // the quality: a chord's own, or Compose's for a bare root ('D*')
    const tones = materials.bars[k], w = classesOver(tones, cand.cents, e), lacks = (q) => q.intervals.filter((i) => !(w[i] > 0));
    let quality;
    if (read.kind === 'root') quality = { asked: null, exact: true, dropped: [], support: 'free', missing: [], label: '' };
    else {
      const m = qualityOfIntervals(sym.intervals);
      quality = { asked: m.quality, exact: m.exact, dropped: m.dropped, support: 'free', missing: [], label: '' };
      if (m.dropped.length) amber.push(`${sym.symbol}: the Composer has no ${m.quality ? `quality with its ${m.dropped.map((i) => INTERVAL_SHORT[i]).join(', ')}, so ${PC_NAMES[sym.rootPc]}${suffixOf(m.quality)}` : 'quality inside it, so Compose\'s'}`);
      if (m.quality) {
        const q = qualityById(m.quality), short = lacks(q), ok = isFallbackQuality(q) ? short.every((i) => i === 0) : short.length <= MAX_MISSING;
        quality.missing = short;
        if (ok && !short.length) { quality.support = 'whole'; quality.label = '✓'; }
        else if (ok) { quality.support = 'missing'; quality.label = `no ${short.map((i) => INTERVAL_SHORT[i]).join(', ')}`; amber.push(`${PC_NAMES[sym.rootPc]}${q.suffix}: the bar sounds no ${short.map((i) => INTERVAL_SHORT[i]).join(', ')} over its root (kept: one class may be missing)`); }
        else {
          // Compose's own pick over the root, without the lead (provisional: the lead votes in Compose)
          const pick = chooseChordOnRoot(tones, [], { tone: cand.tone, cents: cand.cents, quality: q.id }, { eachSide: e, gridBase: baseCents, modulation: mods });
          const name = `${PC_NAMES[sym.rootPc]}${pick.quality.suffix}`;
          quality.support = 'fallback'; quality.label = `fallback: ${name}`; quality.fallback = { quality: pick.quality.id, name };
          amber.push(`${PC_NAMES[sym.rootPc]}${q.suffix}: the bar lacks its ${short.map((i) => INTERVAL_SHORT[i]).join(', ')}, so Compose's ${name} (provisional)`);
        }
      }
    }
    const name = `${PC_NAMES[sym.rootPc]}${quality.asked ? suffixOf(quality.asked) : read.kind === 'root' ? FREE_QUALITY_MARK : ''}`;
    return { bar: k, token, kind: read.kind, status: amber.length ? 'amber' : 'ok', symbol: sym, name, root, quality, amber, pin: { ratio: cand.ratio, quality: quality.asked } };
  });
  return { version: COMPOSER_CHORD_SYMBOLS_VERSION, progressionVersion: COMPOSER_PROGRESSION_VERSION, bars: N, ok: !extras.length && perBar.every((b) => b.status === 'ok' || b.status === 'auto'),
    pins: perBar.map((b) => b.pin), notes, extras, perBar };
}

/** the field's pins as `compose`'s progression (null when every bar is auto) */
export const progressionOf = (resolved) => (resolved?.pins?.some(Boolean) ? resolved.pins.map((p) => (p ? { ...p } : null)) : null);

/**
 * A pin list (a progression: ratios, { ratio }, { ratio, quality }, or auto) → the field, in the Composer's chord
 * names: the root's class on the base grid (base root C, sharps), the quality's suffix, 'D*' for a root without one,
 * '-' for an auto bar (trailing autos cut), a ratio not of the row '?'. → string
 */
export function pinsToField(pins, materials) {
  if (!Array.isArray(pins) || !materials || materials.refused) return '';
  const { row, baseCents } = materials;
  const words = pins.map((p) => {
    if (p == null || p === '' || p === 'auto') return '-';
    const ratio = typeof p === 'string' ? p : p.ratio ?? p.root, t = row.tones.indexOf(ratio);
    if (t < 0) return '?';
    const pc = classOfCents(row.toneCents[t] - baseCents).pc, q = typeof p === 'object' ? p.quality ?? null : null;
    return `${PC_NAMES[pc]}${q != null ? suffixOf(q) : FREE_QUALITY_MARK}`;
  });
  while (words.length && words[words.length - 1] === '-') words.pop();
  return words.join(' ');
}

/** the field → its pins, kept against the pin list it came from: `resolveSymbols(field, materials, { keep }).pins` */
export const fieldToPins = (field, materials, opts = {}) => resolveSymbols(field, materials, opts).pins;
