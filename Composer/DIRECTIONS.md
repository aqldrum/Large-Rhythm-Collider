# Composer: directions recorded for later (not scheduled)

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
