# Composer: the release plan (2026-11-03)

Avery, after Composer v1 merged to `main` (aa8854f): polish the Composer for release. There are three threads, and they
should run in parallel without stepping on each other:

1. **The comp's flams.** Chords comped across scattered onsets sound sloppy.
2. **Mix and master.** Chords are too loud and drums too quiet. The master bus could use some polish, and Avery has Ableton
   racks we could emulate.
3. **Arrangement and long form.** The Composer makes one loop. It should choose its own parts over time, change
   progressions and decompositions across many cycles, and build song forms from a single tone row.

This plan sits above the per-thread orders. Each thread still gets its own order (probe, rulings, phases) in the usual
workflow (`DIRECTIONS.md`, "Workflow"). Proposals here are the planner's and can be overruled.

---

## Thread 1: the comp's tightness

### The probe (scratchpad `flam-probe.mjs`, seed 1, natural tempo)

A comp stroke plays its own onset plus every other chord class the row sounds within ±`compTolerance` **slots**. Each
tone plays **at its own onset's time** (`noteAt(ctx, i, …)` in `strumOf` and `strokeTonesOf`, `core/compose.js`). So the
window is not a flam threshold: it sets how far apart a "chord's" notes may land. The spread is the time from a stroke's
first note to its last.

| row | slot | ±⅛: tones/stroke, spread median/max | ±¼ | ±½ (today's default) | ±½ strokes over 30 ms |
|---|---|---|---|---|---|
| 8:7:6:5 | 667 ms | 1.0, 0/0 ms | 1.67, 95/114 | 2.0, 114/190 | 100 % |
| 16:12:9 | 500 ms | 1.0, 0/0 | 1.5, 83/83 | 2.25, 250/250 | 100 % |
| 7:5:3:2 | 1333 ms | 1.0, 0/0 | 1.5, 286/286 | 3.0, **1143/1143** | 100 % |
| 19:17:16:15 | 250 ms | 1.6, 13/29 | same | same | 0 % |
| 768:769 | 250 ms | 1.3, 0/21 | 1.6, 0/62 | 2.1, 50/208 | 50 % |
| 768:784 | 250 ms | 3.0, 20/21 | same | 3.75, 122/122 | 75 % |

What it shows:
- **The window is measured in slots, so it scales with the tempo.** At ±½ on a slow row, a chord's notes can be more than a
  second apart. That is an arpeggio, not a chord.
- **An absolute gate leaves simple rows as single notes.** Keep only tones within *g* ms of the stroke: at 15, 25 or 40 ms,
  every simple row is 1.0 tones a stroke. Dense, near-unison rows keep real chords: 768:784 keeps 2.75–3.0 tones,
  19:17:16:15 keeps 1.4–1.6.
- So "back to single notes" and "a stricter threshold" are the same move. A gate in milliseconds gives single notes where
  the row can't voice a chord, and chords where it can.

### Proposal (for the T1 order)
- **C1.** The tolerance becomes an absolute gate in ms, measured at the tempo that plays: **15 | 25 | 40 ms, default 25**.
  The slot tolerances stay as `compTolerance` overrides, to pin today's output.
- **C2.** An optional **Snap** mode. It gathers tones over a musical window (±¼ slot) but strikes them all on the stroke,
  with an optional few-ms human strum (`compSnap: 0 | 8 | 15 ms`). This gives chord stabs on every row. The cost is that
  each tone's time is borrowed from the stroke, not taken from the row. **Avery rules: is Snap allowed, and is it the
  default?**
- **C3.** The readout says what the gate did, in the decision's words, for example "25 ms: 1.0 tones a stroke, single
  notes".

**Ruled (Avery, 2026-11-03):** a 25 ms gate by default, with Snap as an option. The order is `COMP_GATE_ORDER.md`.

**Files:** the comp section of `core/compose.js` (strum/stroke tones, velocity unchanged), the `restrum` door in
`core/rearrange.js`, the tolerance control in the window, and `tests/assert-strum.mjs`. **Small: one phase.**

---

## Thread 2: mix and master

### What the graph is today (`perform/composer-player.js`)
- The chain: each part → its own gain bus (all **0.8**) → master **0.8** → one `DynamicsCompressor` (threshold −10 dB,
  ratio 6, knee 6, attack 3 ms) → output.
- Velocities (`VELOCITY` in compose.js):
  - chords 0.45, held, up to 4 voices;
  - lead 0.8, bass 0.75, comp 0.55;
  - drum samples at velocity × `sampleLevel`: kick 0.9, snare 0.7, hat 0.4.
- Why the chords win and the drums lose: the chords are four sustained voices, so their loudness is far above their peak.
  The single compressor reacts to the *sum*, so that sustained bed keeps it in gain reduction and flattens the drum
  transients.
- **The MIDI out is affected too.** Bus levels scale MIDI velocity (M4), so a mix change today also changes the MIDI.

### Proposal (for the T2 order)
- **M1. Measure before turning knobs.** Build `Composer/lab/mix-meter.html`. It renders each part of a spec alone in an
  `OfflineAudioContext` (a Web Audio context that renders to a buffer instead of the speakers, faster than real time) and
  prints each stem's peak, RMS and short-term loudness, over the 8 probe rows and every part setting. Node can't run Web
  Audio, so Avery runs this page, or the builder runs it once in the in-app browser and records the numbers in the order.
- **M2. Gain staging.**
  - Set default bus levels from the meter, against targets relative to the kick. Proposed starting points: drums 0 dB,
    bass −3, lead −4, chords −10, comp −8, inner −9.
  - High-pass the chords and inner at about 150 Hz (and the comp near it), so the low end belongs to the bass and kick.
- **M3. Duck the chords under the kick.** The player books every kick ahead of time, so the duck can be scheduled
  directly: a gain dip on the chords, comp and inner buses at each kick, 2–4 dB with about 120 ms recovery. No detector
  is needed, and nothing reacts late.
- **M4. A master chain** in a new module, `perform/composer-master.js`. Its stages:
  - a gentle tilt or shelf EQ;
  - a glue compressor (slow attack, 2:1, so the transients pass);
  - an optional saturator (a `WaveShaper`);
  - a real limiter at the end, an `AudioWorklet` with lookahead (a short delay that lets the limiter see a peak before it
    arrives), aiming at about −1 dBTP ceiling.
  - Off, it falls back to today's compressor.
- **M5. Avery's Ableton racks.** Send the `.adg` files. An `.adg` is gzipped XML, so the builder can read every device and
  parameter value directly and map them onto M4's stages (EQ Eight → biquads, Glue Compressor → the compressor, Saturator
  → the waveshaper curve, Limiter → the worklet). M4 starts on a generic chain and takes the rack's values when they come.
  - **The rack came 2026-11-03:** Avery's master rack "drms knock" (no FX buses yet). It's decompressed, with local paths
    scrubbed, at `Composer/mix-reference/drms-knock.adg.xml`. Top level, in order:
    1. Glue Compressor "Mastering - Peak Catcher": threshold −9.5 dB, ratio 2, attack and release at their minimum
       setting (index 0), makeup 0, range 64, Peak Clip In on.
    2. Tube: Type 2, PreDrive −15, Tone 0.25, Dry/Wet 60 %, auto-bias 0.24.
    3. Delay: Dry/Wet 0, so it's in the chain but silent unless the PING PONG macro opens it.
    4. EQ Eight: **off**.
    5. A nested rack, "Gradual Mid Scooper", holding a Saturator: Analog Clip, drive 0, post-clip on, oversampling on.
    - Macros: Turn it up 0, Make it Dirty 0, A boost 85, Loud 63.5, PING PONG 0, Beat Repeat 0, Mids Only 0, Lo Cut 79,
      Hi Cut 76.
    - Which parameters each macro drives is in the XML.
