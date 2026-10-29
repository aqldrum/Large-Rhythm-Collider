# Composer: directions recorded for later (not scheduled)

## NEXT THREAD: arrangement choices and longer forms (Avery, 2026-10-28)

Avery, closing `BASS_VOICING_ORDER.md`: "I think this is about all of the functionality I want for the Composer. The
next step would be for it to make more sophisticated arrangement choices and longer form compositions, mostly by
deciding on different ways to layer parts and toggle them on and off."

**Where things stand.**
- Branch `composer-sprint-2`, worktree `.claude/worktrees/composer-sprint-2`; serve the site from there.
- `BASS_VOICING_ORDER.md` is complete with Amendments 1–3, last merge c198d1e, log 69122c8; 84 suites, all passing.
- Avery's browser and rig pass of that order is still owed. Its checklist is in the order; its Log lists the open
  questions.
- Nothing is on `main`, and nothing is pushed.

**What arrangement can already build on (the seams):**
- **Six parts:** lead, chords, comp, bass, inner, drums.
  - Each has an on/off that plays live (`setPart(id, { enabled })` in `perform/composer-controller.js`; the drums'
    `setDrums({ enabled })`). Today it is for the whole cycle, not per bar or per section.
  - Each has its own MIDI bus or zone (`CLEAN_MIDI_ORDER.md`).
- **Density knobs per part:**
  - bass: Roots, Sparse, Moving, Walking, and Lands on Free, Kick or Clave;
  - comp: tiers Sparse–Med, Sparse, Medium, Dense, plus a tolerance and borrowing;
  - lead and inner: Line or Arp;
  - drums: modes and the step grid;
  - chords: Close or Led.
  - Each is a live arrangement step over a finished spec (`arrangeBass`, `arrangeArp`, `reclave`, `restrum`, `revoice`,
    `arrangeDrums`), byte for byte a Compose given the same overrides, one undo step each.
- **Form:** chord charts already have sections, repeats (`×n`, `|: :|`) and form lines (`form: A A B A+2`), in
  `core/chart.js` and `CHART_ORDER.md`. Phrases come from `phrasesOf`, and each phrase has ranked lead runner-ups (the
  trace).
- **Recorded, not scheduled** (below, "Improvise"): an anchor part with the others walking to their next-best option on
  each loop, possibly degrading over time. It may belong in this thread.

**Questions to put to Avery first**, before writing an order:
1. **The unit of arrangement:** the chart's sections (A, B, …), the phrases, or a new "section" laid over N loops of the
   cycle? And how long is "longer form": several passes of the cycle, or a chart grown from it?
2. **Who decides the layering:**
   - rules (an intro thins to one part, a build adds parts, a breakdown drops the drums), or
   - a scored search over part on/off and density masks per section (contrast between neighbours, a peak, a return), or
   - curated templates (verse/chorus, AABA, build-drop)?
3. **Toggling only, or density too?** For example a verse at bass Sparse and comp Sparse, and a chorus at Moving and
   Medium. Per-section variation of the same material (new runner-ups, the arp on) against literally the same bars?
4. **Transitions:** fills or turnarounds at section ends (a drum fill, a walking bar into the next section), and do parts
   enter on the downbeat only?
5. **The window and MIDI:**
   - How is the arrangement shown: a section × part grid of on/off, an arrangement lane over the matrix?
   - Is it editable by hand like the other choices (live, undo)?
   - MIDI export of the whole form.
6. **Cosmos fit:** does Cosmos Compose play the long form, or stay one cycle?

