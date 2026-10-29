// rhythms.mjs — the rhythms Composer/tests check against, shared by assert-row.mjs and assert-cells.mjs.
// Deterministic: hand-picked ones, then seeded draws of three sizes. Every grid stays ≤ 2^25 so Overworld's
// chunk-super-row.js (which refuses larger grids) can build the same rhythm.

export const OVERWORLD_RUNTIME = '/Users/averylogan/Dev/LRC/Compiler/Codex Compiler (dev)/Overworld/econ/runtime';
export const OVERWORLD_MAX_GRID = 2 ** 25;

const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
export const lcmOf = (xs) => xs.filter((v) => v > 0).reduce((a, v) => (a / gcd(a, v)) * v, 1);

/** the rhythms the LRC is known by, edge cases, and the 12EDO floor champion from Avery's registry work */
export const HAND_PICKED = [
  [3, 2], [8, 7, 6, 5], [11, 9, 7, 5], [19, 17, 16, 15], [5, 4, 3], [4, 3], [7, 5, 3, 2],
  [119, 42, 15, 8],         // the 12EDO floor champion (grid 14280)
  [1], [5], [1, 1], [6, 6, 4], [0, 7, 0, 3], [12, 8, 6, 4], [16, 12, 9],
  [5, 6, 7, 8],             // 8:7:6:5 written the other way round: layer A is 5 here
  [426, 317, 285], [401, 240, 393],   // two exact tones the site spells alike (a gap's denominator past 1000)
];

function draws() {
  let seed = 20261021;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const out = [], seen = new Set(HAND_PICKED.map((l) => l.join(':')));
  const keep = (layers) => {
    const key = layers.join(':');
    if (seen.has(key) || lcmOf(layers) > OVERWORLD_MAX_GRID) return false;
    seen.add(key); out.push(layers); return true;
  };
  // small: 2–4 layers up to 16
  for (let got = 0; got < 12;) { const k = int(2, 4); if (keep(Array.from({ length: k }, () => int(1, 16)))) got++; }
  // mid: 3–4 layers up to 120
  for (let got = 0; got < 12;) { const k = int(3, 4); if (keep(Array.from({ length: k }, () => int(10, 120)))) got++; }
  // large: four divisors of a smooth grid, a few hundred to a few thousand onsets
  const smooth = [302400, 332640, 498960, 720720, 1081080, 2162160, 3603600, 4324320];
  for (let got = 0; got < 10;) {
    const G = smooth[int(0, smooth.length - 1)], divs = [];
    for (let d = 200; d <= 2600; d++) if (G % d === 0) divs.push(d);
    const layers = Array.from({ length: 4 }, () => divs[int(0, divs.length - 1)]);
    if (keep(layers)) got++;
  }
  return out;
}

export const RHYTHMS = [...HAND_PICKED, ...draws()];
