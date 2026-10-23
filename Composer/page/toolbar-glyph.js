// toolbar-glyph.js — the Composition lens's glyph in the main page's header, beside the Cosmos button (sprint 2,
// step 1). A notation symbol (beamed eighths, inline SVG), no text on the button: a lens toggle, never a stop.
//
//   hidden     no rhythm on the page yet (the `hidden` attribute)
//   ready      a rhythm: press to compose (or recall) it. The first time it appears in a session it breathes once
//              (the class `glyph-breathe`, a few seconds; sessionStorage remembers it, every access wrapped)
//   composing  the lens is on and Compose runs or is animated (a subtle shimmer)
//   lit        the Composition lens: the canvas shows the composition
// aria-pressed is the lens (true under the composition); the tooltip (data-tip, aria-label) says "Compose" or "Back
// to the row", and why a rhythm couldn't be composed when it couldn't. It is a <button>, so Enter and Space press it.
//
// index.html carries the button (#composition-glyph), so a tutorial can find it; on a page without one (a test), the
// glyph makes its own and puts it before the Cosmos button.
//   createToolbarGlyph({ doc, lens, session, timers }) → { el, render(), state, breathed }

export const GLYPH_ID = 'composition-glyph';
export const BREATH_KEY = 'lrc.composer.glyphBreathed';
/** how long the class stays on for the one breath (the CSS animation is shorter) */
export const BREATH_MS = 2600;
/** beamed eighths: two heads, two stems, one beam (24 × 24, currentColor) */
export const GLYPH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="glyph-stems" d="M9.2 17.2V6.6M20 15.2V4.6"></path>'
  + '<path class="glyph-beam" d="M9.2 6.6 20 4.6v2.7L9.2 9.3Z"></path>'
  + '<ellipse cx="6.6" cy="17.4" rx="2.7" ry="1.95" transform="rotate(-22 6.6 17.4)"></ellipse>'
  + '<ellipse cx="17.4" cy="15.4" rx="2.7" ry="1.95" transform="rotate(-22 17.4 15.4)"></ellipse></svg>';

const defaultSession = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };
const breathedIn = (session) => { try { return session?.getItem?.(BREATH_KEY) === '1'; } catch { return false; } };
const markBreathed = (session) => { try { session?.setItem?.(BREATH_KEY, '1'); } catch { /* storage refused: it breathes once a page */ } };

export function createToolbarGlyph({ doc = globalThis.document, lens, session = defaultSession(), timers = globalThis } = {}) {
  let el = doc.getElementById?.(GLYPH_ID) ?? null;
  if (!el) {
    el = doc.createElement('button');
    el.id = GLYPH_ID;
    el.setAttribute('type', 'button');
    el.className = 'composition-glyph';
    el.innerHTML = GLYPH_SVG;
    const cosmos = doc.getElementById?.('cosmos-enter-btn');
    if (cosmos?.parentNode) cosmos.parentNode.insertBefore(el, cosmos);
    else doc.body?.append?.(el);
  }
  let state = null, breathed = breathedIn(session), breathTimer = null;

  function breathe() {
    if (breathed) return;
    breathed = true;
    markBreathed(session);
    el.classList.add('glyph-breathe');
    breathTimer = timers.setTimeout?.(() => { el.classList.remove('glyph-breathe'); breathTimer = null; }, BREATH_MS) ?? null;
  }
  function render() {
    const next = lens.glyph(), tip = lens.tip();
    el.hidden = next === 'hidden';
    el.dataset.state = next;
    el.dataset.tip = tip || '';
    el.setAttribute('aria-pressed', String(lens.mode === 'composition'));
    el.setAttribute('aria-label', tip || 'Compose');
    el.classList.toggle('lit', next === 'lit');
    el.classList.toggle('composing', next === 'composing');
    el.classList.toggle('refused', next === 'ready' && !!lens.refusal);
    if (next === 'ready' && state !== 'ready') breathe();
    state = next;
  }
  el.addEventListener('click', (e) => { e?.preventDefault?.(); lens.press(); });
  lens.onChange(() => render());
  render();
  return {
    el,
    render,
    get state() { return state; },
    get breathed() { return breathed; },
    get breathing() { return el.classList.contains('glyph-breathe'); },
    dispose() { if (breathTimer) timers.clearTimeout?.(breathTimer); },
  };
}
