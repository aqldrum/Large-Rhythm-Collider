# Cosmos performance rail + harmony controls — handoff, 2026-08-01

## Current state

The DENSITY experiment has been fully reverted. Cosmos is back to one globally lowest-layer-sum
representative rhythm per folded ratio. There is no ranked top-three catalog, no density-dependent row
compile, and no density value in the program cache/request key. The abundance and row compiler worker
topology is unchanged.

The visible performance rail has also been narrowed to controls with an immediate, unmistakable audible
result:

- **MUTE** button
- **PITCH** knob (the existing `fundamental` parameter, ±1200 cents; label only changed)
- **SPEED** knob
- **VOLUME** knob
- **BED/ROWS** mix knob
- **SPACE** knob

DWELL and RICHNESS remain in `railParams` and retain their engine setters, but neither renders on the
front face. DWELL is waiting to be replaced by HOLD. RICHNESS is reserved for the future harmony/back
face. The current advanced `<details>` drawer still contains MODULATION and MIDI OUT as an interim UI.

Current worktree changes are limited to:

- `cosmos/rail-view.js`
- `cosmos/rail-params.js`
- `cosmos/cosmos/assert-rail-view.mjs`
- `cosmos/COSMOS_RAIL_HARMONY_HANDOFF_2026-08-01.md` (this handoff)

Test baseline: **18/19 Cosmos assert suites pass**. The sole failure is the already-known
`assert-rhythm-inspector` markup-order assertion caused by the earlier Home/exit rename; it is unrelated
to this rail work.

## Locked design decisions

1. The front face is for live performance controls whose effect can be heard immediately.
2. Structural harmony choices belong on a second/back face of the same rail, not in a popup.
3. HOLD freezes **both the current chord and the solved root**. It does not stop the transport or row
   playheads.
4. Harmony selection is two-stage: choose a harmony source (`CHORD WALK` or `SCALE`), then choose the
   scale when `SCALE` is active.
5. Harmonic membership is expressed as octave-relative **cent targets**, never as integer semitone-only
   state. The current consonance/deviation window remains **±15 cents**.
6. RICHNESS remains a discrete vocabulary ceiling (triads / 7ths / 9ths / 11–13), not a continuous knob,
   and belongs on the harmony face when applicable.
7. The row **1/1 control is a schedule-time mute**. It must not change ratio ownership, the tuning system,
   or the compiled row program.
8. Muting 1/1 suppresses only the literal fundamental ratio. Higher octaves such as 2/1, 4/1, etc. still
   sound.
9. While literal 1/1 is muted, it is excluded from both required chord exposure and root competition.

---

## Step 3 — Replace DWELL with HOLD

Add a latched **HOLD** transport button to the front rail beside MUTE. Remove DWELL from the user-facing
control model; the existing dwell engine path may remain temporarily as an internal/debug compatibility
shim until it can be retired safely.

### Behavior contract

- Engaging HOLD snapshots and freezes both:
  - the currently sounding/selected chord;
  - the currently solved root, including its modulation offset.
- The master transport, Cull2 row playheads, envelopes, spatial field, bed/rows mix, and MIDI clock/output
  continue normally.
- Geography may continue gathering root candidates while held, but it must not install a new solved root.
- Chord exposure may continue accumulating while held, but it cannot advance the chord.
- Releasing HOLD resumes harmonic decision-making from **release time**. It must not catch up through
  missed chord/root changes or immediately advance using stale pre-hold timers.
- HOLD is transient and resets OFF on Cosmos entry; it should not persist in localStorage.
- Provide mouse/touch, keyboard, `aria-pressed`, and a clear active visual state. Reserve **H** as the
  keyboard shortcut unless it conflicts with an existing flight binding.

### Likely integration points

- `cosmos/rail-params.js`: transient boolean `hold` parameter.
- `cosmos/rail-view.js`: add HOLD to `RAIL_BUTTONS` and bind it through one shared state path.
- `cosmos/cosmos-audio.js`: a guarded hold setter/current-state probe; chord and root decision gates.
- Root/chord clock code: reset timing baselines on release so no catch-up occurs.
- Assertions: extend `assert-chord-clock`, `assert-sky-modulation`, and `assert-rail-view`.

---

## Step 4 — Build the two-face rail

Replace the interim advanced `<details>` drawer with a second face occupying the same persistent rail
panel. The front remains the performance surface; the back becomes the harmony/configuration surface.

### Front face

- MUTE
- HOLD
- PITCH
- SPEED
- VOLUME
- BED/ROWS
- SPACE
- One explicit control to open the harmony/options face

### Back face, initial contents

- Harmony source: `CHORD WALK` / `SCALE`
- Scale selector, shown only while `SCALE` is active
- RICHNESS segmented selector, shown only where the active harmony source uses chord vocabulary ceilings
- ROW 1/1 (or ROOT PULSE) toggle
- MODULATION toggle
- MIDI OUT toggle/status
- One explicit control to return to the performance face

### UI contract

- Keep one outer rail panel and switch between two ordinary DOM panels. A flip/crossfade/slide animation
  may sell the “back of the rail” metaphor, but do not use mirrored DOM or transforms that compromise
  focus order and screen-reader behavior.
- Only the active face participates in keyboard focus. Restore focus to the face-toggle control after a
  face change.
- The performance face is the default on each Cosmos entry. Face state is UI-transient, not persisted.
- Continue routing every shared setting through `railParams`; the back face must not become a second state
  owner.
- RICHNESS should use named segmented choices, not a rotary: `TRIADS · 7THS · 9THS · 11–13`.
- MIDI OUT remains transient and gesture-gated because Web MIDI permission can fail asynchronously.

### Likely integration points

