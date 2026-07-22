// cosmos-audio.js — Phase 0 dedicated audio layer for the Cosmos Flight instrument.
// "The rhythm plays its own tuning": a bloom node's composite onsets arpeggiate the node's own
// tuning system on one shared transport, spatialized by the star's live screen position.
// HARD RULE: fully separate from the site's playback engine. Do not import Core Interface/
// LRCModule.js, LRCSearch.js, Playback/* (AudioEngine/Scheduler/Partitions), Tone.js, or MIDIOut.
// The only shared code is the pure scale math below.
import { normalizeLayers, lcmAll, ratioToCents } from './oracle-core.js';
import { nearestDegree } from './grid-core.js';
// Full Sky (cosmos/FULL_SKY_HANDOFF.md): the global progression + its one gain law. Pure, no DOM.
import { TRIADS, START_CHORD_ID, chooseNextChord, pushTabu, chordStepIndex, coverage as skyCoverage, gainForDev } from './sky-walk.js';

const ROOT_HZ = 220;             // Phase 0: one root for every voice (per-star root is a later phase)
const LOOKAHEAD_MS = 25;         // scheduler tick cadence
const SCHEDULE_AHEAD = 0.1;      // seconds — schedule any note landing within this horizon
const MAX_LIVE_OSC = 48;         // defensive cap so a pathological dense grid can't runaway
const ATTACK = 0.008, DECAY = 0.22;   // soft short envelope so a busy melody (option A) doesn't smear
const NOTE_PEAK = 0.32;          // per-note envelope peak (kept modest — dense grids stack many notes)
const DUCK = 0.25;               // -12dB — out-of-chord onsets duck, they never get skipped
const LEAD_MASK_WINDOW = 35;     // cents — a lead onset counts as "in the global chord" within this of a degree

// ══ SKY KNOBS ═════════════════════════════════════════════════════════════════════════════════
// The global ambient bed — nearby stars' degree pools voiced against the one sky-wide chord walk.
// AUDIBLE_N (which/how-many zones feed the bed) lives in flight-view.js's FLIGHT/LOD KNOBS block —
// audible-set SELECTION is a camera/projection concern, kept out of this dependency-free audio layer.
const CHORD_TICKS = 256;         // universal-clock ticks per chord (≈25.6s at the default 10 ticks/s)
const TABU_K = 3;                // sky-walk tabu length (chord-walk.js's exact convention)
const LAMBDA_FIELD = 2.0;        // field term weight — tune by ear; must be able to overrule a cost-1 move
const MAX_BED_OSC = 30;          // bed oscillator budget (≤3 tones/star × AUDIBLE_N=10), alongside MAX_LIVE_OSC
const BED_ATTACK = 1.5, BED_RELEASE = 2.5;   // seconds — long swells, this is half the product
const BED_PEAK = 0.12;           // per-voice envelope peak (modest — many sustained voices sum)
const BED_SUSTAIN_FRAC = 0.4;    // a swell settles to this fraction of its peak, not to silence (held pad)
const REATTACK_PERIODS = [45, 56, 64, 81, 100];   // ticks; mutually near-coprime so the sky breathes as
                                  // a polyrhythm, not a synchronized pad — REATTACK_PERIODS[hash(id)%n]
const REVERB_WET = 0.3;          // shared send level
const REVERB_SECONDS = 4, REVERB_DECAY = 3;   // procedural impulse: exp-decaying noise burst, no assets

