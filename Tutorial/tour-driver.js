// tour-driver.js — the guided tour's DOM driver (Composer sprint 2, step 3): it plays tour-script.js on the page with
// a spotlight (a glowing ring around the step's target, the rest of the page dimmed), a small popup beside it, and
// motion (the glide between targets, a press ripple, a double-click hint). Everything here that isn't the order's is
// proposed, not ruled. Nothing has been seen in a browser yet.
//
//   the opening   real typing: each layer field is focused, cleared and typed a digit at a time, every change an
//                 `input` event (then a `change`), so the site's own state runs; then the real Generate button is
//                 clicked (its form submits: the HUD sorts and generates); then the glyph is pressed through
//                 lrcComposer.lens.press({ pace }) at the tour's pace.
//   the theater   while its scrim is up (lrcComposer.theater.up) the scrim leads: the tour yields (spotlight and popup
//                 hidden, and nothing of the tour can be clicked), because a click on the page then skips the show.
//                 The tour never dispatches a click while the scrim is up: it presses the glyph through the lens.
//   the tour      each stop waits for Next (the music plays meanwhile). Back goes to the stop before, never back into
//                 the opening. Skip (the opening's "Skip ▸") hurries the opening: the beats go, the typing finishes at
//                 once, and the show is skipped to the landing. Esc, or ×, ends the tour at any point.
//   the lens      if it goes back to the row during the tour (the glyph, a new rhythm), a stop that needs the
//                 composition gives way to the last stop, whose text follows the lens.
//   clean exit    whatever the tour opened it closes: a minimized panel or a collapsed Playback section it opened
//                 (but the Playback div while the composition plays: its transport is there), the Composer window
//                 if it opened during the Composer stop (and the window's remembered tab), the half-typed layers
//                 (restored when Generate wasn't pressed yet). The lens is left wherever it is.
//   motion        prefers-reduced-motion: no glide, no pulse, no ripple (the root carries `lrc-tour--still`); the
//                 theater itself jumps to the landing (step 2).
//
//   const tour = createTour({ win, doc, composer, timers, raf, motion, storage, seed })
//   tour.start() · tour.begin() · tour.next() · tour.back() · tour.skip() · tour.end(reason) · tour.togglePeek()
//   tour.active · tour.stepId · tour.index · tour.layers · tour.root · tour.popup · tour.onEvent(fn) → unsubscribe
//     events: 'start' · 'step' (id) · 'typed' (layers) · 'generate' · 'press' (pace) · 'landed' (phase) · 'end' (reason)

import { STEPS, OPENING_TIMING, TOUR_PACE, generateLayers, nextIndex, backIndex, stepIndex, stepText, progressLabel, markSeen } from './tour-script.js';

export const TOUR_DRIVER_VERSION = 'lrc-tour-driver-v1';
export const TOUR_ROOT_ID = 'lrc-tour';
export const STILL_CLASS = 'lrc-tour--still';
export const YIELD_CLASS = 'lrc-tour--yield';
export const TYPING_CLASS = 'lrc-tour-typing';
export const LAYER_INPUT_IDS = Object.freeze(['layer-a', 'layer-b', 'layer-c', 'layer-d']);
/** the spotlight's margin around its target, px; the viewport gutter for the popup, px; the popup's gap, px */
export const SPOT_PAD = 6, GUTTER = 16, POP_GAP = 14;
/** a ripple lasts this long; the double-click hint repeats this often (ms) */
export const RIPPLE_MS = 700, DOUBLE_CLICK_EVERY_MS = 2400, DOUBLE_CLICK_GAP_MS = 170;

/** may the page move? false under prefers-reduced-motion (a matchMedia that throws, or none: it may) */
export function motionAllowed(win) {
  try { return !win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return true; }
}

