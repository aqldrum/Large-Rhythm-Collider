// cosmos-audio.js — Phase 0 dedicated audio layer for the Cosmos Flight instrument.
// "The rhythm plays its own tuning": a bloom node's composite onsets arpeggiate the node's own
// tuning system on one shared transport, spatialized by the star's live screen position.
// HARD RULE: fully separate from the site's playback engine. Do not import Core Interface/
// LRCModule.js, LRCSearch.js, Playback/* (AudioEngine/Scheduler/Partitions), Tone.js, or MIDIOut.
// The only shared code is the pure scale math below.
import { normalizeLayers, lcmAll, decimalToFraction } from './oracle-core.js';

const ROOT_HZ = 220;             // Phase 0: one root for every voice (per-star root is a later phase)
const LOOKAHEAD_MS = 25;         // scheduler tick cadence
const SCHEDULE_AHEAD = 0.1;      // seconds — schedule any note landing within this horizon
const MAX_LIVE_OSC = 48;         // defensive cap so a pathological dense grid can't runaway
const ATTACK = 0.008, DECAY = 0.22;   // soft short envelope so a busy melody (option A) doesn't smear
const NOTE_PEAK = 0.32;          // per-note envelope peak (kept modest — dense grids stack many notes)
const CYCLES_PER_CHORD = 2;      // Chord Walk: how many transport cycles each chord in the song holds
const DUCK = 0.25;               // -12dB — out-of-chord onsets duck, they never get skipped

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

// ── shared transport ──
let tempoT = 2.0;                 // seconds per cycle
let transportStart = null;        // audioCtx time of cycle 0 (n=0)
let lead = null;                  // { notes, grid, cardinality, node } | null
let schedIdx = 0, schedCycle = 0; // scheduler's cursor into lead.notes / current cycle number
let currentOctaveLift = 0;        // applies to NEWLY scheduled notes only (spec: don't repitch in flight)

// ── Chord Walk tint (Part B): dumb consumer of a Song from chord-walk.js — never solves, just masks ──
let song = null;                  // { frame, vocabularySize, transient, cycle } | null
let allChords = null;             // [...song.transient, ...song.cycle], cached alongside `song`
let noteMasks = null;             // noteMasks[chordIdx][noteIdx] = true if lead.notes[noteIdx] is in that chord

export function initAudio() {
  if (audioCtx && audioCtx.state !== 'closed') return;   // idempotent; also tolerates re-init after stopAudio()
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  pannerNode = audioCtx.createStereoPanner();
  distGainNode = audioCtx.createGain(); distGainNode.gain.value = 0;
  muteGainNode = audioCtx.createGain(); muteGainNode.gain.value = 1;
  pannerNode.connect(distGainNode); distGainNode.connect(muteGainNode); muteGainNode.connect(audioCtx.destination);
  transportStart = audioCtx.currentTime;   // one shared clock starts here; lead swaps ride the same phase
  liveOscs = new Set();
  schedIdx = 0; schedCycle = 0;
  schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_MS);
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

// voice = deriveVoice(node.layers) + {node}; (re)starts the transport melody. null = silence (transport keeps ticking).
export function setLead(voice) {
  lead = voice || null;
  if (lead) resyncSchedulePointer();
  else if (audioCtx) distGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
  recomputeMasks();   // note fractions are lead-dependent — a new lead needs fresh masks if a song is active
}

// song = a Song from chord-walk.js's solveStarSong(), or null to clear (Phase 0 behavior: all notes full).
export function setSong(newSong) {
  song = newSong || null;
  allChords = song ? [...song.transient, ...song.cycle] : null;
  recomputeMasks();
}

// → { symbol, cycleIndex } | null — cycleIndex indexes into [...song.transient, ...song.cycle] (for a
// cockpit strip renderer); null before the transport starts or when no song is active.
export function currentChord() {
  if (!song || !audioCtx || transportStart == null) return null;
  const n = Math.floor((audioCtx.currentTime - transportStart) / tempoT);
  const idx = chordIndexForCycle(n);
  const chord = idx >= 0 ? allChords[idx] : null;
  return chord ? { symbol: chord.symbol, cycleIndex: idx } : null;
}

// Transport cycle number n -> index into `allChords`. Chord step s = floor(n/CYCLES_PER_CHORD): the
// intro (transient) plays once, then the cycle loops forever — a pure function of n (tempo/resync-safe).
function chordIndexForCycle(n) {
  if (!song) return -1;
  const s = Math.floor(n / CYCLES_PER_CHORD);
  const tLen = song.transient.length, cLen = song.cycle.length;
  if (s < tLen) return s;
  return cLen ? tLen + ((s - tLen) % cLen) : (tLen ? tLen - 1 : -1);
}

