# A clean view, and MIDI out per part (order, 2026-10-27)

Two pieces of work, in this order, to make the Composer a tool rather than a lab:

- **Phase A, a clean view.** The window shows a lot of detail that's hard to read at a glance: readouts, "chose X"
  beside every knob, the decisions, the clip's decode and fit lines, lattices, cents and Hz. Most of it moves behind one
  Details toggle. Nothing about what Compose does changes.
- **Phase B, MIDI out per part.** Today the Composer has no MIDI out at all (DESIGN_NOTES: "there's no MIDI out"). The
  site's MIDI out (`Playback/MIDIOut.js`) streams the tone rows over one bus. The Composer sends each part on its own
  bus (decided), so each part is its own track in a DAW, in exact just intonation.

Phase A comes first because Phase B adds controls (a MIDI button, a bus picker per part, the clock) to a window that
already has too many. The clean view decides where they go.

Integration branch: `composer-sprint-2`. Phases branch from it as `clean/<phase>` and `midi/<phase>`, each in its own
worktree under `.claude/worktrees/`. The planner reviews each phase, runs the suites and merges it. Never `main`, never
pushed. Verification is the Node suites. Avery does the browser pass and the rig pass (IAC + Ableton).

## Decided (Avery, 2026-10-27)

1. **A bus per part.** Each part goes out on its own IAC bus, and the chords arrive as chords, not as one voice per
   channel. (Ruled out: one bus with a channel per chord voice, and building both as presets.)

   | Bus | Part | Channels |
   |---|---|---|
   | Composer Lead | lead | 1 |
   | Composer Chords | chords | an MPE zone: channel 1 the master, the voices on 2–5 |
   | Composer Comp | comping | 1 |
   | Composer Bass | bass | 1 |
   | Composer Inner | inner | 1 |
   | Composer Drums | drums | 10 (the General MIDI drum channel) |

   - **Why the chords need a zone.** MIDI tunes a note with pitch bend, and a bend applies to a whole channel. Only the
     chords part sounds several notes at once (a voice per chord class, root first, at most 4). The other five parts
     play one note at a time, so one channel each keeps every note exactly in tune. *MPE* (MIDI Polyphonic Expression)
     is the standard for one instrument spread over several channels, one note per channel, each with its own bend.
   - **In Ableton:** six tracks, each *MIDI From: its bus, All Channels*, with MPE on for the chords track (Live 11 and
     later, and Omnisphere, read it). The chords track is one polyphonic instrument in exact tuning.
   - **Setup, once:** Audio MIDI Setup → Window → Show MIDI Studio → IAC Driver → add the six buses with +. The browser
     sees each bus as its own output.
