# Handoff — Cosmos Flight as a generative music environment: **Phase 0**

## Goal
Turn the Cosmos Flight View into an instrument. **Phase 0** is the minimal, end-to-end slice that proves the
audio pipeline: fly the cosmos, **select a rhythm from a bloom, and hear it** — the rhythm arpeggiates its own
tuning on a shared clock, spatialized by the star's position, with a **cockpit panel** (Linear Plot + transport)
that expands out of the exit handle. Nothing generative-clever yet (no ambient bed, no solver, no MIDI) — just
one lead voice, done cleanly, on a **dedicated audio layer completely separate from the site's playback engine.**

This is a POC step in a larger vision (see **Deferred / roadmap** at the end). Build ONLY Phase 0.

---

## Repo, branch, paths
- **Repo:** `/Users/averylogan/Dev/LRC/LRC_Builds/Large Rhythm Collider/` (git, static GitHub Pages, no bundler).
- **Branch:** work on the existing **`cosmos-flight-poc`** branch (already checked out). Do NOT touch `main`, do
  not deploy. Commit to `cosmos-flight-poc`.
- **The cosmos lives in** `cosmos/` at the repo root (a self-contained ES-module island). Key files you'll touch:
  - `cosmos/flight-view.js` — the flight app (canvas 3D engine, blooms, picking, the loop, `ensureFlight`/`stopFlight`).
  - `cosmos/flight-boot.js` — the boot island that wires the title-bar icon (enter) and `#lrc-div` (currently: exit).
  - `cosmos/oracle-core.js` — pure scale math you will REUSE (`normalizeLayers`, `lcmAll`, `deriveScale`). No DOM.
  - `index.html` — the `#cosmos-view` overlay (contains `#lrc-div`, the HUD, the detail card, etc.).
  - `style.css` — the `#cosmos-view` styles (near the bottom, a clearly-commented COSMOS block).
- **New file you'll create:** `cosmos/cosmos-audio.js` — the dedicated audio engine (details below).

> **Hard rule: keep the audio SEPARATE.** Do not import from or wire into `Core Interface/LRCModule.js`,
> `LRCSearch.js`, `Playback/*` (AudioEngine/Scheduler/Partitions), Tone.js, or MIDIOut. The site's playback stack
> is intentionally out of scope — build a small, self-contained WebAudio layer. The only code you reuse is the
> pure math in `cosmos/oracle-core.js`.

---

## Background decisions (already made with the owner — treat as fixed)
- **Shared tick clock.** All rhythms lock to ONE transport; every grid's cycle is the same duration (grids "move
  at equal speeds"). Fundamental maps to **pitch, not tempo.**
- **Distance → register.** Farther stars play **higher** (octave-lifted); near stars sit present/mid. This is a
  core pruning axis — do not skip it even though Phase 0 has one voice (the lead star moves as you fly).
- **Dedicated audio layer**, fully separate from the engine (see hard rule above).
- **Default-on.** The transport runs while in flight; selecting a rhythm makes it sound immediately (no Play gate).
- **Density = "Full melody" (option A).** Every distinct onset of the selected rhythm plays a tone. (Faithful and
  the quickest bridge; a "sparsity" knob is a later phase.)

---

## The instrument (Phase 0): "the rhythm plays its own tuning"

A bloom **node** is one tuning system, carrying `layers` (an array of ≤ a handful of integers, e.g. `[24, 23]`).
In LRC the rhythm and the scale are the SAME object: the composite onset pattern's gaps generate the tuning. So
the instrument is: **walk the composite onsets in time; each onset sounds the tone of its gap.**

### Deriving the voice (reuse `oracle-core.js` — do NOT re-implement the math loosely)
`deriveScale(layers)` in `cosmos/oracle-core.js` already computes everything; it just **dedupes** the per-onset
ratios into the scale set. For the melody you need the **ordered, per-onset** ratios (with repeats). Reproduce its
exact onset/space computation and keep the order. Write a pure helper (put it in `cosmos-audio.js`, importing
`normalizeLayers, lcmAll` from `./oracle-core.js`):

```js
import { normalizeLayers, lcmAll } from './oracle-core.js';

// One cycle of the rhythm as an ordered list of {t, ratio}:
//   t     = onset time as a fraction of the cycle, in [0,1)
//   ratio = folded pitch ratio in [1,2)  (1/1 = root)
// Mirrors oracle-core.deriveScale's onset/space math EXACTLY, but keeps per-onset order (no dedup, no 2/1 delete).
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
```

