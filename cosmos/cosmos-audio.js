// cosmos-audio.js — Phase 0 dedicated audio layer for the Cosmos Flight instrument.
// "The rhythm plays its own tuning": a bloom node's composite onsets arpeggiate the node's own
// tuning system on one shared transport, spatialized by the star's live screen position.
// HARD RULE: fully separate from the site's playback engine. Do not import Core Interface/
// LRCModule.js, LRCSearch.js, Playback/* (AudioEngine/Scheduler/Partitions), Tone.js, or MIDIOut.
// The only shared code is the pure scale math below.
import { normalizeLayers, lcmAll, ratioToCents } from './oracle-core.js';
import { nearestDegree } from './grid-core.js';
// Full Sky (cosmos/FULL_SKY_HANDOFF.md): the global progression + its one gain law. Pure, no DOM.
import { CHORDS, START_CHORD_ID, chooseNextChord, candidateCosts, pushTabu, chordStepIndex, coverage as skyCoverage, perDegreeSupport, gainForDev } from './sky-walk.js';
import { normalizeRootLadder, resetPhraseTracker, observePhraseBoundary, pushRecentRoot,
  classifyRootDestinations, rankModulationDestinations, decideRootAtBoundary } from './sky-modulation.js';
import { AUDIO_MODES, RHYTHM_VOICE_WAVEFORM, ownerChordMatch } from './cosmos-grid-audio-core.js';
import { SpatialGridRowPlayer } from './spatial-grid-row-player.js';
import { CosmosMidiOut } from './cosmos-midi-out.js';

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
// ── CHORD CLOCK (Phase 0.3) ──────────────────────────────────────────────────────────────────────
// The fixed 25.6s chord window (old CHORD_SECONDS = 256 ticks / 10) is retired. The clock is now three
// quantities, all in SKY-CLOCK seconds and all derived from the CURRENT grid cycle so harmonic rhythm
// scales with playback the way the grid does — and it is identical at every MIX position:
//   • FLOOR   — full exposure is required before any advance (the old "expose the full quality" hold,
//               now UNCONDITIONAL at every mix; the checkbox is gone — decision 3).
//   • TARGET  — DWELL sets how long PAST exposure a chord dwells, as a fraction of one cycle. 0 (the
//               default until the Phase 2.2 knob binds it) = advance the moment it is exposed = today's
//               full quality. With no rows sounding (no cycle) the fraction maps to a nominal-cycle second.
//   • ESCAPE  — a cap so a degree the field cannot voice (or a chord flown away from) still releases:
//               CHORD_ESCAPE_MULT full cycles = 4× the maximum DWELL target, generous headroom below it.
// Advances quantize to a 1/8-cycle grid so a chord change lands on the form (spirit of ROW_SWITCH_TICKS).
const NOMINAL_FALLBACK_CYCLE_SECONDS = 24;   // DWELL's cycle reference when no rows sound (≈ the old window)
const CHORD_QUANTIZE_DIVISIONS = 8;          // advance lands on a 1/8-cycle boundary
const CHORD_ESCAPE_MULT = 4;                 // escape cap = 4 full cycles (= 4× the max DWELL target)
const TABU_K = 3;                // sky-walk tabu length (chord-walk.js's exact convention)
const TUNING_STRENGTH_MAX = 8;
let LAMBDA_FIELD = 2.0;          // live local-tuning pull, in semitones of voice-leading cost
// How far the sky reaches past the triad, in semitones of voice-leading cost — earned, so the walk
// scales it by the chord's weakest-supported degree: extensions are cheap where the sky is well tuned
// across all of the chord's degrees and full price where the extra degree has nothing to sound on.
// Swept over 12 real codex locations × 40 chords (triad / 7th / 9th / 11th-13th share of the walk):
//   0.00  44% 29% 19%  8%      0.08  11% 50% 28% 11%
//   0.02  32% 47% 19%  3%      0.12  10% 52% 27% 11%
//   0.05  20% 50% 25%  5%      0.18   6% 50% 32% 12%
// It saturates past ~0.12 (leveling the field term leaves triads and 7ths near-tied, so a small nudge
// moves most of them at once). 0.05 keeps the triad a real home base while making the 7th the sky's
// common currency; 0 reproduces the previous triad-dominated walk.
let RICHNESS = 0.05;             // live from Phase 2.3 (setRichness); was a const at the swept knee
const MAX_BED_OSC = 30;          // bed oscillator budget (≤3 tones/star × AUDIBLE_N=10), alongside MAX_LIVE_OSC
const BED_ATTACK = 1.5, BED_RELEASE = 2.5;   // seconds — long swells, this is half the product
const BED_PEAK = 0.12;           // per-voice envelope peak (modest — many sustained voices sum)
const BED_SUSTAIN_FRAC = 0.4;    // a swell settles to this fraction of its peak, not to silence (held pad)
const REATTACK_PERIODS = [4.5, 5.6, 6.4, 8.1, 10];   // SKY-CLOCK seconds; mutually near-coprime so the sky
                                  // breathes as a polyrhythm, not a synchronized pad — REATTACK_PERIODS[hash(id)%n]
// SCALED SPEED. A row program's loop is `grid` ticks long, so at a fixed rate a star's cycle lasts
// grid/ticksPerSec seconds — 12s at grid 120 but 103 MINUTES at grid 61600. That is why the polyrhythmic
// chorus only ever emerged down at the low grids: up high you were hearing a few isolated onsets out of
// a cycle you would never live to finish. Scaled mode instead derives the rate from the median grid
// actually sounding, so a cycle lasts SCALED_CYCLE_SECONDS wherever you are. Measured over real grids at
// a 12s cycle, onset density stays musical the whole way up (grid 120: 12 events, 1.0/s → grid 61600:
// 92 events, 7.7/s) — bigger grids read as denser chorus, not as a buzz.
// MODULATION. Every tone in the sky is absolute JI against a fixed 1/1 = ROOT_HZ, so solving a new root
// only ever RE-READ those same pitches in a new frame — the harmony was reinterpreted but nothing moved,
// which is why a root change recoloured instead of modulating. Modulation retunes the SOLVED ROOT to the
// fundamental: shift the whole sky by −rootCents and the new root sits at ROOT_HZ's pitch class, so the
// key change is heard as one. The shift is derived fresh from the current root every time (never
// accumulated), so repeated modulations cannot drift the sky off its frame.
//
// Folded to the nearest octave-equivalent shift, i.e. into [−600, +600). Literal "root → exactly ROOT_HZ"
// would drop the sky by up to a full octave for a high-cents root and leap back up on the next
// modulation; every tone is octave-folded into a register downstream anyway, so the fold keeps the root
// on ROOT_HZ's pitch class while bounding the move to a tritone.
const MODULATION_DEFAULT = false;
// FUNDAMENTAL is a second, user-driven detune offset, summed with modulation on the same bus (Phase 0.2):
// two ConstantSourceNodes in CENTS whose sum feeds every oscillator's detune AND the MIDI spelling, so one
// gesture never overwrites the other's automation. Bounded to ±2 octaves — ample pitch travel while the
// total (with modulation's ≤-tritone shift) stays inside the ±48-semitone MPE bend range, so a modulated,
// transposed note still spells at its true sounding pitch. Rides modulation's exact portamento law (glide).
const FUNDAMENTAL_OFFSET_MAX_CENTS = 2400;
// Portamento law is the main LRC page's (Playback/ToneRowPlayback.js handleFundamentalChange):
// setTargetAtTime, an exponential approach with a TIME CONSTANT. Same curve, applied at a different
// point — see the detune bus in initAudio for why cosmos cannot retune per-voice the way that page does.
//
// Length is measured in ONSETS, converted through the grid clock: glideTicks = onsets × the field's mean
// onset gap in ticks, then seconds = glideTicks / ticksPerSec. Ticks, not milliseconds, so the glide
// keeps its proportion when scaled speed changes the rate — but onsets rather than a fraction of a CYCLE,
// because cycles are not comparable across grids. Real event counts per cycle run 10 (grid 120) to 92
// (grid 61600), so a quarter-cycle glide spanned 3 onsets down low and 23 up high: identical seconds,
// wildly different musical length. Onsets is also what the ear is actually counting here — a row voice is
// a 140ms pluck, so a glide is heard as a STAIRCASE, and the number of steps is the number of onsets.
const ROOT_GLIDE_ONSETS = 3;
const ROOT_GLIDE_MIN_SECONDS = 0.15, ROOT_GLIDE_MAX_SECONDS = 4;   // a fixed-rate monster grid can put 67s
                                  // between onsets; a dense one can put 130ms. Both must still be a glide.
const ROOT_GLIDE_SECONDS_DEFAULT = 1;   // ambient mode has no onsets to scale against
const SPEED_MODES = Object.freeze({ FIXED: 'fixed', SCALED: 'scaled', ONSET: 'onset' });
const SCALED_CYCLE_DEFAULT = 12;   // seconds per grid cycle — grid 120's cycle at the historical 10 ticks/s
const SCALED_RATE_MIN = 1, SCALED_RATE_MAX = 8000;   // ticks/s clamp; 8000 covers the largest charted grids
const SCALED_RATE_HYSTERESIS = 0.06;   // only re-anchor the transport when the target moves >6% — the median
                                  // grid is a discrete step function, and every change re-anchors the epoch
