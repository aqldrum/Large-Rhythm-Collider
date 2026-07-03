# MIDI Out — Live DAW Control (implementation spec)

**Status:** spec finalized 2026-07-03, ready to implement. Supersedes the one-line item 5
("DAW streaming — MPE over Web MIDI") in `AdvancedPlayback/HANDOFF_quality-painting.md`
and the `CODEX_MATH_FINDINGS.md` appendix sketch: *channel-per-layer,
pitch-bend-before-note-on, portamento → continuous bend* — all preserved here, plus the
refinements agreed with Avery (hybrid legato rule, ±48 default bend range, same-note flush
guard, MPE as the "shimmer" mode).

**Goal:** the site streams its scheduled tone-row notes out of the browser over the
**Web MIDI API** so a DAW (Ableton) or synth (Omnisphere multi) plays them **in the exact
just-intonation tuning**, and **live fundamental changes — including Progression Solver
retunes — bend sounding DAW notes in real time**. Off by default, verify at the rig
(browser-side message correctness can be verified headlessly; end-to-end needs IAC + DAW).

---

## 1. Transport & tuning strategy

- **Web MIDI API** (`navigator.requestMIDIAccess({sysex:false})`). Chrome/Edge, Firefox 108+;
  no Safari — degrade gracefully (disabled button + hint). User routes via a virtual port:
  macOS IAC Driver, Windows loopMIDI.
- **Tuning = nearest MIDI note + per-channel pitch bend, bend sent BEFORE note-on.**
  Note assignment is **±50¢** (i.e. `Math.round` of the fractional MIDI number): a ratio at
  1151¢ above root maps to the octave root with a −49¢ bend, NOT the half step below.
  This matches the existing `.tun`/`.scl`/MIDI-export convention.
