# Mix and master (order, 2026-11-03)

Thread 2 of `RELEASE_PLAN.md`. Avery: the default mix has the chords too loud and the drums too quiet, and the master bus
could use some polish. Avery sent their Ableton master rack, "drms knock" (no FX buses yet), as the reference for the
master (`Composer/mix-reference/drms-knock.adg.xml`).

Avery is away and will not answer questions before this builds. Every call below that isn't Avery's is the builder's,
marked **Proposed**, logged, and overrulable. The questions that need Avery's ears are at the end.

Some words used throughout:
- **dBFS**: decibels below digital full scale. 0 dBFS is the largest value a sample can hold.
- **dBTP**: true peak, the peak of the waveform *between* the samples as well as on them. A DAC (the converter that
  turns the samples into a voltage) reconstructs those in-between peaks, so a signal at 0 dBFS on its samples can clip
  in playback. It's measured by 4× oversampling (ITU-R BS.1770).
- **LUFS / LU**: loudness as the broadcast standard (BS.1770) hears it, K-weighted: a shelf that favours the presence
  band, and a high-pass that discounts the lows. An LU is a dB of loudness. **M-max** is the loudest 400 ms window (how
  loud a hit is heard), **S-max** the loudest 3 s window, **integrated** the whole render's gated loudness.
- **Crest** is the true peak minus the RMS level. A larger crest means the transients stand further out of the body.
- **GR** is gain reduction: how many dB a compressor is turning the signal down at a moment.

## The probe (2026-11-03; `Composer/lab/mix-meter.html?run=1`, headless Chromium through Playwright)

The meter composes each row with the controller on the lean table, at seed 1 and the defaults: every part on, the made
kit, every level fader at 0.8. It then renders each part alone, and the whole mix, in an `OfflineAudioContext` (a Web
Audio context that renders to a buffer instead of the speakers) through the real player at 48 kHz. A render is two
cycles at 4 s, or one at 8 s, plus a 1 s tail. The cycle lengths are the ones the comp-gate probe heard each row at:
120 BPM everywhere but 7:5:3:2 at 60. The raw numbers are in `Composer/lab/mix-meter.results.json`.

**Each part alone, raw** (no master processing at all), as M-max **relative to the drums'**:

| row | drums M-max | bass | lead | chords | comp | inner |
|---|---|---|---|---|---|---|
| 8:7:6:5 | −26.3 LUFS | +10.6 | +20.1 | +19.6 | +10.7 | +5.1 |
| 11:9:7:5 | −25.4 | +11.7 | +14.4 | +18.7 | +10.7 | +6.8 |
| 16:12:9 | −25.9 | +10.1 | +18.8 | +19.1 | +12.7 | +12.0 |
| 7:5:3:2 | −26.2 | +9.9 | +19.7 | +19.2 | +10.8 | (no inner) |
| 19:17:16:15 | −26.2 | +13.0 | +20.3 | +19.7 | +11.9 | +6.8 |
| 119:42:15:8 | −25.4 | +12.2 | +18.3 | +21.3 | +10.6 | +6.9 |
| 768:769 | −25.3 | +11.9 | +16.3 | +18.8 | +12.8 | +6.4 |
| 768:784 | −25.6 | +12.0 | +20.5 | +20.2 | +12.9 | +6.7 |
| **median** | **−25.7** | **+11.8** | **+19.3** | **+19.4** | **+11.3** | **+6.8** |

**The whole mix**, medians over the 8 rows (per row in the results file):

| | integrated | true peak | crest | master GR, median (p95) |
|---|---|---|---|---|
| today (buses 0.8 → master 0.8 → the compressor) | −6.7 LUFS | **+0.1 dBTP** | 9.0 dB | 7.8 dB (9.0) |
| raw (today with no compressor) | −3.9 | +5.2 | | |
| staged (M2 + M3), no master | −19.6 | −2.2 | | |
| staged through today's compressor ('classic') | −16.5 | −2.0 | 16.5 | 0.8 |
| **staged through the rack ('knock', the new default)** | **−16.8** | **−3.9** | **15.0** | **1.6 (4.9)**, the Glue |

The knock chain's input trim, swept (medians; `knock.inputDb`, M4; an earlier run of the same build, within 0.2 dB of
the final one):

