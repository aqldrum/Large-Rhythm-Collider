# Composer: directions recorded for later (not scheduled)

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
