# Composer

Press Compose and the Composer decomposes one rhythm's own tone row into an arranged tune: a lead, chords, comping, a bass, an inner voice and drums. Every note is an onset the row already plays, at its own time and with its own ratio. Then press Perform. It's a prototype. It runs in a standalone lab page, and as a **Composer tab** beside Partitions on the main LRC page (built 2026-10-22 night; not yet seen in a browser).

`DESIGN_NOTES.md` holds the decisions (Avery's calls are marked **decided**), the proposals, the measurements and the open questions. This file is the short way in.

## Run it

Serve the repo root as a static site and open the lab:

```bash
python3 -m http.server 8000
```

**On the main page:** open `http://localhost:8000/` and generate a rhythm.
- **The Composition lens (sprint 2):** a notation glyph appears in the header beside the Cosmos button. Press it and the canvas reads the row as its composition: it composes (animated on the Linear Plot), then plays. The Playback div's Play/Stop then plays and stops the composition, the layer strips become part strips, and Scale Selection becomes a live chord-tone readout. Press the glyph again for the row, everything restored. A rhythm composed before is recalled at once, with no re-solve. "Composition lens and store" in `DESIGN_NOTES.md` has the details.

**The Composer window:** double-click the Playback panel's header to open the Partitions window, then pick **Composer** in its title bar's tab strip. It edits the same composition the glyph plays.
- Compose reads the page's rhythm and Playback cycle. Changing either turns the button back to Compose.
- Perform stops main playback, and main playback stops the Composer: one thing sounds at a time.
- The upper-right Linear Plot lights the Composer's notes, a colour a part, with a playhead during Perform.
- With **show the work** on (the default), Compose is animated on the plot: the root chosen, the lead line, the chords under it, the settling and the parts landing. Click, or press Esc, to skip.
- Click a lane's name to inspect that part: its sound, legato and level, then Harmony (the progression editor), Lines, Drums (mode and kit) and Tuning.
- **A MIDI clip** (MIDI targets, phase B): choose a .mid under the header, or drop one on the window. The Composer finds where the row can play it, and composes everything else around it: the clip is the lead, the composition loops on the bars it occupies, and playback starts at the clip's own tempo. The window says how it fits (hits, the window, substitutes, silent notes, the classes the row can't play), offers the tonic and the other placements to audition, and Clear goes back to an ordinary Compose. "MIDI targets (phase B)" in `DESIGN_NOTES.md`.
- The section "Composer tab on the main page" in `DESIGN_NOTES.md` has the details.

**The lab:** go to `http://localhost:8000/Composer/lab/composer-lab.html`. The lab isn't linked from `index.html`. Both pages need http, not `file://`, because Compose runs in a module worker. Both play through the shared voice library in `Audio/voices/`.

