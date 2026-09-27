// constellation-core.js — the pure state machine behind the note constellation (Order B of
// Cosmos/docs/COSMOS_NOTE_VISUALS_WORK_ORDER_2026-09-20.md). Successive notes landing on DIFFERENT grids
// chain into a figure; a grid already in the figure re-sounds (its orb still flashes) but draws no new line
// and does not move the tip. How long the figure lasts is the LIFECYCLE option: held until the chord
// changes (default), or each edge fading on its own clock.
//
// Deliberately headless: no canvas, no DOM, no audio-clock reads, no positions, no projection. It is handed
// an ALREADY-ORDERED list of REACHED attacks plus a clock value, and answers with the edges that should
// exist. Whoever knows where a grid *is* stays outside: flight-view owns `placed` and does the rule-5
// ordering with it; grid-row-constellation.js owns the canvas. That keeps this file testable under bare Node.

// ONE options object for the whole order, with defaults — the future "visual options" panel binds to this
// rather than hunting scattered literals (see the work order's "Direction of travel"). `enabled` is read by
// flight-view and `drawIn` by the renderer; the core itself consumes `lifecycle`, `lifespan` and `fade`. They
// live together anyway so there is exactly one thing to bind, one thing to log and one thing to tune by eye.
export const CONSTELLATION_DEFAULTS = {
  enabled: true,
  lifecycle: 'chord',   // 'chord' = the figure holds until the harmony changes; 'lifespan' = edges age out
  lifespan: 3.0,   // 'lifespan' only: seconds an edge lives, measured from the ATTACK that drew it
  fade: 0.6,       // seconds of fade-out — a lifespan's tail, a chord change's flush, and a departure's too
  drawIn: 0.1,     // seconds for a fresh edge to grow from the tip to its target (RENDERER reads this)
};

// Draw-cost ceilings. A figure lives as long as its stars stay LOADED (rule 6), so it is no longer held to
// the ~20-star row field: flying drags a trail of connected stars behind the player until the chord turns
// over or the trail's stars are evicted. That is bounded by the loaded field, but a long held chord spent
// wandering one region could still join hundreds of stars, and every drawn edge costs two gradient strokes.
// Past FIGURE_CEILING the OLDEST structural edge departs (fades out), so only a pathological session ever
// sees it — a normal flight's trail is well under it.
export const CONSTELLATION_FIGURE_CEILING = 160;
// A *departed* edge lingers for `fade` seconds purely as a visual, outside the structure. A chord change
// departs a whole figure at once, so this sits a full figure above the structural ceiling; it exists only so
// a pathological churn rate cannot grow the draw list without bound. This project has a history of slow
// leaks — the cheap ceilings are worth the lines.
const GHOST_CEILING = CONSTELLATION_FIGURE_CEILING + 64;

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

// ── lifecycle policies ───────────────────────────────────────────────────────────────────────────────
// A policy maps one edge to visibility 0..1 from its own age; 0 means dead, and the sweep then actually
// drops it. `options.lifecycle` picks one by name — the future visual-options panel is a selector over
// CONSTELLATION_LIFECYCLES.
//
// CHORD (Avery, 2026-09-23 — the default): an edge never ages out. The whole figure is held until the
// harmony changes, then flushed at once by admit() below, so the lines trace every note the rows sounded
// under one chord. Bounded without a lifespan: the structure is a forest over the loaded stars, capped at
// CONSTELLATION_FIGURE_CEILING, and a flush turns it into ghosts that fade over `fade` seconds.
export function chordHold() { return 1; }

// LIFESPAN (Avery's decision, 2026-09-20): an edge lives `lifespan` seconds from its attack, spending the
// last `fade` seconds fading out. Self-rate-limiting by construction — a connected grid cannot take a new
// edge, so edge births cannot exceed about stars/lifespan per second however dense the music gets.
export function lifespanFade(edge, now, options) {
  const life = options.lifespan > 0 ? options.lifespan : 0;
  const age = now - edge.bornAt;
  if (age < 0) return 1;          // born at a sub-frame-future attack time; it is simply not old yet
  if (age >= life) return 0;
  const fade = Math.min(options.fade > 0 ? options.fade : 0, life);
  const holdFor = life - fade;
  if (age <= holdFor) return 1;
  return fade > 0 ? clamp01((life - age) / fade) : 0;
}

