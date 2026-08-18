// cosmos-audio.js — Phase 0 dedicated audio layer for the Cosmos Flight instrument.
// "The rhythm plays its own tuning": a bloom node's composite onsets arpeggiate the node's own
// tuning system on one shared transport, spatialized by the star's live screen position.
// HARD RULE: fully separate from the site's playback engine. Do not import Core Interface/
// LRCModule.js, LRCSearch.js, Playback/* (AudioEngine/Scheduler/Partitions), Tone.js, or MIDIOut.
// The only shared code is the pure scale math below.
import { deriveSelectedRhythmModel, ratioToCents } from './oracle-core.js?v=2';
import { nearestDegree } from './grid-core.js';
// Full Sky (cosmos/FULL_SKY_HANDOFF.md): the global progression + its one gain law. Pure, no DOM.
import { CHORDS, START_CHORD_ID, chooseNextChord, candidateCosts, pushTabu, chordStepIndex, coverage as skyCoverage, perDegreeSupport, gainForDev,
  RICHNESS_LEVELS, RICHNESS_LEVEL_MIN, RICHNESS_LEVEL_MAX, maxCardinalityForRichness } from './sky-walk.js';
import { normalizeRootLadder, resetPhraseTracker, observePhraseBoundary, pushRecentRoot,
  classifyRootDestinations, rankModulationDestinations, decideRootAtBoundary } from './sky-modulation.js';
import { AUDIO_MODES, RHYTHM_VOICE_WAVEFORM, ownerHarmonyMatch } from './cosmos-grid-audio-core.js';
import { SpatialGridRowPlayer, shouldScheduleRowAction } from './spatial-grid-row-player.js';
import {
  DEFAULT_HARMONY_SOURCE, DEFAULT_HARMONY_TOLERANCE_CENTS, DEFAULT_SCALE_POLICY,
  HARMONY_SOURCES, SCALE_POLICIES, bedTargetsForPolicy, harmonyPolicyDefinitionKey,
  matchHarmonyTarget, normalizeHarmonyPolicy, rootPolicyStableKey,
} from './harmony-policy.js';
import { CosmosMidiOut } from './cosmos-midi-out.js';
// The audio clock's instrument panel (pure meters; see that module's header for the mechanism it measures).
// This module owns the transport, so it is the only honest place to time the scheduler's own arrival.
import { audioTelemetry } from './audio-telemetry.js';
// The transport's pulse + how far ahead it commits. Off the main thread deliberately — see that header.
import { TransportClock, TRANSPORT_TICK_MS, SCHEDULE_AHEAD_SECONDS } from './transport-clock.js';

const ROOT_HZ = 220;             // Phase 0: one root for every voice (per-star root is a later phase)
const LOOKAHEAD_MS = TRANSPORT_TICK_MS;      // scheduler tick cadence (the pulse now comes from a worker)
const SCHEDULE_AHEAD = SCHEDULE_AHEAD_SECONDS;   // seconds — schedule any note landing within this horizon
const MAX_LIVE_OSC = 48;         // held lead voices + their short release tails (normally only four are live)
// Rhythm-card audition defaults to the main ToneRowPlayback engine's Legato envelope: one sustained
// voice per A-D layer, replaced only by the next harmonically eligible attack in that layer. Keeping the
// same ADSR proportions makes the card behave like the site's sustain-pedal mode instead of a 228ms pluck.
const LEAD_ATTACK = 0.001, LEAD_DECAY = 0.2, LEAD_SUSTAIN = 0.7, LEAD_RELEASE = 0.3;
const NOTE_PEAK = 0.32;          // per-layer peak; the limiter catches the rare four-layer unison attack
const MAX_LEAD_FREQUENCY_HZ = 3520; // match ToneRowPlayback's absolute pitch ceiling
const LEAD_MASK_WINDOW = 35;     // cents — a lead onset counts as "in the global chord" within this of a degree

// ══ SKY KNOBS ═════════════════════════════════════════════════════════════════════════════════
// The global ambient bed — nearby stars' degree pools voiced against the one sky-wide chord walk.
// AUDIBLE_N (which/how-many zones feed the bed) lives in flight-view.js's FLIGHT/LOD KNOBS block —
// audible-set SELECTION is a camera/projection concern, kept out of this dependency-free audio layer.
// ── CHORD CLOCK (Phase 0.3) ──────────────────────────────────────────────────────────────────────
// The fixed 25.6s chord window (old CHORD_SECONDS = 256 ticks / 10) is retired. The clock is now three
// quantities, all in SKY-CLOCK seconds and all derived from the CURRENT grid cycle so harmonic rhythm
// scales with playback the way the grid does — and it is identical at every MIX position:
//   • FLOOR   — full exposure BY THE CULLED ROWS is required before any advance (the old "expose the full
//               quality" hold, now UNCONDITIONAL at every mix; the checkbox is gone — decision 3). The bed
//               does not expose: it voices the whole pool at once, so counting it made every chord exposed
//               at t≈0. Rows articulate at every mix position, so a silenced row still exposes.
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
// LOCAL-TUNING PULL (λ), in semitones of voice-leading cost the best local tuning advantage can justify.
// FROZEN at the ceiling by Avery's call (2026-07-29, ownership-transfer session): "I prefer if larger jumps
// are sometimes chosen." This deliberately supersedes plan decision 4 ("freeze at the knee of a 12-location
// sweep, not at the max") — the knee is where tuning influence stops buying vocabulary, but the leaps it
// buys past that point are wanted, not avoided. The Phase-3 sweep is therefore skipped, not deferred.
// The rail has NO λ knob (decision 4 stands on that): `setTuningStrength` survives as a dev-only probe on
// the audio-lab overlay, which can only explore DOWNWARD from here since TUNING_STRENGTH_MAX is 8.
const LAMBDA_FIELD_FROZEN = 8.0;
let LAMBDA_FIELD = LAMBDA_FIELD_FROZEN;   // live only so the lab probe can sweep it; production never moves it
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
// RICHNESS is now the vocabulary CEILING (a 1–4 detent; see RICHNESS_LEVELS in sky-walk.js), not a weight.
// Default stop 3 (≤5-note) is the closest reproduction of the shipped 0.05 weight's measured distribution —
// that sweep ran 20/50/25/5 triad/7th/9th/11–13, so capping at 9ths drops only its 5% tail. To ship the
// whole vocabulary by default instead, move this to 4; nothing else changes.
const RICHNESS_LEVEL_DEFAULT = 3;
let richnessLevel = RICHNESS_LEVEL_DEFAULT;
// …and the earned extension incentive goes back to being a constant at the swept knee. It still has a job
// UNDER the ceiling: it is what lets a well-supported 7th beat its triad at all (levelling the field term
// alone only makes them tie). What it cannot do is what the knob now does — it never removes a quality, so
// on its own it left 8% 11th–13th chords in the walk even at 0.00. Ceiling chooses the vocabulary; this
// chooses within it, and the geography still earns every extension via weakestSupport.
const EXTENSION_INCENTIVE = 0.05;
const MAX_BED_OSC = 30;          // LOGICAL bed voice budget (≤3 tones/star × AUDIBLE_N=10), freed eagerly on
                                  // release so a release tail can't starve incoming voices — see releaseVoice.
