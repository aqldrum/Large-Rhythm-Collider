// grid-row-aura.js — Canvas-only visualization for live culled-grid row voices.
// Audio state arrives as a tiny read-only projection; this module never imports playback, workers,
// Cosmos runtime state, or camera controls.
//
// The aura is LIGHT, not an object. The old orb read as a solid sphere for four reasons — an off-centre
// highlight that shaded it like a lit ball, a rim stop brighter than the body, a stroked shell ring, and
// source-over compositing that GREYED whatever sat behind it. All four are gone. What replaces them is a
// centred, monotonically decreasing falloff (windowed Gaussian) composited with 'lighter', so overlapping
// notes bloom together and the star core shines THROUGH its own glow instead of being veiled by it.
//
// Every tunable lives in `auraOptions` — one plain object, no scattered literals — because Avery expects
// these visuals to end up behind a "visual options" panel that binds straight to it. Note that the sprite
// cache bakes colour/shape options in: call resetGridRowAuraSprites() after changing one of those.

// ── Tunables ────────────────────────────────────────────────────────────────────────────────────────────
export const auraOptions = {
  // Geometry, in screen pixels. The min/max clamps carry over from the solid orb unchanged: they are the
  // legibility floor for a distant star and the defensive ceiling when the camera is inside a big one.
  minPx: 10,            // even a distant sounding star stays visually legible
  maxPx: 52,            // defensive ceiling near/inside a large star
  starScale: 4.6,       // body radius relative to the rendered star radius
  starPad: 5,           // constant pad so a sub-pixel star still gets a body
  reach: 2.3,           // the glow extends this × the body radius — the long faint tail
  swell: 0.16,          // extra glow radius at full pulse (attack "breath")

  // Brightness. Every term is scaled by the caller's fog before the cap.
  voiceCeiling: 4,      // voice count that counts as "fully lit" (mirrors the audio tone-voice cap)
  voiceFloor: 0.25,     // a single voice never drops below this share of full brightness
  sustainAlpha: 0.085,  // floor level for any live voice
  voiceAlpha: 0.075,    // added at the voice ceiling
  pulseLift: 0.30,      // fractional brightness lift at a fresh attack
  // HARD per-glow ceiling — see the blow-out note in add(). Both ceilings sit just ABOVE what a fully lit
  // attack at fog 1 actually produces, so in normal flight they are rails, not clamps: the pulse response
  // is never flattened by its own safety net, and the net is still there if a caller hands in silly input.
  peakAlpha: 0.21,

  // Attack ripple: a SOFT expanding ring (a blurred annulus sprite), never a stroke. This is the
  // "a note just happened here" cue and it has to survive the move to a softer look.
  rippleGain: 0.20,     // ring brightness per unit pulse, before fog and the cap
  ripplePeakAlpha: 0.21,// HARD per-ring ceiling, same reason as peakAlpha
  rippleStart: 0.55,    // ring radius at the instant of attack, × body radius
  rippleReach: 2.05,    // ring radius once the pulse has fully decayed
  ripplePeak: 0.62,     // where the ring sits inside its own sprite (normalised radius)
  rippleWidth: 0.14,    // Gaussian half-width of the ring, normalised to the sprite radius
  rippleLightness: 88,  // rings stay hot; their hue is the note's, so they never read as white flashes
  pulseEnvelopeExp: 2,  // mirrors visualState()'s (1 - age/0.7)^2 — see the age inversion in the batch's add()

  // Colour. One hue per note across the whole glow: lightness carries the falloff, so two different
  // pitches can never read as one colour no matter how bright or faint the sample.
  saturation: 96,
  coreLightness: 95,    // hue-tinted near-white at the centre
  tailLightness: 52,    // saturated pitch colour out in the tail
  coreTightness: 2.2,   // how fast lightness drops off the core — bigger = tighter hot spot
  falloffSigma: 0.32,   // σ of the falloff Gaussian, normalised to the glow radius
  falloffGamma: 1.35,   // alpha = falloff^γ. γ>1 narrows the BRIGHT region without shortening the tail,
                        // which is what keeps a stack of overlapping glows away from saturation.
  hueBucketDeg: 1,      // sprite cache granularity; see bucketCount() — clamped to ≥1° / ≤360 buckets

  // Rasterisation. Glows are low-frequency content, so a small sprite upscaled is indistinguishable from
  // a live multi-stop gradient and far cheaper to put on screen.
  glowSpritePx: 64,
  rippleSpritePx: 48,
  gradientStops: 14,    // samples of the analytic profile baked into each radial gradient
};