| input trim | integrated | true peak | crest | Glue GR median |
|---|---|---|---|---|
| +0 dB | −20.2 LUFS | −5.3 | 16.9 | 0.9 |
| **+4 dB (proposed)** | **−16.8** | **−3.9** | **15.2** | **1.7** |
| +6 dB | −15.1 | −3.6 | 13.8 | 2.2 |
| +8 dB | −13.6 | −3.5 | 12.1 | 2.8 |

What it shows:
- **Avery's ear is right, and the gap is large: the drums sit about 19 LU under the chords and the lead.** It isn't the
  composition. It comes from the libraries:
  - The made kit plays at chunk-tunes' levels (a kick is a 0.5 sine at velocity 0.85, about −10 dBFS at the bus, and
    170 ms long).
  - The pitched voices peak at their velocity and sustain at 0.7 of it.
  - Four sustained chord voices hold that level the whole bar.
- **Today's compressor is working the whole time.** Its median GR is 7.8 dB (9 at the 95th percentile). The chords and
  lead keep it down, so a kick passes through a compressor that's already clamped. Today's stems, each through it alone,
  put the chords 15–17 LU over the drums.
- **Today's mix is very hot, and it clips.** −6.7 LUFS integrated, louder than most finished masters, with true peaks
  over 0 dBTP on 5 of the 8 rows. The compressor adds about +3.8 dB of makeup gain by itself (below), and nothing after it
  catches the peaks.
- **Staging hits its targets in the median** (chords −9.1 against −10, comp −7.5 against −8, inner −8.6 against −9,
  lead −4.2 against −4, bass −3.2 against −3). The rows spread around them:
  - the lead is sparse on 11:9:7:5 and 768:769 (−9.1, −7.2);
  - 16:12:9's inner is a reed, which sustains, where the other rows have a harp (−3.4).
  A fixed table can't follow the orchestration; that's for the faders.
- **The rack catches peaks and leaves the body alone.** With the chords staged 10 LU down, the sustained bed sits under
  the Glue's −9.5 dB threshold. The Glue moves only on the hits: 1.6 dB median, about 5 dB on the loudest 5 %. Crest goes
  from 9 dB today to 15, so the kick stands out of the mix again.
  - The limiter mostly idles (true peak −3.9 dBTP): the Glue's 0.01 ms attack catches the peaks before it.
  - The knock and classic chains land within 0.5 LU of each other on the staged mix, so A/B-ing them compares sound, not
    level.
- **The new mix is about 10 LU quieter than today's.** That is the cost of not clipping and of giving the drums their
  transients back. +6 or +8 dB of input trim buys loudness back with more Glue (the sweep). The meter's A/B plays
  today's graph 10 dB down ("level-matched") so the comparison is of balance.

## The rack, read (`drms-knock.adg.xml`; M5 has the whole mapping)

The release plan's summary was written before the XML was read in full. Corrections:
- **The Saturator is in the outer chain, after the nested rack**, not inside it. The nested rack, "Gradual Mid Scooper",
  holds an **EQ Three** (`FilterEQ3`):
  - its crossovers are at 877 Hz and 2955 Hz, 48 dB/oct;
  - its macros (Isolate Mids, Macro 2, Macro 3) are driven by the outer Mids Only, Lo Cut and Hi Cut;
  - **"Lo Cut" (79) and "Hi Cut" (76) set the crossover points**, they aren't filters. They cut only when **"Mids
    Only"** turns the lows and highs down (to −70 dB at 127). At its saved 0, the EQ Three passes everything.
- **There is a Beat Repeat (off).** The "Beat Repeat" macro turns it on and sets Instant Repeat. "Macro 7" (saved 13)
  sets its Grid.
- **"A boost" (85) moves an EQ Eight bell** (band 2: +2.38 dB, Q 2.0) to 1726 Hz. **The EQ Eight is off.**
- **The Glue's attack and release are at their fastest** (Attack 0 is 0.01 ms, Release 0 is 0.1 s): a peak catcher,
  as its name says. The plan's "slow attack, so the transients pass" was a guess; the rack does the opposite.
- **The Delay is on at Dry/Wet 0.** "PING PONG" raises its Dry/Wet and Feedback together.
- So at the saved values, what sounds is **Glue → Tube (60 % wet) → Saturator**. Every other device is off, silent, or
  transparent.