const LIFECYCLES = { chord: chordHold, lifespan: lifespanFade };
export const CONSTELLATION_LIFECYCLES = Object.keys(LIFECYCLES);

// Rule 6's fade. A departed edge is already non-structural (the chain split the instant its grid was
// evicted, or the chord changed under it); this only governs how long the ghost remains visible. Kept OUT of
// the policy function so that swapping the lifecycle policy can never change what happens when a star leaves.
function departureFade(edge, now, options) {
  if (edge.departedAt === null) return 1;
  const fade = options.fade > 0 ? options.fade : 0;
  if (!(fade > 0)) return 0;
  return clamp01(1 - (now - edge.departedAt) / fade);
}

function visibility(state, edge, now) {
  const policy = LIFECYCLES[state.options.lifecycle] || chordHold;
  return Math.min(policy(edge, now, state.options), departureFade(edge, now, state.options));
}

// An edge's two ends stop being held by it. A grid whose count reaches zero is DELETED from the map, not
// left at 0 — that is both the "edgeless grid is eligible again" rule and the reason the map cannot grow.
function releaseEnds(state, edge) {
  for (const grid of [edge.from, edge.to]) {
    const held = (state.vertices.get(grid) || 0) - 1;
    if (held > 0) state.vertices.set(grid, held);
    else state.vertices.delete(grid);
  }
}

function holdEnds(state, edge) {
  for (const grid of [edge.from, edge.to]) state.vertices.set(grid, (state.vertices.get(grid) || 0) + 1);
}

// Past the draw-cost ceiling: the oldest structural edge departs at `at` (the attack that overflowed it).
// Only reached once edges.length exceeds the ceiling, so the scan is off the steady-state path.
function trimOldest(state, at) {
  let structural = 0;
  for (const edge of state.edges) if (edge.departedAt === null) structural++;
  if (structural <= CONSTELLATION_FIGURE_CEILING) return;
  const oldest = state.edges.find(edge => edge.departedAt === null);
  oldest.departedAt = at;
  releaseEnds(state, oldest);
}

// The chord changed: every structural edge departs at `at` — the new harmony's first attack, so the old
// figure begins fading on the note that ended it — and the tip clears so that note seeds the next figure.
function flush(state, at) {
  for (const edge of state.edges) {
    if (edge.departedAt !== null) continue;
    edge.departedAt = at;
    releaseEnds(state, edge);
  }
  state.tip = null; state.tipHz = 0;
}

// Drop everything that has faded to nothing. Called at the head of ingest/retain/edges, so expired edges
// and departed vertices really leave the collections rather than merely being filtered out at draw time.
function sweep(state, now) {
  let ghosts = 0, dead = 0;
  const kept = [];
  for (const edge of state.edges) {
    if (visibility(state, edge, now) <= 0) {
      dead++;
      if (edge.departedAt === null) releaseEnds(state, edge);   // structural death by age frees its two ends
      continue;
    }
    if (edge.departedAt !== null) ghosts++;
    kept.push(edge);
  }
  if (!dead && ghosts <= GHOST_CEILING) return;                  // steady state: no reallocation at all
  state.edges = ghosts <= GHOST_CEILING ? kept
    // Oldest ghosts first: `edges` is append-ordered, so the earliest ghosts encountered are the eldest.
    : kept.filter(edge => { if (ghosts > GHOST_CEILING && edge.departedAt !== null) { ghosts--; return false; } return true; });
}

const inFigure = (state, grid) => state.vertices.has(grid) || state.tip === grid;

// ── coincidence ordering (rule 5) ────────────────────────────────────────────────────────────────────
// Pure, and separated from the state machine because it needs POSITIONS, which the core must not own.
// The group member nearest the current tip connects first and becomes the tip; then the member nearest
// THAT grid, and so on through the group. Distance is squared 3D distance between camera-relative world
// positions, which is invariant under camera rotation AND translation (both ends shift by the same vector),
// so the figure's shape does not change as the player turns or flies. A member already in the figure is
// emitted in place but never moves the head (rule 3). With no tip, the group seeds at its lowest grid
// number; grid number also breaks exact distance ties, and stands in when a position is unavailable.
function squaredDistance(positionOf, a, b) {
  const pa = positionOf ? positionOf(a) : null, pb = positionOf ? positionOf(b) : null;
  if (!pa || !pb) return Infinity;   // unplaced end: rank last, then let the grid-number tie-break decide
  const dx = pa[0] - pb[0], dy = pa[1] - pb[1], dz = pa[2] - pb[2];
  return dx * dx + dy * dy + dz * dz;
}