// SPEED knob (Phase 2.1, decision 2): denominated in TARGET ONSETS/SEC, log-scaled slow→fast. ticks/s AND
// cycle-seconds both become DERIVED: ticksPerSec = clamp(targetOnsetRate × fieldOnsetTicks), since
// onsets/sec × ticks/onset = ticks/sec. The [SCALED_RATE_MIN, MAX] tick clamp stays (a monster grid runs
// slightly under target at the cap). Range ~today's 12s-cycle scaled feel; the default is frozen by ear in 2.1.
const SPEED_ONSET_MIN = 0.5, SPEED_ONSET_MAX = 16, SPEED_ONSET_DEFAULT = 2.5;
const REVERB_WET = 0.3;          // shared send level (also SPACE's ambient send at the knob midpoint — see setSpace)
const REVERB_SECONDS = 4, REVERB_DECAY = 3;   // procedural impulse: exp-decaying noise burst, no assets
const ROOT_TOP_K = 8;            // how much of the ranked ladder the debug overlay shows
// VOLUME knob (Phase 2.3): master gain AHEAD of the safety limiter; mute stays its own button. Engine
// default is unity so nothing changes until the rail pushes its own value on startup.
const MASTER_VOLUME_DEFAULT = 1;
// SPACE knob (Phase 2.3): one knob driving BOTH reverb sends, each calibrated so the knob MIDPOINT (0.5,
// the rail default) reproduces today's levels — ambient 0.3, rows 0.35 — and travel feels continuous.
const SPACE_DEFAULT = 0.5, SPACE_AMBIENT_WET_AT_HALF = REVERB_WET, SPACE_ROW_WET_AT_HALF = 0.35;
const RICHNESS_MAX = 0.18;       // RICHNESS knob (Phase 2.3) ceiling — the top of the swept table above

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

// ── audio graph: three independent gain buses → shared mute-gain → limiter → out ──
// bedGain    — ambient-chord bed (swells, reverb, the sustained pad)
// rowsGain   — spatial culled-row voices (3D HRTF, the rhythmic chorus)
// auditionGain — clicked-star lead (the audition arpeggio, independent of mix)
// MIX crossfades bedGain ↔ rowsGain (constant-power cos/sin); auditionGain is standalone.
let audioCtx = null, pannerNode = null, distGainNode = null, muteGainNode = null, outputLimiter = null;
let bedGain = null, rowsGain = null, auditionGain = null;
let masterVolume = null;          // VOLUME knob: master gain between muteGainNode and the safety limiter
let lastVolume = MASTER_VOLUME_DEFAULT;   // persisted musical setting (readout + re-entry); node tracks it
let lastSpace = SPACE_DEFAULT;    // persisted SPACE position; drives both reverb sends (see setSpace)
let liveOscs = null;              // Set of live OscillatorNodes (capacity-capped)
let schedulerTimer = null;
let mix = 0;                      // 0 = bed, 1 = rows; constant-power crossfade
let auditionListening = true;     // audition bus on/off (independent of mix)
let auditionPinned = false;       // pin keeps audition audible after deselection
let gridRowPlayer = null;

// ── TWO CLOCKS ─────────────────────────────────────────────────────────────────────────────────
// GRID CLOCK (ticks). A fixed TICK RATE (ticks/sec), not a fixed cycle duration. For the lead, a
// "tick" is one ONSET (lead.notes.length ticks = one full cycle) — NOT one grid-step: `grid` is the
// LCM of the layers and can be tens of thousands even for a modest rhythm, which made cycles hours
// long when ticks were grid-steps. Using the onset count instead pins the average note rate to
// ticksPerSec regardless of grid size, while note.t fractions still preserve the exact (uneven) onset
// spacing within the cycle. Row programs DO run on grid-steps (a program's loop is `grid` ticks), which
// is exactly why the rate has to be able to scale with the local grid — see setSpeedMode.
//
// SKY CLOCK (seconds). Wall-clock seconds since the audio context started, NEVER re-anchored. The
// chord walk, the bed's re-swells and the root policy's settle/rate-limit are all "how long a listener
// experiences this harmony" quantities: they must not speed up when playback does. Keeping them on
// ticks is what would make scaled speed unusable — at grid 61600's ~5100 ticks/s the 256-tick chord
// window would fire every 50ms. The two clocks agree exactly at the historical 10 ticks/s default,
// which is how every seconds constant below was derived.
let ticksPerSec = 10;              // default: 10 ticks/sec (~100ms/tick) — slow enough to actually listen
let transportStart = null;        // audioCtx time at which the absolute tick counter reads 0 (re-anchored on rate change)
let audioEpoch = null;            // audioCtx time the transport started — the sky clock's fixed origin
let lead = null;                  // { notes, grid, cardinality, node } | null
let schedIdx = 0, schedCycle = 0; // scheduler's cursor into lead.notes / current cycle number
let currentOctaveLift = 0;        // applies to NEWLY scheduled notes only (spec: don't repitch in flight)
const absoluteTicks = now => (now - transportStart) * ticksPerSec;   // monotonic tick count since transport start
const skySeconds = now => (audioEpoch == null ? 0 : now - audioEpoch);   // monotonic wall seconds, rate-independent

// ── Full Sky lead tint (M4): the lead's chord mask now comes from the GLOBAL walk, not a per-star
// song — solveStarSong is no longer called from the click path. Ducks (−12dB), never silences: the
// clicked star's own rhythm stays sacrosanct, the sky only tints it.
let leadMask = null;              // leadMask[noteIdx] = true if lead.notes[noteIdx] is in the CURRENT sky chord
let leadMaskChordId = -1;         // which skyChordId leadMask was computed against (cache invalidation)
let leadMaskRootKey = -1;         // root swaps independently invalidate the same mask

// ── Full Sky: the global chord walk (online, stateful — not precomputed) + the ambient bed ──
let skyChordId = START_CHORD_ID, skyTabu = null, skyStep = -1;   // walk state; skyStep=-1 = not yet observed
let chordStartedAt = 0;           // sky-clock seconds the current chord began — the dwell/exposure origin
let dwellFraction = 0;            // DWELL knob [0,1]: chord dwell as a fraction of the cycle PAST full exposure.
                                  // 0 = advance the moment exposed (the old full-quality hold, now the default).
                                  // A persisted musical setting (decision 8); Phase 2.2 binds the knob to setDwell.