Every value and mapping above is checked against the XML by `tests/assert-mix-master.mjs`. That includes the macros
resolving to the values the rack stores:
- Lo Cut 79 → 877.13 Hz, Hi Cut 76 → 2954.6 Hz and A boost 85 → 1726.05 Hz, all linear in log frequency;
- Loud 63.5 → the Saturator's Drive at 0 dB;
- Make it Dirty 0 → the Tube's Drive at −15 dB.

## Decided (Avery, 2026-11-03)
1. **M6. MIDI velocity is kept apart from the mix.** The mix and master are audio only. MIDI velocity comes from the
   composition and Avery's own level faders (CLEAN_MIDI_ORDER M4), never from the staging.
2. **The reference for the master is "drms knock"**, as sent.

## Proposed (the builder's calls; Avery may overrule)

- **M1. The meter** (built; the probe above is its run).
  - `lab/mix-meter.html` and `lab/mix-meter.js`. The measures are pure and tested in Node: BS.1770 K-weighting, M-max,
    S-max, gated integrated loudness, peak, true peak, RMS, crest. The rendering needs a browser.
  - Configs:
    - `today` (the graph before this order);
    - `raw` (no master processing);
    - `staged` (M2 + M3, no master);
    - `knock` (M2–M4, the new default);
    - `classicStaged` (M2 + M3 through today's compressor).
  - In a part's own render, the drums book with their fader at 0, so the part ducks as it does in the mix.
  - The page also has a live **A/B**: a row, Play, Master knock or classic, staging on/off, duck on/off, and today's
    graph (level-matched by −10 dB, switchable).
- **M2. Gain staging.**
  - **The measure is M-max**, the loudest 400 ms: how loud a hit is heard. S-max (3 s) rates sparse drums ~4 LU lower
    and would cut the chords and lead ~4 dB further. *Alternative:* stage on S-max.
  - **Targets in LU against the drums:** drums 0, bass −3, lead −4, chords −10, comp −8, inner −9 (the release plan's
    starting points).
  - **Each part gets a trim** = 6 dB (the drums' own trim) + its target − its probe median, to the half dB:
    - drums **+6**, bass **−9**, lead **−17.5**, chords **−23.5**, comp **−13.5**, inner **−10**;
    - the +6 brings the drums' raw peaks (median −9.1 dBFS) to about −3 dBFS into the master.
  - **A high-pass, 12 dB/oct (Q 0.707), on the chords and inner at 150 Hz, and the comp at 120 Hz**, so the low end
    belongs to the bass and the kick.
    - The comp's is lower because it's struck (marimba, kalimba), and its lowest fundamentals reach 135 Hz (7:5:3:2).
    - The chords also reach 135 Hz on 7:5:3:2, where 150 Hz takes about 4 dB off their lowest fundamental; their
      upper partials still carry the pitch.
  - **Where it sits:** each part's bus (its level fader, as before) → trim → high-pass → duck gain → master. The
    trims are not the faders:
    - the faders' defaults (0.8, in `store/composition-store.js`) are unchanged, so MIDI velocity is unchanged (M6);
    - a fader still means what it meant, and it still scales MIDI velocity (CLEAN_MIDI_ORDER M4).
  - The ownership table said "the default levels in the controller". The defaults actually live in the store, and
    staging doesn't need them changed, so neither file's levels moved.
  - **`sampleLevel` (`Audio/drums/made.js`) is unchanged.** The default kit is made sounds, so it only scales samples,
    and it keeps chunk-tunes' made-vs-sample balance. Shared with Playback.
  - *Alternative:* trims per row, from a quick render at Compose time. Rejected for now: the balance would move under
    Avery's hands from row to row, and the spread above is mostly the orchestration (sparse leads, reed vs harp).
- **M3. The kick duck.**
  - A gain on the chords, comp and inner, after their high-passes:
    - **−3 dB**, reached over the **5 ms before** each kick, so it's fully down *at* the kick;
    - held **10 ms**, then back to 0 dB over **120 ms**, linear in dB.
  - Kicks that overlap take the deepest dip; they don't stack.
  - **Booked from the kick times the player already knows.** When the drums book a kick (drums on, a kick in the
    kit), the duck books its points on the same clock map, a little ahead of the drums' window (the dip starts before
    the kick). No detector, so nothing reacts late. A ramp in gain between points follows the shape within 0.05 dB.
  - Not scaled by the kick's velocity (accents duck the same). A live tempo change moves the dips with the kicks, except
    the ~7 ms already looked ahead.
  - *Open:* a drums fader at 0 still ducks, because the kicks still book (see the questions).
- **M4. The master chain** (`perform/composer-master.js`, mapped from the rack; values in M5).
  - **The chain, in order:**
    1. Input trim, **+4 dB** (the sweep above).
    2. The Glue. Its **Peak Clip In** as a soft clip that's linear to −1 dBFS and rounds into +1 dBFS, then a
       DynamicsCompressor at the rack's settings (threshold −9.52 dB, ratio 2, attack 0.01 ms, release 0.1 s, a hard
       knee). Then **−2.86 dB**, which takes back the makeup gain the DynamicsCompressor adds by itself (the Glue's Makeup
       is 0).
    3. The Tube: an asymmetric tanh at −15 dB drive, **60.3 % wet** beside the dry signal.
    4. The Saturator: Analog Clip with Soft Clip, linear to −3 dBFS and rounding into 0 dBFS, 4× oversampled.
    5. **The limiter**, an `AudioWorklet` with a 6 ms lookahead and a true-peak detector, ceiling **−1 dBTP**, 120 ms
       release.
  - **Chromium's DynamicsCompressor adds makeup gain by itself**, (1 / its curve at 0 dBFS)^0.6. The Web Audio spec
    writes this down; most code using the node doesn't know it. `chromiumCompressor()` computes Chromium's own curve. Its
    makeup for today's compressor is +3.81 dB, and the headless browser measured +3.81. The knock chain takes it out of
    the Glue and the limiter's stand-in. 'classic' keeps it, because that's today's sound.
  - **The limiter.** A sample's need is ceiling / its true peak. The gain is the minimum need over the lookahead window,
    averaged over the same window: an average of minimums that each include the sample is never above that sample's
    need, so the gain arrives as a ramp exactly when the delayed sample does. Release is a one-pole. The channels share
    one gain (linked).
    - On test signals 10 dB over: the samples are under −1 dBFS, the true peak is −1.00 dBTP.
    - Below the ceiling it is the input delayed, bit for bit.
    - Latency is 294 samples (6.1 ms at 48 kHz).
    - Until its module loads, a stand-in DynamicsCompressor (ratio 20, its makeup taken out) does the job. Then the
      worklet crossfades in over 30 ms; their delays match within 0.1 ms. A context without AudioWorklet keeps the
      stand-in.
  - **The switch.** `player.setMix({ master: 'knock' | 'classic' })`, live, a 30 ms crossfade. 'classic' is today's
    compressor exactly, on the staged mix. Staging and the duck switch separately (`{ staging, duck }`).
    - The controller has `setMix` and `mix()`. It passes `COMPOSER_MIX` (knock, staged, ducked) to its player, so the
      lab and the main page's Composer tab get the new mix.
    - The meter page has the switch. **There's no switch in the window yet**: the window isn't this thread's to edit
      (see the questions).
  - **Cosmos and Playback are unchanged.** Without `mix`, the player builds today's graph byte for byte (Cosmos makes its
    player that way). No shared voice or drum file is touched.
