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
//   (the rest of this file — materials, resolution, the display helpers — follows below its own header)

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