const MAX_HUE_BUCKETS = 360;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// Pitch → colour (synesthesia). The hue is the note's pitch CLASS: log2(freq) mod 1 maps one octave onto the
// full colour wheel, so octaves share a colour and equal intervals sit at equal hue angles — the wheel is the
// tuning circle. AURA_ROOT_HZ anchors the row fundamental (1/1) to hue 0 (red); it mirrors the audio module's
// CULLED_ROW_FUNDAMENTAL_HZ but is only a cosmetic anchor — changing it just rotates every hue together.
const AURA_ROOT_HZ = 220;
const AURA_HUE_OFFSET = 12;   // rotate the wheel off pure red so the tonic reads amber, not alarm-red
const AURA_FALLBACK_HUE = 205; // legacy blue when a voice arrives without a pitch (defensive; shouldn't happen)

// Pitch class 0..1 of a sounding frequency: birth hz glided by the shared detune bus (cents), folded to one
// octave. detuneCents shifts every orb together, so the field's hue drifts as the root modulates.
// Exported because the constellation lines must speak the SAME pitch→colour law as the orbs they join.
export function pitchHue(hz, detuneCents) {
  if (!(hz > 0)) return AURA_FALLBACK_HUE;
  const octaves = Math.log2(hz / AURA_ROOT_HZ) + (detuneCents || 0) / 1200;
  const pc = ((octaves % 1) + 1) % 1;   // wrap to [0,1)
  return (pc * 360 + AURA_HUE_OFFSET) % 360;
}

// ── Analytic profiles ───────────────────────────────────────────────────────────────────────────────────
// Both profiles are WINDOWED: the rim value is subtracted and the result renormalised, so each one reaches
// exactly 0 at its sprite edge. Windowing is not cosmetic — an un-windowed Gaussian leaves a faint disc edge
// where the sprite stops, and a visible edge is precisely the "solid object" tell we are removing.

// Glow: 1 at the centre, 0 at the rim, monotonically decreasing in between. Monotonicity is the whole point
// of the redesign; nothing may ever brighten outward again.
function glowProfile(t) {
  const sigma = auraOptions.falloffSigma > 0 ? auraOptions.falloffSigma : 0.32;
  const k = 1 / (2 * sigma * sigma);
  const rim = Math.exp(-k);
  const g = (Math.exp(-k * t * t) - rim) / (1 - rim);
  return g > 0 ? g : 0;
}

// Ripple: a blurred annulus peaking at ripplePeak, hollow at the centre so a fresh attack lifts the ring
// WITHOUT double-brightening the core (the pulse lift already does that job).
function rippleProfile(t) {
  const width = auraOptions.rippleWidth > 0 ? auraOptions.rippleWidth : 0.14;
  const peak = auraOptions.ripplePeak;
  const k = 1 / (2 * width * width);
  const at = u => Math.exp(-k * (u - peak) * (u - peak));
  const rim = Math.max(at(0), at(1));
  const v = (at(t) - rim) / (1 - rim);
  return v > 0 ? v : 0;
}

// Colour at a profile sample. ONE hue throughout; lightness rides the profile so the core is a hue-tinted
// near-white and the tail is the saturated pitch colour. Both lightness and alpha are monotone in g, and g
// is monotone in t — so nothing anywhere brightens outward. No rim stop, no highlight, no edge.
function glowColor(hue, g) {
  const o = auraOptions;
  const light = o.tailLightness + (o.coreLightness - o.tailLightness) * Math.pow(g, o.coreTightness);
  return `hsla(${hue},${o.saturation}%,${light.toFixed(2)}%,${Math.pow(g, o.falloffGamma).toFixed(4)})`;
}
function rippleColor(hue, g) {
  return `hsla(${hue},${auraOptions.saturation}%,${auraOptions.rippleLightness}%,${g.toFixed(4)})`;
}