let lastChordExposure = { degrees: [], sounded: [], complete: true, heldSeconds: 0 };   // overlay-only snapshot
let lastChordClock = { cycleSeconds: NOMINAL_FALLBACK_CYCLE_SECONDS, targetSeconds: 0, quantumSeconds: NOMINAL_FALLBACK_CYCLE_SECONDS / CHORD_QUANTIZE_DIVISIONS, escapeSeconds: NOMINAL_FALLBACK_CYCLE_SECONDS * CHORD_ESCAPE_MULT };   // overlay-only
let lastChordSeconds = 0;         // how long the PREVIOUS chord actually lasted — the pacing readout
let modulationOn = MODULATION_DEFAULT;
// Two summed detune offsets on one bus (Phase 0.2). fundamentalOffset = the FUNDAMENTAL knob's global
// transpose; modulationOffset = the root-modulation glide (was `rootDetune`). Both are ConstantSourceNodes
// in CENTS; detuneBus is a unity GainNode that SUMS them and is what every oscillator's detune connects to,
// so the two automations are independent yet the ensemble hears (and MIDI spells) their sum.
let fundamentalOffset = null, modulationOffset = null, detuneBus = null;
let lastModulationCents = 0;      // the modulation shift currently gliding to / settled at (overlay + re-derivation)
let lastFundamentalCents = 0;     // the fundamental offset currently gliding to / settled at (overlay + persistence)
// A detune bus is a live signal, so nothing downstream can READ where a glide is partway through. Recording
// each curve's parameters lets modulationCentsAt()/fundamentalCentsAt() (and their sum, totalDetuneCentsAt)
// reproduce it exactly — which is what the MIDI mirror needs, since a note scheduled inside the lookahead
// has to be spelled at the pitch it will actually sound at, not at either glide's start or its destination.
let modulationGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
let fundamentalGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
let cosmosMidi = null;
let bedSoundedDegrees = new Set();   // ambient-mode half of the exposure ledger, cleared at each chord change
let speedMode = SPEED_MODES.FIXED;
let scaledCycleSeconds = SCALED_CYCLE_DEFAULT;
let targetOnsetRate = SPEED_ONSET_DEFAULT;   // SPEED knob: target onsets/sec (ONSET mode); ticks/s derives from it
let fixedTickRate = 10;           // the raw ticks/s the tempo slider last asked for — restored on leaving scaled mode
let scaledMedianGrid = 0;         // most recent median sounding grid (overlay + rate derivation)
let fieldOnsetTicks = 0;          // median ticks between composite onsets across the field (glide length)
let currentField = [];            // last setField() items — also the input to coverage()
// The solved harmonic frame starts on a PROVISIONAL 1/1 so playback has a deterministic anchor before
// the first geographic solve. The first valid solve establishes it (possibly retaining 1/1) at a chord
// boundary; all later changes use the live normalized geography/exhaustion policy. rootKey is an opaque
// cache version (not cents — floats and revisits make poor cache keys).
let skyRoot = { fraction: '1/1', cents: 0, rootKey: 0 }, rootKeyCounter = 0;
let lastRootLadder = [];           // most recent solve's full ladder, kept for the debug overlay (survives consumption)
let rootEstablished = false;
let rootPhraseTracker = null;
let recentSkyRoots = [];
let lastRootPolicyProposal = null;
let rootPolicyContext = { settled: false, currentEpoch: 0 };
let lastRootDecision = null;
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
  // Three independent gain buses — MIX crossfades bed ↔ rows (constant-power); audition is standalone.
  bedGain = audioCtx.createGain(); bedGain.gain.value = 1;        // cos(0·π/2) = 1; mix starts at 0 (bed)
  rowsGain = audioCtx.createGain(); rowsGain.gain.value = 0;      // sin(0·π/2) = 0
  auditionGain = audioCtx.createGain(); auditionGain.gain.value = 1;
  bedGain.connect(muteGainNode);
  rowsGain.connect(muteGainNode);
  auditionGain.connect(muteGainNode);
  // Final safety rail for rare dense-grid/reverb summation. Click prevention belongs to the per-voice
  // envelopes; this catches only exceptional aggregate peaks after every Cosmos dry/wet path is summed.
  outputLimiter = audioCtx.createDynamicsCompressor();
  outputLimiter.threshold.value = -6;
  outputLimiter.knee.value = 0;
  outputLimiter.ratio.value = 20;
  outputLimiter.attack.value = 0.003;
  outputLimiter.release.value = 0.1;
  // VOLUME sits between the mute and the limiter — a musical master trim ahead of the safety catch.
  masterVolume = audioCtx.createGain(); masterVolume.gain.value = lastVolume;
  pannerNode.connect(distGainNode); distGainNode.connect(auditionGain);
  muteGainNode.connect(masterVolume); masterVolume.connect(outputLimiter); outputLimiter.connect(audioCtx.destination);
  // Full Sky bed bus: dry sum -> bedGain, plus a shared send through a procedural reverb (no assets).
  bedBus = audioCtx.createGain(); bedBus.gain.value = 1; bedBus.connect(bedGain);
  reverbConv = audioCtx.createConvolver(); reverbConv.buffer = makeImpulse(audioCtx);
  reverbWet = audioCtx.createGain(); reverbWet.gain.value = REVERB_WET;
  bedBus.connect(reverbConv); reverbConv.connect(reverbWet); reverbWet.connect(bedGain);
  // One shared detune bus in CENTS, summed into EVERY oscillator's `detune` param. The main LRC page
  // retunes each sounding oscillator's frequency directly, which works there because its voices are held.
  // Cosmos cannot: row voices are a 140ms gate and are constantly reborn, so a per-voice retune would
  // glide only the handful of notes already dying while every new note jumped straight to the target —
  // the ensemble would step, not glide. A live control signal instead glides notes that do not exist yet:
  // an oscillator born mid-glide reads the bus at its own start and lands exactly on the curve.
  // Two independent sources feed it: fundamentalOffset (the FUNDAMENTAL knob) and modulationOffset (the
  // root-modulation glide). detuneBus (unity gain) sums them, so oscillators connect the one bus while each
  // gesture keeps its own automation — and totalDetuneCentsAt reproduces the sum for the MIDI spelling.
  fundamentalOffset = audioCtx.createConstantSource(); fundamentalOffset.offset.value = 0; fundamentalOffset.start();
  modulationOffset = audioCtx.createConstantSource(); modulationOffset.offset.value = 0; modulationOffset.start();
  detuneBus = audioCtx.createGain(); detuneBus.gain.value = 1;
  fundamentalOffset.connect(detuneBus);
  modulationOffset.connect(detuneBus);
  cosmosMidi = new CosmosMidiOut(audioCtx);
  // The row player stays harmony-blind: it hands over pitch, time, length and loudness, and this bridge
  // supplies the one harmonic fact it does not own — where the summed detune (fundamental + modulation) is
  // at that instant, so the DAW spells the note at the pitch the browser will actually sound.
  const midiBridge = {
    note: (hz, when, seconds, gain) => cosmosMidi?.note(hz, when, seconds, { cents: totalDetuneCentsAt(when), gain }),
  };
  gridRowPlayer = new SpatialGridRowPlayer(audioCtx, rowsGain, detuneBus, midiBridge);
  gridRowPlayer.setEnabled(true);   // always on — rowsGain handles the crossfade
  mix = 0; auditionListening = true; auditionPinned = false;
  skyChordId = START_CHORD_ID; skyTabu = pushTabu([], skyChordId, TABU_K); skyStep = -1; lastSyncedChordId = null;
  skyRoot = { fraction: '1/1', cents: 0, rootKey: 0 }; rootKeyCounter = 0; lastRootLadder = [];
  rootEstablished = false;
  rootPhraseTracker = resetPhraseTracker(skyRoot.rootKey, skyChordId, skyTabu);
  recentSkyRoots = []; lastRootPolicyProposal = null; rootPolicyContext = { settled: false, currentEpoch: 0 }; lastRootDecision = null;
  bedStars = new Map(); bedOscCount = 0; currentField = [];
  transportStart = audioCtx.currentTime;   // grid clock starts here; lead swaps ride the same phase
  audioEpoch = transportStart;             // sky clock shares the origin but is never re-anchored after this
  chordStartedAt = 0; lastChordSeconds = 0; lastChordExposure = { degrees: [], sounded: [], complete: true, heldSeconds: 0 };
  lastModulationCents = 0; modulationGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  lastFundamentalCents = 0; fundamentalGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  scaledMedianGrid = 0; fieldOnsetTicks = 0;
  liveOscs = new Set();
  schedIdx = 0; schedCycle = 0;
  schedulerTimer = setInterval(schedulerTick, LOOKAHEAD_MS);
  // No click gating (Avery, planning session): the bed is audible from here — cosmos entry + unlock —
  // with zero stars clicked, as soon as flight-view starts feeding it setField() each frame.
}

export function currentMix() { return mix; }

// Constant-power crossfade between bed (0) and rows (1). Both engines stay warm across the full
// range — the bed keeps scheduling with gain gated at the rows end, and the row compile/prewarm
// pipeline continues with attacks gated at the bed end. The knob is responsive in both directions.
export function setMix(x) {
  mix = Math.max(0, Math.min(1, +x || 0));
  if (!audioCtx) return mix;
  const now = audioCtx.currentTime;
  const bedLevel = Math.cos(mix * Math.PI / 2);
  const rowsLevel = Math.sin(mix * Math.PI / 2);
  bedGain.gain.cancelScheduledValues(now);
  bedGain.gain.setTargetAtTime(bedLevel, now, 0.05);
  rowsGain.gain.cancelScheduledValues(now);
  rowsGain.gain.setTargetAtTime(rowsLevel, now, 0.05);
  return mix;
}

export function setAuditionListen(on) {
  auditionListening = !!on;
  if (!audioCtx) return auditionListening;
  const now = audioCtx.currentTime;
  auditionGain.gain.cancelScheduledValues(now);
  auditionGain.gain.setTargetAtTime(auditionListening ? 1 : 0, now, 0.05);
  return auditionListening;
}
export function currentAuditionListen() { return auditionListening; }

export function setAuditionPin(on) { auditionPinned = !!on; return auditionPinned; }
export function currentAuditionPin() { return auditionPinned; }

export function setGridSpatialField(items) {
  if (!audioCtx || !gridRowPlayer) return;
  noteFieldStats(items);           // always — the glide scales to the field even in fixed-rate mode
  applyScaledRate();               // before setField: the boundary tick it stamps must use the new rate
  gridRowPlayer.setField(items || [], currentTicks());
}

// What the sounding field looks like, independent of speed mode: its median grid (scaled speed's input)
// and its median onset gap in ticks (the portamento's input). Median on both, for the same reason — the
// active set spans orders of magnitude and one distant monster must not drag the sky's pace or its glide.
function noteFieldStats(items) {
  const grids = [], gaps = [];
  for (const item of items || []) {
    const grid = item.program?.grid, events = item.program?.events?.length;
    if (!Number.isFinite(grid)) continue;
    grids.push(grid);
    if (events > 0) gaps.push(grid / events);   // mean ticks between this star's composite onsets
  }
  if (!grids.length) return;
  grids.sort((a, b) => a - b); gaps.sort((a, b) => a - b);
  scaledMedianGrid = grids[grids.length >> 1];
  fieldOnsetTicks = gaps.length ? gaps[gaps.length >> 1] : 0;
}

// Scaled speed: hold one grid cycle at scaledCycleSeconds by deriving ticks/s from the MEDIAN grid
// currently sounding. Median, not mean, because the active set spans orders of magnitude and one
// distant monster must not drag the whole sky's pace with it. Only re-derives past a hysteresis band —
// the median is a discrete step function over a churning star set, and every rate change re-anchors
// the transport epoch, so tracking it exactly would jitter the pace continuously while flying.
// Pure part, exported so a headless guard can verify the law without a live AudioContext: the median
// grid of the sounding field, and the clamped rate that makes ONE grid cycle last cycleSeconds.
// → null when there is no row field at all (ambient mode), which means "keep the rate we have".
export function scaledRateFor(grids, cycleSeconds) {
  const sorted = (grids || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length || !(cycleSeconds > 0)) return null;
  const medianGrid = sorted[sorted.length >> 1];
  return { medianGrid, ticksPerSec: Math.max(SCALED_RATE_MIN, Math.min(SCALED_RATE_MAX, medianGrid / cycleSeconds)) };
}

// SPEED's onset-rate analog of scaledRateFor (Phase 2.1), pure for the same headless guarding. A target
// note rate in onsets/sec becomes a tick rate through the field's mean onset gap: onsets/sec × ticks/onset
// = ticks/sec, clamped by the same [SCALED_RATE_MIN, SCALED_RATE_MAX] rail. → null when no onset gap is
// known yet (no rows sounding), meaning "keep the rate we have", exactly like scaledRateFor.
export function onsetRateToTickRate(onsetRate, onsetTicks) {
  if (!(onsetRate > 0) || !(onsetTicks > 0)) return null;
  return { onsetTicks, ticksPerSec: Math.max(SCALED_RATE_MIN, Math.min(SCALED_RATE_MAX, onsetRate * onsetTicks)) };
}

