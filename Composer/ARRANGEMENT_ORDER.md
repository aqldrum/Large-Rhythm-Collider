# Song v0: the layers assemble, on an energy curve (order, 2026-11-04)

Thread 3 of `RELEASE_PLAN.md`, first step. This order makes the Composer play a **song**: a list of sections, each some
passes of the same cycle, that thin, build, peak, break and come home. It works with three tools:
- **which of the row's layers sound**: the polyrhythm assembling itself;
- **which parts play**;
- **the parts' densities**.

Nothing is re-solved: the decomposition, the chords, the lead and the meter are the loop's. Re-decomposition, pulse
modulation (which layer is the beat), the moving downbeat, a key plan, the development walk and call and response are
later steps, recorded in "Later".

Branch `arrange/song-v0`, off `main` (172c144, 85/85).

## The probe (2026-11-04; scratchpad `layer-probe.mjs`, seed 1, default Compose)

A section "on layers M" keeps a note whose onset one of M's layers strikes: `row.owners[note.node] & M`. The table gives
the share of each part kept as the layers enter, in two build orders.

| row | build | lead | chords (bars) | comp | bass | inner | drums |
|---|---|---|---|---|---|---|---|
| 8:7:6:5 (22 onsets, lead 2 notes) | D5 → +C6 → +B7 → +A8 | 50→50→100→100 % | 1/2→2/2 | 0→0→100→100 | 0→33→67→100 | 0→50→100→100 | 6→24→59→100 |
| 8:7:6:5 | A8 → +B7 → +C6 → +D5 | 0→50→50→100 | 1/2→2/2 | 0→100→100→100 | 67→100 | 0→50→100→100 | 53→88→100→100 |
| 11:9:7:5 | D5 first | 0→0→0→100 | 2/2 | 25→25→25→100 | 25→…→100 | 50→50→100→100 | 25→45→65→100 |
| 11:9:7:5 | A11 first | 100 throughout | 2/2 | 100 | 75→…→100 | 0→50→50→100 | 50→70→90→100 |
| 19:17:16:15 | D15 first | 20→40→60→100 | 1/2→2/2 | 0→71→86→100 | 14→43→71→100 | 20→60→60→100 | 3→100→100→100 |
| 119:42:15:8 | D8 first | 11→11→44→100 | 0/4→2/4→4/4 | 7→7→100→100 | 6→12→18→100 | 0→20→20→100 | 2→8→43→100 |
| 119:42:15:8 | A119 first | 56→89→89→100 | 4/4 | 36→100 | 82→88→94→100 | 80→80→100→100 | 70→98→100→100 |
| 768:769 / 768:784 | one layer, then both | 50 / 6–94 | 3–4/4 | 15–92 | 17–83 | 9–91 | 22–78 → 100 |

What it shows:
- **Small rows have very few lead notes** (2–5 a cycle), so filtering the lead or chords by layer leaves holes, or
  silence: 11:9:7:5's lead is entirely on layer A.
- **The drums build cleanly.** Every drum hit is on an onset, with an owner, and the build is real (119:42:15:8 from D8:
  2→8→43→100 %).
- **The order matters.** Fastest-first keeps most of the music. Slowest-first starts near silence, which is dramatic.
- **Two-layer rows give one step.** The densities have to supply the rest of the curve.
- **A subset of layers is a different tone row**: a composite's gaps, and so its tones, change. So sections never
  recompose from fewer layers. They filter the full row's notes.

## Decided (Avery, 2026-11-04: "I'll take all your recs")
1. **The layers filter the rhythm section only.** In a section on layers M:
   - the drums, comp and inner keep the notes on M's onsets;
   - the lead, chords and bass stay whole.

   Re-mining every part from M's onsets (lines.js `allowNodes`) is a later per-section option.