// Per-chord in-lead-tone-row masks, precomputed once per (song, lead) pair (doc: "computed once").
// A note's fraction is the SAME decimalToFraction computation deriveScale used, so it matches a chord's
// windowFractions exactly when that gap-ratio is one of the star's own scale tones.
function recomputeMasks() {
  if (!song || !lead) { noteMasks = null; return; }
  const noteFractions = lead.notes.map(n => decimalToFraction(n.ratio));
  noteMasks = allChords.map(chord => {
    const maskSet = new Set(chord.windowFractions);
    return noteFractions.map(f => maskSet.has(f));
  });
}

// Called each frame from the flight loop for the lead star. pan in [-1,1], gain in [0,1].
export function setSpatial(pan, gain, octaveLift) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  pannerNode.pan.setTargetAtTime(pan, now, 0.05);
  distGainNode.gain.setTargetAtTime(gain, now, 0.05);
  currentOctaveLift = octaveLift;
}

// Seconds per cycle. Re-anchors the transport epoch so the CURRENT phase is preserved under the new
// period (a tempo change glides the cycle speed rather than jumping the playhead).
export function setTempo(T) {
  if (!audioCtx) { tempoT = T; return; }
  const now = audioCtx.currentTime;
  const cyclesElapsed = (now - transportStart) / tempoT;
  tempoT = T;
  transportStart = now - cyclesElapsed * tempoT;
  if (lead) resyncSchedulePointer();
}

export function setMuted(bool) {
  if (!audioCtx) return;
  muteGainNode.gain.setTargetAtTime(bool ? 0 : 1, audioCtx.currentTime, 0.02);
}

// 0..1 position within the current cycle, for the cockpit playhead. 0 before the transport starts.
export function transportPhase() {
  if (!audioCtx || transportStart == null) return 0;
  const phase = ((audioCtx.currentTime - transportStart) / tempoT) % 1;
  return phase < 0 ? phase + 1 : phase;
}

export function stopAudio() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  if (liveOscs) { for (const osc of liveOscs) { try { osc.stop(0); } catch {} try { osc.disconnect(); } catch {} } liveOscs.clear(); }
  lead = null; schedIdx = 0; schedCycle = 0; transportStart = null;
  song = null; allChords = null; noteMasks = null;
  if (audioCtx) { try { audioCtx.close(); } catch {} }
  audioCtx = null; pannerNode = null; distGainNode = null; muteGainNode = null; liveOscs = null;
}

// Jump the scheduler's cursor to the next upcoming note at the current transport phase (used when a
// lead is (re)set or the tempo changes) so playback picks up NOW instead of restarting the cycle.
function resyncSchedulePointer() {
  if (!audioCtx || !lead || !lead.notes.length) { schedIdx = 0; schedCycle = 0; return; }
  const elapsed = audioCtx.currentTime - transportStart;
  const cycleNow = Math.floor(elapsed / tempoT);
  const phase = elapsed / tempoT - cycleNow;
  const idx = lead.notes.findIndex(n => n.t >= phase);
  if (idx === -1) { schedIdx = 0; schedCycle = cycleNow + 1; } else { schedIdx = idx; schedCycle = cycleNow; }
}

function schedulerTick() {
  if (!audioCtx || !lead || !lead.notes.length) return;
  const horizon = audioCtx.currentTime + SCHEDULE_AHEAD;
  while (true) {
    const note = lead.notes[schedIdx];
    const time = transportStart + schedCycle * tempoT + note.t * tempoT;
    if (time > horizon) break;
    scheduleNote(note, time, schedIdx, schedCycle);
    schedIdx++;
    if (schedIdx >= lead.notes.length) { schedIdx = 0; schedCycle++; }
  }
}

function scheduleNote(note, time, noteIdx, cycleN) {
  if (liveOscs.size >= MAX_LIVE_OSC) return;
  const freq = ROOT_HZ * note.ratio * (2 ** currentOctaveLift);
  const osc = audioCtx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
  const env = audioCtx.createGain();
  // Chord Walk tint: in-chord onsets play full, out-of-chord onsets duck — the rhythm is sacrosanct,
  // no onset is ever skipped, harmony only tints it. No song → always full (Phase 0 behavior).
  const chordIdx = song ? chordIndexForCycle(cycleN) : -1;
  const inChord = chordIdx < 0 || !noteMasks ? true : noteMasks[chordIdx][noteIdx];
  const peak = NOTE_PEAK * (inChord ? 1 : DUCK);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(peak, time + ATTACK);
  env.gain.exponentialRampToValueAtTime(0.001, time + ATTACK + DECAY);
  osc.connect(env); env.connect(pannerNode);
  osc.start(time); osc.stop(time + ATTACK + DECAY + 0.02);
  liveOscs.add(osc);
  osc.onended = () => { liveOscs.delete(osc); try { osc.disconnect(); } catch {} try { env.disconnect(); } catch {} };
}