// Both SCALED and ONSET re-derive the tick rate as the field churns (same hysteresis band — the median
// grid and the median onset gap are both discrete step functions, and every change re-anchors the epoch).
function applyScaledRate() {
  const derived = speedMode === SPEED_MODES.SCALED ? scaledRateFor([scaledMedianGrid], scaledCycleSeconds)
    : speedMode === SPEED_MODES.ONSET ? onsetRateToTickRate(targetOnsetRate, fieldOnsetTicks)
    : null;
  if (!derived) return;
  if (Math.abs(derived.ticksPerSec - ticksPerSec) / Math.max(derived.ticksPerSec, ticksPerSec) > SCALED_RATE_HYSTERESIS) {
    setTickRate(derived.ticksPerSec);
  }
}

// 'scaled' derives ticks/s from the local grid; 'fixed' restores whatever the tempo slider last set.
export function setSpeedMode(mode, cycleSeconds) {
  speedMode = Object.values(SPEED_MODES).includes(mode) ? mode : SPEED_MODES.FIXED;
  if (Number.isFinite(+cycleSeconds) && +cycleSeconds > 0) scaledCycleSeconds = +cycleSeconds;
  if (speedMode === SPEED_MODES.FIXED) { scaledMedianGrid = 0; setTickRate(fixedTickRate); }
  else if (scaledMedianGrid > 0) {
    setTickRate(Math.max(SCALED_RATE_MIN, Math.min(SCALED_RATE_MAX, scaledMedianGrid / scaledCycleSeconds)));
  }
  return { mode: speedMode, cycleSeconds: scaledCycleSeconds, ticksPerSec, medianGrid: scaledMedianGrid };
}

// SPEED knob binding (Phase 2.1): set the target note rate in onsets/sec, switching speed into ONSET mode
// (SPEED replaces the fixed/scaled toggle — decision 9). ticks/s re-derives immediately from the current
// field's onset gap; the readout's cycle is the derived grid/rate. Clamped to the knob's [MIN, MAX] range.
export function setTargetOnsetRate(rate) {
  const n = Number(rate);
  targetOnsetRate = Math.max(SPEED_ONSET_MIN, Math.min(SPEED_ONSET_MAX, Number.isFinite(n) ? n : SPEED_ONSET_DEFAULT));
  speedMode = SPEED_MODES.ONSET;
  const derived = onsetRateToTickRate(targetOnsetRate, fieldOnsetTicks);
  if (derived && audioCtx) setTickRate(derived.ticksPerSec);
  return targetOnsetRate;
}
export function currentTargetOnsetRate() { return targetOnsetRate; }

// MIDI Out. Off by default; enabling asks for Web MIDI access and picks the IAC/loopMIDI bus if one is
// there. Async because requestMIDIAccess is — the caller gets {ok, port} or {ok:false, reason} to show.
export async function setMidiOut(on) {
  if (!cosmosMidi) return { ok: false, reason: 'audio not started' };
  if (!on) { cosmosMidi.disable(); return { ok: true, port: null }; }
  return cosmosMidi.enable();
}
export function midiOutState() { return cosmosMidi?.debugState() || { enabled: false, supported: false }; }

// Synchronous MIDI panic for page-unload (pagehide/beforeunload): a hard refresh, tab close, or Chrome
// quit never calls stopAudio, so held MIDI notes would hang forever on the receiving DAW/synth — the sound
// outlives the browser process because it's the RECEIVER holding them. Must be synchronous (no fade / no
// setTimeout — the page is dying). No-op if MIDI-out was never enabled. flight-boot wires the listener.
export function panicMidiOut() { try { cosmosMidi?.allNotesOff(); } catch {} }

// DEPRECATED (Phase 0.3): full exposure is now an unconditional advance floor at every mix position, so
// there is nothing to toggle — the checkbox is absorbed into the always-on floor + DWELL (decision 3) and
// removed with the cockpit in the rail phase. Kept as a no-op so the current UI wiring doesn't throw.
export function setHoldForFullQuality() { return true; }

// DWELL knob (Phase 0.3 policy; the log knob mapping + persistence arrive in Phase 2.2 / Phase 1). Chord
// dwell PAST full exposure as a fraction of one cycle, clamped [0,1]; 0 = advance the moment it is exposed.
export function setDwell(fraction) {
  const n = Number(fraction);
  dwellFraction = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  return dwellFraction;
}
export function currentDwell() { return { fraction: dwellFraction, ...lastChordClock }; }

// Pure: the cent shift that puts a solved root on the fundamental's pitch class, folded to the nearest
// octave-equivalent so the move is at most a tritone in either direction. Modulation off → 0, which is
// exactly the previous behaviour (absolute JI against a fixed 1/1). Derived from the CURRENT root alone,
// so it is idempotent — re-applying it never compounds, and no sequence of modulations can drift.
export function modulationCentsFor(rootCents, on = true) {
  if (!on || !Number.isFinite(rootCents)) return 0;
  let shift = -(((rootCents % 1200) + 1200) % 1200);   // (-1200, 0]
  if (shift < -600) shift += 1200;                     // fold to the nearer direction: [-600, 600)
  return shift;
}

// Pure: portamento length in SECONDS from a length in ONSETS, so the glide spans the same number of
// notes at any grid or tick rate. onsetTicks = the field's mean ticks between composite onsets.
// Clamped at both ends — a fixed-rate monster grid can put 67s between onsets and a dense scaled one
// 130ms, and both still have to read as a glide rather than a drift or a jump.
export function rootGlideSeconds(onsetTicks, ticksPerSecond, onsets = ROOT_GLIDE_ONSETS) {
  if (!(onsetTicks > 0) || !(ticksPerSecond > 0)) return ROOT_GLIDE_SECONDS_DEFAULT;
  const seconds = (onsets * onsetTicks) / ticksPerSecond;   // glideTicks / ticksPerSec
  return Math.max(ROOT_GLIDE_MIN_SECONDS, Math.min(ROOT_GLIDE_MAX_SECONDS, seconds));
}

// Glide one of the two summed detune offsets to a target, recording the curve so it can be reproduced.
// setTargetAtTime is the main LRC page's law (handleFundamentalChange); its third argument is a TIME
// CONSTANT, so feeding it a third of the glide length puts the move ~95% home by the time the glide is
// nominally over. The MIDI retune always folds in BOTH offsets (totalDetuneCentsAt): a modulation glide
// leaves the fundamental constant and vice-versa, but a sustained voice's bend must track the true sum.
function glideDetune(source, glideRecord, target, setLast) {
  const now = audioCtx.currentTime;
  const seconds = rootGlideSeconds(fieldOnsetTicks, ticksPerSec);
  const timeConstant = Math.max(0.01, seconds / 3);
  const from = glideCentsAt(glideRecord.current, now);
  const next = { from, to: target, at: now, timeConstant };
  glideRecord.set(next);
  setLast(target);
  source.offset.cancelScheduledValues(now);
  source.offset.setTargetAtTime(target, now, timeConstant);
  // Tones already sounding must bend too — a row note is over before the glide is, but a bed voice
  // would otherwise sit at its old pitch for seconds while the browser glided underneath it.
  cosmosMidi?.retune(elapsed => totalDetuneCentsAt(now + elapsed), seconds);
}

function applyRootModulation() {
  if (!audioCtx || !modulationOffset) return;
  const target = modulationCentsFor(skyRoot.cents, modulationOn);
  glideDetune(modulationOffset, { current: modulationGlide, set: g => { modulationGlide = g; } },
    target, v => { lastModulationCents = v; });
}

// FUNDAMENTAL knob: a user-driven global transpose on the same bus, gliding on modulation's exact law.
function applyFundamentalGlide() {
  if (!audioCtx || !fundamentalOffset) return;
  glideDetune(fundamentalOffset, { current: fundamentalGlide, set: g => { fundamentalGlide = g; } },
    lastFundamentalCents, v => { lastFundamentalCents = v; });
}

// The exact value of a recorded glide at an audio time, reproducing setTargetAtTime's exponential
// approach: v(t) = to + (from − to)·e^(−(t−t0)/τ). Pure given the recorded curve.
export function glideCentsAt(glide, audioTime) {
  const { from, to, at, timeConstant } = glide;
  if (!Number.isFinite(audioTime) || audioTime <= at) return from;
  return to + (from - to) * Math.exp(-(audioTime - at) / Math.max(1e-6, timeConstant));
}
export function modulationCentsAt(audioTime) { return glideCentsAt(modulationGlide, audioTime); }
export function fundamentalCentsAt(audioTime) { return glideCentsAt(fundamentalGlide, audioTime); }
// Pure: the total detune the ensemble hears (and the MIDI mirror must spell) is the SUM of the two
// independent offsets. NaN-guarded so a not-yet-initialised glide contributes 0 rather than poisoning it.
export function totalDetuneCents(fundamentalCents, modulationCents) {
  return (Number.isFinite(fundamentalCents) ? fundamentalCents : 0) + (Number.isFinite(modulationCents) ? modulationCents : 0);
}
export function totalDetuneCentsAt(audioTime) {
  return totalDetuneCents(fundamentalCentsAt(audioTime), modulationCentsAt(audioTime));
}

// Retune the solved root to the fundamental, so a root change is heard as a key change rather than as a
// reinterpretation of the same pitches. Toggling either way glides — turning it off is itself a
// modulation, back to the absolute frame.
export function setModulation(on) {
  modulationOn = !!on;
  applyRootModulation();
  return modulationOn;
}
export function currentModulation() {
  return { on: modulationOn, cents: lastModulationCents, glideSeconds: rootGlideSeconds(fieldOnsetTicks, ticksPerSec), onsetTicks: fieldOnsetTicks };
}