// One cycle of the rhythm as an ordered list of {t, ratio}: t = onset time as a fraction of the
// cycle in [0,1); ratio = folded pitch ratio in [1,2) (1/1 = root). Mirrors oracle-core.deriveScale's
// onset/space math EXACTLY, but keeps per-onset order (no dedup, no 2/1 delete).
export function deriveVoice(rawLayers) {
  const layers = normalizeLayers(rawLayers);
  const grid = lcmAll(layers);
  const positions = new Set();
  for (const L of layers) { const gs = grid / L; for (let i = 0; i < L; i++) positions.add(i * gs); }
  const comp = Array.from(positions).sort((a, b) => a - b);
  const spaces = [];
  for (let i = 0; i < comp.length - 1; i++) spaces.push(comp[i + 1] - comp[i]);
  spaces.push(grid - comp[comp.length - 1] + comp[0]);            // wraparound gap
  let spaceFund = 0; for (const s of spaces) if (s > spaceFund) spaceFund = s;   // largest gap (loop, not Math.max spread)
  const notes = [];
  for (let i = 0; i < comp.length; i++) {
    const s = spaces[i]; if (s <= 0) continue;
    let ratio = spaceFund / s; while (ratio >= 2) ratio /= 2; while (ratio < 1) ratio *= 2;   // fold to [1,2)
    notes.push({ t: comp[i] / grid, ratio });                    // onset i sounds the tone of the gap AFTER it
  }
  return { notes, grid, cardinality: layers.length ? new Set(notes.map(n => n.ratio.toFixed(6))).size : 0 };
}

// ── audio graph: osc -> per-note envelope -> shared panner -> shared distance-gain -> shared mute-gain -> out ──
let audioCtx = null, pannerNode = null, distGainNode = null, muteGainNode = null;
let liveOscs = null;              // Set of live OscillatorNodes (capacity-capped)
let schedulerTimer = null;

// ── shared transport ── universal clock = a fixed TICK RATE (ticks/sec), not a fixed cycle duration.
// A "tick" is one ONSET of whichever star is currently the lead (lead.notes.length ticks = one full
// cycle) — NOT one grid-step: `grid` is the LCM of the layers and can be tens of thousands even for a
// modest rhythm, which made cycles hours long when ticks were grid-steps (that's why the chord clock
// looked frozen/disconnected). Using the onset count instead pins the average note rate to ticksPerSec
// regardless of grid size, while note.t fractions still preserve the exact (uneven) onset spacing within
// the cycle — only the overall pace changes, not the rhythm's internal proportions.
let ticksPerSec = 10;              // default: 10 ticks/sec (~100ms/tick) — slow enough to actually listen
let transportStart = null;        // audioCtx time at which the absolute tick counter reads 0
let lead = null;                  // { notes, grid, cardinality, node } | null
let schedIdx = 0, schedCycle = 0; // scheduler's cursor into lead.notes / current cycle number
let currentOctaveLift = 0;        // applies to NEWLY scheduled notes only (spec: don't repitch in flight)
const absoluteTicks = now => (now - transportStart) * ticksPerSec;   // monotonic tick count since transport start

// ── Full Sky lead tint (M4): the lead's chord mask now comes from the GLOBAL walk, not a per-star
// song — solveStarSong is no longer called from the click path. Ducks (−12dB), never silences: the
// clicked star's own rhythm stays sacrosanct, the sky only tints it.
let leadMask = null;              // leadMask[noteIdx] = true if lead.notes[noteIdx] is in the CURRENT sky chord
let leadMaskChordId = -1;         // which skyChordId leadMask was computed against (cache invalidation)

// ── Full Sky: the global chord walk (online, stateful — not precomputed) + the ambient bed ──
let skyChordId = START_CHORD_ID, skyTabu = null, skyStep = -1;   // walk state; skyStep=-1 = not yet observed
let currentField = [];            // last setField() items — also the input to coverage()
let lastSyncedChordId = null;     // so syncBedDegrees only re-swells CONTINUING voices on an actual change
let bedStars = new Map();         // id (a star's grid) -> { filter, panner, gainNode, oscMap, octave, pool, reattachStep }
let bedOscCount = 0;
let bedBus = null, reverbConv = null, reverbWet = null;   // bedBus -> muteGainNode (dry) and -> reverb -> muteGainNode (wet)

