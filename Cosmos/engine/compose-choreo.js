// compose-choreo.js — Cosmos's onset dust: a composition's onsets as motes, and the choreography that selects from
// them and then plays them (Compose mode E2, built 2026-10-22 night, sprint; proposed, not ruled).
//
// PURE: no DOM, no canvas, no clock. Times are handed in (wall seconds for the choreography, audio-context seconds for
// the notes). flight-view.js feeds the director the Compose mode's events and asks it for a frame each flight frame;
// ui/compose-dust.js draws the frame. The pattern is the main page's (Composer/page/trace-frames.js): build a scene
// once, ask it for frames.
//
// Avery's vision (2026-10-22): Cosmos blooms a grid into its rhythms, but has never bloomed a rhythm into its onsets.
// In Compose mode those onsets appear as cosmic dust, a pool; the pool is selected from, the composition is rebuilt from
// it, and the dust then plays in sync with the composition — "a treat for playing with the system". The black orb that
// masks the cosmos around a bloom expands into a blank canvas for it.
//
//   the frame       a clock face of the cycle, in a local unit disc around the composing grid: a mote's ANGLE is its
//                   onset's place in the cycle (tick / grid, 12 o'clock = the downbeat once the phase is chosen,
//                   clockwise), its RADIUS its tone (cents in the octave: 1/1 at RING.inner, 2/1 at RING.outer), its
//                   z its register (a note's octave; the renderer scales by 1 / (1 − OCTAVE_DEPTH·z), so the lead
//                   sits outside the bass). So the picture is the music: rings of tones, spokes of time.
//   the motes       three populations, in this draw order:
//                     grains  the POOL: the onsets the composition was made from, sampled evenly (a Rhythm card: its
//                             row's onsets, sampled in the worker; a Grid card: the superrow's source onsets, every
//                             (rhythm, onset) that merged into a node). Jittered off their exact place: a nebula.
//                     keys    every onset the compose trace names (root samples, line notes, chord roots, slots…), at
//                             its exact place: what the selection lights.
//                     voices  the composition: one per spec note (part, node, chord voice) and drum stroke, at its
//                             exact place, its register as z, in its part's colour (the main page's colours).
//   the phases      (a) bloom-out  BLOOM_OUT_SECONDS: the grains and keys stream out of their rhythm's node (a Grid
//                       card: every admitted rhythm's node of the bloom) into the pool
//                   (b) selection  the trace's timeline (traceTimeline, the page's beat budgets) compressed into
//                       SELECTION_SECONDS: the root candidates' onsets brighten in turn and the winner holds; the bar
//                       spokes ring in and the face turns until the chosen downbeat is at 12 o'clock; the slots tick
//                       in on the rim; lead candidates are faint filaments through their notes, the chosen one bright;
//                       per bar the candidates flick on their roots and the pick's chord tones light; settle rounds
//                       flash their bars; the parts gather in their colours and rise to their registers; the drums
//                       drop in and lock onto the drum ring
//                   (c) performance  the voices on the clock face, a hand at the audio playhead; each booked note
//                       (cosmos-composer-player.js onNote, ~250 ms ahead) flashes its voice when the audio clock
//                       reaches `when`; the grains drift as a faint halo
//                   (d) dissolve  on stop, everything fades over DISSOLVE_SECONDS and the director clears
//   timing          PROPOSED: the audio starts at once (E1 performs on 'composed'), and (b) is compressed to 3 s; the
//                   notes flash the dust from the first one. A click or Esc in (a)/(b) skips to (c).
//   the veil        the orb's veil: COMPOSING_VEIL while the worker composes, rising to 1 over VEIL_RISE_SECONDS from
//                   'composed', × the range level (E1's 'level' events) — full at level 1, the cosmos back as you fly
//                   away — and down with the dissolve. At ≥ VEIL_FULL flight-view skips the layers it hides.
//   caps            motes a frame by tier (cosmos-quality.js dustMax: 1.5k / 3k / 6k / 10k, Low → Ultra); voices
//                   first, then keys, then grains sampled evenly into what is left. Fixed: GLOW_CAP sprite glows,
//                   FLASH_CAP flashes, FILAMENT_CAP paths, LINE_CAP lines, ARC_CAP arcs a frame. Deterministic:
//                   jitter is a hash of the mote, never Math.random.
//
//   buildDustScene({ trace, spec, composed, caps, origins }) → scene | null
//   frameAt(scene, t, { audioNow, startedAt, flashes, fade }) → frame (struct of arrays; `moteAt(frame, i)` reads one)
//   createDustDirector({ caps }) → the lifecycle: composing / composed / perform / note / level / stop / skip / frame
//   dustNodeDim(state, grid, key) → how much of a bloom node to draw under the dust (a Rhythm card: only its rhythm)

import { traceTimeline } from '../../Composer/core/trace.js';
import { classOfCents } from '../../Composer/core/frame.js';
import { ANIMATION_BUDGETS } from '../../Composer/page/trace-frames.js';
import { PART_COLORS } from '../../Composer/page/plot-highlights.js';

export const COMPOSE_DUST_VERSION = 'cosmos-compose-dust-v1';

// ── timing (proposed) ──
export const BLOOM_OUT_SECONDS = 0.9;
export const SELECTION_SECONDS = 3;          // (b), compressed: the audio starts at once (proposed: not held for (b))
export const DISSOLVE_SECONDS = 0.8;
export const VEIL_RISE_SECONDS = 0.6;
export const COMPOSING_VEIL = 0.35;          // the orb swells this far while the worker composes
export const VEIL_FULL = 0.999;              // at or past this the veil covers everything: flight-view culls under it
export const FLASH_SECONDS = 0.6;            // a note's flash decays over this (audio seconds)
export const DRUM_FLASH_SECONDS = 0.3;
/** the selection's beat weights before the fit into SELECTION_SECONDS: the main page's (trace-frames.js), with the
 *  dust's own stress — the parts gathering and the drums locking in longer, the slots and the summaries shorter */
export const DUST_BUDGETS = Object.freeze({ ...ANIMATION_BUDGETS, row: 0.25, cells: 0.25, progression: 0.25, harmony: 0.2, done: 0.15, parts: 1.5, drums: 0.9 });

// ── caps ──
export const DUST_TIER_MAX = Object.freeze({ low: 1500, medium: 3000, high: 6000, ultra: 10000 });   // = tier.dustMax
export const DUST_POOL_MAX = DUST_TIER_MAX.ultra;   // what a Rhythm compose asks its worker to sample (compose-worker.js)
export const GLOW_CAP = 160;
export const FLASH_CAP = 96;
export const FILAMENT_CAP = 12;
export const LINE_CAP = 96;
export const ARC_CAP = 24;
export const VOICE_CAP = 2048;
/** a tier's dust caps (tier.dustMax, else Medium's) */
export function dustCaps(tier = null) {
  const motes = tier && tier.dustMax > 0 ? tier.dustMax : DUST_TIER_MAX.medium;
  return { motes, glows: GLOW_CAP, flashes: FLASH_CAP, filaments: FILAMENT_CAP, lines: LINE_CAP, arcs: ARC_CAP, voices: Math.min(VOICE_CAP, motes) };
}