- **M5. The mapping**, and what can't be emulated: the table below.

### M5. The rack → Web Audio

| rack device (saved) | what it does at the saved values | Web Audio | emulated? |
|---|---|---|---|
| **Glue Compressor** "Mastering - Peak Catcher": threshold −9.52 dB, ratio 2, attack 0.01 ms, release 0.1 s, range 64.4 dB, makeup 0, dry/wet 100 %, Peak Clip In on, no sidechain | catches the hits' peaks at 2:1 | soft clip (WaveShaper) → DynamicsCompressor (−9.52, 2:1, knee 0, attack 0.00001, release 0.1) → its makeup taken out (−2.86 dB) | **close.** Glue is modelled on an analog bus compressor; Chromium's detector and its adaptive release are its own. Chromium may also floor the attack above 0.01 ms; its 6 ms built-in lookahead catches the peaks anyway. Range 64 dB is unlimited in effect (the node has no range). **Peak Clip In** is read from its name as a clip at the input; check it against Live's manual. |
| **Tube** (Dynamic Tube), type C (Type 2), Drive −15 dB, Bias 0, Envelope 0.24 (attack 5.75 ms, release 35 ms), Tone 0.25, Output 0, dry/wet 60.3 % | gentle, mostly even-harmonic colour on the 60 % wet | dry 39.7 % + WaveShaper (an asymmetric tanh at −15 dB in, the same back out after) 60.3 % | **partly.** The tube models' internals aren't published: tanh with a small bias stands in. **Envelope** (the bias following the input) isn't emulated: the bias is static. **Tone** isn't emulated. **Assumed: Drive does not change the level.** If Live's Drive does (Output 0 at Drive −15 dB would be 15 dB down on the wet), the rack sits ~6 dB lower into the Saturator. The wet path isn't oversampled: Chromium's oversampler delays it, which comb-filtered against the dry (−5.8 dB at 1 kHz, measured). |
| **Delay**: dry/wet 0, feedback 0, ping-pong, synced 2/16 and 3/16, filter 5.6 kHz | nothing (dry only) | none | not built: silent at the saved values. PING PONG would need a tempo-synced stereo delay. |
| **EQ Eight**: off (band 2 a bell at 1726 Hz, +2.38 dB, Q 2.0) | nothing | none | not built: off. |
| **Beat Repeat**: off (Grid 2, Interval 6, Chance 0) | nothing | none | not built: off; a buffer-repeat effect, not a fixed process. |
| **"Gradual Mid Scooper"** → **EQ Three**: crossovers 877 / 2955 Hz, 48 dB/oct, every gain at 0 dB | passes everything (gains at unity); the crossover filters' phase shift remains | none | the level is emulated (unity); the phase shift of 48 dB/oct crossovers isn't. Mids Only would need a 3-band split. |
| **Saturator**: Analog Clip, Drive 0 (Loud 63.5), Color on at depth 0, Soft Clip on, Output 0, dry/wet 100 %, oversampling on | rounds peaks above about −3 dBFS | WaveShaper, 4× oversampled (linear to −3 dBFS, tanh into 0 dBFS) | **close in kind.** Analog Clip's exact curve isn't published. Color at depth 0 does nothing. |
| *(not in the rack)* | | **AudioWorklet limiter**, −1 dBTP, 6 ms lookahead, 120 ms release | new: the plan asked for it, and the rack leaves the ceiling to Live's master. |
| **Macros**: Turn it up 0, Make it Dirty 0, A boost 85, Loud 63.5, PING PONG 0, Beat Repeat 0, Macro 7 13, Mids Only 0, Lo Cut 79, Hi Cut 76 | | `DRMS_MACROS`, `resolveMacros()` | **at their saved values only.** Every mapping and range is a table, and `resolveMacros(values)` gives each parameter at any setting. None is wired to a control yet. |

