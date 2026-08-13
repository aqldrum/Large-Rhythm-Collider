# Cosmos audio main-thread — handoff (2026-08-13)

As-built state of the audio main-thread optimization campaign. **The plan lives in
`COSMOS_AUDIO_MAINTHREAD_CAMPAIGN_2026-08-12.md`** (diagnosis of the four cost centers, the 5-batch plan with
file:line/risk/validation per batch, the constants/anchors reference, and §7 the rhythm-card onset addendum).
Read that first; this doc records what shipped and where to pick up.

**Origin:** Avery — *"the audio issues are the real thing… main source of continued main-thread hangups."*
Four parallel investigations localized the cost to four centers; the heavy compile is already off-thread and
cached, so it's ruled out. **Outcome so far (Avery, 2026-08-13):** *"convinced we've made progress"* — Batches
1–3 + the onset cap + the rhythm-card plot fixes landed; **Batch 4 is still needed** and is the top item here.

---

## 1. What landed (this campaign)

| Commit | What | State |
|---|---|---|
| `3cc91ae` | Campaign spec | — |
| `b410977` | **Batch 1** — memoize `currentHarmonyPolicy` + `harmonyPolicyDefinitionKey`; collapse the double `chooseSpatialRows`; cache `audioCompileEligibility` per zone; `ROW_COMPILE_WORKERS` 1→2 | ✅ guards; Avery: "generally smoother" |
| `31c3970` | **Batch 2** — index live voices by tone (`Map<toneKey, Map<voice,deck>>`, kills the per-note O(V) scan); hoist per-tick allocations | ✅ guards; audible pass owed |
| `a01092e` → `c399853` | **Per-rhythm onset cap** — landed flight-scoped, then **re-scoped to the rhythm CARD** (see §3). `ROW_MAX_PLAYBACK_ONSETS = 16384` | ✅ compile guards; card click-test owed |
| `d166582` | **Batch 3** — flight translation is now a SOFT/coalesced membership trigger, not an every-frame full rebuild (60 ms cadence; pose stays per-frame) | ✅ guards; audible pass owed |
| `a0dbd7c` | **Rhythm-card plot fixes** — clear stale plot on a null (too-dense) model; skip drawing heavily-repeated tones so the plot rebuild is bounded, not O(all onsets) | ✅ guards; card interaction pass owed |

`d086d51` / `9cb565e` (rhythm-card lead-legato + Speed-sync) are **Avery's own** interleaved feature work, not
this campaign.

