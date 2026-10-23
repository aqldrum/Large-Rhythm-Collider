// panel-locks.js — Scale Selection and Consonance Families under the Composition lens (sprint 2, step 1). Nothing greys
// out: both are locked, and both come back as they were with the row.
//
//   Scale Selection  locked, but alive as a readout: the rows of the current chord's tones light up bar by bar as
//                    the composition plays; stopped, every tone the composition plays is lit (proposed). The lock is
//                    ProgressionBar's `_lockScale` pattern — a class on the chart, its section and the Partitions
//                    window's copy, rows painted by toggling their classes (no rebuild, no write to the selection, so
//                    the row's own playback state is untouched) — with its own class, `composition-locked`, so the two
//                    locks never undo each other. Restored: the chart is rebuilt from the playback's own selection.
//   Families         locked, with a one-line note: "the composition is choosing; return to the row to edit".
//
//   chordTonesByBar(spec, parts) → [Set(fraction)] a bar: the chord voices' tones that bar, and its root (pure)
//   compositionTones(spec, parts) → Set(fraction): every tone any part plays (pure)
//   scaleRowsFor(available, fractions) → Set of the scale's own spellings (exact, else the nearest within ½¢) (pure)
//   barAt(spec, t) → the bar sounding at spec time t (pure)
//   createScaleLock({ doc, tab, playback }) · createFamiliesLock({ doc }) → { enter(), leave(), update(), frame(at) }

export const LOCK_CLASS = 'composition-locked';
export const FAMILIES_NOTE = 'the composition is choosing; return to the row to edit';
export const NOTE_CLASS = 'composition-lock-note';
/** the cents within which a Composer tone is a scale row's when the spellings differ (proposed) */
export const SPELLING_CENTS = 0.5;

/** a fraction's cents ('7/4' → 968.8…), or NaN */
export function fractionCents(f) {
  const [a, b] = String(f).split('/').map(Number);
  return a > 0 && b > 0 ? 1200 * Math.log2(a / b) : NaN;
}
/** the tones a bar's chord sounds: the chord voices' notes in that bar, and the chord's root */
export function chordTonesByBar(spec, parts) {
  if (!spec || spec.refused) return [];
  const bars = spec.knobs.bars, out = Array.from({ length: bars }, () => new Set());
  const chords = (parts || spec.parts).find((p) => p.id === 'chords');
  for (const n of chords?.notes ?? []) if (n.bar >= 0 && n.bar < bars && n.ratio) out[n.bar].add(n.ratio);
  spec.chords.forEach((c, k) => { if (c && c.rootTone && out[k]) out[k].add(c.rootTone); });
  return out;
}
/** every tone the composition plays (the parts that are on) */
export function compositionTones(spec, parts) {
  const out = new Set();
  if (!spec || spec.refused) return out;
  for (const p of parts || spec.parts) if (p.enabled !== false) for (const n of p.notes) if (n.ratio) out.add(n.ratio);
  for (const c of spec.chords) if (c?.rootTone) out.add(c.rootTone);
  return out;
}
/** the scale's own spellings of these tones */
export function scaleRowsFor(available, fractions) {
  const out = new Set(), list = available || [];
  const exact = new Set(list.map((r) => r.fraction));
  for (const f of fractions) {
    if (exact.has(f)) { out.add(f); continue; }
    const c = fractionCents(f);
    let best = null, gap = SPELLING_CENTS;
    for (const r of list) { const d = Math.abs((r.cents ?? fractionCents(r.fraction)) - c); if (d <= gap) { gap = d; best = r.fraction; } }
    if (best) out.add(best);
  }
  return out;
}
/** the bar sounding at spec time t (seconds from the composition's downbeat) */
export function barAt(spec, t) {
  const starts = spec?.timeline?.barStarts;
  if (!starts || !starts.length || !(t >= 0)) return 0;
  let k = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t + 1e-9) k = i;
  return k;
}

/**
 * The Scale Selection readout.
 *   tab       tab-controller.js (the current entry: its spec and parts as they play now)
 *   playback  () → window.toneRowPlayback (its availableRatios, updateScaleDisplay, updateSelectedNotesCount)
 */
