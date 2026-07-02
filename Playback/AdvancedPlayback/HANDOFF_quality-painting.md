# Advanced Playback — Quality Painting (handoff)

**Branch:** `advanced-playback` (worktree at `LRC_Builds/lrc-adv-playback`, off live `Large-Rhythm-Collider` repo). **11 commits, local/unpushed.**
**Built:** 2026-06-28 → 06-30 across several sessions with Avery.
**Status: ~95% done, browser-verified.** Inert-by-default on the main page (only one gated 2-line `resizeCanvas` edit + one CSS var touch the live engine; everything else additive).

## TL;DR — what exists
Two surfaces share the same engine modules:
1. **Popout** `advanced-playback.html` — the full lab. Linear-Plot timeline as the painting surface (drag dividers, click nodes), Quality Painting, type-a-progression solver, thick voicings, persistence/share.
2. **Main-page inline** (`ProgressionBar.js`) — "🎹 Progression Solver" button under Consonance Families → compact bar → on Solve, voices a typed progression from the live rhythm, retunes the Fundamental, paints the Linear Plot per-section, and draws **labeled, draggable chord brackets** in a strip carved above the canvas. Gated to linear-plot mode.

**Engine modules** (`Playback/AdvancedPlayback/`, all reused by both surfaces): `QualityCatalog.js`, `QualityMatcher.js`, `ProgressionSolver.js` (ported from Overworld `progression-optimizer.js`), `PaintTimeline.js`, `PaintEngine.js` (monkey-patches `playNoteAtTime`, no engine edits), `LinearPlotTimeline.js` (popout surface), `ProgressionBar.js` (main-page), `advanced-playback-main.js` (popout controller). CSS: `advanced-playback.css`, `progression-bar.css`.

