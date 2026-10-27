// part-strips.js — the Playback div under the Composition lens (sprint 2, step 1): the layer strips swap for part
// strips, in the same row grammar. The layer strips are a row of A–D buttons over one layer's controls (Mute, Sound,
// Volume); the part strips are a row of the six parts (Lead, Chords, Comping, Bass, Inner, Drums) over the picked
// part's controls (Mute, Sound — the drum pattern for the drums — and Level). They are a view of the composition store's
// current entry, through the shared controller, exactly as the Composer window's lanes and inspector are: a change in
// either shows in both (a level through the controller's onLevel, everything else through onChange). Picking a part
// here picks it in the window too (its inspector, and the ring on the plot).
//
// Each part button carries a small dot in the colour of the layer it leans on (proposed): the layer that strikes most
// of the part's lit onsets on the plot (LRCModule's layer map), so "layers make the row; parts are read from it"
// stays visible. The layer strips come back exactly as they were with the row (their elements are only hidden).
// A part playing as an arpeggio (COMP_ARP_ORDER.md B3) is named so: "Lead · arp", "Inner · arp".
//
//   dominantLayer(indices, layerMap) → 'A'..'D' | null     (pure)
//   stripRows({ parts, drums, levels, highlights, layerMap }) → the strips as data (pure)
//   createPartStrips({ doc, tab, highlights, layerMap }) → { enter(), leave(), update(), frame(), shown, root }

import { PART_COLORS, PART_LABELS, HIGHLIGHT_PARTS } from './plot-highlights.js';
import { soundChoices, drumModeChoices } from '../perform/composer-controller.js';

export const LAYER_COLORS = Object.freeze({ A: '#ff6b6b', B: '#4ecdc4', C: '#00a638', D: '#f9ca24' });
export const STRIPS_CLASS = 'composition-part-strips';
/** what the Layer Controls header says under the lens (proposed) */
export const PARTS_HEADER = 'Part Controls';

/** the layer that strikes most of these plotted onsets (ties: the earlier layer) */
export function dominantLayer(indices, layerMap) {
  if (!indices || !indices.length || !layerMap) return null;
  const n = { A: 0, B: 0, C: 0, D: 0 };
  for (const i of indices) for (const L of layerMap[i] || []) if (L in n) n[L]++;
  let best = null;
  for (const L of ['A', 'B', 'C', 'D']) if (n[L] > 0 && (best == null || n[L] > n[best])) best = L;
  return best;
}

/** the six strips as data: { id, label (B3: "Lead · arp" while it plays an arpeggio), color, has, arp, enabled, level, sound, layer } */
export function stripRows({ parts = {}, drums = null, drumOptions = {}, levels = {}, highlights = null, layerMap = null } = {}) {
  return HIGHLIGHT_PARTS.map((id) => {
    const isDrums = id === 'drums', p = isDrums ? drums : parts[id];
    const h = highlights?.parts?.[id];
    return {
      id, label: `${PART_LABELS[id]}${!isDrums && p?.arp ? ' · arp' : ''}`, color: PART_COLORS[id], has: !!p, arp: !isDrums && !!p?.arp,
      enabled: isDrums ? (drums ? drums.enabled !== false : drumOptions.enabled !== false) : p ? p.enabled !== false : true,
      level: levels[id] ?? 0.8,
      sound: isDrums ? drumOptions.mode ?? 'backbeat' : p?.sound ?? null,
      layer: h ? dominantLayer(h.indices, layerMap) : null,
    };
  });
}

/**
 * createPartStrips({ doc, tab, highlights, layerMap })
 *   tab         tab-controller.js (its core acts on the store's current entry; its view's selection is shared)
 *   highlights  () → the lit nodes on the plot now (tab.highlights of the plot), or null
 *   layerMap    () → LRCModule's layer map (an array a plotted onset: the layers striking it)
 */
