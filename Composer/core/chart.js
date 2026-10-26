// chart.js — the typed progression field as a chord chart: bars, several chords to a bar, holds and repeats
// (Composer/CHART_ORDER.md; Avery, 2026-10-26: "multiple chords per bar and repeats", ported from chunk-tunes).
//
// PURE: no fetch, no DOM, no clock. Usable in a page, a worker and Node.
//
// A port of Codex Compiler (dev) overworld/econ/runtime/chunk-timeline.js' chart reader (its notation, its repeat
// signs, its form charts and their errors), onto the Composer's field. What changed on the way in:
//
//   tokens     every chord written in the field keeps its place in the text (`{ text, start, end }`), so the field
//              can be marked inline; a chord a repeat plays again, or a form moves, points at the one written.
//   marks      the field's own marks pass through as chords: '-', '_', '?', 'auto' leave a share to Compose, 'D*' pins
//              a root (chord-symbols.js `readToken`). Only '.' differs from a plain field: in a chart it holds (P3).
//   bars       a span never crosses a bar line here: a chord held into the next bar is that bar's span again, flagged
//              `hold` (P4). Each bar is in its fewest shares: `changes` [[shares] × bars], e.g. | C . G | is [2, 1].
//
// The notation (chunk-timeline's header, word for word where it could be):
//   |      a bar line. The chords written in a bar share it evenly.
//   .      holds the chord before it for one share more, over a bar line too
//   %      the bar before it, again
//   ‖      (or ||) ends a section; ×n (or xn, *n) after a section's last bar plays it n times
//   |: :|  the bars between, twice; :|×n n times in all; a :| with no |: before it repeats from the section's start
//   form   lines (or ;) naming sections, `A: | C | G |`, and `form: A A B A+2` — A+2 is A moved up two semitones, A-3
//          down three; no form line plays the sections once each as written. A chord is moved by its root (and a bass).
//
//   isChart(text)    a bar line, or a named section: the field is a chart (P2); else it is one symbol a bar, as before
//   parseChart(text) → { bars, grid, changes, spans: [{ index, bar, share, shares, symbol, token, hold, section, pass,
//                       name? }], sections: [{ name?, bars, times }] }; throws `composer/chart: …` on a chart it cannot read
//   readChart(text)  → parseChart's, or { error }
//   spread(shares, S) → each share's first slot and its slots, as evenly as whole slots allow (Euclid; ruling 3)
//   writeChart(bars) → a field from bars of words ([[word] × shares]), '.' for a held share, '%' for a bar again

export const COMPOSER_CHART_VERSION = 'composer-chart-v1';
/** a bar divides into at most this many shares (chunk-timeline's MAX_GRID) */
export const MAX_SHARES = 16;

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return Math.abs(a); };
const lcm = (a, b) => (a / gcd(a, b)) * b;
const fail = (what) => { throw new Error(`composer/chart: ${what}`); };
const SIGN = /^[×x*]\d+$/;
const HOLD = '.', AGAIN = '%';
/** a placeholder for the k-th chord written: what the reader below carries in place of the chord's own text */
const MARK = '\u0003';
const isPlaceholder = (s) => typeof s === 'string' && s[0] === MARK;
const isSymbol = (s) => typeof s === 'string' && /^[^\s|‖]+$/.test(s) && s !== HOLD && s !== AGAIN && !SIGN.test(s);