// FUNDAMENTAL knob (Phase 0.2 bus; the log knob mapping arrives in Phase 2.3). A global transpose in
// CENTS, clamped to ±FUNDAMENTAL_OFFSET_MAX_CENTS, gliding on modulation's exact portamento law. Setting
// it never touches the modulation offset — the two automations are independent, they only sum on the bus.
export function setFundamentalOffset(cents) {
  const n = Number(cents);
  lastFundamentalCents = Math.max(-FUNDAMENTAL_OFFSET_MAX_CENTS, Math.min(FUNDAMENTAL_OFFSET_MAX_CENTS, Number.isFinite(n) ? n : 0));
  applyFundamentalGlide();
  return lastFundamentalCents;
}
export function currentFundamental() {
  return { cents: lastFundamentalCents, maxCents: FUNDAMENTAL_OFFSET_MAX_CENTS, glideSeconds: rootGlideSeconds(fieldOnsetTicks, ticksPerSec) };
}
export function currentSpeedMode() {
  // In SCALED/ONSET the cycle is DERIVED (grid/rate); the readout shows both "N notes/s · ~Ss cycle".
  const derivedCycleSeconds = scaledMedianGrid > 0 && ticksPerSec > 0 ? scaledMedianGrid / ticksPerSec : scaledCycleSeconds;
  return { mode: speedMode, cycleSeconds: scaledCycleSeconds, derivedCycleSeconds, ticksPerSec, medianGrid: scaledMedianGrid, targetOnsetRate };
}

// RICHNESS knob (Phase 2.3): the live sky-reach weight promoted from a const at the swept knee, clamped to
// the table's [0, RICHNESS_MAX]. stepSkyWalk reads the live value on its next chord choice.
export function setRichness(value) {
  const n = Number(value);
  RICHNESS = Math.max(0, Math.min(RICHNESS_MAX, Number.isFinite(n) ? n : RICHNESS));
  return RICHNESS;
}
export function currentRichness() { return { value: RICHNESS, max: RICHNESS_MAX }; }

// VOLUME knob (Phase 2.3): master trim ahead of the limiter. Ramped, not stepped, so a knob drag glides.
export function setVolume(x) {
  const n = Number(x);
  lastVolume = Math.max(0, Math.min(1, Number.isFinite(n) ? n : MASTER_VOLUME_DEFAULT));
  if (masterVolume && audioCtx) masterVolume.gain.setTargetAtTime(lastVolume, audioCtx.currentTime, 0.02);
  return lastVolume;
}
export function currentVolume() { return lastVolume; }

// SPACE knob (Phase 2.3): one control over BOTH reverb sends, each calibrated so the midpoint (0.5)
// reproduces today's levels and the travel from dry (0) to wash (1) feels continuous across the MIX.
export function setSpace(x) {
  const n = Number(x);
  lastSpace = Math.max(0, Math.min(1, Number.isFinite(n) ? n : SPACE_DEFAULT));
  const ambientWet = 2 * SPACE_AMBIENT_WET_AT_HALF * lastSpace;   // 0.5 → 0.30 (today's ambient send)
  const rowWet = 2 * SPACE_ROW_WET_AT_HALF * lastSpace;           // 0.5 → 0.35 (today's row send)
  if (audioCtx) {
    reverbWet?.gain.setTargetAtTime(ambientWet, audioCtx.currentTime, 0.1);
    gridRowPlayer?.setReverbWet(rowWet);
  }
  return { space: lastSpace, ambientWet, rowWet };
}
export function currentSpace() { return { space: lastSpace, ambientWet: 2 * SPACE_AMBIENT_WET_AT_HALF * lastSpace, rowWet: 2 * SPACE_ROW_WET_AT_HALF * lastSpace }; }

// Read-only bridge for flight visuals. The audio player remains the authority on whether a row star
// really has live voices and whether a scheduled attack has reached audio-context time.
export function gridRowVisualState() {
  return gridRowPlayer?.visualState() || [];
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
export function leadNoteInChord(ratio, chordId, rootCents = 0) {
  const { d, dev } = nearestDegree(ratioToCents(ratio), rootCents);
  return CHORDS[chordId].semitones.includes(d) && Math.abs(dev) <= LEAD_MASK_WINDOW;
}

// Recompute leadMask against the CURRENT global sky chord. Cheap (≤ lead cardinality), so it's called
// lazily (skyChordId cache-check) rather than threaded through every stepSkyWalk call.
function ensureLeadMask(force) {
  if (!lead) { leadMask = null; leadMaskChordId = -1; leadMaskRootKey = -1; return; }
  if (!force && leadMaskChordId === skyChordId && leadMaskRootKey === skyRoot.rootKey) return;
  leadMask = lead.notes.map(n => leadNoteInChord(n.ratio, skyChordId, skyRoot.cents));
  leadMaskChordId = skyChordId;
  leadMaskRootKey = skyRoot.rootKey;
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
export { NOMINAL_FALLBACK_CYCLE_SECONDS, CHORD_QUANTIZE_DIVISIONS, CHORD_ESCAPE_MULT, SPEED_MODES, SCALED_CYCLE_DEFAULT, TABU_K, LAMBDA_FIELD, RICHNESS, MAX_BED_OSC, REATTACK_PERIODS, LEAD_MASK_WINDOW, ROOT_TOP_K };

// User-facing harmonic-policy control. Because candidate field costs are normalized, this has a
// stable meaning: the best local tuning advantage can justify up to this many semitones of additional
// voice-leading motion. Higher values are intentionally ready for sevenths/extensions.
export function setTuningStrength(value) {
  const n = Number(value);
  LAMBDA_FIELD = Math.max(0, Math.min(TUNING_STRENGTH_MAX, Number.isFinite(n) ? n : 2));
  return LAMBDA_FIELD;
}

export function currentTuningStrength() { return LAMBDA_FIELD; }
const currentChordSemitones = () => CHORDS[skyChordId].semitones;

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
  return CHORDS[chordId].semitones.filter(d => pool && pool[d]);
}

// Debug-table model for the chromatic material the bed is ACTUALLY holding right now. There is no
// single global 12-tone winner: each audible star contributes its own best ratio per degree from its
// re-anchored pool. Aggregate equal ratios so the overlay stays readable, but keep selectedCount and
// soundingCount separate — a selected chord tone may still be absent from the live osc set when the
// defensive oscillator budget is full. `stars` uses debugSkyState's plain-data shape, so this remains
// pure/headless-testable and the overlay never has to infer playback state from chord membership.
export function selectedRatioToneRows(chordId, stars) {
  const chordDegrees = new Set(CHORDS[chordId]?.semitones || []);
  const selected = Array.from({ length: 12 }, () => new Map());
  const sounding = Array.from({ length: 12 }, () => new Map());
  const bump = (map, fraction, extra = {}) => {
    const row = map.get(fraction);
    if (row) row.count++;
    else map.set(fraction, { fraction, count: 1, ...extra });
  };

  for (const star of stars || []) {
    for (let d = 0; d < 12; d++) {
      const slot = star.pool && star.pool[d];
      if (slot) bump(selected[d], slot.fraction, { cents: slot.cents, dev: slot.dev });
    }
    for (const voice of star.voiced || []) {
      if (!Number.isInteger(voice.degree) || voice.degree < 0 || voice.degree >= 12 || !voice.fraction) continue;
      bump(sounding[voice.degree], voice.fraction);
    }
  }

  const byCentsThenFraction = (a, b) => (a.cents ?? Infinity) - (b.cents ?? Infinity) || a.fraction.localeCompare(b.fraction);
  return selected.map((ratios, degree) => ({
    degree,
    inChord: chordDegrees.has(degree),
    selected: [...ratios.values()].sort(byCentsThenFraction),
    sounding: [...sounding[degree].values()].sort((a, b) => {
      const ac = ratios.get(a.fraction)?.cents, bc = ratios.get(b.fraction)?.cents;
      return (ac ?? Infinity) - (bc ?? Infinity) || a.fraction.localeCompare(b.fraction);
    }),
  }));
}

// Culled-grid counterpart to selectedRatioToneRows. Each active star contributes the folded ratios
// selected into ITS immutable worker-built program; ON is counted from that star's live canonical
// A–D voices. Degrees are measured in the current solved-root frame, matching the compiler mask.
export function selectedGridRatioToneRows(chordId, rootCents, stars) {
  const chordDegrees = new Set(CHORDS[chordId]?.semitones || []);
  const selected = Array.from({ length: 12 }, () => new Map());
  const sounding = Array.from({ length: 12 }, () => new Map());
  const bump = (map, fraction, extra = {}) => {
    const row = map.get(fraction);
    if (row) row.count++;
    else map.set(fraction, { fraction, count: 1, ...extra });
  };
  for (const star of stars || []) {
    const tones = new Map();
    for (const tone of star.selectedTones || []) {
      const { d, dev } = nearestDegree(tone.cents, rootCents);
      tones.set(tone.fraction, { ...tone, degree: d, dev });
      bump(selected[d], tone.fraction, { cents: tone.cents, dev });
    }
    for (const voice of star.voiced || []) {
      const tone = tones.get(voice.fraction); if (!tone) continue;
      bump(sounding[tone.degree], voice.fraction, { cents: tone.cents, dev: tone.dev });
    }
  }
  const order = (a, b) => (a.cents ?? Infinity) - (b.cents ?? Infinity) || a.fraction.localeCompare(b.fraction);
  return selected.map((ratios, degree) => ({
    degree,
    inChord: chordDegrees.has(degree),
    selected: [...ratios.values()].sort(order),
    sounding: [...sounding[degree].values()].sort(order),
  }));
}

// Which REATTACK_PERIODS-relative step a star is on at a given SKY-CLOCK second count — pure floor
// division off a per-star period (chosen via hashId), same resync-safe shape as chordStepIndex.
export function reattachStepFor(id, seconds) {
  return Math.floor(seconds / REATTACK_PERIODS[hashId(id) % REATTACK_PERIODS.length]);
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
  detuneBus?.connect(osc.detune);   // shared fundamental + modulation glide — see initAudio
  const env = audioCtx.createGain(); env.gain.value = 0.0001;
  osc.connect(env); env.connect(bs.filter);
  osc.start(now);
  bedOscCount++;
  // Sky Root B3: stamp the voice with its slot's fraction (voice-identity gotcha — voices key by
  // degree only, and a root swap can re-map the same degree to a DIFFERENT tone; syncBedDegrees
  // compares this against the current pool to detect that and release+recreate).
  const v = { osc, env, degree, dev: slot.dev, fraction: slot.fraction };
  v.midi = cosmosMidi?.noteOn(osc.frequency.value, now, { cents: totalDetuneCentsAt(now), gain: bs.gainNode.gain.value });
  bs.oscMap.set(degree, v);
  bedSoundedDegrees.add(degree);   // exposure ledger: the bed sounds BY degree, so this is already the answer
  swellEnvelope(env.gain, BED_PEAK * gainForDev(slot.dev), now);
  return v;
}

function releaseVoice(bs, v, now, immediate) {
  bs.oscMap.delete(v.degree);
  if (v.midi) cosmosMidi?.noteOff(v.midi, now);
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
    try { detuneBus?.disconnect(v.osc.detune); } catch {}
    try { v.osc.disconnect(); } catch {} try { v.env.disconnect(); } catch {}
    if (bs.fadingCount != null) { bs.fadingCount--; if (bs.fadingCount <= 0) finalizeStarChain(bs); }
  };
}

