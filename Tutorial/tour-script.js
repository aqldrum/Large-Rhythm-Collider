// tour-script.js — the guided tour of the main page as data (Composer sprint 2, step 3). PURE: no DOM, no clock, no
// storage of its own. tour-driver.js plays it; Composer/tests/assert-tutorial.mjs checks it. Everything here that
// isn't Avery's opening (the four lines and the order) is proposed, not ruled.
//
//   the opening   "Welcome to the Large Rhythm Collider!" → "This machine eats numbers…" (four 3-digit layers typed
//                 into Rhythm Input) → "…to turn structure…" (Generate; the Linear Plot appears) → "…into music."
//                 (the notation glyph pressed at TOUR_PACE; the theater runs; the performance starts)
//   the tour      while it plays: the part strips, the Scale readout, the advanced Composer behind the double-click,
//                 the Cosmos button, and the glyph back to the row
//
//   generateLayers(seed) → { layers, tones, onsets, tries }    the seeded layer generator (criteria: layerProblems)
//   layerProblems(layers) → [why it's not a tour set]          [] when it is one
//   siteAccepts(layers), composerAccepts(layers)               the site's input rules; Compose's own refusal gates
//   openingBudget({ layers, solveSeconds, sceneSeconds, pace }) → the opening's time, by part (seconds)
//   STEPS · stepById · nextIndex / backIndex · tourStops        the script
//   autoOpen({ storage, search }) · markSeen(storage)           the first visit

import { buildRow, toneGate, isRow, ONSET_GATE, MIN_TONES } from '../Composer/core/row.js';

export const TOUR_VERSION = 'lrc-tour-v1';

// ── the layer generator ──

/** the tour's layers are 3-digit whole numbers */
export const LAYER_RANGE = Object.freeze([100, 999]);
/** the bias (proposed): a set whose row has this many distinct tones. Four random 3-digit layers give hundreds (the
 *  median of 3,000 coprime sets is 437, the tenth percentile 234): a Scale chart hundreds of rows long, and a frame
 *  where every ±15¢ holds a crowd. Twelve to 144 reads as a scale with a shape, and still sounds unlike 12-TET. */
export const TONE_BAND = Object.freeze([12, 144]);
/** the pool the layers are drawn from (proposed): the 3-digit numbers with no prime factor above 7. Their gaps repeat,
 *  so the scale is tens of tones, not hundreds: of 500 valid sets drawn from it, the median row has 85 tones, the tenth
 *  percentile 29 (measured; uniform 3-digit draws land in the band about 2 % of the time). The generator's own sets
 *  (seeds 1–500): tones p10 29, p50 70, p90 124 */
export const SMOOTH_PRIMES = Object.freeze([2, 3, 5, 7]);
export const SMOOTH_POOL = Object.freeze((() => {
  const out = [];
  for (let n = LAYER_RANGE[0]; n <= LAYER_RANGE[1]; n++) {
    let m = n;
    for (const p of SMOOTH_PRIMES) while (m % p === 0) m /= p;
    if (m === 1) out.push(n);
  }
  return out;
})());
/** if no set passes in MAX_TRIES draws (never seen: a set takes about 3.7 draws, half a millisecond), this one: 25 tones, 1,044 onsets */
export const FALLBACK_LAYERS = Object.freeze([480, 320, 252, 175]);
export const MAX_TRIES = 4000;