// ── geometry (proposed) ──
export const RING = Object.freeze({ inner: 0.3, outer: 0.92 });   // a tone's radius: cents 0 → inner, 1200 → outer
export const DRUM_RING = Object.freeze({ kick: 1.0, snare: 1.05, perc: 1.08, hat: 1.11, cym: 1.15 });
export const DRUM_RING_DEFAULT = 1.06;
export const OCTAVE_DEPTH = 0.12;            // the renderer's scale for z: 1 / (1 − OCTAVE_DEPTH·z)
export const SPOKE = Object.freeze({ inner: 0.2, outer: 0.98 });
export const HALO_DRIFT = Object.freeze([0.012, -0.007, 0.004]);   // the grains' three drift bands, radians a second

// ── palette: index → colour (the parts are the main page's, plot-highlights.js) ──
export const HUE = Object.freeze({ dust: 0, candidate: 1, reject: 2, root: 3, changed: 4, lead: 5, chords: 6, comp: 7, bass: 8, inner: 9, drums: 10, rule: 11, glint: 12 });
export const DUST_PALETTE = Object.freeze(['#9fb4d8', '#dfe6e9', '#7f8c8d', '#00ff88', '#ffb347',
  PART_COLORS.lead, PART_COLORS.chords, PART_COLORS.comp, PART_COLORS.bass, PART_COLORS.inner, PART_COLORS.drums, '#ffffff', '#cfd9ff']);
const PART_HUE = { lead: HUE.lead, chords: HUE.chords, comp: HUE.comp, bass: HUE.bass, inner: HUE.inner, drums: HUE.drums };
const PART_SIZE = { lead: 2.6, chords: 2.1, comp: 1.8, bass: 2.8, inner: 1.8, drums: 2.0 };
const PART_ALPHA = { lead: 0.62, chords: 0.5, comp: 0.45, bass: 0.55, inner: 0.45, drums: 0.5 };
const PART_ORDER = ['lead', 'chords', 'comp', 'bass', 'inner'];
const GRAIN_SIZE = 1.1, KEY_SIZE = 1.4;
const GRAIN_ALPHA = { bloom: 0.34, select: 0.24, perform: 0.13 };
const KEY_ALPHA = { bloom: 0.4, select: 0.32, perform: 0.2 };

