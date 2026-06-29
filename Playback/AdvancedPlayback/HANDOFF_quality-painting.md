# Advanced Playback — Quality Painting (handoff)

**Branch:** `advanced-playback` (worktree at `LRC_Builds/lrc-adv-playback`, off live `Large-Rhythm-Collider` repo)
**Built:** 2026-06-28, autonomous session while Avery was at a gig.
**Status:** Working + browser-verified. Additive only — does **not** touch `index.html` or the live engine source.

---

## What this is

A new page, `advanced-playback.html`, that takes the existing tone-row playback further: it
partitions one cycle of the serialized tone row into **stages**, paints a **pitch subset (mask)**
onto each stage, and as the scheduler sweeps the cycle the active selection swaps per stage — so a
single polyrhythm's scale becomes a **chord progression**. Every stage is labelled live by the
**Quality** it produces (ported from the Codex master catalog), with microtonal tuning deviation.

Open `advanced-playback.html`, hit **Auto-suggest progression**, **Painting: ON**, **Play**. The
default rhythm 8:7:6:5 yields `Cmaj → Cmaj7 → Em → Csus4 → C7` drawn entirely from its own tuning.

## The recovered context (the "SMPTE/Fable transcript" Avery asked for)

Two old threads, both found:
- **Fable thread** — `~/.claude/projects/-Users-averylogan-Dev-LRC-LRC-Builds-Large-Rhythm-Collider/0ec6889d-2897-45a8-ad65-a4073a08ee6f.jsonl` (June 11–14, 2026). The real source: DAW sync via **MPE over Web MIDI** (not SMPTE) + an **MTS-ESP** bridge; **tuning morph** between rhythm-scales via computed voice-leading with shared interconsonance tones pinned as pivots; **interconsonance-as-modulation-theory**; and the **progressions** idea (chords traced to rhythm sections in the right tuning AND time, morphable in real time). Its written artifact: `Master Scale Registry/avgdev-analysis/CODEX_MATH_FINDINGS.md` (see its Appendix).
- **SMPTE thread** — `.../-Users-averylogan-Dev-LRC/4d00976a-...jsonl` (May 30). Unrelated: about submitting a *paper* to the SMPTE Media Technology Summit. This is why "SMPTE" stuck in memory next to "DAW," but the DAW-control idea was always MPE/MTS-ESP.

## Architecture (all in `Playback/AdvancedPlayback/`)

| File | Role | DOM? |
|---|---|---|
| `QualityCatalog.js` | Ported 54-quality catalog (4 tiers) + set-class helpers | no (node+browser) |
| `QualityMatcher.js` | active ratios → 12-TET pitch-class set → matched qualities w/ tuning deviation | no (node+browser) |
| `PaintTimeline.js` | stage data model; derive equal / by-pulses / by-onsets; split/merge/move | no (node+browser) |
| `PaintEngine.js` | **the integration** — wraps `playNoteAtTime` to swap `selectedNotes` per stage by tick | browser |
| `PaintTimelineUI.js` | timeline strip, per-stage ratio editor, live quality panel, playhead | browser |
| `advanced-playback-main.js` | page controller: boot, drive rhythm, derive, auto-progression, transport | browser |
| `advanced-playback.css` | self-contained dark theme | — |

`advanced-playback.html` loads the live engine scripts (LRCModule, LRCInterconsonance, the Playback
UI deps, AudioEngine, Scheduler, ToneRowPlayback) **unmodified**, then the above.

## The key integration insight (why no engine edits were needed)

The Scheduler calls `playback.playNoteAtTime(noteData, …, absTick)` per note, and at line ~978 it
re-checks `isNoteMutedBySelection(noteData.globalSpacesIndex)` **live**, reading `playback.selectedNotes`.
So Quality Painting = make `selectedNotes` a function of the scheduled tick's phase. `PaintEngine`
monkey-patches `playNoteAtTime`: before delegating, it computes `frac = (absTick % cycleTicks)/cycleTicks`,
finds the stage, and sets `playback.selectedNotes` to that stage's mask Set. The engine's own mute
logic does the rest.