export function initAudio() {
  if (audioCtx && audioCtx.state !== 'closed') return;   // idempotent; also tolerates re-init after stopAudio()
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  pannerNode = audioCtx.createStereoPanner();
  distGainNode = audioCtx.createGain(); distGainNode.gain.value = 0;
  muteGainNode = audioCtx.createGain(); muteGainNode.gain.value = 1;
  pannerNode.connect(distGainNode); distGainNode.connect(muteGainNode); muteGainNode.connect(audioCtx.destination);
  // Full Sky bed bus: dry sum -> master, plus a shared send through a procedural reverb (no assets).
  bedBus = audioCtx.createGain(); bedBus.gain.value = 1; bedBus.connect(muteGainNode);
  reverbConv = audioCtx.createConvolver(); reverbConv.buffer = makeImpulse(audioCtx);
  reverbWet = audioCtx.createGain(); reverbWet.gain.value = REVERB_WET;
  bedBus.connect(reverbConv); reverbConv.connect(reverbWet); reverbWet.connect(muteGainNode);
  skyChordId = START_CHORD_ID; skyTabu = pushTabu([], skyChordId, TABU_K); skyStep = -1; lastSyncedChordId = null;
  bedStars = new Map(); bedOscCount = 0; currentField = [];
  transportStart = audioCtx.currentTime;   // one shared clock starts here; lead swaps ride the same phase
  liveOscs = new Set();
  schedIdx = 0; schedCycle = 0;
  schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_MS);
  // No click gating (Avery, planning session): the bed is audible from here — cosmos entry + unlock —
  // with zero stars clicked, as soon as flight-view starts feeding it setField() each frame.
}

// Procedurally generated impulse response for the bed's shared reverb send: an exponentially decaying
// noise burst. No assets, respects the separation rule (pure WebAudio buffer synthesis).
function makeImpulse(ctx) {
  const rate = ctx.sampleRate, len = Math.floor(rate * REVERB_SECONDS);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, REVERB_DECAY);
  }
  return buf;
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// voice = deriveVoice(node.layers) + {node}; (re)starts the transport melody. null = silence (transport keeps ticking).
export function setLead(voice) {
  lead = voice || null;
  if (lead) resyncSchedulePointer();
  else if (audioCtx) distGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
  ensureLeadMask(true);   // a new lead's note fractions are different — force a recompute
}

// Is a lead onset's true JI ratio "in" a given global chord (within LEAD_MASK_WINDOW of one of its 3
// degrees)? Pure — no lead/audioCtx state — so a headless guard can check mask agreement directly.
export function leadNoteInChord(ratio, chordId) {
  const { d, dev } = nearestDegree(ratioToCents(ratio));
  return TRIADS[chordId].semitones.includes(d) && Math.abs(dev) <= LEAD_MASK_WINDOW;
}

// Recompute leadMask against the CURRENT global sky chord. Cheap (≤ lead cardinality), so it's called
// lazily (skyChordId cache-check) rather than threaded through every stepSkyWalk call.
function ensureLeadMask(force) {
  if (!lead) { leadMask = null; leadMaskChordId = -1; return; }
  if (!force && leadMaskChordId === skyChordId) return;
  leadMask = lead.notes.map(n => leadNoteInChord(n.ratio, skyChordId));
  leadMaskChordId = skyChordId;
}

// Called each frame from the flight loop for the lead star. pan in [-1,1], gain in [0,1].
export function setSpatial(pan, gain, octaveLift) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  pannerNode.pan.setTargetAtTime(pan, now, 0.05);
  distGainNode.gain.setTargetAtTime(gain, now, 0.05);
  currentOctaveLift = octaveLift;
}

// ── Full Sky: the ambient bed — a voice per (audible star, chord degree it covers) ────────────────
// graph: osc -> per-voice swell envelope -> star's shared BiquadFilter (lowpass, closes with distance)
// -> star's StereoPanner -> star's distance GainNode -> bedBus (dry -> master, wet -> shared reverb).
// The pure scheduling-decision helpers below (hashId/bedDegreesFor/reattachStepFor) are exported
// alongside the SKY KNOBS so a headless guard can verify the bed's decisions without a real AudioContext.
export { CHORD_TICKS, TABU_K, LAMBDA_FIELD, MAX_BED_OSC, REATTACK_PERIODS, LEAD_MASK_WINDOW };
const currentChordSemitones = () => TRIADS[skyChordId].semitones;