export function createPartStrips({ doc = globalThis.document, tab, highlights = () => null, layerMap = () => null } = {}) {
  const core = tab.core;
  const sounds = soundChoices(), drumModes = drumModeChoices();
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
  let root = null, shown = false, hiddenEls = [], header = null, headerText = null, levelEl = null, levelOut = null;

  const host = () => doc.getElementById?.('layer-controls-content') ?? null;
  const pct = (v) => `${Math.round(Number(v) * 100)}%`;

  function render() {
    if (!root) return;
    const s = tab.state, selected = tab.view.selected;
    const rows = stripRows({ parts: s.parts, drums: s.drums, drumOptions: s.drumOptions, levels: s.levels, highlights: highlights(), layerMap: layerMap() });
    const toggles = el('div', { className: 'playback-layer-toggles part-strip-toggles' }, ...rows.map((r) => {
      const b = el('button', { className: `playback-layer-btn part-strip-btn${r.id === selected ? ' active' : ''}${r.enabled ? '' : ' off'}`, textContent: r.label, title: `${r.label}${r.layer ? `: read mostly from layer ${r.layer}` : ''}` });
      b.dataset.part = r.id;
      b.style.borderColor = r.color;
      if (r.layer) { const dot = el('span', { className: 'part-strip-layer', title: `layer ${r.layer}` }); dot.style.background = LAYER_COLORS[r.layer]; dot.dataset.layer = r.layer; b.append(dot); }
      b.addEventListener('click', () => tab.select(r.id));
      return b;
    }));
    const r = rows.find((x) => x.id === selected) ?? rows[0];
    const title = el('h4', { textContent: `${r.label}` });
    title.style.color = r.color;
    const mute = el('button', { className: `control-btn part-strip-mute${r.enabled ? '' : ' active'}`, textContent: 'Mute', title: 'play this part or not (live)', disabled: !r.has });
    mute.addEventListener('click', () => (r.id === 'drums' ? core.setDrums({ enabled: !r.enabled }) : core.setPart(r.id, { enabled: !r.enabled })));
    const isDrums = r.id === 'drums';
    const sound = el('select', { className: 'part-strip-sound', disabled: !r.has, title: isDrums ? 'the drum mode, or a curated pattern (live)' : 'its sound (Audio/voices): live' },
      ...(isDrums ? drumModes.map((m) => el('option', { value: m.id, textContent: m.label })) : sounds.map((x) => el('option', { value: x.id, textContent: x.label }))));
    if (r.sound != null) sound.value = r.sound;
    sound.addEventListener('change', () => (isDrums ? core.setDrums({ mode: sound.value }) : core.setPart(r.id, { sound: sound.value })));
    levelEl = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: r.level, className: 'part-strip-level', title: 'level (live)' });
    levelEl.dataset.part = r.id;
    levelOut = el('div', { className: 'range-value part-strip-level-value', textContent: pct(r.level) });
    levelEl.addEventListener('input', () => { core.setLevel(r.id, levelEl.value); });
    const status = s.status === 'composing' ? 'composing…' : !r.has ? 'nothing to play yet' : '';
    root.replaceChildren(
      toggles,
      el('div', { className: 'part-strip-controls' },
        el('div', { className: 'layer-control-header' }, title, el('div', { className: 'layer-control-buttons' }, mute)),
        el('div', { className: 'oscillator-controls' },
          el('div', { className: 'control-group' }, el('label', { textContent: isDrums ? 'Pattern' : 'Sound' }), sound),
          el('div', { className: 'control-group' }, el('label', { textContent: 'Level' }), levelEl, levelOut)),
        status ? el('div', { className: 'part-strip-status', textContent: status }) : null,
        // the hint is Details' (the Composer window's toggle; CLEAN_MIDI_ORDER.md C5)
        tab.view?.details ? el('div', { className: 'part-strip-note', textContent: 'Parts are read from the row; the dot is the layer each leans on. The full Composer is behind a double-click on the Playback header.' }) : null));
  }

  core.onLevel((id, value) => {
    if (!shown || !levelEl || levelEl.dataset.part !== id) return;
    if (doc.activeElement !== levelEl) levelEl.value = value;
    if (levelOut) levelOut.textContent = pct(value);
  });

  return {
    get shown() { return shown; },
    get root() { return root; },
    enter() {
      const box = host();
      if (!box || shown) return;
      shown = true;
      // the layer strips step aside (only hidden: they come back exactly as they were)
      hiddenEls = Array.from(box.children).filter((c) => !c.classList.contains(STRIPS_CLASS)).map((c) => ({ c, display: c.style.display }));
      for (const { c } of hiddenEls) c.style.display = 'none';
      header = doc.querySelector?.('.layer-controls-header') ?? null;
      if (header) { headerText = header.textContent; header.textContent = PARTS_HEADER; }
      root ??= el('div', { className: STRIPS_CLASS });
      if (root.parentNode !== box) box.append(root);
      root.style.display = '';
      render();
    },
    leave() {
      if (!shown) return;
      shown = false;
      if (root) { root.style.display = 'none'; root.replaceChildren(); }
      for (const { c, display } of hiddenEls) c.style.display = display ?? '';
      hiddenEls = [];
      if (header && headerText != null) header.textContent = headerText;
      header = null; headerText = null; levelEl = null; levelOut = null;
    },
    update() { if (shown) render(); },
    frame() {},
  };
}