- `cosmos/rail-view.js`: face container, face switch, conditional back-face controls, removal of `<details>`.
- `style.css`: same-footprint face layout and restrained transition.
- `cosmos/cosmos/assert-rail-view.mjs`: visible control sets, focus/accessibility structure, single-owner
  state wiring, and absence of the old drawer.

---

## Step 5 — Add the schedule-time ROW 1/1 mute

Add a persisted back-face toggle that suppresses literal **1/1** attacks in spatial Cull2 rows without
recompiling programs or altering ownership.

### Playback contract

- Apply the mute at schedule time in the row player. A program and its event indices remain unchanged.
- Skip only actions whose exact folded/source identity is literal `1/1` as defined by the row program.
- Do **not** suppress octave equivalents such as `2/1`, `4/1`, etc.; these are musically useful higher
  octaves of the fundamental and must continue to articulate.
- The toggle affects spatial rows only. Do not silently remove the tonic from the ambient bed unless a
  separate bed policy is explicitly designed later.
- A mid-cycle toggle takes effect on the next scheduled action without restarting, resyncing, recompiling,
  or swapping a deck.
- MIDI row output must match audible row scheduling.
- Debug/inspector readouts should distinguish “selected but 1/1-muted” from harmonically deselected.

### Exposure and root-policy corrections

- When ROW 1/1 is muted, literal 1/1 is removed from the set of degrees/tones required for full chord
  exposure. Otherwise HOLD-free automatic progression can wait forever for an intentionally silent tone.
- Literal 1/1 is also excluded from root competition while muted so the universally repeated fundamental
  cannot dominate the root solve through abundance/support.
- Higher octaves remain eligible for both sounding and competition according to their own exact ratio
  identities.
- Toggling 1/1 back on starts a fresh exposure/root-policy epoch; do not reuse a completion decision made
  against the muted requirement set.

### Likely integration points

- `cosmos/rail-params.js`: persisted boolean such as `rowFundamental` (default requires listening decision;
  preserve today's sound unless Avery explicitly chooses default OFF).
- `cosmos/spatial-grid-row-player.js`: schedule-time action predicate shared by WebAudio and MIDI.
- `cosmos/cosmos-audio.js`: exposure ledger requirement filtering.
- `cosmos/sky-root.js` / root gather policy: exact-1/1 competition filtering.
- Assertions: `assert-grid-spatial-audio`, `assert-midi-out`, `assert-chord-clock`, `assert-fullsky` or the
  root-policy suite, and `assert-rail-view`.

---

## Step 6 — Introduce general cent-target harmony policies

Refactor harmonic selection around a shared, engine-agnostic policy expressed as octave-relative cent
targets and a deviation window. Start with the modes needed to prove the contract; do not build a large
scale catalog in the first pass.

### Proposed policy shape

```js
{
  id: 'diatonic-major',
  source: 'scale',
  targets: [0, 200, 400, 500, 700, 900, 1100],
  toleranceCents: 15,
}
```

Targets are relative to the solved root and wrapped into one octave. Matching uses signed circular cent
distance. Integer semitone modes are simply cent-target presets; microtonal modes use arbitrary cents or
ratio-derived cents without changing the matcher.

### Initial modes

1. **CHORD WALK** — the existing dynamic walk, translated into cent targets (for example a major triad is
   `[0, 400, 700]`). RICHNESS continues to bound the vocabulary available to this source.
2. **CHROMATIC** — twelve 100-cent targets across the octave.
3. **DIATONIC** — begin with one clearly named seven-note preset; add major/minor or modal variants only
   after the shared path is proven.
4. Add one microtonal preset only after the first three use the same contract end-to-end.

### Engine contract

- Replace semitone-degree-only row matching with generic cent-target matching at ±15 cents.
- Put the harmony policy ID, normalized targets, root identity, and tolerance into the row program
  selection/cache key so policy changes recompile cleanly and reject late worker replies.
- Use one harmony policy across the BED/ROWS crossfade. Chord Walk and scale modes must not mean one thing
  to the bed and another to the rows.
- Decide and guard the bed articulation for static scale modes (for example a slowly changing subset or
  stable scale cluster) before presenting them as complete modes.
- Root solving, modulation, HOLD, exposure, the 1/1 mute, and MIDI must all consume the same normalized
  policy rather than independently interpreting UI selections.
- Persist harmony source, selected scale, RICHNESS, MODULATION, and the ROW 1/1 preference. Do not persist
  HOLD or MIDI-enabled state.

### Recommended implementation order

1. Add pure policy normalization, cent wrapping, circular-distance matching, and selection-key helpers
   with headless tests.
2. Express the current Chord Walk through that interface and prove schedule parity with the existing path.
3. Add Chromatic and Diatonic scale policies.
4. Bind the back-face selectors to `railParams` and the shared policy owner.
5. Define coherent bed behavior for scale policies.
6. Add the first ratio-derived/microtonal preset and prove that no semitone quantization occurs.

## Guardrails for the next thread

- Do not reintroduce a per-zone ranked ownership catalog for harmony selection.
- Do not add harmony work to the animation frame; policy changes should invalidate bounded worker work,
  while ordinary frames read already-compiled state.
- Keep `ROW_COMPILE_WORKERS = 1` until measurements—not intuition—justify changing the topology.
- Preserve the existing “old program sounds until replacement is ready” behavior on every structural
  harmony change.
- Keep the Playback firewall intact: Cosmos audio remains separate from the main LRC playback engine.
- Measure long-session CPU, retained zone count, heap growth, compile queue depth, and FPS after each step.
  The pre-existing `HIL_EVICT = 40` retention window is a known compounding risk and should be evaluated
  independently from the musical-control work.