**Gotcha (encoded in PaintEngine):** the engine treats `selectedNotes.size === 0` as "everything
audible." So a deliberately **silent** stage cannot use an empty set — it routes to a sentinel
`SILENCE` set that matches no real fraction, muting every note.

## Verification done (browser, port 8777)

- Boot: 8:7:6:5 → 7 pitches `[1/1,35/32,5/4,21/16,3/2,7/4,15/8]`, grid 840, 5 stages by pulses. Clean console.
- Auto-progression: `Cmaj → Cmaj7 → Em → Csus4 → C7`, masks verified note-correct (15/8→maj7, 7/4→dom7, 21/16→sus4).
- Mask swap: probed `_applyMaskForTick` at each stage fraction — `selectedNotes` swaps correctly; the live `isNoteMutedBySelection` confirms 7/4 muted during Cmaj, 5/4 audible. Disable restores the full scale.
- Live audio: `audioContext.state === 'running'`, 4 oscillators, painting active, selection tracking the playhead's stage in real time.
- Node unit tests on the pure core (major triad→maj exact, min7→m7, 7-limit dom7 flags 7/4 at −31¢, 5-note→exact maj9 on F).

## Type-a-progression solver (DONE — `ProgressionSolver.js`)

Type jazz chord symbols (`Cmaj7 Am7 Dm7 G7`), hit **🎹 Solve & voice**: the solver (ported from Overworld `econ/runtime/progression-optimizer.js`, de-moduled, engine logic verbatim) voices the progression **from the current rhythm's own tone row** — beam-search picks one ratio per pitch class so the cent-intervals best match the chords. One equal section per chord; each chord's solved tones become that section's mask; paint auto-enables; the **Fundamental (Hz) is retuned so chord 1's root = the typed root note** (`root` field, default C3 → 130.81 Hz). Best-partial-fit: if the row has fewer distinct ratios than the progression's pitch classes, a relaxed reuse pass still returns its best attempt, flagged. **Thick voicing** (`Thick` toggle, default ON; `±N¢` window, default 15): each chord tone's mask includes EVERY scale ratio within the consonance window of that tone, not just the best one — so clustered rhythms (e.g. 16:13:11:9 has 192¢+204¢ near the 9th) sound all near-equivalent voicings together (JI chorus). No-op on rhythms without clusters. `solve(text, scale, {windowCents})` → per-chord `fractions` (lean) and `windowFractions` (thick). Per-chord + overall fit % shown; the Quality panel cross-labels what each solved mask actually forms (honest mismatch readout). Pool = current rhythm only (per Avery: the popout rides the general live LRC engine, not the cardinality-sorted Compiler registry). Verified in browser: `Cmaj7 Am7 Dm7 G7` on 8:7:6:5 → masks correct, fundamental → C3, live audio swaps per section.

## Linear Plot timeline (DONE — `LinearPlotTimeline.js`)