const TAU = Math.PI * 2;
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const ease = (x) => 1 - (1 - clamp01(x)) ** 3;
const pulse = (x) => Math.sin(Math.PI * clamp01(x));
const mod = (v, n) => ((v % n) + n) % n;
/** a deterministic 0..1 from an integer and a salt (no Math.random: the scene is the same every time) */
function hash01(i, salt = 0) {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** a fraction's cents above 1/1 ('21/16' → 470.78) */
export function centsOfRatio(ratio) {
  if (typeof ratio === 'number') return 1200 * Math.log2(ratio);
  const [a, b] = String(ratio).split('/').map(Number);
  return 1200 * Math.log2(a / (b || 1));
}
/** a tone's radius on the face */
export const toneRadius = (cents) => RING.inner + (RING.outer - RING.inner) * (mod(cents, 1200) / 1200);
/** clock coordinates: angle a (0 = 12 o'clock, clockwise), radius r → [x, y] (y up) */
const clock = (a, r) => [r * Math.sin(a), r * Math.cos(a)];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** the phase as a fraction of the cycle, turned the short way (so the face never spins more than half a turn) */
const shortTurn = (f) => (f > 0.5 ? f - 1 : f);

/**
 * The scene: everything the frames need, read once.
 *   trace     spec.trace (Composer/TRACE.md), or null (no selection phase: the dust blooms out, then plays)
 *   spec      the plain spec, as played
 *   composed  E1's 'composed' payload: { target, superrow? (a Grid card: grid, tick, tone, tones, toneCents, octave,
 *             sources, keys, pis), window?, dust? (a Rhythm card: compose-worker.js sampleRowDust) }
 *   caps      dustCaps(tier)
 *   origins   where each source rhythm's dust starts, local units ([x, y, z] × rhythms, flat): a Grid card indexes it
 *             by posted rhythm (superrow sources' `rhythm`), a Rhythm card uses [0..2]; default: a golden spiral
 * → null for a refusal or no spec
 */
export function buildDustScene({ trace = null, spec, composed = {}, caps = dustCaps(), origins = null } = {}) {
  if (!spec || spec.refused || !spec.knobs) return null;
  const sr = composed.superrow || null, dust = composed.dust || null, kind = sr ? 'grid' : 'rhythm';
  const T = spec.knobs.cycleSeconds, ph = spec.knobs.phase || trace?.phase || [0, 1], phaseFrac = ph[0] / ph[1];
  const G = sr?.grid ?? trace?.grid ?? dust?.grid ?? (spec.input?.layers || []).filter((v) => v > 0).reduce((a, b) => (a / gcd(a, b)) * b, 1);
  const tnodes = trace?.nodes || {};

  // ── a node's tick and cents ──
  const noteInfo = new Map();
  for (const p of spec.parts || []) for (const n of p.notes) if (!noteInfo.has(n.node)) noteInfo.set(n.node, { tick: n.tick, cents: centsOfRatio(n.ratio) });
  const toneCentsCache = new Map();
  const srCents = (node) => {
    const t = sr.tone[node];
    if (sr.toneCents) return sr.toneCents[t];
    if (!toneCentsCache.has(t)) toneCentsCache.set(t, centsOfRatio(sr.tones[t]));
    return toneCentsCache.get(t);
  };
  const nodeTick = (node) => (sr && node >= 0 && node < sr.n ? sr.tick[node] : tnodes[node]?.tick ?? noteInfo.get(node)?.tick ?? null);
  const nodeCents = (node) => (sr && node >= 0 && node < sr.n ? srCents(node) : tnodes[node]?.cents ?? noteInfo.get(node)?.cents ?? null);
  // a drum stroke's onset, by tick: the trace's drum hits, the superrow, else the notes and trace nodes at that tick
  const tickNode = new Map();
  for (const [k, v] of Object.entries(tnodes)) if (!tickNode.has(v.tick)) tickNode.set(v.tick, Number(k));
  for (const [k, v] of noteInfo) if (!tickNode.has(v.tick)) tickNode.set(v.tick, k);
  const drumEv = trace?.events?.find((e) => e.kind === 'drums');
  if (drumEv) for (const h of drumEv.hits) if (h.node != null) tickNode.set(h.tick, h.node);
  const nodeAtTick = (tick) => {
    if (sr) { let lo = 0, hi = sr.n; while (lo < hi) { const m = (lo + hi) >> 1; if (sr.tick[m] < tick) lo = m + 1; else hi = m; } return lo < sr.n && sr.tick[lo] === tick ? lo : -1; }
    return tickNode.get(tick) ?? -1;
  };

  // ── voices: the composition (enabled parts and drums, as the player books them) ──
  const voices = [], voiceOf = new Map();
  let truncatedVoices = 0;
  const addVoice = (key, v) => { if (voiceOf.has(key)) return; if (voices.length >= caps.voices) { truncatedVoices++; return; } voiceOf.set(key, voices.length); voices.push(v); };
  for (const id of PART_ORDER) {
    const p = (spec.parts || []).find((x) => x.id === id);
    if (!p || !p.enabled) continue;
    for (const n of p.notes) addVoice(voiceKey(id, n.node, n.voice), { part: id, node: n.node, tick: n.tick, cents: centsOfRatio(n.ratio), octave: n.octave, time: n.time, bar: n.bar });
  }
  if (spec.drums?.enabled) for (const h of spec.drums.hits) addVoice(drumKey(h.voice, h.tick), { part: 'drums', drum: h.voice, node: nodeAtTick(h.tick), tick: h.tick, cents: null, octave: 0, time: h.time, bar: h.bar });

  // ── keys: every onset the trace names ──
  const keyNodes = Object.keys(tnodes).map(Number).sort((a, b) => a - b);
  const keyRoom = Math.max(0, caps.motes - voices.length);
  const keys = keyNodes.slice(0, keyRoom);
  const truncatedKeys = keyNodes.length - keys.length;

  // ── grains: the pool, sampled evenly into the room left ──
  const room = Math.max(0, caps.motes - voices.length - keys.length);
  const grains = [];   // { tick, cents, node, rhythm }
  if (sr && sr.sources) {
    const m = sr.sources.rhythm.length, S = Math.min(room, m), start = sr.sources.start;
    for (let k = 0; k < S; k++) {
      const j = S === m ? k : Math.floor(((k + 0.5) * m) / S);
      let lo = 0, hi = sr.n; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (start[mid] <= j) lo = mid; else hi = mid - 1; }   // the node whose members hold j
      grains.push({ tick: sr.tick[lo], cents: srCents(lo), node: lo, rhythm: sr.sources.rhythm[j] });
    }
  } else if (dust && dust.index) {
    const m = dust.index.length, S = Math.min(room, m);
    for (let k = 0; k < S; k++) { const j = S === m ? k : Math.floor(((k + 0.5) * m) / S); grains.push({ tick: dust.tick[j], cents: dust.cents[j], node: dust.index[j], rhythm: 0 }); }
  }
  const poolSize = sr?.sources ? sr.sources.rhythm.length : dust ? dust.n : keys.length;

  // ── the arrays: grains [0, nG), keys [nG, nG + nK), voices [nG + nK, N) ──
  const nG = grains.length, nK = keys.length, nV = voices.length, N = nG + nK + nV;
  const homeX = new Float32Array(N), homeY = new Float32Array(N), homeZ = new Float32Array(N);
  const preX = new Float32Array(N), preY = new Float32Array(N), preZ = new Float32Array(N);
  const theta = new Float32Array(N), hue = new Uint8Array(N), size = new Float32Array(N), stagger = new Float32Array(N), band = new Uint8Array(N);
  const tickOf = new Float64Array(N), centsOf = new Float32Array(N), nodeOfMote = new Int32Array(N);
  const nOrigins = origins ? Math.floor(origins.length / 3) : 0;
  const originOf = (r) => {
    if (r < nOrigins) return [origins[3 * r], origins[3 * r + 1], origins[3 * r + 2]];
    if (kind === 'rhythm') return [0, 0, 0];
    const a = r * 2.399963229728653, rr = 0.75 * Math.sqrt((r % 512 + 0.5) / 512);   // a golden spiral in the disc
    return [rr * Math.sin(a), rr * Math.cos(a), 0];
  };
  const place = (i, tick, cents) => { const a = TAU * (tick / G); theta[i] = a; tickOf[i] = tick; centsOf[i] = cents ?? NaN; return a; };
  for (let g = 0; g < nG; g++) {
    const gr = grains[g], a = place(g, gr.tick, gr.cents), r = toneRadius(gr.cents) + (hash01(g, 1) - 0.5) * 0.12, aj = a + (hash01(g, 2) - 0.5) * 0.02;
    [homeX[g], homeY[g]] = clock(aj, r); homeZ[g] = (hash01(g, 3) - 0.5) * 0.7;
    const o = originOf(gr.rhythm), s = 0.05;
    preX[g] = o[0] + (hash01(g, 4) - 0.5) * s; preY[g] = o[1] + (hash01(g, 5) - 0.5) * s; preZ[g] = o[2];
    hue[g] = hash01(g, 6) < 0.18 ? HUE.glint : HUE.dust; size[g] = GRAIN_SIZE * (0.75 + 0.5 * hash01(g, 7));
    stagger[g] = hash01(g, 8); band[g] = Math.floor(hash01(g, 9) * 3); nodeOfMote[g] = gr.node;
  }
  const keyOf = new Map();
  for (let k = 0; k < nK; k++) {
    const i = nG + k, node = keys[k], tick = nodeTick(node), cents = nodeCents(node);
    keyOf.set(node, i);
    const a = place(i, tick, cents);
    [homeX[i], homeY[i]] = clock(a, toneRadius(cents)); homeZ[i] = 0;
    // a key starts from a rhythm that holds it (a Grid card: its node's first member), else the centre
    let r = 0;
    if (sr && sr.sources && node < sr.n && sr.sources.start[node] < sr.sources.start[node + 1]) r = sr.sources.rhythm[sr.sources.start[node]];
    const o = originOf(r);
    preX[i] = o[0]; preY[i] = o[1]; preZ[i] = o[2];
    hue[i] = HUE.dust; size[i] = KEY_SIZE; stagger[i] = hash01(i, 8); nodeOfMote[i] = node;
  }
  const voicesByPart = {};
  for (let v = 0; v < nV; v++) {
    const i = nG + nK + v, vo = voices[v], a = place(i, vo.tick, vo.cents);
    if (vo.part === 'drums') {
      const R = DRUM_RING[vo.drum] ?? DRUM_RING_DEFAULT;
      [homeX[i], homeY[i]] = clock(a, R); homeZ[i] = 0;
      [preX[i], preY[i]] = clock(a, R + 0.32); preZ[i] = 0;
    } else {
      [homeX[i], homeY[i]] = clock(a, toneRadius(vo.cents)); homeZ[i] = Math.max(-3, Math.min(2, vo.octave || 0));
      preX[i] = homeX[i]; preY[i] = homeY[i]; preZ[i] = 0;   // a voice rises out of its onset's place to its register
    }
    hue[i] = PART_HUE[vo.part]; size[i] = PART_SIZE[vo.part]; nodeOfMote[i] = vo.node;
    (voicesByPart[vo.part] ??= []).push(v);
  }
  for (const id of Object.keys(voicesByPart)) voicesByPart[id].sort((a, b) => voices[a].time - voices[b].time || a - b);

  // ── the selection: the trace's timeline, compressed, read once into steps ──
  const bars = spec.knobs.bars || 1;
  const timeline = trace && Array.isArray(trace.events) && trace.events.length && !trace.events.some((e) => e.kind === 'refused')
    ? traceTimeline(trace, { budgets: DUST_BUDGETS, seconds: SELECTION_SECONDS }) : null;
  const steps = timeline ? readSteps({ trace, timeline, keyOf, voicesByPart, voices, bars, G, phaseFrac, nodeTick }) : [];
  const select = timeline ? timeline.seconds : 0;
  const performAt = BLOOM_OUT_SECONDS + select;
  // the lead's kept lines → its voices in time order (the performance's melody filament)
  const leadPath = (voicesByPart.lead || []).map((v) => nG + nK + v);
  const bassPath = (voicesByPart.bass || []).map((v) => nG + nK + v);

  const out = { x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), size: new Float32Array(N), alpha: new Float32Array(N), hue: new Uint8Array(N), glow: new Uint8Array(N), id: new Int32Array(N) };
  return {
    version: COMPOSE_DUST_VERSION, kind, grid: G, T, phaseFrac, turn: shortTurn(phaseFrac) * TAU, bars, caps,
    counts: { grains: nG, keys: nK, voices: nV, motes: N, pool: poolSize, truncatedVoices, truncatedKeys },
    ranges: { grains: [0, nG], keys: [nG, nG + nK], voices: [nG + nK, N] },
    homeX, homeY, homeZ, preX, preY, preZ, theta, hue, size, stagger, band, tickOf, centsOf, nodeOfMote,
    voices, voiceOf, keyOf, voicesByPart, leadPath, bassPath,
    timeline, steps, bloomOut: BLOOM_OUT_SECONDS, select, performAt, lineTable: trace?.lines || {},
    out, keyLite: { a: new Float32Array(nK), s: new Float32Array(nK), h: new Uint8Array(nK), g: new Uint8Array(nK) },
    flashI: new Float32Array(nV),
  };
}
export const voiceKey = (part, node, voice) => `${part}|${node}|${voice ?? ''}`;
export const drumKey = (voice, tick) => `drums|${voice}|${tick}`;
/** the voice a booked note or stroke flashes (cosmos-composer-player.js bookingEvents shape) → its index, or -1 */
export function voiceForNote(scene, e) {
  if (!scene || !e) return -1;
  const k = e.kind === 'drum' || e.part === 'drums' ? drumKey(e.voice, e.tick) : voiceKey(e.part, e.node, e.voice);
  return scene.voiceOf.get(k) ?? -1;
}

