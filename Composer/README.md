# Composer

Press Compose and the Composer decomposes one rhythm's own tone row into an arranged tune: a lead, chords, comping, a bass and an inner voice. Every note is an onset the row already plays, at its own time and with its own ratio. Then press Perform. It's a prototype: it runs in a standalone lab page and isn't yet part of the main LRC page.

`DESIGN_NOTES.md` holds the decisions (Avery's calls are marked **decided**), the proposals, the measurements and the open questions. This file is the short way in.

## Run it

Serve the repo root as a static site and open the lab:

```bash
python3 -m http.server 8000
```

Then go to `http://localhost:8000/Composer/lab/composer-lab.html`. The page needs http, not `file://`, because Compose runs in a module worker. It plays through the shared voice library in `Audio/voices/`. The page isn't linked from `index.html`.

- **Inputs:** four layer numbers (blank or 0 means absent), the cycle in seconds, a seed, and presets from 8:7:6:5 up to a 16,359-onset row.
- **Compose → Perform ⇄ Stop.** Change any input or knob and the button goes back to Compose.
- **Knobs:** bars, slots per bar, frame ±¢, modulation, anchors, settle passes, root presence, and the table (full in the worker, lean on the main thread). Each one shows what Compose chose, or "asked" when you've overridden it.
- **Progression:** a root a bar from the row's own tones (its ±frame clusters, by ratio, note name, cents and presence), or auto. Compose keeps each asked root, finds the quality the bar's tones support, and mines everything under it. "Take from last compose" copies the roots the last compose chose; "clear" sets every bar back to auto.
- **Live, without re-composing:** each part's sound, legato, on/off and level, plus Glide (portamento) and Tempo.
- **Readouts and export:** tempo, meter, root, chords and the decisions list (what Compose chose and why). JSON export gives the spec plus `playback`.

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

**Targeted progressions** (`progression.js`, `compose(..., { progression: [ratio | null, ...] })`): the bars given a root skip steps 3–4's lead-led choice. Their chord keeps the asked root, and its quality is the best one the bar's own tones support (all its classes but at most one sounding). If none is supported, it falls back to a dyad or the root alone, and says so. The lead is mined over these chords, and the settle passes re-derive only the quality. Auto bars are found as above, and an off-grid root retunes, as in step 4. With no progression, or all auto, Compose is unchanged.

## Files

- **`core/`:** pure ES modules (no DOM, fetch or clock) that run in a page, a worker or Node. `compose-worker.js` wraps `compose()` for a module worker.
- **`lab/`:**
  - `composer-lab.html` and `composer-lab.js`: the page and its view
  - `lab-controller.js`: state, with no DOM
  - `lab-player.js`: a lookahead scheduler, with no DOM
- **`tests/`:** plain Node scripts with no runner. `rhythms.mjs` is the shared rhythm set; `settle-baseline.mjs` pins the output from before settling; `time-lines.mjs` is a timing table, not a check.
- **`probe/`:** the 2026-10-21 cost probe (`FINDINGS.md`), the source of the onset gate.

## Tests

Run every suite (the Composer's, the shared voices', Cosmos's and MIDI Out's):

```bash
for t in Composer/tests/assert-*.mjs Cosmos/tests/assert-*.mjs Audio/tests/assert-*.mjs Playback/MIDIOut.test.mjs; do node "$t" >/dev/null 2>&1 || echo FAIL $t; done
```

A clean run prints nothing; there were 44 suites as of 2026-10-22. Some tests also read chunk-tunes in the Overworld project, read-only, to check the port; without it they skip with a message.

## Where it lives

The branch is `composer-prototype`, cut from `feat/shared-voices`, which holds the shared voice library and Partitions on `Audio/drums`. Neither branch is on `main` yet. The next step is the drums ("Next" in `DESIGN_NOTES.md`).