## REMAINING (~5%) — for the next agent
1. **Undo/redo for bracket movements** — boundary drags (single + bookend-group) should be undoable. Suggest an undo stack of `PaintTimeline` boundary snapshots (capture on drag-start in `_onDragMove`/pointerdown, push on pointerup; redo stack cleared on new edit). `PaintTimeline.toJSON()/fromJSON()` already exist for cheap snapshots. Wire Cmd/Ctrl+Z / Shift+Cmd+Z while the bar is open.
2. **Brackets in Wheel + Centrifuge viz modes** (the other two playback-driven modes; Hinges has no playback and stays gated out). Currently `ProgressionBar` gates to `currentPlotType === 'linear'` and positions brackets from `lrcVisuals.dotPositions` (horizontal X). Wheel/Centrifuge are RADIAL — brackets become arcs/sectors, and the carve-strip-above-canvas idea won't map. The next agent needs: (a) how Wheel/Centrifuge expose per-node screen positions (a `dotPositions` equivalent?), (b) Avery's specifics on how the brackets should look there (radial arc labels?). Start by reading `Visualizations/Wheel.js` + `Visualizations/Centrifuge.js` for their node-layout + draw loop. **Avery will provide specifics.**

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
- **Lock + per-section painting** (the live state selector was overriding clicks): on Solve the whole Scale Selection section is locked (`.prog-locked`, pointer-events off + 🔒 badge — updates live, not clickable) until Clear. The plot is driven directly by `_paintPlot()`, which dispatches `spacesPlotVisibilityChanged` with a hidden set computed PER NODE PER SECTION (a node is lit iff its own section's mask contains its fraction) — so the Linear Plot shows the whole progression and re-toggles in realtime as boundaries drag. This is independent of the per-note audio masking (PaintEngine still owns `selectedNotes` for audio). The locked scale chart follows the active section live via `_refreshChart` (stopped → selected bracket drives `selectedNotes`; playing → read-only, tracks the music without fighting audio). Clear unlocks + `selectAllNotes()` restores. Verified: hidden-set = exact per-section count, lock on/off, drag changes hidden-set membership.
- **Mode gating**: `_watchMode()` reconciles on a 250ms poll (idempotent — cheap section-visibility every poll, expensive carve/resize only when the `_carved` flag flips). Feature is gated to `currentPlotType === 'linear'`; any non-linear mode (e.g. Hinges, which has no playback) hides the button + brackets and uncarves; returning to linear restores. (Edge-detection on `_lastMode` was the earlier bug — it desynced mid-transition; reconcile fixed it.)

Verified on the main page: button injects, carve on open, brackets align + drag, bracket-click drives the scale panel, full Linear↔Hinges↔Linear cycle restores correctly. (Canvas needs a real Generate to become `.active`/visible — page behaviour, not the feature.)

## Bracket labels = typed symbols; scroll-preserving lock; live chart highlight (DONE)

- **Labels show what the user TYPED**, not the matcher's re-derivation. QualityMatcher dedupes by set-class (Am7 ≡ C6 under inversion), so the realized analysis would mislabel. Fix: at solve, store `stage.chordSymbol = parsed.chords[i].symbol` and `stage.chordTier` (from an EXACT rooted interval match against the catalog via `_tierForIntervals` — the catalog has both major_6th and minor_7th as distinct entries, so no dedup). Bracket label = `chordSymbol`; tier colour = `chordTier`; hover title = "you typed X — realized as <matcher label>". Labels persist through boundary drags (intent is fixed; only time extent / lit nodes change).
- **Scroll-preserving lock**: `.prog-locked` now sets `pointer-events:none` on `.scale-row` + `[data-scale-action]` only (NOT the container) so the chart still scrolls (scrollable only at >15 pitches) but rows/select-all-none can't override the progression.
- **Live chart highlight** (`_paintChartForSection`): toggles row `.note-selected/.note-deselected` classes directly from the active section's mask — no innerHTML rebuild (scroll preserved), no `selectedNotes` write (audio-safe). Runs every loop tick when locked, so the chart tracks the playhead across sections in time. Replaced the old `_refreshChart`.

## Zoom-aware playhead + multi-bracket group resize (DONE)

- **Playhead tracks cmd-scroll zoom + drag-pan** (`linearView.zoomX/panX`): `_playheadX(f)` interpolates the cycle time between the two *transformed* `dotPositions` that bracket it (same space as the brackets), so it follows the view and the loop hides it (`opacity 0`) when `x` is outside `[0, canvas.clientWidth]` — i.e. offscreen when you've zoomed into another section. (Old code used raw `padding + f*plotWidth`, ignoring the transform.)
- **Shift-click multi-select + proportional group resize**: `multiSelect` Set; shift-click toggles a bracket in. A contiguous selection (`_selectedGroup` → `{a,b}`) shows a `.grp` highlight and turns the group's right-edge handle into a scale handle. Dragging it scales ALL internal boundaries proportionally about the group's fixed left edge (`nf = S + (orig−S)·(E'−S)/(E−S)`) and pushes the next section. Verified: internal proportion preserved (0.5→0.5), group scales, section after pushed.

## Bracket interaction fixes (DONE)

- **Click breakage fixed**: the rAF loop was calling `_renderBrackets()` every frame, destroying the bracket DOM mid-click (click needs down+up on the same element) → shift-click (and clicks generally) silently failed. Now the loop rebuilds only when `_bracketSig()` changes (zoom/pan/canvas-width/boundaries/selection); `_renderBrackets` stamps `_lastSig` at the end. Playhead + chart-highlight still update every frame (separate elements, no rebuild).
- **Bookend-only group dragging**: with a contiguous shift-select group `{a,b}`, internal boundary handles are `disabled`; only the two bookends drag — left bookend (`si=a-1`) scales the group about the fixed right edge, right bookend (`si=b`) about the fixed left edge. Both keep internal proportions and push the adjacent section.
- **Selection illumination** on the bracket header strip (`.sel`/`.grp`: accent fill + label highlight), not on the plot.
- **Reset on new rhythm**: a `rhythmGenerated` listener calls `clear()` (paint off, scale unlocked, brackets gone, plot restored, multiSelect cleared) so a stale voicing never lingers.

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