- **Inputs:** four layer numbers (blank or 0 means absent), the cycle in seconds, a seed, and presets from 8:7:6:5 up to a 16,359-onset row.
- **Compose → Perform ⇄ Stop.** Change any input or knob and the button goes back to Compose.
- **Knobs:** bars, slots per bar, frame ±¢, modulation, anchors, settle passes, root presence, and the table (full in the worker, lean on the main thread). Each one shows what Compose chose, or "asked" when you've overridden it.
- **Progression:** a root a bar from the row's own tones (its ±frame clusters, by ratio, note name, cents and presence), or auto. Compose keeps each asked root, finds the quality the bar's tones support, and mines everything under it. "Take from last compose" copies the roots the last compose chose; "clear" sets every bar back to auto.
- **Live, without re-composing:** each part's sound, legato, on/off and level, plus Glide (portamento) and Tempo.
- **Drums lane:** the mode or curated pattern, fills, on/off, level, and a Drum kit row with a sound per voice (the made kit, or the site's samples). Any change re-arranges the drums from the spec, live.
- **Readouts and export:** tempo, meter, root, chords, drums and the decisions list (what Compose chose and why, and what each drum bar plays). JSON export gives the spec, with the drums as they play, plus `playback`.

## How Compose works

`compose()` in `core/compose.js`:

1. **Row** (`row.js`): every onset in tick order, each owning the ratio of the gap after it. A row is refused past 1,048,576 onsets, below 3 tones, or past a 2^53 grid.
2. **Knobs and cells** (`frame.js`, `cells.js`):
   - the frame, ±15¢ by default
   - the root, by presence in its ±frame cluster
   - the meter: N bars nearest 110 BPM, and S slots per bar
   - the phase, one of the root's downbeats, picked by the seed
   - the cells: N × S slots on partitioned anchors, each holding the candidate tones of about 12 onsets around it
3. **Lead, pass 1** (`lines.js`): the exactly cheapest line per phrase, found by dynamic programming over slots × candidates × note count, rooted, with no harmony.
4. **Chords, one per bar** (`harmony.js`): derived from the lead's strong notes plus the bar's own tones. A root sounding off the grid retunes the fundamental from that bar on (modulation).
5. **Lead, pass 2,** over the chords. Then **settle passes:** re-derive the chords from the kept lead and re-mine, until the chords stop changing (at most 3 rounds).
6. **The other parts from the final chords:**
   - chord voices: one onset per chord tone per bar
   - comping: one layer's strikes on chord tones
   - bass: mined bar by bar from the root
   - inner voice: in the lead's gaps
7. **Articulation:** legato per part, sounds, and baseHz (the lead's median pitch sits at about 539 Hz).
8. **Drums** (`drums.js`, `drum-patterns.js`): `arrangeDrums(spec)`, from the spec alone, so it can run again without composing:
   - every stroke lands on an onset the row plays
   - the bar's 4 beats are Partitions' cut of its S slots
   - the default is a backbeat: kick on 1 and 3, snare on 2 and 4, a hat every slot
   - other modes: perc *with* or *against* the lead and comping, a *partition* line from the layer that strikes the downbeat, or a curated pattern (rock, half-time, four on the floor, funk, soca, bossa, shuffle, son and rumba clave)
   - fills at phrase ends

**Targeted progressions** (`progression.js`, `compose(..., { progression: [ratio | null, ...] })`): the bars given a root skip steps 3–4's lead-led choice. Their chord keeps the asked root, and its quality is the best one the bar's own tones support (all its classes but at most one sounding). If none is supported, it falls back to a dyad or the root alone, and says so. The lead is mined over these chords, and the settle passes re-derive only the quality. Auto bars are found as above, and an off-grid root retunes, as in step 4. With no progression, or all auto, Compose is unchanged.

## Files

- **`core/`:** pure ES modules (no DOM, fetch or clock) that run in a page, a worker or Node. `compose-worker.js` wraps `compose()` for a module worker. `superrow.js` lays many rhythms of one grid on one row for Cosmos's Grid-card Compose, and `superrow-worker.js` builds and composes one off the main thread ("Cosmos Compose mode" in `DESIGN_NOTES.md`).
- **`core/chord-symbols.js`** (step 4b): the typed progression field. It ports the site's chord-symbol parser and tokenizer, then `barMaterials` (the row, the cells and the bars' tones before a compose), `resolveSymbols` (a symbol a bar → a root cluster and a quality, ✓ or amber, as `{ ratio, quality }` pins for `compose`'s progression) and `pinsToField` / `fieldToPins`. `progression.js` takes those pins. See "Step 4b: typed progression" in `DESIGN_NOTES.md`.
- **`core/trace.js`:** the compose trace, `compose(..., { trace: true })` (or `{ trace: { caps } }` for the alternates' longer lists, step 4a) → `spec.trace`: every decision as ordered, untimed events pointing at the row's onsets, for the main-page and Cosmos animations; `traceTimeline()` paces it. `TRACE.md` is the contract.
- **`core/rearrange.js`** (step 4a): local edits to a composed spec, with Compose's own per-bar builders. `rearrange(spec, row, cells, { bar, chord })` swaps a chord; `{ phrase, line, chordsFollow }` swaps a lead for a runner-up. `materialsOf(spec)` rebuilds the row and cells. "Step 4a: core rearrange" in `DESIGN_NOTES.md`.
- **`core/arp.js`** (Arp mode, phase B core; `COMP_ARP_ORDER.md`): `arrangeArp(spec, materials, partId, { pattern, rate, range, legato })` plays the lead or the inner voice as an arpeggio over the spec's chords, rebuilt from the spec with no re-compose, as the drums are: each slot cut into `rate` steps, each step a chord-tone onset on the ladder's next rung (up, down, up-down, as played). The part keeps its line (`lineOf`), and a MIDI target's lead is refused (`arpRefusal`). "Arp mode (phase B core)" in `DESIGN_NOTES.md`.
- **`core/midi.js` and `core/target.js`** (MIDI targets, phase A; `TARGET_ORDER.md`): a Standard MIDI File read and decoded onto its own grid (`readMidi`, `decodeClip`; `writeMidi` authors the tests' clips), and where in the row the clip can be played (`placeClip`: the lattice, transposition, bar count and phase, per-phrase lattice drift, note-offs on onsets, misses with substitutes, alternates; `laneReport`). `compose(..., { target: { clip, placement?, tonic?, maxDriftCents? } })` composes around it: the clip pinned as the lead, every part inside the window (`cells.js` `cropCells`), the loop the window's span. "MIDI targets (phase A)" in `DESIGN_NOTES.md`.
- **`perform/`:** what the lab and the main page share, with no DOM:
  - `composer-controller.js`: state and actions
  - `composer-player.js`: a lookahead scheduler, with an optional destination, injectable timers and a public `tick()`
  - `compose-runner.js`: the worker for the full table, the main thread for the lean one; `runCompose.rearrange` sends a big row's edits to the same worker (step 4d)
  - `readouts.js`: what a view says about a spec
- **`lab/`:** `composer-lab.html` and `composer-lab.js`, the lab page and its view. `lab-controller.js` and `lab-player.js` re-export the shared modules under their old names.
- **`store/`:** `composition-store.js` (pure), the main page's one composition store (sprint 2): an entry per rhythm + cycle (the shared controller's state shape, which the controller binds), an LRU of 4, `subscribe`, the page-level lens, recall without re-solve. Step 4d adds each entry's live edits (`composed`, `edits`, the typed `field`, `undo`/`redo`, `dropped`), and `composition-edits.js` (pure) holds their records, the undo snapshots and the alternates read from the trace. The controller applies them (`swapChord`, `swapLead`, `setProgressionField`, the drum grid, `undo`/`redo`, `alternatesOf`), in the module worker for big rows. "Step 4d: store edits and pins" in `DESIGN_NOTES.md`.
- **`page/`:** the main page's Composer tab, and (sprint 2) the Composition lens:
  - `plot-highlights.js`: the pure spec → per-part node highlights mapping, and the playhead's place on the plot
  - `plot-overlay.js`: draws the highlights on the Linear Plot through `LRCVisuals.setComposerOverlay`
  - `tab-controller.js`: the tab's state (no DOM)
  - `composer-tab.js` and `composer-tab.css`: the view. Step 4e: the lanes became the bar × part matrix (the typed field across the top of the Chords row) and the inspector follows the selected cell (its alternates, its notes, its drum steps); Undo/Redo, ⌘Z / ⇧⌘Z
  - `matrix.js` (step 4e, pure): the matrix and the inspector's lists as data (cells, marks, the arrow keys, the field's inline resolution, the prime strip); `audition.js`: an alternate auditioned at the next bar boundary, kept, or reverted with no redo step (over the controller's `audition` / `keepAudition` / `revertAudition`). "Step 4e: the matrix and the context inspector" in `DESIGN_NOTES.md`
  - `target-lines.js` (MIDI targets, phase B, pure): the MIDI clip control's lines as data (the decode line, the fit line, the placements, the tonic choices, errors in plain words) and the clip's marks for the matrix's lead row. The control itself is in `composer-tab.js`; the controller's `setTarget`, `setTargetTonic` and placement auditions are in `perform/composer-controller.js`. "MIDI targets (phase B)" in `DESIGN_NOTES.md`
  - `composer-bridge.js`: `window.lrcComposer`, loaded by `index.html`. `PartitionsUI.js` calls it from its tab strip.
  - `trace-frames.js` and `compose-animator.js`: Compose animated on the Linear Plot from its trace ("show the work", on by default). `trace-frames.js` is the pure trace + time → frame mapping; `compose-animator.js` is the driver and the painter (with a `pace` seam).
  - `lens.js`: the Composition lens (row ⇄ composition), the one transport (`lrcComposer.transport`), and the page API for later steps (`lrcComposer.lens`: `press({ pace })`, `toRow()`, `onChange`)
  - `toolbar-glyph.js`: the header glyph (`#composition-glyph` in `index.html`): hidden, ready (one breath a session), composing, lit
  - `part-strips.js`: the Playback div's part strips under the lens, in sync with the window
  - `panel-locks.js`: the Scale Selection chord-tone readout and lock, and the Families note
  - `composition-lens.css`: the glyph, the strips and the locks; `plot-overlay.js`'s `createOverlaySeat` shares the one overlay between the tab and the lens
  - `theater.js` + `theater.css` (sprint 2, step 2): "show the work" as theater, driven by the lens's events: the scrim (one class on `<body>`) and the floating caption around a rhythm's first animated compose, every click or Esc a skip, a window opened mid-show a skip (`lrcComposer.theater`); the short recall version is `trace-frames.js`' `recallTimeline`
- **`../Tutorial/`** (sprint 2, step 3): the guided tour of the main page, `window.lrcTour`. `tour-script.js` is the pure script (the seeded layer generator, the opening's timing model, the steps as data); `tour-driver.js` plays it with a spotlight, popups and motion (real typing, the real Generate, the glyph through `lens.press({ pace })`, yielding to the theater's scrim); `tour-boot.js` wires the menu's "Take the tour" and the first-visit auto-open; `tour.css`. The old slides (`TutorialUI.js`, `TutorialContent.js`) stay as "Read the guide". "Interactive tutorial" in `DESIGN_NOTES.md`.
- **`tests/`:** plain Node scripts with no runner.
  - `assert-chord-symbols.mjs` checks the typed field: parity with the site's parser, `barMaterials` against Compose, the resolution, quality pins in Compose, and the ratio form's identity.
  - `assert-drums.mjs` checks the drums against the row and against Partitions' own Euclid.
  - `assert-drum-grid.mjs` (step 4c) checks the drum grid source and presets ⇄ grid; `drums-baseline.mjs` pins the drums from before it (sha256, never edited), so that with no grid they stay byte-identical.
  - `assert-drum-prime.mjs` (step 4c-prime) checks the two-level prime partition: p a seeded prime above N·S, level 2 Partitions' own selection (parity with the site's scripts), the downbeat cell sounding.
  - `assert-trace.mjs` checks that the trace never steers the spec and that every ref is a real onset.
  - `assert-page-animate.mjs` checks the Compose animation: its frames land exactly on the lit nodes, draw only real onsets, stay bounded on the 16k row, and skip and cancel cleanly.
  - `assert-page-*.mjs` check the main page's tab, (`assert-page-lens.mjs`) the Composition lens and (`assert-page-theater.mjs`) its theater. They use `dom-stub.mjs` (a small DOM) and `site-scripts.mjs` (the site's classic scripts in a vm).
  - `assert-store.mjs` checks the composition store and the controller's binding to it.
  - `assert-tutorial.mjs` checks the guided tour (`Tutorial/`): the layer generator, the targets, the opening's time budget, and the driver end to end over the stub.
  - (step 4a) `assert-trace-caps.mjs` checks the trace's caps option and the show cut back; `assert-refactor-identity.mjs` checks that Compose is byte for byte the frozen pre-refactor core (`fixtures/*-before.js`, never edited); `assert-rearrange.mjs` checks chord and lead swaps.
  - (step 4e) `assert-page-matrix.mjs` checks the matrix and the context inspector: 6 × N with the lead spanning phrases, a cell lit on the plot, the alternates, audition → keep and → revert (no redo step), the bar-boundary audition, undo/redo by keyboard, the typed field's inline resolution, the drum steps and presets, the prime strip, the narrow fallback, and the edits in the part strips and the glyph's recall.
  - (step 4d) `assert-store-edits.mjs` checks the store's live edits and pins: swaps, the typed field, undo/redo, the alternates, a re-compose keeping pins and dropping lead edits, the drum grid, the worker path, recall through the glyph, and `against` stable across a swap.
  - (MIDI targets) `assert-target.mjs` checks the decode, the search (brute force, drift, note-ons and note-offs on onsets, the miss classes), Compose's target mode (the lead pinned, every part in the window, the loop, `materialsOf`, the drums and a chord swap on a window) and the 16k row's timing; its clips are `fixtures/midi-clips.mjs`.
  - (Arp mode) `assert-arp.mjs` checks `arrangeArp`: every note a real onset of a chord class inside its step's sub-window, the shape of each pattern, the range, rests, the inner kept off the lead, a chart's split bar, a target's lead refused, Back to Line, and the 16k row's time (target: under 50 ms).
  - (MIDI targets, phase B) `assert-page-target.mjs` checks the Composer window's MIDI clip control: a file chosen and one dropped, decoded and composed; the decode and fit lines; the clip's tempo; the tonic override; the lead row's marks; the placements auditioned, reverted and kept; a window's playhead on the plot; Clear; errors; the glyph's recall; a big row through the worker.
  - `rhythms.mjs` is the shared rhythm set, and `settle-baseline.mjs` pins the output from before settling.
  - `time-lines.mjs` is a timing table, not a check.
- **`probe/`:** the 2026-10-21 cost probe (`FINDINGS.md`), the source of the onset gate.

## Tests

Run every suite (the Composer's, the shared voices', Cosmos's and MIDI Out's):

```bash
for t in Composer/tests/assert-*.mjs Cosmos/tests/assert-*.mjs Audio/tests/assert-*.mjs Playback/MIDIOut.test.mjs; do node "$t" >/dev/null 2>&1 || echo FAIL $t; done
```

A clean run prints nothing. There were 51 suites as of the night of 2026-10-22, with `assert-drums.mjs`, `assert-progression.mjs`, `assert-trace.mjs` and the four `assert-page-*.mjs` added; 55 at the end of that sprint; 57 with sprint 2's `assert-store.mjs` and `assert-page-lens.mjs`; 58 with step 2's `assert-page-theater.mjs`; 59 with step 3's `assert-tutorial.mjs`; 60 with step 4b's `assert-chord-symbols.mjs`; 61 with step 4c's `assert-drum-grid.mjs`; 64 with step 4a's `assert-trace-caps.mjs`, `assert-refactor-identity.mjs` and `assert-rearrange.mjs`; 65 with step 4d's `assert-store-edits.mjs`; 66 with step 4c-prime's `assert-drum-prime.mjs`; one more with the MIDI targets' `assert-target.mjs`, one more with their phase B's `assert-page-target.mjs`, one more with the clean view's `assert-page-detail.mjs` (CLEAN_MIDI_ORDER.md, phase A), and two with MIDI out's `assert-composer-midi.mjs` and `assert-page-midi.mjs` (phase B); one more with the Arp core's `assert-arp.mjs`. Some tests also read chunk-tunes in the Overworld project, read-only, to check the port; without it they skip with a message.

## Where it lives

The branch is `composer-prototype`, cut from `feat/shared-voices`, which holds the shared voice library and Partitions on `Audio/drums`. Neither branch is on `main` yet. The drums were built on `sprint/drums` ("Drums" in `DESIGN_NOTES.md`), and their listening pass is next.