// Reconcile every bed star's voices against the CURRENT chord's 3 degrees ∩ its pool coverage. Called
// every frame (from setField) so newly-landed pool coverage and newly-audible stars pick up promptly;
// only re-swells a CONTINUING voice when the chord itself just changed (lastSyncedChordId guard) — a
// bare pool/field refresh must never re-trigger every voice's envelope every frame.
// Sky Root B3 voice-identity gotcha, pure decision part: a root swap re-folds a star's pool at the new
// anchor, and the SAME degree can now map to a DIFFERENT tone (createVoice bakes frequency at birth —
// it never retunes in place). True when the pool's CURRENT slot for this degree is a real tone whose
// fraction disagrees with the voice's stamped one. Exported so a headless guard can verify the
// decision without a live AudioContext.
export function voiceToneChanged(voiceFraction, pool, degree) {
  const slot = pool && pool[degree];
  return !!(slot && slot.fraction !== voiceFraction);
}

// Reconcile every bed star's voices against the CURRENT chord's 3 degrees ∩ its pool coverage. Called
// every frame (from setField) so newly-landed pool coverage and newly-audible stars pick up promptly;
// only re-swells a CONTINUING voice when the chord itself just changed (lastSyncedChordId guard) — a
// bare pool/field refresh must never re-trigger every voice's envelope every frame. On a tone-changed
// mismatch, release (normal BED_RELEASE fade) and let the loop's own "no voice at this degree" branch
// recreate it — the overlapping release+attack IS the crossfade (should sound like weather, not a
// cut), never an immediate cut.
function syncBedDegrees(now) {
  const chordChanged = lastSyncedChordId !== skyChordId;
  lastSyncedChordId = skyChordId;
  for (const bs of bedStars.values()) {
    if (!bs.pool) continue;
    const desired = new Set(bedDegreesFor(skyChordId, bs.pool));
    for (const v of [...bs.oscMap.values()]) {
      if (!desired.has(v.degree)) { releaseVoice(bs, v, now, false); continue; }
      if (voiceToneChanged(v.fraction, bs.pool, v.degree)) releaseVoice(bs, v, now, false);
    }
    for (const d of desired) {
      const v = bs.oscMap.get(d);
      if (!v) createVoice(bs, d, now);
      else if (chordChanged) swellEnvelope(v.env.gain, BED_PEAK * gainForDev(v.dev), now);
    }
  }
}

// Each star re-swells on its own deterministic period (mutually near-coprime REATTACK_PERIODS) so the
// sky breathes as a slow polyrhythm rather than one synchronized pad — the v1 stand-in for real
// per-star rhythm. Driven by the SKY clock: how often a pad breathes is a listening duration, so it
// must not speed up with playback.
function pumpReattacks(now, seconds) {
  for (const bs of bedStars.values()) {
    if (!bs.oscMap.size) continue;
    const stepNow = reattachStepFor(bs.id, seconds);
    if (bs.reattachStep === undefined) { bs.reattachStep = stepNow; continue; }
    if (stepNow === bs.reattachStep) continue;
    bs.reattachStep = stepNow;
    for (const v of bs.oscMap.values()) swellEnvelope(v.env.gain, BED_PEAK * gainForDev(v.dev), now);
  }
}

// Which of the CURRENT chord's degrees have actually been sounded since it began. Row mode reads the
// player's ledger and folds each sounded tone's absolute cents to a degree around the live root; the
// bed sounds by degree already. Deliberately NOT the pool's per-degree best tone: any valid tone inside
// the consonance window exposes that degree — the pool keeps only the min-|dev| representative per
// degree, and requiring that one would refuse to count a perfectly good third the field really played.
function chordExposure(nowSeconds) {
  const chord = CHORDS[skyChordId];
  const sounded = new Set();
  // Both engines contribute to exposure at every mix position — a degree sounded by either bus counts.
  // Row player's ledger: maps sounded cents to chord degrees around the live root.
  const since = audioEpoch + chordStartedAt;
  for (const tone of gridRowPlayer?.soundedSince(since) || []) {
    const match = ownerChordMatch(tone.cents, skyRoot.cents, chord.semitones);
    if (match?.selected) sounded.add(match.degree);
  }
  // Bed: live voices + the ledger (a sustained voice that carries across a chord change never
  // re-enters createVoice; the ledger covers voices that swelled and released inside this window).
  for (const bs of bedStars.values()) for (const degree of bs.oscMap.keys()) sounded.add(degree);
  for (const degree of bedSoundedDegrees) sounded.add(degree);
  // Filter to chord degrees only.
  for (const degree of [...sounded]) if (!chord.semitones.includes(degree)) sounded.delete(degree);
  const missing = chord.semitones.filter(degree => !sounded.has(degree));
  return { degrees: chord.semitones, sounded: [...sounded].sort((a, b) => a - b), missing,
    complete: missing.length === 0, heldSeconds: nowSeconds - chordStartedAt };
}

// Pure chord-clock policy (Phase 0.3), exported so a headless guard can verify it without a live
// AudioContext. Identical at every MIX position — the exposure ledger is already mix-wide (rows via
// soundedSince, bed via bedSoundedDegrees), so this only reads its `complete` verdict.
//
//   1. ESCAPE first — a degree the local field cannot voice (or a chord flown away from) can never
//      complete, so release it after maxSeconds regardless of exposure or the quantize grid.
//   2. FLOOR — full exposure is required at every mix position. Below it the chord holds however long the
//      geography needs to say its quality: a sparse field stretches a short DWELL out to the floor.
//   3. TARGET — DWELL then holds a further targetSeconds past exposure (0 = advance the moment exposed).
//   4. QUANTIZE — land the change on the first cycle-subdivision boundary after 2+3 are both satisfied,
//      so chord changes fall on the form. (The escape ignores this — a rescue fires as soon as it is due.)
export function shouldAdvanceChord({ complete, heldSeconds = 0, targetSeconds = 0, maxSeconds = Infinity, atBoundary = true }) {
  if (heldSeconds >= maxSeconds) return true;
  if (!complete) return false;
  if (heldSeconds < targetSeconds) return false;
  return !!atBoundary;
}

// One grid cycle in SKY-CLOCK seconds, from the median sounding grid at the live tick rate. With no rows
// sounding (medianGrid 0 — ambient, or fixed mode where a cycle is not one duration) there is no cycle, so
// DWELL maps to a nominal fallback instead. Pure, so a guard can check the fallback without an AudioContext.
export function effectiveCycleSecondsFor(medianGrid, ticksPerSecond) {
  return (medianGrid > 0 && ticksPerSecond > 0) ? medianGrid / ticksPerSecond : NOMINAL_FALLBACK_CYCLE_SECONDS;
}
// DWELL target: a fraction of the cycle held past exposure. cycleSeconds ≤ 0 falls back to the nominal cycle.
export function chordTargetSeconds(dwellFrac, cycleSeconds) {
  const f = Math.max(0, Math.min(1, Number.isFinite(dwellFrac) ? dwellFrac : 0));
  return f * (cycleSeconds > 0 ? cycleSeconds : NOMINAL_FALLBACK_CYCLE_SECONDS);
}
// Escape cap: 4 full cycles — 4× the maximum DWELL target, with generous headroom when DWELL is low so an
// exposure-governed chord in a sparse field is not cut off before it can complete.
export function chordEscapeSeconds(cycleSeconds) {
  return CHORD_ESCAPE_MULT * (cycleSeconds > 0 ? cycleSeconds : NOMINAL_FALLBACK_CYCLE_SECONDS);
}
// Quantize grid: 1/8 of the cycle, so chord changes land on the form (spirit of ROW_SWITCH_TICKS swaps).
export function chordQuantumSeconds(cycleSeconds) {
  return (cycleSeconds > 0 ? cycleSeconds : NOMINAL_FALLBACK_CYCLE_SECONDS) / CHORD_QUANTIZE_DIVISIONS;
}

// SCALED and ONSET both pin one grid cycle to a wall duration (rate derived from the grid / onset gap), so
// grid/rate is a meaningful cycle. In FIXED mode grid/rate swings from seconds to hours across grids — the
// pathology scaled mode exists to avoid — so DWELL falls back to the nominal cycle, exactly as with no rows.
function effectiveCycleSeconds() {
  return speedMode !== SPEED_MODES.FIXED ? effectiveCycleSecondsFor(scaledMedianGrid, ticksPerSec) : NOMINAL_FALLBACK_CYCLE_SECONDS;
}