2. **The build order is chosen per row:** the order whose steps are the most even in energy. A template may ask for
   slowest-first (build–drop's intro does).
3. **A section is whole passes of the cycle**, sized to about 15–30 s: 20 s by default, at the seed tempo.
4. **The densities are in v0:** bass Roots…Walking, the comp's tiers, and Line or Arp. They're live arrangement steps
   (ms), and two-layer rows need them for their energy steps.
5. **Two templates:**
   - **Arch**: intro → build → peak → break → peak → home.
   - **Build–drop**: a slow build, all in at once, a break, home.

   Both end **home**: the loop as it plays now (best-ranked material, every part). Sections change at cycle boundaries
   only, with a drum fill in the bar before a peak.
6. **The window:**
   - an arrangement lane above the matrix: sections × parts, plus a row of layer chips, editable with undo;
   - a Song | Loop switch;
   - Song sends MIDI over the same buses, and a part muted in a section sends nothing.

## Proposed (the builder's calls; Avery may overrule)

### The song (core)
- **S1. The record.**
  - `song = { version: 'composer-song-v0', template, seed, order, passesEach, sections, decisions }`.
  - `order`: the build order, active layer indices.
  - Each section is `{ kind, name, passes, layers, parts: { [id]: boolean }, density, fillBefore, energy, target, why }`,
    where:
    - `kind` is one of intro, build, peak, break, drop, home;
    - `name` is "Intro", "Build 1", …;
    - `layers` is a layer mask;
    - `density` is `{ bass?, comp?, lead?, inner? }`, set only where it differs from the loop's;
    - `fillBefore` means the last bar of the section's last pass plays a fill.
  - A song is data: JSON-safe, replayable from (loop spec, template, seed, edits).
- **S2. Energy.** E(section) = Σ over sounding parts of w·u, divided by the home section's sum, so home = 1.
  - **Weights:** drums 0.30, bass 0.15, comp 0.15, lead 0.15, chords 0.15, inner 0.10.
  - **u for a struck part** (drums, bass, comp, lead, inner): its note starts a second, after the layer filter, over
    that part's most across the row's candidates, capped at 1.
  - **u for the chords:** the share of bars with a chord sounding.

  E is a proxy, not taste: it's the only "preference" v0 has.
- **S3. Candidates.** For each section, the planner searches a bounded set:
  - **Layer prefixes** of the order: k = 1…L.
  - **Part masks**, from a fixed list:
    - chords;
    - chords + inner;
    - drums + bass;
    - drums + bass + chords;
    - all but the lead;
    - all but the drums;
    - all.
  - **Three density presets:**
    - **low**: every density one step down from the loop's, e.g. bass Moving → Sparse, comp Sparse–Med → Sparse, Arp →
      Line;
    - **loop**: the loop's own;
    - **high**: one step up, e.g. bass → Walking, comp → Medium, Line stays.

  Only the two non-loop presets cost a re-arrange (arrangeBass ≤ 25 ms, the clave re-ranked by tier, arrangeArp
  20–50 ms on the 16k row), each once a song. Masks and layers are filters.
- **S4. Kinds constrain the search:**
  - **intro**: no lead, at most the first ⌈L/2⌉ layers, density low or loop;
  - **build**: layers non-decreasing from the section before;
  - **peak / drop**: every part, every layer, density high;
  - **break**: no drums, bass off or Roots, every layer;
  - **home**: exactly the loop (every part, every layer, the loop's densities).
- **S5. Templates (targets in home units):**
  - **Arch**: Intro 0.30 · Build 0.60 · Peak 1.15 · Break 0.40 · Peak 1.15 · Home 1.00.
  - **Build–drop**: Intro 0.15 (slowest-first) · Build 0.35 · Build 0.65 · Drop 1.15 · Break 0.35 · Home 1.00.
  - Each section takes the candidate nearest its target within its kind.
  - Neighbour rule: an ordinary boundary (into an intro, a build or a break) changes at most 2 things, where each layer
    step, each part toggled and each density step counts one. A boundary into a peak, a drop or home may change
    anything.
  - Ties break by the seed.
- **S6. The order (ruling 2).**
  - Among the permutations of the active layers (at most 24), take the one whose prefix energies (all parts, loop
    density) are most even: the least variance of the steps. Ties go to fastest-first.
  - Build–drop's intro asks slowest-first.
  - The order is said in the decisions: "layers enter A119, B42, C15, D8: steps of 0.18–0.27".
- **S7. Passes (ruling 3).** passes = clamp(round(20 s / the cycle at the seed tempo), 1, 16), the same for each
  section (`passesEach`). Avery can change a section's passes by hand.
- **S8. The fill (ruling 5).**
  - A section followed by a peak or drop has `fillBefore`: its last pass's drums are arranged with the last bar a fill
    bar.
  - This takes a new drums.js option, `fillBars: [k]`, the bars that play a fill (beat 3 on) and crash the bar after.
  - Unset, the drums are byte for byte today's.
- **S9. The expanded song.**
  - `songPasses(song, loopSpec, materials)` → one entry per pass `{ section, pass, parts, drums }`: the playing parts
    after density, mask and layer filter, and the drums as that pass plays them.
  - It's pure and cached by section.
  - The player's loop reads it by pass index, and the song repeats from the top after home.

### The player
- **S10. Per pass.** `play(spec, getParts, getDrums)`: getParts and getDrums are called with the pass index c (the cycle
  counted from Perform) and return that pass's parts or drums. Called with no argument they work as today, so the lab
  and Cosmos are unchanged. Everything that reads the drums (the duck, the MIDI strokes) reads that pass's.
- **S11. Same cycle.** Every pass has the loop's `cycleSeconds` and tempo, so the tempo map, the clock and the MIDI clock
  carry on unchanged.
- **S12. A held voice into a muted section.** A chain held across a pass boundary is released at the boundary when the
  next pass doesn't sound its part (with its usual release). A part that plays on keeps its chain as today.
- **S13. Where it is.** `passAt(clockTime)` → the pass index sounding now, so the window can show the section.

### The window
- **S14. Song | Loop.**
  - A switch beside the transport, Loop by default.
  - Song plans from the loop as it plays now: the user's edits, densities and drums included, so home is what you
    hear in Loop.
  - The plan is kept until the loop changes. A change marks it stale ("re-plan"), and nothing re-plans on its own.
- **S15. The lane.** Above the matrix:
  - a column per section, its width by passes, named and kind-coloured;
  - a row per part, plus a **Layers** row of A/B/C/D chips;
  - each cell on/off, and a density cell where it differs ("Walking", "Dense", "Arp");
  - the energy line drawn across the top, the target dotted, the playhead on the sounding section;
  - click a cell to toggle it; ±passes; a template select (Arch | Build–drop); Re-plan (a new seed).
  - Every edit is one undo step, kept in the entry's edits and the JSON export.
- **S16. The strips while in Song.** The part strips show the sounding section's on/off, read-only, with "the lane
  decides" in their title. Levels, sounds and legato stay live.
- **S17. MIDI.** Song plays through the same sink: a muted part sends nothing, and a filtered note isn't sent. The MIDI
  clock runs on.

## Phase A: the song (core; one builder, worktree `arrange/form`)
- **A1.** New `Composer/core/form.js` (pure): `planSong`, `songPasses`, `energyOf`, the templates, the order, the
  candidates, the decisions (S1–S7, S9).
- **A2.** `Composer/core/drums.js`: the `fillBars` option (S8), byte for byte unchanged when unset.
- **A3.** `Composer/tests/assert-form.mjs`:
  - determinism by seed;
  - every section within its kind's constraints;
  - the neighbour rule;
  - home equal to the loop byte for byte (parts and drums);
  - the layer filter touching only drums, comp and inner;
  - the order's evenness against a brute force;
  - passes from the cycle;
  - JSON round trip;
  - `fillBars` on and off (`assert-drums.mjs` / drums-baseline hold);
  - cost: `planSong` ≤ 1.5 s on the 16,359-onset row.
- **A4.** DESIGN_NOTES ("Song v0") and the README's module list.

## Phase B: the player (one builder, worktree `arrange/player`; parallel with A)
- **B1.** `Composer/perform/composer-player.js`: S10–S13, the graph untouched.
- **B2.** Tests in the mock context (`assert-lab.mjs`, or a new `assert-song-player.mjs`):
  - a two-section song books each pass's parts and drums;
  - a part muted in pass c+1 releases its chain at the boundary;
  - the duck follows the pass's kicks;
  - MIDI sends only what sounds;
  - no argument = today's booking, byte for byte;
  - `passAt` correct.

## Phase C: the window (after A and B merge; one builder)
- **C1.** `perform/composer-controller.js`:
  - the song state: mode, template, seed, song, stale;
  - `setMode`, `planSong` from the playing spec, the section edits (toggle a part or layer, passes, density),
    `songPasses` cached;
  - getParts(c) / getDrums(c) handed to the player in Song;
  - the edits and the export (S14, S16, S17).
- **C2.** The lane and the switch (S15) in the page: a new `page/arrangement-lane.js` + CSS, wired from
  `composer-tab.js` / the lens.
- **C3.** Page tests (`assert-page-song.mjs`, on `dom-stub.mjs`), the README, DESIGN_NOTES and this order's checklist.

## Browser and rig checklist (for Avery; finished in C3)
1. **119:42:15:8, Song · Arch.** The layers enter in the order the decision names. The intro is the slowest groove,
   building to a peak with Walking bass and denser comp, a drumless break, a second peak, then home exactly as the Loop
   sounds.
2. **A fill** in the last bar before each peak, with a crash on the peak's downbeat.
3. **8:7:6:5, Build–drop.** It opens on D5 alone (the near-silent start), and the drop lands everything at once.
4. **768:784.** Two layers, so most of the curve comes from the densities. Does it still arc?
5. **The lane:** toggle a part in one section, ±passes, undo. Re-plan gives a different song on the same loop.
6. **Edit the loop in Loop** (swap a chord), back to Song: "re-plan" shows, and home follows the edit after Re-plan.
7. **MIDI:** a section with the drums off sends no drum notes, and the clock never stops across sections.
8. **Loop again:** everything as before.

## Later (recorded, not ruled)
- Re-mining parts from a section's layers (`allowNodes`).
- Pulse modulation (which layer is the beat; a new meter).
- The moving downbeat (phase).
- A key plan from the row's ratios.
- The development walk (exposition → walk → recap).
- Call and response across passes.
- Bass walks into a new root.
- AABA, rondo.
- A whole-song MIDI file export.
- Cosmos playing Song or Improvise.

## Log
- 2026-11-04: written (planner) from Avery's "take all your recs". Phases A ∥ B, then C.
- 2026-11-04: **phase B built** (branch `arrange/player`, off `arrange/song-v0`; code and tests d5c3cdc, these docs the commit after). B1:
  `composer-player.js` S10–S13, the graph untouched; B2: `tests/assert-song-player.mjs` (24 checks) and a frozen copy
  of the player at de96a16 (`tests/fixtures/player-before.js`) for the byte-for-byte gate. Suites 86/86 (the 85 and
  the new one). Calls made, all in DESIGN_NOTES "Song v0 (phase B)":
  - the getters are asked once a tick per pass, and also for the next pass in two places: the duck's look past the
    booking (~7 ms, for the next downbeat's kick) and a lone note that crosses its pass's end;
  - a lone note over the boundary is cut there, like a held chain, when the next pass mutes its part;
  - MIDI needs no cut (midiNotesOf ends every note by T);
  - `passAt` is exact from the segment sounding now on; a past time before a dropped tempo segment reads on the
    oldest kept.
  Open questions for Avery: (1) the rule also applies in Loop: a part switched off while its chain holds over the
  loop's end now releases at the loop's end instead of its own (static booking unchanged; Compose's chains end by T,
  so only hand-made or future wrapping specs hear it). Keep, or gate it on a song? (2) S12 says nothing of the
  drums: a cymbal's ring over a boundary into a drumless pass is left as a one-shot.
