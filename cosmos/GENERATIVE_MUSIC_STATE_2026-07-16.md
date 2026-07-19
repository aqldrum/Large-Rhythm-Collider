# Cosmos generative music — state of the world (handoff, 2026-07-16)

Picks up after **Phase 0** (the instrument) and **the Chord Walk** (Part A + B, harmonic tint) both
landed. This doc is the orientation for whoever (agent or Avery) picks this up next — what's built, what
it does, what's committed, what's still open, and where the design is headed. Read this before
`PHASE0_GENERATIVE_MUSIC_HANDOFF.md` and `CHORD_WALK_HANDOFF.md` (both still in this folder) — those are
the original specs; this is the as-built status + corrections found along the way.

---

## Repo / branch / commit state

- **Repo:** `/Users/averylogan/Dev/LRC/LRC_Builds/Large Rhythm Collider/` (git, static GitHub Pages, no
  bundler). **Branch:** `cosmos-flight-poc`. Not merged to `main`, not deployed.
- **Committed:**
  - `ba52b36` — Phase 0 handoff spec (doc only)
  - `3a9b01e` — Phase 0 implementation (`cosmos-audio.js` new; `flight-view.js`/`flight-boot.js`/
    `index.html`/`style.css` wired). Includes the stereo-pan fix and the `M`-key mute toggle (both landed
    before this commit was made).
  - `c52a557` — The Chord Walk, Part A + B in one commit: `chord-walk.js` (new), the whitelisted additive
    export in `Playback/AdvancedPlayback/ProgressionSolver.js`, `cosmos/cosmos/assert-chordwalk.mjs` (new
    guard), `CHORD_WALK_HANDOFF.md` (doc), and the Part B wiring in `cosmos-audio.js`/`flight-view.js`/
    `index.html`/`style.css`.
  - `54636d4` — The universal-clock tick-rate rework (see "Tick rate" below), including the
    `lead.grid`→`lead.notes.length` fix.
- Nothing uncommitted as of this doc's last edit — clean tree.

## What the instrument does, end to end

Fly the cosmos → click a bloom **node** (one tuning system) → its own composite-onset rhythm arpeggiates
its own tuning on a shared transport, panned/gained/registered by the star's live screen position, **and**
its deterministic signature chord loop (the Chord Walk) tints the melody — in-chord onsets full,
out-of-chord onsets ducked — while a cockpit (`#lrc-div`, bottom-left) shows the onset plot, a live chord
readout, and transport controls. Exit kills all sound; re-entering is clean.

## File map

| File | Role |
|---|---|
| `cosmos/cosmos-audio.js` | Dedicated WebAudio engine. Owns the transport, the audio graph, spatialization, the Chord Walk tint. Zero engine/Tone/Partitions imports (only pure math from `oracle-core.js`). |
| `cosmos/chord-walk.js` | Pure module. `solveStarSong(layers, opts)` → a deterministic chord-loop `Song` for a tuning system. No DOM, no audio. |
| `cosmos/flight-view.js` | Owns `#lrc-div` cockpit interaction (moved out of `flight-boot.js`), the per-frame spatialization/chord-readout draw, and the node-click hook that wires a star's rhythm+song into the audio engine. |
| `cosmos/flight-boot.js` | Unlocks audio (`initAudio`+`resumeAudio`) on the cosmos-enter gesture. |
| `Playback/AdvancedPlayback/ProgressionSolver.js` | Untouched engine file except one additive export-object line (whitelisted reuse: `pairDeviation, scoreTonesWithBatch, chordWindowFractions, minCircularDistance, mod1200`). |
| `cosmos/cosmos/assert-chordwalk.mjs` | New headless guard (7 checks) for `chord-walk.js`. |
| `cosmos/cosmos/assert-{cosmos,runtime,hilbert,shard}.mjs` | Pre-existing cosmos guards — unaffected, still green. |
| `index.html` / `style.css` | `#lrc-div` cockpit markup (Linear Plot canvas, chord readout, transport strip) + `--hud-*`-themed styling. |

## cosmos-audio.js — API surface