export function chainCoincidentAttacks(group, tip, positionOf, isInFigure) {
  const remaining = (group || []).slice();
  if (remaining.length < 2) return remaining;
  const joined = new Set();   // grids this walk has already put in the figure — the figure evolves mid-group
  const settled = grid => joined.has(grid) || (isInFigure ? !!isInFigure(grid) : false);
  const out = [];
  let head = (tip === null || tip === undefined) ? null : tip;
  if (head === null) {
    let pick = -1;
    for (let i = 0; i < remaining.length; i++) {
      if (settled(remaining[i].id)) continue;
      if (pick < 0 || remaining[i].id < remaining[pick].id) pick = i;
    }
    if (pick < 0) return remaining;   // every member is already in the figure; nothing here will move a tip
    const seed = remaining.splice(pick, 1)[0];
    out.push(seed); joined.add(seed.id); head = seed.id;
  }
  while (remaining.length) {
    let pick = -1, best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d2 = squaredDistance(positionOf, head, remaining[i].id);
      if (pick < 0 || d2 < best || (d2 === best && remaining[i].id < remaining[pick].id)) { pick = i; best = d2; }
    }
    const next = remaining.splice(pick, 1)[0];
    out.push(next);
    if (!settled(next.id)) { joined.add(next.id); head = next.id; }
    // else: rule 3 — an already-connected member re-sounds inside the group without moving the head.
  }
  return out;
}