The painting surface is now the Linear Plot itself (replaced the abstract stage strip). Canvas: **X = `compositeRhythm[i]/grid`** (true cycle time, so dividers cut where notes actually sound — NOT LRCVisuals' even-by-index X), **Y = ratio cents** (pitch; every instance of a fraction shares a row → chords read as horizontal bands), colour = layer (A#ff6b6b/B#4ecdc4/C#00a638/D#f9ca24), multi-layer coincidence = white ring. Active tones bright, masked-out tones dimmed. DOM overlays: per-section chord labels (click to select), draggable dividers (`moveBoundary`), playhead. Click a node → `toggleInStage(section, fraction)`. Controller feeds nodes via `getNodes()` (inverts `currentSpacesMapping` for index→fraction). PaintTimelineUI now hosts it; the ratio-grid + Quality panels remain below for the selected section. Verified: render, node-toggle on/off, divider drag (0.25→0.15). NOTE: playhead uses rAF which pauses when the tab is hidden — animates fine on a visible screen; don't be alarmed if a headless preview shows it static.

UI restyled to the main Collider HUD palette (black bg, `#00ff88` green accent, translucent dark panels, Segoe UI) — light pass, per Avery "don't go too deep yet."

## Main-page integration (DONE — `ProgressionBar.js` + `progression-bar.css`)

Quality-Painting progressions now run on the MAIN Collider page, not just the popout. A "🎹 Progression Solver" button injected under the Consonance Families section (no engine-HTML edit — injected via DOM after `#interconsonance-families-content`) toggles a compact bar (input + root + Thick + ±¢ + Solve & voice). On solve it runs `ProgressionSolver` against the live rhythm, applies per-section masks to playback via `PaintEngine`, retunes the Fundamental, and draws labeled chord **brackets** in a strip carved above the canvas.

- **Carve**: gated `--canvas-top-margin` (0 normally → inert). `resizeCanvas()` got a 2-line mirror of its existing `--canvas-bottom-margin` handling; `.visualization-canvas { top: var(--canvas-top-margin) }`. This is the ONLY live-engine edit.
- **Brackets align to node-index ranges**: each paint section = a contiguous span of `lrcVisuals.dotPositions` (grouped by `stageIndexAtFraction(compositeRhythm[i]/grid)`); bracket spans min→max dot X. A rAF loop re-lays them so they follow pan/zoom; draggable boundary handles snap to nearest node.
- **Bracket → Scale Selection**: clicking a bracket loads that chord into the live `selectedNotes` and refreshes the main Scale Selection panel + Linear-Plot dimming (`scaleSelectionUI.updateScaleDisplay/updateLinearPlotVisibility`).
- **Mode gating**: `_watchMode()` reconciles on a 250ms poll (idempotent — cheap section-visibility every poll, expensive carve/resize only when the `_carved` flag flips). Feature is gated to `currentPlotType === 'linear'`; any non-linear mode (e.g. Hinges, which has no playback) hides the button + brackets and uncarves; returning to linear restores. (Edge-detection on `_lastMode` was the earlier bug — it desynced mid-transition; reconcile fixed it.)

Verified on the main page: button injects, carve on open, brackets align + drag, bracket-click drives the scale panel, full Linear↔Hinges↔Linear cycle restores correctly. (Canvas needs a real Generate to become `.active`/visible — page behaviour, not the feature.)

## Next steps (in priority order)

1. **Per-slice auto-derive** — "most consonant quality among the nodes actually in THIS time slice" (small variant of QualityMatcher), vs the current whole-scale round-robin.
2. **Deeper Collider-styling pass** if Avery wants it (draggable-panel chrome, fonts, exact HUD borders).
3. ~~**Persist progressions**~~ — DONE: autosave to localStorage + shareable `?prog=` URL (base64 of `{rhythm, mode, progression, rootNote, timeline.toJSON()}`); restores on boot. 🔗 Share link copies the restoring URL.
2. **Richer structural slicing** — currently "by pulses" (one stage per pulse of the smallest layer) and "equal." Add Euclidean-derived boundaries (Bjorklund from `PartitionsDistribution`) and spaces-plot-gap boundaries, per Avery's "let the math speak" ethos. `PaintTimeline.deriveByOnsets()` is ready to receive them.
3. **Per-stage export** — emit a chord chart + per-stage MIDI region (reuse `LRCExport`), so the progression leaves the browser.
4. **Morphing** (Fable's design, deferred this session) — per-voice glide via minimal-total-cents voice-leading between two rhythm-scales; pin shared interconsonance tones as pivots; swap the spaces plot at the cycle boundary while pitches glide. Exact metric modulation when grids share factors.
5. **DAW streaming (MPE over Web MIDI)** — deliberately **skipped tonight** (can't verify end-to-end without Avery's IAC + DAW). Spec lives in `CODEX_MATH_FINDINGS.md` Appendix: channel-per-layer, pitch-bend-before-note-on, portamento → continuous bend. Build behind a flag and verify at the rig.

## Known limits

- Quality matching quantises to nearest 12-TET pitch class, then matches transposition-invariantly.
  Two ratios that round to the same pc collapse (the closer-tuned one represents it). The deviation
  readout surfaces how far the tuning actually sits, but the *structural* match is 12-TET-based.
- Stage boundaries are edited via the data model API (`splitStage`/`mergeWithNext`/`moveBoundary`);
  drag-to-move boundary handles in the strip UI aren't wired yet (next-session polish).