/** the trace's steps, each with what it shows (key indices) and what persists into it — trace-frames.js' walk */
function readSteps({ trace, timeline, keyOf, voicesByPart, voices, bars, G, phaseFrac, nodeTick }) {
  const ev = trace.events, kx = (node) => (node == null ? -1 : keyOf.get(node) ?? -1), ok = (i) => i >= 0;
  const lineKeys = (id) => (id && trace.lines[id] ? trace.lines[id].notes.map((n) => kx(n.node)).filter(ok) : []);
  const root = ev.find((e) => e.kind === 'root'), e = root ? root.frameCentsEachSide : 15;
  // trace nodes by bar (by time: bars are equal in time), for the chords' tones
  const byBar = Array.from({ length: bars }, () => []);
  for (const [k, v] of Object.entries(trace.nodes)) {
    const i = kx(Number(k)); if (!ok(i)) continue;
    const b = Math.min(bars - 1, Math.floor(mod(v.tick / G - phaseFrac, 1) * bars));
    byBar[b].push({ i, cents: v.cents });
  }
  const toneKeys = (bar, pick) => {
    if (!pick || !byBar[bar]) return [];
    const out = new Set();
    for (const x of byBar[bar]) { const c = classOfCents(x.cents - pick.root.cents); if (Math.abs(c.dev) <= e + 1e-9 && pick.intervals.includes(c.pc)) out.add(x.i); }
    return [...out];
  };
  const state = { rootHeld: null, barsOn: false, turned: false, leads: {}, picks: {}, landed: {} };
  const snap = () => ({ rootHeld: state.rootHeld, barsOn: state.barsOn, turned: state.turned, leads: { ...state.leads }, picks: { ...state.picks }, landed: { ...state.landed } });
  return timeline.steps.map((s) => {
    const event = ev[s.events[0]], pre = snap(), data = {};
    switch (event.kind) {
      case 'root': {
        const pickAt = event.candidates.findIndex((c) => c.tone === event.pick);
        const order = event.candidates.map((c, j) => j).filter((j) => j !== pickAt).reverse();
        if (pickAt >= 0) order.push(pickAt);
        const maxP = Math.max(1, ...event.candidates.map((c) => c.presence ?? c.onsets ?? 1));
        data.cands = order.map((j) => { const c = event.candidates[j]; return { strength: (c.presence ?? c.onsets ?? 0) / maxP, samples: c.samples.map(kx).filter(ok), pick: j === pickAt }; });
        const win = data.cands[data.cands.length - 1];
        state.rootHeld = win && win.pick ? win.samples : null;
        break;
      }
      case 'meter': state.barsOn = true; break;
      case 'phase': data.cands = event.candidates.map((c) => kx(c.node)).filter(ok); data.pick = kx(event.node); state.turned = true; break;
      case 'cells': data.slots = event.slots.map((sl) => TAU * mod(sl.tick / G - phaseFrac, 1)); break;
      case 'progression': data.pinned = event.bars.filter((b) => !b.auto).map((b) => kx(b.node)).filter(ok); break;
      case 'lead': {
        data.skipped = !!event.skipped; data.stage = event.stage; data.phrase = event.phrase;
        data.mined = event.mined ? lineKeys(event.mined.id) : [];
        data.runners = event.runnersUp.map((r) => lineKeys(r.id));
        data.held = event.held ? lineKeys(event.held.id) : (pre.leads[event.phrase] ? lineKeys(pre.leads[event.phrase]) : []);
        data.kept = event.kept;
        if (!event.skipped && event.keptId) state.leads[event.phrase] = event.keptId;
        state.rootHeld = null;
        break;
      }
      case 'chord': {
        data.bar = event.bar; data.round = event.round; data.changed = event.round > 0 ? !!event.changed : true; data.pinned = !!event.pinned;
        const live = event.round === 0 || event.changed !== false;
        data.cands = live ? event.candidates.map((c) => kx(c.root.node)).filter(ok) : [];
        data.flicks = data.cands.length ? Math.max(1, Math.min(event.tested || data.cands.length, Math.floor((s.duration * 0.6) / 0.03))) : 0;
        data.pick = { root: kx(event.pick.root.node), tones: toneKeys(event.bar, event.pick) };
        state.picks[event.bar] = data.pick;
        break;
      }
      case 'settle': data.outcome = event.outcome; data.changedBars = event.changedBars || []; break;
      case 'part': {
        data.part = event.part; data.voices = voicesByPart[event.part] || [];
        if (data.voices.length) state.landed[event.part] = true;
        if (event.part === 'lead') state.leads = {};
        if (event.part === 'chords') state.picks = {};
        break;
      }
      case 'drums': data.voices = voicesByPart.drums || []; if (data.voices.length) state.landed.drums = true; break;
      default: break;
    }
    return { start: s.start, duration: s.duration, kind: event.kind, label: s.label, group: s.group, pre, data };
  });
}