**Standing guard suite: 19 pass, 1 fail** — the 1 is a **pre-existing stale source-regex** in
`assert-transport-clock.mjs` (commit `f5ff905`'s `guardPhase(...)` wrapping broke a text match), unrelated to
any campaign work. Fix chip filed. Everything else is green, including the campaign's new/updated guards
(`assert-harmony-policy-memo.mjs`, `assert-grid-spatial-audio.mjs` index-consistency).

---

## 2. Verification still owed (Avery, live session)

Headless can't run the audio path (AudioContext suspended) or exercise DOM-bound cockpit code, so these are
Avery's:

- **Batch 2** — behavior-preserving; "sounds identical."
- **Batch 3** — fly a dense field; star entrances/exits may shift ≤60 ms; listen for any audible hole (there
  should be none — old programs sustain) or late swap.
- **Onset card gate** — click a very dense rhythm: "too dense to audition" card, LISTEN disabled, no freeze; a
  normal rhythm still auditions.
- **Card plot fixes** — a too-dense card shows an EMPTY plot (not a stale one); a dense card open over several
  chord changes no longer periodically hitches.

**Always hard-reload / clear cache before testing** — the dev server heuristic-caches module imports (the
compile worker imports `cosmos-grid-audio-core.js` with no cache-buster), so edits can run stale otherwise.
This is the campaign's standing gotcha.

---

## 3. The onset cap — read this so you don't re-invert it

**Scope: rhythm-card audition ONLY, never the flight scene.** A first pass (`a01092e`) wrongly filtered dense
representatives out of the flight compile; `c399853` reverted that. The flight scene must KEEP a
`>ROW_MAX_PLAYBACK_ONSETS`-onset rhythm as a folded-ratio representative (dropping it loses a tone), and its
cost is bounded incrementally (lookahead horizon + `MAX_ROW_OSC`), unlike the card's one-shot O(onsets) build.

The freeze was the **card** path: clicking a rhythm builds `deriveSelectedRhythmModel` (O(onset load)) for the
inspector AND `deriveVoice` (O(onsets)) to audition, synchronously. Gate is at `modelForRhythmNode`
(`flight-view.js`) on a cheap `layerSum = Σ node.layers` → returns `null` above the cap; the inspector shows a
"too dense" card, `setRhythmAudition` refuses, LISTEN disables. **Verified there is no bypass** — every model
build / onset walk goes through the gated `modelForRhythmNode` or a null-guarded `rhythmInspectorModel`.

The rhythm-card plot (`drawCockpitPlot`) re-rasterizes every onset node on each chord/root change (its cache
key includes the harmony), so a below-threshold card sitting open re-paid O(onsets) canvas draws on every
boundary — even when harmony-silent. `a0dbd7c` bounds that by skipping draws for heavily-repeated tones.

---

## 4. NEXT UP — Batch 4 (worker-side deck-swap / gap tables)

The last audible-gated chunk and the **most likely remaining chord-change freeze** — Avery still sees hitches
on chord changes, and with a card open the (now-bounded) plot rebuild used to stack on top; the scene half is
Batch 4. Full spec in `COSMOS_AUDIO_MAINTHREAD_CAMPAIGN_2026-08-12.md` §4 "Batch 4". Summary:

**Problem.** Per-program structural work is deferred to the main-thread deck swap in `gridRowPlayer.tick`:
`_syncCursor` = O(E) `findIndex` (`spatial-grid-row-player.js:~393`), `_seedDeck` = O(E·L) two passes
(`:~413`), and in the hot loop `nextRowLayerGapTicks` forward-scans events **per onset** (`:~93`, called
`:~542`) → up to O(E²)/cycle at high grids (E up to `ROW_MAX_COMPOSITE_ONSETS = 20000`). On a chord change up
to ~20 decks swap in one tick — a main-thread spike scaling to 20000. (Batch 1's interning fixed the
*deserialization* string explosion; it did NOT touch this.)

**Fix.** Emit, once in the worker inside `compactGridAudioProgram` (`cosmos-grid-audio-core.js:~118`): a
per-layer next-onset gap table + the loop-tail seed state, so the player reads them instead of re-deriving.
`_seedDeck`/`nextRowLayerGapTicks` become table lookups; `_syncCursor` reads a precomputed cycle offset (or
binary-searches). Pair with a **transferable typed-array event payload** only if the added tables re-inflate
structured-clone cost — today both directions are pure clone, no transferables (`cull2-program-worker.js:8`);
interning already absorbed the string cost, so a typed payload targets the ~20000 event wrappers.

**Risk (medium).** Repeat-cull seed semantics are subtle (`spatial-grid-row-player.js:~397-419`, the loop-wrap
`lastToneByLayer.clear()` at `:~549`); preserve the streamed-window-vs-full-compile equivalence the test
harness relies on. Do the table precompute FIRST; add the typed payload only if dense grids still stall.

**Validation.** Assert the new program's tables reproduce the exact `_seedDeck`/`nextRowLayerGapTicks` outputs
for captured programs across grids incl. `[4096,11,3]`-class density; run the streamed-window/full-compile
equivalence check; **Avery audible pass** on chord changes over a dense field. Watch `window.__cosmosHealth()`
(`activeStars` must not climb; `throws` stays 0).

---

## 5. After Batch 4 — Batch 5 (periodic burst + hygiene, behavior-preserving)

Spec §4 "Batch 5". Lower priority; no musical change.
- **`solveRoots` per-solve pool precompute** — precompute each star's folded pool once per solve, reuse across
  candidates (`sky-root.js:~116`, called from `flight-view.js` loop). Removes the re-fold factor from the one
  density-sensitive sky burst (~O(Z²·card²·targets), gated ≤once/29.7 s + settled). Assert root ladder
  byte-identical.
- **Gate `syncBedDegrees` bed recompute** (`cosmos-audio.js:~1114`) on `chordChanged`/root-key/pool-version —
  it currently reruns 12 harmony matches per bed star per tick even on stable frames.

---

## 6. Working notes for the next thread

- **Line numbers drift.** This campaign added code to `flight-view.js` / `cosmos-audio.js` / `spatial-grid-row-player.js`;
  the spec's `:NNN` anchors are approximate now. Grep the function name, not the line.
- **What's headless-testable vs not.** Pure modules (`cosmos-grid-audio-core.js`, `cull2-grid-core.js`,
  `harmony-policy.js`, `spatial-grid-row-player.js`, `chooseSpatialRows`, the compile) have node guards in
  `cosmos/cosmos/assert-*.mjs` — Batch 4 belongs here (captured-program parity). The membership coalescing,
  the card gate, and the plot live in DOM-bound `flight-view.js` — not headless-importable, Avery-gated.
- **Memory:** `cosmos-perf-profile` carries the four-center map, the **stale-cap correction** (`MAX_ROW_OSC` is
  **160**, not the 08-10 campaign's "≤64" — reopens its "oscillators can't be the 2.1 GB" conclusion), and the
  batch ledger.
- **The 2.1 GB / audio-death memory leak** (from `COSMOS_PERFORMANCE_CAMPAIGN_2026-08-10.md` §5) is still open
  and orthogonal to this campaign, now with the corrected 160-voice ceiling to factor in.

---

## 7. Anchors (grep the names — lines drift)

Field rebuild + coalescing: `flight-view.js` `updateGridRowField` / `markFieldDirty` / `markSoftMembershipDirty`
/ `fieldSoftDirty`. Scheduler: `cosmos-audio.js` `schedulerTick` → `spatial-grid-row-player.js`
`gridRowPlayer.tick` (`_toneVoiceCandidates`, `_indexAddVoice`/`_indexRemoveVoice`, `_scheduleDeck`,
`_startVoice`, `_seedDeck`, `_syncCursor`, `nextRowLayerGapTicks`). Worker boundary:
`program-worker-pool.js`, `cosmos/cull2-program-worker.js`, `compactGridAudioProgram` /
`buildGridCull2Readout`. Card: `flight-view.js` `modelForRhythmNode` / `renderRhythmInspector` /
`setRhythmAudition` / `drawCockpitPlot`; `rhythm-inspector-model.js`; `oracle-core.js` `deriveSelectedRhythmModel`.
Policy: `cosmos-audio.js` `currentHarmonyPolicy`; `harmony-policy.js`. Constants:
`cosmos-grid-audio-core.js` (`ROW_ACTIVE_STARS=20`, `ROW_PREWARM_STARS=30`, `ROW_MAX_COMPOSITE_ONSETS=20000`,
`ROW_MAX_PLAYBACK_ONSETS=16384`, `CULLED_ROW_MAX_VOICES_PER_TONE=4`); `MAX_ROW_OSC=160`
(`spatial-grid-row-player.js`).