- **M6, ruled (Avery, 2026-11-03):** MIDI velocity is kept apart from the mix.
- **The order is `MIX_MASTER_ORDER.md`** (M1–M5 built on `mix/master`, with the meter's numbers; it corrects the rack
  summary above: the Saturator is in the outer chain, the nested rack holds an EQ Three, and there's a Beat Repeat).
- **M6. MIDI stays clean.** The mix and master are audio only. MIDI velocity comes from the composition and Avery's own
  level faders, not from M2's staging. **Avery rules.**

**Files:** the graph section of `perform/composer-player.js`, the new `perform/composer-master.js`, the new
`lab/mix-meter.html`, the default levels in `perform/composer-controller.js`, and possibly `sampleLevel` in
`Audio/drums/made.js`. T2 does not touch `core/` (that would change the specs and the MIDI). **Two phases:** M1–M3, then
M4–M5 once the racks arrive.

---

## Thread 3: arrangement and long form

### The model

A **piece** is a list of **sections**. Each section is *k* passes of one cycle, played as one **variant** of the row.
Variants differ at three depths, from cheapest to most expensive:

1. **Masks.** Parts on or off, and each part's density (bass Roots…Walking, comp tiers, Line or Arp, drum modes, Close or
   Led). These are today's live arrangement steps (`setPart`, `arrangeBass`, `arrangeArp`, `reclave`, `restrum`,
   `revoice`, `arrangeDrums`), byte for byte, at no solve cost.
2. **Walks.** The same chords with new material: ranked lead runner-ups, a re-filled inner, a new arp or comp. These come
   from `rearrange.js` in about 12–38 ms a phrase. "Improvise" from `DIRECTIONS.md` lives here.
3. **Re-decompositions.** A new Compose of the *same row* with different bars, slots, phase, root or progression (a typed
   or solved chart). This is "the tip of the iceberg" Avery means: the same cycle cut into a different meter becomes a new
   section. Each one costs a full Compose (about 1 s on the 16k row, less on small rows), so they're solved ahead in the
   worker while the current section plays.