## Phases

All three phases are built on `mix/master`, off `composer-release`. Thread 1 changes the comp in `core/compose.js` in
parallel; this thread touched no `core/` file and not the window.

- **Phase A (M1): the meter.** `lab/mix-meter.html`, `lab/mix-meter.js`, the probe's results
  (`lab/mix-meter.results.json`). The measures' tests are in `tests/assert-mix-master.mjs`.
- **Phase B (M2–M3): staging and the duck.** `perform/composer-master.js` (`MIX_TARGETS_LU`, `MIX_PROBE_MMAX_LU`,
  `MIX_STAGING`, `DUCK_DEFAULTS`, `duckPoints`); `perform/composer-player.js`, the graph (`mix`, the stages,
  `bookDuck`, `setMix`).
- **Phase C (M4–M5): the master chain.** `perform/composer-master.js` (the rack's tables, `chromiumCompressor`, the
  curves, `createMasterChain`, `COMPOSER_MIX`); `perform/composer-limiter.worklet.js`; `perform/composer-controller.js`
  (`mix` into its player, `setMix`, `mix()`; no levels changed).
- **Tests.**
  - `tests/assert-mix-master.mjs`, new, 59 checks:
    - the rack against the XML;
    - Chromium's curve and its makeup;
    - the curves;
    - the staging table;
    - the duck's shape, its windowed booking and its accuracy;
    - the limiter and the true-peak detector;
    - the meter's measures against BS.1770 (a −20 dBFS 997 Hz sine reads −23.0 LUFS);
    - the player's graph with and without `mix`, the duck at every kick, `setMix`;
    - **M6: every MIDI message identical, velocity included, with the mix on or off**, with the faders at their
      defaults and moved.
  - `tests/assert-lab.mjs`: its two graph checks follow a bus through its staging to the master and the chain. That's
    the graph changing by design, not a re-frozen output.

