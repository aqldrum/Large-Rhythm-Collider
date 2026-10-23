// theater.js — "show the work" as theater on the main page (Composer sprint 2, step 2). Driven by the Composition
// lens's events (lens.js); it owns no clock and draws nothing on the canvas. Everything here is proposed, not ruled.
//
//   the scrim    a rhythm's first animated compose (the lens's 'composing' / 'animating' with short false): the page
//                gets the class `composition-theater` on <body>, and theater.css dims the HUD panels but the Playback
//                div (the one the performance takes over: "the other four divs") and the header, the glyph kept
//                lit. Nothing on the panels themselves is written, so lifting the class restores them exactly. The
//                lift (on 'skip', 'landed', 'row') fades through `composition-theater-lifting` for LIFT_MS.
//   the caption  floats on the canvas: the animation frame's label and detail (the trace's own captions), and "click
//                or Esc to skip" under the full show. It is the theater's own element, made when shown and removed
//                when hidden. The short version (a recall) gets the caption, not the scrim.
//   skips        while the scrim is up, any click on the page (but the glyph's: that one goes back to the row) skips
//                to the landing, and is swallowed so it doesn't also press what it landed on; a press there
//                (pointerdown / mousedown) is swallowed too, so no panel drag starts. Esc skips. During Compose a
//                skip is queued: the scrim lifts at once, and the compose lands straight on the landing.
//   cancels      a new rhythm, a new cycle or the glyph: the lens goes back to the row ('row'), and the scrim, the
//                caption and the listeners go with it. A window opened mid-animation (Partitions or the Expanded
//                Info View: their `visualizationOverlayStateChanged`, or the Composer tab shown) skips to the
//                landing, so the window opens on the composition playing, never on a half-drawn frame.
//
//   const t = createTheater({ doc, win, lens, timers })
//   t.up (the scrim is on) · t.captionShown · t.interrupt(reason) → whether it skipped · t.dispose()

export const THEATER_VERSION = 'composer-theater-v1';
export const THEATER_CLASS = 'composition-theater';
export const LIFTING_CLASS = 'composition-theater-lifting';
/** the lift's fade, ms (theater.css' transition) */
export const LIFT_MS = 320;
/** the panels the scrim leaves lit (proposed: the Playback div, whose strips the performance takes over) — theater.css
 *  says the same in its selectors; this is for the tests and a reader */
export const THEATER_KEEP = Object.freeze(['playback-div']);
export const CAPTION_ID = 'composition-theater-caption';
export const SKIP_HINT = 'click or Esc to skip';

export function createTheater({ doc = globalThis.document, win = globalThis.window, lens, timers = globalThis } = {}) {
  let up = false, liftTimer = null, caption = null, captionKey = null, hintShown = false;
  const body = () => doc.body;
  const inGlyph = (t) => { for (let x = t; x; x = x.parentNode) if (x.id === 'composition-glyph') return true; return false; };

  // ── the listeners while the scrim is up ──
  const swallow = (e) => { e.preventDefault?.(); e.stopPropagation?.(); e.stopImmediatePropagation?.(); };
  const onPress = (e) => { if (!inGlyph(e.target)) swallow(e); };
  const onClick = (e) => { if (inGlyph(e.target)) return; swallow(e); lens.skip(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault?.(); lens.skip(); } };
  const PRESSES = ['pointerdown', 'mousedown', 'touchstart'];

  function raise() {
    if (up) return;
    up = true;
    if (liftTimer != null) { timers.clearTimeout?.(liftTimer); liftTimer = null; }
    body()?.classList.remove(LIFTING_CLASS);
    body()?.classList.add(THEATER_CLASS);
    doc.addEventListener?.('click', onClick, true);
    for (const t of PRESSES) doc.addEventListener?.(t, onPress, true);
    doc.addEventListener?.('keydown', onKey, true);
  }
  function lower() {
    if (!up) return;
    up = false;
    doc.removeEventListener?.('click', onClick, true);
    for (const t of PRESSES) doc.removeEventListener?.(t, onPress, true);
    doc.removeEventListener?.('keydown', onKey, true);
    const b = body();
    b?.classList.remove(THEATER_CLASS);
    b?.classList.add(LIFTING_CLASS);
    liftTimer = timers.setTimeout?.(() => { liftTimer = null; if (!up) b?.classList.remove(LIFTING_CLASS); }, LIFT_MS) ?? null;
    if (liftTimer == null) b?.classList.remove(LIFTING_CLASS);
    if (caption) setHint(false);
  }

  // ── the caption, on the canvas ──
  function setHint(on) {
    if (!caption || on === hintShown) return;
    hintShown = on;
    caption.hint.textContent = on ? SKIP_HINT : '';
    caption.hint.hidden = !on;
  }
  function showCaption(frame) {
    if (!caption) {
      const box = doc.createElement('div'), label = doc.createElement('b'), detail = doc.createElement('span'), hint = doc.createElement('small');
      box.id = CAPTION_ID; box.className = 'composition-theater-caption';
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      label.className = 'composition-theater-label'; detail.className = 'composition-theater-detail'; hint.className = 'composition-theater-hint';
      hint.hidden = true;
      box.append(label, detail, hint);
      (doc.getElementById?.('lrc-main') ?? body())?.append(box);
      caption = { box, label, detail, hint }; captionKey = null; hintShown = false;
    }
    setHint(up);
    const key = `${frame.label}|${frame.detail || ''}`;
    if (key === captionKey) return;
    captionKey = key;
    caption.label.textContent = frame.label || '';
    caption.detail.textContent = frame.detail || '';
  }
  function hideCaption() { if (!caption) return; caption.box.remove(); caption = null; captionKey = null; hintShown = false; }

  // ── the lens drives it ──
  const offChange = lens.onChange((type, d = {}) => {
    if (type === 'composing') { if (d.animate && !d.short) raise(); }
    else if (type === 'animating') { if (!d.short) raise(); }
    else if (type === 'skip') { lower(); if (d.queued) hideCaption(); }
    else if (type === 'landed' || type === 'row') { lower(); hideCaption(); }
  });
  const offFrame = lens.onFrame((frame) => { if (lens.phase === 'animating') showCaption(frame); });
  // a window opened mid-show: skip to the landing (the window opens on the composition playing)
  const onOverlay = (e) => { if (e?.detail?.active) api.interrupt('window'); };
  win?.addEventListener?.('visualizationOverlayStateChanged', onOverlay);

  const api = {
    version: THEATER_VERSION,
    get up() { return up; },
    get captionShown() { return !!caption; },
    get caption() { return caption ? caption.box : null; },
    /** something else needs the page now (a window opening): skip to the landing → whether there was a show to skip */
    interrupt() { return lens.phase === 'animating' || lens.phase === 'composing' ? lens.skip() : false; },
    dispose() {
      offChange(); offFrame(); win?.removeEventListener?.('visualizationOverlayStateChanged', onOverlay);
      lower(); hideCaption();
      if (liftTimer != null) { timers.clearTimeout?.(liftTimer); liftTimer = null; }
      body()?.classList.remove(LIFTING_CLASS);
    },
  };
  return api;
}
