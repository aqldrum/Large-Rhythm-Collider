# Cosmos audio — the churn investigation (2026-07-29 → 30)

As-built record of the debugging arc that started as "MIDI notes drag while the camera moves" and ended
with three independent defects fixed and smooth transitions everywhere. Companion to
`AUDIO_WORKERS_STREAMING_PLANNING_2026-07-29.md` (which framed the questions) and
`KNOB_RAIL_IMPLEMENTATION_PLAN_2026-07-28.md` (the UI ledger).

**Outcome, Avery (2026-07-30):** *"now we're getting smooth transitions everywhere… I'm not even convinced
the high grid saturation is as much of an issue now."* That second clause matters — see §6.

---

## 1. Commits

| Commit | What |
|---|---|
| `59145a6` | The knob rail owns the engine; the audio lab is demoted to a dev mirror |
| `10feedf` | Audio-clock telemetry — measure the mechanism before fixing it |
| `2d5ba31` | Transport off the main thread · silence over displacement · pose vs membership (rows) |
| `88410c1` | The bed's audible set stops depending on where you look |

---

## 2. The method, which mattered more than any single fix

Two moves did the work, and both are reusable.

**Establish one owner before diagnosing anything.** The rail and the audio lab both wrote engine state, so
no dropout report was trustworthy — you could not know which surface the engine was obeying. That is why
the ownership transfer went first even though it fixed no bug. Everything after it was legible.

**Find the input that isolates the variable.** Avery: the drag happens *under the arrow keys*. Arrows are
**pure rotation** (`stepControls` touches only `cam.yaw`/`cam.pitch`). Rotation changes no zone membership,
no distance and no `programKey` — so `chooseSpatialRows` returns the same set and `setField` pends no deck.
That single observation eliminated solve/compile churn, the entire top of the suspect list, before a line of
code was read. Every subsequent fix was found by asking what *else* could still be true.

**Then measure, and let the instrument disagree with you.** The panel
(`cosmos/audio-telemetry.js`) was built to *falsify* a specific chain, with the prediction written down
first: under `steer`, installs/s and compiles/s stay 0.0 while lateness climbs. It buckets everything by
motion mode so the experiment needs no stopwatch — sit still, steer, fly, press **T**.

---

## 3. Three independent mechanisms (they only looked like one bug)

### 3.1 The transport shared a thread with the renderer

`updateGridRowField` rebuilt the audio field **every rAF frame** — walking every zone, running
`chooseSpatialRows` twice, issuing compile requests, re-automating every star — and the note scheduler was a
**25ms `setInterval` on that same thread** with a **100ms** lookahead. Frame cost starved the pulse; the
pulse arrived after its events were due; and the row scheduler did not drop late events but **clamped them
to `now`** (`Math.max(now, when)` under a 30ms slop), with the MIDI bridge clamping their timestamps the
same way. A spread of onsets therefore landed as one **flam**, which exhausted the 15-channel MPE pool into
steals and drops.

Measured, and this is the number that settled it: in a hidden tab the old pulse showed a **1001ms tick gap
against a 25ms nominal** — browsers clamp background main-thread timers to 1Hz. With a 100ms lookahead that
starves the transport of ~900ms out of every second, so flight-boot's stated intent ("switching tabs must
not cut the performance") had never actually held.

**Fixed** (`2d5ba31`) — `cosmos/transport-clock.js` + `cosmos/cosmos/transport-clock-worker.js`: a worker
timer, degrading to `setInterval` if a Worker cannot be built or dies mid-session. The worker holds no
musical state (it posts an empty tick; `schedulerTick` reads the AudioContext clock as the only truth), so a
late tick can delay scheduling but can never desynchronise anything. Same starved rig afterwards: **tick gap
p95 29.1ms / max 42.1ms** — 34× better worst case.

`SCHEDULE_AHEAD` 100ms → **250ms**. The relationship is the design, not a preference: *while the horizon
exceeds the worst pulse gap, no event is ever reached late, so neither the clamp nor the drop can fire at
all.* The cost is committing a note 250ms early, and nothing musical resolves faster than that.

### 3.2 A late note was displaced instead of dropped

The 30ms clamp-to-now is replaced by an explicit exported policy (`classifyLateEvent`): on time → emit;
late by less than **12ms** (`ROW_MICRO_GAP_SECONDS`, below which two attacks are not separately articulated)
→ emit clamped; past that → **drop, counted**. A rhythm *is* its spacing, so a note in the wrong place is
worse than a note that is missing.