export function createScaleLock({ doc = globalThis.document, tab, playback = () => globalThis.window?.toneRowPlayback ?? null } = {}) {
  let shown = false, lastKey = null, locked = [];
  const containers = () => ['scale-chart-container', 'partitions-scale-container'].map((id) => doc.getElementById?.(id)).filter(Boolean);
  function lock(on) {
    for (const el of locked) el.classList.remove(LOCK_CLASS);
    locked = [];
    if (!on) return;
    for (const c of containers()) {
      locked.push(c);
      const section = c.closest?.('.collapse-content') ?? c.parentElement;
      if (section && c.id === 'scale-chart-container') locked.push(section);
    }
    for (const el of locked) el.classList.add(LOCK_CLASS);
  }
  /** light the rows of `fractions`; the count says what they are */
  function paint(fractions, label) {
    const rows = containers().flatMap((c) => [...c.querySelectorAll('.scale-row')]);
    const lit = scaleRowsFor(playback()?.availableRatios, fractions);
    for (const row of rows) {
      const on = lit.has(row.getAttribute('data-ratio'));
      row.classList.toggle('note-selected', on);
      row.classList.toggle('note-deselected', !on);
    }
    for (const el of [...(doc.querySelectorAll?.('[data-scale-count]') ?? [])]) el.textContent = label(lit.size);
    return { rows: rows.length, lit: lit.size };
  }
  function show(at, force = false) {
    const s = tab.state, spec = s.spec && !s.spec.refused ? s.spec : null;
    if (!spec) { if (force || lastKey !== 'none') { lastKey = 'none'; paint(new Set(), () => 'composing…'); } return; }
    const parts = tab.core.currentParts(), playing = !!at;
    const bar = playing ? barAt(spec, at.t) : null;
    // repaint on a new bar, a new composition or parts, or a chart rebuilt under it
    const firstRow = containers()[0]?.querySelector?.('.scale-row') ?? null;
    const key = [spec, s.parts, bar, firstRow];
    if (!force && lastKey && Array.isArray(lastKey) && lastKey.every((v, i) => v === key[i])) return;
    lastKey = key;
    if (playing) {
      const ch = spec.chords[bar];
      paint(chordTonesByBar(spec, parts)[bar] ?? new Set(), (n) => `${n} in ${ch?.name ?? 'the chord'} · bar ${bar + 1}`);
    } else paint(compositionTones(spec, parts), (n) => `${n} in the composition`);
  }
  return {
    get shown() { return shown; },
    enter() { if (shown) return; shown = true; lastKey = null; lock(true); show(null, true); },
    leave() {
      if (!shown) return;
      shown = false; lastKey = null;
      lock(false);
      // the chart back as the row's own selection draws it
      const pb = playback();
      pb?.updateScaleDisplay?.();
      pb?.updateSelectedNotesCount?.();
    },
    update() { if (shown) show(tab.state.status === 'playing' ? tab.playheadAt() : null, true); },
    frame(at) { if (shown) show(at); },
    paint,
  };
}

/** Consonance Families: locked, with its note */
export function createFamiliesLock({ doc = globalThis.document } = {}) {
  let shown = false, notes = [], locked = [];
  return {
    get shown() { return shown; },
    enter() {
      if (shown) return;
      shown = true;
      for (const id of ['interconsonance-families-content', 'partitions-families-container']) {
        const box = doc.getElementById?.(id);
        if (!box) continue;
        box.classList.add(LOCK_CLASS); locked.push(box);
        if (id === 'interconsonance-families-content') {
          const note = doc.createElement('div');
          note.className = NOTE_CLASS; note.textContent = FAMILIES_NOTE;
          box.insertBefore(note, box.firstChild); notes.push(note);
        }
      }
    },
    leave() {
      if (!shown) return;
      shown = false;
      for (const b of locked) b.classList.remove(LOCK_CLASS);
      for (const n of notes) n.remove();
      locked = []; notes = [];
    },
    update() {},
    frame() {},
  };
}