/** a line of a form chart that names a section (`A: | C | G |`) or gives the form; a colon right before a bar line is a repeat sign */
const DEFINITION = /^([A-Za-z][A-Za-z0-9_']*)\s*:(?!\|)\s*(.*)$/;
/** the field's lines, each with where it starts in the text */
function linesOf(text) {
  const out = [], s = String(text ?? '');
  let at = 0;
  for (const piece of s.split(/([\n;])/)) {
    if (piece !== '\n' && piece !== ';') { const lead = piece.length - piece.trimStart().length; if (piece.trim()) out.push({ text: piece.trim(), start: at + lead }); }
    at += piece.length;
  }
  return out;
}
/** is this text a form chart: named sections, and perhaps a form line? */
export const isForm = (text) => linesOf(text).some((l) => DEFINITION.test(l.text));
/** is this text a chart (a bar line, or named sections), and not a plain run of chords? */
export const isChart = (text) => /[|‖]/.test(String(text ?? '')) || isForm(text);

/**
 * Each chord written in a stretch of the text, swapped for a placeholder that keeps its place.
 * → the text with placeholders; `tokens` gets { text, start, end } for each
 */
function markChords(body, offset, tokens) {
  // a comma is a space here (the plain field's separator, so `| Am7, D G7 |` reads as it looks)
  return body.replace(/[^\s|‖:,]+/g, (word, at) => {
    if (word === HOLD || word === AGAIN || SIGN.test(word) || /^[×x*]$/.test(word) || /^\d+$/.test(word)) return word;
    tokens.push({ text: word, start: offset + at, end: offset + at + word.length });
    return `${MARK}${tokens.length - 1}`;
  }).replace(/,/g, ' ');
}

// the repeat signs, read off the text before `||` is taken for ‖: `|:` opens, `:|` closes (×n after it: n times in all, else twice)
const OPEN = '\u0002', CLOSE = '\u0001';
const markRepeats = (text) => String(text ?? '').replace(/:\|(?:\s*[×x*]\s*(\d+))?/g, (_, n) => ` ${CLOSE}${n ?? 2} |`).replace(/\|:/g, `| ${OPEN} `);
/** one section's text (no ‖ in it, repeat signs marked) → { times, bars: [[token]] }, its repeats played out and each % the bar played before it */
function readPiece(piece) {
  const m = /(?:^|[\s|])[×x*]\s*(\d+)$/.exec(piece), times = m ? Number(m[1]) : 1;
  if (times < 1) fail('a section is played at least once');
  const cells = (m ? piece.slice(0, m.index + (/^[×x*]/.test(m[0]) ? 0 : 1)) : piece).split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  if (!cells.length) fail('a section with no bars');
  const written = [];   // [{ tokens, open, close (times in all, 0: none) }]
  let opening = false, afterClose = false;
  cells.forEach((cell, ci) => {
    let open = false, close = 0;
    const tokens = cell.split(/\s+/).filter((t) => {
      if (t === OPEN) { open = true; return false; }
      if (t[0] === CLOSE) { close = Number(t.slice(1)); return false; }
      return t !== '';
    });
    if (!tokens.length) {
      if (close && !open && written.length && !written[written.length - 1].close) { written[written.length - 1].close = close; afterClose = true; return; }
      if (open && !close) { opening = true; afterClose = false; return; }
      // a bar line written beside a repeat sign, which is a bar line already: | C :| | ×3, | C | |: G
      if (!open && !close && (afterClose || cells[ci + 1]?.trim().startsWith(OPEN))) { afterClose = false; return; }
      fail('an empty bar');
    }
    written.push({ tokens, open: open || opening, close }); opening = false; afterClose = close > 0;
  });
  if (opening) fail('|: opens no bar');
  const played = [];
  let from = null, closed = false;
  for (const w of written) {
    if (w.open) { if (from !== null) fail('a |: inside another'); from = played.length; }
    played.push(w.tokens);
    if (!w.close) continue;
    if (w.close < 2) fail('a repeat plays its bars at least twice');
    if (from === null) { if (closed) fail('a second :| needs a |: of its own'); from = 0; }
    const block = played.slice(from);
    for (let k = 1; k < w.close; k++) played.push(...block);
    from = null; closed = true;
  }
  if (from !== null) fail('a |: is never closed');
  const bars = [];
  for (const tokens of played) {
    if (tokens.includes(AGAIN)) { if (tokens.length > 1 || !bars.length) fail('% stands alone in a bar, after the bar it repeats'); bars.push(bars[bars.length - 1]); continue; }
    for (const t of tokens) if (t !== HOLD && !isSymbol(t)) fail(`"${t}" is not a chord`);
    bars.push(tokens);
  }
  return { times, bars };
}

// ── moving a chord: its root and any bass after a slash, n semitones; spelled in sharps when the section's new key is a sharp one ──
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_KEYS = new Set([7, 2, 9, 4, 11, 6]);   // G D A E B F#
const NOTE = /^([A-Ga-g])([#b♯♭]{0,2})/;
function pcOfNote(text) {
  const m = NOTE.exec(text); if (!m) return null;
  let pc = LETTER[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return { pc: ((pc % 12) + 12) % 12, rest: text.slice(m[0].length) };
}
/** the root of a chord symbol as a pitch class 0..11 (C = 0), or null when it has none to read ('-', '?') */
export const rootOfSymbol = (symbol) => pcOfNote(String(symbol))?.pc ?? null;
/** a chord symbol moved n semitones (a root-less mark, '-' or '?', stays as it is). `sharps`: spell the new notes in sharps (else flats). */
export function transposeSymbol(symbol, n, { sharps = false } = {}) {
  const s = String(symbol), names = sharps ? SHARPS : FLATS, root = pcOfNote(s);
  if (!root) return s;
  const shift = ((n % 12) + 12) % 12;
  if (shift === 0) return s;
  let rest = root.rest;
  const slash = /\/([A-Ga-g][#b♯♭]{0,2})$/.exec(rest);
  if (slash) { const bass = pcOfNote(slash[1]); rest = `${rest.slice(0, slash.index)}/${names[(bass.pc + shift) % 12]}`; }
  return `${names[(root.pc + shift) % 12]}${rest}`;
}
/** the form line → [{ name, shift, times }] in the order played: `A A B A+2`, `A×2`, `A -3`, an entry's ×n beside it */
function readFormLine(text) {
  const out = [];
  for (const token of text.split(/[\s|‖,]+/).filter(Boolean)) {
    const again = /^[×x*](\d+)$/.exec(token);
    if (again) { if (!out.length) fail('a form opens on a section, not on a repeat'); out[out.length - 1].times *= Number(again[1]); continue; }
    const m = /^([A-Za-z][A-Za-z0-9_']*?)(?:([+-])(\d+))?(?:[×*](\d+))?$/.exec(token);
    if (!m) fail(`"${token}" in the form is not a section`);
    const times = m[4] ? Number(m[4]) : 1;
    if (times < 1) fail('a section is played at least once');
    out.push({ name: m[1], shift: m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0, times });
  }
  if (!out.length) fail('an empty form');
  return out;
}
/** a section's name as the form plays it: moved the nearer way round, A+2, A-3 (A+9 is written A-3) */
export const movedName = (name, shift) => { const s = ((shift % 12) + 12) % 12, near = s > 6 ? s - 12 : s; return near === 0 ? name : `${name}${near > 0 ? '+' : ''}${near}`; };

/** the chords of a chart's placeholders, moved: a placeholder → a new one for the moved chord, its token the written one's */
function moveBars(bars, shift, tokens, symbols) {
  if (!(((shift % 12) + 12) % 12)) return bars;
  const firstText = bars.flat().find((t) => isPlaceholder(t) && rootOfSymbol(symbols[Number(t.slice(1))]) != null);
  const first = firstText ? rootOfSymbol(symbols[Number(firstText.slice(1))]) : null, sharps = first != null && SHARP_KEYS.has((((first + shift) % 12) + 12) % 12);
  return bars.map((list) => list.map((t) => {
    if (!isPlaceholder(t)) return t;
    const k = Number(t.slice(1));
    symbols.push(transposeSymbol(symbols[k], shift, { sharps })); tokens.push(tokens[k]);
    return `${MARK}${symbols.length - 1}`;
  }));
}
/** a form chart's lines → read sections [{ name, times, bars }] */
function readForm(lines, tokens, symbols) {
  const defs = new Map(); let form = null;
  for (const line of lines) {
    const m = DEFINITION.exec(line.text);
    if (!m) fail(`"${line.text}" is neither a section (A: | C | G |) nor the form (form: A A B)`);
    if (m[1].toLowerCase() === 'form') { if (form !== null) fail('two form lines'); form = m[2]; continue; }
    if (defs.has(m[1])) fail(`section ${m[1]} is written twice`);
    const bodyAt = line.start + line.text.length - m[2].length, body = markRepeats(markChords(m[2], bodyAt, tokens));
    if (/‖|\|\|/.test(body)) fail(`section ${m[1]} is one section: no ‖ inside it`);
    defs.set(m[1], readPiece(body.trim()));
  }
  for (let k = symbols.length; k < tokens.length; k++) symbols.push(tokens[k].text);
  if (!defs.size) fail('a form with no sections');
  const entries = form === null ? [...defs.keys()].map((name) => ({ name, shift: 0, times: 1 })) : readFormLine(form);
  const read = [];
  for (const e of entries) {
    const def = defs.get(e.name);
    if (!def) fail(`the form plays ${e.name}, which is not written`);
    const name = movedName(e.name, e.shift), times = def.times * e.times, last = read[read.length - 1];
    if (last && last.name === name) { last.times += times; continue; }
    read.push({ name, times, bars: moveBars(def.bars, e.shift, tokens, symbols) });
  }
  return read;
}

/**
 * A chart → its bars, every repeat played out. Throws `composer/chart: …` on a chart it cannot read.
 * → { version, bars, grid (shares to the bar that put every change on a share, over the whole chart), changes: [[shares]
 *     × bars] (each bar in its fewest), spans: [{ index, bar, share (its first share in its bar), shares, symbol,
 *     token: { text, start, end }, hold (a chord held into this bar from the one before), section, pass, name? }],
 *     sections: [{ name?, bars, times }] }
 */
export function parseChart(text) {
  const tokens = [], symbols = [];
  let read;
  if (isForm(text)) read = readForm(linesOf(text), tokens, symbols);
  else {
    const flat = markRepeats(markChords(String(text ?? '').replace(/[\n;]/g, ' '), 0, tokens));
    for (const t of tokens) symbols.push(t.text);
    const pieces = flat.replace(/\|\|/g, '‖').split('‖').map((p) => p.trim());
    if (pieces.length > 1 && pieces[pieces.length - 1] === '') pieces.pop();
    if (pieces.length > 1 && pieces[0] === '') pieces.shift();
    read = pieces.map(readPiece);
  }
  const grid = read.reduce((g, s) => s.bars.reduce((x, list) => lcm(x, list.length), g), 1);
  if (grid > MAX_SHARES) fail(`the bars divide into ${grid}; at most ${MAX_SHARES}`);
  // every share of every bar as played: the chord sounding on it (a hold the one before), section and pass
  const units = [];
  read.forEach((s, si) => {
    for (let pass = 0; pass < s.times; pass++) s.bars.forEach((list) => list.forEach((t) => { for (let u = 0; u < grid / list.length; u++) units.push({ t: u === 0 ? t : HOLD, section: si, pass }); }));
  });
  if (!units.length) fail('no bars');
  if (units[0].t === HOLD) fail('a chart cannot open on a hold');
  // spans: a chord from where it is written to the next chord or the bar line (a hold carried over it starts again, `hold`)
  const B = units.length / grid, spans = [];
  let sounding = null;
  units.forEach((u, i) => {
    const bar = Math.floor(i / grid), at = i % grid;
    if (u.t !== HOLD) sounding = u;
    const open = u.t !== HOLD || at === 0;
    if (open) {
      const k = Number(sounding.t.slice(1)), name = read[sounding.section].name;
      spans.push({ index: spans.length, bar, share: at, shares: 1, symbol: symbols[k], token: { ...tokens[k] }, hold: u.t === HOLD, section: u.section, pass: u.pass, ...(name != null ? { name } : {}) });
    } else spans[spans.length - 1].shares++;
  });
  // each bar in its fewest shares
  const changes = Array.from({ length: B }, () => []);
  for (let b = 0; b < B; b++) {
    const own = spans.filter((sp) => sp.bar === b), g = own.reduce((x, sp) => gcd(x, gcd(sp.share, sp.shares)), grid);
    for (const sp of own) { sp.share /= g; sp.shares /= g; changes[b].push(sp.shares); }
  }
  return { version: COMPOSER_CHART_VERSION, bars: B, grid, changes, spans,
    sections: read.map((s) => ({ ...(s.name != null ? { name: s.name } : {}), bars: s.bars.length, times: s.times })) };
}
/** parseChart's, or { error } (the reason, without the module's prefix) */
export function readChart(text) {
  try { return parseChart(text); } catch (err) { return { error: String(err?.message ?? err).replace(/^composer\/chart: /, '') }; }
}

/** do a meter's S slots split every bar evenly? (ruling 3: prefer even) */
export const evenIn = (changes, S) => changes.every((list) => S % list.reduce((a, b) => a + b, 0) === 0);
/**
 * A bar's shares over S slots, as evenly as whole slots allow: share i opens on slot ⌈(shares before it) · S / total⌉
 * (chunk-timeline's Euclidean spread; ruling 3). → [{ from (slot in the bar), slots }]
 */
export function spread(shares, S) {
  const total = shares.reduce((a, b) => a + b, 0);
  if (!(Number.isInteger(S) && S >= total)) fail(`a bar of ${total} shares needs at least ${total} slots, not ${S}`);
  const at = (c) => Math.ceil((c * S) / total - 1e-9), out = [];
  let c = 0;
  for (const n of shares) { const from = at(c); c += n; out.push({ from, slots: at(c) - from }); }
  return out;
}
/** is this list of changes one chord a bar (nothing split)? */
export const isPlain = (changes) => !changes || changes.every((list) => list.length === 1);

/**
 * Bars of words → a chart: each bar its words, one a share ('.' a held share), '%' for a bar written as the one before
 * (not its first), bar lines between. bars: [[word | null (held)]]. → string
 */
export function writeChart(bars) {
  let before = null;
  const out = bars.map((words) => {
    const text = words.map((w) => w ?? HOLD).join(' '), same = text === before && words[0] != null;
    before = text;
    return same ? AGAIN : text;
  });
  return out.length ? `| ${out.join(' | ')} |` : '';
}
