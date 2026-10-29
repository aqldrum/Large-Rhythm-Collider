// audition.js — STEP 4e: auditioning an alternate in the Composer window (DESIGN_NOTES "Step 4e"). No DOM.
//
//   first click    on an alternate (a chord candidate, a runner-up line) auditions it LIVE: the controller's
//                  audition(run) applies the swap. While performing it waits for the next bar boundary (it is applied
//                  LEAD_SECONDS of clock time before the boundary, so the player's 150 ms lookahead books the new bar
//                  from the new notes); stopped, it applies at once.
//   second click   on the same alternate (or Keep) keeps it: one undo step (controller.keepAudition).
//   Esc / Revert   takes it back (controller.revertAudition): the edits, and the undo and redo stacks, as they were;
//                  no redo step is left. A pending audition (not applied yet) is simply dropped.
//   another click  on another alternate while one is open replaces it (still one audition).
//
// The player itself has no bar-boundary scheduling: it reads the parts at every 25 ms tick, so an edit applied at once
// is heard within its 150 ms lookahead. The boundary is this module's: it holds the swap and applies it just before.
//
//   createAudition({ core, playhead, onChange }) → { tryAlt(key, run), keep(), revert(), tick(), settle(), state, key, pending }
//     playhead () → { t (spec seconds in the cycle), T, barStarts, factor (clock per spec second) } | null when stopped

import { waitToBoundary } from './matrix.js';

/** how long before the bar boundary (clock seconds) a held audition is applied: above the player's 150 ms lookahead */
export const LEAD_SECONDS = 0.3;

export function createAudition({ core, playhead = () => null, onChange = () => {} } = {}) {
  let pending = null;   // { key, run, label } waiting for the boundary
  let live = null;      // { key, label, result } applied, not yet kept
  let busy = Promise.resolve();
  const emit = () => onChange(api);
  const sync = () => { if (live && !core.auditioning()) live = null; };

  function fire(p) {
    pending = null;
    live = { key: p.key, label: p.label, result: null };
    const mine = live;
    const done = core.audition(p.run).then((r) => { if (live === mine) mine.result = r; emit(); return r; }, (err) => { if (live === mine) live = null; emit(); return { ok: false, error: String(err?.message ?? err) }; });
    busy = done;
    emit();
    return done;
  }
  /** is a held audition due? (stopped: always; performing: within LEAD_SECONDS of the next bar start) */
  function due() {
    const at = playhead();
    if (!at) return true;
    return waitToBoundary(at.t, at.barStarts, at.T) * (at.factor || 1) <= LEAD_SECONDS;
  }

  const api = {
    /** 'idle' | 'pending' (held for the bar boundary) | 'live' (applied, not kept) */
    get state() { sync(); return pending ? 'pending' : live ? 'live' : 'idle'; },
    /** the alternate being auditioned (pending or live), or null */
    get key() { sync(); return pending?.key ?? live?.key ?? null; },
    get pending() { return pending; },
    get live() { sync(); return live; },
    /** the last applied audition's result ({ changedBars, retunedBars, … }) */
    get result() { return live?.result ?? null; },
    /** an alternate clicked: key names it, run () → the controller action that applies it → Promise */
    tryAlt(key, run, label = '') {
      sync();
      if ((live && live.key === key && !pending) || (pending && pending.key === key)) return api.keep();
      const p = { key, run, label };
      if (due()) return fire(p);
      pending = p;
      emit();
      return Promise.resolve({ ok: true, pending: true });
    },
    /** keep it (a held one is applied first) → Promise */
    keep() {
      sync();
      const first = pending ? fire(pending) : busy;
      if (!live) return Promise.resolve({ ok: false, empty: true });
      live = null;
      return Promise.resolve(first).then(() => core.keepAudition()).then((r) => { emit(); return r; });
    },
    /** take it back → Promise */
    revert() {
      sync();
      if (pending && !live) { pending = null; emit(); return Promise.resolve({ ok: true, dropped: true }); }
      pending = null;
      if (!live) return Promise.resolve({ ok: false, empty: true });
      live = null;
      return busy.then(() => core.revertAudition()).then((r) => { emit(); return r; });
    },
    /** per animation frame: apply a held audition when its boundary comes (or playback stopped) */
    tick() { if (pending && due()) fire(pending); },
    /** another edit is about to be made: an open audition is kept first (proposed) → Promise */
    settle() { sync(); return pending || live ? api.keep() : Promise.resolve(null); },
    /** forget it without touching the controller (a Compose or a new rhythm took over) */
    reset() { pending = null; live = null; },
  };
  return api;
}