**Workflow (as every Composer order so far):**
- **The order:** probe the real rows first (the planner's scratchpad), then write an order (`Composer/ARRANGEMENT_ORDER.md`)
  with the probe, Avery's rulings and the builder's proposals marked as overrulable. Avery says "commit and build".
- **The builds:** phases in worktrees under `.claude/worktrees/`, built by agents on Opus (always pass `model: "opus"`).
  The planner reviews, runs the suites and merges `--no-ff` into `composer-sprint-2`. Never `main`, never pushed.
- **The suites, in parallel**, with superrow alone (it can hang under load). The wall-clock budgets in assert-comp,
  assert-claves, assert-compose, assert-rearrange and assert-voicing flake under load, so rerun one alone before calling
  it a failure:
  `ls Composer/tests/assert-*.mjs Cosmos/tests/assert-*.mjs Audio/tests/assert-*.mjs Playback/MIDIOut.test.mjs | grep -v superrow | xargs -P 4 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo FAIL {}'`,
  then `node Composer/tests/assert-superrow.mjs`.
- **Avery does the browser and rig passes.** Don't open a browser: hand him a checklist that names the control, the row,
  and what to hear or see.
- **Avery** is a drummer and theorist. Don't simplify the music theory; do explain audio-protocol jargon.
- **Frozen outputs:** pin them with an override that reproduces the old output, never re-freeze a fixture.

**A prompt to start the thread with:**
> Read `Composer/DIRECTIONS.md` ("NEXT THREAD: arrangement choices and longer forms"), `Composer/README.md` and the
> last sections of `Composer/DESIGN_NOTES.md`, in `.claude/worktrees/composer-sprint-2`. Probe what the current parts,
> densities and chart forms give for arrangement on a few rows (8:7:6:5, 11:9:7:5, 119:42:15:8, 768:784). Then ask me
> the questions in that section, with your recommendation for each, before writing `Composer/ARRANGEMENT_ORDER.md`.

## The Composer as a solver: typed progressions next (Avery, 2026-10-26)

MIDI targets (`TARGET_ORDER.md`) made the Composer solve for a given melody, not only generate one. Avery called it "a good step making the Composer not just generative but a solver as well". The next thread works on **targeting typed progressions**.

**Where typed progressions stand (step 4b):**
- `chord-symbols.js` resolves one symbol a bar against `barMaterials`.
- `barMaterials` fixes the meter, the phase (the seed's first draw) and the cells first, then reads each bar's tones.
- `progression.js` keeps the asked root and quality where the bar supports them (all classes but at most one); otherwise it falls back and says so.

That is the forward direction: cut the row, then ask what each bar can hold.

**The solver direction,** by analogy with MIDI targets: the progression is given, and the meter, the phase and the lattice are the unknowns.

What the MIDI-target probe found that should carry over (`probe/midi-target/FINDINGS.md`):
- **Fit is a property of the row, not of the music.** It depends on in-tune lane density per region of the cycle.
- **Pair and consecutive rows have lanes clustered in time.** Each class sounds only in part of the cycle, so which bar lands where (N, phase) should matter more for chords than it did for melodies.
- **The root splits into a tuning lattice ψ and a transposition k.** The engine's frame must centre on the lattice, not on a root off it. A third of placements lost notes otherwise.

A progression version of the vote:
- each bar's evidence is its chord's classes sounding in that bar's window (bar-length windows, not slot windows);
- vote over (N, φ, ψ, k);
- refine exactly against `chooseChordOnRoot`'s support rule;
- let ψ drift by phrase, which ruling 6 already allows for melodies, as modulation by retune.

`target.js` (lattices, lanes, the vote, the refine, `cropCells`) is the starting point.

**Raised at the MIDI-target browser pass (Avery, 2026-10-26):**
- **Lead over a progression already exists as a full re-solve.** Type the progression, then Compose: re-composing makes the typed chords pins, and the lead is mined over them (`leader: 'progression'`).
  - Live, a typed chord or a chord swap keeps the lead (step 4's decision 1). Avery: "the Compose just has to be fully re-solved after typing the progression."
  - A live "lead follows the changes" switch would re-mine just the affected phrases' lead over the new chords. That's rearrange's machinery, ~12–38 ms a phrase on the 16k row, the mirror of `chordsFollow` on a lead swap.
- **Why harmony follows melody** (DESIGN_NOTES: "Harmony follows melody (leaning, Avery)", Sprint default 4):
  - **The objective.** The line miner (from chunk-lines) is the engine's real search, an exact DP with a full cost (contour, intervals, accents, closure). A chord a bar from a known lead is a cheap, always-answerable ranking of each bar's candidates.
  - **The opposite order** needs a progression before anything sounds. The row offers no objective for choosing one ("searching a tone set for the most parsimonious progression" was the noted fallback), and the frame moves with each chord's root.
  - **Not one-way in practice.** The second pass and the settle rounds mine the lead over the chords too, and a typed progression turns it fully around.
- **A key, not just a home.** The clip's tonic picker renames and re-grounds the harmony but never transposes; `baseHz` normalizes the lead to ~539 Hz.
  - Proposed: anchor `baseHz` to the clip's written MIDI pitches, so a clip sounds in its own key.
  - Then either make the picker a key (it moves the fundamental, so everything transposes together), or keep it as "home" (naming) and add a key control.
  - This ties into how typed symbols are read: relative to C, the base root.
- **Timeline (later):** real-time voice changes without resetting on the loop (mostly legato) and scrubbing. Today an audition plays from the top (ruled).

**Open questions for that thread:**
- Do typed symbols stay relative to C (step 4b's ruling 3), or does a solved progression name its own key?
- Does a solver progression crop to a window, as a clip does (ruling 2)?
- How do a clip and a typed progression combine? They're both pins on the same bars.
- Should a typed progression survive a new clip? (Open from phase B.)

## Improvise: anchors, and the next-best option on each loop (Avery, 2026-10-25)

Any part can become an **anchor** that the system "improvises" around: on successive loops, the other parts change. A background worker solves ahead of playback. Mostly it walks to the next-best option for one or more parts while the music plays, so each loop arrives ready.

**The simplest first version:** the chords are the anchor. Each loop, take the next-best lead and re-fill the inner parts (bass, comping, inner) under the unchanged chords.

Avery wonders whether walking down the ranked options gives **an interesting degradative quality over time**: each loop is a little further from the best fit.

What already supports it:
- the trace keeps the ranked alternates (12 chord candidates per bar, 8 lead runner-ups per phrase, step 4a);
- `rearrange.js` swaps a lead per phrase in ~12–38 ms on the 16k row, re-filling the inner, and keeps the chords fixed (decision 1);
- the player books a loop ahead (`composer-player.js`, lookahead), so the next loop's parts can be swapped in at the loop boundary;
- the store's edits and undo (4d) can record the walk, so a loop you liked can be kept.

Open design questions for when it's built:
- **Which walk:**
  - strictly down the ranked list (the degradation);
  - a random walk among the top k;
  - down and back (a rondo that returns to the best);
  - or "drift", one phrase changing per loop, so the change is gradual.
- **Which part leads:** chords anchored with the lead walking (first), or lead anchored with the chords walking (step 4a's "chords follow"), or the bass.
- **How far:** 8 runner-ups per phrase is a short walk. Raise the caps for an improvise mode, or re-mine with the previous loop's notes excluded to go further.
- **What the listener sees:** the plot's lit nodes shifting loop by loop, and maybe a loop counter or "distance from best" readout.
- **Cosmos:** an ambient, slowly degrading composition at a grid star is a natural fit for the Compose mode there.

## From Avery's browser pass of sprint 2, steps 1–3 (2026-10-25)

- The tutorial works but is rough. Avery will rewrite its text. **The opening at ~10 s is too fast to read the first steps:** give the text more time, so the 10 s target no longer holds.
- **"Show the work" should be a little slower.** Too fast reads as strobe-y and loses its effect.
- **The glyph works.** Another agent will draft a contact sheet of glyph options, and Avery will choose one.
- Theater and cached recall both work as built.