// The sky walk's chord clock (Phase 0.3). skyStep now tracks the 1/8-cycle QUANTIZE grid off the SKY
// clock (a listening duration — the grid must not shrink when scaled speed raises the tick rate), updated
// every tick so `atBoundary` is true only on the single tick that crosses a fresh boundary. The advance
// decision is the pure shouldAdvanceChord policy: exposure floor + DWELL target, quantized, with an escape.
// Online, not precomputed — advancing calls chooseNextChord ONCE against the CURRENT field (no history
// replay; a far clock jump — backgrounded tab — still reads as one crossed boundary and takes one hop).
function stepSkyWalk(seconds) {
  const cycleSeconds = effectiveCycleSeconds();
  const targetSeconds = chordTargetSeconds(dwellFraction, cycleSeconds);
  const quantumSeconds = chordQuantumSeconds(cycleSeconds);
  const escapeSeconds = chordEscapeSeconds(cycleSeconds);
  lastChordClock = { cycleSeconds, targetSeconds, quantumSeconds, escapeSeconds };
  const step = chordStepIndex(seconds, quantumSeconds);
  if (skyStep < 0) { skyStep = step; chordStartedAt = seconds; return; }
  const atBoundary = step !== skyStep;
  skyStep = step;
  const exposure = chordExposure(seconds);
  lastChordExposure = exposure;
  if (!shouldAdvanceChord({ complete: exposure.complete, heldSeconds: exposure.heldSeconds, targetSeconds, maxSeconds: escapeSeconds, atBoundary })) return;
  lastChordSeconds = seconds - chordStartedAt;
  chordStartedAt = seconds;
  bedSoundedDegrees = new Set();
  const audibleStars = currentField.map(it => ({ pool: it.pool, weight: it.gain }));
  const next = chooseNextChord(skyChordId, skyTabu, t => skyCoverage(t, audibleStars),
    { lambdaField: LAMBDA_FIELD, richness: RICHNESS, perDegree: perDegreeSupport(audibleStars) });
  skyChordId = next.id; pushTabu(skyTabu, skyChordId, TABU_K);
  rootPhraseTracker = observePhraseBoundary(rootPhraseTracker,
    { rootKey: skyRoot.rootKey, chordId: skyChordId, tabu: skyTabu }).tracker;
  applyRootPolicyAtBoundary();   // sole live root authority; atomic after chord+tabu advance
}

// Flight proposes exact ladder + incumbent data from one world-space gather. The proposal remains
// inspectable, but can act only while flight reports the same settled geographic epoch.
export function proposeRoot(proposal) {
  if (proposal && proposal.ladder) {
    lastRootLadder = proposal.ladder;
    lastRootPolicyProposal = proposal;
  }
}

// Live policy context from the camera owner. Epoch mismatch invalidates a solve immediately; no stale
// region can establish or modulate a root at a later boundary.
export function setRootPolicyContext({ settled = false, geographyEpoch = 0 } = {}) {
  rootPolicyContext = { settled: !!settled, currentEpoch: geographyEpoch };
}

function rootPolicyComputation() {
  if (!lastRootPolicyProposal?.ladder?.length || !lastRootPolicyProposal.incumbent) return null;
  const normalized = normalizeRootLadder(lastRootPolicyProposal.ladder, lastRootPolicyProposal.incumbent);
  const context = {
    settled: rootPolicyContext.settled,
    proposalEpoch: lastRootPolicyProposal.proposalEpoch,
    currentEpoch: rootPolicyContext.currentEpoch,
  };
  const decision = decideRootAtBoundary(normalized, rootPhraseTracker, context, {
    established: rootEstablished,
    chordDegrees: currentChordSemitones(),
    recentRoots: recentSkyRoots,
    tuningStrength: LAMBDA_FIELD,
  });
  return { normalized, context, decision };
}

function proposalIncumbentFrom(row) {
  return { fraction: row.fraction, cents: row.cents, score: row.score, perDegree: row.perDegree };
}

// Called only after the chord walk advances. Bootstrap always resolves on the first valid proposal:
// either a clear candidate wins or the field explicitly establishes the provisional 1/1. Subsequent
// changes require the normal live geography/exhaustion trigger and a ranked destination.
function applyRootPolicyAtBoundary() {
  const computation = rootPolicyComputation();
  if (!computation?.decision.actionable) return null;
  const { decision, normalized } = computation;
  const previousRoot = { ...skyRoot };
  const wasEstablished = rootEstablished;
  const winner = decision.winner;
  let changed = false;

  if (winner) {
    rootKeyCounter++;
    skyRoot = { fraction: winner.fraction, cents: winner.cents, rootKey: rootKeyCounter };
    changed = true;
    applyRootModulation();   // the whole sky glides to put the new root on the fundamental (if enabled)
    if (wasEstablished) recentSkyRoots = pushRecentRoot(recentSkyRoots, previousRoot);
    lastRootPolicyProposal = { ...lastRootPolicyProposal, incumbent: proposalIncumbentFrom(winner) };
  } else if (!wasEstablished) {
    // A flat/near-tied first solve validates retaining 1/1. Preserve the exact re-scored incumbent so
    // subsequent geography comparisons use the same gather rather than a rounded/default value.
    lastRootPolicyProposal = { ...lastRootPolicyProposal, incumbent: proposalIncumbentFrom(normalized.incumbent) };
  }

  rootEstablished = true;
  rootPhraseTracker = resetPhraseTracker(skyRoot.rootKey, skyChordId, skyTabu);
  lastRootDecision = {
    reason: decision.trigger.reason,
    changed,
    from: { fraction: previousRoot.fraction, cents: previousRoot.cents },
    to: { fraction: skyRoot.fraction, cents: skyRoot.cents },
    bootstrapChoice: decision.trigger.bootstrapChoice || null,
  };
  return lastRootDecision;
}

function rootPolicyDebugSnapshot() {
  const phrase = rootPhraseTracker || resetPhraseTracker(skyRoot.rootKey, skyChordId, skyTabu || []);
  const base = {
    live: true,
    established: rootEstablished,
    available: false,
    phrase,
    solve: { settled: rootPolicyContext.settled, proposalEpoch: null, currentEpoch: rootPolicyContext.currentEpoch, valid: false },
    recentRoots: recentSkyRoots.map(root => ({ ...root })),
    trigger: null,
    destination: null,
    previewDestination: null,
    lastDecision: lastRootDecision,
    rows: [],
  };
  const computation = rootPolicyComputation();
  if (!computation) return base;
  const { normalized, decision } = computation;
  const trigger = decision.trigger;
  const chordDegrees = currentChordSemitones();
  const previewTrigger = { due: true, reason: 'exhaustion', geographicCandidateIds: [] };
  const previewRanking = rankModulationDestinations(normalized, previewTrigger,
    { chordDegrees, recentRoots: recentSkyRoots, tuningStrength: LAMBDA_FIELD });
  const actualRanking = decision.ranking;
  const displayRanking = actualRanking.length ? actualRanking : previewRanking;
  const costsByRoot = new Map(displayRanking.map(row => [row.rootId, row]));
  const classified = classifyRootDestinations(normalized, { recentRoots: recentSkyRoots });
  const incumbentRow = classified.find(row => row.sameRoot) || null;
  const compactDestination = row => row ? {
    fraction: row.fraction, cents: row.cents, rank: row.rank, score: row.score, fitness: row.fitness,
    arrivalCoverage: row.arrivalCoverage, arrivalFitness: row.arrivalFitness, motionCents: row.motionCents,
    motionCost: row.motionCost, tuningCost: row.tuningCost, cost: row.cost,
  } : null;
  return {
    live: true,
    established: rootEstablished,
    available: true,
    incumbent: {
      fraction: normalized.incumbent.fraction,
      cents: normalized.incumbent.cents,
      score: normalized.incumbent.score,
      fitness: normalized.incumbent.fitness,
      rank: incumbentRow?.rank || null,
      candidateCount: normalized.rows.length,
    },
    ladder: {
      minScore: normalized.minScore,
      maxScore: normalized.maxScore,
      spread: normalized.spread,
      epsilon: normalized.epsilon,
      denominator: normalized.denominator,
      normalizedRange: normalized.normalizedRange,
    },
    phrase,
    solve: {
      settled: rootPolicyContext.settled,
      proposalEpoch: lastRootPolicyProposal.proposalEpoch,
      currentEpoch: rootPolicyContext.currentEpoch,
      valid: trigger.proposalValid,
    },
    recentRoots: recentSkyRoots.map(root => ({ ...root })),
    trigger,
    destination: compactDestination(actualRanking[0]),
    previewDestination: compactDestination(previewRanking[0]),
    pending: decision.actionable,
    lastDecision: lastRootDecision,
    rows: classified.slice(0, ROOT_TOP_K).map(row => {
      const costs = costsByRoot.get(row.rootId);
      return {
        fraction: row.fraction, cents: row.cents, rank: row.rank, score: row.score, fitness: row.fitness,
        statusCode: row.statusCode, status: row.status, eligible: row.eligible, geographicPass: row.geographicPass,
        arrivalCoverage: costs?.arrivalCoverage ?? null,
        arrivalFitness: costs?.arrivalFitness ?? null,
        motionCents: costs?.motionCents ?? null,
        motionCost: costs?.motionCost ?? null,
        tuningCost: costs?.tuningCost ?? null,
        cost: costs?.cost ?? null,
      };
    }),
  };
}

// → { fraction, cents, rootKey } — the sky's current root (provisional '1/1' until first establishment).
// rootKey is an opaque version counter zones use to invalidate their re-folded z.skyPoolAt cache —
// NOT the cents value (a bad cache key: floats, and a future modulation hop could revisit the same
// cents exactly). ROOT_HZ(220) · 2^(cents/1200) is the effective root frequency — 1/1 itself never moves.
export function currentSkyRoot() {
  return { ...skyRoot };
}