```js
initAudio()                       // create AudioContext (lazily) + master graph. Call on a user gesture.
resumeAudio()                     // audioCtx.resume() — autoplay unlock.
setLead(voice)                    // voice = deriveVoice(node.layers) + {node}. null = silence.
setSpatial(pan, gain, octaveLift) // per-frame, from the flight loop, for the lead star.
setTickRate(ticksPerSecond)       // the universal clock's rate (default 10). See "Tick rate" below.
setMuted(bool)                    // master mute; transport keeps ticking.
transportPhase()                  // 0..1 position in the lead's current cycle, for the playhead.
setSong(song)                     // a Song from chord-walk.js's solveStarSong(), or null.
currentChord()                    // { symbol, cycleIndex } | null — for the cockpit readout.
stopAudio()                       // full teardown: cancels transport, clears lead/song, closes context.
```

`deriveVoice(rawLayers)` is also exported — the per-onset melody derivation (mirrors
`oracle-core.deriveScale`'s math exactly, keeps order, no dedup).

## Tick rate — the universal clock (fixed today, was broken for a bit)

**Design:** the shared clock across every star is a **tick rate** (ticks/sec, default 10), not a fixed
cycle duration. A "tick" = one **onset** of whichever star is currently the lead
(`lead.notes.length` ticks = one full cycle of that star's rhythm). `note.t` (each onset's fraction of the
cycle, in `[0,1)`) is untouched by this — the tick rate only rescales the overall pace, the actual
(uneven) onset spacing within a cycle is preserved exactly. Average onset rate ends up pinned to
`ticksPerSec` regardless of a star's grid size.

**The bug that shipped first, and why:** the first cut of this used `lead.grid` (the LCM of the layers,
via `deriveVoice`) as the "ticks per cycle" count instead of the onset count. `grid` can be tens of
thousands even for an unremarkable rhythm (sampled real bloom nodes: 14,300–96,390) — at 10 ticks/sec that
made cycles run **24 minutes to 2.7 hours**, and since a chord holds for `CYCLES_PER_CHORD=2` cycles, the
chord-clock readout looked completely frozen ("disconnected"). Fixed by switching every place that divided
by `lead.grid` (`schedulerTick`, `resyncSchedulePointer`, `transportPhase`, `currentChord`) to
`lead.notes.length` instead. Real cycle durations at the default rate are now ~12s–367s for the same
sample set — listenable. **Lesson for future clock/tempo work in this codebase: `grid` (LCM) is the wrong
unit for anything user-facing-timed; `notes.length` (actual onset count) is the musically meaningful one.**

`setTickRate()` and lead swaps both re-anchor `transportStart` so the absolute tick count never jumps —
only the pace changes going forward, consistent with the "universal clock" framing (the tick counter is
one continuous thing; each star's cycle is just a modular view of it through that star's own onset count).

Cockpit slider: `#lrc-tempo-slider`, range 1–30, default 10, labeled "ticks/s".

## The Chord Walk — as-built notes

`solveStarSong(layers, opts)`: solves the star's tone row against the full chromatic (the "frame" — every
root searched at once via `ProgressionSolver.optimize`), keeps the 24 maj/min triads whose 3 semitones are
all within `playableMaxDev` (35¢ default) of their 12TET target, then walks that vocabulary by smoothest
voice leading (parsimony + JI-coherence, tabu list k=3) until the `(chord, tabu)` state repeats — that
repeat is the song (`transient` intro once, then `cycle` loops forever). Deterministic: same layers, same
song, always.

**Real-data findings from the guard's sample of the 12T codex (30 keys):**
- Only ~14/30 (47%) produce a **playable** triad vocabulary at the default 35¢ threshold — the rest
  gracefully return `null` (documented behavior: "Vocabulary empty → null, caller keeps plain Phase 0").
  If more stars should sound harmonically tinted, `playableMaxDev` is the knob (passed via `opts`, not a
  hardcoded constant) — nobody's raised it yet.
- `frame.strength` legitimately clamps to exactly `0` for some real keys (not just `(0,1]` as the original
  handoff draft claimed) — a scale maximally far from 12TET across every pair. Corrected in the guard.
- **Corrected a real math error in the handoff's own spec:** it claimed the Parallel, Relative, and
  Leittonwechsel neighbors of a major triad all sit at voice-leading cost exactly 1. Exhaustively verified
  (all 6 bijections × all 12 roots): only **P** and **L** are cost-1; **R** (relative) is cost-2 — the
  standard, well-established neo-Riemannian fact that P/L move one voice by a semitone while R moves one
  voice by a whole tone. `chord-walk.js`'s `vlCost` itself needed no change; only the guard's asserted
  expectation was fixed to match reality.