// …and the backstop that budget cannot provide. Because the logical count is freed the instant a voice is
// released, while its oscillator keeps running for BED_RELEASE + 0.05 ≈ 2.55s, MAX_BED_OSC does NOT bound the
// number of nodes actually rendering. Under churn that gap is unbounded: the eager free was the right fix for
// "the bed gets quieter while moving", but it removed the only ceiling on live nodes, and a few seconds of
// churn could bury the audio thread (which no main-thread meter can see — it is a different thread). This is
// a hard ceiling on REAL oscillators, generous enough to hold the legitimate release overlap and no more.
const MAX_BED_LIVE_OSC = MAX_BED_OSC * 3;
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
// Default ON since the ownership transfer (2026-07-29): the audio-lab entry defaults had been shipping
// modulation on since `f54198c` and that is what Avery has been listening to, so the rail's default
// (RAIL_PARAMS.modulation) and the engine's own agree rather than splitting. Decision 7's "opt-in" now
// means "switchable on the rail's harmony face", not "off until asked".
const MODULATION_DEFAULT = true;
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
// (RICHNESS is the vocabulary ceiling — see RICHNESS_LEVEL_DEFAULT with the walk state above.)

// One cycle of the rhythm as an ordered list of {t, ratio}: t = onset time as a fraction of the
// cycle in [0,1); ratio = folded pitch ratio in [1,2) (1/1 = root). Mirrors oracle-core.deriveScale's
// onset/space math EXACTLY, but keeps per-onset order (no dedup, no 2/1 delete).
export function deriveVoice(rawLayersOrModel) {
  const model = rawLayersOrModel?.nodes && rawLayersOrModel?.ratios
    ? rawLayersOrModel
    : deriveSelectedRhythmModel(rawLayersOrModel);
  const notes = model.nodes.map(node => ({
    t: node.phase,
    ratio: node.foldedRatio,
    rawRatio: node.rawRatio,
    rawFraction: node.rawFraction,
    fraction: node.fraction,
    // Composite attacks may belong to several polyrhythm layers. Preserve that identity so the audition
    // can keep an independent sustain-pedal voice for every owning layer, just like ToneRowPlayback.
    ownerIndexes: [...node.ownerIndexes],
  }));
  return { notes, grid: model.grid, cardinality: model.cardinality, model };
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
let leadVoices = null;            // Set of held/releasing rhythm-card voice records
let leadLayerVoices = null;       // current scheduled voice for each A-D layer
let schedulerClock = null;        // TransportClock — the worker-driven pulse (see transport-clock.js)
let mix = 0;                      // 0 = bed, 1 = rows; constant-power crossfade
let auditionListening = true;     // audition bus on/off (independent of mix)
let auditionPinned = false;       // pin keeps audition audible after deselection
let gridRowPlayer = null;

// ── THREE CLOCKS ────────────────────────────────────────────────────────────────────────────────
// GRID CLOCK (ticks). Spatial row programs run on actual grid steps, so SPEED converts its target
// onsets/sec through the nearby field's median ticks/onset. This clock therefore changes with density.
//
// LEAD CLOCK (onsets). Rhythm-card audition uses one tick per composite onset. Its rate is SPEED's
// target onsets/sec DIRECTLY — feeding it the density-derived grid rate made cards race or drag as the
// nearby field changed. `note.t` still preserves the rhythm's uneven spacing within an N-onset cycle.
//
// SKY CLOCK (seconds). Wall-clock seconds since the audio context started, NEVER re-anchored. The
// chord walk, the bed's re-swells and the root policy's settle/rate-limit are all "how long a listener
// experiences this harmony" quantities: they must not speed up when playback does. Keeping them on
// ticks is what would make scaled speed unusable — at grid 61600's ~5100 ticks/s the 256-tick chord
// window would fire every 50ms. All three clocks agree at the historical 10 ticks/s default,
// which is how every seconds constant below was derived.
let ticksPerSec = 10;              // default: 10 ticks/sec (~100ms/tick) — slow enough to actually listen
let transportStart = null;        // audioCtx time at which the absolute tick counter reads 0 (re-anchored on rate change)
let leadTicksPerSec = 10;          // one lead tick = one source onset; ONSET mode pins this to targetOnsetRate
let leadTransportStart = null;     // independent epoch: density-driven grid-rate changes cannot move the card
let audioEpoch = null;            // audioCtx time the transport started — the sky clock's fixed origin
let lead = null;                  // { notes, grid, cardinality, node } | null
let schedIdx = 0, schedCycle = 0; // scheduler's cursor into lead.notes / current cycle number
let currentOctaveLift = 0;        // applies to NEWLY scheduled notes only (spec: don't repitch in flight)
const absoluteTicks = now => (now - transportStart) * ticksPerSec;   // monotonic tick count since transport start
const absoluteLeadTicks = now => (now - leadTransportStart) * leadTicksPerSec;
const skySeconds = now => (audioEpoch == null ? 0 : now - audioEpoch);   // monotonic wall seconds, rate-independent

// ── Full Sky lead selection (M4): the lead's chord mask comes from the GLOBAL walk, not a per-star song.
// Only harmonically selected onsets are scheduled; the plot consumes the same classifier.
let leadMask = null;              // leadMask[noteIdx] = true if this onset may sound under the CURRENT sky chord
let leadMaskChordId = -1;         // which skyChordId leadMask was computed against (cache invalidation)
let leadMaskRootKey = -1;         // root swaps independently invalidate the same mask

// ── Full Sky: the global chord walk (online, stateful — not precomputed) + the ambient bed ──
let skyChordId = START_CHORD_ID, skyTabu = null, skyStep = -1;   // walk state; skyStep=-1 = not yet observed
let chordStartedAt = 0;           // sky-clock seconds the current chord began — the dwell/exposure origin
let harmonySource = DEFAULT_HARMONY_SOURCE;
let harmonyScale = DEFAULT_SCALE_POLICY;
let harmonyHold = false;
let rowFundamental = true;
let dwellFraction = 0;            // DWELL knob [0,1]: chord dwell as a fraction of the cycle PAST full exposure.
                                  // 0 = advance the moment exposed (the old full-quality hold, now the default).
                                  // A persisted musical setting (decision 8); Phase 2.2 binds the knob to setDwell.
let lastChordExposure = { degrees: [], sounded: [], missing: [], rowsPresent: false, exposed: true, complete: true, heldSeconds: 0 };   // overlay-only snapshot
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
let bedOscCount = 0;              // LOGICAL voices (freed eagerly at release, so the tail can't starve)
let bedLiveOscCount = 0;          // REAL oscillators still rendering (freed in onended) — the hard ceiling
// Bed counters for the telemetry panel. The bed has no worker and had no meters, which is exactly why
// rotation could kill the audio while every existing meter read zero.
const bedCounters = { created: 0, released: 0, refused: 0 };
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
  gridRowPlayer = new SpatialGridRowPlayer(audioCtx, rowsGain, detuneBus, midiBridge, audioTelemetry);
  gridRowPlayer.setEnabled(true);   // always on — rowsGain handles the crossfade
  gridRowPlayer.setRowFundamental(rowFundamental);
  mix = 0; auditionListening = true; auditionPinned = false;
  skyChordId = START_CHORD_ID; skyTabu = pushTabu([], skyChordId, TABU_K); skyStep = -1; lastSyncedChordId = null;
  harmonySource = DEFAULT_HARMONY_SOURCE; harmonyScale = DEFAULT_SCALE_POLICY; harmonyHold = false; rowFundamental = true;
  skyRoot = { fraction: '1/1', cents: 0, rootKey: 0 }; rootKeyCounter = 0; lastRootLadder = [];
  rootEstablished = false;
  rootPhraseTracker = resetPhraseTracker(skyRoot.rootKey, currentHarmonyPolicy().id, skyTabu);
  recentSkyRoots = []; lastRootPolicyProposal = null; rootPolicyContext = { settled: false, currentEpoch: 0 }; lastRootDecision = null;
  bedStars = new Map(); bedOscCount = 0; bedLiveOscCount = 0; currentField = [];
  transportStart = audioCtx.currentTime;   // grid and lead clocks share an origin, then preserve phase independently
  leadTransportStart = transportStart;
  leadTicksPerSec = speedMode === SPEED_MODES.ONSET ? targetOnsetRate : ticksPerSec;
  audioEpoch = transportStart;             // sky clock shares the origin but is never re-anchored after this
  chordStartedAt = 0; lastChordSeconds = 0; lastChordExposure = { targets: [], degrees: [], sounded: [], missing: [], rowsPresent: false, exposed: true, complete: true, heldSeconds: 0 };
  lastModulationCents = 0; modulationGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  lastFundamentalCents = 0; fundamentalGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  scaledMedianGrid = 0; fieldOnsetTicks = 0;
  liveOscs = new Set();
  leadVoices = new Set();
  leadLayerVoices = [null, null, null, null];
  schedIdx = 0; schedCycle = 0;
  // The pulse comes from a worker timer, not this thread: the flight loop's per-frame work would otherwise
  // starve it (and a hidden tab clamps main-thread timers to 1Hz outright — measured 1001ms vs 25ms
  // nominal). The worker URL resolves against THIS module, not the document, or it breaks under the
  // full-swallow the way the other cosmos workers would. Falls back to setInterval if a Worker can't be
  // built, so the transport always runs.
  schedulerClock = new TransportClock({
    intervalMs: LOOKAHEAD_MS,
    workerFactory: () => new Worker(new URL('./cosmos/transport-clock-worker.js?v=1', import.meta.url)),
  });
  schedulerClock.start(schedulerTick);
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

// The per-frame half of the field update: re-aim the stars already sounding, without touching membership,
// program installs or the derived tick rate. Those all depend on WHICH stars are in the field and which
// programs they hold, and neither changes when the camera merely turns — so re-deriving them every frame
// was pure cost, and cost is what starves the transport (see transport-clock.js / audio-telemetry.js).
export function setGridSpatialPose(items) {
  if (!audioCtx || !gridRowPlayer) return;
  gridRowPlayer.setPose(items || []);
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
  else if (speedMode === SPEED_MODES.SCALED && scaledMedianGrid > 0) {
    setTickRate(Math.max(SCALED_RATE_MIN, Math.min(SCALED_RATE_MAX, scaledMedianGrid / scaledCycleSeconds)));
  } else if (speedMode === SPEED_MODES.ONSET) {
    const derived = onsetRateToTickRate(targetOnsetRate, fieldOnsetTicks);
    if (derived) setTickRate(derived.ticksPerSec);
    setLeadTickRate(targetOnsetRate);
  } else {
    setLeadTickRate(ticksPerSec);
  }
  return { mode: speedMode, cycleSeconds: scaledCycleSeconds, ticksPerSec, leadOnsetsPerSec: leadTicksPerSec, medianGrid: scaledMedianGrid };
}

// SPEED knob binding (Phase 2.1): set the target note rate in onsets/sec, switching speed into ONSET mode
// (SPEED replaces the fixed/scaled toggle — decision 9). ticks/s re-derives immediately from the current
// field's onset gap; the readout's cycle is the derived grid/rate. Clamped to the knob's [MIN, MAX] range.
export function setTargetOnsetRate(rate) {
  const n = Number(rate);
  targetOnsetRate = Math.max(SPEED_ONSET_MIN, Math.min(SPEED_ONSET_MAX, Number.isFinite(n) ? n : SPEED_ONSET_DEFAULT));
  speedMode = SPEED_MODES.ONSET;
  setLeadTickRate(targetOnsetRate);
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

function resetHarmonyDecisionBaseline() {
  if (!audioCtx || audioEpoch == null) return;
  const seconds = skySeconds(audioCtx.currentTime);
  chordStartedAt = seconds;
  skyStep = chordStepIndex(seconds, chordQuantumSeconds(effectiveCycleSeconds()));
  lastChordExposure = { targets: [], sounded: [], missing: [], rowsPresent: false, exposed: true, complete: true, heldSeconds: 0 };
  lastSyncedChordId = null;
  leadMaskChordId = -1;
}

export function setHarmonyHold(on) {
  const next = !!on;
  const releasing = harmonyHold && !next;
  harmonyHold = next;
  if (releasing) resetHarmonyDecisionBaseline();
  return harmonyHold;
}
export function currentHarmonyHold() { return harmonyHold; }

export function setHarmonySource(source) {
  const next = source === HARMONY_SOURCES.SCALE ? HARMONY_SOURCES.SCALE : HARMONY_SOURCES.CHORD_WALK;
  if (next === harmonySource) return harmonySource;
  harmonySource = next;
  resetHarmonyDecisionBaseline();
  rootPhraseTracker = resetPhraseTracker(skyRoot.rootKey, currentHarmonyPolicy().id,
    harmonySource === HARMONY_SOURCES.CHORD_WALK ? skyTabu : []);
  return harmonySource;
}

export function setHarmonyScale(scaleId) {
  const next = SCALE_POLICIES[scaleId] ? scaleId : DEFAULT_SCALE_POLICY;
  if (next === harmonyScale) return harmonyScale;
  harmonyScale = next;
  if (harmonySource === HARMONY_SOURCES.SCALE) {
    resetHarmonyDecisionBaseline();
    rootPhraseTracker = resetPhraseTracker(skyRoot.rootKey, currentHarmonyPolicy().id, []);
  }
  return harmonyScale;
}

export function setRowFundamental(on) {
  const next = on !== false;
  const changed = next !== rowFundamental;
  rowFundamental = next;
  gridRowPlayer?.setRowFundamental(next);
  if (changed) resetHarmonyDecisionBaseline();
  return rowFundamental;
}

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
  return { mode: speedMode, cycleSeconds: scaledCycleSeconds, derivedCycleSeconds, ticksPerSec, leadOnsetsPerSec: leadTicksPerSec, medianGrid: scaledMedianGrid, targetOnsetRate };
}

// RICHNESS knob: an integer DETENT 1–4 setting the largest chord the walk may reach for (the old linear
// [0,0.18] weight is retired — it could only re-weight a vocabulary it could not shrink, which is why it
// never read as a continuum). Rounds rather than truncates so a knob position between stops lands on the
// nearer one. stepSkyWalk reads the live level on its next chord choice; nothing sounding is disturbed.
export function setRichness(level) {
  const n = Math.round(Number(level));
  richnessLevel = Math.max(RICHNESS_LEVEL_MIN, Math.min(RICHNESS_LEVEL_MAX, Number.isFinite(n) ? n : richnessLevel));
  return richnessLevel;
}
export function currentRichness() {
  const stop = RICHNESS_LEVELS[richnessLevel - 1];
  return { level: richnessLevel, min: RICHNESS_LEVEL_MIN, max: RICHNESS_LEVEL_MAX,
    maxCardinality: stop.maxCardinality, label: stop.label, detail: stop.detail };
}

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

// Live summed detune-bus value in cents: FUNDAMENTAL transpose + the root-modulation glide, read at its
// current (mid-ramp) value. Read-only. Flight visuals fold this into orb pitch-colour so a note's hue
// tracks its SOUNDING pitch, not its birth frequency — the whole sky's hue then drifts with a modulation.
export function gridRowDetuneCents() {
  return (fundamentalOffset?.offset.value || 0) + (modulationOffset?.offset.value || 0);
}

// Row-player counters for the telemetry panel (installs / star entries / exits / voice-budget misses).
// Monotonic within a session; the meter folds them in as deltas. Null before initAudio.
export function rowPlayerStats() { return gridRowPlayer?.stats || null; }

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
  if (audioCtx) releaseAllLeadVoices(audioCtx.currentTime);
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

export function leadNoteInHarmony(ratio, rootCents, policy) {
  const widened = { ...policy, toleranceCents: LEAD_MASK_WINDOW };
  return !!matchHarmonyTarget(ratioToCents(ratio), rootCents, widened)?.selected;
}

// Classify once per DISTINCT folded tone, then project that answer over the onset tape. High-range rhythms
// can repeat literal 1/1 thousands of times, so evaluating harmony per onset would repeat identical work.
export function classifyLeadHarmony(notes, rootCents, policy) {
  const selectedByTone = new Map();
  const mask = (notes || []).map(note => {
    const key = note.fraction || String(note.ratio);
    if (!selectedByTone.has(key)) selectedByTone.set(key, leadNoteInHarmony(note.ratio, rootCents, policy));
    return selectedByTone.get(key);
  });
  return { mask, selectedByTone };
}

// Selected-rhythm playback has two independent gates: chord-live tone selection and the rail's literal-1/1
// policy. Keep the combined decision pure so the visual plot and audio scheduler cannot silently diverge.
export function shouldScheduleLeadNote(note, noteIdx, mask, includeFundamental) {
  return shouldScheduleRowAction(note, includeFundamental) && (!mask || mask[noteIdx] === true);
}

// Project one eligible composite onset back onto the A-D arpeggiator layers that own it. This is the
// essential difference between the old one-pluck lead and ToneRowPlayback Legato: coincident attacks can
// replace several independent held voices, while an out-of-harmony onset replaces none of them.
export function scheduledLeadLayers(note, noteIdx, mask, includeFundamental) {
  if (!shouldScheduleLeadNote(note, noteIdx, mask, includeFundamental)) return [];
  const owners = Array.isArray(note?.ownerIndexes) ? note.ownerIndexes : [0];
  return [...new Set(owners.filter(layer => Number.isInteger(layer) && layer >= 0 && layer < 4))];
}

// Harmony is octave-relative, but playback is not: literal 2/1 and 4/1 sources must sound one and two
// octaves above 1/1 even though all three share the folded pitch-class ratio `1`. This mirrors the main
// ToneRowPlayback engine, including its hard upper-frequency guard.
export function leadFrequencyHz(note, octaveLift = 0) {
  const sourceRatio = Number.isFinite(note?.rawRatio) && note.rawRatio > 0 ? note.rawRatio : note?.ratio;
  const lift = Number.isFinite(octaveLift) ? octaveLift : 0;
  const frequency = ROOT_HZ * sourceRatio * (2 ** lift);
  return Number.isFinite(frequency) && frequency > 0 && frequency <= MAX_LEAD_FREQUENCY_HZ ? frequency : null;
}

// Recompute leadMask against the CURRENT global sky chord, lazily on chord/root changes.
function ensureLeadMask(force) {
  if (!lead) { leadMask = null; leadMaskChordId = -1; leadMaskRootKey = -1; return; }
  const policy = currentHarmonyPolicy();
  const policyKey = harmonyPolicyDefinitionKey(policy);
  if (!force && leadMaskChordId === policyKey && leadMaskRootKey === skyRoot.rootKey) return;
  leadMask = classifyLeadHarmony(lead.notes, skyRoot.cents, policy).mask;
  leadMaskChordId = policyKey;
  leadMaskRootKey = skyRoot.rootKey;
  // Scale Selection on the main engine releases a held legato voice as soon as its pitch is deselected.
  // Do the same when the live Cosmos harmony (or ROW 1/1 policy) changes, so a formerly valid sustained
  // tone cannot hang under the new chord while its layer waits for another eligible attack.
  if (audioCtx && leadVoices) {
    const now = audioCtx.currentTime;
    for (const voice of [...leadVoices]) {
      if (!shouldScheduleLeadNote(voice.note, voice.noteIdx, leadMask, rowFundamental)) {
        releaseLeadVoice(voice, now);
      }
    }
  }
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
export { NOMINAL_FALLBACK_CYCLE_SECONDS, CHORD_QUANTIZE_DIVISIONS, CHORD_ESCAPE_MULT, SPEED_MODES, SCALED_CYCLE_DEFAULT, TABU_K, LAMBDA_FIELD, EXTENSION_INCENTIVE, MAX_BED_OSC, REATTACK_PERIODS, LEAD_MASK_WINDOW, ROOT_TOP_K };

// DEV PROBE ONLY (decision 4 + the LAMBDA_FIELD_FROZEN note above). λ is frozen at 8.0 in production and
// no rail knob binds it; this setter exists so the audio-lab overlay can sweep it by ear. Because candidate
// field costs are normalized it has a stable meaning: the best local tuning advantage can justify up to this
// many semitones of additional voice-leading motion. A non-finite input holds the current value rather than
// snapping to the old 2.0 default — a garbled probe read must never quietly retune the sky.
export function setTuningStrength(value) {
  const n = Number(value);
  LAMBDA_FIELD = Math.max(0, Math.min(TUNING_STRENGTH_MAX, Number.isFinite(n) ? n : LAMBDA_FIELD));
  return LAMBDA_FIELD;
}

export function currentTuningStrength() { return LAMBDA_FIELD; }
const currentChordSemitones = () => CHORDS[skyChordId].semitones;
const currentChordTargets = () => currentChordSemitones().map(degree => degree * 100);

// The policy is fully determined by (harmonySource, harmonyScale, skyChordId) — tolerance is constant and
// chordTargets is a pure function of skyChordId. It was rebuilt ~3×/scheduler-tick + 1×/rAF-frame (each a
// Set+filter+2 maps+sort+freeze), ~120 rebuilds/s of pure churn. Memoize on that tuple, self-invalidating:
// the key is re-derived every call, so ANY change to the three inputs is picked up on the next call with no
// setter hooks. Returning the same frozen instance while stable is what lets harmonyPolicyDefinitionKey's
// identity cache (harmony-policy.js) collapse the per-tick/per-frame selection-key normalize too.
let _harmonyPolicyCache = null, _harmonyPolicyCacheKey = null;
export function currentHarmonyPolicy() {
  const key = `${harmonySource}|${harmonyScale}|${skyChordId}`;
  if (key !== _harmonyPolicyCacheKey) {
    _harmonyPolicyCacheKey = key;
    _harmonyPolicyCache = normalizeHarmonyPolicy({
      source: harmonySource,
      scaleId: harmonyScale,
      chordId: skyChordId,
      chordTargets: currentChordTargets(),
      toleranceCents: DEFAULT_HARMONY_TOLERANCE_CENTS,
    });
  }
  return _harmonyPolicyCache;
}

export function currentHarmonyState() {
  return {
    source: harmonySource,
    scale: harmonyScale,
    hold: harmonyHold,
    rowFundamental,
    policy: currentHarmonyPolicy(),
  };
}

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

export function bedDegreesForPolicy(policy, rootCents, pool) {
  if (!pool) return [];
  const bedPolicy = { ...policy, targets: bedTargetsForPolicy(policy) };
  const degrees = [];
  for (let degree = 0; degree < pool.length; degree++) {
    const slot = pool[degree];
    if (slot && ownerHarmonyMatch(slot.cents, rootCents, bedPolicy)?.selected) degrees.push(degree);
  }
  return degrees;
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
  // Two ceilings: the logical budget (eagerly freed, keeps a release tail from starving new voices) and the
  // real-node backstop. A refusal is COUNTED rather than silent — if this ever fires, something upstream is
  // churning membership and the panel will say so instead of the sound merely dying.
  if (bedOscCount >= MAX_BED_OSC || bedLiveOscCount >= MAX_BED_LIVE_OSC) { bedCounters.refused++; return null; }
  const slot = bs.pool[degree]; if (!slot) return null;
  const ratio = 2 ** (slot.cents / 1200);
  const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = ROOT_HZ * ratio * (2 ** bs.octave);
  detuneBus?.connect(osc.detune);   // shared fundamental + modulation glide — see initAudio
  const env = audioCtx.createGain(); env.gain.value = 0.0001;
  osc.connect(env); env.connect(bs.filter);
  osc.start(now);
  bedOscCount++; bedLiveOscCount++; bedCounters.created++;
  // Sky Root B3: stamp the voice with its slot's fraction (voice-identity gotcha — voices key by
  // degree only, and a root swap can re-map the same degree to a DIFFERENT tone; syncBedDegrees
  // compares this against the current pool to detect that and release+recreate).
  const v = { osc, env, degree, dev: slot.dev, fraction: slot.fraction };
  v.midi = cosmosMidi?.noteOn(osc.frequency.value, now, { cents: totalDetuneCentsAt(now), gain: bs.gainNode.gain.value });
  bs.oscMap.set(degree, v);
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
  bedCounters.released++;
  const rel = immediate ? 0.05 : BED_RELEASE;
  try {
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setValueAtTime(Math.max(0.0001, v.env.gain.value), now);
    v.env.gain.linearRampToValueAtTime(0.0001, now + rel);
  } catch {}
  try { v.osc.stop(now + rel + 0.05); } catch {}
  v.osc.onended = () => {
    bedLiveOscCount = Math.max(0, bedLiveOscCount - 1);   // the REAL node is gone only now, ~2.55s after release
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

// Reconcile every bed star's voices against the CURRENT chord's 3 degrees ∩ its pool coverage. Called from
// the SCHEDULER TICK (the audio clock, so a chord change is voiced promptly) and once more at the end of a
// membership change (setField), so a newly-audible star and newly-landed pool coverage pick up immediately;
// only re-swells a CONTINUING voice when the chord itself just changed (lastSyncedChordId guard) — a
// bare pool/field refresh must never re-trigger every voice's envelope. On a tone-changed
// mismatch, release (normal BED_RELEASE fade) and let the loop's own "no voice at this degree" branch
// recreate it — the overlapping release+attack IS the crossfade (should sound like weather, not a
// cut), never an immediate cut.
function syncBedDegrees(now) {
  const policy = currentHarmonyPolicy();
  const policyKey = harmonyPolicyDefinitionKey(policy);
  const chordChanged = lastSyncedChordId !== policyKey;
  lastSyncedChordId = policyKey;
  for (const bs of bedStars.values()) {
    if (!bs.pool) continue;
    const desired = new Set(bedDegreesForPolicy(policy, skyRoot.cents, bs.pool));
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

// Which of the CURRENT chord's degrees have actually been sounded since it began.
//
// THE ROWS ALONE EXPOSE A CHORD. The floor's promise is that no chord is left behind before the culled
// tone rows have articulated every interval slot in its quality — root, third, fifth, seventh, ninth —
// so exposure reads the row player's ledger and nothing else. The bed is deliberately excluded even
// though it is audible: it voices the whole pool the instant the chord changes, so counting it made every
// chord fully exposed at t≈0 and reduced the floor to the quantize grid. (This is the weld that was never
// made when the ambient chords and the culled grid rows were brought together — the bed's own
// `bedSoundedDegrees` ledger has been removed with this, since nothing else read it.)
//
// Silence is not the test — articulation is. Rows keep scheduling at every MIX position (the crossfade
// lives in rowsGain, and gridRowPlayer is enabled unconditionally in initAudio), so a chord in full
// ambient still exposes on the rhythms the geography is playing, inaudibly. That is what keeps the
// harmonic rhythm identical across the crossfade instead of doubling when you turn the rows up.
//
// Deliberately NOT the pool's per-degree best tone: any valid tone inside the consonance window exposes
// that degree — the pool keeps only the min-|dev| representative per degree, and requiring that one would
// refuse to count a perfectly good third the field really played.
//
// `rowsPresent` separates "the rows have not finished yet" from "there are no rows here" — the same empty
// ledger, opposite musical situations. With no row source in the field the floor has nothing to promise,
// so it goes VACUOUS rather than unsatisfiable: DWELL and the quantize grid alone pace the walk, which is
// what an ambient-only region did before rows existed. Without that, deep space would strand every chord
// on the escape cap (4 cycles ≈ 96s) and read as the walk having died.
function chordExposure(nowSeconds) {
  const policy = currentHarmonyPolicy();
  const requiredTargets = policy.targets.filter(target => rowFundamental || target !== 0);
  const sounded = new Set();
  // The row player's ledger, matched directly to octave-relative cent targets around the live root.
  const since = audioEpoch + chordStartedAt;
  for (const tone of gridRowPlayer?.soundedSince(since) || []) {
    const match = ownerHarmonyMatch(tone.cents, skyRoot.cents, policy);
    if (match?.selected && requiredTargets.includes(match.targetCents)) sounded.add(match.targetCents);
  }
  const missing = requiredTargets.filter(target => !sounded.has(target));
  const rowsPresent = (gridRowPlayer?.soundingStarCount() || 0) > 0;
  return { targets: requiredTargets, degrees: requiredTargets.map(target => target / 100), sounded: [...sounded].sort((a, b) => a - b), missing, rowsPresent,
    exposed: missing.length === 0,                        // the rows have said every degree
    complete: !rowsPresent || missing.length === 0,       // the FLOOR verdict — vacuous where no row can speak
    heldSeconds: nowSeconds - chordStartedAt };
}

// Pure chord-clock policy (Phase 0.3), exported so a headless guard can verify it without a live
// AudioContext. Identical at every MIX position — the exposure ledger it reads is ROWS-ONLY and the rows
// articulate at every crossfade position (chordExposure), so this only reads its `complete` verdict.
//
//   1. ESCAPE first — a degree the local field cannot voice (or a chord flown away from) can never
//      complete, so release it after maxSeconds regardless of exposure or the quantize grid.
//   2. FLOOR — full exposure by the ROWS is required at every mix position. Below it the chord holds
//      however long the geography needs to say its quality: a sparse field stretches a short DWELL out to
//      the floor. Where no row source exists at all the floor is vacuous, not unsatisfiable.
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
  if (harmonyHold) return;
  if (!shouldAdvanceChord({ complete: exposure.complete, heldSeconds: exposure.heldSeconds, targetSeconds, maxSeconds: escapeSeconds, atBoundary })) return;
  lastChordSeconds = seconds - chordStartedAt;
  chordStartedAt = seconds;
  if (harmonySource === HARMONY_SOURCES.CHORD_WALK) {
    const audibleStars = currentField.map(it => ({ pool: it.pool, weight: it.gain }));
    const next = chooseNextChord(skyChordId, skyTabu, t => skyCoverage(t, audibleStars),
      { lambdaField: LAMBDA_FIELD, richness: EXTENSION_INCENTIVE, maxCardinality: maxCardinalityForRichness(richnessLevel), perDegree: perDegreeSupport(audibleStars) });
    skyChordId = next.id; pushTabu(skyTabu, skyChordId, TABU_K);
  }
  const boundaryPolicy = currentHarmonyPolicy();
  rootPhraseTracker = observePhraseBoundary(rootPhraseTracker,
    { rootKey: skyRoot.rootKey, chordId: boundaryPolicy.id, tabu: harmonySource === HARMONY_SOURCES.CHORD_WALK ? skyTabu : [] }).tracker;
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
  const harmonyPolicy = currentHarmonyPolicy();
  // Guard against applying a proposal solved under a DIFFERENT harmony frame (source/scale switch) — but a
  // normal chord-walk advance is NOT such a change, so key on the stable frame, not the per-chord definition key.
  if (lastRootPolicyProposal.policyKey && lastRootPolicyProposal.policyKey !== rootPolicyStableKey(harmonyPolicy)) return null;
  const normalized = normalizeRootLadder(lastRootPolicyProposal.ladder, lastRootPolicyProposal.incumbent);
  const context = {
    settled: rootPolicyContext.settled,
    proposalEpoch: lastRootPolicyProposal.proposalEpoch,
    currentEpoch: rootPolicyContext.currentEpoch,
  };
  const decision = decideRootAtBoundary(normalized, rootPhraseTracker, context, {
    established: rootEstablished,
    chordDegrees: harmonyPolicy.targets.filter(target => target % 100 === 0).map(target => target / 100),
    harmonyTargets: harmonyPolicy.targets,
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
  const harmonyPolicy = currentHarmonyPolicy();
  rootPhraseTracker = resetPhraseTracker(skyRoot.rootKey, harmonyPolicy.id,
    harmonySource === HARMONY_SOURCES.CHORD_WALK ? skyTabu : []);
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
  const policy = currentHarmonyPolicy();
  if (policy.source === HARMONY_SOURCES.SCALE) {
    return { symbol: SCALE_POLICIES[policy.scaleId].label, id: policy.id, semitones: policy.targets.map(target => target / 100), targets: [...policy.targets], source: policy.source };
  }
  return { symbol: CHORDS[skyChordId].symbol, id: skyChordId, semitones: currentChordSemitones(), targets: [...policy.targets], source: policy.source };
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
  const candidates = harmonySource === HARMONY_SOURCES.CHORD_WALK && (skyTabu || []).length
    ? candidateCosts(skyChordId, skyTabu, t => skyCoverage(t, audibleStars),
      { lambdaField: LAMBDA_FIELD, richness: EXTENSION_INCENTIVE, maxCardinality: maxCardinalityForRichness(richnessLevel), perDegree: perDegreeSupport(audibleStars) })
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
    harmony: currentHarmonyState(),
    midi: midiOutState(),
    gridRows,
    rootHz: ROOT_HZ,   // 1/1's fixed fundamental — the root solve only ever picks a RATIO relative to this
    root,
    rootLadder: ladderTopK,
    rootPolicy: rootPolicyDebugSnapshot(),
    chord: currentSkyChord(),
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
// BED MEMBERSHIP — which stars are in the ambient field, and what pool each one voices. Every entry here
// creates oscillators (and a MIDI note-on per voice); every exit releases them. So this must be called only
// when membership can actually have CHANGED — never once per rendered frame. flight-view gates it on the
// same causes as the row field: translation, zone spawn/evict, a new chord key, a landed compile, a root
// swap. Rotation is deliberately not one of them.
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
    applySkyPose(bs, item, now);
  }
  for (const [id, bs] of bedStars) if (!seen.has(id)) { bedStars.delete(id); dropBedStar(bs, now); }
  syncBedDegrees(now);
}

// BED POSE — where each star already in the field sits in the stereo field, how loud, how bright. Safe to
// call every frame: AudioParam automation only, no voice can be created or released by it. This is what
// lets a star sweep across the stereo image as the camera turns WITHOUT the turn re-triggering its chord —
// the defect that made the same bed chord re-strike every frame in a DAW over MIDI out, and that buried the
// audio thread in oscillators after a few seconds of sustained rotation.
//
// `octave` is accepted but only takes effect on the NEXT voice created at this star (createVoice bakes
// frequency at birth and never retunes in place), which is exactly the pre-split behaviour.
export function setSkyPose(items) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (const item of items || []) {
    const bs = bedStars.get(item.id);
    if (!bs) continue;   // not in the field (or already dropped and fading) — never re-aim a dying star
    bs.octave = item.octave || 0;
    applySkyPose(bs, item, now);
  }
}

function applySkyPose(bs, item, now) {
  bs.filter.frequency.setTargetAtTime(item.cutoff, now, 0.3);
  bs.panner.pan.setTargetAtTime(item.pan, now, 0.3);
  bs.gainNode.gain.setTargetAtTime(item.gain, now, 0.3);
}

// Bed counters + live gauges for the telemetry panel (see the bedCounters declaration).
export function bedStats() {
  return {
    ...bedCounters,
    liveOscs: bedLiveOscCount, logicalVoices: bedOscCount,
    stars: bedStars.size, dying: dyingStars.length,
  };
}

// Grid ticks per second. Re-anchor the grid epoch so its current absolute tick is preserved. In FIXED
// and SCALED modes the card intentionally follows this legacy rate too; in ONSET mode its independent
// lead clock stays pinned to targetOnsetRate while nearby density changes only this grid rate.
export function setTickRate(rate, fromUser = false) {
  if (fromUser) fixedTickRate = rate;   // remember the slider's rate so leaving scaled mode restores it
  if (!audioCtx) {
    ticksPerSec = rate;
    if (speedMode !== SPEED_MODES.ONSET) leadTicksPerSec = rate;
    return;
  }
  const now = audioCtx.currentTime;
  const ticksSoFar = absoluteTicks(now);
  ticksPerSec = rate;
  transportStart = now - ticksSoFar / ticksPerSec;
  if (speedMode !== SPEED_MODES.ONSET) setLeadTickRate(rate);
}

function setLeadTickRate(rate) {
  const next = Number(rate);
  if (!(next > 0)) return;
  if (!audioCtx || leadTransportStart == null) { leadTicksPerSec = next; return; }
  const now = audioCtx.currentTime;
  const ticksSoFar = absoluteLeadTicks(now);
  leadTicksPerSec = next;
  leadTransportStart = now - ticksSoFar / leadTicksPerSec;
  if (lead) resyncSchedulePointer();
}

export function setMuted(bool) {
  if (!audioCtx) return;
  muteGainNode.gain.setTargetAtTime(bool ? 0 : 1, audioCtx.currentTime, 0.02);
}

// 0..1 position within the current lead's cycle, for the cockpit playhead. 0 before the transport
// starts or when there's no lead (a cycle is only meaningful relative to some star's grid).
export function transportPhase() {
  if (!audioCtx || leadTransportStart == null || !lead) return 0;
  const phase = (absoluteLeadTicks(audioCtx.currentTime) / lead.notes.length) % 1;
  return phase < 0 ? phase + 1 : phase;
}

// Master-bus fade before the hard teardown/close below. Scheduling a voice release (or an oscillator
// stop) and closing the AudioContext in the SAME tick cuts everything off before it renders even one
// frame of audio — that truncation-at-full-volume is the pop on Esc/Home exit, not the release curves
// themselves (those were already graceful; they just never got a chance to play).
const STOP_FADE = 0.05;

export function stopAudio() {
  if (schedulerClock) { schedulerClock.stop(); schedulerClock = null; }   // terminates the pulse worker too
  lastSchedulerTickAt = null;   // don't charge the next session's first tick with the whole exit gap
  const ctx = audioCtx, gain = muteGainNode;
  // Capture the OLD graph before resetting module state, so a fast re-entry (initAudio right after
  // exitCosmos) starts clean immediately instead of waiting on this fade.
  const oldLiveOscs = liveOscs, oldBedStars = bedStars, oldDyingStars = dyingStars;
  const oldMidi = cosmosMidi, oldRowPlayer = gridRowPlayer;
  const oldFundamentalOffset = fundamentalOffset, oldModulationOffset = modulationOffset;

  cosmosMidi = null; gridRowPlayer = null;
  bedStars = new Map(); dyingStars = []; bedOscCount = 0; bedLiveOscCount = 0; currentField = [];
  skyChordId = START_CHORD_ID; skyTabu = null; skyStep = -1; lastSyncedChordId = null;
  harmonySource = DEFAULT_HARMONY_SOURCE; harmonyScale = DEFAULT_SCALE_POLICY; harmonyHold = false; rowFundamental = true;
  skyRoot = { fraction: '1/1', cents: 0, rootKey: 0 }; rootKeyCounter = 0; lastRootLadder = [];
  rootEstablished = false; rootPhraseTracker = null; recentSkyRoots = []; lastRootPolicyProposal = null;
  rootPolicyContext = { settled: false, currentEpoch: 0 }; lastRootDecision = null;
  lead = null; schedIdx = 0; schedCycle = 0; transportStart = null; leadTransportStart = null; audioEpoch = null;
  chordStartedAt = 0; lastChordSeconds = 0; scaledMedianGrid = 0; fieldOnsetTicks = 0;
  fundamentalOffset = null; modulationOffset = null; detuneBus = null;
  lastModulationCents = 0; lastFundamentalCents = 0;
  modulationGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  fundamentalGlide = { from: 0, to: 0, at: 0, timeConstant: 0.01 };
  leadMask = null; leadMaskChordId = -1; leadMaskRootKey = -1;
  audioCtx = null; pannerNode = null; distGainNode = null; muteGainNode = null; outputLimiter = null; liveOscs = null;
  leadVoices = null; leadLayerVoices = null;
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

// Jump the scheduler's cursor to the next upcoming note at the current lead phase (used when a lead is
// swapped or its onset target changes) so playback picks up NOW instead of restarting the cycle.
function resyncSchedulePointer() {
  if (!audioCtx || !lead || !lead.notes.length) { schedIdx = 0; schedCycle = 0; return; }
  const ticks = absoluteLeadTicks(audioCtx.currentTime);
  const cycleNow = Math.floor(ticks / lead.notes.length);
  const phase = ticks / lead.notes.length - cycleNow;
  const idx = lead.notes.findIndex(n => n.t >= phase);
  if (idx === -1) { schedIdx = 0; schedCycle = cycleNow + 1; } else { schedIdx = idx; schedCycle = cycleNow; }
}

let lastSchedulerTickAt = null;   // wall clock of the previous tick — its GAP is main-thread starvation

// Per-phase resilience + live diagnostics for the transport heartbeat. schedulerTick runs sky-walk, bed,
// reattacks, ROW-PLAYER (the ONLY place stars/decks/programs are destroyed), and lead scheduling in sequence.
// It used to be unguarded: a single deterministic throw in an early phase stranded gridRowPlayer.tick() on
// EVERY tick until a page refresh → stars/programs leaked without bound AND audio went dead. Now each phase is
// isolated, so a bad tick is one logged, dropped phase — never a permanent strand — and the throw is captured
// here as the diagnostic. Read window.__cosmosHealth() live in DevTools during a session: throws/byPhase name
// any real strand; activeStars is the #1 leak tell (should hover near active+prewarm and never climb).
const tickHealth = { throws: 0, byPhase: Object.create(null), lastError: null, _seen: new Set() };
function guardPhase(phase, fn) {
  try { fn(); }
  catch (err) {
    tickHealth.throws++;
    tickHealth.byPhase[phase] = (tickHealth.byPhase[phase] || 0) + 1;
    const msg = err && err.message ? err.message : String(err);
    tickHealth.lastError = { phase, msg };
    const key = phase + '|' + msg;
    if (!tickHealth._seen.has(key)) {   // dedup the console flood — one line per distinct phase:message
      tickHealth._seen.add(key);
      console.error(`[schedulerTick] "${phase}" threw — phase dropped, other phases protected:`, err);
    }
  }
}
if (typeof window !== 'undefined') {
  window.__cosmosHealth = () => {
    let retiringDecks = 0;
    if (gridRowPlayer && gridRowPlayer.stars) for (const s of gridRowPlayer.stars.values()) retiringDecks += (s.retiringDecks ? s.retiringDecks.length : 0);
    return {
      throws: tickHealth.throws,
      byPhase: { ...tickHealth.byPhase },
      lastError: tickHealth.lastError,
      activeStars: gridRowPlayer && gridRowPlayer.stars ? gridRowPlayer.stars.size : null,   // #1 leak tell
      retiringDecks,
      bedOsc: bedOscCount,
      bedLiveOsc: bedLiveOscCount,
    };
  };
}

function schedulerTick() {
  if (!audioCtx) return;
  // The gap between ticks is the first link in the flam mechanism: this is a main-thread setInterval, so a
  // frame that overruns delays it, and every event that came due in the meantime is already late when the
  // scheduler finally reaches it. Nominal is LOOKAHEAD_MS; anything well above that is starvation.
  const wall = performance.now();
  if (lastSchedulerTickAt !== null) audioTelemetry.tick(wall - lastSchedulerTickAt);
  lastSchedulerTickAt = wall;
  const now = audioCtx.currentTime;
  guardPhase('skyWalk', () => stepSkyWalk(skySeconds(now)));   // the sky's own chord clock (no click gating)
  // Voice the bed against the CURRENT chord on the AUDIO clock, not the render frame. Membership moved behind a
  // change-gate (setField); cheap and idempotent (≤10 stars × ≤3 degrees) when field and chord are stable.
  guardPhase('bed', () => syncBedDegrees(now));
  guardPhase('reattacks', () => pumpReattacks(now, skySeconds(now)));   // bed breathes at every mix position
  // ROW PLAYER — the ONLY place stars/decks/programs are destroyed. Guarded on its own so a throw in ANY earlier
  // phase can never strand it; that strand was the leak-and-die failure mode this whole guard exists to prevent.
  guardPhase('rowPlayer', () => gridRowPlayer?.tick(now, now + SCHEDULE_AHEAD, transportStart, ticksPerSec));
  guardPhase('lead', () => {
    ensureLeadMask(false);       // cheap cache-check; recomputes only right after stepSkyWalk changed the chord
    if (!lead || !lead.notes.length) return;
    const horizon = audioCtx.currentTime + SCHEDULE_AHEAD;
    while (true) {
      const note = lead.notes[schedIdx];
      const cycleTicks = lead.notes.length;
      const noteTicks = schedCycle * cycleTicks + note.t * cycleTicks;
      const time = leadTransportStart + noteTicks / leadTicksPerSec;
      if (time > horizon) break;
      scheduleNote(note, time, schedIdx);
      schedIdx++;
      if (schedIdx >= lead.notes.length) { schedIdx = 0; schedCycle++; }
    }
  });
}

function scheduleNote(note, time, noteIdx) {
  // Only chord-live tones sound. The independent literal-1/1 gate preserves raw identity so octave sources
  // folded onto 1/1 (2/1, 4/1, …) remain playable when ROW 1/1 is disabled.
  const layers = scheduledLeadLayers(note, noteIdx, leadMask, rowFundamental);
  if (!layers.length) return;
  const freq = leadFrequencyHz(note, currentOctaveLift);
  if (freq === null) return;
  for (const layerIndex of layers) startLeadLegatoVoice(note, noteIdx, layerIndex, freq, time);
}

function startLeadLegatoVoice(note, noteIdx, layerIndex, freq, time) {
  if (!audioCtx || !liveOscs || !leadVoices || !leadLayerVoices) return;
  const when = Math.max(audioCtx.currentTime, time);

  // Exactly one sustained voice owns a layer. A harmony-filtered onset never reaches this function, so
  // the previous pitch continues just as it does when Scale Selection skips a note on the main page.
  if (liveOscs.size >= MAX_LIVE_OSC) return;
  releaseLeadVoice(leadLayerVoices[layerIndex], when);

  const osc = audioCtx.createOscillator(); osc.type = RHYTHM_VOICE_WAVEFORM; osc.frequency.value = freq;
  detuneBus?.connect(osc.detune);   // shared fundamental + modulation glide — see initAudio
  const env = audioCtx.createGain();
  const peak = NOTE_PEAK;
  const sustain = peak * LEAD_SUSTAIN;
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + LEAD_ATTACK);
  env.gain.linearRampToValueAtTime(sustain, when + LEAD_ATTACK + LEAD_DECAY);
  env.gain.setValueAtTime(sustain, when + LEAD_ATTACK + LEAD_DECAY + 0.01);
  osc.connect(env); env.connect(pannerNode);
  const voice = {
    osc, env, note, noteIdx, layerIndex, sustain,
    midi: cosmosMidi?.noteOn(freq, when, { cents: totalDetuneCentsAt(when), gain: peak / NOTE_PEAK }) || null,
    releaseAt: Infinity,
  };
  leadVoices.add(voice);
  leadLayerVoices[layerIndex] = voice;
  liveOscs.add(osc);
  osc.start(when);
  osc.onended = () => {
    liveOscs?.delete(osc);
    leadVoices?.delete(voice);
    if (leadLayerVoices?.[layerIndex] === voice) leadLayerVoices[layerIndex] = null;
    try { osc.disconnect(); } catch {}
    try { env.disconnect(); } catch {}
  };
}

function releaseLeadVoice(voice, when, release = LEAD_RELEASE) {
  if (!voice || !audioCtx || when >= voice.releaseAt) return;
  const at = Math.max(audioCtx.currentTime, when);
  const stopAt = at + Math.max(0.01, release);
  voice.releaseAt = at;
  try {
    if (typeof voice.env.gain.cancelAndHoldAtTime === 'function') {
      voice.env.gain.cancelAndHoldAtTime(at);
    } else {
      voice.env.gain.cancelScheduledValues(at);
      voice.env.gain.setValueAtTime(Math.max(0.0001, voice.env.gain.value || voice.sustain), at);
    }
    voice.env.gain.linearRampToValueAtTime(0, stopAt);
    voice.osc.stop(stopAt + 0.01);
  } catch {
    try { voice.osc.stop(at); } catch {}
  }
  if (voice.midi) cosmosMidi?.noteOff(voice.midi, at);
  if (leadLayerVoices?.[voice.layerIndex] === voice) leadLayerVoices[voice.layerIndex] = null;
}

function releaseAllLeadVoices(when) {
  if (!leadVoices) return;
  for (const voice of [...leadVoices]) releaseLeadVoice(voice, when, 0.05);
  if (leadLayerVoices) leadLayerVoices.fill(null);
}