// ── the machine ──────────────────────────────────────────────────────────────────────────────────────
// Vertices are unique and a grid can only take an edge while it is NOT in the figure, so every birth adds
// exactly one new vertex: the structure is a forest, edges ≤ vertices − 1 ≤ loaded stars − 1, and the
// draw-cost ceiling above trims the oldest edge if a figure ever outgrows it.
export function createConstellation(options) {
  const state = {
    options: { ...CONSTELLATION_DEFAULTS, ...(options || null) },
    harmonyKey: null,       // the harmony the current figure was drawn under (opaque; see admit)
    tip: null,
    tipHz: 0,
    edges: [],              // living edges, append-ordered (oldest first); ≤ FIGURE_CEILING structural + ghosts
    vertices: new Map(),    // grid → count of living STRUCTURAL edges touching it (ghosts never counted)
  };

  return {
    get options() { return state.options; },
    get tip() { return state.tip; },
    get tipHz() { return state.tipHz; },

    // Merge a patch into the one options object and hand back the result (the dev handle echoes it).
    configure(patch) {
      if (patch) for (const key of Object.keys(CONSTELLATION_DEFAULTS)) {
        if (patch[key] === undefined) continue;
        if (key === 'lifecycle' && !LIFECYCLES[patch[key]]) continue;   // an unknown name keeps the current one
        state.options[key] = patch[key];
      }
      return state.options;
    },

    inFigure(grid) { return inFigure(state, grid); },

    // The CHORD lifecycle's gate, run on each coincident group BEFORE rule-5 chaining, so the chain is
    // ordered against the figure as it stands after any flush. `harmonyKey` is the harmony in force now;
    // each attack carries the key of the row program that sounded it. Both are opaque strings to the core.
    //  • The first attack sounded under a NEW harmony flushes the figure at that attack's time, and seeds
    //    the next figure. Rows reach a new chord a little after the walk decides it (programs recompile,
    //    then wait for a switch boundary), so keying on the note — not the decision — keeps the flush on
    //    the beat where the new chord is actually heard in the rows.
    //  • Until then, attacks under the figure's own harmony keep extending it: the old chord is still what
    //    the rows are sounding.
    //  • Afterwards, stragglers still sounding the old harmony draw nothing (their orbs still flash), so a
    //    figure only ever joins notes of one chord.
    // An untagged attack always belongs to the figure. Under 'lifespan' this passes the group through,
    // only tracking the harmony so a switch back to 'chord' continues the figure instead of flushing it.
    admit(group, harmonyKey) {
      if (!group || !group.length || !harmonyKey) return group || [];
      if (state.options.lifecycle !== 'chord') { state.harmonyKey = harmonyKey; return group; }
      if (state.harmonyKey !== harmonyKey) {
        const arrival = group.find(attack => attack.harmonyKey === harmonyKey);
        if (arrival) { flush(state, arrival.when); state.harmonyKey = harmonyKey; }
      }
      return group.filter(attack => attack.harmonyKey == null || attack.harmonyKey === state.harmonyKey);
    },

    // Feed REACHED attacks, already ordered (rule 5 is flight-view's job — it has the positions). Feeding
    // a batch here is identical to feeding the same attacks one at a time: every attack is an independent
    // fold step, and `now` only drives the sweep, which is idempotent within a frame.
    ingest(orderedAttacks, now) {
      sweep(state, now);
      for (const attack of orderedAttacks || []) {
        const grid = attack?.id;
        if (!Number.isFinite(grid)) continue;
        const hz = attack.hz > 0 ? attack.hz : 0;
        const bornAt = Number.isFinite(attack.when) ? attack.when : now;
        if (state.tip === null) { state.tip = grid; state.tipHz = hz; continue; }   // rule 1: seed, no line
        if (grid === state.tip) {
          // Rule 3 on the tip itself: no line, tip unmoved. The colour DOES refresh — the next edge drawn
          // from here is a record of the melodic step, and the freshest note actually heard at the tip is
          // the honest source pitch. A pitchless attack never overwrites a good colour.
          if (hz) state.tipHz = hz;
          continue;
        }
        if (state.vertices.has(grid)) continue;   // rule 3: already connected — flash the orb, draw nothing
        // Rule 2: one edge tip → grid, frozen with the pitches of the step that made it (fromHz/toHz do
        // not track a later re-sounding; live detune is folded in at DRAW time, not here).
        const edge = { from: state.tip, to: grid, fromHz: state.tipHz, toHz: hz, bornAt, departedAt: null };
        state.edges.push(edge);
        holdEnds(state, edge);
        state.tip = grid; state.tipHz = hz;
        if (state.edges.length > CONSTELLATION_FIGURE_CEILING) trimOldest(state, bornAt);
      }
    },

    // Rule 6. `liveIds` is the set of grids still LOADED this frame — a Set, a Map (anything with .has) or
    // an array. It is deliberately NOT the row field: a star that stops sounding keeps its lines, which fade
    // with distance exactly as the star does and leave only when the star itself is evicted (Avery,
    // 2026-09-23 — the figure should outlast a fly-by). An edge with an end outside the set splits the chain
    // immediately — it stops being structural at once, freeing its other end to take a new edge — and
    // merely fades out as a ghost. We never bridge the gap: a line no note caused is a lie. A null/undefined
    // `liveIds` means "no membership information this frame" and is a no-op, so a gap in the feed cannot
    // tear the figure down.
    retain(liveIds, now) {
      sweep(state, now);
      if (!liveIds) return;
      const live = typeof liveIds.has === 'function' ? grid => liveIds.has(grid) : grid => liveIds.includes(grid);
      for (const edge of state.edges) {
        if (edge.departedAt !== null) continue;
        if (live(edge.from) && live(edge.to)) continue;
        edge.departedAt = now;
        releaseEnds(state, edge);
      }
      if (state.tip !== null && !live(state.tip)) { state.tip = null; state.tipHz = 0; }   // next new grid re-seeds
    },

    // Draw list. `fade` is 0..1 lifecycle visibility; the renderer multiplies it by endpoint fog.
    edges(now) {
      sweep(state, now);
      const out = [];
      for (const edge of state.edges) {
        const fade = visibility(state, edge, now);
        if (fade <= 0) continue;
        out.push({ from: edge.from, to: edge.to, fromHz: edge.fromHz, toHz: edge.toHz, bornAt: edge.bornAt, fade });
      }
      return out;
    },

    reset() {
      state.harmonyKey = null;
      state.tip = null; state.tipHz = 0;
      state.edges = [];
      state.vertices.clear();
    },

    // Real collection sizes, for the guard and for eyeballing in the console. Not a copy of a counter —
    // these read the live structures, so a leak would show here.
    stats() {
      let ghosts = 0;
      for (const edge of state.edges) if (edge.departedAt !== null) ghosts++;
      return { edges: state.edges.length, structural: state.edges.length - ghosts, ghosts, vertices: state.vertices.size, tip: state.tip };
    },
  };
}
