// Assertions for the grid-row glow aura. These are BEHAVIOURAL: everything below is read back off a
// recording 2D context, i.e. from what the module actually paints, not from the constants it holds.
// What is being defended:
//   · the aura is LIGHT — additive, centred, monotonically falling, never stroked, never shadow-blurred;
//   · a dense cluster of sounding stars cannot blow out to white;
//   · the sprite cache is HARD-bounded at 360 hue buckets (this project has a leak history);
//   · no just-intonation distinction — down to a syntonic comma — ever collapses into one colour;
//   · the canvas is handed back exactly as it was found, because the core dots flush straight after.
import {
  auraOptions, createGridRowAuraBatch, drawGridRowAura, pitchHue,
  resetGridRowAuraSprites, setGridRowAuraSpriteCanvasFactory,
} from '../grid-row-aura.js';

let PASS = true;
const check = (name, ok, detail = '') => {
  PASS = PASS && ok;
  console.log(`  ${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ── recording 2D context ────────────────────────────────────────────────────────────────────────────────
// Captures every call together with the compositing state in force at the time, so "was this drawn
// additively" and "was the state restored" are answerable after the fact rather than by inspection.
function recorder() {
  const calls = [], stops = [];
  let alpha = 1, composite = 'source-over', shadowTouched = false;
  const note = (op, extra) => calls.push({ op, alpha, composite, ...extra });
  const ctx = {
    calls, stops,
    get shadowTouched() { return shadowTouched; },
    get globalAlpha() { return alpha; },
    set globalAlpha(v) { alpha = v; },
    get globalCompositeOperation() { return composite; },
    set globalCompositeOperation(v) { composite = v; note('composite', { value: v }); },
    get shadowBlur() { return 0; },
    set shadowBlur(v) { shadowTouched = true; note('shadowBlur', { value: v }); },
    set fillStyle(v) {}, get fillStyle() { return null; },
    set strokeStyle(v) {}, get strokeStyle() { return null; },
    set lineWidth(v) {}, get lineWidth() { return 0; },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const grad = { x0, y0, r0, x1, y1, r1, stops: [] };
      stops.push(grad);
      note('createRadialGradient', { grad });
      return { addColorStop: (t, color) => grad.stops.push({ t, color }) };
    },
    fillRect(x, y, w, h) { note('fillRect', { x, y, w, h }); },
    drawImage(img, x, y, w, h) { note('drawImage', { img, x, y, w, h }); },
    beginPath() { note('beginPath'); },
    arc() { note('arc'); },
    fill() { note('fill'); },
    moveTo() { note('moveTo'); }, lineTo() { note('lineTo'); },
    stroke() { note('stroke'); },
    save() { note('save'); }, restore() { note('restore'); },
  };
  return ctx;
}

// A canvas factory that hands back recording canvases and counts every bake. Each baked sprite carries the
// gradient it was painted with, so the guard can read the sprite's actual profile and its actual hue.
function spriteFarm() {
  const made = [];
  setGridRowAuraSpriteCanvasFactory(px => {
    const c2 = recorder();
    const canvas = { width: px, height: px, getContext: () => c2, rec: c2, px };
    made.push(canvas);
    return canvas;
  });
  return made;
}
const spriteStops = canvas => (canvas.rec.stops[0] ? canvas.rec.stops[0].stops : []);
const spriteHue = canvas => {
  const first = spriteStops(canvas)[0];
  return first ? Number(first.color.slice(first.color.indexOf('(') + 1, first.color.indexOf(','))) : NaN;
};
const alphaOf = stop => Number(stop.color.slice(stop.color.lastIndexOf(',') + 1, stop.color.lastIndexOf(')')));
const lightOf = stop => { const parts = stop.color.split(','); return Number(parts[2].replace('%', '')); };
// Alpha of the glow profile at normalised radius t, read back off the baked stop table (linear between
// samples, which is what a canvas radial gradient does anyway).
function profileAlpha(stopList, t) {
  for (let i = 1; i < stopList.length; i++) {
    if (stopList[i].t >= t) {
      const a = stopList[i - 1], b = stopList[i];
      const k = (t - a.t) / (b.t - a.t || 1);
      return alphaOf(a) + (alphaOf(b) - alphaOf(a)) * k;
    }
  }
  return 0;
}

const ACTIVITY = (voices, pulse, hz) => ({ id: 1, voices, pulse, hz, sources: [] });
// Frozen historical baseline: the radius the SOLID orb reached before this change. Deliberately hard-coded
// rather than read from auraOptions — its whole job is to catch a future retune that quietly shrinks the
// glow back to the size of the object it replaced.
const LEGACY_ORB_R = r => Math.max(10, Math.min(52, r * 4.6 + 5));

console.log('═══ COSMOS GRID-ROW AURA — glow assertions ═══');

// ── [1] The aura is light, not an object ────────────────────────────────────────────────────────────────
console.log('\n[1] Light, not an object');
{
  const made = spriteFarm();
  const ctx = recorder();
  const batch = createGridRowAuraBatch();
  for (let i = 0; i < 6; i++) batch.add({ x: 100 + i * 40, y: 120 }, 4 + i, 0.9, ACTIVITY(2, i / 5, 180 + i * 37));
  batch.flush(ctx);
  const draws = ctx.calls.filter(c => c.op === 'drawImage' || c.op === 'fillRect');
  check('the glow reaches the canvas at all', draws.length >= 6, `${draws.length} draws`);
  check('nothing is ever stroked — the shell ring is gone', !ctx.calls.some(c => c.op === 'stroke'));
  check('shadowBlur is never touched, on the canvas or in a sprite',
    !ctx.shadowTouched && !made.some(m => m.rec.shadowTouched));
  check('every glow is composited additively', draws.every(c => c.composite === 'lighter'));
  const tail = ctx.calls[ctx.calls.length - 1];
  check('the composite mode is restored for the pass that follows',
    tail.op === 'composite' && tail.value === 'source-over' && ctx.globalCompositeOperation === 'source-over');
  check('globalAlpha is handed back at 1', ctx.globalAlpha === 1);
}

// ── [2] Falloff shape: centred, monotone, edgeless ──────────────────────────────────────────────────────
console.log('\n[2] Falloff — centred, monotonically decreasing, no rim');
let glowStops = [];
{
  const made = spriteFarm();
  const ctx = recorder();
  drawGridRowAura(ctx, { x: 0, y: 0 }, 5, 1, ACTIVITY(4, 0, 330));
  const glow = made[0];
  glowStops = spriteStops(glow);
  const grad = glow.rec.stops[0];
  check('the gradient is CENTRED — no off-centre highlight shading it like a lit ball',
    grad.x0 === grad.x1 && grad.y0 === grad.y1 && grad.r0 === 0);
  const alphas = glowStops.map(alphaOf), lights = glowStops.map(lightOf);
  check('alpha starts opaque at the core', alphas[0] === 1);
  check('alpha reaches exactly zero at the rim — no disc edge where the sprite stops',
    alphas[alphas.length - 1] === 0);
  check('alpha never increases outward', alphas.every((a, i) => i === 0 || a <= alphas[i - 1]),
    alphas.slice(0, 5).map(a => a.toFixed(3)).join(' > ') + ' …');
  check('lightness never increases outward — the bright rim stop is gone',
    lights.every((l, i) => i === 0 || l <= lights[i - 1]));
  check('the core is a hue-tinted near-white and the tail is saturated colour',
    lights[0] > 85 && lights[lights.length - 1] < 60, `${lights[0]}% → ${lights[lights.length - 1]}%`);
  check('one hue across the whole glow, so two pitches can never read as one colour',
    new Set(glowStops.map(s => s.color.split(',')[0])).size === 1);
}

// ── [3] Reach: the glow is much bigger than the orb it replaces ─────────────────────────────────────────
console.log('\n[3] Reach');
{
  spriteFarm();
  const ctx = recorder();
  const batch = createGridRowAuraBatch();
  const starR = 6;
  batch.add({ x: 0, y: 0 }, starR, 1, ACTIVITY(4, 0, 330));
  batch.flush(ctx);
  const drawn = ctx.calls.find(c => c.op === 'drawImage');
  const reach = (drawn.w / 2) / LEGACY_ORB_R(starR);
  check('the glow reaches 2–3× the old solid orb', reach >= 2 && reach <= 3, `${reach.toFixed(2)}×`);
  // 65% of the radius is past the old orb's edge; there must still be measurable light out there.
  const tailA = profileAlpha(glowStops, 0.7);
  check('there is real light in the long tail, not just a hard core',
    tailA > 0.005 && tailA < 0.12, `alpha ${tailA.toFixed(4)} at 0.7 radius`);
}

// ── [4] Attack response: lift, swell, and a soft expanding ripple ───────────────────────────────────────
console.log('\n[4] Attack — brightness lift, radius swell, soft ripple');
{
  const made = spriteFarm();
  const quiet = recorder(), hit = recorder();
  drawGridRowAura(quiet, { x: 0, y: 0 }, 5, 1, ACTIVITY(2, 0, 330));
  drawGridRowAura(hit, { x: 0, y: 0 }, 5, 1, ACTIVITY(2, 1, 330));
  const q = quiet.calls.filter(c => c.op === 'drawImage'), h = hit.calls.filter(c => c.op === 'drawImage');
  check('a silent star draws the glow and nothing else', q.length === 1);
  check('a fresh attack adds exactly one more element — the ripple', h.length === 2);
  check('the attack lifts brightness', h[0].alpha > q[0].alpha, `${q[0].alpha.toFixed(3)} → ${h[0].alpha.toFixed(3)}`);
  check('the attack swells the radius', h[0].w > q[0].w, `${q[0].w.toFixed(1)} → ${h[0].w.toFixed(1)}px`);

  const ring = made.find(m => m !== made[0] && spriteStops(m).length);
  const rStops = spriteStops(ring), rAlphas = rStops.map(alphaOf);
  const peakAt = rAlphas.indexOf(Math.max(...rAlphas));
  check('the ripple is a blurred annulus, not a stroke — hollow centre, peak inside, zero at the rim',
    rAlphas[0] < 0.02 && peakAt > 0 && peakAt < rAlphas.length - 1 && rAlphas[rAlphas.length - 1] === 0,
    `peak at t=${rStops[peakAt].t.toFixed(2)}`);
  check('the ripple does not re-brighten the core the pulse lift already lit', rAlphas[0] < rAlphas[peakAt] / 20);

  // pulse decays 1 → 0 over the attack window, so sampling it backwards samples the ripple forwards in time.
  const radii = [], alphasOverTime = [];
  for (const pulse of [1, 0.64, 0.36, 0.16, 0.04]) {
    const c = recorder();
    drawGridRowAura(c, { x: 0, y: 0 }, 5, 1, ACTIVITY(2, pulse, 330));
    const ripple = c.calls.filter(x => x.op === 'drawImage')[1];
    radii.push(ripple.w); alphasOverTime.push(ripple.alpha);
  }
  check('the ripple expands as the pulse decays', radii.every((r, i) => i === 0 || r > radii[i - 1]),
    radii.map(r => (r / 2).toFixed(0)).join(' → ') + 'px');
  check('the ripple fades as it expands', alphasOverTime.every((a, i) => i === 0 || a < alphasOverTime[i - 1]));
}

// ── [5] Blow-out: a dense cluster must stay light, not become a white hole ───────────────────────────────
console.log('\n[5] Blow-out bound under additive blending');
{
  spriteFarm();
  const sample = (voices, pulse, fog) => {
    const c = recorder();
    drawGridRowAura(c, { x: 0, y: 0 }, 5, fog, ACTIVITY(voices, pulse, 330));
    return c.calls.find(x => x.op === 'drawImage').alpha;
  };
  const full = sample(4, 1, 1), absurd = sample(9999, 99, 50);
  check('per-glow alpha saturates — escalating a silly input further changes nothing',
    absurd === sample(9999, 999, 5000), `capped at ${absurd.toFixed(3)}`);
  check('the ceiling sits just above a fully-lit attack, so no input buys real extra brightness',
    absurd < full * 1.1, `${full.toFixed(3)} lit vs ${absurd.toFixed(3)} ceiling`);
  check('the ceiling is well below opaque', absurd < 0.35);
  check('alpha rises with fog', sample(2, 0, 0.3) < sample(2, 0, 0.7) && sample(2, 0, 0.7) < sample(2, 0, 1));
  check('alpha rises with the voice count', sample(1, 0, 1) < sample(4, 0, 1));
  check('alpha rises with the pulse', sample(2, 0, 1) < sample(2, 0.5, 1) && sample(2, 0.5, 1) < sample(2, 1, 1));

  // ROW_ACTIVE_STARS caps the field at 20 sounding stars. Stacked at the radius where a dense cluster
  // really does overlap — roughly where the old orb's edge sat — the sum must stay under saturation.
  const orbEdgeT = LEGACY_ORB_R(5) / (createdRadius() / 2);
  const atOrbEdge = profileAlpha(glowStops, orbEdgeT);
  const eight = 8 * absurd * atOrbEdge, twenty = 20 * absurd * profileAlpha(glowStops, 0.75);
  check('eight overlapping full-strength glows stay under saturation', eight < 1, `Σα ≈ ${eight.toFixed(2)}`);
  check('all twenty sounding stars\' tails together stay far under saturation', twenty < 0.5,
    `Σα ≈ ${twenty.toFixed(3)}`);
  const depth = Math.floor(1 / absurd);
  check('it takes several exactly-coincident attacks to reach white, not two or three', depth >= 4,
    `${depth} coincident cores`);

  function createdRadius() {
    const c = recorder();
    drawGridRowAura(c, { x: 0, y: 0 }, 5, 1, ACTIVITY(4, 1, 330));
    return c.calls.find(x => x.op === 'drawImage').w;
  }
}

// ── [6] Sprite cache is hard-bounded ────────────────────────────────────────────────────────────────────
console.log('\n[6] Sprite cache — hard bound, no leak');
{
  const made = spriteFarm();
  const ctx = recorder();
  const batch = createGridRowAuraBatch();
  // A continuous hue sweep, far finer than the bucket width, across several octaves AND a full detune
  // glide — the long-modulation case that would grow an unbounded cache without limit.
  for (let i = 0; i < 4000; i++) {
    const hz = 110 * Math.pow(2, i / 500);
    batch.add({ x: 0, y: 0 }, 5, 1, ACTIVITY(3, 1, hz), (i % 1201) - 600);
  }
  batch.flush(ctx);
  const hues = new Set(made.map(spriteHue));
  check('a fine sweep of 4000 distinct pitches never exceeds 360 cached hue buckets',
    hues.size <= 360, `${hues.size} buckets from ${made.length} sprites`);
  check('the sweep actually saturates the bound (so the bound is the thing being tested)', hues.size === 360);
  check('each bucket bakes at most one glow and one ripple', made.length <= 2 * hues.size,
    `${made.length} sprites ≤ ${2 * hues.size}`);
  const before = made.length;
  const again = createGridRowAuraBatch();
  for (let i = 0; i < 4000; i++) again.add({ x: 0, y: 0 }, 5, 1, ACTIVITY(3, 1, 110 * Math.pow(2, i / 500)), (i % 1201) - 600);
  again.flush(recorder());
  check('a second sweep bakes nothing new — the cache is a cache', made.length === before);
}

// ── [7] Pitch → colour law is intact and fine enough for just intonation ────────────────────────────────
console.log('\n[7] Pitch → colour');
{
  check('octaves share a colour (hue is the pitch CLASS)', Math.abs(pitchHue(220, 0) - pitchHue(880, 0)) < 1e-9);
  check('the detune bus rotates every hue by the same angle',
    Math.abs(((pitchHue(330, 50) - pitchHue(330, 0) + 360) % 360) - ((pitchHue(495, 50) - pitchHue(495, 0) + 360) % 360)) < 1e-9);
  check('a voice with no pitch still gets a defined hue', Number.isFinite(pitchHue(0, 0)) && Number.isFinite(pitchHue(undefined, 0)));
  // visualState() can hand over a sustained voice whose hz never resolved. That must still light up —
  // a silent star is a bug the player would never see, whereas an odd-coloured one is merely odd.
  {
    spriteFarm();
    const noHz = recorder();
    drawGridRowAura(noHz, { x: 0, y: 0 }, 5, 1, { id: 9, voices: 2, pulse: 0.5, sources: [] });
    check('a voice with no hz still renders, glow and ripple, on the fallback hue',
      noHz.calls.filter(c => c.op === 'drawImage').length === 2);
  }

  // A syntonic comma (81/80, ≈21.5¢) is the finest distinction this tuning system draws. Tested
  // behaviourally: the two pitches must be handed DIFFERENT sprites, not merely different hue numbers.
  let merged = 0, pairs = 0;
  for (let i = 0; i < 48; i++) {
    const hz = 180 * Math.pow(2, i / 48 * 3);
    resetGridRowAuraSprites();
    const a = spriteFarm();
    drawGridRowAura(recorder(), { x: 0, y: 0 }, 5, 1, ACTIVITY(2, 0, hz));
    resetGridRowAuraSprites();
    const b = spriteFarm();
    drawGridRowAura(recorder(), { x: 0, y: 0 }, 5, 1, ACTIVITY(2, 0, hz * 81 / 80));
    pairs++;
    if (spriteHue(a[0]) === spriteHue(b[0])) merged++;
  }
  check('two pitches a syntonic comma apart never share a sprite bucket', merged === 0, `${pairs} pairs tested`);
}

// ── [8] Batch contract and the canvas-less fallback ─────────────────────────────────────────────────────
console.log('\n[8] Batch contract and headless fallback');
{
  spriteFarm();
  const empty = recorder();
  const batch = createGridRowAuraBatch();
  batch.flush(empty);
  check('flushing an empty batch touches nothing — no stray composite change', empty.calls.length === 0);
  batch.add(null, 5, 1, ACTIVITY(2, 0, 330));
  batch.add({ x: 0, y: 0 }, 5, 0, ACTIVITY(2, 0, 330));
  batch.add({ x: 0, y: 0 }, 5, 1, null);
  check('a null position, zero fog or absent activity is dropped, not drawn', batch.size === 0);
  batch.add({ x: 1, y: 2 }, 5, 1, ACTIVITY(2, 0, 330));
  batch.add({ x: 3, y: 4 }, 5, 1, ACTIVITY(2, 0, 440));
  check('the batch counts what it collected', batch.size === 2);
  const ctx = recorder();
  batch.flush(ctx);
  check('flush empties the batch so one batch can serve several passes', batch.size === 0);

  // No OffscreenCanvas, no DOM, no factory: the module must still draw, with the same profile, live.
  setGridRowAuraSpriteCanvasFactory(() => null);
  const bare = recorder();
  drawGridRowAura(bare, { x: 0, y: 0 }, 5, 1, ACTIVITY(3, 1, 330));
  const grads = bare.stops;
  check('with no canvas available it falls back to live gradients rather than drawing nothing',
    grads.length === 2 && bare.calls.some(c => c.op === 'fillRect'));
  check('the fallback paints the identical profile', grads[0].stops.map(alphaOf).join() === glowStops.map(alphaOf).join());
  check('the fallback is still additive and still restores the canvas',
    bare.calls.filter(c => c.op === 'fillRect').every(c => c.composite === 'lighter') &&
    bare.globalCompositeOperation === 'source-over' && bare.globalAlpha === 1);
  check('the fallback still strokes nothing', !bare.calls.some(c => c.op === 'stroke'));

  // And with NO factory at all. Under plain Node there is no OffscreenCanvas and no document, so this
  // exercises the real detection chain rather than a stub that answers null — which is the case that
  // decides whether this module can be imported and reasoned about outside a browser at all.
  setGridRowAuraSpriteCanvasFactory(null);
  const detect = recorder();
  drawGridRowAura(detect, { x: 0, y: 0 }, 5, 1, ACTIVITY(3, 1, 330));
  check('host canvas detection degrades to live gradients instead of throwing or drawing nothing',
    detect.stops.length === 2 && detect.calls.some(c => c.op === 'fillRect' && c.composite === 'lighter') &&
    detect.globalCompositeOperation === 'source-over');
}

// ── [9] The tunables really are one object ──────────────────────────────────────────────────────────────
console.log('\n[9] One options object (a visual-options panel will bind to it)');
{
  setGridRowAuraSpriteCanvasFactory(null);
  spriteFarm();
  const reachWas = auraOptions.reach;
  const before = recorder(), after = recorder();
  drawGridRowAura(before, { x: 0, y: 0 }, 5, 1, ACTIVITY(3, 0, 330));
  auraOptions.reach = reachWas * 2;
  drawGridRowAura(after, { x: 0, y: 0 }, 5, 1, ACTIVITY(3, 0, 330));
  auraOptions.reach = reachWas;
  const b = before.calls.find(c => c.op === 'drawImage'), a = after.calls.find(c => c.op === 'drawImage');
  check('changing a tunable on auraOptions changes what is drawn, with no reload or refactor',
    Math.abs(a.w / b.w - 2) < 1e-9, `${(b.w / 2).toFixed(0)}px → ${(a.w / 2).toFixed(0)}px`);
  setGridRowAuraSpriteCanvasFactory(null);   // hygiene: leave detection restored for any later suite
}

console.log(`\n${PASS ? '✓✓✓ GRID-ROW AURA PASSES — additive light, bounded cache, comma-safe colour' : '✗ GRID-ROW AURA FAILED'}`);
process.exit(PASS ? 0 : 1);
