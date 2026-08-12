# Cosmos audio main-thread campaign (2026-08-12)

Implementable spec for the next optimization arc: **cutting the audio engine's main-thread cost**, the
suspected primary source of continued flight-time hangups. Successor to `COSMOS_PERFORMANCE_CAMPAIGN_2026-08-10.md`
(visual + chord-change-freeze arc) and the audio-smoothness lineage (`AUDIO_CHURN_INVESTIGATION_2026-07-30.md`,
`AUDIO_WORKERS_STREAMING_PLANNING_2026-07-29.md`).

**Origin (Avery, 2026-08-12):** *"We need to look deeper into optimizing specifically our audio engine…
I'm convinced this is the main source of continued main-thread hangups."* Four parallel read-only
investigations (scheduler hot loop · field rebuild · worker boundary · sky/chord/root) confirmed the
instinct and localized the cost to **four centers**, none of which is the compile math (that is correctly
off-thread and cached). This doc is the diagnosis + a 5-batch plan ordered by payoff vs. risk.

**Nothing here is implemented yet.** This is the spec written before touching the engine, by request.

---

## 1. The one caveat that governs all validation (carried forward, still binding)

**The automation/preview browser cannot measure or hear this feature honestly.** From the prior campaign,
unchanged and still true:

1. **AudioContext stays suspended** in the headless browser (synthetic input isn't a trusted gesture), so
   the audio path never runs. Every audio change is validated by **asserting on captured data at the Worker
   boundary / on the compiled program**, never by listening. **The audible pass is Avery's, and it is the
   gate for anything with a musical dimension (Batches 3–5 especially).**
2. **rAF is throttled to ~1 Hz** while frames aren't presented, so frame-*interval* numbers are invalid.
   Trust callback-duration, event-loop lag (a throttle-independent `MessageChannel` ping-pong), Canvas 2D
   op-counts, and captured-data assertions.
3. **Dev-server caching bites the worker.** `python -m http.server` sends no `Cache-Control`; the compile
   worker's import of `cosmos-grid-audio-core.js` has no cache-buster, so a worker can run **stale** code
   after an edit. Hard-reload / clear cache to pick up changes; verify with a `cache:'no-store'` fetch if
   unsure. This is why worker-side changes (Batch 4) must be re-checked against a captured program, not a
   live worker run assumed fresh.

**Live diagnostic already in place:** `window.__cosmosHealth()` (`cosmos-audio.js:1704`) — `throws`,
`byPhase`, `lastError`, `activeStars` (leak tell), `retiringDecks`, `bedOsc`. Read it during any real
session while iterating.

---

## 2. Diagnosis — the four main-thread cost centers

The heavy compile (representative-rhythm selection, tone-row culling, chord masking, action interning,
structured-clone) is **already off the main thread** in the program worker and cached on
`z._rowAudio.program`, reused until the chord's `selectionKey` changes. Only zones whose chord actually
moved recompile. So the per-frame cost is **not** re-selecting representatives — it is the four things below.

| # | Center | Thread / cadence | Cost / scaling | Anchor |
|---|---|---|---|---|
| 1 | **Field rebuild** `updateGridRowField` | rAF — **every frame while translating** | O(Z·owners) eligibility + **2×** O(E log E) sort + per-frame policy alloc | `flight-view.js:1579` |
| 2 | **Scheduler tick** `gridRowPlayer.tick` | main, **40 Hz** | **per-note O(V) field scan** → ~O(N·w·V), super-linear in field density; per-note array churn | `spatial-grid-row-player.js:490` |
| 3 | **Deck-swap + compile** | main, on chord change | up to 20 decks × (`_syncCursor` O(E) + `_seedDeck` O(E·L)); `nextRowLayerGapTicks` per-onset → O(E²)/cycle; **single** compile worker | `spatial-grid-row-player.js:508`, `flight-view.js:201` |
| 4 | **Sky harmony** | main, 40 Hz + ~30 s | `currentHarmonyPolicy()` ~120 allocs/s; `syncBedDegrees` per-star-per-tick; `solveRoots` quadratic ~30 s burst | `cosmos-audio.js:1244`, `sky-root.js:116` |

Z = placed zones, E = eligible zones (≤Z), owners = avg `ratioOwners`/zone, L = layers/event (≤4),
w = events walked per deck per tick, V = live row voices (≤ `MAX_ROW_OSC` = 160), N = active stars (≤20).

### Confirmed NON-issues (do not chase)
- **Chord-walk generation.** The live sky walk is online/single-step: `chooseNextChord` ranks the full
  396-chord vocabulary **once per ~10–30 s boundary**, sub-millisecond (`sky-walk.js:277`). The heavy
  trajectory solver `solveStarSong`/`ProgressionSolver.optimize` in `chord-walk.js` is **parked** — imported
  only by `cosmos/assert-chordwalk.mjs`, never by the flight path.
- **Representative / tone-row / chord-mask selection.** Runs in the worker
  (`cull2-program-worker.js` → `compileGridAudioProgram`), cached on `z._rowAudio.program`, reused until the
  chord moves. NOT redone per frame.
- **Synchronous compile fallback.** None — `requestRowProgram` returns early if `!rowCompiler`
  (`flight-view.js:1499`); `buildGridCull2Readout` runs only inside the worker.
- **Live audio-node counts.** Hard-bounded (see §5 caps table). But see the **stale-cap correction** — the
  bound is 2.5× higher than the prior campaign's memory recorded.

---

## 3. Why the flight case is the acute one

`updateGridRowField` splits into a cheap POSE path (re-aim ≤20 active stars; wanted every frame for smooth
spatial pan/gain) and an expensive MEMBERSHIP path (scan all zones, rank nearest-30, twice). MEMBERSHIP
fires whenever `fieldMembershipDirty` is set. Its hard triggers (`flight-view.js:1582-1592`): chord/root/scale
`selectionKey` change, **`if (translated) markFieldDirty()`**, zone spawn/evict, bed root swap. Soft landings
are coalesced to ≥60 ms (`FIELD_MEMBERSHIP_MIN_INTERVAL_MS`); a safety net bounds staleness at 250 ms.

**The translate trigger is not coalesced.** While flying, every frame is translated → `fieldMembershipDirty`
every frame → the full O(Z·owners) scan + double sort runs **every frame**, on the rAF thread, against the
render loop. The 60 ms landing-coalescing the last campaign added only helps while stationary. That per-frame
membership rebuild — not the worker math — is the "thousands of nearby rhythms" main-thread cost.

---

## 4. The plan — 5 batches, ordered by payoff vs. risk

Each batch is independently shippable and independently validatable. Batches 1–2 are behavior-preserving
(target: "sounds identical"); 3–5 carry a musical/complexity dimension and are Avery-audible-gated.

### Batch 1 — cross-cutting, low-risk, zero intended audible change  *(start here)*

**1a. Memoize `currentHarmonyPolicy()` + selection key.** *[biggest steady-state win — hits centers 1 and 4]*
- Problem: `currentHarmonyPolicy()` (`cosmos-audio.js:872`) builds a fresh frozen policy every call —
  `normalizeCentTargets` = spread + Set + filter + 2 maps + sort + `Object.freeze`. Called ~3×/tick
  (`chordExposure:1174`, `syncBedDegrees:1115`, `ensureLeadMask:822`) **plus** once per rAF frame in
  `updateGridRowField` (`flight-view.js:1580`), which additionally runs `normalizeCentTargets` a **second**
  time via `harmonicSelectionKey → harmonyPolicyDefinitionKey`. ≈120 rebuilds/s + per-frame double-normalize.
- Fix: cache the frozen policy + its selection key inside `cosmos-audio.js`, keyed on
  `(harmonySource, harmonyScale, skyChordId, tolerance)`; re-derive only when that key changes (the same
  points that already move `selectionKey`). Hand callers the stable object. Hoist one policy per
  `schedulerTick` and pass it into `chordExposure`/`syncBedDegrees`/`ensureLeadMask`.
- Win: removes the most consistent GC pressure across both the tick and every rAF frame (incl. pose-only).
- Risk: **low** — policy is already immutable/frozen; identity need only change where the selection key does.
- Validate: assert policy object identity is stable across ticks with unchanged chord; assert the derived
  `selectionKey` string is byte-identical to today's for a set of captured chord/root/scale states.

**1b. Collapse the double `chooseSpatialRows`.** *(center 1)*
- Problem: called at `flight-view.js:1617` (reads `.prewarm`) and `:1626` (reads `.active`). Proven identical
  inputs between the two — the re-read `candidate.ready` (`:1625`) is the same expression as `:1615`, the only
  writes to `_rowAudio.program` are the async `.then` (`:1531`), and `rowActiveIds` is unchanged until `:1627`.
  The second sort + filters are pure dead work.
- Fix: one call; take both `.prewarm` and `.active` from it.
- Win: eliminates one O(E log E) sort + ~5 transient arrays per membership rebuild.
- Risk: **very low** (dead-work removal). Leave a comment noting the invariant (no synchronous program
  landing between the two reads) so a future sync-landing path knows to re-read.
- Validate: assert active/prewarm sets identical to the two-call result across captured candidate fields.

**1c. Cache `audioCompileEligibility` / `maxLayerSum` per zone.** *(center 1)*
- Problem: called for **every placed zone every membership rebuild** (`flight-view.js:1613`); it loops
  `zone.ratioOwners` to recompute `maxLayerSum` (`cosmos-grid-audio-core.js:73`). O(Z·owners), yet the result
  changes only when the zone (re)solves.
- Fix: stamp `{eligible, reason, maxLayerSum}` on the zone; invalidate where `ratioOwners`/`shardsDone` are
  written (same hook that already does `delete z._rowAudio` on re-solve, `flight-view.js:1146`). Fail open
  (recompute if unset).
- Win: rebuild candidate loop drops from O(Z·owners) to O(Z) map-lookups — dominant on dense/large grids.
- Risk: **low-moderate** — correctness rides entirely on the invalidation hook. Pick the single write site.
- Validate: assert cached eligibility equals a fresh `audioCompileEligibility(z)` for a captured zone set,
  including after a simulated re-solve.

**1d. Bump `ROW_COMPILE_WORKERS` 1 → 2.** *(center 3)*  **[Avery ✅]**
- Problem: `flight-view.js:201` → one program worker (`:847`). A chord change serializes up to 30 recompiles
  (`ROW_PREWARM_STARS`) through it, nearest-first; far prewarm stars wait behind the whole queue. The solver
  pool already caps at `hardwareConcurrency-2` (`:841`), so cores are free (6 solver + 1 program on an 8-core).
- Fix: `ROW_COMPILE_WORKERS = 2`. `ProgramWorkerPool._drain` already iterates all slots
  (`program-worker-pool.js:71-79`).
- Win: ~2× faster time-to-full-field re-arm after chords / fast flight.
- Risk: **low** — two landings arriving closer together are absorbed by the 60 ms landing coalescer.
- Validate: assert both workers receive jobs under a burst; confirm `dedup byKey` still returns the shared
  in-flight promise across two workers (keep dedup at the pool level, above worker assignment).

### Batch 2 — scheduler tick, behavior-preserving  *(center 2)*

**2a. Index live voices by tone key.** *[the super-linear kill]*
- Problem: every `_startVoice` → `_claimToneVoice` → `_toneVoiceCandidates` (`spatial-grid-row-player.js:445`)
  scans **every star × every deck × every voice** to gather same-tone incumbents for the
  `CULLED_ROW_MAX_VOICES_PER_TONE = 4` cap — once **per sounding note**. With ~30 notes/tick × 20 stars ×
  V≤160 the scheduling term is ~O(N·w·V), super-linear, peaking exactly when the field is densest. It also
  allocates a `[star.currentDeck, ...retiringDecks]` array **per note** (~600 arrays/tick ≈ 24k/s).
- Fix: maintain a player-level `Map<toneKey, Set<voiceRef>>`, updated on voice add and on every release
  path. `_claimToneVoice` then reads ≤4 incumbents directly.
- Win: scheduling term drops to ~O(N·w·cap); kills the per-note array churn.
- Risk: **low-moderate** — the index must stay consistent across *all four* release sites that already touch
  `logicalVoiceCount`: `onended` (`:610-618`), `_releaseLayer` (`:621-639`), `_destroyDeck` (`:641`),
  `_destroyStar` (`:647`). Add/remove the index entry in exactly those places, guarded by the same
  `voice.released` latch.
- Validate: capture the sequence of claimed/stolen voices for a fixed program + tick schedule with the old
  and new code; assert identical claims, steals, and `budgetMisses`.

**2b. Hoist per-tick allocations.** *(center 2)*
- Problem: `[...this.stars]` spreads the whole star Map every tick (`:492`); each star allocates `keep = []`
  for retiring decks (`:499`); `nearestCulledToneVoices` does `[...candidates].sort().slice()` + `new Set`
  (`:188`) even for the common tiny-c case.
- Fix: iterate `this.stars` directly, collecting ids-to-delete into one reused scratch array (deleting from a
  Map mid-iteration is safe, but collect-then-delete is clearer). Splice retiring decks in place or reuse one
  buffer. Short-circuit `nearestCulledToneVoices` when `candidates.length ≤ cap`.
- Win: removes tens of thousands of short-lived arrays/s → fewer GC pauses → less tick jitter (the very
  jitter `SCHEDULE_AHEAD`'s 250 ms latency is paying to hide).
- Risk: **low**, mechanical. (Largely subsumed by 2a for the per-note arrays; keep the per-tick ones.)
- Validate: same captured-schedule parity as 2a; watch `__cosmosHealth().activeStars` unaffected.

### Batch 3 — the flight structural fix  *(center 1; Avery-audible-gated)*  **[direction ✅]**

**3a. Decouple pose from membership; throttle membership during translate.**
- Problem (see §3): `if (translated) markFieldDirty()` (`flight-view.js:1588`) forces the full O(Z·owners) +
  double-sort membership rebuild **every frame while flying**. Pose (the part you want smooth) is the cheap
  ≤20-star path; membership (the expensive all-zones part) does not need per-frame cadence.
- Fix: keep POSE every frame. Gate the translate-driven MEMBERSHIP recompute behind the same coalescing the
  landing path uses — recompute membership at most every ~60–100 ms during continuous translation (chord/
  root/scale/spawn stay immediate). Optionally trigger early when the nearest-set actually changes (cheap
  nearest-distance check) rather than on a fixed timer.
- Why it's safe musically: hysteresis (`chooseSpatialRows` keeps active-ready stars ahead of fresh),
  the 30-star prewarm lead, and `ROW_SWITCH_TICKS = 16` deck-swap quantization all absorb 60–100 ms of
  membership lag. Stars entering/leaving the field is the audible dimension.
- Win: the every-frame rebuild collapses from ~60/s to ~10–16/s during flight; each one is also cheaper
  after Batch 1. This is the largest single reduction for the flight case.
- Risk: **medium** (musical). Star-swap timing shifts slightly; must be heard.
- Validate: assert the active set converges to the same membership the per-frame version reaches within one
  throttle interval for a scripted flight path; **Avery flight audible pass** — listen for late/early star
  entrances and any audible hole (there should be none; old program sustains until replacement lands).

### Batch 4 — deck-swap / compile architecture  *(center 3; Avery-audible-gated)*  **[Avery ✅ "fix 2"]**

**4a. Precompute the deck-swap / gap tables in the worker.**
- Problem: per-program structural work was deferred to deck swap in the main-thread `tick()`:
  `_syncCursor` = O(E) `findIndex` (`:393`), `_seedDeck` = O(E·L) two passes (`:413-418`), and in the hot
  loop `nextRowLayerGapTicks` forward-scans events **per onset** (`:93-108`, called `:542`) → up to O(E²)
  per cycle. On a chord change up to ~20 decks swap in one tick — a main-thread spike scaling to E = 20000.
  (The last campaign's interning fixed the *deserialization* string explosion; it did **not** touch this.)
- Fix: emit, once in the worker inside `compactGridAudioProgram` (`cosmos-grid-audio-core.js:118`): a
  per-layer next-onset gap table and the loop-tail seed state, so the player reads them instead of
  re-deriving. `_seedDeck`/`nextRowLayerGapTicks` become table lookups; `_syncCursor` can binary-search or
  read a precomputed cycle offset.
- Pairing: best done with a **transferable typed-array event payload** (flat `Int32Array` ticks + a packed
  layer/action-index table, posted with a transfer list) so the added tables don't re-inflate structured-clone
  cost — today both directions are pure clone, no transferables (`cull2-program-worker.js:8`). Interning
  already absorbed the string cost, so the typed payload targets the ~20000 event wrappers.
- Win: eliminates up to ~20 × (E + E·L) main-thread iterations per chord-change swap wave, plus the
  per-onset scan in the 40 Hz loop; the transfer makes receipt near-zero-copy.
- Risk: **medium** — repeat-cull seed semantics are subtle (`spatial-grid-row-player.js:397-419`, the
  loop-wrap `lastToneByLayer.clear()` at `:549`); the streamed-window-vs-full-compile equivalence the test
  harness relies on must be preserved. Do 4a's table precompute first; add the typed payload only if residual
  clone still stalls dense grids.
- Validate: assert the new program's tables reproduce the exact `_seedDeck`/`nextRowLayerGapTicks` outputs
  for captured programs across grids incl. `[4096,11,3]`-class density; run the existing
  streamed-window/full-compile equivalence check; **Avery audible pass** on chord changes over a dense field.

### Batch 5 — periodic burst + steady-state hygiene  *(center 4)*

**5a. `solveRoots` per-solve pool precompute.** *(zero behavior change)*
- Problem: `solveRoots` (`sky-root.js:116`, called `flight-view.js:2150-2152`) gathers **all** zones within
  `ROOT_RADIUS = 1400` (not `AUDIBLE_N`-capped) and is ~O(Z²·card²·targets) — quadratic in in-radius zone
  count. Gated to ≤once/29.7 s and only while settled, so it's a **periodic ~30 s hitch** in dense regions,
  not a continuous drag. `scoreRootAt` re-folds each star's pool per candidate.
- Fix: precompute each star's folded pool **once** per solve; reuse across all candidates. Pure speed, no
  musical change. (Deferred alternatives, higher risk: cap `rootField` to nearest-K — changes root choice;
  move the solve to a worker — more plumbing.)
- Win: removes the re-fold factor from the one density-sensitive sky burst.
- Risk: **low** (behavior-identical). Validate: assert chosen root ladder byte-identical to today's across
  captured fields.

**5b. Gate `syncBedDegrees` bed recompute.** *(center 4)*
- Problem: `syncBedDegrees` (`cosmos-audio.js:1114`) rebuilds a policy clone + runs 12 `ownerHarmonyMatch`
  **per bed star per tick**, even on fully stable frames (~5k matches/s). The `chordChanged` guard (`:1117`)
  only gates re-swelling continuing voices, not the `desired`-set recompute.
- Fix: cache each star's `desired` set; recompute only when `chordChanged`, the root key changed, or that
  star's `pool` changed (add a pool version stamp; `setField` already re-folds pools on root-key change).
- Win: steady-state `syncBedDegrees` drops from ~120 matches/tick to ≈0 while cruising a settled region.
- Risk: **low-medium** — must invalidate on pool/root swap or a voice holds a stale degree set for a frame.
- Validate: assert the `desired` set equals a fresh compute after chord/root/pool changes; audible bed check.

---

## 5. Reference — constants & anchors

**Caps (with the stale-cap correction).**

| Cap | Value | Constant | Enforced |
|---|---|---|---|
| Active row stars | 20 | `ROW_ACTIVE_STARS` (`cosmos-grid-audio-core.js:19`) | `chooseSpatialRows` (`:91`) |
| Prewarm row stars | 30 | `ROW_PREWARM_STARS` (`:20`) | `chooseSpatialRows` |
| **Row voices (global)** | **160** | `MAX_ROW_OSC = ROW_ACTIVE_STARS*4*2` (`spatial-grid-row-player.js:28`) | `:560` |
| Row voices / tone | 4 | `CULLED_ROW_MAX_VOICES_PER_TONE` (`cosmos-grid-audio-core.js:31`) | `_claimToneVoice` (`:466`) |
| Lead voices | 48 | `MAX_LIVE_OSC` (`cosmos-audio.js:31`) | `:1769` |
| Bed logical / live osc | 30 / 90 | `MAX_BED_OSC` / `*3` (`cosmos-audio.js:94,102`) | `:1050` |
| Compile workers | 1 → **2** | `ROW_COMPILE_WORKERS` (`flight-view.js:201`) | Batch 1d |
| Bed audible set | 10 (+4 margin) | `AUDIBLE_N`/`AUDIBLE_MARGIN` (`flight-view.js:168-170`) | `:2190` |

> **STALE-CAP CORRECTION for the memory / prior campaign.** `COSMOS_PERFORMANCE_CAMPAIGN_2026-08-10.md` §5
> records the row GATE as "≤64" and uses it to rule oscillators out of the 2.1 GB audio-death. That number is
> **stale — it is 160 now** (`MAX_ROW_OSC` is derived from `ROW_ACTIVE_STARS`, which grew 8→20; the code
> comment at `spatial-grid-row-player.js:26-28` still says "the 64 it replaces"). The row voice ceiling is
> 2.5× higher than that analysis assumed, so the "can't be the 2.1 GB" conclusion should be re-examined
> alongside this campaign. (Memory `cosmos-perf-profile` to be updated.)

**Cadence:** `TRANSPORT_TICK_MS = 25` (40 Hz), `SCHEDULE_AHEAD_SECONDS = 0.25` (`transport-clock.js:14,23`);
worker pulse → `onTick` runs `schedulerTick` **on the main thread** (`transport-clock.js:49`,
`cosmos-audio.js:1719`). Chord boundary ~10–30 s (`CHORD_SECONDS = 25.6`, `flight-view.js:219`).
Field coalescing 60 ms / 250 ms (`FIELD_MEMBERSHIP_MIN/MAX_INTERVAL_MS`, `flight-view.js:1568,1574`).

**Key anchors:** field rebuild `flight-view.js:1579` (triggers `:1582-1594`, double-sort `:1617/:1626`,
eligibility `:1613`); scheduler `cosmos-audio.js:1719` → `gridRowPlayer.tick` `spatial-grid-row-player.js:490`
(hot scan `_toneVoiceCandidates:445`, deck walk `_scheduleDeck:508`, voice start `_startVoice:553`,
release sites `:610/:621/:641/:647`); worker pool `program-worker-pool.js` (dedup `:40`, drain `:71`,
cancel `:52`); compact/intern `cosmos-grid-audio-core.js:102-149`; sky `cosmos-audio.js:1244` /
`syncBedDegrees:1114` / `chordExposure:1173`; root `sky-root.js:116`, `flight-view.js:2140-2152`;
policy `cosmos-audio.js:872`, `harmony-policy.js:30`.

**Test guards to extend (headless-safe):** `cosmos/assert-grid-spatial-audio.mjs`,
`cosmos/assert-transport-clock.mjs`, `cosmos/assert-chord-clock.mjs`, `cosmos/assert-sky-modulation.mjs`,
`cosmos/assert-cull2-audio.mjs`. Batch-specific captured-parity assertions belong here.

---

## 6. Sequencing & exit

1. **Batch 1** (safe, cross-cutting; hits centers 1 & 4; sounds identical) — bank relief first.
2. **Batch 2** (scheduler super-linear → linear; sounds identical).
3. **Batch 3** (flight structural; Avery-audible-gated) — largest single flight-case win.
4. **Batch 4** (deck-swap/compile architecture; Avery-audible-gated) — highest complexity, last of the heavy work.
5. **Batch 5** (periodic burst + hygiene) — finish.

Each batch: land behind its captured-data assertions, then Avery's audible pass where the batch has a musical
dimension. Re-read `window.__cosmosHealth()` live after Batches 2–4 (`activeStars` must not climb; `throws`
must stay 0). Update memory `cosmos-perf-profile` with the four-center map + the stale-cap correction on
completion of Batch 1.

---

## 7. Addendum — per-rhythm onset prohibition (landed 2026-08-12, Avery-requested)

Interleaved between Batch 1 and Batch 2. Attacks cost center 3 (and 2) at the source: onset count `E` is the
term driving the per-tick walk, deck-swap seed `O(E·L)`, and `nextRowLayerGapTicks` `O(E²)/cycle`, so
dropping over-dense rhythms before they enter the composite is cheaper than optimizing the walk over them.

- **New cap:** `ROW_MAX_PLAYBACK_ONSETS = 16384` (`cosmos-grid-audio-core.js`), **distinct from** the
  zone-level OOM gate `ROW_MAX_COMPOSITE_ONSETS = 20000`. Chosen by Avery (2048 judged "very low").
- **Scope = per-rhythm, not per-zone.** A representative rhythm whose `layerSum` exceeds the cap is filtered
  out of `compiledRhythms` in `buildGridCull2Readout` **before** `buildCull2Readout` runs — so it costs
  neither worker compile nor a place in `events[]`. A zone keeps sounding its lighter rhythms; it goes silent
  only if *all* its rhythms are over-dense. Catalog `selected` now requires rhythm survival, so
  `selectedTones`/`selectedFractions` stay honest (a dropped rhythm's tone can't report selected).
- **Scene-only.** Applied on the flight compile path (`compileGridAudioProgram` → `buildGridCull2Readout`,
  option `maxPlaybackOnsets`). The lab/rhythm-card path (`cull2-grid-worker.js`) calls `buildGridCull2Readout`
  with no cap (default `Infinity`), so deliberate card inspection of a dense rhythm is unaffected.
- **Fail-open:** a missing `layerSum` reads as 0 → kept (matches the eligibility gate's philosophy).
- **Validation:** new assertions in `assert-cull2-audio.mjs` (grid 840, cap 60 → 5 rhythms dropped, composite
  shrinks, catalog consistent, uncapped/`Infinity` path byte-unchanged). Behavior IS audible (dense rhythms
  go silent) → Avery-audible-gated. Note `E` is a proxy; effective heaviness also tracks onset *rate*
  (`E·ticksPerSec/grid`) — revisit if a lower cap is wanted for fast-playing mid-density zones.