**The subtlety this exposed, which matters for streaming:** a dropped event must still advance the
repeat-cull layer memory. If the memory only advanced when a note *sounded*, a drop would leave a stale tone
in the comparison and change which **later** notes re-strike — a silent divergence, and exactly the kind
that would make a streamed window fail an equivalence check against a full compile.

### 3.3 The bed's audible set depended on where you were looking

The one Avery predicted from the Ableton recording. `flight-view` built the bed's audible set from `proj` —
the zones that **project onto the screen** — sorted by **view depth**. Turning the camera swung stars clean
out of the frustum, where the `AUDIBLE_MARGIN` hysteresis cannot even see them to protect them, and swung
new ones in. Each churn is a full release/create cycle, and `createVoice` emits a **MIDI note-on per
voice** — so the same bed chord re-struck on every frame of rotation. WebAudio masked it (a 1.5s
`BED_ATTACK` retriggered at 60Hz sits near peak and sounds like a pad), which is why it presented as a
MIDI-out limitation. It was a defect MIDI merely exposed.

**Fixed** (`88410c1`), and the principle is now stated once in the source: **pose is view-relative,
membership is not.** Rows (`ROW_RADIUS`) and the root solver already worked this way — `ROOT_RADIUS`'s
comment says outright that the root must not change on turning your head. The bed was the layer that never
got it.

- Membership: true 3D distance, gated on the same causes as the row field (translation, zone spawn/evict,
  new chord key, landed compile) plus a root swap. **Rotation marks nothing.**
- Pose: every frame via `setSkyPose`, which by construction cannot create or release a voice. Pan becomes
  the azimuth sine in the listener frame — so a star still sweeps the stereo image as you turn, and unlike
  the old screen-space law it is *defined for stars outside the frustum*, which is what made view-dependent
  membership necessary in the first place.
- `syncBedDegrees` moved onto the **audio clock**, so a chord change or root swap is voiced promptly rather
  than waiting on a membership interval it no longer rides.

### 3.4 …and the reason it went silent rather than merely churning

`MAX_BED_OSC` never bounded live nodes. `releaseVoice` frees the logical budget **eagerly** — deliberately,
so a release tail cannot starve incoming voices — while the oscillator keeps rendering for
`BED_RELEASE + 0.05` ≈ **2.55s**. Under churn that gap is unbounded, and burying the **audio thread** is
invisible to every main-thread meter. That is why sustained rotation killed audio with MIDI *off* while the
whole table read zeros.

Now there are two counts: the eager logical budget, and `MAX_BED_LIVE_OSC` (3× the budget, holding the
legitimate release overlap) decremented only in `onended`. A refusal is **counted**, so the pathology
reports itself instead of the sound merely dying.

---

## 4. Measurements

