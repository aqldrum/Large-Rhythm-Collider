// mode.js — shared mode flag so the Bloom and Flight renderers can gate their own rAF loops
// and route the grid input, without either owning the other.
export const M = { mode: 'bloom', warp: null };