Part B wiring (in `cosmos-audio.js`): a chord clock (`CYCLES_PER_CHORD=2`, pure function of the scheduler's
own cycle number, so tick-rate changes and resyncs stay safe) selects the current chord; per-`(song,lead)`
note masks (`decimalToFraction(note.ratio)` matched against each chord's `windowFractions` — exact-match
guarantee, since it's the same fraction computation `deriveScale` used) drive ducking (−12dB out-of-chord,
full in-chord, **no onset ever skipped**). Verified against 8 real stars: every one showed a genuine
in-chord/out-of-chord mix, not degenerate always-on/off.

## Verification status

All 5 headless guards green (`node cosmos/cosmos/assert-{cosmos,runtime,hilbert,shard,chordwalk}.mjs`),
`node --check` clean on every touched/new file. **Nothing here has been browser-verified by me** — per
house convention (see `[[feedback-user-does-own-ui-verification]]` if you're an agent with memory access),
Avery does his own audio/UI pass. If you're picking this up fresh: don't assume "guards pass" means "it
sounds right" — it means the math is internally consistent, not that the mix/pacing/design choices land.

## Known gaps / open items, roughly in likely-next order

1. **Commit the uncommitted tick-rate fix** (see git status above) — or fold in whatever Avery's doing in
   parallel first.
2. **Grid-aggregate tones (Avery's flagged correction, not yet built).** Both `deriveVoice` (Phase 0
   melody) and `solveStarSong` (Chord Walk frame) currently solve against ONE clicked bloom **node**'s
   layers — one tuning system. Avery's correction: polyrhythm **grids** are the stars; a grid's bloom
   contains many tuning systems (nodes) that all share that grid, so their cycles can be overlaid and their
   tuning systems considered together AT THE STAR level, not per-node. Next evolution: solve the frame (and
   probably the melody voice too) against the UNION of ratios across all of a grid's bloomed tuning
   systems, not `deriveScale(oneNode.layers)` alone. This is a real, not-small redesign — touches
   `deriveVoice`/`solveStarSong`'s inputs and probably how/when they're invoked from `flight-view.js`
   (currently keyed to a node click; grid-level aggregation would need a different trigger, maybe a star
   click, or lazily unioning nodes as a bloom streams in).
3. **`playableMaxDev` tuning.** ~53% of real 12T keys currently get no chord tint at all. Worth deciding
   whether that's the right density, or whether the threshold (or vocabulary — triads-only per spec v1)
   should loosen.
4. **Deferred by original spec, still not built:** ambient bed (Phase 1 — nearby stars sound sparse,
   spatialized, register-sorted), progression-solver harmonic pruning as a selection policy (Phase 2),
   MIDI-in snap-to-star (Phase 3), date/location seeding (Phase 4), global coprime meta-clocks on site-time
   (mentioned in `CHORD_WALK_HANDOFF.md`'s roadmap — Avery said he's actively designing this; the tick-rate
   rework above is arguably a precursor/building block for it, not the thing itself).
5. **Per-star root.** Both the melody and the chord frame use one fixed `ROOT_HZ=220` — "per-star root
   variation by grid/fundamental" was explicitly deferred in Phase 0 and never revisited.

## Gotchas for whoever builds next

- **Hard separation rule still applies:** no imports from `Core Interface/`, `LRCSearch.js`,
  `Playback/*` (AudioEngine/Scheduler/Partitions), Tone.js, MIDIOut — except the one whitelisted
  `ProgressionSolver.js` (pure math only). Don't widen that whitelist without a reason.
- **Always run all 5 guards before calling something done** — they catch real regressions cheaply (the
  ProgressionSolver export diff being export-object-only, `deriveVoice`/`deriveScale` staying in exact
  sync, etc.).
- **The owner does his own audio/UI verification.** Don't spin up a browser to "hear" changes — build it
  correctly, verify with guards + `node --check` + targeted Node-side math checks (see how the tick-rate
  bug above was actually caught: a quick Node script computing real cycle durations across sampled codex
  keys, not a browser session), and hand back.
- **`grid` vs `notes.length`:** see the Tick rate section — this distinction bit once already. Any future
  timing/density work should default to onset count, not raw LCM, unless there's a specific reason to want
  the full grid resolution.