// Pure read of the GRID clock — the unit row programs and the lead are scheduled in. 0 before the
// transport starts. Rate-dependent by design: it is what makes a grid cycle scale with playback speed.
export function currentTicks() {
  return audioCtx && transportStart != null ? absoluteTicks(audioCtx.currentTime) : 0;
}

// Pure read of the SKY clock — flight-view.js uses this (not audioCtx, not currentTicks) for the root
// solve's settle duration and rate limit, in the SAME seconds CHORD_SECONDS uses. Rate-independent, so
// neither the tempo slider nor scaled speed can skew what "settled" means. 0 before the transport starts.
export function currentSkySeconds() {
  return audioCtx && audioEpoch != null ? skySeconds(audioCtx.currentTime) : 0;
}

// → { symbol, semitones } — the sky's current chord, for the cockpit readout (M4) and lead masking.
export function currentSkyChord() {
  return { symbol: CHORDS[skyChordId].symbol, id: skyChordId, semitones: currentChordSemitones() };
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
      degree: v.degree, fraction: v.fraction, dev: Math.round(v.dev * 10) / 10, gainLaw: Math.round(gainForDev(v.dev) * 100) / 100,
      envGain: Math.round(v.env.gain.value * 1000) / 1000, freqHz: Math.round(v.osc.frequency.value),
    })),
  }));
  // Sky Root handoff Feature A: the SAME ranking chooseNextChord used for its last step, against the
  // CURRENT live field — what the overlay needs to show *why* the walk is about to move where it's about
  // to move (parsimony + normalized field cost, not just raw coverage).
  const candidates = (skyTabu || []).length
    ? candidateCosts(skyChordId, skyTabu, t => skyCoverage(t, audibleStars),
      { lambdaField: LAMBDA_FIELD, richness: RICHNESS, perDegree: perDegreeSupport(audibleStars) })
        .map(c => ({ ...c, coverage: Math.round(c.coverage * 1000) / 1000, parsimony: Math.round(c.parsimony * 1000) / 1000,
          fieldCost: Math.round(c.fieldCost * 1000) / 1000, richness: Math.round(c.richness * 1000) / 1000,
          weakest: Math.round(c.weakest * 1000) / 1000, cost: Math.round(c.cost * 1000) / 1000 }))
        .sort((a, b) => a.cost - b.cost)
    : [];
  // Sky Root B3: the live root (fraction/cents/effective Hz) + the most recent solve's top-ROOT_TOP_K
  // ladder — replaces the old "root 220Hz fixed (v1, no drift)" overlay line now that it actually moves.
  const root = { fraction: skyRoot.fraction, cents: Math.round(skyRoot.cents * 10) / 10,
    hz: Math.round(ROOT_HZ * 2 ** (skyRoot.cents / 1200) * 10) / 10 };
  const ladderTopK = lastRootLadder.slice(0, ROOT_TOP_K).map(r => ({ fraction: r.fraction, cents: Math.round(r.cents * 10) / 10, score: Math.round(r.score * 1000) / 1000 }));
  const gridRows = gridRowPlayer?.debugState() || null;
  return {
    mix,
    auditionListening,
    tuningStrength: LAMBDA_FIELD,
    speed: { ...currentSpeedMode(), skySeconds: currentSkySeconds() },
    chordExposure: { ...lastChordExposure, lastChordSeconds, dwell: dwellFraction, ...lastChordClock },
    modulation: currentModulation(),
    fundamental: currentFundamental(),
    volume: currentVolume(),
    space: currentSpace(),
    richness: currentRichness(),
    midi: midiOutState(),
    gridRows,
    rootHz: ROOT_HZ,   // 1/1's fixed fundamental — the root solve only ever picks a RATIO relative to this
    root,
    rootLadder: ladderTopK,
    rootPolicy: rootPolicyDebugSnapshot(),
    chord: { id: skyChordId, symbol: CHORDS[skyChordId].symbol, semitones: currentChordSemitones() },
    tabu: (skyTabu || []).map(id => ({ id, symbol: CHORDS[id].symbol })),
    coverageByTriad: CHORDS.map(t => ({ id: t.id, symbol: t.symbol, coverage: Math.round(skyCoverage(t, audibleStars) * 1000) / 1000 })),
    candidateCosts: candidates,
    selectedRatioTones: mix > 0.5
      ? selectedGridRatioToneRows(skyChordId, skyRoot.cents, gridRows?.stars)
      : selectedRatioToneRows(skyChordId, stars),
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
  // Both engines stay warm at every mix position — bedGain controls audibility, not star presence.
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
export function setTickRate(rate, fromUser = false) {
  if (fromUser) fixedTickRate = rate;   // remember the slider's rate so leaving scaled mode restores it
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

// Master-bus fade before the hard teardown/close below. Scheduling a voice release (or an oscillator
// stop) and closing the AudioContext in the SAME tick cuts everything off before it renders even one
// frame of audio — that truncation-at-full-volume is the pop on Esc/Home exit, not the release curves
// themselves (those were already graceful; they just never got a chance to play).
const STOP_FADE = 0.05;

export function stopAudio() {
  if (schedulerTimer) { clearInterval(schedulerTimer); schedulerTimer = null; }
  const ctx = audioCtx, gain = muteGainNode;
  // Capture the OLD graph before resetting module state, so a fast re-entry (initAudio right after
  // exitCosmos) starts clean immediately instead of waiting on this fade.
  const oldLiveOscs = liveOscs, oldBedStars = bedStars, oldDyingStars = dyingStars;
  const oldMidi = cosmosMidi, oldRowPlayer = gridRowPlayer;
  const oldFundamentalOffset = fundamentalOffset, oldModulationOffset = modulationOffset;

  cosmosMidi = null; gridRowPlayer = null;
  bedStars = new Map(); dyingStars = []; bedOscCount = 0; currentField = [];
  skyChordId = START_CHORD_ID; skyTabu = null; skyStep = -1; lastSyncedChordId = null;
  skyRoot = { fraction: '1/1', cents: 0, rootKey: 0 }; rootKeyCounter = 0; lastRootLadder = [];
  rootEstablished = false; rootPhraseTracker = null; recentSkyRoots = []; lastRootPolicyProposal = null;
  rootPolicyContext = { settled: false, currentEpoch: 0 }; lastRootDecision = null;
  lead = null; schedIdx = 0; schedCycle = 0; transportStart = null; audioEpoch = null;
  chordStartedAt = 0; lastChordSeconds = 0; bedSoundedDegrees = new Set(); scaledMedianGrid = 0; fieldOnsetTicks = 0;
  fundamentalOffset = null; modulationOffset = null; detuneBus = null;
  lastModulationCents = 0; lastFundamentalCents = 0;
  modulationGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  fundamentalGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  leadMask = null; leadMaskChordId = -1; leadMaskRootKey = -1;
  audioCtx = null; pannerNode = null; distGainNode = null; muteGainNode = null; outputLimiter = null; liveOscs = null;
  bedGain = null; rowsGain = null; auditionGain = null; masterVolume = null;
  bedBus = null; reverbConv = null; reverbWet = null;
  mix = 0; auditionListening = true; auditionPinned = false;

  const teardown = () => {
    if (oldLiveOscs) for (const osc of oldLiveOscs) { try { osc.stop(0); } catch {} try { osc.disconnect(); } catch {} }
    if (ctx) { for (const bs of oldBedStars.values()) teardownBedStar(bs, ctx.currentTime); for (const bs of oldDyingStars) teardownBedStar(bs, ctx.currentTime); }
    oldMidi?.disable();
    oldRowPlayer?.destroy();
    try { oldFundamentalOffset?.stop(); } catch {}
    try { oldModulationOffset?.stop(); } catch {}
    if (ctx) { try { ctx.close(); } catch {} }
  };
  if (ctx && gain) {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.linearRampToValueAtTime(0.0001, now + STOP_FADE);
    setTimeout(teardown, STOP_FADE * 1000 + 20);
  } else {
    teardown();
  }
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
  const now = audioCtx.currentTime;
  stepSkyWalk(skySeconds(now));   // the sky's own chord clock — independent of any lead (no click gating)
  pumpReattacks(now, skySeconds(now));   // bed breathes at every mix position (gain gates audibility)
  gridRowPlayer?.tick(now, now + SCHEDULE_AHEAD, transportStart, ticksPerSec);
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
  const osc = audioCtx.createOscillator(); osc.type = RHYTHM_VOICE_WAVEFORM; osc.frequency.value = freq;
  detuneBus?.connect(osc.detune);   // shared fundamental + modulation glide — see initAudio
  const env = audioCtx.createGain();
  // Full Sky tint: in-(global-)chord onsets play full, out-of-chord onsets duck — the rhythm is
  // sacrosanct, no onset is ever skipped, the sky only tints it (M4 — replaces the per-star Chord Walk).
  const inChord = leadMask ? leadMask[noteIdx] : true;
  const peak = NOTE_PEAK * (inChord ? 1 : DUCK);
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(peak, time + ATTACK);
  env.gain.exponentialRampToValueAtTime(0.001, time + ATTACK + DECAY);
  osc.connect(env); env.connect(pannerNode);
  cosmosMidi?.note(freq, time, ATTACK + DECAY, { cents: totalDetuneCentsAt(time), gain: peak / NOTE_PEAK });
  osc.start(time); osc.stop(time + ATTACK + DECAY + 0.02);
  liveOscs.add(osc);
  osc.onended = () => { liveOscs.delete(osc); try { osc.disconnect(); } catch {} try { env.disconnect(); } catch {} };
}