// Paint one profile as a radial gradient. The fill is a RECT, not an arc: the outermost stop is fully
// transparent, so under any compositing mode the corners contribute nothing, and a rect fill skips the
// path work. Used both to bake a sprite and — headless or on a canvas-less host — to draw live.
function paintProfile(target, hue, cx, cy, radius, profile, colorFor) {
  const n = Math.max(2, auraOptions.gradientStops | 0);
  const grad = target.createRadialGradient(cx, cy, 0, cx, cy, radius);
  for (let i = 0; i <= n; i++) { const t = i / n; grad.addColorStop(t, colorFor(hue, profile(t))); }
  target.fillStyle = grad;
  target.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

// ── Sprite cache ────────────────────────────────────────────────────────────────────────────────────────
// Hue is continuous (the detune bus glides it), so sprites are cached per hue BUCKET. The bucket must be
// ≤1° wide: a syntonic comma is ≈21.5¢ ≈ 6.5° of wheel, so at 1° no just-intonation distinction can ever
// collapse into a neighbour's sprite. That same choice HARD-BOUNDS the cache at 360 entries — the key space
// IS the bound, so there is no eviction policy to get wrong and nothing to leak. Given this project's leak
// history that property is worth more than any cleverer scheme.
const spriteCache = new Map();
let spriteCanvasFactory = null;

function bucketCount() {
  const deg = auraOptions.hueBucketDeg > 0 ? auraOptions.hueBucketDeg : 1;
  return Math.max(1, Math.min(MAX_HUE_BUCKETS, Math.round(360 / deg)));
}

// Sprite creation needs a canvas, and this module is exercised under plain Node by its guard. Prefer
// OffscreenCanvas, fall back to a DOM canvas, and allow an injected factory; when none of the three is
// available the caller falls back to a live gradient with the identical profile, so the look never forks.
function makeSpriteCanvas(px) {
  if (spriteCanvasFactory) return spriteCanvasFactory(px);
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(px, px);
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    return canvas;
  }
  return null;
}

function bakeSprite(px, hue, profile, colorFor) {
  const size = Math.max(8, px | 0);
  const canvas = makeSpriteCanvas(size);
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  const target = canvas.getContext('2d');
  if (!target) return null;
  paintProfile(target, hue, size / 2, size / 2, size / 2, profile, colorFor);
  return canvas;
}

// One entry per bucket holding BOTH sprites, so the cache size never exceeds the bucket count even though
// each aura may draw two textures. `undefined` means "not baked yet"; `null` means "no canvas on this host,
// draw live" — a distinction worth keeping so a canvas-less host does not retry the factory every frame.
function spriteSet(hue) {
  const buckets = bucketCount();
  const index = ((Math.round(hue / 360 * buckets) % buckets) + buckets) % buckets;
  let entry = spriteCache.get(index);
  if (!entry) {
    // Belt and braces: the integer key space already bounds this, but an explicit invariant costs nothing
    // and fails loudly toward "flush" rather than quietly toward "grow" if bucketing is ever changed.
    if (spriteCache.size >= buckets) spriteCache.clear();
    entry = { hue: index * 360 / buckets };
    spriteCache.set(index, entry);
  }
  return entry;
}

// Install a canvas factory (px → canvas-like). Passing null restores the OffscreenCanvas/DOM detection.
// Always drops the cache: sprites baked by the previous factory belong to it.
export function setGridRowAuraSpriteCanvasFactory(factory) {
  spriteCanvasFactory = typeof factory === 'function' ? factory : null;
  resetGridRowAuraSprites();
}

// Drop every baked sprite. Call after changing any colour/shape/size tunable in `auraOptions` — those are
// baked into the textures — and on teardown if a host wants the memory back immediately.
export function resetGridRowAuraSprites() { spriteCache.clear(); }

// ── Batch ───────────────────────────────────────────────────────────────────────────────────────────────
// Auras are collected during the star/node walk and flushed in ONE additive pass. Additive blending is
// order-independent, so the glows need no painter's order of their own — and being a single pass means the
// composite mode is set and restored exactly once per flush instead of per orb.
const STRIDE = 7;   // x, y, glowR, glowAlpha, ringR, ringAlpha, hue