- **Bend range: ±48 semitones default in BOTH modes** (MPE convention; also gives retune
  headroom). 14-bit bend at ±48 resolves 0.586¢/step — far below the 3–5¢ JND, so the wide
  range costs nothing audible. Send **RPN 0 (pitch-bend sensitivity)** on every used channel
  and the **MPE Configuration Message (RPN 6)** in MPE mode so compliant receivers
  self-configure; keep the range as a visible UI number for synths that need hand-matching
  (e.g. Omnisphere's per-patch bend setting).
- Rejected alternatives, for the record: MTS sysex (poor support; Omnisphere ignores it),
  MTS-ESP (local IPC, not a wire protocol — future local-bridge project), MIDI 2.0 per-note
  pitch (Web MIDI doesn't expose it yet).

## 2. The two channel modes

The core hazard with LRC-density scales (hundreds of pitches/octave) is **note-number
collision**: microtonal neighbors quantize to the same MIDI note, and a channel holds only
one bend state. Each mode eliminates the hazard a different way — and each preserves a
different musical virtue:

### `layers` — channel-per-layer (portamento mode)
- LRC layers A–D → MIDI channels 1–4 (0-based chIdx 0–3). Each layer is already a **mono
  voice** in the engine (`activeLayerVoices`), so per-channel succession is safe by
  construction. Ideal target: Omnisphere multi with 4 parts.
- **Non-legato:** schedule each note-off ~10ms **early** (`max(10, dur*1000 − 10)`) so the
  off of note N never lands on/after the on of note N+1 at the same note number. Plus the
  **flush guard**: before any note-on, if a pending scheduled off for the *same channel +
  same note number* exists with a future timestamp, send its off immediately and cancel it.
- **Legato (engine legato toggle on) — the hybrid rule:**
  - If the next note's target pitch is **within bend headroom** of the *sounding* note's
    base MIDI number → **do not retrigger**: send only a pitch-bend update on the channel.
    The held voice slides (13¢ neighbor = 13¢ glide). This is the "portamento → continuous
    bend" behavior — microtonal neighbors get a genuinely continuous held tone.
  - If the leap **exceeds headroom** → retrigger (new note-on at ts, previous note-off at
    ts+15ms overlap; mono synths read overlap as legato transition). The engine's own
    legato also re-attacks per note, so a re-attack at big leaps matches the engine.

### `mpe` — rotating channels (shimmer mode)
- Notes rotate across member channels 2–16 (chIdx 1–15), channel 1 = MPE master. Every
  sounding note owns a private channel + private bend → collisions impossible; near-unison
  tones (Thick-voicing clusters, e.g. 16:13:11:9's 192¢+204¢) sound **independently** —
  the JI "shimmer" is preserved, and Ableton MPE tracks record per-note bends into clips.
- Allocator: round-robin over members, skip channels with a live note; if all busy, steal
  round-robin. When partitions-mirror is enabled, exclude chIdx 9 from the member pool.
- No bend-only legato here (notes hop channels); overlap legato only. Held-note retunes
  still work per-channel.

## 3. Live retune (the headline)

`ToneRowPlayback.handleFundamentalChange(glideTime)` already retunes running oscillators.
Mirror it: for the **most recent live note per channel**, recompute
`freq = fundamentalFreq × entry.ratio`, bend from the note's **original base MIDI number**,
send immediately. Dragging the Fundamental field fires `input` events continuously — that
stream IS the continuous bend; no extra ramp machinery for UI drags. Progression Solver's
root retune on Solve rides the same path. Clamp bend at range edges; notes snap true at
their next re-strike (imminent in this system). ±48 default makes clipping rare in
practice (fundamental limits 55–880 Hz span 48 semitones total).

**Addendum (Anchor Morphing):** `handleFundamentalRetune(glideSec)` must accept the glide
time and, when `glideSec > ~0.08`, emit an interpolated bend RAMP per live channel
(timestamped sends every ~30ms over the glide; cancel a channel's in-flight ramp on new
retune or note-on). Programmatic anchor swaps are single calls, not event streams — see
`AdvancedPlayback/ANCHOR_MORPH_SPEC.md` §7.

## 4. Hook points (verified against current source)

Total engine touch is ~5 small edits; everything else lives in a new
`Playback/MIDIOut.js` (singleton `window.lrcMidiOut`, constructed at script load).

1. **`ToneRowPlayback.playNoteAtTime`** (ToneRowPlayback.js ~L939) — THE choke point. After
   the mute/solo/selection checks and the `layerNoteTriggered` dispatch (~L983–988), add:
   `window.lrcMidiOut?.scheduleNote(noteData, duration, layerIndex, startTime, this.legatoEnabled);`
   Placement matters: it must sit *after* the live mute checks so MIDI mirrors exactly what
   sounds — including PaintEngine's per-stage mask swaps (PaintEngine monkey-patches
   *around* this method, so hooking inside the original inherits Quality Painting for free).
2. **`ToneRowPlayback.handleFundamentalChange`** (~L737) — right after
   `this.recalcFrequencies()`: `window.lrcMidiOut?.handleFundamentalRetune?.();`
   (place before the `!isPlaying` early-return; the mirror no-ops when nothing is live).
3. **Panic:** listen for the existing `playbackStopped` window event inside MIDIOut → no
   engine edit needed for stop.
4. **`PartitionsPlayback.triggerSample`** (PartitionsPlayback.js ~L439) — at method top
   (before the `!url` early-return, after computing nothing): 
   `window.lrcMidiOut?.schedulePartitionHit(layerIndex, time, volumeDb, this.layerTranspose[layerIndex]);`
   so a layer with no sample selected can still drive a DAW drum rack.
5. **`AudioEngine.updateMasterVolume`** (AudioEngine.js ~L76) — respect a
   `playback.midiLocalMute` flag: `const linear = this.playback.midiLocalMute ? 0 : this.dbToLinear(dbValue)`,
   for the "Mute browser synth (MIDI only)" toggle. (Partitions audio routes through
   `masterGain` too, so one flag mutes everything local.)
6. **UI:** `PlaybackMainUI.generatePlaybackHTML` gains one collapsible section (insert
   `${window.lrcMidiOut?.getSectionHTML?.() ?? ''}` after the Main section), and
   `setupMasterControls` calls `window.lrcMidiOut?.bindUI?.()`. Both pages share this
   panel, so the popout gets MIDI out for free.
7. **Script tags:** `<script src="Playback/MIDIOut.js"></script>` **before**
   `ToneRowPlayback.js` in `index.html` (~L583) and `advanced-playback.html` (~L91).

## 5. Message sequences (exact)

All sends timestamped (Web MIDI `output.send(data, ts)`) so MIDI rides the scheduler's
150ms lookahead instead of JS-timer jitter.

**Note (non-legato):**
```
@ts      E0|ch  bendLSB bendMSB     ; bend BEFORE note-on
@ts      90|ch  note  velocity
@ts+dur−10ms  80|ch  note  0        ; early off (min 10ms note length)
```

**Legato transition, within headroom (layers mode):** `E0|ch bend'` only — nothing else.

**Legato transition, beyond headroom:** new `E0`+`90` @ts, previous note's `80` @ts+15ms.

**Retune:** `E0|ch bend'` immediately, per live channel (latest note per channel only).

**Bend-range RPN per channel:** `B0|ch 101 0, B0|ch 100 0, B0|ch 6 <range>, B0|ch 38 0,
B0|ch 101 127, B0|ch 100 127`. **MPE MCM (mpe mode, master ch1):**
`B0 101 0, B0 100 6, B0 6 15`. Send on enable / device change / mode change / range change.

**Partitions hit:** ch10 (chIdx 9), notes `[36, 38, 42, 46]` per layer + layer transpose;
velocity from layer volume (−40..0 dB → 20..127); off after 100ms.

**Panic (`allNotesOff`, on `playbackStopped` / disable / device switch):**
`output.clear()` (try/catch — flushes queued future-timestamped sends), then explicit
`80` for every registry entry, then `B0|ch 123 0` + `B0|ch 120 0` on all 16 channels,
then clear registry + timers.

## 6. Load-bearing code (from the reviewed draft — reuse verbatim)

```js
// AudioContext time → Web MIDI (performance.now) timeline. getOutputTimestamp
// aligns MIDI with the audio actually HEARD (compensates output latency).
audioTimeToMidiTs(audioTime) {
    const ctx = window.toneRowPlayback?.audioContext;
    if (!ctx || !Number.isFinite(audioTime)) return performance.now();
    let perfRef = performance.now(), ctxRef = ctx.currentTime;
    const ots = ctx.getOutputTimestamp?.();
    if (ots && Number.isFinite(ots.contextTime) && Number.isFinite(ots.performanceTime)) {
        perfRef = ots.performanceTime; ctxRef = ots.contextTime;
    }
    return perfRef + (audioTime - ctxRef) * 1000;
}
// Clamp send time: ts = Math.max(performance.now(), audioTimeToMidiTs(startTimeSec))

freqToMidiFloat(freq) { return 69 + 12 * Math.log2(freq / 440); }

noteAndBend(freq) {              // ±50¢ assignment via Math.round — DO NOT floor
    const m = this.freqToMidiFloat(freq);
    const note = Math.min(127, Math.max(0, Math.round(m)));
    return { note, bend: this.bendFromSemitones(m - note) };
}

bendFromSemitones(semitones) {   // 8192 = center; clamp, never wrap
    const range = Math.max(1, this.bendRangeSemitones);
    return Math.min(16383, Math.max(0, Math.round(8192 + (semitones / range) * 8192)));
}
// bytes: [0xE0|ch, bend & 0x7F, (bend >> 7) & 0x7F]
```

**Live-note registry:** `liveNotes: [{ chIdx, note, ratio, layerIndex, onTs, offTs|null, timer }]`
— `offTs === null` means held (legato). `ratio` is `noteData.ratio` raw (can exceed 2;
`fund × ratio` matches the engine's own `recalcFrequencies`). Prune entries via setTimeout
at offTs (+60ms slack); cap registry at 128 with oldest-first eviction. Retune iterates
latest-entry-per-channel. Hybrid-legato headroom test: next pitch's `|freqToMidiFloat(f) −
heldEntry.note| ≤ bendRangeSemitones` (leave ~1-semi margin for subsequent retunes).

## 7. UI section ("MIDI Out — DAW Control", collapsible, collapsed by default)

- **Enable/Disable button** (permission prompt on first click) + status line
  (`→ IAC Driver Bus 1` / "no outputs — create a virtual port…" / not-supported hint).
- **Device select** (repopulate on `access.onstatechange`; panic before switching).
- **Mode select:** `Layer channels (A–D → ch 1–4)` | `MPE (rotating ch 2–16)`. Panic on
  change; re-send RPN/MCM.
- **Bend range** number input (1–96, default 48) — re-send RPN on change.
- **Velocity** (1–127, default 100).
- **☐ Send Partitions as drums (ch 10)**; **☐ Mute browser synth (MIDI only)**.
- Hint paragraph: match synth bend range; IAC/loopMIDI routing; fundamental retunes live.
- **Persistence:** localStorage `lrcMidiOut.v1` (all settings + enabled + preferredDeviceId).
  On load, auto-reconnect ONLY if previously enabled AND
  `navigator.permissions.query({name:'midi'})` reports `granted` (never prompt on load).
- Style: reuse `.playback-section .collapsible-section .collapse-btn .control-group
  .control-btn`; small additions (`.midi-status`, `.midi-check`, `.midi-hint`) in style.css.

## 8. Edge cases & accepted discrepancies

- **10ms early off** (non-legato): deliberate, inaudible, buys deterministic same-number sequencing.
- **Retune clipping** at bend-range edge: clamped; self-heals at next re-strike.
- **Tempo-change double-schedule** within the 150ms lookahead: same behavior as the
  oscillators today; the flush guard prevents same-note kills. Bridge voices
  (`startBridgeVoice`) are NOT mirrored to MIDI — scheduled offs already guarantee closure.
- **Muted layers / solo / scale deselection / paint masks:** inherited free via hook placement.
- **`frequency > maxFrequencyHz`** notes: engine returns before the hook → never sent. Fine.
- **Tab-hidden throttling:** sends are pre-timestamped within the lookahead window, so brief
  throttles are covered; long-term background playback follows whatever the engine does.

## 9. Verification plan

1. **Headless (implementing agent):** stub `navigator.requestMIDIAccess` with a recording
   fake port; assert per-event: bend-precedes-on ordering, ±50¢ note assignment (incl. the
   1151¢ → octave-root case), bend math at range 2/48, early-off timing, hybrid-legato
   bend-only vs retrigger branch, flush guard, MPE allocator never double-books a busy
   channel, retune sends latest-per-channel, panic sends clear+offs+CC123/120, RPN/MCM
   bytes. Run rhythm 8:7:6:5 + `Cmaj7 Am7 Dm7 G7` solve and diff the MIDI stream against
   the audible-note event log (`layerNoteTriggered`).
2. **At the rig (Avery):** IAC → Ableton: layers mode into 4-part Omnisphere multi
   (bend range matched), MPE mode into an MPE track; drag Fundamental during playback
   (hear the DAW bend); Solve & voice (hear the root retune land); Thick-voicing cluster
   shimmer check in MPE; stop button = full silence (no stuck notes); record a clip and
   confirm per-note bends round-trip.

## 10. Explicit non-goals (this pass)

MIDI clock/transport sync; MIDI input (DAW/keyboard → LRC scale); tuning-morph streaming
(voice-led glides between rhythm-scales — the architecture's continuous-bend path is
already compatible when that lands); MTS-ESP local bridge; sysex of any kind.