// small deterministic integer hash (Avery: REATTACK_PERIODS[hash(grid) % n] — a plain mod would
// correlate neighbouring grids' reattack phase; this scrambles it).
export function hashId(n) {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

// Which of a chord's 3 degrees a star's pool actually covers — the bed NEVER substitutes a missing
// degree, it's just silent for that voice (spec). Pure: no WebAudio, so a headless guard can check
// mask-silence correctness directly.
export function bedDegreesFor(chordId, pool) {
  return TRIADS[chordId].semitones.filter(d => pool && pool[d]);
}

// Which REATTACK_PERIODS-relative step a star is on at a given absolute tick count — pure floor
// division off a per-star period (chosen via hashId), same resync-safe shape as chordStepIndex.
export function reattachStepFor(id, ticks) {
  return Math.floor(ticks / REATTACK_PERIODS[hashId(id) % REATTACK_PERIODS.length]);
}

// Ramp an envelope's gain from wherever it currently sits UP to `peak` (BED_ATTACK) then settle to a
// held sustain floor (BED_RELEASE) — a swell, never a hard retrigger (chord changes and periodic
// reattacks both call this; only voice birth starts from 0).
function swellEnvelope(param, peak, now) {
  const cur = Math.max(0.0001, param.value);
  param.cancelScheduledValues(now);
  param.setValueAtTime(cur, now);
  param.linearRampToValueAtTime(Math.max(0.0002, peak), now + BED_ATTACK);
  param.exponentialRampToValueAtTime(Math.max(0.0001, peak * BED_SUSTAIN_FRAC), now + BED_ATTACK + BED_RELEASE);
}

function makeBedStar(id) {
  const filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 4000;
  const panner = audioCtx.createStereoPanner();
  const gainNode = audioCtx.createGain(); gainNode.gain.value = 0;
  filter.connect(panner); panner.connect(gainNode); gainNode.connect(bedBus);
  return { id, filter, panner, gainNode, oscMap: new Map(), octave: 0, pool: null, reattachStep: undefined };
}

// Hard/immediate teardown — ONLY for full engine teardown (stopAudio), where everything is about to
// die anyway. Routine field churn (a star falling out of the audible set mid-flight) must NOT use
// this: see dropBedStar below.
function teardownBedStar(bs, now) {
  for (const v of [...bs.oscMap.values()]) releaseVoice(bs, v, now, true);
  try { bs.filter.disconnect(); } catch {} try { bs.panner.disconnect(); } catch {} try { bs.gainNode.disconnect(); } catch {}
}

// A star fell out of the audible set (routine churn from flying, NOT a teardown): release its voices
// on the normal BED_RELEASE fade — a hard cut here was the "flight cuts the bed" bug (Avery, listening
// session) — every frame a star crossed the AUDIBLE_N boundary it got a 50ms chop. The star's shared
// filter/panner/gainNode chain stays connected (parked in `dyingStars`) until every voice has actually
// finished fading, so the release is heard in full even though the star is already gone from `bedStars`
// (and so a star that flickers back into range next frame gets a fresh chain, not a half-dead one).
let dyingStars = [];
function dropBedStar(bs, now) {
  const voices = [...bs.oscMap.values()];
  if (!voices.length) { finalizeStarChain(bs); return; }
  bs.fadingCount = voices.length;
  dyingStars.push(bs);
  for (const v of voices) releaseVoice(bs, v, now, false);
}
function finalizeStarChain(bs) {
  try { bs.filter.disconnect(); } catch {} try { bs.panner.disconnect(); } catch {} try { bs.gainNode.disconnect(); } catch {}
  dyingStars = dyingStars.filter(x => x !== bs);
}

// New voice for one (star, degree): true JI cents of that pool slot (NOT the 12TET degree pitch),
// scaled by gainForDev, register-spread by the star's distance octave. Silent-born, swells in.
function createVoice(bs, degree, now) {
  if (bedOscCount >= MAX_BED_OSC) return null;
  const slot = bs.pool[degree]; if (!slot) return null;
  const ratio = 2 ** (slot.cents / 1200);
  const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = ROOT_HZ * ratio * (2 ** bs.octave);
  const env = audioCtx.createGain(); env.gain.value = 0.0001;
  osc.connect(env); env.connect(bs.filter);
  osc.start(now);
  bedOscCount++;
  const v = { osc, env, degree, dev: slot.dev };
  bs.oscMap.set(degree, v);
  swellEnvelope(env.gain, BED_PEAK * gainForDev(slot.dev), now);
  return v;
}

function releaseVoice(bs, v, now, immediate) {
  bs.oscMap.delete(v.degree);
  // Free the budget NOW, not when the ~2.5s fade-out actually finishes — otherwise a burst of churn
  // (several stars releasing at once while flying) starves incoming voices of MAX_BED_OSC headroom
  // for the whole release tail, which read as "the bed gets quieter while moving" (part of the same bug).
  bedOscCount = Math.max(0, bedOscCount - 1);
  const rel = immediate ? 0.05 : BED_RELEASE;
  try {
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setValueAtTime(Math.max(0.0001, v.env.gain.value), now);
    v.env.gain.linearRampToValueAtTime(0.0001, now + rel);
  } catch {}
  try { v.osc.stop(now + rel + 0.05); } catch {}
  v.osc.onended = () => {
    try { v.osc.disconnect(); } catch {} try { v.env.disconnect(); } catch {}
    if (bs.fadingCount != null) { bs.fadingCount--; if (bs.fadingCount <= 0) finalizeStarChain(bs); }
  };
}

// Reconcile every bed star's voices against the CURRENT chord's 3 degrees ∩ its pool coverage. Called
// every frame (from setField) so newly-landed pool coverage and newly-audible stars pick up promptly;
// only re-swells a CONTINUING voice when the chord itself just changed (lastSyncedChordId guard) — a
// bare pool/field refresh must never re-trigger every voice's envelope every frame.
function syncBedDegrees(now) {
  const chordChanged = lastSyncedChordId !== skyChordId;
  lastSyncedChordId = skyChordId;
  for (const bs of bedStars.values()) {
    if (!bs.pool) continue;
    const desired = new Set(bedDegreesFor(skyChordId, bs.pool));
    for (const v of [...bs.oscMap.values()]) if (!desired.has(v.degree)) releaseVoice(bs, v, now, false);
    for (const d of desired) {
      const v = bs.oscMap.get(d);
      if (!v) createVoice(bs, d, now);
      else if (chordChanged) swellEnvelope(v.env.gain, BED_PEAK * gainForDev(v.dev), now);
    }
  }
}

// Each star re-swells on its own deterministic period (mutually near-coprime REATTACK_PERIODS) so the
// sky breathes as a slow polyrhythm rather than one synchronized pad — the v1 stand-in for real
// per-star rhythm. Driven by the tick clock (schedulerTick), independent of any lead.
function pumpReattacks(now, ticks) {
  for (const bs of bedStars.values()) {
    if (!bs.oscMap.size) continue;
    const stepNow = reattachStepFor(bs.id, ticks);
    if (bs.reattachStep === undefined) { bs.reattachStep = stepNow; continue; }
    if (stepNow === bs.reattachStep) continue;
    bs.reattachStep = stepNow;
    for (const v of bs.oscMap.values()) swellEnvelope(v.env.gain, BED_PEAK * gainForDev(v.dev), now);
  }
}

// The sky walk's chord clock: a pure step index off the universal tick clock (CHORD_TICKS apart).
// Online, not precomputed — advancing past a boundary calls chooseNextChord ONCE against the CURRENT
// field (no history replay; if ticks jump far ahead — e.g. a backgrounded tab — the walk just takes
// one hop and re-anchors, same "don't retroactively replay" spirit as setTickRate).
function stepSkyWalk(ticks) {
  const step = chordStepIndex(ticks, CHORD_TICKS);
  if (skyStep < 0) { skyStep = step; return; }
  if (step === skyStep) return;
  skyStep = step;
  const audibleStars = currentField.map(it => ({ pool: it.pool, weight: it.gain }));
  const next = chooseNextChord(skyChordId, skyTabu, t => skyCoverage(t, audibleStars), { lambdaField: LAMBDA_FIELD });
  skyChordId = next.id; pushTabu(skyTabu, skyChordId, TABU_K);
}

// → { symbol, semitones } — the sky's current chord, for the cockpit readout (M4) and lead masking.
export function currentSkyChord() {
  return { symbol: TRIADS[skyChordId].symbol, id: skyChordId, semitones: currentChordSemitones() };
}

// Dev-only introspection snapshot for the live debug overlay (flight-view.js, ?skyDebug=1) — NOT used
// by the product path. Everything a listener would want while investigating the walk: the current
// chord + recent trail, each audible star's FULL degree pool (not just what's voiced — "nearby tones"),
// which degrees actually made it into the bed and at what live gain, and — because Avery's first
// question was "is the field term doing anything" — coverage() for all 24 candidate triads against the
// CURRENT field, so a flat spread across location is visible directly instead of inferred from the ear.
export function debugSkyState() {
  const audibleStars = currentField.map(it => ({ pool: it.pool, weight: it.gain }));
  const stars = [...bedStars.values()].map(bs => ({
    id: bs.id, pan: bs.panner.pan.value, gain: bs.gainNode.gain.value, octave: bs.octave,
    cutoff: Math.round(bs.filter.frequency.value),
    pool: bs.pool,
    voiced: [...bs.oscMap.values()].map(v => ({
      degree: v.degree, dev: Math.round(v.dev * 10) / 10, gainLaw: Math.round(gainForDev(v.dev) * 100) / 100,
      envGain: Math.round(v.env.gain.value * 1000) / 1000, freqHz: Math.round(v.osc.frequency.value),
    })),
  }));
  return {
    rootHz: ROOT_HZ,   // v1: fixed, one root for the whole sky — see FULL_SKY_HANDOFF.md "no per-star roots, no drift"
    chord: { id: skyChordId, symbol: TRIADS[skyChordId].symbol, semitones: currentChordSemitones() },
    tabu: (skyTabu || []).map(id => ({ id, symbol: TRIADS[id].symbol })),
    coverageByTriad: TRIADS.map(t => ({ id: t.id, symbol: t.symbol, coverage: Math.round(skyCoverage(t, audibleStars) * 1000) / 1000 })),
    audibleCount: currentField.length,
    stars,
  };
}

// Per-frame audible-set API for the bed (flight-view.js selects the nearest AUDIBLE_N zones with a
// non-empty skyPool — see its FLIGHT/LOD KNOBS). items = [{ id, pool, pan, gain, octave, cutoff }];
// pool is the zone's 12-slot degree pool (z.skyPool), reused as-is (no copy). No lead required — this
// is the un-gated ambient bed, live from cosmos entry.
export function setField(items) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  currentField = items;
  const seen = new Set();
  for (const item of items) {
    seen.add(item.id);
    let bs = bedStars.get(item.id);
    if (!bs) { bs = makeBedStar(item.id); bedStars.set(item.id, bs); }
    bs.pool = item.pool; bs.octave = item.octave || 0;
    bs.filter.frequency.setTargetAtTime(item.cutoff, now, 0.3);
    bs.panner.pan.setTargetAtTime(item.pan, now, 0.3);
    bs.gainNode.gain.setTargetAtTime(item.gain, now, 0.3);
  }
  for (const [id, bs] of bedStars) if (!seen.has(id)) { bedStars.delete(id); dropBedStar(bs, now); }
  syncBedDegrees(now);
}