2. **Ableton follows the Composer's tempo, at first.** The Composer sends *MIDI clock* (24 ticks a beat, plus Start and
   Stop) and Ableton syncs to it (Preferences → Link/Tempo/MIDI → that bus's *Sync* on). The DAW runs at the Composer's
   tempo (107.3 BPM and all), follows a live tempo change, and starts on bar 1 when Perform starts. The ticks are
   scheduled ahead with their own timestamps, like the notes. "At first": the other direction (the Composer following
   the DAW's clock) may come later. Not built now.
3. **A new note for each note; the synth does the glide.** Every note is its own note-on and note-off, with its own
   bend before it. The Composer never bends a held note to the next pitch.
4. **The page's legato changes nothing in the MIDI.** The legato toggle and Glide shape only the browser's own voices.
   The MIDI for a part is the same with legato on or off (M12 gives the note lengths).

## Proposed: Phase A, the clean view (the builder's calls; Avery may overrule)

- **C1. One Details toggle** in the header, beside "show the work". Off by default, remembered in localStorage (as show
  the work is). Off is the clean view; on is the window as it is today. The lab (`Composer/lab/`) is unchanged and keeps
  showing everything.
- **C2. A viewing flag only.** It never changes a compose, a spec or what plays. `readouts.js` keeps returning the same
  data. Hidden surfaces get a class (`ctab-detail`), and CSS hides them unless the window has `ctab-details-on`, so the
  toggle redraws nothing.
- **C3. Hidden settings still apply.** A knob that only shows in Details keeps its value. When one is set off auto, the
  Details toggle carries a dot ("settings hidden: Settle passes 2"), so a hidden setting can't go unnoticed.
- **C4. The rule for what stays visible:** names over numbers (chord names, part names, bars), anything you can act on,
  and a warning that needs a response (refusal, "changed — Compose again", a fallback chord's amber). Explanations go to
  hover titles. Numbers (Hz, cents, ratios, lanes, onsets, ms) go to Details.

**C5. The surface map:**

| Surface | Clean view | Details adds |
|---|---|---|
| Header, row 1 | rhythm · cycle, Seed, Compose / Perform, ↶ ↷ (icons; the words in titles), Details, show the work, status | JSON |
| Header, row 2 | Tempo and reset, Glide | — |
| Readouts line | one short line: "8 bars × 6 · 110 BPM" | the full line (root, baseHz, onsets, tones, table, composed in, chords, clip, progression, drums) |
| Refusal | the sentence, as now | — |
| What Compose dropped | one line: "Compose dropped 3 edits" (the list in its title) | the list |
| MIDI clip | MIDI clip, Choose, Tonic, Clear, and one line: "name · 14/16 notes fit" | the decode line, the fit line, each placement's detail |
| Placements | the chips (label and where), Keep, Revert | each chip's detail |
| Animation caption | as now (show the work has its own toggle) | — |
| Matrix | part names, on/off, bar numbers, chord names, the playhead, ✎ edited, split-bar rules | the alternates count (clean: a small dot), the modulation text (clean: a ↻ glyph with a title), "↻ retunes bars 3–5" |
| Typed field | the field, and the strip's chord names coloured by status | each chord's detail text, the field notes |
| Decisions | not shown | the table, as now |
| Inspector header | as now | — |
| Knobs | Bars, Slots / bar, Modulation, each with its value | "chose X" / "asked: X" beside every knob; the rows Settle passes, Root presence, Anchors, Frame ±¢, Table |
| Progression editor | the root selects, Take, Clear | each bar's "got" text, the progression note |
| Cell: chords | the 12 candidates by name, playable; Keep, Revert | their scores |
| Cell: lead | the runner-ups, playable; Keep, Revert | their numbers; the phrase's lattice line (ψ, lane, tonic ¢, drift) |
| Cell: bass, comping, inner | "the chord ▸" | the notes table (slot, ratio, octave, Hz), "re-mined with its chord" |
| Cell: drums | the step grid, the presets, the prime strip | the mode and fill tag |
| Tuning section | the root | the frame, baseHz, the retunes' numbers |
| Main page part strips | the strips | the hint sentence ("Parts are read from the row…") |

- **C6. Where Phase B's controls go:** a MIDI button in header row 1 (off by default) that opens a small popover (B3).
  The channel table sits in the popover, not in the window.

## Proposed: Phase B, MIDI out (the builder's calls; Avery may overrule)

- **M1. Its own sender: `Composer/perform/composer-midi.js`.** It doesn't use the site's `window.lrcMidiOut`, for the
  same reason Cosmos doesn't (`Cosmos/audio/cosmos-midi-out.js`, header). That module times its messages off the main
  page's AudioContext, and the Composer plays on its own. Sharing it would mistime every note.
  - The wire rules are identical to `MIDIOUT_SPEC.md`: nearest note (±50¢), bend sent before note-on, ±48 semitones
    set by RPN 0 on every channel used, and the MPE configuration message on the Chords bus (its zone: master
    channel 1, 4 member channels). (RPN 0 is the standard message that tells a synth its bend range.)
  - So a DAW template set up for the site receives the Composer the same way.
- **M2. One clock, not two.** The player (`composer-player.js`) books everything 150 ms ahead on its tempo map. Its
  booking loop also books MIDI: each of a part's notes as its own note (decision 3), and each drum stroke, at its time on
  the same map, converted to MIDI timestamps through the context's `getOutputTimestamp`. MIDI reads the parts' notes,
  not the player's held chains, so the browser's legato never reaches it (decision 4). Live tempo, part on/off, a swap
  and an audition all reach MIDI exactly as they reach the speakers.
- **M3. Fixed channels (decision 1).** The five one-note parts use channel 1 of their bus (drums: 10). A chord voice
  keeps its own member channel on the Chords bus: voice 1 (root) on 2, up to voice 4 on 5. No allocator and no
  stealing. A same-note guard, as the site's: when a
  channel strikes the note it's already holding, the old note ends first.
- **M4. Velocity** is the note's velocity × its part's level, scaled to 1–127. Never 0, which MIDI reads as a note-off.
- **M5. Drums on channel 10, General MIDI notes:** kick 36, snare 38, hat 42 (closed), perc 37 (side stick), cymbal 49.
  A stroke is a 50 ms note. No bend.
- **M6. Silence on every exit.** Stop, hiding the tab, the main page taking over, MIDI turned off, a port lost, or the
  page closing: note-offs, then All Notes Off (CC 123) on every channel used.
- **M7. Browser sound.** A "local sound" toggle in the popover. Off, the Composer's own voices are silent while MIDI
  plays, so only the DAW sounds. Session only, never saved (as the site's local mute).
- **M8. The popover:** a bus picker per part, matched on first use to a bus whose name holds the part's name ("Lead",
  "Chords", "Comp", "Bass", "Inner", "Drums"; a part with no bus isn't sent, and says so); the bend range (default ±48,
  for synths set by hand); local sound; and the clock (decision 2): on, on the Lead bus by default, its bus pickable.
  Saved in localStorage under its own key, separate from the site's MIDI settings.
- **M9. Not in Safari.** No Web MIDI there: the button is disabled with a hint. The .mid export (M11) still works.
- **M10. Cosmos stays off.** Cosmos Compose doesn't send the composition over MIDI (the sprint's v1 call). Cosmos has
  its own MIDI out for the sky; how the two meet is a later call.
- **M11. Download .mid.** In Details (beside JSON): the composition as a multi-track MIDI file, one track per part, on
  the same channels and with the same bends and lengths, so it lands in a DAW in exact tuning without a live take, and
  at the Composer's tempo. `core/midi.js`'s writer gains pitch-bend and RPN events. Small, and useful as an offline
  check of the same notes.
- **M12. Note lengths, the same with legato on or off (decision 4):** each note lasts until its voice's next note (the
  part's next note; in the chords, that voice's next), and the last of a loop until the cycle's end. Notes touch, so a
  synth's mono-legato mode slides between them, and a synth's own release decides how a struck sound decays. Drums: 50
  ms (M5). Lengths can be cut in the DAW; they can't be grown back from slot-length notes.

## Phase A: the clean view

- A1. The flag: the Details toggle, its storage, the `ctab-details-on` class, the CSS.
- A2. Tag every surface in the map (C5) with `ctab-detail`, and move the advanced knob rows behind it.
- A3. The short forms: the readouts' one line, "Compose dropped n edits", the clip's one line, the alternates dot, the
  modulation glyph, the header's icon buttons.
- A4. The hidden-settings dot (C3).
- A5. Tests: a new `assert-page-detail.mjs` checks that every Details surface is hidden in the clean view and shown with
  the flag, that toggling changes no spec, and checks the dot. Existing page tests that read the hidden text turn
  Details on first.

## Phase B: MIDI out

- B1. `composer-midi.js`, testable in Node: the bus and channel table, note and bend, note lengths (M12), the wire messages, the
  same-note guard, all-notes-off, against a recording port. The tests are `assert-composer-midi.mjs`. They mirror the
  convention checks of `Cosmos/tests/assert-midi-out.mjs`, so the three senders stay identical on the wire.
- B2. The player's hooks (M2): every note (decisions 3, 4) and stroke reaches the sender, plus the exit paths (M6).
  A test plays a composition on the mock context and checks every note's channel, timestamp and bend.
- B3. The window: the MIDI button, the popover (M8), local sound (M7), the Safari hint (M9).
- B4. The clock (decision 2): 24 ticks a beat on its bus (Lead by default), Start at Perform, Stop at stop, following live tempo.
- B5. Download .mid (M11).

A and B touch mostly different files. Both edit the header of `composer-tab.js`, so they go one after the other, or
B1–B2 can run alongside A, with B3 after A merges.

## Browser and rig checklist (for Avery; a draft, finalized when built)

Serve from `.claude/worktrees/composer-sprint-2`. Composer window, 41:42:43 or 119:42:15:8.

**Clean view**
1. Open the window: the header, the matrix and the typed field, with no readouts beyond the meter line ("8 bars ×
   8"), and no decisions table. Undo and Redo are icons. The knobs: Bars, Slots / bar, Modulation.
2. Details on: everything as it was before. Off again: nothing recomposes, nothing stops playing.
3. With Details on, set Settle passes to 2, then turn Details off. The toggle shows its dot and names the setting.
4. Load a MIDI clip: one line ("name · n/J notes fit"), with the chips still there to audition.
5. Click a chord cell: the candidates by name, no numbers. A lead cell: the runner-ups as "line 1, line 2…", their
   shapes, no costs. A bass cell: the chord it follows, no notes table.
5b. Look at the look: the alternates count is a small dot on a cell, a modulation a ↻ (its cents in the title). Reload
   the page: Details stays as you left it. Under the Composition lens, the part strips' hint sentence shows only with
   Details on.

**MIDI out** (the six IAC buses, six Ableton tracks, the chords track in MPE, Ableton synced to the clock)
6. MIDI on, local sound on: the browser and the DAW play together, in tune with each other (no beating on held
   chords).
7. Each part arrives on its own track. Turn a part off in the matrix: its track goes quiet.
8. Chords: a seventh chord plays on the one MPE chords track, each tone on its own channel. A sustained chord is
   beatless in the DAW.
9. Perform: Ableton starts on bar 1 at the Composer's tempo. Change the tempo live: Ableton follows.
10. Toggle legato on a part: the browser's sound changes, the DAW's notes don't.
11. Stop, Esc, hiding the tab: no stuck notes in the DAW.
12. Audition an alternate chord: the DAW hears the audition, and hears it go back on Revert.
13. Local sound off: only the DAW sounds.
14. Download .mid, drag it into Ableton: the same parts and tuning as the live take.

## After this

With the clean view in, the Composer is close to ready to merge to main and go live. `composer-sprint-2` is 145
commits ahead of `main`, and `main` hasn't moved past it, so it would merge without conflicts. That is worth its own
call once Phase A passes.

## Log

**2026-10-27, phase A built** (branch `clean/view`, worktree `.claude/worktrees/clean-view`). Suites: 72, all green (71
before, plus the new `assert-page-detail.mjs`, 30 checks; `assert-page-target.mjs` gained a check of the clip's one
line).
- The flag is `tab.view.details` (`setDetails`), kept under `lrc.composer.details`. The hosts carry `ctab-details-on`;
  `ctab-detail` and `ctab-clean-only` do the rest in `composer-tab.css`. Everything Details shows is still in the DOM, so
  the existing page tests read it unchanged.
- Calls made while building (Avery may overrule):
  - The meter line is "8 bars × 8", without the BPM: the tempo box beside it already shows it.
  - The field's notes stay in the clean view (a chart's error, "Compose to hear it"): you have to act on them. So does a
    strip cell's "not a chord".
  - The Table row is hidden but never makes the dot: it says where Compose runs, not what it is asked.
  - The lead's runner-ups read "line 1…n" in the clean view (their cost a note in Details). The clip's own notes table
    in a MIDI target's lead cell stays (the clip's notes and their kinds); its lattice line and legend go to Details.
  - What Compose dropped reads "Compose couldn't keep n of the edits", the list in its title.
  - The part strips' hint (under the Composition lens) shows only with Details.
- Not checked: the look itself. The Node stub has no CSS, so the tests apply the stylesheet's rule by hand; the real
  rendering is Avery's browser pass (items 1–5b).