**The engine:**
- A pure `core/form.js` plans the piece. It returns the section list, and each section's overrides, masks and walk
  choices.
- The player plays a *queue* of specs, handing off at each loop boundary. Its loop lookahead already books one loop
  ahead.
- A background worker solves the next section before it's due.

**There is no preference model yet.** So the planner chooses with:
- rules and templates first: intro (thin), build (add parts and density), peak (all parts), break (drop the drums, or
  keep only the chords), return (the home variant, the home chords);
- scored by objective proxies: contrast between neighbouring sections, an arc of energy (parts × density), and a return
  to the home variant at the end.

### Two modes on one engine
- **Song.** The form is planned up front, shown as a section × part lane over the matrix, editable and undoable like
  every other choice. It exports as one MIDI file or stream.
- **Improvise.** The form is generated as it plays: the anchor holds and the other parts walk (down the ranks, around the
  top *k*, or one phrase changing at a time), with an occasional re-decomposition as a "new section". It's endless, and it
  suits Cosmos.

### Questions for Avery (with the planner's recommendation)
1. **Tempo across re-decompositions.** Keep the cycle's length (so a new bar count changes the tempo, a true metric
   modulation), or keep the tempo (so the cycle stretches)? **Recommend: keep the cycle**, and offer "keep the tempo" as a
   switch. Keeping the cycle keeps the row's own clock, and a drummer will enjoy the modulations.
2. **Song first or Improvise first?** **Recommend: Song first.** It gives you an editable, exportable piece to judge, and
   Improvise reuses the same engine.
3. **The unit.** Is a section *k* passes of the cycle, with the chart's own sections (A, B) staying *inside* one cycle?
   **Recommend: yes**, so long form never fights the chart.
4. **Transitions.** Section ends get a drum fill and the bass walks into the next section's downbeat; parts enter on the
   downbeat only. **Recommend: yes, both, at first.**
5. **Cosmos.** Does Cosmos Compose play Improvise mode? **Recommend: later**, after Song passes.

**Phases:**
- **A3. `core/form.js`.** Pure, with tests: variants, templates, scoring, determinism by seed. It reads the compose and
  rearrange APIs and edits neither.
- **B3. The player's queue.** Section handoff, solving ahead in the worker, MIDI across sections.
- **C3. The window.** The arrangement lane, its edits and undo, and "regenerate section".
- **D3. Improvise mode** on the same engine.

---

## Thread 4: the release pass
- **Avery's owed browser and rig passes**, cleared or knowingly waived:
  - the bass and voicing order with Amendments 1–3;
  - comp and arp;
  - chord charts;
  - the clean view and MIDI (passed);
  - Cosmos view and quality.
  - Their checklists are in each order.
- **The tutorial.** Avery's rewritten text, a slower opening, a slower "show the work". The guided tour is behind a flag
  now (eaea26d).
- **Defaults pass.** After T1 and T2, play the 8 probe rows on default settings and make sure every one sounds clean with
  no touching.
- **Docs.** The user-facing README for the Composer (today's README is the builders'), and a short "what each control
  does".
- **Performance.** Compose and solve-ahead stay inside budget on the 16k row with long form on.

---

## Running it in parallel without collisions

Each thread **owns** its files. A thread may *read* any API, but it edits only what it owns. Branches come off `main`
(Composer v1 is there now), in worktrees under `.claude/worktrees/`, built by Opus agents. The planner merges `--no-ff`
into an integration branch (`composer-release`). Never push.

| | owns | must not edit |
|---|---|---|
| **T1 comp** | `core/compose.js` (comp section only), `core/rearrange.js` restrum door, the comp control in the window, `tests/assert-strum.mjs` | the player, master, form |
| **T2 mix** | `perform/composer-player.js` (graph only), `perform/composer-master.js` (new), `lab/mix-meter.html` (new), default levels in the controller, `Audio/drums/made.js` levels | `core/*` |
| **T3 form** | `core/form.js` (new), its tests; later the player's *scheduling* section, the arrangement lane UI | `core/compose.js`, the player's graph |

**Waves:**
- **Wave 1 (now, in parallel):**
  - T1, the comp gate: one phase, after Avery rules C1/C2.
  - T2, M1–M3: meter, staging, duck.
  - T3, the probe and rulings: Avery answers Q1–Q5, then the order is written.
- **Wave 2:**
  - T2, M4–M5: the master chain, with the racks when they arrive.
  - T3, A3 (`form.js`), pure, so it collides with nothing.
- **Wave 3:** T3 B3, the player's queue. It waits for T2 to merge, because both touch `composer-player.js`: T2 the graph,
  B3 the scheduling. Then C3, the lane, and D3, Improvise.
- **Wave 4:** Thread 4, the release pass, then merge `composer-release` to `main` and deploy.

**What Avery owes to unblock Wave 1:**
- C1/C2: the gate and Snap.
- M6: MIDI kept apart from the mix.
- The `.adg` racks, whenever they're ready.
- Q1–Q5 for long form.