// Ticks per second (the universal clock's rate). Re-anchors the transport epoch so the CURRENT
// absolute tick count is preserved under the new rate (a rate change glides pace rather than jumping
// the playhead — past ticks don't retroactively speed up or slow down).
export function setTickRate(rate) {
  if (!audioCtx) { ticksPerSec = rate; return; }
  const now = audioCtx.currentTime;
  const ticksSoFar = absoluteTicks(now);
  ticksPerSec = rate;
  transportStart = now - ticksSoFar / ticksPerSec;
  if (lead) resyncSchedulePointer();
}

export function setMuted(bool) {
  if (!audioCtx) return;
  muteGainNode.gain.setTargetAtTime(bool ? 0 : 1, audioCtx.currentTime, 0.02);
}

// 0..1 position within the current lead's cycle, for the cockpit playhead. 0 before the transport
// starts or when there's no lead (a cycle is only meaningful relative to some star's grid).
export function transportPhase() {
  if (!audioCtx || transportStart == null || !lead) return 0;
  const phase = (absoluteTicks(audioCtx.currentTime) / lead.notes.length) % 1;
  return phase < 0 ? phase + 1 : phase;
}

export function stopAudio() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  if (liveOscs) { for (const osc of liveOscs) { try { osc.stop(0); } catch {} try { osc.disconnect(); } catch {} } liveOscs.clear(); }
  if (audioCtx) { for (const bs of bedStars.values()) teardownBedStar(bs, audioCtx.currentTime); for (const bs of dyingStars) teardownBedStar(bs, audioCtx.currentTime); }
  bedStars = new Map(); dyingStars = []; bedOscCount = 0; currentField = [];
  skyChordId = START_CHORD_ID; skyTabu = null; skyStep = -1; lastSyncedChordId = null;
  lead = null; schedIdx = 0; schedCycle = 0; transportStart = null;
  leadMask = null; leadMaskChordId = -1;
  if (audioCtx) { try { audioCtx.close(); } catch {} }
  audioCtx = null; pannerNode = null; distGainNode = null; muteGainNode = null; liveOscs = null;
  bedBus = null; reverbConv = null; reverbWet = null;
}