**The three-mode table after 3.1/3.2 landed** (Avery's machine, MIDI off):

```
mode   dwell  frames  frame-p50  frame-p95  tick-p95  late-p95  clamped/s  dropped/s  installs/s  compiles/s
still   18.6s    1109      9.4ms     10.5ms    33.1ms     0.0ms        0.0        0.0         6.2         9.3
steer    5.9s     351      9.9ms     11.0ms    33.8ms     0.0ms        0.0        0.0         0.0         0.0
fly      5.8s     346      9.4ms     11.6ms    33.5ms     0.0ms        0.0        0.0       150.1       208.8
```

Read it as three separate findings:

- **The prediction held.** `steer` does zero membership work — the premise of the whole diagnosis.
- **The transport is healthy.** `late-p95 0.0ms`, `clamped 0.0/s`, `dropped 0.0/s` in every mode, 60fps
  frames, `field` phase down to 0.8–2.1ms p95.
- **The zeros are what pointed at the bed.** With rows and the transport exonerated, the dropout Avery still
  heard *had* to be somewhere no meter was looking — which is precisely where it was.

**The bed, verified against the engine directly** (it needs solved zones, which need frames the preview pane
cannot run, so this drives `cosmos-audio` rather than the camera):

- 2 stars × 3 degrees → 6 voices. **120 pose updates — 2s of rotation at 60fps — then create 0 and release
  0.** An identical membership pass is inert.
- The old pathology simulated (40 alternations of 10 disjoint stars): `liveOscs` pins at exactly the **90**
  ceiling with **1,896 refusals** counted, then settles to the correct 30 once the tails finish. Before the
  fix that storm was unbounded (~1,200 oscillators). At peak, `logicalVoices` read **0** while real nodes sat
  at 90 — the eager-free gap, now visible and bounded.

---

## 5. Principles worth keeping

1. **One owner before any diagnosis.** Two surfaces writing the same state makes every bug report noise.
2. **Pose is view-relative; membership is not.** Where a source sits may follow the camera every frame. What
   is *in* the field may not — an entry or exit is a note event, and turning your head must never make one.
3. **Lookahead > worst pulse gap.** Then lateness cannot occur, and no late-event policy has to be good.
4. **Silence over displacement.** Past the articulation threshold, a dropped note beats a moved one.
5. **A skipped note must cost exactly that note.** State that the sequence depends on advances anyway, or
   dropping quietly changes the future.
6. **Instrument the layer, not the suspect.** Every meter watched the main thread and the row path, so a bed
   that was burying the audio thread read as all zeros. Percentiles, not means: the failure is a tail.
7. **Count levels, not only rates.** A logical budget freed early cannot see the nodes still rendering.

---

## 6. What this changes about the streaming project

Avery, 2026-07-30: *"I'm not even convinced the high grid saturation is as much of an issue now."* That is
the right read, and it narrows the justification honestly:

- **"Music wherever you are" was mostly a churn problem, and churn is fixed.** The transitions were never
  really about grid size — they were about a starved clock and two view-dependent membership sets. Streaming
  was carrying credit for a cure it had not delivered.
- **What genuinely remains for streaming is the OOM alone**: a rhythm with a huge single layer materializes
  ~`layerSum` composite-onset objects (~1e6), which the interim `ROW_MAX_COMPOSITE_ONSETS = 20000` cap
  (`cec5795`) currently handles by going silent on those owners (`reason:'too-dense'`). That is a real hole
  in the Cosmos — those grids are mute — but it is now a *bounded* hole, not the cause of general dropouts.
- **So alternative (i) in the planning doc is genuinely on the table**: keep the cap as a permanent tier and
  let absurd grids be ambient-only. The decision should be made on how many charted grids the cap actually
  silences — a cheap headless count, and a better first step than a streaming compiler.
- **Avery's palindrome constraint still stands** if streaming does go ahead: saturation is not detectable
  before `cycle/2` (all novel gap content has appeared by the midpoint, but nothing tests for it earlier),
  caps distort the tuning system because the gaps *are* the pitches, and reflection is what keeps the tail
  sounding. See the amendment in §5 of the planning doc.

### Next, in the order I would take it

1. **Install/compile churn** — the table's `fly` row: **150 installs/s and 208 compiles/s**, and `still`
   still shows 6.2/9.3 from the solve frontier landing programs. Each install runs `_seedDeck`, which walks
   the whole event list **twice**. This is the last churn we know about and it is worth doing before
   streaming, because streaming changes what an install costs.
2. **Count what the `too-dense` cap silences**, then decide streaming vs. permanent-tier on the number.
3. **Knob refinement** (Avery's next thread): SPEED's default is still the placeholder 2.5 notes/s, DWELL's
   curve is still linear, and RICHNESS reads as ~3–4 discrete levels rather than a continuum (a detent over
   chord-vocabulary tiers is the candidate). All three are live on the rail and persisting, so calibration is
   now just fly-twist-leave.

---

## 7. Still open

- **MIDI-out cannot carry the stereo image — deferred, with a correction.** Under MPE every note owns a
  member channel, so per-note pan *is* expressible (CC10 on that channel). Ableton will not act on it
  without explicit mapping, so deferring is right — but the reason is DAW ergonomics, not a protocol limit.
  After 3.3 the drag is gone anyway, which was the actual complaint.
- **The sphere-shaped bed is a real change in what you hear.** Gain/cutoff/octave now take true distance
  instead of view depth, so **stars behind you sound**, at their real distance. That is the immersive intent,
  but a `StereoPanner` cannot distinguish front from back (a star directly behind pans to centre). If the bed
  feels crowded, `AUDIBLE_N` is the knob. Wants Avery's ear.
- **Phantom sustained bed** (`b20e4d2`) — still unexplained, but §3.4 makes it more plausible than before: a
  page could previously die holding *hundreds* of unreleased bed oscillators rather than the ~30 the budget
  implied, which fits an orphaned audio-service stream better than the old accounting did. The hygiene commit
  Fable proposed (a `pagehide` `audioCtx.close()` plus release-all on flight exit) is still worth doing on
  its own merits — never rely on process death for silence.
- **`tooLarge` divisor cap is still bypassed** — `compileGridAudioProgram` passes a synthetic `ownerSolve`
  with `tooLarge:false`, so the `cull2-grid-core.js:69` guard never fires.
- **`assert-rhythm-inspector` fails, pre-existing** — the `3722ddd` Home-button rename broke an `index.html`
  structure regex (it expects `id="lrc-exit-btn"`, which no longer exists). Unrelated to any of this work,
  and it has been the sole red suite throughout.
