// view-options.js — the VIEW section of the Cosmos help popup (between Controls and Solve queue). Pure, no
// DOM: flight-view renders the pills from VIEW_OPTIONS and routes each choice to its visual. This is the
// "future visual-options panel" constellation-core.js and chase-camera.js were written to be bound by.
//
// Persisted vs transient mirrors the rail's rule (rail-params.js): a taste you set once survives visits
// (constellations, gravity); a per-flight state resets every entry (camera starts first person — Decision 5
// of the third-person order — and CLEAN screen must never greet you with no way back to the HUD).

export const VIEW_STORAGE_KEY = 'lrc.cosmos.view.v1';

export const VIEW_OPTIONS = Object.freeze({
  constellations: Object.freeze({ label: 'Constellations', persist: true, default: 'persist',
    choices: Object.freeze([['off', 'OFF'], ['fade', 'FADE'], ['persist', 'PERSIST']]) }),
  gravity: Object.freeze({ label: 'Gravity', persist: true, default: 'hold', cubeOnly: true,
    choices: Object.freeze([['off', 'OFF'], ['hold', 'HOLD G'], ['always', 'ALWAYS']]) }),
  camera: Object.freeze({ label: 'Camera', persist: false, default: 'first', cubeOnly: true,
    choices: Object.freeze([['first', 'FIRST'], ['chase', 'CHASE']]) }),
  screen: Object.freeze({ label: 'Screen', persist: false, default: 'full',
    choices: Object.freeze([['full', 'FULL'], ['clean', 'CLEAN']]) }),
});

const isChoice = (name, value) => !!VIEW_OPTIONS[name]?.choices.some(([v]) => v === value);

// Constellation pill → the patch constellation-core's configure() takes. PERSIST is the 'chord' lifecycle
// (the figure holds until the harmony changes — today's default); FADE is 'lifespan' (each edge ages out).
export function constellationPatch(mode) {
  return { enabled: mode !== 'off', lifecycle: mode === 'fade' ? 'lifespan' : 'chord' };
}

// Is local gravity on this frame? OFF ignores G, HOLD is the classic hold-to-pull, ALWAYS needs no key.
export function gravityHeld(mode, gKeyDown) {
  return mode === 'always' || (mode === 'hold' && !!gKeyDown);
}

// The G row of the Controls list follows the pill, so the list never documents a key that does nothing.
export function gravityControlLabel(mode) {
  return mode === 'off' ? 'gravity off' : mode === 'always' ? 'gravity always on' : 'hold local gravity';
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function createViewOptions({ storage, key = VIEW_STORAGE_KEY } = {}) {
  const store = storage !== undefined ? storage : defaultStorage();
  const state = {};
  for (const [name, spec] of Object.entries(VIEW_OPTIONS)) state[name] = spec.default;
  try {
    const blob = JSON.parse(store?.getItem(key) || 'null');
    // Only persisted names with a still-legal value come back; a renamed choice falls to its default.
    if (blob && typeof blob === 'object') for (const [name, spec] of Object.entries(VIEW_OPTIONS)) {
      if (spec.persist && isChoice(name, blob[name])) state[name] = blob[name];
    }
  } catch {}
  const listeners = new Set();
  const persist = () => {
    const blob = {};
    for (const [name, spec] of Object.entries(VIEW_OPTIONS)) if (spec.persist) blob[name] = state[name];
    try { store?.setItem(key, JSON.stringify(blob)); } catch {}
  };
  const api = {
    get: name => state[name],
    getAll: () => ({ ...state }),
    // A no-op set (unknown name, illegal value, or the current value) neither persists nor notifies, so a
    // V-key → set('camera') → subscriber → setViewMode round trip terminates after one hop.
    set(name, value) {
      if (!isChoice(name, value) || state[name] === value) return state[name];
      state[name] = value;
      if (VIEW_OPTIONS[name].persist) persist();
      for (const fn of listeners) { try { fn(name, value); } catch {} }
      return value;
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Every cosmos entry: transient options back to their defaults (notifying, so the visuals follow).
    resetForEntry() {
      for (const [name, spec] of Object.entries(VIEW_OPTIONS)) if (!spec.persist) api.set(name, spec.default);
    },
  };
  return api;
}