function stepAt(steps, t) {
  let lo = 0, hi = steps.length - 1, at = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (steps[m].start <= t) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}

/**
 * The frame at t seconds since 'composed' (wall clock).
 *   opts { audioNow (audio-context seconds), startedAt (the loop's start, audio seconds), flashes: [{ voice, when,
 *          dur }], fade (0..1: the range level × the dissolve) }
 * → { t, phase: 'bloom' | 'select' | 'perform', step, kind, label, n, glows, x, y, z, size, alpha, hue, glow, id
 *     (the first n of each: the motes, in draw order; id = the scene's mote index), lines: [{ x0, y0, z0, x1, y1, z1,
 *     hue, alpha, width }], arcs: [{ r, a0, a1, hue, alpha, width }] (clock radians), paths: [{ pts (x, y, z flat),
 *     hue, alpha, width }], hand: angle | null, flashes (how many lit) }
 * The motes' buffers are the scene's own, rewritten each call: copy what you keep.
 */
export function frameAt(scene, t, { audioNow = null, startedAt = null, flashes = null, fade = 1 } = {}) {
  const S = scene, O = S.out, { caps } = S, [g0, g1] = S.ranges.grains, [k0, k1] = S.ranges.keys, [v0, v1] = S.ranges.voices;
  const phase = t < S.bloomOut ? 'bloom' : t < S.performAt ? 'select' : 'perform';
  const lines = [], arcs = [], paths = [];
  let n = 0, glows = 0, lit = 0;
  const F = clamp01(fade);
  const emit = (i, x, y, z, sz, a, h, gl) => {
    a *= F; if (!(a > 0.004)) return;
    O.x[n] = x; O.y[n] = y; O.z[n] = z; O.size[n] = sz; O.alpha[n] = a > 1 ? 1 : a; O.hue[n] = h; O.id[n] = i;
    if (gl && glows < caps.glows) { O.glow[n] = 1; glows++; } else O.glow[n] = 0;
    n++;
  };
  const line = (a, r0, r1, h, al, w = 1) => { if (lines.length < caps.lines && al * F > 0.004) { const [x0, y0] = clock(a, r0), [x1, y1] = clock(a, r1); lines.push({ x0, y0, z0: 0, x1, y1, z1: 0, hue: h, alpha: Math.min(1, al * F), width: w }); } };
  const arc = (r, a0, a1, h, al, w = 3) => { if (arcs.length < caps.arcs && al * F > 0.004) arcs.push({ r, a0, a1, hue: h, alpha: Math.min(1, al * F), width: w }); };

  // ── the turn: 0 until the phase is chosen, then the downbeat at 12 o'clock ──
  let k = -1, step = null, u = 1;
  if (phase === 'select' && S.steps.length) { k = stepAt(S.steps, t - S.bloomOut); step = S.steps[k]; u = step.duration > 0 ? clamp01((t - S.bloomOut - step.start) / step.duration) : 1; }
  let turnK = 1;
  if (phase === 'bloom') turnK = 0;
  else if (step) turnK = step.kind === 'phase' ? ease(step.data.cands.length ? (u - 0.6) / 0.4 : u) : step.pre.turned ? 1 : 0;
  const turn = S.turn * turnK, cs = Math.cos(turn), sn = Math.sin(turn);
  // rotate (x, y) by −turn (angle a → a − turn): the composition's downbeat to the top
  const RX = (x, y) => x * cs - y * sn, RY = (x, y) => y * cs + x * sn;

  // ── the flashes (any phase): a booked note lights its voice when the audio clock reaches `when` ──
  const touched = [];
  if (flashes && audioNow != null) {
    for (let j = flashes.length - 1; j >= 0 && touched.length < caps.flashes; j--) {
      const f = flashes[j], d = audioNow - f.when, dur = f.dur || FLASH_SECONDS;
      if (!(d >= 0 && d < dur) || !(f.voice >= 0 && f.voice < v1 - v0)) continue;
      const i = (1 - d / dur) ** 2;
      if (i > S.flashI[f.voice]) { if (!S.flashI[f.voice]) touched.push(f.voice); S.flashI[f.voice] = i; }
    }
  }
  lit = touched.length;

  // ── the persistent selection state, and this step's highlights on the keys ──
  const KL = S.keyLite, nK = k1 - k0;
  const keyBase = phase === 'bloom' ? KEY_ALPHA.bloom : phase === 'select' ? KEY_ALPHA.select : KEY_ALPHA.perform;
  for (let j = 0; j < nK; j++) { KL.a[j] = keyBase; KL.s[j] = KEY_SIZE; KL.h[j] = HUE.dust; KL.g[j] = 0; }
  const lite = (i, h, a, s = 1.6, gl = 0) => { const j = i - k0; if (j < 0 || j >= nK) return; if (a >= KL.a[j]) { KL.a[j] = a; KL.h[j] = h; KL.s[j] = KEY_SIZE * s; KL.g[j] = gl; } };
  const keyPos = (i) => [RX(S.homeX[i], S.homeY[i]), RY(S.homeX[i], S.homeY[i]), 0];
  const filament = (idx, h, a, w = 1, upto = idx.length) => {
    if (paths.length >= caps.filaments || upto < 2 || !(a * F > 0.004)) return;
    const m = Math.min(upto, idx.length), pts = new Float32Array(m * 3);
    for (let q = 0; q < m; q++) { const p = idx[q] >= v0 ? voicePos(idx[q]) : keyPos(idx[q]); pts[3 * q] = p[0]; pts[3 * q + 1] = p[1]; pts[3 * q + 2] = p[2]; }
    paths.push({ pts, hue: h, alpha: Math.min(1, a * F), width: w });
  };
  // a voice's place: pre → home by v (exactly home at v ≥ 1), turned
  const voiceAt = (i, v) => {
    const x = v >= 1 ? S.homeX[i] : S.preX[i] + (S.homeX[i] - S.preX[i]) * v, y = v >= 1 ? S.homeY[i] : S.preY[i] + (S.homeY[i] - S.preY[i]) * v;
    const z = v >= 1 ? S.homeZ[i] : S.preZ[i] + (S.homeZ[i] - S.preZ[i]) * v;
    return [RX(x, y), RY(x, y), z];
  };
  const voicePos = (i) => voiceAt(i, 1);
  const voiceV = new Map();   // voice index (scene) → emergence 0..1 this frame (select phase); landed parts are 1
  let hand = null, sweep = null;

  if (phase === 'select' && step) {
    const { pre, data } = step;
    for (const [id] of Object.entries(pre.landed)) for (const v of S.voicesByPart[id] || []) voiceV.set(v0 + v, 1);
    if (pre.barsOn) { const a = step.kind === 'done' ? 0.3 * (1 - u) + 0.12 * u : 0.3; for (let b = 0; b < S.bars; b++) line((TAU * b) / S.bars, SPOKE.inner, SPOKE.outer, HUE.rule, b === 0 ? a * 1.6 : a, b === 0 ? 1.4 : 1); }
    if (pre.rootHeld) { const a = step.kind === 'lead' ? 0.9 * (1 - u) : 0.9; for (const i of pre.rootHeld) lite(i, HUE.root, a, 1.7); }
    const leadFade = step.kind === 'part' && data.part === 'lead' ? 1 - ease(u) : 1;
    for (const [ph, id] of Object.entries(pre.leads)) {
      if (step.kind === 'lead' && data.phrase === Number(ph)) continue;
      const idx = leadKeys(S, id);
      filament(idx, HUE.lead, 0.55 * leadFade, 1.2); for (const i of idx) lite(i, HUE.lead, 0.8 * leadFade, 1.5);
    }
    const chordFade = step.kind === 'part' && data.part === 'chords' ? 1 - ease(u) : 1;
    for (const [b, p] of Object.entries(pre.picks)) {
      if (step.kind === 'chord' && data.bar === Number(b)) continue;
      if (p.root >= 0) lite(p.root, HUE.chords, 0.85 * chordFade, 2.2);
      for (const i of p.tones) lite(i, HUE.chords, 0.6 * chordFade, 1.4);
    }
    switch (step.kind) {
      case 'row': sweep = TAU * ease(u); hand = sweep; break;
      case 'root': {
        const m = data.cands.length, A = 0.75;
        if (!m) break;
        if (u < A) {
          const pos = (u / A) * m, cur = Math.min(m - 1, Math.floor(pos)), v = pos - cur;
          for (let j = 0; j < cur; j++) if (!data.cands[j].pick) for (const i of data.cands[j].samples) lite(i, HUE.reject, 0.4, 1.1);
          const c = data.cands[cur];
          for (const i of c.samples) lite(i, HUE.candidate, 0.5 + 0.5 * pulse(v), 1.3 + 1.6 * c.strength * pulse(v), pulse(v) > 0.6 ? 1 : 0);
        } else {
          const w = (u - A) / (1 - A), win = data.cands[m - 1];
          for (let j = 0; j < m - 1; j++) for (const i of data.cands[j].samples) lite(i, HUE.reject, 0.4 * (1 - w), 1.1);
          win.samples.forEach((i, q) => lite(i, HUE.root, 1, 1.8, q === 0 || w < 0.5 ? 1 : 0));
        }
        break;
      }
      case 'meter': for (let b = 0; b < S.bars; b++) { const a = clamp01(u * S.bars * 1.2 - b); if (a > 0) line((TAU * b) / S.bars, SPOKE.inner, SPOKE.outer, HUE.rule, 0.3 + 0.6 * pulse(a), b === 0 ? 1.4 : 1); } break;
      case 'phase': {
        const m = data.cands.length;
        if (m && u < 0.6) { const cur = Math.min(m - 1, Math.floor((u / 0.6) * m)); data.cands.forEach((i, j) => lite(i, HUE.candidate, j === cur ? 1 : 0.45, j === cur ? 2.4 : 1.5, j === cur ? 1 : 0)); }
        else if (data.pick >= 0) lite(data.pick, HUE.root, 1, 2.4 + 2 * pulse(m ? (u - 0.6) / 0.4 : u), 1);
        break;
      }
      case 'cells': { const P = data.slots.length, fadeOut = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1; for (let j = 0; j < P; j++) { if (clamp01(u * 1.4 * P - j) <= 0) break; line(data.slots[j], 0.94, 1.0, j % 2 ? HUE.candidate : HUE.root, 0.7 * fadeOut, 1); } break; }
      case 'progression': for (const i of data.pinned) lite(i, HUE.root, 1, 2.2 + 2 * u, 1); break;
      case 'lead': {
        if (data.skipped) break;
        if (data.stage === 'pass1') {
          data.runners.forEach((r, j) => { const a = u < 0.4 ? clamp01((u - (j * 0.4) / Math.max(1, data.runners.length)) * 8) : clamp01(1 - (u - 0.4) / 0.2); filament(r, HUE.candidate, 0.3 * a, 0.8); for (const i of r) lite(i, HUE.candidate, 0.5 * a, 1.2); });
          const L = data.mined.length, shown = Math.ceil(L * ease((u - 0.35) / 0.6));
          if (shown > 0) { filament(data.mined, HUE.lead, 0.9, 1.6, shown); for (let q = 0; q < shown; q++) lite(data.mined[q], HUE.lead, 1, 1.8, q === shown - 1 ? 1 : 0); }
        } else {
          const verdict = u >= 0.5, w = verdict ? (u - 0.5) / 0.5 : 0, test = verdict ? 1 - clamp01(w * 2) : clamp01(u * 4);
          data.runners.forEach((r) => filament(r, HUE.candidate, 0.22 * test, 0.8));
          if (data.kept === 'held') {
            filament(data.mined, HUE.candidate, 0.35 * test, 1);
            filament(data.held, verdict ? HUE.lead : HUE.root, verdict ? 0.9 : 0.5 + 0.4 * pulse(u * 4), verdict ? 1.8 : 1.3);
            for (const i of data.held) lite(i, HUE.lead, 1, 1.7);
          } else {
            filament(data.held, verdict ? HUE.changed : HUE.root, verdict ? 0.85 * (1 - w) : 0.5 + 0.4 * pulse(u * 4), 1.3);
            if (!verdict) filament(data.mined, HUE.candidate, 0.35 * test, 1);
            const L = data.mined.length, shown = verdict ? Math.ceil(L * ease(w / 0.8)) : 0;
            if (shown > 0) { filament(data.mined, HUE.lead, 0.9, 1.6, shown); for (let q = 0; q < shown; q++) lite(data.mined[q], HUE.lead, 1, 1.8); }
          }
        }
        break;
      }
      case 'chord': {
        const h = data.pinned ? HUE.root : data.round > 0 && data.changed ? HUE.changed : HUE.chords;
        arc(1.0, (TAU * data.bar) / S.bars, (TAU * (data.bar + 1)) / S.bars, h, 0.35 + 0.25 * pulse(u), 4);
        if (data.flicks && u < 0.6) { const j = Math.min(data.flicks - 1, Math.floor((u / 0.6) * data.flicks)), m = data.cands.length; lite(data.cands[m - 1 - (j % m)], HUE.chords, 1, 2.6, 1); }
        else {
          const w = data.flicks ? (u - 0.6) / 0.4 : u;
          if (data.pick.root >= 0) lite(data.pick.root, HUE.chords, 1, 2.4 + (data.changed ? 1.6 * pulse(w) : 0), 1);
          data.pick.tones.forEach((i, q) => lite(i, HUE.chords, 0.9 * clamp01(w * 3 - q / Math.max(1, data.pick.tones.length)), 1.5));
        }
        break;
      }
      case 'settle': {
        const h = data.outcome === 'converged' ? HUE.root : HUE.changed, list = data.outcome === 'changed' ? data.changedBars : Array.from({ length: S.bars }, (_, b) => b);
        const a = (data.outcome === 'converged' ? 0.35 : 0.6) * Math.abs(Math.sin(TAU * u));   // two flashes
        for (const b of list) arc(1.0, (TAU * b) / S.bars, (TAU * (b + 1)) / S.bars, h, a, 4);
        break;
      }
      case 'harmony': for (const [, p] of Object.entries(pre.picks)) if (p.root >= 0) lite(p.root, HUE.chords, 0.85 + 0.15 * pulse(u), 2.2 + pulse(u), 1); break;
      case 'part': {
        // each voice rises from its onset's place to its register, in time order, over the step (a cascade)
        const V = data.voices, L = V.length;
        for (let q = 0; q < L; q++) { const v = clamp01((u - (0.7 * q) / Math.max(1, L)) / 0.3); if (v > 0) voiceV.set(v0 + V[q], v); }
        break;
      }
      case 'drums': {
        for (const vi of data.voices) { const vo = S.voices[vi], v = clamp01((u - (0.8 * (vo.bar ?? 0)) / S.bars) / 0.2); if (v > 0) voiceV.set(v0 + vi, v); }
        break;
      }
      default: break;
    }
  }

  // ── grains ──
  const ga = GRAIN_ALPHA[phase];
  if (phase === 'bloom') {
    const x = t / S.bloomOut;
    for (let i = g0; i < g1; i++) {
      const v = ease((x - 0.45 * S.stagger[i]) / 0.55); if (v <= 0) continue;
      emit(i, S.preX[i] + (S.homeX[i] - S.preX[i]) * v, S.preY[i] + (S.homeY[i] - S.preY[i]) * v, S.preZ[i] + (S.homeZ[i] - S.preZ[i]) * v, S.size[i], ga * (0.35 + 0.65 * v) * 1.4, S.hue[i], 0);
    }
  } else if (phase === 'select') {
    for (let i = g0; i < g1; i++) {
      let a = ga;
      if (sweep != null) { const d = mod(sweep - S.theta[i], TAU); if (d < 0.7) a += 0.55 * (1 - d / 0.7); }
      emit(i, RX(S.homeX[i], S.homeY[i]), RY(S.homeX[i], S.homeY[i]), S.homeZ[i], S.size[i], a, S.hue[i], 0);
    }
  } else {
    const dt = t - S.performAt, c = HALO_DRIFT.map((w) => Math.cos(turn + w * dt)), s = HALO_DRIFT.map((w) => Math.sin(turn + w * dt));
    for (let i = g0; i < g1; i++) {
      const b = S.band[i], x = S.homeX[i], y = S.homeY[i];
      emit(i, x * c[b] - y * s[b], y * c[b] + x * s[b], S.homeZ[i], S.size[i], ga, S.hue[i], 0);
    }
  }
  // ── keys ──
  if (phase === 'bloom') {
    const x = t / S.bloomOut;
    for (let i = k0; i < k1; i++) { const v = ease((x - 0.45 * S.stagger[i]) / 0.55); if (v <= 0) continue; emit(i, S.preX[i] + (S.homeX[i] - S.preX[i]) * v, S.preY[i] + (S.homeY[i] - S.preY[i]) * v, S.preZ[i] * (1 - v), KEY_SIZE, keyBase * (0.4 + 0.6 * v), HUE.dust, 0); }
  } else {
    for (let i = k0; i < k1; i++) { const j = i - k0; emit(i, RX(S.homeX[i], S.homeY[i]), RY(S.homeX[i], S.homeY[i]), 0, KL.s[j], KL.a[j], KL.h[j], KL.g[j]); }
  }
  // ── voices ──
  const perform = phase === 'perform';
  for (let i = v0; i < v1; i++) {
    const vi = i - v0, vo = S.voices[vi], fl = S.flashI[vi], v = perform ? 1 : voiceV.get(i) ?? 0;
    const base = PART_ALPHA[vo.part];
    if (v <= 0 && fl <= 0) continue;
    const p = voiceAt(i, v);
    if (v <= 0) { emit(i, p[0], p[1], p[2], S.size[i] * (1 + 1.2 * fl), 0.75 * fl, S.hue[i], 1); continue; }   // not landed yet: flashes where it sits
    const popping = !perform && v < 1;
    emit(i, p[0], p[1], p[2], S.size[i] * (1 + 1.6 * fl + (popping ? 0.8 * (1 - v) : 0)), Math.max(base * v, fl > 0 ? 0.5 + 0.5 * fl : 0), S.hue[i], fl > 0.05 || (popping && v > 0.3) ? 1 : 0);
  }
  for (const vi of touched) S.flashI[vi] = 0;

  // ── performance furniture: spokes, the hand, the melody's filament ──
  if (perform) {
    for (let b = 0; b < S.bars; b++) line((TAU * b) / S.bars, SPOKE.inner, SPOKE.outer, HUE.rule, b === 0 ? 0.2 : 0.09, b === 0 ? 1.2 : 1);
    const p = audioNow != null && startedAt != null ? mod((audioNow - startedAt) / S.T, 1) : mod((t - S.performAt) / S.T, 1);
    hand = TAU * p;
    filament(S.leadPath, HUE.lead, 0.16, 1);
    filament(S.bassPath, HUE.bass, 0.1, 1);
  }
  if (hand != null) line(hand, 0.12, 1.0, phase === 'perform' ? HUE.rule : HUE.root, phase === 'perform' ? 0.45 : 0.8, 1.2);

  return {
    t, phase, step: k, kind: step ? step.kind : phase, label: step ? step.label : phase === 'perform' ? 'playing' : 'blooming',
    n, glows, flashes: lit, x: O.x, y: O.y, z: O.z, size: O.size, alpha: O.alpha, hue: O.hue, glow: O.glow, id: O.id,
    lines, arcs, paths, hand, done: perform,
  };
}
const leadCache = new WeakMap();
function leadKeys(scene, id) {
  let m = leadCache.get(scene); if (!m) leadCache.set(scene, (m = new Map()));
  if (!m.has(id)) { const l = scene.lineTable?.[id]; m.set(id, l ? l.notes.map((x) => scene.keyOf.get(x.node) ?? -1).filter((i) => i >= 0) : []); }
  return m.get(id);
}
/** one mote of a frame as an object (tests and the console) */
export function moteAt(frame, j) {
  return { id: frame.id[j], x: frame.x[j], y: frame.y[j], z: frame.z[j], size: frame.size[j], alpha: frame.alpha[j], hue: frame.hue[j], glow: frame.glow[j] };
}