- **Faithfulness check:** the number of DISTINCT `ratio` values should equal the node's `.c` (cardinality) up to
  the octave-tone (`deriveScale` deletes `2/1`; a gap that folds to exactly `1/1` is the root and is kept here —
  that's correct for the melody). `comp.length` = onsets per cycle (can be tens for dense grids — that's expected;
  option A is meant to be busy).
- **Pitch in Hz:** `freqHz = ROOT_HZ * ratio * 2**octaveLift`. Ratios are octave-folded, so one octave of tones;
  `octaveLift` (0,1,2…) comes from distance (below). `ROOT_HZ` is a single constant for Phase 0 (e.g. `220`).
  (Per-star root variation by grid/fundamental is a later phase — Phase 0 uses one root.)

### Shared transport
- One cycle period `T` seconds (tempo knob; default e.g. `T = 2.0`). Every star's cycle is `T`.
- Note `k` in cycle `n` fires at audio time `startTime + n*T + notes[k].t * T`.
- Schedule with a **WebAudio lookahead scheduler** (a `setInterval(~25ms)` that schedules all notes whose time is
  within `[now, now + 0.1s]`). Do NOT schedule from the rAF loop — rAF is for visuals only.

### Spatialization (drive it from the flight loop each frame)
The lead star (the selected node's grid) has a live screen projection in the flight loop. Compute:
- **pan** = `clamp((s.x - cx) / cx, -1, 1)` → `StereoPannerNode.pan`. (`cx` = half canvas width; `s.x` = star's
  screen x. Both are in `flight-view.js`'s loop.)
- **distance** = the star's view-depth `s.z` (aka `vz`). Map it:
  - **gain**: near→loud, far→quiet, e.g. `gain = clamp(map(s.z, FOG_NEAR, FOG_FAR, 1, 0.15), 0.05, 1)`.
  - **octaveLift**: near→0, far→+1/+2, e.g. `Math.min(2, Math.floor(map(s.z, FOG_NEAR, FOG_FAR, 0, 2.99)))`.
    (`FOG_NEAR`/`FOG_FAR` are module vars in `flight-view.js`, set per placement.)
- If the lead grid is no longer projected (flew away / evicted), ramp gain to 0 (don't crash). If the lead grid
  evicts from `cosmos.zones`, clear the lead.
- Apply spatial params to CURRENTLY-SOUNDING/future notes (set on the shared pan/gain nodes so they glide as you
  fly). `octaveLift` should apply to newly-scheduled notes (don't repitch already-scheduled ones).

### Voice/audio graph (keep it small)
Per note: `OscillatorNode` (sine or triangle — soft) → per-note `GainNode` (short A/D envelope, e.g. 8ms attack /
150–300ms decay so a busy melody doesn't smear) → shared `StereoPannerNode` (pan) → shared master `GainNode`
(distance gain) → `audioCtx.destination`. One-shot oscillators per note (create, `start`, `stop`) is fine for
Phase 0. Cap concurrent oscillators defensively (e.g. skip scheduling if > ~48 live) so a pathological dense grid
can't runaway.

---

## The dedicated audio module — `cosmos/cosmos-audio.js` (new)
Export a small singleton-ish API. Suggested surface:

```js
export function initAudio()        // create AudioContext (lazily) + master graph. Call on a USER GESTURE (enter).
export function resumeAudio()      // audioCtx.resume() — needed by autoplay policy; safe to call in enterCosmos.
export function setLead(voice)     // voice = deriveVoice(node.layers) + {node}; (re)start the transport melody. null = silence.
export function setSpatial(pan, gain, octaveLift)   // called each frame from the flight loop for the lead star.
export function setTempo(T)        // seconds per cycle (tempo knob).
export function setMuted(bool)     // master mute (transport keeps running; the playhead keeps sweeping).
export function transportPhase()   // → 0..1 position within the current cycle (for the cockpit playhead). 0 if idle.
export function stopAudio()        // stop transport, cancel scheduled notes, suspend/close the context. NO background sound.
```

- **Autoplay policy:** `AudioContext` starts suspended until a user gesture. Entering the cosmos is a click on the
  ✦ icon (a gesture), so call `initAudio()`+`resumeAudio()` inside `enterCosmos` (or on first `setLead`).
- **Teardown:** `stopAudio()` MUST be called from the exit path so no audio runs after leaving (mirror the worker
  teardown in `stopFlight`). See wiring below.

---

## The cockpit UI — the `#lrc-div` becomes a real house panel

Today `#lrc-div` (in `index.html`, inside `#cosmos-view`) is a minimized "exit handle" wired to exit on single
click (`cosmos/flight-boot.js`). Rework it into a collapsible **cockpit**:

- **Minimized** (default): the `◱ LRC` handle. Change the expand glyph to **`+`** (house convention — the site's
  panels use `+`/`−`). The current glyph is `#lrc-div::after { content: "\2922" }` in `style.css` — change to `+`,
  and to `−` when expanded (e.g. toggle a `.open` class on `#lrc-div` and switch the glyph in CSS).
- **Expanded** (`.open`): reveal the cockpit body containing:
  1. **Linear Plot** of the selected rhythm — a small `<canvas>`. Draw the composite onsets as ticks along a
     horizontal track at `x = note.t * width` (from `deriveVoice`), optionally colored by `note.ratio` (reuse the
     bloom's `cardColor`/`CHARTED` sense if handy, or just the house accent). Overlay a **playhead** line at
     `x = transportPhase() * width`, updated each frame. This is the visual bridge to the engine's plot.
  2. **Transport strip**: a mute toggle and a tempo control (slider or +/−). House-styled (reuse the `--hud-*`
     tokens already scoped on `#cosmos-view`; see the existing detail-card / help-panel CSS for the exact idiom).
- **Auto-expand on selection:** when the user selects a rhythm from a bloom (a node click — see integration
  point), add `.open` to `#lrc-div` so the cockpit pops open showing that rhythm.
- **Exit = double-click.** Single click / clicking the `+` toggles expand; **double-click** the handle returns to
  the engine. Guard the click/dblclick conflict (a dblclick fires two clicks): use a short click-delay timer, or
  simply have `dblclick` call exit unconditionally (the two toggles it rode in on net out). Exit must still run the
  full teardown (`window.exitCosmos()` → `stopFlight()` + `stopAudio()`).

Keep it house-styled and minimal — match the existing cosmos chrome (blurred `--hud-bg` panel, `--hud-accent`
green, Segoe labels + mono numerals). The cockpit can grow in later phases (mode/density knobs), so structure the
body so sections can be added.

---

## Exact integration points in `flight-view.js`

Line numbers are from the current `cosmos-flight-poc` tip; confirm by context (the file evolves).

1. **Selecting a rhythm (the "make it sound" hook).** In the `pointerup` handler, a **node** click currently does
   (~line 949):
   ```js
   } else if (hover && hover.kind === 'node') {
     cosmos.setFocus(hover.grid); selected = hover;   // focus the bloom you're interacting with
   }
   ```
   After `selected = hover`, set the lead + open the cockpit:
   ```js
   setLead({ ...deriveVoice(hover.layers), node: hover });   // start the melody
   openCockpit();                                            // add .open to #lrc-div
   ```
   (Import `deriveVoice`/`setLead` from `./cosmos-audio.js`. `hover.layers` is the node's layer array.)
   A **star** click (~line 946) blooms a grid but isn't a specific tuning system — do NOT set a lead from a star in
   Phase 0 (leads come from nodes). Clicking empty space clears `selected`; you may leave the lead playing (owner
   preference: blooms/selection persist). If the lead's grid evicts, clear the lead (ramp to silence).

2. **Per-frame spatialization.** The loop builds a projection map `proj` (grid → `{ z, s, rp }`) around
   **line 761**. After it's built, if there's a current lead grid, read its projection and push spatial params:
   ```js
   const lp = leadGrid != null && proj.get(leadGrid);
   if (lp) setSpatial(clamp((lp.s.x - cx)/cx, -1, 1), distGain(lp.s.z), distOctave(lp.s.z));
   else    setSpatial(0, 0, 0);   // lead not visible → silence via gain 0
   ```
   `cx`, `focal`, `FOG_NEAR`, `FOG_FAR` are all module-scope in `flight-view.js`.

3. **Playhead.** In the same loop, if the cockpit is open, redraw the plot's playhead from `transportPhase()`.

4. **Teardown.** `stopFlight()` is at **line 489**. Add `stopAudio()` there (and clear the lead) so exiting the
   cosmos kills all sound, exactly like it kills the worker pool. Re-entering should reinit cleanly (the audio
   module should tolerate `initAudio()` after `stopAudio()`).

5. **Enter / audio unlock.** In `cosmos/flight-boot.js` `enterCosmos()` (line 10), call `initAudio()` +
   `resumeAudio()` (this is the user-gesture unlock). Keep it in the boot island OR expose an `ensureFlight`-side
   hook — your call, but the resume must happen on the enter gesture.

6. **`#lrc-div` wiring.** In `cosmos/flight-boot.js` line 35 the div is currently `click → exitCosmos`. Change the
   interaction model: **single-click / `+` → toggle cockpit**, **double-click → `exitCosmos()`**. You can move the
   div's interaction ownership into `flight-view.js` (it already owns the overlay DOM + the loop + the lead state),
   and have `dblclick` call `window.exitCosmos()`. Just make sure exactly one place wires it (avoid double-binding;
   note the existing `_cosmosWired` guard).

---

## Gotchas
- **Autoplay policy:** no sound until `audioCtx.resume()` after a gesture. The ✦-icon enter click is that gesture.
- **Busy melodies (option A):** dense grids yield tens of onsets per cycle. That's expected; keep envelopes short
  and cap live oscillators so it doesn't smear or runaway. If it's unpleasantly dense, that's fine for Phase 0 —
  the sparsity/pruning knobs are a later phase; don't invent them now.
- **Do NOT re-derive the scale math loosely.** `deriveVoice` must match `oracle-core.deriveScale`'s onset/space
  computation exactly (positions as a Set of `i*grid/L`, sorted; wraparound gap; `spaceFund` = largest gap via a
  loop NOT `Math.max(...spaces)` — dense grids overflow the call stack on spread). Only difference: keep order, no
  dedup, no `2/1` delete.
- **Keep it additive & separate:** new file `cosmos-audio.js` + edits to `flight-view.js`/`flight-boot.js`/
  `index.html`/`style.css` only. No engine/Tone/Partitions imports. The 4 headless guards in `cosmos/cosmos/`
  (`assert-{cosmos,runtime,hilbert,shard}.mjs`) must still pass (`node assert-*.mjs` from that dir) — audio doesn't
  touch them, but run them to be sure nothing regressed.
- **The owner does their own audio/UI verification.** Don't try to drive a browser to "hear" it; build it correctly,
  run the headless guards + a Node syntax check (`node --check` on a copy of the module), and hand back.

## Acceptance criteria
1. Enter the cosmos, fly to a star, click a bloom **node** → the cockpit auto-expands showing that rhythm's Linear
   Plot, and the rhythm **sounds** (melody arpeggiating its tuning) on the shared transport.
2. The tone is **spatialized**: panning tracks the star's screen position; it gets quieter and **higher** as the
   star recedes, present/mid as you approach.
3. The **playhead** sweeps the plot in sync with the audio cycle; the tempo control changes the cycle speed.
4. Selecting a different node swaps the lead cleanly. Clicking `+` toggles the cockpit; **double-clicking** the
   handle exits to the engine.
5. On exit, **all sound stops** (context suspended/closed, transport cancelled) — no background audio, mirroring
   the worker teardown. Re-entering works and can sound again.
6. No engine/Tone/MIDIOut/Partitions imports anywhere in the cosmos audio path. All 4 cosmos guards still pass.

---

## Deferred / roadmap (NOT in Phase 0 — context only, so you build Phase 0 extensibly)
- **Phase 1 — ambient bed:** the N nearest solved stars also sound, but SPARSE (e.g. one tone on their downbeat),
  thinned + spatialized + register-sorted by distance. Pruning by role: focused star = full lead, others = quiet
  accents. (Structure `cosmos-audio.js` so it can host multiple voices, not just one lead.)
- **Phase 2 — progression policy:** the Progression Solver drives which tones/qualities sound over the local field
  (harmonic pruning — "hew away the dissonance to find the familiar bits").
- **Phase 3 — MIDI in:** Web-MIDI; **snap-to-star** (played chord tunes/flies you to the nearest matching grid).
- **Phase 4 — date/location seeding:** real-world time seeds root/region → "today's cosmos"; a no-interaction
  ambient mode that sounds good to anyone who wanders in.
The through-line: **one spatial sequencer + swappable selection policies.** Phase 0 is the sequencer + one policy.
```