// Jump the scheduler's cursor to the next upcoming note at the current transport phase (used when a
// lead is (re)set or the tick rate changes) so playback picks up NOW instead of restarting the cycle.
function resyncSchedulePointer() {
  if (!audioCtx || !lead || !lead.notes.length) { schedIdx = 0; schedCycle = 0; return; }
  const ticks = absoluteTicks(audioCtx.currentTime);
  const cycleNow = Math.floor(ticks / lead.notes.length);
  const phase = ticks / lead.notes.length - cycleNow;
  const idx = lead.notes.findIndex(n => n.t >= phase);
  if (idx === -1) { schedIdx = 0; schedCycle = cycleNow + 1; } else { schedIdx = idx; schedCycle = cycleNow; }
}

function schedulerTick() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime, ticks = absoluteTicks(now);
  stepSkyWalk(ticks);          // the sky's own chord clock — independent of any lead (no click gating)
  pumpReattacks(now, ticks);
  ensureLeadMask(false);       // cheap cache-check; recomputes only right after stepSkyWalk changed the chord
  if (!lead || !lead.notes.length) return;
  const horizon = audioCtx.currentTime + SCHEDULE_AHEAD;
  while (true) {
    const note = lead.notes[schedIdx];
    const cycleTicks = lead.notes.length;
    const noteTicks = schedCycle * cycleTicks + note.t * cycleTicks;
    const time = transportStart + noteTicks / ticksPerSec;
    if (time > horizon) break;
    scheduleNote(note, time, schedIdx);
    schedIdx++;
    if (schedIdx >= lead.notes.length) { schedIdx = 0; schedCycle++; }
  }
}

function scheduleNote(note, time, noteIdx) {
  if (liveOscs.size >= MAX_LIVE_OSC) return;
  const freq = ROOT_HZ * note.ratio * (2 ** currentOctaveLift);
  const osc = audioCtx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
  const env = audioCtx.createGain();
  // Full Sky tint: in-(global-)chord onsets play full, out-of-chord onsets duck — the rhythm is
  // sacrosanct, no onset is ever skipped, the sky only tints it (M4 — replaces the per-star Chord Walk).
  const inChord = leadMask ? leadMask[noteIdx] : true;
  const peak = NOTE_PEAK * (inChord ? 1 : DUCK);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(peak, time + ATTACK);
  env.gain.exponentialRampToValueAtTime(0.001, time + ATTACK + DECAY);
  osc.connect(env); env.connect(pannerNode);
  osc.start(time); osc.stop(time + ATTACK + DECAY + 0.02);
  liveOscs.add(osc);
  osc.onended = () => { liveOscs.delete(osc); try { osc.disconnect(); } catch {} try { env.disconnect(); } catch {} };
}
