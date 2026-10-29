# Composer sprint 2: the Composition lens on the main page (work order, 2026-10-23)

Branch `composer-sprint-2`, cut from `composer-sprint` d4e3d76, worktree `.claude/worktrees/composer-sprint-2`. The steps run one at a time on this one branch, each a background Opus worker; the planner reviews between steps. Never `main`, never pushed. Verification is the Node suites; Avery does the browser passes.

**Deliverable for this round:** steps 1–3 built, then a PAUSE. Step 4 is not built; its recommendations, written from what the store turned out to be, go to Avery for a ruling first.

## The model (Avery agreed, 2026-10-23)

A composition is a **reading of the row**, not a second player.

- **One transport.** Play/Stop in the Playback div always controls whatever the canvas shows: the row, or its composition.
- **The magic button is a lens toggle, never a stop.** A notation glyph in the header, next to the Cosmos button.
  - It appears the moment a rhythm generates, and breathes once per session.
  - The first press on a rhythm: solve → animate → play.
  - Pressed again: back to the row, plot restored, playback stopped (planner's call, flagged to Avery).
  - Its lit state shows the lens. No separate Stop or Reset icon.
- **The five divs adapt; nothing greys out.**
  - **Playback:** layer strips become part strips (Lead, Chords, Comping, Bass, Inner, Drums), with the same row grammar (on/off, level, sound). The layer strips return with the row.
  - **Scale Selection:** locked, but alive as a readout. The current chord's tones light up bar by bar. Reuse the ProgressionBar `_lockScale` pattern.
  - **Families:** locked, with a one-line note ("the composition is choosing; return to the row to edit").
  - **Rhythm input:** generating a new rhythm returns the lens to the row and re-arms the glyph. The old rhythm's composition stays cached.
  - **Partitions:** plays only under row playback (already the rule). Under the Composition lens, the Drums part stands in for it.
- **One composition store.** The glyph, the main-canvas overlay, the part strips and the Composer window all subscribe to it.
  - It's keyed by rhythm + cycle, with an LRU of a few rhythms.
  - The window becomes an editor of the store. Whatever was made last, by glyph or by hand, is what the glyph recalls, with no re-solve.
- **The advanced Composer stays behind the double-click** (the Partitions | Composer tabs) as the store's editor.

## Step 1: the store, the lens and the main page (architecture)

1. **`Composer/store/composition-store.js`** (pure, no DOM).
   - Per rhythm key: spec, trace, drum options, progression, knob overrides, part on/level/sound, and dirty/composing flags.
   - The page-level lens: `'row' | 'composition'`.
   - Also `subscribe`, an LRU (proposed: 4 rhythms) and a single in-flight compose per key.
   - Lift what `Composer/page/tab-controller.js` and `Composer/perform/composer-controller.js` hold as page state into it. The tab becomes a view and editor over the store.
   - The lab keeps working on `composer-controller.js` as is, or on a store instance. It must not regress.
2. **Main-canvas highlights.** Under the Composition lens, the Linear Plot shows the composition's lit nodes and playhead through the existing overlay seam (`plot-overlay.js` via `LRCVisuals.setComposerOverlay`), whether the Composer window is open or not.
   - Back to the row: the plot draws exactly as before (the existing identity test).
   - Proposed: pressing the glyph on another plot type switches the canvas to the Linear Plot, and the prior type comes back with the row.
3. **The glyph** in `#title-bar` beside `#cosmos-enter-btn`.
   - A music-notation symbol (inline SVG, e.g. beamed eighths), sized like the Cosmos icon.
   - States: hidden (no rhythm) → ready (one breath glow per session) → composing (a subtle spin or shimmer) → lit (Composition lens). Hover/focus shows a tooltip ("Compose" / "Back to the row").
   - Keyboard accessible, with an aria-pressed lens state.
4. **One transport.**
   - Under the Composition lens, the main Play/Stop plays and stops the composition through the shared player (`Composer/perform/composer-player.js`), keeping the one-sound-at-a-time rule.
   - Stop keeps the composition. The glyph press back to the row stops and restores.
5. **The Playback div's part strips.**
   - Under the Composition lens, the layer strips swap for part strips that share the store's part state with the Composer window. A change in either shows in both.
   - Proposed: a small layer-colour dot on each part strip, keeping the "layers make the row; parts are read from it" link visible.
6. **Scale Selection** locked, with the live chord-tone readout; **Families** locked, with its note. Both return on the row.
7. **New rhythm or cycle** → the lens goes back to the row and the glyph re-arms. Keep the cache.
8. **Live-site bug fix:** `LRCModule.calculateTotalLCM(...activeLayers)` returns NaN with fewer than 4 layers (`lcm(x, undefined)`). Make it ignore missing layers, and add a test.
9. **Tests:**
   - the store (keys, LRU, subscribe, the lens, recall without re-solve, the window's edits showing in the glyph's recall);
   - the lens transitions;
   - transport mapping;
   - part strips ⇄ window sync;
   - scale/families lock and restore;
   - the overlay on the main canvas, and the identity with the row lens;
   - glyph states;
   - the LCM fix;
   - everything existing still passing (55 suites at d4e3d76).

## Step 2: "show the work" as theater

- During the first compose's animation for a rhythm, a scrim dims the other four divs and the header. The caption floats on the canvas, and the scrim lifts as the performance starts.
- Any click or Esc skips. This is not the browser's fullscreen API (maybe later).
- Only the first compose of a rhythm animates the full ~7.5 s. Recalling a cached composition plays a short version (proposed: ~1.5 s: root → lead → parts land) or jumps to the landing frame.
- Respect the existing "show the work" setting and `prefers-reduced-motion` (jump to the landing).
- Add a `pace` option for callers (the tutorial wants it brisker).
- **Tests:** scrim on/off and restore; skip paths; first vs cached; reduced motion; no stale draws on cancel.

## Step 3: the interactive tutorial

- Replace the text tutorial's flow (`Tutorial/TutorialUI.js`, `TutorialContent.js`, the header's "Show Tutorial") with a guided, animated one: spotlight glows, motion around the main canvas, small text popups. Keep the old content reachable (e.g. "read more").
- **Opening, about 10 s to a playing composition:**
  1. "Welcome to the Large Rhythm Collider!"
  2. "This machine eats numbers…" Spotlight the Rhythm Input. Type 4 random 3-digit layers into the real inputs (real input events, so the site's own logic runs). Valid set: no layer divides another, and the gcd of the set is 1. Check the set with the Composer's gates, so Compose never refuses it.
  3. Press Generate: "…to turn structure…" The Linear Plot appears.
  4. "…into music." Spotlight the glyph and click it. The theater animation runs at a brisk pace (the step-2 `pace` option), and the performance starts.
- **Then, while the music plays:** a short tour (the part strips in Playback, the scale readout, the advanced Composer behind the double-click, the Cosmos button, the glyph returning to the row). Each stop is skippable, Esc exits, and nothing leaves the page in a half state.
- **Structure:** a pure, data-driven script module (steps, targets, timings) plus a DOM driver.
  - The layer generator is pure and seeded for tests.
  - Proposed: first visit opens it automatically (`localStorage` behind try/catch); the header entry starts it again anytime.
- **Tests:** generator criteria over many seeds; the script's order and targets exist in `index.html`; the driver's skip/exit/restore paths over the DOM stub; the timing budget for the opening (≤ 10 s on the test rows, compose time included).

## Step 4 (DO NOT BUILD this round): the Composer window rework

To be designed after step 1, in a written recommendation for Avery:
- alternates by bar × part, mined from the trace's runner-ups and chord candidates (with the caps raised), swapped with a local re-mine of the dependent parts only;
- a typed progression field (`Cmaj7 Am7 Dm7 G7` → the nearest supported root and quality within the frame, with cent offsets and amber where unsupported);
- an editable drum step grid (S slots × voices), with the modes as presets and the two-level prime partition as a mode;
- a bar × part matrix layout with a context inspector.

The recommendation says what the store has to hold for each, what new core API each needs (e.g. a bar-local re-mine), the costs, and a build order.

## Process

- Steps 1 → 2 → 3, one worker each, sequential on `composer-sprint-2`. Commit in logical steps with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `git stash`.
- Every step: the full suite from the worktree root prints nothing:
  `for t in Composer/tests/assert-*.mjs Cosmos/tests/assert-*.mjs Audio/tests/assert-*.mjs Playback/MIDIOut.test.mjs; do node "$t" >/dev/null 2>&1 || echo FAIL $t; done`
- Every step adds a section to `Composer/DESIGN_NOTES.md` (calls marked **proposed**) and appends to the log below.
- Note: the composer-sprint worktree holds two uncommitted Cosmos fold fixes (Avery hasn't ruled on committing them). They touch only `Cosmos/` and the old ledger, so they don't block this branch.

## Log

- 2026-10-23: order written; step 1 dispatched.
- 2026-10-23: step 1 built (worker): the store (`Composer/store/composition-store.js`; the controller binds an entry), the lens, the glyph, the part strips, the Scale/Families locks and the one transport (`Composer/page/lens.js`, `toolbar-glyph.js`, `part-strips.js`, `panel-locks.js`, `composition-lens.css`), and the LCM fix. 57 suites clean (`assert-store.mjs` and `assert-page-lens.mjs` new). Calls and open questions in `DESIGN_NOTES.md`, "Composition lens and store". Seams for step 2 (lens events, `pace`) and step 3 (`lrcComposer.lens.press({ pace })`, `#composition-glyph` in `index.html`). Not seen in a browser.
- 2026-10-23: step 2 built (worker): the theater (`Composer/page/theater.js` + `theater.css`, `lrcComposer.theater`): the scrim (one `<body>` class; four panels and the header dimmed, Playback and the glyph lit) and the floating caption around a rhythm's first animated compose; any click (swallowed) or Esc skips, queued during Compose; a window opened mid-show skips. The short version for a recall or a later compose (`recallTimeline`, ~1.5 s: root → lead → parts), reduced motion and the setting off straight to the landing, `pace` on both, and a frame-loop fix (a cancel + re-press ran two loops) in `lens.js`. ProgressionBar yields the Scale chart to the lens's readout and gets it back; module cache-busting documented as not cleanly possible. 58 suites clean (`assert-page-theater.mjs` new). Calls and open questions in `DESIGN_NOTES.md`, "Theater (sprint 2, step 2)". Not seen in a browser.
- 2026-10-23: step 3 built (worker): the guided tour (`Tutorial/tour-script.js` pure, `tour-driver.js`, `tour-boot.js`, `tour.css`; `window.lrcTour`). Avery's four-line opening types a seeded set of four 3-digit layers into the real fields (an input event a digit; none dividing another, gcd 1, passing Compose's gates, biased to 12–144 tones from the 7-smooth numbers: proposed), presses the real Generate, then the glyph through `lens.press({ pace: 2 })`; the theater's scrim leads the show. Begin → playing measured at 7.6–8.2 s in Node (solve included). Then five stops while it plays (part strips, Scale readout, the advanced Composer with a peek, Cosmos, back to the row); Next/Back/Skip/Esc and the arrows; a clean exit; reduced motion; auto-open once on a first visit; the old slides kept as "Read the guide". 59 suites clean (`assert-tutorial.mjs` new, 99 checks). Calls and open questions in `DESIGN_NOTES.md`, "Interactive tutorial". Not seen in a browser.
- 2026-10-23: step 4's recommendations written (`Composer/STEP4_RECOMMENDATIONS.md`: alternates by bar × part, the typed progression field, the drum step grid, the matrix layout; costs measured, build order, open questions). **The sprint is paused here for Avery**: step 4 is not built until Avery rules on the recommendations, and steps 1–3 wait on Avery's browser pass.
- 2026-10-25: Avery took the proposed answers on all 8 step-4 questions; the step-4 order is `Composer/STEP4_ORDER.md` (not dispatched yet).