export const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/** a seeded generator (mulberry32 over an FNV-1a hash of the seed; the Composer's own, core/compose.js) */
export function seededRandom(seed) {
  let h = 0x811c9dc5; const text = String(seed);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * The site takes these layers as typed, unchanged: whole numbers ≥ 1 (the inputs' `min="1"`), at least one, as
 * LRCModule.generateRhythm parses them (parseInt of the typed text), and already in the order the Rhythm Input
 * reorders to (LRCHudController.handleRhythmSubmission sorts greatest to least), so Generate doesn't reshuffle them.
 */
export function siteAccepts(layers) {
  if (!Array.isArray(layers) || layers.length !== 4) return false;
  const parsed = layers.map((v) => parseInt(String(v), 10) || 0);
  if (!parsed.every((v, i) => v === layers[i] && Number.isInteger(v) && v >= 1)) return false;
  return parsed.every((v, i) => i === 0 || parsed[i - 1] >= v);
}

/** Compose's own refusal gates (compose.js refuses exactly these: too dense, too large a grid, too few tones), on the
 *  row Compose would build → { ok, reason, tones, onsets } */
export function composerAccepts(layers) {
  const row = buildRow(layers, { gate: ONSET_GATE });
  if (!isRow(row)) return { ok: false, reason: row.tooDense ? 'tooDense' : 'tooLarge', tones: 0, onsets: row.onsets ?? 0 };
  const few = toneGate(row, MIN_TONES);
  return { ok: !few, reason: few ? 'tooFewTones' : null, tones: row.tones.length, onsets: row.n };
}

/** why these layers aren't a tour set ([] when they are one), with the row's size when it was built */
export function layerProblems(layers, { toneBand = TONE_BAND } = {}) {
  const why = [];
  if (!Array.isArray(layers) || layers.length !== 4) return ['not four layers'];
  if (!layers.every((v) => Number.isInteger(v) && v >= LAYER_RANGE[0] && v <= LAYER_RANGE[1])) why.push('not all 3-digit');
  if (new Set(layers).size !== 4) why.push('not distinct');
  for (const a of layers) for (const b of layers) if (a !== b && a % b === 0) { why.push(`${b} divides ${a}`); break; }
  if (layers.reduce(gcd) !== 1) why.push(`the set shares the factor ${layers.reduce(gcd)}`);
  if (!siteAccepts(layers)) why.push('the Rhythm Input would change them');
  if (why.length) return why;
  const c = composerAccepts(layers);
  if (!c.ok) why.push(`Compose refuses it (${c.reason})`);
  else if (c.tones < toneBand[0] || c.tones > toneBand[1]) why.push(`${c.tones} tones, outside ${toneBand[0]}–${toneBand[1]}`);
  return why;
}

/** four layers for the opening, from a seed (the page seeds it from the clock; the tests from 1..n) */
export function generateLayers(seed, { pool = SMOOTH_POOL, toneBand = TONE_BAND, maxTries = MAX_TRIES } = {}) {
  const rand = seededRandom(seed);
  for (let tries = 1; tries <= maxTries; tries++) {
    const pick = new Set();
    while (pick.size < 4) pick.add(pool[Math.floor(rand() * pool.length)]);
    const layers = [...pick].sort((a, b) => b - a);
    if (layerProblems(layers, { toneBand }).length) continue;
    const c = composerAccepts(layers);
    return { layers, tones: c.tones, onsets: c.onsets, tries, seed };
  }
  const c = composerAccepts([...FALLBACK_LAYERS]);
  return { layers: [...FALLBACK_LAYERS], tones: c.tones, onsets: c.onsets, tries: maxTries, seed, fallback: true };
}

// ── the opening's timing ──

/** the tour's pace for the theater (lens.press({ pace })): the full show is scene.end / pace, 7.5 s → 3.75 s */
export const TOUR_PACE = 2;
/** the opening's beats, ms (proposed). Typing is real: one input event a character. */
export const OPENING_TIMING = Object.freeze({
  glideMs: 350,          // the spotlight's glide from target to target (CSS; overlaps the beats below)
  readMs: 500,           // "This machine eats numbers…" read before the first key
  clearMs: 40,           // a field cleared
  charMs: 55,            // a digit typed
  fieldGapMs: 90,        // the hop to the next field
  afterTypeMs: 250,      // the last digit, then Generate aimed
  generateAimMs: 350,    // the spotlight on Generate before it's pressed
  plotBeatMs: 700,       // "…to turn structure…": the plot seen
  glyphAimMs: 600,       // "…into music.": the glyph lit before it's pressed
  generateTimeoutMs: 4000, // no rhythmGenerated by then: go on anyway
  composerWaitMs: 4000,  // the Composer's module still loading: wait this long for it
});

/** the typing alone, ms: every field cleared, every digit typed, the hops between fields */
export function typingMs(layers, t = OPENING_TIMING) {
  const chars = layers.reduce((n, v) => n + String(v).length, 0);
  return layers.length * t.clearMs + chars * t.charMs + Math.max(0, layers.length - 1) * t.fieldGapMs;
}

/**
 * The opening's time from "Begin" to the performance starting, seconds, by part:
 *   beats   the tour's own pauses (read, aim, plot, glyph)
 *   typing  typingMs
 *   site    LRCModule's generate and the page's rhythmGenerated listeners (measured, or the default)
 *   solve   Compose (the worker, the full table, the trace): not scaled by the pace
 *   show    the theater's full show: sceneSeconds (animationTimeline(trace).seconds, 4–7.5) / pace
 */
export function openingBudget({ layers, solveSeconds, sceneSeconds, pace = TOUR_PACE, siteSeconds = 0.2, timing = OPENING_TIMING } = {}) {
  const t = timing;
  const beats = (t.readMs + t.afterTypeMs + t.generateAimMs + t.plotBeatMs + t.glyphAimMs) / 1000;
  const typing = typingMs(layers, t) / 1000;
  const show = sceneSeconds / (Number(pace) > 0 ? Number(pace) : 1);
  const parts = { beats, typing, site: siteSeconds, solve: solveSeconds, show };
  return { ...parts, total: beats + typing + siteSeconds + solveSeconds + show };
}
/** the target (Avery: "a composition in front of the user in like 5–10 seconds") */
export const OPENING_TARGET_SECONDS = 10;

// ── the script ──
//
// A step: { id, phase ('opening' | 'tour'), action?, title, text, textRow?, targets: [selector, …] (the first one
// on the page wins; the last is always in index.html), then?: [selector] (where the spot goes once the action is
// done; the popup then goes at thenPlace), place ('below' | 'above' | 'right' | 'left' | 'center' | 'top' |
// 'bottom'), reveal?: [selector] (a minimized panel or a
// collapsed Playback section opened for the step, and closed again at the end), needs? ('composition': skipped, or
// left, when the lens is on the row), motion? ('orbit' | 'press' | 'double-click'), peek? (the Composer window can be
// opened from it, and is closed again on leaving), last? }

export const STEPS = Object.freeze([
  {
    id: 'welcome', phase: 'opening',
    title: 'Welcome to the Large Rhythm Collider!',
    text: 'Four numbers in, a composition out — about ten seconds. Then a short look around while it plays.',
    targets: ['#visualization-canvas'], place: 'center', motion: 'orbit',
  },
  {
    id: 'numbers', phase: 'opening', action: 'type',
    title: 'This machine eats numbers…',
    text: 'Four layers, each a pulse on one shared cycle. No layer divides another, and the four share no factor.',
    targets: ['#rhythm-submit-div'], reveal: ['#rhythm-submit-div'], place: 'right',
  },
  {
    id: 'structure', phase: 'opening', action: 'generate',
    title: '…to turn structure…',
    text: 'Generate lays the layers over each other. Every gap between onsets becomes a ratio: a tone of the rhythm\'s own scale.',
    targets: ['#rhythm-form .submit-btn', '#rhythm-submit-div'], then: ['#visualization-canvas'], place: 'right', thenPlace: 'top', motion: 'press',
  },
  {
    id: 'music', phase: 'opening', action: 'compose',
    title: '…into music.',
    text: 'The notation glyph reads the row as a composition: a root, a lead, chords under it, parts and drums.',
    targets: ['#composition-glyph'], place: 'below', motion: 'press',
  },
  {
    id: 'parts', phase: 'tour', needs: 'composition',
    title: 'Part strips',
    text: 'The layer strips became part strips: Lead, Chords, Comping, Bass, Inner, Drums. Pick one to mute it, change its sound or its level. The dot is the layer it\'s read from.',
    targets: ['.composition-part-strips', '#layer-controls-content', '#playback-div'], reveal: ['#playback-div', '#layer-controls-content'], place: 'right',
  },
  {
    id: 'scale', phase: 'tour', needs: 'composition',
    title: 'The scale, as a readout',
    text: 'Scale Selection follows the music now: each bar\'s chord tones light up as it plays. It\'s locked while the composition is choosing.',
    targets: ['#scale-chart-container', '#scale-content', '#playback-div'], reveal: ['#playback-div', '#scale-content'], place: 'right',
  },
  {
    id: 'composer', phase: 'tour',
    title: 'The advanced Composer',
    text: 'Double-click the Playback title for the full window. Its Composer tab edits this same composition: every part, the chord progression, the drums, the tuning.',
    targets: ['#playback-div .info-header', '#playback-div'], place: 'right', motion: 'double-click', peek: true,
  },
  {
    id: 'cosmos', phase: 'tour',
    title: 'Cosmos',
    text: 'Every rhythm as a star. Fly the field, pick one up, and load it here. (Not now: the music\'s playing.)',
    targets: ['#cosmos-enter-btn'], place: 'below',
  },
  {
    id: 'row', phase: 'tour', last: true,
    title: 'Back to the row',
    text: 'The glyph is a lens, not a stop. Press it to go back to the row: the plot, the layers and the scale as they were. The composition is kept, so the next press plays it at once.',
    textRow: 'You\'re on the row. The composition is kept: press the glyph to hear it again, at once.',
    targets: ['#composition-glyph'], place: 'below',
  },
]);

export const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);
export const stepById = (id) => STEPS.find((s) => s.id === id) ?? null;
/** the tour's stops (the part after the opening), in order */
export const tourStops = () => STEPS.filter((s) => s.phase === 'tour');
const usable = (s, lens) => !!s && (s.needs !== 'composition' || lens === 'composition');

/** the step after i (skipping a stop that needs the composition while the lens is on the row) → index, or -1: the end */
export function nextIndex(i, { lens = 'composition', steps = STEPS } = {}) {
  for (let j = i + 1; j < steps.length; j++) if (usable(steps[j], lens)) return j;
  return -1;
}
/** the stop before i, never back into the opening (its steps are actions, not pages) → index, or i: nowhere to go */
export function backIndex(i, { lens = 'composition', steps = STEPS } = {}) {
  for (let j = i - 1; j >= 0; j--) { if (steps[j].phase !== 'tour') return i; if (usable(steps[j], lens)) return j; }
  return i;
}
/** a stop's text for the lens it's seen under */
export const stepText = (s, lens) => (lens !== 'composition' && s.textRow ? s.textRow : s.text);
/** "2 / 5" for a tour stop, '' for the opening */
export function progressLabel(i, { steps = STEPS } = {}) {
  const stops = steps.filter((s) => s.phase === 'tour'), k = stops.indexOf(steps[i]);
  return k < 0 ? '' : `${k + 1} / ${stops.length}`;
}
/** every selector the script names (for the index.html check) */
export const allTargets = () => [...new Set(STEPS.flatMap((s) => [...s.targets, ...(s.then || []), ...(s.reveal || [])]))];

// ── the first visit (proposed: the tour opens by itself once) ──

export const SEEN_KEY = 'lrc.tour.seen';
/** the old slide tutorial's "Do not show again" (TutorialUI.js): someone who ticked it isn't shown the tour unasked */
export const OLD_DISMISSED_KEY = 'lrcTutorialDismissed';
/** how long after the page's load the tour opens itself, ms (the HUD and Partitions boot on 100–200 ms timers) */
export const AUTO_OPEN_DELAY_MS = 900;
const LAUNCH_PARAMS = ['layers', 'rhythm', 'a', 'b', 'c', 'd', 'layerA', 'layerB', 'layerC', 'layerD', 'layer-a', 'layer-b', 'layer-c', 'layer-d'];

/**
 * Should the tour open by itself? Only when the storage can say it hasn't been seen: a storage that is missing or
 * throws (a private window, blocked site data) means no (proposed: it would open on every visit otherwise). Never on
 * a page launched with a rhythm in its URL (LRCModule.getLaunchRhythmsFromUrl): the tour would type over it.
 */
export function autoOpen({ storage, search = '' } = {}) {
  try {
    const q = String(search || '').replace(/^\?/, '');
    if (q && q.split('&').some((kv) => LAUNCH_PARAMS.includes(decodeURIComponent(kv.split('=')[0] || '')))) return false;
    if (!storage || typeof storage.getItem !== 'function') return false;
    if (storage.getItem(SEEN_KEY) === '1') return false;
    if (storage.getItem(OLD_DISMISSED_KEY) === 'true') return false;
    return true;
  } catch { return false; }
}
/** remember the tour was seen (opened, by itself or by hand) → whether it was written */
export function markSeen(storage) {
  try { storage?.setItem?.(SEEN_KEY, '1'); return !!storage?.setItem; } catch { return false; }
}