## Browser and rig checklist (for Avery)

Serve the repo root and open `/Composer/lab/mix-meter.html` (the A/B), then the main page's Composer tab.

1. **Mix meter → 8:7:6:5 → Play** (knock, staging, duck on). The kick and snare lead and the chords sit behind them.
   Nothing pumps audibly: the duck is 3 dB.
2. **Untick "kick duck".** The chords stop dipping at the kicks: listen for the kick's low end getting muddier with the
   duck off. If you can't hear a difference, say whether you want it deeper (4 dB) or gone.
3. **Untick "staging".** The old balance comes back through the knock chain: the chords and lead swamp the drums, and the
   Glue is working hard (its GR readout next to the switches). Tick it again.
4. **Master → classic.** The same staged mix through today's compressor, at about the same loudness (within 0.5 LU). The
   kick sounds rounder with knock (the Glue catches the peaks) and blunter with classic (6:1 with a 3 ms attack). Which do
   you want?
5. **Tick "today's graph"** (level-matched). This is the mix as it was, turned down 10 dB so the balance is what you
   compare. Untick "level-matched" to hear how much louder it was (and that it clipped).
6. **Rows 7:5:3:2 and 768:784.** The slowest and the densest rows: the duck on 768:784's dense kicks shouldn't flutter, and
   7:5:3:2's chords (down to 135 Hz) shouldn't sound thin from the 150 Hz high-pass.
7. **The main page's Composer tab, any row.** It plays the new mix by default. Your level faders work as before.
8. **MIDI, into your DAW.** The velocities are the same as before this order (the faders still scale them; the trims and
   duck don't reach them). Compare a capture against one from `composer-release`.
9. **Loudness.** The new mix is about −17 LUFS integrated, 10 LU under today's. Too quiet for you? The input trim is
   `KNOCK.inputDb` (+6 is −15.1 LUFS, +8 is −13.6; the Glue works harder).
10. **The rack in Ableton** (if you have it open): does **Peak Clip In** clip the Glue's input? Does the Tube's **Drive**
    change its output level? Both are assumptions here (M5).

## Questions for Avery (with the builder's call)
1. **Targets.** Chords 10 LU under the drums (M-max) is the plan's number, and it's built. Do the chords now sit where
   you want, or was "10 dB" meant more gently? A target is one number in `MIX_TARGETS_LU`; the trims follow from it.
2. **M-max or S-max** as the staging measure? *Builder:* M-max (how loud a hit is heard).
3. **Loudness.** −16.8 LUFS at +4 dB of input trim, or louder with more Glue? *Builder:* +4, transients first.
4. **The window's switch.** The window (`page/composer-tab.js`) isn't this thread's to edit. *Builder:* a "Master: knock
   | classic" select in the MIDI or sound popover, calling `core.setMix`, in the window's next pass. Or none, if knock
   should simply be the sound.
5. **The macros live?** Turn it up, Make it Dirty and Loud are cheap to wire (a gain, the Tube's drive, the Saturator's
   drive). Mids Only, PING PONG and Beat Repeat are real builds. *Builder:* none until you ask.
6. **A drums fader at 0 still ducks** (the kicks still book). Should a muted drum part stop the duck? *Builder:* yes, if
   you agree: a one-line check on the drums' level.
7. **Cosmos.** It plays through the same player with today's graph. Should it get the staging and the rack? *Builder:*
   after you've heard the Composer's.

## Log
- 2026-11-03: written and built in one cloud session (Avery away; every call above that isn't "Decided" is the builder's).
  - The probe ran headless (Playwright's Chromium), so the numbers are real, not owed.
  - Phases A–C committed on `mix/master`.
  - The suites: 85 (84 + `assert-mix-master`). See the PR for the run.
  - A draft PR into `composer-release`.
