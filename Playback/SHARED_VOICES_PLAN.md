# Shared voice library — plan (2026-10-16)

Goal: one voice library for the LRC's two audio stacks (main Playback + Partitions, and Cosmos), carrying the chunk-tunes sounds into standard Playback. It is the groundwork for the Composer/Performer. MacroTonal is out of scope (separate game project, keeps its own audio). chunk-tunes (Overworld) is **not touched** in this work; Avery is reworking it in another thread.

## What exists (mapped 2026-10-16)

| | Main Playback + Partitions | Cosmos | chunk-tunes (Overworld) |
|---|---|---|---|
| Library | raw WebAudio (Tone 14.8.49 is loaded at `index.html:438` but nothing in Playback uses it) | raw WebAudio | raw WebAudio |
| Context | `AudioEngine.initAudioContext` (no latencyHint); Partitions shares it | own context, `latencyHint:'playback'`, closed on exit | page |
| Voice | `startStandardNote` / `startLegatoNote` / `startBridgeVoice` in `ToneRowPlayback.js:1039-1240`: one `OscillatorNode` + linear ADSR per note | data recipes → `planVoice` (`voice-plan.js:88`) → `createInstrumentVoice` handle (`instrument-voice.js:147`) | data recipes → `planNote` (`chunk-sounds.js:166`) → `soundNote(ctx,out,plan,at)` (`chunk-sounds-voice.js:34`) |
| Sounds | sine / triangle / sawtooth / square, per layer (`LayerControlsUI.js:75`) | classic, glass, warm × roles row/bed/audition | 14: plain, pad, glass, glassbed, marimba, vibes, xylophone, kalimba, harp, upright, sub, reed, flute, warm |
| Envelope | caller ADSR from layer knobs | caller timing by role | the recipe's own `amp`: held, or struck (exponential, rings or damps) |
| Live retune | `handleFundamentalChange` glides `voice.oscillator.frequency` directly | `detuneBus` only | none |
| Drums | `PartitionsPlayback.triggerSample` (529) + `loadSample` (581); 20 WAVs in `assets/audio/`; user samples in IndexedDB | — | same 20 WAVs (byte-identical) plus "made" kick/snare/hat/perc/cym synthesised in page code (`chunk-tunes.html:1185-2662`) |

The three chunk-tunes sounds glass, glassbed and warm were rewritten from Cosmos's presets into the chunk schema. Cosmos's `instruments/` files import only each other and cache per context in WeakMaps. They are already portable.

## Shape

A new top-level folder `Audio/`, outside both `Playback/` and `Cosmos/`. Cosmos's rule is "never import Playback/*", so shared code can't live in either folder.

- `Audio/voices/recipes.js`: the one catalog. Cosmos's schema is canonical because it is the superset (detune, drift, swell, roles). It gains an optional recipe-level `amp` (`held` | `struck` with decay/track/ring), taken from chunk-tunes. Sounds:
  - classic, glass, warm (Cosmos, unchanged)
  - the four basic waveforms as recipes
  - the chunk-tunes sounds, translated into this schema
  - a `registerInstrument` / merge API in place of the frozen literal
- `Audio/voices/plan.js`: `planVoice`, plus a generic **`note` role**: caller ADSR + duration, or hold (`duration:null`). When a recipe has its own `amp`, that envelope wins.
- `Audio/voices/voice.js`: `createInstrumentVoice`. Its handle gains **`setFrequency(hz, at, glideSec)`**, so the main page can retune live and the bridge voice can glide.
- `Audio/drums/`: the made drum sounds and a sample player. The player cuts a stroke short at the same channel's next stroke, and takes an injectable loader (base URL or blob URL), so IndexedDB user samples keep working.
- `Audio/tests/*.mjs`: plain Node scripts, no runner, recording mock context (as `Cosmos/tests/assert-instrument-voice.mjs` does).
- Main Playback is classic `<script>` globals. A small `<script type="module">` bridge sets `window.lrcVoices`, and `ToneRowPlayback` reads it at note time.

## Phases