/** where the popup goes beside a target rect, clamped into the viewport (pure) → { left, top } */
export function placePopup(rect, where, size, viewport) {
  const { width: pw, height: ph } = size, { width: vw, height: vh } = viewport;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let x = cx - pw / 2, y = cy - ph / 2;
  if (where === 'below') { y = rect.top + rect.height + POP_GAP; if (y + ph > vh - GUTTER) y = rect.top - POP_GAP - ph; }
  else if (where === 'above') { y = rect.top - POP_GAP - ph; if (y < GUTTER) y = rect.top + rect.height + POP_GAP; }
  else if (where === 'right') { x = rect.left + rect.width + POP_GAP; y = rect.top; if (x + pw > vw - GUTTER) x = rect.left - POP_GAP - pw; }
  else if (where === 'left') { x = rect.left - POP_GAP - pw; y = rect.top; if (x < GUTTER) x = rect.left + rect.width + POP_GAP; }
  else if (where === 'top') { y = rect.top + 72; }
  else if (where === 'bottom') { y = rect.top + rect.height - ph - 24; }
  const clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
  return { left: Math.round(clamp(x, GUTTER, vw - GUTTER - pw)), top: Math.round(clamp(y, GUTTER, vh - GUTTER - ph)) };
}

export function createTour({
  win = globalThis.window, doc = win?.document, composer = () => win?.lrcComposer ?? null, timers = win, raf = (f) => win?.requestAnimationFrame?.(f),
  motion = () => motionAllowed(win), storage = null, seed = () => (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0,
  timing = OPENING_TIMING, pace = TOUR_PACE, steps = STEPS,
} = {}) {
  const listeners = new Set();
  const emit = (type, detail) => { for (const f of [...listeners]) { try { f(type, detail); } catch (err) { globalThis.console?.warn?.('tour: listener failed', err); } } };
  let active = false, index = -1, token = null, els = null, revealed = [], inputsBefore = null, generatePressed = false;
  let layers = null, aimAt = null, peek = null, stopWindow = null, returnFocus = null, loopGen = 0, placedKey = '';
  let motionTimers = [], offLens = null, offReady = null, still = false, lastYield = false;

  const lens = () => composer()?.lens ?? null;
  const lensMode = () => lens()?.mode ?? 'row';
  const theaterUp = () => !!composer()?.theater?.up;
  const step = () => (index >= 0 ? steps[index] : null);
  const firstStop = () => steps.findIndex((s) => s.phase === 'tour');
  const inPage = (el) => !!el && !!(doc.body?.contains?.(el) || doc.documentElement?.contains?.(el));
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };

  // ── the page: selectors, rects ──
  /** a selector, scoped by its first part ("#playback-div .info-header" is that panel's own header) */
  function resolve(sel) {
    const parts = String(sel).trim().split(/\s+/);
    let scope = doc;
    for (let i = 0; i < parts.length - 1; i++) { scope = scope?.querySelector?.(parts[i]) ?? null; if (!scope) return null; }
    return scope.querySelector?.(parts[parts.length - 1]) ?? null;
  }
  const rectOf = (e) => { try { return e.getBoundingClientRect(); } catch { return null; } };
  const shown = (e) => { const r = inPage(e) ? rectOf(e) : null; return !!r && (r.width > 0 || r.height > 0); };
  /** the first of these selectors on the page and shown */
  const firstShown = (sels) => { for (const s of sels || []) { const e = resolve(s); if (e && shown(e)) return e; } return null; };
  const viewport = () => ({ width: Number(win?.innerWidth) || 1280, height: Number(win?.innerHeight) || 800 });
  /** a touch screen: the tour types without focusing the fields (a focus would raise the on-screen keyboard) */
  const coarse = () => { try { return !!win?.matchMedia?.('(pointer: coarse)')?.matches; } catch { return false; } };
  /** the HUD's mobile layout stacks the panels in a scrolling page: bring the target into view */
  function bringIntoView(s) {
    if (!doc.body?.classList?.contains('mobile-mode')) return;
    const t = firstShown(s.targets);
    try { t?.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' }); } catch { /* an old scrollIntoView: fine */ }
  }

  // ── the overlay ──
  function build() {
    const spot = el('div', { className: 'lrc-tour-spot' });
    spot.setAttribute('aria-hidden', 'true');
    const progress = el('span', { className: 'lrc-tour-progress' });
    const close = el('button', { className: 'lrc-tour-close', type: 'button', textContent: '×' });
    close.setAttribute('aria-label', 'End the tour');
    close.addEventListener('click', () => api.end('close'));
    const title = el('h3', { className: 'lrc-tour-title' }); title.id = 'lrc-tour-title';
    const text = el('p', { className: 'lrc-tour-text' }); text.id = 'lrc-tour-text';
    const actions = el('div', { className: 'lrc-tour-actions' });
    const pop = el('div', { className: 'lrc-tour-pop' }, el('div', { className: 'lrc-tour-head' }, progress, close), title, text, actions);
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'false');
    pop.setAttribute('aria-labelledby', 'lrc-tour-title');
    pop.setAttribute('aria-describedby', 'lrc-tour-text');
    pop.setAttribute('tabindex', '-1');
    const root = el('div', { className: `lrc-tour${still ? ` ${STILL_CLASS}` : ''}` }, spot, pop);
    root.id = TOUR_ROOT_ID;
    doc.body.append(root);
    els = { root, spot, pop, progress, close, title, text, actions };
  }
  function button(label, action, { primary = false, disabled = false } = {}) {
    const b = el('button', { className: `lrc-tour-btn${primary ? ' primary' : ''}`, type: 'button', textContent: label });
    b.setAttribute('data-tour-action', action);
    b.disabled = disabled;
    b.addEventListener('click', () => { if (!b.disabled) act(action); });
    return b;
  }
  function act(action) {
    if (action === 'begin') api.begin();
    else if (action === 'later') api.end('later');
    else if (action === 'guide') { api.end('guide'); win?.LRCTutorialSlidesUI?.show?.(); }
    else if (action === 'skip') api.skip();
    else if (action === 'next') api.next();
    else if (action === 'back') api.back();
    else if (action === 'done') api.end('done');
    else if (action === 'peek') api.togglePeek();
  }

  /** the popup for the current step */
  function render() {
    const s = step();
    if (!els || !s) return;
    els.root.dataset.step = s.id;
    els.progress.textContent = progressLabel(index, { steps });
    els.title.textContent = s.title;
    els.text.textContent = stepText(s, lensMode());
    const b = [];
    if (s.id === 'welcome') {
      b.push(button('Begin', 'begin', { primary: true }), button('Not now', 'later'));
      const guide = button('or read the guide', 'guide'); guide.className = 'lrc-tour-link'; b.push(guide);
    } else if (s.phase === 'opening') {
      b.push(button('Skip ▸', 'skip', { primary: true, disabled: !!token?.fast }));
    } else {
      b.push(button('◀ Back', 'back', { disabled: backIndex(index, { lens: lensMode(), steps }) === index }));
      if (s.peek && win?.partitionsUI) b.push(button(win.partitionsUI.isActive ? 'Close the window' : 'Peek inside', 'peek'));
      if (s.last) b.push(button('Read the guide', 'guide'), button('Done', 'done', { primary: true }));
      else b.push(button('Next ▸', 'next', { primary: true }));
    }
    els.actions.replaceChildren(...b);
  }
  const primary = () => els?.actions?.querySelector?.('.lrc-tour-btn.primary') ?? null;
  function focusPopup() { const p = primary(); if (p && !p.disabled) p.focus?.(); else els?.pop?.focus?.(); }

  /** the spotlight and the popup follow the target (a frame loop while the tour is on: panels move, windows open) */
  function place() {
    if (!els) return;
    const up = theaterUp();
    if (up !== lastYield) { lastYield = up; els.root.classList.toggle(YIELD_CLASS, up); els.root.setAttribute('aria-hidden', String(up)); }
    const s = step();
    if (!s) return;
    const target = peekShown() ? firstShown(['#expanded-playback-view']) : firstShown(aimAt || s.targets);
    const vp = viewport();
    const r = target ? rectOf(target) : { left: vp.width / 2, top: vp.height / 2, width: 0, height: 0 };
    const where = peekShown() ? 'bottom' : aimAt ? s.thenPlace || s.place : s.place;
    const pr = rectOf(els.pop) || { width: 300, height: 120 };
    const p = placePopup(r, where, { width: pr.width || 300, height: pr.height || 120 }, vp);
    const key = [r.left, r.top, r.width, r.height, p.left, p.top, !!target].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join(',');
    if (key === placedKey) return;
    placedKey = key;
    const st = els.spot.style;
    els.spot.classList.toggle('none', !target);
    if (target) { st.left = `${Math.round(r.left - SPOT_PAD)}px`; st.top = `${Math.round(r.top - SPOT_PAD)}px`; st.width = `${Math.round(r.width + 2 * SPOT_PAD)}px`; st.height = `${Math.round(r.height + 2 * SPOT_PAD)}px`; }
    els.pop.style.left = `${p.left}px`; els.pop.style.top = `${p.top}px`;
  }
  function loop(gen) { if (!active || gen !== loopGen) return; place(); raf(() => loop(gen)); }

  // ── motion ──
  const later = (fn, ms) => { const id = timers.setTimeout?.(fn, ms); motionTimers.push(id); return id; };
  function clearMotion() { for (const id of motionTimers) timers.clearTimeout?.(id); motionTimers = []; els?.spot?.classList?.remove?.('lrc-tour-orbit'); }
  /** a ripple at the centre of e (none under reduced motion) */
  function ripple(e) {
    if (still || !els || !e) return;
    const r = rectOf(e); if (!r) return;
    const dot = el('span', { className: 'lrc-tour-ripple' });
    dot.setAttribute('aria-hidden', 'true');
    dot.style.left = `${Math.round(r.left + r.width / 2)}px`; dot.style.top = `${Math.round(r.top + r.height / 2)}px`;
    els.root.append(dot);
    later(() => dot.remove(), RIPPLE_MS);
  }
  function startMotion(s) {
    clearMotion();
    if (still || !s) return;
    if (s.motion === 'orbit') els.spot.classList.add('lrc-tour-orbit');
    if (s.motion === 'double-click') {
      const twice = () => { if (!active || step() !== s || peekShown()) return; const t = firstShown(s.targets); ripple(t); later(() => ripple(t), DOUBLE_CLICK_GAP_MS); later(twice, DOUBLE_CLICK_EVERY_MS); };
      later(twice, 500);
    }
  }

  // ── panels the tour opens (and closes again) ──
  function reveal(s) {
    for (const sel of s?.reveal || []) {
      const e = resolve(sel);
      if (!e || revealed.some((r) => r.el === e)) continue;
      if (e.classList.contains('panel') && e.classList.contains('minimized')) {
        const b = e.querySelector('.minimize-btn');
        if (b) { b.click(); revealed.push({ kind: 'panel', el: e, btn: b }); }
      } else if (e.classList.contains('collapse-content') && e.style.display === 'none') {
        const b = doc.querySelector(`.collapse-btn[data-target="${e.id}"]`);
        if (b) { b.click(); revealed.push({ kind: 'collapse', el: e, btn: b }); }
      }
    }
  }
  function unreveal() {
    for (const r of revealed.reverse()) {
      try {
        if (r.kind === 'panel') {
          if (r.el.id === 'playback-div' && lensMode() === 'composition') continue;   // its transport plays the music
          if (!r.el.classList.contains('minimized')) r.btn.click();
        } else if (r.el.style.display !== 'none') r.btn.click();
      } catch (err) { globalThis.console?.warn?.('tour: restoring a panel failed', err); }
    }
    revealed = [];
  }

  // ── the Composer window (the Composer stop) ──
  const partitions = () => win?.partitionsUI ?? null;
  const peekShown = () => !!peek && !!partitions()?.isActive;
  function enterStopWindow(s) { stopWindow = s?.peek ? { wasActive: !!partitions()?.isActive } : null; }
  /** leaving the Composer stop: a window opened during it is closed, and its remembered tab put back */
  function leaveStopWindow() {
    const p = partitions();
    if (stopWindow && p && !stopWindow.wasActive && p.isActive) { try { p.hide(); } catch (err) { globalThis.console?.warn?.('tour: closing the window failed', err); } }
    if (peek && p) p.activeTab = peek.tab;
    peek = null; stopWindow = null;
  }

  // ── the step machine ──
  function go(i) {
    if (!active || i < 0 || i >= steps.length) return;
    const was = step();
    if (was?.peek) leaveStopWindow();
    clearMotion();
    index = i; aimAt = null; placedKey = '';
    const s = steps[i];
    enterStopWindow(s);
    render();
    reveal(s);
    bringIntoView(s);
    place();
    startMotion(s);
    if (s.phase === 'tour' || s.id === 'welcome') focusPopup();
    emit('step', s.id);
  }

  // ── the opening ──
  const sleep = (ms, tk) => new Promise((resolve) => {
    if (tk.cancelled || tk.fast || !(ms > 0)) { resolve(); return; }
    let id = null;
    const wake = () => { tk.wakers.delete(wake); if (id != null) timers.clearTimeout?.(id); resolve(); };
    tk.wakers.add(wake);
    id = timers.setTimeout(wake, ms);
  });
  const wakeAll = (tk) => { for (const w of [...tk.wakers]) w(); };
  /** an event on the window, or the timeout, or the token cancelled → whether the event came */
  const waitFor = (type, ms, tk) => new Promise((resolve) => {
    let id = null;
    const done = (ok) => { win.removeEventListener?.(type, onEv); tk.wakers.delete(onCancel); if (id != null) timers.clearTimeout?.(id); resolve(ok); };
    const onEv = () => done(true), onCancel = () => { if (tk.cancelled) done(false); };
    win.addEventListener?.(type, onEv);
    tk.wakers.add(onCancel);
    id = timers.setTimeout(() => done(false), ms);
  });
  function inputEvent(data, inputType) {
    const C = win?.InputEvent || win?.Event;
    try { return new C('input', { bubbles: true, inputType, data }); } catch { return new win.Event('input', { bubbles: true }); }
  }
  function setTyped(input, value, inputType, data) { input.value = value; input.dispatchEvent(inputEvent(data, inputType)); }

  async function typeLayers(values, tk) {
    inputsBefore = LAYER_INPUT_IDS.map((id) => { const i = doc.getElementById(id); return i ? i.value : null; });
    for (let k = 0; k < LAYER_INPUT_IDS.length; k++) {
      const input = doc.getElementById(LAYER_INPUT_IDS[k]);
      if (!input) continue;
      if (tk.cancelled) return false;
      if (!coarse()) input.focus?.();
      input.classList.add(TYPING_CLASS);
      try {
        setTyped(input, '', 'deleteContentBackward', null);
        await sleep(timing.clearMs, tk);
        const digits = String(values[k] ?? '');
        for (let c = 1; c <= digits.length; c++) {
          if (tk.cancelled) return false;
          setTyped(input, digits.slice(0, c), 'insertText', digits[c - 1]);
          await sleep(timing.charMs, tk);
        }
        if (tk.cancelled) return false;
        input.dispatchEvent(new win.Event('change', { bubbles: true }));
      } finally { input.classList.remove(TYPING_CLASS); }
      if (k < LAYER_INPUT_IDS.length - 1) await sleep(timing.fieldGapMs, tk);
    }
    const focused = doc.activeElement;
    if (focused && LAYER_INPUT_IDS.includes(focused.id)) focused.blur?.();
    return !tk.cancelled;
  }
  /** the Composer's module may still be loading: wait for it a while */
  function composerReady(tk) {
    if (composer()) return Promise.resolve(composer());
    return waitFor('lrccomposerready', timing.composerWaitMs, tk).then(() => composer());
  }
  /** the composition lands (or the lens goes back to the row) → the phase */
  function landing(l, tk) {
    if (l.phase === 'landed') return Promise.resolve('landed');
    return new Promise((resolve) => {
      const off = l.onChange((type) => { if (type === 'landed' || type === 'row') { off(); tk.wakers.delete(onCancel); resolve(type === 'landed' ? 'landed' : 'idle'); } });
      const onCancel = () => { if (tk.cancelled) { off(); tk.wakers.delete(onCancel); resolve('idle'); } };
      tk.wakers.add(onCancel);
    });
  }

  async function opening(tk) {
    // "This machine eats numbers…"
    go(stepIndex('numbers'));
    await sleep(timing.readMs, tk); if (tk.cancelled) return;
    const g = generateLayers(seed());
    layers = g.layers;
    if (!(await typeLayers(layers, tk))) return;
    emit('typed', layers);
    await sleep(timing.afterTypeMs, tk); if (tk.cancelled) return;
    // "…to turn structure…": the real Generate
    go(stepIndex('structure'));
    const gen = resolve('#rhythm-form .submit-btn') || firstShown(steps[stepIndex('structure')].targets);
    await sleep(timing.generateAimMs, tk); if (tk.cancelled) return;
    const generated = waitFor('rhythmGenerated', timing.generateTimeoutMs, tk);
    ripple(gen);
    generatePressed = true;
    gen?.click?.();
    emit('generate');
    await generated; if (tk.cancelled) return;
    aimAt = steps[index].then || null; placedKey = '';
    await sleep(timing.plotBeatMs, tk); if (tk.cancelled) return;
    // "…into music.": the glyph, through the lens (never a page click: the theater's scrim is about to go up)
    go(stepIndex('music'));
    const c = await composerReady(tk); if (tk.cancelled) return;
    const l = c?.lens;
    if (!l) { go(stepIndex('row')); return; }
    await sleep(timing.glyphAimMs, tk); if (tk.cancelled) return;
    ripple(resolve('#composition-glyph'));
    let phase;
    if (l.mode === 'composition') phase = await landing(l, tk);   // pressed by hand meanwhile
    else {
      const pressed = l.press({ pace });
      emit('press', pace);
      if (tk.fast) l.skip?.();   // hurried: straight to the landing (queued while Compose runs)
      phase = await pressed;   // 'landed' once the performance starts; 'idle' if it went back to the row
    }
    if (tk.cancelled || !active) return;
    emit('landed', phase);
    token = null;
    go(phase === 'landed' ? nextIndex(stepIndex('music'), { lens: lensMode(), steps }) : stepIndex('row'));
  }

  // ── keys ──
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault?.(); api.end('esc'); return; }
    if (!els?.pop?.contains?.(doc.activeElement)) return;
    if (e.key === 'ArrowRight') { e.preventDefault?.(); api.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault?.(); api.back(); }
  }
  const onResize = () => { placedKey = ''; place(); };

  function subscribeLens() {
    const l = lens();
    if (!l || offLens) return;
    offLens = l.onChange((type) => {
      const s = step();
      if (!active || !s || s.phase !== 'tour') return;
      if (type === 'row' && s.needs === 'composition') go(stepIndex('row'));
      else if (type === 'row' || type === 'landed') render();   // the text follows the lens
    });
  }

  const api = {
    version: TOUR_DRIVER_VERSION,
    get active() { return active; },
    get index() { return index; },
    get stepId() { return step()?.id ?? null; },
    get layers() { return layers ? [...layers] : null; },
    get root() { return els?.root ?? null; },
    get popup() { return els?.pop ?? null; },
    get revealed() { return revealed.map((r) => r.el.id); },
    get still() { return still; },
    get hurried() { return !!token?.fast; },
    /** open the tour on its welcome (again, if it is on) */
    start() {
      if (active) api.end('restart');
      if (!doc?.body) return false;
      active = true; index = -1; revealed = []; inputsBefore = null; generatePressed = false; layers = null; peek = null; stopWindow = null;
      still = !motion(); lastYield = false; placedKey = '';
      markSeen(storage);
      returnFocus = doc.activeElement ?? null;
      win?.LRCTutorialSlidesUI?.hide?.();
      build();
      doc.addEventListener?.('keydown', onKey);
      win?.addEventListener?.('resize', onResize);
      subscribeLens();
      if (!offLens) { const h = () => subscribeLens(); win?.addEventListener?.('lrccomposerready', h); offReady = () => win?.removeEventListener?.('lrccomposerready', h); }
      const gen = ++loopGen;
      raf(() => loop(gen));
      emit('start');
      go(stepIndex('welcome'));
      return true;
    },
    /** "Begin": the opening runs */
    begin() {
      if (!active || step()?.id !== 'welcome') return false;
      const tk = (token = { cancelled: false, fast: false, wakers: new Set() });
      opening(tk).catch((err) => { globalThis.console?.warn?.('tour: the opening failed', err); if (active && token === tk) { token = null; go(stepIndex('row')); } });
      return true;
    },
    /** the opening: hurry it. A stop: the next one */
    skip() {
      if (!active) return false;
      const s = step();
      if (s?.phase === 'opening' && s.id !== 'welcome' && token) {
        if (token.fast) return false;
        token.fast = true; wakeAll(token);
        const l = lens();
        if (l && (l.phase === 'composing' || l.phase === 'animating')) l.skip?.();
        render();
        return true;
      }
      return api.next();
    },
    next() {
      if (!active) return false;
      const s = step();
      if (!s) return false;
      if (s.id === 'welcome') return api.begin();
      if (s.phase === 'opening') return api.skip();
      const j = nextIndex(index, { lens: lensMode(), steps });
      if (j < 0) { api.end('done'); return true; }
      go(j);
      return true;
    },
    back() {
      if (!active || step()?.phase !== 'tour') return false;
      const j = backIndex(index, { lens: lensMode(), steps });
      if (j === index) return false;
      go(j);
      return true;
    },
    /** open the Composer window on its Composer tab, or close it (the Composer stop) */
    togglePeek() {
      const p = partitions(), s = step();
      if (!active || !p || !s?.peek) return false;
      if (p.isActive) { p.hide(); if (peek) p.activeTab = peek.tab; peek = null; }
      else { peek = { tab: p.activeTab ?? 'partitions' }; p.show(); p.setActiveTab?.('composer'); }
      placedKey = ''; render(); place(); focusPopup();
      return true;
    },
    /** end the tour, leaving the page as it was but for the rhythm and the lens */
    end(reason = 'exit') {
      if (!active) return false;
      active = false;
      const tk = token; token = null;
      if (tk) { tk.cancelled = true; wakeAll(tk); }
      if (!generatePressed && inputsBefore) {
        LAYER_INPUT_IDS.forEach((id, k) => { const i = doc.getElementById(id); if (i && inputsBefore[k] != null) { i.value = inputsBefore[k]; i.classList.remove(TYPING_CLASS); } });
      }
      if (step()?.peek) leaveStopWindow();
      peek = null; stopWindow = null;
      unreveal();
      clearMotion();
      loopGen++;
      doc.removeEventListener?.('keydown', onKey);
      win?.removeEventListener?.('resize', onResize);
      offLens?.(); offLens = null; offReady?.(); offReady = null;
      els?.root?.remove();
      els = null; index = -1; aimAt = null;
      const f = returnFocus; returnFocus = null;
      if (f && inPage(f) && typeof f.focus === 'function') f.focus();
      emit('end', reason);
      return true;
    },
    onEvent(f) { listeners.add(f); return () => listeners.delete(f); },
  };
  return api;
}