// ── the director: one composition's dust, from 'composing' to the end of its dissolve ──

/**
 * createDustDirector({ caps: () => dustCaps(tier), build: buildDustScene })
 *   composing(e, at)            the worker is composing: the orb swells to COMPOSING_VEIL
 *   composed(e, at)             E1's 'composed' payload (+ origins): the scene; (a) starts at `at` (wall seconds)
 *   perform(e)                  { startedAt } (audio seconds): the hand's zero
 *   note(e)                     a booked note: its voice flashes at e.when (audio seconds)
 *   level(e)                    { level }: the range fade (the veil and the dust follow it)
 *   stop(e, at)                 the dissolve starts
 *   skip(at)                    in (a) or (b): jump to (c)
 *   frame(at, audioNow)         → null when idle (draw nothing), else { frame | null, veil, full, phase, grid, kind,
 *                               chosen (Set of rhythm keys the dust came from), level, fade }
 * Times are seconds; flight-view passes performance.now() / 1000 and the context's currentTime.
 */
export function createDustDirector({ caps = () => dustCaps(), build = buildDustScene } = {}) {
  let st = null;
  const veilAt = (at) => {
    if (!st) return 0;
    if (st.mode === 'composing') return COMPOSING_VEIL * clamp01((at - st.since) / VEIL_RISE_SECONDS);
    if (st.mode === 'show') return (st.v0 + (1 - st.v0) * clamp01((at - st.t0) / VEIL_RISE_SECONDS)) * st.level;
    return st.vStop * (1 - clamp01((at - st.stopAt) / DISSOLVE_SECONDS));
  };
  const api = {
    get active() { return !!st; },
    get scene() { return st?.scene || null; },
    get state() { return st ? st.mode : 'idle'; },
    /** in (a) or (b): a click or Esc skips to the performance */
    skippable(at) { return !!st && st.mode === 'show' && !!st.scene && at - st.t0 < st.scene.performAt; },
    composing(e = {}, at = 0) {
      st = { mode: 'composing', since: at, target: e.target || null, level: 1, scene: null, flashes: [] };
    },
    composed(e = {}, at = 0) {
      const v0 = st && st.mode === 'composing' ? COMPOSING_VEIL * clamp01((at - st.since) / VEIL_RISE_SECONDS) : 0;
      let scene = null;
      try { scene = build({ trace: e.trace || null, spec: e.spec, composed: e, caps: caps(), origins: e.origins || null }); } catch (err) { console.warn?.('[cosmos dust] scene failed', err); }
      const t = e.target || null, sr = e.superrow || null;
      let chosen = null;
      if (t && t.kind === 'rhythm') chosen = new Set([t.key]);
      else if (sr && sr.keys && e.window?.picked) chosen = new Set(e.window.picked.map((r) => sr.keys[r]));
      st = { mode: 'show', t0: at, v0, target: t, grid: t ? t.grid : sr?.grid ?? null, kind: t?.kind || (sr ? 'grid' : 'rhythm'), level: 1, scene, chosen, startedAt: null, flashes: [] };
    },
    perform(e = {}) { if (st && st.mode === 'show') st.startedAt = e.startedAt ?? null; },
    note(e) {
      if (!st || st.mode !== 'show' || !st.scene) return -1;
      const v = voiceForNote(st.scene, e);
      if (v < 0) return -1;
      st.flashes.push({ voice: v, when: e.when, dur: e.kind === 'drum' ? DRUM_FLASH_SECONDS : FLASH_SECONDS });
      if (st.flashes.length > 4 * FLASH_CAP) st.flashes.splice(0, st.flashes.length - 2 * FLASH_CAP);
      return v;
    },
    level(e = {}) { if (st && st.mode === 'show') st.level = clamp01(e.level ?? 1); },
    stop(e = {}, at = 0) {
      if (!st || st.mode === 'dissolve') return;
      const vStop = veilAt(at), fStop = st.mode === 'show' ? st.level : 1;
      st = { ...st, mode: 'dissolve', stopAt: at, vStop, fStop, reason: e.reason || 'stop' };
    },
    skip(at = 0) { if (api.skippable(at)) { st.t0 = at - st.scene.performAt; st.v0 = 1; return true; } return false; },
    frame(at = 0, audioNow = null) {
      if (!st) return null;
      if (st.mode === 'dissolve' && at - st.stopAt >= DISSOLVE_SECONDS) { st = null; return null; }
      const veil = veilAt(at);
      if (st.mode === 'composing') return { frame: null, veil, full: veil >= VEIL_FULL, phase: 'composing', grid: st.target?.grid ?? null, kind: st.target?.kind ?? null, chosen: st.target?.kind === 'rhythm' ? new Set([st.target.key]) : null, level: 1, fade: 0 };
      const fade = st.mode === 'dissolve' ? st.fStop * (1 - clamp01((at - st.stopAt) / DISSOLVE_SECONDS)) : st.level;
      if (st.flashes.length && audioNow != null) { let drop = 0; while (drop < st.flashes.length && audioNow - st.flashes[drop].when > 1) drop++; if (drop) st.flashes.splice(0, drop); }
      const tt = st.mode === 'dissolve' ? st.stopAt - st.t0 : at - st.t0;
      const frame = st.scene ? frameAt(st.scene, tt, { audioNow, startedAt: st.startedAt, flashes: st.flashes, fade }) : null;
      return { frame, veil, full: veil >= VEIL_FULL, phase: st.mode === 'dissolve' ? 'dissolve' : frame ? frame.phase : 'perform', grid: st.grid, kind: st.kind, chosen: st.chosen, level: st.level, fade };
    },
    clear() { st = null; },
  };
  return api;
}

/**
 * How much of a bloom node to draw under the dust (× its alpha; 0 = skip it). Proposed: the composing grid's chosen
 * rhythm(s) — a Rhythm card's one rhythm, a Grid card's admitted ones — fade slower than the rest, so on a Rhythm card
 * only its rhythm's dust is seen to leave; every other bloom node fades with the veil. All 0 under a full veil.
 *   d   the director's frame() result (or null: 1 everywhere)
 */
export function dustNodeDim(d, grid, key) {
  if (!d) return 1;
  const v = clamp01(d.veil);
  if (v >= VEIL_FULL) return 0;
  if (grid !== d.grid) return 1 - v;
  if (d.chosen && d.chosen.has(key)) return 1 - 0.7 * v;
  return (1 - v) * (1 - v);
}