**Phase 0: build the library (one session, must land first).**
- `git mv Cosmos/audio/instruments/*` into `Audio/voices/` and update Cosmos imports.
- Bump worker/module cache-bust `?v` where Cosmos imports them.
- Add the `note` role, recipe `amp`, `setFrequency` and `registerInstrument`.
- Translate the chunk-tunes sounds. Source: `/Users/averylogan/Dev/LRC/Compiler/Codex Compiler (dev)/Overworld/econ/runtime/chunk-sounds.js`; read only, do not edit Overworld.
- Guard: Cosmos plans for classic/glass/warm in roles row/bed/audition stay **byte-identical** to before the move, checked against a snapshot taken before any edit.
- Guard: every chunk-tunes sound's plan matches `planNote`'s components, noise, filters and envelope for a spread of notes (port the comparison idea from `chunk-sounds.verify.js:80-98`).
- All of `node Cosmos/tests/assert-*.mjs` keep passing (baseline: run them before editing and record failures, so "no new failures" is what's checked).
- No user-visible change.

**Phase 1a: main Playback adopts it (after 0).**
- `startStandardNote` / `startLegatoNote` / bridge voice call the library through the handle.
- `activeOscillators`, `trackOscillatorLifecycle`, `stopAllOscillators` (`__cleanupGain`), `releaseLayerVoice` and `handleFundamentalChange` move onto handle methods.
- The per-layer waveform `<select>` becomes a sound select: the four waveforms first (the default stays sine, so a deploy sounds exactly as it does today), then the new sounds.
- MIDI Out, mute/solo, `layerNoteTriggered`, PaintEngine's wrapper and the tempo bridge are unchanged.

**Phase 1b: Partitions drums (after 0; can run alongside 1a, since its only files are `Playback/Partitions/*`).**
- `triggerSample` / `loadSample` go through `Audio/drums/`.
- The made kick/snare/hat/perc/cym become choices next to the samples.
- User samples are unaffected.

**Phase 2: Cosmos rail (after 0).** The rail's VOICE selector offers the new sounds. Each needs bed and audition behaviour, which chunk sounds don't define. That is a sound-design pass Avery should hear.

**Later, not scheduled:**
- Point chunk-tunes' verify at `Audio/` instead of `Cosmos/audio/instruments/`, once Avery's chunk-tunes thread settles.
- Drop the unused Tone.js CDN load.
- Delete the dead `Core Interface/AudioEffects.js`.

## Decisions (Avery agreed, 2026-10-21)

1. **Struck sounds against the layer ADSR knobs (Phase 1a).** A struck sound (marimba, vibes and the like) keeps its own envelope, and the layer's A/D/S knobs gray out. Release stays live and damps a "damped" sound at note end. In legato mode a struck sound retriggers on each note rather than holding.
2. **Default sound.** Sine stays the default, so a deploy sounds exactly as it does today; the new sounds are opt-in.

## Working rules for every session

- Avery does the browser passes. Don't open the preview to verify. Run the Node suites and finish with a what-to-listen-for list.
- Commit on the session's own branch. Never merge into `main` or push; merging is Avery's call.

## Status (2026-10-22)

- **Phase 0 (done):** `Audio/voices/` built (369d082, e465ec3). Cosmos is byte-identical, checked against a fixture taken from the original modules.
- **Phase 1a (done):** main Playback plays through `Audio/voices` (4c71567, fc54a44), with a per-layer Sound menu. Sine stays the default.
- **Phase 1b (done):** Partitions plays through `Audio/drums/` (5919b01, 436bd8f), with a Synth kit next to the samples.
- **Merged** on `feat/shared-voices` (fa4232a, including the Partitions `?v=` bump). Not on `main`, not pushed. Avery liked the new sounds; the full browser pass is still owed.
- **Two fixes since,** on `composer-prototype` (which is cut from `feat/shared-voices`), both in `Audio/voices/voice.js`:
  - e3909e1: a glide booked ahead starts at its own time. Before, it slid across the whole gap.
  - 7fba64d: a release or fade on a settled note starts at its own time. Before, it was a slow sink or a click.

  Both come from one cause: a real engine's `cancelAndHoldAtTime` holds nothing when no event lies past that time. The glide fix also fixes the old live-site fundamental glide on held legato notes. These fixes reach `feat/shared-voices` only when `composer-prototype` merges.
- **Phase 2 (the Cosmos rail): not started.** Avery deferred it in favour of the Composer.
- **Still to do:** Cosmos's `releaseAudition` and `holdRowEnvelope` use the same `cancelAndHoldAtTime` pattern. They are unchanged, to keep Cosmos byte-identical, and haven't been examined.