function drawOne(ctx, x, y, glowR, glowAlpha, ringR, ringAlpha, hue) {
  const o = auraOptions;
  const set = spriteSet(hue);
  if (set.glow === undefined) set.glow = bakeSprite(o.glowSpritePx, set.hue, glowProfile, glowColor);
  ctx.globalAlpha = glowAlpha;
  if (set.glow) ctx.drawImage(set.glow, x - glowR, y - glowR, glowR * 2, glowR * 2);
  else paintProfile(ctx, set.hue, x, y, glowR, glowProfile, glowColor);
  if (ringAlpha <= 0 || ringR <= 0) return;
  if (set.ripple === undefined) set.ripple = bakeSprite(o.rippleSpritePx, set.hue, rippleProfile, rippleColor);
  // The sprite's ring sits at `ripplePeak` of its own radius, so scale the whole sprite to put that ring
  // exactly on ringR. The annulus thickens as it expands, which is how a real disturbance diffuses.
  const spriteR = ringR / (o.ripplePeak > 0 ? o.ripplePeak : 0.62);
  ctx.globalAlpha = ringAlpha;
  if (set.ripple) ctx.drawImage(set.ripple, x - spriteR, y - spriteR, spriteR * 2, spriteR * 2);
  else paintProfile(ctx, set.hue, x, y, spriteR, rippleProfile, rippleColor);
}

export function createGridRowAuraBatch() {
  const q = [];
  let n = 0;
  return {
    get size() { return n / STRIDE; },
    clear() { n = 0; },

    // Collect one aura. Signature mirrors drawGridRowAura minus the ctx, so a call site converts by
    // deferring, not by rewriting. The caller still owns bloom suppression and occlusion culling.
    add(screenPosition, starRadius, fog, activity, detuneCents = 0) {
      if (!screenPosition || !activity || !(fog > 0)) return;
      const o = auraOptions;
      const voiceStrength = clamp((activity.voices || 0) / o.voiceCeiling, o.voiceFloor, 1);
      const pulse = clamp(activity.pulse || 0, 0, 1);
      const bodyR = clamp(starRadius * o.starScale + o.starPad, o.minPx, o.maxPx);
      // Blow-out guard. Under 'lighter' every overlapping glow SUMS, so an uncapped per-glow alpha would
      // turn a dense cluster of sounding stars into a white hole. The cap sits a hair above what a fully
      // lit attack at fog 1 produces, so it never flattens the pulse response it exists to protect.
      const glowAlpha = Math.min(o.peakAlpha,
        fog * (o.sustainAlpha + o.voiceAlpha * voiceStrength) * (1 + o.pulseLift * pulse));
      const glowR = bodyR * o.reach * (1 + o.swell * pulse);
      const hue = pitchHue(activity.hz, detuneCents);
      let ringR = 0, ringAlpha = 0;
      if (pulse > 0) {
        // visualState() shapes pulse as (1 - age/VISUAL_ATTACK_SECONDS)^2, so inverting that exponent
        // recovers an age that is LINEAR in time. The ripple then travels outward at a constant speed
        // instead of lurching away and crawling. If that envelope ever changes the ring merely eases
        // differently — the expansion stays monotonic and nothing breaks.
        const age = clamp(1 - Math.pow(pulse, 1 / o.pulseEnvelopeExp), 0, 1);
        ringR = bodyR * (o.rippleStart + (o.rippleReach - o.rippleStart) * age);
        ringAlpha = Math.min(o.ripplePeakAlpha, fog * o.rippleGain * pulse);
      }
      q[n] = screenPosition.x; q[n + 1] = screenPosition.y;
      q[n + 2] = glowR; q[n + 3] = glowAlpha;
      q[n + 4] = ringR; q[n + 5] = ringAlpha; q[n + 6] = hue;
      n += STRIDE;
    },

    // Draw everything collected, then hand the canvas back exactly as we found it. Restoring explicitly
    // (rather than save/restore) keeps the contract visible at the call site: the next pass — the batched
    // core dots — must see plain source-over at full alpha.
    flush(ctx) {
      if (!n) return;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i += STRIDE) {
        drawOne(ctx, q[i], q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5], q[i + 6]);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      n = 0;
    },
  };
}

// Single-shot draw, kept for callers that have one aura and no pass to defer it into. It routes through the
// same batch so there is exactly one implementation of the glow — and one place where the composite mode is
// set and restored.
const soloBatch = createGridRowAuraBatch();

// A sounding grid rendered as light: a centred hue-tinted core falling monotonically into a long faint tail,
// plus a soft ring expanding away from each fresh row attack. Hue is the sounding pitch; the caller owns
// bloom suppression and passes the live detune-bus cents so hue tracks retuning/modulation, not birth pitch.
export function drawGridRowAura(ctx, screenPosition, starRadius, fog, activity, detuneCents = 0) {
  soloBatch.add(screenPosition, starRadius, fog, activity, detuneCents);
  soloBatch.flush(ctx);
}
